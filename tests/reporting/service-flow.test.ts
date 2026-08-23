/**
 * WP-5.3 — 三对象全流 (service 层, 真实 research.sqlite):
 *  - Interaction: 登记 + 查询面 (kind / workstream 包含 / 时间窗过滤);
 *  - ReportingItem: §13 状态机全矩阵 (25 组合逐一钉死) + reported_at
 *    共现语义 (首次 REPORTED 写入, FOLLOW_UP_REQUIRED 保留) + 乐观并发
 *    门 (raw 并发迁移 ⇒ RPT_WRONG_STATE 判别) + 查询面过滤;
 *  - ScheduledEvent: V1 到期语义 (查询面时间窗过滤 — schedule.ts:
 *    ONCE → at ∈ 窗口; RECURRING → 活跃跨度 (−∞, until] 与窗口相交;
 *    无调度器/提醒推送) + 时间轴排序 (scheduleSortKey, id 破平)。
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  RPT_LEGAL_TRANSITIONS,
  RPT_STATUSES,
  ReportingError,
  type RptStatus,
} from '../../src/host/service/reporting/index.js'
import { REPORTING_ITEM_TABLE } from '../../src/host/service/reporting/index.js'
import { openReportingHarness, qGet, T0, type ReportingHarness } from './helpers.js'

const DAY = 86_400_000

/* ==================================================================== *
 * Interaction 全流
 * ==================================================================== */

describe('Interaction 全流 (登记 + 查询面)', () => {
  let h: ReportingHarness
  afterEach(() => h?.close())

  it('registers + lists with kind filter', () => {
    h = openReportingHarness()
    h.service.registerInteraction({ kind: 'MEETING', title: '周会', occurredAt: T0 })
    h.service.registerInteraction({ kind: 'SUPERVISOR_UPDATE', title: '导师汇报', occurredAt: T0 + 1_000 })
    expect(h.service.listInteractions({ kind: 'MEETING' })).toHaveLength(1)
    expect(h.service.listInteractions({ kind: 'MEETING' })[0]!.title).toBe('周会')
    expect(h.service.listInteractions()).toHaveLength(2)
  })

  it('lists with workstream containment filter (JSON 数组包含匹配)', () => {
    h = openReportingHarness()
    h.service.registerInteraction({ kind: 'MEETING', title: 'A', occurredAt: T0, relatedWorkstreams: ['WS-1'] })
    h.service.registerInteraction({ kind: 'MEETING', title: 'B', occurredAt: T0 + 1, relatedWorkstreams: ['WS-2', 'WS-10'] })
    h.service.registerInteraction({ kind: 'MEETING', title: 'C', occurredAt: T0 + 2 })
    const ws1 = h.service.listInteractions({ workstreamId: 'WS-1' })
    expect(ws1.map((r) => r.title)).toEqual(['A'])
    // WS-1 不是 WS-10 的前缀匹配 (引号包裹 = 精确元素)。
    expect(h.service.listInteractions({ workstreamId: 'WS-10' }).map((r) => r.title)).toEqual(['B'])
  })

  it('lists with occurred_at window (两端闭)', () => {
    h = openReportingHarness()
    h.service.registerInteraction({ kind: 'OTHER', title: 'early', occurredAt: T0 })
    h.service.registerInteraction({ kind: 'OTHER', title: 'mid', occurredAt: T0 + 5_000 })
    h.service.registerInteraction({ kind: 'OTHER', title: 'late', occurredAt: T0 + 10_000 })
    const window = h.service.listInteractions({ from: T0 + 1_000, to: T0 + 5_000 })
    expect(window.map((r) => r.title)).toEqual(['mid']) // 边界 at == to 命中 (闭区间)
  })

  it('orders by occurred_at ASC, id ASC (stable)', () => {
    h = openReportingHarness()
    h.service.registerInteraction({ kind: 'OTHER', title: 'second', occurredAt: T0 + 2_000 })
    h.service.registerInteraction({ kind: 'OTHER', title: 'first', occurredAt: T0 })
    h.service.registerInteraction({ kind: 'OTHER', title: 'same-time-later-id', occurredAt: T0 })
    expect(h.service.listInteractions().map((r) => r.title)).toEqual(['first', 'same-time-later-id', 'second'])
  })
})

