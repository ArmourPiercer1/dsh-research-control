/**
 * WP-5.5 — Living Brief 三级投影：类型面（纯数据，零 I/O、零 DSH import）。
 *
 * 冻结契约依据（逐字）:
 *  - ARCHITECTURE §5.10 INV-ATTN-3（T 级）: 「Brief 是 projection 非
 *    source of truth；每项重要陈述必须可 drill-down 到结构化对象/
 *    History/Run」— 本文件把该不变量落到**机器可查**形态:
 *    `BriefRef`（OBJECT = 结构化对象 id；HISTORY_EVENT = 事件 seq +
 *    owner WS + eventId）是每条陈述（L1/L2/L3）的来源引用, `project.ts`
 *    的 `validateBriefRefs` 是可执行的校验面（空违规列表 = 通过）;
 *  - 计划书 §19.2（Living Research Brief）: 「三级：Project / Topic /
 *    Workstream Brief. 重点回答：当前 Objective；最近发生什么；当前正在
 *    执行什么；Future Plan；Intervention；Blocker；upcoming event /
 *    reporting；NextAction. Brief 是 projection，不是 source of truth.
 *    每项重要陈述必须可以 drill-down 到结构化对象/History/Run」—
 *    V1 收窄为**单一项目级 Brief**（宿主 = 单项目, V1 前提 —
 *    ARCHITECTURE §7.1 getDashboard 无参）, 三级 = 信息深度三级
 *    （L1 一句话态势 / L2 要点列表（每点带 ref）/ L3 完整数据底座引用表）,
 *    L2 的八类要点 = §19.2 重点回答清单逐类落点;
 *  - 计划书 §19.2 末句「Brief 是 projection，不是 source of truth」:
 *    本层**不持久化**（无表、无 DDL、无 RPC — 冻结 14 方法面无 brief
 *    面; 每次 build 从数据面快照现算, 数据面变更 ⇒ 下次 build 即收敛）。
 *
 * 数据面缺口纪律（WP-4.1a `null` 占位同口径）:
 *  - Phase 6 未交付的面（`audit` / `inbox`）在 L3 引用表中恒为
 *    `PLACEHOLDER`「待开通（Phase 6）」— 引擎**从不虚构**这两面的数据
 *    （输入形状里根本没有这两个字段 — 结构上无虚构路径）;
 *  - client 侧无 wire 路径的面（NA/BLK/SEV/RPT/interaction/history/
 *    futurePlan）由 client 映射层给空集 ⇒ L2 该类要点为「暂无数据」
 *    占位、L3 行 `EMPTY` — 与「真源为空」的 host 面同形（诚实边界,
 *    视图层以数据面说明文案补足上下文）。
 */

import type { DashboardSnapshot } from '../../../shared/rpc-contracts.js'
import type { AttentionRanking } from '../attention/scorer.js'

/* ===================================================================== *
 * Ref — INV-ATTN-3 的机器可查形态（drill-down 目标）
 * ===================================================================== */

/**
 * `OBJECT` ref 可指向的对象种类（drill-down 目标面 — 结构化对象全集）。
 * 计划 item（TASK/GATE/MILESTONE）与 RUN 属 §19.2「drill-down 到
 * 结构化对象/History/Run」的 Run 半边: 经 WS 页 Current 区 / drilldown
 * 面板可达（WP-4.6 链: 对象 → Run → DSH Session）。
 */
export const BRIEF_OBJECT_KINDS = [
  'PROJECT',
  'TOPIC',
  'WORKSTREAM',
  'OBJECTIVE',
  'INTERVENTION',
  'NEXT_ACTION',
  'BLOCKER',
  'SCHEDULED_EVENT',
  'REPORTING_ITEM',
  'INTERACTION',
  'PLAN_FORK',
  'RUN',
  'TASK',
  'GATE',
  'MILESTONE',
] as const
export type BriefObjectKind = (typeof BRIEF_OBJECT_KINDS)[number]

/** 一条来源引用（INV-ATTN-3: 陈述 → 可 drill-down 目标）。 */
export type BriefRef =
  /** 结构化对象（id 在其 kind 族内唯一 — §1.1 前缀族）。 */
  | { readonly kind: 'OBJECT'; readonly objectKind: BriefObjectKind; readonly id: string }
  /** History 事件（owner WS 的 log 坐标: eventSeq = audit 轴位置 + eventId）。 */
  | { readonly kind: 'HISTORY_EVENT'; readonly workstreamId: string; readonly eventSeq: number; readonly eventId: string }

