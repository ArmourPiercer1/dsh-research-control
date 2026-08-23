/**
 * Drill-down view package public face (WP-4.6, plan §26/§27.4 + the task
 * drill-down brief).
 *
 * The ONE import point of the package (cross-module symbol discipline):
 *  - `ResearchCockpit` — the registered 研究 tab root (the Phase 4 page
 *    stack: Home → Topic → Workstream → History + the drill-down
 *    sections);
 *  - the page/panel containers (topic page, intervention board, PF
 *    panel, Git panel);
 *  - the PURE drill-down model + display (unit-testable in isolation);
 *  - the package's only store-binding hook layer.
 */

export { ResearchCockpit, formatTime } from './cockpit.js'
export { TopicPage, type TopicPageProps } from './topic-page.js'
export { InterventionBoard, type InterventionBoardProps } from './intervention-board.js'
export { PfPanel, type PfPanelProps } from './pf-panel.js'
export { GitPanel, type GitPanelProps } from './git-panel.js'
export {
  buildDrilldownModel,
  linkedRunsFor,
  sessionPointersFor,
  type DrilldownArtifact,
  type DrilldownClaim,
  type DrilldownModel,
  type DrilldownRun,
} from './drilldown-model.js'
export { DrilldownView, type DrilldownSelection, type DrilldownViewProps } from './drilldown-view.js'
export {
  useDashboardSlice,
  useGitHistorySlice,
  useHistorySlice,
  useTopicSlice,
  useWsSlice,
} from './binding-hooks.js'
