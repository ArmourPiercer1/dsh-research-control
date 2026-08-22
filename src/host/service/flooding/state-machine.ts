/**
 * WP-3.5 — Intervention 状态机（DOMAIN_SCHEMA §13 冻结表, 纯函数面）。
 *
 * §13 原文:
 *   Intervention | `OPEN ↔ PENDING`; `OPEN | PENDING → CLOSED`（终态;
 *                 重开 = 新 Intervention）; **仅用户**
 *
 * 冻结表:
 *   OPEN    → PENDING | CLOSED
 *   PENDING → OPEN    | CLOSED
 *   CLOSED  → （终态, 无出口; 重开 = 新 Intervention, 不是迁移）
 *
 * INV-PERM-4（「Intervention 状态只允许用户显式修改」）的**类型面**落地:
 * 本模块只交付纯判定函数（供未来用户面 WP 与其测试消费）——本 WP 的
 * `InterventionStore` **没有任何迁移/更新方法**（API 面零迁移口, 测试以
 * 原型键审计钉死）, service 同样无迁移操作。非用户（AGENT/PLUGIN/SYSTEM）
 * 因此在本 WP 交付物中**不存在**任何可调用面。存储层另以 trigger 限制
 * 内容列 UPDATE（状态缓存列 status/closed_at/resolution_note 是冻结
 * 迁移语义的唯一合法行侧面, 供未来用户面使用）。
 */

import { FloodingError, IV_STATUSES, type IvStatus } from './types.js'

/** §13 冻结迁移表（逐字: OPEN ↔ PENDING; OPEN|PENDING → CLOSED 终态）。 */
export const IV_TRANSITIONS: Readonly<Record<IvStatus, readonly IvStatus[]>> = {
  OPEN: ['PENDING', 'CLOSED'],
  PENDING: ['OPEN', 'CLOSED'],
  CLOSED: [],
}

/** 类型守卫（冻结 3 值）。 */
export function isIvStatus(value: unknown): value is IvStatus {
  return typeof value === 'string' && (IV_STATUSES as readonly string[]).includes(value)
}

/** `from` 的合法目标集（终态 = 空集）。 */
export function legalInterventionTargets(from: IvStatus): readonly IvStatus[] {
  return IV_TRANSITIONS[from]
}

/** §13 合法性判定（自环一律非法 — 表中无自环边）。 */
export function isLegalInterventionTransition(from: IvStatus, to: IvStatus): boolean {
  return IV_TRANSITIONS[from].includes(to)
}

/**
 * §13 门（非法迁移抛 FLOODING_ILLEGAL_TRANSITION, 消息列合法集 + 终态点名 —
 * 同 WP-3.1 `checkPfTransition` 纪律）。本 WP 无调用面; 交付给未来用户面
 * WP（actor 门 = USER, INV-PERM-4）与测试。
 */
export function checkInterventionTransition(id: string, from: IvStatus, to: IvStatus): void {
  if (!isIvStatus(from)) {
    throw new FloodingError({ code: 'FLOODING_INPUT', message: `checkInterventionTransition: from must be one of ${IV_STATUSES.join('|')} (got ${JSON.stringify(String(from))})` })
  }
  if (!isIvStatus(to)) {
    throw new FloodingError({ code: 'FLOODING_INPUT', message: `checkInterventionTransition: to must be one of ${IV_STATUSES.join('|')} (got ${JSON.stringify(String(to))})` })
  }
  if (!isLegalInterventionTransition(from, to)) {
    const legal = legalInterventionTargets(from)
    throw new FloodingError({
      code: 'FLOODING_ILLEGAL_TRANSITION',
      message:
        `illegal intervention transition for ${JSON.stringify(id)}: ${from} -> ${to}; ` +
        (legal.length === 0
          ? `${from} is terminal (DOMAIN_SCHEMA §13; 重开 = 新 Intervention)`
          : `legal targets from ${from}: [${legal.join(', ')}] (DOMAIN_SCHEMA §13, INV-TASK-1)`) +
        ' — and transitions are USER-only (INV-PERM-4); this WP provides no transition face',
    })
  }
}
