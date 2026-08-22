/**
 * WP-3.6 (RR-013 / G2 r2 inv-attacker) — the store-connection guard:
 * REPLACE-class write rejection on the connection `openDatabase` owns.
 *
 * ## The threat (RR-013, empirically established at G2 r2)
 *
 * The `history_event` table is append-only by construction — the
 * `ResearchStore` type surface has no update/delete/rewrite method AND the
 * V1 DDL installs BEFORE UPDATE / BEFORE DELETE triggers on
 * `history_event` that RAISE(ABORT) raw UPDATE/DELETE. The G2 r2
 * inv-attacker showed the trigger claim had a hole: SQLite's
 * `INSERT … OR REPLACE` / `REPLACE INTO` resolves the primary-key conflict
 * with an INTERNAL delete of the conflicting row that does NOT fire DELETE
 * triggers (verified: a BEFORE DELETE ABORT trigger is bypassed by
 * `INSERT OR REPLACE`, which then silently rewrites/deletes event rows).
 *
 * ## Why the authorizer alone cannot close it
 *
 * `DatabaseSync#setAuthorizer` (node:sqlite, available since Node v24.10)
 * is a COMPILE-TIME callback: it sees the statement's top-level actions
 * only. Empirically (sqlite3 authorizer API, same semantics),
 * `REPLACE INTO t` and `INSERT OR REPLACE INTO t` are both compiled to a
 * single `SQLITE_INSERT` action on `t` — indistinguishable from the store's
 * own legitimate INSERT. The internal conflict-row delete is a runtime
 * VDBE operation the authorizer never sees. So the statement TEXT is the
 * only surface on which the REPLACE class is detectable — hence the
 * prepare/exec statement gate below.
 *
 * ## The guard (two layers, both installed by `openDatabase`)
 *
 *  1. STATEMENT GATE (every supported Node runtime, incl. 22.x):
 *     `prepare` / `exec` on the store's own connection are wrapped so that
 *     any statement carrying a REPLACE-class conflict resolution targeting
 *     `history_event` is rejected BEFORE it reaches the driver —
 *     structured `STORE_SQL_FORBIDDEN`, never a raw driver exception:
 *       - `REPLACE INTO [schema.]history_event …` (shorthand);
 *       - `INSERT OR REPLACE INTO [schema.]history_event …`;
 *       - `INSERT INTO [schema.]history_event … ON CONFLICT … REPLACE …`.
 *     The scan is string-literal aware: single-quoted DATA (event payloads
 *     are arbitrary JSON text) is masked before matching, so a payload that
 *     merely contains the words "OR REPLACE" can never be rejected or make
 *     the scan miss — only structural (statement-level) REPLACE tokens
 *     count. Double-quoted identifiers keep their content (structural);
 *     comments are stripped.
 *  2. AUTHORIZER (feature-detected, Node ≥24.10): an action-level
 *     backstop that DENYs `SQLITE_UPDATE` / `SQLITE_DELETE` on
 *     `history_event` (the trigger's job, enforced at the driver level
 *     even for paths the trigger text could not reach) — everything else
 *     is allowed so the store's own statements (PRAGMA / transaction /
 *     SELECT / INSERT / the `derived_state` upserts / `meta` statements)
 *     are untouched. On runtimes without `setAuthorizer` this layer is
 *     skipped silently; the statement gate + the storage triggers + the
 *     (frozen) DDL pin (TC-DB-004) carry the guarantee.
 *
 * Scope (RR-013): the guard protects the CANONICAL connection — the one
 * `openDatabase` opens and the `ResearchStore` uses. The raw `DatabaseSync`
 * is never exposed through any business surface (INV-HIST-1 boundary), so
 * there is no runtime-reachable second connection to the file; the guard is
 * the defense-in-depth layer that keeps the canonical connection safe even
 * if a future code path reuses it for raw SQL. Raw UPDATE/DELETE through
 * any connection remain the TRIGGER's domain (their claim is unchanged);
 * this module adds the REPLACE-class half of the enforcement story.
 *
 * No DSH imports (INV-PERM-5): `node:sqlite` is a Node builtin.
 */

import type { DatabaseSync } from 'node:sqlite'

import { StoreForbiddenSqlError } from './errors.js'

/** The action-code table of the SQLite authorizer callback (sqlite3.h,
 *  the modern numbering shipped by Node 22/24's bundled SQLite ≥3.46). */
const SQLITE_DELETE = 9
const SQLITE_UPDATE = 23
/** Authorizer verdicts (sqlite3.h). */
const SQLITE_OK = 0
const SQLITE_DENY = 1

/** `node:sqlite` gained `DatabaseSync#setAuthorizer` in Node v24.10; the
 *  frozen-baseline runtime (Node 22.x) has no such method. */
interface AuthorizerCapableDb {
  setAuthorizer?(
    callback: (
      actionCode: number,
      arg1: string | null,
      arg2: string | null,
      dbName: string | null,
      triggerOrView: string | null,
    ) => number,
  ): void
}

/**
 * Mask the parts of a SQL statement that carry DATA, keeping the
 * STRUCTURAL text: single-quoted string literals (with the `''` escape)
 * become `''` placeholders; `--` line and block-style comments become
 * whitespace; double-quoted and backtick-quoted identifiers keep their
 * content (an identifier named after a keyword is structure, and
 * `history_event` has no column whose name could contain `REPLACE` — a
 * false positive would require a statement that SQLite itself rejects).
 */
