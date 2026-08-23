/**
 * WP-3.6 — `src/host/service/wiring` — public surface.
 *
 * The host-side COMPOSITION ROOT (RR-011 ledger (a)–(e)): the one place the
 * already-delivered services are instantiated TOGETHER over one
 * `research.sqlite` (DSH_ADAPTER §9: `[Service.init]` open, `ctx.effect`
 * close). Every step fails LOUD with a structured `HostWiringError` (the
 * dsh-adapter turns it into a fiber FAILED — TC-DSH-008), and every opened
 * resource is returned to exactly one disposer: `HostWiring.close()`
 * (idempotent; the dsh-adapter registers it with `ctx.effect`).
 *
 *   - (a) TC-DOM-033 声明式半边 + RR-010 补偿:
 *     workstream-flip.ts (flip + realizer), realize-store.ts (append-outcome
 *     settlement + the RR-011(b) validate-hook composition seam),
 *     lifecycle-reconcile.ts (startup file/DB convergence = the crash-
 *     window DETECTION PATH);
 *   - (b) 语义栈 store 级双用一致性: semantics.ts (one reducer, two
 *     consumers — the incremental fold runs INSIDE every append through
 *     the realize-store hook seam; the replay rebuild compares and
 *     replaces the `derived_state` slice);
 *   - (c) run-vs-history 启动对账 (WP-2.4 未决 2): run-reconcile.ts
 *     (rebuild the missing row from the event, or fail loud; orphan
 *     events are reported, never deleted — INV-HIST-1/7);
 *   - (d) the dependency graph itself: createHostWiring below;
 *   - (e) RR-013: the store connection guard (persistence/store/
 *     connection-guard.ts, installed by `openDatabase`).
 *
 * No DSH imports (INV-PERM-5): the DSH-touching half (the
 * `[Service.init]` call into `createHostWiring`, the `defineTool`
 * registration of `HostWiring.tools`, the `ctx.effect` disposer) lives in
 * `src/host/dsh-adapter/host/index.ts`.
 */

export {
  HostWiringError,
  makeCollectingLogger,
  type CollectedLogEntry,
  type HostWiringErrorCode,
  type HostWiringLogger,
  type HostWiringOptions,
  type ReconcileRunsPolicy,
  type WiringWorkstream,
} from './types.js'
export {
  flipWorkstreamYamlToRealized,
  WorkstreamRealizer,
  workstreamYamlRelPath,
  type FileCompensation,
  type WorkstreamRealizerInput,
} from './workstream-flip.js'
export {
  reconcileWorkstreamLifecycles,
  type LifecycleReconcileFinding,
  type LifecycleReconcileReport,
  type LifecycleReconcileWorkstream,
} from './lifecycle-reconcile.js'
export {
  reconcileRunsAgainstHistory,
  type RunReconcileFinding,
  type RunReconcileFindingKind,
  type RunReconcileInput,
  type RunReconcileReport,
} from './run-reconcile.js'
export {
  jsonToSemanticState,
  makeSemanticMaintainer,
  semanticStateToJson,
  semanticStateKey,
  toSemanticInputEvent,
  type SemanticMaintainer,
  type SemanticMaintainerInput,
  type SemanticRebuildInput,
  type SemanticRebuildResult,
  type SemanticStateDoc,
} from './semantics.js'
export {
  withRealizeCompensation,
  type RealizeStoreOptions,
  type StoreValidateHook,
} from './realize-store.js'
export { adaptDatabaseSync } from './db-adapter.js'
export { gitBlobOid, makeContentHashCapturer } from './content-hash-capture.js'
export { readProjectId } from './project-id.js'
export {
  runStartupIntegrityGate,
  type StartupIntegrityGate,
  type StartupIntegrityGateInput,
} from './startup-integrity.js'
export {
  createHostWiring,
  type HostWiring,
  type HostWiringStartup,
} from './create.js'
export {
  AUDIT_REFRESH_ACTOR,
  AUDIT_REFRESH_REPORTED_KEY,
  AuditRefreshError,
  createAuditRefreshRunner,
  fingerprint,
  isAuditRefreshError,
  type AuditRefreshErrorCode,
  type AuditRefreshLogger,
  type AuditRefreshOptions,
  type AuditRefreshResult,
  type AuditRefreshRunner,
} from './audit-refresh.js'
