/**
 * Reporting view public face (WP-5.3) — 沟通与日程 (§10).
 *
 * One import for the section: the top-level `ReportingView` container
 * (props: `{ store: ResearchStore }`) + the three section containers +
 * the pure display helpers (labels / formatting). Presentation rows are
 * internal (containers are the only store-pulling files).
 */

export { ReportingView, type ReportingViewProps } from './ReportingView.js'
export { InteractionStreamView, type InteractionStreamViewProps } from './InteractionStreamView.js'
export { ReportingListView, type ReportingListViewProps } from './ReportingListView.js'
export { ScheduledEventTimeline, type ScheduledEventTimelineProps } from './ScheduledEventTimeline.js'
export { InteractionRow, type InteractionRowProps } from './interaction-row.js'
export { ReportingItemRow, type ReportingItemRowProps } from './reporting-item-row.js'
export { ScheduledEventRow, type ScheduledEventRowProps } from './scheduled-event-row.js'
export { useReportingStore } from './use-reporting-store.js'
export {
  INTERACTION_KIND_LABELS,
  RPT_STATUS_LABELS,
  RPT_TRANSITION_LABELS,
  SEV_FREQ_LABELS,
  SEV_FREQ_UNITS,
  SEV_REF_KIND_LABELS,
  formatEpochMs,
  weekWindow,
} from './reporting-format.js'
