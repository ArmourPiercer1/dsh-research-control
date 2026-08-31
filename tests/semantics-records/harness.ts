/**
 * V2-UI-0.4 UI-7 (D §13) — tests/semantics-records/ harness: the FULL
 * production-faithful stack (zero mocks on the write path), mirroring
 * tests/dependency/harness.ts:
 *
 *   1. REAL temp-file `ResearchStore` (`openDatabase` — WAL + V1 schema +
 *      connection guard);
 *   2. REAL frozen event registry (`loadHistoryEventRegistry` against the
 *      actual `schema/history` dir — cached per module);
 *   3. REAL `SemanticMaintainer.validateHook` (RR-011(b)) applied through
 *      a minimal mirror of the PRODUCTION store seam (wiring/realize-store
 *      `validateHooks` — after the service's own validate, in the same
 *      transaction, exactly once; the bare `openDatabase` store carries no
 *      seam, so the harness supplies it);
 *   4. REAL `IdAllocator` on the store's OWN meta face, wrapped in a spy
 *      that records reserve/commit/release;
 *   5. deterministic monotonic clock shared by store (recordedAt) and
 *      service (occurredAt).
 *
 * The harness additionally exposes:
 *   - `readSemanticRow` — the derived `semantics:<projectId>` row decoded
 *     with the production codec (the §13.4 read path reads the same row);
 *   - `countEvents` / `listEvents` — direct history_event reads (the
 *     ADJ-3 "pre-validation failure leaves NO event row" pin needs the
 *     raw log);
 *   - `storeWithSeam` — the seam object itself (the hook-composition pin
 *     inspects it).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { isAbsolute, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll } from 'vitest'

import { openDatabase } from '../../src/host/persistence/store/index.js'
import type { ResearchStore, HistoryEventRecord } from '../../src/host/persistence/store/types.js'
import { loadHistoryEventRegistry } from '../../src/host/history/registry/index.js'
import type { HistoryEventRegistry } from '../../src/host/history/registry/types.js'
import { makeSemanticMaintainer, jsonToSemanticState, semanticStateKey } from '../../src/host/service/wiring/index.js'
import { IdAllocator } from '../../src/shared/ids/index.js'
import type { SemanticState } from '../../src/host/domain/semantics/index.js'
import {
  SemanticRecordsService,
  type SemanticIdAllocator,
  type SemanticPlanIndex,
  type SemanticRecordsStorePort,
} from '../../src/host/service/semantics/index.js'

/** WR root (tests/semantics-records → tests → plugin repo → WR). */
const HERE = dirname(fileURLToPath(import.meta.url))
const WR_ROOT = join(HERE, '..', '..', '..')
const WR_HISTORY_SCHEMA_DIR = join(WR_ROOT, 'schema', 'history')

const PROJECT = 'PRJ-1'
export const T0 = 1_700_000_000_000

/* ------------------------------------------------------------------ *
 * The frozen registry (cached — the schema bytes are read-only)
 * ------------------------------------------------------------------ */

class FsReader {
  readFile(path: string): string | null {
    if (!isAbsolute(path)) throw new Error(`FsReader requires absolute paths, got ${path}`)
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return readFileSync(path, 'utf8')
  }
}

let registryCache: HistoryEventRegistry | undefined
/** The frozen registry (cached per module — the schema bytes are read-only). */
export function loadFrozenRegistry(): HistoryEventRegistry {
  if (registryCache === undefined) {
    const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)
    if (!registry.isUsable) {
      throw new Error(
        `registry unusable in semantics-records tests: ${registry.loadErrors.map((e) => e.message).join('; ')}`
      )
    }
    registryCache = registry
  }
  return registryCache
}

/* ------------------------------------------------------------------ *
 * The allocator spy (records the lifecycle; delegates to the real one)
 * ------------------------------------------------------------------ */

export interface AllocatorEvent {
  readonly op: 'reserve' | 'commit' | 'release'
  readonly id: string
  readonly kind: string
}

export function spyAllocator(real: IdAllocator): { allocator: SemanticIdAllocator; events: AllocatorEvent[] } {
  const events: AllocatorEvent[] = []
  return {
    events,
    allocator: {
      reserve: (kind, projectId) => {
        const r = real.reserve(kind, projectId)
        events.push({ op: 'reserve', id: r.id, kind: r.kind })
        return r
      },
      commit: (r) => {
        events.push({ op: 'commit', id: r.id, kind: r.kind })
        real.commit(r)
      },
      release: (r) => {
        events.push({ op: 'release', id: r.id, kind: r.kind })
        real.release(r)
      },
    },
  }
}

/* ------------------------------------------------------------------ *
 * The deterministic clock (shared store/service — single clock)
 * ------------------------------------------------------------------ */

export function makeClock(): { now: () => number; peek: () => number } {
  let n = 0
  return {
    now: (): number => {
      n += 1
      return T0 + n * 1000
    },
    peek: (): number => T0 + (n + 1) * 1000,
  }
}

/* ------------------------------------------------------------------ *
 * The workstream index fixture (two WS — cross-WS cases)
 * ------------------------------------------------------------------ */

