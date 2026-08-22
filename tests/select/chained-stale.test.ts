/**
 * WP-3.4 — 同基准连锁失效（PLAN_FORK_SPEC §6.5 原文 + §5 基准失效判定 +
 * §10 状态机「无 STALE→STALE 边」；ARCHITECTURE §5.4 INV-PLAN-7）。
 *
 *   - §6.5 原文：「该 workstream 其余 OPEN PF **一律**置 STALE
 *     （`stale_reason = "superseded by PF-<id> selection"`）— 它们的基准
 *     closure 已不存在」。机械规则 = **同 WS** 其余 OPEN 一律 STALE（§3.1
 *     closure 恒含 plan.yaml，物化必重写 plan.yaml ⇒ 同 WS 任何 OPEN PF
 *     的基准 (path, oid) 集合必然失真 — §5 stale 判定的特例化，无需逐文件
 *     比对）；
 *   - **跨 WS 不受影响**（任务口径「改动文件在/不在其他 PF 闭包」的
 *     「不在」侧）：不同 WS 的 closure 是另一份 plan.yaml + 另一组定义
 *     文件 — 物化改动的文件不在其闭包 ⇒ 保持 OPEN，零迁移、零账本；
 *   - §6.5 的「OPEN PF」限定（任务口径「在」侧的另一半）：已 STALE 的 PF
 *     不再被连锁触碰（§10 无 STALE→STALE 边；stale_reason 冻结于首次
 *     标记，不被第二次 select 的 reason 覆写）；
 *   - §6.6：连锁 STALE 同样只产 ManagementAction(PF_STALE_MARKED)
 *     （actor=PLUGIN）— 零 ResearchHistory 事件；
 *   - INV-PLAN-4：被连锁 STALE 的 PF 内容列（base/anchors/proposed/…）
 *     逐字节不变（只动状态缓存列）。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { ActorRef } from '../../src/host/domain/planfork/index.js'
import { RESEARCH_TREE } from '../stale/harness.js'
import { createPf, openSelectHarness, type SelectHarness } from './harness.js'

const USER: ActorRef = { kind: 'USER', user_id: 'u-1' }

const WS1_DIR = 'topics/TPC-1/workstreams/WS-1'
const WS2_DIR = 'topics/TPC-1/workstreams/WS-2'
const WS2_PLAN_PATH = `${WS2_DIR}/plan.yaml`

/* ------------------------------------------------------------------ *
 * 跨 WS 测试树：WS-2 获得自己的 plan + 2 个 task 定义（独立 closure —
 * 与 WS-1 物化改动的文件集合零交集）
 * ------------------------------------------------------------------ */

const WS2_PLAN_YAML = `workstream: WS-2
ordered_items: [T-9, T-10]
`

const WS2_T9_YAML = `id: T-9
workstream_id: WS-2
title: 独立标定实验 A
goal: 独立标定管线的实验采集 A
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:40:00Z
`

const WS2_T10_YAML = `id: T-10
workstream_id: WS-2
title: 独立标定实验 B
goal: 独立标定管线的实验采集 B
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:41:00Z
`

const WS2_TREE: ReadonlyArray<readonly [string, string]> = [
  ...RESEARCH_TREE,
  [`${WS2_DIR}/plan.yaml`, WS2_PLAN_YAML],
  [`${WS2_DIR}/items/tasks/T-9.yaml`, WS2_T9_YAML],
  [`${WS2_DIR}/items/tasks/T-10.yaml`, WS2_T10_YAML],
]

function ledger(h: SelectHarness): Record<string, unknown>[] {
  return h.rawDb.prepare('SELECT * FROM management_action ORDER BY occurred_at ASC, id ASC').all() as Record<string, unknown>[]
}

function historyEventCount(h: SelectHarness): number {
  return Number(h.rawDb.prepare('SELECT COUNT(*) AS n FROM history_event').get()!.n)
}

