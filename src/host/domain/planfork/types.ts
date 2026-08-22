/**
 * WP-3.1 — PlanFork domain model: types, error taxonomy, injected I/O ports.
 *
 * Frozen contracts implemented here (all read-only):
 *  - PLAN_FORK_SPEC.md §2 (模型: §2.1 ProposedItem = KEEP|NEW; §2.2 anchor
 *    语义 — fork_anchor/merge_anchor、开区间 (fork, merge) 替换、边界哨兵
 *    `__START__`/`__END__`、anchor 必须是 canonical 存在的 id 且
 *    fork 序号 ≤ merge 序号, 相等 = 纯插入);
 *  - PLAN_FORK_SPEC.md §3 (Plan Closure: plan.yaml + 每个 ordered item 的
 *    定义文件; blob OID 捕获 `base_plan_objects` + 信息性 `base_git_commit`);
 *  - PLAN_FORK_SPEC.md §4 (创建八步校验 — 本模块 create.ts 的纯函数链);
 *  - PLAN_FORK_SPEC.md §9 (AgentPlanForkPolicy — policy.ts);
 *  - PLAN_FORK_SPEC.md §10 (状态机 OPEN→SELECTED|DISMISSED|STALE,
 *    STALE→DISMISSED, 终态; 状态迁移 append-only 记录, PF 行永不删除);
 *  - DOMAIN_SCHEMA §5 (PlanFork operational 字段表: snake_case, created_at
 *    epoch ms — A-3 修订; status 初始 OPEN; selected_at/selected_by、
 *    dismissed_at、stale_reason 可选) + §15 L625-626 (表映射: `plan_fork`
 *    PK id + 索引 (workstream_id, status); `management_action` PK id;
 *    通则: 不 hard delete 一等 identity 行) + §16.3 (operational→operational
 *    引用写入时校验存在性);
 *  - schema/operational/plan-fork.schema.json (行投影: oneOf $defs/PlanFork,
 *    additionalProperties:false — 本模块的 `PlanForkRecord` 与其 $defs 键
 *    逐字同构) + schema/operational/provenance.schema.json ($defs/
 *    ManagementAction: action_kind 15 值枚举含 PF_CREATED/PF_SELECTED/
 *    PF_DISMISSED/PF_STALE_MARKED) + schema/declarative/
 *    agent-plan-fork-policy.schema.json (§9 policy) + common.schema.json
 *    (planItemId/typedRef/actorRef/epochMs/id patterns);
 *  - ARCHITECTURE §5.4 INV-PLAN-* 全部 (逐条映射见各文件头注释 + 本报告);
 *    §2.2 rule 1 (domain 纯逻辑, 零 I/O — 所有 I/O 经下方注入端口).
 *
 * ## History-event boundary (PLAN_FORK_SPEC §4/§6.6/§10 + catalog 核查)
 *
 * HISTORY_EVENT_CATALOG §4 的 20 个事件类型中**没有 PLAN_FORK_\* 事件**
 * (逐行核查, 见 WP-3.1 报告): PF 创建与状态迁移是**管理操作**, 记录在
 * operational `management_action` 账本 (action_kind PF_CREATED/PF_SELECTED/
 * PF_DISMISSED/PF_STALE_MARKED — 冻结 provenance.schema.json 枚举), 不产
 * ResearchHistory 事件。因此本模块不 import host/history/** (domain 层
 * 规则, 同 WP-2.5 semantics 边界); 状态迁移经本模块 store 的
 * `transition()` (乐观条件更新 + 同事务 ManagementAction append)。
 *
 * ## Layer rules (ARCHITECTURE §2.2)
 *
 *  - ZERO direct I/O: 文件读 (policy/schema) 经注入 `ResearchFileReader`
 *    (WP-1.1 端口); operational DB 经注入 `PlanForkDb` 结构端口 (store.ts);
 *    closure blob 捕获 (git hash-object, GIT_INTEGRATION §7) 经注入
 *    `ClosureBlobCapturer`; 无 DSH imports (INV-PERM-5), 无 Node builtins。
 */

