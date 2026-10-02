/**
 * G3 (semantic write tools) — the three semantic write tools forward to
 * the narrow agent create lane (BASELINE_PLAN §2a): stubs retired.
 *
 * Pins at the TOOL boundary (the service lane itself is pinned in
 * tests/semantics-records/agent-create.test.ts; the real-host lane in
 * tests/discovery/host-tools-semantic-write.test.ts):
 *
 *  - the FROZEN parameter faces are unchanged (key sets / types — the
 *    definitions tests keep the shape audit);
 *  - the success value is STRICT (per-tool output schema, additional-
 *    Properties:false) and validates against the tool's own
 *    output.schema — the same contract the host codec enforces at
 *    registration + on every returned value;
 *  - identity: the forwarded caller is built from the exec actor ONLY
 *    (run_id from the run gate, session_id/label carried through); the
 *    wire face refuses every identity key (TOOL_INPUT before any port);
 *  - service rejections ride the documented carrier:
 *    `[research-control] <CODE>: …` → ToolError('TOOL_SERVICE') with
 *    `detail.serviceCode=<CODE>` (OWNER_MISMATCH / OBJECT_NOT_FOUND …);
 *    anything else maps to TOOL_SERVICE without inventing codes.
 */
import { describe, expect, it } from 'vitest'

import {
  RESEARCH_ARTIFACT_REGISTER,
  RESEARCH_CLAIM_RECORD,
  RESEARCH_FACT_RECORD,
  createResearchTools,
  type ResearchToolDeps,
  type ToolJsonSchemaNode,
} from '../../src/host/tools/index.js'
import type {
  RecordClaimResult,
  RecordFactResult,
  RegisterArtifactResult,
  SemanticAgentActor,
} from '../../src/host/service/semantics/index.js'
import { AGENT, expectToolErrorAsync, makeExec, makeRecordingDeps } from './fixtures.js'

/* ------------------------------------------------------------------ *
 * Canned service results (the lane's success shape)
 * ------------------------------------------------------------------ */

const FACT_RESULT: RecordFactResult = {
  factId: 'F-1',
  workstreamId: 'WS-1',
  statement: 'loss plateaued at epoch 12',
  references: ['T-1'],
  status: 'ACTIVE',
  recordedAt: 1700000000001,
  eventId: 'H-1',
  createdByRun: 'R-81',
}
const CLAIM_RESULT: RecordClaimResult = {
  claimId: 'C-1',
  workstreamId: 'WS-1',
  statement: 'the detector saturates below 5lx',
  references: [],
  status: 'ACTIVE',
  recordedAt: 1700000000002,
  eventId: 'H-2',
  createdByRun: 'R-81',
}
const ARTIFACT_RESULT: RegisterArtifactResult = {
  artifactId: 'A-1',
  workstreamId: 'WS-1',
  type: 'DATASET',
  title: 'night-run frames',
  uri: 'data/night-07/',
  status: 'REGISTERED',
  recordedAt: 1700000000003,
  eventId: 'H-3',
  createdByRun: 'R-81',
}

interface Captured {
  callers: SemanticAgentActor[]
  factArgs: unknown[]
  claimArgs: unknown[]
  artifactArgs: unknown[]
}

function wiringDeps(overrides: Partial<ResearchToolDeps['semanticAgentCreate']> = {}): { deps: ReturnType<typeof makeRecordingDeps>; cap: Captured } {
  const deps = makeRecordingDeps()
  const cap: Captured = { callers: [], factArgs: [], claimArgs: [], artifactArgs: [] }
  deps.setSemanticAgentCreate({
    recordFact: (args, caller) => {
      cap.callers.push(caller)
      cap.factArgs.push(args)
      return (overrides.recordFact ?? (() => FACT_RESULT))(args, caller)
    },
    recordClaim: (args, caller) => {
      cap.callers.push(caller)
      cap.claimArgs.push(args)
      return (overrides.recordClaim ?? (() => CLAIM_RESULT))(args, caller)
    },
    registerArtifact: (args, caller) => {
      cap.callers.push(caller)
      cap.artifactArgs.push(args)
      return (overrides.registerArtifact ?? (() => ARTIFACT_RESULT))(args, caller)
    },
  })
  return { deps, cap }
}

/* ------------------------------------------------------------------ *
 * A minimal validator for the tool output-schema vocabulary (the same
 * subset the host codec enforces: type/const/enum/required/properties/
 * additionalProperties/items — a local mirror, no host import)
 * ------------------------------------------------------------------ */

