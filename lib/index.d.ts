import { $ as RestoreDeclarativeFileResult, A as GetPortfolioInterventionsResult, B as PingResult, C as DropWorkstreamResult, Ct as UpdateWorkstreamResult, D as GetGitHistoryResult, E as GetGitHistoryArgs, F as GetWorkstreamCurrentArgs, G as QueryHistoryResult, H as PromoteNextActionArgs, I as GetWorkstreamCurrentResult, J as ReorderPlanArgs, K as RegisterInteractionArgs, L as HubOverviewResult, M as GetResearchPlaneStateResult, N as GetTopicArgs, O as GetHubOverviewArgs, P as GetWorkstreamArgs, Q as RestoreDeclarativeFileArgs, S as DropWorkstreamArgs, St as UpdateWorkstreamArgs, T as GetCurrentFocusResult, U as PromoteNextActionResult, V as ProjectSnapshot, W as QueryHistoryArgs, X as RescanArgs, Y as ReorderPlanResult, Z as RescanResult, _ as DashboardSnapshot, _t as UpdateObjectiveResult, a as ClearBlockerArgs, at as SelectPlanForkResult, b as DismissPlanForkArgs, bt as UpdateTopicArgs, c as CreateBlockerResult, ct as SetHubArgs, d as CreateNextActionArgs, et as RestoreProjectArgs, f as CreateNextActionResult, ft as UnbindProjectArgs, g as CreateWorkstreamResult, gt as UpdateObjectiveArgs, h as CreateWorkstreamArgs, ht as UpdateInterventionStateResult, i as BindProjectResult, it as SelectPlanForkArgs, j as GetResearchPlaneStateArgs, k as GetPortfolioInterventionsArgs, lt as SetHubResult, m as CreateTopicResult, mt as UpdateInterventionStateArgs, n as AckMissingReminderResult, nt as SaveResearchCheckpointArgs, o as ClearBlockerResult, ot as SetCurrentFocusArgs, p as CreateTopicArgs, pt as UnbindProjectResult, q as RegisterInteractionResult, r as BindProjectArgs, rt as SaveResearchCheckpointResult, s as CreateBlockerArgs, st as SetCurrentFocusResult, t as AckMissingReminderArgs, tt as RestoreProjectResult, u as CreateLocalResearchProjectResult, ut as TopicSnapshot, v as DismissNextActionArgs, vt as UpdateProjectMetadataArgs, w as GetCurrentFocusArgs, wt as WorkstreamSnapshot, x as DismissPlanForkResult, xt as UpdateTopicResult, y as DismissNextActionResult, yt as UpdateProjectMetadataResult, z as InspectProjectDirectoryResult } from "./rpc-contracts-D_35PPbQ.js";
import { Context, Service } from "@deepseek-ai/cordis";
import s from "@deepseek-ai/schemastery";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import { DatabaseSync } from "node:sqlite";
import "ajv";
//#region src/host/domain/loader/types.d.ts
type AttentionMode = 'FOCUS' | 'NORMAL' | 'BACKGROUND';
//#endregion
//#region src/host/dsh-adapter/host/rpc-services.d.ts
/**
 * The injected service port the 13 `@Remote` method bodies forward to.
 *
 * Arity contract (RR-006): every port method takes exactly the decoded
 * args object of its RPC — 1:1 with the descriptor's parameter face
 * (0 params for getDashboard/getProject, 1 `args` param for the other
 * 11). Tests stub this interface and assert the forwarded args/return.
 */
