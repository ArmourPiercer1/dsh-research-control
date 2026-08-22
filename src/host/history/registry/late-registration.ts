/**
 * WP-2.2 — dual-timeline (late registration) preparation
 * (HISTORY_EVENT_CATALOG §1/§2; INV-HIST-6; TC-HIST-002/004).
 *
 * Two independent timelines:
 *  - `eventSeq` — the owner-workstream-local REGISTRATION order (1,2,3,…)
 *    assigned at append, never rewritten (INV-HIST-6); answers 「系统何时获知」
 *    (audit replay: ORDER BY event_seq);
 *  - `occurredAt` — the real-world RESEARCH time; answers the semantic
 *    timeline (replay: ORDER BY occurred_at, event_seq).
 *
 * Late registration (§1 L32): `occurredAt` may be OLDER than existing events
 * (back-filling last week's experiment); the event still takes
 * `eventSeq = current max + 1`. The two timelines are INDEPENDENT by design —
 * 「双时序的意义正在于此」.
 *
 * Validation-side contract (TC-HIST-002 校验半边): `validateEvent` never
 * assumes `occurredAt` monotonicity — it takes no previous-events context at
 * all and never compares `occurredAt` against anything (shape check only:
 * non-negative integer). These helpers are the pure, store-facing half of the
 * same contract (the store, WP-2.3, consumes them when it appends):
 *  - `nextEventSeq` derives the next seq from EXISTING SEQS ONLY (the signature
 *    cannot even see occurredAt — the independence is structural);
 *  - `semanticOrder` / `auditOrder` are the two replay orderings; the
 *    `eventSeq` tie-break on equal `occurredAt` is deterministic
 *    (TC-HIST-004), and a final (ownerWorkstreamId, eventId) tie-break keeps
 *    cross-workstream ordering total (TC-HIST-005 idempotent replay).
 *
 * Pure functions (zero I/O, zero mutation of the input arrays).
 */

export interface OrderedEvent {
  readonly occurredAt: number
  readonly eventSeq: number
  readonly ownerWorkstreamId?: string
  readonly eventId?: string
}

/**
 * The next owner-workstream eventSeq for a late-or-punctual registration:
 * current max + 1 (first event = 1). Deliberately independent of
 * `occurredAt` (catalog §1: 「此时 eventSeq 仍取当前最大值 +1」).
 */
export function nextEventSeq(existingSeqs: readonly number[]): number {
  let max = 0
  for (const seq of existingSeqs) {
    if (seq > max) max = seq
  }
  return max + 1
}

function byString(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0
  if (a === undefined) return -1
  if (b === undefined) return 1
  return a < b ? -1 : 1
}

/**
 * Semantic replay order (catalog §2): `ORDER BY occurred_at, event_seq` —
 * equal `occurredAt` tie-breaks on `eventSeq` (deterministic, TC-HIST-004);
 * a cross-workstream residual tie (same occurredAt AND same seq in different
 * owners) resolves on (ownerWorkstreamId, eventId) so the order is TOTAL and
 * repeatable (TC-HIST-005). Returns a new array.
 */
export function semanticOrder<T extends OrderedEvent>(events: readonly T[]): readonly T[] {
  return [...events].sort(
    (a, b) =>
      a.occurredAt - b.occurredAt ||
      a.eventSeq - b.eventSeq ||
      byString(a.ownerWorkstreamId, b.ownerWorkstreamId) ||
      byString(a.eventId, b.eventId),
  )
}

/**
 * Audit replay order (catalog §2): `ORDER BY event_seq` (registration order —
 * a late-registered event stays at the TAIL, TC-HIST-002). The residual tie
 * (same seq across owners) resolves on (ownerWorkstreamId, eventId). Returns a new array.
 */
export function auditOrder<T extends OrderedEvent>(events: readonly T[]): readonly T[] {
  return [...events].sort((a, b) => a.eventSeq - b.eventSeq || byString(a.ownerWorkstreamId, b.ownerWorkstreamId) || byString(a.eventId, b.eventId))
}
