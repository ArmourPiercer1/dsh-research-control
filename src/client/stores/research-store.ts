/**
 * The research client store (WP-4.1b) — the ONE top-level factory
 * `createResearchStore()` composing the query slices (the six WP-4.1b
 * slices + the `currentFocus` slice family, UI-0.4 R-01), the mutation
 * actions (the seven WP-4.1b mutations + `setCurrentFocus`, UI-0.4), and
 * the refresh loop (task brief items 1-2, 4).
 *
 * DSH_ADAPTER §6 compliance (hard rules, client side):
 *  - **factory, not handle**: `createResearchStore` is an exported
 *    factory; no pre-created instance is cached at module level. A Phase
 *    4 slot registration passes `createResearchStore()` through the slot
 *    option `store`; the host render machinery binds the bare
 *    `getSnapshot`/`subscribe` face (structurally `HostObservable<T>`) —
 *    no second subscription, components never see the store object
 *    itself (four-strand share).
 *  - **components don't see ctx**: the store never receives or returns a
 *    DSH context; it talks to the host ONLY through the typed `researchRpc`
 *    facade (dsh-adapter/remote/mount.ts) — the one exempt DSH-touching
 *    client surface.
 *
 * Data path (ARCHITECTURE §8 — no self-built streaming):
 *  1. every `load*` fetches a snapshot through the facade and caches it
 *     (snapshot cache; lazy — idle slices load on first request);
 *  2. a resolved-OK mutation runs its `INVALIDATE_REGISTRY` rule and
 *     refetches the affected non-idle slices (invalidate/refetch);
 *  3. `refresh()` is the low-frequency loop hook: the RR-015① stale
 *     seam (pre-refresh chain) → refetch ALL non-idle slices → fire the
 *     `onRefetch` listeners (Phase 4 views hang their page-level
 *     refresh, e.g. a polling timer calling `refresh()`, on this).
 *
 * State-machine discipline (model.ts): `idle → loading → ready | error`;
 * stale-while-revalidate keeps the last good `data` visible during a
 * refetch and after a refetch failure.
 *
 * Concurrency: one in-flight fetch per global slice key (concurrent
 * `load*`/refetch on the same key share the fetch — the key canonicalizes
 * the args, so sharing is always arg-identical); a newer request for the
 * same key waits for the older one instead of double-fetching, so
 * out-of-order settles can never clobber a newer value.
 */

import { researchRpc } from '../dsh-adapter/remote/mount.js'
import {
  type AddDependencyArgs,
  type AddDependencyResult,
  type AddRelationArgs,
  type AddRelationResult,
  type ClearBlockerArgs,
  type ClearBlockerResult,
  type CreateBlockerArgs,
  type CreateBlockerResult,
  type CreateLocalResearchProjectArgs,
  type CreateLocalResearchProjectResult,
  type CreateNextActionArgs,
  type CreateNextActionResult,
  type CreatePlanItemArgs,
  type CreatePlanItemResult,
  type CreatePlannedMergeArgs,
  type CreatePlannedMergeResult,
  type CreateTopicArgs,
  type CreateTopicResult,
  type CreateWorkstreamArgs,
  type CreateWorkstreamResult,
  type CreateWorkstreamForkArgs,
  type CreateWorkstreamForkResult,
  type DashboardSnapshot,
  type DismissNextActionArgs,
  type DismissNextActionResult,
  type DismissPlanForkArgs,
  type DismissPlanForkResult,
  type DropTopologyEdgeArgs,
  type DropTopologyEdgeResult,
  type DropWorkstreamArgs,
  type DropWorkstreamResult,
  type GetCurrentFocusArgs,
  type GetCurrentFocusResult,
  type GetGitHistoryArgs,
  type GetGitHistoryResult,
  type GetMergeContractArgs,
  type GetMergeContractResult,
  type GetWorkstreamCurrentArgs,
  type GetWorkstreamCurrentResult,
  type InspectProjectDirectoryArgs,
  type InspectProjectDirectoryResult,
  type MarkArtifactMissingArgs,
  type MarkArtifactMissingResult,
  type ProjectSnapshot,
  type PromoteNextActionArgs,
  type PromoteNextActionResult,
  type QueryHistoryArgs,
  type QueryHistoryResult,
  type QueryRecordsArgs,
  type QueryRecordsResult,
  type RecordClaimArgs,
  type RecordClaimResult,
  type RecordFactArgs,
  type RecordFactResult,
  type RegisterArtifactArgs,
  type RegisterArtifactResult,
  type RemoveRelationArgs,
  type RemoveRelationResult,
  type RetractClaimArgs,
  type RetractClaimResult,
  type ReorderPlanArgs,
  type ReorderPlanResult,
  type RemoveDependencyArgs,
  type RemoveDependencyResult,
  type RemovePlanItemArgs,
  type RemovePlanItemResult,
  type RegisterInteractionArgs,
  type RegisterInteractionResult,
  type RestoreDeclarativeFileArgs,
  type RestoreDeclarativeFileResult,
  type SaveMergeContractArgs,
  type SaveMergeContractResult,
  type SaveResearchCheckpointArgs,
  type SaveResearchCheckpointResult,
  type SetCurrentFocusArgs,
  type SetCurrentFocusResult,
  type SelectPlanForkArgs,
  type SelectPlanForkResult,
  type TopicSnapshot,
  type UpdateInterventionStateArgs,
  type UpdateInterventionStateResult,
  type UpdateObjectiveArgs,
  type UpdateObjectiveResult,
  type UpdatePlanItemArgs,
  type UpdatePlanItemResult,
  type UpdateProjectMetadataArgs,
  type UpdateProjectMetadataResult,
  type UpdateTopicArgs,
  type UpdateTopicResult,
  type UpdateWorkstreamArgs,
  type UpdateWorkstreamResult,
  type WorkstreamSnapshot,
} from '../../shared/rpc-contracts.js'
import { createStore, type StoreSnapshotSource } from './engine.js'
import {
  gitHistoryKey,
  historyKey,
  idleSlice,
  initialResearchStoreState,
  parseSliceKey,
  ResearchRpcError,
  sliceKey,
  type RpcResult,
  type ResearchStoreState,
  type SliceKey,
  type SliceState,
} from './model.js'
import { INVALIDATE_REGISTRY, type MutationId } from './registry.js'

