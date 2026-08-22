/**
 * WP-2.4 — the event wiring closed loop (task goal 3: 「BIND/DETACH 触发
 * 对应 RUN_* 事件构造（经 registry 校验 + store append — 完整接线闭环
 * 测试）；发射者 = 用户（矩阵 U）」).
 *
 * Covered here:
 *  - EVERY event-producing operation (BIND / registerRun / finish /
 *    fail / cancel / auto-register) appends through the store with the
 *    registry validate hook INSIDE the write transaction — the stored
 *    event is then (a) visible via `queryEvents` in BOTH replay orders,
 *    (b) shape-valid against the frozen registry (`checkShape` —
 *    INV-HIST-4: the stored row passes the frozen schema), and
 *    (c) envelope-faithful (eventId H-<n>, schemaVersion 1, owner WS,
 *    store-assigned seq/recordedAt);
 *  - the emitter matrix (catalog §4 E column) is enforced by the
 *    registry at append time: USER is the default lane (matrix U);
 *    AGENT events must carry a run_id (CROSS_FIELD); PLUGIN is refused
 *    on RUN_CANCELLED (EMITTER_FORBIDDEN) but admitted on RUN_FINISHED;
 *  - the PLANNED→REALIZED atomic realize seam (TC-DOM-033 persistence
 *    half): a PLANNED workstream's FIRST event writes the
 *    workstream-lifecycle derived_state row in the SAME store
 *    transaction and fires the declarative-half callback exactly once;
 *  - a broken registry (unusable) refuses every append
 *    (RB_REGISTRY_UNUSABLE — never an unvalidated event lands).
 */
import { describe, expect, it } from 'vitest'

import { queryEvents, readDerivedState } from '../../src/host/history/replay/index.js'
import {
  loadHistoryEventRegistry,
  type HistoryEventRegistry,
} from '../../src/host/history/registry/index.js'
import {
  makeHarness,
  seedPendingDs,
  USER,
  FsReader,
  WR_HISTORY_SCHEMA_DIR,
  ExternalState,
} from './helpers.js'
import type { Harness } from './helpers.js'
import {
  openRunBindingDatabase,
  RunBindingError,
  RunBindingService,
} from '../../src/host/service/runbinding/index.js'
import { IdAllocator } from '../../src/shared/ids/index.js'
import { join } from 'node:path'

