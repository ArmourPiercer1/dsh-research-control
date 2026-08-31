/**
 * V2-T5.1 — 总览（中枢模式）= 聚合条 + 项目卡墙 (design §7.1, C 案).
 * V2-UI-0.4 UI-3 (D2) — restructured into the FROZEN B §4 Portfolio view:
 * header `Portfolio [Create Project] [Bind Existing Project]` + subtitle,
 * the Needs Attention SUMMARY (the top-6 cross-project NON-TERMINAL items
 * from the unified `queryAttention` face, View all → the Needs Attention
 * unified page), the
 * 聚合条, the per-project 需关注 row, the Projects card wall (B §4.5 field
 * set, description 有则显) and the B §4.6 VERBATIM empty state (its dual
 * buttons open the SAME shared journey dialogs as the header).
 *
 * The HUB-role 总览 page body. On mount it fetches `getHubOverview`
 * (design §12 row 2) through the INJECTED plain-promise face (the
 * production binding in `dsh-adapter/ui.ts` folds the carrier's
 * `ok: false` branch into a rejection — the view never sees a
 * `RemoteResult`; INV-PERM-5: pure props/React, no @deepseek-ai import).
 *
 * Rendering (the §7.1 ASCII layout is the spec, B §4 refines it):
 *  - header: the frozen B §4.2/§4.3 page header — `Portfolio` title +
 *    [Create Project] / [Bind Existing Project] (rendered ONLY when the
 *    journey faces are wired — omitted faces render NO disabled forms) +
 *    the `Research projects overview` subtitle;
 *  - toolbar: [刷新] re-fetches getHubOverview (a failed REFRESH keeps the
 *    stale data + a fault row; a failed FIRST LOAD is the failure face);
 *  - 聚合条: 「N 个项目 · 未决干预 N · 收件箱 N」 (the `totals` projection,
 *    a single text node);
 *  - Needs Attention summary (B §4.4, UI-8 D §14.2): the unified
 *    `queryAttention` fetch (the SAME wire call as the Needs Attention
 *    unified page — the injected `loadAttention` face, zero args = the
 *    cross-project hub view) filtered to NON-TERMINAL items, collapsed to
 *    the TOP 6 (host order — never client re-sorted: INV-ATTN-1); each
 *    item is a whole-item button → `onOpenAttention` (the unified page);
 *    the header's [View all] does the same. The section renders NOTHING
 *    when the face is omitted, the fetch failed (the fault line responds
 *    with the carrier-decoded detail) or no non-terminal item remains (no
 *    placeholder, the §7.1 无则整行不渲染 convention). One fetch per
 *    mount — [刷新] does NOT re-run it (the back-from-drill remount does;
 *    the unified page has its own lifecycle);
 *  - 「需关注」 row (the T5.1 per-project aggregate — UI-8: recomputed
 *    from the SAME `queryAttention` fetch; per-project NON-TERMINAL count
 *    + oldest detected age, first-appearance order): ONLY when at least
 *    one project has non-terminal items — otherwise the row is NOT
 *    RENDERED AT ALL (无则整行不渲染，不占位 — no placeholder element);
 *  - Projects card wall: heading + one WHOLE-CARD-CLICKABLE card per
 *    `cards[]` entry (the 钻取链 root — the click fires
 *    `onDrill(projectId)` and the 总览 content switches to the project
 *    view, back affordance to the wall): attention-mode badge (FOCUS/
 *    NORMAL/BACKGROUND — host state tokens), name + PRJ-id, the
 *    description (B §4.5 有则显 — rendered only when present), the count
 *    row (未决干预>0 → warn token coloring), target date (有则显);
 *  - 空中枢 (cards empty, 0 projects): the B §4.6 VERBATIM empty box
 *    (「No research projects yet」+ body + [Create Research Project] /
 *    [Bind Existing Project] + the Create/Bind explanation lines) at the
 *    card-wall position, coexisting with the T5.1 onboarding card
 *    「登记第一个研究项目」 (the SAME T4.2 bind flow — the host refuses a
 *    hub-workspace bind with a clear error, so the card's 接入 button
 *    fails loud instead of forging a registration).
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'

import type {
  AttentionItemDto,
  BindProjectArgs,
  BindProjectResult,
  CreateLocalResearchProjectArgs,
  CreateLocalResearchProjectResult,
  HubOverviewResult,
  InspectProjectDirectoryArgs,
  InspectProjectDirectoryResult,
  QueryAttentionResult,
  SetHubArgs,
  SetHubResult,
} from '../../../shared/rpc-contracts.js'
import { t } from '../../i18n/copy.js'
import { extractResearchErrorCarrier } from '../../util/error-carrier.js'
import { KIND_LABEL, PRIORITY_LABEL, attentionGroupOf } from './intervention-stream.js'
import { OnboardingCard } from './onboarding-card.js'
import { BindProjectDialog, CreateProjectDialog } from './project-journeys.js'
import styles from './hub-overview.module.css'

/** The shell's overview fetch lifecycle (the loading / failed / ready faces). */
type OverviewPhase = 'loading' | 'failed' | 'ready'

