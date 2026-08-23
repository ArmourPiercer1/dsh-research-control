/**
 * WP-7.3 — transient investigator 展示层（纯 props 组件 — 零 hook、零
 * store 知识 — 与 inbox-view.tsx 同款纪律）。
 *
 * 展示分层纪律（任务书「容器/展示分层」）: 本文件只渲染; 数据由容器
 * （investigator-container.tsx）经 use-analysis-slice hook +
 * investigator-model 纯投影后以 props 传入; 用户操作（保存为
 * AnalysisRecord — 仅用户, INV-PERM-3）以回调 props 上抛; 无宿主接线时
 * 操作按钮禁用 + 提示（绝不伪造本地状态 — 宿主是数据真值）。
 *
 * 两个组件（任务书目标 3）:
 *   - `<InvestigatorTransientPanel>` — transient 结果面板（**只读渲染** +
 *     「保存为 AnalysisRecord」按钮 → 确认对话框 → 保存流; 数据来源 =
 *     launcher 会话指针 → sessionlink 读取面, 不落任何 operational 表 —
 *     计划书 §26.2「默认 transient」）;
 *   - `<SaveAnalysisRecordDialog>` — 保存确认对话框（显式确认 —
 *     「仅用户显式保存才落 AnalysisRecord」的 UI 面: sourceRef /
 *     content（Markdown 必填）/ investigatorRunId? / dshSessionId?）。
 *
 * 中文文案（组件纪律）。
 */

import type { JSX } from 'react'

import type { SaveAnalysisRecordArgs } from '../../stores/analysis-slice.js'
import type { SliceState } from '../../stores/model.js'
import {
  OBJECT_KINDS,
  buildSavePayload,
  canConfirmSave,
  type SavedRecordRow,
  type SaveDialogFieldValues,
  type TransientPanelRows,
} from './investigator-model.js'
import styles from './investigator.module.css'

/* -------------------------------------------------------------------- *
 * 切片状态行（同 inbox InboxSliceStatusNote 口径 — 本视图独立小份）
 * -------------------------------------------------------------------- */

