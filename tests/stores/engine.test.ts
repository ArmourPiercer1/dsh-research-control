/**
 * WP-4.1b — engine tests: the minimal observable-store primitive.
 *
 * Pinned semantics (engine.ts header; React 18 useSyncExternalStore
 * compatibility):
 *  1. snapshot reference stable until a commit (uSES Object.is compare);
 *  2. same-reference commits are no-ops (no notification);
 *  3. no lost notifications — reentrant `setState` during a notify pass
 *     settles and every committed state is observed at least once.
 */

import { describe, expect, it } from 'vitest'
import { createStore } from '../../src/client/stores/engine.js'

interface CounterState {
  n: number
  readonly tag: string
}

const initial: CounterState = { n: 0, tag: 'initial' }

describe('createStore — snapshot reference stability (uSES semantics)', () => {
  it('returns the initial snapshot and keeps the reference across reads', () => {
    const store = createStore(initial)
    expect(store.getSnapshot()).toBe(initial)
    expect(store.getSnapshot()).toBe(initial)
    expect(store.getState()).toBe(initial)
    expect(store.getState()).toBe(store.getSnapshot())
  })

  it('commits a new reference on setState and notifies exactly once', () => {
    const store = createStore(initial)
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })
    store.setState(prev => ({ ...prev, n: 1 }))
    expect(store.getSnapshot()).not.toBe(initial)
    expect(store.getSnapshot().n).toBe(1)
    expect(notifications).toBe(1)
  })

  it('a setState resolving to the SAME reference is a no-op (no notification)', () => {
    const store = createStore(initial)
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })
    store.setState(prev => prev)
    expect(store.getSnapshot()).toBe(initial)
    expect(notifications).toBe(0)
  })

  it('consecutive reads between commits return one stable reference', () => {
    const store = createStore(initial)
    store.setState(prev => ({ ...prev, n: 1 }))
    const a = store.getSnapshot()
    const b = store.getSnapshot()
    const c = store.getSnapshot()
    expect(a).toBe(b)
    expect(b).toBe(c)
  })
})

describe('createStore — subscription lifecycle', () => {
  it('notifies every subscriber once per commit', () => {
    const store = createStore(initial)
    const seen: number[] = []
    store.subscribe(() => seen.push(1))
    store.subscribe(() => seen.push(2))
    store.subscribe(() => seen.push(3))
    store.setState(prev => ({ ...prev, n: 1 }))
    expect(seen).toEqual([1, 2, 3])
  })

  it('the disposer unsubscribes; double-dispose is a safe no-op', () => {
    const store = createStore(initial)
    let a = 0
    let b = 0
    const disposeA = store.subscribe(() => {
      a += 1
    })
    store.subscribe(() => {
      b += 1
    })
    disposeA()
    disposeA()
    store.setState(prev => ({ ...prev, n: 1 }))
    expect(a).toBe(0)
    expect(b).toBe(1)
  })

  it('a listener may unsubscribe itself mid-pass without breaking the others', () => {
    const store = createStore(initial)
    const seen: string[] = []
    store.subscribe(() => {
      seen.push('self')
    })
    const dispose = store.subscribe(() => {
      seen.push('early-dispose')
      dispose()
    })
    store.subscribe(() => seen.push('last'))
    store.setState(prev => ({ ...prev, n: 1 }))
    expect(seen).toEqual(['self', 'early-dispose', 'last'])
  })

  it('subscribing after a commit observes no backfill (snapshot reads cover history)', () => {
    const store = createStore(initial)
    store.setState(prev => ({ ...prev, n: 1 }))
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })
    expect(notifications).toBe(0)
    expect(store.getSnapshot().n).toBe(1)
  })
})

describe('createStore — reentrant setState (no lost notifications)', () => {
  it('a listener-triggered commit settles; the final snapshot is observed by all', () => {
    const store = createStore(initial)
    const events: string[] = []
    let firstCommit = true
    store.subscribe(() => {
      events.push('A')
      if (firstCommit) {
        firstCommit = false
        store.setState(prev => ({ ...prev, n: 2 }))
      }
    })
    store.subscribe(() => events.push('B'))
    store.setState(prev => ({ ...prev, n: 1 }))
    expect(store.getSnapshot().n).toBe(2)
    // B observed the FIRST commit at minimum; A triggered the second.
    expect(events.filter(e => e === 'B').length).toBeGreaterThanOrEqual(1)
    expect(events[0]).toBe('A')
  })

  it('chained reentrant commits terminate (bounded notification count)', () => {
    const store = createStore(initial)
    let calls = 0
    store.subscribe(() => {
      calls += 1
      if (store.getState().n < 3) store.setState(prev => ({ ...prev, n: prev.n + 1 }))
    })
    store.setState(() => ({ ...initial, n: 1 }))
    expect(store.getSnapshot().n).toBe(3)
    // 3 commits; the reentrant notify re-runs the pass once per triggered
    // commit (3 passes × 1 listener) — a lost-notify loop would hang and a
    // re-notify storm would blow this bound.
    expect(calls).toBe(3)
  })

  it('a listener added during a pass is not invoked for the in-flight commit', () => {
    const store = createStore(initial)
    const events: string[] = []
    store.subscribe(() => {
      events.push('A')
      store.subscribe(() => events.push('late'))
    })
    store.setState(prev => ({ ...prev, n: 1 }))
    expect(events).toEqual(['A'])
  })
})
