/**
 * WP-5.1 — Intervention 分组列表（**展示层**: 纯 props, 零 store / 零
 * DSH import — 容器层 InterventionGroupsView 投影数据后传下来）。
 *
 * 分组（任务目标 3）: 两个来源组（机械触发 / 用户创建）各带计数徽标;
 * 每行: 标题 + id/来源/创建时间 meta + **状态徽标**（OPEN / PENDING /
 * CLOSED, 数据属性 data-iv-status 可断言）+ WS 钻取 chips。
 *
 * 操作面（用户操作 — INV-PERM-4 的 GUI 半边）: 非 CLOSED 行渲染状态
 * 迁移按钮, 与冻结 §13 迁移表 1:1（OPEN → 待处理(PENDING) / 关闭;
 * PENDING → 重新打开(OPEN) / 关闭; CLOSED 终态无按钮 — 重开 = 新
 * Intervention）; 关闭行携带备注输入（「关闭时用户填写」, §9.2 —
 * 必填校验在容器层, 失败反馈走容器的 fault 面）。
 *
 * INV-ATTN-1（只排序不隐藏）: 本组件**全量**渲染传入的每组 items —
 * 不截断、不折叠、不隐藏（空组渲染空态文案 — 组本身不消失）。
 */

import type { ReactElement } from 'react'

import type { InterventionDto } from '../../../shared/rpc-contracts.js'
import type { InterventionGroup } from '../../stores/intervention-slices.js'
import styles from './intervention.module.css'

/** 来源组 → 中文文案（任务: GroupBy 机械触发 / 用户创建）。 */
const GROUP_LABEL: Record<InterventionGroup['source'], string> = {
  MECHANICAL: '机械触发',
  USER_CREATED: '用户创建',
}

/** Intervention origin → 中文文案（与既有 home / drilldown 视图同款措辞）。 */
const ORIGIN_LABEL: Record<InterventionDto['origin'], string> = {
  USER: '用户',
  AGENT_REPORT: 'Agent 报告',
  AUTO_FLOODING: '自动洪泛检测',
  AUTO_AUDIT: '自动审计',
}

/** epoch ms → 展示日期（与 home 视图同款格式: YYYY-MM-DD）。 */
function formatEpochDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

export interface InterventionRowCallbacks {
  readonly onTransition: (item: InterventionDto, status: 'OPEN' | 'PENDING' | 'CLOSED') => void
  readonly onNote: (id: string, note: string) => void
  readonly onOpenWorkstream: (workstreamId: string) => void
}

/** 单行（数据属性全暴露 — 测试断言面）。 */
function InterventionGroupsRow({
  item,
  busy,
  note,
  callbacks,
}: {
  readonly item: InterventionDto
  readonly busy: boolean
  readonly note: string
  readonly callbacks: InterventionRowCallbacks
}): ReactElement {
  const { onTransition, onNote, onOpenWorkstream } = callbacks
  return (
    <li className={styles.row} data-iv-id={item.id} data-iv-origin={item.origin} data-iv-status={item.status}>
      <p className={styles.rowTitle}>{item.title}</p>
      <p className={styles.rowMeta}>
        {item.id} · 来源：{ORIGIN_LABEL[item.origin]} · {formatEpochDate(item.createdAt)}
      </p>
      <span className={`${styles.badge} ${styles[`badge_${item.status}`]}`} data-iv-badge={item.status}>
        {item.status}
      </span>
      <p className={styles.wsChips}>
        {item.workstreamIds.map((wsId) => (
          <button key={wsId} type="button" className={styles.wsChip} data-iv-ws={wsId} onClick={() => onOpenWorkstream(wsId)} title="打开所属 Workstream">
            {wsId}
          </button>
        ))}
      </p>
      {item.status !== 'CLOSED' && (
        <p className={styles.controls}>
          <input
            className={styles.noteInput}
            data-iv-note={item.id}
            value={note}
            placeholder="关闭备注（CLOSED 时必填）"
            onChange={(e) => onNote(item.id, e.target.value)}
          />
          {item.status === 'OPEN' && (
            <button type="button" className={styles.button} data-iv-action="pending" data-iv-id={item.id} disabled={busy} onClick={() => onTransition(item, 'PENDING')}>
              待处理
            </button>
          )}
          {item.status === 'PENDING' && (
            <button type="button" className={styles.button} data-iv-action="reopen" data-iv-id={item.id} disabled={busy} onClick={() => onTransition(item, 'OPEN')}>
              重新打开
            </button>
          )}
          <button type="button" className={styles.buttonClose} data-iv-action="close" data-iv-id={item.id} disabled={busy} onClick={() => onTransition(item, 'CLOSED')}>
            关闭
          </button>
        </p>
      )}
    </li>
  )
}

export interface InterventionGroupsListProps {
  /** 固定组序 [机械触发, 用户创建]（空组也在 — INV-ATTN-1 不隐藏）。 */
  readonly groups: readonly InterventionGroup[]
  readonly total: number
  /** 每行关闭备注（容器层持有）。 */
  readonly notes: ReadonlyMap<string, string>
  /** 迁移进行中（全部按钮禁用 — 防双击竞态）。 */
  readonly busy: boolean
  readonly onTransition: (item: InterventionDto, status: 'OPEN' | 'PENDING' | 'CLOSED') => void
  readonly onNote: (id: string, note: string) => void
  readonly onOpenWorkstream?: (workstreamId: string) => void
}

/**
 * 分组列表（展示层纯组件）: 两组全量渲染 + 状态徽标 + 用户操作面。
 * @param props - 分组数据 + 回调（容器投影后传入, 零 store 依赖）。
 * @returns 分组列表元素。
 */
export function InterventionGroupsList({
  groups,
  total,
  notes,
  busy,
  onTransition,
  onNote,
  onOpenWorkstream,
}: InterventionGroupsListProps): ReactElement {
  return (
    <div className={styles.list} data-iv-total={total}>
      {groups.map((group) => (
        <section key={group.source} className={styles.group} data-group-source={group.source}>
          <h3 className={styles.groupTitle}>
            {GROUP_LABEL[group.source]}
            <span className={styles.groupCount} data-group-count={group.source}>
              {group.items.length}
            </span>
          </h3>
          {group.items.length === 0 ? (
            <p className={styles.groupEmpty}>暂无</p>
          ) : (
            <ul className={styles.rows}>
              {group.items.map((item) => (
                <InterventionGroupsRow
                  key={item.id}
                  item={item}
                  busy={busy}
                  note={notes.get(item.id) ?? ''}
                  callbacks={{
                    onTransition,
                    onNote,
                    onOpenWorkstream: (wsId) => {
                      onOpenWorkstream?.(wsId)
                    },
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
