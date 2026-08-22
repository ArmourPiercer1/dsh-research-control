/**
 * DSH host-side adapter — Research Control Plane service (WP-0.2 skeleton,
 * WP-0.3 ping spike, WP-0.4 session adapter spike).
 *
 * Service form per DSH_ADAPTER.md §4 (service 包 default-export service 类):
 * - extends `TypertRemoteService`, pinning the wire namespace via
 *   `super(ctx, 'researchControl')` (DSH_ADAPTER §5 step 1);
 * - `static inject` declares hard dependencies on DSH core services — the
 *   plugin fiber stays PENDING (silently) until they are ready (DSH_ADAPTER §4);
 * - `static Config` (schemastery, standard-schema V1) validates the plugin
 *   config coming from `cordis.yml` before the fiber starts;
 * - `protected async [Service.init]()` carries post-construction async
 *   initialization (WP-0.4: instantiates the session adapter and its
 *   counting subscriptions);
 * - `ctx.effect` registered in the constructor wraps resources Cordis cannot
 *   manage itself (SQLite connection, file watcher) — placeholder only.
 *
 * This file is the ONLY host-side surface allowed to import DSH packages
 * (`@deepseek-ai/*`) — ARCHITECTURE.md §2.2 rule 2 / §5.9 INV-PERM-5.
 * WP-0.3: the ping RPC spike — one `@Remote('ping')` method (DSH_ADAPTER
 * §5) whose wire contract is the hand-written `./typert` artifact
 * (`typert.artifact.ts`, same directory). No business methods yet.
 * WP-0.4: the session adapter spike — `HostSessionAdapter` (../session.js)
 * is instantiated in `[Service.init]` and held in a private field whose
 * in-memory counters are the spike evidence (NOT an RPC — the public
 * surface stays exactly `ping` until Phase 2).
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { PingResult } from '../../../shared/rpc-contracts.js'
import { HostSessionAdapter, type SessionHostContext } from '../session.js'

/**
 * Validated plugin config. Intentionally empty at the WP-0.2 skeleton:
 * deployment-varying tunables (SQLite path, watcher options, …) are declared
 * here in later WPs (root AGENTS.md: no hardcoded tunables — defaults belong
 * in the schema, never in code).
 */
export interface Config {}

declare module '@deepseek-ai/cordis' {
  interface Context { researchControl: ResearchControlService }
}

export class ResearchControlService extends TypertRemoteService {
  /** Hard dependencies: fiber stays PENDING (silently) until these are ready. */
  static inject = ['sessions', 'tools', 'subagents', 'workspaceRegistry']

  /** Loader-side validation of the plugin config (standard-schema V1). */
  static Config: s<Config> = s.object({})

  /**
   * WP-0.4 spike: the session adapter instance — the read point for the
   * in-memory counters (`createdCount`/`disposedCount`/`eventCount`) is
   * this private field. Not an RPC and not a business API; real-machine
   * counter observation belongs to WP-0.6.
   */
  #sessionAdapter: HostSessionAdapter | undefined

  /**
   * @param ctx - the host context that owns this service.
   * @param config - validated plugin config (empty until later WPs add fields).
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'researchControl')
    // Cordis 管不到的资源 teardown 占位：SQLite 连接、file watcher（后续 WP）。
    // 注册本身即逆 effect：fiber 卸载时随注册自动回滚（DSH_ADAPTER §4 要点 2）。
    ctx.effect(() => () => {
      /* placeholder — no resources owned yet */
    })
  }

  /**
   * Post-construction async init.
   *
   * WP-0.4: instantiate the session adapter and its counting subscriptions.
   * The structural cast is the single wiring point (the WP-0.3
   * RemoteContext pattern): the real `ctx.sessions` (dsh-session
   * `SessionStore`) satisfies `SessionStoreLike`, but the plugin does not
   * devDep on `@deepseek-ai/dsh-session`, so its `Context` augmentation is
   * invisible here. `static inject` already contains `'sessions'` — the
   * fiber is ACTIVE only once that service is resolvable, and the
   * WP-0.6 real-machine boot is the structural proof.
   *
   * The two subscriptions are the spike's own counting subscriptions —
   * the handlers are no-ops because the in-memory counters ARE the
   * observation. Each `ctx.events.on` registers its listener as an effect
   * of THIS fiber (auto-disposal on fiber unmount) and returns its
   * disposer; no extra `ctx.effect` wrapper is needed (cordis convention:
   * registration is the effect, the disposer is the early-rollback path).
   */
  protected async [Service.init](): Promise<void> {
    const sessionCtx = this.ctx as SessionHostContext
    this.#sessionAdapter = new HostSessionAdapter(sessionCtx)
    this.#sessionAdapter.observeSessionLifecycle((): void => {
      /* counters only — spike evidence, not business logic */
    })
    this.#sessionAdapter.onSessionEvent((): void => {
      /* counters only — spike evidence, not business logic */
    })
  }

  /**
   * RPC spike (WP-0.3): liveness round-trip marker, no parameters (the
   * spike does no argument codec handling), pure-JSON result
   * (DSH_ADAPTER §5 step 3). The `@Remote('ping')` marker is what the
   * gateway's SRC fallback path resolves (plus the strict `./typert`
   * descriptor, which takes precedence once the loader registers it).
   * `time` is epoch milliseconds (UTC) — see `PingResult` in shared.
   */
  @Remote('ping')
  async ping(): Promise<PingResult> {
    return { ok: true, service: 'researchControl', time: Date.now() }
  }
}

export default ResearchControlService
