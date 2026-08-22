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
 * only assembly faults reject). `descriptors` is the SAME object set as
 * `TYPERT.invocations` on the host face (the shared
 * `ALL_RESEARCH_INVOCATIONS` — no drift by construction).
 *
 * This file is client-dsh-adapter territory: it may import
 * `@deepseek-ai/*` (INV-PERM-5 exempt set).
 */

import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import {
  DashboardSnapshot,
  DismissPlanForkArgs,
  DismissPlanForkResult,
  GetGitHistoryArgs,
  GetGitHistoryResult,
  GetTopicArgs,
  GetWorkstreamArgs,
  PingResult,
  ProjectSnapshot,
  QueryHistoryArgs,
  QueryHistoryResult,
  RESEARCH_CONTROL_PACKAGE,
  ReorderPlanArgs,
  ReorderPlanResult,
  RegisterInteractionArgs,
  RegisterInteractionResult,
  RestoreDeclarativeFileArgs,
  RestoreDeclarativeFileResult,
  SaveResearchCheckpointArgs,
  SaveResearchCheckpointResult,
  SelectPlanForkArgs,
  SelectPlanForkResult,
  TopicSnapshot,
  UpdateInterventionStateArgs,
  UpdateInterventionStateResult,
  WorkstreamSnapshot,
  ALL_RESEARCH_INVOCATIONS,
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
  }

  interface TypertRemoteNamespaceMap {
    researchControl: TypertRemoteNamespace$726573656172636f6e74726f6c
  }

  /**
   * Mounted namespace methods for `researchControl` (generator-named
   * interface). WP-4.1a: ping (WP-0.3 diagnostic) + the 13 §7.1 RPCs.
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
  }
}

/**
 * The research contribution: the client half of the `./typert` manifest.
 * `descriptors` is the SAME object set as `TYPERT.invocations` on the
 * host face (the shared ping descriptor + the 13 WP-4.1a descriptors),
 * strict codecs included.
 */
export const researchRemotes: TypertRemoteContribution = {
  package: RESEARCH_CONTROL_PACKAGE,
  descriptors: ALL_RESEARCH_INVOCATIONS,
}

export default researchRemotes