/* ==================================================================== *
 * ReportingItem 全流 (§13 状态机 + reported_at 共现 + 并发门)
 * ==================================================================== */

describe('ReportingItem §13 状态机全矩阵 (25 组合)', () => {
  let h: ReportingHarness
  afterEach(() => h?.close())

  function makeItem(audience = '导师'): string {
    return h.service.createReportingItem({ audience, statement: 'x' }).id
  }

  it('legal transitions succeed; illegal ones reject with the legal set (INV-TASK-1)', () => {
    h = openReportingHarness()
    // 先走到 from 状态的合法路径 (新条目恒 OPEN 起步)。
    const walkTo: Record<RptStatus, readonly RptStatus[]> = {
      OPEN: [],
      MATERIAL_READY: ['MATERIAL_READY'],
      READY_TO_REPORT: ['MATERIAL_READY', 'READY_TO_REPORT'],
      REPORTED: ['MATERIAL_READY', 'READY_TO_REPORT', 'REPORTED'],
      FOLLOW_UP_REQUIRED: ['MATERIAL_READY', 'READY_TO_REPORT', 'REPORTED', 'FOLLOW_UP_REQUIRED'],
    }
    for (const from of RPT_STATUSES) {
      for (const to of RPT_STATUSES) {
        const id = h.service.createReportingItem({ audience: `${from}→${to}`, statement: 'x' }).id
        for (const step of walkTo[from]) {
          h.service.transitionReportingItem(id, step)
        }
        const legal = RPT_LEGAL_TRANSITIONS[from].includes(to)
        if (legal) {
          const updated = h.service.transitionReportingItem(id, to)
          expect(updated.status).toBe(to)
        } else {
          let caught: unknown
          try {
            h.service.transitionReportingItem(id, to)
          } catch (e) {
            caught = e
          }
          expect(caught).toBeInstanceOf(ReportingError)
          expect((caught as ReportingError).code).toBe('RPT_WRONG_STATE')
          // 消息携带合法集 (诊断面)。
          expect((caught as Error).message).toContain(`legal from ${from}`)
          // 非法迁移零副作用。
          expect(h.service.getReportingItem(id)!.status).toBe(from)
        }
      }
    }
  })

  it('the full legal walk OPEN → MATERIAL_READY → READY_TO_REPORT → REPORTED → FOLLOW_UP_REQUIRED → READY_TO_REPORT', () => {
    h = openReportingHarness()
    const id = makeItem()
    expect(h.service.transitionReportingItem(id, 'MATERIAL_READY').status).toBe('MATERIAL_READY')
    expect(h.service.transitionReportingItem(id, 'READY_TO_REPORT').status).toBe('READY_TO_REPORT')
    expect(h.service.transitionReportingItem(id, 'REPORTED').status).toBe('REPORTED')
    expect(h.service.transitionReportingItem(id, 'FOLLOW_UP_REQUIRED').status).toBe('FOLLOW_UP_REQUIRED')
    expect(h.service.transitionReportingItem(id, 'READY_TO_REPORT').status).toBe('READY_TO_REPORT')
    // 无终态: 第二轮汇报。
    expect(h.service.transitionReportingItem(id, 'REPORTED').status).toBe('REPORTED')
  })

  it('reported_at 共现: 首次 REPORTED 写入, 回退/跟进保留 (历史事实列)', () => {
    h = openReportingHarness()
    const id = makeItem()
    const t1 = h.service.transitionReportingItem(id, 'MATERIAL_READY')
    expect(t1.reported_at).toBeUndefined()
    h.service.transitionReportingItem(id, 'READY_TO_REPORT')
    const rep = h.service.transitionReportingItem(id, 'REPORTED')
    expect(rep.reported_at).toBeTypeOf('number')
    const followUp = h.service.transitionReportingItem(id, 'FOLLOW_UP_REQUIRED')
    expect(followUp.reported_at).toBe(rep.reported_at) // 保留, 不清空
    h.service.transitionReportingItem(id, 'READY_TO_REPORT')
    const rep2 = h.service.transitionReportingItem(id, 'REPORTED')
    expect(rep2.reported_at).toBe(rep.reported_at) // 首次时间不变
  })

  it('乐观并发门: 并发迁移先行 ⇒ RPT_WRONG_STATE (重读判别), 非 NOT_FOUND', () => {
    h = openReportingHarness()
    const id = makeItem()
    // 模拟并发: service 读行后, raw 连接先行完成一次合法迁移 (OPEN → MATERIAL_READY)。
    const serviceBefore = h.service.getReportingItem(id)!.status
    h.rawDb.prepare(`UPDATE ${REPORTING_ITEM_TABLE} SET status = 'MATERIAL_READY' WHERE id = ? AND status = ?`).run(id, serviceBefore)
    expect(() => h.service.transitionReportingItem(id, 'MATERIAL_READY')).toThrow(ReportingError)
    try {
      h.service.transitionReportingItem(id, 'MATERIAL_READY')
      expect.unreachable()
    } catch (e) {
      expect((e as ReportingError).code).toBe('RPT_WRONG_STATE')
    }
  })

  it('missing id ⇒ RPT_NOT_FOUND', () => {
    h = openReportingHarness()
    try {
      h.service.transitionReportingItem('RPT-404', 'MATERIAL_READY')
      expect.unreachable()
    } catch (e) {
      expect((e as ReportingError).code).toBe('RPT_NOT_FOUND')
    }
  })

  it('lists with status / occasionRef / audience filters', () => {
    h = openReportingHarness()
    const sev = h.service.createScheduledEvent({ title: '组会', schedule: { kind: 'ONCE', at: T0 + DAY } })
    const a = h.service.createReportingItem({ audience: '导师', statement: 's1', occasionRef: sev.id })
    const b = h.service.createReportingItem({ audience: '组会', statement: 's2' })
    h.service.transitionReportingItem(a.id, 'MATERIAL_READY')
    expect(h.service.listReportingItems({ status: 'OPEN' }).map((r) => r.id)).toEqual([b.id])
    expect(h.service.listReportingItems({ status: 'MATERIAL_READY' }).map((r) => r.id)).toEqual([a.id])
    expect(h.service.listReportingItems({ occasionRef: sev.id }).map((r) => r.id)).toEqual([a.id])
    expect(h.service.listReportingItems({ audience: '组会' }).map((r) => r.id)).toEqual([b.id])
  })
})

