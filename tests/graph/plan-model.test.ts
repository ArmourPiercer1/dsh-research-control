/**
 * WP-4.5 — PlanGraph pure-model tests (planToGraph + change-form
 * projection). No renderer: the linear/branch layout arithmetic, the PF
 * overlay membership (OPEN + STALE — the unresolved set), the three
 * change forms (INSERT/MOVE/DELETE), and the sentinel/unknown-anchor
 * endpoint rules.
 */

import { describe, expect, it } from 'vitest'
import type { PlanForkDto, PlanItemDto, WorkstreamSnapshot } from '../../src/shared/rpc-contracts.js'
import { WorkstreamSnapshotSchema } from '../../src/shared/rpc-contracts.js'
import {
  ANCHOR_END,
  ANCHOR_START,
  PLAN_BRANCH_OFFSET,
  PLAN_CANONICAL_Y,
  PLAN_NODE_STRIDE,
  anchorIndex,
  classifyPlanForkChange,
  planToGraph,
  type PlanGraphNode,
} from '../../src/client/graph/plan-model.js'
import { item, pf, wsSnapshot } from './fixtures.js'

/** The wire contract still accepts the built snapshot (drift guard). */
function assertWireValid(snapshot: WorkstreamSnapshot): void {
  expect(() => WorkstreamSnapshotSchema.parse(snapshot)).not.toThrow()
}

const PLAN = [item('G-1', 'GATE', 'Gate One'), item('T-1', 'TASK', 'Task One'), item('M-1', 'MILESTONE', 'Milestone One')]
const IDS = ['G-1', 'T-1', 'M-1']

function nodesByKind(graph: ReturnType<typeof planToGraph>): Map<string, PlanGraphNode[]> {
  const byKind = new Map<string, PlanGraphNode[]>()
  for (const node of graph.nodes) {
    const list = byKind.get(node.data.kind) ?? []
    list.push(node)
    byKind.set(node.data.kind, list)
  }
  return byKind
}

describe('canonical linear layout (plan order preserved — §3.4)', () => {
  it('places item i at slot i on one row, kind-tagged G/T/M', () => {
    const graph = planToGraph(wsSnapshot(PLAN, []))
    expect(graph.canonicalCount).toBe(3)
    expect(graph.nodes.map(n => n.id)).toEqual(['G-1', 'T-1', 'M-1'])
    expect(graph.nodes.map(n => [n.position.x, n.position.y])).toEqual([
      [0, PLAN_CANONICAL_Y],
      [PLAN_NODE_STRIDE, PLAN_CANONICAL_Y],
      [2 * PLAN_NODE_STRIDE, PLAN_CANONICAL_Y],
    ])
    expect(graph.nodes.map(n => n.data.kind)).toEqual(['GATE', 'TASK', 'MILESTONE'])
    expect(graph.nodes.every(n => n.data.source === 'canonical')).toBe(true)
  })

  it('joins consecutive items with canonical edges (n-1 edges)', () => {
    const graph = planToGraph(wsSnapshot(PLAN, []))
    expect(graph.edges.map(e => [e.source, e.target])).toEqual([
      ['G-1', 'T-1'],
      ['T-1', 'M-1'],
    ])
    expect(graph.edges.every(e => e.data.source === 'canonical')).toBe(true)
  })

  it('keeps the wire order verbatim (a reordered plan renders reordered)', () => {
    const graph = planToGraph(wsSnapshot([PLAN[1], PLAN[2], PLAN[0]], []))
    expect(graph.nodes.map(n => n.id)).toEqual(['T-1', 'M-1', 'G-1'])
  })

  it('renders an empty plan as zero nodes/edges', () => {
    const graph = planToGraph(wsSnapshot([], []))
    expect(graph.nodes).toEqual([])
    expect(graph.edges).toEqual([])
  })

  it('is pure (no input mutation, stable output for stable input)', () => {
    const snapshot = wsSnapshot(PLAN, [pf('PF-1', 'OPEN', 'T-1', 'T-1', 1)])
    const first = planToGraph(snapshot)
    const second = planToGraph(snapshot)
    expect(second).toEqual(first)
    expect(snapshot.future.plan.orderedItems.map(i => i.id)).toEqual(IDS)
  })
})

