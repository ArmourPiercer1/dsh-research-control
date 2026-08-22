/**
 * WP-3.1 — 八步创建校验 (PLAN_FORK_SPEC §4 原文) 全形态: 每步正例/负例
 * + 步骤优先级 (§4 原文顺序 — 任一失败即拒绝, 错误指明失败项) + 通过后
 * draft 形状 (status=OPEN, created_at epoch ms (A-3), base = 服务端捕获)。
 * 端口全用真实冻结 schema + 真实 PlanStore canonical 加载 (fixtures.ts)。
 */

import { describe, expect, it } from 'vitest'

import {
  PlanForkError,
  validatePlanForkCreation,
  type PlanForkCreationContext,
} from '../../src/host/domain/planfork/index.js'
import {
  MEM_RESEARCH_ROOT,
  baseTreeFiles,
  fakeBlobOid,
  keep,
  makeHarness,
  makeParams,
  newGate,
  newMilestone,
  newTask,
} from './fixtures.js'

/* 每步 helper: 返回 (ctx 覆盖) — 其余各步全部合法。 */

function expectStep(
  params: ReturnType<typeof makeParams>,
  ctxOverrides: Partial<PlanForkCreationContext> = {},
  prebuiltCtx?: PlanForkCreationContext,
): { error: PlanForkError } {
  const h = makeHarness()
  // prebuiltCtx 优先 (需要与外部 harness 共享端口, 如 capturer.failNext)
  const ctx = prebuiltCtx ?? h.makeContext(ctxOverrides)
  try {
    validatePlanForkCreation(params, ctx)
    throw new Error('EXPECTED REJECTION, got success')
  } catch (e) {
    if (e instanceof Error && e.message === 'EXPECTED REJECTION, got success') throw e
    const err = e as PlanForkError
    expect(err).toBeInstanceOf(PlanForkError)
    return { error: err }
  }
}

describe('step 1 — policy enabled', () => {
  it('rejects a disabled policy (PF_POLICY_DISABLED, step 1)', () => {
    const h = makeHarness()
    const { error } = expectStep(makeParams(), {
      policy: { ...h.policy, enabled: false },
    })
    expect(error.code).toBe('PF_POLICY_DISABLED')
    expect(error.step).toBe(1)
    expect(error.path).toBe('/enabled')
  })

  it('passes with the default enabled policy', () => {
    const h = makeHarness()
    const draft = validatePlanForkCreation(makeParams(), h.makeContext())
    expect(draft.status).toBe('OPEN')
  })
})

describe('step 2 — workstream exists + canonical plan loaded', () => {
  it('rejects an unknown workstream (PF_WORKSTREAM_MISSING)', () => {
    const { error } = expectStep(makeParams({ workstreamId: 'WS-9' }), {
      plan: { workstream_id: 'WS-9', wsDir: '', workstream_exists: false, present: false, ordered_items: [], consistent: false, problem: 'workstream directory not found' },
    })
    expect(error.code).toBe('PF_WORKSTREAM_MISSING')
    expect(error.step).toBe(2)
  })

  it('rejects an existing workstream WITHOUT plan.yaml (PF_PLAN_NOT_LOADED)', () => {
    const { error } = expectStep(makeParams({ workstreamId: 'WS-2' }), {
      plan: { workstream_id: 'WS-2', wsDir: 'topics/TPC-1/workstreams/WS-2', workstream_exists: true, present: false, ordered_items: [], consistent: false },
    })
    expect(error.code).toBe('PF_PLAN_NOT_LOADED')
    expect(error.step).toBe(2)
  })

  it('rejects via the REAL PlanStore when the workstream directory is absent', () => {
    const h = makeHarness()
    const ctx = h.makeContext()
    const plan = h.planProvider.load('WS-99')
    const { error } = expectStep(makeParams({ workstreamId: 'WS-99' }), { plan })
    expect(error.code).toBe('PF_WORKSTREAM_MISSING')
    void ctx
  })

  it('rejects a plan-less workstream via the REAL PlanStore (WS-2: workstream.yaml 在, plan.yaml 无)', () => {
    const h = makeHarness()
    const plan = h.planProvider.load('WS-2')
    expect(plan.workstream_exists).toBe(true)
    expect(plan.present).toBe(false)
    const { error } = expectStep(makeParams({ workstreamId: 'WS-2' }), { plan })
    expect(error.code).toBe('PF_PLAN_NOT_LOADED')
    expect(error.step).toBe(2)
  })

  it('rejects an INCONSISTENT canonical plan (PF_PLAN_INCONSISTENT) — 真实 PlanStore 检测', () => {
    // 用户编辑: plan.yaml 引用一个不存在的 item (dangling) — 真实 loadPlan 报错
    const files = {
      ...baseTreeFiles(),
      'topics/TPC-1/workstreams/WS-1/plan.yaml': 'workstream: WS-1\nordered_items: [G-1, T-1, T-9]\n',
    }
    const h = makeHarness(files)
    const plan = h.planProvider.load('WS-1')
    expect(plan.present).toBe(true)
    expect(plan.consistent).toBe(false)
    expect(plan.problem).toBeTruthy()
    const { error } = expectStep(makeParams(), { plan })
    expect(error.code).toBe('PF_PLAN_INCONSISTENT')
    expect(error.step).toBe(2)
    expect(error.message).toContain('inconsistent')
  })

  it('rejects a mismatched context plan view (PF_INPUT 护栏)', () => {
    const { error } = expectStep(makeParams({ workstreamId: 'WS-2' }))
    // makeContext 默认加载 WS-1 视图 ⇒ 视图/参数不匹配
    expect(error.code).toBe('PF_INPUT')
    expect(error.step).toBe(2)
  })
})

