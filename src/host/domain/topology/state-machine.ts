/**
 * WP-1.4 — TopologyEdge lifecycle state machine (DOMAIN_SCHEMA §13,
 * L540-560 「合法转换表」).
 *
 * §3.1 types a TopologyEdge's `lifecycle` as `WsLifecycle`
 * (PLANNED | REALIZED | DROPPED) — the TE row of the §13 table therefore IS
 * the 「Workstream lifecycle」 row (L548):
 *
 *   PLANNED            → REALIZED        (realize: the TOPOLOGY_FORK/MERGE_REALIZED
 *                                          event accepts and transitions the edge in
 *                                          the SAME atomic operation —
 *                                          HISTORY_EVENT_CATALOG §3/§5.8)
 *   PLANNED | REALIZED → DROPPED         (仅用户)
 *   DROPPED            — terminal (no outbound transitions in the table)
 *
 * Realize semantics (§5.8): `edge.lifecycle -> REALIZED` + `realized_event_id`
 * back-fill; V1 arity — a realized FORK edge has `inputs` 恰为 1, a MERGE edge
 * `outputs` 恰为 1 (owner-disambiguation engineering default: FORK owner =
 * inputs[0], MERGE owner = outputs[0]). The arity + PLANNED preconditions are
 * enforced by `validateRealize` (contract.ts) — the store's executor reuses it
 * for the → REALIZED transition, so a multi-input FORK edge can never be
 * realized through any path in this module.
 *
 * 「planned 与 realized 同一模型；plan change 不改写历史」 (§3.1): once
 * REALIZED the edge never returns to PLANNED (REALIZED → PLANNED is illegal
 * and rejected here).
 *
 * WP-1.4 boundary: this module performs the declarative state change (and the
 * `realized_event_id` back-fill) but NEVER writes a HistoryEvent — event
 * emission is Phase 2.
 *
 * Pure logic (zero I/O); the executor (store.transitionEdge) composes this
 * guard with load + atomic save.
 */

import type { WsLifecycle } from '../loader/index.js'
import { TopologyStoreError, type TransitionActor } from './types.js'

/**
 * The frozen §13 legal-transition table for the TE lifecycle
 * (key = current state, value = legal target states). DROPPED maps to `[]`
 * (terminal — 「planned 与 realized 同一模型；plan change 不改写历史」, §3.1).
 */
export const TE_TRANSITIONS: Readonly<Record<WsLifecycle, readonly WsLifecycle[]>> = {
  PLANNED: ['REALIZED', 'DROPPED'],
  REALIZED: ['DROPPED'],
  DROPPED: [],
}

/** The legal target states from `from` (per TE_TRANSITIONS). */
export function legalTargets(from: WsLifecycle): readonly WsLifecycle[] {
  return TE_TRANSITIONS[from]
}

/** True iff `from -> to` appears in the §13 table. */
export function isLegalTransition(from: WsLifecycle, to: WsLifecycle): boolean {
  return TE_TRANSITIONS[from].includes(to)
}

/**
 * Guard one transition. Throws `TopologyStoreError` (the service surface):
 *  - `INVALID_TRANSITION` — `to` is not in the legal set for `from` (including
 *    same-state no-ops, which the table does not list). The message always
 *    names the CURRENT state, the TARGET state, and the LEGAL SET
 *    (「DROPPED is terminal」 when the legal set is empty).
 *  - `UNAUTHORIZED_TRANSITION` — `to` is DROPPED but `actor` is not USER
 *    (§13: 「仅用户」).
 *
 * Returns void on success (the caller performs the mutation + persistence).
 */
export function checkTransition(
  teId: string,
  from: WsLifecycle,
  to: WsLifecycle,
  actor: TransitionActor,
): void {
  const legal = TE_TRANSITIONS[from]
  if (!legal.includes(to)) {
    const suffix =
      legal.length === 0
        ? `${from} is terminal (no legal targets)`
        : `legal targets from ${from}: [${legal.join(', ')}]`
    throw new TopologyStoreError(
      'INVALID_TRANSITION',
      `illegal topology edge lifecycle transition for ${teId}: ${from} -> ${to}; ${suffix} (DOMAIN_SCHEMA §13, WsLifecycle)`,
      { teId },
    )
  }
  if (to === 'DROPPED' && actor !== 'USER') {
    throw new TopologyStoreError(
      'UNAUTHORIZED_TRANSITION',
      `topology edge ${teId}: transition ${from} -> DROPPED is user-only (DOMAIN_SCHEMA §13 「仅用户」); actor=${actor}`,
      { teId },
    )
  }
}
