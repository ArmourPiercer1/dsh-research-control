/**
 * WP-5.2 — 人类注意力层三对象服务模块（Objective / NextAction / Blocker）公共面。
 *
 * 分层定位（ARCHITECTURE §2.2）: host service 层 — 消费注入的
 * DB 驱动 / 文件 reader / writer / allocator, 零 DSH import（INV-PERM-5）、
 * 零 sqlite import。wiring 装配与 RPC/工具面接线归后续集成
 * （冻结 13 RPC + 11 工具面 — 见报告「实现要点」§3/§4）。
 *
 * 对象面:
 *   - `ObjectiveFileService` — 声明式 `.research/objectives.yaml` 变更面
 *     （原子写 + §13 守卫 + OBJECTIVE_EDITED 账本; 读 = loader 面）;
 *   - `ActionsStore` — NextAction/Blocker 的 operational DB 面
 *     （DDL/落库/§13 乐观迁移/查询 — 存储层权限门）;
 *   - `ActionsService` — 用户+Agent 业务面（§16.3 写时引用校验 +
 *     PROMOTE 物化流 + Blocker 引用存在性）。
 */

export {
  ActionsError,
  ID_PATTERNS,
  assertActorShape,
  type ActorRef,
  type ActionsDb,
  type ActionsErrorCode,
  type AffectsRef,
  type BlkStatus,
  type BlockerRecord,
  type NaStatus,
  type NextActionRecord,
  type ObjStatus,
} from './types.js'
export {
  actionsDdl,
  ACTIONS_TABLES,
  BLOCKER_TABLE,
  NEXT_ACTION_TABLE,
  blockerToParams,
  nextActionToParams,
  rowToBlocker,
  rowToNextAction,
  SQL_INSERT_BLOCKER,
  SQL_INSERT_NEXT_ACTION,
  SQL_SELECT_BLOCKER_BY_ID,
  SQL_SELECT_NEXT_ACTION_BY_ID,
  SQL_TRANSITION_BLOCKER,
  SQL_TRANSITION_NEXT_ACTION,
} from './schema.js'
export {
  assertNextActionCreator,
  assertUserActor,
  BLK_STATUSES,
  checkBlockerTransition,
  checkNextActionTransition,
  checkObjectiveTransition,
  isBlkStatus,
  isNaStatus,
  isObjStatus,
  NA_STATUSES,
  OBJ_STATUSES,
} from './state-machine.js'
export {
  ActionsStore,
  type ActionsStoreOptions,
  type BlockerListFilter,
  type CreateBlockerParams,
  type CreateNextActionParams,
  type NextActionListFilter,
} from './store.js'
export {
  ObjectiveFileService,
  serializeObjectives,
  type ObjectiveFileServiceOptions,
  type ObjectiveFileWriter,
  type ObjectiveSaveResult,
} from './objectives.js'
export {
  ActionsService,
  allocateTaskId,
  nextTaskSequence,
  type ActionsServiceOptions,
  type PromoteNextActionParams,
  type PromoteNextActionResult,
  type RunExistence,
} from './service.js'
