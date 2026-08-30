/**
 * TopologyGraphView (WP-4.5, extended UI-6 D4) — the PURE-PROPS
 * presentation of the §27.5 Workstream topology graph: directed FORK/MERGE
 * edges between Workstream nodes.
 *
 * Discipline: same two-layer contract as PlanGraphView — zero store/ctx,
 * the graph arrives from the container (`topologyToGraph` on the store
 * slice), hooks are component-internal behavior only (the xyflow
 * base-style effect, the local history-mode toggle, and — UI-6 — the
 * dialog open/close state: plain `useState`, the showDropped precedent).
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
 *
 * UI-6 D4 (B §10.3/§10.4/§21/§22/§23, ADJ-9 — the Topic-page topology
 * zone is the single first-version mutation entry, ADJ-6):
 *  - the LEGEND (B §10.3 mandatory): three-state line forms + FORK/MERGE
 *    arrow forms + the merge-contract badge;
 *  - the ACTION BAR (B §10.4): Create Fork / Create Planned Merge / Drop;
 *  - the FORK form (B §21.2: Fork from + N titles + optional note) and the
 *    MERGE form (B §22: inputs multi-select + output select + note + the
 *    "Merge Contract: [Create / Edit later]" hint — ADJ-7: the create face
 *    carries no contract field);
 *  - the DROP confirmation (ADJ-5: PLANNED edges only; the state line
 *    carries the edge's current lifecycle — the three-state distinction);
 *  - the MERGE-CONTRACT editor (B §23 / ADJ-7: raw Markdown textarea,
 *    "No merge contract [Create]" state, full replacement on Save, no
 *    front-matter parsing, no "Last updated" — the DTO has no timestamp
 *    face; entry = the merge EDGE CLICK, B §23.1);
 *  - the custom `topoEdge` component: the edge class + the `data-edge-id`
 *    hook ride the PATH (xyflow v12's EdgeWrapper puts the edge className
 *    on the `<g>` wrapper only and does NOT pass it into the edge
 *    component — verified against @xyflow/react 12.11.3 — the R-08 gap the
 *    e2e edge assertions need);
 *  - all NEW copy through `t()` under `topic.topology.*` (the R-09 scope:
 *    pre-existing hardcoded strings are NOT retrofitted here).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  BaseEdge,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getBezierPath,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react'
import { t } from '../i18n/copy.js'
import type { WorkstreamCardDto } from '../../shared/rpc-contracts.js'
import type {
  TopologyEdgeData,
  TopologyGraphEdge,
  TopologyGraphData,
  TopologyNodeData,
  TopologyGraphNode,
} from './topology-model.js'
import { topologyGraphBounds } from './topology-model.js'
import {
  CONFIRM_DIALOG_STYLES as dialogChrome,
  TOPOLOGY_GRAPH_STYLES as styles,
  ensureGraphStyles,
} from './graph-styles.js'

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

/**
 * The UI-6 D4 custom edge (registered as `topoEdge`). React Flow resolves
 * the endpoint coordinates, the marker URL, the edge style (stroke / dash)
 * and the edge data into these props; the path is the plain bezier (the
 * §27.5 convention — same geometry as the built-in default edge).
 *
 * NOTE: the class + `data-edge-id` are DERIVED FROM `data` and rendered on
 * the PATH (R-08): xyflow v12's EdgeWrapper puts the edge className on the
 * `<g>` wrapper only and does NOT pass it into the edge component (verified
 * against @xyflow/react 12.11.3), so the wrapper-level class is not
 * reachable from a path-level assertion. `data` carries `edgeId` /
 * `operation` / `lifecycle` (the model projection, `topology-model.ts`), so
 * the same class string the wrapper receives is reconstructed here and the
 * REAL edge id (not the input×output pair id) rides the path attribute.
 */
interface TopoEdgeProps {
  readonly sourceX: number
  readonly sourceY: number
  readonly targetX: number
  readonly targetY: number
  readonly sourcePosition?: Position
  readonly targetPosition?: Position
  readonly style?: CSSProperties
  readonly markerEnd?: string
  readonly data?: TopologyEdgeData
  readonly label?: string
  readonly labelStyle?: CSSProperties
  readonly labelBgStyle?: CSSProperties
  readonly labelBgPadding?: [number, number]
  readonly labelBgBorderRadius?: number
}

function TopoEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
  label,
  labelStyle,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
}: TopoEdgeProps): ReactElement {
  const operation = data?.operation ?? 'FORK'
  const lifecycle = data?.lifecycle ?? 'PLANNED'
  const cls = [
    'rc-topo-edge',
    `rc-topo-edge--${operation.toLowerCase()}`,
    `rc-topo-edge--${lifecycle.toLowerCase()}`,
  ].join(' ')
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  // The dash pattern rides a PRESENTATION ATTRIBUTE (stroke-dasharray on
  // the path), not the inline style — the PlanGraphView DependencyArcEdge
  // idiom (readable/inspectable without CSSOM); the rest (stroke, width,
  // opacity) stays in the inline style, visually identical.
  const dash = style?.strokeDasharray
  const restStyle = dash !== undefined ? { ...style, strokeDasharray: undefined } : style
  return (
    <BaseEdge
      path={path}
      labelX={labelX}
      labelY={labelY}
      label={label}
      labelStyle={labelStyle}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      className={cls}
      style={restStyle}
      strokeDasharray={dash}
      markerEnd={markerEnd}
      data-edge-id={data?.edgeId}
    />
  )
}

const TOPOLOGY_EDGE_TYPES: EdgeTypes = { topoEdge: TopoEdge as unknown as EdgeTypes[string] }

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
    // UI-6 D4: the custom edge component (R-08 — the class + the
    // `data-edge-id` hook are rendered on the path inside it).
    type: 'topoEdge',
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
 * UI-6 D4: the dialog shell (the overlay + frame reuse the vendored
 * ConfirmDialog chrome; the content is topology-specific)
 * -------------------------------------------------------------------- */

type TopologyDialogKind = 'fork' | 'merge' | 'drop' | 'contract'

type TopologyDialog =
  | { readonly kind: 'fork' }
  | { readonly kind: 'merge' }
  | { readonly kind: 'drop' }
  | { readonly kind: 'contract'; readonly edgeId: string }

interface TopoDialogFrameProps {
  readonly kind: TopologyDialogKind
  readonly title: string
  readonly children: ReactNode
}

