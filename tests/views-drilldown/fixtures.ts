/**
 * WP-4.6 — drill-down view test fixtures.
 *
 * All fixtures are WIRE-VALID: re-parsed through the strict frozen schemas
 * at module load (the same discipline as tests/rpc-face/fixtures.ts — a
 * fixture that drifts from the contract fails the suite, not the wire).
 *
 * The event log models the TC-E2E-012/013 chain end to end:
 *   R-1 (finished, session-e2e-sess-1) produced C-1, A-1 (T-1);
 *   R-2 (running,  session-e2e-sess-2) produced C-2;
 *   relations: C-1 —SUPPORTED_BY→ A-1, A-1 —PRODUCED_BY→ R-1.
 */

import {
  DashboardSnapshotSchema,
  GetGitHistoryResultSchema,
  QueryHistoryResultSchema,
  TopicSnapshotSchema,
  WorkstreamSnapshotSchema,
  type DashboardSnapshot,
  type GetGitHistoryResult,
  type HistoryEventDto,
  type QueryHistoryResult,
  type TopicSnapshot,
  type WorkstreamSnapshot,
} from '../../src/shared/rpc-contracts.js'

const T = 1755000000000

/* -------------------------------------------------------------------- *
 * Dashboard (home + the intervention queue)
 * -------------------------------------------------------------------- */

const DASHBOARD: DashboardSnapshot = {
  project: {
    id: 'PRJ-1',
    title: '凝聚态方向综述',
    description: '追踪关键方向进展并整理证据链',
    importance: 5,
    attentionMode: 'FOCUS',
    targetDate: T,
  },
  topics: [{ id: 'TPC-1', title: '高温超导', workstreamCount: 1 }],
  openInterventions: [
    {
      id: 'IV-1',
      title: '计划分叉洪泛告警',
      origin: 'AUTO_FLOODING',
      status: 'OPEN',
      workstreamIds: ['WS-1', 'WS-2'],
      createdAt: T,
    },
  ],
  pendingInterventions: [
    {
      id: 'IV-2',
      title: '等待用户确认的审计发现',
      origin: 'AUTO_AUDIT',
      status: 'PENDING',
      workstreamIds: ['WS-1'],
      createdAt: T + 1000,
    },
  ],
  scheduledEvents: null,
  reportingItems: null,
  inboxCount: 0,
  attention: null,
}

/** After IV-1 flips to PENDING (the board's 待处理 mutation refetch). */
const DASHBOARD_IV1_PENDING: DashboardSnapshot = {
  ...DASHBOARD,
  openInterventions: [],
  pendingInterventions: [
    {
      id: 'IV-1',
      title: '计划分叉洪泛告警',
      origin: 'AUTO_FLOODING',
      status: 'PENDING',
      workstreamIds: ['WS-1', 'WS-2'],
      createdAt: T,
    },
    ...DASHBOARD.pendingInterventions,
  ],
}

/** After IV-1 is CLOSED (the board's 关闭 mutation refetch). */
const DASHBOARD_IV1_CLOSED: DashboardSnapshot = {
  ...DASHBOARD,
  openInterventions: [],
  pendingInterventions: DASHBOARD.pendingInterventions,
}

/* -------------------------------------------------------------------- *
 * Workstream snapshot (runs + the unresolved PF overlay)
 * -------------------------------------------------------------------- */

const WORKSTREAM: WorkstreamSnapshot = {
  workstream: {
    id: 'WS-1',
    topicId: 'TPC-1',
    title: '高温超导机制研究',
    lifecycle: 'REALIZED',
    summary: null,
    createdAt: T,
  },
  history: { eventCount: 8 },
  current: {
    tasks: [],
    runs: [
      {
        id: 'R-1',
        status: 'FINISHED',
        taskId: 'T-1',
        intent: '调研高温超导近期进展',
        startedAt: T,
        endedAt: T + 9000,
        lastCheckpointAt: null,
        lastCheckpointNote: null,
      },
      {
        id: 'R-2',
        status: 'RUNNING',
        taskId: 'T-2',
        intent: '整理实验证据',
        startedAt: T + 10000,
        endedAt: null,
        lastCheckpointAt: null,
        lastCheckpointNote: null,
      },
    ],
  },
  future: {
    plan: {
      orderedItems: [
        { id: 'G-1', kind: 'GATE', title: '起点门' },
        { id: 'T-1', kind: 'TASK', title: '调研' },
        { id: 'T-2', kind: 'TASK', title: '实验' },
        { id: 'M-1', kind: 'MILESTONE', title: '中期里程碑' },
      ],
    },
    planForks: [
      {
        id: 'PF-1',
        status: 'OPEN',
        reason: '补充一条计算验证任务',
        necessity: '实验窗口不足，需要计算验证补充证据',
        forkAnchor: 'T-1',
        mergeAnchor: 'T-2',
        createdByRun: 'R-1',
        createdAt: T + 5000,
        staleReason: null,
        proposedItemCount: 1,
        baseGitCommit: 'a'.repeat(40),
      },
      {
        id: 'PF-2',
        status: 'STALE',
        reason: '另一条备选路径',
        necessity: '备选实验路径，等待用户裁决',
        forkAnchor: 'T-1',
        mergeAnchor: 'T-2',
        createdByRun: 'R-1',
        createdAt: T + 6000,
        staleReason: 'superseded by PF-1 selection',
        proposedItemCount: 1,
        baseGitCommit: 'a'.repeat(40),
      },
    ],
    unresolvedPlanForkCount: 2,
  },
}