import type { ResearchFileReader } from '../loader/index.js'

/* ------------------------------------------------------------------ *
 * Shared frozen structures (mirrors of common.schema.json $defs — the
 * domain layer never imports host/history/** (WP-2.5 boundary note), so
 * the small shared shapes are re-declared field-for-field; they are
 * round-trip tested against the REAL frozen schemas in
 * tests/planfork/model.test.ts)
 * ------------------------------------------------------------------ */

/** `ActorRef` (common.schema.json#/$defs/actorRef) — mirror, frozen shape. */
export interface ActorRef {
  readonly kind: 'USER' | 'AGENT' | 'PLUGIN' | 'SYSTEM'
  readonly user_id?: string
  /** R id; AGENT actors reference the run (frozen actorRef). */
  readonly run_id?: string
  readonly session_id?: string
  readonly label?: string
}

/** The 4 frozen actor kinds (actorRef.kind). */
export const ACTOR_KINDS = ['USER', 'AGENT', 'PLUGIN', 'SYSTEM'] as const

/* ------------------------------------------------------------------ *
 * PlanFork record (DOMAIN_SCHEMA §5; frozen plan-fork.schema.json $defs)
 * ------------------------------------------------------------------ */

/**
 * The 4 PlanFork states (PLAN_FORK_SPEC §10 / frozen schema `status` enum).
 * Initial state = OPEN (§5 表: 「初始 OPEN」); SELECTED/DISMISSED 终态.
 */
export type PfStatus = 'OPEN' | 'SELECTED' | 'DISMISSED' | 'STALE'

/** All 4 states, canonical order (frozen schema enum order). */
export const PF_STATUSES: readonly PfStatus[] = ['OPEN', 'SELECTED', 'DISMISSED', 'STALE'] as const

/**
 * Plan item kinds in PlanFork vocabulary (frozen schema spellings:
 * `TASK`/`GATE`/`MILESTONE` — the plan kernel's lowercase `PlanItemKind`
 * is a different face; this module keeps the schema spellings verbatim).
 */
export type PlanForkItemKind = 'TASK' | 'GATE' | 'MILESTONE'

/** All 3 plan item kinds, canonical order. */
export const PLAN_FORK_ITEM_KINDS: readonly PlanForkItemKind[] = ['TASK', 'GATE', 'MILESTONE'] as const

/**
 * One element of `base_plan_objects` (frozen $defs/BasePlanObject):
 * a closure file + its working-copy git blob OID at creation time
 * (PLAN_FORK_SPEC §3.2; GIT_INTEGRATION §7 W3).
 */
export interface BasePlanObject {
  /** Workspace-relative closure file path (e.g. `topics/TPC-1/workstreams/WS-1/plan.yaml`). */
  readonly path: string
  /** 40-hex git blob OID of the working-copy content at creation. */
  readonly git_blob_oid: string
}

/**
 * `NewItemSpec` per kind (PLAN_FORK_SPEC §2.1: 「NewItemSpec 按 kind 对应
 * DOMAIN_SCHEMA §4 的必填声明字段」; frozen $defs/NewItemSpecTask/Gate/
 * Milestone — additionalProperties:false, so the TS mirror is closed):
 *   - Task:      title / goal (+ optional deliverables / acceptance_criteria)
 *   - Gate:      title / criteria (+ optional references)
 *   - Milestone: title / statement
 */
export interface NewItemSpecTask {
  readonly title: string
  readonly goal: string
  readonly deliverables?: string[]
  readonly acceptance_criteria?: string[]
}
export interface NewItemSpecGate {
  readonly title: string
  readonly criteria: string
  readonly references?: string[]
}
export interface NewItemSpecMilestone {
  readonly title: string
  readonly statement: string
}
export type NewItemSpec = NewItemSpecTask | NewItemSpecGate | NewItemSpecMilestone

