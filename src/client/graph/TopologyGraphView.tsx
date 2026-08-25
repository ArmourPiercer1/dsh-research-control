/**
 * TopologyGraphView (WP-4.5) — the PURE-PROPS presentation of the §27.5
 * Workstream topology graph: directed FORK/MERGE edges between Workstream
 * nodes.
 *
 * Discipline: same two-layer contract as PlanGraphView — zero store/ctx,
 * the graph arrives from the container (`topologyToGraph` on the store
 * slice), hooks are component-internal behavior only (the xyflow
 * base-style effect + the local history-mode toggle).
 *
 * §27.5 rendering conventions (encoded here + the CSS module):
 *  - realized edge → SOLID; planned edge → DASHED;
 *  - dropped → HIDDEN by default, shown by the 「显示已弃用」 history-mode
 *    toggle (a display policy — the model projection stays complete);
 *  - planned Workstream → DIMMED node (`data-lifecycle="PLANNED"`);
 *  - merge-contract badge on contract-bearing edges (edge label + data);
 *  - FORK vs MERGE form split (the RELY semantics rides DIRECTION —
 *    inputs → outputs,「output RELIES ON input」): FORK = open (stripped)
 *    arrow + fork stroke; MERGE = filled arrow + merge stroke.
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeTypes } from '@xyflow/react'
import type {
  TopologyEdgeData,
  TopologyGraphEdge,
  TopologyGraphData,
  TopologyNodeData,
  TopologyGraphNode,
} from './topology-model.js'
import { TOPOLOGY_GRAPH_STYLES as styles, ensureGraphStyles } from './graph-styles.js'

/* Edge palette — mirrored by --rc-edge-* in the CSS module. */
const EDGE_REALIZED_FORK = 'var(--dsw-alias-state-business-primary)'
const EDGE_REALIZED_MERGE = 'var(--dsw-alias-state-success-primary)'
const EDGE_PLANNED_FORK = 'var(--dsw-static-blue-400)'
const EDGE_PLANNED_MERGE = 'var(--dsw-alias-state-success-secondary)'
const EDGE_DROPPED = 'var(--dsw-alias-border-l3)'

const LIFECYCLE_TAG: Record<TopologyNodeData['lifecycle'], string> = {
  PLANNED: '规划中',
  REALIZED: '已实现',
  DROPPED: '已弃用',
}

/* -------------------------------------------------------------------- *
 * Node component (the Workstream card)
 * -------------------------------------------------------------------- */

interface TopologyWsNodeProps {
  readonly id: string
  readonly type: string
  readonly data: TopologyNodeData
}

