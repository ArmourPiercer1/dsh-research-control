/**
 * WP-3.4 — 崩溃后一致性（任务目标 4：重启后 plan.yaml 与 PF 状态不符的
 * 检测与大声报错，**不静默修复**）。
 *
 * 崩溃窗（两系统物化）：SELECT = ① 新定义文件原子写 + ② plan.yaml 原子
 * 重写 + ③ DB 事务（SELECTED + 连锁 STALE + 账本）。进程死在 ② 之后、
 * ③ 提交之前（或 ③ 失败且补偿失败）⇒ 重启后状态：**plan.yaml 已是本 PF
 * 的 §6.3 物化形态，而 PF 仍为 OPEN**（「崩溃签名」— crash-signature.ts
 * (a) 文件证据 + (b) 位置分解 + (c) anchor 可解析）。
 *
 *   - 审计面 `auditSelectConsistency`（只读 — 零状态变更、零账本、零 git
 *     写）: 存在 CRASH_INCOMPLETE 违规 ⇒ **大声抛错** SELECT_CONSISTENCY
 *     （结构化 report 附于错误）; 信息性条目（OK / BASIS_STALE /
 *     UNVERIFIABLE）不抛、不迁移;
 *   - 重启模拟（harness.restart — 同 sqlite 文件 + 同 repo 文件重开两条
 *     连接）: 重启后审计同样大声（检测不依赖进程内状态）;
 *   - SELECT 复核面（§6.1）: 对崩溃态 PF 的 SELECT ⇒ 自动置 STALE（基准
 *     已失真）+ **专用大声错误** SELECT_CRASH_INCOMPLETE（不静默修复 —
 *     不自动恢复旧计划、不自动补 SELECTED; 人工核实: 保留新计划（PF 已
 *     STALE, Agent 可重新提议）或 git restore 旧计划（INV-GIT-8））;
 *   - 补偿失败终态（db 失败 + 恢复失败）⇒ 同一崩溃签名被审计命中
 *     （两路径同态, 交叉钉死）;
 *   - 信息性分支: 用户手改（非物化形态）⇒ BASIS_STALE（§5 stale 为
 *     information-only — 审计零迁移, 状态留 OPEN）; plan.yaml 缺失 ⇒
 *     UNVERIFIABLE（mid-edit 计划上签名不可证 — 信息性）; 无变化 ⇒ OK。
 */

import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  type ActorRef,
  type NewItemSpec,
  type PlanForkItemKind,
  type PlanForkRecord,
} from '../../src/host/domain/planfork/index.js'
import { PlanStore } from '../../src/host/domain/plan/index.js'
import { FsPlanFileWriter } from '../../src/host/service/fs/index.js'
import { FsResearchReader } from '../../src/host/service/checkpoint/fs-reader.js'
import { computeNewPlan, isSelectServiceError } from '../../src/host/service/select/index.js'
import { WS1_CANONICAL } from '../planfork/fixtures.js'
import { WR_SCHEMA_DIR } from '../loader/fixtures.js'
import { planYaml, itemPath } from '../stale/harness.js'
import { assertRejects, createPf, openSelectHarness, type SelectHarness } from './harness.js'

const USER: ActorRef = { kind: 'USER', user_id: 'u-1' }
const WS1_DIR = 'topics/TPC-1/workstreams/WS-1'
const PLAN_REL = `${WS1_DIR}/plan.yaml`

function ledger(h: SelectHarness): Record<string, unknown>[] {
  return h.rawDb.prepare('SELECT * FROM management_action ORDER BY occurred_at ASC, id ASC').all() as Record<string, unknown>[]
}

function planBytes(h: SelectHarness): string {
  return readFileSync(join(h.repo.root, '.research', PLAN_REL), 'utf8')
}

/** 真实 FS 上的 WS-1 PlanStore（测试侧 — 死亡模拟的写者, 与服务同一 kernel）。 */
function ws1Store(h: SelectHarness): PlanStore {
  const researchRoot = join(h.repo.root, '.research')
  return new PlanStore({
    reader: new FsResearchReader(researchRoot),
    writer: new FsPlanFileWriter(),
    researchRoot,
    schemaDir: WR_SCHEMA_DIR,
    topicId: 'TPC-1',
    wsId: 'WS-1',
  })
}

