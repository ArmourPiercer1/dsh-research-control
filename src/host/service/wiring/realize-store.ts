/**
 * WP-3.6 (RR-011 (a) / RR-010) — the store wrapper that ties the
 * workstream.yaml flip compensation to the append outcome.
 *
 * The `WorkstreamRealizer` (workstream-flip.ts) runs the file flip INSIDE
 * the store write transaction (as the RunBindingService's
 * `onWorkstreamRealized` hook). The COMMIT happens after the hook returns,
 * inside `appendEvents` — so the flip's success/failure can only be
 * settled by whoever observes `appendEvents` settle. This wrapper is that
 * observer: it delegates every `ResearchStore` call unchanged and, around
 * `appendEvents`, tells the realizer the outcome:
 *
 *   - `appendEvents` returns (the DB committed) → `settleAppend('committed')`
 *     — the flip is permanent. (A failure of a LATER, separate step — the
 *     row projection on the second connection — keeps the flip: the event
 *     is committed, the run/DS row lags, and the startup reconciliation
 *     converges it; the WP-2.4 documented residual.)
 *   - `appendEvents` throws (validation, realize, write OR COMMIT failure)
 *     → `settleAppend('failed')` — the RR-010 compensation restores the
 *     pre-flip file (or deletes a newly created one) BEFORE the error
 *     propagates. The store has already rolled its transaction back, so
 *     file and DB agree again.
 *
 * The wrapped handle keeps the EXACT `ResearchStore` surface (the
 * append-only type-surface audit in tests/store/append-only.test.ts keeps
 * pinning it).
 */

import type {
  AppendEventsOptions,
  AppendResult,
  HistoryEventInput,
  HistoryEventRecord,
  ResearchStore,
  TxScope,
} from '../../persistence/store/index.js'
import type { WorkstreamRealizer } from './workstream-flip.js'

/**
 * One in-transaction validate hook (the store `AppendEventsOptions.validate`
 * shape): runs on the batch's finalized events with the `TxScope`.
 */
export type StoreValidateHook = (events: readonly HistoryEventRecord[], tx: TxScope) => void

/**
 * Options for {@link withRealizeCompensation}.
 *
 * `validateHooks` — the RR-011 (b) seam: the store wrapper is the ONE place
 * that sees every append of every service (runbinding / sessionlink /
 * flooding) without modifying any of them, so the wiring composes the
 * store-level semantic incremental fold (semantics.ts `validateHook`)
 * HERE. Hooks run AFTER the service's own `validate` (registry rejection
 * first — an invalid batch never reaches the fold), inside the same write
 * transaction: a hook throw rolls the ENTIRE batch back (the corrupt
 * derived_state row never silently poisons a fold).
 */
export interface RealizeStoreOptions {
  readonly validateHooks?: readonly StoreValidateHook[]
}

/**
 * Wrap `store` so every append settles the realizer's pending file
 * compensation AND (optionally) composes the wiring's extra in-transaction
 * validate hooks. All other members are the same functions (closure-bound
 * on the underlying store — no state of this wrapper survives between
 * calls). The wrapped handle keeps the EXACT `ResearchStore` surface (the
 * append-only type-surface audit in tests/store/append-only.test.ts keeps
 * pinning it).
 */
export function withRealizeCompensation(
  store: ResearchStore,
  realizer: WorkstreamRealizer,
  options: RealizeStoreOptions = {},
): ResearchStore {
  const extraHooks = options.validateHooks ?? []
  return {
    path: store.path,
    userVersion: store.userVersion,
    close: store.close,
    getEvent: store.getEvent,
    listRange: store.listRange,
    meta: store.meta,
    appendEvents(
      events: readonly HistoryEventInput[],
      options?: AppendEventsOptions,
    ): AppendResult {
      // The composed hooks run on EVERY append — including option-less
      // direct store appends (the semantic fold must see the whole log,
      // not only the service-shaped batches):
      const composed: AppendEventsOptions | undefined =
        extraHooks.length === 0
          ? options
          : {
              ...(options ?? {}),
              validate: (finalized, tx) => {
                options?.validate?.(finalized, tx)
                for (const hook of extraHooks) hook(finalized, tx)
              },
            }
      try {
        const result = store.appendEvents(events, composed)
        realizer.settleAppend('committed')
        return result
      } catch (e) {
        realizer.settleAppend('failed')
        throw e
      }
    },
  }
}