/* ===================================================================== *
 * 输入形状（各数据面快照 — 引擎入参）
 *
 * 纪律（同 reporting「无跨 WP 依赖」口径）: 行形状**按字段重声明**
 * （最小结构读面）, 不 import 各 WP 的记录类型; 生产形状（flooding
 * `InterventionRecord` / actions 记录 / reporting 记录 / loader
 * `ObjectiveDoc` / 存储 `HistoryEventRecord` / wire DTO）由
 * `mapping.ts` 的纯映射函数归一到本面（字段逐字核对在 tests/brief）。
 * 例外: `attention` 面直接取 WP-5.4 评分器的 `AttentionRanking`
 * （type-only import — 评分器零 import, host/client 算法单一真源,
 * 重声明 union 只会制造漂移）与冻结 wire `DashboardSnapshot`
 * （type-only; zod 运行图已在两侧 bundle 内）。
 * ===================================================================== */

/** Intervention 数据面行（WP-5.1; 状态契约: OPEN/PENDING — build 面防御过滤）。 */
export interface BriefIntervention {
  readonly id: string
  readonly title: string
  readonly origin: 'USER' | 'AGENT_REPORT' | 'AUTO_FLOODING' | 'AUTO_AUDIT'
  readonly status: 'OPEN' | 'PENDING'
  readonly workstreamIds: readonly string[]
  readonly createdAt: number
}

/** Objective 数据面行（WP-5.2 声明式 `.research/objectives.yaml`）。 */
export interface BriefObjective {
  readonly id: string
  readonly scope: 'PROJECT' | 'TOPIC'
  readonly statement: string
  readonly status: 'ACTIVE' | 'ACHIEVED' | 'DROPPED'
  readonly priority: 'P0' | 'P1' | 'P2' | 'P3'
  readonly targetDate: number | null
}

/** NextAction 数据面行（WP-5.2; 状态契约: PROPOSED）。 */
export interface BriefNextAction {
  readonly id: string
  readonly statement: string
  readonly status: 'PROPOSED'
  readonly workstreamId: string | null
  readonly createdAt: number
}

/** Blocker `affects` 元素（WP-5.2 冻结 kind 限 WORKSTREAM/TASK/RUN）。 */
export interface BriefAffectsRef {
  readonly kind: 'WORKSTREAM' | 'TASK' | 'RUN'
  readonly id: string
}

/** Blocker 数据面行（WP-5.2; 状态契约: ACTIVE）。 */
export interface BriefBlocker {
  readonly id: string
  readonly statement: string
  readonly status: 'ACTIVE'
  readonly affects: readonly BriefAffectsRef[]
  readonly createdAt: number
}

/**
 * ScheduledEvent 数据面行（WP-5.3）。`at` 归一化: ONCE → 时刻;
 * RECURRING → `null`（冻结形状无 anchor/phase 字段 — V1 不推算下次
 * 发生, 只标注「周期事件」— schedule.ts 同口径）。
 */
export interface BriefScheduledEvent {
  readonly id: string
  readonly title: string
  readonly at: number | null
  readonly recurring: boolean
}

/** ReportingItem 数据面行（WP-5.3; §13 五态）。 */
export interface BriefReportingItem {
  readonly id: string
  readonly audience: string
  readonly statement: string
  readonly status: 'OPEN' | 'MATERIAL_READY' | 'READY_TO_REPORT' | 'REPORTED' | 'FOLLOW_UP_REQUIRED'
  readonly createdAt: number
}

/** Interaction 数据面行（WP-5.3; 登记制, 无状态列）。 */
export interface BriefInteraction {
  readonly id: string
  readonly kind:
    | 'MEETING'
    | 'AD_HOC_DISCUSSION'
    | 'SUPERVISOR_UPDATE'
    | 'COLLABORATOR_DISCUSSION'
    | 'EXPERIMENT_SHIFT_HANDOFF'
    | 'OTHER'
  readonly title: string
  readonly occurredAt: number
}

/** 最近 History 摘要行（存储 `HistoryEventRecord` / wire `HistoryEventDto`
 *  的最小读面 — 引擎不读 payload: 「最近发生什么」= 事件类型 + owner WS +
 *  seq 坐标（drill-down 到 History 时间线的入口坐标））。 */
export interface BriefHistoryEvent {
  readonly eventId: string
  readonly eventSeq: number
  readonly ownerWorkstreamId: string
  readonly eventType: string
  readonly occurredAt: number
}

/** Future Plan 数据面行（canonical plan 的 WS 头部 — 声明式层投影）。 */
export interface BriefFuturePlanItem {
  readonly id: string
  readonly kind: 'TASK' | 'GATE' | 'MILESTONE'
  readonly title: string
}

export interface BriefFuturePlan {
  readonly workstreamId: string
  readonly items: readonly BriefFuturePlanItem[]
}

/**
 * `projectBrief` 的输入 = 各数据面快照（任务目标 1）。
 * 所有数组面缺省 = 空集（调用方不注入 = 该面「无数据」, 不伪造）;
 * `attention` / `dashboard` 可显式 `null`（数据面不可用 — L3 对应行
 * 仍出现, 状态 `PLACEHOLDER` 附说明; 引擎是**全定义**的, 从不抛错）。
 * Phase 6 面（audit/inbox）不在输入里 — 见文件头缺口纪律。
 */