export function TransientSliceStatusNote({
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
 * transient 结果面板（任务书目标 3① — 只读渲染 + 保存入口）
 * -------------------------------------------------------------------- */

export interface InvestigatorTransientPanelProps {
  readonly slice: SliceState<{ readonly sessionId: string } | null>
  readonly rows: TransientPanelRows
  /** 已保存记录行（面板底部「已保存的 AnalysisRecord」区 — 空 = 尚无）。 */
  readonly savedRows: readonly SavedRecordRow[]
  /** records 切片状态（保存区加载失败时大声透出 — 同 transient 区口径）。 */
  readonly savedSlice: SliceState<{ readonly records: readonly unknown[] }>
  readonly sessionId: string
  readonly onSave?: () => void
}

/**
 * transient 结果面板（只读 — 面板本身对数据零操作; 「保存为
 * AnalysisRecord」是唯一出口, 经确认对话框显式确认后落库, INV-PERM-3）。
 * 数据三行逐字段诚实渲染缺席态（会话已 dispose / 未绑定 / 无 formal run）。
 */
export function InvestigatorTransientPanel({ slice, rows, savedRows, savedSlice, sessionId, onSave }: InvestigatorTransientPanelProps): JSX.Element {
  const hasData = slice.data !== null
  return (
    <section className={styles.panel} aria-label="Investigator transient 结果" data-transient-panel={sessionId}>
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>
          Investigator 结果
          <span className={`${styles.badge} ${styles.badgeTransient}`} data-transient-flag>
            transient — 未落盘
          </span>
        </h2>
        <p className={styles.panelMeta}>
          会话 <span className={styles.sessionId}>{sessionId}</span> · {rows.headline}
        </p>
      </header>
      <TransientSliceStatusNote status={slice.status} error={slice.error} hasData={hasData} />

      {hasData ? (
        <div className={styles.factRows}>
          {/* 行 1: live session 摘要（只读列出 — 不进 session 内容, INV-DB-2）。 */}
          <div className={styles.factRow} data-fact="session" data-present={rows.session !== null}>
            <span className={styles.factLabel}>会话</span>
            {rows.session === null ? (
              <span className={styles.absentNote}>不在 live 列表（已 dispose 或未知 — 诚实透出, 不虚构）</span>
            ) : (
              <span className={styles.factValue}>
                <span className={`${styles.badge} ${rows.session.running ? styles.badgeRunning : styles.badgeIdle}`}>
                  {rows.session.running ? '运行中' : '空闲'}
                </span>
                {rows.session.title !== null ? <span className={styles.factDim}> {rows.session.title}</span> : null}
                {rows.session.cwd !== null ? (
                  <span className={styles.factDim} data-session-cwd={rows.session.cwd}>
                    {' '}
                    · {rows.session.cwd}
                  </span>
                ) : null}
              </span>
            )}
          </div>
          {/* 行 2: sessionlink 指针（INV-DB-2 唯一持久绑定面 — 未绑定 = 常见）。 */}
          <div className={styles.factRow} data-fact="pointer" data-present={rows.pointer !== null}>
            <span className={styles.factLabel}>绑定</span>
            {rows.pointer === null ? (
              <span className={styles.absentNote}>未绑定 workstream（一次性只读调查 — 无 formal Run 载体, 常见态）</span>
            ) : (
              <span className={styles.factValue}>
                <span className={styles.chip}>{rows.pointer.workstreamId}</span>
                {rows.pointer.runId !== null ? (
                  <span className={styles.chip} data-pointer-run={rows.pointer.runId}>
                    {rows.pointer.runId}
                  </span>
                ) : (
                  <span className={styles.factDim}> 无 open run</span>
                )}
                <span className={styles.factDim}> 事件指针 seq={rows.pointer.lastSeq}</span>
              </span>
            )}
          </div>
          {/* 行 3: formal run 关联（dsh_session_id — 每 session 至多一条）。 */}
          <div className={styles.factRow} data-fact="run" data-present={rows.run !== null}>
            <span className={styles.factLabel}>Run</span>
            {rows.run === null ? (
              <span className={styles.absentNote}>无 formal run 关联</span>
            ) : (
              <span className={styles.factValue}>
                <span className={styles.chip} data-run-id={rows.run.id}>
                  {rows.run.id}
                </span>
                <span className={`${styles.badge} ${styles.badgeRunStatus}`}>{rows.runStatusLabel}</span>
              </span>
            )}
          </div>
        </div>
      ) : null}

      {/* 已保存区（只读列表 — 保存成功后容器自动刷新此区）。 */}
      <div className={styles.savedSection} data-saved-count={savedRows.length}>
        <h3 className={styles.savedTitle}>已保存的 AnalysisRecord（{savedRows.length}）</h3>
        {savedSlice.status === 'error' && savedSlice.error !== null && savedRows.length === 0 ? (
          <p className={styles.sliceError} role="alert">
            保存记录加载失败：{savedSlice.error}
          </p>
        ) : savedRows.length === 0 ? (
          <p className={styles.emptyNote}>尚无保存 — investigator 输出默认 transient, 仅用户显式保存才落盘（INV-PERM-3）</p>
        ) : (
          <ul className={styles.savedList}>
            {savedRows.map((row) => (
              <li key={row.record.id} className={styles.savedItem} data-saved-id={row.record.id}>
                <div className={styles.savedHead}>
                  <span className={styles.itemId}>{row.record.id}</span>
                  <span className={styles.chip} data-saved-source={row.sourceRefText}>
                    {row.sourceRefLabel} {row.sourceRefText}
                  </span>
                  {row.runLabel !== null ? <span className={styles.chip}>{row.runLabel}</span> : null}
                  <span className={styles.itemTime}>{row.timeText}</span>
                </div>
                <pre className={styles.savedContent}>{row.record.content}</pre>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className={styles.panelActions}>
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.saveBtn}`}
          onClick={onSave}
          disabled={onSave === undefined}
          title={onSave === undefined ? '宿主保存通道未接线（13-RPC 冻结清单无 AnalysisRecord 面）' : '将本次 investigator 分析显式保存为 AnalysisRecord'}
        >
          保存为 AnalysisRecord
        </button>
        <span className={styles.actionsHint}>显式保存 — 仅用户操作落盘（INV-PERM-3）</span>
      </footer>
    </section>
  )
}

/* -------------------------------------------------------------------- *
 * 保存确认对话框（任务书目标 3② — 「仅用户显式保存」的 UI 面）
 * -------------------------------------------------------------------- */

export interface SaveAnalysisRecordDialogProps {
  readonly sessionId: string
  readonly fieldValues: Readonly<SaveDialogFieldValues>
  readonly busy: boolean
  readonly error: string | null
  readonly onFieldChange: (name: keyof SaveDialogFieldValues, value: string) => void
  /** 显式确认（容器组装载荷后调宿主保存面 — 用户门在宿主侧）。 */
  readonly onConfirm: (args: SaveAnalysisRecordArgs) => void
  readonly onCancel: () => void
}

/**
 * 保存确认对话框（INV-PERM-3 的 UI 落点 — 用户显式确认是落库的唯一入口;
 * 对话框 = 「仅用户显式保存才落 AnalysisRecord」的类型表面）。content
 * （Markdown）必填; sourceRef.id 须为合法对象 id; investigatorRunId 可选
 * （R-<n> 形态门）; 空选值不携带（不虚构）。
 */
export function SaveAnalysisRecordDialog({
  sessionId,
  fieldValues,
  busy,
  error,
  onFieldChange,
  onConfirm,
  onCancel,
}: SaveAnalysisRecordDialogProps): JSX.Element {
  const confirmable = !busy && canConfirmSave(fieldValues)
  return (
    <div className={styles.dialogOverlay} role="dialog" aria-modal="true" aria-label={`保存 ${sessionId} 的分析为 AnalysisRecord`}>
      <div className={styles.dialog}>
        <header className={styles.dialogHead}>
          <h3 className={styles.dialogTitle}>保存为 AnalysisRecord</h3>
          <button type="button" className={styles.closeBtn} onClick={onCancel} disabled={busy}>
            取消
          </button>
        </header>
        <p className={styles.dialogNote}>
          显式保存: 本次 investigator 分析将以 AnalysisRecord 落 operational DB（AN 号分配, 保存后不可变 — 修正 = 新记录）。
          transient 面板其余数据不受影响（默认 transient, 不落盘 — INV-PERM-3）。
        </p>
        <form
          className={styles.fieldForm}
          onSubmit={(e) => {
            e.preventDefault()
            if (confirmable) onConfirm(buildSavePayload(fieldValues))
          }}
        >
          <div className={styles.fieldRowPair}>
            <label className={styles.fieldRow}>
              <span className={styles.fieldLabel}>
                来源对象 kind<span className={styles.requiredMark}> *</span>
              </span>
              <select
                className={styles.fieldInput}
                value={fieldValues.sourceRefKind}
                disabled={busy}
                onChange={(e) => onFieldChange('sourceRefKind', e.target.value)}
              >
                {OBJECT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.fieldRow}>
              <span className={styles.fieldLabel}>
                来源对象 id<span className={styles.requiredMark}> *</span>
              </span>
              <input
                className={styles.fieldInput}
                type="text"
                value={fieldValues.sourceRefId}
                placeholder="IV-5"
                disabled={busy}
                onChange={(e) => onFieldChange('sourceRefId', e.target.value)}
              />
            </label>
          </div>
          <label className={styles.fieldRow}>
            <span className={styles.fieldLabel}>
              分析内容（Markdown）<span className={styles.requiredMark}> *</span>
            </span>
            <textarea
              className={`${styles.fieldInput} ${styles.contentArea}`}
              value={fieldValues.content}
              placeholder="investigator 分析内容（从会话中摘录 / 整理）"
              disabled={busy}
              onChange={(e) => onFieldChange('content', e.target.value)}
            />
          </label>
          <div className={styles.fieldRowPair}>
            <label className={styles.fieldRow}>
              <span className={styles.fieldLabel}>关联 Run（可选）</span>
              <input
                className={styles.fieldInput}
                type="text"
                value={fieldValues.investigatorRunId}
                placeholder="R-81（留空 = 不携带）"
                disabled={busy}
                onChange={(e) => onFieldChange('investigatorRunId', e.target.value)}
              />
            </label>
            <label className={styles.fieldRow}>
              <span className={styles.fieldLabel}>DSH session（可选）</span>
              <input
                className={styles.fieldInput}
                type="text"
                value={fieldValues.dshSessionId}
                placeholder="investigator-&lt;uuid&gt;"
                disabled={busy}
                onChange={(e) => onFieldChange('dshSessionId', e.target.value)}
              />
            </label>
          </div>
          {error !== null ? (
            <p className={styles.sliceError} role="alert">
              保存失败：{error}
            </p>
          ) : null}
          <footer className={styles.dialogActions}>
            <button type="button" className={styles.actionBtn} onClick={onCancel} disabled={busy}>
              取消
            </button>
            <button type="submit" className={`${styles.actionBtn} ${styles.confirmBtn}`} disabled={!confirmable} data-save-confirm={sessionId}>
              {busy ? '保存中…' : '确认保存'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
