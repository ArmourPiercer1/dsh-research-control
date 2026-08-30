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
 *
 * UI-4 D4 additions: the header objective/focus rows (B §12), the
 * Current zone's aggregate faces (ADJ-8), the Future zone's focus
 * marker + `Set as Current Focus` entry (B §20), and the low-noise
 * handling of an aggregate-slice business fault.
 */

import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  CurrentTaskDto,
  GetWorkstreamCurrentResult,
  RunDto,
  WorkstreamSnapshot,
} from '../../src/shared/rpc-contracts.js'
import {
  GetWorkstreamCurrentResultSchema,
  WorkstreamSnapshotSchema,
} from '../../src/shared/rpc-contracts.js'
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

/** UI-4 D4: the aggregate current face (wire-validity asserted in the
 *  「视图夹具 wire-valid」 test via the strict schema). */
const CURRENT_FIXTURE: GetWorkstreamCurrentResult = {
  workstreamId: 'WS-1',
  objectives: [
    {
      id: 'OBJ-1',
      scope: 'TOPIC',
      statement: 'Complete the baseline experiment',
      status: 'ACTIVE',
      priority: 'P1',
      targetDate: null,
      successCriteria: ['Baseline metric beats the null model'],
      linkedRefs: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
    },
  ],
  explicitBlockers: [
    {
      id: 'BLK-1',
      statement: 'GPU quota exhausted',
      affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
      status: 'ACTIVE',
      source: 'manual note',
      references: null,
      createdAt: T,
      clearedAt: null,
    },
  ],
  derivedBlockers: [
    {
      id: 'DERIVED-GATE-G-2',
      source: 'GATE',
      statement: 'Gate G-2 (统计显著性门) is not yet evaluated',
      reasonRefs: ['G-2'],
      primaryAction: { label: 'Evaluate G-2', targetKind: 'GATE', targetId: 'G-2' },
    },
  ],
  nextActions: [
    {
      id: 'NA-1',
      workstreamId: 'WS-1',
      statement: 'Prepare the ablation dataset',
      rationale: 'Needed before the ablation runs',
      status: 'PROPOSED',
      promotedToTaskId: null,
      createdAt: T,
    },
  ],
  interventions: [
    {
      id: 'IV-1',
      title: 'Baseline results diverge',
      detail: 'Two runs disagree on metric X',
      origin: 'AGENT_REPORT',
      status: 'OPEN',
      workstreamIds: ['WS-1'],
      createdAt: T,
      closedAt: null,
      resolutionNote: null,
    },
  ],
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
    expect(() => GetWorkstreamCurrentResultSchema.parse(CURRENT_FIXTURE)).not.toThrow()
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
    // (the Current zone title is the ADJ-9 English 'Current Execution';
    //  anchored on the exact element text so CSS-module class names
    //  cannot collide)
    expect(html.indexOf('历史')).toBeLessThan(html.indexOf('>Current Execution<'))
    expect(html.indexOf('>Current Execution<')).toBeLessThan(html.indexOf('未来计划'))

    // History zone: WS-level event summary entry
    expect(html).toContain('历史事件：7 条')
    expect(html).toContain('查看事件时间线')

    // Current zone: the active task facet + live run (ADJ-9 row labels;
    //  the domain enums render their canonical English form verbatim —
    //  D §25)
    expect(html).toContain('第一章：相关工作')
    expect(html).toContain('ACTIVE')
    expect(html).toContain('引用覆盖近三年')
    expect(html).toContain('Live runs: R-9')
    expect(html).toContain('RUNNING')
    expect(html).toContain(`Last checkpoint: ${new Date(T + 1000).toISOString()} (初稿过半)`)
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
    expect(html).not.toContain('Current Execution')
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
    expect(html).toContain('No active tasks')
    expect(html).toContain('No pending validations')
    expect(html).toContain('No runs')
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

  it('UI-4：header objective/focus 行（B §12）+ Current 五新面（ADJ-8）+ Future 焦点标记/入口（B §20）', async () => {
    const { store, stub } = readyStore(makeSnapshot(ZONE_OVERRIDES))
    await store.loadWorkstream('WS-1')
    stub.set('getWorkstreamCurrent', { ok: true, value: CURRENT_FIXTURE })
    stub.set('getCurrentFocus', {
      ok: true,
      value: { workstreamId: 'WS-1', focus: { planItemId: 'T-7', updatedAt: T } },
    })
    await store.loadWorkstreamCurrent({ workstreamId: 'WS-1' })
    await store.getCurrentFocus({ workstreamId: 'WS-1' })

    const html = renderPage(store, 'WS-1')

    // header rows (B §12 required display items): the FIRST objective +
    // the focus item with its title resolved against the plan
    expect(html).toContain('data-header-objective="OBJ-1"')
    expect(html).toContain('Current objective: Complete the baseline experiment')
    expect(html).toContain('data-header-focus="T-7"')
    expect(html).toContain('Current focus: 第七章：消融实验')

    // the Current zone's new faces (ADJ-8) — statements and the
    // derived primary action render verbatim
    expect(html).toContain('[Explicit]')
    expect(html).toContain('GPU quota exhausted')
    expect(html).toContain('[Derived]')
    expect(html).toContain('Evaluate G-2')
    expect(html).toContain('Prepare the ablation dataset')
    expect(html).toContain('Needed before the ablation runs')
    expect(html).toContain('Baseline results diverge')

    // the Future zone: EXACTLY the focused row carries the marker, and
    // every plan row offers the verbatim `Set as Current Focus` entry
    expect(html.match(/data-plan-focus="true"/g)?.length ?? 0).toBe(1)
    const t7Row = html.slice(
      html.indexOf('data-plan-item="T-7"'),
      html.indexOf('data-plan-item="G-2"'),
    )
    expect(t7Row).toContain('data-plan-focus="true"')
    for (const id of ['T-7', 'G-2', 'M-3', 'T-1']) {
      expect(html).toContain(`Set as Current Focus: ${id}`)
    }

    // SSR fetch accounting: one fetch per prepared slice, nothing extra
    expect(stub.countOf('getWorkstream')).toBe(1)
    expect(stub.countOf('getWorkstreamCurrent')).toBe(1)
    expect(stub.countOf('getCurrentFocus')).toBe(1)
  })

  it('UI-4：aggregate 面缺席时 header 行省略（idle 切片，SSR 零聚合 fetch）', async () => {
    const { store, stub } = readyStore(makeSnapshot(ZONE_OVERRIDES))
    await store.loadWorkstream('WS-1') // main slice ready; aggregate slices IDLE

    const html = renderPage(store, 'WS-1')

    // the header rows are omitted entirely (low noise: no placeholders)
    expect(html).not.toContain('Current objective:')
    expect(html).not.toContain('Current focus:')
    // ...and the Current zone renders its low-noise empty states
    expect(html).toContain('No active objectives')
    expect(html).toContain('No current focus')
    // SSR skips effects: the lazy aggregate loads never fired
    expect(stub.countOf('getWorkstreamCurrent')).toBe(0)
    expect(stub.countOf('getCurrentFocus')).toBe(0)
  })

  it('UI-4：current 切片业务故障 → 低噪空态，页面完好（stale-while-revalidate 不触发）', async () => {
    const { store, stub } = readyStore(makeSnapshot(ZONE_OVERRIDES))
    await store.loadWorkstream('WS-1')
    stub.set('getWorkstreamCurrent', {
      ok: false,
      error: {
        code: 'internal',
        message: '[research-control] CURRENT_LOAD_FAILED: fixture 读取失败',
        details: {},
      },
    })
    await store.loadWorkstreamCurrent({ workstreamId: 'WS-1' }) // resolves; slice=error

    const html = renderPage(store, 'WS-1')

    // the page is intact — the aggregate fault is low-noise (no banner,
    // no identity leak) and the zone falls back to its empty states
    expect(html).toContain('Workstream One')
    expect(html).toContain('>Current Execution<')
    expect(html).toContain('No active objectives')
    expect(html).toContain('No blockers')
    expect(html).not.toContain('OBJ-1')
    expect(html).not.toContain('BLK-1')
    expect(html).not.toContain('Action failed')
    expect(stub.countOf('getWorkstream')).toBe(1)
    expect(stub.countOf('getWorkstreamCurrent')).toBe(1)
  })

  it('UI-4：focus 指针不在 plan 内 → header 行回退原始 id，Future 无标记', async () => {
    const { store, stub } = readyStore(makeSnapshot(ZONE_OVERRIDES))
    await store.loadWorkstream('WS-1')
    stub.set('getCurrentFocus', {
      ok: true,
      value: { workstreamId: 'WS-1', focus: { planItemId: 'T-99', updatedAt: T } },
    })
    await store.getCurrentFocus({ workstreamId: 'WS-1' })

    const html = renderPage(store, 'WS-1')

    // the focus row falls back to the raw pointer id (title unresolvable)
    expect(html).toContain('data-header-focus="T-99"')
    expect(html).toContain('Current focus: T-99')
    // no plan row matches the pointer → no focus marker anywhere
    expect(html).not.toContain('data-plan-focus="true"')
    // the Set-as-CF entries are still offered (they are per-row, not
    // per-focus-state)
    expect(html).toContain('Set as Current Focus: T-7')
  })
})
