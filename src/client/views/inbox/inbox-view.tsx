/**
 * WP-6.4 — Research Inbox 展示层（纯 props 组件 — 零 hook、零 store 知识）。
 *
 * 展示分层纪律（任务书「容器/展示分层」）: 本文件只渲染; 数据由容器
 * （inbox-container.tsx）经 use-inbox-slice hook + inbox-model 纯投影后
 * 以 props 传入; 用户操作（转换/忽略/快捷捕获 — 全部仅用户, §6 矩阵）
 * 以回调 props 上抛; 无宿主接线时操作按钮禁用 + 提示（绝不伪造本地
 * 状态 — 宿主是数据真值, 同 WP-5.2/WP-4.6 纪律）。
 *
 * 三个组件（任务书目标 2）:
 *   - `<InboxListView>`     — Inbox 清单（来源/类别 badge + 状态 badge +
 *                             高影响升级标记 ⚠ + payload 预览 + 时间）;
 *   - `<InboxItemDetail>`   — 条目详情（payload / raw / contextRefs /
 *                             convertedTo + 转换/忽略操作面）;
 *   - `<InboxConversionDialog>` — 转换确认对话框（§28 7 kind 选择 +
 *                             每 kind 字段表单 + 显式确认 — 「转换需要
 *                             显式确认或明确 policy」）。
 *
 * 中文文案（组件纪律）。
 */

import type { JSX } from 'react'

import type { InboxConversionKind, InboxItemDto } from '../../stores/inbox-slice.js'
import type { SliceState } from '../../stores/model.js'
import {
  buildConversionPayload,
  formatInboxTime,
  INBOX_CONVERSION_FIELD_MODELS,
  INBOX_CONVERSION_KIND_LABEL,
  INBOX_CONVERSION_KINDS,
  INBOX_ESCALATION_REASON_LABEL,
  escalationReasonText,
  type InboxRow,
} from './inbox-model.js'
import styles from './inbox.module.css'

/* -------------------------------------------------------------------- *
 * 切片状态行（同 WP-5.2 SliceStatusNote 口径 — 本视图独立小份）
 * -------------------------------------------------------------------- */

