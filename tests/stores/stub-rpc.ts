/**
 * WP-4.1b — stub RPC facade for the store suite.
 *
 * Structurally satisfies `ResearchRpcFacade` (= `typeof researchRpc`,
 * mount.ts) so it is a drop-in for the store's `options.rpc` seam. Every
 * call is recorded (`method` + verbatim `args`); results default to the
 * WIRE-VALID WP-4.1a fixtures (tests/rpc-face/fixtures.ts — the same
 * values the gateway strict decode accepts) wrapped in `ok: true`, and
 * are overridable per method with:
 *  - a plain value (returned as the `RemoteResult`),
 *  - a `Promise` (awaited by the store — timing control),
 *  - an `Error` instance (thrown — simulates a transport/assembly fault;
 *    a business fault is instead the `ok: false` result shape),
 *  - an ARRAY of the above (a per-call SEQUENCE — each call consumes the
 *    next element; once exhausted the last element repeats — the
 *    retry-after-fault face, e.g. bindProject PLANE_TREE_EXISTS → as-is
 *    retry).
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  PingResult,
  DashboardSnapshot,
  ProjectSnapshot,
  TopicSnapshot,
  WorkstreamSnapshot,
  QueryHistoryResult,
  ReorderPlanResult,
  SelectPlanForkResult,
  DismissPlanForkResult,
  UpdateInterventionStateResult,
  RegisterInteractionResult,
  SaveResearchCheckpointResult,
  GetGitHistoryResult,
  RestoreDeclarativeFileResult,
  // V2-T4.1: the 9 plane methods join the facade surface.
  GetResearchPlaneStateArgs,
  GetResearchPlaneStateResult,
  GetHubOverviewArgs,
  HubOverviewResult,
  GetPortfolioInterventionsArgs,
  GetPortfolioInterventionsResult,
  SetHubArgs,
  SetHubResult,
  BindProjectArgs,
  BindProjectResult,
  UnbindProjectArgs,
  UnbindProjectResult,
  RestoreProjectArgs,
  RestoreProjectResult,
  RescanArgs,
  RescanResult,
  AckMissingReminderArgs,
  AckMissingReminderResult,
  // UI-0.4 (R-01): the GUI management face (current-focus pair).
  GetCurrentFocusArgs,
  GetCurrentFocusResult,
  SetCurrentFocusArgs,
  SetCurrentFocusResult,
  // V2-UI-0.4 UI-2: the 6 GUI management faces (4 hierarchy update/drop
  // — UI-2A — + 2 local-project — UI-2B).
  UpdateProjectMetadataArgs,
  UpdateProjectMetadataResult,
  UpdateTopicArgs,
  UpdateTopicResult,
  UpdateWorkstreamArgs,
  UpdateWorkstreamResult,
  DropWorkstreamArgs,
  DropWorkstreamResult,
  InspectProjectDirectoryArgs,
  InspectProjectDirectoryResult,
  CreateLocalResearchProjectArgs,
  CreateLocalResearchProjectResult,
  // V2-UI-0.4 UI-3: the 2 hierarchy CREATE faces (the host RPCs
  // pre-existed; the facade wiring is new this slice).
  CreateTopicArgs,
  CreateTopicResult,
  CreateWorkstreamArgs,
  CreateWorkstreamResult,
  CreateWorkstreamForkArgs,
  CreateWorkstreamForkResult,
  // V2-UI-0.4 UI-4 (D §10): the 7 attention faces.
  GetWorkstreamCurrentArgs,
  GetWorkstreamCurrentResult,
  UpdateObjectiveArgs,
  UpdateObjectiveResult,
  CreateNextActionArgs,
  CreateNextActionResult,
  PromoteNextActionArgs,
  PromoteNextActionResult,
  DismissNextActionArgs,
  DismissNextActionResult,
  CreateBlockerArgs,
  CreateBlockerResult,
  ClearBlockerArgs,
  ClearBlockerResult,
  // V2-UI-0.4 UI-5 (brief §3): the 5 plan-editor faces.
  CreatePlanItemArgs,
  CreatePlanItemResult,
  UpdatePlanItemArgs,
  UpdatePlanItemResult,
  RemovePlanItemArgs,
  RemovePlanItemResult,
  AddDependencyArgs,
  AddDependencyResult,
  RemoveDependencyArgs,
  RemoveDependencyResult,
  // V2-UI-6 (D2, BRIEF §3): the 3 planned-merge / merge-contract faces.
  CreatePlannedMergeArgs,
  CreatePlannedMergeResult,
  GetMergeContractArgs,
  GetMergeContractResult,
  SaveMergeContractArgs,
  SaveMergeContractResult,
  // V2-UI-6 (D3, BRIEF §3): the edge drop face.
  DropTopologyEdgeArgs,
  DropTopologyEdgeResult,
  GetTopicArgs,
  GetWorkstreamArgs,
  QueryHistoryArgs,
  ReorderPlanArgs,
  SelectPlanForkArgs,
  DismissPlanForkArgs,
  UpdateInterventionStateArgs,
  RegisterInteractionArgs,
  SaveResearchCheckpointArgs,
  GetGitHistoryArgs,
  RestoreDeclarativeFileArgs,
} from '../../src/shared/rpc-contracts.js'
import {
  DASHBOARD_FIXTURE,
  PROJECT_FIXTURE,
  TOPIC_FIXTURE,
  WORKSTREAM_FIXTURE,
  HISTORY_FIXTURE,
  REORDER_FIXTURE,
  SELECT_FIXTURE,
  DISMISS_FIXTURE,
  UPDATE_INTERVENTION_FIXTURE,
  REGISTER_INTERACTION_FIXTURE,
  CHECKPOINT_FIXTURE,
  GIT_HISTORY_FIXTURE,
  RESTORE_FIXTURE,
} from '../rpc-face/fixtures.js'
import type { ResearchRpcFacade } from '../../src/client/stores/research-store.js'

/** The 14 facade methods (ping + the frozen 13, ARCHITECTURE §7.1). */
export const FACADE_METHODS = [
  'ping',
  'getDashboard',
  'getProject',
  'getTopic',
  'getWorkstream',
  'queryHistory',
  'reorderPlan',
  'selectPlanFork',
  'dismissPlanFork',
  'updateInterventionState',
  'registerInteraction',
  'saveResearchCheckpoint',
  'getGitHistory',
  'restoreDeclarativeFile',
] as const

