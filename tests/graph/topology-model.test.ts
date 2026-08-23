/**
 * WP-4.5 — TopologyGraph pure-model tests (topologyToGraph + column
 * layout). No renderer: the (input × output) edge expansion, the
 * topological columns (incl. the cycle guard), the DROPPED edge bookkeeping
 * (kept in the data, hidden by the VIEW policy), the merge-contract badge
 * join, and the orphan-endpoint bare nodes.
 */

import { describe, expect, it } from 'vitest'
import type { TopicSnapshot, TopologyEdgeDto } from '../../src/shared/rpc-contracts.js'
import { TopicSnapshotSchema } from '../../src/shared/rpc-contracts.js'
import {
  TOPOLOGY_COLUMN_STRIDE,
  TOPOLOGY_ORIGIN_X,
  TOPOLOGY_ORIGIN_Y,
  TOPOLOGY_ROW_STRIDE,
  computeTopologyColumns,
  topologyToGraph,
} from '../../src/client/graph/topology-model.js'
import { topicSnapshot, wsCard } from './fixtures.js'

/** Wire-valid edge builder. */
function te(id: string, operation: TopologyEdgeDto['operation'], lifecycle: TopologyEdgeDto['lifecycle'], inputs: string[], outputs: string[], note: string | null = null): TopologyEdgeDto {
  return { id, operation, lifecycle, inputs, outputs, note }
}

function assertWireValid(snapshot: TopicSnapshot): void {
  expect(() => TopicSnapshotSchema.parse(snapshot)).not.toThrow()
}

describe('topological columns', () => {
  it('computes layers for a chain (0/1/2)', () => {
    const columns = computeTopologyColumns(['WS-1', 'WS-2', 'WS-3'], [
      { inputs: ['WS-1'], outputs: ['WS-2'] },
      { inputs: ['WS-2'], outputs: ['WS-3'] },
    ])
    expect([...columns.entries()].sort()).toEqual([
      ['WS-1', 0],
      ['WS-2', 1],
      ['WS-3', 2],
    ])
  })

  it('diamond layout: siblings share a column, the join lands one past', () => {
    const columns = computeTopologyColumns(['WS-1', 'WS-2', 'WS-3', 'WS-4'], [
      { inputs: ['WS-1'], outputs: ['WS-2'] },
      { inputs: ['WS-1'], outputs: ['WS-3'] },
      { inputs: ['WS-2', 'WS-3'], outputs: ['WS-4'] },
    ])
    expect(columns.get('WS-1')).toBe(0)
    expect(columns.get('WS-2')).toBe(1)
    expect(columns.get('WS-3')).toBe(1)
    expect(columns.get('WS-4')).toBe(2)
  })

  it('converges on cyclic data instead of looping (max n rounds)', () => {
    const columns = computeTopologyColumns(['WS-1', 'WS-2'], [
      { inputs: ['WS-1'], outputs: ['WS-2'] },
      { inputs: ['WS-2'], outputs: ['WS-1'] },
    ])
    // Terminates; both columns are finite small integers.
    for (const value of columns.values()) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeLessThan(10)
    }
  })

  it('ignores edges referencing unknown ids (orphans start at column 0)', () => {
    const columns = computeTopologyColumns(['WS-1'], [{ inputs: ['WS-9'], outputs: ['WS-1'] }])
    expect(columns.get('WS-1')).toBe(1)
    expect(columns.get('WS-9')).toBe(0)
  })
})

