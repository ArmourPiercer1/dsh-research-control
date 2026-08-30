/**
 * Future Plan zone (WP-4.3 base → UI-5 D4 rewrite: the ORDERED STRIP).
 *
 * PURE display component: data via props only, NO HOOKS (the page
 * container owns ALL form/selection/pending state — the SSR harness
 * calls zones as direct functions, so hook-free is a hard discipline).
 *
 * Contents (B §16/§17/§19/§20; ADJ-5/6/9/10/16):
 *  - the PlanFork count badge (ADJ-9): a collapsed-by-default
 *    `<details data-pf-badge>` at the TOP of the Future column, rendered
 *    only when `unresolvedPlanForkCount > 0`; expanded it shows the
 *    read-only seam rows (the `data-pf` data path is unchanged from
 *    WP-4.3 — the ACTIONABLE select/dismiss face stays in the graph's
 *    PlanGraphView toolbar, only visually downgraded — ADJ-9);
 *  - the canonical plan as a linearly ORDERED STRIP (B §16: strip top +
 *    graph bottom): exact plan position, one row per G/T/M item with
 *    the position number, the kind badge, title, id, the execution
 *    summary for TASKS only (ADJ-5 — the enum value verbatim, the
 *    same-page Current join, no extra fetch), the Focus marker on the
 *    focused row, and the row's entries:
 *    - `+` at the head (index 0) and after every row (index i+1) —
 *      create before/after (B §11.4);
 *    - ← / → move buttons (ADJ-16: per-row left/right; the zone reports
 *      the intent as the legacy `MoveDirection` up/down —
 *      left→earlier→'up', right→later→'down'; `buildReorderArgs` keeps
 *      it an adjacent swap);
 *    - the verbatim `Set as Current Focus` button (B §20);
 *    - the THREE-STATE Remove button (B §19.4 — the label branches on
 *      `classifyRemoveState`; a single `removePlanItem` RPC underlies
 *      all three);
 *  - the row click = SELECTION (B §17.4 strip↔graph two-way sync — the
 *    page owns the `selectedItemId` state; the row carries
 *    `data-strip-item` / `data-strip-selected`);
 *  - the CREATE form (when the page opens it via a `+`): the kind
 *    select + the B §19 fields for the active kind (list fields are
 *    newline-separated in the draft);
 *  - the EDIT form (when a row is selected): the prefilled B §19 fields
 *    (RMW — blank optional field = unknown = omitted on save) + the
 *    DEPENDENCY FACE (B §17): the depends-on list (one Remove per
 *    edge, `data-dep-remove`), the depended-by list (informational),
 *    and the add-target select + Add button.
 *
 * Every e2e-relevant element carries a `data-strip*` / `data-dep*` /
 * `data-pf-badge` hook (the t70 contract).
 */

import type { ReactElement } from 'react'
import type { DependencyEdgeDto, PlanForkDto, PlanItemDto } from '../../../shared/rpc-contracts.js'
import { t } from '../../i18n/copy.js'
import {
  classifyRemoveState,
  REMOVE_STATE_KEY,
  type PlanItemDraft,
  type PlanItemKind,
  type TaskExecution,
} from './plan-item-utils.js'
import type { MoveDirection } from './reorder.js'
import styles from './workstream.module.css'

export interface FutureZoneProps {
  /** The DTO's `future.plan.orderedItems` (canonical plan, in position). */
  readonly planItems: readonly PlanItemDto[]
  /** The DTO's `future.planForks` (OPEN/STALE only — the unresolved set). */
  readonly planForks: readonly PlanForkDto[]
  /** The DTO's `future.unresolvedPlanForkCount` (authoritative count). */
  readonly unresolvedPlanForkCount: number
  /**
   * Reorder entry callback (container-wired to `store.reorderPlan`).
   * The zone only reports the user intent: which item, which direction.
   */
  readonly onMoveItem: (itemId: string, direction: MoveDirection) => void
  /** True while a reorder mutation is in flight (the 排序保存中… note).
   *  The buttons stay enabled: `reorderPlan` only permutes the FIXED
   *  item set, so a second move queued before the refetch lands is
   *  still a valid permutation (the host applies the last one). */
  readonly reorderPending: boolean
  /** Last reorder failure message (business fault text from the store). */
  readonly reorderFault: string | null
  /** The current-focus pointer's plan item id (B §20: the focused row
   *  carries the `Focus` marker); null = no pointer. */
  readonly focusedPlanItemId: string | null
  /** Set-as-CF entry callback (B §20 verbatim button; container-wired
   *  to `store.setCurrentFocus`). The zone only reports the user
   *  intent: which plan item. */
  readonly onSetCurrentFocus: (planItemId: string) => void

