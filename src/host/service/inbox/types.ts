/**
 * WP-6.4 — `InboxService` type surface（Research Inbox —
 * DOMAIN_SCHEMA §11 / 计划书 §28 / §22.3）。
 *
 * 冻结契约依据（只读）:
 *  - DOMAIN_SCHEMA §11（Research Inbox 字段表: `id` IN id / `source`
 *    InboxSource / `payload` string 必填 / `raw` any 可选 /
 *    `context_refs` TypedRef[] 可选 / `state` InboxState / `converted_to`
 *    TypedRef 可选「需显式确认或明确 policy」/ `created_at` epoch ms;
 *    「Capture-first staging layer; Inbox item **不是正式科研状态**」）+
 *    §1.4 全局枚举（`InboxSource` 7 值 / `InboxState` 3 值, 逐字）+
 *    §13（InboxItem 状态机: `CAPTURED → CONVERTED | DISMISSED`（终态）;
 *    非法转换在 service 层拒绝, INV-TASK-1 同款纪律）+ §15（`inbox_item`
 *    表: PK `id` + 索引 `(state, created_at)`; 通则不 hard delete —
 *    INV-HIST-7）;
 *  - 计划书 §28（Research Inbox: 来源 7 类逐字; 「Inbox item 不是正式科研
 *    状态」; 用户/只读 Agent 可建议转换为 **Task / NextAction /
 *    Intervention / Claim / Fact / ReportingItem / Interaction** — 本文件
 *    `CONVERSION_TARGET_KINDS` 逐字同构; 「转换需要显式确认或明确 policy」
 *    = 本模块转换面 `UserActorRef` 参数类型 + 运行面断言 — 类型面显式
 *    确认, 同 WP-5.1 INV-PERM-4 双面先例）;
 *  - 计划书 §22.3（Reconciliation 三档: AUTO_RECONCILE / PROPOSE_RECONCILI-
 *    ATION / **ESCALATE: 高影响/未知/损失 → Intervention** — 本模块
 *    高影响升级 = 该档的机械判定 + Intervention 创建联动; 三档分类本身
 *    归 WP-6.3, 本模块是其 ESCALATE 档的落库联动面, 见 escalation.ts）;
 *  - schema/operational/inbox.schema.json（$defs/InboxItem 冻结行形状 —
 *    additionalProperties:false 网; 落库前整行过真实冻结形状网, 同
 *    WP-3.5 intervention / WP-5.1 lifecycle 先例）;
 *  - common.schema.json（`idInboxItem` `^IN-[1-9][0-9]*$` / `typedRef` /
 *    `epochMs`）;
 *  - DOMAIN_SCHEMA §12.1（ManagementAction `action_kind` 15 值冻结枚举含
 *    **INBOX_CONVERTED** — 转换 provenance 账本行; provenance.schema.json
 *    逐字, 复用 WP-3.1 planfork 记录类型/SQL 面）。
 *
 * ## 条目构造器接缝（任务目标 1: 机械入口 audit/discovery/reconcile/
 * flooding）
 *
 *  - `captureHuman(params, actor: UserActorRef)` — source 常量
 *    HUMAN_QUICK_CAPTURE（构建面不接受 source 参数 — 类型即闭集）;
 *  - `captureMechanical(params, actor: MechanicalActorRef)` — source ∈
 *    6 个非 HUMAN 值（`MECHANICAL_INBOX_SOURCES` 类型闭集）:
 *    UNCLASSIFIED_AUDIT_FINDING（audit strict 未分类发现, WP-6.1 缝）/
 *    UNREGISTERED_WORKSPACE_CHANGE（discovery 未登记变化, WP-6.2 缝 —
 *    GIT_INTEGRATION §8「发现未登记产物 -> Inbox（UNREGISTERED_WORKSPACE_
 *    CHANGE）」）/ IMPORTED_MEETING_NOTE / AGENT_UNSTRUCTURED_REPORT /
 *    EXTERNAL_NOTE / DISCOVERED_SESSION。
 *    WP-6.3 reconciliation 三档的 PROPOSE_RECONCILIATION（需确认的材料
 *    进 Inbox 等待用户）与 ESCALATE（`escalateMechanical`）都经本接缝
 *    落库 — 接缝 = 本类型面, 零第二入口。
 *
 * ## 转换流（任务目标 1: §28 原文转换动作集）
 *
 * `convert(params, actor: UserActorRef)` — 转换需要**显式确认**:
 *  - 类型面: actor 参数类型 `UserActorRef`（非 USER actor = 编译错误）+
 *    `fields` 判别联合必须与 `targetKind` 配对（类型即配对检查）;
 *  - 运行面: `assertUserActor`（伪造非 USER actor ⇒ IN_ACTOR_FORBIDDEN,
 *    零写入）+ targetKind 闭集再断言（JS 调用者绕过类型的兜底）;
 *  - 正式对象经注入的 `conversionTargets` 执行器端口创建（生产接线传
 *    WP-5.1/5.2/5.3 真实 service 闭集 — 本模块零业务重复, 零 DSH import,
 *    INV-PERM-5）; 未接线 kind ⇒ IN_TARGET_NOT_WIRED 大声失败（V1 诚实
 *    边界: CLAIM/FACT 记录 service 与 TASK 声明式完成内核尚未交付 —
 *    见报告「未决」）。
 *
 * ## 高影响升级（任务目标 1: §22.3 ESCALATE 档）
 *
 * `escalateMechanical(params, actor: MechanicalActorRef)`:
 *  - 机械判定（escalation.ts 纯函数 `assessEscalation`）: 批量影响
 *    （affectedPathCount ≥ threshold, 默认 5 — 对齐 WP-3.5
 *    DEFAULT_FLOODING_THRESHOLD 口径）/ 关键路径（strict-tracked 第一层
 *    路径被触及 — §14.1「关键代码 / Task deliverables / merge 相关文件」）/
 *    损失（删除）三规则, 零自由度、零语义判断;
 *  - 恒先 capture 条目（capture-first: 升级也是 Inbox 的一条目 —
 *    机械证据落 `raw` + `context_refs`）;
 *  - highImpact ⇒ Intervention 创建联动（注入 `mechanicalIntervention-
 *    Creator` 端口 — 生产 = WP-5.1 `createMechanicalIntervention`
 *    trigger=AUDIT_HIGH_IMPACT_DISCREPANCY ⇒ origin AUTO_AUDIT,
 *    INV-ATTN-5 闭集成员）, source_refs 以 INBOX_ITEM ref 打头。
 *
 * Layer (ARCHITECTURE §2.2): service — 唯一写 operational DB 的层。
 * 无 DSH import (INV-PERM-5)。
 */