function ws2PlanBytes(h: SelectHarness): string {
  return readFileSync(join(h.repo.root, '.research', WS2_PLAN_PATH), 'utf8')
}

/** 一个 WS-2 的 OPEN PF（R-92 = WS-2 的 formal run — 测试扩种 runLookup）。 */
async function createWs2Pf(h: SelectHarness) {
  h.runLookup.runs.set('R-92', { id: 'R-92', workstream_id: 'WS-2', task_id: 'T-9' })
  return createPf(h, {
    workstreamId: 'WS-2',
    forkAnchor: 'T-9',
    mergeAnchor: 'T-10',
    proposedItems: [{ action: 'NEW', kind: 'TASK', spec: { title: '独立实验 C', goal: '独立标定管线的补充实验' } }],
    reason: '独立标定管线需要补充实验',
    necessity: '缺少则该管线误差不可评估',
    createdByRun: 'R-92',
  })
}

describe('§6.5 同基准连锁失效 — 同 WS 其余 OPEN PF 一律 STALE（改动文件在其闭包）', () => {
  it('两 OPEN PF 共享闭包: SELECT 一个 ⇒ 另一个 STALE（reason 原文逐字）+ PF_STALE_MARKED 账本 + 内容列不变', async () => {
    const h = await openSelectHarness()
    try {
      const pfA = await createPf(h)
      const pfB = await createPf(h, {
        proposedItems: [{ action: 'NEW', kind: 'TASK', spec: { title: 'B 提议任务', goal: 'g' } }],
        reason: 'B 的理由',
        necessity: 'B 的必要性',
      })
      expect(pfA.id).not.toBe(pfB.id)
      // 同一创建时刻闭包（两 PF 的 base 集合相等 — §5 判定前提）
      expect(pfB.base_plan_objects).toEqual(pfA.base_plan_objects)
      const bBefore = h.store.getPlanFork(pfB.id)!

      const outcome = await h.selectService.select(pfA.id, USER)

      // §6.5 原文: stale_reason = "superseded by PF-<id> selection"（逐字）
      expect(outcome.staleOthers).toEqual([
        { pfId: pfB.id, stale_reason: `superseded by ${pfA.id} selection` },
      ])
      const bAfter = h.store.getPlanFork(pfB.id)!
      expect(bAfter.status).toBe('STALE')
      expect(bAfter.stale_reason).toBe(`superseded by ${pfA.id} selection`)
      expect(bAfter.selected_at).toBeUndefined()
      expect(bAfter.selected_by).toBeUndefined()
      expect(bAfter.dismissed_at).toBeUndefined()
      // INV-PLAN-4: 内容列逐字节不变（只动状态缓存列）
      expect(bAfter.base_plan_objects).toEqual(bBefore.base_plan_objects)
      expect(bAfter.base_git_commit).toBe(bBefore.base_git_commit)
      expect(bAfter.fork_anchor).toBe(bBefore.fork_anchor)
      expect(bAfter.merge_anchor).toBe(bBefore.merge_anchor)
      expect(bAfter.proposed_items).toEqual(bBefore.proposed_items)
      expect(bAfter.trigger_refs).toEqual(bBefore.trigger_refs)
      expect(bAfter.reason).toBe(bBefore.reason)
      expect(bAfter.necessity).toBe(bBefore.necessity)
      expect(bAfter.created_by_run).toBe(bBefore.created_by_run)
      expect(bAfter.created_at).toBe(bBefore.created_at)

      // §6.6: 账本 = PF_CREATED×2 + PF_SELECTED + PF_STALE_MARKED（同 occurred_at ⇒ MA id 序）
      const rows = ledger(h)
      expect(rows.map((r) => r.action_kind)).toEqual(['PF_CREATED', 'PF_CREATED', 'PF_SELECTED', 'PF_STALE_MARKED'])
      const staleRow = rows[3]!
      expect(JSON.parse(String(staleRow.actor))).toEqual({ kind: 'PLUGIN' })
      expect(JSON.parse(String(staleRow.subject_refs))).toEqual([{ kind: 'PLAN_FORK', id: pfB.id }])
      expect(String(staleRow.detail)).toContain(pfB.id)
      expect(String(staleRow.detail)).toContain(`superseded by ${pfA.id} selection`)

      // §6.6: 连锁 STALE 同样不写 ResearchHistory
      expect(historyEventCount(h)).toBe(0)

      // 被连锁 STALE 的 PF 不能再被 SELECT（§6 前置 status == OPEN）
      await expect(h.selectService.select(pfB.id, USER)).rejects.toMatchObject({ code: 'PF_WRONG_STATE' })
    } finally {
      await h.close()
    }
  })

  it('三个 OPEN PF: 其余两个各置 STALE、各一行 PF_STALE_MARKED、stable 顺序（created_at ASC, id ASC）', async () => {
    const h = await openSelectHarness()
    try {
      const pfA = await createPf(h)
      const pfB = await createPf(h, {
        proposedItems: [{ action: 'NEW', kind: 'TASK', spec: { title: 'B 任务', goal: 'g' } }],
        reason: 'rB',
        necessity: 'nB',
      })
      const pfC = await createPf(h, {
        proposedItems: [{ action: 'NEW', kind: 'GATE', spec: { title: 'C 评审', criteria: 'c' } }],
        reason: 'rC',
        necessity: 'nC',
      })

      const outcome = await h.selectService.select(pfA.id, USER)

      expect(outcome.staleOthers.map((o) => o.pfId)).toEqual([pfB.id, pfC.id])
      expect(outcome.staleOthers.every((o) => o.stale_reason === `superseded by ${pfA.id} selection`)).toBe(true)
      for (const id of [pfB.id, pfC.id]) {
        const r = h.store.getPlanFork(id)!
        expect(r.status).toBe('STALE')
        expect(r.stale_reason).toBe(`superseded by ${pfA.id} selection`)
      }
      const rows = ledger(h)
      expect(rows.map((r) => r.action_kind)).toEqual([
        'PF_CREATED', 'PF_CREATED', 'PF_CREATED', 'PF_SELECTED', 'PF_STALE_MARKED', 'PF_STALE_MARKED',
      ])
      const staleRows = rows.slice(4)
      expect(staleRows.map((r) => (JSON.parse(String(r.subject_refs)) as { id: string }[])[0]!.id)).toEqual([pfB.id, pfC.id])
      // 各自独立 MA id（逐 PF 一行，非合并行）
      const maIds = staleRows.map((r) => String(r.id))
      expect(new Set(maIds).size).toBe(2)
      expect(historyEventCount(h)).toBe(0)
    } finally {
      await h.close()
    }
  })
})

