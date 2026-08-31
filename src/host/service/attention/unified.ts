/**
 * UI-8 (D §14) — Unified attention assembly（纯函数：零 I/O，注入式 sources）。
 *
 * 本模块把「一个项目」的注意力来源组装成 §14 统一列表的 DTO 序列，并给出
 * 跨项目（hub 语义）的 `queryAttention` 纯核心。与 scorer 同目录、同纪律：
 * 零 node:* import、零写面调用（sources 是只读投影 — ADJ-13 store 层读取），
 * 所有时钟经 `now` 注入（确定性；unit-pin 见 tests/attention-unified/）。
 *
 * 输入（RECON §5/§6 冻结契约）:
 *  - 4 类可评分来源 — INTERVENTION(OPEN/PENDING) / EXPLICIT_BLOCKER(ACTIVE) /
 *    NEXT_ACTION(PROPOSED) / DERIVED_BLOCKER(投影, 恒 'ACTIVE') — 经冻结
 *    scorer `rankAttention` 单一全序（score 降序 → 类型档 → createdAt 升序
 *    → id 升序）；
 *  - 1 类合成来源 — MISSING_NEXT_ACTION（ADJ-3 收紧条件：per-WS ∃ ACTIVE
 *    Objective 链接该 WS ∧ 无 PROMOTED NextAction ⇒ 恰一条合成项；PROPOSED
 *    并存**不**抑制）；
 *  - 终态项（IV CLOSED / BLK CLEARED / NA PROMOTED|DISMISSED）— score 0、
 *    rank null（RECON §6.4）、置于评分项之后，createdAt 降序 → id 升序。
 *
 * 机械约定（模块内文档化；非规格语义）:
 *  - IV/NA/BLK 的 `workstreamId` = 第一个关联 WS（IV: `workstream_ids[0] ??
 *    null` — 与既有 `interventionToAttentionItem` 先例一致；NA:
 *    `workstream_id ?? null`；BLK: `affects` 中第一个 kind=WORKSTREAM 的
 *    ref，否则 null）。
 *  - `sourceRef`（C §15.1 溯源 ref）: IV = `source_refs[0]`（空数组时退化为
 *    自指 `{kind:'INTERVENTION', id}` — 防御性，域内不应出现）；其余 kind =
 *    指向来源对象自身（`BLOCKER`/`NEXT_ACTION`/`DERIVED_BLOCKER`）或合成项的
 *    成因对象（MISSING_NEXT_ACTION → `OBJECTIVE`）。
 *  - DERIVED_BLOCKER 是**重算投影**，无创建时间戳：`createdAt = 0`（机械
 *    常量，`detectedAt` 同）；MISSING_NEXT_ACTION 的 `createdAt = detectedAt
 *    = now`（查询时刻 — RECON §6.3）。
 *  - `allowedActions` 中 `openWorkstream` / `openTask` 两个**纯导航** token
 *    在目标缺席时机械省略（`workstreamId = null` ⇒ 无 `openWorkstream`；
 *    `promoted_to_task_id` 缺席 ⇒ 无 `openTask`）— 不新增任何 RPC。
 *  - priority 带（ADJ-2 冻结点）: HIGH ≥ 90 / MEDIUM 50–89 / LOW < 50，
 *    由 score 机械导出；`reason` = scorer 首条 reason（实际恒非空），
 *    空时退化为收集期的机械文案（防御性）。
 *
 * 红线（INV-ATTN-1 / §14.3）: 本模块零 INSERT、零状态迁移、零 DDL —
 * 合成项只存在于查询结果中。
 */

import type {
  AttentionAllowedAction,
  AttentionItemDto,
  AttentionPriority,
  QueryAttentionArgs,
  QueryAttentionResult,
} from '../../../shared/rpc-contracts.js'
import type { BlockerRecord, NextActionRecord } from '../actions/types.js'
import { deriveWorkstreamBlockers } from '../actions/derived-blockers.js'
import type { ObjectiveDoc } from '../../domain/loader/types.js'
import type { InterventionRecord } from '../flooding/types.js'
import { foldEvents } from '../../history/replay/replay.js'
import { rankAttention, type AttentionContext, type AttentionItem, type AwarenessState } from './scorer.js'

