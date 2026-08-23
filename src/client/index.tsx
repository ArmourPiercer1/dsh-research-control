/**
 * Client entry (WP-0.5 spike) — functional client plugin.
 *
 * Form follows the host's production client plugin (deepseek-harness
 * packages/client/ui-trajectory/src/client/index.ts): named `inject` +
 * `apply`, and **no default export** — mixing the service-form default
 * export with the function form makes the Loader discard the function
 * plugin's namespace (packages/AGENTS.md plugin export rule; postmortem
 * 0001). The host node half scans the `dsh.client` manifest of this
 * Loader entry and serves the bundle from
 * `/plugins/dsh-research-control/client.js` (DSH_ADAPTER §6 / §13-U1;
 * runtime proof is WP-0.6).
 *
 * Entry filename is `index.tsx` per the frozen layout (ARCHITECTURE §2.1);
 * the entry body itself carries no JSX — the view is a separate pure props
 * component in src/client/views/.
 */

import { mountResearchRemotes, type RemoteContext } from './dsh-adapter/remote/mount.js'
import { registerResearchUI, type ResearchClientContext } from './dsh-adapter/ui.js'

// Phase 4 graph views (WP-4.5): re-exported here so the graph runtime
// (React Flow / @xyflow/react, inlined per the client-bundle baseline — it
// is NOT a module-table row) enters the single-file client artifact now,
// ahead of the page wiring. The page WPs (4.2-4.4) import the SAME face
// from `src/client/graph` for their seats; this re-export only pins the
// bundle inlining (the host module table resolves the extra named exports
// harmlessly — the entry keeps its inject/apply plugin shape).
export {
  ConfirmDialog,
  PlanGraphContainer,
  PlanGraphView,
  TopologyGraphContainer,
  TopologyGraphView,
  classifyPlanForkChange,
  planToGraph,
  topologyToGraph,
} from './graph/index.js'

/** Required services: the slot system (tab registration) and the typert remote gateway (WP-0.3 mount). */
export const inject = ['slots', 'remote']

/**
 * Client plugin body: mount the research remotes, then register the
 * Research tab on the `conversation.view` slot. Both halves register their
 * rollback on the caller fiber, so plugin unload removes the remote
 * namespace and the tab together.
 *
 * `apply` is async: `mountResearchRemotes` returns the gateway `$mount`
 * promise, which must settle before slot registration (the cordis fiber
 * awaits the apply result, so the PENDING→ACTIVE transition covers it).
 * @param ctx - client root context with the injected services.
 */
export async function apply(ctx: RemoteContext & ResearchClientContext): Promise<void> {
  await mountResearchRemotes(ctx)
  registerResearchUI(ctx)
}
