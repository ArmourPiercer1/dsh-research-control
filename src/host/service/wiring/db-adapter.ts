/**
 * WP-3.6 (RR-011 (d)) — adapt a raw `node:sqlite` `DatabaseSync`
 * connection to the domain/service `PlanForkDb` structural port (also the
 * `FloodingDb` alias — flooding/types.ts re-exports the same shape).
 *
 * The dual-connection pattern (WP-2.1 store connection = the event log +
 * meta; per-WP SECOND connection = the §15 table face) is the established
 * production shape: runbinding (`openRunBindingTables`), planfork and
 * flooding each open their own `DatabaseSync` on the SAME WAL file and
 * adapt it to their structural port. This module is the wiring's shared
 * adapter for the planfork + flooding second connections (the runbinding
 * table face keeps its own richer adapter in runbinding/tables.ts).
 *
 * No DSH imports (INV-PERM-5): `node:sqlite` is a Node builtin.
 */

import type { DatabaseSync } from 'node:sqlite'

import type { PlanForkDb, SqlParam } from '../../domain/planfork/index.js'
import { HostWiringError } from './types.js'

/**
 * Adapt `db` to the `PlanForkDb` port.
 *
 * - `exec` — one-or-more statements without parameters (idempotent DDL);
 * - `run` — one parameterized write, returning affected rows;
 * - `get` / `all` — parameterized reads (row shape is the caller's
 *   responsibility — the domain maps them);
 * - `transaction` — ONE `BEGIN IMMEDIATE … COMMIT` unit (any throw →
 *   `ROLLBACK`; the roll-back itself is best-effort — the transaction may
 *   already be dead, e.g. on a constraint abort).
 *
 * Failures are wrapped as structured `HostWiringError`s (`WIRING_PLANFORK`
 * scope — the wiring layer owns both the planfork and the flooding second
 * connections) so the `[Service.init]` caller never sees a raw driver
 * exception.
 */
export function adaptDatabaseSync(db: DatabaseSync): PlanForkDb {
  if (db === null || typeof db !== 'object') {
    throw new TypeError('adaptDatabaseSync: db must be a DatabaseSync')
  }
  /**
   * The CLOSED-CONNECTION guard（the 「database is not open」 fix）:
   * a statement executed on a CLOSED `DatabaseSync` handle raises a raw
   * driver error far from its cause — the wiring was re-initialized or
   * torn down out from under a stale reference. Every operation
   * pre-checks `isOpen` and fails loud with the actionable
   * `WIRING_CLOSED` message INSTEAD of letting the driver error surface
   * (the store/service layers pass the message through verbatim, so the
   * user sees WHY + the remedy, not a SQLite internal). The guard sits
   * BEFORE the try so its own structured error is not re-wrapped by
   * {@link wrap}.
   */
  const assertOpen = (operation: string, sql: string): void => {
    if (db.isOpen === false) {
      throw new HostWiringError(
        'WIRING_CLOSED',
        `the wiring second connection was closed before ${operation} (the research plane was ` +
          `re-initialized or torn down — a live console re-resolves the wiring on its next call; ` +
          `reload the console if this error persists) (statement: ${sql})`,
      )
    }
  }
  return {
    exec(sql: string): void {
      assertOpen('exec', sql)
      try {
        db.exec(sql)
      } catch (cause) {
        throw wrap('exec', sql, cause)
      }
    },
    run(sql: string, ...params: SqlParam[]): number {
      assertOpen('run', sql)
      try {
        return Number(db.prepare(sql).run(...params).changes)
      } catch (cause) {
        throw wrap('run', sql, cause)
      }
    },
    get(sql: string, ...params: SqlParam[]): Record<string, unknown> | undefined {
      assertOpen('get', sql)
      try {
        return db.prepare(sql).get(...params) as Record<string, unknown> | undefined
      } catch (cause) {
        throw wrap('get', sql, cause)
      }
    },
    all(sql: string, ...params: SqlParam[]): Record<string, unknown>[] {
      assertOpen('all', sql)
      try {
        return db.prepare(sql).all(...params) as Record<string, unknown>[]
      } catch (cause) {
        throw wrap('all', sql, cause)
      }
    },
    transaction<T>(work: () => T): T {
      assertOpen('BEGIN IMMEDIATE', 'BEGIN IMMEDIATE')
      try {
        db.exec('BEGIN IMMEDIATE')
      } catch (cause) {
        throw wrap('BEGIN IMMEDIATE', 'BEGIN IMMEDIATE', cause)
      }
      try {
        const result = work()
        try {
          db.exec('COMMIT')
        } catch (cause) {
          try {
            db.exec('ROLLBACK')
          } catch {
            /* the transaction may already be dead */
          }
          throw wrap('COMMIT', 'COMMIT', cause)
        }
        return result
      } catch (cause) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* the transaction may already be dead */
        }
        throw cause
      }
    },
  }
}

function wrap(operation: string, sql: string, cause: unknown): HostWiringError {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new HostWiringError(
    'WIRING_PLANFORK',
    `wiring second connection ${operation} failed: ${message} (statement: ${sql})`,
    { cause },
  )
}