/* ===================================================================== *
 * Port（注入式只读来源 — ADJ-13: store 层读取, 生产适配器在 rpc-services 侧）
 * ===================================================================== */

/** 派生/缺失投影所需的最小 WS 节点视图（store 层, 非 loader 整树）。 */
export interface AttentionWorkstreamNode {
  readonly id: string
  /** 声明式任务集（`items/tasks/` 成员 id — 执行态 fold 的初始键）。 */
  readonly taskIds: readonly string[]
  /** 规范计划序（`plan.yaml` `ordered_items`；无 plan ⇒ 空）。 */
  readonly canonicalOrder: readonly string[]
}

/** 最小事件视图（`HistoryEventRecord` 结构子集 — 与
 *  `derived-blockers.ts` 的 `DerivedBlockerEvent` 同形）。 */
export interface AttentionEventView {
  readonly eventSeq: number
  readonly eventType: string
  readonly payload: unknown
}

/**
 * 一个项目的注意力来源面（全部只读；生产实现 =
 * `ProductionResearchRpcServices` 侧的 store/wiring 适配器）。
 */
export interface ProjectAttentionSources {
  readonly projectId: string
  /** 全部状态的 intervention 行（含 CLOSED — 终态段渲染）。 */
  listInterventions(): readonly InterventionRecord[]
  /** 全部状态的 blocker 行（含 CLEARED）。 */
  listBlockers(): readonly BlockerRecord[]
  /** 全部状态的 next-action 行（含 PROMOTED/DISMISSED）。 */
  listNextActions(): readonly NextActionRecord[]
  /** 声明式 objectives（`objectives.yaml`；缺失 ⇒ 空数组）。 */
  listObjectives(): readonly ObjectiveDoc[]
  /** 项目内的全部 workstream 节点（derived/missing 投影的遍历域）。 */
  listWorkstreamNodes(): readonly AttentionWorkstreamNode[]
  /** WS 自身事件日志（audit/seq 序 — owner 作用域, `store.listRange(ws, 1)`）。 */
  listEvents(wsId: string): readonly AttentionEventView[]
  /** WS 的 current-focus 指针（未设/已逐出 ⇒ null）。 */
  currentFocusPlanItem(wsId: string): string | null
  /** IV 的 awareness 状态（无记录 ⇒ null = 默认 UNSEEN 语义）。 */
  awarenessState(ivId: string): AwarenessState | null
}

/* ===================================================================== *
 * 候选类型（收集期产物 — score/rank/priority 在组装期填充）
 * ===================================================================== */

/** DTO 减去组装期字段（score/rank 来自 rankAttention; priority 由 score 机械导出）。 */
export type AttentionItemDtoPartial = Omit<AttentionItemDto, 'score' | 'rank' | 'priority'>

/** 可评分候选: scorer 输入 + 同 id 的 DTO 骨架（组装期按 id 对齐回填）。 */
export interface ScoreableCandidate {
  readonly scorer: AttentionItem
  readonly dto: AttentionItemDtoPartial
}

/** 终态候选（无 scorer 输入 — 不参与 rankAttention）。 */
export interface TerminalCandidate {
  readonly dto: AttentionItemDtoPartial
}

/** 单项目收集结果。 */
export interface ProjectAttentionCollection {
  readonly projectId: string
  readonly scoreables: readonly ScoreableCandidate[]
  readonly terminals: readonly TerminalCandidate[]
}

/* ===================================================================== *
 * 常量
 * ===================================================================== */

/** B §31 冻结文案（合成项标题, 逐字）。 */
export const MISSING_NA_TITLE = 'Missing Next Action'