export function InboxSliceStatusNote({
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
 * 清单（任务书目标 2①: 类别/source badge + 升级标记）
 * -------------------------------------------------------------------- */

export interface InboxListViewProps {
  readonly slice: SliceState<{ readonly items: readonly InboxItemDto[] }>
  readonly rows: readonly InboxRow[]
  readonly selectedId: string | null
  readonly onOpenItem: (id: string) => void
}

/** Inbox 清单（§11 捕获暂存层 — 捕获优先, 不是正式科研状态）。 */
export function InboxListView({ slice, rows, selectedId, onOpenItem }: InboxListViewProps): JSX.Element {
  const hasData = slice.data !== null
  const capturedCount = rows.filter((r) => r.item.state === 'CAPTURED').length
  return (
    <section className={styles.listSection} aria-label="研究收件箱清单" data-inbox-list>
      <h2 className={styles.sectionTitle}>
        研究收件箱
        {hasData ? <span className={styles.listCount}>{capturedCount} 个待处理 / {rows.length} 全部</span> : null}
      </h2>
      <InboxSliceStatusNote status={slice.status} error={slice.error} hasData={hasData} />
      {hasData && rows.length === 0 ? <p className={styles.emptyNote}>收件箱为空（捕获优先 — 尚无条目）</p> : null}
      <ul className={styles.itemList}>
        {rows.map((row) => {
          const marker = escalationReasonText(row.escalation)
          return (
            <li
              key={row.item.id}
              className={row.item.id === selectedId ? `${styles.itemCard} ${styles.itemCardSelected}` : styles.itemCard}
              data-inbox-item={row.item.id}
              data-inbox-state={row.item.state}
              data-inbox-source={row.item.source}
              data-escalation={row.escalation?.highImpact === true ? 'high-impact' : undefined}
            >
              <div className={styles.itemHead}>
                <button type="button" className={styles.itemTitle} data-open-inbox={row.item.id} onClick={() => onOpenItem(row.item.id)}>
                  <span className={styles.itemId}>{row.item.id}</span>
                  <span className={styles.itemPreview}>{row.preview}</span>
                </button>
                <span className={`${styles.badge} ${row.item.state === 'CAPTURED' ? styles.badgeLive : styles.badgeMuted}`}>
                  {row.stateLabel}
                </span>
                {row.escalation?.highImpact === true ? (
                  <span className={`${styles.badge} ${styles.badgeDanger}`} data-escalation="high-impact" title={marker ?? '高影响'}>
                    ⚠ 高影响
                  </span>
                ) : null}
              </div>
              <div className={styles.itemMeta}>
                <span className={`${styles.badge} ${row.category === 'HUMAN' ? styles.badgeHuman : styles.badgeMech}`}>
                  {row.categoryLabel}
                </span>
                <span className={`${styles.badge} ${styles.badgeSource}`}>{row.sourceLabel}</span>
                <span className={styles.itemTime}>{formatInboxTime(row.item.createdAt)}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* -------------------------------------------------------------------- *
 * 条目详情（任务书目标 2②: 详情 + 转换确认入口 + 忽略）
 * -------------------------------------------------------------------- */

export interface InboxItemDetailProps {
  readonly item: InboxItemDto
  readonly onConvert: (kind: InboxConversionKind) => void
  readonly onDismiss?: (id: string) => void
  readonly onBack: () => void
}

/** 条目详情（payload / raw / contextRefs / convertedTo + 用户操作面）。 */
export function InboxItemDetail({ item, onConvert, onDismiss, onBack }: InboxItemDetailProps): JSX.Element {
  const reasons = item.raw !== null ? item.raw : null
  const esc = reasons !== null && typeof reasons.escalation === 'object' && reasons.escalation !== null
    ? (reasons.escalation as { highImpact?: unknown; reasons?: unknown })
    : null
  const escReasons = esc !== null && Array.isArray(esc.reasons)
    ? esc.reasons.filter((r): r is string => typeof r === 'string')
    : []
  const highImpact = esc !== null && esc.highImpact === true
  return (
    <section className={styles.detailSection} aria-label={`收件箱条目 ${item.id}`} data-inbox-detail={item.id}>
      <button type="button" className={styles.backBtn} onClick={onBack}>
        ← 返回清单
      </button>
      <header className={styles.detailHead}>
        <h2 className={styles.detailTitle}>
          <span className={styles.itemId}>{item.id}</span>
          <span className={`${styles.badge} ${item.state === 'CAPTURED' ? styles.badgeLive : styles.badgeMuted}`}>
            {item.state === 'CAPTURED' ? '已捕获' : item.state === 'CONVERTED' ? '已转换' : '已忽略'}
          </span>
          {highImpact ? (
            <span className={`${styles.badge} ${styles.badgeDanger}`} data-escalation="high-impact">
              ⚠ 高影响{escReasons.length > 0 ? `（${escReasons.map((r) => INBOX_ESCALATION_REASON_LABEL[r] ?? r).join('、')}）` : ''}
            </span>
          ) : null}
        </h2>
        <p className={styles.detailMeta}>
          来源：{item.source} · 捕获于 {formatInboxTime(item.createdAt)}
        </p>
      </header>
      <div className={styles.payloadBox}>
        <p className={styles.payloadLabel}>捕获内容</p>
        <pre className={styles.payloadText}>{item.payload}</pre>
      </div>
      {item.contextRefs.length > 0 ? (
        <div className={styles.refRow}>
          <span className={styles.refLabel}>上下文引用</span>
          {item.contextRefs.map((ref) => (
            <span key={`${ref.kind}:${ref.id}`} className={styles.chip} data-ref-kind={ref.kind}>
              {ref.kind}:{ref.id}
            </span>
          ))}
        </div>
      ) : null}
      {item.convertedTo !== null ? (
        <div className={styles.convertedRow} data-converted-to-kind={item.convertedTo.kind}>
          <span className={styles.refLabel}>已转换为</span>
          <span className={styles.chip}>{item.convertedTo.kind}:{item.convertedTo.id}</span>
        </div>
      ) : null}
      {item.raw !== null ? (
        <details className={styles.rawBox}>
          <summary>原始数据（raw）</summary>
          <pre className={styles.rawText}>{JSON.stringify(item.raw, null, 2)}</pre>
        </details>
      ) : null}
      {item.state === 'CAPTURED' ? (
        <footer className={styles.detailActions}>
          <span className={styles.actionsLabel}>转换为正式对象（显式确认 — 计划书 §28）:</span>
          <div className={styles.kindRow}>
            {INBOX_CONVERSION_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={styles.kindBtn}
                data-convert-kind={kind}
                onClick={() => onConvert(kind)}
              >
                {INBOX_CONVERSION_KIND_LABEL[kind]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.dismissBtn}`}
            data-dismiss-inbox={item.id}
            onClick={() => onDismiss?.(item.id)}
            disabled={onDismiss === undefined}
            title={onDismiss === undefined ? '宿主操作通道未接线' : `忽略 ${item.id}`}
          >
            忽略（DISMISSED）
          </button>
        </footer>
      ) : null}
    </section>
  )
}

/* -------------------------------------------------------------------- *
 * 转换确认对话框（任务书目标 2③ — §28「需显式确认」的 UI 面）
 * -------------------------------------------------------------------- */

export interface InboxConversionDialogProps {
  readonly item: InboxItemDto
  readonly kind: InboxConversionKind
  readonly fieldValues: Readonly<Record<string, string>>
  readonly busy: boolean
  readonly error: string | null
  readonly onFieldChange: (name: string, value: string) => void
  /** 显式确认（容器组装 `fields` 载荷后调宿主转换面）。 */
  readonly onConfirm: (fields: Record<string, unknown>) => void
  readonly onCancel: () => void
}

/**
 * 转换确认对话框（§28 转换动作集 — 用户显式确认是转换的唯一入口;
 * 对话框 = 「转换需要显式确认或明确 policy」的类型表面）。
 */
export function InboxConversionDialog({
  item,
  kind,
  fieldValues,
  busy,
  error,
  onFieldChange,
  onConfirm,
  onCancel,
}: InboxConversionDialogProps): JSX.Element {
  const models = INBOX_CONVERSION_FIELD_MODELS[kind]
  const canConfirm =
    !busy && models.every((m) => !m.required || (fieldValues[m.name] ?? '').trim().length > 0)
  return (
    <div className={styles.dialogOverlay} role="dialog" aria-modal="true" aria-label={`转换 ${item.id} 为${INBOX_CONVERSION_KIND_LABEL[kind]}`}>
      <div className={styles.dialog}>
        <header className={styles.dialogHead}>
          <h3 className={styles.dialogTitle}>
            转换 {item.id} 为 {INBOX_CONVERSION_KIND_LABEL[kind]}
          </h3>
          <button type="button" className={styles.backBtn} onClick={onCancel} disabled={busy}>
            取消
          </button>
        </header>
        <p className={styles.dialogNote}>
          显式确认: 转换将创建正式 {INBOX_CONVERSION_KIND_LABEL[kind]} 对象, 并将收件箱条目标记为 CONVERTED（§13 终态 — 不可重转, 重转 = 新条目）。
        </p>
        <form
          className={styles.fieldForm}
          onSubmit={(e) => {
            e.preventDefault()
            if (canConfirm) onConfirm(buildConversionPayload(kind, fieldValues))
          }}
        >
          {models.map((model) => (
            <label key={model.name} className={styles.fieldRow}>
              <span className={styles.fieldLabel}>
                {model.label}
                {model.required ? <span className={styles.requiredMark}> *</span> : null}
              </span>
              <input
                className={styles.fieldInput}
                type="text"
                value={fieldValues[model.name] ?? ''}
                placeholder={model.placeholder}
                disabled={busy}
                onChange={(e) => onFieldChange(model.name, e.target.value)}
              />
            </label>
          ))}
          {error !== null ? (
            <p className={styles.sliceError} role="alert">
              转换失败：{error}
            </p>
          ) : null}
          <footer className={styles.dialogActions}>
            <button type="button" className={styles.actionBtn} onClick={onCancel} disabled={busy}>
              取消
            </button>
            <button type="submit" className={`${styles.actionBtn} ${styles.confirmBtn}`} disabled={!canConfirm} data-convert-confirm={item.id}>
              {busy ? '转换中…' : '确认转换'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
