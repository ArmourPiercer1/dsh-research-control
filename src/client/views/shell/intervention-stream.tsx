/**
 * V2-T5.2 重要事件 — evolved IN PLACE into the V2-UI-0.4 UI-8 UNIFIED
 * Needs Attention page (D §14 / B §27-§31; ADJ-5 in-place evolution:
 * the intervention-stream behavior survives as a SUBSET — the t52
 * selector surface (data-attention-*, data-iv-*, the 状态段 buttons,
 * the IV card's Chinese action row) is preserved byte-compatible).
 *
 * The 重要事件 page body of the 中枢控制台 frame (all three console
 * roles):
 *  - HUB          → the cross-project unified list (every card carries
 *    the project label — the projects map's `displayName`, hub mode
 *    only, clickable → the item's project console);
 *  - MANAGED /    → the SAME page, 限本项目: the fetch itself is
 *    STANDALONE     project-scoped (the shell passes its own
 *    scopeProjectId into the `queryAttention` args — ADJ-4 mgmt leg).
 *
 * The data is the 59th registered invocation `queryAttention` (D §14
 * unified read projection) through the INJECTED plain-promise face
 * (the production binding in `dsh-adapter/ui.ts` folds the carrier's
 * `ok: false` branch into a rejection — the view never sees a
 * `RemoteResult`; INV-PERM-5: pure props/React, no @deepseek-ai
 * import). ONE fetch per mount (the host returns the FULL combination
 * — the 5 kinds, scored items in rank order, terminals appended
 * createdAt-desc, limit 200); the page PARTITIONS the host order into
 * the three B §27.1 groups CLIENT-SIDE and applies the five B §27.1
 * filters CLIENT-SIDE (INV-ATTN-1: the host's total order is never
 * re-sorted — filtering keeps the relative order).
 *
 * B §27.1 groups (ADJ-9 locked mapping — the segment semantics):
 *  - 待处理 (segment OPEN)   = status {OPEN, ACTIVE, PROPOSED}: IV
 *    OPEN, explicit BLK ACTIVE, derived BLK (const ACTIVE), NA
 *    PROPOSED, missing-NA (const OPEN) — every non-terminal;
 *  - 待确认 (segment PENDING) = status PENDING: IV PENDING only;
 *  - 已关闭 (folded)          = the terminals ONLY (IV CLOSED, BLK
 *    CLEARED, NA PROMOTED / DISMISSED) — expanded locally (NO second
 *    fetch), the host's createdAt-desc terminal order kept.
 *
 * B §27.1 filters (ADJ-9: single-select, exact match, NO semantic
 * normalization; [Workstream] options CASCADE from [Project]):
 *  - [Project]    — the projects map (HUB: all; project roles: one);
 *  - [Workstream] — derived from the FETCHED items (zero new wire);
 *  - [Type]       — the 5 kind tokens;
 *  - [Status]     — the 8-value wire union (exact `DTO.status` match);
 *  - [Priority]   — the 3-band tokens.
 *
 * Actions (B §28/§29/§30 — mutation is NOT unified, D §14.4): the IV
 * cards keep the FROZEN §13 machine verbatim (一键调查 / 标记处理中 /
 * 关闭 [备注必填] / 确认关闭 / 重开 — same enabled/disabled matrix,
 * same 关闭必填备注 discipline, same no-local-patch rule, the frozen
 * `updateInterventionState` RPC); the other kinds render their
 * host-granted `allowedActions` onto EXISTING faces (clearBlocker /
 * promoteNextAction / dismissNextAction / createNextAction — zero new
 * RPCs; the openWorkstream / openCause / openTask tokens are pure
 * client navigation, degraded to the owning project/console — the
 * nav carries no highlight parameter, ADJ-6). B §31 missing-NA cards
 * carry the FROZEN three verbatim lines + the inline create form
 * (createNextAction — no synthetic NextAction object is ever created
 * until the user does, D §14.3 red line).
 *
 * After ANY successful mutation the page RE-FETCHES (the host is the
 * single source of truth — no local patch). 空态 (design §7.2, kept):
 * the default view empty → 「当前没有需要处理的事件」 + the light
 * action 「去看工作流进展」; a filter/segment-narrowed empty group →
 * the per-group 暂无 copy (the group itself does not vanish, the V1
 * empty-group discipline).
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'

import type {
  AttentionItemDto,
  AttentionItemDtoKind,
  AttentionPriority,
  ClearBlockerArgs,
  ClearBlockerResult,
  CreateNextActionArgs,
  CreateNextActionResult,
  DismissNextActionArgs,
  DismissNextActionResult,
  PromoteNextActionArgs,
  PromoteNextActionResult,
  QueryAttentionArgs,
  QueryAttentionResult,
  UpdateInterventionStateArgs,
  UpdateInterventionStateResult,
} from '../../../shared/rpc-contracts.js'
import { t } from '../../i18n/copy.js'
import { useProjectReadonly } from '../../components/readonly-context.js'
import { formatRelativeTime } from '../../i18n/datetime.js'
import styles from './intervention-stream.module.css'

/** The page's fetch lifecycle (the loading / failed / ready faces). */
type StreamPhase = 'loading' | 'failed' | 'ready'

/** The 状态段 filter state: the default union view or one status filter. */
export type SegmentFilter = 'DEFAULT' | 'OPEN' | 'PENDING'

/** The B §27.1 group of one item (ADJ-9 locked mapping — status words
 *  are matched EXACTLY, no semantic normalization). */
export type AttentionGroup = 'OPEN' | 'PENDING' | 'CLOSED'

/** The single-fetch window (the host's terminal-append keeps every
 *  combination inside it; the page never pages — client filters only). */
const FETCH_LIMIT = 200

/** ADJ-9: the [Status] filter's value set = the 8-value wire union
 *  (exact match; derived = const 'ACTIVE', missing = const 'OPEN'). */
export const ATTENTION_STATUS_VALUES: readonly string[] = [
  'OPEN',
  'PENDING',
  'CLOSED',
  'ACTIVE',
  'CLEARED',
  'PROPOSED',
  'PROMOTED',
  'DISMISSED',
]

