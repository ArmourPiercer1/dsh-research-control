// V2-UI-0.4 UI-7 (D1) — recordFact (FACT_RECORDED, D §13.2): the happy
// path (fresh F-/H- ids, ACTIVE const status, the derived row, the event
// row, ADJ-1: no management_action row) + the ADJ-3 pre-validation
// failure (empty statement ⇒ no event row, the reserved id is released
// and the gap is legal).

import { describe, expect, it } from 'vitest'
import { makeService, readSemanticRow, countEvents, findEvent, T0 } from './harness.js'
import { expectCarrierCode, countDerivedKind } from './helpers.js'

describe('recordFact (D §13.2)', () => {
  it('records a fact: F-1 / H-1, ACTIVE, derived row + event row, no management_action', () => {
    const h = makeService()
    try {
      const res = h.service.recordFact({
        workstreamId: 'WS-1',
        statement: 'the model converged at epoch 12',
      })
      expect(res.factId).toBe('F-1')
      expect(res.workstreamId).toBe('WS-1')
      expect(res.statement).toBe('the model converged at epoch 12')
      expect(res.references).toEqual([])
      expect(res.status).toBe('ACTIVE')
      expect(res.recordedAt).toBeGreaterThanOrEqual(T0)
      expect(res.eventId).toBe('H-1')

      // The derived row (production codec).
      const state = readSemanticRow(h.store, h.projectId)
      expect(state !== undefined).toBe(true)
      const row = state!.facts.get('F-1')
      expect(row !== undefined).toBe(true)
      expect(row!.id).toBe('F-1')
      expect(row!.workstream_id).toBe('WS-1')
      expect(row!.statement).toBe('the model converged at epoch 12')
      expect(row!.status).toBe('ACTIVE')
      expect(row!.created_by).toEqual({ kind: 'USER' })

      // The raw log row (owner = the workstream, snake_case payload).
      const ev = findEvent(h.store, 'H-1')
      expect(ev !== undefined).toBe(true)
      expect(ev!.ownerWorkstreamId).toBe('WS-1')
      expect(ev!.eventType).toBe('FACT_RECORDED')
      expect(ev!.schemaVersion).toBe(1)
      expect(ev!.actor).toEqual({ kind: 'USER' })
      expect(ev!.payload).toMatchObject({
        fact_id: 'F-1',
        statement: 'the model converged at epoch 12',
      })
      expect(countEvents(h.store, 'WS-1')).toBe(1)

      // ADJ-1: the seven writes do NOT write a management_action row.
      expect(countDerivedKind(h.store, 'management_action')).toBe(0)

      // Allocator lifecycle: the sequence is burned on reserve, confirmed on commit.
      const kinds = h.allocatorEvents.map((e) => `${e.op}:${e.kind}:${e.id}`)
      expect(kinds).toEqual(['reserve:FACT:F-1', 'reserve:HISTORY_EVENT:H-1', 'commit:FACT:F-1', 'commit:HISTORY_EVENT:H-1'])
    } finally {
      h.close()
    }
  })

  it('carries references through (fresh result array; snake_case payload)', () => {
    const h = makeService()
    try {
      const refs = ['T-1', 'note:baseline']
      const res = h.service.recordFact({ workstreamId: 'WS-1', statement: 's', references: refs })
      expect(res.references).toEqual(['T-1', 'note:baseline'])
      expect(res.references).not.toBe(refs) // fresh array (the wire shape)
      res.references.push('mutated')
      expect(refs).toEqual(['T-1', 'note:baseline'])

      const ev = findEvent(h.store, res.eventId)!
      expect(ev.payload).toMatchObject({ fact_id: res.factId, statement: 's', references: ['T-1', 'note:baseline'] })

      const row = readSemanticRow(h.store, h.projectId)!.facts.get(res.factId)
      expect(row!.references).toEqual(['T-1', 'note:baseline'])
    } finally {
      h.close()
    }
  })

  it('empty statement ⇒ INVALID_PAYLOAD carrier, NO event row, id released (gap legal)', () => {
    const h = makeService()
    try {
      expectCarrierCode(() => h.service.recordFact({ workstreamId: 'WS-1', statement: '' }), 'INVALID_PAYLOAD')

      // ADJ-3: zero event rows; the derived row never materialized.
      expect(countEvents(h.store, 'WS-1')).toBe(0)
      expect(readSemanticRow(h.store, h.projectId)).toBeUndefined()

      // The reservation was released (both ids — object + event); the gap is legal.
      expect(h.allocatorEvents.map((e) => `${e.op}:${e.id}`)).toEqual([
        'reserve:F-1',
        'reserve:H-1',
        'release:F-1',
        'release:H-1',
      ])

      // The next fact takes F-2 (monotonic — the gap is never reused).
      const res = h.service.recordFact({ workstreamId: 'WS-1', statement: 'ok' })
      expect(res.factId).toBe('F-2')
      expect(res.eventId).toBe('H-2')
    } finally {
      h.close()
    }
  })

  it('the event owner is the given workstream (listRange of that ws sees it)', () => {
    const h = makeService()
    try {
      const res = h.service.recordFact({ workstreamId: 'WS-2', statement: 's' })
      expect(h.store.listRange('WS-2', 1).map((e) => e.eventType)).toEqual(['FACT_RECORDED'])
      expect(h.store.listRange('WS-1', 1)).toEqual([])
      expect(res.factId).toBe('F-1')
    } finally {
      h.close()
    }
  })
})
