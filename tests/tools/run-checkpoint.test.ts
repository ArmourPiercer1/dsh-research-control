/**
 * WP-3.3 — research_run_checkpoint forwarding fidelity (task goal 3:
 * 「已实现的服务直接转发（checkpoint 报告类转发 runbinding recordCheckpoint
 * 面）」; ARCHITECTURE §6 矩阵行「Run 生命周期事件」— the agent's single
 * Run lane is the checkpoint report, INV-PERM-1).
 *
 * The deps port is the REAL `RunBindingService.recordCheckpoint` (the
 * WP-2.4 harness: real research.sqlite, real registry, real tables), so
 * the forwarding is proven end-to-end: args → service → row update →
 * the returned frozen run row.
 */

import { afterAll, describe, expect, it } from 'vitest'

import {
  RESEARCH_RUN_CHECKPOINT,
  createResearchTools,
} from '../../src/host/tools/index.js'
import { AGENT, expectToolErrorAsync, makeExec, makeRecordingDeps } from './fixtures.js'
import { makeHarness, type Harness } from '../runbinding/helpers.js'

const harnesses: Harness[] = []

function setup() {
  const harness = makeHarness()
  harnesses.push(harness)
  const deps = makeRecordingDeps()
  // The REAL WP-2.4 surface (the operational last_checkpoint_* backing).
  deps.setRecordCheckpoint((runId, params, actor) => harness.service.recordCheckpoint(runId, params, actor))
  const tool = createResearchTools(deps).find((t) => t.name === RESEARCH_RUN_CHECKPOINT)!
  return { harness, deps, tool }
}

afterAll(() => {
  for (const h of harnesses) h.close()
})

describe('research_run_checkpoint: forwarding to the real recordCheckpoint surface', () => {
  it('a checkpoint report updates the run row and returns the frozen record', async () => {
    const { harness, deps, tool } = setup()
    const { run } = harness.service.registerRun({ workstreamId: 'WS-1' })

    const result = (await tool.execute({ run_id: run.id, note: '误差预算复算脚本完成' }, makeExec({ actor: AGENT }))) as {
      status: string
      run: Record<string, unknown>
    }

    expect(result.status).toBe('ok')
    expect(result.run.id).toBe(run.id)
    expect(result.run.last_checkpoint_note).toBe('误差预算复算脚本完成')
    expect(result.run.last_checkpoint_at).toBeTypeOf('number')
    // the service was called once, with the parsed args and the AGENT reporter
    expect(deps.recordCheckpointCalls).toHaveLength(1)
    expect(deps.recordCheckpointCalls[0].runId).toBe(run.id)
    expect(deps.recordCheckpointCalls[0].params).toEqual({ note: '误差预算复算脚本完成' })
    expect(deps.recordCheckpointCalls[0].actor).toMatchObject({ kind: 'AGENT', run_id: 'R-81' })
    // the row really moved (the service state, not just the return value)
    const stored = harness.service.getRun(run.id)!
    expect(stored.last_checkpoint_note).toBe('误差预算复算脚本完成')
  })

  it('note is optional (omitted → no note forwarded, at set)', async () => {
    const { harness, deps, tool } = setup()
    const { run } = harness.service.registerRun({ workstreamId: 'WS-1' })

    const result = (await tool.execute({ run_id: run.id }, makeExec({ actor: AGENT }))) as {
      status: string
      run: Record<string, unknown>
    }
    expect(result.status).toBe('ok')
    expect(deps.recordCheckpointCalls[0].params).toEqual({})
    expect(result.run.last_checkpoint_at).toBeTypeOf('number')
    expect(harness.service.getRun(run.id)!.last_checkpoint_note).toBeUndefined()
  })

  it('an unknown run surfaces the service code (RB_RUN_NOT_FOUND) as TOOL_SERVICE', async () => {
    const { tool } = setup()
    const error = await expectToolErrorAsync(
      () => tool.execute({ run_id: 'R-999' }, makeExec({ actor: AGENT })),
      'TOOL_SERVICE',
    )
    expect(error.detail).toMatchObject({ serviceCode: 'RB_RUN_NOT_FOUND' })
  })

  it('an empty run_id is refused at the wire (TOOL_INPUT, before the service)', async () => {
    const { deps, tool } = setup()
    const error = await expectToolErrorAsync(
      () => tool.execute({ run_id: '' }, makeExec({ actor: AGENT })),
      'TOOL_INPUT',
    )
    expect(error.message).toContain('/run_id')
    expect(deps.recordCheckpointCalls).toHaveLength(0)
  })

  it('an unknown argument key is refused at the wire', async () => {
    const { deps, tool } = setup()
    const error = await expectToolErrorAsync(
      () => tool.execute({ run_id: 'R-1', extra: 1 }, makeExec({ actor: AGENT })),
      'TOOL_INPUT',
    )
    expect(error.message).toContain('/extra')
    expect(deps.recordCheckpointCalls).toHaveLength(0)
  })

  it('an aborted signal refuses before dispatch', async () => {
    const { deps, tool } = setup()
    await expectToolErrorAsync(() => tool.execute({ run_id: 'R-1' }, makeExec({ aborted: true })), 'TOOL_ABORTED')
    expect(deps.recordCheckpointCalls).toHaveLength(0)
  })
})

describe('research_run_checkpoint: permission gate (the tool face is agent-only)', () => {
  it('a USER actor is refused although the service itself accepts USER (the tool surface is the agent lane)', async () => {
    const { deps, tool } = setup()
    await expectToolErrorAsync(
      () => tool.execute({ run_id: 'R-1' }, makeExec({ actor: { kind: 'USER', user_id: 'u-1' } })),
      'TOOL_ACTOR_FORBIDDEN',
    )
    expect(deps.recordCheckpointCalls).toHaveLength(0)
  })

  it('a PLUGIN actor is refused (the matrix gives the plugin its own service lane, not the tool face)', async () => {
    const { tool } = setup()
    await expectToolErrorAsync(
      () => tool.execute({ run_id: 'R-1' }, makeExec({ actor: { kind: 'PLUGIN' } })),
      'TOOL_ACTOR_FORBIDDEN',
    )
  })

  it('an AGENT actor without a run_id is refused (INV-PERM-1)', async () => {
    const { tool } = setup()
    await expectToolErrorAsync(
      () => tool.execute({ run_id: 'R-1' }, makeExec({ actor: { kind: 'AGENT', session_id: 's' } })),
      'TOOL_RUN_REQUIRED',
    )
  })
})
