/**
 * V2-T4.1 — Research shell (角色分流 + 标签壳 — design §5/§6).
 * V2-T4.2 — 引导卡 two-state button logic (design §5 引导卡状态表) + the
 * 设为中枢 / 接入 flows (design §8 关键交互流程).
 *
 * The registered 研究 tab body, replacing the bare `ResearchCockpit` as the
 * slot component (the tab registration itself — id/order/label — is
 * UNCHANGED, the tab stays always visible). On mount the shell fetches the
 * plane state (`getResearchPlaneState`, design §12 row 1) through the
 * INJECTED fetch face — the production binding in `dsh-adapter/ui.ts`
 * carries the framework sessionId (the SessionStandardProps merge the
 * session-scope slot runtime performs), so the client only ever passes its
 * own session id; the host resolves cwd → role from the session registry.
 *
 * Five branches on `session.role` (design §5 标签页分流):
 *  - HUB          → 中枢控制台 frame: the 4 first-level entries 总览 /
 *                   重要事件 / 调查员 / 设置 (design §6 fixed naming) as a
 *                   nav frame; the page bodies are minimal placeholders
 *                   (P5 — T5.1…T5.4 — fills them);
 *  - MANAGED /    → project-narrowed console: the V1 cockpit stays wired
 *    STANDALONE     as the project view for now (P5 reshapes it — the
 *                   cockpit receives exactly what it needs today);
 *  - UNREGISTERED → 引导卡 (design §5 引导卡状态表):
 *       hub === null → BOTH buttons enabled;
 *       hub !== null → 「设为中枢」 DISABLED + reason copy 已存在中枢,
 *                      「接入」 enabled (the normal registration flow).
 *    Flows (design §8):
 *       设为中枢: confirm dialog (explains the `<hubDir>/` marker + empty
 *                 `registry.yaml` that will be created) → `setHub` RPC →
 *                 success RE-FETCHES the plane state → the role flips to
 *                 HUB → the hub console branch renders. RPC error → the
 *                 error is shown on the card, the card stays.
 *       接入:    displayName dialog (prefilled with the folder name) →
 *                 `bindProject` → success → re-fetch → the project console
 *                 branch. When hub === null a 「尚无管理中枢」 warning
 *                 dialog comes FIRST — confirming does NOT block (the user
 *                 proceeds into single-workspace mode, design §5/§8 Q7).
 *    Every dialog cancel leaves state unchanged (no RPC fired).
 *  - NO_CWD       → 引导卡 收窄文案「本会话未关联工作区」, buttons disabled
 *                   (the disabled narrow variant — T4.2 keeps it inert).
 *
 * The `session === null` outcome (the fetch was made without a resolvable
 * caller — the framework could not resolve a sessionId) is routed to the
 * NO_CWD narrowing: the same card without a caller workspace, not a
 * session context at all. A stale/foreign session id does NOT arrive here:
 * the host throws PLANE_SESSION_UNKNOWN (a failure face with retry).
 *
 * Layering (INV-PERM-5): this file is pure props/React — it imports NO
 * @deepseek-ai package. The injected faces are therefore PLAIN business
 * promises: each resolves its strict wire result and rejects on ANY
 * failure (business `ok: false` folded by the adapter, or an assembly-fault
 * rejection) — the view never sees `RemoteResult`.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'

import type {
  BindProjectArgs,
  BindProjectResult,
  GetResearchPlaneStateResult,
  PlaneSessionDto,
  SetHubArgs,
  SetHubResult,
} from '../../../shared/rpc-contracts.js'
import { ResearchCockpit } from '../drilldown/cockpit.js'
import styles from './shell.module.css'

/**
 * Props of the registered 研究 tab body.
 *
 * @param props - the framework standard kit (session-scope slot: the
 *  runtime merges `SessionStandardProps`, so `sessionId` is the
 *  framework-resolved current session id, same channel the V1 cockpit
 *  used) + the injected faces (see the module header): the plane-state
 *  fetch plus the two onboarding mutations (T4.2 — both resolve their
 *  strict wire result and reject on any failure, the view never sees a
 *  `RemoteResult`).
 */
