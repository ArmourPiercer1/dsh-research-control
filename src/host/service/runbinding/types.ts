/**
 * WP-2.4 — Run binding + DiscoveredSession: public type surface.
 *
 * Frozen-contract sources (all consumed read-only; see SI-001 for the
 * workspace-root layout):
 *  - DOMAIN_SCHEMA §6.1 L293-308 (Run row spec: Formal Run 必须绑定
 *    Workstream; task_id 可空 = exploratory run; dsh_session_id 指针,
 *    不复制 session 内容 — INV-DB-2; status 由 RUN_* 事件派生并缓存);
 *  - DOMAIN_SCHEMA §6.2 L310-322 (DiscoveredSession 规则: 显式
 *    ResearchContext/workstream → 自动注册 Run; 注册 workspace 内无
 *    context → DiscoveredSession; 外部 workspace → 忽略; 字段 +
 *    state=BOUND 时 bound_run_id);
 *  - DOMAIN_SCHEMA §13 L549/L554 (状态机: Run `RUNNING → FINISHED|FAILED|
 *    CANCELLED` 终态; DiscoveredSession `PENDING → BOUND|DETACHED|IGNORED`
 *    终态, DETACH/IGNORE 后不再重复发现);
 *  - DOMAIN_SCHEMA §15 L615-616 (表映射: `run` PK run_id, 索引
 *    (workstream_id, started_at) + dsh_session_id; `discovered_session`
 *    PK id, UNIQUE(dsh_session_id)) + §15 通则 (不 hard delete 一等
 *    identity 行 — INV-HIST-7; 状态列是 History 的派生缓存);
 *  - schema/operational/run.schema.json (oneOf Run / DiscoveredSession,
 *    additionalProperties:false, snake_case 键 — 本模块的行记录键名逐字
 *    同构该冻结 schema 的 $defs);
 *  - HISTORY_EVENT_CATALOG §5.1 (RUN_STARTED/RUN_FINISHED/RUN_FAILED/
 *    RUN_CANCELLED payload 规格 + 副作用: run 行创建/状态缓存);
 *  - ARCHITECTURE §6 权限矩阵行「Run 生命周期事件」: USER ✅(手工登记) /
 *    RESEARCH_AGENT ✅(checkpoint 报告触发) / PLUGIN ✅(session 绑定自动
 *    登记); §5.9 INV-PERM-1/2 (Agent 可写集不含 Run 绑定 — 本模块的
 *    BIND/DETACH/IGNORE 操作面是 USER-only, 见 permissions 测试);
 *  - DSH_ADAPTER §7 L147/L152 (SessionSummary.cwd/origin/parentId/running
 *    主数据源; host/session-added 增量发现信号) + §8 (cwd 归属 canonical
 *    比较) + §13-U9 (ResearchContext 载体 — 本模块的
 *    `ResearchContextResolver` 缝即其落地位; V1 默认 resolver = null ⇒
 *    fallback「仅 DiscoveredSession + 手动 BIND」, 见 U9 调查专节).
 *
 * Layer (ARCHITECTURE §2.2): this is the SERVICE layer — the only layer
 * allowed to write the operational DB (it does so through the WP-2.1
 * `ResearchStore` append face for events and through this WP's own
 * `RunBindingTables` face for the two §15 tables). No DSH imports
 * (INV-PERM-5) — the session data plane is the plugin-owned port
 * `DshSessionAdapter` (src/shared, WP-0.4).
 */

import type {
  ActorRef,
  RunStatus,
  TaskSnapshot,
  WorkstreamSnapshot,
} from '../../history/registry/index.js'
import type { HistoryEventRecord, ResearchStore } from '../../persistence/store/index.js'
import type { IdAllocator } from '../../../shared/ids/index.js'
import type { HistoryEventRegistry } from '../../history/registry/index.js'
import type {
  DshSessionAdapter,
  SessionSummary,
} from '../../../shared/host-adapter-ports.js'

/* ------------------------------------------------------------------ *
 * Row records (snake_case = frozen run.schema.json $defs keys)
 * ------------------------------------------------------------------ */

/**
 * One `run` table row (DOMAIN_SCHEMA §6.1; frozen
 * `run.schema.json#/$defs/Run`, additionalProperties:false — this
 * interface carries EXACTLY the frozen keys). `status` is the derived
 * cache of the RUN_* events (catalog §5.1 副作用); the event log remains
 * the 真源 and the row is rebuildable from it (§15 通则).
 */
