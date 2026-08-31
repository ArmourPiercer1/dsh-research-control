/**
 * WP-4.1a — the host RPC service PORT + its PRODUCTION implementation
 * (the 13-RPC client face of ARCHITECTURE.md §7.1).
 *
 * Layering (ARCHITECTURE.md §2.2, INV-PERM-5):
 *  - the `@Remote` method bodies on `ResearchControlService`
 *    (`./index.ts`, the only host surface allowed to import DSH packages)
 *    are THIN: `zod decode → forward to this port`. No business rule,
 *    no I/O, no projection happens in the method body;
 *  - this port (`ResearchRpcServices`) is the plugin-own service port the
 *    method bodies forward to — the「注入的 service 端口」of the WP-4.1a
 *    brief. In production it is the `ProductionResearchRpcServices` below,
 *    composed in `ResearchControlService.[Service.init]` (the composition
 *    root, which already builds the host wiring) from the WIRING-ASSEMBLED
 *    instances (`HostWiring.*`); tests inject a stub implementation
 *    through the constructor seam;
 *  - this file is dsh-adapter territory: it imports plugin business
 *    modules (service/domain/history layers) but NO DSH package.
 *
 * Per-RPC forwarding map (wiring-assembly result → forward target):
 *  | RPC                    | forwards to                                                                 |
 *  |------------------------|------------------------------------------------------------------------------|
 *  | getDashboard           | stale pre-check (checkAllOpen sweep, WP-4.6 RR-015①) + declarative tree loader (query) + InterventionStore.query + null placeholders |
 *  | getProject             | declarative tree loader (query) + null placeholders                           |
 *  | getTopic               | tree loader + Workstream cards (planfork countOpen + run table RUNNING)      |
 *  | getWorkstream          | stale pre-check (checkAllOpen(wsId) sweep, WP-4.6 RR-015①) + tree loader + history event log (size + fold projection) + run table + PF store |
 *  | queryHistory           | history replay query face (`queryEvents` — seq-cursor pagination, verbatim)  |
 *  | reorderPlan            | PlanStore.savePlan (§4.4 validations + atomic write) + PLAN_REORDER ledger row |
 *  | selectPlanFork         | PlanForkSelectService.select (WP-3.4: actor re-asserted USER at runtime)     |
 *  | dismissPlanFork        | PlanForkSelectService.dismiss (WP-3.4: actor re-asserted USER at runtime)    |
 *  | updateInterventionState| InterventionService.updateState (RR-017②, WP-6.4: §13    |
 *  |                        | guard single source + state-cache row — WP-5.1 layer on the |
 *  |                        | user-surface second connection)                     |
 *  | registerInteraction    | reporting service `registerInteraction` (WP-5.3 production: the           |
 *  |                        | interaction table on the user-surface second connection; related_         |
 *  |                        | workstreams existence checked against the declarative tree, §16 rule 2)   |
 *  | saveResearchCheckpoint | checkpoint service `saveResearchCheckpoint` (§5 flow, user-triggered only)   |
 *  | getGitHistory          | checkpoint service `diffHistory` (W6 file log, `.research/**`-scoped)        |
 *  | restoreDeclarativeFile | checkpoint service `restoreResearchFile` (W6/W7/W8 + post-restore check)    |
 *
 * User semantics (ARCHITECTURE.md §6): reorderPlan / selectPlanFork /
 * dismissPlanFork / updateInterventionState / restoreDeclarativeFile /
 * saveResearchCheckpoint are USER operations — the RPC face makes NO
 * actor distinction (the client face IS the user face; the host gateway
 * bounds the matrix), and the forwarded services KEEP their existing
 * permission checks (WP-3.4 re-asserts `actor.kind === USER` for
 * select/dismiss; the §13 guard + DDL trigger keep intervention state
 * user-only; the checkpoint/restore services are explicit-trigger only —
 * INV-GIT-2/INV-GIT-5). `registerInteraction` is a user登记 operation
 * (DOMAIN_SCHEMA §10.1; the §6 matrix has no AGENT row for it).
 *
 * One extra resource: a SECOND `node:sqlite` connection over the same
 * `research.sqlite` (the established dual-connection pattern of the
 * wiring — runbinding/planfork/flooding each open their own). It serves
 * the three user-surface writes the wiring-internal services do not
 * expose: the PLAN_REORDER ledger INSERT, the intervention state-cache
 * UPDATE, and the SELECTED transaction of the select service. Owned by
 * this object; closed by `close()` (idempotent), which the dsh-adapter
 * registers with `ctx.effect`.
 */

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

import {
  type AddDependencyArgs,
  type AddDependencyResult,
  type AddRelationArgs,
  type AddRelationResult,
  type AffectsRefDto,
  type BlockerDto,
  type ClearBlockerArgs,
  type ClearBlockerResult,
  type CreateBlockerArgs,
  type CreateBlockerResult,
  type CreateNextActionArgs,
  type CreateNextActionResult,
  type CreatePlanItemArgs,
  type CreatePlanItemResult,
  type CreatePlannedMergeArgs,
  type CreatePlannedMergeResult,
  type CurrentTaskDto,
  type CreateTopicArgs,
  type CreateTopicResult,
  type CreateWorkstreamArgs,
  type CreateWorkstreamResult,
  type CreateWorkstreamForkArgs,
  type CreateWorkstreamForkResult,
  type DashboardSnapshot,
  type DependencyEndpointRef,
  type DerivedBlockerDto,
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
  type GetTopicArgs,
  type GetWorkstreamArgs,
  type GetWorkstreamCurrentArgs,
  type GetWorkstreamCurrentResult,
  type InterventionDto,
  type InterventionFullDto,
  type LinkedRefDto,
  type MarkArtifactMissingArgs,
  type MarkArtifactMissingResult,
  type MergeContractRefDto,
  type NextActionDto,
  type ObjectiveDto,
  type ObjectiveFullDto,
  type PlanForkDto,
  type PlanItemDto,
  type ProjectSnapshot,
  type PromoteNextActionArgs,
  type PromoteNextActionResult,
  type HistoryEventDto,
  type QueryHistoryArgs,
  type QueryHistoryResult,
  type QueryAttentionArgs,
  type QueryAttentionResult,
  type QueryRecordsArgs,
  type QueryRecordsResult,
  type RecordClaimArgs,
  type RecordClaimResult,
  type RecordFactArgs,
  type RecordFactResult,
  type ReorderPlanArgs,
  type ReorderPlanResult,
  type RegisterArtifactArgs,
  type RegisterArtifactResult,
  type RegisterInteractionArgs,
  type RegisterInteractionResult,
  type RemoveDependencyArgs,
  type RemoveDependencyResult,
  type RemovePlanItemArgs,
  type RemovePlanItemResult,
  type RemoveRelationArgs,
  type RemoveRelationResult,
  type RetractClaimArgs,
  type RetractClaimResult,
  type RestoreDeclarativeFileArgs,
  type RestoreDeclarativeFileResult,
  type SaveMergeContractArgs,
  type SaveMergeContractResult,
  type SaveResearchCheckpointArgs,
  type SaveResearchCheckpointResult,
  type SemanticRecordDto,
  type SelectPlanForkArgs,
  type SelectPlanForkResult,
  type SetCurrentFocusArgs,
  type SetCurrentFocusResult,
  type TopologyEdgeDto,
  type TopicCardDto,
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
  type WorkstreamCardDto,
  type WorkstreamSnapshot,
} from '../../../shared/rpc-contracts.js'
import {
  ActionsError,
  ActionsService,
  ActionsStore,
  ObjectiveFileService,
  deriveWorkstreamBlockers,
  type BlockerRecord,
  type DerivedBlocker,
  type NextActionRecord,
} from '../../service/actions/index.js'
import {
  collectProjectAttention,
  queryCollections,
  type AttentionWorkstreamNode,
  type ProjectAttentionCollection,
  type ProjectAttentionSources,
} from '../../service/attention/index.js'
import {
  DependencyService,
  mapDependencyError,
  projectDependencyEdges,
  type DependencyWorkstreamIndex,
} from '../../service/dependency/index.js'
import {
  SemanticRecordsService,
  mapSemanticsError,
  type SemanticWorkstreamIndex,
} from '../../service/semantics/index.js'
import { PlanWriterService, mapPlanWriterError } from '../../service/plan-writer/index.js'
import { TopologyService, TopologyServiceError, mapTopologyServiceError } from '../../service/topology/index.js'
import { isCurrentFocusError } from '../../service/current-focus/index.js'
import { isHierarchyError } from '../../service/hierarchy/index.js'
import {
  adaptDatabaseSync,
  type HostWiring,
} from '../../service/wiring/index.js'
import {
  loadResearchTree,
  type ObjectiveDoc,
  type ResearchFileReader,
  type ResearchTree,
  type TopicNode,
  type WorkstreamNode,
} from '../../domain/loader/index.js'
import {
  foldEvents,
  queryEvents,
} from '../../history/replay/index.js'
import type { HistoryEventRecord } from '../../persistence/store/index.js'
import {
  FsResearchReader,
  diffHistory,
  restoreResearchFile,
  saveResearchCheckpoint,
  type StructuredLogger,
} from '../../service/checkpoint/index.js'
import { FsPlanFileWriter, FsTopologyFileIo } from '../../service/fs/index.js'
import { PlanStore } from '../../domain/plan/index.js'
import {
  PlanForkSelectService,
  type PlanForkSelectOptions,
} from '../../service/select/index.js'
import { ReportingService } from '../../service/reporting/index.js'
import {
  InterventionLifecycleStore,
  InterventionService,
  USER_ACTOR as INTERVENTION_USER_ACTOR,
} from '../../service/intervention/index.js'
import type { InterventionRecord } from '../../service/flooding/index.js'
import {
  managementActionToParams,
  SQL_INSERT_MANAGEMENT_ACTION,
  type ActorRef,
  type CanonicalPlanProvider,
  type CanonicalPlanView,
  type ManagementActionRecord,
  type PlanForkRecord,
} from '../../domain/planfork/index.js'

/**
 * The injected service port the 13 `@Remote` method bodies forward to.
 *
 * Arity contract (RR-006): every port method takes exactly the decoded
 * args object of its RPC — 1:1 with the descriptor's parameter face
 * (0 params for getDashboard/getProject, 1 `args` param for the other
 * 11). Tests stub this interface and assert the forwarded args/return.
 */
