/**
 * WP-5.4 — Attention Manager BASELINE scorer（纯函数: 零 I/O、零 import）。
 *
 * 冻结契约依据（逐条）:
 *  - ARCHITECTURE §5.10 INV-ATTN-1: OPEN/PENDING Intervention 始终完整展示;
 *    Attention Manager **只排序、不隐藏** —— `rankAttention` 的输出是输入
 *    全集的一个**排序**（双射, 按 kind+id）; 本函数没有任何 filter/limit
 *    路径, 分数再低的项（如 7 天外的 ScheduledEvent, urgency 衰减到 0）
 *    也恒在输出里;
 *  - ARCHITECTURE §5.10 INV-ATTN-2（R 级, 评分器约束）: 预计耗时只作为
 *    标签, 不得用于让短任务压过高重要度任务 —— 输入类型携带
 *    `estimatedDurationMs`（供视图渲染标签）, 但评分函数**从不读取**该
 *    字段; 权重表把 `estimatedDuration` 显式钉为 0（R 级测试断言
 *    含/不含耗时输入产出同序）;
 *  - 计划书 §20（Attention Manager）: 「Manager 不是过滤器, 只做推荐排序
 *    和 why-now explanation. 算法: 1. hard policy constraints;
 *    2. 可解释 baseline score; 3. 有限 LLM semantic adjustment;
 *    4. human override.」本文件实现第 2 步（baseline, 可解释, 全加性）,
 *    第 3/4 步为后续 WP 预留（权重表里以 0 权重占位声明, 见
 *    `ATTENTION_WEIGHTS` 注释）;
 *  - 计划书 §20 输入特征清单: Intervention state（权重实现）/
 *    deadline·ScheduledEvent（时间近度, 权重实现）/ blocker（权重实现）/
 *    human awareness gap（权重实现, INV-ATTN-4 高价值对象才有记录）/
 *    Project·Topic importance + attention_mode + dependency fanout +
 *    reporting urgency + context switching cost（**baseline 零权重占位** —
 *    未标定的权重会破坏 INV-ATTN-1/2 的可解释性, 留第 3/4 步激活）;
 *  - 计划书 §19.1（Human Awareness 四态）: UNSEEN/SEEN/REVIEWED/ASSESSED
 *    作为「awareness gap」特征参与评分（UNSEEN = 用户尚未知悉, 小幅加权;
 *    已见/已评 = 不加权）。
 *
 * 为什么本文件零 import:
 *  - 宿主侧 `AttentionService`（service.ts）与 client 侧 store 切片
 *    （src/client/stores/attention-slices.ts）**共用同一个评分器** —
 *    算法单一真源, host/client 排序必然一致（baseline 的零权重 context
 *    特征使两侧 context 取值不同也不产生分歧, 见 service.ts 头注）;
 *  - client bundle（tsdown clientConfig）会把本文件的 import 图内联进
 *    `lib/client.js` — 零 import 保证内联的只有本文件自身（无 node:sqlite
 *    等宿主依赖泄漏进浏览器 bundle）。
 */

/* ===================================================================== *
 * 冻结枚举镜像（与 schema/operational/attention.schema.json 逐字 —
 * 独立重声明使本文件保持零 import; 漂移由 tests/attention 钉）
 * ===================================================================== */

/** `Awareness.state`（schema/operational/attention.schema.json $defs/Awareness; 计划书 §19.1）。 */
export const AWARENESS_STATES = ['UNSEEN', 'SEEN', 'REVIEWED', 'ASSESSED'] as const
export type AwarenessState = (typeof AWARENESS_STATES)[number]

/** `Awareness.object_ref.kind` 白名单（schema 冻结; INV-ATTN-4: 仅高价值对象）。 */
export const AWARENESS_KINDS = ['CLAIM', 'FACT', 'ARTIFACT', 'MILESTONE', 'INTERVENTION', 'PLAN_FORK'] as const
export type AwarenessKind = (typeof AWARENESS_KINDS)[number]