/** 分页默认/上限（QueryAttentionArgsSchema 已约束, 此处防御性钳制）。 */
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** 任务执行态词表（`rpc-services.ts` 同名局部常量的复制 — 折叠只认这 5 值）。 */
const TASK_EXECUTIONS = new Set(['PLANNED', 'ACTIVE', 'PAUSED', 'EXECUTED', 'CANCELLED'])

/** 冻结 §7 表: IV OPEN 的动作面（openWorkstream 仅在 WS 关联存在时 — 见模块头）。 */
const IV_OPEN_ACTIONS: readonly AttentionAllowedAction[] = ['markPending', 'closeIntervention', 'openWorkstream']
/** 冻结 §7 表: IV PENDING 的动作面（无 openWorkstream — RECON §7 冻结表优先于 R 候选）。 */
const IV_PENDING_ACTIONS: readonly AttentionAllowedAction[] = ['reopenIntervention', 'closeIntervention']
/** 冻结 §7 表: 显式 BLK ACTIVE 的动作面。 */
const BLK_ACTIVE_ACTIONS: readonly AttentionAllowedAction[] = ['clearBlocker', 'openWorkstream']
/** 冻结 §7 表: NA PROPOSED 的动作面。 */
const NA_PROPOSED_ACTIONS: readonly AttentionAllowedAction[] = ['promoteNextAction', 'dismissNextAction', 'openWorkstream']

/* ===================================================================== *
 * 评分上下文（unit-pin 形状: {now, projectImportance: 0, attentionMode: 'NORMAL'}）
 * ===================================================================== */

/** 统一列表的评分上下文构造器（baseline 零权重特征 — 形状冻结）。 */
export function unifiedAttentionContext(now: number): AttentionContext {
  return { now, projectImportance: 0, attentionMode: 'NORMAL' }
}

/** ADJ-2 冻结点: HIGH ≥ 90 / MEDIUM 50–89 / LOW < 50。 */
function priorityBand(score: number): AttentionPriority {
  if (score >= 90) return 'HIGH'
  if (score >= 50) return 'MEDIUM'
  return 'LOW'
}

/* ===================================================================== *
 * 收集（per-project）
 * ===================================================================== */

