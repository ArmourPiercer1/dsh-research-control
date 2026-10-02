/**
 * G4 — research_intervention_create: the stub retires into a REAL forward to
 * `InterventionService.createMechanicalIntervention` (BASELINE_PLAN §2b;
 * DOMAIN_SCHEMA §9.2; CATALOG §5.7; ARCHITECTURE §6 矩阵「Intervention 创建
 * U/A/仅机械触发¹」+ INV-PERM-4: the tool face CREATES only — origin is the
 * fixed AGENT_REPORT mechanical mapping, state is user-only and NO state key
 * exists on this face).
 *
 * The deps port is the REAL WP-5.1 service over the WP-5.1 harness (real
 * research.sqlite, real frozen registry, real attention schemas — same
 * discipline as tests/tools/run-checkpoint.test.ts pins for WP-2.4), so the
 * forwarding is proven end to end: wire args → trusted AGENT actor (from the
 * call context, NEVER from args) → service → INTERVENTION_CREATED event
 * (event-first) → OPEN row in the attention queue (row-second).
 */

import { afterAll, describe, expect, it } from 'vitest'

import { RESEARCH_INTERVENTION_CREATE, createResearchTools } from '../../src/host/tools/index.js'
import type { MechanicalInterventionCreateParams } from '../../src/host/service/intervention/index.js'
import { makeInterventionHarness, type InterventionHarness } from '../intervention/fixtures.js'
import { AGENT, expectToolErrorAsync, makeExec, makeRecordingDeps } from './fixtures.js'

const harnesses: InterventionHarness[] = []

function setup() {
  const harness = makeInterventionHarness()
  harnesses.push(harness)
  const deps = makeRecordingDeps()
  // The REAL WP-5.1 mechanical lane — the trigger is pinned HERE (the wiring
  // seam), the same way production wiring pins AGENT_REPORT_REQUIRES_HUMAN;
  // the tool face carries no trigger/origin key at all.
  deps.setInterventionCreate((params, actor) =>
    harness.service.createMechanicalIntervention(
      { ...(params as Omit<MechanicalInterventionCreateParams, 'trigger'>), trigger: 'AGENT_REPORT_REQUIRES_HUMAN' },
      actor,
    ),
  )
  const tool = createResearchTools(deps).find((t) => t.name === RESEARCH_INTERVENTION_CREATE)!
  return { harness, deps, tool }
}

afterAll(() => {
  for (const h of harnesses) h.close()
})

/** The harness declarative face: WS-1/WS-2 + runs R-1 (WS-1) / R-2 (WS-2). */
const AGENT_R1 = { kind: 'AGENT', run_id: 'R-1', session_id: 'sess-1', label: 'agent' } as const

describe('research_intervention_create: forwarding to the real mechanical lane', () => {
  it('a WS-related report creates the event first, the OPEN row second, and returns the frozen record', async () => {
    const { harness, deps, tool } = setup()

    const value = (await tool.execute(
      {
        title: '误差预算冲突需要人工判断',
        detail: 'FACT F-1 与计划假设矛盾',
        workstream_ids: ['WS-1'],
        source_refs: [{ kind: 'RUN', id: 'R-2' }],
      },
      makeExec({ actor: AGENT_R1 }),
    )) as { status: string; intervention: Record<string, unknown>; event_id: string | null }

    expect(value.status).toBe('created')
    expect(value.intervention.origin).toBe('AGENT_REPORT')
    expect(value.intervention.status).toBe('OPEN')
    expect(value.intervention.title).toBe('误差预算冲突需要人工判断')
    expect(value.intervention.created_by).toEqual({ kind: 'AGENT', run_id: 'R-1', label: 'agent' })
    expect(typeof value.intervention.id).toBe('string')
    expect(value.intervention.id).toMatch(/^IV-[1-9][0-9]*$/)
    expect(value.event_id).toMatch(/^H-[1-9][0-9]*$/)

    // event-first: the frozen INTERVENTION_CREATED row exists with the AGENT actor + run
    const ev = harness.dbPair.store.listRange('WS-1', 1)[0]!
    expect(ev.eventType).toBe('INTERVENTION_CREATED')
    expect(ev.actor).toEqual({ kind: 'AGENT', run_id: 'R-1', label: 'agent' })
    // row-second + queue: the OPEN intervention is listed by the attention face
    const open = harness.service.listOpen()
    expect(open.map((r) => r.id)).toContain(value.intervention.id as string)

    // the port saw the parsed params + the TRUSTED actor (no session_id on the
    // MechanicalActorRef face; run_id/label from the call context, not args)
    expect(deps.interventionCreateCalls).toHaveLength(1)
    expect(deps.interventionCreateCalls[0].params).toEqual({
      title: '误差预算冲突需要人工判断',
      detail: 'FACT F-1 与计划假设矛盾',
      workstream_ids: ['WS-1'],
      source_refs: [{ kind: 'RUN', id: 'R-2' }],
    })
    expect(deps.interventionCreateCalls[0].actor).toEqual({ kind: 'AGENT', run_id: 'R-1', label: 'agent' })
  })

  it('optionalWS: no workstream association ⇒ row in the queue, NO event (TC-DOM-023, event_id null)', async () => {
    const { harness, tool } = setup()
    const value = (await tool.execute({ title: '跨项目资源冲突需人工裁决' }, makeExec({ actor: AGENT_R1 }))) as {
      status: string
      intervention: { workstream_ids: unknown[] }
      event_id: string | null
    }
    expect(value.status).toBe('created')
    expect(value.event_id).toBeNull()
    expect(value.intervention.workstream_ids).toEqual([])
    expect(harness.lifecycle.listInterventions()).toHaveLength(1)
    expect(harness.dbPair.store.listRange('WS-1', 1)).toHaveLength(0)
    expect(harness.dbPair.store.listRange('WS-2', 1)).toHaveLength(0)
  })

  it('multiWS: both ids ride the row, owner = the first WS', async () => {
    const { harness, tool } = setup()
    await tool.execute(
      { title: '两个工作流的排期冲突', workstream_ids: ['WS-2', 'WS-1'] },
      makeExec({ actor: AGENT_R1 }),
    )
    expect(harness.dbPair.store.listRange('WS-2', 1)).toHaveLength(1)
    expect(harness.dbPair.store.listRange('WS-1', 1)).toHaveLength(0)
  })

  it('a service rejection keeps the machine code: unknown WS ⇒ TOOL_SERVICE + serviceCode IV_INPUT', async () => {
    const { harness, deps, tool } = setup()
    const error = await expectToolErrorAsync(
      () => tool.execute({ title: 't', workstream_ids: ['WS-9'] }, makeExec({ actor: AGENT_R1 })),
      'TOOL_SERVICE',
    )
    expect(error.detail).toMatchObject({ serviceCode: 'IV_INPUT' })
    expect(error.message).toContain('[IV_INPUT]')
    expect(deps.interventionCreateCalls).toHaveLength(1) // the gate lives at the service, not a tool pre-filter
    expect(harness.lifecycle.listInterventions()).toHaveLength(0)
  })

  it('an invalid source ref (RUN not in the real run map) is refused with the machine code, zero writes', async () => {
    const { harness, tool } = setup()
    const error = await expectToolErrorAsync(
      () =>
        tool.execute(
          { title: 't', workstream_ids: ['WS-1'], source_refs: [{ kind: 'RUN', id: 'R-99' }] },
          makeExec({ actor: AGENT_R1 }),
        ),
      'TOOL_SERVICE',
    )
    expect(error.detail).toMatchObject({ serviceCode: 'IV_INPUT' })
    expect(error.message).toContain('[IV_INPUT]')
    expect(harness.lifecycle.listInterventions()).toHaveLength(0)
    expect(harness.dbPair.store.listRange('WS-1', 1)).toHaveLength(0)
  })
})

