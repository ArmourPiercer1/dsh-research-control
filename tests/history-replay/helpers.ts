/**
 * WP-2.3 test infrastructure: real-sqlite temp stores + a synthetic
 * §6-semantics derived-state reducer + the canonical rebuild stream.
 *
 * Every test opens a REAL research.sqlite in a throwaway directory
 * (mkdtemp under os.tmpdir) — same discipline as tests/store (WP-2.1).
 * All temp roots are removed in afterAll.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll } from 'vitest'

import {
  openDatabase,
  type ActorRefJson,
  type DerivedStatePatch,
  type HistoryEventInput,
  type HistoryEventRecord,
  type ResearchStore,
} from '../../src/host/persistence/store/index.js'
import type { HistoryEventRegistry } from '../../src/host/history/registry/index.js'
import {
  canonicalJson,
  parseStateKey,
  type DerivedStateMap,
  type DerivedStateReducer,
} from '../../src/host/history/replay/index.js'

const roots: string[] = []

/** Fresh temp directory (tracked for afterAll cleanup). */
export function makeTempDir(prefix = 'wp23-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

/** The conventional DB file name inside a project data dir. */
export function dbPath(dir: string): string {
  return join(dir, 'research.sqlite')
}

/** A FRESH store in a fresh temp dir (one per test — full isolation). */
export function freshStore(): ResearchStore {
  const dir = makeTempDir()
  return openDatabase(dbPath(dir), { now: makeClock() })
}

afterAll(() => {
  for (const r of roots) {
    rmSync(r, { recursive: true, force: true })
  }
})

/** Deterministic monotonic clock (recordedAt is store-generated — keep it
 *  reproducible in snapshots). */
export function makeClock(start = T0): () => number {
  let t = start
  return () => (t += 1_000)
}

/** Deterministic clock with a PEEK: the harness can predict the exact
 *  `recordedAt` the store will assign inside its NEXT append transaction
 *  (the store calls `now()` once per batch), without advancing it. */
export function makePeekingClock(start = T0): { now: () => number; peek: () => number } {
  let t = start
  return {
    now: () => (t += 1_000),
    peek: () => t + 1_000,
  }
}

/** Reference "now" (epoch ms). */
export const T0 = Date.parse('2026-08-22T09:00:00Z')

/** Event fixture spec (all fields optional; deterministic defaults). */
export interface EventSpec {
  eventId?: string
  ownerWorkstreamId?: string
  eventType?: string
  schemaVersion?: number
  occurredAt?: number
  actor?: ActorRefJson
  payload?: Record<string, unknown>
}

/** A HistoryEventInput (store-level: no validation hook by default). */
export function makeEvent(spec: EventSpec = {}): HistoryEventInput {
  return {
    eventId: spec.eventId ?? 'H-0',
    ownerWorkstreamId: spec.ownerWorkstreamId ?? 'WS-1',
    eventType: spec.eventType ?? 'RUN_STARTED',
    schemaVersion: spec.schemaVersion ?? 1,
    occurredAt: spec.occurredAt ?? T0,
    actor: spec.actor ?? { kind: 'USER', user_id: 'u-alice' },
    payload: spec.payload ?? { run_id: 'R-0' },
  }
}

/** Raw second connection (test harness only: corruption simulation +
 *  byte-level inspection of the tables). */
export function rawDb(path: string): DatabaseSync {
  return new DatabaseSync(path)
}

/* ------------------------------------------------------------------ *
 * Real frozen-schema registry (for the TC-HIST-008 write-gate tests)
 * ------------------------------------------------------------------ */

const HERE = dirname(fileURLToPath(import.meta.url))
/** Research-control-plane root (tests/history-replay → tests → plugin repo → root). */
export const WR_ROOT = join(HERE, '..', '..', '..')
/** The real frozen history schema dir (read-only contract). */
export const WR_HISTORY_SCHEMA_DIR = join(WR_ROOT, 'schema', 'history')

/** fs-backed `HistorySchemaReader` (tests may do I/O; the kernel may not). */
export class FsReader {
  readFile(path: string): string | null {
    if (!isAbsolute(path)) throw new Error(`FsReader requires absolute paths, got ${path}`)
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return readFileSync(path, 'utf8')
  }
}

/** Caller-owned validation error: the registry's shape errors, verbatim. */
export class ShapeValidationError extends Error {
  readonly errors: readonly unknown[]
  constructor(errors: readonly unknown[]) {
    super(`event rejected by the registry shape gate: ${errors.length} error(s)`)
    this.name = 'ShapeValidationError'
    this.errors = errors
  }
}

/**
 * Append through the store with the WP-2.2 shape gate wired as the
 * `validate` hook (the service-level seam: INV-HIST-4 write rejection).
 * On rejection the WHOLE batch rolls back and the error propagates
 * unchanged (store contract, WP-2.1).
 */
export function appendValidated(
  store: ResearchStore,
  registry: HistoryEventRegistry,
  events: readonly HistoryEventInput[],
) {
  return store.appendEvents(events, {
    validate: (evs) => {
      for (const ev of evs) {
        const shape = registry.checkShape(ev)
        if (!shape.ok) throw new ShapeValidationError(shape.errors)
      }
    },
  })
}

/* ------------------------------------------------------------------ *
 * Synthetic §6-semantics reducer (the WP-2.5 stand-in)
 * ------------------------------------------------------------------ *
 *
 * Mirrors HISTORY_EVENT_CATALOG §6's event→derived-cache table for the
 * run/task/claim kinds the rebuild stream exercises, and is
 * ORDER-SENSITIVE by design (every update appends to `trail`, sets
 * `lastEventSeq`/`lastOccurredAt`) — that sensitivity is what pins the
 * rebuild to the AUDIT order and lets the tests distinguish it from a
 * (from-inconsistent) semantic replay.
 */
export function makeTestReducer(): DerivedStateReducer {
  return (state, ev) => {
    const next = new Map(state)
    const p: Record<string, unknown> =
      typeof ev.payload === 'object' && ev.payload !== null ? (ev.payload as Record<string, unknown>) : {}
    const touch = (key: string, update: Record<string, unknown>): void => {
      const prev: Record<string, unknown> =
        typeof next.get(key) === 'object' && next.get(key) !== null ? (next.get(key) as Record<string, unknown>) : {}
      next.set(key, {
        ...prev,
        ...update,
        lastEventId: ev.eventId,
        lastEventSeq: ev.eventSeq,
        lastOccurredAt: ev.occurredAt,
        trail: [...((Array.isArray(prev.trail) ? (prev.trail as string[]) : [])), ev.eventId],
      })
    }
    switch (ev.eventType) {
      case 'RUN_STARTED':
        if (typeof p.run_id === 'string') touch(`run:${p.run_id}`, { status: 'RUNNING', startedAt: ev.occurredAt, endedAt: null })
        break
      case 'RUNS_STARTED':
        if (Array.isArray(p.runs)) {
          for (const r of p.runs) {
            if (typeof r === 'object' && r !== null && typeof (r as Record<string, unknown>).run_id === 'string') {
              const runId = (r as Record<string, unknown>).run_id as string
              // The per-owner batch rows (catalog §5.2 信封特例) are the SAME
              // logical start projected once per owner workstream — the
              // derived-state semantics apply it ONCE per run (idempotent
              // across the duplicates). In canonical audit order the
              // duplicates can straddle other workstreams' events, so a
              // naive re-apply would clobber later state.
              const prev: unknown = next.get(`run:${runId}`)
              if (typeof prev === 'object' && prev !== null && (prev as Record<string, unknown>).batchStarted === true) continue
              touch(`run:${runId}`, { status: 'RUNNING', startedAt: ev.occurredAt, endedAt: null, batchStarted: true })
            }
          }
        }
        break
      case 'RUN_FINISHED':
        if (typeof p.run_id === 'string') touch(`run:${p.run_id}`, { status: 'FINISHED', endedAt: ev.occurredAt })
        break
      case 'RUN_FAILED':
        if (typeof p.run_id === 'string') touch(`run:${p.run_id}`, { status: 'FAILED', endedAt: ev.occurredAt, failureKind: p.failure_kind ?? null })
        break
      case 'RUN_CANCELLED':
        if (typeof p.run_id === 'string') touch(`run:${p.run_id}`, { status: 'CANCELLED', endedAt: ev.occurredAt })
        break
      case 'TASK_EXECUTION_CHANGED':
        if (typeof p.task_id === 'string') touch(`task:${p.task_id}`, { execution: p.to, from: p.from })
        break
      case 'TASK_VALIDATION_CHANGED':
        if (typeof p.task_id === 'string') touch(`task:${p.task_id}`, { validation: p.to })
        break
      case 'ACCEPTANCE_CRITERIA_CHANGED':
        if (typeof p.task_id === 'string') touch(`task:${p.task_id}`, { acceptanceCriteria: p.to })
        break
      case 'CLAIM_RECORDED':
        if (typeof p.claim_id === 'string') touch(`claim:${p.claim_id}`, { status: 'ACTIVE', statement: p.statement ?? null })
        break
      case 'CLAIM_RETRACTED':
        if (typeof p.claim_id === 'string') touch(`claim:${p.claim_id}`, { status: 'RETRACTED', reason: p.reason ?? null })
        break
      case 'FACT_RECORDED':
        if (typeof p.fact_id === 'string') touch(`fact:${p.fact_id}`, { status: 'ACTIVE' })
        break
      default:
        break
    }
    return next
  }
}

/**
 * Incremental maintenance model: append the events ONE PER BATCH, each
 * accompanied by the reducer's own state delta as `derivedState` patches
 * (「与事件 append 同事务写入」, DOMAIN_SCHEMA §15). The append ORDER is
 * the canonical audit order (see REBUILD_EVENTS below) — the consistency
 * precondition documented on `rebuildDerivedState`.
 *
 * The reducer needs the COMPLETE envelope (store-assigned `eventSeq` /
 * `recordedAt`), but the store assigns them INSIDE its transaction, while
 * the patches must ride in the SAME transaction. The harness therefore
 * PREDICTS the assignment (per-WS MAX+1 — TC-HIST-003; the store clock's
 * next tick — `clock.peek()`) so the reducer sees the final envelope, and
 * then verifies the prediction against the store's actual assignment after
 * the commit (a divergence is a harness bug and fails loudly).
 *
 * Returns the final incrementally maintained map.
 */
export function appendIncrementally(
  store: ResearchStore,
  events: readonly HistoryEventInput[],
  reducer: DerivedStateReducer,
  clock: { peek: () => number },
): DerivedStateMap {
  let acc: DerivedStateMap = new Map<string, unknown>()
  const seqByWs = new Map<string, number>()
  for (const ev of events) {
    const seq = (seqByWs.get(ev.ownerWorkstreamId) ?? 0) + 1
    seqByWs.set(ev.ownerWorkstreamId, seq)
    const recordedAt = clock.peek()
    const record: HistoryEventRecord = { ...ev, eventSeq: seq, recordedAt }

    const next = reducer(acc, record)
    const patches: DerivedStatePatch[] = []
    for (const key of new Set([...acc.keys(), ...next.keys()])) {
      if (!acc.has(key) || canonicalJson(acc.get(key)) !== canonicalJson(next.get(key))) {
        const { objectKind, objectId } = parseStateKey(key)
        patches.push({ objectKind, objectId, state: next.get(key) })
      }
    }

    const result = store.appendEvents([ev], { derivedState: patches })
    const stored = result.events[0]
    if (stored.eventSeq !== seq || stored.recordedAt !== recordedAt) {
      throw new Error(
        `incremental harness: store assignment (seq=${stored.eventSeq}, recordedAt=${stored.recordedAt}) ` +
          `diverged from the harness prediction (seq=${seq}, recordedAt=${recordedAt})`,
      )
    }
    acc = next
  }
  return acc
}

/** Byte-level event-table snapshot (canonical lines, sorted) — the
 *  「重放不产生新的 HistoryEvent」 assertion material. */
export function snapshotEventLines(store: ResearchStore, workstreams: readonly string[]): string[] {
  const lines: string[] = []
  for (const ws of [...new Set(workstreams)].sort()) {
    for (const ev of store.listRange(ws, 1)) {
      lines.push(
        [
          ev.ownerWorkstreamId,
          ev.eventSeq,
          ev.eventId,
          ev.eventType,
          ev.schemaVersion,
          ev.occurredAt,
          ev.recordedAt,
          canonicalJson(ev.actor),
          canonicalJson(ev.source ?? null),
          canonicalJson(ev.payload),
        ].join('|'),
      )
    }
  }
  return lines.sort()
}

/* ------------------------------------------------------------------ *
 * The canonical rebuild stream (10 events, 2 workstreams)
 * ------------------------------------------------------------------ *
 *
 * Appended in CANONICAL AUDIT ORDER (eventSeq, ownerWorkstreamId, eventId
 * — the WP-2.2 `auditOrder` total order), which is the consistency
 * precondition for incremental == rebuild. Notable shapes:
 *   - H-4 / H-3: the RUNS_STARTED batch, one event PER OWNER workstream
 *     (same payload, catalog §5.2 信封特例) — WS-2's row is seq 1 there,
 *     WS-1's is seq 3;
 *   - H-10: LATE registration — occurredAt t(1.5) (between H-1 and H-2)
 *     but appended LAST, WS-1 seq 8 (audit tail);
 *   - the mutation chain on T-1 (PLANNED→ACTIVE at t(2), ACTIVE→PAUSED at
 *     t(1.5)-appended-later) makes the fold ORDER-SENSITIVE: audit order
 *     ends PAUSED (from-consistent, INV-HIST-5), semantic order ends
 *     ACTIVE (the late event applied before its `from` was set).
 */
export const REBUILD_WORKSTREAMS = ['WS-1', 'WS-2'] as const

const t = (n: number): number => T0 + 60_000 * n

export const REBUILD_EVENTS: readonly HistoryEventInput[] = [
  makeEvent({ eventId: 'H-1', ownerWorkstreamId: 'WS-1', eventType: 'RUN_STARTED', occurredAt: t(1), payload: { run_id: 'R-1', task_id: 'T-1' } }),
  makeEvent({ eventId: 'H-4', ownerWorkstreamId: 'WS-2', eventType: 'RUNS_STARTED', occurredAt: t(3), payload: { runs: [{ run_id: 'R-2' }, { run_id: 'R-3' }] } }),
  makeEvent({ eventId: 'H-2', ownerWorkstreamId: 'WS-1', eventType: 'TASK_EXECUTION_CHANGED', occurredAt: t(2), payload: { task_id: 'T-1', from: 'PLANNED', to: 'ACTIVE' } }),
  makeEvent({ eventId: 'H-8', ownerWorkstreamId: 'WS-2', eventType: 'RUN_FAILED', occurredAt: t(7), payload: { run_id: 'R-3', failure_kind: 'OOM' } }),
  makeEvent({ eventId: 'H-3', ownerWorkstreamId: 'WS-1', eventType: 'RUNS_STARTED', occurredAt: t(3), payload: { runs: [{ run_id: 'R-2' }, { run_id: 'R-3' }] } }),
  makeEvent({ eventId: 'H-5', ownerWorkstreamId: 'WS-1', eventType: 'TASK_VALIDATION_CHANGED', occurredAt: t(4), payload: { task_id: 'T-1', from: 'PENDING', to: 'UNDER_REVIEW' } }),
  makeEvent({ eventId: 'H-6', ownerWorkstreamId: 'WS-1', eventType: 'RUN_FINISHED', occurredAt: t(5), payload: { run_id: 'R-1' } }),
  makeEvent({ eventId: 'H-7', ownerWorkstreamId: 'WS-1', eventType: 'CLAIM_RECORDED', occurredAt: t(6), payload: { claim_id: 'C-1', statement: 'the array achieves sub-pixel accuracy' } }),
  makeEvent({ eventId: 'H-9', ownerWorkstreamId: 'WS-1', eventType: 'CLAIM_RETRACTED', occurredAt: t(8), payload: { claim_id: 'C-1', reason: 'reprojection error exceeds the 2px target' } }),
  // late registration: time position 1.5, registration position LAST (seq 8 on WS-1)
  makeEvent({ eventId: 'H-10', ownerWorkstreamId: 'WS-1', eventType: 'TASK_EXECUTION_CHANGED', occurredAt: t(1.5), payload: { task_id: 'T-1', from: 'ACTIVE', to: 'PAUSED', reason: 'late backfill of the pause' } }),
]

/** t(1.5) as a plain integer (60_000 * 1.5). */
export const LATE_OCCURRED_AT = T0 + 90_000

/** A 12-event single-workstream stream for the pagination suites:
 *  seq 1..10 at t(1)..t(10) plus two LATE registrations (seq 11 at
 *  t(1.5), seq 12 at t(5.5)) — interleaved time positions, tail seqs. */
export const PAGED_EVENTS: readonly HistoryEventInput[] = [
  ...Array.from({ length: 10 }, (_, i) =>
    makeEvent({
      eventId: `P-${i + 1}`,
      ownerWorkstreamId: 'WS-1',
      eventType: 'FACT_RECORDED',
      occurredAt: t(i + 1),
      payload: { fact_id: `F-${i + 1}`, statement: `fact ${i + 1}` },
    }),
  ),
  makeEvent({ eventId: 'P-11', ownerWorkstreamId: 'WS-1', eventType: 'FACT_RECORDED', occurredAt: t(1.5), payload: { fact_id: 'F-L1', statement: 'late fact 1' } }),
  makeEvent({ eventId: 'P-12', ownerWorkstreamId: 'WS-1', eventType: 'FACT_RECORDED', occurredAt: t(5.5), payload: { fact_id: 'F-L2', statement: 'late fact 2' } }),
]

/** Canonical form of a WHOLE derived-state table (map level): entries
 *  sorted by key, each value in its canonical-JSON form. The byte-identity
 *  comparison form for two `DerivedStateMap`s (used by TC-HIST-005/006). */
export function canonicalMapJson(map: DerivedStateMap): string {
  const entries = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return JSON.stringify(entries.map(([k, v]) => [k, canonicalJson(v)]))
}

/** Recursively freeze (tests: mutation attempts throw under strict mode). */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  if (Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  return value
}
