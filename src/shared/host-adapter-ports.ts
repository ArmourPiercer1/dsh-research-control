/**
 * Host-side DSH adapter ports — pure type contract (no runtime, no imports).
 *
 * ARCHITECTURE.md §2.3: business code depends ONLY on plugin-owned interfaces
 * (TS-defined in `src/shared/`, implemented in `host/dsh-adapter/` and
 * `client/dsh-adapter/`); the direction is always one-way
 * (domain/service -> port <- dsh-adapter implementation).
 *
 * This file declares the host-side port `DshHostAdapter`
 * (插件生命周期挂载、host service 注册、host event 订阅). The concrete
 * implementation lands in `src/host/dsh-adapter/` in a later WP — WP-0.2 only
 * provides the service mount skeleton and does NOT wire this port to it.
 *
 * NOTE: the remaining ports of the §2.3 table (DshWorkspaceAdapter,
 * DshRpcAdapter, DshUiAdapter, DshPersistenceAdapter, DshToolAdapter,
 * DshAgentLauncherAdapter) are declared in the WPs that implement them, so
 * no signature is invented ahead of its consumer. `DshSessionAdapter`
 * (WP-0.4) is declared below.
 */

/** Handler for one host session event (see DSH_ADAPTER.md §4 mapping). */
export type SessionEventHandler = (event: unknown) => void | Promise<void>

/**
 * Host-side adapter port (ARCHITECTURE.md §2.3, row 1):
 * 插件生命周期挂载、host service 注册、host event 订阅.
 *
 * DSH_API mapping (DSH_ADAPTER.md §4): `mountResearchControl(...)` binds the
 * default-exported service class on the host runtime; `onSessionEvent(handler)`
 * subscribes to host session events (reversible registration, disposer returned).
 */
export interface DshHostAdapter {
  /**
   * Mount the Research Control Plane on the host runtime: register the host
   * service (the service class default-exported by
   * `src/host/dsh-adapter/host/`) and let it complete async initialization.
   */
  mountResearchControl(): Promise<void>

  /**
   * Subscribe to host session events.
   * @param handler - invoked for each session event; may be async.
   * @returns disposer that unsubscribes the handler (reversible registration).
   */
  onSessionEvent(handler: SessionEventHandler): () => void
}

/* ====================================================================
 * DshSessionAdapter — session integration port (WP-0.4 spike)
 * ====================================================================
 *
 * DSH_ADAPTER.md §7「Session 集成」映射行:
 *   `DshSessionAdapter.listSessions()`（host: `ctx.sessions`；client:
 *   `list` snapshot）、`.onSessionEvent()`、`.querySession(id, window)`
 *   (session.history/sessionQuery)、`.observeSessionLifecycle()`
 *   (host/session-* 帧).
 *
 * The host implementation lands in `src/host/dsh-adapter/session.ts`
 * (WP-0.4 spike: in-memory event counters, NO SQLite — persistence/
 * stays untouched; real-machine verification is WP-0.6). The client
 * half (list-snapshot observation) belongs to a later WP.
 */

/**
 * Minimal local session row — the host-side projection of one live DSH
 * session (`DshSessionAdapter.listSessions()`).
 *
 * SPIKE SHAPE ONLY: field names mirror the client `SessionSummary`
 * (checkout `packages/client/runtime/src/client/sessions/service.ts`)
 * so Phase 2 can converge both halves of the §7 mapping. The final
 * shape is fixed by DOMAIN_SCHEMA §6 (DiscoveredSession/Run) — do not
 * treat this interface as a wire contract.
 */
export interface SessionSummary {
  /** Session id (the host `SessionId` is a branded string; serializes as a plain string). */
  readonly id: string
  /** Absolute working directory from the session header, when the session was created with one. */
  readonly cwd?: string
  /** Latest `session/title` event's title; absent until one is projected. */
  readonly title?: string
  /** Whether an agent turn is currently running (agent state, not session state). */
  readonly running: boolean
  /** Fork-lineage parent session id, when present. */
  readonly parentId?: string
  /** `'subagent'` for sessions created as subagent children. */
  readonly origin?: 'subagent'
  /** Agent preset the session runs under, when the deployment composes presets. */
  readonly agentPreset?: string
  /** Session-header createdAt (epoch ms, UTC). */
  readonly createdAt: number
  /** True while no turn has run yet (empty conversation). */
  readonly blank: boolean
}

/** One lifecycle edge observed on the host session store. */
export type SessionLifecycleEvent =
  | { readonly kind: 'created'; readonly sessionId: string }
  | { readonly kind: 'disposed'; readonly sessionId: string }

/** Handler for `DshSessionAdapter.observeSessionLifecycle`. */
export type SessionLifecycleHandler = (event: SessionLifecycleEvent) => void

/**
 * One appended session-log event, reduced to the fields a host-side
 * observer needs (spike: the full DSH `SessionEvent` envelope — seq/
 * time/type/data — is not projected; Phase 2 shapes the observer
 * payload with its consumers).
 */
export interface SessionEventInfo {
  /** The session the event was appended to. */
  readonly sessionId: string
  /** Event type string (e.g. `'turn/start'`; plugin-merged extensions included). */
  readonly type: string
  /** Monotonic sequence number of the appended event within its session. */
  readonly seq: number
}

/** Handler for `DshSessionAdapter.onSessionEvent`. */
export type SessionEventSubscriber = (event: SessionEventInfo) => void

/**
 * History-query window for `DshSessionAdapter.querySession` (placeholder
 * until WP-2.x fixes the shape against session.history / `ctx.sessionQuery`).
 */
export interface SessionQueryWindow {
  /** Read events with seq strictly below this seq (exclusive upper bound). */
  readonly beforeSeq?: number
  /** Maximum number of events to return. */
  readonly maxEvents?: number
}

/**
 * Host-side session adapter port (ARCHITECTURE.md §2.3, DSH_ADAPTER.md §7
 * 映射): session 列表、生命周期事件、session-query 读取. Business code
 * depends on this interface ONLY; the DSH session service is reached
 * exclusively through the implementation in `src/host/dsh-adapter/`.
 */
export interface DshSessionAdapter {
  /** All live sessions, in creation order, mapped to the port payload. */
  listSessions(): SessionSummary[]

  /**
   * Subscribe to the post-commit append feed (`session/event`): one call
   * per event appended to any live session (fire-and-forget broadcast,
   * scope-filtered — a root host subscription sees every session).
   * @param handler - invoked with the reduced event info.
   * @returns disposer that unsubscribes the handler (reversible registration).
   */
  onSessionEvent(handler: SessionEventSubscriber): () => void

  /**
   * Subscribe to store lifecycle edges (`session/created` +
   * `session/disposed`).
   * @param handler - invoked with the lifecycle edge.
   * @returns single disposer that unsubscribes BOTH subscriptions (reversible registration).
   */
  observeSessionLifecycle(handler: SessionLifecycleHandler): () => void

  /**
   * Query one session's history window.
   *
   * TODO(WP-2.x): implement over `session.history` / `ctx.sessionQuery`
   * (DSH_ADAPTER §7 历史读取) — the WP-0.4 spike does not read history,
   * so the return type carries no success value yet.
   */
  querySession(id: string, window: SessionQueryWindow): Promise<never>
}
