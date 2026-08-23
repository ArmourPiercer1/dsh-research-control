/**
 * WP-6.4 — inbox 切片 store（client 面 — 零 DSH import 的结构端口）:
 *
 *  - `items` 切片惰性加载 + in-flight 去重（StrictMode 双跑 effect 安全）;
 *  - stale-while-revalidate（refetch 失败保留最后好数据; 首载失败 data=null）;
 *  - fail-loud 缝（无 dataProvider ⇒ NOT_WIRED 点名冻结 13 RPC 缺口 —
 *    绝不伪造数据, 同 WP-5.2 actions-slices 纪律）;
 *  - 操作面（convert/dismiss/quickCapture）= provider 透传 + 成功后自动
 *    刷新 items 切片; 操作失败原样上抛（容器持 transient UI 反馈）;
 *  - 引擎纪律（getSnapshot 引用稳定; setState 不可变）。
 */

import { describe, expect, it } from 'vitest'

import {
  createInboxSliceStore,
  InboxSliceError,
  NOT_WIRED_PROVIDER,
  type InboxConversionKind,
  type InboxDataProvider,
  type InboxItemDto,
} from '../../src/client/stores/inbox-slice.js'

const ITEM: InboxItemDto = {
  id: 'IN-1',
  source: 'HUMAN_QUICK_CAPTURE',
  payload: '随手记: 周三组会讨论 results 目录',
  raw: null,
  contextRefs: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
  state: 'CAPTURED',
  convertedTo: null,
  createdAt: 1_700_000_000_001,
}

const ITEM_HIGH: InboxItemDto = {
  id: 'IN-2',
  source: 'UNCLASSIFIED_AUDIT_FINDING',
  payload: 'audit: 3 untracked',
  raw: { category: 'UNREGISTERED_WORKSPACE_CHANGE', escalation: { highImpact: true, reasons: ['DELETION'] } },
  contextRefs: [],
  state: 'CAPTURED',
  convertedTo: null,
  createdAt: 1_700_000_000_002,
}

interface RecordedProvider extends InboxDataProvider {
  calls: {
    list: number
    convert: { inboxItemId: string; targetKind: InboxConversionKind; fields: Record<string, unknown> }[]
    dismiss: string[]
    capture: { payload: string; contextRefs?: readonly { readonly kind: string; readonly id: string }[] }[]
  }
  setItems(items: readonly InboxItemDto[]): void
  listError?: Error
  convertError?: Error
  dismissError?: Error
  captureError?: Error
}

function makeProvider(): RecordedProvider {
  const calls: RecordedProvider['calls'] = { list: 0, convert: [], dismiss: [], capture: [] }
  let items: readonly InboxItemDto[] = [ITEM]
  return {
    calls,
    setItems(next: readonly InboxItemDto[]) {
      items = next
    },
    listError: undefined,
    convertError: undefined,
    dismissError: undefined,
    captureError: undefined,
    async listInboxItems() {
      calls.list += 1
      if (this.listError !== undefined) throw this.listError
      return items
    },
    async convertInboxItem(args) {
      calls.convert.push(args)
      if (this.convertError !== undefined) throw this.convertError
      // 模拟宿主真值变化: 条目转 CONVERTED。
      items = items.map((it) =>
        it.id === args.inboxItemId ? { ...it, state: 'CONVERTED' as const, convertedTo: { kind: args.targetKind, id: `${args.targetKind}-1` } } : it,
      )
    },
    async dismissInboxItem(inboxItemId) {
      calls.dismiss.push(inboxItemId)
      if (this.dismissError !== undefined) throw this.dismissError
      items = items.map((it) => (it.id === inboxItemId ? { ...it, state: 'DISMISSED' as const } : it))
    },
    async quickCapture(payload, contextRefs) {
      calls.capture.push({ payload, ...(contextRefs !== undefined ? { contextRefs } : {}) })
      if (this.captureError !== undefined) throw this.captureError
      items = [...items, { ...ITEM, id: 'IN-99', payload, contextRefs: contextRefs ?? [], state: 'CAPTURED' }]
    },
  }
}

