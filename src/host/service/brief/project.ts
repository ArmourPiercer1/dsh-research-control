/**
 * WP-5.5 — Living Brief 投影引擎（**纯函数: 零 I/O**）。
 *
 * 职责（任务目标 1）: 输入 = 各数据面快照（`BriefInputs`: attention
 * ranking + dashboard + interventions + objectives + 最近 History 摘要 +
 * Phase 5 各操作面 + Future Plan 头部）→ 输出三级 `LivingBrief`:
 *   - L1 一句话态势（全项目一行, 附项目 + 注意力 Top 项引用）;
 *   - L2 要点列表（计划书 §19.2 八类「重点回答」逐类落点 — 每条
 *     **重要陈述带 ref**: 对象 id 或事件 seq — INV-ATTN-3 的机器可查
 *     形态; 空面 = 明确的「暂无数据」占位, **不虚构**）;
 *   - L3 完整数据底座引用表（V1 数据面全集 13 行 — 每面恒有一行:
 *     AVAILABLE/EMPTY/PLACEHOLDER; Phase 6 未交付面 audit/inbox 恒为
 *     「待开通」占位 — 输入形状里根本没有这两面, 结构上无虚构路径）。
 *
 * INV-ATTN-3（T 级）「Brief 是 projection 非 source of truth；每项重要
 * 陈述必须可 drill-down 到结构化对象/History/Run」的机器可查落地:
 *   - 每条 `DATA` 要点 `refs` 非空（`validateBriefRefs` 校验面钉死）;
 *   - ref 两种形态: OBJECT（结构化对象 id, 15 kind 白名单）/
 *     HISTORY_EVENT（owner WS + eventSeq + eventId — History 时间线的
 *     入口坐标; Run drill-down 经 WS 页 Current 区 / WP-4.6 面板）。
 *
 * 确定性（纯函数纪律 — 同输入同输出, 测试钉）:
 *   - 每类要点内部排序键固定（见各 build 函数注释）; 输入数组顺序不
 *     影响输出（同分同值按 id 全序 tie-break）;
 *   - 陈述文案为固定模板 + 数据插值, 零 locale/零随机; 长文本统一
 *     `truncate`（≤80 字符 + '…'）;
 *   - 时间不做 locale 格式化（视图层 `formatTime` 负责展示, 引擎只放
 *     epoch/seq 事实）。
 *
 * 引擎**全定义**（total）: 任何输入组合（含 dashboard/attention 为
 * null、所有面空集）都产出一个合法 Brief, 从不抛错 — 缺口以占位陈述
 * 呈现（「暂无数据」/「待开通」）。
 *
 * 为什么允许 type-only import（`AttentionRanking` / `DashboardSnapshot`）:
 * 两侧（host service 面 + client 切片）共用本引擎 ⇒ 形状单一真源,
 * 重声明 union 只会制造漂移; type-only import 在编译后消失, 不进入
 * 任何 bundle（scorer.ts 零 import, rpc-contracts 的 zod 运行图本就在
 * 两侧 bundle 内 — 同 WP-5.4 attention-slices.ts 纪律）。
 */

import type { DashboardSnapshot } from '../../../shared/rpc-contracts.js'
import type { AttentionItemKind, AttentionRankedItem, AttentionRanking } from '../attention/scorer.js'
import {
  BRIEF_DATA_PLANES,
  BRIEF_OBJECT_KINDS,
  BRIEF_POINT_CATEGORIES,
  type BriefAffectsRef,
  type BriefBaseRow,
  type BriefDataPlaneId,
  type BriefHistoryEvent,
  type BriefInputs,
  type BriefObjectKind,
  type BriefPoint,
  type BriefRef,
  type LivingBrief,
} from './types.js'

/* ===================================================================== *
 * 常量（集中声明 — 唯一数值来源, 测试钉）
 * ===================================================================== */

/** 最近 History 摘要窗口（「summary」= 最近 5 条, 审计轴）。 */
export const BRIEF_RECENT_CAP = 5

/** L2 IN_FLIGHT 要点 = 注意力队列 Top 5（排名序 — 完整队列在 L3/注意力视图）。 */
export const BRIEF_IN_FLIGHT_CAP = 5

