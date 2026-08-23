/**
 * §27.2 Project Page public face (WP-4.7, G4 S1).
 *
 * The ONE import point of the package (cross-module symbol discipline):
 *  - `ProjectPage` — the CONTAINER (the only store-touching file; the
 *    cockpit wires it into the in-tab page stack);
 *  - `ProjectPageView` — the PURE-PROPS presentation (§27.2 information
 *    architecture; unit-testable standalone).
 */
export { ProjectPage, type ProjectPageProps } from './ProjectPage'
export {
  formatEpochDate,
  ProjectPageView,
  type ProjectPageViewProps,
  type ProjectViewStatus,
} from './ProjectPageView'
