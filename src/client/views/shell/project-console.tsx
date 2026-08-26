/**
 * V2-T5.1 — the 总览 page body for the MANAGED / STANDALONE roles (and
 * the HUB drill target): the V2-narrowed project console.
 *
 * Design §5 (role table) / §6 (信息架构): MANAGED and STANDALONE render
 * the SAME four first-tier entries (总览 / 重要事件 / 调查员 / 设置);
 * their 总览 is the EXISTING project page (brief + 目标 + topic list)
 * AS ROOT — no aggregate strip, no back affordance. The drill chain
 * 项目 → 主题 → 工作流 → 历史 stays inside this component. The frozen
 * 13-RPC contract is project-scoped through the zero-arg getProject
 * route (single active project → it; several → AMBIGUOUS_PROJECT — the
 * drill chain 保持现状 per the frozen contract, see §12.1).
 *
 * HUB drill mode (`onBackToWall` provided): the same console is the
 * drill target of a project card on the 总览 wall; the project page
 * then shows the ← 返回总览 affordance back to the wall.
 *
 * Store: ONE `createResearchStore()` factory result per mount (useMemo —
 * never module-level; the factory reads the mount-bound `researchRpc`
 * facade). Every child receives the handle BY PROPS.
 *
 * Session-open channel: PLACEHOLDER (same contract as the V1 cockpit) —
 * the card's 「在宿主会话列表中打开」 button hands the sessionId to
 * `handleOpenSession`, which records the pointer in a visible banner;
 * a host-side session-open channel can be plugged in later without
 * touching the display layer.
 */
import { useMemo, useState, type ReactElement } from 'react'
import { createResearchStore, type ResearchStore } from '../../stores/index.js'
import { type DrilldownSelection } from '../drilldown/drilldown-view.js'
import { WorkstreamPage } from '../drilldown/cockpit.js'
import { TopicPage } from '../drilldown/topic-page.js'
import { HistoryTimelineView } from '../history/HistoryTimelineView.js'
import { ProjectPage } from '../project/ProjectPage.js'
// The V1 cockpit's page chrome (banner / back button / page frame) is
// reused verbatim — the console IS the same page set, minus the nav bar.
import styles from '../drilldown/cockpit.module.css'

/** The console's page stack (the V2 drill chain, kept inside 总览).
 *
 *  topicId is carried on ws/history pages so the LINEAR back chain
 *  (history → ws → topic → project) can reconstruct each parent page
 *  without a separate history stack. */
type ConsolePage =
  | { readonly kind: 'project' }
  | { readonly kind: 'topic'; readonly topicId: string }
  | { readonly kind: 'ws'; readonly workstreamId: string; readonly topicId: string }
  | { readonly kind: 'history'; readonly workstreamId: string; readonly topicId: string }

export interface ProjectConsoleProps {
  /** HUB drill mode: back from the project page to the 总览 card wall.
   *  Undefined = MANAGED / STANDALONE root mode (the project page IS the
   *  总览 root — no back affordance, no aggregate strip). */
  readonly onBackToWall?: () => void
}

/**
 * The V2-narrowed project console (the 总览 body for MANAGED /
 * STANDALONE; the HUB drill target).
 * @param props - `onBackToWall` selects drill vs. root mode.
 * @returns the console element (project / topic / workstream / history
 *   page + the placeholder session-pointer banner).
 */
export function ProjectConsole({ onBackToWall }: ProjectConsoleProps): ReactElement {
  // One factory result per mount — the store handle never lives at
  // module level (the factory binds the mount-time `researchRpc` facade).
  const store: ResearchStore = useMemo(() => createResearchStore(), [])
  const [page, setPage] = useState<ConsolePage>({ kind: 'project' })
  const [selection, setSelection] = useState<DrilldownSelection>(null)
  const [sessionPointer, setSessionPointer] = useState<{
    readonly sessionId: string
    readonly runId: string
  } | null>(null)

  // The DSH session-open channel (placeholder semantics — see header):
  // the pointer is recorded visibly; a host channel can replace this
  // handler without touching the display layer.
  function handleOpenSession(sessionId: string, runId: string): void {
    setSessionPointer({ sessionId, runId })
  }

  return (
    <div className={styles.cockpit} data-project-console-page={page.kind}>
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

      {page.kind === 'project' && (
        <ProjectPage
          store={store}
          onOpenTopic={(topicId) => {
            setSelection(null)
            setPage({ kind: 'topic', topicId })
          }}
          onBack={onBackToWall}
        />
      )}

      {page.kind === 'topic' && (
        <TopicPage
          store={store}
          topicId={page.topicId}
          onOpenWorkstream={(workstreamId) => {
            setSelection(null)
            setPage({ kind: 'ws', workstreamId, topicId: page.topicId })
          }}
          onBack={() => setPage({ kind: 'project' })}
        />
      )}

      {page.kind === 'ws' && (
        <WorkstreamPage
          store={store}
          workstreamId={page.workstreamId}
          selection={selection}
          onSelect={setSelection}
          onOpenSession={handleOpenSession}
          onOpenHistory={() => setPage({ kind: 'history', workstreamId: page.workstreamId, topicId: page.topicId })}
          onBack={() => setPage({ kind: 'topic', topicId: page.topicId })}
        />
      )}

      {page.kind === 'history' && (
        <section className={styles.page} aria-label="历史时间线页">
          <h1 className={styles.pageTitle}>
            <button
              type="button"
              className={styles.backButton}
              onClick={() => setPage({ kind: 'ws', workstreamId: page.workstreamId, topicId: page.topicId })}
            >
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
