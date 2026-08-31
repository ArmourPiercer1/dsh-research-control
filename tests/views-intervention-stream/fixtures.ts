/**
 * V2-UI-8 — 统一 Needs Attention 页 component test fixtures: WIRE-VALID
 * `QueryAttentionResult` values (the `queryAttention` wire contract —
 * D §14, the 59th registered invocation; B §27.1 page).
 *
 * The discipline mirrors the legacy t5.2 fixtures: every fixture is
 * re-parsed through the strict `QueryAttentionResultSchema` — a fixture
 * that drifts from the wire contract fails the suite, not the wire.
 */

import {
  QueryAttentionResultSchema,
  type QueryAttentionResult,
  type UpdateInterventionStateResult,
} from '../../src/shared/rpc-contracts.js'

/** Re-parse a fixture through the strict wire schema (wire-validity pin). */
function wireResult(result: unknown): QueryAttentionResult {
  return QueryAttentionResultSchema.parse(result)
}

/** The pinned "now" for the relative-time fixtures (2025-06-15T00:00:00Z). */
export const NOW = 1_750_000_000_000
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The full-combination host list (the ONE fetch — D §14): the scoreable
 * (non-terminal) items in the host's rank order (score desc), then the
 * terminals (score 0 / rank null) createdAt-desc. The ORDER is the
 * INV-ATTN-1 pin: the page partitions + filters but never re-sorts.
 *  - PRJ-1 (机器人视觉定位系统): IV-1 OPEN, IV-2 PENDING, IV-3 CLOSED,
 *    BLK-1 ACTIVE, DERIVED-1 (const ACTIVE);
 *  - PRJ-2 (独立实验): MISSING-NA-WS-3 (const OPEN), NA-1 PROPOSED,
 *    NA-0 PROPOSED (workstream-less), NA-2 PROMOTED, BLK-2 CLEARED.
 */