interface ResearchRpcServices {
  /**
   * WP-4.6 (RR-015① disposition): the production implementation runs the
   * idempotent `stale.checkAllOpen()` sweep BEFORE the projection (the
   * query-path stale pre-check — the snapshot reflects the current truth,
   * PLAN_FORK_SPEC §5 「PF 列表查询懒检测」 timing). The port is async for
   * the two query RPCs that read the PF state (the sweep is an async W3
   * batch); stub implementations resolve with the fixture.
   */
  getDashboard(): Promise<DashboardSnapshot>;
  getProject(): ProjectSnapshot;
  getTopic(args: GetTopicArgs): TopicSnapshot;
  getWorkstream(args: GetWorkstreamArgs): Promise<WorkstreamSnapshot>;
  queryHistory(args: QueryHistoryArgs): QueryHistoryResult;
  reorderPlan(args: ReorderPlanArgs): ReorderPlanResult;
  selectPlanFork(args: SelectPlanForkArgs): Promise<SelectPlanForkResult>;
  dismissPlanFork(args: DismissPlanForkArgs): Promise<DismissPlanForkResult>;
  updateInterventionState(args: UpdateInterventionStateArgs): UpdateInterventionStateResult;
  registerInteraction(args: RegisterInteractionArgs): Promise<RegisterInteractionResult>;
  saveResearchCheckpoint(args: SaveResearchCheckpointArgs): Promise<SaveResearchCheckpointResult>;
  getGitHistory(args: GetGitHistoryArgs): Promise<GetGitHistoryResult>;
  restoreDeclarativeFile(args: RestoreDeclarativeFileArgs): Promise<RestoreDeclarativeFileResult>;
  /**
   * UI-0.4 (R-01): USER mutation — point the workstream's current-focus
   * operational pointer at the given canonical Plan member. The
   * canonical-membership gate runs service-side BEFORE any row write
   * (CF_NOT_CANONICAL — the frozen DDL stays a plain 3-column table).
   * The RPC face IS the USER lane (R-01: no actor parameter, the host
   * gateway bounds who may call it). Returns the canonical record
   * (id + `updatedAt` version) for client invalidation.
   */
  setCurrentFocus(args: SetCurrentFocusArgs): SetCurrentFocusResult;
  /**
   * UI-0.4 (R-01): read back the workstream's current-focus pointer.
   * `focus: null` = never set / auto-cleared after the target left the
   * canonical Plan (the R-01 eviction rule).
   */
  getCurrentFocus(args: GetCurrentFocusArgs): GetCurrentFocusResult;
  /**
   * V2-UI-0.4 (Task 3): create a new Topic in the routed project —
   * allocates the next TPC-<n> (max+1, never reused) and writes the
   * minimal valid file set (`topic.yaml` only). Returns the canonical
   * record (id + `createdAt` version) for client invalidation.
   */
  createTopic(args: CreateTopicArgs): CreateTopicResult;
  /**
   * V2-UI-0.4 (Task 3): create a new Workstream under an existing topic
   * of the routed project — allocates the next WS-<n> project-wide and
   * writes `workstream.yaml`. The topic must be a node of this project
   * (HIER_TOPIC_NOT_FOUND otherwise).
   */
  createWorkstream(args: CreateWorkstreamArgs): CreateWorkstreamResult;
  /**
   * V2-UI-0.4 (UI-2A): rewrite the provided project metadata fields
   * (title / description / importance / attention mode / target date)
   * in the routed project — read-modify-write, the OMITTED fields are
   * preserved byte-for-byte (at least one field required, HIER_INPUT
   * otherwise). Returns the effective title + the write stamp
   * (`updatedAt`) for client invalidation.
   */
  updateProjectMetadata(args: UpdateProjectMetadataArgs): UpdateProjectMetadataResult;
  /**
   * V2-UI-0.4 (UI-2A): update a topic title / description / importance
   * / attention mode in the routed project (RMW — provided fields
   * only). The topic must be a node of this project
   * (HIER_TOPIC_NOT_FOUND otherwise).
   */
  updateTopic(args: UpdateTopicArgs): UpdateTopicResult;
  /**
   * V2-UI-0.4 (UI-2A): update a workstream title / summary in the
   * routed project (RMW — title + summary ONLY; lifecycle changes are
   * not part of this slice). The workstream must belong to this
   * project (HIER_WORKSTREAM_NOT_FOUND otherwise).
   */
  updateWorkstream(args: UpdateWorkstreamArgs): UpdateWorkstreamResult;
  /**
   * V2-UI-0.4 (UI-2A): delete a workstream of the routed project —
   * the whole workstream directory plus its reference. CONSERVATIVE
   * ruling: a workstream with history is REFUSED
   * (HIER_WORKSTREAM_HAS_HISTORY) BEFORE any removal; the
   * post-delete current-focus clear is best-effort (surfaced as the
   * `currentFocusCleared` result flag, never as a failure).
   */
  dropWorkstream(args: DropWorkstreamArgs): DropWorkstreamResult;
  /**
   * UI-4 (D §10): the workstream Current-Execution read face — the
   * ACTIVE linked objectives, the explicit blockers (WS ∪ member
   * Task/Run scope), the ADJ-3 mechanical derived projection (the
   * canonical focus Task's dependency edges + the before-focus FAILED
   * gates folded from the WS's OWN event log), the PROPOSED next
   * actions and the WS's interventions. The current-focus pointer is
   * NOT here — it stays on the `currentFocus` slice (ADJ-11).
   */
  getWorkstreamCurrent(args: GetWorkstreamCurrentArgs): Promise<GetWorkstreamCurrentResult>;
  /**
   * UI-4 (D §10, ADJ-6): the basic objective edit — the statement RMW
   * (objectives.yaml atomic save) and/or the transition-checked status
   * change (≥1 field, service-enforced).
   */
  updateObjective(args: UpdateObjectiveArgs): Promise<UpdateObjectiveResult>;
  /** UI-4 (D §10.4): propose a NextAction (optionally WS-scoped). */
  createNextAction(args: CreateNextActionArgs): Promise<CreateNextActionResult>;
  /**
   * UI-4 (D §10.4): promote the PROPOSED NA to a canonical plan Task
   * (USER-only; plan.yaml materialization + the management-action
   * ledger row — the materialization receipt is returned verbatim).
   */
  promoteNextAction(args: PromoteNextActionArgs): Promise<PromoteNextActionResult>;
  /** UI-4 (D §10.4): terminal-dismiss a PROPOSED NA. */
  dismissNextAction(args: DismissNextActionArgs): Promise<DismissNextActionResult>;
  /** UI-4 (D §10.2): raise an Explicit Blocker (USER-only). */
  createBlocker(args: CreateBlockerArgs): Promise<CreateBlockerResult>;
  /**
   * UI-4 (D §10.2): clear an ACTIVE Explicit Blocker. The DERIVED
   * face has no clear (ADJ-4) — clearing the cause removes it.
   */
  clearBlocker(args: ClearBlockerArgs): Promise<ClearBlockerResult>;
  /**
   * Optional resource teardown (the production implementation owns one
   * second SQLite connection; the dsh-adapter registers it with
   * `ctx.effect`). Stub implementations may omit it.
   */
  close?(): void;
}
//#endregion
//#region src/host/dsh-adapter/host/plane-read-services.d.ts
/**
 * The injected service port the 3 plane-read `@Remote` method bodies
 * forward to (one port for the WHOLE plane — see the module header for
 * the plane-level vs per-project split).
 */
