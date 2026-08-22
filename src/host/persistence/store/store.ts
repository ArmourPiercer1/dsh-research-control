/**
 * WP-2.1 — operational SQLite store: `openDatabase` (DatabaseSync wrapper)
 * + the append-only `ResearchStore` handle.
 *
 * Follows the DSH `node:sqlite` pattern (DSH_ADAPTER §9):
 *   - owner-only permissions: DB directory 0o700, file 0o600 (enforced on
 *     every open, umask-proof);
 *   - `PRAGMA journal_mode=WAL`;
 *   - `PRAGMA user_version` is the monotonic schema version: 0 = fresh
 *     (init V1 DDL + set to 1, one transaction), 1 = open, anything else =
 *     REJECTED (pre-release: no migration, DSH_ADAPTER §9「不匹配即拒绝」);
 *     under version 1 the history_event STRUCTURE is verified as well
 *     (WP-2.9): a stale pre-release V1 file (older/newer column set or
 *     named indexes — e.g. a pre-WP-2.9 dev DB missing the generated
 *     filter columns) is rejected with STORE_SCHEMA_STALE, same
 *     no-migration policy, remedy = delete the file and reinitialize;
 *   - `PRAGMA quick_check` on open: a damaged file fails open with a
 *     structured `STORE_CORRUPT` — never a raw driver exception, never a
 *     repair attempt (TC-DB-002 「明确报错」);
 *   - connection lifecycle: the caller opens (`openDatabase`, in
 *     `[Service.init]`) and closes (`close()`, in the effect disposer) —
 *     this WP provides the injectable factory; the DSH wiring is a later
 *     WP. `close()` is idempotent.
 *
 * INV-DB-3 boundary: the store writes ONLY its own file (and its
 * -wal/-shm siblings). It has no view of `.research/` or Git, so a crash
 * anywhere inside a store operation can never corrupt the declarative 真源
 * or the Git workspace; and inside the store, every multi-write operation
 * is ONE SQLite transaction (or, for init, one init transaction) — WAL
 * recovery makes a mid-transaction crash leave the DB either pre- or
 * post-transaction, never partial (TC-DB-003 DB half, kill -9 tested).
 *
 * RR-013 hardening (WP-3.6): every connection this opener creates carries
 * the store-connection guard (connection-guard.ts `installStoreConnectionGuard`)
 * — REPLACE-class writes of `history_event` (`REPLACE INTO` /
 * `INSERT … OR REPLACE` / `ON CONFLICT … REPLACE`) are rejected at
 * prepare/exec time on the canonical connection (the BEFORE DELETE trigger
 * is bypassed by the internal conflict-row delete of the REPLACE class —
 * G2 r2 inv-attacker), plus an action-level authorizer backstop on
 * runtimes that provide `setAuthorizer` (Node ≥24.10). The storage
 * triggers remain the primary DELETE/UPDATE denial on any connection.
 *
 * No DSH imports (INV-PERM-5): `node:sqlite` is the Node builtin.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  DB_USER_VERSION,
  DIR_MODE,
  EXPECTED_TABLES,
  FILE_MODE,
  HISTORY_EVENT_COLUMNS,
  HISTORY_EVENT_GENERATED,
  HISTORY_EVENT_INDEXES,
  schemaDdl,
} from './schema.js'
import {
  StoreClosedError,
  StoreConflictError,
  StoreCorruptError,
  StoreError,
  StoreInputError,
  StoreOpenError,
  StoreSchemaStaleError,
  StoreSqlError,
  StoreVersionError,
} from './errors.js'
import { SqliteMetaStore, type MetaDbPort } from './sqlite-meta.js'
import { installStoreConnectionGuard } from './connection-guard.js'
import type {
  ActorRefJson,
  AppendEventsOptions,
  AppendResult,
  DerivedStatePatch,
  HistoryEventInput,
  HistoryEventRecord,
  RealizeHooks,
  ResearchStore,
  SourceRefJson,
  TxScope,
} from './types.js'

/** `openDatabase` options (all optional). */
export interface OpenDatabaseOptions {
  /**
   * Clock for the store-generated `recordedAt` (envelope §1 L33: plugin
   * generated, caller may not supply it). Inject a deterministic clock in
   * tests; default `Date.now`.
   */
  readonly now?: () => number
  /**
   * `PRAGMA busy_timeout` in milliseconds — how long a write waits for
   * another connection's lock before failing (default 5000).
   */
  readonly busyTimeoutMs?: number
}

const DEFAULT_BUSY_TIMEOUT_MS = 5000