/** L1 附带的注意力 Top 项引用数（项目引用之外）。 */
export const BRIEF_L1_REF_CAP = 3

/** SEV「临近」视距（epoch ms）— 与 WP-5.4 评分器近度视距同口径
 * （7 天; 漂移由 tests/brief 对照 `ATTENTION_WEIGHTS.scheduledEventHorizonMs` 钉）。 */
export const BRIEF_SEV_HORIZON_MS = 7 * 24 * 60 * 60 * 1000

/** 陈述内长文本截断（L1/L2 紧凑面 — 完整内容经 ref drill-down 可达）。 */
const STATEMENT_CAP = 80

/* ===================================================================== *
 * 小工具（本文件内私有）
 * ===================================================================== */

/** 长文本截断（确定性; 短文本原样）。 */
function truncate(text: string, cap: number = STATEMENT_CAP): string {
  const t = text.trim()
  return t.length > cap ? `${t.slice(0, cap - 1)}…` : t
}

/** 排序优先级（P0 最高）。 */
const PRIORITY_RANK: Readonly<Record<'P0' | 'P1' | 'P2' | 'P3', number>> = { P0: 0, P1: 1, P2: 2, P3: 3 }

/** 注意力项 kind → 可 drill-down 对象 kind（1:1 同名映射）。 */
const ATTENTION_KIND_TO_OBJECT: Readonly<Record<AttentionItemKind, BriefObjectKind>> = {
  INTERVENTION: 'INTERVENTION',
  NEXT_ACTION: 'NEXT_ACTION',
  BLOCKER: 'BLOCKER',
  SCHEDULED_EVENT: 'SCHEDULED_EVENT',
}

function objectRef(objectKind: BriefObjectKind, id: string): BriefRef {
  return { kind: 'OBJECT', objectKind, id }
}

function eventRef(workstreamId: string, eventSeq: number, eventId: string): BriefRef {
  return { kind: 'HISTORY_EVENT', workstreamId, eventSeq, eventId }
}

/** 注意力排名项 → OBJECT ref（+ 可选 WS ref）。 */
function attentionItemRefs(item: AttentionRankedItem): BriefRef[] {
  const refs: BriefRef[] = [objectRef(ATTENTION_KIND_TO_OBJECT[item.kind], item.id)]
  if (item.workstreamId !== null) refs.push(objectRef('WORKSTREAM', item.workstreamId))
  return refs
}

/* ===================================================================== *
 * L2 各类要点 builder（每类: 数据要点 / 占位要点, 排序键见注释）
 * ===================================================================== */

/** OBJECTIVE — 当前 Objective（§19.2 第 1 问）。
 *  排序: priority（P0→P3）→ id。只取 ACTIVE（达成/放弃不是「当前」）。 */
function buildObjectivePoints(inputs: BriefInputs): BriefPoint[] {
  const active = inputs.objectives
    .filter((o) => o.status === 'ACTIVE')
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id.localeCompare(b.id))
  if (active.length === 0) {
    const total = inputs.objectives.length
    return [
      {
        id: 'L2-OBJECTIVE-0',
        category: 'OBJECTIVE',
        status: 'PLACEHOLDER',
        statement:
          total === 0
            ? '暂无 Objective（数据面为空集）'
            : `暂无 ACTIVE Objective（已登记 ${total} 条, 均为达成/放弃终态）`,
        refs: [],
      },
    ]
  }
  return active.map((o, i) => ({
    id: `L2-OBJECTIVE-${i}`,
    category: 'OBJECTIVE',
    status: 'DATA' as const,
    statement: `目标 ${o.id}（${o.priority}, ${o.scope === 'PROJECT' ? '项目级' : '主题级'}）：${truncate(o.statement)}`,
    refs: [objectRef('OBJECTIVE', o.id)],
  }))
}

/** RECENT — 最近发生什么（§19.2 第 2 问）= 最近 History 摘要（≤5）。
 *  排序: occurredAt 降 → eventSeq 降 → eventId 升（最新在前）。 */
