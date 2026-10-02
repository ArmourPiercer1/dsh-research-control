/**
 * G1 (trusted boundary / lifecycle) — the `recordCheckpoint` same-run gate.
 *
 * Gap closed (BASELINE_PLAN §2c, parent review #3〔实证 `0fa2b1a`〕): the
 * surface only verified the actor KIND (USER-or-AGENT) + target-run
 * existence, so an AGENT reporter carrying run A could stamp a note onto
 * ANY other run B — the run attribution of the checkpoint report (the
 * agent's single Run lane, ARCHITECTURE §6 「Run 生命周期事件」,
 * INV-PERM-1) was not actually enforced at the trusted boundary.
 *
 * The gate (this file pins it):
 *  - target run existence is still checked FIRST (a wrong id →
 *    RB_RUN_NOT_FOUND — no oracle change for the USER lane);
 *  - an AGENT reporter must carry its OWN formal run_id and it must EQUAL
 *    the target run id — otherwise `RB_CHECKPOINT_FOREIGN_RUN` (a missing
 *    run_id counts as foreign: an unattributed AGENT cannot checkpoint);
 *  - the USER lane stays cross-run (GUI/ops note-taking is NOT tightened
 *    — §6.1 belongs to the user as much as to the agent);
 *  - NO RUNNING-only policy is invented: the existing semantics keep
 *    allowing terminal runs to receive notes (DOMAIN_SCHEMA §6.1 is
 *    status-agnostic; the plan pins 「不发明策略」).
 */
import { afterAll, describe, expect, it } from 'vitest'

import { queryEvents } from '../../src/host/history/replay/index.js'
import { RunBindingError } from '../../src/host/service/runbinding/index.js'
import { makeHarness, USER, type Harness } from './helpers.js'

const harnesses: Harness[] = []

function setup(): Harness {
  const h = makeHarness()
  harnesses.push(h)
  return h
}

afterAll(() => {
  for (const h of harnesses) h.close()
})

function expectRunBindingError(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (e) {
    if (!(e instanceof RunBindingError) || e.code !== code) {
      throw new Error(`expected RunBindingError ${code}, got ${e instanceof Error ? `${e.name}(${(e as RunBindingError).code ?? e.message})` : String(e)}`)
    }
    return
  }
  throw new Error(`expected RunBindingError ${code}, but the call succeeded`)
}

describe('G1 recordCheckpoint: the AGENT same-run equality gate', () => {
  it('positive preserved: an AGENT actor checkpoints its OWN run (row moves, no event)', () => {
    const h = setup()
    const { run } = h.service.registerRun({ workstreamId: 'WS-1' })

    const updated = h.service.recordCheckpoint(
      run.id,
      { note: '同 run 报告' },
      { kind: 'AGENT', run_id: run.id },
    )
    expect(updated.last_checkpoint_note).toBe('同 run 报告')
    expect(updated.last_checkpoint_at).toBeTypeOf('number')
    // still an operational note — the chronicle gained nothing beyond the
    // RUN_STARTED the registration itself wrote (run-crud.test.ts convention)
    expect(
      queryEvents(h.store, 'WS-1').events.filter((e) => e.eventType !== 'RUN_STARTED'),
    ).toHaveLength(0)
  })

  it('negative: AGENT(run-A) checkpointing run B is refused RB_CHECKPOINT_FOREIGN_RUN, B untouched', () => {
    const h = setup()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    const b = h.service.registerRun({ workstreamId: 'WS-2' })

    expectRunBindingError(
      () => h.service.recordCheckpoint(b.run.id, { note: '跨 run 伪造' }, { kind: 'AGENT', run_id: a.run.id }),
      'RB_CHECKPOINT_FOREIGN_RUN',
    )
    // the foreign row was NOT stamped (the rejection happens before the update)
    expect(h.service.getRun(b.run.id)!.last_checkpoint_at).toBeUndefined()
    expect(h.service.getRun(b.run.id)!.last_checkpoint_note).toBeUndefined()
  })

  it('an AGENT actor WITHOUT a run_id cannot checkpoint (an unattributed reporter is foreign)', () => {
    const h = setup()
    const { run } = h.service.registerRun({ workstreamId: 'WS-1' })
    expectRunBindingError(
      () => h.service.recordCheckpoint(run.id, { note: 'x' }, { kind: 'AGENT' } as never),
      'RB_CHECKPOINT_FOREIGN_RUN',
    )
  })

  it('the USER lane is NOT tightened: a USER actor stays cross-run', () => {
    const h = setup()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    const b = h.service.registerRun({ workstreamId: 'WS-2' })
    // USER notes any run (GUI lane, §6.1) — the gate is AGENT-only.
    const updated = h.service.recordCheckpoint(b.run.id, { note: '用户跨 run 备注' }, USER)
    expect(updated.last_checkpoint_note).toBe('用户跨 run 备注')
    void a
  })

  it('no RUNNING-only invention: a terminal run still accepts its OWN agent note and a USER note', () => {
    const h = setup()
    const { run } = h.service.registerRun({ workstreamId: 'WS-1' })
    h.service.finishRun(run.id, {}, USER)
    expect(h.service.getRun(run.id)!.status).toBe('FINISHED')

    const byAgent = h.service.recordCheckpoint(run.id, { note: '终态后同 run 补记' }, { kind: 'AGENT', run_id: run.id })
    expect(byAgent.last_checkpoint_note).toBe('终态后同 run 补记')
    const byUser = h.service.recordCheckpoint(run.id, { note: '终态后用户补记' }, USER)
    expect(byUser.last_checkpoint_note).toBe('终态后用户补记')
  })

  it('existence still fires FIRST: an unknown target run stays RB_RUN_NOT_FOUND for every lane', () => {
    const h = setup()
    const { run } = h.service.registerRun({ workstreamId: 'WS-1' })
    // same gate ordering for an AGENT (own-run actor, unknown target) …
    expectRunBindingError(
      () => h.service.recordCheckpoint('R-404', { note: 'x' }, { kind: 'AGENT', run_id: run.id }),
      'RB_RUN_NOT_FOUND',
    )
    // … and the historical USER behavior (default actor) is untouched.
    expectRunBindingError(() => h.service.recordCheckpoint('R-404'), 'RB_RUN_NOT_FOUND')
  })
})
