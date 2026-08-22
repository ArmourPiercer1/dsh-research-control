/**
 * ID construction — DOMAIN_SCHEMA.md §1.1 格式 (L14): `<PREFIX>-<正整数>`.
 *
 * The frozen spec defines exactly ONE form: a registered prefix plus the
 * positive integer allocated from the (monotonic) project counter. There is
 * no timestamp form in §1.1 (见 WP-1.6 报告「关键决策」); constructing
 * anything else would violate the frozen format regex.
 *
 * Pure function surface (zero I/O, WP-1.6 boundary).
 */

import { prefixForKind } from './registry.js'
import type { IdKind } from './types.js'

/**
 * Build the canonical ID string for `kind` + `sequence`
 * (e.g. `makeId('TOPOLOGY_EDGE', 17)` → `'TE-17'`).
 *
 * @throws RangeError when `sequence` is not a positive safe integer
 *   (the §1.1 regex admits no zero, no leading zeros; safe-integer bound
 *   matches the parse side and the SQLite INTEGER backend of WP-2.1).
 */
export function makeId(kind: IdKind, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError(
      `invalid sequence ${String(sequence)} for kind ${kind} — §1.1 requires a positive integer (1..Number.MAX_SAFE_INTEGER)`,
    )
  }
  return `${prefixForKind(kind)}-${sequence}`
}
