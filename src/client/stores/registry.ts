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
 * | setCurrentFocus (UI-0.4)| `currentFocus:<ws>` ONLY — the pointer is an operational row and NO  |
 * | (R-01)                  | existing slice's DTO carries focus data (the frozen                  |
 * |                        | WorkstreamSnapshot cannot gain the field — rpc-contracts             |
 * |                        | §getCurrentFocus note), so the CF slice is the whole store-level     |
 * |                        | invalidation today; the focus surfaces (header / future strip /      |
 * |                        | graph) are UI-4 work selecting from the `currentFocus` slice.        |
 *
 * History slices (`history:*`) are intentionally NEVER invalidated by a
 * client mutation: the WS event log is append-only and none of the 13
 * RPCs appends to it (agent/execution events arrive out-of-band; the
 * refresh loop's `refresh()` refetches open windows, which is how the
 * client observes them — ARCHITECTURE §8 items 3/4).
 */

import type {
  CreateLocalResearchProjectResult,
  CreateTopicResult,
  CreateWorkstreamResult,
  DismissPlanForkResult,
  DropWorkstreamResult,
  InspectProjectDirectoryResult,
  RegisterInteractionResult,
  ReorderPlanResult,
  RestoreDeclarativeFileResult,
  SaveResearchCheckpointResult,
  SetCurrentFocusResult,
  SelectPlanForkResult,
  UpdateInterventionStateResult,
  UpdateProjectMetadataResult,
  UpdateTopicResult,
  UpdateWorkstreamResult,
} from '../../shared/rpc-contracts.js'
import {
  type ResearchStoreState,
  type SliceKey,
  sliceKey,
} from './model.js'

/**
 * The sixteen client-side mutations: the eight of the frozen 13-RPC
 * list (the seven WP-4.1b mutations + `setCurrentFocus`, UI-0.4 R-01 —
 * `getCurrentFocus` is a query, not a mutation) plus the six V2-UI-0.4
 * UI-2 GUI management faces (the 4 hierarchy update/drop RPCs, UI-2A,
 * and the 2 local-project RPCs, UI-2B — `inspectProjectDirectory` is a
 * query surfaced for uniformity; its rule invalidates nothing) plus the
 * two V2-UI-0.4 UI-3 hierarchy CREATE faces (`createTopic` /
 * `createWorkstream` — the host RPCs pre-existed; the client facade +
 * store wiring landed in this slice).
 */
export type MutationId =
  | 'reorderPlan'
  | 'selectPlanFork'
  | 'dismissPlanFork'
  | 'updateInterventionState'
  | 'registerInteraction'
  | 'saveResearchCheckpoint'
  | 'restoreDeclarativeFile'
  | 'setCurrentFocus'
  | 'updateProjectMetadata'
  | 'updateTopic'
  | 'updateWorkstream'
  | 'dropWorkstream'
  | 'createLocalResearchProject'
  | 'inspectProjectDirectory'
  | 'createTopic'
  | 'createWorkstream'

export const MUTATION_IDS: readonly MutationId[] = [
  'reorderPlan',
  'selectPlanFork',
  'dismissPlanFork',
  'updateInterventionState',
  'registerInteraction',
  'saveResearchCheckpoint',
  'restoreDeclarativeFile',
  'setCurrentFocus',
  'updateProjectMetadata',
  'updateTopic',
  'updateWorkstream',
  'dropWorkstream',
  'createLocalResearchProject',
  'inspectProjectDirectory',
  'createTopic',
  'createWorkstream',
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
  readonly setCurrentFocus: InvalidationRule<SetCurrentFocusResult>
  readonly updateProjectMetadata: InvalidationRule<UpdateProjectMetadataResult>
  readonly updateTopic: InvalidationRule<UpdateTopicResult>
  readonly updateWorkstream: InvalidationRule<UpdateWorkstreamResult>
  readonly dropWorkstream: InvalidationRule<DropWorkstreamResult>
  readonly createLocalResearchProject: InvalidationRule<CreateLocalResearchProjectResult>
  readonly inspectProjectDirectory: InvalidationRule<InspectProjectDirectoryResult>
  readonly createTopic: InvalidationRule<CreateTopicResult>
  readonly createWorkstream: InvalidationRule<CreateWorkstreamResult>
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

  // UI-0.4 (R-01): the focus pointer is an operational row. No other slice's
  // DTO carries focus data (the frozen WorkstreamSnapshot cannot gain the
  // field), so the `currentFocus:<ws>` slice is the WHOLE store-level
  // invalidation today. The rule is state-independent (like
  // updateInterventionState / registerInteraction): it refetches exactly the
  // caller's CF slice, which the store skips when it is still idle.
  setCurrentFocus: (result, _state) => [sliceKey('currentFocus', result.workstreamId)],

  // V2-UI-0.4 UI-2 (UI-2A): the four hierarchy update/drop mutations.
  // updateProjectMetadata: the RMW merge rewrote project.yaml — the
  // `project` slice (brief + metadata) is the affected cache.
  updateProjectMetadata: (_result, _state) => ['project'],

  // updateTopic: only the topic's own DTO changes (the project page's
  // topic cards re-render from the project slice on its next load; the
  // topic page slice is the one that must refresh NOW).
  updateTopic: (result, _state) => [sliceKey('topics', result.topicId)],

  // updateWorkstream: title/summary live in the workstream DTO only.
  updateWorkstream: (result, _state) => [sliceKey('workstreams', result.workstreamId)],

  // dropWorkstream: the ws slice goes away (its next load will fault —
  // the view handles the gone entity), the owning topic's card list
  // changes, and the dashboard's aggregates change. The result carries
  // the topicId (no cache lookup needed, unlike select/dismiss).
  dropWorkstream: (result, _state) => [
    sliceKey('workstreams', result.workstreamId),
    sliceKey('topics', result.topicId),
    'dashboard',
  ],

  // V2-UI-0.4 UI-2 (UI-2B): the two local-project faces.
  // createLocalResearchProject: on the SUCCESS arm the plane's
  // registration set changed — the dashboard (project aggregates) is
  // the only store slice it feeds. The FAILURE arm left a partial
  // change but no registration — nothing in the store reflects it
  // (the wizard renders the note; the plane-state re-fetch is the
  // shell's job, outside this store).
  createLocalResearchProject: (result, _state) => (result.ok ? ['dashboard'] : []),

  // inspectProjectDirectory: a pure query (reads, never writes) — no
  // cache can be stale because of it. The rule exists so the store
  // face is uniform (every mutation id has a rule).
  inspectProjectDirectory: (_result, _state) => [],

  // V2-UI-0.4 UI-3: the two hierarchy CREATE mutations (host RPCs
  // pre-existed; client facade + store wiring is new this slice).
  // createTopic: the project's topic-card list (and per-topic counts)
  // changed, so `project` refetches; the CACHED topic slices are listed
  // conservatively — a new topic does not rewrite existing topics, but
  // the rule pattern mirrors restoreDeclarativeFile (list the family;
  // the refetch pass skips idle slices, and the new topic's own slice
  // is idle so its first load fetches live data anyway).
  createTopic: (_result, state) => [
    'project',
    ...[...state.topics.keys()].map(key => sliceKey('topics', key)),
  ],

  // createWorkstream: the owning topic's workstream-card list (and its
  // workstreamCount) changed, and the project's aggregate counts follow.
  // The result carries the topicId (no cache lookup needed).
  createWorkstream: (result, _state) => [
    sliceKey('topics', result.topicId),
    'project',
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