function TopoDialogFrame({ kind, title, children }: TopoDialogFrameProps): ReactElement {
  return (
    <div className={dialogChrome.overlay} data-topology-dialog={kind}>
      <div className={dialogChrome.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <h3 className={dialogChrome.title}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- *
 * The view
 * -------------------------------------------------------------------- */

/** The loaded merge-contract document (ADJ-7: absent ⇒ content null). */
interface ContractDocState {
  readonly edgeId: string
  readonly status: 'loading' | 'ready'
  readonly content: string | null
  readonly path: string | null
}

export interface TopologyGraphViewProps {
  /** The derived graph (container ran `topologyToGraph` on the store slice). */
  readonly graph: TopologyGraphData
  /** React Flow viewport virtualization (TC-PERF-006). Default true. */
  readonly virtualize?: boolean
  /** UI-6 D4: the topic's Workstream cards (the form option lists). */
  readonly workstreams?: readonly WorkstreamCardDto[]
  /** UI-6 D4: the Create Fork entry (B §21). Absent ⇒ the entry is disabled. */
  readonly onCreateFork?: (input: {
    readonly parentWorkstreamId: string
    readonly children: readonly { readonly title: string; readonly note?: string }[]
  }) => Promise<void>
  /**
   * UI-6 D4: the Create Planned Merge entry (B §22). Resolves the NEW edge
   * id — the contract editor auto-opens on it (B §22 "Create / Edit
   * later"); undefined ⇒ no auto-open.
   */
  readonly onCreateMerge?: (input: {
    readonly inputWorkstreamIds: string[]
    readonly outputWorkstreamId: string
    readonly note?: string
  }) => Promise<string | undefined>
  /** UI-6 D4: the Drop entry (B §10.4 / ADJ-5). */
  readonly onDropEdge?: (edgeId: string) => Promise<void>
  /**
   * UI-6 D4: the merge-contract read (ADJ-7: a missing contract resolves
   * `content: null` — a value face, not an error). Absent ⇒ the contract
   * entry (the merge-edge click) is disabled.
   */
  readonly loadContract?: (
    edgeId: string,
  ) => Promise<{ readonly content: string | null; readonly path: string }>
  /** UI-6 D4: the merge-contract write (full replacement). Absent ⇒ Save disabled. */
  readonly onSaveContract?: (edgeId: string, content: string) => Promise<void>
}

/**
 * Render the topic topology graph: the legend (B §10.3), the action bar
 * (B §10.4), the history-mode toggle + the React Flow canvas (Workstream
 * nodes, directed FORK/MERGE edges), and the four topology dialogs.
 *
 * Every dialog's open/close state is DISPLAY-INTERNAL (plain `useState` —
 * hooks are component-internal behavior per the two-layer discipline — no
 * store, no parent round-trip; the showDropped precedent). The mutation
 * callbacks are CONTAINER-SUPPLIED and the store never reaches this layer.
 */
export function TopologyGraphView({
  graph,
  virtualize = true,
  workstreams,
  onCreateFork,
  onCreateMerge,
  onDropEdge,
  loadContract,
  onSaveContract,
}: TopologyGraphViewProps): ReactElement {
  const [showDropped, setShowDropped] = useState(false)
  const [dialog, setDialog] = useState<TopologyDialog | null>(null)

  /* -- fork form state (B §21.2) -------------------------------------- */
  const [forkParent, setForkParent] = useState('')
  const [forkTitles, setForkTitles] = useState<string[]>(['', ''])
  const [forkNote, setForkNote] = useState('')
  const [forkError, setForkError] = useState<string | null>(null)
  const [forkBusy, setForkBusy] = useState(false)

  /* -- merge form state (B §22) ---------------------------------------- */
  const [mergeInputs, setMergeInputs] = useState<string[]>([])
  const [mergeOutput, setMergeOutput] = useState('')
  const [mergeNote, setMergeNote] = useState('')
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [mergeBusy, setMergeBusy] = useState(false)

  /* -- drop state (B §10.4 / ADJ-5) ------------------------------------ */
  const [dropEdgeId, setDropEdgeId] = useState('')
  const [dropError, setDropError] = useState<string | null>(null)
  const [dropBusy, setDropBusy] = useState(false)

  /* -- contract editor state (B §23 / ADJ-7) --------------------------- */
  const [contract, setContract] = useState<ContractDocState | null>(null)
  const [contractDraft, setContractDraft] = useState('')
  const [contractEditing, setContractEditing] = useState(false)
  const [contractSaving, setContractSaving] = useState(false)
  const [contractError, setContractError] = useState<string | null>(null)

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

  // UI-6 D4: the form option lists. DROPPED Workstreams are CURATION-
  // EXCLUDED (a dropped branch is not a valid fork parent or merge
  // endpoint; the service stays the authority — disclosed).
  const wsOptions = useMemo(
    () => (workstreams ?? []).filter(w => w.lifecycle !== 'DROPPED'),
    [workstreams],
  )
  // ADJ-5: the first-version drop entry offers PLANNED edges only.
  const plannedEdges = useMemo(() => graph.edges.filter(e => e.data.lifecycle === 'PLANNED'), [graph])

  const hasMutationFace =
    onCreateFork !== undefined || onCreateMerge !== undefined || onDropEdge !== undefined

  /* -------------------------------------------------------------------- *
   * Viewport fitting (UI-6 #20 — the FR4 port from PlanGraphView)
   *
   * The naive `fitView` PROP (and `inst.fitView()`) is BROKEN for this
   * view for the same reason t70 FR2 documented for the plan graph:
   * the projection rebuilds every node object (fresh identity), xyflow's
   * `adoptUserNodes` discards the measured sizes, and the queued fit
   * resolves against the measured-only set — a no-op. With
   * `onlyRenderVisibleElements` (TC-PERF-006) the viewport then FREEZES
   * and the virtualized cull drops the nodes outside the stale fit:
   * t71 run-6 + the live probes (3×, surviving reload) mounted the
   * final 6-Workstream state and rendered ONLY 2 of 6 nodes (transform
   * stuck at `translate(269px, -36.1px) scale(0.2)` — the minZoom clamp
   * — whose visible flow-y window [180.5, 2380] excludes row 0 at
   * y=60).
   *
   * #20 fits with `fitBounds` instead: a pure function of the EXPLICIT
   * layout bounds (`topologyGraphBounds` — the CSS-fixed node size at
   * the projected positions) and the pane size. No measured sizes, no
   * rAF queue, no measurement race: the viewport is correct in the same
   * commit the content changes, so the virtualized cull keeps every
   * item inside the new fit (incl. the spec's reload-tail direct mount
   * of the final state). The `fitView` PROP is retired along with the
   * `fitView()` call path (its store-init queued fit is the same broken
   * path).
   *
   * The user-gesture latch null-filters: d3-zoom's `zoom.transform`
   * direct path emits 'start' with `sourceEvent = null`, so EVERY
   * programmatic fit (the mount fit included) fires onMoveStart with
   * null; latching on null would freeze the viewport at the first fit.
   * -------------------------------------------------------------------- */
  const flowRef = useRef<
    ReactFlowInstance<Node<TopologyNodeData>, Edge<TopologyEdgeData>> | null
  >(null)
  const userMovedRef = useRef(false)
  const canvasWrapRef = useRef<HTMLDivElement | null>(null)

  /** The latest fit closure (render-assigned so the once-per-mount
   *  `onInit` and the `[]`-deps ResizeObserver effect both see the
   *  current `graph`). */
  const fitNowRef = useRef<
    ((inst: ReactFlowInstance<Node<TopologyNodeData>, Edge<TopologyEdgeData>>) => void) | null
  >(null)
  fitNowRef.current = (inst): void => {
    if (userMovedRef.current) return
    const bounds = topologyGraphBounds(graph)
    if (bounds === null) return
    void inst.fitBounds(bounds, { duration: 0 })
  }

  const handleInit = useCallback(
    (inst: ReactFlowInstance<Node<TopologyNodeData>, Edge<TopologyEdgeData>>): void => {
      flowRef.current = inst
      // The pane may not be measured yet at onInit (fitBounds then
      // no-ops against a missing panZoom) — the ResizeObserver's
      // initial callback re-runs the fit once the pane size lands.
      fitNowRef.current?.(inst)
    },
    [],
  )

  const contentKey = useMemo(
    () => graph.nodes.map((n: TopologyGraphNode) => n.id).join('\u0000') + '|' + graph.edges.length,
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

  const closeDialog = useCallback(() => setDialog(null), [])

  /* -- the openers (form state is reset per open) ----------------------- */

  const openFork = useCallback(() => {
    setForkParent(wsOptions[0]?.id ?? '')
    setForkTitles(['', ''])
    setForkNote('')
    setForkError(null)
    setForkBusy(false)
    setDialog({ kind: 'fork' })
  }, [wsOptions])

  const openMerge = useCallback(() => {
    setMergeInputs([])
    setMergeOutput('')
    setMergeNote('')
    setMergeError(null)
    setMergeBusy(false)
    setDialog({ kind: 'merge' })
  }, [])

  const openDrop = useCallback(() => {
    setDropEdgeId(plannedEdges[0]?.data.edgeId ?? '')
    setDropError(null)
    setDropBusy(false)
    setDialog({ kind: 'drop' })
  }, [plannedEdges])

  const openContract = useCallback((edgeId: string) => setDialog({ kind: 'contract', edgeId }), [])

  /* -- the contract document load (view-internal, B §23) ---------------- */

  useEffect(() => {
    if (dialog?.kind !== 'contract' || loadContract === undefined) return
    const edgeId = dialog.edgeId
    let cancelled = false
    setContract({ edgeId, status: 'loading', content: null, path: null })
    setContractDraft('')
    setContractEditing(false)
    setContractError(null)
    void loadContract(edgeId)
      .then((doc) => {
        if (cancelled) return
        setContract({ edgeId, status: 'ready', content: doc.content, path: doc.path })
        setContractDraft(doc.content ?? '')
        // An EXISTING contract opens straight in the editable view
        // (B §23.3 [View]/[Edit] collapse to one surface — v1 has no
        // separate read-only mode; disclosed).
        if (doc.content !== null) setContractEditing(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setContract({ edgeId, status: 'ready', content: null, path: null })
        setContractError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [dialog, loadContract])

  /* -- the edge click (B §23.1: the merge edge is the contract entry) --- */

  const handleEdgeClick = useCallback(
    (_event: unknown, edge: Edge) => {
      const data = edge.data as TopologyEdgeData | undefined
      // B §23.1: the merge contract belongs to the merge edge only.
      if (data?.operation !== 'MERGE' || loadContract === undefined) return
      openContract(data.edgeId)
    },
    [loadContract, openContract],
  )

  /* -- the form handlers (validation first; the store round-trip is the
     container's callback — a rejection surfaces as the dialog error) ----- */

  const setForkTitleAt = (index: number, value: string): void => {
    setForkTitles(prev => prev.map((title, i) => (i === index ? value : title)))
  }
  const addForkTitle = (): void => setForkTitles(prev => [...prev, ''])
  // children ≥ 1 (the last row cannot be removed — B §21.2 "N titles").
  const removeForkTitleAt = (index: number): void =>
    setForkTitles(prev => (prev.length < 2 ? prev : prev.filter((_, i) => i !== index)))
  const toggleMergeInput = (id: string): void => {
    setMergeInputs(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  async function submitFork(): Promise<void> {
    if (onCreateFork === undefined || forkBusy) return
    if (forkParent === '') {
      setForkError(t('topic.topology.fork.errParent'))
      return
    }
    if (forkTitles.length < 1) {
      setForkError(t('topic.topology.fork.errAtLeastOne'))
      return
    }
    for (const title of forkTitles) {
      const trimmed = title.trim()
      if (trimmed.length < 1 || trimmed.length > 200) {
        setForkError(t('topic.topology.fork.errTitleLength'))
        return
      }
    }
    if (forkNote.length > 200) {
      setForkError(t('topic.topology.fork.errNoteLength'))
      return
    }
    setForkError(null)
    setForkBusy(true)
    try {
      // B §21.2: the single "Optional note" fans out to EVERY child
      // (the frozen wire carries a per-child note — they are identical).
      const note = forkNote.trim()
      await onCreateFork({
        parentWorkstreamId: forkParent,
        children: forkTitles.map(title =>
          note === '' ? { title: title.trim() } : { title: title.trim(), note },
        ),
      })
      setDialog(null)
    } catch (err) {
      setForkError(err instanceof Error ? err.message : String(err))
    } finally {
      setForkBusy(false)
    }
  }

  async function submitMerge(): Promise<void> {
    if (onCreateMerge === undefined || mergeBusy) return
    if (new Set(mergeInputs).size < 2) {
      setMergeError(t('topic.topology.merge.errInputs'))
      return
    }
    if (mergeOutput === '') {
      setMergeError(t('topic.topology.merge.errOutput'))
      return
    }
    // UI-level gate (the service does not check this — disclosed).
    if (mergeInputs.includes(mergeOutput)) {
      setMergeError(t('topic.topology.merge.errOutputInInputs'))
      return
    }
    setMergeError(null)
    setMergeBusy(true)
    try {
      const edgeId = await onCreateMerge({
        inputWorkstreamIds: mergeInputs,
        outputWorkstreamId: mergeOutput,
        ...(mergeNote.trim() === '' ? {} : { note: mergeNote.trim() }),
      })
      setDialog(null)
      // B §22: "Merge Contract: [Create / Edit later]" — the editor opens
      // on the NEW edge (content = null until the first Save).
      if (edgeId !== undefined) setDialog({ kind: 'contract', edgeId })
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : String(err))
    } finally {
      setMergeBusy(false)
    }
  }

  async function submitDrop(): Promise<void> {
    if (onDropEdge === undefined || dropBusy || dropEdgeId === '') return
    setDropError(null)
    setDropBusy(true)
    try {
      await onDropEdge(dropEdgeId)
      setDialog(null)
    } catch (err) {
      setDropError(err instanceof Error ? err.message : String(err))
    } finally {
      setDropBusy(false)
    }
  }

  async function submitContractSave(): Promise<void> {
    if (dialog?.kind !== 'contract' || onSaveContract === undefined || contractSaving) return
    const edgeId = dialog.edgeId
    // Whitespace-only = empty (the wire gate is min 1 raw characters —
    // the UI trim gate is a superset; the SAVED bytes are the raw draft).
    if (contractDraft.trim().length < 1) {
      setContractError(t('topic.topology.contract.errEmpty'))
      return
    }
    setContractError(null)
    setContractSaving(true)
    try {
      await onSaveContract(edgeId, contractDraft)
      setDialog(null)
    } catch (err) {
      setContractError(err instanceof Error ? err.message : String(err))
    } finally {
      setContractSaving(false)
    }
  }

  /** One DROP option per REAL edge (never per pair): a multi-input MERGE
   *  expands into one flow edge per input pair, and the DROP targets the
   *  TE id — dedupe by edgeId and show the full endpoint set (RELY
   *  direction: inputs → output). */
  const plannedEdgeOptions = useMemo(() => {
    const groups = new Map<
      string,
      { operation: 'FORK' | 'MERGE'; lifecycle: 'PLANNED' | 'REALIZED' | 'DROPPED'; sources: string[]; target: string; note: string | null }
    >()
    for (const e of plannedEdges) {
      const g = groups.get(e.data.edgeId)
      if (g === undefined) {
        groups.set(e.data.edgeId, {
          operation: e.data.operation,
          lifecycle: e.data.lifecycle,
          sources: [e.source],
          target: e.target,
          note: e.data.note,
        })
      } else if (!g.sources.includes(e.source)) {
        g.sources.push(e.source)
      }
    }
    return [...groups.entries()].map(([edgeId, g]) => ({ edgeId, ...g }))
  }, [plannedEdges])

  const dropOption = useMemo(
    () => plannedEdgeOptions.find(o => o.edgeId === dropEdgeId) ?? null,
    [plannedEdgeOptions, dropEdgeId],
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

      {/* UI-6 D4: the legend (B §10.3 — mandatory). */}
      <div className={styles.legend} data-topology-legend>
        <div className={styles.legendRow} data-legend-row="lifecycle">
          <span className={styles.legendItem} data-legend="realized">
            <svg className={styles.legendArrow} width="30" height="8" aria-hidden="true">
              <line className={styles.legendLine} data-legend-line="realized" x1="0" y1="4" x2="30" y2="4" />
            </svg>
            {t('topic.topology.legend.realized')}
          </span>
          <span className={styles.legendItem} data-legend="planned">
            <svg className={styles.legendArrow} width="30" height="8" aria-hidden="true">
              <line className={styles.legendLine} data-legend-line="planned" x1="0" y1="4" x2="30" y2="4" />
            </svg>
            {t('topic.topology.legend.planned')}
          </span>
          <span className={styles.legendItem} data-legend="dropped">
            <svg className={styles.legendArrow} width="30" height="8" aria-hidden="true">
              <line className={styles.legendLine} data-legend-line="dropped" x1="0" y1="4" x2="30" y2="4" />
            </svg>
            {t('topic.topology.legend.dropped')}
          </span>
        </div>
        <div className={styles.legendRow} data-legend-row="form">
          <span className={styles.legendItem} data-legend="fork">
            <svg className={styles.legendArrow} width="30" height="10" aria-hidden="true">
              <line x1="0" y1="5" x2="22" y2="5" stroke="currentColor" strokeWidth="1.5" />
              {/* open (stripped) arrow — FORK: route fanning OUT */}
              <path d="M 22 1 L 29 5 L 22 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            {t('topic.topology.legend.fork')}
          </span>
          <span className={styles.legendItem} data-legend="merge">
            <svg className={styles.legendArrow} width="30" height="10" aria-hidden="true">
              <line x1="0" y1="5" x2="22" y2="5" stroke="currentColor" strokeWidth="1.5" />
              {/* filled arrow — MERGE: route converging IN */}
              <path d="M 22 1 L 29 5 L 22 9 Z" fill="currentColor" stroke="none" />
            </svg>
            {t('topic.topology.legend.merge')}
          </span>
          <span className={styles.legendItem} data-legend="contract">
            <span className={styles.legendChip}>{t('topic.topology.legend.contractChip')}</span>
            {t('topic.topology.legend.contract')}
          </span>
        </div>
      </div>

      {/* UI-6 D4: the action bar (B §10.4 — the single first-version
          mutation entry seat, ADJ-6). */}
      {hasMutationFace && (
        <div className={styles.actionBar} data-topology-actions>
          <button
            type="button"
            className={styles.actionBtn}
            data-topology-action="fork"
            onClick={openFork}
            disabled={onCreateFork === undefined}
          >
            {t('topic.topology.action.createFork')}
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            data-topology-action="merge"
            onClick={openMerge}
            disabled={onCreateMerge === undefined || wsOptions.length < 2}
          >
            {t('topic.topology.action.createMerge')}
          </button>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
            data-topology-action="drop"
            onClick={openDrop}
            disabled={onDropEdge === undefined || plannedEdges.length === 0}
          >
            {t('topic.topology.action.drop')}
          </button>
        </div>
      )}

      <div className={styles.canvasWrap} ref={canvasWrapRef}>
        {/* #20 (FR4 port): NO `fitView` prop — its store-init queued fit
            travels the same measured-size path as `inst.fitView()` (the
            broken one, see the fit block above). All viewport fitting is
            the deterministic `fitBounds` machinery. minZoom 0.001 mirrors
            PlanGraphView's FR2b floor (a 0.2 floor clamped the fit — the
            probes' stuck `scale(0.2)` — and both graphs must fit wide
            layouts without clamping); maxZoom 2 unchanged. */}
        <ReactFlow
          nodes={flowNodes}
          edges={visibleEdges}
          nodeTypes={TOPOLOGY_NODE_TYPES}
          edgeTypes={TOPOLOGY_EDGE_TYPES}
          onEdgeClick={loadContract !== undefined ? handleEdgeClick : undefined}
          onlyRenderVisibleElements={virtualize}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          onInit={handleInit}
          onMoveStart={handleMoveStart}
          minZoom={0.001}
          maxZoom={2}
          className={styles.canvas}
        />
      </div>

      {/* UI-6 D4: the fork form (B §21.2). */}
      {dialog?.kind === 'fork' && (
        <TopoDialogFrame kind="fork" title={t('topic.topology.fork.title')}>
          <div className={styles.dialogField}>
            <label className={styles.dialogLabel} htmlFor="topo-fork-parent">
              {t('topic.topology.fork.from')}
            </label>
            <select
              id="topo-fork-parent"
              className={styles.select}
              data-fork-parent
              value={forkParent}
              onChange={e => setForkParent(e.target.value)}
            >
              {wsOptions.map(ws => (
                <option key={ws.id} value={ws.id}>
                  {ws.id} — {ws.title}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.dialogField}>
            <span className={styles.dialogLabel}>{t('topic.topology.fork.newWorkstreams')}</span>
            {forkTitles.map((title, i) => (
              <div key={i} className={styles.childRow}>
                <input
                  className={styles.input}
                  data-fork-title-index={i}
                  placeholder={t('topic.topology.fork.titlePlaceholder')}
                  value={title}
                  onChange={e => setForkTitleAt(i, e.target.value)}
                />
                <button
                  type="button"
                  className={styles.iconBtn}
                  data-fork-remove={i}
                  aria-label={t('topic.topology.fork.remove')}
                  title={t('topic.topology.fork.remove')}
                  disabled={forkTitles.length < 2}
                  onClick={() => removeForkTitleAt(i)}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className={styles.iconBtn} data-fork-add onClick={addForkTitle}>
              {t('topic.topology.fork.add')}
            </button>
          </div>
          <div className={styles.dialogField}>
            <label className={styles.dialogLabel} htmlFor="topo-fork-note">
              {t('topic.topology.fork.noteLabel')}
            </label>
            <input
              id="topo-fork-note"
              className={styles.input}
              data-fork-note
              placeholder={t('topic.topology.fork.notePlaceholder')}
              value={forkNote}
              onChange={e => setForkNote(e.target.value)}
            />
          </div>
          {forkError !== null && (
            <p className={styles.dialogError} data-fork-error>
              {forkError}
            </p>
          )}
          <div className={styles.dialogActions}>
            <button type="button" className={dialogChrome.cancelBtn} data-fork-cancel onClick={closeDialog}>
              {t('topic.topology.cancel')}
            </button>
            <button
              type="button"
              className={dialogChrome.confirmBtn}
              data-fork-submit
              disabled={forkBusy}
              onClick={() => {
                void submitFork()
              }}
            >
              {forkBusy ? t('topic.topology.saving') : t('topic.topology.action.createFork')}
            </button>
          </div>
        </TopoDialogFrame>
      )}

      {/* UI-6 D4: the merge form (B §22). */}
      {dialog?.kind === 'merge' && (
        <TopoDialogFrame kind="merge" title={t('topic.topology.merge.title')}>
          <div className={styles.dialogField}>
            <span className={styles.dialogLabel}>{t('topic.topology.merge.inputs')}</span>
            <div data-merge-inputs>
              {wsOptions.map(ws => (
                <label key={ws.id} className={styles.checkRow}>
                  <input
                    type="checkbox"
                    data-merge-input={ws.id}
                    checked={mergeInputs.includes(ws.id)}
                    onChange={() => toggleMergeInput(ws.id)}
                  />
                  {ws.id} — {ws.title}
                </label>
              ))}
            </div>
          </div>
          <div className={styles.dialogField}>
            <label className={styles.dialogLabel} htmlFor="topo-merge-output">
              {t('topic.topology.merge.output')}
            </label>
            <select
              id="topo-merge-output"
              className={styles.select}
              data-merge-output
              value={mergeOutput}
              onChange={e => setMergeOutput(e.target.value)}
            >
              <option value="">{t('topic.topology.merge.outputPlaceholder')}</option>
              {wsOptions.map(ws => (
                <option key={ws.id} value={ws.id}>
                  {ws.id} — {ws.title}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.dialogField}>
            <label className={styles.dialogLabel} htmlFor="topo-merge-note">
              {t('topic.topology.merge.noteLabel')}
            </label>
            <input
              id="topo-merge-note"
              className={styles.input}
              data-merge-note
              placeholder={t('topic.topology.merge.notePlaceholder')}
              value={mergeNote}
              onChange={e => setMergeNote(e.target.value)}
            />
          </div>
          <p className={styles.dialogMeta} data-merge-contract-hint>
            {t('topic.topology.merge.contractLater')}
          </p>
          {mergeError !== null && (
            <p className={styles.dialogError} data-merge-error>
              {mergeError}
            </p>
          )}
          <div className={styles.dialogActions}>
            <button type="button" className={dialogChrome.cancelBtn} data-merge-cancel onClick={closeDialog}>
              {t('topic.topology.cancel')}
            </button>
            <button
              type="button"
              className={dialogChrome.confirmBtn}
              data-merge-submit
              disabled={mergeBusy}
              onClick={() => {
                void submitMerge()
              }}
            >
              {mergeBusy ? t('topic.topology.saving') : t('topic.topology.action.createMerge')}
            </button>
          </div>
        </TopoDialogFrame>
      )}

      {/* UI-6 D4: the drop confirmation (B §10.4 / ADJ-5 — PLANNED edges
          only; the state line carries the current lifecycle). */}
      {dialog?.kind === 'drop' && (
        <TopoDialogFrame kind="drop" title={t('topic.topology.drop.title')}>
          <div className={styles.dialogField}>
            <label className={styles.dialogLabel} htmlFor="topo-drop-edge">
              {t('topic.topology.drop.edgeLabel')}
            </label>
            <select
              id="topo-drop-edge"
              className={styles.select}
              data-drop-edge
              value={dropEdgeId}
              onChange={e => setDropEdgeId(e.target.value)}
            >
              {plannedEdges.length === 0 && <option value="">{t('topic.topology.drop.selectPlaceholder')}</option>}
              {plannedEdgeOptions.map(o => (
                <option key={o.edgeId} value={o.edgeId}>
                  {o.edgeId} · {o.operation} · {o.sources.join(', ')} → {o.target}
                  {o.note !== null ? ` (${o.note})` : ''}
                </option>
              ))}
            </select>
          </div>
          {dropOption !== null && (
            <p className={styles.dialogMeta} data-drop-edge-meta>
              {dropOption.edgeId} · {dropOption.operation} ·{' '}
              {LIFECYCLE_TAG[dropOption.lifecycle]} · {dropOption.sources.join(', ')} → {dropOption.target}
            </p>
          )}
          <p className={dialogChrome.message}>{t('topic.topology.drop.message')}</p>
          {dropError !== null && (
            <p className={styles.dialogError} data-drop-error>
              {dropError}
            </p>
          )}
          <div className={styles.dialogActions}>
            <button type="button" className={dialogChrome.cancelBtn} data-drop-cancel onClick={closeDialog}>
              {t('topic.topology.cancel')}
            </button>
            <button
              type="button"
              className={`${dialogChrome.confirmBtn} ${dialogChrome.confirmBtnDanger}`}
              data-drop-confirm
              disabled={dropBusy || dropEdgeId === ''}
              onClick={() => {
                void submitDrop()
              }}
            >
              {dropBusy ? t('topic.topology.saving') : t('topic.topology.drop.confirm')}
            </button>
          </div>
        </TopoDialogFrame>
      )}

      {/* UI-6 D4: the merge-contract editor (B §23 / ADJ-7). */}
      {dialog?.kind === 'contract' && (
        <TopoDialogFrame kind="contract" title={t('topic.topology.contract.title')}>
          <p className={styles.dialogMeta} data-contract-edge={dialog.edgeId}>
            {dialog.edgeId}
            {contract !== null && contract.path !== null ? ` · ${contract.path}` : ''}
          </p>
          {contract === null || contract.status === 'loading' ? (
            <p className={styles.dialogMeta} data-contract-status="loading">
              {t('topic.topology.contract.loading')}
            </p>
          ) : contractError !== null ? (
            <p className={styles.dialogError} data-contract-error data-contract-status="error">
              {contractError}
            </p>
          ) : contract.content !== null || contractEditing ? (
            <div data-contract-status="editing">
              <p className={styles.dialogMeta}>{t('topic.topology.contract.hint')}</p>
              <textarea
                className={styles.textarea}
                data-contract-text
                value={contractDraft}
                onChange={e => setContractDraft(e.target.value)}
              />
            </div>
          ) : (
            <div data-contract-status="empty">
              <p className={dialogChrome.message} data-contract-none>
                {t('topic.topology.contract.none')}
              </p>
              <button
                type="button"
                className={dialogChrome.confirmBtn}
                data-contract-create
                onClick={() => setContractEditing(true)}
              >
                {t('topic.topology.contract.create')}
              </button>
            </div>
          )}
          {contractError !== null && (
            <div className={styles.dialogActions}>
              <button type="button" className={dialogChrome.cancelBtn} data-contract-cancel onClick={closeDialog}>
                {t('topic.topology.cancel')}
              </button>
            </div>
          )}
          {contractError === null && (contract === null || !contractEditing) && (
            <div className={styles.dialogActions}>
              <button type="button" className={dialogChrome.cancelBtn} data-contract-cancel onClick={closeDialog}>
                {t('topic.topology.cancel')}
              </button>
            </div>
          )}
          {contractError === null && contract !== null && contractEditing && (
            <div className={styles.dialogActions}>
              <button type="button" className={dialogChrome.cancelBtn} data-contract-cancel onClick={closeDialog}>
                {t('topic.topology.cancel')}
              </button>
              <button
                type="button"
                className={dialogChrome.confirmBtn}
                data-contract-save
                disabled={contractSaving || onSaveContract === undefined}
                onClick={() => {
                  void submitContractSave()
                }}
              >
                {contractSaving ? t('topic.topology.saving') : t('topic.topology.contract.save')}
              </button>
            </div>
          )}
        </TopoDialogFrame>
      )}
    </div>
  )
}
