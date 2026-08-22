/**
 * WP-3.4 — SELECT 物化 / DISMISS / 连锁 STALE：公开面（service 层）。
 *
 * Usage（host 接线 / GUI RPC 面 — 用户操作, 无 Agent 面 INV-PERM-2）：
 * ```ts
 * import { openDatabase } from '../../persistence/store/index.js'
 * import { IdAllocator } from '../../shared/ids/index.js'
 * import { PlanStore } from '../../domain/plan/index.js'
 * import { PlanForkStore } from '../../domain/planfork/index.js'
 * import { FsResearchReader } from '../checkpoint/fs-reader.js'
 * import { FsPlanFileWriter } from '../fs/index.js'
 * import { PlanForkSelectService } from './index.js'
 *
 * const { db: raw } = openDatabase(sqlitePath)          // WP-2.1 封装
 * const db = adaptDatabaseSync(raw)                      // WP-3.1 结构端口适配
 * const store = new PlanForkStore({ db, allocator, projectId })
 * const selectService = new PlanForkSelectService({
 *   repoRoot,
 *   store,                                              // WP-3.1 面（读 + DISMISS/复核 STALE 迁移）
 *   db,                                                 // 同一 DB 面（SELECTED 事务 — §6.6 OID 账本行）
 *   allocator, projectId,
 *   planProvider: (wsId) => planStoreFor(wsId).loadPlan(),
 *   reader: new FsResearchReader(join(repoRoot, '.research')),
 *   writer: new FsPlanFileWriter(),
 *   schemaDir: '<frozen schema/declarative>',
 * })
 *
 * // §6 SELECT 物化（用户）— 复核基准 → 物化 NEW items → 重写 plan.yaml
 * //   → DB 事务（SELECTED + 连锁 STALE + PF_SELECTED 账本含新闭包 OID）
 * const outcome = await selectService.select('PF-17', { kind: 'USER', user_id: 'u1' })
 * //   outcome.newOrder / newItems / staleOthers / newClosure / checkpointHint
 *
 * // §7 DISMISS（用户）— OPEN|STALE → DISMISSED（只改状态不删除）
 * const dismissed = selectService.dismiss('PF-18', { kind: 'USER', user_id: 'u1' })
 *
 * // goal 4 — 重启后崩溃一致性审计（只读；CRASH_INCOMPLETE ⇒ 大声抛错）
 * const report = await selectService.auditSelectConsistency('WS-1')
 * ```
 *
 * 纯公式面（测试/预览/复用 — 零 I/O）：
 * ```ts
 * import { computeNewPlan, spliceNewPlan, allocateNewIds, itemIdSequence } from './index.js'
 * // §6.3 修正版公式（A-13 修订原文）— 逐分支测试见 tests/select/formula.test.ts
 * import { detectCrashSignature, specKey, baseItemIds } from './index.js'
 * ```
 *
 * Boundary (WP-3.4)：无 Agent 物化面（INV-PERM-2 — 类型面 + 运行时双保险;
 * 工具面 WP-3.3 的 11 工具中无 select/dismiss — §7.2 清单审计）；不写
 * ResearchHistory（§6.6 — 只产 management_action 行）；零 .research 删除
 * （INV-PLAN-9 — 离开计划的定义文件保留）；PF 内容列永不触碰（INV-PLAN-4）。
 */

export { PlanForkSelectService } from './service.js'
export {
  allocateNewIds,
  computeNewPlan,
  itemIdSequence,
  spliceNewPlan,
  type ComputeNewPlanInput,
} from './formula.js'
export {
  baseItemIds,
  detectCrashSignature,
  proposedNewItems,
  specKey,
  type CrashSignatureInput,
  type CrashSignatureResult,
  type CrashedNewFile,
} from './crash-signature.js'
export {
  isSelectServiceError,
  SelectServiceError,
  type DismissOutcome,
  type MaterializedItem,
  type NewPlanResult,
  type PlanForkSelectOptions,
  type PlanForkSelectStoreFace,
  type SelectAuditEntry,
  type SelectAuditKind,
  type SelectAuditReport,
  type SelectOutcome,
  type SelectServiceErrorCode,
} from './types.js'