/**
 * `ProposedItem` (PLAN_FORK_SPEC §2.1, 原文形态):
 *
 *   | { action: 'KEEP'; kind; ref }   — 引用当前 canonical 中的 item id, 保持不变
 *   | { action: 'NEW';  kind; spec }  — 新 item, SELECT 时才获得正式 ID
 *
 * 三种变更形态 (INSERT/MOVE/DELETE) 按原文表达:
 *   - INSERT  = `NEW` (新 item, 物化在 SELECT 时获得 T/G/M 正式 ID);
 *   - MOVE    = `KEEP` 且该 item 在物化后计划中的位置 ≠ canonical 位置
 *     (替换区间重排 — anchors 保留, 区间内按 proposed 顺序放置);
 *   - DELETE  = 替换区间 (fork, merge) 内、未被任何 `KEEP` 引用的
 *     canonical item (omission = removal; 定义文件保留, INV-PLAN-9);
 *   - (KEEP 且位置不变 = 无变更形态, 仅「保持不变」的原文语义。)
 * `derivePlanForkChanges` (anchors.ts) 机械派生上述分类 — 供校验/诊断
 * 与 WP-3.4 SELECT 预览复用; new_plan 物化本身不在本 WP (§6.3 公式属
 * WP-3.4, 见 create.ts 头注)。
 */
export interface ProposedItemKeep {
  readonly action: 'KEEP'
  readonly kind: PlanForkItemKind
  /** Canonical 中存在的 item id (T/G/M) (step 4 校验; 位于开区间内)。 */
  readonly ref: string
}
export interface ProposedItemNew {
  readonly action: 'NEW'
  readonly kind: PlanForkItemKind
  /** 按 kind 的必填声明字段 (step 4 过对应冻结 $defs 校验)。 */
  readonly spec: NewItemSpec
}
export type ProposedItem = ProposedItemKeep | ProposedItemNew

/**
 * `trigger_refs` element (frozen schema: `typedRef` 收窄 kind 枚举到
 * CLAIM/FACT/ARTIFACT/MILESTONE/OBJECTIVE — PLAN_FORK_SPEC §4 步骤 6 /
 * DOMAIN_SCHEMA §5 「kind ∈ {CLAIM, FACT, ARTIFACT, MILESTONE, OBJECTIVE}」)。
 * 存在性 = 写入时校验 (§16.3), 经注入 `TriggerRefResolver` 解析。
 */
export type PlanForkTriggerKind = 'CLAIM' | 'FACT' | 'ARTIFACT' | 'MILESTONE' | 'OBJECTIVE'

/** All 5 frozen trigger kinds (schema default allowed_kinds 全集). */
export const PLAN_FORK_TRIGGER_KINDS: readonly PlanForkTriggerKind[] = [
  'CLAIM',
  'FACT',
  'ARTIFACT',
  'MILESTONE',
  'OBJECTIVE',
] as const

export interface TriggerRef {
  readonly kind: PlanForkTriggerKind
  /** §1.1 id of the referenced object (C-/F-/A-/M-/OBJ-<n> 与 kind 一致, step 4 风格机械核对)。 */
  readonly id: string
}

