/**
 * WP-2.3 — derived-state map: key format + strict-JSON + canonical form.
 *
 * The replay engine rebuilds the `derived_state` table (DOMAIN_SCHEMA §15
 * L627: PK `(object_kind, object_id)`, `state` JSON, 「replaced wholesale」,
 * rebuildable by replay — TC-HIST-006). In memory that table is a map keyed
 * by a single STRING `objectKind:objectId` (no object id in the frozen id
 * alphabet — T-1 / R-1 / WS-1 / H-1001 / TPC-1 / … — contains a colon, so
 * the separator is unambiguous).
 *
 * Value discipline mirrors the store's (WP-2.1 `safeStringify`): only
 * STRICT JSON values are persistable (the store silently-drops guard); a
 * reducer output that is not strict JSON is a reducer bug and is rejected
 * with REPLAY_STATE before any write.
 *
 * `canonicalJson` (sorted object keys) is the equality form used by
 * `compareDerivedStates` (rebuild-vs-incremental consistency, TC-HIST-006):
 * the incremental path (store `safeStringify`) and the rebuild path may
 * store the same document with different KEY ORDER — semantic equality is
 * what the consistency check measures.
 */

import { ReplayStateError } from './errors.js'

/** A rebuilt / incrementally maintained derived-state table (keyed map). */
export type DerivedStateMap = ReadonlyMap<string, unknown>

const SEPARATOR = ':'

/** Compose the derived-state key for (objectKind, objectId). */
export function stateKey(objectKind: string, objectId: string): string {
  assertKeyPart(objectKind, 'objectKind')
  assertKeyPart(objectId, 'objectId')
  return `${objectKind}${SEPARATOR}${objectId}`
}

function assertKeyPart(value: string, what: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ReplayStateError(`${what} must be a non-empty string (derived_state key part)`)
  }
  if (value.includes(SEPARATOR)) {
    throw new ReplayStateError(
      `${what} must not contain "${SEPARATOR}" (the derived_state key separator)`,
    )
  }
}

/** Split a derived-state key back into (objectKind, objectId). */
export function parseStateKey(
  key: string,
): { readonly objectKind: string; readonly objectId: string } {
  if (typeof key !== 'string' || key.length === 0) {
    throw new ReplayStateError('derived_state key must be a non-empty string')
  }
  const i = key.indexOf(SEPARATOR)
  if (i <= 0 || i === key.length - 1 || key.indexOf(SEPARATOR, i + 1) !== -1) {
    throw new ReplayStateError(
      `derived_state key "${key}" is malformed — expected "<objectKind>:<objectId>" ` +
        'with exactly one separator and non-empty parts',
    )
  }
  const objectKind = key.slice(0, i)
  const objectId = key.slice(i + 1)
  assertKeyPart(objectKind, 'objectKind')
  assertKeyPart(objectId, 'objectId')
  return { objectKind, objectId }
}

/**
 * Strict-JSON gate (mirrors WP-2.1 `assertJsonValue`): only null, string,
 * boolean, FINITE number, arrays and PLAIN objects (no Date/RegExp/Map/custom
 * class, no symbol keys, no undefined values) are persistable. Depth-capped
 * (64). Throws {@link ReplayStateError} — a reducer emitting any other value
 * would be silently corrupted by `JSON.stringify`, so it is rejected.
 */
export function assertStrictJson(value: unknown, what: string, depth = 0): void {
  if (depth > 64) {
    throw new ReplayStateError(`${what}: nesting deeper than 64 levels — refusing to persist`)
  }
  if (value === null) return
  const t = typeof value
  if (t === 'string' || t === 'boolean') return
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new ReplayStateError(`${what}: non-finite number (NaN/±Infinity are not JSON)`)
    }
    return
  }
  if (t === 'function' || t === 'symbol' || t === 'bigint' || t === 'undefined') {
    throw new ReplayStateError(`${what}: not a strict JSON value (got ${t})`)
  }
  if (Array.isArray(value)) {
    for (const item of value) assertStrictJson(item, what, depth + 1)
    return
  }
  const obj = value as Record<string, unknown>
  const proto = Object.getPrototypeOf(obj)
  if (proto !== Object.prototype && proto !== null) {
    const name = (obj as { constructor?: { name?: string } }).constructor?.name ?? 'unknown'
    throw new ReplayStateError(
      `${what}: contains a non-plain object (${name}) — strict JSON only (no Date/RegExp/Map/...)`,
    )
  }
  if (Object.getOwnPropertySymbols(obj).length > 0) {
    throw new ReplayStateError(`${what}: contains symbol-keyed properties — not JSON`)
  }
  for (const v of Object.values(obj)) assertStrictJson(v, what, depth + 1)
}

/**
 * Canonical JSON: objects with keys sorted lexicographically (arrays keep
 * order). The deterministic equality form for derived-state documents —
 * two states are semantically equal iff their canonical forms are byte
 * equal. The input must be strict JSON (assert first).
 */
export function canonicalJson(value: unknown): string {
  assertStrictJson(value, 'derived_state value')
  return stringifyCanonical(value)
}

function stringifyCanonical(value: unknown): string {
  if (value === null) return 'null'
  const t = typeof value
  if (t === 'string' || t === 'boolean') return JSON.stringify(value)
  if (t === 'number') {
    // assertStrictJson already guaranteed finiteness.
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stringifyCanonical(v)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stringifyCanonical(obj[k])}`).join(',')}}`
}
