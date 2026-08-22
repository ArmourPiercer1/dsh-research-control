/**
 * DSH host-side adapter — Research Control Plane service (WP-0.2 skeleton).
 *
 * Service form per DSH_ADAPTER.md §4 (service 包 default-export service 类):
 * - extends `TypertRemoteService`, pinning the wire namespace via
 *   `super(ctx, 'researchControl')` (DSH_ADAPTER §5 step 1);
 * - `static inject` declares hard dependencies on DSH core services — the
 *   plugin fiber stays PENDING (silently) until they are ready (DSH_ADAPTER §4);
 * - `static Config` (schemastery, standard-schema V1) validates the plugin
 *   config coming from `cordis.yml` before the fiber starts;
 * - `protected async [Service.init]()` carries post-construction async
 *   initialization (empty skeleton here);
 * - `ctx.effect` registered in the constructor wraps resources Cordis cannot
 *   manage itself (SQLite connection, file watcher) — placeholder only.
 *
 * This file is the ONLY host-side surface allowed to import DSH packages
 * (`@deepseek-ai/*`) — ARCHITECTURE.md §2.2 rule 2 / §5.9 INV-PERM-5.
 * Skeleton only: NO business methods, NO `@Remote` registrations
 * (RPC methods land in WP-0.3; SQLite/watcher in later WPs).
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

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

  /** Post-construction async init (empty skeleton: SQLite open、watcher 等后续 WP 接入，非业务方法). */
  protected async [Service.init](): Promise<void> {
    /* no-op at skeleton stage */
  }
}

export default ResearchControlService
