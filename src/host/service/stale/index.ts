/**
 * WP-3.2 — closure blob-OID basis + stale detection: public surface.
 *
 * Usage (host wiring / WP-3.3 tool face / WP-3.4 SELECT preface):
 * ```ts
 * import { openDatabase } from '../persistence/store/index.js'
 * import { PlanForkStore } from '../domain/planfork/index.js'
 * import { PlanForkStaleService } from '../service/stale/index.js'
 *
 * const store = new PlanForkStore({ db: adaptDatabaseSync(rawDb), allocator, projectId })
 * const service = new PlanForkStaleService({
 *   repoRoot,                       // the Git repo root containing .research/
 *   store,                          // WP-3.1 store face (structural)
 *   planProvider,                   // WP-3.1 port — real PlanStore.loadPlan backend
 *   // git: { timeoutMs, gitExecutable, maxOutputBytes }  — optional (defaults)
 *   // concurrency: 8,                          — optional (bounded W3 pool)
 * })
 *
 * // §3.1/§3.2 — 当前 closure 基准 (real git W3 batch + W11 HEAD)
 * const closure = await service.capturePlanClosure('WS-1')
 *
 * // §4 + §3.2 — 生产创建路径 (base 由服务端 git 重算, INV-PLAN-6)
 * const record = await service.createPlanFork(params, ctx)   // status=OPEN
 *
 * // §5 — stale 检测 (手动触发面; 触发时机由宿主接线决定)
 * const outcome = await service.checkStale('PF-17')
 * //   outcome.stale / markedStale / diff[{path, kind, base_oid, current_oid}]
 * const sweep = await service.checkAllOpen('WS-1')   // or undefined = all WS
 * ```
 *
 * Boundary (WP-3.2): no SELECT/DISMISS (WP-3.4), no agent tool face
 * (WP-3.3), no flooding (WP-3.5), no trigger-timing wiring (host decision).
 * The §10 transition face used here is exactly OPEN→STALE (actor=PLUGIN);
 * the state machine + 乐观门 + 同事务账本 come from WP-3.1.
 */

export {
  DEFAULT_STALE_CONCURRENCY,
  StaleServiceError,
  isStaleServiceError,
  type CapturedClosure,
  type ClosureDiffEntry,
  type ClosureDiffKind,
  type PlanForkStoreFace,
  type StaleCheckOutcome,
  type StaleServiceErrorCode,
  type StaleServiceOptions,
  type StaleSweepResult,
} from './types.js'
export {
  closurePathsLenient,
  compareClosureBases,
  formatStaleReason,
  type CurrentClosureEntry,
} from './closure.js'
export {
  captureGitClosureBase,
  hashClosure,
  mapWithConcurrency,
  withCapturedBase,
  type GitClosureOptions,
  type HashedClosure,
} from './git-capture.js'
export { PlanForkStaleService } from './service.js'
