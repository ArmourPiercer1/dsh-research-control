/**
 * WP-3.3 — research_plan_fork_create forwarding fidelity (task goal 2:
 * 「research_plan_fork_create 全参数形态转发正确」; PLAN_FORK_SPEC §4;
 * INV-PLAN-6 at the tool face).
 *
 * The deps port is backed by the REAL WP-3.1 eight-step chain
 * (`validatePlanForkCreation` over the real frozen schemas / policy /
 * PlanStore-backed plan view / hashing capturer — tests/planfork
 * harness), so every wire argument is validated by the domain it is
 * forwarded to. Assertions:
 *  - the frozen §11 wire face forwards to EXACTLY the domain's frozen
 *    §4 `CreatePlanForkParams` (snake_case → camelCase, per-key);
 *  - `created_by_run` is NOT a parameter: it is the CALL CONTEXT's run
 *    (the AGENT actor's run_id, §4 「调用上下文中的 actor/run」);
 *  - a smuggled `base*` argument is refused at the wire with INV-PLAN-6
 *    cited (the base is server-recomputed — step 3 of the chain);
 *  - domain rejections surface as structured TOOL_SERVICE errors
 *    (service code + §4 step + path).
 */

import { describe, expect, it } from 'vitest'

import {
  PlanForkError,
  validatePlanForkCreation,
} from '../../src/host/domain/planfork/index.js'
import {
  RESEARCH_PLAN_FORK_CREATE,
  createResearchTools,
} from '../../src/host/tools/index.js'
import { AGENT, expectToolErrorAsync, makeExec, makeRecordingDeps, type RecordingDeps } from './fixtures.js'
import { makeHarness, makeParams, type PlanForkHarness } from '../planfork/fixtures.js'

/** The §11 end-to-end example as WIRE args (snake_case — what the model sends). */
const SECTION_11_ARGS = {
  workstream_id: 'WS-1',
  fork_anchor: 'G-1',
  merge_anchor: 'G-2',
  proposed_items: [
    { action: 'NEW', kind: 'TASK', spec: { title: '复算误差预算', goal: '重新推导误差预算并给出复算脚本' } },
    { action: 'KEEP', kind: 'TASK', ref: 'T-3' },
    { action: 'NEW', kind: 'MILESTONE', spec: { title: '标定方案定稿', statement: '误差预算复算通过且标定方案冻结' } },
    { action: 'NEW', kind: 'TASK', spec: { title: '补充实验', goal: '对残余误差项补充测量实验' } },
    { action: 'KEEP', kind: 'TASK', ref: 'T-4' },
  ],
  trigger_refs: [{ kind: 'FACT', id: 'F-31' }],
  reason: '新数据与 T-2 假设冲突, 需要重排验证顺序',
  necessity: '不重排则 M-1 冻结的管线误差预算不可信',
}

/** Wire args for `tool` over a harness-backed deps (the real 8-step chain). */
function makeSetup() {
  const harness: PlanForkHarness = makeHarness()
  const deps = makeRecordingDeps()
  deps.setPlanForkCreate((params) => {
    // The REAL WP-3.1 chain: eight steps over the real frozen context.
    const draft = validatePlanForkCreation(params, harness.makeContext())
    return { ...draft, id: 'PF-1' }
  })
  const tool = createResearchTools(deps).find((t) => t.name === RESEARCH_PLAN_FORK_CREATE)!
  return { harness, deps, tool }
}