  // --- UI-5: selection (ADJ-6 — view state owned by the page) ----------
  /** The selected canonical item id (row highlight + the edit form's
   *  target); null = nothing selected. */
  readonly selectedItemId: string | null
  /** Row-click → selection (B §17.4 two-way sync; the page also stamps
   *  it onto the graph node). */
  readonly onSelectItem: (itemId: string) => void
  /** The ADJ-5 client join: task id → execution enum (the same-page
   *  Current slice — no extra fetch). */
  readonly executionById: ReadonlyMap<string, TaskExecution>

  // --- UI-5: create form (B §11.4 before/after; B §19 fields) ----------
  /** The open create form: the insertion index (0-based) + the draft's
   *  starting kind; null = closed. */
  readonly createForm: { readonly kind: PlanItemKind; readonly index: number } | null
  /** The create-form draft (the page owns the state). */
  readonly draft: PlanItemDraft
  /** A create-form field changed (the page patches the draft). */
  readonly onDraftChange: (field: keyof PlanItemDraft, value: string) => void
  /** A `+` entry clicked: open the create form at the given index. */
  readonly onOpenCreate: (index: number) => void
  readonly onCreateSubmit: () => void
  readonly onCreateClose: () => void
  /** True while the createPlanItem mutation is in flight. */
  readonly createPending: boolean
  /** Last create failure message (business fault text). */
  readonly createFault: string | null

  // --- UI-5: edit form (RMW — B §19) + dependency face (B §17) ---------
  /** The edit-form draft for the selected item (prefilled by the page
   *  on selection change). */
  readonly editDraft: PlanItemDraft
  /** An edit-form field changed (the page patches the edit draft). */
  readonly onEditDraftChange: (field: keyof PlanItemDraft, value: string) => void
  readonly onEditSubmit: () => void
  readonly onEditClose: () => void
  /** True while the updatePlanItem mutation is in flight. */
  readonly updatePending: boolean
  /** Last edit failure message (business fault text). */
  readonly updateFault: string | null

  /** The selected item's Remove entry (the three-state label is
   *  computed here; one `removePlanItem` RPC underneath). */
  readonly onRemoveItem: (itemId: string) => void
  /** True while the removePlanItem mutation is in flight. */
  readonly removePending: boolean
  /** Last remove failure message (business fault text). */
  readonly removeFault: string | null

  // --- UI-5: dependency face (B §17; ADJ-7 edge source) -----------------
  /** The workstream's ACTIVE dependency edges (both endpoints in the
   *  canonical plan — the ADJ-7 projection from the Current slice). */
  readonly dependencyEdges: readonly DependencyEdgeDto[]
  /** The add-target select value (the page owns the transient state). */
  readonly depTargetId: string
  /** The add-target select changed ('' = back to the placeholder). */
  readonly onDepTargetChange: (targetId: string) => void
  /** The Add button clicked (the page reads its own target state and
   *  calls `store.addDependency`). */
  readonly onAddDependency: () => void
  /** Last addDependency failure message (business fault text). */
  readonly addDependencyFault: string | null
  /** A depends-on edge's Remove button clicked (by relationId). */
  readonly onRemoveDependency: (relationId: string) => void
  /** Last removeDependency failure message (business fault text). */
  readonly removeDependencyFault: string | null
}

/** 产品文案（中文）— canonical plan item kinds (legacy WP-4.3 copy). */
const KIND_LABEL: Record<PlanItemDto['kind'], string> = {
  TASK: '任务',
  GATE: '门',
  MILESTONE: '里程碑',
}

/** 产品文案（中文）— PlanFork overlay status (legacy WP-4.3 copy). */
const PF_STATUS_LABEL: Record<PlanForkDto['status'], string> = {
  OPEN: '待处理',
  STALE: '已陈旧',
}

/**
 * One B §19 field of the create/edit forms (label + input/textarea;
 * the data-strip-field hook is the e2e selector).
 */
