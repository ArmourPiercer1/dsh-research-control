/**
 * WP-5.2 — ActionsStore 业务面（real sqlite 双连接）:
 *
 *  - 三对象全生命周期（创建 → §13 迁移 → 终态拒绝; 零删除 — 无 delete API）;
 *  - 权限泳道（创建面 USER+AGENT; 迁移/清除面 USER only — 矩阵）;
 *  - 输入校验（§16.3 id 模式 / 冻结字段形状）;
 *  - 乐观并发（第二连接同时迁移 ⇒ 恰好一个成功; 败者重读判别 WRONG_STATE）;
 *  - 查询面（列表排序确定性 created_at→id; 状态/WS 过滤; 过滤值校验）;
 *  - ID 烧号纪律（§1.1: 失败预留 = 合法 gap, 计数器不回退）。
 */

import { describe, expect, it } from 'vitest'

import { ActionsError } from '../../src/host/service/actions/index.js'
import { USER_ACTOR, PLUGIN_ACTOR, SYSTEM_ACTOR, T0, adaptDatabaseSync, agentActor, openActionsHarness } from './harness.js'

function codeOf(e: unknown): string | undefined {
  return e instanceof ActionsError ? e.code : undefined
}

describe('createNextAction（创建面 — 用户 + Agent; §9.3）', () => {
  it('USER creates a PROPOSED row with the full frozen field face', () => {
    const h = openActionsHarness()
    try {
      const rec = h.store.createNextAction(
        { statement: '先跑一遍基线', workstreamId: 'WS-1', rationale: '当前数据不足以判断方案' },
        USER_ACTOR,
      )
      expect(rec.id).toBe('NA-1')
      expect(rec.status).toBe('PROPOSED')
      expect(rec.statement).toBe('先跑一遍基线')
      expect(rec.workstream_id).toBe('WS-1')
      expect(rec.rationale).toBe('当前数据不足以判断方案')
      expect(rec.created_by).toEqual(USER_ACTOR)
      expect(rec.created_at).toBeGreaterThan(T0)
      expect(rec.promoted_to_task_id).toBeUndefined()
      expect(h.store.getNextAction('NA-1')).toEqual(rec)
    } finally {
      h.close()
    }
  })

  it('workstream_id and rationale are optional（§9.3 ❌ 列）', () => {
    const h = openActionsHarness()
    try {
      const rec = h.store.createNextAction({ statement: '写个小结' }, USER_ACTOR)
      expect(rec.workstream_id).toBeUndefined()
      expect(rec.rationale).toBeUndefined()
    } finally {
      h.close()
    }
  })

  it('AGENT with run binding creates（矩阵 ✅/✅）', () => {
    const h = openActionsHarness()
    try {
      const rec = h.store.createNextAction({ statement: '检查数据管道' }, agentActor('R-1'))
      expect(rec.created_by).toEqual({ kind: 'AGENT', run_id: 'R-1', label: 'agent-1' })
    } finally {
      h.close()
    }
  })

  it('AGENT without run_id is rejected (NA_ACTOR)', () => {
    const h = openActionsHarness()
    try {
      let caught: unknown
      try {
        h.store.createNextAction({ statement: 'x' }, { kind: 'AGENT' })
      } catch (e) {
        caught = e
      }
      expect(codeOf(caught)).toBe('NA_ACTOR')
    } finally {
      h.close()
    }
  })

  it('PLUGIN and SYSTEM are rejected (no matrix row)', () => {
    const h = openActionsHarness()
    try {
      for (const actor of [PLUGIN_ACTOR, SYSTEM_ACTOR]) {
        let caught: unknown
        try {
          h.store.createNextAction({ statement: 'x' }, actor)
        } catch (e) {
          caught = e
        }
        expect(codeOf(caught)).toBe('NA_ACTOR')
      }
    } finally {
      h.close()
    }
  })

  it('input validation: statement required, workstream id well-formed (ACT_INPUT)', () => {
    const h = openActionsHarness()
    try {
      expect(() => h.store.createNextAction({ statement: '' }, USER_ACTOR)).toThrowError(/ACT_INPUT|statement/)
      expect(() => h.store.createNextAction({ statement: undefined as unknown as string }, USER_ACTOR)).toThrow(ActionsError)
      expect(() => h.store.createNextAction({ statement: 'x', workstreamId: 'nope' }, USER_ACTOR)).toThrow(ActionsError)
      expect(() => h.store.createNextAction({ statement: 'x', workstreamId: 'WS-1', rationale: '' }, USER_ACTOR)).toThrow(ActionsError)
    } finally {
      h.close()
    }
  })
})

