/**
 * V2-UI-0.4 UI-3 (D2) — the shared 新建研究项目 / 绑定已有目录 journey
 * dialogs, extracted from `onboarding-card.tsx` (V2-UI-0.4 UI-2, where
 * they were inline state machines) so the HUB Portfolio header
 * (B §4.2 `Portfolio [Create] [Bind]`) and the B §4.6 empty state open
 * the SAME UI-2C journeys — one implementation, two seats.
 *
 * The extraction is DOM-verbatim: every `data-*` attribute, class name
 * and text node is byte-identical to the UI-2 inline journeys, so the
 * onboarding test suite (which pins the journeys through the DOM) passes
 * unchanged against `OnboardingCard` re-rendering these components.
 *
 * Control model: the PARENT mounts the dialog (open = rendered, closed =
 * unmounted). A fresh mount IS the open-time state reset (the inline
 * `openCreate` / `openBind` resets are replaced by unmount/remount).
 *
 * INV-PERM-5: pure props/React — no @deepseek-ai import; the mutation
 * faces are plain business promises (resolve the strict wire result,
 * reject on any failure — the view never sees a `RemoteResult`).
 */

import { useState, type ReactElement } from 'react'

import type {
  BindProjectArgs,
  BindProjectResult,
  CreateLocalResearchProjectArgs,
  CreateLocalResearchProjectFailureResult,
  CreateLocalResearchProjectResult,
  CreateLocalResearchProjectWireStep,
  InspectProjectDirectoryArgs,
  InspectProjectDirectoryResult,
} from '../../../shared/rpc-contracts.js'

import { extractResearchErrorCarrier } from '../../util/error-carrier.js'
import styles from './shell.module.css'

