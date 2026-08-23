/**
 * Workstream page container (WP-4.3, §27.4 「核心三区」).
 *
 * The ONE container of the view file set (task brief's two-layer
 * discipline; this repo has no host renderer, so there is no host
 * binding layer to mirror):
 *  - PULLS the workstream slice through `useWorkstreamSlice` (the store
 *    binding layer — `useSyncExternalStore` lives there, not here) and
 *    drives the lazy first load;
 *  - wires the minimal REORDER GUI entry: the Future zone's
 *    `onMoveItem(itemId, direction)` callback is resolved HERE into the
 *    frozen `reorderPlan` mutation (adjacent swap via `buildReorderArgs`
 *    — the args are always a permutation; `store.reorderPlan` then
 *    invalidates + refetches this slice per the WP-4.1b registry);
 *  - passes everything DOWN as plain props to the three PURE zone
 *    components (Current/Future/History) — they carry no hooks and no
 *    store knowledge;
 *  - lays the three zones on ONE screen with CSS Grid
 *    (`History | Current Execution | Future Plan`, §27.4 order) in
 *    `workstream.module.css` (local `--rc-*` token approximations).
 *
 * Components never see a DSH context (INV-PERM-5 / DSH_ADAPTER §6): the
 * only non-prop input is the `createResearchStore()` instance itself — a
 * plain data service (snapshot + actions), passed through the future
 * slot `store:` option by the Phase 4 wiring.
 *
 * State rendering (the store slice machine, WP-4.1b):
 *  - `idle`/`loading` without data → loading note (the lazy load is in
 *    flight or will be fired by the binding hook);
 *  - `error` without data → failure note + retry entry
 *    (`store.loadWorkstream` again);
 *  - `error` WITH data (stale-while-revalidate: a failed refetch keeps
 *    the last good payload) → the zones render the stale data plus a
 *    failure banner;
 *  - `ready` → header + the three zones.
 */

import { useState, type ReactElement } from 'react'
import type {
  ReorderPlanArgs,
  WorkstreamSnapshot,
} from '../../../shared/rpc-contracts.js'
import type { ResearchStore } from '../../stores/index.js'
import { CurrentZone } from './CurrentZone.js'
import { FutureZone } from './FutureZone.js'
import { HistoryZone } from './HistoryZone.js'
import { buildReorderArgs, type MoveDirection } from './reorder.js'
import { useWorkstreamSlice } from './useWorkstreamSlice.js'
import styles from './workstream.module.css'

/** The workstream lifecycle (derived from the frozen DTO — no local restatement). */
type WorkstreamLifecycle = WorkstreamSnapshot['workstream']['lifecycle']

export interface WorkstreamViewProps {
  /** The `createResearchStore()` instance (via props — never a handle). */
  readonly store: ResearchStore
  /** The page's workstream (the slice local key + mutation scope). */
  readonly workstreamId: string
  /** Opens the event timeline (WP-4.4 wiring provides the target). */
  readonly onOpenHistory?: () => void
}

/** 产品文案（中文）— workstream lifecycle. */
const LIFECYCLE_LABEL: Record<WorkstreamLifecycle, string> = {
  PLANNED: '规划中',
  REALIZED: '已实现',
  DROPPED: '已放弃',
}

/** The reorder in-flight/failure face (local UI state only — the data
 *  truth is the refetched slice). */
interface ReorderFace {
  readonly pending: boolean
  readonly fault: string | null
}

const REORDER_IDLE: ReorderFace = { pending: false, fault: null }

/**
 * Render the Workstream page: three zones on one screen.
 * @param props - view props (see `WorkstreamViewProps`).
 * @returns the page element.
 */
export function WorkstreamView({ store, workstreamId, onOpenHistory }: WorkstreamViewProps): ReactElement {
  const slice = useWorkstreamSlice(store, workstreamId)
  const [reorder, setReorder] = useState<ReorderFace>(REORDER_IDLE)

  const data = slice.data

  /**
   * The reorder GUI entry (Future zone buttons → the mutation face).
   * `buildReorderArgs` yields `null` for a no-op move (edge item /
   * unknown id — the buttons are disabled there anyway); a business
   * fault rejects and is surfaced as a zone note (the slice itself is
   * NOT invalidated on failure — the store pins zero invalidation on
   * `ok:false`, WP-4.1b).
   */
  function handleMove(itemId: string, direction: MoveDirection): void {
    if (data === null) return
    const args: ReorderPlanArgs | null = buildReorderArgs(
      workstreamId,
      data.future.plan.orderedItems,
      itemId,
      direction,
    )
    if (args === null) return
    setReorder({ pending: true, fault: null })
    void store.reorderPlan(args).then(
      () => {
        // The store already invalidated + refetched the ws slice (the
        // registry rule for reorderPlan); the host-confirmed new order
        // lands via the slice commit — no extra bookkeeping in the view.
        setReorder(REORDER_IDLE)
      },
      (err: unknown) => {
        setReorder({ pending: false, fault: err instanceof Error ? err.message : String(err) })
      },
    )
  }

  /* -- no data yet: loading or first-load failure -- */
  if (data === null) {
    if (slice.status === 'error') {
      return (
        <div className={styles.page}>
          <p className={styles.loadFault}>加载失败：{slice.error ?? '未知错误'}</p>
          <button
            type="button"
            className={styles.retryButton}
            aria-label="重试加载"
            onClick={() => void store.loadWorkstream(workstreamId)}
          >
            重试
          </button>
        </div>
      )
    }
    return (
      <div className={styles.page}>
        <p className={styles.loadingNote}>正在加载 Workstream…</p>
      </div>
    )
  }

  /* -- data present (ready, or stale-while-revalidate under error) -- */
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.pageTitle}>{data.workstream.title}</h1>
        <span className={styles.headerMeta}>
          {data.workstream.id} · {LIFECYCLE_LABEL[data.workstream.lifecycle]}
        </span>
        {data.workstream.summary !== null && <p className={styles.headerSummary}>{data.workstream.summary}</p>}
      </header>

      {slice.status === 'error' && (
        <p className={styles.staleBanner}>刷新失败，显示最近数据：{slice.error ?? '未知错误'}</p>
      )}

      <div className={styles.grid}>
        <HistoryZone
          eventCount={data.history.eventCount}
          onOpenHistory={onOpenHistory ?? (() => undefined)}
        />
        <CurrentZone tasks={data.current.tasks} runs={data.current.runs} />
        <FutureZone
          planItems={data.future.plan.orderedItems}
          planForks={data.future.planForks}
          unresolvedPlanForkCount={data.future.unresolvedPlanForkCount}
          onMoveItem={handleMove}
          reorderPending={reorder.pending}
          reorderFault={reorder.fault}
        />
      </div>
    </div>
  )
}
