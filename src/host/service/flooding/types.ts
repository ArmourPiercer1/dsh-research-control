/**
 * WP-3.5 — PlanFork flooding detection + AUTO_FLOODING Intervention:
 * type surface (types, error taxonomy, ports, options).
 *
 * Frozen contracts implemented here (all read-only):
 *  - PLAN_FORK_SPEC §8 (Flooding 检测, 逐字):
 *      触发点: 每次 PF 创建后; 每次 plan 加载后;
 *      规则: `count(status == OPEN 的 PF, per workstream) > threshold`
 *            （默认 5，policy 可调）且该 workstream **不存在** origin=
 *            AUTO_FLOODING 的 OPEN Intervention;
 *      口径 (A-15 修订, 用户确认): per-WS 独立计数（区域口径的工程简化）;
 *      动作: 创建 Intervention（title `Review accumulated agent plan forks
 *            [WS-<n>]`，origin=AUTO_FLOODING，source_refs=[相关 PF]）+
 *            INTERVENTION_CREATED History 事件（actor=PLUGIN，owner=该 WS）;
 *      V1 不做更复杂自动限流（**不阻止后续 PF 创建**）;
 *  - PLAN_FORK_SPEC §9 (`flooding.threshold` — 唯一 flooding policy 字段,
 *    默认 5; 冻结 schema 约束 integer ≥ 1);
 *  - DOMAIN_SCHEMA §9.2 (Intervention 字段表: 11 键 snake_case, origin 4 枚举,
 *    status 仅用户显式修改 INV-PERM-4, workstream_ids 可由 source_refs 推导)
 *    + §13 (Intervention 状态机: OPEN ↔ PENDING; OPEN|PENDING → CLOSED 终态;
 *    仅用户; 重开 = 新 Intervention) + §15 (`intervention` PK id + 索引
 *    (status); 通则不 hard delete — INV-HIST-7);
 *  - DOMAIN_SCHEMA §12.1 核查结论: ManagementAction 的 15 值 action_kind 枚举
 *    **不含**任何 Intervention 创建 kind ⇒ 本 WP 不落 ManagementAction 账本行
 *    （记录面 = operational `intervention` 行 + INTERVENTION_CREATED 事件）;
 *  - HISTORY_EVENT_CATALOG §5.7 (INTERVENTION_CREATED: intervention_id(新建)/
 *    title/origin/source_refs?; owner = 第一个关联 WS; origin=AUTO_* ⇒
 *    actor.kind=PLUGIN; 完全无 WS 关联不发事件);
 *  - ARCHITECTURE §5.10 INV-ATTN-5 (自动创建仅限 §6 脚注 ¹ 三类机械触发:
 *    PlanFork flooding 超阈值 / audit 高影响 unresolved discrepancy / 运行时
 *    明确要求人工判断的 Agent report; **不**因 Claim scientific conflict)
 *    + §6 权限矩阵行「Intervention 创建 P=仅机械触发¹」「Intervention
 *    OPEN/PENDING/CLOSED 仅 U」;
 *  - schema/operational/attention.schema.json ($defs/Intervention 冻结形状,
 *    additionalProperties:false) + schema/common.schema.json (idIntervention
 *    `^IV-[1-9][0-9]*$` / typedRef / actorRef / epochMs / idWorkstream);
 *  - HISTORY_EVENT_CATALOG §4 + schema/history (INTERVENTION_CREATED 事件形状)。
 *
 * ## 不阻止创建（类型面 + 运行面双钉）
 *
 * PLAN_FORK_SPEC §8 末行: 「V1 不做更复杂自动限流（不阻止后续 PF 创建）」。
 * 类型面: `FloodingCheckResult.blocked` 的字面类型是 `false`——本模块不产出
 * 任何「拒绝创建」信号, 宿主接线 WP 无法（也不需要）用钩子返回值阻止 PF 创建。
 * 运行面: `onPlanForkCreated`/`onPlanLoaded` 钩子**永不抛**——检测/建 Intervention/
 * 发事件任何一步失败都收敛为结果内的结构化 `error`（PF 创建本身已在钩子之前
 * 提交, 钩子失败不产生任何回滚/拒绝语义）。
 *
 * ## INV-ATTN-5 机械触发闭集（类型面）
 *
 * 自动 Intervention 来源 = 冻结 4 值 origin 中的 AUTO_* 半集 + ARCHITECTURE
 * §6 脚注 ¹ 的三类机械触发闭集 `MECHANICAL_TRIGGER_KINDS`。本 WP 只实现其中
 * `PLAN_FORK_FLOODING` 一类（AUTO_FLOODING）; 构建面 `buildAutoFloodingIntervention`
 * **不接受 origin 参数**（常量钉死）——其他触发类归各自 WP（audit / agent
 * report 面）, Claim scientific conflict 永远不在此列（INV-ATTN-5）。
 *
 * ## Intervention 状态迁移面（INV-PERM-4）
 *
 * 「仅用户显式修改」⇒ 本 WP **不提供任何迁移面**（无 store 迁移方法、无
 * service 迁移操作）——类型面即闭集: `InterventionStore` 只有
 * insert/query 方法（测试以原型键审计钉死）; §13 迁移表只以纯函数形式
 * 交付（state-machine.ts）供未来用户面 WP 与测试消费。
 *
 * Layer (ARCHITECTURE §2.2): service 层 — 唯一写 operational DB 的层;
 * 检测器/构建器/状态机为纯函数。无 DSH import (INV-PERM-5)。
 */

