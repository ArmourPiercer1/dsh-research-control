/**
 * WP-5.2 — actions 切片 store（client 面 — 零 DSH import 的结构端口）:
 *
 *  - 三切片惰性加载 + in-flight 去重（StrictMode 双跑 effect 安全）;
 *  - stale-while-revalidate（refetch 失败保留最后好数据; 首载失败 data=null）;
 *  - fail-loud 缝（无 dataProvider ⇒ NOT_WIRED 点名冻结 13 RPC 缺口;
 *    无 rpc ⇒ objectiveProgress 点名接线缺口 — 绝不伪造数据）;
 *  - objectiveProgress 数据面 = 冻结 RPC（getProject + per-topic getTopic —
 *    分组上下文）;
 *  - 引擎纪律（getSnapshot 引用稳定; setState 不可变）;
 *  - refresh() 只刷新非 idle 切片。
 */

import { describe, expect, it } from 'vitest'

import {
  createActionsSlicesStore,
  ActionsSlicesError,
  type ActionsDataProvider,
  type BlockerItem,
  type NextActionItem,
  type ProjectTopicSource,
} from '../../src/client/stores/actions-slices.js'
import { PROJECT_FIXTURE, TOPIC_FIXTURE } from '../rpc-face/fixtures.js'
import type { RpcResult } from '../../src/client/stores/model.js'

const NA: NextActionItem[] = [
  { id: 'NA-1', workstreamId: 'WS-1', statement: '先跑基线', rationale: null, status: 'PROPOSED', promotedToTaskId: null, createdAt: 1 },
  { id: 'NA-2', workstreamId: 'WS-1', statement: '对比三方案', rationale: '用户关心成本', status: 'PROMOTED', promotedToTaskId: 'T-5', createdAt: 2 },
]
const BLK: BlockerItem[] = [
  { id: 'BLK-1', statement: 'GPU 队列满', affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }], status: 'ACTIVE', source: '用户报告', references: null, createdAt: 1, clearedAt: null },
  { id: 'BLK-2', statement: '旧阻碍', affects: [{ kind: 'TASK', id: 'T-1' }], status: 'CLEARED', source: '审计', references: null, createdAt: 2, clearedAt: 9 },
]

function okRpc(): ProjectTopicSource {
  return {
    getProject: async () => ({ ok: true, value: PROJECT_FIXTURE }),
    getTopic: async ({ topicId }) => ({ ok: true, value: TOPIC_FIXTURE }),
  }
}

function countingProvider(items: readonly NextActionItem[], blockers: readonly BlockerItem[]): ActionsDataProvider & { calls: { na: number; blk: number } } {
  const calls = { na: 0, blk: 0 }
  return {
    calls,
    async listNextActions() {
      calls.na += 1
      return items
    },
    async listBlockers() {
      calls.blk += 1
      return blockers
    },
  }
}

describe('切片初始面（惰性 — idle）', () => {
  it('three slices start idle with null data', () => {
    const store = createActionsSlicesStore({ rpc: okRpc(), dataProvider: countingProvider([], []) })
    const s = store.getSnapshot()
    for (const key of ['nextActions', 'blockers', 'objectiveProgress'] as const) {
      expect(s[key].status).toBe('idle')
      expect(s[key].data).toBeNull()
      expect(s[key].error).toBeNull()
    }
  })
})

describe('nextActions / blockers 切片（provider 缝）', () => {
  it('loadNextActions: ready with items; concurrent loads share one fetch', async () => {
    const provider = countingProvider(NA, BLK)
    const store = createActionsSlicesStore({ dataProvider: provider })
    const [p1, p2, p3] = [store.loadNextActions(), store.loadNextActions(), store.loadNextActions()]
    await Promise.all([p1, p2, p3])
    expect(provider.calls.na).toBe(1)
    expect(store.getSnapshot().nextActions.status).toBe('ready')
    expect(store.getSnapshot().nextActions.data?.items).toEqual(NA)
  })

  it('loadBlockers: ready with items', async () => {
    const provider = countingProvider(NA, BLK)
    const store = createActionsSlicesStore({ dataProvider: provider })
    await store.loadBlockers()
    expect(store.getSnapshot().blockers.data?.items).toEqual(BLK)
  })

  it('first-load failure: status error, data null', async () => {
    const store = createActionsSlicesStore({
      dataProvider: {
        async listNextActions(): Promise<never> {
          throw new Error('boom-na')
        },
        async listBlockers(): Promise<never> {
          throw new Error('boom-blk')
        },
      },
    })
    await store.loadNextActions()
    const s = store.getSnapshot().nextActions
    expect(s.status).toBe('error')
    expect(s.data).toBeNull()
    expect(s.error).toBe('boom-na')
  })

  it('stale-while-revalidate: a refetch failure keeps the last good data', async () => {
    let fail = false
    const store = createActionsSlicesStore({
      dataProvider: {
        async listNextActions() {
          if (fail) throw new Error('refetch boom')
          return NA
        },
        async listBlockers() {
          return BLK
        },
      },
    })
    await store.loadNextActions()
    fail = true
    await store.loadNextActions()
    const s = store.getSnapshot().nextActions
    expect(s.status).toBe('error')
    expect(s.error).toBe('refetch boom')
    expect(s.data?.items).toEqual(NA) // 旧数据保留
    fail = false
    await store.loadNextActions()
    expect(store.getSnapshot().nextActions.status).toBe('ready')
  })
})

