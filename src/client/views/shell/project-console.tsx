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
import { useMemo, useSyncExternalStore, useState, type ReactElement } from 'react'
import { createResearchStore, type ResearchStore } from '../../stores/index.js'
import type { UpdateProjectMetadataArgs } from '../../../shared/rpc-contracts.js'
import { extractResearchErrorCarrier } from '../../util/error-carrier.js'
import { type DrilldownSelection } from '../drilldown/drilldown-view.js'
import { WorkstreamPage } from '../drilldown/cockpit.js'
import { TopicPage } from '../drilldown/topic-page.js'
import { HistoryTimelineView } from '../history/HistoryTimelineView.js'
import { ProjectPage } from '../project/ProjectPage.js'
// The V1 cockpit's page chrome (banner / back button / page frame) is
// reused verbatim — the console IS the same page set, minus the nav bar.
import styles from '../drilldown/cockpit.module.css'
// V2-UI-0.4 UI-2 — the metadata dialog reuses the shell's dialog chrome.
import dialogStyles from './shell.module.css'

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

/* -------------------------------------------------------------------- *
 * V2-UI-0.4 UI-2 — the project metadata edit dialog (the 5 frozen
 * project.yaml fields: title / description / importance / attention_mode
 * / target_date). Minimal by ruling: it is the ONE store-mutation face
 * of the console beyond the page loads; `store.updateProjectMetadata`
 * performs the RMW merge on the host (omitted fields keep their on-disk
 * value), so the dialog sends ONLY the fields the user changed.
 * -------------------------------------------------------------------- */

/** The dialog's prefill projection (the project payload slice it needs). */
interface ProjectMetadataInitial {
  readonly title: string
  readonly description: string | null
  readonly importance: number
  readonly attentionMode: 'FOCUS' | 'NORMAL' | 'BACKGROUND'
  /** `YYYY-MM-DD` (converted from the snapshot's epoch-ms targetDate). */
  readonly targetDate: string | null
}