/**
 * Open (or initialize) the operational SQLite store at `path`.
 *
 * Fresh path → parent dir created owner-only (0o700), file created
 * owner-only (0o600), WAL enabled, V1 schema + `user_version=1` written in
 * one transaction. Existing path → permissions re-enforced, WAL on,
 * `user_version` checked (mismatch → {@link StoreVersionError}),
 * `quick_check` corruption probe, then opened read-write.
 *
 * All failures are structured `StoreError`s (never raw driver exceptions).
 */
export function openDatabase(path: string, options: OpenDatabaseOptions = {}): ResearchStore {
  if (typeof path !== 'string' || path.length === 0) {
    throw new StoreInputError('openDatabase: path must be a non-empty string')
  }
  const abs = resolve(path)
  const parent = dirname(abs)

  ensureOwnerOnlyDir(parent)

  let isDir = false
  try {
    isDir = existsSync(abs) && lstatSync(abs).isDirectory()
  } catch (e) {
    throw new StoreOpenError(`openDatabase: cannot stat ${abs}: ${errMsg(e)}`, { cause: e })
  }
  if (isDir) {
    throw new StoreOpenError(`openDatabase: ${abs} is a directory, not a SQLite file`)
  }

  let db: DatabaseSync
  try {
    db = new DatabaseSync(abs)
  } catch (e) {
    throw classifyOpenFailure(abs, e)
  }

  try {
    // Owner-only file, umask-proof: enforce on every open (a pre-existing
    // file with group/other bits is tightened, not rejected).
    try {
      chmodSync(abs, FILE_MODE)
    } catch (e) {
      closeQuietly(db)
      throw new StoreOpenError(`openDatabase: cannot chmod ${abs} to 0o600: ${errMsg(e)}`, {
        cause: e,
      })
    }

    const journalMode = String(db.prepare('PRAGMA journal_mode = WAL').get()?.journal_mode ?? '')
    if (journalMode.toLowerCase() !== 'wal') {
      closeQuietly(db)
      throw new StoreCorruptError(
        `openDatabase: WAL journal mode could not be enabled at ${abs} (got "${journalMode}")`,
      )
    }
    const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS
    assertPositiveInt(busyTimeoutMs, 'busyTimeoutMs')
    // PRAGMAs take no bound parameters — interpolate the validated integer.
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`)

    checkIntegrity(db, abs)

    const version = readUserVersion(db, abs)
    if (version === 0) {
      initializeSchema(db, abs)
    } else if (version !== DB_USER_VERSION) {
      closeQuietly(db)
      throw new StoreVersionError(version, DB_USER_VERSION)
    } else {
      verifyExpectedSchema(db, abs)
    }

    // RR-013 (WP-3.6): after init/validation, before any other user of the
    // connection, install the store-connection guard on THIS connection —
    // the REPLACE-class statement gate (all runtimes) + the authorizer
    // backstop (Node ≥24.10, feature-detected). The init DDL above already
    // ran unguarded (it is this module's own trusted statement).
    installStoreConnectionGuard(db)
  } catch (e) {
    // classifyOpenFailure already structured driver errors from the
    // constructor; everything here may still be a raw driver exception.
    throw toStoreError(e, `openDatabase: ${abs}`)
  }

  const now = options.now ?? Date.now
  return createStore(db, abs, DB_USER_VERSION, now)
}

/** Build the handle. Kept out of `openDatabase` so the open path stays
 *  readable; the returned object is a plain sealed record — its OWN
 *  property names are exactly the public `ResearchStore` surface (tests
 *  lock this down: no hidden mutation methods). */
function createStore(
  db: DatabaseSync,
  abs: string,
  userVersion: number,
  now: () => number,
): ResearchStore {
  let closed = false
  let metaInstance: SqliteMetaStore | null = null

  const assertOpen = (operation: string): DatabaseSync => {
    if (closed) throw new StoreClosedError(operation)
    return db
  }

  const prepare = (operation: string, sql: string): StatementSync =>
    assertOpen(operation).prepare(sql)

  /** MetaDbPort seam for the SqliteMetaStore (its methods stay closed-safe). */
  const metaPort: MetaDbPort = {
    assertOpen: (): void => {
      void assertOpen('meta')
    },
    prepare: (sql: string): StatementSync => prepare('meta', sql),
  }

  const meta = (): SqliteMetaStore => {
    if (metaInstance === null) metaInstance = new SqliteMetaStore(metaPort)
    return metaInstance
  }

  const close = (): void => {
    if (closed) return
    closed = true
    try {
      db.close()
    } catch {
      // A second close / a close over a dead connection must not mask the
      // disposer path; the store is closed either way.
    }
  }

  /** Internal transaction scope factory (hooks only). */
  const makeTxScope = (operation: string): TxScope => {
    const getStmt = prepare(
      operation,
      'SELECT state FROM derived_state WHERE object_kind = ? AND object_id = ?',
    )
    const upsertStmt = prepare(
      operation,
      'INSERT INTO derived_state (object_kind, object_id, state) VALUES (?, ?, ?) ' +
        'ON CONFLICT(object_kind, object_id) DO UPDATE SET state = excluded.state',
    )
    return {
      getDerivedState(objectKind, objectId) {
        const kind = assertNonEmptyString(objectKind, 'objectKind')
        const id = assertNonEmptyString(objectId, 'objectId')
        const row = getStmt.get(kind, id)
        if (row === undefined) return null
        return safeParse(String(row.state), `derived_state[${kind}:${id}].state`)
      },
      setDerivedState(objectKind, objectId, state) {
        const kind = assertNonEmptyString(objectKind, 'objectKind')
        const id = assertNonEmptyString(objectId, 'objectId')
        upsertStmt.run(kind, id, safeStringify(state, `derived_state[${kind}:${id}].state`))
      },
    }
  }

  // The handle is a plain sealed record — its OWN property names are
  // exactly the public `ResearchStore` surface (tests lock this down: no
  // hidden mutation methods). The *Impl functions are hoisted declarations
  // below the return; `makeTxScope` (a const) must be defined above it.
  return {
    path: abs,
    userVersion,
    close,
    appendEvents: (events, options): AppendResult => appendEventsImpl(events, options),
    getEvent: (ownerWorkstreamId, seq) => getEventImpl(ownerWorkstreamId, seq),
    listRange: (ownerWorkstreamId, fromSeq, toSeq) => listRangeImpl(ownerWorkstreamId, fromSeq, toSeq),
    meta,
  }

  // ------------------------------------------------------------------
  // append
  // ------------------------------------------------------------------

  function appendEventsImpl(
    events: readonly HistoryEventInput[],
    options: AppendEventsOptions = {},
  ): AppendResult {
    const operation = 'appendEvents'
    const dbConn = assertOpen(operation)

    // ---- input validation (before the transaction; zero side effects) ----
    if (!Array.isArray(events) || events.length === 0) {
      throw new StoreInputError('appendEvents: events must be a non-empty array')
    }
    const rows: EventRow[] = events.map((ev, i) => parseEventInput(ev, i))
    const seenIds = new Set<string>()
    for (const row of rows) {
      if (seenIds.has(row.eventId)) {
        throw new StoreInputError(
          `appendEvents: duplicate eventId within one batch: ${row.eventId} — one event per id (INV-HIST-6)`,
        )
      }
      seenIds.add(row.eventId)
    }
    const validateHook = options.validate
    if (validateHook !== undefined && typeof validateHook !== 'function') {
      throw new StoreInputError('appendEvents: options.validate must be a function')
    }
    const realize = normalizeRealizeOptions(options.realize)
    const derivedPatches = normalizeDerivedState(options.derivedState)
    const recordedAt = now()

    // ---- one write transaction: ①seq → ②validate → ③events →
    //      ④derived_state → ⑤realize → COMMIT ----
    // `inHook` distinguishes caller-owned errors (the caller's own throw —
    // propagated UNCHANGED) from store-owned ones (wrapped, structured).
    let inHook = false
    dbConn.exec('BEGIN IMMEDIATE')
    try {
      // ① seq assignment — per owner workstream, MAX+1, INSIDE the write
      //    transaction (BEGIN IMMEDIATE holds the write lock, so no other
      //    connection can interleave an append between read and insert;
      //    TC-HIST-003).
      const maxStmt = dbConn.prepare(
        'SELECT MAX(event_seq) AS m FROM history_event WHERE owner_workstream_id = ?',
      )
      const baseByWs = new Map<string, number>()
      for (const row of rows) {
        const ws = row.ownerWorkstreamId
        if (!baseByWs.has(ws)) {
          const m = maxStmt.get(ws)?.m ?? null
          const base = m === null || m === undefined ? 0 : Number(m)
          if (!Number.isSafeInteger(base) || base < 0) {
            throw new StoreCorruptError(
              `appendEvents: history_event holds a non-integer MAX(event_seq)=${String(m)} ` +
                `for ${ws} — database corruption`,
            )
          }
          baseByWs.set(ws, base)
        }
      }
      const nextByWs = new Map<string, number>(
        [...baseByWs.entries()].map(([ws, base]) => [ws, base + 1]),
      )
      for (const row of rows) {
        row.eventSeq = nextByWs.get(row.ownerWorkstreamId) as number
        row.recordedAt = recordedAt
        nextByWs.set(row.ownerWorkstreamId, row.eventSeq + 1)
      }

      // ② validation hook (WP-2.2 seam) — sees the batch with assigned
      //    seqs; pre-batch derived state via tx. Throw → full rollback.
      const tx = makeTxScope(operation)
      if (validateHook !== undefined) {
        inHook = true
        validateHook(rows.map(toRecord), tx)
        inHook = false
      }

      // ③ event rows
      const insertStmt = dbConn.prepare(
        'INSERT INTO history_event ' +
          '(event_id, owner_workstream_id, event_seq, event_type, schema_version, ' +
          'occurred_at, recorded_at, actor, source, payload) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      for (const row of rows) {
        insertStmt.run(
          row.eventId,
          row.ownerWorkstreamId,
          row.eventSeq,
          row.eventType,
          row.schemaVersion,
          row.occurredAt,
          row.recordedAt,
          row.actorJson,
          row.sourceJson,
          row.payloadJson,
        )
      }

      // ④ derived_state patches — same transaction (§15 L627), wholesale
      //    replacement of the state JSON.
      for (const patch of derivedPatches) {
        tx.setDerivedState(patch.objectKind, patch.objectId, patch.state)
      }

      // ⑤ realize hooks (TC-DOM-033) — exactly once per listed workstream
      //    whose FIRST event is in this batch, in batch order.
      if (realize !== null) {
        const wanted = new Set(realize.workstreamIds)
        const fired = new Set<string>()
        for (const row of rows) {
          const ws = row.ownerWorkstreamId
          if (!wanted.has(ws) || fired.has(ws)) continue
          if ((baseByWs.get(ws) ?? 0) !== 0) continue // not this WS's first event
          fired.add(ws)
          inHook = true
          realize.apply({ workstreamId: ws, event: toRecord(row), tx })
          inHook = false
        }
      }

      dbConn.exec('COMMIT')
    } catch (e) {
      rollbackQuietly(dbConn)
      if (inHook) throw e // caller-owned: propagate unchanged (already rolled back)
      throw toStoreError(e, operation)
    }

    const lastSeqByWorkstream: Record<string, number> = {}
    for (const row of rows) lastSeqByWorkstream[row.ownerWorkstreamId] = row.eventSeq
    return { events: rows.map(toRecord), lastSeqByWorkstream }
  }

  // ------------------------------------------------------------------
  // minimal query face (WP-2.3 owns full replay/projections)
  // ------------------------------------------------------------------

  function getEventImpl(ownerWorkstreamId: string, seq: number): HistoryEventRecord | null {
    const operation = 'getEvent'
    const dbConn = assertOpen(operation)
    const ws = assertNonEmptyString(ownerWorkstreamId, 'ownerWorkstreamId')
    assertSeq(seq, 'seq')
    const row = dbConn
      .prepare('SELECT * FROM history_event WHERE owner_workstream_id = ? AND event_seq = ?')
      .get(ws, seq)
    return row === undefined ? null : dbRowToRecord(row)
  }

  function listRangeImpl(
    ownerWorkstreamId: string,
    fromSeq: number,
    toSeq?: number,
  ): readonly HistoryEventRecord[] {
    const operation = 'listRange'
    const dbConn = assertOpen(operation)
    const ws = assertNonEmptyString(ownerWorkstreamId, 'ownerWorkstreamId')
    assertSeq(fromSeq, 'fromSeq')
    let rows: Record<string, unknown>[]
    if (toSeq === undefined) {
      rows = dbConn
        .prepare(
          'SELECT * FROM history_event WHERE owner_workstream_id = ? AND event_seq >= ? ORDER BY event_seq',
        )
        .all(ws, fromSeq) as Record<string, unknown>[]
    } else {
      assertSeq(toSeq, 'toSeq')
      if (toSeq < fromSeq) {
        throw new StoreInputError(`listRange: toSeq (${toSeq}) must be >= fromSeq (${fromSeq})`)
      }
      rows = dbConn
        .prepare(
          'SELECT * FROM history_event WHERE owner_workstream_id = ? ' +
            'AND event_seq >= ? AND event_seq <= ? ORDER BY event_seq',
        )
        .all(ws, fromSeq, toSeq) as Record<string, unknown>[]
    }
    return rows.map((r) => dbRowToRecord(r))
  }
}

// ======================================================================
// input parsing / normalization
// ======================================================================

/** A validated, serialized event awaiting seq assignment + insert. */
interface EventRow {
  eventId: string
  ownerWorkstreamId: string
  eventType: string
  schemaVersion: number
  occurredAt: number
  recordedAt: number
  actor: ActorRefJson
  source: SourceRefJson | null
  payload: Record<string, unknown>
  actorJson: string
  sourceJson: string | null
  payloadJson: string
  /** Assigned inside the write transaction. */
  eventSeq: number
}

function parseEventInput(ev: HistoryEventInput, index: number): EventRow {
  const what = `events[${index}]`
  if (typeof ev !== 'object' || ev === null) {
    throw new StoreInputError(`appendEvents: ${what} is not an object`)
  }
  // Runtime shape guard: the caller is JS-agnostic, so inspect the raw
  // object (including unexpected keys) before trusting the typed fields.
  const e = ev as unknown as Record<string, unknown>
  // Store-owned envelope fields must NOT be caller-supplied.
  if ('eventSeq' in e) {
    throw new StoreInputError(
      `appendEvents: ${what}.eventSeq is store-assigned (per owner WS, MAX+1 inside the ` +
        `transaction — TC-HIST-003); remove it from the input (HISTORY_EVENT_CATALOG §1)`,
    )
  }
  if ('recordedAt' in e) {
    throw new StoreInputError(
      `appendEvents: ${what}.recordedAt is generated by the plugin at write time ` +
        `(HISTORY_EVENT_CATALOG §1 L33); remove it from the input`,
    )
  }
  const eventId = assertNonEmptyString(e.eventId, `${what}.eventId`)
  const ownerWorkstreamId = assertNonEmptyString(e.ownerWorkstreamId, `${what}.ownerWorkstreamId`)
  const eventType = assertNonEmptyString(e.eventType, `${what}.eventType`)
  const schemaVersion = e.schemaVersion
  if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new StoreInputError(`appendEvents: ${what}.schemaVersion must be a positive safe integer`)
  }
  const occurredAt = e.occurredAt
  if (typeof occurredAt !== 'number' || !Number.isSafeInteger(occurredAt) || occurredAt < 0) {
    throw new StoreInputError(`appendEvents: ${what}.occurredAt must be a non-negative safe integer (epoch ms)`)
  }
  const actor = e.actor
  if (typeof actor !== 'object' || actor === null) {
    throw new StoreInputError(`appendEvents: ${what}.actor must be an ActorRef object`)
  }
  if (typeof (actor as Record<string, unknown>).kind !== 'string' ||
      ((actor as Record<string, unknown>).kind as string).length === 0) {
    throw new StoreInputError(`appendEvents: ${what}.actor.kind must be a non-empty string`)
  }
  const payload = e.payload
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new StoreInputError(`appendEvents: ${what}.payload must be a JSON object`)
  }

  const actorJson = safeStringify(actor, `${what}.actor`)
  const source = e.source === undefined ? null : e.source
  let sourceJson: string | null = null
  if (source !== null) {
    if (typeof source !== 'object' || Array.isArray(source)) {
      throw new StoreInputError(`appendEvents: ${what}.source must be a SourceRef object or null`)
    }
    sourceJson = safeStringify(source, `${what}.source`)
  }
  const payloadJson = safeStringify(payload, `${what}.payload`)

  return {
    eventId,
    ownerWorkstreamId,
    eventType,
    schemaVersion,
    occurredAt,
    recordedAt: 0, // filled by the caller (batch timestamp)
    actor: actor as ActorRefJson,
    source: (source ?? null) as SourceRefJson | null,
    payload: payload as Record<string, unknown>,
    actorJson,
    sourceJson,
    payloadJson,
    eventSeq: 0, // assigned inside the write transaction
  }
}

function normalizeRealizeOptions(
  realize: RealizeHooks | undefined,
): RealizeHooks | null {
  if (realize === undefined) return null
  if (typeof realize !== 'object' || realize === null) {
    throw new StoreInputError('appendEvents: options.realize must be an object')
  }
  if (!Array.isArray(realize.workstreamIds)) {
    throw new StoreInputError('appendEvents: options.realize.workstreamIds must be an array')
  }
  for (const ws of realize.workstreamIds) {
    assertNonEmptyString(ws, 'options.realize.workstreamIds entry')
  }
  if (typeof realize.apply !== 'function') {
    throw new StoreInputError('appendEvents: options.realize.apply must be a function')
  }
  return realize
}

function normalizeDerivedState(
  patches: readonly DerivedStatePatch[] | undefined,
): readonly DerivedStatePatch[] {
  if (patches === undefined) return []
  if (!Array.isArray(patches)) {
    throw new StoreInputError('appendEvents: options.derivedState must be an array')
  }
  for (const [i, p] of patches.entries()) {
    if (typeof p !== 'object' || p === null) {
      throw new StoreInputError(`appendEvents: options.derivedState[${i}] is not an object`)
    }
    assertNonEmptyString(p.objectKind, `options.derivedState[${i}].objectKind`)
    assertNonEmptyString(p.objectId, `options.derivedState[${i}].objectId`)
    if (p.state === undefined) {
      throw new StoreInputError(`appendEvents: options.derivedState[${i}].state must not be undefined`)
    }
  }
  return patches
}

// ======================================================================
// record / row mapping
// ======================================================================

function toRecord(row: EventRow): HistoryEventRecord {
  const base: HistoryEventRecord = {
    eventId: row.eventId,
    ownerWorkstreamId: row.ownerWorkstreamId,
    eventSeq: row.eventSeq,
    eventType: row.eventType,
    schemaVersion: row.schemaVersion,
    occurredAt: row.occurredAt,
    recordedAt: row.recordedAt,
    actor: row.actor,
    payload: row.payload,
  }
  // `source` is optional + readonly on the record type: build it in at
  // construction rather than assigning.
  return row.source === null ? base : { ...base, source: row.source }
}

function dbRowToRecord(row: Record<string, unknown>): HistoryEventRecord {
  const id = String(row.event_id ?? '')
  const ws = String(row.owner_workstream_id ?? '')
  const seq = Number(row.event_seq ?? 0)
  const base: HistoryEventRecord = {
    eventId: id,
    ownerWorkstreamId: ws,
    eventSeq: seq,
    eventType: String(row.event_type ?? ''),
    schemaVersion: Number(row.schema_version ?? 0),
    occurredAt: Number(row.occurred_at ?? 0),
    recordedAt: Number(row.recorded_at ?? 0),
    actor: safeParse(String(row.actor ?? ''), `history_event[${id}].actor`) as ActorRefJson,
    payload: safeParse(String(row.payload ?? ''), `history_event[${id}].payload`) as Record<string, unknown>,
  }
  if (row.source !== null && row.source !== undefined) {
    return {
      ...base,
      source: safeParse(String(row.source), `history_event[${id}].source`) as SourceRefJson,
    }
  }
  return base
}

// ======================================================================
// open path helpers
// ======================================================================

/**
 * Create `dir` (and any missing ancestors) and enforce owner-only 0o700 on
 * every directory THIS call created; a pre-existing parent is left at its
 * current mode (it may hold sibling projects — the DB file itself is
 * 0o600, which is the owner-only boundary that matters for the DB).
 */
function ensureOwnerOnlyDir(dir: string): void {
  const missing: string[] = []
  let cur = resolve(dir)
  while (!existsSync(cur)) {
    missing.push(cur)
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  try {
    mkdirSync(dir, { recursive: true })
  } catch (e) {
    throw new StoreOpenError(`openDatabase: cannot create directory ${dir}: ${errMsg(e)}`, {
      cause: e,
    })
  }
  for (const m of missing) {
    try {
      chmodSync(m, DIR_MODE)
    } catch (e) {
      throw new StoreOpenError(
        `openDatabase: cannot set owner-only mode 0o700 on ${m}: ${errMsg(e)}`,
        { cause: e },
      )
    }
  }
}

/** Driver error from `new DatabaseSync(path)` → structured. */
function classifyOpenFailure(abs: string, e: unknown): StoreError {
  const msg = errMsg(e)
  if (/not a database|malformed|file is not a database/i.test(msg)) {
    return new StoreCorruptError(
      `openDatabase: ${abs} is not a usable SQLite database (corrupt or non-DB file): ${msg}`,
      { cause: e },
    )
  }
  return new StoreOpenError(`openDatabase: cannot open ${abs}: ${msg}`, { cause: e })
}

/** `PRAGMA quick_check` — a damaged file fails here (TC-DB-002). */
function checkIntegrity(db: DatabaseSync, abs: string): void {
  let rows: Record<string, unknown>[]
  try {
    rows = db.prepare('PRAGMA quick_check').all() as Record<string, unknown>[]
  } catch (e) {
    throw new StoreCorruptError(
      `openDatabase: ${abs} is corrupted or unreadable: ${errMsg(e)}`,
      { cause: e },
    )
  }
  const problems = rows
    .map((r) => String(r.quick_check ?? ''))
    .filter((s) => s.toLowerCase() !== 'ok')
  if (problems.length > 0) {
    throw new StoreCorruptError(
      `openDatabase: ${abs} failed quick_check: ${problems.join('; ')}`,
    )
  }
}

function readUserVersion(db: DatabaseSync, abs: string): number {
  let row: Record<string, unknown> | undefined
  try {
    row = db.prepare('PRAGMA user_version').get() as Record<string, unknown> | undefined
  } catch (e) {
    throw new StoreCorruptError(
      `openDatabase: ${abs} is corrupted (cannot read user_version): ${errMsg(e)}`,
      { cause: e },
    )
  }
  const v = Number(row?.user_version ?? 0)
  if (!Number.isSafeInteger(v) || v < 0) {
    throw new StoreCorruptError(`openDatabase: ${abs} has a non-integer user_version`)
  }
  return v
}

/** Fresh DB (user_version 0): V1 DDL + version bump, ONE transaction.
 *  user_version 0 with schema tables already present is an INCONSISTENT
 *  file (a torn init that somehow escaped the init transaction) →
 *  corruption, not a re-init. */
function initializeSchema(db: DatabaseSync, abs: string): void {
  const tables = readExistingTables(db, abs)
  for (const t of tables) {
    if (EXPECTED_TABLES.includes(t as (typeof EXPECTED_TABLES)[number])) {
      throw new StoreCorruptError(
        `openDatabase: ${abs} has user_version=0 but table "${t}" already exists — ` +
          'inconsistent database (corruption)',
      )
    }
  }
  db.exec('BEGIN')
  try {
    db.exec(schemaDdl())
    db.exec(`PRAGMA user_version = ${DB_USER_VERSION}`)
    db.exec('COMMIT')
  } catch (e) {
    rollbackQuietly(db)
    throw toStoreError(e, `openDatabase (schema init at ${abs})`)
  }
}

function readExistingTables(db: DatabaseSync, abs: string): string[] {
  let rows: Record<string, unknown>[]
  try {
    rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Record<string, unknown>[]
  } catch (e) {
    throw new StoreCorruptError(
      `openDatabase: ${abs} is corrupted (cannot read sqlite_master): ${errMsg(e)}`,
      { cause: e },
    )
  }
  return rows.map((r) => String(r.name ?? ''))
}

/** user_version=1 but a §15 table missing → the file is broken. */
function verifyExpectedSchema(db: DatabaseSync, abs: string): void {
  verifyExpectedTables(db, abs)
  verifyHistoryEventStructure(db, abs)
}

function verifyExpectedTables(db: DatabaseSync, abs: string): void {
  const tables = new Set(readExistingTables(db, abs))
  for (const t of EXPECTED_TABLES) {
    if (!tables.has(t)) {
      throw new StoreCorruptError(
        `openDatabase: ${abs} has user_version=${DB_USER_VERSION} but is missing table ` +
          `"${t}" — database corruption`,
      )
    }
  }
}

/**
 * user_version=1 + tables present, but the `history_event` structure does
 * not match this build's V1 DDL → STALE pre-release schema (an older dev
 * build: missing the WP-2.9 generated columns / filter indexes; or a
 * newer/unknown build: extra columns or named indexes). Rejected with a
 * structured STORE_SCHEMA_STALE — no migration path (DSH_ADAPTER §9);
 * the remedy is to delete the file and reinitialize. Column facts come
 * from `PRAGMA table_xinfo` (unlike `table_info`, it also reports the
 * generated columns, flagged `hidden = 2` for virtual generated —
 * SQLite ≥ 3.36, available on every node:sqlite build the store supports).
 */
function verifyHistoryEventStructure(db: DatabaseSync, abs: string): void {
  let colRows: Record<string, unknown>[]
  let idxRows: Record<string, unknown>[]
  try {
    colRows = db.prepare('PRAGMA table_xinfo(history_event)').all() as Record<string, unknown>[]
    idxRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'history_event'",
      )
      .all() as Record<string, unknown>[]
  } catch (e) {
    throw new StoreCorruptError(
      `openDatabase: ${abs} is corrupted (cannot read the history_event structure): ${errMsg(e)}`,
    )
  }

  // name → hidden flag (0 regular / 1 stored generated / 2 virtual generated)
  const hiddenByColumn = new Map<string, number>()
  for (const r of colRows) {
    hiddenByColumn.set(String(r.name ?? ''), Number(r.hidden ?? 0))
  }
  const expectedColumns = new Set<string>(HISTORY_EVENT_COLUMNS)

  const colMissing: string[] = []
  const colUnexpected: string[] = []
  const colWrongKind: string[] = []
  for (const c of HISTORY_EVENT_COLUMNS) {
    if (!hiddenByColumn.has(c)) {
      colMissing.push(c)
    }
  }
  for (const [c, hidden] of hiddenByColumn) {
    if (!expectedColumns.has(c)) {
      colUnexpected.push(c)
    } else {
      const wantHidden = HISTORY_EVENT_GENERATED.has(c) ? 2 : 0
      if (hidden !== wantHidden) colWrongKind.push(c)
    }
  }

  const namedIndexes = new Set(
    idxRows.map((r) => String(r.name ?? '')).filter((n) => !n.startsWith('sqlite_autoindex_')),
  )
  const idxMissing: string[] = []
  const idxUnexpected: string[] = []
  for (const i of HISTORY_EVENT_INDEXES) {
    if (!namedIndexes.has(i)) idxMissing.push(i)
  }
  const expectedIndexes = new Set<string>(HISTORY_EVENT_INDEXES)
  for (const n of namedIndexes) {
    if (!expectedIndexes.has(n)) idxUnexpected.push(n)
  }

  if (
    colMissing.length > 0 ||
    colUnexpected.length > 0 ||
    colWrongKind.length > 0 ||
    idxMissing.length > 0 ||
    idxUnexpected.length > 0
  ) {
    const parts: string[] = []
    if (colMissing.length > 0) parts.push(`missing columns: ${colMissing.join(', ')}`)
    if (colUnexpected.length > 0) parts.push(`unexpected columns: ${colUnexpected.join(', ')}`)
    if (colWrongKind.length > 0) {
      parts.push(`columns with wrong kind (generated vs regular): ${colWrongKind.join(', ')}`)
    }
    if (idxMissing.length > 0) parts.push(`missing indexes: ${idxMissing.join(', ')}`)
    if (idxUnexpected.length > 0) parts.push(`unexpected indexes: ${idxUnexpected.join(', ')}`)
    throw new StoreSchemaStaleError(
      `openDatabase: ${abs} has user_version=${DB_USER_VERSION} but its history_event structure ` +
        `differs from this build's V1 DDL (${parts.join('; ')}) — stale pre-release schema; ` +
        'the pre-release store does not migrate (DSH_ADAPTER §9): delete the file and reinitialize',
    )
  }
}

