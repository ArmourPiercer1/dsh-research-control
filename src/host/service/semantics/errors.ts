/**
 * UI-7 (D1) — the semantic records service's error carrier mapping (the
 * plan-writer / dependency carrier discipline, applied at SERVICE level):
 *
 *   - the composed hook's registry half throws a `RunBindingError`
 *     (RB_EVENT_REJECTED) carrying the frozen registry's structured
 *     `EventValidationError[]` (code + path + message) — the FIRST
 *     error's code becomes the carrier code (the codes are the D §13
 *     negative vocabulary: OBJECT_ALREADY_EXISTS / OBJECT_NOT_FOUND /
 *     OWNER_MISMATCH / CROSS_FIELD / RELATION_COMBINATION / …);
 *   - the fold half (the RR-011(b) store seam) and the service's own
 *     pre-check throw a `SemanticDomainError` (code + message — e.g.
 *     RELATION_DUPLICATE / RELATION_REVERSE_DUPLICATE uniqueness,
 *     WRONG_STATE on a double retract, the §5.3–5.5 preconditions) — its
 *     code becomes the carrier;
 *   - EVERYTHING else propagates untouched (fail loud, no re-wrap).
 *
 * The carrier string is `[research-control] <CODE>: <message>` — the RPC
 * face extracts the code from the prefix (same contract as the
 * plan-writer and dependency carriers).
 */

import { RunBindingError } from '../runbinding/types.js'
import { SemanticDomainError } from '../../domain/semantics/types.js'

export function mapSemanticsError(e: unknown): unknown {
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
