/**
 * WP-3.1 — 状态机 (PLAN_FORK_SPEC §10) 全转换矩阵 + 守卫 + 乐观门 +
 * 账本 append 同事务 + 存储层不可变/不删 trigger (经真实 sqlite,
 * persist harness — 同目录 persist.test.ts 的基础设施)。
 *
 * 16 对 (4×4) 全核对: 4 合法 (OPEN→SELECTED/DISMISSED/STALE, STALE→
 * DISMISSED) + 12 非法 (含 4 自环)。catalog 无 PLAN_FORK_* 事件 ⇒ 迁移
 * 经 ManagementAction 账本 (action_kind PF_SELECTED/PF_DISMISSED/
 * PF_STALE_MARKED), 不产 History 事件 (模块头注; 发射者 actor 按矩阵
 * 由调用方 WP 传入 — 本测试覆盖 USER/PLUGIN 两例)。
 */

import { DatabaseSync } from 'node:sqlite'
import { join as joinPath } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  PF_STATUSES,
  PF_TRANSITIONS,
  PlanForkError,
  checkPfTransition,
  isLegalPfTransition,
  legalPfTargets,
  isPfStatus,
  SQL_TRANSITION_PLAN_FORK,
  TRANSITION_ACTION_KIND,
  type ActorRef,
  type PfStatus,
  type PfTransition,
} from '../../src/host/domain/planfork/index.js'
import { openStore, type PersistHarness } from './persist-harness.js'
import { makeParams } from './fixtures.js'

/** Run `fn`, expect a PlanForkError with the given code (code-level check). */
function expectCode(fn: () => unknown, code: string): PlanForkError {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(PlanForkError)
    expect((e as PlanForkError).code).toBe(code)
    return e as PlanForkError
  }
  throw new Error(`expected PlanForkError(${code}), got success`)
}

describe('§10 转换表 (逐对矩阵 4×4 = 16)', () => {
  it('matches the frozen table exactly', () => {
    expect(PF_TRANSITIONS).toEqual({
      OPEN: ['SELECTED', 'DISMISSED', 'STALE'],
      STALE: ['DISMISSED'],
      SELECTED: [],
      DISMISSED: [],
    })
    // 逐对穷举
    const legal: Array<[PfStatus, PfStatus]> = [
      ['OPEN', 'SELECTED'],
      ['OPEN', 'DISMISSED'],
      ['OPEN', 'STALE'],
      ['STALE', 'DISMISSED'],
    ]
    for (const from of PF_STATUSES) {
      for (const to of PF_STATUSES) {
        const expected = legal.some(([f, t]) => f === from && t === to)
        expect(isLegalPfTransition(from, to), `${from}→${to}`).toBe(expected)
      }
    }
  })

  it('checkPfTransition throws PF_WRONG_STATE on all 12 illegal pairs, legal on the 4', () => {
    let legalCount = 0
    for (const from of PF_STATUSES) {
      for (const to of PF_STATUSES) {
        if (isLegalPfTransition(from, to)) {
          expect(() => checkPfTransition('PF-1', from, to), `${from}→${to} legal`).not.toThrow()
          legalCount++
          continue
        }
        let err: PlanForkError | undefined
        try {
          checkPfTransition('PF-1', from, to)
        } catch (e) {
          err = e as PlanForkError
        }
        expect(err, `${from}→${to} illegal must throw`).toBeDefined()
        expect(err!.code).toBe('PF_WRONG_STATE')
        expect(err!.message).toContain('PF-1')
        expect(err!.message).toContain(from)
        expect(err!.message).toContain(to)
        // 终态消息明示 terminal
        if (legalPfTargets(from).length === 0) expect(err!.message).toContain('终态')
      }
    }
    expect(legalCount).toBe(4)
  })

  it('isPfStatus recognizes exactly the 4 frozen states', () => {
    for (const s of PF_STATUSES) expect(isPfStatus(s)).toBe(true)
    expect(isPfStatus('OPEN2')).toBe(false)
    expect(isPfStatus(42)).toBe(false)
    expect(isPfStatus(undefined)).toBe(false)
  })

  it('TRANSITION_ACTION_KIND maps the 3 exits to the frozen PF_* ledger kinds', () => {
    expect(TRANSITION_ACTION_KIND).toEqual({ SELECTED: 'PF_SELECTED', DISMISSED: 'PF_DISMISSED', STALE: 'PF_STALE_MARKED' })
  })
})

