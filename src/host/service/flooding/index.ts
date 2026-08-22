/**
 * WP-3.5 — public surface of the PlanFork flooding detector + AUTO_FLOODING
 * Intervention service (service layer).
 *
 * Usage (host wiring WP):
 * ```ts
 * // 冻结 attention schema 面（真实 schema/operational/attention.schema.json）
 * const schemas = loadInterventionSchemas(reader, '/wr/schema/operational')
 *
 * // intervention 表（第二连接; DDL 幂等）
 * const { store, db, close } = openFloodingDatabase(researchSqlitePath)
 * const interventions = new InterventionStore({ db, schemas })
 *
 * // 接线缝 — 挂到 PF 创建流（createPlanFork 提交后）与 plan 加载流:
 * const service = new FloodingService({
 *   store, registry, planForks, interventions, allocator, projectId,
 *   researchFileReader, researchRoot, schemaDir, externalState, now,
 * })
 * const result = service.onPlanForkCreated(pf)   // 永不抛; result.blocked 恒 false（§8 不阻止创建）
 * if (result.intervention_id !== undefined) { /* GUI 提示面 *\/ }
 * ```
 *
 * Boundary (WP-3.5): 检测（纯, §8 规则逐字, per-WS 口径 A-15 用户确认）+
 * AUTO_FLOODING Intervention 构造（§8 原文 + §9.2 冻结形状）+ intervention
 * 行落库（append-only, 无 delete）+ INTERVENTION_CREATED 事件（CATALOG §5.7,
 * registry 校验内嵌 store 事务）。**无** Intervention 状态迁移面（INV-PERM-4
 * 仅用户 — 本 WP 类型面零迁移口, §13 迁移表只以纯函数交付）。**无**
 * ManagementAction 账本行（§12.1 的 15 值 action_kind 枚举无 Intervention
 * kind — 核查结论）。**不做** GUI（任务边界）。
 */

// Type surface (records / verdicts / hook results / error taxonomy / ports).
export {
  FloodingError,
  FLOODING_TRIGGERS,
  INTERVENTION_ORIGINS,
  IV_STATUSES,
  MECHANICAL_TRIGGER_KINDS,
  THIS_WP_MECHANICAL_TRIGGER,
  isFloodingError,
  type FloodingCheckError,
  type FloodingCheckResult,
  type FloodingDb,
  type FloodingDetectionParams,
  type FloodingEvidence,
  type FloodingExternalState,
  type FloodingErrorCode,
  type FloodingServiceOptions,
  type FloodingTrigger,
  type FloodingVerdict,
  type FloodingVerdictReason,
  type FloodingWindow,
  type InterventionListFilter,
  type InterventionOrigin,
  type InterventionRecord,
  type InterventionSchemaError,
  type InterventionSchemas,
  type InterventionShapeCheck,
  type InterventionStoreOptions,
  type IvStatus,
  type MechanicalTriggerKind,
  type PlanForkRecord,
} from './types.js'

// The pure detector (PLAN_FORK_SPEC §8 rule, verbatim).
export {
  DEFAULT_FLOODING_THRESHOLD,
  FLOODING_RULE,
  detectPlanForkFlooding,
} from './detector.js'

// AUTO_FLOODING Intervention + INTERVENTION_CREATED builders (§8 verbatim).
export {
  AUTO_FLOODING_PLUGIN_ACTOR,
  INTERVENTION_EVENT_SCHEMA_VERSION,
  autoFloodingInterventionTitle,
  buildAutoFloodingDetail,
  buildAutoFloodingIntervention,
  buildInterventionCreatedEvent,
  type BuildAutoFloodingInterventionParams,
  type BuildInterventionCreatedEventParams,
} from './intervention.js'

// §13 Intervention state machine (pure face — USER-only, INV-PERM-4).
export {
  IV_TRANSITIONS,
  checkInterventionTransition,
  isIvStatus,
  isLegalInterventionTransition,
  legalInterventionTargets,
} from './state-machine.js'

// Frozen attention schema face (loader pattern).
export { loadInterventionSchemas } from './schemas.js'

// intervention table DDL + row mapping + SQL (pure data).
export {
  FLOODING_TABLES,
  INTERVENTION_TABLE,
  interventionDdl,
  interventionToParams,
  rowToIntervention,
  SQL_FIND_OPEN_AUTO_FLOODING,
  SQL_INSERT_INTERVENTION,
  SQL_SELECT_INTERVENTION_BY_ID,
} from './schema.js'

// Store (insert + query; NO delete — INV-HIST-7; NO transition — INV-PERM-4).
export { InterventionStore } from './store.js'

// The wiring seam + §8 action executor + DB open face.
export {
  FloodingService,
  openFloodingDatabase,
  type FloodingDatabase,
} from './service.js'
