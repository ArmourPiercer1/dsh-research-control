/**
 * WP-6.4 — §13 InboxItem 状态机门测试（纯; 冻结表 DOMAIN_SCHEMA §13:
 * `CAPTURED → CONVERTED | DISMISSED`（终态）; 非法转换在 service 层
 * 拒绝 — INV-TASK-1 同款纪律; 同 WP-5.1 intervention state-machine 测试面）。
 */

import { describe, expect, it } from 'vitest'

import { assertInboxTransition, assertTransitionTableIntact, INBOX_TRANSITIONS } from '../../src/host/service/inbox/index.js'
import { throwsInbox } from './fixtures.js'

describe('INBOX_TRANSITIONS 冻结表', () => {
  it('键集 = 冻结 3 值, 值集 ⊆ 冻结 3 值', () => {
    expect(Object.keys(INBOX_TRANSITIONS).sort()).toEqual(['CAPTURED', 'CONVERTED', 'DISMISSED'])
    expect([...INBOX_TRANSITIONS.CAPTURED].sort()).toEqual(['CONVERTED', 'DISMISSED'])
    expect(INBOX_TRANSITIONS.CONVERTED).toEqual([])
    expect(INBOX_TRANSITIONS.DISMISSED).toEqual([])
    expect(() => assertTransitionTableIntact()).not.toThrow()
  })
})

describe('assertInboxTransition（§13 合法迁移）', () => {
  it('CAPTURED → CONVERTED 合法（转换流唯一出口之一）', () => {
    expect(() => assertInboxTransition('IN-1', 'CAPTURED', 'CONVERTED')).not.toThrow()
  })

  it('CAPTURED → DISMISSED 合法（忽略出口）', () => {
    expect(() => assertInboxTransition('IN-1', 'CAPTURED', 'DISMISSED')).not.toThrow()
  })

  it('自环全拒（CAPTURED/CONVERTED/DISMISSED — §13 无自环）', () => {
    for (const state of ['CAPTURED', 'CONVERTED', 'DISMISSED'] as const) {
      throwsInbox(() => assertInboxTransition('IN-1', state, state), 'IN_ILLEGAL_TRANSITION', /self-loop/)
    }
  })

  it('终态无出口（CONVERTED/DISMISSED 不可再迁移 — 重开 = 新条目）', () => {
    throwsInbox(() => assertInboxTransition('IN-2', 'CONVERTED', 'DISMISSED'), 'IN_ILLEGAL_TRANSITION', /CONVERTED -> DISMISSED/)
    throwsInbox(() => assertInboxTransition('IN-2', 'CONVERTED', 'CAPTURED'), 'IN_ILLEGAL_TRANSITION', /CONVERTED -> CAPTURED/)
    throwsInbox(() => assertInboxTransition('IN-3', 'DISMISSED', 'CAPTURED'), 'IN_ILLEGAL_TRANSITION', /DISMISSED -> CAPTURED/)
    throwsInbox(() => assertInboxTransition('IN-3', 'DISMISSED', 'CONVERTED'), 'IN_ILLEGAL_TRANSITION', /DISMISSED -> CONVERTED/)
  })

  it('未知状态大声失败（源/目标两侧 — 字符串面伪造兜底）', () => {
    throwsInbox(() => assertInboxTransition('IN-1', 'OPEN' as never, 'CAPTURED'), 'IN_ILLEGAL_TRANSITION', /unknown source state/)
    throwsInbox(() => assertInboxTransition('IN-1', 'CAPTURED', 'OPEN' as never), 'IN_ILLEGAL_TRANSITION', /unknown target state/)
  })
})
