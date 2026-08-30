import { $ as RestoreDeclarativeFileResult, A as GetPortfolioInterventionsResult, B as PingResult, C as DropWorkstreamResult, Ct as UpdateWorkstreamResult, D as GetGitHistoryResult, E as GetGitHistoryArgs, F as GetWorkstreamCurrentArgs, G as QueryHistoryResult, H as PromoteNextActionArgs, I as GetWorkstreamCurrentResult, J as ReorderPlanArgs, K as RegisterInteractionArgs, L as HubOverviewResult, M as GetResearchPlaneStateResult, N as GetTopicArgs, O as GetHubOverviewArgs, P as GetWorkstreamArgs, Q as RestoreDeclarativeFileArgs, R as InspectProjectDirectoryArgs, S as DropWorkstreamArgs, St as UpdateWorkstreamArgs, T as GetCurrentFocusResult, U as PromoteNextActionResult, V as ProjectSnapshot, W as QueryHistoryArgs, X as RescanArgs, Y as ReorderPlanResult, Z as RescanResult, _ as DashboardSnapshot, _t as UpdateObjectiveResult, a as ClearBlockerArgs, at as SelectPlanForkResult, b as DismissPlanForkArgs, bt as UpdateTopicArgs, c as CreateBlockerResult, ct as SetHubArgs, d as CreateNextActionArgs, et as RestoreProjectArgs, f as CreateNextActionResult, ft as UnbindProjectArgs, g as CreateWorkstreamResult, gt as UpdateObjectiveArgs, h as CreateWorkstreamArgs, ht as UpdateInterventionStateResult, i as BindProjectResult, it as SelectPlanForkArgs, j as GetResearchPlaneStateArgs, k as GetPortfolioInterventionsArgs, l as CreateLocalResearchProjectArgs, lt as SetHubResult, m as CreateTopicResult, mt as UpdateInterventionStateArgs, n as AckMissingReminderResult, nt as SaveResearchCheckpointArgs, o as ClearBlockerResult, ot as SetCurrentFocusArgs, p as CreateTopicArgs, pt as UnbindProjectResult, q as RegisterInteractionResult, r as BindProjectArgs, rt as SaveResearchCheckpointResult, s as CreateBlockerArgs, st as SetCurrentFocusResult, t as AckMissingReminderArgs, tt as RestoreProjectResult, u as CreateLocalResearchProjectResult, ut as TopicSnapshot, v as DismissNextActionArgs, vt as UpdateProjectMetadataArgs, w as GetCurrentFocusArgs, wt as WorkstreamSnapshot, x as DismissPlanForkResult, xt as UpdateTopicResult, y as DismissNextActionResult, yt as UpdateProjectMetadataResult, z as InspectProjectDirectoryResult } from "./rpc-contracts-D_35PPbQ.js";
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
   * mutation faces).
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
 * objective/next-action/blocker mutation faces — the hand-written map
 * above mirrors the SAME face by category), strict codecs included.
 */
declare const researchRemotes: TypertRemoteContribution;
//#endregion
export { researchRemotes as default, researchRemotes };