/** Epoch ms → `YYYY-MM-DD` (UTC — the yaml stores calendar dates). */
function epochToYmd(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function ProjectMetadataDialog(props: {
  readonly initial: ProjectMetadataInitial
  /** The store mutation (D5: `store.updateProjectMetadata` — resolves the
   *  wire result, rejects on any failure; the project slice re-fetch on
   *  success is the store's job, not the view's). */
  readonly onSave: (args: UpdateProjectMetadataArgs) => Promise<unknown>
  readonly onClose: () => void
}): ReactElement {
  const { initial, onSave, onClose } = props
  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description ?? '')
  const [importance, setImportance] = useState(String(initial.importance))
  const [attentionMode, setAttentionMode] = useState<'FOCUS' | 'NORMAL' | 'BACKGROUND'>(initial.attentionMode)
  const [targetDate, setTargetDate] = useState(initial.targetDate ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A field is "changed" when it differs from the prefill; the changed
  // fields are the ONLY ones sent (the RMW merge keeps the rest).
  const titleChanged = title.trim() !== '' && title.trim() !== initial.title
  const descriptionChanged = description !== (initial.description ?? '')
  const importanceChanged = importance !== String(initial.importance)
  const attentionChanged = attentionMode !== initial.attentionMode
  // targetDate CANNOT be cleared through the wire (the Args carry no null
  // arm — clearing is a no-op the dialog discards, disclosed in the note).
  const targetDateChanged = targetDate !== '' && targetDate !== (initial.targetDate ?? '')
  const changed = titleChanged || descriptionChanged || importanceChanged || attentionChanged || targetDateChanged

  const confirm = async (): Promise<void> => {
    if (busy || !changed || title.trim() === '' || title.length > 200) return
    const args: UpdateProjectMetadataArgs = {
      ...(titleChanged ? { title: title.trim() } : {}),
      ...(descriptionChanged ? { description } : {}),
      ...(importanceChanged ? { importance: Number(importance) } : {}),
      ...(attentionChanged ? { attentionMode } : {}),
      ...(targetDateChanged ? { targetDate } : {}),
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(args)
      onClose()
    } catch (err) {
      // NOTE-4: the code rides the message prefix (the gateway folds
      // error.code to 'internal'); machine-match the carrier, raw-text
      // fallback.
      const message = err instanceof Error ? err.message : String(err)
      const carrier = extractResearchErrorCarrier(message)
      setError(carrier !== null ? carrier.detail : message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={dialogStyles.dialogOverlay} role="dialog" aria-modal="true" aria-label="编辑项目元数据" data-metadata-dialog>
      <div className={dialogStyles.dialogPanel}>
        <h3 className={dialogStyles.dialogTitle}>编辑项目元数据</h3>
        <label className={dialogStyles.dialogField} htmlFor="meta-title">
          项目标题（必填，1–200 字）
        </label>
        <input
          id="meta-title"
          className={dialogStyles.dialogInput}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-meta-title
        />
        <label className={dialogStyles.dialogField} htmlFor="meta-description">
          项目简介
        </label>
        <textarea
          id="meta-description"
          className={dialogStyles.dialogInput}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          data-meta-description
        />
        <label className={dialogStyles.dialogField} htmlFor="meta-importance">
          重要度（1–5）
        </label>
        <select
          id="meta-importance"
          className={dialogStyles.dialogInput}
          value={importance}
          onChange={(e) => setImportance(e.target.value)}
          data-meta-importance
        >
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="5">5</option>
        </select>
        <label className={dialogStyles.dialogField} htmlFor="meta-attention">
          注意力模式
        </label>
        <select
          id="meta-attention"
          className={dialogStyles.dialogInput}
          value={attentionMode}
          onChange={(e) => setAttentionMode(e.target.value as 'FOCUS' | 'NORMAL' | 'BACKGROUND')}
          data-meta-attention
        >
          <option value="FOCUS">聚焦</option>
          <option value="NORMAL">常规</option>
          <option value="BACKGROUND">后台</option>
        </select>
        <label className={dialogStyles.dialogField} htmlFor="meta-target-date">
          目标日期（YYYY-MM-DD，暂不支持清空）
        </label>
        <input
          id="meta-target-date"
          className={dialogStyles.dialogInput}
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          data-meta-target-date
        />
        {error !== null && (
          <p className={dialogStyles.missingError} role="alert" data-meta-error>
            {error}
          </p>
        )}
        <div className={dialogStyles.dialogActions}>
          <button type="button" className={dialogStyles.dialogCancel} disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={dialogStyles.dialogConfirm}
            disabled={busy || !changed || title.trim() === '' || title.length > 200}
            onClick={() => void confirm()}
            data-meta-confirm
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
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
  // V2-UI-0.4 UI-2 — the project slice the 编辑项目元数据 affordance needs
  // (the console subscribes ONLY to this slice — the immutable store
  // discipline keeps its reference stable across other slices' commits).
  const [metaOpen, setMetaOpen] = useState(false)
  const projectSlice = useSyncExternalStore(store.subscribe, () => store.getState().project)

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
        <>
          <ProjectPage
            store={store}
            onOpenTopic={(topicId) => {
              setSelection(null)
              setPage({ kind: 'topic', topicId })
            }}
            onBack={onBackToWall}
          />
          {/* V2-UI-0.4 UI-2 — the 编辑项目元数据 affordance (visible only
              once the project slice has data — the dialog prefills from
              it). ADDITIVE chrome; the page itself is untouched. */}
          {projectSlice.data !== null && (
            <button
              type="button"
              className={styles.backButton}
              onClick={() => setMetaOpen(true)}
              data-project-edit-metadata
            >
              编辑项目元数据
            </button>
          )}
        </>
      )}

      {page.kind === 'project' && metaOpen && projectSlice.data !== null && (
        <ProjectMetadataDialog
          initial={{
            title: projectSlice.data.project.title,
            description: projectSlice.data.project.description,
            importance: projectSlice.data.project.importance,
            attentionMode: projectSlice.data.project.attentionMode,
            targetDate: projectSlice.data.project.targetDate !== null ? epochToYmd(projectSlice.data.project.targetDate) : null,
          }}
          onSave={(args) => store.updateProjectMetadata({ ...args, projectId: projectSlice.data !== null ? projectSlice.data.project.id : undefined })}
          onClose={() => setMetaOpen(false)}
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
