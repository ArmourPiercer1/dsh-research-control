/**
 * UI-6 D1 — public surface of the Topology Service.
 *
 * The D1 RPC face (rpc-services.ts) constructs ONE `TopologyService`
 * in its self-constructed service block (the PlanWriterService
 * precedent — the same fresh-kernel / FsTopologyFileIo spine, the same
 * second connection for the MANAGEMENT_ACTION ledger rows; the wiring's
 * read-only REJECTING_WRITER is untouched, HostWiring NOT extended).
 */
export { TopologyService } from './service.js'
export { mapTopologyServiceError } from './errors.js'
export {
  TOPOLOGY_LEDGER_KINDS,
  TopologyServiceError,
  type CreatePlannedMergeArgs,
  type CreatePlannedMergeResult,
  type CreateWorkstreamForkArgs,
  type CreateWorkstreamForkChildInput,
  type CreateWorkstreamForkResult,
  type DropTopologyEdgeArgs,
  type DropTopologyEdgeResult,
  type GetMergeContractArgs,
  type GetMergeContractResult,
  type SaveMergeContractArgs,
  type SaveMergeContractResult,
  type TopologyLedgerKind,
  type TopologyServiceDb,
  type TopologyServiceErrorCode,
  type TopologyServiceIdAllocator,
  type TopologyServiceOptions,
  type TopologyTreeLoader,
} from './types.js'