describe('topologyToGraph projection', () => {
  it('expands each (input × output) pair into one directed edge (RELY direction)', () => {
    const graph = topologyToGraph(
      topicSnapshot([wsCard('WS-1'), wsCard('WS-2'), wsCard('WS-3')], [
        te('TE-1', 'FORK', 'PLANNED', ['WS-1'], ['WS-2']),
        te('TE-2', 'MERGE', 'REALIZED', ['WS-1', 'WS-2'], ['WS-3']),
      ]),
    )
    expect(graph.edges.map(e => [e.source, e.target, e.data.edgeId, e.data.operation])).toEqual([
      ['WS-1', 'WS-2', 'TE-1', 'FORK'],
      ['WS-1', 'WS-3', 'TE-2', 'MERGE'],
      ['WS-2', 'WS-3', 'TE-2', 'MERGE'],
    ])
    expect(graph.edges.every(e => e.id.startsWith(e.data.edgeId))).toBe(true)
  })

  it('places nodes by (column, row): card order stable within a column', () => {
    const graph = topologyToGraph(
      topicSnapshot([wsCard('WS-1'), wsCard('WS-2'), wsCard('WS-3'), wsCard('WS-4')], [
        te('TE-1', 'FORK', 'PLANNED', ['WS-1'], ['WS-2', 'WS-3']),
        te('TE-2', 'MERGE', 'PLANNED', ['WS-2', 'WS-3'], ['WS-4']),
      ]),
    )
    expect(graph.nodes.map(n => n.id)).toEqual(['WS-1', 'WS-2', 'WS-3', 'WS-4'])
    const pos = new Map(graph.nodes.map(n => [n.id, n.position]))
    expect(pos.get('WS-1')).toEqual({ x: TOPOLOGY_ORIGIN_X, y: TOPOLOGY_ORIGIN_Y })
    expect(pos.get('WS-2')).toEqual({ x: TOPOLOGY_ORIGIN_X + TOPOLOGY_COLUMN_STRIDE, y: TOPOLOGY_ORIGIN_Y })
    expect(pos.get('WS-3')).toEqual({ x: TOPOLOGY_ORIGIN_X + TOPOLOGY_COLUMN_STRIDE, y: TOPOLOGY_ORIGIN_Y + TOPOLOGY_ROW_STRIDE })
    expect(pos.get('WS-4')).toEqual({ x: TOPOLOGY_ORIGIN_X + 2 * TOPOLOGY_COLUMN_STRIDE, y: TOPOLOGY_ORIGIN_Y })
    expect([...graph.columns.entries()]).toEqual([
      ['WS-1', 0],
      ['WS-2', 1],
      ['WS-3', 1],
      ['WS-4', 2],
    ])
  })

  it('carries the card annotations (lifecycle, counts) into node data', () => {
    const graph = topologyToGraph(
      topicSnapshot(
        [wsCard('WS-1', { lifecycle: 'PLANNED', openPlanForkCount: 2, runningRunCount: 1, planItemCount: 7 })],
        [],
      ),
    )
    expect(graph.nodes[0].data).toMatchObject({
      workstreamId: 'WS-1',
      lifecycle: 'PLANNED',
      openPlanForkCount: 2,
      runningRunCount: 1,
      planItemCount: 7,
    })
  })

  it('keeps DROPPED edges in the data and lists them for the view policy', () => {
    const graph = topologyToGraph(
      topicSnapshot([wsCard('WS-1'), wsCard('WS-2')], [
        te('TE-1', 'FORK', 'DROPPED', ['WS-1'], ['WS-2']),
        te('TE-2', 'MERGE', 'REALIZED', ['WS-1'], ['WS-2']),
      ]),
    )
    expect(graph.edges.map(e => e.data.lifecycle)).toEqual(['DROPPED', 'REALIZED'])
    expect(graph.droppedEdgeIds).toEqual(['TE-1'])
  })

  it('joins merge contracts onto their edges AND flags the merge output node', () => {
    const graph = topologyToGraph(
      topicSnapshot(
        [wsCard('WS-1'), wsCard('WS-2'), wsCard('WS-3')],
        [
          te('TE-1', 'MERGE', 'REALIZED', ['WS-1'], ['WS-2']),
          te('TE-2', 'MERGE', 'REALIZED', ['WS-1'], ['WS-3']),
        ],
        [{ edgeId: 'TE-1', path: 'merges/TE-1/contract.md' }],
      ),
    )
    const [edgeA, edgeB] = graph.edges
    expect(edgeA.data).toMatchObject({ hasContract: true, contractPath: 'merges/TE-1/contract.md' })
    expect(edgeB.data).toMatchObject({ hasContract: false, contractPath: null })
    expect(graph.nodes.find(n => n.id === 'WS-2')!.data.hasMergeContract).toBe(true)
    expect(graph.nodes.find(n => n.id === 'WS-3')!.data.hasMergeContract).toBe(false)
  })

  it('a contract on a FORK edge badges the edge but NOT a node (merge semantics)', () => {
    const graph = topologyToGraph(
      topicSnapshot([wsCard('WS-1'), wsCard('WS-2')], [te('TE-1', 'FORK', 'REALIZED', ['WS-1'], ['WS-2'])], [
        { edgeId: 'TE-1', path: 'merges/TE-1/contract.md' },
      ]),
    )
    expect(graph.edges[0].data.hasContract).toBe(true)
    expect(graph.nodes.every(n => n.data.hasMergeContract === false)).toBe(true)
  })

  it('renders orphan endpoints as bare nodes so edges never dangle', () => {
    const graph = topologyToGraph(
      topicSnapshot([wsCard('WS-1')], [te('TE-1', 'FORK', 'PLANNED', ['WS-1'], ['WS-9'])]),
    )
    expect(graph.orphanWorkstreamIds).toEqual(['WS-9'])
    const orphan = graph.nodes.find(n => n.id === 'WS-9')
    expect(orphan!.data).toMatchObject({ workstreamId: 'WS-9', title: 'WS-9', lifecycle: 'PLANNED' })
    // Orphan sits one column past its input.
    expect(graph.columns.get('WS-9')).toBe(1)
  })

  it('renders nothing for an empty topic', () => {
    const graph = topologyToGraph(topicSnapshot([], []))
    expect(graph.nodes).toEqual([])
    expect(graph.edges).toEqual([])
    expect(graph.droppedEdgeIds).toEqual([])
  })
})

describe('wire validity (drift guard)', () => {
  it('fixture-built topic snapshots parse through the strict schema', () => {
    assertWireValid(
      topicSnapshot(
        [wsCard('WS-1'), wsCard('WS-2')],
        [te('TE-1', 'FORK', 'PLANNED', ['WS-1'], ['WS-2'])],
        [{ edgeId: 'TE-1', path: 'merges/TE-1/contract.md' }],
      ),
    )
  })
})
