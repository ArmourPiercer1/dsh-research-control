/**
 * Client mount half for the research remotes (WP-0.3 RPC spike).
 *
 * Chosen form (per WP-0.3 brief, option 2): `mountResearchRemotes(ctx)` is
 * a plain function the WP-0.5 client entry calls from its own `apply` —
 * the entry (a functional client plugin) declares `'remote'` in its own
 * `inject` list, so its fiber waits for the gateway's `remote` service
 * before this runs (DSH_ADAPTER §4 PENDING semantics). A separate
 * name/inject/apply plugin form was rejected: it would nest a child plugin
 * fiber purely for a one-call mount, and the entry already owns the inject
 * declaration.
 *
 * Disposer semantics (gateway client half, checkout
 * packages/api/gateway/src/client/index.ts `$mount`): the mount is
 * registered as an effect on the CALLER's own fiber
 * (`callerCtx.effect(...)`), so fiber unmount rolls the mount back
 * automatically — the installed `researchControl` namespace service is
 * uninstalled and the remote contribution withdrawn. The returned
 * `TypertDisposer` is only needed for an explicit early unmount before the
 * fiber goes away; the WP-0.5 entry may hold or discard it.
 *
 * This file is client-dsh-adapter territory: it may import
 * `@deepseek-ai/*` (INV-PERM-5 exempt set).
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  RemoteResult,
  TypertClientRemote,
  TypertDisposer,
  TypertRemoteNamespaceMap,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
  AckMissingReminderArgs,
  AckMissingReminderResult,
  AddDependencyArgs,
  AddDependencyResult,
  AddRelationArgs,
  AddRelationResult,
  BindProjectArgs,
  BindProjectResult,
  ClearBlockerArgs,
  ClearBlockerResult,
  CreateBlockerArgs,
  CreateBlockerResult,
  CreateLocalResearchProjectArgs,
  CreateLocalResearchProjectResult,
  CreateNextActionArgs,
  CreateNextActionResult,
  CreatePlanItemArgs,
  CreatePlanItemResult,
  CreatePlannedMergeArgs,
  CreatePlannedMergeResult,
  CreateTopicArgs,
  CreateTopicResult,
  CreateWorkstreamArgs,
  CreateWorkstreamResult,
  CreateWorkstreamForkArgs,
  CreateWorkstreamForkResult,
  DashboardSnapshot,
  DismissNextActionArgs,
  DismissNextActionResult,
  DismissPlanForkArgs,
  DismissPlanForkResult,
  DropTopologyEdgeArgs,
  DropTopologyEdgeResult,
  DropWorkstreamArgs,
  DropWorkstreamResult,
  GetCurrentFocusArgs,
  GetCurrentFocusResult,
  GetGitHistoryArgs,
  GetGitHistoryResult,
  GetHubOverviewArgs,
  GetMergeContractArgs,
  GetMergeContractResult,
  GetPortfolioInterventionsArgs,
  GetPortfolioInterventionsResult,
  GetResearchPlaneStateArgs,
  GetResearchPlaneStateResult,
  GetTopicArgs,
  GetWorkstreamArgs,
  GetWorkstreamCurrentArgs,
  GetWorkstreamCurrentResult,
  HubOverviewResult,
  InspectProjectDirectoryArgs,
  InspectProjectDirectoryResult,
  MarkArtifactMissingArgs,
  MarkArtifactMissingResult,
  PingResult,
  ProjectSnapshot,
  PromoteNextActionArgs,
  PromoteNextActionResult,
  QueryHistoryArgs,
  QueryHistoryResult,
  QueryRecordsArgs,
  QueryRecordsResult,
  RecordClaimArgs,
  RecordClaimResult,
  RecordFactArgs,
  RecordFactResult,
  RegisterArtifactArgs,
  RegisterArtifactResult,
  RemoveDependencyArgs,
  RemoveDependencyResult,
  RemovePlanItemArgs,
  RemovePlanItemResult,
  RemoveRelationArgs,
  RemoveRelationResult,
  ReorderPlanArgs,
  ReorderPlanResult,
  RegisterInteractionArgs,
  RegisterInteractionResult,
  RetractClaimArgs,
  RetractClaimResult,
  RescanArgs,
  RescanResult,
  RestoreDeclarativeFileArgs,
  RestoreDeclarativeFileResult,
  RestoreProjectArgs,
  RestoreProjectResult,
  SaveMergeContractArgs,
  SaveMergeContractResult,
  SaveResearchCheckpointArgs,
  SaveResearchCheckpointResult,
  SelectPlanForkArgs,
  SelectPlanForkResult,
  SetCurrentFocusArgs,
  SetCurrentFocusResult,
  SetHubArgs,
  SetHubResult,
  TopicSnapshot,
  UnbindProjectArgs,
  UnbindProjectResult,
  UpdateInterventionStateArgs,
  UpdateInterventionStateResult,
  UpdateObjectiveArgs,
  UpdateObjectiveResult,
  UpdatePlanItemArgs,
  UpdatePlanItemResult,
  UpdateProjectMetadataArgs,
  UpdateProjectMetadataResult,
  UpdateTopicArgs,
  UpdateTopicResult,
  UpdateWorkstreamArgs,
  UpdateWorkstreamResult,
  WorkstreamSnapshot,
} from '../../../shared/rpc-contracts.js'
import { researchRemotes } from './contribution.js'

/**
 * Structural stand-in for the gateway client's `remote` service: the base
 * layer's d.ts (dsh-api-gateway `./client`) augments the cordis Context
 * with `remote: ClientRemote` (ClientRemote = TypertClientRemote); this WP
 * deliberately does not devDep on that package, so the property is declared
 * here. The `researchControl` namespace member is typed through the
 * `TypertRemoteNamespaceMap` module augmentation in `contribution.ts`.
 * The WP-0.5 client entry passes its own (fully injected) context against
 * this type.
 */
