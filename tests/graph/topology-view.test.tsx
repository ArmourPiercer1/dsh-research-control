/**
 * @vitest-environment jsdom
 *
 * WP-4.5 — TopologyGraphView render smoke + the §27.5 rendering
 * conventions (realized solid / planned dashed / dropped hidden-by-default
 * / planned Workstream dimmed / merge-contract badge / FORK vs MERGE form
 * split). React Flow is mocked at the component layer (xyflow-mock.ts).
 */

import './xyflow-mock.js'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TopologyGraphView } from '../../src/client/graph/TopologyGraphView.js'
import { topologyToGraph, type TopologyGraphData } from '../../src/client/graph/topology-model.js'
import { TOPOLOGY_GRAPH_STYLES as viewStyles } from '../../src/client/graph/graph-styles.js'
import { COPY_TABLE } from '../../src/client/i18n/copy.js'
import { topicSnapshot, wsCard } from './fixtures.js'
import type { TopicSnapshot } from '../../src/shared/rpc-contracts.js'

afterEach(cleanup)

/** A topic: WS-1 →(FORK planned)→ WS-2, (WS-1, WS-2) →(MERGE realized, contract)→ WS-3, plus a DROPPED fork. */
function fixtureSnapshot(): TopicSnapshot {
  return topicSnapshot(
    [
      wsCard('WS-1', { title: 'Alpha', lifecycle: 'REALIZED' }),
      wsCard('WS-2', { title: 'Beta', lifecycle: 'PLANNED', openPlanForkCount: 1 }),
      wsCard('WS-3', { title: 'Gamma', lifecycle: 'REALIZED' }),
    ],
    [
      { id: 'TE-1', operation: 'FORK', lifecycle: 'PLANNED', inputs: ['WS-1'], outputs: ['WS-2'], note: null },
      { id: 'TE-2', operation: 'MERGE', lifecycle: 'REALIZED', inputs: ['WS-1', 'WS-2'], outputs: ['WS-3'], note: null },
      { id: 'TE-3', operation: 'FORK', lifecycle: 'DROPPED', inputs: ['WS-1'], outputs: ['WS-3'], note: 'superseded route' },
    ],
    [{ edgeId: 'TE-2', path: 'merges/TE-2/contract.md' }],
  )
}

function renderGraph(graph?: TopologyGraphData) {
  const g = graph ?? topologyToGraph(fixtureSnapshot())
  const utils = render(<TopologyGraphView graph={g} />)
  return { utils }
}

describe('render smoke: nodes and the directed edge set', () => {
  it('renders one node per Workstream card with lifecycle + counts', () => {
    const { utils } = renderGraph()
    const alpha = utils.container.querySelector('[data-workstream="WS-1"]') as HTMLElement
    expect(alpha.getAttribute('data-lifecycle')).toBe('REALIZED')
    expect(alpha.textContent).toContain('Alpha')
    const beta = utils.container.querySelector('[data-workstream="WS-2"]') as HTMLElement
    expect(beta.textContent).toContain('规划中')
    expect(beta.textContent).toContain('提案 1')
    expect(utils.container.querySelector('[data-workstream="WS-3"]')).not.toBeNull()
    expect(screen.getByText('3 个工作流 · 4 条路线')).toBeTruthy()
  })

  it('expands multi-input MERGE into one edge per pair (RELY direction: input→output)', () => {
    const { utils } = renderGraph()
    const mergeEdges = [...utils.container.querySelectorAll('[data-mock-edge]')].filter(
      e => e.getAttribute('data-edge-target') === 'WS-3' && (e.getAttribute('data-edge-class') ?? '').includes('merge'),
    )
    expect(mergeEdges.map(e => e.getAttribute('data-edge-source')).sort()).toEqual(['WS-1', 'WS-2'])
  })
})

