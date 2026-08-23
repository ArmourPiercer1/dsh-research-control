/**
 * WP-5.5 — Living Brief 视图 CONTAINER（包内唯一 store 接触文件）。
 *
 * DSH_ADAPTER §6 硬规则（client 侧, 同 WP-4.2 HomeDashboard / WP-5.4
 * AttentionView）:
 *  - 组件不见 DSH ctx — store handle 经 prop 到达（cockpit 座位接线
 *    传同一个 `createResearchStore()` 结果 — 与 Home 共享主 store,
 *    不建第二订阅）;
 *  - 绑定只在本文件: 三个 `useSyncExternalStore`（主 store 快照 +
 *    brief 切片快照）, 绑定值以纯 props 下发给 `BriefPanelView`。
 *
 * 数据路径（ARCHITECTURE §8 — 无自建 streaming; 派生切片不新增 RPC）:
 *  1. mount: 主 store `dashboard` 切片 lazy — idle 时容器发
 *     `store.loadDashboard()`（in-flight 去重由主 store 保证, StrictMode
 *     双跑只发一次 fetch）; `project` 切片同法 lazy（`loadProject` —
 *     Objectives 来源; 未 ready 不阻塞 Brief — 空集占位, 加载后自动
 *     收敛）;
 *  2. brief 切片（`createBriefSliceStore` — 本 WP 独立新文件
 *     `src/client/stores/brief-slice.ts`, 不改既有 store 文件）:
 *     容器每次 dashboard/project 切片节点变更时 `sync({dashboard,
 *     project})` — 节点引用稳定（WP-4.1b 引擎纪律）⇒ 只在真变更时到达;
 *     切片状态机（idle/loading/ready/error + stale-while-revalidate）
 *     在切片内;
 *  3. 刷新按钮驱动 `store.refresh('manual')`（主 store 刷新循环）—
 *     dashboard/project refetch 落定后节点变更 ⇒ 切片自动重算。
 *
 * ref 跳转渠道（WP-4.6 drilldown 模式）: 展示层 `BriefPanelView` 只交
 *  ref, 渠道在本容器 — `onOpenRef` prop 可选注入真实导航（cockpit 座位
 *  接线后接管）; 当前自包含默认渠道 = 本地 banner 记录跳转目标
 *  （占位语义显式可见 — 「在宿主/WS 页打开」渠道待接线, 不静默）。
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'

import type { ResearchStore } from '../../stores'
import { createBriefSliceStore, type BriefSliceStore } from '../../stores/brief-slice.js'
import type { BriefRef } from '../../../host/service/brief/types.js'

import { BriefPanelView, refLabel } from './brief-panel'

export interface BriefViewProps {
  /** The research store handle（主 store — 与 Home 同一实例, cockpit 座位
   *  接线传入; 工厂结果, 永不模块级句柄）。 */
  readonly store: ResearchStore
  /** 可选注入的 ref 跳转渠道（cockpit 座位接线后接管 — 真导航;
   *  缺省 = 本地占位渠道, 跳转目标显式记录在 banner）。 */
  readonly onOpenRef?: (ref: BriefRef) => void
}

/**
 * Living Brief 面板入口（cockpit 座位目标组件）。
 * @param props - 主 store handle + 可选 ref 跳转渠道。
 * @returns Brief 面板元素。
 */
export function BriefView({ store, onOpenRef }: BriefViewProps): ReactElement {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const dashboard = snapshot.dashboard
  const project = snapshot.project

  // brief 切片 store — 组件实例内创建（useRef 守引用稳定; 工厂结果
  // 无模块级句柄, StrictMode 重挂载 = 新实例, 语义正确）。
  const sliceRef = useRef<BriefSliceStore | null>(null)
  if (sliceRef.current === null) {
    sliceRef.current = createBriefSliceStore()
  }
  const slice = sliceRef.current
  const sliceState = useSyncExternalStore(slice.subscribe, slice.getSnapshot)

  // 占位跳转渠道 banner（容器本地 UI 状态 — 展示层纯 props）。
  // ref 选中态在面板内自持（「每条可点开 ref 详情」= 自包含交互）;
  // 容器只持有跳转渠道（onOpenRef）与其占位 banner。
  const [jumpBanner, setJumpBanner] = useState<string | null>(null)

  // Lazy load: dashboard/project 切片 idle ⇒ 首次请求（store 去重 in-flight）。
  // 拒绝被有意吞掉: 传输故障时 store 已在切片记错（markError 先于
  // re-throw — store 边界 fail-loud）, 渲染源是切片状态不是 promise
  // （同 WP-4.2 口径）。
  const swallowSliceRecordedFault = (_err: unknown): undefined => undefined

  useEffect(() => {
    if (dashboard.status === 'idle') void store.loadDashboard().catch(swallowSliceRecordedFault)
  }, [store, dashboard.status])

  useEffect(() => {
    if (project.status === 'idle') void store.loadProject().catch(swallowSliceRecordedFault)
  }, [store, project.status])

  // dashboard + project 切片 → brief 切片（节点引用稳定 ⇒ 只在真变更时到达）。
  useEffect(() => {
    slice.sync({ dashboard, project })
  }, [slice, dashboard, project])

  // 数据面说明（client 投影的诚实边界 — 视图层上下文, 不进引擎数据）:
  //  - 恒注: client 无 wire 路径的面在空集下显示「暂无数据」;
  //  - project 切片 error: objectives 可能不完整的显式提示（不静默）。
  const dataPlaneNotes: string[] = [
    '本视图为 client 侧投影：最近 History（项目级摘要 — 既有 wire 仅 per-Workstream 查询）/NextAction/Blocker/ScheduledEvent/ReportingItem/Interaction/Future Plan 数据面无项目级 client wire 路径，空集显示为「暂无数据」（host buildBrief 持有完整数据底座）；audit/inbox 待 Phase 6 开通。',
  ]
  if (project.status === 'error') {
    dataPlaneNotes.push(`项目快照加载失败（Objectives 可能不完整）：${project.error ?? '未知错误'}`)
  }

  // ref 跳转渠道（WP-4.6 模式: 展示层交 ref, 容器持渠道）:
  //  - 注入渠道存在 ⇒ 调用（cockpit 真实导航）;
  //  - 恒置 banner（占位渠道显式可见 — 渠道未接线时用户可见目标坐标）。
  const handleOpenRef = (ref: BriefRef): void => {
    setJumpBanner(`跳转目标：${refLabel(ref)}${onOpenRef === undefined ? '（渠道占位 — cockpit 座位接线后接管真实导航）' : ''}`)
    onOpenRef?.(ref)
  }

  return (
    <div>
      <BriefPanelView
        brief={sliceState.data}
        status={sliceState.status}
        error={sliceState.error}
        onRefresh={() => {
          void store.refresh('manual').catch(swallowSliceRecordedFault)
        }}
        onRetry={() => {
          void store.loadDashboard().catch(swallowSliceRecordedFault)
        }}
        dataPlaneNote={dataPlaneNotes.join(' ')}
        onOpenRef={handleOpenRef}
      />
      {jumpBanner !== null && (
        <p className="rc-brief-jump-banner" role="status" data-jump-banner>
          {jumpBanner}
        </p>
      )}
    </div>
  )
}
