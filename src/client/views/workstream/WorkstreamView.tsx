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
 *  - UI-5 (D4, ADJ-1/5/6/7/9/10/15/16): wires the FULL strip face —
 *    the selection state (ADJ-6 view-state `useState`, mirrored onto
 *    the graph node via the extended `PlanGraphContainer`), the
 *    create/edit/remove entries (B §19 RMW — a blank optional field =
 *    unknown = omitted on save; the task's acceptanceCriteria IS
 *    seeded from the Current join, so empty-on-save is an explicit
 *    clear), and the dependency face (B §17 — the endpoint kinds are
 *    resolved from the canonical id prefixes); the Future COLUMN wraps
 *    the strip zone (top) and the extended graph container (bottom —
 *    B §16), which additionally lazy-loads the `current`/`currentFocus`
 *    slices for the dependency edges (ADJ-7) + the focus marker (the
 *    store dedupes against this page's own loads of the same keys);
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

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type {
  CreatePlanItemArgs,
  GetWorkstreamCurrentResult,
  ReorderPlanArgs,
  UpdatePlanItemChanges,
  WorkstreamSnapshot,
} from '../../../shared/rpc-contracts.js'
import { t } from '../../i18n/copy.js'
import { ErrorStateBlock } from '../../components/error-state-block.js'
import { useProjectReadonly } from '../../components/readonly-context.js'
import { PlanGraphContainer } from '../../graph/PlanGraphContainer.js'
import type { ResearchStore } from '../../stores/index.js'
import { CurrentZone, type CurrentFocusView } from './CurrentZone.js'
import { FutureZone } from './FutureZone.js'
import { HistoryZone } from './HistoryZone.js'
import { RecordsSection } from './RecordsSection.js'
import {
  EMPTY_PLAN_ITEM_DRAFT,
  newPlanItemDraft,
  planKindOfId,
  splitLines,
  type PlanItemDraft,
  type PlanItemKind,
  type TaskExecution,
} from './plan-item-utils.js'
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
  /** UI-7 (B §26): deep link into the Records tab pre-filtered to a
   *  related object (`KIND:ID`) — set by the History timeline's
   *  「Related Records (n)」 entry. Undefined = default Workspace tab. */
  readonly initialRecordsRelated?: string
}

/** 产品文案（中文）— workstream lifecycle. */
const LIFECYCLE_LABEL: Record<WorkstreamLifecycle, string> = {
  PLANNED: t('status.planned'),
  REALIZED: t('status.implemented'),
  DROPPED: t('status.abandoned'),
}

/** The reorder in-flight/failure face (local UI state only — the data
 *  truth is the refetched slice). */
interface ReorderFace {
  readonly pending: boolean
  readonly fault: string | null
}

const REORDER_IDLE: ReorderFace = { pending: false, fault: null }

/** A UI-5 per-mutation in-flight/fault face (local UI state only — the
 *  data truth is the refetched slices). */
interface MutationFace {
  readonly pending: boolean
  readonly fault: string | null
}

const MUTATION_IDLE: MutationFace = { pending: false, fault: null }

/** The `current:<ws>` face while its slice carries no value yet (the
 *  zone renders its low-noise empty states). */
const EMPTY_CURRENT: GetWorkstreamCurrentResult = {
  workstreamId: '',
  objectives: [],
  explicitBlockers: [],
  derivedBlockers: [],
  nextActions: [],
  interventions: [],
  dependencyEdges: [],
}

/**
 * Render the Workstream page.
 * @param props - container inputs (see `WorkstreamViewProps`).
 * @returns the page element (header + the three zones, or a
 *  loading/failure state).
 */