describe('step 3 — 基准服务端重算 (INV-PLAN-6)', () => {
  it('captures the 8-file closure base (plan.yaml 在前, canonical 顺序) + 信息性 HEAD', () => {
    const h = makeHarness()
    const draft = validatePlanForkCreation(makeParams(), h.makeContext())
    expect(h.capturer.calls).toHaveLength(1)
    expect(h.capturer.calls[0]!.closure).toHaveLength(8)
    expect(h.capturer.calls[0]!.closure[0]).toBe('topics/TPC-1/workstreams/WS-1/plan.yaml')
    expect(h.capturer.calls[0]!.closure[7]).toBe('topics/TPC-1/workstreams/WS-1/items/gates/G-2.yaml')
    expect(draft.base_plan_objects).toHaveLength(8)
    expect(draft.base_plan_objects[0]!.path).toBe('topics/TPC-1/workstreams/WS-1/plan.yaml')
    expect(draft.base_git_commit).toMatch(/^[0-9a-f]{40}$/)
    // OID = 内容哈希 (working copy)
    const planContent = h.reader.readFile(`${MEM_RESEARCH_ROOT}/topics/TPC-1/workstreams/WS-1/plan.yaml`)!
    expect(draft.base_plan_objects[0]!.git_blob_oid).toBe(fakeBlobOid(planContent))
  })

  it('wraps a capturer failure as PF_BASE_CAPTURE (step 3)', () => {
    const h = makeHarness()
    h.capturer.failNext()
    const { error } = expectStep(makeParams(), {}, h.makeContext())
    expect(error.code).toBe('PF_BASE_CAPTURE')
    expect(error.step).toBe(3)
    expect(error.message).toContain('8 closure files')
  })

  it('never accepts a client-submitted base (类型面无 base 参数 — 结构保证)', () => {
    // 编译期证明在 inv-plan-6.test.ts; 此处运行时: 冻结输入面守卫拒绝 base 键。
    const { error } = expectStep({ ...makeParams(), base_plan_objects: [] } as unknown as Parameters<typeof validatePlanForkCreation>[0])
    expect(error.code).toBe('PF_INPUT')
    expect(error.message).toContain('base')
    expect(error.message).toContain('INV-PLAN-6')
  })
})

