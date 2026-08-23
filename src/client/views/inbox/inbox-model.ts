/**
 * WP-6.4 — Research Inbox 纯投影层（零 hook、零 store 知识、零 I/O —
 * 与 actions-model.ts 同款纪律; 容器投影后以 plain props 传展示组件）。
 *
 * 冻结面来源:
 *  - `InboxSource` 7 值 / `InboxState` 3 值 — DOMAIN_SCHEMA §1.4;
 *  - 转换动作集 7 kind — 计划书 §28;
 *  - 升级条目标记 — 宿主 `InboxService.escalateMechanical` 写入的
 *    `raw.escalation = {highImpact, reasons}`（机械判定, §22.3）。
 */

import type { InboxConversionKind, InboxItemDto } from '../../stores/inbox-slice.js'

/* -------------------------------------------------------------------- *
 * 状态词表（中文 — 单一来源; 组件纪律: 中文文案）
 * -------------------------------------------------------------------- */

/** §1.4 InboxSource 7 值 → 中文标签。 */
export const INBOX_SOURCE_LABEL: Record<string, string> = {
  HUMAN_QUICK_CAPTURE: '用户快捷捕获',
  UNCLASSIFIED_AUDIT_FINDING: '未分类 audit 发现',
  IMPORTED_MEETING_NOTE: '导入会议记录',
  UNREGISTERED_WORKSPACE_CHANGE: '未注册工作区变化',
  AGENT_UNSTRUCTURED_REPORT: 'Agent 非结构化报告',
  EXTERNAL_NOTE: '外部笔记',
  DISCOVERED_SESSION: '发现的会话',
}

/** 来源类别（§11 捕获面二分 — 用户面 1 值 / 机械面 6 值）。 */
export const INBOX_SOURCE_CATEGORY: Record<string, 'HUMAN' | 'MECHANICAL'> = {
  HUMAN_QUICK_CAPTURE: 'HUMAN',
  UNCLASSIFIED_AUDIT_FINDING: 'MECHANICAL',
  IMPORTED_MEETING_NOTE: 'MECHANICAL',
  UNREGISTERED_WORKSPACE_CHANGE: 'MECHANICAL',
  AGENT_UNSTRUCTURED_REPORT: 'MECHANICAL',
  EXTERNAL_NOTE: 'MECHANICAL',
  DISCOVERED_SESSION: 'MECHANICAL',
}

/** 类别 → 中文标签。 */
export const INBOX_CATEGORY_LABEL: Record<'HUMAN' | 'MECHANICAL', string> = {
  HUMAN: '用户',
  MECHANICAL: '机械',
}

/** §13 InboxState 3 值 → 中文标签。 */
export const INBOX_STATE_LABEL: Record<InboxItemDto['state'], string> = {
  CAPTURED: '已捕获',
  CONVERTED: '已转换',
  DISMISSED: '已忽略',
}

/* -------------------------------------------------------------------- *
 * §28 转换动作集（7 kind）
 * -------------------------------------------------------------------- */

/** 转换目标 kind → 中文标签。 */
export const INBOX_CONVERSION_KIND_LABEL: Record<InboxConversionKind, string> = {
  TASK: '任务',
  NEXT_ACTION: '下一步行动',
  INTERVENTION: '干预',
  CLAIM: '主张',
  FACT: '事实',
  REPORTING_ITEM: '汇报项',
  INTERACTION: '互动',
}

/** 7 kind 封闭序（对话框目标选择 — 与 §28 动作集逐字）。 */
export const INBOX_CONVERSION_KINDS: readonly InboxConversionKind[] = [
  'TASK',
  'NEXT_ACTION',
  'INTERVENTION',
  'CLAIM',
  'FACT',
  'REPORTING_ITEM',
  'INTERACTION',
]

/** 一个转换字段（对话框表单行 — 纯展示模型）。 */
export interface InboxConversionFieldModel {
  readonly name: string
  readonly label: string
  readonly required: boolean
  readonly placeholder?: string
}

/**
 * 每 kind 的字段模型（§28 动作集的字段面 — 与宿主
 * `InboxConversionTargetFields` 判别联合逐字段对齐; 收集后的
 * `fields` 载荷 = `{kind, ...字段名}` 对象, 宿主按 kind 分派）。
 */
