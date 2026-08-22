/**
 * WP-2.6 — `SessionLinkService` over a REAL operational store (node:sqlite)
 * + the REAL frozen registry: wiring, idempotency (constraint + rejection
 * path), the INV-DB-2 pointer table, the crash-window reconciliation, and
 * the full session→History round trip (TC-DSH-004).
 */

import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { readDerivedState } from '../../src/host/history/replay/index.js'
import {
  ACTOR_LABEL,
  isSessionLinkError,
  pointerKey,
  SessionLinkError,
  SessionLinkService,
} from '../../src/host/service/sessionlink/index.js'
import type { ResearchStore } from '../../src/host/persistence/store/index.js'
import {
  FakeSessionAdapter,
  makeAllocator,
  makeRegistry,
  makeStore,
  PROJECT_ID,
  WORKSTREAMS,
} from './fixtures.js'

const T0 = 1_750_000_000_000

interface Harness {
  store: ResearchStore
  adapter: FakeSessionAdapter
  service: SessionLinkService
}

function makeHarness(): Harness {
  const store = makeStore()
  const adapter = new FakeSessionAdapter()
  const service = new SessionLinkService({
    store,
    registry: makeRegistry(),
    adapter,
    ids: makeAllocator(store),
    projectId: PROJECT_ID,
    workstreams: WORKSTREAMS,
    now: () => T0,
  })
  return { store, adapter, service }
}

/** The event rows of WS-1 in audit order. */
function wsEvents(store: ResearchStore) {
  return [...store.listRange('WS-1', 1)]
}

/** Run `fn`, returning the thrown value (the repo's toThrow takes a CLASS,
 *  not a predicate; code-level checks need the error value itself). */
function throws(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('expected the call to throw, but it returned')
}

describe('wireSession — pointer table + idempotency + rejection path', () => {
  it('creates the pointer row (INV-DB-2 shape: binding + seq pointer only)', () => {
    const { store, service } = makeHarness()
    const result = service.wireSession('sess-1', { workstreamId: 'WS-1', intent: '复现实验', taskId: 'T-7' })
    expect(result).toEqual({ status: 'wired' })
    const raw = store.meta().get(pointerKey('sess-1'))
    expect(raw).not.toBeNull()
    const pointer = JSON.parse(String(raw))
    expect(pointer).toEqual({ workstreamId: 'WS-1', intent: '复现实验', taskId: 'T-7', lastSeq: 0, runId: null, runStartedAt: null })
    expect(service.pointerOf('sess-1')).toEqual({
      workstreamId: 'WS-1',
      intent: '复现实验',
      taskId: 'T-7',
      lastSeq: 0,
      runId: null,
      runStartedAt: null,
    })
  })

  it('a repeat wireSession (same binding) is a no-op: already-wired, no new row, no events', () => {
    const { store, adapter, service } = makeHarness()
    service.start()
    const first = service.wireSession('sess-1', { workstreamId: 'WS-1' })
    const second = service.wireSession('sess-1', { workstreamId: 'WS-1' })
    expect(first).toEqual({ status: 'wired' })
    expect(second).toMatchObject({ status: 'already-wired' })
    if (second.status === 'already-wired') {
      expect(second.pointer.workstreamId).toBe('WS-1')
    }
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 1 })
    adapter.emit({ sessionId: 'sess-1', type: 'turn/end', seq: 2 })
    // exactly the two lifecycle events — the re-wire produced nothing extra
    expect(wsEvents(store)).toHaveLength(2)
  })

  it('REJECTION PATH: a different workstream for a bound session → BINDING_CONFLICT', () => {
    const { store, service } = makeHarness()
    service.wireSession('sess-1', { workstreamId: 'WS-1' })
    const e = throws(() => service.wireSession('sess-1', { workstreamId: 'WS-2' }))
    expect(isSessionLinkError(e)).toBe(true)
    expect(e).toBeInstanceOf(SessionLinkError)
    expect((e as SessionLinkError).code).toBe('BINDING_CONFLICT')
    // the original pointer is untouched
    expect(service.pointerOf('sess-1')?.workstreamId).toBe('WS-1')
    void store
  })

  it('REJECTION PATH: an unknown workstream → WORKSTREAM_NOT_FOUND', () => {
    const { service } = makeHarness()
    const e = throws(() => service.wireSession('sess-1', { workstreamId: 'WS-9' }))
    expect(isSessionLinkError(e)).toBe(true)
    expect((e as SessionLinkError).code).toBe('WORKSTREAM_NOT_FOUND')
    expect(service.pointerOf('sess-1')).toBeNull()
  })
})