import type { ActorRef, HistoryEventRegistry, TypedRef, WorkstreamSnapshot } from '../../history/registry/index.js'
import type { PlanForkDb, PlanForkRecord, PlanForkStore } from '../../domain/planfork/index.js'
// type-only (erased at runtime — no cycle in the emitted JS):
import type { InterventionStore } from './store.js'
import type { ResearchFileReader } from '../../domain/loader/index.js'
import type { IdAllocator } from '../../../shared/ids/index.js'
import type { ResearchStore } from '../../persistence/store/index.js'

/* ------------------------------------------------------------------ *
 * Intervention record (DOMAIN_SCHEMA §9.2; frozen attention.schema.json
 * $defs/Intervention — 11 键 snake_case 逐字同构, additionalProperties:false)
 * ------------------------------------------------------------------ */

/** The 4 frozen Intervention origins (attention.schema.json `origin` enum). */
export const INTERVENTION_ORIGINS = ['USER', 'AGENT_REPORT', 'AUTO_FLOODING', 'AUTO_AUDIT'] as const
export type InterventionOrigin = (typeof INTERVENTION_ORIGINS)[number]

/**
 * The 3 Intervention states (DOMAIN_SCHEMA §13: `OPEN ↔ PENDING`;
 * `OPEN | PENDING → CLOSED` 终态; 仅用户显式修改, INV-PERM-4).
 */
export const IV_STATUSES = ['OPEN', 'PENDING', 'CLOSED'] as const
export type IvStatus = (typeof IV_STATUSES)[number]

/**
 * One `intervention` row (§9.2 字段表; frozen $defs/Intervention 逐字同构)。
 * 全字段 readonly: 内容创建后不可变（存储层 trigger 兜底）; 状态缓存列
 * (status/closed_at/resolution_note) 的合法 UPDATE 面 = 未来用户面 WP
 * （本 WP 不提供 — INV-PERM-4）。
 */
export interface InterventionRecord {
  /** IV id (§1.1: `IV-<n>`, PROJECT scope, 创建时分配). */
  readonly id: string
  /** §8 原文: `Review accumulated agent plan forks [WS-<n>]` (AUTO_FLOODING 面). */
  readonly title: string
  /** 机械证据摘要（窗口/计数/阈值 — §8 动作的证据字段落点, 自由文本）. */
  readonly detail?: string
  /** 自动来源仅限 §6 脚注 ¹ 机械触发（INV-ATTN-5）. */
  readonly origin: InterventionOrigin
  /** 关联 WS; `INTERVENTION_CREATED` 事件 owner = 第一个（§9.2/§5.7）. */
  readonly workstream_ids: readonly string[]
  /** 指向触发对象（§8: 相关 PF）. */
  readonly source_refs: readonly TypedRef[]
  /** 初始 OPEN; 仅用户显式迁移（INV-PERM-4; 本 WP 无迁移面）. */
  readonly status: IvStatus
  /** §8 动作: origin=AUTO_FLOODING ⇒ created_by.kind=PLUGIN（actor=PLUGIN）. */
  readonly created_by: ActorRef
  /** epoch ms (A-3). */
  readonly created_at: number
  /** 用户关闭时 (本 WP 不写). */
  readonly closed_at?: number
  /** 关闭时用户填写 (本 WP 不写). */
  readonly resolution_note?: string
}

