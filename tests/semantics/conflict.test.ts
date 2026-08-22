/**
 * WP-2.5 — the mechanical conflict flag (INV-SCI-2: 不做科学判断).
 *
 * DOMAIN_SCHEMA §7 defines NO conflict-marking rule; per the WP-2.5 boundary
 * the marker is the minimal 「待人工」 (PENDING_REVIEW) flag, driven SOLELY
 * by the existence of an ACTIVE CONTRADICTED_BY edge with the claim as
 * SOURCE (§8: 「证据冲突（只记录，不推理）」). These tests pin the
 * MECHANICAL nature: the flag is independent of statement content
 * (identical statements get flagged when the edge says so; contradicting
 * statements get no flag when the edge doesn't) and independent of artifact
 * identity (no content-level "same artifact" inference is performed).
 */
import { describe, expect, it } from 'vitest'

import {
  CONFLICT_EDGE_TYPE,
  conflictEdgesOf,
  conflictFlagOf,
  deriveConflictFlags,
  foldSemanticEvents,
  isConflictPendingReview,
  type SemanticState,
} from '../../src/host/domain/semantics/index.js'
import { event } from './fixtures.js'

/** Build a state: claims recorded first, then the relations applied in order. */
function build(claims: string[], relations: unknown[]): SemanticState {
  return foldSemanticEvents([
    ...claims.map((c, i) => event('CLAIM_RECORDED', { claim_id: c, statement: `statement of ${c}` }, { eventSeq: i + 1 })),
    ...relations.map((payload, i) => event('RELATION_ADDED', payload, { eventSeq: claims.length + i + 1 })),
  ])
}