/* -------------------------------------------------------------------- *
 * Options
 * -------------------------------------------------------------------- */

/** The typed facade face the store consumes (mount.ts `researchRpc`). */
export type ResearchRpcFacade = typeof researchRpc

/**
 * A pre-refresh hook of the refresh loop (called with the refresh reason
 * before any slice refetch; a rejection aborts the whole refresh).
 */
export type RefreshPreHook = (reason: string) => Promise<void> | void

/**
 * **RR-015① stale seam.** The refresh chain's FIRST slot is reserved for
 * the host stale check (the host stale service's `checkStale` /
 * `checkAllOpen`). As of WP-4.1b that check is UNREACHABLE from the
 * client: the frozen 13-RPC list (ARCHITECTURE §7.1) carries no
 * stale-detection method, the host stale service has zero production
 * callers (G3 r1 finding, RR-015①), and the host wiring exposes no
 * refresh face that would embed it. Whether a diagnostic RPC is added is
 * the orchestrator's ruling BEFORE the Phase 4 final E2E (registered in
 * the WP-4.1b report); no 15th RPC is invented here. Until then the
 * default seam is a no-op, and the wiring passes a real hook only once a
 * surface exists — the store shape stays unchanged.
 */
export type StaleCheckHook = RefreshPreHook

const NOOP_STALE_CHECK: StaleCheckHook = () => undefined

export interface ResearchStoreOptions {
  /**
   * The RPC facade. Defaults to the mount-bound `researchRpc` (the
   * pre-mount guard rejects loudly —「not mounted」— so a store used
   * before `mountResearchRemotes` fails every call audibly). Tests
   * inject a stub; production wiring never needs this.
   */
  readonly rpc?: ResearchRpcFacade
  /**
   * The RR-015① stale seam (default: no-op). Runs first on every
   * `refresh()` cycle; a rejection aborts the refresh before any refetch.
   */
  readonly staleCheck?: StaleCheckHook
}

/* -------------------------------------------------------------------- *
 * Public store face
 * -------------------------------------------------------------------- */

export interface ResearchStore extends StoreSnapshotSource<ResearchStoreState> {
  /** The current snapshot (same reference semantics as `getSnapshot`). */
  getState(): ResearchStoreState

  /* -- the query slices (lazy; snapshot cache; loading/ready/error) -- */

  /** Fetch the Home/Portfolio Dashboard snapshot (§27.1). */
  loadDashboard(): Promise<void>
  /** Fetch the Project Page snapshot (§27.2). */
  loadProject(): Promise<void>
  /** Fetch one Topic Page snapshot (§27.3); cached per `topicId`. */
  loadTopic(topicId: string): Promise<void>
  /** Fetch one Workstream Page snapshot (§27.4 three zones); cached per `workstreamId`. */
  loadWorkstream(workstreamId: string): Promise<void>
  /** Fetch one History window (§27.4 History zone); cached per canonical query. */
  loadHistory(args: QueryHistoryArgs): Promise<void>
  /** Fetch one Git version/diff window (checkpoint face); cached per canonical query. */
  loadGitHistory(args: GetGitHistoryArgs): Promise<void>
  /**
   * Read back the workstream's current-focus pointer (UI-0.4, R-01);
   * cached per `workstreamId` (the `currentFocus` slice family, load +
   * cache + stale-while-revalidate like the other families). The frozen
   * `WorkstreamSnapshot` cannot carry the pointer (rpc-contracts
   * §getCurrentFocus note), so this read owns its slice — a view selects
   * the value from `state.currentFocus.get(workstreamId)`.
   */
  getCurrentFocus(args: GetCurrentFocusArgs): Promise<void>
  /**
   * Fetch the Current Execution aggregate (UI-4, ADJ-8): objectives +
   * explicit/derived blockers + next actions + interventions for one
   * workstream; cached per `workstreamId` (the `current` slice family —
   * load + cache + stale-while-revalidate like the other families). The
   * frozen `WorkstreamSnapshot` cannot carry these faces, so this read
   * owns its slice — a view selects from `state.current.get(workstreamId)`.
   */
  loadWorkstreamCurrent(args: GetWorkstreamCurrentArgs): Promise<void>

  /* -- the mutation actions: resolve with the host result; on OK,
          invalidate per the registry + refetch the affected slices; a
          business fault (ok:false) rejects with `ResearchRpcError`, a
          transport fault (not mounted, arity, network) re-throws -- */

  reorderPlan(args: ReorderPlanArgs): Promise<ReorderPlanResult>
  selectPlanFork(args: SelectPlanForkArgs): Promise<SelectPlanForkResult>
  dismissPlanFork(args: DismissPlanForkArgs): Promise<DismissPlanForkResult>
  updateInterventionState(args: UpdateInterventionStateArgs): Promise<UpdateInterventionStateResult>
  registerInteraction(args: RegisterInteractionArgs): Promise<RegisterInteractionResult>
  saveResearchCheckpoint(args: SaveResearchCheckpointArgs): Promise<SaveResearchCheckpointResult>
  restoreDeclarativeFile(args: RestoreDeclarativeFileArgs): Promise<RestoreDeclarativeFileResult>
  /**
   * Set the workstream's current-focus pointer (UI-0.4, R-01 — the USER
   * mutation). On OK, refetches per the registry: the `currentFocus`
   * slice of the mutated workstream (no other existing slice's DTO
   * carries focus data — the frozen WorkstreamSnapshot cannot gain the
   * field — so the CF slice is the whole store-level invalidation today;
   * the focus surfaces — header / future strip / graph — are UI-4 work
   * selecting from this slice).
   */
  setCurrentFocus(args: SetCurrentFocusArgs): Promise<SetCurrentFocusResult>

