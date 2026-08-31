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

import { t } from '../../i18n/copy.js'
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
      aria-label={t('journey.createTitle')}
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
            {t('journey.createLocation', { dir: wsPath, tree: `${dirNames.treeDir}/` })}
          </p>
        )}

        {createStep === 2 && (
          <>
            <label className={styles.dialogField} htmlFor="create-title">
              {t('journey.titleLabel')}
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
              {t('journey.descriptionLabel')}
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
              {t('journey.importanceLabel')}
            </label>
            <select
              id="create-importance"
              className={styles.dialogInput}
              value={createImportance}
              onChange={(e) => setCreateImportance(e.target.value)}
              data-create-importance
            >
              <option value="">{t('journey.unset')}</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
            </select>
            <label className={styles.dialogField} htmlFor="create-attention">
              {t('journey.attentionLabel')}
            </label>
            <select
              id="create-attention"
              className={styles.dialogInput}
              value={createAttention}
              onChange={(e) => setCreateAttention(e.target.value as '' | 'FOCUS' | 'NORMAL' | 'BACKGROUND')}
              data-create-attention
            >
              <option value="">{t('journey.unset')}</option>
              <option value="FOCUS">{t('status.focusing')}</option>
              <option value="NORMAL">{t('attention.mode.normal')}</option>
              <option value="BACKGROUND">{t('status.background')}</option>
            </select>
            <label className={styles.dialogField} htmlFor="create-target-date">
              {t('journey.targetDateLabel')}
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
              <li>{t('journey.previewLocation')}<code>{wsPath}</code></li>
              <li>{t('journey.previewTitle', { value: createTitle.trim() })}</li>
              {createDescription.trim() !== '' && <li>{t('journey.previewDescription', { value: createDescription.trim() })}</li>}
              {createImportance !== '' && <li>{t('journey.previewImportance', { value: createImportance })}</li>}
              {createAttention !== '' && (
                <li>{t('journey.previewAttention')}{createAttention === 'FOCUS' ? t('status.focusing') : createAttention === 'BACKGROUND' ? t('status.background') : t('attention.mode.normal')}</li>
              )}
              {createTargetDate !== '' && <li>{t('journey.previewTargetDate', { value: createTargetDate })}</li>}
            </ul>
            {/* B §5.5: the "将执行" side-effect enumeration (verbatim wireframe copy) */}
            <p className={styles.dialogCopy} data-create-effects-title>
              {t('journey.willExecute')}
            </p>
            <ul className={styles.dialogCopy} data-create-effects>
              <li>{t('journey.stepCreateDir')}</li>
              <li>git init</li>
              <li>{t('journey.stepInit')}</li>
              <li>{t('journey.stepRegister')}</li>
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
                {t('journey.dirPathLabel')}<code>{wsPath}</code>
              </p>
            )}
          </>
        )}

        {createStep === 5 && (
          <p className={styles.dialogCopy} data-create-done>
            {t('journey.createdMsg', { id: createProjectId ?? 'PRJ-?' })}
          </p>
        )}

        <div className={styles.dialogActions}>
          {createStep === 1 && (
            <button type="button" className={styles.dialogConfirm} onClick={() => setCreateStep(2)}>
              {t('journey.next')}
            </button>
          )}
          {createStep === 2 && (
            <>
              <button type="button" className={styles.dialogCancel} onClick={() => setCreateStep(1)}>
                {t('journey.back')}
              </button>
              <button
                type="button"
                className={styles.dialogConfirm}
                disabled={!createTitleValid}
                onClick={() => setCreateStep(3)}
              >
                {t('journey.next')}
              </button>
            </>
          )}
          {createStep === 3 && (
            <>
              <button type="button" className={styles.dialogCancel} onClick={() => setCreateStep(2)}>
                {t('journey.back')}
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
                {t('journey.next')}
              </button>
            </>
          )}
          {createStep === 4 && (
            <>
              {createError !== null || createFailure !== null ? (
                <>
                  <button type="button" className={styles.dialogCancel} onClick={() => setCreateStep(3)}>
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className={styles.retryButton}
                    onClick={() => setCreateFolderShown(true)}
                    data-create-open-folder
                  >
                    {t('journey.openDir')}
                  </button>
                  <button type="button" className={styles.dialogConfirm} disabled={createBusy} onClick={() => void runCreate()}>
                    Retry
                  </button>
                </>
              ) : (
                <p className={styles.dialogCopy} role="status">
                  {t('journey.initializing')}
                </p>
              )}
            </>
          )}
          {createStep === 5 && (
            <button type="button" className={styles.dialogConfirm} onClick={enterCreatedProject} data-create-enter>
              {t('journey.enterProject')}
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
      aria-label={t('journey.bindTitle')}
      data-onboarding-bind
      data-bind-phase={bindPhase}
    >
      <div className={styles.dialogPanel}>
        <h3 className={styles.dialogTitle}>{t('journey.bindTitle')}</h3>

        {bindPhase === 'select' && (
          <>
            <p className={styles.dialogCopy} data-bind-select>
              {t('journey.selectDir', { dir: wsPath })}
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
                ? t('journey.bindRegisterPreview')
                : inspectResult !== null && inspectResult.state === 'GIT_ONLY'
                  ? t('journey.bindTreePreview')
                  : t('journey.bindGitPreview')}
            </p>
            <label className={styles.dialogField} htmlFor="bind-display-name">
              {t('settings.displayName')}
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
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={styles.dialogConfirm}
                disabled={inspectBusy}
                onClick={() => void runInspect()}
                data-bind-inspect
              >
                {inspectBusy ? t('journey.inspecting') : t('journey.inspectDir')}
              </button>
            </>
          )}
          {bindPhase === 'detected' && (
            <>
              <button type="button" className={styles.dialogCancel} onClick={onClosed}>
                {t('common.cancel')}
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
                  {t('journey.incompatible')}
                </p>
              )}
            </>
          )}
          {bindPhase === 'confirm' && (
            <>
              <button type="button" className={styles.dialogCancel} disabled={bindBusy} onClick={() => setBindPhase('detected')}>
                {t('journey.back')}
              </button>
              <button
                type="button"
                className={styles.dialogConfirm}
                disabled={bindBusy || bindDisplayName.trim() === ''}
                onClick={() => void runBind()}
                data-bind-execute
              >
                {bindBusy ? t('common.processing') : bindActionLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