/* ------------------------------------------------------------------ *
 * INV-ATTN-5 — 机械触发闭集（ARCHITECTURE §6 脚注 ¹, 逐字三类的稳定编码）
 * ------------------------------------------------------------------ */

/**
 * The CLOSED SET of mechanical triggers that may auto-create an Intervention
 * (ARCHITECTURE §6 脚注 ¹, 逐字三类):
 *   1. `PLAN_FORK_FLOODING`               — PlanFork flooding 超阈值 (本 WP);
 *   2. `AUDIT_HIGH_IMPACT_DISCREPANCY`    — audit 高影响 unresolved discrepancy;
 *   3. `AGENT_REPORT_REQUIRES_HUMAN`      — 运行时明确要求人工判断的 Agent report。
 * **不**含 Claim scientific conflict（INV-ATTN-5 明言）——该闭集即 INV-ATTN-5
 * 「自动来源仅限机械触发」的类型面, tests/flooding 以逐字断言钉死。
 */
export const MECHANICAL_TRIGGER_KINDS = [
  'PLAN_FORK_FLOODING',
  'AUDIT_HIGH_IMPACT_DISCREPANCY',
  'AGENT_REPORT_REQUIRES_HUMAN',
] as const
export type MechanicalTriggerKind = (typeof MECHANICAL_TRIGGER_KINDS)[number]

/** The member of the closed set THIS WP implements (the only one). */
export const THIS_WP_MECHANICAL_TRIGGER: MechanicalTriggerKind = 'PLAN_FORK_FLOODING'

/* ------------------------------------------------------------------ *
 * Flooding detection (PLAN_FORK_SPEC §8 规则的纯函数面)
 * ------------------------------------------------------------------ */

/**
 * §8 规则的观察窗口: 该 WS 当前 **OPEN 状态集**（冻结规则无时间窗——
 * 「count(status == OPEN 的 PF, per workstream)」; 窗口随状态迁移滑动:
 * PF 离开 OPEN（STALE/SELECTED/DISMISSED）即滑出计数, 新创建滑入）。
 */
export interface FloodingWindow {
  readonly kind: 'OPEN_STATE'
  /** 观察时刻 (epoch ms, 调用方注入的 now()). */
  readonly as_of: number
  /** 窗口内 OPEN PF id（稳定顺序: created_at ASC, id ASC）。 */
  readonly open_pf_ids: readonly string[]
}

/** 结构化证据（任务口径: 窗口/计数/阈值 — 检测输出 + Intervention detail 来源）。 */
export interface FloodingEvidence {
  readonly workstream_id: string
  readonly window: FloodingWindow
  /** `count(status == OPEN, per workstream)`（A-15 per-WS 口径, 用户确认）。 */
  readonly count: number
  /** §9 `flooding.threshold`（缺省 = §8 原文默认 5）。 */
  readonly threshold: number
  /** 冻结规则原文（证据可读性）。 */
  readonly rule: string
}

export type FloodingVerdictReason = 'COUNT_AT_OR_BELOW_THRESHOLD' | 'OPEN_AUTO_FLOODING_EXISTS'

/**
 * §8 规则判定:
 *  - `triggered`  ⇔ count(OPEN, per WS) > threshold（严格大于 — §8 原文）;
 *  - `suppressed` ⇔ 该 WS 已存在 origin=AUTO_FLOODING 的 OPEN Intervention
 *    （§8 规则后半句 + 任务「重复抑制」—— 同 WS 已有 OPEN 时不重复建）。
 * 应建 Intervention ⇔ `triggered && !suppressed`。
 */
export interface FloodingVerdict {
  readonly triggered: boolean
  readonly suppressed: boolean
  /** 未「应建」时的机械原因（应建时 undefined）。 */
  readonly reason?: FloodingVerdictReason
  readonly evidence: FloodingEvidence
}

