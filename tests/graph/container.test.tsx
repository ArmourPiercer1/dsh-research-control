/**
 * @vitest-environment jsdom
 *
 * WP-4.5 — container-layer tests: PlanGraphContainer + TopologyGraph
 * Container against the REAL store (createResearchStore) with a stub RPC
 * facade (tests/stores/stub-rpc.ts):
 *  - the lazy slice load fires on mount (idle → loading → ready);
 *  - the SELECT confirmation flow (RR-015③): button → confirmation dialog
 *    with the explicit irreversibility statement → confirm calls
 *    `selectPlanFork` once with the PF id → the store's invalidate
 *    registry refetches the workstream slice → the overlay re-derives
 *    from the fresh snapshot (the PF leaves the unresolved set);
 *  - cancel performs NO mutation;
 *  - DISMISS confirms more lightly and calls `dismissPlanFork`;
 *  - business faults (ok:false) and transport faults surface as the
 *    user-visible 操作失败 banner (the dialog closes, no crash);
 *  - the TopologyGraphContainer binds the topic slice the same way.
 */

import './xyflow-mock.js'
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach } from 'vitest'
import { createResearchStore } from '../../src/client/stores/index.js'
import { PlanGraphContainer } from '../../src/client/graph/PlanGraphContainer.js'
import { TopologyGraphContainer } from '../../src/client/graph/TopologyGraphContainer.js'
import { makeStubRpc } from '../stores/stub-rpc.js'
import { item, pf, topicSnapshot, wsCard, wsSnapshot } from './fixtures.js'

afterEach(cleanup)

const PLAN = [item('G-1', 'GATE', 'Gate One'), item('T-1', 'TASK', 'Task One'), item('M-1', 'MILESTONE', 'Milestone One')]

/** The initial future zone: one OPEN pure-insertion proposal. */
function openPfSnapshot() {
  return wsSnapshot(PLAN, [pf('PF-1', 'OPEN', 'T-1', 'T-1', 1, { createdByRun: 'R-2' })])
}

/** The post-SELECT snapshot: the proposal is terminal (leaves the zone). */
function selectedSnapshot() {
  return wsSnapshot(PLAN, [])
}

function renderPlanContainer(rpc = makeStubRpc().rpc) {
  const store = createResearchStore({ rpc })
  const utils = render(<PlanGraphContainer store={store} workstreamId="WS-1" />)
  return { store, ...utils }
}

describe('PlanGraphContainer: slice binding', () => {
  it('lazily loads the workstream slice on mount (idle → ready)', async () => {
    const rpc = makeStubRpc().rpc
    renderPlanContainer(rpc)
    // First paint: the lazy load has not resolved yet → the loading line.
    expect(screen.getByText('加载中…')).toBeTruthy()
    await screen.findByText('PF-1')
    expect(screen.getByText('正典 3 项 · 未决提案 1 条')).toBeTruthy()
  })

  it('shows the error banner (and no graph) when the first load fails with a business fault', async () => {
    const stub = makeStubRpc()
    stub.set('getWorkstream', {
      ok: false,
      error: { code: 'WS_NOT_FOUND', message: 'workstream does not exist', details: {} },
    })
    renderPlanContainer(stub.rpc)
    await screen.findByText(/加载失败/)
    expect(screen.queryByText('PF-1')).toBeNull()
  })
})

