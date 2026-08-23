/**
 * WP-6.4 — Inbox 切片的 store 绑定层（useSyncExternalStore 唯一落点）。
 *
 * 纪律（同 WP-4.3 useWorkstreamSlice / WP-5.2 use-actions-slices）:
 *  - `useSyncExternalStore` 只出现在本文件; 展示组件零 hook（inbox-view
 *    纯 props）; 容器只经本 hook 读切片（DSH_ADAPTER §11 不建第二订阅）;
 *  - 惰性首载: 挂载时发一次 loadInboxItems（store 内部 in-flight 去重 —
 *    StrictMode 双跑 effect 共享同一 fetch; ref 守卫保证每 store 实例只
 *    触发一次首载, 后续刷新归操作成功自动刷新 / 宿主刷新环）;
 *  - store 实例经 props 注入（工厂结果 — 绝不模块级句柄, DSH_ADAPTER §6）。
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'

import { type InboxSliceState, type InboxSliceStore } from '../../stores/inbox-slice.js'

export function useInboxSlice(store: InboxSliceStore): InboxSliceState {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const primed = useRef(false)

  useEffect(() => {
    if (primed.current) return
    primed.current = true
    void store.loadInboxItems()
  }, [store])

  return state
}