function Field({
  field,
  label,
  value,
  onChange,
  multiline = false,
}: {
  field: keyof PlanItemDraft
  label: string
  value: string
  onChange: (field: keyof PlanItemDraft, value: string) => void
  multiline?: boolean
}): ReactElement {
  return (
    <label className={styles.formLabel}>
      {label}
      {multiline ? (
        <textarea
          className={styles.formField}
          data-strip-field={field}
          rows={3}
          value={value}
          onChange={e => onChange(field, e.target.value)}
        />
      ) : (
        <input
          className={styles.formField}
          data-strip-field={field}
          value={value}
          onChange={e => onChange(field, e.target.value)}
        />
      )}
    </label>
  )
}

/** One canonical plan row + its per-row `+` after-entry (B §11.4). */
function StripRow({
  item,
  index,
  count,
  onMoveItem,
  focused,
  onSetCurrentFocus,
  selected,
  onSelectItem,
  executionById,
  onOpenCreate,
  onRemoveItem,
  removePending,
}: {
  item: PlanItemDto
  index: number
  count: number
  onMoveItem: FutureZoneProps['onMoveItem']
  focused: boolean
  onSetCurrentFocus: FutureZoneProps['onSetCurrentFocus']
  selected: boolean
  onSelectItem: FutureZoneProps['onSelectItem']
  executionById: FutureZoneProps['executionById']
  onOpenCreate: FutureZoneProps['onOpenCreate']
  onRemoveItem: FutureZoneProps['onRemoveItem']
  removePending: FutureZoneProps['removePending']
}): ReactElement {
  const execution: TaskExecution | undefined =
    item.kind === 'TASK' ? executionById.get(item.id) : undefined
  const removeLabel = t(REMOVE_STATE_KEY[classifyRemoveState(item, executionById)])
  return (
    <>
      <li
        className={selected ? `${styles.planRow} ${styles.rowSelected}` : styles.planRow}
        data-strip-item={item.id}
        data-plan-focus={focused ? 'true' : undefined}
        data-strip-selected={selected ? 'true' : undefined}
        onClick={() => onSelectItem(item.id)}
      >
        <span className={styles.planPosition}>{index + 1}</span>
        <span className={styles.badge} data-kind={item.kind}>
          {KIND_LABEL[item.kind]}
        </span>
        <span className={styles.taskTitle}>{item.title}</span>
        <span className={styles.taskId}>{item.id}</span>
        {execution !== undefined && (
          <span className={styles.badge} data-strip-exec={execution} data-execution={execution}>
            {execution}
          </span>
        )}
        {focused && <span className={styles.focusMarker}>{t('ws.current.focusMarker')}</span>}
        <button
          type="button"
          className={styles.moveButton}
          data-strip-move-left={item.id}
          aria-label={`${t('ws.future.strip.moveLeft')}：${item.id}`}
          disabled={index === 0}
          onClick={e => {
            e.stopPropagation()
            onMoveItem(item.id, 'up')
          }}
        >
          ←
        </button>
        <button
          type="button"
          className={styles.moveButton}
          data-strip-move-right={item.id}
          aria-label={`${t('ws.future.strip.moveRight')}：${item.id}`}
          disabled={index === count - 1}
          onClick={e => {
            e.stopPropagation()
            onMoveItem(item.id, 'down')
          }}
        >
          →
        </button>
        <button
          type="button"
          className={styles.setFocusButton}
          data-strip-set-focus={item.id}
          aria-label={`Set as Current Focus: ${item.id}`}
          onClick={e => {
            e.stopPropagation()
            onSetCurrentFocus(item.id)
          }}
        >
          {t('ws.current.setFocus')}
        </button>
        <button
          type="button"
          className={styles.removeButton}
          data-strip-remove={item.id}
          aria-label={`${removeLabel}: ${item.id}`}
          disabled={removePending}
          onClick={e => {
            e.stopPropagation()
            onRemoveItem(item.id)
          }}
        >
          {removeLabel}
        </button>
      </li>
      <li className={styles.addSlot}>
        <button
          type="button"
          className={styles.addButton}
          data-strip-add-after={item.id}
          aria-label={`${t('ws.future.strip.addRow')}: ${item.id}`}
          onClick={() => onOpenCreate(index + 1)}
        >
          +
        </button>
      </li>
    </>
  )
}

