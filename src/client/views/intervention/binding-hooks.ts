/**
 * WP-5.1 — intervention 视图包的**唯一 store 绑定层**（WP-4.3/4.6 先例:
 * 每个视图包一个 binding-hooks 文件; `useSyncExternalStore` 只出现在这里,
 * 容器/展示组件拿到的全是纯数据 — 组件不见 ctx / 不见 store 以外的任何东西）。
 *
 * 不建第二订阅（DSH_ADAPTER §11）: 绑定的是调用方（cockpit / 挂载层）
 * 创建的同一个 `ResearchStore` 工厂结果 — 与 dashboard 切片共享同一
 * 订阅源; 本包只加**投影**（intervention-slices.ts 的纯 derive 面,
 * WP-4.1b 模式: 切片投影是纯函数, 无新远端请求、无新失效规则 —
 * 数据流完全复用既有 dashboard 切片的 lazy load + mutation 后
 * refetch（updateInterventionState 的失效规则在 WP-4.1b 注册表已冻结:
 * updateInterventionState → dashboard））。
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react'

import type { DashboardSnapshot } from '../../../shared/rpc-contracts.js'
import {
  deriveInterventionGroups,
  type InterventionGrouping,
} from '../../stores/intervention-slices.js'
import type { ResearchStore, SliceState } from '../../stores/index.js'

export interface InterventionGroupsBinding {
  /** dashboard 切片原样（视图据此渲染加载/错误态 — 不另造状态面）。 */
  readonly slice: SliceState<DashboardSnapshot>
  /** 来源分组投影（纯 derive — 切片引用不变则投影引用不变）。 */
  readonly grouping: InterventionGrouping
}

/**
 * 绑定 dashboard 切片并投影出来源分组（lazy 首载 on mount — 与
 * drilldown 的 useDashboardSlice 同语义; 本包自有绑定层, 不跨包 import）。
 */
export function useInterventionGroups(store: ResearchStore): InterventionGroupsBinding {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => {
    void store.loadDashboard().catch(() => {
      /* transport faults surface in the slice (stale-while-revalidate) */
    })
  }, [store])
  const slice = state.dashboard
  const grouping = useMemo(() => deriveInterventionGroups(slice), [slice])
  return { slice, grouping }
}