export interface ResearchShellProps {
  readonly sessionId?: string
  /**
   * The injected plane-state fetch (ui.ts inject face — per-session plain
   * data, the apply-world → view channel). The production binding carries
   * the framework sessionId; tests inject a plain stub. Resolves the wire
   * result; rejects on any failure (the failure face + 重试 respond).
   */
  readonly loadPlaneState: () => Promise<GetResearchPlaneStateResult>
  /**
   * The injected 设为中枢 mutation (design §8 设为中枢 → `setHub`, §12 row
   * 4). The UNREGISTERED card's confirm flow calls it with the session's
   * `wsPath`; on success the card triggers a plane-state RE-FETCH (the
   * role flips to HUB and the hub console renders). Rejects on any failure
   * (the card shows the error and stays).
   */
  readonly setHub: (args: SetHubArgs) => Promise<SetHubResult>
  /**
   * The injected 接入 mutation (design §8 接入 → `bindProject`, §12 row 5).
   * The UNREGISTERED card's displayName flow calls it with the session's
   * `wsPath` + the chosen display name + `scaffold: true` (the UNREGISTERED
   * role means discovery saw no tree there, so the minimal tree is
   * scaffolded when absent); on success the card triggers a plane-state
   * RE-FETCH (the role flips to MANAGED/STANDALONE and the project console
   * renders). Rejects on any failure (the card shows the error and stays).
   */
  readonly bindProject: (args: BindProjectArgs) => Promise<BindProjectResult>
}

/** The shell's fetch lifecycle (the loading / failed / ready faces). */
type PlanePhase = 'loading' | 'failed' | 'ready'

/**
 * The 4 first-level entries of the 中枢控制台 (design §6 — 一级入口恒为 4
 * 个, 四种角色视图共用标签名). The naming is 定案-locked (§6: 总览（非
 * 「首页」）、重要事件、调查员、设置).
 */
const HUB_ENTRIES = [
  { id: 'overview', label: '总览' },
  { id: 'attention', label: '重要事件' },
  { id: 'investigator', label: '调查员' },
  { id: 'settings', label: '设置' },
] as const

type HubEntryId = (typeof HUB_ENTRIES)[number]['id']

export function ResearchShell(props: ResearchShellProps): ReactElement {
  const [phase, setPhase] = useState<PlanePhase>('loading')
  const [plane, setPlane] = useState<GetResearchPlaneStateResult | null>(null)
  // Retry generation: bumping it re-runs the fetch effect (the failed face's
  // 重试 button and the onboarding card's post-mutation re-fetch are the
  // writers).
  const [generation, setGeneration] = useState(0)
  // In-flight promise slot: StrictMode's double effect reuses the FIRST
  // in-flight fetch instead of issuing a second one — exactly one fetch per
  // user-visible load (the home container pins the same one-fetch
  // invariant via the store's in-flight dedupe).
  const inflight = useRef<Promise<GetResearchPlaneStateResult> | null>(null)
  // The inject faces are read through refs so a re-render with a fresh
  // binding never leaks a stale closure into the effect.
  const loadRef = useRef(props.loadPlaneState)
  loadRef.current = props.loadPlaneState

  useEffect(() => {
    let cancelled = false
    if (inflight.current === null) {
      inflight.current = loadRef.current()
    }
    const pending = inflight.current
    void pending
      .then(
        (result) => {
          if (cancelled) return
          setPlane(result)
          setPhase('ready')
        },
        () => {
          // The injected face rejects on ANY failure (business fault or
          // assembly fault) — the failure face responds with 重试.
          if (cancelled) return
          setPhase('failed')
        },
      )
      .finally(() => {
        // Chained onto the (always-settled) .then result: a separate
        // pending.finally(…) would leak a second unhandled rejection chain.
        if (inflight.current === pending) inflight.current = null
      })
    return () => {
      cancelled = true
    }
  }, [generation])

  /**
   * The post-mutation RE-FETCH (T4.2): after setHub/bindProject succeeded,
   * the card calls this and the shell re-runs the plane-state fetch (the
   * loading face shows while it is in flight; the resolved result then
   * flips the branch — e.g. UNREGISTERED → HUB, design §8 平面状态刷新).
   */
  const refresh = useCallback(() => {
    setPhase('loading')
    setGeneration((g) => g + 1)
  }, [])

  if (phase === 'loading') {
    return (
      <div className={styles.shell} data-shell-phase="loading">
        <p className={styles.statusLine} role="status">
          正在加载研究平面…
        </p>
      </div>
    )
  }

  if (phase === 'failed' || plane === null) {
    return (
      <div className={styles.shell} data-shell-phase="failed">
        <p className={styles.faultLine} role="alert">
          研究平面状态加载失败
        </p>
        <button
          type="button"
          className={styles.retryButton}
          onClick={() => {
            // Back to the loading face while the re-fetch is in flight.
            setPhase('loading')
            setGeneration((g) => g + 1)
          }}
        >
          重试
        </button>
      </div>
    )
  }

  const session = plane.session
  // The fetch was made without a resolvable caller (framework sessionId
  // unresolved) — route to the NO_CWD narrowing (module header).
  const effective: PlaneSessionDto =
    session === null ? { cwd: null, role: 'NO_CWD' } : session

  switch (effective.role) {
    case 'HUB':
      return <HubConsoleFrame />
    case 'MANAGED':
    case 'STANDALONE':
      // Project-narrowed console (design §5: 同构收窄控制台). P5 reshapes
      // the cockpit per role; today it receives exactly what it needs.
      return (
        <div className={styles.shell} data-role={effective.role} data-cwd={effective.cwd ?? undefined}>
          <ResearchCockpit sessionId={props.sessionId} />
        </div>
      )
    case 'UNREGISTERED':
      return (
        <OnboardingCard
          wsPath={effective.cwd}
          hub={plane.hub}
          dirNames={plane.dirNames}
          setHub={props.setHub}
          bindProject={props.bindProject}
          onApplied={refresh}
        />
      )
    case 'NO_CWD':
      return <OnboardingCard narrowed wsPath={null} hub={plane.hub} dirNames={plane.dirNames} setHub={props.setHub} bindProject={props.bindProject} onApplied={refresh} />
  }
}

