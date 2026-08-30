/**
 * @xyflow/react mock for the graph test layer (WP-4.5).
 *
 * The real React Flow runtime needs browser layout surfaces (ResizeObserver,
 * canvas/pane measurement) that jsdom do not provide. Per the WP-4.5
 * test brief, the render tests therefore assert「node/edge props at the
 * ReactFlow component layer (mock) — data correctness, not the canvas」.
 *
 * Mock contract (asserted by the consumers, esp. perf-viewport.test.tsx):
 *  - the root `[data-mock-flow]` div carries the config-verification
 *    attributes of the EXACT render: `data-mock-only-render-visible`
 *    (the virtualization flag), `data-mock-node-count` /
 *    `data-mock-edge-count` (the full graph data that reached the canvas —
 *    pan/zoom into it renders the rest), `data-mock-rendered-nodes`
 *    (the culling result);
 *  - one `[data-mock-node]` wrapper per (culled) node; the view's
 *    `nodeTypes[type]` component is invoked with a minimal NodeProps
 *    (`id`/`type`/`data`/`position`) inside the wrapper, so the custom
 *    node SHAPES (G/T/M/ghost, data attributes, badges) render for real;
 *  - UI-5: `props.onNodeClick` (the selection face) is forwarded as the
 *    onClick of each node wrapper — clicking `[data-mock-node]` invokes
 *    it with a stub event + the node record;
 *  - viewport culling EMULATION for `onlyRenderVisibleElements`: when
 *    true, only nodes whose anchor point lies inside the emulated pane
 *    (`XYFLOW_MOCK.pane`, default 1200×800) are rendered — the
 *    deterministic subset of the real culling contract the
 *    「只渲染 viewport（节点数断言）」test needs;
 *  - one `<path data-mock-edge>` per edge with stroke /
 *    stroke-dasharray / className / animated copied to attributes and the
 *    edge label as a child `<title data-mock-edge-label>`;
 *  - UI-6 D4: the edge record's `data.edgeId` (when a string) rides the
 *    path as `data-edge-id` (the REAL topology edge id — the t71
 *    assertions), and `props.onEdgeClick` (the view's edge-click face,
 *    e.g. the merge-contract editor entry) is forwarded as the onClick
 *    of each edge path — a click on `[data-mock-edge]` invokes it with
 *    a stub event + the edge record.
 *
 * IMPORT ORDER: a test file must `import './xyflow-mock.js'` BEFORE any
 * import that (transitively) loads `@xyflow/react` — the mock registers
 * in the importing test file's module registry at import time.
 *
 * STATE: the ONLY cross-call shared state is the emulated pane (written
 * by a test BEFORE `render`, read at render time). Render records are
 * deliberately NOT shared state — they ride on the rendered DOM itself
 * (each test reads attributes of its OWN container). This is not just
 * elegance: a shared mutable render counter written during render and
 * read after it was observed to corrupt non-deterministically in this
 * vitest worker environment (the value drifts by +1 with no observable
 * write — confirmed with property-write traps on proxies and holders);
 * DOM-carried records have no such window.
 */

import type { ReactNode } from 'react'
import { vi } from 'vitest'

const PANE_KEY = Symbol.for('dshrc.graph.xyflow-mock-pane')

/** The emulated viewport pane (shared state — written pre-render, read at render). */
function paneState(): { width: number; height: number } {
  const g = globalThis as Record<symbol, unknown>
  if (typeof g[PANE_KEY] !== 'object' || g[PANE_KEY] === null) {
    g[PANE_KEY] = { width: 1200, height: 800 }
  }
  return g[PANE_KEY] as { width: number; height: number }
}

/**
 * The emulated pane, exposed for the perf tests. `reset()` restores the
 * default 1200×800 pane. (No render log — see the module doc.)
 * `instanceOf(el)` returns the mock flow instance the mock passed to
 * `props.onInit` for the root `el` (FR4 — the deterministic
 * `fitBounds`/`fitView` calls are asserted against it).
 */
export const XYFLOW_MOCK: { pane: { width: number; height: number } } & {
  reset: () => void
  instanceOf: (el: Element | null | undefined) => MockFlowInstance | null
} = {
  get pane(): { width: number; height: number } {
    return paneState()
  },
  set pane(value: { width: number; height: number }) {
    paneState().width = value.width
    paneState().height = value.height
  },
  reset(): void {
    paneState().width = 1200
    paneState().height = 800
  },
  instanceOf(el: Element | null | undefined): MockFlowInstance | null {
    if (el === null || el === undefined) return null
    return ((el as unknown as Record<string, unknown>).__mockFlowInstance as MockFlowInstance | undefined) ?? null
  },
}