export interface RunRecord {
  /** R id (§1.1: `R-<n>`, PROJECT scope, allocated at Run registration). */
  readonly id: string
  /** Formal Run 必须绑定 Workstream (WS id; `WS-<n>`). */
  readonly workstream_id: string
  /** T id; absent for exploratory runs (§6.1: 可空). */
  readonly task_id?: string
  /** DSH session pointer only — never session content (INV-DB-2). */
  readonly dsh_session_id?: string
  /** Derived cache of RUN_* events (§13: RUNNING → FINISHED|FAILED|CANCELLED). */
  readonly status: RunStatus
  /** 本次尝试的意图/标题 (§6.1). */
  readonly intent?: string
  /** Who initiated the run (frozen `actorRef`). */
  readonly initiated_by: ActorRef
  /** RUN_STARTED occurredAt (epoch ms, §1.2). */
  readonly started_at: number
  /** RUN_FINISHED/FAILED/CANCELLED occurredAt; absent while RUNNING. */
  readonly ended_at?: number
  /** Free-text run summary (§6.1, 可选). */
  readonly summary?: string
  /** `research_run_checkpoint` 工具更新 (§6.1). */
  readonly last_checkpoint_at?: number
  /** `research_run_checkpoint` 工具更新 (§6.1). */
  readonly last_checkpoint_note?: string
}

/**
 * DiscoveredSession lifecycle states (DOMAIN_SCHEMA §13 L554; frozen
 * `run.schema.json#/$defs/DiscoveredSession.state` enum):
 * `PENDING → BOUND | DETACHED | IGNORED` — all three targets terminal;
 * after DETACH/IGNORE the same DSH session is never re-discovered
 * (TC-DSH-003).
 */
export type DsState = 'PENDING' | 'BOUND' | 'DETACHED' | 'IGNORED'

/**
 * One `discovered_session` table row (DOMAIN_SCHEMA §6.2; frozen
 * `run.schema.json#/$defs/DiscoveredSession`, additionalProperties:false).
 */
export interface DiscoveredSessionRecord {
  /** DS id (§1.1: `DS-<n>`, PROJECT scope, allocated at discovery). */
  readonly id: string
  /** The DSH session this record tracks (UNIQUE, §15 L616). */
  readonly dsh_session_id: string
  /** The registered workspace root the session's cwd attributed to. */
  readonly workspace_root: string
  /** First discovery time (epoch ms). */
  readonly discovered_at: number
  /** §13 L554 state machine state (user-driven, terminal after the first move). */
  readonly state: DsState
  /** Set iff state=BOUND: the formal Run created by the BIND. */
  readonly bound_run_id?: string
  /** Optional note (e.g. the session title at discovery). */
  readonly summary?: string
}

/* ------------------------------------------------------------------ *
 * Actors
 * ------------------------------------------------------------------ */

/**
 * USER actor ref (frozen `actorRef` restricted to kind=USER). The
 * DiscoveredSession lifecycle operations (BIND/DETACH/IGNORE) are
 * USER-only by the §6.2 rule (「用户 BIND/DETACH/IGNORE」) and by the
 * ARCHITECTURE §6 matrix (no agent row for session-binding operations) —
 * the parameter TYPES below are `UserActorRef` so an AGENT/PLUGIN actor
 * is a COMPILE error on that surface (INV-PERM-2 的运行时/类型面半边;
 * 运行时伪造仍被 RB_ACTOR_FORBIDDEN 拒绝 — permissions 测试钉死).
 */
export interface UserActorRef {
  readonly kind: 'USER'
  readonly user_id?: string
  readonly label?: string
}

/** The default user actor for GUI operations (matrix column U). */
export const USER_ACTOR: UserActorRef = { kind: 'USER', label: 'user' }

/**
 * Run-lifecycle event actors: the ARCHITECTURE §6 matrix row 「Run 生命周期
 * 事件」 allows USER (手工登记) / AGENT (checkpoint 报告触发) / PLUGIN
 * (session 绑定自动登记) — which of the three a given event admits is
 * enforced by the WP-2.2 registry emitter matrix (catalog §4 E column:
 * RUN_STARTED U A P; RUN_FINISHED/FAILED U A P; RUN_CANCELLED U A).
 * AGENT actors must carry `run_id` (catalog §5 通用校验) — registry-checked.
 */
export type RunLifecycleActorRef = ActorRef

/** USER-or-AGENT actor for operational (non-event) run updates. */
export interface UserOrAgentActorRef {
  readonly kind: 'USER' | 'AGENT'
  readonly user_id?: string
  readonly run_id?: string
  readonly label?: string
}

/* ------------------------------------------------------------------ *
 * Error taxonomy
 * ------------------------------------------------------------------ */