describe('promoteNextAction / dismissNextAction（迁移面 — 仅用户; §13）', () => {
  it('USER promote: PROPOSED → PROMOTED with the task pointer', () => {
    const h = openActionsHarness()
    try {
      const rec = h.store.createNextAction({ statement: 's' }, USER_ACTOR)
      const promoted = h.store.promoteNextAction(rec.id, 'T-5', USER_ACTOR)
      expect(promoted.status).toBe('PROMOTED')
      expect(promoted.promoted_to_task_id).toBe('T-5')
      expect(h.store.getNextAction(rec.id)?.status).toBe('PROMOTED')
    } finally {
      h.close()
    }
  })

  it('USER dismiss: PROPOSED → DISMISSED (terminal)', () => {
    const h = openActionsHarness()
    try {
      const rec = h.store.createNextAction({ statement: 's' }, USER_ACTOR)
      const dismissed = h.store.dismissNextAction(rec.id, USER_ACTOR)
      expect(dismissed.status).toBe('DISMISSED')
      expect(dismissed.promoted_to_task_id).toBeUndefined()
    } finally {
      h.close()
    }
  })

  it('terminal states refuse further moves (NA_WRONG_STATE)', () => {
    const h = openActionsHarness()
    try {
      const a = h.store.createNextAction({ statement: 'a' }, USER_ACTOR)
      h.store.promoteNextAction(a.id, 'T-5', USER_ACTOR)
      expect(() => h.store.promoteNextAction(a.id, 'T-6', USER_ACTOR)).toThrow(ActionsError)
      let caught: unknown
      try {
        h.store.promoteNextAction(a.id, 'T-6', USER_ACTOR)
      } catch (e) {
        caught = e
      }
      expect(codeOf(caught)).toBe('NA_WRONG_STATE')
      expect(() => h.store.dismissNextAction(a.id, USER_ACTOR)).toThrow(ActionsError)

      const b = h.store.createNextAction({ statement: 'b' }, USER_ACTOR)
      h.store.dismissNextAction(b.id, USER_ACTOR)
      expect(() => h.store.promoteNextAction(b.id, 'T-7', USER_ACTOR)).toThrow(ActionsError)
      expect(() => h.store.dismissNextAction(b.id, USER_ACTOR)).toThrow(ActionsError)
    } finally {
      h.close()
    }
  })

  it('AGENT/PLUGIN promote is rejected (NA_ACTOR — 矩阵 ✅/❌/❌/❌)', () => {
    const h = openActionsHarness()
    try {
      const rec = h.store.createNextAction({ statement: 's' }, USER_ACTOR)
      for (const actor of [agentActor('R-1'), PLUGIN_ACTOR, SYSTEM_ACTOR]) {
        let caught: unknown
        try {
          h.store.promoteNextAction(rec.id, 'T-5', actor)
        } catch (e) {
          caught = e
        }
        expect(codeOf(caught)).toBe('NA_ACTOR')
      }
      expect(h.store.getNextAction(rec.id)?.status).toBe('PROPOSED')
    } finally {
      h.close()
    }
  })

  it('unknown id → NA_NOT_FOUND; malformed task id → ACT_INPUT', () => {
    const h = openActionsHarness()
    try {
      expect(() => h.store.promoteNextAction('NA-99', 'T-5', USER_ACTOR)).toThrow(ActionsError)
      let caught: unknown
      try {
        h.store.promoteNextAction('NA-99', 'T-5', USER_ACTOR)
      } catch (e) {
        caught = e
      }
      expect(codeOf(caught)).toBe('NA_NOT_FOUND')
      expect(() => h.store.promoteNextAction('nope', 'T-5', USER_ACTOR)).toThrow(ActionsError)
      const rec = h.store.createNextAction({ statement: 's' }, USER_ACTOR)
      expect(() => h.store.promoteNextAction(rec.id, 'nope', USER_ACTOR)).toThrow(ActionsError)
      expect(() => h.store.dismissNextAction('NA-98', USER_ACTOR)).toThrow(ActionsError)
    } finally {
      h.close()
    }
  })

  it('concurrent double-promote: exactly one wins (conditional UPDATE — optimistic gate)', () => {
    const h = openActionsHarness()
    try {
      const rec = h.store.createNextAction({ statement: 's', workstreamId: 'WS-1' }, USER_ACTOR)
      const second = h.secondStore()
      let loser: unknown
      const winner = h.store.promoteNextAction(rec.id, 'T-5', USER_ACTOR)
      expect(winner.status).toBe('PROMOTED')
      try {
        loser = second.promoteNextAction(rec.id, 'T-6', USER_ACTOR)
      } catch (e) {
        loser = e
      }
      expect(loser).toBeInstanceOf(ActionsError)
      expect(codeOf(loser)).toBe('NA_WRONG_STATE')
      expect(h.store.getNextAction(rec.id)?.promoted_to_task_id).toBe('T-5')
    } finally {
      h.close()
    }
  })
})