function buildRecentPoints(inputs: BriefInputs): BriefPoint[] {
  const digest = [...inputs.history]
    .sort(
      (a, b) =>
        b.occurredAt - a.occurredAt || b.eventSeq - a.eventSeq || a.eventId.localeCompare(b.eventId),
    )
    .slice(0, BRIEF_RECENT_CAP)
  if (digest.length === 0) {
    return [
      {
        id: 'L2-RECENT-0',
        category: 'RECENT',
        status: 'PLACEHOLDER',
        statement: '暂无最近事件（History 摘要为空集）',
        refs: [],
      },
    ]
  }
  return digest.map((ev, i) => ({
    id: `L2-RECENT-${i}`,
    category: 'RECENT',
    status: 'DATA' as const,
    statement: `最近：${ev.eventType}（${ev.ownerWorkstreamId}, 事件 ${ev.eventId}, seq ${ev.eventSeq}）`,
    refs: [eventRef(ev.ownerWorkstreamId, ev.eventSeq, ev.eventId)],
  }))
}

/** IN_FLIGHT — 当前正在执行什么（§19.2 第 3 问）= 注意力队列 Top 5。
 *  排序: ranking.rank 升（评分器已是确定性全序 — INV-ATTN-1 完整队列
 *  在 L3 attention 行与注意力视图, 这里只取头部陈述）。 */
function buildInFlightPoints(attention: AttentionRanking | null, now: number): BriefPoint[] {
  if (attention === null || attention.items.length === 0) {
    return [
      {
        id: 'L2-IN_FLIGHT-0',
        category: 'IN_FLIGHT',
        status: 'PLACEHOLDER',
        statement: attention === null
          ? '暂无进行中事项（attention 数据面不可用）'
          : '暂无进行中事项（注意力队列为空集）',
        refs: [],
      },
    ]
  }
  const top = attention.items.slice(0, BRIEF_IN_FLIGHT_CAP)
  return top.map((item, i) => ({
    id: `L2-IN_FLIGHT-${i}`,
    category: 'IN_FLIGHT',
    status: 'DATA' as const,
    statement: `注意力 #${item.rank}：${truncate(item.title)}（得分 ${item.score} — ${item.reasons.join('；')}）`,
    refs: attentionItemRefs(item),
  }))
}

/** FUTURE_PLAN — Future Plan（§19.2 第 4 问）= canonical plan 头部。
 *  排序: workstreamId 升 → 面内输入序（plan 头部 = 声明式序, 输入序即
 *  canonical 序, 不重排）。items 为空的 WS 不产要点（无「下一步」可说）。 */
function buildFuturePlanPoints(inputs: BriefInputs): BriefPoint[] {
  const withItems = [...inputs.futurePlans]
    .filter((p) => p.items.length > 0)
    .sort((a, b) => a.workstreamId.localeCompare(b.workstreamId))
  if (withItems.length === 0) {
    return [
      {
        id: 'L2-FUTURE_PLAN-0',
        category: 'FUTURE_PLAN',
        status: 'PLACEHOLDER',
        statement: '暂无 Future Plan（无 canonical plan 头部 — 数据面为空集）',
        refs: [],
      },
    ]
  }
  let i = 0
  const points: BriefPoint[] = []
  for (const plan of withItems) {
    const first = plan.items[0]!
    points.push({
      id: `L2-FUTURE_PLAN-${i}`,
      category: 'FUTURE_PLAN',
      status: 'DATA',
      statement: `${plan.workstreamId} 计划下一步：${first.kind} ${truncate(first.title)}（${first.id}${plan.items.length > 1 ? `，其后还有 ${plan.items.length - 1} 项` : ''}）`,
      refs: [objectRef('WORKSTREAM', plan.workstreamId), objectRef(first.kind, first.id)],
    })
    i += 1
  }
  return points
}

/** INTERVENTION — Intervention 队列（§19.2 第 5 问）= 单条队列级陈述。
 *  refs 排序: createdAt 升 → id 升（WP-3.5 查询面稳定序同口径;
 *  INV-ATTN-1: OPEN/PENDING 全量进 refs, 不隐藏）。 */
