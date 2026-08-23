/**
 * WP-5.1 — Intervention 生命周期服务（lifecycle service）：type surface。
 *
 * 冻结契约依据（只读）:
 *  - DOMAIN_SCHEMA §9.2（Intervention 字段表: 11 键 snake_case; origin 4 枚举;
 *    status **仅用户显式修改** INV-PERM-4; created_by ActorRef; 关闭时用户
 *    填写 resolution_note）+ §13（状态机: `OPEN ↔ PENDING`; `OPEN | PENDING →
 *    CLOSED` 终态; 仅用户; 重开 = 新 Intervention）+ §15（`intervention` 表
 *    映射: PK id + 索引 (status); 通则不 hard delete — INV-HIST-7）;
 *  - ARCHITECTURE §5.9（INV-PERM-1: Agent 可写含 Intervention **创建**;
 *    INV-PERM-2: Agent 不可 Intervention 状态迁移; INV-PERM-4: 状态只允许
 *    用户显式修改 — R+T）+ §5.10（INV-ATTN-1: OPEN/PENDING 始终完整展示,
 *    Manager 只排序不隐藏 — T; INV-ATTN-5: 自动来源仅限 §6 脚注 ¹ 机械触发
 *    闭集 — R+T）+ §6 权限矩阵（Intervention 创建 U/A/仅机械触发¹;
 *    Intervention OPEN/PENDING/CLOSED 仅 U）+ §7.1（updateInterventionState
 *    RPC — USER 语义）;
 *  - HISTORY_EVENT_CATALOG §4 行 18（INTERVENTION_CREATED: E 列 U A P;
 *    owner = 第一个关联 WS, 无关联则不发事件）+ §5.7（payload 逐字:
 *    intervention_id(新建)/title/origin/source_refs?; origin=AUTO_* ⇒
 *    actor.kind=PLUGIN）+ §7（新增事件需 bump schemaVersion — 本 WP 零新
 *    事件: 目录**只有** INTERVENTION_CREATED, 状态迁移无对应事件, 不落
 *    事件 = 不虚构）;
 *  - WP-3.5（flooding 模块）: `intervention` 表 DDL + 触发器 + 行形状 +
 *    §13 纯状态机 + `MECHANICAL_TRIGGER_KINDS` 闭集（本模块**复用**, 不
 *    迁移表、不复制冻结面 — 决策见报告「实现要点 1」）。
 *
 * ## 两类创建来源（任务目标 1）
 *
 *  - **用户类**: `createUserIntervention` — origin 常量 `USER`（构建面
 *    不接受 origin 参数, 类型即闭集）, actor 参数类型 `UserActorRef`;
 *  - **机械类**: `createMechanicalIntervention` — origin 由
 *    `trigger: MechanicalTriggerKind`（**INV-ATTN-5 闭集**, 逐字三类,
 *    继承 WP-3.5 冻结面）推导:
 *      PLAN_FORK_FLOODING            ⇒ AUTO_FLOODING  + PLUGIN actor
 *      AUDIT_HIGH_IMPACT_DISCREPANCY ⇒ AUTO_AUDIT     + PLUGIN actor
 *      AGENT_REPORT_REQUIRES_HUMAN   ⇒ AGENT_REPORT   + AGENT actor
 *    actor 参数类型 `MechanicalActorRef`（kind ∈ AGENT | PLUGIN）; 触发
 *    种类与 actor kind 的配对在运行面再断言（IV_ACTOR_FORBIDDEN）—
 *    类型面 + 运行面双钉, 同 WP-2.4 `assertUserOrAgentActor` 先例。
 *    **Claim scientific conflict 永远不是合法 trigger**（INV-ATTN-5）—
 *    它不在闭集类型内, 编译期即不存在。
 *
 * ## 状态迁移（任务目标 1, INV-PERM-4）
 *
 * `updateState` 的参数类型是 `UserActorRef`（**类型面**: AGENT/PLUGIN/SYSTEM
 * actor 是编译错误）+ 运行面 `assertUserActor`（伪造的运行时非 USER actor
 * ⇒ IV_ACTOR_FORBIDDEN, 零写入）— 双面拒绝, 同 WP-3.4 `assertUserActor` /
 * WP-2.4 `UserActorRef` 先例。§13 合法性 = WP-3.5 冻结纯表（本模块
 * state-machine.ts 的门面, 非法对 ⇒ IV_ILLEGAL_TRANSITION）。
 *
 * ## 查询（任务目标 1, INV-ATTN-1 的 service 层落点）
 *
 * `listOpen` / `listPending` / `listActive` / `listClosed` / `get`: 全量
 * 返回该状态集（**无隐藏过滤器** — 不排序、不截断、不按 origin/WS 筛选;
 * 稳定顺序 created_at ASC, id ASC 继承 WP-3.5 查询面）。「Attention
 * Manager 只排序、不隐藏」（INV-ATTN-1）的展示面 = client 分组视图,
 * service 层保证的是**数据完整**这一半。
 *
 * Layer (ARCHITECTURE §2.2): service — 唯一写 operational DB 的层。
 * 无 DSH import (INV-PERM-5)。
 */

