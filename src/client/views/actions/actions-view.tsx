/**
 * WP-5.2 — 注意力三对象展示层（纯 props 组件 — 零 hook、零 store 知识）。
 *
 * 展示分层纪律（任务书「容器/展示分层」）: 本文件只渲染; 数据由容器
 * （actions-container.tsx）经 use-actions-slices hook + actions-model 纯
 * 投影后以 props 传入; 用户操作（PROMOTE/DISMISS/CLEAR）以回调 props
 * 上抛（无宿主接线时禁用 + 提示 — 见各 Section 的 `*Enabled` 语义）。
 *
 * 三个 Section（任务书目标 3）:
 *   - `<BlockerSection>`      — Blocker 显著区（ACTIVE 卡 + CLEARED 折叠）;
 *   - `<ObjectiveProgress>`   — Objective 进度概览（计数 + 逐行状态/优先级/
 *                               目标日期 + 待转正提案数）;
 *   - `<NextActionsSection>`  — NextAction 清单（按 objective 分组 —
 *                               分组规则见 actions-model.ts 模块头）。
 *
 * 中文文案（组件纪律）; 状态词: 待转正/已转正/已弃用 · 活跃/已清除 ·
 * 活跃/已达成/已放弃 · 未关联目标。
 */

import type { CSSProperties } from 'react'

import type { ObjectiveDto } from '../../../shared/rpc-contracts.js'
import type { BlockerItem, NextActionItem, ObjectiveProgressData } from '../../stores/actions-slices.js'
import type { SliceState } from '../../stores/model.js'
import type {
  BlockerSections,
  NextActionGroup,
  ObjectiveCounts,
  ObjectiveProgressRow,
} from './actions-model.js'
import styles from './actions.module.css'

/* -------------------------------------------------------------------- *
 * 状态词表（中文 — 单一来源）
 * -------------------------------------------------------------------- */

export const NA_STATUS_LABEL: Record<NextActionItem['status'], string> = {
  PROPOSED: '待转正',
  PROMOTED: '已转正',
  DISMISSED: '已弃用',
}

export const BLK_STATUS_LABEL: Record<BlockerItem['status'], string> = {
  ACTIVE: '活跃',
  CLEARED: '已清除',
}

export const OBJ_STATUS_LABEL: Record<ObjectiveDto['status'], string> = {
  ACTIVE: '活跃',
  ACHIEVED: '已达成',
  DROPPED: '已放弃',
}

/** 切片通用状态行（loading/error — stale-while-revalidate 下数据仍在则附注）。 */
export function SliceStatusNote({
  status,
  error,
  hasData,
}: {
  readonly status: SliceState<unknown>['status']
  readonly error: string | null
  readonly hasData: boolean
}): JSX.Element | null {
  if (status === 'error' && error !== null) {
    return (
      <p className={styles.sliceError} role="alert">
        加载失败：{error}
        {hasData ? '（显示上次成功数据）' : ''}
      </p>
    )
  }
  if (status === 'loading' && !hasData) {
    return <p className={styles.sliceLoading}>加载中…</p>
  }
  return null
}

/* -------------------------------------------------------------------- *
 * Blocker 显著区
 * -------------------------------------------------------------------- */

export interface BlockerSectionProps {
  readonly slice: SliceState<{ readonly items: readonly BlockerItem[] }>
  readonly sections: BlockerSections
  readonly onClear?: (id: string) => void
}

