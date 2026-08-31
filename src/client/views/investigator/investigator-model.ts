/**
 * WP-7.3 — transient investigator 视图纯投影层（零 hook、零 store 知识、
 * 零 I/O — 与 inbox-model.ts / actions-model.ts 同款纪律; 容器投影后以
 * plain props 传展示组件）。
 *
 * 冻结面来源:
 *  - transient 快照形状 — 本 WP `AnalysisTransientReader` 输出面
 *    （launcher 会话指针 → sessionlink 读取面; 零 operational 表写入,
 *    计划书 §26.2「默认 transient」）;
 *  - run 状态词表 — DOMAIN_SCHEMA §1.4 `RunStatus`（RUNNING / FINISHED /
 *    FAILED / CANCELLED）;
 *  - 保存载荷形状 — 宿主 `SaveAnalysisRecordParams`（sourceRef / content /
 *    investigatorRunId? / dshSessionId? — §12.2）。
 */

import type { AnalysisRecordDto, AnalysisTypedRef, SaveAnalysisRecordArgs, TransientPointerDto, TransientRunDto, TransientSessionDto } from '../../stores/analysis-slice.js'
import { t } from '../../i18n/copy.js'

/* -------------------------------------------------------------------- *
 * 状态词表（中文 — 单一来源; 组件纪律: 中文文案）
 * -------------------------------------------------------------------- */

/** Run 状态 → 中文标签（§1.4 RunStatus 4 值; 未知值原样透出）。 */
export const RUN_STATUS_LABEL: Record<string, string> = {
  RUNNING: t('status.running'),
  FINISHED: t('status.completed'),
  FAILED: t('status.failedShort'),
  CANCELLED: t('status.cancelled'),
}

/** source_ref kind → 中文标签（§12.2 三类来源 + 常见声明式对象; 未知值
 *  原样透出 — 形状面不限制 kind 集合, 语义归调用方）。 */
export const SOURCE_REF_KIND_LABEL: Record<string, string> = {
  INTERVENTION: t('investigator.kind.intervention'),
  INBOX_ITEM: t('investigator.kind.inboxItem'),
  TOPIC: 'Topic Brief',
  WORKSTREAM: 'Workstream Brief',
  PROJECT: 'Project Brief',
  CLAIM: t('investigator.kind.claim'),
  FACT: t('investigator.kind.fact'),
  ARTIFACT: t('investigator.kind.artifact'),
  RUN: 'Run',
}

/** 冻结 24 值 ObjectKind（common.schema.json `objectKind` — 保存对话框
 *  sourceRef.kind 选择面; 单一来源镜像, 宿主形状网落库前复验）。 */
export const OBJECT_KINDS: readonly string[] = [
  'PROJECT',
  'TOPIC',
  'WORKSTREAM',
  'TASK',
  'GATE',
  'MILESTONE',
  'RUN',
  'CLAIM',
  'FACT',
  'ARTIFACT',
  'RELATION',
  'OBJECTIVE',
  'INTERVENTION',
  'NEXT_ACTION',
  'BLOCKER',
  'INTERACTION',
  'REPORTING_ITEM',
  'SCHEDULED_EVENT',
  'INBOX_ITEM',
  'PLAN_FORK',
  'TOPOLOGY_EDGE',
  'DISCOVERED_SESSION',
  'HISTORY_EVENT',
  'ANALYSIS_RECORD',
]

/* -------------------------------------------------------------------- *
 * 时间格式化（epoch ms → 本地时区; 与 inbox formatInboxTime 同口径）
 * -------------------------------------------------------------------- */