/* ===================================================================== *
 * 评分输入（Attention Manager 的候选全集 — 只排序不隐藏）
 * ===================================================================== */

/** 进入评分器的对象类型（计划书 §20 特征清单的 V1 四类）。 */
export const ATTENTION_ITEM_KINDS = ['INTERVENTION', 'NEXT_ACTION', 'BLOCKER', 'SCHEDULED_EVENT'] as const
export type AttentionItemKind = (typeof ATTENTION_ITEM_KINDS)[number]

/**
 * 评分输入基类。
 *
 * `estimatedDurationMs` — INV-ATTN-2: **标签字段**。视图渲染「预计耗时」
 * 展示用; 评分函数从不读取（零权重, 权重表 `estimatedDuration: 0`）。
 * `awarenessState` — 仅高价值对象携带（INV-ATTN-4: awareness kind 白名单
 * = 冻结 schema）; `undefined` = 无 awareness 记录, 按默认 UNSEEN 语义
 * 评分（DOMAIN_SCHEMA §9.5: 默认 UNSEEN）。
 */
export interface AttentionItemBase {
  readonly kind: AttentionItemKind
  readonly id: string
  /** 展示标题（NextAction/Blocker 为 statement 单行）。 */
  readonly title: string
  /** epoch ms（§1.2 / A-3）。 */
  readonly createdAt: number
  /** 关联 WS（无则 null — INV-ATTN-1 不因无 WS 关联而隐藏）。 */
  readonly workstreamId: string | null
  /** INV-ATTN-2: 预计耗时标签（评分零权重）。 */
  readonly estimatedDurationMs?: number | null
  /** INV-ATTN-4: awareness 状态（undefined = 无记录 = 默认 UNSEEN）。 */
  readonly awarenessState?: AwarenessState | null
}

/** Intervention 评分输入（状态契约: 只有 OPEN/PENDING 进入 — CLOSED 是终态,
 *  不占注意力; 输入契约由组装方保证, service 再防御性过滤）。 */
export interface AttentionInterventionItem extends AttentionItemBase {
  readonly kind: 'INTERVENTION'
  readonly status: 'OPEN' | 'PENDING'
  readonly origin: 'USER' | 'AGENT_REPORT' | 'AUTO_FLOODING' | 'AUTO_AUDIT'
}

/** NextAction 评分输入（状态契约: 只有 PROPOSED — PROMOTED 已转 Task 离开队列,
 *  DISMISSED 用户已弃）。 */
export interface AttentionNextActionItem extends AttentionItemBase {
  readonly kind: 'NEXT_ACTION'
  readonly status: 'PROPOSED'
}

/** Blocker 评分输入（状态契约: 只有 ACTIVE — CLEARED 阻碍已解除）。 */
export interface AttentionBlockerItem extends AttentionItemBase {
  readonly kind: 'BLOCKER'
  readonly status: 'ACTIVE'
}

/** ScheduledEvent 评分输入（时间近度特征的唯一载体; 过期的事件 urgency=1
 *  封顶, 不产生负分 — 只排序不隐藏）。 */
export interface AttentionScheduledEventItem extends AttentionItemBase {
  readonly kind: 'SCHEDULED_EVENT'
  /** 事件时刻 epoch ms。 */
  readonly at: number
}

export type AttentionItem =
  | AttentionInterventionItem
  | AttentionNextActionItem
  | AttentionBlockerItem
  | AttentionScheduledEventItem

/** 评分上下文（项目级特征 — baseline 中全部零权重, 见权重表）。 */
export interface AttentionContext {
  /** 当前时刻 epoch ms（时间近度特征的原点; 由调用方注入 — 确定性）。 */
  readonly now: number
  /** Project importance（计划书 §20 特征; baseline 零权重）。 */
  readonly projectImportance: number
  /** Project attention_mode（计划书 §20 特征; baseline 零权重）。 */
  readonly attentionMode: 'FOCUS' | 'NORMAL' | 'BACKGROUND'
}