describe('conflict flag: set/cleared by CONTRADICTED_BY edges (mechanical)', () => {
  it('CONTRADICTED_EDGE_TYPE is the §8 CONTRADICTED_BY relation type', () => {
    expect(CONFLICT_EDGE_TYPE).toBe('CONTRADICTED_BY')
  })

  it('a claim with an ACTIVE CONTRADICTED_BY outgoing edge gets PENDING_REVIEW', () => {
    const state = build(['C-1', 'C-2'], [
      { relation_id: 'REL-1', source: { kind: 'CLAIM', id: 'C-1' }, relation_type: 'CONTRADICTED_BY', target: { kind: 'CLAIM', id: 'C-2' } },
    ])
    expect(isConflictPendingReview(state, 'C-1')).toBe(true)
    expect(conflictFlagOf(state, 'C-1')).toEqual({ kind: 'PENDING_REVIEW', relationIds: ['REL-1'] })
    expect(isConflictPendingReview(state, 'C-2')).toBe(false) // the TARGET (evidence) is not flagged
  })

  it('the SAME claim with IDENTICAL statements as its counterpart still gets flagged (no content judgment)', () => {
    let state = foldSemanticEvents([
      event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 'X is true' }, { eventSeq: 1 }),
      event('CLAIM_RECORDED', { claim_id: 'C-2', statement: 'X is true' }, { eventSeq: 2 }), // identical text
      event('RELATION_ADDED', {
        relation_id: 'REL-9',
        source: { kind: 'CLAIM', id: 'C-1' },
        relation_type: 'CONTRADICTED_BY',
        target: { kind: 'CLAIM', id: 'C-2' },
      }, { eventSeq: 3 }),
    ])
    void state
    expect(conflictFlagOf(state, 'C-1')?.kind).toBe('PENDING_REVIEW')
  })

  it('contradicting statements WITHOUT any edge get NO flag (the plugin does not detect conflicts — INV-SCI-2)', () => {
    const state = foldSemanticEvents([
      event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 'X is true' }, { eventSeq: 1 }),
      event('CLAIM_RECORDED', { claim_id: 'C-2', statement: 'X is false' }, { eventSeq: 2 }),
    ])
    expect(conflictFlagOf(state, 'C-1')).toBeUndefined()
    expect(conflictFlagOf(state, 'C-2')).toBeUndefined()
    expect(state.conflict.size).toBe(0)
  })

  it('the flag is artifact-agnostic: no "same artifact" content inference is performed (WP-2.5 boundary note)', () => {
    // two claims about the SAME artifact with contradicting statements, no edge → no flag
    let state = foldSemanticEvents([
      event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 'artifact A-1 shows effect' }, { eventSeq: 1 }),
      event('CLAIM_RECORDED', { claim_id: 'C-2', statement: 'artifact A-1 shows no effect' }, { eventSeq: 2 }),
    ])
    void state
    expect(state.conflict.size).toBe(0)
    // and with edges to the same artifact, each SOURCE claim is flagged exactly per its own edges
    state = foldSemanticEvents([
      ...[
        event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 's1' }, { eventSeq: 1 }),
        event('CLAIM_RECORDED', { claim_id: 'C-2', statement: 's2' }, { eventSeq: 2 }),
        event('ARTIFACT_REGISTERED', { artifact_id: 'A-1', type: 'DATASET', title: 't', uri: 'u' }, { eventSeq: 3 }),
        event('RELATION_ADDED', {
          relation_id: 'REL-1',
          source: { kind: 'CLAIM', id: 'C-1' },
          relation_type: 'CONTRADICTED_BY',
          target: { kind: 'ARTIFACT', id: 'A-1' },
        }, { eventSeq: 4 }),
        event('RELATION_ADDED', {
          relation_id: 'REL-2',
          source: { kind: 'CLAIM', id: 'C-2' },
          relation_type: 'CONTRADICTED_BY',
          target: { kind: 'ARTIFACT', id: 'A-1' },
        }, { eventSeq: 5 }),
      ],
    ])
    expect(conflictFlagOf(state, 'C-1')?.relationIds).toEqual(['REL-1'])
    expect(conflictFlagOf(state, 'C-2')?.relationIds).toEqual(['REL-2'])
  })

  it('RELATION_REMOVED clears the flag (mechanical lifecycle)', () => {
    const state = foldSemanticEvents([
      event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 's' }, { eventSeq: 1 }),
      event('CLAIM_RECORDED', { claim_id: 'C-2', statement: 't' }, { eventSeq: 2 }),
      event('RELATION_ADDED', {
        relation_id: 'REL-1',
        source: { kind: 'CLAIM', id: 'C-1' },
        relation_type: 'CONTRADICTED_BY',
        target: { kind: 'CLAIM', id: 'C-2' },
      }, { eventSeq: 3 }),
      event('RELATION_REMOVED', {
        relation_id: 'REL-1',
        source: { kind: 'CLAIM', id: 'C-1' },
        relation_type: 'CONTRADICTED_BY',
        target: { kind: 'CLAIM', id: 'C-2' },
      }, { eventSeq: 4 }),
    ])
    expect(isConflictPendingReview(state, 'C-1')).toBe(false)
    expect(state.relations.get('REL-1')?.status).toBe('REMOVED') // the edge row survives (INV-HIST-7)
  })

  it('CLAIM_RETRACTED clears the flag (a retracted claim needs no review)', () => {
    const state = foldSemanticEvents([
      event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 's' }, { eventSeq: 1 }),
      event('CLAIM_RECORDED', { claim_id: 'C-2', statement: 't' }, { eventSeq: 2 }),
      event('RELATION_ADDED', {
        relation_id: 'REL-1',
        source: { kind: 'CLAIM', id: 'C-1' },
        relation_type: 'CONTRADICTED_BY',
        target: { kind: 'CLAIM', id: 'C-2' },
      }, { eventSeq: 3 }),
      event('CLAIM_RETRACTED', { claim_id: 'C-1' }, { eventSeq: 4 }),
    ])
    expect(isConflictPendingReview(state, 'C-1')).toBe(false)
    expect(state.claims.get('C-1')?.status).toBe('RETRACTED')
  })

  it('multiple edges: relationIds are collected and SORTED (deterministic)', () => {
    const state = foldSemanticEvents([
      event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 's' }, { eventSeq: 1 }),
      event('FACT_RECORDED', { fact_id: 'F-1', statement: 'f' }, { eventSeq: 2 }),
      event('FACT_RECORDED', { fact_id: 'F-2', statement: 'g' }, { eventSeq: 3 }),
      event('RELATION_ADDED', {
        relation_id: 'REL-2',
        source: { kind: 'CLAIM', id: 'C-1' },
        relation_type: 'CONTRADICTED_BY',
        target: { kind: 'FACT', id: 'F-2' },
      }, { eventSeq: 4 }),
      event('RELATION_ADDED', {
        relation_id: 'REL-1',
        source: { kind: 'CLAIM', id: 'C-1' },
        relation_type: 'CONTRADICTED_BY',
        target: { kind: 'FACT', id: 'F-1' },
      }, { eventSeq: 5 }),
    ])
    expect(conflictFlagOf(state, 'C-1')?.relationIds).toEqual(['REL-1', 'REL-2'])
  })

  it('deriveConflictFlags is a pure function of (claims, relations) — recomputing gives the same map', () => {
    const state = build(['C-1', 'C-2'], [
      { relation_id: 'REL-1', source: { kind: 'CLAIM', id: 'C-1' }, relation_type: 'CONTRADICTED_BY', target: { kind: 'CLAIM', id: 'C-2' } },
    ])
    const again = deriveConflictFlags(state)
    expect(again).toEqual(state.conflict)
    expect(conflictEdgesOf(state, 'C-1').map((r) => r.id)).toEqual(['REL-1'])
    expect(conflictEdgesOf(state, 'C-2')).toEqual([])
  })
})