function schemaViolations(node: ToolJsonSchemaNode, value: unknown, path = ''): string[] {
  const out: string[] = []
  if (node.const !== undefined && value !== node.const) out.push(`${path}: expected const ${JSON.stringify(node.const)}`)
  if (node.enum !== undefined && !node.enum.includes(value as never)) out.push(`${path}: not in enum`)
  if (node.type === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    for (const key of node.required ?? []) if (!(key in obj)) out.push(`${path}: missing required ${key}`)
    const props = node.properties ?? {}
    if (node.additionalProperties === false) {
      for (const key of Object.keys(obj)) if (!(key in props)) out.push(`${path}: additional key ${key}`)
    }
    for (const [key, child] of Object.entries(props)) {
      if (key in obj) out.push(...schemaViolations(child, obj[key], `${path}/${key}`))
    }
  } else if (node.type === 'array' && Array.isArray(value)) {
    value.forEach((item, i) => {
      if (node.items) out.push(...schemaViolations(node.items, item, `${path}[${i}]`))
    })
  } else if (node.type === 'string' && typeof value !== 'string') out.push(`${path}: not a string`)
  else if (node.type === 'integer' && !(typeof value === 'number' && Number.isInteger(value))) out.push(`${path}: not an integer`)
  return out
}

/* ------------------------------------------------------------------ *
 * Success paths (frozen faces → lane args → strict success values)
 * ------------------------------------------------------------------ */

describe('research_fact_record (live): forwarding + strict output', () => {
  it('forwards the frozen face + the host-resolved caller and returns the strict success value', async () => {
    const { deps, cap } = wiringDeps()
    const tool = createResearchTools(deps).find((t) => t.name === RESEARCH_FACT_RECORD)!
    const value = (await tool.execute(
      { workstream_id: 'WS-1', statement: 'loss plateaued at epoch 12', references: ['T-1'] },
      makeExec({ actor: AGENT }),
    )) as Record<string, unknown>

    // service args (camelCase service level; no identity fields ride args)
    expect(cap.factArgs).toEqual([{ workstreamId: 'WS-1', statement: 'loss plateaued at epoch 12', references: ['T-1'] }])
    // the caller = the exec actor's trusted identity ONLY
    expect(cap.callers).toEqual([{ kind: 'AGENT', run_id: 'R-81', session_id: 'sess-1', label: 'research-agent' }])

    expect(value).toEqual({
      status: 'ok',
      fact: {
        id: 'F-1',
        workstream_id: 'WS-1',
        statement: 'loss plateaued at epoch 12',
        references: ['T-1'],
        status: 'ACTIVE',
        created_by_run: 'R-81',
        recorded_at: 1700000000001,
        event_id: 'H-1',
      },
    })
    expect(schemaViolations(tool.output.schema, value)).toEqual([])
  })

  it('optional references absent ⇒ fresh empty array on the value', async () => {
    const { deps, cap } = wiringDeps({ recordFact: (args) => ({ ...FACT_RESULT, references: [] }) })
    const tool = createResearchTools(deps).find((t) => t.name === RESEARCH_FACT_RECORD)!
    const value = (await tool.execute({ workstream_id: 'WS-1', statement: 's' }, makeExec())) as {
      fact: { references: string[] }
    }
    expect(value.fact.references).toEqual([])
    expect(cap.factArgs).toEqual([{ workstreamId: 'WS-1', statement: 's' }])
  })
})

describe('research_claim_record (live): forwarding + strict output', () => {
  it('returns the strict success value validating against the tool output schema', async () => {
    const { deps, cap } = wiringDeps()
    const tool = createResearchTools(deps).find((t) => t.name === RESEARCH_CLAIM_RECORD)!
    const value = (await tool.execute({ workstream_id: 'WS-1', statement: 'the detector saturates below 5lx' }, makeExec())) as Record<
      string,
      unknown
    >
    expect(cap.claimArgs).toEqual([{ workstreamId: 'WS-1', statement: 'the detector saturates below 5lx' }])
    expect(value).toEqual({
      status: 'ok',
      claim: {
        id: 'C-1',
        workstream_id: 'WS-1',
        statement: 'the detector saturates below 5lx',
        references: [],
        status: 'ACTIVE',
        created_by_run: 'R-81',
        recorded_at: 1700000000002,
        event_id: 'H-2',
      },
    })
    expect(schemaViolations(tool.output.schema, value)).toEqual([])
  })
})

