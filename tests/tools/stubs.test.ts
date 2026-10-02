/**
 * WP-3.3 — stub tool behavior (task goal 3: 「未落地的服务以 stub 处理器 +
 * 显式 NOT_IMPLEMENTED 结构化错误交付」).
 *
 * G3 retired the semantic trio (fact_record / claim_record /
 * artifact_register — live behavior in tests/tools/semantic-create.test.ts);
 * G2 (§2d) retired the four READ stubs (context_get / plan_get /
 * history_query / contract_read — live behavior in
 * tests/tools/read-tools.test.ts). The remaining 2 WRITE stubs (the G4
 * attention lane: intervention_create / next_action_create) must each:
 *  1. pass the permission gate first (a forged actor is refused with
 *     TOOL_ACTOR_FORBIDDEN / TOOL_RUN_REQUIRED — NOT NOT_IMPLEMENTED);
 *  2. validate the frozen wire face (TOOL_INPUT on a bad face — the face
 *     is frozen even while the service is unimplemented);
 *  3. throw ToolError('TOOL_NOT_IMPLEMENTED') with a structured detail
 *     (tool name + the planned replacement service) and NEVER reach the
 *     deps ports (the recording deps throw if touched).
 */

import { describe, expect, it } from 'vitest'

import {
  RESEARCH_INTERVENTION_CREATE,
  RESEARCH_NEXT_ACTION_CREATE,
  READ_TOOL_NAMES,
  createResearchTools,
} from '../../src/host/tools/index.js'
import { expectToolErrorAsync, makeExec, makeRecordingDeps } from './fixtures.js'

const STUBS: { name: string; args: Record<string, unknown> }[] = [
  { name: RESEARCH_INTERVENTION_CREATE, args: { title: '需要人工判断：误差预算冲突', detail: 'd' } },
  { name: RESEARCH_NEXT_ACTION_CREATE, args: { workstream_id: 'WS-1', statement: 's', rationale: 'r' } },
]

describe('stub tools: the NOT_IMPLEMENTED structured error', () => {
  it('the stub set is exactly the 2 remaining attention-lane write tools (G3 retired the semantic trio, G2 the four reads)', () => {
    const names = new Set(STUBS.map((s) => s.name))
    // no read tool may fall back to a stub (G2 §2d)
    for (const read of READ_TOOL_NAMES) expect(names.has(read)).toBe(false)
    // the G3 semantic trio is live too (tests/tools/semantic-create.test.ts)
    for (const retired of ['research_fact_record', 'research_claim_record', 'research_artifact_register']) {
      expect(names.has(retired), retired).toBe(false)
    }
    expect(STUBS).toHaveLength(2)
  })

  it.each(STUBS)('$name throws NOT_IMPLEMENTED with a structured detail (and never touches the services)', async (stub) => {
    const deps = makeRecordingDeps()
    const tool = createResearchTools(deps).find((t) => t.name === stub.name)!
    const error = await expectToolErrorAsync(() => tool.execute(stub.args, makeExec()), 'TOOL_NOT_IMPLEMENTED')
    expect(error.message).toContain(stub.name)
    expect(error.detail).toMatchObject({ tool: stub.name })
    expect(typeof (error.detail as { plannedService: string }).plannedService).toBe('string')
    expect((error.detail as { plannedService: string }).plannedService.length).toBeGreaterThan(0)
    // the stub never reaches a service port
    expect(deps.planForkCreateCalls).toHaveLength(0)
    expect(deps.recordCheckpointCalls).toHaveLength(0)
  })

  it.each(STUBS)('$name: a forged actor is refused BEFORE the NOT_IMPLEMENTED (the gate comes first)', async (stub) => {
    const tool = createResearchTools(makeRecordingDeps()).find((t) => t.name === stub.name)!
    const error = await expectToolErrorAsync(
      () => tool.execute(stub.args, makeExec({ actor: { kind: 'USER', user_id: 'u-1' } })),
      'TOOL_ACTOR_FORBIDDEN',
    )
    expect(error.message).toContain(stub.name)
  })

  it.each(STUBS)('$name: an AGENT actor without a run is refused BEFORE the NOT_IMPLEMENTED', async (stub) => {
    const tool = createResearchTools(makeRecordingDeps()).find((t) => t.name === stub.name)!
    await expectToolErrorAsync(
      () => tool.execute(stub.args, makeExec({ actor: { kind: 'AGENT', session_id: 's' } })),
      'TOOL_RUN_REQUIRED',
    )
  })

  it.each(STUBS)('$name: a bad wire face is TOOL_INPUT even on a stub (the frozen face holds)', async (stub) => {
    const tool = createResearchTools(makeRecordingDeps()).find((t) => t.name === stub.name)!
    // the same bad-arg cases the live tools use: unknown key
    const error = await expectToolErrorAsync(
      () => tool.execute({ ...stub.args, not_a_key: 1 }, makeExec()),
      'TOOL_INPUT',
    )
    expect(error.message).toContain('/not_a_key')
  })
})
