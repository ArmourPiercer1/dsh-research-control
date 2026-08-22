/**
 * WP-2.5 — reducer determinism (HISTORY_EVENT_CATALOG §2; TC-HIST-002/004/005
 * derived-state halves).
 *
 *  - idempotent replay: the same stream folded N times is byte-identical;
 *  - dual-order agreement: audit-order fold ≡ semantic-order fold for every
 *    stream in which BOTH orderings are valid derivation orders — including
 *    late registrations (occurredAt in the past, eventSeq at the tail,
 *    TC-HIST-002) and equal-occurredAt tie-breaks (TC-HIST-004);
 *  - the orderings implement §2 exactly (occurred_at, event_seq / event_seq;
 *    total, deterministic tie-breaks) and agree with the WP-2.2 registry
 *    sorters on the same inputs (mechanical sync check);
 *  - the documented asymmetry: the derived state is the AUDIT-order fold
 *    (catalog §6 重放: 「从空 DB 按 audit 顺序重放全部事件」). A stream whose
 *    SEMANTIC order inverts a state-machine dependency (late retraction with
 *    occurredAt earlier than its record) folds loudly in semantic order and
 *    normally in audit order — both behaviors are pinned here.
 */
import { describe, expect, it } from 'vitest'

import {
  foldSemanticEvents,
  initialSemanticState,
  orderByAudit,
  orderBySemantic,
  reduceSemanticEvent,
  SemanticDomainError,
  type SemanticInputEvent,
} from '../../src/host/domain/semantics/index.js'
import { auditOrder as registryAuditOrder, semanticOrder as registrySemanticOrder } from '../../src/host/history/registry/index.js'
import { canonicalJson, event } from './fixtures.js'

const T0 = Date.parse('2026-08-22T09:00:00Z')

/**
 * The canonical dual-timeline stream (audit order = eventSeq order):
 *  - seq 1..4: punctual events, occurredAt increasing;
 *  - seq 5: LATE registration — a fact recorded "last week"
 *    (occurredAt T0-1d) appended at the tail (TC-HIST-002);
 *  - seq 3/4/6/7: equal occurredAt (T0+2h) → eventSeq tie-break (TC-HIST-004);
 *  - a CLAIM_RETRACTED with occurredAt between two punctual events.
 */
function dualTimelineStream(): SemanticInputEvent[] {
  return [
    event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 's1' }, { eventSeq: 1, eventId: 'H-1', occurredAt: T0 }),
    event('FACT_RECORDED', { fact_id: 'F-1', statement: 'f1' }, { eventSeq: 2, eventId: 'H-2', occurredAt: T0 + 3600_000 }),
    event('CLAIM_RECORDED', { claim_id: 'C-2', statement: 's2' }, { eventSeq: 3, eventId: 'H-3', occurredAt: T0 + 7200_000 }),
    event('RELATION_ADDED', { relation_id: 'REL-1', source: { kind: 'CLAIM', id: 'C-1' }, relation_type: 'CONTRADICTED_BY', target: { kind: 'FACT', id: 'F-1' } }, { eventSeq: 4, eventId: 'H-4', occurredAt: T0 + 2 * 3600_000 }),
    event('FACT_RECORDED', { fact_id: 'F-2', statement: 'back-filled last week' }, { eventSeq: 5, eventId: 'H-5', occurredAt: T0 - 86_400_000 }),
    event('ARTIFACT_REGISTERED', { artifact_id: 'A-1', type: 'DATASET', title: 't', uri: 'u' }, { eventSeq: 6, eventId: 'H-6', occurredAt: T0 + 2 * 3600_000 }),
    event('CLAIM_RETRACTED', { claim_id: 'C-2' }, { eventSeq: 7, eventId: 'H-7', occurredAt: T0 + 2 * 3600_000 }),
  ]
}

describe('idempotent replay (TC-HIST-005 derived-state half)', () => {
  it('folding the same stream twice (audit order) is byte-identical', () => {
    const stream = dualTimelineStream()
    const a = foldSemanticEvents(orderByAudit(stream))
    const b = foldSemanticEvents(orderByAudit(stream))
    expect(canonicalJson(a)).toBe(canonicalJson(b))
    expect(a.claims).toEqual(b.claims)
    expect(a.conflict).toEqual(b.conflict)
  })

  it('folding three times in semantic order is byte-identical too', () => {
    const stream = dualTimelineStream()
    const [a, b, c] = [0, 1, 2].map(() => foldSemanticEvents(orderBySemantic(stream)))
    expect(canonicalJson(a)).toBe(canonicalJson(b))
    expect(canonicalJson(b)).toBe(canonicalJson(c))
  })
})

