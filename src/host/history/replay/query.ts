/**
 * WP-2.3 — dual-order (dual-timeline) event queries with cursor pagination.
 *
 * Implements HISTORY_EVENT_CATALOG §2 on top of the WP-2.1 store READ face
 * (`listRange` only — the store's append path is never touched by this
 * module; replay produces no events, §6 L279):
 *
 *   | replay mode  | ordering                                  | answers                    |
 *   |--------------|-------------------------------------------|----------------------------|
 *   | `semantic`   | `ORDER BY occurred_at, event_seq`         | the research timeline      |
 *   |              | (default — 「默认 UI History 时间线」)     | (default UI History view)  |
 *   | `audit`      | `ORDER BY event_seq` (strictly ascending) | 「系统何时获知」(registration) |
 *
 * - Equal `occurredAt` tie-breaks on `eventSeq` — DETERMINISTIC
 *   (TC-HIST-004); the orderings reuse the WP-2.2 total orders
 *   (`semanticOrder` / `auditOrder`, whose residual (owner, id) tie-break
 *   makes cross-workstream merges total — TC-HIST-005 repeatable replay).
 * - Late registration (TC-HIST-002 store/query half): an event whose
 *   `occurredAt` predates existing events still takes `eventSeq = max+1`
 *   (store-assigned at append — this module never assigns seqs); the
 *   semantic query places it at its TIME position, the audit query keeps it
 *   at the TAIL. No special-casing: both orders are pure functions of the
 *   stored rows.
 * - Owner uniqueness (TC-HIST-009 query half): every result row carries its
 *   single non-empty `ownerWorkstreamId`; a query is scoped to ONE owner
 *   workstream and cannot mix owners (the store's row filter is structural).
 *
 * Cursor pagination (TC-PERF-004 semantics: O(window), not O(total)):
 * the cursor walks the AUDIT-SEQ AXIS (the log's native linear axis,
 * dense 1..N per workstream — TC-HIST-003):
 *
 *   - `afterSeq`  — exclusive lower bound (default 0 = from the beginning);
 *   - `beforeSeq` — exclusive upper bound (default: unbounded); MUST be
 *     > afterSeq + 1 (an empty window is a caller error, not a page);
 *   - `limit`     — page size in ROWS; caps the window's upper seq edge at
 *     `afterSeq + limit`.
 *
 * The window is `(afterSeq, upper]` with `upper = min(beforeSeq-1,
 * afterSeq+limit)` (∞ when unbounded), and the page returns the ENTIRE
 * window — rows are never truncated mid-window, so a late-registered event
 * (any `occurredAt`, seq = max+1) can never be skipped or doubled by the
 * pagination protocol: the pages PARTITION the seq axis, density makes each
 * seq belong to exactly one window, and every window is fully consumed.
 * Inside a page the rows are presented in the requested `order`.
 *
 * Protocol (self-terminating, no count queries):
 *   do { page = queryEvents(store, ws, { afterSeq, limit, order })
 *       consume(page.events)
 *       afterSeq = page.nextAfterSeq
 *   } while (afterSeq !== null)
 * `nextAfterSeq` is the next window's exclusive lower bound, `null` iff
 * `exhausted`. A bounded FULL window → not exhausted, `nextAfterSeq =
 * upper` (drop `beforeSeq` to keep scanning); a SHORT page (log ended
 * inside the window — density makes this detectable without a count) or an
 * unbounded window (reaches the log end by construction) → exhausted.
 */

import type { HistoryEventRecord, ResearchStore } from '../../persistence/store/index.js'
import { auditOrder, semanticOrder } from '../registry/index.js'
import { ReplayInputError } from './errors.js'

/** Semantic (research-time) or audit (registration) replay order. */
export type ReplayOrder = 'semantic' | 'audit'

/**
 * The READ-ONLY store face this module queries. Structurally narrower than
 * `ResearchStore` on purpose: a `ResearchStore` value IS assignable to it,
 * but a function taking it CANNOT reach `appendEvents` — the replay/query
 * face has no event-write path by TYPE SURFACE (replay produces no new
 * events, catalog §6 L279; the tests pin this with `@ts-expect-error`).
 */
export type QueryStore = Pick<ResearchStore, 'listRange'>

/** Store face for derived-state rebuilds: reads + the file path (the
 *  rebuild's independent write transaction opens its own connection). */
export type RebuildStore = Pick<ResearchStore, 'listRange' | 'path'>

export interface QueryEventsOptions {
  /** Replay order. Default `'semantic'` (catalog §2: default UI timeline). */
  readonly order?: ReplayOrder
  /** Exclusive lower bound on `eventSeq`. Default 0 = from seq 1. */
  readonly afterSeq?: number
  /** Exclusive upper bound on `eventSeq` (the first seq NOT included).
   *  Must be > afterSeq + 1. Default: unbounded. */
  readonly beforeSeq?: number
  /** Page size in rows; caps the window at `afterSeq + limit` seqs.
   *  Default: unbounded (the whole remainder of the log). */
  readonly limit?: number
}

