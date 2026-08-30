/**
 * Future Plan zone (WP-4.3, §27.4 right column).
 *
 * PURE display component: data via props only (the container passes the
 * `getWorkstream` `future` projection verbatim). No ctx, no hooks, no DSH.
 *
 * Contents (§27.4 / ARCHITECTURE §3.1 — the Future zone holds ONLY
 * PLANNED items and unresolved PlanForks):
 *  - the canonical plan as a lineary ordered G/T/M list — rendered in
 *    EXACT plan position (plan order is user intent, `plan order ≠
 *    dependency`; the list position is the UI's only claim);
 *  - the Agent PlanFork OVERLAY DATA SEAM (WP-4.3 scope): the unresolved
 *    PFs (OPEN/STALE) and their count are rendered as plain data rows —
 *    the DISTINCT VISUAL STYLE and the select/dismiss controls belong to
 *    WP-4.5 (「PF 视觉区分属 WP-4.5，本 WP 留数据缝」). The rows carry the
 *    `data-pf` attribute + status so WP-4.5 can style/differentiate them
 *    without touching the data path;
 *  - the minimal REORDER GUI entry (this WP's mutation-face hook): one
 *    up / one down button per row calling `onMoveItem(itemId, direction)`
 *    — the container resolves that callback into the frozen `reorderPlan`
 *    mutation (adjacent swap; `buildReorderArgs` keeps it a permutation);
 *  - UI-4 (ADJ-11 / B §20): the CURRENT-FOCUS entry — the focused plan
 *    row carries a `Focus` marker (`data-plan-focus`) and EVERY row
 *    carries the verbatim `Set as Current Focus` button; the container
 *    resolves the callback into the frozen `setCurrentFocus` mutation
 *    (the marker + the Current-zone focus row re-render from the
 *    refetched `currentFocus` slice).
 */

import type { ReactElement } from 'react'
import type { PlanForkDto, PlanItemDto } from '../../../shared/rpc-contracts.js'
import { t } from '../../i18n/copy.js'
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
  /** True while a reorder mutation is in flight (rendered as the
   *  「排序保存中…」 note). The buttons stay enabled: `reorderPlan` only
   *  permutes the FIXED item set, so a second move queued before the
   *  refetch lands is still a valid permutation (the host applies the
   *  last one; the view re-renders from the refetched slice). */
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
}

/** 产品文案（中文）— canonical plan item kinds. */
const KIND_LABEL: Record<PlanItemDto['kind'], string> = {
  TASK: '任务',
  GATE: '门',
  MILESTONE: '里程碑',
}

/** 产品文案（中文）— PlanFork overlay status (data-seam wording; the
 *  visual differentiation is WP-4.5's). */
const PF_STATUS_LABEL: Record<PlanForkDto['status'], string> = {
  OPEN: '待处理',
  STALE: '已陈旧',
}

/** One canonical plan row with its reorder entry buttons + the
 *  current-focus entry (B §20: marker on the focused row, verbatim
 *  `Set as Current Focus` button on every row). */
function PlanRow({
  item,
  index,
  count,
  onMoveItem,
  focused,
  onSetCurrentFocus,
}: {
  item: PlanItemDto
  index: number
  count: number
  onMoveItem: FutureZoneProps['onMoveItem']
  focused: boolean
  onSetCurrentFocus: FutureZoneProps['onSetCurrentFocus']
}): ReactElement {
  return (
    <li
      className={styles.planRow}
      data-plan-item={item.id}
      data-plan-focus={focused ? 'true' : undefined}
    >
      <span className={styles.planPosition}>{index + 1}</span>
      <span className={styles.badge} data-kind={item.kind}>
        {KIND_LABEL[item.kind]}
      </span>
      <span className={styles.taskTitle}>{item.title}</span>
      <span className={styles.taskId}>{item.id}</span>
      {focused && <span className={styles.focusMarker}>{t('ws.current.focusMarker')}</span>}
      <button
        type="button"
        className={styles.moveButton}
        aria-label={`上移：${item.id}`}
        disabled={index === 0}
        onClick={() => onMoveItem(item.id, 'up')}
      >
        ↑
      </button>
      <button
        type="button"
        className={styles.moveButton}
        aria-label={`下移：${item.id}`}
        disabled={index === count - 1}
        onClick={() => onMoveItem(item.id, 'down')}
      >
        ↓
      </button>
      <button
        type="button"
        className={styles.setFocusButton}
        aria-label={`Set as Current Focus: ${item.id}`}
        onClick={() => onSetCurrentFocus(item.id)}
      >
        {t('ws.current.setFocus')}
      </button>
    </li>
  )
}

/** One unresolved PlanFork overlay row (the WP-4.5 data seam). */
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
 * Render the Future Plan zone.
 * @param props - zone data + reorder callback + the current-focus
 *  entry (see `FutureZoneProps`).
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
}: FutureZoneProps): ReactElement {
  return (
    <section className={styles.zone} aria-label="未来计划">
      <h2 className={styles.zoneTitle}>未来计划</h2>

      <h3 className={styles.sectionTitle}>计划序列（G/T/M 有序）</h3>
      {planItems.length === 0 ? (
        <p className={styles.empty}>计划为空</p>
      ) : (
        <ol className={styles.planList}>
          {planItems.map((item, index) => (
            <PlanRow
              key={item.id}
              item={item}
              index={index}
              count={planItems.length}
              onMoveItem={onMoveItem}
              focused={item.id === focusedPlanItemId}
              onSetCurrentFocus={onSetCurrentFocus}
            />
          ))}
        </ol>
      )}

      {reorderPending && <p className={styles.reorderNote}>排序保存中…</p>}
      {reorderFault !== null && <p className={styles.reorderFault}>排序失败：{reorderFault}</p>}

      <h3 className={styles.sectionTitle}>未决 PlanFork</h3>
      {unresolvedPlanForkCount === 0 ? (
        <p className={styles.empty}>暂无未决 PlanFork</p>
      ) : (
        <>
          <p className={styles.planForkCount}>未决 PlanFork：{unresolvedPlanForkCount}</p>
          <ul className={styles.list}>
            {planForks.map(planFork => (
              <PlanForkRow key={planFork.id} planFork={planFork} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
