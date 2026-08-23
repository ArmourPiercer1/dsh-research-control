/**
 * History timeline view — the CONTAINER (WP-4.4, the ONE store-pulling
 * file of the view; every component below it is pure props).
 *
 * Plan §27.4「Workstream Page 核心三区 — History」:
 *  - atomic timeline（事件流渲染）;
 *  - 双时序切换: semantic（默认 — 「重建科研时间线」）/ audit（「系统何时
 *    获知」）, catalog §2 — a tab;
 *  - wrapper 按 Run 聚合阅读（分组视图；底层事件不变 — catalog §3.7,
 *    INV-HIST-8; the grouping is the pure display projection
 *    run-group.ts);
 *  - 分页加载: 「加载更多」fetches the NEXT seq window through
 *    `store.loadHistory` — the seq-axis partition protocol
 *    (rpc-contracts §5 / host queryEvents): the cursor walks
 *    `afterSeq = previous page's nextAfterSeq` (the exclusive lower
 *    bound the host returns; `beforeSeq` is the protocol's optional
 *    upper bound and is not needed for forward load-more);
 *  - 事件类型徽标 / 演员 U/A/P 标识 (event-meta.ts).
 *
 * Data path (DSH_ADAPTER §6 — components never see ctx): the container
 * receives the `createResearchStore()` FACTORY HANDLE as a plain prop
 * (the slot wiring will pass it through the slot `store` option) and
 * reads its snapshot through the minimal binding hook
 * (use-research-store.ts — the one `useSyncExternalStore` of the view).
 * All six query slices' history windows live in the store snapshot; the
 * container only books WHICH windows it has requested (`pages`, local
 * pagination state) and re-derives the stream from the snapshot on every
 * render — so `refresh()`/`onRefetch` loops and stale-while-revalidate
 * propagate into this view for free (a failed refetch keeps the last good
 * page visible under an error banner; see the store, WP-4.1b).
 *
 * Pagination bookkeeping (local, outside the snapshot): `pages` is the
 * ordered list of requested windows — each with its canonical key
 * (`historyKey`) and the exact `QueryHistoryArgs` (the retry button
 * re-issues the last window from these). Reset on (workstreamId, order,
 * pageSize) change — a tab switch is a fresh reading, not a continuation.
 * 「加载更多」appends the next window (functional updater guards against a
 * double click; the store dedupes in-flight fetches per key, so a race
 * issues one fetch) and fires `loadHistory` with
 * `afterSeq = last page's nextAfterSeq`. A failed window shows a retry
 * button (stale-while-revalidate: the previously loaded pages stay
 * visible — the store keeps the last good data on the errored slice).
 *
 * No DSH imports (INV-PERM-5); product copy Chinese, comments English.
 */

import { useEffect, useState, type ReactElement } from 'react'
import {
  historyKey,
  type QueryHistoryArgs,
  type QueryHistoryResult,
  type ResearchStore,
  type SliceState,
} from '../../stores/index.js'
import { EventRow } from './EventRow.js'
import { RunGroupCard } from './RunGroupCard.js'
import { orderEvents, type HistoryOrder } from './ordered-events.js'
import { runGroups } from './run-group.js'
import { useResearchStore } from './use-research-store.js'
import styles from './styles.module.css'

/** The default page size in rows (plan §29: History 按页面/时间窗口分页;
 *  the host caps each window at afterSeq+limit — O(window) protocol). */
export const DEFAULT_PAGE_SIZE = 20

/** The two reading modes (task:「atomic 事件明细 + wrapper 按 Run 聚合」). */
export type HistoryViewMode = 'atomic' | 'runs'

/** Container props — the store is a FACTORY HANDLE (never the DSH ctx). */
export interface HistoryTimelineViewProps {
  /** The `createResearchStore()` result (injected — components don't see ctx). */
  readonly store: ResearchStore
  /** The single owner workstream of the log (INV-HIST-3: one query, one owner). */
  readonly workstreamId: string
  /** Page size in rows (default 20). */
  readonly pageSize?: number
  /** The initial replay order (default `'semantic'` — catalog §2 default). */
  readonly initialOrder?: HistoryOrder
}