function buildInterventionPoints(inputs: BriefInputs): BriefPoint[] {
  const ivs = [...inputs.interventions].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  if (ivs.length === 0) {
    return [
      {
        id: 'L2-INTERVENTION-0',
        category: 'INTERVENTION',
        status: 'PLACEHOLDER',
        statement: '暂无 Intervention（队列为空集）',
        refs: [],
      },
    ]
  }
  const open = ivs.filter((v) => v.status === 'OPEN').length
  return [
    {
      id: 'L2-INTERVENTION-0',
      category: 'INTERVENTION',
      status: 'DATA',
      statement: `${ivs.length} 项人工干预待处理（OPEN ${open} / PENDING ${ivs.length - open}）`,
      refs: ivs.map((v) => objectRef('INTERVENTION', v.id)),
    },
  ]
}

/** BLOCKER — Blocker（§19.2 第 6 问）= 每 ACTIVE 阻碍一条。
 *  排序: id 升。refs = BLK 自身 + affects（WS/T/R 均可 drill-down）。 */
function buildBlockerPoints(inputs: BriefInputs): BriefPoint[] {
  const blks = [...inputs.blockers].sort((a, b) => a.id.localeCompare(b.id))
  if (blks.length === 0) {
    return [
      {
        id: 'L2-BLOCKER-0',
        category: 'BLOCKER',
        status: 'PLACEHOLDER',
        statement: '暂无 Blocker（无未解除阻碍）',
        refs: [],
      },
    ]
  }
  return blks.map((blk, i) => ({
    id: `L2-BLOCKER-${i}`,
    category: 'BLOCKER',
    status: 'DATA' as const,
    statement: `阻碍 ${blk.id}：${truncate(blk.statement)}（影响 ${blk.affects.map((a) => a.id).join('、') || '未指明'}）`,
    refs: [
      objectRef('BLOCKER', blk.id),
      ...blk.affects.map((a: BriefAffectsRef) => objectRef(a.kind, a.id)),
    ],
  }))
}

/** UPCOMING — upcoming event / reporting（§19.2 第 7 问）。
 *  SEV 排序: at 升（null=周期事件 排最后）→ id 升; RPT 未履约（≠
 *  REPORTED）id 升。SEV 陈述按到期/临近/排期/周期四档（BRIEF_SEV_HORIZON_MS
 *  视距 — 评分器同口径）。 */
