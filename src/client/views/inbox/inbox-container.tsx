/**
 * WP-6.4 — Research Inbox 容器（React 面的唯一 hook 落点）。
 *
 * 容器/展示分层（任务书纪律）:
 *  - 本容器经 use-inbox-slice 绑定 inbox 切片（useSyncExternalStore
 *    唯一落点 — 展示组件零 hook）;
 *  - 数据经 inbox-model 纯投影后以 plain props 传展示组件;
 *  - 用户操作面（转换/忽略 — 仅用户, §6 矩阵; 快捷捕获归宿主快捷捕获
 *    入口, 本视图不含捕获框）: 操作走切片 store 的 provider 透传
 *    （成功后 store 自动刷新 items 切片 — 宿主是数据真值）; 未接线
 *    （NOT_WIRED fail-loud）时操作按钮禁用 + 错误行大声点名缺口
 *    （绝不伪造本地状态 — 同 WP-5.2 纪律）;
 *  - 操作 transient 反馈（busy / 错误行）= 容器本地 UI 状态（非数据
 *    镜像 — 数据真值永远来自宿主刷新）。
 *
 * 宿主 slot 装配形态（后续集成）: `store` prop 传
 * `createInboxSliceStore({ dataProvider: <接线> })` 的工厂结果 —
 * 组件不见 ctx（DSH_ADAPTER §6）。
 */

import { useState, type JSX } from 'react'

import type { InboxConversionKind, InboxSliceStore } from '../../stores/inbox-slice.js'
import { selectInboxRows } from './inbox-model.js'
import { InboxConversionDialog, InboxItemDetail, InboxListView } from './inbox-view.js'
import styles from './inbox.module.css'
import { useInboxSlice } from './use-inbox-slice.js'

export interface InboxViewContainerProps {
  /** Inbox 切片 store（工厂结果 — 注入, 非模块句柄）。 */
  readonly store: InboxSliceStore
}

export function InboxViewContainer(props: InboxViewContainerProps): JSX.Element {
  const state = useInboxSlice(props.store)
  const items = state.items.data?.items ?? []
  const rows = selectInboxRows(items)

  // 视图内导航（纯 UI 状态 — 非数据）: 选中条目 + 对话框。
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialogKind, setDialogKind] = useState<InboxConversionKind | null>(null)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [opError, setOpError] = useState<string | null>(null)

  const selected = selectedId !== null ? (rows.find((r) => r.item.id === selectedId)?.item ?? null) : null
  const dialogItem = dialogKind !== null ? (rows.find((r) => r.item.id === selectedId)?.item ?? null) : null

  const openDialog = (kind: InboxConversionKind): void => {
    setFieldValues({})
    setOpError(null)
    setDialogKind(kind)
  }

  const cancelDialog = (): void => {
    setDialogKind(null)
    setOpError(null)
  }

  const runConvert = async (fields: Record<string, unknown>): Promise<void> => {
    if (selectedId === null || dialogKind === null) return
    setBusy(true)
    setOpError(null)
    try {
      await props.store.convertInboxItem({ inboxItemId: selectedId, targetKind: dialogKind, fields })
      // 成功: 条目转 CONVERTED（终态）— 对话框关闭, 焦点回清单。
      setDialogKind(null)
      setFieldValues({})
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const runDismiss = async (id: string): Promise<void> => {
    setBusy(true)
    setOpError(null)
    try {
      await props.store.dismissInboxItem(id)
      setSelectedId(null)
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page} data-inbox-page>
      {selected !== null ? (
        <>
          <InboxItemDetail
            item={selected}
            onConvert={openDialog}
            onDismiss={busy ? undefined : (id) => void runDismiss(id)}
            onBack={() => setSelectedId(null)}
          />
          {opError !== null && dialogKind === null ? (
            <p className={styles.sliceError} role="alert">
              操作失败：{opError}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <InboxListView slice={state.items} rows={rows} selectedId={selectedId} onOpenItem={setSelectedId} />
          {opError !== null ? (
            <p className={styles.sliceError} role="alert">
              操作失败：{opError}
            </p>
          ) : null}
        </>
      )}
      {dialogItem !== null && dialogKind !== null ? (
        <InboxConversionDialog
          item={dialogItem}
          kind={dialogKind}
          fieldValues={fieldValues}
          busy={busy}
          error={opError}
          onFieldChange={(name, value) => setFieldValues((prev) => ({ ...prev, [name]: value }))}
          onConfirm={(fields) => void runConvert(fields)}
          onCancel={cancelDialog}
        />
      ) : null}
    </div>
  )
}
