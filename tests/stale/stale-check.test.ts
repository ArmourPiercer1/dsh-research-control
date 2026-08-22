/**
 * WP-3.2 — stale 检测 e2e (deliverables 2+3): §5 算法原文 + §10 状态迁移,
 * 真实临时 git 仓 + 真实 plan 集 + 真实 sqlite PlanForkStore。
 *
 * 任务场景全钉:
 *  - 创建 → 改动**闭包内**文件 → 检测: STALE + 差异精确 (哪些文件变 OID,
 *    old/new 双验证: 记录 base + 独立 hash-object);
 *  - 改动**闭包外**文件 → 不 STALE (§3.1 closure 范围);
 *  - 内容不变重写 OID 不变 (TC-GIT-004 语义 — 不误报, 另见 capture.test);
 *  - STALE 后再检测**幂等** (no-op: 不重算/不迁移/不写账本, 原因冻结);
 *  - §5 集合比较全形态: 重排 (plan.yaml OID) / 增 item (added) / 删 item
 *    (removed) / 删定义文件 (missing) / 删 plan.yaml / 删整个 WS 目录;
 *  - checkAllOpen 扫面 (多 PF 同闭包全 STALE; WS 过滤; per-PF 失败收集
 *    不中断; git 故障 STALE_GIT 零状态变更);
 *  - §10 迁移经 WP-3.1 面 (乐观门 + 同事务 PF_STALE_MARKED 账本, actor=PLUGIN)。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PlanForkError, isPlanForkError } from '../../src/host/domain/planfork/index.js'
import { PlanForkStaleService, StaleServiceError, isStaleServiceError } from '../../src/host/service/stale/index.js'
import type { PlanForkStoreFace } from '../../src/host/service/stale/index.js'
import {
  assertRejects,
  createPf,
  itemPath,
  openStaleHarness,
  planYaml,
  PLAN_PATH,
  WS1_CANONICAL,
  type StaleHarness,
} from './harness.js'
import { makeParams } from '../planfork/fixtures.js'

const WS = 'topics/TPC-1/workstreams/WS-1'

let h: StaleHarness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const rawOid = async (hh: StaleHarness, repoRelPath: string): Promise<string> =>
  (await hh.repo.git(['hash-object', '--', repoRelPath])).stdout.trim()

const closurePaths = (): string[] => {
  const dir = (id: string) => (id.startsWith('G') ? 'gates' : id.startsWith('M') ? 'milestones' : 'tasks')
  return [`${WS}/plan.yaml`, ...WS1_CANONICAL.map((id) => `${WS}/items/${dir(id)}/${id}.yaml`)]
}

describe('checkStale — §5 基准比对 (真实 git 重算)', () => {
  it('no change ⇒ OPEN stays, empty diff, currentClosure == base, zero new ledger rows', async () => {
    h = await openStaleHarness()
    const pf = await createPf(h)
    const out = await h.service.checkStale(pf.id)
    expect(out.statusBefore).toBe('OPEN')
    expect(out.statusAfter).toBe('OPEN')
    expect(out.stale).toBe(false)
    expect(out.markedStale).toBe(false)
    expect(out.diff).toEqual([])
    expect(out.currentClosure).toEqual(pf.base_plan_objects)
    expect(out.gitCommit).toBe(await h.repo.head())
    expect(h.store.getPlanFork(pf.id)!.status).toBe('OPEN')
    expect(h.store.listManagementActions().map((a) => a.action_kind)).toEqual(['PF_CREATED'])
    expect(h.store.countOpen('WS-1')).toBe(1)
  })

  it('inside-closure file edit ⇒ STALE, diff EXACT (single oid_changed, old/new verified), reason = first-diff triple', async () => {
    h = await openStaleHarness()
    const pf = await createPf(h)
    const baseOid = pf.base_plan_objects.find((o) => o.path === `${WS}/items/tasks/T-2.yaml`)!.git_blob_oid

    // user edits T-2's goal (working copy only — no commit, §3.2)
    const t2 = itemPath('T-2')
    await h.repo.write(t2, `${await h.repo.read(t2)}# user edit: goal sharpened\n`)
    const newOid = await rawOid(h, t2)

    const out = await h.service.checkStale(pf.id)
    expect(out.stale).toBe(true)
    expect(out.markedStale).toBe(true)
    expect(out.statusBefore).toBe('OPEN')
    expect(out.statusAfter).toBe('STALE')
    expect(out.diff).toEqual([
      { path: `${WS}/items/tasks/T-2.yaml`, kind: 'oid_changed', base_oid: baseOid, current_oid: newOid },
    ])

    // row: STALE + stale_reason = the §5 first-diff triple (path + old/new oid)
    const row = h.store.getPlanFork(pf.id)!
    expect(row.status).toBe('STALE')
    expect(row.stale_reason).toBe(`path=${WS}/items/tasks/T-2.yaml; base_oid=${baseOid}; current_oid=${newOid}`)
    // base is untouched (INV-PLAN-4: only status/transition fields move)
    expect(row.base_plan_objects).toEqual(pf.base_plan_objects)

    // ledger: PF_STALE_MARKED appended in the SAME order, actor=PLUGIN
    const actions = h.store.listManagementActions()
    expect(actions.map((a) => a.action_kind)).toEqual(['PF_CREATED', 'PF_STALE_MARKED'])
    const ma = actions[1]!
    expect(ma.actor).toEqual({ kind: 'PLUGIN' })
    expect(ma.subject_refs).toEqual([{ kind: 'PLAN_FORK', id: pf.id }])
    expect(ma.detail).toContain(row.stale_reason!)
    expect(ma.occurred_at).toBeGreaterThan(actions[0]!.occurred_at)

    expect(h.store.countOpen('WS-1')).toBe(0)
  })

  it('outside-closure changes only ⇒ NOT stale (closure scope — §3.1)', async () => {
    h = await openStaleHarness()
    const pf = await createPf(h)
    // edits OUTSIDE the closure:
    await h.repo.write('.research/project.yaml', (await h.repo.read('.research/project.yaml')) + '# note\n')
    await h.repo.write('.research/topics/TPC-1/topology.yaml', (await h.repo.read('.research/topics/TPC-1/topology.yaml')) + '# note\n')
    await h.repo.write('.research/policies/agent-plan-fork.yaml', (await h.repo.read('.research/policies/agent-plan-fork.yaml')) + '# note\n')
    // an UNREFERENCED definition file appears inside the WS dir:
    await h.repo.write(itemPath('T-9'), 'id: T-9\nworkstream_id: WS-1\ntitle: 游离任务\ngoal: 未被 ordered_items 引用\ncreated_by: { kind: USER, label: researcher }\ncreated_at: 2026-08-22T10:00:00Z\n')
    // and a file outside .research/:
    await h.repo.write('README.md', 'fixture repo — touched\n')

    const out = await h.service.checkStale(pf.id)
    expect(out.stale).toBe(false)
    expect(out.markedStale).toBe(false)
    expect(out.diff).toEqual([])
    expect(out.currentClosure).toEqual(pf.base_plan_objects)
    expect(h.store.getPlanFork(pf.id)!.status).toBe('OPEN')
  })

  it('content-identical rewrite of an inside-closure file ⇒ NOT stale (TC-GIT-004: 相同内容重写 OID 不变)', async () => {
    h = await openStaleHarness()
    const pf = await createPf(h)
    const t2 = itemPath('T-2')
    const content = await h.repo.read(t2)
    await h.repo.write(t2, content) // same bytes, new mtime
    const out = await h.service.checkStale(pf.id)
    expect(out.stale).toBe(false)
    expect(out.diff).toEqual([])
    expect(h.store.getPlanFork(pf.id)!.status).toBe('OPEN')
  })

  it('plan REORDER (same items, same files) ⇒ STALE via plan.yaml OID (顺序在 plan.yaml 内容里)', async () => {
    h = await openStaleHarness()
    const pf = await createPf(h)
    const oldPlanOid = pf.base_plan_objects.find((o) => o.path === `${WS}/plan.yaml`)!.git_blob_oid
    await h.repo.write(PLAN_PATH, planYaml(['G-1', 'T-2', 'T-1', 'T-3', 'M-1', 'T-4', 'G-2']))
    const newPlanOid = await rawOid(h, PLAN_PATH)

    const out = await h.service.checkStale(pf.id)
    expect(out.stale).toBe(true)
    expect(out.diff).toEqual([
      { path: `${WS}/plan.yaml`, kind: 'oid_changed', base_oid: oldPlanOid, current_oid: newPlanOid },
    ])
    expect(h.store.getPlanFork(pf.id)!.status).toBe('STALE')
  })

  it('item ADDED to the plan (new definition file) ⇒ STALE: [plan.yaml oid_changed, T-5.yaml added]', async () => {
    h = await openStaleHarness()
    const pf = await createPf(h)
    const oldPlanOid = pf.base_plan_objects.find((o) => o.path === `${WS}/plan.yaml`)!.git_blob_oid
    await h.repo.write(
      itemPath('T-5'),
      'id: T-5\nworkstream_id: WS-1\ntitle: 补充验证\ngoal: 对残余误差项补充验证\ncreated_by: { kind: USER, label: researcher }\ncreated_at: 2026-08-22T10:00:00Z\n',
    )
    await h.repo.write(PLAN_PATH, planYaml(['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2', 'T-5']))
    const newPlanOid = await rawOid(h, PLAN_PATH)
    const t5Oid = await rawOid(h, itemPath('T-5'))

    const out = await h.service.checkStale(pf.id)
    expect(out.stale).toBe(true)
    expect(out.diff).toEqual([
      { path: `${WS}/plan.yaml`, kind: 'oid_changed', base_oid: oldPlanOid, current_oid: newPlanOid },
      { path: `${WS}/items/tasks/T-5.yaml`, kind: 'added', base_oid: null, current_oid: t5Oid },
    ])
    expect(out.currentClosure).toHaveLength(9) // 8 base files + T-5
  })

  it('item REMOVED from the plan (definition file kept — INV-PLAN-9) ⇒ STALE: [plan.yaml oid_changed, T-1.yaml removed]', async () => {
    h = await openStaleHarness()
    const pf = await createPf(h)
    const oldPlanOid = pf.base_plan_objects.find((o) => o.path === `${WS}/plan.yaml`)!.git_blob_oid
    const t1Oid = pf.base_plan_objects.find((o) => o.path === `${WS}/items/tasks/T-1.yaml`)!.git_blob_oid
    await h.repo.write(PLAN_PATH, planYaml(['G-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2']))
    const newPlanOid = await rawOid(h, PLAN_PATH)

    const out = await h.service.checkStale(pf.id)
    expect(out.stale).toBe(true)
    expect(out.diff).toEqual([
      { path: `${WS}/plan.yaml`, kind: 'oid_changed', base_oid: oldPlanOid, current_oid: newPlanOid },
      { path: `${WS}/items/tasks/T-1.yaml`, kind: 'removed', base_oid: t1Oid, current_oid: null },
    ])
    // the definition file itself is still on disk (INV-PLAN-9) — only the closure set lost it
    expect(await h.repo.read(itemPath('T-1'))).toBeTruthy()
  })

  it('definition file DELETED from disk (plan unchanged) ⇒ STALE: [T-3.yaml missing, base_oid set, current_oid null]', async () => {
    h = await openStaleHarness()
    const pf = await createPf(h)
    const t3Oid = pf.base_plan_objects.find((o) => o.path === `${WS}/items/tasks/T-3.yaml`)!.git_blob_oid
    await h.repo.git(['rm', '-q', '--', itemPath('T-3')]) // file gone; plan still references T-3

    const out = await h.service.checkStale(pf.id)
    expect(out.stale).toBe(true)
    expect(out.diff).toEqual([
      { path: `${WS}/items/tasks/T-3.yaml`, kind: 'missing', base_oid: t3Oid, current_oid: null },
    ])
    expect(h.store.getPlanFork(pf.id)!.stale_reason).toBe(`path=${WS}/items/tasks/T-3.yaml; base_oid=${t3Oid}; current_oid=missing`)
  })

  it('plan.yaml DELETED ⇒ STALE: all 8 base entries removed (plan.yaml first)', async () => {
    h = await openStaleHarness()
    const pf = await createPf(h)
    await h.repo.git(['rm', '-q', '--', PLAN_PATH])
    const out = await h.service.checkStale(pf.id)
    expect(out.stale).toBe(true)
    expect(out.diff).toHaveLength(8)
    expect(out.diff[0]).toEqual({ path: `${WS}/plan.yaml`, kind: 'removed', base_oid: pf.base_plan_objects[0]!.git_blob_oid, current_oid: null })
    for (const [i, entry] of out.diff.entries()) {
      expect(entry.kind).toBe('removed')
      expect(entry.current_oid).toBeNull()
      expect(entry.base_oid).toBe(pf.base_plan_objects[i]!.git_blob_oid)
    }
    expect(out.currentClosure).toEqual([])
  })

  it('whole workstream directory DELETED ⇒ STALE: all base entries removed (workstream_exists=false)', async () => {
    h = await openStaleHarness()
    const pf = await createPf(h)
    await h.repo.git(['rm', '-rq', '--', '.research/topics/TPC-1/workstreams/WS-1'])
    const out = await h.service.checkStale(pf.id)
    expect(out.stale).toBe(true)
    expect(out.diff).toHaveLength(8)
    expect(out.diff.every((d) => d.kind === 'removed')).toBe(true)
    expect(out.currentClosure).toEqual([])
  })
})

describe('checkStale — 幂等与状态面 (§10)', () => {
  it('re-check after STALE is an idempotent NO-OP (no recompute, no transition, no ledger row, reason frozen)', async () => {
    h = await openStaleHarness()
    const pf = await createPf(h)
    const t2 = itemPath('T-2')
    await h.repo.write(t2, `${await h.repo.read(t2)}# edit one\n`)
    const first = await h.service.checkStale(pf.id)
    expect(first.markedStale).toBe(true)
    const reason = h.store.getPlanFork(pf.id)!.stale_reason!
    const ledgerCount = h.store.listManagementActions().length
    expect(ledgerCount).toBe(2) // PF_CREATED + PF_STALE_MARKED

    // immediate re-check:
    const second = await h.service.checkStale(pf.id)
    expect(second.statusBefore).toBe('STALE')
    expect(second.statusAfter).toBe('STALE')
    expect(second.stale).toBe(true)
    expect(second.markedStale).toBe(false)
    expect(second.diff).toEqual([])
    expect(second.currentClosure).toEqual([])
    expect(h.store.listManagementActions().length).toBe(ledgerCount)

    // further edits do NOT rewrite the reason (first-diff semantics frozen at marking):
    const t4 = itemPath('T-4')
    await h.repo.write(t4, `${await h.repo.read(t4)}# edit two\n`)
    const third = await h.service.checkStale(pf.id)
    expect(third.markedStale).toBe(false)
    expect(h.store.getPlanFork(pf.id)!.stale_reason).toBe(reason)
    expect(h.store.listManagementActions().length).toBe(ledgerCount)
  })

  it('non-OPEN PFs are no-ops: DISMISSED ⇒ stale=false; SELECTED state not reachable without WP-3.4', async () => {
    h = await openStaleHarness()
    const pf = await createPf(h)
    const t2 = itemPath('T-2')
    await h.repo.write(t2, `${await h.repo.read(t2)}# edit\n`)
    await h.service.checkStale(pf.id) // OPEN → STALE
    // user dismisses the stale PF (WP-3.1 state-machine face, actor=USER):
    const dismissed = h.store.transition(pf.id, { to: 'DISMISSED', dismissed_at: 4_000_000_000_000 }, { kind: 'USER' })
    expect(dismissed.status).toBe('DISMISSED')
    const out = await h.service.checkStale(pf.id)
    expect(out.statusBefore).toBe('DISMISSED')
    expect(out.statusAfter).toBe('DISMISSED')
    expect(out.stale).toBe(false)
    expect(out.markedStale).toBe(false)
    expect(out.diff).toEqual([])
  })

  it('unknown PF id ⇒ PF_NOT_FOUND; empty id ⇒ STALE_INPUT', async () => {
    const hh = await openStaleHarness()
    h = hh
    await assertRejects(() => hh.service.checkStale('PF-99'), (e) => {
      expect(isPlanForkError(e)).toBe(true)
      expect((e as PlanForkError).code).toBe('PF_NOT_FOUND')
    })
    await assertRejects(() => hh.service.checkStale(''), (e) => {
      expect(isStaleServiceError(e)).toBe(true)
      expect((e as StaleServiceError).code).toBe('STALE_INPUT')
    })
  })
})

describe('checkAllOpen — 扫面 (deliverable 3)', () => {
  it('3 OPEN PFs sharing one closure: one edit ⇒ all 3 marked STALE, failures empty, per-WS filter works', async () => {
    h = await openStaleHarness()
    const pf1 = await createPf(h)
    const pf2 = await createPf(h, { proposedItems: [makeParams().proposedItems[0]!] })
    const pf3 = await createPf(h, { proposedItems: [makeParams().proposedItems[2]!] })
    expect([pf1.id, pf2.id, pf3.id]).toHaveLength(3)

    const t1 = itemPath('T-1')
    await h.repo.write(t1, `${await h.repo.read(t1)}# shared-closure edit\n`)

    const sweep = await h.service.checkAllOpen()
    expect(sweep.failures).toEqual([])
    expect(sweep.outcomes).toHaveLength(3)
    for (const o of sweep.outcomes) {
      expect(o.stale).toBe(true)
      expect(o.markedStale).toBe(true)
      expect(o.statusAfter).toBe('STALE')
      expect(o.diff).toHaveLength(1)
      expect(o.diff[0]!.path).toBe(`${WS}/items/tasks/T-1.yaml`)
    }
    expect(h.store.countOpen('WS-1')).toBe(0)
    expect(h.store.listManagementActions().filter((a) => a.action_kind === 'PF_STALE_MARKED')).toHaveLength(3)

    // the second sweep is EMPTY (no OPEN PFs remain — the §5 trigger face is
    // OPEN; STALE PFs stay out of scope until the Agent re-proposes):
    const again = await h.service.checkAllOpen()
    expect(again.outcomes).toEqual([])
    expect(again.failures).toEqual([])
    expect(h.store.listManagementActions().filter((a) => a.action_kind === 'PF_STALE_MARKED')).toHaveLength(3)

    // workstream filter: no OPEN PFs left anywhere
    const filtered = await h.service.checkAllOpen('WS-1')
    expect(filtered.outcomes).toEqual([])
    const other = await h.service.checkAllOpen('WS-9')
    expect(other.outcomes).toEqual([])
    expect(other.failures).toEqual([])
  })

  it('per-PF failure is collected, never aborting the sweep (the other PFs still get checked)', async () => {
    h = await openStaleHarness()
    const pf1 = await createPf(h)
    const pf2 = await createPf(h, { proposedItems: [makeParams().proposedItems[0]!] })
    const pf3 = await createPf(h, { proposedItems: [makeParams().proposedItems[2]!] })
    const flaky = pf2.id

    // a store face that loses exactly one PF (simulated concurrent DISMISS race):
    const realStore = h.store
    const face: PlanForkStoreFace = {
      getPlanFork: (id) => (id === flaky ? null : realStore.getPlanFork(id)),
      listPlanForks: (f) => realStore.listPlanForks(f),
      transition: (id, t, a) => realStore.transition(id, t, a),
      createPlanFork: (p, c) => realStore.createPlanFork(p, c),
    }
    const svc = new PlanForkStaleService({ repoRoot: h.repo.root, store: face, planProvider: h.planProvider })

    const t1 = itemPath('T-1')
    await h.repo.write(t1, `${await h.repo.read(t1)}# sweep edit\n`)

    const sweep = await svc.checkAllOpen()
    expect(sweep.outcomes).toHaveLength(2)
    expect(sweep.outcomes.map((o) => o.pfId).sort()).toEqual([pf1.id, pf3.id])
    expect(sweep.outcomes.every((o) => o.markedStale)).toBe(true)
    expect(sweep.failures).toHaveLength(1)
    expect(sweep.failures[0]!.pfId).toBe(flaky)
    expect(isPlanForkError(sweep.failures[0]!.error)).toBe(true)
    // the "lost" PF's row is untouched (still OPEN — no partial write)
    expect(realStore.getPlanFork(flaky)!.status).toBe('OPEN')
  })

  it('git failure during recheck ⇒ STALE_GIT, zero state change (fail loud, never guess)', async () => {
    const hh = await openStaleHarness()
    h = hh
    const pf = await createPf(hh)
    // a service whose git executable cannot resolve (GitMissingError on first W3):
    const svc = new PlanForkStaleService({
      repoRoot: hh.repo.root,
      store: hh.store,
      planProvider: hh.planProvider,
      git: { gitExecutable: '/nonexistent/git-binary-for-wp32-test' },
    })
    await expect(hh.service.checkStale(pf.id)).resolves.toMatchObject({ stale: false }) // control: real git is fine
    await assertRejects(() => svc.checkStale(pf.id), (e) => {
      expect(isStaleServiceError(e)).toBe(true)
      expect((e as StaleServiceError).code).toBe('STALE_GIT')
    })
    // no state change:
    expect(hh.store.getPlanFork(pf.id)!.status).toBe('OPEN')
    expect(hh.store.listManagementActions().map((a) => a.action_kind)).toEqual(['PF_CREATED'])
  })

  it('service input guards: bad workstreamId / concurrency / researchDir / repoRoot ⇒ STALE_INPUT', async () => {
    const hh = await openStaleHarness()
    h = hh
    await assertRejects(() => hh.service.checkAllOpen(''), (e) => {
      expect(isStaleServiceError(e)).toBe(true)
      expect((e as StaleServiceError).code).toBe('STALE_INPUT')
    })
    expect(
      () =>
        new PlanForkStaleService({
          repoRoot: hh.repo.root,
          store: hh.store,
          planProvider: hh.planProvider,
          concurrency: 0,
        }),
    ).toThrowError(/concurrency must be a positive safe integer/)
    expect(
      () =>
        new PlanForkStaleService({
          repoRoot: hh.repo.root,
          store: hh.store,
          planProvider: hh.planProvider,
          researchDir: '../escape',
        }),
    ).toThrowError(/researchDir must be a repo-root-relative directory name/)
    expect(
      () =>
        new PlanForkStaleService({
          repoRoot: '',
          store: hh.store,
          planProvider: hh.planProvider,
        }),
    ).toThrowError(/repoRoot must be a non-empty string/)
  })
})