function stripDataLiterals(sql: string): string {
  let out = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]!
    if (c === "'") {
      i += 1
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2
            continue
          }
          i += 1
          break
        }
        i += 1
      }
      out += "''"
    } else if (c === '"' || c === '`') {
      const quote = c
      out += c
      i += 1
      while (i < n) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            out += quote + quote
            i += 2
            continue
          }
          out += quote
          i += 1
          break
        }
        out += sql[i]
        i += 1
      }
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i += 1
      out += ' '
    } else if (c === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1
      i += 2
      out += ' '
    } else {
      out += c
      i += 1
    }
  }
  return out
}

/** `[schema.]history_event` with optional identifier quoting. */
const EVENT_TABLE = '(?:[A-Z_][A-Z0-9_]*\\.)?"?HISTORY_EVENT"?\\b'

/** `REPLACE INTO [schema.]history_event` (shorthand form). */
const RE_REPLACE_INTO = new RegExp(`\\bREPLACE\\s+INTO\\s+${EVENT_TABLE}`)

/** `INSERT [OR REPLACE] INTO [schema.]history_event`; group 1 = the
 *  `OR REPLACE` conflict prefix when present. */
const RE_INSERT_INTO_EVENT = new RegExp(`\\bINSERT\\s+(OR\\s+REPLACE\\s+)?INTO\\s+${EVENT_TABLE}`)

/**
 * Detect a REPLACE-class write of the event log.
 *
 * @param sql - the full statement text.
 * @returns a precise human-readable reason when the statement carries a
 *  REPLACE-class conflict resolution targeting `history_event` (shorthand
 *  `REPLACE INTO`, `INSERT … OR REPLACE`, or `ON CONFLICT … REPLACE`),
 *  otherwise `null` (statement is not of the forbidden class).
 *  Pure and total — never throws.
 */
export function classifyForbiddenWrite(sql: string): string | null {
  if (typeof sql !== 'string' || sql.length === 0) return null
  const norm = stripDataLiterals(sql).toUpperCase().replace(/\s+/g, ' ')
  if (RE_REPLACE_INTO.test(norm)) {
    return 'REPLACE INTO history_event is a REPLACE-class write — it bypasses the BEFORE DELETE trigger (RR-013) and is forbidden on the store connection'
  }
  const m = RE_INSERT_INTO_EVENT.exec(norm)
  if (m !== null) {
    if (m[1] !== undefined) {
      return 'INSERT OR REPLACE INTO history_event is a REPLACE-class write — it bypasses the BEFORE DELETE trigger (RR-013) and is forbidden on the store connection'
    }
    // An INSERT into the event table that carries the structural token
    // REPLACE anywhere else in the statement is the
    // `ON CONFLICT … REPLACE` clause (the only other structural position —
    // data was masked above, and no column/identifier of history_event
    // contains the word).
    if (/\bREPLACE\b/.test(norm)) {
      return 'INSERT … ON CONFLICT … REPLACE on history_event is a REPLACE-class write — it bypasses the BEFORE DELETE trigger (RR-013) and is forbidden on the store connection'
    }
  }
  return null
}

/**
 * Install the store-connection guard on `db` (the connection
 * `openDatabase` owns):
 *   1. shadows `prepare` / `exec` with the REPLACE-class statement gate;
 *   2. when the runtime provides `setAuthorizer` (Node ≥24.10), installs
 *      the action-level backstop (DENY UPDATE/DELETE on `history_event`).
 *
 * Idempotency is NOT claimed: call exactly once, on a freshly opened
 * connection, before any other user of the connection (the store is the
 * first). The wrapped methods keep the original signatures and forward
 * everything they do not reject.
 */
export function installStoreConnectionGuard(db: DatabaseSync): void {
  if (db === null || typeof db !== 'object') {
    throw new TypeError('installStoreConnectionGuard: db must be a DatabaseSync')
  }
  const anyDb = db as unknown as Record<string, unknown>
  const origPrepare = db.prepare.bind(db) as (sql: string) => unknown
  const origExec = db.exec.bind(db) as (sql: string) => void

  const gate = (sql: string, entry: string): void => {
    const reason = classifyForbiddenWrite(sql)
    if (reason !== null) {
      throw new StoreForbiddenSqlError(`store connection ${entry}: ${reason}`, {
        cause: new Error(`statement: ${sql}`),
      })
    }
  }

  anyDb.prepare = (sql: string): unknown => {
    gate(sql, 'prepare')
    return origPrepare(sql)
  }
  anyDb.exec = (sql: string): void => {
    gate(sql, 'exec')
    origExec(sql)
  }

  const cap = (db as unknown as AuthorizerCapableDb).setAuthorizer
  if (typeof cap === 'function') {
    // Action-level backstop (compile-time): the trigger's UPDATE/DELETE
    // denial, re-enforced at the driver on the canonical connection.
    cap.call(db, (actionCode, arg1) => {
      if (
        (actionCode === SQLITE_DELETE || actionCode === SQLITE_UPDATE) &&
        arg1 === 'history_event'
      ) {
        return SQLITE_DENY
      }
      return SQLITE_OK
    })
  }
}
