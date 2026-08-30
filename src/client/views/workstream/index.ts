/**
 * Workstream page view public face (WP-4.3).
 *
 * The page's ONE import point (cross-module symbol discipline, mirroring
 * the stores index): the container (`WorkstreamView` — the two-layer
 * pull-from-store layer), the three PURE zone display components, the
 * store-binding hook, and the pure reorder helper.
 *
 * Not yet referenced by the client entry graph (`src/client/index.tsx`):
 * the `conversation.view` slot wiring for the Workstream page (the Phase
 * 4 slot `store:` option, WP-4.6/§13-U1 follow-up) will mount
 * `WorkstreamView` with the `createResearchStore()` instance — the
 * component shape (props only, no ctx) is already that wiring's input.
 */

export { WorkstreamView, type WorkstreamViewProps } from './WorkstreamView.js'
export { CurrentZone, type CurrentFocusView, type CurrentZoneProps } from './CurrentZone.js'
export { FutureZone, type FutureZoneProps } from './FutureZone.js'
export { HistoryZone, type HistoryZoneProps } from './HistoryZone.js'
export { buildReorderArgs, movePlanItemIds, type MoveDirection } from './reorder.js'
export {
  EMPTY_PLAN_ITEM_DRAFT,
  REMOVE_STATE_KEY,
  classifyRemoveState,
  hasExecutionHistory,
  newPlanItemDraft,
  planKindOfId,
  splitLines,
  type PlanItemDraft,
  type PlanItemKind,
  type RemoveState,
  type TaskExecution,
} from './plan-item-utils.js'
export {
  useCurrentFocusSlice,
  useWorkstreamCurrentSlice,
  useWorkstreamSlice,
} from './useWorkstreamSlice.js'
