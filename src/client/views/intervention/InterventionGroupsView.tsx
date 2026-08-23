/**
 * WP-5.1 — Intervention 分组视图（**容器层**: 唯一的 store 绑定面在此
 * — 经 binding-hooks 的 useInterventionGroups 拿切片 + 分组投影, 纯
 * 数据向下传给 InterventionGroupsList; 操作面（状态迁移按钮）的回调
 * 在此持有本地 UI 态（备注 / busy / fault）并调用 store 的
 * `updateInterventionState` mutation）。
 *
 * 操作语义（与 WP-4.6 InterventionBoard 同款纪律 — 状态机 §13 / INV-PERM-4）:
 *  - 仅用户可改状态（本视图即用户面 — Agent 侧无对应工具, 冻结 11 工具
 *    面无状态迁移工具）;
 *  - 迁移按钮 = 冻结 §13 迁移表（OPEN → 待处理/关闭; PENDING → 重新打开/
 *    关闭; CLOSED 无按钮）;
 *  - 关闭必填备注（「关闭时用户填写」, §9.2）— 缺备注 = fault + 零调用;
 *  - mutation 后**不本地打补丁**: 失效规则（WP-4.1b 注册表:
 *    updateInterventionState → dashboard）触发切片 refetch, 重渲染来自
 *    host 重读（host 是唯一真源 — stale-while-revalidate）;
 *  - INV-ATTN-1: OPEN/PENDING 两组全量渲染（数据完整 = host 侧
 *    InterventionService 查询面无隐藏过滤器 + 本视图零过滤）。
 *
 * 组件不见 ctx（DSH_ADAPTER §6）: `store` 由挂载层（cockpit 每 tab 一个
 * 工厂结果）以 prop 传入 — 同 InterventionBoard / cockpit 先例。
 */

import { useState, type ReactElement } from 'react'

import type { InterventionDto } from '../../../shared/rpc-contracts.js'
import { useInterventionGroups } from './binding-hooks.js'
import type { ResearchStore } from '../../stores/index.js'
import { InterventionGroupsList } from './InterventionGroupsList.js'
import styles from './intervention.module.css'

export interface InterventionGroupsViewProps {
  readonly store: ResearchStore
  /** 钻取: 打开所属 Workstream（可选 — 独立挂载时可不接导航）。 */
  readonly onOpenWorkstream?: (workstreamId: string) => void
}

/**
 * Intervention 分组视图（容器）。
 * @param props - store 句柄（挂载层每 tab 一个工厂结果）+ 可选 WS 导航。
 * @returns 分组视图元素。
 */
export function InterventionGroupsView({ store, onOpenWorkstream }: InterventionGroupsViewProps): ReactElement {
  const { slice, grouping } = useInterventionGroups(store)
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(new Map())
  const [busy, setBusy] = useState(false)
  const [fault, setFault] = useState<string | null>(null)

  function handleTransition(item: InterventionDto, status: 'OPEN' | 'PENDING' | 'CLOSED'): void {
    if (busy) return
    if (status === 'CLOSED' && (notes.get(item.id) ?? '').trim() === '') {
      setFault(`${item.id}：关闭需要填写备注（「关闭时用户填写」）`)
      return
    }
    setFault(null)
    setBusy(true)
    void store
      .updateInterventionState({
        interventionId: item.id,
        status,
        ...(status === 'CLOSED' ? { resolutionNote: notes.get(item.id)!.trim() } : {}),
      })
      .then(
        () => {
          setBusy(false)
        },
        (err: unknown) => {
          setBusy(false)
          setFault(err instanceof Error ? err.message : String(err))
        },
      )
  }

  const loading = slice.status === 'idle' || (slice.status === 'loading' && slice.data === null)

  return (
    <section className={styles.view} aria-label="Intervention 分组视图（来源 × 状态, 仅用户可改状态）">
      <h2 className={styles.viewTitle}>Intervention 分组（机械触发 / 用户创建 × 状态）</h2>
      {slice.status === 'error' && slice.error !== null && (
        <p className={styles.errorBanner} role="alert">
          切片加载失败（展示最后成功数据）：{slice.error}
        </p>
      )}
      {fault !== null && (
        <p className={styles.faultNote} role="alert">
          {fault}
        </p>
      )}
      {loading ? (
        <p className={styles.empty}>加载中…</p>
      ) : grouping.total === 0 ? (
        <p className={styles.empty}>当前无 OPEN / PENDING Intervention</p>
      ) : (
        <InterventionGroupsList
          groups={grouping.groups}
          total={grouping.total}
          notes={notes}
          busy={busy}
          onTransition={handleTransition}
          onNote={(id, value) => setNotes((prev) => new Map(prev).set(id, value))}
          onOpenWorkstream={onOpenWorkstream}
        />
      )}
    </section>
  )
}
