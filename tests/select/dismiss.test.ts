/**
 * WP-3.4 — DISMISS（PLAN_FORK_SPEC §7 原文 + §10 状态机 + INV-PERM-2）。
 *
 *   - §7 原文：「允许对 OPEN 或 STALE 的 PF 执行；`status -> DISMISSED`
 *     + `ManagementAction(PF_DISMISSED)`；**只改状态，不删除记录**
 *     （append-only）」；
 *   - §10 状态机：DISMISSED 为终态（OPEN→DISMISSED、STALE→DISMISSED 合法;
 *     SELECTED→DISMISSED、DISMISSED→DISMISSED 拒绝 — PF_WRONG_STATE 点名
 *     当前态 + 合法集）;
 *   - INV-PERM-2: DISMISS 是用户操作（Agent ❌ — 权限表）: AGENT/SYSTEM
 *     actor ⇒ SELECT_ACTOR_NOT_USER，零状态变更、零账本；
 *   - §6.6 口径: DISMISS 不产 ResearchHistory（只产 management_action 行）;
 *   - 存储层兜底: PF 行永不删除（no-delete trigger — 任何连接）: DISMISS
 *     后记录完整可读（内容列逐字节不变 — 只改状态缓存列）。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { isPlanForkError, type ActorRef, type PlanForkRecord } from '../../src/host/domain/planfork/index.js'
import { isSelectServiceError } from '../../src/host/service/select/index.js'
import { planYaml, itemPath } from '../stale/harness.js'
import { assertRejects, createPf, openSelectHarness, type SelectHarness } from './harness.js'

const USER: ActorRef = { kind: 'USER', user_id: 'u-1' }
const AGENT: ActorRef = { kind: 'AGENT', run_id: 'R-81' }
const WS1_DIR = 'topics/TPC-1/workstreams/WS-1'

function ledger(h: SelectHarness): Record<string, unknown>[] {
  return h.rawDb.prepare('SELECT * FROM management_action ORDER BY occurred_at ASC, id ASC').all() as Record<string, unknown>[]
}

function historyEventCount(h: SelectHarness): number {
  return Number(h.rawDb.prepare('SELECT COUNT(*) AS n FROM history_event').get()!.n)
}

function planBytes(h: SelectHarness): string {
  return readFileSync(join(h.repo.root, '.research', 'topics/TPC-1/workstreams/WS-1/plan.yaml'), 'utf8')
}

function contentSnapshot(r: PlanForkRecord): Record<string, unknown> {
  return {
    base_plan_objects: r.base_plan_objects,
    base_git_commit: r.base_git_commit,
    fork_anchor: r.fork_anchor,
    merge_anchor: r.merge_anchor,
    proposed_items: r.proposed_items,
    trigger_refs: r.trigger_refs,
    reason: r.reason,
    necessity: r.necessity,
    created_by_run: r.created_by_run,
    created_at: r.created_at,
  }
}

describe('§7 DISMISS — OPEN → DISMISSED（用户操作）', () => {
  it('状态迁移 + PF_DISMISSED 账本（actor=USER）+ 只改状态不删除 + 零 History + 计划零变更', async () => {
    const h = await openSelectHarness()
    try {
      const pf = await createPf(h)
      const before = h.store.getPlanFork(pf.id)!
      const oldPlan = planBytes(h)

      const outcome = h.selectService.dismiss(pf.id, USER)

      // outcome 结构（§7 来源态 OPEN）
      expect(outcome).toEqual({
        pfId: pf.id,
        workstreamId: 'WS-1',
        statusBefore: 'OPEN',
        statusAfter: 'DISMISSED',
        dismissedAt: outcome.dismissedAt,
        dismissedBy: USER,
      })
      expect(Number.isSafeInteger(outcome.dismissedAt)).toBe(true)

      // 存储态: DISMISSED（终态）+ dismissed_at/dismissed_by
      const after = h.store.getPlanFork(pf.id)!
      expect(after.status).toBe('DISMISSED')
      expect(after.dismissed_at).toBe(outcome.dismissedAt)
      expect(after.selected_at).toBeUndefined()
      expect(after.selected_by).toBeUndefined()
      expect(after.stale_reason).toBeUndefined()

      // §7「只改状态，不删除记录」: 行仍在、内容列逐字节不变（append-only;
      // 存储层 no-delete trigger 兜底任何连接）
      expect(after).not.toBeNull()
      expect(contentSnapshot(after)).toEqual(contentSnapshot(before))

      // 账本: PF_CREATED + PF_DISMISSED（actor=USER — 用户操作）
      const rows = ledger(h)
      expect(rows.map((r) => r.action_kind)).toEqual(['PF_CREATED', 'PF_DISMISSED'])
      const ma = rows[1]!
      expect(JSON.parse(String(ma.actor))).toEqual(USER)
      expect(JSON.parse(String(ma.subject_refs))).toEqual([{ kind: 'PLAN_FORK', id: pf.id }])

      // §6.6 口径: 不写 ResearchHistory（catalog 无 PLAN_FORK_* 事件）
      expect(historyEventCount(h)).toBe(0)

      // 计划零变更（DISMISS 不触碰 canonical plan）
      expect(planBytes(h)).toBe(oldPlan)
      expect(planBytes(h)).toBe(planYaml(['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2']))

      // §10 终态: 对 DISMISSED 的 PF 再 DISMISS / SELECT 均拒绝
      await assertRejects(() => Promise.resolve(h.selectService.dismiss(pf.id, USER)), (e) => {
        expect(isPlanForkError(e)).toBe(true)
        if (isPlanForkError(e)) {
          expect(e.code).toBe('PF_WRONG_STATE')
          expect(e.message).toContain('DISMISSED')
        }
      })
      await assertRejects(() => h.selectService.select(pf.id, USER), (e) => {
        expect(isPlanForkError(e)).toBe(true)
        if (isPlanForkError(e)) expect(e.code).toBe('PF_WRONG_STATE')
      })
    } finally {
      await h.close()
    }
  })

  it('DISMISSED 的 PF 可被后续 SELECT 之外的操作审计: 不再出现在 OPEN 扫面（连锁/复查面零触碰）', async () => {
    const h = await openSelectHarness()
    try {
      const pfA = await createPf(h)
      const pfB = await createPf(h, {
        proposedItems: [{ action: 'NEW', kind: 'TASK', spec: { title: 'B 任务', goal: 'g' } }],
        reason: 'rB',
        necessity: 'nB',
      })
      h.selectService.dismiss(pfB.id, USER)

      // §6.5 连锁面只含 OPEN — DISMISSED 的 pfB 不被触碰（零迁移、零账本）
      const bAfterSelect = h.store.getPlanFork(pfB.id)!
      await h.selectService.select(pfA.id, USER)
      const b = h.store.getPlanFork(pfB.id)!
      expect(b.status).toBe('DISMISSED')
      expect(b.stale_reason).toBeUndefined()
      expect(b.dismissed_at).toBe(bAfterSelect.dismissed_at)
      const rows = ledger(h)
      const bRows = rows.filter(
        (r) => (JSON.parse(String(r.subject_refs)) as { id: string }[])[0]!.id === pfB.id,
      )
      // pfB 的账本行: PF_CREATED + PF_DISMISSED（无 PF_STALE_MARKED）
      expect(bRows.map((r) => r.action_kind)).toEqual(['PF_CREATED', 'PF_DISMISSED'])
    } finally {
      await h.close()
    }
  })
})

describe('§7 DISMISS — STALE → DISMISSED（§7 允许来源态之二）', () => {
  it('STALE 的 PF 可 DISMISSED: 状态迁移 + 账本 + stale_reason 列被状态列替换（§10 字段共现）', async () => {
    const h = await openSelectHarness()
    try {
      const pf = await createPf(h)
      // 用户手改 T-2 goal（§11 步骤 4 场景）⇒ 基准失真（repo 相对路径含 .research/）
      const t2Path = itemPath('T-2')
      const t2 = await h.repo.read(t2Path)
      await h.repo.write(t2Path, t2.replace('goal: ', 'goal: [用户手改] '))
      const outcome = await h.staleService.checkStale(pf.id)
      expect(outcome.markedStale).toBe(true)
      expect(h.store.getPlanFork(pf.id)!.status).toBe('STALE')

      const dismissed = h.selectService.dismiss(pf.id, USER)
      expect(dismissed.statusBefore).toBe('STALE')
      expect(dismissed.statusAfter).toBe('DISMISSED')

      const after = h.store.getPlanFork(pf.id)!
      expect(after.status).toBe('DISMISSED')
      expect(after.dismissed_at).toBe(dismissed.dismissedAt)
      // SQL_TRANSITION_PLAN_FORK.DISMISSED 将 stale_reason 置 NULL（§10 字段
      // 共现: DISMISSED 行只携带 dismissed_*）— 原 reason 存于 PF_STALE_MARKED
      // 账本行（append-only 审计链不丢信息）
      expect(after.stale_reason).toBeUndefined()
      const rows = ledger(h)
      expect(rows.map((r) => r.action_kind)).toEqual(['PF_CREATED', 'PF_STALE_MARKED', 'PF_DISMISSED'])
      expect(JSON.parse(String(rows[2]!.actor))).toEqual(USER)
      // 审计链: PF_STALE_MARKED 行保留原始 §5 reason
      expect(String(rows[1]!.detail)).toContain('T-2.yaml')
      expect(historyEventCount(h)).toBe(0)
    } finally {
      await h.close()
    }
  })
})

describe('§7 前置状态门 — SELECTED / DISMISSED 来源态拒绝（§10 终态）', () => {
  it('SELECTED ⇒ PF_WRONG_STATE（点名当前态 + 合法集）', async () => {
    const h = await openSelectHarness()
    try {
      const pf = await createPf(h)
      await h.selectService.select(pf.id, USER)
      await assertRejects(() => Promise.resolve(h.selectService.dismiss(pf.id, USER)), (e) => {
        expect(isPlanForkError(e)).toBe(true)
        if (isPlanForkError(e)) {
          expect(e.code).toBe('PF_WRONG_STATE')
          expect(e.message).toContain('SELECTED')
        }
      })
      // 状态不变（拒绝 = 零迁移、零账本增量）
      expect(h.store.getPlanFork(pf.id)!.status).toBe('SELECTED')
      expect(ledger(h).map((r) => r.action_kind)).toEqual(['PF_CREATED', 'PF_SELECTED'])
    } finally {
      await h.close()
    }
  })
})

describe('INV-PERM-2 — DISMISS 无 Agent 面', () => {
  it('AGENT / SYSTEM actor ⇒ SELECT_ACTOR_NOT_USER, 零状态变更、零账本', async () => {
    const h = await openSelectHarness()
    try {
      const pf = await createPf(h)
      const before = h.store.getPlanFork(pf.id)!

      await assertRejects(() => Promise.resolve(h.selectService.dismiss(pf.id, AGENT)), (e) => {
        expect(isSelectServiceError(e)).toBe(true)
        if (isSelectServiceError(e)) {
          expect(e.code).toBe('SELECT_ACTOR_NOT_USER')
          expect(e.message).toContain('INV-PERM-2')
        }
      })
      await assertRejects(() => Promise.resolve(h.selectService.dismiss(pf.id, { kind: 'SYSTEM' })), (e) => {
        expect(isSelectServiceError(e) && e.code === 'SELECT_ACTOR_NOT_USER').toBe(true)
      })

      // 零状态变更、零账本（拒绝发生在任何迁移之前）
      expect(h.store.getPlanFork(pf.id)!).toEqual(before)
      expect(ledger(h).map((r) => r.action_kind)).toEqual(['PF_CREATED'])
      expect(historyEventCount(h)).toBe(0)
    } finally {
      await h.close()
    }
  })
})

describe('DISMISS — 输入边界', () => {
  it('PF_NOT_FOUND: 不存在的 id ⇒ 领域错误原样穿透（零账本）', async () => {
    const h = await openSelectHarness()
    try {
      await assertRejects(() => Promise.resolve(h.selectService.dismiss('PF-99', USER)), (e) => {
        expect(isPlanForkError(e)).toBe(true)
        if (isPlanForkError(e)) expect(e.code).toBe('PF_NOT_FOUND')
      })
      // 本测试未创建任何 PF — 零账本行（拒绝在一切持久化之前）
      expect(ledger(h)).toEqual([])
    } finally {
      await h.close()
    }
  })

  it('空 pfId ⇒ SELECT_INPUT（服务边界输入守卫）', async () => {
    const h = await openSelectHarness()
    try {
      await assertRejects(() => Promise.resolve(h.selectService.dismiss('', USER)), (e) => {
        expect(isSelectServiceError(e)).toBe(true)
        if (isSelectServiceError(e)) expect(e.code).toBe('SELECT_INPUT')
      })
    } finally {
      await h.close()
    }
  })
})
