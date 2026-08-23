/**
 * WP-5.2 — ActionsService 业务面（real sqlite + 内存声明式树）:
 *
 *  - §16.3 写时引用校验（operational → 声明式 / run 面 — 「写入新引用时
 *    失败 = 拒绝」）: NA.workstreamId / Blocker.affects 存在性;
 *  - **PROMOTE 物化全流**（任务书「PROMOTE 类仅用户」的完整语义）:
 *    §13 守卫 → Task 定义文件（§4.1 冻结 schema）→ plan.yaml 重写
 *    （§4.4 三校验）→ 单 DB 事务（行迁移 + PLAN_ITEM_ADDED 账本）;
 *  - 补偿（文件半边落而 DB 半边失败 ⇒ plan.yaml 恢复旧字节; 定义文件
 *    保留 — INV-PLAN-9 未列入定义合法态; 再补偿失败 ⇒
 *    PROMOTE_COMPENSATION_FAILED）;
 *  - 乐观并发（第二连接真并发迁移 ⇒ PROMOTE_CONCURRENT + 补偿）;
 *  - 坏树拒绝（声明式树不可加载 ⇒ 拒绝物化/创建, 点名 [code] file path）。
 *
 * 故障注入: harness `faults`（transition 驱动失败 / 事务前抢占）+
 * memfs `failNextWrite` / `corruptNextWrite`。
 */

import { describe, expect, it } from 'vitest'

import { ActionsError } from '../../src/host/service/actions/index.js'
import {
  OBJECTIVES_PATH,
  PLUGIN_ACTOR,
  SYSTEM_ACTOR,
  USER_ACTOR,
  WS1_CANONICAL,
  WS1_PLAN_PATH,
  agentActor,
  openActionsHarness,
} from './harness.js'

function codeOf(e: unknown): string | undefined {
  return e instanceof ActionsError ? e.code : undefined
}

function captureError(fn: () => unknown): ActionsError {
  try {
    fn()
  } catch (e) {
    if (e instanceof ActionsError) return e
    throw e
  }
  throw new Error('expected the call to throw ActionsError')
}

const TASK5_PATH = `${WS1_PLAN_PATH.split('plan.yaml')[0]}items/tasks/T-5.yaml`

describe('§16.3 写时引用校验（operational → 声明式/run）', () => {
  it('createNextAction rejects a dangling workstream id (ACT_INPUT)', () => {
    const h = openActionsHarness()
    try {
      const err = captureError(() => h.service.createNextAction({ statement: 's', workstreamId: 'WS-99' }, USER_ACTOR))
      expect(err.code).toBe('ACT_INPUT')
      expect(err.message).toContain('WS-99')
      expect(h.store.listNextActions().length).toBe(0)
    } finally {
      h.close()
    }
  })

  it('createBlocker rejects dangling WS/T/R refs (BLK_REF_MISSING)', () => {
    const h = openActionsHarness()
    try {
      const mk = (ref: { kind: 'WORKSTREAM' | 'TASK' | 'RUN'; id: string }) =>
        h.service.createBlocker({ statement: 's', affects: [ref], source: 'x' }, USER_ACTOR)
      const cases: { kind: 'WORKSTREAM' | 'TASK' | 'RUN'; id: string }[] = [
        { kind: 'WORKSTREAM', id: 'WS-99' },
        { kind: 'TASK', id: 'T-99' },
        { kind: 'RUN', id: 'R-99' },
      ]
      for (const dangling of cases) {
        const err = captureError(() => mk(dangling))
        expect(err.code).toBe('BLK_REF_MISSING')
        expect(err.message).toContain(dangling.id)
      }
      expect(h.store.listBlockers().length).toBe(0)
    } finally {
      h.close()
    }
  })

  it('createBlocker accepts existing WS/T/R refs (R-1 via the injected run face)', () => {
    const h = openActionsHarness()
    try {
      const rec = h.service.createBlocker(
        {
          statement: '训练跑不了',
          affects: [
            { kind: 'WORKSTREAM', id: 'WS-1' },
            { kind: 'TASK', id: 'T-1' },
            { kind: 'RUN', id: 'R-1' },
          ],
          source: 'run:R-1 报告',
        },
        USER_ACTOR,
      )
      expect(rec.status).toBe('ACTIVE')
      expect(rec.affects).toHaveLength(3)
    } finally {
      h.close()
    }
  })

  it('a broken declarative tree refuses both create and promote (fail loud, naming the error)', () => {
    const h = openActionsHarness()
    try {
      h.fs.reader.addFile(WS1_PLAN_PATH, 'workstream: [broken\n')
      const errCreate = captureError(() => h.service.createNextAction({ statement: 's', workstreamId: 'WS-1' }, USER_ACTOR))
      expect(errCreate.code).toBe('ACT_INPUT')
      expect(errCreate.message).toContain('the declarative tree failed to load')
      const errBlocker = captureError(() =>
        h.service.createBlocker({ statement: 's', affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }], source: 'x' }, USER_ACTOR),
      )
      expect(errBlocker.code).toBe('ACT_INPUT')
    } finally {
      h.close()
    }
  })
})

