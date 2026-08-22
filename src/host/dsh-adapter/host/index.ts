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
 * WP-3.6 (RR-011 ledger — the host service wiring): `[Service.init]` now
 * COMPLETES the dependency graph over the registered research workspace:
 * `createHostWiring` (src/host/service/wiring — store → registry → tree →
 * run/DS tables → allocator → runbinding + sessionlink → planfork/stale →
 * flooding → tools → startup reconciliation). A single research workspace
 * (exactly one registered workspace carrying a `.research/` tree) is the
 * V1 precondition: ZERO leaves the plane in spike mode (warned), MORE THAN
 * ONE fails the fiber loud (TC-DSH-008 — never guess between two
 * projects). The data dir is `$DSH_HOME/research-control/<project-id>`
 * (DSH_ADAPTER §9 — this file is the ONE place the
 * `@deepseek-ai/dsh-home-paths` import is allowed). Every opened resource
 * returns to ONE disposer registered with `ctx.effect` (fiber unmount →
 * `HostWiring.close()`: discovery subscription + all second connections +
 * the store connection). A `[Service.init]` throw = fiber FAILED before
 * ACTIVE (the wiring unwinds its partial resources itself). The 11 agent
 * tools (WP-3.3) are registered through `ctx.tools.register` (DSH_ADAPTER
 * §10.1) as PLAIN `ToolDefinition`s: `parameters` is the host's own
 * `parameterSchemaSpecToJsonSchema` projection of the plugin's mirror DSL,
 * `output.schema` is the plugin's raw-JSON-Schema face VERBATIM (the
 * `ToolDefinition.output.schema` vocabulary is the raw supported JSON
 * Schema — `assertSupportedJsonSchema` — the same subset WP-3.3 mirrored),
 * and `execute` resolves the calling session (`exec.agent.sessionId`) into
 * the frozen AGENT actorRef (the run from the session's run row when one
 * exists — the write tools' run requirement is then enforced by the
 * built-in gate) and maps `ToolError.code` into the host
 * `ToolFailure.info.code` (via `HarnessError` — the only error shape the
 * registry extracts structured `info` from).
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