  /* -- V2-UI-0.4 UI-2 (UI-2A / UI-2B): the six GUI management mutations
         (the 4 hierarchy update/drop faces, project-routed — UI-2A — and
         the 2 local-project faces, plane-level — UI-2B). Same idiom:
         okValue → INVALIDATE_REGISTRY → refetchKeys; a business fault
         rejects with ResearchRpcError. `inspectProjectDirectory` is a
         QUERY face surfaced through the store for uniformity (its
         registry rule invalidates nothing — it mutates no state). -- */

  /** Update the project's editable metadata (RMW merge — omitted fields
   *  keep their on-disk value). On OK: refetches `project`. */
  updateProjectMetadata(args: UpdateProjectMetadataArgs): Promise<UpdateProjectMetadataResult>
  /** Update a topic's title/description/importance/attentionMode. On
   *  OK: refetches the topic slice. */
  updateTopic(args: UpdateTopicArgs): Promise<UpdateTopicResult>
  /** Update a workstream's title/summary. On OK: refetches the
   *  workstream slice. */
  updateWorkstream(args: UpdateWorkstreamArgs): Promise<UpdateWorkstreamResult>
  /** Drop a workstream (conservative: refuses on history refs; deletes
   *  the ws directory; best-effort CF clear). On OK: refetches the ws +
   *  its topic + the dashboard. */
  dropWorkstream(args: DropWorkstreamArgs): Promise<DropWorkstreamResult>
  /** Inspect a directory's research-control state (the Bind journey's
   *  detector). QUERY — no invalidation (rule returns `[]`). */
  inspectProjectDirectory(args: InspectProjectDirectoryArgs): Promise<InspectProjectDirectoryResult>
  /** Create a local research project (the Create journey's 5-step
   *  chain). RESOLVES with the strict result union (success arm / the
   *  ok:false three-stage failure arm — step failures do NOT reject);
   *  pre-check faults reject. On OK success: refetches `dashboard`. */
  createLocalResearchProject(args: CreateLocalResearchProjectArgs): Promise<CreateLocalResearchProjectResult>

  /* -- V2-UI-0.4 UI-3: the two hierarchy CREATE mutations. The host
         faces pre-existed (03e3f92); the client facade + store wiring
         is new in this slice. Same idiom: okValue →
         INVALIDATE_REGISTRY → refetchKeys. -- */

  /** Create a topic under the project (projectId optional — the host
   *  resolves the ambient project per the §12.1 routing rules). On OK:
   *  refetches `project` + every cached topic slice. */
  createTopic(args: CreateTopicArgs): Promise<CreateTopicResult>
  /** Create a workstream under a topic. On OK: refetches the owning
   *  topic slice + `project`. */
  createWorkstream(args: CreateWorkstreamArgs): Promise<CreateWorkstreamResult>

  /* -- V2-UI-4: the six workstream-management mutations. Same idiom:
         okValue → INVALIDATE_REGISTRY → refetchKeys; a business fault
         rejects with ResearchRpcError. -- */

  /** Edit a goal (statement and/or status; at least one required). On
   *  OK: refetches `project` + every cached `current` slice. */
  updateObjective(args: UpdateObjectiveArgs): Promise<UpdateObjectiveResult>
  /** Propose a next action (workstream optional — a workstream-less NA
   *  is a project-level proposal). On OK: refetches the owning `current`
   *  slice (or every cached `current` slice when the NA has no ws). */
  createNextAction(args: CreateNextActionArgs): Promise<CreateNextActionResult>
  /** Promote a next action to a plan task. On OK: refetches the
   *  workstream's `current` + `workstreams` slices (plan.yaml gained the
   *  new task). */
  promoteNextAction(args: PromoteNextActionArgs): Promise<PromoteNextActionResult>
  /** Dismiss a next action. On OK: refetches the owning `current` slice
   *  (or every cached `current` slice when the NA has no ws). */
  dismissNextAction(args: DismissNextActionArgs): Promise<DismissNextActionResult>
  /** Record an explicit blocker on workstream/task/run refs. On OK:
   *  refetches every cached `current` slice (the affected ws set is not
   *  derivable from the result). */
  createBlocker(args: CreateBlockerArgs): Promise<CreateBlockerResult>
  /** Clear an explicit blocker (the row flips to CLEARED — it stays in
   *  the ledger). On OK: refetches every cached `current` slice. */
  clearBlocker(args: ClearBlockerArgs): Promise<ClearBlockerResult>

  /* -- V2-UI-0.4 UI-5 (brief §3): the five plan-editor mutations. Same
         idiom: okValue → INVALIDATE_REGISTRY → refetchKeys. The
         invalidation set is the ADJ-8 unified `workstreams:<ws>` +
         `current:<ws>` (direct addressing for the three item faces; the
         dependency faces carry no workstreamId → conservative cached
         family listing). removePlanItem additionally clears the CF
         pointer on the host side when the removed item was the focus
         (ADJ-14 — the `current:<ws>` refetch picks up the cleared
         projection). -- */

