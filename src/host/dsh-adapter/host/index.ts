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
 * WP-4.1a (the host-side 13-RPC client face — ARCHITECTURE.md §7.1):
 * THIN `@Remote` method bodies: `zod decode (the shared strict schema)
 * → forward to the injected `ResearchRpcServices` port` (rpc-services.ts,
 * same directory — the production implementation is composed here in
 * `[Service.init]` over the wiring-assembled instances; tests inject a
 * stub through the optional 3rd constructor argument). NO business logic
 * lives in the method bodies (the red line: 业务逻辑不进 RPC 层 — 只转发).
 * User-semantic RPCs (reorderPlan / selectPlanFork / dismissPlanFork /
 * updateInterventionState / restoreDeclarativeFile / saveResearchCheckpoint)
 * make NO actor distinction at the RPC face (the client face IS the user
 * face; the host gateway bounds the ARCHITECTURE §6 matrix) — the
 * forwarded services keep their existing permission checks. In spike
 * mode (no research workspace registered) the 13 methods fail loud.
 * `ping` stays the 14th, diagnostic-only method (WP-0.3).
 * V2-T3.2a (design §12 rows 1-3 — the plane-level read-only face):
 * `getResearchPlaneState` / `getHubOverview` / `getPortfolioInterventions`
 * join the service as THIN `@Remote` bodies that forward to the PLANE-
 * LEVEL `ResearchPlaneServices` port (plane-read-services.ts — ONE
 * instance for the whole plane, composed here in `[Service.init]` over
 * the discovered PlaneState + the per-project wirings map; tests inject
 * a stub through the optional 4th constructor argument). Unlike the 13,
 * they are NOT routed: they serve the whole plane in every mode (the
 * empty plane included — the 引导卡 data of design §6), and fail loud
 * only pre-init. The §12.1 routing of the 13 lands in the SAME bodies
 * (decode first → `requireRpc(decoded.projectId)` — the 11 parameterized
 * RPCs route on the optional `projectId`; the two zero-arg queries keep
 * their frozen wire face and route through the omitted-id rule).
 * V2-T3.2b (design §12 rows 4-6/8/9 — the plane-level mutation face):
 * `setHub` / `bindProject` / `unbindProject` / `restoreProject` /
 * `rescan` / `ackMissingReminder` join the service as THIN `@Remote`
 * bodies that forward to the PLANE-LEVEL
 * `ResearchPlaneMutationServices` port (plane-mutation-services.ts —
 * the mutation sibling of the read port: ONE instance for the whole
 * plane, composed here in `[Service.init]` over the SAME live fields;
 * tests inject a stub through the optional 5th constructor argument).
 * PLANE-LEVEL — NOT project-routed (the §12.1 resolution does not
 * apply): callable on the EMPTY plane too (that is the onboarding path,
 * design §8 设为中枢/接入). Every successful mutation re-runs
 * `#initResearchPlane` through the port's re-init hook (the
 * `#reinitResearchPlane` here), so the NEXT RPC call sees the fresh
 * plane state.
 * WP-3.6 (RR-011 ledger — the host service wiring): `[Service.init]` now
 * COMPLETES the dependency graph over the registered research workspace:
 * `createHostWiring` (src/host/service/wiring — store → registry → tree →
 * run/DS tables → allocator → runbinding + sessionlink → planfork/stale →
 * flooding → tools → startup reconciliation).
 * V2-T2.2 (design §4/§13 row 1): the V1 「exactly one `.research`
 * workspace」 precondition is REPLACED by the §4 discovery &
 * reconciliation state machine (src/host/dsh-adapter/host/discovery.ts):
 * every registered workspace's root level is scanned for the configured
 * `<hubDir>`/`<treeDir>` (T2.1 `getResearchDirNames`), exactly-one-hub is
 * enforced loud (≥ 2 hubs ⇒ fiber FAILED, TC-DSH-008), the hub's
 * `registry.yaml` is parsed (T2.3 kernel, malformed ⇒ fail-loud), and
 * every discovered tree is reconciled against the registry: MANAGED
 * (registered ∧ tree), STANDALONE (unregistered ∧ tree, warned), MISSING
 * (registered ∧ no tree, warned — awaiting the T3.x disposition UI).
 * One `HostWiring` + one RPC service port is built per MANAGED/STANDALONE
 * project (a `Map<projectId, …>` — `createHostWiring` keeps its
 * single-project construction). The §12.1 routing reservation
 * (`resolveProject`, discovery.ts) resolves the 13 frozen RPCs' target
 * under a multi-project plane (the optional `projectId` request field
 * lands in T3.1 — until then, an omitted id on a multi-project plane
 * fails loud with the project list). V2-T2.4 (design §3.3): the data
 * dir is RESOLVED by kind through the pure storage-locations layer —
 * MANAGED `<hub>/<hubDir>/projects/<id>/`, STANDALONE
 * `<ws>/<treeDir>/state/` (the db file `research.sqlite` in each; the
 * STANDALONE state/ subdir is outside the checkpoint commit scope —
 * the git whitelist's W9/W10 carry the explicit exclude pathspec); the
 * V1 `$DSH_HOME/research-control/<id>/` layout is retired (one startup
 * warn line via `hintOldDbHome` when it survives — no automatic
 * migration, design §14). This file is the ONE place the `@deepseek-ai/
 * dsh-home-paths` import is allowed (INV-PERM-5) — now only
 * `resolveDshHome` for that legacy probe. The 11 agent tools + the
 * investigate/analysis
 * commands register ONLY on a single-project plane (their frozen face
 * carries no projectId — a multi-project plane warns loud instead of
 * registering an ambiguous binding). Every opened resource returns to ONE
 * disposer registered with `ctx.effect` (fiber unmount → close the RPC
 * ports, then every `HostWiring.close()`). A `[Service.init]` throw =
 * fiber FAILED before ACTIVE (the init unwinds any partially composed
 * per-project resources itself). The 11 agent tools (WP-3.3) are
 * registered through `ctx.tools.register` (DSH_ADAPTER
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

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
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
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { HarnessError, type ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  AckMissingReminderArgsSchema,
  BindProjectArgsSchema,
  CreateTopicArgsSchema,
  CreateWorkstreamArgsSchema,
  DismissPlanForkArgsSchema,
  GetGitHistoryArgsSchema,
  GetCurrentFocusArgsSchema,
  GetHubOverviewArgsSchema,
  GetPortfolioInterventionsArgsSchema,
  GetResearchPlaneStateArgsSchema,
  GetTopicArgsSchema,
  GetWorkstreamArgsSchema,
  QueryHistoryArgsSchema,
  ReorderPlanArgsSchema,
  RescanArgsSchema,
  RestoreDeclarativeFileArgsSchema,
  RestoreProjectArgsSchema,
  SaveResearchCheckpointArgsSchema,
  SelectPlanForkArgsSchema,
  SetCurrentFocusArgsSchema,
  SetHubArgsSchema,
  UnbindProjectArgsSchema,
  UpdateInterventionStateArgsSchema,
  RegisterInteractionArgsSchema,
  type AckMissingReminderArgs,
  type AckMissingReminderResult,
  type BindProjectArgs,
  type BindProjectResult,
  type CreateTopicArgs,
  type CreateTopicResult,
  type CreateWorkstreamArgs,
  type CreateWorkstreamResult,
  type DashboardSnapshot,
  type DismissPlanForkArgs,
  type DismissPlanForkResult,
  type GetGitHistoryArgs,
  type GetGitHistoryResult,
  type GetCurrentFocusArgs,
  type GetCurrentFocusResult,
  type GetHubOverviewArgs,
  type GetPortfolioInterventionsArgs,
  type GetPortfolioInterventionsResult,
  type GetResearchPlaneStateArgs,
  type GetResearchPlaneStateResult,
  type GetTopicArgs,
  type GetWorkstreamArgs,
  type HubOverviewResult,
  type PingResult,
  type ProjectSnapshot,
  type QueryHistoryArgs,
  type QueryHistoryResult,
  type ReorderPlanArgs,
  type ReorderPlanResult,
  type RegisterInteractionArgs,
  type RegisterInteractionResult,
  type RescanArgs,
  type RescanResult,
  type RestoreDeclarativeFileArgs,
  type RestoreDeclarativeFileResult,
  type RestoreProjectArgs,
  type RestoreProjectResult,
  type SaveResearchCheckpointArgs,
  type SaveResearchCheckpointResult,
  type SelectPlanForkArgs,
  type SelectPlanForkResult,
  type SetCurrentFocusArgs,
  type SetCurrentFocusResult,
  type SetHubArgs,
  type SetHubResult,
  type TopicSnapshot,
  type UnbindProjectArgs,
  type UnbindProjectResult,
  type UpdateInterventionStateArgs,
  type UpdateInterventionStateResult,
  type WorkstreamSnapshot,
} from '../../../shared/rpc-contracts.js'
import {
  ProductionResearchRpcServices,
  type ResearchRpcServices,
} from './rpc-services.js'
import {
  ProductionResearchPlaneServices,
  type ResearchPlaneServices,
} from './plane-read-services.js'
import {
  ProductionResearchPlaneMutationServices,
  type ResearchPlaneMutationServices,
} from './plane-mutation-services.js'
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
  DiscoverError,
  discoverPlane,
  probeWorkspaces,
  resolveProject,
  type PlaneState,
} from './discovery.js'
import {
  hintOldDbHome,
  nodeFsStorageIo,
  resolveDbDir,
} from '../../service/storage-locations/index.js'
import {
  createHostWiring,
  type HostWiring,
  type HostWiringLogger,
} from '../../service/wiring/index.js'
import { HostAgentLauncherAdapter, type LauncherHostContext } from '../launcher/index.js'
import { registerAnalysisCommands } from './analysis-commands.js'
import { registerInvestigationCommand } from './investigate-command.js'
import { getResearchDirNames, registerResearchSettings } from './settings.js'

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

/**
 * The composed research plane (V2-T2.2 — `#initResearchPlane`'s result):
 * the discovered state + the per-project resources, keyed by project id
 * (the §12.1 routing map). Empty maps = the empty/spike plane (the V1
 * `undefined` wiring is now a shape — `plane.hub === null`, no projects).
 */
interface PlaneInitResult {
  readonly plane: PlaneState
  /** One live wiring per MANAGED/STANDALONE project (never MISSING). */
  readonly wirings: Map<string, HostWiring>
  /** One RPC service port per project (1:1 with `wirings`). */
  readonly rpcs: Map<string, ResearchRpcServices>
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
  /** Hard dependencies: fiber stays PENDING (silently) until these are
   *  ready — DSH_ADAPTER §4 verbatim (the four frozen items; `host-
   *  mount.test.ts` pins the list). WP-7.4 / G7 S1: the investigator
   *  launch capability does NOT join the hard face — the launcher
   *  adapter resolves `agents` through `ctx.get` (the documented
   *  optional-service read, DSH_ADAPTER §4 要点 「可选服务用
   *  `ctx.get('name')`」 — the production `HostSessionAdapter` (WP-0.4,
   *  real-machine verified) reads the same registry that way). A
   *  deployment without the `agents` service still LOADS the plugin
   *  (a missing hard inject keeps the whole fiber PENDING — the §4
   *  documented pitfall; coupling the plugin's load to one launch
   *  capability would be a deployment regression); a one-click launch
   *  there fails loud IVL_LAUNCH at use time instead (no silent
   *  downgrade — the gap is named at the operation, not swallowed at
   *  boot). */
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
   * WP-3.6 / V2-T2.2: the live host wiring of the SINGLE-PROJECT plane
   * (the RR-011 dependency graph) — `undefined` on a multi-project
   * plane (the per-project wirings live in the map built in
   * `#initResearchPlane`, disposed through the plane effect), in the
   * empty/spike plane, or before `[Service.init]` completes. The 11
   * agent tools resolve their data face through this field
   * (`#runResearchTool`) — the tools register only on a single-project
   * plane, so the resolution is unambiguous.
   */
  #wiring: HostWiring | undefined

  /**
   * V2-T2.2 (design §4 step 6): the discovered plane state — set in
   * `[Service.init]` in EVERY mode (the empty plane included: hub
   * `null`, no projects — the V1 spike mode is now a plane shape, not
   * the absence of a plane). `undefined` only before init.
   *
   * WP-4.6 (TC-E2E) proxy rule: TS `private`, NOT an ECMAScript `#`
   * member — the `@Remote` call chain reads it through the cordis
   * traceable proxy (`requireRpc` → `resolveProject`), and V8 refuses
   * ANY `#`-member access from a Proxy receiver.
   */
  private plane: PlaneState | undefined

  /**
   * V2-T2.2: the per-project RPC service ports (one
   * `ProductionResearchRpcServices` per MANAGED/STANDALONE project,
   * keyed by project id — the §12.1 routing map). `undefined` only
   * before init. Same proxy rule as {@link plane} (TS `private`, not
   * `#`).
   */
  private projectRpcs: Map<string, ResearchRpcServices> | undefined

  /**
   * V2-T3.2a: the per-project wirings (the plane-read face's read source —
   * `getHubOverview` / `getPortfolioInterventions` aggregate over these
   * service faces: the fresh tree load, the intervention store, the inbox
   * service). Same fill/dispose lifecycle as {@link projectRpcs} (both
   * maps are composed together in `#initResearchPlane` and torn down by
   * the plane effect's disposer). Same proxy rule as {@link plane} (TS
   * `private`, not `#` — read through the plane service's lazy getter on
   * the @Remote chain).
   */
  private projectWirings: Map<string, HostWiring> | undefined

  /**
   * V2-T3.2a (design §12 rows 1-3): the PLANE-LEVEL read-only RPC port
   * (getResearchPlaneState / getHubOverview / getPortfolioInterventions)
   * — ONE instance for the whole plane (unlike the per-project
   * {@link projectRpcs} map, which the §12.1 routing selects between):
   * composed in `[Service.init]` over the discovered `plane` + the
   * `projectWirings` map (plane-read-services.ts); tests inject a stub
   * through the optional 4th constructor argument (the WP-4.1a seam
   * extended). `undefined` only before init — `requirePlaneServices`
   * fails loud (the same spike-mode guard shape as `requireRpc`). Same
   * proxy rule as {@link plane} (TS `private`, not `#`).
   */
  private planeServices: ResearchPlaneServices | undefined

  /**
   * V2-T3.2b (design §12 rows 4-6/8/9): the PLANE-LEVEL MUTATION RPC port
   * (setHub / bindProject / unbindProject / restoreProject / rescan /
   * ackMissingReminder) — the mutation sibling of {@link planeServices}:
   * ONE instance for the whole plane, PLANE-LEVEL (NOT project-routed —
   * callable on the EMPTY plane too: that is the onboarding path, design
   * §8 设为中枢/接入). Composed in `[Service.init]` next to the read port
   * over the SAME live fields (plane / projectWirings), with its
   * re-init hook wired to `#reinitResearchPlane` — every successful
   * mutation re-runs the §4 discovery + per-project rewiring and the NEXT
   * RPC call reads the fresh state (plane-mutation-services.ts); tests
   * inject a stub through the optional 5th constructor argument (the
   * T3.2a seam extended). `undefined` only before init —
   * `requirePlaneMutationServices` fails loud (the same spike-mode guard
   * shape). Same proxy rule as {@link plane} (TS `private`, not `#`).
   */
  private planeMutationServices: ResearchPlaneMutationServices | undefined

  /**
   * WP-4.1a / V2-T2.2: the RPC service port the 13 `@Remote` methods
   * forward to. V2-T2.2: the PRODUCTION ports live in
   * {@link projectRpcs} (one per plane project — the §12.1 routing map,
   * composed in `#initResearchPlane`, disposed through the plane
   * effect). This field is now the TEST seam only: a stub injected
   * through the optional 3rd constructor argument, which
   * `requireRpc` consults FIRST (existing rpc-face suites construct the
   * service without running `[Service.init]` and forward to the stub).
   *
   * WP-4.6 (TC-E2E): TS `private`, NOT an ECMAScript `#` member — the
   * typert gateway invokes `@Remote` methods through the cordis traceable
   * proxy (`ctx.get(serviceKey)` → `Reflect.apply(method, proxy, args)`),
   * and V8 refuses ANY `#`-member access from a Proxy receiver ("Receiver
   * must be an instance of class …"). `rpc`/`plane`/`projectRpcs` +
   * `requireRpc` (the frozen 13), `planeServices` +
   * `requirePlaneServices` (the 3 plane reads, V2-T3.2a) and
   * `planeMutationServices` + `requirePlaneMutationServices` (the 6
   * plane mutations, V2-T3.2b) are the members on the `@Remote` call
   * chain; the rest of the class keeps true `#` privacy (its paths run
   * with the real instance receiver).
   */
  private rpc: ResearchRpcServices | undefined

  /** The validated config (WP-2.6: `minDshVersion` is read in `[Service.init]`). */
  readonly #config: Config

  /**
   * @param ctx - the host context that owns this service.
   * @param config - validated plugin config (WP-2.6: `minDshVersion`).
   * @param rpcServices - WP-4.1a test seam: a stub for the RPC service
   *  port (production fibers pass nothing — `[Service.init]` composes
   *  the production implementation over the wiring).
   * @param planeServices - V2-T3.2a test seam: a stub for the PLANE-LEVEL
   *  read-only port (the 3 design §12 rows 1-3 methods; production
   *  fibers pass nothing — `[Service.init]` composes the production
   *  implementation over the discovered plane + the wirings map).
   * @param planeMutationServices - V2-T3.2b test seam: a stub for the
   *  PLANE-LEVEL MUTATION port (the 6 design §12 rows 4-6/8/9 methods;
   *  production fibers pass nothing — `[Service.init]` composes the
   *  production implementation with its re-init hook over the SAME live
   *  plane fields as the read port).
   */
  constructor(
    ctx: Context,
    config: Config,
    rpcServices?: ResearchRpcServices,
    planeServices?: ResearchPlaneServices,
    planeMutationServices?: ResearchPlaneMutationServices,
  ) {
    super(ctx, 'researchControl')
    this.#config = config
    this.rpc = rpcServices
    this.planeServices = planeServices
    this.planeMutationServices = planeMutationServices
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
   * registered DSH workspace with a research tree is swept of stale
   * crash residue — the front-line defense before W9 `git add -- <treeDir>/`
   * (TC-GIT-003) can stage residue into a checkpoint. Per-workspace
   * failures are WARNED, not fatal (boot hygiene; a genuinely unreadable
   * tree fails loudly at load time anyway). V2-T2.2: the sweep follows
   * the CONFIGURED tree name (T2.1 `getResearchDirNames`), so the
   * settings namespace registers BEFORE the sweep (a read before
   * registration would warn about a not-registered section).
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

    // (b) WP-0.4 session adapter + counting subscriptions (unchanged).
    const sessionCtx = this.ctx as SessionHostContext
    this.#sessionAdapter = new HostSessionAdapter(sessionCtx)
    this.#sessionAdapter.observeSessionLifecycle((): void => {
      /* counters only — spike evidence, not business logic */
    })
    this.#sessionAdapter.onSessionEvent((): void => {
      /* counters only — spike evidence, not business logic */
    })

    // (c) V2-T2.1 (design §7.5 / §3.1, Q4): the research settings
    // namespace — the two configurable directory names (treeDir/hubDir,
    // defaults `.research` / `.research-control`) live in the DSH
    // user-settings document. Registered in EVERY mode (spike mode
    // included — the settings card is a global preference the operator
    // configures before any research tree exists). Resilient by
    // construction: read through the optional-service `ctx.get` face
    // (no hard inject), absent service → one warn + defaults (see
    // ./settings.ts module header). V2-T2.2 moved this BEFORE the
    // startup sweep: the sweep and the discovery below read the
    // configured names exclusively through getResearchDirNames (live
    // per rescan — the §7.5 save→rescan transaction), and a read before
    // the namespace is registered would warn about a not-registered
    // section.
    registerResearchSettings(this.ctx)

    // (d) G1 分诊 — startup sweep of stale crash residue (W9 front line).
    // V2-T2.2: the tree name comes from the settings domain (design
    // §3.1: 发现逻辑只认配置后的名字) — a renamed tree is swept too.
    try {
      const registry = (this.ctx as unknown as WorkspaceHostContext).workspaceRegistry
      const treeDir = getResearchDirNames(this.ctx).treeDir
      for (const workspace of registry.list()) {
        const researchRoot = join(workspace.path, treeDir)
        if (!existsSync(researchRoot)) continue
        sweepStaleTmp(researchRoot, (entry) => {
          console.warn(`[research-control] swept stale crash residue: ${entry.path} (${String(entry.size)} bytes)`)
        })
      }
    } catch (cause) {
      console.warn(`[research-control] startup tmp sweep skipped: ${(cause as Error).message}`)
    }

    // (e) V2-T2.2 (design §4 / §13 row 1): the research plane over ALL
    // registered workspaces — hub discovery + registry parse + the
    // dual-source reconciliation (./discovery.ts), one HostWiring + one
    // RPC service port per MANAGED/STANDALONE project. A throw here
    // (≥ 2 hubs, a malformed/absent registry, a project-id conflict, a
    // broken tree, an unusable registry schema, a failed startup
    // reconciliation under `failLoud`) fails the fiber BEFORE ACTIVE —
    // TC-DSH-008 fail-loud; `#initResearchPlane` unwinds the projects it
    // already composed, and the effect registered below disposes the
    // survivors on fiber death.
    const adapter = this.#sessionAdapter
    // WP-4.1a: the frozen schema root is resolved ONCE here — the plane
    // builder and the RPC facade both need it (the declarative schema
    // dir for the tree loader, the plan kernel, and the post-restore
    // validation).
    const schemaRoot = this.#resolveSchemaRoot(import.meta.url)
    const plane = this.#initResearchPlane(adapter, schemaRoot)
    this.plane = plane.plane
    this.projectRpcs = plane.rpcs
    this.projectWirings = plane.wirings
    this.#wiring = plane.wirings.size === 1 ? [...plane.wirings.values()][0]! : undefined
    // V2-T3.2a (design §12 rows 1-3): the PLANE-LEVEL read-only port —
    // one instance for the whole plane (unlike the per-project rpcs map).
    // Composed in EVERY mode (the empty plane included — the 3 read-only
    // RPCs serve the empty plane state: the 引导卡 data of design §6):
    // the getters read the service's live fields, so the T3.2b `rescan`
    // swaps plane/wirings in place and this port sees the fresh state
    // without re-composition. The session face is the adapter's
    // `listSessions` (the §5 role-segment cwd source).
    this.planeServices = new ProductionResearchPlaneServices({
      getPlane: () => this.plane,
      getWirings: () => this.projectWirings,
      dirNames: () => getResearchDirNames(this.ctx),
      sessions: adapter,
      declarativeDir: join(schemaRoot, 'declarative'),
    })
    // V2-T3.2b (design §12 rows 4-6/8/9): the PLANE-LEVEL MUTATION port —
    // the mutation sibling of the read port above: one instance for the
    // whole plane, composed in EVERY mode (the empty plane included — the
    // mutations are the ONBOARDING path: setHub creates the hub on an
    // empty plane, bindProject registers the first project). The same
    // live-field getters as the read port (a re-init swaps the state in
    // place; no re-composition). `reinitPlane` is the module header's
    // post-mutation hook: the FULL `#initResearchPlane` re-run (§4
    // discovery + per-project rewiring), so the NEXT RPC call sees the
    // fresh plane state. `sealStandaloneDb` closes the project's TWO
    // connection owners — the wiring AND the RPC service port (see the
    // seam below) — BEFORE the db file moves (the P2 leftover ordering).
    this.planeMutationServices = new ProductionResearchPlaneMutationServices({
      getPlane: () => this.plane,
      listWorkspacePaths: (): readonly string[] =>
        (this.ctx as unknown as WorkspaceHostContext).workspaceRegistry.list().map((w) => w.path),
      dirNames: () => getResearchDirNames(this.ctx),
      reinitPlane: (): void | Promise<void> => this.#reinitResearchPlane(adapter, schemaRoot),
      sealStandaloneDb: (projectId: string): void => {
        // A project's live sqlite connections have TWO owners: its
        // HostWiring (the store + the second connections) and its RPC
        // service port (the user-surface second connection). Closing
        // EITHER alone leaves the other connection live — and the LAST
        // connection to close the WAL file is what runs the final
        // checkpoint and removes the -wal/-shm sidecars. A live survivor
        // across `migrateDb`'s rename keeps un-checkpointed pages in the
        // stale (source-dir) -wal, so the post-migration re-init gate
        // reads a page absent from the moved file and fails with a
        // "disk I/O error". Close both (idempotent; the RPC port first —
        // the same order as the fiber-death disposer below). A project
        // without a wiring/rpc entry has no live connection to seal.
        this.projectRpcs?.get(projectId)?.close?.()
        this.projectWirings?.get(projectId)?.close()
      },
    })
    if (plane.wirings.size > 0) {
      // ONE disposer for the whole graph (DSH_ADAPTER §9: `[Service.init]`
      // open, `ctx.effect` close — the storage-sqlite register/close
      // pattern). Cordis runs disposers in REVERSE registration order on
      // fiber unmount; each `close()` is idempotent and orders its own
      // teardown internally (a project's RPC port — a second connection —
      // closes before that project's store connection).
      this.ctx.effect(() => {
        const wirings = plane.wirings
        const rpcs = plane.rpcs
        return (): void => {
          for (const service of rpcs.values()) service.close?.()
          for (const wiring of wirings.values()) wiring.close()
          this.projectRpcs = undefined
          this.projectWirings = undefined
          this.plane = undefined
          this.planeServices = undefined
          this.planeMutationServices = undefined
          this.#wiring = undefined
        }
      })
      if (this.#wiring !== undefined) {
        // Single-project plane (the V1 shape): the 11 agent tools + the
        // plugin-OWNED commands bind to the sole wiring — byte-identical
        // registration to V1. (Multi-project planes skip both — see the
        // warn below: their frozen face carries no projectId, so there is
        // no unambiguous routing target until T3.x.)
        this.#registerResearchTools(this.#wiring)
        // WP-7.4 / G7 S1b+S1: the plugin-OWNED one-click + analysis
        // data-face commands on the DSH built-in command registry —
        // registration-as-effect (the disposers unregister on fiber
        // unmount, the 11-tool convention). The client reaches them over
        // the built-in `commands/execute` gateway carrier (NO new RPC —
        // the 13-RPC §7.1 list stays byte-identical; see
        // investigate-command.ts / analysis-commands.ts for the
        // compatibility argument + the §6 U✅/P❌ semantics). A deployment
        // without a command registry (non-web profile) is warned loud:
        // every launch/save attempt still fails loud at use time (IVL_*)
        // — no silent downgrade.
        // LIVE WIRING (the re-init fix): the handlers receive the
        // `() => this.#wiring` getter, NOT the boot-time wiring VALUE —
        // a plane-mutation re-init (`#reinitResearchPlane` after
        // setHub / bindProject / unbindProject / restoreProject / rescan)
        // closes the boot-time wiring and swaps a fresh one in place;
        // a value-capturing handler would then execute on the CLOSED
        // second connections (the 「database is not open」 failure
        // class). Each invocation re-resolves the current wiring;
        // `undefined` (the plane later left the single-project shape)
        // → the channel's clear no-wiring error text.
        const disposeCommand = registerInvestigationCommand(this.ctx, () => this.#wiring)
        const disposeAnalysisCommands = registerAnalysisCommands(this.ctx, () => this.#wiring)
        if (disposeCommand === null || disposeAnalysisCommands === null) {
          console.warn(
            '[research-control] the host exposes no command registry (non-web profile) — ' +
              'the /research-investigate one-click entry and the analysis data-face ' +
              'commands (/research-transient-read, /research-analysis-list, ' +
              '/research-analysis-save) are unavailable (any attempt still fails loud ' +
              'at use time; no degraded launch, no forged data)',
          )
        } else {
          this.ctx.effect(() => disposeCommand)
          this.ctx.effect(() => disposeAnalysisCommands)
          console.log(
            `[research-control] registered the one-click + analysis commands (project ${this.#wiring.projectId}: /research-investigate / /research-transient-read / /research-analysis-list / /research-analysis-save)`,
          )
        }
      } else {
        // Multi-project plane: no unambiguous binding target for the
        // frozen tool/command face (design §12.1 — the 11 tools' frozen
        // parameters carry no projectId; their multi-project face is a
        // T3.x design decision). The 13 RPCs, however, ROUTE: V2-T3.2a
        // wired the §12.1 resolution into `requireRpc` (explicit
        // projectId → the project; omitted → the sole active project;
        // omitted + several → a clear error listing the projects). Warn
        // loud about the tool/command surfaces only (no silent
        // downgrade, no forged routing).
        console.warn(
          `[research-control] the plane has ${String(plane.wirings.size)} projects ` +
            `(${[...plane.wirings.keys()].join(', ')}) — the 11 agent tools and the ` +
            'investigate/analysis commands are NOT registered this round: their frozen ' +
            'face carries no projectId, so there is no unambiguous routing target ' +
            '(design §12.1); the 13 RPCs route through their optional projectId ' +
            '(omitted + several active projects → a clear error listing the projects)',
        )
      }
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
   * WP-4.1a: the 13-RPC client face (ARCHITECTURE.md §7.1)
   *
   * Every body is THIN: zod decode (the shared strict schema — the
   * strict `./typert` descriptor already parsed the wire args on the
   * gateway's strict path; this second parse is the defense for the SRC
   * fallback path, which carries no codec) → forward to the injected
   * `ResearchRpcServices` port. No business logic here (red line).
   * ---------------------------------------------------------------- */

  @Remote('getDashboard')
  async getDashboard(): Promise<DashboardSnapshot> {
    // V2-T3.2a (design §12.1): the zero-arg queries keep their frozen
    // wire face (no projectId field) — the routing is the omitted-id
    // rule (single active project → it; several → a clear error).
    return this.requireRpc().getDashboard()
  }

  @Remote('getProject')
  async getProject(): Promise<ProjectSnapshot> {
    // V2-T3.2a (design §12.1): zero-arg frozen wire face — the omitted-
    // id routing rule (see getDashboard).
    return this.requireRpc().getProject()
  }

  @Remote('getTopic')
  async getTopic(args: unknown): Promise<TopicSnapshot> {
    // V2-T3.2a (design §12.1): decode FIRST, then route on the decoded
    // optional `projectId` (requireRpc is the single routing point — an
    // omitted id keeps the V1 single-project default behavior).
    const decoded = GetTopicArgsSchema.parse(args) satisfies GetTopicArgs
    return this.requireRpc(decoded.projectId).getTopic(decoded)
  }

  @Remote('getWorkstream')
  async getWorkstream(args: unknown): Promise<WorkstreamSnapshot> {
    const decoded = GetWorkstreamArgsSchema.parse(args) satisfies GetWorkstreamArgs
    return this.requireRpc(decoded.projectId).getWorkstream(decoded)
  }

  @Remote('queryHistory')
  async queryHistory(args: unknown): Promise<QueryHistoryResult> {
    const decoded = QueryHistoryArgsSchema.parse(args) satisfies QueryHistoryArgs
    return this.requireRpc(decoded.projectId).queryHistory(decoded)
  }

  @Remote('reorderPlan')
  async reorderPlan(args: unknown): Promise<ReorderPlanResult> {
    const decoded = ReorderPlanArgsSchema.parse(args) satisfies ReorderPlanArgs
    return this.requireRpc(decoded.projectId).reorderPlan(decoded)
  }

  @Remote('selectPlanFork')
  async selectPlanFork(args: unknown): Promise<SelectPlanForkResult> {
    const decoded = SelectPlanForkArgsSchema.parse(args) satisfies SelectPlanForkArgs
    return await this.requireRpc(decoded.projectId).selectPlanFork(decoded)
  }

  @Remote('dismissPlanFork')
  async dismissPlanFork(args: unknown): Promise<DismissPlanForkResult> {
    const decoded = DismissPlanForkArgsSchema.parse(args) satisfies DismissPlanForkArgs
    return await this.requireRpc(decoded.projectId).dismissPlanFork(decoded)
  }

  @Remote('updateInterventionState')
  async updateInterventionState(args: unknown): Promise<UpdateInterventionStateResult> {
    const decoded = UpdateInterventionStateArgsSchema.parse(args) satisfies UpdateInterventionStateArgs
    return this.requireRpc(decoded.projectId).updateInterventionState(decoded)
  }

  @Remote('registerInteraction')
  async registerInteraction(args: unknown): Promise<RegisterInteractionResult> {
    const decoded = RegisterInteractionArgsSchema.parse(args) satisfies RegisterInteractionArgs
    return await this.requireRpc(decoded.projectId).registerInteraction(decoded)
  }

  @Remote('saveResearchCheckpoint')
  async saveResearchCheckpoint(args: unknown): Promise<SaveResearchCheckpointResult> {
    const decoded = SaveResearchCheckpointArgsSchema.parse(args) satisfies SaveResearchCheckpointArgs
    return await this.requireRpc(decoded.projectId).saveResearchCheckpoint(decoded)
  }

  @Remote('getGitHistory')
  async getGitHistory(args: unknown): Promise<GetGitHistoryResult> {
    const decoded = GetGitHistoryArgsSchema.parse(args) satisfies GetGitHistoryArgs
    return await this.requireRpc(decoded.projectId).getGitHistory(decoded)
  }

  @Remote('restoreDeclarativeFile')
  async restoreDeclarativeFile(args: unknown): Promise<RestoreDeclarativeFileResult> {
    const decoded = RestoreDeclarativeFileArgsSchema.parse(args) satisfies RestoreDeclarativeFileArgs
    return await this.requireRpc(decoded.projectId).restoreDeclarativeFile(decoded)
  }

  /* ---------------------------------------------------------------- *
   * V2-T3.2a: the plane-level read-only face (design §12 rows 1-3)
   *
   * The 3 plane reads are NOT routed (they serve the WHOLE plane — the
   * cross-project views of design §5/§7.1/§7.2): every body is THIN
   * (zod decode → forward to the plane port, red line unchanged). The
   * empty plane serves too (the 引导卡 data of design §6); only the
   * frozen 13 fail loud pre-init (their per-project ports require an
   * active project).
   * ---------------------------------------------------------------- */

  @Remote('getResearchPlaneState')
  async getResearchPlaneState(args: unknown): Promise<GetResearchPlaneStateResult> {
    return this.requirePlaneServices().getResearchPlaneState(
      GetResearchPlaneStateArgsSchema.parse(args) satisfies GetResearchPlaneStateArgs,
    )
  }

  @Remote('getHubOverview')
  async getHubOverview(args: unknown): Promise<HubOverviewResult> {
    return await this.requirePlaneServices().getHubOverview(
      GetHubOverviewArgsSchema.parse(args) satisfies GetHubOverviewArgs,
    )
  }

  @Remote('getPortfolioInterventions')
  async getPortfolioInterventions(args: unknown): Promise<GetPortfolioInterventionsResult> {
    return this.requirePlaneServices().getPortfolioInterventions(
      GetPortfolioInterventionsArgsSchema.parse(args) satisfies GetPortfolioInterventionsArgs,
    )
  }

  /* ---------------------------------------------------------------- *
   * V2-T3.2b: the plane-level mutation face (design §12 rows 4-6/8/9)
   *
   * The 6 plane mutations are PLANE-LEVEL — NOT project-routed (the
   * §12.1 resolution does not apply: they act on the hub / the whole
   * plane, not on one project): every body is THIN (zod decode →
   * forward to the plane-mutation port, red line unchanged). The EMPTY
   * plane is callable too — that IS the onboarding path (design §8
   * 设为中枢 / 接入: setHub on an empty plane, then bindProject). A
   * successful mutation re-runs `#initResearchPlane` through the port's
   * re-init hook, so the NEXT RPC call sees the fresh plane state.
   * ---------------------------------------------------------------- */

  @Remote('setHub')
  async setHub(args: unknown): Promise<SetHubResult> {
    return await this.requirePlaneMutationServices().setHub(
      SetHubArgsSchema.parse(args) satisfies SetHubArgs,
    )
  }

  @Remote('bindProject')
  async bindProject(args: unknown): Promise<BindProjectResult> {
    return await this.requirePlaneMutationServices().bindProject(
      BindProjectArgsSchema.parse(args) satisfies BindProjectArgs,
    )
  }

  @Remote('unbindProject')
  async unbindProject(args: unknown): Promise<UnbindProjectResult> {
    return await this.requirePlaneMutationServices().unbindProject(
      UnbindProjectArgsSchema.parse(args) satisfies UnbindProjectArgs,
    )
  }

  @Remote('restoreProject')
  async restoreProject(args: unknown): Promise<RestoreProjectResult> {
    return await this.requirePlaneMutationServices().restoreProject(
      RestoreProjectArgsSchema.parse(args) satisfies RestoreProjectArgs,
    )
  }

  @Remote('rescan')
  async rescan(args: unknown): Promise<RescanResult> {
    return await this.requirePlaneMutationServices().rescan(
      RescanArgsSchema.parse(args) satisfies RescanArgs,
    )
  }

  @Remote('ackMissingReminder')
  async ackMissingReminder(args: unknown): Promise<AckMissingReminderResult> {
    return await this.requirePlaneMutationServices().ackMissingReminder(
      AckMissingReminderArgsSchema.parse(args) satisfies AckMissingReminderArgs,
    )
  }

  /* ------------------------------------------------------------------ *
   * UI-0.4 — the GUI management face (D §7.2, incremental — slice 1:
   * Current Focus, R-01; slice 2: the hierarchy create pair, Task 3).
   * Same decode-first + requireRpc routing as the frozen 13; the USER
   * lane is the RPC face itself (R-01: no actor parameter).
   *
   * §7.3 conformance audit (per-method hop map — comments only; the
   * bodies below are exactly the frozen-13 idiom):
   *
   *   1. DECODE (strict, FIRST): <Method>ArgsSchema.parse(args) — the
   *      wire delivers `unknown`; a shape fault folds into the gateway
   *      ok:false carrier before any project work (the frozen schemas
   *      are the only decode; no per-method hand-rolled checks).
   *   2. ROUTE: requireRpc(decoded.projectId) — the §12.1 rule (explicit
   *      id -> that project, absent / not active -> clear error; omitted
   *      -> the single active project, several -> clear error). Selects
   *      the PER-PROJECT wiring (db handle + composed services) for the
   *      remaining hops.
   *   3. SEMANTICS (service-owned, rpc-services.ts — gates run BEFORE
   *      any write; each returns the frozen result DTO, change facts
   *      only, no snapshots / no host-internal state):
   *        - setCurrentFocus  : CF_INPUT shape gate -> canonical
   *          membership gate -> UPSERT (the R-01 pointer row); faults
   *          ride the `#mapCurrentFocusError` [research-control]
   *          carrier (CF_* codes).
   *        - getCurrentFocus  : the same mapping (BL-03 mirror of the
   *          set path); the store get is a fresh SQL SELECT per call —
   *          a preference cache by design, no host-side cache.
   *        - createTopic      : the HIER_TOPIC_EXISTS probe -> the
   *          atomic write; faults ride `#mapHierarchyError`.
   *        - createWorkstream : the topic membership gate
   *          (HIER_TOPIC_NOT_FOUND) BEFORE any allocation / write ->
   *          the atomic write; same carrier.
   *   4. INVALIDATION: a DOCUMENTED NO-OP ON THE HOST — there is no
   *      host-side invalidation bus and nothing host-side to invalidate:
   *      every read is a FRESH load (rpc-services.ts §27 header: "the
   *      file is the truth, no cache"; getWorkstream re-runs #loadTree
   *      per call; getCurrentFocus is a fresh SQL SELECT), so a
   *      committed write is observable on the VERY NEXT read.
   *      Client-side invalidation is the client store's
   *      INVALIDATE_REGISTRY refetch pass (client/stores/registry.ts)
   *      — a client hop, not a host one.
   * ------------------------------------------------------------------ */

  @Remote('setCurrentFocus')
  async setCurrentFocus(args: unknown): Promise<SetCurrentFocusResult> {
    const decoded = SetCurrentFocusArgsSchema.parse(args) satisfies SetCurrentFocusArgs
    return this.requireRpc(decoded.projectId).setCurrentFocus(decoded)
  }

  @Remote('getCurrentFocus')
  async getCurrentFocus(args: unknown): Promise<GetCurrentFocusResult> {
    const decoded = GetCurrentFocusArgsSchema.parse(args) satisfies GetCurrentFocusArgs
    return this.requireRpc(decoded.projectId).getCurrentFocus(decoded)
  }

  @Remote('createTopic')
  async createTopic(args: unknown): Promise<CreateTopicResult> {
    const decoded = CreateTopicArgsSchema.parse(args) satisfies CreateTopicArgs
    return this.requireRpc(decoded.projectId).createTopic(decoded)
  }

  @Remote('createWorkstream')
  async createWorkstream(args: unknown): Promise<CreateWorkstreamResult> {
    const decoded = CreateWorkstreamArgsSchema.parse(args) satisfies CreateWorkstreamArgs
    return this.requireRpc(decoded.projectId).createWorkstream(decoded)
  }

  /**
   * The plane-mutation port guard (V2-T3.2b — the mutation twin of
   * {@link requirePlaneServices}): a constructor-injected stub (TESTS
   * only) always wins; pre-init (plane not discovered yet) fails loud
   * (the gateway carries the message as an `ok: false` failure; `ping`
   * still serves). The mutation port is composed in EVERY init mode
   * (the empty plane included — it is the onboarding face), so a
   * non-undefined field always has a usable target once init has run.
   */
  private requirePlaneMutationServices(): ResearchPlaneMutationServices {
    const stub = this.planeMutationServices
    if (stub === undefined) {
      throw new Error(
        'the research control plane is not initialized (spike mode) — the plane mutation RPCs ' +
          'require [Service.init] (the discovered plane state); ping stays available',
      )
    }
    return stub
  }

  /**
   * The plane-read port guard (V2-T3.2a — the plane-level twin of
   * {@link requireRpc}): a constructor-injected stub (TESTS only) always
   * wins; pre-init (plane not discovered yet) fails loud (the gateway
   * carries the message as an `ok: false` failure; `ping` still serves).
   * The plane port is composed in EVERY init mode (the empty plane
   * included — it serves the empty aggregates), so a non-undefined
   * field always has a usable target once init has run.
   */
  private requirePlaneServices(): ResearchPlaneServices {
    const stub = this.planeServices
    if (stub === undefined) {
      throw new Error(
        'the research control plane is not initialized (spike mode) — the plane RPCs require ' +
          '[Service.init] (the discovered plane state); ping stays available',
      )
    }
    return stub
  }

  /**
   * The RPC port guard + §12.1 routing (V2-T2.2):
   *  - a constructor-injected stub (TESTS only) always wins — the
   *    existing rpc-face suite constructs the service without running
   *    `[Service.init]` and forwards to the stub;
   *  - pre-init (plane not discovered yet) or an empty plane (no
   *    MANAGED/STANDALONE project — the V1 spike mode) ⇒ the 13 methods
   *    fail loud with the spike-mode message (the gateway carries it to
   *    the client as an `ok: false` failure; `ping` still serves — the
   *    WP-0.3 spike-mode contract);
   *  - otherwise the target project is resolved per design §12.1
   *    ({@link resolveProject}): the 11 parameterized RPCs decode their
   *    args first and pass the optional `projectId` (V2-T3.2a: the §12.1
   *    contract field, T3.1) — explicit id → that project (absent or
   *    not-active, e.g. a MISSING or archived registration → a clear
   *    error); omitted → the sole MANAGED/STANDALONE project (the V1
   *    implicit behavior — byte-identical RPC results on a
   *    single-project plane); omitted + several → a clear error listing
   *    every project id (never guess). The two zero-arg queries
   *    (getDashboard/getProject) keep their frozen wire face (no
   *    `projectId` field — §12.1: the result shapes and the zero-arg
   *    request shapes stay untouched) and route through the same
   *    omitted-id rule.
   */
  private requireRpc(projectId?: string): ResearchRpcServices {
    const stub = this.rpc
    if (stub !== undefined) return stub
    const plane = this.plane
    const rpcs = this.projectRpcs
    if (plane === undefined || rpcs === undefined || rpcs.size === 0) {
      throw new Error(
        'the research control plane is not initialized (spike mode) — the 13 RPCs require an ' +
          'active project (a hub-registered or standalone research tree; discovery found none) ' +
          '— ping stays available',
      )
    }
    const project = resolveProject(plane, projectId)
    const service = rpcs.get(project.projectId)
    if (service === undefined) {
      // Defensive: after a successful init every plane project has its
      // RPC port (both maps are filled together in #initResearchPlane).
      throw new Error(
        `internal invariant broken: project ${project.projectId} has no RPC service ` +
          '(init must compose one ProductionResearchRpcServices per plane project)',
      )
    }
    return service
  }

  /* ---------------------------------------------------------------- *
   * WP-3.6: the research plane (host service wiring)
   * ---------------------------------------------------------------- */

  /**
   * The plane-mutation RE-INIT hook (V2-T3.2b — the module header's
   * 「the re-init hook」 of plane-mutation-services.ts, composed on the
   * port's `reinitPlane` option in `[Service.init]`): re-runs the FULL
   * {@link #initResearchPlane} — §4 discovery AND the per-project
   * rewiring — and swaps the fresh state IN PLACE, so the NEXT RPC call
   * (any of the 22) reads the fresh `plane` / `projectWirings` /
   * `projectRpcs` fields (the read port's lazy getters see them too —
   * no re-composition, the T3.2a comment's contract).
   *
   * Ordering (the reinitPlane contract — 「on throw the previous state
   * is left in place and the throw rejects the mutation」): the FRESH
   * plane is composed FIRST — `#initResearchPlane` builds brand-new
   * wirings/rpcs maps without touching the current ones, so a throw
   * (e.g. the operator created a second hub on disk between the
   * mutation's commit and its re-init) rejects the mutation with the
   * previous plane fully in place (the mutation's disk state is already
   * committed; the stale state is repairable by a later rescan). Only
   * after success are the previous plane's resources torn down — RPC
   * ports before store connections, the fiber-unmount order (every
   * `close()` is idempotent) — and the fields swapped.
   *
   * Known boundary (the T3.x tool-face decision, design §13): the 11
   * agent tools register ONCE in `[Service.init]` and capture their
   * data-face closures from that wiring; a re-init that replaces the
   * sole wiring (e.g. a rescan on a single-project plane) leaves the
   * registered tool closures on the closed old wiring while
   * `#runResearchTool` resolves the actor against the NEW `#wiring`
   * (fail-loud at use time, no silent data path — the db-adapter's
   * closed-connection guard turns such a call into the actionable
   * `WIRING_CLOSED` message instead of a raw driver error). Tool
   * re-registration is a T3.x scope, like the tools' multi-project
   * face.
   *
   * The user-facing COMMAND channels are NOT on this stale side: the
   * one-click (`/research-investigate`) and the three analysis
   * data-face commands register ONCE too, but their handlers re-resolve
   * the wiring LIVE on every invocation (the `() => this.#wiring`
   * getter — the same discipline as `requireRpc` / `#runResearchTool`),
   * so a re-init NEVER strands them on the closed old wiring: the
   * single-project plane keeps them working against the fresh wiring,
   * and a plane that leaves the single-project shape fails loud with
   * the channel's no-wiring text (investigate-command.ts /
   * analysis-commands.ts).
   */
  async #reinitResearchPlane(adapter: HostSessionAdapter, schemaRoot: string): Promise<void> {
    const fresh = this.#initResearchPlane(adapter, schemaRoot)
    if (this.projectRpcs !== undefined) {
      for (const service of this.projectRpcs.values()) service.close?.()
    }
    if (this.projectWirings !== undefined) {
      for (const wiring of this.projectWirings.values()) wiring.close()
    }
    this.plane = fresh.plane
    this.projectRpcs = fresh.rpcs
    this.projectWirings = fresh.wirings
    this.#wiring = fresh.wirings.size === 1 ? [...fresh.wirings.values()][0]! : undefined
  }

  /**
   * Build the research plane (V2-T2.2 — design §4 全文 + §13 row 1):
   * scan every registered DSH workspace's root level for the configured
   * `<hubDir>`/`<treeDir>` (T2.1 names), enforce exactly-one-hub loud
   * (TC-DSH-008), parse the hub's `registry.yaml` (T2.3 kernel —
   * malformed ⇒ fail-loud), and reconcile registry entries against the
   * discovered trees ({@link discoverPlane}):
   *
   *   registered entry ∧ tree  → MANAGED (wired)
   *   no entry ∧ tree          → STANDALONE (wired + a log warning —
   *                              静默，不弹窗: the log line IS the record)
   *   active entry ∧ no tree   → MISSING (NOT wired — a log warning:
   *                              挂起，等待用户处置; the four-choice
   *                              disposition UI lands with T3.x)
   *
   * One `HostWiring` (the unchanged `createHostWiring` single-project
   * construction) + one `ProductionResearchRpcServices` are built per
   * MANAGED/STANDALONE project — `Map<projectId, …>` (the §12.1 routing
   * map). V2-T2.4 (design §3.3): each project's data dir is RESOLVED
   * by kind through the storage-locations layer (`resolveDbDir`):
   * MANAGED `<hub>/<hubDir>/projects/<id>/`, STANDALONE
   * `<ws>/<treeDir>/state/` (auto-created here; the store re-enforces
   * the owner-only mode on open). The V1 `$DSH_HOME` data-dir layout
   * is retired — a surviving legacy layout logs ONE warn line via
   * `hintOldDbHome` (a migration suggestion, no automatic move —
   * design §14). The startup logging runs here (design §4 静默
   * 口径: MISSING one warn line each — displayName + path + 等待用户处置;
   * STANDALONE one warn line each; 0 hub ∧ 0 tree → one empty-plane
   * warn, the V1 spike mode in the multi-project vocabulary).
   *
   * @returns the composed plane (empty maps on the empty/spike plane —
   *  the V1 `undefined` is now a shape: `plane.plane.hub === null` with
   *  no projects, so the T3.1 `getResearchPlaneState` serves one state
   *  type for every mode).
   * @throws {DiscoverError} on the §4 fail-loud points (≥ 2 hubs, a
   *  malformed/absent registry, a project-id conflict, duplicate ids) —
   *  the fiber fails before ACTIVE.
   * @throws {HostWiringError} on any per-project wiring failure
   *  (broken tree, unusable registry schema, reconciliation under
   *  `failLoud`) — the already-composed projects are unwound first
   *  (a failed init leaks nothing), then the fiber fails before ACTIVE.
   */
  #initResearchPlane(adapter: HostSessionAdapter, schemaRoot: string): PlaneInitResult {
    const registry = (this.ctx as unknown as WorkspaceHostContext).workspaceRegistry
    const workspaces = registry.list()
    // Design §4 step 1: the directory names come exclusively from the
    // settings domain (T2.1 — live read, no hardcoded literal).
    const dirNames = getResearchDirNames(this.ctx)

    // Design §4 step 2: the root-level scan. The probe also reads each
    // discovered tree's project id (the routing key + the §3.2 cross-
    // check operand) — a tree without a usable id fails loud here
    // (WIRING_INPUT, the V1 single-workspace behavior, unchanged).
    const probed = probeWorkspaces(workspaces.map((w) => w.path), dirNames)
    const hubCandidates = probed.filter((p) => p.hasHubDir)

    // Design §4 steps 3-4: the hub's registry is the ONE file discovery
    // reads from disk (its `<hubDir>` presence is what made the
    // workspace a hub, so the read belongs to the I/O seam — the pure
    // core receives the text). A two-hub plane already failed loud
    // inside discoverPlane, so only the exactly-one-hub case reads.
    let registryText: string | null = null
    if (hubCandidates.length === 1) {
      const hubPath = hubCandidates[0]!.path
      const registryPath = join(hubPath, dirNames.hubDir, 'registry.yaml')
      try {
        registryText = readFileSync(registryPath, 'utf8')
      } catch (cause) {
        throw new DiscoverError(
          'REGISTRY_ABSENT',
          `[research-control] the hub workspace ${hubPath} carries ${dirNames.hubDir}/ but its ` +
            `registry file is missing or unreadable: ${registryPath} — a hub without ` +
            `${join(dirNames.hubDir, 'registry.yaml')} is incomplete (create the registry through ` +
            'the settings plane, or remove the ' +
            `${dirNames.hubDir} directory); refusing to start (TC-DSH-008): ` +
            (cause instanceof Error ? cause.message : String(cause)),
        )
      }
    }

    // Design §4 step 5/6: reconcile into the plane state.
    const planeState = discoverPlane(probed, dirNames, registryText)

    // Startup logging (design §4 静默口径: 不弹窗但日志在场 — the
    // disposition UI is T3.x; at boot the log IS the record).
    if (planeState.hub !== null) {
      const managed = planeState.projects.filter((p) => p.kind === 'MANAGED').length
      const standalone = planeState.projects.length - managed
      console.log(
        `[research-control] research hub discovered at ${planeState.hub.path} — plane: ` +
          `${String(managed)} managed, ${String(standalone)} standalone, ${String(planeState.missing.length)} missing ` +
          `(of ${String(workspaces.length)} registered workspaces)`,
      )
    }

    // Design §3.3 (V2-T2.4): the V1 $DSH_HOME/research-control/<id>/ data-dir
    // layout is RETIRED — one startup warn line when the legacy layout is
    // still present (a migration SUGGESTION: the operator moves the data by
    // hand; the plugin NEVER migrates it automatically — design §14).
    // resolveDshHome is the ONE remaining dsh-home-paths read in this file
    // (INV-PERM-5: this file is the exempt zone). A probe failure must not
    // take down the plane (warn and continue — the hint is a courtesy, the
    // layout itself is inert under V2).
    try {
      const legacyHint = hintOldDbHome(resolveDshHome(), nodeFsStorageIo())
      if (legacyHint !== null) console.warn(legacyHint)
    } catch (cause) {
      console.warn(
        `[research-control] the legacy $DSH_HOME database layout probe failed: ` +
          (cause instanceof Error ? cause.message : String(cause)),
      )
    }
    if (planeState.projects.length === 0 && planeState.missing.length === 0) {
      // The empty plane (design §6 引导卡 state): no project to serve.
      // The 9 plane RPCs still answer (the 引导卡 data source); the
      // tools are NOT registered (single-project planes only) and the
      // 13 per-project RPCs fail loud until a project exists.
      // The wording must not lie: when a hub WAS discovered (with an
      // empty registry) the hub-discovered log line above already
      // recorded it — say the registry is empty, not that no hub exists.
      const situation =
        planeState.hub === null
          ? `no registered workspace carries a ${dirNames.treeDir} tree and no ${dirNames.hubDir} hub was discovered`
          : `the discovered hub's registry declares no project (no ${dirNames.treeDir} tree was discovered in any registered workspace)`
      const remedy =
        planeState.hub === null
          ? 'bind a project or create a hub through the settings plane'
          : 'register a project through the settings plane'
      console.warn(
        `[research-control] ${situation} — the plane has no project: the tools are ` +
          `NOT registered (single-project planes only) and the 13 per-project RPCs ` +
          `fail loud until a project exists (${remedy}); the 9 plane RPCs still serve ` +
          `the empty plane state (the design §6 引导卡 data source — the 研究 tab ` +
          `renders its boot state from it)`,
      )
    }
    for (const project of planeState.projects) {
      if (project.kind !== 'STANDALONE') continue
      console.warn(
        `[research-control] standalone research tree at ${project.wsPath} (project ` +
          `${project.projectId}) — the tree is not registered in a hub (no registry entry at ` +
          'this path) — running standalone; silent by design (no popup, this log line is the ' +
          'record); register it through the settings plane to move it under the hub',
      )
    }
    for (const entry of planeState.missing) {
      console.warn(
        `[research-control] MISSING registered project ${entry.id} (${entry.displayName}) — its ` +
          `${dirNames.treeDir} tree was not discovered at ${entry.path} — awaiting user disposition ` +
          '(restore data / re-initialize / unbind / defer — the settings plane, T3.x)',
      )
    }

    // One HostWiring + one RPC service port per MANAGED/STANDALONE
    // project (create.ts keeps its single-project construction — this
    // loop is the multi-project seam).
    const wirings = new Map<string, HostWiring>()
    const rpcs = new Map<string, ResearchRpcServices>()
    const logger: HostWiringLogger = {
      info: (step, message) => console.log(`[research-control][${step}] ${message}`),
      warn: (step, message) => console.warn(`[research-control][${step}] ${message}`),
      error: (step, message) => console.error(`[research-control][${step}] ${message}`),
    }
    // WP-7.4 / G7 S1a: the production investigator launcher port — the
    // ONE DSH-touching half (see the adapter module doc). Stateless over
    // ctx (reads `agents` through `ctx.get` at launch time) — one
    // instance shared by every project wiring.
    const launcherAdapter = new HostAgentLauncherAdapter(this.ctx as unknown as LauncherHostContext)
    try {
      for (const project of planeState.projects) {
        // Design §3.3 (V2-T2.4): the database follows the project — the
        // data dir is RESOLVED by kind through the pure storage-locations
        // layer (the V1 $DSH_HOME/research-control/<id> layout is retired;
        // its surviving dirs get the one-time startup hint above, no
        // automatic migration — design §14):
        //   MANAGED    → <hub>/<hubDir>/projects/<projectId>/
        //   STANDALONE → <ws>/<treeDir>/state/   (库目录自动创建; the
        //   db itself is opened by the wiring's store). Owner-only mode:
        //   the store enforces 0o700 only on dirs IT creates
        //   (DSH_ADAPTER §9); this call pre-creates the dir (and missing
        //   ancestors), so it must set the mode itself — `recursive`
        //   applies it to every dir created, a pre-existing dir is left
        //   at its current mode (the store's pre-existing-parent rule).
        const dataDir = resolveDbDir({
          kind: project.kind,
          projectId: project.projectId,
          hubPath: planeState.hub?.path ?? null,
          wsPath: project.wsPath,
          hubDir: dirNames.hubDir,
          treeDir: dirNames.treeDir,
        })
        mkdirSync(dataDir, { recursive: true, mode: 0o700 })
        const wiring = createHostWiring({
          repoRoot: project.wsPath,
          schemaRoot,
          projectId: project.projectId,
          dataDir,
          // T2.1 §7.5 (V2-T6.1-r1): the per-project wiring must locate the
          // tree under the CONFIGURED name — without it the wiring defaults
          // to `.research` and a renamed tree (the settings save's whole
          // point) fails the WIRING_INPUT guard on the next re-init
          // (rescan / restart) even though discovery found the tree.
          researchDir: dirNames.treeDir,
          adapter,
          launcherAdapter,
          workspaceRoots: workspaces.map((w) => w.path),
          logger,
          // Reconciliation policy: the default `rebuild` (reconstruct a
          // missing run row from the durable events; fail loud only when
          // impossible) — DSH_ADAPTER §13-U9 + the WP-2.4 未决 2 scheme.
          // `failLoud` stays an operator override for the
          // `reconcileRuns` HostWiringOptions field.
        })
        wirings.set(project.projectId, wiring)
        // The per-project RPC service port (the §12.1 routing map value
        // — one user-surface second connection per project, disposed
        // before that project's store connection on fiber unmount).
        rpcs.set(project.projectId, new ProductionResearchRpcServices({ wiring, schemaRoot }))
      }
    } catch (cause) {
      // A failed init leaks nothing: the failed project's own partial
      // resources are unwound by createHostWiring itself; close the
      // projects already composed (RPC port before store connection,
      // per project), then rethrow (fiber FAILED before ACTIVE).
      for (const service of rpcs.values()) service.close?.()
      for (const wiring of wirings.values()) wiring.close()
      throw cause
    }
    return { plane: planeState, wirings, rpcs }
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
          // Deep-cloned AND projected into the pinned host's supported
          // JSON-Schema subset (projectNodeToDshSubset): the plugin mirror is
          // a static readonly object the host must never observe (or mutate),
          // and the mirror's raw vocabulary is a superset of the host subset
          // (bare const/enum, pattern) — the projection is host-authoritative
          // (the parameters conversion beside it is the same seam).
          schema: projectNodeToDshSubset(structuredClone(def.output.schema)) as unknown as ToolDefinition['output']['schema'],
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

/**
 * The raw JSON-Schema subset the pinned host (`@deepseek-ai/dsh-tools`
 * `assertSupportedJsonSchema`, enforced on `output.schema` at register)
 * accepts: the constraint keywords `type/oneOf/properties/required/
 * additionalProperties/items/enum/const` plus the annotation keywords
 * `description/title/default/examples` — NOTHING else. Additionally:
 * `enum`/`const` (oneOf siblings) REQUIRE `type` or `oneOf` on the same
 * node, `additionalProperties` must be a boolean, `required` an array of
 * strings on an object, and oneOf siblings are forbidden beside `oneOf`.
 *
 * The WP-3.3 11-tool face (`src/host/tools/*.ts`) declares its output
 * schemas in the plugin's RAW-JSON-Schema vocabulary — a SUPERSET of the
 * host subset (bare `const`/`enum` without a sibling `type`, `pattern`).
 * This projector is the host-authoritative registration-seam step (the same
 * philosophy as the `parameters` conversion beside it): it rewrites a deep
 * CLONE of the output schema so the pinned host accepts it, while the frozen
 * tool-face objects (and their pinned tests) stay byte-identical:
 *   - unsupported keys (e.g. `pattern`) are DROPPED;
 *   - bare `const`/`enum` nodes gain a `type` inferred from the value(s);
 *   - a per-property boolean `required` on a non-object node is DROPPED;
 *   - oneOf siblings are dropped beside `oneOf`.
 */
const DSH_SUBSET_CONSTRAINT_KEYWORDS = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
])
const DSH_SUBSET_ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples'])