describe('step 4 — proposed_items (非空 / KEEP.ref / NEW.spec)', () => {
  it('rejects empty proposed_items (PF_ITEMS_EMPTY)', () => {
    const { error } = expectStep(makeParams({ proposedItems: [] }))
    expect(error.code).toBe('PF_ITEMS_EMPTY')
    expect(error.step).toBe(4)
  })

  it('rejects a KEEP.ref not in the current canonical (PF_KEEP_REF_MISSING, 指明 ref)', () => {
    const { error } = expectStep(makeParams({ proposedItems: [keep('T-9')] }))
    expect(error.code).toBe('PF_KEEP_REF_MISSING')
    expect(error.step).toBe(4)
    expect(error.path).toBe('/proposed_items/0/ref')
    expect(error.message).toContain('T-9')
  })

  it('rejects a KEEP.ref outside the open span (PF_KEEP_REF_OUTSIDE_SPAN)', () => {
    // G-1 是 fork anchor 本身 (区间外 — 保留在 canonical, 不能被 KEEP 重复列出)
    const { error } = expectStep(makeParams({ proposedItems: [keep('G-1')] }))
    expect(error.code).toBe('PF_KEEP_REF_OUTSIDE_SPAN')
    expect(error.message).toContain('("G-1", "G-2")')
    // 前缀区 item (纯插入时任何 item 都在空 span 外)
    const pureErr = expectStep(makeParams({ forkAnchor: 'T-2', mergeAnchor: 'T-2', proposedItems: [keep('T-2')] }))
    expect(pureErr.error.code).toBe('PF_KEEP_REF_OUTSIDE_SPAN')
    expect(pureErr.error.message).toContain('纯插入时 span 为空')
  })

  it('rejects a duplicated KEEP.ref (PF_KEEP_REF_DUPLICATE)', () => {
    const { error } = expectStep(makeParams({ proposedItems: [keep('T-3'), keep('T-3')] }))
    expect(error.code).toBe('PF_KEEP_REF_DUPLICATE')
    expect(error.path).toBe('/proposed_items/1/ref')
    expect(error.message).toContain('proposed_items[0]')
  })

  it('rejects a KEEP with kind ↔ ref mismatch (PF_ITEM_KIND_MISMATCH)', () => {
    const { error } = expectStep(makeParams({ proposedItems: [keep('T-3', 'GATE')] }))
    expect(error.code).toBe('PF_ITEM_KIND_MISMATCH')
    expect(error.message).toContain('GATE')
  })

  it('rejects NEW specs failing the per-kind frozen schema (PF_SPEC_INVALID, 精确 path)', () => {
    // 缺 goal (Task 必填) — 故意构造类型面外的 spec (运行时 schema 是权威)
    const missing = expectStep(
      makeParams({ proposedItems: [{ action: 'NEW', kind: 'TASK', spec: { title: 't' } }] as unknown as import('../../src/host/domain/planfork/index.js').ProposedItem[] }),
    )
    expect(missing.error.code).toBe('PF_SPEC_INVALID')
    expect(missing.error.path).toBe('/proposed_items/0/spec')
    expect(missing.error.message).toContain('goal')
    // kind↔spec 形状错位: kind=TASK 但 gate 形 spec (无 goal)
    const mismatch = expectStep(
      makeParams({ proposedItems: [{ action: 'NEW', kind: 'TASK', spec: { title: 't', criteria: 'c' } }] as unknown as import('../../src/host/domain/planfork/index.js').ProposedItem[] }),
    )
    expect(mismatch.error.code).toBe('PF_SPEC_INVALID')
    expect(mismatch.error.path).toBe('/proposed_items/0/spec')
    // 外层形状违例 (未知 action)
    const shape = expectStep(
      makeParams({ proposedItems: [{ action: 'DELETE', kind: 'TASK', ref: 'T-1' } as never] }),
    )
    expect(shape.error.code).toBe('PF_SPEC_INVALID')
    expect(shape.error.path).toBe('/proposed_items/0')
    // 合法 spec 通过 (含可选字段)
    const h = makeHarness()
    const draft = validatePlanForkCreation(
      makeParams({ proposedItems: [newTask({ title: 't', goal: 'g', deliverables: ['d'], acceptance_criteria: ['a'] }), newGate({ title: 'g', criteria: 'c', references: ['F-31'] }), newMilestone()] }),
      h.makeContext(),
    )
    expect(draft.proposed_items).toHaveLength(3)
  })
})