describe('PlanForkStore.transition — 乐观门 + 账本同事务 (真实 sqlite)', () => {
  let h: PersistHarness
  beforeEach(() => {
    h = openStore()
  })
  afterEach(() => h.close())

  it('OPEN → STALE (插件 actor) updates the row + appends PF_STALE_MARKED in ONE transaction', () => {
    const created = h.store.createPlanFork(makeParams(), h.ctx())
    const updated = h.store.transition(created.id, { to: 'STALE', stale_reason: 'items/tasks/T-2.yaml OID 变化 (用户改了 goal)' }, { kind: 'PLUGIN' })
    expect(updated.status).toBe('STALE')
    expect(updated.stale_reason).toContain('T-2.yaml')
    expect(updated).not.toHaveProperty('selected_at')
    // 账本: 创建 PF_CREATED + 迁移 PF_STALE_MARKED (2 行)
    const ledger = h.store.listManagementActions()
    expect(ledger.map((a) => a.action_kind)).toEqual(['PF_CREATED', 'PF_STALE_MARKED'])
    expect(ledger[1]!.actor).toEqual({ kind: 'PLUGIN' })
    expect(ledger[1]!.subject_refs).toEqual([{ kind: 'PLAN_FORK', id: created.id }])
    // 行内容与创建时一致 (迁移只触状态缓存列)
    expect(h.store.getPlanFork(created.id)!.base_plan_objects).toEqual(created.base_plan_objects)
  })

  it('OPEN → SELECTED (用户 actor) requires selected_at + selected_by (字段共现)', () => {
    const created = h.store.createPlanFork(makeParams(), h.ctx())
    const actor: ActorRef = { kind: 'USER', label: 'researcher' }
    const updated = h.store.transition(created.id, { to: 'SELECTED', selected_at: 1756000000000, selected_by: actor }, actor)
    expect(updated.status).toBe('SELECTED')
    expect(updated.selected_at).toBe(1756000000000)
    expect(updated.selected_by).toEqual(actor)
    const ledger = h.store.listManagementActions()
    expect(ledger[1]!.action_kind).toBe('PF_SELECTED')
    expect(ledger[1]!.actor).toEqual(actor)
  })

  it('STALE → DISMISSED (the only exit of STALE)', () => {
    const created = h.store.createPlanFork(makeParams(), h.ctx())
    h.store.transition(created.id, { to: 'STALE', stale_reason: 'r1' }, { kind: 'PLUGIN' })
    const updated = h.store.transition(created.id, { to: 'DISMISSED', dismissed_at: 1756000001000 }, { kind: 'USER' })
    expect(updated.status).toBe('DISMISSED')
    expect(updated.dismissed_at).toBe(1756000001000)
    expect(h.store.listManagementActions().map((a) => a.action_kind)).toEqual(['PF_CREATED', 'PF_STALE_MARKED', 'PF_DISMISSED'])
  })

  it('rejects illegal moves through the store (PF_WRONG_STATE, 行不动, 无额外账本行)', () => {
    const created = h.store.createPlanFork(makeParams(), h.ctx())
    // OPEN → DISMISSED 合法
    h.store.transition(created.id, { to: 'DISMISSED', dismissed_at: 1 }, { kind: 'USER' })
    expect(h.store.getPlanFork(created.id)!.status).toBe('DISMISSED')
    // DISMISSED 终态: 任何再迁移都拒 (含 STALE / SELECTED)
    expectCode(() => h.store.transition(created.id, { to: 'STALE', stale_reason: 'x' }, { kind: 'PLUGIN' }), 'PF_WRONG_STATE')
    expectCode(() => h.store.transition(created.id, { to: 'SELECTED', selected_at: 2, selected_by: { kind: 'USER' } }, { kind: 'USER' }), 'PF_WRONG_STATE')
    expect(h.store.getPlanFork(created.id)!.status).toBe('DISMISSED')
    expect(h.store.listManagementActions()).toHaveLength(2) // 只有 PF_CREATED + PF_DISMISSED
  })

  it('rejects SELECTED as a source (终态) and STALE re-marking on a DISMISSED row', () => {
    const created = h.store.createPlanFork(makeParams(), h.ctx())
    h.store.transition(created.id, { to: 'SELECTED', selected_at: 1, selected_by: { kind: 'USER' } }, { kind: 'USER' })
    expectCode(() => h.store.transition(created.id, { to: 'DISMISSED', dismissed_at: 2 }, { kind: 'USER' }), 'PF_WRONG_STATE')
    expectCode(() => h.store.transition(created.id, { to: 'STALE', stale_reason: 'x' }, { kind: 'PLUGIN' }), 'PF_WRONG_STATE')
    // 被拒迁移不落账 (账本仍只有 PF_CREATED + PF_SELECTED)
    expect(h.store.listManagementActions()).toHaveLength(2)
  })

  it('transition on a missing id ⇒ PF_NOT_FOUND (无账本 append)', () => {
    expectCode(() => h.store.transition('PF-999', { to: 'STALE', stale_reason: 'x' }, { kind: 'PLUGIN' }), 'PF_NOT_FOUND')
    expect(h.store.listManagementActions()).toHaveLength(0)
  })

  it('rejects a malformed actor (kind 枚举 / run_id 前缀 / label 长度) and negative epochs', () => {
    const created = h.store.createPlanFork(makeParams(), h.ctx())
    expectCode(() => h.store.transition(created.id, { to: 'STALE', stale_reason: 'x' }, { kind: 'GHOST' } as never), 'PF_INPUT')
    expectCode(() => h.store.transition(created.id, { to: 'STALE', stale_reason: 'x' }, { kind: 'AGENT', run_id: 'R-0' }), 'PF_INPUT')
    expectCode(() => h.store.transition(created.id, { to: 'STALE', stale_reason: 'x' }, { kind: 'USER', label: 'x'.repeat(201) }), 'PF_INPUT')
    expectCode(() => h.store.transition(created.id, { to: 'DISMISSED', dismissed_at: -1 }, { kind: 'USER' }), 'PF_INPUT')
  })

  it('乐观门 (WHERE status=?): 过期 from 状态的迁移 ⇒ 0 行, 行不被篡改 (真实 sqlite)', () => {
    // 单进程 SQLite 语义 (WAL 实测): 两个写连接被锁串行化; 持有旧 read
    // 快照的事务无法晋升为写者 (busy timeout), 因此单进程内真正的
    // read→UPDATE 交错由「锁串行化 + 迁移前 re-read (checkPfTransition)」
    // 兜底, 而 `WHERE status = ?` 门是同一不变量在 SQL 层的第二道防线
    // (跨进程/跨宿主仍有效)。此处直接验证门的 0 行语义: 对已变为 STALE
    // 的行执行 from=OPEN 的条件 UPDATE ⇒ 0 行, 行保持竞争写胜出状态。
    const created = h.store.createPlanFork(makeParams(), h.ctx())
    // 竞争写: 经第二连接把行推到 STALE (store 主连接提交后对第二连接可见)
    const winner = h.secondStore()
    winner.transition(created.id, { to: 'STALE', stale_reason: 'winner 先到' }, { kind: 'PLUGIN' })
    // 过期迁移: 以 from=OPEN 执行与 store 相同的门控 UPDATE (autocommit)
    const loser = new DatabaseSync(joinPath(h.dir, 'research.sqlite'))
    loser.exec('PRAGMA busy_timeout = 5000')
    try {
      const gated = loser.prepare(SQL_TRANSITION_PLAN_FORK.DISMISSED)
      const result = gated.run(1, created.id, 'OPEN') // (dismissed_at, id, from=OPEN)
      expect(Number(result.changes)).toBe(0) // 门生效: 0 行
      // 行保持 winner 的状态, 未被过期迁移篡改
      expect(h.store.getPlanFork(created.id)!.status).toBe('STALE')
      expect(h.store.getPlanFork(created.id)!.stale_reason).toBe('winner 先到')
      expect(h.store.getPlanFork(created.id)!.dismissed_at).toBeUndefined()
    } finally {
      loser.close()
    }
    // SQL 常量层面: 三条迁移语句都带状态门 (代码级证明)
    for (const sql of [SQL_TRANSITION_PLAN_FORK.SELECTED, SQL_TRANSITION_PLAN_FORK.DISMISSED, SQL_TRANSITION_PLAN_FORK.STALE]) {
      expect(sql).toContain('WHERE id = ? AND status = ?')
    }
  })
})

describe('countOpen — WP-3.5 flooding 的计数缝 (本 WP 不做 flooding)', () => {
  it('counts only OPEN PFs per workstream', () => {
    const h = openStore()
    const p1 = h.store.createPlanFork(makeParams(), h.ctx())
    const p2 = h.store.createPlanFork(makeParams(), h.ctx())
    expect(h.store.countOpen('WS-1')).toBe(2)
    h.store.transition(p1.id, { to: 'STALE', stale_reason: 's' }, { kind: 'PLUGIN' })
    expect(h.store.countOpen('WS-1')).toBe(1)
    h.store.transition(p2.id, { to: 'SELECTED', selected_at: 1, selected_by: { kind: 'USER' } }, { kind: 'USER' })
    expect(h.store.countOpen('WS-1')).toBe(0)
    expect(h.store.countOpen('WS-2')).toBe(0)
  })
})