/** `detectPlanForkFlooding` 输入（纯函数; 全只读）。 */
export interface FloodingDetectionParams {
  /** 被检 WS（per-WS 口径 — A-15 修订, 每 Workstream 独立计数）。 */
  readonly workstreamId: string
  /**
   * 观察窗口内的 PF 记录（该 WS 的 PF 创建记录; 任意状态均可传入, 检测器
   * 只计 OPEN 子集）。必须全部属 `workstreamId`（跨 WS 混合 ⇒ FLOODING_INPUT
   * — per-WS 口径的结构性保证）。
   */
  readonly planForks: readonly PlanForkRecord[]
  /** §9 `flooding.threshold`（service 从 policy 读; 缺省 = §8 默认 5）。 */
  readonly threshold?: number
  /** §8 规则后半句的探针（service 经 intervention 表查）。 */
  readonly hasOpenAutoFloodingIntervention?: boolean
  /** 观察时刻 (epoch ms)。 */
  readonly asOf: number
}

/* ------------------------------------------------------------------ *
 * Hook surface (接线缝 — 宿主接线 WP 挂到 PF 创建流 / plan 加载流)
 * ------------------------------------------------------------------ */

/** §8 两个触发点（每次 PF 创建后 / 每次 plan 加载后）的稳定编码。 */
export const FLOODING_TRIGGERS = ['PLAN_FORK_CREATED', 'PLAN_LOADED'] as const
export type FloodingTrigger = (typeof FLOODING_TRIGGERS)[number]

/** 钩子内部失败的结构化描述（钩子永不抛 — 非阻塞契约）。 */
export interface FloodingCheckError {
  readonly code: FloodingErrorCode
  readonly message: string
}

/**
 * `onPlanForkCreated` / `onPlanLoaded` 的返回值 — **仅信息性**:
 * PF 创建已在钩子之前提交, 本结果不携带任何可回滚/可拒绝的语义;
 * `blocked` 字面类型 `false` 是不阻止创建（§8 末行）的类型面。
 */
export interface FloodingCheckResult {
  readonly workstream_id: string
  readonly trigger: FloodingTrigger
  /** 检测器跑出了判定（false ⇒ `error` 已设, 检查提前中止）。 */
  readonly checked: boolean
  readonly verdict?: FloodingVerdict
  /** 本次检查创建了 OPEN AUTO_FLOODING Intervention 时 = 其 IV id。 */
  readonly intervention_id?: string
  /** 同时 append 的 INTERVENTION_CREATED 事件 id (H id)。 */
  readonly event_id?: string
  /** 检测永不阻止创建（§8 V1; 类型面钉死 — 只能为 false）。 */
  readonly blocked: false
  readonly error?: FloodingCheckError
}

/* ------------------------------------------------------------------ *
 * Error taxonomy
 * ------------------------------------------------------------------ */

export type FloodingErrorCode =
  /** 模块边界参数畸形（空/坏形状/跨 WS 混合/坏阈值/坏 id 模式 — 精确指名失败项）。 */
  | 'FLOODING_INPUT'
  /** §9 policy 装载/解读失败（上游 PF_POLICY_INVALID 包进来; 检查中止, 不建 Intervention）。 */
  | 'FLOODING_POLICY'
  /** `intervention` 表操作失败（驱动/SQL 包一层, cause 保留）。 */
  | 'FLOODING_STORE'
  /** INTERVENTION_CREATED 事件构造/registry 校验/store append 失败。 */
  | 'FLOODING_EVENT'
  /** §13 Intervention 状态机非法迁移（纯函数面; 本 WP 无迁移调用面）。 */
  | 'FLOODING_ILLEGAL_TRANSITION'
  /** 冻结 attention schema 不可用（记录形状无法校验 — fail loud）。 */
  | 'FLOODING_SCHEMA_UNAVAILABLE'

export class FloodingError extends Error {
  readonly code: FloodingErrorCode
  constructor(init: { code: FloodingErrorCode; message: string; cause?: unknown }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'FloodingError'
    this.code = init.code
  }
}

export function isFloodingError(error: unknown): error is FloodingError {
  return error instanceof FloodingError
}