export const INBOX_CONVERSION_FIELD_MODELS: Record<InboxConversionKind, readonly InboxConversionFieldModel[]> = {
  TASK: [
    { name: 'workstreamId', label: '工作流', required: true, placeholder: 'WS-1' },
    { name: 'title', label: '标题', required: true, placeholder: '要做什么' },
  ],
  NEXT_ACTION: [
    { name: 'statement', label: '陈述', required: true, placeholder: '下一步做什么' },
    { name: 'rationale', label: '理由', required: false, placeholder: '为什么（可选）' },
    { name: 'workstreamId', label: '工作流', required: false, placeholder: 'WS-1（可选）' },
  ],
  INTERVENTION: [
    { name: 'title', label: '标题', required: true, placeholder: '干预标题' },
    { name: 'detail', label: '详情', required: false, placeholder: '细节（可选）' },
    { name: 'workstreamIds', label: '关联工作流', required: false, placeholder: 'WS-1, WS-2（逗号分隔, 可选）' },
  ],
  CLAIM: [
    { name: 'workstreamId', label: '工作流', required: true, placeholder: 'WS-1' },
    { name: 'statement', label: '主张陈述', required: true, placeholder: '主张什么' },
  ],
  FACT: [
    { name: 'workstreamId', label: '工作流', required: true, placeholder: 'WS-1' },
    { name: 'statement', label: '事实陈述', required: true, placeholder: '观察到什么' },
  ],
  REPORTING_ITEM: [
    { name: 'audience', label: '受众', required: true, placeholder: 'supervisor' },
    { name: 'statement', label: '陈述', required: true, placeholder: '汇报什么' },
  ],
  INTERACTION: [
    { name: 'interactionKind', label: '类型', required: true, placeholder: 'MEETING' },
    { name: 'title', label: '标题', required: true, placeholder: '互动标题' },
    { name: 'notes', label: '备注', required: false, placeholder: '备注（可选）' },
  ],
}

/* -------------------------------------------------------------------- *
 * 行投影（列表面）
 * -------------------------------------------------------------------- */

/** 升级条目标记（宿主机械判定落 raw — §22.3; 无标记 = null）。 */
export interface InboxEscalationMarker {
  readonly highImpact: boolean
  readonly reasons: readonly string[]
}

/** `raw.escalation` 机械判定标记提取（宿主 escalateMechanical 写入;
 *  形状异常 = 无标记 — 展示层不猜, 只认冻结标记）。 */
export function escalationMarkerOf(raw: Record<string, unknown> | null): InboxEscalationMarker | null {
  if (raw === null) return null
  const esc = raw.escalation
  if (esc === null || typeof esc !== 'object') return null
  const candidate = esc as { highImpact?: unknown; reasons?: unknown }
  if (typeof candidate.highImpact !== 'boolean' || !Array.isArray(candidate.reasons)) return null
  const reasons = candidate.reasons.filter((r): r is string => typeof r === 'string')
  return { highImpact: candidate.highImpact, reasons }
}

/** 一行列表投影（badge 集合 + 预览 — 展示层零推导）。 */
export interface InboxRow {
  readonly item: InboxItemDto
  readonly sourceLabel: string
  readonly category: 'HUMAN' | 'MECHANICAL'
  readonly categoryLabel: string
  readonly stateLabel: string
  readonly escalation: InboxEscalationMarker | null
  /** payload 预览（首行 — 展示层不再截断逻辑, 原样首 120 字符）。 */
  readonly preview: string
}

/** 升级标记 reasons → 中文（机械理由封闭 3 值; 未知值原样透出）。 */
export const INBOX_ESCALATION_REASON_LABEL: Record<string, string> = {
  STRICT_TRACKED_CHANGE: '关键路径',
  DELETION: '损失',
  BATCH_IMPACT: '批量影响',
}

/** 列表行集投影（稳定顺序保持 — 宿主已排序, 本层不改序）。 */
export function selectInboxRows(items: readonly InboxItemDto[]): readonly InboxRow[] {
  return items.map((item) => {
    const category = INBOX_SOURCE_CATEGORY[item.source] ?? 'MECHANICAL'
    return {
      item,
      sourceLabel: INBOX_SOURCE_LABEL[item.source] ?? item.source,
      category,
      categoryLabel: INBOX_CATEGORY_LABEL[category],
      stateLabel: INBOX_STATE_LABEL[item.state] ?? item.state,
      escalation: escalationMarkerOf(item.raw),
      preview: item.payload.length > 120 ? `${item.payload.slice(0, 120)}…` : item.payload,
    }
  })
}

/** 升级标记 → 中文理由串（无标记/非高影响 = null）。 */
export function escalationReasonText(marker: InboxEscalationMarker | null): string | null {
  if (marker === null || !marker.highImpact || marker.reasons.length === 0) return null
  return marker.reasons.map((r) => INBOX_ESCALATION_REASON_LABEL[r] ?? r).join('、')
}

/** epoch ms → 展示时间（本地时区, 与 cockpit formatTime 同口径）。 */
export function formatInboxTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 字段值收集载荷（对话框提交面 — 空选值丢弃; `workstreamIds` 逗号拆）。 */
export function buildConversionPayload(
  kind: InboxConversionKind,
  fieldValues: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = { kind }
  for (const model of INBOX_CONVERSION_FIELD_MODELS[kind]) {
    const value = (fieldValues[model.name] ?? '').trim()
    if (value.length === 0) continue
    if (model.name === 'workstreamIds') {
      fields[model.name] = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    } else {
      fields[model.name] = value
    }
  }
  return fields
}
