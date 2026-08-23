/**
 * WP-4.3 — Workstream container tests: three-zone data presentation,
 * plan order position-by-position, slice-state rendering (loading /
 * load-failure / stale-while-revalidate / empty), and the PF overlay
 * data seam — all through the REAL store face (stub RPC, no DOM).
 *
 * Rendering face: `react-dom/server` on the container after the store
 * slice is prepared (SSR skips effects, so the lazy-load effect never
 * double-fetches — the store's fetch count is asserted verbatim).
 *
 * The reorder MUTATION trigger is pinned in `reorder.test.tsx` (the
 * container's handleMove core = `buildReorderArgs` + `store.reorderPlan`
 * — the same two calls; the DOM click itself is E2E territory, WP-4.6).
 */

import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  CurrentTaskDto,
  RunDto,
  WorkstreamSnapshot,
} from '../../src/shared/rpc-contracts.js'
import { WorkstreamSnapshotSchema } from '../../src/shared/rpc-contracts.js'
import { WorkstreamView } from '../../src/client/views/workstream/index.js'
import type { ResearchStore } from '../../src/client/stores/index.js'
import { createResearchStore } from '../../src/client/stores/index.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import { makeSnapshot, type SnapshotOverrides } from './view-fixtures.js'
import { ssrText } from './harness.js'

const T = 1_755_000_000_000

/** Plan deliberately OUT of id order (position must follow the plan). */
const ZONE_PLAN: SnapshotOverrides['planItems'] = [
  { id: 'T-7', kind: 'TASK', title: '第七章：消融实验' },
  { id: 'G-2', kind: 'GATE', title: '统计显著性门' },
  { id: 'M-3', kind: 'MILESTONE', title: '投稿里程碑' },
  { id: 'T-1', kind: 'TASK', title: '第一章：相关工作' },
]

const ZONE_TASKS: readonly CurrentTaskDto[] = [
  {
    id: 'T-1',
    title: '第一章：相关工作',
    execution: 'ACTIVE',
    validation: 'PENDING',
    acceptanceCriteria: ['引用覆盖近三年'],
    liveRunIds: ['R-9'],
  },
  {
    id: 'T-8',
    title: '第八章：结论',
    execution: 'PLANNED',
    validation: 'NOT_REQUIRED',
    acceptanceCriteria: [],
    liveRunIds: [],
  },
]

const ZONE_RUNS: readonly RunDto[] = [
  {
    id: 'R-9',
    status: 'RUNNING',
    taskId: 'T-1',
    intent: '撰写相关工作章节',
    startedAt: T,
    endedAt: null,
    lastCheckpointAt: T + 1000,
    lastCheckpointNote: '初稿过半',
  },
]

const ZONE_OVERRIDES: SnapshotOverrides = {
  eventCount: 7,
  currentTasks: ZONE_TASKS,
  runs: ZONE_RUNS,
  planItems: ZONE_PLAN,
}

function readyStore(snapshot: WorkstreamSnapshot): { store: ResearchStore; stub: StubRpc } {
  const stub = makeStubRpc()
  stub.set('getWorkstream', { ok: true, value: snapshot })
  const store = createResearchStore({ rpc: stub.rpc })
  return { store, stub }
}

function renderPage(store: ResearchStore, workstreamId: string, onOpenHistory?: () => void): string {
  return ssrText(
    renderToString(<WorkstreamView store={store} workstreamId={workstreamId} onOpenHistory={onOpenHistory} />),
  )
}

