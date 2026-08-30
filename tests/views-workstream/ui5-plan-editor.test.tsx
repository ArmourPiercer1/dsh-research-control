/**
 * @vitest-environment jsdom
 *
 * UI-5 D4 — the plan editor end-to-end (page level): the REAL
 * `WorkstreamView` mounted against the REAL store (`createResearchStore`)
 * with the stub RPC facade (tests/stores/stub-rpc.ts). Real events drive
 * the real handlers; the assertions pin the recorded WIRE ARGS (the
 * per-kind create carriers, the RMW changes shape, the dependency
 * endpoint kinds) + the ADJ-8 invalidation counts + the post-mutation UI
 * state (selection, forms, fault notes).
 *
 * The React Flow canvas is mocked at the component layer (the page
 * mounts the extended PlanGraphContainer — the mock registers
 * `@xyflow/react` before the module graph loads it).
 *
 * Baseline counts after mount: the page's lazy hooks and the graph
 * container's mount load fire in the same commit, so the store's
 * in-flight dedupe keeps ONE fetch per slice (the production shape —
 * no preload, as on a cold page load):
 *   getWorkstream=1, getWorkstreamCurrent=1, getCurrentFocus=1.
 * Every OK mutation refetches exactly `workstreams:WS-1` +
 * `current:WS-1` (the ADJ-8 unified set — the dependency faces list the
 * cached family, of which only WS-1 is cached). A business fault
 * (ok:false) refetches NOTHING — `okValue` throws before the
 * invalidation pass runs.
 */

import '../graph/xyflow-mock.js'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type {
  CurrentTaskDto,
  DependencyEdgeDto,
  GetWorkstreamCurrentResult,
  WorkstreamSnapshot,
} from '../../src/shared/rpc-contracts.js'
import { createResearchStore, type ResearchStore } from '../../src/client/stores/index.js'
import { WorkstreamView } from '../../src/client/views/workstream/index.js'
import { makeStubRpc, type StubRpc } from '../stores/stub-rpc.js'
import { makeSnapshot, type SnapshotOverrides } from './view-fixtures.js'

afterEach(cleanup)

/** The canonical plan (array order = canonical position order). */
const PLAN: SnapshotOverrides['planItems'] = [
  { id: 'T-7', kind: 'TASK', title: '第七章：消融实验' },
  { id: 'G-2', kind: 'GATE', title: '统计显著性门' },
  { id: 'M-3', kind: 'MILESTONE', title: '投稿里程碑' },
  { id: 'T-1', kind: 'TASK', title: '第一章：相关工作' },
]

/** T-1 carries a wire-visible acceptanceCriteria (the RMW seed join —
 *  the edit form seeds it from `data.current.tasks`, ADJ-5). */
const TASKS: readonly CurrentTaskDto[] = [
  {
    id: 'T-1',
    title: '第一章：相关工作',
    execution: 'ACTIVE',
    validation: 'PENDING',
    acceptanceCriteria: ['引用覆盖近三年'],
    liveRunIds: [],
  },
]

function makeCurrent(edges: readonly DependencyEdgeDto[]): GetWorkstreamCurrentResult {
  return {
    workstreamId: 'WS-1',
    objectives: [],
    explicitBlockers: [],
    derivedBlockers: [],
    nextActions: [],
    interventions: [],
    dependencyEdges: [...edges],
  }
}

interface Page {
  readonly stub: StubRpc
  readonly store: ResearchStore
  readonly snap: WorkstreamSnapshot
  readonly container: HTMLElement
}

/** Cold-mount the page (the production shape — no preload): the page's
 *  lazy hooks and the graph container's mount load fire in the same
 *  commit, so the store's in-flight dedupe keeps ONE fetch per slice,
 *  and the test settles until every slice is ready. */
