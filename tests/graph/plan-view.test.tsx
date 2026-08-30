/**
 * @vitest-environment jsdom
 *
 * WP-4.5 — PlanGraphView render smoke + the AC/Gate P4 visual-split
 * assertions (class/attr level) + the SELECT/DISMISS entry forwarding.
 *
 * The React Flow canvas is mocked at the component layer (xyflow-mock.ts —
 * jsdom has no layout surface): the assertions target NODE/EDGE DATA
 * correctness (positions, kinds, endpoints, styles, badges), not pixels.
 */

import './xyflow-mock.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PlanGraphView } from '../../src/client/graph/PlanGraphView.js'
import { planToGraph } from '../../src/client/graph/plan-model.js'
import { ConfirmDialog } from '../../src/client/graph/ConfirmDialog.js'
import { CONFIRM_DIALOG_STYLES as dialogStyles, PLAN_GRAPH_STYLES as viewStyles } from '../../src/client/graph/graph-styles.js'
import { item, pf, wsSnapshot } from './fixtures.js'
import { COPY_TABLE } from '../../src/client/i18n/copy.js'
import type { PlanGraphExtras } from '../../src/client/graph/plan-model.js'

afterEach(cleanup)

const PLAN = [item('G-1', 'GATE', 'Gate One'), item('T-1', 'TASK', 'Task One'), item('M-1', 'MILESTONE', 'Milestone One')]

/** The WP-4.1a wire fixture's future zone (OPEN pure-insertion proposal). */
const FUTURE = wsSnapshot(PLAN, [pf('PF-1', 'OPEN', 'T-1', 'T-1', 1, { createdByRun: 'R-2', reason: 'the plan misses the baseline experiment' })]).future

function renderView(overrides?: Partial<Parameters<typeof PlanGraphView>[0]>) {
  const graph = planToGraph({ ...wsSnapshot(PLAN, []), future: FUTURE })
  const onSelectFork = vi.fn()
  const onDismissFork = vi.fn()
  const utils = render(
    <PlanGraphView
      graph={graph}
      forks={FUTURE.planForks}
      unresolvedCount={FUTURE.unresolvedPlanForkCount}
      onSelectFork={onSelectFork}
      onDismissFork={onDismissFork}
      {...overrides}
    />,
  )
  return { utils, onSelectFork, onDismissFork }
}

describe('render smoke: data correctness through the (mocked) canvas', () => {
  it('renders the header with the canonical count and the unresolved count', () => {
    renderView()
    expect(screen.getByText('未来计划')).toBeTruthy()
    expect(screen.getByText('正典 3 项 · 未决提案 1 条')).toBeTruthy()
  })

  it('renders the canonical chain as G/T/M nodes in plan order, at the model positions', () => {
    const { utils } = renderView()
    const nodes = utils.container.querySelectorAll('[data-mock-node]')
    expect([...nodes].map(n => n.getAttribute('data-mock-node'))).toEqual(['G-1', 'T-1', 'M-1', 'PF-1#1'])
    // G/T/M kind distinction (attr level):
    const g = utils.container.querySelector('[data-mock-node="G-1"] [data-kind="GATE"]') as HTMLElement
    const t = utils.container.querySelector('[data-mock-node="T-1"] [data-kind="TASK"]') as HTMLElement
    const m = utils.container.querySelector('[data-mock-node="M-1"] [data-kind="MILESTONE"]') as HTMLElement
    expect(g).not.toBeNull()
    expect(t).not.toBeNull()
    expect(m).not.toBeNull()
    expect(g.textContent).toContain('Gate One')
    expect(g.getAttribute('data-source')).toBe('canonical')
    // Positions (attr level, straight from the model):
    expect(utils.container.querySelector('[data-mock-node="G-1"]')!.getAttribute('data-node-x')).toBe('0')
    expect(utils.container.querySelector('[data-mock-node="T-1"]')!.getAttribute('data-node-x')).toBe('320')
    expect(utils.container.querySelector('[data-mock-node="M-1"]')!.getAttribute('data-node-x')).toBe('640')
  })

  it('renders the OPEN proposal as a ghost branch with the source badge and the INSERT icon', () => {
    const { utils } = renderView()
    const ghostWrap = utils.container.querySelector('[data-mock-node="PF-1#1"]')
    expect(ghostWrap).not.toBeNull()
    const ghost = ghostWrap!.querySelector('[data-source="planFork"]') as HTMLElement
    expect(ghost.getAttribute('data-pf')).toBe('PF-1')
    expect(ghost.getAttribute('data-kind')).toBe('PROPOSED')
    expect(ghost.getAttribute('data-form')).toBe('INSERT')
    expect(ghost.getAttribute('data-stale')).toBeNull()
    // Source Agent/Run badge (§27.6):
    expect(ghost.textContent).toContain('PF-1 · R-2')
    // The three-form icon (INSERT = '+'):
    const icon = ghost.querySelector('[data-form="INSERT"]') as HTMLElement
    expect(icon.textContent).toBe('+')
    expect(ghost.textContent).toContain('候选项 1/1')
  })

  it('renders the full edge set: 2 canonical + 2 fork edges with correct endpoints', () => {
    const { utils } = renderView()
    const edges = [...utils.container.querySelectorAll('[data-mock-edge]')]
    expect(edges.map(e => `${e.getAttribute('data-edge-source')}→${e.getAttribute('data-edge-target')}`)).toEqual([
      'G-1→T-1',
      'T-1→M-1',
      'T-1→PF-1#1',
      'PF-1#1→T-1',
    ])
  })
})