export type RemoteContext = Context & { remote: TypertClientRemote }

/**
 * The mounted namespace service, captured directly from the cordis reflect
 * store (see `mountResearchRemotes` for why the context-proxy path cannot be
 * used from this plugin's own fiber).
 */
let boundNamespace: unknown

/**
 * Mount the research contribution in `ctx`'s fiber, bind the `researchRpc`
 * facade, and CAPTURE the mounted namespace service.
 *
 * Why the capture: the namespace is registered by the gateway client as a
 * cordis service keyed `remote.researchControl` inside a CHILD fiber of the
 * client root (the `$mount` plugin fiber) — a SIBLING of this plugin's own
 * fiber. The context-proxy path (`ctx.remote.researchControl`) resolves that
 * key by walking the CALLER fiber's ancestry (vendor/cordis reflect.ts
 * handler), so a plugin fiber that does not declare `remote.researchControl`
 * in its OWN inject list can never see it. This plugin cannot declare it:
 * the service only exists after THIS mount runs, and the fiber waits for its
 * inject list before its apply (declaring it would deadlock the fiber).
 * The shipped harness plugins avoid the problem because the client ASSEMBLY
 * (`packages/api/remotes`) mounts their contributions before their fibers
 * start. The capture below uses `ctx.reflect.get(key, false)` — the
 * non-strict GLOBAL reflect-store lookup the cordis reflect handler itself
 * falls back to — which resolves across fibers. (Test injection keeps the
 * `ctx.remote.researchControl` fallback for stub contexts without a reflect
 * service.)
 *
 * The returned disposer withdraws the exact contribution; see the module
 * header for fiber-owned rollback.
 */
export async function mountResearchRemotes(ctx: RemoteContext): Promise<TypertDisposer> {
  const dispose = await ctx.remote.$mount(researchRemotes)
  // Arrow-function-type spelling (not a method signature): the TS 7 native
  // parser in this workspace rejects the `get?: (…): T` property-function
  // form inside type literals.
  const reflect = (ctx as unknown as {
    reflect?: { get?: (name: string, strict?: boolean) => unknown }
  }).reflect
  const fromReflect = typeof reflect?.get === 'function' ? reflect.get('remote.researchControl', false) : undefined
  boundNamespace = fromReflect ?? (ctx.remote as unknown as { researchControl?: unknown }).researchControl
  return dispose
}

/** Drop the facade binding (the fiber's own rollback is unaffected). */
export function unmountResearchRemotes(): void {
  boundNamespace = undefined
}

/**
 * The pre-mount guard: every facade method rejects loudly when the mount
 * has not run yet (or has been unmounted).
 */
function requireNamespace(): TypertRemoteNamespaceMap['researchControl'] {
  if (boundNamespace === undefined) {
    throw new Error('researchRpc: not mounted — call mountResearchRemotes(ctx) first')
  }
  return boundNamespace as TypertRemoteNamespaceMap['researchControl']
}

