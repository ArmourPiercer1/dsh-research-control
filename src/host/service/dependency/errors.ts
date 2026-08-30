/**
 * UI-5 (D2) — the dependency service's error carrier mapping (the
 * plan-writer carrier discipline, applied at SERVICE level):
 *
 *   - the composed hook's registry half throws a `RunBindingError`
 *     (RB_EVENT_REJECTED) carrying the frozen registry's structured
 *     `EventValidationError[]` (code + path + message) — the FIRST
 *     error's code becomes the carrier code (the codes are the BRIEF §3
 *     negative vocabulary: OBJECT_ALREADY_EXISTS / OBJECT_NOT_FOUND /
 *     OWNER_MISMATCH / CROSS_FIELD);
 *   - the fold half throws a `SemanticDomainError` (code + message —
 *     e.g. RELATION_DUPLICATE / RELATION_REVERSE_DUPLICATE uniqueness,
 *     WRONG_STATE on a double remove) — its code becomes the carrier;
 *   - EVERYTHING else propagates untouched (fail loud, no re-wrap).
 *
 * The carrier string is `[research-control] <CODE>: <message>` — the
 * D3 RPC face extracts the code from the prefix (same contract as the
 * plan-writer carrier).
 */

import { RunBindingError } from '../runbinding/types.js'
import { SemanticDomainError } from '../../domain/semantics/types.js'

export function mapDependencyError(e: unknown): unknown {
  if (e instanceof RunBindingError && e.code === 'RB_EVENT_REJECTED') {
    const first = e.errors !== undefined && e.errors.length > 0 ? e.errors[0] : undefined
    if (first !== undefined) {
      return new Error(`[research-control] ${first.code}: ${first.message}`, { cause: e })
    }
  }
  if (e instanceof SemanticDomainError) {
    return new Error(`[research-control] ${e.code}: ${e.message}`, { cause: e })
  }
  return e
}