// ======================================================================
// small shared helpers
// ======================================================================

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function assertNonEmptyString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new StoreInputError(`${what} must be a non-empty string`)
  }
  return value
}

function assertSeq(value: number, what: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new StoreInputError(`${what} must be a positive safe integer (event_seq >= 1)`)
  }
}

function assertPositiveInt(value: number, what: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new StoreInputError(`${what} must be a positive safe integer`)
  }
}

function safeStringify(value: unknown, what: string): string {
  assertJsonValue(value, what, 0)
  try {
    const out = JSON.stringify(value)
    if (typeof out !== 'string') {
      throw new Error(`JSON.stringify returned ${typeof out}`)
    }
    return out
  } catch (e) {
    throw new StoreInputError(`${what} is not JSON-serializable: ${errMsg(e)}`, { cause: e })
  }
}

/**
 * Strict-JSON gate: `JSON.stringify` silently DROPS function/symbol/
 * undefined property values and silently coerces NaN/Infinity to null —
 * for persisted envelope data that is silent corruption, not
 * serialization. Only strict JSON values pass: null, string, boolean,
 * finite number, arrays, and PLAIN objects (no Date/RegExp/Map/custom
 * class, no symbol keys, no undefined values). Depth-capped (64).
 */
function assertJsonValue(value: unknown, what: string, depth: number): void {
  if (depth > 64) {
    throw new StoreInputError(`${what}: nesting deeper than 64 levels — refusing to persist`)
  }
  if (value === null) return
  const t = typeof value
  if (t === 'string' || t === 'boolean') return
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new StoreInputError(`${what}: non-finite number (NaN/±Infinity are not JSON)`)
    }
    return
  }
  if (t === 'function' || t === 'symbol' || t === 'bigint' || t === 'undefined') {
    throw new StoreInputError(`${what}: not a strict JSON value (got ${t})`)
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, what, depth + 1)
    return
  }
  const obj = value as Record<string, unknown>
  const proto = Object.getPrototypeOf(obj)
  if (proto !== Object.prototype && proto !== null) {
    const name = (obj as { constructor?: { name?: string } }).constructor?.name ?? 'unknown'
    throw new StoreInputError(
      `${what}: contains a non-plain object (${name}) — strict JSON only (no Date/RegExp/Map/...)`,
    )
  }
  if (Object.getOwnPropertySymbols(obj).length > 0) {
    throw new StoreInputError(`${what}: contains symbol-keyed properties — not JSON`)
  }
  for (const v of Object.values(obj)) assertJsonValue(v, what, depth + 1)
}