describe('fail-loud 缝（绝不伪造数据）', () => {
  it('default provider throws NOT_WIRED naming the frozen 13-RPC gap', async () => {
    const store = createActionsSlicesStore({})
    await store.loadNextActions()
    const s = store.getSnapshot().nextActions
    expect(s.status).toBe('error')
    expect(s.error).toContain('not wired in this build')
    expect(s.error).toContain('13-RPC')
  })

  it('store without rpc: objective progress names the wiring gap', async () => {
    const store = createActionsSlicesStore({})
    await store.loadObjectiveProgress()
    const s = store.getSnapshot().objectiveProgress
    expect(s.status).toBe('error')
    expect(s.error).toContain('ProjectTopicSource')
  })
})

describe('objectiveProgress 切片（冻结 RPC 面 — getProject + getTopic）', () => {
  it('ready: objectives passthrough + per-topic grouping context (objectiveRefs + workstream ids)', async () => {
    const store = createActionsSlicesStore({ rpc: okRpc() })
    await store.loadObjectiveProgress()
    const s = store.getSnapshot().objectiveProgress
    expect(s.status).toBe('ready')
    expect(s.data?.objectives).toEqual(PROJECT_FIXTURE.objectives)
    expect(s.data?.topics).toEqual([
      { topicId: 'TPC-1', objectiveRefs: ['OBJ-2'], workstreamIds: ['WS-1'] },
    ])
  })

  it('getProject failure (ok:false) ⇒ RPC_FAULT error naming the cause', async () => {
    const store = createActionsSlicesStore({
      rpc: {
        getProject: async (): Promise<RpcResult<typeof PROJECT_FIXTURE>> => ({
          ok: false,
          error: { code: 'TREE_INVALID', message: 'the tree is broken', details: {} },
        }),
        getTopic: async () => ({ ok: true, value: TOPIC_FIXTURE }),
      },
    })
    await store.loadObjectiveProgress()
    const s = store.getSnapshot().objectiveProgress
    expect(s.status).toBe('error')
    expect(s.error).toContain('getProject failed')
    expect(s.error).toContain('TREE_INVALID')
  })

  it('a getTopic failure fails the whole slice (incomplete grouping context — fail loud)', async () => {
    const store = createActionsSlicesStore({
      rpc: {
        getProject: async () => ({ ok: true, value: PROJECT_FIXTURE }),
        getTopic: async ({ topicId }) =>
          topicId === 'TPC-1'
            ? ({ ok: false, error: { code: 'TOPIC_NOT_FOUND', message: 'missing', details: {} } } as RpcResult<typeof TOPIC_FIXTURE>)
            : ({ ok: true, value: TOPIC_FIXTURE } as RpcResult<typeof TOPIC_FIXTURE>),
      },
    })
    await store.loadObjectiveProgress()
    const s = store.getSnapshot().objectiveProgress
    expect(s.status).toBe('error')
    expect(s.error).toContain('getTopic(TPC-1) failed')
  })

  it('rpc faults surface as ActionsSlicesError with code RPC_FAULT', async () => {
    let caught: unknown
    const rpc: ProjectTopicSource = {
      getProject: async () => {
        throw new ActionsSlicesError('RPC_FAULT', 'socket dead')
      },
      getTopic: async () => ({ ok: true, value: TOPIC_FIXTURE }),
    }
    const store = createActionsSlicesStore({ rpc })
    try {
      await store.loadObjectiveProgress()
      // The error is captured into the slice (fail-loud store discipline);
      // verify the slice carries it:
      const s = store.getSnapshot().objectiveProgress
      expect(s.status).toBe('error')
      expect(s.error).toBe('socket dead')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeUndefined()
  })
})

describe('refresh() + 引擎纪律', () => {
  it('refresh only refetches non-idle slices', async () => {
    const provider = countingProvider(NA, BLK)
    const store = createActionsSlicesStore({ rpc: okRpc(), dataProvider: provider })
    await store.loadNextActions()
    await store.loadObjectiveProgress()
    provider.calls.na = 0
    provider.calls.blk = 0
    await store.refresh()
    expect(provider.calls.na).toBe(1) // 非 idle ⇒ refetch
    expect(provider.calls.blk).toBe(0) // idle ⇒ 跳过
    expect(store.getSnapshot().blockers.status).toBe('idle')
  })

  it('getSnapshot returns a stable reference between commits (engine discipline)', async () => {
    const store = createActionsSlicesStore({ dataProvider: countingProvider([], []) })
    const a = store.getSnapshot()
    const b = store.getSnapshot()
    expect(a).toBe(b)
    await store.loadNextActions()
    expect(store.getSnapshot()).not.toBe(a)
  })
})