/**
 * One `plan_fork` row (DOMAIN_SCHEMA §5 field table; frozen
 * `plan-fork.schema.json#/$defs/PlanFork`, additionalProperties:false —
 * this interface carries EXACTLY the frozen 16 keys, snake_case 逐字同构).
 *
 * Invariant mapping (ARCHITECTURE §5.4 — 逐条注释, 全表见报告):
 *  - INV-PLAN-3 (Agent 无 canonical plan 修改 API): 类型面 — 本模块只产出
 *    PF proposal 记录, 无任何 plan.yaml 写口 (domain 不持 PlanFileWriter);
 *    canonical 写口仅 WP-1.3 PlanStore (用户面)。运行时由工具层 WP-3.3 的
 *    actor 门兜底 (本 WP 交付创建链 + 存储面, 工具面不在此)。
 *  - INV-PLAN-4 (PF append-only, 不可修改/删除): 存储层 — schema.ts 的
 *    no-DELETE trigger + 内容不可变 trigger (创建后仅 status/迁移字段可
 *    UPDATE); 类型面 — PlanForkRecord 全字段 readonly; API 面无 delete。
 *  - INV-PLAN-5 (base = 创建时刻 closure 精确 (path, oid) 集合): `base_plan_objects`
 *    必填 minItems 1 (schema) + create step 3 服务端重算 (capturer 注入)。
 *  - INV-PLAN-6 (创建无 base 参数): CreatePlanForkParams 类型面 + 运行时
 *    冻结输入面守卫 (create.ts `assertFrozenInputSurface`)。
 *  - INV-PLAN-7 (SELECT 后同基准 OPEN PF → STALE): state-machine.ts 转换表
 *    的 OPEN→STALE 边 + store.transition 乐观门 (WP-3.4 调用)。
 *  - INV-PLAN-8 (基准失真 → STALE): 转换表 OPEN→STALE + stale_reason 字段
 *    (WP-3.2 调用; 本 WP 交付状态机 + 字段面)。
 *  - INV-PLAN-9 (定义文件长期保留): 本模块不删除任何定义文件 (无写口);
 *    DELETE 变更形态只表达「离开 ordered_items」。
 */
export interface PlanForkRecord {
  /** PF id (§1.1: `PF-<n>`, PROJECT scope, 创建时分配)。 */
  readonly id: string
  /** WS id — the workstream whose canonical plan this fork targets. */
  readonly workstream_id: string
  /** 创建时刻 canonical plan closure 的 blob OID 集合 (稳定集合, 服务端重算)。 */
  readonly base_plan_objects: readonly BasePlanObject[]
  /** 创建时刻 HEAD (信息性, 不参与 stale 判定 — §3.2). */
  readonly base_git_commit?: string
  /** Canonical 中存在的 item id 或 `__START__`/`__END__` (§2.2). */
  readonly fork_anchor: string
  /** 同上; 序号 ≥ fork_anchor (相等 = 纯插入). */
  readonly merge_anchor: string
  /** 有序替换内容 (minItems 1, 有序 = 位置即用户意图, INV-PLAN-1 同精神). */
  readonly proposed_items: readonly ProposedItem[]
  /** ≥1 (schema minItems; policy require_at_least_one=false 时创建面可放宽), 须存在且 kind ∈ policy 允许集. */
  readonly trigger_refs: readonly TriggerRef[]
  /** 非空 (§5 表). */
  readonly reason: string
  /** 非空 (§5 表). */
  readonly necessity: string
  /** R id — Agent proposal 专属 (§5 表: 「Agent proposal 专属」). */
  readonly created_by_run: string
  /** epoch ms — A-3 修订 (operational 载体统一 epoch ms, §1.2). */
  readonly created_at: number
  /** 初始 OPEN; append-only 状态机 (§10). */
  readonly status: PfStatus
  /** status=SELECTED 时必填 (字段共现 — schema.ts CHECK). */
  readonly selected_at?: number
  /** status=SELECTED 时必填 (SELECT 执行者 — 用户, WP-3.4). */
  readonly selected_by?: ActorRef
  /** status=DISMISSED 时必填. */
  readonly dismissed_at?: number
  /** status=STALE 时必填 (首个差异说明 — §5 口径). */
  readonly stale_reason?: string
}

/* ------------------------------------------------------------------ *
 * ManagementAction (DOMAIN_SCHEMA §12.1; frozen provenance.schema.json
 * $defs/ManagementAction — snake_case 逐字同构). PF 生命周期记录落这张
 * 账本 (catalog 无 PLAN_FORK_* 事件 — 见模块头注).
 * ------------------------------------------------------------------ */

/** The 15 frozen action_kind values (provenance.schema.json enum, 逐字). */
export type ManagementActionKind =
  | 'PLAN_REORDER'
  | 'PLAN_ITEM_ADDED'
  | 'PLAN_ITEM_REMOVED'
  | 'PF_CREATED'
  | 'PF_SELECTED'
  | 'PF_DISMISSED'
  | 'PF_STALE_MARKED'
  | 'CHECKPOINT_SAVED'
  | 'RESTORE_PERFORMED'
  | 'TOPOLOGY_EDITED'
  | 'MANIFEST_EDITED'
  | 'CONTRACT_EDITED'
  | 'WS_LIFECYCLE_CHANGED'
  | 'OBJECTIVE_EDITED'
  | 'INBOX_CONVERTED'

