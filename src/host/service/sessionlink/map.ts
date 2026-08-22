/**
 * WP-2.6 — the pure session→Run mapping constructor (DSH_ADAPTER §7 /
 * TC-DSH-004 / HISTORY_EVENT_CATALOG §5.1).
 *
 * `mapSessionWindow(input): SessionWindowMapping | null`
 *
 *   input  = one session's observed event window (`SessionWindowInput`);
 *   output = the RUN_STARTED/RUN_FINISHED events to append — or `null`
 *            when the window produces no Run-lifecycle transition.
 *
 * The constructor is PURE (no I/O, no clock — `now` and the id allocator
 * are injected) and DETERMINISTIC: the same input yields the same output
 * (tests pin both). It never throws on well-formed input; it derives
 * boundaries from event TYPES only (the WP-0.4 port projects `type`+`seq`;
 * see the `SessionWindowInput` doc for the full mapping semantics).
 *
 * Mapping rules (frozen-contract derivation, TC-DSH-004 「从 agent/* live
 * 事件 + turn 事件推导起止」):
 *
 * | window event            | no open run                          | open run `R`                                  |
 * |-------------------------|--------------------------------------|-----------------------------------------------|
 * | `turn/start` (seq s)    | RUN_STARTED (new id, occurredAt=t(s))| RUN_FINISHED(R, t(s), late close) + RUN_STARTED (new) |
 * | `turn/end` (seq s)      | ignored (orphan edge)                | RUN_FINISHED(R, t(s))                          |
 * | any other type          | ignored                              | ignored (no Run-lifecycle boundary)           |
 * | window `disposed` flag  | ignored                              | RUN_FINISHED(R, now, 「session disposed with open turn」) |
 *
 * where `t(s)` = the event's projected `time`, falling back to `now`.
 *
 * Idempotency (constraint half): an event with `seq <= afterSeq` is
 * REJECTED before mapping (re-delivery of an already-consumed edge).
 * `lastSeq` in the result is the highest seq that produced a transition —
 * the pointer advance target (no-op events do not advance it; re-reading
 * them later is harmless because they still produce nothing).
 */

import type {
  RunEventDraft,
  SessionWindowInput,
  SessionWindowMapping,
  SessionWindowEvent,
} from './types.js'

/** The mechanical close note when a run is ended by something other than a clean `turn/end`. */
export const LATE_CLOSE_SUMMARY = 'superseded by next turn (no turn/end observed)'
export const DISPOSED_CLOSE_SUMMARY = 'session disposed with open turn'

/** `initiated_by` of a mechanically registered run: the session's user (the
 *  prompt that opened the turn) — the plugin does not know user ids, the
 *  session pointer is the honest mechanical attribution (catalog §5.1). */
function initiatedBy(sessionId: string): Record<string, unknown> {
  return { kind: 'USER', session_id: sessionId }
}

/** The `occurredAt` of one window event: its projected `time`, else `now`. */
function occurredAtOf(event: SessionWindowEvent, now: number): number {
  return event.time === undefined ? now : event.time
}

/**
 * Map one session event window to the RUN_* events to append.
 *
 * @returns the mapping (drafts in append order + resulting active run +
 *   pointer advance), or `null` when the window produces no transition.
 *   `null` vs `{events: []}`: never — any non-null result carries ≥1 draft
 *   by construction (the two cases are one: no transition ⇔ null).
 */
export function mapSessionWindow(input: SessionWindowInput): SessionWindowMapping | null {
  if (typeof input?.sessionId !== 'string' || input.sessionId.length === 0) {
    throw new TypeError('mapSessionWindow: sessionId must be a non-empty string')
  }
  if (typeof input.now !== 'number' || !Number.isFinite(input.now)) {
    throw new TypeError('mapSessionWindow: now must be a finite epoch-ms number')
  }
  if (typeof input.allocateRunId !== 'function') {
    throw new TypeError('mapSessionWindow: allocateRunId must be a function')
  }
  const events = input.events
  if (!Array.isArray(events)) {
    throw new TypeError('mapSessionWindow: events must be an array')
  }
  const afterSeq = input.afterSeq ?? 0
  if (typeof afterSeq !== 'number' || !Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    throw new TypeError('mapSessionWindow: afterSeq must be a non-negative safe integer')
  }

  let active: string | null = input.activeRunId ?? null
  const drafts: RunEventDraft[] = []
  let lastSeq = afterSeq

  const startDraft = (runId: string, at: number): RunEventDraft => ({
    eventType: 'RUN_STARTED',
    occurredAt: at,
    runId,
    payload: {
      run_id: runId,
      dsh_session_id: input.sessionId,
      ...(input.taskId !== undefined ? { task_id: input.taskId } : {}),
      ...(input.intent !== undefined ? { intent: input.intent } : {}),
      initiated_by: initiatedBy(input.sessionId),
    },
  })
  const finishDraft = (runId: string, at: number, summary: string | undefined): RunEventDraft => ({
    eventType: 'RUN_FINISHED',
    occurredAt: at,
    runId,
    payload: {
      run_id: runId,
      ...(summary !== undefined ? { outcome_summary: summary } : {}),
    },
  })

  for (const event of events) {
    // Idempotency gate: already-consumed edges are rejected (re-delivery).
    if (event.seq <= afterSeq) continue
    if (event.seq <= lastSeq) continue // within-window regression (DSH seqs are unique + monotonic)

    switch (event.type) {
      case 'turn/start': {
        const at = occurredAtOf(event, input.now)
        if (active !== null) {
          // Late close: the superseding moment is attributed to THIS event.
          drafts.push(finishDraft(active, at, LATE_CLOSE_SUMMARY))
        }
        active = input.allocateRunId()
        drafts.push(startDraft(active, at))
        lastSeq = event.seq
        break
      }
      case 'turn/end': {
        if (active !== null) {
          drafts.push(finishDraft(active, occurredAtOf(event, input.now), undefined))
          active = null
          lastSeq = event.seq
        }
        // Orphan `turn/end` (no open run): ignored — no transition, no advance.
        break
      }
      default:
        // No Run-lifecycle boundary (type-only mapping, module doc).
        break
    }
  }

  if (input.disposed && active !== null) {
    drafts.push(finishDraft(active, input.now, DISPOSED_CLOSE_SUMMARY))
    active = null
  }

  if (drafts.length === 0) return null
  return { events: drafts, activeRunId: active, lastSeq }
}
