/**
 * Reporting view — pure display helpers (labels / formatting / window
 * computation). Chinese product copy lives here + the components; zero
 * DSH imports (INV-PERM-5), zero store logic (the containers own the
 * store binding).
 */

import type { RptStatus } from '../../../host/service/reporting/types.js'

/** epoch ms → local display text (same deterministic form as the
 *  cockpit's `formatTime` — no timezone surprises in tests). */
export function formatEpochMs(epochMs: number | null): string {
  if (epochMs === null || epochMs === undefined || epochMs <= 0) return '—'
  const d = new Date(epochMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** InteractionKind → 中文标签 (DOMAIN_SCHEMA §10.1 冻结 6 值). */
export const INTERACTION_KIND_LABELS: Readonly<Record<string, string>> = {
  MEETING: '会议',
  AD_HOC_DISCUSSION: '即时讨论',
  SUPERVISOR_UPDATE: '导师汇报',
  COLLABORATOR_DISCUSSION: '协作者讨论',
  EXPERIMENT_SHIFT_HANDOFF: '实验交接',
  OTHER: '其他',
}

/** RptStatus → 中文标签 (DOMAIN_SCHEMA §13 冻结 5 值). */
export const RPT_STATUS_LABELS: Readonly<Record<RptStatus, string>> = {
  OPEN: '待启动',
  MATERIAL_READY: '材料就绪',
  READY_TO_REPORT: '待汇报',
  REPORTED: '已汇报',
  FOLLOW_UP_REQUIRED: '需跟进',
}

/** RPT 状态迁移按钮标签（§13 合法边的中文动作名）。 */
export const RPT_TRANSITION_LABELS: Readonly<Record<RptStatus, string>> = {
  OPEN: '标记为待启动',
  MATERIAL_READY: '材料准备完成',
  READY_TO_REPORT: '标记可汇报',
  REPORTED: '已完成汇报',
  FOLLOW_UP_REQUIRED: '需后续跟进',
}

/** SEV freq → 中文标签. */
export const SEV_FREQ_LABELS: Readonly<Record<string, string>> = {
  DAILY: '每天',
  WEEKLY: '每周',
  MONTHLY: '每月',
}

/** SEV freq → interval>1 时的中文量词（「每 N 天 / 每 N 周 / 每 N 个月」—
 *  月带量词「个」, 天/周不带）。 */
export const SEV_FREQ_UNITS: Readonly<Record<string, string>> = {
  DAILY: '天',
  WEEKLY: '周',
  MONTHLY: '个月',
}

/** SEV related_refs kind → 中文标签 (冻结 3 值). */
export const SEV_REF_KIND_LABELS: Readonly<Record<string, string>> = {
  REPORTING_ITEM: '汇报项',
  INTERVENTION: '介入',
  TOPIC: '主题',
}

/** The 7-day window of the 周报 mode (now − 7d → now). */
export function weekWindow(now: number): { readonly from: number; readonly to: number } {
  return { from: now - 7 * 24 * 60 * 60 * 1000, to: now }
}
