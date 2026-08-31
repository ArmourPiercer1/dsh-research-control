// V2-UI-0.4 UI-7 (D3) — addRelation (RELATION_ADDED) + removeRelation
// (RELATION_REMOVED, D §13.2 / §8): owner derivation
// (source.ws ?? target.ws — the wire has NO workstreamId parameter),
// the frozen combination table, the §5.5 audit mirror on removal, and
// the ACTIVE → REMOVED state machine (ADJ-10).

import { describe, expect, it } from 'vitest'
import { makeService, readSemanticRow, countEvents, findEvent } from './harness.js'
import { expectCarrierCode } from './helpers.js'
import type { RelationType } from '../../src/host/domain/semantics/index.js'

function claim(h: ReturnType<typeof makeService>, id: 'C-1' | 'C-2'): string {
  const res = h.service.recordClaim({ workstreamId: 'WS-1', statement: `claim ${id}` })
  expect(res.claimId).toBe(id)
  return id
}

function fact(h: ReturnType<typeof makeService>, id: 'F-1'): string {
  const res = h.service.recordFact({ workstreamId: 'WS-1', statement: `fact ${id}` })
  expect(res.factId).toBe(id)
  return id
}

describe('addRelation (D §13.2 / §8)', () => {
  it('adds CLAIM SUPPORTED_BY FACT: REL-1, owner derived from the source row', () => {
    const h = makeService()
    try {
      claim(h, 'C-1')
      fact(h, 'F-1')
      const res = h.service.addRelation({
        source: { kind: 'CLAIM', id: 'C-1' },
        relationType: 'SUPPORTED_BY',
        target: { kind: 'FACT', id: 'F-1' },
      })
      expect(res.relationId).toBe('REL-1')
      expect(res.status).toBe('ACTIVE')
      expect(res.source).toEqual({ kind: 'CLAIM', id: 'C-1' })
      expect(res.relationType).toBe('SUPPORTED_BY')
      expect(res.target).toEqual({ kind: 'FACT', id: 'F-1' })
      expect(res.eventId).toBe('H-3')

      const row = readSemanticRow(h.store, h.projectId)!.relations.get('REL-1')
      expect(row !== undefined).toBe(true)
      expect(row!.status).toBe('ACTIVE')
      expect(row!.relation_type).toBe('SUPPORTED_BY')

      const ev = findEvent(h.store, 'H-3')!
      expect(ev.eventType).toBe('RELATION_ADDED')
      // Owner = source.ws (the claim's WS-1).
      expect(ev.ownerWorkstreamId).toBe('WS-1')
      expect(ev.payload).toMatchObject({
        relation_id: 'REL-1',
        source: { kind: 'CLAIM', id: 'C-1' },
        relation_type: 'SUPPORTED_BY',
        target: { kind: 'FACT', id: 'F-1' },
      })
    } finally {
      h.close()
    }
  })

  it('a cross-WS TASK→artifact edge ⇒ OWNER_MISMATCH (precheck owns it; reserve→release, gap legal)', () => {
    const h = makeService()
    try {
      const a = h.service.registerArtifact({ workstreamId: 'WS-1', type: 'NOTE', title: 't', uri: 'file:///x' })
      // T-5 belongs to WS-2, A-1 to WS-1. The two frozen owner halves
      // DISAGREE on this edge (precheck's external-aware wsOf(T-5)=WS-2 vs
      // the fold's state-local target.ws=WS-1) — so no owner satisfies both
      // and the cross-WS task→semantic edge is not writable; the
      // external-aware precheck is the first layer to reject it.
      const before = h.allocatorEvents.length
      expectCarrierCode(
        () =>
          h.service.addRelation({
            source: { kind: 'TASK', id: 'T-5' },
            relationType: 'CONSUMES',
            target: { kind: 'ARTIFACT', id: a.artifactId },
          }),
        'OWNER_MISMATCH',
      )
      expect(countEvents(h.store, 'WS-1')).toBe(1) // only the artifact event
      expect(countEvents(h.store, 'WS-2')).toBe(0)
      // The protocol reserved FIRST, the precheck released both (gap legal).
      expect(h.allocatorEvents.slice(before).map((e) => `${e.op}:${e.id}`)).toEqual([
        'reserve:REL-1',
        'reserve:H-2',
        'release:REL-1',
        'release:H-2',
      ])
      // SAME-WS cross-kind edges ARE writable: all three layers (precheck /
      // registry / fold) agree on owner WS-1.
      const ok = h.service.addRelation({
        source: { kind: 'TASK', id: 'T-1' },
        relationType: 'CONSUMES',
        target: { kind: 'ARTIFACT', id: a.artifactId },
      })
      expect(ok.status).toBe('ACTIVE')
      expect(findEvent(h.store, ok.eventId)!.ownerWorkstreamId).toBe('WS-1')
    } finally {
      h.close()
    }
  })

  it('out-of-table combination ⇒ RELATION_COMBINATION, NO event row', () => {
    const h = makeService()
    try {
      fact(h, 'F-1')
      // SUPPORTED_BY sources are CLAIM only — TASK is not a source.
      expectCarrierCode(
        () =>
          h.service.addRelation({
            source: { kind: 'TASK', id: 'T-1' },
            relationType: 'SUPPORTED_BY',
            target: { kind: 'FACT', id: 'F-1' },
          }),
        'RELATION_COMBINATION',
      )
      expect(countEvents(h.store, 'WS-1')).toBe(1) // only the fact
    } finally {
      h.close()
    }
  })

  it('unknown relation type ⇒ RELATION_TYPE_UNKNOWN (the 10-type pin)', () => {
    const h = makeService()
    try {
      fact(h, 'F-1')
      expectCarrierCode(
        () =>
          h.service.addRelation({
            source: { kind: 'CLAIM', id: 'C-1' },
            relationType: 'SUPPORTS_X' as unknown as RelationType,
            target: { kind: 'FACT', id: 'F-1' },
          }),
        'RELATION_TYPE_UNKNOWN',
      )
    } finally {
      h.close()
    }
  })

  it('a §8 reverse form ⇒ RELATION_TYPE_UNKNOWN (INV-REL-2)', () => {
    const h = makeService()
    try {
      fact(h, 'F-1')
      expectCarrierCode(
        () =>
          h.service.addRelation({
            source: { kind: 'CLAIM', id: 'C-1' },
            relationType: 'SUPPORTS' as unknown as RelationType,
            target: { kind: 'FACT', id: 'F-1' },
          }),
        'RELATION_TYPE_UNKNOWN',
      )
    } finally {
      h.close()
    }
  })

  it('self-loop ⇒ RELATION_SELF_LOOP', () => {
    const h = makeService()
    try {
      expectCarrierCode(
        () =>
          h.service.addRelation({
            source: { kind: 'TASK', id: 'T-1' },
            relationType: 'DEPENDS_ON',
            target: { kind: 'TASK', id: 'T-1' },
          }),
        'RELATION_SELF_LOOP',
      )
      expect(countEvents(h.store, 'WS-1')).toBe(0)
    } finally {
      h.close()
    }
  })

  it('duplicate 5-tuple ⇒ RELATION_DUPLICATE', () => {
    const h = makeService()
    try {
      claim(h, 'C-1')
      fact(h, 'F-1')
      h.service.addRelation({ source: { kind: 'CLAIM', id: 'C-1' }, relationType: 'SUPPORTED_BY', target: { kind: 'FACT', id: 'F-1' } })
      expectCarrierCode(
        () =>
          h.service.addRelation({ source: { kind: 'CLAIM', id: 'C-1' }, relationType: 'SUPPORTED_BY', target: { kind: 'FACT', id: 'F-1' } }),
        'RELATION_DUPLICATE',
      )
      expect(countEvents(h.store, 'WS-1')).toBe(3) // unchanged
    } finally {
      h.close()
    }
  })

  it('reverse duplicate ⇒ RELATION_REVERSE_DUPLICATE (RELATED_TO — the unique symmetric type, §8)', () => {
    const h = makeService()
    try {
      claim(h, 'C-1')
      claim(h, 'C-2')
      // Only RELATED_TO has a reverse direction expressible inside the
      // frozen 10-type set — for every other type the reverse of a legal
      // edge is a DISTINCT legal edge (findReverseDuplicateEdge, frozen).
      h.service.addRelation({ source: { kind: 'CLAIM', id: 'C-1' }, relationType: 'RELATED_TO', target: { kind: 'CLAIM', id: 'C-2' } })
      expectCarrierCode(
        () =>
          h.service.addRelation({ source: { kind: 'CLAIM', id: 'C-2' }, relationType: 'RELATED_TO', target: { kind: 'CLAIM', id: 'C-1' } }),
        'RELATION_REVERSE_DUPLICATE',
      )
      expect(countEvents(h.store, 'WS-1')).toBe(3) // unchanged
    } finally {
      h.close()
    }
  })

  it('unresolvable endpoints ⇒ OBJECT_NOT_FOUND (catalog §4 特例) — two layers, two failure points', () => {
    const h = makeService()
    try {
      // (a) Unknown WORKSTREAM endpoints: the frozen owner rule is
      // WORKSTREAM → itself (existence is NOT part of owner resolution),
      // so the write proceeds to the protocol and the REGISTRY existence
      // check rejects it in-tx — reserve→release, gap legal (§1.1).
      expectCarrierCode(
        () =>
          h.service.addRelation({
            source: { kind: 'WORKSTREAM', id: 'WS-9' },
            relationType: 'RELATED_TO',
            target: { kind: 'WORKSTREAM', id: 'WS-8' },
          }),
        'OBJECT_NOT_FOUND',
      )
      expect(countEvents(h.store, 'WS-1')).toBe(0)
      expect(countEvents(h.store, 'WS-2')).toBe(0)
      expect(h.allocatorEvents.map((e) => `${e.op}:${e.id}`)).toEqual([
        'reserve:REL-1',
        'reserve:H-1',
        'release:REL-1',
        'release:H-1',
      ])
      // (b) TASK endpoints that no workstream owns: neither the state-local
      // half (no derived row) nor the plan-index fallback resolves — the
      // service-level owner resolution throws BEFORE any reservation.
      expectCarrierCode(
        () =>
          h.service.addRelation({
            source: { kind: 'TASK', id: 'T-9' },
            relationType: 'DEPENDS_ON',
            target: { kind: 'TASK', id: 'T-8' },
          }),
        'OBJECT_NOT_FOUND',
      )
      expect(countEvents(h.store, 'WS-1')).toBe(0)
      expect(h.allocatorEvents.map((e) => `${e.op}:${e.id}`)).toEqual([
        'reserve:REL-1',
        'reserve:H-1',
        'release:REL-1',
        'release:H-1',
      ])
    } finally {
      h.close()
    }
  })

  it('a never-recorded CLAIM endpoint ⇒ OBJECT_NOT_FOUND (the registry hook enforces endpoint existence, in-tx)', () => {
    const h = makeService()
    try {
      fact(h, 'F-1')
      // C-9 was never recorded. The domain layers (precheck + fold) check
      // shape + owner resolvability only — endpoint EXISTENCE is owned by
      // the composed REGISTRY validate hook (ADJ-4, in-tx); the service
      // maps RB_EVENT_REJECTED → its first error code.
      const before = h.allocatorEvents.length
      expectCarrierCode(
        () =>
          h.service.addRelation({
            source: { kind: 'CLAIM', id: 'C-9' },
            relationType: 'SUPPORTED_BY',
            target: { kind: 'FACT', id: 'F-1' },
          }),
        'OBJECT_NOT_FOUND',
      )
      expect(countEvents(h.store, 'WS-1')).toBe(1) // unchanged
      // reserve→(precheck ok)→in-tx reject→release: the gap is legal.
      expect(h.allocatorEvents.slice(before).map((e) => `${e.op}:${e.id}`)).toEqual([
        'reserve:REL-1',
        'reserve:H-2',
        'release:REL-1',
        'release:H-2',
      ])
    } finally {
      h.close()
    }
  })
})

