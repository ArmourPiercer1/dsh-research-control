/**
 * WP-5.3 — ScheduledEvent 到期语义 (纯函数, 零 I/O).
 *
 * **V1 语义 (任务边界: 「ScheduledEvent 到期语义 = 查询面按时间窗过滤 —
 * 不做调度器/提醒推送」; §10.3 「轻量 recurrence, 非完整 RRULE」;
 * 「不接外部 Calendar」)**:
 *
 *  - `ONCE` — 恰好一个发生点 `at`。窗口 [from, to] (to 缺省 = +∞, 两端
 *    闭) 过滤: `at ≥ from && (to === undefined || at ≤ to)`。
 *  - `RECURRING` — 冻结 schema 形状只有 `{kind, freq, interval?, until?}`:
 *    **没有锚点/相位字段** (非完整 RRULE 的直接后果)。无锚点 ⇒ 无法枚举
 *    tick (第几天/周几不确定), 故 V1 把 RECURRING 建模为**活跃跨度**
 *    (−∞, until] (无 until = 整个时间轴); 窗口过滤 = 窗口与活跃跨度有
 *    交集 (即 `until === undefined || until ≥ from`)。展示面因此给出
 *    「每周/每月(至 X)」的跨度标签而非具体 tick — 这是冻结形状下唯一
 *    诚实的投影 (never a fabricated date)。
 *  - 无调度器、无提醒推送: `reminder_lead_ms` 只落库 + 展示 (ONCE 事件的
 *    提醒点 = `at − lead`, 纯展示标记; RECURRING 无 tick ⇒ 无展示提醒点)。
 *
 * 排序键 (时间轴视图): ONCE → `at`; RECURRING → `until ?? +∞`
 * (活跃中的 recurring 没有终点, 排在其 until 之后/列表尾部)。
 */

import type { SevSchedule } from './types.js'

/** 查询面时间窗 (epoch ms; `to` 缺省 = +∞; 两端闭). */
export interface ScheduleWindow {
  readonly from: number
  readonly to?: number
}

/**
 * V1 窗口过滤 (§10.3 到期语义): 事件在窗口内「到期/活跃」当且仅当
 *  - ONCE: `at` ∈ [from, to];
 *  - RECURRING: 活跃跨度 (−∞, until or +∞) 与 [from, to] 相交。
 */
export function eventActiveInWindow(schedule: SevSchedule, window: ScheduleWindow): boolean {
  if (schedule.kind === 'ONCE') {
    if (schedule.at < window.from) return false
    return window.to === undefined || schedule.at <= window.to
  }
  return schedule.until === undefined || schedule.until >= window.from
}

/**
 * 时间轴排序键: ONCE → `at`; RECURRING → `until` (无 until →
 * `Number.MAX_SAFE_INTEGER`, 活跃中的 recurring 排在列表尾部)。
 * 同键时由调用方以 id 破平 (确定性)。
 */
export function scheduleSortKey(schedule: SevSchedule): number {
  if (schedule.kind === 'ONCE') return schedule.at
  return schedule.until ?? Number.MAX_SAFE_INTEGER
}

/**
 * 展示用提醒点 (V1 无推送): ONCE + lead → `at − lead` (负值 → null);
 * RECURRING → null (无 tick); 无 lead / lead < 0 → null。
 */
export function reminderPoint(schedule: SevSchedule, leadMs: number | undefined): number | null {
  if (leadMs === undefined || !Number.isSafeInteger(leadMs) || leadMs < 0) return null
  if (schedule.kind !== 'ONCE') return null
  const point = schedule.at - leadMs
  return point < 0 ? null : point
}