/* ===================================================================== *
 * 权重常量（集中声明 + 计划书依据注释 — 任务目标 2）
 * ===================================================================== */

/**
 * baseline 评分权重表（**唯一**权重来源 — 评分函数只从这里取数）。
 *
 * 依据: 计划书 §20「可解释 baseline score」+ §20 输入特征清单 +
 * ARCHITECTURE §5.10 INV-ATTN-1/2。数值口径: 全部为**加性**分量, 量纲
 * 「注意力当量」——人类责任队列（Intervention）最高, 现实阻碍（Blocker）
 * 次之, 时间近度事件（ScheduledEvent）按 deadline 线性逼近, 轻量建议
 * （NextAction PROPOSED）最低; awareness gap 是小额加成（用户尚未知悉的
 * 高价值对象值得多看一眼, 但不改变类型主导序 — 10 < 任意两类型基差）。
 *
 * 零权重占位项（`projectImportanceScale` / `attentionMode*` /
 * `dependencyFanout` / `reportingUrgency` / `contextSwitchingCost`）:
 * 计划书 §20 特征清单的其余成员, 在 baseline（算法第 2 步）刻意零权重 —
 * 未标定的权重会破坏「可解释」与 INV-ATTN-1/2 的 R 级校验; 第 3 步
 * （有限 LLM semantic adjustment）/ 第 4 步（human override）激活时
 * 经本表显式改值, 评分函数结构不变。
 *
 * `estimatedDuration` **恒为 0** — INV-ATTN-2 的 R 级表达: 该字段是标签
 * 不是特征; 未来非零值 = 规格违反, 不是调参。
 *
 * 形状面: 结构接口（数值字段）而非 `typeof` 字面量类型 — 允许注入
 * 自定义权重表（测试/第 3 步 LLM adjustment 的校准表）, 同时
 * `ATTENTION_WEIGHTS` 常量保持 `as const` 的集中声明真源地位。
 */
export interface AttentionWeights {
  /** OPEN Intervention（人类责任队列, §9.2; AC-9 顶格）。 */
  readonly interventionOpen: number
  /** PENDING Intervention（等待/处理中 — 低于 OPEN 但完整展示, INV-ATTN-1）。 */
  readonly interventionPending: number
  /** ACTIVE Explicit Blocker（§9.4 现实阻碍 — 卡住工作流, 高紧度）。 */
  readonly blocker: number
  /** ScheduledEvent 基值（× 时间近度衰减, 见 `scheduledUrgency`）。 */
  readonly scheduledEvent: number
  /** ScheduledEvent 近度视距（epoch ms）: 视距内线性衰减 1→0, 视距外 0
   *  （分数可为 0, 项恒在 — 只排序不隐藏）。 */
  readonly scheduledEventHorizonMs: number
  /** PROPOSED NextAction（§9.3 轻量「可能值得做」— 最低档; 转正即离队）。 */
  readonly nextAction: number
  /** human awareness gap（计划书 §20 特征; UNSEEN/无记录 → 加成,
   *  SEEN/REVIEWED/ASSESSED → 0。小额 = 不翻转类型主导序）。 */
  readonly awarenessGap: number
  /** Project/Topic importance 每点加成（第 3/4 步激活）。 */
  readonly projectImportanceScale: number
  /** attention_mode=FOCUS 加成（第 3/4 步激活）。 */
  readonly attentionModeFocus: number
  /** attention_mode=NORMAL 加成（第 3/4 步激活）。 */
  readonly attentionModeNormal: number
  /** attention_mode=BACKGROUND 加成（第 3/4 步激活）。 */
  readonly attentionModeBackground: number
  /** explicit dependency fanout（第 3/4 步激活 — 数据面 WP-5.2/5.3 后到）。 */
  readonly dependencyFanout: number
  /** reporting urgency（第 3/4 步激活 — 数据面 WP-5.3 后到）。 */
  readonly reportingUrgency: number
  /** context switching cost（第 3/4 步激活 — 数据面 WP-5.3 后到）。 */
  readonly contextSwitchingCost: number
  /** INV-ATTN-2: 预计耗时零权重（标签字段 — 恒 0, 非调参项）。 */
  readonly estimatedDuration: number
}

