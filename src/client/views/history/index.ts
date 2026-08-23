/**
 * History timeline view public face (WP-4.4).
 *
 * The Phase 4 slot wiring imports from HERE (cross-module symbol
 * discipline — the same rule the store layer public face follows):
 *  - `HistoryTimelineView` — the ONE container (pulls the store snapshot
 *    through the minimal binding hook; pure-props children below);
 *  - the pure display projections (`runGroups` per-Run wrapper grouping,
 *    `orderEvents` dual-order sorting) and the event metadata (type
 *    badges, U/A/P actor letters) — reusable by the drill-down views
 *    (WP-4.6) without re-deriving them.
 */

export {
  DEFAULT_PAGE_SIZE,
  HistoryTimelineView,
  type HistoryTimelineViewProps,
  type HistoryViewMode,
} from './HistoryTimelineView.js'
export { actorLabel, actorLetter, EVENT_TYPE_META, eventTypeMeta, formatEpochMs, type EventTypeMeta } from './event-meta.js'
export { orderEvents, type HistoryOrder } from './ordered-events.js'
export { runGroups, type HistoryRunGroup, type RunEndEventType, type RunGroupStatus } from './run-group.js'
export { EventRow, type EventRowProps } from './EventRow.js'
export { RunGroupCard, RUN_STATUS_LABEL, type RunGroupCardProps } from './RunGroupCard.js'
export { useResearchStore } from './use-research-store.js'
