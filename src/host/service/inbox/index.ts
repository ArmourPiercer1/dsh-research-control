/**
 * WP-6.4 — `src/host/service/inbox` — 公共面（唯一 import 点）。
 *
 * Research Inbox（DOMAIN_SCHEMA §11 / 计划书 §28 / §22.3）:
 *
 *  - `InboxService` — 条目捕获（用户 `captureHuman` + 机械 `captureMechanical`
 *    接缝）/ §13 状态机（`dismiss`）/ §28 转换流（`convert` — 显式确认,
 *    类型面 + 运行面）/ §22.3 高影响升级（`escalateMechanical` — 机械判定
 *    → Intervention 创建联动）/ 查询面（无隐藏过滤器）;
 *  - `InboxStore` — `inbox_item` 行面（insert + 查询 + 状态缓存 UPDATE;
 *    append-only 内容语义; 无 delete — INV-HIST-7）;
 *  - 机械判定纯函数（`assessEscalation` / `buildEscalationDetail` /
 *    `escalationInterventionTitle` — WP-6.3 reconciliation 缝可直用）;
 *  - §13 迁移门（`assertInboxTransition` + 冻结表 `INBOX_TRANSITIONS`）;
 *  - 冻结形状网装载（`loadInboxSchemas` — 真实冻结
 *    schema/operational/inbox.schema.json）;
 *  - DDL 面（`inboxItemDdl` — 第二连接幂等应用, 同 WP-3.5/WP-5.3 模式）。
 *
 * 层边界（ARCHITECTURE §2.2）: service — 唯一写 operational DB 的层;
 * 本包零 DSH import（INV-PERM-5, check-imports 可证）。生产组装
 * （哪个连接 + 哪些真实 service 端口 + 机械触发时机）归编排/接线 WP —
 * 本包 API 面完整自洽（同 WP-6.1/WP-6.2 交付口径, 见 WP-6.4 报告
 * 「偏离与豁免」§1）。
 */

export { InboxService } from './service.js'
export { InboxStore, type InboxListFilter, type InboxStoreOptions } from './store.js'
export { loadInboxSchemas } from './schemas.js'
export {
  assertInboxTransition,
  INBOX_TRANSITIONS,
  assertTransitionTableIntact,
} from './state-machine.js'
export {
  assessEscalation,
  buildEscalationDetail,
  DEFAULT_ESCALATION_BATCH_THRESHOLD,
  escalationInterventionTitle,
} from './escalation.js'
export {
  inboxItemDdl,
  inboxItemToParams,
  rowToInboxItem,
  INBOX_ITEM_TABLE,
  INBOX_TABLES,
  SQL_INSERT_INBOX_ITEM,
  SQL_LIST_INBOX_ITEMS,
  SQL_SELECT_INBOX_ITEM_BY_ID,
  SQL_UPDATE_INBOX_ITEM_STATE,
} from './schema.js'
export {
  CONVERSION_TARGET_KINDS,
  ESCALATION_REASONS,
  HUMAN_INBOX_SOURCE,
  InboxError,
  INBOX_SOURCES,
  INBOX_STATES,
  INTERACTION_KINDS,
  isInboxError,
  MECHANICAL_INBOX_SOURCES,
  USER_ACTOR,
  type CaptureParams,
  type CaptureResult,
  type ClaimTargetFields,
  type ConvertInboxParams,
  type ConvertResult,
  type ConversionTargetFields,
  type ConversionTargetKind,
  type DismissResult,
  type EscalateMechanicalParams,
  type EscalationAssessment,
  type EscalationEvidence,
  type EscalationIntervention,
  type EscalationOptions,
  type EscalationReason,
  type EscalationResult,
  type FactTargetFields,
  type InboxConversionTargetExecutor,
  type InboxErrorCode,
  type InboxItemRecord,
  type InboxSchemaError,
  type InboxShapeCheck,
  type InboxServiceOptions,
  type InboxSource,
  type InboxState,
  type InboxSchemas,
  type InteractionKind,
  type InteractionTargetFields,
  type InterventionCreatedRef,
  type InterventionTargetFields,
  type MechanicalActorRef,
  type MechanicalCaptureParams,
  type MechanicalInboxSource,
  type MechanicalInterventionCreateParams,
  type MechanicalInterventionCreator,
  type ManagementActionRecorder,
  type NextActionTargetFields,
  type ReportingItemTargetFields,
  type TaskTargetFields,
  type UserActorRef,
} from './types.js'
