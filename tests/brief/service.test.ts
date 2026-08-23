/**
 * WP-5.5 — 服务面测试（`buildBrief()` 组装 + `BriefService` 封装）。
 *
 * 覆盖（任务目标 2: host 侧组装 + 缺口占位不虚构）:
 *  - 空端口 = 全占位（dashboard 缺失 ⇒ L1 缺口陈述; 各面 EMPTY/PLACEHOLDER）;
 *  - 全生产端口 = 全数据（L3 AVAILABLE 计数 ≡ 输入长度; L2 DATA 点带 ref;
 *    validateBriefRefs 零违规 — 自检门执行面）;
 *  - 状态契约防御性过滤（CLOSED IV / PROMOTED NA / CLEARED BLK 不进 Brief —
 *    不抛错, 静默按契约过滤, WP-5.4 service 同口径）;
 *  - 端口确定性（同端口状态 + 同 now ⇒ 同输出; 端口返回乱序 ⇒ 同输出）;
 *  - 端口抛错 = buildBrief 抛错（fail loud, 不逐端口降级）;
 *  - `BriefService` 薄封装（now 注入 ⇒ generatedAt 确定性; 委托 buildBrief）。
 */

import { describe, expect, it } from 'vitest'

import { rankAttention } from '../../src/host/service/attention/scorer.js'
import type { AttentionContext } from '../../src/host/service/attention/scorer.js'
import type { DashboardSnapshot } from '../../src/shared/rpc-contracts.js'
import { BriefService, BriefServiceError, buildBrief, type BriefSourcePorts } from '../../src/host/service/brief/service.js'
import { validateBriefRefs } from '../../src/host/service/brief/project.js'
import {
  blockerRecordToAttentionItem,
  interventionRecordToAttentionItem,
  nextActionRecordToAttentionItem,
  scheduledEventRecordToAttentionItem,
} from '../../src/host/service/brief/mapping.js'
import {
  makeBlockerRecord,
  makeFuturePlan,
  makeHistoryEventRecord,
  makeInteractionRecord,
  makeInterventionRecord,
  makeNextActionRecord,
  makeObjectiveDoc,
  makeReportingItemRecord,
  makeScheduledEventRecord,
  T_NOW,
} from './fixtures.js'

const HOUR = 60 * 60 * 1000

/** 空 dashboard 快照（wire 形状 — 空工作区面）。 */
function emptyDashboard(): DashboardSnapshot {
  return {
    project: { id: 'PRJ-1', title: 'Project One', description: null, importance: 1, attentionMode: 'NORMAL', targetDate: null },
    topics: [],
    openInterventions: [],
    pendingInterventions: [],
    scheduledEvents: null,
    reportingItems: null,
    inboxCount: null,
    attention: null,
  }
}

/** 全数据端口（生产记录面 — 各 WP 冻结行形状）。 */
function makeFullPorts(over: Partial<BriefSourcePorts> = {}): BriefSourcePorts {
  const interventions = [makeInterventionRecord(), makeInterventionRecord({ id: 'IV-2', status: 'PENDING', created_at: T_NOW - HOUR })]
  return {
    getDashboard: () => emptyDashboard(),
    getAttentionRanking: () =>
      rankAttention(
        [
          interventionRecordToAttentionItem(interventions[0]!),
          interventionRecordToAttentionItem(interventions[1]!),
        ],
        { now: T_NOW, projectImportance: 3, attentionMode: 'NORMAL' } satisfies AttentionContext,
      ),
    getInterventions: () => interventions,
    getObjectives: () => [makeObjectiveDoc()],
    getHistoryDigest: () => [makeHistoryEventRecord()],
    getNextActions: () => [makeNextActionRecord()],
    getBlockers: () => [makeBlockerRecord()],
    getScheduledEvents: () => [makeScheduledEventRecord()],
    getReportingItems: () => [makeReportingItemRecord()],
    getInteractions: () => [makeInteractionRecord()],
    getFuturePlans: () => [makeFuturePlan()],
    ...over,
  }
}

