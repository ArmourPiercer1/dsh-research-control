/**
 * WP-4.1a — shared test fixtures for the rpc-face suite.
 *
 * Every fixture is a WIRE-VALID value for its result DTO: each test that
 * asserts a fixture also re-parses it through the strict result schema
 * (emulating the gateway's strict result decode) — a fixture that drifts
 * from the contract fails the suite, not the wire.
 */

import {
  type DashboardSnapshot,
  type DismissPlanForkResult,
  type GetGitHistoryResult,
  type ProjectSnapshot,
  type QueryHistoryResult,
  type ReorderPlanResult,
  type RegisterInteractionResult,
  type RestoreDeclarativeFileResult,
  type SaveResearchCheckpointResult,
  type SelectPlanForkResult,
  type TopicSnapshot,
  type UpdateInterventionStateResult,
  type WorkstreamSnapshot,
} from '../../src/shared/rpc-contracts.js'

const T = 1755000000000
export const OID = 'a'.repeat(40)

export const DASHBOARD_FIXTURE: DashboardSnapshot = {
  project: {
    id: 'PRJ-1',
    title: 'Project One',
    description: null,
    importance: 3,
    attentionMode: 'NORMAL',
    targetDate: null,
  },
  topics: [{ id: 'TPC-1', title: 'Topic One', workstreamCount: 1 }],
  openInterventions: [
    {
      id: 'IV-1',
      title: 'Review accumulated agent plan forks [WS-1]',
      origin: 'AUTO_FLOODING',
      status: 'OPEN',
      workstreamIds: ['WS-1'],
      createdAt: T,
    },
  ],
  pendingInterventions: [],
  scheduledEvents: null,
  reportingItems: null,
  inboxCount: null,
  attention: null,
}

export const PROJECT_FIXTURE: ProjectSnapshot = {
  project: {
    id: 'PRJ-1',
    title: 'Project One',
    description: 'A research project',
    importance: 3,
    attentionMode: 'FOCUS',
    targetDate: T,
    currentObjectiveRefs: ['OBJ-1'],
    createdAt: T,
  },
  objectives: [
    {
      id: 'OBJ-1',
      scope: 'PROJECT',
      statement: 'Understand the system',
      status: 'ACTIVE',
      priority: 'P1',
      targetDate: null,
    },
  ],
  topics: [{ id: 'TPC-1', title: 'Topic One', workstreamCount: 1 }],
  upcomingInteractions: null,
  upcomingReporting: null,
}

export const TOPIC_FIXTURE: TopicSnapshot = {
  topic: {
    id: 'TPC-1',
    title: 'Topic One',
    description: null,
    importance: null,
    attentionMode: null,
    objectiveRefs: ['OBJ-2'],
    createdAt: T,
  },
  workstreams: [
    {
      id: 'WS-1',
      title: 'Workstream One',
      lifecycle: 'REALIZED',
      summary: null,
      planItemCount: 3,
      openPlanForkCount: 1,
      runningRunCount: 1,
    },
  ],
  topology: {
    edges: [
      {
        id: 'TE-1',
        operation: 'FORK',
        lifecycle: 'PLANNED',
        inputs: ['WS-1'],
        outputs: ['WS-2'],
        note: null,
      },
    ],
  },
  mergeContracts: [{ edgeId: 'TE-1', path: 'merges/TE-1/contract.md' }],
  objectives: [
    {
      id: 'OBJ-2',
      scope: 'TOPIC',
      statement: 'Ship the first slice',
      status: 'ACTIVE',
      priority: 'P0',
      targetDate: T,
    },
  ],
}

