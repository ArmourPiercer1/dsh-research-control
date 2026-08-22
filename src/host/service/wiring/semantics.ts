/**
 * WP-3.6 (RR-011 (b)) — the semantics stack wired at the STORE level:
 * one reducer, two consumers, one derived_state row.
 *
 * Claim/Fact/Artifact/Relation (the four semantic registries,
 * HISTORY_EVENT_CATALOG §6 / DOMAIN_SCHEMA §7–8) live as ONE
 * `derived_state` row per project — key `semantics:<projectId>`
 * (objectKind `semantics`, objectId = the project id; the registry is
 * project-scoped by construction: ids are allocated per project,
 * §1.1 规则 2) — maintained by the SAME `reduceSemanticEvent` the replay
 * fold uses (WP-2.5: "One reducer, two consumers"):
 *
 *   1. INCREMENTAL — `validateHook` runs INSIDE the `appendEvents` write
 *      transaction (the store's `validate` hook seam): it reads the
 *      current `semantics` row through the TxScope, folds every semantic
 *      event of the batch onto it (non-semantic events pass through
 *      untouched), and writes the result back via the TxScope — so the
 *      derived row updates in the SAME transaction as the event append
 *      (§15: 与事件 append 同事务写入) and rolls back with it.
 *   2. REPLAY — `rebuild` collects the FULL event log in canonical AUDIT
 *      order (`collectAllEvents`, the pinned rebuild order), folds from
 *      the empty state through `foldSemanticEvents` (the same reducer),
 *      and — the WP-2.3 consistency framework — deep-compares the
 *      rebuilt table against the incrementally maintained one
 *      (`compareDerivedStates`), then (default) replaces the
 *      `derived_state` table in ONE independent transaction touching
 *      ONLY `derived_state` (the WP-2.3 write discipline; rows of other
 *      object kinds — `workstream` lifecycle, `RUN` docs, … — pass
 *      through untouched: this rebuild is the SEMANTICS slice, and the
 *      event log is provably unable to touch any other row).
 *
 * The consistency guarantee: a valid stream appended incrementally
 * (one batch per append, in canonical order) yields a table that a full
 * audit-order rebuild reproduces BYTE-for-byte (canonical JSON) — the
 * tests pin this, including the corruption→rebuild→clean cycle.
 *
 * A CORRUPT `semantics` row (non-strict-JSON, malformed codec shape)
 * fails LOUD on the incremental path (the append is rejected — the
 * corrupt cache never silently poisons a fold) and on the rebuild read
 * (the rebuild refuses to pass through garbage it cannot parse —
 * `readDerivedState` already asserts strict JSON per row, so the codec
 * check here covers the semantic shape).
 *
 * No DSH imports (INV-PERM-5).
 */

import { DatabaseSync } from 'node:sqlite'

import type { HistoryEventRecord, ResearchStore, TxScope } from '../../persistence/store/index.js'
import { collectAllEvents, compareDerivedStates, parseStateKey, readDerivedState, stateKey, type ConsistencyReport, type DerivedStateMap } from '../../history/replay/index.js'
import {
  foldSemanticEvents,
  initialSemanticState,
  isSemanticEvent,
  reduceSemanticEvent,
  SEMANTIC_EVENT_TYPES,
  type ActorRefDoc,
  type ClaimRow,
  type ConflictFlag,
  type FactRow,
  type ArtifactRow,
  type RelationRow,
  type SemanticInputEvent,
  type SemanticState,
} from '../../domain/semantics/index.js'
import { HostWiringError, type HostWiringLogger } from './types.js'

/** The frozen actorRef kinds (common.schema.json `$defs/actorRef.kind`). */
function isActorKind(value: string): value is ActorRefDoc['kind'] {
  return value === 'USER' || value === 'AGENT' || value === 'PLUGIN' || value === 'SYSTEM'
}

