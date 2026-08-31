// V2-UI-0.4 UI-7 (D1) — recordClaim (CLAIM_RECORDED, D §13.2): the happy
// path (fresh C-/H- ids, ACTIVE) + the ADJ-3 pre-validation failure
// (empty statement ⇒ no event row, ids released).

import { describe, expect, it } from 'vitest'
import { makeService, readSemanticRow, countEvents, findEvent } from './harness.js'
import { expectCarrierCode, countDerivedKind } from './helpers.js'

describe('recordClaim (D §13.2)', () => {
  it('records a claim: C-1 / H-1, ACTIVE, derived row + event row', () => {
    const h = makeService()
    try {
      const res = h.service.recordClaim({ workstreamId: 'WS-1', statement: 'the ablation explains the gain' })
      expect(res.claimId).toBe('C-1')
      expect(res.workstreamId).toBe('WS-1')
      expect(res.statement).toBe('the ablation explains the gain')
      expect(res.references).toEqual([])
      expect(res.status).toBe('ACTIVE')
      expect(res.eventId).toBe('H-1')

      const row = readSemanticRow(h.store, h.projectId)!.claims.get('C-1')
      expect(row !== undefined).toBe(true)
      expect(row!.workstream_id).toBe('WS-1')
      expect(row!.status).toBe('ACTIVE')
      expect(row!.created_by).toEqual({ kind: 'USER' })

      const ev = findEvent(h.store, 'H-1')!
      expect(ev.eventType).toBe('CLAIM_RECORDED')
      expect(ev.ownerWorkstreamId).toBe('WS-1')
      expect(ev.payload).toMatchObject({ claim_id: 'C-1', statement: 'the ablation explains the gain' })
      expect(countEvents(h.store, 'WS-1')).toBe(1)
      expect(countDerivedKind(h.store, 'management_action')).toBe(0)
    } finally {
      h.close()
    }
  })

  it('facts and claims share the event-id sequence (H is project-wide)', () => {
    const h = makeService()
    try {
      const f = h.service.recordFact({ workstreamId: 'WS-1', statement: 'f' })
      const c = h.service.recordClaim({ workstreamId: 'WS-1', statement: 'c' })
      expect(f.eventId).toBe('H-1')
      expect(c.eventId).toBe('H-2')
    } finally {
      h.close()
    }
  })

  it('empty statement ⇒ INVALID_PAYLOAD carrier, NO event row, ids released', () => {
    const h = makeService()
    try {
      expectCarrierCode(() => h.service.recordClaim({ workstreamId: 'WS-1', statement: '' }), 'INVALID_PAYLOAD')
      expect(countEvents(h.store, 'WS-1')).toBe(0)
      expect(h.allocatorEvents.map((e) => `${e.op}:${e.id}`)).toEqual([
        'reserve:C-1',
        'reserve:H-1',
        'release:C-1',
        'release:H-1',
      ])
      const res = h.service.recordClaim({ workstreamId: 'WS-1', statement: 'ok' })
      expect(res.claimId).toBe('C-2')
    } finally {
      h.close()
    }
  })
})
