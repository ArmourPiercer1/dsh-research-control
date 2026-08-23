/**
 * History zone (WP-4.3, §27.4 left column) — the WS-level event summary
 * ENTRY.
 *
 * PURE display component: data via props only (no ctx, no hooks, no DSH).
 *
 * Scope boundary: this zone is the ENTRY to the workstream's event log —
 * the log SIZE from `getWorkstream` (`history.eventCount`) plus one
 * user action (`onOpenHistory`). The atomic timeline itself, its paging
 * windows (`queryHistory`) and the Run-aggregated wrapper view are
 * WP-4.4's (`views/history`) — the underlying event log is not touched
 * here (INV-HIST-1: one linear append-only log per workstream).
 */

import type { ReactElement } from 'react'
import styles from './workstream.module.css'

export interface HistoryZoneProps {
  /** The DTO's `history.eventCount` (the log size of this workstream). */
  readonly eventCount: number
  /** Opens the event timeline (WP-4.4 view / the page wiring decides). */
  readonly onOpenHistory: () => void
}

/**
 * Render the History zone.
 * @param props - zone data (see `HistoryZoneProps`).
 * @returns the zone panel element.
 */
export function HistoryZone({ eventCount, onOpenHistory }: HistoryZoneProps): ReactElement {
  return (
    <section className={styles.zone} aria-label="历史">
      <h2 className={styles.zoneTitle}>历史</h2>
      {eventCount === 0 ? (
        <p className={styles.empty}>暂无历史事件</p>
      ) : (
        <>
          <p className={styles.historyCount}>历史事件：{eventCount} 条</p>
          <button type="button" className={styles.historyEntry} onClick={onOpenHistory}>
            查看事件时间线
          </button>
        </>
      )}
    </section>
  )
}
