/**
 * @vitest-environment jsdom
 *
 * WP-4.5 — TC-PERF-006 half:「图渲染懒加载 — 大 plan/topology 只渲染
 * viewport（节点数断言）」.
 *
 * Two halves, both honest under the mocked-canvas regime:
 *  1. CONFIG VERIFICATION — the views pass `onlyRenderVisibleElements`
 *     (React Flow's built-in viewport virtualization) through to the
 *     canvas (read from the recorded mock props);
 *  2. NODE-COUNT ASSERTION — the mock EMULATES the culling contract
 *     (anchor point inside the emulated pane, see xyflow-mock.ts): for a
 *     400-item plan / 200-workstream topology, the DOM receives only the
 *     viewport window of nodes, while the FULL graph data still reaches
 *     the canvas props (pan/zoom into it renders the rest). The expected
 *     counts are computed from the documented emulation rule + the model
 *     layout constants.
 */

import './xyflow-mock.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { PlanGraphView } from '../../src/client/graph/PlanGraphView.js'
import { TopologyGraphView } from '../../src/client/graph/TopologyGraphView.js'
import { planToGraph } from '../../src/client/graph/plan-model.js'
import { topologyToGraph } from '../../src/client/graph/topology-model.js'
import { item, pf, topicSnapshot, wsCard, wsSnapshot } from './fixtures.js'
import { XYFLOW_MOCK } from './xyflow-mock.js'

/** 400 canonical items (G/T/M alternating) + one OPEN 3-item proposal. */
function bigPlanSnapshot() {
  const items = Array.from({ length: 400 }, (_, i) =>
    item(`T-${i + 1}`, (['TASK', 'GATE', 'MILESTONE'] as const)[i % 3], `Item ${i + 1}`),
  )
  return wsSnapshot(items, [pf('PF-1', 'OPEN', 'T-10', 'T-110', 3)])
}

/** A 200-workstream realized chain (WS-1 → … → WS-200). */
function bigTopicSnapshot() {
  const cards = Array.from({ length: 200 }, (_, i) => wsCard(`WS-${i + 1}`))
  const edges = Array.from({ length: 199 }, (_, i) => ({
    id: `TE-${i + 1}`,
    operation: 'FORK' as const,
    lifecycle: 'PLANNED' as const,
    inputs: [`WS-${i + 1}`],
    outputs: [`WS-${i + 2}`],
    note: null,
  }))
  return topicSnapshot(cards, edges)
}

beforeEach(() => { XYFLOW_MOCK.reset() })
afterEach(cleanup)

describe('TC-PERF-006: PlanGraph viewport virtualization', () => {
  it('projects the full 403-node graph (data completeness)', () => {
    const graph = planToGraph(bigPlanSnapshot())
    expect(graph.nodes.length).toBe(403) // 400 canonical + 3 ghosts
    expect(graph.edges.length).toBe(403) // 399 canonical + 4 fork
  })

  it('passes onlyRenderVisibleElements=true and culls the DOM to the viewport window (4 of 403)', () => {
    const graph = planToGraph(bigPlanSnapshot())
    const forks = bigPlanSnapshot().future.planForks
    const utils = render(
      <PlanGraphView
        graph={graph}
        forks={forks}
        unresolvedCount={forks.length}
        onSelectFork={() => undefined}
        onDismissFork={() => undefined}
      />,
    )
    const root = utils.container.querySelector('[data-mock-flow]') as HTMLElement
    // ① config verification: the virtualization flag reached the canvas.
    expect(root.getAttribute('data-mock-only-render-visible')).toBe('true')
    // ② the FULL data still reaches the canvas (pan/zoom renders more).
    expect(root.getAttribute('data-mock-node-count')).toBe('403')
    // ③ node-count assertion under the documented culling rule:
    //    canonical i visible ⇔ i·stride ≤ 1200 → i ∈ {0,1,2,3}; the ghost
    //    branch (slots 10..12, x ≥ 3200) is entirely outside the pane.
    const rendered = utils.container.querySelectorAll('[data-mock-node]').length
    expect(rendered).toBe(4)
    expect(rendered).toBeLessThan((403 * 1) / 10) // <10% of the graph in the DOM
  })

  it('renders the WHOLE graph when virtualization is off (403 DOM nodes)', () => {
    const graph = planToGraph(bigPlanSnapshot())
    const forks = bigPlanSnapshot().future.planForks
    const props = {
      graph,
      forks,
      unresolvedCount: forks.length,
      onSelectFork: () => undefined,
      onDismissFork: () => undefined,
    }
    const utils = render(<PlanGraphView virtualize={false} {...props} />)
    const root = utils.container.querySelector('[data-mock-flow]') as HTMLElement
    expect(root.getAttribute('data-mock-only-render-visible')).toBe('false')
    expect(utils.container.querySelectorAll('[data-mock-node]').length).toBe(403)
  })

  it('the culling follows the pane (bigger window → more DOM nodes)', () => {
    const graph = planToGraph(bigPlanSnapshot())
    const forks = bigPlanSnapshot().future.planForks
    // 100000-wide pane: canonical i visible ⇔ i·320 ≤ 100000 → i ≤ 312
    // (313 items) + all 3 ghosts (x ≤ 3840) = 316.
    XYFLOW_MOCK.pane = { width: 100000, height: 100000 }
    const utils = render(
      <PlanGraphView
        graph={graph}
        forks={forks}
        unresolvedCount={forks.length}
        onSelectFork={() => undefined}
        onDismissFork={() => undefined}
      />,
    )
    expect(utils.container.querySelectorAll('[data-mock-node]').length).toBe(316)
    // A pane past the last node (max x = 399·320 = 127680) renders all 403.
    XYFLOW_MOCK.pane = { width: 1000000, height: 1000000 }
    const utils2 = render(
      <PlanGraphView
        graph={graph}
        forks={forks}
        unresolvedCount={forks.length}
        onSelectFork={() => undefined}
        onDismissFork={() => undefined}
      />,
    )
    expect(utils2.container.querySelectorAll('[data-mock-node]').length).toBe(403)
  })
})

describe('TC-PERF-006: TopologyGraph viewport virtualization', () => {
  it('culls a 200-workstream chain to its viewport window (4 of 200 nodes, 199 edges in the data)', () => {
    const graph = topologyToGraph(bigTopicSnapshot())
    expect(graph.nodes.length).toBe(200)
    expect(graph.edges.length).toBe(199)
    const utils = render(<TopologyGraphView graph={graph} />)
    const root = utils.container.querySelector('[data-mock-flow]') as HTMLElement
    expect(root.getAttribute('data-mock-only-render-visible')).toBe('true')
    expect(root.getAttribute('data-mock-node-count')).toBe('200')
    // column c visible ⇔ origin + c·columnStride ≤ 1200 → c ∈ {0,1,2,3}
    // (60, 380, 700, 1020; the 4th step lands at 1340 > 1200).
    const rendered = utils.container.querySelectorAll('[data-mock-node]').length
    expect(rendered).toBe(4)
    expect(rendered).toBeLessThan(20)
  })
})