export const WORKSTREAM_FIXTURE: WorkstreamSnapshot = {
  workstream: {
    id: 'WS-1',
    topicId: 'TPC-1',
    title: 'Workstream One',
    lifecycle: 'REALIZED',
    summary: null,
    createdAt: T,
  },
  history: { eventCount: 2 },
  current: {
    tasks: [
      {
        id: 'T-1',
        title: 'Task One',
        execution: 'ACTIVE',
        validation: 'PENDING',
        acceptanceCriteria: ['acceptance criterion 1'],
        liveRunIds: ['R-1'],
      },
    ],
    runs: [
      {
        id: 'R-1',
        status: 'RUNNING',
        taskId: 'T-1',
        intent: 'execute task one',
        startedAt: T,
        endedAt: null,
        lastCheckpointAt: T + 100,
        lastCheckpointNote: 'halfway',
      },
    ],
  },
  future: {
    plan: {
      orderedItems: [
        { id: 'G-1', kind: 'GATE', title: 'Gate One' },
        { id: 'T-1', kind: 'TASK', title: 'Task One' },
        { id: 'M-1', kind: 'MILESTONE', title: 'Milestone One' },
      ],
    },
    planForks: [
      {
        id: 'PF-1',
        status: 'OPEN',
        reason: 'the plan misses the baseline experiment',
        necessity: 'the objective depends on it',
        forkAnchor: 'T-1',
        mergeAnchor: 'T-1',
        createdByRun: 'R-2',
        createdAt: T,
        staleReason: null,
        proposedItemCount: 1,
        baseGitCommit: OID,
      },
    ],
    unresolvedPlanForkCount: 1,
  },
}

export const HISTORY_FIXTURE: QueryHistoryResult = {
  events: [
    {
      eventId: 'H-1',
      ownerWorkstreamId: 'WS-1',
      eventType: 'RUN_STARTED',
      schemaVersion: 1,
      occurredAt: T,
      actor: { kind: 'USER', user_id: 'u1' },
      source: { kind: 'DSH_SESSION', session_id: 'sess-1' },
      payload: { run_id: 'R-1' },
      eventSeq: 1,
      recordedAt: T + 1,
    },
  ],
  nextAfterSeq: null,
  exhausted: true,
}

export const REORDER_FIXTURE: ReorderPlanResult = {
  workstreamId: 'WS-1',
  orderedItemIds: ['G-1', 'M-1', 'T-1'],
  planPath: 'topics/TPC-1/workstreams/WS-1/plan.yaml',
  managementActionId: 'MA-1',
}

export const SELECT_FIXTURE: SelectPlanForkResult = {
  planForkId: 'PF-1',
  workstreamId: 'WS-1',
  statusBefore: 'OPEN',
  statusAfter: 'SELECTED',
  selectedAt: T,
  oldOrder: ['G-1', 'T-1', 'M-1'],
  newOrder: ['G-1', 'T-1', 'T-2', 'M-1'],
  newItems: [
    { id: 'T-2', kind: 'TASK', path: 'topics/TPC-1/workstreams/WS-1/items/tasks/T-2.yaml' },
  ],
  removedIds: [],
  staleOthers: [{ planForkId: 'PF-2', staleReason: 'superseded by PF-1 selection' }],
  planYamlPath: 'topics/TPC-1/workstreams/WS-1/plan.yaml',
  checkpointHint: 'a plan.yaml rewrite landed — consider saveResearchCheckpoint (explicit, never automatic)',
}

export const DISMISS_FIXTURE: DismissPlanForkResult = {
  planForkId: 'PF-3',
  workstreamId: 'WS-1',
  statusBefore: 'STALE',
  statusAfter: 'DISMISSED',
  dismissedAt: T,
}

export const UPDATE_INTERVENTION_FIXTURE: UpdateInterventionStateResult = {
  interventionId: 'IV-1',
  statusFrom: 'OPEN',
  statusTo: 'CLOSED',
  closedAt: T,
  resolutionNote: 'reviewed and resolved',
}

export const REGISTER_INTERACTION_FIXTURE: RegisterInteractionResult = {
  id: 'INT-1',
  kind: 'MEETING',
  title: 'Supervisor sync',
  occurredAt: T,
  participants: ['alice'],
  notes: null,
  relatedWorkstreams: ['WS-1'],
  createdAt: T,
}

export const CHECKPOINT_FIXTURE: SaveResearchCheckpointResult = {
  committed: true,
  commitOid: OID,
  changedFiles: ['.research/project.yaml'],
  warnings: [],
  message: 'research: save progress',
}

export const GIT_HISTORY_FIXTURE: GetGitHistoryResult = {
  versions: [{ oid: OID, authorDate: '2026-08-22T00:00:00Z', subject: 'research: init' }],
  fileDiff: null,
  baseline: null,
  pathContent: null,
}

export const RESTORE_FIXTURE: RestoreDeclarativeFileResult = {
  path: '.research/project.yaml',
  commitOid: OID,
  validationOk: true,
  validationErrors: [],
  warnings: [],
}
