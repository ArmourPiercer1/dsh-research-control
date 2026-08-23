/**
 * WP-4.3 — reorder entry tests: the GUI entry (up/down buttons) resolves
 * into the frozen `reorderPlan` mutation.
 *
 * Chain under test (every link pinned here):
 *  1. `movePlanItemIds` / `buildReorderArgs` (pure) — one button press =
 *     one adjacent swap = always a permutation (rpc-contracts §6: the
 *     kernel rejects non-permutations; this entry cannot produce one);
 *  2. `store.reorderPlan(args)` — the mutation face: on OK it invalidates
 *     `workstreams:<ws>` and refetches (the WP-4.1b registry rule), so
 *     the REFETCHED order is what re-renders (asserted: the container
 *     shows the new plan position after the mutation);
 *  3. business fault (`ok:false`) — rejects with `ResearchRpcError`
 *     (the container surfaces `err.message` as the zone fault note — the
 *     note rendering is pinned in zones.test.tsx) and causes ZERO
 *     invalidation (no refetch).
 *
 * The literal DOM click (button → handler) is E2E territory (WP-4.6);
 * the callback contract at the button (onMoveItem(itemId, direction)) is
 * pinned in zones.test.tsx via the element-tree harness.
 */

import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlanItemDto } from '../../src/shared/rpc-contracts.js'
import { buildReorderArgs, movePlanItemIds } from '../../src/client/views/workstream/index.js'
import { WorkstreamView } from '../../src/client/views/workstream/index.js'
import { createResearchStore, ResearchRpcError } from '../../src/client/stores/index.js'
import { makeStubRpc } from '../stores/stub-rpc.js'
import { makeSnapshot } from './view-fixtures.js'
import { ssrText } from './harness.js'

const ITEMS: readonly PlanItemDto[] = [
  { id: 'G-1', kind: 'GATE', title: '门一' },
  { id: 'T-1', kind: 'TASK', title: '任务一' },
  { id: 'M-1', kind: 'MILESTONE', title: '里程碑一' },
]

function isPermutation(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const count = new Map<string, number>()
  for (const x of a) count.set(x, (count.get(x) ?? 0) + 1)
  for (const y of b) {
    const n = count.get(y) ?? 0
    if (n === 0) return false
    count.set(y, n - 1)
  }
  return true
}

describe('movePlanItemIds / buildReorderArgs（纯函数）', () => {
  it('相邻交换：上移/下移各一位', () => {
    expect(movePlanItemIds(ITEMS, 'T-1', 'up')).toEqual(['T-1', 'G-1', 'M-1'])
    expect(movePlanItemIds(ITEMS, 'T-1', 'down')).toEqual(['G-1', 'M-1', 'T-1'])
    expect(movePlanItemIds(ITEMS, 'G-1', 'down')).toEqual(['T-1', 'G-1', 'M-1'])
    expect(movePlanItemIds(ITEMS, 'M-1', 'up')).toEqual(['G-1', 'M-1', 'T-1'])
  })

  it('边界与未知 id 返回 null（按钮在边界禁用，不产生 mutation）', () => {
    expect(movePlanItemIds(ITEMS, 'G-1', 'up')).toBeNull()
    expect(movePlanItemIds(ITEMS, 'M-1', 'down')).toBeNull()
    expect(movePlanItemIds(ITEMS, 'T-9', 'up')).toBeNull()
    expect(movePlanItemIds(ITEMS, 'T-9', 'down')).toBeNull()
    const single = ITEMS.slice(0, 1)
    expect(movePlanItemIds(single, 'G-1', 'up')).toBeNull()
    expect(movePlanItemIds(single, 'G-1', 'down')).toBeNull()
  })

  it('两元素边界交换', () => {
    const two = ITEMS.slice(0, 2)
    expect(movePlanItemIds(two, 'G-1', 'down')).toEqual(['T-1', 'G-1'])
    expect(movePlanItemIds(two, 'T-1', 'up')).toEqual(['T-1', 'G-1'])
  })

  it('结果恒为原顺序的置换（reorder 契约：只重排不增删）', () => {
    for (const item of ITEMS) {
      for (const direction of ['up', 'down'] as const) {
        const next = movePlanItemIds(ITEMS, item.id, direction)
        if (next !== null) expect(isPermutation(next, ITEMS.map(i => i.id))).toBe(true)
      }
    }
  })

  it('buildReorderArgs：冻结 ReorderPlanArgs 形状 / null 透传', () => {
    const args = buildReorderArgs('WS-1', ITEMS, 'T-1', 'up')
    expect(args).toEqual({ workstreamId: 'WS-1', orderedItemIds: ['T-1', 'G-1', 'M-1'] })
    expect(buildReorderArgs('WS-1', ITEMS, 'G-1', 'up')).toBeNull()
    expect(buildReorderArgs('WS-1', ITEMS, 'T-9', 'down')).toBeNull()
  })
})

