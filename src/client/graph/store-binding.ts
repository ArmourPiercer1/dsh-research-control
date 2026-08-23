/**
 * Store binding layer (WP-4.5) — the minimal hook that lets a CONTAINER
 * component read from a store factory handle. DSH_ADAPTER §6 discipline,
 * this repo's two-layer variant (no host renderer to bind the store via a
 * slot `store:` option):
 *
 *  - the CONTAINER component (one per view: `PlanGraphContainer`,
 *    `TopologyGraphContainer`) is the ONLY place a store handle reaches
 *    the React world — it receives the `createResearchStore()` instance as
 *    a PROP (never a module-level handle) and projects it into bound props
 *    through `useStoreSnapshot` below;
 *  - the PRESENTATION components (`PlanGraphView`, `TopologyGraphView`,
 *    `ConfirmDialog`) stay pure props: zero store, zero hooks that reach
 *    outside the component's own behavior, zero `useSyncExternalStore`
 *    above this file;
 *  - the host slot machinery can still bind the same store handle directly
 *    (its `getSnapshot`/`subscribe` face is structurally `HostObservable`);
 *    this hook is the in-repo equivalent for the container layer and for
 *    tests, with the identical one-subscription semantics (no second
 *    subscription — DSH_ADAPTER §11).
 *
 * The selector shim follows the standard `with-selector` contract: the
 * selected value is memoized with `Object.is`, so a selector that returns
 * the same reference (the engine's immutable slice commits guarantee this
 * for stable slices) causes no re-render and no snapshot loop.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { StoreSnapshotSource } from '../stores/engine.js'

/**
 * Read the store's full snapshot (re-renders on every commit, exactly like
 * React's `useSyncExternalStore` against the bare face).
 * @param source - a `StoreSnapshotSource` (a `createResearchStore()` result
 *   satisfies it structurally).
 */
export function useStoreSnapshot<T>(source: StoreSnapshotSource<T>): T {
  const subscribe = useCallback((onChange: () => void) => source.subscribe(onChange), [source])
  const getSnapshot = useCallback(() => source.getSnapshot(), [source])
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * Read a SELECTED slice of the store snapshot (the container's binding
 * seam). Pass a STABLE selector (module-level or `useCallback` with
 * stable deps) — an inline selector re-subscribes each render (correct,
 * but needlessly chatty).
 * @param source - the snapshot source.
 * @param selector - pure `(state) => slice`; compared with `Object.is`.
 */
export function useStoreSnapshotSelected<T, S>(
  source: StoreSnapshotSource<T>,
  selector: (state: T) => S,
): S {
  const subscribe = useCallback((onChange: () => void) => source.subscribe(onChange), [source])
  const getSnapshot = useCallback(() => source.getSnapshot(), [source])
  const cache = useRef<{ selected: S } | null>(null)
  const getSelected = useCallback(() => {
    const next = selector(getSnapshot())
    const prev = cache.current
    if (prev !== null && Object.is(prev.selected, next)) return prev.selected
    cache.current = { selected: next }
    return next
  }, [getSnapshot, selector])
  return useSyncExternalStore(subscribe, getSelected)
}
