/**
 * WP-2.5 — integration smoke: the WP-2.3 `foldEvents` engine + the WP-2.2
 * typed event registry (「与 WP-2.3 foldEvents 引擎集成冒烟 — import 其类型」).
 *
 * At WP-2.5 commit time the WP-2.3 module is IN FLIGHT in the working tree
 * (`src/host/history/replay/`, uncommitted). The engine primitive
 * `replay/replay.ts` is complete and stable (a dependency-free pure fold
 * written explicitly to consume this WP's reducer — see its module doc:
 * 「the reducer body is NOT this WP's (WP-2.5 / the domain objects own the
 * per-event derived-state semantics)」), so this smoke imports:
 *
 *   - `foldEvents` / `Reducer` from `src/host/history/replay/replay.js`
 *     (the WP-2.3 engine — the type contract my reducer must satisfy);
 *   - `HistoryEvent` / `HistoryEventMap` / `validateEvent` /
 *     `loadHistoryEventRegistry`
 *     from the COMMITTED WP-2.2 registry (the fold engine's input type).
 *
 * Pinned here:
 *  1. COMPILE-LEVEL: `reduceSemanticEvent` is a `Reducer<SemanticState,
 *     HistoryEvent>` — the engine can consume the registry's 20-event union
 *     through this reducer with zero adaptation (domain ← history: no import
 *     in src, structural typing only);
 *  2. WRITE-PATH: each of the seven semantic events is accepted by the
 *     WP-2.2 `validateEvent` when its `HistoryObjectContext` is built from
 *     THIS WP's derived state via `toObjectContext` (merged with the static
 *     non-semantic maps) — the ctx projection is structurally the registry's
 *     snapshot shape (assignability is compile-enforced below);
 *  3. ENGINE ≡ PRIMITIVE: folding the same 20-event stream through
 *     `foldEvents` (the WP-2.3 engine) and through `foldSemanticEvents`
 *     (this WP's fold) yields byte-identical states;
 *  4. IDempotency through the engine (TC-HIST-005): two engine folds are
 *     byte-identical.
 */
import { describe, expect, it } from 'vitest'

import {
  foldSemanticEvents,
  initialSemanticState,
  isSemanticEvent,
  reduceSemanticEvent,
  toObjectContext,
  type SemanticState,
} from '../../src/host/domain/semantics/index.js'
import { foldEvents, type Reducer } from '../../src/host/history/replay/replay.js'
import {
  loadHistoryEventRegistry,
  validateEvent,
  type HistoryEvent,
  type HistoryEventEnvelope,
  type HistoryEventMap,
  type HistoryEventType,
  type HistoryObjectContext,
} from '../../src/host/history/registry/index.js'
import { FsReader, WR_HISTORY_SCHEMA_DIR, canonicalJson, event } from './fixtures.js'

const T0 = Date.parse('2026-08-22T09:00:00Z')

/**
 * Build a registry-typed event (the exact 9-field envelope of catalog §1;
 * `over` overrides envelope fields such as eventSeq/owner).
 */
function reg<T extends HistoryEventType>(
  eventType: T,
  payload: HistoryEventMap[T],
  over: Partial<HistoryEventEnvelope<HistoryEventMap[T]>> = {},
): HistoryEvent {
  return {
    eventId: 'H-1001',
    ownerWorkstreamId: 'WS-1',
    eventSeq: 1,
    eventType,
    schemaVersion: 1,
    occurredAt: T0,
    recordedAt: T0 + 1000,
    actor: { kind: 'USER', user_id: 'u-alice' },
    payload,
    ...over,
  } as unknown as HistoryEvent
}

