/**
 * PlanGraphView (WP-4.5) — the PURE-PROPS presentation of the Future Plan
 * zone (§27.4/§27.6): the canonical G/T/M linear sequence plus the
 * unresolved Agent PlanFork overlay (branches) and the SELECT/DISMISS user
 * entries (RR-015③).
 *
 * Discipline (DSH_ADAPTER §6 two-layer variant):
 *  - zero store access, zero ctx: the graph data arrives as `graph`
 *    (the container ran `planToGraph` on the store slice), the proposal
 *    rows as `forks`, and the mutation entries as callbacks (the container
 *    wires them to `selectPlanFork`/`dismissPlanFork` behind a
 *    confirmation dialog);
 *  - hooks are component-internal behavior only (the xyflow base-style
 *    injection effect);
 *  - the React Flow component is the canvas; the node/edge SHAPES are this
 *    file's custom components (G/T/M distinction, ghost nodes, the three
 *    change-form icons).
 *
 * AC/Gate P4 — canonical vs fork must never blur (design plan §27.6:
 * stroke style / opacity / label / source Agent-Run badge):
 *  - canonical nodes: SOLID border, full opacity, `data-source="canonical"`;
 *  - fork ghosts: DASHED border, reduced opacity, `data-source="planFork"`
 *    + `data-pf`/`data-form` attributes, a change-form icon (+/−/⇄ =
 *    INSERT/MOVE/DELETE), and the `PF-<n> · R-<n>` source badge;
 *  - canonical edges: solid stroke; fork edges: dashed, animated for OPEN
 *    proposals, muted for STALE ones.
 *
 * The edge stroke palette lives in JS constants (SVG marker colors cannot
 * use CSS vars reliably) and is mirrored by the `--rc-edge-*` custom
 * properties in the CSS module — keep the two in sync when retheming.
 */

import { useEffect, useMemo, type ReactElement } from 'react'
import { Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeTypes } from '@xyflow/react'
import type { PlanForkDto } from '../../shared/rpc-contracts.js'
import {
  type PlanChangeForm,
  type PlanEdgeData,
  type PlanGraphEdge,
  type PlanGraphData,
  type PlanNodeData,
  type PlanGraphNode,
  classifyPlanForkChange,
} from './plan-model.js'
import { PLAN_GRAPH_STYLES as styles, ensureGraphStyles } from './graph-styles.js'

/* -------------------------------------------------------------------- *
 * Palette (mirrored by --rc-edge-* / --rc-kind-* in the CSS module)
 * -------------------------------------------------------------------- */

const EDGE_CANONICAL = '#4b5563'
const EDGE_FORK_OPEN = '#7c5cff'
const EDGE_FORK_STALE = '#b3a8d9'

/* -------------------------------------------------------------------- *
 * Node components (the G/T/M/ghost shapes)
 * -------------------------------------------------------------------- */

/** The user-visible kind tags (Chinese product copy). */
const KIND_TAG: Record<PlanNodeData['kind'], string> = {
  GATE: '关卡',
  TASK: '任务',
  MILESTONE: '里程碑',
  PROPOSED: '候选',
}

/** The three change-form icons (INSERT/MOVE/DELETE — §27.6 label split). */
const FORM_ICON: Record<PlanChangeForm, string> = {
  INSERT: '+',
  MOVE: '⇄',
  DELETE: '−',
}

const FORM_LABEL: Record<PlanChangeForm, string> = {
  INSERT: '新增项',
  MOVE: '重排/替换',
  DELETE: '删除项',
}

const KIND_CLASS: Record<PlanNodeData['kind'], string> = {
  GATE: styles.nodeGate,
  TASK: styles.nodeTask,
  MILESTONE: styles.nodeMilestone,
  PROPOSED: styles.nodeProposed,
}

interface PlanItemNodeProps {
  readonly id: string
  readonly type: string
  readonly data: PlanNodeData
}

