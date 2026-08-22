/**
 * WP-3.3 — stub tool behavior (task goal 3: 「未落地的服务以 stub 处理器 +
 * 显式 NOT_IMPLEMENTED 结构化错误交付」).
 *
 * Each of the 9 stub tools must:
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
  RESEARCH_ARTIFACT_REGISTER,
  RESEARCH_CLAIM_RECORD,
  RESEARCH_CONTRACT_READ,
  RESEARCH_CONTEXT_GET,
  RESEARCH_FACT_RECORD,
  RESEARCH_HISTORY_QUERY,
  RESEARCH_INTERVENTION_CREATE,
  RESEARCH_NEXT_ACTION_CREATE,
  RESEARCH_PLAN_GET,
  createResearchTools,
} from '../../src/host/tools/index.js'
import { expectToolErrorAsync, makeExec, makeRecordingDeps } from './fixtures.js'

const STUBS: { name: string; args: Record<string, unknown>; writeStub: boolean }[] = [
  { name: RESEARCH_FACT_RECORD, args: { workstream_id: 'WS-1', statement: 's' }, writeStub: true },
  { name: RESEARCH_CLAIM_RECORD, args: { workstream_id: 'WS-1', statement: 's' }, writeStub: true },
  {
    name: RESEARCH_ARTIFACT_REGISTER,
    args: { workstream_id: 'WS-1', type: 'CODE', title: 't', uri: 'a/b.py' },
    writeStub: true,
  },
  { name: RESEARCH_INTERVENTION_CREATE, args: { title: '需要人工判断：误差预算冲突', detail: 'd' }, writeStub: true },
  { name: RESEARCH_NEXT_ACTION_CREATE, args: { workstream_id: 'WS-1', statement: 's', rationale: 'r' }, writeStub: true },
  { name: RESEARCH_CONTEXT_GET, args: {}, writeStub: false },
  { name: RESEARCH_PLAN_GET, args: { workstream_id: 'WS-1' }, writeStub: false },
  { name: RESEARCH_HISTORY_QUERY, args: { workstream_id: 'WS-1', order: 'audit', after_seq: 0, limit: 10 }, writeStub: false },
  { name: RESEARCH_CONTRACT_READ, args: { edge_id: 'TE-2' }, writeStub: false },
]

describe('stub tools: the NOT_IMPLEMENTED structured error', () => {
  it.each(STUBS)('$name throws NOT_IMPLEMENTED with a structured detail (and never touches the services)', async (stub) => {
    const deps = makeRecordingDeps()
    const tool = createResearchTools(deps).find((t) => t.name === stub.name)!
    const exec = stub.writeStub ? makeExec() : makeExec({ actor: { kind: 'AGENT', session_id: 's' } })
    const error = await expectToolErrorAsync(() => tool.execute(stub.args, exec), 'TOOL_NOT_IMPLEMENTED')
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

  it.each(STUBS.filter((s) => s.writeStub))('$name: an AGENT actor without a run is refused BEFORE the NOT_IMPLEMENTED', async (stub) => {
    const tool = createResearchTools(makeRecordingDeps()).find((t) => t.name === stub.name)!
    await expectToolErrorAsync(
      () => tool.execute(stub.args, makeExec({ actor: { kind: 'AGENT', session_id: 's' } })),
      'TOOL_RUN_REQUIRED',
    )
  })

  it.each(STUBS)('$name: a bad wire face is TOOL_INPUT even on a stub (the frozen face holds)', async (stub) => {
    const tool = createResearchTools(makeRecordingDeps()).find((t) => t.name === stub.name)!
    const exec = stub.writeStub ? makeExec() : makeExec({ actor: { kind: 'AGENT', session_id: 's' } })
    // the same bad-arg cases the live tools use: unknown key / missing required
    const badArgs =
      Object.keys(stub.args).length === 0
        ? { not_a_key: 1 }
        : { ...stub.args, not_a_key: 1 }
    const error = await expectToolErrorAsync(() => tool.execute(badArgs, exec), 'TOOL_INPUT')
    expect(error.message).toContain('/not_a_key')
  })

  it('research_context_get: an empty object is the only accepted face', async () => {
    const tool = createResearchTools(makeRecordingDeps()).find((t) => t.name === RESEARCH_CONTEXT_GET)!
    // {} → NOT_IMPLEMENTED (gate + face passed); any key → TOOL_INPUT
    await expectToolErrorAsync(() => tool.execute({}, makeExec({ actor: { kind: 'AGENT' } })), 'TOOL_NOT_IMPLEMENTED')
    const error = await expectToolErrorAsync(
      () => tool.execute({ workstream_id: 'WS-1' }, makeExec({ actor: { kind: 'AGENT' } })),
      'TOOL_INPUT',
    )
    expect(error.message).toContain('/workstream_id')
  })
})
