/**
 * History view — one atomic event row (WP-4.4, presentational layer).
 *
 * PURE PROPS (DSH_ADAPTER §6 / host client AGENTS spirit): no hooks, no
 * store access, no DSH imports — the row receives exactly one
 * `HistoryEventDto` (a reference from the store's cached window) plus the
 * active replay order. What it renders:
 *
 *  - the EVENT TYPE badge: Chinese label + catalog category (event-meta),
 *    the raw frozen `eventType` in the tooltip;
 *  - the ACTOR badge: the U/A/P letter (catalog §4 E column; SYSTEM→S)
 *    with a human-readable actor line in the tooltip;
 *  - the DUAL-ORDER primary time: semantic mode highlights `occurredAt`
 *    (「重建科研时间线」), audit mode highlights `recordedAt`
 *    (「系统何时获知」) — the other timestamp stays visible, small;
 *  - `#eventSeq · eventId` (the workstream-local seq + the project-global
 *    id, catalog §1 envelope);
 *  - the payload, collapsed by default (native `<details>` — zero
 *    component state), verbatim JSON.
 *
 * The row never derives, groups, or mutates anything: aggregation lives
 * in the wrapper projection (run-group.ts), ordering in the container
 * (ordered-events.ts) — catalog §3.7.
 */

import type { ReactElement } from 'react'
import type { HistoryEventDto, SemanticEndpointRef } from '../../../shared/rpc-contracts.js'
import { t } from '../../i18n/copy.js'
import { actorLabel, actorLetter, eventTypeMeta, formatEpochMs } from './event-meta.js'
import type { HistoryOrder } from './ordered-events.js'
import styles from './styles.module.css'

/** One atomic event row: `event` (store reference) + active order. */
export interface EventRowProps {
  readonly event: HistoryEventDto
  /** The active replay order — selects the highlighted timestamp. */
  readonly order: HistoryOrder
  /** UI-7 (B §26): the related-object ref this event's context points at
   *  (e.g. the payload's plan item) — enables the Related Records entry. */
  readonly relatedRef?: SemanticEndpointRef | null
  /** UI-7 (B §26): the related-record count for the entry (the caller
   *  resolves it via queryRecords' `relatedObject` dimension). */
  readonly relatedCount?: number | null
  /** UI-7 (B §26): opens the Records face carrying the related filter
   *  (the deep link IS the view state). */
  readonly onShowRelated?: () => void
}

/**
 * Render one atomic history event (type badge, actor U/A/P badge, dual
 * timestamps, seq/id, collapsed payload).
 * @param props - row props (pure).
 * @returns the timeline row element.
 */
export function EventRow({ event, order, relatedRef, relatedCount, onShowRelated }: EventRowProps): ReactElement {
  const meta = eventTypeMeta(event.eventType)
  const letter = actorLetter(event.actor.kind)
  const label = actorLabel(event.actor)
  const occurred = formatEpochMs(event.occurredAt)
  const recorded = formatEpochMs(event.recordedAt)
  const semanticPrimary = order === 'semantic'
  const showRelated =
    relatedRef !== undefined &&
    relatedRef !== null &&
    relatedCount !== undefined &&
    relatedCount !== null &&
    relatedCount > 0

  return (
    <li className={styles.event} data-event-type={event.eventType} data-actor-kind={event.actor.kind}>
      <span className={styles.badge} title={t('history.eventBadgeTitle', { type: event.eventType, category: meta.category })}>
        {meta.label}
      </span>
      <span className={styles.actor} title={label}>
        {letter}
      </span>
      <time
        className={styles.time}
        dateTime={new Date(semanticPrimary ? event.occurredAt : event.recordedAt).toISOString()}
      >
        {semanticPrimary ? t('history.occurredAt', { time: occurred }) : t('history.recordedAt', { time: recorded })}
        <span className={styles.timeSub}> · {semanticPrimary ? t('history.recordedAt', { time: recorded }) : t('history.occurredAt', { time: occurred })}</span>
      </time>
      <span className={styles.seq}>
        #{event.eventSeq} · {event.eventId}
      </span>
      {showRelated && relatedRef !== null && (
        <button
          type="button"
          className={styles.relatedButton}
          data-event-related
          data-related-ref={`${relatedRef.kind}:${relatedRef.id}`}
          onClick={onShowRelated}
        >
          {t('ws.records.related.count').replace('n', String(relatedCount))}
        </button>
      )}
      <details className={styles.payload}>
        <summary>{t('history.payload')}</summary>
        <pre>{JSON.stringify(event.payload, null, 2)}</pre>
      </details>
    </li>
  )
}