describe('the session→History round trip (TC-DSH-004)', () => {
  it('turn/start → RUN_STARTED (envelope + RUN row + pointer, all exact)', () => {
    const { store, adapter, service } = makeHarness()
    service.wireSession('sess-1', { workstreamId: 'WS-1' })
    const dispose = service.start()
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 1 })

    const events = wsEvents(store)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventId: 'H-1',
      ownerWorkstreamId: 'WS-1',
      eventSeq: 1,
      eventType: 'RUN_STARTED',
      schemaVersion: 1,
      occurredAt: T0,
      actor: { kind: 'PLUGIN', session_id: 'sess-1', label: ACTOR_LABEL },
      source: { kind: 'DSH_SESSION', session_id: 'sess-1' },
      payload: {
        run_id: 'R-1',
        dsh_session_id: 'sess-1',
        initiated_by: { kind: 'USER', session_id: 'sess-1' },
      },
    })
    expect(Number.isSafeInteger(events[0].recordedAt)).toBe(true)
    expect(events[0].recordedAt).toBeGreaterThan(0)

    expect(service.pointerOf('sess-1')).toEqual({
      workstreamId: 'WS-1',
      lastSeq: 1,
      runId: 'R-1',
      runStartedAt: T0,
    })
    dispose()
  })

  it('turn/end → RUN_FINISHED (run FINISHED, pointer closed)', () => {
    const { store, adapter, service } = makeHarness()
    service.wireSession('sess-1', { workstreamId: 'WS-1' })
    service.start()
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 1 })
    adapter.emit({ sessionId: 'sess-1', type: 'turn/end', seq: 2 })

    const events = wsEvents(store)
    expect(events.map((e) => `${e.eventType}:${e.eventSeq}`)).toEqual(['RUN_STARTED:1', 'RUN_FINISHED:2'])
    expect(events[1].payload).toEqual({ run_id: 'R-1' })
    expect(service.pointerOf('sess-1')).toEqual({ workstreamId: 'WS-1', lastSeq: 2, runId: null, runStartedAt: null })
  })

  it('two turns → two runs; seqs strictly 1..4; RUN derived rows per run', () => {
    const { store, adapter, service } = makeHarness()
    service.wireSession('sess-1', { workstreamId: 'WS-1' })
    service.start()
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 1 })
    adapter.emit({ sessionId: 'sess-1', type: 'turn/end', seq: 2 })
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 3 })
    adapter.emit({ sessionId: 'sess-1', type: 'turn/end', seq: 4 })

    const events = wsEvents(store)
    expect(events.map((e) => `${e.eventType}:${e.eventSeq}`)).toEqual([
      'RUN_STARTED:1',
      'RUN_FINISHED:2',
      'RUN_STARTED:3',
      'RUN_FINISHED:4',
    ])
    expect(events[2].payload.run_id).toBe('R-2')
    expect(events[3].payload.run_id).toBe('R-2')

    // the RUN derived rows (read through the WP-2.3 read-only face)
    const derived = readDerivedState(store)
    expect((derived.get('RUN:R-1') as { status: string }).status).toBe('FINISHED')
    expect((derived.get('RUN:R-2') as { status: string }).status).toBe('FINISHED')
  })

  it('the session/disposed lifecycle edge force-finishes an open run (with the mechanical note)', () => {
    const { store, adapter, service } = makeHarness()
    service.wireSession('sess-1', { workstreamId: 'WS-1' })
    service.start()
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 1 })
    adapter.emitLifecycle({ kind: 'disposed', sessionId: 'sess-1' })

    const events = wsEvents(store)
    expect(events.map((e) => e.eventType)).toEqual(['RUN_STARTED', 'RUN_FINISHED'])
    expect(events[1].payload).toEqual({ run_id: 'R-1', outcome_summary: 'session disposed with open turn' })
    expect(service.pointerOf('sess-1')?.runId).toBeNull()
  })

  it('unwired sessions are ignored (no event, no error — runbinding territory)', () => {
    const { store, adapter, service } = makeHarness()
    service.start()
    adapter.emit({ sessionId: 'sess-other', type: 'turn/start', seq: 1 })
    adapter.emitLifecycle({ kind: 'disposed', sessionId: 'sess-other' })
    expect(wsEvents(store)).toHaveLength(0)
  })

  it('two sessions on one service stay independent (separate runs + pointers)', () => {
    const { store, adapter, service } = makeHarness()
    service.wireSession('sess-1', { workstreamId: 'WS-1' })
    service.wireSession('sess-2', { workstreamId: 'WS-1' })
    service.start()
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 1 })
    adapter.emit({ sessionId: 'sess-2', type: 'turn/start', seq: 1 })
    adapter.emit({ sessionId: 'sess-1', type: 'turn/end', seq: 2 })
    adapter.emit({ sessionId: 'sess-2', type: 'turn/end', seq: 2 })

    const events = wsEvents(store)
    expect(events.map((e) => `${e.eventType}:${e.payload.run_id as string}`)).toEqual([
      'RUN_STARTED:R-1',
      'RUN_STARTED:R-2',
      'RUN_FINISHED:R-1',
      'RUN_FINISHED:R-2',
    ])
    expect(service.pointerOf('sess-1')?.runId).toBeNull()
    expect(service.pointerOf('sess-2')?.runId).toBeNull()
  })

  it('the disposer stops the feed (no further events after dispose)', () => {
    const { store, adapter, service } = makeHarness()
    service.wireSession('sess-1', { workstreamId: 'WS-1' })
    const dispose = service.start()
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 1 })
    dispose()
    adapter.emit({ sessionId: 'sess-1', type: 'turn/end', seq: 2 })
    expect(wsEvents(store).map((e) => e.eventType)).toEqual(['RUN_STARTED'])
  })
})