export interface BriefInputs {
  readonly attention: AttentionRanking | null
  readonly dashboard: DashboardSnapshot | null
  readonly interventions: readonly BriefIntervention[]
  readonly objectives: readonly BriefObjective[]
  readonly history: readonly BriefHistoryEvent[]
  readonly nextActions: readonly BriefNextAction[]
  readonly blockers: readonly BriefBlocker[]
  readonly scheduledEvents: readonly BriefScheduledEvent[]
  readonly reportingItems: readonly BriefReportingItem[]
  readonly interactions: readonly BriefInteraction[]
  readonly futurePlans: readonly BriefFuturePlan[]
}

/* ===================================================================== *
 * 输出形状（三级 Brief）
 * ===================================================================== */

/** L2 要点类别（计划书 §19.2 重点回答清单 — 逐类一一对应）。 */
export const BRIEF_POINT_CATEGORIES = [
  'OBJECTIVE', // 当前 Objective
  'RECENT', // 最近发生什么
  'IN_FLIGHT', // 当前正在执行什么
  'FUTURE_PLAN', // Future Plan
  'INTERVENTION', // Intervention
  'BLOCKER', // Blocker
  'UPCOMING', // upcoming event / reporting
  'NEXT_ACTION', // NextAction
] as const
export type BriefPointCategory = (typeof BRIEF_POINT_CATEGORIES)[number]

/**
 * L2 一条要点。`status`:
 *  - `DATA` — 有数据的陈述, **必有 ≥1 ref**（INV-ATTN-3 机器形态 —
 *    `validateBriefRefs` 钉死）;
 *  - `PLACEHOLDER` — 「暂无数据」占位（该面当前空集）— 不是状态陈述,
 *    无 ref 不构成 INV-ATTN-3 违反;
 *  - `GAP` — 「待开通」占位（数据面未交付 — audit/inbox 的 L3 行与
 *    client 侧无 wire 路径面在 L2 的落点; 视图层区分措辞）。
 */
export interface BriefPoint {
  /** 稳定要点 id（类别 + 序位 — 同输入恒同 id, 视图 key 用）。 */
  readonly id: string
  readonly category: BriefPointCategory
  readonly status: 'DATA' | 'PLACEHOLDER' | 'GAP'
  /** 陈述（中文; DATA = 数据事实, 占位 = 明确的无数据/待开通说明）。 */
  readonly statement: string
  /** 来源引用（DATA ⇒ 非空 — INV-ATTN-3）。 */
  readonly refs: readonly BriefRef[]
}

/** L3 数据面标识（完整数据底座 — V1 全集）。 */
export const BRIEF_DATA_PLANES = [
  'dashboard',
  'attention',
  'interventions',
  'objectives',
  'nextActions',
  'blockers',
  'scheduledEvents',
  'reportingItems',
  'interactions',
  'history',
  'futurePlans',
  'audit',
  'inbox',
] as const
export type BriefDataPlaneId = (typeof BRIEF_DATA_PLANES)[number]

/** L3 一行（完整数据底座引用表 — 每个数据面恒有一行, 不隐藏）。 */
export interface BriefBaseRow {
  readonly plane: BriefDataPlaneId
  /** 中文标签（视图直接渲染）。 */
  readonly label: string
  /** `AVAILABLE` = 有数据; `EMPTY` = 面存在但当前空集;
 *   `PLACEHOLDER` = 面未交付/不可用（「待开通」）。 */
  readonly status: 'AVAILABLE' | 'EMPTY' | 'PLACEHOLDER'
  /** 本面进入 Brief 的对象数（AVAILABLE/EMPTY 时 ≡ refs.length）。 */
  readonly count: number
  /** 本面的对象引用（AVAILABLE: 全量; EMPTY: 空; PLACEHOLDER: 空）。 */
  readonly refs: readonly BriefRef[]
  /** 说明（占位原因 / 数据面来源 — 视图直接渲染）。 */
  readonly note: string | null
}

/** L1 一句话态势。 */
export interface BriefLevel1 {
  readonly statement: string
  /** L1 的引用（项目 + 注意力 Top 项 — 全定义, 可为空）。 */
  readonly refs: readonly BriefRef[]
}

/**
 * Living Brief（三级投影输出 — JSON 可序列化纯数据, 无 Map/函数:
 * client 切片的引用稳定判据与 wire 传输兼容）。
 */
export interface LivingBrief {
  /** 投影时刻 epoch ms（= 调用方注入的 now — 确定性）。 */
  readonly generatedAt: number
  readonly level1: BriefLevel1
  readonly level2: readonly BriefPoint[]
  readonly level3: readonly BriefBaseRow[]
}