/** baseline 权重表（集中声明的唯一真源 — 数值见上方字段注释）。 */
export const ATTENTION_WEIGHTS: AttentionWeights = {
  interventionOpen: 100,
  interventionPending: 75,
  blocker: 90,
  scheduledEvent: 80,
  scheduledEventHorizonMs: 7 * 24 * 60 * 60 * 1000,
  nextAction: 40,
  awarenessGap: 10,
  projectImportanceScale: 0,
  attentionModeFocus: 0,
  attentionModeNormal: 0,
  attentionModeBackground: 0,
  dependencyFanout: 0,
  reportingUrgency: 0,
  contextSwitchingCost: 0,
  estimatedDuration: 0,
} as const

/* ===================================================================== *
 * 评分输出
 * ===================================================================== */

/** 排序后的单项（输入项逐字段保留 — 联合交叉, kind 专属字段不丢 —
 *  + 分数 + why-now 解释 + 1-based 名次）。 */
export type AttentionRankedItem = AttentionItem & {
  readonly score: number
  /** why-now explanation（计划书 §20: Manager 只做推荐排序 + why-now）。
   *  人类可读中文短语; 每条对应一个计分项（可解释性 = 分数可逐条复原）。 */
  readonly reasons: readonly string[]
  /** 1-based 名次（排序后的位置; 同分按确定性次序, 无并列名次）。 */
  readonly rank: number
}

/** `rankAttention` 输出: 输入全集的排序（INV-ATTN-1: 无隐藏、无截断）。 */
export interface AttentionRanking {
  /** 评分时刻 epoch ms（= context.now — 确定性）。 */
  readonly generatedAt: number
  /** 本次评分使用的权重表引用（可解释性: 视图/审计可回读公式参数）。 */
  readonly weights: AttentionWeights
  /** 排序后的**全部**输入项（|items| ≡ |输入|）。 */
  readonly items: readonly AttentionRankedItem[]
}

/* ===================================================================== *
 * 评分函数
 * ===================================================================== */

/** 同分次序的类型档（tie-break 第二键 — 人类责任优先, 稳定且可解释）。 */
const TYPE_RANK: Readonly<Record<AttentionItemKind, number>> = {
  INTERVENTION: 0,
  BLOCKER: 1,
  SCHEDULED_EVENT: 2,
  NEXT_ACTION: 3,
}

/**
 * ScheduledEvent 时间近度因子（计划书 §20: deadline / ScheduledEvent 特征）。
 * 线性: `at <= now`（已到期）→ 1（封顶, 无负分）; 视距内 → 1..0 线性;
 * 视距外 → 0（分数 0 但项恒在 — INV-ATTN-1）。
 */
export function scheduledUrgency(at: number, now: number, weights: AttentionWeights = ATTENTION_WEIGHTS): number {
  if (at <= now) return 1
  const elapsed = at - now
  if (elapsed >= weights.scheduledEventHorizonMs) return 0
  return 1 - elapsed / weights.scheduledEventHorizonMs
}

/** 一项的分数分解（可解释: reasons 与分量一一对应）。
 *  INV-ATTN-2: 本函数不读取 `estimatedDurationMs`。 */