describe('PROMOTE 物化全流（仅用户 — §6 矩阵; Task 物化 + 账本）', () => {
  it('happy path: task definition + plan rewrite + row transition + PLAN_ITEM_ADDED ledger, all in order', () => {
    const h = openActionsHarness()
    try {
      const na = h.service.createNextAction(
        { statement: '把基线跑通并记录指标', workstreamId: 'WS-1', rationale: '方案对比需要基线数据' },
        USER_ACTOR,
      )
      const oldPlanBytes = h.fs.content(WS1_PLAN_PATH)
      const result = h.service.promoteNextAction(na.id, {}, USER_ACTOR)

      // 返回面。
      expect(result.nextActionId).toBe('NA-1')
      expect(result.taskId).toBe('T-5') // WS-1 plan 已有 T-1..T-4 ⇒ 下一 T 序号
      expect(result.workstreamId).toBe('WS-1')
      expect(result.planPath).toBe('topics/TPC-1/workstreams/WS-1/plan.yaml')
      expect(result.newOrder).toEqual([...WS1_CANONICAL, 'T-5'])
      expect(result.managementActionId).toBe('MA-1')

      // 行面: PROMOTED + 指针 + 内容列未动。
      const row = h.store.getNextAction(na.id)
      expect(row?.status).toBe('PROMOTED')
      expect(row?.promoted_to_task_id).toBe('T-5')
      expect(row?.statement).toBe('把基线跑通并记录指标')
      expect(row?.created_by).toEqual(USER_ACTOR)

      // 文件面: Task 定义（§4.1 字段）+ plan 重写（§4.4）。
      const taskBytes = h.fs.content(TASK5_PATH)
      expect(taskBytes).not.toBeNull()
      expect(taskBytes).toContain('id: T-5')
      expect(taskBytes).toContain('workstream_id: WS-1')
      expect(taskBytes).toContain('title: 把基线跑通并记录指标')
      expect(taskBytes).toContain('acceptance_criteria: []')
      const planBytes = h.fs.content(WS1_PLAN_PATH)
      expect(planBytes).not.toBeNull()
      expect(planBytes).toContain('T-5')
      expect(planBytes).not.toBe(oldPlanBytes)

      // 账本面: PLAN_ITEM_ADDED（§12.1 冻结 kind — 本 WP 唯一可用的
      // 物化账本 kind; 无 NA_* 专用 kind）。
      const ma = h.rawDb.prepare('SELECT * FROM management_action WHERE id = ?').get('MA-1') as Record<string, string>
      expect(ma.action_kind).toBe('PLAN_ITEM_ADDED')
      expect(ma.detail).toContain('promoted to task T-5')
      expect(ma.detail).toContain('WS-1')
    } finally {
      h.close()
    }
  })

  it('workstream resolution: NA 自带 ws 优先; 显式参数仅补缺; 不一致拒绝 (PROMOTE_INPUT)', () => {
    const h = openActionsHarness()
    try {
      // NA 无 ws + 显式参数:
      const na1 = h.service.createNextAction({ statement: 'a' }, USER_ACTOR)
      const r1 = h.service.promoteNextAction(na1.id, { workstreamId: 'WS-1' }, USER_ACTOR)
      expect(r1.workstreamId).toBe('WS-1')

      // NA 有 ws + 参数不一致:
      const na2 = h.service.createNextAction({ statement: 'b', workstreamId: 'WS-1' }, USER_ACTOR)
      const err = captureError(() => h.service.promoteNextAction(na2.id, { workstreamId: 'WS-2' }, USER_ACTOR))
      expect(err.code).toBe('PROMOTE_INPUT')

      // NA 无 ws + 无参数:
      const na3 = h.service.createNextAction({ statement: 'c' }, USER_ACTOR)
      const err2 = captureError(() => h.service.promoteNextAction(na3.id, {}, USER_ACTOR))
      expect(err2.code).toBe('PROMOTE_INPUT')
    } finally {
      h.close()
    }
  })

  it('a workstream without plan.yaml refuses materialization (PROMOTE_PLAN)', () => {
    const h = openActionsHarness()
    try {
      const na = h.service.createNextAction({ statement: 's', workstreamId: 'WS-2' }, USER_ACTOR)
      const err = captureError(() => h.service.promoteNextAction(na.id, {}, USER_ACTOR))
      expect(err.code).toBe('PROMOTE_PLAN')
      expect(err.message).toContain('no canonical plan.yaml')
    } finally {
      h.close()
    }
  })

  it('explicit index: insert at position; out-of-bounds rejected (PROMOTE_INPUT)', () => {
    const h = openActionsHarness()
    try {
      const na = h.service.createNextAction({ statement: 's', workstreamId: 'WS-1' }, USER_ACTOR)
      const r = h.service.promoteNextAction(na.id, { workstreamId: 'WS-1', index: 0 }, USER_ACTOR)
      expect(r.newOrder[0]).toBe('T-5')
      expect(r.newOrder).toHaveLength(8)

      const na2 = h.service.createNextAction({ statement: 's2', workstreamId: 'WS-1' }, USER_ACTOR)
      const err = captureError(() => h.service.promoteNextAction(na2.id, { workstreamId: 'WS-1', index: 99 }, USER_ACTOR))
      expect(err.code).toBe('PROMOTE_INPUT')
    } finally {
      h.close()
    }
  })

  it('AGENT promote is rejected before any file write (矩阵 ✅/❌/❌/❌)', () => {
    const h = openActionsHarness()
    try {
      const na = h.service.createNextAction({ statement: 's', workstreamId: 'WS-1' }, USER_ACTOR)
      const oldPlan = h.fs.content(WS1_PLAN_PATH)
      for (const actor of [agentActor('R-1'), PLUGIN_ACTOR, SYSTEM_ACTOR]) {
        const err = captureError(() => h.service.promoteNextAction(na.id, {}, actor))
        expect(err.code).toBe('NA_ACTOR')
      }
      expect(h.fs.content(WS1_PLAN_PATH)).toBe(oldPlan)
      expect(h.fs.content(TASK5_PATH)).toBeNull()
      expect(h.store.getNextAction(na.id)?.status).toBe('PROPOSED')
    } finally {
      h.close()
    }
  })
})