describe('dual-order agreement (catalog §2: audit ≡ semantic for valid derivation orders)', () => {
  it('the late-registered fact lands at the tail in audit order but mid-timeline in semantic order — and both folds agree', () => {
    const stream = dualTimelineStream()
    const audit = orderByAudit(stream)
    const semantic = orderBySemantic(stream)
    // TC-HIST-002: late event stays at the TAIL in audit order…
    expect(audit.map((e) => e.eventId)).toEqual(['H-1', 'H-2', 'H-3', 'H-4', 'H-5', 'H-6', 'H-7'])
    // …but is inserted at its TIME position in the semantic timeline (H-5 first: T0-1d):
    // H-3/H-4/H-6/H-7 all @ T0+2h tie-break on eventSeq (3 < 4 < 6 < 7) — the
    // deterministic TC-HIST-004 tie-break.
    expect(semantic.map((e) => e.eventId)).toEqual(['H-5', 'H-1', 'H-2', 'H-3', 'H-4', 'H-6', 'H-7'])
    expect(semantic[3].eventId).toBe('H-3')
    // …and both folds of the SAME (valid) stream produce the same derived state.
    // (Container insertion order legitimately tracks the fold order — the F-2
    // row is created first in the semantic timeline — so the cross-order
    // comparison is deep-equality; the byte-identical pin below is for the
    // SAME-order idempotency case where insertion order must also agree.)
    const stateAudit = foldSemanticEvents(audit)
    const stateSemantic = foldSemanticEvents(semantic)
    expect(stateSemantic).toEqual(stateAudit)
    expect(canonicalJson(stateSemantic)).not.toBe(canonicalJson(stateAudit)) // F-1/F-2 insertion order differs by design
    expect(stateSemantic.claims.get('C-2')?.status).toBe('RETRACTED')
    expect(stateSemantic.facts.size).toBe(2)
    expect(stateSemantic.conflict.get('C-1')?.relationIds).toEqual(['REL-1'])
  })

  it('equal occurredAt: the eventSeq tie-break is deterministic across repeated folds (TC-HIST-004)', () => {
    const stream: SemanticInputEvent[] = [
      event('FACT_RECORDED', { fact_id: 'F-3', statement: 'later seq' }, { eventSeq: 2, eventId: 'H-2', occurredAt: T0 }),
      event('FACT_RECORDED', { fact_id: 'F-4', statement: 'earlier seq' }, { eventSeq: 1, eventId: 'H-1', occurredAt: T0 }),
      event('FACT_RECORDED', { fact_id: 'F-5', statement: 'same ts, other ws' }, { eventSeq: 1, eventId: 'H-3', occurredAt: T0, ownerWorkstreamId: 'WS-2' }),
    ]
    const order1 = orderBySemantic(stream).map((e) => e.eventId)
    const order2 = orderBySemantic(stream).map((e) => e.eventId)
    expect(order1).toEqual(order2)
    // (occurredAt, eventSeq, owner, id) total order: H-1 (seq1,WS-1) < H-3 (seq1,WS-2) < H-2 (seq2)
    expect(order1).toEqual(['H-1', 'H-3', 'H-2'])
  })

  it('audit vs semantic folds agree on a stream of pure creations (fully order-independent)', () => {
    const stream: SemanticInputEvent[] = [
      event('FACT_RECORDED', { fact_id: 'F-1', statement: 'a' }, { eventSeq: 3, eventId: 'H-3', occurredAt: T0 + 3000 }),
      event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 'b' }, { eventSeq: 1, eventId: 'H-1', occurredAt: T0 + 1000 }),
      event('ARTIFACT_REGISTERED', { artifact_id: 'A-1', type: 'NOTE', title: 'c', uri: 'u' }, { eventSeq: 2, eventId: 'H-2', occurredAt: T0 + 2000 }),
    ]
    const a = foldSemanticEvents(orderByAudit(stream))
    const b = foldSemanticEvents(orderBySemantic(stream))
    const c = foldSemanticEvents(stream) // already audit-ordered
    expect(canonicalJson(a)).toBe(canonicalJson(b))
    expect(canonicalJson(b)).toBe(canonicalJson(c))
  })
})

