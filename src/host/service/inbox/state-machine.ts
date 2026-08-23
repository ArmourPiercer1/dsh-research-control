/**
 * WP-6.4 — InboxItem §13 状态机（纯迁移表 + 门; 冻结表单一来源在
 * DOMAIN_SCHEMA §13, 本文件是其 service 层门 — 同 WP-5.1
 * intervention/state-machine.ts 先例）。
 *
 * 冻结表（§13 逐字）:
 *   InboxItem: `CAPTURED → CONVERTED | DISMISSED`（终态）。
 *
 * 语义:
 *  - 自环非法（状态机无自环 — 同 §13 全部对象口径）;
 *  - CONVERTED / DISMISSED 均为终态（无出口; 重开/重转 = 新条目 —
 *    §13 同 Intervention「重开 = 新 Intervention」口径: 终态对象不可
 *    复活, capture-first 层的再次捕获 = 新 IN id）;
 *  - 非法转换在 service 层拒绝（INV-TASK-1 同款纪律 — 存储层 trigger
 *    只钉「状态缓存列才可变」, 迁移合法性归本门）。
 */

import { InboxError, INBOX_STATES, type InboxState } from './types.js'

/** 合法迁移表（§13 逐字; 终态 = 空集）。 */
export const INBOX_TRANSITIONS: Readonly<Record<InboxState, readonly InboxState[]>> = {
  CAPTURED: ['CONVERTED', 'DISMISSED'],
  CONVERTED: [],
  DISMISSED: [],
}

/** 表完整性自钉（测试可直用）: 键集 = 冻结 3 值, 值集 ⊆ 冻结 3 值。 */
export function assertTransitionTableIntact(): void {
  const keys = Object.keys(INBOX_TRANSITIONS)
  if (keys.length !== INBOX_STATES.length || !INBOX_STATES.every((s) => keys.includes(s))) {
    throw new InboxError({
      code: 'IN_INPUT',
      message: `internal: INBOX_TRANSITIONS key set must be exactly ${INBOX_STATES.join('|')} (got ${keys.join('|')})`,
    })
  }
  for (const [from, tos] of Object.entries(INBOX_TRANSITIONS)) {
    for (const to of tos) {
      if (!(INBOX_STATES as readonly string[]).includes(to)) {
        throw new InboxError({
          code: 'IN_INPUT',
          message: `internal: INBOX_TRANSITIONS[${from}] references unknown state ${JSON.stringify(String(to))}`,
        })
      }
    }
  }
}

/**
 * §13 迁移门（纯; 非法对 ⇒ `IN_ILLEGAL_TRANSITION` — 含自环、终态出口、
 * 未知状态）。
 */
export function assertInboxTransition(inboxItemId: string, from: InboxState, to: InboxState): void {
  if (!(INBOX_STATES as readonly string[]).includes(from)) {
    throw new InboxError({
      code: 'IN_ILLEGAL_TRANSITION',
      message: `${inboxItemId}: unknown source state ${JSON.stringify(String(from))} (frozen InboxState = ${INBOX_STATES.join('|')})`,
    })
  }
  if (!(INBOX_STATES as readonly string[]).includes(to)) {
    throw new InboxError({
      code: 'IN_ILLEGAL_TRANSITION',
      message: `${inboxItemId}: unknown target state ${JSON.stringify(String(to))} (frozen InboxState = ${INBOX_STATES.join('|')})`,
    })
  }
  if (from === to) {
    throw new InboxError({
      code: 'IN_ILLEGAL_TRANSITION',
      message: `${inboxItemId}: self-loop ${from} -> ${to} is not a transition (DOMAIN_SCHEMA §13: InboxItem 无自环)`,
    })
  }
  if (!INBOX_TRANSITIONS[from].includes(to)) {
    throw new InboxError({
      code: 'IN_ILLEGAL_TRANSITION',
      message: `${inboxItemId}: ${from} -> ${to} is not a legal InboxItem transition (DOMAIN_SCHEMA §13: CAPTURED -> CONVERTED | DISMISSED; CONVERTED/DISMISSED 终态)`,
    })
  }
}