/** §6.2 物化定义文档（与服务 itemDocFromSpec 同形状 — 崩溃签名的文件证据 (a)）。 */
function docFor(kind: PlanForkItemKind, id: string, spec: NewItemSpec, at: number): Record<string, unknown> {
  const s = spec as unknown as Record<string, unknown>
  const base: Record<string, unknown> = {
    id,
    workstream_id: 'WS-1',
    created_by: { kind: 'AGENT', run_id: 'R-81' },
    created_at: at,
  }
  switch (kind) {
    case 'TASK':
      return {
        ...base,
        title: s.title,
        goal: s.goal,
        ...(s.deliverables !== undefined ? { deliverables: s.deliverables } : {}),
        ...(s.acceptance_criteria !== undefined ? { acceptance_criteria: s.acceptance_criteria } : {}),
      }
    case 'GATE':
      return { ...base, title: s.title, criteria: s.criteria, ...(s.references !== undefined ? { references: s.references } : {}) }
    case 'MILESTONE':
      return { ...base, title: s.title, statement: s.statement }
  }
}

/**
 * 死亡模拟：进程死在 plan.yaml 重写（②）之后、DB 事务（③）之前。
 * 用与 SELECT 服务完全相同的纯计算 + 同一 PlanStore kernel 落盘文件半边,
 * DB 零触碰（PF 保持 OPEN）。返回物化后的 newOrder / 新 item 正式 ID。
 */
function simulateDeath(h: SelectHarness, pf: PlanForkRecord): { newOrder: readonly string[]; newIds: readonly string[] } {
  const computed = computeNewPlan({
    canonical: [...WS1_CANONICAL],
    forkAnchor: pf.fork_anchor,
    mergeAnchor: pf.merge_anchor,
    proposedItems: pf.proposed_items,
    existingIdsByKind: { TASK: ['T-1', 'T-2', 'T-3', 'T-4'], GATE: ['G-1', 'G-2'], MILESTONE: ['M-1'] },
  })
  const pstore = ws1Store(h)
  const at = Date.now()
  let ni = 0
  for (const item of pf.proposed_items) {
    if (item.action !== 'NEW') continue
    const alloc = computed.newItems[ni++]!
    const doc = docFor(item.kind, alloc.id, item.spec, at)
    if (item.kind === 'TASK') pstore.createItem('task', doc as never)
    else if (item.kind === 'GATE') pstore.createItem('gate', doc as never)
    else pstore.createItem('milestone', doc as never)
  }
  ws1Store(h).savePlan(computed.newOrder)
  return { newOrder: computed.newOrder, newIds: computed.newItems.map((i) => i.id) }
}