/** The [Type] filter's value set = the 5 kind tokens. */
export const ATTENTION_KIND_VALUES: readonly AttentionItemDtoKind[] = [
  'INTERVENTION',
  'EXPLICIT_BLOCKER',
  'DERIVED_BLOCKER',
  'NEXT_ACTION',
  'MISSING_NEXT_ACTION',
]

/** The [Priority] filter's value set = the 3-band tokens. */
export const ATTENTION_PRIORITY_VALUES: readonly AttentionPriority[] = ['HIGH', 'MEDIUM', 'LOW']

/** B §27.1 group partition (pure — exported for the component tests):
 *  RECON §27 table — OPEN/ACTIVE group = OPEN IV + ACTIVE BLK
 *  (explicit + derived) + PROPOSED NA + MISSING-NA (the non-terminals,
 *  every one still actionable); PENDING group = PENDING IV; the folded
 *  group = the terminals ONLY (CLOSED IV / CLEARED BLK / PROMOTED +
 *  DISMISSED NA). */
export function attentionGroupOf(item: AttentionItemDto): AttentionGroup {
  if (item.status === 'PENDING') return 'PENDING'
  if (item.status === 'OPEN' || item.status === 'ACTIVE' || item.status === 'PROPOSED') return 'OPEN'
  return 'CLOSED'
}

/** The B §27.1 filter state (empty string = that axis unfiltered). */
export interface AttentionFilters {
  readonly project: string
  readonly workstream: string
  readonly type: string
  readonly status: string
  readonly priority: string
}

export const EMPTY_FILTERS: AttentionFilters = {
  project: '',
  workstream: '',
  type: '',
  status: '',
  priority: '',
}

/** ADJ-9 single-select exact-match filter (pure — host order kept). */
export function applyAttentionFilters(
  items: readonly AttentionItemDto[],
  scopeProjectId: string | null,
  filters: AttentionFilters,
): readonly AttentionItemDto[] {
  return items.filter(
    (i) =>
      (scopeProjectId === null || i.projectId === scopeProjectId) &&
      (filters.project === '' || i.projectId === filters.project) &&
      (filters.workstream === '' || i.workstreamId === filters.workstream) &&
      (filters.type === '' || i.kind === filters.type) &&
      (filters.status === '' || i.status === filters.status) &&
      (filters.priority === '' || i.priority === filters.priority),
  )
}

/** The intervention origin wire word (the frozen 4-value union — the
 *  unified DTO's `context.intervention.origin` is a plain string; the
 *  label table keys are this union, an unknown word renders DIRECTLY,
 *  fail-soft, never a crash). */
type InterventionOrigin = 'USER' | 'AGENT_REPORT' | 'AUTO_FLOODING' | 'AUTO_AUDIT'

/**
 * Intervention origin → 中文文案（与 V1 干预列表 ORIGIN_LABEL 同款措辞 —
 * views/intervention/InterventionGroupsList.tsx 对照, 零派生表）。
 */
export const ORIGIN_LABEL: Record<InterventionOrigin, string> = {
  USER: t('attention.source.user'),
  AGENT_REPORT: t('attention.source.agentReport'),
  AUTO_FLOODING: t('attention.source.autoFlood'),
  AUTO_AUDIT: t('attention.source.autoAudit'),
}

/** B §27.2 Type badge labels (the attention.kind.* t() keys — display
 *  labels, never a translation; the wire tokens render directly). */
export const KIND_LABEL: Record<AttentionItemDtoKind, string> = {
  INTERVENTION: t('attention.kind.intervention'),
  EXPLICIT_BLOCKER: t('attention.kind.blocker'),
  DERIVED_BLOCKER: t('attention.kind.derivedBlocker'),
  NEXT_ACTION: t('attention.kind.nextAction'),
  MISSING_NEXT_ACTION: t('attention.kind.missingNextAction'),
}

/** B §27.2 priority band labels (the attention.priority.* t() keys). */
export const PRIORITY_LABEL: Record<AttentionPriority, string> = {
  HIGH: t('attention.priority.high'),
  MEDIUM: t('attention.priority.medium'),
  LOW: t('attention.priority.low'),
}

/**
 * epoch ms → 相对时间（design §7.2 卡片字段「2 小时前」). UI-9 ADJ-1:
 * the implementation moved to `src/client/i18n/datetime.ts` (catalog
 * labels via attention.relTime.*, locale-aware); re-exported here for
 * import stability (the stream tests import it from this module).
 * Default-locale output is byte-invariant.
 */
export { formatRelativeTime }

/**
 * The unified Needs Attention page (ADJ-5: the InterventionStreamPage
 * evolved in place — the component NAME stays so the shell's import is
 * stable; the IV card surface + the 状态段 buttons are the t52-pinned
 * subset).
 *
 * - `loadAttention` is the ONE data face (queryAttention — plain
 *   business promise: resolves the strict wire result, rejects on ANY
 *   failure — the failure face responds); ONE fetch per mount, limit
 *   200, project-scoped by the shell for the project roles;
 * - `projects` is the project directory for the [Project] filter and
 *   the HUB project labels (the shell derives it from the plane state —
 *   no new wire);
 * - `updateInterventionState` + `onInvestigate` are the IV action faces
 *   (the frozen §13 machine + the V1 一键调查 channel); the four
 *   OPTIONAL mutation faces (clearBlocker / promoteNextAction /
 *   dismissNextAction / createNextAction) serve the non-IV cards —
 *   omitted (a fixture) → that card's action button is NOT rendered
 *   (graceful; production always wires them, ui.ts inject);
 * - the optional navigation callbacks land in the shell (HUB: project
 *   label / chips / Open Workstream drill into the item's project
 *   console; all roles: 去看工作流进展 + the project-role chips jump
 *   the frame back to the 总览 console).
 */
