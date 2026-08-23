/**
 * History view — the minimal store-binding hook (WP-4.4).
 *
 * DSH_ADAPTER §6 discipline: `useSyncExternalStore` must never appear
 * directly inside a component. This repo has no host renderer to project
 * the store into props (the slot `store` binding lands with the Phase 4
 * final wiring), so the binding layer is this ONE minimal hook: it reads
 * the snapshot off the factory handle (`ResearchStore` = the
 * `createResearchStore()` result) through React's store subscription and
 * returns the bare snapshot. The view's CONTAINER component consumes it;
 * every presentation component below the container is pure props.
 *
 * The hook itself carries zero business logic and no DSH imports
 * (INV-PERM-5) — the store face is the shared business-type face
 * (`getSnapshot`/`subscribe`, structurally the host `HostObservable`
 * mirror), so no second subscription is created anywhere: the host slot
 * machinery can later bind the same handle with the same one subscription
 * model (「不建第二订阅」).
 */

import { useSyncExternalStore } from 'react'
import type { ResearchStore, ResearchStoreState } from '../../stores/index.js'

/** Bind a `createResearchStore()` handle and return its current snapshot.
 *  Re-renders the consumer exactly when the store commits a new reference. */
export function useResearchStore(store: ResearchStore): ResearchStoreState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
