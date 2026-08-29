/**
 * Client-side `./remote` artifact (WP-0.3 RPC spike, WP-4.1a: the full
 * 13-RPC client face).
 *
 * U4 fallback (STATUS E009): hand-written twin of the generated
 * `lib/typert.remote-client.{js,d.ts}` — same module shape (named
 * contribution export + default), so the client half stays a drop-in
 * for a future generator-produced artifact. Consumed by
 * `ctx.remote.$mount(contribution)` (DSH_ADAPTER §5): the gateway client
 * installs the `researchControl` namespace service in the CALLER's fiber.
 *
 * The `declare module` block below mirrors what the generated
 * remote-client d.ts emits (checkout packages/typert/generator/src/
 * emitter.ts renderRemoteDts): it merges our endpoints into the protocol's
 * merge-extensible maps, which is what types `ctx.remote.researchControl`
 * for consumers. The namespace interface name follows the generator's
 * grammar `TypertRemoteNamespace$<utf8-hex(namespace)>`.
 *
 * WP-4.1a: the map gains the 13 §7.1 endpoints (each a single `args`
 * object parameter, `RemoteResult<T>` per the gateway carrier's failure
 * folding — host-side business errors arrive as `{ ok: false, error }`,
 * only assembly faults reject). V2-T3.2a: the map gains the 3 read-only
 * plane endpoints (design §12 rows 1-3 — same conventions: one `args`
 * json parameter, `RemoteResult<T>`; `getHubOverview`'s request is the
 * EMPTY strict object). V2-T3.2b: the map gains the 6 change-family
 * plane endpoints (design §12 rows 4-6/8/9 — same conventions: PLANE-
 * LEVEL, not project-routed, callable on the empty plane). `descriptors`
 * is the SAME object set as `TYPERT.invocations` on the host face (the
 * shared `REGISTERED_RESEARCH_INVOCATIONS` — no drift by construction).
 *
 * This file is client-dsh-adapter territory: it may import
 * `@deepseek-ai/*` (INV-PERM-5 exempt set).
 */

