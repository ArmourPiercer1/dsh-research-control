/**
 * WP-5.2 — 注意力三对象容器（NextAction 清单 / Blocker 显著区 /
 * Objective 进度概览 — 任务书目标 3/4 的装配点）。
 *
 * 容器/展示分层（任务书纪律）:
 *  - 本容器是 React 面的唯一 hook 落点（经 use-actions-slices 绑定切片）;
 *  - 数据经 actions-model 纯投影后以 plain props 传给展示组件
 *    （actions-view — 零 hook、零 store 知识）;
 *  - 用户操作面（PROMOTE/DISMISS/CLEAR — 全部仅用户, §6 矩阵）: 容器把
 *    回调 props 原样传给展示组件; 宿主接线（后续集成 — 冻结 13 RPC 无
 *    注意力变更面, 报告「实现要点」§3/§4）提供回调; 未提供时展示组件
 *    渲染禁用按钮 + 「宿主操作通道未接线」提示（绝不伪造本地状态 —
 *    宿主是数据真值, 同 WP-4.6 InterventionBoard 纪律）;
 *  - 操作成功后的数据刷新走页面刷新环（容器可被宿主挂 `refresh()` —
 *    本 WP 交付 `onRefetchRequested` 透传缝, 同 WP-4.6 页面级刷新口径）。
 *
 * 宿主 slot 装配形态（后续集成）: `store` option 传
 * `createActionsSlicesStore({ rpc: researchRpc, dataProvider: <接线> })`
 * 的工厂结果 — 组件不见 ctx（DSH_ADAPTER §6）。
 */

import type { JSX } from 'react'

import type { ActionsSlicesStore } from '../../stores/actions-slices.js'
import {
  countObjectives,
  groupNextActionsByObjective,
  objectiveProgressRows,
  splitBlockers,
} from './actions-model.js'
import { BlockerSection, NextActionsSection, ObjectiveProgress } from './actions-view.js'
import styles from './actions.module.css'
import { useActionsSlices } from './use-actions-slices.js'

export interface ActionsViewContainerProps {
  /** 注意力切片 store（工厂结果 — 注入, 非模块句柄）。 */
  readonly store: ActionsSlicesStore
  /** PROMOTE 用户操作缝（仅用户 — §6 矩阵; 未接线时按钮禁用）。 */
  readonly onPromote?: (id: string) => void
  /** DISMISS 用户操作缝（仅用户）。 */
  readonly onDismiss?: (id: string) => void
  /** CLEAR Blocker 用户操作缝（仅用户）。 */
  readonly onClearBlocker?: (id: string) => void
  /** 刷新请求透传（宿主把页面级刷新环挂到 store.refresh() 的钩子面）。 */
  readonly onRefetchRequested?: () => void
}

export function ActionsViewContainer(props: ActionsViewContainerProps): JSX.Element {
  const state = useActionsSlices(props.store)
  const progress = state.objectiveProgress.data
  const groups = groupNextActionsByObjective(state.nextActions.data?.items ?? [], progress)

  return (
    <div className={styles.page} data-actions-page>
      <header className={styles.header}>
        <h1 className={styles.title}>下一步行动 · 阻碍 · 目标</h1>
        <button type="button" className={styles.refresh} onClick={() => props.onRefetchRequested?.()}>
          刷新
        </button>
      </header>
      <BlockerSection
        slice={state.blockers}
        sections={splitBlockers(state.blockers.data?.items ?? [])}
        onClear={props.onClearBlocker}
      />
      <ObjectiveProgress
        slice={state.objectiveProgress}
        rows={objectiveProgressRows(progress?.objectives ?? [], groups)}
        counts={countObjectives(progress?.objectives ?? [])}
      />
      <NextActionsSection
        slice={state.nextActions}
        groups={groups}
        onPromote={props.onPromote}
        onDismiss={props.onDismiss}
      />
    </div>
  )
}
