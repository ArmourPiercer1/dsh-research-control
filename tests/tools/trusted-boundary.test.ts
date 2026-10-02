/**
 * G1 (trusted boundary) — source identity is NEVER forgeable from tool
 * input (BASELINE_PLAN §1/§2c; ARCHITECTURE §6 INV-PERM-1/2).
 *
 * The attribution chain the host owns end to end:
 *   calling session (exec.agent.sessionId) → run row (getRunBySessionId)
 *   → frozen AGENT actorRef → buildTool gates (kind + write-run
 *   requirement) → service lanes. Tool ARGS carry NO identity field and
 *   the runtime key guards refuse every extra key, so nothing on the
 *   model-facing wire can name who is calling or attribute a write to a
 *   run the session does not own.
 *
 * Pins here (the parts `permissions.test.ts` does NOT already own):
 *  - the 11 frozen parameter faces accept NO identity key whatsoever
 *    (actor, kind, user_id, session_id, run_id-as-identity, created_by
 *    variants — none of them);
 *  - `run_id` appears in exactly ONE frozen key set —
 *    research_run_checkpoint — where it is the TARGET run, and G1's
 *    service gate makes target === caller run for AGENT reporters;
 *  - functional refusal of an injected `actor` key on both LIVE tools
 *    (TOOL_INPUT before any service is reached);
 *  - the write-attribution constant invariants stay one line apart from
 *    the §7.2 lists (WRITE=7 / READ=4 / Investigator whitelist = READ).
 */
import { describe, expect, it } from 'vitest'

import {
  ARTIFACT_REGISTER_ARG_KEYS,
  CLAIM_RECORD_ARG_KEYS,
  CONTEXT_GET_ARG_KEYS,
  CONTRACT_READ_ARG_KEYS,
  FACT_RECORD_ARG_KEYS,
  HISTORY_QUERY_ARG_KEYS,
  INVESTIGATOR_TOOL_NAMES,
  INTERVENTION_CREATE_ARG_KEYS,
  NEXT_ACTION_CREATE_ARG_KEYS,
  PLAN_FORK_CREATE_ARG_KEYS,
  PLAN_GET_ARG_KEYS,
  READ_TOOL_NAMES,
  RESEARCH_PLAN_FORK_CREATE,
  RESEARCH_RUN_CHECKPOINT,
  RUN_CHECKPOINT_ARG_KEYS,
  WRITE_TOOL_NAMES,
  createResearchTools,
} from '../../src/host/tools/index.js'
import { AGENT, expectToolErrorAsync, makeExec, makeRecordingDeps } from './fixtures.js'

/** Every frozen §7.2 parameter key set, keyed by tool name. */
const FROZEN_ARG_KEYS: Readonly<Record<string, readonly string[]>> = {
  research_fact_record: FACT_RECORD_ARG_KEYS,
  research_claim_record: CLAIM_RECORD_ARG_KEYS,
  research_artifact_register: ARTIFACT_REGISTER_ARG_KEYS,
  research_intervention_create: INTERVENTION_CREATE_ARG_KEYS,
  research_next_action_create: NEXT_ACTION_CREATE_ARG_KEYS,
  research_plan_fork_create: PLAN_FORK_CREATE_ARG_KEYS,
  research_run_checkpoint: RUN_CHECKPOINT_ARG_KEYS,
  research_context_get: CONTEXT_GET_ARG_KEYS,
  research_plan_get: PLAN_GET_ARG_KEYS,
  research_history_query: HISTORY_QUERY_ARG_KEYS,
  research_contract_read: CONTRACT_READ_ARG_KEYS,
}

/** Identity-bearing spellings NO tool parameter may accept (attribution
 *  is host-resolved; a wire field with one of these names would be a
 *  forgery vector or an ambiguity — either way refused). */
const IDENTITY_KEYS: readonly string[] = [
  'actor',
  'actor_ref',
  'actorRef',
  'kind',
  'user_id',
  'session_id',
  'dsh_session_id',
  'initiated_by',
  'created_by',
  'created_by_run',
  'createdByRun',
  'reporter',
  'caller',
]

