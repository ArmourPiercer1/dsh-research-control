import { $ as InspectProjectDirectoryResult, $t as UpdatePlanItemResult, A as DismissPlanForkArgs, At as RestoreProjectArgs, B as GetHubOverviewArgs, Bt as SetCurrentFocusArgs, C as CreateWorkstreamArgs, Ct as RemoveRelationResult, D as DashboardSnapshot, Dt as RescanResult, E as CreateWorkstreamResult, Et as RescanArgs, F as DropWorkstreamResult, Ft as SaveMergeContractResult, G as GetResearchPlaneStateArgs, H as GetMergeContractResult, Ht as SetHubArgs, I as GetCurrentFocusArgs, It as SaveResearchCheckpointArgs, J as GetWorkstreamArgs, Jt as UpdateInterventionStateArgs, K as GetResearchPlaneStateResult, Kt as UnbindProjectArgs, L as GetCurrentFocusResult, Lt as SaveResearchCheckpointResult, M as DropTopologyEdgeArgs, Mt as RetractClaimArgs, N as DropTopologyEdgeResult, Nt as RetractClaimResult, O as DismissNextActionArgs, Ot as RestoreDeclarativeFileArgs, P as DropWorkstreamArgs, Pt as SaveMergeContractArgs, Q as InspectProjectDirectoryArgs, Qt as UpdatePlanItemArgs, R as GetGitHistoryArgs, Rt as SelectPlanForkArgs, S as CreateTopicResult, St as RemoveRelationArgs, T as CreateWorkstreamForkResult, Tt as ReorderPlanResult, U as GetPortfolioInterventionsArgs, Ut as SetHubResult, V as GetMergeContractArgs, Vt as SetCurrentFocusResult, W as GetPortfolioInterventionsResult, Wt as TopicSnapshot, X as GetWorkstreamCurrentResult, Xt as UpdateObjectiveArgs, Y as GetWorkstreamCurrentArgs, Yt as UpdateInterventionStateResult, Z as HubOverviewResult, Zt as UpdateObjectiveResult, _ as CreatePlanItemArgs, _t as RegisterInteractionResult, a as AddRelationArgs, an as UpdateWorkstreamResult, at as PromoteNextActionResult, b as CreatePlannedMergeResult, bt as RemovePlanItemArgs, c as BindProjectResult, ct as QueryRecordsArgs, d as CreateBlockerArgs, dt as RecordClaimResult, en as UpdateProjectMetadataArgs, et as MarkArtifactMissingArgs, f as CreateBlockerResult, ft as RecordFactArgs, g as CreateNextActionResult, gt as RegisterInteractionArgs, h as CreateNextActionArgs, ht as RegisterArtifactResult, i as AddDependencyResult, in as UpdateWorkstreamArgs, it as PromoteNextActionArgs, j as DismissPlanForkResult, jt as RestoreProjectResult, k as DismissNextActionResult, kt as RestoreDeclarativeFileResult, l as ClearBlockerArgs, lt as QueryRecordsResult, m as CreateLocalResearchProjectResult, mt as RegisterArtifactArgs, n as AckMissingReminderResult, nn as UpdateTopicArgs, nt as PingResult, o as AddRelationResult, on as WorkstreamSnapshot, ot as QueryHistoryArgs, p as CreateLocalResearchProjectArgs, pt as RecordFactResult, q as GetTopicArgs, qt as UnbindProjectResult, r as AddDependencyArgs, rn as UpdateTopicResult, rt as ProjectSnapshot, s as BindProjectArgs, st as QueryHistoryResult, t as AckMissingReminderArgs, tn as UpdateProjectMetadataResult, tt as MarkArtifactMissingResult, u as ClearBlockerResult, ut as RecordClaimArgs, v as CreatePlanItemResult, vt as RemoveDependencyArgs, w as CreateWorkstreamForkArgs, wt as ReorderPlanArgs, x as CreateTopicArgs, xt as RemovePlanItemResult, y as CreatePlannedMergeArgs, yt as RemoveDependencyResult, z as GetGitHistoryResult, zt as SelectPlanForkResult } from "./rpc-contracts-2FQsZJVd.js";
import { RemoteResult, TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";
//#region src/client/dsh-adapter/remote/contribution.d.ts
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'researchControl/ping': () => Promise<RemoteResult<PingResult>>;
    'researchControl/getDashboard': () => Promise<RemoteResult<DashboardSnapshot>>;
    'researchControl/getProject': () => Promise<RemoteResult<ProjectSnapshot>>;
    'researchControl/getTopic': (args: GetTopicArgs) => Promise<RemoteResult<TopicSnapshot>>;
    'researchControl/getWorkstream': (args: GetWorkstreamArgs) => Promise<RemoteResult<WorkstreamSnapshot>>;
    'researchControl/queryHistory': (args: QueryHistoryArgs) => Promise<RemoteResult<QueryHistoryResult>>;
    'researchControl/reorderPlan': (args: ReorderPlanArgs) => Promise<RemoteResult<ReorderPlanResult>>;
    'researchControl/selectPlanFork': (args: SelectPlanForkArgs) => Promise<RemoteResult<SelectPlanForkResult>>;
    'researchControl/dismissPlanFork': (args: DismissPlanForkArgs) => Promise<RemoteResult<DismissPlanForkResult>>;
    'researchControl/updateInterventionState': (args: UpdateInterventionStateArgs) => Promise<RemoteResult<UpdateInterventionStateResult>>;
    'researchControl/registerInteraction': (args: RegisterInteractionArgs) => Promise<RemoteResult<RegisterInteractionResult>>;
    'researchControl/saveResearchCheckpoint': (args: SaveResearchCheckpointArgs) => Promise<RemoteResult<SaveResearchCheckpointResult>>;
    'researchControl/getGitHistory': (args: GetGitHistoryArgs) => Promise<RemoteResult<GetGitHistoryResult>>;
    'researchControl/restoreDeclarativeFile': (args: RestoreDeclarativeFileArgs) => Promise<RemoteResult<RestoreDeclarativeFileResult>>;
    'researchControl/getResearchPlaneState': (args: GetResearchPlaneStateArgs) => Promise<RemoteResult<GetResearchPlaneStateResult>>;
    'researchControl/getHubOverview': (args: GetHubOverviewArgs) => Promise<RemoteResult<HubOverviewResult>>;
    'researchControl/getPortfolioInterventions': (args: GetPortfolioInterventionsArgs) => Promise<RemoteResult<GetPortfolioInterventionsResult>>;
    'researchControl/setHub': (args: SetHubArgs) => Promise<RemoteResult<SetHubResult>>;
    'researchControl/bindProject': (args: BindProjectArgs) => Promise<RemoteResult<BindProjectResult>>;
    'researchControl/unbindProject': (args: UnbindProjectArgs) => Promise<RemoteResult<UnbindProjectResult>>;
    'researchControl/restoreProject': (args: RestoreProjectArgs) => Promise<RemoteResult<RestoreProjectResult>>;
    'researchControl/rescan': (args: RescanArgs) => Promise<RemoteResult<RescanResult>>;
    'researchControl/ackMissingReminder': (args: AckMissingReminderArgs) => Promise<RemoteResult<AckMissingReminderResult>>;
    'researchControl/setCurrentFocus': (args: SetCurrentFocusArgs) => Promise<RemoteResult<SetCurrentFocusResult>>;
    'researchControl/getCurrentFocus': (args: GetCurrentFocusArgs) => Promise<RemoteResult<GetCurrentFocusResult>>;
    'researchControl/createTopic': (args: CreateTopicArgs) => Promise<RemoteResult<CreateTopicResult>>;
    'researchControl/createWorkstream': (args: CreateWorkstreamArgs) => Promise<RemoteResult<CreateWorkstreamResult>>;
    'researchControl/updateProjectMetadata': (args: UpdateProjectMetadataArgs) => Promise<RemoteResult<UpdateProjectMetadataResult>>;
    'researchControl/updateTopic': (args: UpdateTopicArgs) => Promise<RemoteResult<UpdateTopicResult>>;
    'researchControl/updateWorkstream': (args: UpdateWorkstreamArgs) => Promise<RemoteResult<UpdateWorkstreamResult>>;
    'researchControl/dropWorkstream': (args: DropWorkstreamArgs) => Promise<RemoteResult<DropWorkstreamResult>>;
    'researchControl/inspectProjectDirectory': (args: InspectProjectDirectoryArgs) => Promise<RemoteResult<InspectProjectDirectoryResult>>;
    'researchControl/createLocalResearchProject': (args: CreateLocalResearchProjectArgs) => Promise<RemoteResult<CreateLocalResearchProjectResult>>;
    'researchControl/getWorkstreamCurrent': (args: GetWorkstreamCurrentArgs) => Promise<RemoteResult<GetWorkstreamCurrentResult>>;
    'researchControl/updateObjective': (args: UpdateObjectiveArgs) => Promise<RemoteResult<UpdateObjectiveResult>>;
    'researchControl/createNextAction': (args: CreateNextActionArgs) => Promise<RemoteResult<CreateNextActionResult>>;
    'researchControl/promoteNextAction': (args: PromoteNextActionArgs) => Promise<RemoteResult<PromoteNextActionResult>>;
    'researchControl/dismissNextAction': (args: DismissNextActionArgs) => Promise<RemoteResult<DismissNextActionResult>>;
    'researchControl/createBlocker': (args: CreateBlockerArgs) => Promise<RemoteResult<CreateBlockerResult>>;
    'researchControl/clearBlocker': (args: ClearBlockerArgs) => Promise<RemoteResult<ClearBlockerResult>>;
    'researchControl/createPlanItem': (args: CreatePlanItemArgs) => Promise<RemoteResult<CreatePlanItemResult>>;
    'researchControl/updatePlanItem': (args: UpdatePlanItemArgs) => Promise<RemoteResult<UpdatePlanItemResult>>;
    'researchControl/removePlanItem': (args: RemovePlanItemArgs) => Promise<RemoteResult<RemovePlanItemResult>>;
    'researchControl/addDependency': (args: AddDependencyArgs) => Promise<RemoteResult<AddDependencyResult>>;
    'researchControl/removeDependency': (args: RemoveDependencyArgs) => Promise<RemoteResult<RemoveDependencyResult>>;
    'researchControl/createWorkstreamFork': (args: CreateWorkstreamForkArgs) => Promise<RemoteResult<CreateWorkstreamForkResult>>;
    'researchControl/createPlannedMerge': (args: CreatePlannedMergeArgs) => Promise<RemoteResult<CreatePlannedMergeResult>>;
    'researchControl/getMergeContract': (args: GetMergeContractArgs) => Promise<RemoteResult<GetMergeContractResult>>;
    'researchControl/saveMergeContract': (args: SaveMergeContractArgs) => Promise<RemoteResult<SaveMergeContractResult>>;
    'researchControl/dropTopologyEdge': (args: DropTopologyEdgeArgs) => Promise<RemoteResult<DropTopologyEdgeResult>>;
    'researchControl/recordFact': (args: RecordFactArgs) => Promise<RemoteResult<RecordFactResult>>;
    'researchControl/recordClaim': (args: RecordClaimArgs) => Promise<RemoteResult<RecordClaimResult>>;
    'researchControl/retractClaim': (args: RetractClaimArgs) => Promise<RemoteResult<RetractClaimResult>>;
    'researchControl/registerArtifact': (args: RegisterArtifactArgs) => Promise<RemoteResult<RegisterArtifactResult>>;
    'researchControl/markArtifactMissing': (args: MarkArtifactMissingArgs) => Promise<RemoteResult<MarkArtifactMissingResult>>;
    'researchControl/addRelation': (args: AddRelationArgs) => Promise<RemoteResult<AddRelationResult>>;
    'researchControl/removeRelation': (args: RemoveRelationArgs) => Promise<RemoteResult<RemoveRelationResult>>;
    'researchControl/queryRecords': (args: QueryRecordsArgs) => Promise<RemoteResult<QueryRecordsResult>>;
  }
  interface TypertRemoteNamespaceMap {
    researchControl: TypertRemoteNamespace$726573656172636f6e74726f6c;
  }
  /**
   * Mounted namespace methods for `researchControl` (generator-named
   * interface). WP-4.1a: ping (WP-0.3 diagnostic) + the 13 §7.1 RPCs;
   * V2-T3.2a: + the 3 read-only plane RPCs (design §12 rows 1-3);
   * V2-T3.2b: + the 6 change-family plane RPCs (design §12 rows 4-6/8/9);
   * UI-0.4: + the 4 GUI management RPCs (the current-focus pair, R-01,
   * and the hierarchy create pair, Task 3 — project-routed);
   * V2-UI-0.4 UI-2: + the 6 GUI management RPCs (the 4 hierarchy
   * update/drop RPCs, project-routed — UI-2A — and the 2 local-project
   * RPCs, plane-level — UI-2B);
   * V2-UI-0.4 UI-4 (D §10): + the 7 attention RPCs (the
   * CurrentExecution projection read + the objective/next-action/blocker
   * mutation faces);
   * V2-UI-5 (brief §3): + the 5 plan-editor RPCs (the plan item CRUD
   * trio + the DEPENDS_ON relation pair).
   */
  interface TypertRemoteNamespace$726573656172636f6e74726f6c {
    ping: () => Promise<RemoteResult<PingResult>>;
    getDashboard: () => Promise<RemoteResult<DashboardSnapshot>>;
    getProject: () => Promise<RemoteResult<ProjectSnapshot>>;
    getTopic: (args: GetTopicArgs) => Promise<RemoteResult<TopicSnapshot>>;
    getWorkstream: (args: GetWorkstreamArgs) => Promise<RemoteResult<WorkstreamSnapshot>>;
    queryHistory: (args: QueryHistoryArgs) => Promise<RemoteResult<QueryHistoryResult>>;
    reorderPlan: (args: ReorderPlanArgs) => Promise<RemoteResult<ReorderPlanResult>>;
    selectPlanFork: (args: SelectPlanForkArgs) => Promise<RemoteResult<SelectPlanForkResult>>;
    dismissPlanFork: (args: DismissPlanForkArgs) => Promise<RemoteResult<DismissPlanForkResult>>;
    updateInterventionState: (args: UpdateInterventionStateArgs) => Promise<RemoteResult<UpdateInterventionStateResult>>;
    registerInteraction: (args: RegisterInteractionArgs) => Promise<RemoteResult<RegisterInteractionResult>>;
    saveResearchCheckpoint: (args: SaveResearchCheckpointArgs) => Promise<RemoteResult<SaveResearchCheckpointResult>>;
    getGitHistory: (args: GetGitHistoryArgs) => Promise<RemoteResult<GetGitHistoryResult>>;
    restoreDeclarativeFile: (args: RestoreDeclarativeFileArgs) => Promise<RemoteResult<RestoreDeclarativeFileResult>>;
    getResearchPlaneState: (args: GetResearchPlaneStateArgs) => Promise<RemoteResult<GetResearchPlaneStateResult>>;
    getHubOverview: (args: GetHubOverviewArgs) => Promise<RemoteResult<HubOverviewResult>>;
    getPortfolioInterventions: (args: GetPortfolioInterventionsArgs) => Promise<RemoteResult<GetPortfolioInterventionsResult>>;
    setHub: (args: SetHubArgs) => Promise<RemoteResult<SetHubResult>>;
    bindProject: (args: BindProjectArgs) => Promise<RemoteResult<BindProjectResult>>;
    unbindProject: (args: UnbindProjectArgs) => Promise<RemoteResult<UnbindProjectResult>>;
    restoreProject: (args: RestoreProjectArgs) => Promise<RemoteResult<RestoreProjectResult>>;
    rescan: (args: RescanArgs) => Promise<RemoteResult<RescanResult>>;
    ackMissingReminder: (args: AckMissingReminderArgs) => Promise<RemoteResult<AckMissingReminderResult>>;
    setCurrentFocus: (args: SetCurrentFocusArgs) => Promise<RemoteResult<SetCurrentFocusResult>>;
    getCurrentFocus: (args: GetCurrentFocusArgs) => Promise<RemoteResult<GetCurrentFocusResult>>;
    createTopic: (args: CreateTopicArgs) => Promise<RemoteResult<CreateTopicResult>>;
    createWorkstream: (args: CreateWorkstreamArgs) => Promise<RemoteResult<CreateWorkstreamResult>>;
    updateProjectMetadata: (args: UpdateProjectMetadataArgs) => Promise<RemoteResult<UpdateProjectMetadataResult>>;
    updateTopic: (args: UpdateTopicArgs) => Promise<RemoteResult<UpdateTopicResult>>;
    updateWorkstream: (args: UpdateWorkstreamArgs) => Promise<RemoteResult<UpdateWorkstreamResult>>;
    dropWorkstream: (args: DropWorkstreamArgs) => Promise<RemoteResult<DropWorkstreamResult>>;
    inspectProjectDirectory: (args: InspectProjectDirectoryArgs) => Promise<RemoteResult<InspectProjectDirectoryResult>>;
    createLocalResearchProject: (args: CreateLocalResearchProjectArgs) => Promise<RemoteResult<CreateLocalResearchProjectResult>>;
    getWorkstreamCurrent: (args: GetWorkstreamCurrentArgs) => Promise<RemoteResult<GetWorkstreamCurrentResult>>;
    updateObjective: (args: UpdateObjectiveArgs) => Promise<RemoteResult<UpdateObjectiveResult>>;
    createNextAction: (args: CreateNextActionArgs) => Promise<RemoteResult<CreateNextActionResult>>;
    promoteNextAction: (args: PromoteNextActionArgs) => Promise<RemoteResult<PromoteNextActionResult>>;
    dismissNextAction: (args: DismissNextActionArgs) => Promise<RemoteResult<DismissNextActionResult>>;
    createBlocker: (args: CreateBlockerArgs) => Promise<RemoteResult<CreateBlockerResult>>;
    clearBlocker: (args: ClearBlockerArgs) => Promise<RemoteResult<ClearBlockerResult>>;
    createPlanItem: (args: CreatePlanItemArgs) => Promise<RemoteResult<CreatePlanItemResult>>;
    updatePlanItem: (args: UpdatePlanItemArgs) => Promise<RemoteResult<UpdatePlanItemResult>>;
    removePlanItem: (args: RemovePlanItemArgs) => Promise<RemoteResult<RemovePlanItemResult>>;
    addDependency: (args: AddDependencyArgs) => Promise<RemoteResult<AddDependencyResult>>;
    removeDependency: (args: RemoveDependencyArgs) => Promise<RemoteResult<RemoveDependencyResult>>;
    createWorkstreamFork: (args: CreateWorkstreamForkArgs) => Promise<RemoteResult<CreateWorkstreamForkResult>>;
    createPlannedMerge: (args: CreatePlannedMergeArgs) => Promise<RemoteResult<CreatePlannedMergeResult>>;
    getMergeContract: (args: GetMergeContractArgs) => Promise<RemoteResult<GetMergeContractResult>>;
    saveMergeContract: (args: SaveMergeContractArgs) => Promise<RemoteResult<SaveMergeContractResult>>;
    dropTopologyEdge: (args: DropTopologyEdgeArgs) => Promise<RemoteResult<DropTopologyEdgeResult>>;
    recordFact: (args: RecordFactArgs) => Promise<RemoteResult<RecordFactResult>>;
    recordClaim: (args: RecordClaimArgs) => Promise<RemoteResult<RecordClaimResult>>;
    retractClaim: (args: RetractClaimArgs) => Promise<RemoteResult<RetractClaimResult>>;
    registerArtifact: (args: RegisterArtifactArgs) => Promise<RemoteResult<RegisterArtifactResult>>;
    markArtifactMissing: (args: MarkArtifactMissingArgs) => Promise<RemoteResult<MarkArtifactMissingResult>>;
    addRelation: (args: AddRelationArgs) => Promise<RemoteResult<AddRelationResult>>;
    removeRelation: (args: RemoveRelationArgs) => Promise<RemoteResult<RemoveRelationResult>>;
    queryRecords: (args: QueryRecordsArgs) => Promise<RemoteResult<QueryRecordsResult>>;
  }
}
/**
 * The research contribution: the client half of the `./typert` manifest.
 * `descriptors` is the SAME object set as `TYPERT.invocations` on the
 * host face (the shared `REGISTERED_RESEARCH_INVOCATIONS` — ping + the
 * 13 WP-4.1a descriptors + the 3 read-only plane descriptors, V2-T3.2a
 * + the 6 change-family plane descriptors, V2-T3.2b + the 4 GUI
 * management descriptors, UI-0.4: the current-focus pair (R-01) and the
 * hierarchy create pair (Task 3) + the 7 attention descriptors, UI-4 (D
 * §10): the CurrentExecution projection read + the
 * objective/next-action/blocker mutation faces + the 5 plan-editor
 * descriptors, UI-5 (brief §3): the plan item CRUD trio + the DEPENDS_ON
 * relation pair — the hand-written map
 * above mirrors the SAME face by category), strict codecs included.
 */
declare const researchRemotes: TypertRemoteContribution;
//#endregion
export { researchRemotes as default, researchRemotes };