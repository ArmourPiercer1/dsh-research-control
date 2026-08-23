/**
 * Interaction 记录流 — the CONTAINER (WP-5.3; the ONE store-pulling file
 * of its section; every component below is pure props).
 *
 * Plan §10.1 / 任务项 3: Interaction 记录流 + 登记表单（USER 语义）。
 *
 * Data path (DSH_ADAPTER §6 — components never see ctx):
 *  - 记录流 = 工作区切片 `interactions`（经**生产** registerInteraction
 *    RPC 成功登记的记录 — 容器调用主 store 的 mutation 成功后把工作区
 *    追加; 主 store 按 INVALIDATE_REGISTRY 失效 project 切片, 与
 *    WP-4.1b 行为一致）;
 *  - 登记表单 → `store.registerInteraction(args)`（冻结 13-RPC 第 10 号,
 *    WP-5.3 生产实现: host 落 interaction 表）→ resolve 后
 *    `workspace.recordInteraction(result)`; 业务故障（carrier ok:false）
 *    ⇒ `ResearchRpcError` 拒绝, 表单显示错误条（不落工作区）。
 *
 * 诚实边界（视图内可见文案）: 本记录流 = 本会话登记记录; 完整历史
 * 查询面不在冻结 13-RPC 内（占位 `upcomingInteractions: null` 归后续
 * 契约解冻 — 不伪造历史数据）。
 */

import { useState, type ReactElement } from 'react'
import type { ResearchStore } from '../../stores/index.js'
import { isInteractionKind, type InteractionKind } from '../../../host/service/reporting/types.js'
import {
  orderedInteractionStream,
  type RegisteredInteractionEntry,
  type ReportingWorkspace,
} from '../../stores/reporting-slices.js'
import { InteractionRow } from './interaction-row.js'
import { formatEpochMs } from './reporting-format.js'
import { useReportingStore } from './use-reporting-store.js'
import styles from './reporting.module.css'

/** 表单的 6 个冻结 kind（§10.1）. */
const KIND_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'MEETING', label: '会议' },
  { value: 'AD_HOC_DISCUSSION', label: '即时讨论' },
  { value: 'SUPERVISOR_UPDATE', label: '导师汇报' },
  { value: 'COLLABORATOR_DISCUSSION', label: '协作者讨论' },
  { value: 'EXPERIMENT_SHIFT_HANDOFF', label: '实验交接' },
  { value: 'OTHER', label: '其他' },
]

export interface InteractionStreamViewProps {
  /** The reporting workspace (slice store factory result — by props). */
  readonly workspace: ReportingWorkspace
  /** The main research store (the registerInteraction mutation face). */
  readonly store: ResearchStore
  /** Injectable clock（默认 Date.now — 表单默认发生时间）. */
  readonly now?: () => number
}

/** The Interaction 记录流 section (记录流 + 登记表单). */
export function InteractionStreamView(props: InteractionStreamViewProps): ReactElement {
  const { workspace, store } = props
  const now = props.now ?? Date.now
  const snapshot = useReportingStore(workspace)

  const [kind, setKind] = useState('MEETING')
  const [title, setTitle] = useState('')
  const [occurredAt, setOccurredAt] = useState(() => now())
  const [participants, setParticipants] = useState('')
  const [notes, setNotes] = useState('')
  const [relatedWorkstreams, setRelatedWorkstreams] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRegistered, setLastRegistered] = useState<RegisteredInteractionEntry | null>(null)

  function handleRegister(): void {
    if (submitting) return
    if (!isInteractionKind(kind)) {
      setError('请选择有效的 Interaction 类型')
      return
    }
    if (title.trim().length === 0) {
      setError('请填写 Interaction 标题')
      return
    }
    const wsList = relatedWorkstreams
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    const kindValue: InteractionKind = kind
    setSubmitting(true)
    setError(null)
    void (async () => {
      try {
        const result = await store.registerInteraction({
          kind: kindValue,
          title: title.trim(),
          occurredAt,
          ...(participants.trim().length > 0
            ? { participants: participants.split(',').map((s) => s.trim()).filter((s) => s.length > 0) }
            : {}),
          ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
          ...(wsList.length > 0 ? { relatedWorkstreams: wsList } : {}),
        })
        workspace.recordInteraction(result)
        setLastRegistered(result)
        setTitle('')
        setParticipants('')
        setNotes('')
        setRelatedWorkstreams('')
      } catch (err) {
        // 区分两类错误文案：客户端校验失败（无前缀）vs RPC/宿主业务故障（带「登记失败：」前缀）。
        setError('登记失败：' + (err instanceof Error ? err.message : String(err)))
      } finally {
        setSubmitting(false)
      }
    })()
  }

  const stream = orderedInteractionStream(snapshot.interactions)

  return (
    <section className={styles.section} aria-label="Interaction 记录流">
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Interaction 记录流</h2>
        <span className={styles.scopeNote}>本会话登记记录（已持久化到宿主 operational DB）</span>
      </header>

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {lastRegistered !== null && error === null && (
        <p className={styles.ok} role="status">
          已登记 {lastRegistered.id}（{formatEpochMs(lastRegistered.createdAt)}）
        </p>
      )}

      {stream.length === 0 ? (
        <p className={styles.empty}>
          暂无登记的 Interaction（完整历史查询面不在冻结 13-RPC 内 — 见 WP-5.3 边界注记）
        </p>
      ) : (
        <ul className={styles.list} aria-label="Interaction 记录流">
          {stream.map((entry) => (
            <InteractionRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}

      <form
        className={styles.form}
        aria-label="登记 Interaction"
        onSubmit={(e) => {
          e.preventDefault()
          handleRegister()
        }}
      >
        <label className={styles.field}>
          <span className={styles.fieldLabel}>类型</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>标题</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：与导师讨论实验方案" />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>发生时间（epoch ms）</span>
          <input
            type="number"
            value={String(occurredAt)}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isSafeInteger(v) && v >= 0) setOccurredAt(v)
            }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>参与人（逗号分隔）</span>
          <input value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder="张三, 李四" />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>关联 Workstream（逗号分隔）</span>
          <input
            value={relatedWorkstreams}
            onChange={(e) => setRelatedWorkstreams(e.target.value)}
            placeholder="WS-1, WS-2"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>纪要（Markdown, 可选）</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
        <button type="submit" className={styles.submit} disabled={submitting || kind.length === 0}>
          {submitting ? '登记中…' : '登记 Interaction'}
        </button>
      </form>
    </section>
  )
}
