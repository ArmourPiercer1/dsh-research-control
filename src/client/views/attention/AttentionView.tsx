/**
 * Attention 视图 CONTAINER（WP-5.4）— 注意力视图唯一 store 接触文件
 * （两层纪律: 容器拉 store, 展示组件纯 props; 容器只在每视图一个文件）。
 *
 * DSH_ADAPTER §6 硬规则（client 侧, 同 WP-4.2 HomeDashboard）:
 *  - 组件不见 DSH ctx — store handle 经 prop 到达（cockpit 座位接线
 *    传同一个 `createResearchStore()` 结果 — 与 Home 共享主 store,
 *    不建第二订阅）;
 *  - 绑定只在本文件: 两个 `useSyncExternalStore`（主 store 快照 +
 *    attention 切片快照）, 绑定值以纯 props 下发给 `AttentionListView`。
 *
 * 数据路径（ARCHITECTURE §8 — 无自建 streaming; 派生切片不新增 RPC）:
 *  1. mount: 主 store `dashboard` 切片 lazy — idle 时容器发
 *     `store.loadDashboard()`（in-flight 去重由主 store 保证, StrictMode
 *     双跑只发一次 fetch）;
 *  2. attention 切片（`createAttentionRankingStore` — 本 WP 独立新文件
 *     `src/client/stores/attention-slices.ts`, 不改既有 store 文件）:
 *     容器每次 dashboard 切片节点变更时 `sync(dashboard)` — 切片节点
 *     引用稳定（WP-4.1b 引擎纪律）⇒ 只在真变更时到达; 切片状态机
 *     （idle/loading/ready/error + stale-while-revalidate）在切片内;
 *  3. 刷新按钮驱动 `store.refresh('manual')`（主 store 刷新循环:
 *     stale seam → refetch 非 idle 切片 → onRefetch 监听器）— dashboard
 *     refetch 落定后切片节点变更 ⇒ attention 切片自动重算。
 */
import { useEffect, useRef, useSyncExternalStore, type ReactElement } from 'react'

import type { ResearchStore } from '../../stores'
import { createAttentionRankingStore, type AttentionRankingStore } from '../../stores/attention-slices.js'

import { AttentionListView } from './AttentionListView'

export interface AttentionViewProps {
  /** The research store handle（主 store — 与 Home 同一实例, cockpit 座位
   *  接线传入; 工厂结果, 永不模块级句柄）。 */
  readonly store: ResearchStore
}

/**
 * 注意力排序清单入口（cockpit 座位目标组件）。
 * @param props - 主 store handle。
 * @returns 注意力清单元素。
 */
export function AttentionView({ store }: AttentionViewProps): ReactElement {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const dashboard = snapshot.dashboard

  // attention 切片 store — 组件实例内创建（useRef 守引用稳定; 工厂结果
  // 无模块级句柄, StrictMode 重挂载 = 新实例, 语义正确）。
  const sliceRef = useRef<AttentionRankingStore | null>(null)
  if (sliceRef.current === null) {
    sliceRef.current = createAttentionRankingStore()
  }
  const slice = sliceRef.current
  const sliceState = useSyncExternalStore(slice.subscribe, slice.getSnapshot)

  // Lazy load: dashboard 切片 idle ⇒ 首次请求（store 去重 in-flight）。
  // 拒绝被有意吞掉: 传输故障时 store 已在切片记错（markError 先于
  // re-throw — store 边界 fail-loud）, 渲染源是切片状态不是 promise
  // （同 WP-4.2 口径）。
  const swallowSliceRecordedFault = (_err: unknown): undefined => undefined

  useEffect(() => {
    if (dashboard.status === 'idle') void store.loadDashboard().catch(swallowSliceRecordedFault)
  }, [store, dashboard.status])

  // dashboard 切片 → attention 切片（节点引用稳定 ⇒ 只在真变更时到达）。
  useEffect(() => {
    slice.sync(dashboard)
  }, [slice, dashboard])

  return (
    <AttentionListView
      data={sliceState.data}
      status={sliceState.status}
      error={sliceState.error}
      onRefresh={() => {
        void store.refresh('manual').catch(swallowSliceRecordedFault)
      }}
    />
  )
}
