/**
 * WP-5.3 — reporting 工作区 store 切片 (client, 无 DOM):
 *  工厂纪律 (双实例独立, 零模块级句柄) / 快照引用稳定 (引擎语义) /
 *  recordInteraction 幂等去重 / 本地草稿 (loc-<n> 命名空间, 非 §1.1
 *  前缀) / §13 迁移 guard 单一真源 (host 纯模块 — 非法迁移抛
 *  ReportingError RPT_WRONG_STATE) / reportedAt 共现 / V1 时间窗投影
 *  (upcomingEvents = host schedule.ts 同语义) / 记录流排序。
 */

import { parseId } from '../../src/shared/ids/index.js'
import {
  createReportingWorkspace,
  legalRptTransitions,
  orderedInteractionStream,
  upcomingEvents,
  type LocalScheduledEvent,
  type RegisteredInteractionEntry,
} from '../../src/client/stores/reporting-slices.js'
import { ReportingError, RPT_LEGAL_TRANSITIONS, RPT_STATUSES } from '../../src/host/service/reporting/index.js'
import { describe, expect, it } from 'vitest'

const DAY = 86_400_000
const T0 = Date.parse('2026-08-22T09:00:00Z')

function makeInteraction(overrides: Partial<RegisteredInteractionEntry> = {}): RegisteredInteractionEntry {
  return {
    id: 'INT-1',
    kind: 'MEETING',
    title: '周会',
    occurredAt: T0,
    participants: ['张三'],
    notes: null,
    relatedWorkstreams: ['WS-1'],
    createdAt: T0 + 1,
    ...overrides,
  }
}

describe('工厂纪律 (DSH_ADAPTER §6 / WP-4.1b)', () => {
  it('two instances are independent (零模块级句柄)', () => {
    const a = createReportingWorkspace()
    const b = createReportingWorkspace()
    a.recordInteraction(makeInteraction())
    expect(a.getSnapshot().interactions).toHaveLength(1)
    expect(b.getSnapshot().interactions).toHaveLength(0)
  })

  it('snapshot reference is stable until a commit (uSES 语义)', () => {
    const ws = createReportingWorkspace()
    const s1 = ws.getSnapshot()
    expect(ws.getSnapshot()).toBe(s1)
    ws.recordInteraction(makeInteraction())
    const s2 = ws.getSnapshot()
    expect(s2).not.toBe(s1)
    // 幂等追加 (同 id 去重) ⇒ 同引用 (引擎 no-op 语义)。
    ws.recordInteraction(makeInteraction())
    expect(ws.getSnapshot()).toBe(s2)
  })

  it('subscribe notifies exactly on commits; disposer is idempotent', () => {
    const ws = createReportingWorkspace()
    let notifications = 0
    const dispose = ws.subscribe(() => {
      notifications += 1
    })
    ws.recordInteraction(makeInteraction())
    ws.recordInteraction(makeInteraction({ id: 'INT-2', title: '第二条' }))
    ws.recordInteraction(makeInteraction()) // 去重 — 不通知
    expect(notifications).toBe(2)
    dispose()
    dispose()
    ws.recordInteraction(makeInteraction({ id: 'INT-3' }))
    expect(notifications).toBe(2)
  })
})

describe('recordInteraction (生产 RPC 结果 → 记录流)', () => {
  it('appends the wire result verbatim (deep copy — 后续外部变更不泄漏)', () => {
    const ws = createReportingWorkspace()
    const entry = makeInteraction()
    ws.recordInteraction(entry)
    const stored = ws.getSnapshot().interactions[0]!
    expect(stored).toEqual(entry)
    expect(stored).not.toBe(entry)
    // 记录流排序 = occurredAt 降序 (最新在前), id 破平。
    ws.recordInteraction(makeInteraction({ id: 'INT-2', occurredAt: T0 + DAY }))
    ws.recordInteraction(makeInteraction({ id: 'INT-3', occurredAt: T0 - DAY }))
    expect(orderedInteractionStream(ws.getSnapshot().interactions).map((e) => e.id)).toEqual(['INT-2', 'INT-1', 'INT-3'])
  })
})

describe('本地 RPT 草稿 (loc-<n> 命名空间 — 非 §1.1 前缀)', () => {
  it('allocates session-local ids that are NOT host id shapes (parseId 不可解析)', () => {
    const ws = createReportingWorkspace({ now: () => T0 })
    const id1 = ws.addReportingItem({ audience: '导师', statement: '进展' })
    const id2 = ws.addReportingItem({ audience: '组会', statement: '汇报' })
    expect(id1).toBe('loc-1')
    expect(id2).toBe('loc-2')
    expect(parseId(id1)).toBeNull() // 与 host RPT-<n> 命名空间零重叠
    const item = ws.getSnapshot().reportingItems[0]!
    expect(item).toMatchObject({ localId: 'loc-1', audience: '导师', statement: '进展', status: 'OPEN', occasionRef: null, reportedAt: null, createdAt: T0 })
  })

  it('validates inputs (empty audience/statement 拒绝)', () => {
    const ws = createReportingWorkspace()
    expect(() => ws.addReportingItem({ audience: '', statement: 's' })).toThrow(/audience/)
    expect(() => ws.addReportingItem({ audience: 'a', statement: '' })).toThrow(/statement/)
  })

  it('occasionRef 空串折叠为 null (表单 UX)', () => {
    const ws = createReportingWorkspace()
    const id = ws.addReportingItem({ audience: 'a', statement: 's', occasionRef: '   ' })
    expect(ws.getSnapshot().reportingItems.find((i) => i.localId === id)!.occasionRef).toBeNull()
  })
})

