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

/**
 * Build one fake live session with header fields ONLY (0.2 `SessionLike`:
 * the 0.1 log property is gone — title/blank/preset-selection now come from
 * the fake `sessionProjections` below, never from the session object).
 */
function makeSession(
  id: string,
  opts: {
    cwd?: string
    parentSession?: string
    origin?: 'subagent'
    agentPreset?: string
    createdAt?: number
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
  }
}

/** Per-session fake projection states keyed by session id. */
interface FakeProjectionState {
  title?: string | null
  turnBoundary?: { openTurnStartSeq: number | null; lastTurn: number }
  agentPreset?: string | null
}

/**
 * Fake `ctx.sessionProjections`: a session missing from the map behaves
 * like an unregistered unit (`stateOf` -> undefined), exactly the 0.2
 * session-projection contract.
 */
function makeProjections(map: Readonly<Record<string, FakeProjectionState>>) {
  return {
    stateOf: (session: { id: string }, key: string): unknown =>
      (map[session.id] as Readonly<Record<string, unknown>> | undefined)?.[key],
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
 * Assemble the fake host context: bus + store, and — only when provided —
 * a minimal agent registry behind `ctx.get('agents')` (the adapter's
 * `running` derivation; absent registry ⇒ `running:false`) and a fake
 * projections service behind `ctx.get('sessionProjections')` (absent ⇒ the
 * adapter's documented degradation path).
 */
function makeCtx(
  store: SessionStoreLike,
  agents?: readonly { id: string; status: string }[],
  projections?: ReturnType<typeof makeProjections>,
) {
  const bus = makeBus()
  const registry = agents === undefined ? undefined : new Map(agents.map(agent => [agent.id, agent]))
  const fake = {
    events: { on: bus.on },
    sessions: store,
    get: (name: string): unknown => {
      if (name === 'agents' && registry !== undefined) return { get: (id: string) => registry.get(id) }
      if (name === 'sessionProjections' && projections !== undefined) return projections
      return undefined
    },
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

  it('maps ctx.sessions.list() rows to the port payload fields (projection-derived title/blank/preset)', () => {
    const s1 = makeSession('s1', {
      cwd: '/work/repo',
      agentPreset: 'researcher',
      createdAt: 111,
    })
    const s2 = makeSession('s2', { parentSession: 's1', origin: 'subagent', createdAt: 222 })
    const projections = makeProjections({
      // title unit: last committed fold; turnBoundary: one closed turn.
      s1: {
        title: 'renamed',
        turnBoundary: { openTurnStartSeq: null, lastTurn: 1 },
        agentPreset: 'researcher',
      },
    })
    const { ctx } = makeCtx(makeStore([s1, s2]), [{ id: 's1', status: 'running' }], projections)
    const adapter = new HostSessionAdapter(ctx)

    // Creation order preserved; header fields mapped 1:1; title from the
    // title unit; blank folded from turnBoundary; running from the agents
    // registry. s2 has no registered projection units: title omitted,
    // blank TRUE — an absent `turnBoundary` unit is AUTHORITATIVE
    // no-turn evidence (upstream capability absence, core/agent/src/
    // types.ts:69-76; see the R4 contract case below), agentPreset falls
    // back to the header creation fact (absent ⇒ omitted).
    expect(adapter.listSessions()).toEqual([
      { id: 's1', cwd: '/work/repo', title: 'renamed', running: true, agentPreset: 'researcher', createdAt: 111, blank: false },
      { id: 's2', running: false, parentId: 's1', origin: 'subagent', createdAt: 222, blank: true },
    ])
  })

  it('title updates and turn starts flow through the projection units', () => {
    const s1 = makeSession('s1')
    const store = makeStore([s1])
    const states: Record<string, FakeProjectionState> = {
      s1: { title: null, turnBoundary: { openTurnStartSeq: null, lastTurn: 0 }, agentPreset: null },
    }
    const { ctx } = makeCtx(store, undefined, makeProjections(states))
    const adapter = new HostSessionAdapter(ctx)
    expect(adapter.listSessions()[0]).toMatchObject({ blank: true })
    expect(adapter.listSessions()[0]).not.toHaveProperty('title')

    // `session/title` committed ⇒ the title unit advances (no log re-read).
    states.s1 = { ...states.s1, title: 'research: repo' }
    expect(adapter.listSessions()[0]).toMatchObject({ title: 'research: repo' })

    // `turn/start` committed ⇒ the turnBoundary unit advances ⇒ not blank.
    states.s1 = { ...states.s1, turnBoundary: { openTurnStartSeq: 7, lastTurn: 1 } }
    expect(adapter.listSessions()[0]).toMatchObject({ blank: false })

    // `turn/end` committed ⇒ closed turn, still not blank.
    states.s1 = { ...states.s1, turnBoundary: { openTurnStartSeq: null, lastTurn: 1 } }
    expect(adapter.listSessions()[0]).toMatchObject({ blank: false })
  })

  it('agentPreset reports the CURRENT projection selection, not the header creation fact', () => {
    // Header says the session STARTED with `standard`; a blank-session
    // `agent-preset/selected` advanced the unit to `research-investigator`.
    const s1 = makeSession('s1', { agentPreset: 'standard' })
    const { ctx } = makeCtx(
      makeStore([s1]),
      undefined,
      makeProjections({ s1: { agentPreset: 'research-investigator' } }),
    )
    expect(new HostSessionAdapter(ctx).listSessions()[0]).toMatchObject({ agentPreset: 'research-investigator' })

    // Projection says null (deployment composes none) ⇒ omitted even when
    // a stale header fact exists (projection is the authority).
    const { ctx: nullCtx } = makeCtx(makeStore([s1]), undefined, makeProjections({ s1: { agentPreset: null } }))
    expect(new HostSessionAdapter(nullCtx).listSessions()[0]).not.toHaveProperty('agentPreset')
  })

  it('degrades without the projections service: header preset, conservative blank, no title', () => {
    const s1 = makeSession('s1', { agentPreset: 'researcher' })
    const { ctx } = makeCtx(makeStore([s1]))
    expect(new HostSessionAdapter(ctx).listSessions()[0]).toMatchObject({
      agentPreset: 'researcher', // header creation fact (unit unregistered)
      blank: true, // degraded read never claims started without proof —
      // the same fallback the host select gate applies (R4 unification;
      // the projections-service-absent arm of the two undefined arms in
      // the R4 contract case below)
    })
  })

  it('R4 contract: an absent turnBoundary unit is AUTHORITATIVE no-turn evidence (capability absence)', () => {
    // Upstream reader contract (checkout core/agent/src/types.ts:69-76):
    // the `turnBoundary` key is registered by `dsh-agent-loop` and ABSENT
    // otherwise; "without agent-loop no turn events exist, so readers
    // treat an absent key as no open turn / no boundaries — capability
    // absence, not a corrupt state." ⇒ a session with no unit never
    // started ⇒ blank true (mirrors the host select gate, agent-preset-
    // registry/src/index.ts:321-323). The projections-service-absent arm
    // keeps the same fallback (degraded reads never claim started without
    // proof). DISCLOSED existing-debt edge (host-side, outside this
    // plugin's patch budget): turns ran + agent-loop uninstalled mid-
    // persistence reads blank again — unreachable while agent-loop is
    // installed. No destructive consumer of `.blank` exists in this repo
    // (display/analysis payloads only — verified by grep).
    const s1 = makeSession('s1')
    const { ctx } = makeCtx(makeStore([s1]), undefined, makeProjections({}))
    expect(new HostSessionAdapter(ctx).listSessions()[0]).toMatchObject({ blank: true })
    // …and a folded unit with boundaries is NOT blank (the non-blank arm,
    // replayed state — the dispose edge above is the only unverifiable
    // transition and stays disclosed, not silently asserted).
    const started = makeProjections({
      s1: { title: null, turnBoundary: { openTurnStartSeq: null, lastTurn: 2 }, agentPreset: null },
    })
    const startedCtx = makeCtx(makeStore([s1]), undefined, started)
    expect(new HostSessionAdapter(startedCtx.ctx).listSessions()[0]).toMatchObject({ blank: false })
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