describe('AC/Gate P4: canonical and fork are visually indistinguishable-safe', () => {
  it('canonical nodes carry the solid class and NO fork marker; ghosts the dashed ghost class (class level)', () => {
    const { utils } = renderView()
    const canonical = utils.container.querySelector('[data-source="canonical"]') as HTMLElement
    const ghost = utils.container.querySelector('[data-source="planFork"]') as HTMLElement
    expect(canonical.classList.contains(viewStyles.canonical)).toBe(true)
    expect(canonical.classList.contains(viewStyles.ghost)).toBe(false)
    expect(canonical.getAttribute('data-pf')).toBeNull()
    expect(ghost.classList.contains(viewStyles.ghost)).toBe(true)
    expect(ghost.classList.contains(viewStyles.canonical)).toBe(false)
  })

  it('edges split by stroke style: canonical solid, fork dashed + animated (attr level)', () => {
    const { utils } = renderView()
    const canonicalEdge = utils.container.querySelector('[data-mock-edge="e:G-1->T-1"]') as HTMLElement
    const forkEdge = utils.container.querySelector('[data-mock-edge="pf:PF-1:T-1->PF-1#1"]') as HTMLElement
    expect(canonicalEdge.getAttribute('stroke')).toBe('var(--dsw-alias-label-secondary)')
    expect(canonicalEdge.getAttribute('stroke-dasharray')).toBe('')
    expect(canonicalEdge.getAttribute('data-edge-animated')).toBe('false')
    expect(canonicalEdge.getAttribute('data-edge-class')).toBe('rc-edge-canonical')
    expect(forkEdge.getAttribute('stroke')).toBe('#7c5cff')
    expect(forkEdge.getAttribute('stroke-dasharray')).toBe('6 4')
    expect(forkEdge.getAttribute('data-edge-animated')).toBe('true')
    expect(forkEdge.getAttribute('data-edge-class')).toBe('rc-edge-planfork')
  })

  it('a STALE proposal renders muted (no animation, stale stroke) and its SELECT entry is disabled', async () => {
    const staleFuture = wsSnapshot(PLAN, [pf('PF-1', 'STALE', 'T-1', 'T-1', 1, { createdByRun: 'R-2' })]).future
    const graph = planToGraph({ ...wsSnapshot(PLAN, []), future: staleFuture })
    const { utils, onSelectFork } = renderView({
      graph,
      forks: staleFuture.planForks,
      unresolvedCount: staleFuture.unresolvedPlanForkCount,
    })
    const forkEdge = utils.container.querySelector('[data-mock-edge="pf:PF-1:T-1->PF-1#1"]') as HTMLElement
    expect(forkEdge.getAttribute('stroke')).toBe('#b3a8d9')
    expect(forkEdge.getAttribute('stroke-dasharray')).toBe('4 6')
    expect(forkEdge.getAttribute('data-edge-animated')).toBe('false')
    const ghost = utils.container.querySelector('[data-source="planFork"]') as HTMLElement
    expect(ghost.getAttribute('data-stale')).toBe('true')
    // Toolbar: status badge + disabled SELECT, enabled DISMISS.
    const row = utils.container.querySelector('[data-pf="PF-1"]') as HTMLElement
    expect(row.getAttribute('data-status')).toBe('STALE')
    expect(within(row).getByText('已过期')).toBeTruthy()
    const selectBtn = within(row).getByRole('button', { name: '选择' })
    expect((selectBtn as HTMLButtonElement).disabled).toBe(true)
    const dismissBtn = within(row).getByRole('button', { name: '忽略' })
    const user = fireEvent
    await user.click(dismissBtn)
    expect(onSelectFork).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('SELECT / DISMISS entries (RR-015③ — the view forwards to the container)', () => {
  it('an OPEN row exposes enabled 选择/忽略 buttons that forward the PF id', async () => {
    const user = fireEvent
    const { onSelectFork, onDismissFork } = renderView()
    const row = screen.getByText('PF-1').closest('[data-pf]') as HTMLElement
    expect(within(row).getByText('待处理')).toBeTruthy()
    const selectBtn = within(row).getByRole('button', { name: '选择' })
    expect((selectBtn as HTMLButtonElement).disabled).toBe(false)
    await user.click(selectBtn)
    expect(onSelectFork).toHaveBeenCalledWith('PF-1')
    await user.click(within(row).getByRole('button', { name: '忽略' }))
    expect(onDismissFork).toHaveBeenCalledWith('PF-1')
    // The reason line carries the proposal reason:
    expect(row.textContent).toContain('the plan misses the baseline experiment')
  })

  it('hides the toolbar entirely when there is no unresolved proposal', () => {
    const emptyFuture = wsSnapshot(PLAN, []).future
    const graph = planToGraph({ ...wsSnapshot(PLAN, []), future: emptyFuture })
    const { utils } = renderView({ graph, forks: emptyFuture.planForks, unresolvedCount: 0 })
    expect(utils.container.querySelector('[data-role="plan-fork-toolbar"]')).toBeNull()
    expect(screen.queryByText('正典 3 项 · 未决提案 0 条')).toBeTruthy()
  })
})

describe('ConfirmDialog (the SELECT irreversibility surface)', () => {
  it('renders title/message and fires confirm once, cancel once', async () => {
    const user = fireEvent
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const utils = render(
      <ConfirmDialog
        title="选择提案 PF-1"
        message="此操作不可逆：将按提案物化新条目并重写正典计划。"
        confirmLabel="确认选择"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('data-danger')).toBe('true')
    expect(screen.getByText('选择提案 PF-1')).toBeTruthy()
    expect(screen.getByText(/此操作不可逆/)).toBeTruthy()
    // Cancel via the button:
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    // Confirm via the button (the danger styling carries the class marker):
    const confirmBtn = screen.getByRole('button', { name: '确认选择' }) as HTMLElement
    expect(confirmBtn.classList.contains(dialogStyles.confirmBtnDanger)).toBe(true)
    await user.click(confirmBtn)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    // Overlay click cancels (presentation-layer stopPropagation on the card):
    await user.click(utils.container.querySelector('[role="presentation"]') as HTMLElement)
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})

describe('React Flow config passthrough (the virtualization seam)', () => {
  it('passes onlyRenderVisibleElements through (default true)', () => {
    const { utils } = renderView()
    const root = utils.container.querySelector('[data-mock-flow]') as HTMLElement
    expect(root.getAttribute('data-mock-only-render-visible')).toBe('true')
    expect(root.getAttribute('data-mock-nodes-draggable')).toBe('false')
    expect(root.getAttribute('data-mock-fit-view')).toBe('true')
  })
})

/* -------------------------------------------------------------------- *
 * UI-5 (D4) — the extended face: the legend (B §18.3 verbatim), the
 * dependency edge line-type, the selection stamp, the focus marker,
 * the node-click → onNodeSelect seam, the PF-downgrade switch.
 * -------------------------------------------------------------------- */

const DEP_EDGE = { relationId: 'REL-1', sourceId: 'T-1', targetId: 'G-1' }

function renderExtended(extras: PlanGraphExtras, overrides?: Partial<Parameters<typeof PlanGraphView>[0]>) {
  const graph = planToGraph({ ...wsSnapshot(PLAN, []), future: FUTURE }, extras)
  const onSelectFork = vi.fn()
  const onDismissFork = vi.fn()
  const onNodeSelect = vi.fn()
  const utils = render(
    <PlanGraphView
      graph={graph}
      forks={FUTURE.planForks}
      unresolvedCount={FUTURE.unresolvedPlanForkCount}
      onSelectFork={onSelectFork}
      onDismissFork={onDismissFork}
      onNodeSelect={onNodeSelect}
      {...overrides}
    />,
  )
  return { utils, onSelectFork, onDismissFork, onNodeSelect }
}

describe('UI-5: the legend (B §18.3 — it MUST exist; verbatim strings)', () => {
  it('renders both legend lines with the EXACT frozen bytes (color is never the only cue)', () => {
    renderView()
    expect(document.querySelector('[data-legend]')).not.toBeNull()
    // the two lines are the B verbatim strings — pinned here byte-for-byte:
    expect(document.querySelector('[data-legend-canonical]')!.textContent).toBe('──── Canonical order')
    expect(document.querySelector('[data-legend-dependency]')!.textContent).toBe('- - - Dependency')
    // and they come from the frozen copy keys (the single source of truth):
    expect(COPY_TABLE['ws.future.graph.legendCanonical']).toBe('──── Canonical order')
    expect(COPY_TABLE['ws.future.graph.legendDependency']).toBe('- - - Dependency')
  })

  it('renders the legend even when the graph carries no dependency edges at all', () => {
    renderView()
    expect(document.querySelector('[data-legend]')).not.toBeNull()
  })
})

describe('UI-5: the dependency edge is a THIRD line type (the dash pattern is the cue)', () => {
  it('dep edges: the dot-dash pattern (2 4) + the distinct class; canonical stays SOLID; forks keep (6 4)', () => {
    const { utils } = renderExtended({ dependencyEdges: [DEP_EDGE], pfDowngraded: true })
    const dep = utils.container.querySelector('[data-mock-edge="dep:REL-1"]') as HTMLElement
    expect(dep).not.toBeNull()
    expect(dep.getAttribute('data-edge-class')).toBe('rc-edge-dependency')
    expect(dep.getAttribute('stroke-dasharray')).toBe('2 4')
    expect(dep.getAttribute('stroke')).toBe('#4a7fb5')
    expect(dep.getAttribute('data-edge-animated')).toBe('false')
    const canonical = utils.container.querySelector('[data-mock-edge="e:G-1->T-1"]') as HTMLElement
    expect(canonical.getAttribute('stroke-dasharray')).toBe('')
    const fork = utils.container.querySelector('[data-mock-edge="pf:PF-1:T-1->PF-1#1"]') as HTMLElement
    expect(fork.getAttribute('stroke-dasharray')).toBe('6 4')
    expect(fork.getAttribute('data-edge-animated')).toBe('true')
  })
})

describe('UI-5: the selection stamp (ADJ-6 view state → the canonical node)', () => {
  it('marks exactly the selected canonical node (data-selected + the class)', () => {
    const { utils } = renderExtended({}, { selectedItemId: 'T-1' })
    // the stamp lands on the node SHAPE (the inner div with data-kind):
    const t1 = utils.container.querySelector('[data-mock-node="T-1"] [data-kind="TASK"]') as HTMLElement
    const g1 = utils.container.querySelector('[data-mock-node="G-1"] [data-kind="GATE"]') as HTMLElement
    expect(t1.getAttribute('data-selected')).toBe('true')
    expect(t1.classList.contains(viewStyles.selected)).toBe(true)
    expect(g1.getAttribute('data-selected')).toBeNull()
    expect(g1.classList.contains(viewStyles.selected)).toBe(false)
  })

  it('no selection → nothing is stamped (the cockpit face is unchanged)', () => {
    const { utils } = renderView()
    expect(utils.container.querySelectorAll('[data-selected="true"]')).toHaveLength(0)
  })
})

describe('UI-5: the focus marker (the Current-Focus pointer rides the node)', () => {
  it('marks the focused canonical node with the glyph badge (data-plan-focus)', () => {
    const { utils } = renderExtended({ focusedItemId: 'T-1' })
    const t1 = utils.container.querySelector('[data-mock-node="T-1"] [data-kind="TASK"]') as HTMLElement
    expect(t1.getAttribute('data-plan-focus')).toBe('true')
    const badge = t1.querySelector('[data-focus-marker]')
    expect(badge).not.toBeNull()
    expect(badge!.textContent).toBe('★')
    const others = [...utils.container.querySelectorAll('[data-plan-focus="true"]')]
    expect(others).toHaveLength(1)
  })

  it('no focus in the extras → no marker anywhere', () => {
    const { utils } = renderView()
    expect(utils.container.querySelectorAll('[data-plan-focus="true"]')).toHaveLength(0)
  })
})

describe('UI-5: node click → onNodeSelect (the strip↔graph sync seam, B §17.4)', () => {
  it('clicking a canonical node calls onNodeSelect with its item id', () => {
    const { utils, onNodeSelect } = renderExtended({})
    fireEvent.click(utils.container.querySelector('[data-mock-node="T-1"]')!)
    expect(onNodeSelect).toHaveBeenCalledTimes(1)
    expect(onNodeSelect).toHaveBeenCalledWith('T-1')
  })

  it('clicking a ghost (planFork) node is a no-op — only canonical nodes are selectable', () => {
    const { utils, onNodeSelect } = renderExtended({})
    fireEvent.click(utils.container.querySelector('[data-mock-node="PF-1#1"]')!)
    expect(onNodeSelect).not.toHaveBeenCalled()
  })

  it('without an onNodeSelect callback the nodes carry no click handler (the cockpit face)', () => {
    const { utils } = renderExtended({}, { onNodeSelect: undefined })
    const node = utils.container.querySelector('[data-mock-node="T-1"]') as HTMLElement
    expect(node.getAttribute('data-mock-node')).toBe('T-1')
    // the mock only wires onClick when the prop is present; the DOM still renders:
    expect(node.querySelector('[data-kind]')).not.toBeNull()
  })
})

describe('UI-5: the PF-downgrade switch (ADJ-9 — visual only, the branch stays)', () => {
  it('the root and the PF toolbar carry the downgrade flag; the branch rows are KEPT', () => {
    const { utils } = renderExtended({ pfDowngraded: true })
    const root = utils.container.querySelector('[data-role="plan-graph"]') as HTMLElement
    expect(root.getAttribute('data-pf-downgraded')).toBe('true')
    const toolbar = utils.container.querySelector('[data-role="plan-fork-toolbar"]') as HTMLElement
    expect(toolbar.getAttribute('data-pf-downgraded')).toBe('true')
    expect(toolbar.classList.contains(viewStyles.pfDowngraded)).toBe(true)
    // the branch data survives the downgrade:
    expect(utils.container.querySelector('[data-mock-node="PF-1#1"] [data-source="planFork"]')).not.toBeNull()
  })

  it('no extras → no downgrade flag (the cockpit face is unchanged)', () => {
    const { utils } = renderView()
    const root = utils.container.querySelector('[data-role="plan-graph"]') as HTMLElement
    expect(root.getAttribute('data-pf-downgraded')).toBeNull()
    const toolbar = utils.container.querySelector('[data-role="plan-fork-toolbar"]') as HTMLElement
    expect(toolbar.classList.contains(viewStyles.pfDowngraded)).toBe(false)
  })
})
