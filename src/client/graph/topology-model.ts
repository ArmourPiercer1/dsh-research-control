/**
 * TopologyGraph data model (WP-4.5) — the PURE projection from a frozen
 * `TopicSnapshot` (rpc-contracts) to React Flow nodes/edges for the
 * §27.5 Workstream topology graph. No React, no store, no DOM.
 *
 * Contract sources:
 *  - ARCHITECTURE §3.3: the graph answers ONLY「workstreams between which
 *    route forks/merges」; `TopologyEdge {operation: FORK|MERGE,
 *    lifecycle: PLANNED|REALIZED|DROPPED, inputs[], outputs[]}`; planned
 *    and realized share ONE object model (plan changes never rewrite
 *    history);
 *  - §3.3 rendering conventions: realized solid, planned dashed, dropped
 *    hidden by default (shown in history mode), planned Workstreams
 *    dimmed, merge-contract badge;
 *  - DOMAIN_SCHEMA §3.1: a REALIZED FORK edge has exactly one input and a
 *    REALIZED MERGE edge exactly one output (HISTORY_EVENT_CATALOG §5.8
 *    arity) — but the MODEL must render every valid shape (the wire
 *    schema allows multi-input/multi-output), so the projection expands
 *    each (input × output) pair into one directed edge.
 *
 * Direction semantics (the task line's FORK/MERGE/RELY distinction):
 *  - the WIRE vocabulary is FORK|MERGE only (frozen `edgeOp`); there is no
 *    RELY operation — the RELY semantics (ARCHITECTURE §3.4 / INV-REL-1
 *    style) is carried by DIRECTION: every edge reads「the output
 *    workstream RELIES ON (depends on) the input workstream」(inputs →
 *    outputs);
 *  - FORK vs MERGE get distinct FORMS (view layer): open vs filled arrow
 *    marker plus distinct strokes — a FORK edge fans a route OUT from its
 *    inputs, a MERGE edge converges INTO its output.
 *
 * Dropped edges: KEPT in the projection (lifecycle in the data); the VIEW
 * layer hides them by default and surfaces them in a history mode toggle
 * (§27.5 「dropped：默认隐藏/历史模式显示」— a rendering policy, not a
 * data filter: the model stays the complete projection).
 */

import type { MergeContractRefDto, TopicSnapshot, TopologyEdgeDto, WorkstreamCardDto } from '../../shared/rpc-contracts.js'

/* -------------------------------------------------------------------- *
 * Graph data face
 * -------------------------------------------------------------------- */

/** The data payload of one topology node (one Workstream card). */
export interface TopologyNodeData extends Record<string, unknown> {
  readonly workstreamId: string
  readonly title: string
  readonly lifecycle: 'PLANNED' | 'REALIZED' | 'DROPPED'
  /** Canonical plan size (§27.5 node annotation). */
  readonly planItemCount: number
  /** OPEN PF count on the workstream (the §27.3 overlay signal). */
  readonly openPlanForkCount: number
  /** RUNNING runs on the workstream (the Current-zone live signal). */
  readonly runningRunCount: number
  /** True when an outgoing merge edge of this node carries a contract. */
  readonly hasMergeContract: boolean
}

/** One rendered node. */
export interface TopologyGraphNode {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: TopologyNodeData
}

/** The data payload of one topology edge (one input→output pair). */
export interface TopologyEdgeData extends Record<string, unknown> {
  readonly edgeId: string
  readonly operation: 'FORK' | 'MERGE'
  readonly lifecycle: 'PLANNED' | 'REALIZED' | 'DROPPED'
  /** The merge-contract badge (§27.5): true when the edge carries one. */
  readonly hasContract: boolean
  /** The contract file path (badge detail, `.research`-relative). */
  readonly contractPath: string | null
  readonly note: string | null
}

/** One rendered edge (one input→output pair of one TopologyEdge). */
export interface TopologyGraphEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly data: TopologyEdgeData
}

/* -------------------------------------------------------------------- *
 * Layout constants
 * -------------------------------------------------------------------- */

/** Node size + stride per (column, row). */
export const TOPOLOGY_NODE_WIDTH = 220
export const TOPOLOGY_NODE_HEIGHT = 72
export const TOPOLOGY_COLUMN_STRIDE = 320
export const TOPOLOGY_ROW_STRIDE = 120
/** The first column's x / first row's y. */
export const TOPOLOGY_ORIGIN_X = 60
export const TOPOLOGY_ORIGIN_Y = 60

/* -------------------------------------------------------------------- *
 * The projection
 * -------------------------------------------------------------------- */

/** The output of {@link topologyToGraph}. */
export interface TopologyGraphData {
  readonly nodes: readonly TopologyGraphNode[]
  readonly edges: readonly TopologyGraphEdge[]
  /** Node id → column (topological depth; 0 = no incoming edges). */
  readonly columns: ReadonlyMap<string, number>
  /** Edges hidden by default (lifecycle DROPPED — the history-mode set). */
  readonly droppedEdgeIds: readonly string[]
  /** Workstreams referenced by edges but absent from the cards (orphan
 *   endpoints, rendered as bare nodes so edges never dangle). */
  readonly orphanWorkstreamIds: readonly string[]
}