export type FacadeMethod = (typeof FACADE_METHODS)[number]

export interface StubCall {
  readonly method: string
  readonly args?: unknown
}

export interface StubRpc {
  /** The facade face (structurally `researchRpc`). */
  readonly rpc: ResearchRpcFacade
  /** Every recorded call, in order. */
  readonly calls: StubCall[]
  /** Recorded calls of one method. */
  callsTo(method: string): StubCall[]
  /** How many times one method was called. */
  countOf(method: string): number
  /**
   * Configure a method's outcome (plain value | Promise | Error to throw;
   * an ARRAY is a per-call SEQUENCE — each call consumes the next element,
   * and once exhausted the LAST element repeats; e.g. a retry-after-fault
   * face: `[faultResult, okResult]`).
   * @param value - the configured outcome; restore with `reset()`.
   */
  set(method: string, value: unknown): void
  /** Clear configurations AND the call log. */
  reset(): void
}

const PING_FIXTURE: PingResult = { ok: true, service: 'researchControl', time: 1755000000000 }

const DEFAULTS: Record<string, () => unknown> = {
  ping: () => ({ ok: true, value: PING_FIXTURE }),
  getDashboard: () => ({ ok: true, value: DASHBOARD_FIXTURE }),
  getProject: () => ({ ok: true, value: PROJECT_FIXTURE }),
  getTopic: () => ({ ok: true, value: TOPIC_FIXTURE }),
  getWorkstream: () => ({ ok: true, value: WORKSTREAM_FIXTURE }),
  queryHistory: () => ({ ok: true, value: HISTORY_FIXTURE }),
  reorderPlan: () => ({ ok: true, value: REORDER_FIXTURE }),
  selectPlanFork: () => ({ ok: true, value: SELECT_FIXTURE }),
  dismissPlanFork: () => ({ ok: true, value: DISMISS_FIXTURE }),
  updateInterventionState: () => ({ ok: true, value: UPDATE_INTERVENTION_FIXTURE }),
  registerInteraction: () => ({ ok: true, value: REGISTER_INTERACTION_FIXTURE }),
  saveResearchCheckpoint: () => ({ ok: true, value: CHECKPOINT_FIXTURE }),
  getGitHistory: () => ({ ok: true, value: GIT_HISTORY_FIXTURE }),
  restoreDeclarativeFile: () => ({ ok: true, value: RESTORE_FIXTURE }),
  // V2-T4.1: wire-valid minimal defaults for the 9 plane methods (the
  // store suite never exercises them by default — they exist so the stub
  // structurally satisfies the full `ResearchRpcFacade` face).
  getResearchPlaneState: () => ({
    ok: true,
    value: {
      hub: null,
      dirNames: { treeDir: '.research', hubDir: '.research-control' },
      projects: [],
      missing: [],
      registry: [],
      session: { cwd: '/workspace/stub', role: 'STANDALONE' },
    },
  }),
  getHubOverview: () => ({
    ok: true,
    value: { totals: { projects: 0, openInterventions: 0, inbox: 0 }, attention: [], cards: [] },
  }),
  getPortfolioInterventions: () => ({ ok: true, value: { items: [] } }),
  setHub: () => ({
    ok: true,
    value: { hubPath: '/workspace/hub', registryPath: '/workspace/hub/.research-control/registry.yaml' },
  }),
  bindProject: () => ({
    ok: true,
    value: {
      projectId: 'PRJ-1',
      registryPath: '/workspace/hub/.research-control/registry.yaml',
      dbMigrated: false,
    },
  }),
  unbindProject: () => ({
    ok: true,
    value: { projectId: 'PRJ-1', archivedDir: '/workspace/hub/.research-control/archived/PRJ-1' },
  }),
  restoreProject: () => ({ ok: true, value: { wsPath: '/workspace/PRJ-1' } }),
  rescan: () => ({
    ok: true,
    value: {
      hub: null,
      dirNames: { treeDir: '.research', hubDir: '.research-control' },
      projects: [],
      missing: [],
      registry: [],
    },
  }),
  ackMissingReminder: () => ({ ok: true, value: { acknowledged: true } }),
  // UI-0.4 (R-01): wire-valid minimal defaults for the GUI management
  // pair — LOCAL to this stub (the CF face has no entries in
  // tests/rpc-face/fixtures.ts); the store suite overrides per-test.
  setCurrentFocus: () => ({
    ok: true,
    value: { workstreamId: 'WS-1', planItemId: 'T-1', updatedAt: 1755000001000 },
  }),
  getCurrentFocus: () => ({ ok: true, value: { workstreamId: 'WS-1', focus: null } }),
  // V2-UI-0.4 UI-2: wire-valid minimal defaults for the 6 GUI management
  // faces — LOCAL to this stub (same convention as the CF pair); the
  // store suite overrides per-test.
  updateProjectMetadata: () => ({
    ok: true,
    value: { projectId: 'PRJ-1', title: 'Stub project', updatedAt: 1755000004000 },
  }),
  updateTopic: () => ({
    ok: true,
    value: { topicId: 'TPC-1', title: 'Stub topic', updatedAt: 1755000005000 },
  }),
  updateWorkstream: () => ({
    ok: true,
    value: { workstreamId: 'WS-1', topicId: 'TPC-1', title: 'Stub ws', updatedAt: 1755000006000 },
  }),
  dropWorkstream: () => ({
    ok: true,
    value: { workstreamId: 'WS-1', topicId: 'TPC-1', currentFocusCleared: false },
  }),
  inspectProjectDirectory: () => ({
    ok: true,
    value: {
      wsPath: '/workspace/stub',
      state: 'RC_PROJECT',
      message: 'Existing Research Control project detected.',
      detail: null,
      hasGitRepo: true,
      hasResearchTree: true,
      treeValid: true,
      alreadyManaged: true,
      projectId: 'PRJ-1',
      title: 'Stub project',
    },
  }),
  createLocalResearchProject: () => ({
    ok: true,
    value: { ok: true, projectId: 'PRJ-9', treePath: '/workspace/stub/.research', registryPath: null, dbMigrated: false },
  }),
  // V2-UI-0.4 UI-3: wire-valid minimal defaults for the 2 hierarchy
  // CREATE faces — LOCAL to this stub (same convention as the UI-2
  // block); the store suite overrides per-test.
  createTopic: () => ({
    ok: true,
    value: { topicId: 'TPC-9', title: 'Stub new topic', path: '/workspace/stub/.research/topics/TPC-9', createdAt: 1755000009000 },
  }),
  createWorkstream: () => ({
    ok: true,
    value: { workstreamId: 'WS-9', topicId: 'TPC-1', title: 'Stub new ws', path: '/workspace/stub/.research/topics/TPC-1/WS-9', createdAt: 1755000009000 },
  }),
  // V2-UI-0.4 UI-4 (D §10): wire-valid minimal defaults for the 7
  // attention faces — LOCAL to this stub (same convention as the UI-3
  // block); the store suite overrides per-test.
  getWorkstreamCurrent: () => ({
    ok: true,
    value: {
      workstreamId: 'WS-1',
      objectives: [],
      explicitBlockers: [],
      derivedBlockers: [],
      nextActions: [],
      interventions: [],
      dependencyEdges: [],
    },
  }),
  updateObjective: () => ({
    ok: true,
    value: { objectiveId: 'OBJ-1', status: 'ACTIVE', managementActionId: 'MA-1', updatedAt: 1755000010000 },
  }),
  createNextAction: () => ({
    ok: true,
    value: {
      nextAction: {
        id: 'NA-1',
        workstreamId: 'WS-1',
        statement: 'Stub next action',
        rationale: null,
        status: 'PROPOSED',
        promotedToTaskId: null,
        createdAt: 1755000011000,
      },
    },
  }),
  promoteNextAction: () => ({
    ok: true,
    value: {
      nextActionId: 'NA-1',
      taskId: 'T-9',
      workstreamId: 'WS-1',
      planPath: '/workspace/stub/.research/topics/TPC-1/WS-1/plan.yaml',
      newOrder: ['G-1', 'T-9', 'M-1'],
      managementActionId: 'MA-2',
    },
  }),
  dismissNextAction: () => ({
    ok: true,
    value: {
      nextAction: {
        id: 'NA-1',
        workstreamId: 'WS-1',
        statement: 'Stub next action',
        rationale: null,
        status: 'DISMISSED',
        promotedToTaskId: null,
        createdAt: 1755000011000,
      },
    },
  }),
  createBlocker: () => ({
    ok: true,
    value: {
      blocker: {
        id: 'BLK-1',
        statement: 'Stub blocker',
        affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
        status: 'ACTIVE',
        source: 'UI',
        references: null,
        createdAt: 1755000012000,
        clearedAt: null,
      },
    },
  }),
  clearBlocker: () => ({
    ok: true,
    value: {
      blocker: {
        id: 'BLK-1',
        statement: 'Stub blocker',
        affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
        status: 'CLEARED',
        source: 'UI',
        references: null,
        createdAt: 1755000012000,
        clearedAt: 1755000013000,
      },
    },
  }),
  // V2-UI-0.4 UI-5 (brief §3): wire-valid minimal defaults for the 5
  // plan-editor faces — LOCAL to this stub (same convention as the UI-4
  // block); the store suite overrides per-test.
  createPlanItem: () => ({
    ok: true,
    value: {
      itemId: 'T-9',
      workstreamId: 'WS-1',
      kind: 'TASK',
      planPath: 'workstreams/WS-1/plan.yaml',
      newOrder: ['T-9'],
      managementActionId: 'MA-1',
    },
  }),
  updatePlanItem: () => ({
    ok: true,
    value: { itemId: 'T-9', workstreamId: 'WS-1', updatedAt: 1755000030000 },
  }),
  removePlanItem: () => ({
    ok: true,
    value: {
      workstreamId: 'WS-1',
      planPath: 'workstreams/WS-1/plan.yaml',
      newOrder: ['T-1'],
      managementActionId: 'MA-2',
      currentFocusCleared: false,
    },
  }),
  addDependency: () => ({
    ok: true,
    value: {
      relationId: 'REL-1',
      source: { kind: 'TASK', id: 'T-1' },
      target: { kind: 'TASK', id: 'T-9' },
    },
  }),
  removeDependency: () => ({
    ok: true,
    value: { relationId: 'REL-1' },
  }),
  // V2-UI-6 (D1, D §12.2): wire-valid minimal default for the topology
  // fork face — LOCAL to this stub (same convention); the store suite
  // overrides per-test.
  createWorkstreamFork: () => ({
    ok: true,
    value: {
      topicId: 'TPC-1',
      edgeIds: ['TE-3'],
      workstreamIds: ['WS-9'],
      managementActionId: 'MA-9',
    },
  }),
  // V2-UI-6 (D2, BRIEF §3): wire-valid minimal defaults for the 3
  // planned-merge / merge-contract faces — LOCAL to this stub (same
  // convention); the store suite overrides per-test.
  createPlannedMerge: () => ({
    ok: true,
    value: {
      edgeId: 'TE-3',
      topicId: 'TPC-1',
      inputs: ['WS-1', 'WS-2'],
      outputWorkstreamId: 'WS-3',
      lifecycle: 'PLANNED',
      managementActionId: 'MA-9',
    },
  }),
  getMergeContract: () => ({
    ok: true,
    value: {
      edgeId: 'TE-2',
      content: '# Merge contract\n',
      path: 'merges/TE-2/contract.md',
    },
  }),
  saveMergeContract: () => ({
    ok: true,
    value: {
      edgeId: 'TE-2',
      path: 'merges/TE-2/contract.md',
      managementActionId: 'MA-9',
    },
  }),
  dropTopologyEdge: () => ({
    ok: true,
    value: {
      edgeId: 'TE-1',
      topicId: 'TPC-1',
      lifecycle: 'DROPPED',
      managementActionId: 'MA-9',
    },
  }),
}

