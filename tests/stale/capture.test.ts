/**
 * WP-3.2 — closure 捕获 (deliverable 1): §3.1 文件集 + §3.2 逐文件 W3 blob
 * OID，真实临时 git 仓 + 真实 plan 集 (baseTreeFiles WS-1 §11 canonical)。
 *
 * 钉死:
 *  - capturePlanClosure: 8 文件稳定顺序 (plan.yaml 在前 + canonical 顺序)、
 *    每个 OID == 独立 `git hash-object` == `rev-parse HEAD:<path>`
 *    (TC-GIT-004 语义, GIT_INTEGRATION §5.2 第 4 条)、HEAD == 当前 HEAD;
 *  - 未提交仓 (无 HEAD): OID 照常计算 (working copy 基准, §3.2 「无需
 *    commit」), base_git_commit 缺省 (信息性字段);
 *  - createPlanFork 生产路径: 记录的 base_plan_objects/base_git_commit =
 *    服务端 git 重算 (INV-PLAN-6), PF_CREATED 账本 git_blob_oids 同集;
 *  - TC-GIT-004 语义: 相同内容重写 OID 不变 (不误报基础);
 *  - 基准永远重算: 两次创建之间编辑 ⇒ 第二次 base 只有被改文件不同;
 *  - 缺失闭包文件: 独立捕获面大声失败 (STALE_CAPTURE); 创建路径上先被
 *    §4 步骤 2 一致性校验拦下 (PF_PLAN_INCONSISTENT 优先于步骤 3);
 *  - withCapturedBase 适配器: 同闭包返回预捕获基准, 不同闭包大声失败。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PlanForkError, isPlanForkError } from '../../src/host/domain/planfork/index.js'
import { StaleServiceError, isStaleServiceError, withCapturedBase } from '../../src/host/service/stale/index.js'
import {
  assertRejects,
  createPf,
  itemPath,
  openStaleHarness,
  WS1_CANONICAL,
  type StaleHarness,
} from './harness.js'

let h: StaleHarness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

/** Independent ground truth via the fixture's raw git (NOT the plugin path). */
const rawOid = async (hh: StaleHarness, repoRelPath: string): Promise<string> =>
  (await hh.repo.git(['hash-object', '--', repoRelPath])).stdout.trim()

const closurePaths = (): string[] => {
  const ws = 'topics/TPC-1/workstreams/WS-1'
  const dir = (id: string) => (id.startsWith('G') ? 'gates' : id.startsWith('M') ? 'milestones' : 'tasks')
  return [`${ws}/plan.yaml`, ...WS1_CANONICAL.map((id) => `${ws}/items/${dir(id)}/${id}.yaml`)]
}

describe('capturePlanClosure — §3.1/§3.2 真实 git + 真实 plan 集', () => {
  it('committed repo: 8 closure files, stable order, OIDs == independent hash-object == rev-parse HEAD:path', async () => {
    h = await openStaleHarness()
    const cap = await h.service.capturePlanClosure('WS-1')
    expect(cap.workstreamId).toBe('WS-1')
    expect(cap.wsDir).toBe('topics/TPC-1/workstreams/WS-1')
    expect(cap.paths).toEqual(closurePaths())
    expect(cap.objects).toHaveLength(8)
    expect(cap.objects.map((o) => o.path)).toEqual(closurePaths())
    for (const o of cap.objects) {
      expect(o.git_blob_oid).toMatch(/^[0-9a-f]{40}$/)
      // TC-GIT-004: working-copy hash-object == rev-parse HEAD:<path> (内容一致)
      const repoRel = `.research/${o.path}`
      expect(o.git_blob_oid).toBe(await rawOid(h, repoRel))
      const headOid = (await h.repo.git(['rev-parse', `HEAD:${repoRel}`])).stdout.trim()
      expect(o.git_blob_oid).toBe(headOid)
    }
    expect(cap.gitCommit).toBe(await h.repo.head())
  })

  it('uncommitted repo (no HEAD): OIDs still computed from the working copy; gitCommit undefined (§3.2 无需 commit)', async () => {
    h = await openStaleHarness({ committed: false })
    const cap = await h.service.capturePlanClosure('WS-1')
    expect(cap.objects).toHaveLength(8)
    for (const o of cap.objects) {
      expect(o.git_blob_oid).toMatch(/^[0-9a-f]{40}$/)
      expect(o.git_blob_oid).toBe(await rawOid(h, `.research/${o.path}`))
    }
    expect(cap.gitCommit).toBeUndefined()
  })

  it('workstream without plan.yaml ⇒ empty closure (no git needed); unknown workstream ⇒ empty closure', async () => {
    h = await openStaleHarness()
    const ws2 = await h.service.capturePlanClosure('WS-2')
    expect(ws2.paths).toEqual([])
    expect(ws2.objects).toEqual([])
    expect(ws2.gitCommit).toBeUndefined()
    const none = await h.service.capturePlanClosure('WS-9')
    expect(none.paths).toEqual([])
    expect(none.objects).toEqual([])
  })
})

