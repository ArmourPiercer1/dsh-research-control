/**
 * Client store layer public face (WP-4.1b).
 *
 * Phase 4 (views 4.2-4.5) imports from HERE — never from the individual
 * modules (cross-module symbol discipline; the slot registration passes
 * the factory result through the `store` option, DSH_ADAPTER §6).
 *
 * Exports:
 *  - `createResearchStore` — the unique top-level store factory (factory,
 *    never a module-level handle);
 *  - the store/model types (slice state machine, keys, the observable
 *    state shape, `ResearchRpcError`);
 *  - the engine primitive (`createStore`) — exported so a future
 *    plugin-owned client store can reuse it without a new dependency;
 *  - the invalidate registry (frozen mutation → slice-key mapping).
 */

export { createStore, type Store, type StoreListener, type StoreSnapshotSource } from './engine.js'
export {
  gitHistoryKey,
  historyKey,
  idleSlice,
  initialResearchStoreState,
  parseSliceKey,
  ResearchRpcError,
  sliceKey,
  type RpcFailure,
  type RpcResult,
  type ResearchStoreState,
  type SliceKey,
  type SliceName,
  type SliceState,
  type SliceStatus,
  SLICE_NAMES,
} from './model.js'
export {
  type InvalidationRule,
  INVALIDATE_REGISTRY,
  type MutationId,
  MUTATION_IDS,
} from './registry.js'
export {
  createResearchStore,
  type RefreshPreHook,
  type ResearchRpcFacade,
  type ResearchStore,
  type ResearchStoreOptions,
  type StaleCheckHook,
} from './research-store.js'
// The contract data types live in the shared module; re-exported so view
// code addresses one import for the store face and its payloads.
export type {
  DashboardSnapshot,
  DismissPlanForkArgs,
  DismissPlanForkResult,
  GetGitHistoryArgs,
  GetGitHistoryResult,
  GetTopicArgs,
  GetWorkstreamArgs,
  ProjectSnapshot,
  QueryHistoryArgs,
  QueryHistoryResult,
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
} from '../../shared/rpc-contracts.js'