export interface ResearchRpcServices {
  /**
   * WP-4.6 (RR-015① disposition): the production implementation runs the
   * idempotent `stale.checkAllOpen()` sweep BEFORE the projection (the
   * query-path stale pre-check — the snapshot reflects the current truth,
   * PLAN_FORK_SPEC §5 「PF 列表查询懒检测」 timing). The port is async for
   * the two query RPCs that read the PF state (the sweep is an async W3
   * batch); stub implementations resolve with the fixture.
   */
  getDashboard(): Promise<DashboardSnapshot>
  getProject(): ProjectSnapshot
  getTopic(args: GetTopicArgs): TopicSnapshot
  getWorkstream(args: GetWorkstreamArgs): Promise<WorkstreamSnapshot>
  queryHistory(args: QueryHistoryArgs): QueryHistoryResult
  reorderPlan(args: ReorderPlanArgs): ReorderPlanResult
  selectPlanFork(args: SelectPlanForkArgs): Promise<SelectPlanForkResult>
  dismissPlanFork(args: DismissPlanForkArgs): Promise<DismissPlanForkResult>
  updateInterventionState(args: UpdateInterventionStateArgs): UpdateInterventionStateResult
  registerInteraction(args: RegisterInteractionArgs): Promise<RegisterInteractionResult>
  saveResearchCheckpoint(args: SaveResearchCheckpointArgs): Promise<SaveResearchCheckpointResult>
  getGitHistory(args: GetGitHistoryArgs): Promise<GetGitHistoryResult>
  restoreDeclarativeFile(args: RestoreDeclarativeFileArgs): Promise<RestoreDeclarativeFileResult>
  /**
   * UI-0.4 (R-01): USER mutation — point the workstream's current-focus
   * operational pointer at the given canonical Plan member. The
   * canonical-membership gate runs service-side BEFORE any row write
   * (CF_NOT_CANONICAL — the frozen DDL stays a plain 3-column table).
   * The RPC face IS the USER lane (R-01: no actor parameter, the host
   * gateway bounds who may call it). Returns the canonical record
   * (id + `updatedAt` version) for client invalidation.
   */
  setCurrentFocus(args: SetCurrentFocusArgs): SetCurrentFocusResult
  /**
   * UI-0.4 (R-01): read back the workstream's current-focus pointer.
   * `focus: null` = never set / auto-cleared after the target left the
   * canonical Plan (the R-01 eviction rule).
   */
  getCurrentFocus(args: GetCurrentFocusArgs): GetCurrentFocusResult
  /**
   * V2-UI-0.4 (Task 3): create a new Topic in the routed project —
   * allocates the next TPC-<n> (max+1, never reused) and writes the
   * minimal valid file set (`topic.yaml` only). Returns the canonical
   * record (id + `createdAt` version) for client invalidation.
   */
  createTopic(args: CreateTopicArgs): CreateTopicResult
  /**
   * V2-UI-0.4 (Task 3): create a new Workstream under an existing topic
   * of the routed project — allocates the next WS-<n> project-wide and
   * writes `workstream.yaml`. The topic must be a node of this project
   * (HIER_TOPIC_NOT_FOUND otherwise).
   */
  createWorkstream(args: CreateWorkstreamArgs): CreateWorkstreamResult
  /**
   * V2-UI-0.4 (UI-2A): rewrite the provided project metadata fields
   * (title / description / importance / attention mode / target date)
   * in the routed project — read-modify-write, the OMITTED fields are
   * preserved byte-for-byte (at least one field required, HIER_INPUT
   * otherwise). Returns the effective title + the write stamp
   * (`updatedAt`) for client invalidation.
   */
  updateProjectMetadata(args: UpdateProjectMetadataArgs): UpdateProjectMetadataResult
  /**
   * V2-UI-0.4 (UI-2A): update a topic title / description / importance
   * / attention mode in the routed project (RMW — provided fields
   * only). The topic must be a node of this project
   * (HIER_TOPIC_NOT_FOUND otherwise).
   */
  updateTopic(args: UpdateTopicArgs): UpdateTopicResult
  /**
   * V2-UI-0.4 (UI-2A): update a workstream title / summary in the
   * routed project (RMW — title + summary ONLY; lifecycle changes are
   * not part of this slice). The workstream must belong to this
   * project (HIER_WORKSTREAM_NOT_FOUND otherwise).
   */
  updateWorkstream(args: UpdateWorkstreamArgs): UpdateWorkstreamResult
  /**
   * V2-UI-0.4 (UI-2A): delete a workstream of the routed project —
   * the whole workstream directory plus its reference. CONSERVATIVE
   * ruling: a workstream with history is REFUSED
   * (HIER_WORKSTREAM_HAS_HISTORY) BEFORE any removal; the
   * post-delete current-focus clear is best-effort (surfaced as the
   * `currentFocusCleared` result flag, never as a failure).
   */
  dropWorkstream(args: DropWorkstreamArgs): DropWorkstreamResult
  /**
   * UI-4 (D §10): the workstream Current-Execution read face — the
   * ACTIVE linked objectives, the explicit blockers (WS ∪ member
   * Task/Run scope), the ADJ-3 mechanical derived projection (the
   * canonical focus Task's dependency edges + the before-focus FAILED
   * gates folded from the WS's OWN event log), the PROPOSED next
   * actions and the WS's interventions. The current-focus pointer is
   * NOT here — it stays on the `currentFocus` slice (ADJ-11).
   */
  getWorkstreamCurrent(args: GetWorkstreamCurrentArgs): Promise<GetWorkstreamCurrentResult>
  /**
   * UI-4 (D §10, ADJ-6): the basic objective edit — the statement RMW
   * (objectives.yaml atomic save) and/or the transition-checked status
   * change (≥1 field, service-enforced).
   */
  updateObjective(args: UpdateObjectiveArgs): Promise<UpdateObjectiveResult>
  /** UI-4 (D §10.4): propose a NextAction (optionally WS-scoped). */
  createNextAction(args: CreateNextActionArgs): Promise<CreateNextActionResult>
  /**
   * UI-4 (D §10.4): promote the PROPOSED NA to a canonical plan Task
   * (USER-only; plan.yaml materialization + the management-action
   * ledger row — the materialization receipt is returned verbatim).
   */
  promoteNextAction(args: PromoteNextActionArgs): Promise<PromoteNextActionResult>
  /** UI-4 (D §10.4): terminal-dismiss a PROPOSED NA. */
  dismissNextAction(args: DismissNextActionArgs): Promise<DismissNextActionResult>
  /** UI-4 (D §10.2): raise an Explicit Blocker (USER-only). */
  createBlocker(args: CreateBlockerArgs): Promise<CreateBlockerResult>
  /**
   * UI-4 (D §10.2): clear an ACTIVE Explicit Blocker. The DERIVED
   * face has no clear (ADJ-4) — clearing the cause removes it.
   */
  clearBlocker(args: ClearBlockerArgs): Promise<ClearBlockerResult>
  /**
   * UI-5 (brief §3): create a Task/Gate/Milestone definition and list it
   * into the canonical plan (server-allocated id, ADJ-2; empty plan
   * allowed, ADJ-3; PLAN_ITEM_ADDED ledger row).
   */
  createPlanItem(args: CreatePlanItemArgs): Promise<CreatePlanItemResult>
  /**
   * UI-5 (brief §3, ADJ-4): RMW one listed plan item (omit = unchanged;
   * explicit null = clear the optional field). NO ledger row, NO
   * managementActionId field on the result.
   */
  updatePlanItem(args: UpdatePlanItemArgs): Promise<UpdatePlanItemResult>
  /**
   * UI-5 (brief §3, ADJ-14): detach one listed item from the canonical
   * plan (the definition file stays on disk, INV-PLAN-9) + PLAN_ITEM_
   * REMOVED ledger row. The wrapper revalidates the current-focus
   * pointer and folds `currentFocusCleared` into the result.
   */
  removePlanItem(args: RemovePlanItemArgs): Promise<RemovePlanItemResult>
  /**
   * UI-5 (brief §3, §30 red line): persist a DEPENDS_ON edge ONLY as a
   * RELATION_ADDED history event in the owner workstream's log (no
   * second storage).
   */
  addDependency(args: AddDependencyArgs): Promise<AddDependencyResult>
  /**
   * UI-5 (brief §3): RELATION_REMOVED for an ACTIVE edge (the payload
   * redundantly mirrors the stored 5-tuple recovered from the owner log
   * fold).
   */
  removeDependency(args: RemoveDependencyArgs): Promise<RemoveDependencyResult>
  /**
   * UI-6 (D1, D §12.2): fork the parent workstream into N children —
   * per child: a new workstream (with `origin_topology_edge_ref`) + one
   * 1:1 FORK edge (explicit file-derived id, §30 WS-before-edge) → full
   * post-mutation re-validation → TOPOLOGY_EDITED ledger row. The
   * service owns the inverse compensation (ADJ-2); the face is a
   * pass-through. Port-optional (and the other four UI-6 faces below
   * with it): the frozen-13 rpc-face stub must stay byte-identical to
   * BASE for the tsc gate, and TS2740 only lists REQUIRED missing
   * properties — the production implementation provides all five as
   * required, and the @Remote forwarders call them with a non-null
   * assertion.
   */
  createWorkstreamFork?(args: CreateWorkstreamForkArgs): Promise<CreateWorkstreamForkResult>
  /**
   * UI-6 (D2, BRIEF §3): plan a merge over existing workstreams — one
   * MERGE edge (explicit file-derived id, PLANNED lifecycle) whose
   * `inputs` are the deduplicated input workstreams and `outputs` the
   * single existing output workstream. Existing-output-first: a missing
   * output is an error guiding the two-step UI, never created here.
   * The wire `projectId` routing field is consumed by requireRpc,
   * never forwarded. Port-optional (see the note on createWorkstreamFork).
   */
  createPlannedMerge?(args: CreatePlannedMergeArgs): Promise<CreatePlannedMergeResult>
  /**
   * UI-6 (D2, BRIEF §3): read the merge contract face for an edge —
   * `content` null is the value face for a missing contract (NOT an
   * error code); no ledger row is written. Port-optional (see the note
   * on createWorkstreamFork).
   */
  getMergeContract?(args: GetMergeContractArgs): Promise<GetMergeContractResult>
  /**
   * UI-6 (D2, BRIEF §3): full-replacement write of the merge contract
   * file for an edge → CONTRACT_EDITED ledger row. The unknown-edge
   * pre-gate is TOPO_CONTRACT_TE_UNKNOWN; the wire `projectId` routing
   * field is consumed by requireRpc, never forwarded. Port-optional
   * (see the note on createWorkstreamFork).
   */
  saveMergeContract?(args: SaveMergeContractArgs): Promise<SaveMergeContractResult>
  /**
   * UI-6 (D3, BRIEF §3): drop a topology edge. The state machine is
   * the sole authority (PLANNED / REALIZED → DROPPED, USER actor;
   * DROPPED → DROPPED is the INVALID_TRANSITION carrier); the owning
   * topic is resolved server-side (edge ids are project-unique), an
   * unknown edge is TOPO_EDGE_NOT_FOUND. TOPOLOGY_EDITED ledger row,
   * detail carries the from-state. The wire `projectId` routing field
   * is consumed by requireRpc, never forwarded. Port-optional (see the
   * note on createWorkstreamFork).
   */
  dropTopologyEdge?(args: DropTopologyEdgeArgs): Promise<DropTopologyEdgeResult>
  /* ---- UI-7 (D §13): the seven semantic record writes + the query
   * face. The writes persist ONLY as semantic history events (the §30
   * red line — records live in the operational sqlite, never in
   * `.research` files); the wire `projectId` routing field is consumed
   * by requireRpc, never forwarded. Port-optional (see the note on
   * createWorkstreamFork). ---- */
  /**
   * UI-7 (D1, D §13.2): record an immutable Fact — FACT_RECORDED
   * (status const ACTIVE; the id comes from the shared allocator, never
   * from the wire — ADJ-12). Port-optional (see the note on
   * createWorkstreamFork).
   */
  recordFact?(args: RecordFactArgs): Promise<RecordFactResult>
  /**
   * UI-7 (D1, D §13.2): record an ACTIVE Claim — CLAIM_RECORDED (the
   * id comes from the shared allocator — ADJ-12). Port-optional (see
   * the note on createWorkstreamFork).
   */
  recordClaim?(args: RecordClaimArgs): Promise<RecordClaimResult>
  /**
   * UI-7 (D2, D §13.2): terminal-retract an ACTIVE Claim —
   * CLAIM_RETRACTED (RETRACTED is terminal, §13; re-retract is
   * WRONG_STATE). Port-optional (see the note on createWorkstreamFork).
   */
  retractClaim?(args: RetractClaimArgs): Promise<RetractClaimResult>
  /**
   * UI-7 (D2, D §13.2/§13.6): register an artifact BY REFERENCE —
   * ARTIFACT_REGISTERED (the file is never copied into Research
   * Control; the 7-value frozen artifactType enum). Port-optional (see
   * the note on createWorkstreamFork).
   */
  registerArtifact?(args: RegisterArtifactArgs): Promise<RegisterArtifactResult>
  /**
   * UI-7 (D2, D §13.2): mark a REGISTERED artifact MISSING —
   * ARTIFACT_MARKED_MISSING (V1 one-way — 「找回可恢复」 recovery is out
   * of V1 scope). Port-optional (see the note on createWorkstreamFork).
   */
  markArtifactMissing?(args: MarkArtifactMissingArgs): Promise<MarkArtifactMissingResult>
  /**
   * UI-7 (D3, D §13.2/§8): add a semantic relation edge — RELATION_ADDED
   * (the owner is DERIVED: source.ws ?? target.ws; the frozen 10
   * relation types + the §8 combination table; the §5.5 5-tuple
   * uniqueness). Port-optional (see the note on createWorkstreamFork).
   */
  addRelation?(args: AddRelationArgs): Promise<AddRelationResult>
  /**
   * UI-7 (D3, D §13.2): remove an ACTIVE relation edge — RELATION_REMOVED
   * (REMOVED is terminal; the §5.5 payload mirrors the stored edge —
   * recovered from the owner log fold, never re-invented). Port-optional
   * (see the note on createWorkstreamFork).
   */
  removeRelation?(args: RemoveRelationArgs): Promise<RemoveRelationResult>
  /**
   * UI-7 (D4, D §13.4): the Records read face — the operational
   * `derived_state` projection (the History timeline is FORBIDDEN as a
   * source; no `.research` file reads). Port-optional (see the note on
   * createWorkstreamFork).
   */
  queryRecords?(args: QueryRecordsArgs): Promise<QueryRecordsResult>
  /**
   * UI-8 (D2, D §14 + ADJ-4): the unified Needs-Attention read face —
   * the 5-kind attention item merge (intervention / explicit blocker /
   * next action / derived blocker / missing-NA synthetic), ONE
   * `rankAttention` total order, host-computed `allowedActions` +
   * priority band. The @Remote body routes by projectId (ADJ-4 dual
   * path); here the single-project projection: collect this project's
   * sources → assemble → filter/page. Port-optional (see the note on
   * createWorkstreamFork).
   */
  queryAttention?(args: QueryAttentionArgs): Promise<QueryAttentionResult>
  /**
   * UI-8 (D2, ADJ-4/ADJ-13): the NON-RPC composition hook the plane
   * merge reads — collect this project's attention candidates (the
   * scoreable + terminal split, pre-assembly) from the production
   * sources. It is NOT part of any descriptor/face list (the face
   * count stays governed by the invocation registries); the dsh-
   * adapter wires it into the plane port's `getAttentionSources`.
   * Port-optional (see the note on createWorkstreamFork).
   */
  collectAttention?(now: number): ProjectAttentionCollection
  /**
   * Optional resource teardown (the production implementation owns one
   * second SQLite connection; the dsh-adapter registers it with
   * `ctx.effect`). Stub implementations may omit it.
   */
  close?(): void
}

/**
 * The frozen USER actor the RPC face forwards for user-semantic RPCs.
 * The client has no identity of its own (the host gateway bounds the
 * matrix — ARCHITECTURE §6); the forwarded services keep their checks
 * (WP-3.4 `assertUserActor` accepts a bare `{ kind: 'USER' }`).
 */
const USER_ACTOR: ActorRef = { kind: 'USER' }

/** Task execution/validation vocabularies for the Current-zone fold. */
const TASK_EXECUTIONS = new Set(['PLANNED', 'ACTIVE', 'PAUSED', 'EXECUTED', 'CANCELLED'])
const TASK_VALIDATIONS = new Set(['NOT_REQUIRED', 'PENDING', 'UNDER_REVIEW', 'PASSED', 'FAILED'])