function buildUpcomingPoints(inputs: BriefInputs, now: number): BriefPoint[] {
  const sevs = [...inputs.scheduledEvents].sort(
    (a, b) => (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
  )
  const rpts = inputs.reportingItems
    .filter((r) => r.status !== 'REPORTED')
    .sort((a, b) => a.id.localeCompare(b.id))

  const points: BriefPoint[] = []
  let i = 0
  for (const sev of sevs) {
    let phase: string
    if (sev.recurring || sev.at === null) {
      phase = '周期事件（V1 不推算下次发生）'
    } else if (sev.at <= now) {
      phase = '已到期'
    } else if (sev.at - now <= BRIEF_SEV_HORIZON_MS) {
      phase = '临近（7 天视距内）'
    } else {
      phase = '已排期'
    }
    points.push({
      id: `L2-UPCOMING-${i}`,
      category: 'UPCOMING',
      status: 'DATA',
      statement: `计划事件 ${sev.id}：${truncate(sev.title)}（${phase}）`,
      refs: [objectRef('SCHEDULED_EVENT', sev.id)],
    })
    i += 1
  }
  for (const rpt of rpts) {
    points.push({
      id: `L2-UPCOMING-${i}`,
      category: 'UPCOMING',
      status: 'DATA',
      statement: `待汇报 ${rpt.id}（${rpt.status}）：向 ${truncate(rpt.audience)} — ${truncate(rpt.statement)}`,
      refs: [objectRef('REPORTING_ITEM', rpt.id)],
    })
    i += 1
  }
  if (points.length === 0) {
    return [
      {
        id: 'L2-UPCOMING-0',
        category: 'UPCOMING',
        status: 'PLACEHOLDER',
        statement: '暂无 upcoming 事件/汇报（数据面为空集）',
        refs: [],
      },
    ]
  }
  return points
}

/** NEXT_ACTION — NextAction（§19.2 第 8 问）= 每 PROPOSED 建议一条。
 *  排序: id 升。 */
function buildNextActionPoints(inputs: BriefInputs): BriefPoint[] {
  const nas = [...inputs.nextActions].sort((a, b) => a.id.localeCompare(b.id))
  if (nas.length === 0) {
    return [
      {
        id: 'L2-NEXT_ACTION-0',
        category: 'NEXT_ACTION',
        status: 'PLACEHOLDER',
        statement: '暂无 NextAction（无待决建议）',
        refs: [],
      },
    ]
  }
  return nas.map((na, i) => ({
    id: `L2-NEXT_ACTION-${i}`,
    category: 'NEXT_ACTION',
    status: 'DATA' as const,
    statement: `下一步建议 ${na.id}：${truncate(na.statement)}`,
    refs: [
      objectRef('NEXT_ACTION', na.id),
      ...(na.workstreamId !== null ? [objectRef('WORKSTREAM', na.workstreamId)] : []),
    ],
  }))
}

/* ===================================================================== *
 * L1 一句话态势
 * ===================================================================== */

/**
 * L1 = 固定模板 + 计数插值（确定性）。各子句按需出现, 空项目 =
 * 「无进行中数据」; dashboard 缺失 = 数据缺口陈述（ref 空）。
 */
function buildLevel1(inputs: BriefInputs, now: number): LivingBrief['level1'] {
  const dashboard = inputs.dashboard
  if (dashboard === null) {
    return {
      statement: '无法组装态势：dashboard 快照缺失（数据面不可用）',
      refs: [],
    }
  }
  const clauses: string[] = []
  const activeObjs = inputs.objectives.filter((o) => o.status === 'ACTIVE').length
  if (activeObjs > 0) clauses.push(`${activeObjs} 个活跃目标`)
  const openIv = inputs.interventions.filter((v) => v.status === 'OPEN').length
  const pendingIv = inputs.interventions.filter((v) => v.status === 'PENDING').length
  if (openIv + pendingIv > 0) clauses.push(`干预 ${openIv} OPEN / ${pendingIv} PENDING`)
  if (inputs.blockers.length > 0) clauses.push(`${inputs.blockers.length} 项阻碍未解除`)
  if (inputs.nextActions.length > 0) clauses.push(`${inputs.nextActions.length} 项建议待决`)
  const urgentSev = inputs.scheduledEvents.filter(
    (s) => !s.recurring && s.at !== null && s.at - now <= BRIEF_SEV_HORIZON_MS,
  ).length
  const openRpt = inputs.reportingItems.filter((r) => r.status !== 'REPORTED').length
  if (urgentSev + openRpt > 0) clauses.push(`${urgentSev + openRpt} 项临近/待汇报`)
  const latest = [...inputs.history].sort(
    (a, b) => b.occurredAt - a.occurredAt || b.eventSeq - a.eventSeq || a.eventId.localeCompare(b.eventId),
  )[0]
  if (latest !== undefined) clauses.push(`最近 ${latest.eventType}（${latest.ownerWorkstreamId}）`)

  const body = clauses.length > 0 ? clauses.join('；') : '无进行中数据（各数据面为空集）'
  const refs: BriefRef[] = [objectRef('PROJECT', dashboard.project.id)]
  if (inputs.attention !== null) {
    for (const item of inputs.attention.items.slice(0, BRIEF_L1_REF_CAP)) {
      const objectKind = ATTENTION_KIND_TO_OBJECT[item.kind]
      const id = item.id
      if (!refs.some((r) => r.kind === 'OBJECT' && r.objectKind === objectKind && r.id === id)) {
        refs.push(objectRef(objectKind, id))
      }
    }
  }
  return { statement: `《${dashboard.project.title}》：${body}`, refs }
}

/* ===================================================================== *
 * L3 完整数据底座引用表
 * ===================================================================== */

/** L3 行面（固定 13 行 — V1 数据面全集; audit/inbox 恒占位, 见 types.ts 头注）。 */
function buildBaseRows(inputs: BriefInputs, historyDigestLength: number): BriefBaseRow[] {
  const rows: BriefBaseRow[] = []

  const dashboard = inputs.dashboard
  rows.push(
    dashboard === null
      ? {
          plane: 'dashboard',
          label: 'Dashboard 快照（项目/主题）',
          status: 'PLACEHOLDER',
          count: 0,
          refs: [],
          note: 'dashboard 数据面不可用',
        }
      : {
          plane: 'dashboard',
          label: 'Dashboard 快照（项目/主题）',
          status: 'AVAILABLE',
          count: 1 + dashboard.topics.length,
          refs: [
            objectRef('PROJECT', dashboard.project.id),
            ...dashboard.topics.map((t) => objectRef('TOPIC', t.id)),
          ],
          note: null,
        },
  )

  const attention = inputs.attention
  rows.push(
    attention === null
      ? {
          plane: 'attention',
          label: 'Attention ranking（注意力排序）',
          status: 'PLACEHOLDER',
          count: 0,
          refs: [],
          note: 'attention 数据面不可用（WP-5.4 排序面未接线）',
        }
      : {
          plane: 'attention',
          label: 'Attention ranking（注意力排序）',
          status: attention.items.length > 0 ? 'AVAILABLE' : 'EMPTY',
          count: attention.items.length,
          refs: attention.items.map((item) => objectRef(ATTENTION_KIND_TO_OBJECT[item.kind], item.id)),
          note: 'WP-5.4 baseline 排序（只排序、不隐藏 — INV-ATTN-1）',
        },
  )

  const ivs = [...inputs.interventions].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  rows.push({
    plane: 'interventions',
    label: 'Intervention（人工干预队列）',
    status: ivs.length > 0 ? 'AVAILABLE' : 'EMPTY',
    count: ivs.length,
    refs: ivs.map((v) => objectRef('INTERVENTION', v.id)),
    note: 'WP-5.1 生命周期（OPEN/PENDING 全量 — INV-ATTN-1）',
  })

  const objs = [...inputs.objectives].sort((a, b) => a.id.localeCompare(b.id))
  rows.push({
    plane: 'objectives',
    label: 'Objective（研究目标）',
    status: objs.length > 0 ? 'AVAILABLE' : 'EMPTY',
    count: objs.length,
    refs: objs.map((o) => objectRef('OBJECTIVE', o.id)),
    note: 'WP-5.2 声明式面（.research/objectives.yaml）',
  })

  const nas = [...inputs.nextActions].sort((a, b) => a.id.localeCompare(b.id))
  rows.push({
    plane: 'nextActions',
    label: 'NextAction（下一步建议）',
    status: nas.length > 0 ? 'AVAILABLE' : 'EMPTY',
    count: nas.length,
    refs: nas.map((n) => objectRef('NEXT_ACTION', n.id)),
    note: 'WP-5.2 操作面（PROPOSED）',
  })

  const blks = [...inputs.blockers].sort((a, b) => a.id.localeCompare(b.id))
  rows.push({
    plane: 'blockers',
    label: 'Blocker（显式阻碍）',
    status: blks.length > 0 ? 'AVAILABLE' : 'EMPTY',
    count: blks.length,
    refs: blks.map((b) => objectRef('BLOCKER', b.id)),
    note: 'WP-5.2 操作面（ACTIVE）',
  })

  const sevs = [...inputs.scheduledEvents].sort(
    (a, b) => (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
  )
  rows.push({
    plane: 'scheduledEvents',
    label: 'ScheduledEvent（计划事件）',
    status: sevs.length > 0 ? 'AVAILABLE' : 'EMPTY',
    count: sevs.length,
    refs: sevs.map((s) => objectRef('SCHEDULED_EVENT', s.id)),
    note: 'WP-5.3 操作面（不接外部 Calendar）',
  })

  const rpts = [...inputs.reportingItems].sort((a, b) => a.id.localeCompare(b.id))
  rows.push({
    plane: 'reportingItems',
    label: 'ReportingItem（汇报事项）',
    status: rpts.length > 0 ? 'AVAILABLE' : 'EMPTY',
    count: rpts.length,
    refs: rpts.map((r) => objectRef('REPORTING_ITEM', r.id)),
    note: 'WP-5.3 操作面（§13 状态机）',
  })

  const ints = [...inputs.interactions].sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id))
  rows.push({
    plane: 'interactions',
    label: 'Interaction（科研交互登记）',
    status: ints.length > 0 ? 'AVAILABLE' : 'EMPTY',
    count: ints.length,
    refs: ints.map((x) => objectRef('INTERACTION', x.id)),
    note: 'WP-5.3 登记面（无状态列）',
  })

  rows.push({
    plane: 'history',
    label: 'History（最近事件摘要）',
    status: historyDigestLength > 0 ? 'AVAILABLE' : 'EMPTY',
    count: historyDigestLength,
    refs: historyDigestRefs(inputs),
    note: historyDigestLength === BRIEF_RECENT_CAP ? '摘要窗口截断：仅最近 5 条' : null,
  })

  const planItems: { ws: string; item: BriefInputs['futurePlans'][number]['items'][number] }[] = []
  for (const plan of [...inputs.futurePlans].sort((a, b) => a.workstreamId.localeCompare(b.workstreamId))) {
    for (const item of plan.items) planItems.push({ ws: plan.workstreamId, item })
  }
  rows.push({
    plane: 'futurePlans',
    label: 'Future Plan（canonical plan 头部）',
    status: planItems.length > 0 ? 'AVAILABLE' : 'EMPTY',
    count: planItems.length,
    refs: planItems.map((p) => objectRef(p.item.kind, p.item.id)),
    note: '声明式层投影（plan.yaml 头部; client 侧无 wire 路径）',
  })

  // Phase 6 未交付面 — 恒「待开通」占位（不虚构; 输入形状无此两面）。
  rows.push({
    plane: 'audit',
    label: 'Audit（三层审计）',
    status: 'PLACEHOLDER',
    count: 0,
    refs: [],
    note: '待开通（Phase 6 审计面 — 未交付）',
  })
  rows.push({
    plane: 'inbox',
    label: 'Research Inbox（研究收件箱）',
    status: 'PLACEHOLDER',
    count: 0,
    refs: [],
    note: '待开通（Phase 6 — wire `inboxCount` 为冻结 null 占位）',
  })

  return rows
}

