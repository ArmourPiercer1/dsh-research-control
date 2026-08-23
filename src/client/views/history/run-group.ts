/**
 * History view — per-Run reading projection (WP-4.4, task:「wrapper 按 Run
 * 聚合的分组视图——聚合不改底层事件，纯展示层分组」).
 *
 * This is the CLIENT display twin of the host wrapper (src/host/history/
 * replay/wrapper.ts, WP-2.3 — the client cannot import host modules:
 * ARCHITECTURE §2.2 dependency direction, the client talks to the host
 * only through the RPC facade). The semantics are mirrored row for row:
 *
 *  - a PURE READ-ONLY PROJECTION over an event array (typically the
 *    accumulated timeline pages); the input is never mutated;
 *  - ZERO-COPY: each group's `events` are REFERENCES into the input array
 *    (the underlying DTO rows — the actual research chronicle — are never
 *    copied or rewritten; catalog §3.7, INV-HIST-8);
 *  - LENIENT: events whose payload does not carry a usable `run_id`
 *    (defensive shape — validation is upstream, at append time) are
 *    skipped, never fatal: a reading view must not hard-fail the UI;
 *  - DETERMINISTIC: groups are sorted by `runId` (total order,
 *    input-order-independent); member events inside a group keep INPUT
 *    order (the order the caller's query produced — semantic or audit).
 *
 * What it groups (run-lifecycle references only — the 「按 Run 折叠」 core,
 * same set as the host wrapper):
 *  - `RUN_STARTED`            → payload.run_id
 *  - `RUNS_STARTED` (batch)   → every payload.runs[i].run_id — the SAME
 *    event is projected into each member run's group (a projection
 *    duplication: the underlying single row is untouched);
 *  - `RUN_FINISHED` / `RUN_FAILED` / `RUN_CANCELLED` → payload.run_id.
 * All other event types pass through ungrouped (the projection reports
 * run groups only; the atomic timeline view renders them directly).
 */

import type { HistoryEventDto } from '../../../shared/rpc-contracts.js'

/** The end-of-run event types (per-Run, catalog §3.1: no RUNS_FINISHED). */
export type RunEndEventType = 'RUN_FINISHED' | 'RUN_FAILED' | 'RUN_CANCELLED'

/** The wrapper-derived lifecycle status of one Run group. */
export type RunGroupStatus = 'RUNNING' | 'FINISHED' | 'FAILED' | 'CANCELLED'

/** One per-Run reading group (a display projection, not a domain object). */
export interface HistoryRunGroup {
  readonly runId: string
  /** Distinct owner workstreams of the member events, sorted. For a
   *  batch-started run this is the batch's per-owner workstreams. */
  readonly ownerWorkstreams: readonly string[]
  /** Member events in INPUT order. References into the input array
   *  (zero-copy projection — the underlying rows are never rewritten). */
  readonly events: readonly HistoryEventDto[]
  /** Last known lifecycle status: the LAST end event in input order
   *  (terminal — an end takes precedence over starts, even when a
   *  late-registered end sorts before its start in a semantic view),
   *  or RUNNING when the run has no end event yet. */
  readonly status: RunGroupStatus
  /** `eventId` of the first (input order) member start event, if any. */
  readonly startEventId: string | null
  /** `eventId` of the last (input order) member end event, if any. */
  readonly endEventId: string | null
  /** The end event's type, if any. */
  readonly endEventType: RunEndEventType | null
}

interface MutableGroup {
  events: HistoryEventDto[]
  owners: Set<string>
  status: RunGroupStatus
  startEventId: string | null
  endEventId: string | null
  endEventType: RunEndEventType | null
}

const END_STATUS: Readonly<Record<RunEndEventType, RunGroupStatus>> = {
  RUN_FINISHED: 'FINISHED',
  RUN_FAILED: 'FAILED',
  RUN_CANCELLED: 'CANCELLED',
}

/** Project run-lifecycle events into per-Run wrapper groups.
 *  Pure: no I/O, no input mutation (see the module header). */
export function runGroups(events: readonly HistoryEventDto[]): readonly HistoryRunGroup[] {
  if (!Array.isArray(events)) {
    throw new TypeError('runGroups: events must be an array (read-only)')
  }
  // Re-anchor the static type: `Array.isArray` narrows to `any[]` (a
  // known TS gotcha), which would degrade the loop variable to `any` and
  // silently disable the payload type checks below.
  const list: readonly HistoryEventDto[] = events
  const byRun = new Map<string, MutableGroup>()
  const group = (runId: string): MutableGroup => {
    let g = byRun.get(runId)
    if (g === undefined) {
      g = { events: [], owners: new Set<string>(), status: 'RUNNING', startEventId: null, endEventId: null, endEventType: null }
      byRun.set(runId, g)
    }
    return g
  }

  for (const ev of list) {
    const payload: unknown = ev?.payload
    if (typeof payload !== 'object' || payload === null) continue
    const p = payload as Record<string, unknown>
    switch (ev.eventType) {
      case 'RUN_STARTED':
      case 'RUN_FINISHED':
      case 'RUN_FAILED':
      case 'RUN_CANCELLED': {
        const runId = typeof p.run_id === 'string' ? p.run_id : null
        if (runId === null) continue // defensive: upstream validation rejects this
        const g = group(runId)
        g.events.push(ev)
        g.owners.add(ev.ownerWorkstreamId)
        if (ev.eventType === 'RUN_STARTED') {
          g.startEventId = g.startEventId ?? ev.eventId // first start in input order
          // NOTE: no status write — an end event (whenever it sits in the
          // given order, e.g. a late-registered end in a semantic view)
          // takes precedence over starts; without any end the group
          // stays RUNNING.
        } else if (ev.eventType === 'RUN_FINISHED' || ev.eventType === 'RUN_FAILED' || ev.eventType === 'RUN_CANCELLED') {
          // (the switch admits no other type here)
          g.endEventId = ev.eventId
          g.endEventType = ev.eventType
          g.status = END_STATUS[ev.eventType]
        }
        break
      }
      case 'RUNS_STARTED': {
        // One event per owner workstream, each carrying the FULL runs list
        // (catalog §5.2 envelope special case) — the same row is projected
        // into every member run's group (projection duplication, INV-HIST-8).
        const runs: unknown = p.runs
        if (!Array.isArray(runs)) continue
        for (const r of runs) {
          const runId =
            typeof r === 'object' && r !== null && typeof (r as Record<string, unknown>).run_id === 'string'
              ? ((r as Record<string, unknown>).run_id as string)
              : null
          if (runId === null) continue // defensive
          const g = group(runId)
          g.events.push(ev)
          g.owners.add(ev.ownerWorkstreamId)
          g.startEventId = g.startEventId ?? ev.eventId // first start in input order
        }
        break
      }
      default:
        // Not a run-lifecycle reference — passes through ungrouped.
        break
    }
  }

  return [...byRun.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([runId, g]) => ({
      runId,
      ownerWorkstreams: [...g.owners].sort(),
      events: g.events,
      status: g.status,
      startEventId: g.startEventId,
      endEventId: g.endEventId,
      endEventType: g.endEventType,
    }))
}