describe('research_plan_fork_create: full parameter-face forwarding (real 8-step chain)', () => {
  it('the §11 wire face forwards to EXACTLY the domain §4 params (per-key mapping)', async () => {
    const { deps, tool } = makeSetup()
    const result = (await tool.execute(SECTION_11_ARGS, makeExec({ actor: AGENT }))) as {
      status: string
      plan_fork: Record<string, unknown>
    }

    expect(result.status).toBe('created')
    expect(result.plan_fork.id).toBe('PF-1')
    expect(result.plan_fork.status).toBe('OPEN')
    expect(result.plan_fork.workstream_id).toBe('WS-1')
    expect(result.plan_fork.created_by_run).toBe('R-81')
    expect(result.plan_fork.base_plan_objects).toHaveLength(8) // §11: plan.yaml + 7 definition files
    expect(result.plan_fork.created_at).toBeTypeOf('number')

    // The service saw the domain-typed §4 params — EXACTLY makeParams():
    expect(deps.planForkCreateCalls).toHaveLength(1)
    expect(deps.planForkCreateCalls[0]).toEqual(makeParams())
  })

  it('every wire key maps to its camelCase §4 counterpart (distinctive values)', async () => {
    const { deps, tool } = makeSetup()
    const args = {
      ...SECTION_11_ARGS,
      fork_anchor: '__START__',
      merge_anchor: '__END__',
      reason: 'reason-distinct',
      necessity: 'necessity-distinct',
    }
    await tool.execute(args, makeExec({ actor: AGENT }))
    const forwarded = deps.planForkCreateCalls[0] as Record<string, unknown>
    expect(forwarded['workstreamId']).toBe('WS-1')
    expect(forwarded['forkAnchor']).toBe('__START__')
    expect(forwarded['mergeAnchor']).toBe('__END__')
    expect(forwarded['proposedItems']).toEqual(SECTION_11_ARGS.proposed_items)
    expect(forwarded['triggerRefs']).toEqual(SECTION_11_ARGS.trigger_refs)
    expect(forwarded['reason']).toBe('reason-distinct')
    expect(forwarded['necessity']).toBe('necessity-distinct')
    expect(forwarded['createdByRun']).toBe('R-81')
    // the 8 frozen §4 keys — nothing else reached the service
    expect(Object.keys(forwarded).sort()).toEqual([
      'createdByRun',
      'forkAnchor',
      'mergeAnchor',
      'necessity',
      'proposedItems',
      'reason',
      'triggerRefs',
      'workstreamId',
    ])
  })

  it('created_by_run comes from the call context (the actor run), not the arguments', async () => {
    const { deps, tool } = makeSetup()
    await tool.execute(SECTION_11_ARGS, makeExec({ actor: AGENT }))
    expect(deps.planForkCreateCalls[0]).toMatchObject({ createdByRun: 'R-81' })
    // no run key on the wire face at all:
    expect('created_by_run' in SECTION_11_ARGS).toBe(false)
  })
})

describe('research_plan_fork_create: INV-PLAN-6 at the tool face (no base input)', () => {
  it.each(['base', 'base_plan_objects', 'baseGitCommit', 'base_oid'] as const)(
    'a smuggled %s argument is refused with INV-PLAN-6 cited (before any service call)',
    async (key) => {
      const { deps, tool } = makeSetup()
      const error = await expectToolErrorAsync(
        () => tool.execute({ ...SECTION_11_ARGS, [key]: { path: 'x', git_blob_oid: '0'.repeat(40) } }, makeExec()),
        'TOOL_INPUT',
      )
      expect(error.message).toContain(key)
      expect(error.message).toContain('INV-PLAN-6')
      expect(deps.planForkCreateCalls).toHaveLength(0) // refused at the wire — the service never saw it
    },
  )

  it('an unknown (non-base) argument is refused with its path', async () => {
    const { deps, tool } = makeSetup()
    const error = await expectToolErrorAsync(
      () => tool.execute({ ...SECTION_11_ARGS, not_a_key: 1 }, makeExec()),
      'TOOL_INPUT',
    )
    expect(error.message).toContain('/not_a_key')
    expect(deps.planForkCreateCalls).toHaveLength(0)
  })

  it('each of the 7 frozen keys is required (missing → TOOL_INPUT at its path)', async () => {
    const tool = makeSetup().tool
    for (const key of [
      'workstream_id',
      'fork_anchor',
      'merge_anchor',
      'proposed_items',
      'trigger_refs',
      'reason',
      'necessity',
    ] as const) {
      const args = { ...SECTION_11_ARGS }
      delete args[key]
      const error = await expectToolErrorAsync(() => tool.execute(args, makeExec()), 'TOOL_INPUT')
      expect(error.message).toContain(`/${key}`)
    }
  })
})