export interface GitBlobOid {
  readonly path: string
  readonly oid: string
}

export interface ManagementActionRecord {
  /** MA id (§1.1: `MA-<n>`, PROJECT scope, 管理操作时分配). */
  readonly id: string
  readonly action_kind: ManagementActionKind
  readonly actor: ActorRef
  /** 操作涉及的对象 (如 [{ kind: 'PLAN_FORK', id: 'PF-17' }]). */
  readonly subject_refs: readonly TriggerRefLike[]
  /** 关联的 git commit (如 CHECKPOINT_SAVED; PF 操作通常无). */
  readonly git_commit_oid?: string
  /** 关联的 (path, oid) 集 (如 PF_CREATED 的 base closure 快照). */
  readonly git_blob_oids?: readonly GitBlobOid[]
  /** 自由说明 (机械摘要, 不判断科研理由 — INV-SCI-2). */
  readonly detail?: string
  /** epoch ms (§1.2). */
  readonly occurred_at: number
}

/** TypedRef (common.schema.json#/$defs/typedRef) — subject_refs 元素. */
export interface TriggerRefLike {
  readonly kind: string
  readonly id: string
}

/* ------------------------------------------------------------------ *
 * Error taxonomy
 * ------------------------------------------------------------------ */

/** The §4 step number a creation-path error was raised at (1..8). */
export type CreateStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export type PlanForkErrorCode =
  /** Malformed argument at the module boundary (null/empty/shape), including unknown keys on the frozen creation input (INV-PLAN-6 guard). */
  | 'PF_INPUT'
  /** A well-formedness/id problem on a caller-supplied identifier (non-§4-step surface). */
  | 'PF_ID'
  /** §4 step 1 — policy `enabled` is false. */
  | 'PF_POLICY_DISABLED'
  /** Policy document missing/parse/validate failure (or policy schema unavailable). */
  | 'PF_POLICY_INVALID'
  /** §4 step 2 — `workstream_id` unknown (no workstream directory). */
  | 'PF_WORKSTREAM_MISSING'
  /** §4 step 2 — canonical plan not loaded (no plan.yaml). */
  | 'PF_PLAN_NOT_LOADED'
  /** §4 step 2 — canonical plan loaded but inconsistent (§4.4 violations). */
  | 'PF_PLAN_INCONSISTENT'
  /** §4 step 3 — server-side closure blob capture failed (I/O or git). */
  | 'PF_BASE_CAPTURE'
  /** §4 step 4 — `proposed_items` empty. */
  | 'PF_ITEMS_EMPTY'
  /** §4 step 4 — a `KEEP.ref` does not exist in the current canonical. */
  | 'PF_KEEP_REF_MISSING'
  /** §4 step 4 — a `KEEP.ref` exists but lies OUTSIDE the replacement span (fork, merge) (would duplicate the item in the materialized plan — §4.4 无重复的机械保证; 纯插入时 span 为空 ⇒ KEEP 一律不合法). */
  | 'PF_KEEP_REF_OUTSIDE_SPAN'
  /** §4 step 4 — the same canonical item is KEEP-referenced twice. */
  | 'PF_KEEP_REF_DUPLICATE'
  /** §4 step 4 — a `KEEP.ref` id prefix disagrees with the declared `kind` (类型一致性). */
  | 'PF_ITEM_KIND_MISMATCH'
  /** §4 step 4 — a `NEW.spec` fails the frozen per-kind item spec schema. */
  | 'PF_SPEC_INVALID'
  /** §4 step 5 — an anchor is neither a (policy-allowed) sentinel nor a canonical item id. */
  | 'PF_ANCHOR_MISSING'
  /** §4 step 5 — fork ordinal > merge ordinal (§2.2 顺序非法). */
  | 'PF_ANCHOR_ORDER'
  /** §4 step 5 — policy anchor constraint violated (sentinel disallowed / required_item_types). */
  | 'PF_ANCHOR_POLICY'
  /** §4 step 6 — policy `triggers.require_at_least_one` and `trigger_refs` empty. */
  | 'PF_TRIGGERS_EMPTY'
  /** §4 step 6 — a trigger ref kind is not in policy `allowed_kinds`. */
  | 'PF_TRIGGER_KIND_FORBIDDEN'
  /** §4 step 6 — a trigger ref id prefix disagrees with its kind (类型一致性). */
  | 'PF_TRIGGER_REF_INVALID'
  /** §4 step 6 — a trigger ref does not exist (写入时存在性校验, §16.3). */
  | 'PF_TRIGGER_MISSING'
  /** §4 step 7 — `reason` empty. */
  | 'PF_REASON_EMPTY'
  /** §4 step 7 — `necessity` empty. */
  | 'PF_NECCESSITY_EMPTY'
  /** §4 step 8 — `created_by_run` has no run row. */
  | 'PF_RUN_NOT_FOUND'
  /** §4 step 8 — the run belongs to a different workstream (§6.1 formal run 绑定). */
  | 'PF_RUN_WS_MISMATCH'
  /** Store: no plan_fork row with this id. */
  | 'PF_NOT_FOUND'
  /** State machine: transition not in the §10 table (or concurrent-move gate). */
  | 'PF_WRONG_STATE'
  /** The frozen operational plan-fork schema set is unavailable. */
  | 'PF_SCHEMA_UNAVAILABLE'
  /** A plan_fork/management_action table operation failed (wrapped driver/SQL). */
  | 'PF_STORE'

