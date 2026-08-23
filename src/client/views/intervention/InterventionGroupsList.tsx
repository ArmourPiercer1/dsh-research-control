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
 * WP-7.4 / G7 S1b — 一键调查入口（「调查此事项」）: 非 CLOSED 行渲染
 * 调查问题输入（data-iv-question, 容器持有）+ 「调查此事项」按钮
 * （data-iv-investigate — 点击 = 用户启动只读 Investigator, §6 矩阵
 * 启动 U ✅ / P ❌; 校验与 busy 态在容器层, 成功/失败经容器 fault 面
 * 反馈; 通道 = DSH 内置 commands/execute 网关域, 零新增 RPC — 见
 * dsh-adapter/remote/investigate.ts）。
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
  /** WP-7.4 一键调查: 调查问题输入变更（容器持有每行值）. */
  readonly onQuestion: (id: string, question: string) => void
  /** WP-7.4 一键调查: 「调查此事项」点击（容器校验 + 调通道）. */
  readonly onInvestigate: (item: InterventionDto, question: string) => void
}

/** 单行（数据属性全暴露 — 测试断言面）。 */
function InterventionGroupsRow({
  item,
  busy,
  note,
  question,
  investigateBusy,
  callbacks,
}: {
  readonly item: InterventionDto
  readonly busy: boolean
  readonly note: string
  readonly question: string
  readonly investigateBusy: boolean
  readonly callbacks: InterventionRowCallbacks
}): ReactElement {
  const { onTransition, onNote, onOpenWorkstream, onQuestion, onInvestigate } = callbacks
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
          {/* WP-7.4 / G7 S1b — 一键调查入口（只读 Investigator —
              transient 输出, 落库需用户显式保存; §6 启动 U ✅ / P ❌）。 */}
          <input
            className={styles.noteInput}
            data-iv-question={item.id}
            value={question}
            placeholder="调查问题（Investigator 将只读调查此事项）"
            onChange={(e) => onQuestion(item.id, e.target.value)}
          />
          <button
            type="button"
            className={styles.button}
            data-iv-action="investigate"
            data-iv-investigate={item.id}
            disabled={busy || investigateBusy}
            onClick={() => onInvestigate(item, question)}
          >
            {investigateBusy ? '调查中…' : '调查此事项'}
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
  /** WP-7.4 每行调查问题（容器层持有）。 */
  readonly questions: ReadonlyMap<string, string>
  /** 迁移进行中（全部按钮禁用 — 防双击竞态）。 */
  readonly busy: boolean
  /** WP-7.4 调查进行中（调查按钮禁用; 状态迁移按钮不受影响 — 调查
   *  不改变 Intervention 状态, 两个操作面可并行）。 */
  readonly investigateBusy: boolean
  readonly onTransition: (item: InterventionDto, status: 'OPEN' | 'PENDING' | 'CLOSED') => void
  readonly onNote: (id: string, note: string) => void
  /** WP-7.4 调查问题输入变更。 */
  readonly onQuestion: (id: string, question: string) => void
  /** WP-7.4 「调查此事项」点击（容器校验 + 调通道; 抛错 = fault 面）。 */
  readonly onInvestigate: (item: InterventionDto, question: string) => void
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
  questions,
  busy,
  investigateBusy,
  onTransition,
  onNote,
  onQuestion,
  onInvestigate,
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
                  question={questions.get(item.id) ?? ''}
                  investigateBusy={investigateBusy}
                  callbacks={{
                    onTransition,
                    onNote,
                    onQuestion,
                    onInvestigate,
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