describe('PF overlay membership and branch geometry (unresolved set)', () => {
  it('renders one branch row per OPEN proposal: ghosts after the fork anchor', () => {
    const graph = planToGraph(wsSnapshot(PLAN, [pf('PF-1', 'OPEN', 'T-1', 'T-1', 1, { createdByRun: 'R-2' })]))
    const ghost = graph.nodes.find(n => n.id === 'PF-1#1')
    expect(ghost).toBeDefined()
    // fork_anchor == merge_anchor == T-1 (index 1) → slot 2 → x = 2·stride.
    expect(ghost!.position).toEqual({ x: 2 * PLAN_NODE_STRIDE, y: PLAN_CANONICAL_Y + PLAN_BRANCH_OFFSET })
    expect(ghost!.data).toMatchObject({
      kind: 'PROPOSED',
      source: 'planFork',
      planForkId: 'PF-1',
      changeForm: 'INSERT',
      sourceRun: 'R-2',
      stale: false,
      proposedIndex: 1,
      proposedTotal: 1,
    })
    expect(graph.branchCount).toBe(1)
    expect(graph.openBranchCount).toBe(1)
    expect(graph.branchForkIds).toEqual(['PF-1'])
  })

  it('forks the branch dashed from the fork anchor and rejoins at the merge anchor', () => {
    const graph = planToGraph(wsSnapshot(PLAN, [pf('PF-1', 'OPEN', 'G-1', 'M-1', 2)]))
    const forkEdges = graph.edges.filter(e => e.data.source === 'planFork')
    expect(forkEdges.map(e => [e.source, e.target])).toEqual([
      ['G-1', 'PF-1#1'],
      ['PF-1#1', 'PF-1#2'],
      ['PF-1#2', 'M-1'],
    ])
    expect(forkEdges.every(e => e.data.planForkId === 'PF-1' && e.data.stale === false)).toBe(true)
    // Ghosts occupy the slots after the fork anchor.
    expect(graph.nodes.find(n => n.id === 'PF-1#1')!.position.x).toBe(PLAN_NODE_STRIDE)
    expect(graph.nodes.find(n => n.id === 'PF-1#2')!.position.x).toBe(2 * PLAN_NODE_STRIDE)
  })

  it('renders STALE proposals too (unresolved set) flagged stale, dismiss-only data', () => {
    const graph = planToGraph(wsSnapshot(PLAN, [pf('PF-1', 'STALE', 'T-1', 'T-1', 1)]))
    const ghost = graph.nodes.find(n => n.id === 'PF-1#1')
    expect(ghost!.data.stale).toBe(true)
    expect(graph.edges.filter(e => e.data.source === 'planFork').every(e => e.data.stale === true)).toBe(true)
    expect(graph.openBranchCount).toBe(0)
    expect(graph.branchCount).toBe(1)
  })

  it('orders branch rows OPEN first, then STALE (stable within a status)', () => {
    const graph = planToGraph(
      wsSnapshot(PLAN, [
        pf('PF-3', 'STALE', 'G-1', 'G-1', 1),
        pf('PF-1', 'OPEN', 'G-1', 'G-1', 1),
        pf('PF-2', 'OPEN', 'G-1', 'G-1', 1),
      ]),
    )
    expect(graph.branchForkIds).toEqual(['PF-1', 'PF-2', 'PF-3'])
    const ys = graph.branchForkIds.map(id => graph.nodes.find(n => n.id === `${id}#1`)!.position.y)
    expect(ys).toEqual([
      PLAN_CANONICAL_Y + PLAN_BRANCH_OFFSET,
      PLAN_CANONICAL_Y + 2 * PLAN_BRANCH_OFFSET,
      PLAN_CANONICAL_Y + 3 * PLAN_BRANCH_OFFSET,
    ])
    expect(graph.openBranchCount).toBe(2)
  })

  it('keeps anchors on the canonical row (both stay, §2.2)', () => {
    const graph = planToGraph(wsSnapshot(PLAN, [pf('PF-1', 'OPEN', 'G-1', 'M-1', 1)]))
    // G-1 and M-1 remain canonical nodes; the branch references them.
    expect(graph.nodes.filter(n => n.data.source === 'canonical').map(n => n.id)).toEqual(IDS)
    const edgeIds = graph.edges.map(e => e.id)
    expect(edgeIds).toContain('pf:PF-1:G-1->PF-1#1')
    expect(edgeIds).toContain('pf:PF-1:PF-1#1->M-1')
  })
})