/**
 * One precisely-located PlanFork violation (ARCHITECTURE §10: 错误信息指明
 * 失败项 — code + 失败步骤 (creation path) + 位置摘要, no guess-repair).
 * Mutating operations throw the FIRST violated check before any write.
 */
export class PlanForkError extends Error {
  readonly code: PlanForkErrorCode
  /** The failed §4 step (creation-path errors only; undefined for store/transition errors). */
  readonly step?: CreateStep
  /** JSON-pointer-style location inside the input/record (e.g. `/proposed_items/2/ref`). */
  readonly path?: string

  constructor(init: { code: PlanForkErrorCode; message: string; step?: CreateStep; path?: string; cause?: unknown }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'PlanForkError'
    this.code = init.code
    this.step = init.step
    this.path = init.path
  }
}

/** Type guard for `PlanForkError` (service layer / tests). */
export function isPlanForkError(error: unknown): error is PlanForkError {
  return error instanceof PlanForkError
}

/* ------------------------------------------------------------------ *
 * Injected I/O ports (the only seams out of this pure domain module —
 * 「注入 I/O 接口同其他 domain 模式」: WP-1.1 reader / WP-1.6 allocator /
 * WP-2.5 schema-reader 同型; production 实现在 service/git 层或测试假件)
 * ------------------------------------------------------------------ */

/**
 * Step 2 — current canonical plan view of one workstream (服务端现读;
 * production = WP-1.3 `PlanStore.loadPlan` / WP-1.1 loader tree 后端 —
 * tests 用真实 PlanStore 接线, 见 tests/planfork/fixtures.ts).
 *
 * INV-PLAN-1 半边: `ordered_items` 逐字按文件顺序 (不排序不去重);
 * `consistent` = §4.4 元素约束全过 (定义文件存在 ∧ 属本 WS ∧ 无重复)。
 */
