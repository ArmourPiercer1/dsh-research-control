/**
 * Canonical plan reorder helper (WP-4.3, Future zone GUI entry).
 *
 * Pure, framework-free: the view's minimal reorder entry (up/down buttons)
 * reduces to an ADJACENT SWAP of the canonical ordered plan
 * (`plan.yaml`'s `ordered_items`), expressed as the frozen `reorderPlan`
 * contract — `orderedItemIds` must be a PERMUTATION of the current plan's
 * items (rpc-contracts §6: reorder only; insert/delete are not in the
 * frozen 13-RPC list). One button press swaps one adjacent pair, which is
 * always a permutation, so the kernel's §4.4 reorder validations cannot
 * see a non-permutation from this entry.
 *
 * Plan order is user intent (ARCHITECTURE §3.4: `plan order ≠ dependency`);
 * this helper reorders and nothing else — no dependency reasoning.
 */

import type { PlanItemDto, ReorderPlanArgs } from '../../../shared/rpc-contracts.js'

/** The two directions of the minimal reorder entry (up/down buttons). */
export type MoveDirection = 'up' | 'down'

/**
 * Compute the new plan order after moving one item one position.
 * @param items - the current canonical plan (in plan order).
 * @param itemId - the item to move.
 * @param direction - `'up'` = one position earlier, `'down'` = one later.
 * @returns the new full id order (a permutation of the input), or `null`
 *   when the move is a no-op that the GUI must not issue: the item is not
 *   in the plan, or it is already at the edge (first item up / last item
 *   down — the buttons are disabled there anyway).
 */
export function movePlanItemIds(
  items: readonly PlanItemDto[],
  itemId: string,
  direction: MoveDirection,
): readonly string[] | null {
  const from = items.findIndex(item => item.id === itemId)
  if (from === -1) return null
  const to = direction === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= items.length) return null
  const next = items.map(item => item.id)
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}

/**
 * Wrap `movePlanItemIds` in the frozen `reorderPlan` args shape (the
 * container's exact mutation-face input).
 * @returns the args to pass to `store.reorderPlan`, or `null` for an
 *   invalid/no-op move (see `movePlanItemIds`).
 */
export function buildReorderArgs(
  workstreamId: string,
  items: readonly PlanItemDto[],
  itemId: string,
  direction: MoveDirection,
): ReorderPlanArgs | null {
  const orderedItemIds = movePlanItemIds(items, itemId, direction)
  if (orderedItemIds === null) return null
  return { workstreamId, orderedItemIds }
}
