/**
 * G4 — research_next_action_create: the stub retires into a REAL forward to
 * the INDEPENDENT `ActionsService.createNextAction` (BASELINE_PLAN §2b: the
 * service already owns the actor creator gate (`assertNextActionCreator`:
 * USER|AGENT, AGENT must carry a well-formed R id) and the optional-WS
 * existence check (§16.3) — the tool was missing ONLY the wiring; no new
 * validation is duplicated).
 *
 * The deps port is the REAL WP-5.2 service over the WP-5.2 harness (real
 * sqlite + memfs tree), proving: trusted AGENT creator from the call context
 * → PROPOSED row with created_by; status/id/created_at are server-side
 * (NOT arguments — the promote/dismiss lane stays user-only and unreachable
 * from this face, the §6 矩阵「NextAction PROMOTE/DISMISS ✅/❌」).
 */

import { afterAll, describe, expect, it } from 'vitest'

import { ActionsError } from '../../src/host/service/actions/index.js'
import { RESEARCH_NEXT_ACTION_CREATE, createResearchTools } from '../../src/host/tools/index.js'
import { openActionsHarness, type ActionsHarness } from '../actions/harness.js'
import { expectToolErrorAsync, makeExec, makeRecordingDeps } from './fixtures.js'

const harnesses: ActionsHarness[] = []

function setup() {
  const harness = openActionsHarness()
  harnesses.push(harness)
  const deps = makeRecordingDeps()
  deps.setNextActionCreate((params, actor) => harness.service.createNextAction(params, actor))
  const tool = createResearchTools(deps).find((t) => t.name === RESEARCH_NEXT_ACTION_CREATE)!
  return { harness, deps, tool }
}

afterAll(() => {
  for (const h of harnesses) h.close()
})

const AGENT_R1 = { kind: 'AGENT', run_id: 'R-1', session_id: 'sess-1', label: 'agent' } as const

describe('research_next_action_create: forwarding to the real ActionsService lane', () => {
  it('an AGENT creator produces the PROPOSED row with the trusted created_by (row IS the record — no History event)', async () => {
    const { harness, deps, tool } = setup()

    const value = (await tool.execute(
      { workstream_id: 'WS-1', statement: '或许值得做：复测 p95 延迟', rationale: '近期抖动异常' },
      makeExec({ actor: AGENT_R1 }),
    )) as { status: string; next_action: Record<string, unknown> }

    expect(value.status).toBe('created')
    expect(value.next_action.status).toBe('PROPOSED')
    expect(value.next_action.workstream_id).toBe('WS-1')
    expect(value.next_action.statement).toBe('或许值得做：复测 p95 延迟')
    expect(value.next_action.rationale).toBe('近期抖动异常')
    expect(value.next_action.created_by).toEqual({ kind: 'AGENT', run_id: 'R-1', label: 'agent' })
    expect(value.next_action.id).toMatch(/^NA-[1-9][0-9]*$/)
    expect('promoted_to_task_id' in value.next_action).toBe(false)

    // the row really exists in the store (the frozen read-back, not just the return value)
    const stored = harness.store.getNextAction(value.next_action.id as string)!
    expect(stored.status).toBe('PROPOSED')
    expect(stored.created_by).toEqual({ kind: 'AGENT', run_id: 'R-1', label: 'agent' })

    // the port saw camelCase service params + the trusted actor
    expect(deps.nextActionCreateCalls).toHaveLength(1)
    expect(deps.nextActionCreateCalls[0].params).toEqual({
      workstreamId: 'WS-1',
      statement: '或许值得做：复测 p95 延迟',
      rationale: '近期抖动异常',
    })
    expect(deps.nextActionCreateCalls[0].actor).toEqual({ kind: 'AGENT', run_id: 'R-1', label: 'agent' })
  })

  it('optionalWS: no workstream_id ⇒ the row is created unattached (§9.3 optional field)', async () => {
    const { harness, tool } = setup()
    const value = (await tool.execute({ statement: '值得考虑的一次性试验' }, makeExec({ actor: AGENT_R1 }))) as {
      status: string
      next_action: Record<string, unknown>
    }
    expect(value.status).toBe('created')
    expect('workstream_id' in value.next_action).toBe(false)
    expect(harness.store.getNextAction(value.next_action.id as string)!.workstream_id).toBeUndefined()
  })

  it('a dangling workstream_id is refused by the SERVICE check (reuse, not duplication): TOOL_SERVICE + ACT_INPUT', async () => {
    const { harness, deps, tool } = setup()
    const error = await expectToolErrorAsync(
      () => tool.execute({ workstream_id: 'WS-99', statement: 's' }, makeExec({ actor: AGENT_R1 })),
      'TOOL_SERVICE',
    )
    expect(error.detail).toMatchObject({ serviceCode: 'ACT_INPUT' })
    expect(error.message).toContain('[ACT_INPUT]')
    expect(deps.nextActionCreateCalls).toHaveLength(1)
    expect(harness.store.listNextActions()).toHaveLength(0)
  })

  it('USER-only operations STAY refused at the service lane the tool forwards to (矩阵 ✅/❌)', async () => {
    const { harness, tool } = setup()
    const value = (await tool.execute({ statement: 's' }, makeExec({ actor: AGENT_R1 }))) as {
      next_action: { id: string }
    }
    let code: string | undefined
    try {
      harness.service.promoteNextAction(value.next_action.id, {}, { kind: 'AGENT', run_id: 'R-1' })
    } catch (e) {
      if (e instanceof ActionsError) code = e.code
      else throw e
    }
    expect(code).toBe('NA_ACTOR')
    expect(harness.store.getNextAction(value.next_action.id)!.status).toBe('PROPOSED')
  })
})