describe('WorkstreamView 容器（三区同屏）', () => {
  it('视图夹具 wire-valid：makeSnapshot 产出通过严格 schema 解码', () => {
    expect(() => WorkstreamSnapshotSchema.parse(makeSnapshot(ZONE_OVERRIDES))).not.toThrow()
    expect(() => WorkstreamSnapshotSchema.parse(makeSnapshot())).not.toThrow()
  })

  it('三区数据呈现 + 逐位 plan 顺序 + PF 数据缝（§27.4 三区同屏）', async () => {
    const { store, stub } = readyStore(makeSnapshot(ZONE_OVERRIDES))
    await store.loadWorkstream('WS-1')

    const html = renderPage(store, 'WS-1')

    // header: title + id + lifecycle
    expect(html).toContain('Workstream One')
    expect(html).toContain('WS-1')
    expect(html).toContain('已实现')

    // three zones on one screen, in §27.4 order: History | Current | Future
    expect(html.indexOf('历史')).toBeLessThan(html.indexOf('当前执行'))
    expect(html.indexOf('当前执行')).toBeLessThan(html.indexOf('未来计划'))

    // History zone: WS-level event summary entry
    expect(html).toContain('历史事件：7 条')
    expect(html).toContain('查看事件时间线')

    // Current zone: the active task facet + live run
    expect(html).toContain('第一章：相关工作')
    expect(html).toContain('进行中')
    expect(html).toContain('引用覆盖近三年')
    expect(html).toContain('实时 Run：R-9')
    expect(html).toContain('运行中')
    expect(html).toContain(`最近检查点：${new Date(T + 1000).toISOString()}（初稿过半）`)
    // the PLANNED task with no pending validation stays OUT of Current
    expect(html).not.toContain('第八章：结论')

    // Future zone: canonical plan position-by-position (plan order, not id
    // order — 'T-1' is LAST in the plan and renders last). Scoped to the
    // Future zone section: the T-1 title ALSO renders in the Current zone
    // (active task) which precedes it on the page.
    const future = html.slice(html.indexOf('计划序列（G/T/M 有序）'))
    const titles = ['第七章：消融实验', '统计显著性门', '投稿里程碑', '第一章：相关工作']
    let last = -1
    for (const title of titles) {
      const at = future.indexOf(title)
      expect(at, `plan title "${title}" must keep its plan position`).toBeGreaterThan(last)
      last = at
    }
    expect(html).toContain('任务')
    expect(html).toContain('门')
    expect(html).toContain('里程碑')
    // PF overlay data seam (fixture PF-1 OPEN)
    expect(html).toContain('未决 PlanFork：1')
    expect(html).toContain('PF-1')
    expect(html).toContain('待处理')
    expect(html).toContain('the plan misses the baseline experiment')

    // SSR renders once: no double fetch (the lazy-load effect is client-side)
    expect(stub.countOf('getWorkstream')).toBe(1)
  })

  it('idle 切片渲染加载态（懒加载在途）', () => {
    const stub = makeStubRpc()
    stub.set('getWorkstream', { ok: true, value: makeSnapshot() })
    const store = createResearchStore({ rpc: stub.rpc })
    // no loadWorkstream call: the slice is idle
    const html = renderPage(store, 'WS-1')
    expect(html).toContain('正在加载 Workstream…')
    expect(html).not.toContain('未来计划')
    expect(stub.countOf('getWorkstream')).toBe(0)
  })

  it('首载失败渲染失败态 + 重试入口', async () => {
    const stub = makeStubRpc()
    stub.set('getWorkstream', {
      ok: false,
      error: { code: 'WORKSTREAM_NOT_FOUND', message: 'workstream 不存在', details: {} },
    })
    const store = createResearchStore({ rpc: stub.rpc })
    await store.loadWorkstream('WS-1') // business fault: resolves, slice=error

    const html = renderPage(store, 'WS-1')
    // the store surfaces slice errors as `CODE: message` (WP-4.1b format)
    expect(html).toContain('加载失败：WORKSTREAM_NOT_FOUND: workstream 不存在')
    expect(html).toContain('重试')
    expect(html).not.toContain('未来计划')
    expect(html).not.toContain('当前执行')
  })

  it('stale-while-revalidate：refetch 失败保留旧数据 + 失败条', async () => {
    const { store, stub } = readyStore(makeSnapshot(ZONE_OVERRIDES))
    await store.loadWorkstream('WS-1')

    stub.set('getWorkstream', {
      ok: false,
      error: { code: 'SNAPSHOT_IO', message: '刷新时读取失败', details: {} },
    })
    await store.refresh('测试')

    const html = renderPage(store, 'WS-1')
    // stale data STILL renders (last good payload kept)
    expect(html).toContain('Workstream One')
    expect(html).toContain('第七章：消融实验')
    // and the failure banner is visible (`CODE: message` store format)
    expect(html).toContain('刷新失败，显示最近数据：SNAPSHOT_IO: 刷新时读取失败')
    expect(stub.countOf('getWorkstream')).toBe(2)
  })

  it('空 Workstream：三区各自空态', async () => {
    const { store } = readyStore(
      makeSnapshot({
        ...ZONE_OVERRIDES,
        currentTasks: [],
        runs: [],
        planItems: [],
        planForks: [],
        unresolvedPlanForkCount: 0,
        eventCount: 0,
      }),
    )
    await store.loadWorkstream('WS-1')

    const html = renderPage(store, 'WS-1')
    expect(html).toContain('无活动任务')
    expect(html).toContain('无待 review 校验')
    expect(html).toContain('暂无 Run')
    expect(html).toContain('计划为空')
    expect(html).toContain('暂无未决 PlanFork')
    expect(html).toContain('暂无历史事件')
  })

  it('历史入口回调经容器传递（onOpenHistory prop）', async () => {
    const { store } = readyStore(makeSnapshot(ZONE_OVERRIDES))
    await store.loadWorkstream('WS-1')
    // the container passes the callback down (SSR asserts the entry renders
    // with the prop present; the callback INVOCATION is pinned in
    // zones.test.tsx at the pure component and by E2E at the page level)
    const html = renderPage(store, 'WS-1', () => undefined)
    expect(html).toContain('查看事件时间线')
    const htmlNoCallback = renderPage(store, 'WS-1')
    expect(htmlNoCallback).toContain('查看事件时间线')
  })
})