describe('§27.5 conventions: stroke by lifecycle, form by operation', () => {
  it('realized edges are solid; planned edges dashed', () => {
    const { utils } = renderGraph()
    const realized = utils.container.querySelector('[data-mock-edge="TE-2:WS-1->WS-3"]') as HTMLElement
    const planned = utils.container.querySelector('[data-mock-edge="TE-1:WS-1->WS-2"]') as HTMLElement
    expect(realized.getAttribute('stroke')).toBe('var(--dsw-alias-state-success-primary)')
    expect(realized.getAttribute('stroke-dasharray')).toBe('')
    expect(planned.getAttribute('stroke')).toBe('var(--dsw-static-blue-400)')
    expect(planned.getAttribute('stroke-dasharray')).toBe('6 4')
  })

  it('FORK and MERGE carry distinct markers (open vs filled — the form split)', () => {
    const { utils } = renderGraph()
    const marker = (id: string) => (utils.container.querySelector(`[data-mock-edge="${id}"]`) as HTMLElement).getAttribute('data-edge-marker-end')
    expect(marker('TE-1:WS-1->WS-2')).toBe('arrow') // FORK: open
    expect(marker('TE-2:WS-1->WS-3')).toBe('arrowclosed') // MERGE: filled
    expect(marker('TE-2:WS-2->WS-3')).toBe('arrowclosed')
  })

  it('the merge-contract badge renders on contract edges and the merge output node', () => {
    const { utils } = renderGraph()
    const labeled = utils.container.querySelectorAll('[data-mock-edge-label]')
    expect(labeled.length).toBe(2) // one label per TE-2 pair
    for (const label of labeled) expect(label.textContent).toBe('合并契约')
    const gamma = utils.container.querySelector('[data-workstream="WS-3"]') as HTMLElement
    expect(gamma.getAttribute('data-merge-contract')).toBe('true')
    expect(gamma.textContent).toContain('合并契约')
    const alpha = utils.container.querySelector('[data-workstream="WS-1"]') as HTMLElement
    expect(alpha.getAttribute('data-merge-contract')).toBeNull()
  })
})

