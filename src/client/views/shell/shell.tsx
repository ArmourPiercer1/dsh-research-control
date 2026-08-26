/**
 * V2-T4.1 — Research shell (角色分流 + 标签壳 — design §5/§6).
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
 *  - UNREGISTERED → 引导卡 SKELETON (T4.2 fills the two-state button logic
 *                   of the §5 state table; the buttons are placeholders);
 *  - NO_CWD       → 引导卡 收窄文案「本会话未关联工作区」, buttons disabled.
 *
 * The `session === null` outcome (the fetch was made without a resolvable
 * caller — the framework could not resolve a sessionId) is routed to the
 * NO_CWD branch: the closest §5 narrowing, since the tab has no caller
 * session context at all. A stale/foreign session id does NOT arrive here:
 * the host throws PLANE_SESSION_UNKNOWN (a failure face with retry).
 *
 * Layering (INV-PERM-5): this file is pure props/React — it imports NO
 * @deepseek-ai package. The injected face is therefore a PLAIN business
 * promise: it resolves the strict `GetResearchPlaneStateResult` and
 * rejects on ANY failure (business `ok: false` folded by the adapter, or
 * an assembly-fault rejection) — the view never sees `RemoteResult`.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react'

import type {
  GetResearchPlaneStateResult,
  PlaneSessionDto,
} from '../../../shared/rpc-contracts.js'
import { ResearchCockpit } from '../drilldown/cockpit.js'
import styles from './shell.module.css'

/**
 * Props of the registered 研究 tab body.
 *
 * @param props - the framework standard kit (session-scope slot: the
 *  runtime merges `SessionStandardProps`, so `sessionId` is the
 *  framework-resolved current session id, same channel the V1 cockpit
 *  used) + the injected fetch face (see the module header).
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
  // 重试 button is the only writer).
  const [generation, setGeneration] = useState(0)
  // In-flight promise slot: StrictMode's double effect reuses the FIRST
  // in-flight fetch instead of issuing a second one — exactly one fetch per
  // user-visible load (the home container pins the same one-fetch
  // invariant via the store's in-flight dedupe).
  const inflight = useRef<Promise<GetResearchPlaneStateResult> | null>(null)
  // The inject face is read through a ref so a re-render with a fresh
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
      return <OnboardingCard />
    case 'NO_CWD':
      return <OnboardingCard narrowed />
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
 * The 引导卡 (onboarding card) — UNREGISTERED and NO_CWD branches
 * (design §5 引导卡状态表).
 *
 * T4.1 ships the SKELETON: the branch is visually distinct and the two
 * §5-named buttons render as placeholders. T4.2 fills the two-state button
 * logic (无中枢 → 双可用; 有中枢 → 「设为中枢」置灰 + 原因文案) and the
 * setHub/bindProject flows; until then the buttons are inert (the
 * UNREGISTERED card renders them enabled-looking but no-op, the NO_CWD
 * card renders them disabled per the §5 row 「按钮禁用」).
 *
 * @param props - `narrowed` selects the NO_CWD 收窄文案 variant.
 */
function OnboardingCard(props: { readonly narrowed?: boolean }): ReactElement {
  const { narrowed } = props
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
      <div className={styles.onboardActions}>
        <button type="button" className={styles.onboardButton} disabled={narrowed}>
          将此工作区设为研究管理中枢
        </button>
        <button type="button" className={styles.onboardButton} disabled={narrowed}>
          将此工作区接入研究管理系统
        </button>
      </div>
    </div>
  )
}