/**
 * The 中枢控制台 frame (HUB branch — design §5/§6): a nav frame with the 4
 * first-level entries and a placeholder page body (P5 fills 总览/重要事件/
 * 调查员/设置 — T5.1…T5.4). The frame, the nav, and the 4 entries MUST
 * render from this task on.
 */
function HubConsoleFrame(): ReactElement {
  const [active, setActive] = useState<HubEntryId>('overview')
  const activeLabel = HUB_ENTRIES.find((e) => e.id === active)?.label ?? '总览'
  return (
    <div className={styles.shell} data-role="HUB">
      <header className={styles.hubHeader}>
        <h1 className={styles.hubTitle}>研究控制台</h1>
        <nav className={styles.nav} aria-label="研究控制台一级入口">
          {HUB_ENTRIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === active ? styles.navActive : styles.navItem}
              aria-current={entry.id === active ? 'page' : undefined}
              onClick={() => setActive(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </header>
      <section className={styles.pageBody} data-page={active} aria-label={`${activeLabel}页`}>
        <p className={styles.placeholder}>{activeLabel} 页建设中</p>
      </section>
    </div>
  )
}

/**
 * The onboarding dialog kinds (T4.2 — design §5 状态表 + §8 flows). Every
 * dialog is a card-local overlay (the views layer is DSH-free — INV-PERM-5,
 * so no host dialog service): cancel simply closes the dialog and fires no
 * RPC (state unchanged, per the task gate).
 */
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

/**
 * The 引导卡 (onboarding card) — UNREGISTERED and NO_CWD branches
 * (design §5 引导卡状态表).
 *
 * T4.2 fills the two-state button logic + the two flows:
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
 * @param props - `narrowed` selects the NO_CWD 收窄文案 variant (both
 *  buttons disabled, no flow reachable); `wsPath` is the session's working
 *  directory (null only in the narrowed variant); `hub` / `dirNames` are
 *  the plane-state segments that drive the §5 state table; the two
 *  mutation faces + `onApplied` (the post-mutation plane-state re-fetch).
 */
function OnboardingCard(
  props: {
    readonly narrowed?: boolean
    readonly wsPath: string | null
    readonly hub: { readonly path: string } | null
    readonly dirNames: { readonly treeDir: string; readonly hubDir: string }
    readonly setHub: (args: SetHubArgs) => Promise<SetHubResult>
    readonly bindProject: (args: BindProjectArgs) => Promise<BindProjectResult>
    readonly onApplied: () => void
  },
): ReactElement {
  const { narrowed, wsPath, hub, dirNames, setHub, bindProject, onApplied } = props
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
      <h2 className={styles.onboardTitle}>{narrowed ? '本会话未关联工作区' : '接入研究管理系统'}</h2>
      <p className={styles.onboardCopy}>
        {narrowed
          ? '当前会话未关联任何工作区，研究功能暂不可用。请在关联了工作区的会话中打开研究标签。'
          : '本工作区尚未登记进研究管理系统。选择一种接入方式：将其设为全局研究管理中枢，或作为独立项目登记接入。'}
      </p>
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
    </div>
  )
}
