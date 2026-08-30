/**
 * UI-5 D1 — the wire error carrier for the Plan Writer Service.
 *
 * The gateway folds a host error to `{ ok: false, error: <message> }` —
 * the `[research-control] <CODE>: <message>` prefix in the message is the
 * machine-matchable carrier (the `#mapCurrentFocusError` /
 * `#mapHierarchyError` / `#mapActionsError` precedent in rpc-services.ts).
 * The D3 RPC face installs this as its `#mapPlanWriterError` private
 * (the brief's D1 symbol, applied at the layer that owns the wire).
 */
import { isPlanStoreError } from '../../domain/plan/index.js'

/**
 * Map the kernel's `PlanStoreError` family onto the wire carrier
 * (`[research-control] <PlanStoreErrorCode>: <message>`). Non-kernel
 * errors propagate untouched (their own messages — e.g. the ledger
 * failure already carries a self-describing manual-reconciliation text).
 */
export function mapPlanWriterError(e: unknown): unknown {
  if (isPlanStoreError(e)) {
    return new Error(`[research-control] ${e.code}: ${e.message}`, { cause: e })
  }
  return e
}