/**
 * Adapt a store `HistoryEventRecord` (the opaque-JSON carrier) to the
 * domain's `SemanticInputEvent` (the strict carrier). The registry
 * already guaranteed the envelope at write time; a record that fails the
 * actor-kind check here is a CORRUPT event log and fails loud (the fold
 * must never silently drop or misattribute an event).
 */
export function toSemanticInputEvent(record: HistoryEventRecord): SemanticInputEvent {
  const kind = record.actor?.kind
  if (typeof kind !== 'string' || !isActorKind(kind)) {
    throw new HostWiringError(
      'WIRING_SERVICE',
      `semantic fold: ${record.eventType} ${record.eventId} (audit seq ${record.eventSeq}) carries an illegal actor.kind ${JSON.stringify(kind ?? null)} — corrupt event log (fail loud)`,
    )
  }
  const actor: ActorRefDoc = { ...record.actor, kind }
  return { ...record, actor }
}

/** The single derived_state key holding the project's semantic registry. */
export function semanticStateKey(projectId: string): string {
  return stateKey('semantics', projectId)
}

const SEMANTICS_KIND = 'semantics'

/* ------------------------------------------------------------------ *
 * JSON codec (Maps ↔ strict-JSON document)
 * ------------------------------------------------------------------ */

/** The persisted shape of one `SemanticState` (strict JSON, lossless). */
export interface SemanticStateDoc {
  readonly claims: Record<string, ClaimRow>
  readonly facts: Record<string, FactRow>
  readonly artifacts: Record<string, ArtifactRow>
  readonly relations: Record<string, RelationRow>
  readonly conflict: Record<string, ConflictFlag>
}

