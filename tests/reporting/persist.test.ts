/**
 * WP-5.3 — DDL + 存储层不变量 (真实 research.sqlite):
 *  - 三表 + 双触发器形态 (no-delete / no-content-update, 对齐
 *    planfork/intervention 先例) 落库;
 *  - DDL 幂等 (第三连接重放 IF NOT EXISTS 干净);
 *  - trigger 兜底任何连接的 raw 写 (第二连接 raw DELETE/UPDATE 全部
 *    ABORT);
 *  - §15 表映射: PK only (无额外索引 — 冻结列形状逐字);
 *  - 行↔记录往返 (SQL 层, 含 JSON 列 participants/related_workstreams/
 *    material_refs/schedule/related_refs)。
 */

import { DatabaseSync } from 'node:sqlite'
import { join as joinPath } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { IdAllocator } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import {
  INTERACTION_TABLE,
  REPORTING_ITEM_TABLE,
  SCHEDULED_EVENT_TABLE,
  REPORTING_TABLES,
  ReportingError,
  reportingDdl,
  type SevSchedule,
} from '../../src/host/service/reporting/index.js'
import { adaptReportingDb, count, openReportingHarness, qAll, qGet, T0, type ReportingHarness } from './helpers.js'

describe('DDL on the real file (DatabaseSync 封装模式)', () => {
  let h: ReportingHarness
  afterEach(() => h?.close())

  it('creates the three §15 tables on top of the WP-2.1 core tables', () => {
    h = openReportingHarness()
    const tables = qAll(h.rawDb, `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).map((r) => String(r.name))
    expect(tables).toContain('history_event')
    expect(tables).toContain('derived_state')
    expect(tables).toContain('meta')
    for (const t of REPORTING_TABLES) expect(tables).toContain(t)
  })

  it('pins the exact column sets (frozen reporting.schema.json 行形状, PK only — §15 无额外索引)', () => {
    h = openReportingHarness()
    const cols = (table: string): string[] =>
      (qAll(h.rawDb, `PRAGMA table_xinfo(${table})`) as { name: string }[]).map((r) => r.name)
    expect(cols(INTERACTION_TABLE)).toEqual(['id', 'kind', 'title', 'occurred_at', 'participants', 'notes', 'related_workstreams'])
    expect(cols(REPORTING_ITEM_TABLE)).toEqual(['id', 'audience', 'statement', 'material_refs', 'status', 'occasion_ref', 'created_at', 'reported_at'])
    expect(cols(SCHEDULED_EVENT_TABLE)).toEqual(['id', 'title', 'schedule', 'related_refs', 'reminder_lead_ms'])
    // §15 对本三表的「关键约束/索引」列为空 — 无额外索引 (仅自动 PK 索引)。
    for (const t of REPORTING_TABLES) {
      const indexes = qAll(h.rawDb, `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '${t}' AND name NOT LIKE 'sqlite_%'`).map((r) => String(r.name))
      expect(indexes, `unexpected indexes on ${t}`).toEqual([])
    }
  })

  it('pins the double-trigger form on every table (no-delete + no-content-update)', () => {
    h = openReportingHarness()
    const triggers = (table: string): string[] =>
      qAll(h.rawDb, `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = '${table}' ORDER BY name`).map((r) => String(r.name))
    expect(triggers(INTERACTION_TABLE)).toEqual(['interaction_no_content_update', 'interaction_no_delete'])
    expect(triggers(REPORTING_ITEM_TABLE)).toEqual(['reporting_item_no_content_update', 'reporting_item_no_delete'])
    expect(triggers(SCHEDULED_EVENT_TABLE)).toEqual(['scheduled_event_no_content_update', 'scheduled_event_no_delete'])
  })

  it('is IDEMPOTENT — a third connection re-applies IF NOT EXISTS cleanly', () => {
    h = openReportingHarness()
    const third = h.secondService()
    expect(third.listInteractions()).toHaveLength(0)
    expect(third.listReportingItems()).toHaveLength(0)
    expect(third.listScheduledEvents()).toHaveLength(0)
    // A fourth raw exec of the full DDL is still a no-op (no table dup).
    const raw = new DatabaseSync(joinPath(h.dir, 'research.sqlite'))
    try {
      raw.exec(reportingDdl())
    } finally {
      raw.close()
    }
  })
})

describe('row ↔ record round trip (SQL 层)', () => {
  let h: ReportingHarness
  afterEach(() => h?.close())

  it('round-trips a fully-populated interaction row (JSON 列 + 可空列)', () => {
    h = openReportingHarness()
    const { record } = h.service.registerInteraction({
      kind: 'MEETING',
      title: '周会',
      occurredAt: T0 + 3_600_000,
      participants: ['张三', '李四'],
      notes: '讨论了实验方案 A/B。',
      relatedWorkstreams: ['WS-1', 'WS-2'],
    })
    const row = qGet(h.rawDb, `SELECT * FROM ${INTERACTION_TABLE} WHERE id = ?`, record.id)
    expect(row).toBeDefined()
    expect(JSON.parse(String(row!.participants))).toEqual(['张三', '李四'])
    expect(JSON.parse(String(row!.related_workstreams))).toEqual(['WS-1', 'WS-2'])
    const reread = h.service.getInteraction(record.id)
    expect(reread).toEqual(record)
  })

  it('round-trips a minimal interaction row (全部可空列缺省)', () => {
    h = openReportingHarness()
    const { record } = h.service.registerInteraction({ kind: 'OTHER', title: '便签', occurredAt: T0 })
    expect(record.participants).toBeUndefined()
    expect(record.notes).toBeUndefined()
    expect(record.related_workstreams).toBeUndefined()
    const reread = h.service.getInteraction(record.id)
    expect(reread).toEqual(record)
    const row = qGet(h.rawDb, `SELECT * FROM ${INTERACTION_TABLE} WHERE id = ?`, record.id)
    expect(row!.participants).toBeNull()
    expect(row!.notes).toBeNull()
    expect(row!.related_workstreams).toBeNull()
  })

  it('round-trips a reporting_item row (material_refs JSON + 状态列)', () => {
    h = openReportingHarness()
    const record = h.service.createReportingItem({
      audience: '导师',
      statement: '本周实验进展',
      materialRefs: [{ kind: 'ARTIFACT', id: 'A-1' }],
    })
    expect(record.status).toBe('OPEN')
    expect(record.reported_at).toBeUndefined()
    const reread = h.service.getReportingItem(record.id)
    expect(reread).toEqual(record)
    expect(reread!.material_refs).toEqual([{ kind: 'ARTIFACT', id: 'A-1' }])
  })

  it('round-trips ONCE + RECURRING scheduled_event rows (schedule JSON 联合)', () => {
    h = openReportingHarness()
    const once = h.service.createScheduledEvent({
      title: '组会汇报',
      schedule: { kind: 'ONCE', at: T0 + 86_400_000 },
      reminderLeadMs: 3_600_000,
    })
    const recurring = h.service.createScheduledEvent({
      title: '月度进展',
      schedule: { kind: 'RECURRING', freq: 'MONTHLY', interval: 2, until: T0 + 86_400_000 * 60 },
    })
    expect(h.service.getScheduledEvent(once.id)).toEqual(once)
    const reread = h.service.getScheduledEvent(recurring.id)
    expect(reread).toEqual(recurring)
    expect(reread!.schedule).toEqual({ kind: 'RECURRING', freq: 'MONTHLY', interval: 2, until: T0 + 86_400_000 * 60 })
  })

  it('normalizes RECURRING interval default 1 into the schedule cell', () => {
    h = openReportingHarness()
    const rec = h.service.createScheduledEvent({ title: '日报', schedule: { kind: 'RECURRING', freq: 'DAILY' } })
    const row = qGet(h.rawDb, `SELECT schedule FROM ${SCHEDULED_EVENT_TABLE} WHERE id = ?`, rec.id)
    const cell = JSON.parse(String(row!.schedule)) as { interval?: number }
    expect(cell.interval).toBe(1)
  })
})

describe('storage-layer invariants (trigger 级, 任何连接)', () => {
  let h: ReportingHarness
  afterEach(() => h?.close())

  it('ABORTS raw DELETE on all three tables (INV-HIST-7)', () => {
    h = openReportingHarness()
    const iv = h.service.registerInteraction({ kind: 'OTHER', title: 'x', occurredAt: T0 }).record
    const rpt = h.service.createReportingItem({ audience: 'a', statement: 's' })
    const sev = h.service.createScheduledEvent({ title: 't', schedule: { kind: 'ONCE', at: T0 } })
    expect(() => h.rawDb.prepare(`DELETE FROM ${INTERACTION_TABLE} WHERE id = ?`).run(iv.id)).toThrow(/never deleted/)
    expect(() => h.rawDb.prepare(`DELETE FROM ${REPORTING_ITEM_TABLE} WHERE id = ?`).run(rpt.id)).toThrow(/never deleted/)
    expect(() => h.rawDb.prepare(`DELETE FROM ${SCHEDULED_EVENT_TABLE} WHERE id = ?`).run(sev.id)).toThrow(/never deleted/)
    // 行仍在 (ABORT 不是删除成功)。
    expect(count(qGet(h.rawDb, `SELECT COUNT(*) AS n FROM ${INTERACTION_TABLE} WHERE id = ?`, iv.id))).toBe(1)
  })

  it('ABORTS any content UPDATE on interaction / scheduled_event (无状态列 ⇒ 整体不可变)', () => {
    h = openReportingHarness()
    const iv = h.service.registerInteraction({ kind: 'OTHER', title: 'x', occurredAt: T0 }).record
    const sev = h.service.createScheduledEvent({ title: 't', schedule: { kind: 'ONCE', at: T0 } }).id
    expect(() => h.rawDb.prepare(`UPDATE ${INTERACTION_TABLE} SET title = 'hacked' WHERE id = ?`).run(iv.id)).toThrow(/immutable/)
    expect(() => h.rawDb.prepare(`UPDATE ${INTERACTION_TABLE} SET participants = '["intruder"]' WHERE id = ?`).run(iv.id)).toThrow(/immutable/)
    expect(() => h.rawDb.prepare(`UPDATE ${SCHEDULED_EVENT_TABLE} SET title = 'hacked' WHERE id = ?`).run(sev)).toThrow(/immutable/)
    expect(() => h.rawDb.prepare(`UPDATE ${SCHEDULED_EVENT_TABLE} SET reminder_lead_ms = 0 WHERE id = ?`).run(sev)).toThrow(/immutable/)
  })

  it('ABORTS content UPDATE on reporting_item but ALLOWS the state-cache columns (status/reported_at)', () => {
    h = openReportingHarness()
    const rpt = h.service.createReportingItem({ audience: 'a', statement: 's' })
    expect(() => h.rawDb.prepare(`UPDATE ${REPORTING_ITEM_TABLE} SET audience = 'hacked' WHERE id = ?`).run(rpt.id)).toThrow(/immutable/)
    expect(() => h.rawDb.prepare(`UPDATE ${REPORTING_ITEM_TABLE} SET statement = 'hacked' WHERE id = ?`).run(rpt.id)).toThrow(/immutable/)
    expect(() => h.rawDb.prepare(`UPDATE ${REPORTING_ITEM_TABLE} SET created_at = 0 WHERE id = ?`).run(rpt.id)).toThrow(/immutable/)
    // 状态缓存列 = 合法 UPDATE 面 (§13 行侧机制)。
    h.rawDb.prepare(`UPDATE ${REPORTING_ITEM_TABLE} SET status = 'MATERIAL_READY', reported_at = NULL WHERE id = ?`).run(rpt.id)
    expect(String(qGet(h.rawDb, `SELECT status FROM ${REPORTING_ITEM_TABLE} WHERE id = ?`, rpt.id)!.status)).toBe('MATERIAL_READY')
  })

  it('rejects off-vocabulary enum cells at the CHECK level (任何连接)', () => {
    h = openReportingHarness()
    expect(() =>
      h.rawDb.exec(
        `INSERT INTO ${INTERACTION_TABLE} (id, kind, title, occurred_at) VALUES ('INT-999', 'HACKED', 'x', ${T0})`,
      ),
    ).toThrow(/CHECK/)
    expect(() =>
      h.rawDb.exec(
        `INSERT INTO ${REPORTING_ITEM_TABLE} (id, audience, statement, status, created_at) VALUES ('RPT-999', 'a', 's', 'BROKEN', ${T0})`,
      ),
    ).toThrow(/CHECK/)
    expect(() =>
      h.rawDb.exec(
        `INSERT INTO ${SCHEDULED_EVENT_TABLE} (id, title, schedule, reminder_lead_ms) VALUES ('SEV-999', 't', '{"kind":"ONCE","at":${T0}}', -1)`,
      ),
    ).toThrow(/CHECK/)
  })
})

describe('id allocation (reserve/commit/release, §1.1 规则 2)', () => {
  let h: ReportingHarness
  afterEach(() => h?.close())

  it('allocates monotonically per family and per object kind (INT/RPT/SEV 独立计数器)', () => {
    h = openReportingHarness()
    expect(h.service.registerInteraction({ kind: 'OTHER', title: '1', occurredAt: T0 }).record.id).toBe('INT-1')
    expect(h.service.createReportingItem({ audience: 'a', statement: 's' }).id).toBe('RPT-1')
    expect(h.service.createScheduledEvent({ title: 't', schedule: { kind: 'ONCE', at: T0 } }).id).toBe('SEV-1')
    expect(h.service.registerInteraction({ kind: 'OTHER', title: '2', occurredAt: T0 }).record.id).toBe('INT-2')
  })

  it('leaves a gap (never reuses) when the write fails after reservation', () => {
    h = openReportingHarness()
    // 预占 INT-1/INT-2; 第二条失败 (raw INSERT 冲突模拟: 预先 raw 插入同 id)。
    h.service.registerInteraction({ kind: 'OTHER', title: '1', occurredAt: T0 })
    h.rawDb.exec(`INSERT INTO ${INTERACTION_TABLE} (id, kind, title, occurred_at) VALUES ('INT-2', 'OTHER', '预占', ${T0})`)
    // 驱动失败 = REPORTING_STORE (结构化 code — 消息为驱动原文)。
    try {
      h.service.registerInteraction({ kind: 'OTHER', title: '2', occurredAt: T0 })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ReportingError)
      expect((e as ReportingError).code).toBe('REPORTING_STORE')
      expect((e as Error).message).toContain('UNIQUE constraint failed')
    }
    // INT-2 烧掉留 gap; 下一个 = INT-3 (不复用)。
    expect(h.service.registerInteraction({ kind: 'OTHER', title: '3', occurredAt: T0 }).record.id).toBe('INT-3')
  })
})

describe('validation (边界失败大声 — 冻结形状)', () => {
  let h: ReportingHarness
  afterEach(() => h?.close())

  it('registerInteraction: bad kind / empty title / bad epoch / bad ws id', () => {
    h = openReportingHarness()
    expect(() => h.service.registerInteraction({ kind: 'HACKED' as never, title: 'x', occurredAt: T0 })).toThrow(/InteractionKind/)
    expect(() => h.service.registerInteraction({ kind: 'OTHER', title: '  ', occurredAt: T0 })).not.toThrow() // 非空即合法 (trim 归调用方)
    expect(() => h.service.registerInteraction({ kind: 'OTHER', title: '', occurredAt: T0 })).toThrow(/title/)
    expect(() => h.service.registerInteraction({ kind: 'OTHER', title: 'x', occurredAt: -1 })).toThrow(/occurredAt/)
    expect(() => h.service.registerInteraction({ kind: 'OTHER', title: 'x', occurredAt: T0, relatedWorkstreams: ['WS-0'] })).toThrow(/well-formed WS id/)
    expect(() => h.service.registerInteraction({ kind: 'OTHER', title: 'x', occurredAt: T0, participants: ['a', ''] })).toThrow(/participants/)
  })

  it('createReportingItem: empty audience/statement; occasion_ref 写入时存在性校验 (§16 规则 3/4)', () => {
    h = openReportingHarness()
    expect(() => h.service.createReportingItem({ audience: '', statement: 's' })).toThrow(/audience/)
    expect(() => h.service.createReportingItem({ audience: 'a', statement: '' })).toThrow(/statement/)
    expect(() => h.service.createReportingItem({ audience: 'a', statement: 's', occasionRef: 'SEV-1' })).toThrow(/does not reference an existing/)
    const sev = h.service.createScheduledEvent({ title: '组会', schedule: { kind: 'ONCE', at: T0 } })
    const ok = h.service.createReportingItem({ audience: '组会', statement: '汇报', occasionRef: sev.id })
    expect(ok.occasion_ref).toBe(sev.id)
  })

  it('createScheduledEvent: bad schedule / bad freq / bad interval / bad related_refs kind', () => {
    h = openReportingHarness()
    expect(() => h.service.createScheduledEvent({ title: 't', schedule: { kind: 'HACKED' } as unknown as SevSchedule })).toThrow(/'ONCE' or 'RECURRING'/)
    expect(() => h.service.createScheduledEvent({ title: 't', schedule: { kind: 'RECURRING', freq: 'HOURLY' as never } })).toThrow(/freq/)
    expect(() => h.service.createScheduledEvent({ title: 't', schedule: { kind: 'RECURRING', freq: 'WEEKLY', interval: 0 } })).toThrow(/interval/)
    expect(() => h.service.createScheduledEvent({ title: 't', schedule: { kind: 'ONCE', at: -5 } })).toThrow(/at/)
    expect(() =>
      h.service.createScheduledEvent({ title: 't', schedule: { kind: 'ONCE', at: T0 }, relatedRefs: [{ kind: 'TASK', id: 'T-1' }] }),
    ).toThrow(/REPORTING_ITEM \| INTERVENTION \| TOPIC/)
    expect(() =>
      h.service.createScheduledEvent({ title: 't', schedule: { kind: 'ONCE', at: T0 }, relatedRefs: [{ kind: 'REPORTING_ITEM', id: 'RPT-1' }] }),
    ).toThrow(/does not reference an existing reporting item/)
    expect(() =>
      h.service.createScheduledEvent({ title: 't', schedule: { kind: 'ONCE', at: T0 }, relatedRefs: [{ kind: 'INTERVENTION', id: 'IV-1' }] }),
    ).toThrow(/does not reference an existing intervention/)
    expect(() =>
      h.service.createScheduledEvent({ title: 't', schedule: { kind: 'ONCE', at: T0 }, reminderLeadMs: -1 }),
    ).toThrow(/reminderLeadMs/)
  })

  it('listScheduledEvents: inverted window rejected', () => {
    h = openReportingHarness()
    expect(() => h.service.listScheduledEvents({ from: T0 + 10, to: T0 })).toThrow(/inverted/)
    expect(() => h.service.listInteractions({ from: T0 + 10, to: T0 })).toThrow(/inverted/)
  })
})
