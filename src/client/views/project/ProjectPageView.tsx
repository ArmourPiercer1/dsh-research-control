/**
 * §27.2 Project Page — PURE-PROPS presentation (WP-4.7, G4 S1).
 *
 * Two-layer rule (WP-4.2 precedent, DSH_ADAPTER §6): the container
 * (`ProjectPage.tsx`) is the ONE store-touching file of the project view;
 * this component is pure props — it imports neither the store layer nor
 * the DSH adapter, only the frozen shared contracts + its CSS module.
 *
 * V2-UI-0.4 UI-3 (B §7.2 / §9.1): the old one-card-per-topic list is
 * restructured into EXPANDABLE Topic sections — each section header keeps
 * the topic title + workstream count and gains the frozen `[Edit]`
 * `[+ Workstream]` actions (B §9.1); expansion is LAZY (the container
 * issues `loadTopic` on first expand — plan §24 perf discipline), and the
 * expanded body shows the topic description / objective summary / WS
 * cards / the Topology `View topology` shortcut (judgment #10: opens the
 * existing topic page — topology preview/open only in this slice). The
 * page gains the two B §7.2 bottom sections: Project Attention (UI-8:
 * the top-6 non-terminal items of the single-project `queryAttention`
 * projection — the UI-3 placeholder retired, real data) and Recent
 * History
 * (judgment #9: lazy on first expand, per-WS latest-3, merged
 * occurredAt-desc, the `showing first 20 workstreams` note when >20).
 *
 * §27.2 information architecture (the frozen `ProjectSnapshot` fields ARE
 * the design):
 *  - Project Brief (description);
 *  - Objective (the objectives list, with the `currentObjectiveRefs`
 *    highlighted as the project's current objectives);
 *  - Topics / Workstreams (the Topic sections, above);
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
import { useId, useState, type ReactElement } from 'react'

import type {
  AttentionItemDto,
  HistoryEventDto,
  ProjectSnapshot,
  TopicCardDto,
  TopicSnapshot,
} from '../../../shared/rpc-contracts.js'
import { t } from '../../i18n/copy.js'
import { KIND_LABEL, attentionGroupOf } from '../shell/intervention-stream.js'

import styles from './project.module.css'

/**
 * The slice status as the view consumes it (the container maps the store's
 * `SliceState.status` onto this local face — the view never imports the
 * store model types).
 */
export type ProjectViewStatus = 'idle' | 'loading' | 'ready' | 'error'

/** One Topic section's lazy data face (the container maps the topics
 *  slice onto it — plain structural types only). */
export interface TopicSectionFace {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly data: TopicSnapshot | null
  readonly error: string | null
}

/** One Recent History row (a history event + its owning-workstream label). */
export interface RecentHistoryEntry {
  readonly event: HistoryEventDto
  readonly workstreamId: string
  readonly workstreamTitle: string
  readonly topicId: string
}

/** The Recent History section face (`entries` null = not computed yet —
 *  the section is collapsed or its first expand is still loading the
 *  lazy per-WS windows). */
export interface RecentHistoryFace {
  readonly entries: RecentHistoryEntry[] | null
  readonly loading: boolean
  /** True when the project has >20 workstreams (the first-20 note). */
  readonly truncated: boolean
}

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
  /** Drill-down: open one topic (the topic view — the Topology shortcut
   *  and the pre-UI-3 card click both route here). */
  readonly onOpenTopic: (topicId: string) => void
  /** The per-topic section data (keyed by topicId; absent = never
   *  requested). The container maps the store's topics slices onto this. */
  readonly topicSections: ReadonlyMap<string, TopicSectionFace>
  /** First expand of a Topic section (the container issues the lazy
   *  `loadTopic`; collapse is view-local and fetches nothing). */
  readonly onExpandTopic: (topicId: string) => void
  /** Re-issue a failed Topic section load. */
  readonly onRetryTopic: (topicId: string) => void
  /** The Topic section `[Edit]` action (the container opens the dialog). */
  readonly onEditTopic: (topicId: string) => void
  /** The Topic section `[+ Workstream]` action (the container opens the
   *  dialog). */
  readonly onAddWorkstream: (topicId: string) => void
  /** The `+ Topic` action on the section heading (the container opens
   *  the dialog). */
  readonly onCreateTopic: () => void
  /** First expand of Recent History (the container starts the lazy
   *  per-WS window loads; collapse is view-local). */
  readonly onExpandRecentHistory: () => void
  readonly recentHistory: RecentHistoryFace
  /**
   * D §14 (UI-8) — the Project Attention block rows: the NON-TERMINAL
   * items of the single-project `queryAttention` projection (the
   * container's one-shot mount fetch, limit 6). `null` = not loaded yet
   * (the heading renders alone — no placeholder text); a fetch failure
   * surfaces as `attentionError` (the fault row).
   */
  readonly attentionItems?: readonly AttentionItemDto[] | null
  /** The attention fetch failure (the fault row, role=alert). */
  readonly attentionError?: string | null
  /** Workstream navigation (the carry-over #21 ws-card click + the
   *  attention rows): BOTH ids arrive from the view (the topic id is
   *  derived from the already-loaded topic faces — fail-soft: an
   *  unknown topic renders the row NOT clickable, never guessed). */
  readonly onOpenWorkstream?: (workstreamId: string, topicId: string) => void
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

