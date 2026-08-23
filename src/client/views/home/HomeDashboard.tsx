/**
 * Home dashboard CONTAINER (WP-4.2) — the ONE store-touching file of the
 * home view (the two-layer rule: container pulls from the store, display
 * components stay pure props; 容器只在每视图一个文件).
 *
 * DSH_ADAPTER §6 hard rules (client side):
 *  - components never see the DSH ctx — the store HANDLE arrives as a
 *    plain prop (`store`), handed over by the slot wiring (the Phase 4
 *    slot registration passes `createResearchStore()` through the slot
 *    option `store`); navigation callbacks arrive as inject-face props;
 *  - no direct `useSyncExternalStore` in a display component — the store
 *    binding lives HERE and only here; the bound values are passed down
 *    as plain props (this repo has no host renderer binding layer yet —
 *    the container IS the minimal binding seam).
 *
 * Data path (ARCHITECTURE §8 — no self-built streaming):
 *  1. mount: the `dashboard` slice is lazy (`idle` until first request) —
 *     the container issues `store.loadDashboard()`; the store's in-flight
 *     dedupe makes a StrictMode double-run issue exactly one fetch;
 *  2. `useSyncExternalStore` on the store face (structurally the host
 *     `HostObservable` getSnapshot/subscribe — no second subscription):
 *     a slice commit re-renders the container, which re-maps props;
 *  3. the 刷新 button drives `store.refresh('manual')` — the low-frequency
 *     refresh loop (§8 item 4: the page-level refresh hangs on the store
 *     refresh cycle: RR-015① stale seam → refetch non-idle slices →
 *     onRefetch listeners).
 */
import { useEffect, useSyncExternalStore, type ReactElement } from 'react'

import type { ResearchStore } from '../../stores'

import { HomeDashboardView } from './HomeDashboardView'

export interface HomeDashboardProps {
  /** The research store handle (factory result — never a module-level handle). */
  readonly store: ResearchStore
  /** Drill-down: topic view (slot wiring provides the real target later). */
  readonly onOpenTopic?: (topicId: string) => void
  /** Drill-down: workstream view. */
  readonly onOpenWorkstream?: (workstreamId: string) => void
  /** Drill-down: History timeline (per workstream). */
  readonly onOpenHistory?: (workstreamId: string) => void
}

/**
 * The Home view entry component: binds the store's dashboard slice to the
 * pure props `HomeDashboardView`.
 * @param props - store handle + navigation callbacks.
 * @returns the dashboard element.
 */
export function HomeDashboard({
  store,
  onOpenTopic,
  onOpenWorkstream,
  onOpenHistory,
}: HomeDashboardProps): ReactElement {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const slice = snapshot.dashboard

  // Lazy load (ARCHITECTURE §8): the dashboard slice is fetched on first
  // request. The store dedupes in-flight fetches per slice key, so an
  // effect double-run (React 18 StrictMode dev) issues exactly one fetch.
  //
  // The action is fire-and-forget and its rejection is INTENTIONALLY
  // swallowed: on a transport/assembly fault the store has already
  // recorded the failure in the slice (markError BEFORE the re-throw —
  // fail-loud at the store boundary), and the slice state IS this view's
  // rendering source — the 加载失败/刷新失败 face comes from the slice, not
  // from the promise. Swallowing keeps the fire-and-forget effect/handler
  // free of unhandled rejections without hiding the failure.
  const swallowSliceRecordedFault = (_err: unknown): undefined => undefined

  useEffect(() => {
    if (slice.status === 'idle') void store.loadDashboard().catch(swallowSliceRecordedFault)
  }, [store, slice.status])

  return (
    <HomeDashboardView
      data={slice.data}
      status={slice.status}
      error={slice.error}
      onRefresh={() => {
        void store.refresh('manual').catch(swallowSliceRecordedFault)
      }}
      onRetry={() => {
        void store.loadDashboard().catch(swallowSliceRecordedFault)
      }}
      onOpenTopic={topicId => onOpenTopic?.(topicId)}
      onOpenWorkstream={workstreamId => onOpenWorkstream?.(workstreamId)}
      onOpenHistory={workstreamId => onOpenHistory?.(workstreamId)}
    />
  )
}