describe('removeRelation (D §13.2 / §5.5 audit mirror)', () => {
  it('removes an ACTIVE relation: REMOVED + the §5.5 mirror in the payload', () => {
    const h = makeService()
    try {
      claim(h, 'C-1')
      fact(h, 'F-1')
      const r = h.service.addRelation({
        source: { kind: 'CLAIM', id: 'C-1' },
        relationType: 'SUPPORTED_BY',
        target: { kind: 'FACT', id: 'F-1' },
      })
      const res = h.service.removeRelation({ relationId: r.relationId, reason: 'edge retracted' })
      expect(res.relationId).toBe('REL-1')
      expect(res.status).toBe('REMOVED')
      expect(res.eventId).toBe('H-4')

      const row = readSemanticRow(h.store, h.projectId)!.relations.get('REL-1')
      expect(row!.status).toBe('REMOVED')

      const ev = findEvent(h.store, 'H-4')!
      expect(ev.eventType).toBe('RELATION_REMOVED')
      // §5.5: the removal payload mirrors the STORED 5-tuple.
      expect(ev.payload).toMatchObject({
        relation_id: 'REL-1',
        source: { kind: 'CLAIM', id: 'C-1' },
        relation_type: 'SUPPORTED_BY',
        target: { kind: 'FACT', id: 'F-1' },
        reason: 'edge retracted',
      })
    } finally {
      h.close()
    }
  })

  it('removing a missing relation ⇒ OBJECT_NOT_FOUND', () => {
    const h = makeService()
    try {
      expectCarrierCode(() => h.service.removeRelation({ relationId: 'REL-9' }), 'OBJECT_NOT_FOUND')
      expect(countEvents(h.store, 'WS-1')).toBe(0)
    } finally {
      h.close()
    }
  })

  it('re-removing a REMOVED relation ⇒ WRONG_STATE (terminal, ADJ-10)', () => {
    const h = makeService()
    try {
      claim(h, 'C-1')
      fact(h, 'F-1')
      const r = h.service.addRelation({
        source: { kind: 'CLAIM', id: 'C-1' },
        relationType: 'SUPPORTED_BY',
        target: { kind: 'FACT', id: 'F-1' },
      })
      h.service.removeRelation({ relationId: r.relationId })
      expectCarrierCode(() => h.service.removeRelation({ relationId: r.relationId }), 'WRONG_STATE')
      expect(countEvents(h.store, 'WS-1')).toBe(4) // unchanged
    } finally {
      h.close()
    }
  })
})