/**
 * Build a stub facade.
 * @returns the stub (facade + call log + outcome configurator).
 */
export function makeStubRpc(): StubRpc {
  const configured = new Map<string, unknown>()
  const sequences = new Map<string, number>()
  const calls: StubCall[] = []

  /** The next configured outcome for one call (array ⇒ per-call sequence, last repeats). */
  function nextOutcome(method: string): unknown {
    const value = configured.get(method)
    if (value === undefined) return DEFAULTS[method]()
    if (!Array.isArray(value)) return value
    if (value.length === 0) throw new Error(`stub: empty outcome sequence for ${method}`)
    const index = sequences.get(method) ?? 0
    const next = value[Math.min(index, value.length - 1)]!
    sequences.set(method, index + 1)
    return next
  }

  function deliver<R>(method: string): R {
    calls.push({ method })
    const outcome = nextOutcome(method)
    if (outcome instanceof Error) throw outcome
    return outcome as R
  }

  function deliverArgs<R>(method: string, args: unknown): R {
    calls.push({ method, args })
    const outcome = nextOutcome(method)
    if (outcome instanceof Error) throw outcome
    return outcome as R
  }

  const rpc: ResearchRpcFacade = {
    ping: async () => deliver<RemoteResult<PingResult>>('ping'),
    getDashboard: async () => deliver<RemoteResult<DashboardSnapshot>>('getDashboard'),
    getProject: async () => deliver<RemoteResult<ProjectSnapshot>>('getProject'),
    getTopic: async (args: GetTopicArgs) => deliverArgs<RemoteResult<TopicSnapshot>>('getTopic', args),
    getWorkstream: async (args: GetWorkstreamArgs) => deliverArgs<RemoteResult<WorkstreamSnapshot>>('getWorkstream', args),
    queryHistory: async (args: QueryHistoryArgs) => deliverArgs<RemoteResult<QueryHistoryResult>>('queryHistory', args),
    reorderPlan: async (args: ReorderPlanArgs) => deliverArgs<RemoteResult<ReorderPlanResult>>('reorderPlan', args),
    selectPlanFork: async (args: SelectPlanForkArgs) => deliverArgs<RemoteResult<SelectPlanForkResult>>('selectPlanFork', args),
    dismissPlanFork: async (args: DismissPlanForkArgs) =>
      deliverArgs<RemoteResult<DismissPlanForkResult>>('dismissPlanFork', args),
    updateInterventionState: async (args: UpdateInterventionStateArgs) =>
      deliverArgs<RemoteResult<UpdateInterventionStateResult>>('updateInterventionState', args),
    registerInteraction: async (args: RegisterInteractionArgs) =>
      deliverArgs<RemoteResult<RegisterInteractionResult>>('registerInteraction', args),
    saveResearchCheckpoint: async (args: SaveResearchCheckpointArgs) =>
      deliverArgs<RemoteResult<SaveResearchCheckpointResult>>('saveResearchCheckpoint', args),
    getGitHistory: async (args: GetGitHistoryArgs) =>
      deliverArgs<RemoteResult<GetGitHistoryResult>>('getGitHistory', args),
    restoreDeclarativeFile: async (args: RestoreDeclarativeFileArgs) =>
      deliverArgs<RemoteResult<RestoreDeclarativeFileResult>>('restoreDeclarativeFile', args),
    // V2-T4.1: the 9 plane methods (the 23-method face).
    getResearchPlaneState: async (args: GetResearchPlaneStateArgs) =>
      deliverArgs<RemoteResult<GetResearchPlaneStateResult>>('getResearchPlaneState', args),
    getHubOverview: async (args: GetHubOverviewArgs) =>
      deliverArgs<RemoteResult<HubOverviewResult>>('getHubOverview', args),
    getPortfolioInterventions: async (args: GetPortfolioInterventionsArgs) =>
      deliverArgs<RemoteResult<GetPortfolioInterventionsResult>>('getPortfolioInterventions', args),
    setHub: async (args: SetHubArgs) => deliverArgs<RemoteResult<SetHubResult>>('setHub', args),
    bindProject: async (args: BindProjectArgs) =>
      deliverArgs<RemoteResult<BindProjectResult>>('bindProject', args),
    unbindProject: async (args: UnbindProjectArgs) =>
      deliverArgs<RemoteResult<UnbindProjectResult>>('unbindProject', args),
    restoreProject: async (args: RestoreProjectArgs) =>
      deliverArgs<RemoteResult<RestoreProjectResult>>('restoreProject', args),
    rescan: async (args: RescanArgs) => deliverArgs<RemoteResult<RescanResult>>('rescan', args),
    ackMissingReminder: async (args: AckMissingReminderArgs) =>
      deliverArgs<RemoteResult<AckMissingReminderResult>>('ackMissingReminder', args),
    // UI-0.4 (R-01): the GUI management face — deliberately NOT in
    // FACADE_METHODS (that list tracks the frozen 14; same convention
    // as the 9 plane methods).
    setCurrentFocus: async (args: SetCurrentFocusArgs) =>
      deliverArgs<RemoteResult<SetCurrentFocusResult>>('setCurrentFocus', args),
    getCurrentFocus: async (args: GetCurrentFocusArgs) =>
      deliverArgs<RemoteResult<GetCurrentFocusResult>>('getCurrentFocus', args),
    // V2-UI-0.4 UI-2: the 6 GUI management faces.
    updateProjectMetadata: async (args: UpdateProjectMetadataArgs) =>
      deliverArgs<RemoteResult<UpdateProjectMetadataResult>>('updateProjectMetadata', args),
    updateTopic: async (args: UpdateTopicArgs) =>
      deliverArgs<RemoteResult<UpdateTopicResult>>('updateTopic', args),
    updateWorkstream: async (args: UpdateWorkstreamArgs) =>
      deliverArgs<RemoteResult<UpdateWorkstreamResult>>('updateWorkstream', args),
    dropWorkstream: async (args: DropWorkstreamArgs) =>
      deliverArgs<RemoteResult<DropWorkstreamResult>>('dropWorkstream', args),
    inspectProjectDirectory: async (args: InspectProjectDirectoryArgs) =>
      deliverArgs<RemoteResult<InspectProjectDirectoryResult>>('inspectProjectDirectory', args),
    createLocalResearchProject: async (args: CreateLocalResearchProjectArgs) =>
      deliverArgs<RemoteResult<CreateLocalResearchProjectResult>>('createLocalResearchProject', args),
    createTopic: async (args: CreateTopicArgs) =>
      deliverArgs<RemoteResult<CreateTopicResult>>('createTopic', args),
    createWorkstream: async (args: CreateWorkstreamArgs) =>
      deliverArgs<RemoteResult<CreateWorkstreamResult>>('createWorkstream', args),
    // V2-UI-0.4 UI-4 (D §10): the 7 attention faces (same record/override
    // contract — the store suite drives them per-test).
    getWorkstreamCurrent: async (args: GetWorkstreamCurrentArgs) =>
      deliverArgs<RemoteResult<GetWorkstreamCurrentResult>>('getWorkstreamCurrent', args),
    updateObjective: async (args: UpdateObjectiveArgs) =>
      deliverArgs<RemoteResult<UpdateObjectiveResult>>('updateObjective', args),
    createNextAction: async (args: CreateNextActionArgs) =>
      deliverArgs<RemoteResult<CreateNextActionResult>>('createNextAction', args),
    promoteNextAction: async (args: PromoteNextActionArgs) =>
      deliverArgs<RemoteResult<PromoteNextActionResult>>('promoteNextAction', args),
    dismissNextAction: async (args: DismissNextActionArgs) =>
      deliverArgs<RemoteResult<DismissNextActionResult>>('dismissNextAction', args),
    createBlocker: async (args: CreateBlockerArgs) =>
      deliverArgs<RemoteResult<CreateBlockerResult>>('createBlocker', args),
    clearBlocker: async (args: ClearBlockerArgs) =>
      deliverArgs<RemoteResult<ClearBlockerResult>>('clearBlocker', args),
    // V2-UI-0.4 UI-5 (brief §3): the 5 plan-editor methods.
    createPlanItem: async (args: CreatePlanItemArgs) =>
      deliverArgs<RemoteResult<CreatePlanItemResult>>('createPlanItem', args),
    updatePlanItem: async (args: UpdatePlanItemArgs) =>
      deliverArgs<RemoteResult<UpdatePlanItemResult>>('updatePlanItem', args),
    removePlanItem: async (args: RemovePlanItemArgs) =>
      deliverArgs<RemoteResult<RemovePlanItemResult>>('removePlanItem', args),
    addDependency: async (args: AddDependencyArgs) =>
      deliverArgs<RemoteResult<AddDependencyResult>>('addDependency', args),
    removeDependency: async (args: RemoveDependencyArgs) =>
      deliverArgs<RemoteResult<RemoveDependencyResult>>('removeDependency', args),
    createWorkstreamFork: async (args: CreateWorkstreamForkArgs) =>
      deliverArgs<RemoteResult<CreateWorkstreamForkResult>>('createWorkstreamFork', args),
    // V2-UI-6 (D2, BRIEF §3): the 3 planned-merge / merge-contract
    // methods.
    createPlannedMerge: async (args: CreatePlannedMergeArgs) =>
      deliverArgs<RemoteResult<CreatePlannedMergeResult>>('createPlannedMerge', args),
    getMergeContract: async (args: GetMergeContractArgs) =>
      deliverArgs<RemoteResult<GetMergeContractResult>>('getMergeContract', args),
    saveMergeContract: async (args: SaveMergeContractArgs) =>
      deliverArgs<RemoteResult<SaveMergeContractResult>>('saveMergeContract', args),
    // V2-UI-6 (D3, BRIEF §3): the edge drop method.
    dropTopologyEdge: async (args: DropTopologyEdgeArgs) =>
      deliverArgs<RemoteResult<DropTopologyEdgeResult>>('dropTopologyEdge', args),
  }

  return {
    rpc,
    calls,
    callsTo: method => calls.filter(call => call.method === method),
    countOf: method => calls.filter(call => call.method === method).length,
    set: (method, value) => {
      configured.set(method, value)
    },
    reset: () => {
      configured.clear()
      sequences.clear()
      calls.length = 0
    },
  }
}
