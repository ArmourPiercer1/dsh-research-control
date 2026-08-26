/**
 * WP-4.1b — stub RPC facade for the store suite.
 *
 * Structurally satisfies `ResearchRpcFacade` (= `typeof researchRpc`,
 * mount.ts) so it is a drop-in for the store's `options.rpc` seam. Every
 * call is recorded (`method` + verbatim `args`); results default to the
 * WIRE-VALID WP-4.1a fixtures (tests/rpc-face/fixtures.ts — the same
 * values the gateway strict decode accepts) wrapped in `ok: true`, and
 * are overridable per method with:
 *  - a plain value (returned as the `RemoteResult`),
 *  - a `Promise` (awaited by the store — timing control),
 *  - an `Error` instance (thrown — simulates a transport/assembly fault;
 *    a business fault is instead the `ok: false` result shape).
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  PingResult,
  DashboardSnapshot,
  ProjectSnapshot,
  TopicSnapshot,
  WorkstreamSnapshot,
  QueryHistoryResult,
  ReorderPlanResult,
  SelectPlanForkResult,
  DismissPlanForkResult,
  UpdateInterventionStateResult,
  RegisterInteractionResult,
  SaveResearchCheckpointResult,
  GetGitHistoryResult,
  RestoreDeclarativeFileResult,
  // V2-T4.1: the 9 plane methods join the facade surface.
  GetResearchPlaneStateArgs,
  GetResearchPlaneStateResult,
  GetHubOverviewArgs,
  HubOverviewResult,
  GetPortfolioInterventionsArgs,
  GetPortfolioInterventionsResult,
  SetHubArgs,
  SetHubResult,
  BindProjectArgs,
  BindProjectResult,
  UnbindProjectArgs,
  UnbindProjectResult,
  RestoreProjectArgs,
  RestoreProjectResult,
  RescanArgs,
  RescanResult,
  AckMissingReminderArgs,
  AckMissingReminderResult,
  GetTopicArgs,
  GetWorkstreamArgs,
  QueryHistoryArgs,
  ReorderPlanArgs,
  SelectPlanForkArgs,
  DismissPlanForkArgs,
  UpdateInterventionStateArgs,
  RegisterInteractionArgs,
  SaveResearchCheckpointArgs,
  GetGitHistoryArgs,
  RestoreDeclarativeFileArgs,
} from '../../src/shared/rpc-contracts.js'
import {
  DASHBOARD_FIXTURE,
  PROJECT_FIXTURE,
  TOPIC_FIXTURE,
  WORKSTREAM_FIXTURE,
  HISTORY_FIXTURE,
  REORDER_FIXTURE,
  SELECT_FIXTURE,
  DISMISS_FIXTURE,
  UPDATE_INTERVENTION_FIXTURE,
  REGISTER_INTERACTION_FIXTURE,
  CHECKPOINT_FIXTURE,
  GIT_HISTORY_FIXTURE,
  RESTORE_FIXTURE,
} from '../rpc-face/fixtures.js'
import type { ResearchRpcFacade } from '../../src/client/stores/research-store.js'

/** The 14 facade methods (ping + the frozen 13, ARCHITECTURE §7.1). */
export const FACADE_METHODS = [
  'ping',
  'getDashboard',
  'getProject',
  'getTopic',
  'getWorkstream',
  'queryHistory',
  'reorderPlan',
  'selectPlanFork',
  'dismissPlanFork',
  'updateInterventionState',
  'registerInteraction',
  'saveResearchCheckpoint',
  'getGitHistory',
  'restoreDeclarativeFile',
] as const

export type FacadeMethod = (typeof FACADE_METHODS)[number]

export interface StubCall {
  readonly method: string
  readonly args?: unknown
}

export interface StubRpc {
  /** The facade face (structurally `researchRpc`). */
  readonly rpc: ResearchRpcFacade
  /** Every recorded call, in order. */
  readonly calls: StubCall[]
  /** Recorded calls of one method. */
  callsTo(method: string): StubCall[]
  /** How many times one method was called. */
  countOf(method: string): number
  /**
   * Configure a method's outcome (plain value | Promise | Error to throw).
   * @param value - the configured outcome; restore with `reset()`.
   */
  set(method: string, value: unknown): void
  /** Clear configurations AND the call log. */
  reset(): void
}