/** The full 20-event catalog stream (one per event type; mixed owners/seqs). */
function fullCatalogStream(): HistoryEvent[] {
  return [
    reg('RUN_STARTED', { run_id: 'R-1', initiated_by: { kind: 'USER', user_id: 'u-alice' } }, { eventSeq: 1, eventId: 'H-1' }),
    reg('FACT_RECORDED', { fact_id: 'F-1', statement: 'benchmark p95 = 12 ms' }, { eventSeq: 2, eventId: 'H-2' }),
    reg('CLAIM_RECORDED', { claim_id: 'C-1', statement: 'the patch reduces p95' }, { eventSeq: 3, eventId: 'H-3' }),
    reg('ARTIFACT_REGISTERED', { artifact_id: 'A-1', type: 'DATASET', title: 'traces', uri: 'data/traces/' }, { eventSeq: 4, eventId: 'H-4' }),
    reg('RELATION_ADDED', { relation_id: 'REL-1', source: { kind: 'CLAIM', id: 'C-1' }, relation_type: 'SUPPORTED_BY', target: { kind: 'FACT', id: 'F-1' } }, { eventSeq: 5, eventId: 'H-5' }),
    reg('TASK_EXECUTION_CHANGED', { task_id: 'T-1', from: 'PLANNED', to: 'ACTIVE' }, { eventSeq: 6, eventId: 'H-6' }),
    reg('RUN_FINISHED', { run_id: 'R-1', outcome_summary: 'done' }, { eventSeq: 7, eventId: 'H-7' }),
    reg('GATE_EVALUATED', { gate_id: 'G-1', result: 'PASSED', evaluated_by: { kind: 'USER', user_id: 'u-alice' } }, { eventSeq: 8, eventId: 'H-8' }),
    reg('CLAIM_RECORDED', { claim_id: 'C-2', statement: 'the patch does nothing' }, { eventSeq: 9, eventId: 'H-9', ownerWorkstreamId: 'WS-2' }),
    reg('RELATION_ADDED', { relation_id: 'REL-2', source: { kind: 'CLAIM', id: 'C-1' }, relation_type: 'CONTRADICTED_BY', target: { kind: 'CLAIM', id: 'C-2' } }, { eventSeq: 10, eventId: 'H-10' }),
    reg('TASK_VALIDATION_CHANGED', { task_id: 'T-1', from: 'PENDING', to: 'PASSED' }, { eventSeq: 11, eventId: 'H-11' }),
    reg('MILESTONE_ACHIEVED', { milestone_id: 'M-1' }, { eventSeq: 12, eventId: 'H-12' }),
    reg('INTERVENTION_CREATED', { intervention_id: 'IV-1', title: 'user note', origin: 'USER', source_refs: [{ kind: 'WORKSTREAM', id: 'WS-1' }] }, { eventSeq: 13, eventId: 'H-13' }),
    reg('ARTIFACT_MARKED_MISSING', { artifact_id: 'A-1', reason: 'path 404' }, { eventSeq: 14, eventId: 'H-14' }),
    reg('CLAIM_RETRACTED', { claim_id: 'C-2', reason: 're-run showed the effect' }, { eventSeq: 15, eventId: 'H-15', ownerWorkstreamId: 'WS-2' }),
    reg('RELATION_REMOVED', { relation_id: 'REL-2', source: { kind: 'CLAIM', id: 'C-1' }, relation_type: 'CONTRADICTED_BY', target: { kind: 'CLAIM', id: 'C-2' } }, { eventSeq: 16, eventId: 'H-16' }),
    reg('TOPOLOGY_FORK_REALIZED', { topology_edge_id: 'TE-1', inputs: ['WS-1'], outputs: ['WS-2'] }, { eventSeq: 17, eventId: 'H-17' }),
    reg('RUNS_STARTED', { runs: [{ run_id: 'R-2' }, { run_id: 'R-3' }] }, { eventSeq: 18, eventId: 'H-18' }),
    reg('RUN_CANCELLED', { run_id: 'R-2', cancelled_by: { kind: 'USER', user_id: 'u-alice' } }, { eventSeq: 19, eventId: 'H-19' }),
    reg('ACCEPTANCE_CRITERIA_CHANGED', { task_id: 'T-1', from: ['AC: p95 improves'], to: ['AC: p95 improves', 'AC: no regression on p50'] }, { eventSeq: 20, eventId: 'H-20' }),
  ]
}

/**
 * The static (non-semantic) part of the HistoryObjectContext: the objects
 * the non-semantic events reference. The SEMANTIC part (claims/facts/
 * artifacts/relations) comes from THIS WP's derived state at each step —
 * that is the integration contract under test.
 */
const staticCtx: HistoryObjectContext = {
  workstreams: new Map([
    ['WS-1', { topicId: 'TPC-1', lifecycle: 'REALIZED' }],
    ['WS-2', { topicId: 'TPC-1', lifecycle: 'REALIZED' }],
  ]),
  tasks: new Map([['T-1', { workstreamId: 'WS-1', execution: 'PLANNED', validation: 'PENDING', acceptanceCriteria: ['AC: p95 improves'] }]]),
  runs: new Map([['R-1', { workstreamId: 'WS-1', status: 'RUNNING' }]]),
  claims: new Map(),
  facts: new Map(),
  artifacts: new Map(),
  relations: new Map(),
  gates: new Map([['G-1', { workstreamId: 'WS-1', lastResult: null }]]),
  milestones: new Map([['M-1', { workstreamId: 'WS-1', status: 'PLANNED' }]]),
  interventions: new Map(),
  topologyEdges: new Map([
    ['TE-1', { topicId: 'TPC-1', operation: 'FORK', lifecycle: 'PLANNED', inputs: ['WS-1'], outputs: ['WS-2'] }],
  ]),
}

