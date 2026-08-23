/**
 * WP-7.2（RR-018①）— audit 生产触发: 刷新段端到端（真实 wiring）。
 *
 * 覆盖（审计链 = strict audit + discovery 差分 + 机械分类 + Inbox 机械
 * 入口 + 去重基线 — 全机械, 零语义判断）:
 *  1. 干净仓 ⇒ 零 discrepancy, 零写入;
 *  2. zone 首扫 = 基线建立（不捕获 — WP-6.2 firstScan 语义）;
 *  3. zone 新增文件（差分 added）⇒ AUTO 捕获（Inbox 机械入口 CAPTURED）;
 *  4. 二次刷新 ⇒ 去重基线命中（零写入 — 稳态零 inbox 副作用）;
 *  5. zone 文件换名（removed + added）⇒ 旧指纹出基线, 新文件重新捕获;
 *  6. tracked 修改（.research 外, 已提交）⇒ PROPOSE 捕获;
 *  7. strict-tracked 声明路径被删除 ⇒ ESCALATE 批: 单批升级条目 +
 *     高影响判定 + AUTO_AUDIT Intervention 联动（机械入口全链）;
 *  8. .research tracked 未 checkpoint ⇒ RESEARCH_UNCHECKPOINTED AUTO 捕获;
 *  9. 非 git 仓 ⇒ ARF_AUDIT 大声（不吞）;
 * 10. 去重基线 KV 损坏 ⇒ ARF_STATE 大声（绝不静默重置）。
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  AUDIT_REFRESH_REPORTED_KEY,
  AuditRefreshError,
  isAuditRefreshError,
  createAuditRefreshRunner,
  type AuditRefreshResult,
} from '../../src/host/service/wiring/audit-refresh.js'
import { makeWiring, rawDb, T0, type WiringBundle } from '../wiring/helpers.js'

const git = (root: string, ...args: string[]): string =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()

// strict_tracked 声明（ESCALATE 场景）: 覆写 workspace.yaml 的
// strict_tracked.paths（其余与 base 树 fixture 一致）。
const WORKSPACE_STRICT = `workspace:
  root: .
  git_required: true
audit:
  strict_tracked:
    paths: [data/important.txt]
  discovery_zones:
    - path: results/
      artifact_types: [DATASET, FIGURE]
    - path: docs/
  ignored:
    - cache/
    - build/
    - tmp/
`

async function runOnce(b: WiringBundle): Promise<AuditRefreshResult> {
  return await b.wiring.auditRefresh.run()
}

describe('RR-018① audit 生产触发（真实 wiring — 审计链端到端）', () => {
  it('干净仓 ⇒ 零 discrepancy / 零捕获 / Inbox 空', async () => {
    const b = makeWiring()
    const res = await runOnce(b)
    expect(res.discrepancyCount).toBe(0)
    expect(res.captured).toEqual([])
    expect(res.escalated).toBeNull()
    expect(res.captureFailures).toEqual([])
    expect(b.wiring.inbox.listItems({ state: 'CAPTURED' })).toHaveLength(0)
  })

  it('zone 首扫 = 基线建立（不捕获）; 新增文件（差分 added）⇒ AUTO 捕获', async () => {
    const b = makeWiring()
    const zoneDir = join(b.repoRoot, 'results')
    mkdirSync(zoneDir, { recursive: true })
    const first = join(zoneDir, 'first.csv')
    writeFileSync(first, 'a,b\n1,2\n')

    // run 1: 首扫 — 基线建立, 不是事件。
    const r1 = await runOnce(b)
    expect(r1.discovery.firstScan).toBe(true)
    expect(r1.discovery.candidateCount).toBe(1)
    expect(r1.skippedBaseline).toBe(1)
    expect(r1.captured).toEqual([])
    expect(b.wiring.inbox.listItems({ state: 'CAPTURED' })).toHaveLength(0)

    // run 2: 新文件进 zone — 差分 added ⇒ 事件。
    const second = join(zoneDir, 'second.csv')
    writeFileSync(second, 'x\n')
    const r2 = await runOnce(b)
    expect(r2.discovery.firstScan).toBe(false)
    expect(r2.discovery.addedCount).toBe(1)
    // discrepancy = 分类全集（两个 zone 候选都在; 路由再分流捕获/跳过）。
    expect(r2.discrepancyCount).toBe(2)
    expect(r2.captured).toHaveLength(1)
    expect(r2.skippedBaseline).toBe(1) // first.csv = 基线内（非事件）
    expect(r2.captured[0]).toMatchObject({ source: 'UNREGISTERED_WORKSPACE_CHANGE' })
    const items = b.wiring.inbox.listItems({ state: 'CAPTURED' })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ source: 'UNREGISTERED_WORKSPACE_CHANGE', state: 'CAPTURED' })
    expect(items[0]!.payload).toContain('results/second.csv')
    // contextRefs = 机械构造（zone 无 artifact 关联 ⇒ 可能为空; 不虚构）。
    expect(Array.isArray(items[0]!.context_refs)).toBe(true)

    // run 3: 稳态 — 无变化 ⇒ 去重/基线命中, 零新写入。
    const r3 = await runOnce(b)
    expect(r3.discrepancyCount).toBe(2) // 两个 zone 候选都在基线内
    expect(r3.skippedBaseline).toBe(2)
    expect(r3.captured).toEqual([])
    expect(b.wiring.inbox.listItems({ state: 'CAPTURED' })).toHaveLength(1)
  })

  it('zone 文件换名（removed + added）⇒ 旧指纹出基线, 新文件重新捕获', async () => {
    const b = makeWiring()
    const zoneDir = join(b.repoRoot, 'results')
    mkdirSync(zoneDir, { recursive: true })
    writeFileSync(join(zoneDir, 'a.csv'), '1\n')
    await runOnce(b) // 基线
    rmSync(join(zoneDir, 'a.csv'))
    writeFileSync(join(zoneDir, 'b.csv'), '2\n')

    const r = await runOnce(b)
    expect(r.discovery.addedCount).toBe(1)
    expect(r.discovery.removedCount).toBe(1)
    expect(r.captured).toHaveLength(1)
    expect(b.wiring.inbox.listItems({ state: 'CAPTURED' })).toHaveLength(1)
  })

  it('tracked 修改（.research 外, 已提交）⇒ PROPOSE 捕获（二次刷新去重）', async () => {
    const b = makeWiring()
    const f = join(b.repoRoot, 'code.ts')
    // 初始提交已含 .research 树; 追加一个 tracked 文件并提交。
    writeFileSync(f, 'export const a = 1\n')
    git(b.repoRoot, 'add', 'code.ts')
    git(b.repoRoot, 'commit', '-q', '-m', 'add code')
    await runOnce(b) // 干净基线（discovery 首扫亦在此）

    writeFileSync(f, 'export const a = 2\n')
    const r = await runOnce(b)
    expect(r.audit.trackedChangeCount).toBe(1)
    expect(r.discrepancyCount).toBe(1)
    expect(r.byCategory.TRACKED_UNDECLARED).toBe(1)
    expect(r.captured).toHaveLength(1)
    expect(r.captured[0]).toMatchObject({ source: 'UNCLASSIFIED_AUDIT_FINDING' })
    expect(b.wiring.inbox.listItems({ state: 'CAPTURED' })).toHaveLength(1)

    // 二次刷新: 同一事实未变（状态指纹 x/y 未变）⇒ 去重命中, 零新写入。
    const r2 = await runOnce(b)
    expect(r2.discrepancyCount).toBe(1)
    expect(r2.skippedDedupe).toBe(1)
    expect(r2.captured).toEqual([])
    expect(b.wiring.inbox.listItems({ state: 'CAPTURED' })).toHaveLength(1)

    // git 状态变化（暂存 — x: '.'→'M'）⇒ 新指纹 ⇒ 重新捕获（新事实）。
    // 注: 指纹 = 审计报告面（path + 状态）— 内容级变化不改变状态时不重复
    // 报告（机械面不引入内容哈希, 零语义判断）。
    writeFileSync(f, 'export const a = 3\n')
    git(b.repoRoot, 'add', 'code.ts')
    const r3 = await runOnce(b)
    expect(r3.captured).toHaveLength(1)
    expect(b.wiring.inbox.listItems({ state: 'CAPTURED' })).toHaveLength(2)
  })

  it('strict-tracked 声明路径被删除 ⇒ ESCALATE 批: 升级条目 + AUTO_AUDIT Intervention', async () => {
    const b = makeWiring({ treePatch: { 'workspace.yaml': WORKSPACE_STRICT } })
    const f = join(b.repoRoot, 'data', 'important.txt')
    mkdirSync(join(b.repoRoot, 'data'), { recursive: true })
    writeFileSync(f, 'critical\n')
    git(b.repoRoot, 'add', 'data/important.txt')
    git(b.repoRoot, 'commit', '-q', '-m', 'declare important')
    await runOnce(b) // 基线

    rmSync(f) // 工作树删除（index 仍在 ⇒ W13 基线 ∩ W4 删除 = strict 删除）
    const r = await runOnce(b)
    expect(r.audit.strictTrackedDeleted).toBe(1)
    expect(r.discrepancyCount).toBe(1)
    expect(r.byCategory.DECLARED_MISSING).toBe(1)
    expect(r.captured).toEqual([]) // 无逐条捕获
    expect(r.escalated).not.toBeNull()
    expect(r.escalated!.highImpact).toBe(true)
    expect([...r.escalated!.reasons].sort()).toEqual(['DELETION', 'STRICT_TRACKED_CHANGE'])

    // Inbox: 单批升级条目（source = 未分类 audit 发现; raw.escalation 标记）。
    const items = b.wiring.inbox.listItems({ state: 'CAPTURED' })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: r.escalated!.inboxItemId, source: 'UNCLASSIFIED_AUDIT_FINDING' })
    const esc = (items[0]!.raw ?? null) as { escalation?: { highImpact: boolean; reasons: string[] } } | null
    expect(esc?.escalation?.highImpact).toBe(true)
    expect([...(esc?.escalation?.reasons ?? [])].sort()).toEqual(['DELETION', 'STRICT_TRACKED_CHANGE'])

    // Intervention 联动: AUTO_AUDIT origin（INV-ATTN-5 机械闭集）+ OPEN。
    const ivs = b.wiring.interventions.listInterventions()
    expect(ivs).toHaveLength(1)
    expect(ivs[0]).toMatchObject({ id: r.escalated!.interventionId, origin: 'AUTO_AUDIT', status: 'OPEN' })
    expect(ivs[0]!.workstream_ids.length).toBe(0) // 无 WS 关联 ⇒ 仅 operational 队列（TC-DOM-023 语义）

    // 二次刷新: ESCALATE 事实未变 ⇒ 去重命中（零重复升级）。
    const r2 = await runOnce(b)
    expect(r2.skippedDedupe).toBe(1)
    expect(r2.escalated).toBeNull()
    expect(b.wiring.inbox.listItems({ state: 'CAPTURED' })).toHaveLength(1)
    expect(b.wiring.interventions.listInterventions()).toHaveLength(1)
  })

  it('.research tracked 未 checkpoint ⇒ RESEARCH_UNCHECKPOINTED AUTO 捕获', async () => {
    const b = makeWiring()
    await runOnce(b) // 基线
    // 改一个 .research tracked 文件（不提交 — 未 checkpoint）。
    const f = join(b.researchRoot, 'topics', 'TPC-1', 'topic.yaml')
    const text = readFileSync(f, 'utf8')
    writeFileSync(f, text.replace('title: ', 'title: edited '))
    const r = await runOnce(b)
    expect(r.audit.researchConsistent).toBe(false)
    expect(r.byCategory.RESEARCH_UNCHECKPOINTED).toBe(1)
    expect(r.captured).toHaveLength(1)
    expect(b.wiring.inbox.listItems({ state: 'CAPTURED' })).toHaveLength(1)
  })

  it('非 git 仓 ⇒ ARF_AUDIT 大声（刷新失败不吞, 机器码稳定）', async () => {
    const b = makeWiring({ git: false })
    try {
      await runOnce(b)
      expect.unreachable('must throw')
    } catch (e) {
      expect(isAuditRefreshError(e)).toBe(true)
      expect((e as AuditRefreshError).code).toBe('ARF_AUDIT')
    }
    // 失败刷新零副作用: 无 Inbox 条目, 无去重基线。
    expect(b.wiring.inbox.listItems({ state: 'CAPTURED' })).toHaveLength(0)
  })

  it('去重基线 KV 损坏 ⇒ ARF_STATE 大声（绝不静默重置）', async () => {
    const b = makeWiring()
    await runOnce(b) // 建立基线
    const db = rawDb(b.dataDir)
    try {
      db.prepare('UPDATE meta SET value = ? WHERE key = ?').run('not-json{{{', AUDIT_REFRESH_REPORTED_KEY)
      try {
        await runOnce(b)
        expect.unreachable('must throw')
      } catch (e) {
        expect(isAuditRefreshError(e)).toBe(true)
        expect((e as AuditRefreshError).code).toBe('ARF_STATE')
      }
      // 基线保持原样（未重置 — 操作者手动对账）。
      expect(db.prepare('SELECT value FROM meta WHERE key = ?').get(AUDIT_REFRESH_REPORTED_KEY)).toEqual({ value: 'not-json{{{' })
    } finally {
      db.close()
    }
  })

  it('构造护栏: 缺 meta ⇒ ARF_INPUT（组合根大声）', () => {
    const b = makeWiring()
    expect(
      () =>
        createAuditRefreshRunner({
          repoRoot: b.repoRoot,
          researchRoot: b.researchRoot,
          reader: {} as never,
          declarativeDir: '/x',
          // @ts-expect-error deliberate: null meta for the guard test
          meta: null,
          readSemanticState: () => ({}) as never,
          inbox: b.wiring.inbox,
          now: () => T0,
        }),
    ).toThrowError(AuditRefreshError)
  })
})
