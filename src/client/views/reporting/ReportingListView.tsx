/**
 * ReportingItem 周报/清单 view — the CONTAINER (WP-5.3; the ONE
 * store-pulling file of its section; rows below are pure props).
 *
 * Plan §10.2 / 任务项 3: 「要向谁、何时、汇报什么」— 不是 Task。
 *  双模式（任务原文「周报/清单视图」）:
 *   - 清单: 按 §13 状态分组 + 每行渲染**合法迁移按钮**（按钮集 = host
 *     纯 §13 表 `legalRptTransitions` — client 迁移 guard 与 host
 *     service 同表, 单一真源）;
 *   - 周报: 近 7 天窗口（`weekWindow(now)`）内新建的条目 + 全量状态
 *     计数（「本周新增 / 待汇报 / 已汇报」摘要）。
 *
 * V1 诚实边界（视图内可见文案）: 本地草稿工作区 — 冻结 13-RPC 无 RPT
 * 写入/查询面; host 侧 DDL + service 持久化面本 WP 已交付（research.sqlite
 * reporting_item 表 + §13 状态机 service）, 供 host 流/未来 RPC 消费。
 */

import { useState, type ReactElement } from 'react'
import {
  legalRptTransitions,
  type LocalReportingItem,
  type ReportingWorkspace,
} from '../../stores/reporting-slices.js'
import type { RptStatus } from '../../../host/service/reporting/types.js'
import { RPT_STATUS_LABELS, weekWindow } from './reporting-format.js'
import { ReportingItemRow } from './reporting-item-row.js'
import { useReportingStore } from './use-reporting-store.js'
import styles from './reporting.module.css'

/** 清单模式的状态分组顺序（§13 五状态, 冻结表顺序）. */
const STATUS_ORDER: readonly RptStatus[] = [
  'OPEN',
  'MATERIAL_READY',
  'READY_TO_REPORT',
  'REPORTED',
  'FOLLOW_UP_REQUIRED',
]

export interface ReportingListViewProps {
  readonly workspace: ReportingWorkspace
  /** Injectable clock（默认 Date.now — 周报窗口）. */
  readonly now?: () => number
}

/** The ReportingItem 周报/清单 section. */
export function ReportingListView(props: ReportingListViewProps): ReactElement {
  const { workspace } = props
  const now = props.now ?? Date.now
  const snapshot = useReportingStore(workspace)

  const [mode, setMode] = useState<'checklist' | 'weekly'>('checklist')
  const [audience, setAudience] = useState('')
  const [statement, setStatement] = useState('')
  const [occasionRef, setOccasionRef] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleTransition(localId: string, to: RptStatus): void {
    setError(null)
    try {
      workspace.transitionReportingItem(localId, to)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleAdd(): void {
    if (audience.trim().length === 0 || statement.trim().length === 0) {
      setError('请填写面向与内容')
      return
    }
    try {
      workspace.addReportingItem({
        audience: audience.trim(),
        statement: statement.trim(),
        ...(occasionRef.trim().length > 0 ? { occasionRef: occasionRef.trim() } : {}),
      })
      setAudience('')
      setStatement('')
      setOccasionRef('')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /* -- 周报窗口投影（now − 7d → now, createdAt 命中） -- */
  const window = weekWindow(now())
  const weeklyNew = snapshot.reportingItems.filter(
    (item) => item.createdAt >= window.from && item.createdAt <= window.to,
  )
  const countByStatus = STATUS_ORDER.map((status) => ({
    status,
    count: snapshot.reportingItems.filter((item) => item.status === status).length,
  }))
  const pendingReport = snapshot.reportingItems.filter(
    (item) => item.status === 'MATERIAL_READY' || item.status === 'READY_TO_REPORT',
  )

  const groups = STATUS_ORDER.map((status) => ({
    status,
    items: snapshot.reportingItems.filter((item) => item.status === status),
  }))

  return (
    <section className={styles.section} aria-label="ReportingItem 周报与清单">
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>汇报清单（ReportingItem）</h2>
        <span className={styles.scopeNote}>本地草稿工作区（V1 — 宿主持久化面已就绪, 写入面待契约解冻）</span>
      </header>

      <nav className={styles.tabs} aria-label="视图模式">
        <button
          type="button"
          className={mode === 'checklist' ? styles.tabActive : styles.tab}
          aria-pressed={mode === 'checklist'}
          onClick={() => setMode('checklist')}
        >
          清单
        </button>
        <button
          type="button"
          className={mode === 'weekly' ? styles.tabActive : styles.tab}
          aria-pressed={mode === 'weekly'}
          onClick={() => setMode('weekly')}
        >
          周报（近 7 天）
        </button>
      </nav>

      {error !== null && (
        <p className={styles.error} role="alert">
          操作失败：{error}
        </p>
      )}

      {mode === 'checklist' ? (
        snapshot.reportingItems.length === 0 ? (
          <p className={styles.empty}>暂无汇报项（「要向谁、何时、汇报什么」— 不是 Task）</p>
        ) : (
          groups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div key={group.status} className={styles.group} data-status={group.status}>
                <h3 className={styles.groupTitle}>
                  {RPT_STATUS_LABELS[group.status]}（{group.items.length}）
                </h3>
                <ul className={styles.list} aria-label={`${RPT_STATUS_LABELS[group.status]} 清单`}>
                  {group.items.map((item: LocalReportingItem) => (
                    <ReportingItemRow
                      key={item.localId}
                      item={item}
                      transitions={legalRptTransitions(item.status)}
                      onTransition={handleTransition}
                    />
                  ))}
                </ul>
              </div>
            ))
        )
      ) : (
        <div className={styles.weekly} data-week-from={window.from} data-week-to={window.to}>
          <ul className={styles.weekSummary} aria-label="周报摘要">
            {countByStatus.map((entry) => (
              <li key={entry.status} className={styles.summaryChip} data-status={entry.status}>
                {RPT_STATUS_LABELS[entry.status]} {entry.count}
              </li>
            ))}
            <li className={styles.summaryChip} data-pending={pendingReport.length}>
              待汇报 {pendingReport.length}
            </li>
          </ul>
          {weeklyNew.length === 0 ? (
            <p className={styles.empty}>近 7 天没有新建的汇报项</p>
          ) : (
            <ul className={styles.list} aria-label="近 7 天新建汇报项">
              {weeklyNew.map((item) => (
                <ReportingItemRow
                  key={item.localId}
                  item={item}
                  transitions={legalRptTransitions(item.status)}
                  onTransition={handleTransition}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      <form
        className={styles.form}
        aria-label="新增汇报项"
        onSubmit={(e) => {
          e.preventDefault()
          handleAdd()
        }}
      >
        <label className={styles.field}>
          <span className={styles.fieldLabel}>面向（audience）</span>
          <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="如：导师 / 组会 / 期刊" />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>汇报什么（statement）</span>
          <input value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="如：本周实验结果与下周计划" />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>关联日程 SEV id（可选）</span>
          <input value={occasionRef} onChange={(e) => setOccasionRef(e.target.value)} placeholder="如：SEV-1" />
        </label>
        <button type="submit" className={styles.submit}>
          新增汇报项
        </button>
      </form>
    </section>
  )
}