export const ATTN_FULL_RESULT: QueryAttentionResult = wireResult({
  items: [
    {
      kind: 'INTERVENTION',
      sourceId: 'IV-1',
      sourceRef: { kind: 'intervention', id: 'IV-1' },
      projectId: 'PRJ-1',
      workstreamId: 'WS-1',
      title: '标定管线阻塞',
      reason: '自动洪泛：3 分钟内 12 次告警',
      status: 'OPEN',
      priority: 'HIGH',
      score: 92,
      rank: 1,
      createdAt: NOW - 2 * HOUR,
      detectedAt: NOW - 2 * HOUR,
      allowedActions: ['markPending', 'closeIntervention', 'openWorkstream'],
      context: { intervention: { origin: 'AUTO_FLOODING' } },
    },
    {
      kind: 'MISSING_NEXT_ACTION',
      sourceId: 'MISSING-NA-WS-3',
      syntheticKey: 'MISSING-NA-WS-3',
      sourceRef: { kind: 'workstream', id: 'WS-3' },
      projectId: 'PRJ-2',
      workstreamId: 'WS-3',
      title: 'WS-3 有活动目标但没有已提升的下一步',
      reason: '机械投影：ACTIVE 目标未挂 PROMOTED 下一步',
      status: 'OPEN',
      priority: 'HIGH',
      score: 88,
      rank: 2,
      createdAt: NOW - 1 * HOUR,
      detectedAt: NOW - 1 * HOUR,
      allowedActions: ['createNextAction', 'openWorkstream'],
      context: { missingNextAction: { objectiveId: 'OBJ-3' } },
    },
    {
      kind: 'INTERVENTION',
      sourceId: 'IV-2',
      sourceRef: { kind: 'intervention', id: 'IV-2' },
      projectId: 'PRJ-1',
      workstreamId: 'WS-1',
      title: '传感器标定参数漂移',
      reason: 'Agent 报告：残差超出阈值 2σ',
      status: 'PENDING',
      priority: 'HIGH',
      score: 70,
      rank: 3,
      createdAt: NOW - 26 * HOUR,
      detectedAt: NOW - 26 * HOUR,
      allowedActions: ['reopenIntervention', 'closeIntervention', 'openWorkstream'],
      context: { intervention: { origin: 'AGENT_REPORT' } },
    },
    {
      kind: 'EXPLICIT_BLOCKER',
      sourceId: 'BLK-1',
      sourceRef: { kind: 'blocker', id: 'BLK-1' },
      projectId: 'PRJ-1',
      workstreamId: 'WS-2',
      title: '等待采购到位的硬件',
      reason: '人工登记的阻塞',
      status: 'ACTIVE',
      priority: 'MEDIUM',
      score: 61,
      rank: 4,
      createdAt: NOW - 5 * HOUR,
      detectedAt: NOW - 5 * HOUR,
      allowedActions: ['clearBlocker', 'openWorkstream'],
      context: {},
    },
    {
      kind: 'DERIVED_BLOCKER',
      sourceId: 'DERIVED-1',
      sourceRef: { kind: 'intervention', id: 'IV-1' },
      projectId: 'PRJ-1',
      workstreamId: 'WS-1',
      title: '派生阻塞：标定未完成',
      reason: '由未关闭的干预 IV-1 派生',
      status: 'ACTIVE',
      priority: 'MEDIUM',
      score: 55,
      rank: 5,
      createdAt: NOW - 2 * HOUR,
      detectedAt: NOW - 2 * HOUR,
      allowedActions: ['openCause'],
      context: {
        derivedBlocker: {
          primaryAction: { label: '打开源干预 IV-1', targetKind: 'intervention', targetId: 'IV-1' },
        },
      },
    },
    {
      kind: 'NEXT_ACTION',
      sourceId: 'NA-1',
      sourceRef: { kind: 'nextAction', id: 'NA-1' },
      projectId: 'PRJ-2',
      workstreamId: 'WS-9',
      title: '复核阈值后再上线',
      reason: 'Agent 建议的下一步',
      status: 'PROPOSED',
      priority: 'LOW',
      score: 30,
      rank: 6,
      createdAt: NOW - 26 * HOUR,
      detectedAt: NOW - 26 * HOUR,
      allowedActions: ['promoteNextAction', 'dismissNextAction', 'openWorkstream'],
      context: { nextAction: { promotedToTaskId: null } },
    },
    {
      kind: 'NEXT_ACTION',
      sourceId: 'NA-0',
      sourceRef: { kind: 'nextAction', id: 'NA-0' },
      projectId: 'PRJ-2',
      workstreamId: null,
      title: '整理实验记录（无所属工作流）',
      reason: '人工登记的下一步',
      status: 'PROPOSED',
      priority: 'LOW',
      score: 20,
      rank: 7,
      createdAt: NOW - 12 * HOUR,
      detectedAt: NOW - 12 * HOUR,
      allowedActions: ['promoteNextAction', 'dismissNextAction'],
      context: { nextAction: { promotedToTaskId: null } },
    },
    // ── terminals (score 0, rank null) — createdAt-desc ──
    {
      kind: 'EXPLICIT_BLOCKER',
      sourceId: 'BLK-2',
      sourceRef: { kind: 'blocker', id: 'BLK-2' },
      projectId: 'PRJ-2',
      workstreamId: 'WS-3',
      title: '已解除的算力瓶颈',
      reason: '扩容后解除',
      status: 'CLEARED',
      priority: 'LOW',
      score: 0,
      rank: null,
      createdAt: NOW - 3 * DAY,
      detectedAt: NOW - 3 * DAY,
      allowedActions: [],
      context: {},
    },
    {
      kind: 'NEXT_ACTION',
      sourceId: 'NA-2',
      sourceRef: { kind: 'nextAction', id: 'NA-2' },
      projectId: 'PRJ-2',
      workstreamId: 'WS-9',
      title: '已提升为任务的下一步',
      reason: '已 PROMOTED',
      status: 'PROMOTED',
      priority: 'LOW',
      score: 0,
      rank: null,
      createdAt: NOW - 7 * DAY,
      detectedAt: NOW - 7 * DAY,
      allowedActions: ['openTask'],
      context: { nextAction: { promotedToTaskId: 'TASK-77' } },
    },
    {
      kind: 'INTERVENTION',
      sourceId: 'IV-3',
      sourceRef: { kind: 'intervention', id: 'IV-3' },
      projectId: 'PRJ-1',
      workstreamId: 'WS-3',
      title: '归档前的历史洪泛',
      reason: '已审计关闭',
      status: 'CLOSED',
      priority: 'MEDIUM',
      score: 0,
      rank: null,
      createdAt: NOW - 40 * DAY,
      detectedAt: NOW - 40 * DAY,
      allowedActions: [],
      context: { intervention: { origin: 'AUTO_AUDIT' } },
    },
  ],
  total: 10,
})