export interface InterventionStreamPageProps {
  readonly role: 'HUB' | 'MANAGED' | 'STANDALONE'
  /** The 限本项目 scope (MANAGED/STANDALONE); null = the HUB portfolio. */
  readonly scopeProjectId: string | null
  /** D §14: the ONE unified fetch (replaces the old per-view fetches). */
  readonly loadAttention: (args: QueryAttentionArgs) => Promise<QueryAttentionResult>
  /** The project directory ([Project] filter + HUB card labels). */
  readonly projects: readonly { readonly projectId: string; readonly displayName: string }[]
  readonly updateInterventionState: (
    args: UpdateInterventionStateArgs,
  ) => Promise<UpdateInterventionStateResult>
  /** 一键调查 (IV OPEN cards): resolves the success text, rejects on
   *  failure. Structural input — the IV card passes `{id, title}` from
   *  the AttentionItemDto (sourceId / title). */
  readonly onInvestigate: (item: { readonly id: string; readonly title: string }, question: string) => Promise<string>
  /** B §29: explicit-BLK [Clear] (optional — unwired → button hidden). */
  readonly clearBlocker?: (args: ClearBlockerArgs) => Promise<ClearBlockerResult>
  /** B §30: NA [Promote] (optional — unwired → button hidden). */
  readonly promoteNextAction?: (args: PromoteNextActionArgs) => Promise<PromoteNextActionResult>
  /** B §30: NA [Dismiss] (optional — unwired → button hidden). */
  readonly dismissNextAction?: (args: DismissNextActionArgs) => Promise<DismissNextActionResult>
  /** B §31: missing-NA [Create Next Action] (optional — unwired → the
   *  CTA is hidden). */
  readonly createNextAction?: (args: CreateNextActionArgs) => Promise<CreateNextActionResult>
  /** HUB only: project label / workstream chip → the item's project
   *  console. */
  readonly onOpenProject?: (projectId: string) => void
  /** 空态轻动作 / project-role workstream chip → the 总览 console. */
  readonly onGoToWorkstreams?: () => void
}

/** One card's transient per-row state (the V1 board's local UI 态,
 *  extended with the B §31 inline create form). */
export interface AttentionRowState {
  readonly note: string
  readonly question: string
  readonly busy: boolean
  readonly investigating: boolean
  readonly fault: string | null
  readonly investigated: string | null
  /** The missing-NA inline create form is open. */
  readonly createOpen: boolean
  /** The missing-NA create form's statement draft. */
  readonly createStatement: string
}

const EMPTY_ROW: AttentionRowState = {
  note: '',
  question: '',
  busy: false,
  investigating: false,
  fault: null,
  investigated: null,
  createOpen: false,
  createStatement: '',
}

