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
 * The hooks also drive the LAZY first load (ARCHITECTURE §8: the
 * workstream page loads on first view): an idle slice is fetched once on
 * mount; the store dedupes in-flight fetches, so re-runs of the effect
 * (any snapshot commit) are no-ops once the slice left `idle`.
 *
 * UI-4 adds the two aggregate faces the Current Execution zone needs
 * (ADJ-8/11): `useWorkstreamCurrentSlice` binds the `current:<ws>`
 * family (the `getWorkstreamCurrent` aggregate read) and
 * `useCurrentFocusSlice` binds the `currentFocus:<ws>` family (UI-0.4) —
 * both lazy-load on mount with the same idle-guard discipline.
 */

import { useEffect, useSyncExternalStore } from 'react'
import type {
  GetWorkstreamCurrentResult,
  GetCurrentFocusResult,
} from '../../../shared/rpc-contracts.js'
import {
  idleSlice,
  type ResearchStore,
  type SliceState,
  type WorkstreamSnapshot,
} from '../../stores/index.js'

/** Shared idle-slice constant returned while the entry is absent. */
const EMPTY_SLICE = idleSlice<WorkstreamSnapshot>()
/** Shared idle-slice constant for the `current:<ws>` family (UI-4). */
const EMPTY_CURRENT_SLICE = idleSlice<GetWorkstreamCurrentResult>()
/** Shared idle-slice constant for the `currentFocus:<ws>` family. */
const EMPTY_FOCUS_SLICE = idleSlice<GetCurrentFocusResult>()

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

/**
 * Bind the `current:<workstreamId>` slice (the UI-4 aggregate read,
 * ADJ-8: the Current Execution zone's objectives / blockers / next
 * actions / interventions faces). Lazy first load on mount, same
 * idle-guard as `useWorkstreamSlice`.
 * @param store - the `createResearchStore()` instance.
 * @param workstreamId - the page's workstream (the slice local key).
 * @returns the slice state machine for this workstream's current face.
 */
export function useWorkstreamCurrentSlice(
  store: ResearchStore,
  workstreamId: string,
): SliceState<GetWorkstreamCurrentResult> {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const slice = state.current.get(workstreamId)

  useEffect(() => {
    if (slice === undefined || slice.status === 'idle') {
      void store.loadWorkstreamCurrent({ workstreamId })
    }
  }, [store, workstreamId, slice])

  return slice ?? EMPTY_CURRENT_SLICE
}

/**
 * Bind the `currentFocus:<workstreamId>` slice (UI-0.4) — the
 * current-focus pointer the header row and the Future-zone marker read
 * (ADJ-11: the pointer stays on its own slice; the frozen
 * `WorkstreamSnapshot` carries no focus face).
 * @param store - the `createResearchStore()` instance.
 * @param workstreamId - the page's workstream (the slice local key).
 * @returns the slice state machine for this workstream's focus pointer.
 */
export function useCurrentFocusSlice(
  store: ResearchStore,
  workstreamId: string,
): SliceState<GetCurrentFocusResult> {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const slice = state.currentFocus.get(workstreamId)

  useEffect(() => {
    if (slice === undefined || slice.status === 'idle') {
      void store.getCurrentFocus({ workstreamId })
    }
  }, [store, workstreamId, slice])

  return slice ?? EMPTY_FOCUS_SLICE
}