/** One Workstream node: title, lifecycle badge, counts, merge-contract badge. */
function TopologyWsNode({ data }: TopologyWsNodeProps): ReactElement {
  const cls = [styles.wsNode, styles[`wsNode_${data.lifecycle}`] ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <div
      className={cls}
      data-workstream={data.workstreamId}
      data-lifecycle={data.lifecycle}
      data-merge-contract={data.hasMergeContract ? 'true' : undefined}
    >
      <Handle type="target" position={Position.Left} />
      <div className={styles.wsHead}>
        <span className={styles.wsId}>{data.workstreamId}</span>
        <span className={styles.wsLifecycle}>{LIFECYCLE_TAG[data.lifecycle]}</span>
      </div>
      <div className={styles.wsTitle} title={data.title}>
        {data.title}
      </div>
      <div className={styles.wsMeta}>
        <span>计划 {data.planItemCount} 项</span>
        {data.openPlanForkCount > 0 && <span data-open-pf>提案 {data.openPlanForkCount}</span>}
        {data.runningRunCount > 0 && <span data-running-run>运行中 {data.runningRunCount}</span>}
      </div>
      {data.hasMergeContract && <span className={styles.contractBadge}>合并契约</span>}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const TOPOLOGY_NODE_TYPES: NodeTypes = { topologyWs: TopologyWsNode as unknown as NodeTypes[string] }

/* -------------------------------------------------------------------- *
 * Edge shaping (lifecycle stroke + operation marker + contract badge)
 * -------------------------------------------------------------------- */

function shapeTopologyEdge(edge: TopologyGraphEdge): Edge<TopologyEdgeData> {
  const { operation, lifecycle, hasContract } = edge.data
  const stroke =
    lifecycle === 'DROPPED'
      ? EDGE_DROPPED
      : operation === 'FORK'
        ? (lifecycle === 'REALIZED' ? EDGE_REALIZED_FORK : EDGE_PLANNED_FORK)
        : (lifecycle === 'REALIZED' ? EDGE_REALIZED_MERGE : EDGE_PLANNED_MERGE)
  const result: Edge<TopologyEdgeData> = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: edge.data,
    className: `rc-topo-edge rc-topo-edge--${operation.toLowerCase()} rc-topo-edge--${lifecycle.toLowerCase()}`,
    style: {
      stroke,
      strokeWidth: lifecycle === 'REALIZED' ? 2 : 1.5,
      ...(lifecycle !== 'REALIZED' ? { strokeDasharray: lifecycle === 'DROPPED' ? '3 6' : '6 4' } : {}),
      ...(lifecycle === 'DROPPED' ? { opacity: 0.5 } : {}),
    },
    // FORK = open arrow (route fanning OUT); MERGE = filled arrow (route
    // converging IN). (MarkerType in @xyflow/system 0.0.80: Arrow | ArrowClosed.)
    markerEnd: { type: operation === 'FORK' ? MarkerType.Arrow : MarkerType.ArrowClosed, color: stroke },
  }
  // The merge-contract badge (§27.5): a label at the edge midpoint.
  if (hasContract) {
    result.label = '合并契约'
    result.labelStyle = { fontSize: 11, fill: 'var(--dsw-alias-label-secondary)' }
    result.labelBgStyle = { fill: 'var(--dsw-alias-bg-layer-2)', stroke: 'var(--dsw-alias-border-l1)' }
    result.labelBgPadding = [4, 2] as [number, number]
    result.labelBgBorderRadius = 4
  }
  return result
}

/* -------------------------------------------------------------------- *
 * The view
 * -------------------------------------------------------------------- */

export interface TopologyGraphViewProps {
  /** The derived graph (container ran `topologyToGraph` on the store slice). */
  readonly graph: TopologyGraphData
  /** React Flow viewport virtualization (TC-PERF-006). Default true. */
  readonly virtualize?: boolean
}

/**
 * Render the topic topology graph: the history-mode toggle + the React
 * Flow canvas (Workstream nodes, directed FORK/MERGE edges).
 *
 * The history-mode (show-dropped) switch is DISPLAY-INTERNAL state: a
 * plain `useState` (hooks are component-internal behavior per the
 * two-layer discipline) — no store, no parent round-trip.
 */
export function TopologyGraphView({ graph, virtualize = true }: TopologyGraphViewProps): ReactElement {
  const [showDropped, setShowDropped] = useState(false)

  useEffect(() => {
    ensureGraphStyles()
  }, [])

  const flowNodes: Node<TopologyNodeData>[] = useMemo(
    () =>
      graph.nodes.map((n: TopologyGraphNode): Node<TopologyNodeData> => ({
        id: n.id,
        type: 'topologyWs',
        position: n.position,
        data: n.data,
      })),
    [graph],
  )

  // §27.5: dropped is a rendering policy — hidden unless history mode.
  const visibleEdges: Edge<TopologyEdgeData>[] = useMemo(
    () => graph.edges.filter(e => showDropped || e.data.lifecycle !== 'DROPPED').map(shapeTopologyEdge),
    [graph, showDropped],
  )

  return (
    <div className={styles.root} data-role="topology-graph">
      <div className={styles.header}>
        <span className={styles.headerTitle}>拓扑</span>
        <span className={styles.headerMeta}>
          {graph.nodes.length} 个工作流 · {graph.edges.length} 条路线
        </span>
        <button
          type="button"
          className={styles.toggleBtn}
          data-show-dropped={showDropped ? 'true' : 'false'}
          aria-pressed={showDropped}
          onClick={() => setShowDropped(!showDropped)}
        >
          {showDropped ? '隐藏已弃用' : '显示已弃用'}
        </button>
      </div>
      <div className={styles.canvasWrap}>
        <ReactFlow
          nodes={flowNodes}
          edges={visibleEdges}
          nodeTypes={TOPOLOGY_NODE_TYPES}
          onlyRenderVisibleElements={virtualize}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          minZoom={0.2}
          maxZoom={2}
          className={styles.canvas}
        />
      </div>
    </div>
  )
}