async function mountPage(
  current?: GetWorkstreamCurrentResult,
  planItems: SnapshotOverrides['planItems'] = PLAN,
): Promise<Page> {
  const stub = makeStubRpc()
  const snap = makeSnapshot({ planItems, currentTasks: TASKS })
  stub.set('getWorkstream', { ok: true, value: snap })
  if (current !== undefined) {
    stub.set('getWorkstreamCurrent', { ok: true, value: current })
  }
  const store = createResearchStore({ rpc: stub.rpc })
  const { container } = render(<WorkstreamView store={store} workstreamId="WS-1" />)
  await waitFor(() => {
    expect(store.getState().workstreams.get('WS-1')?.status).toBe('ready')
    expect(store.getState().current.get('WS-1')?.status).toBe('ready')
    expect(store.getState().currentFocus.get('WS-1')?.status).toBe('ready')
  })
  return { stub, store, snap, container }
}

function field(host: Element, name: string): HTMLElement {
  const el = host.querySelector(`[data-strip-field="${name}"]`)
  if (el === null) throw new Error(`missing field ${name}`)
  return el as HTMLElement
}

function query(page: Page, selector: string): HTMLElement {
  const el = page.container.querySelector(selector)
  if (el === null) throw new Error(`missing ${selector}`)
  return el as HTMLElement
}

/* ================================================================== */