/** Workstream lifecycle → Chinese product copy (the same mapping as the
 *  workstream views — existing strings, not new copy). */
const LIFECYCLE_LABEL: Record<
  TopicSnapshot['workstreams'][number]['lifecycle'],
  string
> = {
  PLANNED: '规划中',
  REALIZED: '已实现',
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
 * One Topic section (B §9.1): collapsed header (title + `[Edit]`
 * `[+ Workstream]` + WS count) with a lazy expanded body (description /
 * objective summary / WS cards / Topology shortcut). Pure — all data and
 * callbacks arrive as props.
 */
/** D §14 (UI-8) — workstream → owning topic id (derived from the
 *  already-loaded topic faces; `null` = not loaded yet → the row is
 *  rendered NOT clickable, never guessed — zero new wire). */
function findTopicIdOfWorkstream(
  topicSections: ReadonlyMap<string, TopicSectionFace>,
  workstreamId: string,
): string | null {
  for (const face of topicSections.values()) {
    if (
      face !== undefined &&
      face.data !== null &&
      face.data.workstreams.some((ws) => ws.id === workstreamId)
    ) {
      return face.data.topic.id
    }
  }
  return null
}

function TopicSection({
  card,
  face,
  open,
  onToggle,
  onRetry,
  onEdit,
  onAddWorkstream,
  onOpenTopic,
  onOpenWorkstream,
}: {
  readonly card: TopicCardDto
  readonly face: TopicSectionFace | undefined
  readonly open: boolean
  readonly onToggle: () => void
  readonly onRetry: () => void
  readonly onEdit: () => void
  readonly onAddWorkstream: () => void
  readonly onOpenTopic: () => void
  /** Carry-over #21 — the ws-card click (the console's page navigation). */
  readonly onOpenWorkstream?: (workstreamId: string) => void
}): ReactElement {
  const bodyId = useId()
  const failed = face !== undefined && face.data === null && face.status === 'error'

  return (
    <li className={styles.topicSection} data-topic-id={card.id} data-topic-open={open ? 'true' : 'false'}>
      <div className={styles.topicSectionHead}>
        <button
          type="button"
          className={styles.topicSectionToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          data-topic-toggle
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span className={styles.topicTitle}>{card.title}</span>
        </button>
        <span className={styles.topicCount}>{card.workstreamCount} 个工作流</span>
        <span className={styles.topicSectionActions}>
          <button type="button" className={styles.backButton} onClick={onEdit} data-topic-edit>
            {t('project.topicEdit')}
          </button>
          <button
            type="button"
            className={styles.backButton}
            onClick={onAddWorkstream}
            data-topic-add-workstream
          >
            {t('project.topicAddWorkstream')}
          </button>
        </span>
      </div>
      {open && (
        <div className={styles.topicSectionBody} id={bodyId} data-topic-body>
          {face === undefined || face.data === null ? (
            failed ? (
              <div className={styles.failed}>
                <p className={styles.errorText} role="alert">
                  加载失败：{face?.error ?? '未知错误'}
                </p>
                <button type="button" className={styles.backButton} onClick={onRetry} data-topic-retry>
                  重试
                </button>
              </div>
            ) : (
              <p className={styles.loading} role="status">
                加载中…
              </p>
            )
          ) : (
            <>
              {face.data.topic.description !== null && (
                <p className={styles.brief} data-topic-description>
                  {face.data.topic.description}
                </p>
              )}
              {face.data.objectives.length > 0 && (
                <ul className={styles.topicObjList} data-topic-objectives>
                  {face.data.objectives.map((o) => (
                    <li key={o.id} className={styles.topicObjRow}>
                      <span className={styles.objStatement}>{o.statement}</span>
                      <span className={styles.statusBadge} data-objective-status={o.status}>
                        {OBJECTIVE_STATUS_LABEL[o.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <h3 className={styles.sectionTitle}>{t('project.topicWorkstreams')}</h3>
              {face.data.workstreams.length === 0 ? (
                <p className={styles.empty}>{t('project.noWorkstreams')}</p>
              ) : (
                <ul className={styles.wsCardList}>
                  {face.data.workstreams.map((ws) => (
                    <li
                      key={ws.id}
                      className={styles.wsCard}
                      data-ws-card
                      data-ws-id={ws.id}
                      onClick={onOpenWorkstream !== undefined ? () => onOpenWorkstream(ws.id) : undefined}
                    >
                      <div className={styles.wsCardHead}>
                        <span className={styles.topicTitle}>{ws.title}</span>
                        <span
                          className={styles.statusBadge}
                          data-ws-lifecycle={ws.lifecycle}
                        >
                          {LIFECYCLE_LABEL[ws.lifecycle]}
                        </span>
                      </div>
                      {ws.summary !== null && <p className={styles.wsSummary}>{ws.summary}</p>}
                      <p className={styles.wsMeta}>
                        {ws.planItemCount} {t('ws.metaPlanItems')} · {ws.openPlanForkCount}{' '}
                        {t('ws.metaOpenForks')} · {ws.runningRunCount} {t('ws.metaRunning')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <div className={styles.topicTopologyRow} data-topic-topology-row>
                <span>{t('project.topicTopology')}:</span>{' '}
                <button type="button" className={styles.backButton} onClick={onOpenTopic} data-topic-topology>
                  {t('project.viewTopology')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * Render the §27.2 Project Page from a plain snapshot + status face.
 * @param props - data, status, error, retry/back/navigation callbacks +
 *   the Topic-section / Recent History faces (UI-3).
 * @returns the view element.
 */
export function ProjectPageView(props: ProjectPageViewProps): ReactElement {
  const {
    data,
    status,
    error,
    onRetry,
    onBack,
    onOpenTopic,
    topicSections,
    onExpandTopic,
    onRetryTopic,
    onEditTopic,
    onAddWorkstream,
    onCreateTopic,
    onExpandRecentHistory,
    recentHistory,
    attentionItems,
    attentionError,
    onOpenWorkstream,
  } = props
  // View-local UI state: which Topic sections are open + whether the
  // Recent History section is open. Both are pure presentation — the
  // fetches they trigger ride the container callbacks.
  const [openTopics, setOpenTopics] = useState<ReadonlySet<string>>(new Set())
  const [historyOpen, setHistoryOpen] = useState(false)

  function toggleTopic(topicId: string): void {
    const opening = !openTopics.has(topicId)
    setOpenTopics((prev) => {
      const next = new Set(prev)
      if (opening) next.add(topicId)
      else next.delete(topicId)
      return next
    })
    if (opening) onExpandTopic(topicId)
  }

  function toggleHistory(): void {
    const opening = !historyOpen
    setHistoryOpen(opening)
    if (opening) onExpandRecentHistory()
  }

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

      {/* §27.2 importance / attention mode / meta */}
      <h2 className={styles.sectionTitle}>项目元数据</h2>
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

      {/* UI-3 (B §7.2 / §9.1) — Topics / Workstreams: the expandable
          Topic sections (replaces the one-card-per-topic list). */}
      <section className={styles.topicSections} data-topic-sections>
        <h2 className={styles.sectionTitle}>
          {t('project.topicsHeading')}（{data.topics.length}）
          <button type="button" className={styles.backButton} onClick={onCreateTopic} data-topic-create-topic>
            {t('tree.addTopic')}
          </button>
        </h2>
        {data.topics.length === 0 ? (
          <p className={styles.empty}>暂无主题</p>
        ) : (
          <ul className={styles.topicSectionList}>
            {data.topics.map((card) => (
              <TopicSection
                key={card.id}
                card={card}
                face={topicSections.get(card.id)}
                open={openTopics.has(card.id)}
                onToggle={() => toggleTopic(card.id)}
                onRetry={() => onRetryTopic(card.id)}
                onEdit={() => onEditTopic(card.id)}
                onAddWorkstream={() => onAddWorkstream(card.id)}
                onOpenTopic={() => onOpenTopic(card.id)}
                onOpenWorkstream={
                  onOpenWorkstream !== undefined
                    ? (wsId) => onOpenWorkstream(wsId, card.id)
                    : undefined
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* UI-8 (D §14.3) — Project Attention: the NON-TERMINAL items of
          the single-project `queryAttention` projection (the container's
          one-shot mount fetch, limit 6 — the UI-3 placeholder retired,
          real data; the host order is kept — INV-ATTN-1). Rows carrying
          a workstream are clickable (the console's workstream page — the
          topic id derives from the already-loaded topic faces; unknown →
          the row is NOT clickable, never guessed). */}
      <section className={styles.phase} data-project-attention>
        <h3 className={styles.sectionTitle}>{t('project.attentionTitle')}</h3>
        {attentionError !== null && attentionError !== undefined ? (
          <p className={styles.phaseText} role="alert" data-project-attention-error>
            {attentionError}
          </p>
        ) : attentionItems === null || attentionItems === undefined ? null : attentionItems.length === 0 ? (
          <p className={styles.phaseText} data-project-attention-empty>
            {t('attention.empty')}
          </p>
        ) : (
          <ul className={styles.attentionRowList} data-project-attention-items>
            {attentionItems
              .filter((item) => attentionGroupOf(item) !== 'CLOSED')
              .map((item) => {
                const wsId = item.workstreamId
                const topicId = wsId !== null ? findTopicIdOfWorkstream(topicSections, wsId) : null
                const clickable =
                  onOpenWorkstream !== undefined && wsId !== null && topicId !== null
                return (
                  <li
                    key={item.syntheticKey ?? item.sourceId}
                    className={styles.attentionRow}
                    data-project-attention-item
                    data-project-attention-item-id={item.sourceId}
                    data-project-attention-item-status={item.status}
                    onClick={clickable ? () => onOpenWorkstream(wsId, topicId) : undefined}
                  >
                    <span className={styles.attentionRowKind}>{KIND_LABEL[item.kind]}</span>
                    <span className={styles.attentionRowTitle}>{item.title}</span>
                    <span className={styles.attentionRowStatus}>{item.status}</span>
                  </li>
                )
              })}
          </ul>
        )}
      </section>

      {/* UI-3 (judgment #9) — Recent History: collapsed by default; the
          first expand triggers the lazy per-WS window loads (plan §24 —
          zero fetches on initial render).
          UI-8 (ADJ-11 #3) — this slice does NOT take over Recent
          History: the UI-3 lazy-window contract is preserved verbatim
          (the unified `queryAttention` projection feeds ONLY the
          Project Attention block above). */}
      <section className={styles.phase} data-recent-history>
        <h3 className={styles.sectionTitle}>
          <button
            type="button"
            className={styles.historyToggle}
            aria-expanded={historyOpen}
            onClick={toggleHistory}
            data-history-toggle
          >
            <span aria-hidden="true">{historyOpen ? '▾' : '▸'}</span> {t('project.historyTitle')}
          </button>
        </h3>
        {historyOpen &&
          (recentHistory.loading || recentHistory.entries === null ? (
            <p className={styles.phaseText} role="status">
              加载中…
            </p>
          ) : recentHistory.entries.length === 0 ? (
            <p className={styles.phaseText} data-history-empty>
              {t('project.historyEmpty')}
            </p>
          ) : (
            <>
              <ul className={styles.historyList}>
                {recentHistory.entries.map((entry, index) => (
                  <li key={`${entry.event.eventId}-${index}`} className={styles.historyEntry} data-history-entry>
                    <span className={styles.historyDate}>{formatEpochDate(entry.event.occurredAt)}</span>
                    <span className={styles.historyWs}>
                      {entry.workstreamTitle}（{entry.workstreamId}）
                    </span>
                    <span className={styles.historyType} data-history-event-type={entry.event.eventType}>
                      {entry.event.eventType}
                    </span>
                    {entry.event.actor.label !== undefined && (
                      <span className={styles.historyActor}>{entry.event.actor.label}</span>
                    )}
                  </li>
                ))}
              </ul>
              {recentHistory.truncated && (
                <p className={styles.phaseText} data-history-note>
                  {t('project.historyNoteFirst20')}
                </p>
              )}
            </>
          ))}
      </section>

      {/* §27.2 upcoming interactions / reporting — PHASE 5 placeholders
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