describe('research_plan_fork_create: wire-boundary shape violations (frozen face)', () => {
  const { tool } = makeSetup()

  it('proposed_items: action must be KEEP|NEW', async () => {
    const args = { ...SECTION_11_ARGS, proposed_items: [{ action: 'DELETE', kind: 'TASK', ref: 'T-1' }] }
    const error = await expectToolErrorAsync(() => tool.execute(args, makeExec()), 'TOOL_INPUT')
    expect(error.message).toContain('/proposed_items/0/action')
  })

  it('proposed_items: a KEEP without ref is refused', async () => {
    const args = { ...SECTION_11_ARGS, proposed_items: [{ action: 'KEEP', kind: 'TASK' }] }
    const error = await expectToolErrorAsync(() => tool.execute(args, makeExec()), 'TOOL_INPUT')
    expect(error.message).toContain('/proposed_items/0/ref')
  })

  it('proposed_items: an extra key inside an item is refused (additionalProperties false)', async () => {
    const args = {
      ...SECTION_11_ARGS,
      proposed_items: [{ action: 'KEEP', kind: 'TASK', ref: 'T-3', bonus: 'x' }],
    }
    const error = await expectToolErrorAsync(() => tool.execute(args, makeExec()), 'TOOL_INPUT')
    expect(error.message).toContain('/proposed_items/0/bonus')
  })

  it('proposed_items: a NEW without spec is refused', async () => {
    const args = { ...SECTION_11_ARGS, proposed_items: [{ action: 'NEW', kind: 'TASK' }] }
    const error = await expectToolErrorAsync(() => tool.execute(args, makeExec()), 'TOOL_INPUT')
    expect(error.message).toContain('/proposed_items/0/spec')
  })

  it('proposed_items: a spec matching no frozen shape is refused at the spec path (task: title+goal; gate: title+criteria; milestone: title+statement)', async () => {
    const args = { ...SECTION_11_ARGS, proposed_items: [{ action: 'NEW', kind: 'TASK', spec: { title: 't' } }] }
    const error = await expectToolErrorAsync(() => tool.execute(args, makeExec()), 'TOOL_INPUT')
    expect(error.message).toContain('/proposed_items/0/spec')
    expect(error.message).toContain('one of the frozen shapes')
  })

  it('proposed_items: a non-string spec field is refused at the precise path', async () => {
    const args = { ...SECTION_11_ARGS, proposed_items: [{ action: 'NEW', kind: 'TASK', spec: { title: 't', goal: 42 } }] }
    const error = await expectToolErrorAsync(() => tool.execute(args, makeExec()), 'TOOL_INPUT')
    expect(error.message).toContain('/proposed_items/0/spec/goal')
  })

  it('proposed_items: a mixed-shape spec (task goal + milestone statement) is refused', async () => {
    const args = {
      ...SECTION_11_ARGS,
      proposed_items: [
        { action: 'NEW', kind: 'TASK', spec: { title: 't', goal: 'g', statement: 's' } },
      ],
    }
    const error = await expectToolErrorAsync(() => tool.execute(args, makeExec()), 'TOOL_INPUT')
    expect(error.message).toContain('/proposed_items/0/spec/statement')
  })

  it('proposed_items: empty array is refused (minItems 1 — the host DSL cannot express it, the wire parser does)', async () => {
    const args = { ...SECTION_11_ARGS, proposed_items: [] }
    const error = await expectToolErrorAsync(() => tool.execute(args, makeExec()), 'TOOL_INPUT')
    expect(error.message).toContain('/proposed_items')
  })

  it('trigger_refs: a kind outside the frozen 5 is refused', async () => {
    const args = { ...SECTION_11_ARGS, trigger_refs: [{ kind: 'OBJECTIVE2', id: 'OBJ-1' }] }
    const error = await expectToolErrorAsync(() => tool.execute(args, makeExec()), 'TOOL_INPUT')
    expect(error.message).toContain('/trigger_refs/0/kind')
  })

  it('trigger_refs: empty array is refused (minItems 1)', async () => {
    const args = { ...SECTION_11_ARGS, trigger_refs: [] }
    const error = await expectToolErrorAsync(() => tool.execute(args, makeExec()), 'TOOL_INPUT')
    expect(error.message).toContain('/trigger_refs')
  })

  it('args must be an object (arrays/primitives refused)', async () => {
    await expectToolErrorAsync(() => tool.execute('nope', makeExec()), 'TOOL_INPUT')
    await expectToolErrorAsync(() => tool.execute([1], makeExec()), 'TOOL_INPUT')
    await expectToolErrorAsync(() => tool.execute(null, makeExec()), 'TOOL_INPUT')
  })
})

