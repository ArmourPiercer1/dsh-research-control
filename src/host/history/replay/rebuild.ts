/**
 * WP-2.3 — derived_state rebuild from the event log (TC-HIST-006;
 * TC-DB-002's「派生列重建能力」) + the rebuild-vs-incremental consistency
 * verification framework.
 *
 * Semantics pinned by the frozen contract:
 *   - DOMAIN_SCHEMA §15 L627: `derived_state` is a REBUILDABLE cache —
 *     「与事件 append 同事务写入；可由 replay 重建（TC-HIST-006）」. The
 *     SAME-TRANSACTION write is the NORMAL path (WP-2.1 `appendEvents`'
 *     `derivedState` patches); this module owns the REBUILD path.
 *   - HISTORY_EVENT_CATALOG §6 L279: 「从空 DB 按 audit 顺序重放全部事件可
 *     重建所有派生列（测试 TC-HIST-006）；重放不得产生新的 HistoryEvent」 —
 *     the rebuild replays in CANONICAL AUDIT ORDER (eventSeq,
 *     ownerWorkstreamId, eventId — the WP-2.2 `auditOrder` total order),
 *     and structurally cannot write the event table (below).
 *   - DOMAIN_SCHEMA §15 通则: state columns are History's derived caches,
 *     rebuildable by replay; `derived_state` is deliberately NOT
 *     first-class identity (INV-HIST-7) — the store's schema keeps it
 *     updatable precisely for this.
 *
 * WRITE-PATH DECISION (read §15, per WP boundary note): the WP-2.1 store
 * deliberately exposes NO derived-only write seam (its only write is
 * `appendEvents`, which always writes event rows + assigns seqs — using it
 * for a rebuild would append events, i.e. the exact thing §6 forbids).
 * This WP therefore rebuilds through an INDEPENDENT TRANSACTION:
 *   1. READ — the store's public read face only (`listRange`);
 *   2. FOLD — in memory, audit order, via `foldEvents` (no I/O);
 *   3. WRITE — ONE `BEGIN IMMEDIATE` transaction on a second connection to
 *      the SAME WAL file, touching ONLY `derived_state`
 *      (DELETE + INSERT all rows — 「replaced wholesale」), then close.
 * The transaction is atomic (crash ⇒ pre- or post-, never partial), is
 * fully disjoint from any event append (a concurrent `appendEvents`
 * `BEGIN IMMEDIATE` holds the write lock; one side waits per busy_timeout
 * or fails clean), and CANNOT touch `history_event` — even a raw SQL write
 * there is aborted by the WP-2.1 storage triggers (INV-HIST-1,
 * TC-HIST-003). The tests assert the event table is byte-identical around
 * a rebuild.
 *
 * CONSISTENCY PRECONDITION (why `compareDerivedStates` exists): the
 * rebuild folds in canonical audit order, so the INCREMENTAL maintainer
 * must apply events in that same order for the two to agree. A single-WS
 * log is compliant automatically; a cross-workstream batch must be
 * appended in canonical (eventSeq, owner) order. Any drift (reorder,
 * patch loss) surfaces as a non-empty `ConsistencyReport` — that is the
 * framework's job: it does not fix, it DETECTS and localizes.
 */

import { DatabaseSync } from 'node:sqlite'
import type { HistoryEventRecord, ResearchStore } from '../../persistence/store/index.js'
import { ReplayApplyError, ReplayError, ReplayInputError, ReplayStateError } from './errors.js'
import { foldEvents } from './replay.js'
import {
  assertStrictJson,
  canonicalJson,
  parseStateKey,
  type DerivedStateMap,
} from './state-map.js'
import { collectAllEvents, type RebuildStore } from './query.js'

/**
 * Derived-state reducer (catalog §6's table, code-owned by WP-2.5 / the
 * domain objects): pure `(state, event) → NEW state map`. The engine
 * (`foldEvents`) cannot enforce purity — the tests do (frozen states +
 * double-fold deep equality, TC-HIST-005).
 */
export type DerivedStateReducer = (
  state: DerivedStateMap,
  event: HistoryEventRecord,
) => DerivedStateMap

export interface RebuildOptions {
  /** Apply the rebuilt state to the `derived_state` table (default true —
   *  the operational purpose is repairing the cache). `false` = pure
   *  in-memory rebuild (the result's `states` is still returned). */
  readonly apply?: boolean
}

export interface RebuildResult {
  /** The rebuilt derived-state map (keyed `objectKind:objectId`). */
  readonly states: DerivedStateMap
  /** Number of events replayed (across all listed workstreams). */
  readonly eventCount: number
  /** Max `eventSeq` per workstream that contributed events. */
  readonly maxSeqByWorkstream: Readonly<Record<string, number>>
  /** Whether the `derived_state` table was replaced (see `apply`). */
  readonly applied: boolean
  /** Rows written when `applied` (= `states.size`). */
  readonly replacedRows: number
}

