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
 *    edge label as a child `<title data-mock-edge-label>`.
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
 */
export const XYFLOW_MOCK: { pane: { width: number; height: number } } & { reset: () => void } = {
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
}

vi.mock('@xyflow/react', async () => {
  const React = await import('react')
  const h = React.createElement

  return {
    // The enum values @xyflow/system 0.0.80 actually exports.
    MarkerType: { Arrow: 'arrow', ArrowClosed: 'arrowclosed' },
    Position: { Top: 'Top', Right: 'Right', Bottom: 'Bottom', Left: 'Left' },
    /** Handles are connection geometry — inert in the mock. */
    Handle: () => null,
    ReactFlow: (props: Record<string, unknown>) => {
      const nodes = (props.nodes ?? []) as MockNode[]
      const edges = (props.edges ?? []) as MockEdge[]
      const nodeTypes = (props.nodeTypes ?? {}) as Record<string, (p: Record<string, unknown>) => ReactNode | null>
      /** UI-5: the view's onNodeClick (the selection face) — forwarded
       *  to each node wrapper below as its onClick. */
      const onNodeClick = props.onNodeClick as
        | ((event: unknown, node: MockNode) => void)
        | undefined
      const onlyRender = props.onlyRenderVisibleElements === true
      const { width, height } = paneState()
      // Culling emulation: anchor point inside the pane.
      const visible = onlyRender
        ? nodes.filter(n => n.position.x >= 0 && n.position.x <= width && n.position.y >= 0 && n.position.y <= height)
        : nodes

      return h(
        'div',
        {
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
                  'data-edge-animated': e.animated ? 'true' : 'false',
                  'data-edge-marker-end': e.markerEnd?.type ?? '',
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
