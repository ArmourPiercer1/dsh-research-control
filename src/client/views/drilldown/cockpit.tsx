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

import { useMemo, useRef, useState, type ReactElement } from 'react'

import type {
  InterventionDto,
  QueryHistoryArgs,
  QueryHistoryResult,
  WorkstreamSnapshot,
} from '../../../shared/rpc-contracts.js'
// WP-7.4 — the shared one-click success-text parser（the launched
// session id the investigator panel binds to after a successful launch）.
import { parseInvestigationSessionId } from '../../../shared/investigation-command.js'
import { createResearchStore, type ResearchStore, type SliceState } from '../../stores/index.js'
// RR-017① — Phase 5/6 切片直 import（独立切片文件 — 多 WP 并行纪律:
// 不改 stores/index.ts 公共面, 同 actions 视图 import 自己的切片）。
import { createActionsSlicesStore } from '../../stores/actions-slices.js'
import { createInboxSliceStore } from '../../stores/inbox-slice.js'
// WP-7.4 / G7 S1c — analysis 切片（生产工厂 — **生产 provider 已接线**:
// `createCommandAnalysisDataProvider` 经 DSH 内置 commands/execute 网关
// 域承载宿主消费面, 保存按钮解禁; 保存后列表刷新路径是生产 store 代码,
// WP-7.3 钉死; 13-RPC 清单零 diff — 见通道模块头注 + 报告四面论证）。
import { createAnalysisSliceStore } from '../../stores/analysis-slice.js'
// WP-7.4 / G7 S1 — analysis 数据面生产 provider（保存按钮解禁的通道半）。
import { createCommandAnalysisDataProvider } from '../../dsh-adapter/remote/analysis-channel.js'
// WP-7.4 / G7 S1b — 一键调查通道（DSH 内置 commands/execute 网关域 —
// 零新增 RPC; 生产默认, 测试经 props.onInvestigate 注入替身）。
import { investigateIntervention } from '../../dsh-adapter/remote/investigate.js'
import { t } from '../../i18n/copy.js'
import { formatTime } from '../../i18n/datetime.js'
import { HomeDashboard } from '../home/HomeDashboard.js'
import { HistoryTimelineView } from '../history/HistoryTimelineView.js'
import { ProjectPage } from '../project/ProjectPage.js'
import { WorkstreamView } from '../workstream/WorkstreamView.js'
import { buildDrilldownModel } from './drilldown-model.js'
import { DrilldownSelection, DrilldownView } from './drilldown-view.js'
import { GitPanel } from './git-panel.js'
import { InterventionBoard } from './intervention-board.js'
import { PfPanel } from './pf-panel.js'
import { TopicPage } from './topic-page.js'
import { useHistorySlice, useWsSlice } from './binding-hooks.js'
import { InterventionGroupsView } from '../intervention/InterventionGroupsView.js'
import { ActionsViewContainer } from '../actions/actions-container.js'
import { ReportingView } from '../reporting/ReportingView.js'
import { AttentionView } from '../attention/AttentionView.js'
import { BriefView } from '../brief/BriefView.js'
import { InboxViewContainer } from '../inbox/inbox-container.js'
// WP-7.4 / G7 S1c — investigator 面板（transient 分析 + 用户显式保存 —
// INV-PERM-3 输出纪律的 GUI 消费面）。
import { InvestigatorViewContainer } from '../investigator/investigator-container.js'
import styles from './cockpit.module.css'

/** One page of the in-tab navigation stack.
 *
 *  RR-017① (WP-6.4): the Phase 5 page set (intervention / actions /
 *  reporting / attention / brief) + the Phase 6 Inbox page are registered
 *  here — all six user-reachable through the in-tab nav (minimal wiring:
 *  one nav section + six page bodies; data channels follow each WP's
 *  delivery state — fail-loud where not wired, per WP-5.2/WP-6.4 报告). */
type CockpitPage =
  | { readonly kind: 'home' }
  | { readonly kind: 'project' }
  | { readonly kind: 'topic'; readonly topicId: string }
  | { readonly kind: 'ws'; readonly workstreamId: string }
  | { readonly kind: 'history'; readonly workstreamId: string }
  | { readonly kind: 'intervention' }
  | { readonly kind: 'actions' }
  | { readonly kind: 'reporting' }
  | { readonly kind: 'attention' }
  | { readonly kind: 'brief' }
  | { readonly kind: 'inbox' }
  | { readonly kind: 'investigator' }

