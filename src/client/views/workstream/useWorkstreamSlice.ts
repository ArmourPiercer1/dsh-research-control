/**
 * Store binding layer for the Workstream page (WP-4.3).
 *
 * Two-layer view discipline (task brief; this repo has no host renderer,
 * so the host-side `bindSnapshotSelector` has nothing to mirror):
 *  - the CONTAINER (`WorkstreamView`) pulls its data through this hook
 *    and passes it down as plain props;
 *  - the zone components (`CurrentZone`/`FutureZone`/`HistoryZone`) are
 *    PURE display components — zero hooks, zero store knowledge.
 *
 * `useSyncExternalStore` is confined to THIS binding layer (the store
 * engine's face is structurally `HostObservable<T>` — WP-4.1b): no
 * component body contains the subscription call itself, and no second
 * subscription is created (DSH_ADAPTER §11 — the Phase 4 slot wiring can
 * bind the same store face directly).
 *
 * The hook also drives the LAZY first load (ARCHITECTURE §8: the
 * workstream page loads on first view): an idle slice is fetched once on
 * mount; the store dedupes in-flight fetches, so re-runs of the effect
 * (any snapshot commit) are no-ops once the slice left `idle`.
 */

import { useEffect, useSyncExternalStore } from 'react'
import {
  idleSlice,
  type ResearchStore,
  type SliceState,
  type WorkstreamSnapshot,
} from '../../stores/index.js'

/** Shared idle-slice constant returned while the entry is absent. */
const EMPTY_SLICE = idleSlice<WorkstreamSnapshot>()

/**
 * Bind one workstream slice of the research store for a view.
 * @param store - the `createResearchStore()` instance (via props, never a
 *   module-level handle).
 * @param workstreamId - the page's workstream (the slice local key).
 * @returns the slice state machine (`idle | loading | ready | error`);
 *   the caller renders on `slice.status`/`slice.data`/`slice.error`.
 */
export function useWorkstreamSlice(store: ResearchStore, workstreamId: string): SliceState<WorkstreamSnapshot> {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const slice = state.workstreams.get(workstreamId)

  // Lazy first load (see module doc). Dependency on the SLICE (not the
  // whole snapshot): the store's immutability discipline (WP-4.1b) keeps
  // an entry's reference stable until that entry changes, so the effect
  // only re-runs for THIS workstream's commits.
  useEffect(() => {
    if (slice === undefined || slice.status === 'idle') {
      void store.loadWorkstream(workstreamId)
    }
  }, [store, workstreamId, slice])

  return slice ?? EMPTY_SLICE
}