describe('createBlocker / clearBlocker（全泳道仅用户 — §9.4 / INV-PERM-1 闭集外）', () => {
  it('USER creates an ACTIVE blocker with typed affects', () => {
    const h = openActionsHarness()
    try {
      const rec = h.store.createBlocker(
        {
          statement: 'GPU 队列满, 跑不了训练',
          affects: [
            { kind: 'WORKSTREAM', id: 'WS-1' },
            { kind: 'TASK', id: 'T-1' },
          ],
          source: '用户报告',
          references: ['doc:notes/gpu.md'],
        },
        USER_ACTOR,
      )
      expect(rec.id).toBe('BLK-1')
      expect(rec.status).toBe('ACTIVE')
      expect(rec.affects).toHaveLength(2)
      expect(rec.source).toBe('用户报告')
      expect(rec.references).toEqual(['doc:notes/gpu.md'])
      expect(rec.cleared_at).toBeUndefined()
    } finally {
      h.close()
    }
  })

  it('input validation: affects ≥1 with well-formed typed refs (ACT_INPUT)', () => {
    const h = openActionsHarness()
    try {
      const base = { statement: 's', source: 'x' }
      expect(() => h.store.createBlocker({ ...base, affects: [] }, USER_ACTOR)).toThrow(ActionsError)
      expect(() => h.store.createBlocker({ ...base, affects: [{ kind: 'GATE', id: 'G-1' }] as never }, USER_ACTOR)).toThrow(ActionsError)
      expect(() => h.store.createBlocker({ ...base, affects: [{ kind: 'WORKSTREAM', id: 'nope' }] }, USER_ACTOR)).toThrow(ActionsError)
      // RUN ref 的存在性校验在 service 层（runExists 缝）; store 层只钉形状。
      const runRef = h.store.createBlocker({ ...base, affects: [{ kind: 'RUN', id: 'R-1' }] }, USER_ACTOR)
      expect(runRef.affects).toEqual([{ kind: 'RUN', id: 'R-1' }])
      expect(() => h.store.createBlocker({ statement: '', affects: [{ kind: 'TASK', id: 'T-1' }], source: 'x' }, USER_ACTOR)).toThrow(ActionsError)
      expect(() => h.store.createBlocker({ ...base, affects: [{ kind: 'TASK', id: 'T-1' }], source: '' }, USER_ACTOR)).toThrow(ActionsError)
    } finally {
      h.close()
    }
  })

  it('AGENT/PLUGIN/SYSTEM create is rejected (BLK_ACTOR)', () => {
    const h = openActionsHarness()
    try {
      for (const actor of [agentActor('R-1'), PLUGIN_ACTOR, SYSTEM_ACTOR]) {
        let caught: unknown
        try {
          h.store.createBlocker({ statement: 's', affects: [{ kind: 'TASK', id: 'T-1' }], source: 'x' }, actor)
        } catch (e) {
          caught = e
        }
        expect(codeOf(caught)).toBe('BLK_ACTOR')
      }
    } finally {
      h.close()
    }
  })

  it('USER clear: ACTIVE → CLEARED with cleared_at; terminal afterwards', () => {
    const h = openActionsHarness()
    try {
      const rec = h.store.createBlocker({ statement: 's', affects: [{ kind: 'TASK', id: 'T-1' }], source: 'x' }, USER_ACTOR)
      const cleared = h.store.clearBlocker(rec.id, USER_ACTOR)
      expect(cleared.status).toBe('CLEARED')
      expect(cleared.cleared_at).toBeGreaterThan(T0)
      expect(() => h.store.clearBlocker(rec.id, USER_ACTOR)).toThrow(ActionsError)
      let caught: unknown
      try {
        h.store.clearBlocker(rec.id, USER_ACTOR)
      } catch (e) {
        caught = e
      }
      expect(codeOf(caught)).toBe('BLK_WRONG_STATE')
    } finally {
      h.close()
    }
  })

  it('AGENT clear is rejected (BLK_ACTOR); unknown id → BLK_NOT_FOUND', () => {
    const h = openActionsHarness()
    try {
      const rec = h.store.createBlocker({ statement: 's', affects: [{ kind: 'TASK', id: 'T-1' }], source: 'x' }, USER_ACTOR)
      let caught: unknown
      try {
        h.store.clearBlocker(rec.id, agentActor('R-1'))
      } catch (e) {
        caught = e
      }
      expect(codeOf(caught)).toBe('BLK_ACTOR')
      expect(h.store.getBlocker(rec.id)?.status).toBe('ACTIVE')
      expect(() => h.store.clearBlocker('BLK-99', USER_ACTOR)).toThrow(ActionsError)
      let caught2: unknown
      try {
        h.store.clearBlocker('BLK-99', USER_ACTOR)
      } catch (e) {
        caught2 = e
      }
      expect(codeOf(caught2)).toBe('BLK_NOT_FOUND')
    } finally {
      h.close()
    }
  })
})