/** RR-017① — the in-tab nav entries (label = 中文组件纪律; kind = page;
 *  全部为无参页面 — 钻取页 project/topic/ws/history 不进导航栏,
 *  仍经 Home/页面内入口到达, 保持既有钻取路径不变)。 */
type PlainPageKind = 'home' | 'intervention' | 'actions' | 'reporting' | 'attention' | 'brief' | 'inbox' | 'investigator'

// V2-T5.1 — 撤出导航 (design §6 信息架构): 行动 / 汇报 / 注意力 / 简报 /
// 收件箱 are DEFERRED, not deleted — per the design the V2 first-tier
// entries are fixed at four (总览 / 重要事件 / 调查员 / 设置) and these five
// pages are withdrawn from every rendered nav/tab set. The host-side
// services and data behind them are retained (see design §6 撤出导航 =
// deferred, services retained); their page bodies below stay wired so the
// later V2 tasks (T5.2–T5.4) can re-host them from 重要事件 / the hub
// overview. Only the nav registration is removed here.
const COCKPIT_NAV: ReadonlyArray<{ readonly kind: PlainPageKind; readonly label: string }> = [
  { kind: 'home', label: '首页' },
  { kind: 'intervention', label: '干预' },
  // WP-7.4 / G7 S1c — 调查员页（transient 分析面板 + 显式保存; 一键
  // 调查成功后自动跳入, 导航栏亦可达）。
  { kind: 'investigator', label: '调查员' },
]

/** epoch ms → local display text. UI-9 ADJ-1: the implementation moved
 *  to `src/client/i18n/datetime.ts` (locale-aware); re-exported here
 *  for import stability (the WorkstreamPage passes it to the drilldown
 *  view as the `formatTime` prop). Default-locale output is
 *  byte-invariant (incl. the `<= 0 → —` guard). */
export { formatTime }

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

/** The workstream page props (V2-T5.1: exported so the V2 project
 *  console can host the same workstream page body in the drill chain
 *  项目 → 主题 → 工作流 → 历史). */
export interface WorkstreamPageProps {
  readonly store: ResearchStore
  readonly workstreamId: string
  readonly selection: DrilldownSelection
  readonly onSelect: (selection: DrilldownSelection) => void
  readonly onOpenSession: (sessionId: string, runId: string) => void
  readonly onOpenHistory: () => void
  readonly onBack: () => void
  /** UI-7 (B §26): deep link into the Records tab pre-filtered to a
   *  related object (`KIND:ID`); forwarded to the workstream view. */
  readonly initialRecordsRelated?: string
}

/** The workstream page body (the three-zone view + the WP-4.6 panels).
 *  V2-T5.1: exported for reuse by the V2 project console. */