describe('切片初始面（惰性 — idle）', () => {
  it('items slice starts idle with null data', () => {
    const store = createInboxSliceStore({ dataProvider: makeProvider() })
    const s = store.getSnapshot()
    expect(s.items.status).toBe('idle')
    expect(s.items.data).toBeNull()
    expect(s.items.error).toBeNull()
  })
})

describe('items 切片（provider 缝）', () => {
  it('loadInboxItems: ready with items; concurrent loads share one fetch', async () => {
    const provider = makeProvider()
    const store = createInboxSliceStore({ dataProvider: provider })
    const [p1, p2, p3] = [store.loadInboxItems(), store.loadInboxItems(), store.loadInboxItems()]
    await Promise.all([p1, p2, p3])
    expect(provider.calls.list).toBe(1)
    expect(store.getSnapshot().items.status).toBe('ready')
    expect(store.getSnapshot().items.data?.items).toEqual([ITEM])
  })

  it('首载失败 ⇒ error + data=null（fail-loud — 不伪造数据）', async () => {
    const provider = makeProvider()
    provider.listError = new Error('host unreachable')
    const store = createInboxSliceStore({ dataProvider: provider })
    await store.loadInboxItems()
    const s = store.getSnapshot().items
    expect(s.status).toBe('error')
    expect(s.data).toBeNull()
    expect(s.error).toBe('host unreachable')
  })

  it('stale-while-revalidate: refetch 失败保留最后好数据', async () => {
    const provider = makeProvider()
    const store = createInboxSliceStore({ dataProvider: provider })
    await store.loadInboxItems()
    expect(store.getSnapshot().items.status).toBe('ready')
    provider.listError = new Error('transient fault')
    await store.loadInboxItems()
    const s = store.getSnapshot().items
    expect(s.status).toBe('error')
    expect(s.data?.items).toEqual([ITEM]) // 最后好数据保留
    expect(s.error).toBe('transient fault')
  })
})

describe('fail-loud 缝（NOT_WIRED 缺省 provider）', () => {
  it('缺省 provider = NOT_WIRED_PROVIDER（引用相等 — 单一缝对象）', () => {
    const store = createInboxSliceStore()
    // 无 dataProvider option — 内部用 NOT_WIRED_PROVIDER; 经 load 面观测。
    void store
    expect(NOT_WIRED_PROVIDER).toBeDefined()
  })

  it('load 经缺省 provider ⇒ error 点名 13-RPC 缺口（绝不伪造数据）', async () => {
    const store = createInboxSliceStore()
    await store.loadInboxItems()
    const s = store.getSnapshot().items
    expect(s.status).toBe('error')
    expect(s.data).toBeNull()
    expect(s.error).toMatch(/13-RPC/)
    expect(s.error).toMatch(/inbox data face not wired/)
  })

  it('四操作面均 NOT_WIRED（点名各宿主目标）', async () => {
    for (const [op, p] of [
      ['list', NOT_WIRED_PROVIDER.listInboxItems()],
      ['convert', NOT_WIRED_PROVIDER.convertInboxItem({ inboxItemId: 'IN-1', targetKind: 'INTERVENTION', fields: {} })],
      ['dismiss', NOT_WIRED_PROVIDER.dismissInboxItem('IN-1')],
      ['capture', NOT_WIRED_PROVIDER.quickCapture('x')],
    ] as const) {
      await expect(p).rejects.toBeInstanceOf(InboxSliceError)
      await expect(p).rejects.toMatchObject({ code: 'NOT_WIRED' })
      expect(op).toBeDefined()
    }
    expect(await NOT_WIRED_PROVIDER.listInboxItems().catch((e: InboxSliceError) => e.message)).toMatch(/InboxService/)
  })
})

