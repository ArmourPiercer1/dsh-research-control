/**
 * Workstream page container (WP-4.3, §27.4 「核心三区」; UI-4 D4).
 *
 * The ONE container of the view file set (task brief's two-layer
 * discipline; this repo has no host renderer, so there is no host
 * binding layer to mirror):
 *  - PULLS the workstream slice through `useWorkstreamSlice` (the store
 *    binding layer — `useSyncExternalStore` lives there, not here) and
 *    drives the lazy first load;
 *  - UI-4 (ADJ-8/11): PULLS the two aggregate faces the Current
 *    Execution zone needs — the `current:<ws>` slice
 *    (`useWorkstreamCurrentSlice`) and the `currentFocus:<ws>` slice
 *    (`useCurrentFocusSlice`) — both lazy-load on mount;
 *  - wires the minimal REORDER GUI entry: the Future zone's
 *    `onMoveItem(itemId, direction)` callback is resolved HERE into the
 *    frozen `reorderPlan` mutation (adjacent swap via `buildReorderArgs`
 *    — the args are always a permutation; `store.reorderPlan` then
 *    invalidates + refetches this slice per the WP-4.1b registry);
 *  - UI-4: wires the Current-zone mutation entries — explicit-blocker
 *    Clear, next-action Promote/Dismiss — plus the Future zone's
 *    `Set as Current Focus` entry (B §20; the container no-ops a set
 *    that would write the pointer to its current value). The promote
 *    receipt (the host-confirmed new Task id, B §15.6) and the shared
 *    mutation-fault note are local UI state; the DATA truth is always
 *    the refetched slices (the three-line store idiom — zero optimistic
 *    updates);
 *  - passes everything DOWN as plain props to the three PURE zone
 *    components (Current/Future/History) — they carry no hooks and no
 *    store knowledge;
 *  - lays the three zones on ONE screen with CSS Grid
 *    (`History | Current Execution | Future Plan`, §27.4 order) in
 *    `workstream.module.css` (local `--rc-*` token approximations).
 *
 * The header carries the B §12 rows the UI-4 scope pins: the current
 * OBJECTIVE (the first — top priority — of `current:<ws>.objectives`)
 * and the current FOCUS (the pointer's plan item, title resolved
 * against the plan). A row is omitted entirely while its face is
 * absent (low noise: no placeholder lines).
 *
 * Components never see a DSH context (INV-PERM-5 / DSH_ADAPTER §6): the
 * only non-prop input is the `createResearchStore()` instance itself — a
 * plain data service (snapshot + actions), passed through the future
 * slot `store:` option by the Phase 4 wiring.
 *
 * State rendering (the store slice machine, WP-4.1b):
 *  - `idle`/`loading` without data → loading note (the lazy load is in
 *    flight or waiting on the first effect);
 *  - `error` without data → failure note + retry entry
 *    (`store.loadWorkstream` again);
 *  - `error` WITH data (stale-while-revalidate: a failed refetch keeps
 *    the last good payload) → the zones render the stale data plus a
 *    failure banner;
 *  - `ready` → header + the three zones. The aggregate slices
 *    (`current` / `currentFocus`) are low-noise: while they are still
 *    loading the zone renders its empty states; a failed refetch keeps
 *    the last good payload (stale-while-revalidate).
 */

import { useState, type ReactElement } from 'react'
import type {
  GetWorkstreamCurrentResult,
  ReorderPlanArgs,
  WorkstreamSnapshot,
} from '../../../shared/rpc-contracts.js'
import { t } from '../../i18n/copy.js'
import type { ResearchStore } from '../../stores/index.js'
import { CurrentZone, type CurrentFocusView } from './CurrentZone.js'
import { FutureZone } from './FutureZone.js'
import { HistoryZone } from './HistoryZone.js'
import { buildReorderArgs, type MoveDirection } from './reorder.js'
import {
  useCurrentFocusSlice,
  useWorkstreamCurrentSlice,
  useWorkstreamSlice,
} from './useWorkstreamSlice.js'
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

/** The `current:<ws>` face while its slice carries no value yet (the
 *  zone renders its low-noise empty states). */
const EMPTY_CURRENT: GetWorkstreamCurrentResult = {
  workstreamId: '',
  objectives: [],
  explicitBlockers: [],
  derivedBlockers: [],
  nextActions: [],
  interventions: [],
}

/**
 * Render the Workstream page.
 * @param props - container inputs (see `WorkstreamViewProps`).
 * @returns the page element (header + the three zones, or a
 *  loading/failure state).
 */