/** After PF-1 SELECT (materialized; PF-2 stays STALE with the reason). */
const WORKSTREAM_AFTER_SELECT: WorkstreamSnapshot = {
  ...WORKSTREAM,
  future: {
    plan: {
      orderedItems: [
        { id: 'G-1', kind: 'GATE', title: '起点门' },
        { id: 'T-1', kind: 'TASK', title: '调研' },
        { id: 'T-9', kind: 'TASK', title: '计算验证（PF-1）' },
        { id: 'T-2', kind: 'TASK', title: '实验' },
        { id: 'M-1', kind: 'MILESTONE', title: '中期里程碑' },
      ],
    },
    planForks: [WORKSTREAM.future.planForks[1]],
    unresolvedPlanForkCount: 1,
  },
}

/* -------------------------------------------------------------------- *
 * The owner-WS event log (the drill-down data path)
 * -------------------------------------------------------------------- */

function ev(partial: Omit<HistoryEventDto, 'schemaVersion' | 'recordedAt' | 'eventSeq'> & { seq: number }): HistoryEventDto {
  const { seq, ...rest } = partial
  return { ...rest, schemaVersion: 1, eventSeq: seq, recordedAt: rest.occurredAt + 1 }
}

const EVENTS: readonly HistoryEventDto[] = [
  ev({
    eventId: 'H-1',
    ownerWorkstreamId: 'WS-1',
    eventType: 'RUN_STARTED',
    occurredAt: T,
    actor: { kind: 'USER', user_id: 'u1' },
    source: { kind: 'DSH_SESSION', session_id: 'session-e2e-sess-1' },
    payload: { run_id: 'R-1', dsh_session_id: 'session-e2e-sess-1', intent: '调研高温超导近期进展' },
    seq: 1,
  }),
  ev({
    eventId: 'H-2',
    ownerWorkstreamId: 'WS-1',
    eventType: 'CLAIM_RECORDED',
    occurredAt: T + 1000,
    actor: { kind: 'AGENT', run_id: 'R-1' },
    source: null,
    payload: { claim_id: 'C-1', statement: '铁基超导的机制以电子关联主导', created_by_run: 'R-1' },
    seq: 2,
  }),
  ev({
    eventId: 'H-3',
    ownerWorkstreamId: 'WS-1',
    eventType: 'ARTIFACT_REGISTERED',
    occurredAt: T + 2000,
    actor: { kind: 'AGENT', run_id: 'R-1' },
    source: null,
    payload: {
      artifact_id: 'A-1',
      type: 'REPORT',
      title: '高温超导综述初稿',
      uri: 'file:///workspace/research/notes/htsc-draft.md',
      created_by_run: 'R-1',
      related_task: 'T-1',
    },
    seq: 3,
  }),
  ev({
    eventId: 'H-4',
    ownerWorkstreamId: 'WS-1',
    eventType: 'RELATION_ADDED',
    occurredAt: T + 3000,
    actor: { kind: 'AGENT', run_id: 'R-1' },
    source: null,
    payload: {
      relation_id: 'REL-1',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'ARTIFACT', id: 'A-1' },
    },
    seq: 4,
  }),
  ev({
    eventId: 'H-5',
    ownerWorkstreamId: 'WS-1',
    eventType: 'RELATION_ADDED',
    occurredAt: T + 4000,
    actor: { kind: 'AGENT', run_id: 'R-1' },
    source: null,
    payload: {
      relation_id: 'REL-2',
      source: { kind: 'ARTIFACT', id: 'A-1' },
      relation_type: 'PRODUCED_BY',
      target: { kind: 'RUN', id: 'R-1' },
    },
    seq: 5,
  }),
  ev({
    eventId: 'H-6',
    ownerWorkstreamId: 'WS-1',
    eventType: 'RUN_FINISHED',
    occurredAt: T + 9000,
    actor: { kind: 'AGENT', run_id: 'R-1' },
    source: null,
    payload: { run_id: 'R-1', outcome: 'SUCCESS' },
    seq: 6,
  }),
  ev({
    eventId: 'H-7',
    ownerWorkstreamId: 'WS-1',
    eventType: 'RUN_STARTED',
    occurredAt: T + 10000,
    actor: { kind: 'USER', user_id: 'u1' },
    source: { kind: 'DSH_SESSION', session_id: 'session-e2e-sess-2' },
    payload: { run_id: 'R-2', dsh_session_id: 'session-e2e-sess-2', intent: '整理实验证据' },
    seq: 7,
  }),
  ev({
    eventId: 'H-8',
    ownerWorkstreamId: 'WS-1',
    eventType: 'CLAIM_RECORDED',
    occurredAt: T + 11000,
    actor: { kind: 'AGENT', run_id: 'R-2' },
    source: null,
    payload: { claim_id: 'C-2', statement: '角分辨光谱数据支持关联主导解释', created_by_run: 'R-2' },
    seq: 8,
  }),
]

