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
 *    proposals, muted for STALE ones; UI-5 dependency edges: a THIRD,
 *    distinct dot-dash ('2 4') + their own palette entry (B §18.3: the
 *    line TYPE is the discriminator, color is secondary) + the legend
 *    (the two B §18.3 verbatim lines — `ws.future.graph.legend*`).
 *
 * UI-5 (ADJ-1/ADJ-6/ADJ-9) faces (all OPTIONAL — the WP-4.5 cockpit
 * mount passes none and keeps its exact face, save the legend):
 *  - `selectedItemId` + `onNodeSelect`: canonical-node click = item
 *    selection (two-way strip/graph sync, owned by the Workstream-page
 *    container); ghosts are never selectable; the selection highlight is
 *    `data-selected` + the `.rc-pgv-selected` class (xyflow's own
 *    selection stays OFF — `elementsSelectable={false}` is unchanged);
 *  - the CF marker: the focused canonical node renders a ★ glyph badge
 *    (`data-plan-focus`, a symbol — no copy key needed);
 *  - `graph.pfDowngraded` (ADJ-9): the PF toolbar renders muted
 *    (`.rc-pgv-pfDowngraded`) and the root carries `data-pf-downgraded`
 *    so the CSS weakens the ghost branch rows (they STAY — the branch
 *    data is untouched).
 *
 * The edge stroke palette lives in JS constants (SVG marker colors cannot
 * use CSS vars reliably) and is mirrored by the `--rc-edge-*` custom
 * properties in the CSS module — keep the two in sync when retheming.
 */

import { useCallback, useEffect, useMemo, type ReactElement } from 'react'
import { Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeTypes } from '@xyflow/react'
import type { PlanForkDto } from '../../shared/rpc-contracts.js'
import { t } from '../i18n/copy.js'
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

const EDGE_CANONICAL = 'var(--dsw-alias-label-secondary)'
const EDGE_FORK_OPEN = '#7c5cff'
const EDGE_FORK_STALE = '#b3a8d9'
/** UI-5 (B §18.3): the dependency edge color — a THIRD palette entry,
 *  distinct from the canonical gray AND the fork purples. The line
 *  TYPE (dash pattern) is the primary discriminator — color is
 *  secondary and never the only cue. */
const EDGE_DEPENDENCY = '#4a7fb5'

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

/** One PlanGraph node: canonical G/T/M (solid) or a PF ghost (dashed).
 *  UI-5 (ADJ-1): a canonical node can carry the selection highlight
 *  (`data-selected`) and the Current-Focus marker (a glyph — a symbol,
 *  like the change-form icons, so it needs no copy key). */
