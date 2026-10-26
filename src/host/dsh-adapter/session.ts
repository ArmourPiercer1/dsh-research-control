/**
 * Host-side implementation of the `DshSessionAdapter` port (WP-0.4
 * session integration spike).
 *
 * This file is host-dsh-adapter territory: it may import `@deepseek-ai/*`
 * (ARCHITECTURE.md §2.2 rule 2 / §5.9 INV-PERM-5 exempt set). It imports
 * ONLY the cordis `Context` type — no DSH package — because the DSH
 * session service surface is consumed structurally (the WP-0.3
 * `RemoteContext` pattern, `src/client/dsh-adapter/remote/mount.ts`): the
 * plugin does not devDep on `@deepseek-ai/dsh-session`, so `ctx.sessions`
 * and the event payloads are declared as minimal local shapes. The host
 * runtime satisfies them structurally (the branded `SessionId` is a
 * subtype of `string`; `SessionHeader`/`SessionEvent` carry every field
 * the slices below read) — the WP-0.6 real-machine boot is the proof.
 *
 * Global-subscription production pattern (learned from the production
 * consumer, checkout `packages/host/apiproxy/src/api-proxy.ts`, read-only):
 * a HOST-level (unscoped) plugin context subscribes to the scope-filtered
 * session events DIRECTLY —
 *   api-proxy.ts:1295  `ctx.on('session/event', (session, event) => …)` (standing)
 *   api-proxy.ts:3389  `ctx.on('session/event', …)` (per mux stream)
 *   api-proxy.ts:3409  `ctx.on('session/created', …)`
 *   api-proxy.ts:3420  `ctx.on('session/disposed', …)`
 *   api-proxy.ts:3460  `ctx.on('session/created', …)` → `host/session-added`
 *   api-proxy.ts:3471  `ctx.on('session/disposed', …)` → `host/session-removed`
 * No per-session ctx mounting is needed: dispatch is scope-filtered
 * (`@deepseek-ai/dsh-scope` `scopeTarget`) and an UNTAGGED listener
 * context is admitted for every dispatch key, so one root-level
 * subscription sees every session's events. The `this: Scoped<Session>`
 * in the event declarations is the dispatch receiver (a routing-only
 * carrier); the real `Session` arrives as a PAYLOAD argument.
 *
 * Typing note: the session event names are not in this repo's `Events`
 * map (the merge-extensible map is completed at runtime by the host's
 * `@deepseek-ai/dsh-session` augmentation, which we do not devDep on),
 * so the adapter subscribes through the bus's untyped-name face
 * (`ctx.events.on(name, …)`) — the same `EventsService.on` that the
 * mixed-in `ctx.on` delegates to, with identical fiber-effect ownership.
 *
 * Reversibility (cordis convention: every registration is an effect):
 * `EventsService.on` registers each listener as an effect of the owning
 * fiber AND returns its disposer; this adapter composes and returns those
 * disposers, so early unsubscribe is exact (api-proxy.ts:3442-3445
 * collects the stream's disposers and runs them at stream close — the
 * same pattern).
 *
 * SPIKE SCOPE: `createdCount` / `disposedCount` / `eventCount` are
 * in-memory evidence that the subscriptions fire and dispose — readable
 * on the instance (the service holds it in a private field; NOT an RPC,
 * NOT business logic). NO SQLite (persistence/ stays untouched).
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  DshSessionAdapter,
  SessionEventInfo,
  SessionEventSubscriber,
  SessionLifecycleEvent,
  SessionLifecycleHandler,
  SessionQueryWindow,
  SessionSummary,
} from '../../shared/host-adapter-ports.js'

/** Minimal structural slice of one DSH session-log entry (event-bus payload). */
interface SessionEventLike {
  /** Monotonic sequence number within the session. */
  readonly seq: number
  /** Event type string. */
  readonly type: string
  /** Event payload (the `session/title` data carries `{ title }`). */
  readonly data?: unknown
}

