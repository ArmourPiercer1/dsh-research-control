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
 * |                        | UI-5 (ADJ-8) EXTENDED: PLUS `current:<ws>` — the unified            |
 * |                        | plan-editor rule set (the current face's plan projection re-derives |
 * |                        | after a reorder).                                                   |
 * | selectPlanFork         | `workstreams:<ws>` — SELECT materializes `newOrder`/`newItems`/     |
 * |                        | `removedIds` and chain-stales the other OPEN PFs of the ws          |
 * |                        | (`staleOthers`) → the ws `future` zone; PLUS `topics:<topic>` when  |
 * |                        | the topicId is resolvable from the cached ws snapshot (the result   |
 * |                        | has no topicId; the topic card's `openPlanForkCount` moved).        |
 * | dismissPlanFork        | same set as select — the PF leaves the unresolved overlay (count).  |
 * | updateInterventionState| `dashboard` — openInterventions/pendingInterventions (INV-ATTN-1    |
 * |                        | complete lists); ProjectSnapshot has no intervention face. PLUS      |
 * |                        | every CACHED `current:<ws>` (UI-4: the current-zone intervention    |
 * |                        | group renders from the getWorkstreamCurrent face, and the result    |
 * |                        | carries no workstreamIds — conservative family listing).            |
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
 * | setCurrentFocus (UI-0.4)| `currentFocus:<ws>` — the pointer is an operational row; PLUS the     |
 * | (R-01) + UI-4 (ADJ-14)  | CACHED `current:<ws>` of that workstream (the aggregate derives its   |
 * |                         | blocker projection FROM the pointer — ADJ-3 — so the WS page would    |
 * |                         | otherwise keep the stale projection until a full reload; the §10.8    |
 * |                         | no-refresh drift is covered by the post-mutation registry refetch     |
 * |                         | (idle current cache → the CF key alone, as before).                   |
 * | updateObjective (UI-4) | `project` — the frozen ProjectSnapshot.objectives face changed;     |
 * |                        | PLUS every CACHED `current:<ws>` — the objective set renders in the |
 * |                        | current zone from the getWorkstreamCurrent face, and the result    |
 * |                        | carries no workstreamId (the ws filter is linked_refs, not in the   |
 * |                        | result) — conservative family listing.                              |
 * | createNextAction (UI-4)| `current:<ws>` — the new PROPOSED NA renders in exactly that slice  |
 * |                        | (host filter `workstreamId: <ws>`). A workstream-less NA renders    |
 * |                        | nowhere → defensive cached-`current:*` listing (createTopic         |
 * |                        | precedent: list the family; the refetch pass skips idle slices).   |
 * | promoteNextAction(UI-4)| `current:<ws>` — the NA leaves the PROPOSED set; PLUS               |
 * |                        | `workstreams:<ws>` — plan.yaml gains the new task (future zone plan |
 * |                        | + task list). The result carries the workstreamId.                  |
 * | dismissNextAction(UI-4)| `current:<ws>` — the NA leaves the PROPOSED set; workstream-less NA |
 * |                        | → defensive cached-`current:*` listing (createNextAction shape).    |
 * | createBlocker (UI-4)   | every CACHED `current:<ws>` — an ACTIVE blocker renders in the      |
 * |                        | current zone of every ws it AFFECTS (ws ref, or the owner of a      |
 * |                        | task/run ref — not derivable from the result); the workstreams      |
 * |                        | slice has no blocker face (frozen WorkstreamSnapshot).              |
 * | clearBlocker (UI-4)    | same set as createBlocker — the blocker row flips to CLEARED in     |
 * |                        | every affected current zone.                                        |
 * | createPlanItem (UI-5)  | `workstreams:<ws>` + `current:<ws>` (ADJ-8 unified) — plan.yaml     |
 * |                        | gains the item (future zone) and the current face's plan projection |
 * |                        | re-derives (a new gate changes the derived-blocker inputs). The     |
 * |                        | result carries the workstreamId.                                    |
 * | updatePlanItem (UI-5)  | `workstreams:<ws>` + `current:<ws>` (ADJ-8) — an item's fields      |
 * |                        | change in place.                                                    |
 * | removePlanItem (UI-5)  | `workstreams:<ws>` + `currentFocus:<ws>` + `current:<ws>` (ADJ-8
 * |                        | + F-9) — the item leaves the order; when it WAS the current focus
 * |                        | the CF pointer is cleared server-side (ADJ-14 revalidate) and the
 * |                        | currentFocus slice refetch drops the stale pointer from every
 * |                        | focus face NO-REFRESH.
 * | addDependency (UI-5)   | the result carries no workstreamId (relationId + echoed endpoints)  |
 * |                        | → conservative CACHED `workstreams:*` + `current:*` family listing  |
 * |                        | (refetch pass skips idle slices) — the ADJ-7 dependencyEdges        |
 * |                        | projection lives in the owning ws's current face.                   |
 * | removeDependency (UI-5)| same shape as addDependency — the edge leaves the ADJ-7             |
 * |                        | dependencyEdges projection.                                         |
 *
 * History slices (`history:*`) are intentionally NEVER invalidated by a
 * client mutation: the WS event log is append-only and none of the 13
 * RPCs appends to it (agent/execution events arrive out-of-band; the
 * refresh loop's `refresh()` refetches open windows, which is how the
 * client observes them — ARCHITECTURE §8 items 3/4).
 */

import type {
  AddDependencyResult,
  ClearBlockerResult,
  CreateBlockerResult,
  CreateLocalResearchProjectResult,
  CreateNextActionResult,
  CreatePlanItemResult,
  CreatePlannedMergeResult,
  CreateTopicResult,
  CreateWorkstreamResult,
  CreateWorkstreamForkResult,
  DismissNextActionResult,
  DismissPlanForkResult,
  DropTopologyEdgeResult,
  DropWorkstreamResult,
  GetMergeContractResult,
  InspectProjectDirectoryResult,
  PromoteNextActionResult,
  RegisterInteractionResult,
  ReorderPlanResult,
  RemoveDependencyResult,
  RemovePlanItemResult,
  RestoreDeclarativeFileResult,
  SaveMergeContractResult,
  SaveResearchCheckpointResult,
  SetCurrentFocusResult,
  SelectPlanForkResult,
  UpdateInterventionStateResult,
  UpdateObjectiveResult,
  UpdatePlanItemResult,
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
 * The twenty-seven client-side mutations: the eight of the frozen 13-RPC
 * list (the seven WP-4.1b mutations + `setCurrentFocus`, UI-0.4 R-01 —
 * `getCurrentFocus` is a query, not a mutation) plus the six V2-UI-0.4
 * UI-2 GUI management faces (the 4 hierarchy update/drop RPCs, UI-2A,
 * and the 2 local-project RPCs, UI-2B — `inspectProjectDirectory` is a
 * query surfaced for uniformity; its rule invalidates nothing) plus the
 * two V2-UI-0.4 UI-3 hierarchy CREATE faces (`createTopic` /
 * `createWorkstream` — the host RPCs pre-existed; the client facade +
 * store wiring landed in this slice) plus the six V2-UI-4
 * workstream-management faces (`updateObjective` / `createNextAction` /
 * `promoteNextAction` / `dismissNextAction` / `createBlocker` /
 * `clearBlocker` — the host RPCs landed with the UI-4 host write-face;
 * the client store wiring lands in this slice) plus the five V2-UI-0.4
 * UI-5 plan-editor faces (`createPlanItem` / `updatePlanItem` /
 * `removePlanItem` / `addDependency` / `removeDependency` — the host
 * RPCs + client facade landed in this slice; `reorderPlan`'s rule is
 * EXTENDED per ADJ-8 to the same unified set).
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
  | 'updateObjective'
  | 'createNextAction'
  | 'promoteNextAction'
  | 'dismissNextAction'
  | 'createBlocker'
  | 'clearBlocker'
  | 'createPlanItem'
  | 'updatePlanItem'
  | 'removePlanItem'
  | 'addDependency'
  | 'removeDependency'
  | 'createWorkstreamFork'
  | 'createPlannedMerge'
  | 'getMergeContract'
  | 'saveMergeContract'
  | 'dropTopologyEdge'

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
  'updateObjective',
  'createNextAction',
  'promoteNextAction',
  'dismissNextAction',
  'createBlocker',
  'clearBlocker',
  'createPlanItem',
  'updatePlanItem',
  'removePlanItem',
  'addDependency',
  'removeDependency',
  'createWorkstreamFork',
  'createPlannedMerge',
  'getMergeContract',
  'saveMergeContract',
  'dropTopologyEdge',
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
  readonly updateObjective: InvalidationRule<UpdateObjectiveResult>
  readonly createNextAction: InvalidationRule<CreateNextActionResult>
  readonly promoteNextAction: InvalidationRule<PromoteNextActionResult>
  readonly dismissNextAction: InvalidationRule<DismissNextActionResult>
  readonly createBlocker: InvalidationRule<CreateBlockerResult>
  readonly clearBlocker: InvalidationRule<ClearBlockerResult>
  readonly createPlanItem: InvalidationRule<CreatePlanItemResult>
  readonly updatePlanItem: InvalidationRule<UpdatePlanItemResult>
  readonly removePlanItem: InvalidationRule<RemovePlanItemResult>
  readonly addDependency: InvalidationRule<AddDependencyResult>
  readonly removeDependency: InvalidationRule<RemoveDependencyResult>
  readonly createWorkstreamFork: InvalidationRule<CreateWorkstreamForkResult>
  readonly createPlannedMerge: InvalidationRule<CreatePlannedMergeResult>
  readonly getMergeContract: InvalidationRule<GetMergeContractResult>
  readonly saveMergeContract: InvalidationRule<SaveMergeContractResult>
  readonly dropTopologyEdge: InvalidationRule<DropTopologyEdgeResult>
} = {
  // UI-5 (ADJ-8): the frozen rule is EXTENDED — unified with the five
  // plan-editor mutations below: `workstreams:<ws>` + `current:<ws>`.
  // The `current` key is listed unconditionally (the promoteNextAction
  // precedent); the refetch pass skips idle slices.
  reorderPlan: (result, _state) => [
    sliceKey('workstreams', result.workstreamId),
    sliceKey('current', result.workstreamId),
  ],

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

  // UI-4 (ADJ-13): the frozen rule is EXTENDED — the current-zone
  // intervention group renders from the getWorkstreamCurrent face, and
  // the result carries no workstreamIds, so every CACHED `current:<ws>`
  // refetches (the refetch pass skips idle slices).
  updateInterventionState: (_result, state) => [
    'dashboard',
    ...cachedCurrentKeys(state),
  ],

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

  // UI-0.4 (R-01) + UI-4 (ADJ-14): the focus pointer is an operational
  // row. No other slice's DTO carries focus data (the frozen
  // WorkstreamSnapshot cannot gain the field), so the `currentFocus:<ws>`
  // slice is the base invalidation. UI-4 ADDS the CACHED `current:<ws>`
  // (only when that workstream's aggregate slice is loaded): the
  // getWorkstreamCurrent face computes its DERIVED blocker projection
  // from this very pointer (ADJ-3), so without the refetch the WS page's
  // Blockers group would keep the stale projection until a full reload —
  // the refresh-drift the §10.8 gate forbids (ADJ-14: no-refresh drift =
  // the post-mutation registry refetch).
  setCurrentFocus: (result, state) => [
    sliceKey('currentFocus', result.workstreamId),
    ...(state.current.has(result.workstreamId)
      ? [sliceKey('current', result.workstreamId)]
      : []),
  ],

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

  // V2-UI-4: the six workstream-management faces.
  // updateObjective: the objective set renders from BOTH the `project`
  // slice (the frozen ProjectSnapshot.objectives face) and the
  // `current:<ws>` slices (ObjectiveFullDto face); the result carries no
  // workstreamId (the ws filter is linked_refs — not in the result), so
  // the cached current family is listed conservatively.
  updateObjective: (_result, state) => [
    'project',
    ...cachedCurrentKeys(state),
  ],

  // createNextAction: a PROPOSED NA renders in exactly the current:<ws>
  // slice of its workstream (host filter `workstreamId: <ws>`). A
  // workstream-less NA renders nowhere → defensive cached-`current:*`
  // listing (createTopic precedent: list the family; the refetch pass
  // skips idle slices).
  createNextAction: (result, state) =>
    result.nextAction.workstreamId === null
      ? cachedCurrentKeys(state)
      : [sliceKey('current', result.nextAction.workstreamId)],

  // promoteNextAction: the NA leaves the PROPOSED set (current:<ws>) and
  // plan.yaml gains the new task (workstreams:<ws> future zone + task
  // list). The result carries the workstreamId (non-null — an NA only
  // promotes into a workstream plan).
  promoteNextAction: (result, _state) => [
    sliceKey('current', result.workstreamId),
    sliceKey('workstreams', result.workstreamId),
  ],

  // dismissNextAction: the NA leaves the PROPOSED set — same shape as
  // createNextAction (workstreamId from the echoed NA DTO).
  dismissNextAction: (result, state) =>
    result.nextAction.workstreamId === null
      ? cachedCurrentKeys(state)
      : [sliceKey('current', result.nextAction.workstreamId)],

  // createBlocker: an ACTIVE blocker renders in the current:<ws> slice of
  // every ws it AFFECTS (ws ref, or the owner of a task/run ref — not
  // derivable from the result), so the cached current family is listed
  // conservatively. The workstreams slice has no blocker face (the frozen
  // WorkstreamSnapshot).
  createBlocker: (_result, state) => cachedCurrentKeys(state),

  // clearBlocker: same set as createBlocker — the blocker row flips to
  // CLEARED in every affected current zone.
  clearBlocker: (_result, state) => cachedCurrentKeys(state),

  // V2-UI-0.4 UI-5 (ADJ-8): the five plan-editor mutations — the unified
  // `workstreams:<ws>` + `current:<ws>` set. plan.yaml (future zone) and
  // the current face's plan projection (+ dependencyEdges, ADJ-7) both
  // re-derive; a created gate changes the derived-blocker inputs and a
  // remove may clear the CF pointer (ADJ-14). The three item rules read
  // the workstreamId from the result (direct addressing); the two
  // dependency rules cannot (relationId + echoed endpoints only) and list
  // the cached family conservatively — the refetch pass skips idle slices.
  createPlanItem: (result, _state) => [
    sliceKey('workstreams', result.workstreamId),
    sliceKey('current', result.workstreamId),
  ],

  updatePlanItem: (result, _state) => [
    sliceKey('workstreams', result.workstreamId),
    sliceKey('current', result.workstreamId),
  ],

  // F-9 (UI-5 fix round): the kernel auto-clears the CF pointer when
  // the removed item WAS the current focus (ADJ-14 revalidate,
  // rpc-services.ts removePlanItem) — the `currentFocus:<ws>` slice
  // must refetch too, or every focus face (header chip, current-zone
  // group, strip/graph focus markers) keeps the removed item's stale
  // pointer until a full reload (the NO-REFRESH drift D §10.8 forbids;
  // the same invalidation base as the setCurrentFocus rule below).
  removePlanItem: (result, _state) => [
    sliceKey('workstreams', result.workstreamId),
    sliceKey('currentFocus', result.workstreamId),
    sliceKey('current', result.workstreamId),
  ],

  addDependency: (_result, state) => [
    ...[...state.workstreams.keys()].map(key => sliceKey('workstreams', key)),
    ...cachedCurrentKeys(state),
  ],

  removeDependency: (_result, state) => [
    ...[...state.workstreams.keys()].map(key => sliceKey('workstreams', key)),
    ...cachedCurrentKeys(state),
  ],

  // V2-UI-6 (D1, D §12.2): the fork rewrites the owning topic's
  // topology (new FORK edges + the child workstream cards + the
  // workstreamCount) and the project aggregate follows — the same
  // shape as createWorkstream (the result carries the topicId).
  createWorkstreamFork: (result, _state) => [
    sliceKey('topics', result.topicId),
    'project',
  ],

  // V2-UI-6 (D2, BRIEF §3): the planned merge appends one PLANNED MERGE
  // edge to the owning topic's topology — same shape as the fork (the
  // result carries the topicId; the project aggregate follows).
  createPlannedMerge: (result, _state) => [
    sliceKey('topics', result.topicId),
    'project',
  ],

  // V2-UI-6 (D2, BRIEF §3): the contract read is a pure query — the
  // uniform face keeps the rule (inspectProjectDirectory precedent);
  // it invalidates NOTHING (the read writes no file, no ledger row).
  getMergeContract: (_result, _state) => [],

  // V2-UI-6 (D2, BRIEF §3 + RECON :858): the contract write rewrites
  // the owning topic's mergeContracts badges — topics:<t> ONLY (no
  // project aggregate: the project face has no contract projection).
  // The result carries no topicId, so the owner resolves from the
  // CACHED edges (the `cachedTopicId` precedent): idle/empty → no
  // keys (the topic's next load fetches live data).
  saveMergeContract: (result, state) => {
    const topicId = cachedTopicOfEdge(state, result.edgeId)
    return topicId === null ? [] : [sliceKey('topics', topicId)]
  },

  // V2-UI-6 (D3, BRIEF §3): the edge drop rewrites the owning topic's
  // topology (and the project index's topology projection) — the result
  // carries the resolved topicId, so no cache scan is needed.
  dropTopologyEdge: (result, _state) => [
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

/**
 * The topic owning a topology edge, resolvable ONLY from the cache (the
 * saveMergeContract result carries no topicId — it is the edge's owner
 * under whose `merges/<te>/contract.md` the file lives). Scans the
 * cached `topics:*` slices' edge lists. `null` when the owning topic
 * slice is idle/empty or the edge is cached nowhere — the caller then
 * invalidates nothing (the topic's next load fetches live data).
 */
function cachedTopicOfEdge(state: ResearchStoreState, edgeId: string): string | null {
  for (const [topicId, slice] of state.topics) {
    const data = slice?.data
    if (data === null || data === undefined) continue
    if (data.topology.edges.some(edge => edge.id === edgeId)) return topicId
  }
  return null
}

/**
 * The global keys of every CACHED `current:*` slice. The state map is the
 * ONLY source: the UI-4 mutation results (updateObjective / createBlocker
 * / clearBlocker / the extended updateInterventionState) carry no
 * workstreamIds (see the rule rationales above), so the affected
 * `current:<ws>` slices are resolvable only as a conservative family
 * listing. The refetch pass skips idle slices.
 */
function cachedCurrentKeys(state: ResearchStoreState): SliceKey[] {
  return [...state.current.keys()].map(key => sliceKey('current', key))
}