/**
 * Full derived-state rebuild: collect every event of `workstreams` in
 * canonical audit order, fold it through `reducer` from an EMPTY map
 * (「从空 DB」), and — unless `apply: false` — replace the
 * `derived_state` table wholesale in one independent transaction.
 *
 * The event table is read through the store's public read face ONLY and is
 * never written (type surface: `RebuildStore` has no `appendEvents`;
 * storage: the WP-2.1 triggers abort any raw UPDATE/DELETE on
 * `history_event` — tests assert byte-identity around the rebuild).
 *
 * `workstreams` is AUTHORITATIVE and must be COMPLETE: the replace is
 * wholesale, so a workstream missing from the list loses its rows (the
 * domain loader's workstream set is the intended source).
 *
 * Errors: bad arguments → `REPLAY_INPUT` (before any I/O); a reducer
 * output violating the `derived_state` contract → `REPLAY_STATE` (before
 * any write); the write/read transaction → `REPLAY_APPLY` (rolled back,
 * `cause` preserved). A THROWING REDUCER propagates unchanged (caller-owned
 * error; no write is in flight — the apply starts only after the fold).
 */
export function rebuildDerivedState(
  store: RebuildStore,
  workstreams: readonly string[],
  reducer: DerivedStateReducer,
  options: RebuildOptions = {},
): RebuildResult {
  if (typeof store?.path !== 'string' || store.path.length === 0) {
    throw new ReplayInputError('rebuildDerivedState: store.path must be a non-empty string')
  }
  if (typeof store.listRange !== 'function') {
    throw new ReplayInputError('rebuildDerivedState: store.listRange must be a function')
  }
  if (!Array.isArray(workstreams)) {
    throw new ReplayInputError('rebuildDerivedState: workstreams must be an array')
  }
  for (const ws of workstreams) {
    if (typeof ws !== 'string' || ws.length === 0) {
      throw new ReplayInputError('rebuildDerivedState: workstreams entries must be non-empty strings')
    }
  }
  if (typeof reducer !== 'function') {
    throw new ReplayInputError('rebuildDerivedState: reducer must be a function')
  }

  // 1+2. read (store read face) + fold (in memory) — canonical AUDIT order
  //      (catalog §6 L279), empty initial state (「从空 DB」).
  const events = collectAllEvents(store, workstreams, 'audit')
  const states = foldEvents(events, reducer, new Map<string, unknown>())

  // Validate the reducer output BEFORE any write (REPLAY_STATE).
  for (const [key, value] of states) {
    parseStateKey(key) // throws ReplayStateError on a malformed key
    assertStrictJson(value, `derived_state[${key}].state`)
  }

  const maxSeqByWorkstream: Record<string, number> = {}
  for (const ev of events) {
    const cur = maxSeqByWorkstream[ev.ownerWorkstreamId] ?? 0
    if (ev.eventSeq > cur) maxSeqByWorkstream[ev.ownerWorkstreamId] = ev.eventSeq
  }

  // 3. independent write transaction (derived_state only).
  const apply = options.apply !== false
  let replacedRows = 0
  if (apply) {
    replacedRows = replaceDerivedStateRows(store.path, states)
  }

  return {
    states,
    eventCount: events.length,
    maxSeqByWorkstream,
    applied: apply,
    replacedRows,
  }
}

/**
 * Read the live `derived_state` table (the incrementally maintained side of
 * the consistency check). READ-ONLY by construction: the connection is
 * opened `readOnly: true`, so a write through it is a driver-level
 * structural impossibility, not a policy. Used by the verification
 * framework / tests; the incremental writer (service, later WP) keeps its
 * own in-memory copy and does not need this.
 */
export function readDerivedState(store: Pick<ResearchStore, 'path'>): DerivedStateMap {
  if (typeof store?.path !== 'string' || store.path.length === 0) {
    throw new ReplayInputError('readDerivedState: store.path must be a non-empty string')
  }
  let db: DatabaseSync
  try {
    db = new DatabaseSync(store.path, { readOnly: true })
  } catch (e) {
    throw toApplyError(`readDerivedState: cannot open ${store.path}`, e)
  }
  try {
    const rows = db
      .prepare('SELECT object_kind, object_id, state FROM derived_state')
      .all() as Record<string, unknown>[]
    const out = new Map<string, unknown>()
    for (const row of rows) {
      const key = `${String(row.object_kind)}:${String(row.object_id)}`
      out.set(key, safeParseState(String(row.state), key))
    }
    return out
  } catch (e) {
    if (e instanceof ReplayError) throw e
    throw toApplyError(`readDerivedState: ${store.path}`, e)
  } finally {
    try {
      db.close()
    } catch {
      // best effort
    }
  }
}

// ----------------------------------------------------------------------
// consistency verification framework (rebuild vs incremental, TC-HIST-006)
// ----------------------------------------------------------------------

