/**
 * WP-3.4 — SELECT 物化全流程（真实临时仓 + 真实 sqlite + 真实 git W3）。
 *
 *   - §11 端到端示例完整跑通（必用）: 创建 PF（真实 git base 捕获）→
 *     SELECT ⇒ 新 items T-5/M-2/T-6 正式 ID + 定义文件原子写入
 *     （created_by = { kind: AGENT, run_id: R-81 } — §6.2 原文）→
 *     plan.yaml 重写为 G-1,T-5,T-3,M-2,T-6,T-4,G-2（§11 步骤 6 原文逐字）→
 *     PF=SELECTED（selected_at/selected_by）→ ManagementAction(PF_SELECTED)
 *     含新 plan.yaml 与各定义文件的 blob OID（§6.6 原文 — 独立
 *     `capturePlanClosure` 复核, 与账本行逐一相等）→ **零 ResearchHistory
 *     事件**（§6.6 边界 — history_event 表直查）→ 被替换旧 items 定义文件
 *     保留（INV-PLAN-9）;
 *   - §6.1 复核基准不一致: 用户改 T-2 的 goal（真实文件重写）⇒ 自动
 *     STALE（stale_reason = §5 首个差异三元组, actor=PLUGIN）+ 拒绝 +
 *     差异说明（结构化 diff）;
 *   - 前置 `PF.status == OPEN`: SELECTED/DISMISSED/STALE 来源态均拒绝
 *     （PF_WRONG_STATE — 点名当前态 + 合法集）;
 *   - INV-PERM-2: AGENT actor ⇒ SELECT_ACTOR_NOT_USER, 零状态变更;
 *   - PF_NOT_FOUND;
 *   - INV-PLAN-4/5: 物化后 PF 内容列（base_plan_objects/anchors/proposed）
 *     逐字节不变。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  PlanForkError,
  isPlanForkError,
  type ActorRef,
  type PlanForkRecord,
} from '../../src/host/domain/planfork/index.js'
import { PlanStore } from '../../src/host/domain/plan/index.js'
import { FsResearchReader } from '../../src/host/service/checkpoint/fs-reader.js'
import { isSelectServiceError } from '../../src/host/service/select/index.js'
import { WR_SCHEMA_DIR } from '../loader/fixtures.js'
import { PLAN_PATH, itemPath, planYaml } from '../stale/harness.js'
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
  return readFileSync(join(h.repo.root, '.research', WS1_DIR, 'plan.yaml'), 'utf8')
}

/** 真实 FS 上的 WS-1 PlanStore（测试侧读写 — 与服务同一 kernel）。 */
function ws1Store(h: SelectHarness): PlanStore {
  return new PlanStore({
    reader: new FsResearchReader(join(h.repo.root, '.research')),
    writer: { writeAtomic(): void { throw new Error('test-side store is read-only') } },
    researchRoot: join(h.repo.root, '.research'),
    schemaDir: WR_SCHEMA_DIR,
    topicId: 'TPC-1',
    wsId: 'WS-1',
  })
}

