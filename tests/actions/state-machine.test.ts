/**
 * WP-5.2 — §13 状态机守卫（纯函数面）+ 矩阵权限守卫（assertUserActor /
 * assertNextActionCreator）。
 *
 * 契约来源:
 *  - DOMAIN_SCHEMA §9.1 Objective: ACTIVE → ACHIEVED | DROPPED（终态; 仅用户）
 *  - §9.3 NextAction: PROPOSED → PROMOTED | DISMISSED（终态; PROMOTE 仅用户 — §6 矩阵）
 *  - §9.4 Blocker: ACTIVE → CLEARED（终态; 复现 = 新行; 无矩阵行 +
 *    INV-PERM-1 agent 可写闭集外 ⇒ 用户 only — 报告「实现要点」§4）
 *  - §13: 迁移仅沿表中方向; 自环非法; 拒绝消息点名当前态与合法目标集
 *    （INV-TASK-1 口径）; 未知状态 fail loud。
 */

import { describe, expect, it } from 'vitest'

import {
  ActionsError,
  assertNextActionCreator,
  assertUserActor,
  checkBlockerTransition,
  checkNextActionTransition,
  checkObjectiveTransition,
  type ActorRef,
} from '../../src/host/service/actions/index.js'

const USER: ActorRef = { kind: 'USER' }
const AGENT: ActorRef = { kind: 'AGENT', run_id: 'R-1', label: 'agent' }
const AGENT_NO_RUN: ActorRef = { kind: 'AGENT' }
const PLUGIN: ActorRef = { kind: 'PLUGIN' }
const SYSTEM: ActorRef = { kind: 'SYSTEM' }

function codeOf(e: unknown): string | undefined {
  return e instanceof ActionsError ? e.code : undefined
}

