// V2-UI-0.4 UI-7 (D2) — retractClaim (CLAIM_RETRACTED, D §13.2): the
// state machine (ACTIVE → RETRACTED, terminal — ADJ-10) + the owner is
// derived from the stored row (no workstreamId parameter — locked
// decision: the cross-WS mismatch is unreachable through this face).

import { describe, expect, it } from 'vitest'
import { makeService, readSemanticRow, countEvents, findEvent } from './harness.js'
import { expectCarrierCode } from './helpers.js'

describe('retractClaim (D §13.2, ADJ-10 terminal)', () => {
  it('retracts an ACTIVE claim: RETRACTED + reason in the payload', () => {
    const h = makeService()
    try {
      const c = h.service.recordClaim({ workstreamId: 'WS-1', statement: 'the ablation explains the gain' })
      const res = h.service.retractClaim({ claimId: c.claimId, reason: 'contradicted by the rerun' })
      expect(res.claimId).toBe('C-1')
      expect(res.status).toBe('RETRACTED')
      expect(res.eventId).toBe('H-2')

      const row = readSemanticRow(h.store, h.projectId)!.claims.get('C-1')
      expect(row!.status).toBe('RETRACTED')

      const ev = findEvent(h.store, 'H-2')!
      expect(ev.eventType).toBe('CLAIM_RETRACTED')
      // The event lands in the claim's own workstream (owner derived from
      // the stored row, not a parameter).
      expect(ev.ownerWorkstreamId).toBe('WS-1')
      expect(ev.payload).toMatchObject({ claim_id: 'C-1', reason: 'contradicted by the rerun' })
      expect(countEvents(h.store, 'WS-1')).toBe(2)
    } finally {
      h.close()
    }
  })

  it('reason is optional (absent from the payload)', () => {
    const h = makeService()
    try {
      const c = h.service.recordClaim({ workstreamId: 'WS-1', statement: 's' })
      h.service.retractClaim({ claimId: c.claimId })
      const ev = findEvent(h.store, 'H-2')!
      expect(ev.payload).toEqual({ claim_id: 'C-1' })
    } finally {
      h.close()
    }
  })

  it('retracting a missing claim ⇒ OBJECT_NOT_FOUND, NO event row', () => {
    const h = makeService()
    try {
      expectCarrierCode(() => h.service.retractClaim({ claimId: 'C-9' }), 'OBJECT_NOT_FOUND')
      expect(countEvents(h.store, 'WS-1')).toBe(0)
      expect(countEvents(h.store, 'WS-2')).toBe(0)
    } finally {
      h.close()
    }
  })

  it('re-retracting a RETRACTED claim ⇒ WRONG_STATE (terminal, ADJ-10), NO event row', () => {
    const h = makeService()
    try {
      const c = h.service.recordClaim({ workstreamId: 'WS-1', statement: 's' })
      h.service.retractClaim({ claimId: c.claimId })
      expectCarrierCode(() => h.service.retractClaim({ claimId: c.claimId }), 'WRONG_STATE')
      expect(countEvents(h.store, 'WS-1')).toBe(2) // unchanged
    } finally {
      h.close()
    }
  })
})