export function formatAnalysisTime(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return '—'
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/* -------------------------------------------------------------------- *
 * transient 面板行投影（展示层零推导 — 缺席态逐字段 null 透出）
 * -------------------------------------------------------------------- */

/** transient 面板的三行投影（session / pointer / run — 缺席 = null 行）。 */
export interface TransientPanelRows {
  readonly session: TransientSessionDto | null
  readonly pointer: TransientPointerDto | null
  readonly run: TransientRunDto | null
  readonly runStatusLabel: string | null
  /** 面板头状态文案（会话运行中 / 已结束 / 缺席）。 */
  readonly headline: string
}

/** 由 transient 切片数据构造面板行（零 I/O, 纯投影）。 */
export function selectTransientRows(
  data: { readonly session: TransientSessionDto | null; readonly pointer: TransientPointerDto | null; readonly run: TransientRunDto | null } | null,
): TransientPanelRows {
  if (data === null) {
    return { session: null, pointer: null, run: null, runStatusLabel: null, headline: '无数据' }
  }
  const headline =
    data.session === null
      ? '会话已不在 live 列表（可能已 dispose）'
      : data.session.running
        ? 'investigator 会话运行中'
        : 'investigator 会话空闲'
  return {
    session: data.session,
    pointer: data.pointer,
    run: data.run,
    runStatusLabel: data.run !== null ? (RUN_STATUS_LABEL[data.run.status] ?? data.run.status) : null,
    headline,
  }
}

/* -------------------------------------------------------------------- *
 * 保存对话框载荷（用户显式确认 — INV-PERM-3 落地面）
 * -------------------------------------------------------------------- */

/** typedRef id 形态（common.schema.json `typedRef.id` 模式 — 客户端前置
 *  门; 宿主全预校验落库前再验 — 双重, 不依赖单层）。 */
export const TYPED_REF_ID_PATTERN = /^[A-Z]+-[1-9][0-9]*$/

/** Run id 形态（common.schema.json `idRun` — 可选字段的前置门）。 */
export const RUN_ID_PATTERN = /^R-[1-9][0-9]*$/

/** 保存对话框字段值（容器受控状态 — 纯字符串面）。 */
export interface SaveDialogFieldValues {
  readonly sourceRefKind: string
  readonly sourceRefId: string
  readonly content: string
  readonly investigatorRunId: string
  readonly dshSessionId: string
}

/** 由 transient 快照 + 启动上下文预填对话框字段值（容器挂载/开对话框时
 *  调用 — 预填 = 便利, 用户可改; 空串 = 该可选字段不携带）。 */
export function initialSaveFieldValues(input: {
  readonly sessionId: string
  readonly sourceRef?: AnalysisTypedRef
  readonly run: TransientRunDto | null
}): SaveDialogFieldValues {
  return {
    sourceRefKind: input.sourceRef?.kind ?? 'INTERVENTION',
    sourceRefId: input.sourceRef?.id ?? '',
    content: '',
    investigatorRunId: input.run?.id ?? '',
    dshSessionId: input.sessionId,
  }
}

/** 确认门（必填非空 + id 形态合法 — 与宿主预校验同口径, 按钮面即禁用,
 *  不等到提交才由宿主大声抛错）。 */
export function canConfirmSave(values: SaveDialogFieldValues): boolean {
  const sourceRefId = values.sourceRefId.trim()
  const content = values.content.trim()
  const runId = values.investigatorRunId.trim()
  return (
    TYPED_REF_ID_PATTERN.test(sourceRefId) &&
    content.length > 0 &&
    (runId.length === 0 || RUN_ID_PATTERN.test(runId))
  )
}

/** 字段值 → 宿主保存载荷（空选值丢弃 — 可选字段空 = 不携带, 不虚构）。 */
export function buildSavePayload(values: SaveDialogFieldValues): SaveAnalysisRecordArgs {
  const sourceRef: AnalysisTypedRef = { kind: values.sourceRefKind, id: values.sourceRefId.trim() }
  const runId = values.investigatorRunId.trim()
  const dshSessionId = values.dshSessionId.trim()
  return {
    sourceRef,
    content: values.content.trim(),
    ...(runId.length > 0 ? { investigatorRunId: runId } : {}),
    ...(dshSessionId.length > 0 ? { dshSessionId } : {}),
  }
}

/* -------------------------------------------------------------------- *
 * 已保存记录行投影
 * -------------------------------------------------------------------- */

/** 一条已保存 AnalysisRecord 的展示投影（badge 集合 + 时间 — 零推导）。 */
export interface SavedRecordRow {
  readonly record: AnalysisRecordDto
  readonly sourceRefLabel: string
  readonly sourceRefText: string
  readonly runLabel: string | null
  readonly sessionText: string | null
  readonly timeText: string
  /** content 预览（首行 — 原样首 120 字符）。 */
  readonly preview: string
}

/** 列表行集投影（稳定顺序保持 — 宿主已排序 createdAt ASC, 本层不改序）。 */
export function selectSavedRecordRows(records: readonly AnalysisRecordDto[]): readonly SavedRecordRow[] {
  return records.map((record) => ({
    record,
    sourceRefLabel: SOURCE_REF_KIND_LABEL[record.sourceRef.kind] ?? record.sourceRef.kind,
    sourceRefText: `${record.sourceRef.kind}:${record.sourceRef.id}`,
    runLabel: record.investigatorRunId !== null ? record.investigatorRunId : null,
    sessionText: record.dshSessionId,
    timeText: formatAnalysisTime(record.createdAt),
    preview: record.content.length > 120 ? `${record.content.slice(0, 120)}…` : record.content,
  }))
}