/**
 * Minimal structural slice of a live DSH `Session` — 0.2.0-rc.2 shape:
 * header + id ONLY. The 0.1 `session.events` property is GONE (and
 * `Session.snapshotEvents()` is `@deprecated` with the upstream Agent Note
 * prohibition: "new calls are prohibited … new aliases or wrappers that
 * expose the same synchronous historical access are prohibited as well",
 * checkout packages/core/session/src/index.ts:629-663). Nothing on this
 * adapter reads the event log; everything log-derived flows through the
 * sessionProjections face below.
 */
export interface SessionLike {
  /** Session id (the real `SessionId` is branded; structurally a string). */
  readonly id: string
  /** Creation header — the fields this adapter reads. */
  readonly header: {
    readonly cwd?: string
    readonly parentSession?: string
    readonly origin?: 'subagent'
    /** Creation FACT only — the current preset selection is the `agentPreset` projection. */
    readonly agentPreset?: string
    readonly createdAt: number
  }
}

/** Minimal structural slice of the DSH `ctx.sessions` store this port reads. */
export interface SessionStoreLike {
  /** All live sessions, in creation order. */
  list(): SessionLike[]
}

/**
 * Structural slice of `ctx.sessionProjections` (0.2
 * `@deepseek-ai/dsh-session-projection`) as consumed here: read-only
 * `stateOf` over the three units this adapter needs —
 *  - `title`        → `string | null` (session-title unit: last committed
 *                     `session/title` fold — replaces scanning the old
 *                     `session.events` log for `session/title`);
 *  - `turnBoundary` → `{ openTurnStartSeq, lastTurn, … } | undefined`
 *                     (agent-loop unit, host-only: blank = no turn started,
 *                     mirroring the registry's own blank rule);
 *  - `agentPreset`  → `string | null` (agent-preset-registry unit: CURRENT
 *                     selection — header.agentPreset is only the creation
 *                     fact; `agent-preset/selected` advances the unit).
 *
 * `stateOf` returns `undefined` for an unregistered key (deployment
 * without the owning package) — every read below degrades explicitly,
 * never by guessing. The returned value is LIVE; treat as read-only.
 */
export interface SessionProjectionsLike {
  stateOf(session: object, key: 'title'): string | null | undefined
  stateOf(session: object, key: 'turnBoundary'): TurnBoundaryLike | undefined
  stateOf(session: object, key: 'agentPreset'): string | null | undefined
  stateOf(session: object, key: string): unknown
}

/** The agent-loop `turnBoundary` unit state (structural subset read here). */
export interface TurnBoundaryLike {
  readonly openTurnStartSeq: number | null
  readonly lastTurn: number
}

/**
 * Structural stand-in for the host context the adapter binds to (the
 * WP-0.3 `RemoteContext` pattern): the base cordis `Context` plus the
 * injected `sessions` service in its minimal local shape.
 * `sessionProjections` is read through the optional-service face
 * (`ctx.get`) — a deployment without the projection registry still loads
 * and lists (title/blank/preset-selection then carry their documented
 * degradation, never a fabricated value).
 */
export type SessionHostContext = Context & { sessions: SessionStoreLike }

/** Minimal structural slice of the host agent registry (drives `running`). */
interface AgentRegistryLike {
  /** Look up the live agent for one session id. */
  get(id: string): { readonly status?: string } | undefined
}

/**
 * Host implementation of `DshSessionAdapter` (WP-0.4 spike).
 *
 * Construction is side-effect free (stores the context; counters start
 * at zero) — subscriptions are created ONLY through the port methods,
 * each of which returns its disposer.
 */
export class HostSessionAdapter implements DshSessionAdapter {
  #ctx: SessionHostContext
  #createdCount = 0
  #disposedCount = 0
  #eventCount = 0

  /**
   * @param ctx - the host context with `sessions` injected (structural
   *   type; see the module header for the no-DSH-import rationale).
   */
  constructor(ctx: SessionHostContext) {
    this.#ctx = ctx
  }

  /** Spike evidence (NOT a business API): `session/created` edges delivered. */
  get createdCount(): number {
    return this.#createdCount
  }

  /** Spike evidence (NOT a business API): `session/disposed` edges delivered. */
  get disposedCount(): number {
    return this.#disposedCount
  }

