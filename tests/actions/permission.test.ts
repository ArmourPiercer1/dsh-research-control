/**
 * WP-5.2 — 矩阵权限面（TC-DOM-013 口径 — actor capability matrix 逐行钉死）:
 *
 *  ARCHITECTURE §6 actor capability matrix 原文核对（任务书「PROMOTE 类操作
 *  仅用户——查原文确认哪些对象有 PROMOTE」）:
 *    「NextAction 创建            | ✅ | ✅ | ❌ | ❌」
 *    「NextAction PROMOTE/DISMISS | ✅ | ❌ | ❌ | ❌」
 *    Blocker 无矩阵行 + §5.9 INV-PERM-1 闭集外 ⇒ USER-only（全泳道）;
 *    Objective 编辑 §13「仅用户」⇒ USER-only（全泳道）。
 *
 *  本套件 = 矩阵逐行 × 每个操作面（store 层业务门）+ 工具面钉死
 *  （RESEARCH_TOOL_NAMES: 有 research_next_action_create, 无
 *    promote/dismiss/blocker/objective 工具 — 矩阵行②的「无 agent 面」
 *    在工具注册面同样成立, 同 WP-4.6 TC-E2E-011 单元钉口径）。
 *
 *  四泳道 actor 形状:
 *    USER   — 裸 { kind: 'USER' }（RPC 转发面）;
 *    AGENT  — { kind: 'AGENT', run_id, label }（工具面 — run 绑定）;
 *    PLUGIN — { kind: 'PLUGIN' };
 *    SYSTEM — { kind: 'SYSTEM' }。
 */

import { describe, expect, it } from 'vitest'

import { ActionsError, type CreateBlockerParams } from '../../src/host/service/actions/index.js'
import { RESEARCH_TOOL_NAMES, WRITE_TOOL_NAMES } from '../../src/host/tools/index.js'
import {
  PLUGIN_ACTOR,
  SYSTEM_ACTOR,
  USER_ACTOR,
  agentActor,
  openActionsHarness,
} from './harness.js'

function codeOf(e: unknown): string | undefined {
  return e instanceof ActionsError ? e.code : undefined
}

const USER = USER_ACTOR
const AGENT = agentActor('R-1')
const PLUGIN = PLUGIN_ACTOR
const SYSTEM = SYSTEM_ACTOR

function expectActorCode(fn: () => unknown, code: string | undefined): void {
  let caught: unknown
  try {
    fn()
  } catch (e) {
    caught = e
  }
  if (code === undefined) {
    expect(caught).toBeUndefined()
    return
  }
  expect(codeOf(caught)).toBe(code)
}

describe('矩阵行①: NextAction 创建（✅/✅/❌/❌）', () => {
  it('USER ✅', () => {
    const h = openActionsHarness()
    try {
      expectActorCode(() => h.store.createNextAction({ statement: 's' }, USER), undefined)
    } finally {
      h.close()
    }
  })
  it('AGENT ✅（携 run 绑定）', () => {
    const h = openActionsHarness()
    try {
      expectActorCode(() => h.store.createNextAction({ statement: 's' }, AGENT), undefined)
    } finally {
      h.close()
    }
  })
  it('PLUGIN ❌（NA_ACTOR）', () => {
    const h = openActionsHarness()
    try {
      expectActorCode(() => h.store.createNextAction({ statement: 's' }, PLUGIN), 'NA_ACTOR')
    } finally {
      h.close()
    }
  })
  it('SYSTEM ❌（NA_ACTOR）', () => {
    const h = openActionsHarness()
    try {
      expectActorCode(() => h.store.createNextAction({ statement: 's' }, SYSTEM), 'NA_ACTOR')
    } finally {
      h.close()
    }
  })
})

describe('矩阵行②: NextAction PROMOTE / DISMISS（✅/❌/❌/❌ — PROMOTE 仅存在于 NextAction）', () => {
  it.each([
    ['USER', USER, undefined],
    ['AGENT', AGENT, 'NA_ACTOR'],
    ['PLUGIN', PLUGIN, 'NA_ACTOR'],
    ['SYSTEM', SYSTEM, 'NA_ACTOR'],
  ] as const)('PROMOTE %s', (_label, actor, code) => {
    const h = openActionsHarness()
    try {
      const na = h.store.createNextAction({ statement: 's', workstreamId: 'WS-1' }, USER)
      expectActorCode(() => h.store.promoteNextAction(na.id, 'T-5', actor), code)
      if (code !== undefined) expect(h.store.getNextAction(na.id)?.status).toBe('PROPOSED')
    } finally {
      h.close()
    }
  })

  it.each([
    ['USER', USER, undefined],
    ['AGENT', AGENT, 'NA_ACTOR'],
    ['PLUGIN', PLUGIN, 'NA_ACTOR'],
    ['SYSTEM', SYSTEM, 'NA_ACTOR'],
  ] as const)('DISMISS %s', (_label, actor, code) => {
    const h = openActionsHarness()
    try {
      const na = h.store.createNextAction({ statement: 's' }, USER)
      expectActorCode(() => h.store.dismissNextAction(na.id, actor), code)
      if (code !== undefined) expect(h.store.getNextAction(na.id)?.status).toBe('PROPOSED')
    } finally {
      h.close()
    }
  })
})

