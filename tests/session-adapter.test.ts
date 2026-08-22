/**
 * WP-0.4 — session adapter spike: structured fakes, NO cordis App.
 *
 * Scope (per WP-0.4 brief): a fake sessions store (the structural
 * `SessionStoreLike`) plus a minimal event-bus mock on the face the
 * adapter subscribes through — `ctx.events.on(name, listener)` (the same
 * `EventsService.on` the mixed-in `ctx.on` delegates to; see
 * src/host/dsh-adapter/session.ts header for the typing rationale).
 * Real-machine verification (fiber PENDING semantics, scope-filtered
 * dispatch against the real dsh-session store) is WP-0.6.
 *
 * Assertions required by the brief: (1) the created/disposed/event
 * counters increment on each delivery; (2) after the returned disposers
 * run, deliveries no longer count; (3) `listSessions` maps the store
 * rows to the port payload fields correctly; (4) construction does not
 * throw.
 */
import { describe, expect, it } from 'vitest'
import {
  HostSessionAdapter,
  type SessionHostContext,
  type SessionLike,
  type SessionStoreLike,
} from '../src/host/dsh-adapter/session.js'
import type {
  SessionEventInfo,
  SessionLifecycleEvent,
} from '../src/shared/host-adapter-ports.js'

/** One fake session-log entry (structural `SessionEventLike`). */
interface FakeEvent {
  seq: number
  type: string
  data?: unknown
}

/** Build one fake live session with header fields and a log. */
function makeSession(
  id: string,
  opts: {
    cwd?: string
    parentSession?: string
    origin?: 'subagent'
    agentPreset?: string
    createdAt?: number
    events?: FakeEvent[]
  } = {},
): SessionLike {
  return {
    id,
    header: {
      ...opts.cwd === undefined ? {} : { cwd: opts.cwd },
      ...opts.parentSession === undefined ? {} : { parentSession: opts.parentSession },
      ...opts.origin === undefined ? {} : { origin: opts.origin },
      ...opts.agentPreset === undefined ? {} : { agentPreset: opts.agentPreset },
      createdAt: opts.createdAt ?? 1_700_000_000_000,
    },
    events: opts.events ?? [],
  }
}

/** Fake sessions store: `list()` plus test-only mutation handles. */
function makeStore(initial: readonly SessionLike[] = []): SessionStoreLike & {
  add(session: SessionLike): void
  remove(id: string): void
} {
  let live: SessionLike[] = [...initial]
  return {
    list: () => [...live],
    add: session => {
      live = [...live, session]
    },
    remove: id => {
      live = live.filter(session => session.id !== id)
    },
  }
}

/** Minimal event-bus mock: named listener lists + fire + count. */
function makeBus() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const on = (name: string, listener: (...args: unknown[]) => void): (() => void) => {
    const list = listeners.get(name) ?? []
    list.push(listener)
    listeners.set(name, list)
    return () => {
      const index = list.indexOf(listener)
      if (index >= 0) list.splice(index, 1)
    }
  }
  const fire = (name: string, ...args: unknown[]): void => {
    for (const listener of [...(listeners.get(name) ?? [])]) listener(...args)
  }
  const listenerCount = (name: string): number => listeners.get(name)?.length ?? 0
  return { on, fire, listenerCount }
}

/**
 * Assemble the fake host context: bus + store, and — only when `agents`
 * is provided — a minimal agent registry behind `ctx.get('agents')`
 * (the adapter's `running` derivation; absent registry ⇒ `running:false`).
 */
function makeCtx(store: SessionStoreLike, agents?: readonly { id: string; status: string }[]) {
  const bus = makeBus()
  const registry = agents === undefined ? undefined : new Map(agents.map(agent => [agent.id, agent]))
  const fake = {
    events: { on: bus.on },
    sessions: store,
    get: (name: string): unknown =>
      name === 'agents' && registry !== undefined ? { get: (id: string) => registry.get(id) } : undefined,
  }
  return {
    ctx: fake as unknown as SessionHostContext,
    fire: bus.fire,
    listenerCount: bus.listenerCount,
  }
}

