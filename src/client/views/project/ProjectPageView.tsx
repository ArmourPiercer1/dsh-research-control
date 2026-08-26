/**
 * §27.2 Project Page — PURE-PROPS presentation (WP-4.7, G4 S1).
 *
 * Two-layer rule (WP-4.2 precedent, DSH_ADAPTER §6): the container
 * (`ProjectPage.tsx`) is the ONE store-touching file of the project view;
 * this component is pure props — it imports neither the store layer nor
 * the DSH adapter, only the frozen shared contracts + its CSS module.
 *
 * §27.2 information architecture (the frozen `ProjectSnapshot` fields ARE
 * the design):
 *  - Project Brief (description);
 *  - Topic list (→ topic view);
 *  - Objective (the objectives list, with the `currentObjectiveRefs`
 *    highlighted as the project's current objectives);
 *  - importance / attention mode;
 *  - upcoming interactions / reporting (PHASE 5 placeholders — frozen null,
 *    shown with an explicit 「待 Phase 5」 marker, never hidden).
 *
 * Null semantics (mirrors ProjectCard): `description` / `targetDate` are
 * ordinary data nulls — rendered only when present, so a null never shows
 * up as an empty label. The `upcomingInteractions` / `upcomingReporting`
 * nulls are PHASE placeholders (the DTO comment forbids a fabricated empty
 * list masquerading as data) — reserved with a visible phase marker.
 */
import type { ReactElement } from 'react'

import type { ProjectSnapshot } from '../../../shared/rpc-contracts.js'

import styles from './project.module.css'

/**
 * The slice status as the view consumes it (the container maps the store's
 * `SliceState.status` onto this local face — the view never imports the
 * store model types).
 */
export type ProjectViewStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ProjectPageViewProps {
  /** The project payload (null before the first successful load). */
  readonly data: ProjectSnapshot | null
  readonly status: ProjectViewStatus
  /** Last failure message (status 'error'). */
  readonly error: string | null
  /** Re-issue the project load (first-load failure path). */
  readonly onRetry: () => void
  /**
   * Back to the previous level (the cockpit's page navigation — 返回总览).
   * V2-T5.1: OPTIONAL — the project-narrowed 总览 (design §7.1 项目视图:
   * 现有项目页作根、无聚合条) renders the project page AS ROOT, so there is
   * no back affordance; the HUB-drill variant passes the back-to-wall
   * callback (钻取链 root). Omitted → the back button is NOT rendered.
   */
  readonly onBack?: () => void
  /** Drill-down: open one topic (the topic view). */
  readonly onOpenTopic: (topicId: string) => void
}

/** Attention mode → Chinese product copy (DSH_ADAPTER §6: 产品文案中文). */
const ATTENTION_MODE_LABEL: Record<ProjectSnapshot['project']['attentionMode'], string> = {
  FOCUS: '聚焦',
  NORMAL: '常规',
  BACKGROUND: '后台',
}

/** Objective status → Chinese product copy. */
const OBJECTIVE_STATUS_LABEL: Record<ProjectSnapshot['objectives'][number]['status'], string> = {
  ACTIVE: '进行中',
  ACHIEVED: '已达成',
  DROPPED: '已放弃',
}