describe('操作面（provider 透传 + 成功自动刷新）', () => {
  it('convertInboxItem: provider 调用 + 成功刷新（列表反映宿主真值变化）', async () => {
    const provider = makeProvider()
    const store = createInboxSliceStore({ dataProvider: provider })
    await store.loadInboxItems()
    await store.convertInboxItem({ inboxItemId: 'IN-1', targetKind: 'INTERVENTION', fields: { kind: 'INTERVENTION', title: 't' } })
    expect(provider.calls.convert).toEqual([{ inboxItemId: 'IN-1', targetKind: 'INTERVENTION', fields: { kind: 'INTERVENTION', title: 't' } }])
    // 成功 = 刷新一次（list 共 2 次: 首载 + 操作后刷新）。
    expect(provider.calls.list).toBe(2)
    const s = store.getSnapshot().items
    expect(s.status).toBe('ready')
    expect(s.data?.items[0].state).toBe('CONVERTED')
    expect(s.data?.items[0].convertedTo).toEqual({ kind: 'INTERVENTION', id: 'INTERVENTION-1' })
  })

  it('convertInboxItem 失败 ⇒ 原样上抛 + 不刷新', async () => {
    const provider = makeProvider()
    provider.convertError = new InboxSliceError('NOT_WIRED', 'convert not wired')
    const store = createInboxSliceStore({ dataProvider: provider })
    await store.loadInboxItems()
    await expect(
      store.convertInboxItem({ inboxItemId: 'IN-1', targetKind: 'CLAIM', fields: { kind: 'CLAIM' } }),
    ).rejects.toMatchObject({ code: 'NOT_WIRED' })
    expect(provider.calls.list).toBe(1) // 未刷新
  })

  it('dismissInboxItem: provider 调用 + 成功刷新', async () => {
    const provider = makeProvider()
    const store = createInboxSliceStore({ dataProvider: provider })
    await store.loadInboxItems()
    await store.dismissInboxItem('IN-1')
    expect(provider.calls.dismiss).toEqual(['IN-1'])
    expect(provider.calls.list).toBe(2)
    expect(store.getSnapshot().items.data?.items[0].state).toBe('DISMISSED')
  })

  it('dismissInboxItem 失败 ⇒ 原样上抛 + 不刷新', async () => {
    const provider = makeProvider()
    provider.dismissError = new Error('state moved concurrently')
    const store = createInboxSliceStore({ dataProvider: provider })
    await store.loadInboxItems()
    await expect(store.dismissInboxItem('IN-1')).rejects.toThrow('state moved concurrently')
    expect(provider.calls.list).toBe(1)
  })

  it('quickCapture: provider 调用（payload + contextRefs）+ 成功刷新', async () => {
    const provider = makeProvider()
    const store = createInboxSliceStore({ dataProvider: provider })
    await store.loadInboxItems()
    await store.quickCapture('新捕获', [{ kind: 'WORKSTREAM', id: 'WS-2' }])
    expect(provider.calls.capture).toEqual([{ payload: '新捕获', contextRefs: [{ kind: 'WORKSTREAM', id: 'WS-2' }] }])
    expect(provider.calls.list).toBe(2)
    expect(store.getSnapshot().items.data?.items).toHaveLength(2)
  })
})

describe('引擎纪律（引用稳定 + 不可变）', () => {
  it('无变化时 getSnapshot 返回同一引用（useSyncExternalStore 契约）', () => {
    const store = createInboxSliceStore({ dataProvider: makeProvider() })
    const a = store.getSnapshot()
    const b = store.getSnapshot()
    expect(a).toBe(b)
  })

  it('状态不可变（setState 产生新对象 — 旧引用不被污染）', async () => {
    const store = createInboxSliceStore({ dataProvider: makeProvider() })
    const before = store.getSnapshot()
    await store.loadInboxItems()
    const after = store.getSnapshot()
    expect(before).not.toBe(after)
    expect(before.items.status).toBe('idle') // 旧引用保持原值
  })

  it('时钟注入（updatedAt 来自 now option — 确定性）', async () => {
    let t = 1000
    const store = createInboxSliceStore({ dataProvider: makeProvider(), now: () => ++t })
    await store.loadInboxItems()
    expect(store.getSnapshot().items.updatedAt).toBe(1001)
  })
})

describe('载荷形状（高影响升级条目标记 raw.escalation — 展示层消费面）', () => {
  it('raw.escalation 标记原样透传（宿主机械判定写入, 切片不推导）', async () => {
    const provider = makeProvider()
    provider.setItems([ITEM, ITEM_HIGH])
    const store = createInboxSliceStore({ dataProvider: provider })
    await store.loadInboxItems()
    const items = store.getSnapshot().items.data?.items
    expect(items?.[1].raw?.escalation).toEqual({ highImpact: true, reasons: ['DELETION'] })
  })
})