describe('idempotency — the constraint (seq gate)', () => {
  it('re-delivery of an already-consumed edge produces NOTHING', () => {
    const { store, adapter, service } = makeHarness()
    service.wireSession('sess-1', { workstreamId: 'WS-1' })
    service.start()
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 1 })
    adapter.emit({ sessionId: 'sess-1', type: 'turn/end', seq: 2 })
    // duplicates + lower seqs (at-least-once feed)
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 1 })
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 1 })
    adapter.emit({ sessionId: 'sess-1', type: 'turn/end', seq: 2 })
    adapter.emit({ sessionId: 'sess-1', type: 'user/message', seq: 5 }) // no-op edge, also re-delivered
    adapter.emit({ sessionId: 'sess-1', type: 'user/message', seq: 5 })
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 6 })
    expect(wsEvents(store).map((e) => `${e.eventType}:${e.eventSeq}`)).toEqual([
      'RUN_STARTED:1',
      'RUN_FINISHED:2',
      'RUN_STARTED:3',
    ])
    expect(service.pointerOf('sess-1')?.runId).toBe('R-2')
    expect(service.pointerOf('sess-1')?.lastSeq).toBe(6)
  })
})

describe('idempotency — the rejection path (registry gate)', () => {
  it('REJECTION PATH: a finish whose run vanished from derived state → VALIDATION_REJECTED, zero side effects', () => {
    const { store, adapter, service } = makeHarness()
    service.wireSession('sess-1', { workstreamId: 'WS-1' })
    service.start()
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 1 })
    expect(wsEvents(store)).toHaveLength(1)

    // Simulate the rebuildable-cache drop (TC-HIST-006 rebuild semantics):
    // the RUN derived row is gone while the pointer + event log still say
    // R-1 is open (the log is truth — reconciliation keeps it open).
    const db = new DatabaseSync(store.path)
    db.exec("DELETE FROM derived_state WHERE object_kind = 'RUN'")
    db.close()

    const fresh = new SessionLinkService({
      store,
      registry: makeRegistry(),
      adapter,
      ids: makeAllocator(store),
      projectId: PROJECT_ID,
      workstreams: WORKSTREAMS,
      now: () => T0,
    })
    expect(fresh.wireSession('sess-1', { workstreamId: 'WS-1' }).status).toBe('already-wired')
    const e = throws(() => adapter.emit({ sessionId: 'sess-1', type: 'turn/end', seq: 2 }))
    expect(isSessionLinkError(e)).toBe(true)
    expect((e as SessionLinkError).code).toBe('VALIDATION_REJECTED')
    // zero side effects: no new event, pointer unchanged, the burned H id
    // left a GAP (monotonic, never reused)
    expect(wsEvents(store)).toHaveLength(1)
    expect(service.pointerOf('sess-1')).toEqual({ workstreamId: 'WS-1', lastSeq: 1, runId: 'R-1', runStartedAt: T0 })
    expect(makeAllocator(store).peek('HISTORY_EVENT', PROJECT_ID)).toBe(2)
  })
})

