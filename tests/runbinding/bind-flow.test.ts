/**
 * WP-2.4 — BIND / DETACH / IGNORE full flows (DOMAIN_SCHEMA §6.2;
 * TC-DSH-001/003; ARCHITECTURE §6 matrix U column).
 *
 * Covered here:
 *  - the explicit BIND: PENDING → BOUND + formal Run + RUN_STARTED
 *    (workstream/task refs, session pointer, actor, event payload);
 *  - DETACH: PENDING → DETACHED, NO event, DSH session preserved,
 *    no re-discovery (TC-DSH-003);
 *  - IGNORE: PENDING → IGNORED, NO event, no re-discovery (TC-DSH-003);
 *  - the §6.2 scope rules on `registerRun` (RB_SESSION_IN_SCOPE /
 *    RB_SESSION_ALREADY_BOUND);
 *  - failure paths leave zero side effects (no rows, no events, no
 *    burned ids beyond the documented reservation burn on the event-
 *    committed residual — none of these paths reach ②).
 */
import { describe, expect, it } from 'vitest'

import { queryEvents } from '../../src/host/history/replay/index.js'
import {
  RunBindingError,
  type DiscoveredSessionRecord,
  type RunRecord,
} from '../../src/host/service/runbinding/index.js'
import { makeSession, makeHarness, seedPendingDs, USER, T0 } from './helpers.js'