export function defaultPlans(): SemanticPlanIndex {
  return {
    workstreams: [
      { id: 'WS-1', topicId: 'TP-1', taskIds: ['T-1', 'T-2', 'T-3'], gateIds: ['G-1'], milestoneIds: ['M-1'] },
      { id: 'WS-2', topicId: 'TP-1', taskIds: ['T-5'], gateIds: ['G-2'], milestoneIds: [] },
    ],
  }
}

/* ------------------------------------------------------------------ *
 * The harness
 * ------------------------------------------------------------------ */

const disposers: Array<() => void> = []
afterAll(() => {
  for (const d of disposers) {
    try {
      d()
    } catch {
      /* best effort */
    }
  }
})

export interface Harness {
  readonly service: SemanticRecordsService
  readonly store: ResearchStore
  /** The seam object actually handed to the service (the hook-composition pin). */
  readonly storeWithSeam: SemanticRecordsStorePort
  /** The SPY allocator the service drives (the reserve/commit/release pin). */
  readonly allocator: SemanticIdAllocator
  readonly allocatorEvents: AllocatorEvent[]
  readonly plans: SemanticPlanIndex
  readonly clock: ReturnType<typeof makeClock>
  readonly projectId: string
  close(): void
}

export function makeService(plans: SemanticPlanIndex = defaultPlans()): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'rc-records-'))
  const clock = makeClock()
  const store = openDatabase(join(dir, 'research.sqlite'), { now: clock.now })
  const registry = loadFrozenRegistry()
  const allocator = new IdAllocator(store.meta())
  const spy = spyAllocator(allocator)
  const maintainer = makeSemanticMaintainer({ store, projectId: PROJECT })
  // RR-011(b) seam mirror (wiring/realize-store `validateHooks`): the
  // semantic incremental fold runs AFTER the service's own validate, in
  // the same transaction — exactly once, for every service. The bare
  // `openDatabase` store carries no seam, so the harness supplies it;
  // otherwise the fold rules (state-machine terminality, 5-tuple
  // uniqueness, reverse-duplicate) would go untested and the production
  // double-fold regression could not surface in this suite.
  const storeWithSeam: SemanticRecordsStorePort = {
    path: store.path,
    listRange: (ownerWorkstreamId, fromSeq, toSeq) => store.listRange(ownerWorkstreamId, fromSeq, toSeq),
    appendEvents: (events, options) =>
      store.appendEvents(events, {
        ...options,
        validate: (finalized, tx): void => {
          options?.validate?.(finalized, tx)
          maintainer.validateHook(finalized, tx)
        },
      }),
  }
  const service = new SemanticRecordsService({
    store: storeWithSeam,
    registry,
    allocator: spy.allocator,
    plans,
    projectId: PROJECT,
    now: clock.now,
  })
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    try {
      store.close()
    } catch {
      /* best effort */
    }
    rmSync(dir, { recursive: true, force: true })
  }
  disposers.push(close)
  return { service, store, storeWithSeam, allocator: spy.allocator, allocatorEvents: spy.events, plans, clock, projectId: PROJECT, close }
}

/* ------------------------------------------------------------------ *
 * The derived semantics row + raw log reads (production codecs)
 * ------------------------------------------------------------------ */

export function readSemanticRow(store: ResearchStore, projectId: string): SemanticState | undefined {
  const raw = new DatabaseSync(store.path)
  try {
    const row = raw
      .prepare('SELECT state FROM derived_state WHERE object_kind = ? AND object_id = ?')
      .get('semantics', projectId) as { state: string } | undefined
    if (row === undefined) return undefined
    // The column holds the canonical JSON string; the codec consumes the
    // PARSED doc (the store's TxScope decodes the same way).
    return jsonToSemanticState(JSON.parse(row.state), semanticStateKey(projectId))
  } finally {
    raw.close()
  }
}

/** Count of `history_event` rows for one owner workstream (all types). */
export function countEvents(store: ResearchStore, ownerWorkstreamId: string): number {
  const raw = new DatabaseSync(store.path, { readOnly: true })
  try {
    const row = raw
      .prepare('SELECT COUNT(*) AS n FROM history_event WHERE owner_workstream_id = ?')
      .get(ownerWorkstreamId) as { n: number }
    return row.n
  } finally {
    raw.close()
  }
}

/** One raw log row by event id (the ADJ-3 no-row pin asserts absence). */
export function findEvent(store: ResearchStore, eventId: string): HistoryEventRecord | undefined {
  const raw = new DatabaseSync(store.path)
  try {
    const rows = raw
      .prepare(
        'SELECT event_id, owner_workstream_id, event_seq, event_type, schema_version, occurred_at, recorded_at, actor, source, payload FROM history_event WHERE event_id = ?'
      )
      .all(eventId) as Array<Record<string, unknown>>
    if (rows.length === 0) return undefined
    const r = rows[0]!
    return {
      eventId: String(r.event_id),
      ownerWorkstreamId: String(r.owner_workstream_id),
      eventSeq: Number(r.event_seq),
      eventType: String(r.event_type),
      schemaVersion: Number(r.schema_version),
      occurredAt: Number(r.occurred_at),
      recordedAt: Number(r.recorded_at),
      actor: JSON.parse(String(r.actor)),
      source: r.source === null || r.source === undefined ? undefined : JSON.parse(String(r.source)),
      payload: JSON.parse(String(r.payload)),
    }
  } finally {
    raw.close()
  }
}
