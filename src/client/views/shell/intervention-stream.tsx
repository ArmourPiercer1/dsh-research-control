/**
 * V2-T5.2 — 重要事件 = 纯干预流 page (design §7.2 — the ASCII layout is
 * the spec; the history timeline is NOT moved here, §7.2 构成).
 *
 * The 重要事件 page body of the 中枢控制台 frame (all three console roles):
 *  - HUB          → portfolio view: cross-project stream, every card
 *    carries the 项目标签 (the item's `displayName` — hub mode only,
 *    clickable → the item's project console);
 *  - MANAGED /    → the SAME page, 限本项目: the stream is filtered
 *    STANDALONE     CLIENT-SIDE to the session's own project (the shell
 *    derives its projectId from the plane state — session cwd → the
 *    plane project whose wsPath matches; NO new wire field, §12.1 the
 *    frozen RPCs are already project-routable via `projectId`).
 *
 * The data is `getPortfolioInterventions` (design §12 row 3) through the
 * INJECTED plain-promise face (the production binding in
 * `dsh-adapter/ui.ts` folds the carrier's `ok: false` branch into a
 * rejection — the view never sees a `RemoteResult`; INV-PERM-5: pure
 * props/React, no @deepseek-ai import). Status segments (the §7.2 状态段
 * 过滤): 待处理 (OPEN) + 待确认 (PENDING) are the DEFAULT view (the
 * host's no-status call — OPEN group first, then PENDING, 组内时间倒序);
 * 已关闭 (CLOSED) is FOLDED — not fetched and not rendered until its
 * segment is expanded (the explicit-status call, cached across toggles).
 * Segment clicks filter the default view (click the active segment again
 * to return to the union default).
 *
 * Actions go through the FROZEN `updateInterventionState` RPC — the §13
 * state machine (mirrored exactly from the V1 intervention board,
 * `views/intervention/` — same enabled/disabled matrix, same 关闭必填
 * 备注 discipline, same no-local-patch rule):
 *   OPEN    → 一键调查 / 标记处理中(→PENDING) / 关闭(→CLOSED, 备注必填)
 *   PENDING → 确认关闭(→CLOSED, 备注必填) / 重开(→OPEN)
 *   CLOSED  → 无动作（终态 — 重开 = 新 Intervention, 冻结表无出口）
 * 一键调查 is the V1 investigation channel (NOT a state transition — §13
 * 不动, 两个独立操作面): per-row question input + the same blank-question
 * = fault + 零调用 discipline; success shows the channel's success text
 * (carries the launched investigator session id — transient 输出口径),
 * failure shows the fault row.
 *
 * After ANY successful mutation the page RE-FETCHES (the host is the
 * single source of truth — no local patch, the V1 invalidation rule's
 * client-owned-data equivalent): the default view always, the CLOSED
 * view when it has been loaded (a 确认关闭 moves an item INTO it).
 *
 * 空态 (design §7.2): the stream (default view) empty → 「当前没有需要
 * 处理的事件」 + the light action 「去看工作流进展」 (the shell jumps
 * the frame back to the 总览 console); a segment-filtered empty group →
 * the per-group 暂无 copy (the group itself does not vanish, the V1
 * empty-group discipline).
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'

import type {
  GetPortfolioInterventionsArgs,
  GetPortfolioInterventionsResult,
  PortfolioInterventionItemDto,
  UpdateInterventionStateArgs,
  UpdateInterventionStateResult,
} from '../../../shared/rpc-contracts.js'
import styles from './intervention-stream.module.css'

/** The page's fetch lifecycle (the loading / failed / ready faces). */
type StreamPhase = 'loading' | 'failed' | 'ready'

/** The 状态段 filter state: the default union view or one status filter. */
export type SegmentFilter = 'DEFAULT' | 'OPEN' | 'PENDING'

/**
 * Intervention origin → 中文文案（与 V1 干预列表 ORIGIN_LABEL 同款措辞 —
 * views/intervention/InterventionGroupsList.tsx 对照, 零派生表）。
 */