import type { TypedRef } from '../../history/registry/index.js'
import type { ManagementActionRecord } from '../../domain/planfork/index.js'
import type { IdAllocator } from '../../../shared/ids/index.js'
import type { InboxStore } from './store.js'

/* ------------------------------------------------------------------ *
 * 冻结枚举（DOMAIN_SCHEMA §1.4 逐字 — 值集与顺序钉死）
 * ------------------------------------------------------------------ */

/** `InboxSource` 7 值（§1.4 逐字）。 */
export const INBOX_SOURCES = [
  'HUMAN_QUICK_CAPTURE',
  'UNCLASSIFIED_AUDIT_FINDING',
  'IMPORTED_MEETING_NOTE',
  'UNREGISTERED_WORKSPACE_CHANGE',
  'AGENT_UNSTRUCTURED_REPORT',
  'EXTERNAL_NOTE',
  'DISCOVERED_SESSION',
] as const

export type InboxSource = (typeof INBOX_SOURCES)[number]

/** `InboxState` 3 值（§1.4 逐字; §13: CAPTURED → CONVERTED|DISMISSED 终态）。 */
export const INBOX_STATES = ['CAPTURED', 'CONVERTED', 'DISMISSED'] as const

export type InboxState = (typeof INBOX_STATES)[number]

/** 用户类捕获的 source（常量 — `captureHuman` 不接受 source 参数）。 */
export const HUMAN_INBOX_SOURCE: InboxSource = 'HUMAN_QUICK_CAPTURE'