export interface QueryPage {
  /** The window's rows, presented in the requested `order`.
   *  References — the store's record objects, never copies. */
  readonly events: readonly HistoryEventRecord[]
  /** Exclusive lower bound for the NEXT page, or `null` when `exhausted`. */
  readonly nextAfterSeq: number | null
  /** True when no further pages exist for this workstream (the window
   *  reached the log end — unbounded by construction, or the log ended
   *  inside a bounded window, detected via seq density). */
  readonly exhausted: boolean
}

/**
 * Query ONE owner workstream's event log in semantic or audit order with
 * seq-cursor pagination (see the module header for the full protocol).
 * Pure read: no writes, no seq assignment, no validation — the store's
 * read face (`listRange`) is the only I/O.
 */
export function queryEvents(
  store: QueryStore,
  ownerWorkstreamId: string,
  options: QueryEventsOptions = {},
): QueryPage {
  const ws = assertWorkstreamId(ownerWorkstreamId)
  const order = options.order ?? 'semantic'
  assertOrder(order)

  const afterSeq = options.afterSeq ?? 0
  assertCursor(afterSeq, 'afterSeq')
  const beforeSeq = options.beforeSeq
  if (beforeSeq !== undefined) {
    assertCursor(beforeSeq, 'beforeSeq')
    if (beforeSeq <= afterSeq + 1) {
      throw new ReplayInputError(
        `queryEvents: beforeSeq (${String(beforeSeq)}) must be > afterSeq + 1 ` +
          `(${String(afterSeq + 1)}) — it is the exclusive upper bound and the window ` +
          'must hold at least one seq',
      )
    }
  }
  const limit = options.limit
  if (limit !== undefined) {
    assertCursor(limit, 'limit')
  }

  // Window upper edge (INCLUSIVE) on the audit-seq axis.
  let upper: number | undefined
  if (beforeSeq !== undefined) upper = beforeSeq - 1
  if (limit !== undefined) upper = upper === undefined ? afterSeq + limit : Math.min(upper, afterSeq + limit)

  const fromSeq = afterSeq + 1
  const rows =
    upper === undefined
      ? store.listRange(ws, fromSeq)
      : store.listRange(ws, fromSeq, upper)

  let exhausted: boolean
  let nextAfterSeq: number | null
  if (upper === undefined) {
    // Unbounded window reaches the log end by construction.
    exhausted = true
    nextAfterSeq = null
  } else if (rows.length === upper - afterSeq) {
    // Full window: the log holds >= upper events (density) — keep scanning.
    exhausted = false
    nextAfterSeq = upper
  } else {
    // Short page: the log ended inside the window (density — a missing
    // tail row means no later row exists).
    exhausted = true
    nextAfterSeq = null
  }

  const events = order === 'semantic' ? semanticOrder(rows) : rows
  return { events, nextAfterSeq, exhausted }
}

/**
 * Collect ALL events of the listed workstreams and merge them into one
 * deterministic total order (`semantic` = occurredAt, eventSeq, owner, id;
 * `audit` = eventSeq, owner, id — the WP-2.2 total orders, TC-HIST-005).
 * A project-wide replay/timeline helper; `rebuildDerivedState` uses the
 * audit merge. Duplicate workstream ids are fetched once. A workstream
 * with no events contributes nothing (a PLANNED WS without events is
 * legal). Full scan by design (a full replay is O(total) — TC-PERF-001/002
 * measure it; pagination is the O(window) path, see {@link queryEvents}).
 */
export function collectAllEvents(
  store: QueryStore,
  workstreams: readonly string[],
  order: ReplayOrder,
): readonly HistoryEventRecord[] {
  assertOrder(order)
  if (!Array.isArray(workstreams)) {
    throw new ReplayInputError('collectAllEvents: workstreams must be an array')
  }
  const unique = [...new Set(workstreams.map(assertWorkstreamId))]
  const all = unique.flatMap((ws) => store.listRange(ws, 1))
  return order === 'semantic' ? semanticOrder(all) : auditOrder(all)
}

// ----------------------------------------------------------------------
// argument validation
// ----------------------------------------------------------------------

function assertWorkstreamId(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ReplayInputError('ownerWorkstreamId must be a non-empty string')
  }
  return value
}

function assertOrder(order: ReplayOrder): void {
  if (order !== 'semantic' && order !== 'audit') {
    throw new ReplayInputError(
      `query order must be "semantic" or "audit" (got ${JSON.stringify(String(order))})`,
    )
  }
}

/** Cursor/limit values: non-negative safe integers (afterSeq may be 0 =
 *  from the beginning; beforeSeq/limit must be >= 1 via their own rules). */
function assertCursor(value: number, what: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ReplayInputError(`${what} must be a non-negative safe integer (got ${String(value)})`)
  }
  if (what !== 'afterSeq' && value < 1) {
    throw new ReplayInputError(`${what} must be a positive safe integer (got ${String(value)})`)
  }
}