/** Console bridge for the checkpoint services' mandatory logger. */
function consoleLogger(): StructuredLogger {
  return {
    info: (event, fields) => console.log(`[research-control][rpc][${event}]`, fields ?? {}),
    warn: (event, fields) => console.warn(`[research-control][rpc][${event}]`, fields ?? {}),
    error: (event, fields) => console.error(`[research-control][rpc][${event}]`, fields ?? {}),
  }
}

/**
 * V2-T3.2a — the fresh-tree load with the frozen-13 fail-loud verdict
 * (extracted from `ProductionResearchRpcServices.#loadTree`: the same
 * read, the same message — the plane-read face reuses it verbatim so a
 * broken tree refuses the snapshot on every query path).
 */
export function loadResearchTreeOrThrow(researchRoot: string, declarativeDir: string, operation: string): ResearchTree {
  const load = loadResearchTree(new FsResearchReader(researchRoot), researchRoot, declarativeDir)
  if (load.errors.length > 0) {
    const e = load.errors[0]!
    throw new Error(
      `${operation}: the declarative tree failed to load — refusing to serve a broken snapshot: ` +
        `[${e.code}] ${e.file || '<root>'}${e.path !== undefined ? e.path : ''}: ${e.message}`,
    )
  }
  return load.tree
}

/* -------------------------------------------------------------------- *
 * UI-4 (D §10) — the attention record → wire DTO mappers (PURE; the
 * absent-optional → null normalization lives here, once).
 * -------------------------------------------------------------------- */

function toObjectiveFullDto(o: ObjectiveDoc): ObjectiveFullDto {
  return {
    id: o.id,
    scope: o.scope,
    statement: o.statement,
    status: o.status,
    priority: o.priority,
    targetDate: o.target_date ?? null,
    successCriteria: [...o.success_criteria],
    linkedRefs: o.linked_refs.map((ref) => ({ kind: ref.kind, id: ref.id })),
  }
}

function toNextActionDto(na: NextActionRecord): NextActionDto {
  return {
    id: na.id,
    workstreamId: na.workstream_id ?? null,
    statement: na.statement,
    rationale: na.rationale ?? null,
    status: na.status,
    promotedToTaskId: na.promoted_to_task_id ?? null,
    createdAt: na.created_at,
  }
}

function toBlockerDto(b: BlockerRecord): BlockerDto {
  return {
    id: b.id,
    statement: b.statement,
    affects: b.affects.map((ref) => ({ kind: ref.kind, id: ref.id })),
    status: b.status,
    source: b.source,
    references: b.references === undefined ? null : [...b.references],
    createdAt: b.created_at,
    clearedAt: b.cleared_at ?? null,
  }
}

function toDerivedBlockerDto(d: DerivedBlocker): DerivedBlockerDto {
  return {
    id: d.id,
    source: d.source,
    statement: d.statement,
    reasonRefs: [...d.reasonRefs],
    primaryAction: {
      label: d.primaryAction.label,
      targetKind: d.primaryAction.targetKind,
      targetId: d.primaryAction.targetId,
    },
  }
}

function toInterventionFullDto(iv: InterventionRecord): InterventionFullDto {
  return {
    id: iv.id,
    title: iv.title,
    origin: iv.origin,
    status: iv.status,
    workstreamIds: [...iv.workstream_ids],
    createdAt: iv.created_at,
    detail: iv.detail ?? null,
    closedAt: iv.closed_at ?? null,
    resolutionNote: iv.resolution_note ?? null,
  }
}

/**
 * V2-T3.2a — the V1 getDashboard production REFRESH SIDECAR (extracted
 * from `ProductionResearchRpcServices.getDashboard` — the same two
 * steps, the same order, the same verdicts):
 *   1. the idempotent `stale.checkAllOpen()` FULL sweep (WP-4.6
 *      RR-015① query-path stale pre-check — a sweep-level throw
 *      PROPAGATES: a lying query is worse than a failed one);
 *   2. the RR-018① audit refresh (the client's refresh loop IS the
 *      production trigger; a refresh failure is LOGGED LOUD and never
 *      blocks the query — the sidecar is mechanical, not part of the
 *      data-plane contract).
 *
 * The §7.1 总览 (getHubOverview) runs this per project: under V2 the
 * overview IS the refresh surface for every wired project (the V1
 * dashboard's trigger point, moved with the data), so the audit chain
 * and the stale sweep stay on the refresh loop exactly as in V1.
 */
export async function runProjectRefreshSidecar(wiring: HostWiring, logger: StructuredLogger): Promise<void> {
  await wiring.stale.checkAllOpen()
  try {
    const refresh = await wiring.auditRefresh.run()
    logger.info('auditRefresh', {
      discrepancies: refresh.discrepancyCount,
      captured: refresh.captured.length,
      escalated: refresh.escalated === null ? null : refresh.escalated.inboxItemId,
      skippedDedupe: refresh.skippedDedupe,
      skippedBaseline: refresh.skippedBaseline,
      captureFailures: refresh.captureFailures.length,
    })
  } catch (cause) {
    logger.error(
      'auditRefreshFailed',
      { message: cause instanceof Error ? cause.message : String(cause) },
    )
  }
}

export interface ProductionResearchRpcServicesOptions {
  /** The wiring-assembled service graph (the composition root's output). */
  readonly wiring: HostWiring
  /** The frozen contract schema ROOT (the `schema/` directory). */
  readonly schemaRoot: string
  /** Clock (A-3 epoch ms; default `Date.now`). */
  readonly now?: () => number
}

/**
 * The production implementation of the RPC service port: decode is the
 * method body's job — this layer receives ALREADY-DECODED args and does
 * query projection + delegation to the business services that own the
 * rules (state machines, §4.4 validations, §5 git flow, §13 guard).
 */
export class ProductionResearchRpcServices implements ResearchRpcServices {
  readonly #wiring: HostWiring
  readonly #declarativeDir: string
  readonly #now: () => number
  readonly #logger: StructuredLogger
  /** The user-surface second connection (PLAN REORDER ledger / intervention
   *  state-cache update / the select service's SELECTED transaction). */
  readonly #dbConn: DatabaseSync
  readonly #db: ReturnType<typeof adaptDatabaseSync>
  readonly #select: PlanForkSelectService
  /** The WP-5.3 reporting layer (interaction / reporting_item /
   *  scheduled_event tables) on the same user-surface second connection. */
  readonly #reporting: ReportingService
  /** RR-017② (WP-6.4): the WP-5.1 intervention layer — the 13-RPC
   *  `updateInterventionState` routes through `updateState` (equivalence:
   *  same §13 guard single source, same optimistic conditional UPDATE on
   *  the lifecycle row, same 1:1 result shape; existing tests +
   *  TC-E2E-011 prove the re-route). */
  readonly #intervention: InterventionService
  /** UI-4 (ADJ-1): the NextAction/Blocker operational store — the
   *  user-surface production writer face on the same second
   *  connection (the idempotent DDL ran in the constructor). The
   *  wiring-internal store stays on its read-only REJECTING_WRITER;
   *  HostWiring is NOT extended (ADJ-2). */
  readonly #actionsStore: ActionsStore
  /** UI-4 (ADJ-1): the attention service face (the PROMOTE
   *  materialization writes plan.yaml through its OWN FsPlanFileWriter). */
  readonly #actions: ActionsService
  /** UI-4 (ADJ-2): the objectives.yaml declarative writer face
   *  (self-constructed — the same landing spot, the same second
   *  connection). */
  readonly #objectives: ObjectiveFileService
  /** UI-5 (D3): the plan-writer service (brief §3 — self-constructed,
   *  the UI-4 ActionsService precedent: the wiring's read-only
   *  REJECTING_WRITER stays untouched, HostWiring NOT extended). The
   *  dependency service is constructed PER CALL (its plan index is a
   *  fresh tree fold — never cached). */
  readonly #planWriter: PlanWriterService
  /** UI-6 (D1): the topology service (brief §3 — self-constructed,
   *  the PlanWriterService precedent: the same fresh-kernel /
   *  FsTopologyFileIo spine, the same second connection for the
   *  MANAGEMENT_ACTION ledger rows, HostWiring NOT extended). */
  readonly #topology: TopologyService
  #closed = false

