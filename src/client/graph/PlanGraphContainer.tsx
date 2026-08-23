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
 * The presentation component (`PlanGraphView`) below stays pure props.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  idleSlice,
  type ResearchStore,
  type ResearchStoreState,
  type SliceState,
  type WorkstreamSnapshot,
} from '../stores/index.js'
import { planToGraph } from './plan-model.js'
import { PlanGraphView } from './PlanGraphView.js'
import { ConfirmDialog } from './ConfirmDialog.js'
import { useStoreSnapshotSelected } from './store-binding.js'
import { PLAN_GRAPH_STYLES as styles, ensureGraphStyles } from './graph-styles.js'

/** Reference-stable idle sentinel (a value — NOT a store handle). */
const IDLE_WS = idleSlice<WorkstreamSnapshot>()

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
}

/**
 * Container: store slice → derived graph → PlanGraphView + the PF
 * confirmation dialogs.
 */
export function PlanGraphContainer({ store, workstreamId }: PlanGraphContainerProps): ReactElement {
  const slice: SliceState<WorkstreamSnapshot> = useStoreSnapshotSelected(
    store,
    useCallback(
      (state: ResearchStoreState) => state.workstreams.get(workstreamId) ?? IDLE_WS,
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

  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const graph = useMemo(() => (slice.data ? planToGraph(slice.data) : null), [slice.data])

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