function inferScalarType(value: unknown): string | undefined {
  if (value === null) return 'null'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (typeof value === 'boolean') return 'boolean'
  return undefined
}

function projectNodeToDshSubset(node: unknown): unknown {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (DSH_SUBSET_CONSTRAINT_KEYWORDS.has(key) || DSH_SUBSET_ANNOTATION_KEYWORDS.has(key)) {
      out[key] = value
    }
    // any other key is not supported by the pinned host — dropped
  }
  if (Array.isArray(out['oneOf'])) {
    for (const key of ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const']) {
      delete out[key]
    }
  }
  const type = out['type']
  if (typeof out['required'] === 'boolean' && type !== 'object') {
    delete out['required']
  }
  const hasType = typeof type === 'string'
  const hasOneOf = Array.isArray(out['oneOf'])
  if (!hasType && !hasOneOf) {
    if ('const' in out) {
      const inferred = inferScalarType(out['const'])
      if (inferred !== undefined) out['type'] = inferred
    } else if (Array.isArray(out['enum']) && out['enum'].length > 0) {
      const inferred = inferScalarType(out['enum'][0])
      if (inferred !== undefined) out['type'] = inferred
    }
  }
  if (out['properties'] !== undefined && typeof out['properties'] === 'object' && out['properties'] !== null) {
    const props = out['properties'] as Record<string, unknown>
    for (const [k, v] of Object.entries(props)) props[k] = projectNodeToDshSubset(v)
  }
  if (out['items'] !== undefined) out['items'] = projectNodeToDshSubset(out['items'])
  if (Array.isArray(out['oneOf'])) out['oneOf'] = out['oneOf'].map((b) => projectNodeToDshSubset(b))
  return out
}

export default ResearchControlService
