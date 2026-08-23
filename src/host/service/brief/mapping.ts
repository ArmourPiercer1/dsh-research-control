/**
 * WP-5.5 — Living Brief 纯映射层（**零 I/O、零值 import** — host service
 * 面与 client 切片共用, 编译后仅本文件进入两侧 bundle）。
 *
 * 职责（WP-5.4 未决 3「生产接线时加纯映射层（record → 评分输入项:
 * statement→title、affects[0]→workstreamId、ONCE `at`/RECURRING 跨度
 * 起点→at — 形状不变）」的落地 + Brief 引擎入参归一）:
 *  - 生产记录形状 → `Brief*` 引擎入参（flooding `InterventionRecord` /
 *    actions `NextActionRecord`·`BlockerRecord` / reporting
 *    `ScheduledEventRecord`·`ReportingItemRecord`·`InteractionRecord` /
 *    loader `ObjectiveDoc` / 存储 `HistoryEventRecord`）;
 *  - wire DTO → `Brief*`（client 侧数据面: `InterventionDto` /
 *    `ObjectiveDto` — 冻结 wire 形状）;
 *  - 生产记录形状 → WP-5.4 评分输入项（`Attention*Item` — attention
 *    端口的生产映射, Brief 组装与注意力排序共用同一记录面）。
 *
 * 纪律（同 WP-5.4 `interventionToAttentionItem`）: 状态契约违规（CLOSED
 *  Intervention / 非 PROPOSED NextAction / 非 ACTIVE Blocker）=
 * **大声抛错**（映射面不静默丢行 — 队列过滤是组装方 buildBrief 的
 * 显式职责, 映射只归一合法行）。RECURRING ScheduledEvent 的 `at` 归一:
 * 冻结形状无 anchor/phase 字段 ⇒ 引擎面 `at=null`（标注周期）/ 评分面
 * `at=now`（V1 轻量语义: 周期事件恒近, 注入 now 保证确定性 —
 * WP-5.4 未决 3「RECURRING 跨度起点→at」口径）。
 */

import type { ObjectiveDoc } from '../../domain/loader/types.js'
import type { HistoryEventRecord } from '../../persistence/store/types.js'
import type { DashboardSnapshot, InterventionDto, ObjectiveDto } from '../../../shared/rpc-contracts.js'
import type {
  AttentionBlockerItem,
  AttentionInterventionItem,
  AttentionNextActionItem,
  AttentionScheduledEventItem,
} from '../attention/scorer.js'
import type { InterventionRecord } from '../flooding/types.js'
import type { BlockerRecord, NextActionRecord } from '../actions/types.js'
import type { InteractionRecord, ReportingItemRecord, ScheduledEventRecord } from '../reporting/types.js'
import type {
  BriefBlocker,
  BriefHistoryEvent,
  BriefIntervention,
  BriefNextAction,
  BriefObjective,
  BriefReportingItem,
  BriefScheduledEvent,
  BriefInteraction,
} from './types.js'

/* ===================================================================== *
 * 错误载体（映射契约违规 — caller-owned, 结构化）
 * ===================================================================== */

/** 映射面错误码（BRIEF_MAP_INPUT = 记录状态契约违规/字段形状异常）。 */
export class BriefMappingError extends Error {
  readonly code = 'BRIEF_MAP_INPUT' as const

  constructor(message: string) {
    super(message)
    this.name = 'BriefMappingError'
  }
}

/* ===================================================================== *
 * 生产记录 → Brief 引擎入参
 * ===================================================================== */

/** flooding `InterventionRecord` → `BriefIntervention`（CLOSED 抛错 — 队列面只收 OPEN/PENDING）。 */
export function interventionToBrief(record: InterventionRecord): BriefIntervention {
  if (record.status === 'CLOSED') {
    throw new BriefMappingError(
      `interventionToBrief: CLOSED intervention ${record.id} must not enter the brief (queue face: OPEN/PENDING only — INV-ATTN-1)`,
    )
  }
  return {
    id: record.id,
    title: record.title,
    origin: record.origin,
    status: record.status,
    workstreamIds: [...record.workstream_ids],
    createdAt: record.created_at,
  }
}

