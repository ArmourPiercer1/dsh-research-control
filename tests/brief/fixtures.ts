/**
 * WP-5.5 — tests/brief 共享 fixture（生产记录 + wire 快照 + 引擎输入 +
 * 确定性时钟原点）。
 *
 * 纪律（同 tests/attention/fixtures.ts）: wire fixture 是 WIRE-VALID 的
 * `DashboardSnapshot`/`ProjectSnapshot` — 消费它的测试再经 strict schema
 * 重解析（契约漂移 ⇒ 套件红）。生产记录 fixture 按各 WP 冻结行形状
 * 逐字段构造（形状网在 tests/brief 的映射测试逐字断言）。
 */

import type { ObjectiveDoc } from '../../src/host/domain/loader/types.js'
import type { HistoryEventRecord } from '../../src/host/persistence/store/types.js'
import type { BlockerRecord, NextActionRecord } from '../../src/host/service/actions/types.js'
import type { InterventionRecord } from '../../src/host/service/flooding/types.js'
import type { InteractionRecord, ReportingItemRecord, ScheduledEventRecord } from '../../src/host/service/reporting/types.js'
import type { AttentionItem } from '../../src/host/service/attention/scorer.js'
import {
  BRIEF_DATA_PLANES,
  BRIEF_POINT_CATEGORIES,
  type BriefInputs,
  type BriefFuturePlan,
  type BriefRef,
  type LivingBrief,
} from '../../src/host/service/brief/types.js'

/** 参考「现在」（epoch ms, 2026-08-22T09:00:00Z — 同 tests/attention T_NOW）。 */
export const T_NOW = Date.parse('2026-08-22T09:00:00Z')

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const USER_ACTOR = { kind: 'USER' as const }
const PLUGIN_ACTOR = { kind: 'PLUGIN' as const }

/* -------------------------------------------------------------------- *
 * 生产记录 fixture
 * -------------------------------------------------------------------- */

export function makeInterventionRecord(over: Partial<InterventionRecord> = {}): InterventionRecord {
  return {
    id: 'IV-1',
    title: '审阅累积的 Agent PlanFork [WS-1]',
    origin: 'AUTO_FLOODING',
    workstream_ids: ['WS-1'],
    source_refs: [{ kind: 'PLAN_FORK', id: 'PF-1' }],
    status: 'OPEN',
    created_by: PLUGIN_ACTOR,
    created_at: T_NOW - 2 * HOUR,
    ...over,
  }
}

export function makeNextActionRecord(over: Partial<NextActionRecord> = {}): NextActionRecord {
  return {
    id: 'NA-1',
    workstream_id: 'WS-1',
    statement: '考虑把数据清洗脚本化',
    status: 'PROPOSED',
    created_by: USER_ACTOR,
    created_at: T_NOW - HOUR,
    ...over,
  }
}

export function makeBlockerRecord(over: Partial<BlockerRecord> = {}): BlockerRecord {
  return {
    id: 'BLK-1',
    statement: 'GPU 集群排队, 实验无法启动',
    affects: [{ kind: 'WORKSTREAM', id: 'WS-2' }],
    status: 'ACTIVE',
    source: '用户登记',
    created_at: T_NOW - 3 * HOUR,
    ...over,
  }
}

export function makeScheduledEventRecord(over: Partial<ScheduledEventRecord> = {}): ScheduledEventRecord {
  return {
    id: 'SEV-1',
    title: '组会汇报',
    schedule: { kind: 'ONCE', at: T_NOW + 2 * HOUR },
    ...over,
  }
}

export function makeReportingItemRecord(over: Partial<ReportingItemRecord> = {}): ReportingItemRecord {
  return {
    id: 'RPT-1',
    audience: '导师',
    statement: '汇报本周实验进展',
    status: 'OPEN',
    created_at: T_NOW - DAY,
    ...over,
  }
}

export function makeInteractionRecord(over: Partial<InteractionRecord> = {}): InteractionRecord {
  return {
    id: 'INT-1',
    kind: 'MEETING',
    title: '组会',
    occurred_at: T_NOW - DAY,
    ...over,
  }
}

export function makeObjectiveDoc(over: Partial<ObjectiveDoc> = {}): ObjectiveDoc {
  return {
    id: 'OBJ-1',
    scope: 'PROJECT',
    statement: '理解目标系统的失效模式',
    success_criteria: ['完成失效模式清单'],
    status: 'ACTIVE',
    priority: 'P1',
    linked_refs: [],
    created_at: T_NOW - 30 * DAY,
    ...over,
  }
}

export function makeHistoryEventRecord(over: Partial<HistoryEventRecord> = {}): HistoryEventRecord {
  return {
    eventId: 'H-1',
    ownerWorkstreamId: 'WS-1',
    eventType: 'INTERVENTION_CREATED',
    schemaVersion: 1,
    occurredAt: T_NOW - 2 * HOUR,
    actor: PLUGIN_ACTOR,
    payload: {},
    eventSeq: 1,
    recordedAt: T_NOW - 2 * HOUR + 1,
    ...over,
  }
}