describe('查询面（列表/过滤 — 视图目标 3 的数据支撑）', () => {
  it('listNextActions: deterministic order (created_at → id) + status filter', () => {
    const h = openActionsHarness()
    try {
      h.store.createNextAction({ statement: 'one' }, USER_ACTOR)
      h.store.createNextAction({ statement: 'two' }, USER_ACTOR)
      h.store.createNextAction({ statement: 'three' }, USER_ACTOR)
      const all = h.store.listNextActions()
      expect(all.map((r) => r.id)).toEqual(['NA-1', 'NA-2', 'NA-3'])
      h.store.promoteNextAction('NA-1', 'T-5', USER_ACTOR)
      expect(h.store.listNextActions({ status: 'PROPOSED' }).map((r) => r.id)).toEqual(['NA-2', 'NA-3'])
      expect(h.store.listNextActions({ status: 'PROMOTED' }).map((r) => r.id)).toEqual(['NA-1'])
      expect(() => h.store.listNextActions({ status: 'BROKEN' as never })).toThrow(ActionsError)
    } finally {
      h.close()
    }
  })

  it('listNextActions: workstream filter', () => {
    const h = openActionsHarness()
    try {
      h.store.createNextAction({ statement: 'a', workstreamId: 'WS-1' }, USER_ACTOR)
      h.store.createNextAction({ statement: 'b', workstreamId: 'WS-2' }, USER_ACTOR)
      h.store.createNextAction({ statement: 'c' }, USER_ACTOR)
      const ws1 = h.store.listNextActions({ workstreamId: 'WS-1' })
      expect(ws1.map((r) => r.id)).toEqual(['NA-1'])
      expect(() => h.store.listNextActions({ workstreamId: 'nope' })).toThrow(ActionsError)
    } finally {
      h.close()
    }
  })

  it('listBlockers: status filter + deterministic order', () => {
    const h = openActionsHarness()
    try {
      h.store.createBlocker({ statement: 'a', affects: [{ kind: 'TASK', id: 'T-1' }], source: 'x' }, USER_ACTOR)
      h.store.createBlocker({ statement: 'b', affects: [{ kind: 'TASK', id: 'T-2' }], source: 'x' }, USER_ACTOR)
      h.store.clearBlocker('BLK-1', USER_ACTOR)
      expect(h.store.listBlockers({ status: 'ACTIVE' }).map((r) => r.id)).toEqual(['BLK-2'])
      expect(h.store.listBlockers({ status: 'CLEARED' }).map((r) => r.id)).toEqual(['BLK-1'])
      expect(h.store.listBlockers().map((r) => r.id)).toEqual(['BLK-1', 'BLK-2'])
      expect(() => h.store.listBlockers({ status: 'LOST' as never })).toThrow(ActionsError)
    } finally {
      h.close()
    }
  })
})

describe('存储纪律（零删除 + ID 烧号 + 计数器诊断面）', () => {
  it('exposes no delete method (零删除纪律 — 面级断言)', () => {
    const h = openActionsHarness()
    try {
      const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(h.store))
      for (const name of proto) {
        expect(name).not.toMatch(/delete|remove|purge/i)
      }
    } finally {
      h.close()
    }
  })

  it('a failed insert burns its id (gap is legal — §1.1 计数器不回退)', () => {
    const h = openActionsHarness()
    try {
      h.store.createNextAction({ statement: 'ok' }, USER_ACTOR)
      // 计数器面（peek = 已分配数; 失败/释放均不回退 — §1.1）。
      const counters = h.store.allocatedCounters
      expect(counters.nextAction).toBe(1)
      expect(counters.blocker).toBe(0)
      // 再创建一个, 计数器单调前进。
      h.store.createNextAction({ statement: 'two' }, USER_ACTOR)
      expect(h.store.allocatedCounters.nextAction).toBe(2)
      // 烧号 gap: 直接经 raw 验证 allocator 视角 — reserve+release 不复用号。
      const reservation = h.allocator.reserve('NEXT_ACTION', 'PRJ-1')
      h.allocator.release(reservation)
      const next = h.allocator.reserve('NEXT_ACTION', 'PRJ-1')
      expect(next.id).toBe('NA-4') // NA-3 已烧, 不复用
      h.allocator.release(next)
    } finally {
      h.close()
    }
  })
})