type HistorySlice = SliceState<QueryHistoryResult>

/** One requested window: its canonical key + the exact query args (retry). */
interface RequestedWindow {
  readonly key: string
  readonly args: QueryHistoryArgs
}

/** Read one requested window from the snapshot (undefined when never loaded). */
function readSlice(snap: ReadonlyMap<string, HistorySlice>, key: string): HistorySlice | undefined {
  return snap.get(key)
}

/**
 * The History zone of the Workstream Page: dual-order (semantic/audit)
 * tab, atomic / per-Run wrapper view tab, paginated event stream.
 * @param props - container props (store handle + scope + paging).
 * @returns the History zone element.
 */
export function HistoryTimelineView(props: HistoryTimelineViewProps): ReactElement {
  const { store, workstreamId } = props
  const pageSize = props.pageSize ?? DEFAULT_PAGE_SIZE
  const initialOrder: HistoryOrder = props.initialOrder ?? 'semantic'

  const snapshot = useResearchStore(store)
  const [order, setOrder] = useState<HistoryOrder>(initialOrder)
  const [mode, setMode] = useState<HistoryViewMode>('atomic')
  // The ordered requested windows (pagination state): key + exact args.
  const [pages, setPages] = useState<readonly RequestedWindow[]>(() => {
    const args: QueryHistoryArgs = { workstreamId, order: initialOrder, limit: pageSize }
    return [{ key: historyKey(args), args }]
  })

  // A scope/order/page-size change is a FRESH reading: reset the window
  // list and (re)fetch the first page. The store dedupes in-flight
  // fetches per key, so StrictMode's double effect issues one fetch.
  useEffect(() => {
    const firstArgs: QueryHistoryArgs = { workstreamId, order, limit: pageSize }
    setPages([{ key: historyKey(firstArgs), args: firstArgs }])
    void store.loadHistory(firstArgs)
  }, [store, workstreamId, order, pageSize])

  /* -- re-derive everything from the snapshot (stale-while-revalidate
         falls out for free: a loading/error slice keeps its last data) -- */

  const slices: (HistorySlice | undefined)[] = pages.map(window => readSlice(snapshot.history, window.key))
  const readyEvents = slices.flatMap(slice => (slice?.status === 'ready' ? (slice.data?.events ?? []) : []))
  const anyLoading = slices.some(slice => slice === undefined || slice.status === 'idle' || slice.status === 'loading')
  const errorSlices = slices.filter((slice): slice is HistorySlice => slice !== undefined && slice.status === 'error')
  const lastSlice = slices[slices.length - 1]
  const lastWindow = pages[pages.length - 1]
  const lastData: QueryHistoryResult | null =
    lastSlice !== undefined && lastSlice.status === 'ready' ? (lastSlice.data ?? null) : null
  const lastError = lastSlice !== undefined && lastSlice.status === 'error'
  const canLoadMore = lastData !== null && !lastData.exhausted && lastData.nextAfterSeq !== null && !anyLoading

  // Cross-page re-sort in the ACTIVE order (a late-registered event can
  // sit in a later page yet sort earlier — catalog §2 dual timelines).
  const events = orderEvents(readyEvents, order)
  const groups = mode === 'runs' ? runGroups(events) : []

  function handleLoadMore(): void {
    if (!canLoadMore || lastData === null || lastData.nextAfterSeq === null) return
    const nextArgs: QueryHistoryArgs = {
      workstreamId,
      order,
      afterSeq: lastData.nextAfterSeq,
      limit: pageSize,
    }
    const key = historyKey(nextArgs)
    // Functional guard: a double click before re-render cannot add the
    // same window twice (the store's per-key in-flight dedupe backs this).
    setPages(prev => (prev.some(window => window.key === key) ? prev : [...prev, { key, args: nextArgs }]))
    void store.loadHistory(nextArgs)
  }

  /** Re-issue the last requested window (retry after a failed load). */
  function handleRetry(): void {
    if (lastWindow !== undefined) void store.loadHistory(lastWindow.args)
  }

  function switchOrder(next: HistoryOrder): void {
    if (next !== order) setOrder(next) // the effect resets pages + refetches
  }

  /* -- the body (priority: data > error > loading > empty) -- */

  let body: ReactElement
  if (events.length === 0) {
    if (errorSlices.length > 0) {
      body = (
        <>
          <p className={styles.error} role="alert">
            历史时间线加载失败：{errorSlices[0].error}
          </p>
          <footer className={styles.footer}>
            <button className={styles.loadMore} type="button" onClick={handleRetry}>
              重试加载
            </button>
          </footer>
        </>
      )
    } else if (anyLoading) {
      body = (
        <p className={styles.status} role="status">
          时间线加载中…
        </p>
      )
    } else {
      body = <p className={styles.status}>暂无历史事件</p>
    }
  } else {
    body = (
      <>
        {errorSlices.length > 0 && (
          <p className={styles.error} role="alert">
            部分页面加载失败：{errorSlices[0].error}（显示上次成功加载的数据）
          </p>
        )}
        {mode === 'atomic' ? (
          <ul className={styles.timeline} aria-label="原子时间线">
            {events.map((event, index) => (
              <EventRow key={`${event.eventId}-${index}`} event={event} order={order} />
            ))}
          </ul>
        ) : groups.length > 0 ? (
          <div className={styles.runGroups} aria-label="按 Run 聚合">
            {groups.map(group => (
              <RunGroupCard key={group.runId} group={group} order={order} />
            ))}
          </div>
        ) : (
          <p className={styles.status}>当前页面没有 Run 生命周期事件（原子时间线共 {events.length} 条事件）</p>
        )}
        <footer className={styles.footer}>
          {anyLoading ? (
            <button className={styles.loadMore} type="button" disabled>
              加载更多中…
            </button>
          ) : lastError ? (
            <button className={styles.loadMore} type="button" onClick={handleRetry}>
              重试加载
            </button>
          ) : canLoadMore ? (
            <button className={styles.loadMore} type="button" onClick={handleLoadMore}>
              加载更多
            </button>
          ) : (
            <p className={styles.endLine}>时间线已加载完毕（共 {events.length} 条事件）</p>
          )}
        </footer>
      </>
    )
  }

  return (
    <div className={styles.root} data-order={order} data-mode={mode}>
      <header className={styles.header}>
        <h2 className={styles.title}>历史时间线</h2>
        <span className={styles.scope}>工作流 {workstreamId}</span>
      </header>
      <nav className={styles.tabs} aria-label="回放顺序">
        <button
          type="button"
          className={order === 'semantic' ? styles.tabActive : styles.tab}
          aria-pressed={order === 'semantic'}
          onClick={() => switchOrder('semantic')}
        >
          语义序（发生时间）
        </button>
        <button
          type="button"
          className={order === 'audit' ? styles.tabActive : styles.tab}
          aria-pressed={order === 'audit'}
          onClick={() => switchOrder('audit')}
        >
          审计序（登记时间）
        </button>
      </nav>
      <nav className={styles.tabs} aria-label="视图">
        <button
          type="button"
          className={mode === 'atomic' ? styles.tabActive : styles.tab}
          aria-pressed={mode === 'atomic'}
          onClick={() => setMode('atomic')}
        >
          原子时间线
        </button>
        <button
          type="button"
          className={mode === 'runs' ? styles.tabActive : styles.tab}
          aria-pressed={mode === 'runs'}
          onClick={() => setMode('runs')}
        >
          按 Run 聚合
        </button>
      </nav>
      {body}
    </div>
  )
}