export function InterventionStreamPage(props: InterventionStreamPageProps): ReactElement {
  const {
    role,
    scopeProjectId,
    loadAttention,
    projects,
    updateInterventionState,
    onInvestigate,
    clearBlocker,
    promoteNextAction,
    dismissNextAction,
    createNextAction,
    onOpenProject,
    onGoToWorkstreams,
  } = props
  // UI-9 D4 (ADJ-11): the read-only surface — every state-transition /
  // blocker / next-action mutation control disables with the composed
  // reason as tooltip; browsing (filters / segments / navigation) stays.
  // In the HUB portfolio view (no provider in the tree) the default
  // context keeps this a no-op.
  const { readonly: readOnly, reasonText } = useProjectReadonly()
  const roTitle = reasonText ?? undefined
  const [data, setData] = useState<QueryAttentionResult | null>(null)
  const [phase, setPhase] = useState<StreamPhase>('loading')
  // A refresh failure (stale data stays rendered — stale-while-revalidate,
  // the 总览 刷新 contract).
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [segment, setSegment] = useState<SegmentFilter>('DEFAULT')
  const [closedExpanded, setClosedExpanded] = useState(false)
  const [filters, setFilters] = useState<AttentionFilters>(EMPTY_FILTERS)
  const [rows, setRows] = useState<ReadonlyMap<string, AttentionRowState>>(new Map())

  // In-flight slot: StrictMode's double effect reuses the FIRST in-flight
  // fetch instead of issuing a second one (the shell's one-fetch-per-load
  // invariant, the hub-overview pattern).
  const inflight = useRef<Promise<QueryAttentionResult> | null>(null)
  // The inject face is read through a ref so a re-render with a fresh
  // binding never leaks a stale closure into the effect.
  const loadRef = useRef(loadAttention)
  loadRef.current = loadAttention

  /**
   * The ONE fetch (the full combination — scored + terminals): `initial`
   * selects the lifecycle: the first load runs the loading face; a
   * REFRESH (or the post-mutation re-fetch) keeps the stale data
   * rendered and only records a fault on failure.
   */
  const runFetch = useCallback(
    (initial: boolean): void => {
      if (inflight.current !== null) return
      if (initial) {
        setPhase('loading')
      }
      setRefreshError(null)
      const args: QueryAttentionArgs =
        scopeProjectId === null
          ? { limit: FETCH_LIMIT }
          : { projectId: scopeProjectId, limit: FETCH_LIMIT }
      const pending = loadRef.current(args)
      inflight.current = pending
      void pending
        .then((result) => {
          if (inflight.current !== pending) return
          setData(result)
          setPhase('ready')
        })
        .catch((err: unknown) => {
          if (inflight.current !== pending) return
          const message = err instanceof Error ? err.message : String(err)
          if (initial) {
            setPhase('failed')
          } else {
            // Stale data stays (the fault row is the response).
            setRefreshError(message)
          }
        })
        .finally(() => {
          if (inflight.current === pending) inflight.current = null
        })
    },
    [scopeProjectId],
  )

  useEffect(() => {
    if (inflight.current === null) {
      runFetch(true)
    }
    // One unified fetch per mount — the ref-deduped runFetch is stable.
  }, [runFetch])

  /** The post-mutation RE-FETCH (the host is the single source of truth —
   *  no local patch; terminals ride the same list, no second fetch). */
  const refetch = useCallback((): void => {
    runFetch(false)
  }, [runFetch])

  const isHub = role === 'HUB'
  const projectName = (id: string): string =>
    projects.find((p) => p.projectId === id)?.displayName ?? id

  // ── The B §27.1 client-side partition (host order — never re-sorted) ──

  const items = data?.items ?? []
  const filtered = applyAttentionFilters(items, scopeProjectId, filters)
  const openItems = filtered.filter((i) => attentionGroupOf(i) === 'OPEN')
  const pendingItems = filtered.filter((i) => attentionGroupOf(i) === 'PENDING')
  const closedItems = filtered.filter((i) => attentionGroupOf(i) === 'CLOSED')
  const streamEmpty = openItems.length === 0 && pendingItems.length === 0

  /** The [Workstream] options CASCADE from [Project] (ADJ-9): the
   *  fetched items' non-null workstreamIds for the selected project
   *  (first-appearance = rank order — zero new wire). */
  const wsOptionsFor = (projectId: string): string[] => {
    const out: string[] = []
    for (const i of items) {
      if (scopeProjectId !== null && i.projectId !== scopeProjectId) continue
      if (projectId !== '' && i.projectId !== projectId) continue
      if (i.workstreamId !== null && !out.includes(i.workstreamId)) out.push(i.workstreamId)
    }
    return out
  }
  const workstreamOptions = wsOptionsFor(filters.project)

  const setFilter = (axis: keyof AttentionFilters, value: string): void => {
    setFilters((prev) => {
      // The [Project] change drops a [Workstream] selection the new
      // project scope no longer offers (single-select axes reset each
      // other — the rest of the row is kept).
      const dropWorkstream =
        axis === 'project' && value !== '' && !wsOptionsFor(value).includes(prev.workstream)
      return { ...prev, [axis]: value, ...(dropWorkstream ? { workstream: '' } : {}) }
    })
  }

  const setRow = (id: string, patch: Partial<AttentionRowState>): void => {
    setRows((prev) => {
      const next = new Map(prev)
      next.set(id, { ...EMPTY_ROW, ...prev.get(id), ...patch })
      return next
    })
  }

  /** Pure-client navigation (the openWorkstream / openCause / openTask
   *  tokens — B §28/§29/§30): HUB drills the item's project console; the
   *  project roles jump the frame back to the 总览 console. The nav
   *  carries no highlight parameter (ADJ-6 degradation — disclosed). */
  const handleNav = (item: AttentionItemDto): void => {
    if (isHub) {
      onOpenProject?.(item.projectId)
    } else {
      onGoToWorkstreams?.()
    }
  }

  /** 状态迁移 (the frozen §13 machine — the V1 board's matrix verbatim):
   *  关闭 requires a non-blank 备注 (「关闭时用户填写」§9.2 — 缺备注 =
   *  fault + 零调用); success re-fetches (no local patch). */
  const handleTransition = (item: AttentionItemDto, status: 'OPEN' | 'PENDING' | 'CLOSED'): void => {
    const row = rows.get(item.sourceId) ?? EMPTY_ROW
    if (row.busy) return
    if (status === 'CLOSED') {
      const note = row.note.trim()
      if (note === '') {
        setRow(item.sourceId, { fault: t('attention.closeNoteRequired') })
        return
      }
      setRow(item.sourceId, { busy: true, fault: null })
      void updateInterventionState({
        interventionId: item.sourceId,
        status,
        projectId: item.projectId,
        resolutionNote: note,
      }).then(
        () => {
          setRow(item.sourceId, { busy: false, fault: null })
          refetch()
        },
        (err: unknown) => {
          setRow(item.sourceId, { busy: false, fault: err instanceof Error ? err.message : String(err) })
        },
      )
      return
    }
    setRow(item.sourceId, { busy: true, fault: null })
    void updateInterventionState({ interventionId: item.sourceId, status, projectId: item.projectId }).then(
      () => {
        setRow(item.sourceId, { busy: false, fault: null })
        refetch()
      },
      (err: unknown) => {
        setRow(item.sourceId, { busy: false, fault: err instanceof Error ? err.message : String(err) })
      },
    )
  }

  /** 一键调查 (V1 通道 — NOT a state transition): blank question = fault
   *  + 零调用 (the V1 board's discipline verbatim); success text shows on
   *  the row (carries the launched investigator session id). */
  const handleInvestigate = (item: AttentionItemDto): void => {
    const row = rows.get(item.sourceId) ?? EMPTY_ROW
    if (row.busy || row.investigating) return
    const question = row.question.trim()
    if (question === '') {
      setRow(item.sourceId, { fault: t('attention.investigatePromptRequired') })
      return
    }
    setRow(item.sourceId, { investigating: true, fault: null, investigated: null })
    void onInvestigate({ id: item.sourceId, title: item.title }, question).then(
      (text) => {
        setRow(item.sourceId, { investigating: false, investigated: text })
      },
      (err: unknown) => {
        setRow(item.sourceId, { investigating: false, fault: err instanceof Error ? err.message : String(err) })
      },
    )
  }

  /** The non-IV mutation wrapper (B §29/§30/§31 — existing faces):
   *  busy row → fault line on rejection → RE-FETCH on success (no local
   *  patch; the item migrates groups or vanishes). */
  const mutate = (
    item: AttentionItemDto,
    call: () => Promise<unknown>,
    onSucceeded?: Partial<AttentionRowState>,
  ): void => {
    const row = rows.get(item.sourceId) ?? EMPTY_ROW
    if (row.busy) return
    setRow(item.sourceId, { busy: true, fault: null })
    void call().then(
      () => {
        setRow(item.sourceId, { busy: false, fault: null, ...(onSucceeded ?? {}) })
        refetch()
      },
      (err: unknown) => {
        setRow(item.sourceId, { busy: false, fault: err instanceof Error ? err.message : String(err) })
      },
    )
  }

  const handleClearBlocker = (item: AttentionItemDto): void => {
    if (clearBlocker === undefined) return
    mutate(item, () => clearBlocker({ blockerId: item.sourceId, projectId: item.projectId }))
  }
  const handlePromoteNextAction = (item: AttentionItemDto): void => {
    if (promoteNextAction === undefined) return
    mutate(item, () =>
      promoteNextAction({
        nextActionId: item.sourceId,
        ...(item.workstreamId !== null ? { workstreamId: item.workstreamId } : {}),
        projectId: item.projectId,
      }),
    )
  }
  const handleDismissNextAction = (item: AttentionItemDto): void => {
    if (dismissNextAction === undefined) return
    mutate(item, () => dismissNextAction({ nextActionId: item.sourceId, projectId: item.projectId }))
  }
  const handleCreateNextAction = (item: AttentionItemDto): void => {
    if (createNextAction === undefined) return
    const row = rows.get(item.sourceId) ?? EMPTY_ROW
    const statement = row.createStatement.trim()
    if (statement === '') return
    mutate(
      item,
      () =>
        createNextAction({
          ...(item.workstreamId !== null ? { workstreamId: item.workstreamId } : {}),
          statement,
          projectId: item.projectId,
        }),
      { createOpen: false, createStatement: '' },
    )
  }

  const renderIvCard = (item: AttentionItemDto): ReactElement => {
    const row = rows.get(item.sourceId) ?? EMPTY_ROW
    const origin = item.context.intervention?.origin
    const originLabel =
      origin !== undefined && origin in ORIGIN_LABEL ? ORIGIN_LABEL[origin as InterventionOrigin] : origin ?? ''
    const label = projectName(item.projectId)
    return (
      <li
        className={styles.card}
        data-attention-card
        data-iv-id={item.sourceId}
        data-iv-status={item.status}
        data-iv-origin={origin ?? ''}
        data-iv-project={item.projectId}
      >
        <p className={styles.cardTitle}>
          <span className={styles.cardIcon} aria-hidden>
            ⚠
          </span>{' '}
          <span data-iv-title>{item.title}</span>
          {isHub && (
            <button
              type="button"
              className={styles.projectTag}
              data-iv-project-label
              title={t('attention.enter', { label })}
              onClick={() => onOpenProject?.(item.projectId)}
            >
              {label}
            </button>
          )}
        </p>
        <p className={styles.cardMeta}>
          <span className={styles.originBadge} data-iv-origin-badge>
            {originLabel}
          </span>
          {item.workstreamId !== null && (
            <>
              {t('attention.involves')}
              <button
                type="button"
                className={styles.wsChip}
                data-iv-ws-chip={item.workstreamId}
                title={t('attention.viewWorkstream')}
                onClick={() => handleNav(item)}
              >
                {item.workstreamId}
              </button>
            </>
          )}
          {' · '}
          <span data-iv-time>{formatRelativeTime(item.createdAt)}</span>
        </p>
        {/* B §27.2 common fields (UI-8 additive — the t52 surface above
            is untouched): Type badge / Status / priority + Why shown
            here (the host's reason line). */}
        <p className={styles.cardMeta}>
          <span className={styles.originBadge} data-iv-kind-badge>
            {KIND_LABEL[item.kind]}
          </span>
          <span className={styles.originBadge} data-iv-status-badge>
            {item.status}
          </span>
          <span className={styles.originBadge} data-iv-priority-badge>
            {PRIORITY_LABEL[item.priority]}
          </span>
        </p>
        <p className={styles.cardReason} data-iv-reason>
          {t('attention.whyShown')}: {item.reason}
        </p>
        {item.status !== 'CLOSED' && (
          <>
            <p className={styles.controls}>
              {item.status === 'OPEN' && (
                <>
                  <input
                    className={styles.rowInput}
                    data-iv-question={item.sourceId}
                    value={row.question}
                    placeholder={t('attention.investigatePromptLabel')}
                    disabled={readOnly}
                    onChange={(e) => setRow(item.sourceId, { question: e.target.value })}
                  />
                  <button
                    type="button"
                    className={styles.button}
                    data-iv-action="investigate"
                    data-iv-id={item.sourceId}
                    disabled={readOnly || row.busy || row.investigating}
                    title={readOnly ? roTitle : undefined}
                    onClick={() => handleInvestigate(item)}
                  >
                    {row.investigating ? t('attention.investigating') : t('attention.oneClickInvestigate')}
                  </button>
                  <button
                    type="button"
                    className={styles.button}
                    data-iv-action="pending"
                    data-iv-id={item.sourceId}
                    disabled={readOnly || row.busy}
                    title={readOnly ? roTitle : undefined}
                    onClick={() => handleTransition(item, 'PENDING')}
                  >
                    {row.busy ? t('common.processing') : t('attention.markInProgress')}
                  </button>
                </>
              )}
              {item.status === 'PENDING' && (
                <button
                  type="button"
                  className={styles.button}
                  data-iv-action="confirm-close"
                  data-iv-id={item.sourceId}
                  disabled={readOnly || row.busy}
                  title={readOnly ? roTitle : undefined}
                  onClick={() => handleTransition(item, 'CLOSED')}
                >
                  {row.busy ? t('common.processing') : t('attention.confirmClose')}
                </button>
              )}
              {item.status === 'PENDING' && (
                <button
                  type="button"
                  className={styles.button}
                  data-iv-action="reopen"
                  data-iv-id={item.sourceId}
                  disabled={readOnly || row.busy}
                  title={readOnly ? roTitle : undefined}
                  onClick={() => handleTransition(item, 'OPEN')}
                >
                  {row.busy ? t('common.processing') : t('attention.reopen')}
                </button>
              )}
              <input
                className={styles.rowInput}
                data-iv-note={item.sourceId}
                value={row.note}
                placeholder={t('attention.closeNoteLabel')}
                disabled={readOnly}
                onChange={(e) => setRow(item.sourceId, { note: e.target.value })}
              />
              {item.status === 'OPEN' && (
                <button
                  type="button"
                  className={styles.button}
                  data-iv-action="close"
                  data-iv-id={item.sourceId}
                  disabled={readOnly || row.busy}
                  title={readOnly ? roTitle : undefined}
                  onClick={() => handleTransition(item, 'CLOSED')}
                >
                  {row.busy ? t('common.processing') : t('attention.close')}
                </button>
              )}
            </p>
            {/* B §28: the close note records the HUMAN-HANDLING decision
                (not a claim that the research question is resolved) —
                the attention.closeNotePrompt wording (RECON §10.3). */}
            <p className={styles.closeNotePrompt} data-iv-close-note-prompt>
              {t('attention.closeNotePrompt')}
            </p>
            {row.fault !== null && (
              <p className={styles.rowFault} data-iv-fault role="alert">
                {row.fault}
              </p>
            )}
            {row.investigated !== null && (
              <p className={styles.investigatedLine} data-iv-investigated>
                {row.investigated}
              </p>
            )}
          </>
        )}
      </li>
    )
  }

  /** The B §29/§30 generic action row (non-IV kinds — the host-granted
   *  allowedActions; the IV kinds' tokens are the legacy machine above). */
  const renderGenericActions = (item: AttentionItemDto): ReactElement | null => {
    const row = rows.get(item.sourceId) ?? EMPTY_ROW
    const nav = (token: string, labelKey: 'attention.action.openWorkstream' | 'attention.action.openCause' | 'attention.action.openTask'): ReactElement => (
      <button
        type="button"
        className={styles.button}
        data-item-action={token}
        data-item-id={item.sourceId}
        onClick={() => handleNav(item)}
      >
        {t(labelKey)}
      </button>
    )
    const buttons: ReactElement[] = []
    for (const a of item.allowedActions) {
      if (a === 'clearBlocker' && clearBlocker !== undefined) {
        buttons.push(
          <button
            key={a}
            type="button"
            className={styles.button}
            data-item-action="clearBlocker"
            data-item-id={item.sourceId}
            disabled={readOnly || row.busy}
            title={readOnly ? roTitle : undefined}
            onClick={() => handleClearBlocker(item)}
          >
            {t('attention.action.clearBlocker')}
          </button>,
        )
      } else if (a === 'promoteNextAction' && promoteNextAction !== undefined) {
        buttons.push(
          <button
            key={a}
            type="button"
            className={styles.button}
            data-item-action="promoteNextAction"
            data-item-id={item.sourceId}
            disabled={readOnly || row.busy}
            title={readOnly ? roTitle : undefined}
            onClick={() => handlePromoteNextAction(item)}
          >
            {t('attention.action.promoteNextAction')}
          </button>,
        )
      } else if (a === 'dismissNextAction' && dismissNextAction !== undefined) {
        buttons.push(
          <button
            key={a}
            type="button"
            className={styles.button}
            data-item-action="dismissNextAction"
            data-item-id={item.sourceId}
            disabled={readOnly || row.busy}
            title={readOnly ? roTitle : undefined}
            onClick={() => handleDismissNextAction(item)}
          >
            {t('attention.action.dismissNextAction')}
          </button>,
        )
      } else if (a === 'openWorkstream') {
        buttons.push(nav(a, 'attention.action.openWorkstream'))
      } else if (a === 'openCause') {
        buttons.push(nav(a, 'attention.action.openCause'))
      } else if (a === 'openTask') {
        buttons.push(nav(a, 'attention.action.openTask'))
      }
      // markPending / closeIntervention / reopenIntervention / createNextAction
      // are IV / missing-NA surfaces (legacy controls + the B §31 CTA).
    }
    if (buttons.length === 0) return null
    return <p className={styles.controls}>{buttons}</p>
  }

  /** The B §31 missing-NA card: the FROZEN three verbatim lines + the
   *  inline create form (createNextAction — the ONLY way a real
   *  NextAction object enters the store; D §14.3 red line). */
  const renderMissingCard = (item: AttentionItemDto): ReactElement => {
    const row = rows.get(item.sourceId) ?? EMPTY_ROW
    const label = projectName(item.projectId)
    return (
      <li
        className={styles.card}
        data-attention-card
        data-kind="MISSING_NEXT_ACTION"
        data-item-id={item.sourceId}
        data-item-status={item.status}
        data-item-project={item.projectId}
      >
        <p className={styles.cardTitle}>
          <span className={styles.cardIcon} aria-hidden>
            ⚠
          </span>{' '}
          <span data-item-title>
            {t('attention.missing.title')}
          </span>
          {isHub && (
            <button
              type="button"
              className={styles.projectTag}
              data-item-project-label
              title={t('attention.enter', { label })}
              onClick={() => onOpenProject?.(item.projectId)}
            >
              {label}
            </button>
          )}
        </p>
        <p className={styles.missingBody} data-missing-body>
          {t('attention.missing.body')}
        </p>
        <p className={styles.cardMeta}>
          <span className={styles.originBadge} data-item-kind-badge>
            {KIND_LABEL.MISSING_NEXT_ACTION}
          </span>
          <span className={styles.originBadge} data-item-status-badge>
            {item.status}
          </span>
          {item.workstreamId !== null && (
            <>
              {' · '}
              <button
                type="button"
                className={styles.wsChip}
                data-item-ws-chip={item.workstreamId}
                title={t('attention.viewWorkstream')}
                onClick={() => handleNav(item)}
              >
                {item.workstreamId}
              </button>
            </>
          )}
          {' · '}
          <span data-item-time>{formatRelativeTime(item.detectedAt)}</span>
        </p>
        {row.createOpen ? (
          <p className={styles.controls} data-missing-form>
            <input
              className={styles.rowInput}
              data-missing-statement
              value={row.createStatement}
              placeholder={t('attention.create.statement')}
              disabled={readOnly}
              onChange={(e) => setRow(item.sourceId, { createStatement: e.target.value })}
            />
            <button
              type="button"
              className={styles.button}
              data-missing-create
              disabled={readOnly || row.busy || row.createStatement.trim() === ''}
              title={readOnly ? roTitle : undefined}
              onClick={() => handleCreateNextAction(item)}
            >
              {t('attention.create.submit')}
            </button>
            <button
              type="button"
              className={styles.button}
              data-missing-cancel
              onClick={() => setRow(item.sourceId, { createOpen: false, createStatement: '', fault: null })}
            >
              {t('dialog.cancel')}
            </button>
          </p>
        ) : (
          <p className={styles.controls}>
            {createNextAction !== undefined && (
              <button
                type="button"
                className={styles.button}
                data-missing-cta
                disabled={readOnly || row.busy}
                title={readOnly ? roTitle : undefined}
                onClick={() => setRow(item.sourceId, { createOpen: true })}
              >
                {t('attention.missing.cta')}
              </button>
            )}
          </p>
        )}
        {row.fault !== null && (
          <p className={styles.rowFault} data-item-fault role="alert">
            {row.fault}
          </p>
        )}
      </li>
    )
  }

  /** The B §27.2 common-field card (EXPLICIT_BLOCKER / DERIVED_BLOCKER /
   *  NEXT_ACTION): Type badge / Title / Project / Workstream / Why shown
   *  here / Created-detected / Status / primary + secondary actions. */
  const renderKindCard = (item: AttentionItemDto): ReactElement => {
    const row = rows.get(item.sourceId) ?? EMPTY_ROW
    const label = projectName(item.projectId)
    const derived = item.context.derivedBlocker?.primaryAction
    const promotedTask = item.context.nextAction?.promotedToTaskId
    return (
      <li
        className={styles.card}
        data-attention-card
        data-kind={item.kind}
        data-item-id={item.sourceId}
        data-item-status={item.status}
        data-item-project={item.projectId}
      >
        <p className={styles.cardTitle}>
          <span className={styles.cardIcon} aria-hidden>
            •
          </span>{' '}
          <span data-item-title>{item.title}</span>
          {isHub && (
            <button
              type="button"
              className={styles.projectTag}
              data-item-project-label
              title={t('attention.enter', { label })}
              onClick={() => onOpenProject?.(item.projectId)}
            >
              {label}
            </button>
          )}
        </p>
        <p className={styles.cardMeta}>
          <span className={styles.originBadge} data-item-kind-badge>
            {KIND_LABEL[item.kind]}
          </span>
          <span className={styles.originBadge} data-item-status-badge>
            {item.status}
          </span>
          <span className={styles.originBadge} data-item-priority-badge>
            {PRIORITY_LABEL[item.priority]}
          </span>
          {item.workstreamId !== null && (
            <>
              {' · '}
              <button
                type="button"
                className={styles.wsChip}
                data-item-ws-chip={item.workstreamId}
                title={t('attention.viewWorkstream')}
                onClick={() => handleNav(item)}
              >
                {item.workstreamId}
              </button>
            </>
          )}
          {' · '}
          <span data-item-time>{formatRelativeTime(item.detectedAt)}</span>
        </p>
        <p className={styles.cardReason} data-item-reason>
          {t('attention.whyShown')}: {item.reason}
        </p>
        {/* B §29: the derived blocker shows its CAUSE (the source label —
            no "Clear derived blocker" is ever offered). B §30: a
            PROMOTED next action shows the generated Task explicitly. */}
        {derived !== undefined && (
          <p className={styles.cardReason} data-item-cause>
            {derived.label}
          </p>
        )}
        {promotedTask !== null && (
          <p className={styles.cardReason} data-item-task>
            {promotedTask}
          </p>
        )}
        {renderGenericActions(item)}
        {row.fault !== null && (
          <p className={styles.rowFault} data-item-fault role="alert">
            {row.fault}
          </p>
        )}
      </li>
    )
  }

  const renderCard = (item: AttentionItemDto): ReactElement => {
    if (item.kind === 'INTERVENTION') return renderIvCard(item)
    if (item.kind === 'MISSING_NEXT_ACTION') return renderMissingCard(item)
    return renderKindCard(item)
  }

  const renderGroup = (
    group: 'OPEN' | 'PENDING',
    heading: string,
    groupItems: readonly AttentionItemDto[],
    emptyLine: string,
  ): ReactElement => (
    <section className={styles.group} data-attention-group={group}>
      <h2 className={styles.groupHeading} data-attention-group-heading={group}>
        {heading}
      </h2>
      {groupItems.length > 0 ? (
        <ul className={styles.cards} data-attention-cards>
          {groupItems.map(renderCard)}
        </ul>
      ) : (
        <p className={styles.emptyTitle} data-attention-group-empty={group}>
          {emptyLine}
        </p>
      )}
    </section>
  )

  if (phase === 'loading') {
    return (
      <div className={styles.stream} data-attention-stream data-phase="loading">
        <p className={styles.statusLine} role="status">
          {t('attention.loading')}
        </p>
      </div>
    )
  }

  if (phase === 'failed' || data === null) {
    return (
      <div className={styles.stream} data-attention-stream data-phase="failed">
        {/* UI-9 D3: the B §33.3 error-state hooks. The adapter folds the
            queryAttention rejection to a plain message (no decodable
            carrier), so the code stays 'unknown'; dataChanged is 'none'
            BY CONSTRUCTION (this is a read) and the [刷新] button below IS
            the user-initiated re-fetch. */}
        <p
          className={styles.faultLine}
          role="alert"
          data-error-state="unknown"
          data-error-code="unknown"
          data-error-data-changed="none"
        >
          {t('attention.loadError')}
        </p>
        <div className={styles.toolbar}>
          <button type="button" className={styles.refreshButton} data-attention-refresh onClick={() => runFetch(true)}>
            {t('common.refresh')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.stream} data-attention-stream data-phase="ready" data-role={role}>
      <div className={styles.toolbar}>
        <h1 className={styles.pageTitle} data-attention-title>
          {t('attention.pageTitle')}
        </h1>
        <button
          type="button"
          className={styles.refreshButton}
          data-attention-refresh
          onClick={() => {
            runFetch(false)
          }}
        >
          {t('common.refresh')}
        </button>
      </div>
      {refreshError !== null && (
        // UI-9 D3: the B §33.3 error-state hooks on the stale-while-
        // revalidate fault line. The adapter's folded message carries no
        // decodable carrier (code 'unknown'); dataChanged is 'none' BY
        // CONSTRUCTION (a refresh is a read) and the [刷新] button above IS
        // the user-initiated re-fetch. The visible text is frozen by the
        // t52 tests.
        <p
          className={styles.refreshFault}
          role="alert"
          data-error-state="unknown"
          data-error-code="unknown"
          data-error-data-changed="none"
        >
          {t('common.refreshFailed', { detail: refreshError })}
        </p>
      )}
      {/* B §27.1 filter row (ADJ-9: single-select exact match; [Workstream]
          cascades from [Project]). */}
      <div className={styles.filters} data-attention-filters>
        <label className={styles.filterField}>
          {t('attention.filter.project')}
          <select
            className={styles.filterSelect}
            data-attention-filter="project"
            value={filters.project}
            onChange={(e) => setFilter('project', e.target.value)}
          >
            <option value="">{t('attention.filter.all')}</option>
            {projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.displayName} ({p.projectId})
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          {t('attention.filter.workstream')}
          <select
            className={styles.filterSelect}
            data-attention-filter="workstream"
            value={filters.workstream}
            onChange={(e) => setFilter('workstream', e.target.value)}
          >
            <option value="">{t('attention.filter.all')}</option>
            {workstreamOptions.map((wsId) => (
              <option key={wsId} value={wsId}>
                {wsId}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          {t('attention.filter.type')}
          <select
            className={styles.filterSelect}
            data-attention-filter="type"
            value={filters.type}
            onChange={(e) => setFilter('type', e.target.value)}
          >
            <option value="">{t('attention.filter.all')}</option>
            {ATTENTION_KIND_VALUES.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          {t('attention.filter.status')}
          <select
            className={styles.filterSelect}
            data-attention-filter="status"
            value={filters.status}
            onChange={(e) => setFilter('status', e.target.value)}
          >
            <option value="">{t('attention.filter.all')}</option>
            {ATTENTION_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          {t('attention.filter.priority')}
          <select
            className={styles.filterSelect}
            data-attention-filter="priority"
            value={filters.priority}
            onChange={(e) => setFilter('priority', e.target.value)}
          >
            <option value="">{t('attention.filter.all')}</option>
            {ATTENTION_PRIORITY_VALUES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {/* 状态段过滤 (B §27.1 三段 — the t52-pinned surface): 待处理/待确认
          default union; 已关闭 folded (▾/▴), expanded LOCALLY (the
          terminals ride the same single fetch — no second call). */}
      <div className={styles.segments} data-attention-segments>
        <button
          type="button"
          className={styles.segment}
          data-attention-segment="OPEN"
          aria-pressed={segment === 'OPEN'}
          onClick={() => setSegment((s) => (s === 'OPEN' ? 'DEFAULT' : 'OPEN'))}
        >
          {t('attention.groupPending', { n: String(openItems.length) })}
        </button>
        <button
          type="button"
          className={styles.segment}
          data-attention-segment="PENDING"
          aria-pressed={segment === 'PENDING'}
          onClick={() => setSegment((s) => (s === 'PENDING' ? 'DEFAULT' : 'PENDING'))}
        >
          {t('attention.groupPendingConfirm', { n: String(pendingItems.length) })}
        </button>
        <button
          type="button"
          className={styles.segment}
          data-attention-segment="CLOSED"
          aria-pressed={closedExpanded}
          onClick={() => setClosedExpanded((v) => !v)}
        >
          {t('attention.segment.closed')} {closedExpanded ? '▴' : '▾'}
        </button>
      </div>
      {streamEmpty && segment === 'DEFAULT' ? (
        <div className={styles.emptyState} data-attention-empty>
          <p className={styles.emptyTitle}>{t('attention.emptyPage')}</p>
          <p className={styles.emptyHint} data-attention-investigate-hint>
            {t('attention.emptyPageExplain')}
          </p>
          {onGoToWorkstreams !== undefined && (
            <button type="button" className={styles.button} data-attention-go-workstreams onClick={onGoToWorkstreams}>
              {t('attention.emptyPageButton')}
            </button>
          )}
        </div>
      ) : (
        <>
          {segment !== 'PENDING' &&
            renderGroup('OPEN', t('attention.group.openActive'), openItems, t('attention.emptyPending'))}
          {segment !== 'OPEN' &&
            renderGroup('PENDING', t('attention.group.pending'), pendingItems, t('attention.emptyPendingConfirm'))}
        </>
      )}
      {closedExpanded && (
        <section className={styles.closedSection} data-attention-closed-section data-attention-group="CLOSED">
          <h3 className={styles.closedHeading} data-attention-group-heading="CLOSED">
            {t('attention.group.closed')}
          </h3>
          {closedItems.length > 0 ? (
            <ul className={styles.cards}>{closedItems.map(renderCard)}</ul>
          ) : (
            <p className={styles.emptyTitle} data-attention-closed-empty>
              {t('attention.emptyClosed')}
            </p>
          )}
        </section>
      )}
    </div>
  )
}

/**
 * The page's visible-card projection (scope + the five filters + the
 * segment filter, pure — exported so the component test pins the same
 * rule the render uses without re-implementing it): the 限本项目 scope
 * first, then the B §27.1 group order (OPEN / ACTIVE group, then
 * PENDING; a segment filter narrows to that group only — the terminals
 * are NOT part of the default view, they expand locally).
 */
export function visibleAttentionIds(
  items: readonly AttentionItemDto[],
  scopeProjectId: string | null,
  filters: AttentionFilters,
  segment: SegmentFilter,
): readonly string[] {
  const filtered = applyAttentionFilters(items, scopeProjectId, filters)
  const open = filtered.filter((i) => attentionGroupOf(i) === 'OPEN')
  const pending = filtered.filter((i) => attentionGroupOf(i) === 'PENDING')
  return (segment === 'DEFAULT' ? [...open, ...pending] : filtered.filter((i) => attentionGroupOf(i) === segment)).map(
    (i) => i.sourceId,
  )
}