describe('session adapter spike (WP-0.4)', () => {
  it('constructs without throwing, starts at zero counters, subscribes to nothing', () => {
    const { ctx, listenerCount } = makeCtx(makeStore())
    let adapter: HostSessionAdapter
    expect(() => {
      adapter = new HostSessionAdapter(ctx)
    }).not.toThrow()
    expect(adapter!.createdCount).toBe(0)
    expect(adapter!.disposedCount).toBe(0)
    expect(adapter!.eventCount).toBe(0)
    // Construction is side-effect free: the bus holds no listeners yet.
    expect(listenerCount('session/created')).toBe(0)
    expect(listenerCount('session/disposed')).toBe(0)
    expect(listenerCount('session/event')).toBe(0)
  })

  it('increments created/disposed/event counters per delivery with the right payloads', () => {
    const s1 = makeSession('s1', { cwd: '/work/repo' })
    const s2 = makeSession('s2')
    const { ctx, fire } = makeCtx(makeStore([s1]))
    const adapter = new HostSessionAdapter(ctx)

    const lifecycle: SessionLifecycleEvent[] = []
    const events: SessionEventInfo[] = []
    const disposeLifecycle = adapter.observeSessionLifecycle(event => {
      lifecycle.push(event)
    })
    const disposeEvent = adapter.onSessionEvent(event => {
      events.push(event)
    })

    fire('session/created', s1)
    expect(adapter.createdCount).toBe(1)
    fire('session/created', s2)
    expect(adapter.createdCount).toBe(2)

    fire('session/event', s1, { seq: 0, type: 'turn/start', data: { turn: 1 } })
    expect(adapter.eventCount).toBe(1)
    fire('session/event', s2, { seq: 3, type: 'user/message', data: {} })
    expect(adapter.eventCount).toBe(2)

    fire('session/disposed', s1)
    expect(adapter.disposedCount).toBe(1)

    expect(lifecycle).toEqual([
      { kind: 'created', sessionId: 's1' },
      { kind: 'created', sessionId: 's2' },
      { kind: 'disposed', sessionId: 's1' },
    ])
    expect(events).toEqual([
      { sessionId: 's1', type: 'turn/start', seq: 0 },
      { sessionId: 's2', type: 'user/message', seq: 3 },
    ])

    disposeLifecycle()
    disposeEvent()
  })

  it('stops counting once its disposers ran; a fresh subscription counts again', () => {
    const s1 = makeSession('s1')
    const { ctx, fire, listenerCount } = makeCtx(makeStore([s1]))
    const adapter = new HostSessionAdapter(ctx)

    const disposeLifecycle = adapter.observeSessionLifecycle(() => {})
    const disposeEvent = adapter.onSessionEvent(() => {})
    fire('session/created', s1)
    fire('session/event', s1, { seq: 0, type: 'turn/start', data: { turn: 1 } })
    fire('session/disposed', s1)
    expect([adapter.createdCount, adapter.eventCount, adapter.disposedCount]).toEqual([1, 1, 1])

    // The composed disposer removes EXACTLY its own hooks.
    disposeLifecycle()
    disposeEvent()
    expect(listenerCount('session/created')).toBe(0)
    expect(listenerCount('session/disposed')).toBe(0)
    expect(listenerCount('session/event')).toBe(0)
    fire('session/created', s1)
    fire('session/event', s1, { seq: 1, type: 'turn/start', data: { turn: 2 } })
    fire('session/disposed', s1)
    expect([adapter.createdCount, adapter.eventCount, adapter.disposedCount]).toEqual([1, 1, 1])

    // A fresh subscription revives counting on the same adapter instance.
    const again = adapter.observeSessionLifecycle(() => {})
    fire('session/created', s1)
    expect(adapter.createdCount).toBe(2)
    again()
  })

  it('maps ctx.sessions.list() rows to the port payload fields', () => {
    const s1 = makeSession('s1', {
      cwd: '/work/repo',
      agentPreset: 'researcher',
      createdAt: 111,
      events: [
        { seq: 0, type: 'turn/start', data: { turn: 1 } },
        { seq: 1, type: 'session/title', data: { title: 'first', messageSeqs: [], source: { kind: 'fallback' } } },
        { seq: 2, type: 'session/title', data: { title: 'renamed', messageSeqs: [], source: { kind: 'user' } } },
      ],
    })
    const s2 = makeSession('s2', { parentSession: 's1', origin: 'subagent', createdAt: 222 })
    const { ctx } = makeCtx(makeStore([s1, s2]), [{ id: 's1', status: 'running' }])
    const adapter = new HostSessionAdapter(ctx)

    // Creation order preserved; header fields mapped 1:1; latest title
    // wins; blank folded from the log; running from the agent registry.
    expect(adapter.listSessions()).toEqual([
      { id: 's1', cwd: '/work/repo', title: 'renamed', running: true, agentPreset: 'researcher', createdAt: 111, blank: false },
      { id: 's2', running: false, parentId: 's1', origin: 'subagent', createdAt: 222, blank: true },
    ])
  })

  it('reports running:false when the agent registry is absent or the agent idle', () => {
    const s1 = makeSession('s1', { cwd: '/work/repo' })
    const noRegistry = makeCtx(makeStore([s1]))
    expect(new HostSessionAdapter(noRegistry.ctx).listSessions().map(row => row.running)).toEqual([false])

    const idleRegistry = makeCtx(makeStore([s1]), [{ id: 's1', status: 'idle' }])
    expect(new HostSessionAdapter(idleRegistry.ctx).listSessions().map(row => row.running)).toEqual([false])
  })

  it('querySession is declared but throws the WP-2.x not-implemented marker', () => {
    const { ctx } = makeCtx(makeStore())
    const adapter = new HostSessionAdapter(ctx)
    expect(() => adapter.querySession('s1', { beforeSeq: 10, maxEvents: 5 })).toThrowError(
      /querySession\("s1"/,
    )
  })
})
