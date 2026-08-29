/**
 * V2-T4.2 — the 引导卡 (onboarding card), extracted from shell.tsx
 * (V2-T5.1) so the empty-hub variant (design §7.1 空中枢 — 「登记第一个
 * 研究项目」 at the card-wall position) reuses the SAME T4.2 bind flow.
 *
 * INV-PERM-5: pure props/React — no @deepseek-ai import; the two mutation
 * faces are plain business promises (resolve the strict wire result,
 * reject on any failure — the view never sees a `RemoteResult`).
 *
 * @param props - `narrowed` selects the NO_CWD 收窄文案 variant (both
 *  buttons disabled, no flow reachable); `wsPath` is the session's working
 *  directory (null only in the narrowed variant); `hub` / `dirNames` are
 *  the plane-state segments that drive the §5 state table; the two
 *  mutation faces + `onApplied` (the post-mutation plane-state re-fetch).
 *  `title` / `copy` (V2-T5.1) override the card heading + copy for the
 *  empty-hub variant — the §5 two-state button logic + the two flows are
 *  unchanged:
 *  - hub === null → BOTH buttons enabled. 「接入」 first opens the
 *    「尚无管理中枢」 warning; confirming proceeds (does NOT block —
 *    single-workspace mode, design §5/§8 Q7).
 *  - hub !== null → 「设为中枢」 DISABLED with the reason copy 已存在中枢
 *    (a second hub is impossible — design §2 Q2 恰好一个); 「接入」 runs
 *    the normal registration flow.
 *  - setHub: confirm dialog → `setHub({wsPath})` → success → RE-FETCH
 *    (onApplied) → the role flips to HUB → the hub console renders;
 *    RPC error → the error shows on the card, the card stays.
 *  - bind: (warning when hub===null) → displayName dialog (prefilled) →
 *    `bindProject({wsPath, displayName, scaffold: true})` → success →
 *    re-fetch → the project console renders; RPC error → error on the
 *    card, the card stays. `scaffold: true` is the UNREGISTERED intent:
 *    discovery saw no tree at this workspace, so the host scaffolds the
 *    minimal tree when absent (a live tree that appeared since discovery
 *    refuses loudly — the error row surfaces it).
 *  - every cancel → dialog closes, no RPC fired, state unchanged.
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
  SetHubArgs,
  SetHubResult,
} from '../../../shared/rpc-contracts.js'

import { extractResearchErrorCarrier } from '../../util/error-carrier.js'
import styles from './shell.module.css'

type OnboardDialog =
  /** 设为中枢 confirm — explains the marker + empty registry to create. */
  | 'setHub'
  /** 无中枢 接入 warning — confirming does NOT block (single-workspace mode). */
  | 'noHubWarning'
  /** 接入 displayName collection (prefilled with the folder name). */
  | 'displayName'