interface MockNode {
  id: string
  type?: string
  position: { x: number; y: number }
  data: unknown
}

interface MockEdge {
  id: string
  source: string
  target: string
  data?: unknown
  style?: Record<string, unknown>
  label?: string
  className?: string
  animated?: boolean
  markerEnd?: { type?: string }
  /** t70 :663 fix round: the edge TYPE (custom edge routing — the mock
   *  renders the generic path either way, it just carries the field). */
  type?: string
}

/**
 * The mock instance the mock `ReactFlow` passes to `props.onInit`
 * (FR4): the view's deterministic fit calls land on these vi.fn
 * mocks, which the tests assert on (bounds + `{ duration: 0 }`).
 * Carried on the ROOT ELEMENT (`__mockFlowInstance`) — NOT module
 * state (see the module doc on render-window corruption).
 */
export interface MockFlowInstance {
  readonly fitView: ReturnType<typeof vi.fn>
  readonly fitBounds: ReturnType<typeof vi.fn>
  readonly getNodes: () => MockNode[]
  /** FR4-fix: the view's `onMoveStart` prop. xyflow fires it with the
   *  d3 sourceEvent — `null` for every PROGRAMMATIC transform (the
   *  start handler only filters `.internal`) — so tests drive it with
   *  null vs a real DOM event to exercise the user-gesture guard. */
  readonly onMoveStart?: (event: unknown, viewport: unknown) => void
}