/** 机械捕获 source 闭集（6 值 — §1.4 去掉 HUMAN_QUICK_CAPTURE）。 */
export const MECHANICAL_INBOX_SOURCES = [
  'UNCLASSIFIED_AUDIT_FINDING',
  'IMPORTED_MEETING_NOTE',
  'UNREGISTERED_WORKSPACE_CHANGE',
  'AGENT_UNSTRUCTURED_REPORT',
  'EXTERNAL_NOTE',
  'DISCOVERED_SESSION',
] as const

export type MechanicalInboxSource = (typeof MECHANICAL_INBOX_SOURCES)[number]

/**
 * §28 转换动作集（原文: Task / NextAction / Intervention / Claim / Fact /
 * ReportingItem / Interaction — 7 类, 逐字映射为 TypedRef.kind 词面）。
 */
export const CONVERSION_TARGET_KINDS = [
  'TASK',
  'NEXT_ACTION',
  'INTERVENTION',
  'CLAIM',
  'FACT',
  'REPORTING_ITEM',
  'INTERACTION',
] as const

export type ConversionTargetKind = (typeof CONVERSION_TARGET_KINDS)[number]

/** `InteractionKind` 6 值（§1.4 逐字 — INTERACTION 转换目标的 kind 字段）。 */
export const INTERACTION_KINDS = [
  'MEETING',
  'AD_HOC_DISCUSSION',
  'SUPERVISOR_UPDATE',
  'COLLABORATOR_DISCUSSION',
  'EXPERIMENT_SHIFT_HANDOFF',
  'OTHER',
] as const

export type InteractionKind = (typeof INTERACTION_KINDS)[number]

/* ------------------------------------------------------------------ *
 * 行记录（冻结 inbox.schema.json $defs/InboxItem 同构 — SQL 侧类型面）
 * ------------------------------------------------------------------ */

/**
 * One inbox item row（§11 字段表逐字; snake_case 与冻结 schema 同形 —
 * 落库前整行过真实冻结形状网, 同 WP-3.5/WP-5.1 先例）。
 */
export interface InboxItemRecord {
  /** IN id（common.schema.json `idInboxItem` `^IN-[1-9][0-9]*$`; capture 时分配, §1.1）。 */
  readonly id: string
  readonly source: InboxSource
  /** 文本/摘要（§11 必填, 冻结 schema minLength 1）。 */
  readonly payload: string
  /** 原始数据（§11 可选 — 如 audit finding 细节 / 升级证据）。 */
  readonly raw?: unknown
  readonly context_refs: readonly TypedRef[]
  readonly state: InboxState
  /** 转换目标（§11: Task/NextAction/Intervention/Claim/Fact/ReportingItem/
   *  Interaction; 需显式确认或明确 policy — 仅 `convert` 写入）。 */
  readonly converted_to?: TypedRef
  readonly created_at: number
}

/* ------------------------------------------------------------------ *
 * 形状网面（冻结 inbox.schema.json 装载 — schemas.ts）
 * ------------------------------------------------------------------ */

export interface InboxSchemaError {
  readonly path: string
  readonly message: string
}

export interface InboxShapeCheck {
  readonly ok: boolean
  readonly errors: readonly InboxSchemaError[]
}

export interface InboxSchemas {
  readonly schemaDir: string
  readonly isUsable: boolean
  readonly loadErrors: readonly InboxSchemaError[]
  /** 整行冻结形状网（$defs/InboxItem; additionalProperties:false）。 */
  readonly checkInboxShape: (record: InboxItemRecord) => InboxShapeCheck
}

/* ------------------------------------------------------------------ *
 * Actor faces（类型面权限 — 转换显式确认的编译期半边）
 * ------------------------------------------------------------------ */

/**
 * USER actor ref（冻结 `actorRef` 限制到 kind=USER）。`convert` /
 * `dismiss` 的参数类型: 非 USER actor 是 **COMPILE 错误**（「转换需要显式
 * 确认」的类型面 — §28; 同 WP-5.1 UserActorRef 先例）; 运行时伪造仍被
 * IN_ACTOR_FORBIDDEN 拒绝（运行面）。
 */