  /** Create a plan item (TASK/GATE/MILESTONE) at `index` (0-based,
   *  default tail). On OK: refetches `workstreams:<ws>` +
   *  `current:<ws>`. */
  createPlanItem(args: CreatePlanItemArgs): Promise<CreatePlanItemResult>
  /** Update a plan item's fields (RMW: omitted = unchanged, explicit
   *  null = clear). On OK: refetches `workstreams:<ws>` +
   *  `current:<ws>`. */
  updatePlanItem(args: UpdatePlanItemArgs): Promise<UpdatePlanItemResult>
  /** Remove a plan item from the plan (its definition stays on disk).
   *  On OK: refetches `workstreams:<ws>` + `current:<ws>` (the CF
   *  pointer is cleared host-side when the item was the focus,
   *  ADJ-14). */
  removePlanItem(args: RemovePlanItemArgs): Promise<RemovePlanItemResult>
  /** Record a DEPENDS_ON edge between two plan items. On OK: refetches
   *  every cached `workstreams:*` + `current:*` slice (the result
   *  carries no workstreamId). */
  addDependency(args: AddDependencyArgs): Promise<AddDependencyResult>
  /** Remove an ACTIVE DEPENDS_ON edge (its log row stays). On OK:
   *  refetches every cached `workstreams:*` + `current:*` slice (the
   *  result carries no workstreamId). */
  removeDependency(args: RemoveDependencyArgs): Promise<RemoveDependencyResult>
  /** UI-6 (D1, D §12.2): fork the parent workstream into N children
   *  (per child: new WS + one 1:1 FORK edge) → TOPOLOGY_EDITED. On OK:
   *  refetches the owning topic slice + the project index (the result
   *  carries the topicId). */
  createWorkstreamFork(args: CreateWorkstreamForkArgs): Promise<CreateWorkstreamForkResult>
  /** UI-6 (D2, BRIEF §3): plan a merge over existing workstreams (one
   *  PLANNED MERGE edge, existing-output-first) → TOPOLOGY_EDITED. On
   *  OK: refetches the owning topic slice + the project index (the
   *  result carries the topicId). */
  createPlannedMerge(args: CreatePlannedMergeArgs): Promise<CreatePlannedMergeResult>
  /** UI-6 (D2, BRIEF §3): read the merge contract for an edge —
   *  `content` null is the missing-contract value face (no refetch). */
  getMergeContract(args: GetMergeContractArgs): Promise<GetMergeContractResult>
  /** UI-6 (D2, BRIEF §3): full-replacement write of the merge contract
   *  file → CONTRACT_EDITED. On OK: refetches the owning topic slice
   *  (resolved from the cached edges; no project index — RECON :858). */
  saveMergeContract(args: SaveMergeContractArgs): Promise<SaveMergeContractResult>
  /** UI-6 (D3, BRIEF §3): drop a topology edge (state-machine
   *  authority; DROPPED → DROPPED is the error carrier). On OK:
   *  refetches the owning topic slice + the project index. */
  dropTopologyEdge(args: DropTopologyEdgeArgs): Promise<DropTopologyEdgeResult>

  /* -- V2-UI-7 (D §13): the Records face — the seven semantic writes +
          the queryRecords read. Same idiom: okValue →
          INVALIDATE_REGISTRY → refetchKeys. -- */

  /** Fetch the workstream's Records (FACT/CLAIM/ARTIFACT rows with the
   *  derived relations + the PENDING_REVIEW conflict flag, D §13.4);
   *  cached per `workstreamId` (the `records` slice family — load +
   *  cache + stale-while-revalidate like the other families). The
   *  UI-driven load always carries the workstreamId (the slice key);
   *  the filter/pagination args ride `lastArgs` (a refetch re-issues
   *  the LAST full query for the key). */
  loadRecords(args: QueryRecordsArgs & { readonly workstreamId: string }): Promise<void>
  /** Record a FACT row (status const ACTIVE; the event log is the only
   *  storage — the derived row is folded in the same tx). On OK:
   *  refetches `workstreams:<ws>` + `records:<ws>`. */
  recordFact(args: RecordFactArgs): Promise<RecordFactResult>
  /** Record a CLAIM row (ACTIVE). On OK: refetches `workstreams:<ws>` +
   *  `records:<ws>`. */
  recordClaim(args: RecordClaimArgs): Promise<RecordClaimResult>
  /** Retract an ACTIVE claim (RETRACTED terminal; a missing or
   *  already-retracted claim rejects with the domain-code carrier). On
   *  OK: refetches every cached `workstreams:*` + `records:*` slice
   *  (the result carries no workstreamId). */
  retractClaim(args: RetractClaimArgs): Promise<RetractClaimResult>
  /** Register an external artifact BY REFERENCE (7-value frozen type;
   *  the file is never copied). On OK: refetches `workstreams:<ws>` +
   *  `records:<ws>`. */
  registerArtifact(args: RegisterArtifactArgs): Promise<RegisterArtifactResult>
  /** Mark a REGISTERED artifact MISSING (V1 one-way). On OK: refetches
   *  every cached `workstreams:*` + `records:*` slice (the result
   *  carries no workstreamId). */
  markArtifactMissing(args: MarkArtifactMissingArgs): Promise<MarkArtifactMissingResult>
  /** Add a relation edge (one of the 10 frozen types; the owner
   *  workstream is derived from the endpoints — no workstreamId on the
   *  wire). On OK: refetches every cached `workstreams:*` +
   *  `records:*` slice. */
  addRelation(args: AddRelationArgs): Promise<AddRelationResult>
  /** Remove an ACTIVE relation edge (REMOVED terminal; the §5.5 payload
   *  mirrors the stored edge). On OK: refetches every cached
   *  `workstreams:*` + `records:*` slice. */
  removeRelation(args: RemoveRelationArgs): Promise<RemoveRelationResult>

  /* -- the refresh loop (ARCHITECTURE §8 items 3/4) -- */

  /**
   * One refresh cycle: run the pre-refresh chain (RR-015① stale seam
   * first) → refetch every non-idle slice → fire the `onRefetch`
   * listeners. Idempotent; safe to drive from a view-side polling timer.
   * @param reason - reported to the pre-refresh hooks (default `'manual'`).
   */
  refresh(reason?: string): Promise<void>

  /**
   * Register a refresh-completion listener (Phase 4 views hang their
   * page-level refresh on this — e.g. re-deriving a filtered timeline
   * after the store's windows refreshed).
   * @returns the disposer (idempotent).
   */
  onRefetch(callback: () => void): () => void
}

/* -------------------------------------------------------------------- *
 * Factory
 * -------------------------------------------------------------------- */