const PING_FIXTURE: PingResult = { ok: true, service: 'researchControl', time: 1755000000000 }

const DEFAULTS: Record<string, () => unknown> = {
  ping: () => ({ ok: true, value: PING_FIXTURE }),
  getDashboard: () => ({ ok: true, value: DASHBOARD_FIXTURE }),
  getProject: () => ({ ok: true, value: PROJECT_FIXTURE }),
  getTopic: () => ({ ok: true, value: TOPIC_FIXTURE }),
  getWorkstream: () => ({ ok: true, value: WORKSTREAM_FIXTURE }),
  queryHistory: () => ({ ok: true, value: HISTORY_FIXTURE }),
  reorderPlan: () => ({ ok: true, value: REORDER_FIXTURE }),
  selectPlanFork: () => ({ ok: true, value: SELECT_FIXTURE }),
  dismissPlanFork: () => ({ ok: true, value: DISMISS_FIXTURE }),
  updateInterventionState: () => ({ ok: true, value: UPDATE_INTERVENTION_FIXTURE }),
  registerInteraction: () => ({ ok: true, value: REGISTER_INTERACTION_FIXTURE }),
  saveResearchCheckpoint: () => ({ ok: true, value: CHECKPOINT_FIXTURE }),
  getGitHistory: () => ({ ok: true, value: GIT_HISTORY_FIXTURE }),
  restoreDeclarativeFile: () => ({ ok: true, value: RESTORE_FIXTURE }),
  // V2-T4.1: wire-valid minimal defaults for the 9 plane methods (the
  // store suite never exercises them by default — they exist so the stub
  // structurally satisfies the 23-method `ResearchRpcFacade` face).
  getResearchPlaneState: () => ({
    ok: true,
    value: {
      hub: null,
      dirNames: { treeDir: '.research', hubDir: '.research-control' },
      projects: [],
      missing: [],
      registry: [],
      session: { cwd: '/workspace/stub', role: 'STANDALONE' },
    },
  }),
  getHubOverview: () => ({
    ok: true,
    value: { totals: { projects: 0, openInterventions: 0, inbox: 0 }, attention: [], cards: [] },
  }),
  getPortfolioInterventions: () => ({ ok: true, value: { items: [] } }),
  setHub: () => ({
    ok: true,
    value: { hubPath: '/workspace/hub', registryPath: '/workspace/hub/.research-control/registry.yaml' },
  }),
  bindProject: () => ({
    ok: true,
    value: {
      projectId: 'PRJ-1',
      registryPath: '/workspace/hub/.research-control/registry.yaml',
      dbMigrated: false,
    },
  }),
  unbindProject: () => ({
    ok: true,
    value: { projectId: 'PRJ-1', archivedDir: '/workspace/hub/.research-control/archived/PRJ-1' },
  }),
  restoreProject: () => ({ ok: true, value: { wsPath: '/workspace/PRJ-1' } }),
  rescan: () => ({
    ok: true,
    value: {
      hub: null,
      dirNames: { treeDir: '.research', hubDir: '.research-control' },
      projects: [],
      missing: [],
      registry: [],
    },
  }),
  ackMissingReminder: () => ({ ok: true, value: { acknowledged: true } }),
}

/**
 * Build a stub facade.
 * @returns the stub (facade + call log + outcome configurator).
 */
