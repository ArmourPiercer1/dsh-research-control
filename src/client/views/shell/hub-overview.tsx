/**
 * V2-T5.1 — 总览（中枢模式）= 聚合条 + 项目卡墙 (design §7.1, C 案).
 *
 * The HUB-role 总览 page body. On mount it fetches `getHubOverview`
 * (design §12 row 2) through the INJECTED plain-promise face (the
 * production binding in `dsh-adapter/ui.ts` folds the carrier's
 * `ok: false` branch into a rejection — the view never sees a
 * `RemoteResult`; INV-PERM-5: pure props/React, no @deepseek-ai import).
 *
 * Rendering (the §7.1 ASCII layout is the spec):
 *  - toolbar: [刷新] re-fetches getHubOverview (a failed REFRESH keeps the
 *    stale data + a fault row; a failed FIRST LOAD is the failure face);
 *  - 聚合条: 「N 个项目 · 未决干预 N · 收件箱 N」 (the `totals` projection,
 *    a single text node);
 *  - 「需关注」 row: ONLY the projects with open interventions — the host
 *    returns the array empty when none applies, and the row is then NOT
 *    RENDERED AT ALL (无则整行不渲染，不占位 — no placeholder element);
 *  - 项目卡墙: one WHOLE-CARD-CLICKABLE card per `cards[]` entry (the
 *    钻取链 root — the click fires `onDrill(projectId)` and the 总览
 *    content switches to the project view, back affordance to the wall):
 *    attention-mode badge (FOCUS/NORMAL/BACKGROUND — host state tokens),
 *    name + PRJ-id, the count row (未决干预>0 → warn token coloring),
 *    target date (rendered only when present — 有则显);
 *  - 空中枢 (cards empty, 0 projects): the onboarding card 「登记第一个
 *    研究项目」 at the card-wall position, wired into the SAME T4.2 bind
 *    flow (the `OnboardingCard` with the title/copy override — the host
 *    refuses a hub-workspace bind with a clear error, so the card's 接入
 *    button fails loud instead of forging a registration).
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'

import type {
  BindProjectArgs,
  BindProjectResult,
  HubOverviewResult,
  SetHubArgs,
  SetHubResult,
} from '../../../shared/rpc-contracts.js'

import { OnboardingCard } from './onboarding-card.js'
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
 * `oldestHours` is hours since the project's OLDEST open intervention):
 * ≥ 24h → whole days (floor — 「最旧 3 天」), below → the hour count.
 */
export function formatOldestAge(hours: number): string {
  if (hours >= 24) {
    return `最旧 ${String(Math.floor(hours / 24))} 天`
  }
  return `最旧 ${String(hours)} 小时`
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

export function HubOverviewPage(props: HubOverviewPageProps): ReactElement {
  const { loadHubOverview, onDrill, wsPath, hub, dirNames, setHub, bindProject, onApplied } =
    props
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

  /**
   * The fetch (initial load + [刷新]). `initial` selects the lifecycle:
   * the first load runs the loading face; a REFRESH keeps the stale data
   * rendered and only records a fault on failure (stale-while-revalidate,
   * the home 刷新 contract).
   */
  const runFetch = useCallback((initial: boolean): void => {
    if (!initial) {
      setRefreshError(null)
    } else {
      setPhase('loading')
    }
    const pending = loadRef.current()
    inflight.current = pending
    void pending
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

  const { totals, attention, cards } = data
  const emptyHub = cards.length === 0
  const attentionItems = attention.map(
    (a) => `${a.projectId} ${a.displayName}（干预 ×${String(a.openCount)}，${formatOldestAge(a.oldestHours)}）`,
  )

  return (
    <div className={styles.overview} data-hub-overview data-phase="ready">
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
      {/* 「需关注」 row — ONLY when at least one project has open
          interventions (the host returns [] otherwise; 无则整行不渲染，
          不占位 — no element in the DOM at all). */}
      {attention.length > 0 && (
        <p className={styles.attention} data-hub-overview-attention>
          {`⚠ 需关注：${attentionItems.join('；')}`}
        </p>
      )}
      {emptyHub ? (
        /* 空中枢 (design §7.1): the onboarding card at the card-wall
           position — the SAME T4.2 bind flow, 「登记第一个研究项目」. */
        <div className={styles.wall} data-hub-overview-wall data-hub-overview-empty="true">
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
        /* 项目卡墙 (design §7.1 C 案): one WHOLE-CARD-CLICKABLE card per
           ACTIVE project — the 钻取链 root (click → the 总览 content
           switches to the project view, back affordance to the wall). */
        <div className={styles.wall} data-hub-overview-wall>
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
    </div>
  )
}