/** The folder name a wsPath binds under by default (design §8: 默认文件夹名). */
function folderNameOf(wsPath: string): string {
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

export function OnboardingCard(
  props: {
    readonly narrowed?: boolean
    /**
     * Optional card title override (V2-T5.1 — the empty-hub
     * 「登记第一个研究项目」 card at the card-wall position, design
     * §7.1 空中枢). Default = the §5 引导卡 titles (the narrowed / the
     * standard 接入研究管理系统).
     */
    readonly title?: string
    /**
     * Optional card copy override (V2-T5.1 — the empty-hub variant's
     * copy). Default = the §5 引导卡 copy.
     */
    readonly copy?: string
    readonly wsPath: string | null
    readonly hub: { readonly path: string } | null
    readonly dirNames: { readonly treeDir: string; readonly hubDir: string }
    readonly setHub: (args: SetHubArgs) => Promise<SetHubResult>
    readonly bindProject: (args: BindProjectArgs) => Promise<BindProjectResult>
    /**
     * V2-UI-0.4 UI-2 — the 绑定已有目录 (Bind) inspect face. OPTIONAL:
     * omitted → the Bind journey is NOT offered (the card stays the T4.2
     * card — legacy mounts + tests). Plain business promise (INV-PERM-5:
     * resolves the strict wire result, rejects on any failure — the view
     * never sees a `RemoteResult`).
     */
    readonly inspectProjectDirectory?: (args: InspectProjectDirectoryArgs) => Promise<InspectProjectDirectoryResult>
    /**
     * V2-UI-0.4 UI-2 — the 新建研究项目 (Create) initialize face. Same
     * contract as the inspect face (OPTIONAL → the Create journey is not
     * offered when omitted).
     */
    readonly createLocalResearchProject?: (args: CreateLocalResearchProjectArgs) => Promise<CreateLocalResearchProjectResult>
    readonly onApplied: () => void
  },
): ReactElement {
  const {
    narrowed,
    wsPath,
    hub,
    dirNames,
    setHub,
    bindProject,
    inspectProjectDirectory,
    createLocalResearchProject,
    onApplied,
  } = props
  // null = no dialog open.
  const [dialog, setDialog] = useState<OnboardDialog | null>(null)
  // true while a mutation RPC is in flight (dialog buttons lock, no second
  // call can be issued).
  const [busy, setBusy] = useState(false)
  // The last mutation error (design §8: 显示错误, 卡片保留); null = none.
  const [error, setError] = useState<string | null>(null)
  // The displayName dialog input (seeded from the folder name when the
  // dialog opens — design §8 默认文件夹名).
  const [displayName, setDisplayName] = useState('')

  // ── V2-UI-0.4 UI-2 journeys (ADDITIVE: the T4.2 state above is
  //    untouched; these machines are null/closed until a journey opens). ──

  // Create wizard: null = closed; 1..5 = the frozen B spec steps
  // (Step 1: Location … Step 5: Enter Project).
  const [createStep, setCreateStep] = useState<1 | 2 | 3 | 4 | 5 | null>(null)
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

  // Bind wizard: null = closed. The frozen B journey: Select directory →
  // Inspect → Show detected state → Confirm action → Bind / Initialize
  // missing pieces → Enter Project.
  const [bindPhase, setBindPhase] = useState<'select' | 'detected' | 'confirm' | null>(null)
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
  const [bindDisplayName, setBindDisplayName] = useState('')

  // V2-T5.1: the overridable title/copy (the empty-hub 「登记第一个
  // 研究项目」 card reuses this card at the card-wall position, design
  // §7.1 空中枢 — the flows below are the SAME T4.2 bind flow).
  const title =
    props.title ?? (narrowed ? '本会话未关联工作区' : '接入研究管理系统')
  const copy =
    props.copy ??
    (narrowed
      ? '当前会话未关联任何工作区，研究功能暂不可用。请在关联了工作区的会话中打开研究标签。'
      : '本工作区尚未登记进研究管理系统。选择一种接入方式：将其设为全局研究管理中枢，或作为独立项目登记接入。')

  const hubExists = hub !== null
  const actionsEnabled = !narrowed && !busy
  // The §5 state table: 设为中枢 is available only when NO global hub
  // exists (无中枢 → 可用; 有中枢 → 置灰 + 已存在中枢).
  const setHubEnabled = actionsEnabled && !hubExists

  const openDisplayNameDialog = (): void => {
    // Prefill sensibly: the folder name (the host default — bindProject's
    // `displayName` omitted branch is `basename(wsPath)`, design §8).
    setDisplayName(wsPath !== null ? folderNameOf(wsPath) : '')
    setDialog('displayName')
  }

  const onSetHubClick = (): void => {
    setError(null)
    setDialog('setHub')
  }

  const onBindClick = (): void => {
    setError(null)
    if (hub === null) {
      // 接入（无中枢）: the 「尚无管理中枢」 warning comes FIRST —
      // confirming does NOT block (it proceeds to the displayName dialog).
      setDialog('noHubWarning')
    } else {
      // 接入（有中枢）: the normal registration flow.
      openDisplayNameDialog()
    }
  }

  const cancelDialog = (): void => {
    // Cancel on EVERY dialog leaves state unchanged — no RPC fired.
    setDialog(null)
  }

  /** The 设为中枢 confirm: RPC → success re-fetches (role flips to HUB); error stays on the card. */
  const confirmSetHub = async (): Promise<void> => {
    if (wsPath === null) return
    setBusy(true)
    setError(null)
    try {
      await setHub({ wsPath })
      // design §8 设为中枢: 平面状态刷新 → 该会话进入中枢控制台.
      setDialog(null)
      onApplied()
    } catch (err) {
      setDialog(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /**
   * The 无中枢 warning confirm — does NOT block (design §5 状态表 / §8
   * Q7): it proceeds to the displayName dialog (single-workspace mode).
   */
  const continueNoHubWarning = (): void => {
    openDisplayNameDialog()
  }

  /** The 接入 confirm: RPC → success re-fetches (role flips to the project console); error stays on the card. */
  const confirmBind = async (): Promise<void> => {
    if (wsPath === null || displayName.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      await bindProject({ wsPath, displayName: displayName.trim(), scaffold: true })
      // design §8 接入: → 进入项目视图 (the plane state's project list now
      // carries this workspace; the re-fetch flips the branch).
      setDialog(null)
      onApplied()
    } catch (err) {
      setDialog(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // ── V2-UI-0.4 UI-2 handlers ──

  /** Open the Create wizard at Step 1 (Location) — no RPC fired yet. */
  const openCreate = (): void => {
    setCreateTitle('')
    setCreateDescription('')
    setCreateImportance('')
    setCreateAttention('')
    setCreateTargetDate('')
    setCreateBusy(false)
    setCreateError(null)
    setCreateFailure(null)
    setCreateFolderShown(false)
    setCreateProjectId(null)
    setCreateStep(1)
  }

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
    if (wsPath === null || createLocalResearchProject === undefined) return
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
    setCreateStep(null)
    onApplied()
  }

  /** Open the Bind wizard at the Select-directory step — no RPC yet. */
  const openBind = (): void => {
    setInspectResult(null)
    setInspectError(null)
    setBindError(null)
    setInspectBusy(false)
    setBindBusy(false)
    setBindDisplayName(wsPath !== null ? folderNameOf(wsPath) : '')
    setBindPhase('select')
  }

  /** Select-directory → Inspect: fire the inspect face (plane-level). */
  const runInspect = async (): Promise<void> => {
    if (wsPath === null || inspectProjectDirectory === undefined) return
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
    if (wsPath === null || inspectResult === null || bindDisplayName.trim() === '') return
    const scaffold = inspectResult.state !== 'RC_PROJECT'
    setBindBusy(true)
    setBindError(null)
    try {
      await bindProject({ wsPath, displayName: bindDisplayName.trim(), scaffold })
      setBindPhase(null)
      onApplied()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const carrier = extractResearchErrorCarrier(message)
      setBindError(carrier !== null ? carrier.detail : message)
    } finally {
      setBindBusy(false)
    }
  }

  const confirmLabel =
    dialog === 'setHub'
      ? '设为中枢'
      : dialog === 'noHubWarning'
        ? '继续接入'
        : '接入'

  const dialogTitle =
    dialog === 'setHub' ? '设为研究管理中枢' : dialog === 'noHubWarning' ? '尚无管理中枢' : '接入研究管理系统'

  return (
    <div
      className={narrowed ? `${styles.shell} ${styles.onboardNarrow}` : styles.shell}
      data-onboarding-card
      data-onboarding-variant={narrowed ? 'no-cwd' : 'unregistered'}
      role="region"
      aria-label="研究管理系统引导"
    >
      <h2 className={styles.onboardTitle}>{title}</h2>
      <p className={styles.onboardCopy}>{copy}</p>
      {error !== null && (
        <p className={styles.onboardError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.onboardActions}>
        <div className={styles.onboardActionGroup}>
          <button type="button" className={styles.onboardButton} disabled={!setHubEnabled} onClick={onSetHubClick}>
            将此工作区设为研究管理中枢
          </button>
          {/* The §5 状态表 reason copy (有中枢 → 置灰 + 原因文案：已存在中枢). */}
          {!narrowed && hubExists && (
            <p className={styles.onboardReason} data-onboard-sethub-reason>
              已存在中枢
            </p>
          )}
        </div>
        <button type="button" className={styles.onboardButton} disabled={!actionsEnabled} onClick={onBindClick}>
          将此工作区接入研究管理系统
        </button>
        {/* V2-UI-0.4 UI-2 — the ADDITIVE journeys (the T4.2 buttons above
            stay byte-identical). Offered only when the faces are wired
            (production) AND the session has a working directory — the
            client has no workspace-enumeration channel, so both journeys
            act on the session cwd (wsPath); the narrowed variant
            (wsPath === null) disables them. */}
        {createLocalResearchProject !== undefined && (
          <button
            type="button"
            className={styles.onboardButton}
            disabled={!actionsEnabled}
            onClick={openCreate}
            data-onboard-create
          >
            新建研究项目
          </button>
        )}
        {inspectProjectDirectory !== undefined && (
          <button
            type="button"
            className={styles.onboardButton}
            disabled={!actionsEnabled}
            onClick={openBind}
            data-onboard-bind
          >
            绑定已有目录
          </button>
        )}
      </div>
      {dialog !== null && (
        <div className={styles.dialogOverlay} role="dialog" aria-modal="true" aria-label={dialogTitle}>
          <div className={styles.dialogPanel}>
            <h3 className={styles.dialogTitle}>{dialogTitle}</h3>
            {dialog === 'setHub' && (
              <p className={styles.dialogCopy}>
                将在本工作区创建 <code>{dirNames.hubDir}/</code> 标记目录与空的{' '}
                <code>registry.yaml</code>，此后本工作区即全局研究管理中枢。
              </p>
            )}
            {dialog === 'noHubWarning' && (
              <p className={styles.dialogCopy}>
                当前研究平面尚无管理中枢。继续将以单工作区模式接入：项目数据落在本工作区自身的{' '}
                <code>{dirNames.treeDir}/state/</code> 下（日后设立中枢时可迁入中枢）。
              </p>
            )}
            {dialog === 'displayName' && (
              <>
                <p className={styles.dialogCopy}>将以该显示名登记本工作区为研究项目。</p>
                <label className={styles.dialogField} htmlFor="onboard-display-name">
                  项目显示名
                </label>
                <input
                  id="onboard-display-name"
                  className={styles.dialogInput}
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </>
            )}
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dialogCancel} onClick={cancelDialog} disabled={busy}>
                取消
              </button>
              <button
                type="button"
                className={styles.dialogConfirm}
                disabled={busy || (dialog === 'displayName' && displayName.trim() === '')}
                onClick={() => {
                  void (dialog === 'setHub'
                    ? confirmSetHub()
                    : dialog === 'noHubWarning'
                      ? continueNoHubWarning()
                      : confirmBind())
                }}
              >
                {busy ? '处理中…' : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* V2-UI-0.4 UI-2 — the Create journey (the frozen B spec 5 steps:
          Step 1: Location → Step 2: Project metadata → Step 3: Confirm →
          Step 4: Initialize → Step 5: Enter Project). ADDITIVE overlay —
          the T4.2 dialog above is untouched. */}
      {createStep !== null && (
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
                {createFolderShown && wsPath !== null && (
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
      )}
      {/* V2-UI-0.4 UI-2 — the Bind journey (the frozen B spec 4-state
          flow: Select directory → Inspect → Show detected state →
          Confirm action → Bind / Initialize missing pieces → Enter
          Project). ADDITIVE overlay — the T4.2 dialog above is
          untouched. */}
      {bindPhase !== null && (
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
                  <button type="button" className={styles.dialogCancel} onClick={() => setBindPhase(null)}>
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
                  <button type="button" className={styles.dialogCancel} onClick={() => setBindPhase(null)}>
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
      )}
    </div>
  )
}