describe('崩溃签名检测（重启后大声报错, 不静默修复）', () => {
  it('死亡模拟（文件半边落盘 / DB 半边丢失）: audit ⇒ SELECT_CONSISTENCY + CRASH_INCOMPLETE 报告; 审计零状态变更', async () => {
    const h = await openSelectHarness()
    try {
      const pf = await createPf(h)
      const { newOrder, newIds } = simulateDeath(h, pf)
      expect(newOrder).toEqual(['G-1', 'T-5', 'T-3', 'M-2', 'T-6', 'T-4', 'G-2'])
      expect(newIds).toEqual(['T-5', 'M-2', 'T-6'])
      const crashedPlan = planBytes(h)
      expect(crashedPlan).toBe(planYaml(newOrder))
      const before = h.store.getPlanFork(pf.id)!

      let report: import('../../src/host/service/select/index.js').SelectAuditReport | undefined
      await assertRejects(() => h.selectService.auditSelectConsistency('WS-1'), (e) => {
        expect(isSelectServiceError(e)).toBe(true)
        if (!isSelectServiceError(e)) return
        expect(e.code).toBe('SELECT_CONSISTENCY')
        expect(e.message).toContain(pf.id)
        expect(e.message).toContain('NO silent repair')
        report = e.report
      })
      expect(report).toBeDefined()
      expect(report!.checked).toBe(1)
      expect(report!.entries).toHaveLength(1)
      const entry = report!.entries[0]!
      expect(entry.kind).toBe('CRASH_INCOMPLETE')
      expect(entry.pfId).toBe(pf.id)
      expect(entry.matchedIds).toEqual(['T-5', 'M-2', 'T-6'])
      expect(entry.diff!.length).toBeGreaterThan(0)
      expect(report!.violations).toHaveLength(1)

      // 审计 = 只读: 计划字节零变更、PF 状态零迁移、账本零新增
      expect(planBytes(h)).toBe(crashedPlan)
      expect(h.store.getPlanFork(pf.id)!).toEqual(before)
      expect(ledger(h).map((r) => r.action_kind)).toEqual(['PF_CREATED'])
    } finally {
      await h.close()
    }
  })

  it('崩溃态 SELECT（§6.1 复核面）: 自动置 STALE + SELECT_CRASH_INCOMPLETE 大声; 计划不恢复（不静默修复）', async () => {
    const h = await openSelectHarness()
    try {
      const pf = await createPf(h)
      const { newOrder } = simulateDeath(h, pf)
      const crashedPlan = planBytes(h)
      const baseOid = pf.base_plan_objects.find((o) => o.path === PLAN_REL)!.git_blob_oid

      await assertRejects(() => h.selectService.select(pf.id, USER), (e) => {
        expect(isSelectServiceError(e)).toBe(true)
        if (!isSelectServiceError(e)) return
        expect(e.code).toBe('SELECT_CRASH_INCOMPLETE')
        expect(e.message).toContain('NO silent repair')
        expect(e.diff!.length).toBeGreaterThan(0)
        expect(e.report!.violations).toHaveLength(1)
      })

      // §6.1: 基准失真 ⇒ 自动 STALE（同事务账本, actor=PLUGIN）
      const after = h.store.getPlanFork(pf.id)!
      expect(after.status).toBe('STALE')
      // stale_reason = §5 首个差异三元组（closure 顺序首位 = plan.yaml 内容变化）
      expect(after.stale_reason).toMatch(new RegExp(`^path=${WS1_DIR.replace(/\//g, '\\/')}/plan\\.yaml; base_oid=${baseOid}; current_oid=[0-9a-f]{40}$`))
      const rows = ledger(h)
      expect(rows.map((r) => r.action_kind)).toEqual(['PF_CREATED', 'PF_STALE_MARKED'])
      expect(JSON.parse(String(rows[1]!.actor))).toEqual({ kind: 'PLUGIN' })

      // 不静默修复: plan.yaml 仍为物化形态（人工决定保留或 git restore — INV-GIT-8）
      expect(planBytes(h)).toBe(crashedPlan)
      expect(planBytes(h)).toBe(planYaml(newOrder))
      // STALE 后不可再 SELECT（§6 前置 — 需 Agent 重新提议）
      await assertRejects(() => h.selectService.select(pf.id, USER), (e) => {
        expect((e as { code?: string }).code).toBe('PF_WRONG_STATE')
      })
    } finally {
      await h.close()
    }
  })

  it('重启模拟（同 sqlite + 同 repo 文件重开）: 重启后审计同样大声（检测不依赖进程内状态）', async () => {
    // harness 契约: restart() 内部关闭旧连接, 旧 harness 不得再 close
    // （其连接已关、repo 所有权移交新 harness）— 只 close 最终 harness。
    let h = await openSelectHarness()
    try {
      const pf = await createPf(h)
      simulateDeath(h, pf)
      const crashedPlan = planBytes(h)

      h = await h.restart()
      // 重启后: 同一 DB 文件（PF 仍 OPEN）+ 同一 repo 文件（plan 仍为物化形态）
      expect(h.store.getPlanFork(pf.id)!.status).toBe('OPEN')
      expect(planBytes(h)).toBe(crashedPlan)

      await assertRejects(() => h.selectService.auditSelectConsistency(), (e) => {
        expect(isSelectServiceError(e)).toBe(true)
        if (!isSelectServiceError(e)) return
        expect(e.code).toBe('SELECT_CONSISTENCY')
        expect(e.report!.violations).toHaveLength(1)
        expect(e.report!.violations[0]!.pfId).toBe(pf.id)
      })
    } finally {
      await h.close()
    }
  })

  it('补偿失败终态（DB 失败 + 恢复失败）⇒ 同一崩溃签名被审计命中（两路径同态）', async () => {
    const h = await openSelectHarness({ dbTransactionFailures: 1, failCompensationRestore: true })
    try {
      const pf = await createPf(h)
      await assertRejects(() => h.selectService.select(pf.id, USER), (e) => {
        expect(isSelectServiceError(e) && e.code === 'SELECT_COMPENSATION_FAILED').toBe(true)
      })
      // 终态 = 崩溃签名态: plan.yaml 物化形态 + PF OPEN
      expect(planBytes(h)).toBe(planYaml(['G-1', 'T-5', 'T-3', 'M-2', 'T-6', 'T-4', 'G-2']))
      expect(h.store.getPlanFork(pf.id)!.status).toBe('OPEN')

      await assertRejects(() => h.selectService.auditSelectConsistency('WS-1'), (e) => {
        expect(isSelectServiceError(e)).toBe(true)
        if (!isSelectServiceError(e)) return
        expect(e.code).toBe('SELECT_CONSISTENCY')
        expect(e.report!.violations[0]!.pfId).toBe(pf.id)
        expect(e.report!.violations[0]!.matchedIds).toEqual(['T-5', 'M-2', 'T-6'])
      })
    } finally {
      await h.close()
    }
  })
})

