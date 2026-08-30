/**
 * PlanGraphContainer (WP-4.5) — the CONTAINER layer of the PlanGraph view
 * (one container per view, DSH_ADAPTER §6 two-layer discipline).
 *
 * This is the ONLY file where the research store handle reaches React:
 *  - the store arrives as a PROP (`createResearchStore()` factory result —
 *    never a module-level handle);
 *  - `useStoreSnapshotSelected` (store-binding) projects the workstream
 *    slice into bound props (one subscription — DSH_ADAPTER §11);
 *  - the lazy slice load fires on mount (`loadWorkstream` — ARCHITECTURE
 *    §8 lazy loading; the in-flight dedupe in the store makes re-mounts
 *    safe);
 *  - the SELECT/DISMISS entries (RR-015③) resolve HERE: the view's
 *    callbacks open the confirmation dialog (SELECT is irreversible —
 *    explicit confirm per PLAN_FORK_SPEC §6), the confirm calls the
 *    mutation face (`selectPlanFork`/`dismissPlanFork`), and the store's
 *    invalidate/refetch registry refreshes the slice — the overlay then
 *    re-derives from the fresh snapshot (no manual state sync).
 *
 * The extended face (UI-5): with `extended` set (the workstream page
 * mount), the container additionally subscribes the `current:<ws>` slice
 * (dependencyEdges — ADJ-7) and the `currentFocus:<ws>` slice (the focus
 * marker), lazy-loads both (deduped against the page's own loads), and
 * renders the graph with the dependency edges + the focus marker + the
 * PF downgrade (ADJ-1/9). The cockpit mount (no `extended`) keeps the
 * exact WP-4.5 behavior: one slice, one fetch, no extras.
 *
 * The presentation component (`PlanGraphView`) below stays pure props.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  idleSlice,
  type GetCurrentFocusResult,
  type GetWorkstreamCurrentResult,
  type ResearchStore,
  type ResearchStoreState,
  type SliceState,
  type WorkstreamSnapshot,
} from '../stores/index.js'
import { planToGraph, type PlanGraphExtras } from './plan-model.js'
import { PlanGraphView } from './PlanGraphView.js'
import { ConfirmDialog } from './ConfirmDialog.js'
import { useStoreSnapshotSelected } from './store-binding.js'
import { PLAN_GRAPH_STYLES as styles, ensureGraphStyles } from './graph-styles.js'

/** Reference-stable idle sentinel (a value — NOT a store handle). */
const IDLE_WS = idleSlice<WorkstreamSnapshot>()
/** UI-5 (ADJ-7/9): idle sentinels for the extended face's two extra slices. */
const IDLE_CURRENT = idleSlice<GetWorkstreamCurrentResult>()
const IDLE_FOCUS = idleSlice<GetCurrentFocusResult>()

/** The pending user action (the confirmation dialog's payload). */
interface PendingAction {
  readonly kind: 'select' | 'dismiss'
  readonly planForkId: string
}

export interface PlanGraphContainerProps {
  /** The research store (factory result — the container's only store face). */
  readonly store: ResearchStore
  /** The workstream whose Future Plan zone is rendered. */
  readonly workstreamId: string
  /**
   * UI-5 (ADJ-6): the canonical plan item selected in the strip — the
   * page owns the selection state (a view-state `useState`, never
   * persisted) and the container stamps it onto the graph node. Only
   * consumed when `extended` is set.
   */
  readonly selectedItemId?: string | null
  /**
   * UI-5 (ADJ-1): node-click → selection callback (canonical nodes only —
   * ghosts/forks are not selectable). Only consumed when `extended` is
   * set; absent = the WP-4.5 face (no node interaction).
   */
  readonly onNodeSelect?: (itemId: string) => void
  /**
   * UI-5 (ADJ-7/9): the extended face (the workstream page mount).
   * Additionally subscribes the `current:<ws>` slice (dependencyEdges —
   * ADJ-7) and the `currentFocus:<ws>` slice (the focus marker), lazy
   * loads both, and renders the graph with the PlanFork zone visually
   * downgraded (ADJ-9). Absent (the cockpit mount) = the exact WP-4.5
   * behavior: one slice, one fetch, no extras.
   */
  readonly extended?: boolean
}

/**
 * Container: store slice → derived graph → PlanGraphView + the PF
 * confirmation dialogs.
 */