export function scoreAttentionItem(
  item: AttentionItem,
  context: AttentionContext,
  weights: AttentionWeights = ATTENTION_WEIGHTS,
): { readonly score: number; readonly reasons: readonly string[] } {
  let score = 0
  const reasons: string[] = []

  switch (item.kind) {
    case 'INTERVENTION': {
      // 计划书 §20 特征: Intervention state（OPEN/PENDING 两档）。
      score = item.status === 'OPEN' ? weights.interventionOpen : weights.interventionPending
      reasons.push(item.status === 'OPEN' ? 'OPEN Intervention — 待人类负责' : 'PENDING Intervention — 等待/处理中')
      reasons.push(`来源: ${item.origin}`)
      break
    }
    case 'BLOCKER': {
      score = weights.blocker
      reasons.push('ACTIVE Blocker — 现实阻碍未解除')
      break
    }
    case 'SCHEDULED_EVENT': {
      // 计划书 §20 特征: deadline / ScheduledEvent 时间近度。
      const urgency = scheduledUrgency(item.at, context.now, weights)
      score = weights.scheduledEvent * urgency
      if (urgency >= 1) {
        reasons.push('ScheduledEvent 已到期')
      } else if (urgency > 0) {
        reasons.push(`ScheduledEvent 临近（近度视距内, 时近性 ${(urgency * 100).toFixed(0)}%）`)
      } else {
        reasons.push('ScheduledEvent 在视距外（零分但不隐藏 — INV-ATTN-1）')
      }
      break
    }
    case 'NEXT_ACTION': {
      score = weights.nextAction
      reasons.push('NextAction 待用户处理（PROPOSED — 转正或弃置）')
      break
    }
  }

  // 计划书 §20 特征: human awareness gap（INV-ATTN-4: 仅高价值对象有记录;
  // 无记录按 §9.5 默认 UNSEEN 计 gap）。
  const state = item.awarenessState ?? 'UNSEEN'
  if (state === 'UNSEEN' && weights.awarenessGap !== 0) {
    score += weights.awarenessGap
    reasons.push('用户尚未知悉（awareness UNSEEN）')
  }

  // 零权重占位特征（计划书 §20 清单其余成员）: 基线 0 — 此处不产生分量,
  // 激活时（第 3/4 步）在本函数对应处加项, 权重经 `weights` 参数取数。
  // INV-ATTN-2: estimatedDurationMs 永不进入 score — 仅由视图渲染标签。

  return { score, reasons }
}

/**
 * 确定性全序比较（score 降序 → 类型档升序 → createdAt 升序 → id 升序）。
 * id 在其 kind 族内唯一（IV-/NA-/BLK-/SEV- 前缀族）, 第四键使序成为**全序**
 * —— 输入顺序无关（排序稳定性测试: 乱序输入 → 同一输出序）。
 */
function compareRanked(a: { readonly item: AttentionItem; readonly score: number }, b: { readonly item: AttentionItem; readonly score: number }): number {
  if (b.score !== a.score) return b.score - a.score
  const ta = TYPE_RANK[a.item.kind]
  const tb = TYPE_RANK[b.item.kind]
  if (ta !== tb) return ta - tb
  if (a.item.createdAt !== b.item.createdAt) return a.item.createdAt - b.item.createdAt
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0
}

/**
 * baseline 评分 + 排序（计划书 §20 算法第 2 步; 纯函数 — 同输入同输出）。
 *
 * INV-ATTN-1（T 级）: 输出 = 输入全集的排序 — 本函数**没有** filter/limit
 * 分支; 任何项（包括零分、远未来、无 WS 关联的项）都出现在输出里。
 *
 * @param items - 候选全集（状态契约: Intervention 仅 OPEN/PENDING;
 *   NextAction 仅 PROPOSED; Blocker 仅 ACTIVE; ScheduledEvent 全量）。
 * @param context - 评分上下文（now + 项目级特征）。
 * @param weights - 权重表（默认 `ATTENTION_WEIGHTS` — 集中声明的唯一真源）。
 * @returns 排序结果（items 为输入项的逐字段扩展 + score/reasons/rank）。
 */
export function rankAttention(
  items: readonly AttentionItem[],
  context: AttentionContext,
  weights: AttentionWeights = ATTENTION_WEIGHTS,
): AttentionRanking {
  const scored = items.map((item) => ({ item, ...scoreAttentionItem(item, context, weights) }))
  scored.sort(compareRanked)
  return {
    generatedAt: context.now,
    weights,
    items: scored.map((entry, index) => ({ ...entry.item, score: entry.score, reasons: entry.reasons, rank: index + 1 })),
  }
}