/**
 * Typed client RPC facade over the mounted namespace methods.
 *
 * The call surface is exactly the generated remote-client signature for a
 * direct descriptor with no cancellation: `namespace.<method>(args)`
 * resolving to `RemoteResult<T>` (the carrier folds host-side failures
 * into the `ok: false` branch; only assembly faults reject). There is
 * deliberately NO signal parameter: no descriptor declares
 * `cancellation`, and the gateway client rejects a trailing argument for
 * such descriptors (arity check in client/src/client/index.ts `invoke()`;
 * the generator emits `signal?: AbortSignal` only when cancellation is
 * declared). WP-4.1a: ping + the 13 §7.1 RPCs (WP-4.1b builds the
 * createXXXStore factories on top of this facade). V2-T4.1: + the 9 plane
 * RPCs (design §12 rows 1-6/8/9 — the V2 tab shell drives row 1, the P5
 * pages the rest; same conventions, PLANE-LEVEL, not per-project).
 * UI-0.4: + the 2 GUI management RPCs (the current-focus pair, R-01 —
 * project-routed like the rest of the management face). V2-UI-0.4 UI-2:
 * + the 6 GUI management RPCs (4 hierarchy update/drop + 2 local-project;
 * see the inline note below). V2-UI-0.4 UI-3: + the 2 hierarchy CREATE
 * RPCs (createTopic/createWorkstream — the host faces pre-existed and
 * the generated namespace map already exposes them; only this client
 * facade wiring is new).
 */