export function PlanGraphContainer({
  store,
  workstreamId,
  selectedItemId = null,
  onNodeSelect,
  extended = false,
}: PlanGraphContainerProps): ReactElement {
  const slice: SliceState<WorkstreamSnapshot> = useStoreSnapshotSelected(
    store,
    useCallback(
      (state: ResearchStoreState) => state.workstreams.get(workstreamId) ?? IDLE_WS,
      [workstreamId],
    ),
  )

  // UI-5 (extended face): the dependency edges (ADJ-7) and the focus
  // pointer (the CF marker) ride on their own slices. The subscriptions
  // are always live (hook order is stable — a rule of React), but the
  // lazy loads below only fire when `extended`: the cockpit mount stays
  // one slice + one fetch, and the idle sentinels keep the two extra
  // selectors reference-stable (no re-render cost where no data ever
  // arrives).
  const currentSlice: SliceState<GetWorkstreamCurrentResult> = useStoreSnapshotSelected(
    store,
    useCallback(
      (state: ResearchStoreState) => state.current.get(workstreamId) ?? IDLE_CURRENT,
      [workstreamId],
    ),
  )
  const focusSlice: SliceState<GetCurrentFocusResult> = useStoreSnapshotSelected(
    store,
    useCallback(
      (state: ResearchStoreState) => state.currentFocus.get(workstreamId) ?? IDLE_FOCUS,
      [workstreamId],
    ),
  )

  // Lazy load on mount (the store dedupes in-flight fetches per slice key);
  // the combined stylesheets are injected idempotently at the same time
  // (the banner/loading states render before the view's own effect can run).
  useEffect(() => {
    ensureGraphStyles()
    void store.loadWorkstream(workstreamId).catch(() => {
      // Transport faults reject; the slice carries the error (banner below).
    })
  }, [store, workstreamId])

  // UI-5 (extended face): the two extra slices lazy-load alongside the
  // workstream slice. The store dedupes in-flight fetches per slice key,
  // so the page's own loads of the same keys never double-fetch.
  useEffect(() => {
    if (!extended) return
    void store.loadWorkstreamCurrent({ workstreamId }).catch(() => {
      // Faults surface in the page's Current zone; the graph simply has
      // no dependency edges (the idle sentinel → the empty list).
    })
    void store.getCurrentFocus({ workstreamId }).catch(() => {
      // Same: the focus marker stays unmarked on fault.
    })
  }, [store, workstreamId, extended])

  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // UI-5 (ADJ-1/7/9): the extended face feeds `planToGraph` its extras —
  // the dependency edges (both endpoints must sit in the canonical plan,
  // enforced inside planToGraph), the focus marker (clamped to a
  // canonical id there), and the PF downgrade switch. Non-extended:
  // `undefined` = the exact WP-4.5 projection.
  const graphExtras: PlanGraphExtras | undefined = useMemo(
    () =>
      extended
        ? {
            dependencyEdges: currentSlice.data?.dependencyEdges ?? [],
            focusedItemId: focusSlice.data?.focus?.planItemId ?? null,
            pfDowngraded: true,
          }
        : undefined,
    [extended, currentSlice.data, focusSlice.data],
  )

  const graph = useMemo(
    () => (slice.data ? planToGraph(slice.data, graphExtras) : null),
    [slice.data, graphExtras],
  )

  const openSelect = useCallback((planForkId: string) => {
    setActionError(null)
    setPending({ kind: 'select', planForkId })
  }, [])
  const openDismiss = useCallback((planForkId: string) => {
    setActionError(null)
    setPending({ kind: 'dismiss', planForkId })
  }, [])
  const cancelPending = useCallback(() => setPending(null), [])

  async function confirmPending(): Promise<void> {
    if (pending === null || busy) return
    setBusy(true)
    setActionError(null)
    try {
      if (pending.kind === 'select') {
        await store.selectPlanFork({ planForkId: pending.planForkId })
      } else {
        await store.dismissPlanFork({ planForkId: pending.planForkId })
      }
      setPending(null)
      // The store's invalidate registry refetched the slice: the graph
      // re-derives from the fresh snapshot on the next render.
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
      setPending(null)
    } finally {
      setBusy(false)
    }
  }

  /* -- render states (the slice state machine, §WP-4.1b) -- */
  if (slice.data === null) {
    if (slice.status === 'error') {
      return <div className={styles.root} data-role="plan-graph"><div className={styles.errorBanner}>加载失败：{slice.error}</div></div>
    }
    return (
      <div className={styles.root} data-role="plan-graph">
        <div className={styles.loading}>加载中…</div>
      </div>
    )
  }

  return (
    <div className={styles.root} data-role="plan-graph">
      {slice.status === 'error' && <div className={styles.errorBanner}>刷新失败：{slice.error}（显示上一次数据）</div>}
      {actionError !== null && <div className={styles.errorBanner}>操作失败：{actionError}</div>}

      {graph !== null && (
        <PlanGraphView
          graph={graph}
          forks={slice.data.future.planForks}
          unresolvedCount={slice.data.future.unresolvedPlanForkCount}
          onSelectFork={openSelect}
          onDismissFork={openDismiss}
          selectedItemId={extended ? selectedItemId : undefined}
          onNodeSelect={extended ? onNodeSelect : undefined}
        />
      )}

      {pending !== null && (
        <ConfirmDialog
          title={pending.kind === 'select' ? `选择提案 ${pending.planForkId}` : `忽略提案 ${pending.planForkId}`}
          message={
            pending.kind === 'select'
              ? '此操作不可逆：将按提案物化新条目并重写正典计划（plan.yaml），同一工作流的其他待处理提案将全部标记过期。确认选择此提案？'
              : '仅将提案状态改为「已忽略」（追加记录，不删除）。确认忽略？'
          }
          confirmLabel={pending.kind === 'select' ? '确认选择' : '确认忽略'}
          danger={pending.kind === 'select'}
          onConfirm={() => {
            void confirmPending()
          }}
          onCancel={cancelPending}
        />
      )}
    </div>
  )
}