vi.mock('@xyflow/react', async () => {
  const React = await import('react')
  const h = React.createElement
  const { useEffect, useRef } = React

  return {
    // The enum values @xyflow/system 0.0.80 actually exports.
    MarkerType: { Arrow: 'arrow', ArrowClosed: 'arrowclosed' },
    Position: { Top: 'Top', Right: 'Right', Bottom: 'Bottom', Left: 'Left' },
    /** Handles are connection geometry — inert in the mock. */
    Handle: () => null,
    /** t70 :663 fix round: BaseEdge is a VALUE import of the view (the
     *  custom dependency-arc edge renders through it). The mock mirrors
     *  the real BaseEdge's DOM contract: one <path> with d + the composed
     *  class (`react-flow__edge-path` + the forwarded className) + the
     *  marker/style attributes — so a test driving the custom edge
     *  component directly can assert the same path-level facts the live
     *  t70 run asserts.
     *  UI-6 D4: like the real v12 BaseEdge (dist/esm index.mjs :2577),
     *  the mock SPREADS the unknown props onto the path — so
     *  `data-edge-id` (the TopoEdge hook) reaches the DOM. The
     *  label/labelX/labelY/labelStyle/labelBg* props and the endpoint
     *  geometry are ABSORBED (the mock's path carries no label box —
     *  those on a <path> would raise invalid-DOM-property warnings),
     *  and the LIFTED `strokeDasharray` prop (the DependencyArc/TopoEdge
     *  idiom — the dash rides a presentation attribute, not the inline
     *  style) takes precedence over `style.strokeDasharray`. The generic
     *  mock ReactFlow does NOT invoke edgeTypes (it renders its
     *  data-attr paths); this export exists so the module import
     *  resolves and direct component tests work. */
    BaseEdge: ({
      path,
      className,
      style,
      markerEnd,
      strokeDasharray,
      // Absorbed (never rendered — see the doc above):
      markerStart,
      label,
      labelX,
      labelY,
      labelStyle,
      labelShowBg,
      labelBgStyle,
      labelBgPadding,
      labelBgBorderRadius,
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      id,
      interactionWidth,
      // Everything else (e.g. `data-edge-id`) lands on the path:
      ...rest
    }: Record<string, unknown>) =>
      h('path', {
        ...rest,
        d: path as string,
        className: ['react-flow__edge-path', (className as string | undefined) ?? ''].filter(Boolean).join(' '),
        'marker-end': (markerEnd as string | undefined) ?? '',
        // camelCase (React renders it as the stroke-dasharray attribute;
        // the dashed key would raise an invalid-DOM-property warning).
        // The lifted prop (the custom-edge idiom) wins; the style
        // fallback keeps the t70-era direct uses green.
        strokeDasharray:
          (strokeDasharray as string | number | undefined) ??
          ((style as Record<string, unknown> | undefined)?.strokeDasharray as string | undefined),
      }),
    ReactFlow: (props: Record<string, unknown>) => {
      const nodes = (props.nodes ?? []) as MockNode[]
      const edges = (props.edges ?? []) as MockEdge[]
      const nodeTypes = (props.nodeTypes ?? {}) as Record<string, (p: Record<string, unknown>) => ReactNode | null>
      /** UI-5: the view's onNodeClick (the selection face) — forwarded
       *  to each node wrapper below as its onClick. */
      const onNodeClick = props.onNodeClick as
        | ((event: unknown, node: MockNode) => void)
        | undefined
      /** UI-6 D4: the view's onEdgeClick (the edge-click face — the
       *  merge-contract editor entry) — forwarded to each edge path
       *  below as its onClick (stub event + the edge record). */
      const onEdgeClick = props.onEdgeClick as
        | ((event: unknown, edge: MockEdge) => void)
        | undefined
      const onlyRender = props.onlyRenderVisibleElements === true
      const { width, height } = paneState()
      // FR4: the mock INSTANCE for `props.onInit` — created in the
      // effect (child effects run before the view's own effects, so
      // `onInit` lands before the view's init/content-key fits) and
      // carried on the root element for the tests' `instanceOf` read.
      const rootRef = useRef<HTMLElement | null>(null)
      useEffect(() => {
        const el = rootRef.current
        if (el === null) return
        const instance: MockFlowInstance = {
          fitView: vi.fn().mockResolvedValue(true),
          fitBounds: vi.fn().mockResolvedValue(true),
          getNodes: () => nodes,
          // FR4-fix: expose the view's onMoveStart so tests can drive the
          // user-gesture guard (null = programmatic, DOM event = gesture).
          onMoveStart: props.onMoveStart as
            | ((event: unknown, viewport: unknown) => void)
            | undefined,
        }
        ;(el as unknown as Record<string, unknown>).__mockFlowInstance = instance
        const onInit = props.onInit as ((inst: MockFlowInstance) => void) | undefined
        onInit?.(instance)
      }, [])
      // Culling emulation: anchor point inside the pane.
      const visible = onlyRender
        ? nodes.filter(n => n.position.x >= 0 && n.position.x <= width && n.position.y >= 0 && n.position.y <= height)
        : nodes

      return h(
        'div',
        {
          ref: rootRef,
          'data-mock-flow': 'true',
          'data-mock-only-render-visible': onlyRender ? 'true' : 'false',
          'data-mock-node-count': String(nodes.length),
          'data-mock-edge-count': String(edges.length),
          'data-mock-rendered-nodes': String(visible.length),
          'data-mock-nodes-draggable': props.nodesDraggable === true ? 'true' : 'false',
          'data-mock-fit-view': props.fitView === true ? 'true' : 'false',
        },
        h(
          'div',
          { 'data-mock-viewport': 'true' },
          visible.map(n =>
            h(
              'div',
              {
                key: n.id,
                'data-mock-node': n.id,
                'data-node-type': n.type ?? '',
                'data-node-x': String(n.position.x),
                'data-node-y': String(n.position.y),
                // UI-5: the mock node IS the click target — a click on
                // the wrapper invokes the view's onNodeClick (a stub
                // event + the node record).
                onClick:
                  onNodeClick !== undefined
                    ? () => onNodeClick({}, { id: n.id, type: n.type, data: n.data, position: n.position })
                    : undefined,
              },
              n.type !== undefined && nodeTypes[n.type] !== undefined
                ? nodeTypes[n.type]({ id: n.id, type: n.type, data: n.data, position: n.position })
                : null,
            ),
          ),
          h(
            'svg',
            { 'data-mock-edges': 'true' },
            edges.map(e =>
              h(
                'path',
                {
                  key: e.id,
                  'data-mock-edge': e.id,
                  'data-edge-source': e.source,
                  'data-edge-target': e.target,
                  'data-edge-class': e.className ?? '',
                  'data-edge-type': e.type ?? '',
                  'data-edge-animated': e.animated ? 'true' : 'false',
                  'data-edge-marker-end': e.markerEnd?.type ?? '',
                  // UI-6 D4: the REAL topology edge id from the edge record
                  // (the view's shapeTopologyEdge puts it in `data`).
                  'data-edge-id':
                    typeof (e.data as { edgeId?: unknown } | null | undefined)?.edgeId === 'string'
                      ? ((e.data as { edgeId: string }).edgeId)
                      : '',
                  // UI-6 D4: the view's onEdgeClick, like onNodeClick above.
                  onClick: onEdgeClick !== undefined ? () => onEdgeClick({}, e) : undefined,
                  stroke: (e.style?.stroke as string | undefined) ?? '',
                  'stroke-dasharray': (e.style?.strokeDasharray as string | undefined) ?? '',
                },
                e.label !== undefined
                  ? [h('title', { key: 'label', 'data-mock-edge-label': 'true' }, e.label)]
                  : undefined,
              ),
            ),
          ),
        ),
      )
    },
  }
})