interface ResearchPlaneServices {
  /** Design §5/§12 row 1 — the plane state + the caller-session role segment (the tab-body 分流 + the 设置页① 唯一数据源). */
  getResearchPlaneState(args: GetResearchPlaneStateArgs): GetResearchPlaneStateResult;
  /** Design §7.1/§12 row 2 — the cross-project aggregation (聚合条 + 需关注行 + 项目卡墙). */
  getHubOverview(args: GetHubOverviewArgs): Promise<HubOverviewResult>;
  /** Design §7.2/§12 row 3 — the cross-project intervention list (带 projectId 标签, 状态过滤). */
  getPortfolioInterventions(args: GetPortfolioInterventionsArgs): GetPortfolioInterventionsResult;
}
//#endregion
//#region src/host/dsh-adapter/host/plane-mutation-services.d.ts
/**
 * The injected service port the 6 plane-mutation `@Remote` method bodies
 * forward to (one port for the WHOLE plane — the mutation sibling of the
 * `ResearchPlaneServices` read port in ./plane-read-services.ts).
 *
 * Every method is ASYNC (the mutex — module header — needs an await
 * boundary to be observable, and the re-init hook may itself be async);
 * the fs work underneath is sync, like the rest of this layer
 * (discovery / scaffold precedent).
 */
