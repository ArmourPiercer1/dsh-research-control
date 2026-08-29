/**
 * WP-4.1b — invalidate/refetch registry tests: the frozen
 * `mutation -> affected slice keys` mapping (task brief item 2,
 * test item 3). Pure-function assertions — no store, no I/O.
 */

import { describe, expect, it } from 'vitest'
import type {
  DashboardSnapshot,
  DismissPlanForkResult,
  GetCurrentFocusResult,
  GetGitHistoryResult,
  ProjectSnapshot,
  QueryHistoryResult,
  ReorderPlanResult,
  RegisterInteractionResult,
  RestoreDeclarativeFileResult,
  SaveResearchCheckpointResult,
  SelectPlanForkResult,
  SetCurrentFocusResult,
  TopicSnapshot,
  UpdateInterventionStateResult,
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
 * one gitHistory window, one current-focus pointer) — the maximal cache
 * the rules must address.
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

describe('INVALIDATE_REGISTRY — per-mutation key sets', () => {
  it('reorderPlan → the workstream slice ONLY (plan order; history never — ledger, not events)', () => {
    const keys = INVALIDATE_REGISTRY.reorderPlan(REORDER, populatedState())
    expect(keys).toEqual(['workstreams:WS-1'])
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

  it('updateInterventionState → dashboard only (the INV-ATTN-1 intervention lists)', () => {
    const keys = INVALIDATE_REGISTRY.updateInterventionState(UPDATE_IV, populatedState())
    expect(keys).toEqual(['dashboard'])
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

  it('setCurrentFocus → the RESULT workstream\'s currentFocus slice ONLY (UI-0.4, R-01)', () => {
    const keys = INVALIDATE_REGISTRY.setCurrentFocus(SET_FOCUS, populatedState())
    expect(keys).toEqual(['currentFocus:WS-1'])
  })

  it('setCurrentFocus is state-independent: idle CF cache yields the SAME key', () => {
    const keys = INVALIDATE_REGISTRY.setCurrentFocus(SET_FOCUS, initialResearchStoreState())
    expect(keys).toEqual(['currentFocus:WS-1'])
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
          ['dashboard', 'project', 'topics', 'workstreams', 'history', 'gitHistory', 'currentFocus'],
        ).toContain(prefix)
      }
    }
  })

  it('MUTATION_IDS is exactly the registry key set (7 frozen-13 mutations + the UI-0.4 focus setter)', () => {
    expect([...MUTATION_IDS].sort()).toEqual(Object.keys(INVALIDATE_REGISTRY).sort())
    expect(MUTATION_IDS).toHaveLength(8)
  })
})