describe('buildBrief 组装', () => {
  it('空端口 = 全占位（dashboard 缺失 ⇒ L1 缺口陈述; audit/inbox 恒待开通）', () => {
    const brief = buildBrief({}, T_NOW)
    expect(brief.level1.statement).toBe('无法组装态势：dashboard 快照缺失（数据面不可用）')
    expect(brief.level3.find((r) => r.plane === 'dashboard')!.status).toBe('PLACEHOLDER')
    expect(brief.level3.find((r) => r.plane === 'audit')!.status).toBe('PLACEHOLDER')
    expect(brief.level3.find((r) => r.plane === 'inbox')!.status).toBe('PLACEHOLDER')
    expect(validateBriefRefs(brief)).toEqual([])
  })

  it('空工作区（dashboard 在, 各面空）= 「无进行中数据」+ 全 EMPTY 行', () => {
    const brief = buildBrief({ getDashboard: () => emptyDashboard() }, T_NOW)
    expect(brief.level1.statement).toBe('《Project One》：无进行中数据（各数据面为空集）')
    for (const row of brief.level3) {
      if (row.plane === 'dashboard' || row.plane === 'attention') continue
      if (row.plane === 'audit' || row.plane === 'inbox') expect(row.status).toBe('PLACEHOLDER')
      else expect(row.status, row.plane).toBe('EMPTY')
    }
    expect(validateBriefRefs(brief)).toEqual([])
  })

  it('全数据: L3 AVAILABLE 计数 ≡ 端口输入长度 + 自检门零违规', () => {
    const brief = buildBrief(makeFullPorts(), T_NOW)
    const counts: Record<string, number> = {}
    for (const row of brief.level3) counts[row.plane] = row.count
    expect(counts.interventions).toBe(2)
    expect(counts.objectives).toBe(1)
    expect(counts.nextActions).toBe(1)
    expect(counts.blockers).toBe(1)
    expect(counts.scheduledEvents).toBe(1)
    expect(counts.reportingItems).toBe(1)
    expect(counts.interactions).toBe(1)
    expect(counts.history).toBe(1)
    expect(counts.futurePlans).toBe(2) // WS-1 计划 2 项
    expect(counts.attention).toBe(2)
    expect(validateBriefRefs(brief)).toEqual([])
    // L2 DATA 点全带 ref:
    for (const point of brief.level2) {
      if (point.status === 'DATA') expect(point.refs.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('状态契约防御性过滤: CLOSED IV / PROMOTED NA / CLEARED BLK 不进 Brief（不抛错）', () => {
    const ports = makeFullPorts({
      getInterventions: () => [
        makeInterventionRecord(),
        makeInterventionRecord({ id: 'IV-9', status: 'CLOSED', closed_at: T_NOW }),
      ],
      getNextActions: () => [
        makeNextActionRecord(),
        makeNextActionRecord({ id: 'NA-9', status: 'PROMOTED', promoted_to_task_id: 'T-9' }),
        makeNextActionRecord({ id: 'NA-8', status: 'DISMISSED' }),
      ],
      getBlockers: () => [
        makeBlockerRecord(),
        makeBlockerRecord({ id: 'BLK-9', status: 'CLEARED', cleared_at: T_NOW }),
      ],
    })
    const brief = buildBrief(ports, T_NOW)
    const ivRefs = brief.level3.find((r) => r.plane === 'interventions')!.refs
    expect(ivRefs).toHaveLength(1)
    expect(brief.level3.find((r) => r.plane === 'nextActions')!.count).toBe(1)
    expect(brief.level3.find((r) => r.plane === 'blockers')!.count).toBe(1)
    expect(validateBriefRefs(brief)).toEqual([])
  })

  it('确定性: 同端口状态 + 同 now ⇒ 同输出; 端口乱序返回 ⇒ 同输出', () => {
    const a = buildBrief(makeFullPorts(), T_NOW)
    const b = buildBrief(makeFullPorts(), T_NOW)
    expect(b).toEqual(a)
    const shuffled = buildBrief(
      makeFullPorts({
        getInterventions: () => [
          makeInterventionRecord({ id: 'IV-2', status: 'PENDING', created_at: T_NOW - HOUR }),
          makeInterventionRecord(),
        ],
        getHistoryDigest: () => [makeHistoryEventRecord(), makeHistoryEventRecord({ eventId: 'H-2', eventSeq: 2, occurredAt: T_NOW - 30 * 60 * 1000 })],
      }),
      T_NOW,
    )
    const ordered = buildBrief(
      makeFullPorts({
        getHistoryDigest: () => [makeHistoryEventRecord({ eventId: 'H-2', eventSeq: 2, occurredAt: T_NOW - 30 * 60 * 1000 }), makeHistoryEventRecord()],
      }),
      T_NOW,
    )
    expect(shuffled.level2).toEqual(ordered.level2)
  })

  it('端口抛错 = buildBrief 抛错（fail loud, 不逐端口降级）', () => {
    const ports = makeFullPorts({
      getInterventions: () => {
        throw new Error('intervention store closed')
      },
    })
    expect(() => buildBrief(ports, T_NOW)).toThrowError('intervention store closed')
  })

  it('自检门: 违规 Brief ⇒ BriefServiceError（code BRIEF_INTERNAL — 结构面）', () => {
    const err = new BriefServiceError('buildBrief: self-check failed — x')
    expect(err.code).toBe('BRIEF_INTERNAL')
    expect(err.name).toBe('BriefServiceError')
  })
})

describe('BriefService 薄封装', () => {
  it('now 注入 ⇒ generatedAt 确定性; buildBrief 委托同输出', () => {
    const ports = makeFullPorts()
    const service = new BriefService({ ...ports, now: () => T_NOW })
    const viaService = service.buildBrief()
    const viaFunction = buildBrief(ports, T_NOW)
    expect(viaService).toEqual(viaFunction)
    expect(viaService.generatedAt).toBe(T_NOW)
  })

  it('连续两次 build 取活数据（端口状态变更 ⇒ 输出随之收敛 — projection 不缓存）', () => {
    let interventions = [makeInterventionRecord()]
    const ports: BriefSourcePorts = {
      getDashboard: () => emptyDashboard(),
      getInterventions: () => interventions,
    }
    const service = new BriefService({ ...ports, now: () => T_NOW })
    expect(service.buildBrief().level3.find((r) => r.plane === 'interventions')!.count).toBe(1)
    interventions = [...interventions, makeInterventionRecord({ id: 'IV-2', status: 'PENDING' })]
    expect(service.buildBrief().level3.find((r) => r.plane === 'interventions')!.count).toBe(2)
  })

  it('注意力端口 = WP-5.4 getAttentionRanking 输出直供（同一评分器 ⇒ 两侧同序）', () => {
    const ports = makeFullPorts()
    const brief = buildBrief(ports, T_NOW)
    const ranking = ports.getAttentionRanking!()
    expect(brief.level3.find((r) => r.plane === 'attention')!.refs.map((r) => (r.kind === 'OBJECT' ? r.id : ''))).toEqual(
      ranking.items.map((i) => i.id),
    )
    // 映射层产出的评分输入项可被同一评分器消费（WP-5.4 未决 3 闭环）:
    const mixed = rankAttention(
      [
        ...[makeNextActionRecord()].map(nextActionRecordToAttentionItem),
        ...[makeBlockerRecord()].map((b) => blockerRecordToAttentionItem(b)),
        ...[makeScheduledEventRecord()].map((s) => scheduledEventRecordToAttentionItem(s, T_NOW)),
      ],
      { now: T_NOW, projectImportance: 0, attentionMode: 'NORMAL' },
    )
    expect(mixed.items.map((i) => i.kind).sort()).toEqual(['BLOCKER', 'NEXT_ACTION', 'SCHEDULED_EVENT'])
  })
})