interface ResearchPlaneMutationServices {
  /** Design §8 设为中枢 / §12 row 4 — create the hub marker + an empty registry in a registered workspace. */
  setHub(args: SetHubArgs): Promise<SetHubResult>;
  /** Design §4 (rescan as an RPC) / §12 row 8 — re-run discovery & reconciliation; the deferred flags survive. */
  rescan(args: RescanArgs): Promise<RescanResult>;
  /** Design §4 MISSING 处置「推后处理」 / §12 row 9 — the runtime dedup flag set (in-memory, per backend run). */
  ackMissingReminder(args: AckMissingReminderArgs): Promise<AckMissingReminderResult>;
  /** Design §8 接入 / §12 row 5 — register the workspace as an ACTIVE registry entry (+ scaffold option, + the standalone-DB 收编 under the seal-first ordering). */
  bindProject(args: BindProjectArgs): Promise<BindProjectResult>;
  /** Design §8 解除绑定 / §12 row 6 — archive the entry (NEVER deleted) + rename `<treeDir>/` → `<treeDir>.archived-<时间戳>`; the hub db stays put (库留中枢). */
  unbindProject(args: UnbindProjectArgs): Promise<UnbindProjectResult>;
  /** Design §7.4 恢复登记 / §12 row 7 — revive the archived entry + rename the tree BACK (the symmetric unbind); the hub db re-attaches through the re-init. */
  restoreProject(args: RestoreProjectArgs): Promise<RestoreProjectResult>;
}
//#endregion
//#region src/host/service/local-project/types.d.ts
interface InspectProjectDirectoryInput {
  /** The registered DSH workspace path to inspect (absolute). */
  readonly wsPath: string;
  /** The configured tree directory name (T2.1 `treeDir` —
   *  parameterized; the kernel never hardcodes a tree name). */
  readonly treeDir: string;
}
interface CreateLocalResearchProjectInput {
  /** The registered DSH workspace path (the parent of the tree dir). */
  readonly wsPath: string;
  /** The configured tree directory name (T2.1 `treeDir` — bare
   *  segment; parameterized, never a hardcoded literal). */
  readonly treeDir: string;
  /** The project title (= the scaffolded `project.yaml` title = the
   *  registry display name; 1–200 chars, the frozen schema). */
  readonly title: string;
  /** The frozen project.schema.json optional fields (each omitted =
   *  absent from the written YAML — the loader materializes the
   *  defaults at read time). */
  readonly description?: string;
  readonly importance?: number;
  readonly attentionMode?: AttentionMode;
  /** `YYYY-MM-DD` (frozen `target_date`, isoDate). */
  readonly targetDate?: string;
}
//#endregion
//#region src/host/dsh-adapter/host/local-project-services.d.ts
/** The local-project creation port (the host service's @Remote bodies
 *  target this interface — the production implementation is
 *  `ProductionLocalProjectServices`). */
interface LocalProjectServices {
  /** The Bind journey's read-only four-state classification (wire
   *  DTO — structurally 1:1 with the kernel's). */
  inspectProjectDirectory(input: InspectProjectDirectoryInput): InspectProjectDirectoryResult;
  /** The Create journey (the three-stage contract — see the kernel).
   *  Returns the WIRE result DTO: the failure arm's `code` is the
   *  5-code step vocabulary (the pre-check codes throw instead —
   *  they never reach this DTO). */
  createLocalResearchProject(input: CreateLocalResearchProjectInput): Promise<CreateLocalResearchProjectResult>;
}
//#endregion
//#region src/host/dsh-adapter/host/index.d.ts
/**
 * Validated plugin config.
 *
 * WP-2.6: `minDshVersion` — RR-008 / DSH_ADAPTER §12-② 「插件 `Config` 自持
 * `minDshVersion` 字段，`[Service.init]` 与宿主可观测版本比对 fail-loud」.
 * The default `0.1.0-rc.8` (the frozen baseline host, this plugin's exact
 * peer pin) lives in the SCHEMA, not in code (root AGENTS.md: no hardcoded
 * tunables — defaults belong in the schema).
 */
