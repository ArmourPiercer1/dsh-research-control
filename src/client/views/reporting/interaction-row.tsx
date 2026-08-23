/**
 * Interaction record row — pure props presentation (WP-5.3). The
 * container (InteractionStreamView) owns the store binding; this row
 * never sees ctx or a store (Phase 4 组件纪律).
 */

import type { ReactElement } from 'react'
import type { RegisteredInteractionEntry } from '../../stores/reporting-slices.js'
import { INTERACTION_KIND_LABELS, formatEpochMs } from './reporting-format.js'
import styles from './reporting.module.css'

export interface InteractionRowProps {
  readonly entry: RegisteredInteractionEntry
}

/** One Interaction of the 记录流 (kind 徽标 + 标题 + 时间 + 参与人/
 *  关联 WS chips + 摘要). */
export function InteractionRow(props: InteractionRowProps): ReactElement {
  const entry = props.entry
  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.rowId}>{entry.id}</span>
        <span className={styles.kindBadge} data-kind={entry.kind}>
          {INTERACTION_KIND_LABELS[entry.kind] ?? entry.kind}
        </span>
        <span className={styles.rowTitle}>{entry.title}</span>
        <span className={styles.rowTime}>{formatEpochMs(entry.occurredAt)}</span>
      </div>
      {(entry.participants.length > 0 || entry.relatedWorkstreams.length > 0) && (
        <div className={styles.chipRow}>
          {entry.participants.map((name) => (
            <span key={`p-${name}`} className={styles.chip} data-participant={name}>
              {name}
            </span>
          ))}
          {entry.relatedWorkstreams.map((ws) => (
            <span key={`ws-${ws}`} className={styles.chipWs} data-workstream={ws}>
              {ws}
            </span>
          ))}
        </div>
      )}
      {entry.notes !== null && entry.notes.length > 0 && (
        <p className={styles.notes}>{entry.notes}</p>
      )}
    </li>
  )
}