describe('checkNextActionTransition（§9.3 — 双向终态）', () => {
  it('PROPOSED → PROMOTED is legal', () => {
    expect(checkNextActionTransition('NA-1', 'PROPOSED', 'PROMOTED')).toBeUndefined()
  })

  it('PROPOSED → DISMISSED is legal', () => {
    expect(checkNextActionTransition('NA-1', 'PROPOSED', 'DISMISSED')).toBeUndefined()
  })

  it('terminal PROMOTED refuses every move (self-loop included)', () => {
    for (const to of ['PROPOSED', 'PROMOTED', 'DISMISSED'] as const) {
      let caught: unknown
      try {
        checkNextActionTransition('NA-1', 'PROMOTED', to)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(ActionsError)
      expect(codeOf(caught)).toBe('NA_WRONG_STATE')
      expect(String((caught as ActionsError).message)).toContain('illegal PROMOTED →')
    }
  })

  it('terminal DISMISSED refuses every move (no resurrection)', () => {
    for (const to of ['PROPOSED', 'PROMOTED', 'DISMISSED'] as const) {
      expect(() => checkNextActionTransition('NA-1', 'DISMISSED', to)).toThrowError(/illegal DISMISSED →/)
    }
  })

  it('the rejection names the id, the current state and the full legal target set (INV-TASK-1)', () => {
    expect(() => checkNextActionTransition('NA-1', 'PROPOSED', 'PROPOSED')).toThrowError(
      /next action "NA-1": illegal PROPOSED → PROPOSED \(DOMAIN_SCHEMA §13: from PROPOSED the legal targets are \[PROMOTED, DISMISSED\]/,
    )
  })

  it('an empty legal set marks the terminal state', () => {
    expect(() => checkBlockerTransition('BLK-1', 'CLEARED', 'ACTIVE')).toThrowError(/legal targets are \[\] — 终态无出边/)
  })
})

describe('checkBlockerTransition（§9.4 — 单向终态）', () => {
  it('ACTIVE → CLEARED is legal', () => {
    expect(checkBlockerTransition('BLK-1', 'ACTIVE', 'CLEARED')).toBeUndefined()
  })

  it('terminal CLEARED refuses every move (recurrence = a NEW row, not a reset)', () => {
    for (const to of ['ACTIVE', 'CLEARED'] as const) {
      expect(() => checkBlockerTransition('BLK-1', 'CLEARED', to)).toThrowError(/illegal CLEARED →/)
      expect(() => checkBlockerTransition('BLK-1', 'CLEARED', to)).toThrow(ActionsError)
    }
  })
})

describe('checkObjectiveTransition（§9.1 — 双向终态; 仅用户面）', () => {
  it('ACTIVE → ACHIEVED is legal', () => {
    expect(checkObjectiveTransition('OBJ-1', 'ACTIVE', 'ACHIEVED')).toBeUndefined()
  })

  it('ACTIVE → DROPPED is legal', () => {
    expect(checkObjectiveTransition('OBJ-1', 'ACTIVE', 'DROPPED')).toBeUndefined()
  })

  it('terminal ACHIEVED refuses every move', () => {
    for (const to of ['ACTIVE', 'ACHIEVED', 'DROPPED'] as const) {
      expect(() => checkObjectiveTransition('OBJ-1', 'ACHIEVED', to)).toThrowError(/illegal ACHIEVED →/)
    }
  })

  it('terminal DROPPED refuses every move', () => {
    expect(() => checkObjectiveTransition('OBJ-1', 'DROPPED', 'ACHIEVED')).toThrowError(/illegal DROPPED →/)
  })

  it('the rejection names the legal target set (INV-TASK-1)', () => {
    expect(() => checkObjectiveTransition('OBJ-1', 'ACTIVE', 'ACTIVE')).toThrowError(
      /objective "OBJ-1": illegal ACTIVE → ACTIVE \(DOMAIN_SCHEMA §13: from ACTIVE the legal targets are \[ACHIEVED, DROPPED\]/,
    )
  })
})

describe('assertUserActor（矩阵: PROMOTE/DISMISS/CLEAR/Objective 编辑 — 仅用户）', () => {
  it('accepts the bare USER actor（RPC 转发形状）', () => {
    expect(() => assertUserActor(USER, 'promoteNextAction(NA-1)')).not.toThrow()
  })

  it('rejects AGENT with code NA_ACTOR by default, naming the §6 matrix', () => {
    let caught: unknown
    try {
      assertUserActor(AGENT, 'promoteNextAction(NA-1)')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ActionsError)
    expect(codeOf(caught)).toBe('NA_ACTOR')
    expect(String((caught as ActionsError).message)).toContain('user-only operation')
    expect(String((caught as ActionsError).message)).toContain('actor.kind is "AGENT"')
  })

  it('rejects PLUGIN and SYSTEM with the same code', () => {
    expect(() => assertUserActor(PLUGIN, 'dismissNextAction(NA-1)')).toThrow(ActionsError)
    expect(() => assertUserActor(SYSTEM, 'createBlocker()')).toThrow(ActionsError)
  })

  it('honors a custom code（BLK_ACTOR）', () => {
    let caught: unknown
    try {
      assertUserActor(AGENT, 'clearBlocker(BLK-1)', 'BLK_ACTOR')
    } catch (e) {
      caught = e
    }
    expect(codeOf(caught)).toBe('BLK_ACTOR')
    expect(String((caught as ActionsError).message)).toContain('user-only operation')
  })

  it('honors a custom code（OBJ_ACTOR）', () => {
    let caught: unknown
    try {
      assertUserActor(PLUGIN, 'saveObjectives()', 'OBJ_ACTOR')
    } catch (e) {
      caught = e
    }
    expect(codeOf(caught)).toBe('OBJ_ACTOR')
  })

  it('malformed actor shape fails loud with ACT_INPUT', () => {
    expect(() => assertUserActor({ kind: 'ROBOT' }, 'promoteNextAction(NA-1)')).toThrow(ActionsError)
    expect(() => assertUserActor(null, 'promoteNextAction(NA-1)')).toThrow(ActionsError)
    expect(() => assertUserActor(42, 'promoteNextAction(NA-1)')).toThrow(ActionsError)
  })

  it('a USER actor with extra shape still passes; a malformed AGENT run_id fails ACT_INPUT', () => {
    expect(() => assertUserActor({ kind: 'USER', label: 'boss' }, 'x')).not.toThrow()
    expect(() => assertUserActor({ kind: 'AGENT', run_id: 'nope' }, 'x')).toThrow(ActionsError)
  })
})

describe('assertNextActionCreator（矩阵: NextAction 创建 — 用户 + Agent）', () => {
  it('accepts USER', () => {
    expect(() => assertNextActionCreator(USER, 'createNextAction()')).not.toThrow()
  })

  it('accepts AGENT carrying the run binding', () => {
    expect(() => assertNextActionCreator(AGENT, 'createNextAction()')).not.toThrow()
  })

  it('rejects AGENT without run_id (tool face requires the run binding)', () => {
    let caught: unknown
    try {
      assertNextActionCreator(AGENT_NO_RUN, 'createNextAction()')
    } catch (e) {
      caught = e
    }
    expect(codeOf(caught)).toBe('NA_ACTOR')
    expect(String((caught as ActionsError).message)).toContain('an AGENT creator must carry its run')
  })

  it('rejects PLUGIN and SYSTEM (no matrix row)', () => {
    for (const actor of [PLUGIN, SYSTEM]) {
      let caught: unknown
      try {
        assertNextActionCreator(actor, 'createNextAction()')
      } catch (e) {
        caught = e
      }
      expect(codeOf(caught)).toBe('NA_ACTOR')
      expect(String((caught as ActionsError).message)).toContain('only USER or AGENT may create a NextAction')
    }
  })
})
