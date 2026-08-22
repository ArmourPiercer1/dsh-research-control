/**
 * WP-3.5 — `intervention` 表持久化（真实 research.sqlite; DatabaseSync
 * 封装模式端到端 — 同 tests/planfork/persist.test.ts 纪律）。
 *
 * 覆盖: DDL 落地（§15 表/索引/trigger）/ 幂等 / 行↔记录往返 / 查询面 /
 * 冻结形状网 / 存储层不变量（no-DELETE、内容不可变、状态缓存列面）/
 * API 面无 delete 无迁移（INV-HIST-7 / INV-PERM-4）。
 */

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  INTERVENTION_TABLE,
  buildAutoFloodingIntervention,
  interventionDdl,
  loadInterventionSchemas,
  type InterventionRecord,
} from '../../src/host/service/flooding/index.js'
import { T_CREATE } from '../planfork/fixtures.js'
import {
  MEM_OPERATIONAL_SCHEMA_DIR,
  realOperationalSchemaFiles,
} from '../planfork/fixtures.js'
import { MemoryReader } from '../loader/memory-reader.js'
import { adaptDatabaseSync, makeTempDir, openFloodingDatabase, simulateUserClose } from './fixtures.js'
import { InterventionStore, type FloodingEvidence } from '../../src/host/service/flooding/index.js'

const T0 = T_CREATE + 7000

const EVIDENCE: FloodingEvidence = {
  workstream_id: 'WS-1',
  window: { kind: 'OPEN_STATE', as_of: T0, open_pf_ids: ['PF-11', 'PF-12', 'PF-13', 'PF-14', 'PF-15', 'PF-16'] },
  count: 6,
  threshold: 5,
  rule: 'count(status == OPEN, per workstream) > threshold',
}

function makeRecord(id: string, patch: Partial<InterventionRecord> = {}, created_at: number = T0): InterventionRecord {
  return {
    ...buildAutoFloodingIntervention({ id, evidence: EVIDENCE, createdAt: T0 }),
    created_at,
    ...patch,
  }
}

function makeSchemas() {
  const schemas = loadInterventionSchemas(new MemoryReader(realOperationalSchemaFiles()), MEM_OPERATIONAL_SCHEMA_DIR)
  if (!schemas.isUsable) throw new Error('schemas unavailable in test setup')
  return schemas
}

