/**
 * WP-3.4 — 原子性与补偿协议（任务目标 4：物化跨「文件写 + DB 状态迁移」
 * 两系统）。
 *
 * 物化顺序（service.ts 设计）：定义文件先写（未列入定义 = 合法部分态,
 * INV-PLAN-9）→ plan.yaml 原子重写（写前留存旧字节）→ 物化后闭包 OID
 * 捕获 → **单 DB 事务**（目标 PF 乐观 UPDATE OPEN→SELECTED + 同 WS 其余
 * OPEN 条件 UPDATE →STALE + PF_SELECTED/逐 PF PF_STALE_MARKED 账本 append）。
 *
 *   - **DB 事务失败**（文件半边已落）⇒ 补偿 = 恢复旧 plan.yaml **精确
 *     字节**（writer 原子回写）+ 大声错误 SELECT_DB_FAILED; PF 保持 OPEN
 *     可重试; 新定义文件保留未列入（INV-PLAN-9 合法部分态; 烧号留 gap —
 *     序号单调不复用, DOMAIN_SCHEMA §1.1 规则 2）; 重试成功且 ID 越过遗留
 *     文件（T-7/M-3/T-8）;
 *   - **plan.yaml 写失败**（文件阶段, plan.yaml 未被触及）⇒ 无需补偿
 *     SELECT_WRITE; 状态与账本零变更;
 *   - **补偿自身失败**（恢复旧字节又失败）⇒ SELECT_COMPENSATION_FAILED
 *     （人工介入 — git restore, INV-GIT-8）; 终态 = 崩溃签名态（crash-
 *     consistency.test.ts 用 audit 面交叉钉死）;
 *   - **并发迁移竞争**（乐观门 0 行 — 服务读取 others 后、事务开始前,
 *     并发写者提交了同 PF 的迁移）⇒ 整事务回滚 + 补偿 + SELECT_CONCURRENT_
 *     STATE（点名竞争 PF + 观察态, 可重试）;
 *   - 每次补偿后 **PF 内容列零变更**（INV-PLAN-4/5 — 物化失败不得改写
 *     base_plan_objects/anchors/proposed）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { ActorRef } from '../../src/host/domain/planfork/index.js'
import { isSelectServiceError } from '../../src/host/service/select/index.js'
import { planYaml } from '../stale/harness.js'
import { assertRejects, createPf, openSelectHarness, type SelectHarness } from './harness.js'

const USER: ActorRef = { kind: 'USER', user_id: 'u-1' }
const WS1_DIR = 'topics/TPC-1/workstreams/WS-1'
const OLD_ORDER = ['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2']

function ledger(h: SelectHarness): Record<string, unknown>[] {
  return h.rawDb.prepare('SELECT * FROM management_action ORDER BY occurred_at ASC, id ASC').all() as Record<string, unknown>[]
}

function historyEventCount(h: SelectHarness): number {
  return Number(h.rawDb.prepare('SELECT COUNT(*) AS n FROM history_event').get()!.n)
}

function planBytes(h: SelectHarness): string {
  return readFileSync(join(h.repo.root, '.research', `${WS1_DIR}/plan.yaml`), 'utf8')
}

function defPath(id: string): string {
  const dir = id.startsWith('G') ? 'gates' : id.startsWith('M') ? 'milestones' : 'tasks'
  return `${WS1_DIR}/items/${dir}/${id}.yaml`
}

describe('DB 事务失败（文件半边已落）⇒ 补偿恢复旧 plan.yaml + PF 保持 OPEN + 可重试', () => {
  it('SELECT_DB_FAILED: 精确字节恢复 + 零 PF_SELECTED 账本 + 遗留定义文件保留未列入 + 重试成功（烧号 gap）', async () => {
    const h = await openSelectHarness({ dbTransactionFailures: 1 })
    try {
      const pf = await createPf(h)
      const before = h.store.getPlanFork(pf.id)!
      const oldPlan = planBytes(h)
      expect(oldPlan).toBe(planYaml(OLD_ORDER))

      await assertRejects(() => h.selectService.select(pf.id, USER), (e) => {
        expect(isSelectServiceError(e)).toBe(true)
        if (!isSelectServiceError(e)) return
        expect(e.code).toBe('SELECT_DB_FAILED')
        expect(e.message).toContain('restored')
      })

      // 补偿: 旧 plan.yaml 精确字节恢复（物化内容不得留存）
      expect(planBytes(h)).toBe(oldPlan)
      // PF 保持 OPEN（DB 半边零变更 — 状态/内容列逐字节不变, INV-PLAN-4/5）
      expect(h.store.getPlanFork(pf.id)!).toEqual(before)
      // 账本零迁移行（事务回滚 — PF_SELECTED 不得出现）
      expect(ledger(h).map((r) => r.action_kind)).toEqual(['PF_CREATED'])
      expect(historyEventCount(h)).toBe(0)
      // 新定义文件保留在盘（未列入 — INV-PLAN-9 合法部分态; 序号已烧）
      for (const id of ['T-5', 'M-2', 'T-6']) {
        expect(existsSync(join(h.repo.root, '.research', defPath(id)))).toBe(true)
      }
      expect(planBytes(h)).not.toContain('T-5')

      // 重试（facade 注入缝已耗竭 — 同服务继续）: 成功, 且 ID 分配越过
      // 遗留文件（最大号 + 1 — §1.1 规则 2 序号单调不复用）
      const outcome = await h.selectService.select(pf.id, USER)
      expect(outcome.newOrder).toEqual(['G-1', 'T-7', 'T-3', 'M-3', 'T-8', 'T-4', 'G-2'])
      expect(outcome.newItems.map((i) => i.id)).toEqual(['T-7', 'M-3', 'T-8'])
      expect(planBytes(h)).toBe(planYaml(['G-1', 'T-7', 'T-3', 'M-3', 'T-8', 'T-4', 'G-2']))
      // 遗留文件仍在盘、仍未列入（INV-PLAN-9 保留）
      for (const id of ['T-5', 'M-2', 'T-6']) {
        expect(existsSync(join(h.repo.root, '.research', defPath(id)))).toBe(true)
      }
      expect(h.store.getPlanFork(pf.id)!.status).toBe('SELECTED')
      const rows = ledger(h)
      expect(rows.map((r) => r.action_kind)).toEqual(['PF_CREATED', 'PF_SELECTED'])
      // PF_SELECTED 账本行 = 物化后新闭包（含 T-7/M-3/T-8, 不含遗留文件）
      const maOids = (JSON.parse(String(rows[1]!.git_blob_oids)) as { path: string }[]).map((o) => o.path)
      expect(maOids).toContain(`${WS1_DIR}/items/tasks/T-7.yaml`)
      expect(maOids).toContain(`${WS1_DIR}/items/milestones/M-3.yaml`)
      expect(maOids).not.toContain(`${WS1_DIR}/items/tasks/T-5.yaml`)
    } finally {
      await h.close()
    }
  })
})

describe('plan.yaml 写失败（文件阶段, plan.yaml 未被触及）⇒ 无需补偿', () => {
  it('SELECT_WRITE: 计划字节零变更 + 定义文件已写（未列入合法态）+ 零 DB 账本 + 重试成功', async () => {
    const h = await openSelectHarness({ planWriteFailures: 1 })
    try {
      const pf = await createPf(h)
      const before = h.store.getPlanFork(pf.id)!
      const oldPlan = planBytes(h)

      await assertRejects(() => h.selectService.select(pf.id, USER), (e) => {
        expect(isSelectServiceError(e)).toBe(true)
        if (!isSelectServiceError(e)) return
        expect(e.code).toBe('SELECT_WRITE')
      })

      // plan.yaml 未被触及（写失败前不落盘 ⇒ 无需补偿, 字节恒等）
      expect(planBytes(h)).toBe(oldPlan)
      // 定义文件先行写（安全部分序）— 未列入合法态
      for (const id of ['T-5', 'M-2', 'T-6']) {
        expect(existsSync(join(h.repo.root, '.research', defPath(id)))).toBe(true)
      }
      // DB 零变更（事务从未开始）
      expect(h.store.getPlanFork(pf.id)!).toEqual(before)
      expect(ledger(h).map((r) => r.action_kind)).toEqual(['PF_CREATED'])

      // 重试成功（写器缝耗竭; 烧号 gap 同前）
      const outcome = await h.selectService.select(pf.id, USER)
      expect(outcome.newOrder).toEqual(['G-1', 'T-7', 'T-3', 'M-3', 'T-8', 'T-4', 'G-2'])
      expect(h.store.getPlanFork(pf.id)!.status).toBe('SELECTED')
    } finally {
      await h.close()
    }
  })
})

describe('补偿自身失败 ⇒ SELECT_COMPENSATION_FAILED（人工介入 — INV-GIT-8）', () => {
  it('DB 失败 + 恢复旧字节失败: 大声错误点名双因; plan.yaml 留存物化内容; PF 保持 OPEN（终态 = 崩溃签名态）', async () => {
    const h = await openSelectHarness({ dbTransactionFailures: 1, failCompensationRestore: true })
    try {
      const pf = await createPf(h)
      const before = h.store.getPlanFork(pf.id)!

      await assertRejects(() => h.selectService.select(pf.id, USER), (e) => {
        expect(isSelectServiceError(e)).toBe(true)
        if (!isSelectServiceError(e)) return
        expect(e.code).toBe('SELECT_COMPENSATION_FAILED')
        // 原错误 + 补偿错误双因点名
        expect(e.message).toContain('COMPENSATION FAILED')
        expect(e.message).toContain('injected SELECTED-transaction failure')
        expect(e.message).toContain('injected plan.yaml RESTORE failure')
      })

      // plan.yaml 留存**物化**内容（恢复失败 — 需人工 git restore, INV-GIT-8）
      expect(planBytes(h)).toBe(planYaml(['G-1', 'T-5', 'T-3', 'M-2', 'T-6', 'T-4', 'G-2']))
      // DB 零变更（事务回滚）; 内容列不变
      expect(h.store.getPlanFork(pf.id)!).toEqual(before)
      expect(ledger(h).map((r) => r.action_kind)).toEqual(['PF_CREATED'])
    } finally {
      await h.close()
    }
  })
})

describe('并发迁移竞争（乐观门 0 行）⇒ 整事务回滚 + 补偿 + SELECT_CONCURRENT_STATE', () => {
  it('连锁 STALE 阶段: 并发写者已将另一 OPEN PF 置 STALE ⇒ 点名竞争 PF 与观察态, 计划恢复, 本 PF 保持 OPEN', async () => {
    const h = await openSelectHarness({
      raceBeforeTransaction: (raw) => {
        // 并发写者（已提交）— 落在服务读取 others 与事务开始之间
        raw.exec(`UPDATE plan_fork SET status = 'STALE', stale_reason = 'concurrent', selected_at = NULL, selected_by = NULL, dismissed_at = NULL WHERE id = '${pfBId!}' AND status = 'OPEN'`)
      },
    })
    let pfBId: string | null = null
    try {
      const pfA = await createPf(h)
      const pfB = await createPf(h, {
        proposedItems: [{ action: 'NEW', kind: 'TASK', spec: { title: 'B 任务', goal: 'g' } }],
        reason: 'rB',
        necessity: 'nB',
      })
      pfBId = pfB.id
      const oldPlan = planBytes(h)

      await assertRejects(() => h.selectService.select(pfA.id, USER), (e) => {
        expect(isSelectServiceError(e)).toBe(true)
        if (!isSelectServiceError(e)) return
        expect(e.code).toBe('SELECT_CONCURRENT_STATE')
        expect(e.message).toContain(pfB.id)
        expect(e.message).toContain('STALE')
        expect(e.message).toContain('rolled back')
      })

      // 补偿: 旧 plan.yaml 恢复; 本 PF 保持 OPEN（可重试）; 账本零 SELECTED
      expect(planBytes(h)).toBe(oldPlan)
      expect(h.store.getPlanFork(pfA.id)!.status).toBe('OPEN')
      expect(h.store.getPlanFork(pfB.id)!.status).toBe('STALE')
      expect(ledger(h).map((r) => r.action_kind)).toEqual(['PF_CREATED', 'PF_CREATED'])
    } finally {
      await h.close()
    }
  })

  it('并发写者将竞争 PF 置 DISMISSED ⇒ 同样回滚 + 补偿（观察态点名 DISMISSED）', async () => {
    const h = await openSelectHarness({
      raceBeforeTransaction: (raw) => {
        raw.exec(`UPDATE plan_fork SET status = 'DISMISSED', dismissed_at = 0, selected_at = NULL, selected_by = NULL, stale_reason = NULL WHERE id = '${pfBId!}' AND status = 'OPEN'`)
      },
    })
    let pfBId: string | null = null
    try {
      const pfA = await createPf(h)
      const pfB = await createPf(h, {
        proposedItems: [{ action: 'NEW', kind: 'TASK', spec: { title: 'B 任务', goal: 'g' } }],
        reason: 'rB',
        necessity: 'nB',
      })
      pfBId = pfB.id
      const oldPlan = planBytes(h)

      await assertRejects(() => h.selectService.select(pfA.id, USER), (e) => {
        expect(isSelectServiceError(e)).toBe(true)
        if (!isSelectServiceError(e)) return
        expect(e.code).toBe('SELECT_CONCURRENT_STATE')
        expect(e.message).toContain('DISMISSED')
      })

      expect(planBytes(h)).toBe(oldPlan)
      expect(h.store.getPlanFork(pfA.id)!.status).toBe('OPEN')
      expect(ledger(h).map((r) => r.action_kind)).toEqual(['PF_CREATED', 'PF_CREATED'])
    } finally {
      await h.close()
    }
  })
})
