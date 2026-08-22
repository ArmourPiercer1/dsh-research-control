/**
 * DSH host-side adapter — Research Control Plane service (WP-0.2 skeleton,
 * WP-0.3 ping spike, WP-0.4 session adapter spike, WP-2.6 wiring).
 *
 * Service form per DSH_ADAPTER.md §4 (service 包 default-export service 类):
 * - extends `TypertRemoteService`, pinning the wire namespace via
 *   `super(ctx, 'researchControl')` (DSH_ADAPTER §5 step 1);
 * - `static inject` declares hard dependencies on DSH core services — the
 *   plugin fiber stays PENDING (silently) until they are ready (DSH_ADAPTER §4);
 * - `static Config` (schemastery, standard-schema V1) validates the plugin
 *   config coming from `cordis.yml` before the fiber starts — WP-2.6 adds
 *   `minDshVersion` (RR-008 / DSH_ADAPTER §12-②, default `0.1.0-rc.8`);
 * - `protected async [Service.init]()` carries post-construction async
 *   initialization (WP-0.4: instantiates the session adapter and its
 *   counting subscriptions; WP-2.6: the minDshVersion fail-loud guard +
 *   the startup `.dshrc-tmp` sweep);
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
 * WP-2.6: (a) the `minDshVersion` guard runs FIRST in `[Service.init]` —
 * a throw there fails the fiber (it never reaches ACTIVE, TC-DSH-008
 * fail-loud; DSH_ADAPTER §12-② / RR-008); (b) the startup sweep removes
 * stale `.dshrc-tmp` crash residue from every registered DSH workspace's
 * `.research/` tree (G1 round-1 重点 6 — the W9 front-line defense);
 * (c) the `SessionLinkService` itself is NOT constructed here yet: its
 * store (data dir = `$DSH_HOME` + project binding) and declarative sources
 * land with the workspace binding (DSH_ADAPTER §13-U9 / runbinding WP) —
 * the service is delivered injectable and fully tested in
 * `src/host/service/sessionlink/`.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { PingResult } from '../../../shared/rpc-contracts.js'
import { HostSessionAdapter, type SessionHostContext } from '../session.js'
import { assertMinDshVersion, createPackageVersionSource, DSH_VERSION_PACKAGE, DshVersionError, sweepStaleTmp } from '../../service/sessionlink/index.js'

/**
 * Validated plugin config.
 *
 * WP-2.6: `minDshVersion` — RR-008 / DSH_ADAPTER §12-② 「插件 `Config` 自持
 * `minDshVersion` 字段，`[Service.init]` 与宿主可观测版本比对 fail-loud」.
 * The default `0.1.0-rc.8` (the frozen baseline host, this plugin's exact
 * peer pin) lives in the SCHEMA, not in code (root AGENTS.md: no hardcoded
 * tunables — defaults belong in the schema).
 */
export interface Config {
  /**
   * The minimum DSH (harness package) version this plugin supports.
   * Optional at the type level (a hand-built config, e.g. in construction
   * tests, may omit it); for every config that went through the LOADER the
   * schema default (`0.1.0-rc.8`) has been applied, so `[Service.init]`
   * sees a string — an omission there is misconfiguration and fails loud.
   */
  readonly minDshVersion?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context { researchControl: ResearchControlService }
}

/** Minimal structural slice of a DSH workspace (DSH_ADAPTER §8 — the plugin
 *  does not devDep on `@deepseek-ai/dsh-workspace`; only `path` is read). */
interface WorkspaceLike {
  readonly path: string
}

/** Minimal structural slice of the DSH workspace registry (`list()` only). */
interface WorkspaceRegistryLike {
  list(): readonly WorkspaceLike[]
}

/**
 * The host context's workspace-registry face (the WP-0.3 RemoteContext
 * pattern, as for `SessionHostContext`): the plugin does not devDep on
 * `@deepseek-ai/dsh-workspace`, so its `Context` augmentation is invisible
 * here; `static inject` already contains `'workspaceRegistry'` — the fiber
 * is ACTIVE only once that service is resolvable.
 */