import type {
  ActorRef,
  HistoryEventRegistry,
  RunSnapshot,
  TypedRef,
  WorkstreamSnapshot,
} from '../../history/registry/index.js'
import type {
  InterventionOrigin,
  InterventionRecord,
  IvStatus,
  MechanicalTriggerKind,
} from '../flooding/index.js'
import type { IdAllocator } from '../../../shared/ids/index.js'
import type { ResearchStore } from '../../persistence/store/index.js'
import type { InterventionLifecycleStore } from './store.js'

/* ------------------------------------------------------------------ *
 * Actor faces（类型面权限 — INV-PERM-4 的编译期半边）
 * ------------------------------------------------------------------ */

/**
 * USER actor ref（冻结 `actorRef` 限制到 kind=USER）。`updateState` 的
 * 参数类型: 非 USER actor 是 **COMPILE 错误**（INV-PERM-4 类型面）;
 * 运行时伪造仍被 IV_ACTOR_FORBIDDEN 拒绝（运行面, tests 钉死）。
 */
export interface UserActorRef {
  readonly kind: 'USER'
  readonly user_id?: string
  readonly label?: string
}

/** The default user actor for GUI operations (matrix column U). */
export const USER_ACTOR: UserActorRef = { kind: 'USER', label: 'user' }

/**
 * 机械类创建的 actor: kind ∈ AGENT | PLUGIN（§6 矩阵 Intervention 创建行
 * 的 A/P 两栏）。与触发种类的配对由 `MECHANICAL_TRIGGER_ACTOR_KIND` 钉死
 * （AUTO_* ⇒ PLUGIN, AGENT_REPORT ⇒ AGENT）。
 */
export interface MechanicalActorRef {
  readonly kind: 'AGENT' | 'PLUGIN'
  /** R id（AGENT 发射: 事件校验要求 Run 存在 — catalog §5 通用校验）。 */
  readonly run_id?: string
  readonly label?: string
}

/* ------------------------------------------------------------------ *
 * INV-ATTN-5 机械触发闭集 → origin / actor kind（冻结推导, 零自由度）
 * ------------------------------------------------------------------ */

/**
 * 机械触发种类（WP-3.5 冻结闭集, INV-ATTN-5）→ Intervention origin。
 * 闭集即 §6 脚注 ¹ 三类; **不**含 Claim scientific conflict（INV-ATTN-5
 * 明言）— 该映射的键集 = 闭集, 无第四种入口。
 */
export const MECHANICAL_TRIGGER_ORIGIN: Readonly<Record<MechanicalTriggerKind, InterventionOrigin>> = {
  PLAN_FORK_FLOODING: 'AUTO_FLOODING',
  AUDIT_HIGH_IMPACT_DISCREPANCY: 'AUTO_AUDIT',
  AGENT_REPORT_REQUIRES_HUMAN: 'AGENT_REPORT',
}

/** 机械触发种类 → 允许的 actor kind（catalog §5.7: origin=AUTO_* ⇒ PLUGIN;
 *  AGENT_REPORT = Agent 报告面 ⇒ AGENT）。 */
export const MECHANICAL_TRIGGER_ACTOR_KIND: Readonly<Record<MechanicalTriggerKind, 'PLUGIN' | 'AGENT'>> = {
  PLAN_FORK_FLOODING: 'PLUGIN',
  AUDIT_HIGH_IMPACT_DISCREPANCY: 'PLUGIN',
  AGENT_REPORT_REQUIRES_HUMAN: 'AGENT',
}

/* ------------------------------------------------------------------ *
 * 创建参数 / 结果
 * ------------------------------------------------------------------ */

/** 创建参数（§9.2 字段表的内容半边; id/created_* 由 service 分配）。 */
export interface InterventionCreateParams {
  /** 非空（§9.2: title 必填, 冻结 schema minLength 1）。 */
  readonly title: string
  /** 自由文本（§9.2 detail 可选 — 机械证据摘要的落点）。 */
  readonly detail?: string
  /** 关联 WS（§9.2 可选; 第一个 = INTERVENTION_CREATED 事件 owner;
   *  空 = 不产生 History 事件, 仅入 operational 队列 — TC-DOM-023）。 */
  readonly workstream_ids?: readonly string[]
  /** 指向触发对象（§9.2 source_refs 可选: PF/audit finding/agent report）。 */
  readonly source_refs?: readonly TypedRef[]
}

/** 机械类创建参数: trigger = INV-ATTN-5 闭集成员（类型即闭集）。 */
export interface MechanicalInterventionCreateParams extends InterventionCreateParams {
  readonly trigger: MechanicalTriggerKind
}

