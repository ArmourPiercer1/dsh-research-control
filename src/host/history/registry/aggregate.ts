/**
 * WP-2.2 — wrapper / atomic event semantics (HISTORY_EVENT_CATALOG §3.1, §3.7,
 * §5.2; INV-HIST-2/8; TC-HIST-007).
 *
 * Atomicity rule (§3.1 / INV-HIST-2): one HistoryEvent = one atomic source
 * operation — different research operations are NEVER aggregated into one
 * semantic transaction event. RUNS_STARTED is the sole exception: one batch
 * launch starting several Runs is ONE atomic runtime event. Run END is always
 * per-Run (RUN_FINISHED / RUN_FAILED / RUN_CANCELLED — there is no
 * RUNS_FINISHED in the catalog).
 *
 * Readability aggregation (§3.7 / INV-HIST-8): collapsing/reading views
 * (「按 Run 折叠阅读等」) live ONLY in the wrapper/projection layer; the
 * underlying events are never modified by them. The helpers here are the
 * projection layer's sanctioned entry point: they expose the members of the
 * aggregate and the owner fan-out set, read-only.
 *
 * Member rules enforced on the event side (registry/validate):
 *  - `runs` has ≥2 entries (schema `minItems: 2`; =1 ⇒ use RUN_STARTED);
 *  - every member run is fresh (新建), every optional task_id exists;
 *  - the batch envelope fan-out (§5.2 信封特例: one same-payload event per
 *    relevant owner WS, each owner's eventSeq advancing independently) is a
 *    registration-time property — `batchOwnerWorkstreams` computes the set the
 *    STORE must fan out to; the single-event validator sees one owner at a time.
 *
 * Pure (zero I/O, zero mutation).
 */

import type { EventOf, HistoryEvent, RunStartEntry } from './types.js'

/** The frozen aggregate rule set (RUNS_STARTED is the ONLY aggregate event). */
export const BATCH_LAUNCH_RULES = {
  eventType: 'RUNS_STARTED',
  memberField: 'runs',
  /** A single-run launch must use RUN_STARTED (catalog §5.2; schema minItems: 2). */
  minMembers: 2,
  /** §5.2 信封特例: one same-payload event per relevant owner WS. */
  perOwnerEnvelope: true,
  /** Run end is always per-Run — no RUNS_FINISHED (catalog §3.1/§5.2). */
  runEndsPerRun: true,
  /** §3.7/INV-HIST-8: projections never modify the underlying events. */
  underlyingEventsImmutable: true,
} as const

/** Type guard: is the event the batch-launch aggregate? */
export function isBatchLaunch(event: HistoryEvent): event is EventOf<'RUNS_STARTED'> {
  return event.eventType === 'RUNS_STARTED'
}

/**
 * The members of one batch-launch aggregate — the wrapper/projection layer's
 * read-only view (INV-HIST-8: the projection groups these events, it never
 * rewrites them; the returned array is the event's own `runs` reference, so
 * any mutation attempt is a caller bug the caller owns).
 *
 * @throws TypeError when the event is not RUNS_STARTED (guard with isBatchLaunch).
 */
export function batchMembers(event: EventOf<'RUNS_STARTED'>): readonly RunStartEntry[] {
  if (!isBatchLaunch(event)) throw new TypeError('batchMembers: event is not RUNS_STARTED')
  return event.payload.runs
}

/**
 * The owner workstreams a batch launch must be registered to — one same-
 * payload event each (§5.2 信封特例). Deterministic: unique, first-seen order.
 *
 * `taskWorkstream` resolves a task id to its workstream (the store's lookup
 * over the operational state). Members without a `task_id` contribute no
 * owner (a bare run start has no declarative WS anchor in V1 — the caller
 * assigns the launch's own WS for such members).
 */
export function batchOwnerWorkstreams(
  runs: readonly RunStartEntry[],
  taskWorkstream: (taskId: string) => string | undefined,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const run of runs) {
    if (run.task_id === undefined) continue
    const ws = taskWorkstream(run.task_id)
    if (ws !== undefined && !seen.has(ws)) {
      seen.add(ws)
      out.push(ws)
    }
  }
  return out
}