import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  parameterSchemaSpecToJsonSchema,
  type ToolDefinition,
  type ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { HarnessError, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { PingResult } from '../../../shared/rpc-contracts.js'
import { HostSessionAdapter, type SessionHostContext } from '../session.js'
import {
  assertMinDshVersion,
  createPackageVersionSource,
  DSH_VERSION_PACKAGE,
  DshVersionError,
  sweepStaleTmp,
} from '../../service/sessionlink/index.js'
import { isToolError, type ResearchToolDefinition, type ToolJsonValue } from '../../tools/index.js'
import {
  createHostWiring,
  readProjectId,
  type HostWiring,
  type HostWiringLogger,
} from '../../service/wiring/index.js'

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

/** Minimal structural slice of the DSH tools service (DSH_ADAPTER §10.1 —
 *  `ctx.tools.register` only; the plugin does not type against the host's
 *  full ToolRuntime). */
interface ToolsHostContext {
  tools: { register(definition: ToolDefinition): () => void }
}

/**
 * The calling-session slice of the host `ToolRunContext` (DSH_ADAPTER
 * §10.1: the actor is resolved from the session — the plugin never reads
 * DSH session objects itself). `agent.sessionId` is the only field read
 * (dsh-agent is not a plugin dependency — structural slice, WP-0.3/0.4
 * pattern).
 */
interface ToolRunContextSlice {
  readonly signal: AbortSignal
  readonly agent?: { readonly sessionId: string }
}

/**
 * The tool-face error that RIDES the host `ToolFailure.info` (WP-3.3
 * contract: `ToolError.code` → `info.code`). The registry extracts
 * structured `info` ONLY from `HarnessError` instances
 * (`errorInfo` in @deepseek-ai/dsh-tools), so the plugin's `ToolError`
 * is rethrown as this subclass with the SAME code; anything else becomes
 * `TOOL_INTERNAL` (never a raw unstructured leak).
 */
class ResearchToolHostError extends HarnessError {
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, code, options)
  }
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

  /**
   * WP-3.6: the live host wiring (the RR-011 dependency graph) — `undefined`
   * only in spike mode (no research workspace registered) or before
   * `[Service.init]` completes. Disposed through `ctx.effect` →
   * `HostWiring.close()`.
   */
  #wiring: HostWiring | undefined

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

    // (d) WP-3.6 (RR-011 ledger): the host service wiring over the
    // registered research workspace. A throw here (misconfiguration, a
    // broken .research tree, an unusable registry, a failed startup
    // reconciliation under `failLoud`) fails the fiber BEFORE ACTIVE —
    // TC-DSH-008 fail-loud; the wiring unwinds its partial resources
    // itself, and the effect registered below disposes the survivors on
    // fiber death.
    const adapter = this.#sessionAdapter
    this.#wiring = this.#initResearchPlane(adapter)
    if (this.#wiring !== undefined) {
      // ONE disposer for the whole graph (DSH_ADAPTER §9: `[Service.init]`
      // open, `ctx.effect` close — the storage-sqlite register/close
      // pattern). Cordis runs disposers in REVERSE registration order on
      // fiber unmount; `close()` is itself idempotent and orders its own
      // teardown internally (second connections before the store).
      this.ctx.effect(() => {
        const wiring = this.#wiring
        return (): void => {
          wiring?.close()
          this.#wiring = undefined
        }
      })
      this.#registerResearchTools(this.#wiring)
    }
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

  /* ---------------------------------------------------------------- *
   * WP-3.6: the research plane (host service wiring)
   * ---------------------------------------------------------------- */

  /**
   * Build the host wiring over the registered research workspace
   * (DSH_ADAPTER §9 data dir + §10.1 tools).
   *
   * V1 precondition, enforced loud (TC-DSH-008): EXACTLY ONE registered
   * workspace may carry a `.research/` tree. ZERO → spike mode (warned;
   * the plane is not a requirement of a plain DSH host — `ping` still
   * serves). MORE THAN ONE → throw (refusing to guess between two
   * research projects; the operator must unregister one).
   *
   * @returns the live wiring, or `undefined` in spike mode.
   * @throws {Error} on ambiguity or on any wiring failure
   *  (misconfiguration, broken tree, unusable registry, reconciliation
   *  under `failLoud`) — the fiber fails before ACTIVE.
   */
  #initResearchPlane(adapter: HostSessionAdapter): HostWiring | undefined {
    const registry = (this.ctx as unknown as WorkspaceHostContext).workspaceRegistry
    const workspaces = registry.list()
    const researchWorkspaces = workspaces.filter((w) => {
      const p = join(w.path, '.research')
      return existsSync(p) && statSync(p).isDirectory()
    })
    if (researchWorkspaces.length === 0) {
      console.warn(
        '[research-control] no registered workspace carries a .research tree — ' +
          'the research control plane stays in spike mode (ping only); the tools are NOT registered',
      )
      return undefined
    }
    if (researchWorkspaces.length > 1) {
      throw new Error(
        `[research-control] ${researchWorkspaces.length} registered workspaces carry a .research tree ` +
          `(${researchWorkspaces.map((w) => w.path).join(', ')}) — the research control plane ` +
          'supports exactly one research project per host; unregister the extras and restart ' +
          '(TC-DSH-008: refusing to guess between two projects)',
      )
    }
    const workspace = researchWorkspaces[0]!
    const researchRoot = join(workspace.path, '.research')
    const projectId = readProjectId(researchRoot) // WIRING_INPUT on a malformed project.yaml
    const schemaRoot = this.#resolveSchemaRoot(import.meta.url)
    // DSH_ADAPTER §9: the data dir is $DSH_HOME/research-control/<project-id>
    // — dsh-home-paths is imported HERE ONLY (INV-PERM-5).
    const dataDir = dshHomePath('research-control', projectId)

    const logger: HostWiringLogger = {
      info: (step, message) => console.log(`[research-control][${step}] ${message}`),
      warn: (step, message) => console.warn(`[research-control][${step}] ${message}`),
      error: (step, message) => console.error(`[research-control][${step}] ${message}`),
    }

    return createHostWiring({
      repoRoot: workspace.path,
      schemaRoot,
      projectId,
      dataDir,
      adapter,
      workspaceRoots: workspaces.map((w) => w.path),
      logger,
      // Reconciliation policy: the default `rebuild` (reconstruct a missing
      // run row from the durable events; fail loud only when impossible) —
      // DSH_ADAPTER §13-U9 + the WP-2.4 未决 2 scheme. `failLoud` stays an
      // operator override for the `reconcileRuns` HostWiringOptions field.
    })
  }

  /**
   * Locate the frozen `schema/` root (SI-001: development phase — the
   * canonical copy lives at the WORKSPACE ROOT, the plugin repo does not
   * copy it; packaging WP-8.4 snapshots it into the release layout).
   *
   * Resolution order: the `DSH_RESEARCH_SCHEMA_ROOT` env override (tests /
   * special deployments) first; then walk UP from this module's file
   * (≤ 8 levels) for a directory whose `schema/` holds `common.schema.json`
   * plus the three frozen sub-dirs the wiring loads (`history/`,
   * `declarative/`, `operational/`). Fails loud when nothing usable is
   * found — the registry/tree/pf/intervention loads all need it.
   */
  #resolveSchemaRoot(importMetaUrl: string): string {
    const override = process.env['DSH_RESEARCH_SCHEMA_ROOT']
    if (typeof override === 'string' && override.length > 0) {
      const abs = resolve(override)
      if (isUsableSchemaRoot(abs)) return abs
      throw new Error(`DSH_RESEARCH_SCHEMA_ROOT=${abs} is not a usable frozen schema root (needs common.schema.json + history/ + declarative/ + operational/)`)
    }
    let dir = dirname(fileURLToPath(importMetaUrl))
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, 'schema')
      if (isUsableSchemaRoot(candidate)) return candidate
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    throw new Error(
      `cannot locate the frozen schema/ root walking up from ${fileURLToPath(importMetaUrl)} — ` +
      'set DSH_RESEARCH_SCHEMA_ROOT (SI-001: the canonical copy lives at the research workspace root)',
    )
  }

  /**
   * Register the 11 research tools (WP-3.3) as PLAIN `ToolDefinition`s
   * (DSH_ADAPTER §10.1 — `ctx.tools.register` = the effect; cordis
   * disposes the registration with the fiber). The field mapping:
   *  - `name` / `description` — verbatim (the model-visible surface);
   *  - `parameters` — the host's OWN `parameterSchemaSpecToJsonSchema`
   *    projection of the plugin's mirror DSL (field-for-field identical,
   *    WP-3.3; the host converter keeps the projection authoritative);
   *  - `output.schema` — the plugin's raw-JSON-Schema face VERBATIM
   *    (the `ToolDefinition.output.schema` vocabulary IS the raw
   *    supported JSON Schema — `assertSupportedJsonSchema` — the same
   *    subset WP-3.3 mirrored);
   *  - `output.render` — the plugin renderer, wrapped into a fresh
   *    mutable `ContentBlock[]` (the plugin mirror returns readonly);
   *  - `execute` — actor resolution + the `ToolError` → host
   *    `ToolFailure.info.code` mapping (module footer, below).
   */
  #registerResearchTools(wiring: HostWiring): void {
    const tools = (this.ctx as unknown as ToolsHostContext).tools
    for (const def of wiring.tools) {
      const toolDefinition: ToolDefinition = {
        name: def.name,
        description: def.description,
        // The plugin mirror is the field-for-field readonly twin of the
        // host DSL (WP-3.3) — the single structural cast at this wiring
        // point; the host's OWN converter projects it to JSON Schema, so
        // the projection stays host-authoritative.
        parameters: parameterSchemaSpecToJsonSchema(
          def.parameters as unknown as Parameters<typeof parameterSchemaSpecToJsonSchema>[0],
        ) as unknown as Record<string, unknown>,
        output: {
          // Deep-cloned: the plugin mirror is a static readonly object;
          // the host must never observe (or mutate) the shared node.
          schema: structuredClone(def.output.schema) as unknown as ToolDefinition['output']['schema'],
          // The plugin mirror returns a readonly block array — wrap into a
          // fresh mutable ContentBlock[] (the host vocabulary).
          render: (args: unknown, value: unknown): ContentBlock[] =>
            [...def.output.render(args, value as ToolJsonValue)],
        },
        execute: async (args: unknown, exec: ToolRunContext): Promise<unknown> =>
          this.#runResearchTool(def, args, exec as unknown as ToolRunContextSlice),
      }
      tools.register(toolDefinition)
    }
    console.log(`[research-control] registered ${wiring.tools.length} research tools (project ${wiring.projectId})`)
  }

  /**
   * One research tool call: resolve the frozen AGENT actorRef from the
   * calling session, run the plugin `ResearchToolDefinition.execute`
   * (the built-in tool gates — actor/run/shape/abort — do their work),
   * and map failures into the host `ToolFailure.info` contract:
   *  - a plugin `ToolError` → `ResearchToolHostError` (extends
   *    `HarnessError`) with the SAME `code` — the registry's `errorInfo`
   *    extracts `info: {name, code}` only from `HarnessError` instances,
   *    so the structured code rides to the model side (WP-3.3 contract);
   *  - an unresolved calling session → `TOOL_CALLER_UNRESOLVED` (these
   *    tools are agent-session tools only — a call without
   *    `exec.agent.sessionId` is a host misconfiguration, fail loud);
   *  - anything else → `TOOL_INTERNAL` (never a raw unstructured leak).
   */
  async #runResearchTool(
    def: ResearchToolDefinition,
    args: unknown,
    exec: ToolRunContextSlice,
  ): Promise<unknown> {
    const sessionId: unknown = exec.agent?.sessionId
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new ResearchToolHostError(
        'TOOL_CALLER_UNRESOLVED',
        `${def.name}: cannot resolve the calling session (exec.agent.sessionId absent) — ` +
          'research tools are agent-session tools only',
      )
    }
    const wiring = this.#wiring
    if (wiring === undefined) {
      throw new ResearchToolHostError(
        'TOOL_INTERNAL',
        `${def.name}: the research plane is not initialized (spike mode)`,
      )
    }
    // The run of this session (when one exists): the write tools then
    // enforce their run requirement through the built-in gate.
    const run = wiring.tables.getRunBySessionId(sessionId)
    const actor = {
      kind: 'AGENT' as const,
      session_id: sessionId,
      ...(run !== null && run.id !== undefined ? { run_id: run.id } : {}),
    }
    try {
      return await def.execute(args, { signal: exec.signal, actor })
    } catch (e) {
      if (isToolError(e)) {
        throw new ResearchToolHostError(`${e.code}: ${e.message}`, e.code, { cause: e })
      }
      throw toHostError(def, e)
    }
  }
}

/**
 * The frozen-schema-root usability check (SI-001 layout): the four pieces
 * the wiring loads — the shared `common.schema.json` (every schema
 * `allOf`-extends it from its PARENT dir) plus the `history/`,
 * `declarative/` and `operational/` sub-dirs.
 */
function isUsableSchemaRoot(p: string): boolean {
  return (
    existsSync(join(p, 'common.schema.json')) &&
    existsSync(join(p, 'history')) &&
    existsSync(join(p, 'declarative')) &&
    existsSync(join(p, 'operational'))
  )
}

/** Map an unexpected (non-`ToolError`) throw to the host error contract. */
function toHostError(def: ResearchToolDefinition, e: unknown): ResearchToolHostError {
  const message = e instanceof Error ? e.message : String(e)
  return new ResearchToolHostError(`TOOL_INTERNAL: ${def.name}: unexpected failure: ${message}`, 'TOOL_INTERNAL', { cause: e })
}

export default ResearchControlService
