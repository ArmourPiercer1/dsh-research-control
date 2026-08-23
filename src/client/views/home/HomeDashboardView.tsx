/**
 * Home dashboard presentation root (WP-4.2, §27.1 Home/Portfolio
 * Dashboard) — PURE PROPS: zero store imports, zero DSH imports, zero
 * ctx. The container (HomeDashboard.tsx) maps the research store's
 * `dashboard` slice onto this component's props; this file only composes
 * the pure section components and the loading/error rendering.
 *
 * §27.1 information architecture (the frozen `DashboardSnapshot` fields
 * ARE the design):
 *  - project card + topic overview (项目/主题概览);
 *  - OPEN / PENDING intervention groups — ALWAYS complete (INV-ATTN-1);
 *  - PHASE 5/6 placeholder sections for the frozen-null fields
 *    (scheduledEvents / reportingItems / inboxCount / attention) — shown
 *    with an explicit 「待 Phase N」 marker, never hidden;
 *  - entry navigation: topic cards → topic view; intervention workstream
 *    chips → workstream view; per-intervention 「历史」 → History timeline.
 *
 * Boundary (task brief): NO unified Notification Inbox — each §27.1 list
 * keeps its own section; the Research Inbox count is ONE placeholder
 * section, not a merged inbox that would swallow these lists.
 */
import type { ReactElement } from 'react'

import type { DashboardSnapshot } from '../../../shared/rpc-contracts.js'

import { InterventionSection } from './InterventionSection'
import { PhasePlaceholder } from './PhasePlaceholder'
import { ProjectCard } from './ProjectCard'
import { TopicList } from './TopicList'
import styles from './home.module.css'

/**
 * The slice status as the view consumes it (the container maps the store's
 * `SliceState.status` onto this local face — the view never imports the
 * store model types).
 */
export type HomeViewStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface HomeDashboardViewProps {
  /** The dashboard payload (null before the first successful load). */
  readonly data: DashboardSnapshot | null
  readonly status: HomeViewStatus
  /** Last failure message (status 'error'). */
  readonly error: string | null
  /** The page-level refresh (store refresh cycle — ARCHITECTURE §8 item 4). */
  readonly onRefresh: () => void
  /** Re-issue the dashboard load (first-load failure path). */
  readonly onRetry: () => void
  /** Drill-down: project view (§27.2; the project card's entry, WP-4.7). */
  readonly onOpenProject?: () => void
  /** Drill-down: topic view. */
  readonly onOpenTopic: (topicId: string) => void
  /** Drill-down: workstream view. */
  readonly onOpenWorkstream: (workstreamId: string) => void
  /** Drill-down: History timeline (per workstream). */
  readonly onOpenHistory: (workstreamId: string) => void
}

/**
 * Render the Home/Portfolio Dashboard from a plain snapshot + status face.
 * @param props - data, status, error, refresh/retry + navigation callbacks.
 * @returns the view element.
 */
export function HomeDashboardView({
  data,
  status,
  error,
  onRefresh,
  onRetry,
  onOpenProject,
  onOpenTopic,
  onOpenWorkstream,
  onOpenHistory,
}: HomeDashboardViewProps): ReactElement {
  return (
    <div className={styles.home}>
      <header className={styles.header}>
        <h1 className={styles.title}>研究总览</h1>
        <button type="button" className={styles.refresh} onClick={onRefresh}>
          刷新
        </button>
      </header>

      {data === null ? (
        status === 'error' ? (
          <div className={styles.failed}>
            <p className={styles.errorText} role="alert">
              加载失败：{error ?? '未知错误'}
            </p>
            <button type="button" className={styles.retry} onClick={onRetry}>
              重试
            </button>
          </div>
        ) : (
          // 'idle' | 'loading' — nothing cached yet.
          <p className={styles.loading} role="status">
            加载中…
          </p>
        )
      ) : (
        <>
          {/* stale-while-revalidate: after a failed refetch the last good
              data stays visible with an error banner (store model §WP-4.1b) */}
          {status === 'error' && (
            <p className={styles.errorBanner} role="alert">
              刷新失败：{error ?? '未知错误'}
            </p>
          )}
          {status === 'loading' && (
            <p className={styles.refreshing} role="status">
              正在刷新…
            </p>
          )}
          <ProjectCard project={data.project} onOpen={onOpenProject} />
          <TopicList topics={data.topics} onOpenTopic={onOpenTopic} />
          <InterventionSection
            kind="OPEN"
            items={data.openInterventions}
            onOpenWorkstream={onOpenWorkstream}
            onOpenHistory={onOpenHistory}
          />
          <InterventionSection
            kind="PENDING"
            items={data.pendingInterventions}
            onOpenWorkstream={onOpenWorkstream}
            onOpenHistory={onOpenHistory}
          />
          {/* PHASE 5/6 placeholders — shown, never hidden (frozen null fields) */}
          <PhasePlaceholder title="计划事件" phase="Phase 5" />
          <PhasePlaceholder title="报告项" phase="Phase 5" />
          <PhasePlaceholder title="研究收件箱" phase="Phase 6" />
          <PhasePlaceholder title="注意力排序" phase="Phase 5" />
        </>
      )}
    </div>
  )
}