/** 收集单项目的全部注意力候选（零排序 — 排序在组装期）。 */
export function collectProjectAttention(sources: ProjectAttentionSources, now: number): ProjectAttentionCollection {
  const projectId = sources.projectId
  const interventions = sources.listInterventions()
  const blockers = sources.listBlockers()
  const nextActions = sources.listNextActions()
  const objectives = sources.listObjectives()
  const scoreables: ScoreableCandidate[] = []
  const terminals: TerminalCandidate[] = []

  /* — INTERVENTION（OPEN/PENDING 可评分; CLOSED 终态） — */
  for (const rec of interventions) {
    const workstreamId = rec.workstream_ids[0] ?? null
    const firstRef = rec.source_refs[0]
    const sourceRef = firstRef !== undefined ? { kind: firstRef.kind, id: firstRef.id } : { kind: 'INTERVENTION', id: rec.id }
    const base = {
      kind: 'INTERVENTION' as const,
      sourceId: rec.id,
      sourceRef,
      projectId,
      workstreamId,
      title: rec.title,
      createdAt: rec.created_at,
      detectedAt: rec.created_at,
      context: { intervention: { origin: rec.origin } },
    }
    if (rec.status === 'OPEN' || rec.status === 'PENDING') {
      scoreables.push({
        scorer: {
          kind: 'INTERVENTION',
          id: rec.id,
          title: rec.title,
          createdAt: rec.created_at,
          workstreamId,
          status: rec.status,
          origin: rec.origin,
          awarenessState: sources.awarenessState(rec.id) ?? null,
        },
        dto: {
          ...base,
          status: rec.status,
          reason: 'Intervention awaiting user review',
          allowedActions:
            rec.status === 'OPEN'
              ? withWorkstreamNav(IV_OPEN_ACTIONS, workstreamId)
              : withWorkstreamNav(IV_PENDING_ACTIONS, workstreamId),
        },
      })
    } else {
      terminals.push({
        dto: {
          ...base,
          status: rec.status,
          reason: 'Closed (terminal state)',
          allowedActions: [],
        },
      })
    }
  }

  /* — 显式 BLOCKER（ACTIVE 可评分; CLEARED 终态） — */
  for (const rec of blockers) {
    const wsRef = rec.affects.find((a) => a.kind === 'WORKSTREAM')
    const workstreamId = wsRef !== undefined ? wsRef.id : null
    const base = {
      kind: 'EXPLICIT_BLOCKER' as const,
      sourceId: rec.id,
      sourceRef: { kind: 'BLOCKER', id: rec.id },
      projectId,
      workstreamId,
      title: rec.statement,
      createdAt: rec.created_at,
      detectedAt: rec.created_at,
      context: {},
    }
    if (rec.status === 'ACTIVE') {
      scoreables.push({
        scorer: {
          kind: 'BLOCKER',
          id: rec.id,
          title: rec.statement,
          createdAt: rec.created_at,
          workstreamId,
          status: 'ACTIVE',
        },
        dto: {
          ...base,
          status: 'ACTIVE',
          reason: 'Active blocker',
          allowedActions: withWorkstreamNav(BLK_ACTIVE_ACTIONS, workstreamId),
        },
      })
    } else {
      terminals.push({
        dto: {
          ...base,
          status: 'CLEARED',
          reason: 'Cleared (terminal state)',
          allowedActions: [],
        },
      })
    }
  }

  /* — NEXT_ACTION（PROPOSED 可评分; PROMOTED/DISMISSED 终态） — */
  for (const rec of nextActions) {
    const workstreamId = rec.workstream_id ?? null
    const base = {
      kind: 'NEXT_ACTION' as const,
      sourceId: rec.id,
      sourceRef: { kind: 'NEXT_ACTION', id: rec.id },
      projectId,
      workstreamId,
      title: rec.statement,
      createdAt: rec.created_at,
      detectedAt: rec.created_at,
      context: { nextAction: { promotedToTaskId: rec.promoted_to_task_id ?? null } },
    }
    if (rec.status === 'PROPOSED') {
      scoreables.push({
        scorer: {
          kind: 'NEXT_ACTION',
          id: rec.id,
          title: rec.statement,
          createdAt: rec.created_at,
          workstreamId,
          status: 'PROPOSED',
        },
        dto: {
          ...base,
          status: 'PROPOSED',
          reason: 'Next action awaiting user decision',
          allowedActions: withWorkstreamNav(NA_PROPOSED_ACTIONS, workstreamId),
        },
      })
    } else if (rec.status === 'PROMOTED') {
      terminals.push({
        dto: {
          ...base,
          status: 'PROMOTED',
          reason: 'Promoted to task (left the attention queue)',
          allowedActions: rec.promoted_to_task_id !== undefined ? ['openTask'] : [],
        },
      })
    } else {
      terminals.push({
        dto: {
          ...base,
          status: 'DISMISSED',
          reason: 'Dismissed (terminal state)',
          allowedActions: [],
        },
      })
    }
  }

  /* — per-WS 投影: DERIVED_BLOCKER + MISSING_NEXT_ACTION — */
  for (const node of sources.listWorkstreamNodes()) {
    const events = sources.listEvents(node.id)
    const taskIds = new Set(node.taskIds)
    // 执行态折叠（getWorkstreamCurrent 的同配方最小复制 — 仅 execution 面）。
    const execution = new Map<string, string>()
    for (const t of node.taskIds) execution.set(t, 'PLANNED')
    foldEvents(
      events,
      (state: Map<string, string>, ev: AttentionEventView) => {
        if (ev.eventType === 'TASK_EXECUTION_CHANGED') {
          const raw = ev.payload
          const p = typeof raw === 'object' && raw !== null ? (raw as { task_id?: unknown; to?: unknown }) : null
          if (
            p !== null &&
            typeof p.task_id === 'string' &&
            typeof p.to === 'string' &&
            TASK_EXECUTIONS.has(p.to) &&
            state.has(p.task_id)
          ) {
            state.set(p.task_id, p.to)
          }
        }
        return state
      },
      execution,
    )
    const cf = sources.currentFocusPlanItem(node.id)
    const focusTaskId = cf !== null && taskIds.has(cf) ? cf : null
    const derived = deriveWorkstreamBlockers({
      workstreamId: node.id,
      focusTaskId,
      canonicalOrder: node.canonicalOrder,
      taskExecution: Object.fromEntries(execution),
      events,
    })
    for (const db of derived) {
      scoreables.push({
        scorer: {
          kind: 'BLOCKER',
          id: db.id,
          title: db.statement,
          // 重算投影无创建戳 — 机械 0（模块头文档化）。
          createdAt: 0,
          workstreamId: node.id,
          status: 'ACTIVE',
        },
        dto: {
          kind: 'DERIVED_BLOCKER',
          sourceId: db.id,
          sourceRef: { kind: 'DERIVED_BLOCKER', id: db.id },
          projectId,
          workstreamId: node.id,
          title: db.statement,
          status: 'ACTIVE',
          createdAt: 0,
          detectedAt: 0,
          reason: 'Derived from current plan state',
          allowedActions: ['openCause'],
          context: {
            derivedBlocker: {
              primaryAction: {
                label: db.primaryAction.label,
                targetKind: db.primaryAction.targetKind,
                targetId: db.primaryAction.targetId,
              },
            },
          },
        },
      })
    }

    // MISSING_NEXT_ACTION（ADJ-3 收紧条件, 逐字）: per-WS ∃ Objective
    // status=ACTIVE ∧ linkedRefs ∋ {kind:'WORKSTREAM', id: wsId} ∧ 无
    // PROMOTED NextAction ⇒ 恰一条合成项。PROPOSED 并存不抑制。
    const hasPromotedNa = nextActions.some((na) => na.status === 'PROMOTED' && na.workstream_id === node.id)
    if (!hasPromotedNa) {
      // 文件序第一个匹配 objective（objectiveId 的机械选取 — 模块头文档化）。
      const objective = objectives.find(
        (o) => o.status === 'ACTIVE' && o.linked_refs.some((r) => r.kind === 'WORKSTREAM' && r.id === node.id),
      )
      if (objective !== undefined) {
        const syntheticKey = `MISSING-NA-${node.id}`
        scoreables.push({
          scorer: {
            kind: 'NEXT_ACTION',
            id: syntheticKey,
            title: MISSING_NA_TITLE,
            createdAt: now,
            workstreamId: node.id,
            status: 'PROPOSED',
          },
          dto: {
            kind: 'MISSING_NEXT_ACTION',
            sourceId: syntheticKey,
            syntheticKey,
            sourceRef: { kind: 'OBJECTIVE', id: objective.id },
            projectId,
            workstreamId: node.id,
            title: MISSING_NA_TITLE,
            status: 'OPEN',
            createdAt: now,
            detectedAt: now,
            reason: 'Active objective without a promoted next action',
            allowedActions: ['createNextAction'],
            context: { missingNextAction: { objectiveId: objective.id } },
          },
        })
      }
    }
  }

  return { projectId, scoreables, terminals }
}