/** One PlanGraph node: canonical G/T/M (solid) or a PF ghost (dashed). */
function PlanItemNode({ data }: PlanItemNodeProps): ReactElement {
  const ghost = data.source === 'planFork'
  const cls = [styles.node, ghost ? styles.ghost : styles.canonical, KIND_CLASS[data.kind]]
    .filter(Boolean)
    .join(' ')
  return (
    <div
      className={cls}
      data-kind={data.kind}
      data-source={data.source}
      data-pf={ghost ? (data.planForkId as string) : undefined}
      data-form={ghost ? (data.changeForm as string) : undefined}
      data-stale={data.stale ? 'true' : undefined}
    >
      <Handle type="target" position={Position.Left} />
      <div className={styles.nodeHead}>
        <span className={styles.nodeLabel}>{data.label}</span>
        <span className={styles.kindTag}>{KIND_TAG[data.kind]}</span>
      </div>
      <div className={styles.nodeTitle} title={data.title}>
        {data.title}
      </div>
      {ghost && (
        <div className={styles.footRow}>
          <span
            className={styles.formIcon}
            data-form={data.changeForm}
            aria-label={data.changeForm ? FORM_LABEL[data.changeForm] : undefined}
          >
            {data.changeForm ? FORM_ICON[data.changeForm] : ''}
          </span>
          <span className={styles.pfBadge}>
            {data.planForkId}
            {data.sourceRun ? ` · ${data.sourceRun}` : ''}
          </span>
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

/** Module-level node-type registry (stable identity across renders). */
const PLAN_NODE_TYPES: NodeTypes = { planItem: PlanItemNode as unknown as NodeTypes[string] }

/* -------------------------------------------------------------------- *
 * Edge shaping (canonical solid vs fork dashed; markers by direction)
 * -------------------------------------------------------------------- */

function shapePlanEdge(edge: PlanGraphEdge): Edge<PlanEdgeData> {
  const fork = edge.data.source === 'planFork'
  const stale = edge.data.stale === true
  const stroke = !fork ? EDGE_CANONICAL : (stale ? EDGE_FORK_STALE : EDGE_FORK_OPEN)
  const result: Edge<PlanEdgeData> = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: edge.data,
    className: fork ? 'rc-edge-planfork' : 'rc-edge-canonical',
    style: {
      stroke,
      strokeWidth: fork ? 1.5 : 1.5,
      ...(fork ? { strokeDasharray: stale ? '4 6' : '6 4', opacity: stale ? 0.55 : 1 } : {}),
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
  }
  // OPEN fork branches animate (the「proposed, pending your call」signal);
  // STALE branches stay quiet (their base closure is already invalid).
  if (fork && !stale) result.animated = true
  return result
}

/* -------------------------------------------------------------------- *
 * The view
 * -------------------------------------------------------------------- */

export interface PlanGraphViewProps {
  /** The derived graph (container ran `planToGraph` on the store slice). */
  readonly graph: PlanGraphData
  /** The unresolved proposals (host order; the view re-sorts to branch order). */
  readonly forks: readonly PlanForkDto[]
  /** The §27.4 unresolved count (OPEN + STALE). */
  readonly unresolvedCount: number
  /** SELECT entry (the container gates it behind the confirmation dialog). */
  readonly onSelectFork: (planForkId: string) => void
  /** DISMISS entry (the container gates it behind the confirmation dialog). */
  readonly onDismissFork: (planForkId: string) => void
  /** React Flow viewport virtualization (TC-PERF-006). Default true. */
  readonly virtualize?: boolean
}

/**
 * Render the Future Plan zone: header + unresolved-proposal toolbar
 * (SELECT/DISMISS entries) + the React Flow canvas (canonical row + PF
 * branch rows).
 */
export function PlanGraphView({
  graph,
  forks,
  unresolvedCount,
  onSelectFork,
  onDismissFork,
  virtualize = true,
}: PlanGraphViewProps): ReactElement {
  // The xyflow base stylesheet ships inside the single-file bundle (see
  // xyflow-base.ts); inject it once before the canvas mounts.
  useEffect(() => {
    ensureGraphStyles()
  }, [])

  const flowNodes: Node<PlanNodeData>[] = useMemo(
    () =>
      graph.nodes.map((n: PlanGraphNode): Node<PlanNodeData> => ({
        id: n.id,
        type: 'planItem',
        position: n.position,
        data: n.data,
      })),
    [graph],
  )

  const flowEdges: Edge<PlanEdgeData>[] = useMemo(() => graph.edges.map(shapePlanEdge), [graph])

  // Toolbar rows in BRANCH row order (OPEN first, then STALE — the model's
  // order), joined with the DTO rows for status/reason metadata.
  const forkById = useMemo(() => new Map(forks.map(f => [f.id, f])), [forks])
  const orderedForks = useMemo(
    () => graph.branchForkIds.map(id => forkById.get(id)).filter((f): f is PlanForkDto => f !== undefined),
    [graph, forkById],
  )
  const canonicalIds = useMemo(
    () => graph.nodes.filter(n => n.data.source === 'canonical').map(n => n.data.itemId),
    [graph],
  )

  return (
    <div className={styles.root} data-role="plan-graph">
      <div className={styles.header}>
        <span className={styles.headerTitle}>未来计划</span>
        <span className={styles.headerMeta}>
          正典 {graph.canonicalCount} 项 · 未决提案 {unresolvedCount} 条
        </span>
      </div>

      {orderedForks.length > 0 && (
        <ul className={styles.toolbar} data-role="plan-fork-toolbar">
          {orderedForks.map(fork => {
            const stale = fork.status === 'STALE'
            const form = classifyPlanForkChange(
              fork.forkAnchor,
              fork.mergeAnchor,
              fork.proposedItemCount,
              canonicalIds,
            )
            return (
              <li key={fork.id} className={styles.pfRow} data-pf={fork.id} data-status={fork.status}>
                <span className={styles.pfForm} data-form={form} aria-label={FORM_LABEL[form]}>
                  {FORM_ICON[form]}
                </span>
                <span className={styles.pfId}>{fork.id}</span>
                <span className={stale ? `${styles.pfStatus} ${styles.pfStatusStale}` : styles.pfStatus}>
                  {stale ? '已过期' : '待处理'}
                </span>
                <span className={styles.pfReason} title={`${fork.reason}\n${fork.necessity}`}>
                  {fork.reason}
                </span>
                <span className={styles.pfRun}>{fork.createdByRun}</span>
                <span className={styles.pfActions}>
                  <button
                    type="button"
                    className={styles.selectBtn}
                    data-pf={fork.id}
                    disabled={stale}
                    title={stale ? '基准已失效：过期的提案不可选择（需 Agent 重新提议），仅可忽略' : undefined}
                    onClick={() => onSelectFork(fork.id)}
                  >
                    选择
                  </button>
                  <button type="button" className={styles.dismissBtn} data-pf={fork.id} onClick={() => onDismissFork(fork.id)}>
                    忽略
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <div className={styles.canvasWrap}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={PLAN_NODE_TYPES}
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
