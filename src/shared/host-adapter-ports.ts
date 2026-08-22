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
 * NOTE: the remaining ports of the §2.3 table (DshSessionAdapter,
 * DshWorkspaceAdapter, DshRpcAdapter, DshUiAdapter, DshPersistenceAdapter,
 * DshToolAdapter, DshAgentLauncherAdapter) are declared in the WPs that
 * implement them, so no signature is invented ahead of its consumer.
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