export interface CanonicalPlanView {
  /** The requested WS id. */
  readonly workstream_id: string
  /** The `.research`-relative workstream directory (`topics/<TPC>/workstreams/<WS>`). */
  readonly wsDir: string
  /** The workstream directory exists (§4 步骤 2 「workstream_id 存在」). */
  readonly workstream_exists: boolean
  /** `plan.yaml` exists (§4 步骤 2 「canonical plan 已加载」的存在半边). */
  readonly present: boolean
  /** `ordered_items` VERBATIM (INV-PLAN-1); `[]` when absent. */
  readonly ordered_items: readonly string[]
  /** All §4.4 element checks passed (present ∧ well-formed plan). */
  readonly consistent: boolean
  /** The first inconsistency, precise (when `consistent` is false). */
  readonly problem?: string
}
export interface CanonicalPlanProvider {
  /** Load the current canonical plan of `workstreamId` (fresh read, no cache). */
  load(workstreamId: string): CanonicalPlanView
}

/**
 * Step 3 — server-side closure base capture (INV-PLAN-6 的结构性保证:
 * 创建输入**没有** base 参数; 基准永远由服务端重算, PLAN_FORK_SPEC §4
 * 步骤 3 / §3.2). Production 实现 = git 层 `git hash-object -- <path>`
 * (GIT_INTEGRATION §7 W3, working-copy 内容, 无需 commit) + `HEAD` 读取;
 * tests 用内容哈希假件。
 */
export interface ClosureBlobBase {
  /**
   * The closure file set with working-copy blob OIDs — 稳定集合: 本模块
   * 以「plan.yaml 在前 + 按 canonical 顺序的 item 定义文件」产出 (顺序对
   * stale 判定无意义 — WP-3.2 集合比较; 稳定顺序只为可重现)。
   */
  readonly objects: readonly BasePlanObject[]
  /** HEAD at capture time (信息性; 不参与 stale 判定 — §3.2). */
  readonly gitCommit?: string
}
export interface ClosureBlobCapturer {
  /**
   * Capture the blob OIDs of every `.research`-relative `closure` path
   * (the §3.1 closure computed by `closureRelativePaths`). Throws on any
   * I/O/git failure (the creation chain wraps it as PF_BASE_CAPTURE).
   */
  capture(wsDir: string, closure: readonly string[]): ClosureBlobBase
}

/**
 * Step 8 — formal run lookup (DOMAIN_SCHEMA §6.1: Formal Run 必须绑定
 * Workstream). Production = WP-2.4 `run` 表 (`getRun`); tests = map 假件。
 */
export interface FormalRunView {
  readonly id: string
  readonly workstream_id: string
  readonly task_id?: string
}
export interface FormalRunLookup {
  /** The run row, or `null` when no run has this id. */
  get(runId: string): FormalRunView | null
}

/**
 * Step 6 — trigger ref existence (§16.3 写入时校验; §7 语义标签 operational
 * 表 + §4.3/§9.1 声明式对象). Production = claim/fact/artifact 表 +
 * milestone/objective 声明式解析; tests = set 假件。
 */
export interface TriggerRefResolver {
  /** True iff the referenced object exists. */
  exists(ref: TriggerRef): boolean
}

/**
 * The operational DB surface this module persists through — a structural
 * mirror of the `node:sqlite` `DatabaseSync` usage pattern the
 * persistence/store + WP-2.4 runbinding tables follow (exec 幂等 DDL,
 * 参数化 run/get/all, BEGIN IMMEDIATE 事务). The domain stays pure
 * (ARCHITECTURE §2.2 rule 1: no sqlite import): the driver is the injected
 * I/O, and DDL + row mapping live in this directory (schema.ts).
 * `run` returns affected-row count (the optimistic state-machine gate).
 */
export type SqlParam = string | number | null
export interface PlanForkDb {
  /** Execute one or more statements without parameters (idempotent DDL). */
  exec(sql: string): void
  /** Run one parameterized write; returns affected rows. */
  run(sql: string, ...params: SqlParam[]): number
  /** Fetch one row (undefined when absent). */
  get(sql: string, ...params: SqlParam[]): Record<string, unknown> | undefined
  /** Fetch all matching rows. */
  all(sql: string, ...params: SqlParam[]): Record<string, unknown>[]
  /** ONE transaction (BEGIN IMMEDIATE … COMMIT; any throw → ROLLBACK). */
  transaction<T>(work: () => T): T
}
