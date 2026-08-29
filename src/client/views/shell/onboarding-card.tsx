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
 *
 * V2-UI-0.4 UI-3 (D2) — the 新建研究项目 / 绑定已有目录 journey state
 * machines are EXTRACTED to `project-journeys.tsx` (the shared
 * `CreateProjectDialog` / `BindProjectDialog`) so the HUB Portfolio
 * header + empty state open the SAME journeys. This card now renders
 * those components (a fresh mount IS the open-time reset); the DOM the
 * onboarding tests pin is byte-identical to the former inline overlays.
 * `folderNameOf` (design §8 默认文件夹名) now lives there too and is
 * imported back for the T4.2 displayName prefill.
 */

import { useState, type ReactElement } from 'react'

import type {
  BindProjectArgs,
  BindProjectResult,
  CreateLocalResearchProjectArgs,
  CreateLocalResearchProjectResult,
  InspectProjectDirectoryArgs,
  InspectProjectDirectoryResult,
  SetHubArgs,
  SetHubResult,
} from '../../../shared/rpc-contracts.js'

import { BindProjectDialog, CreateProjectDialog, folderNameOf } from './project-journeys.js'
import styles from './shell.module.css'

type OnboardDialog =
  /** 设为中枢 confirm — explains the marker + empty registry to create. */
  | 'setHub'
  /** 无中枢 接入 warning — confirming does NOT block (single-workspace mode). */
  | 'noHubWarning'
  /** 接入 displayName collection (prefilled with the folder name). */
  | 'displayName'

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

  // ── V2-UI-0.4 UI-2 journeys (extracted to project-journeys.tsx in UI-3
  //    D2 — the shared Create/Bind dialogs). Each mount is a FRESH journey
  //    (the inline open-time resets are replaced by unmount/remount). ──

  // true = the Create wizard is open (the parent mounts the dialog).
  const [createOpen, setCreateOpen] = useState(false)
  // true = the Bind journey is open.
  const [bindOpen, setBindOpen] = useState(false)

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

  // ── V2-UI-0.4 UI-2 handlers (UI-3 D2: the journey state machines
  //    moved to the shared dialogs — mounting the dialog IS the open
  //    (a fresh mount carries the open-time reset). ──

  /** Open the Create wizard (the shared dialog mounts at Step 1). */
  const openCreate = (): void => {
    setCreateOpen(true)
  }

  /** Open the Bind journey (the shared dialog mounts at Select-directory). */
  const openBind = (): void => {
    setBindOpen(true)
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
          Step 4: Initialize → Step 5: Enter Project). UI-3 D2: rendered by
          the shared dialog (project-journeys.tsx) — the DOM is
          byte-identical to the former inline overlay. */}
      {createOpen && createLocalResearchProject !== undefined && wsPath !== null && (
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

      {/* V2-UI-0.4 UI-2 — the Bind journey (the frozen B spec 4-state
          flow: Select directory → Inspect → Show detected state →
          Confirm action → Bind / Initialize missing pieces → Enter
          Project). UI-3 D2: rendered by the shared dialog
          (project-journeys.tsx) — the DOM is byte-identical to the
          former inline overlay. */}
      {bindOpen && inspectProjectDirectory !== undefined && wsPath !== null && (
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