describe('createPlanFork — 生产创建路径 (base 由服务端 git 重算, INV-PLAN-6)', () => {
  it('record carries the server-side git base (8 files, exact OIDs, HEAD) + PF_CREATED ledger with the same set', async () => {
    h = await openStaleHarness()
    const record = await createPf(h)
    expect(record.status).toBe('OPEN')
    expect(record.workstream_id).toBe('WS-1')
    const cap = await h.service.capturePlanClosure('WS-1')
    expect(record.base_plan_objects).toEqual(cap.objects)
    expect(record.base_plan_objects).toHaveLength(8)
    expect(record.base_plan_objects.map((o) => o.path)).toEqual(closurePaths())
    expect(record.base_git_commit).toBe(await h.repo.head())

    const actions = h.store.listManagementActions()
    expect(actions).toHaveLength(1)
    expect(actions[0]!.action_kind).toBe('PF_CREATED')
    expect(actions[0]!.git_blob_oids).toEqual(
      record.base_plan_objects.map((o) => ({ path: o.path, oid: o.git_blob_oid })),
    )
  })

  it('uncommitted repo: base captured, base_git_commit absent (informational field optional)', async () => {
    h = await openStaleHarness({ committed: false })
    const record = await createPf(h)
    expect(record.status).toBe('OPEN')
    expect(record.base_plan_objects).toHaveLength(8)
    expect(record.base_git_commit).toBeUndefined()
  })

  it('TC-GIT-004 semantics: rewriting a file with IDENTICAL content leaves every closure OID unchanged', async () => {
    h = await openStaleHarness()
    const first = await h.service.capturePlanClosure('WS-1')
    // rewrite T-2.yaml byte-identically (new mtime, same content)
    const t2 = itemPath('T-2')
    const content = await h.repo.read(t2)
    await h.repo.write(t2, content)
    const second = await h.service.capturePlanClosure('WS-1')
    expect(second.objects).toEqual(first.objects)
  })

  it('base is ALWAYS recomputed: a second creation after an edit differs only in the edited file', async () => {
    h = await openStaleHarness()
    const pf1 = await createPf(h)
    const t2 = itemPath('T-2')
    const content = await h.repo.read(t2)
    await h.repo.write(t2, `${content}# user edit: goal sharpened\n`)
    const pf2 = await createPf(h)
    expect(pf2.id).not.toBe(pf1.id)
    const ws = 'topics/TPC-1/workstreams/WS-1'
    const t2Path = `${ws}/items/tasks/T-2.yaml`
    const oid1 = Object.fromEntries(pf1.base_plan_objects.map((o) => [o.path, o.git_blob_oid]))
    const oid2 = Object.fromEntries(pf2.base_plan_objects.map((o) => [o.path, o.git_blob_oid]))
    expect(oid2[t2Path]).not.toBe(oid1[t2Path])
    for (const p of Object.keys(oid1)) {
      if (p === t2Path) continue
      expect(oid2[p]).toBe(oid1[p])
    }
  })
})

describe('capture failure faces', () => {
  it('standalone capture: a closure file missing from disk fails loud (STALE_CAPTURE)', async () => {
    const hh = await openStaleHarness()
    h = hh
    await hh.repo.git(['rm', '-q', '--', itemPath('T-2')]) // working copy file gone (plan still references T-2)
    await assertRejects(() => hh.service.capturePlanClosure('WS-1'), (e) => {
      expect(isStaleServiceError(e)).toBe(true)
      const err = e as StaleServiceError
      expect(err.code).toBe('STALE_CAPTURE')
      expect(err.message).toContain('items/tasks/T-2.yaml')
    })
  })

  it('creation path: an inconsistent canonical plan is rejected at §4 step 2 BEFORE step-3 capture (error priority)', async () => {
    const hh = await openStaleHarness()
    h = hh
    await hh.repo.git(['rm', '-q', '--', itemPath('T-2')]) // dangling reference: plan claims T-2, file gone
    await assertRejects(() => createPf(hh), (e) => {
      expect(isPlanForkError(e)).toBe(true)
      const err = e as PlanForkError
      expect(err.code).toBe('PF_PLAN_INCONSISTENT')
    })
    // nothing persisted
    expect(hh.store.listPlanForks()).toEqual([])
    expect(hh.store.listManagementActions()).toEqual([])
  })
})

describe('withCapturedBase — 同步端口适配器 (async-then-sync seam)', () => {
  it('returns the pre-captured base for the identical closure and fails loud on any other request', async () => {
    h = await openStaleHarness()
    const cap = await h.service.capturePlanClosure('WS-1')
    const wsDir = 'topics/TPC-1/workstreams/WS-1'
    const base = { objects: cap.objects, gitCommit: cap.gitCommit }
    const adapter = withCapturedBase(base)
    // first call records the expectation and returns the pre-captured base
    expect(adapter.capture(wsDir, cap.paths)).toBe(base)
    // same wsDir, different closure ⇒ throw
    expect(() => adapter.capture(wsDir, [...cap.paths, 'topics/TPC-1/workstreams/WS-1/items/tasks/T-9.yaml'])).toThrowError(
      /pre-captured base closure does not match/,
    )
    // different wsDir ⇒ throw
    expect(() => adapter.capture('topics/TPC-1/workstreams/WS-2', cap.paths)).toThrowError(
      /pre-captured base closure does not match/,
    )
  })
})