/** One unresolved PlanFork overlay row (the WP-4.3 data seam, read-only
 *  inside the expanded badge — ADJ-9). */
function PlanForkRow({ planFork }: { planFork: PlanForkDto }): ReactElement {
  return (
    <li className={styles.planForkRow} data-pf={planFork.id} data-pf-status={planFork.status}>
      <span className={styles.taskId}>{planFork.id}</span>
      <span className={styles.badge} data-pf-status={planFork.status}>
        {PF_STATUS_LABEL[planFork.status]}
      </span>
      <span className={styles.planForkMeta}>
        提案 {planFork.proposedItemCount} 项 · 锚点 {planFork.forkAnchor} → {planFork.mergeAnchor}
      </span>
      <span className={styles.planForkReason}>{planFork.reason}</span>
    </li>
  )
}

/**
 * Render the Future Plan zone (the ordered strip + the create/edit
 * forms + the PF badge).
 * @param props - zone data + the page-owned callbacks (see
 *  `FutureZoneProps`).
 * @returns the zone panel element.
 */
export function FutureZone({
  planItems,
  planForks,
  unresolvedPlanForkCount,
  onMoveItem,
  reorderPending,
  reorderFault,
  focusedPlanItemId,
  onSetCurrentFocus,
  selectedItemId,
  onSelectItem,
  executionById,
  createForm,
  draft,
  onDraftChange,
  onOpenCreate,
  onCreateSubmit,
  onCreateClose,
  createPending,
  createFault,
  editDraft,
  onEditDraftChange,
  onEditSubmit,
  onEditClose,
  updatePending,
  updateFault,
  onRemoveItem,
  removePending,
  removeFault,
  dependencyEdges,
  depTargetId,
  onDepTargetChange,
  onAddDependency,
  addDependencyFault,
  onRemoveDependency,
  removeDependencyFault,
}: FutureZoneProps): ReactElement {
  const selectedItem =
    selectedItemId === null ? null : (planItems.find(item => item.id === selectedItemId) ?? null)
  const dependsOn =
    selectedItem === null ? [] : dependencyEdges.filter(edge => edge.sourceId === selectedItem.id)
  const dependedBy =
    selectedItem === null ? [] : dependencyEdges.filter(edge => edge.targetId === selectedItem.id)
  const titleOf = (id: string): string => planItems.find(item => item.id === id)?.title ?? ''

  return (
    <section className={styles.zone} data-strip aria-label="未来计划">
      <h2 className={styles.zoneTitle}>未来计划</h2>

      {/* ADJ-9: the PF count badge — top of the Future column, collapsed
          by default, rendered only while unresolved PFs exist. */}
      {unresolvedPlanForkCount > 0 && (
        <details className={styles.pfDetails} data-pf-badge>
          <summary className={styles.pfSummary}>
            {t('ws.future.pfBadge')}{unresolvedPlanForkCount}
          </summary>
          <ul className={styles.list}>
            {planForks.map(planFork => (
              <PlanForkRow key={planFork.id} planFork={planFork} />
            ))}
          </ul>
        </details>
      )}

      <h3 className={styles.sectionTitle}>{t('ws.future.strip.title')}</h3>
      {planItems.length === 0 ? (
        <p className={styles.empty}>{t('ws.future.strip.empty')}</p>
      ) : (
        <ol className={styles.planList} data-strip-list>
          <li className={styles.addSlot}>
            <button
              type="button"
              className={styles.addButton}
              data-strip-add-head
              aria-label={t('ws.future.strip.addHead')}
              onClick={() => onOpenCreate(0)}
            >
              +
            </button>
          </li>
          {planItems.map((item, index) => (
            <StripRow
              key={item.id}
              item={item}
              index={index}
              count={planItems.length}
              onMoveItem={onMoveItem}
              focused={item.id === focusedPlanItemId}
              onSetCurrentFocus={onSetCurrentFocus}
              selected={item.id === selectedItemId}
              onSelectItem={onSelectItem}
              executionById={executionById}
              onOpenCreate={onOpenCreate}
              onRemoveItem={onRemoveItem}
              removePending={removePending}
            />
          ))}
        </ol>
      )}

      {reorderPending && <p className={styles.reorderNote}>{t('ws.future.strip.reorderPending')}</p>}
      {reorderFault !== null && (
        <p className={styles.reorderFault}>
          {t('ws.future.strip.reorderFault')}{reorderFault}
        </p>
      )}
      {removeFault !== null && (
        <p className={styles.faultNote}>
          {t('ws.future.remove.fault')}：{removeFault}
        </p>
      )}

      {/* -- create form (B §11.4 / §19) -- */}
      {createForm !== null && (
        <div className={styles.formCard} data-strip-form>
          <h3 className={styles.sectionTitle}>{t('ws.future.create.title')}</h3>
          <label className={styles.formLabel}>
            {t('ws.future.create.kind')}
            <select
              className={styles.formField}
              data-strip-field="kind"
              value={draft.kind}
              onChange={e => onDraftChange('kind', e.target.value as PlanItemKind)}
            >
              <option value="TASK">{KIND_LABEL.TASK}</option>
              <option value="GATE">{KIND_LABEL.GATE}</option>
              <option value="MILESTONE">{KIND_LABEL.MILESTONE}</option>
            </select>
          </label>
          <Field
            field="title"
            label={t('dialog.fieldTitle')}
            value={draft.title}
            onChange={onDraftChange}
          />
          {draft.kind === 'TASK' && (
            <>
              <Field
                field="goal"
                label={t('ws.future.edit.fieldGoal')}
                value={draft.goal}
                onChange={onDraftChange}
                multiline
              />
              <Field
                field="acceptanceCriteria"
                label={t('ws.future.edit.fieldAcceptanceCriteria')}
                value={draft.acceptanceCriteria}
                onChange={onDraftChange}
                multiline
              />
              <Field
                field="deliverables"
                label={t('ws.future.edit.fieldDeliverables')}
                value={draft.deliverables}
                onChange={onDraftChange}
                multiline
              />
              <Field field="note" label={t('ws.future.edit.fieldNote')} value={draft.note} onChange={onDraftChange} />
            </>
          )}
          {draft.kind === 'GATE' && (
            <>
              <Field
                field="criteria"
                label={t('ws.future.edit.fieldCriteria')}
                value={draft.criteria}
                onChange={onDraftChange}
                multiline
              />
              <Field
                field="references"
                label={t('ws.future.edit.fieldReferences')}
                value={draft.references}
                onChange={onDraftChange}
                multiline
              />
            </>
          )}
          {draft.kind === 'MILESTONE' && (
            <Field
              field="statement"
              label={t('ws.future.edit.fieldStatement')}
              value={draft.statement}
              onChange={onDraftChange}
              multiline
            />
          )}
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.formSave}
              data-strip-form-save
              disabled={draft.title.trim().length === 0 || createPending}
              onClick={onCreateSubmit}
            >
              {t('dialog.save')}
            </button>
            <button
              type="button"
              className={styles.formCancel}
              data-strip-form-cancel
              onClick={onCreateClose}
            >
              {t('dialog.cancel')}
            </button>
          </div>
          {createPending && <p className={styles.reorderNote}>{t('ws.future.create.pending')}</p>}
          {createFault !== null && (
            <p className={styles.faultNote}>
              {t('ws.future.create.fault')}：{createFault}
            </p>
          )}
        </div>
      )}

      {/* -- edit form (RMW — B §19) + dependency face (B §17) -- */}
      {selectedItem !== null && (
        <div className={styles.formCard} data-strip-edit>
          <h3 className={styles.sectionTitle}>
            {t('ws.future.edit.title')} · {selectedItem.id}
          </h3>
          <Field
            field="title"
            label={t('dialog.fieldTitle')}
            value={editDraft.title}
            onChange={onEditDraftChange}
          />
          {editDraft.kind === 'TASK' && (
            <>
              <Field
                field="goal"
                label={t('ws.future.edit.fieldGoal')}
                value={editDraft.goal}
                onChange={onEditDraftChange}
                multiline
              />
              <Field
                field="acceptanceCriteria"
                label={t('ws.future.edit.fieldAcceptanceCriteria')}
                value={editDraft.acceptanceCriteria}
                onChange={onEditDraftChange}
                multiline
              />
              <Field
                field="deliverables"
                label={t('ws.future.edit.fieldDeliverables')}
                value={editDraft.deliverables}
                onChange={onEditDraftChange}
                multiline
              />
              <Field
                field="note"
                label={t('ws.future.edit.fieldNote')}
                value={editDraft.note}
                onChange={onEditDraftChange}
              />
            </>
          )}
          {editDraft.kind === 'GATE' && (
            <>
              <Field
                field="criteria"
                label={t('ws.future.edit.fieldCriteria')}
                value={editDraft.criteria}
                onChange={onEditDraftChange}
                multiline
              />
              <Field
                field="references"
                label={t('ws.future.edit.fieldReferences')}
                value={editDraft.references}
                onChange={onEditDraftChange}
                multiline
              />
            </>
          )}
          {editDraft.kind === 'MILESTONE' && (
            <Field
              field="statement"
              label={t('ws.future.edit.fieldStatement')}
              value={editDraft.statement}
              onChange={onEditDraftChange}
              multiline
            />
          )}
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.formSave}
              data-strip-edit-save
              disabled={editDraft.title.trim().length === 0 || updatePending}
              onClick={onEditSubmit}
            >
              {t('dialog.save')}
            </button>
            <button
              type="button"
              className={styles.formCancel}
              data-strip-edit-cancel
              onClick={onEditClose}
            >
              {t('dialog.cancel')}
            </button>
          </div>
          {updatePending && <p className={styles.reorderNote}>{t('ws.future.edit.pending')}</p>}
          {updateFault !== null && (
            <p className={styles.faultNote}>
              {t('ws.future.edit.fault')}：{updateFault}
            </p>
          )}

          {/* -- dependency face (B §17; reorder never touches these —
              §17.3) -- */}
          <h4 className={styles.sectionTitle}>{t('ws.future.dep.title')}</h4>
          {dependsOn.length === 0 && dependedBy.length === 0 ? (
            <p className={styles.empty}>{t('ws.future.dep.empty')}</p>
          ) : (
            <>
              <div data-dep-depends-on>
                <p className={styles.depHeading}>{t('ws.future.dep.dependsOn')}</p>
                {dependsOn.length === 0 ? (
                  <p className={styles.empty}>—</p>
                ) : (
                  <ul className={styles.depList}>
                    {dependsOn.map(edge => (
                      <li key={edge.relationId} className={styles.depRow} data-dep-edge={edge.relationId}>
                        <span className={styles.taskId}>{edge.targetId}</span>
                        <span className={styles.taskTitle}>{titleOf(edge.targetId)}</span>
                        <button
                          type="button"
                          className={styles.depButton}
                          data-dep-remove={edge.relationId}
                          aria-label={`${t('ws.future.dep.remove')}: ${edge.relationId}`}
                          onClick={() => onRemoveDependency(edge.relationId)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div data-dep-depended-by>
                <p className={styles.depHeading}>{t('ws.future.dep.dependedBy')}</p>
                {dependedBy.length === 0 ? (
                  <p className={styles.empty}>—</p>
                ) : (
                  <ul className={styles.depList}>
                    {dependedBy.map(edge => (
                      <li key={edge.relationId} className={styles.depRow} data-dep-edge={edge.relationId}>
                        <span className={styles.taskId}>{edge.sourceId}</span>
                        <span className={styles.taskTitle}>{titleOf(edge.sourceId)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          <div className={styles.depAddRow} data-dep-add>
            <select
              className={styles.formField}
              data-dep-add-target
              value={depTargetId}
              onChange={e => onDepTargetChange(e.target.value)}
            >
              <option value="">{t('ws.future.dep.addTarget')}</option>
              {planItems
                .filter(item => item.id !== selectedItem.id)
                .map(item => (
                  <option key={item.id} value={item.id}>
                    {KIND_LABEL[item.kind]} {item.id} · {item.title}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className={styles.formSave}
              data-dep-add-button
              disabled={depTargetId === ''}
              onClick={onAddDependency}
            >
              {t('ws.future.dep.add')}
            </button>
          </div>
          {addDependencyFault !== null && (
            <p className={styles.faultNote}>
              {t('ws.future.dep.fault')}：{addDependencyFault}
            </p>
          )}
          {removeDependencyFault !== null && (
            <p className={styles.faultNote}>
              {t('ws.future.dep.fault')}：{removeDependencyFault}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
