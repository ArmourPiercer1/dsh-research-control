/**
 * WP-1.1 — ID prefix registry (loader-local copy).
 *
 * Source of truth: DOMAIN_SCHEMA.md §1.1 (frozen prefix registry + format
 * `<PREFIX>-<正整数>`, regex `^[A-Z]+-[1-9][0-9]*$`, rule 4 "ID 解析按最长前缀优先").
 *
 * The frozen shared home for this registry is `src/shared/ids/` (ARCHITECTURE
 * §2.1) — owned by WP-1.6 (parallel dispatch, file ownership 互斥). This module
 * keeps a loader-local copy so the pure kernel has no cross-WP import; a
 * later integration WP may re-export it from the shared registry without
 * changing behavior (the tables below are transcribed verbatim from §1.1).
 */

/** Full frozen prefix registry, DOMAIN_SCHEMA §1.1 (all 24 prefixes). */
export const ID_PREFIXES: readonly string[] = [
  'PRJ',
  'TPC',
  'WS',
  'TE',
  'PF',
  'T',
  'G',
  'M',
  'R',
  'C',
  'F',
  'A',
  'REL',
  'OBJ',
  'IV',
  'NA',
  'BLK',
  'INT',
  'RPT',
  'SEV',
  'H',
  'IN',
  'DS',
  'MA',
  'AN',
] as const

/**
 * ID patterns for the declarative (`.research/`) object kinds, transcribed
 * verbatim from schema/common.schema.json `$defs` (frozen machine contract).
 */
export const DECLARATIVE_ID_PATTERNS: Readonly<Record<string, RegExp>> = {
  PRJ: /^PRJ-[1-9][0-9]*$/,
  TPC: /^TPC-[1-9][0-9]*$/,
  WS: /^WS-[1-9][0-9]*$/,
  TE: /^TE-[1-9][0-9]*$/,
  T: /^T-[1-9][0-9]*$/,
  G: /^G-[1-9][0-9]*$/,
  M: /^M-[1-9][0-9]*$/,
  OBJ: /^OBJ-[1-9][0-9]*$/,
}

/**
 * Resolve an id to its prefix using LONGEST-PREFIX-FIRST (DOMAIN_SCHEMA §1.1
 * rule 4: `TE`/`T`, `INT`/`IN`, `RPT`/`R`, `MA`/`M`, … have containment
 * relationships and must resolve to the longest).
 *
 * Returns the prefix when `id` matches `<PREFIX>-<正整数>` for some registered
 * prefix, else `null`.
 */
export function idPrefix(id: string): string | null {
  let best: string | null = null
  for (const prefix of ID_PREFIXES) {
    const head = prefix + '-'
    if (!id.startsWith(head)) continue
    const rest = id.slice(head.length)
    if (!/^[1-9][0-9]*$/.test(rest)) continue
    if (best === null || prefix.length > best.length) best = prefix
  }
  return best
}

/** True when `name` is a valid id of the given prefix kind (e.g. `'TPC'`). */
export function isValidId(name: string, prefix: string): boolean {
  const pattern = DECLARATIVE_ID_PATTERNS[prefix]
  return pattern !== undefined && pattern.test(name)
}
