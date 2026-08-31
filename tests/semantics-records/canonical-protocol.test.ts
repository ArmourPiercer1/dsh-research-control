// V2-UI-0.4 UI-7 (D3 / ADJ-2, ADJ-4) — the canonical semantic write
// protocol (src/host/service/semantics/protocol.ts): the reserve→
// precheck→append→commit pipeline. Pins:
//   - ADJ-4: the service ALWAYS passes the composed REGISTRY validate
//     hook as `options.validate` (the authoritative in-tx layer);
//   - the registry hook runs FIRST, the RR-011(b) fold SECOND — a
//     schema-invalid event is rejected by the registry (the fold never
//     runs); a registry-passing event (context-resolvable task endpoint,
//     cross-WS) can still be rejected by the fold's state-local owner rule;
//   - the commit/release lifecycle on append failure (the id gap is
//     legal — §1.1 单调).

import { describe, expect, it } from 'vitest'
import { makeService, loadFrozenRegistry, countEvents, readSemanticRow, T0 } from './harness.js'
import {
  SemanticRecordsService,
  type SemanticRecordsStorePort,
} from '../../src/host/service/semantics/index.js'
import type { AppendEventsOptions, HistoryEventInput, HistoryEventRecord, TxScope } from '../../src/host/persistence/store/types.js'
import { RunBindingError } from '../../src/host/service/runbinding/types.js'
import { SemanticDomainError } from '../../src/host/domain/semantics/index.js'

type RegistryHook = (events: readonly HistoryEventRecord[], tx: TxScope) => void

/** A second service over the SAME store, with a port that records the
 *  `options.validate` the service hands to the seam (the ADJ-4 pin). */
function makeCapturingService(h: ReturnType<typeof makeService>) {
  let captured: RegistryHook | undefined
  const port: SemanticRecordsStorePort = {
    path: h.store.path,
    listRange: (ws, from, to) => h.storeWithSeam.listRange(ws, from, to),
    appendEvents: (events, options?: AppendEventsOptions) => {
      captured = options?.validate
      return h.storeWithSeam.appendEvents(events, options)
    },
  }
  const service = new SemanticRecordsService({
    store: port,
    registry: loadFrozenRegistry(),
    allocator: h.allocator,
    plans: h.plans,
    projectId: h.projectId,
    now: h.clock.now,
  })
  return {
    service,
    getCaptured: (): RegistryHook => {
      if (captured === undefined) throw new Error('no append has happened yet')
      return captured
    },
  }
}

