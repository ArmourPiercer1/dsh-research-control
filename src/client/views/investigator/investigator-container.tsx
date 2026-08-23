/**
 * WP-7.3 — transient investigator 容器（React 面的唯一 hook 落点）。
 *
 * 容器/展示分层（任务书「容器/展示 + 保存对话框」）:
 *  - 本容器经 use-analysis-slice 绑定 analysis 切片（useSyncExternalStore
 *    唯一落点 — 展示组件零 hook）;
 *  - 数据经 investigator-model 纯投影后以 plain props 传展示组件;
 *  - **保存流（任务书目标 3: transient 面板 → 「保存为 AnalysisRecord」
 *    按钮 → 确认对话框 → 保存流）**: 操作走切片 store 的 provider 透传
 *    （宿主侧 `AnalysisRecordService.saveAsAnalysisRecord` 的
 *    `UserActorRef` 门 — 仅用户显式保存才落盘, INV-PERM-3）; 成功后
 *    store 自动刷新 records 切片（宿主是数据真值）+ 容器展示成功 chip;
 *    未接线（NOT_WIRED fail-loud）时操作按钮禁用 + 错误行大声点名缺口
 *    （绝不伪造本地状态 — 同 WP-6.4 纪律）;
 *  - 操作 transient 反馈（busy / 错误行 / 成功 chip）= 容器本地 UI 状态
 *    （非数据镜像 — 数据真值永远来自宿主刷新）。
 *
 * 宿主 slot 装配形态（后续接线 WP）: `store` prop 传
 * `createAnalysisSliceStore({ dataProvider: <接线> })` 的工厂结果;
 * `sessionId` prop = launcher 的会话指针（`InvestigatorLaunchResult.sessionId`）;
 * `sourceRef` prop = 启动上下文中的来源对象引用（如 Intervention —
 * 保存对话框的 sourceRef 预填, 用户可改）。组件不见 ctx（DSH_ADAPTER §6）。
 */

import { useState, type JSX } from 'react'

import type { AnalysisRecordDto, AnalysisSliceStore, SaveAnalysisRecordArgs } from '../../stores/analysis-slice.js'
import {
  initialSaveFieldValues,
  selectSavedRecordRows,
  selectTransientRows,
  type SaveDialogFieldValues,
} from './investigator-model.js'
import { InvestigatorTransientPanel, SaveAnalysisRecordDialog } from './transient-view.js'
import styles from './investigator.module.css'
import { useAnalysisSlice } from './use-analysis-slice.js'

export interface InvestigatorViewContainerProps {
  /** analysis 切片 store（工厂结果 — 注入, 非模块句柄）。 */
  readonly store: AnalysisSliceStore
  /** launcher 的会话指针（`InvestigatorLaunchResult.sessionId` —
   *  transient 数据面的入口）。 */
  readonly sessionId: string
  /** 启动上下文中的来源对象引用（如 Intervention — 保存对话框 sourceRef
   *  预填; 缺省 = 对话框 INTERVENTION 空 id, 用户必填）。 */
  readonly sourceRef?: { readonly kind: string; readonly id: string }
}

export function InvestigatorViewContainer(props: InvestigatorViewContainerProps): JSX.Element {
  const state = useAnalysisSlice(props.store, props.sessionId)
  const rows = selectTransientRows(state.transient.data)
  const savedRows = selectSavedRecordRows(state.records.data?.records ?? [])

  // 视图内导航（纯 UI 状态 — 非数据）: 保存对话框 + 操作反馈。
  const [dialogOpen, setDialogOpen] = useState(false)
  const [fieldValues, setFieldValues] = useState<SaveDialogFieldValues>(() =>
    initialSaveFieldValues({ sessionId: props.sessionId, sourceRef: props.sourceRef, run: rows.run }),
  )
  const [busy, setBusy] = useState(false)
  const [opError, setOpError] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<AnalysisRecordDto | null>(null)

  const openDialog = (): void => {
    // 开对话框时按当前 transient 快照重新预填（run 行可能刚加载完）。
    setFieldValues(initialSaveFieldValues({ sessionId: props.sessionId, sourceRef: props.sourceRef, run: rows.run }))
    setOpError(null)
    setDialogOpen(true)
  }

  const cancelDialog = (): void => {
    setDialogOpen(false)
    setOpError(null)
  }

  const runSave = async (args: SaveAnalysisRecordArgs): Promise<void> => {
    setBusy(true)
    setOpError(null)
    try {
      const saved = await props.store.saveAnalysisRecord(args)
      // 成功: 对话框关闭 + 成功 chip; records 切片已由 store 刷新（宿主是
      // 数据真值 — chip 只作即时反馈, 列表才是持久面）。
      setLastSaved(saved)
      setDialogOpen(false)
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page} data-investigator-page={props.sessionId}>
      <InvestigatorTransientPanel
        slice={state.transient}
        rows={rows}
        savedRows={savedRows}
        savedSlice={state.records}
        sessionId={props.sessionId}
        onSave={props.store.providerWired ? openDialog : undefined}
      />
      {lastSaved !== null ? (
        <p className={styles.savedChip} role="status" data-saved-chip={lastSaved.id}>
          已保存 <span className={styles.itemId}>{lastSaved.id}</span>（保存后不可变 — 修正 = 新记录）
        </p>
      ) : null}
      {dialogOpen ? (
        <SaveAnalysisRecordDialog
          sessionId={props.sessionId}
          fieldValues={fieldValues}
          busy={busy}
          error={opError}
          onFieldChange={(name, value) => setFieldValues((prev) => ({ ...prev, [name]: value }))}
          onConfirm={(args: SaveAnalysisRecordArgs) => void runSave(args)}
          onCancel={cancelDialog}
        />
      ) : null}
    </div>
  )
}
