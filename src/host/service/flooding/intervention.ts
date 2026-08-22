/**
 * WP-3.5 — AUTO_FLOODING Intervention 构造 + INTERVENTION_CREATED 事件构造
 * （纯 builder; 内容逐字段按 PLAN_FORK_SPEC §8 原文 + DOMAIN_SCHEMA §9.2 +
 * HISTORY_EVENT_CATALOG §5.7 冻结形状）。
 *
 * ## 记录（§8 动作逐字）
 *
 *   title: `Review accumulated agent plan forks [WS-<n>]`（[WS-<n>] = 被检
 *          WS id 逐字嵌入）;
 *   origin: AUTO_FLOODING（常量 — 构建面**不接受 origin 参数**: 本 builder
 *          只产机械触发闭集的 PLAN_FORK_FLOODING 成员, INV-ATTN-5 类型面）;
 *   source_refs: [相关 PF]（窗口内 OPEN PF 的 PLAN_FORK ref, 窗口顺序）;
 *   workstream_ids: [被检 WS]（事件 owner = 第一个, §9.2/§5.7）;
 *   status: OPEN（§9.2 初始态; 本 WP 无迁移面 — INV-PERM-4）;
 *   created_by: { kind: PLUGIN }（§8 动作: History 事件 actor=PLUGIN;
 *          AUTO_* origin 要求 actor.kind=PLUGIN, catalog §5.7）;
 *   detail: 机械证据摘要（窗口/计数/阈值/open PF 列表 — 任务「含证据字段」
 *          的 §9.2 落点: detail 是冻结形状中唯一的自由文本面）。
 *
 * 记录形状过**真实冻结** `schema/operational/attention.schema.json`
 * `$defs/Intervention`（schemas.ts; additionalProperties:false 网）。
 *
 * ## 事件（CATALOG §5.7 逐字）
 *
 *   payload: { intervention_id(新建), title, origin, source_refs? };
 *   owner  = workstream_ids[0]（§9.2/§5.7: 第一个关联 WS; 完全无 WS 关联
 *            不发事件 — builder 对无 WS 记录大声失败, 不构造事件）;
 *   origin=AUTO_* ⇒ actor.kind=PLUGIN（冻结 registry 校验面亦钉此, CROSS_FIELD）。
 *
 * V1 registry 适配（文档化）: §5.7 的 owner 推导（`workstreamOf`）只认
 * WS-local ref 种类, PLAN_FORK 不在其内 ⇒ 事件 payload 的 `source_refs`
 * 以**显式 WORKSTREAM ref 打头**（与 record.workstream_ids[0] 冗余一致,
 * 非新信息）, 后跟记录本身的 PF refs。记录行的 source_refs 保持 §8 原文
 * `[相关 PF]`（不加 WS ref — §9.2: workstream_ids 独立承载 WS 关联）。
 */

import type { ActorRef, TypedRef } from '../../history/registry/index.js'
import type { HistoryEventInput } from '../../persistence/store/index.js'
import { FloodingError } from './types.js'
import type { FloodingEvidence, InterventionRecord } from './types.js'

/** §8 动作的发射者（AUTO_FLOODING ⇒ PLUGIN; 与 WP-2.4 自动登记同款 label）。 */
export const AUTO_FLOODING_PLUGIN_ACTOR: ActorRef = { kind: 'PLUGIN', label: 'research-control' }

/** INTERVENTION_CREATED 的 V1 payload schema version（INV-HIST-4: 全 1）。 */
export const INTERVENTION_EVENT_SCHEMA_VERSION = 1

/** 冻结 IV id 模式（common.schema.json idIntervention）。 */
const IV_ID_PATTERN = /^IV-[1-9][0-9]*$/
/** 冻结 H id 模式（common.schema.json idHistoryEvent; 与 WP-2.1 一致）。 */
const H_ID_PATTERN = /^H-[1-9][0-9]*$/

/** §8 原文 title（逐字: `Review accumulated agent plan forks [WS-<n>]`）。 */
export function autoFloodingInterventionTitle(workstreamId: string): string {
  return `Review accumulated agent plan forks [${workstreamId}]`
}

/**
 * §8 证据的机械 detail 摘要（确定性格式 — 窗口/计数/阈值/open PF 列表全在;
 * 不判断科研理由, INV-SCI-2 同精神: 只陈述计数事实）。
 */
export function buildAutoFloodingDetail(evidence: FloodingEvidence): string {
  return (
    `auto flooding (PLAN_FORK_SPEC §8): ${evidence.workstream_id} ` +
    `count(OPEN)=${evidence.count} > threshold=${evidence.threshold}; ` +
    `window=${evidence.window.kind} as_of=${evidence.window.as_of}; ` +
    `open_pf=[${evidence.window.open_pf_ids.join(', ')}]`
  )
}