describe('canonical semantic append protocol (ADJ-2 / ADJ-4)', () => {
  it('the service passes the in-tx registry hook (ADJ-4: options.validate is never undefined)', () => {
    const h = makeService()
    try {
      const { service, getCaptured } = makeCapturingService(h)
      service.recordFact({ workstreamId: 'WS-1', statement: 's' })
      const hook = getCaptured()
      expect(typeof hook).toBe('function')

      // And it is the REGISTRY hook: a schema-invalid candidate is
      // rejected with RB_EVENT_REJECTED (the frozen registry vocabulary).
      // A full finalized record (envelopeCore requires eventSeq +
      // recordedAt) — the payload is the only schema-invalid part.
      const bad: HistoryEventRecord = {
        eventId: 'H-900',
        ownerWorkstreamId: 'WS-1',
        eventSeq: 900,
        eventType: 'FACT_RECORDED',
        schemaVersion: 1,
        occurredAt: T0,
        recordedAt: T0,
        actor: { kind: 'USER' },
        payload: { fact_id: 'F-9' }, // statement missing — schema-invalid
      }
      expect(() => hook([bad], undefined as unknown as TxScope)).toThrow(RunBindingError)
    } finally {
      h.close()
    }
  })

  it('registry FIRST, fold SECOND: a schema-invalid event never reaches the fold', () => {
    const h = makeService()
    try {
      const { service, getCaptured } = makeCapturingService(h)
      service.recordFact({ workstreamId: 'WS-1', statement: 's' }) // F-1 exists
      const hook = getCaptured()
      const before = countEvents(h.store, 'WS-1')

      // Schema-invalid (statement missing) AND domain-invalid (F-1
      // exists). The registry hook rejects first — the error is the
      // registry carrier, NOT the fold's SemanticDomainError. (The store
      // finalizes the input before the composed validate runs.)
      const bad: HistoryEventInput = {
        eventId: 'H-901',
        ownerWorkstreamId: 'WS-1',
        eventType: 'FACT_RECORDED',
        schemaVersion: 1,
        occurredAt: T0,
        actor: { kind: 'USER' },
        payload: { fact_id: 'F-1' },
      }
      let thrown: unknown
      try {
        h.storeWithSeam.appendEvents([bad], { validate: hook })
      } catch (e) {
        thrown = e
      }
      expect(thrown instanceof RunBindingError).toBe(true)
      expect((thrown as RunBindingError).code).toBe('RB_EVENT_REJECTED')
      expect(thrown instanceof SemanticDomainError).toBe(false)

      // Nothing landed (the tx rolled back; the fold never ran).
      expect(countEvents(h.store, 'WS-1')).toBe(before)
      expect(readSemanticRow(h.store, h.projectId)!.facts.has('F-1')).toBe(true)
    } finally {
      h.close()
    }
  })

  it('a registry-passing event reaches the fold (rejected by the fold owner rule)', () => {
    const h = makeService()
    try {
      const { service, getCaptured } = makeCapturingService(h)
      service.recordFact({ workstreamId: 'WS-1', statement: 'f1' }) // F-1 / H-1 (WS-1)
      service.registerArtifact({ workstreamId: 'WS-1', type: 'NOTE', title: 't', uri: 'file:///x' }) // A-1 / H-2 (WS-1)
      const hook = getCaptured()

      // First: a schema-valid duplicate-fact event is NOT even a fold
      // scenario — the registry hook enforces id freshness itself
      // (OBJECT_ALREADY_EXISTS, /payload/fact_id) before the fold runs.
      const dup: HistoryEventInput = {
        eventId: 'H-901',
        ownerWorkstreamId: 'WS-1',
        eventType: 'FACT_RECORDED',
        schemaVersion: 1,
        occurredAt: T0,
        actor: { kind: 'USER' },
        payload: { fact_id: 'F-1', statement: 'duplicate' },
      }
      let dupThrown: unknown
      try {
        h.storeWithSeam.appendEvents([dup], { validate: hook })
      } catch (e) {
        dupThrown = e
      }
      expect(dupThrown instanceof RunBindingError).toBe(true)
      expect((dupThrown as RunBindingError).code).toBe('RB_EVENT_REJECTED')

      // Then: a schema-valid + registry-PASSING event that only the FOLD
      // rejects. T-5 (a WS-2 task) CONSUMES A-1 (WS-1): the registry
      // resolves the task via its CONTEXT (owner = source.ws = WS-2 = the
      // event owner — pass), but the fold's state-local owner rule has no
      // task rows (owner = target.ws = WS-1 ≠ WS-2 — reject). The fold is
      // the second in-tx layer (RR-011(b)) and the authoritative gate for
      // state-local owner agreement.
      const bad: HistoryEventInput = {
        eventId: 'H-902',
        ownerWorkstreamId: 'WS-2',
        eventType: 'RELATION_ADDED',
        schemaVersion: 1,
        occurredAt: T0,
        actor: { kind: 'USER' },
        payload: {
          relation_id: 'REL-901',
          source: { kind: 'TASK', id: 'T-5' },
          relation_type: 'CONSUMES',
          target: { kind: 'ARTIFACT', id: 'A-1' },
        },
      }
      let thrown: unknown
      try {
        h.storeWithSeam.appendEvents([bad], { validate: hook })
      } catch (e) {
        thrown = e
      }
      expect(thrown instanceof SemanticDomainError).toBe(true)
      expect((thrown as SemanticDomainError).code).toBe('OWNER_MISMATCH')

      // The fold rejected inside the tx — nothing landed.
      expect(countEvents(h.store, 'WS-1')).toBe(2)
      expect(countEvents(h.store, 'WS-2')).toBe(0)
      expect(readSemanticRow(h.store, h.projectId)!.relations.has('REL-901')).toBe(false)
    } finally {
      h.close()
    }
  })

  it('pre-check failure releases ALL reservations (the gap is legal, §1.1)', () => {
    const h = makeService()
    try {
      const { service } = makeCapturingService(h)
      service.recordFact({ workstreamId: 'WS-1', statement: 's' }) // F-1, H-1
      const reserved = h.allocatorEvents.length

      // An empty-statement fact: the ids are reserved FIRST (the
      // protocol builds the payload from them), the pre-check then
      // fails against the derived state — both reservations are released
      // and NO event row is written.
      expect(() => service.recordFact({ workstreamId: 'WS-1', statement: '' })).toThrow()
      const after = h.allocatorEvents.slice(reserved)
      expect(after.map((e) => `${e.op}:${e.id}`)).toEqual(['reserve:F-2', 'reserve:H-2', 'release:F-2', 'release:H-2'])
      expect(countEvents(h.store, 'WS-1')).toBe(1) // unchanged
      // The next fact takes F-3 (monotonic — the gap is never reused).
      const next = service.recordFact({ workstreamId: 'WS-1', statement: 'ok' })
      expect(next.factId).toBe('F-3')
      expect(next.eventId).toBe('H-3')
    } finally {
      h.close()
    }
  })
})