describe('research_intervention_create: the frozen face + gates hold on the now-live tool', () => {
  it('USER / PLUGIN actors are refused before the service (the tool face is the AGENT lane)', async () => {
    const { deps, tool } = setup()
    await expectToolErrorAsync(
      () => tool.execute({ title: 't' }, makeExec({ actor: { kind: 'USER', user_id: 'u-1' } })),
      'TOOL_ACTOR_FORBIDDEN',
    )
    await expectToolErrorAsync(
      () => tool.execute({ title: 't' }, makeExec({ actor: { kind: 'PLUGIN' } })),
      'TOOL_ACTOR_FORBIDDEN',
    )
    expect(deps.interventionCreateCalls).toHaveLength(0)
  })

  it('an AGENT actor without a formal run is refused (INV-PERM-1)', async () => {
    const { deps, tool } = setup()
    await expectToolErrorAsync(
      () => tool.execute({ title: 't' }, makeExec({ actor: { kind: 'AGENT', session_id: 's' } })),
      'TOOL_RUN_REQUIRED',
    )
    expect(deps.interventionCreateCalls).toHaveLength(0)
  })

  it('identity keys and unknown keys are refused at the wire (origin/actor are NOT arguments)', async () => {
    const { deps, tool } = setup()
    const e1 = await expectToolErrorAsync(
      () => tool.execute({ title: 't', actor: { kind: 'USER', user_id: 'u-root' } }, makeExec({ actor: AGENT_R1 })),
      'TOOL_INPUT',
    )
    expect(e1.message).toContain('/actor')
    const e2 = await expectToolErrorAsync(
      () => tool.execute({ title: 't', origin: 'USER' }, makeExec({ actor: AGENT_R1 })),
      'TOOL_INPUT',
    )
    expect(e2.message).toContain('/origin')
    expect(deps.interventionCreateCalls).toHaveLength(0)
  })

  it('wire-shape violations stay TOOL_INPUT (empty title, bad source ref kind)', async () => {
    const { deps, tool } = setup()
    const e1 = await expectToolErrorAsync(() => tool.execute({ title: '' }, makeExec({ actor: AGENT_R1 })), 'TOOL_INPUT')
    expect(e1.message).toContain('/title')
    const e2 = await expectToolErrorAsync(
      () => tool.execute({ title: 't', source_refs: [{ kind: 'NOPE', id: 'X-1' }] }, makeExec({ actor: AGENT_R1 })),
      'TOOL_INPUT',
    )
    expect(e2.message).toContain('/source_refs/0/kind')
    expect(deps.interventionCreateCalls).toHaveLength(0)
  })

  it('an aborted signal refuses before dispatch', async () => {
    const { deps, tool } = setup()
    await expectToolErrorAsync(() => tool.execute({ title: 't' }, makeExec({ aborted: true })), 'TOOL_ABORTED')
    expect(deps.interventionCreateCalls).toHaveLength(0)
  })
})