export interface BuildAutoFloodingInterventionParams {
  /** 已分配的 IV id（service 经共享 allocator reserve — §1.1 规则 2）。 */
  readonly id: string
  /** 检测器输出的结构化证据（title/workstream/source_refs/detail 全由它派生）。 */
  readonly evidence: FloodingEvidence
  /** epoch ms（A-3）。 */
  readonly createdAt: number
}

/**
 * §8 动作的 Intervention 记录（11 键冻结形状, 初始 OPEN, origin=AUTO_FLOODING）。
 * 输入校验: IV id 模式 / 证据窗口非空（触发的定义即 count > threshold ≥ 1）/
 * created_at epoch。
 */
export function buildAutoFloodingIntervention(params: BuildAutoFloodingInterventionParams): InterventionRecord {
  const id = params.id
  if (typeof id !== 'string' || !IV_ID_PATTERN.test(id)) {
    throw new FloodingError({
      code: 'FLOODING_INPUT',
      message: `intervention id ${JSON.stringify(String(id))} is not a well-formed IV id (common.schema.json idIntervention: ^IV-[1-9][0-9]*$)`,
    })
  }
  const createdAt = params.createdAt
  if (typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw new FloodingError({ code: 'FLOODING_INPUT', message: `createdAt must be a non-negative safe integer epoch ms (got ${String(createdAt)}; §1.2/A-3)` })
  }
  const evidence = params.evidence
  if (evidence.window.open_pf_ids.length === 0) {
    throw new FloodingError({
      code: 'FLOODING_INPUT',
      message: 'evidence window is empty — an AUTO_FLOODING intervention requires the OPEN PF set that tripped the threshold (PLAN_FORK_SPEC §8 source_refs=[相关 PF])',
    })
  }
  return {
    id,
    title: autoFloodingInterventionTitle(evidence.workstream_id),
    detail: buildAutoFloodingDetail(evidence),
    origin: 'AUTO_FLOODING',
    workstream_ids: [evidence.workstream_id],
    source_refs: evidence.window.open_pf_ids.map((pfId): TypedRef => ({ kind: 'PLAN_FORK', id: pfId })),
    status: 'OPEN',
    created_by: AUTO_FLOODING_PLUGIN_ACTOR,
    created_at: createdAt,
    // closed_at / resolution_note: 用户关闭时填（INV-PERM-4）— 本 WP 不写。
  }
}

export interface BuildInterventionCreatedEventParams {
  /** 已分配的 H id（service 经共享 allocator reserve — WP-2.1 约定: 调用方分配）。 */
  readonly eventId: string
  readonly record: InterventionRecord
  /** epoch ms（事件现实时刻 = 创建时刻）。 */
  readonly occurredAt: number
}

/**
 * §5.7 INTERVENTION_CREATED 事件（module header: payload 逐字 + owner 规则 +
 * WORKSTREAM ref 打头的 V1 适配）。无 WS 关联的记录大声失败（§5.7: 完全无
 * WS 关联的 Intervention 不发事件 — 不该走到构造）。
 */
export function buildInterventionCreatedEvent(params: BuildInterventionCreatedEventParams): HistoryEventInput {
  const eventId = params.eventId
  if (typeof eventId !== 'string' || !H_ID_PATTERN.test(eventId)) {
    throw new FloodingError({ code: 'FLOODING_INPUT', message: `eventId ${JSON.stringify(String(eventId))} is not a well-formed H id (^H-[1-9][0-9]*$)` })
  }
  const occurredAt = params.occurredAt
  if (typeof occurredAt !== 'number' || !Number.isSafeInteger(occurredAt) || occurredAt < 0) {
    throw new FloodingError({ code: 'FLOODING_INPUT', message: `occurredAt must be a non-negative safe integer epoch ms (got ${String(occurredAt)}; §1.2/A-3)` })
  }
  const record = params.record
  const workstreamId = record.workstream_ids[0]
  if (typeof workstreamId !== 'string' || workstreamId.length === 0) {
    throw new FloodingError({
      code: 'FLOODING_INPUT',
      message: `intervention ${record.id} has no associated workstream — such interventions emit NO HistoryEvent (catalog §5.7); nothing to build`,
    })
  }
  return {
    eventId,
    ownerWorkstreamId: workstreamId,
    eventType: 'INTERVENTION_CREATED',
    schemaVersion: INTERVENTION_EVENT_SCHEMA_VERSION,
    occurredAt,
    // §8 动作: actor=PLUGIN（AUTO_FLOODING; catalog §5.7 CROSS_FIELD 同钉）。
    actor: record.created_by,
    payload: {
      intervention_id: record.id,
      title: record.title,
      origin: record.origin,
      // V1 适配（module header）: WORKSTREAM ref 打头（owner 推导, 与
      // record.workstream_ids[0] 一致）+ 记录的 PF refs（§8 source_refs）。
      source_refs: [{ kind: 'WORKSTREAM', id: workstreamId } as TypedRef, ...record.source_refs],
    },
  }
}