function expectCode(e: unknown, code: string): asserts e is RunBindingError {
  if (!(e instanceof RunBindingError) || e.code !== code) {
    throw new Error(`expected RunBindingError(${code}), got ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
  }
}

describe('BIND (user explicit DiscoveredSession → formal Run)', () => {
  it('binds a PENDING DS: DS BOUND + run row + RUN_STARTED with the right payload', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'sess-bind-1', title: 'calibration attempt' })
    expect(ds.state).toBe('PENDING')

    const tBefore = h.now()
    const result = h.service.bindDiscoveredSession(ds.id, { workstreamId: 'WS-1', taskId: 'T-1', intent: 'calibrate' }, USER)

    // DS row: BOUND with the bound run id.
    expect(result.ds.state).toBe('BOUND')
    expect(result.ds.bound_run_id).toBe(result.run.id)
    expect(result.ds.dsh_session_id).toBe('sess-bind-1')
    expect(h.service.getDiscoveredSession(ds.id)?.state).toBe('BOUND')

    // Run row: formal, RUNNING, WS-bound, session pointer, initiator.
    expect(result.run.workstream_id).toBe('WS-1')
    expect(result.run.task_id).toBe('T-1')
    expect(result.run.dsh_session_id).toBe('sess-bind-1')
    expect(result.run.status).toBe('RUNNING')
    expect(result.run.intent).toBe('calibrate')
    expect(result.run.initiated_by).toEqual(USER)
    expect(result.run.started_at).toBeGreaterThanOrEqual(tBefore)
    expect(result.run.ended_at).toBeUndefined()
    expect(h.service.getRun(result.run.id)?.status).toBe('RUNNING')

    // The RUN_STARTED event (store-assigned seq/recordedAt).
    expect(result.event.eventType).toBe('RUN_STARTED')
    expect(result.event.ownerWorkstreamId).toBe('WS-1')
    expect(result.event.eventSeq).toBe(1)
    expect(result.event.schemaVersion).toBe(1)
    expect(result.event.occurredAt).toBeGreaterThanOrEqual(tBefore)
    expect(result.event.recordedAt).toBeGreaterThan(0)
    expect(result.event.payload).toMatchObject({
      run_id: result.run.id,
      task_id: 'T-1',
      dsh_session_id: 'sess-bind-1',
      intent: 'calibrate',
      initiated_by: USER,
    })
    expect(result.event.source).toEqual({ kind: 'DSH_SESSION', session_id: 'sess-bind-1' })
    h.close()
  })

  it('binds without task/intent (exploratory formal run, §6.1 task_id 可空)', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'sess-bind-2' })
    const result = h.service.bindDiscoveredSession(ds.id, { workstreamId: 'WS-2' })
    expect(result.run.task_id).toBeUndefined()
    expect(result.run.intent).toBeUndefined()
    expect(result.run.workstream_id).toBe('WS-2')
    expect(result.event.ownerWorkstreamId).toBe('WS-2')
    expect(result.event.eventSeq).toBe(1) // per-owner seq restarts
    expect(result.event.payload).not.toHaveProperty('task_id')
    expect(result.event.payload).not.toHaveProperty('intent')
    h.close()
  })

  it('rejects an unknown workstream before any side effect (no id burned)', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'sess-bind-3' })
    const hBefore = h.allocator.peek('HISTORY_EVENT', 'PRJ-1')
    const rBefore = h.allocator.peek('RUN', 'PRJ-1')
    try {
      h.service.bindDiscoveredSession(ds.id, { workstreamId: 'WS-99' })
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_WORKSTREAM_NOT_FOUND')
    }
    expect(h.allocator.peek('HISTORY_EVENT', 'PRJ-1')).toBe(hBefore)
    expect(h.allocator.peek('RUN', 'PRJ-1')).toBe(rBefore)
    expect(h.service.listRuns()).toHaveLength(0)
    expect(queryEvents(h.store, 'WS-1').events).toHaveLength(0)
    expect(h.service.getDiscoveredSession(ds.id)?.state).toBe('PENDING')
    h.close()
  })

  it('rejects a task from a different workstream (catalog §5.1: 属同 WS)', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'sess-bind-4' })
    try {
      h.service.bindDiscoveredSession(ds.id, { workstreamId: 'WS-1', taskId: 'T-2' })
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_TASK_WS_MISMATCH')
    }
    expect(h.service.listRuns()).toHaveLength(0)
    h.close()
  })

  it('rejects a nonexistent task', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'sess-bind-5' })
    try {
      h.service.bindDiscoveredSession(ds.id, { workstreamId: 'WS-1', taskId: 'T-99' })
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_TASK_NOT_FOUND')
    }
    expect(h.service.listRuns()).toHaveLength(0)
    h.close()
  })

  it('rejects a missing DS row', () => {
    const h = makeHarness()
    try {
      h.service.bindDiscoveredSession('DS-1', { workstreamId: 'WS-1' })
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_DS_NOT_FOUND')
    }
    h.close()
  })

  it('rejects a non-USER actor (runtime forgery of the type gate)', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'sess-bind-6' })
    const forged = { kind: 'AGENT', run_id: 'R-1' } as const
    try {
      h.service.bindDiscoveredSession(ds.id, { workstreamId: 'WS-1' }, forged as never)
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_ACTOR_FORBIDDEN')
    }
    expect(h.service.getDiscoveredSession(ds.id)?.state).toBe('PENDING')
    h.close()
  })

  it('rejects a second bind (DS state machine: BOUND is terminal)', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'sess-bind-7' })
    h.service.bindDiscoveredSession(ds.id, { workstreamId: 'WS-1' })
    try {
      h.service.bindDiscoveredSession(ds.id, { workstreamId: 'WS-2' })
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_DS_NOT_PENDING')
    }
    // The original binding is untouched.
    expect(h.service.getDiscoveredSession(ds.id)?.state).toBe('BOUND')
    expect(h.service.listRuns()).toHaveLength(1)
    h.close()
  })

  it('one DS : one run — a PENDING DS never carries a run row', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'sess-bind-8' })
    expect(h.db.tables.getRunBySessionId(ds.dsh_session_id)).toBeNull()
    h.close()
  })
})

describe('DETACH (PENDING → DETACHED; 移出范围, 原 DSH session 保留)', () => {
  it('detaches without any event and keeps the DSH session (TC-DSH-003)', () => {
    const h = makeHarness()
    const adapter = makeAdapterWith(h, 'sess-detach-1')
    const ds = seedPendingDs(h, { sessionId: 'sess-detach-1' })
    const before = h.service.reconcileSessions(adapter.listSessions()).length

    const updated = h.service.detachDiscoveredSession(ds.id, USER)
    expect(updated.state).toBe('DETACHED')
    expect(updated.bound_run_id).toBeUndefined()
    expect(h.service.listRuns()).toHaveLength(0)
    expect(queryEvents(h.store, 'WS-1').events).toHaveLength(0) // NO event

    // No re-discovery: reconcile again — nothing new, row stays DETACHED.
    const again = h.service.reconcileSessions(adapter.listSessions())
    expect(again).toHaveLength(0)
    expect(before).toBe(0)
    expect(h.service.getDiscoveredSession(ds.id)?.state).toBe('DETACHED')
    // The DSH session itself is preserved (the adapter's list is untouched).
    expect(adapter.sessions.map((s) => s.id)).toContain('sess-detach-1')
    h.close()
  })

  it('rejects detach on a non-PENDING DS (all three terminals)', () => {
    const h = makeHarness()
    const bound = seedPendingDs(h, { sessionId: 'sess-detach-b' })
    h.service.bindDiscoveredSession(bound.id, { workstreamId: 'WS-1' })
    const ignored = seedPendingDs(h, { sessionId: 'sess-detach-i' })
    h.service.ignoreDiscoveredSession(ignored.id)
    const detached = seedPendingDs(h, { sessionId: 'sess-detach-d' })
    h.service.detachDiscoveredSession(detached.id)
    for (const id of [bound.id, ignored.id, detached.id]) {
      try {
        h.service.detachDiscoveredSession(id)
        throw new Error('expected rejection')
      } catch (e) {
        expectCode(e, 'RB_DS_NOT_PENDING')
      }
    }
    h.close()
  })

  it('rejects detach of a missing DS and a forged actor', () => {
    const h = makeHarness()
    try {
      h.service.detachDiscoveredSession('DS-404')
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_DS_NOT_FOUND')
    }
    const ds = seedPendingDs(h, { sessionId: 'sess-detach-f' })
    try {
      h.service.detachDiscoveredSession(ds.id, { kind: 'PLUGIN' } as never)
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_ACTOR_FORBIDDEN')
    }
    h.close()
  })
})

describe('IGNORE (PENDING → IGNORED; 防重复发现)', () => {
  it('ignores without any event and never re-discovers (TC-DSH-003)', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'sess-ignore-1' })
    const updated = h.service.ignoreDiscoveredSession(ds.id, USER)
    expect(updated.state).toBe('IGNORED')
    expect(queryEvents(h.store, 'WS-1').events).toHaveLength(0) // NO event
    expect(h.service.reconcileSessions([makeSession({ id: 'sess-ignore-1', cwd: h.rootA })])).toHaveLength(0)
    expect(h.service.getDiscoveredSession(ds.id)?.state).toBe('IGNORED')
    h.close()
  })

  it('rejects ignore on a BOUND DS', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'sess-ignore-2' })
    h.service.bindDiscoveredSession(ds.id, { workstreamId: 'WS-1' })
    try {
      h.service.ignoreDiscoveredSession(ds.id)
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_DS_NOT_PENDING')
    }
    h.close()
  })
})

describe('registerRun (manual formal-Run registration, matrix U 手工登记)', () => {
  it('registers a run without a DS (no session pointer)', () => {
    const h = makeHarness()
    const result = h.service.registerRun({ workstreamId: 'WS-1', intent: 'manual' })
    expect(result.run.status).toBe('RUNNING')
    expect(result.run.dsh_session_id).toBeUndefined()
    expect(result.event.eventType).toBe('RUN_STARTED')
    expect(result.event.source).toBeUndefined()
    h.close()
  })

  it('registers a run with an EXTERNAL session pointer (no DS row)', () => {
    const h = makeHarness()
    const result = h.service.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-external-1' })
    expect(result.run.dsh_session_id).toBe('sess-external-1')
    expect(result.event.source).toEqual({ kind: 'DSH_SESSION', session_id: 'sess-external-1' })
    h.close()
  })

  it('refuses a session that is already in the DS scope (any state)', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'sess-scope-1' })
    try {
      h.service.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-scope-1' })
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_SESSION_IN_SCOPE')
    }
    // …and still refuses after the DS leaves PENDING (terminals persist).
    h.service.ignoreDiscoveredSession(ds.id)
    try {
      h.service.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-scope-1' })
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_SESSION_IN_SCOPE')
    }
    h.close()
  })

  it('refuses a second run for the same external session (one run per session)', () => {
    const h = makeHarness()
    h.service.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-ext-2' })
    try {
      h.service.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-ext-2' })
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_SESSION_ALREADY_BOUND')
    }
    h.close()
  })
})

/* ------------------------------------------------------------------ *
 * helper: a FakeSessionAdapter holding one in-root session
 * ------------------------------------------------------------------ */
import { FakeSessionAdapter } from './helpers.js'

function makeAdapterWith(h: ReturnType<typeof makeHarness>, sessionId: string, cwd?: string): FakeSessionAdapter {
  const adapter = new FakeSessionAdapter([makeSession({ id: sessionId, cwd: cwd ?? h.rootA })])
  return adapter
}