describe('PlanGraphContainer: the SELECT confirmation flow (RR-015③)', () => {
  it('select → dialog with the explicit irreversibility statement → confirm mutates exactly once and the overlay re-derives', async () => {
    const user = fireEvent
    const stub = makeStubRpc()
    // The refetch after SELECT returns the post-materialization snapshot.
    stub.set('getWorkstream', { ok: true, value: openPfSnapshot() })
    renderPlanContainer(stub.rpc)
    const row = (await screen.findByText('PF-1')).closest('[data-pf]') as HTMLElement

    // 1) the entry button opens the confirmation dialog (no mutation yet):
    await user.click(within(row).getByRole('button', { name: '选择' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.getAttribute('data-danger')).toBe('true')
    expect(within(dialog).getByText(/此操作不可逆/)).toBeTruthy()
    expect(stub.countOf('selectPlanFork')).toBe(0)

    // 2) cancel: the dialog closes, nothing was called:
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(stub.countOf('selectPlanFork')).toBe(0)

    // 3) select again and CONFIRM (the explicit step for the irreversible act):
    stub.set('getWorkstream', { ok: true, value: selectedSnapshot() })
    await user.click(within(row).getByRole('button', { name: '选择' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: '确认选择' }))

    expect(stub.callsTo('selectPlanFork')).toEqual([{ method: 'selectPlanFork', args: { planForkId: 'PF-1' } }])
    // The invalidate registry refetched the slice (initial + 1 refetch):
    expect(stub.countOf('getWorkstream')).toBe(2)
    // The overlay re-derived from the fresh snapshot: the PF row is gone.
    await waitFor(() => expect(screen.queryByText('PF-1')).toBeNull())
    expect(screen.getByText('正典 3 项 · 未决提案 0 条')).toBeTruthy()
  })

  it('a business fault on SELECT closes the dialog and shows the 操作失败 banner', async () => {
    const user = fireEvent
    const stub = makeStubRpc()
    stub.set('selectPlanFork', {
      ok: false,
      error: { code: 'PF_NOT_OPEN', message: 'PF status must be OPEN', details: {} },
    })
    renderPlanContainer(stub.rpc)
    const row = (await screen.findByText('PF-1')).closest('[data-pf]') as HTMLElement
    await user.click(within(row).getByRole('button', { name: '选择' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: '确认选择' }))
    await screen.findByText(/操作失败/)
    expect(screen.queryByRole('dialog')).toBeNull()
    // The stale-while-revalidate overlay stays visible (the slice kept data).
    expect(screen.getByText('PF-1')).toBeTruthy()
  })

  it('a transport fault on SELECT also lands on the 操作失败 banner', async () => {
    const user = fireEvent
    const stub = makeStubRpc()
    stub.set('selectPlanFork', new Error('gateway not mounted'))
    renderPlanContainer(stub.rpc)
    const row = (await screen.findByText('PF-1')).closest('[data-pf]') as HTMLElement
    await user.click(within(row).getByRole('button', { name: '选择' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: '确认选择' }))
    await screen.findByText(/操作失败：gateway not mounted/)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('PlanGraphContainer: the DISMISS confirmation flow', () => {
  it('dismiss → light confirmation → dismissPlanFork exactly once, overlay re-derives', async () => {
    const user = fireEvent
    const stub = makeStubRpc()
    renderPlanContainer(stub.rpc)
    const row = (await screen.findByText('PF-1')).closest('[data-pf]') as HTMLElement
    await user.click(within(row).getByRole('button', { name: '忽略' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.getAttribute('data-danger')).toBe('false')
    expect(within(dialog).queryByText(/此操作不可逆/)).toBeNull()
    stub.set('getWorkstream', { ok: true, value: selectedSnapshot() })
    await user.click(screen.getByRole('button', { name: '确认忽略' }))
    expect(stub.callsTo('dismissPlanFork')).toEqual([{ method: 'dismissPlanFork', args: { planForkId: 'PF-1' } }])
    stub.set('getWorkstream', { ok: true, value: selectedSnapshot() })
    await waitFor(() => expect(screen.queryByText('PF-1')).toBeNull())
  })

  it('a STALE proposal has its SELECT entry disabled (the view gates it)', async () => {
    const stub = makeStubRpc()
    stub.set('getWorkstream', {
      ok: true,
      value: wsSnapshot(PLAN, [pf('PF-1', 'STALE', 'T-1', 'T-1', 1)]),
    })
    renderPlanContainer(stub.rpc)
    const row = (await screen.findByText('PF-1')).closest('[data-pf]') as HTMLElement
    expect((within(row).getByRole('button', { name: '选择' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(row).getByText('已过期')).toBeTruthy()
  })
})

describe('TopologyGraphContainer: slice binding', () => {
  it('lazily loads the topic slice and renders the topology (incl. the orphan endpoint)', async () => {
    const rpc = makeStubRpc().rpc
    const store = createResearchStore({ rpc })
    render(<TopologyGraphContainer store={store} topicId="TPC-1" />)
    expect(screen.getByText('加载中…')).toBeTruthy()
    // The WP-4.1a TOPIC_FIXTURE: WS-1 card + TE-1 FORK planned → WS-2 (orphan).
    await screen.findByText('拓扑')
    expect(screen.getByText('2 个工作流 · 1 条路线')).toBeTruthy()
    expect(screen.getByText('Workstream One')).toBeTruthy()
    // The orphan WS-2 renders its id twice (the ws-id span + the title span).
    expect(screen.getAllByText('WS-2').length).toBe(2)
  })
})

/* -------------------------------------------------------------------- *
 * UI-5 (D4) — the extended face (the WS-page graph): the ADJ-5/ADJ-7
 * slice join (getWorkstreamCurrent += dependencyEdges, the focus slice)
 * rides the container as a lazy extra load — and the cockpit call site
 * (no `extended`) pays nothing new.
 * -------------------------------------------------------------------- */

const UI5_DEP_EDGE = { relationId: 'REL-1', sourceId: 'T-1', targetId: 'G-1' }

function renderExtended(rpc = makeStubRpc().rpc, onNodeSelect?: (id: string) => void) {
  const store = createResearchStore({ rpc })
  const utils = render(
    <PlanGraphContainer store={store} workstreamId="WS-1" extended onNodeSelect={onNodeSelect ?? vi.fn()} />,
  )
  return { store, ...utils }
}

describe('PlanGraphContainer (UI-5 extended face): the slice join', () => {
  it('fires getWorkstreamCurrent + getCurrentFocus exactly once (the lazy extra load)', async () => {
    const stub = makeStubRpc()
    renderExtended(stub.rpc)
    await screen.findByText('PF-1')
    await waitFor(() => expect(stub.countOf('getWorkstreamCurrent')).toBe(1))
    await waitFor(() => expect(stub.countOf('getCurrentFocus')).toBe(1))
    expect(stub.countOf('getWorkstream')).toBe(1)
  })

  it('carries the dependency edges from the current slice to the canvas (data-mock-edge)', async () => {
    const stub = makeStubRpc()
    stub.set('getWorkstreamCurrent', {
      ok: true,
      value: {
        workstreamId: 'WS-1',
        objectives: [],
        explicitBlockers: [],
        derivedBlockers: [],
        nextActions: [],
        interventions: [],
        dependencyEdges: [UI5_DEP_EDGE],
      },
    })
    const { container } = renderExtended(stub.rpc)
    await screen.findByText('PF-1')
    const depEdge = await waitFor(() => {
      const el = container.querySelector('[data-mock-edge="dep:REL-1"]')
      expect(el).not.toBeNull()
      return el as Element
    })
    expect(depEdge.getAttribute('data-edge-source')).toBe('T-1')
    expect(depEdge.getAttribute('data-edge-target')).toBe('G-1')
    expect(depEdge.getAttribute('data-edge-class')).toBe('rc-edge-dependency')
  })

  it('stamps the focus marker from the focus slice (the ADJ-5 pointer)', async () => {
    const stub = makeStubRpc()
    stub.set('getCurrentFocus', {
      ok: true,
      value: { workstreamId: 'WS-1', focus: { planItemId: 'T-1', updatedAt: 1755000002000 } },
    })
    const { container } = renderExtended(stub.rpc)
    await screen.findByText('PF-1')
    await waitFor(() => {
      expect(container.querySelectorAll('[data-plan-focus="true"]')).toHaveLength(1)
    })
  })

  it('is PF-downgraded by default in the extended face (ADJ-9)', async () => {
    const { container } = renderExtended()
    await screen.findByText('PF-1')
    // the downgrade flag rides the VIEW's root (the inner [data-role=
    // plan-graph]) and the PF toolbar — the container wrapper does not:
    const viewRoot = container.querySelectorAll('[data-role="plan-graph"]')[1] as HTMLElement
    expect(viewRoot.getAttribute('data-pf-downgraded')).toBe('true')
    expect(container.querySelectorAll('[data-pf-downgraded="true"]')).toHaveLength(2)
  })

  it('COCKPIT regression: the non-extended face fires NO current/focus loads (the mount cost is unchanged)', async () => {
    const stub = makeStubRpc()
    renderPlanContainer(stub.rpc)
    await screen.findByText('PF-1')
    expect(stub.countOf('getWorkstreamCurrent')).toBe(0)
    expect(stub.countOf('getCurrentFocus')).toBe(0)
  })
})
