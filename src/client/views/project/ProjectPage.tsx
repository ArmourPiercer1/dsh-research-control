/**
 * §27.2 Project Page CONTAINER (WP-4.7, G4 S1) — the ONE store-touching
 * file of the project view (the two-layer rule, WP-4.2 precedent).
 *
 * DSH_ADAPTER §6 hard rules (client side, same contract as
 * HomeDashboard.tsx):
 *  - components never see the DSH ctx — the store HANDLE arrives as a
 *    plain prop (`store`), handed over by the cockpit (the 研究 tab root
 *    creates ONE `createResearchStore()` factory result per tab mount);
 *    navigation callbacks arrive as inject-face props;
 *  - no direct `useSyncExternalStore` in a display component — the store
 *    binding lives HERE and only here; the bound slice is passed down to
 *    the pure props `ProjectPageView` as plain data.
 *
 * Data path (ARCHITECTURE §8 — no self-built streaming):
 *  1. mount: the `project` slice is lazy (`idle` until first request) —
 *     the container issues `store.loadProject()`; the store's in-flight
 *     dedupe makes a StrictMode double-run issue exactly one fetch;
 *  2. `useSyncExternalStore` on the store face (structurally the host
 *     `HostObservable` getSnapshot/subscribe — no second subscription):
 *     a slice commit re-renders the container, which re-maps props;
 *  3. a first-load fault is swallowed (fire-and-forget) — the store has
 *     already recorded it in the slice (markError BEFORE the re-throw),
 *     and the slice state IS this view's rendering source; the home
 *     刷新 button drives `store.refresh()`, which refetches the project
 *     slice among the non-idle ones (the 刷新失败 banner comes from the
 *     slice's stale-while-revalidate error state).
 */
import { useEffect, useSyncExternalStore, type ReactElement } from 'react'

import type { ResearchStore } from '../../stores'

import { ProjectPageView } from './ProjectPageView'

export interface ProjectPageProps {
  /** The research store handle (factory result — never a module-level handle). */
  readonly store: ResearchStore
  /** Drill-down: topic view (the cockpit's page navigation). */
  readonly onOpenTopic: (topicId: string) => void
  /** Back to the home dashboard. */
  readonly onBack: () => void
}

/**
 * The §27.2 Project Page entry component: binds the store's `project`
 * slice to the pure props `ProjectPageView`.
 * @param props - store handle + navigation callbacks.
 * @returns the project page element.
 */
export function ProjectPage({ store, onOpenTopic, onBack }: ProjectPageProps): ReactElement {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const slice = snapshot.project

  // The action is fire-and-forget and its rejection is INTENTIONALLY
  // swallowed (same contract as HomeDashboard.tsx: the slice carries the
  // failure; the promise rejection would only be an unhandled-rejection
  // artifact, not a rendering source).
  const swallowSliceRecordedFault = (_err: unknown): undefined => undefined

  useEffect(() => {
    if (slice.status === 'idle') void store.loadProject().catch(swallowSliceRecordedFault)
  }, [store, slice.status])

  return (
    <ProjectPageView
      data={slice.data}
      status={slice.status}
      error={slice.error}
      onRetry={() => {
        void store.loadProject().catch(swallowSliceRecordedFault)
      }}
      onOpenTopic={onOpenTopic}
      onBack={onBack}
    />
  )
}
