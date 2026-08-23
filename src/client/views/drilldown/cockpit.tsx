/**
 * WP-4.6 — Research Cockpit (the registered 研究 tab root).
 *
 * Replaces the U1 spike (`ResearchSpikeView`) as the slot body: the
 * Phase 4 page set of plan §27 wired into ONE tab with in-tab navigation
 * (no host navigation is used for research pages — the plugin renders
 * its own page stack inside the tab body):
 *
 *   Home (§27.1 dashboard + Intervention queue)
 *     → Project page (§27.2: brief + objectives + topic list — WP-4.7)
 *     → Topic page (§27.3: topology graph + WS cards)
 *       → Workstream page (§27.4 three zones + PlanFork panel +
 *         PlanGraph overlay + Claim/Artifact drill-down + Git panel)
 *         → History timeline (§27.4 History zone, WP-4.4)
 *
 * Store: ONE `createResearchStore()` factory result per tab mount
 * (useMemo — never module-level; the factory reads the mount-bound
 * `researchRpc` facade). Every child receives the handle BY PROPS; the
 * cockpit-owned components pull their slices through `binding-hooks.ts`
 * (the package's only uSES layer).
 *
 * DSH session semantics (TC-E2E-012/013, §26): the run's `dsh_session_id`
 * is a POINTER (INV-DB-2). This plugin has no host-session UI permission,
 * so the session-open channel is a PLACEHOLDER here: the card's
 * 「在宿主会话列表中打开」 button hands the sessionId to
 * `onOpenSession` (this component's own handler), which records the
 * pointer in a visible banner (the channel contract is the callback prop
 * — a host-side session-open channel can be plugged in later without
 * touching the display layer).
 *
 * Gate P4 (≤3 interactions to a run/session from the dashboard): the
 * home Intervention queue's workstream chip (1) → the claim/artifact
 * card (2) → the session link (3).
 */

import { useMemo, useState, type ReactElement } from 'react'

import type {
  QueryHistoryArgs,
  QueryHistoryResult,
  WorkstreamSnapshot,
} from '../../../shared/rpc-contracts.js'
import { createResearchStore, type ResearchStore, type SliceState } from '../../stores/index.js'
import { HomeDashboard } from '../home/HomeDashboard.js'
import { HistoryTimelineView } from '../history/HistoryTimelineView.js'
import { PlanGraphContainer } from '../../graph/PlanGraphContainer.js'
import { ProjectPage } from '../project/ProjectPage.js'
import { WorkstreamView } from '../workstream/WorkstreamView.js'
import { buildDrilldownModel } from './drilldown-model.js'
import { DrilldownSelection, DrilldownView } from './drilldown-view.js'
import { GitPanel } from './git-panel.js'
import { InterventionBoard } from './intervention-board.js'
import { PfPanel } from './pf-panel.js'
import { TopicPage } from './topic-page.js'
import { useHistorySlice, useWsSlice } from './binding-hooks.js'
import styles from './cockpit.module.css'

/** One page of the in-tab navigation stack. */
type CockpitPage =
  | { readonly kind: 'home' }
  | { readonly kind: 'project' }
  | { readonly kind: 'topic'; readonly topicId: string }
  | { readonly kind: 'ws'; readonly workstreamId: string }
  | { readonly kind: 'history'; readonly workstreamId: string }

/** epoch ms → local display text (deterministic, no timezone surprises
 *  in tests: the views show whatever the host clock produced). */