function expectCode(e: unknown, code: string): asserts e is RunBindingError {
  if (!(e instanceof RunBindingError) || e.code !== code) {
    throw new Error(`expected RunBindingError(${code}), got ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
  }
}

/** The closed-loop assertions for one stored event (task goal 3). */
function assertStoredEventLoop(
  h: Harness,
  ownerWs: string,
  expectedType: string,
  expectedSeq: number,
  expectedRunId: string,
): void {
  // (a) visible in BOTH replay orders (catalog §2).
  const audit = queryEvents(h.store, ownerWs, { order: 'audit' }).events
  const semantic = queryEvents(h.store, ownerWs, { order: 'semantic' }).events
  const byAudit = audit.find((e) => e.eventType === expectedType && e.payload.run_id === expectedRunId)
  const bySemantic = semantic.find((e) => e.eventType === expectedType && e.payload.run_id === expectedRunId)
  expect(byAudit, `audit order must see the ${expectedType} event`).toBeDefined()
  expect(bySemantic, `semantic order must see the ${expectedType} event`).toBeDefined()
  const event = byAudit!

  // (b) the stored row passes the FROZEN registry shape check
  // (INV-HIST-4 — the closed loop: append → query → re-validate).
  const shape = h.registry.checkShape(event)
  expect(shape.ok, `stored event must pass the frozen registry shape check: ${shape.ok ? '' : JSON.stringify(shape.errors)}`).toBe(true)

  // (c) envelope faithfulness.
  expect(event.eventId).toMatch(/^H-[1-9][0-9]*$/)
  expect(event.eventSeq).toBe(expectedSeq)
  expect(event.schemaVersion).toBe(1)
  expect(event.ownerWorkstreamId).toBe(ownerWs)
  expect(event.occurredAt).toBeGreaterThan(0)
  expect(event.recordedAt).toBeGreaterThan(0) // store-generated (plugin 写入时生成)
}

describe('event closed loop: append → queryEvents visible → registry re-validation', () => {
  it('BIND appends a USER-actor RUN_STARTED (matrix U) that passes the loop', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'sess-el-bind' })
    const result = h.service.bindDiscoveredSession(ds.id, { workstreamId: 'WS-1' }, USER)
    assertStoredEventLoop(h, 'WS-1', 'RUN_STARTED', 1, result.run.id)
    // Full payload check:
    const stored = queryEvents(h.store, 'WS-1', { order: 'audit' }).events[0]!
    expect(stored.payload).toEqual({
      run_id: result.run.id,
      dsh_session_id: 'sess-el-bind',
      initiated_by: USER,
    })
    expect(stored.actor).toEqual(USER)
    expect(stored.source).toEqual({ kind: 'DSH_SESSION', session_id: 'sess-el-bind' })
    h.close()
  })

  it('registerRun / finish / fail / cancel each append their event (seq advances per WS)', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' }, USER)
    assertStoredEventLoop(h, 'WS-1', 'RUN_STARTED', 1, a.run.id)

    h.service.finishRun(a.run.id, { outcomeSummary: 'done' }, USER)
    assertStoredEventLoop(h, 'WS-1', 'RUN_FINISHED', 2, a.run.id)

    const b = h.service.registerRun({ workstreamId: 'WS-1' }, USER)
    h.service.failRun(b.run.id, { errorSummary: 'x' }, USER)
    assertStoredEventLoop(h, 'WS-1', 'RUN_FAILED', 4, b.run.id)

    const c = h.service.registerRun({ workstreamId: 'WS-1' }, USER)
    h.service.cancelRun(c.run.id, { reason: 'r' }, USER)
    assertStoredEventLoop(h, 'WS-1', 'RUN_CANCELLED', 6, c.run.id)

    // The full audit-order timeline for WS-1:
    const types = queryEvents(h.store, 'WS-1', { order: 'audit' }).events.map((e) => e.eventType)
    expect(types).toEqual(['RUN_STARTED', 'RUN_FINISHED', 'RUN_STARTED', 'RUN_FAILED', 'RUN_STARTED', 'RUN_CANCELLED'])
    // End-event payloads are exact (frozen §5.1 keys):
    const events = queryEvents(h.store, 'WS-1', { order: 'audit' }).events
    expect(events[1]!.payload).toEqual({ run_id: a.run.id, outcome_summary: 'done' })
    expect(events[3]!.payload).toEqual({ run_id: b.run.id, error_summary: 'x' })
    expect(events[5]!.payload).toEqual({ run_id: c.run.id, reason: 'r', cancelled_by: USER })
    h.close()
  })

  it('auto-register appends a PLUGIN-actor RUN_STARTED (matrix P, session 绑定自动登记)', () => {
    const h = makeHarness({
      researchContextResolver: (s) => (s.title === 'research:WS-1' ? { workstreamId: 'WS-1' } : null),
    })
    h.service.reconcileSessions([
      { id: 'el-auto', cwd: h.rootA, running: false, createdAt: 1, blank: true, title: 'research:WS-1' },
    ])
    const events = queryEvents(h.store, 'WS-1', { order: 'audit' }).events
    expect(events).toHaveLength(1)
    expect(events[0]!.eventType).toBe('RUN_STARTED')
    expect(events[0]!.actor).toMatchObject({ kind: 'PLUGIN' })
    expect(h.registry.checkShape(events[0]!).ok).toBe(true)
    h.close()
  })

  it('DETACH/IGNORE append NO event (a PENDING DS has no run — catalog §5.1 has no detach event)', () => {
    const h = makeHarness()
    const a = seedPendingDs(h, { sessionId: 'el-det' })
    const b = seedPendingDs(h, { sessionId: 'el-ign' })
    h.service.detachDiscoveredSession(a.id)
    h.service.ignoreDiscoveredSession(b.id)
    for (const ws of ['WS-1', 'WS-2']) {
      expect(queryEvents(h.store, ws).events).toHaveLength(0)
    }
    expect(h.service.listRuns()).toHaveLength(0)
    h.close()
  })
})

describe('emitter matrix (catalog §4 E column — registry-enforced at append)', () => {
  it('AGENT may emit RUN_FAILED with a valid run_id (matrix A lane: checkpoint 报告)', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    // The AGENT actor's run_id references an EXISTING run (catalog §5 通用校验).
    const result = h.service.failRun(a.run.id, { errorSummary: 'agent reported' }, { kind: 'AGENT', run_id: a.run.id })
    expect(result.event.actor).toEqual({ kind: 'AGENT', run_id: a.run.id })
    expect(h.registry.checkShape(result.event).ok).toBe(true)
    h.close()
  })

  it('AGENT without a run_id is rejected (CROSS_FIELD — catalog §5 通用校验)', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    try {
      h.service.failRun(a.run.id, { errorSummary: 'x' }, { kind: 'AGENT' })
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_EVENT_REJECTED')
      expect(e.errors?.some((er) => er.code === 'CROSS_FIELD')).toBe(true)
    }
    // The run is still RUNNING (the append was refused — nothing landed).
    expect(h.service.getRun(a.run.id)?.status).toBe('RUNNING')
    expect(queryEvents(h.store, 'WS-1').events.map((e) => e.eventType)).toEqual(['RUN_STARTED'])
    h.close()
  })

  it('AGENT with an UNKNOWN run_id is rejected (OBJECT_NOT_FOUND — actor.run_id 对应 Run 存在)', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    try {
      h.service.cancelRun(a.run.id, { reason: 'x' }, { kind: 'AGENT', run_id: 'R-404' })
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_EVENT_REJECTED')
      expect(e.errors?.some((er) => er.code === 'OBJECT_NOT_FOUND')).toBe(true)
    }
    h.close()
  })

  it('PLUGIN is refused on RUN_CANCELLED (E column: U A only) — EMITTER_FORBIDDEN', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    try {
      h.service.cancelRun(a.run.id, { reason: 'x' }, { kind: 'PLUGIN', label: 'bot' })
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_EVENT_REJECTED')
      expect(e.errors?.some((er) => er.code === 'EMITTER_FORBIDDEN')).toBe(true)
    }
    expect(h.service.getRun(a.run.id)?.status).toBe('RUNNING')
    h.close()
  })

  it('PLUGIN IS admitted on RUN_FINISHED (E column: U A P) — the auto-registration family', () => {
    const h = makeHarness()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    const result = h.service.finishRun(a.run.id, { outcomeSummary: 'plugin closed it' }, { kind: 'PLUGIN', label: 'research-control' })
    expect(result.run.status).toBe('FINISHED')
    expect(result.event.actor.kind).toBe('PLUGIN')
    expect(h.registry.checkShape(result.event).ok).toBe(true)
    h.close()
  })
})

describe('PLANNED → REALIZED atomic realize seam (TC-DOM-033 persistence half)', () => {
  function harnessWithPlannedWs(): Harness & { realized: string[] } {
    const base = makeHarness()
    // Move WS-1 back to PLANNED (the declarative-side view).
    base.external.addWorkstream('WS-1', 'PLANNED')
    const realized: string[] = []
    const service = new RunBindingService({
      store: base.store,
      tables: base.db.tables,
      registry: base.registry,
      allocator: base.allocator,
      projectId: 'PRJ-1',
      workspaceRoots: [base.rootA, base.rootB],
      externalState: () => base.external,
      now: base.now,
      onWorkstreamRealized: (ws) => realized.push(ws),
    })
    return { ...base, service, realized } as unknown as Harness & { realized: string[] }
  }

  it('the PLANNED WS first event flips the derived_state lifecycle in-transaction and fires the callback once', () => {
    const h = harnessWithPlannedWs()
    const a = h.service.registerRun({ workstreamId: 'WS-1' })
    expect(h.realized).toEqual(['WS-1'])

    // The derived_state row (the §15 L627 workstream-lifecycle cache;
    // values are parsed JSON documents).
    const derived = readDerivedState(h.store)
    expect(derived.get('workstream:WS-1')).toEqual({ topicId: 'TPC-1', lifecycle: 'REALIZED' })

    // A SECOND event does not re-fire the realize (first-event-only).
    h.service.finishRun(a.run.id)
    expect(h.realized).toEqual(['WS-1'])
    h.close()
  })

  it('a REALIZED workstream produces no realize write at all', () => {
    const h = harnessWithPlannedWs()
    h.external.addWorkstream('WS-1', 'REALIZED')
    h.service.registerRun({ workstreamId: 'WS-1' })
    expect(h.realized).toEqual([])
    const derived = readDerivedState(h.store)
    expect(derived.get('workstream:WS-1')).toBeUndefined()
    h.close()
  })

  it('the declarative-half callback throwing fails the whole append (atomic — TC-DOM-033)', () => {
    const base = makeHarness()
    base.external.addWorkstream('WS-1', 'PLANNED')
    const service = new RunBindingService({
      store: base.store,
      tables: base.db.tables,
      registry: base.registry,
      allocator: base.allocator,
      projectId: 'PRJ-1',
      workspaceRoots: [base.rootA, base.rootB],
      externalState: () => base.external,
      now: base.now,
      onWorkstreamRealized: () => {
        throw new Error('declarative flip failed')
      },
    })
    try {
      service.registerRun({ workstreamId: 'WS-1' })
      throw new Error('expected rejection')
    } catch (e) {
      // WP-2.1 contract: caller-owned hook errors propagate UNCHANGED
      // (the store rolls the whole transaction back); a RunBindingError
      // wrapper is tolerated too — either way NOTHING may have landed.
      if (!(e instanceof RunBindingError) && !(e instanceof Error && e.message === 'declarative flip failed')) {
        throw e
      }
      expect(queryEvents(base.store, 'WS-1').events).toHaveLength(0)
      expect(service.listRuns()).toHaveLength(0)
      const derived = readDerivedState(base.store)
      expect(derived.get('workstream:WS-1')).toBeUndefined()
    }
    base.close()
  })
})

describe('registry health gate (INV-HIST-4: never an unvalidated event lands)', () => {
  it('an unusable registry refuses the append (RB_REGISTRY_UNUSABLE) with zero side effects', () => {
    const dir = makeHarness().dir
    const db = openRunBindingDatabase(join(dir, 'research.sqlite'))
    const brokenRegistry = loadHistoryEventRegistry(new FsReader(), join(WR_HISTORY_SCHEMA_DIR, 'does-not-exist'))
    expect(brokenRegistry.isUsable).toBe(false)
    const external = new ExternalState()
    external.addWorkstream('WS-1')
    const service = new RunBindingService({
      store: db.store,
      tables: db.tables,
      registry: brokenRegistry as unknown as HistoryEventRegistry,
      allocator: new IdAllocator(db.store.meta()),
      projectId: 'PRJ-1',
      workspaceRoots: [],
      externalState: () => external,
    })
    // Row-only operations still work (no event half).
    const ds = service.reconcileSessions([
      { id: 'u9-unusable', cwd: '/nonexistent-root', running: false, createdAt: 1, blank: true },
    ])
    expect(ds).toHaveLength(0) // no roots → nothing attributed

    // Every event-producing operation hits the gate before anything lands.
    for (const op of [() => service.registerRun({ workstreamId: 'WS-1' })]) {
      try {
        op()
        throw new Error('expected rejection')
      } catch (e) {
        expectCode(e, 'RB_REGISTRY_UNUSABLE')
      }
    }
    expect(queryEvents(db.store, 'WS-1').events).toHaveLength(0)
    expect(service.listRuns()).toHaveLength(0)
    db.tables.close()
    db.store.close()
  })

  it('with a known WS, the pre-checks still fire first (RB_WORKSTREAM_NOT_FOUND before the gate)', () => {
    const dir = makeHarness().dir
    const db = openRunBindingDatabase(join(dir, 'research.sqlite'))
    const brokenRegistry = loadHistoryEventRegistry(new FsReader(), join(WR_HISTORY_SCHEMA_DIR, 'does-not-exist'))
    const external = new ExternalState()
    const service = new RunBindingService({
      store: db.store,
      tables: db.tables,
      registry: brokenRegistry as unknown as HistoryEventRegistry,
      allocator: new IdAllocator(db.store.meta()),
      projectId: 'PRJ-1',
      workspaceRoots: [],
      externalState: () => external,
    })
    try {
      service.registerRun({ workstreamId: 'WS-1' })
      throw new Error('expected rejection')
    } catch (e) {
      expectCode(e, 'RB_WORKSTREAM_NOT_FOUND')
    }
    db.tables.close()
    db.store.close()
  })
})