/** One localized difference between two derived-state tables. */
export interface ConsistencyDiffEntry {
  readonly key: string
  /** Value on the rebuilt side (present-in-both diffs only). */
  readonly rebuilt: unknown
  /** Value on the incremental side (present-in-both diffs only). */
  readonly incremental: unknown
}

export interface ConsistencyReport {
  /** True iff the two tables are semantically identical. */
  readonly ok: boolean
  readonly rebuiltCount: number
  readonly incrementalCount: number
  /** Keys present ONLY in the rebuilt table (incremental lost them). */
  readonly onlyInRebuilt: readonly string[]
  /** Keys present ONLY in the incremental table (rebuild missed them —
   *  e.g. an incomplete workstream list or an un-replayed event). */
  readonly onlyInIncremental: readonly string[]
  /** Keys present in both but with different values (canonical-JSON
   *  inequality — key order inside a JSON document does NOT count). */
  readonly differing: readonly ConsistencyDiffEntry[]
}

/**
 * Deep-compare a REBUILT derived-state table against the INCREMENTALLY
 * maintained one (canonical-JSON equality per row; keys compared as the
 * union, sorted for deterministic reports). This is the TC-HIST-006
 * 「所有派生列与原状态一致」 check made reusable: it neither writes nor
 * fixes — it localizes drift (missing row / extra row / changed value).
 */
export function compareDerivedStates(
  rebuilt: DerivedStateMap,
  incremental: DerivedStateMap,
): ConsistencyReport {
  const union = new Set<string>([...rebuilt.keys(), ...incremental.keys()])
  const keys = [...union].sort()
  const onlyInRebuilt: string[] = []
  const onlyInIncremental: string[] = []
  const differing: ConsistencyDiffEntry[] = []
  for (const key of keys) {
    const inRebuilt = rebuilt.has(key)
    const inIncremental = incremental.has(key)
    if (inRebuilt && !inIncremental) {
      onlyInRebuilt.push(key)
    } else if (!inRebuilt && inIncremental) {
      onlyInIncremental.push(key)
    } else if (canonicalJson(rebuilt.get(key)) !== canonicalJson(incremental.get(key))) {
      differing.push({ key, rebuilt: rebuilt.get(key), incremental: incremental.get(key) })
    }
  }
  return {
    ok: onlyInRebuilt.length === 0 && onlyInIncremental.length === 0 && differing.length === 0,
    rebuiltCount: rebuilt.size,
    incrementalCount: incremental.size,
    onlyInRebuilt,
    onlyInIncremental,
    differing,
  }
}

// ----------------------------------------------------------------------
// the independent write transaction (derived_state ONLY)
// ----------------------------------------------------------------------

/**
 * Replace the `derived_state` table wholesale in ONE `BEGIN IMMEDIATE`
 * transaction on a fresh connection to `dbPath` (the store's own file —
 * WAL allows a second connection; the write lock serializes with any
 * concurrent `appendEvents`). Touches `derived_state` and NOTHING else —
 * `history_event` writes would be aborted by the storage triggers anyway.
 * Any failure rolls the transaction back and throws REPLAY_APPLY (the
 * previous table content is untouched — all-or-nothing).
 */
function replaceDerivedStateRows(dbPath: string, states: DerivedStateMap): number {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath)
  } catch (e) {
    throw toApplyError(`rebuildDerivedState: cannot open ${dbPath}`, e)
  }
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('BEGIN IMMEDIATE')
  } catch (e) {
    closeQuietly(db)
    throw toApplyError(`rebuildDerivedState: cannot start transaction on ${dbPath}`, e)
  }
  try {
    db.exec('DELETE FROM derived_state')
    const insert = db.prepare(
      'INSERT INTO derived_state (object_kind, object_id, state) VALUES (?, ?, ?)',
    )
    for (const [key, value] of states) {
      const { objectKind, objectId } = parseStateKey(key) // validated pre-fold above; cannot throw
      insert.run(objectKind, objectId, canonicalJson(value))
    }
    db.exec('COMMIT')
  } catch (e) {
    rollbackQuietly(db)
    if (e instanceof ReplayError) throw e
    throw toApplyError(`rebuildDerivedState: derived_state replace failed on ${dbPath}`, e)
  } finally {
    closeQuietly(db)
  }
  return states.size
}

function toApplyError(context: string, e: unknown): ReplayApplyError {
  const msg = e instanceof Error ? e.message : String(e)
  return new ReplayApplyError(`${context}: ${msg}`, { cause: e })
}

function safeParseState(raw: string, key: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new ReplayApplyError(`derived_state[${key}].state is not valid JSON — corruption`, {
      cause: e,
    })
  }
}

function rollbackQuietly(db: DatabaseSync): void {
  try {
    db.exec('ROLLBACK')
  } catch {
    // the transaction may already have rolled back; nothing to do
  }
}

function closeQuietly(db: DatabaseSync): void {
  try {
    db.close()
  } catch {
    // best effort
  }
}