/** Blocker 显著区（§9.4 — 不可由图推导的现实阻碍; CLEARED 终态无控件）。 */
export function BlockerSection({ slice, sections, onClear }: BlockerSectionProps): JSX.Element {
  const hasData = slice.data !== null
  return (
    <section className={styles.blockerSection} aria-label="阻碍显著区">
      <h2 className={styles.sectionTitle}>
        阻碍
        {sections.active.length > 0 ? <span className={styles.blockerCount}>{sections.active.length} 个活跃</span> : null}
      </h2>
      <SliceStatusNote status={slice.status} error={slice.error} hasData={hasData} />
      {hasData && sections.active.length === 0 ? <p className={styles.emptyNote}>无活跃阻碍</p> : null}
      <ul className={styles.blockerList}>
        {sections.active.map((b) => (
          <li key={b.id} className={styles.blockerCard} data-blocker={b.id} data-blk-status="ACTIVE">
            <div className={styles.blockerHead}>
              <span className={`${styles.badge} ${styles.badgeDanger}`}>{BLK_STATUS_LABEL.ACTIVE}</span>
              <span className={styles.blockerId}>{b.id}</span>
              <button
                type="button"
                className={styles.actionBtn}
                data-clear-blocker={b.id}
                onClick={() => onClear?.(b.id)}
                disabled={onClear === undefined}
                title={onClear === undefined ? '宿主操作通道未接线' : `清除 ${b.id}`}
              >
                清除
              </button>
            </div>
            <p className={styles.blockerStatement}>{b.statement}</p>
            <div className={styles.affectedRow}>
              <span className={styles.affectedLabel}>阻碍对象</span>
              {b.affects.map((ref) => (
                <span key={`${ref.kind}:${ref.id}`} className={styles.chip} data-ref-kind={ref.kind}>
                  {ref.id}
                </span>
              ))}
            </div>
            <p className={styles.blockerSource}>来源：{b.source}</p>
          </li>
        ))}
      </ul>
      {hasData && sections.cleared.length > 0 ? (
        <details className={styles.clearedBox}>
          <summary>{sections.cleared.length} 个已清除</summary>
          <ul className={styles.clearedList}>
            {sections.cleared.map((b) => (
              <li key={b.id} className={styles.clearedRow} data-blocker={b.id} data-blk-status="CLEARED">
                <span className={`${styles.badge} ${styles.badgeMuted}`}>{BLK_STATUS_LABEL.CLEARED}</span>
                <span className={styles.clearedStatement}>{b.statement}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

/* -------------------------------------------------------------------- *
 * Objective 进度概览
 * -------------------------------------------------------------------- */

export interface ObjectiveProgressProps {
  readonly slice: SliceState<ObjectiveProgressData>
  readonly rows: readonly ObjectiveProgressRow[]
  readonly counts: ObjectiveCounts
}

/** Objective 进度概览（§9.1 声明式投影 — 状态/优先级/目标日期 + 待转正提案数）。 */
export function ObjectiveProgress({ slice, rows, counts }: ObjectiveProgressProps): JSX.Element {
  const hasData = slice.data !== null
  return (
    <section className={styles.objectiveSection} aria-label="目标进度概览">
      <h2 className={styles.sectionTitle}>目标进度</h2>
      <SliceStatusNote status={slice.status} error={slice.error} hasData={hasData} />
      {hasData ? (
        <>
          <p className={styles.objectiveSummary} data-obj-total={counts.total}>
            {counts.total} 个目标：{counts.active} 活跃 / {counts.achieved} 已达成 / {counts.dropped} 已放弃
          </p>
          {rows.length === 0 ? <p className={styles.emptyNote}>尚无 Objective 声明（.research/objectives.yaml）</p> : null}
          <table className={styles.objectiveTable}>
            <thead>
              <tr>
                <th scope="col">目标</th>
                <th scope="col">优先级</th>
                <th scope="col">状态</th>
                <th scope="col">目标日期</th>
                <th scope="col">待转正提案</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ objective, proposedCount }) => (
                <tr key={objective.id} data-objective={objective.id} data-obj-status={objective.status}>
                  <td className={styles.objectiveStatement}>{objective.statement}</td>
                  <td>
                    <span className={styles.chip}>{objective.priority}</span>
                  </td>
                  <td>
                    <span
                      className={
                        objective.status === 'ACTIVE'
                          ? `${styles.badge} ${styles.badgeActive}`
                          : objective.status === 'ACHIEVED'
                            ? `${styles.badge} ${styles.badgeDone}`
                            : `${styles.badge} ${styles.badgeMuted}`
                      }
                    >
                      {OBJ_STATUS_LABEL[objective.status]}
                    </span>
                  </td>
                  <td>{objective.targetDate !== null ? formatTs(objective.targetDate) : '—'}</td>
                  <td data-proposed-count={proposedCount}>{proposedCount > 0 ? String(proposedCount) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  )
}

/** epoch ms → YYYY-MM-DD（展示面 — 目标日期为 ISO date 语义, §9.1）。 */
function formatTs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/* -------------------------------------------------------------------- *
 * NextAction 清单（按 objective 分组）
 * -------------------------------------------------------------------- */

export interface NextActionsSectionProps {
  readonly slice: SliceState<{ readonly items: readonly NextActionItem[] }>
  readonly groups: readonly NextActionGroup[]
  readonly onPromote?: (id: string) => void
  readonly onDismiss?: (id: string) => void
}

/**
 * NextAction 清单（§9.3 — 轻量「可能值得做」, 不是 Task）: 按 objective
 * 分组; PROPOSED 行带「转正 / 弃用」用户入口（仅用户 — §6 矩阵; 无宿主
 * 接线时禁用 + 提示）; PROMOTED 行显示转正后的 Task 指针。
 */
export function NextActionsSection({ slice, groups, onPromote, onDismiss }: NextActionsSectionProps): JSX.Element {
  const hasData = slice.data !== null
  return (
    <section className={styles.nextActionSection} aria-label="下一步行动清单">
      <h2 className={styles.sectionTitle}>下一步行动</h2>
      <SliceStatusNote status={slice.status} error={slice.error} hasData={hasData} />
      {hasData && groups.length === 0 ? <p className={styles.emptyNote}>暂无 NextAction（Agent 可经工具面提案）</p> : null}
      <div className={styles.groupList}>
        {groups.map((group) => (
          <div
            key={group.objective === null ? 'unassigned' : group.objective.id}
            className={styles.group}
            data-group={group.objective === null ? '未关联目标' : group.objective.id}
          >
            <div className={styles.groupHead}>
              {group.objective === null ? (
                <span className={styles.groupTitleMuted}>未关联目标</span>
              ) : (
                <>
                  <span className={styles.groupTitle}>{group.objective.statement}</span>
                  <span className={styles.chip}>{group.objective.scope === 'PROJECT' ? '项目级' : '主题级'}</span>
                  <span className={styles.chip}>{group.objective.priority}</span>
                </>
              )}
            </div>
            <ul className={styles.itemList}>
              {group.items.map((item) => (
                <li
                  key={item.id}
                  className={`${styles.itemRow} ${item.status === 'DISMISSED' ? styles.itemMuted : ''}`}
                  data-next-action={item.id}
                  data-na-status={item.status}
                >
                  <div className={styles.itemHead}>
                    <span
                      className={
                        item.status === 'PROPOSED'
                          ? `${styles.badge} ${styles.badgeActive}`
                          : item.status === 'PROMOTED'
                            ? `${styles.badge} ${styles.badgeDone}`
                            : `${styles.badge} ${styles.badgeMuted}`
                      }
                    >
                      {NA_STATUS_LABEL[item.status]}
                    </span>
                    <span className={styles.itemId}>{item.id}</span>
                    {item.workstreamId !== null ? (
                      <span className={styles.chip} data-ws-id={item.workstreamId}>
                        {item.workstreamId}
                      </span>
                    ) : null}
                    {item.status === 'PROPOSED' ? (
                      <span className={styles.itemActions}>
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles.actionPrimary}`}
                          data-promote={item.id}
                          onClick={() => onPromote?.(item.id)}
                          disabled={onPromote === undefined}
                          title={onPromote === undefined ? '宿主操作通道未接线' : `将 ${item.id} 转正为 Task`}
                        >
                          转正
                        </button>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          data-dismiss={item.id}
                          onClick={() => onDismiss?.(item.id)}
                          disabled={onDismiss === undefined}
                          title={onDismiss === undefined ? '宿主操作通道未接线' : `弃用 ${item.id}`}
                        >
                          弃用
                        </button>
                      </span>
                    ) : null}
                  </div>
                  <p className={styles.itemStatement}>{item.statement}</p>
                  {item.rationale !== null ? <p className={styles.itemRationale}>理由：{item.rationale}</p> : null}
                  {item.status === 'PROMOTED' && item.promotedToTaskId !== null ? (
                    <p className={styles.itemPromoted}>
                      已转正为 <span data-task-id={item.promotedToTaskId}>{item.promotedToTaskId}</span>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
