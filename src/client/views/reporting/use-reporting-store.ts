/**
 * Reporting view — the minimal store-binding hook (WP-5.3).
 *
 * DSH_ADAPTER §6 discipline (same as the history view's hook):
 * `useSyncExternalStore` must never appear directly inside a component.
 * This ONE minimal hook reads the snapshot off the `ReportingWorkspace`
 * factory handle (structurally `HostObservable<T>`: getSnapshot/
 * subscribe) through React's store subscription and returns the bare
 * snapshot. The view's CONTAINER components consume it; every
 * presentation component below the containers is pure props.
 *
 * Zero business logic, no DSH imports (INV-PERM-5); no second
 * subscription (the host slot machinery can bind the same handle with
 * the same one-subscription model — 「不建第二订阅」).
 */

import { useSyncExternalStore } from 'react'
import type { ReportingWorkspace, ReportingWorkspaceState } from '../../stores/reporting-slices.js'

/** Bind a `createReportingWorkspace()` handle and return its current
 *  snapshot. Re-renders the consumer exactly when the workspace commits
 *  a new reference. */
export function useReportingStore(workspace: ReportingWorkspace): ReportingWorkspaceState {
  return useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot)
}