describe('research_next_action_create: the frozen face + gates hold on the now-live tool', () => {
  it('USER actor refused; AGENT without a formal run refused BEFORE the service', async () => {
    const { deps, tool } = setup()
    await expectToolErrorAsync(
      () => tool.execute({ statement: 's' }, makeExec({ actor: { kind: 'USER', user_id: 'u-1' } })),
      'TOOL_ACTOR_FORBIDDEN',
    )
    await expectToolErrorAsync(
      () => tool.execute({ statement: 's' }, makeExec({ actor: { kind: 'AGENT', session_id: 's' } })),
      'TOOL_RUN_REQUIRED',
    )
    expect(deps.nextActionCreateCalls).toHaveLength(0)
  })

  it('identity/status keys are refused at the wire (created_by/status are NOT arguments)', async () => {
    const { deps, tool } = setup()
    const e1 = await expectToolErrorAsync(
      () => tool.execute({ statement: 's', actor: { kind: 'USER' } }, makeExec({ actor: AGENT_R1 })),
      'TOOL_INPUT',
    )
    expect(e1.message).toContain('/actor')
    const e2 = await expectToolErrorAsync(
      () => tool.execute({ statement: 's', status: 'PROMOTED' }, makeExec({ actor: AGENT_R1 })),
      'TOOL_INPUT',
    )
    expect(e2.message).toContain('/status')
    expect(deps.nextActionCreateCalls).toHaveLength(0)
  })

  it('empty statement is TOOL_INPUT; an aborted signal refuses before dispatch', async () => {
    const { deps, tool } = setup()
    const error = await expectToolErrorAsync(() => tool.execute({ statement: '' }, makeExec({ actor: AGENT_R1 })), 'TOOL_INPUT')
    expect(error.message).toContain('/statement')
    await expectToolErrorAsync(() => tool.execute({ statement: 's' }, makeExec({ aborted: true })), 'TOOL_ABORTED')
    expect(deps.nextActionCreateCalls).toHaveLength(0)
  })
})