describe('Blocker 全泳道（无矩阵行 + INV-PERM-1 闭集外 ⇒ USER-only）', () => {
  const BLK: CreateBlockerParams = { statement: 's', affects: [{ kind: 'TASK', id: 'T-1' }], source: 'x' }

  it.each([
    ['USER', USER, undefined],
    ['AGENT', AGENT, 'BLK_ACTOR'],
    ['PLUGIN', PLUGIN, 'BLK_ACTOR'],
    ['SYSTEM', SYSTEM, 'BLK_ACTOR'],
  ] as const)('create %s', (_label, actor, code) => {
    const h = openActionsHarness()
    try {
      expectActorCode(() => h.store.createBlocker({ ...BLK }, actor), code)
      if (code !== undefined) expect(h.store.listBlockers().length).toBe(0)
    } finally {
      h.close()
    }
  })

  it.each([
    ['USER', USER, undefined],
    ['AGENT', AGENT, 'BLK_ACTOR'],
    ['PLUGIN', PLUGIN, 'BLK_ACTOR'],
    ['SYSTEM', SYSTEM, 'BLK_ACTOR'],
  ] as const)('clear %s', (_label, actor, code) => {
    const h = openActionsHarness()
    try {
      const blk = h.store.createBlocker({ ...BLK }, USER)
      expectActorCode(() => h.store.clearBlocker(blk.id, actor), code)
      if (code !== undefined) expect(h.store.getBlocker(blk.id)?.status).toBe('ACTIVE')
    } finally {
      h.close()
    }
  })
})

describe('Objective 编辑面（§13 仅用户 ⇒ USER-only; 经 service.objectives）', () => {
  it.each([
    ['USER', USER, undefined],
    ['AGENT', AGENT, 'OBJ_ACTOR'],
    ['PLUGIN', PLUGIN, 'OBJ_ACTOR'],
    ['SYSTEM', SYSTEM, 'OBJ_ACTOR'],
  ] as const)('setObjectiveStatus %s', (_label, actor, code) => {
    const h = openActionsHarness()
    try {
      expectActorCode(() => h.service.objectives.setObjectiveStatus('OBJ-1', 'ACHIEVED', actor), code)
      if (code !== undefined) expect(h.service.objectives.loadObjectives().objectives[0]?.status).toBe('ACTIVE')
    } finally {
      h.close()
    }
  })

  it('saveObjectives 同样 USER-only（OBJ_ACTOR）', () => {
    const h = openActionsHarness()
    try {
      const base = h.service.objectives.loadObjectives().objectives
      expectActorCode(() => h.service.objectives.saveObjectives(base, AGENT), 'OBJ_ACTOR')
      expectActorCode(() => h.service.objectives.saveObjectives(base, PLUGIN), 'OBJ_ACTOR')
      expectActorCode(() => h.service.objectives.saveObjectives(base, SYSTEM), 'OBJ_ACTOR')
    } finally {
      h.close()
    }
  })
})

describe('工具面钉死（§7.2 冻结 11 工具 — 矩阵行②的「无 agent 面」在注册面成立）', () => {
  it('has research_next_action_create（矩阵行①的 agent 创建面 — WP-3.3 桩, WP-5.2 生命周期）', () => {
    expect(RESEARCH_TOOL_NAMES).toContain('research_next_action_create')
    expect(WRITE_TOOL_NAMES).toContain('research_next_action_create')
  })

  it('has NO promote/dismiss/blocker/objective tool（PROMOTE/DISMISS/CLEAR/编辑 = 仅用户 ⇒ 无 agent 工具面）', () => {
    for (const forbidden of [
      'research_next_action_promote',
      'research_next_action_dismiss',
      'research_next_action_update',
      'research_blocker_create',
      'research_blocker_clear',
      'research_objective_create',
      'research_objective_update',
      'research_objective_edit',
    ]) {
      expect(RESEARCH_TOOL_NAMES, `must not contain ${forbidden}`).not.toContain(forbidden)
    }
    // 写工具组 = 7（INV-PERM-1 闭集 — 无扩张）:
    expect(WRITE_TOOL_NAMES).toHaveLength(7)
    expect(RESEARCH_TOOL_NAMES).toHaveLength(11)
  })
})