import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import {
  AckMissingReminderArgs,
  AckMissingReminderResult,
  BindProjectArgs,
  BindProjectResult,
  CreateTopicArgs,
  CreateTopicResult,
  CreateWorkstreamArgs,
  CreateWorkstreamResult,
  DashboardSnapshot,
  DismissPlanForkArgs,
  DismissPlanForkResult,
  GetCurrentFocusArgs,
  GetCurrentFocusResult,
  GetGitHistoryArgs,
  GetGitHistoryResult,
  GetHubOverviewArgs,
  GetPortfolioInterventionsArgs,
  GetPortfolioInterventionsResult,
  GetResearchPlaneStateArgs,
  GetResearchPlaneStateResult,
  GetTopicArgs,
  GetWorkstreamArgs,
  HubOverviewResult,
  PingResult,
  ProjectSnapshot,
  QueryHistoryArgs,
  QueryHistoryResult,
  RESEARCH_CONTROL_PACKAGE,
  REGISTERED_RESEARCH_INVOCATIONS,
  ReorderPlanArgs,
  ReorderPlanResult,
  RegisterInteractionArgs,
  RegisterInteractionResult,
  RescanArgs,
  RescanResult,
  RestoreDeclarativeFileArgs,
  RestoreDeclarativeFileResult,
  RestoreProjectArgs,
  RestoreProjectResult,
  SaveResearchCheckpointArgs,
  SaveResearchCheckpointResult,
  SetCurrentFocusArgs,
  SetCurrentFocusResult,
  SetHubArgs,
  SetHubResult,
  SelectPlanForkArgs,
  SelectPlanForkResult,
  TopicSnapshot,
  UnbindProjectArgs,
  UnbindProjectResult,
  UpdateInterventionStateArgs,
  UpdateInterventionStateResult,
  WorkstreamSnapshot,
} from '../../../shared/rpc-contracts.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'researchControl/ping': () => Promise<RemoteResult<PingResult>>
    'researchControl/getDashboard': () => Promise<RemoteResult<DashboardSnapshot>>
    'researchControl/getProject': () => Promise<RemoteResult<ProjectSnapshot>>
    'researchControl/getTopic': (args: GetTopicArgs) => Promise<RemoteResult<TopicSnapshot>>
    'researchControl/getWorkstream': (args: GetWorkstreamArgs) => Promise<RemoteResult<WorkstreamSnapshot>>
    'researchControl/queryHistory': (args: QueryHistoryArgs) => Promise<RemoteResult<QueryHistoryResult>>
    'researchControl/reorderPlan': (args: ReorderPlanArgs) => Promise<RemoteResult<ReorderPlanResult>>
    'researchControl/selectPlanFork': (args: SelectPlanForkArgs) => Promise<RemoteResult<SelectPlanForkResult>>
    'researchControl/dismissPlanFork': (args: DismissPlanForkArgs) => Promise<RemoteResult<DismissPlanForkResult>>
    'researchControl/updateInterventionState': (
      args: UpdateInterventionStateArgs,
    ) => Promise<RemoteResult<UpdateInterventionStateResult>>
    'researchControl/registerInteraction': (
      args: RegisterInteractionArgs,
    ) => Promise<RemoteResult<RegisterInteractionResult>>
    'researchControl/saveResearchCheckpoint': (
      args: SaveResearchCheckpointArgs,
    ) => Promise<RemoteResult<SaveResearchCheckpointResult>>
    'researchControl/getGitHistory': (args: GetGitHistoryArgs) => Promise<RemoteResult<GetGitHistoryResult>>
    'researchControl/restoreDeclarativeFile': (
      args: RestoreDeclarativeFileArgs,
    ) => Promise<RemoteResult<RestoreDeclarativeFileResult>>
    // V2-T3.2a: the 3 read-only plane RPCs (design §12 rows 1-3).
    'researchControl/getResearchPlaneState': (
      args: GetResearchPlaneStateArgs,
    ) => Promise<RemoteResult<GetResearchPlaneStateResult>>
    'researchControl/getHubOverview': (
      args: GetHubOverviewArgs,
    ) => Promise<RemoteResult<HubOverviewResult>>
    'researchControl/getPortfolioInterventions': (
      args: GetPortfolioInterventionsArgs,
    ) => Promise<RemoteResult<GetPortfolioInterventionsResult>>
    // V2-T3.2b: the 6 change-family plane RPCs (design §12 rows 4-6/8/9).
    'researchControl/setHub': (
      args: SetHubArgs,
    ) => Promise<RemoteResult<SetHubResult>>
    'researchControl/bindProject': (
      args: BindProjectArgs,
    ) => Promise<RemoteResult<BindProjectResult>>
    'researchControl/unbindProject': (
      args: UnbindProjectArgs,
    ) => Promise<RemoteResult<UnbindProjectResult>>
    'researchControl/restoreProject': (
      args: RestoreProjectArgs,
    ) => Promise<RemoteResult<RestoreProjectResult>>
    'researchControl/rescan': (args: RescanArgs) => Promise<RemoteResult<RescanResult>>
    'researchControl/ackMissingReminder': (
      args: AckMissingReminderArgs,
    ) => Promise<RemoteResult<AckMissingReminderResult>>
    // UI-0.4: the GUI management face — the current-focus pair (R-01) +
    // the hierarchy create pair (Task 3), project-routed.
    'researchControl/setCurrentFocus': (
      args: SetCurrentFocusArgs,
    ) => Promise<RemoteResult<SetCurrentFocusResult>>
    'researchControl/getCurrentFocus': (
      args: GetCurrentFocusArgs,
    ) => Promise<RemoteResult<GetCurrentFocusResult>>
    'researchControl/createTopic': (
      args: CreateTopicArgs,
    ) => Promise<RemoteResult<CreateTopicResult>>
    'researchControl/createWorkstream': (
      args: CreateWorkstreamArgs,
    ) => Promise<RemoteResult<CreateWorkstreamResult>>
  }

  interface TypertRemoteNamespaceMap {
    researchControl: TypertRemoteNamespace$726573656172636f6e74726f6c
  }

  /**
   * Mounted namespace methods for `researchControl` (generator-named
   * interface). WP-4.1a: ping (WP-0.3 diagnostic) + the 13 §7.1 RPCs;
   * V2-T3.2a: + the 3 read-only plane RPCs (design §12 rows 1-3);
   * V2-T3.2b: + the 6 change-family plane RPCs (design §12 rows 4-6/8/9);
   * UI-0.4: + the 4 GUI management RPCs (the current-focus pair, R-01,
   * and the hierarchy create pair, Task 3 — project-routed).
   */
  interface TypertRemoteNamespace$726573656172636f6e74726f6c {
    ping: () => Promise<RemoteResult<PingResult>>
    getDashboard: () => Promise<RemoteResult<DashboardSnapshot>>
    getProject: () => Promise<RemoteResult<ProjectSnapshot>>
    getTopic: (args: GetTopicArgs) => Promise<RemoteResult<TopicSnapshot>>
    getWorkstream: (args: GetWorkstreamArgs) => Promise<RemoteResult<WorkstreamSnapshot>>
    queryHistory: (args: QueryHistoryArgs) => Promise<RemoteResult<QueryHistoryResult>>
    reorderPlan: (args: ReorderPlanArgs) => Promise<RemoteResult<ReorderPlanResult>>
    selectPlanFork: (args: SelectPlanForkArgs) => Promise<RemoteResult<SelectPlanForkResult>>
    dismissPlanFork: (args: DismissPlanForkArgs) => Promise<RemoteResult<DismissPlanForkResult>>
    updateInterventionState: (
      args: UpdateInterventionStateArgs,
    ) => Promise<RemoteResult<UpdateInterventionStateResult>>
    registerInteraction: (
      args: RegisterInteractionArgs,
    ) => Promise<RemoteResult<RegisterInteractionResult>>
    saveResearchCheckpoint: (
      args: SaveResearchCheckpointArgs,
    ) => Promise<RemoteResult<SaveResearchCheckpointResult>>
    getGitHistory: (args: GetGitHistoryArgs) => Promise<RemoteResult<GetGitHistoryResult>>
    restoreDeclarativeFile: (
      args: RestoreDeclarativeFileArgs,
    ) => Promise<RemoteResult<RestoreDeclarativeFileResult>>
    // V2-T3.2a: the 3 read-only plane RPCs (design §12 rows 1-3).
    getResearchPlaneState: (
      args: GetResearchPlaneStateArgs,
    ) => Promise<RemoteResult<GetResearchPlaneStateResult>>
    getHubOverview: (args: GetHubOverviewArgs) => Promise<RemoteResult<HubOverviewResult>>
    getPortfolioInterventions: (
      args: GetPortfolioInterventionsArgs,
    ) => Promise<RemoteResult<GetPortfolioInterventionsResult>>
    // V2-T3.2b: the 6 change-family plane RPCs (design §12 rows 4-6/8/9).
    setHub: (args: SetHubArgs) => Promise<RemoteResult<SetHubResult>>
    bindProject: (args: BindProjectArgs) => Promise<RemoteResult<BindProjectResult>>
    unbindProject: (args: UnbindProjectArgs) => Promise<RemoteResult<UnbindProjectResult>>
    restoreProject: (args: RestoreProjectArgs) => Promise<RemoteResult<RestoreProjectResult>>
    rescan: (args: RescanArgs) => Promise<RemoteResult<RescanResult>>
    ackMissingReminder: (
      args: AckMissingReminderArgs,
    ) => Promise<RemoteResult<AckMissingReminderResult>>
    // UI-0.4: the GUI management face — the current-focus pair (R-01) +
    // the hierarchy create pair (Task 3), project-routed.
    setCurrentFocus: (args: SetCurrentFocusArgs) => Promise<RemoteResult<SetCurrentFocusResult>>
    getCurrentFocus: (args: GetCurrentFocusArgs) => Promise<RemoteResult<GetCurrentFocusResult>>
    createTopic: (args: CreateTopicArgs) => Promise<RemoteResult<CreateTopicResult>>
    createWorkstream: (
      args: CreateWorkstreamArgs,
    ) => Promise<RemoteResult<CreateWorkstreamResult>>
  }
}

/**
 * The research contribution: the client half of the `./typert` manifest.
 * `descriptors` is the SAME object set as `TYPERT.invocations` on the
 * host face (the shared `REGISTERED_RESEARCH_INVOCATIONS` — ping + the
 * 13 WP-4.1a descriptors + the 3 read-only plane descriptors, V2-T3.2a
 * + the 6 change-family plane descriptors, V2-T3.2b + the 4 GUI
 * management descriptors, UI-0.4: the current-focus pair (R-01) and the
 * hierarchy create pair (Task 3) — the hand-written map above mirrors
 * the SAME face by category), strict codecs included.
 */
export const researchRemotes: TypertRemoteContribution = {
  package: RESEARCH_CONTROL_PACKAGE,
  descriptors: REGISTERED_RESEARCH_INVOCATIONS,
}

export default researchRemotes