export interface UserActorRef {
  readonly kind: 'USER'
  readonly user_id?: string
  readonly label?: string
}

/** The default user actor for GUI operations (matrix column U). */
export const USER_ACTOR: UserActorRef = { kind: 'USER', label: 'user' }

/**
 * 机械捕获/升级的 actor（kind AGENT | PLUGIN — 非 USER）。§11 未冻结
 * per-source 的 actor 配对矩阵（与 Intervention 创建不同 — 那里是
 * catalog §5.7 冻结面）⇒ 本面只钉「非 USER」: USER 有独立捕获面
 * （`captureHuman`）, 机械面接受 AGENT/PLUGIN 两类, 不做更窄配对（不
 * 虚构冻结契约没有的约束）。
 */
export interface MechanicalActorRef {
  readonly kind: 'AGENT' | 'PLUGIN'
  /** R id（AGENT 发射时可选携带 — 不校验 Run 存在性: capture 不发
   *  History 事件, actor 只落 provenance 上下文）。 */
  readonly run_id?: string
  readonly label?: string
}

/* ------------------------------------------------------------------ *
 * 捕获面（条目构造器接缝 — 任务目标 1）
 * ------------------------------------------------------------------ */

/** 捕获参数（§11 内容半边; id/state/created_at 由 service 分配/置位）。 */
export interface CaptureParams {
  /** 文本/摘要（非空 — 冻结 schema minLength 1）。 */
  readonly payload: string
  /** 原始数据（可选 — audit finding 细节 / discovery 候选 / 升级证据）。 */
  readonly raw?: unknown
  /** 关联对象（可选 — 如 PLAN_FORK/ARTIFACT/RUN/WORKSTREAM ref）。 */
  readonly contextRefs?: readonly TypedRef[]
}

/** 机械捕获参数: source = 6 值机械闭集（类型即闭集）。 */
export interface MechanicalCaptureParams extends CaptureParams {
  readonly source: MechanicalInboxSource
}

export interface CaptureResult {
  readonly item: InboxItemRecord
}

/* ------------------------------------------------------------------ *
 * 状态迁移结果（§13）
 * ------------------------------------------------------------------ */

/** 忽略结果（CAPTURED → DISMISSED 终态; 仅用户）。 */
export interface DismissResult {
  readonly inboxItemId: string
  readonly stateFrom: 'CAPTURED'
  readonly stateTo: 'DISMISSED'
}

/* ------------------------------------------------------------------ *
 * 转换面（§28 转换动作集 — 字段面按目标 kind 最小必填集）
 * ------------------------------------------------------------------ */

/** INTERVENTION 转换目标字段（§9.2 最小必填: title）。 */
export interface InterventionTargetFields {
  readonly kind: 'INTERVENTION'
  readonly title: string
  readonly detail?: string
  readonly workstreamIds?: readonly string[]
}

/** NEXT_ACTION 转换目标字段（§9.3 最小必填: statement）。 */
export interface NextActionTargetFields {
  readonly kind: 'NEXT_ACTION'
  readonly statement: string
  readonly rationale?: string
  readonly workstreamId?: string
}

/** REPORTING_ITEM 转换目标字段（§10.2 最小必填: audience + statement）。 */
export interface ReportingItemTargetFields {
  readonly kind: 'REPORTING_ITEM'
  readonly audience: string
  readonly statement: string
  readonly materialRefs?: readonly TypedRef[]
  readonly occasionRef?: string
}

/** INTERACTION 转换目标字段（§10.1 最小必填: kind + occurredAt + title）。 */
export interface InteractionTargetFields {
  readonly kind: 'INTERACTION'
  /** `InteractionKind` 6 值（§1.4 冻结）。 */
  readonly interactionKind: InteractionKind
  readonly occurredAt: number
  readonly title: string
  readonly participants?: readonly string[]
  readonly notes?: string
  readonly relatedWorkstreams?: readonly string[]
}