describe('PROMOTE 补偿面（文件半边落, DB 半边失败）', () => {
  it('driver failure in the transaction ⇒ PROMOTE_DB_FAILED + plan 恢复旧字节 + 定义文件保留 + 可重试', () => {
    const h = openActionsHarness()
    try {
      const na = h.service.createNextAction({ statement: 's', workstreamId: 'WS-1' }, USER_ACTOR)
      const oldPlanBytes = h.fs.content(WS1_PLAN_PATH)
      h.faults.failTransitionOnce()

      const err = captureError(() => h.service.promoteNextAction(na.id, {}, USER_ACTOR))
      expect(err.code).toBe('PROMOTE_DB_FAILED')
      expect(err.message).toContain('plan.yaml was restored')

      // 补偿断言:
      expect(h.fs.content(WS1_PLAN_PATH)).toBe(oldPlanBytes) // plan 恢复
      expect(h.fs.content(TASK5_PATH)).not.toBeNull() // 定义文件保留（INV-PLAN-9）
      expect(h.store.getNextAction(na.id)?.status).toBe('PROPOSED') // 行未迁移
      // 账本无 MA（事务回滚）:
      expect(h.rawDb.prepare('SELECT COUNT(*) AS n FROM management_action').get() as { n: number }).toEqual({ n: 0 })

      // 可重试: 同一 NA 再次 PROMOTE 成功; T-5 定义孤儿仍在盘上
      // （INV-PLAN-9 合法未列入态, §1.1 规则 3 禁覆盖）⇒ 取下一空位 T-6:
      const retry = h.service.promoteNextAction(na.id, {}, USER_ACTOR)
      expect(retry.taskId).toBe('T-6')
      expect(retry.newOrder).toEqual([...WS1_CANONICAL, 'T-6'])
      expect(h.store.getNextAction(na.id)?.status).toBe('PROMOTED')
      expect(h.fs.content(TASK5_PATH)).not.toBeNull() // 孤儿保留
    } finally {
      h.close()
    }
  })

  it('compensation write failure ⇒ PROMOTE_COMPENSATION_FAILED (plan 未恢复, 人工对账)', () => {
    const h = openActionsHarness()
    try {
      const na = h.service.createNextAction({ statement: 's', workstreamId: 'WS-1' }, USER_ACTOR)
      h.faults.failTransitionOnce()
      h.fs.failWriteAfter(2) // 定义文件 + plan 重写成功; 补偿的 plan 恢复写失败

      const err = captureError(() => h.service.promoteNextAction(na.id, {}, USER_ACTOR))
      expect(err.code).toBe('PROMOTE_COMPENSATION_FAILED')
      // plan.yaml 保持 NEW 字节（恢复失败 — 含 T-5）:
      expect(h.fs.content(WS1_PLAN_PATH)).toContain('T-5')
      expect(h.store.getNextAction(na.id)?.status).toBe('PROPOSED')
    } finally {
      h.close()
    }
  })

  it('file-stage failure (task definition write) ⇒ PROMOTE_PLAN; plan 从未被触碰; 可重试', () => {
    const h = openActionsHarness()
    try {
      const na = h.service.createNextAction({ statement: 's', workstreamId: 'WS-1' }, USER_ACTOR)
      const oldPlanBytes = h.fs.content(WS1_PLAN_PATH)
      h.fs.failNextWrite() // Task 定义文件写失败（物化第一个文件动作）

      const err = captureError(() => h.service.promoteNextAction(na.id, {}, USER_ACTOR))
      expect(err.code).toBe('PROMOTE_PLAN')
      expect(h.fs.content(WS1_PLAN_PATH)).toBe(oldPlanBytes)
      expect(h.store.getNextAction(na.id)?.status).toBe('PROPOSED')

      // 重试成功:
      const retry = h.service.promoteNextAction(na.id, {}, USER_ACTOR)
      expect(retry.taskId).toBe('T-5')
    } finally {
      h.close()
    }
  })
})

