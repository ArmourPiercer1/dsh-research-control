/**
 * Invalidate/refetch registry (WP-4.1b) — the frozen mapping
 * `mutation -> affected slice keys` (task brief item 2; ARCHITECTURE §8
 * item 3: 低频 research state mutation 后主动 invalidate/refetch).
 *
 * Semantics: after a mutation RESOLVES OK, the store runs the rule for
 * that mutation against the CURRENT snapshot state and refetches exactly
 * the affected slices that are non-idle (already loaded / on screen).
 * Idle slices have no cache to invalidate — their next `load*` fetches
 * live host data anyway — so a rule may list them freely and the store's
 * refetch pass skips them.
 *
 * The rules are PURE (result, state) -> keys: no I/O, no store handle —
 * unit-testable in isolation (tests/stores/registry.test.ts) and checked
 * by tsc against the shared contract result DTOs (no hand-written
 * duplicates: every result type is imported from rpc-contracts).
 *
 * Rationale per rule (frozen here so Phase 4 views and the reviewer share
 * one source):
 *
 * | mutation               | affected keys                                                       |
 * |------------------------|---------------------------------------------------------------------|
 * | reorderPlan            | `workstreams:<ws>` — the canonical plan order (plan.yaml) changed;  |
 * |                        | the result carries `workstreamId`. History is NOT touched: the      |
 * |                        | contract pins that ResearchHistory does not record plan management  |
 * |                        | ops (management_action ledger instead, rpc-contracts §6 note).      |
 * |                        | Topic cards carry `planItemCount` (item count — reorder-invariant). |
 * | selectPlanFork         | `workstreams:<ws>` — SELECT materializes `newOrder`/`newItems`/     |
 * |                        | `removedIds` and chain-stales the other OPEN PFs of the ws          |
 * |                        | (`staleOthers`) → the ws `future` zone; PLUS `topics:<topic>` when  |
 * |                        | the topicId is resolvable from the cached ws snapshot (the result   |
 * |                        | has no topicId; the topic card's `openPlanForkCount` moved).        |
 * | dismissPlanFork        | same set as select — the PF leaves the unresolved overlay (count).  |
 * | updateInterventionState| `dashboard` — openInterventions/pendingInterventions (INV-ATTN-1    |
 * |                        | complete lists); ProjectSnapshot has no intervention face.          |
 * | registerInteraction    | `project` — §27.2 Project page「upcoming interactions/reporting」  |
 * |                        | (placeholder-null in V1; the interaction is PROJECT-scoped, the     |
 * |                        | dashboard renders no interaction list).                             |
 * | saveResearchCheckpoint | every CACHED `gitHistory:*` window — a new `.research/**` commit    |
 * |                        | prepends to each version log; file CONTENTS are untouched (a        |
 * |                        | checkpoint records state), so the declarative projections            |
 * |                        | (project/topics/workstreams) are not invalidated.                   |
 * | restoreDeclarativeFile | `dashboard` + `project` + every CACHED `topics:*` +                 |
 * |                        | `workstreams:*` + `gitHistory:*` — the restore REWRITES one          |
 * |                        | `.research/**` file, so every declarative-tree projection may change |
 * |                        | (dashboard/project topic cards read the tree too: title +            |
 * |                        | workstreamCount) and the git log/diff face of that path moves.       |
 *
 * History slices (`history:*`) are intentionally NEVER invalidated by a
 * client mutation: the WS event log is append-only and none of the 13
 * RPCs appends to it (agent/execution events arrive out-of-band; the
 * refresh loop's `refresh()` refetches open windows, which is how the
 * client observes them — ARCHITECTURE §8 items 3/4).
 */

import type {
  DismissPlanForkResult,
  RegisterInteractionResult,
  ReorderPlanResult,
  RestoreDeclarativeFileResult,
  SaveResearchCheckpointResult,
  SelectPlanForkResult,
  UpdateInterventionStateResult,
} from '../../shared/rpc-contracts.js'
import {
  type ResearchStoreState,
  type SliceKey,
  sliceKey,
} from './model.js'

/** The seven client-side mutations of the frozen 13-RPC list. */
export type MutationId =
  | 'reorderPlan'
  | 'selectPlanFork'
  | 'dismissPlanFork'
  | 'updateInterventionState'
  | 'registerInteraction'
  | 'saveResearchCheckpoint'
  | 'restoreDeclarativeFile'

export const MUTATION_IDS: readonly MutationId[] = [
  'reorderPlan',
  'selectPlanFork',
  'dismissPlanFork',
  'updateInterventionState',
  'registerInteraction',
  'saveResearchCheckpoint',
  'restoreDeclarativeFile',
]

/** One registry rule: pure (result, state) -> affected global slice keys. */
export interface InvalidationRule<R> {
  (result: R, state: ResearchStoreState): readonly SliceKey[]
}

/**
 * The frozen registry: mutation -> pure rule over the shared contract
 * result DTO. Every rule is checked against its own result type (a typo
 * in a field access fails tsc at the rule body).
 */
export const INVALIDATE_REGISTRY: {
  readonly reorderPlan: InvalidationRule<ReorderPlanResult>
  readonly selectPlanFork: InvalidationRule<SelectPlanForkResult>
  readonly dismissPlanFork: InvalidationRule<DismissPlanForkResult>
  readonly updateInterventionState: InvalidationRule<UpdateInterventionStateResult>
  readonly registerInteraction: InvalidationRule<RegisterInteractionResult>
  readonly saveResearchCheckpoint: InvalidationRule<SaveResearchCheckpointResult>
  readonly restoreDeclarativeFile: InvalidationRule<RestoreDeclarativeFileResult>
} = {
  reorderPlan: (result, _state) => [sliceKey('workstreams', result.workstreamId)],

  selectPlanFork: (result, state) => {
    const keys: SliceKey[] = [sliceKey('workstreams', result.workstreamId)]
    const topicId = cachedTopicId(state, result.workstreamId)
    if (topicId !== null) keys.push(sliceKey('topics', topicId))
    return keys
  },

  dismissPlanFork: (result, state) => {
    const keys: SliceKey[] = [sliceKey('workstreams', result.workstreamId)]
    const topicId = cachedTopicId(state, result.workstreamId)
    if (topicId !== null) keys.push(sliceKey('topics', topicId))
    return keys
  },

  updateInterventionState: (_result, _state) => ['dashboard'],

  registerInteraction: (_result, _state) => ['project'],

  saveResearchCheckpoint: (_result, state) =>
    [...state.gitHistory.keys()].map(key => sliceKey('gitHistory', key)),

  restoreDeclarativeFile: (_result, state) => [
    'dashboard',
    'project',
    ...[...state.topics.keys()].map(key => sliceKey('topics', key)),
    ...[...state.workstreams.keys()].map(key => sliceKey('workstreams', key)),
    ...[...state.gitHistory.keys()].map(key => sliceKey('gitHistory', key)),
  ],
}

/**
 * The topic owning a workstream, resolvable ONLY from the cache (the
 * select/dismiss results carry no topicId). `null` when the workstream
 * slice is idle/empty — the caller then skips the topic key (the topic's
 * next load fetches live data).
 */
function cachedTopicId(state: ResearchStoreState, workstreamId: string): string | null {
  const data = state.workstreams.get(workstreamId)?.data
  return data === null || data === undefined ? null : data.workstream.topicId
}