describe('SELECT 物化全流程（§11 端到端示例 — 必用）', () => {
  it('G-1,T-5,T-3,M-2,T-6,T-4,G-2 — 全步断言（文件 + DB + 账本 + 零 History）', async () => {
    const h = await openSelectHarness()
    try {
      const pf = await createPf(h) // §11 默认: fork G-1 / merge G-2 / F-31 / R-81
      expect(pf.status).toBe('OPEN')

      const before = h.store.getPlanFork(pf.id)! // INV-PLAN-4/5 内容列基线
      const outcome = await h.selectService.select(pf.id, USER)

      // ---- §11 步骤 6 原文: plan.yaml 重写为 G-1,T-5,T-3,M-2,T-6,T-4,G-2 ----
      expect(outcome.newOrder).toEqual(['G-1', 'T-5', 'T-3', 'M-2', 'T-6', 'T-4', 'G-2'])
      expect(planBytes(h)).toBe(planYaml(['G-1', 'T-5', 'T-3', 'M-2', 'T-6', 'T-4', 'G-2']))
      expect(outcome.oldOrder).toEqual(['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'])
      expect(outcome.removedIds).toEqual(['T-1', 'T-2', 'M-1'])
      expect(outcome.staleOthers).toEqual([])
      expect(outcome.planYamlPath).toBe(`${WS1_DIR}/plan.yaml`)

      // ---- §6.2: 新 items 正式 ID + 定义文件（created_by = AGENT/R-81 原文）----
      expect(outcome.newItems.map((i) => i.id)).toEqual(['T-5', 'M-2', 'T-6'])
      expect(outcome.newItems.map((i) => i.kind)).toEqual(['TASK', 'MILESTONE', 'TASK'])
      const pstore = ws1Store(h)
      const t5 = pstore.readItem('task', 'T-5')
      expect(t5.title).toBe('复算误差预算')
      expect(t5.goal).toBe('重新推导误差预算并给出复算脚本')
      expect(t5.created_by).toEqual({ kind: 'AGENT', run_id: 'R-81' })
      expect(t5.workstream_id).toBe('WS-1')
      // spec 未给的可选数组字段: 值原样通过（title/goal 逐字）, absent 字段
      // 在冻结内核边界（WP-1.1 ajv useDefaults — §14.1 工程默认在 loader
      // 边界 materialize）落为 schema 默认 []；读回 doc 同形
      const t5Bytes = readFileSync(join(h.repo.root, itemPath('T-5')), 'utf8')
      expect(t5Bytes).toContain('deliverables: []')
      expect(t5Bytes).toContain('acceptance_criteria: []')
      expect((t5 as unknown as Record<string, unknown>).deliverables).toEqual([])
      expect((t5 as unknown as Record<string, unknown>).acceptance_criteria).toEqual([])
      const m2 = pstore.readItem('milestone', 'M-2')
      expect(m2.title).toBe('标定方案定稿')
      expect(m2.statement).toBe('误差预算复算通过且标定方案冻结')
      expect(m2.created_by).toEqual({ kind: 'AGENT', run_id: 'R-81' })
      const t6 = pstore.readItem('task', 'T-6')
      expect(t6.title).toBe('补充实验')
      expect(t6.created_by).toEqual({ kind: 'AGENT', run_id: 'R-81' })
      expect(Number.isSafeInteger(t5.created_at)).toBe(true)
      expect(outcome.newItems[0]!.path).toBe(`${WS1_DIR}/items/tasks/T-5.yaml`)

      // ---- §11 步骤 6: PF-18=SELECTED（selected_at/selected_by）----
      expect(outcome.statusAfter).toBe('SELECTED')
      expect(outcome.selectedBy).toEqual(USER)
      const selected = h.store.getPlanFork(pf.id)!
      expect(selected.status).toBe('SELECTED')
      expect(selected.selected_at).toBe(outcome.selectedAt)
      expect(selected.selected_by).toEqual({ kind: 'USER', user_id: 'u-1' })
      expect(selected.dismissed_at).toBeUndefined()
      expect(selected.stale_reason).toBeUndefined()

      // ---- §6.6: ManagementAction(PF_SELECTED) 含新 plan.yaml 与各定义文件的 blob OID ----
      const rows = ledger(h)
      const kinds = rows.map((r) => r.action_kind)
      expect(kinds).toEqual(['PF_CREATED', 'PF_SELECTED'])
      const ma = rows[1]!
      expect(ma.id).toMatch(/^MA-\d+$/)
      const maActor = JSON.parse(String(ma.actor)) as ActorRef
      expect(maActor).toEqual(USER)
      const maSubjects = JSON.parse(String(ma.subject_refs)) as { kind: string; id: string }[]
      expect(maSubjects).toEqual([{ kind: 'PLAN_FORK', id: pf.id }])
      const maOids = JSON.parse(String(ma.git_blob_oids)) as { path: string; oid: string }[]
      // 新 closure = plan.yaml + 7 个新 listed 定义文件（§3.1 闭包, 稳定顺序）
      expect(maOids.map((o) => o.path)).toEqual([
        `${WS1_DIR}/plan.yaml`,
        `${WS1_DIR}/items/gates/G-1.yaml`,
        `${WS1_DIR}/items/tasks/T-5.yaml`,
        `${WS1_DIR}/items/tasks/T-3.yaml`,
        `${WS1_DIR}/items/milestones/M-2.yaml`,
        `${WS1_DIR}/items/tasks/T-6.yaml`,
        `${WS1_DIR}/items/tasks/T-4.yaml`,
        `${WS1_DIR}/items/gates/G-2.yaml`,
      ])
      // 与独立真实 git 捕获逐一相等（W3 working-copy blob OID）
      const captured = await h.staleService.capturePlanClosure('WS-1')
      expect(captured.objects.map((o) => ({ path: o.path, oid: o.git_blob_oid }))).toEqual(
        maOids.map((o) => ({ path: o.path, oid: o.oid })),
      )
      expect(outcome.newClosure).toEqual(captured.objects)
      expect(String(ma.detail)).toContain(`plan fork ${pf.id} selected for WS-1`)
      expect(String(ma.detail)).toContain('T-5, M-2, T-6')
      expect(String(ma.detail)).toContain('INV-PLAN-9')

      // ---- §6.6: 不写 ResearchHistory（catalog 无 PLAN_FORK_* 事件）----
      expect(historyEventCount(h)).toBe(0)

      // ---- §6.8: 被替换旧 items 定义文件保留（INV-PLAN-9）----
      for (const id of ['T-1', 'T-2', 'M-1']) {
        expect(readFileSync(join(h.repo.root, itemPath(id)), 'utf8').length).toBeGreaterThan(0)
      }
      // 且不再列入 plan.yaml
      expect(planBytes(h)).not.toContain('T-1')
      expect(planBytes(h)).not.toContain('T-2')
      expect(planBytes(h)).not.toContain('M-1')

      // ---- §6.7: checkpoint 提示（显式、可选、绝不自动 — INV-GIT-2）----
      expect(outcome.checkpointHint).toContain('NEVER automatic')

      // ---- INV-PLAN-4/5: PF 内容列逐字节不变（append-only + base 精确集合）----
      const after = h.store.getPlanFork(pf.id)!
      expect(after.base_plan_objects).toEqual(before.base_plan_objects)
      expect(after.base_git_commit).toBe(before.base_git_commit)
      expect(after.fork_anchor).toBe(before.fork_anchor)
      expect(after.merge_anchor).toBe(before.merge_anchor)
      expect(after.proposed_items).toEqual(before.proposed_items)
      expect(after.trigger_refs).toEqual(before.trigger_refs)
      expect(after.reason).toBe(before.reason)
      expect(after.necessity).toBe(before.necessity)
      expect(after.created_by_run).toBe(before.created_by_run)
      expect(after.created_at).toBe(before.created_at)
    } finally {
      await h.close()
    }
  })

  it('§6.1 复核基准不一致: 用户改 T-2 goal ⇒ 自动 STALE + 拒绝 + 结构化 diff', async () => {
    const h = await openSelectHarness()
    try {
      const pf = await createPf(h)
      const oldPlan = planBytes(h)
      const oldBase = h.store.getPlanFork(pf.id)!.base_plan_objects

      // 用户手动修改 T-2 的 goal（真实文件重写 — §11 步骤 4 原文场景）
      const t2Path = itemPath('T-2')
      const t2 = await h.repo.read(t2Path)
      await h.repo.write(t2Path, t2.replace('goal: ', 'goal: [用户手改] '))

      await assertRejects(() => h.selectService.select(pf.id, USER), (e) => {
        expect(isSelectServiceError(e)).toBe(true)
        if (!isSelectServiceError(e)) return
        expect(e.code).toBe('SELECT_REFUSED_STALE')
        expect(e.diff!.length).toBeGreaterThan(0)
        const first = e.diff![0]!
        expect(first.path.endsWith(`${WS1_DIR}/items/tasks/T-2.yaml`)).toBe(true)
        expect(first.kind).toBe('oid_changed')
      })

      // 自动 STALE（§6.1 原文）— stale_reason = §5 首个差异三元组（path + old/new oid）
      const stale = h.store.getPlanFork(pf.id)!
      expect(stale.status).toBe('STALE')
      const baseOid = oldBase.find((o) => o.path.endsWith('T-2.yaml'))!.git_blob_oid
      expect(stale.stale_reason).toMatch(new RegExp(`path=${WS1_DIR.replace(/\//g, '\\/')}/items/tasks/T-2\\.yaml; base_oid=${baseOid}; current_oid=[0-9a-f]{40}`))
      // 账本: PF_STALE_MARKED（actor=PLUGIN）
      const rows = ledger(h)
      expect(rows.map((r) => r.action_kind)).toEqual(['PF_CREATED', 'PF_STALE_MARKED'])
      expect(JSON.parse(String(rows[1]!.actor))).toEqual({ kind: 'PLUGIN' })
      // 计划零变更（拒绝 = 不物化）
      expect(planBytes(h)).toBe(oldPlan)
      // 后续 SELECT: 前置 PF.status == OPEN 不满足 ⇒ PF_WRONG_STATE
      await assertRejects(() => h.selectService.select(pf.id, USER), (e) => {
        expect(isPlanForkError(e)).toBe(true)
        if (isPlanForkError(e)) expect(e.code).toBe('PF_WRONG_STATE')
      })
    } finally {
      await h.close()
    }
  })

  it('前置状态门: SELECTED / DISMISSED 来源态拒绝（PF_WRONG_STATE, 点名当前态）', async () => {
    const h = await openSelectHarness()
    try {
      const pf = await createPf(h)
      await h.selectService.select(pf.id, USER)
      await assertRejects(() => h.selectService.select(pf.id, USER), (e) => {
        expect(isPlanForkError(e)).toBe(true)
        if (isPlanForkError(e)) {
          expect(e.code).toBe('PF_WRONG_STATE')
          expect(e.message).toContain('SELECTED')
        }
      })
      // 再建一个 PF 走 DISMISS 路径
      const pf2 = await createPf(h, { proposedItems: [{ action: 'NEW', kind: 'TASK', spec: { title: '另一个', goal: 'g' } }] })
      h.selectService.dismiss(pf2.id, USER)
      await assertRejects(() => h.selectService.select(pf2.id, USER), (e) => {
        expect(isPlanForkError(e)).toBe(true)
        if (isPlanForkError(e)) expect(e.code).toBe('PF_WRONG_STATE')
      })
    } finally {
      await h.close()
    }
  })

  it('INV-PERM-2: AGENT actor ⇒ SELECT_ACTOR_NOT_USER, 零状态变更', async () => {
    const h = await openSelectHarness()
    try {
      const pf = await createPf(h)
      const oldPlan = planBytes(h)
      await assertRejects(() => h.selectService.select(pf.id, AGENT), (e) => {
        expect(isSelectServiceError(e)).toBe(true)
        if (isSelectServiceError(e)) {
          expect(e.code).toBe('SELECT_ACTOR_NOT_USER')
          expect(e.message).toContain('INV-PERM-2')
        }
      })
      expect(h.store.getPlanFork(pf.id)!.status).toBe('OPEN')
      expect(planBytes(h)).toBe(oldPlan)
      expect(ledger(h).map((r) => r.action_kind)).toEqual(['PF_CREATED'])
      // SYSTEM actor 同样拒绝（权限表只有用户 ✅）
      await assertRejects(() => h.selectService.select(pf.id, { kind: 'SYSTEM' }), (e) => {
        expect(isSelectServiceError(e) && e.code === 'SELECT_ACTOR_NOT_USER').toBe(true)
      })
    } finally {
      await h.close()
    }
  })

  it('PF_NOT_FOUND: 不存在的 id ⇒ 领域错误原样穿透（select 与 dismiss 两入口）', async () => {
    const h = await openSelectHarness()
    try {
      await assertRejects(() => h.selectService.select('PF-99', USER), (e) => {
        expect(isPlanForkError(e)).toBe(true)
        if (isPlanForkError(e)) expect(e.code).toBe('PF_NOT_FOUND')
      })
      await assertRejects(() => Promise.resolve(h.selectService.dismiss('PF-99', USER)), (e) => {
        expect(isPlanForkError(e)).toBe(true)
        if (isPlanForkError(e)) expect(e.code).toBe('PF_NOT_FOUND')
      })
    } finally {
      await h.close()
    }
  })
})
