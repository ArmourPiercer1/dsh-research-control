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
 * Read-only here: the page's state operations live on the workstream
 * page (PF panel / git panel / intervention board) — §26 drill-down is
 * read-only by definition.
 */

import type { ReactElement } from 'react'

import type { ResearchStore, SliceState, TopicSnapshot } from '../../stores/index.js'
import { TopologyGraphContainer } from '../../graph/TopologyGraphContainer.js'
import { useTopicSlice } from './binding-hooks.js'
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
  PLANNED: '规划中',
  REALIZED: '已实现',
  DROPPED: '已放弃',
}

/** Objective status → Chinese product copy (G4 R5: the statement rows). */
const OBJECTIVE_STATUS_LABEL: Record<TopicSnapshot['objectives'][number]['status'], string> = {
  ACTIVE: '进行中',
  ACHIEVED: '已达成',
  DROPPED: '已放弃',
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
      <section className={styles.page} aria-label="主题页">
        <h1 className={styles.pageTitle}>
          <button type="button" className={styles.backButton} onClick={onBack}>
            ← 返回总览
          </button>{' '}
          {topicId}（加载中…）
        </h1>
      </section>
    )
  }

  const t = slice.data.topic

  return (
    <section className={styles.page} aria-label="主题页">
      <h1 className={styles.pageTitle}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          ← 返回总览
        </button>{' '}
        {t.id} · {t.title}
      </h1>
      {t.objectiveRefs.length > 0 && (
        <p className={styles.pageMeta}>目标：{t.objectiveRefs.join('、')}</p>
      )}

      {/* §27.3 Topic Brief (G4 R5: the description, when the snapshot carries one) */}
      {t.description !== null && (
        <>
          <h2 className={styles.sectionTitle}>主题简介</h2>
          <p className={styles.topicBrief}>{t.description}</p>
        </>
      )}

      <h2 className={styles.sectionTitle}>Workstream 拓扑</h2>
      <div className={styles.topologyBox} data-topic-id={topicId}>
        <TopologyGraphContainer store={store} topicId={topicId} />
      </div>

      <h2 className={styles.sectionTitle}>Workstreams（{slice.data.workstreams.length}）</h2>
      {slice.data.workstreams.length === 0 ? (
        <p className={styles.empty}>该主题下无 Workstream</p>
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
                计划 {ws.planItemCount} 项
                {ws.openPlanForkCount > 0 && (
                  <span> · 未决 PlanFork {ws.openPlanForkCount}</span>
                )}
                {ws.runningRunCount > 0 && <span> · 运行中 {ws.runningRunCount}</span>}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* §27.3 Topic-level Objective (G4 R5: the STATEMENTS from the
          snapshot's `objectives`, not just the header ref ids) */}
      <h2 className={styles.sectionTitle}>主题目标</h2>
      {slice.data.objectives.length === 0 ? (
        <p className={styles.empty}>
          {t.objectiveRefs.length === 0
            ? '该主题暂无目标'
            : `引用 ${t.objectiveRefs.join('、')}（本快照未携带该 scope=TOPIC 的语句）`}
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
                {o.targetDate !== null && <span>目标日期：{formatEpochDate(o.targetDate)}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
