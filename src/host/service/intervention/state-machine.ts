/**
 * WP-5.1 — §13 Intervention 状态机的**服务面**（门 + 查询）。
 *
 * 冻结迁移表本身在 WP-3.5 `service/flooding/state-machine.ts`（单一来源,
 * 本模块只加门语义 + 本模块错误码, 不复制表 — 决策见报告「实现要点 1」）:
 *
 *   OPEN    → PENDING | CLOSED
 *   PENDING → OPEN    | CLOSED
 *   CLOSED  → （终态, 无出口; 重开 = 新 Intervention, 不是迁移）
 *
 * INV-PERM-4（「Intervention 状态只允许用户显式修改」）: 本模块的门函数
 * **不携带 actor 参数** — actor 门在 `InterventionService.updateState`
 * （UserActorRef 类型面 + 运行面断言, 双面拒绝）; 状态机只管「迁移本身
 * 是否合法」这一维。
 */

import {
  checkInterventionTransition,
  isFloodingError,
  isIvStatus,
  isLegalInterventionTransition,
  legalInterventionTargets,
  IV_TRANSITIONS,
  type IvStatus,
} from '../flooding/index.js'
import { InterventionError } from './types.js'

/** §13 冻结迁移表（重导出 — 单一来源在 WP-3.5, 测试可经本面引用）。 */
export { IV_TRANSITIONS, isIvStatus, isLegalInterventionTransition, legalInterventionTargets }

/**
 * §13 门（service 面）: 非法迁移抛 `IV_ILLEGAL_TRANSITION`, 消息列合法集
 * + 终态点名（同 WP-3.1 `checkPfTransition` / WP-3.5 纪律）。
 *
 * 与 WP-3.5 纯面的唯一差别 = 错误载体: 本面抛 `InterventionError`
 * （service 错误分类法）, WP-3.5 面抛 `FloodingError`（其调用面用）。
 * 判定逻辑零重复（`checkInterventionTransition` 委托 + 重包）。
 */
export function assertInterventionTransition(id: string, from: IvStatus, to: IvStatus): void {
  try {
    checkInterventionTransition(id, from, to)
  } catch (cause) {
    if (isFloodingError(cause) && cause.code === 'FLOODING_ILLEGAL_TRANSITION') {
      throw new InterventionError({
        code: 'IV_ILLEGAL_TRANSITION',
        message: cause.message,
      })
    }
    // from/to 不是冻结 3 值（输入面畸形 — 调用方已先行断言, 防御性重包）。
    throw new InterventionError({
      code: 'IV_INPUT',
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

/** `from` 的全部合法目标（终态 = 空集）— 视图/测试的「可操作按钮」推导面。 */
export function interventionTargets(from: IvStatus): readonly IvStatus[] {
  return legalInterventionTargets(from)
}