/** 导航 token 机械省略: workstreamId 缺席时去掉 `openWorkstream`（其余保序）。 */
function withWorkstreamNav(actions: readonly AttentionAllowedAction[], workstreamId: string | null): readonly AttentionAllowedAction[] {
  if (workstreamId !== null) return actions
  return actions.filter((a) => a !== 'openWorkstream')
}

/* ===================================================================== *
 * 组装（rankAttention 单一全序 + 终态尾段）
 * ===================================================================== */

/** 把收集期的候选组装成最终 DTO 序列（评分项全序在前, 终态项在后）。 */
export function assembleUnified(
  scoreables: readonly ScoreableCandidate[],
  terminals: readonly TerminalCandidate[],
  now: number,
): AttentionItemDto[] {
  const ranked = rankAttention(scoreables.map((c) => c.scorer), unifiedAttentionContext(now))
  const byId = new Map(scoreables.map((c) => [c.scorer.id, c]))
  const scoreableDtos: AttentionItemDto[] = ranked.items.map((r) => {
    const candidate = byId.get(r.id)
    if (candidate === undefined) {
      throw new Error(`assembleUnified: ranked item ${r.id} has no matching candidate (internal invariant)`)
    }
    return {
      ...candidate.dto,
      score: r.score,
      rank: r.rank,
      priority: priorityBand(r.score),
      reason: r.reasons.length > 0 ? r.reasons[0] : candidate.dto.reason,
    }
  })
  const terminalDtos: AttentionItemDto[] = terminals.map((t) => ({
    ...t.dto,
    score: 0,
    rank: null,
    priority: priorityBand(0),
  }))
  terminalDtos.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
    return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0
  })
  return [...scoreableDtos, ...terminalDtos]
}