describe('research_artifact_register (live): forwarding + strict output', () => {
  it('maps the 7-key face to the service args and returns the strict success value', async () => {
    const { deps, cap } = wiringDeps({
      registerArtifact: () => ({ ...ARTIFACT_RESULT, contentHash: 'sha256:ab12', relatedTaskId: 'T-1' }),
    })
    const tool = createResearchTools(deps).find((t) => t.name === RESEARCH_ARTIFACT_REGISTER)!
    const value = (await tool.execute(
      { workstream_id: 'WS-1', type: 'DATASET', title: 'night-run frames', uri: 'data/night-07/', content_hash: 'sha256:ab12', related_task: 'T-1' },
      makeExec(),
    )) as Record<string, unknown>
    expect(cap.artifactArgs).toEqual([
      { workstreamId: 'WS-1', type: 'DATASET', title: 'night-run frames', uri: 'data/night-07/', contentHash: 'sha256:ab12', relatedTaskId: 'T-1' },
    ])
    expect(value).toEqual({
      status: 'ok',
      artifact: {
        id: 'A-1',
        workstream_id: 'WS-1',
        type: 'DATASET',
        title: 'night-run frames',
        uri: 'data/night-07/',
        status: 'REGISTERED',
        created_by_run: 'R-81',
        recorded_at: 1700000000003,
        event_id: 'H-3',
        content_hash: 'sha256:ab12',
        related_task: 'T-1',
      },
    })
    expect(schemaViolations(tool.output.schema, value)).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * Identity: never forgeable from the wire
 * ------------------------------------------------------------------ */

describe('G3 identity pins: the semantic write face carries no identity', () => {
  const FORGED: Record<string, Record<string, unknown>> = {
    [RESEARCH_FACT_RECORD]: { workstream_id: 'WS-1', statement: 's', actor: { kind: 'USER' }, created_by_run: 'R-2' },
    [RESEARCH_CLAIM_RECORD]: { workstream_id: 'WS-1', statement: 's', run_id: 'R-2' },
    [RESEARCH_ARTIFACT_REGISTER]: { workstream_id: 'WS-1', type: 'CODE', title: 't', uri: 'u', caller: { kind: 'AGENT' } },
  }
  for (const [name, args] of Object.entries(FORGED)) {
    it(`${name}: an identity/unknown key on the wire is TOOL_INPUT before any port`, async () => {
      const { deps, cap } = wiringDeps()
      const tool = createResearchTools(deps).find((t) => t.name === name)!
      await expectToolErrorAsync(() => tool.execute(args, makeExec({ actor: AGENT })), 'TOOL_INPUT')
      expect(cap.callers).toHaveLength(0)
    })
  }

  it('an AGENT actor without a formal run never reaches the lane (TOOL_RUN_REQUIRED)', async () => {
    const { deps, cap } = wiringDeps()
    const tool = createResearchTools(deps).find((t) => t.name === RESEARCH_FACT_RECORD)!
    await expectToolErrorAsync(
      () => tool.execute({ workstream_id: 'WS-1', statement: 's' }, makeExec({ actor: { kind: 'AGENT', session_id: 's' } })),
      'TOOL_RUN_REQUIRED',
    )
    expect(cap.callers).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ *
 * Structured service-error mapping (the documented carrier)
 * ------------------------------------------------------------------ */

describe('G3 service-error mapping: carrier code → TOOL_SERVICE detail', () => {
  it('the OWNER_MISMATCH carrier becomes TOOL_SERVICE with detail.serviceCode (message rides verbatim)', async () => {
    const { deps } = wiringDeps({
      recordFact: () => {
        throw new Error('[research-control] OWNER_MISMATCH: Run "R-2" belongs to WS-2, not WS-1')
      },
    })
    const tool = createResearchTools(deps).find((t) => t.name === RESEARCH_FACT_RECORD)!
    const error = await expectToolErrorAsync(
      () => tool.execute({ workstream_id: 'WS-1', statement: 's' }, makeExec()),
      'TOOL_SERVICE',
    )
    expect(error.message).toContain('[research-control] OWNER_MISMATCH')
    expect(error.detail).toMatchObject({ serviceCode: 'OWNER_MISMATCH' })
  })

  it('an unknown caller run (OBJECT_NOT_FOUND carrier) maps the same way', async () => {
    const { deps } = wiringDeps({
      recordClaim: () => {
        throw new Error('[research-control] OBJECT_NOT_FOUND: Run "R-404" does not exist (catalog §5)')
      },
    })
    const tool = createResearchTools(deps).find((t) => t.name === RESEARCH_CLAIM_RECORD)!
    const error = await expectToolErrorAsync(
      () => tool.execute({ workstream_id: 'WS-1', statement: 's' }, makeExec()),
      'TOOL_SERVICE',
    )
    expect(error.detail).toMatchObject({ serviceCode: 'OBJECT_NOT_FOUND' })
  })

  it('a non-carrier failure maps to TOOL_SERVICE WITHOUT a serviceCode (no invented codes)', async () => {
    const { deps } = wiringDeps({
      registerArtifact: () => {
        throw new Error('disk on fire')
      },
    })
    const tool = createResearchTools(deps).find((t) => t.name === RESEARCH_ARTIFACT_REGISTER)!
    const error = await expectToolErrorAsync(
      () => tool.execute({ workstream_id: 'WS-1', type: 'CODE', title: 't', uri: 'u' }, makeExec()),
      'TOOL_SERVICE',
    )
    expect(error.message).toContain('disk on fire')
    expect(error.detail === undefined || error.detail.serviceCode === undefined).toBe(true)
  })
})