/** actions `NextActionRecord` → `BriefNextAction`（只收 PROPOSED — PROMOTED 已转 Task 离队, DISMISSED 已弃）。 */
export function nextActionToBrief(record: NextActionRecord): BriefNextAction {
  if (record.status !== 'PROPOSED') {
    throw new BriefMappingError(
      `nextActionToBrief: ${record.id} has status ${record.status} — only PROPOSED belongs to the brief queue (§9.3 状态机)`,
    )
  }
  return {
    id: record.id,
    statement: record.statement,
    status: 'PROPOSED',
    workstreamId: record.workstream_id ?? null,
    createdAt: record.created_at,
  }
}

/** actions `BlockerRecord` → `BriefBlocker`（只收 ACTIVE — CLEARED 已解除）。 */
export function blockerToBrief(record: BlockerRecord): BriefBlocker {
  if (record.status !== 'ACTIVE') {
    throw new BriefMappingError(`blockerToBrief: ${record.id} has status ${record.status} — only ACTIVE blockers belong to the brief (§9.4 状态机)`)
  }
  return {
    id: record.id,
    statement: record.statement,
    status: 'ACTIVE',
    affects: record.affects.map((a) => ({ kind: a.kind, id: a.id })),
    createdAt: record.created_at,
  }
}

/** reporting `ScheduledEventRecord` → `BriefScheduledEvent`（ONCE→时刻; RECURRING→null+周期标注）。 */
export function scheduledEventToBrief(record: ScheduledEventRecord): BriefScheduledEvent {
  return {
    id: record.id,
    title: record.title,
    at: record.schedule.kind === 'ONCE' ? record.schedule.at : null,
    recurring: record.schedule.kind === 'RECURRING',
  }
}

/** reporting `ReportingItemRecord` → `BriefReportingItem`（五态透传 — 未履约判定在引擎）。 */
export function reportingItemToBrief(record: ReportingItemRecord): BriefReportingItem {
  return {
    id: record.id,
    audience: record.audience,
    statement: record.statement,
    status: record.status,
    createdAt: record.created_at,
  }
}

/** reporting `InteractionRecord` → `BriefInteraction`（登记制, 无状态列）。 */
export function interactionToBrief(record: InteractionRecord): BriefInteraction {
  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    occurredAt: record.occurred_at,
  }
}

/** loader `ObjectiveDoc` → `BriefObjective`（声明式面; `target_date?` → `targetDate: number|null`）。 */
export function objectiveDocToBrief(doc: ObjectiveDoc): BriefObjective {
  return {
    id: doc.id,
    scope: doc.scope,
    statement: doc.statement,
    status: doc.status,
    priority: doc.priority,
    targetDate: doc.target_date ?? null,
  }
}

/** 存储 `HistoryEventRecord`（或同形状 wire `HistoryEventDto`）→ `BriefHistoryEvent`
 *  （摘要面只取坐标五字段 — payload 不进 Brief: drill-down 到 History 时间线读全文）。 */
export function historyEventToBrief(record: HistoryEventRecord): BriefHistoryEvent {
  return {
    eventId: record.eventId,
    eventSeq: record.eventSeq,
    ownerWorkstreamId: record.ownerWorkstreamId,
    eventType: record.eventType,
    occurredAt: record.occurredAt,
  }
}

/* ===================================================================== *
 * Wire DTO → Brief 引擎入参（client 侧数据面 — 冻结 wire 形状）
 * ===================================================================== */

/** `InterventionDto` → `BriefIntervention`（CLOSED 抛错 — 同生产面口径）。 */
export function interventionDtoToBrief(dto: InterventionDto): BriefIntervention {
  if (dto.status === 'CLOSED') {
    throw new BriefMappingError(`interventionDtoToBrief: CLOSED intervention ${dto.id} must not enter the brief (queue face: OPEN/PENDING only)`)
  }
  return {
    id: dto.id,
    title: dto.title,
    origin: dto.origin,
    status: dto.status,
    workstreamIds: [...dto.workstreamIds],
    createdAt: dto.createdAt,
  }
}

/** `ObjectiveDto` → `BriefObjective`（wire 面 `targetDate` 已是 `number|null` — 直接透传）。 */
export function objectiveDtoToBrief(dto: ObjectiveDto): BriefObjective {
  return {
    id: dto.id,
    scope: dto.scope,
    statement: dto.statement,
    status: dto.status,
    priority: dto.priority,
    targetDate: dto.targetDate,
  }
}