describe('the documented asymmetry: derived state is the audit-order fold (catalog §6)', () => {
  it('a late RETRACTION with occurredAt before its record: audit fold succeeds, semantic fold fails LOUDLY', () => {
    // write-time validity held (at seq 2 the claim existed); the semantic
    // timeline inverts the dependency — the derived state is defined by the
    // AUDIT order, so the semantic-order fold must fail, not silently diverge.
    const stream: SemanticInputEvent[] = [
      event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 's' }, { eventSeq: 1, eventId: 'H-1', occurredAt: T0 + 1000 }),
      event('CLAIM_RETRACTED', { claim_id: 'C-1' }, { eventSeq: 2, eventId: 'H-2', occurredAt: T0 }), // late: T0 < T0+1000
    ]
    // audit order: record (seq1) → retract (seq2): valid derivation
    const audit = foldSemanticEvents(orderByAudit(stream))
    expect(audit.claims.get('C-1')?.status).toBe('RETRACTED')
    // semantic order: retract (T0) → record (T0+1000): the retraction hits a
    // nonexistent claim → fail loud (the fold must not produce a ghost row)
    const semantic = orderBySemantic(stream)
    expect(semantic.map((e) => e.eventId)).toEqual(['H-2', 'H-1'])
    let threw: unknown = null
    try {
      foldSemanticEvents(semantic)
    } catch (err) {
      threw = err
    }
    expect(threw).toBeInstanceOf(SemanticDomainError)
    expect((threw as SemanticDomainError).code).toBe('OBJECT_NOT_FOUND')
  })

  it('incremental (audit-position) folds agree with the batch replay of the same stream', () => {
    const stream = dualTimelineStream()
    // batch replay from empty…
    const batch = foldSemanticEvents(orderByAudit(stream))
    // …and incremental application one event at a time (the maintenance path)
    let incremental = undefined
    for (const e of orderByAudit(stream)) {
      incremental = reduceSemanticEvent(incremental ?? initialSemanticState(), e)
    }
    expect(canonicalJson(incremental)).toBe(canonicalJson(batch))
  })
})


describe('orderings ≡ WP-2.2 registry sorters (mechanical sync check, catalog §2)', () => {
  it('orderByAudit ≡ registry auditOrder on the same inputs', () => {
    const stream = dualTimelineStream()
    // fixture events all carry eventSeq, so the boundary cast to the
    // registry's OrderedEvent (eventSeq required) is sound here:
    const asOrdered = stream as Parameters<typeof registryAuditOrder>[0]
    expect(orderByAudit(stream).map((e) => e.eventId)).toEqual(registryAuditOrder(asOrdered).map((e) => e.eventId))
    const scrambled = [...stream].reverse()
    expect(orderByAudit(scrambled).map((e) => e.eventId)).toEqual(registryAuditOrder(scrambled as Parameters<typeof registryAuditOrder>[0]).map((e) => e.eventId))
  })

  it('orderBySemantic ≡ registry semanticOrder on the same inputs (incl. the tie-breaks)', () => {
    const stream = dualTimelineStream()
    const asOrdered = stream as Parameters<typeof registrySemanticOrder>[0]
    expect(orderBySemantic(stream).map((e) => e.eventId)).toEqual(registrySemanticOrder(asOrdered).map((e) => e.eventId))
    const scrambled = [...stream].reverse()
    expect(orderBySemantic(scrambled).map((e) => e.eventId)).toEqual(registrySemanticOrder(scrambled as Parameters<typeof registrySemanticOrder>[0]).map((e) => e.eventId))
  })

  it('the sorters are pure (input arrays are not reordered in place)', () => {
    const stream = dualTimelineStream()
    const before = stream.map((e) => e.eventId).join(',')
    orderByAudit(stream)
    orderBySemantic(stream)
    expect(stream.map((e) => e.eventId).join(',')).toBe(before)
  })
})