export function WorkstreamView({ store, workstreamId, onOpenHistory, initialRecordsRelated }: WorkstreamViewProps): ReactElement {
  const slice = useWorkstreamSlice(store, workstreamId)
  const currentSlice = useWorkstreamCurrentSlice(store, workstreamId)
  const focusSlice = useCurrentFocusSlice(store, workstreamId)
  const [reorder, setReorder] = useState<ReorderFace>(REORDER_IDLE)
  /** The last successful promote's host-confirmed Task id (B §15.6
   *  receipt — a local presentation state; the promoted task itself
   *  lands via the refetched slices). */
  const [promotedTaskId, setPromotedTaskId] = useState<string | null>(null)
  /** The last failed UI-4 mutation (the shared low-noise fault note).
   *  UI-9 D3: keeps the rejected VALUE (the structured carrier feeds
   *  the error-state mapping; the detail line renders its message). */
  const [actionFault, setActionFault] = useState<unknown | null>(null)
  /** UI-7 (B §13.2): the page-body workspace toggle (view state — the
   *  deep link IS the state; no URL routing). Default: the three-zone
   *  Workspace face. */
  const [wsTab, setWsTab] = useState<'workspace' | 'records'>(() =>
    initialRecordsRelated !== undefined && initialRecordsRelated !== '' ? 'records' : 'workspace',
  )

  /* -- UI-5 (D4): the strip face state (ALL view state lives HERE —
     the zone stays hook-free) -- */
  /** ADJ-6: the strip/graph selection (view state — never persisted). */
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  /** The open create form (the insertion index + the draft's kind). */
  const [createForm, setCreateForm] = useState<{
    readonly kind: PlanItemKind
    readonly index: number
  } | null>(null)
  const [draft, setDraft] = useState<PlanItemDraft>(EMPTY_PLAN_ITEM_DRAFT)
  const [editDraft, setEditDraft] = useState<PlanItemDraft>(EMPTY_PLAN_ITEM_DRAFT)
  /** The dependency face's add-target select value (transient). */
  const [depTargetId, setDepTargetId] = useState('')
  const [createFace, setCreateFace] = useState<MutationFace>(MUTATION_IDLE)
  const [editFace, setEditFace] = useState<MutationFace>(MUTATION_IDLE)
  const [removeFace, setRemoveFace] = useState<MutationFace>(MUTATION_IDLE)
  /** UI-9 D4 (ADJ-11): the project read-only surface (the shell wraps
   *  the console in the provider; outside one the default context is
   *  NO_PROJECT_READONLY — the pair degrades to the writable surface).
   *  Passed down as props: the zones are hook-free by the view-test
   *  purity contract (tests/views-workstream/harness.ts). */
  const { readonly: readOnly, reasonText } = useProjectReadonly()
  const [depAddFault, setDepAddFault] = useState<string | null>(null)
  const [depRemoveFault, setDepRemoveFault] = useState<string | null>(null)

  /** FR4b (UI-5 fix round): the create-form LIFECYCLE GENERATION. Every
   *  open/close/select/submit of the create form bumps it, so a LATE
   *  `createPlanItem` success callback (the promise only resolves after
   *  the ADJ-8 invalidation refetches settle — seconds, not ms) cannot
   *  clobber a NEWER form state: without the guard it would run
   *  `setCreateForm(null)` + `setSelectedItemId(<just-created>)`,
   *  closing a freshly opened form and discarding its in-flight input
   *  (the F-5 clobber race — reproduced by a fast follow-up `+` click). */
  const createFormGenRef = useRef(0)

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

  /* -- UI-5 derived joins (the same-page slices — no extra fetches) -- */
  /** ADJ-5: task id → execution enum (the strip's execution badges —
   *  the join rides on the WS slice's `current.tasks`, the same face
   *  the Current zone renders). */
  const executionById = useMemo(() => {
    const map = new Map<string, TaskExecution>()
    const tasks = data?.current.tasks ?? []
    for (const task of tasks) map.set(task.id, task.execution)
    return map
  }, [data?.current.tasks])
  /** ADJ-7: the dependency edges (the Current slice projection). */
  const dependencyEdges = current.dependencyEdges

  /** Seed the edit draft when the selection CHANGES with what the wire
   *  can show — the title (PlanItemDto) + the task's acceptance
   *  criteria (the ADJ-5 join). Every other optional field starts
   *  blank = UNKNOWN = omitted on save (RMW — the form never
   *  accidentally clears a field it was never shown). The ref makes
   *  the seed fire once per selection, so a refetch mid-edit (e.g. an
   *  interleaved reorder) does not clobber the user's in-flight
   *  draft. */
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    if (selectedItemId === null) {
      seededFor.current = null
      return
    }
    if (seededFor.current === selectedItemId || data === null) return
    const item = data.future.plan.orderedItems.find(entry => entry.id === selectedItemId)
    if (item === undefined) return
    seededFor.current = selectedItemId
    const task = data.current.tasks.find(entry => entry.id === selectedItemId)
    setEditDraft({
      ...newPlanItemDraft(item.kind),
      title: item.title,
      acceptanceCriteria: item.kind === 'TASK' ? (task?.acceptanceCriteria.join('\n') ?? '') : '',
    })
  }, [selectedItemId, data])

  /** Surface a mutation fault in the shared low-noise note.
   *  UI-9 D3: keep the rejected value (not just its message) so the
   *  error-state mapping can read the structured carrier code. */
  function fail(err: unknown): void {
    setActionFault(err)
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

  /* -- UI-5 (D4): the strip face handlers -- */

  /** Row click → selection (B §17.4 two-way sync; the graph stamps the
   *  same id onto its node). Selecting closes a create form — one
   *  form at a time. */
  function handleSelectItem(itemId: string): void {
    createFormGenRef.current += 1
    setCreateForm(null)
    setCreateFace(MUTATION_IDLE)
    setSelectedItemId(itemId)
    setDepTargetId('')
  }

  /** A `+` entry (B §11.4 create before/after): open the create form
   *  at the given index with a fresh TASK draft. */
  function handleOpenCreate(index: number): void {
    createFormGenRef.current += 1
    setSelectedItemId(null)
    setEditFace(MUTATION_IDLE)
    setDraft(newPlanItemDraft('TASK'))
    setCreateFace(MUTATION_IDLE)
    setCreateForm({ kind: 'TASK', index })
  }

  function handleDraftChange(field: keyof PlanItemDraft, value: string): void {
    setDraft(prev => ({ ...prev, [field]: value }))
    // B §19: the kind select is the form's identity — keep the open
    // form's kind in step so the submitted carrier matches the fields
    // the user sees (handleCreateSubmit builds the carrier from it).
    if (field === 'kind') {
      setCreateForm(prev => (prev === null ? prev : { ...prev, kind: value as PlanItemKind }))
    }
  }

  function handleEditDraftChange(field: keyof PlanItemDraft, value: string): void {
    setEditDraft(prev => ({ ...prev, [field]: value }))
  }

  function handleCloseCreate(): void {
    createFormGenRef.current += 1
    setCreateForm(null)
    setCreateFace(MUTATION_IDLE)
  }

  function handleCloseEdit(): void {
    setSelectedItemId(null)
    setEditFace(MUTATION_IDLE)
    setDepTargetId('')
  }

  /** Create a plan item at the open form's index (B §19 — the per-kind
   *  carrier; empty optional fields are OMITTED, never sent empty).
   *  On OK the new item is selected so the user sees where it landed. */
  function handleCreateSubmit(): void {
    if (createForm === null) return
    const { kind, index } = createForm
    const title = draft.title.trim()
    if (title.length === 0) return
    const item: CreatePlanItemArgs['item'] =
      kind === 'TASK'
        ? {
            task: {
              title,
              ...(draft.goal.trim() !== '' ? { goal: draft.goal.trim() } : {}),
              ...(splitLines(draft.acceptanceCriteria).length > 0
                ? { acceptanceCriteria: splitLines(draft.acceptanceCriteria) }
                : {}),
              ...(splitLines(draft.deliverables).length > 0
                ? { deliverables: splitLines(draft.deliverables) }
                : {}),
              ...(draft.note.trim() !== '' ? { note: draft.note.trim() } : {}),
            },
          }
        : kind === 'GATE'
          ? {
              gate: {
                title,
                ...(draft.criteria.trim() !== '' ? { criteria: draft.criteria.trim() } : {}),
                ...(splitLines(draft.references).length > 0
                  ? { references: splitLines(draft.references) }
                  : {}),
              },
            }
          : {
              milestone: {
                title,
                ...(draft.statement.trim() !== '' ? { statement: draft.statement.trim() } : {}),
              },
            }
    setCreateFace({ pending: true, fault: null })
    // FR4b: capture this submit's generation — a newer form lifecycle
    // event (open/close/select/another submit) before the promise
    // settles invalidates BOTH callbacks below (late success would
    // clobber the newer form; a late fault would stamp it).
    const myGen = ++createFormGenRef.current
    void store.createPlanItem({ workstreamId, kind, item, index }).then(
      result => {
        if (createFormGenRef.current !== myGen) return
        // The store invalidated + refetched (the ADJ-8 registry rule);
        // select the host-confirmed new item.
        setCreateForm(null)
        setCreateFace(MUTATION_IDLE)
        setSelectedItemId(result.itemId)
        setDepTargetId('')
      },
      (err: unknown) => {
        if (createFormGenRef.current !== myGen) return
        setCreateFace({ pending: false, fault: err instanceof Error ? err.message : String(err) })
      },
    )
  }

  /** Edit the selected item (B §19 RMW): the title is always sent; the
   *  task's acceptanceCriteria was seeded with the full joined value,
   *  so empty-on-save is an explicit CLEAR (null); every other blank
   *  optional field was never shown → omitted from the changes. */
  function handleEditSubmit(): void {
    if (selectedItemId === null) return
    const title = editDraft.title.trim()
    if (title.length === 0) return
    const taskCriteria = editDraft.kind === 'TASK' ? splitLines(editDraft.acceptanceCriteria) : []
    const taskDeliverables = editDraft.kind === 'TASK' ? splitLines(editDraft.deliverables) : []
    const gateReferences = editDraft.kind === 'GATE' ? splitLines(editDraft.references) : []
    const changes: UpdatePlanItemChanges =
      editDraft.kind === 'TASK'
        ? {
            title,
            // Seeded from the join — empty-on-save is a deliberate clear.
            acceptanceCriteria: taskCriteria.length > 0 ? taskCriteria : null,
            ...(editDraft.goal.trim() !== '' ? { goal: editDraft.goal.trim() } : {}),
            ...(taskDeliverables.length > 0 ? { deliverables: taskDeliverables } : {}),
            ...(editDraft.note.trim() !== '' ? { note: editDraft.note.trim() } : {}),
          }
        : editDraft.kind === 'GATE'
          ? {
              title,
              ...(editDraft.criteria.trim() !== '' ? { criteria: editDraft.criteria.trim() } : {}),
              ...(gateReferences.length > 0 ? { references: gateReferences } : {}),
            }
          : {
              title,
              ...(editDraft.statement.trim() !== '' ? { statement: editDraft.statement.trim() } : {}),
            }
    setEditFace({ pending: true, fault: null })
    void store.updatePlanItem({ workstreamId, itemId: selectedItemId, changes }).then(
      () => setEditFace(MUTATION_IDLE),
      (err: unknown) =>
        setEditFace({ pending: false, fault: err instanceof Error ? err.message : String(err) }),
    )
  }

  /** The three-state Remove entry (B §19.4 — one `removePlanItem` RPC
   *  under all three labels; the kernel retains the definition,
   *  INV-PLAN-9). On OK the selection is cleared when it pointed at
   *  the removed item. */
  function handleRemoveItem(itemId: string): void {
    setRemoveFace({ pending: true, fault: null })
    void store.removePlanItem({ workstreamId, itemId }).then(
      () => {
        setRemoveFace(MUTATION_IDLE)
        if (selectedItemId === itemId) {
          setSelectedItemId(null)
          setEditFace(MUTATION_IDLE)
          setDepTargetId('')
        }
        // ADJ-14: when the removed item WAS the focus, the host
        // revalidated the pointer — the refetched currentFocus slice
        // carries the truth (no view bookkeeping).
      },
      (err: unknown) =>
        setRemoveFace({ pending: false, fault: err instanceof Error ? err.message : String(err) }),
    )
  }

  /** Add a dependency: the selected item DEPENDS ON the chosen target
   *  (source = selected, target = the select's value; the kinds are
   *  resolved from the canonical id prefixes — the wire carries both). */
  function handleAddDependency(): void {
    if (selectedItemId === null || depTargetId === '') return
    const sourceKind = planKindOfId(selectedItemId)
    const targetKind = planKindOfId(depTargetId)
    if (sourceKind === null || targetKind === null) return
    setDepAddFault(null)
    void store.addDependency({
      workstreamId,
      source: { kind: sourceKind, id: selectedItemId },
      target: { kind: targetKind, id: depTargetId },
    }).then(
      () => setDepTargetId(''),
      (err: unknown) => setDepAddFault(err instanceof Error ? err.message : String(err)),
    )
  }

  function handleRemoveDependency(relationId: string): void {
    setDepRemoveFault(null)
    void store.removeDependency({ workstreamId, relationId }).then(
      () => undefined,
      (err: unknown) => setDepRemoveFault(err instanceof Error ? err.message : String(err)),
    )
  }

  /* -- no data yet: loading or first-load failure -- */
  if (data === null) {
    if (slice.status === 'error') {
      return (
        <div className={styles.page}>
          <p className={styles.loadFault}>{t('common.loadFailedDetail', { detail: slice.error ?? t('common.unknownError') })}</p>
          <button
            type="button"
            className={styles.retryButton}
            aria-label={t('common.retryLoad')}
            onClick={() => void store.loadWorkstream(workstreamId)}
          >
            {t('common.retry')}
          </button>
        </div>
      )
    }
    return (
      <div className={styles.page}>
        <p className={styles.loadingNote}>{t('ws.pageLoading')}</p>
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
        <p className={styles.staleBanner}>{t('common.refreshFailedStale', { detail: slice.error ?? t('common.unknownError') })}</p>
      )}
      {actionFault !== null && (
        // UI-9 D3: the B §33.3 four-field error state (groups 5/6 — the
        // pre-application validation faults of the current-zone actions).
        // The original action control stays enabled and IS the
        // user-initiated re-send (no duplicate button). The legacy
        // `data-action-fault` hook is preserved on the wrapper.
        <div data-action-fault>
          <ErrorStateBlock error={actionFault} />
        </div>
      )}

      {/* UI-7 (B §13.2): the page-body [Workspace] / [Records] toggle —
          view state, the deep link IS the state (no URL routing). */}
      <div className={styles.wsTabs} role="tablist" aria-label={t('ws.records.title')}>
        <button
          type="button"
          role="tab"
          className={styles.wsTab}
          data-ws-tab="workspace"
          aria-selected={wsTab === 'workspace'}
          onClick={() => setWsTab('workspace')}
        >
          {t('ws.records.tab.workspace')}
        </button>
        <button
          type="button"
          role="tab"
          className={styles.wsTab}
          data-ws-tab="records"
          aria-selected={wsTab === 'records'}
          onClick={() => setWsTab('records')}
        >
          {t('ws.records.tab.records')}
        </button>
      </div>

      {wsTab === 'records' ? (
        <RecordsSection store={store} workstreamId={workstreamId} initialRelated={initialRecordsRelated} />
      ) : (
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
          readonly={readOnly}
          reasonText={reasonText}
        />
        <div className={styles.futureColumn}>
          <FutureZone
            planItems={data.future.plan.orderedItems}
            planForks={data.future.planForks}
            unresolvedPlanForkCount={data.future.unresolvedPlanForkCount}
            onMoveItem={handleMove}
            reorderPending={reorder.pending}
            reorderFault={reorder.fault}
            focusedPlanItemId={focusPointer?.planItemId ?? null}
            onSetCurrentFocus={handleSetCurrentFocus}
            selectedItemId={selectedItemId}
            onSelectItem={handleSelectItem}
            executionById={executionById}
            createForm={createForm}
            draft={draft}
            onDraftChange={handleDraftChange}
            onOpenCreate={handleOpenCreate}
            onCreateSubmit={handleCreateSubmit}
            onCreateClose={handleCloseCreate}
            createPending={createFace.pending}
            createFault={createFace.fault}
            editDraft={editDraft}
            onEditDraftChange={handleEditDraftChange}
            onEditSubmit={handleEditSubmit}
            onEditClose={handleCloseEdit}
            updatePending={editFace.pending}
            updateFault={editFace.fault}
            onRemoveItem={handleRemoveItem}
            removePending={removeFace.pending}
            removeFault={removeFace.fault}
            dependencyEdges={dependencyEdges}
            depTargetId={depTargetId}
            onDepTargetChange={setDepTargetId}
            onAddDependency={handleAddDependency}
            addDependencyFault={depAddFault}
            onRemoveDependency={handleRemoveDependency}
            removeDependencyFault={depRemoveFault}
            readonly={readOnly}
            reasonText={reasonText}
          />
          {/* B §16: the graph face — strip top + graph bottom. The
              extended container subscribes the current/currentFocus
              slices for the dependency edges (ADJ-7) + the focus
              marker and renders the PF zone downgraded (ADJ-9). */}
          <PlanGraphContainer
            store={store}
            workstreamId={workstreamId}
            extended
            selectedItemId={selectedItemId}
            onNodeSelect={handleSelectItem}
          />
        </div>
      </div>
      )}
    </div>
  )
}