  /** Spike evidence (NOT a business API): `session/event` deliveries. */
  get eventCount(): number {
    return this.#eventCount
  }

  /**
   * Map `ctx.sessions.list()` to the port payload.
   *
   * Field sources (0.2.0-rc.2 — projection-derived, NEVER a log scan):
   * `id`/`cwd`/`parentId`/`origin`/`createdAt` from the session header;
   * `title` from the `title` projection unit; `blank` from the
   * `turnBoundary` unit (started = `openTurnStartSeq !== null ||
   * lastTurn > 0` — the same blank rule the preset registry's `select`
   * gate applies, checkout agent-preset-registry/src/index.ts:321-323);
   * `agentPreset` from the `agentPreset` unit (CURRENT selection — the
   * header value is only the creation fact, used solely when the unit is
   * unregistered); `running` from the agent registry
   * (`status === 'running'`), defaulting to `false` when the registry is
   * absent. Degradations (projection registry absent / unit unregistered):
   * `title` omitted, `blank` false (never claim blankness unseen),
   * `agentPreset` falls back to the header creation fact.
   */
  listSessions(): SessionSummary[] {
    const agents = this.#ctx.get('agents') as AgentRegistryLike | undefined
    const projections = this.#ctx.get('sessionProjections') as unknown as
      | SessionProjectionsLike
      | undefined
    return this.#ctx.sessions.list().map((session): SessionSummary => {
      const title = projections?.stateOf(session, 'title') ?? undefined
      const turn = projections?.stateOf(session, 'turnBoundary')
      const started = turn === undefined ? false : turn.openTurnStartSeq !== null || turn.lastTurn > 0
      const preset = projections?.stateOf(session, 'agentPreset')
      const agentPreset = preset === undefined ? session.header.agentPreset : preset ?? undefined
      return {
        id: session.id,
        ...session.header.cwd === undefined ? {} : { cwd: session.header.cwd },
        ...title === undefined ? {} : { title },
        running: agents?.get(session.id)?.status === 'running',
        ...session.header.parentSession === undefined ? {} : { parentId: session.header.parentSession },
        ...session.header.origin === undefined ? {} : { origin: session.header.origin },
        ...agentPreset === undefined ? {} : { agentPreset },
        createdAt: session.header.createdAt,
        blank: !started,
      }
    })
  }

  /**
   * Subscribe to the post-commit append feed. One root-level subscription
   * (production pattern, module header) receives every session's events.
   */
  onSessionEvent(handler: SessionEventSubscriber): () => void {
    return this.#ctx.events.on(
      'session/event',
      (session: SessionLike, event: SessionEventLike): void => {
        this.#eventCount += 1
        handler({ sessionId: session.id, type: event.type, seq: event.seq })
      },
    )
  }

  /**
   * Subscribe to both lifecycle edges; returns one composed disposer
   * (each half is the fiber-effect disposer its `ctx.events.on` returned).
   */
  observeSessionLifecycle(handler: SessionLifecycleHandler): () => void {
    const disposeCreated = this.#ctx.events.on(
      'session/created',
      (session: SessionLike): void => {
        this.#createdCount += 1
        handler({ kind: 'created', sessionId: session.id } satisfies SessionLifecycleEvent)
      },
    )
    const disposeDisposed = this.#ctx.events.on(
      'session/disposed',
      (session: SessionLike): void => {
        this.#disposedCount += 1
        handler({ kind: 'disposed', sessionId: session.id } satisfies SessionLifecycleEvent)
      },
    )
    return () => {
      disposeCreated()
      disposeDisposed()
    }
  }

  /**
   * TODO(WP-2.x): history-window read over `session.history` /
   * `ctx.sessionQuery` (DSH_ADAPTER §7 历史读取). The WP-0.4 spike does
   * not read history; the port member is declared so the Phase-2
   * consumer can code against the port from day one.
   */
  querySession(id: string, window: SessionQueryWindow): Promise<never> {
    throw new Error(
      `HostSessionAdapter.querySession("${id}", beforeSeq=${String(window.beforeSeq)}, maxEvents=${String(window.maxEvents)}): not implemented — WP-2.x (session.history / ctx.sessionQuery)`,
    )
  }
}