export function WorkstreamPage({
  store,
  workstreamId,
  selection,
  onSelect,
  onOpenSession,
  onOpenHistory,
  onBack,
  initialRecordsRelated,
}: WorkstreamPageProps): ReactElement {
  return (
    <section className={styles.page} aria-label={t('ws.ariaPage')}>
      <h1 className={styles.pageTitle}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          {t('common.back')}
        </button>{' '}
        {workstreamId}
      </h1>
      <div className={styles.wsPageGrid}>
        <div className={styles.wsPageMain}>
          <WorkstreamView store={store} workstreamId={workstreamId} onOpenHistory={onOpenHistory} initialRecordsRelated={initialRecordsRelated} />
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
 *
 * @param props - framework standard kit（session-scope slot: the runtime
 *  merges `SessionStandardProps` — `sessionId` is the framework-resolved
 *  current session id; the one-click investigation channel dispatches
 *  INTO it）+ the one-click channel test seam（the production default
 *  = the DSH built-in `commands/execute` gateway carrier — zero new
  *  RPCs）.
 * @returns the cockpit element.
 */
export interface ResearchCockpitProps {
  /** The framework-resolved current host session id（session-scope slot
   *  standard kit — the one-click investigation dispatches into this
   *  session's composer; undefined only in the no-session edge, where
   *  the one-click fails loud instead of guessing a target）. */
  readonly sessionId?: string
  /** WP-7.4 one-click investigation channel（test seam — the production
   *  default is the built-in `commands/execute` gateway over the current
   *  `sessionId`). Resolves to the command's success text（the GUI
   *  status line）; rejects on any failure（the GUI fault line）. */
  readonly onInvestigate?: (item: InterventionDto, question: string) => Promise<string>
}

export function ResearchCockpit(props: ResearchCockpitProps): ReactElement {
  // One factory result per tab mount — the store handle never lives at
  // module level (the factory binds the mount-time `researchRpc` facade).
  const store = useMemo(() => createResearchStore(), [])
  // RR-017① — Phase 5/6 切片工厂结果（同 mount 纪律: 工厂非句柄;
  // actions 缺省参数 — objectiveProgress/nextActions/blockers 数据面
  // fail-loud（冻结 13 RPC 无注意力面, WP-5.2 报告口径）; inbox 缺省
  // provider = NOT_WIRED（冻结 13 RPC 无 Inbox 面, WP-6.4 报告口径））。
  const actionsStore = useMemo(() => createActionsSlicesStore(), [])
  const inboxStore = useMemo(() => createInboxSliceStore(), [])
  // WP-7.4 / G7 S1 — 当前宿主会话 id 的 ref 闭包（框架 slot 标准 kit 的
  // `sessionId` 每次渲染现读, 不缓存挂载时的旧值 — 通道执行时读取, 防
  // 会话切换后命令打到旧会话）。ref 在每次渲染同步。
  const sessionIdRef = useRef<string | undefined>(props.sessionId)
  sessionIdRef.current = props.sessionId
  // WP-7.4 / G7 S1c — analysis 切片工厂结果（**生产 provider 已接线**:
  // `createCommandAnalysisDataProvider` 经 DSH 内置 commands/execute
  // 网关域承载宿主消费面, 保存按钮解禁 — 13-RPC 清单零 diff; 保存后
  // 列表刷新 = 生产 store 代码, WP-7.3 钉死 — 页面挂载即消费面在位）。
  const analysisStore = useMemo(
    () => createAnalysisSliceStore({
      dataProvider: createCommandAnalysisDataProvider(() => sessionIdRef.current ?? ''),
    }),
    [],
  )
  const [page, setPage] = useState<CockpitPage>({ kind: 'home' })
  const [selection, setSelection] = useState<DrilldownSelection>(null)
  const [sessionPointer, setSessionPointer] = useState<{ sessionId: string; runId: string } | null>(null)
  // WP-7.4 / G7 S1c — 一键调查成功后记录的被启动调查会话 id（调查员页
  // 面板绑定它; 导航栏直接进入时回落当前会话 — 诚实透出, 不虚构绑定）。
  const [investigatorSession, setInvestigatorSession] = useState<string | null>(null)

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

  // WP-7.4 / G7 S1b — the one-click investigation channel（生产默认 =
  // DSH 内置 commands/execute 网关域; 测试经 props 注入替身）。成功后
  // 记录被启动的调查会话并跳入调查员页（面板绑定该会话 — S1c 消费面）。
  const defaultInvestigate = async (item: InterventionDto, question: string): Promise<string> => {
    const outcome = await investigateIntervention({ sessionId: props.sessionId ?? '', interventionId: item.id, question })
    if (!outcome.ok) throw new Error(outcome.message)
    return outcome.message
  }
  const investigate = props.onInvestigate ?? defaultInvestigate
  async function handleInvestigate(item: InterventionDto, question: string): Promise<string> {
    const message = await investigate(item, question)
    // The launched session id（shared single-source parse of the success
    // text — the investigator panel binds to exactly this session）.
    const launched = parseInvestigationSessionId(message)
    if (launched !== null) setInvestigatorSession(launched)
    setPage({ kind: 'investigator' })
    return message
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

      {/* RR-017① — in-tab nav（Phase 5/6 六页注册 — 全用户可达;
          内联样式: cockpit.module.css 不在 WP-6.4 授权路径内, 最小侵入
          只改本文件, 报告「偏离与豁免」§2）。 */}
      <nav
        aria-label="cockpit 导航"
        data-cockpit-nav
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' }}
      >
        {COCKPIT_NAV.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            data-cockpit-nav-item={entry.kind}
            onClick={() => {
              setSelection(null)
              setPage({ kind: entry.kind } as Extract<CockpitPage, { readonly kind: PlainPageKind }>)
            }}
            style={{
              font: 'inherit',
              fontSize: 13,
              padding: '4px 12px',
              borderRadius: 6,
              border: page.kind === entry.kind ? '1px solid var(--dsw-alias-state-business-primary)' : '1px solid var(--dsw-alias-border-l2)',
              background: page.kind === entry.kind ? 'var(--dsw-alias-interactive-bg-hover)' : 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-label-primary)',
              cursor: 'pointer',
            }}
          >
            {entry.label}
          </button>
        ))}
      </nav>

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

      {/* RR-017① — Phase 5 五页 + Phase 6 Inbox 页（数据面各随所属 WP
          交付状态: 冻结 13 RPC 面 fail-loud 的页面在视图内大声点名缺口,
          绝不伪造数据 — WP-5.2/WP-6.4 报告口径）。 */}
      {page.kind === 'intervention' && (
        <section className={styles.page} aria-label="干预分组页">
          <h1 className={styles.pageTitle}>
            <button type="button" className={styles.backButton} onClick={() => setPage({ kind: 'home' })}>
              ← 返回
            </button>{' '}
            干预分组
          </h1>
          <InterventionGroupsView store={store} onOpenWorkstream={openWs} onInvestigate={handleInvestigate} />
        </section>
      )}

      {page.kind === 'actions' && (
        <section className={styles.page} aria-label="行动页">
          <h1 className={styles.pageTitle}>
            <button type="button" className={styles.backButton} onClick={() => setPage({ kind: 'home' })}>
              ← 返回
            </button>{' '}
            下一步行动 · 阻碍 · 目标
          </h1>
          <ActionsViewContainer store={actionsStore} />
        </section>
      )}

      {page.kind === 'reporting' && (
        <section className={styles.page} aria-label="汇报页">
          <h1 className={styles.pageTitle}>
            <button type="button" className={styles.backButton} onClick={() => setPage({ kind: 'home' })}>
              ← 返回
            </button>{' '}
            沟通与日程
          </h1>
          <ReportingView store={store} />
        </section>
      )}

      {page.kind === 'attention' && (
        <section className={styles.page} aria-label="注意力页">
          <h1 className={styles.pageTitle}>
            <button type="button" className={styles.backButton} onClick={() => setPage({ kind: 'home' })}>
              ← 返回
            </button>{' '}
            注意力
          </h1>
          <AttentionView store={store} />
        </section>
      )}

      {page.kind === 'brief' && (
        <section className={styles.page} aria-label="简报页">
          <h1 className={styles.pageTitle}>
            <button type="button" className={styles.backButton} onClick={() => setPage({ kind: 'home' })}>
              ← 返回
            </button>{' '}
            研究简报
          </h1>
          <BriefView store={store} />
        </section>
      )}

      {page.kind === 'inbox' && (
        <section className={styles.page} aria-label="研究收件箱页">
          <h1 className={styles.pageTitle}>
            <button type="button" className={styles.backButton} onClick={() => setPage({ kind: 'home' })}>
              ← 返回
            </button>{' '}
            研究收件箱
          </h1>
          <InboxViewContainer store={inboxStore} />
        </section>
      )}

      {/* WP-7.4 / G7 S1c — 调查员页（AnalysisRecord GUI 消费面 —
          最小 bar: 调查视图列表在保存后自动刷新, 生产 store 代码,
          WP-7.3 钉死）。绑定会话: 一键调查成功后的被启动调查会话
          （investigatorSession）; 导航栏直接进入时回落当前宿主会话
          （诚实透出 — 无会话 = 大声点名缺口, 不虚构绑定）。 */}
      {page.kind === 'investigator' && (
        <section className={styles.page} aria-label="调查员页">
          <h1 className={styles.pageTitle}>
            <button type="button" className={styles.backButton} onClick={() => setPage({ kind: 'home' })}>
              ← 返回
            </button>{' '}
            调查员（transient 分析 + 显式保存）
          </h1>
          {(investigatorSession ?? props.sessionId) === undefined ? (
            <p className={styles.empty} role="alert">
              当前无宿主会话 id（session 作用域插槽未解析出 sessionId — 先打开一个宿主会话）—
              调查员面板不可用
            </p>
          ) : (
            <InvestigatorViewContainer store={analysisStore} sessionId={investigatorSession ?? props.sessionId!} />
          )}
        </section>
      )}
    </div>
  )
}
