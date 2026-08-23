/**
 * Home dashboard view public face (WP-4.2, §27.1).
 *
 * Slot wiring (Phase 4 slot registration — a later WP) imports the
 * CONTAINER `HomeDashboard` and passes the research store handle plus the
 * navigation callbacks through the slot's inject/store options. The pure
 * props components are exported too so they can be composed or tested
 * standalone.
 */
export { HomeDashboard, type HomeDashboardProps } from './HomeDashboard'
export {
  HomeDashboardView,
  type HomeDashboardViewProps,
  type HomeViewStatus,
} from './HomeDashboardView'
export { formatEpochDate, ProjectCard, type DashboardProject, type ProjectCardProps } from './ProjectCard'
export { TopicList, type TopicListProps } from './TopicList'
export {
  InterventionSection,
  type InterventionGroupKind,
  type InterventionSectionProps,
} from './InterventionSection'
export { PhasePlaceholder, type PhasePlaceholderProps } from './PhasePlaceholder'