describe('crash-window recovery (append landed, pointer `meta.set` did not)', () => {
  it('re-wire reconciles the pointer against the event log; the finish still lands — no duplicates', () => {
    const { store, adapter, service } = makeHarness()
    service.wireSession('sess-1', { workstreamId: 'WS-1' })
    const disposeOld = service.start()
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 1 })
    expect(wsEvents(store)).toHaveLength(1)

    // The crash: roll the pointer row back to its PRE-batch value.
    store.meta().set(
      pointerKey('sess-1'),
      JSON.stringify({ workstreamId: 'WS-1', lastSeq: 0, runId: null, runStartedAt: null }),
    )

    // The restart: the old fiber's subscription is gone, then a fresh
    // service re-wires — the log says R-1 is open.
    disposeOld()
    const fresh = new SessionLinkService({
      store,
      registry: makeRegistry(),
      adapter,
      ids: makeAllocator(store),
      projectId: PROJECT_ID,
      workstreams: WORKSTREAMS,
      now: () => T0,
    })
    expect(fresh.wireSession('sess-1', { workstreamId: 'WS-1' }).status).toBe('already-wired')
    expect(fresh.pointerOf('sess-1')).toEqual({ workstreamId: 'WS-1', lastSeq: 0, runId: 'R-1', runStartedAt: T0 })
    fresh.start()
    adapter.emit({ sessionId: 'sess-1', type: 'turn/end', seq: 2 })
    expect(wsEvents(store).map((e) => `${e.eventType}:${e.payload.run_id as string}`)).toEqual([
      'RUN_STARTED:R-1',
      'RUN_FINISHED:R-1',
    ])
    expect(fresh.pointerOf('sess-1')?.runId).toBeNull()
  })

  it('re-delivery after a lagging pointer re-derives the documented recovery pair — still duplicate-free', () => {
    const { store, adapter, service } = makeHarness()
    service.wireSession('sess-1', { workstreamId: 'WS-1' })
    const disposeOld = service.start()
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 1 })
    store.meta().set(
      pointerKey('sess-1'),
      JSON.stringify({ workstreamId: 'WS-1', lastSeq: 0, runId: null, runStartedAt: null }),
    )

    disposeOld()
    const fresh = new SessionLinkService({
      store,
      registry: makeRegistry(),
      adapter,
      ids: makeAllocator(store),
      projectId: PROJECT_ID,
      workstreams: WORKSTREAMS,
      now: () => T0,
    })
    fresh.wireSession('sess-1', { workstreamId: 'WS-1' })
    fresh.start()
    // The feed re-delivers the consumed start (seq 1 > lagging lastSeq 0):
    // the open R-1 is late-closed and a new run starts (documented cost).
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 1 })
    adapter.emit({ sessionId: 'sess-1', type: 'turn/end', seq: 2 })

    const events = wsEvents(store)
    expect(events.map((e) => `${e.eventType}:${e.payload.run_id as string}`)).toEqual([
      'RUN_STARTED:R-1',
      'RUN_FINISHED:R-1', // late close (superseded by re-observed start)
      'RUN_STARTED:R-2',
      'RUN_FINISHED:R-2',
    ])
    // no run is started or finished twice
    expect(events.filter((e) => e.eventType === 'RUN_STARTED' && e.payload.run_id === 'R-1')).toHaveLength(1)
    expect(events.filter((e) => e.eventType === 'RUN_FINISHED' && e.payload.run_id === 'R-1')).toHaveLength(1)
    expect(fresh.pointerOf('sess-1')?.runId).toBeNull()
    expect(fresh.pointerOf('sess-1')?.lastSeq).toBe(2)
  })
})