/** 单项目便捷入口（collect → assemble）。 */
export function assembleProjectAttention(collection: ProjectAttentionCollection, now: number): AttentionItemDto[] {
  return assembleUnified(collection.scoreables, collection.terminals, now)
}

/* ===================================================================== *
 * 跨项目 query 核心（hub 语义 — 单一 rankAttention, 过滤 + 截断）
 * ===================================================================== */

/**
 * 过滤 + 截断（ADJ-4 双路共享尾部）: kind/status/priority 精确匹配,
 * workstreamId = DTO.workstreamId 等值 → total = 过滤后长度 →
 * offset/limit 截断（只截断, 不破坏全序 — INV-ATTN-1 无隐藏）。
 * limit 缺省 50, 上限 200（超限钳制）; offset 缺省 0。
 */
export function filterAndPage(
  items: readonly AttentionItemDto[],
  args: QueryAttentionArgs,
): QueryAttentionResult {
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const offset = args.offset ?? 0
  let filtered: readonly AttentionItemDto[] = items
  if (args.kind !== undefined) filtered = filtered.filter((i) => i.kind === args.kind)
  if (args.status !== undefined) filtered = filtered.filter((i) => i.status === args.status)
  if (args.priority !== undefined) filtered = filtered.filter((i) => i.priority === args.priority)
  if (args.workstreamId !== undefined) filtered = filtered.filter((i) => i.workstreamId === args.workstreamId)
  const total = filtered.length
  return { items: filtered.slice(offset, offset + limit), total }
}

/**
 * 共享 query 尾部（ADJ-4 双路复用）: 已收集的 collections →
 * 单一 rankAttention 全序（rank = 跨项目 1-based）→ 终态尾段 →
 * 过滤 → total → 截断。
 *
 * 校验: `workstreamId` 无 `projectId` ⇒ fail-loud（TypeError）。
 */
export function queryCollections(
  collections: readonly ProjectAttentionCollection[],
  args: QueryAttentionArgs,
  now: number,
): QueryAttentionResult {
  if (args.workstreamId !== undefined && args.projectId === undefined) {
    throw new TypeError('queryAttention: workstreamId requires projectId (a workstream belongs to a project)')
  }
  const items = assembleUnified(
    collections.flatMap((c) => c.scoreables),
    collections.flatMap((c) => c.terminals),
    now,
  )
  return filterAndPage(items, args)
}

/**
 * `queryAttention` 的纯核心（hub 语义）: 合并全部项目的 sources →
 * 单一 rankAttention 全序 → 终态尾段 → 过滤 → 截断。与 @Remote
 * 双路实现共享同一纯尾部（ADJ-4）。
 */
export function queryUnifiedAttention(
  projects: readonly ProjectAttentionSources[],
  args: QueryAttentionArgs,
  now: number,
): QueryAttentionResult {
  const collections = projects.map((p) => collectProjectAttention(p, now))
  return queryCollections(collections, args, now)
}