  constructor(options: ProductionResearchRpcServicesOptions) {
    this.#wiring = options.wiring
    this.#declarativeDir = join(options.schemaRoot, 'declarative')
    this.#now = options.now ?? Date.now
    this.#logger = consoleLogger()

    const dbPath = join(options.wiring.dataDir, 'research.sqlite')
    this.#dbConn = new DatabaseSync(dbPath)
    this.#db = adaptDatabaseSync(this.#dbConn)

    // The canonical plan provider (the production read path: fresh
    // PlanStore.loadPlan per call — the same composition the wiring uses
    // for its own planfork creation flow; the select service re-checks
    // the PF base against THIS face, §6.1). Read-only by construction:
    // the writer rejects (the select service writes through its own
    // injected writer, never through the provider).
    const reader = new FsResearchReader(options.wiring.researchRoot)
    this.#select = new PlanForkSelectService({
      repoRoot: options.wiring.repoRoot,
      store: options.wiring.planForks,
      db: this.#db,
      allocator: options.wiring.allocator,
      projectId: options.wiring.projectId,
      planProvider: makeReadonlyPlanProvider({
        reader,
        researchRoot: options.wiring.researchRoot,
        declarativeDir: this.#declarativeDir,
      }),
      reader,
      writer: new FsPlanFileWriter(),
      schemaDir: this.#declarativeDir,
      now: this.#now,
    } satisfies Omit<PlanForkSelectOptions, 'git' | 'concurrency' | 'researchDir'>)

    // WP-5.3 (DOMAIN_SCHEMA §10): the reporting layer (interaction /
    // reporting_item / scheduled_event) — idempotent DDL on the same
    // second connection (the planfork/flooding dual-connection 先例).
    this.#reporting = new ReportingService({
      db: this.#db,
      allocator: options.wiring.allocator,
      projectId: options.wiring.projectId,
      now: this.#now,
    })

    // RR-017② (WP-6.4): the WP-5.1 intervention layer on the same
    // user-surface second connection (dual-connection 先例 — the lifecycle
    // store applies the WP-3.5 DDL single source idempotently). The
    // 13-RPC `updateInterventionState` now routes through
    // `InterventionService.updateState` (equivalence: same §13 guard
    // single source + same optimistic conditional UPDATE + 1:1 result
    // shape; the RPC face keeps its actor-agnostic USER semantics — the
    // service re-asserts USER at runtime, INV-PERM-4).
    const interventionLifecycle = new InterventionLifecycleStore({
      db: this.#db,
      interventions: options.wiring.interventions,
    })
    this.#intervention = new InterventionService({
      store: options.wiring.store,
      registry: options.wiring.registry,
      lifecycle: interventionLifecycle,
      allocator: options.wiring.allocator,
      projectId: options.wiring.projectId,
      externalState: () => ({ workstreams: options.wiring.externalState().workstreams }),
      now: this.#now,
    })

    // UI-4 (D §10, ADJ-1/ADJ-2): the human-attention layer (Objective /
    // NextAction / Explicit Blocker) — SELF-CONSTRUCTED here as the
    // user-surface production writer face. The wiring-internal store
    // stays on its read-only REJECTING_WRITER (the read-only invariant
    // is untouched) and HostWiring is NOT extended (ADJ-2). The
    // ActionsStore constructor runs the idempotent DDL (safe on this
    // second connection — the planfork/flooding dual-connection
    // 先例); `runExists` mirrors the wiring precedent (the tables
    // getRun face, the §16.3 第 3 条 RUN write-time check).
    const attentionReader = new FsResearchReader(options.wiring.researchRoot)
    this.#actionsStore = new ActionsStore({
      db: this.#db,
      allocator: options.wiring.allocator,
      projectId: options.wiring.projectId,
      now: this.#now,
    })
    this.#actions = new ActionsService({
      store: this.#actionsStore,
      reader: attentionReader,
      writer: new FsPlanFileWriter(),
      researchRoot: options.wiring.researchRoot,
      schemaDir: this.#declarativeDir,
      allocator: options.wiring.allocator,
      projectId: options.wiring.projectId,
      db: this.#db,
      runExists: {
        exists: (runId) => options.wiring.tables.getRun(runId) !== null,
      },
      now: this.#now,
    })
    this.#objectives = new ObjectiveFileService({
      reader: attentionReader,
      writer: new FsPlanFileWriter(),
      researchRoot: options.wiring.researchRoot,
      schemaDir: this.#declarativeDir,
      allocator: options.wiring.allocator,
      projectId: options.wiring.projectId,
      db: this.#db,
      now: this.#now,
    })

    // UI-5 (D3, brief §3): the plan writer — SELF-CONSTRUCTED (the UI-4
    // ActionsService precedent: the same fresh-PlanStore / FsPlanFileWriter
    // spine, the same second connection for the MANAGEMENT_ACTION
    // ledger rows; the wiring's read-only REJECTING_WRITER is untouched).
    this.#planWriter = new PlanWriterService({
      reader: attentionReader,
      writer: new FsPlanFileWriter(),
      researchRoot: options.wiring.researchRoot,
      schemaDir: this.#declarativeDir,
      allocator: options.wiring.allocator,
      projectId: options.wiring.projectId,
      db: this.#db,
      now: this.#now,
    })

    // UI-6 (D1, brief §3/ADJ-13): the topology service — SELF-CONSTRUCTED
    // (the PlanWriterService precedent: the per-call TopologyStore /
    // MergeContractStore kernels over a shared FsTopologyFileIo, the
    // same second connection for the MANAGEMENT_ACTION ledger rows; the
    // wiring's read-only REJECTING_WRITER is untouched, HostWiring NOT
    // extended). The tree loader is the fail-loud full-tree load (the
    // service performs the cross-file re-validation the store boundary
    // comment assigns to the service layer).
    this.#topology = new TopologyService({
      io: new FsTopologyFileIo(),
      researchRoot: options.wiring.researchRoot,
      schemaDir: this.#declarativeDir,
      loadTree: (operation) => loadResearchTreeOrThrow(options.wiring.researchRoot, this.#declarativeDir, operation),
      hierarchy: options.wiring.hierarchy,
      allocator: options.wiring.allocator,
      projectId: options.wiring.projectId,
      db: this.#db,
      now: this.#now,
    })
  }

  /**
   * UI-0.4 (R-01): map the service's CF_* error family onto the wire
   * error carrier. The gateway folds a host error to
   * `{ ok: false, error: <message> }` — the `[CODE]` prefix in the
   * message is the machine-matchable carrier (the PLANE_* precedent).
   * Non-CF errors propagate untouched (the kernel's own messages).
   */
  #mapCurrentFocusError(e: unknown): unknown {
    if (isCurrentFocusError(e)) {
      return new Error(`[research-control] ${e.code}: ${e.message}`, { cause: e })
    }
    return e
  }

  /**
   * V2-UI-0.4 (Task 3): map the service's HIER_* error family onto the
   * wire error carrier (same `[research-control] <CODE>: <message>`
   * shape as the CF_ mapper — the gateway folds a host error to
   * `{ ok: false, error: <message> }` and the prefix is the
   * machine-matchable carrier). Non-hierarchy errors propagate
   * untouched (the kernel's own messages).
   */
  #mapHierarchyError(e: unknown): unknown {
    if (isHierarchyError(e)) {
      return new Error(`[research-control] ${e.code}: ${e.message}`, { cause: e })
    }
    return e
  }

  /**
   * UI-4 (D §10): map the attention layer's ActionsError family onto the
   * wire error carrier (the same `[research-control] <CODE>: <message>`
   * shape as the CF_/HIER_ mappers). ONE mapper covers BOTH attention
   * faces — the objectives service and the actions service throw the
   * SAME `ActionsError` carrier class (RECON §2.1/§2.2 are one code
   * family; the consolidated naming is a design ruling, not a split).
   * Non-attention errors propagate untouched (the kernel's own messages).
   */
  #mapActionsError(e: unknown): unknown {
    if (e instanceof ActionsError) {
      return new Error(`[research-control] ${e.code}: ${e.message}`, { cause: e })
    }
    return e
  }

  /**
   * UI-5 (D3): map the plan-writer service's error family onto the wire
   * error carrier. The service ALREADY maps (the D1 `mapPlanWriterError`
   * pass); this face-level pass is the idempotent double safety net the
   * UI-4 face uses — an already-mapped carrier is not a `RunBindingError`
   * and rides through untouched.
   */
  #mapPlanWriterError(e: unknown): unknown {
    return mapPlanWriterError(e)
  }

  /**
   * UI-5 (D3): map the dependency service's error family onto the wire
   * error carrier (same idempotent double-safety-net shape as
   * `#mapPlanWriterError`).
   */
  #mapDependencyError(e: unknown): unknown {
    return mapDependencyError(e)
  }

  /**
   * UI-7 (D3): map the semantic records service's error family onto the
   * wire error carrier (same idempotent double-safety-net shape as
   * `#mapDependencyError`).
   */
  #mapSemanticsError(e: unknown): unknown {
    return mapSemanticsError(e)
  }

  /**
   * UI-6 (D1): map the topology service's error family onto the wire
   * error carrier. The service pass (`mapTopologyServiceError`) maps the
   * kernel errors to `TopologyServiceError` WITHOUT building the prefix
   * into the message — so, like the CF_/HIER_/ATTN_ face mappers, THIS
   * face pass is where the `[research-control] <CODE>: <message>`
   * carrier is constructed (the family convention documented in
   * service/topology/errors.ts; t65/t67 precedent; the t71 ⑥a/⑥b
   * negative probes pin it). A mapped carrier is a plain `Error`, not a
   * `TopologyServiceError`, so the pass cannot double-prefix.
   */
  #mapTopologyServiceError(e: unknown): unknown {
    const mapped = mapTopologyServiceError(e)
    if (mapped instanceof TopologyServiceError) {
      return new Error(`[research-control] ${mapped.code}: ${mapped.message}`, { cause: mapped })
    }
    return mapped
  }

  /**
   * UI-0.4 (R-01): BEST-EFFORT current-focus revalidation after a
   * committed Plan mutation (reorderPlan / selectPlanFork). Auto-clears
   * the pointer when its target has left the canonical Plan. Never
   * propagates: the mutation contract (plan.yaml + ledger + result
   * DTO) is already complete, and a cross-domain invalidation failure
   * must not poison a succeeded mutation (D §6.5) — at worst the
   * pointer stays stale until the next revalidation, and the log line
   * below is loud.
   */
  #revalidateCurrentFocus(workstreamId: string): void {
    try {
      this.#wiring.currentFocus.revalidate(workstreamId)
    } catch (e) {
      this.#logger.error('current-focus-revalidate', {
        workstreamId,
        message:
          'current-focus revalidate (best-effort) failed — the plan mutation stands; ' +
          `the pointer may be stale until the next revalidation: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }

  setCurrentFocus(args: SetCurrentFocusArgs): SetCurrentFocusResult {
    // The service owns the semantics: CF_INPUT shape gate → the
    // canonical-membership gate (BEFORE any row write) → the UPSERT.
    // The RPC face IS the USER lane (R-01) — no actor to forward.
    try {
      const record = this.#wiring.currentFocus.set(args.workstreamId, args.planItemId)
      return {
        workstreamId: record.workstreamId,
        planItemId: record.planItemId,
        updatedAt: record.updatedAt,
      }
    } catch (e) {
      throw this.#mapCurrentFocusError(e)
    }
  }

  getCurrentFocus(args: GetCurrentFocusArgs): GetCurrentFocusResult {
    // BL-03 (UI-1): the read face gets the SAME error mapping as
    // `setCurrentFocus` (mirror of :457-471) — a CF_* fault from
    // `currentFocus.get` (CF_STORE: bad row / closed handle — the CF_INPUT
    // shape gate is decoded away earlier at the @Remote zod layer,
    // host/index.ts) rides the same `[research-control] <CODE>: <message>`
    // carrier; non-CF errors propagate untouched.
    try {
      const record = this.#wiring.currentFocus.get(args.workstreamId)
      return {
        workstreamId: args.workstreamId,
        focus:
          record === undefined
            ? null
            : { planItemId: record.planItemId, updatedAt: record.updatedAt },
      }
    } catch (e) {
      throw this.#mapCurrentFocusError(e)
    }
  }

  createTopic(args: CreateTopicArgs): CreateTopicResult {
    // The service owns the semantics: HIER_INPUT shape gate → the fresh
    // load (fail-loud HIER_TREE_BROKEN) → the TPC-<n> allocation → the
    // pre-write probe (HIER_TOPIC_EXISTS) → the atomic write. The RPC
    // face IS the USER lane — no actor to forward; the `projectId`
    // routing already selected this per-project wiring (requireRpc,
    // §12.1).
    try {
      const out = this.#wiring.hierarchy.createTopic({
        title: args.title,
        description: args.description,
      })
      return {
        topicId: out.topicId,
        title: out.title,
        path: out.path,
        createdAt: out.createdAt,
      }
    } catch (e) {
      throw this.#mapHierarchyError(e)
    }
  }

  createWorkstream(args: CreateWorkstreamArgs): CreateWorkstreamResult {
    // Same spine; the topic membership gate (HIER_TOPIC_NOT_FOUND) runs
    // inside the service BEFORE any allocation or write.
    try {
      const out = this.#wiring.hierarchy.createWorkstream({
        topicId: args.topicId,
        title: args.title,
        summary: args.summary,
      })
      return {
        workstreamId: out.workstreamId,
        topicId: out.topicId,
        title: out.title,
        path: out.path,
        createdAt: out.createdAt,
      }
    } catch (e) {
      throw this.#mapHierarchyError(e)
    }
  }

  updateProjectMetadata(args: UpdateProjectMetadataArgs): UpdateProjectMetadataResult {
    // UI-2A: the service owns the spine — the HIER_INPUT "at least one
    // field" gate → the fresh load (fail-loud HIER_TREE_BROKEN) → the
    // merge of the PROVIDED fields only (the rest byte-preserved) → the
    // atomic rewrite. The `projectId` routing already selected this
    // per-project wiring (requireRpc, §12.1).
    try {
      const out = this.#wiring.hierarchy.updateProjectMetadata({
        title: args.title,
        description: args.description,
        importance: args.importance,
        attentionMode: args.attentionMode,
        targetDate: args.targetDate,
      })
      return {
        projectId: out.projectId,
        title: out.title,
        updatedAt: out.updatedAt,
      }
    } catch (e) {
      throw this.#mapHierarchyError(e)
    }
  }

  updateTopic(args: UpdateTopicArgs): UpdateTopicResult {
    // UI-2A: same RMW spine over the target topic.yaml; the topic
    // membership gate (HIER_TOPIC_NOT_FOUND) runs inside the service
    // BEFORE any write.
    try {
      const out = this.#wiring.hierarchy.updateTopic({
        topicId: args.topicId,
        title: args.title,
        description: args.description,
        importance: args.importance,
        attentionMode: args.attentionMode,
      })
      return {
        topicId: out.topicId,
        title: out.title,
        updatedAt: out.updatedAt,
      }
    } catch (e) {
      throw this.#mapHierarchyError(e)
    }
  }

  updateWorkstream(args: UpdateWorkstreamArgs): UpdateWorkstreamResult {
    // UI-2A: same RMW spine over the target workstream.yaml (title +
    // summary ONLY — the update face is frozen); the workstream
    // membership gate (HIER_WORKSTREAM_NOT_FOUND) runs inside the
    // service BEFORE any write.
    try {
      const out = this.#wiring.hierarchy.updateWorkstream({
        workstreamId: args.workstreamId,
        title: args.title,
        summary: args.summary,
      })
      return {
        workstreamId: out.workstreamId,
        topicId: out.topicId,
        title: out.title,
        updatedAt: out.updatedAt,
      }
    } catch (e) {
      throw this.#mapHierarchyError(e)
    }
  }

  dropWorkstream(args: DropWorkstreamArgs): DropWorkstreamResult {
    // UI-2A: the conservative ruling — the history refusal
    // (HIER_WORKSTREAM_HAS_HISTORY) runs inside the service BEFORE the
    // whole-directory removal; the post-delete current-focus clear is
    // BEST-EFFORT (a failure there never undoes the drop — it is
    // folded into the `currentFocusCleared` result flag).
    try {
      const out = this.#wiring.hierarchy.dropWorkstream({
        workstreamId: args.workstreamId,
      })
      return {
        workstreamId: out.workstreamId,
        topicId: out.topicId,
        currentFocusCleared: out.currentFocusCleared,
      }
    } catch (e) {
      throw this.#mapHierarchyError(e)
    }
  }

  /* ------------------------------------------------------------------ *
   * UI-4 (D §10) — Workstream Current Execution completion: the
   * attention read face + the five user mutations (ADJ-1..ADJ-8).
   * ------------------------------------------------------------------ */

  async getWorkstreamCurrent(args: GetWorkstreamCurrentArgs): Promise<GetWorkstreamCurrentResult> {
    await this.#stalePrecheck(args.workstreamId)
    const tree = this.#loadTree('getWorkstreamCurrent')
    const wsNode = this.#findWorkstreamNode(tree, args.workstreamId, 'getWorkstreamCurrent')
    // The owner-scoped event log (the same read getWorkstream uses —
    // `store.listRange(ws, 1)`, audit order): it carries every
    // TASK_EXECUTION_CHANGED of the WS tasks, every outgoing
    // RELATION_ADDED/REMOVED and every GATE_EVALUATED (HISTORY_EVENT_
    // CATALOG §4 owner-scope fact — the derived projection's input).
    const events = this.#wiring.store.listRange(wsNode.id, 1)
    // The execution facet fold (the minimal inline duplicate of
    // getWorkstream's Current-zone fold — the derived projection only
    // needs the execution facet, so validation is left out).
    const taskExecution = new Map<string, string>()
    for (const t of wsNode.tasks) taskExecution.set(t.id, 'PLANNED')
    foldEvents(
      events,
      (state: Map<string, string>, ev) => {
        if (ev.eventType === 'TASK_EXECUTION_CHANGED') {
          const p = ev.payload as { task_id?: unknown; to?: unknown }
          if (
            typeof p.task_id === 'string' &&
            typeof p.to === 'string' &&
            TASK_EXECUTIONS.has(p.to) &&
            state.has(p.task_id)
          ) {
            state.set(p.task_id, p.to)
          }
        }
        return state
      },
      taskExecution,
    )
    // The canonical focus Task (ADJ-3): the CF pointer WHEN it names a
    // canonical Task member of this WS (robust to eviction timing — a
    // pointer naming a dropped / foreign / non-Task item yields no
    // focus Task, and BOTH derived rules produce nothing).
    const cf = this.#wiring.currentFocus.get(wsNode.id)
    const taskIds = new Set(wsNode.tasks.map((t) => t.id))
    const focusTaskId =
      cf !== undefined && taskIds.has(cf.planItemId) ? cf.planItemId : null
    // The canonical plan order (the declarative single source — the
    // same face getWorkstream's future zone reads; no plan ⇒ the GATE
    // rule produces nothing).
    const canonicalOrder = wsNode.plan?.ordered_items ?? []
    // The DERIVED projection (ADJ-3/ADJ-4 — pure + deterministic; the
    // wire DTO is mapped verbatim).
    const derived = deriveWorkstreamBlockers({
      workstreamId: wsNode.id,
      focusTaskId,
      canonicalOrder,
      taskExecution: Object.fromEntries(taskExecution),
      events: events.map((ev) => ({
        eventSeq: ev.eventSeq,
        eventType: ev.eventType,
        payload: ev.payload,
      })),
    })
    // The EXPLICIT blocker scope (ADJ-5): the WS itself ∪ its member
    // Tasks ∪ its Runs.
    const runs = this.#wiring.tables.listRuns({ workstreamId: wsNode.id })
    const memberIds = new Set<string>([...taskIds, ...runs.map((r) => r.id)])
    const explicit = this.#actions.listBlockersForWorkstream(wsNode.id, memberIds)
    // The ACTIVE linked objectives (ADJ-6): every ACTIVE objective whose
    // linked_refs names this WORKSTREAM — priority-then-id order (the
    // header row shows the first).
    const objectives = this.#objectives
      .loadObjectives()
      .objectives.filter(
        (o) =>
          o.status === 'ACTIVE' &&
          o.linked_refs.some((ref) => ref.kind === 'WORKSTREAM' && ref.id === wsNode.id),
      )
    objectives.sort((a, b) =>
      a.priority === b.priority ? a.id.localeCompare(b.id, undefined, { numeric: true }) : a.priority < b.priority ? -1 : 1,
    )
    // The PROPOSED NAs (the actionable set — terminal NAs are noise in
    // the Current zone).
    const nextActions = this.#actions.listNextActions({ workstreamId: wsNode.id, status: 'PROPOSED' })
    // The interventions naming the WS (ALL states — the zone renders
    // the closure state; ADJ-7 thin passthrough, stable order).
    const interventions = this.#intervention.listForWorkstream(wsNode.id)
    return {
      workstreamId: wsNode.id,
      objectives: objectives.map(toObjectiveFullDto),
      explicitBlockers: explicit.map(toBlockerDto),
      derivedBlockers: derived.map(toDerivedBlockerDto),
      nextActions: nextActions.map(toNextActionDto),
      interventions: interventions.map(toInterventionFullDto),
      // UI-5 (ADJ-7): the ACTIVE DEPENDS_ON edges of the canonical plan —
      // zero new reads: folded from the SAME owner-scoped events the
      // execution/derived folds above already loaded, against the
      // canonical order already resolved (both endpoints must be in the
      // plan; sorted by relation id).
      dependencyEdges: projectDependencyEdges({ events, canonicalPlan: canonicalOrder }),
    }
  }

  async updateObjective(args: UpdateObjectiveArgs): Promise<UpdateObjectiveResult> {
    try {
      const hasStatement = args.statement !== undefined
      const hasStatus = args.status !== undefined
      if (!hasStatement && !hasStatus) {
        throw new ActionsError('ACT_INPUT', 'updateObjective: at least one of statement/status is required')
      }
      // Both may be set: the statement RMW (the whole-file atomic save —
      // ADJ-6) runs FIRST, then the status change rides
      // setObjectiveStatus (the transition-checked face — ADJ-6; the
      // two OBJECTIVE_EDITED ledger rows for a combined edit are the
      // accepted consequence of the locked ruling). The nullable
      // accumulators + the final guard are the TS control-flow
      // equivalent of the guard above (at least one branch WILL run).
      let managementActionId: string | undefined
      let status: UpdateObjectiveResult['status'] | undefined
      if (hasStatement) {
        const { objectives } = this.#objectives.loadObjectives()
        if (!objectives.some((o) => o.id === args.objectiveId)) {
          throw new ActionsError('OBJ_NOT_FOUND', `updateObjective: objective ${args.objectiveId} does not exist`)
        }
        const next = objectives.map((o) => (o.id === args.objectiveId ? { ...o, statement: args.statement! } : o))
        const saved = this.#objectives.saveObjectives(next, USER_ACTOR)
        managementActionId = saved.managementActionId
        status = saved.objectives.find((o) => o.id === args.objectiveId)!.status
      }
      if (hasStatus) {
        const saved = this.#objectives.setObjectiveStatus(args.objectiveId, args.status!, USER_ACTOR)
        managementActionId = saved.managementActionId
        status = saved.objectives.find((o) => o.id === args.objectiveId)!.status
      }
      if (managementActionId === undefined || status === undefined) {
        // Unreachable: the guard above ensures at least one branch ran.
        throw new ActionsError('ACT_INPUT', 'updateObjective: no field applied (unreachable)')
      }
      return {
        objectiveId: args.objectiveId,
        status,
        managementActionId,
        updatedAt: this.#now(),
      }
    } catch (e) {
      throw this.#mapActionsError(e)
    }
  }

  async createNextAction(args: CreateNextActionArgs): Promise<CreateNextActionResult> {
    try {
      const na = this.#actions.createNextAction(
        {
          workstreamId: args.workstreamId,
          statement: args.statement,
          rationale: args.rationale,
        },
        USER_ACTOR,
      )
      return { nextAction: toNextActionDto(na) }
    } catch (e) {
      throw this.#mapActionsError(e)
    }
  }

  async promoteNextAction(args: PromoteNextActionArgs): Promise<PromoteNextActionResult> {
    try {
      const out = this.#actions.promoteNextAction(
        args.nextActionId,
        { workstreamId: args.workstreamId, index: args.index },
        USER_ACTOR,
      )
      // The materialization receipt — the host ActionsService result
      // mapped verbatim (the D §10.4 wire face).
      return {
        nextActionId: out.nextActionId,
        taskId: out.taskId,
        workstreamId: out.workstreamId,
        planPath: out.planPath,
        newOrder: [...out.newOrder],
        managementActionId: out.managementActionId,
      }
    } catch (e) {
      throw this.#mapActionsError(e)
    }
  }

  async dismissNextAction(args: DismissNextActionArgs): Promise<DismissNextActionResult> {
    try {
      const na = this.#actions.dismissNextAction(args.nextActionId, USER_ACTOR)
      return { nextAction: toNextActionDto(na) }
    } catch (e) {
      throw this.#mapActionsError(e)
    }
  }

  async createBlocker(args: CreateBlockerArgs): Promise<CreateBlockerResult> {
    try {
      const b = this.#actions.createBlocker(
        {
          statement: args.statement,
          affects: args.affects.map((ref) => ({ kind: ref.kind, id: ref.id })),
          source: args.source,
          references: args.references === undefined ? undefined : [...args.references],
        },
        USER_ACTOR,
      )
      return { blocker: toBlockerDto(b) }
    } catch (e) {
      throw this.#mapActionsError(e)
    }
  }

  async clearBlocker(args: ClearBlockerArgs): Promise<ClearBlockerResult> {
    try {
      const b = this.#actions.clearBlocker(args.blockerId, USER_ACTOR)
      return { blocker: toBlockerDto(b) }
    } catch (e) {
      throw this.#mapActionsError(e)
    }
  }

  /* ------------------------------------------------------------------ *
   * UI-5 (D3, brief §3) — the Plan-Editor + Dependency face: the 5 new
   * management RPCs (the face grows 40 → 45; no new read RPC). Each
   * mutation resolves the workstream node (topicId for the kernel
   * store; the WS existence gate), calls the self-constructed service,
   * and folds the wire result. The `projectId` routing already selected
   * this per-project wiring (requireRpc, §12.1).
   * ------------------------------------------------------------------ */

  async createPlanItem(args: CreatePlanItemArgs): Promise<CreatePlanItemResult> {
    try {
      const tree = this.#loadTree('createPlanItem')
      const wsNode = this.#findWorkstreamNode(tree, args.workstreamId, 'createPlanItem')
      const out = this.#planWriter.createPlanItem({
        workstreamId: args.workstreamId,
        topicId: wsNode.topicId,
        kind: args.kind,
        item: args.item,
        index: args.index,
      })
      return {
        itemId: out.itemId,
        workstreamId: out.workstreamId,
        kind: out.kind,
        planPath: out.planPath,
        newOrder: out.newOrder,
        managementActionId: out.managementActionId,
      }
    } catch (e) {
      throw this.#mapPlanWriterError(e)
    }
  }

  async updatePlanItem(args: UpdatePlanItemArgs): Promise<UpdatePlanItemResult> {
    try {
      const tree = this.#loadTree('updatePlanItem')
      const wsNode = this.#findWorkstreamNode(tree, args.workstreamId, 'updatePlanItem')
      const out = this.#planWriter.updatePlanItem({
        workstreamId: args.workstreamId,
        topicId: wsNode.topicId,
        itemId: args.itemId,
        changes: args.changes,
      })
      return {
        itemId: out.itemId,
        workstreamId: out.workstreamId,
        updatedAt: out.updatedAt,
      }
    } catch (e) {
      throw this.#mapPlanWriterError(e)
    }
  }

  async removePlanItem(args: RemovePlanItemArgs): Promise<RemovePlanItemResult> {
    try {
      // ADJ-14 (RPC layer): capture the CF pointer BEFORE the mutation.
      // The service removes the item (the kernel rewrites plan.yaml +
      // the ledger row); after success the best-effort revalidate
      // auto-clears the pointer, and the cleared flag folds into the
      // wire result from the pre-mutation pointer comparison.
      const cfBefore = this.#wiring.currentFocus.get(args.workstreamId)
      const tree = this.#loadTree('removePlanItem')
      const wsNode = this.#findWorkstreamNode(tree, args.workstreamId, 'removePlanItem')
      const out = this.#planWriter.removePlanItem({
        workstreamId: args.workstreamId,
        topicId: wsNode.topicId,
        itemId: args.itemId,
      })
      this.#revalidateCurrentFocus(args.workstreamId)
      return {
        workstreamId: out.workstreamId,
        planPath: out.planPath,
        newOrder: out.newOrder,
        managementActionId: out.managementActionId,
        currentFocusCleared: cfBefore !== undefined && cfBefore.planItemId === args.itemId,
      }
    } catch (e) {
      throw this.#mapPlanWriterError(e)
    }
  }

  async addDependency(args: AddDependencyArgs): Promise<AddDependencyResult> {
    try {
      const tree = this.#loadTree('addDependency')
      this.#findWorkstreamNode(tree, args.workstreamId, 'addDependency')
      const service = this.#makeDependencyService(tree)
      const out = service.addDependency({
        workstreamId: args.workstreamId,
        source: { kind: args.source.kind, id: args.source.id },
        target: { kind: args.target.kind, id: args.target.id },
      })
      return {
        relationId: out.relationId,
        source: { kind: out.source.kind, id: out.source.id },
        target: { kind: out.target.kind, id: out.target.id },
      }
    } catch (e) {
      throw this.#mapDependencyError(e)
    }
  }

  async removeDependency(args: RemoveDependencyArgs): Promise<RemoveDependencyResult> {
    try {
      const tree = this.#loadTree('removeDependency')
      this.#findWorkstreamNode(tree, args.workstreamId, 'removeDependency')
      const service = this.#makeDependencyService(tree)
      const out = service.removeDependency({
        workstreamId: args.workstreamId,
        relationId: args.relationId,
      })
      return { relationId: out.relationId }
    } catch (e) {
      throw this.#mapDependencyError(e)
    }
  }

  /**
   * UI-6 (D1, D §12.2): the topology fork. The service owns the full
   * gate order (fresh load → topic/parent validation → file-derived TE
   * numbers → per-child WS-then-edge → re-validation → ledger) and the
   * inverse compensation (ADJ-2); the face is a pure pass-through
   * (the wire `projectId` routing field is consumed by requireRpc,
   * never forwarded).
   */
  async createWorkstreamFork(args: CreateWorkstreamForkArgs): Promise<CreateWorkstreamForkResult> {
    try {
      return this.#topology.createWorkstreamFork({
        topicId: args.topicId,
        parentWorkstreamId: args.parentWorkstreamId,
        children: args.children,
      })
    } catch (e) {
      throw this.#mapTopologyServiceError(e)
    }
  }

  /**
   * UI-6 (D2, BRIEF §3): the planned merge. The service owns the gate
   * order (dedup → fresh load → topic/inputs/output validation →
   * duplicate-pair gate → file-derived TE number → single atomic edge
   * write → re-validation → ledger); the face is a pure pass-through
   * (the wire `projectId` routing field is consumed by requireRpc,
   * never forwarded).
   */
  async createPlannedMerge(args: CreatePlannedMergeArgs): Promise<CreatePlannedMergeResult> {
    try {
      return this.#topology.createPlannedMerge({
        topicId: args.topicId,
        inputWorkstreamIds: args.inputWorkstreamIds,
        outputWorkstreamId: args.outputWorkstreamId,
        ...(args.note === undefined ? {} : { note: args.note }),
      })
    } catch (e) {
      throw this.#mapTopologyServiceError(e)
    }
  }

  /**
   * UI-6 (D2, BRIEF §3): the merge contract read face. A missing
   * contract is a null `content` value (the CONTRACT_NOT_FOUND code
   * folds in the service); the face is a pass-through.
   */
  async getMergeContract(args: GetMergeContractArgs): Promise<GetMergeContractResult> {
    try {
      return this.#topology.getMergeContract({ edgeId: args.edgeId })
    } catch (e) {
      throw this.#mapTopologyServiceError(e)
    }
  }

  /**
   * UI-6 (D2, BRIEF §3): the merge contract write face. The service
   * gates the unknown edge up front (TOPO_CONTRACT_TE_UNKNOWN), writes
   * the file byte-for-byte (full replacement) and records the
   * CONTRACT_EDITED ledger row; the face is a pass-through (the wire
   * `projectId` routing field is consumed by requireRpc, never
   * forwarded).
   */
  async saveMergeContract(args: SaveMergeContractArgs): Promise<SaveMergeContractResult> {
    try {
      return this.#topology.saveMergeContract({
        edgeId: args.edgeId,
        content: args.content,
      })
    } catch (e) {
      throw this.#mapTopologyServiceError(e)
    }
  }

  /**
   * UI-6 (D3, BRIEF §3): the edge drop face. The service owns the full
   * gate order (fresh load → owning-topic resolution → state-machine
   * transition → re-validation → TOPOLOGY_EDITED ledger with the
   * from-state in the detail); the face is a pure pass-through (the
   * wire `projectId` routing field is consumed by requireRpc, never
   * forwarded).
   */
  async dropTopologyEdge(args: DropTopologyEdgeArgs): Promise<DropTopologyEdgeResult> {
    try {
      return this.#topology.dropTopologyEdge({ edgeId: args.edgeId })
    } catch (e) {
      throw this.#mapTopologyServiceError(e)
    }
  }

  /* ------------------------------------------------------------------ *
   * UI-7 (D1–D3, brief §3) — the Records face: the seven writes of D §13
   * (face grows 50 → 58; queryRecords lands in D4). Each write resolves
   * its owner, calls the self-constructed service, and folds the wire
   * result (the wire `projectId` routing field is consumed by requireRpc,
   * never forwarded). Owner resolution:
   *
   *   workstream-scoped (recordFact / recordClaim / registerArtifact) —
   *   the WS node existence gate runs up front (`#findWorkstreamNode`);
   *   object-scoped (retractClaim / markArtifactMissing / addRelation /
   *   removeRelation) — the owner is derived from the derived state (or
   *   from the endpoints, for addRelation) INSIDE the service, so the
   *   OBJECT_NOT_FOUND / OWNER_MISMATCH verdicts are domain-owned and
   *   the adapter only loads the tree for the plan index.
   *
   * The canonical reserve→append→commit protocol the service runs is
   * `../service/semantics/protocol.js` (ADJ-2 — the UI-5 dependency
   * service delegates its same body to it).
   * ------------------------------------------------------------------ */

  async recordFact(args: RecordFactArgs): Promise<RecordFactResult> {
    try {
      const tree = this.#loadTree('recordFact')
      this.#findWorkstreamNode(tree, args.workstreamId, 'recordFact')
      const service = this.#makeSemanticRecordsService(tree)
      return service.recordFact({
        workstreamId: args.workstreamId,
        statement: args.statement,
        references: args.references,
      })
    } catch (e) {
      throw this.#mapSemanticsError(e)
    }
  }

  async recordClaim(args: RecordClaimArgs): Promise<RecordClaimResult> {
    try {
      const tree = this.#loadTree('recordClaim')
      this.#findWorkstreamNode(tree, args.workstreamId, 'recordClaim')
      const service = this.#makeSemanticRecordsService(tree)
      return service.recordClaim({
        workstreamId: args.workstreamId,
        statement: args.statement,
        references: args.references,
      })
    } catch (e) {
      throw this.#mapSemanticsError(e)
    }
  }

  async retractClaim(args: RetractClaimArgs): Promise<RetractClaimResult> {
    try {
      const tree = this.#loadTree('retractClaim')
      const service = this.#makeSemanticRecordsService(tree)
      return service.retractClaim({
        claimId: args.claimId,
        reason: args.reason,
      })
    } catch (e) {
      throw this.#mapSemanticsError(e)
    }
  }

  async registerArtifact(args: RegisterArtifactArgs): Promise<RegisterArtifactResult> {
    try {
      const tree = this.#loadTree('registerArtifact')
      this.#findWorkstreamNode(tree, args.workstreamId, 'registerArtifact')
      const service = this.#makeSemanticRecordsService(tree)
      return service.registerArtifact({
        workstreamId: args.workstreamId,
        type: args.type,
        title: args.title,
        uri: args.uri,
        contentHash: args.contentHash,
        relatedTaskId: args.relatedTaskId,
        supersedes: args.supersedes,
      })
    } catch (e) {
      throw this.#mapSemanticsError(e)
    }
  }

  async markArtifactMissing(args: MarkArtifactMissingArgs): Promise<MarkArtifactMissingResult> {
    try {
      const tree = this.#loadTree('markArtifactMissing')
      const service = this.#makeSemanticRecordsService(tree)
      return service.markArtifactMissing({
        artifactId: args.artifactId,
        reason: args.reason,
      })
    } catch (e) {
      throw this.#mapSemanticsError(e)
    }
  }

  async addRelation(args: AddRelationArgs): Promise<AddRelationResult> {
    try {
      const tree = this.#loadTree('addRelation')
      const service = this.#makeSemanticRecordsService(tree)
      const out = service.addRelation({
        source: { kind: args.source.kind, id: args.source.id },
        relationType: args.relationType,
        target: { kind: args.target.kind, id: args.target.id },
      })
      return {
        relationId: out.relationId,
        source: { kind: out.source.kind, id: out.source.id },
        relationType: out.relationType,
        target: { kind: out.target.kind, id: out.target.id },
        status: out.status,
        eventId: out.eventId,
      }
    } catch (e) {
      throw this.#mapSemanticsError(e)
    }
  }

  async removeRelation(args: RemoveRelationArgs): Promise<RemoveRelationResult> {
    try {
      const tree = this.#loadTree('removeRelation')
      const service = this.#makeSemanticRecordsService(tree)
      return service.removeRelation({
        relationId: args.relationId,
        reason: args.reason,
      })
    } catch (e) {
      throw this.#mapSemanticsError(e)
    }
  }

  async queryRecords(args: QueryRecordsArgs): Promise<QueryRecordsResult> {
    try {
      const service = this.#makeSemanticRecordsQueryService()
      return service.queryRecords({
        workstreamId: args.workstreamId,
        type: args.type,
        status: args.status,
        keyword: args.keyword,
        relatedObject: args.relatedObject,
        timeFrom: args.timeFrom,
        timeTo: args.timeTo,
        limit: args.limit,
        offset: args.offset,
      })
    } catch (e) {
      throw this.#mapSemanticsError(e)
    }
  }

  /**
   * UI-8 (D2, ADJ-13): the single-project attention collection — the
   * `ProjectAttentionSources` production adapter over the wiring's
   * SAME-ORIGIN read faces (the store owner-scope fold / the ActionsService
   * operational face / the objectives.yaml face — the very sources the
   * per-project RPC reads serve, so the mgmt and plane paths agree by
   * construction). `awarenessState` is always null: NO awareness RPC
   * write face exists in the frozen 13 + mgmt lists, so no awareness
   * record can exist yet — null is the honest "no record" (UNSEEN)
   * semantics, and it keeps this face free of the AwarenessStore
   * constructor's DDL. The real read wires in when the first
   * awareness face lands.
   */
  collectAttention(now: number): ProjectAttentionCollection {
    const tree = this.#loadTree('collectAttention')
    const wsNodes: AttentionWorkstreamNode[] = []
    for (const topic of tree.topics) {
      for (const ws of topic.workstreams) {
        wsNodes.push({
          id: ws.id,
          taskIds: ws.tasks.map((t) => t.id),
          canonicalOrder: ws.plan?.ordered_items ?? [],
        })
      }
    }
    const sources: ProjectAttentionSources = {
      projectId: this.#wiring.projectId,
      listInterventions: () => this.#wiring.interventions.listInterventions(),
      listBlockers: () => this.#actions.listBlockers(),
      listNextActions: () => this.#actions.listNextActions(),
      listObjectives: () => this.#actions.listObjectives(),
      listWorkstreamNodes: () => wsNodes,
      listEvents: (wsId) =>
        this.#wiring.store
          .listRange(wsId, 1)
          .map((ev) => ({ eventSeq: ev.eventSeq, eventType: ev.eventType, payload: ev.payload })),
      currentFocusPlanItem: (wsId) => this.#wiring.currentFocus.get(wsId)?.planItemId ?? null,
      awarenessState: () => null,
    }
    return collectProjectAttention(sources, now)
  }

  /**
   * UI-8 (D2, D §14 + ADJ-4): the unified Needs-Attention read face —
   * the mgmt single-project path (the dsh-adapter's @Remote body routes
   * here when `projectId` is given; the plane port serves the empty-
   * projectId cross-project merge over the SAME pure core,
   * `queryCollections`).
   */
  async queryAttention(args: QueryAttentionArgs): Promise<QueryAttentionResult> {
    const now = this.#now()
    return queryCollections([this.collectAttention(now)], args, now)
  }

  /**
   * UI-7 (D1): build the per-call semantic records service. The plan
   * index is a FRESH fold of the just-loaded tree (the same rule as
   * `#makeDependencyService` — the file is the truth): every workstream's
   * DEFINITION-file id sets (task/gate/milestone nodes). The service's
   * registry validation hook rides the composed in-tx validate (its own
   * pre-check runs OUTSIDE the tx for the UX error; the registry hook +
   * the reducer throw inside the fold are the authoritative gate, in the
   * same transaction).
   */
  #makeSemanticRecordsService(tree: ResearchTree): SemanticRecordsService {
    const workstreams: SemanticWorkstreamIndex[] = []
    for (const topic of tree.topics) {
      for (const ws of topic.workstreams) {
        workstreams.push({
          id: ws.id,
          topicId: ws.topicId,
          taskIds: ws.tasks.map((n) => n.id),
          gateIds: ws.gates.map((n) => n.id),
          milestoneIds: ws.milestones.map((n) => n.id),
        })
      }
    }
    return new SemanticRecordsService({
      store: this.#wiring.store,
      registry: this.#wiring.registry,
      allocator: this.#wiring.allocator,
      plans: { workstreams },
      projectId: this.#wiring.projectId,
      now: this.#now,
    })
  }

  /**
   * UI-7 (D4): build the queryRecords READ-path service. ADJ-11: the read
   * path never loads the research tree — the derived-state row is the
   * single source for filters, sort, and pagination, and the plan index
   * is an empty stub that `querySemanticRecords` never consults.
   * Skipping `#loadTree` keeps the read path free of file I/O and of any
   * stale-tree coupling (the derived row is the truth, like the write
   * path's in-tx fold).
   */
  #makeSemanticRecordsQueryService(): SemanticRecordsService {
    return new SemanticRecordsService({
      store: this.#wiring.store,
      registry: this.#wiring.registry,
      allocator: this.#wiring.allocator,
      plans: { workstreams: [] },
      projectId: this.#wiring.projectId,
      now: this.#now,
    })
  }

  /**
   * UI-5 (D3): build the per-call dependency service. The plan index is
   * a FRESH fold of the just-loaded tree (never cached — the file is the
   * truth, the same rule the snapshot reads run): every workstream's
   * DEFINITION-file id sets (the loader's itemNodes superset of the plan
   * listing — an endpoint that left the plan still resolves its owner,
   * so a stale edge removal stays possible). The service's own hook is
   * the registry validation; the semantics incremental fold rides on the
   * RR-011(b) store seam (`wiring.store` — realize-store `validateHooks`)
   * in the SAME transaction, exactly once, for every service.
   */
  #makeDependencyService(tree: ResearchTree): DependencyService {
    const workstreams: DependencyWorkstreamIndex[] = []
    for (const topic of tree.topics) {
      for (const ws of topic.workstreams) {
        workstreams.push({
          id: ws.id,
          topicId: ws.topicId,
          taskIds: ws.tasks.map((n) => n.id),
          gateIds: ws.gates.map((n) => n.id),
          milestoneIds: ws.milestones.map((n) => n.id),
        })
      }
    }
    return new DependencyService({
      store: this.#wiring.store,
      registry: this.#wiring.registry,
      allocator: this.#wiring.allocator,
      plans: { workstreams },
      projectId: this.#wiring.projectId,
      now: this.#now,
    })
  }

  /** Close the user-surface connection (idempotent; `ctx.effect`-owned). */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    try {
      this.#dbConn.close()
    } catch {
      /* idempotent close */
    }
  }

  /* ------------------------------------------------------------------ *
   * Snapshot reads (§27.1–§27.4) — the declarative tree is the 真源;
   * every read is a FRESH load (low-frequency unary face, §8: the file
   * is the truth, no cache), plus the operational query faces.
   * ------------------------------------------------------------------ */

  /**
   * WP-4.6 (RR-015① disposition) — the query-path stale pre-check: the
   * idempotent `checkAllOpen()` sweep (PLAN_FORK_SPEC §5 「检测时机」
   * 「PF 列表查询懒检测」; §3 幂等: a non-OPEN PF re-check is a NO-OP)
   * runs BEFORE any projection so the returned snapshot reflects the
   * CURRENT truth (an OPEN PF whose closure diverged since creation is
   * already STALE-with-reason when the client renders it). Per-PF sweep
   * failures are COLLECTED by the service (`StaleSweepResult.failures`)
   * and never abort the query; a sweep-level throw (e.g. an unreadable
   * store) propagates — the query would be lying about the PF state
   * anyway. No new RPC: the 13-list stays frozen (ARCHITECTURE §7.1).
   * `workstreamId` scopes the sweep (getWorkstream) or leaves it undefined
   * (getDashboard — every topic card counts OPEN PFs).
   */
  async #stalePrecheck(workstreamId?: string): Promise<void> {
    await this.#wiring.stale.checkAllOpen(workstreamId)
  }

  async getDashboard(): Promise<DashboardSnapshot> {
    // The production refresh sidecar (V2-T3.2a: extracted as
    // runProjectRefreshSidecar — the §7.1 总览 runs the same per project):
    // RR-015① full stale sweep (a sweep-level throw propagates) + the
    // RR-018① audit refresh (the client's refresh loop IS the production
    // trigger; 失败 loud 不阻塞查询主路径 — a refresh failure is logged
    // loudly and the query projection proceeds).
    await runProjectRefreshSidecar(this.#wiring, this.#logger)
    const tree = this.#loadTree('getDashboard')
    const project = tree.project
    if (project === null) {
      throw new Error('getDashboard: project.yaml is missing or invalid (the tree loaded no project doc)')
    }
    const interventions = this.#wiring.interventions.listInterventions()
    return {
      project: {
        id: project.id,
        title: project.title,
        description: project.description ?? null,
        importance: project.importance,
        attentionMode: project.attention_mode,
        targetDate: project.target_date ?? null,
      },
      topics: tree.topics.map((t) => this.#topicCard(t)),
      openInterventions: interventions.filter((iv) => iv.status === 'OPEN').map((iv) => this.#interventionDto(iv)),
      pendingInterventions: interventions.filter((iv) => iv.status === 'PENDING').map((iv) => this.#interventionDto(iv)),
      // PHASE 5/6 placeholders (never fabricated — the strict schema pins null):
      scheduledEvents: null,
      reportingItems: null,
      // RR-018②: the reserved placeholder is now the REAL count of open
      // (CAPTURED, awaiting the user) inbox items — shape unchanged
      // (same field, same position; the frozen `z.null()` placeholder is
      // relaxed to a non-negative integer — documented exemption).
      inboxCount: this.#wiring.inbox.listItems({ state: 'CAPTURED' }).length,
      attention: null,
    }
  }

  getProject(): ProjectSnapshot {
    const tree = this.#loadTree('getProject')
    const project = tree.project
    if (project === null) {
      throw new Error('getProject: project.yaml is missing or invalid (the tree loaded no project doc)')
    }
    return {
      project: {
        id: project.id,
        title: project.title,
        description: project.description ?? null,
        importance: project.importance,
        attentionMode: project.attention_mode,
        targetDate: project.target_date ?? null,
        currentObjectiveRefs: [...project.current_objective_refs],
        createdAt: project.created_at,
      },
      objectives: tree.objectives.map((o) => this.#objectiveDto(o)),
      topics: tree.topics.map((t) => this.#topicCard(t)),
      // PHASE 5 placeholder (§27.2 「upcoming interactions/reporting」):
      upcomingInteractions: null,
      upcomingReporting: null,
    }
  }

  getTopic(args: GetTopicArgs): TopicSnapshot {
    const tree = this.#loadTree('getTopic')
    const topic = tree.topics.find((t) => t.id === args.topicId)
    if (topic === undefined) {
      throw new Error(`getTopic: topic ${args.topicId} does not exist`)
    }
    const doc = topic.doc
    if (doc === null) {
      throw new Error(`getTopic: topic ${args.topicId} has no loadable topic.yaml`)
    }
    const edges = topic.topology?.topology.edges ?? []
    const edgeIds = new Set(edges.map((e) => e.id))
    return {
      topic: {
        id: doc.id,
        title: doc.title,
        description: doc.description ?? null,
        importance: doc.importance ?? null,
        attentionMode: doc.attention_mode ?? null,
        objectiveRefs: [...doc.objective_refs],
        createdAt: doc.created_at,
      },
      workstreams: topic.workstreams.map((ws) => this.#workstreamCard(ws)),
      topology: {
        edges: edges.map((e) => ({
          id: e.id,
          operation: e.operation,
          lifecycle: e.lifecycle,
          inputs: [...e.inputs],
          outputs: [...e.outputs],
          note: e.note ?? null,
        })),
      },
      mergeContracts: tree.mergeContracts
        .filter((mc) => edgeIds.has(mc.edgeId))
        .map((mc): MergeContractRefDto => ({ edgeId: mc.edgeId, path: mc.path })),
      objectives: tree.objectives
        .filter((o) => o.scope === 'TOPIC' && o.topic_id === doc.id)
        .map((o) => this.#objectiveDto(o)),
    }
  }

  async getWorkstream(args: GetWorkstreamArgs): Promise<WorkstreamSnapshot> {
    await this.#stalePrecheck(args.workstreamId)
    const tree = this.#loadTree('getWorkstream')
    const wsNode = this.#findWorkstreamNode(tree, args.workstreamId, 'getWorkstream')
    const doc = wsNode.doc
    if (doc === null) {
      throw new Error(`getWorkstream: workstream ${args.workstreamId} has no loadable workstream.yaml`)
    }
    const events = this.#wiring.store.listRange(wsNode.id, 1)
    const runs = this.#wiring.tables.listRuns({ workstreamId: wsNode.id })
    const runningByTask = new Map<string, string[]>()
    for (const r of runs) {
      if (r.status !== 'RUNNING' || r.task_id === undefined) continue
      const list = runningByTask.get(r.task_id) ?? []
      list.push(r.id)
      runningByTask.set(r.task_id, list)
    }
    // Current-zone state: the declarative definitions + the execution/
    // validation fold over the WS event log (the history replay face —
    // a read projection; the state machine itself is enforced at append
    // time, DOMAIN_SCHEMA §13). The Set guards below keep the payload
    // (validated against the frozen catalog at append) inside the wire
    // vocabulary.
    type TaskWireState = { execution: CurrentTaskDto['execution']; validation: CurrentTaskDto['validation'] }
    const initial = new Map<string, TaskWireState>()
    for (const t of wsNode.tasks) {
      const ac = t.doc === null ? [] : t.doc.acceptance_criteria
      initial.set(t.id, {
        execution: 'PLANNED',
        validation: ac.length > 0 ? 'PENDING' : 'NOT_REQUIRED',
      })
    }
    const folded = foldEvents(events, (state: Map<string, TaskWireState>, ev) => {
      if (ev.eventType === 'TASK_EXECUTION_CHANGED') {
        const p = ev.payload as { task_id?: unknown; to?: unknown }
        if (
          typeof p.task_id === 'string' &&
          typeof p.to === 'string' &&
          TASK_EXECUTIONS.has(p.to) &&
          state.has(p.task_id)
        ) {
          const cur = state.get(p.task_id)!
          state.set(p.task_id, { ...cur, execution: p.to as TaskWireState['execution'] })
        }
      } else if (ev.eventType === 'TASK_VALIDATION_CHANGED') {
        const p = ev.payload as { task_id?: unknown; to?: unknown }
        if (
          typeof p.task_id === 'string' &&
          typeof p.to === 'string' &&
          TASK_VALIDATIONS.has(p.to) &&
          state.has(p.task_id)
        ) {
          const cur = state.get(p.task_id)!
          state.set(p.task_id, { ...cur, validation: p.to as TaskWireState['validation'] })
        }
      }
      return state
    }, initial)
    const itemTitles = new Map<string, { kind: PlanItemDto['kind']; title: string }>()
    for (const t of wsNode.tasks) {
      itemTitles.set(t.id, { kind: 'TASK', title: t.doc === null ? '' : t.doc.title })
    }
    for (const g of wsNode.gates) {
      itemTitles.set(g.id, { kind: 'GATE', title: g.doc === null ? '' : g.doc.title })
    }
    for (const m of wsNode.milestones) {
      itemTitles.set(m.id, { kind: 'MILESTONE', title: m.doc === null ? '' : m.doc.title })
    }
    const planForks = this.#wiring.planForks
      .listPlanForks({ workstreamId: wsNode.id })
      .filter((pf) => pf.status === 'OPEN' || pf.status === 'STALE')
    return {
      workstream: {
        id: doc.id,
        topicId: doc.topic_id,
        title: doc.title,
        lifecycle: doc.lifecycle,
        summary: doc.summary ?? null,
        createdAt: doc.created_at,
      },
      history: { eventCount: events.length },
      current: {
        tasks: wsNode.tasks
          .filter((t) => t.doc !== null)
          .map((t) => {
            const doc2 = t.doc!
            const state = folded.get(t.id) ?? { execution: 'PLANNED', validation: 'NOT_REQUIRED' }
            return {
              id: doc2.id,
              title: doc2.title,
              execution: state.execution,
              validation: state.validation,
              acceptanceCriteria: [...doc2.acceptance_criteria],
              liveRunIds: [...(runningByTask.get(doc2.id) ?? [])],
            }
          }),
        runs: runs.map((r) => ({
          id: r.id,
          status: r.status,
          taskId: r.task_id ?? null,
          intent: r.intent ?? null,
          startedAt: r.started_at,
          endedAt: r.ended_at ?? null,
          lastCheckpointAt: r.last_checkpoint_at ?? null,
          lastCheckpointNote: r.last_checkpoint_note ?? null,
        })),
      },
      future: {
        plan: {
          orderedItems: (wsNode.plan?.ordered_items ?? []).map((id) => {
            const item = itemTitles.get(id)
            // A dangling plan.yaml reference is a load error (the loader
            // validates it) — unreachable after #loadTree succeeded.
            if (item === undefined) {
              throw new Error(`getWorkstream: plan item ${id} of ${wsNode.id} has no definition (loader should have rejected the tree)`)
            }
            return { id, kind: item.kind, title: item.title }
          }),
        },
        planForks: planForks.map((pf) => this.#planForkDto(pf)),
        unresolvedPlanForkCount: planForks.length,
      },
    }
  }

  /* ------------------------------------------------------------------ *
   * History query — the replay query face, verbatim (seq-cursor
   * pagination; the page is never truncated mid-window).
   * ------------------------------------------------------------------ */

  queryHistory(args: QueryHistoryArgs): QueryHistoryResult {
    const page = queryEvents(this.#wiring.store, args.workstreamId, {
      order: args.order,
      afterSeq: args.afterSeq,
      beforeSeq: args.beforeSeq,
      limit: args.limit,
    })
    return {
      events: page.events.map((ev) => this.#historyEventDto(ev)),
      nextAfterSeq: page.nextAfterSeq,
      exhausted: page.exhausted,
    }
  }

  /* ------------------------------------------------------------------ *
   * User-semantic mutations — thin delegation; the forwarded services
   * own the permission checks and the business rules.
   * ------------------------------------------------------------------ */

  reorderPlan(args: ReorderPlanArgs): ReorderPlanResult {
    const tree = this.#loadTree('reorderPlan')
    const wsNode = this.#findWorkstreamNode(tree, args.workstreamId, 'reorderPlan')
    const reader = new FsResearchReader(this.#wiring.researchRoot)
    const store = new PlanStore({
      reader,
      writer: new FsPlanFileWriter(),
      researchRoot: this.#wiring.researchRoot,
      schemaDir: this.#declarativeDir,
      topicId: wsNode.topicId,
      wsId: args.workstreamId,
    })
    const current = store.loadPlan()
    if (current.errors.length > 0) {
      throw new Error(`reorderPlan: the canonical plan of ${args.workstreamId} failed to load: ${current.errors[0]!.message}`)
    }
    // The RPC contract: a REORDER is the same item set in a new order
    // (insert/delete are NOT in the frozen 13-RPC list — the kernel's
    // §4.4 validations still guard the write itself).
    const currentSet = new Set(current.items)
    for (const id of args.orderedItemIds) {
      if (!currentSet.has(id)) {
        throw new Error(
          `reorderPlan: item ${id} is not in the canonical plan of ${args.workstreamId} ` +
            '— reorder keeps the same item set (insert/delete are not part of the V1 RPC face)',
        )
      }
    }
    if (new Set(args.orderedItemIds).size !== args.orderedItemIds.length) {
      throw new Error('reorderPlan: orderedItemIds contains duplicates (the kernel rejects them too — failing early)')
    }
    const previousOrder = [...current.items]
    // The kernel owns the write: §4.4 three validations + atomic file write.
    store.savePlan(args.orderedItemIds)
    // DOMAIN_SCHEMA §12.1: ResearchHistory does NOT record plan management
    // ops — the management_action ledger is the provenance face.
    const maRes = this.#wiring.allocator.reserve('MANAGEMENT_ACTION', this.#wiring.projectId)
    try {
      const ma: ManagementActionRecord = {
        id: maRes.id,
        action_kind: 'PLAN_REORDER',
        actor: USER_ACTOR,
        subject_refs: [{ kind: 'WORKSTREAM', id: args.workstreamId }],
        detail: `canonical plan of ${args.workstreamId} reordered: [${previousOrder.join(', ')}] -> [${args.orderedItemIds.join(', ')}]`,
        occurred_at: this.#now(),
      }
      this.#db.run(SQL_INSERT_MANAGEMENT_ACTION, ...managementActionToParams(ma))
      this.#wiring.allocator.commit(maRes)
    } catch (cause) {
      this.#wiring.allocator.release(maRes)
      throw new Error(
        `reorderPlan: the plan file was rewritten but the PLAN_REORDER ledger row failed — ` +
          `the order is on disk, the provenance row is missing (manual reconciliation): ` +
          (cause instanceof Error ? cause.message : String(cause)),
      )
    }
    // UI-0.4 (R-01): the frozen reorder guard is membership + dedup
    // only — a STRICT SUBSET of the current items passes it (the kernel
    // savePlan writes it), so a subset reorder can evict the current-
    // focus target from the canonical plan. The post-commit revalidate
    // is the R-01 auto-clear enforcement on that live path (best-effort
    // — the mutation contract stands; a same-set reorder retains the
    // pointer without rewriting the row).
    this.#revalidateCurrentFocus(args.workstreamId)
    return {
      workstreamId: args.workstreamId,
      orderedItemIds: [...args.orderedItemIds],
      planPath: `${wsNode.path}/plan.yaml`,
      managementActionId: maRes.id,
    }
  }

  async selectPlanFork(args: SelectPlanForkArgs): Promise<SelectPlanForkResult> {
    // WP-3.4 owns §6: base re-check → materialize → plan.yaml rewrite →
    // the single SELECTED transaction (chained STALE + PF_SELECTED ledger
    // with the NEW closure OIDs) → compensation on DB failure. It
    // re-asserts actor.kind === USER (INV-PERM-2).
    const outcome = await this.#select.select(args.planForkId, USER_ACTOR)
    // UI-0.4 (R-01): a SELECTED fork rewrites plan.yaml with a NEW
    // closure (items can be added/removed) — the current-focus target
    // may have left the canonical Plan; revalidate enforces the
    // auto-clear (best-effort — the selection outcome stands).
    this.#revalidateCurrentFocus(outcome.workstreamId)
    return {
      planForkId: outcome.pfId,
      workstreamId: outcome.workstreamId,
      statusBefore: outcome.statusBefore,
      statusAfter: outcome.statusAfter,
      selectedAt: outcome.selectedAt,
      oldOrder: [...outcome.oldOrder],
      newOrder: [...outcome.newOrder],
      newItems: outcome.newItems.map((i) => ({ id: i.id, kind: i.kind, path: i.path })),
      removedIds: [...outcome.removedIds],
      staleOthers: outcome.staleOthers.map((s) => ({ planForkId: s.pfId, staleReason: s.stale_reason })),
      planYamlPath: outcome.planYamlPath,
      checkpointHint: outcome.checkpointHint,
    }
  }

  async dismissPlanFork(args: DismissPlanForkArgs): Promise<DismissPlanForkResult> {
    // WP-3.4 §7: OPEN|STALE → DISMISSED (status change only — never a
    // delete, INV-PLAN-4); re-asserts actor.kind === USER.
    const outcome = this.#select.dismiss(args.planForkId, USER_ACTOR)
    return {
      planForkId: outcome.pfId,
      workstreamId: outcome.workstreamId,
      statusBefore: outcome.statusBefore,
      statusAfter: outcome.statusAfter,
      dismissedAt: outcome.dismissedAt,
    }
  }

  updateInterventionState(args: UpdateInterventionStateArgs): UpdateInterventionStateResult {
    // RR-017② (WP-6.4): re-route to the WP-5.1 InterventionService
    // (same §13 guard single source, same optimistic gate, 1:1 result
    // shape — the inline pre-route implementation is retired).
    return this.#intervention.updateState(args.interventionId, args.status, INTERVENTION_USER_ACTOR, args.resolutionNote)
  }

  async registerInteraction(args: RegisterInteractionArgs): Promise<RegisterInteractionResult> {
    // WP-5.3 (DOMAIN_SCHEMA §10.1): production registration through the
    // reporting service (interaction table on the user-surface second
    // connection; INT id allocation; no-delete/no-content-update triggers).
    // USER semantics — the client face IS the user face (ARCHITECTURE §6;
    // the §6 matrix has no AGENT row for Interaction recording).
    // §16 rule 2 (operational → declarative, write-time): related_workstreams
    // must name workstreams that exist in the declarative tree.
    const tree = this.#loadTree('registerInteraction')
    const wsIds = new Set(tree.topics.flatMap((t) => t.workstreams.map((w) => w.id)))
    for (const wsId of args.relatedWorkstreams ?? []) {
      if (!wsIds.has(wsId)) {
        throw new Error(
          `registerInteraction: related workstream ${wsId} does not exist ` +
            '(DOMAIN_SCHEMA §16 rule 2 — writing a new reference to a missing object is rejected)',
        )
      }
    }
    const { record, createdAt } = this.#reporting.registerInteraction({
      kind: args.kind,
      title: args.title,
      occurredAt: args.occurredAt,
      ...(args.participants !== undefined ? { participants: [...args.participants] } : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
      ...(args.relatedWorkstreams !== undefined ? { relatedWorkstreams: [...args.relatedWorkstreams] } : {}),
    })
    return {
      id: record.id,
      kind: record.kind,
      title: record.title,
      occurredAt: record.occurred_at,
      participants: [...(record.participants ?? [])],
      notes: record.notes ?? null,
      relatedWorkstreams: [...(record.related_workstreams ?? [])],
      createdAt,
    }
  }

  async saveResearchCheckpoint(args: SaveResearchCheckpointArgs): Promise<SaveResearchCheckpointResult> {
    // WP-1.5 §5 flow (user-triggered only — INV-GIT-2): repo detect →
    // conflict detection → `.research/**`-only pathspec (INV-GIT-3) →
    // commit; the no-change short-circuit is a success (no empty commit).
    const result = await saveResearchCheckpoint(this.#wiring.repoRoot, {
      summary: args.summary,
      logger: this.#logger,
      // V2 T3.2b: the W9/W10 pathspecs follow the plane's configured tree
      // name (the wiring was built over researchDir; default `.research`
      // keeps the frozen V1 argv byte-identical).
      treeDir: this.#wiring.researchDir,
    })
    return {
      committed: result.committed,
      commitOid: result.commitOid,
      changedFiles: [...result.changedFiles],
      warnings: [...result.warnings],
      message: result.message ?? null,
    }
  }

  async getGitHistory(args: GetGitHistoryArgs): Promise<GetGitHistoryResult> {
    const result = await diffHistory(this.#wiring.repoRoot, {
      logger: this.#logger,
      path: args.path,
      baseline: args.baseline,
      maxCount: args.maxCount,
      skip: args.skip,
      treeDir: this.#wiring.researchDir,
    })
    return {
      versions: result.versions.map((v) => ({ oid: v.oid, authorDate: v.authorDate, subject: v.subject })),
      fileDiff:
        result.fileDiff === undefined
          ? null
          : result.fileDiff.map((d) => ({ status: d.status, path: d.path, oldPath: d.oldPath ?? null })),
      baseline: result.baseline ?? null,
      pathContent:
        result.pathContent === undefined || result.pathContent === null
          ? null
          : { path: result.pathContent.path, sameAsBaseline: result.pathContent.sameAsBaseline },
    }
  }

  async restoreDeclarativeFile(args: RestoreDeclarativeFileArgs): Promise<RestoreDeclarativeFileResult> {
    // WP-1.5 §6 (user-triggered only — INV-GIT-5): W6 locate → W7 prefetch
    // → W8 restore → post-restore loader validation; illegal content is
    // KEPT as-is with warnings (no silent rollback).
    const result = await restoreResearchFile(this.#wiring.repoRoot, args.commitOid, args.path, {
      logger: this.#logger,
      schemaDir: this.#declarativeDir,
      treeDir: this.#wiring.researchDir,
    })
    return {
      path: result.path,
      commitOid: result.commitOid,
      validationOk: result.validation.ok,
      validationErrors: result.validation.errors.map((e) => ({
        file: e.file,
        path: e.path ?? null,
        summary: e.message,
      })),
      warnings: [...result.warnings],
    }
  }

  /* ------------------------------------------------------------------ *
   * Projections (record → wire DTO) + lookups
   * ------------------------------------------------------------------ */

  #loadTree(operation: string): ResearchTree {
    // V2-T3.2a: the read + fail-loud verdict live in loadResearchTreeOrThrow
    // (shared with the plane-read face — one tree-load discipline).
    return loadResearchTreeOrThrow(this.#wiring.researchRoot, this.#declarativeDir, operation)
  }

  #findWorkstreamNode(tree: ResearchTree, workstreamId: string, operation: string): WorkstreamNode {
    for (const topic of tree.topics) {
      const ws = topic.workstreams.find((w) => w.id === workstreamId)
      if (ws !== undefined) return ws
    }
    throw new Error(`${operation}: workstream ${workstreamId} does not exist`)
  }

  #topicCard(topic: TopicNode): TopicCardDto {
    if (topic.doc === null) {
      throw new Error(`topic ${topic.id} has no loadable topic.yaml (loader should have reported the error)`)
    }
    return {
      id: topic.id,
      title: topic.doc.title,
      workstreamCount: topic.workstreams.length,
    }
  }

  #objectiveDto(o: ObjectiveDoc): ObjectiveDto {
    return {
      id: o.id,
      scope: o.scope,
      statement: o.statement,
      status: o.status,
      priority: o.priority,
      targetDate: o.target_date ?? null,
    }
  }

  #interventionDto(iv: InterventionRecord): InterventionDto {
    return {
      id: iv.id,
      title: iv.title,
      origin: iv.origin,
      status: iv.status,
      workstreamIds: [...iv.workstream_ids],
      createdAt: iv.created_at,
    }
  }

  #workstreamCard(ws: WorkstreamNode): WorkstreamCardDto {
    if (ws.doc === null) {
      throw new Error(`workstream ${ws.id} has no loadable workstream.yaml (loader should have reported the error)`)
    }
    return {
      id: ws.id,
      title: ws.doc.title,
      lifecycle: ws.doc.lifecycle,
      summary: ws.doc.summary ?? null,
      planItemCount: ws.plan === null ? 0 : ws.plan.ordered_items.length,
      openPlanForkCount: this.#wiring.planForks.countOpen(ws.id),
      runningRunCount: this.#wiring.tables.listRuns({ workstreamId: ws.id, status: 'RUNNING' }).length,
    }
  }

  #planForkDto(pf: PlanForkRecord): PlanForkDto {
    return {
      id: pf.id,
      // The caller pre-filters to the unresolved overlay set (OPEN|STALE).
      status: pf.status === 'OPEN' ? 'OPEN' : 'STALE',
      reason: pf.reason,
      necessity: pf.necessity,
      forkAnchor: pf.fork_anchor,
      mergeAnchor: pf.merge_anchor,
      createdByRun: pf.created_by_run,
      createdAt: pf.created_at,
      staleReason: pf.stale_reason ?? null,
      proposedItemCount: pf.proposed_items.length,
      baseGitCommit: pf.base_git_commit ?? null,
    }
  }

  #historyEventDto(ev: HistoryEventRecord): HistoryEventDto {
    return {
      eventId: ev.eventId,
      ownerWorkstreamId: ev.ownerWorkstreamId,
      eventType: ev.eventType,
      schemaVersion: ev.schemaVersion,
      occurredAt: ev.occurredAt,
      actor: {
        kind: ev.actor.kind,
        ...(ev.actor.user_id !== undefined ? { user_id: ev.actor.user_id } : {}),
        ...(ev.actor.run_id !== undefined ? { run_id: ev.actor.run_id } : {}),
        ...(ev.actor.session_id !== undefined ? { session_id: ev.actor.session_id } : {}),
        ...(ev.actor.label !== undefined ? { label: ev.actor.label } : {}),
      },
      source:
        ev.source === undefined || ev.source === null
          ? null
          : {
              kind: ev.source.kind,
              ...(ev.source.session_id !== undefined ? { session_id: ev.source.session_id } : {}),
              ...(ev.source.path !== undefined ? { path: ev.source.path } : {}),
              ...(ev.source.commit_oid !== undefined ? { commit_oid: ev.source.commit_oid } : {}),
              ...(ev.source.interaction_id !== undefined ? { interaction_id: ev.source.interaction_id } : {}),
              ...(ev.source.note !== undefined ? { note: ev.source.note } : {}),
            },
      payload: ev.payload,
      eventSeq: ev.eventSeq,
      recordedAt: ev.recordedAt,
    }
  }
}