/** 创建结果。 */
export interface CreateInterventionResult {
  readonly intervention: InterventionRecord
  /** append 的 INTERVENTION_CREATED 事件 id; `null` = 无 WS 关联（不发
   *  事件 — catalog §5.7; TC-DOM-023）。 */
  readonly eventId: string | null
}

/**
 * 状态迁移结果 — 与共享契约 `UpdateInterventionStateResult`（RPC
 * updateInterventionState）字段 1:1（RPC 面直转, 零转换）。
 */
export interface UpdateInterventionStateResult {
  readonly interventionId: string
  readonly statusFrom: IvStatus
  readonly statusTo: IvStatus
  /** 写入于 `statusTo === 'CLOSED'`（epoch ms）; 其余迁移 = `null`。 */
  readonly closedAt: number | null
  /** 关闭时用户填写（§9.2）; 其余迁移 = `null`。 */
  readonly resolutionNote: string | null
}

/* ------------------------------------------------------------------ *
 * Error taxonomy
 * ------------------------------------------------------------------ */

export type InterventionErrorCode =
  /** 模块边界参数畸形（空 title / 坏 WS id / 坏 trigger / 坏 ref 形状 — 精确指名失败项）。 */
  | 'IV_INPUT'
  /** Intervention 行不存在（迁移面）。 */
  | 'IV_NOT_FOUND'
  /** 非用户 actor 触达用户面（INV-PERM-4 运行面; 类型面在参数类型上）。 */
  | 'IV_ACTOR_FORBIDDEN'
  /** §13 非法迁移（含自环; CLOSED 终态无出口）。 */
  | 'IV_ILLEGAL_TRANSITION'
  /** 乐观并发门: 迁移期间行状态已变（expected status 不匹配 — 大声, 不猜）。 */
  | 'IV_CONCURRENT_STATE'
  /** `intervention` 行操作失败（驱动/SQL 包一层, cause 保留）。 */
  | 'IV_STORE'
  /** INTERVENTION_CREATED 构造 / registry 校验拒绝 / store append 失败。 */
  | 'IV_EVENT'

export class InterventionError extends Error {
  readonly code: InterventionErrorCode
  constructor(init: { code: InterventionErrorCode; message: string; cause?: unknown }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'InterventionError'
    this.code = init.code
  }
}

export function isInterventionError(error: unknown): error is InterventionError {
  return error instanceof InterventionError
}

/* ------------------------------------------------------------------ *
 * Ports + options（DI 面 — 同 WP-2.4 / WP-3.5 模式）
 * ------------------------------------------------------------------ */

/** 事件校验上下文的外部（声明式侧 + Run 表）快照面 — 同 WP-3.5
 *  `FloodingExternalState`, 加 runs 缝（AGENT 发射事件的 actor.run_id
 *  存在性校验需要, catalog §5 通用校验）。 */
export interface InterventionExternalState {
  readonly workstreams: ReadonlyMap<string, WorkstreamSnapshot>
  /** Run 快照缝（R id → 快照）; 缺省 = 空（AGENT 发射 + WS 关联的事件
   *  将过不了 registry 校验 — fail loud, 不静默放行）。 */
  readonly runs?: ReadonlyMap<string, RunSnapshot>
}

/** `InterventionService` 构造选项（宿主接线 WP 组装）。 */
export interface InterventionServiceOptions {
  /** WP-2.1 ResearchStore（INTERVENTION_CREATED append — registry 校验内嵌
   *  store 写事务, INV-HIST-4）。 */
  readonly store: ResearchStore
  /** WP-2.2 事件 registry（validate hook — 未过冻结校验的事件永不落地;
   *  E 列矩阵 U/A/P + origin=AUTO_* ⇒ PLUGIN 的 CROSS_FIELD 在 registry 内钉）。 */
  readonly registry: HistoryEventRegistry
  /** 本 WP 生命周期行面（query/insert + 用户状态缓存 UPDATE; 无 delete）。 */
  readonly lifecycle: InterventionLifecycleStore
  /** 共享 id allocator（IV + H 族, §1.1 规则 2）。 */
  readonly allocator: IdAllocator
  readonly projectId: string
  /** 声明式侧快照（事件校验 ctx 的 workstreams map + owner 存在性）。 */
  readonly externalState: () => InterventionExternalState
  readonly now?: () => number
}

/** 供事件面/测试消费的 actor 归一（本模块 actor 面 → 冻结 ActorRef 载体）。 */
export function toActorRef(actor: UserActorRef | MechanicalActorRef): ActorRef {
  const ref: ActorRef = { kind: actor.kind }
  if (actor.kind === 'AGENT' && actor.run_id !== undefined) ref.run_id = actor.run_id
  if (actor.kind === 'USER' && actor.user_id !== undefined) ref.user_id = actor.user_id
  if (actor.label !== undefined) ref.label = actor.label
  return ref
}