interface Config {
  /**
   * The minimum DSH (harness package) version this plugin supports.
   * Optional at the type level (a hand-built config, e.g. in construction
   * tests, may omit it); for every config that went through the LOADER the
   * schema default (`0.1.0-rc.8`) has been applied, so `[Service.init]`
   * sees a string — an omission there is misconfiguration and fails loud.
   */
  readonly minDshVersion?: string;
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    researchControl: ResearchControlService;
  }
}
declare class ResearchControlService extends TypertRemoteService {
  #private;
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
  static inject: string[];
  /**
   * Loader-side validation of the plugin config (standard-schema V1).
   * `minDshVersion` default = the frozen baseline (DSH_ADAPTER 头部：宿主
   * `0.1.0-rc.8`; exact peer pin per RR-003).
   */
  static Config: s<Config>;
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
  private plane;
  /**
   * V2-T2.2: the per-project RPC service ports (one
   * `ProductionResearchRpcServices` per MANAGED/STANDALONE project,
   * keyed by project id — the §12.1 routing map). `undefined` only
   * before init. Same proxy rule as {@link plane} (TS `private`, not
   * `#`).
   */
  private projectRpcs;
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
  private projectWirings;
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
  private planeServices;
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
  private planeMutationServices;
  /**
   * UI-2B (design §8.7): the local-project creation port
   * (inspectProjectDirectory / createLocalResearchProject — the
   * Create/Bind journeys) — ONE instance for the whole plane, composed
   * in `[Service.init]` next to the mutation port over the SAME live
   * plane fields (the onboarding path — callable on the EMPTY plane);
   * its register step forwards to the bindProject ladder (registry
   * COMMIT LAST + re-init + the fresh-state post-check). Tests inject
   * a stub through the optional 6th constructor argument (the seam
   * pattern extended). `undefined` only before init —
   * `requireLocalProjectServices` fails loud (the same spike-mode guard
   * shape). Same proxy rule as {@link plane} (TS `private`, not `#`).
   */
  private localProjectServices;
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
  private rpc;
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
   * @param localProjectServices - UI-2B test seam: a stub for the
   *  local-project creation port (the inspect / create pair, design
   *  §8.7; production fibers pass nothing — `[Service.init]` composes
   *  the production implementation over the SAME live plane fields as
   *  the mutation port, with its register step forwarding to the
   *  bindProject ladder).
   */
  constructor(ctx: Context, config: Config, rpcServices?: ResearchRpcServices, planeServices?: ResearchPlaneServices, planeMutationServices?: ResearchPlaneMutationServices, localProjectServices?: LocalProjectServices);
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
  protected [Service.init](): Promise<void>;
  /**
   * RPC spike (WP-0.3): liveness round-trip marker, no parameters (the
   * spike does no argument codec handling), pure-JSON result
   * (DSH_ADAPTER §5 step 3). The `@Remote('ping')` marker is what the
   * gateway's SRC fallback path resolves (plus the strict `./typert`
   * descriptor, which takes precedence once the loader registers it).
   * `time` is epoch milliseconds (UTC) — see `PingResult` in shared.
   */
  ping(): Promise<PingResult>;
  getDashboard(): Promise<DashboardSnapshot>;
  getProject(): Promise<ProjectSnapshot>;
  getTopic(args: unknown): Promise<TopicSnapshot>;
  getWorkstream(args: unknown): Promise<WorkstreamSnapshot>;
  queryHistory(args: unknown): Promise<QueryHistoryResult>;
  reorderPlan(args: unknown): Promise<ReorderPlanResult>;
  selectPlanFork(args: unknown): Promise<SelectPlanForkResult>;
  dismissPlanFork(args: unknown): Promise<DismissPlanForkResult>;
  updateInterventionState(args: unknown): Promise<UpdateInterventionStateResult>;
  registerInteraction(args: unknown): Promise<RegisterInteractionResult>;
  saveResearchCheckpoint(args: unknown): Promise<SaveResearchCheckpointResult>;
  getGitHistory(args: unknown): Promise<GetGitHistoryResult>;
  restoreDeclarativeFile(args: unknown): Promise<RestoreDeclarativeFileResult>;
  getResearchPlaneState(args: unknown): Promise<GetResearchPlaneStateResult>;
  getHubOverview(args: unknown): Promise<HubOverviewResult>;
  getPortfolioInterventions(args: unknown): Promise<GetPortfolioInterventionsResult>;
  setHub(args: unknown): Promise<SetHubResult>;
  bindProject(args: unknown): Promise<BindProjectResult>;
  unbindProject(args: unknown): Promise<UnbindProjectResult>;
  restoreProject(args: unknown): Promise<RestoreProjectResult>;
  rescan(args: unknown): Promise<RescanResult>;
  ackMissingReminder(args: unknown): Promise<AckMissingReminderResult>;
  setCurrentFocus(args: unknown): Promise<SetCurrentFocusResult>;
  getCurrentFocus(args: unknown): Promise<GetCurrentFocusResult>;
  createTopic(args: unknown): Promise<CreateTopicResult>;
  createWorkstream(args: unknown): Promise<CreateWorkstreamResult>;
  updateProjectMetadata(args: unknown): Promise<UpdateProjectMetadataResult>;
  updateTopic(args: unknown): Promise<UpdateTopicResult>;
  updateWorkstream(args: unknown): Promise<UpdateWorkstreamResult>;
  dropWorkstream(args: unknown): Promise<DropWorkstreamResult>;
  getWorkstreamCurrent(args: unknown): Promise<GetWorkstreamCurrentResult>;
  updateObjective(args: unknown): Promise<UpdateObjectiveResult>;
  createNextAction(args: unknown): Promise<CreateNextActionResult>;
  promoteNextAction(args: unknown): Promise<PromoteNextActionResult>;
  dismissNextAction(args: unknown): Promise<DismissNextActionResult>;
  createBlocker(args: unknown): Promise<CreateBlockerResult>;
  clearBlocker(args: unknown): Promise<ClearBlockerResult>;
  inspectProjectDirectory(args: unknown): Promise<InspectProjectDirectoryResult>;
  createLocalResearchProject(args: unknown): Promise<CreateLocalResearchProjectResult>;
  /**
   * The plane-mutation port guard (V2-T3.2b — the mutation twin of
   * {@link requirePlaneServices}): a constructor-injected stub (TESTS
   * only) always wins; pre-init (plane not discovered yet) fails loud
   * (the gateway carries the message as an `ok: false` failure; `ping`
   * still serves). The mutation port is composed in EVERY init mode
   * (the empty plane included — it is the onboarding face), so a
   * non-undefined field always has a usable target once init has run.
   */
  private requirePlaneMutationServices;
  /**
   * The local-project port guard (UI-2B — the mutation port's twin): a
   * constructor-injected stub (TESTS only) always wins; pre-init (plane
   * not discovered yet) fails loud (the gateway carries the message as
   * an `ok: false` failure; `ping` still serves). The port is composed
   * in EVERY init mode (the empty plane included — the onboarding
   * face), so a non-undefined field always has a usable target once
   * init has run.
   */
  private requireLocalProjectServices;
  /**
   * The plane-read port guard (V2-T3.2a — the plane-level twin of
   * {@link requireRpc}): a constructor-injected stub (TESTS only) always
   * wins; pre-init (plane not discovered yet) fails loud (the gateway
   * carries the message as an `ok: false` failure; `ping` still serves).
   * The plane port is composed in EVERY init mode (the empty plane
   * included — it serves the empty aggregates), so a non-undefined
   * field always has a usable target once init has run.
   */
  private requirePlaneServices;
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
  private requireRpc;
}
//#endregion
export { ResearchControlService as default };