export function makeFuturePlan(over: Partial<BriefFuturePlan> = {}): BriefFuturePlan {
  return {
    workstreamId: 'WS-1',
    items: [
      { id: 'T-1', kind: 'TASK', title: '数据清洗脚本化' },
      { id: 'G-1', kind: 'GATE', title: '清洗结果评审门' },
    ],
    ...over,
  }
}

/* -------------------------------------------------------------------- *
 * 引擎输入 fixture（BriefInputs 全集 / 空集）
 * -------------------------------------------------------------------- */

/** 全数据面的引擎输入（完整 Brief 基准 — 各面 ≥1 条）。 */
export function makeFullInputs(): BriefInputs {
  return {
    attention: {
      generatedAt: T_NOW,
      weights: {} as never, // 引擎不读 weights — 形状占位（scorer 真实值见 attention fixtures）
      items: [
        {
          kind: 'INTERVENTION',
          id: 'IV-1',
          title: '审阅累积的 Agent PlanFork [WS-1]',
          createdAt: T_NOW - 2 * HOUR,
          workstreamId: 'WS-1',
          status: 'OPEN',
          origin: 'AUTO_FLOODING',
          score: 110,
          reasons: ['OPEN Intervention — 待人类负责', '来源: AUTO_FLOODING', '用户尚未知悉（awareness UNSEEN）'],
          rank: 1,
        },
        {
          kind: 'BLOCKER',
          id: 'BLK-1',
          title: 'GPU 集群排队, 实验无法启动',
          createdAt: T_NOW - 3 * HOUR,
          workstreamId: 'WS-2',
          status: 'ACTIVE',
          score: 90,
          reasons: ['ACTIVE Blocker — 现实阻碍未解除'],
          rank: 2,
        },
      ],
    },
    dashboard: {
      project: {
        id: 'PRJ-1',
        title: 'Project One',
        description: null,
        importance: 3,
        attentionMode: 'FOCUS',
        targetDate: null,
      },
      topics: [{ id: 'TPC-1', title: 'Topic One', workstreamCount: 2 }],
      openInterventions: [],
      pendingInterventions: [],
      scheduledEvents: null,
      reportingItems: null,
      inboxCount: null,
      attention: null,
    },
    interventions: [
      {
        id: 'IV-1',
        title: '审阅累积的 Agent PlanFork [WS-1]',
        origin: 'AUTO_FLOODING',
        status: 'OPEN',
        workstreamIds: ['WS-1'],
        createdAt: T_NOW - 2 * HOUR,
      },
      {
        id: 'IV-2',
        title: 'PENDING 的审计差异',
        origin: 'AUTO_AUDIT',
        status: 'PENDING',
        workstreamIds: ['WS-2'],
        createdAt: T_NOW - HOUR,
      },
    ],
    objectives: [
      {
        id: 'OBJ-1',
        scope: 'PROJECT',
        statement: '理解目标系统的失效模式',
        status: 'ACTIVE',
        priority: 'P1',
        targetDate: null,
      },
      {
        id: 'OBJ-2',
        scope: 'PROJECT',
        statement: '构建基线评估集',
        status: 'ACTIVE',
        priority: 'P0',
        targetDate: T_NOW + 10 * DAY,
      },
      {
        id: 'OBJ-3',
        scope: 'TOPIC',
        statement: '已达成: 初步数据收集',
        status: 'ACHIEVED',
        priority: 'P2',
        targetDate: null,
      },
    ],
    history: [
      {
        eventId: 'H-1',
        eventSeq: 1,
        ownerWorkstreamId: 'WS-1',
        eventType: 'INTERVENTION_CREATED',
        occurredAt: T_NOW - 2 * HOUR,
      },
      {
        eventId: 'H-2',
        eventSeq: 2,
        ownerWorkstreamId: 'WS-2',
        eventType: 'RUN_FINISHED',
        occurredAt: T_NOW - HOUR,
      },
      {
        eventId: 'H-3',
        eventSeq: 3,
        ownerWorkstreamId: 'WS-1',
        eventType: 'CLAIM_RECORDED',
        occurredAt: T_NOW - 30 * 60 * 1000,
      },
    ],
    nextActions: [
      {
        id: 'NA-1',
        statement: '考虑把数据清洗脚本化',
        status: 'PROPOSED',
        workstreamId: 'WS-1',
        createdAt: T_NOW - HOUR,
      },
    ],
    blockers: [
      {
        id: 'BLK-1',
        statement: 'GPU 集群排队, 实验无法启动',
        status: 'ACTIVE',
        affects: [{ kind: 'WORKSTREAM', id: 'WS-2' }],
        createdAt: T_NOW - 3 * HOUR,
      },
    ],
    scheduledEvents: [
      { id: 'SEV-1', title: '组会汇报', at: T_NOW + 2 * HOUR, recurring: false },
      { id: 'SEV-2', title: '远期刊截稿', at: T_NOW + 30 * DAY, recurring: false },
      { id: 'SEV-3', title: '每周文献调研', at: null, recurring: true },
      { id: 'SEV-0', title: '已过期评审', at: T_NOW - HOUR, recurring: false },
    ],
    reportingItems: [
      {
        id: 'RPT-1',
        audience: '导师',
        statement: '汇报本周实验进展',
        status: 'OPEN',
        createdAt: T_NOW - DAY,
      },
      {
        id: 'RPT-2',
        audience: '合作者',
        statement: '数据共享说明',
        status: 'REPORTED',
        createdAt: T_NOW - 2 * DAY,
      },
    ],
    interactions: [
      {
        id: 'INT-1',
        kind: 'MEETING',
        title: '组会',
        occurredAt: T_NOW - DAY,
      },
    ],
    futurePlans: [
      makeFuturePlan(),
      { workstreamId: 'WS-2', items: [] },
    ],
  }
}

