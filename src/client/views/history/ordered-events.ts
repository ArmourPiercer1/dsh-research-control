/**
 * History view — dual-order event ordering (WP-4.4, catalog §2 双时序).
 *
 * The store's history slice caches ONE window (page) per canonical query,
 * and 「加载更多」(load more) appends the NEXT seq window (the seq-axis
 * partition protocol, rpc-contracts §5 / host queryEvents). Inside each
 * page the rows are already in the requested order, but a LATER page can
 * carry a late-registered event (any `occurredAt`, `eventSeq = max+1`)
 * that semantically sorts BEFORE rows of an earlier page — so the
 * accumulated cross-page stream is re-sorted client-side in the CURRENT
 * order before display (a display-layer total order; the underlying rows
 * are untouched — catalog §3.7).
 *
 * The orders mirror the frozen replay semantics (catalog §2):
 *  - `semantic`: `ORDER BY occurred_at, event_seq` (the default UI
 *    timeline — 「重建科研时间线」);
 *  - `audit`:    `ORDER BY event_seq` (「系统何时获知」— registration).
 * Equal-key rows are tie-broken on `eventId` — deterministic regardless
 * of the pages' internal order (the host total orders carry the same
 * residual tie-break, WP-2.2 TC-HIST-005 repeatable replay).
 *
 * Pure: copies (never mutates) and returns a new array; the input row
 * references are shared (zero-copy display).
 */

import type { HistoryEventDto, QueryHistoryArgs } from '../../../shared/rpc-contracts.js'

/** The two replay orders (derived from the shared contract, not re-declared). */
export type HistoryOrder = NonNullable<QueryHistoryArgs['order']>

/** Re-sort the accumulated events into the given replay order (pure copy). */
export function orderEvents(events: readonly HistoryEventDto[], order: HistoryOrder): readonly HistoryEventDto[] {
  const copy = [...events]
  copy.sort(
    order === 'semantic'
      ? (a, b) => a.occurredAt - b.occurredAt || a.eventSeq - b.eventSeq || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)
      : (a, b) => a.eventSeq - b.eventSeq || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0),
  )
  return copy
}