export type RunBindingErrorCode =
  /** Malformed argument (null/empty/shape) at the service boundary. */
  | 'RB_INPUT'
  /** Non-USER actor on a USER-only operation (BIND/DETACH/IGNORE). */
  | 'RB_ACTOR_FORBIDDEN'
  /** `workstream_id` unknown to the external state provider. */
  | 'RB_WORKSTREAM_NOT_FOUND'
  /** Referenced task does not exist. */
  | 'RB_TASK_NOT_FOUND'
  /** Referenced task belongs to a different workstream than the owner. */
  | 'RB_TASK_WS_MISMATCH'
  /** No DiscoveredSession row with this id. */
  | 'RB_DS_NOT_FOUND'
  /** DS state machine: the operation requires PENDING (§13 L554). */
  | 'RB_DS_NOT_PENDING'
  /** No run row with this id. */
  | 'RB_RUN_NOT_FOUND'
  /** Run state machine: the operation requires RUNNING (§13 L549). */
  | 'RB_RUN_NOT_RUNNING'
  /** The DSH session already has a formal run (one DS : one run, §6.2). */
  | 'RB_SESSION_ALREADY_BOUND'
  /** The DSH session already has a DiscoveredSession row (any state) —
   *  it is inside the control-plane scope; use the DS lifecycle, not
   *  `registerRun` (§6.2: 位于注册 workspace → DiscoveredSession). */
  | 'RB_SESSION_IN_SCOPE'
  /** The WP-2.2 registry rejected the constructed event (structured
   *  `EventValidationError[]` carried on `errors`). */
  | 'RB_EVENT_REJECTED'
  /** A run/discovered_session table operation failed (wrapped driver/SQL). */
  | 'RB_TABLE'
  /** The WP-2.1 store append face failed (wrapped StoreError). */
  | 'RB_STORE'
  /** The injected registry is unusable (load errors) — nothing can be
   *  validated; fail loud at the first event-producing operation. */
  | 'RB_REGISTRY_UNUSABLE'

/**
 * Structured service error. `errors` carries the registry's
 * `EventValidationError[]` for `RB_EVENT_REJECTED` (code+path+message,
 * TC-DOM-027 style); `code` otherwise has no attached payload.
 */
export class RunBindingError extends Error {
  readonly code: RunBindingErrorCode
  /** Structured registry errors (RB_EVENT_REJECTED only). */
  readonly errors?: readonly { readonly code: string; readonly path?: string; readonly message: string }[]

  constructor(code: RunBindingErrorCode, message: string, options?: { cause?: unknown; errors?: readonly { readonly code: string; readonly path?: string; readonly message: string }[] }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'RunBindingError'
    this.code = code
    this.errors = options?.errors
  }
}

/* ------------------------------------------------------------------ *
 * External (declarative-side) state — the validation context seam
 * ------------------------------------------------------------------ */

/**
 * The declarative-side snapshot the event validation needs beyond this
 * WP's own run table (WP-2.2 `validateEvent` ctx): the owner workstreams
 * must EXIST (catalog §5 通用校验 / INV-HIST-3) and a RUN_STARTED
 * `task_id` must exist and belong to the owner WS (§5.1). Production
 * wiring (WP-2.6) serves this from the WP-1.1 loader; tests inject a
 * static map. The rest of the 12-map `HistoryObjectContext` is assembled
 * by the service (runs from its own table; the remaining maps are empty —
 * RUN_* events consult only workstreams/tasks/runs).
 */
export interface RunBindingExternalState {
  /** Workstream id → snapshot (lifecycle drives the PLANNED→REALIZED
   *  atomic-realize seam, TC-DOM-033 persistence half). */
  readonly workstreams: ReadonlyMap<string, WorkstreamSnapshot>
  /** Task id → snapshot (RUN_STARTED task_id checks). */
  readonly tasks: ReadonlyMap<string, TaskSnapshot>
}

/**
 * U9 seam — the 「explicit ResearchContext/workstream binding」 carrier
 * detector (DOMAIN_SCHEMA §6.2 规则 1; DSH_ADAPTER §13-U9). Given one
 * live session summary, return the explicit research binding when the
 * host channel says the session was started with research intent, else
 * `null` (→ DiscoveredSession, manual BIND).
 *
 * V1 default is `null`-always: the U9 调查 conclusion (报告专节) found
 * NO native ResearchContext channel in the host, so the frozen fallback
 * applies (DSH_ADAPTER §13-U9 fallback: 仅 DiscoveredSession + 手动
 * BIND). When/iff a carrier lands (preset convention, projection
 * self-channel, …) the host wiring injects a real resolver here and the
 * auto-registration path (matrix column P, 「session 绑定自动登记」)
 * activates WITHOUT a service API change.
 */