describe('UI-5 plan editor — create (per-kind carriers)', () => {
  it('TASK head +: the title+goal carrier at index 0 (blank optionals OMITTED)', async () => {
    const page = await mountPage()
    fireEvent.click(query(page, '[data-strip-add-head]'))
    const form = query(page, '[data-strip-form]')
    // F-3: kind-aware gating — the frozen task.schema.json requires
    // goal for TASK, so title alone keeps Save disabled.
    fireEvent.change(field(form, 'title'), { target: { value: '基线实验设计' } })
    expect((query(page, '[data-strip-form-save]') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(field(form, 'goal'), { target: { value: '建立可复现的基线' } })
    expect((query(page, '[data-strip-form-save]') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(query(page, '[data-strip-form-save]'))

    await waitFor(() => expect(page.stub.countOf('createPlanItem')).toBe(1))
    expect(page.stub.callsTo('createPlanItem')[0].args).toEqual({
      workstreamId: 'WS-1',
      kind: 'TASK',
      item: { task: { title: '基线实验设计', goal: '建立可复现的基线' } },
      index: 0,
    })
    // ADJ-8: the OK invalidation refetches both slices exactly once.
    await waitFor(() => expect(page.stub.countOf('getWorkstream')).toBe(2))
    expect(page.stub.countOf('getWorkstreamCurrent')).toBe(2)
  })

  it('F-10: the EMPTY plan offers the head + (ADJ-3 no-plan branch), creating at index 0', async () => {
    const page = await mountPage(undefined, [])
    // F-10: the empty note renders next to the offered head slot —
    // pre-F-10 the empty state had NO create affordance (the ADJ-3
    // dead end, t70 run 4 :877).
    expect(page.container.textContent).toContain('No planned items')
    expect(page.container.querySelector('[data-strip-item]')).toBeNull()
    fireEvent.click(query(page, '[data-strip-add-head]'))
    const form = query(page, '[data-strip-form]')
    // F-3 gating applies on the no-plan branch too (goal REQUIRED).
    fireEvent.change(field(form, 'title'), { target: { value: '无计划首项' } })
    expect((query(page, '[data-strip-form-save]') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(field(form, 'goal'), { target: { value: '建立计划' } })
    expect((query(page, '[data-strip-form-save]') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(query(page, '[data-strip-form-save]'))

    await waitFor(() => expect(page.stub.countOf('createPlanItem')).toBe(1))
    expect(page.stub.callsTo('createPlanItem')[0].args).toEqual({
      workstreamId: 'WS-1',
      kind: 'TASK',
      item: { task: { title: '无计划首项', goal: '建立计划' } },
      index: 0,
    })
    // ADJ-8: the OK invalidation refetches both slices exactly once.
    await waitFor(() => expect(page.stub.countOf('getWorkstream')).toBe(2))
    expect(page.stub.countOf('getWorkstreamCurrent')).toBe(2)
  })

  it('TASK after-row +: index follows the row; filled fields are split into lines', async () => {
    const page = await mountPage()
    // The + AFTER the first row (T-7) inserts at index 1.
    fireEvent.click(query(page, '[data-strip-add-after="T-7"]'))
    const form = query(page, '[data-strip-form]')
    fireEvent.change(field(form, 'title'), { target: { value: '预实验' } })
    fireEvent.change(field(form, 'goal'), { target: { value: '验证方法可行性' } })
    fireEvent.change(field(form, 'acceptanceCriteria'), { target: { value: 'a1\na2' } })
    fireEvent.change(field(form, 'deliverables'), { target: { value: 'd1' } })
    fireEvent.change(field(form, 'note'), { target: { value: '先小样本' } })
    fireEvent.click(query(page, '[data-strip-form-save]'))

    await waitFor(() => expect(page.stub.countOf('createPlanItem')).toBe(1))
    expect(page.stub.callsTo('createPlanItem')[0].args).toEqual({
      workstreamId: 'WS-1',
      kind: 'TASK',
      item: {
        task: {
          title: '预实验',
          goal: '验证方法可行性',
          acceptanceCriteria: ['a1', 'a2'],
          deliverables: ['d1'],
          note: '先小样本',
        },
      },
      index: 1,
    })
  })

  it('the kind select is the form identity: a GATE carrier matches the GATE fields', async () => {
    const page = await mountPage()
    fireEvent.click(query(page, '[data-strip-add-head]'))
    const form = query(page, '[data-strip-form]')
    fireEvent.change(field(form, 'kind'), { target: { value: 'GATE' } })
    // The field set swaps to the GATE shape (no goal/criteria-for-task).
    expect(form.querySelector('[data-strip-field="goal"]')).toBeNull()
    fireEvent.change(field(form, 'title'), { target: { value: '数据完整性门' } })
    fireEvent.change(field(form, 'criteria'), { target: { value: '字段无缺失' } })
    fireEvent.change(field(form, 'references'), { target: { value: 'r1\nr2' } })
    fireEvent.click(query(page, '[data-strip-form-save]'))

    await waitFor(() => expect(page.stub.countOf('createPlanItem')).toBe(1))
    expect(page.stub.callsTo('createPlanItem')[0].args).toEqual({
      workstreamId: 'WS-1',
      kind: 'GATE',
      item: { gate: { title: '数据完整性门', criteria: '字段无缺失', references: ['r1', 'r2'] } },
      index: 0,
    })
  })

  it('MILESTONE: the statement gates Save (frozen schema); the filled statement is sent', async () => {
    const page = await mountPage()
    // F-3: the frozen milestone.schema.json makes `statement` REQUIRED,
    // so a title-only MILESTONE keeps Save disabled.
    fireEvent.click(query(page, '[data-strip-add-head]'))
    let form = query(page, '[data-strip-form]')
    fireEvent.change(field(form, 'kind'), { target: { value: 'MILESTONE' } })
    fireEvent.change(field(form, 'title'), { target: { value: '中期里程碑' } })
    expect((query(page, '[data-strip-form-save]') as HTMLButtonElement).disabled).toBe(true)
    // The statement unlocks Save and rides the carrier.
    fireEvent.change(field(form, 'statement'), { target: { value: '基线完成' } })
    expect((query(page, '[data-strip-form-save]') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(query(page, '[data-strip-form-save]'))

    await waitFor(() => expect(page.stub.countOf('createPlanItem')).toBe(1))
    expect(page.stub.callsTo('createPlanItem')[0].args).toEqual({
      workstreamId: 'WS-1',
      kind: 'MILESTONE',
      item: { milestone: { title: '中期里程碑', statement: '基线完成' } },
      index: 0,
    })
  })

  it('create OK: the host-confirmed item is selected and visible from the refetched snapshot', async () => {
    const stub = makeStubRpc()
    const before = makeSnapshot({ planItems: PLAN, currentTasks: TASKS })
    const after = makeSnapshot({
      planItems: [...PLAN, { id: 'T-9', kind: 'TASK', title: '第九章：附录' }],
      currentTasks: TASKS,
    })
    // The mount-time load consumes `before`; the post-mutation refetch
    // consumes `after`.
    stub.set('getWorkstream', [
      { ok: true, value: before },
      { ok: true, value: after },
    ])
    const store = createResearchStore({ rpc: stub.rpc })
    const { container } = render(<WorkstreamView store={store} workstreamId="WS-1" />)
    await waitFor(() => {
      expect(store.getState().workstreams.get('WS-1')?.status).toBe('ready')
    })

    fireEvent.click(container.querySelector('[data-strip-add-head]')!)
    fireEvent.change(
      field(container.querySelector('[data-strip-form]')!, 'title'),
      { target: { value: '附录整理' } },
    )
    // F-3: the frozen task.schema.json requires goal for TASK.
    fireEvent.change(
      field(container.querySelector('[data-strip-form]')!, 'goal'),
      { target: { value: '附录与引用整理' } },
    )
    fireEvent.click(container.querySelector('[data-strip-form-save]')!)

    // The refetched snapshot lands T-9, and the selection follows the
    // host-confirmed id.
    await waitFor(() => {
      const row = container.querySelector('[data-strip-item="T-9"]')
      expect(row).not.toBeNull()
      expect(row!.getAttribute('data-strip-selected')).toBe('true')
    })
    expect(container.querySelector('[data-strip-form]')).toBeNull()
    expect(stub.countOf('getWorkstream')).toBe(2)
  })

  it('create business fault: the fault note surfaces and NOTHING is refetched', async () => {
    const page = await mountPage()
    page.stub.set('createPlanItem', {
      ok: false,
      error: { code: 'SCHEMA_VIOLATION', message: 'carrier must match the kind' },
    })
    fireEvent.click(query(page, '[data-strip-add-head]'))
    fireEvent.change(field(query(page, '[data-strip-form]'), 'title'), {
      target: { value: '基线实验设计' },
    })
    // F-3: goal is required for TASK — without it the Save button stays
    // disabled and the fault path would never be reached.
    fireEvent.change(field(query(page, '[data-strip-form]'), 'goal'), {
      target: { value: '建立可复现的基线' },
    })
    fireEvent.click(query(page, '[data-strip-form-save]'))

    await waitFor(() => {
      expect(page.container.textContent).toContain('Create failed：carrier must match the kind')
    })
    // okValue threw before the invalidation pass — the baseline counts
    // are untouched, and the form stays open for the retry.
    expect(page.stub.countOf('getWorkstream')).toBe(1)
    expect(page.stub.countOf('getWorkstreamCurrent')).toBe(1)
    expect(query(page, '[data-strip-form]')).not.toBeNull()
  })
})

/* ================================================================== */

describe('UI-5 plan editor — edit (the B §19 RMW shape)', () => {
  async function openEditT1(page: Page) {
    fireEvent.click(query(page, '[data-strip-item="T-1"]'))
    const edit = query(page, '[data-strip-edit]')
    // The seed (title + the joined acceptanceCriteria) lands in an
    // effect — wait for it before asserting the prefill.
    await waitFor(() => {
      expect((field(edit, 'title') as HTMLInputElement).value).toBe('第一章：相关工作')
      expect((field(edit, 'acceptanceCriteria') as HTMLTextAreaElement).value).toBe('引用覆盖近三年')
    })
    return edit
  }

  it('title is ALWAYS sent; an emptied (seeded) criteria list is an explicit CLEAR (null)', async () => {
    const page = await mountPage()
    const edit = await openEditT1(page)
    fireEvent.change(field(edit, 'title'), { target: { value: '第一章：相关工作（修订）' } })
    fireEvent.change(field(edit, 'acceptanceCriteria'), { target: { value: '' } })
    fireEvent.click(query(page, '[data-strip-edit-save]'))

    await waitFor(() => expect(page.stub.countOf('updatePlanItem')).toBe(1))
    // goal/deliverables/note were never shown blank → OMITTED.
    expect(page.stub.callsTo('updatePlanItem')[0].args).toEqual({
      workstreamId: 'WS-1',
      itemId: 'T-1',
      changes: { title: '第一章：相关工作（修订）', acceptanceCriteria: null },
    })
    await waitFor(() => expect(page.stub.countOf('getWorkstream')).toBe(2))
    expect(page.stub.countOf('getWorkstreamCurrent')).toBe(2)
  })

  it('filled optionals are sent (lists split); the seeded title is echoed', async () => {
    const page = await mountPage()
    const edit = await openEditT1(page)
    fireEvent.change(field(edit, 'title'), { target: { value: '第一章：相关工作（定稿）' } })
    fireEvent.change(field(edit, 'acceptanceCriteria'), { target: { value: 'a1\na2' } })
    fireEvent.change(field(edit, 'goal'), { target: { value: '覆盖经典引用' } })
    fireEvent.change(field(edit, 'deliverables'), { target: { value: 'd1\nd2' } })
    fireEvent.change(field(edit, 'note'), { target: { value: '含 2024 综述' } })
    fireEvent.click(query(page, '[data-strip-edit-save]'))

    await waitFor(() => expect(page.stub.countOf('updatePlanItem')).toBe(1))
    expect(page.stub.callsTo('updatePlanItem')[0].args).toEqual({
      workstreamId: 'WS-1',
      itemId: 'T-1',
      changes: {
        title: '第一章：相关工作（定稿）',
        acceptanceCriteria: ['a1', 'a2'],
        goal: '覆盖经典引用',
        deliverables: ['d1', 'd2'],
        note: '含 2024 综述',
      },
    })
  })

  it('GATE edit: only the title + the filled gate fields (blank references OMITTED)', async () => {
    const page = await mountPage()
    fireEvent.click(query(page, '[data-strip-item="G-2"]'))
    const edit = query(page, '[data-strip-edit]')
    await waitFor(() => {
      expect((field(edit, 'title') as HTMLInputElement).value).toBe('统计显著性门')
    })
    // The GATE shape has no acceptanceCriteria field at all.
    expect(edit.querySelector('[data-strip-field="acceptanceCriteria"]')).toBeNull()
    fireEvent.change(field(edit, 'criteria'), { target: { value: 'p < 0.05' } })
    fireEvent.click(query(page, '[data-strip-edit-save]'))

    await waitFor(() => expect(page.stub.countOf('updatePlanItem')).toBe(1))
    expect(page.stub.callsTo('updatePlanItem')[0].args).toEqual({
      workstreamId: 'WS-1',
      itemId: 'G-2',
      changes: { title: '统计显著性门', criteria: 'p < 0.05' },
    })
  })

  it('edit business fault: the fault note surfaces, the selection survives, NOTHING is refetched', async () => {
    const page = await mountPage()
    page.stub.set('updatePlanItem', {
      ok: false,
      error: { code: 'STALE_ORDER', message: 'plan order changed under the editor' },
    })
    const edit = await openEditT1(page)
    fireEvent.change(field(edit, 'title'), { target: { value: '第一章：相关工作（冲突）' } })
    fireEvent.click(query(page, '[data-strip-edit-save]'))

    await waitFor(() => {
      expect(page.container.textContent).toContain('Save failed：plan order changed under the editor')
    })
    expect(page.stub.countOf('getWorkstream')).toBe(1)
    expect(page.stub.countOf('getWorkstreamCurrent')).toBe(1)
    // The selection + the edit form survive the failed save.
    expect(query(page, '[data-strip-item="T-1"]').getAttribute('data-strip-selected')).toBe('true')
    expect(query(page, '[data-strip-edit]')).not.toBeNull()
  })
})

/* ================================================================== */

describe('UI-5 plan editor — remove (one RPC under all three labels)', () => {
  it('remove OK: removePlanItem once; the selection is cleared and the edit face resets', async () => {
    const page = await mountPage()
    fireEvent.click(query(page, '[data-strip-item="T-1"]'))
    // The edit face is open — the remove entry works alongside it.
    expect(query(page, '[data-strip-edit]')).not.toBeNull()
    fireEvent.click(query(page, '[data-strip-remove="T-1"]'))

    await waitFor(() => expect(page.stub.countOf('removePlanItem')).toBe(1))
    expect(page.stub.callsTo('removePlanItem')[0].args).toEqual({
      workstreamId: 'WS-1',
      itemId: 'T-1',
    })
    await waitFor(() => {
      expect(page.container.querySelector('[data-strip-selected]')).toBeNull()
    })
    expect(page.container.querySelector('[data-strip-edit]')).toBeNull()
    await waitFor(() => expect(page.stub.countOf('getWorkstream')).toBe(2))
    expect(page.stub.countOf('getWorkstreamCurrent')).toBe(2)
  })

  it('remove business fault: the fault note surfaces and the selection survives', async () => {
    const page = await mountPage()
    page.stub.set('removePlanItem', {
      ok: false,
      error: { code: 'PLAN_REORDERED', message: 'plan.yaml changed on disk' },
    })
    fireEvent.click(query(page, '[data-strip-item="T-1"]'))
    fireEvent.click(query(page, '[data-strip-remove="T-1"]'))

    await waitFor(() => {
      expect(page.container.textContent).toContain('Remove failed：plan.yaml changed on disk')
    })
    expect(page.stub.countOf('getWorkstream')).toBe(1)
    expect(page.stub.countOf('getWorkstreamCurrent')).toBe(1)
    expect(query(page, '[data-strip-item="T-1"]').getAttribute('data-strip-selected')).toBe('true')
  })
})

/* ================================================================== */

describe('UI-5 plan editor — dependencies (B §17)', () => {
  it('addDependency: the kinds are resolved from the id prefixes (source = the selection)', async () => {
    const page = await mountPage()
    fireEvent.click(query(page, '[data-strip-item="T-1"]'))
    // No edges yet — the empty note, and the add row is still offered.
    expect(page.container.textContent).toContain('No dependencies')
    const select = query(page, '[data-dep-add-target]') as HTMLSelectElement
    // The options follow the plan order and exclude the selection.
    expect(Array.from(select.options).map(option => option.value)).toEqual(['', 'T-7', 'G-2', 'M-3'])
    expect((query(page, '[data-dep-add-button]') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(select, { target: { value: 'G-2' } })
    expect((query(page, '[data-dep-add-button]') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(query(page, '[data-dep-add-button]'))

    await waitFor(() => expect(page.stub.countOf('addDependency')).toBe(1))
    expect(page.stub.callsTo('addDependency')[0].args).toEqual({
      workstreamId: 'WS-1',
      source: { kind: 'TASK', id: 'T-1' },
      target: { kind: 'GATE', id: 'G-2' },
    })
    // OK resets the transient target; ADJ-8 refetches the two slices.
    await waitFor(() => expect((query(page, '[data-dep-add-target]') as HTMLSelectElement).value).toBe(''))
    await waitFor(() => expect(page.stub.countOf('getWorkstream')).toBe(2))
    expect(page.stub.countOf('getWorkstreamCurrent')).toBe(2)
  })

  it('removeDependency: the Depends-on row removes by relationId; the Depended-by row is READ-ONLY', async () => {
    // T-1 DEPENDS ON G-2 (source T-1 → target G-2).
    const page = await mountPage(
      makeCurrent([{ relationId: 'REL-1', sourceId: 'T-1', targetId: 'G-2' }]),
    )
    fireEvent.click(query(page, '[data-strip-item="T-1"]'))
    const dependsOn = query(page, '[data-dep-depends-on]')
    const removeButton = dependsOn.querySelector('[data-dep-remove="REL-1"]')
    expect(removeButton).not.toBeNull()
    fireEvent.click(removeButton!)

    await waitFor(() => expect(page.stub.countOf('removeDependency')).toBe(1))
    expect(page.stub.callsTo('removeDependency')[0].args).toEqual({
      workstreamId: 'WS-1',
      relationId: 'REL-1',
    })
    await waitFor(() => expect(page.stub.countOf('getWorkstream')).toBe(2))
    expect(page.stub.countOf('getWorkstreamCurrent')).toBe(2)

    // The reverse side: G-2 lists T-1 under "Depended by" — no remove
    // entry there (the edge is removed from the source side only).
    fireEvent.click(query(page, '[data-strip-item="G-2"]'))
    await waitFor(() => {
      const dependedBy = page.container.querySelector('[data-dep-depended-by]')
      expect(dependedBy).not.toBeNull()
      expect(dependedBy!.textContent).toContain('T-1')
      expect(dependedBy!.querySelector('[data-dep-remove]')).toBeNull()
    })
  })

  it('dependency business fault: the shared fault prefix surfaces and NOTHING is refetched', async () => {
    const page = await mountPage()
    page.stub.set('addDependency', {
      ok: false,
      error: { code: 'DEPENDENCY_EXISTS', message: 'edge already recorded' },
    })
    fireEvent.click(query(page, '[data-strip-item="T-1"]'))
    fireEvent.change(query(page, '[data-dep-add-target]'), { target: { value: 'G-2' } })
    fireEvent.click(query(page, '[data-dep-add-button]'))

    await waitFor(() => {
      expect(page.container.textContent).toContain('Dependency change failed：edge already recorded')
    })
    expect(page.stub.countOf('getWorkstream')).toBe(1)
    expect(page.stub.countOf('getWorkstreamCurrent')).toBe(1)
  })
})

/* ================================================================== */

describe('UI-5 plan editor — FR4b (fix round): the late-success clobber guard (F-5)', () => {
  /** The stub createPlanItem result (a host-confirmed T-9 — the stub
   *  does not persist it, so the ADJ-8 refetch returns the original
   *  plan: the selection target is absent from the refetched data,
   *  which keeps the assertions on the FORM state — the clobber face). */
  const OK_CREATE = {
    ok: true,
    value: {
      itemId: 'T-9',
      workstreamId: 'WS-1',
      kind: 'TASK',
      planPath: 'workstreams/WS-1/plan.yaml',
      newOrder: ['T-9'],
      managementActionId: 'MA-1',
    },
  } as const

  it('a create form opened while a submit is pending survives the late success', async () => {
    const page = await mountPage()
    // Resolver held in an array (not a `let … = null`): TS does not
    // reset the outer-scope `null` narrowing for a closure assignment,
    // which would make `resolveCreate?.()` a `never` call.
    const resolvers: ((value: unknown) => void)[] = []
    page.stub.set('createPlanItem', new Promise(resolve => { resolvers.push(resolve) }))

    // ① Open the head create form, fill it, submit — PENDING (the
    //    promise only resolves after the ADJ-8 refetches settle).
    fireEvent.click(query(page, '[data-strip-add-head]'))
    const form1 = query(page, '[data-strip-form]')
    fireEvent.change(field(form1, 'title'), { target: { value: '第一次创建' } })
    fireEvent.change(field(form1, 'goal'), { target: { value: '第一个目标' } })
    fireEvent.click(query(page, '[data-strip-form-save]'))
    expect(page.stub.countOf('createPlanItem')).toBe(1)
    // Pending: the save button is gated (FR3) while the RPC is in flight.
    expect((query(page, '[data-strip-form-save]') as HTMLButtonElement).disabled).toBe(true)

    // ② The F-5 race window: a fast follow-up `+` BEFORE the promise
    //    settles. The new form opens with a fresh draft.
    fireEvent.click(query(page, '[data-strip-add-head]'))
    const form2 = query(page, '[data-strip-form]')
    fireEvent.change(field(form2, 'title'), { target: { value: '第二次创建（在途）' } })

    // ③ The stale submit completes late (success).
    resolvers[0]?.(OK_CREATE)

    // The ADJ-8 invalidation refetch settles — the stale success
    // callback must NOT clobber the newer form: no form close, no
    // selection hijack, no in-flight input loss.
    await waitFor(() => {
      expect(page.stub.countOf('getWorkstream')).toBeGreaterThanOrEqual(2)
      expect(page.stub.countOf('getWorkstreamCurrent')).toBeGreaterThanOrEqual(2)
    })
    await waitFor(() => {
      const form = query(page, '[data-strip-form]')
      expect((field(form, 'title') as HTMLInputElement).value).toBe('第二次创建（在途）')
    })
    expect(page.container.querySelectorAll('[data-strip-form]').length).toBe(1)
    expect(page.container.querySelectorAll('[data-strip-edit]').length).toBe(0)
  })

  it('a stale FAULT does not stamp the newer form either', async () => {
    const page = await mountPage()
    // Resolver held in an array (not a `let … = null`): TS does not
    // reset the outer-scope `null` narrowing for a closure assignment,
    // which would make `resolveCreate?.()` a `never` call.
    const resolvers: ((value: unknown) => void)[] = []
    page.stub.set('createPlanItem', new Promise(resolve => { resolvers.push(resolve) }))

    fireEvent.click(query(page, '[data-strip-add-head]'))
    const form1 = query(page, '[data-strip-form]')
    fireEvent.change(field(form1, 'title'), { target: { value: '第一次创建' } })
    fireEvent.change(field(form1, 'goal'), { target: { value: '第一个目标' } })
    fireEvent.click(query(page, '[data-strip-form-save]'))

    fireEvent.click(query(page, '[data-strip-add-head]'))
    const form2 = query(page, '[data-strip-form]')
    fireEvent.change(field(form2, 'title'), { target: { value: '第二次创建（在途）' } })

    resolvers[0]?.({
      ok: false,
      error: { code: 'DUPLICATE_KEY', message: '重复键' },
    })

    await waitFor(() => {
      const form = query(page, '[data-strip-form]')
      expect((field(form, 'title') as HTMLInputElement).value).toBe('第二次创建（在途）')
    })
    // The stale fault message must not surface on the newer form.
    expect(form2.textContent).not.toContain('重复键')
  })

  it('the normal path is unchanged: an un-replaced success closes the form', async () => {
    const page = await mountPage()
    // Resolver held in an array (not a `let … = null`): TS does not
    // reset the outer-scope `null` narrowing for a closure assignment,
    // which would make `resolveCreate?.()` a `never` call.
    const resolvers: ((value: unknown) => void)[] = []
    page.stub.set('createPlanItem', new Promise(resolve => { resolvers.push(resolve) }))

    fireEvent.click(query(page, '[data-strip-add-head]'))
    const form = query(page, '[data-strip-form]')
    fireEvent.change(field(form, 'title'), { target: { value: '基线实验' } })
    fireEvent.change(field(form, 'goal'), { target: { value: '验证基线' } })
    fireEvent.click(query(page, '[data-strip-form-save]'))
    expect(page.stub.countOf('createPlanItem')).toBe(1)

    resolvers[0]?.(OK_CREATE)

    // No newer form lifecycle event → the success applies: the create
    // form closes (the selection targets the host-confirmed id; the
    // stub plan does not contain it, so no edit form renders).
    await waitFor(() => {
      expect(page.container.querySelectorAll('[data-strip-form]').length).toBe(0)
    })
    expect(page.stub.countOf('getWorkstream')).toBeGreaterThanOrEqual(2)
  })
})