/** The terminals-only view (the closed-section partition pin). */
export const ATTN_CLOSED_ONLY_RESULT: QueryAttentionResult = wireResult({
  items: [
    {
      kind: 'EXPLICIT_BLOCKER',
      sourceId: 'BLK-2',
      sourceRef: { kind: 'blocker', id: 'BLK-2' },
      projectId: 'PRJ-2',
      workstreamId: 'WS-3',
      title: '已解除的算力瓶颈',
      reason: '扩容后解除',
      status: 'CLEARED',
      priority: 'LOW',
      score: 0,
      rank: null,
      createdAt: NOW - 3 * DAY,
      detectedAt: NOW - 3 * DAY,
      allowedActions: [],
      context: {},
    },
    {
      kind: 'NEXT_ACTION',
      sourceId: 'NA-2',
      sourceRef: { kind: 'nextAction', id: 'NA-2' },
      projectId: 'PRJ-2',
      workstreamId: 'WS-9',
      title: '已提升为任务的下一步',
      reason: '已 PROMOTED',
      status: 'PROMOTED',
      priority: 'LOW',
      score: 0,
      rank: null,
      createdAt: NOW - 7 * DAY,
      detectedAt: NOW - 7 * DAY,
      allowedActions: ['openTask'],
      context: { nextAction: { promotedToTaskId: 'TASK-77' } },
    },
    {
      kind: 'INTERVENTION',
      sourceId: 'IV-3',
      sourceRef: { kind: 'intervention', id: 'IV-3' },
      projectId: 'PRJ-1',
      workstreamId: 'WS-3',
      title: '归档前的历史洪泛',
      reason: '已审计关闭',
      status: 'CLOSED',
      priority: 'MEDIUM',
      score: 0,
      rank: null,
      createdAt: NOW - 40 * DAY,
      detectedAt: NOW - 40 * DAY,
      allowedActions: [],
      context: { intervention: { origin: 'AUTO_AUDIT' } },
    },
  ],
  total: 3,
})

/** The empty list (the 空态 face — 当前没有需要处理的事件). */
export const ATTN_EMPTY_RESULT: QueryAttentionResult = wireResult({
  items: [],
  total: 0,
})

/** The PENDING-less list (the per-group 暂无待确认事件 copy). */
export const ATTN_NO_PENDING_RESULT: QueryAttentionResult = wireResult({
  items: [
    {
      kind: 'INTERVENTION',
      sourceId: 'IV-1',
      sourceRef: { kind: 'intervention', id: 'IV-1' },
      projectId: 'PRJ-1',
      workstreamId: 'WS-1',
      title: '标定管线阻塞',
      reason: '自动洪泛：3 分钟内 12 次告警',
      status: 'OPEN',
      priority: 'HIGH',
      score: 92,
      rank: 1,
      createdAt: NOW - 2 * HOUR,
      detectedAt: NOW - 2 * HOUR,
      allowedActions: ['markPending', 'closeIntervention', 'openWorkstream'],
      context: { intervention: { origin: 'AUTO_FLOODING' } },
    },
    {
      kind: 'EXPLICIT_BLOCKER',
      sourceId: 'BLK-1',
      sourceRef: { kind: 'blocker', id: 'BLK-1' },
      projectId: 'PRJ-1',
      workstreamId: 'WS-2',
      title: '等待采购到位的硬件',
      reason: '人工登记的阻塞',
      status: 'ACTIVE',
      priority: 'MEDIUM',
      score: 61,
      rank: 2,
      createdAt: NOW - 5 * HOUR,
      detectedAt: NOW - 5 * HOUR,
      allowedActions: ['clearBlocker', 'openWorkstream'],
      context: {},
    },
  ],
  total: 2,
})

/** The `updateInterventionState` success results (per target status). */
export const UPDATE_PENDING_OK = {
  interventionId: 'IV-1',
  statusFrom: 'OPEN',
  statusTo: 'PENDING',
  closedAt: null,
  resolutionNote: null,
} as const
export const UPDATE_CLOSED_OK = {
  interventionId: 'IV-1',
  statusFrom: 'OPEN',
  statusTo: 'CLOSED',
  closedAt: NOW,
  resolutionNote: '已处理',
} as const
export const UPDATE_REOPEN_OK = {
  interventionId: 'IV-2',
  statusFrom: 'PENDING',
  statusTo: 'OPEN',
  closedAt: null,
  resolutionNote: null,
} as const

/** The project directory the shell passes (HUB: all plane projects). */
export const PROJECTS: readonly { readonly projectId: string; readonly displayName: string }[] = [
  { projectId: 'PRJ-1', displayName: '机器人视觉定位系统' },
  { projectId: 'PRJ-2', displayName: '独立实验' },
]

/** The `UpdateInterventionStateResult` stub bodies (the component never
 *  reads the payload — success is the shape pin). */
export const updateResult = (
  statusFrom: 'OPEN' | 'PENDING' | 'CLOSED',
  statusTo: 'OPEN' | 'PENDING' | 'CLOSED',
  resolutionNote: string | null = null,
): UpdateInterventionStateResult =>
  ({
    interventionId: 'IV-1',
    statusFrom,
    statusTo,
    closedAt: statusTo === 'CLOSED' ? NOW : null,
    resolutionNote,
  }) as UpdateInterventionStateResult