describe('G1 trusted boundary: identity is not forgeable from input', () => {
  it('no frozen parameter key set carries an identity key', () => {
    for (const [name, keys] of Object.entries(FROZEN_ARG_KEYS)) {
      for (const key of keys) {
        expect(IDENTITY_KEYS, `${name}: identity key ${key} on the wire face`).not.toContain(key)
      }
    }
  })

  it('run_id exists on exactly ONE face — the checkpoint TARGET — never as identity', () => {
    const withRunId = Object.entries(FROZEN_ARG_KEYS).filter(([, keys]) => keys.includes('run_id')).map(([n]) => n)
    expect(withRunId).toEqual([RESEARCH_RUN_CHECKPOINT])
    // and it is the TARGET run: the G1 service gate enforces
    // caller run_id === target run_id for AGENT reporters (see
    // tests/runbinding/checkpoint-boundary.test.ts + host-tools-reinit).
  })

  it('the composition face is exactly 11 tools over the three service ports', () => {
    const deps = makeRecordingDeps()
    const tools = createResearchTools(deps)
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(FROZEN_ARG_KEYS).sort())
    // the §7.2 lanes: 7 write / 4 read, Investigator whitelist = READ group
    expect(WRITE_TOOL_NAMES).toHaveLength(7)
    expect(READ_TOOL_NAMES).toHaveLength(4)
    expect(INVESTIGATOR_TOOL_NAMES).toEqual(READ_TOOL_NAMES)
  })

  it('an injected `actor`/`user_id` key is refused at the wire on BOTH live tools (before any service)', async () => {
    const deps = makeRecordingDeps()
    deps.setPlanForkCreate(() => {
      throw new Error('unreachable — the key guard must fire first')
    })
    deps.setRecordCheckpoint(() => {
      throw new Error('unreachable — the key guard must fire first')
    })
    const tools = createResearchTools(deps)
    const planFork = tools.find((t) => t.name === RESEARCH_PLAN_FORK_CREATE)!
    const checkpoint = tools.find((t) => t.name === RESEARCH_RUN_CHECKPOINT)!

    // plan_fork_create: minimal-valid face + a forged identity key
    const pfArgs = {
      workstream_id: 'WS-1',
      fork_anchor: 'T-1',
      merge_anchor: 'T-1',
      proposed_items: [{ action: 'NEW', kind: 'TASK', spec: { title: 't', goal: 'g' } }],
      trigger_refs: [{ kind: 'MILESTONE', id: 'M-1' }],
      reason: 'r',
      necessity: 'n',
    }
    const e1 = await expectToolErrorAsync(
      () => planFork.execute({ ...pfArgs, actor: { kind: 'USER', user_id: 'u-root' } }, makeExec({ actor: AGENT })),
      'TOOL_INPUT',
    )
    expect(e1.message).toContain('/actor')

    // run_checkpoint: target face + a forged identity key
    const e2 = await expectToolErrorAsync(
      () => checkpoint.execute({ run_id: 'R-1', actor: { kind: 'USER' } }, makeExec({ actor: AGENT })),
      'TOOL_INPUT',
    )
    expect(e2.message).toContain('/actor')

    expect(deps.planForkCreateCalls ?? []).toHaveLength(0)
    expect(deps.recordCheckpointCalls).toHaveLength(0)
  })

  it('G3: the semantic trio refuse forged identity keys at the wire too (TOOL_INPUT, the lane never runs)', async () => {
    const deps = makeRecordingDeps()
    deps.setSemanticAgentCreate({
      recordFact: () => {
        throw new Error('unreachable — the key guard must fire first')
      },
      recordClaim: () => {
        throw new Error('unreachable — the key guard must fire first')
      },
      registerArtifact: () => {
        throw new Error('unreachable — the key guard must fire first')
      },
    })
    const tools = createResearchTools(deps)
    const cases: Array<[string, Record<string, unknown>]> = [
      ['research_fact_record', { workstream_id: 'WS-1', statement: 's', created_by_run: 'R-2' }],
      ['research_claim_record', { workstream_id: 'WS-1', statement: 's', run_id: 'R-2' }],
      ['research_artifact_register', { workstream_id: 'WS-1', type: 'CODE', title: 't', uri: 'u', caller: { kind: 'AGENT', run_id: 'R-2' } }],
    ]
    for (const [name, args] of cases) {
      const tool = tools.find((t) => t.name === name)!
      const error = await expectToolErrorAsync(
        () => tool.execute(args, makeExec({ actor: AGENT })),
        'TOOL_INPUT',
      )
      expect(error.message, name).toMatch(/\/(created_by_run|run_id|caller)/)
    }
  })
})