/**
 * `DashboardSnapshot` → Intervention 数据面（client 侧唯一 IV 来源）。
 * 组内防御性过滤（同 WP-5.4 `rankingFromDashboard` 口径: wire schema
 * 不强制组内状态一致性 — openInterventions 组只收 OPEN, pendingInterventions
 * 组只收 PENDING）。CLOSED 行两组皆不收（终态离队）。
 */
export function briefInterventionsFromDashboard(snapshot: DashboardSnapshot): BriefIntervention[] {
  const out: BriefIntervention[] = []
  for (const dto of snapshot.openInterventions) {
    if (dto.status === 'OPEN') out.push(interventionDtoToBrief(dto))
  }
  for (const dto of snapshot.pendingInterventions) {
    if (dto.status === 'PENDING') out.push(interventionDtoToBrief(dto))
  }
  return out
}

/* ===================================================================== *
 * 生产记录 → WP-5.4 评分输入项（attention 端口生产映射 — WP-5.4 未决 3）
 * ===================================================================== */

/** `NextActionRecord` → `AttentionNextActionItem`（statement→title; workstream_id→workstreamId）。 */
export function nextActionRecordToAttentionItem(record: NextActionRecord): AttentionNextActionItem {
  if (record.status !== 'PROPOSED') {
    throw new BriefMappingError(`nextActionRecordToAttentionItem: only PROPOSED next actions are ranked (${record.id} is ${record.status})`)
  }
  return {
    kind: 'NEXT_ACTION',
    id: record.id,
    title: record.statement,
    createdAt: record.created_at,
    workstreamId: record.workstream_id ?? null,
    status: 'PROPOSED',
  }
}

/** `BlockerRecord` → `AttentionBlockerItem`（affects[0] 且 kind=WORKSTREAM → workstreamId, 否则 null — 不因无 WS 关联而隐藏, INV-ATTN-1）。 */
export function blockerRecordToAttentionItem(record: BlockerRecord): AttentionBlockerItem {
  if (record.status !== 'ACTIVE') {
    throw new BriefMappingError(`blockerRecordToAttentionItem: only ACTIVE blockers are ranked (${record.id} is ${record.status})`)
  }
  const first = record.affects[0]
  return {
    kind: 'BLOCKER',
    id: record.id,
    title: record.statement,
    createdAt: record.created_at,
    workstreamId: first !== undefined && first.kind === 'WORKSTREAM' ? first.id : null,
    status: 'ACTIVE',
  }
}

/**
 * `ScheduledEventRecord` → `AttentionScheduledEventItem`。
 * `at`: ONCE → 时刻; RECURRING → `now`（V1 轻量语义: 周期事件恒近 —
 * 注入 now 保证确定性）。`createdAt`: 记录无创建时刻列 ⇒ 与 `at` 同值
 * （tie-break 第三键只需同族内确定性, 评分不读 createdAt 计分）。
 */
export function scheduledEventRecordToAttentionItem(record: ScheduledEventRecord, now: number): AttentionScheduledEventItem {
  const at = record.schedule.kind === 'ONCE' ? record.schedule.at : now
  return {
    kind: 'SCHEDULED_EVENT',
    id: record.id,
    title: record.title,
    createdAt: at,
    workstreamId: null,
    at,
  }
}

/** `InterventionRecord` → `AttentionInterventionItem`（WP-5.4
 *  `interventionToAttentionItem` 同口径的独立纯面 — client 侧不 import
 *  attention/service.ts【含 node:sqlite】, 两侧共用本映射）。 */
export function interventionRecordToAttentionItem(record: InterventionRecord): AttentionInterventionItem {
  if (record.status === 'CLOSED') {
    throw new BriefMappingError(`interventionRecordToAttentionItem: CLOSED intervention ${record.id} must not be ranked (input contract: OPEN/PENDING only — INV-ATTN-1)`)
  }
  return {
    kind: 'INTERVENTION',
    id: record.id,
    title: record.title,
    createdAt: record.created_at,
    workstreamId: record.workstream_ids[0] ?? null,
    status: record.status,
    origin: record.origin,
  }
}