/** history 摘要的 ref 集合（与 L2 RECENT 同窗口同序 — 最近 5, 最新在前）。 */
function historyDigestRefs(inputs: BriefInputs): BriefRef[] {
  return [...inputs.history]
    .sort((a, b) => b.occurredAt - a.occurredAt || b.eventSeq - a.eventSeq || a.eventId.localeCompare(b.eventId))
    .slice(0, BRIEF_RECENT_CAP)
    .map((ev) => eventRef(ev.ownerWorkstreamId, ev.eventSeq, ev.eventId))
}

/* ===================================================================== *
 * 主投影函数
 * ===================================================================== */

/**
 * 三级投影（纯函数 — 同输入同输出）。
 * @param inputs - 各数据面快照（缺口 = 空集/null — 占位呈现, 不虚构）。
 * @param now - 投影时刻 epoch ms（调用方注入 — 确定性）。
 * @returns `LivingBrief`（L1 一句话 / L2 八类要点（每 DATA 点带 ref）/
 *   L3 13 行数据底座引用表）。
 */
export function projectBrief(inputs: BriefInputs, now: number): LivingBrief {
  const level2: BriefPoint[] = [
    ...buildObjectivePoints(inputs),
    ...buildRecentPoints(inputs),
    ...buildInFlightPoints(inputs.attention, now),
    ...buildFuturePlanPoints(inputs),
    ...buildInterventionPoints(inputs),
    ...buildBlockerPoints(inputs),
    ...buildUpcomingPoints(inputs, now),
    ...buildNextActionPoints(inputs),
  ]
  const digestRefs = historyDigestRefs(inputs)
  return {
    generatedAt: now,
    level1: buildLevel1(inputs, now),
    level2,
    level3: buildBaseRows(inputs, digestRefs.length),
  }
}