/** The folder name a wsPath binds under by default (design §8: 默认文件夹名). */
export function folderNameOf(wsPath: string): string {
  const parts = wsPath.split(/[\\/]/).filter((p) => p !== '')
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

/** V2-UI-0.4 UI-2 — the frozen B spec Step 4 status lines, in kernel-step
 *  order (the create chain order: mkdir → gitInit → scaffold → metadata →
 *  register). The ✓/✗/○ mark is rendered separately; the line text is
 *  VERBATIM frozen copy. */
const CREATE_STATUS_LINES: readonly { readonly step: CreateLocalResearchProjectWireStep; readonly line: string }[] = [
  { step: 'mkdir', line: 'Directory created' },
  { step: 'gitInit', line: 'Git initialized' },
  { step: 'scaffold', line: 'Research structure initialized' },
  { step: 'metadata', line: 'Runtime store initialized' },
  { step: 'register', line: 'Project registered' },
]

/**
 * The 新建研究项目 (Create) journey — the frozen B spec 5 steps
 * (Step 1: Location → Step 2: Project metadata → Step 3: Confirm →
 * Step 4: Initialize → Step 5: Enter Project).
 *
 * @param props - `wsPath` is the session's working directory (the
 *  dialog only mounts when the session HAS one — the parent gates the
 *  open affordance); `createLocalResearchProject` is the required
 *  initialize face (the parent only mounts when it is wired);
 *  `onApplied` fires on Step 5 「进入项目」 (the post-mutation
 *  plane-state re-fetch — the parent unmounts the dialog in the same
 *  tick). The frozen wizard has NO cancel-out path (the step-4 取消
 *  returns to Step 3) — the dialog closes only through 进入项目.
 */
export function CreateProjectDialog(props: {
  readonly wsPath: string
  readonly dirNames: { readonly treeDir: string; readonly hubDir: string }
  readonly createLocalResearchProject: (
    args: CreateLocalResearchProjectArgs,
  ) => Promise<CreateLocalResearchProjectResult>
  readonly onApplied: () => void
}): ReactElement {
  const { wsPath, dirNames, createLocalResearchProject, onApplied } = props
  // 1..5 = the frozen B spec steps (the dialog always mounts at Step 1 —
  // a fresh mount is the open-time reset).
  const [createStep, setCreateStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  // Step 2 metadata form. The optional fields stay '' until touched: an
  // empty field is OMITTED from the RPC args, so the host defaults apply
  // (importance 3 / attention_mode NORMAL, frozen project.schema.json).
  const [createTitle, setCreateTitle] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createImportance, setCreateImportance] = useState('')
  const [createAttention, setCreateAttention] = useState<'' | 'FOCUS' | 'NORMAL' | 'BACKGROUND'>('')
  const [createTargetDate, setCreateTargetDate] = useState('')
  // Step 4 (Initialize) in-flight (the create RPC).
  const [createBusy, setCreateBusy] = useState(false)
  // Step 4 PRE-CHECK failure (the face REJECTED: the PLANE_* rungs /
  // LP_INPUT / LP_PARENT_INVALID / LP_DIR_EXISTS — no step started, no
  // partial change). NOTE-4: the code rides the message prefix, never
  // error.code; the carrier is machine-matched, raw text is the fallback.
  const [createError, setCreateError] = useState<string | null>(null)
  // Step 4 STEP-FAILURE DTO (the face RESOLVED with the ok:false arm —
  // the frozen three-stage contract: completed steps + failed step +
  // partial-change note; there is NO rollback engine, frozen ruling).
  const [createFailure, setCreateFailure] = useState<CreateLocalResearchProjectFailureResult | null>(null)
  // The 打开目录 affordance has no host open-channel (the client cannot
  // open a host folder) — showing the path IS the affordance.
  const [createFolderShown, setCreateFolderShown] = useState(false)
  // Step 5 success fact (the registered project id).
  const [createProjectId, setCreateProjectId] = useState<string | null>(null)

  /** Step 2 → Step 3 gate (the frozen title contract: 1–200 chars). */
  const createTitleValid = createTitle.trim().length >= 1 && createTitle.length <= 200

  /** Step 3 → Step 4 → (success) Step 5: fire the create RPC.
   *
   *  SUCCESS arm → all five steps completed → Step 5 (Enter Project).
   *  FAILURE arm (RESOLVED, ok:false) → the three-stage partial-change
   *  state: completed ✓ lines, the failed step ✗, the partial-change
   *  note, Retry / Open folder / Cancel (frozen B spec).
   *  REJECTION (pre-check: PLANE_* rungs / LP_INPUT / LP_PARENT_INVALID /
   *  LP_DIR_EXISTS — no step started) → the NOTE-4 carrier line +
   *  Retry / Cancel. */
  const runCreate = async (): Promise<void> => {
    // Empty optional fields are OMITTED (the host defaults apply).
    const args: CreateLocalResearchProjectArgs = {
      wsPath,
      title: createTitle.trim(),
      ...(createDescription.trim() !== '' ? { description: createDescription.trim() } : {}),
      ...(createImportance !== '' ? { importance: Number(createImportance) } : {}),
      ...(createAttention !== '' ? { attentionMode: createAttention } : {}),
      ...(createTargetDate !== '' ? { targetDate: createTargetDate } : {}),
    }
    setCreateBusy(true)
    setCreateError(null)
    setCreateFailure(null)
    try {
      const result = await createLocalResearchProject(args)
      if (result.ok) {
        setCreateProjectId(result.projectId)
        setCreateStep(5)
      } else {
        setCreateFailure(result)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const carrier = extractResearchErrorCarrier(message)
      setCreateError(carrier !== null ? carrier.detail : message)
    } finally {
      setCreateBusy(false)
    }
  }

  /** Step 5 (Enter Project) → the post-mutation plane-state re-fetch
   *  (the role flips to MANAGED/STANDALONE — the project console renders). */
  const enterCreatedProject = (): void => {
    onApplied()
  }

  return (
    <div
      className={styles.dialogOverlay}
      role="dialog"
      aria-modal="true"
      aria-label="新建研究项目"
      data-onboarding-create
      data-create-step={createStep}
    >
      <div className={styles.dialogPanel}>
        <h3 className={styles.dialogTitle}>
          {createStep === 1
            ? 'Step 1: Location'
            : createStep === 2
              ? 'Step 2: Project metadata'
              : createStep === 3
                ? 'Step 3: Confirm'
                : createStep === 4
                  ? 'Step 4: Initialize'
                  : 'Step 5: Enter Project'}
        </h3>

        {createStep === 1 && (
          <p className={styles.dialogCopy} data-create-location>
            项目将创建在当前会话工作区 <code>{wsPath}</code> 下（研究目录 <code>{dirNames.treeDir}/</code>，
            并注册进研究管理系统）。
          </p>
        )}

        {createStep === 2 && (
          <>
            <label className={styles.dialogField} htmlFor="create-title">
              项目标题（必填，1–200 字）
            </label>
            <input
              id="create-title"
              className={styles.dialogInput}
              type="text"
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              data-create-title
            />
            <label className={styles.dialogField} htmlFor="create-description">
              项目简介（可选）
            </label>
            <textarea
              id="create-description"
              className={styles.dialogInput}
              rows={3}
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
              data-create-description
            />
            <label className={styles.dialogField} htmlFor="create-importance">
              重要度（可选，1–5，留空默认 3）
            </label>
            <select
              id="create-importance"
              className={styles.dialogInput}
              value={createImportance}
              onChange={(e) => setCreateImportance(e.target.value)}
              data-create-importance
            >
              <option value="">未设置</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
            </select>
            <label className={styles.dialogField} htmlFor="create-attention">
              注意力模式（可选，留空默认 常规）
            </label>
            <select
              id="create-attention"
              className={styles.dialogInput}
              value={createAttention}
              onChange={(e) => setCreateAttention(e.target.value as '' | 'FOCUS' | 'NORMAL' | 'BACKGROUND')}
              data-create-attention
            >
              <option value="">未设置</option>
              <option value="FOCUS">聚焦</option>
              <option value="NORMAL">常规</option>
              <option value="BACKGROUND">后台</option>
            </select>
            <label className={styles.dialogField} htmlFor="create-target-date">
              目标日期（可选，YYYY-MM-DD）
            </label>
            <input
              id="create-target-date"
              className={styles.dialogInput}
              type="date"
              value={createTargetDate}
              onChange={(e) => setCreateTargetDate(e.target.value)}
              data-create-target-date
            />
          </>
        )}

        {createStep === 3 && (
          <>
            <ul className={styles.dialogCopy} data-create-summary>
              <li>位置：<code>{wsPath}</code></li>
              <li>标题：{createTitle.trim()}</li>
              {createDescription.trim() !== '' && <li>简介：{createDescription.trim()}</li>}
              {createImportance !== '' && <li>重要度：{createImportance}</li>}
              {createAttention !== '' && (
                <li>注意力：{createAttention === 'FOCUS' ? '聚焦' : createAttention === 'BACKGROUND' ? '后台' : '常规'}</li>
              )}
              {createTargetDate !== '' && <li>目标日期：{createTargetDate}</li>}
            </ul>
            {/* B §5.5: the "将执行" side-effect enumeration (verbatim wireframe copy) */}
            <p className={styles.dialogCopy} data-create-effects-title>
              将执行
            </p>
            <ul className={styles.dialogCopy} data-create-effects>
              <li>创建目录</li>
              <li>git init</li>
              <li>初始化 Research Control</li>
              <li>注册 Project</li>
            </ul>
          </>
        )}

        {createStep === 4 && (
          <>
            {createError !== null && (
              <p className={styles.missingError} role="alert" data-create-error>
                {createError}
              </p>
            )}
            {createFailure !== null && (
              <p className={styles.missingError} role="alert" data-create-failure>
                {createFailure.detail}
              </p>
            )}
            {/* The frozen Step 4 status lines: ✓ = completed,
                ✗ = the failed step, ○ = not reached. */}
            <ul className={styles.dialogCopy} data-create-status>
              {CREATE_STATUS_LINES.map(({ step, line }) => {
                const failed = createFailure !== null && createFailure.failedStep === step
                const done =
                  createFailure === null ? false : createFailure.completedSteps.includes(step)
                return (
                  <li
                    key={step}
                    className={styles.statusLine}
                    data-create-line={step}
                    data-create-line-state={failed ? 'failed' : done ? 'done' : 'pending'}
                  >
                    {failed ? '✗' : done ? '✓' : '○'} {line}
                  </li>
                )
              })}
            </ul>
            {createFailure !== null && createFailure.partialChangeNote !== '' && (
              <p className={styles.dialogCopy} data-create-partial-note>
                {createFailure.partialChangeNote}
              </p>
            )}
            {createFolderShown && (
              <p className={styles.dialogCopy} data-create-folder>
                目录路径：<code>{wsPath}</code>
              </p>
            )}
          </>
        )}

        {createStep === 5 && (
          <p className={styles.dialogCopy} data-create-done>
            项目已创建并注册：{createProjectId ?? 'PRJ-?'}。
          </p>
        )}

        <div className={styles.dialogActions}>
          {createStep === 1 && (
            <button type="button" className={styles.dialogConfirm} onClick={() => setCreateStep(2)}>
              下一步
            </button>
          )}
          {createStep === 2 && (
            <>
              <button type="button" className={styles.dialogCancel} onClick={() => setCreateStep(1)}>
                上一步
              </button>
              <button
                type="button"
                className={styles.dialogConfirm}
                disabled={!createTitleValid}
                onClick={() => setCreateStep(3)}
              >
                下一步
              </button>
            </>
          )}
          {createStep === 3 && (
            <>
              <button type="button" className={styles.dialogCancel} onClick={() => setCreateStep(2)}>
                上一步
              </button>
              <button
                type="button"
                className={styles.dialogConfirm}
                onClick={() => {
                  // Step 3 → Step 4 FIRES the create RPC (the frozen B
                  // spec: Confirm → Initialize). The wizard is stuck on
                  // 初始化中… until runCreate settles — success → Step 5,
                  // failure arm / rejection → the Step-4 error state.
                  setCreateStep(4)
                  void runCreate()
                }}
              >
                下一步
              </button>
            </>
          )}
          {createStep === 4 && (
            <>
              {createError !== null || createFailure !== null ? (
                <>
                  <button type="button" className={styles.dialogCancel} onClick={() => setCreateStep(3)}>
                    取消
                  </button>
                  <button
                    type="button"
                    className={styles.retryButton}
                    onClick={() => setCreateFolderShown(true)}
                    data-create-open-folder
                  >
                    打开目录
                  </button>
                  <button type="button" className={styles.dialogConfirm} disabled={createBusy} onClick={() => void runCreate()}>
                    Retry
                  </button>
                </>
              ) : (
                <p className={styles.dialogCopy} role="status">
                  初始化中…
                </p>
              )}
            </>
          )}
          {createStep === 5 && (
            <button type="button" className={styles.dialogConfirm} onClick={enterCreatedProject} data-create-enter>
              进入项目
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The 绑定已有目录 (Bind) journey — the frozen B spec 4-state flow
 * (Select directory → Inspect → Show detected state → Confirm action →
 * Bind / Initialize missing pieces → Enter Project).
 *
 * @param props - `wsPath` is the session's working directory (the dialog
 *  only mounts when the session HAS one); the two faces are REQUIRED
 *  (the parent only mounts when they are wired); `onApplied` fires on a
 *  successful bind (the post-mutation plane-state re-fetch — the parent
 *  unmounts in the same tick); `onClosed` fires on EVERY cancel-out
 *  (the parent unmounts; no RPC fired, state unchanged).
 */
export function BindProjectDialog(props: {
  readonly wsPath: string
  readonly inspectProjectDirectory: (
    args: InspectProjectDirectoryArgs,
  ) => Promise<InspectProjectDirectoryResult>
  readonly bindProject: (args: BindProjectArgs) => Promise<BindProjectResult>
  readonly onApplied: () => void
  readonly onClosed: () => void
}): ReactElement {
  const { wsPath, inspectProjectDirectory, bindProject, onApplied, onClosed } = props
  // 'select' = the mounted start (a fresh mount is the open-time reset —
  // the inspect result starts null, the displayName is prefilled with
  // the folder name).
  const [bindPhase, setBindPhase] = useState<'select' | 'detected' | 'confirm'>('select')
  // The inspect RPC in-flight.
  const [inspectBusy, setInspectBusy] = useState(false)
  // The bindProject RPC in-flight (the Confirm-action execution).
  const [bindBusy, setBindBusy] = useState(false)
  // The last inspect result (the detected state).
  const [inspectResult, setInspectResult] = useState<InspectProjectDirectoryResult | null>(null)
  // Inspect / bind failures (carrier-extracted, raw-text fallback).
  const [inspectError, setInspectError] = useState<string | null>(null)
  const [bindError, setBindError] = useState<string | null>(null)
  // The Bind confirm displayName (prefilled: the tree title for
  // RC_PROJECT, the folder name otherwise — the T4.2 default rule).
  const [bindDisplayName, setBindDisplayName] = useState(folderNameOf(wsPath))

  /** Select-directory → Inspect: fire the inspect face (plane-level). */
  const runInspect = async (): Promise<void> => {
    setInspectBusy(true)
    setInspectError(null)
    try {
      const result = await inspectProjectDirectory({ wsPath })
      setInspectResult(result)
      // RC_PROJECT prefill: the tree's own title (the name it re-binds
      // under); the other states keep the folder-name default.
      if (result.state === 'RC_PROJECT' && result.title !== undefined) {
        setBindDisplayName(result.title)
      }
      setBindPhase('detected')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const carrier = extractResearchErrorCarrier(message)
      setInspectError(carrier !== null ? carrier.detail : message)
    } finally {
      setInspectBusy(false)
    }
  }

  /** Show-detected-state → Confirm action (the frozen per-state button). */
  const proceedBindAction = (): void => {
    if (inspectResult === null || inspectResult.state === 'INCOMPATIBLE') return
    setBindError(null)
    setBindPhase('confirm')
  }

  /** The detected-state action label (the frozen B spec copy — one per
   *  state; INCOMPATIBLE offers NO action, only the reason). */
  const bindActionLabel =
    inspectResult === null
      ? ''
      : inspectResult.state === 'RC_PROJECT'
        ? 'Bind'
        : inspectResult.state === 'GIT_ONLY'
          ? 'Initialize and Bind'
          : inspectResult.state === 'PLAIN_DIR'
            ? 'Initialize Git + Research Control'
            : ''

  /** Confirm action → execute: bindProject with the state-appropriate
   *  scaffold flag. RC_PROJECT → scaffold: false (the tree EXISTS — the
   *  host refuses scaffold:true over a live tree, PLANE_TREE_EXISTS);
   *  GIT_ONLY / PLAIN_DIR → scaffold: true (initialize the missing
   *  pieces). Success → the plane-state re-fetch (Enter Project). */
  const runBind = async (): Promise<void> => {
    if (inspectResult === null || bindDisplayName.trim() === '') return
    const scaffold = inspectResult.state !== 'RC_PROJECT'
    setBindBusy(true)
    setBindError(null)
    try {
      await bindProject({ wsPath, displayName: bindDisplayName.trim(), scaffold })
      onApplied()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const carrier = extractResearchErrorCarrier(message)
      setBindError(carrier !== null ? carrier.detail : message)
    } finally {
      setBindBusy(false)
    }
  }

  return (
    <div
      className={styles.dialogOverlay}
      role="dialog"
      aria-modal="true"
      aria-label="绑定已有目录"
      data-onboarding-bind
      data-bind-phase={bindPhase}
    >
      <div className={styles.dialogPanel}>
        <h3 className={styles.dialogTitle}>绑定已有目录</h3>

        {bindPhase === 'select' && (
          <>
            <p className={styles.dialogCopy} data-bind-select>
              选择目录：当前会话工作区 <code>{wsPath}</code>（点击「检查目录」读取其状态）。
            </p>
            {/* A failed inspect stays on the select phase — the NOTE-4
                carrier detail (or the raw message) shows HERE. */}
            {inspectError !== null && (
              <p className={styles.missingError} role="alert" data-bind-inspect-error>
                {inspectError}
              </p>
            )}
          </>
        )}

        {bindPhase === 'detected' && inspectResult !== null && (
          <>
            <p className={styles.dialogCopy} data-bind-state={inspectResult.state}>
              {inspectResult.message}
            </p>
            {/* F6a: the informational detected-state detail (e.g. "Git is
                not initialized.") carries the dialogCopy class, not the
                error style (a real error keeps missingError + role=alert). */}
            {inspectResult.detail !== null && (
              <p className={styles.dialogCopy} data-bind-detail>
                {inspectResult.detail}
              </p>
            )}
          </>
        )}

        {bindPhase === 'confirm' && (
          <>
            <p className={styles.dialogCopy} data-bind-confirm-copy>
              {inspectResult !== null && inspectResult.state === 'RC_PROJECT'
                ? '将把该目录登记为研究项目（不改动已有研究目录）。'
                : inspectResult !== null && inspectResult.state === 'GIT_ONLY'
                  ? '将在该目录初始化研究管理结构，然后登记为研究项目（保留已有 Git 仓库）。'
                  : '将初始化 Git 仓库与研究管理结构，然后登记为研究项目。'}
            </p>
            <label className={styles.dialogField} htmlFor="bind-display-name">
              项目显示名
            </label>
            <input
              id="bind-display-name"
              className={styles.dialogInput}
              type="text"
              value={bindDisplayName}
              onChange={(e) => setBindDisplayName(e.target.value)}
              data-bind-display-name
            />
            {bindError !== null && (
              <p className={styles.missingError} role="alert" data-bind-error>
                {bindError}
              </p>
            )}
          </>
        )}

        <div className={styles.dialogActions}>
          {bindPhase === 'select' && (
            <>
              <button type="button" className={styles.dialogCancel} onClick={onClosed}>
                取消
              </button>
              <button
                type="button"
                className={styles.dialogConfirm}
                disabled={inspectBusy}
                onClick={() => void runInspect()}
                data-bind-inspect
              >
                {inspectBusy ? '检查中…' : '检查目录'}
              </button>
            </>
          )}
          {bindPhase === 'detected' && (
            <>
              <button type="button" className={styles.dialogCancel} onClick={onClosed}>
                取消
              </button>
              {inspectError === null && inspectResult !== null && inspectResult.state !== 'INCOMPATIBLE' && (
                <button
                  type="button"
                  className={styles.dialogConfirm}
                  onClick={proceedBindAction}
                  data-bind-action
                >
                  {bindActionLabel}
                </button>
              )}
              {inspectResult !== null && inspectResult.state === 'INCOMPATIBLE' && (
                <p className={styles.dialogCopy} data-bind-incompatible-note>
                  该目录与本研究平面不兼容。请人工检查后重试（本流程不做自动修复）。
                </p>
              )}
            </>
          )}
          {bindPhase === 'confirm' && (
            <>
              <button type="button" className={styles.dialogCancel} disabled={bindBusy} onClick={() => setBindPhase('detected')}>
                上一步
              </button>
              <button
                type="button"
                className={styles.dialogConfirm}
                disabled={bindBusy || bindDisplayName.trim() === ''}
                onClick={() => void runBind()}
                data-bind-execute
              >
                {bindBusy ? '处理中…' : bindActionLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