describe('§27.5: dropped hidden by default, history mode via the toggle', () => {
  it('hides DROPPED edges by default (3 of 4 rendered)', () => {
    const { utils } = renderGraph()
    const edges = utils.container.querySelectorAll('[data-mock-edge]')
    expect([...edges].map(e => e.getAttribute('data-mock-edge'))).toEqual([
      'TE-1:WS-1->WS-2',
      'TE-2:WS-1->WS-3',
      'TE-2:WS-2->WS-3',
    ])
    const toggle = screen.getByRole('button', { name: '显示已弃用' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('the history-mode toggle reveals dropped edges (dashed + muted) and flips the label', async () => {
    const user = fireEvent
    const { utils } = renderGraph()
    const toggle = screen.getByRole('button', { name: '显示已弃用' })
    await user.click(toggle)
    const edges = utils.container.querySelectorAll('[data-mock-edge]')
    expect(edges.length).toBe(4)
    const dropped = utils.container.querySelector('[data-mock-edge="TE-3:WS-1->WS-3"]') as HTMLElement
    expect(dropped.getAttribute('stroke-dasharray')).toBe('3 6')
    expect(dropped.getAttribute('stroke')).toBe('var(--dsw-alias-border-l3)')
    const after = screen.getByRole('button', { name: '隐藏已弃用' })
    expect(after.getAttribute('aria-pressed')).toBe('true')
    await user.click(after)
    expect(utils.container.querySelectorAll('[data-mock-edge]').length).toBe(3)
  })
})

describe('§27.5: planned Workstream dimmed (class level)', () => {
  it('PLANNED nodes carry the dim class; REALIZED nodes do not', () => {
    const { utils } = renderGraph()
    const planned = utils.container.querySelector('[data-workstream="WS-2"]') as HTMLElement
    const realized = utils.container.querySelector('[data-workstream="WS-1"]') as HTMLElement
    expect(planned.classList.contains(viewStyles.wsNode_PLANNED)).toBe(true)
    expect(realized.classList.contains(viewStyles.wsNode_PLANNED)).toBe(false)
    expect(realized.classList.contains(viewStyles.wsNode_REALIZED)).toBe(true)
  })
})

/* -------------------------------------------------------------------- *
 * UI-6 D4 — the legend, the real edge id on the path (R-08), and the
 * merge-edge contract entry (B §23.1). The custom `topoEdge` component
 * itself is NOT unit-driven here (t70 idiom: the mock ReactFlow renders
 * its data-attr paths, never edgeTypes — PlanGraphView's DependencyArc
 * is pinned the same way); the path-level DOM facts (d='M…', the
 * presentation-attribute dash, the path class, data-edge-id) are
 * verified by the live e2e t71 (RECON §9.3) against the real canvas.
 * -------------------------------------------------------------------- */

describe('UI-6 D4: the legend (B §10.3 — the mandatory six entries)', () => {
  it('renders both rows with all six data-legend entries and the frozen copy', () => {
    const { utils } = renderGraph()
    const legend = utils.container.querySelector('[data-topology-legend]')
    expect(legend).not.toBeNull()
    const rows = [...legend!.querySelectorAll('[data-legend-row]')].map(r => r.getAttribute('data-legend-row'))
    expect(rows).toEqual(['lifecycle', 'form'])
    const items = [...legend!.querySelectorAll('[data-legend]')].map(e => e.getAttribute('data-legend'))
    expect(items).toEqual(['realized', 'planned', 'dropped', 'fork', 'merge', 'contract'])
    // the legend copy rides the frozen table (single source of truth):
    expect(COPY_TABLE['topic.topology.legend.planned']).toBe('Planned — dashed line')
    expect(COPY_TABLE['topic.topology.legend.contractChip']).toBe('合并契约')
    // the chip shows the badge glyph exactly as the node/edge badge does:
    expect(legend!.querySelector('[data-legend="contract"]')!.textContent).toContain('合并契约')
  })

  it('the three lifecycle legend lines carry the data-legend-line hooks', () => {
    const { utils } = renderGraph()
    const legend = utils.container.querySelector('[data-topology-legend]')!
    for (const lc of ['realized', 'planned', 'dropped']) {
      const line = legend.querySelector(`[data-legend-line="${lc}"]`)
      expect(line).not.toBeNull()
      expect(line!.classList.contains(viewStyles.legendLine)).toBe(true)
    }
  })
})

describe('UI-6 D4: the REAL edge id rides the path (R-08 — the t71 hook)', () => {
  it('every rendered edge path carries its TE id (never the pair id) and the custom edge type', () => {
    const { utils } = renderGraph()
    const paths = [...utils.container.querySelectorAll('[data-mock-edge]')]
    expect(paths.length).toBe(3)
    for (const p of paths) {
      const pairId = p.getAttribute('data-mock-edge')!
      const teId = p.getAttribute('data-edge-id')!
      // the real TE id (file-derived, ADJ-3) — not the pair id:
      expect(teId).toMatch(/^TE-\d+$/)
      expect(teId).not.toEqual(pairId)
      // and the pair id is derived FROM it: `${TE}:${input}->${output}`:
      expect(pairId.startsWith(`${teId}:`)).toBe(true)
      expect(p.getAttribute('data-edge-type')).toBe('topoEdge')
    }
    expect(utils.container.querySelector('[data-mock-edge="TE-1:WS-1->WS-2"]')!.getAttribute('data-edge-id')).toBe(
      'TE-1',
    )
    expect(utils.container.querySelector('[data-mock-edge="TE-2:WS-1->WS-3"]')!.getAttribute('data-edge-id')).toBe(
      'TE-2',
    )
    expect(utils.container.querySelector('[data-mock-edge="TE-2:WS-2->WS-3"]')!.getAttribute('data-edge-id')).toBe(
      'TE-2',
    )
  })
})

describe('UI-6 D4: the merge edge is the contract entry (B §23.1)', () => {
  it('clicking a MERGE edge opens the contract editor; the FORK edge is inert', async () => {
    const g = topologyToGraph(fixtureSnapshot())
    const utils = render(
      <TopologyGraphView
        graph={g}
        loadContract={async (edgeId: string) => ({ content: null, path: `merges/${edgeId}/contract.md` })}
        onSaveContract={async () => undefined}
      />,
    )
    fireEvent.click(utils.container.querySelector('[data-mock-edge="TE-2:WS-1->WS-3"]') as HTMLElement)
    const dialog = await waitFor(() => {
      const d = utils.container.querySelector('[data-topology-dialog="contract"]')
      expect(d).not.toBeNull()
      return d as HTMLElement
    })
    expect(dialog.querySelector('[data-contract-edge]')!.getAttribute('data-contract-edge')).toBe('TE-2')
    // content null ⇒ the "No merge contract [Create]" state:
    await waitFor(() => expect(dialog.querySelector('[data-contract-status="empty"]')).not.toBeNull())
    expect(dialog.querySelector('[data-contract-create]')).not.toBeNull()
    // the FORK edge carries no contract face — the click is inert:
    fireEvent.click(utils.container.querySelector('[data-mock-edge="TE-1:WS-1->WS-2"]') as HTMLElement)
    expect(utils.container.querySelectorAll('[data-topology-dialog]').length).toBe(1)
    expect(dialog.querySelector('[data-contract-edge]')!.getAttribute('data-contract-edge')).toBe('TE-2')
  })

  it('an EXISTING contract opens straight in the editable view (v1 [View]/[Edit] collapse)', async () => {
    const g = topologyToGraph(fixtureSnapshot())
    const utils = render(
      <TopologyGraphView
        graph={g}
        loadContract={async () => ({ content: '# Merge contract\n\nTE-2 bytes', path: 'merges/TE-2/contract.md' })}
        onSaveContract={async () => undefined}
      />,
    )
    fireEvent.click(utils.container.querySelector('[data-mock-edge="TE-2:WS-2->WS-3"]') as HTMLElement)
    await waitFor(() => expect(utils.container.querySelector('[data-contract-status="editing"]')).not.toBeNull())
    const text = utils.container.querySelector('[data-contract-text]') as HTMLTextAreaElement
    expect(text.value).toBe('# Merge contract\n\nTE-2 bytes')
    expect(utils.container.querySelector('[data-contract-save]')).not.toBeNull()
  })
})
