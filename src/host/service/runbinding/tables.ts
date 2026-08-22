/**
 * WP-2.4 — runbinding tables: the `run` + `discovered_session` table face.
 *
 * DB access follows the persistence/store pattern (task boundary: 「DB 访问
 * 经 persistence/store 模式自建表或复用其 DatabaseSync 封装（表定义放本目录，
 * openDatabase 复用）」):
 *
 *   1. `openRunBindingDatabase(path)` FIRST calls the WP-2.1
 *      `openDatabase` wrapper — the file init (owner-only 0o700/0o600),
 *      the WAL setup, the `user_version` gate and the quick_check
 *      corruption probe all belong to that wrapper, exactly as for the
 *      core three tables;
 *   2. it then opens a SECOND `node:sqlite` `DatabaseSync` connection on
 *      the SAME file and applies this WP's DDL (schema.ts: §15 L615-616
 *      `run` / `discovered_session`, idempotent `IF NOT EXISTS` —
 *      pre-release does no migrations);
 *   3. the two connections coexist in WAL mode: the store connection
 *      owns the append-only event transaction, this connection owns the
 *      run/DS row transactions; writes serialize on the file lock
 *      (`busy_timeout` set here, mirroring the store's default).
 *
 * Two-connection write ordering (documented service contract, see
 * service.ts 「event-vs-row order」): History events are the 真源
 * (INV-TZ-1) and the run/DS rows are operational projections — the
 * service orders writes so that every failure mode converges by replay
 * rebuild (TC-HIST-006 semantics) rather than by a cross-connection
 * transaction (SQLite offers none).
 *
 * INV-HIST-7 存储层半边: no DELETE method on either table — and the
 * schema triggers ABORT raw DELETE even through another connection.
 * No DSH imports (INV-PERM-5).
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { resolve } from 'node:path'

import { openDatabase, type OpenDatabaseOptions, type ResearchStore } from '../../persistence/store/index.js'
import { RunBindingError } from './types.js'
import {
  DISCOVERED_SESSION_TABLE,
  RUN_TABLE,
  RUNBINDING_TABLES,
  discoveredSessionToParams,
  rowToDiscoveredSession,
  rowToRun,
  runBindingDdl,
  runToParams,
} from './schema.js'
import type {
  DiscoveredSessionListFilter,
  DiscoveredSessionRecord,
  DsState,
  RunListFilter,
  RunRecord,
} from './types.js'

/** The busy timeout for the second connection (same default as the store). */
const DEFAULT_BUSY_TIMEOUT_MS = 5000

/**
 * The run/DS table face. A plain sealed record — its own property names
 * are exactly this public surface (no hidden mutation methods; the
 * permissions test audits the surface). All operations are synchronous
 * (node:sqlite) and fail with structured `RunBindingError`s
 * (code `RB_TABLE`), never raw driver exceptions.
 */
export interface RunBindingTables {
  /** Absolute path of the shared research.sqlite file. */
  readonly path: string
  /** Close THIS connection. (The WP-2.1 `ResearchStore` connection is
   *  owned by its caller and closed separately — `openRunBindingDatabase`
   *  returns both.) Idempotent. */
  close(): void

  /* ---- run (§15 L615) ---- */

  /** Insert one run row (single statement, autocommit). */
  insertRun(run: RunRecord): void
  /**
   * Terminal status update (RUN_* end events' 副作用): status + ended_at
   * (+ optional summary). CONDITIONAL on `status = 'RUNNING'` — the §13
   * run machine only leaves RUNNING, and the condition doubles as the
   * concurrency gate for a double-terminal race (0 = the row already
   * moved; the service rejects with RB_RUN_NOT_RUNNING). Returns
   * affected rows (0 = not found or not RUNNING).
   */
  updateRunStatus(runId: string, status: Exclude<RunRecord['status'], 'RUNNING'>, endedAt: number, summary?: string): number
  /** `research_run_checkpoint` 工具 update (§6.1 last_checkpoint_*).
   *  Returns affected rows. */
  updateRunCheckpoint(runId: string, at: number, note?: string): number
  getRun(runId: string): RunRecord | null
  /** The run referencing a DSH session (most recent `started_at` when
   *  several exist — the service prevents duplicates, this is the
   *  defensive read). `null` when none. */
  getRunBySessionId(dshSessionId: string): RunRecord | null
  listRuns(filter: RunListFilter): readonly RunRecord[]
  /** All run rows (diagnostics / reconciliation). */
  listAllRuns(): readonly RunRecord[]

