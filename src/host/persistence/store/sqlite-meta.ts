/**
 * WP-2.1 — the `sqlite` backend of the WP-1.6 reserved `MetaStore`
 * interface (src/host/persistence/meta/meta-store.ts): the SAME surface —
 * simple KV plus the `IdCounterPort` counter face — against the §15
 * `meta` table inside research.sqlite.
 *
 * Guarantees matching the reserved contract:
 *   - values are canonical decimal integer strings under counter keys
 *     (1:1 port with the in-memory backend's encoding);
 *   - `bumpCounter` is ONE atomic SQL statement
 *     (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) — the atomicity
 *     guarantee the WP-1.6 seam reserved: it holds across connections,
 *     not just within one process;
 *   - corruption guard: a counter key whose value is not a non-negative
 *     safe integer throws on read/bump (fail loud, never mis-allocate) —
 *     structured as `StoreCorruptError` in this backend.
 *
 * The handle is bound to the owning store's connection: every method
 * asserts the store is still open (`STORE_CLOSED` otherwise) — the store
 * is the single owner of the DatabaseSync lifecycle.
 */

import type { StatementSync } from 'node:sqlite'

import type { MetaStore } from '../meta/index.js'
import { StoreCorruptError, StoreInputError } from './errors.js'

/**
 * Minimal live-connection port the meta store consumes. Implemented by the
 * owning store (store.ts) so this module never touches the connection or
 * the closed-state bookkeeping directly.
 */
export interface MetaDbPort {
  /** Throw `STORE_CLOSED` when the owning store is closed. */
  assertOpen(): void
  /** Prepare a statement on the live connection (post-open-assertion). */
  prepare(sql: string): StatementSync
}

/** The single atomic bump (WP-1.6 reserved seam): INSERT for the unset
 *  counter (0 + delta), upsert-accumulate when set, RETURNING the new
 *  value — one round-trip, no read-modify-write window. */
const BUMP_SQL =
  'INSERT INTO meta (key, value) VALUES (?, ?) ' +
  'ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + CAST(excluded.value AS INTEGER) ' +
  'RETURNING value'

export class SqliteMetaStore implements MetaStore {
  readonly backend = 'sqlite' as const

  constructor(private readonly port: MetaDbPort) {}

  private stmt(sql: string): StatementSync {
    this.port.assertOpen()
    return this.port.prepare(sql)
  }

  // --- simple KV (§15 L628: DB schema 版本等) ---

  get(key: string): string | null {
    assertNonEmptyKey(key)
    const row = this.stmt('SELECT value FROM meta WHERE key = ?').get(key)
    return row === undefined ? null : String(row.value)
  }

  set(key: string, value: string): void {
    assertNonEmptyKey(key)
    if (typeof value !== 'string') {
      throw new StoreInputError(`meta.set: value must be a string (got ${typeof value})`)
    }
    this.stmt(
      'INSERT INTO meta (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value)
  }

  /** No-op when absent. Meta rows are bookkeeping, not first-class
   *  identity (the §15 通则 deletion ban does not apply — same as the
   *  WP-1.6 memory backend). */
  delete(key: string): void {
    assertNonEmptyKey(key)
    this.stmt('DELETE FROM meta WHERE key = ?').run(key)
  }

  keys(): string[] {
    const rows = this.stmt('SELECT key FROM meta ORDER BY key').all()
    return rows.map((r) => String(r.key))
  }

  // --- counter face (satisfies shared IdCounterPort) ---

  /** Read the integer counter at `key`; 0 when unset. @throws
   *  {@link StoreCorruptError} when the stored value is not a
   *  non-negative safe integer. */
  getCounter(key: string): number {
    assertNonEmptyKey(key)
    const raw = this.get(key)
    if (raw === null) return 0
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new StoreCorruptError(
        `meta corruption: counter "${key}" holds ${JSON.stringify(raw)}, ` +
          'expected a non-negative integer',
      )
    }
    return value
  }

  /** Atomically bump the counter by `delta` (default 1) and return the
   *  NEW value — one SQL statement (see BUMP_SQL); a cross-connection
   *  atomicity upgrade over the in-memory backend. @throws RangeError on
   *  an invalid delta (mirrors the WP-1.6 surface), {@link
   *  StoreCorruptError} on stored-value corruption. */
  bumpCounter(key: string, delta = 1): number {
    assertNonEmptyKey(key)
    if (!Number.isSafeInteger(delta) || delta < 1) {
      throw new RangeError(`invalid counter delta ${String(delta)} — must be a positive safe integer`)
    }
    // Corruption guard BEFORE the atomic bump (the bump itself stays a
    // single statement; the guard is a read, not part of the update).
    this.getCounter(key)
    const row = this.stmt(BUMP_SQL).get(key, String(delta))
    const next = Number(row?.value)
    if (!Number.isSafeInteger(next) || next < 0) {
      throw new StoreCorruptError(
        `meta corruption: counter "${key}" bumped to ${String(row?.value)}, ` +
          'expected a non-negative integer',
      )
    }
    return next
  }
}

function assertNonEmptyKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new StoreInputError('meta: key must be a non-empty string')
  }
}
