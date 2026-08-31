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

import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type ReactElement } from 'react'
import { BaseEdge, Handle, MarkerType, Position, ReactFlow, type Edge, type EdgeTypes, type Node, type NodeTypes, type ReactFlowInstance } from '@xyflow/react'
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
  planGraphBounds,
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
  GATE: t('ws.plan.kindGate'),
  TASK: t('ws.plan.kindTask'),
  MILESTONE: t('ws.plan.kindMilestone'),
  PROPOSED: t('ws.plan.kindCandidate'),
}

/** The three change-form icons (INSERT/MOVE/DELETE — §27.6 label split). */
const FORM_ICON: Record<PlanChangeForm, string> = {
  INSERT: '+',
  MOVE: '⇄',
  DELETE: '−',
}

const FORM_LABEL: Record<PlanChangeForm, string> = {
  INSERT: t('ws.plan.modeAdd'),
  MOVE: t('ws.plan.modeReroll'),
  DELETE: t('ws.plan.modeRemove'),
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
    // t70 :663 (UI-5 fix round): the dependency edge renders through the
    // custom arc component (`dependencyArcPath` below); canonical and fork
    // edges keep the built-in bezier (untouched).
    ...(dependency ? { type: 'dependencyArc' } : {}),
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
 * UI-5 fix round (t70 :663) — the dependency edge geometry
 * -------------------------------------------------------------------- *
 * The dependency edge renders as a QUADRATIC ARC bulging above the
 * canonical row, not as the built-in straight-line bezier:
 *
 *  1. In the single-row canonical layout (every item at y=80) a straight
 *     dependency line runs at y=112 EXACTLY along the canonical
 *     progression line between the same nodes — B §18.3 requires the
 *     dependency to read as the weaker, DIFFERENT line type, and the
 *     wireframe's own glyph (§18.2) draws it leaving the row. A line
 *     buried on top of the solid edges (and cutting across the nodes in
 *     between) fails that requirement.
 *  2. A perfectly horizontal SVG line has a ZERO-HEIGHT bounding box,
 *     and Playwright's toBeVisible (computeBox: `width > 0 && height >
 *     0`) can never report it visible — the t70 acceptance assertion on
 *     the dependency edge is unsatisfiable for a straight line. (The
 *     live D5-E capture: d = "M1842,112 C1990,112 1129,112 1278,112",
 *     pathBox height = 0, verdict hidden.)
 *
 * The bulge scales with the source→target span (clamped to 32…96 world
 * px): adjacent items get a small hop, long spans a wide shallow arc.
 * Direction-independent — a reordered plan can put the target left of
 * the source, and the arc still bulges above the row.
 *
 * A CUSTOM edge component (not the built-in bezier) is also required by
 * the t70 path-class assertion: the built-in BezierEdge drops the edge's
 * className on the <g> wrapper ONLY (it does not forward it to BaseEdge),
 * while the acceptance spec requires
 * `path.react-flow__edge-path.rc-edge-dependency` — the class on the
 * PATH. Forwarding to BaseEdge delivers exactly that, with the rest of
 * the DOM contract identical to the built-in edge (wrapper classes,
 * interaction path, arrow marker).
 */

/** Pure geometry: the quadratic-arc path of a dependency edge. */
export function dependencyArcPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): string {
  const dist = Math.hypot(targetX - sourceX, targetY - sourceY)
  const bulge = Math.min(96, Math.max(32, dist * 0.22))
  const midX = (sourceX + targetX) / 2
  const ctrlY = Math.min(sourceY, targetY) - bulge
  return `M ${sourceX} ${sourceY} Q ${midX} ${ctrlY} ${targetX} ${targetY}`
}

/**
 * The registered custom edge for dependency edges (see the block above).
 * React Flow resolves the endpoint coordinates, the marker URL, the edge
 * style (stroke / dash) and the edge className into these props.
 */
function DependencyArcEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
}: {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  style?: CSSProperties
  markerEnd?: string
}): ReactElement {
  // NOTE: the path class is hardcoded, not prop-forwarded: xyflow v12's
  // EdgeWrapper puts the edge className on the <g> wrapper only and does
  // NOT pass it into the edge component (verified against
  // @xyflow/react 12.11.3) — but the t70 path-class assertion
  // (`path.react-flow__edge-path.rc-edge-dependency`) requires it on the
  // PATH. This component is registered under the dedicated `dependencyArc`
  // type key and nothing else uses it, so the hardcoded class is exact.
  //
  // The dash pattern rides a PRESENTATION ATTRIBUTE (stroke-dasharray on
  // the path), not the inline style: React renders `style.strokeDasharray`
  // into the `style=""` attribute only, while the t70 assertion reads the
  // `stroke-dasharray` ATTRIBUTE (B §18.3 不同线型 — readable/inspectable
  // without CSSOM). Lifted out of the style here; the rest (stroke,
  // stroke-width) stays in the inline style, visually identical.
  const dash = style?.strokeDasharray
  const restStyle = dash !== undefined ? { ...style, strokeDasharray: undefined } : style
  return (
    <BaseEdge
      path={dependencyArcPath(sourceX, sourceY, targetX, targetY)}
      className="rc-edge-dependency"
      style={restStyle}
      strokeDasharray={dash}
      markerEnd={markerEnd}
    />
  )
}

const PLAN_EDGE_TYPES: EdgeTypes = {
  dependencyArc: DependencyArcEdge as unknown as EdgeTypes[string],
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

  /* -- FR4 (UI-5 fix round): deterministic viewport fitting --
   *
   * t70 FR2 introduced the re-fit machinery (init fit + content-change
   * refit + pane-resize refit, latched off by the first user pan via
   * onMoveStart) and FR2b lowered minZoom so the centered fit is not
   * clamped. FR2's call path — `inst.fitView()` — is BROKEN for content
   * changes: this module rebuilds every node object on every projection
   * (fresh identity), xyflow's `adoptUserNodes` then discards the
   * measured sizes of all nodes, and the queued fit resolves (one rAF
   * later) against the measured-only filter of `getFitViewNodes` — an
   * empty set. The fit no-ops and the viewport FREEZES at the previous
   * layout; with TC-PERF-006 virtualization the cull then drops the
   * items outside the stale fit (t70 :553: 10 of 12 rendered, both
   * mounts, deterministic).
   *
   * FR4 fits with `fitBounds` instead: a pure function of the EXPLICIT
   * layout bounds (planGraphBounds — the CSS-fixed node size at the
   * projected positions) and the pane size in the store. No measured
   * sizes, no rAF queue, no measurement race: the viewport is correct
   * in the same commit the content changes, so the virtualized cull
   * keeps every item inside the new fit. The `fitView` PROP is retired
   * along with it (its store-init queued fit is the same broken path).
   *
   * FR4-fix (UI-5 fix round): the user-gesture latch must null-filter.
   * d3-zoom's `zoom.transform` direct path emits a 'start' event with
   * `sourceEvent = null`, and XYPanZoom's start handler only skips
   * `event.sourceEvent?.internal` — so EVERY programmatic fit (the
   * mount fit included) fires onMoveStart with null. Latching on null
   * self-triggers: the first fit sets userMovedRef, and every later
   * refit (content change, pane resize) bails inside fitNowRef — the
   * viewport freezes at the first fit's bounds. handleMoveStart below
   * therefore ignores null/undefined events and latches only on real
   * DOM gesture events.
   */
  const flowRef = useRef<ReactFlowInstance<Node<PlanNodeData>, Edge<PlanEdgeData>> | null>(null)
  const userMovedRef = useRef(false)
  const canvasWrapRef = useRef<HTMLDivElement | null>(null)

  /** The latest fit closure (render-assigned so the once-per-mount
   *  `onInit` and the `[]`-deps ResizeObserver effect both see the
   *  current `graph`). */
  const fitNowRef = useRef<
    ((inst: ReactFlowInstance<Node<PlanNodeData>, Edge<PlanEdgeData>>) => void) | null
  >(null)
  fitNowRef.current = (inst): void => {
    if (userMovedRef.current) return
    const bounds = planGraphBounds(graph)
    if (bounds === null) return
    void inst.fitBounds(bounds, { duration: 0 })
  }

  const handleInit = useCallback(
    (inst: ReactFlowInstance<Node<PlanNodeData>, Edge<PlanEdgeData>>): void => {
      flowRef.current = inst
      // The pane may not be measured yet at onInit (fitBounds then
      // no-ops against a missing panZoom) — the ResizeObserver's
      // initial callback re-runs the fit once the pane size lands.
      fitNowRef.current?.(inst)
    },
    [],
  )

  const contentKey = useMemo(
    () => graph.nodes.map((n: PlanGraphNode) => n.id).join('\u0000') + '|' + graph.edges.length,
    [graph],
  )

  useEffect(() => {
    const inst = flowRef.current
    if (inst === null) return
    fitNowRef.current?.(inst)
  }, [contentKey])

  useEffect(() => {
    const el = canvasWrapRef.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((): void => {
      const inst = flowRef.current
      if (inst === null) return
      fitNowRef.current?.(inst)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const handleMoveStart = useCallback((event: MouseEvent | TouchEvent | WheelEvent | null): void => {
    // xyflow fires onMoveStart with `null` (the d3 sourceEvent) for
    // PROGRAMMATIC transforms too: d3-zoom emits 'start' on the
    // `zoom.transform` direct path, and XYPanZoom's start handler only
    // filters `event.sourceEvent?.internal` — null is not internal. A
    // guard that latched on null would freeze the viewport at the FIRST
    // (mount-time) fit and silently block every later content/resize
    // refit. Genuine user gestures carry a real DOM event; only those
    // latch the guard.
    if (event !== null && event !== undefined) {
      userMovedRef.current = true
    }
  }, [])

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
        <span className={styles.headerTitle}>{t('ws.plan.title')}</span>
        <span className={styles.headerMeta}>
          {t('ws.plan.summary', { canonical: String(graph.canonicalCount), unresolved: String(unresolvedCount) })}
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
                  {stale ? t('status.expired') : t('status.pending')}
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
                    title={stale ? t('ws.plan.expiredNote') : undefined}
                    onClick={() => onSelectFork(fork.id)}
                  >
                    {t('ws.plan.select')}
                  </button>
                  <button type="button" className={styles.dismissBtn} data-pf={fork.id} onClick={() => onDismissFork(fork.id)}>
                    {t('pf.ignore')}
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <div className={styles.canvasWrap} ref={canvasWrapRef}>
        {/* t70 FR2b (UI-5 fix round): the minZoom floor. The canonical row is
            a HORIZONTAL sequence (node i at x=i·320, each 240px wide): a
            9-item plan spans 0…2800px, the 106-item WS-4 stress plan spans
            ~33840px. The WS third-column pane is only ~278px wide, so
            fitView must reach zoom ≈0.10 (9 items) down to ≈0.0066 (106
            items). A floor of 0.2 clamped the fit to the centered middle
            band, and onlyRenderVisibleElements (TC-PERF-006) then culled the
            head/tail nodes from the DOM (t70 saw 5-7 of 9 canonical nodes).
            0.001 sits far below the ~0.0066 the 106-item plan needs (~6×
            headroom) while never clamping any realistic plan; it only bounds
            how far out the user may zoom — the fit, layout, and every
            rendered face are unchanged. */}
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={PLAN_NODE_TYPES}
          edgeTypes={PLAN_EDGE_TYPES}
          onlyRenderVisibleElements={virtualize}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeClick={handleNodeClick}
          onInit={handleInit}
          onMoveStart={handleMoveStart}
          /* FR4: NO `fitView` prop — its store-init queued fit travels
             the same measured-size path as `inst.fitView()` (the broken
             one, see the FR4 block above). All viewport fitting is the
             deterministic `fitBounds` machinery. */
          minZoom={0.001}
          maxZoom={2}
          className={styles.canvas}
        />
      </div>
    </div>
  )
}