  /* ---- discovered_session (§15 L616) ---- */

  /** Insert one DS row (single statement, autocommit). */
  insertDiscoveredSession(ds: DiscoveredSessionRecord): void
  /**
   * One user lifecycle move: `UPDATE … SET state=<to>, [bound_run_id]
   * WHERE id=? AND state=<from>` — the optimistic state-machine gate
   * (returns 0 when the row moved concurrently). §13 L554: only PENDING
   * has legal targets; the CHECK constraint enforces bound_run_id ⇔ BOUND.
   */
  transitionDiscoveredSession(id: string, from: DsState, to: DsState, boundRunId?: string): number
  getDiscoveredSession(id: string): DiscoveredSessionRecord | null
  /** The DS row for a DSH session (UNIQUE, §15 L616). `null` when absent. */
  getDiscoveredSessionBySessionId(dshSessionId: string): DiscoveredSessionRecord | null
  listDiscoveredSessions(filter: DiscoveredSessionListFilter): readonly DiscoveredSessionRecord[]

  /**
   * ONE transaction on this connection (BEGIN IMMEDIATE … COMMIT; any
   * throw → ROLLBACK). The service composes the DS flip + run insert
   * inside a single such transaction (one atomic row-side step).
   */
  transaction<T>(work: () => T): T
}

/** The pair returned by `openRunBindingDatabase`. */
export interface RunBindingDatabase {
  /** The WP-2.1 store handle (event append + meta) on the same file. */
  readonly store: ResearchStore
  /** This WP's run/DS table face (the second connection). */
  readonly tables: RunBindingTables
}

/**
 * Open (or initialize) the research.sqlite file via the WP-2.1
 * `openDatabase` wrapper and attach this WP's run/DS table face on the
 * same file (module header, steps 1-3). Fresh files are initialized by
 * the store (core DDL + `user_version=1`) BEFORE the runbinding DDL
 * applies, so a brand-new file always ends with BOTH §15 halves.
 */
export function openRunBindingDatabase(path: string, options: OpenDatabaseOptions = {}): RunBindingDatabase {
  const store = openDatabase(path, options)
  const db = openTablesConnection(resolve(path))
  return { store, tables: makeTables(resolve(path), db) }
}

/**
 * Open only the table face on an EXISTING file that a WP-2.1
 * `openDatabase` call already validated (service-level composition when
 * the caller owns the store handle; tests use `openRunBindingDatabase`).
 */
export function openRunBindingTables(path: string, options: { busyTimeoutMs?: number } = {}): RunBindingTables {
  const db = openTablesConnection(resolve(path), options.busyTimeoutMs)
  return makeTables(resolve(path), db)
}

/* ------------------------------------------------------------------ *
 * implementation
 * ------------------------------------------------------------------ */

