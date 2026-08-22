/**
 * ID parsing — DOMAIN_SCHEMA.md §1.1 规则 4 (L51): 「ID 解析按**最长前缀优先**
 * （`TE`/`T`、`INT`/`IN` 等有前缀包含关系）」.
 *
 * Pure function surface (zero I/O, WP-1.6 boundary).
 *
 * Algorithm (longest-prefix-first + exactness):
 *   1. The input must match the frozen format regex `^[A-Z]+-[1-9][0-9]*$`
 *      (§1.1 L14) — uppercase prefix run, dash, positive integer without a
 *      leading zero.
 *   2. Let `run` be the uppercase run before the dash. Among the registered
 *      prefixes that are a leading substring of `run`, take the LONGEST
 *      (rule 4). Example resolutions: `TE` → `TE` (not `T`), `INT` → `INT`
 *      (not `IN`), `TPC` → `TPC` (not `T`), `REL`/`RPT` → not `R`,
 *      `MA` → not `M`, `AN` → not `A`.
 *   3. The run must equal the matched prefix exactly — a run that merely
 *      EXTENDS a registered prefix (`TEX-1`, `TTE-1`) names an unregistered
 *      prefix and is rejected (§1.1: the registry is frozen; new prefixes
 *      require a schema-version bump).
 *   4. The sequence must be a safe integer: V1 counters are JS numbers here
 *      and SQLite INTEGERs in WP-2.1; the frozen regex admits longer digit
 *      runs, which parse rejects (strictness note, see WP-1.6 report).
 */

import { ALL_PREFIXES, entryForPrefix } from './registry.js'
import type { IdKind } from './types.js'

/** The frozen §1.1 format regex (L14): `<PREFIX>-<正整数>`. */
export const ID_PATTERN = /^[A-Z]+-[1-9][0-9]*$/

/** Decomposed form of one well-formed research ID. */
export interface ParsedId {
  /** The object kind resolved from the (longest) prefix. */
  readonly kind: IdKind
  /** The registered prefix string, e.g. `TE`. */
  readonly prefix: string
  /** The positive-integer sequence (counter value), e.g. `17`. */
  readonly sequence: number
  /** The original input string (canonical: no leading zeros). */
  readonly raw: string
}

const PARSE_RE = /^([A-Z]+)-([1-9][0-9]*)$/

/** Registered prefixes ordered longest-first (rule 4's resolution order). */
const PREFIXES_BY_LENGTH_DESC: readonly string[] = [...ALL_PREFIXES].sort((a, b) => b.length - a.length)

/**
 * Longest-prefix match (rule 4): the longest registered prefix that is a
 * leading substring of `letterRun`; `null` when none matches.
 *
 * `TE` → `TE`, `T` → `T`, `INT` → `INT`, `IN` → `IN`, `TEX` → `TE`
 * (the caller then rejects the non-exact run), `X` → `null`.
 */
export function longestPrefixMatch(letterRun: string): string | null {
  for (const prefix of PREFIXES_BY_LENGTH_DESC) {
    if (letterRun.startsWith(prefix)) return prefix
  }
  return null
}

/**
 * Parse a research ID. Returns `null` (not throws) for anything that is not
 * a well-formed ID of a registered prefix — callers that need the throwing
 * form use {@link assertId}.
 */
export function parseId(id: string): ParsedId | null {
  const match = PARSE_RE.exec(id)
  if (match === null) return null
  const run = match[1]!
  const prefix = longestPrefixMatch(run)
  // Rule 4 picks the longest matching registered prefix; exactness then
  // requires the run to BE that prefix (rejects `TEX-1` via `TE`, …).
  if (prefix === null || run !== prefix) return null
  const entry = entryForPrefix(prefix)
  if (entry === undefined) return null
  const sequence = Number(match[2]!)
  if (!Number.isSafeInteger(sequence)) return null
  return { kind: entry.kind, prefix, sequence, raw: id }
}

/** Throwing form of {@link parseId} (load-time / boundary validation). */
export function assertId(id: string): ParsedId {
  const parsed = parseId(id)
  if (parsed === null) {
    throw new Error(
      `invalid research id: ${JSON.stringify(id)} — expected <PREFIX>-<positive integer> with one of the 25 frozen prefixes (DOMAIN_SCHEMA §1.1)`,
    )
  }
  return parsed
}

/** True iff `id` is a well-formed ID of any registered prefix. */
export function isValidId(id: string): boolean {
  return parseId(id) !== null
}

/** True iff `id` is well-formed AND resolves to exactly `kind`. */
export function idMatchesKind(id: string, kind: IdKind): boolean {
  const parsed = parseId(id)
  return parsed !== null && parsed.kind === kind
}
