/**
 * Client store engine (WP-4.1b) — the minimal observable-store primitive
 * the research client state is built on.
 *
 * Dependency discipline (task brief + ARCHITECTURE §8): NO new store
 * library (no zustand or similar). The primitive is ~40 lines of
 * self-implemented `getSnapshot` / `subscribe` / `setState` with the
 * exact snapshot semantics React 18 `useSyncExternalStore` requires:
 *
 *  1. **Snapshot reference stability** — `getSnapshot()` returns the SAME
 *     object reference until a `setState` commits a different reference.
 *     React compares consecutive snapshot reads with Object.is to decide
 *     whether a re-render is due; a new identity per read would loop.
 *  2. **No lost notifications** — a listener that triggers another
 *     `setState` (directly or transitively) during a notify pass never
 *     causes the outer pass to skip a remaining subscriber, and the
 *     pass re-runs after settling so every committed state change is
 *     observed at least once (React reads the snapshot after its
 *     subscription callback fires; a skipped subscriber would see a
 *     stale snapshot).
 *  3. **No-op on same reference** — `setState` resolving to the same
 *     reference commits nothing and notifies nobody.
 *
 * The engine is framework-agnostic: it imports nothing (not even React),
 * so the store layer stays bundle-light (React reaches the client only
 * through the views' JSX runtime) and the tests run without a DOM.
 *
 * DSH slot-system fit (DSH_ADAPTER §6): the face `getSnapshot` +
 * `subscribe` is structurally the host `HostObservable<T>` mirror
 * (packages/client/ui-slots renderer.ts:31-34 — `getSnapshot(): T`,
 * `subscribe(fn: () => void): () => void`), so a Phase 4 slot
 * registration can pass a store instance through the `store` option and
 * the host render machinery binds it via `useSyncExternalStore` (or the
 * with-selector shim) without a second subscription — the「不建第二订阅」
 * rule. Components never see the store object itself: the slot system
 * projects it into props (the four-strand share), per the hard rule.
 *
 * Module-level handle discipline (DSH_ADAPTER §6): this file exports a
 * FACTORY only (`createStore`); a pre-created store instance must never
 * be exported or cached at module level.
 */

/** A change notification. The subscriber re-reads `getSnapshot` itself. */
export type StoreListener = () => void

/**
 * The bare snapshot source face — structurally `HostObservable<T>`.
 * This is the face the host slot machinery consumes at the render
 * boundary; the `Store` below is its store-owned superset.
 */
export interface StoreSnapshotSource<T> {
  /** The current snapshot; reference-stable until the next commit. */
  getSnapshot(): T
  /**
   * Subscribe to change notifications.
   * @returns the disposer (idempotent).
   */
  subscribe(listener: StoreListener): () => void
}

/** A store: a snapshot source plus the store-owned read/write face. */
export interface Store<T> extends StoreSnapshotSource<T> {
  /** The current snapshot (same reference semantics as `getSnapshot`). */
  getState(): T
  /**
   * Commit a new state by pure function of the previous one.
   * No-op (no notification) when the updater returns the same reference.
   */
  setState(updater: (prev: T) => T): void
}

/**
 * Create an observable store with an initial snapshot.
 * @param initial - the first snapshot; its reference is returned until
 *   a `setState` commits a different one.
 * @returns the store face (factory result — never module-cached).
 */
export function createStore<T>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<StoreListener>()
  let notifying = false
  let notifyAgain = false

  function notify(): void {
    if (notifying) {
      // A listener triggered another commit during this pass: re-run the
      // (possibly mutated) listener set once the outer pass settles.
      notifyAgain = true
      return
    }
    notifying = true
    try {
      do {
        notifyAgain = false
        // Copy: a listener may unsubscribe itself or others mid-pass.
        for (const listener of [...listeners]) listener()
      } while (notifyAgain)
    } finally {
      notifying = false
    }
  }

  return {
    getSnapshot(): T {
      return state
    },
    getState(): T {
      return state
    },
    subscribe(listener: StoreListener): () => void {
      listeners.add(listener)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        listeners.delete(listener)
      }
    },
    setState(updater: (prev: T) => T): void {
      const next = updater(state)
      if (Object.is(next, state)) return
      state = next
      notify()
    },
  }
}
