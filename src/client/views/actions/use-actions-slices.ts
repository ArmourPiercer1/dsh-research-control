/**
 * WP-5.2 — 注意力三对象切片的 store 绑定层（useSyncExternalStore 唯一落点）。
 *
 * 纪律（同 WP-4.3 useWorkstreamSlice / WP-4.6 binding-hooks）:
 *  - `useSyncExternalStore` 只出现在本文件; 展示组件零 hook（actions-view
 *    纯 props）; 容器只经本 hook 读切片（DSH_ADAPTER §11 不建第二订阅）;
 *  - 惰性首载: 挂载时对三个切片各发一次 load（store 内部 in-flight 去重 —
 *    StrictMode 双跑 effect 共享同一 fetch; ref 守卫保证每 store 实例只
 *    触发一次首载, refetch 归页面刷新环的 `refresh()`）;
 *  - store 实例经 props 注入（工厂结果 — 绝不模块级句柄, DSH_ADAPTER §6）。
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'

import {
  type ActionsSlicesState,
  type ActionsSlicesStore,
} from '../../stores/actions-slices.js'

export function useActionsSlices(store: ActionsSlicesStore): ActionsSlicesState {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const primed = useRef(false)

  useEffect(() => {
    if (primed.current) return
    primed.current = true
    void store.loadNextActions()
    void store.loadBlockers()
    void store.loadObjectiveProgress()
  }, [store])

  return state
}