/* ------------------------------------------------------------------ *
 * Frozen attention schema face (schemas.ts 实现的契约)
 * ------------------------------------------------------------------ */

export interface InterventionSchemaError {
  readonly path: string
  readonly message: string
}

export interface InterventionShapeCheck {
  readonly ok: boolean
  readonly errors: readonly InterventionSchemaError[]
}

/** 冻结 `attention.schema.json` 装载面（schemas.ts `loadInterventionSchemas`）。 */
export interface InterventionSchemas {
  readonly schemaDir: string
  /** false ⇒ 每个检查都报告不可用（isUsable=false ⇒ store 拒绝写入, fail loud）。 */
  readonly isUsable: boolean
  readonly loadErrors: readonly InterventionSchemaError[]
  /** 整记录过冻结 `$defs/Intervention`（additionalProperties:false 网）。 */
  readonly checkInterventionShape: (record: unknown) => InterventionShapeCheck
}

/* ------------------------------------------------------------------ *
 * Ports + options（DI 面 — 同 WP-2.4/WP-3.1 模式）
 * ------------------------------------------------------------------ */

/**
 * operational DB 结构端口 — 复用 WP-3.1 `PlanForkDb`（node:sqlite
 * DatabaseSync 使用面的结构镜像: exec/run/get/all/transaction; 域层零
 * sqlite import 的同款纪律, 驱动是注入的 I/O）。
 */
export type FloodingDb = PlanForkDb

/** 事件校验上下文的外部（声明式侧）快照面 — 同 WP-2.4 `externalState` 缝。 */
export interface FloodingExternalState {
  /** workstream id → 快照（INTERVENTION_CREATED 的 WORKSTREAM ref 存在性 + owner 推导）。 */
  readonly workstreams: ReadonlyMap<string, WorkstreamSnapshot>
}

/**
 * `InterventionStore` 构造选项（DI — 同 WP-3.1 `PlanForkStoreOptions`）。
 * id 分配（IV 族）**不在 store**: 记录带着已分配 id 到达
 * （service 协调 IV + H 双号 reserve/commit/release — 事件先行纪律,
 * 见 service.ts）; store 只做写入 + 查询。
 */
export interface InterventionStoreOptions {
  /** 注入的 operational-DB 面（第二连接模式; schema.ts 幂等 DDL）。 */
  readonly db: FloodingDb
  /** 冻结 attention schema 面（真实 `schema/operational/attention.schema.json`）。 */
  readonly schemas: InterventionSchemas
}

/** `FloodingService` 构造选项（宿主接线 WP 组装）。 */
export interface FloodingServiceOptions {
  /** WP-2.1 ResearchStore（INTERVENTION_CREATED append + meta）。 */
  readonly store: ResearchStore
  /** WP-2.2 事件 registry（validate hook — 未过校验的事件永不落地）。 */
  readonly registry: HistoryEventRegistry
  /** WP-3.1 PlanForkStore（OPEN PF 计数/列举缝 — `listPlanForks`）。 */
  readonly planForks: PlanForkStore
  /** 本 WP intervention 表面（insert/query; 无 delete/无迁移 — INV-PERM-4）。 */
  readonly interventions: InterventionStore
  /** 共享 id allocator（IV + H 族）。 */
  readonly allocator: IdAllocator
  readonly projectId: string
  /** `.research` 文件读（§9 policy fresh 装载, 同 WP-3.1 创建流）。 */
  readonly researchFileReader: ResearchFileReader
  /** `.research` 根（reader 键前缀, 如 `/mem/ws/.research` 或真实绝对路径）。 */
  readonly researchRoot: string
  /** 冻结 declarative schema 目录（policy schema 装载）。 */
  readonly schemaDir: string
  /** 声明式侧快照（事件校验 ctx 的 workstreams map）。 */
  readonly externalState: () => FloodingExternalState
  readonly now?: () => number
}

/**
 * `InterventionStore` 的查询过滤器（§15 索引 (status) + 本 WP 的
 * per-WS/origin 面）。
 */
export interface InterventionListFilter {
  readonly workstreamId?: string
  readonly status?: IvStatus
  readonly origin?: InterventionOrigin
}

/* Re-exported for the wiring side (single import surface). */
export type { PlanForkRecord }