/* ==================================================================== *
 * ScheduledEvent 全流 (V1 到期语义 = 查询面时间窗过滤)
 * ==================================================================== */

describe('ScheduledEvent V1 时间窗语义 (无调度器/提醒推送)', () => {
  let h: ReportingHarness
  afterEach(() => h?.close())

  it('ONCE: at ∈ [from, to] 两端闭; 窗口外排除', () => {
    h = openReportingHarness()
    const in1 = h.service.createScheduledEvent({ title: 'at-from', schedule: { kind: 'ONCE', at: T0 } })
    const in2 = h.service.createScheduledEvent({ title: 'at-to', schedule: { kind: 'ONCE', at: T0 + DAY } })
    const out = h.service.createScheduledEvent({ title: 'past', schedule: { kind: 'ONCE', at: T0 - DAY } })
    const window = { from: T0, to: T0 + DAY }
    const hits = h.service.listScheduledEvents(window)
    expect(hits.map((r) => r.id)).toEqual([in1.id, in2.id]) // 排序: at ASC
    expect(hits.every((r) => r.id !== out.id)).toBe(true)
  })

  it('RECURRING: 活跃跨度 (−∞, until] 与窗口相交 — until 在窗口内/边界命中, 之前排除; 无 until 恒命中', () => {
    h = openReportingHarness()
    const untilIn = h.service.createScheduledEvent({
      title: 'until-in-window',
      schedule: { kind: 'RECURRING', freq: 'WEEKLY', until: T0 + DAY },
    })
    const untilBefore = h.service.createScheduledEvent({
      title: 'until-before-window',
      schedule: { kind: 'RECURRING', freq: 'WEEKLY', until: T0 - DAY },
    })
    const openEnded = h.service.createScheduledEvent({ title: 'open-ended', schedule: { kind: 'RECURRING', freq: 'MONTHLY', interval: 2 } })
    const window = { from: T0, to: T0 + 30 * DAY }
    const hits = h.service.listScheduledEvents(window).map((r) => r.id)
    expect(hits).toContain(untilIn.id)
    expect(hits).toContain(openEnded.id)
    expect(hits).not.toContain(untilBefore.id)
    // 无 to (右开 +∞): 同上, until ≥ from 即命中。
    expect(h.service.listScheduledEvents({ from: T0 }).map((r) => r.id)).toEqual(expect.arrayContaining([untilIn.id, openEnded.id]))
  })

  it('时间轴排序: ONCE → at; RECURRING → until / 尾部 (活跃中最后), id 破平', () => {
    h = openReportingHarness()
    const openEnded = h.service.createScheduledEvent({ title: 'open', schedule: { kind: 'RECURRING', freq: 'DAILY' } })
    const laterOnce = h.service.createScheduledEvent({ title: 'later-once', schedule: { kind: 'ONCE', at: T0 + 10 * DAY } })
    const recUntilMid = h.service.createScheduledEvent({ title: 'rec-until-mid', schedule: { kind: 'RECURRING', freq: 'WEEKLY', until: T0 + 5 * DAY } })
    const earlyOnce = h.service.createScheduledEvent({ title: 'early-once', schedule: { kind: 'ONCE', at: T0 + DAY } })
    const order = h.service.listScheduledEvents({ from: T0 }).map((r) => r.title)
    expect(order).toEqual(['early-once', 'rec-until-mid', 'later-once', 'open'])
  })

  it('reminder_lead_ms 只落库 + 展示 (无推送): 值持久化且行不变性不受影响', () => {
    h = openReportingHarness()
    const rec = h.service.createScheduledEvent({
      title: '有提醒',
      schedule: { kind: 'ONCE', at: T0 + DAY },
      reminderLeadMs: 3_600_000,
    })
    expect(h.service.getScheduledEvent(rec.id)!.reminder_lead_ms).toBe(3_600_000)
    const cell = qGet(h.rawDb, `SELECT reminder_lead_ms FROM scheduled_event WHERE id = ?`, rec.id)
    expect(Number(cell!.reminder_lead_ms)).toBe(3_600_000)
  })

  it('related_refs: RPT/IV 存在性校验 + TPC 形状校验; 合法组合落库往返', () => {
    h = openReportingHarness()
    const rpt = h.service.createReportingItem({ audience: 'a', statement: 's' })
    // intervention 表 (flooding DDL) — 模拟已存在的 IV 行 (同库先例)。
    h.rawDb.exec(`CREATE TABLE IF NOT EXISTS intervention (
      id TEXT NOT NULL PRIMARY KEY, title TEXT NOT NULL, detail TEXT,
      origin TEXT NOT NULL CHECK (origin IN ('USER', 'AGENT_REPORT', 'AUTO_FLOODING', 'AUTO_AUDIT')),
      workstream_ids TEXT NOT NULL, source_refs TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('OPEN', 'PENDING', 'CLOSED')),
      created_by TEXT NOT NULL, created_at INTEGER NOT NULL, closed_at INTEGER, resolution_note TEXT)`)
    h.rawDb.exec(`INSERT INTO intervention (id, title, origin, workstream_ids, source_refs, status, created_by, created_at)
      VALUES ('IV-1', 't', 'USER', '[]', '[]', 'OPEN', '{"kind":"USER"}', ${T0})`)
    const rec = h.service.createScheduledEvent({
      title: '关联齐备',
      schedule: { kind: 'ONCE', at: T0 + DAY },
      relatedRefs: [
        { kind: 'REPORTING_ITEM', id: rpt.id },
        { kind: 'INTERVENTION', id: 'IV-1' },
        { kind: 'TOPIC', id: 'TPC-1' },
      ],
    })
    expect(h.service.getScheduledEvent(rec.id)!.related_refs).toEqual([
      { kind: 'REPORTING_ITEM', id: rpt.id },
      { kind: 'INTERVENTION', id: 'IV-1' },
      { kind: 'TOPIC', id: 'TPC-1' },
    ])
  })
})

/** The RptStatus export re-used by the matrix test (type surface). */
export type { RptStatus }
