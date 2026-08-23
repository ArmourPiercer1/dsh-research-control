/**
 * WP-7.3 — analysis 切片的 store 绑定层（useSyncExternalStore 唯一落点）。
 *
 * 纪律（同 WP-4.3 useWorkstreamSlice / WP-5.2 use-actions-slices / WP-6.4
 * use-inbox-slice）:
 *  - `useSyncExternalStore` 只出现在本文件; 展示组件零 hook
 *    （transient-view 纯 props）; 容器只经本 hook 读切片
 *    （DSH_ADAPTER §11 不建第二订阅）;
 *  - 惰性首载: 挂载时发一次 `loadTransient(sessionId)`（sessionId =
 *    launcher 的会话指针 — `InvestigatorLaunchResult.sessionId`;
 *    store 内部 in-flight 去重 — StrictMode 双跑 effect 共享同一 fetch;
 *    ref 守卫保证每 store 实例只触发一次首载, 后续刷新归保存成功自动
 *    刷新 / 宿主刷新环）;
 *  - store 实例经 props 注入（工厂结果 — 绝不模块级句柄, DSH_ADAPTER §6）。
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'

import { type AnalysisSliceState, type AnalysisSliceStore } from '../../stores/analysis-slice.js'

export function useAnalysisSlice(store: AnalysisSliceStore, sessionId: string): AnalysisSliceState {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const primed = useRef(false)

  useEffect(() => {
    if (primed.current) return
    primed.current = true
    // 首载两切片: transient（按 sessionId）+ records（已保存列表）。
    void store.loadTransient(sessionId)
    void store.loadAnalysisRecords()
  }, [store, sessionId])

  return state
}