function mapToRecord<T>(entries: ReadonlyMap<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  // KEYS SORTED — the canonical persisted form. The two fold faces order
  // the SAME rows differently by construction (the incremental hook
  // folds events in APPEND order; the rebuild folds the audit merge
  // (eventSeq, owner, eventId) — cross-workstream batches interleave),
  // and `compareDerivedStates` compares the persisted docs byte-wise
  // (canonical JSON). A key-sorted doc makes the two faces byte-EQUAL
  // whenever the DATA is equal — the RR-011 (b) invariant (the property
  // tests/property/semantics-consistency.test.ts pinned it after the
  // random-stream generator first exposed the divergence).
  for (const [k, v] of [...entries.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    out[k] = v
  }
  return out
}

/** Serialize (pure; canonical — section keys sorted, RR-011 (b)). */
export function semanticStateToJson(state: SemanticState): SemanticStateDoc {
  return {
    claims: mapToRecord(state.claims),
    facts: mapToRecord(state.facts),
    artifacts: mapToRecord(state.artifacts),
    relations: mapToRecord(state.relations),
    conflict: mapToRecord(state.conflict),
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertRowKeyedRecord(
  doc: Record<string, unknown>,
  section: string,
  key: string,
): Record<string, unknown> {
  if (!isPlainObject(doc[section])) {
    throw new HostWiringError(
      'WIRING_SERVICE',
      `semantic state doc: ${section} must be an object (corrupt derived_state row ${key})`,
    )
  }
  const record = doc[section] as Record<string, unknown>
  for (const [id, row] of Object.entries(record)) {
    if (!isPlainObject(row) || row.id !== id) {
      throw new HostWiringError(
        'WIRING_SERVICE',
        `semantic state doc: ${section} entry ${JSON.stringify(id)} is not a row object keyed by its id (corrupt derived_state row ${key})`,
      )
    }
  }
  return record
}

/** Deserialize with strict shape checks (corruption ⇒ fail loud). */
export function jsonToSemanticState(doc: unknown, key: string): SemanticState {
  if (!isPlainObject(doc)) {
    throw new HostWiringError('WIRING_SERVICE', `semantic state doc at ${key} is not an object (corrupt)`)
  }
  const claims = assertRowKeyedRecord(doc, 'claims', key)
  const facts = assertRowKeyedRecord(doc, 'facts', key)
  const artifacts = assertRowKeyedRecord(doc, 'artifacts', key)
  const relations = assertRowKeyedRecord(doc, 'relations', key)
  if (!isPlainObject(doc.conflict)) {
    throw new HostWiringError('WIRING_SERVICE', `semantic state doc: conflict must be an object (corrupt derived_state row ${key})`)
  }
  const conflict = new Map<string, ConflictFlag>()
  for (const [claimId, flag] of Object.entries(doc.conflict as Record<string, unknown>)) {
    if (!isPlainObject(flag) || flag.kind !== 'PENDING_REVIEW' || !Array.isArray(flag.relationIds)) {
      throw new HostWiringError(
        'WIRING_SERVICE',
        `semantic state doc: conflict flag for ${JSON.stringify(claimId)} is malformed (corrupt derived_state row ${key})`,
      )
    }
    conflict.set(claimId, flag as unknown as ConflictFlag)
  }
  return {
    claims: new Map(Object.entries(claims) as [string, ClaimRow][]),
    facts: new Map(Object.entries(facts) as [string, FactRow][]),
    artifacts: new Map(Object.entries(artifacts) as [string, ArtifactRow][]),
    relations: new Map(Object.entries(relations) as [string, RelationRow][]),
    conflict,
  }
}

/* ------------------------------------------------------------------ *
 * The maintainer
 * ------------------------------------------------------------------ */

export interface SemanticMaintainerInput {
  /** The live wiring store. */
  readonly store: ResearchStore
  /** The project scope the `semantics` row belongs to. */
  readonly projectId: string
  readonly logger?: HostWiringLogger
}

export interface SemanticRebuildInput {
  /** The AUTHORITATIVE workstream list (rebuild is a wholesale fold —
   *  a missing workstream's events are never folded). */
  readonly workstreams: readonly string[]
  /** Replace the `derived_state` table with the rebuilt slice (default
   *  true). */
  readonly apply?: boolean
}

export interface SemanticRebuildResult {
  /** The rebuild-vs-incremental consistency report (WP-2.3 framework). */
  readonly report: ConsistencyReport
  /** Whether the table was replaced. */
  readonly applied: boolean
  /** The row count of the (applied, or would-be) rebuilt table. */
  readonly rowCount: number
}

export interface SemanticMaintainer {
  readonly key: string
  /** The incremental `validate` hook for `appendEvents` (in-transaction).
   *  Foldable through the same hook the services use for registry
   *  validation — compose by calling both in one hook. */
  readonly validateHook: (events: readonly HistoryEventRecord[], tx: TxScope) => void
  /** Full audit-order replay fold + consistency compare + (default)
   *  wholesale `derived_state` replace (semantics slice + pass-through). */
  rebuild(input: SemanticRebuildInput): SemanticRebuildResult
}

/**
 * Build the store-level semantics maintainer (RR-011 (b)).
 */
export function makeSemanticMaintainer(input: SemanticMaintainerInput): SemanticMaintainer {
  const key = semanticStateKey(input.projectId)
  if (!/^[A-Z]{3}-\d+$/.test(input.projectId)) {
    throw new HostWiringError('WIRING_SERVICE', `semantic maintainer: projectId must be a well-formed PRJ id (got ${JSON.stringify(input.projectId)})`)
  }

  const validateHook = (events: readonly HistoryEventRecord[], tx: TxScope): void => {
    const current = tx.getDerivedState(SEMANTICS_KIND, input.projectId)
    let state: SemanticState = current === null ? initialSemanticState() : jsonToSemanticState(current, key)
    let touched = false
    for (const event of events) {
      if (!SEMANTIC_EVENT_TYPES.includes(event.eventType)) continue
      const semantic = toSemanticInputEvent(event)
      if (!isSemanticEvent(semantic)) continue
      state = reduceSemanticEvent(state, semantic)
      touched = true
    }
    if (touched) {
      tx.setDerivedState(SEMANTICS_KIND, input.projectId, semanticStateToJson(state))
    }
  }

  const rebuild = (rebuildInput: SemanticRebuildInput): SemanticRebuildResult => {
    // 1. The full log in canonical AUDIT order (the pinned rebuild order).
    const events = collectAllEvents(input.store, rebuildInput.workstreams, 'audit')
    // 2. The replay fold — the SAME single reducer, from the empty state.
    const semantic = events.filter((e) => SEMANTIC_EVENT_TYPES.includes(e.eventType))
    const folded = foldSemanticEvents(semantic.map(toSemanticInputEvent))
    const touched = semantic.length > 0
    // 3. The current table: pass-through rows of every other object kind.
    const current = readDerivedState(input.store)
    const rebuilt = new Map<string, unknown>()
    for (const [k, value] of current) {
      let kind: string
      try {
        kind = parseStateKey(k).objectKind
      } catch {
        throw new HostWiringError(
          'WIRING_SERVICE',
          `semantic rebuild: derived_state key ${JSON.stringify(k)} is malformed — refusing to pass a corrupt key through`,
        )
      }
      if (kind === SEMANTICS_KIND && k === key) continue // replaced by the fold
      rebuilt.set(k, value)
    }
    if (touched) {
      rebuilt.set(key, semanticStateToJson(folded))
    }
    // 4. Consistency: the current table IS the incrementally maintained
    //    one (it is what the incremental hook wrote) — compare.
    const report = compareDerivedStates(rebuilt, current)
    if (!report.ok) {
      input.logger?.error(
        'semantic-rebuild',
        `incremental vs rebuild DRIFT: ${report.onlyInRebuilt.length} only-in-rebuilt, ${report.onlyInIncremental.length} only-in-incremental, ${report.differing.length} differing`,
      )
    } else {
      input.logger?.info('semantic-rebuild', `incremental ≡ rebuild (${rebuilt.size} rows)`)
    }
    // 5. Apply (default): ONE independent transaction on derived_state.
    let applied = false
    if (rebuildInput.apply !== false) {
      replaceDerivedStateTable(input.store.path, rebuilt)
      applied = true
      input.logger?.info('semantic-rebuild', `derived_state replaced (${rebuilt.size} rows, one independent transaction)`)
    }
    return { report, applied, rowCount: rebuilt.size }
  }

  return { key, validateHook, rebuild }
}

/* ------------------------------------------------------------------ *
 * The derived_state replace (WP-2.3 write discipline, semantics slice)
 * ------------------------------------------------------------------ */

/**
 * Replace the `derived_state` table with `states` in ONE independent
 * `BEGIN IMMEDIATE` transaction on a second connection to the SAME WAL
 * file — touching ONLY `derived_state` (the event table is
 * trigger-protected and is not prepared here at all). Crash ⇒ pre- or
 * post-transaction, never partial.
 */
function replaceDerivedStateTable(dbPath: string, states: Map<string, unknown>): number {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath)
  } catch (cause) {
    throw new HostWiringError(
      'WIRING_SERVICE',
      `semantic rebuild: cannot open ${dbPath} for the derived_state replace: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }
  try {
    db.exec('BEGIN IMMEDIATE')
    db.exec('DELETE FROM derived_state')
    const insert = db.prepare('INSERT INTO derived_state (object_kind, object_id, state) VALUES (?, ?, ?)')
    for (const [key, value] of states) {
      const parsed = parseStateKey(key)
      insert.run(parsed.objectKind, parsed.objectId, JSON.stringify(value))
    }
    db.exec('COMMIT')
  } catch (e) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* the transaction may already be rolled back */
    }
    throw new HostWiringError(
      'WIRING_SERVICE',
      `semantic rebuild: the derived_state replace failed (rolled back): ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    )
  } finally {
    try {
      db.close()
    } catch {
      /* best effort */
    }
  }
  return states.size
}