describe('step 5 — anchors (§2.2 + policy)', () => {
  it('rejects a nonexistent anchor (PF_ANCHOR_MISSING) — 且步骤 4 错误优先 (原文顺序)', () => {
    // 单独 anchor 错: 报 step 5
    const { error } = expectStep(makeParams({ forkAnchor: 'X-9' }))
    expect(error.code).toBe('PF_ANCHOR_MISSING')
    expect(error.step).toBe(5)
    // step 4 与 step 5 同时违例: 报 step 4 (原文顺序 4 < 5)
    const both = expectStep(makeParams({ forkAnchor: 'X-9', proposedItems: [keep('T-9')] }))
    expect(both.error.step).toBe(4)
    expect(both.error.code).toBe('PF_KEEP_REF_MISSING')
  })

  it('rejects fork-after-merge (PF_ANCHOR_ORDER)', () => {
    const { error } = expectStep(makeParams({ forkAnchor: 'G-2', mergeAnchor: 'G-1' }))
    expect(error.code).toBe('PF_ANCHOR_ORDER')
    expect(error.step).toBe(5)
  })

  it('rejects sentinels when policy forbids (PF_ANCHOR_POLICY)', () => {
    const h = makeHarness()
    const { error } = expectStep(makeParams({ forkAnchor: '__START__' }), {
      policy: { ...h.policy, anchors: { ...h.policy.anchors, allow_boundary_sentinels: false } },
    })
    expect(error.code).toBe('PF_ANCHOR_POLICY')
    expect(error.step).toBe(5)
    expect(error.path).toBe('/fork_anchor')
  })

  it('rejects non-listed anchor item kinds (required_item_types=[GATE])', () => {
    const h = makeHarness()
    const { error } = expectStep(makeParams({ forkAnchor: 'T-1', mergeAnchor: 'G-2' }), {
      policy: { ...h.policy, anchors: { ...h.policy.anchors, required_item_types: ['GATE'] } },
    })
    expect(error.code).toBe('PF_ANCHOR_POLICY')
    expect(error.message).toContain('required_item_types=[GATE]')
    // 全 Gate 锚点通过
    const ok = makeHarness()
    const draft = validatePlanForkCreation(makeParams({ forkAnchor: 'G-1', mergeAnchor: 'G-2', proposedItems: [keep('T-3')] }), {
      ...ok.makeContext(),
      policy: { ...ok.policy, anchors: { ...ok.policy.anchors, required_item_types: ['GATE'] } },
    })
    expect(draft.fork_anchor).toBe('G-1')
  })

  it('accepts equal anchors (纯插入) at items and both sentinel forms', () => {
    const h = makeHarness()
    const at = validatePlanForkCreation(makeParams({ forkAnchor: 'T-3', mergeAnchor: 'T-3', proposedItems: [newTask()] }), h.makeContext())
    expect(at.fork_anchor).toBe('T-3')
    const start = validatePlanForkCreation(makeParams({ forkAnchor: '__START__', mergeAnchor: '__START__', proposedItems: [newTask()] }), makeHarness().makeContext())
    expect(start.fork_anchor).toBe('__START__')
    const end = validatePlanForkCreation(makeParams({ forkAnchor: '__END__', mergeAnchor: '__END__', proposedItems: [newTask()] }), makeHarness().makeContext())
    expect(end.merge_anchor).toBe('__END__')
  })
})

describe('step 6 — trigger_refs (≥1 / 存在 / kind ∈ policy)', () => {
  it('rejects empty trigger_refs under require_at_least_one (PF_TRIGGERS_EMPTY)', () => {
    const { error } = expectStep(makeParams({ triggerRefs: [] }))
    expect(error.code).toBe('PF_TRIGGERS_EMPTY')
    expect(error.step).toBe(6)
    // policy 放宽后通过
    const h = makeHarness()
    const draft = validatePlanForkCreation(makeParams({ triggerRefs: [] }), {
      ...h.makeContext(),
      policy: { ...h.policy, triggers: { require_at_least_one: false, allowed_kinds: h.policy.triggers.allowed_kinds } },
    })
    expect(draft.trigger_refs).toEqual([])
  })

  it('rejects a kind outside policy allowed_kinds (PF_TRIGGER_KIND_FORBIDDEN)', () => {
    const h = makeHarness()
    const { error } = expectStep(makeParams({ triggerRefs: [{ kind: 'ARTIFACT', id: 'A-9' }] }), {
      policy: { ...h.policy, triggers: { require_at_least_one: true, allowed_kinds: ['FACT'] } },
    })
    expect(error.code).toBe('PF_TRIGGER_KIND_FORBIDDEN')
    expect(error.path).toBe('/trigger_refs/0/kind')
  })

  it('rejects kind ↔ id mismatch (PF_TRIGGER_REF_INVALID)', () => {
    const { error } = expectStep(makeParams({ triggerRefs: [{ kind: 'FACT', id: 'C-1' }] }))
    expect(error.code).toBe('PF_TRIGGER_REF_INVALID')
    expect(error.message).toContain('C-1')
  })

  it('rejects a non-existent trigger ref (PF_TRIGGER_MISSING, §16.3 写入时校验)', () => {
    const { error } = expectStep(makeParams({ triggerRefs: [{ kind: 'FACT', id: 'F-99' }] }))
    expect(error.code).toBe('PF_TRIGGER_MISSING')
    expect(error.step).toBe(6)
    expect(error.message).toContain('F-99')
    // 存在则通过 (5 种 kind 各验一例)
    const h = makeHarness()
    for (const [kind, id] of [
      ['CLAIM', 'C-1'],
      ['FACT', 'F-31'],
      ['ARTIFACT', 'A-1'],
      ['MILESTONE', 'M-1'],
      ['OBJECTIVE', 'OBJ-1'],
    ] as const) {
      h.triggers.refs.add(`${kind}:${id}`)
      const draft = validatePlanForkCreation(makeParams({ triggerRefs: [{ kind, id }] }), h.makeContext())
      expect(draft.trigger_refs[0]).toEqual({ kind, id })
    }
  })
})