describe('detach / re-wire', () => {
  it('detach stops processing (in-memory) but KEEPS the durable pointer; re-wire resumes the open run', () => {
    const { store, adapter, service } = makeHarness()
    service.wireSession('sess-1', { workstreamId: 'WS-1' })
    service.start()
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 1 })
    const pointer = service.detachSession('sess-1')
    expect(pointer?.runId).toBe('R-1')
    adapter.emit({ sessionId: 'sess-1', type: 'turn/end', seq: 2 }) // detached — ignored
    expect(wsEvents(store)).toHaveLength(1)
    // the durable row survived the detach
    expect(service.pointerOf('sess-1')?.runId).toBe('R-1')
    // re-wire = idempotent resume
    expect(service.wireSession('sess-1', { workstreamId: 'WS-1' }).status).toBe('already-wired')
    adapter.emit({ sessionId: 'sess-1', type: 'turn/end', seq: 2 })
    expect(wsEvents(store).map((e) => e.eventType)).toEqual(['RUN_STARTED', 'RUN_FINISHED'])
  })
})

describe('INV-DB-2 — the stored session data is pointer/summary ONLY', () => {
  it('meta rows: pointer keys + id counters only; the pointer JSON carries no session content', () => {
    const { store, adapter, service } = makeHarness()
    service.wireSession('sess-1', { workstreamId: 'WS-1', intent: '复现实验' })
    service.start()
    adapter.emit({ sessionId: 'sess-1', type: 'user/message', seq: 1 }) // content that must NOT be stored
    adapter.emit({ sessionId: 'sess-1', type: 'assistant/message', seq: 2 })
    adapter.emit({ sessionId: 'sess-1', type: 'turn/start', seq: 3 })
    adapter.emit({ sessionId: 'sess-1', type: 'turn/end', seq: 4 })

    const keys = store.meta().keys()
    expect(keys).toEqual(
      expect.arrayContaining(['sessionlink:pointer:sess-1', 'id-counter:PRJ-1:RUN', 'id-counter:PRJ-1:HISTORY_EVENT']),
    )
    expect(keys.filter((k) => k.startsWith('sessionlink:'))).toEqual(['sessionlink:pointer:sess-1'])
    for (const key of keys) {
      const value = String(store.meta().get(key))
      expect(value.includes('assistant')).toBe(false) // no raw-log content in any meta row
    }

    const raw = String(store.meta().get(pointerKey('sess-1')))
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['lastSeq', 'runId', 'runStartedAt', 'workstreamId', 'intent'].sort())

    // event payloads: only the frozen RUN_* fields (the session is a POINTER)
    for (const event of wsEvents(store)) {
      expect(Object.keys(event.payload).sort()).toEqual(
        event.eventType === 'RUN_STARTED'
          ? ['dsh_session_id', 'initiated_by', 'intent', 'run_id']
          : ['run_id'],
      )
    }
  })
})