/**
 * Compute topological columns (layers) for the workstream ids:
 * column(w) = 0 when no edge feeds w, else 1 + max(column(input)). A
 * fixed-point iteration with a cycle guard (max `n` rounds): cyclic data
 * (invalid per the domain, but the wire is not a validator) settles on
 * the last computed values instead of looping.
 */
export function computeTopologyColumns(
  workstreamIds: readonly string[],
  edges: readonly Pick<TopologyEdgeDto, 'inputs' | 'outputs'>[],
): Map<string, number> {
  const columns = new Map<string, number>()
  for (const id of workstreamIds) columns.set(id, 0)

  const maxRounds = Math.max(1, workstreamIds.length)
  for (let round = 0; round < maxRounds; round++) {
    let changed = false
    for (const edge of edges) {
      for (const output of edge.outputs) {
        if (!columns.has(output)) columns.set(output, 0)
        for (const input of edge.inputs) {
          if (!columns.has(input)) columns.set(input, 0)
          const inputCol = columns.get(input) ?? 0
          const candidate = inputCol + 1
          if (candidate > (columns.get(output) ?? 0)) {
            columns.set(output, candidate)
            changed = true
          }
        }
      }
    }
    if (!changed) break
  }
  return columns
}

/**
 * Project the topic snapshot into the topology graph:
 *  - one node per Workstream card, placed by (column, row) in the
 *    topological layout (card order within a column = host order);
 *  - one directed edge per (input × output) pair of each TopologyEdge;
 *  - merge contracts (the snapshot badge set) attached to their edges;
 *  - orphan endpoints (edge ids missing from the cards) get bare nodes so
 *    no edge dangles.
 *
 * @param snapshot - a `TopicSnapshot`.
 */
export function topologyToGraph(snapshot: TopicSnapshot): TopologyGraphData {
  const cards = snapshot.workstreams
  const ids = cards.map(card => card.id)

  // Edge ids referencing workstreams absent from the cards.
  const referenced = new Set<string>()
  for (const edge of snapshot.topology.edges) {
    for (const id of [...edge.inputs, ...edge.outputs]) referenced.add(id)
  }
  const orphanWorkstreamIds = [...referenced].filter(id => !ids.includes(id)).sort()

  const allIds = [...ids, ...orphanWorkstreamIds]
  const columns = computeTopologyColumns(allIds, snapshot.topology.edges)

  // Contract lookup: edgeId → path (one contract per edge, §3.2 ownership).
  const contractByEdge = new Map<string, string>()
  for (const ref of snapshot.mergeContracts) contractByEdge.set(ref.edgeId, ref.path)

  // Outgoing-contract flag per workstream (the node badge): a contract on
  // any MERGE edge whose OUTPUTS include the workstream.
  const contractOut = new Set<string>()
  for (const edge of snapshot.topology.edges) {
    if (edge.operation === 'MERGE' && contractByEdge.has(edge.id)) {
      for (const output of edge.outputs) contractOut.add(output)
    }
  }

  // Row assignment: stable card order within each column.
  const rowByColumn = new Map<number, number>()
  const positions = new Map<string, { x: number; y: number }>()
  for (const id of allIds) {
    const col = columns.get(id) ?? 0
    const row = rowByColumn.get(col) ?? 0
    rowByColumn.set(col, row + 1)
    positions.set(id, {
      x: TOPOLOGY_ORIGIN_X + col * TOPOLOGY_COLUMN_STRIDE,
      y: TOPOLOGY_ORIGIN_Y + row * TOPOLOGY_ROW_STRIDE,
    })
  }

  const cardById = new Map<string, WorkstreamCardDto>()
  for (const card of cards) cardById.set(card.id, card)

  const nodes: TopologyGraphNode[] = allIds.map(id => {
    const card = cardById.get(id)
    return {
      id,
      position: positions.get(id) as { x: number; y: number },
      data: card
        ? {
            workstreamId: card.id,
            title: card.title,
            lifecycle: card.lifecycle,
            planItemCount: card.planItemCount,
            openPlanForkCount: card.openPlanForkCount,
            runningRunCount: card.runningRunCount,
            hasMergeContract: contractOut.has(card.id),
          }
        : {
            workstreamId: id,
            title: id,
            lifecycle: 'PLANNED',
            planItemCount: 0,
            openPlanForkCount: 0,
            runningRunCount: 0,
            hasMergeContract: false,
          },
    }
  })

  const edges: TopologyGraphEdge[] = []
  const droppedEdgeIds: string[] = []
  for (const edge of snapshot.topology.edges) {
    const hasContract = contractByEdge.has(edge.id)
    for (const input of edge.inputs) {
      for (const output of edge.outputs) {
        const edgeId = `${edge.id}:${input}->${output}`
        edges.push({
          id: edgeId,
          source: input,
          target: output,
          data: {
            edgeId: edge.id,
            operation: edge.operation,
            lifecycle: edge.lifecycle,
            hasContract,
            contractPath: hasContract ? (contractByEdge.get(edge.id) as string) : null,
            note: edge.note,
          },
        })
      }
    }
    if (edge.lifecycle === 'DROPPED') droppedEdgeIds.push(edge.id)
  }

  return {
    nodes,
    edges,
    columns,
    droppedEdgeIds,
    orphanWorkstreamIds,
  }
}

export type { MergeContractRefDto, TopicSnapshot, TopologyEdgeDto, WorkstreamCardDto }