const HISTORY: QueryHistoryResult = { events: EVENTS, nextAfterSeq: null, exhausted: true }

/* -------------------------------------------------------------------- *
 * Topic snapshot (the contract badge) + Git windows
 * -------------------------------------------------------------------- */

const TOPIC: TopicSnapshot = {
  topic: {
    id: 'TPC-1',
    title: '高温超导',
    description: null,
    importance: null,
    attentionMode: null,
    objectiveRefs: ['OBJ-1'],
    createdAt: T,
  },
  workstreams: [
    {
      id: 'WS-1',
      title: '高温超导机制研究',
      lifecycle: 'REALIZED',
      summary: null,
      planItemCount: 4,
      openPlanForkCount: 1,
      runningRunCount: 1,
    },
  ],
  topology: { edges: [] },
  // TRUE loader form: `contractRelPaths` are `.research`-ROOT-relative
  // (load.ts `merges/<te>/contract.md`) — the GitPanel maps them to the
  // repo-root-relative `.research/**` form the git services require
  // (assertResearchPath).
  mergeContracts: [{ edgeId: 'TE-2', path: 'merges/TE-2/contract.md' }],
  objectives: [],
}

const CONTRACT_PATH = '.research/merges/TE-2/contract.md'
const OID_NEWEST = 'b'.repeat(39) + '1'
const OID_OLDER = 'c'.repeat(39) + '2'

/** The version window: the working copy differs from the newest commit. */
const GIT: GetGitHistoryResult = {
  versions: [
    { oid: OID_NEWEST, authorDate: '2025-08-13T10:00:00+00:00', subject: 'baseline: merge contract TE-2' },
    { oid: OID_OLDER, authorDate: '2025-08-12T10:00:00+00:00', subject: 'seed: merge contract TE-2' },
  ],
  fileDiff: null,
  baseline: null,
  pathContent: null,
}

/** The verdict window: working copy DRIFTS from the newest commit. */
const GIT_DRIFTED: GetGitHistoryResult = {
  ...GIT,
  baseline: OID_NEWEST,
  pathContent: { path: CONTRACT_PATH, sameAsBaseline: false },
}

/** The verdict window after the restore: the copy matches again. */
const GIT_RESTORED: GetGitHistoryResult = {
  ...GIT,
  baseline: OID_NEWEST,
  pathContent: { path: CONTRACT_PATH, sameAsBaseline: true },
}

/* -------------------------------------------------------------------- *
 * Wire validation (strict re-parse at module load)
 * -------------------------------------------------------------------- */

export const DRILLDOWN_DASHBOARD = DashboardSnapshotSchema.parse(DASHBOARD) as DashboardSnapshot
export const DRILLDOWN_DASHBOARD_IV1_PENDING = DashboardSnapshotSchema.parse(DASHBOARD_IV1_PENDING) as DashboardSnapshot
export const DRILLDOWN_DASHBOARD_IV1_CLOSED = DashboardSnapshotSchema.parse(DASHBOARD_IV1_CLOSED) as DashboardSnapshot
export const DRILLDOWN_WORKSTREAM = WorkstreamSnapshotSchema.parse(WORKSTREAM) as WorkstreamSnapshot
export const DRILLDOWN_WORKSTREAM_AFTER_SELECT = WorkstreamSnapshotSchema.parse(WORKSTREAM_AFTER_SELECT) as WorkstreamSnapshot
export const DRILLDOWN_HISTORY = QueryHistoryResultSchema.parse(HISTORY) as QueryHistoryResult
export const DRILLDOWN_TOPIC = TopicSnapshotSchema.parse(TOPIC) as TopicSnapshot
export const DRILLDOWN_GIT = GetGitHistoryResultSchema.parse(GIT) as GetGitHistoryResult
export const DRILLDOWN_GIT_DRIFTED = GetGitHistoryResultSchema.parse(GIT_DRIFTED) as GetGitHistoryResult
export const DRILLDOWN_GIT_RESTORED = GetGitHistoryResultSchema.parse(GIT_RESTORED) as GetGitHistoryResult
export { CONTRACT_PATH, OID_NEWEST, OID_OLDER, T }