/** Format an epoch-ms date as `YYYY-MM-DD` (local time, TZ-stable shape). */
export function formatEpochDate(ms: number): string {
  const d = new Date(ms)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/**
 * Render the §27.2 Project Page from a plain snapshot + status face.
 * @param props - data, status, error, retry/back/navigation callbacks.
 * @returns the view element.
 */
export function ProjectPageView({
  data,
  status,
  error,
  onRetry,
  onBack,
  onOpenTopic,
}: ProjectPageViewProps): ReactElement {
  // V2-T5.1: the back affordance is OPTIONAL (the project-narrowed 总览
  // renders the project page as ROOT — no previous level; the HUB-drill
  // variant passes the back-to-wall callback).
  const back =
    onBack === undefined ? null : (
      <button type="button" className={styles.backButton} onClick={onBack}>
        ← 返回总览
      </button>
    )

  if (data === null) {
    return (
      <section className={styles.page} aria-label="项目页">
        <h1 className={styles.pageTitle}>
          {back} 项目（{status === 'error' ? '加载失败' : '加载中…'}）
        </h1>
        {status === 'error' ? (
          <div className={styles.failed}>
            <p className={styles.errorText} role="alert">
              加载失败：{error ?? '未知错误'}
            </p>
            <button type="button" className={styles.backButton} onClick={onRetry}>
              重试
            </button>
          </div>
        ) : (
          <p className={styles.loading} role="status">
            加载中…
          </p>
        )}
      </section>
    )
  }

  const p = data.project
  const currentRefs = new Set(p.currentObjectiveRefs)

  return (
    <section className={styles.page} aria-label="项目页">
      <h1 className={styles.pageTitle}>
        {back} {p.id} · {p.title}
      </h1>

      {status === 'error' && (
        <p className={styles.errorBanner} role="alert">
          刷新失败：{error ?? '未知错误'}
        </p>
      )}

      {/* §27.2 Project Brief */}
      {p.description !== null && (
        <>
          <h2 className={styles.sectionTitle}>项目简介</h2>
          <p className={styles.brief}>{p.description}</p>
        </>
      )}

      {/* §27.2 importance / attention mode (+ id / target date meta) */}
      <ul className={styles.metaList}>
        <li className={styles.metaItem}>编号：{p.id}</li>
        <li className={styles.metaItem}>重要度：{p.importance}</li>
        <li className={styles.metaItem}>注意力：{ATTENTION_MODE_LABEL[p.attentionMode]}</li>
        {p.targetDate !== null && (
          <li className={styles.metaItem}>目标日期：{formatEpochDate(p.targetDate)}</li>
        )}
        <li className={styles.metaItem}>创建：{formatEpochDate(p.createdAt)}</li>
      </ul>

      {/* §27.2 Objective — the objectives list (current ones highlighted) */}
      <h2 className={styles.sectionTitle}>
        目标（{data.objectives.length}）
      </h2>
      {data.objectives.length === 0 ? (
        <p className={styles.empty}>暂无目标</p>
      ) : (
        <ul className={styles.objList}>
          {data.objectives.map((o) => {
            const current = currentRefs.has(o.id)
            return (
              <li
                key={o.id}
                className={styles.objRow}
                data-objective-id={o.id}
                data-objective-status={o.status}
                data-current={current ? 'true' : 'false'}
              >
                <p className={styles.objStatement}>{o.statement}</p>
                <p className={styles.objMeta}>
                  <span className={styles.cardId}>{o.id}</span>
                  <span
                    className={styles.statusBadge}
                    data-objective-status={o.status}
                  >
                    {OBJECTIVE_STATUS_LABEL[o.status]}
                  </span>
                  <span>{o.priority}</span>
                  {current && <span className={styles.currentTag}>当前目标</span>}
                  {o.targetDate !== null && (
                    <span>目标日期：{formatEpochDate(o.targetDate)}</span>
                  )}
                </p>
              </li>
            )
          })}
        </ul>
      )}

      {/* §27.2 Topic list (→ topic view) */}
      <h2 className={styles.sectionTitle}>
        主题（{data.topics.length}）
      </h2>
      {data.topics.length === 0 ? (
        <p className={styles.empty}>暂无主题</p>
      ) : (
        <ul className={styles.topicList}>
          {data.topics.map((topic) => (
            <li key={topic.id} className={styles.topicCard}>
              <button
                type="button"
                className={styles.topicButton}
                onClick={() => onOpenTopic(topic.id)}
              >
                <span className={styles.topicTitle}>{topic.title}</span>
                <span className={styles.topicCount}>{topic.workstreamCount} 个工作流</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* §27.2 upcoming interactions/reporting — PHASE 5 placeholders
          (shown, never hidden — the frozen-null fields) */}
      <section className={styles.phase}>
        <h3 className={styles.sectionTitle}>即将到来的交互</h3>
        <p className={styles.phaseText}>待 Phase 5</p>
      </section>
      <section className={styles.phase}>
        <h3 className={styles.sectionTitle}>即将到来的报告</h3>
        <p className={styles.phaseText}>待 Phase 5</p>
      </section>
    </section>
  )
}
