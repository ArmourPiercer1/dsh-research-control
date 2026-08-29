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
 *  - HUB          → 中枢控制台 frame: the 3 VISIBLE first-level entries
 *                   (UI-3, D §9.1 frozen IA — Portfolio / Needs Attention /
 *                   Settings; the V1 4th entry 调查员 is hidden from the
 *                   nav, reachable only via the programmatic deep-link)
 *                   as a
 *                   nav frame (V2-T5.1): 总览 = 聚合条 + 项目卡墙
 *                   (`getHubOverview`, design §7.1 — 需关注行 only when
 *                   attention is non-empty; empty hub → the 登记第一个
 *                   研究项目 onboarding card at the card-wall position)
 *                   with the WHOLE-CARD 钻取 into the project console
 *                   (back = 返回总览 to the wall); 重要事件 = the pure
 *                   intervention stream (V2-T5.2, design §7.2 — portfolio
 *                   view for HUB, 限本项目 client-side filter for the
 *                   project roles); 调查员 = the repositioned V1
 *                   investigator (V2-T5.3, design §7.3 — 调查管理 +
 *                   分析记录: resident 只读引导条 + 绑定来源行 + status-
 *                   bar transient + 溯源链 record list; a successful
 *                   一键调查 anywhere in the console BINDS the launched
 *                   session here and jumps the frame to this entry);
 *                   设置 = the 四段式管理面 (V2-T5.4, design §7.4 —
 *                   ①当前状态 ②操作 ③项目登记册 ④数据位置; the 登记册
 *                   is HUB-only — see ./settings-page.tsx);
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
  AnalysisRecordDto,
  AnalysisTypedRef,
  InvestigatorTransientDto,
  SaveAnalysisRecordArgs,
} from '../../../shared/analysis-command.js'
import { parseInvestigationSessionId } from '../../../shared/investigation-command.js'
import type {
  AckMissingReminderArgs,
  AckMissingReminderResult,
  BindProjectArgs,
  BindProjectResult,
  CreateLocalResearchProjectArgs,
  CreateLocalResearchProjectResult,
  GetPortfolioInterventionsArgs,
  GetPortfolioInterventionsResult,
  GetResearchPlaneStateResult,
  HubOverviewResult,
  InspectProjectDirectoryArgs,
  InspectProjectDirectoryResult,
  PlaneSessionDto,
  PortfolioInterventionItemDto,
  RescanArgs,
  RescanResult,
  RestoreProjectArgs,
  RestoreProjectResult,
  SetHubArgs,
  SetHubResult,
  UnbindProjectArgs,
  UnbindProjectResult,
  UpdateInterventionStateArgs,
  UpdateInterventionStateResult,
} from '../../../shared/rpc-contracts.js'
import { HubOverviewPage } from './hub-overview.js'
import { InvestigatorPage, type InvestigatorBinding } from './investigator-page.js'
import { InterventionStreamPage } from './intervention-stream.js'
import { MissingModal } from './missing-modal.js'
import { OnboardingCard } from './onboarding-card.js'
import { ProjectConsole } from './project-console.js'
import { SettingsPage } from './settings-page.js'
import styles from './shell.module.css'
import { t } from '../../i18n/copy.js'

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
   * The injected 重要事件 stream fetch (V2-T5.2, design §7.2 —
   * `getPortfolioInterventions`, §12 row 3): the pure intervention stream
   * the 重要事件 page renders (the history timeline is NOT part of it).
   * ALWAYS the cross-project host-side call for every role — the 限本项目
   * narrowing for MANAGED / STANDALONE is a CLIENT-SIDE filter on the
   * session's own project (derived from the plane state, no new wire
   * field). Resolves the wire result; rejects on any failure (the page's
   * failure face responds).
   */
  readonly loadPortfolioInterventions: (
    args: GetPortfolioInterventionsArgs,
  ) => Promise<GetPortfolioInterventionsResult>
  /**
   * The injected 状态迁移 mutation (the frozen §13 machine —
   * `updateInterventionState`): the 重要事件 action row (标记处理中 /
   * 关闭 / 确认关闭 / 重开). `projectId` routes the call to the item's
   * project store (design §12.1 explicit multi-project routing — always
   * the item's own project, both roles). Resolves the wire result;
   * rejects on any failure (the row's fault line responds).
   */
  readonly updateInterventionState: (
    args: UpdateInterventionStateArgs,
  ) => Promise<UpdateInterventionStateResult>
  /**
   * The injected 一键调查 channel (the V1 investigation channel — OPEN
   * cards only, NOT a §13 state transition): resolves the channel's
   * success text (it carries the launched investigator session id — the
   * transient 输出口径 shown on the row), rejects on any failure (the
   * row's fault line responds).
   */
  readonly onInvestigate: (item: PortfolioInterventionItemDto, question: string) => Promise<string>
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
   * V2-UI-0.4 UI-2 — the injected 绑定已有目录 (Bind) inspect face
   * (UI-2B, plane-level). OPTIONAL: omitted → the OnboardingCard does not
   * offer the Bind journey (the T4.2 card stays as-is — tests + legacy
   * mounts). Resolves the wire result; rejects on any failure (the
   * journey's error line responds — NOTE-4 carrier match).
   */
  readonly inspectProjectDirectory?: (args: InspectProjectDirectoryArgs) => Promise<InspectProjectDirectoryResult>
  /**
   * V2-UI-0.4 UI-2 — the injected 新建研究项目 (Create) initialize face
   * (UI-2B, plane-level). Same OPTIONAL contract as the inspect face.
   * Resolves the strict result union (success arm / the ok:false
   * three-stage failure arm — the step failure RESOLVES, it does not
   * reject); pre-check faults REJECT (the NOTE-4 carrier in the message).
   */
  readonly createLocalResearchProject?: (args: CreateLocalResearchProjectArgs) => Promise<CreateLocalResearchProjectResult>
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
   * The injected 恢复登记 mutation (V2-T5.4, design §7.4 ③ →
   * `restoreProject`, §12 row 7): the 登记册 book's 已归档 row action. The
   * host renames `<treeDir>.archived-<archivedAt>` BACK to `<treeDir>`,
   * re-activates the registry entry (status active, archivedAt null), and
   * re-validates via re-init (a MANAGED classification is required —
   * otherwise the host rejects and the book shows the fault line). The
   * wire takes ONLY the `projectId` (the archived entry's id). On success
   * the book re-fetches (the row flips 已归档 → 正常). Rejects on any
   * failure (the book shows the error and keeps the row).
   */
  readonly restoreProject: (args: RestoreProjectArgs) => Promise<RestoreProjectResult>
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
  /**
   * The injected transient-snapshot read (V2-T5.3, design §7.3 — the V1
   * investigator channel repositioned: plugin-owned host command
   * `/research-transient-read` over the DSH `commands/execute` gateway —
   * ZERO new RPCs). Resolves the DTO; rejects on any failure (the page's
   * status-bar fault line responds).
   */
  readonly readInvestigatorTransient: (targetSessionId: string) => Promise<InvestigatorTransientDto>
  /**
   * The injected saved-record list (the V1 channel's `/research-analysis-
   * list` — host truth, createdAt ASC). Resolves the DTO list; rejects on
   * any failure (the page's records fault line responds — the fail-loud
   * 「数据面不可用」 face, e.g. a multi-project plane with no command
   * binding).
   */
  readonly loadAnalysisRecords: () => Promise<readonly AnalysisRecordDto[]>
  /**
   * The injected user-explicit save (the V1 channel's `/research-analysis-
   * save` — the host 用户门 is INV-PERM-3; the ONLY caller is the page's
   * 保存对话框 确认). Resolves the saved DTO; rejects on any failure (the
   * dialog stays open with the fault).
   */
  readonly saveAnalysisRecord: (args: SaveAnalysisRecordArgs) => Promise<AnalysisRecordDto>
}

/** The shell's fetch lifecycle (the loading / failed / ready faces). */
type PlanePhase = 'loading' | 'failed' | 'ready'

/**
 * The 4 first-level entries of the 中枢控制台 (design §6 — 一级入口恒为 4
 * 个, 四种角色视图共用标签名). The naming is 定案-locked (§6: 总览（非
 * 「首页」）、重要事件、调查员、设置).
 *
 * UI-3 (plan D §9 / wireframe B §2.1 frozen IA): the LABELS converge to
 * the frozen IA names via the t() copy table — 总览→Portfolio, 重要事件
 * →Needs Attention, 设置→Settings — and the NAV renders only the 3
 * VISIBLE entries (investigator is hidden from the first level, B §2.1,
 * but stays in the union + the page switch: the one-click investigate
 * wrapper below still jumps there programmatically — B §2.1 forbids a
 * first-tier ENTRY, not the programmatic deep-link).
 */
const HUB_ENTRIES = [
  { id: 'overview', label: t('nav.portfolio') },
  { id: 'attention', label: t('nav.needsAttention') },
  { id: 'investigator', label: '调查员' },
  { id: 'settings', label: t('nav.settings') },
] as const

type HubEntryId = (typeof HUB_ENTRIES)[number]['id']

/**
 * The entries the first-tier NAV renders (UI-3 D1: 4 → 3 visible). The
 * `investigator` entry is deliberately excluded from this list but KEPT in
 * `HUB_ENTRIES` (the type source) and in the ConsoleFrame page switch, so
 * the programmatic deep-link (`setNavEntry('investigator')` after a
 * successful 一键调查) keeps working.
 */
const VISIBLE_HUB_ENTRIES: readonly (typeof HUB_ENTRIES)[number][] = HUB_ENTRIES.filter(
  entry => entry.id !== 'investigator'
)

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
  // V2-T5.2: the console frame's active first-level entry, LIFTED out of
  // ConsoleFrame so the 重要事件 page's 空态 light action (「去看工作流
  // 进展」) can jump the frame back to the 总览 console. Reset to 总览 on
  // re-fetch — the same rule as the drill target (the plane may have
  // changed under a stale entry).
  const [navEntry, setNavEntry] = useState<HubEntryId>('overview')
  // V2-T5.3 (design §7.3): the 调查员 page's binding — the launched
  // investigator session + the intervention that launched it. CLIENT-
  // OWNED UI state (the V1 cockpit kept the launched session in per-mount
  // state too — same semantics, new home); there is NO wire for it. It is
  // WRITTEN only by a successful 一键调查 (the wrapper below parses the
  // launched session id from the V1 channel's success text — the shared
  // single-source parser, no client guessing) and CLEARED by 解绑 or a
  // record-chain session re-bind. Deliberately NOT reset on plane re-
  // fetch: the binding is a pointer to a LIVE host session, not a plane
  // fact — a re-fetch cannot invalidate it (the page's transient face
  // answers the disposed case with the honest 「不在 live 列表」 label).
  const [investigatorBinding, setInvestigatorBinding] = useState<InvestigatorBinding | null>(null)
  // The 一键调查 wrapper (all console roles): the V1 channel face, plus
  // the V2-T5.3 binding capture — on success the shell (1) binds the
  // launched session to the launching intervention and (2) jumps the
  // frame to the 调查员 entry (the V1 cockpit's auto-navigation after a
  // launch, repositioned). The face STILL resolves the success text
  // unchanged — the 重要事件 row renders exactly as before.
  const investigateWithBinding = (item: PortfolioInterventionItemDto, question: string): Promise<string> =>
    props
      .onInvestigate(item, question)
      .then((text) => {
        const launched = parseInvestigationSessionId(text)
        if (launched !== null) {
          setInvestigatorBinding({ sessionId: launched, interventionId: item.id, interventionTitle: item.title })
          setNavEntry('investigator')
        }
        return text
      })
  // The 调查员 page's navigation callbacks (all console roles): the 反链
  // (binding row + the record-chain intervention link) jumps to 重要事件;
  // 解绑 clears the binding (no RPC — client state); a record-chain
  // session link re-binds the page (the record's sourceRef rides along as
  // the new origin when it is an intervention — the title is unknown on
  // this path, id only).
  const onOpenIntervention = (): void => {
    setNavEntry('attention')
  }
  const onUnbindInvestigator = (): void => {
    setInvestigatorBinding(null)
  }
  const onBindInvestigatorSession = (sessionId: string, sourceRef?: AnalysisTypedRef): void => {
    setInvestigatorBinding({
      sessionId,
      interventionId: sourceRef !== undefined && sourceRef.kind === 'INTERVENTION' ? sourceRef.id : null,
      interventionTitle: null,
    })
  }

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
   *
   * `keepNav` (V2-T5.4): the HUB 设置 book actions (重验 / 恢复登记 /
   * 移除登记) re-fetch WITHOUT leaving the 设置 entry — the role cannot
   * flip under a HUB book action (the book mutates other projects, never
   * the hub itself), so the lifted nav entry stays where the user is.
   * The default (nav → 总览, drill → wall) stays for every role-flipping
   * mutation (the card flows, 解除绑定, 接入).
   */
  const refresh = useCallback((options?: { keepNav?: boolean }) => {
    // A re-fetch may change the plane under a stale HUB drill target —
    // the drill resets to the card wall (V2-T5.1). The lifted nav entry
    // resets to 总览 for the same reason (the role may have flipped under
    // a stale entry — V2-T5.2), unless keepNav pins the console entry.
    setHubDrillProjectId(null)
    if (options?.keepNav !== true) setNavEntry('overview')
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
            createLocalResearchProject={props.createLocalResearchProject}
            inspectProjectDirectory={props.inspectProjectDirectory}
            loadPortfolioInterventions={() => props.loadPortfolioInterventions({})}
            onOpenAttention={() => setNavEntry('attention')}
          />
        ) : (
          <ProjectConsole onBackToWall={() => setHubDrillProjectId(null)} />
        )
      // V2-T5.2 — 重要事件 = 纯干预流 (design §7.2): the HUB role is the
      // PORTFOLIO view (scopeProjectId null — every card carries its 项目
      // 标签). 项目标签 / 工作流 chip 钻取 lands the user in the item's
      // project console: the drill target is set AND the frame jumps to
      // 总览 (the console is the 总览 body while the drill is active).
      const attention = (
        <InterventionStreamPage
          role="HUB"
          scopeProjectId={null}
          loadPortfolioInterventions={props.loadPortfolioInterventions}
          updateInterventionState={props.updateInterventionState}
          onInvestigate={investigateWithBinding}
          onOpenProject={(projectId) => {
            setHubDrillProjectId(projectId)
            setNavEntry('overview')
          }}
          onGoToWorkstreams={() => setNavEntry('overview')}
        />
      )
      // V2-T5.3 (design §7.3, A 案) — 调查员 = 调查管理 + 分析记录: the
      // resident 只读引导条 (the §7.3 portfolio/neutral framing), the 绑定
      // 来源行 (the client-lifted binding + the intervention 反链 + 解绑),
      // the 瞬态面板 collapsed into the status bar (run status + 转录
      // 指引), the record list (溯源链 + 对象类型过滤). The data face is
      // the V1 channel (zero new RPCs — see the injected faces).
      const investigator = (
        <InvestigatorPage
          role="HUB"
          binding={investigatorBinding}
          onUnbind={onUnbindInvestigator}
          onOpenIntervention={onOpenIntervention}
          onBindSession={onBindInvestigatorSession}
          readTransient={props.readInvestigatorTransient}
          loadRecords={props.loadAnalysisRecords}
          saveRecord={props.saveAnalysisRecord}
        />
      )
      // V2-T5.4 (design §7.4) — 设置 = 四段式管理面 (HUB: the FULL ①②③④,
      // the 登记册 included). The book actions re-fetch with `keepNav` —
      // the HUB role cannot flip under a book action, so the user stays
      // on the 设置 entry while the book re-renders over the fresh state.
      const settings = (
        <SettingsPage
          role="HUB"
          cwd={effective.cwd}
          plane={plane}
          rescan={props.rescan}
          bindProject={props.bindProject}
          setHub={props.setHub}
          unbindProject={props.unbindProject}
          restoreProject={props.restoreProject}
          onApplied={() => refresh({ keepNav: true })}
        />
      )
      branch = (
        <ConsoleFrame
          role="HUB"
          overview={overview}
          attention={attention}
          investigator={investigator}
          settings={settings}
          active={navEntry}
          onActivate={(id) => {
            setNavEntry(id)
            // Any nav-tab click re-enters 总览 at the card wall (the
            // T5.1 drill-reset rule, unchanged).
            setHubDrillProjectId(null)
          }}
        />
      )
      break
    }
    case 'MANAGED':
    case 'STANDALONE':
      // V2-T5.1 — 同构收窄控制台 (design §5): the SAME 4-entry frame; 总览
      // = the EXISTING project page (brief + 目标 + topic list) AS ROOT —
      // no aggregate strip, no back affordance. The drill chain
      // 项目→主题→工作流→历史 stays inside the console.
      //
      // V2-T5.2 — 重要事件 限本项目 (design §7.2): the SAME page, CLIENT-
      // SIDE filtered to the session's own project — its projectId is
      // derived from the plane state (session cwd → the plane project
      // whose wsPath matches; NO new wire field, §12.1 routing rides the
      // frozen RPCs). The host's role resolution already guarantees the
      // match exists; a missing one is a state fault (fail-loud, the HUB
      // null-cwd rule).
      const scopeProject = effective.cwd === null ? undefined : plane.projects.find((p) => p.wsPath === effective.cwd)
      const attention =
        scopeProject === undefined ? (
          <p className={styles.faultLine} role="alert">
            研究平面状态异常：当前项目未解析
          </p>
        ) : (
          <InterventionStreamPage
            role={effective.role}
            scopeProjectId={scopeProject.projectId}
            loadPortfolioInterventions={props.loadPortfolioInterventions}
            updateInterventionState={props.updateInterventionState}
            onInvestigate={investigateWithBinding}
            onGoToWorkstreams={() => setNavEntry('overview')}
          />
        )
      // V2-T5.3 (design §7.3) — 调查员 for the project roles: the SAME
      // page, PROJECT-SCOPED like the V1 investigator (the data face is
      // the plane's single-project wiring, the §7.3 project framing on the
      // 只读引导条).
      const investigator = (
        <InvestigatorPage
          role={effective.role}
          binding={investigatorBinding}
          onUnbind={onUnbindInvestigator}
          onOpenIntervention={onOpenIntervention}
          onBindSession={onBindInvestigatorSession}
          readTransient={props.readInvestigatorTransient}
          loadRecords={props.loadAnalysisRecords}
          saveRecord={props.saveAnalysisRecord}
        />
      )
      // V2-T5.4 (design §7.4) — 设置 收窄版 for the project roles: ①②④,
      // NO 登记册 (the book is HUB-only, the §5 状态表 row). The plain
      // refresh (NO keepNav): 解除绑定 flips MANAGED → UNREGISTERED (the
      // 引导卡 face), 接入 flips STANDALONE → MANAGED and lands on 总览
      // (design §8 接入: 「进入项目视图」), 设为中枢 flips STANDALONE →
      // HUB (the 中枢控制台 frame) — all role flips, the nav-reset is the
      // documented rule.
      const settings = (
        <SettingsPage
          role={effective.role}
          cwd={effective.cwd}
          plane={plane}
          rescan={props.rescan}
          bindProject={props.bindProject}
          setHub={props.setHub}
          unbindProject={props.unbindProject}
          restoreProject={props.restoreProject}
          onApplied={refresh}
        />
      )
      branch = (
        <ConsoleFrame
          role={effective.role}
          cwd={effective.cwd ?? undefined}
          overview={<ProjectConsole />}
          attention={attention}
          investigator={investigator}
          settings={settings}
          active={navEntry}
          onActivate={setNavEntry}
        />
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
          inspectProjectDirectory={props.inspectProjectDirectory}
          createLocalResearchProject={props.createLocalResearchProject}
          onApplied={refresh}
        />
      )
      break
    case 'NO_CWD':
      branch = (
        <OnboardingCard
          narrowed
          wsPath={null}
          hub={plane.hub}
          dirNames={plane.dirNames}
          setHub={props.setHub}
          bindProject={props.bindProject}
          inspectProjectDirectory={props.inspectProjectDirectory}
          createLocalResearchProject={props.createLocalResearchProject}
          onApplied={refresh}
        />
      )
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
 * itself AS ROOT); 重要事件 is the pure intervention stream (V2-T5.2,
 * design §7.2 — portfolio for HUB, 限本项目 for the project roles);
 * 调查员 is the repositioned V1 investigator (V2-T5.3, design §7.3).
 * 设置 is the 四段式管理面 (V2-T5.4, design §7.4 — ①②③④; the ③ 登记册
 * section is HUB-only inside the page, the 收窄版 ①②④ for the project
 * roles). The active
 * entry is LIFTED to the shell (V2-T5.2): the 重要事件 page's 空态 light
 * action (「去看工作流进展」) jumps the frame back to 总览, which the
 * frame can only do when the shell owns the state (V2-T5.3: a successful
 * 一键调查 jumps it to the 调查员 entry the same way). The frame, the nav,
 * and the first-level entries MUST render from this task on.
 *
 * UI-3 (D1): the NAV renders the 3 VISIBLE entries (Portfolio / Needs
 * Attention / Settings — frozen IA names via t()); the 调查员 entry stays
 * in the union + the page switch for the programmatic deep-link only.
 */