function PlanItemNode({ data }: PlanItemNodeProps): ReactElement {
  const ghost = data.source === 'planFork'
  const selected = data.selected === true
  const focused = data.focused === true
  const cls = [
    styles.node,
    ghost ? styles.ghost : styles.canonical,
    KIND_CLASS[data.kind],
    selected ? styles.selected : null,
  ]
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
      data-selected={selected ? 'true' : undefined}
      data-plan-focus={focused ? 'true' : undefined}
    >
      <Handle type="target" position={Position.Left} />
      <div className={styles.nodeHead}>
        <span className={styles.nodeLabel}>{data.label}</span>
        <span className={styles.kindTag}>{KIND_TAG[data.kind]}</span>
      </div>
      <div className={styles.nodeTitle} title={data.title}>
        {data.title}
      </div>
      {focused && (
        <span className={styles.focusBadge} data-focus-marker aria-hidden="true">
          ★
        </span>
      )}
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
 * Edge shaping (canonical solid / fork dashed / dependency dot-dashed;
 * markers by direction)
 * -------------------------------------------------------------------- */

function shapePlanEdge(edge: PlanGraphEdge): Edge<PlanEdgeData> {
  const sourceKind = edge.data.source
  const fork = sourceKind === 'planFork'
  const dependency = sourceKind === 'dependency'
  const stale = edge.data.stale === true
  const stroke = dependency ? EDGE_DEPENDENCY : !fork ? EDGE_CANONICAL : (stale ? EDGE_FORK_STALE : EDGE_FORK_OPEN)
  const result: Edge<PlanEdgeData> = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: edge.data,
    className: dependency ? 'rc-edge-dependency' : fork ? 'rc-edge-planfork' : 'rc-edge-canonical',
    style: {
      stroke,
      // UI-5 (B §18.3): the dependency line TYPE is a third, distinct
      // dash pattern ('2 4' dot-dash) — the canonical edge stays SOLID,
      // the fork dashes stay '6 4' / '4 6' (never retouched).
      strokeWidth: dependency ? 1.25 : fork ? 1.5 : 1.5,
      ...(fork
        ? { strokeDasharray: stale ? '4 6' : '6 4', opacity: stale ? 0.55 : 1 }
        : dependency
          ? { strokeDasharray: '2 4' }
          : {}),
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
  /**
   * UI-5 (ADJ-1/ADJ-6): the selected canonical item id (the strip/graph
   * two-way sync — the container's view state; null = nothing selected).
   * Ghost (PF) nodes are never selectable: their edges/clicks no-op.
   */
  readonly selectedItemId?: string | null
  /** UI-5 (ADJ-1): canonical-node click → item selection (the
   *  container syncs the strip; the edit form opens from the strip
   *  face — NO node-peripheral quick edit in v1). Absent = the
   *  WP-4.5 non-interactive face (the cockpit mount). */
  readonly onNodeSelect?: (itemId: string) => void
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
  selectedItemId = null,
  onNodeSelect,
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
        // UI-5: the selection highlight is stamped ONTO the node data
        // (view state — ghosts are never selected).
        data: n.data.source === 'canonical' && selectedItemId !== null && n.id === selectedItemId
          ? { ...n.data, selected: true }
          : n.data,
      })),
    [graph, selectedItemId],
  )

  const flowEdges: Edge<PlanEdgeData>[] = useMemo(() => graph.edges.map(shapePlanEdge), [graph])

  // UI-5 (ADJ-1): node click = SELECT the canonical item (the container
  // syncs the strip two-way; the edit form opens from the strip face).
  // Ghost nodes are not selection targets (ADJ-9: PF stays a low-priority
  // overlay — its entries are the toolbar's, not the nodes').
  const handleNodeClick = useCallback(
    (_event: unknown, node: Node<PlanNodeData>): void => {
      if (node.data.source !== 'canonical' || onNodeSelect === undefined) return
      onNodeSelect(node.id)
    },
    [onNodeSelect],
  )

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
    <div
      className={styles.root}
      data-role="plan-graph"
      data-pf-downgraded={graph.pfDowngraded ? 'true' : undefined}
    >
      <div className={styles.header}>
        <span className={styles.headerTitle}>未来计划</span>
        <span className={styles.headerMeta}>
          正典 {graph.canonicalCount} 项 · 未决提案 {unresolvedCount} 条
        </span>
      </div>

      {/* UI-5 (B §18.3): the legend — MUST exist; the dependency cue is
          a line TYPE, never color-only. The two lines are the B
          verbatim strings (the `ws.future.graph.legend*` keys). */}
      <div className={styles.legend} data-legend>
        <span className={styles.legendRow} data-legend-canonical>
          {t('ws.future.graph.legendCanonical')}
        </span>
        <span className={styles.legendRow} data-legend-dependency>
          {t('ws.future.graph.legendDependency')}
        </span>
      </div>

      {orderedForks.length > 0 && (
        <ul
          className={graph.pfDowngraded ? `${styles.toolbar} ${styles.pfDowngraded}` : styles.toolbar}
          data-role="plan-fork-toolbar"
          data-pf-downgraded={graph.pfDowngraded ? 'true' : undefined}
        >
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
          onNodeClick={handleNodeClick}
          fitView
          minZoom={0.2}
          maxZoom={2}
          className={styles.canvas}
        />
      </div>
    </div>
  )
}