describe('PROMOTE 乐观并发（第二连接真并发 — 条件 UPDATE 门）', () => {
  it('concurrent dismiss wins ⇒ PROMOTE_CONCURRENT + plan 恢复 + 定义文件保留', () => {
    const h = openActionsHarness()
    try {
      const na = h.service.createNextAction({ statement: 's', workstreamId: 'WS-1' }, USER_ACTOR)
      const oldPlanBytes = h.fs.content(WS1_PLAN_PATH)
      // 事务 BEGIN 之前, 第二连接已提交 DISMISS（真并发迁移）:
      h.faults.preemptBeforeDbTransaction(() => {
        h.secondStore().dismissNextAction(na.id, USER_ACTOR)
      })

      const err = captureError(() => h.service.promoteNextAction(na.id, {}, USER_ACTOR))
      expect(err.code).toBe('PROMOTE_CONCURRENT')
      expect(err.message).toContain('now DISMISSED')

      // 补偿断言（物化文件半边已落）:
      expect(h.fs.content(WS1_PLAN_PATH)).toBe(oldPlanBytes)
      expect(h.fs.content(TASK5_PATH)).not.toBeNull() // 未列入定义保留
      expect(h.store.getNextAction(na.id)?.status).toBe('DISMISSED') // 并发胜者态
      expect(h.fs.content(WS1_PLAN_PATH)).not.toContain('T-5')
    } finally {
      h.close()
    }
  })
})

describe('Objective 读面（loader 投影 — 声明式 = 真值）', () => {
  it('listObjectives returns the loader face (base tree: OBJ-1 ACTIVE P1 TOPIC)', () => {
    const h = openActionsHarness()
    try {
      const objectives = h.service.listObjectives()
      expect(objectives).toHaveLength(1)
      expect(objectives[0]?.id).toBe('OBJ-1')
      expect(objectives[0]?.status).toBe('ACTIVE')
      expect(objectives[0]?.priority).toBe('P1')
      expect(objectives[0]?.scope).toBe('TOPIC')
    } finally {
      h.close()
    }
  })

  it('objectives.yaml is never written by the operational face (只读投影)', () => {
    const h = openActionsHarness()
    try {
      h.service.createNextAction({ statement: 's', workstreamId: 'WS-1' }, USER_ACTOR)
      h.service.createBlocker({ statement: 's', affects: [{ kind: 'TASK', id: 'T-1' }], source: 'x' }, USER_ACTOR)
      const before = h.fs.content(OBJECTIVES_PATH)
      h.service.promoteNextAction(h.store.getNextAction('NA-1')!.id, {}, USER_ACTOR)
      expect(h.fs.content(OBJECTIVES_PATH)).toBe(before)
      expect(h.fs.writes.some((w) => w.path === OBJECTIVES_PATH)).toBe(false)
    } finally {
      h.close()
    }
  })
})