describe('change-form projection (the three INSERT/MOVE/DELETE forms)', () => {
  it('pure insertion (fork == merge) is INSERT for any count', () => {
    expect(classifyPlanForkChange('T-1', 'T-1', 0, IDS)).toBe('INSERT')
    expect(classifyPlanForkChange('T-1', 'T-1', 5, IDS)).toBe('INSERT')
  })

  it('net growth over the open interval is INSERT', () => {
    // interval (G-1, M-1) holds 1 item; 2 proposed > 1.
    expect(classifyPlanForkChange('G-1', 'M-1', 2, IDS)).toBe('INSERT')
  })

  it('net shrink is DELETE', () => {
    expect(classifyPlanForkChange('G-1', 'M-1', 0, IDS)).toBe('DELETE')
  })

  it('same cardinality is MOVE (reorder/replace in place)', () => {
    expect(classifyPlanForkChange('G-1', 'M-1', 1, IDS)).toBe('MOVE')
  })

  it('sentinels count the boundary-open interval', () => {
    // (__START__, M-1): the open interval holds G-1, T-1 → 2 items.
    expect(classifyPlanForkChange(ANCHOR_START, 'M-1', 3, IDS)).toBe('INSERT')
    expect(classifyPlanForkChange(ANCHOR_START, 'M-1', 1, IDS)).toBe('DELETE')
    expect(classifyPlanForkChange(ANCHOR_START, 'M-1', 2, IDS)).toBe('MOVE')
    // (T-1, __END__): the open interval holds M-1 → 1 item.
    expect(classifyPlanForkChange('T-1', ANCHOR_END, 2, IDS)).toBe('INSERT')
    expect(classifyPlanForkChange('T-1', ANCHOR_END, 0, IDS)).toBe('DELETE')
  })

  it('whole-plan replacement via sentinels (__START__ → __END__)', () => {
    expect(classifyPlanForkChange(ANCHOR_START, ANCHOR_END, 4, IDS)).toBe('INSERT')
    expect(classifyPlanForkChange(ANCHOR_START, ANCHOR_END, 3, IDS)).toBe('MOVE')
    expect(classifyPlanForkChange(ANCHOR_START, ANCHOR_END, 0, IDS)).toBe('DELETE')
  })

  it('unknown anchors (stale proposal) fall back to an empty interval', () => {
    expect(classifyPlanForkChange('T-99', 'M-99', 0, IDS)).toBe('MOVE')
    expect(classifyPlanForkChange('T-99', 'M-99', 1, IDS)).toBe('INSERT')
  })

  it('the form lands on the ghost nodes', () => {
    const graph = planToGraph(wsSnapshot(PLAN, [pf('PF-1', 'OPEN', 'G-1', 'M-1', 0)]))
    expect(graph.nodes.filter(n => n.data.source === 'planFork')).toEqual([]) // zero-item: no ghosts
    const move = planToGraph(wsSnapshot(PLAN, [pf('PF-2', 'OPEN', 'G-1', 'M-1', 1)]))
    expect(move.nodes.find(n => n.id === 'PF-2#1')!.data.changeForm).toBe('MOVE')
  })
})

describe('anchor endpoint rules (sentinels + unknown + empty plan)', () => {
  it('anchorIndex: sentinels, known ids, unknown ids', () => {
    expect(anchorIndex(ANCHOR_START, IDS)).toBe(-1)
    expect(anchorIndex(ANCHOR_END, IDS)).toBe(3)
    expect(anchorIndex('T-1', IDS)).toBe(1)
    expect(anchorIndex('T-99', IDS)).toBe(-1)
  })

  it('START/unknown fork connects at the plan head; END/unknown merge at the tail', () => {
    const graph = planToGraph(wsSnapshot(PLAN, [pf('PF-1', 'OPEN', ANCHOR_START, ANCHOR_END, 1)]))
    expect(graph.edges.filter(e => e.data.source === 'planFork').map(e => [e.source, e.target])).toEqual([
      ['G-1', 'PF-1#1'],
      ['PF-1#1', 'M-1'],
    ])
    const stale = planToGraph(wsSnapshot(PLAN, [pf('PF-2', 'STALE', 'T-99', 'M-99', 1)]))
    expect(stale.edges.filter(e => e.data.planForkId === 'PF-2').map(e => [e.source, e.target])).toEqual([
      ['G-1', 'PF-2#1'],
      ['PF-2#1', 'M-1'],
    ])
    expect(stale.nodes.find(n => n.id === 'PF-2#1')!.position.x).toBe(0) // slot 0 (head)
  })

  it('a tail insertion at __END__ anchors the branch to the last canonical item', () => {
    const graph = planToGraph(wsSnapshot(PLAN, [pf('PF-1', 'OPEN', ANCHOR_END, ANCHOR_END, 1)]))
    const ghost = graph.nodes.find(n => n.id === 'PF-1#1')
    // __END__ → index 3 → slot 4 → x = 4·stride.
    expect(ghost!.position.x).toBe(4 * PLAN_NODE_STRIDE)
    expect(graph.edges.filter(e => e.data.source === 'planFork').map(e => [e.source, e.target])).toEqual([
      ['M-1', 'PF-1#1'],
      ['PF-1#1', 'M-1'],
    ])
  })

  it('an empty plan renders ghosts but no fork edges (no endpoints)', () => {
    const graph = planToGraph(wsSnapshot([], [pf('PF-1', 'OPEN', ANCHOR_START, ANCHOR_END, 2)]))
    expect(graph.nodes.map(n => n.id)).toEqual(['PF-1#1', 'PF-1#2'])
    expect(graph.edges).toEqual([])
  })
})

describe('wire validity of the model inputs (drift guard)', () => {
  it('every fixture-built snapshot parses through the strict schema', () => {
    assertWireValid(wsSnapshot(PLAN, [pf('PF-1', 'OPEN', 'T-1', 'T-1', 1), pf('PF-2', 'STALE', 'G-1', 'M-1', 0)]))
  })
})

export type { PlanForkDto, PlanItemDto }
