/**
 * WP-2.3 — wrapper (projection) aggregation: the per-Run reading view
 * (catalog §3.7「可读性聚合（按 Run 折叠阅读等）只存在于 wrapper/projection
 * 层，底层事件不变」; INV-HIST-8; TC-HIST-007's「wrapper 聚合视图不改底层」
 * half — the store half of TC-HIST-007: RUNS_STARTED splits into one event
 * per owner workstream and Run ends are per-Run — is append-side and
 * covered with the store + registry).
 *
 * What the wrapper is:
 *   - a PURE READ-ONLY PROJECTION over an event array (typically one
 *     `queryEvents` page or a `collectAllEvents` result);
 *   - zero-copy: each entry's `events` are REFERENCES to the input record
 *     objects (a new outer array, no event is copied or rewritten);
 *   - lenient: events whose payload does not carry a usable `run_id`
 *     (defensive shape — validation is UPSTREAM, the store + registry
 *     already rejected such events at write time) are skipped, never
 *     fatal: a reading view must not hard-fail the UI on odd data;
 *   - deterministic: entries are sorted by `runId` (total order,
 *     input-order-independent); member events inside an entry keep INPUT
 *     order (the order the caller's query produced — semantic or audit).
 *
 * What it groups (run-lifecycle references only — the 「按 Run 折叠」 core):
 *   - `RUN_STARTED`            → payload.run_id
 *   - `RUNS_STARTED` (batch)   → every payload.runs[i].run_id — the SAME
 *     event is projected into each member run's entry (a projection
 *     duplication: the underlying single row is untouched, INV-HIST-8);
 *   - `RUN_FINISHED` / `RUN_FAILED` / `RUN_CANCELLED` → payload.run_id.
 * All other event types pass through ungrouped (the wrapper reports run
 * entries only; a caller wanting non-run objects projects them itself).
 *
 * Invariance of the underlying events (INV-HIST-8 / TC-HIST-007):
 * structural — this module has NO write path (no store handle, no I/O of
 * any kind) and never mutates its input; tested — deep-frozen inputs
 * survive the call byte-identical, and store rows re-read after a wrapper
 * call are byte-identical (tests/wrapper.test.ts).
 */

import type { HistoryEventRecord } from '../../persistence/store/index.js'

/** The end-of-run event type (per-Run, catalog §3.1: no RUNS_FINISHED). */
export type RunEndEventType = 'RUN_FINISHED' | 'RUN_FAILED' | 'RUN_CANCELLED'

export interface RunWrapperEntry {
  readonly runId: string
  /** Distinct owner workstreams of the member events, sorted. For a
   *  batch-started run this is the batch's per-owner workstreams
   *  (each RUNS_STARTED row's single owner). */
  readonly ownerWorkstreams: readonly string[]
  /** Member events in INPUT order. References into the input array
   *  (zero-copy projection — the underlying rows are never rewritten). */
  readonly events: readonly HistoryEventRecord[]
  /** Last known lifecycle status: the LAST end event in input order
   *  (terminal — an end takes precedence over starts, even when a
   *  late-registered end sorts before its start in a semantic view),
   *  or RUNNING when the run has no end event yet. A run whose only
   *  member events are ends (defensive — cannot happen through the
   *  validated store) reports the end status with `startEventId: null`. */
  readonly status: 'RUNNING' | 'FINISHED' | 'FAILED' | 'CANCELLED'
  /** `eventId` of the member RUN_STARTED / RUNS_STARTED event, if any. */
  readonly startEventId: string | null
  /** `eventId` of the member end event, if any. */
  readonly endEventId: string | null
  /** The end event's type, if any. */
  readonly endEventType: RunEndEventType | null
}

interface MutableEntry {
  events: HistoryEventRecord[]
  owners: Set<string>
  started: boolean
  status: 'RUNNING' | 'FINISHED' | 'FAILED' | 'CANCELLED'
  startEventId: string | null
  endEventId: string | null
  endEventType: RunEndEventType | null
}

/** Project run-lifecycle events into per-Run wrapper entries.
 *  Pure: no I/O, no input mutation (see the module header). */
export function runWrapper(events: readonly HistoryEventRecord[]): readonly RunWrapperEntry[] {
  if (!Array.isArray(events)) {
    throw new TypeError('runWrapper: events must be an array (read-only)')
  }
  const byRun = new Map<string, MutableEntry>()
  const entry = (runId: string): MutableEntry => {
    let e = byRun.get(runId)
    if (e === undefined) {
      e = {
        events: [],
        owners: new Set<string>(),
        started: false,
        status: 'RUNNING',
        startEventId: null,
        endEventId: null,
        endEventType: null,
      }
      byRun.set(runId, e)
    }
    return e
  }

  for (const ev of events) {
    const payload: unknown = ev?.payload
    if (typeof payload !== 'object' || payload === null) continue
    const p = payload as Record<string, unknown>
    switch (ev.eventType) {
      case 'RUN_STARTED': {
        const runId = typeof p.run_id === 'string' ? p.run_id : null
        if (runId === null) continue // defensive: upstream validation rejects this
        const e = entry(runId)
        e.events.push(ev)
        e.owners.add(ev.ownerWorkstreamId)
        e.started = true
        e.startEventId = e.startEventId ?? ev.eventId // first start in input order
        // NOTE: no status write — an end event (whenever it sits in the
        // given order, e.g. a late-registered end in a semantic view) takes
        // precedence over starts; without any end the entry stays RUNNING.
        break
      }
      case 'RUNS_STARTED': {
        // One event per owner workstream, each carrying the FULL runs list
        // (catalog §5.2 信封特例) — the same row is projected into every
        // member run's entry (projection duplication, INV-HIST-8).
        const runs = Array.isArray(p.runs) ? p.runs : []
        for (const r of runs) {
          const runId =
            typeof r === 'object' && r !== null && typeof (r as Record<string, unknown>).run_id === 'string'
              ? ((r as Record<string, unknown>).run_id as string)
              : null
          if (runId === null) continue // defensive
          const e = entry(runId)
          e.events.push(ev)
          e.owners.add(ev.ownerWorkstreamId)
          e.started = true
          e.startEventId = e.startEventId ?? ev.eventId // first start in input order
        }
        break
      }
      case 'RUN_FINISHED':
      case 'RUN_FAILED':
      case 'RUN_CANCELLED': {
        const runId = typeof p.run_id === 'string' ? p.run_id : null
        if (runId === null) continue // defensive
        const e = entry(runId)
        e.events.push(ev)
        e.owners.add(ev.ownerWorkstreamId)
        e.endEventId = ev.eventId
        e.endEventType = ev.eventType
        e.status = ev.eventType === 'RUN_FINISHED' ? 'FINISHED' : ev.eventType === 'RUN_FAILED' ? 'FAILED' : 'CANCELLED'
        break
      }
      default:
        // Not a run-lifecycle reference — passes through ungrouped.
        break
    }
  }

  const out: RunWrapperEntry[] = [...byRun.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([runId, e]) => ({
      runId,
      ownerWorkstreams: [...e.owners].sort(),
      events: e.events,
      status: e.status,
      startEventId: e.startEventId,
      endEventId: e.endEventId,
      endEventType: e.endEventType,
    }))
  return out
}