export function WorkstreamView({ store, workstreamId, onOpenHistory }: WorkstreamViewProps): ReactElement {
  const slice = useWorkstreamSlice(store, workstreamId)
  const currentSlice = useWorkstreamCurrentSlice(store, workstreamId)
  const focusSlice = useCurrentFocusSlice(store, workstreamId)
  const [reorder, setReorder] = useState<ReorderFace>(REORDER_IDLE)
  /** The last successful promote's host-confirmed Task id (B §15.6
   *  receipt — a local presentation state; the promoted task itself
   *  lands via the refetched slices). */
  const [promotedTaskId, setPromotedTaskId] = useState<string | null>(null)
  /** The last failed UI-4 mutation (the shared low-noise fault note). */
  const [actionFault, setActionFault] = useState<string | null>(null)

  const data = slice.data
  const current = currentSlice.data ?? EMPTY_CURRENT
  const focusPointer = focusSlice.data?.focus ?? null
  /** The focus row/card face (the title resolved against the plan). */
  const focus: CurrentFocusView | null =
    focusPointer === null
      ? null
      : {
          planItemId: focusPointer.planItemId,
          title:
            data === null
              ? null
              : (data.future.plan.orderedItems.find(item => item.id === focusPointer.planItemId)?.title ?? null),
        }
  const currentObjective = current.objectives.length > 0 ? current.objectives[0]! : null

  /** Surface a mutation fault in the shared low-noise note. */
  function fail(err: unknown): void {
    setActionFault(err instanceof Error ? err.message : String(err))
  }

  /** Clear an explicit blocker (the store refetches per the UI-4
   *  registry rule; the zone re-renders from the refetched slice). */
  function handleClearBlocker(blockerId: string): void {
    void store.clearBlocker({ blockerId }).then(
      () => setActionFault(null),
      fail,
    )
  }

  /** Promote a PROPOSED next action to a plan Task (B §15.6). On OK the
   *  receipt shows the host-confirmed new Task id; the NA itself leaves
   *  the PROPOSED list via the refetched current slice. */
  function handlePromoteNextAction(nextActionId: string): void {
    void store.promoteNextAction({ nextActionId, workstreamId }).then(
      (result) => {
        setPromotedTaskId(result.taskId)
        setActionFault(null)
      },
      fail,
    )
  }

  /** Dismiss a PROPOSED next action (B §15.6). */
  function handleDismissNextAction(nextActionId: string): void {
    void store.dismissNextAction({ nextActionId }).then(
      () => setActionFault(null),
      fail,
    )
  }

  /** Set the current-focus pointer (B §20: the Current zone shows the
   *  item, the Future zone shows the marker; the execution lifecycle is
   *  untouched). No-op when the pointer already sits on the item — a
   *  same-value write is not a user intent worth a mutation. */
  function handleSetCurrentFocus(planItemId: string): void {
    if (focusPointer !== null && focusPointer.planItemId === planItemId) return
    void store.setCurrentFocus({ workstreamId, planItemId }).then(
      () => setActionFault(null),
      fail,
    )
  }

  /** Resolve one reorder button press into the frozen `reorderPlan`
   *  mutation (see `buildReorderArgs`): it yields `null` for a no-op
   *  move (edge item / unknown id — the buttons are disabled there
   *  anyway); a business fault rejects and is surfaced as a zone note
   *  (the slice itself is NOT invalidated on failure — the store pins
   *  zero invalidation on `ok:false`, WP-4.1b).
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
        {currentObjective !== null && (
          <p className={styles.headerRow} data-header-objective={currentObjective.id}>
            {t('ws.header.objective')}: {currentObjective.statement}
          </p>
        )}
        {focus !== null && (
          <p className={styles.headerRow} data-header-focus={focus.planItemId}>
            {t('ws.header.focus')}: {focus.title ?? focus.planItemId}
          </p>
        )}
      </header>

      {slice.status === 'error' && (
        <p className={styles.staleBanner}>刷新失败，显示最近数据：{slice.error ?? '未知错误'}</p>
      )}
      {actionFault !== null && (
        <p className={styles.actionFault} data-action-fault>
          {t('ws.current.actionFault')}: {actionFault}
        </p>
      )}

      <div className={styles.grid}>
        <HistoryZone
          eventCount={data.history.eventCount}
          onOpenHistory={onOpenHistory ?? (() => undefined)}
        />
        <CurrentZone
          tasks={data.current.tasks}
          runs={data.current.runs}
          objectives={current.objectives}
          focus={focus}
          explicitBlockers={current.explicitBlockers}
          derivedBlockers={current.derivedBlockers}
          nextActions={current.nextActions}
          interventions={current.interventions}
          promotedTaskId={promotedTaskId}
          onClearBlocker={handleClearBlocker}
          onPromoteNextAction={handlePromoteNextAction}
          onDismissNextAction={handleDismissNextAction}
        />
        <FutureZone
          planItems={data.future.plan.orderedItems}
          planForks={data.future.planForks}
          unresolvedPlanForkCount={data.future.unresolvedPlanForkCount}
          onMoveItem={handleMove}
          reorderPending={reorder.pending}
          reorderFault={reorder.fault}
          focusedPlanItemId={focusPointer?.planItemId ?? null}
          onSetCurrentFocus={handleSetCurrentFocus}
        />
      </div>
    </div>
  )
}