describe('step 7 — reason / necessity 非空', () => {
  it('rejects empty reason (PF_REASON_EMPTY)', () => {
    const { error } = expectStep(makeParams({ reason: '' }))
    expect(error.code).toBe('PF_REASON_EMPTY')
    expect(error.step).toBe(7)
    expect(error.path).toBe('/reason')
  })

  it('rejects empty necessity (PF_NECCESSITY_EMPTY)', () => {
    const { error } = expectStep(makeParams({ necessity: '' }))
    expect(error.code).toBe('PF_NECCESSITY_EMPTY')
    expect(error.step).toBe(7)
  })
})

describe('step 8 — created_by_run (存在 + 属同 WS)', () => {
  it('rejects an unknown run (PF_RUN_NOT_FOUND)', () => {
    const { error } = expectStep(makeParams({ createdByRun: 'R-99' }))
    expect(error.code).toBe('PF_RUN_NOT_FOUND')
    expect(error.step).toBe(8)
  })

  it('rejects a run bound to ANOTHER workstream (PF_RUN_WS_MISMATCH)', () => {
    const h = makeHarness()
    h.runs.runs.set('R-77', { id: 'R-77', workstream_id: 'WS-2' })
    const { error } = expectStep(makeParams({ createdByRun: 'R-77' }), {}, h.makeContext())
    expect(error.code).toBe('PF_RUN_WS_MISMATCH')
    expect(error.message).toContain('WS-2')
  })
})

describe('八步通过 — draft 形状 (§4 原文)', () => {
  it('produces the OPEN draft: 全部 §4 输入 + 服务端 base + created_at epoch ms', () => {
    const h = makeHarness()
    const draft = validatePlanForkCreation(makeParams(), h.makeContext())
    expect(draft).not.toHaveProperty('id') // id 在 store 分配 (§4 「通过后: 分配 PF id」)
    expect(draft.status).toBe('OPEN')
    expect(draft.workstream_id).toBe('WS-1')
    expect(draft.fork_anchor).toBe('G-1')
    expect(draft.merge_anchor).toBe('G-2')
    expect(draft.proposed_items).toHaveLength(5)
    expect(draft.trigger_refs).toEqual([{ kind: 'FACT', id: 'F-31' }])
    expect(draft.created_by_run).toBe('R-81')
    expect(draft.created_at).toBeGreaterThan(0)
    expect(Number.isInteger(draft.created_at)).toBe(true)
    expect(draft.base_plan_objects).toHaveLength(8)
  })

  it('re-validates the base against the CURRENT closure after a user edit (base 永远重算)', () => {
    const h = makeHarness()
    const first = validatePlanForkCreation(makeParams(), h.makeContext())
    // 用户编辑 T-2 goal (§11 步骤 4 的失真场景) — base 必须随之变化
    h.reader.addFile(`${MEM_RESEARCH_ROOT}/topics/TPC-1/workstreams/WS-1/items/tasks/T-2.yaml`, h.reader.readFile(`${MEM_RESEARCH_ROOT}/topics/TPC-1/workstreams/WS-1/items/tasks/T-2.yaml`)! + '\n# user edit\n')
    const second = validatePlanForkCreation(makeParams(), h.makeContext())
    const i = first.base_plan_objects.findIndex((o) => o.path.endsWith('T-2.yaml'))
    expect(i).toBeGreaterThan(0)
    expect(second.base_plan_objects[i]!.git_blob_oid).not.toBe(first.base_plan_objects[i]!.git_blob_oid)
    // 其余文件 OID 不变
    expect(second.base_plan_objects.filter((o) => !o.path.endsWith('T-2.yaml'))).toEqual(first.base_plan_objects.filter((o) => !o.path.endsWith('T-2.yaml')))
  })

  it('honours the §4 step priority end-to-end (1→8 首个失败者)', () => {
    // 同时破坏 step 1 与 step 8 ⇒ 报 step 1
    const h = makeHarness()
    const { error } = expectStep(makeParams({ createdByRun: 'R-99' }), { policy: { ...h.policy, enabled: false } })
    expect(error.step).toBe(1)
    // 同时破坏 step 7 与 step 8 ⇒ 报 step 7
    const { error: e7 } = expectStep(makeParams({ necessity: '', createdByRun: 'R-99' }))
    expect(e7.step).toBe(7)
  })
})