/** 空数据面的引擎输入（全占位基准 — 面存在但空集）。 */
export function makeEmptyInputs(): BriefInputs {
  return {
    attention: { generatedAt: T_NOW, weights: {} as never, items: [] },
    dashboard: {
      project: {
        id: 'PRJ-1',
        title: 'Project One',
        description: null,
        importance: 3,
        attentionMode: 'NORMAL',
        targetDate: null,
      },
      topics: [],
      openInterventions: [],
      pendingInterventions: [],
      scheduledEvents: null,
      reportingItems: null,
      inboxCount: null,
      attention: null,
    },
    interventions: [],
    objectives: [],
    history: [],
    nextActions: [],
    blockers: [],
    scheduledEvents: [],
    reportingItems: [],
    interactions: [],
    futurePlans: [],
  }
}

/* -------------------------------------------------------------------- *
 * 断言助手
 * -------------------------------------------------------------------- */

/** 八类要点类别集合（结构完备断言）。 */
export function categoriesOf(brief: LivingBrief): ReadonlySet<string> {
  return new Set(brief.level2.map((p) => p.category))
}

/** L3 行索引（plane → 行）。 */
export function planeRow(brief: LivingBrief, plane: string) {
  const row = brief.level3.find((r) => r.plane === plane)
  if (row === undefined) throw new Error(`missing plane row: ${plane}`)
  return row
}

/** L2 某类别的全部要点（顺序保真）。 */
export function pointsOf(brief: LivingBrief, category: string) {
  return brief.level2.filter((p) => p.category === category)
}

/** ref 全等断言用的归一化（值相等）。 */
export function refKey(ref: BriefRef): string {
  return ref.kind === 'OBJECT' ? `OBJECT:${ref.objectKind}:${ref.id}` : `EVENT:${ref.workstreamId}:${ref.eventSeq}:${ref.eventId}`
}

/** 注意力评分输入全集（service 测试: 端口 → 评分器）。 */
export function makeAttentionItems(over: Partial<Record<AttentionItem['kind'], number>> = {}): AttentionItem[] {
  const items: AttentionItem[] = []
  if ((over.INTERVENTION ?? 1) > 0) {
    items.push({
      kind: 'INTERVENTION',
      id: 'IV-1',
      title: '审阅累积的 Agent PlanFork [WS-1]',
      createdAt: T_NOW - 2 * HOUR,
      workstreamId: 'WS-1',
      status: 'OPEN',
      origin: 'AUTO_FLOODING',
    })
  }
  if ((over.NEXT_ACTION ?? 1) > 0) {
    items.push({
      kind: 'NEXT_ACTION',
      id: 'NA-1',
      title: '考虑把数据清洗脚本化',
      createdAt: T_NOW - HOUR,
      workstreamId: 'WS-1',
      status: 'PROPOSED',
    })
  }
  if ((over.BLOCKER ?? 1) > 0) {
    items.push({
      kind: 'BLOCKER',
      id: 'BLK-1',
      title: 'GPU 集群排队, 实验无法启动',
      createdAt: T_NOW - 3 * HOUR,
      workstreamId: 'WS-2',
      status: 'ACTIVE',
    })
  }
  if ((over.SCHEDULED_EVENT ?? 1) > 0) {
    items.push({
      kind: 'SCHEDULED_EVENT',
      id: 'SEV-1',
      title: '组会汇报',
      createdAt: T_NOW + 2 * HOUR,
      workstreamId: null,
      at: T_NOW + 2 * HOUR,
    })
  }
  return items
}

/* -------------------------------------------------------------------- *
 * 常量导出（测试引用 — 避免魔法数漂移）
 * -------------------------------------------------------------------- */

export { BRIEF_DATA_PLANES, BRIEF_POINT_CATEGORIES }
