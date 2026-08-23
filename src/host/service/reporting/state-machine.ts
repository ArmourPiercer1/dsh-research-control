/**
 * WP-5.3 — ReportingItem 状态机 (纯函数, 零 I/O).
 *
 * 合法转换表 = DOMAIN_SCHEMA §13 逐字 (ReportingItem 行):
 *
 *   OPEN               → MATERIAL_READY
 *   MATERIAL_READY     → READY_TO_REPORT | OPEN
 *   READY_TO_REPORT    → REPORTED | MATERIAL_READY
 *   REPORTED           → FOLLOW_UP_REQUIRED
 *   FOLLOW_UP_REQUIRED → READY_TO_REPORT
 *
 * 规则 (同 §13 通则 / INV-TASK-1):
 *   - 非法转换在 **service 层拒绝** (本模块的纯 guard, `ReportingError`
 *     code `RPT_WRONG_STATE`, 消息携带合法集);
 *   - 自环拒绝 (表外 — 同 intervention §13 guard 的 self-loop 纪律);
 *   - 无终态 (表内所有状态均有出边 — REPORTED 经 FOLLOW_UP_REQUIRED 回到
 *     READY_TO_REPORT, 汇报可多轮)。
 *
 * CATALOG 侧: HISTORY_EVENT_CATALOG §4 无 RPT_* 事件 (本层无 registry
 * 事件 — 与 WP-3.1 PlanFork / WP-3.5 intervention 状态缓存同口径: 状态
 * 迁移 = 条件 UPDATE 状态缓存列, 行内容不可变 trigger 兜底)。
 */

import { ReportingError, RPT_STATUSES, type RptStatus } from './types.js'

/** The §13 legal transition table (the single source for the guard). */
export const RPT_LEGAL_TRANSITIONS: Readonly<Record<RptStatus, readonly RptStatus[]>> = {
  OPEN: ['MATERIAL_READY'],
  MATERIAL_READY: ['READY_TO_REPORT', 'OPEN'],
  READY_TO_REPORT: ['REPORTED', 'MATERIAL_READY'],
  REPORTED: ['FOLLOW_UP_REQUIRED'],
  FOLLOW_UP_REQUIRED: ['READY_TO_REPORT'],
}

/** True iff `to` is a legal §13 successor of `from` (self-loops illegal). */
export function isRptTransitionLegal(from: RptStatus, to: RptStatus): boolean {
  return RPT_LEGAL_TRANSITIONS[from].includes(to)
}

/**
 * Guard one transition: throw `RPT_WRONG_STATE` when `to` is not a legal
 * successor of `from` (message carries the legal set — the same UX
 * contract as the planfork/intervention §13 guards).
 */
export function checkRptTransition(id: string, from: RptStatus, to: RptStatus): void {
  if (from === to) {
    const legal = RPT_LEGAL_TRANSITIONS[from].join(' | ')
    throw new ReportingError({
      code: 'RPT_WRONG_STATE',
      message:
        `reporting item ${JSON.stringify(id)} is already ${from} (self-loops are rejected; ` +
        `legal from ${from}: ${legal === '' ? 'none' : legal} — DOMAIN_SCHEMA §13)`,
    })
  }
  if (!isRptTransitionLegal(from, to)) {
    const legal = RPT_LEGAL_TRANSITIONS[from].join(' | ')
    throw new ReportingError({
      code: 'RPT_WRONG_STATE',
      message:
        `reporting item ${JSON.stringify(id)} cannot transition ${from} → ${to} ` +
        `(legal from ${from}: ${legal === '' ? 'none' : legal} — DOMAIN_SCHEMA §13)`,
    })
  }
}

/** The full status vocabulary (diagnostics / row decoding). */
export const ALL_RPT_STATUSES = RPT_STATUSES
