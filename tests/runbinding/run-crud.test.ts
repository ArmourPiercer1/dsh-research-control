/**
 * WP-2.4 — Run record CRUD + the §13 L549 Run state machine
 * (`RUNNING → FINISHED | FAILED | CANCELLED`, terminal).
 *
 * CRUD: Create via `registerRun` / `bindDiscoveredSession` (both
 * RUN_STARTED); Read via `getRun` / `listRuns` (filters); Update via
 * the three terminal operations + `recordCheckpoint` (§6.1
 * last_checkpoint_* — the future agent-tool backing); **Delete does
 * not exist** (INV-HIST-7: no hard delete of identity rows — the
 * type surface is audited below).
 *
 * State machine: the FULL 4×4 matrix is exercised through the service
 * (every terminal on a RUNNING run succeeds exactly once; every
 * operation on a terminal run is rejected with RB_RUN_NOT_RUNNING;
 * the sequential double-end is gated by the pre-check AND by the
 * conditional row update).
 */
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

import { queryEvents } from '../../src/host/history/replay/index.js'
import { RunBindingError, RunBindingService } from '../../src/host/service/runbinding/index.js'
import { makeHarness, USER } from './helpers.js'

function expectCode(e: unknown, code: string): asserts e is RunBindingError {
  if (!(e instanceof RunBindingError) || e.code !== code) {
    throw new Error(`expected RunBindingError(${code}), got ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
  }
}

describe('Run CRUD', () => {
  it('getRun returns null for unknown ids; listRuns reflects creates', () => {
    const h = makeHarness()
    expect(h.service.getRun('R-1')).toBeNull()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    const b = h.service.registerRun({ workstreamId: 'WS-2' })
    expect(h.service.getRun(a.run.id)?.id).toBe(a.run.id)
    expect(h.service.getRun(b.run.id)?.id).toBe(b.run.id)
    expect(h.service.listRuns().map((r) => r.id).sort()).toEqual([a.run.id, b.run.id].sort())
    h.close()
  })

  it('listRuns filters by workstream / status / dshSessionId', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-f-a' })
    const b = h.service.registerRun({ workstreamId: 'WS-2' })
    h.service.finishRun(b.run.id, { outcomeSummary: 'done' })
    expect(h.service.listRuns({ workstreamId: 'WS-1' }).map((r) => r.id)).toEqual([a.run.id])
    expect(h.service.listRuns({ status: 'FINISHED' }).map((r) => r.id)).toEqual([b.run.id])
    expect(h.service.listRuns({ status: 'RUNNING' }).map((r) => r.id)).toEqual([a.run.id])
    expect(h.service.listRuns({ dshSessionId: 'sess-f-a' }).map((r) => r.id)).toEqual([a.run.id])
    expect(h.service.listRuns({ workstreamId: 'WS-1', status: 'FINISHED' })).toHaveLength(0)
    h.close()
  })

  it('getRunBySessionId finds the run through the dsh_session_id index', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-idx-1' })
    expect(h.db.tables.getRunBySessionId('sess-idx-1')?.id).toBe(a.run.id)
    expect(h.db.tables.getRunBySessionId('sess-none')).toBeNull()
    h.close()
  })

  it('CRUD has no DELETE surface (INV-HIST-7 — the type face audit)', () => {
    const methods = Object.getOwnPropertyNames(RunBindingService.prototype).filter((n) => n !== 'constructor')
    for (const name of methods) {
      expect(/^(delete|remove|drop|hardDelete)/i.test(name), `unexpected delete-like method ${name}`).toBe(false)
    }
    // Storage level: raw DELETE is trigger-ABORTed even on a direct connection.
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    expect(() => {
      // A second raw connection (the service's own is owned; this is the
      // storage-level guard under test).
      const raw = new DatabaseSync(h.db.store.path)
      try {
        raw.exec(`DELETE FROM run WHERE run_id = '${a.run.id}'`)
      } finally {
        raw.close()
      }
    }).toThrowError(/INV-HIST-7/)
    // The row survives.
    expect(h.service.getRun(a.run.id)?.id).toBe(a.run.id)
    h.close()
  })

  it('recordCheckpoint updates last_checkpoint_* without any event', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    const tBefore = h.now()
    const updated = h.service.recordCheckpoint(a.run.id, { note: 'calib stage 2 complete' }, USER)
    expect(updated.last_checkpoint_at).toBeGreaterThanOrEqual(tBefore)
    expect(updated.last_checkpoint_note).toBe('calib stage 2 complete')
    expect(h.service.getRun(a.run.id)?.last_checkpoint_note).toBe('calib stage 2 complete')
    // No event was produced (a checkpoint is an operational note).
    expect(queryEvents(h.store, 'WS-1').events.filter((e) => e.eventType !== 'RUN_STARTED')).toHaveLength(0)
    // Missing run is rejected.
    try {
      h.service.recordCheckpoint('R-404')
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_RUN_NOT_FOUND')
    }
    h.close()
  })

  it('recordCheckpoint rejects non USER/AGENT actors (matrix row: agent lane = checkpoint 报告)', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    try {
      h.service.recordCheckpoint(a.run.id, { note: 'x' }, { kind: 'PLUGIN' } as never)
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_ACTOR_FORBIDDEN')
    }
    h.close()
  })
})

describe('Run state machine (§13 L549: RUNNING → FINISHED|FAILED|CANCELLED, terminal)', () => {
  it('a RUNNING run can finish; the row + event carry the end', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    const tBefore = h.now()
    const result = h.service.finishRun(a.run.id, { outcomeSummary: 'all done' }, USER)
    expect(result.run.status).toBe('FINISHED')
    expect(result.run.ended_at).toBeGreaterThanOrEqual(tBefore)
    expect(result.run.summary).toBe('all done')
    expect(result.event.eventType).toBe('RUN_FINISHED')
    expect(result.event.payload).toEqual({ run_id: a.run.id, outcome_summary: 'all done' })
    expect(h.service.getRun(a.run.id)?.status).toBe('FINISHED')
    h.close()
  })

  it('a RUNNING run can fail with error_summary + failure_kind', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    const result = h.service.failRun(a.run.id, { errorSummary: 'OOM at epoch 12', failureKind: 'OOM' }, USER)
    expect(result.run.status).toBe('FAILED')
    expect(result.event.payload).toEqual({ run_id: a.run.id, error_summary: 'OOM at epoch 12', failure_kind: 'OOM' })
    h.close()
  })

  it('a RUNNING run can be cancelled; cancelled_by = the actor', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    const result = h.service.cancelRun(a.run.id, { reason: 'user stopped' }, USER)
    expect(result.run.status).toBe('CANCELLED')
    expect(result.event.payload).toEqual({
      run_id: a.run.id,
      reason: 'user stopped',
      cancelled_by: USER,
    })
    h.close()
  })

  it('every terminal is terminal: the FULL 4×4 matrix through the service', () => {
    const h = makeHarness()
    // Legals: RUNNING → each of the three terminals.
    for (const [op, status, type] of [
      ['finish', 'FINISHED', 'RUN_FINISHED'],
      ['fail', 'FAILED', 'RUN_FAILED'],
      ['cancel', 'CANCELLED', 'RUN_CANCELLED'],
    ] as const) {
      const fresh = makeHarness()
      const a = fresh.service.registerRun({ workstreamId: 'WS-1' })
      if (op === 'finish') fresh.service.finishRun(a.run.id)
      if (op === 'fail') fresh.service.failRun(a.run.id)
      if (op === 'cancel') fresh.service.cancelRun(a.run.id)
      const terminal = fresh.service.getRun(a.run.id)!
      expect(terminal.status).toBe(status)
      expect(queryEvents(fresh.store, 'WS-1').events.map((e) => e.eventType)).toEqual(['RUN_STARTED', type])
      // Illegals: the SAME terminal run rejects all three end operations.
      for (const end of ['finish', 'fail', 'cancel'] as const) {
        try {
          if (end === 'finish') fresh.service.finishRun(a.run.id)
          if (end === 'fail') fresh.service.failRun(a.run.id)
          if (end === 'cancel') fresh.service.cancelRun(a.run.id)
          throw new Error(`expected ${end} on ${status} to be rejected`)
        } catch (e) {
          expectCode(e, 'RB_RUN_NOT_RUNNING')
        }
      }
      // The status is unchanged after the rejections.
      expect(fresh.service.getRun(a.run.id)?.status).toBe(status)
      fresh.close()
    }
    h.close()
  })

  it('ending a missing run is rejected (RB_RUN_NOT_FOUND)', () => {
    const h = makeHarness()
    for (const [end, args] of [
      ['finish', {}],
      ['fail', {}],
      ['cancel', {}],
    ] as const) {
      try {
        if (end === 'finish') h.service.finishRun('R-404', args)
        if (end === 'fail') h.service.failRun('R-404', args)
        if (end === 'cancel') h.service.cancelRun('R-404', args)
        throw new Error('expected rejection')
      } catch (e) {
        expectCode(e, 'RB_RUN_NOT_FOUND')
      }
    }
    h.close()
  })

  it('the conditional row update is the concurrency gate (WHERE status=RUNNING)', () => {
    // Direct table-level proof: a terminal update on a non-RUNNING row
    // affects 0 rows even when the run id exists.
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    expect(h.db.tables.updateRunStatus(a.run.id, 'FINISHED', h.now())).toBe(1)
    expect(h.db.tables.updateRunStatus(a.run.id, 'CANCELLED', h.now())).toBe(0)
    h.close()
  })
})