export function formatTime(epochMs: number): string {
  if (epochMs <= 0) return '—'
  const d = new Date(epochMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * The drill-down section of the workstream page (container): builds the
 * display model from the owner-WS full log window + the run table.
 */
function DrilldownSection({
  store,
  workstreamId,
  selection,
  onSelect,
  onOpenSession,
}: {
  store: ResearchStore
  workstreamId: string
  selection: DrilldownSelection
  onSelect: (selection: DrilldownSelection) => void
  onOpenSession: (sessionId: string, runId: string) => void
}): ReactElement {
  const ws: SliceState<import('../../../shared/rpc-contracts.js').WorkstreamSnapshot> = useWsSlice(store, workstreamId)
  // The FULL owner-WS log window (V1 scale: 10^4 events directly
  // replayable — plan §29); `audit` order = registration order.
  const historyArgs: QueryHistoryArgs = useMemo(
    () => ({ workstreamId, order: 'audit', limit: 10000 }),
    [workstreamId],
  )
  const hist: SliceState<QueryHistoryResult> = useHistorySlice(store, historyArgs)

  const model = useMemo(
    () => buildDrilldownModel(hist.data?.events ?? [], ws.data?.current.runs ?? []),
    [hist.data, ws.data],
  )

  return (
    <DrilldownView
      model={model}
      selection={selection}
      onSelect={onSelect}
      onOpenSession={onOpenSession}
      formatTime={formatTime}
    />
  )
}

/** The workstream page body (the three-zone view + the WP-4.6 panels). */
function WorkstreamPage({
  store,
  workstreamId,
  selection,
  onSelect,
  onOpenSession,
  onOpenHistory,
  onBack,
}: {
  store: ResearchStore
  workstreamId: string
  selection: DrilldownSelection
  onSelect: (selection: DrilldownSelection) => void
  onOpenSession: (sessionId: string, runId: string) => void
  onOpenHistory: () => void
  onBack: () => void
}): ReactElement {
  return (
    <section className={styles.page} aria-label="工作流域页">
      <h1 className={styles.pageTitle}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          ← 返回
        </button>{' '}
        {workstreamId}
      </h1>
      <div className={styles.wsPageGrid}>
        <div className={styles.wsPageMain}>
          <WorkstreamView store={store} workstreamId={workstreamId} onOpenHistory={onOpenHistory} />
          <h2 className={styles.sectionTitle}>计划图（正典 + PlanFork overlay）</h2>
          <div className={styles.graphBox} data-ws-id={workstreamId}>
            <PlanGraphContainer store={store} workstreamId={workstreamId} />
          </div>
          <DrilldownSection
            store={store}
            workstreamId={workstreamId}
            selection={selection}
            onSelect={onSelect}
            onOpenSession={onOpenSession}
          />
        </div>
        <div className={styles.wsPageSide}>
          <PfPanel store={store} workstreamId={workstreamId} />
          <GitPanel store={store} workstreamId={workstreamId} />
        </div>
      </div>
    </section>
  )
}

/**
 * The 研究 tab body (the slot component).
 * @returns the cockpit element.
 */
export function ResearchCockpit(): ReactElement {
  // One factory result per tab mount — the store handle never lives at
  // module level (the factory binds the mount-time `researchRpc` facade).
  const store = useMemo(() => createResearchStore(), [])
  const [page, setPage] = useState<CockpitPage>({ kind: 'home' })
  const [selection, setSelection] = useState<DrilldownSelection>(null)
  const [sessionPointer, setSessionPointer] = useState<{ sessionId: string; runId: string } | null>(null)

  function openProject(): void {
    setSelection(null)
    setPage({ kind: 'project' })
  }
  function openTopic(topicId: string): void {
    setSelection(null)
    setPage({ kind: 'topic', topicId })
  }
  function openWs(workstreamId: string): void {
    setSelection(null)
    setPage({ kind: 'ws', workstreamId })
  }
  function openHistory(workstreamId: string): void {
    setPage({ kind: 'history', workstreamId })
  }

  function handleSelect(next: DrilldownSelection): void {
    // Clicking the selected card again deselects (toggle — the run panel
    // returns to the idle hint).
    if (
      selection !== null &&
      next !== null &&
      selection.kind === next.kind &&
      selection.id === next.id
    ) {
      setSelection(null)
      return
    }
    setSelection(next)
  }

  // The DSH session-open channel (placeholder semantics — see header):
  // the pointer is recorded visibly; a host channel can replace this
  // handler without touching the display layer.
  function handleOpenSession(sessionId: string, runId: string): void {
    setSessionPointer({ sessionId, runId })
  }

  return (
    <div className={styles.cockpit} data-cockpit-page={page.kind}>
      {sessionPointer !== null && (
        <div className={styles.sessionBanner} role="status" data-session-id={sessionPointer.sessionId}>
          <p>
            宿主会话指针 <code>{sessionPointer.sessionId}</code>（来自 Run {sessionPointer.runId}）—
            在宿主会话列表中打开（外部跳转 · 占位通道：本插件无宿主会话 UI 权限，指针记录于此）
          </p>
          <button type="button" className={styles.backButton} onClick={() => setSessionPointer(null)}>
            收起
          </button>
        </div>
      )}

      {page.kind === 'home' && (
        <>
          <HomeDashboard
            store={store}
            onOpenProject={openProject}
            onOpenTopic={openTopic}
            onOpenWorkstream={openWs}
            onOpenHistory={openHistory}
          />
          <InterventionBoard store={store} onOpenWorkstream={openWs} />
        </>
      )}

      {page.kind === 'project' && (
        <ProjectPage store={store} onOpenTopic={openTopic} onBack={() => setPage({ kind: 'home' })} />
      )}

      {page.kind === 'topic' && (
        <TopicPage store={store} topicId={page.topicId} onOpenWorkstream={openWs} onBack={() => setPage({ kind: 'home' })} />
      )}

      {page.kind === 'ws' && (
        <WorkstreamPage
          store={store}
          workstreamId={page.workstreamId}
          selection={selection}
          onSelect={handleSelect}
          onOpenSession={handleOpenSession}
          onOpenHistory={() => openHistory(page.workstreamId)}
          onBack={() => setPage({ kind: 'home' })}
        />
      )}

      {page.kind === 'history' && (
        <section className={styles.page} aria-label="历史时间线页">
          <h1 className={styles.pageTitle}>
            <button type="button" className={styles.backButton} onClick={() => openWs(page.workstreamId)}>
              ← 返回 {page.workstreamId}
            </button>{' '}
            历史时间线 · {page.workstreamId}
          </h1>
          <HistoryTimelineView store={store} workstreamId={page.workstreamId} pageSize={200} initialOrder="semantic" />
        </section>
      )}
    </div>
  )
}
