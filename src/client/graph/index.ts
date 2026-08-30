/**
 * Graph views public face (WP-4.5) — PlanGraph + TopologyGraph + the PF
 * overlay (design plan §27.5/§27.6; ARCHITECTURE §3.3/§3.4).
 *
 * Two-layer contract (DSH_ADAPTER §6):
 *  - CONTAINERS (`PlanGraphContainer`, `TopologyGraphContainer`): one per
 *    view; the only files where the research store handle (a
 *    `createResearchStore()` factory result, passed as a prop) reaches
 *    React — via the `store-binding` minimal hooks;
 *  - PRESENTATION (`PlanGraphView`, `TopologyGraphView`,
 *    `ConfirmDialog`): pure props; zero store, zero ctx;
 *  - MODELS (`planToGraph`, `topologyToGraph`): pure functions from frozen
 *    contract DTOs to node/edge geometry — unit-testable without a
 *    renderer.
 *
 * React Flow (@xyflow/react) is the canvas; the node/edge SHAPES are this
 * package's custom components. The @xyflow base stylesheet ships inside
 * the single-file bundle (xyflow-base.ts) because the client artifact has
 * no companion CSS channel (the host module loader serves one file).
 */

export {
  ANCHOR_END,
  ANCHOR_START,
  PLAN_BRANCH_OFFSET,
  PLAN_CANONICAL_Y,
  PLAN_NODE_HEIGHT,
  PLAN_NODE_STRIDE,
  PLAN_NODE_WIDTH,
  anchorIndex,
  classifyPlanForkChange,
  planToGraph,
  type PlanChangeForm,
  type PlanEdgeData,
  type PlanEdgeSource,
  type PlanGraphData,
  type PlanGraphEdge,
  type PlanGraphExtras,
  type PlanGraphNode,
  type PlanNodeData,
  type PlanNodeKind,
  type PlanNodeSource,
} from './plan-model.js'
export {
  TOPOLOGY_COLUMN_STRIDE,
  TOPOLOGY_NODE_HEIGHT,
  TOPOLOGY_NODE_WIDTH,
  TOPOLOGY_ORIGIN_X,
  TOPOLOGY_ORIGIN_Y,
  TOPOLOGY_ROW_STRIDE,
  computeTopologyColumns,
  topologyToGraph,
  type TopologyEdgeData,
  type TopologyGraphData,
  type TopologyGraphEdge,
  type TopologyGraphNode,
  type TopologyNodeData,
} from './topology-model.js'
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog.js'
export { PlanGraphContainer, type PlanGraphContainerProps } from './PlanGraphContainer.js'
export { PlanGraphView, type PlanGraphViewProps } from './PlanGraphView.js'
export { TopologyGraphContainer, type TopologyGraphContainerProps } from './TopologyGraphContainer.js'
export { TopologyGraphView, type TopologyGraphViewProps } from './TopologyGraphView.js'
export { useStoreSnapshot, useStoreSnapshotSelected } from './store-binding.js'
export { ensureXyflowBaseStyles, XYFLOW_BASE_CSS } from './xyflow-base.js'
export {
  CONFIRM_DIALOG_STYLES,
  GRAPH_BASE_CSS,
  PLAN_GRAPH_STYLES,
  TOPOLOGY_GRAPH_STYLES,
  ensureGraphStyles,
} from './graph-styles.js'