function openTablesConnection(abs: string, busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS): DatabaseSync {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(abs)
  } catch (e) {
    throw toTableError(`openRunBindingTables: cannot open ${abs}`, e)
  }
  try {
    // PRAGMAs take no bound parameters — interpolate the validated integer.
    assertPositiveInt(busyTimeoutMs, 'busyTimeoutMs')
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`)
    db.exec(runBindingDdl())
  } catch (e) {
    try {
      db.close()
    } catch {
      /* best effort */
    }
    throw toTableError(`openRunBindingTables: DDL at ${abs}`, e)
  }
  return db
}

function makeTables(path: string, db: DatabaseSync): RunBindingTables {
  let closed = false
  const assertOpen = (operation: string): DatabaseSync => {
    if (closed) {
      throw new RunBindingError('RB_TABLE', `${operation}: runbinding tables are closed (file ${path})`)
    }
    return db
  }
  const prepare = (operation: string, sql: string): StatementSync => assertOpen(operation).prepare(sql)
  const selectOne = (operation: string, sql: string, param: string): Record<string, unknown> | undefined => {
    const row = prepare(operation, sql).get(param)
    return row === undefined ? undefined : (row as Record<string, unknown>)
  }
  const selectMany = (operation: string, sql: string, params: (string | number)[] = []): Record<string, unknown>[] => {
    return prepare(operation, sql).all(...params) as Record<string, unknown>[]
  }

  const close = (): void => {
    if (closed) return
    closed = true
    try {
      db.close()
    } catch {
      /* a second close must not mask the disposer path */
    }
  }

  return {
    path,
    close,

    insertRun(run) {
      const params = runToParams(run)
      try {
        prepare('insertRun',
          `INSERT INTO ${RUN_TABLE} (run_id, workstream_id, task_id, dsh_session_id, status, intent, initiated_by, started_at, ended_at, summary, last_checkpoint_at, last_checkpoint_note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(...params)
      } catch (e) {
        throw toTableError(`insertRun(${run.id})`, e)
      }
    },

    updateRunStatus(runId, status, endedAt, summary) {
      try {
        const r = summary === undefined
          ? prepare('updateRunStatus',
            `UPDATE ${RUN_TABLE} SET status = ?, ended_at = ?, summary = summary WHERE run_id = ? AND status = 'RUNNING'`).run(status, endedAt, runId)
          : prepare('updateRunStatus',
            `UPDATE ${RUN_TABLE} SET status = ?, ended_at = ?, summary = ? WHERE run_id = ? AND status = 'RUNNING'`).run(status, endedAt, summary, runId)
        return Number(r.changes)
      } catch (e) {
        throw toTableError(`updateRunStatus(${runId})`, e)
      }
    },

    updateRunCheckpoint(runId, at, note) {
      try {
        const r = note === undefined
          ? prepare('updateRunCheckpoint', `UPDATE ${RUN_TABLE} SET last_checkpoint_at = ? WHERE run_id = ?`).run(at, runId)
          : prepare('updateRunCheckpoint', `UPDATE ${RUN_TABLE} SET last_checkpoint_at = ?, last_checkpoint_note = ? WHERE run_id = ?`).run(at, note, runId)
        return Number(r.changes)
      } catch (e) {
        throw toTableError(`updateRunCheckpoint(${runId})`, e)
      }
    },

    getRun(runId) {
      const row = selectOne('getRun', `SELECT * FROM ${RUN_TABLE} WHERE run_id = ?`, runId)
      return row === undefined ? null : rowToRun(row)
    },

    getRunBySessionId(dshSessionId) {
      const row = selectOne('getRunBySessionId',
        `SELECT * FROM ${RUN_TABLE} WHERE dsh_session_id = ? ORDER BY started_at DESC, run_id DESC LIMIT 1`,
        dshSessionId)
      return row === undefined ? null : rowToRun(row)
    },

    listRuns(filter) {
      const clauses: string[] = []
      const params: (string | number)[] = []
      if (filter.workstreamId !== undefined) {
        assertNonEmpty(filter.workstreamId, 'filter.workstreamId')
        clauses.push('workstream_id = ?')
        params.push(filter.workstreamId)
      }
      if (filter.status !== undefined) {
        if (!isRunStatus(filter.status)) throw inputError(`filter.status must be one of ${JSON.stringify(RUN_STATUSES_LOCAL)}`)
        clauses.push('status = ?')
        params.push(filter.status)
      }
      if (filter.dshSessionId !== undefined) {
        assertNonEmpty(filter.dshSessionId, 'filter.dshSessionId')
        clauses.push('dsh_session_id = ?')
        params.push(filter.dshSessionId)
      }
      const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
      const rows = selectMany('listRuns', `SELECT * FROM ${RUN_TABLE} ${where} ORDER BY started_at DESC, run_id DESC`, params)
      return rows.map(rowToRun)
    },

    listAllRuns() {
      return selectMany('listAllRuns', `SELECT * FROM ${RUN_TABLE} ORDER BY started_at ASC, run_id ASC`).map(rowToRun)
    },

    insertDiscoveredSession(ds) {
      const params = discoveredSessionToParams(ds)
      try {
        prepare('insertDiscoveredSession',
          `INSERT INTO ${DISCOVERED_SESSION_TABLE} (id, dsh_session_id, workspace_root, discovered_at, state, bound_run_id, summary)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(...params)
      } catch (e) {
        throw toTableError(`insertDiscoveredSession(${ds.id})`, e)
      }
    },

    transitionDiscoveredSession(id, from, to, boundRunId) {
      if (!isDsState(from) || !isDsState(to)) {
        throw inputError(`transitionDiscoveredSession: invalid state (from=${String(from)}, to=${String(to)})`)
      }
      try {
        const r = boundRunId === undefined
          ? prepare('transitionDiscoveredSession',
            `UPDATE ${DISCOVERED_SESSION_TABLE} SET state = ? WHERE id = ? AND state = ?`).run(to, id, from)
          : prepare('transitionDiscoveredSession',
            `UPDATE ${DISCOVERED_SESSION_TABLE} SET state = ?, bound_run_id = ? WHERE id = ? AND state = ?`).run(to, boundRunId, id, from)
        return Number(r.changes)
      } catch (e) {
        throw toTableError(`transitionDiscoveredSession(${id})`, e)
      }
    },

    getDiscoveredSession(id) {
      const row = selectOne('getDiscoveredSession', `SELECT * FROM ${DISCOVERED_SESSION_TABLE} WHERE id = ?`, id)
      return row === undefined ? null : rowToDiscoveredSession(row)
    },

    getDiscoveredSessionBySessionId(dshSessionId) {
      const row = selectOne('getDiscoveredSessionBySessionId',
        `SELECT * FROM ${DISCOVERED_SESSION_TABLE} WHERE dsh_session_id = ?`, dshSessionId)
      return row === undefined ? null : rowToDiscoveredSession(row)
    },

    listDiscoveredSessions(filter) {
      const clauses: string[] = []
      const params: (string | number)[] = []
      if (filter.state !== undefined) {
        if (!isDsState(filter.state)) throw inputError(`filter.state must be one of ${JSON.stringify(DS_STATES_LOCAL)}`)
        clauses.push('state = ?')
        params.push(filter.state)
      }
      if (filter.workspaceRoot !== undefined) {
        assertNonEmpty(filter.workspaceRoot, 'filter.workspaceRoot')
        clauses.push('workspace_root = ?')
        params.push(filter.workspaceRoot)
      }
      const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
      const rows = selectMany('listDiscoveredSessions', `SELECT * FROM ${DISCOVERED_SESSION_TABLE} ${where} ORDER BY discovered_at ASC, id ASC`, params)
      return rows.map(rowToDiscoveredSession)
    },

    transaction(work) {
      const conn = assertOpen('transaction')
      try {
        conn.exec('BEGIN IMMEDIATE')
        try {
          const result = work()
          conn.exec('COMMIT')
          return result
        } catch (e) {
          rollbackQuietly(conn)
          throw e
        }
      } catch (e) {
        // `work()` may throw the service's own structured errors — those
        // are caller-owned and propagate UNCHANGED (already rolled back).
        // Driver/SQL failures are wrapped.
        if (e instanceof RunBindingError) throw e
        throw toTableError('transaction', e)
      }
    },
  }
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

const RUN_STATUSES_LOCAL = ['RUNNING', 'FINISHED', 'FAILED', 'CANCELLED'] as const
const DS_STATES_LOCAL = ['PENDING', 'BOUND', 'DETACHED', 'IGNORED'] as const

function isRunStatus(v: string): boolean {
  return (RUN_STATUSES_LOCAL as readonly string[]).includes(v)
}
function isDsState(v: string): boolean {
  return (DS_STATES_LOCAL as readonly string[]).includes(v)
}

function assertNonEmpty(value: string, what: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw inputError(`${what} must be a non-empty string`)
  }
}

function assertPositiveInt(value: number, what: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw inputError(`${what} must be a positive safe integer`)
  }
}

function inputError(message: string): RunBindingError {
  return new RunBindingError('RB_INPUT', message)
}

function toTableError(context: string, e: unknown): RunBindingError {
  if (e instanceof RunBindingError) return e
  const msg = e instanceof Error ? e.message : String(e)
  return new RunBindingError('RB_TABLE', `${context}: ${msg}`, { cause: e })
}

function rollbackQuietly(db: DatabaseSync): void {
  try {
    db.exec('ROLLBACK')
  } catch {
    /* the transaction may already be rolled back by the driver */
  }
}

// Re-exported for the service's diagnostics (EXPECTED tables list).
export { RUNBINDING_TABLES }