/**
 * epoch ms → `YYYY-MM-DD` (local time, TZ-stable shape — the same
 * convention the project/topic views use for 目标日期).
 */
export function formatEpochDate(epochMs: number): string {
  const d = new Date(epochMs)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/**
 * 「最旧 N 天/小时」 display carrier for the 需关注 row (the contract's
 * `oldestHours` is hours since the project's OLDEST open intervention, as a
 * FLOAT): ≥ 24h → whole days (floor — 「最旧 3 天」); ≥ 1h → whole hours
 * (floor — 「最旧 5 小时」); < 1h → 「最旧 <1 小时」. The raw float never
 * reaches the UI (acceptance T6.2 discovery).
 */
export function formatOldestAge(hours: number): string {
  if (hours >= 24) {
    return `最旧 ${String(Math.floor(hours / 24))} 天`
  }
  if (hours < 1) {
    return '最旧 <1 小时'
  }
  return `最旧 ${String(Math.floor(hours))} 小时`
}

/**
 * Props of the 总览（中枢模式）page.
 *
 * @param props - `loadHubOverview` is the injected plane overview fetch
 *  (plain business promise — resolves the strict wire result, rejects on
 *  ANY failure); `onDrill` is the 钻取链 root callback (the whole-card
 *  click hands the project id to the shell, which switches the 总览
 *  content to the project view); `wsPath` / `hub` / `dirNames` + the two
 *  mutation faces + `onApplied` feed the 空中枢 onboarding card (the SAME
 *  T4.2 bind flow — `setHub` is present for the card's two-state logic,
 *  which disables 设为中枢 while a hub exists).
 *
 *  V2-UI-0.4 UI-3 (D2) ADDITIVE OPTIONAL faces — omitted → the feature is
 *  NOT rendered at all (no disabled forms; production wires all four in
 *  `dsh-adapter/ui.ts`):
 *  - `createLocalResearchProject` / `inspectProjectDirectory` enable the
 *    header [Create Project] / [Bind Existing Project] + the B §4.6 empty
 *    state's dual buttons (all four open the SAME shared journey dialogs,
 *    project-journeys.tsx);
 *  - `loadAttention` feeds the Needs Attention summary (the unified
 *    face — zero args = the cross-project hub view; the shell adapts the
 *    stream face);
 *  - `onOpenAttention` is the summary item / [View all] target (the shell
 *    jumps the frame to the 重要事件 stream page).
 */
export interface HubOverviewPageProps {
  readonly loadHubOverview: () => Promise<HubOverviewResult>
  readonly onDrill: (projectId: string) => void
  readonly wsPath: string
  readonly hub: { readonly path: string }
  readonly dirNames: { readonly treeDir: string; readonly hubDir: string }
  readonly setHub: (args: SetHubArgs) => Promise<SetHubResult>
  readonly bindProject: (args: BindProjectArgs) => Promise<BindProjectResult>
  readonly onApplied: () => void
  readonly createLocalResearchProject?: (
    args: CreateLocalResearchProjectArgs,
  ) => Promise<CreateLocalResearchProjectResult>
  readonly inspectProjectDirectory?: (
    args: InspectProjectDirectoryArgs,
  ) => Promise<InspectProjectDirectoryResult>
  readonly loadAttention?: () => Promise<QueryAttentionResult>
  readonly onOpenAttention?: () => void
}

/**
 * The 空中枢 card copy (design §7.1: 卡片墙位置渲染引导卡「登记第一个
 * 研究项目」→ 接入流程). The hub workspace itself is NOT a registrable
 * project (the host refuses with a clear error — the 中枢占用 branch), so
 * the copy points to the project-workspace session path while the card's
 * 接入 button stays wired to the T4.2 flow (it fails loud there).
 */
const EMPTY_HUB_COPY =
  '当前中枢还没有登记任何研究项目。请在一个未登记项目工作区的会话中打开研究标签，用「接入」登记第一个项目（中枢工作区本身不能登记为项目）。'

/** B §4.4: the summary shows at most 6 items (the host order is kept —
 *  the DTO carries no priority field to client-side re-sort on). */
const ATTENTION_SUMMARY_CAP = 6

export function HubOverviewPage(props: HubOverviewPageProps): ReactElement {
  const {
    loadHubOverview,
    onDrill,
    wsPath,
    hub,
    dirNames,
    setHub,
    bindProject,
    onApplied,
    createLocalResearchProject,
    inspectProjectDirectory,
    loadAttention,
    onOpenAttention,
  } = props
  const [data, setData] = useState<HubOverviewResult | null>(null)
  const [phase, setPhase] = useState<OverviewPhase>('loading')
  // A failed REFRESH over live data (stale data stays rendered + the fault
  // row explains; the [刷新] button is the retry affordance).
  const [refreshError, setRefreshError] = useState<string | null>(null)
  // In-flight promise slot: StrictMode's double effect reuses the FIRST
  // in-flight fetch instead of issuing a second one (the shell pins the
  // same one-fetch-per-load invariant).
  const inflight = useRef<Promise<HubOverviewResult> | null>(null)
  // The inject face is read through a ref so a re-render with a fresh
  // binding never leaks a stale closure into the effect.
  const loadRef = useRef(props.loadHubOverview)
  loadRef.current = props.loadHubOverview

  // ── V2-UI-0.4 UI-3 (D2) — the Needs Attention summary (B §4.4). ──

  // null = not loaded (face omitted or the fetch is still in flight).
  const [attentionItems, setAttentionItems] = useState<readonly AttentionItemDto[] | null>(null)
  // The summary fetch failure (carrier-decoded detail; the stream page has
  // its own full failure face — this line only says the summary is dark).
  const [attentionError, setAttentionError] = useState<string | null>(null)
  const attentionInflight = useRef<Promise<QueryAttentionResult> | null>(null)
  const attentionLoadRef = useRef(props.loadAttention)
  attentionLoadRef.current = props.loadAttention
  // true = the Create journey dialog is open (the shared dialog mounts).
  const [createOpen, setCreateOpen] = useState(false)
  // true = the Bind journey dialog is open.
  const [bindOpen, setBindOpen] = useState(false)

  /**
   * The summary fetch (one per mount — [刷新] does NOT re-run it; the
   * back-from-drill remount does). A failed fetch keeps the page (the
   * hub overview is the page; the summary is a section) and records the
   * fault line with the carrier-decoded detail (NOTE-4: the code rides
   * the message prefix, never error.code).
   */
  const runAttentionFetch = useCallback((): void => {
    if (attentionLoadRef.current === undefined) return
    setAttentionError(null)
    const pending = attentionLoadRef.current()
    attentionInflight.current = pending
    pending
      .then((result) => {
        if (attentionInflight.current !== pending) return
        setAttentionItems(result.items)
      })
      .catch((err: unknown) => {
        if (attentionInflight.current !== pending) return
        const message = err instanceof Error ? err.message : String(err)
        const carrier = extractResearchErrorCarrier(message)
        setAttentionError(carrier !== null ? carrier.detail : message)
      })
      .finally(() => {
        if (attentionInflight.current === pending) attentionInflight.current = null
      })
  }, [])

  const runFetch = useCallback((initial: boolean): void => {
    if (!initial) {
      setRefreshError(null)
    } else {
      setPhase('loading')
    }
    const pending = loadRef.current()
    inflight.current = pending
    pending
      .then((result) => {
        if (inflight.current !== pending) return
        setData(result)
        setPhase('ready')
        setRefreshError(null)
      })
      .catch((err: unknown) => {
        if (inflight.current !== pending) return
        const message = err instanceof Error ? err.message : String(err)
        if (initial) {
          setPhase('failed')
        } else {
          // Stale data stays (the fault row is the response).
          setRefreshError(message)
        }
      })
      .finally(() => {
        if (inflight.current === pending) inflight.current = null
      })
  }, [])

  useEffect(() => {
    if (inflight.current === null) {
      runFetch(true)
    }
    // One fetch per mount — the ref-deduped runFetch is stable.
  }, [runFetch])

  useEffect(() => {
    if (attentionInflight.current === null && attentionLoadRef.current !== undefined) {
      runAttentionFetch()
    }
    // One summary fetch per mount.
  }, [runAttentionFetch])

  if (phase === 'loading') {
    return (
      <div className={styles.overview} data-hub-overview data-phase="loading">
        <p className={styles.statusLine} role="status">
          正在加载研究总览…
        </p>
      </div>
    )
  }

  if (phase === 'failed' || data === null) {
    return (
      <div className={styles.overview} data-hub-overview data-phase="failed">
        <p className={styles.faultLine} role="alert">
          研究总览加载失败
        </p>
        <div className={styles.toolbar}>
          <button type="button" className={styles.refreshButton} onClick={() => runFetch(true)}>
            刷新
          </button>
        </div>
      </div>
    )
  }

  const { totals, cards } = data
  const emptyHub = cards.length === 0
  // UI-8 (D §14.2): the 需关注 row + the B §4.4 summary BOTH derive from
  // the SAME unified `queryAttention` fetch (the T5.1 host-side `attention`
  // projection is no longer consumed by this view). NON-TERMINAL items
  // only — terminals need no human action; first-appearance (host) order
  // is kept (INV-ATTN-1: never re-sorted client-side).
  const nonTerminalItems = (attentionItems ?? []).filter((item) => attentionGroupOf(item) !== 'CLOSED')
  const attentionItemsText = (() => {
    const order: string[] = []
    const byProject = new Map<string, { count: number; oldestMs: number }>()
    for (const item of nonTerminalItems) {
      const seen = byProject.get(item.projectId)
      if (seen === undefined) {
        order.push(item.projectId)
        byProject.set(item.projectId, { count: 1, oldestMs: item.detectedAt })
      } else {
        seen.count += 1
        seen.oldestMs = Math.min(seen.oldestMs, item.detectedAt)
      }
    }
    return order.map((pid) => {
      const displayName = cards.find((c) => c.projectId === pid)?.displayName ?? pid
      const entry = byProject.get(pid)
      const hours = (Date.now() - (entry?.oldestMs ?? 0)) / 3_600_000
      return `${pid} ${displayName}（需关注 ×${String(entry?.count ?? 0)}，${formatOldestAge(hours)}）`
    })
  })()
  // The B §4.4 summary projection (host order, non-terminal, top 6):
  // rendered ONLY when the face is wired AND the fetch settled with a
  // non-empty non-terminal list.
  const summaryVisible =
    loadAttention !== undefined && attentionItems !== null && nonTerminalItems.length > 0
  const summaryItems = nonTerminalItems.slice(0, ATTENTION_SUMMARY_CAP)

  return (
    <div className={styles.overview} data-hub-overview data-phase="ready">
      {/* B §4.2/§4.3 frozen header: Portfolio [Create] [Bind] + subtitle. */}
      <header className={styles.header} data-portfolio-header>
        <h2 className={styles.headerTitle} data-portfolio-title>
          {t('nav.portfolio')}
        </h2>
        <div className={styles.headerActions}>
          {createLocalResearchProject !== undefined && (
            <button
              type="button"
              className={styles.headerButton}
              data-portfolio-create
              onClick={() => setCreateOpen(true)}
            >
              {t('portfolio.createProject')}
            </button>
          )}
          {inspectProjectDirectory !== undefined && (
            <button
              type="button"
              className={styles.headerButton}
              data-portfolio-bind
              onClick={() => setBindOpen(true)}
            >
              {t('portfolio.bindExistingProject')}
            </button>
          )}
        </div>
      </header>
      <p className={styles.subtitle} data-portfolio-subtitle>
        {t('portfolio.subtitle')}
      </p>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.refreshButton}
          data-hub-overview-refresh
          onClick={() => runFetch(false)}
        >
          刷新
        </button>
      </div>
      {refreshError !== null && (
        <p className={styles.refreshError} role="alert">
          刷新失败：{refreshError}
        </p>
      )}
      {/* 聚合条 (design §7.1): 项目数 / 未决干预合计 / 收件箱合计. */}
      <p className={styles.strip} data-hub-overview-strip>
        {`${totals.projects} 个项目 · 未决干预 ${totals.openInterventions} · 收件箱 ${totals.inbox}`}
      </p>
      {/* Needs Attention summary (B §4.4): top-6 cross-project items +
          [View all] → the 重要事件 stream page. NOTHING when the face is
          omitted, the fetch failed (the fault line responds) or the list
          is empty (无则不渲染，不占位). */}
      {summaryVisible ? (
        <section className={styles.attentionSection} data-portfolio-attention>
          <div className={styles.attentionHeader}>
            <h3 className={styles.attentionTitle}>{t('portfolio.attentionTitle')}</h3>
            {onOpenAttention !== undefined && (
              <button
                type="button"
                className={styles.attentionViewAll}
                data-portfolio-attention-view-all
                onClick={onOpenAttention}
              >
                {t('portfolio.viewAll')}
              </button>
            )}
          </div>
          <ul className={styles.attentionList}>
            {summaryItems.map((item) => {
              const displayName = cards.find((c) => c.projectId === item.projectId)?.displayName ?? item.projectId
              return (
                <li key={item.syntheticKey ?? item.sourceId}>
                  <button
                    type="button"
                    className={styles.attentionItem}
                    data-portfolio-attention-item
                    data-attention-item-id={item.sourceId}
                    aria-label={`${item.title} — ${displayName} (${item.projectId})`}
                    onClick={() => {
                      onOpenAttention?.()
                    }}
                  >
                    <span className={styles.attentionItemTitle} data-attention-item-title>
                      {item.title}
                    </span>
                    <span className={styles.attentionItemMeta} data-attention-item-meta>
                      {`${displayName} (${item.projectId})${item.workstreamId !== null ? ` · ${item.workstreamId}` : ''} · ${KIND_LABEL[item.kind]} · ${PRIORITY_LABEL[item.priority]} · ${item.status}`}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : attentionError !== null ? (
        <p className={styles.refreshError} role="alert" data-portfolio-attention-error>
          {attentionError}
        </p>
      ) : null}
      {/* 「需关注」 row — ONLY when at least one project has open
          interventions (the host returns [] otherwise; 无则整行不渲染，
          不占位 — no element in the DOM at all). */}
      {attentionItemsText.length > 0 && (
        <p className={styles.attention} data-hub-overview-attention>
          {`⚠ 需关注：${attentionItemsText.join('；')}`}
        </p>
      )}
      {emptyHub ? (
        /* 空中枢 (design §7.1 + B §4.6): the VERBATIM empty box at the
           card-wall position, coexisting with the T5.1 onboarding card
           (the SAME T4.2 bind flow, 「登记第一个研究项目」). */
        <div className={styles.wall} data-hub-overview-wall data-hub-overview-empty="true">
          <div className={styles.emptyBox} data-portfolio-empty>
            <h3 className={styles.emptyTitle} data-portfolio-empty-title>
              {t('portfolio.emptyTitle')}
            </h3>
            <p className={styles.emptyBody} data-portfolio-empty-body>
              {t('portfolio.emptyBody')}
            </p>
            <div className={styles.emptyActions}>
              {createLocalResearchProject !== undefined && (
                <button
                  type="button"
                  className={styles.emptyButton}
                  data-portfolio-empty-create
                  onClick={() => setCreateOpen(true)}
                >
                  {t('portfolio.emptyCreate')}
                </button>
              )}
              {inspectProjectDirectory !== undefined && (
                <button
                  type="button"
                  className={styles.emptyButton}
                  data-portfolio-empty-bind
                  onClick={() => setBindOpen(true)}
                >
                  {t('portfolio.emptyBind')}
                </button>
              )}
            </div>
            {/* B §4.6 必须解释 (Create/Bind semantics, verbatim). */}
            <p className={styles.emptyExplain} data-portfolio-empty-explain>
              {`${t('portfolio.emptyExplainCreate')}。${t('portfolio.emptyExplainBind')}`}
            </p>
          </div>
          <OnboardingCard
            title="登记第一个研究项目"
            copy={EMPTY_HUB_COPY}
            wsPath={wsPath}
            hub={hub}
            dirNames={dirNames}
            setHub={setHub}
            bindProject={bindProject}
            onApplied={onApplied}
          />
        </div>
      ) : (
        /* 项目卡墙 (design §7.1 C 案 + B §4.5): heading + one
           WHOLE-CARD-CLICKABLE card per ACTIVE project — the 钻取链 root
           (click → the 总览 content switches to the project view, back
           affordance to the wall). */
        <div className={styles.wall} data-hub-overview-wall>
          <h3 className={styles.wallHeading} data-portfolio-projects>
            {t('portfolio.projects')}
          </h3>
          {cards.map((card) => (
            <button
              key={card.projectId}
              type="button"
              className={styles.card}
              data-project-card
              data-project-id={card.projectId}
              aria-label={`查看项目 ${card.projectId} ${card.title}`}
              onClick={() => onDrill(card.projectId)}
            >
              <span
                className={`${styles.badge} ${
                  card.attentionMode === 'FOCUS'
                    ? styles.badgeFocus
                    : card.attentionMode === 'NORMAL'
                      ? styles.badgeNormal
                      : styles.badgeBackground
                }`}
                data-attention-mode={card.attentionMode}
              >
                <span className={styles.dot} aria-hidden="true" />
                {card.attentionMode}
              </span>
              <span className={styles.cardName}>
                {card.projectId} {card.title}
              </span>
              {card.description !== null && (
                <span className={styles.cardDescription} data-card-description>
                  {card.description}
                </span>
              )}
              <span
                className={
                  card.openInterventions > 0
                    ? `${styles.cardCounts} ${styles.cardCountsWarn}`
                    : styles.cardCounts
                }
                data-card-counts
                data-open-interventions={card.openInterventions}
              >
                {`干预${String(card.openInterventions)} 主题${String(card.topics)} 收${String(card.inboxCount)}`}
              </span>
              {card.targetDate !== null && (
                <span className={styles.cardTarget} data-card-target>
                  {`目标 ${formatEpochDate(card.targetDate)}`}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {/* V2-UI-0.4 UI-3 (D2) — the header/empty-state journeys: the SAME
          shared dialogs the onboarding card uses (project-journeys.tsx).
          In the HUB seat they act on the hub cwd — the host's frozen
          semantics answer (PLANE_HUB_WORKSPACE refuses a hub-cwd create;
          the inspect reports the hub's state) — the real flow, not a
          placeholder. */}
      {createOpen && createLocalResearchProject !== undefined && (
        <CreateProjectDialog
          wsPath={wsPath}
          dirNames={dirNames}
          createLocalResearchProject={createLocalResearchProject}
          onApplied={() => {
            setCreateOpen(false)
            onApplied()
          }}
        />
      )}
      {bindOpen && inspectProjectDirectory !== undefined && (
        <BindProjectDialog
          wsPath={wsPath}
          inspectProjectDirectory={inspectProjectDirectory}
          bindProject={bindProject}
          onApplied={() => {
            setBindOpen(false)
            onApplied()
          }}
          onClosed={() => setBindOpen(false)}
        />
      )}
    </div>
  )
}