/* -------------------------------------------------------------------- *
 * The read-only canonical plan provider (the select service's §6.1
 * re-check face — fresh read, no cache; the same composition the wiring
 * uses for its own planfork creation flow).
 * -------------------------------------------------------------------- */

/** A plan writer that refuses: the provider is READ-ONLY by construction. */
const REJECTING_PLAN_WRITER = {
  writeAtomic(_path: string): void {
    throw new Error('the RPC face plan provider is read-only (writeAtomic)')
  },
}

function makeReadonlyPlanProvider(input: {
  readonly reader: ResearchFileReader
  readonly researchRoot: string
  readonly declarativeDir: string
}): CanonicalPlanProvider {
  return {
    load(workstreamId: string) {
      const topics = input.reader.readDir(join(input.researchRoot, 'topics'))
      if (topics === null) return absentPlanView(workstreamId, '')
      for (const t of topics) {
        if (t.kind !== 'directory') continue
        const wsDirRel = `topics/${t.name}/workstreams/${workstreamId}`
        if (input.reader.readDir(join(input.researchRoot, wsDirRel)) === null) continue
        try {
          const ps = new PlanStore({
            reader: input.reader,
            writer: REJECTING_PLAN_WRITER,
            researchRoot: input.researchRoot,
            schemaDir: input.declarativeDir,
            topicId: t.name,
            wsId: workstreamId,
          })
          const view = ps.loadPlan()
          const problem = view.errors.length > 0 ? view.errors[0]!.message : undefined
          return {
            workstream_id: workstreamId,
            wsDir: wsDirRel,
            workstream_exists: true,
            present: view.present,
            ordered_items: view.items,
            consistent: view.errors.length === 0,
            ...(problem !== undefined ? { problem } : {}),
          }
        } catch (cause) {
          return absentPlanView(workstreamId, wsDirRel, cause instanceof Error ? cause.message : String(cause))
        }
      }
      return absentPlanView(workstreamId, '')
    },
  }
}

function absentPlanView(workstreamId: string, wsDir: string, problem?: string): CanonicalPlanView {
  return {
    workstream_id: workstreamId,
    wsDir,
    workstream_exists: false,
    present: false,
    ordered_items: [],
    consistent: false,
    ...(problem !== undefined ? { problem } : {}),
  }
}
