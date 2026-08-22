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
  return {
    exec(sql: string): void {
      try {
        db.exec(sql)
      } catch (cause) {
        throw wrap('exec', sql, cause)
      }
    },
    run(sql: string, ...params: SqlParam[]): number {
      try {
        return Number(db.prepare(sql).run(...params).changes)
      } catch (cause) {
        throw wrap('run', sql, cause)
      }
    },
    get(sql: string, ...params: SqlParam[]): Record<string, unknown> | undefined {
      try {
        return db.prepare(sql).get(...params) as Record<string, unknown> | undefined
      } catch (cause) {
        throw wrap('get', sql, cause)
      }
    },
    all(sql: string, ...params: SqlParam[]): Record<string, unknown>[] {
      try {
        return db.prepare(sql).all(...params) as Record<string, unknown>[]
      } catch (cause) {
        throw wrap('all', sql, cause)
      }
    },
    transaction<T>(work: () => T): T {
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
