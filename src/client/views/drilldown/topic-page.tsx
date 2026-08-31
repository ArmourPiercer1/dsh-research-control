/**
 * WP-4.6 — Topic page (container) — plan §27.3 / TC-E2E-001/002 drill path.
 *
 * The second stop of the drill-down chain (dashboard → topic → workstream):
 *  - the topic header (id / title / objective refs);
 *  - the Topic Brief (§27.3: the topic description — G4 R5 supplement,
 *    rendered when the snapshot carries one);
 *  - the Workstream TOPOLOGY graph (the WP-4.4 `TopologyGraphContainer` —
 *    the real canvas, edge set + merge-contract badges from the topic
 *    slice; the §27.3 「cross-workstream explicit dependencies」 face);
 *  - the Workstream summary cards (the topic slice's §27.3 cards — click
 *    = the drill into the workstream three-zone page);
 *  - the Topic-level Objective (§27.3: the OBJECTIVE STATEMENTS from the
 *    snapshot's `objectives` — G4 R5 supplement; the objectiveRefs id
 *    list stays as the header meta).
 *
 * Mostly read-only here: the workstream state operations (PF panel /
 * git panel / intervention board) live on the workstream page. The
 * exception is the topology zone above — UI-6 (B §10.4/§21/§22/§23,
 * ADJ-6) makes it the single Topic-page entry for the topology
 * mutations: workstream fork, planned merge, edge drop, and the
 * merge-contract editor.
 */

import type { ReactElement } from 'react'

import type { ResearchStore, SliceState, TopicSnapshot } from '../../stores/index.js'
import { TopologyGraphContainer } from '../../graph/TopologyGraphContainer.js'
import { useTopicSlice } from './binding-hooks.js'
import { t } from '../../i18n/copy.js'
import styles from './cockpit.module.css'

export interface TopicPageProps {
  readonly store: ResearchStore
  readonly topicId: string
  /** Drill into one workstream (the cockpit's page navigation). */
  readonly onOpenWorkstream: (workstreamId: string) => void
  /** Back to the home dashboard. */
  readonly onBack: () => void
}

const LIFECYCLE_LABEL: Record<TopicSnapshot['workstreams'][number]['lifecycle'], string> = {
  PLANNED: t('status.planned'),
  REALIZED: t('status.implemented'),
  DROPPED: t('status.abandoned'),
}

/** Objective status → Chinese product copy (G4 R5: the statement rows). */
const OBJECTIVE_STATUS_LABEL: Record<TopicSnapshot['objectives'][number]['status'], string> = {
  ACTIVE: t('status.inProgress'),
  ACHIEVED: t('status.achieved'),
  DROPPED: t('status.abandoned'),
}

/** Format an epoch-ms date as `YYYY-MM-DD` (local time, TZ-stable shape). */
function formatEpochDate(ms: number): string {
  const d = new Date(ms)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/**
 * Render the topic page.
 * @param props - store, topic id, navigation callbacks.
 * @returns the topic page element.
 */
export function TopicPage({ store, topicId, onOpenWorkstream, onBack }: TopicPageProps): ReactElement {
  const slice: SliceState<TopicSnapshot> = useTopicSlice(store, topicId)

  if (slice.data === null) {
    return (
      <section className={styles.page} aria-label={t('topic.pageAria')}>
        <h1 className={styles.pageTitle}>
          <button type="button" className={styles.backButton} onClick={onBack}>
            {t('common.backToHub')}
          </button>{' '}
          {t('topic.loadingId', { id: topicId })}
        </h1>
      </section>
    )
  }

  const topic = slice.data.topic

  return (
    <section className={styles.page} aria-label={t('topic.pageAria')}>
      <h1 className={styles.pageTitle}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          {t('common.backToHub')}
        </button>{' '}
        {topic.id} · {topic.title}
      </h1>
      {topic.objectiveRefs.length > 0 && (
        <p className={styles.pageMeta}>{t('topic.objectives', { refs: topic.objectiveRefs.join(t('topic.refSep')) })}</p>
      )}

      {/* §27.3 Topic Brief (G4 R5: the description, when the snapshot carries one) */}
      {topic.description !== null && (
        <>
          <h2 className={styles.sectionTitle}>{t('topic.intro')}</h2>
          <p className={styles.topicBrief}>{topic.description}</p>
        </>
      )}

      <h2 className={styles.sectionTitle}>{t('topic.topologyTitle')}</h2>
      <div className={styles.topologyBox} data-topic-id={topicId}>
        <TopologyGraphContainer store={store} topicId={topicId} />
      </div>

      <h2 className={styles.sectionTitle}>{t('topic.wsCount', { n: String(slice.data.workstreams.length) })}</h2>
      {slice.data.workstreams.length === 0 ? (
        <p className={styles.empty}>{t('topic.noWorkstreams')}</p>
      ) : (
        <div className={styles.wsCardGrid}>
          {slice.data.workstreams.map((ws) => (
            <button
              type="button"
              key={ws.id}
              className={styles.wsCard}
              data-ws-id={ws.id}
              data-ws-lifecycle={ws.lifecycle}
              onClick={() => onOpenWorkstream(ws.id)}
            >
              <span className={styles.wsCardHead}>
                <span className={styles.cardId}>{ws.id}</span>
                <span className={styles.statusBadge} data-ws-lifecycle={ws.lifecycle}>
                  {LIFECYCLE_LABEL[ws.lifecycle]}
                </span>
              </span>
              <p className={styles.wsCardTitle}>{ws.title}</p>
              <p className={styles.wsCardMeta}>
                {t('ws.topo.planCount', { n: String(ws.planItemCount) })}
                {ws.openPlanForkCount > 0 && (
                  <span> {t('topic.wsOpenPf', { n: String(ws.openPlanForkCount) })}</span>
                )}
                {ws.runningRunCount > 0 && <span> {t('topic.wsRunning', { n: String(ws.runningRunCount) })}</span>}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* §27.3 Topic-level Objective (G4 R5: the STATEMENTS from the
          snapshot's `objectives`, not just the header ref ids) */}
      <h2 className={styles.sectionTitle}>{t('topic.objectivesTitle')}</h2>
      {slice.data.objectives.length === 0 ? (
        <p className={styles.empty}>
          {topic.objectiveRefs.length === 0
            ? t('topic.noObjectives')
            : t('topic.objectiveRefsMissing', { refs: topic.objectiveRefs.join(t('topic.refSep')) })}
        </p>
      ) : (
        <ul className={styles.objList}>
          {slice.data.objectives.map((o) => (
            <li
              key={o.id}
              className={styles.objRow}
              data-objective-id={o.id}
              data-objective-status={o.status}
            >
              <p className={styles.objStatement}>{o.statement}</p>
              <p className={styles.objMeta}>
                <span className={styles.cardId}>{o.id}</span>
                <span className={styles.statusBadge} data-objective-status={o.status}>
                  {OBJECTIVE_STATUS_LABEL[o.status]}
                </span>
                <span>{o.priority}</span>
                {o.targetDate !== null && <span>{t('topic.targetDate', { date: formatEpochDate(o.targetDate) })}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