/** CLAIM 转换目标字段（§7.1 最小必填: workstreamId + statement）。 */
export interface ClaimTargetFields {
  readonly kind: 'CLAIM'
  readonly workstreamId: string
  readonly statement: string
  readonly references?: readonly string[]
}

/** FACT 转换目标字段（§7.2 最小必填: workstreamId + statement）。 */
export interface FactTargetFields {
  readonly kind: 'FACT'
  readonly workstreamId: string
  readonly statement: string
  readonly references?: readonly string[]
}

/** TASK 转换目标字段（§4.1 最小必填: workstreamId + title — 声明式完成
 *  内核的落点面; V1 执行器未接线, IN_TARGET_NOT_WIRED）。 */
export interface TaskTargetFields {
  readonly kind: 'TASK'
  readonly workstreamId: string
  readonly title: string
}

/** §28 转换动作集的字段判别联合（`kind` 与 `ConvertInboxParams.targetKind`
 *  必须配对 — 类型面检查; 运行面再断言）。 */
export type ConversionTargetFields =
  | InterventionTargetFields
  | NextActionTargetFields
  | ReportingItemTargetFields
  | InteractionTargetFields
  | ClaimTargetFields
  | FactTargetFields
  | TaskTargetFields

export interface ConvertInboxParams {
  readonly inboxItemId: string
  readonly targetKind: ConversionTargetKind
  /** 用户确认对话框的载荷（与 targetKind 配对的字段面）。 */
  readonly fields: ConversionTargetFields
}

export interface ConvertResult {
  /** 迁移后的条目（state=CONVERTED, converted_to 已写）。 */
  readonly item: InboxItemRecord
  /** 创建出的正式对象 ref（converted_to 同值）。 */
  readonly convertedTo: TypedRef
  /** INBOX_CONVERTED 账本行 id; 账本端口未接线 = `null`（不虚构 provenance）。 */
  readonly managementActionId: string | null
}

/**
 * 转换执行器端口（正式对象创建 — 生产接线传真实 WP service 闭集:
 * INTERVENTION ⇒ WP-5.1 createUserIntervention（USER origin）;
 * NEXT_ACTION ⇒ WP-5.2 ActionsService.createNextAction;
 * REPORTING_ITEM / INTERACTION ⇒ WP-5.3 ReportingService。CLAIM/FACT/TASK
 * 生产 service 未交付 — 执行器对该 kind 大声失败 IN_TARGET_NOT_WIRED
 * （诚实边界, 同 WP-5.2 NOT_WIRED_PROVIDER 纪律））。
 *
 * 契约: 成功 ⇒ 返回创建对象的 `TypedRef`（kind = 目标 kind 词面, id =
 * 新对象 id）; 失败 ⇒ 抛错（service 包装为 IN_CONVERT_TARGET — 条目状态
 * 不变, 保持 CAPTURED）。
 */
export interface InboxConversionTargetExecutor {
  execute(
    kind: ConversionTargetKind,
    fields: ConversionTargetFields,
    item: InboxItemRecord,
    occurredAt: number,
  ): TypedRef
}

/* ------------------------------------------------------------------ *
 * 高影响升级面（§22.3 ESCALATE 档 — 任务目标 1）
 * ------------------------------------------------------------------ */

/** 升级理由（机械规则名 — 冻结 3 值; 判定见 escalation.ts）。 */
export const ESCALATION_REASONS = ['STRICT_TRACKED_CHANGE', 'DELETION', 'BATCH_IMPACT'] as const

export type EscalationReason = (typeof ESCALATION_REASONS)[number]

/**
 * 升级证据（机械事实面 — WP-6.1 `AuditReport` / WP-6.2 discovery diff /
 * WP-6.3 reconcile 输出的机械字段; **不**含任何语义判断 — 判定由
 * `assessEscalation` 纯函数完成, INV-SCI-2 同精神: 只陈述计数/路径事实）。
 */
