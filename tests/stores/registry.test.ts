/**
 * WP-4.1b — invalidate/refetch registry tests: the frozen
 * `mutation -> affected slice keys` mapping (task brief item 2,
 * test item 3). Pure-function assertions — no store, no I/O.
 */

import { describe, expect, it } from 'vitest'
import type {
  AddDependencyResult,
  ClearBlockerResult,
  CreateBlockerResult,
  CreateLocalResearchProjectResult,
  CreateNextActionResult,
  CreatePlanItemResult,
  CreatePlannedMergeResult,
  CreateTopicResult,
  CreateWorkstreamForkResult,
  CreateWorkstreamResult,
  DashboardSnapshot,
  DismissNextActionResult,
  DismissPlanForkResult,
  DropTopologyEdgeResult,
  DropWorkstreamResult,
  GetCurrentFocusResult,
  GetGitHistoryResult,
  GetMergeContractResult,
  GetWorkstreamCurrentResult,
  InspectProjectDirectoryResult,
  ProjectSnapshot,
  PromoteNextActionResult,
  QueryHistoryResult,
  ReorderPlanResult,
  RemoveDependencyResult,
  RemovePlanItemResult,
  RegisterInteractionResult,
  RestoreDeclarativeFileResult,
  SaveMergeContractResult,
  SaveResearchCheckpointResult,
  SelectPlanForkResult,
  SetCurrentFocusResult,
  TopicSnapshot,
  UpdateInterventionStateResult,
  UpdateObjectiveResult,
  UpdatePlanItemResult,
  UpdateProjectMetadataResult,
  UpdateTopicResult,
  UpdateWorkstreamResult,
  WorkstreamSnapshot,
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
import {
  initialResearchStoreState,
  type ResearchStoreState,
  type SliceState,
} from '../../src/client/stores/model.js'
import {
  INVALIDATE_REGISTRY,
  type MutationId,
  MUTATION_IDS,
} from '../../src/client/stores/registry.js'

const ready = <T>(data: T): SliceState<T> => ({
  status: 'ready',
  data,
  error: null,
  updatedAt: 1755000000000,
})

/**
 * A fully-populated state: every slice family holds ready entries
 * (dashboard, project, TPC-1, WS-1 [topicId TPC-1], one history window,
 * one gitHistory window, one current-focus pointer, two current
 * aggregates — WS-1 and WS-2) — the maximal cache the rules must
 * address.
 */
function populatedState(): ResearchStoreState {
  return {
    dashboard: ready<DashboardSnapshot>(DASHBOARD_FIXTURE),
    project: ready<ProjectSnapshot>(PROJECT_FIXTURE),
    topics: new Map([['TPC-1', ready<TopicSnapshot>(TOPIC_FIXTURE)]]),
    workstreams: new Map([['WS-1', ready<WorkstreamSnapshot>(WORKSTREAM_FIXTURE)]]),
    history: new Map([['WS-1|order=semantic|after=0|before=|limit=', ready<QueryHistoryResult>(HISTORY_FIXTURE)]]),
    gitHistory: new Map([
      ['path=.research/project.yaml|baseline=|max=|skip=', ready<GetGitHistoryResult>(GIT_HISTORY_FIXTURE)],
      ['path=|baseline=|max=10|skip=0', ready<GetGitHistoryResult>(GIT_HISTORY_FIXTURE)],
    ]),
    currentFocus: new Map([
      [
        'WS-1',
        ready<GetCurrentFocusResult>({
          workstreamId: 'WS-1',
          focus: { planItemId: 'T-1', updatedAt: 1755000000000 },
        }),
      ],
    ]),
    current: new Map([
      ['WS-1', ready<GetWorkstreamCurrentResult>(CURRENT_WS1)],
      ['WS-2', ready<GetWorkstreamCurrentResult>(CURRENT_WS2)],
    ]),
  }
}

const REORDER: ReorderPlanResult = REORDER_FIXTURE
const SELECT: SelectPlanForkResult = SELECT_FIXTURE
const DISMISS: DismissPlanForkResult = DISMISS_FIXTURE
const UPDATE_IV: UpdateInterventionStateResult = UPDATE_INTERVENTION_FIXTURE
const REGISTER: RegisterInteractionResult = REGISTER_INTERACTION_FIXTURE
const CHECKPOINT: SaveResearchCheckpointResult = CHECKPOINT_FIXTURE
const RESTORE: RestoreDeclarativeFileResult = RESTORE_FIXTURE
const SET_FOCUS: SetCurrentFocusResult = {
  workstreamId: 'WS-1',
  planItemId: 'T-1',
  updatedAt: 1755000001000,
}

// V2-UI-0.4 UI-2: the six GUI management result fixtures (local — same
// convention as SET_FOCUS; the values are wire-valid).
const UPDATE_META: UpdateProjectMetadataResult = {
  projectId: 'PRJ-1',
  title: 'Updated project',
  updatedAt: 1755000004000,
}
const UPDATE_TOPIC: UpdateTopicResult = {
  topicId: 'TPC-2',
  title: 'Updated topic',
  updatedAt: 1755000005000,
}
const UPDATE_WS: UpdateWorkstreamResult = {
  workstreamId: 'WS-4',
  topicId: 'TPC-1',
  title: 'Updated workstream',
  updatedAt: 1755000006000,
}
const DROP_WS: DropWorkstreamResult = {
  workstreamId: 'WS-4',
  topicId: 'TPC-1',
  currentFocusCleared: true,
}
const CREATE_OK: CreateLocalResearchProjectResult = {
  ok: true,
  projectId: 'PRJ-9',
  treePath: '/tmp/ui2-ws/.research',
  registryPath: null,
  dbMigrated: false,
}
const CREATE_FAIL: CreateLocalResearchProjectResult = {
  ok: false,
  code: 'LP_GIT_INIT',
  failedStep: 'gitInit',
  completedSteps: ['mkdir'],
  partialChangeNote: 'The tree directory /tmp/ui2-ws/.research was created.',
  detail: 'git init failed',
}
const INSPECT: InspectProjectDirectoryResult = {
  wsPath: '/tmp/ui2-ws',
  state: 'RC_PROJECT',
  message: 'Existing Research Control project detected.',
  detail: null,
  hasGitRepo: true,
  hasResearchTree: true,
  treeValid: true,
  alreadyManaged: true,
  projectId: 'PRJ-1',
  title: 'A project',
}

// V2-UI-0.4 UI-3: the 2 hierarchy CREATE result fixtures (local, wire-valid).
const CREATE_TOPIC: CreateTopicResult = {
  topicId: 'TPC-3',
  title: 'Created topic',
  path: '/tmp/ui3-ws/.research/topics/TPC-3',
  createdAt: 1755000007000,
}
const CREATE_WS: CreateWorkstreamResult = {
  workstreamId: 'WS-7',
  topicId: 'TPC-1',
  title: 'Created workstream',
  path: '/tmp/ui3-ws/.research/topics/TPC-1/WS-7',
  createdAt: 1755000007000,
}

// V2-UI-6 D1: the fork result fixture (local — wire-valid per the frozen
// BRIEF §3 contract 1).
const FORK_RESULT: CreateWorkstreamForkResult = {
  topicId: 'TPC-1',
  edgeIds: ['TE-3'],
  workstreamIds: ['WS-9'],
  managementActionId: 'MA-9',
}

// V2-UI-6 D2: the planned-merge / merge-contract result fixtures
// (local — wire-valid per the frozen BRIEF §3 contracts 2/4/5).
const MERGE_RESULT: CreatePlannedMergeResult = {
  edgeId: 'TE-3',
  topicId: 'TPC-1',
  inputs: ['WS-1', 'WS-3'],
  outputWorkstreamId: 'WS-2',
  lifecycle: 'PLANNED',
  managementActionId: 'MA-9',
}
const GET_CONTRACT_RESULT: GetMergeContractResult = {
  edgeId: 'TE-1',
  content: null,
  path: 'merges/TE-1/contract.md',
}
const SAVE_CONTRACT_RESULT: SaveMergeContractResult = {
  edgeId: 'TE-1',
  path: 'merges/TE-1/contract.md',
  managementActionId: 'MA-9',
}

// V2-UI-6 D3: the edge-drop result fixture (local — wire-valid per the
// frozen BRIEF §3 contract 3).
const DROP_RESULT: DropTopologyEdgeResult = {
  edgeId: 'TE-1',
  topicId: 'TPC-1',
  lifecycle: 'DROPPED',
  managementActionId: 'MA-9',
}

// V2-UI-4: the six workstream-management result fixtures (local — same
// convention as the UI-2/UI-3 fixtures above; the values are wire-valid).
const CURRENT_WS1: GetWorkstreamCurrentResult = {
  workstreamId: 'WS-1',
  objectives: [
    {
      id: 'OBJ-1',
      scope: 'TOPIC',
      statement: 'Ship the calibration prototype',
      status: 'ACTIVE',
      priority: 'P1',
      targetDate: null,
      successCriteria: ['Reprojection error < 2px'],
      linkedRefs: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
    },
  ],
  explicitBlockers: [],
  derivedBlockers: [],
  nextActions: [],
  interventions: [],
  dependencyEdges: [],
}
const CURRENT_WS2: GetWorkstreamCurrentResult = {
  workstreamId: 'WS-2',
  objectives: [],
  explicitBlockers: [],
  derivedBlockers: [],
  nextActions: [],
  interventions: [],
  dependencyEdges: [],
}
const UPDATE_OBJ: UpdateObjectiveResult = {
  objectiveId: 'OBJ-1',
  status: 'ACTIVE',
  managementActionId: 'MA-42',
  updatedAt: 1755000010000,
}
const CREATE_NA: CreateNextActionResult = {
  nextAction: {
    id: 'NA-1',
    workstreamId: 'WS-1',
    statement: 'Calibrate the lens array',
    rationale: null,
    status: 'PROPOSED',
    promotedToTaskId: null,
    createdAt: 1755000011000,
  },
}
const CREATE_NA_WSLESS: CreateNextActionResult = {
  nextAction: {
    id: 'NA-2',
    workstreamId: null,
    statement: 'Scope the fallback sensor',
    rationale: 'Awaiting the sensor decision',
    status: 'PROPOSED',
    promotedToTaskId: null,
    createdAt: 1755000011000,
  },
}
const PROMOTE_NA: PromoteNextActionResult = {
  nextActionId: 'NA-1',
  taskId: 'T-5',
  workstreamId: 'WS-1',
  planPath: 'topics/TPC-1/workstreams/WS-1/plan.yaml',
  newOrder: ['G-1', 'T-5', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'],
  managementActionId: 'MA-43',
}
const DISMISS_NA: DismissNextActionResult = {
  nextAction: {
    id: 'NA-1',
    workstreamId: 'WS-1',
    statement: 'Calibrate the lens array',
    rationale: null,
    status: 'DISMISSED',
    promotedToTaskId: null,
    createdAt: 1755000011000,
  },
}
const DISMISS_NA_WSLESS: DismissNextActionResult = {
  nextAction: {
    id: 'NA-2',
    workstreamId: null,
    statement: 'Scope the fallback sensor',
    rationale: 'Awaiting the sensor decision',
    status: 'DISMISSED',
    promotedToTaskId: null,
    createdAt: 1755000011000,
  },
}
const CREATE_BLK: CreateBlockerResult = {
  blocker: {
    id: 'BLK-1',
    statement: 'Awaiting reviewer sign-off',
    affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
    status: 'ACTIVE',
    source: 'reviewer note',
    references: null,
    createdAt: 1755000012000,
    clearedAt: null,
  },
}
const CLEAR_BLK: ClearBlockerResult = {
  blocker: {
    id: 'BLK-1',
    statement: 'Awaiting reviewer sign-off',
    affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
    status: 'CLEARED',
    source: 'reviewer note',
    references: null,
    createdAt: 1755000012000,
    clearedAt: 1755000013000,
  },
}

const CREATE_PI: CreatePlanItemResult = {
  itemId: 'T-9',
  workstreamId: 'WS-1',
  kind: 'TASK',
  planPath: 'workstreams/WS-1/plan.yaml',
  newOrder: ['G-1', 'T-1', 'T-2', 'T-3', 'T-9', 'M-1'],
  managementActionId: 'MA-51',
}
const UPDATE_PI: UpdatePlanItemResult = {
  itemId: 'T-1',
  workstreamId: 'WS-1',
  updatedAt: 1755000020000,
}
const REMOVE_PI: RemovePlanItemResult = {
  workstreamId: 'WS-1',
  planPath: 'workstreams/WS-1/plan.yaml',
  newOrder: ['G-1', 'T-2', 'T-3', 'M-1'],
  managementActionId: 'MA-52',
  currentFocusCleared: false,
}
const ADD_DEP: AddDependencyResult = {
  relationId: 'REL-1',
  source: { kind: 'TASK', id: 'T-1' },
  target: { kind: 'TASK', id: 'T-9' },
}
const REMOVE_DEP: RemoveDependencyResult = {
  relationId: 'REL-1',
}

describe('INVALIDATE_REGISTRY — per-mutation key sets', () => {
  it('reorderPlan → workstream + current slices (UI-5 ADJ-8 EXTENDED: the unified plan-editor set; history never — ledger, not events)', () => {
    const keys = INVALIDATE_REGISTRY.reorderPlan(REORDER, populatedState())
    expect(keys).toEqual(['workstreams:WS-1', 'current:WS-1'])
  })

  it('selectPlanFork → workstream + the owning topic (topicId from the CACHED ws slice)', () => {
    const keys = INVALIDATE_REGISTRY.selectPlanFork(SELECT, populatedState())
    expect(new Set(keys)).toEqual(new Set(['workstreams:WS-1', 'topics:TPC-1']))
  })

  it('selectPlanFork without a cached workstream → workstream slice only (topic unresolvable)', () => {
    const state = initialResearchStoreState()
    const keys = INVALIDATE_REGISTRY.selectPlanFork(SELECT, state)
    expect(keys).toEqual(['workstreams:WS-1'])
  })

  it('dismissPlanFork → workstream + the owning topic (same rule as select)', () => {
    const keys = INVALIDATE_REGISTRY.dismissPlanFork(DISMISS, populatedState())
    expect(new Set(keys)).toEqual(new Set(['workstreams:WS-1', 'topics:TPC-1']))
  })

  it('dismissPlanFork with an ERROR-state ws slice → topic still unresolvable (no data)', () => {
    const state = {
      ...initialResearchStoreState(),
      workstreams: new Map([
        ['WS-1', { status: 'error', data: null, error: 'boom', updatedAt: null } as SliceState<WorkstreamSnapshot>],
      ]),
    }
    const keys = INVALIDATE_REGISTRY.dismissPlanFork(DISMISS, state)
    expect(keys).toEqual(['workstreams:WS-1'])
  })

  it('updateInterventionState → dashboard + every CACHED current:<ws> (UI-4: the zone intervention group; result carries no workstreamIds)', () => {
    expect(new Set(INVALIDATE_REGISTRY.updateInterventionState(UPDATE_IV, populatedState()))).toEqual(
      new Set(['dashboard', 'current:WS-1', 'current:WS-2']),
    )
    // Idle cache: only `dashboard` — the current family is listed but empty.
    expect(INVALIDATE_REGISTRY.updateInterventionState(UPDATE_IV, initialResearchStoreState())).toEqual(['dashboard'])
  })

  it('registerInteraction → project only (§27.2 upcoming interactions face)', () => {
    const keys = INVALIDATE_REGISTRY.registerInteraction(REGISTER, populatedState())
    expect(keys).toEqual(['project'])
  })

  it('saveResearchCheckpoint → every CACHED gitHistory window (contents unchanged)', () => {
    const keys = INVALIDATE_REGISTRY.saveResearchCheckpoint(CHECKPOINT, populatedState())
    expect(new Set(keys)).toEqual(
      new Set([
        'gitHistory:path=.research/project.yaml|baseline=|max=|skip=',
        'gitHistory:path=|baseline=|max=10|skip=0',
      ]),
    )
  })

  it('saveResearchCheckpoint with no cached gitHistory → empty set', () => {
    const keys = INVALIDATE_REGISTRY.saveResearchCheckpoint(CHECKPOINT, initialResearchStoreState())
    expect(keys).toEqual([])
  })

  it('restoreDeclarativeFile → dashboard + project + ALL cached topics/workstreams/gitHistory', () => {
    const keys = INVALIDATE_REGISTRY.restoreDeclarativeFile(RESTORE, populatedState())
    expect(new Set(keys)).toEqual(
      new Set([
        'dashboard',
        'project',
        'topics:TPC-1',
        'workstreams:WS-1',
        'gitHistory:path=.research/project.yaml|baseline=|max=|skip=',
        'gitHistory:path=|baseline=|max=10|skip=0',
      ]),
    )
  })

  it('restoreDeclarativeFile with an empty cache → dashboard + project only', () => {
    const keys = INVALIDATE_REGISTRY.restoreDeclarativeFile(RESTORE, initialResearchStoreState())
    expect(new Set(keys)).toEqual(new Set(['dashboard', 'project']))
  })

  it("setCurrentFocus → the RESULT workstream's CF slice + its CACHED current:<ws> (UI-0.4 R-01; UI-4 ADJ-14: the aggregate's derived projection derives FROM the pointer — exact, not a conservative listing)", () => {
    const keys = INVALIDATE_REGISTRY.setCurrentFocus(SET_FOCUS, populatedState())
    expect(keys).toEqual(['currentFocus:WS-1', 'current:WS-1'])
  })

  it('setCurrentFocus with an idle current cache → the CF slice ONLY (state dependence is exact: only a CACHED current:<ws> is listed)', () => {
    const keys = INVALIDATE_REGISTRY.setCurrentFocus(SET_FOCUS, initialResearchStoreState())
    expect(keys).toEqual(['currentFocus:WS-1'])
  })

  // V2-UI-0.4 UI-2 — the six GUI management rules.
  it('updateProjectMetadata → the project slice ONLY (RMW merge rewrote project.yaml)', () => {
    expect(INVALIDATE_REGISTRY.updateProjectMetadata(UPDATE_META, populatedState())).toEqual(['project'])
    expect(INVALIDATE_REGISTRY.updateProjectMetadata(UPDATE_META, initialResearchStoreState())).toEqual(['project'])
  })

  it('updateTopic → the RESULT topic slice (state-independent)', () => {
    expect(INVALIDATE_REGISTRY.updateTopic(UPDATE_TOPIC, populatedState())).toEqual(['topics:TPC-2'])
    expect(INVALIDATE_REGISTRY.updateTopic(UPDATE_TOPIC, initialResearchStoreState())).toEqual(['topics:TPC-2'])
  })

  it('updateWorkstream → the RESULT workstream slice (state-independent)', () => {
    expect(INVALIDATE_REGISTRY.updateWorkstream(UPDATE_WS, populatedState())).toEqual(['workstreams:WS-4'])
    expect(INVALIDATE_REGISTRY.updateWorkstream(UPDATE_WS, initialResearchStoreState())).toEqual(['workstreams:WS-4'])
  })

  it('dropWorkstream → the dropped ws + its topic + the dashboard (result carries both ids)', () => {
    expect(new Set(INVALIDATE_REGISTRY.dropWorkstream(DROP_WS, populatedState()))).toEqual(
      new Set(['workstreams:WS-4', 'topics:TPC-1', 'dashboard']),
    )
  })

  it('createLocalResearchProject → dashboard on the SUCCESS arm, NOTHING on the failure arm', () => {
    expect(INVALIDATE_REGISTRY.createLocalResearchProject(CREATE_OK, populatedState())).toEqual(['dashboard'])
    expect(INVALIDATE_REGISTRY.createLocalResearchProject(CREATE_FAIL, populatedState())).toEqual([])
  })

  it('inspectProjectDirectory → NEVER invalidates (pure query)', () => {
    expect(INVALIDATE_REGISTRY.inspectProjectDirectory(INSPECT, populatedState())).toEqual([])
    expect(INVALIDATE_REGISTRY.inspectProjectDirectory(INSPECT, initialResearchStoreState())).toEqual([])
  })

  it('createTopic → project + every CACHED topic slice (the new topic is idle — its first load fetches live data)', () => {
    expect(new Set(INVALIDATE_REGISTRY.createTopic(CREATE_TOPIC, populatedState()))).toEqual(
      new Set(['project', 'topics:TPC-1']),
    )
    // Idle cache: only `project` — the topics family is listed but empty.
    expect(INVALIDATE_REGISTRY.createTopic(CREATE_TOPIC, initialResearchStoreState())).toEqual(['project'])
  })

  it('createWorkstream → the RESULT topic slice + project (result carries the topicId — state-independent)', () => {
    expect(new Set(INVALIDATE_REGISTRY.createWorkstream(CREATE_WS, populatedState()))).toEqual(
      new Set(['topics:TPC-1', 'project']),
    )
    expect(new Set(INVALIDATE_REGISTRY.createWorkstream(CREATE_WS, initialResearchStoreState()))).toEqual(
      new Set(['topics:TPC-1', 'project']),
    )
  })
})

describe('INVALIDATE_REGISTRY — the UI-6 D1 topology rules', () => {
  it('createWorkstreamFork → the RESULT topic slice + project (same shape as createWorkstream: the fork adds a workstream card AND a topology edge to the topic face — state-independent)', () => {
    expect(new Set(INVALIDATE_REGISTRY.createWorkstreamFork(FORK_RESULT, populatedState()))).toEqual(
      new Set(['topics:TPC-1', 'project']),
    )
    expect(new Set(INVALIDATE_REGISTRY.createWorkstreamFork(FORK_RESULT, initialResearchStoreState()))).toEqual(
      new Set(['topics:TPC-1', 'project']),
    )
  })
})

describe('INVALIDATE_REGISTRY — the UI-6 D2 merge/contract rules', () => {
  it('createPlannedMerge → the RESULT topic slice + project (same shape as the fork — state-independent)', () => {
    expect(new Set(INVALIDATE_REGISTRY.createPlannedMerge(MERGE_RESULT, populatedState()))).toEqual(
      new Set(['topics:TPC-1', 'project']),
    )
    expect(new Set(INVALIDATE_REGISTRY.createPlannedMerge(MERGE_RESULT, initialResearchStoreState()))).toEqual(
      new Set(['topics:TPC-1', 'project']),
    )
  })

  it('getMergeContract → NO keys (the pure query writes nothing — the uniform-face [] rule, inspectProjectDirectory precedent)', () => {
    expect(INVALIDATE_REGISTRY.getMergeContract(GET_CONTRACT_RESULT, populatedState())).toEqual([])
    expect(INVALIDATE_REGISTRY.getMergeContract(GET_CONTRACT_RESULT, initialResearchStoreState())).toEqual([])
  })

  it('saveMergeContract → the CACHED owning topic slice ONLY (no project — RECON :858): edge TE-1 is cached under TPC-1', () => {
    // Populated: the edge is found in the TPC-1 topic slice.
    expect(INVALIDATE_REGISTRY.saveMergeContract(SAVE_CONTRACT_RESULT, populatedState())).toEqual([
      'topics:TPC-1',
    ])
    // Unknown edge (cached nowhere): no keys — the topic's next load
    // fetches live data (the cachedTopicId precedent).
    expect(
      INVALIDATE_REGISTRY.saveMergeContract(
        { ...SAVE_CONTRACT_RESULT, edgeId: 'TE-99' },
        populatedState(),
      ),
    ).toEqual([])
    // Idle cache: no keys.
    expect(INVALIDATE_REGISTRY.saveMergeContract(SAVE_CONTRACT_RESULT, initialResearchStoreState())).toEqual([])
  })
})

describe('INVALIDATE_REGISTRY — the UI-6 D3 edge-drop rule', () => {
  it('dropTopologyEdge → the RESULT topic slice + project (same shape as fork/merge: the edge row lives on the topic face — state-independent)', () => {
    expect(new Set(INVALIDATE_REGISTRY.dropTopologyEdge(DROP_RESULT, populatedState()))).toEqual(
      new Set(['topics:TPC-1', 'project']),
    )
    expect(new Set(INVALIDATE_REGISTRY.dropTopologyEdge(DROP_RESULT, initialResearchStoreState()))).toEqual(
      new Set(['topics:TPC-1', 'project']),
    )
  })
})

describe('INVALIDATE_REGISTRY — the six UI-4 workstream-management rules', () => {
  it('updateObjective → project + every CACHED current:<ws> (the objective set renders in both; result carries no workstreamId)', () => {
    expect(new Set(INVALIDATE_REGISTRY.updateObjective(UPDATE_OBJ, populatedState()))).toEqual(
      new Set(['project', 'current:WS-1', 'current:WS-2']),
    )
    // Idle cache: only `project` — the current family is listed but empty.
    expect(INVALIDATE_REGISTRY.updateObjective(UPDATE_OBJ, initialResearchStoreState())).toEqual(['project'])
  })

  it('createNextAction (ws-scoped) → the owning current:<ws> slice ONLY', () => {
    expect(INVALIDATE_REGISTRY.createNextAction(CREATE_NA, populatedState())).toEqual(['current:WS-1'])
    // The rule is state-independent — the NA names its own ws.
    expect(INVALIDATE_REGISTRY.createNextAction(CREATE_NA, initialResearchStoreState())).toEqual(['current:WS-1'])
  })

  it('createNextAction (workstream-less NA) → defensive every-CACHED current:<ws> (the NA renders nowhere)', () => {
    expect(new Set(INVALIDATE_REGISTRY.createNextAction(CREATE_NA_WSLESS, populatedState()))).toEqual(
      new Set(['current:WS-1', 'current:WS-2']),
    )
    expect(INVALIDATE_REGISTRY.createNextAction(CREATE_NA_WSLESS, initialResearchStoreState())).toEqual([])
  })

  it('promoteNextAction → the RESULT current:<ws> + workstreams:<ws> (plan.yaml gained the new task)', () => {
    expect(new Set(INVALIDATE_REGISTRY.promoteNextAction(PROMOTE_NA, populatedState()))).toEqual(
      new Set(['current:WS-1', 'workstreams:WS-1']),
    )
    expect(new Set(INVALIDATE_REGISTRY.promoteNextAction(PROMOTE_NA, initialResearchStoreState()))).toEqual(
      new Set(['current:WS-1', 'workstreams:WS-1']),
    )
  })

  it('dismissNextAction (ws-scoped) → the owning current:<ws> slice ONLY (echoed NA DTO carries the ws)', () => {
    expect(INVALIDATE_REGISTRY.dismissNextAction(DISMISS_NA, populatedState())).toEqual(['current:WS-1'])
  })

  it('dismissNextAction (workstream-less NA) → defensive every-CACHED current:<ws>', () => {
    expect(new Set(INVALIDATE_REGISTRY.dismissNextAction(DISMISS_NA_WSLESS, populatedState()))).toEqual(
      new Set(['current:WS-1', 'current:WS-2']),
    )
    expect(INVALIDATE_REGISTRY.dismissNextAction(DISMISS_NA_WSLESS, initialResearchStoreState())).toEqual([])
  })

  it('createBlocker → every CACHED current:<ws> (the affected ws set is not derivable from the result)', () => {
    expect(new Set(INVALIDATE_REGISTRY.createBlocker(CREATE_BLK, populatedState()))).toEqual(
      new Set(['current:WS-1', 'current:WS-2']),
    )
    expect(INVALIDATE_REGISTRY.createBlocker(CREATE_BLK, initialResearchStoreState())).toEqual([])
  })

  it('clearBlocker → same set as createBlocker (the row flips to CLEARED in every affected zone)', () => {
    expect(new Set(INVALIDATE_REGISTRY.clearBlocker(CLEAR_BLK, populatedState()))).toEqual(
      new Set(['current:WS-1', 'current:WS-2']),
    )
    expect(INVALIDATE_REGISTRY.clearBlocker(CLEAR_BLK, initialResearchStoreState())).toEqual([])
  })

  it('createBlocker does NOT list the workstreams slices (the frozen WorkstreamSnapshot has no blocker face)', () => {
    for (const key of INVALIDATE_REGISTRY.createBlocker(CREATE_BLK, populatedState())) {
      expect(key.startsWith('workstreams:')).toBe(false)
      expect(key === 'history:WS-1').toBe(false)
    }
  })

  // V2-UI-0.4 UI-5 (ADJ-8): the five plan-editor rules — the unified
  // `workstreams:<ws>` + `current:<ws>` set (direct addressing for the
  // item faces; conservative cached family listing for the dependency
  // faces, which carry no workstreamId).
  it('createPlanItem → the RESULT workstreams:<ws> + current:<ws> (ADJ-8 unified; a new gate changes the derived-blocker inputs)', () => {
    const keys = INVALIDATE_REGISTRY.createPlanItem(CREATE_PI, populatedState())
    expect(keys).toEqual(['workstreams:WS-1', 'current:WS-1'])
    // state-independent: direct addressing from the result
    expect(INVALIDATE_REGISTRY.createPlanItem(CREATE_PI, initialResearchStoreState())).toEqual([
      'workstreams:WS-1',
      'current:WS-1',
    ])
  })

  it('updatePlanItem → the RESULT workstreams:<ws> + current:<ws> (ADJ-8 unified; fields change in place)', () => {
    const keys = INVALIDATE_REGISTRY.updatePlanItem(UPDATE_PI, populatedState())
    expect(keys).toEqual(['workstreams:WS-1', 'current:WS-1'])
    expect(INVALIDATE_REGISTRY.updatePlanItem(UPDATE_PI, initialResearchStoreState())).toEqual([
      'workstreams:WS-1',
      'current:WS-1',
    ])
  })

  it('removePlanItem → the RESULT workstreams:<ws> + currentFocus:<ws> (F-9) + current:<ws> (ADJ-8 unified; ADJ-14: the kernel revalidate clears the CF pointer when the removed item WAS the focus — the pointer slice must refetch, not keep the stale face; the derived projection rides the current refetch)', () => {
    const keys = INVALIDATE_REGISTRY.removePlanItem(REMOVE_PI, populatedState())
    expect(keys).toEqual(['workstreams:WS-1', 'currentFocus:WS-1', 'current:WS-1'])
    expect(INVALIDATE_REGISTRY.removePlanItem(REMOVE_PI, initialResearchStoreState())).toEqual([
      'workstreams:WS-1',
      'currentFocus:WS-1',
      'current:WS-1',
    ])
  })

  it('addDependency → every CACHED workstreams:* + current:<ws> (the result carries no workstreamId — conservative family listing; the refetch pass skips idle slices)', () => {
    expect(new Set(INVALIDATE_REGISTRY.addDependency(ADD_DEP, populatedState()))).toEqual(
      new Set(['workstreams:WS-1', 'current:WS-1', 'current:WS-2']),
    )
    expect(INVALIDATE_REGISTRY.addDependency(ADD_DEP, initialResearchStoreState())).toEqual([])
  })

  it('removeDependency → same shape as addDependency (the edge leaves the ADJ-7 dependencyEdges projection)', () => {
    expect(new Set(INVALIDATE_REGISTRY.removeDependency(REMOVE_DEP, populatedState()))).toEqual(
      new Set(['workstreams:WS-1', 'current:WS-1', 'current:WS-2']),
    )
    expect(INVALIDATE_REGISTRY.removeDependency(REMOVE_DEP, initialResearchStoreState())).toEqual([])
  })
})

describe('INVALIDATE_REGISTRY — cross-cutting invariants', () => {
  const ALL: Array<[MutationId, (state: ResearchStoreState) => readonly string[]]> = [
    ['reorderPlan', state => INVALIDATE_REGISTRY.reorderPlan(REORDER, state)],
    ['selectPlanFork', state => INVALIDATE_REGISTRY.selectPlanFork(SELECT, state)],
    ['dismissPlanFork', state => INVALIDATE_REGISTRY.dismissPlanFork(DISMISS, state)],
    ['updateInterventionState', state => INVALIDATE_REGISTRY.updateInterventionState(UPDATE_IV, state)],
    ['registerInteraction', state => INVALIDATE_REGISTRY.registerInteraction(REGISTER, state)],
    ['saveResearchCheckpoint', state => INVALIDATE_REGISTRY.saveResearchCheckpoint(CHECKPOINT, state)],
    ['restoreDeclarativeFile', state => INVALIDATE_REGISTRY.restoreDeclarativeFile(RESTORE, state)],
    ['setCurrentFocus', state => INVALIDATE_REGISTRY.setCurrentFocus(SET_FOCUS, state)],
    // V2-UI-0.4 UI-2: the six GUI management rules join the invariant sweep.
    ['updateProjectMetadata', state => INVALIDATE_REGISTRY.updateProjectMetadata(UPDATE_META, state)],
    ['updateTopic', state => INVALIDATE_REGISTRY.updateTopic(UPDATE_TOPIC, state)],
    ['updateWorkstream', state => INVALIDATE_REGISTRY.updateWorkstream(UPDATE_WS, state)],
    ['dropWorkstream', state => INVALIDATE_REGISTRY.dropWorkstream(DROP_WS, state)],
    ['createLocalResearchProject', state => INVALIDATE_REGISTRY.createLocalResearchProject(CREATE_OK, state)],
    ['inspectProjectDirectory', state => INVALIDATE_REGISTRY.inspectProjectDirectory(INSPECT, state)],
    // V2-UI-4: the six workstream-management rules join the invariant sweep.
    ['updateObjective', state => INVALIDATE_REGISTRY.updateObjective(UPDATE_OBJ, state)],
    ['createNextAction', state => INVALIDATE_REGISTRY.createNextAction(CREATE_NA, state)],
    ['promoteNextAction', state => INVALIDATE_REGISTRY.promoteNextAction(PROMOTE_NA, state)],
    ['dismissNextAction', state => INVALIDATE_REGISTRY.dismissNextAction(DISMISS_NA, state)],
    ['createBlocker', state => INVALIDATE_REGISTRY.createBlocker(CREATE_BLK, state)],
    ['clearBlocker', state => INVALIDATE_REGISTRY.clearBlocker(CLEAR_BLK, state)],
    // V2-UI-0.4 UI-5 (ADJ-8): the five plan-editor rules join the sweep.
    ['createPlanItem', state => INVALIDATE_REGISTRY.createPlanItem(CREATE_PI, state)],
    ['updatePlanItem', state => INVALIDATE_REGISTRY.updatePlanItem(UPDATE_PI, state)],
    ['removePlanItem', state => INVALIDATE_REGISTRY.removePlanItem(REMOVE_PI, state)],
    ['addDependency', state => INVALIDATE_REGISTRY.addDependency(ADD_DEP, state)],
    ['removeDependency', state => INVALIDATE_REGISTRY.removeDependency(REMOVE_DEP, state)],
    // V2-UI-6 D1: the fork rule joins the invariant sweep.
    ['createWorkstreamFork', state => INVALIDATE_REGISTRY.createWorkstreamFork(FORK_RESULT, state)],
    // V2-UI-6 D2: the merge/contract rules join the invariant sweep.
    ['createPlannedMerge', state => INVALIDATE_REGISTRY.createPlannedMerge(MERGE_RESULT, state)],
    ['getMergeContract', state => INVALIDATE_REGISTRY.getMergeContract(GET_CONTRACT_RESULT, state)],
    ['saveMergeContract', state => INVALIDATE_REGISTRY.saveMergeContract(SAVE_CONTRACT_RESULT, state)],
    // V2-UI-6 D3: the edge-drop rule joins the invariant sweep.
    ['dropTopologyEdge', state => INVALIDATE_REGISTRY.dropTopologyEdge(DROP_RESULT, state)],
  ]

  it('NO rule invalidates a history window (WS logs are append-only; none of the 13 RPCs appends)', () => {
    const state = populatedState()
    for (const [id, rule] of ALL) {
      expect(rule(state).every(key => !key.startsWith('history:')), `${id} must not touch history`).toBe(true)
    }
  })

  it('every rule is pure: repeated calls return equal (fresh) arrays', () => {
    const state = populatedState()
    for (const [, rule] of ALL) {
      const a = rule(state)
      const b = rule(state)
      expect(b).toEqual(a)
      expect(b).not.toBe(a)
    }
  })

  it('every key a rule emits is parseable and names an existing slice family', () => {
    const state = populatedState()
    for (const [, rule] of ALL) {
      for (const key of rule(state)) {
        const prefix = key.includes(':') ? key.slice(0, key.indexOf(':')) : key
        expect(
          ['dashboard', 'project', 'topics', 'workstreams', 'history', 'gitHistory', 'currentFocus', 'current'],
        ).toContain(prefix)
      }
    }
  })

  it('MUTATION_IDS is exactly the registry key set (8 frozen-13 mutations + the 6 UI-2 management faces + the 2 UI-3 create faces + the 6 UI-4 workstream-management faces + the 5 UI-5 plan-editor faces + the 5 UI-6 topology/contract faces)', () => {
    expect([...MUTATION_IDS].sort()).toEqual(Object.keys(INVALIDATE_REGISTRY).sort())
    expect(MUTATION_IDS).toHaveLength(32)
  })
})