/** The slice family (state field name) plus its payload type. */
type SliceFamily =
  | 'dashboard'
  | 'project'
  | 'topics'
  | 'workstreams'
  | 'history'
  | 'gitHistory'
  | 'currentFocus'
  | 'current'
  | 'records'

interface FamilyData {
  dashboard: DashboardSnapshot
  project: ProjectSnapshot
  topics: TopicSnapshot
  workstreams: WorkstreamSnapshot
  history: QueryHistoryResult
  gitHistory: GetGitHistoryResult
  currentFocus: GetCurrentFocusResult
  current: GetWorkstreamCurrentResult
  records: QueryRecordsResult
}

/** Unwrap an `RpcResult`: business fault → `ResearchRpcError`; OK → the value. */
function okValue<R>(res: RpcResult<R>): R {
  if (!res.ok) throw new ResearchRpcError(res.error.code, res.error.message, res.error.details)
  return res.value
}

/**
 * Create the research store (the unique top-level client store factory).
 * @param options - facade/stale-seam injection (both default to the
 *   production wiring).
 * @returns a fresh store instance (module-level handles forbidden —
 *   DSH_ADAPTER §6); wire it through the slot option `store`.
 */
export function createResearchStore(options?: ResearchStoreOptions): ResearchStore {
  const rpc = options?.rpc ?? researchRpc
  const staleCheck = options?.staleCheck ?? NOOP_STALE_CHECK

  const base = createStore<ResearchStoreState>(initialResearchStoreState())
  /** Last args per global slice key (refetch bookkeeping — outside the observable snapshot). */
  const lastArgs = new Map<string, unknown>()
  /** One in-flight fetch per global slice key (dedupe). */
  const inflight = new Map<string, Promise<void>>()
  const refetchListeners = new Set<() => void>()

  /* -- immutable slice commits.
   *
   * The junction is type-erased (`SliceState<unknown>`): the per-family
   * payload type is enforced at the two real boundaries — the `loadQuery`
   * fetch signature (family -> `FamilyData[F]`, tsc-rejected on
   * cross-wiring) and the typed state field — so the erasure cannot
   * smuggle a wrong payload into a slice. */

  function readFromPrev(prev: ResearchStoreState, family: SliceFamily, localKey: string): SliceState<unknown> {
    if (family === 'dashboard') return prev.dashboard
    if (family === 'project') return prev.project
    return prev[family].get(localKey) ?? idleSlice()
  }

  function writeIntoPrev(
    prev: ResearchStoreState,
    family: SliceFamily,
    localKey: string,
    next: SliceState<unknown>,
  ): ResearchStoreState {
    if (readFromPrev(prev, family, localKey) === next) return prev
    if (family === 'dashboard') return { ...prev, dashboard: next } as ResearchStoreState
    if (family === 'project') return { ...prev, project: next } as ResearchStoreState
    const copy = new Map(prev[family] as ReadonlyMap<string, SliceState<unknown>>)
    copy.set(localKey, next)
    return { ...prev, [family]: copy } as ResearchStoreState
  }

  function markLoading(family: SliceFamily, localKey: string): void {
    base.setState(prev => {
      const cur = readFromPrev(prev, family, localKey)
      if (cur.status === 'loading' && cur.error === null) return prev
      return writeIntoPrev(prev, family, localKey, { ...cur, status: 'loading', error: null })
    })
  }

  function markReady<F extends SliceFamily>(family: F, localKey: string, data: FamilyData[F]): void {
    base.setState(prev =>
      writeIntoPrev(prev, family, localKey, {
        ...readFromPrev(prev, family, localKey),
        status: 'ready',
        data,
        error: null,
        updatedAt: Date.now(),
      }),
    )
  }

  function markError(family: SliceFamily, localKey: string, message: string): void {
    base.setState(prev =>
      writeIntoPrev(prev, family, localKey, {
        ...readFromPrev(prev, family, localKey),
        // Stale-while-revalidate: a failed refetch KEEPS the last good data.
        status: 'error',
        error: message,
      }),
    )
  }

  /* -- the query engine (shared by the six load* actions and refetch) -- */

  async function loadQuery<F extends SliceFamily>(
    family: F,
    localKey: string,
    args: unknown,
    fetch: () => Promise<RpcResult<FamilyData[F]>>,
  ): Promise<void> {
    const globalKey = sliceKey(family, localKey)
    const shared = inflight.get(globalKey)
    if (shared !== undefined) return shared
    const run = (async (): Promise<void> => {
      lastArgs.set(globalKey, args)
      markLoading(family, localKey)
      try {
        const res = await fetch()
        if (!res.ok) {
          markError(family, localKey, `${res.error.code}: ${res.error.message}`)
          return
        }
        markReady(family, localKey, res.value)
      } catch (err) {
        // Transport/assembly fault (not mounted, arity, network) — the
        // slice carries the error AND the action rejects (fail loud).
        markError(family, localKey, err instanceof Error ? err.message : String(err))
        throw err
      }
    })()
    inflight.set(globalKey, run)
    try {
      await run
    } finally {
      inflight.delete(globalKey)
    }
  }

  /** Re-issue the cached fetch for one slice (joins an in-flight fetch of the same key). */
  function refetchOne(family: SliceFamily, localKey: string): Promise<void> {
    switch (family) {
      case 'dashboard':
        return loadQuery('dashboard', '', null, () => rpc.getDashboard())
      case 'project':
        return loadQuery('project', '', null, () => rpc.getProject())
      case 'topics':
        return loadQuery('topics', localKey, { topicId: localKey }, () => rpc.getTopic({ topicId: localKey }))
      case 'workstreams':
        return loadQuery('workstreams', localKey, { workstreamId: localKey }, () => rpc.getWorkstream({ workstreamId: localKey }))
      case 'history': {
        const args = lastArgs.get(sliceKey('history', localKey)) as QueryHistoryArgs
        return loadQuery('history', localKey, args, () => rpc.queryHistory(args))
      }
      case 'gitHistory': {
        const args = lastArgs.get(sliceKey('gitHistory', localKey)) as GetGitHistoryArgs
        return loadQuery('gitHistory', localKey, args, () => rpc.getGitHistory(args))
      }
      case 'currentFocus':
        // The CF slice is keyed by the bare workstreamId (the optional
        // `projectId` routing is left to the plane default — same as the
        // other per-id slices above).
        return loadQuery('currentFocus', localKey, { workstreamId: localKey }, () =>
          rpc.getCurrentFocus({ workstreamId: localKey }),
        )
      case 'current':
        // The Current Execution aggregate (UI-4) — keyed by the bare
        // workstreamId, same routing convention as the CF slice above.
        return loadQuery('current', localKey, { workstreamId: localKey }, () =>
          rpc.getWorkstreamCurrent({ workstreamId: localKey }),
        )
      case 'records':
        // The Records face (UI-7) — keyed by the bare workstreamId; the
        // refetch re-issues the LAST full query for the key (filters +
        // pagination ride lastArgs, like the history/gitHistory windows).
        return loadQuery(
          'records',
          localKey,
          lastArgs.get(sliceKey('records', localKey)),
          async () => {
            const args = lastArgs.get(sliceKey('records', localKey)) as QueryRecordsArgs
            return rpc.queryRecords(args)
          },
        )
    }
  }

  /** Invalidate the given slice keys: refetch exactly the non-idle ones (parallel). */
  async function refetchKeys(keys: readonly SliceKey[]): Promise<void> {
    const state = base.getState()
    const runs: Promise<void>[] = []
    for (const key of keys) {
      const { slice, key: localKey } = parseSliceKey(key)
      if (readFromPrev(state, slice, localKey).status === 'idle') {
        continue // no cache to invalidate; the next load fetches live data
      }
      runs.push(refetchOne(slice, localKey))
    }
    await Promise.all(runs)
  }

  /** Every global slice key currently holding data or an error (non-idle). */
  function activeKeys(): SliceKey[] {
    const state = base.getState()
    const keys: SliceKey[] = []
    if (state.dashboard.status !== 'idle') keys.push('dashboard')
    if (state.project.status !== 'idle') keys.push('project')
    for (const family of ['topics', 'workstreams', 'history', 'gitHistory', 'currentFocus', 'current', 'records'] as const) {
      for (const [localKey, slice] of state[family]) {
        if (slice.status !== 'idle') keys.push(sliceKey(family, localKey))
      }
    }
    return keys
  }

  /* -- the store object -- */

  return {
    getSnapshot: () => base.getSnapshot(),
    subscribe: listener => base.subscribe(listener),
    getState: () => base.getState(),

    /* the query slices */

    loadDashboard: () => loadQuery('dashboard', '', null, () => rpc.getDashboard()),
    loadProject: () => loadQuery('project', '', null, () => rpc.getProject()),
    loadTopic: (topicId: string) => loadQuery('topics', topicId, { topicId }, () => rpc.getTopic({ topicId })),
    loadWorkstream: (workstreamId: string) =>
      loadQuery('workstreams', workstreamId, { workstreamId }, () => rpc.getWorkstream({ workstreamId })),
    loadHistory: (args: QueryHistoryArgs) => loadQuery('history', historyKey(args), args, () => rpc.queryHistory(args)),
    loadGitHistory: (args: GetGitHistoryArgs) => loadQuery('gitHistory', gitHistoryKey(args), args, () => rpc.getGitHistory(args)),
    // UI-0.4 (R-01): the current-focus read — its own slice family, the
    // same load + cache + stale-while-revalidate machinery as the rest.
    getCurrentFocus: (args: GetCurrentFocusArgs) =>
      loadQuery('currentFocus', args.workstreamId, args, () => rpc.getCurrentFocus(args)),
    // UI-4 (ADJ-8): the Current Execution aggregate — its own slice
    // family, the same machinery as the CF slice above.
    loadWorkstreamCurrent: (args: GetWorkstreamCurrentArgs) =>
      loadQuery('current', args.workstreamId, args, () => rpc.getWorkstreamCurrent(args)),
    // UI-7 (D §13): the Records face — its own slice family, keyed by
    // the bare workstreamId (the filter/pagination args ride lastArgs;
    // a refetch re-issues the LAST full query for the key).
    loadRecords: (args: QueryRecordsArgs & { readonly workstreamId: string }) =>
      loadQuery('records', args.workstreamId, args, () => rpc.queryRecords(args)),

    /* the mutation actions */

    async reorderPlan(args: ReorderPlanArgs): Promise<ReorderPlanResult> {
      const value = okValue(await rpc.reorderPlan(args))
      await refetchKeys(INVALIDATE_REGISTRY.reorderPlan(value, base.getState()))
      return value
    },

    async selectPlanFork(args: SelectPlanForkArgs): Promise<SelectPlanForkResult> {
      const value = okValue(await rpc.selectPlanFork(args))
      await refetchKeys(INVALIDATE_REGISTRY.selectPlanFork(value, base.getState()))
      return value
    },

    async dismissPlanFork(args: DismissPlanForkArgs): Promise<DismissPlanForkResult> {
      const value = okValue(await rpc.dismissPlanFork(args))
      await refetchKeys(INVALIDATE_REGISTRY.dismissPlanFork(value, base.getState()))
      return value
    },

    async updateInterventionState(args: UpdateInterventionStateArgs): Promise<UpdateInterventionStateResult> {
      const value = okValue(await rpc.updateInterventionState(args))
      await refetchKeys(INVALIDATE_REGISTRY.updateInterventionState(value, base.getState()))
      return value
    },

    async registerInteraction(args: RegisterInteractionArgs): Promise<RegisterInteractionResult> {
      const value = okValue(await rpc.registerInteraction(args))
      await refetchKeys(INVALIDATE_REGISTRY.registerInteraction(value, base.getState()))
      return value
    },

    async saveResearchCheckpoint(args: SaveResearchCheckpointArgs): Promise<SaveResearchCheckpointResult> {
      const value = okValue(await rpc.saveResearchCheckpoint(args))
      await refetchKeys(INVALIDATE_REGISTRY.saveResearchCheckpoint(value, base.getState()))
      return value
    },

    async restoreDeclarativeFile(args: RestoreDeclarativeFileArgs): Promise<RestoreDeclarativeFileResult> {
      const value = okValue(await rpc.restoreDeclarativeFile(args))
      await refetchKeys(INVALIDATE_REGISTRY.restoreDeclarativeFile(value, base.getState()))
      return value
    },

    // UI-0.4 (R-01): the current-focus mutation — the same okValue →
    // INVALIDATE_REGISTRY → refetchKeys idiom as the seven above. No
    // optimistic update: the slice moves only on the refetch's good read.
    async setCurrentFocus(args: SetCurrentFocusArgs): Promise<SetCurrentFocusResult> {
      const value = okValue(await rpc.setCurrentFocus(args))
      await refetchKeys(INVALIDATE_REGISTRY.setCurrentFocus(value, base.getState()))
      return value
    },

    /* V2-UI-0.4 UI-2 — the six GUI management mutations: the same
       okValue → INVALIDATE_REGISTRY → refetchKeys idiom. createLocal-
       ResearchProject RESOLVES with the failure arm too (the three-
       stage contract — only pre-checks reject); the registry rule
       refetches the dashboard on the success arm, nothing on the
       failure arm (the wizard renders the partial change, no cache is
       affected). */

    async updateProjectMetadata(args: UpdateProjectMetadataArgs): Promise<UpdateProjectMetadataResult> {
      const value = okValue(await rpc.updateProjectMetadata(args))
      await refetchKeys(INVALIDATE_REGISTRY.updateProjectMetadata(value, base.getState()))
      return value
    },

    async updateTopic(args: UpdateTopicArgs): Promise<UpdateTopicResult> {
      const value = okValue(await rpc.updateTopic(args))
      await refetchKeys(INVALIDATE_REGISTRY.updateTopic(value, base.getState()))
      return value
    },

    async updateWorkstream(args: UpdateWorkstreamArgs): Promise<UpdateWorkstreamResult> {
      const value = okValue(await rpc.updateWorkstream(args))
      await refetchKeys(INVALIDATE_REGISTRY.updateWorkstream(value, base.getState()))
      return value
    },

    async dropWorkstream(args: DropWorkstreamArgs): Promise<DropWorkstreamResult> {
      const value = okValue(await rpc.dropWorkstream(args))
      await refetchKeys(INVALIDATE_REGISTRY.dropWorkstream(value, base.getState()))
      return value
    },

    async inspectProjectDirectory(args: InspectProjectDirectoryArgs): Promise<InspectProjectDirectoryResult> {
      const value = okValue(await rpc.inspectProjectDirectory(args))
      await refetchKeys(INVALIDATE_REGISTRY.inspectProjectDirectory(value, base.getState()))
      return value
    },

    async createLocalResearchProject(
      args: CreateLocalResearchProjectArgs,
    ): Promise<CreateLocalResearchProjectResult> {
      const value = okValue(await rpc.createLocalResearchProject(args))
      await refetchKeys(INVALIDATE_REGISTRY.createLocalResearchProject(value, base.getState()))
      return value
    },

    /* V2-UI-0.4 UI-3 — the two hierarchy CREATE mutations: the same
       okValue → INVALIDATE_REGISTRY → refetchKeys idiom. Both RESOLVE
       the strict result on OK; a business fault rejects with
       ResearchRpcError (okValue). */

    async createTopic(args: CreateTopicArgs): Promise<CreateTopicResult> {
      const value = okValue(await rpc.createTopic(args))
      await refetchKeys(INVALIDATE_REGISTRY.createTopic(value, base.getState()))
      return value
    },

    async createWorkstream(args: CreateWorkstreamArgs): Promise<CreateWorkstreamResult> {
      const value = okValue(await rpc.createWorkstream(args))
      await refetchKeys(INVALIDATE_REGISTRY.createWorkstream(value, base.getState()))
      return value
    },

    /* V2-UI-4 — the six workstream-management mutations: the same
       okValue → INVALIDATE_REGISTRY → refetchKeys idiom (no optimistic
       updates — the slice moves only on the refetch's good read). */
    async updateObjective(args: UpdateObjectiveArgs): Promise<UpdateObjectiveResult> {
      const value = okValue(await rpc.updateObjective(args))
      await refetchKeys(INVALIDATE_REGISTRY.updateObjective(value, base.getState()))
      return value
    },

    async createNextAction(args: CreateNextActionArgs): Promise<CreateNextActionResult> {
      const value = okValue(await rpc.createNextAction(args))
      await refetchKeys(INVALIDATE_REGISTRY.createNextAction(value, base.getState()))
      return value
    },

    async promoteNextAction(args: PromoteNextActionArgs): Promise<PromoteNextActionResult> {
      const value = okValue(await rpc.promoteNextAction(args))
      await refetchKeys(INVALIDATE_REGISTRY.promoteNextAction(value, base.getState()))
      return value
    },

    async dismissNextAction(args: DismissNextActionArgs): Promise<DismissNextActionResult> {
      const value = okValue(await rpc.dismissNextAction(args))
      await refetchKeys(INVALIDATE_REGISTRY.dismissNextAction(value, base.getState()))
      return value
    },

    async createBlocker(args: CreateBlockerArgs): Promise<CreateBlockerResult> {
      const value = okValue(await rpc.createBlocker(args))
      await refetchKeys(INVALIDATE_REGISTRY.createBlocker(value, base.getState()))
      return value
    },

    async clearBlocker(args: ClearBlockerArgs): Promise<ClearBlockerResult> {
      const value = okValue(await rpc.clearBlocker(args))
      await refetchKeys(INVALIDATE_REGISTRY.clearBlocker(value, base.getState()))
      return value
    },

    /* V2-UI-0.4 UI-5 (brief §3): the five plan-editor mutations — the
       ADJ-8 unified invalidation set per the registry rules above. */

    async createPlanItem(args: CreatePlanItemArgs): Promise<CreatePlanItemResult> {
      const value = okValue(await rpc.createPlanItem(args))
      await refetchKeys(INVALIDATE_REGISTRY.createPlanItem(value, base.getState()))
      return value
    },

    async updatePlanItem(args: UpdatePlanItemArgs): Promise<UpdatePlanItemResult> {
      const value = okValue(await rpc.updatePlanItem(args))
      await refetchKeys(INVALIDATE_REGISTRY.updatePlanItem(value, base.getState()))
      return value
    },

    async removePlanItem(args: RemovePlanItemArgs): Promise<RemovePlanItemResult> {
      const value = okValue(await rpc.removePlanItem(args))
      await refetchKeys(INVALIDATE_REGISTRY.removePlanItem(value, base.getState()))
      return value
    },

    async addDependency(args: AddDependencyArgs): Promise<AddDependencyResult> {
      const value = okValue(await rpc.addDependency(args))
      await refetchKeys(INVALIDATE_REGISTRY.addDependency(value, base.getState()))
      return value
    },

    async removeDependency(args: RemoveDependencyArgs): Promise<RemoveDependencyResult> {
      const value = okValue(await rpc.removeDependency(args))
      await refetchKeys(INVALIDATE_REGISTRY.removeDependency(value, base.getState()))
      return value
    },

    /* V2-UI-6 — the topology mutation (D §12.2): the same
       okValue → INVALIDATE_REGISTRY → refetchKeys idiom. */
    async createWorkstreamFork(args: CreateWorkstreamForkArgs): Promise<CreateWorkstreamForkResult> {
      const value = okValue(await rpc.createWorkstreamFork(args))
      await refetchKeys(INVALIDATE_REGISTRY.createWorkstreamFork(value, base.getState()))
      return value
    },

    async createPlannedMerge(args: CreatePlannedMergeArgs): Promise<CreatePlannedMergeResult> {
      const value = okValue(await rpc.createPlannedMerge(args))
      await refetchKeys(INVALIDATE_REGISTRY.createPlannedMerge(value, base.getState()))
      return value
    },

    async getMergeContract(args: GetMergeContractArgs): Promise<GetMergeContractResult> {
      const value = okValue(await rpc.getMergeContract(args))
      await refetchKeys(INVALIDATE_REGISTRY.getMergeContract(value, base.getState()))
      return value
    },

    async saveMergeContract(args: SaveMergeContractArgs): Promise<SaveMergeContractResult> {
      const value = okValue(await rpc.saveMergeContract(args))
      await refetchKeys(INVALIDATE_REGISTRY.saveMergeContract(value, base.getState()))
      return value
    },

    async dropTopologyEdge(args: DropTopologyEdgeArgs): Promise<DropTopologyEdgeResult> {
      const value = okValue(await rpc.dropTopologyEdge(args))
      await refetchKeys(INVALIDATE_REGISTRY.dropTopologyEdge(value, base.getState()))
      return value
    },

    /* V2-UI-7 — the Records face (D §13): the seven semantic writes.
       The same okValue → INVALIDATE_REGISTRY → refetchKeys idiom. */
    async recordFact(args: RecordFactArgs): Promise<RecordFactResult> {
      const value = okValue(await rpc.recordFact(args))
      await refetchKeys(INVALIDATE_REGISTRY.recordFact(value, base.getState()))
      return value
    },

    async recordClaim(args: RecordClaimArgs): Promise<RecordClaimResult> {
      const value = okValue(await rpc.recordClaim(args))
      await refetchKeys(INVALIDATE_REGISTRY.recordClaim(value, base.getState()))
      return value
    },

    async retractClaim(args: RetractClaimArgs): Promise<RetractClaimResult> {
      const value = okValue(await rpc.retractClaim(args))
      await refetchKeys(INVALIDATE_REGISTRY.retractClaim(value, base.getState()))
      return value
    },

    async registerArtifact(args: RegisterArtifactArgs): Promise<RegisterArtifactResult> {
      const value = okValue(await rpc.registerArtifact(args))
      await refetchKeys(INVALIDATE_REGISTRY.registerArtifact(value, base.getState()))
      return value
    },

    async markArtifactMissing(args: MarkArtifactMissingArgs): Promise<MarkArtifactMissingResult> {
      const value = okValue(await rpc.markArtifactMissing(args))
      await refetchKeys(INVALIDATE_REGISTRY.markArtifactMissing(value, base.getState()))
      return value
    },

    async addRelation(args: AddRelationArgs): Promise<AddRelationResult> {
      const value = okValue(await rpc.addRelation(args))
      await refetchKeys(INVALIDATE_REGISTRY.addRelation(value, base.getState()))
      return value
    },

    async removeRelation(args: RemoveRelationArgs): Promise<RemoveRelationResult> {
      const value = okValue(await rpc.removeRelation(args))
      await refetchKeys(INVALIDATE_REGISTRY.removeRelation(value, base.getState()))
      return value
    },

    /* the refresh loop */

    async refresh(reason = 'manual'): Promise<void> {
      // 1) pre-refresh chain — the RR-015① stale seam runs FIRST.
      await staleCheck(reason)
      // 2) refetch every non-idle slice.
      await refetchKeys(activeKeys())
      // 3) the views' refresh-completion listeners.
      for (const callback of [...refetchListeners]) callback()
    },

    onRefetch(callback: () => void): () => void {
      refetchListeners.add(callback)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        refetchListeners.delete(callback)
      }
    },
  }
}

/** The mutation ids (re-export for Phase 4 log/toast naming). */
export type { MutationId }
