/**
 * UI-6 D1 — the wire error carrier for the Topology Service.
 *
 * The gateway folds a host error to `{ ok: false, error: <message> }` —
 * the `[research-control] <CODE>: <message>` prefix in the message is the
 * machine-matchable carrier (the `#mapHierarchyError` /
 * `#mapActionsError` / `#mapPlanWriterError` precedent in
 * rpc-services.ts). The D1 RPC face installs `mapTopologyServiceError`
 * as its `#mapTopologyServiceError` private; because this class does NOT
 * build the prefix into the message (unlike the plan-writer /
 * local-project error classes), the FACE pass constructs the
 * `[research-control] <CODE>: <message>` carrier — the same shape as the
 * CF_/HIER_/ATTN_ face mappers (the service-level `TopologyServiceError`
 * rides through this mapper untouched).
 */
import { TopologyStoreError, type TopologyErrorCode } from '../../domain/topology/index.js'
import { isHierarchyError } from '../hierarchy/index.js'
import { TopologyServiceError, type TopologyServiceErrorCode } from './types.js'

/**
 * Map the kernel `TopologyStoreError` codes onto the service family.
 * `READ` / `WRITE` are path-qualified: a contract file
 * (`merges/…`) ⇒ TOPO_CONTRACT_IO; a topology file (or none) ⇒ TOPO_WRITE.
 * The residual kernel codes (PARSE / SCHEMA / SCHEMA_UNAVAILABLE /
 * PATH_ID_MISMATCH / WS_NOT_FOUND / INVALID_ID / MISSING_REALIZED_EVENT_ID)
 * cannot arise from this service's call paths (the service pre-validates
 * ids, never creates REALIZED edges, and builds docs from a freshly
 * loaded + validated tree) — they pass through UNTOUCHED (the kernel's
 * own well-formed code rides the wire; fail-loud, no invented bucket).
 */
function kernelCode(code: TopologyErrorCode, file: string | undefined): TopologyServiceErrorCode | null {
  switch (code) {
    case 'DUPLICATE_EDGE_ID':
      return 'TOPO_DUPLICATE_EDGE'
    case 'EDGE_NOT_FOUND':
      return 'TOPO_EDGE_NOT_FOUND'
    case 'INVALID_TRANSITION':
      return 'TOPO_INVALID_TRANSITION'
    case 'UNAUTHORIZED_TRANSITION':
      return 'TOPO_UNAUTHORIZED_TRANSITION'
    case 'CONTRACT_TE_UNKNOWN':
      return 'TOPO_CONTRACT_TE_UNKNOWN'
    case 'CONTRACT_NOT_FOUND':
      return 'TOPO_CONTRACT_NOT_FOUND'
    case 'READ':
    case 'WRITE':
      return file?.startsWith('merges/') === true ? 'TOPO_CONTRACT_IO' : 'TOPO_WRITE'
    default:
      return null
  }
}

/**
 * Map the hierarchy `HierarchyError` codes onto the service family (the
 * fork face drives `HierarchyService.createWorkstream`; the compensation
 * drives `dropWorkstream` — both surface here).
 */
function hierarchyCode(code: string): TopologyServiceErrorCode | null {
  switch (code) {
    case 'HIER_WORKSTREAM_EXISTS':
      return 'TOPO_WORKSTREAM_EXISTS'
    case 'HIER_WRITE':
      return 'TOPO_WRITE'
    case 'HIER_TREE_BROKEN':
      return 'TOPO_TREE_BROKEN'
    default:
      return null
  }
}

/**
 * The service-level mapping pass (the plan-writer `mapPlanWriterError`
 * precedent): kernel TopologyStoreError / HierarchyError ⇒
 * `TopologyServiceError` (code family + original message + cause);
 * an already-mapped `TopologyServiceError` rides through untouched;
 * anything else (a loud manual-reconciliation error, an unexpected
 * runtime fault) propagates with its own message.
 */
export function mapTopologyServiceError(e: unknown): unknown {
  if (e instanceof TopologyServiceError) return e
  if (e instanceof TopologyStoreError) {
    const code = kernelCode(e.code, e.file)
    if (code !== null) return new TopologyServiceError(code, e.message, e)
    return e
  }
  if (isHierarchyError(e)) {
    const code = hierarchyCode(e.code)
    if (code !== null) return new TopologyServiceError(code, e.message, e)
    return e
  }
  return e
}
