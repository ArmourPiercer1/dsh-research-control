/**
 * V2-T4.1 — Research shell (角色分流 + 标签壳 — design §5/§6).
 * V2-T4.2 — 引导卡 two-state button logic (design §5 引导卡状态表) + the
 * 设为中枢 / 接入 flows (design §8 关键交互流程).
 * V2-T4.3 — MISSING four-action modal (design §4 四选一弹窗 — see
 * ./missing-modal.tsx for the pinned contract + the runtime dedup rule).
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
 *                   nav frame (V2-T5.1): 总览 = 聚合条 + 项目卡墙
 *                   (`getHubOverview`, design §7.1 — 需关注行 only when
 *                   attention is non-empty; empty hub → the 登记第一个
 *                   研究项目 onboarding card at the card-wall position)
 *                   with the WHOLE-CARD 钻取 into the project console
 *                   (back = 返回总览 to the wall); the other three
 *                   entries stay 页建设中 placeholders until T5.2…T5.4;
 *  - MANAGED /    → 同构收窄控制台 (V2-T5.1): the SAME 4-entry frame,
 *    STANDALONE     总览 = the EXISTING project page (brief + 目标 +
 *                   topic list) AS ROOT — no aggregate strip, no back
 *                   affordance; the drill chain 项目→主题→工作流→历史
 *                   stays inside the console (the V1 cockpit is no
 *                   longer mounted by the shell — its withdrawn pages
 *                   are nav-unreachable, see cockpit.tsx);
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
 * MISSING modal (V2-T4.3, design §4 — 挂起，等待用户处置): orthogonal to
 * the five branches — the plane state carries the MISSING set regardless
 * of the session role. On the FIRST ready render whose `plane.missing`
 * has at least one entry with `deferred === false` (the LIVE entries —
 * the pinned client-visible dedup rule, ./missing-modal.tsx), the shell
 * pops the 四选一 modal over whatever branch renders (恢复 → rescan /
 * 重初始化 → bindProject / 移除登记 → unbindProject / 推后 →
 * ackMissingReminder). Any successful action closes the modal and
 * re-fetches the plane state; a re-fetch that still carries live
 * (non-deferred) entries re-pops for THOSE entries — an acked entry is
 * filtered out by its host-side `deferred: true` flag, so the second
 * render in the same runtime never re-pops for it (the dedup gate).
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
  AckMissingReminderArgs,
  AckMissingReminderResult,
  BindProjectArgs,
  BindProjectResult,
  GetResearchPlaneStateResult,
  HubOverviewResult,
  PlaneSessionDto,
  RescanArgs,
  RescanResult,
  SetHubArgs,
  SetHubResult,
  UnbindProjectArgs,
  UnbindProjectResult,
} from '../../../shared/rpc-contracts.js'
import { HubOverviewPage } from './hub-overview.js'
import { MissingModal } from './missing-modal.js'
import { OnboardingCard } from './onboarding-card.js'
import { ProjectConsole } from './project-console.js'
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
   * The injected 总览（中枢模式）fetch (design §12 row 2 — `getHubOverview`):
   * the cross-project aggregation (totals + 需关注 attention list + the
   * project card wall) the HUB 总览 page body renders. Resolves the wire
   * result; rejects on any failure (the overview's failure face responds).
   * The MANAGED / STANDALONE roles never call it (their 总览 is the
   * project console itself — no aggregate strip).
   */
  readonly loadHubOverview: () => Promise<HubOverviewResult>
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
  /**
   * The injected 恢复 mutation (design §4 MISSING 处置 → `rescan`, §12 row
   * 8). The MISSING modal's 恢复 action re-runs discovery & reconciliation
   * (the tree may have come back); on success the modal closes and the
   * shell RE-FETCHES the plane state (a recovered tree flips the entry to
   * MANAGED and it drops out of the MISSING set). Rejects on any failure
   * (the modal shows the error and stays open).
   */
  readonly rescan: (args: RescanArgs) => Promise<RescanResult>
  /**
   * The injected 移除登记 mutation (design §4 MISSING 处置 → `unbindProject`,
   * §12 row 6). The MISSING modal's 移除登记 action archives the registry
   * entry (归档口径 — NEVER deleted; the entry goes `archived`, the hub db
   * is kept). The wire takes the entry's registered `wsPath`. On success
   * the modal closes and the shell re-fetches (the archived entry drops
   * out of the MISSING set). Rejects on any failure (the modal shows the
   * error and stays open).
   */
  readonly unbindProject: (args: UnbindProjectArgs) => Promise<UnbindProjectResult>
  /**
   * The injected 推后 mutation (design §4 MISSING 处置 → `ackMissingReminder`,
   * §12 row 9). The MISSING modal's 推后 action sets the 「推后处理」
   * RUNTIME DEDUP flag: the host adds the id to the in-memory
   * `deferredReminders` set (never persisted — a backend restart restores
   * the reminder, design §14). The entry stays in `missing` with its
   * `deferred` flag flipped to `true`, so the re-fetch filters it out and
   * the second render in the same runtime does NOT re-pop for it. On
   * success the modal closes and the shell re-fetches. Rejects on any
   * failure (the modal shows the error and stays open).
   */
  readonly ackMissingReminder: (args: AckMissingReminderArgs) => Promise<AckMissingReminderResult>
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
  // V2-T4.3 (design §4): the 四选一 modal's open state. The pop effect
  // below opens it on the FIRST ready render carrying a live (non-deferred)
  // missing entry; a successful action is the ONLY closer (onResolved —
  // close + re-fetch; there is no plain dismiss, the entry is 挂起，等待
  // 用户处置, and 推后 is the 「not now」 path).
  const [missingOpen, setMissingOpen] = useState(false)
  // V2-T5.1: the HUB 总览 drill target (the card wall's whole-card click
  // hands the project id here; null = the card wall is showing). Reset on
  // any nav-tab change (the 总览 tab re-enters at the wall) and on
  // re-fetch (the plane may have changed under a stale drill target).
  const [hubDrillProjectId, setHubDrillProjectId] = useState<string | null>(null)

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

  // V2-T4.3 (design §4): POP the four-action modal on the first ready
  // render that carries a live missing entry — the pinned client-visible
  // dedup rule: an entry is live while `deferred === false`; 推后 flips
  // the flag on the host (runtime set, no rescan needed), so the
  // post-ack re-fetch filters the entry out and the same runtime never
  // re-pops for it. A re-fetch that still carries live entries (the user
  // acted on a different entry) re-pops for THOSE (module header).
  useEffect(() => {
    if (phase === 'ready' && plane !== null && missingOpen === false) {
      if (plane.missing.some((m) => m.deferred === false)) {
        setMissingOpen(true)
      }
    }
  }, [phase, plane, missingOpen])

  /**
   * The post-mutation RE-FETCH (T4.2): after setHub/bindProject succeeded,
   * the card calls this and the shell re-runs the plane-state fetch (the
   * loading face shows while it is in flight; the resolved result then
   * flips the branch — e.g. UNREGISTERED → HUB, design §8 平面状态刷新).
   */
  const refresh = useCallback(() => {
    // A re-fetch may change the plane under a stale HUB drill target —
    // the drill resets to the card wall (V2-T5.1).
    setHubDrillProjectId(null)
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

  // V2-T4.3 (design §4): the LIVE missing entries — `deferred === false`
  // (the pinned dedup rule; the modal module header documents the host
  // contract behind the flag).
  const liveMissing = plane.missing.filter((m) => m.deferred === false)

  let branch: ReactElement
  switch (effective.role) {
    case 'HUB': {
      // V2-T5.1 — 总览（中枢模式）= 聚合条 + 项目卡墙 (`getHubOverview`,
      // design §7.1). The whole-card click is the 钻取链 root: while
      // `hubDrillProjectId` is set, 总览 renders the project console and
      // the console's back returns to the wall (返回总览). The HUB role is
      // defined by a resolvable hub cwd — the null case is unreachable by
      // the host's role resolution, rendered as a fault instead of
      // guessing a value (fail-loud).
      const overview =
        effective.cwd === null || plane.hub === null ? (
          <p className={styles.faultLine} role="alert">
            研究平面状态异常：中枢工作区未解析
          </p>
        ) : hubDrillProjectId === null ? (
          <HubOverviewPage
            loadHubOverview={props.loadHubOverview}
            onDrill={setHubDrillProjectId}
            wsPath={effective.cwd}
            hub={plane.hub}
            dirNames={plane.dirNames}
            setHub={props.setHub}
            bindProject={props.bindProject}
            onApplied={refresh}
          />
        ) : (
          <ProjectConsole onBackToWall={() => setHubDrillProjectId(null)} />
        )
      branch = <ConsoleFrame role="HUB" overview={overview} onNavChange={() => setHubDrillProjectId(null)} />
      break
    }
    case 'MANAGED':
    case 'STANDALONE':
      // V2-T5.1 — 同构收窄控制台 (design §5): the SAME 4-entry frame; 总览
      // = the EXISTING project page (brief + 目标 + topic list) AS ROOT —
      // no aggregate strip, no back affordance. The drill chain
      // 项目→主题→工作流→历史 stays inside the console.
      branch = (
        <ConsoleFrame role={effective.role} cwd={effective.cwd ?? undefined} overview={<ProjectConsole />} />
      )
      break
    case 'UNREGISTERED':
      branch = (
        <OnboardingCard
          wsPath={effective.cwd}
          hub={plane.hub}
          dirNames={plane.dirNames}
          setHub={props.setHub}
          bindProject={props.bindProject}
          onApplied={refresh}
        />
      )
      break
    case 'NO_CWD':
      branch = <OnboardingCard narrowed wsPath={null} hub={plane.hub} dirNames={plane.dirNames} setHub={props.setHub} bindProject={props.bindProject} onApplied={refresh} />
      break
    default: {
      // Exhaustive pin: the §5 role union is closed — a new role without a
      // branch is a type error here.
      const exhaustive: never = effective.role
      branch = exhaustive
      break
    }
  }

  return (
    <>
      {branch}
      {/* V2-T4.3: the 四选一 modal overlays whatever branch renders (the
          MISSING set is plane-level, not session-role-level). It only
          shows while at least one live entry remains — a re-fetch that
          clears them unmounts it. */}
      {missingOpen && liveMissing.length > 0 && (
        <MissingModal
          entries={liveMissing}
          rescan={props.rescan}
          bindProject={props.bindProject}
          unbindProject={props.unbindProject}
          ackMissingReminder={props.ackMissingReminder}
          onResolved={() => {
            // Success tail: close the modal AND re-fetch the plane state
            // (the underlying branch re-renders over the fresh state).
            setMissingOpen(false)
            refresh()
          }}
        />
      )}
    </>
  )
}

/**
 * The V2 console frame (design §5/§6 — 同构收窄控制台, 一级入口恒为 4 个,
 * 四种角色视图共用标签名): a nav frame with the 4 first-level entries.
 * 总览 is the role-specific page body (HUB: 聚合条 + 卡墙 with the 钻取链
 * into the project console; MANAGED/STANDALONE: the project console
 * itself AS ROOT). The other three entries stay 页建设中 placeholders
 * until T5.2…T5.4. The frame, the nav, and the 4 entries MUST render
 * from this task on.
 */
interface ConsoleFrameProps {
  readonly role: 'HUB' | 'MANAGED' | 'STANDALONE'
  /** The session cwd (data attribute only — the MANAGED/STANDALONE
   *  branch keeps the T4.x data-cwd contract; HUB omits it). */
  readonly cwd?: string
  readonly overview: ReactElement
  /** Fired on every nav-tab click (the shell resets the HUB drill there). */
  readonly onNavChange?: () => void
}

function ConsoleFrame({ role, cwd, overview, onNavChange }: ConsoleFrameProps): ReactElement {
  const [active, setActive] = useState<HubEntryId>('overview')
  const activeLabel = HUB_ENTRIES.find((e) => e.id === active)?.label ?? '总览'
  return (
    <div className={styles.shell} data-role={role} data-cwd={cwd}>
      <header className={styles.hubHeader}>
        <h1 className={styles.hubTitle}>研究控制台</h1>
        <nav className={styles.nav} aria-label="研究控制台一级入口">
          {HUB_ENTRIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === active ? styles.navActive : styles.navItem}
              aria-current={entry.id === active ? 'page' : undefined}
              onClick={() => {
                setActive(entry.id)
                onNavChange?.()
              }}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </header>
      <section className={styles.pageBody} data-page={active} aria-label={`${activeLabel}页`}>
        {active === 'overview' ? overview : <p className={styles.placeholder}>{activeLabel} 页建设中</p>}
      </section>
    </div>
  )
}