interface WorkspaceHostContext {
  workspaceRegistry: WorkspaceRegistryLike
}

export class ResearchControlService extends TypertRemoteService {
  /** Hard dependencies: fiber stays PENDING (silently) until these are ready. */
  static inject = ['sessions', 'tools', 'subagents', 'workspaceRegistry']

  /**
   * Loader-side validation of the plugin config (standard-schema V1).
   * `minDshVersion` default = the frozen baseline (DSH_ADAPTER 头部：宿主
   * `0.1.0-rc.8`; exact peer pin per RR-003).
   */
  static Config: s<Config> = s.object({
    minDshVersion: s.string().default('0.1.0-rc.8'),
  })

  /**
   * WP-0.4 spike: the session adapter instance — the read point for the
   * in-memory counters (`createdCount`/`disposedCount`/`eventCount`) is
   * this private field. Not an RPC and not a business API; real-machine
   * counter observation belongs to WP-0.6.
   */
  #sessionAdapter: HostSessionAdapter | undefined

  /** The validated config (WP-2.6: `minDshVersion` is read in `[Service.init]`). */
  readonly #config: Config

  /**
   * @param ctx - the host context that owns this service.
   * @param config - validated plugin config (WP-2.6: `minDshVersion`).
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'researchControl')
    this.#config = config
    // Cordis 管不到的资源 teardown 占位：SQLite 连接、file watcher（后续 WP）。
    // 注册本身即逆 effect：fiber 卸载时随注册自动回滚（DSH_ADAPTER §4 要点 2）。
    ctx.effect(() => () => {
      /* placeholder — no resources owned yet */
    })
  }

  /**
   * Post-construction async init.
   *
   * WP-2.6 (a): the `minDshVersion` guard (RR-008 / DSH_ADAPTER §12-②) runs
   * FIRST — the observable host version is the installed
   * `@deepseek-ai/dsh-typert-protocol` package (the dsh-* lockstep version
   * channel; see `sessionlink/version-guard.ts` for the investigation). A
   * throw here fails the fiber before it reaches ACTIVE (TC-DSH-008:
   * 版本不匹配时明确报错而非静默失败).
   *
   * WP-2.6 (b): the startup `.dshrc-tmp` sweep (G1 round-1 重点 6): every
   * registered DSH workspace with a `.research/` tree is swept of stale
   * crash residue — the front-line defense before W9 `git add -- .research/`
   * (TC-GIT-003) can stage residue into a checkpoint. Per-workspace
   * failures are WARNED, not fatal (boot hygiene; a genuinely unreadable
   * tree fails loudly at load time anyway).
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
    // (a) RR-008 / DSH_ADAPTER §12-② — fail-loud before anything else. The
    // loader's schema applies the `minDshVersion` default to every config
    // that went through validation; an omission here means a hand-built
    // config bypassed the schema — refuse to start without a version floor.
    const minDshVersion = this.#config.minDshVersion
    if (typeof minDshVersion !== 'string' || minDshVersion.length === 0) {
      throw new DshVersionError({
        code: 'VERSION_UNREACHABLE',
        message:
          'minDshVersion config is absent (the loader schema default should have applied) — ' +
          'the version guard has no floor to check against and refuses to start',
      })
    }
    assertMinDshVersion(minDshVersion, createPackageVersionSource(DSH_VERSION_PACKAGE, import.meta.url))

    // (b) G1 分诊 — startup sweep of stale crash residue (W9 front line).
    try {
      const registry = (this.ctx as unknown as WorkspaceHostContext).workspaceRegistry
      for (const workspace of registry.list()) {
        const researchRoot = join(workspace.path, '.research')
        if (!existsSync(researchRoot)) continue
        sweepStaleTmp(researchRoot, (entry) => {
          console.warn(`[research-control] swept stale crash residue: ${entry.path} (${String(entry.size)} bytes)`)
        })
      }
    } catch (cause) {
      console.warn(`[research-control] startup tmp sweep skipped: ${(cause as Error).message}`)
    }

    // (c) WP-0.4 session adapter + counting subscriptions (unchanged).
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
