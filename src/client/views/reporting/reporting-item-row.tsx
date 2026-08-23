/**
 * ReportingItem row — pure props presentation (WP-5.3). The checklist
 * row of the 清单 view: status badge + 面向/内容 + occasion 关联 + 合法
 * 迁移按钮（按钮集 = 容器经 host §13 表算出的合法边 — 本组件不判
 * 状态机, 只渲染传入的按钮列表）。
 */

import type { ReactElement } from 'react'
import type { LocalReportingItem } from '../../stores/reporting-slices.js'
import type { RptStatus } from '../../../host/service/reporting/types.js'
import { RPT_STATUS_LABELS, RPT_TRANSITION_LABELS, formatEpochMs } from './reporting-format.js'
import styles from './reporting.module.css'

export interface ReportingItemRowProps {
  readonly item: LocalReportingItem
  /** The legal next statuses for this item's current status (§13). */
  readonly transitions: readonly RptStatus[]
  /** Transition click (the container routes to the workspace guard). */
  readonly onTransition: (localId: string, to: RptStatus) => void
}

/** One 汇报项 of the 清单. */
export function ReportingItemRow(props: ReportingItemRowProps): ReactElement {
  const item = props.item
  return (
    <li className={styles.row} data-status={item.status}>
      <div className={styles.rowHead}>
        <span className={styles.rowId}>{item.localId}</span>
        <span className={styles.kindBadge} data-status={item.status}>
          {RPT_STATUS_LABELS[item.status]}
        </span>
        <span className={styles.rowTitle}>{item.statement}</span>
        <span className={styles.rowTime}>{formatEpochMs(item.createdAt)}</span>
      </div>
      <div className={styles.chipRow}>
        <span className={styles.chip} data-audience={item.audience}>
          面向 {item.audience}
        </span>
        {item.occasionRef !== null && (
          <span className={styles.chipWs} data-occasion={item.occasionRef}>
            日程 {item.occasionRef}
          </span>
        )}
        {item.reportedAt !== null && (
          <span className={styles.chip} data-reported-at={item.reportedAt}>
            汇报于 {formatEpochMs(item.reportedAt)}
          </span>
        )}
      </div>
      {props.transitions.length > 0 && (
        <div className={styles.actions}>
          {props.transitions.map((to) => (
            <button
              key={to}
              type="button"
              className={styles.actionButton}
              onClick={() => props.onTransition(item.localId, to)}
            >
              {RPT_TRANSITION_LABELS[to]}
            </button>
          ))}
        </div>
      )}
    </li>
  )
}