export const researchRpc = {
  async ping(): Promise<RemoteResult<PingResult>> {
    return requireNamespace().ping()
  },
  async getDashboard(): Promise<RemoteResult<DashboardSnapshot>> {
    return requireNamespace().getDashboard()
  },
  async getProject(): Promise<RemoteResult<ProjectSnapshot>> {
    return requireNamespace().getProject()
  },
  async getTopic(args: GetTopicArgs): Promise<RemoteResult<TopicSnapshot>> {
    return requireNamespace().getTopic(args)
  },
  async getWorkstream(args: GetWorkstreamArgs): Promise<RemoteResult<WorkstreamSnapshot>> {
    return requireNamespace().getWorkstream(args)
  },
  async queryHistory(args: QueryHistoryArgs): Promise<RemoteResult<QueryHistoryResult>> {
    return requireNamespace().queryHistory(args)
  },
  async reorderPlan(args: ReorderPlanArgs): Promise<RemoteResult<ReorderPlanResult>> {
    return requireNamespace().reorderPlan(args)
  },
  async selectPlanFork(args: SelectPlanForkArgs): Promise<RemoteResult<SelectPlanForkResult>> {
    return requireNamespace().selectPlanFork(args)
  },
  async dismissPlanFork(args: DismissPlanForkArgs): Promise<RemoteResult<DismissPlanForkResult>> {
    return requireNamespace().dismissPlanFork(args)
  },
  async updateInterventionState(
    args: UpdateInterventionStateArgs,
  ): Promise<RemoteResult<UpdateInterventionStateResult>> {
    return requireNamespace().updateInterventionState(args)
  },
  async registerInteraction(
    args: RegisterInteractionArgs,
  ): Promise<RemoteResult<RegisterInteractionResult>> {
    return requireNamespace().registerInteraction(args)
  },
  async saveResearchCheckpoint(
    args: SaveResearchCheckpointArgs,
  ): Promise<RemoteResult<SaveResearchCheckpointResult>> {
    return requireNamespace().saveResearchCheckpoint(args)
  },
  async getGitHistory(args: GetGitHistoryArgs): Promise<RemoteResult<GetGitHistoryResult>> {
    return requireNamespace().getGitHistory(args)
  },
  async restoreDeclarativeFile(
    args: RestoreDeclarativeFileArgs,
  ): Promise<RemoteResult<RestoreDeclarativeFileResult>> {
    return requireNamespace().restoreDeclarativeFile(args)
  },
  // V2-T4.1: the 9 plane RPCs (design §12 rows 1-6/8/9) join the facade —
  // the 23-endpoint face matches the contribution's descriptor set exactly.
  async getResearchPlaneState(
    args: GetResearchPlaneStateArgs,
  ): Promise<RemoteResult<GetResearchPlaneStateResult>> {
    return requireNamespace().getResearchPlaneState(args)
  },
  async getHubOverview(args: GetHubOverviewArgs): Promise<RemoteResult<HubOverviewResult>> {
    return requireNamespace().getHubOverview(args)
  },
  async getPortfolioInterventions(
    args: GetPortfolioInterventionsArgs,
  ): Promise<RemoteResult<GetPortfolioInterventionsResult>> {
    return requireNamespace().getPortfolioInterventions(args)
  },
  async setHub(args: SetHubArgs): Promise<RemoteResult<SetHubResult>> {
    return requireNamespace().setHub(args)
  },
  async bindProject(args: BindProjectArgs): Promise<RemoteResult<BindProjectResult>> {
    return requireNamespace().bindProject(args)
  },
  async unbindProject(args: UnbindProjectArgs): Promise<RemoteResult<UnbindProjectResult>> {
    return requireNamespace().unbindProject(args)
  },
  async restoreProject(args: RestoreProjectArgs): Promise<RemoteResult<RestoreProjectResult>> {
    return requireNamespace().restoreProject(args)
  },
  async rescan(args: RescanArgs): Promise<RemoteResult<RescanResult>> {
    return requireNamespace().rescan(args)
  },
  async ackMissingReminder(
    args: AckMissingReminderArgs,
  ): Promise<RemoteResult<AckMissingReminderResult>> {
    return requireNamespace().ackMissingReminder(args)
  },
  // UI-0.4 (R-01): the GUI management face — the current-focus pair.
  async setCurrentFocus(
    args: SetCurrentFocusArgs,
  ): Promise<RemoteResult<SetCurrentFocusResult>> {
    return requireNamespace().setCurrentFocus(args)
  },
  async getCurrentFocus(args: GetCurrentFocusArgs): Promise<RemoteResult<GetCurrentFocusResult>> {
    return requireNamespace().getCurrentFocus(args)
  },
  // V2-UI-0.4 UI-2: the 6 GUI management RPCs — the 4 hierarchy
  // update/drop faces (UI-2A, project-routed on the host) + the 2
  // local-project faces (UI-2B, plane-level on the host). Thin bodies:
  // the gateway folds host faults into RemoteResult.error.
  async updateProjectMetadata(
    args: UpdateProjectMetadataArgs,
  ): Promise<RemoteResult<UpdateProjectMetadataResult>> {
    return requireNamespace().updateProjectMetadata(args)
  },
  async updateTopic(args: UpdateTopicArgs): Promise<RemoteResult<UpdateTopicResult>> {
    return requireNamespace().updateTopic(args)
  },
  async updateWorkstream(args: UpdateWorkstreamArgs): Promise<RemoteResult<UpdateWorkstreamResult>> {
    return requireNamespace().updateWorkstream(args)
  },
  async dropWorkstream(args: DropWorkstreamArgs): Promise<RemoteResult<DropWorkstreamResult>> {
    return requireNamespace().dropWorkstream(args)
  },
  async inspectProjectDirectory(
    args: InspectProjectDirectoryArgs,
  ): Promise<RemoteResult<InspectProjectDirectoryResult>> {
    return requireNamespace().inspectProjectDirectory(args)
  },
  async createLocalResearchProject(
    args: CreateLocalResearchProjectArgs,
  ): Promise<RemoteResult<CreateLocalResearchProjectResult>> {
    return requireNamespace().createLocalResearchProject(args)
  },
  // V2-UI-0.4 UI-3: the 2 hierarchy CREATE RPCs — the host faces
  // pre-existed (the generated namespace map already carries them);
  // this facade wiring is what the UI-3 store mutations use. Thin
  // bodies: the gateway folds host faults into RemoteResult.error.
  async createTopic(args: CreateTopicArgs): Promise<RemoteResult<CreateTopicResult>> {
    return requireNamespace().createTopic(args)
  },
  async createWorkstream(
    args: CreateWorkstreamArgs,
  ): Promise<RemoteResult<CreateWorkstreamResult>> {
    return requireNamespace().createWorkstream(args)
  },
  // V2-UI-0.4 UI-4 (D §10): the 7 attention RPCs — the CurrentExecution
  // projection read + the objective/next-action/blocker mutation faces.
  // Thin bodies: the gateway folds host faults into RemoteResult.error.
  async getWorkstreamCurrent(
    args: GetWorkstreamCurrentArgs,
  ): Promise<RemoteResult<GetWorkstreamCurrentResult>> {
    return requireNamespace().getWorkstreamCurrent(args)
  },
  async updateObjective(
    args: UpdateObjectiveArgs,
  ): Promise<RemoteResult<UpdateObjectiveResult>> {
    return requireNamespace().updateObjective(args)
  },
  async createNextAction(
    args: CreateNextActionArgs,
  ): Promise<RemoteResult<CreateNextActionResult>> {
    return requireNamespace().createNextAction(args)
  },
  async promoteNextAction(
    args: PromoteNextActionArgs,
  ): Promise<RemoteResult<PromoteNextActionResult>> {
    return requireNamespace().promoteNextAction(args)
  },
  async dismissNextAction(
    args: DismissNextActionArgs,
  ): Promise<RemoteResult<DismissNextActionResult>> {
    return requireNamespace().dismissNextAction(args)
  },
  async createBlocker(
    args: CreateBlockerArgs,
  ): Promise<RemoteResult<CreateBlockerResult>> {
    return requireNamespace().createBlocker(args)
  },
  async clearBlocker(
    args: ClearBlockerArgs,
  ): Promise<RemoteResult<ClearBlockerResult>> {
    return requireNamespace().clearBlocker(args)
  },
  async createPlanItem(
    args: CreatePlanItemArgs,
  ): Promise<RemoteResult<CreatePlanItemResult>> {
    return requireNamespace().createPlanItem(args)
  },
  async updatePlanItem(
    args: UpdatePlanItemArgs,
  ): Promise<RemoteResult<UpdatePlanItemResult>> {
    return requireNamespace().updatePlanItem(args)
  },
  async removePlanItem(
    args: RemovePlanItemArgs,
  ): Promise<RemoteResult<RemovePlanItemResult>> {
    return requireNamespace().removePlanItem(args)
  },
  async addDependency(
    args: AddDependencyArgs,
  ): Promise<RemoteResult<AddDependencyResult>> {
    return requireNamespace().addDependency(args)
  },
  async removeDependency(
    args: RemoveDependencyArgs,
  ): Promise<RemoteResult<RemoveDependencyResult>> {
    return requireNamespace().removeDependency(args)
  },
  async createWorkstreamFork(
    args: CreateWorkstreamForkArgs,
  ): Promise<RemoteResult<CreateWorkstreamForkResult>> {
    return requireNamespace().createWorkstreamFork(args)
  },
  async createPlannedMerge(
    args: CreatePlannedMergeArgs,
  ): Promise<RemoteResult<CreatePlannedMergeResult>> {
    return requireNamespace().createPlannedMerge(args)
  },
  async getMergeContract(
    args: GetMergeContractArgs,
  ): Promise<RemoteResult<GetMergeContractResult>> {
    return requireNamespace().getMergeContract(args)
  },
  async saveMergeContract(
    args: SaveMergeContractArgs,
  ): Promise<RemoteResult<SaveMergeContractResult>> {
    return requireNamespace().saveMergeContract(args)
  },
  async dropTopologyEdge(
    args: DropTopologyEdgeArgs,
  ): Promise<RemoteResult<DropTopologyEdgeResult>> {
    return requireNamespace().dropTopologyEdge(args)
  },
  async recordFact(args: RecordFactArgs): Promise<RemoteResult<RecordFactResult>> {
    return requireNamespace().recordFact(args)
  },
  async recordClaim(
    args: RecordClaimArgs,
  ): Promise<RemoteResult<RecordClaimResult>> {
    return requireNamespace().recordClaim(args)
  },
  async retractClaim(
    args: RetractClaimArgs,
  ): Promise<RemoteResult<RetractClaimResult>> {
    return requireNamespace().retractClaim(args)
  },
  async registerArtifact(
    args: RegisterArtifactArgs,
  ): Promise<RemoteResult<RegisterArtifactResult>> {
    return requireNamespace().registerArtifact(args)
  },
  async markArtifactMissing(
    args: MarkArtifactMissingArgs,
  ): Promise<RemoteResult<MarkArtifactMissingResult>> {
    return requireNamespace().markArtifactMissing(args)
  },
  async addRelation(args: AddRelationArgs): Promise<RemoteResult<AddRelationResult>> {
    return requireNamespace().addRelation(args)
  },
  async removeRelation(
    args: RemoveRelationArgs,
  ): Promise<RemoteResult<RemoveRelationResult>> {
    return requireNamespace().removeRelation(args)
  },
  async queryRecords(
    args: QueryRecordsArgs,
  ): Promise<RemoteResult<QueryRecordsResult>> {
    return requireNamespace().queryRecords(args)
  },
}