describe('reorder 回调触发 mutation（容器 handleMove 内核：buildReorderArgs + store.reorderPlan）', () => {
  it('OK：reorderPlan 收到正确 args；失效 refetch 后新顺序逐位渲染', async () => {
    const stub = makeStubRpc()
    const before = makeSnapshot({ planItems: ITEMS })
    const after = makeSnapshot({ planItems: [ITEMS[1]!, ITEMS[0]!, ITEMS[2]!] })
    stub.set('getWorkstream', { ok: true, value: before })
    const store = createResearchStore({ rpc: stub.rpc })
    await store.loadWorkstream('WS-1')
    expect(stub.countOf('getWorkstream')).toBe(1)

    // the host confirms the swap; the refetch then serves the new order
    stub.set('getWorkstream', { ok: true, value: after })
    const args = buildReorderArgs('WS-1', before.future.plan.orderedItems, 'T-1', 'up')
    expect(args).not.toBeNull()
    await store.reorderPlan(args!)

    // ① the mutation face received the exact permutation args
    const calls = stub.callsTo('reorderPlan')
    expect(calls.length).toBe(1)
    expect(calls[0]!.args).toEqual({ workstreamId: 'WS-1', orderedItemIds: ['T-1', 'G-1', 'M-1'] })
    // ② the registry rule fired: exactly one invalidation refetch
    expect(stub.countOf('getWorkstream')).toBe(2)

    // ③ the container re-renders the NEW plan position (T-1 now first)
    const html = ssrText(renderToString(<WorkstreamView store={store} workstreamId="WS-1" />))
    const t1 = html.indexOf('任务一')
    const g1 = html.indexOf('门一')
    const m1 = html.indexOf('里程碑一')
    expect(t1).not.toBe(-1)
    expect(t1).toBeLessThan(g1)
    expect(g1).toBeLessThan(m1)
  })

  it('业务故障：ResearchRpcError 拒绝 + 零失效（不 refetch）', async () => {
    const stub = makeStubRpc()
    stub.set('getWorkstream', { ok: true, value: makeSnapshot({ planItems: ITEMS }) })
    stub.set('reorderPlan', {
      ok: false,
      error: { code: 'PLAN_REORDER_CONFLICT', message: '计划已被其他操作修改', details: {} },
    })
    const store = createResearchStore({ rpc: stub.rpc })
    await store.loadWorkstream('WS-1')

    const args = buildReorderArgs('WS-1', ITEMS, 'T-1', 'down')!
    const failure = await store.reorderPlan(args).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(ResearchRpcError)
    const error = failure as ResearchRpcError
    expect(error.code).toBe('PLAN_REORDER_CONFLICT')
    // the message the container surfaces as「排序失败：…」
    expect(error.message).toBe('计划已被其他操作修改')
    // zero invalidation on failure: no refetch happened
    expect(stub.countOf('getWorkstream')).toBe(1)
    // the slice still carries the OLD order (stale-while-revalidate)
    const html = ssrText(renderToString(<WorkstreamView store={store} workstreamId="WS-1" />))
    expect(html.indexOf('门一')).toBeLessThan(html.indexOf('任务一'))
  })
})