export const ORIGIN_LABEL: Record<PortfolioInterventionItemDto['origin'], string> = {
  USER: '用户',
  AGENT_REPORT: 'Agent 报告',
  AUTO_FLOODING: '自动洪泛检测',
  AUTO_AUDIT: '自动审计',
}

/**
 * epoch ms → 相对时间（design §7.2 卡片字段「2 小时前」; the V1 views are
 * absolute-date only, so this page owns the relative carrier — a pure
 * function, `now` injectable for the tests):
 *   < 1 分钟 → 刚刚; < 1 小时 → N 分钟前; < 24 小时 → N 小时前;
 *   < 30 天 → N 天前; 更远 → YYYY-MM-DD (the absolute fallback — a
 *   relative label past a month is noise).
 */
export function formatRelativeTime(epochMs: number, now: number = Date.now()): string {
  const delta = now - epochMs
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return '刚刚'
  if (delta < hour) return `${String(Math.floor(delta / minute))} 分钟前`
  if (delta < day) return `${String(Math.floor(delta / hour))} 小时前`
  if (delta < 30 * day) return `${String(Math.floor(delta / day))} 天前`
  const d = new Date(epochMs)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const dayPart = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${dayPart}`
}

/**
 * Props of the 重要事件 page.
 *
 * @param props - `role` selects the card 项目标签 (HUB only);
 *  `scopeProjectId` is the session's own project for the MANAGED /
 *  STANDALONE 限本项目 filter (`null` = HUB portfolio, no filter);
 *  the two RPC faces are plain business promises (resolve the strict
 *  wire result, reject on ANY failure — the failure face responds);
 *  `onInvestigate` is the 一键调查 channel face (resolves the success
 *  text, rejects with the structured error text); the optional
 *  navigation callbacks land in the shell (HUB: 项目标签/chips drill
 *  into the item's project; all roles: 去看工作流进展 jumps the frame
 *  back to the 总览 console).
 */
export interface InterventionStreamPageProps {
  readonly role: 'HUB' | 'MANAGED' | 'STANDALONE'
  /** The 限本项目 scope (MANAGED/STANDALONE); null = the HUB portfolio. */
  readonly scopeProjectId: string | null
  readonly loadPortfolioInterventions: (
    args: GetPortfolioInterventionsArgs,
  ) => Promise<GetPortfolioInterventionsResult>
  readonly updateInterventionState: (
    args: UpdateInterventionStateArgs,
  ) => Promise<UpdateInterventionStateResult>
  /** 一键调查 (OPEN cards): resolves the success text, rejects on failure. */
  readonly onInvestigate: (item: PortfolioInterventionItemDto, question: string) => Promise<string>
  /** HUB only: 项目标签 / 工作流 chip → the item's project console. */
  readonly onOpenProject?: (projectId: string) => void
  /** 空态轻动作 / 项目角色的工作流 chip → the 总览 console. */
  readonly onGoToWorkstreams?: () => void
}

/** One card's transient per-row state (the V1 board's local UI 态). */
export interface InterventionRowState {
  readonly note: string
  readonly question: string
  readonly busy: boolean
  readonly investigating: boolean
  readonly fault: string | null
  readonly investigated: string | null
}

const EMPTY_ROW: InterventionRowState = {
  note: '',
  question: '',
  busy: false,
  investigating: false,
  fault: null,
  investigated: null,
}

export function InterventionStreamPage(props: InterventionStreamPageProps): ReactElement {
  const {
    role,
    scopeProjectId,
    loadPortfolioInterventions,
    updateInterventionState,
    onInvestigate,
    onOpenProject,
    onGoToWorkstreams,
  } = props
  const [data, setData] = useState<GetPortfolioInterventionsResult | null>(null)
  // The folded CLOSED view (fetched lazily on first segment expand; kept
  // while the page is mounted so a collapse/expand does not re-fetch).
  const [closed, setClosed] = useState<GetPortfolioInterventionsResult | null>(null)
  // The CLOSED view's own fault line (a failed CLOSED fetch does NOT kill
  // the live default view — stale-while-revalidate, same face as the
  // default view's refresh fault).
  const [closedError, setClosedError] = useState<string | null>(null)
  const [phase, setPhase] = useState<StreamPhase>('loading')
  // A failed REFRESH over live data (stale data stays rendered + the fault
  // row explains; the [刷新] button is the retry affordance) — the same
  // face the 总览 page pins (hub-overview.tsx).
  const [refreshError, setRefreshError] = useState<string | null>(null)
  // The 状态段 filter (design §7.2: 默认展示待处理+待确认).
  const [segment, setSegment] = useState<SegmentFilter>('DEFAULT')
  // The 已关闭段 folded/expanded (CLOSED cards render ONLY while expanded).
  const [closedExpanded, setClosedExpanded] = useState(false)
  // Per-row transient state (notes/questions/busy/fault — the V1 board's
  // 本地 UI 态, keyed by intervention id).
  const [rows, setRows] = useState<ReadonlyMap<string, InterventionRowState>>(new Map())
  // In-flight promise slots: StrictMode's double effect reuses the FIRST
  // in-flight fetch of each view instead of issuing a second one (the
  // shell's one-fetch-per-load invariant, the hub-overview pattern).
  const defaultInflight = useRef<Promise<GetPortfolioInterventionsResult> | null>(null)
  const closedInflight = useRef<Promise<GetPortfolioInterventionsResult> | null>(null)
  // The inject faces are read through refs so a re-render with a fresh
  // binding never leaks a stale closure into the effect.
  const loadRef = useRef(props.loadPortfolioInterventions)
  loadRef.current = props.loadPortfolioInterventions

  /**
   * Fetch ONE wire view: the default (OPEN+PENDING) or the explicit
   * status. `initial` selects the lifecycle on the default view: the
   * first load runs the loading face; a REFRESH keeps the stale data
   * rendered and only records a fault on failure (stale-while-revalidate,
   * the 总览 刷新 contract).
   */
  const runFetch = useCallback((args: GetPortfolioInterventionsArgs, initial: boolean): void => {
    const slot = args.status === 'CLOSED' ? closedInflight : defaultInflight
    if (slot.current !== null) return
    if (initial) {
      setPhase('loading')
    }
    if (args.status !== 'CLOSED') {
      setRefreshError(null)
    }
    const pending = loadRef.current(args)
    slot.current = pending
    void pending
      .then((result) => {
        if (slot.current !== pending) return
        if (args.status === 'CLOSED') {
          setClosed(result)
          setClosedError(null)
        } else {
          setData(result)
          setPhase('ready')
        }
      })
      .catch((err: unknown) => {
        if (slot.current !== pending) return
        const message = err instanceof Error ? err.message : String(err)
        if (args.status === 'CLOSED') {
          // The CLOSED view's fault line — the default view stays live.
          setClosedError(message)
        } else if (initial) {
          setPhase('failed')
        } else {
          // Stale data stays (the fault row is the response).
          setRefreshError(message)
        }
      })
      .finally(() => {
        if (slot.current === pending) slot.current = null
      })
  }, [])

  useEffect(() => {
    if (defaultInflight.current === null) {
      runFetch({}, true)
    }
    // One default-view fetch per mount — the ref-deduped runFetch is stable.
  }, [runFetch])

  /** The post-mutation RE-FETCH (the host is the single source of truth —
   *  no local patch): the default view always, the CLOSED view when it
   *  has been loaded (a 确认关闭 moves an item into it). */
  const refetch = useCallback((): void => {
    runFetch({}, false)
    if (closed !== null) {
      runFetch({ status: 'CLOSED' }, false)
    }
  }, [closed, runFetch])

  if (phase === 'loading') {
    return (
      <div className={styles.stream} data-attention-stream data-phase="loading">
        <p className={styles.statusLine} role="status">
          正在加载重要事件…
        </p>
      </div>
    )
  }

  if (phase === 'failed' || data === null) {
    return (
      <div className={styles.stream} data-attention-stream data-phase="failed">
        <p className={styles.faultLine} role="alert">
          重要事件加载失败
        </p>
        <div className={styles.toolbar}>
          <button type="button" className={styles.refreshButton} data-attention-refresh onClick={() => runFetch({}, true)}>
            刷新
          </button>
        </div>
      </div>
    )
  }

  // 限本项目 (MANAGED/STANDALONE): the client-side scope filter — the
  // session's own project only (the HUB portfolio view is unfiltered).
  const scoped = scopeProjectId === null ? data.items : data.items.filter((i) => i.projectId === scopeProjectId)
  const openItems = scoped.filter((i) => i.status === 'OPEN')
  const pendingItems = scoped.filter((i) => i.status === 'PENDING')
  // The default view in the §7.2 状态段 order: OPEN group first, then
  // PENDING (组内时间倒序 — the host already sorts; the two-group order is
  // the segment order). The segment filter narrows the default view.
  const visible = segment === 'DEFAULT' ? [...openItems, ...pendingItems] : scoped.filter((i) => i.status === segment)
  const streamEmpty = openItems.length === 0 && pendingItems.length === 0
  const closedItems =
    closed === null ? [] : closed.items.filter((i) => scopeProjectId === null || i.projectId === scopeProjectId)

  const setRow = (id: string, patch: Partial<InterventionRowState>): void => {
    setRows((prev) => {
      const next = new Map(prev)
      next.set(id, { ...EMPTY_ROW, ...prev.get(id), ...patch })
      return next
    })
  }

  /** 状态迁移 (the frozen §13 machine — the V1 board's matrix verbatim):
   *  关闭 requires a non-blank 备注 (「关闭时用户填写」§9.2 — 缺备注 =
   *  fault + 零调用); success re-fetches (no local patch). */
  const handleTransition = (item: PortfolioInterventionItemDto, status: 'OPEN' | 'PENDING' | 'CLOSED'): void => {
    const row = rows.get(item.id) ?? EMPTY_ROW
    if (row.busy) return
    if (status === 'CLOSED') {
      const note = row.note.trim()
      if (note === '') {
        setRow(item.id, { fault: '关闭时请填写处理备注' })
        return
      }
      setRow(item.id, { busy: true, fault: null })
      void updateInterventionState({
        interventionId: item.id,
        status,
        projectId: item.projectId,
        resolutionNote: note,
      }).then(
        () => {
          setRow(item.id, { busy: false, fault: null })
          refetch()
        },
        (err: unknown) => {
          setRow(item.id, { busy: false, fault: err instanceof Error ? err.message : String(err) })
        },
      )
      return
    }
    setRow(item.id, { busy: true, fault: null })
    void updateInterventionState({ interventionId: item.id, status, projectId: item.projectId }).then(
      () => {
        setRow(item.id, { busy: false, fault: null })
        refetch()
      },
      (err: unknown) => {
        setRow(item.id, { busy: false, fault: err instanceof Error ? err.message : String(err) })
      },
    )
  }

  /** 一键调查 (V1 通道 — NOT a state transition): blank question = fault
   *  + 零调用 (the V1 board's discipline verbatim); success text shows on
   *  the row (carries the launched investigator session id). */
  const handleInvestigate = (item: PortfolioInterventionItemDto): void => {
    const row = rows.get(item.id) ?? EMPTY_ROW
    if (row.busy || row.investigating) return
    const question = row.question.trim()
    if (question === '') {
      setRow(item.id, { fault: '一键调查请填写调查问题' })
      return
    }
    setRow(item.id, { investigating: true, fault: null, investigated: null })
    void onInvestigate(item, question).then(
      (text) => {
        setRow(item.id, { investigating: false, investigated: text })
      },
      (err: unknown) => {
        setRow(item.id, { investigating: false, fault: err instanceof Error ? err.message : String(err) })
      },
    )
  }

  /** The 已关闭段 expand: the FIRST expansion fetches the explicit-status
   *  view (host side: 组内时间倒序); later toggles reuse the cache — while
   *  no data is loaded (incl. after a failure) an expand retries. */
  const handleClosedSegment = (): void => {
    if (!closedExpanded && closed === null) {
      runFetch({ status: 'CLOSED' }, false)
    }
    setClosedExpanded((v) => !v)
  }

  const renderCard = (item: PortfolioInterventionItemDto): ReactElement => {
    const row = rows.get(item.id) ?? EMPTY_ROW
    const isHub = role === 'HUB'
    return (
      <li
        key={item.id}
        className={styles.card}
        data-attention-card
        data-iv-id={item.id}
        data-iv-status={item.status}
        data-iv-origin={item.origin}
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
              title={`进入 ${item.displayName}`}
              onClick={() => onOpenProject?.(item.projectId)}
            >
              {item.displayName}
            </button>
          )}
        </p>
        <p className={styles.cardMeta}>
          <span className={styles.originBadge} data-iv-origin-badge>
            {ORIGIN_LABEL[item.origin]}
          </span>
          {item.workstreamIds.length > 0 && (
            <>
              {' · 涉及 '}
              {item.workstreamIds.map((wsId) => (
                <button
                  key={wsId}
                  type="button"
                  className={styles.wsChip}
                  data-iv-ws-chip={wsId}
                  title="查看所属工作流"
                  onClick={() => (isHub ? onOpenProject?.(item.projectId) : onGoToWorkstreams?.())}
                >
                  {wsId}
                </button>
              ))}
            </>
          )}
          {' · '}
          <span data-iv-time>{formatRelativeTime(item.createdAt)}</span>
        </p>
        {item.status !== 'CLOSED' && (
          <>
            <p className={styles.controls}>
              {item.status === 'OPEN' && (
                <>
                  <input
                    className={styles.rowInput}
                    data-iv-question={item.id}
                    value={row.question}
                    placeholder="调查问题（一键调查必填）"
                    onChange={(e) => setRow(item.id, { question: e.target.value })}
                  />
                  <button
                    type="button"
                    className={styles.button}
                    data-iv-action="investigate"
                    data-iv-id={item.id}
                    disabled={row.busy || row.investigating}
                    onClick={() => handleInvestigate(item)}
                  >
                    {row.investigating ? '调查中…' : '一键调查'}
                  </button>
                </>
              )}
              {item.status === 'OPEN' && (
                <button
                  type="button"
                  className={styles.button}
                  data-iv-action="pending"
                  data-iv-id={item.id}
                  disabled={row.busy}
                  onClick={() => handleTransition(item, 'PENDING')}
                >
                  {row.busy ? '处理中…' : '标记处理中'}
                </button>
              )}
              {item.status === 'PENDING' && (
                <button
                  type="button"
                  className={styles.button}
                  data-iv-action="confirm-close"
                  data-iv-id={item.id}
                  disabled={row.busy}
                  onClick={() => handleTransition(item, 'CLOSED')}
                >
                  {row.busy ? '处理中…' : '确认关闭'}
                </button>
              )}
              {item.status === 'PENDING' && (
                <button
                  type="button"
                  className={styles.button}
                  data-iv-action="reopen"
                  data-iv-id={item.id}
                  disabled={row.busy}
                  onClick={() => handleTransition(item, 'OPEN')}
                >
                  {row.busy ? '处理中…' : '重开'}
                </button>
              )}
              <input
                className={styles.rowInput}
                data-iv-note={item.id}
                value={row.note}
                placeholder="关闭备注（必填）"
                onChange={(e) => setRow(item.id, { note: e.target.value })}
              />
              {item.status === 'OPEN' && (
                <button
                  type="button"
                  className={styles.button}
                  data-iv-action="close"
                  data-iv-id={item.id}
                  disabled={row.busy}
                  onClick={() => handleTransition(item, 'CLOSED')}
                >
                  {row.busy ? '处理中…' : '关闭'}
                </button>
              )}
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

  return (
    <div className={styles.stream} data-attention-stream data-phase="ready" data-role={role}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.refreshButton}
          data-attention-refresh
          onClick={() => {
            runFetch({}, false)
            if (closed !== null || closedError !== null) {
              runFetch({ status: 'CLOSED' }, false)
            }
          }}
        >
          刷新
        </button>
      </div>
      {refreshError !== null && (
        <p className={styles.refreshFault} role="alert">
          刷新失败：{refreshError}
        </p>
      )}
      {/* 状态段过滤 (design §7.2): 待处理/待确认 default union; 已关闭 folded
          (▾/▴) — the CLOSED view is fetched on first expansion only. */}
      <div className={styles.segments} data-attention-segments>
        <button
          type="button"
          className={styles.segment}
          data-attention-segment="OPEN"
          aria-pressed={segment === 'OPEN'}
          onClick={() => setSegment((s) => (s === 'OPEN' ? 'DEFAULT' : 'OPEN'))}
        >
          待处理 {String(openItems.length)}
        </button>
        <button
          type="button"
          className={styles.segment}
          data-attention-segment="PENDING"
          aria-pressed={segment === 'PENDING'}
          onClick={() => setSegment((s) => (s === 'PENDING' ? 'DEFAULT' : 'PENDING'))}
        >
          待确认 {String(pendingItems.length)}
        </button>
        <button
          type="button"
          className={styles.segment}
          data-attention-segment="CLOSED"
          aria-pressed={closedExpanded}
          onClick={handleClosedSegment}
        >
          已关闭 {closedExpanded ? '▴' : '▾'}
        </button>
      </div>
      {visible.length > 0 ? (
        <ul className={styles.cards} data-attention-cards>
          {visible.map(renderCard)}
        </ul>
      ) : (
        <div className={styles.emptyState} data-attention-empty>
          {streamEmpty ? (
            <>
              <p className={styles.emptyTitle}>当前没有需要处理的事件</p>
              {onGoToWorkstreams !== undefined && (
                <button type="button" className={styles.button} data-attention-go-workstreams onClick={onGoToWorkstreams}>
                  去看工作流进展
                </button>
              )}
            </>
          ) : (
            <p className={styles.emptyTitle}>{segment === 'OPEN' ? '暂无待处理事件' : '暂无待确认事件'}</p>
          )}
        </div>
      )}
      {closedExpanded && (
        <section className={styles.closedSection} data-attention-closed-section>
          <h3 className={styles.closedHeading}>已关闭</h3>
          {closedError !== null && closedItems.length === 0 && (
            <p className={styles.refreshFault} role="alert">
              已关闭列表加载失败：{closedError}
            </p>
          )}
          {closedItems.length > 0 ? (
            <ul className={styles.cards}>{closedItems.map(renderCard)}</ul>
          ) : closedError === null ? (
            <p className={styles.emptyTitle} data-attention-closed-empty>
              暂无已关闭事件
            </p>
          ) : null}
        </section>
      )}
    </div>
  )
}

/**
 * The page's visible-card projection (scope + segment filter, pure —
 * exported so the component test pins the same rule the render uses
 * without re-implementing it): the 限本项目 scope first, then the §7.2
 * 状态段 order (OPEN group, then PENDING; a segment filter narrows to
 * that group only — CLOSED is NOT part of the default view).
 */
export function visibleInterventionIds(
  items: readonly PortfolioInterventionItemDto[],
  scopeProjectId: string | null,
  segment: SegmentFilter,
): readonly string[] {
  const scoped = scopeProjectId === null ? items : items.filter((i) => i.projectId === scopeProjectId)
  const open = scoped.filter((i) => i.status === 'OPEN')
  const pending = scoped.filter((i) => i.status === 'PENDING')
  return (segment === 'DEFAULT' ? [...open, ...pending] : scoped.filter((i) => i.status === segment)).map((i) => i.id)
}