/* ===================================================================== *
 * INV-ATTN-3 机器可查校验面
 * ===================================================================== */

/**
 * 校验一个 Brief 的 ref 完整性（INV-ATTN-3「每项重要陈述必须可
 * drill-down」的机器可查形态 — 返回违规列表, **空 = 通过**）:
 *  1. 结构完备: L2 八类要点每类 ≥1 条; L3 13 行每面恰好一行;
 *  2. 每条 `DATA` 要点 refs 非空（重要陈述必带来源）;
 *  3. 全部 ref 形状良构（OBJECT: kind ∈ 15 白名单 + id 非空;
 *     HISTORY_EVENT: seq 正整数 + ws/eventId 非空）;
 *  4. L3 行状态自洽（AVAILABLE: count≡refs.length 且 ≥1; EMPTY/
 *     PLACEHOLDER: count=0 且 refs 空）;
 *  5. audit/inbox 行恒 PLACEHOLDER（Phase 6 缺口不虚构）。
 */
export function validateBriefRefs(brief: LivingBrief): readonly string[] {
  const violations: string[] = []

  if (!Number.isFinite(brief.generatedAt) || brief.generatedAt < 0) {
    violations.push(`generatedAt 非法（需非负 epoch ms, got ${String(brief.generatedAt)}）`)
  }

  const checkRef = (ref: BriefRef, where: string): void => {
    if (ref.kind === 'OBJECT') {
      if (!(BRIEF_OBJECT_KINDS as readonly string[]).includes(ref.objectKind)) {
        violations.push(`${where}: OBJECT ref 的 objectKind 不在白名单（${JSON.stringify(ref.objectKind)}）`)
      }
      if (typeof ref.id !== 'string' || ref.id.length === 0) {
        violations.push(`${where}: OBJECT ref 的 id 为空`)
      }
    } else if (ref.kind === 'HISTORY_EVENT') {
      if (!Number.isSafeInteger(ref.eventSeq) || ref.eventSeq < 1) {
        violations.push(`${where}: HISTORY_EVENT ref 的 eventSeq 非法（got ${String(ref.eventSeq)}）`)
      }
      if (typeof ref.workstreamId !== 'string' || ref.workstreamId.length === 0) {
        violations.push(`${where}: HISTORY_EVENT ref 的 workstreamId 为空`)
      }
      if (typeof ref.eventId !== 'string' || ref.eventId.length === 0) {
        violations.push(`${where}: HISTORY_EVENT ref 的 eventId 为空`)
      }
    } else {
      violations.push(`${where}: 未知 ref kind（${JSON.stringify((ref as { kind?: unknown }).kind)}）`)
    }
  }

  brief.level1.refs.forEach((ref, i) => checkRef(ref, `L1.refs[${i}]`))

  const seenCategories = new Set<string>()
  for (const point of brief.level2) {
    seenCategories.add(point.category)
    if (point.status === 'DATA' && point.refs.length === 0) {
      violations.push(`L2 要点 ${point.id}（${point.category}）为 DATA 但 refs 为空 — INV-ATTN-3 违反`)
    }
    if (point.status !== 'DATA' && point.refs.length > 0) {
      violations.push(`L2 要点 ${point.id}（${point.category}）为占位但携带 refs — 占位不应引用不存在的数据`)
    }
    point.refs.forEach((ref, i) => checkRef(ref, `L2 要点 ${point.id} refs[${i}]`))
  }
  for (const category of BRIEF_POINT_CATEGORIES) {
    if (!seenCategories.has(category)) {
      violations.push(`L2 缺少类别 ${category} 的要点（八类「重点回答」须逐类落点）`)
    }
  }

  const seenPlanes = new Set<string>()
  for (const row of brief.level3) {
    seenPlanes.add(row.plane)
    if (row.status === 'AVAILABLE') {
      if (row.count < 1 || row.refs.length !== row.count) {
        violations.push(`L3 面 ${row.plane}: AVAILABLE 但 count/refs 不自洽（count=${row.count}, refs=${row.refs.length}）`)
      }
    } else if (row.count !== 0 || row.refs.length !== 0) {
      violations.push(`L3 面 ${row.plane}: ${row.status} 但 count/refs 非零（count=${row.count}, refs=${row.refs.length}）`)
    }
    row.refs.forEach((ref, i) => checkRef(ref, `L3 面 ${row.plane} refs[${i}]`))
  }
  for (const plane of BRIEF_DATA_PLANES) {
    if (!seenPlanes.has(plane)) {
      violations.push(`L3 缺少数据面 ${plane} 的行（完整数据底座须逐面落行）`)
    }
  }
  for (const row of brief.level3) {
    if ((row.plane === 'audit' || row.plane === 'inbox') && row.status !== 'PLACEHOLDER') {
      violations.push(`L3 面 ${row.plane} 必须为 PLACEHOLDER（Phase 6 未交付 — 不虚构数据）`)
    }
  }

  return violations
}