describe('§6.5 连锁范围 — 跨 WS 不受影响（改动文件不在其闭包）', () => {
  it('WS-2 的 OPEN PF（独立 closure）在 WS-1 物化后保持 OPEN: 零迁移、零账本、文件零变更', async () => {
    const h = await openSelectHarness({ tree: WS2_TREE })
    try {
      const pfWs1 = await createPf(h)
      const pfWs2 = await createWs2Pf(h)
      expect(pfWs2.workstream_id).toBe('WS-2')
      expect(pfWs2.status).toBe('OPEN')
      // 闭包零交集（机械前提: 不同 plan.yaml ⇒ §5 判定必不相等 ⇒ 不失真）
      const ws2Paths = new Set(pfWs2.base_plan_objects.map((o) => o.path))
      for (const o of pfWs1.base_plan_objects) {
        expect(ws2Paths.has(o.path)).toBe(false)
      }
      expect(ws2PlanBytes(h)).toBe(WS2_PLAN_YAML)

      const outcome = await h.selectService.select(pfWs1.id, USER)

      // 连锁面只含同 WS — WS-2 的 PF 不在内
      expect(outcome.staleOthers).toEqual([])
      const w2 = h.store.getPlanFork(pfWs2.id)!
      expect(w2.status).toBe('OPEN')
      expect(w2.stale_reason).toBeUndefined()
      // 零 PF_STALE_MARKED 账本（WS-1 无其余 OPEN PF）
      expect(ledger(h).map((r) => r.action_kind)).toEqual(['PF_CREATED', 'PF_CREATED', 'PF_SELECTED'])
      // WS-2 的 closure 文件零变更（物化改动文件不在其闭包）
      expect(ws2PlanBytes(h)).toBe(WS2_PLAN_YAML)
      expect(readFileSync(join(h.repo.root, '.research', `${WS2_DIR}/items/tasks/T-9.yaml`), 'utf8')).toBe(WS2_T9_YAML)
      expect(readFileSync(join(h.repo.root, '.research', `${WS2_DIR}/items/tasks/T-10.yaml`), 'utf8')).toBe(WS2_T10_YAML)
      // 且其后续 SELECT 可正常完成（基准未失真 — 可证伪「过度连锁」）
      const w2Outcome = await h.selectService.select(pfWs2.id, USER)
      expect(w2Outcome.newOrder).toEqual(['T-9', 'T-11', 'T-10'])
      expect(h.store.getPlanFork(pfWs2.id)!.status).toBe('SELECTED')
    } finally {
      await h.close()
    }
  })
})