export interface EscalationEvidence {
  /** 条目 payload 文本（机械摘要 — 如「audit discrepancy: 3 paths」）。 */
  readonly summary: string
  /** 关联 WS（Intervention workstream_ids + 事件 owner 的候选; 空 = 无
   *  WS 关联, 仅入 operational 队列 — TC-DOM-023 同款语义）。 */
  readonly workstreamIds?: readonly string[]
  /** 触及的 strict-tracked 第一层路径（关键路径 — §14.1 / §22.1）。 */
  readonly strictTrackedPaths?: readonly string[]
  /** 被删除路径（损失 — §22.3「高影响/未知/损失」）。 */
  readonly deletedPaths?: readonly string[]
  /** 受影响路径计数（批量影响 — ≥ threshold 触发）。 */
  readonly affectedPathCount?: number
  /** 关联对象 ref（如 audit report / discovery candidate 来源对象）。 */
  readonly contextRefs?: readonly TypedRef[]
}

export interface EscalationAssessment {
  readonly highImpact: boolean
  readonly reasons: readonly EscalationReason[]
}

/** 升级判定选项（threshold 注入面 — 默认 5, 对齐 WP-3.5 flooding 口径）。 */
export interface EscalationOptions {
  /** 批量影响阈值（safe integer ≥ 1; 缺省 = DEFAULT_ESCALATION_BATCH_THRESHOLD）。 */
  readonly batchThreshold?: number
}

export interface EscalateMechanicalParams {
  /** 条目来源（缺省 = UNCLASSIFIED_AUDIT_FINDING — §22.3 ESCALATE 的主
   *  来源是 audit discrepancy; 其他机械来源如 discovery 批量发现可指名）。 */
  readonly source?: MechanicalInboxSource
  readonly evidence: EscalationEvidence
}

/** 升级联动的 Intervention 投影（端口返回面 — 零形状网依赖）。 */
export interface EscalationIntervention {
  readonly id: string
  readonly title: string
}

export interface EscalationResult {
  /** 机械捕获的条目（raw = 证据 + escalation 标记; state = CAPTURED —
   *  升级不改变条目状态机位置, 它只是同时多了一个 Intervention）。 */
  readonly item: InboxItemRecord
  readonly assessment: EscalationAssessment
  /** highImpact 时创建的 Intervention; 非高影响 = `null`（无联动, 条目
   *  留在 Inbox 等用户 — §22.3 三档的 PROPOSE 档语义）。 */
  readonly intervention: EscalationIntervention | null
}

/* ------------------------------------------------------------------ *
 * Intervention 创建端口（升级联动 — §22.3 ESCALATE 档）
 * ------------------------------------------------------------------ */

/** 机械类 Intervention 创建参数（trigger 固定 = AUDIT_HIGH_IMPACT_DISCREPANCY —
 *  本模块的机械升级只走 INV-ATTN-5 闭集的这一档, 类型面不暴露 trigger
 *  自由度; title 由 service 机械派生 — escalation.ts）。 */
export interface MechanicalInterventionCreateParams {
  readonly title: string
  readonly detail?: string
  readonly workstreamIds?: readonly string[]
  readonly sourceRefs?: readonly TypedRef[]
}

/** 创建结果投影（id + title 足够 provenance/回显; 完整行归目标 service）。 */
export interface InterventionCreatedRef {
  readonly id: string
  readonly title: string
}

/** 机械类创建端口（生产 = WP-5.1 `createMechanicalIntervention`（trigger
 *  = AUDIT_HIGH_IMPACT_DISCREPANCY, PLUGIN actor）闭包）。 */
export type MechanicalInterventionCreator = (params: MechanicalInterventionCreateParams) => InterventionCreatedRef

/** ManagementAction 账本记录端口（生产 = 第二连接上
 *  `SQL_INSERT_MANAGEMENT_ACTION` + `managementActionToParams` —
 *  WP-3.1 冻结 SQL 面; id 由本 service 经共享 allocator 预留后传入）。 */
export type ManagementActionRecorder = (record: ManagementActionRecord) => void

/* ------------------------------------------------------------------ *
 * Error taxonomy
 * ------------------------------------------------------------------ */

