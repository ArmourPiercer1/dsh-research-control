/**
 * ScheduledEvent timeline row — pure props presentation (WP-5.3).
 * Renders the V1 projection of one 日程 (schedule.ts semantics — the
 * single source of truth on the host side):
 *   - ONCE: 发生点 + 一次性 label; lead > 0 ⇒ 展示用提醒点 (无推送);
 *   - RECURRING: freq/interval 节奏 label + until 边界 (无 until ⇒
 *     「持续中」)— 冻结形状无锚点 ⇒ V1 不投影具体 tick (诚实降级,
 *     不伪造日期)。
 */

import type { ReactElement } from 'react'
import type { LocalScheduledEvent } from '../../stores/reporting-slices.js'
import { reminderPoint } from '../../../host/service/reporting/schedule.js'
import {
  SEV_FREQ_LABELS,
  SEV_FREQ_UNITS,
  SEV_REF_KIND_LABELS,
  formatEpochMs,
} from './reporting-format.js'
import styles from './reporting.module.css'

export interface ScheduledEventRowProps {
  readonly event: LocalScheduledEvent
}

/** One 日程 of the 时间轴. */
export function ScheduledEventRow(props: ScheduledEventRowProps): ReactElement {
  const event = props.event
  const schedule = event.schedule
  const once = schedule.kind === 'ONCE'
  const lead = event.reminderLeadMs
  const remindAt = reminderPoint(schedule, lead === null ? undefined : lead)

  let whenText: string
  let spanText: string
  if (once) {
    whenText = formatEpochMs(schedule.at)
    spanText = '一次性'
  } else {
    const interval = schedule.interval ?? 1
    // interval > 1 时用中文量词拼接（「每 2 个月」/「每 3 天」/「每 2 周」
    // — 量词见 SEV_FREQ_UNITS，月带「个」）。
    const freqText = interval === 1 ? SEV_FREQ_LABELS[schedule.freq] : `每 ${interval} ${SEV_FREQ_UNITS[schedule.freq]}`
    whenText = schedule.until !== undefined ? formatEpochMs(schedule.until) : formatEpochMs(null)
    spanText = `${freqText}（${schedule.until !== undefined ? `至 ${formatEpochMs(schedule.until)}` : '持续中'}）`
  }

  return (
    <li className={styles.timelineItem} data-event-kind={schedule.kind} data-event-id={event.localId}>
      <span className={styles.timelineDot} aria-hidden="true" />
      <div className={styles.timelineBody}>
        <div className={styles.rowHead}>
          <span className={styles.rowId}>{event.localId}</span>
          <span className={styles.kindBadge} data-event-kind={schedule.kind}>
            {spanText}
          </span>
          <span className={styles.rowTitle}>{event.title}</span>
          <span className={styles.rowTime}>{whenText}</span>
        </div>
        <div className={styles.chipRow}>
          {event.relatedRefs.map((ref, index) => (
            <span key={`${ref.kind}-${ref.id}-${index}`} className={styles.chip} data-ref-kind={ref.kind}>
              {SEV_REF_KIND_LABELS[ref.kind] ?? ref.kind} {ref.id}
            </span>
          ))}
          {once && lead !== null && lead > 0 && (
            <span className={styles.chip} data-remind-at={remindAt ?? 0}>
              {remindAt !== null ? `提醒点 ${formatEpochMs(remindAt)}（展示用 · 无推送）` : '提前提醒（早于 1970 — 不展示）'}
            </span>
          )}
        </div>
      </div>
    </li>
  )
}
