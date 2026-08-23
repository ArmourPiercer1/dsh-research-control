/**
 * ScheduledEvent 日程列表（时间轴）— the CONTAINER (WP-5.3; the ONE
 * store-pulling file of its section; rows below are pure props).
 *
 * Plan §10.3 / 任务项 1+3: **只管理用户登记的事件; 不接外部 Calendar**。
 * V1 到期语义（schedule.ts 单一真源, 视图文案如实标注）:
 *   - 无调度器 / 无提醒推送 — 到期 = **查询面按时间窗过滤**;
 *   - ONCE → `at` ∈ 窗口; RECURRING → 活跃跨度 (−∞, until] 与窗口相交
 *     （冻结形状无锚点 ⇒ 不投影具体 tick — 不伪造日期）;
 *   - 时间轴排序 = scheduleSortKey（ONCE → at; RECURRING → until/尾部）。
 *
 * 窗口档位（任务「时间轴」）: 未来 30 天 / 未来 90 天 / 全部。
 */

import { useState, type ReactElement } from 'react'
import { upcomingEvents, type LocalSevSchedule, type ReportingWorkspace } from '../../stores/reporting-slices.js'
import { SEV_FREQ_LABELS, formatEpochMs } from './reporting-format.js'
import { ScheduledEventRow } from './scheduled-event-row.js'
import { useReportingStore } from './use-reporting-store.js'
import styles from './reporting.module.css'

type WindowMode = '30d' | '90d' | 'all'

const DAY_MS = 24 * 60 * 60 * 1000

export interface ScheduledEventTimelineProps {
  readonly workspace: ReportingWorkspace
  /** Injectable clock（默认 Date.now — 窗口起点）. */
  readonly now?: () => number
}

/** The ScheduledEvent 时间轴 section (窗口过滤 + 登记草稿表单). */
export function ScheduledEventTimeline(props: ScheduledEventTimelineProps): ReactElement {
  const { workspace } = props
  const now = props.now ?? Date.now
  const snapshot = useReportingStore(workspace)

  const [mode, setMode] = useState<WindowMode>('30d')
  const [title, setTitle] = useState('')
  const [scheduleKind, setScheduleKind] = useState<'ONCE' | 'RECURRING'>('ONCE')
  const [onceAt, setOnceAt] = useState(() => now() + DAY_MS)
  const [freq, setFreq] = useState('WEEKLY')
  const [interval, setIntervalValue] = useState(1)
  const [until, setUntil] = useState<number | null>(null)
  const [leadMs, setLeadMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const origin = now()
  const window =
    mode === '30d'
      ? { from: origin, to: origin + 30 * DAY_MS }
      : mode === '90d'
        ? { from: origin, to: origin + 90 * DAY_MS }
        : null
  const events = upcomingEvents(snapshot.scheduledEvents, window)

  function handleAdd(): void {
    if (title.trim().length === 0) {
      setError('请填写日程标题')
      return
    }
    const schedule: LocalSevSchedule =
      scheduleKind === 'ONCE'
        ? { kind: 'ONCE', at: onceAt }
        : {
            kind: 'RECURRING',
            freq: freq as 'DAILY' | 'WEEKLY' | 'MONTHLY',
            interval: interval >= 1 ? interval : 1,
            ...(until !== null ? { until } : {}),
          }
    try {
      workspace.addScheduledEvent({
        title: title.trim(),
        schedule,
        ...(leadMs !== null ? { reminderLeadMs: leadMs } : {}),
      })
      setTitle('')
      setUntil(null)
      setLeadMs(null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className={styles.section} aria-label="ScheduledEvent 日程时间轴">
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>日程（ScheduledEvent）</h2>
        <span className={styles.scopeNote}>
          V1：仅管理用户登记的事件 — 不接外部 Calendar；无调度器/提醒推送（到期 = 查询面时间窗过滤）
        </span>
      </header>

      <nav className={styles.tabs} aria-label="时间窗">
        <button
          type="button"
          className={mode === '30d' ? styles.tabActive : styles.tab}
          aria-pressed={mode === '30d'}
          onClick={() => setMode('30d')}
        >
          未来 30 天
        </button>
        <button
          type="button"
          className={mode === '90d' ? styles.tabActive : styles.tab}
          aria-pressed={mode === '90d'}
          onClick={() => setMode('90d')}
        >
          未来 90 天
        </button>
        <button
          type="button"
          className={mode === 'all' ? styles.tabActive : styles.tab}
          aria-pressed={mode === 'all'}
          onClick={() => setMode('all')}
        >
          全部
        </button>
      </nav>

      {error !== null && (
        <p className={styles.error} role="alert">
          操作失败：{error}
        </p>
      )}

      {events.length === 0 ? (
        <p className={styles.empty}>
          该时间窗内没有日程（窗口：{formatEpochMs(window?.from ?? null)} 起
          {window?.to !== undefined && window?.to !== null ? ` 至 ${formatEpochMs(window.to)}` : ''}）
        </p>
      ) : (
        <ul className={styles.timeline} aria-label="日程时间轴">
          {events.map((event) => (
            <ScheduledEventRow key={event.localId} event={event} />
          ))}
        </ul>
      )}

      <form
        className={styles.form}
        aria-label="登记日程"
        onSubmit={(e) => {
          e.preventDefault()
          handleAdd()
        }}
      >
        <label className={styles.field}>
          <span className={styles.fieldLabel}>标题</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：组会汇报" />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>类型</span>
          <select
            value={scheduleKind}
            onChange={(e) => setScheduleKind(e.target.value === 'RECURRING' ? 'RECURRING' : 'ONCE')}
          >
            <option value="ONCE">一次性</option>
            <option value="RECURRING">重复</option>
          </select>
        </label>
        {scheduleKind === 'ONCE' ? (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>发生时间（epoch ms）</span>
            <input
              type="number"
              value={String(onceAt)}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (Number.isSafeInteger(v) && v >= 0) setOnceAt(v)
              }}
            />
          </label>
        ) : (
          <>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>频率</span>
              <select value={freq} onChange={(e) => setFreq(e.target.value)}>
                {(Object.keys(SEV_FREQ_LABELS) as readonly string[]).map((f) => (
                  <option key={f} value={f}>
                    {SEV_FREQ_LABELS[f]}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>间隔（≥1）</span>
              <input
                type="number"
                value={String(interval)}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isSafeInteger(v) && v >= 1) setIntervalValue(v)
                }}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>截止 until（epoch ms, 可选）</span>
              <input
                type="number"
                value={until === null ? '' : String(until)}
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw === '') {
                    setUntil(null)
                    return
                  }
                  const v = Number(raw)
                  if (Number.isSafeInteger(v) && v >= 0) setUntil(v)
                }}
              />
            </label>
          </>
        )}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>提前提醒（ms, 可选 — 展示用）</span>
          <input
            type="number"
            value={leadMs === null ? '' : String(leadMs)}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                setLeadMs(null)
                return
              }
              const v = Number(raw)
              if (Number.isSafeInteger(v) && v >= 0) setLeadMs(v)
            }}
          />
        </label>
        <button type="submit" className={styles.submit}>
          登记日程
        </button>
      </form>
    </section>
  )
}
