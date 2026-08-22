/**
 * WP-2.3 — the generic replay engine: `foldEvents`.
 *
 * The ONE replay primitive this WP provides. The reducer body is NOT this
 * WP's (WP-2.5 / the domain objects own the per-event derived-state
 * semantics, catalog §6's table) — this module supplies the ENGINE:
 *
 *   ```ts
 *   const state = foldEvents(events, (acc, ev) => domainReducer(acc, ev), initial)
 *   ```
 *
 * Contract:
 *   - PURE LEFT FOLD: `state_n = reducer(state_{n-1}, events[n])`, starting
 *     from `initial`. No I/O, no clock, no writes, no global state — a
 *     replay through this engine structurally CANNOT produce new
 *     HistoryEvents (there is no write path anywhere on its type surface;
 *     `rebuildDerivedState`'s independent write transaction touches ONLY
 *     the `derived_state` table and starts only AFTER the fold completes).
 *   - REPLAY ORDER IS THE CALLER'S: the engine folds the array AS GIVEN.
 *     The caller chooses the timeline (catalog §2: `semanticOrder` for the
 *     research timeline, `auditOrder` for 「系统何时获知」; §6 pins
 *     derived-state REBUILD to the audit order — mutation `from`-consistency
 *     (INV-HIST-5) only holds when events are applied in registration
 *     order, and late-registered events must apply at their registration
 *     position, not their time position).
 *   - THE REDUCER MUST BE PURE: same (state, event) ⇒ same result, and it
 *     must return a NEW state (mutating the accumulated state is a reducer
 *     bug — idempotency, TC-HIST-005, is asserted in tests by folding the
 *     same stream twice and deep-comparing, and by feeding frozen states).
 *   - A throwing reducer propagates UNCHANGED (caller-owned error type);
 *     nothing observable escapes from the fold (it is in-memory only).
 *
 * Idempotency (TC-HIST-005「同一事件流重放 N 次结果逐字节一致」): a pure
 * fold of an immutable input array is a deterministic function — N replays
 * are byte-identical by construction; the tests pin it (twice AND thrice,
 * deep-equal, for both orderings).
 */

/** A pure state transition: (state, event) → new state. */
export type Reducer<S, E> = (state: S, event: E) => S

/**
 * Pure left fold over an event stream. `events` is consumed read-only and
 * never mutated; `initial` is returned verbatim when `events` is empty.
 *
 * @typeParam S  the accumulated state (e.g. `DerivedStateMap`)
 * @typeParam E  the event element (e.g. `HistoryEventRecord`)
 */
export function foldEvents<S, E>(events: readonly E[], reducer: Reducer<S, E>, initial: S): S {
  if (!Array.isArray(events)) {
    throw new TypeError('foldEvents: events must be an array (read-only)')
  }
  if (typeof reducer !== 'function') {
    throw new TypeError('foldEvents: reducer must be a function (state, event) => state')
  }
  let state: S = initial
  for (const event of events) {
    state = reducer(state, event)
  }
  return state
}
