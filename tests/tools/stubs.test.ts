/**
 * WP-3.3 — the tool-face firewall (task goal 3: 「未落地的服务以 stub
 * 处理器 + 显式 NOT_IMPLEMENTED 结构化错误交付」 — now CLOSED at zero
 * stubs and repurposed as the liveness firewall).
 *
 * Retirement ledger: G3 retired the semantic trio (fact_record /
 * claim_record / artifact_register — live behavior in
 * tests/tools/semantic-create.test.ts); G2 (§2d) retired the four READ
 * tools (context_get / plan_get / history_query / contract_read — live
 * behavior in tests/tools/read-tools.test.ts, subject gate included);
 * G4 retired the attention pair (intervention_create / next_action_create
 * — live behavior in tests/tools/intervention-create.test.ts +
 * tests/tools/next-action-create.test.ts). The tool face is 11 live
 * forwards, ZERO stubs: no definition may ever answer
 * TOOL_NOT_IMPLEMENTED again.
 *
 * What stays pinned HERE (the historical stub set, 9 tools):
 *  1. every retired tool FORWARDS to its port (a valid wire face + the
 *     default AGENT-with-run exec must REACH the recording deps — the
 *     harness port-firewall error, never TOOL_NOT_IMPLEMENTED);
 *  2. the frozen wire face holds (unknown key ⇒ TOOL_INPUT on every one);
 *  3. the write lanes keep the actor gate BEFORE the port (forged USER ⇒
 *     TOOL_ACTOR_FORBIDDEN; AGENT without a formal run ⇒
 *     TOOL_RUN_REQUIRED, both with zero port calls). The reads' subject
 *     gate is pinned in read-tools.test.ts (same code family).
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
  READ_TOOL_NAMES,
  createResearchTools,
} from '../../src/host/tools/index.js'
import { expectToolErrorAsync, makeExec, makeRecordingDeps } from './fixtures.js'

/** The historical stub set — retired 1:1, kept to pin the liveness sweep. */
const RETIRED: { name: string; args: Record<string, unknown>; write: boolean }[] = [
  { name: RESEARCH_FACT_RECORD, args: { workstream_id: 'WS-1', statement: 's' }, write: true },
  { name: RESEARCH_CLAIM_RECORD, args: { workstream_id: 'WS-1', statement: 's' }, write: true },
  {
    name: RESEARCH_ARTIFACT_REGISTER,
    args: { workstream_id: 'WS-1', type: 'CODE', title: 't', uri: 'a/b.py' },
    write: true,
  },
  { name: RESEARCH_CONTEXT_GET, args: {}, write: false },
  { name: RESEARCH_PLAN_GET, args: { workstream_id: 'WS-1' }, write: false },
  { name: RESEARCH_HISTORY_QUERY, args: { workstream_id: 'WS-1', order: 'audit', after_seq: 0, limit: 10 }, write: false },
  { name: RESEARCH_CONTRACT_READ, args: { edge_id: 'TE-2' }, write: false },
  { name: RESEARCH_INTERVENTION_CREATE, args: { title: '需要人工判断：误差预算冲突', detail: 'd' }, write: true },
  { name: RESEARCH_NEXT_ACTION_CREATE, args: { workstream_id: 'WS-1', statement: 's', rationale: 'r' }, write: true },
]

/** The harness port-firewall messages — a live forward reaching an
 *  un-wired recording port is the EXPECTED outcome of the liveness sweep. */
const PORT_REACHED = /without a test override|lane was reached unexpectedly/

describe('the tool face at ZERO stubs: the historical stub set now forwards live', () => {
  it('the retired set covers all 9 historically-stubbed tools; every READ name is among them (no read may fall back to a stub)', () => {
    const names = new Set(RETIRED.map((s) => s.name))
    for (const read of READ_TOOL_NAMES) expect(names.has(read), read).toBe(true)
    for (const retired of ['research_fact_record', 'research_claim_record', 'research_artifact_register']) {
      expect(names.has(retired), retired).toBe(true)
    }
    expect(RETIRED).toHaveLength(9)
  })

  it.each(RETIRED)('$name: NEVER answers TOOL_NOT_IMPLEMENTED — a valid face + default exec FORWARDS to its port', async (tool0) => {
    const deps = makeRecordingDeps()
    const tool = createResearchTools(deps).find((t) => t.name === tool0.name)!
    // a stub would answer NOT_IMPLEMENTED here; a live tool reaches the
    // recording port, whose harness firewall error proves the forward
    await expect(tool.execute(tool0.args, makeExec())).rejects.toThrow(PORT_REACHED)
  })

  it.each(RETIRED)('$name: a bad wire face is TOOL_INPUT (the frozen face holds live too)', async (tool0) => {
    const tool = createResearchTools(makeRecordingDeps()).find((t) => t.name === tool0.name)!
    const error = await expectToolErrorAsync(
      () => tool.execute({ ...tool0.args, not_a_key: 1 }, makeExec()),
      'TOOL_INPUT',
    )
    expect(error.message).toContain('/not_a_key')
  })

  it.each(RETIRED.filter((s) => s.write))('$name (write lane): a forged actor is refused BEFORE the port', async (tool0) => {
    const deps = makeRecordingDeps()
    const tool = createResearchTools(deps).find((t) => t.name === tool0.name)!
    const error = await expectToolErrorAsync(
      () => tool.execute(tool0.args, makeExec({ actor: { kind: 'USER', user_id: 'u-1' } })),
      'TOOL_ACTOR_FORBIDDEN',
    )
    expect(error.message).toContain(tool0.name)
    expect(deps.planForkCreateCalls).toHaveLength(0)
  })

  it.each(RETIRED.filter((s) => s.write))('$name (write lane): an AGENT actor without a run is refused BEFORE the port', async (tool0) => {
    const deps = makeRecordingDeps()
    const tool = createResearchTools(deps).find((t) => t.name === tool0.name)!
    await expectToolErrorAsync(
      () => tool.execute(tool0.args, makeExec({ actor: { kind: 'AGENT', session_id: 's' } })),
      'TOOL_RUN_REQUIRED',
    )
    expect(deps.planForkCreateCalls).toHaveLength(0)
  })
})