describe('integration: the WP-2.3 foldEvents engine consumes this WP reducer', () => {
  it('TYPE LEVEL: reduceSemanticEvent IS a Reducer<SemanticState, HistoryEvent> (the engine contract)', () => {
    // this assignment compiles ⇔ the engine can fold the registry's 20-event
    // union through the semantic reducer without any adaptation layer:
    const reducer: Reducer<SemanticState, HistoryEvent> = (state, ev) => reduceSemanticEvent(state, ev)
    const state = foldEvents(fullCatalogStream(), reducer, initialSemanticState())
    expect(state.claims.size).toBe(2)
  })

  it('ENGINE ≡ PRIMITIVE: foldEvents and foldSemanticEvents agree byte-for-byte on the full 20-event stream', () => {
    const stream = fullCatalogStream()
    const viaEngine = foldEvents(stream, (s, e) => reduceSemanticEvent(s, e), initialSemanticState())
    const viaPrimitive = foldSemanticEvents(stream)
    expect(canonicalJson(viaEngine)).toBe(canonicalJson(viaPrimitive))
    // the semantic content: both claims + both relations survived; the
    // CONTRADICTED_BY edge flagged C-1, then its removal cleared the flag:
    expect(viaEngine.claims.get('C-1')?.status).toBe('ACTIVE')
    expect(viaEngine.claims.get('C-2')?.status).toBe('RETRACTED')
    expect(viaEngine.relations.get('REL-1')?.status).toBe('ACTIVE')
    expect(viaEngine.relations.get('REL-2')?.status).toBe('REMOVED')
    expect(viaEngine.conflict.get('C-1')).toBeUndefined() // cleared by RELATION_REMOVED
    expect(viaEngine.artifacts.get('A-1')?.status).toBe('MISSING')
    // and the 13 non-semantic events were no-ops: no run/task/gate state exists here
    expect(Object.keys(viaEngine).sort()).toEqual(['artifacts', 'claims', 'conflict', 'facts', 'relations'])
  })

  it('idempotency through the engine (TC-HIST-005): two engine folds are byte-identical', () => {
    const stream = fullCatalogStream()
    const r: Reducer<SemanticState, HistoryEvent> = (s, e) => reduceSemanticEvent(s, e)
    const a = foldEvents(stream, r, initialSemanticState())
    const b = foldEvents(stream, r, initialSemanticState())
    expect(canonicalJson(a)).toBe(canonicalJson(b))
  })
})

describe('integration: toObjectContext feeds the WP-2.2 validateEvent (the write path)', () => {
  it('every semantic event in the stream is accepted by validateEvent when the ctx comes from THIS WP derived state', () => {
    const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)
    expect(registry.isUsable).toBe(true)
    if (!registry.isUsable) throw new Error(registry.loadErrors.map((e) => e.message).join('; '))

    let state = initialSemanticState()
    let seq = 0
    for (const event of fullCatalogStream()) {
      seq += 1
      if (!isSemanticEvent(event)) continue // the semantic gate covers the seven; the rest are folded
      // the ctx the write path would hold: static non-semantic maps + the
      // reducer-derived semantic state projected into the registry shape.
      const projection = toObjectContext(state)
      const ctx: HistoryObjectContext = {
        ...staticCtx,
        claims: projection.claims,
        facts: projection.facts,
        artifacts: projection.artifacts,
        relations: projection.relations,
      }
      const res = validateEvent(registry, event, ctx)
      expect(res.ok, `validateEvent rejected ${event.eventType}: ${JSON.stringify((res as unknown as { errors: unknown[] }).errors)}`).toBe(true)
      state = reduceSemanticEvent(state, event)
    }
    // the fold completed: the derived state after the stream
    expect(state.claims.size).toBe(2)
    expect(state.relations.size).toBe(2)
    expect(seq).toBe(20)
  })

  it('a stream event that VIOLATES the semantic state is rejected by validateEvent against the projected ctx (the gate catches it)', () => {
    const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)
    expect(registry.isUsable).toBe(true)
    if (!registry.isUsable) throw new Error(registry.loadErrors.map((e) => e.message).join('; '))

    // state: C-1 recorded
    const state = reduceSemanticEvent(initialSemanticState(), reg('CLAIM_RECORDED', { claim_id: 'C-1', statement: 's' }))
    const ctx: HistoryObjectContext = {
      ...staticCtx,
      ...toObjectContext(state),
    }
    // re-recording C-1 (not fresh) must be rejected by the registry validator
    const dup = reg('CLAIM_RECORDED', { claim_id: 'C-1', statement: 'again' })
    const res = validateEvent(registry, dup, ctx)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.map((e) => e.code)).toContain('OBJECT_ALREADY_EXISTS')
  })
})

/* ------------------------------------------------------------------ *
 * Local envelope builder parity: the plain `event()` builder (SemanticInputEvent)
 * is also foldable through the engine — the same structural contract.
 * ------------------------------------------------------------------ */

describe('integration: structural compatibility both directions', () => {
  it('SemanticInputEvent-shaped events (this WP builder) fold through the WP-2.3 engine too', () => {
    const stream = [
      event('FACT_RECORDED', { fact_id: 'F-1', statement: 's' }, { eventSeq: 1, eventId: 'H-1' }),
      event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 't' }, { eventSeq: 2, eventId: 'H-2' }),
    ]
    const r: Reducer<SemanticState, Parameters<typeof reduceSemanticEvent>[1]> = (s, e) => reduceSemanticEvent(s, e)
    const state = foldEvents(stream, r, initialSemanticState())
    expect(state.facts.size).toBe(1)
    expect(state.claims.size).toBe(1)
  })
})
