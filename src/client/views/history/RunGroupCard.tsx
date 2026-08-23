/**
 * History view — one per-Run wrapper group card (WP-4.4, presentational
 * layer).
 *
 * PURE PROPS: receives exactly one `HistoryRunGroup` (the display
 * projection from run-group.ts) plus the active replay order, and renders
 * the group's member events through the same atomic `EventRow` the
 * timeline uses — 「wrapper 按 Run 聚合阅读，但底层 event 不变」
 * (catalog §3.7): the card is a reading fold, not a new event source.
 *
 * Header: run id + wrapper-derived lifecycle status (RUNNING/FINISHED/
 * FAILED/CANCELLED → 运行中/已完成/已失败/已取消) + member count. The
 * same batch event (`RUNS_STARTED`) is projected into every member run's
 * group, so a group's rows are the run's run-lifecycle references in the
 * active order — exactly what 「按 Run 折叠」 promises.
 */

import type { ReactElement } from 'react'
import { EventRow } from './EventRow.js'
import type { HistoryOrder } from './ordered-events.js'
import type { HistoryRunGroup, RunGroupStatus } from './run-group.js'
import styles from './styles.module.css'

/** Wrapper status → product Chinese label. */
export const RUN_STATUS_LABEL: Readonly<Record<RunGroupStatus, string>> = {
  RUNNING: '运行中',
  FINISHED: '已完成',
  FAILED: '已失败',
  CANCELLED: '已取消',
}

/** Wrapper status → CSS module class (neutral chip, colored text). */
const RUN_STATUS_CLASS: Readonly<Record<RunGroupStatus, string>> = {
  RUNNING: styles.statusRunning,
  FINISHED: styles.statusFinished,
  FAILED: styles.statusFailed,
  CANCELLED: styles.statusCancelled,
}

/** One per-Run group card: `group` (projection) + active order. */
export interface RunGroupCardProps {
  readonly group: HistoryRunGroup
  /** The active replay order — forwarded to the member rows. */
  readonly order: HistoryOrder
}

/**
 * Render one per-Run wrapper group (header: run id + status + count;
 * body: the member atomic events in input order).
 * @param props - card props (pure).
 * @returns the group card element.
 */
export function RunGroupCard({ group, order }: RunGroupCardProps): ReactElement {
  return (
    <section className={styles.runGroup} data-run-id={group.runId} data-run-status={group.status}>
      <header className={styles.runGroupHeader}>
        <span className={styles.runId}>{group.runId}</span>
        <span className={RUN_STATUS_CLASS[group.status]}>{RUN_STATUS_LABEL[group.status]}</span>
        <span className={styles.count}>{group.events.length} 条事件</span>
      </header>
      <ul className={styles.timeline}>
        {group.events.map((event, index) => (
          <EventRow key={`${event.eventId}-${index}`} event={event} order={order} />
        ))}
      </ul>
    </section>
  )
}