describe('审计信息性分支（不抛、零迁移、零账本 — §5 stale 为 information-only）', () => {
  it('OK: 无变化的 OPEN PF ⇒ 审计返回 OK 报告（不抛）; SELECTED 后扫面 = 0', async () => {
    const h = await openSelectHarness()
    try {
      const pf = await createPf(h)
      const report = await h.selectService.auditSelectConsistency('WS-1')
      expect(report.checked).toBe(1)
      expect(report.entries).toEqual([{ pfId: pf.id, workstreamId: 'WS-1', kind: 'OK' }])
      expect(report.violations).toEqual([])
      expect(ledger(h).map((r) => r.action_kind)).toEqual(['PF_CREATED'])

      // 扫面只含 OPEN — 全部 SELECTED 后审计零受检对象
      await h.selectService.select(pf.id, USER)
      const report2 = await h.selectService.auditSelectConsistency('WS-1')
      expect(report2.checked).toBe(0)
      expect(report2.entries).toEqual([])
    } finally {
      await h.close()
    }
  })

  it('BASIS_STALE: 用户手改 T-2（非物化形态的闭包差异）⇒ 信息性条目, 不抛、不迁移', async () => {
    const h = await openSelectHarness()
    try {
      const pf = await createPf(h)
      // 用户手改 T-2 goal — 保持良构 YAML（plain scalar 值替换 ⇒ plan 视图
      // 一致, 审计走可计算闭包路径而非 UNVERIFIABLE）
      const t2Path = itemPath('T-2')
      const t2 = await h.repo.read(t2Path)
      await h.repo.write(t2Path, t2.replace('标定采集与求解', '标定采集与求解（用户手改）'))

      const report = await h.selectService.auditSelectConsistency('WS-1')
      expect(report.checked).toBe(1)
      expect(report.violations).toEqual([])
      expect(report.entries[0]!.kind).toBe('BASIS_STALE')
      expect(report.entries[0]!.diff!.some((d) => d.path.endsWith('T-2.yaml') && d.kind === 'oid_changed')).toBe(true)

      // 审计零状态变更: PF 保持 OPEN（状态迁移属 §6.1 SELECT 复核/§5 触发面）
      expect(h.store.getPlanFork(pf.id)!.status).toBe('OPEN')
      expect(h.store.getPlanFork(pf.id)!.stale_reason).toBeUndefined()
      expect(ledger(h).map((r) => r.action_kind)).toEqual(['PF_CREATED'])
    } finally {
      await h.close()
    }
  })

  it('UNVERIFIABLE: plan.yaml 缺失（mid-edit）⇒ 信息性条目（签名不可证）, 不抛', async () => {
    const h = await openSelectHarness()
    try {
      const pf = await createPf(h)
      rmSync(join(h.repo.root, '.research', PLAN_REL))

      const report = await h.selectService.auditSelectConsistency('WS-1')
      expect(report.checked).toBe(1)
      expect(report.violations).toEqual([])
      expect(report.entries[0]!.kind).toBe('UNVERIFIABLE')
      expect(report.entries[0]!.note).toContain('plan.yaml absent')
      expect(h.store.getPlanFork(pf.id)!.status).toBe('OPEN')
      expect(ledger(h).map((r) => r.action_kind)).toEqual(['PF_CREATED'])
    } finally {
      await h.close()
    }
  })
})