describe('research_plan_fork_create: domain rejections surface as structured TOOL_SERVICE', () => {
  it('step 4 — a KEEP ref missing from the canonical plan (PF_KEEP_REF_MISSING, step 4, path)', async () => {
    const { tool } = makeSetup()
    const args = { ...SECTION_11_ARGS, proposed_items: [{ action: 'KEEP', kind: 'TASK', ref: 'T-9' }] }
    const error = await expectToolErrorAsync(() => tool.execute(args, makeExec()), 'TOOL_SERVICE')
    expect(error.message).toContain('research_plan_fork_create')
    expect(error.detail).toMatchObject({ serviceCode: 'PF_KEEP_REF_MISSING', step: 4 })
  })

  it('step 5 — merge anchor before fork anchor (PF_ANCHOR_ORDER, step 5)', async () => {
    const { tool } = makeSetup()
    const args = { ...SECTION_11_ARGS, fork_anchor: 'T-3', merge_anchor: 'T-1' }
    const error = await expectToolErrorAsync(() => tool.execute(args, makeExec()), 'TOOL_SERVICE')
    expect(error.detail).toMatchObject({ serviceCode: 'PF_ANCHOR_ORDER', step: 5 })
  })

  it('step 6 — a trigger ref that does not exist (PF_TRIGGER_MISSING, step 6)', async () => {
    const { tool } = makeSetup()
    const args = { ...SECTION_11_ARGS, trigger_refs: [{ kind: 'FACT', id: 'F-99' }] }
    const error = await expectToolErrorAsync(() => tool.execute(args, makeExec()), 'TOOL_SERVICE')
    expect(error.detail).toMatchObject({ serviceCode: 'PF_TRIGGER_MISSING', step: 6 })
  })

  it('step 8 — the context run is not a formal run (PF_RUN_NOT_FOUND, step 8)', async () => {
    const { tool } = makeSetup()
    const actor = { ...AGENT, run_id: 'R-98' }
    const error = await expectToolErrorAsync(() => tool.execute(SECTION_11_ARGS, makeExec({ actor })), 'TOOL_SERVICE')
    expect(error.detail).toMatchObject({ serviceCode: 'PF_RUN_NOT_FOUND', step: 8 })
  })

  it('step 8 — the context run belongs to another workstream (PF_RUN_WS_MISMATCH, step 8)', async () => {
    const { harness, tool } = makeSetup()
    harness.runs.runs.set('R-99', { id: 'R-99', workstream_id: 'WS-2', task_id: 'T-2' })
    const actor = { ...AGENT, run_id: 'R-99' }
    const error = await expectToolErrorAsync(() => tool.execute(SECTION_11_ARGS, makeExec({ actor })), 'TOOL_SERVICE')
    expect(error.detail).toMatchObject({ serviceCode: 'PF_RUN_WS_MISMATCH', step: 8 })
  })

  it('a non-PlanForkError service failure is wrapped as TOOL_SERVICE with the message', async () => {
    const { deps, tool } = makeSetup()
    deps.setPlanForkCreate(() => {
      throw new Error('boom: disk on fire')
    })
    const error = await expectToolErrorAsync(() => tool.execute(SECTION_11_ARGS, makeExec()), 'TOOL_SERVICE')
    expect(error.message).toContain('boom: disk on fire')
    expect((error.cause as Error).message).toBe('boom: disk on fire')
  })

  it('PlanForkError instances pass their step/path through the detail (round-trip)', async () => {
    const { deps, tool } = makeSetup()
    deps.setPlanForkCreate(() => {
      throw new PlanForkError({ code: 'PF_INPUT', message: 'internal guard', step: 2, path: '/workstreamId' })
    })
    const error = await expectToolErrorAsync(() => tool.execute(SECTION_11_ARGS, makeExec()), 'TOOL_SERVICE')
    expect(error.detail).toMatchObject({ serviceCode: 'PF_INPUT', step: 2, path: '/workstreamId' })
  })
})

describe('research_plan_fork_create: abort + permission gates (the built-in matrix)', () => {
  it('an aborted signal refuses before dispatch (the service is never called)', async () => {
    const { deps, tool } = makeSetup()
    await expectToolErrorAsync(() => tool.execute(SECTION_11_ARGS, makeExec({ aborted: true })), 'TOOL_ABORTED')
    expect(deps.planForkCreateCalls).toHaveLength(0)
  })

  it('a USER actor is refused even with perfect args (the tool face is agent-only)', async () => {
    const { deps, tool } = makeSetup()
    await expectToolErrorAsync(
      () => tool.execute(SECTION_11_ARGS, makeExec({ actor: { kind: 'USER', user_id: 'u-1' } })),
      'TOOL_ACTOR_FORBIDDEN',
    )
    expect(deps.planForkCreateCalls).toHaveLength(0)
  })

  it('an AGENT actor without a run_id is refused (INV-PERM-1 run attribution)', async () => {
    const { deps, tool } = makeSetup()
    await expectToolErrorAsync(
      () => tool.execute(SECTION_11_ARGS, makeExec({ actor: { kind: 'AGENT', session_id: 's' } })),
      'TOOL_RUN_REQUIRED',
    )
    expect(deps.planForkCreateCalls).toHaveLength(0)
  })
})