export function makeStubRpc(): StubRpc {
  const configured = new Map<string, unknown>()
  const calls: StubCall[] = []

  function deliver<R>(method: string): R {
    calls.push({ method })
    const outcome = configured.has(method) ? configured.get(method) : DEFAULTS[method]()
    if (outcome instanceof Error) throw outcome
    return outcome as R
  }

  function deliverArgs<R>(method: string, args: unknown): R {
    calls.push({ method, args })
    const outcome = configured.has(method) ? configured.get(method) : DEFAULTS[method]()
    if (outcome instanceof Error) throw outcome
    return outcome as R
  }

  const rpc: ResearchRpcFacade = {
    ping: async () => deliver<RemoteResult<PingResult>>('ping'),
    getDashboard: async () => deliver<RemoteResult<DashboardSnapshot>>('getDashboard'),
    getProject: async () => deliver<RemoteResult<ProjectSnapshot>>('getProject'),
    getTopic: async (args: GetTopicArgs) => deliverArgs<RemoteResult<TopicSnapshot>>('getTopic', args),
    getWorkstream: async (args: GetWorkstreamArgs) => deliverArgs<RemoteResult<WorkstreamSnapshot>>('getWorkstream', args),
    queryHistory: async (args: QueryHistoryArgs) => deliverArgs<RemoteResult<QueryHistoryResult>>('queryHistory', args),
    reorderPlan: async (args: ReorderPlanArgs) => deliverArgs<RemoteResult<ReorderPlanResult>>('reorderPlan', args),
    selectPlanFork: async (args: SelectPlanForkArgs) => deliverArgs<RemoteResult<SelectPlanForkResult>>('selectPlanFork', args),
    dismissPlanFork: async (args: DismissPlanForkArgs) =>
      deliverArgs<RemoteResult<DismissPlanForkResult>>('dismissPlanFork', args),
    updateInterventionState: async (args: UpdateInterventionStateArgs) =>
      deliverArgs<RemoteResult<UpdateInterventionStateResult>>('updateInterventionState', args),
    registerInteraction: async (args: RegisterInteractionArgs) =>
      deliverArgs<RemoteResult<RegisterInteractionResult>>('registerInteraction', args),
    saveResearchCheckpoint: async (args: SaveResearchCheckpointArgs) =>
      deliverArgs<RemoteResult<SaveResearchCheckpointResult>>('saveResearchCheckpoint', args),
    getGitHistory: async (args: GetGitHistoryArgs) =>
      deliverArgs<RemoteResult<GetGitHistoryResult>>('getGitHistory', args),
    restoreDeclarativeFile: async (args: RestoreDeclarativeFileArgs) =>
      deliverArgs<RemoteResult<RestoreDeclarativeFileResult>>('restoreDeclarativeFile', args),
    // V2-T4.1: the 9 plane methods (the 23-method face).
    getResearchPlaneState: async (args: GetResearchPlaneStateArgs) =>
      deliverArgs<RemoteResult<GetResearchPlaneStateResult>>('getResearchPlaneState', args),
    getHubOverview: async (args: GetHubOverviewArgs) =>
      deliverArgs<RemoteResult<HubOverviewResult>>('getHubOverview', args),
    getPortfolioInterventions: async (args: GetPortfolioInterventionsArgs) =>
      deliverArgs<RemoteResult<GetPortfolioInterventionsResult>>('getPortfolioInterventions', args),
    setHub: async (args: SetHubArgs) => deliverArgs<RemoteResult<SetHubResult>>('setHub', args),
    bindProject: async (args: BindProjectArgs) =>
      deliverArgs<RemoteResult<BindProjectResult>>('bindProject', args),
    unbindProject: async (args: UnbindProjectArgs) =>
      deliverArgs<RemoteResult<UnbindProjectResult>>('unbindProject', args),
    restoreProject: async (args: RestoreProjectArgs) =>
      deliverArgs<RemoteResult<RestoreProjectResult>>('restoreProject', args),
    rescan: async (args: RescanArgs) => deliverArgs<RemoteResult<RescanResult>>('rescan', args),
    ackMissingReminder: async (args: AckMissingReminderArgs) =>
      deliverArgs<RemoteResult<AckMissingReminderResult>>('ackMissingReminder', args),
  }

  return {
    rpc,
    calls,
    callsTo: method => calls.filter(call => call.method === method),
    countOf: method => calls.filter(call => call.method === method).length,
    set: (method, value) => {
      configured.set(method, value)
    },
    reset: () => {
      configured.clear()
      calls.length = 0
    },
  }
}