function safeParse(raw: string, what: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new StoreCorruptError(`${what} is not valid JSON — database corruption`, { cause: e })
  }
}

function rollbackQuietly(db: DatabaseSync): void {
  try {
    db.exec('ROLLBACK')
  } catch {
    // The transaction may already have been rolled back by the driver
    // (constraint failures roll back the statement, not the transaction);
    // nothing to do.
  }
}

function closeQuietly(db: DatabaseSync): void {
  try {
    db.close()
  } catch {
    // best effort
  }
}

/**
 * Store-owned failure → structured StoreError. Caller-owned hook errors
 * (thrown by the caller's validate/realize callbacks) propagate UNCHANGED —
 * they are the caller's error type; the transaction is already rolled back.
 */
function toStoreError(e: unknown, context: string): unknown {
  if (e instanceof StoreError) return e
  const msg = errMsg(e)
  if (/UNIQUE constraint failed/i.test(msg)) {
    return new StoreConflictError(`${context}: uniqueness violation: ${msg}`, { cause: e })
  }
  if (/not a database|database disk image is malformed/i.test(msg)) {
    return new StoreCorruptError(`${context}: corrupt or unreadable SQLite file: ${msg}`, {
      cause: e,
    })
  }
  return new StoreSqlError(`${context}: ${msg}`, { cause: e })
}