export interface ResearchContext {
  /** The workstream the session explicitly runs under. */
  readonly workstreamId: string
  /** Optional task the session attempts. */
  readonly taskId?: string
  /** Optional intent/title for the auto-registered Run. */
  readonly intent?: string
}
export type ResearchContextResolver = (session: SessionSummary) => ResearchContext | null

/* ------------------------------------------------------------------ *
 * Operation parameters / results
 * ------------------------------------------------------------------ */

/** Parameters of `bindDiscoveredSession` (the user's explicit BIND). */
export interface BindParams {
  /** The formal Run's owner workstream (WS id; must exist — §6.1). */
  readonly workstreamId: string
  /** Optional task the bound Run attempts (T id; must belong to the WS). */
  readonly taskId?: string
  /** Optional intent/title for the Run. */
  readonly intent?: string
}

/** Parameters of `registerRun` (manual Run registration, matrix U 手工登记). */
export interface RegisterRunParams {
  readonly workstreamId: string
  readonly taskId?: string
  /** Optional DSH session pointer (INV-DB-2: pointer only). The session
   *  must NOT already be inside the control-plane scope (no DS row). */
  readonly dshSessionId?: string
  readonly intent?: string
}

/** Outcome of a Bind / auto-registration: DS row + run row + the event. */
export interface BindResult {
  readonly ds: DiscoveredSessionRecord
  readonly run: RunRecord
  /** The committed RUN_STARTED event (store-assigned seq/recordedAt). */
  readonly event: HistoryEventRecord
}

/** Outcome of a Run lifecycle operation (event + updated run row). */
export interface RunResult {
  readonly run: RunRecord
  readonly event: HistoryEventRecord
}

/** `listRuns` / `listDiscoveredSessions` filters (all optional). */
export interface RunListFilter {
  readonly workstreamId?: string
  readonly status?: RunStatus
  readonly dshSessionId?: string
}
export interface DiscoveredSessionListFilter {
  readonly state?: DsState
  readonly workspaceRoot?: string
}

/* ------------------------------------------------------------------ *
 * Service options
 * ------------------------------------------------------------------ */

/**
 * `RunBindingService` construction options (dependency injection — the
 * service is the orchestrating layer; every collaborator is a frozen
 * WP's public face or a plugin-owned port):
 *
 *  - `store` — the WP-2.1 `ResearchStore` (event append + meta face;
 *    the same file the run/DS tables live in — see `openRunBindingDatabase`);
 *  - `tables` — this WP's run/discovered_session table face
 *    (`RunBindingTables`, opened over the SAME research.sqlite file);
 *  - `registry` — the WP-2.2 typed event registry (schema-driven
 *    validation of every constructed RUN_* event — INV-HIST-4);
 *  - `allocator` — the shared `IdAllocator` over the store `meta` table
 *    (R / DS / H id families, §1.1 规则 2: 插件侧分配、项目内单调、
 *    release 烧号);
 *  - `projectId` — the `PRJ-<n>` the counters are scoped to;
 *  - `workspaceRoots` — the registered research workspace roots for
 *    cwd attribution (§8 canonical containment; default = none,
 *    discovery then attributes nothing);
 *  - `externalState` — the declarative-side snapshot seam (above);
 *    default = empty (every event-producing operation fails loud with
 *    RB_WORKSTREAM_NOT_FOUND / registry OBJECT_NOT_FOUND);
 *  - `researchContextResolver` — the U9 seam; default = no auto-
 *    registration (the frozen fallback);
 *  - `now` — clock for occurredAt/discovered_at/checkpoint stamps
 *    (injected in tests; default `Date.now`);
 *  - `onWorkstreamRealized` — the declarative half of the PLANNED→
 *    REALIZED atomic flip (TC-DOM-033): invoked INSIDE the store write
 *    transaction when a PLANNED workstream's FIRST event is this batch.
 *    The derived_state half is written by the service; the workstream.
 *    yaml file half is the WP-1.1 loader's — wired by WP-2.6.
 */
export interface RunBindingServiceOptions {
  readonly store: ResearchStore
  readonly tables: import('./tables.js').RunBindingTables
  readonly registry: HistoryEventRegistry
  readonly allocator: IdAllocator
  readonly projectId: string
  readonly workspaceRoots?: readonly string[]
  readonly externalState?: () => RunBindingExternalState
  readonly researchContextResolver?: ResearchContextResolver
  readonly now?: () => number
  readonly onWorkstreamRealized?: (workstreamId: string) => void
}

/**
 * The session data-plane port the discovery surface consumes
 * (re-exported for consumers: `startDiscovery` takes exactly this
 * interface — the WP-0.4 `DshSessionAdapter` implementation in
 * `src/host/dsh-adapter/session.ts` satisfies it structurally).
 */
export type { DshSessionAdapter, SessionSummary }
