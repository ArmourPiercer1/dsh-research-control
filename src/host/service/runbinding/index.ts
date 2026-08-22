/**
 * src/host/service/runbinding — public surface (WP-2.4).
 *
 *   - service.ts     — `RunBindingService`: BIND/DETACH/IGNORE + formal
 *                      Run registration + Run lifecycle (finish/fail/
 *                      cancel/checkpoint) + Run/DS query face + the
 *                      discovery surface (reconcileSessions /
 *                      startDiscovery over the DshSessionAdapter port)
 *   - types.ts       — records (frozen run.schema.json $defs keys),
 *                      DS/Run states, actor types, the RB_* error
 *                      taxonomy, options, the U9 `ResearchContext` seam
 *   - tables.ts      — `openRunBindingDatabase` / `openRunBindingTables`
 *                      (the §15 `run` + `discovered_session` tables on
 *                      the SAME research.sqlite file; the WP-2.1
 *                      `openDatabase` wrapper is reused for file init)
 *   - schema.ts      — this WP's V1 DDL (idempotent) + row mapping
 *   - state-machine.ts — §13 L549/L554 legal-transition guards (the run
 *                      machine reuses the WP-2.2 frozen table)
 *   - discovery.ts   — canonical cwd attribution (DSH_ADAPTER §8) + the
 *                      §6.2 three-way discovery decision + the default
 *                      (null) ResearchContext resolver
 *   - events.ts      — RUN_* event builders (frozen catalog §5.1 keys) +
 *                      the validate-hook factory (registry 校验 + store
 *                      append closed loop) + context assembly
 *
 * Boundary (ARCHITECTURE §2.2): service layer — writes the operational
 * DB through the WP-2.1 store face (events) and this WP's table face
 * (run/DS rows). No DSH imports (INV-PERM-5). The agent-facing tool
 * surface does NOT exist here by design (ARCHITECTURE §6: the agent's
 * Run lane is the checkpoint report; session-binding operations have no
 * agent row) — see tests/runbinding/permissions.test.ts.
 */

export { RunBindingService } from './service.js'
export {
  openRunBindingDatabase,
  openRunBindingTables,
  type RunBindingDatabase,
  type RunBindingTables,
} from './tables.js'
export {
  DS_STATE_VALUES,
  DISCOVERED_SESSION_TABLE,
  RUNBINDING_TABLES,
  RUN_STATUS_VALUES,
  RUN_TABLE,
  runBindingDdl,
} from './schema.js'
export {
  DS_TRANSITIONS,
  assertDsCanMove,
  assertRunCanBeEnded,
  isLegalDsTransition,
  isLegalRunTransition,
  legalDsTargets,
  legalRunTargets,
} from './state-machine.js'
export {
  NO_RESEARCH_CONTEXT,
  canonicalizePath,
  decideDiscovery,
  matchWorkspaceRoot,
  normalizeWorkspaceRoots,
  type DiscoveryDecision,
} from './discovery.js'
export {
  RUN_EVENT_SCHEMA_VERSION,
  buildObjectContext,
  buildRunCancelledEvent,
  buildRunFailedEvent,
  buildRunFinishedEvent,
  buildRunStartedEvent,
  makeValidateHook,
  type RunEndEventSpec,
  type RunStartedEventSpec,
} from './events.js'
export {
  RunBindingError,
  USER_ACTOR,
  type BindParams,
  type BindResult,
  type DiscoveredSessionListFilter,
  type DiscoveredSessionRecord,
  type DsState,
  type ResearchContext,
  type ResearchContextResolver,
  type RegisterRunParams,
  type RunBindingErrorCode,
  type RunBindingExternalState,
  type RunBindingServiceOptions,
  type RunListFilter,
  type RunLifecycleActorRef,
  type RunRecord,
  type RunResult,
  type UserActorRef,
  type UserOrAgentActorRef,
} from './types.js'
