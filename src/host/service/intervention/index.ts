/**
 * WP-5.1 — `src/host/service/intervention` — public surface。
 *
 * Intervention 生命周期服务（DOMAIN_SCHEMA §9.2/§13; ARCHITECTURE §5.9
 * INV-PERM-4 / §5.10 INV-ATTN-1/5; CATALOG §4 行 18 / §5.7）:
 *
 *   - 创建: 用户类（origin=USER）+ 机械类（INV-ATTN-5 闭集 trigger 推导）;
 *   - 状态迁移: 仅用户（UserActorRef 类型面 + 运行面断言; §13 冻结门）;
 *   - 查询: OPEN/PENDING/CLOSED 全量（无隐藏过滤器 — INV-ATTN-1 数据半边）;
 *   - 事件: INTERVENTION_CREATED 经 registry append（E 列矩阵在冻结
 *     registry 内钉）— 状态迁移无对应事件（冻结目录无, 不虚构）。
 *
 * 表 / 触发器 / 行形状 / §13 冻结表 = WP-3.5 单一来源（本模块复用,
 * 不建第二张表 — TC-DB-004 冻结表清单零变更）。
 */

// Type surface (actors / params / results / error taxonomy / ports)。
export {
  InterventionError,
  isInterventionError,
  MECHANICAL_TRIGGER_ACTOR_KIND,
  MECHANICAL_TRIGGER_ORIGIN,
  toActorRef,
  USER_ACTOR,
  type CreateInterventionResult,
  type InterventionCreateParams,
  type InterventionErrorCode,
  type InterventionExternalState,
  type InterventionServiceOptions,
  type MechanicalActorRef,
  type MechanicalInterventionCreateParams,
  type UpdateInterventionStateResult,
  type UserActorRef,
} from './types.js'

// §13 状态机服务面（冻结表单一来源在 WP-3.5; 门面重导出）。
export {
  assertInterventionTransition,
  interventionTargets,
  IV_TRANSITIONS,
  isIvStatus,
  isLegalInterventionTransition,
  legalInterventionTargets,
} from './state-machine.js'

// 生命周期 SQL（唯一新增: 状态缓存列条件 UPDATE; DDL 单一来源在 WP-3.5）。
export { SQL_UPDATE_INTERVENTION_STATE } from './schema.js'

// 生命周期行面（insert + 全量查询 + 用户状态 UPDATE; 无 delete）。
export {
  InterventionLifecycleStore,
  type InterventionLifecycleStoreOptions,
} from './store.js'

// 生命周期服务（创建 / 迁移 / 查询 + 事件 append 面）。
export { InterventionService } from './service.js'