interface ConsoleFrameProps {
  readonly role: 'HUB' | 'MANAGED' | 'STANDALONE'
  /** The session cwd (data attribute only — the MANAGED/STANDALONE
   *  branch keeps the T4.x data-cwd contract; HUB omits it). */
  readonly cwd?: string
  readonly overview: ReactElement
  /** The 重要事件 page body (V2-T5.2 — all three console roles). */
  readonly attention: ReactElement
  /** The 调查员 page body (V2-T5.3 — all three console roles). */
  readonly investigator: ReactElement
  /** The 设置 page body (V2-T5.4 — all three console roles; the ③ 登记册
   *  section is HUB-only INSIDE the page — the 收窄版 ①②④ for the
   *  project roles is the page's own role matrix, not the frame's). */
  readonly settings: ReactElement
  /** The active first-level entry (owned by the shell). */
  readonly active: HubEntryId
  /** Fired on every nav-tab click with the target entry (the shell
   *  updates its lifted state + resets the HUB drill there). */
  readonly onActivate: (id: HubEntryId) => void
}

function ConsoleFrame({ role, cwd, overview, attention, investigator, settings, active, onActivate }: ConsoleFrameProps): ReactElement {
  const activeLabel = HUB_ENTRIES.find((e) => e.id === active)?.label ?? '总览'
  return (
    <div className={styles.shell} data-role={role} data-cwd={cwd}>
      <header className={styles.hubHeader}>
        <h1 className={styles.hubTitle}>{t('app.title')}</h1>
        <nav className={styles.nav} aria-label="研究控制台一级入口">
          {VISIBLE_HUB_ENTRIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === active ? styles.navActive : styles.navItem}
              aria-current={entry.id === active ? 'page' : undefined}
              onClick={() => onActivate(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </header>
      <section className={styles.pageBody} data-page={active} aria-label={`${activeLabel}页`}>
        {active === 'overview'
          ? overview
          : active === 'attention'
            ? attention
            : active === 'investigator'
              ? investigator
              : settings}
      </section>
    </div>
  )
}