export type InboxErrorCode =
  /** 模块边界参数畸形（空 payload / 坏 IN id / 坏 ref 形状 / targetKind 不在闭集 / fields.kind 不配对 — 精确指名失败项）。 */
  | 'IN_INPUT'
  /** 条目不存在（迁移/转换面）。 */
  | 'IN_NOT_FOUND'
  /** §13 非法迁移（含自环; CONVERTED/DISMISSED 终态无出口）。 */
  | 'IN_ILLEGAL_TRANSITION'
  /** 非用户 actor 触达用户面（转换/忽略的「显式确认」运行面）。 */
  | 'IN_ACTOR_FORBIDDEN'
  /** 目标 kind 的转换执行器未接线（V1 诚实边界 — 指名 kind + 未交付面）。 */
  | 'IN_TARGET_NOT_WIRED'
  /** 转换执行器失败（正式对象创建失败 — 条目保持 CAPTURED, 零状态写）。 */
  | 'IN_CONVERT_TARGET'
  /** 升级联动的 Intervention 创建失败（条目已捕获 — 消息含已捕获 id, 大声）。 */
  | 'IN_ESCALATION'
  /** INBOX_CONVERTED 账本行写入失败（转换已提交 — 手动 reconciliation 指引, 同 WP-4.1a reorderPlan 先例）。 */
  | 'IN_LEDGER'
  /** 乐观并发门: 迁移期间条目状态已变（expected state 不匹配 — 大声, 不猜）。 */
  | 'IN_CONCURRENT_STATE'
  /** `inbox_item` 行操作失败（驱动/SQL/形状网 包一层, cause 保留）。 */
  | 'IN_STORE'

export class InboxError extends Error {
  readonly code: InboxErrorCode
  constructor(init: { code: InboxErrorCode; message: string; cause?: unknown }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'InboxError'
    this.code = init.code
  }
}

export function isInboxError(error: unknown): error is InboxError {
  return error instanceof InboxError
}

/* ------------------------------------------------------------------ *
 * Ports + options（DI 面 — 同 WP-2.4 / WP-3.5 / WP-5.1 模式）
 * ------------------------------------------------------------------ */

/** `InboxService` 构造选项（宿主接线 WP 组装; 测试 = 真实冻结面 + stub 端口）。 */
export interface InboxServiceOptions {
  /** 本 WP 行面（`inbox_item` 表 — insert + 查询 + 状态缓存 UPDATE;
   *  DDL 幂等应用在其构造时; 同 WP-5.1 `lifecycle` 端口模式）。 */
  readonly store: InboxStore
  /** 共享 id allocator（IN + MA 族, §1.1 规则 2）。 */
  readonly allocator: IdAllocator
  readonly projectId: string
  /** 时钟（A-3 epoch ms; 默认 Date.now; 单次采样纪律）。 */
  readonly now?: () => number
  /** 升级判定选项（批量影响阈值注入面; 缺省 = DEFAULT_ESCALATION_BATCH_THRESHOLD）。 */
  readonly escalation?: EscalationOptions
  /** §28 转换执行器端口（可选 — 未接线时 `convert` 对**任何** kind
   *  IN_TARGET_NOT_WIRED; 接线后未实现 kind 由执行器自行大声失败。
   *  生产接线传真实 WP service 闭集: INTERVENTION ⇒ WP-5.1
   *  `createUserIntervention`; NEXT_ACTION ⇒ WP-5.2 `createNextAction`;
   *  REPORTING_ITEM/INTERACTION ⇒ WP-5.3 `ReportingService`）。 */
  readonly conversionTargets?: InboxConversionTargetExecutor
  /** 升级联动 service（可选 — 缺省且判定 highImpact ⇒ IN_INPUT 大声失败;
   *  非高影响路径零依赖。生产 = WP-5.1 `createMechanicalIntervention`
   *  （trigger = AUDIT_HIGH_IMPACT_DISCREPANCY, PLUGIN actor）闭包）。 */
  readonly mechanicalInterventionCreator?: MechanicalInterventionCreator
  /** INBOX_CONVERTED provenance 账本（可选 — 缺省 = 转换不写账本行,
   *  结果 managementActionId = null（不虚构 provenance, 同 WP-5.5 GAP 纪律））。 */
  readonly managementActionRecorder?: ManagementActionRecorder
}
