/**
 * WP-1.4 — public surface of the topology + merge-contract service
 * (domain layer, same injected-I/O pattern as the WP-1.1 loader).
 *
 * Usage (service layer, later WP):
 * ```ts
 * const store = new TopologyStore({ io, researchRoot: '/ws/.research', schemaDir: '/wr/schema/declarative', topicId: 'TPC-1', workstreams: ['WS-1', 'WS-2', 'WS-3'] })
 * store.addEdge({ operation: 'MERGE', inputs: ['WS-1', 'WS-2'], outputs: ['WS-3'] })
 * store.transitionEdge('TE-2', 'REALIZED', { actor: 'USER', realized_event_id: 'H-1001' })
 *
 * const contracts = new MergeContractStore({ io, researchRoot, edgeIds: allEdgeIds(tree) })
 * contracts.writeContract('TE-2', '# Merge Contract …')
 *
 * // Phase 2, before TOPOLOGY_FORK/MERGE_REALIZED emission:
 * const ok = validateRealize(topicTopologyDoc, 'TE-2').ok
 * ```
 *
 * Boundary: NO HistoryEvent is written anywhere in this module (realize
 * event emission is Phase 2); the plan is read-only (the workstream registry
 * and edge-id snapshot are injected from the loaded ResearchTree).
 */

export {
  assertWellFormedTeId,
  TMP_FILE_SUFFIX,
  TopologyStoreError,
  type EdgePatch,
  type NewEdgeInput,
  type RealizeIssue,
  type RealizeIssueCode,
  type RealizeValidation,
  type TopologyErrorCode,
  type TopologyFileIo,
  type TransitionActor,
} from './types.js'
export {
  checkTransition,
  isLegalTransition,
  legalTargets,
  TE_TRANSITIONS,
} from './state-machine.js'
export { atomicWrite, MergeContractStore, validateRealize, type MergeContractStoreOptions } from './contract.js'
export { TopologyStore, type TopologyStoreOptions } from './store.js'