describe('intervention 表持久化（真实 research.sqlite）', () => {
  let pair: ReturnType<typeof openFloodingDatabase>
  let raw: DatabaseSync
  let store: InterventionStore

  afterAll(() => {
    try {
      raw?.close()
    } catch {
      /* already closed */
    }
    pair?.close()
  })

  beforeAll(() => {
    pair = openFloodingDatabase(join(makeTempDir(), 'research.sqlite'))
    raw = new DatabaseSync(pair.store.path)
    raw.exec('PRAGMA busy_timeout = 5000')
    store = new InterventionStore({ db: pair.db, schemas: makeSchemas() })
  })

  it('DDL 落在 WP-2.1 核心三表之上（§15 表 + 索引 + 两 trigger）', () => {
    const tables = raw
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all()
      .map((r) => String(r.name))
    // 核心三表（WP-2.1）+ 本 WP intervention 表。
    expect(tables).toEqual(['derived_state', 'history_event', 'intervention', 'meta'].sort())
    const index = raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_intervention_status'`).get()
    expect(index).toBeDefined()
    const triggers = raw
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`)
      .all()
      .map((r) => String(r.name))
    // 本 WP 两 trigger + WP-2.1 history_event 两 trigger（同库共存）。
    expect(triggers).toEqual(['history_event_no_delete', 'history_event_no_update', 'intervention_no_content_update', 'intervention_no_delete'])
  })

  it('DDL 幂等: 第三连接重放（第二 InterventionStore）干净', () => {
    const raw2 = new DatabaseSync(pair.store.path)
    raw2.exec('PRAGMA busy_timeout = 5000')
    expect(() => {
      raw2.exec(interventionDdl())
      const store2 = new InterventionStore({ db: adaptDatabaseSync(raw2), schemas: makeSchemas() })
      expect(store2.getIntervention('IV-none')).toBeNull()
    }).not.toThrow()
    raw2.close()
  })

  it('insertIntervention → 往返逐字（含 JSON 列解码）', () => {
    const record = makeRecord('IV-1')
    expect(store.insertIntervention(record)).toBe(record)
    const back = store.getIntervention('IV-1')
    expect(back).toEqual(record)
    expect(back!.source_refs).toEqual(EVIDENCE.window.open_pf_ids.map((id) => ({ kind: 'PLAN_FORK', id })))
    expect(store.getIntervention('IV-2')).toBeNull()
  })

  it('CLOSED 记录往返（closed_at/resolution_note 可选 — 无共现 CHECK, §9.2 未规定必填）', () => {
    const closed = makeRecord('IV-2', { status: 'CLOSED', closed_at: T0 + 100, resolution_note: '已审阅' }, T0 + 50)
    store.insertIntervention(closed)
    expect(store.getIntervention('IV-2')).toEqual(closed)
  })

  it('查询面: status/origin/workstream 过滤 + 组合 + 稳定顺序', () => {
    // 再加两行: WS-2 的 AUTO_FLOODING（不同 created_at 验证顺序）+ PENDING 行。
    store.insertIntervention(makeRecord('IV-3', { workstream_ids: ['WS-2'], detail: 'ws2' }, T0 + 200))
    store.insertIntervention(makeRecord('IV-4', { status: 'PENDING', workstream_ids: ['WS-1'] }, T0 + 300))

    expect(store.listInterventions().map((r) => r.id)).toEqual(['IV-1', 'IV-2', 'IV-3', 'IV-4']) // created_at ASC
    expect(store.listInterventions({ status: 'OPEN' }).map((r) => r.id)).toEqual(['IV-1', 'IV-3'])
    expect(store.listInterventions({ status: 'CLOSED' }).map((r) => r.id)).toEqual(['IV-2'])
    expect(store.listInterventions({ origin: 'AUTO_FLOODING' }).map((r) => r.id)).toEqual(['IV-1', 'IV-2', 'IV-3', 'IV-4']) // 全部四行 origin=AUTO_FLOODING
    expect(store.listInterventions({ workstreamId: 'WS-1' }).map((r) => r.id)).toEqual(['IV-1', 'IV-2', 'IV-4'])
    expect(store.listInterventions({ workstreamId: 'WS-2' }).map((r) => r.id)).toEqual(['IV-3'])
    expect(store.listInterventions({ workstreamId: 'WS-3' }).map((r) => r.id)).toEqual([])
    expect(store.listInterventions({ status: 'OPEN', workstreamId: 'WS-2' }).map((r) => r.id)).toEqual(['IV-3'])
    expect(() => store.listInterventions({ status: 'BOGUS' as never })).toThrow(/status/)
    expect(() => store.listInterventions({ origin: 'BOGUS' as never })).toThrow(/origin/)
    expect(() => store.getIntervention('')).toThrow(/id/)
  })

  it('findOpenAutoFlooding: 抑制探针（WS 精确 + 只认 OPEN + AUTO_FLOODING）', () => {
    expect(store.findOpenAutoFlooding('WS-1')?.id).toBe('IV-1')
    expect(store.findOpenAutoFlooding('WS-2')?.id).toBe('IV-3')
    expect(store.findOpenAutoFlooding('WS-3')).toBeNull()
    // PENDING 的 IV-4 不算（探针只认 OPEN）— WS-1 仍是 IV-1。
    expect(store.findOpenAutoFlooding('WS-1')?.id).toBe('IV-1')
  })

  it('存储层不变量: raw DELETE ABORT（INV-HIST-7, 任何连接）', () => {
    expect(() => raw.prepare(`DELETE FROM ${INTERVENTION_TABLE} WHERE id = 'IV-1'`).run()).toThrow(/never deleted/)
    expect(store.getIntervention('IV-1')).not.toBeNull()
  })

  it('存储层不变量: 内容列 raw UPDATE ABORT（title/detail/origin/created_at）', () => {
    expect(() => raw.prepare(`UPDATE ${INTERVENTION_TABLE} SET title = 'x' WHERE id = 'IV-1'`).run()).toThrow(/immutable/)
    expect(() => raw.prepare(`UPDATE ${INTERVENTION_TABLE} SET detail = 'x' WHERE id = 'IV-1'`).run()).toThrow(/immutable/)
    expect(() => raw.prepare(`UPDATE ${INTERVENTION_TABLE} SET origin = 'USER' WHERE id = 'IV-1'`).run()).toThrow(/immutable/)
    expect(() => raw.prepare(`UPDATE ${INTERVENTION_TABLE} SET created_at = 1 WHERE id = 'IV-1'`).run()).toThrow(/immutable/)
    expect(() => raw.prepare(`UPDATE ${INTERVENTION_TABLE} SET workstream_ids = '["WS-9"]' WHERE id = 'IV-1'`).run()).toThrow(/immutable/)
    expect(() => raw.prepare(`UPDATE ${INTERVENTION_TABLE} SET source_refs = '[]' WHERE id = 'IV-1'`).run()).toThrow(/immutable/)
    expect(store.getIntervention('IV-1')!.title).toBe('Review accumulated agent plan forks [WS-1]')
  })

  it('状态缓存列是合法行侧面（未来用户面 WP 的迁移面; 探针随之滑动）', () => {
    simulateUserClose(raw, 'IV-1', T0 + 900)
    expect(store.findOpenAutoFlooding('WS-1')).toBeNull() // IV-1 已 CLOSED — 抑制解除
    const back = store.getIntervention('IV-1')!
    expect(back.status).toBe('CLOSED')
    expect(back.closed_at).toBe(T0 + 900)
    expect(back.title).toBe('Review accumulated agent plan forks [WS-1]') // 内容未动
  })

  it('冻结形状网: 额外键 / 坏 IV id 拒（additionalProperties:false）', () => {
    expect(() => store.insertIntervention({ ...makeRecord('IV-10'), bogus: 1 } as never)).toThrow(/frozen attention schema|bogus/)
    expect(() => store.insertIntervention(makeRecord('IV-0'))).toThrow(/IV id/)
    expect(() => store.insertIntervention({ ...makeRecord('IV-11'), title: '' })).toThrow(/title/)
    expect(() => store.insertIntervention({ ...makeRecord('IV-12'), created_at: -1 })).toThrow(/created_at/)
  })

  it('schema 不可用 ⇒ FLOODING_SCHEMA_UNAVAILABLE（fail loud, 绝不在无 schema 时放行）', () => {
    const empty = loadInterventionSchemas(new MemoryReader({}), '/nowhere')
    const s2 = new InterventionStore({ db: adaptDatabaseSync(raw), schemas: empty })
    expect(() => s2.insertIntervention(makeRecord('IV-20'))).toThrow(/FLOODING_SCHEMA_UNAVAILABLE|schema set unavailable/)
  })

  it('API 面闭集: 无 delete / 无迁移方法（原型键审计 — INV-HIST-7 / INV-PERM-4）', () => {
    const keys = Object.getOwnPropertyNames(InterventionStore.prototype).filter((k) => k !== 'constructor')
    expect([...keys].sort()).toEqual(['close', 'findOpenAutoFlooding', 'getIntervention', 'insertIntervention', 'listInterventions'].sort())
    expect(keys.some((k) => /delete|remove|drop/i.test(k))).toBe(false)
    expect(keys.some((k) => /transition|update|set|move|close_/i.test(k))).toBe(false)
  })

  it('close 后调用面拒（store 生命周期面）', () => {
    const s2 = new InterventionStore({ db: adaptDatabaseSync(raw), schemas: makeSchemas() })
    s2.close()
    expect(() => s2.getIntervention('IV-1')).toThrow(/closed/)
  })
})