describe('本地 RPT §13 迁移 (guard = host 纯模块单一真源)', () => {
  it('legal walk works; reportedAt 首次 REPORTED 写入 (注入时钟)', () => {
    const ws = createReportingWorkspace({ now: () => T0 + 5_000 })
    const id = ws.addReportingItem({ audience: 'a', statement: 's' })
    expect(legalRptTransitions('OPEN')).toEqual(['MATERIAL_READY'])
    ws.transitionReportingItem(id, 'MATERIAL_READY')
    expect(ws.getSnapshot().reportingItems[0]!.status).toBe('MATERIAL_READY')
    ws.transitionReportingItem(id, 'READY_TO_REPORT')
    ws.transitionReportingItem(id, 'REPORTED')
    const item = ws.getSnapshot().reportingItems[0]!
    expect(item.status).toBe('REPORTED')
    expect(item.reportedAt).toBe(T0 + 5_000)
  })

  it('illegal transitions throw ReportingError(RPT_WRONG_STATE) — 同 host 表逐格', () => {
    const ws = createReportingWorkspace()
    const id = ws.addReportingItem({ audience: 'a', statement: 's' })
    // OPEN 的合法边只有 MATERIAL_READY — 其余 4 值全部拒绝。
    for (const to of RPT_STATUSES) {
      if (to === 'MATERIAL_READY') continue
      let caught: unknown
      try {
        ws.transitionReportingItem(id, to)
      } catch (e) {
        caught = e
      }
      expect(caught, `OPEN → ${to}`).toBeInstanceOf(ReportingError)
      expect((caught as ReportingError).code).toBe('RPT_WRONG_STATE')
    }
    expect(ws.getSnapshot().reportingItems[0]!.status).toBe('OPEN') // 零副作用
  })

  it('missing local id throws (草稿不存在)', () => {
    const ws = createReportingWorkspace()
    expect(() => ws.transitionReportingItem('loc-404', 'MATERIAL_READY')).toThrow(/does not exist/)
  })
})

describe('本地 SEV 草稿 + V1 时间窗投影 (host schedule.ts 同语义)', () => {
  it('addScheduledEvent validates + stores; upcomingEvents filters/sorts like the host query face', () => {
    const ws = createReportingWorkspace({ now: () => T0 })
    expect(() => ws.addScheduledEvent({ title: '', schedule: { kind: 'ONCE', at: T0 } })).toThrow(/title/)
    const past = ws.addScheduledEvent({ title: '过去', schedule: { kind: 'ONCE', at: T0 - DAY } })
    const inWindow = ws.addScheduledEvent({ title: '明天', schedule: { kind: 'ONCE', at: T0 + DAY } })
    const recurringOpen = ws.addScheduledEvent({ title: '每周组会', schedule: { kind: 'RECURRING', freq: 'WEEKLY' } })
    const recurringUntil = ws.addScheduledEvent({ title: '月度(至)', schedule: { kind: 'RECURRING', freq: 'MONTHLY', interval: 2, until: T0 + 5 * DAY } })

    const events = (id: string): LocalScheduledEvent => ws.getSnapshot().scheduledEvents.find((e) => e.localId === id)!
    expect(events(past).localId).toBe(past)

    const window30 = { from: T0, to: T0 + 30 * DAY }
    const hits = upcomingEvents(ws.getSnapshot().scheduledEvents, window30).map((e) => e.title)
    // 过去 ONCE 排除; RECURRING 活跃跨度与窗口相交命中 (until 在窗内/无 until)。
    expect(hits).toEqual(['明天', '月度(至)', '每周组会']) // 排序: at → until → 尾部

    // 全部 (window = null) ⇒ 不过滤, 仅排序。
    const all = upcomingEvents(ws.getSnapshot().scheduledEvents, null).map((e) => e.title)
    expect(all).toEqual(['过去', '明天', '月度(至)', '每周组会'])
  })

  it('legalRptTransitions mirrors the host frozen §13 table', () => {
    for (const status of RPT_STATUSES) {
      expect(legalRptTransitions(status)).toEqual(RPT_LEGAL_TRANSITIONS[status])
    }
  })
})