describe('§6.5 的「OPEN PF」限定 + §10 无 STALE→STALE 边', () => {
  it('已 STALE 的 PF 不被第二次 select 连锁触碰: 状态与 stale_reason 冻结、零重复账本行', async () => {
    const h = await openSelectHarness()
    try {
      const pfA = await createPf(h)
      const pfC = await createPf(h, {
        proposedItems: [{ action: 'NEW', kind: 'TASK', spec: { title: 'C 任务', goal: 'g' } }],
        reason: 'rC',
        necessity: 'nC',
      })
      const firstReason = `superseded by ${pfA.id} selection`
      await h.selectService.select(pfA.id, USER)
      expect(h.store.getPlanFork(pfC.id)!.status).toBe('STALE')
      expect(h.store.getPlanFork(pfC.id)!.stale_reason).toBe(firstReason)

      // 物化后的新基准上再开一个 PF（此时 WS-1 的 OPEN PF 只剩 pfD）
      const pfD = await createPf(h, {
        proposedItems: [{ action: 'NEW', kind: 'TASK', spec: { title: 'D 任务', goal: 'g' } }],
        reason: 'rD',
        necessity: 'nD',
      })
      expect(pfD.status).toBe('OPEN')

      const outcome = await h.selectService.select(pfD.id, USER)

      // 连锁面 = 空（pfC 已非 OPEN — 不再触碰）
      expect(outcome.staleOthers).toEqual([])
      const c = h.store.getPlanFork(pfC.id)!
      expect(c.status).toBe('STALE')
      expect(c.stale_reason).toBe(firstReason) // 冻结 — 未被第二次 reason 覆写（§10 无 STALE→STALE 边）
      // 账本: pfC 的 PF_STALE_MARKED 恰好一行（第一次 select 所标），第二次 select 零 STALE 行
      const rows = ledger(h)
      const cStaleRows = rows.filter(
        (r) => r.action_kind === 'PF_STALE_MARKED' &&
          (JSON.parse(String(r.subject_refs)) as { id: string }[])[0]!.id === pfC.id,
      )
      expect(cStaleRows).toHaveLength(1)
      expect(rows.map((r) => r.action_kind)).toEqual([
        'PF_CREATED', 'PF_CREATED', 'PF_SELECTED', 'PF_STALE_MARKED', 'PF_CREATED', 'PF_SELECTED',
      ])
      expect(historyEventCount(h)).toBe(0)
    } finally {
      await h.close()
    }
  })
})
