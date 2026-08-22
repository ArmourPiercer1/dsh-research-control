/**
 * WP-2.5 — reducer negative cases: every event type's reject paths with
 * exact codes (OBJECT_ALREADY_EXISTS / OBJECT_NOT_FOUND / WRONG_STATE /
 * OWNER_MISMATCH / RELATION_* / INVALID_*), plus immutability on failure
 * (a rejected fold leaves the state reference untouched — TC-HIST-001
 * 「且不产生副作用」 for the derived-state half).
 */
import { describe, expect, it } from 'vitest'

import {
  foldSemanticEvents,
  initialSemanticState,
  reduceSemanticEvent,
  SemanticDomainError,
  type SemanticErrorCode,
} from '../../src/host/domain/semantics/index.js'
import { deepFreeze, event, makeState } from './fixtures.js'

function codeOf(throws: () => unknown): SemanticErrorCode | undefined {
  try {
    throws()
  } catch (err) {
    if (err instanceof SemanticDomainError) return err.code
    throw err
  }
  return undefined
}

describe('reducer negatives: creation events (fresh-id rule, catalog §5 「新建」)', () => {
  it('FACT_RECORDED with an existing fact_id → OBJECT_ALREADY_EXISTS @/payload/fact_id', () => {
    const e = event('FACT_RECORDED', { fact_id: 'F-1', statement: 'again' })
    const frozen = deepFreeze(makeState())
    const c = codeOf(() => reduceSemanticEvent(frozen, e))
    expect(c).toBe('OBJECT_ALREADY_EXISTS')
  })

  it('CLAIM_RECORDED with an existing claim_id → OBJECT_ALREADY_EXISTS', () => {
    const e = event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 'again' })
    expect(codeOf(() => reduceSemanticEvent(makeState(), e))).toBe('OBJECT_ALREADY_EXISTS')
  })

  it('ARTIFACT_REGISTERED with an existing artifact_id → OBJECT_ALREADY_EXISTS', () => {
    const e = event('ARTIFACT_REGISTERED', { artifact_id: 'A-1', type: 'NOTE', title: 't', uri: 'u' })
    expect(codeOf(() => reduceSemanticEvent(makeState(), e))).toBe('OBJECT_ALREADY_EXISTS')
  })

  it('RELATION_ADDED with an existing relation_id → OBJECT_ALREADY_EXISTS', () => {
    const e = event('RELATION_ADDED', {
      relation_id: 'REL-1',
      source: { kind: 'TASK', id: 'T-1' },
      relation_type: 'DEPENDS_ON',
      target: { kind: 'TASK', id: 'T-2' },
    })
    expect(codeOf(() => reduceSemanticEvent(makeState(), e))).toBe('OBJECT_ALREADY_EXISTS')
  })

  it.each([
    ['FACT_RECORDED', { fact_id: 'X-1', statement: 's' }, 'INVALID_ID'],
    ['CLAIM_RECORDED', { claim_id: 'F-1', statement: 's' }, 'INVALID_ID'], // wrong family
    ['CLAIM_RECORDED', { claim_id: 'C-01', statement: 's' }, 'INVALID_ID'], // leading zero
    ['CLAIM_RECORDED', { claim_id: 'C-0', statement: 's' }, 'INVALID_ID'], // zero seq
    ['ARTIFACT_REGISTERED', { artifact_id: 'T-1', type: 'NOTE', title: 't', uri: 'u' }, 'INVALID_ID'],
    ['RELATION_ADDED', { relation_id: 'C-1', source: { kind: 'CLAIM', id: 'C-1' }, relation_type: 'RELATED_TO', target: { kind: 'FACT', id: 'F-1' } }, 'INVALID_ID'],
  ])('%s with %s → %s (§1.1 id 形态)', (_eventType, payload, expected) => {
    const e = event(_eventType, payload)
    expect(codeOf(() => reduceSemanticEvent(makeState(), e))).toBe(expected)
  })

  it('creation events with malformed payloads → INVALID_PAYLOAD (no corrupted row is ever built)', () => {
    expect(codeOf(() => reduceSemanticEvent(makeState(), event('FACT_RECORDED', { fact_id: 'F-9', statement: '' })))).toBe('INVALID_PAYLOAD')
    expect(codeOf(() => reduceSemanticEvent(makeState(), event('FACT_RECORDED', { fact_id: 'F-9' })))).toBe('INVALID_PAYLOAD')
    expect(codeOf(() => reduceSemanticEvent(makeState(), event('CLAIM_RECORDED', { claim_id: 'C-9' })))).toBe('INVALID_PAYLOAD')
    expect(codeOf(() => reduceSemanticEvent(makeState(), event('ARTIFACT_REGISTERED', { artifact_id: 'A-9', type: 'NOPE', title: 't', uri: 'u' })))).toBe('INVALID_PAYLOAD')
    expect(codeOf(() => reduceSemanticEvent(makeState(), event('ARTIFACT_REGISTERED', { artifact_id: 'A-9', type: 'NOTE', title: '', uri: 'u' })))).toBe('INVALID_PAYLOAD')
    expect(codeOf(() => reduceSemanticEvent(makeState(), event('RELATION_ADDED', { relation_id: 'REL-9', relation_type: 'SUPPORTED_BY', target: { kind: 'FACT', id: 'F-1' } })))).toBe('INVALID_PAYLOAD')
  })

  it('malformed envelope owner (not a WS id) → INVALID_ENVELOPE', () => {
    const e = event('FACT_RECORDED', { fact_id: 'F-9', statement: 's' }, { ownerWorkstreamId: 'C-1' })
    expect(codeOf(() => reduceSemanticEvent(makeState(), e))).toBe('INVALID_ENVELOPE')
    const e2 = event('FACT_RECORDED', { fact_id: 'F-9', statement: 's' }, { ownerWorkstreamId: undefined as never })
    expect(codeOf(() => reduceSemanticEvent(makeState(), e2))).toBe('INVALID_ENVELOPE')
  })

  it('missing/malformed envelope actor → INVALID_PAYLOAD @/actor (created_by is a required row field)', () => {
    const e = event('FACT_RECORDED', { fact_id: 'F-9', statement: 's' }, { actor: undefined as never })
    expect(codeOf(() => reduceSemanticEvent(makeState(), e))).toBe('INVALID_PAYLOAD')
  })
})

describe('reducer negatives: mutation events (existence + state machine + owner)', () => {
  it('CLAIM_RETRACTED on a nonexistent claim → OBJECT_NOT_FOUND', () => {
    const e = event('CLAIM_RETRACTED', { claim_id: 'C-99' })
    expect(codeOf(() => reduceSemanticEvent(makeState(), e))).toBe('OBJECT_NOT_FOUND')
  })

  it('CLAIM_RETRACTED with owner ≠ claim.workstream_id → OWNER_MISMATCH', () => {
    const e = event('CLAIM_RETRACTED', { claim_id: 'C-1' }, { ownerWorkstreamId: 'WS-2' })
    expect(codeOf(() => reduceSemanticEvent(makeState(), e))).toBe('OWNER_MISMATCH')
  })

  it('ARTIFACT_MARKED_MISSING on a nonexistent artifact → OBJECT_NOT_FOUND', () => {
    const e = event('ARTIFACT_MARKED_MISSING', { artifact_id: 'A-99' })
    expect(codeOf(() => reduceSemanticEvent(makeState(), e))).toBe('OBJECT_NOT_FOUND')
  })

  it('ARTIFACT_MARKED_MISSING with owner ≠ artifact.workstream_id → OWNER_MISMATCH', () => {
    const e = event('ARTIFACT_MARKED_MISSING', { artifact_id: 'A-1' }, { ownerWorkstreamId: 'WS-9' })
    expect(codeOf(() => reduceSemanticEvent(makeState(), e))).toBe('OWNER_MISMATCH')
  })

  it('RELATION_REMOVED on a nonexistent relation → OBJECT_NOT_FOUND', () => {
    const e = event('RELATION_REMOVED', {
      relation_id: 'REL-99',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
    })
    expect(codeOf(() => reduceSemanticEvent(makeState(), e))).toBe('OBJECT_NOT_FOUND')
  })

  it('RELATION_REMOVED with endpoints ≠ stored edge → RELATION_ENDPOINT_MISMATCH (catalog §5.5 redundancy)', () => {
    const e = event('RELATION_REMOVED', {
      relation_id: 'REL-1',
      source: { kind: 'CLAIM', id: 'C-2' }, // wrong source (stored: C-1)
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
    })
    expect(codeOf(() => reduceSemanticEvent(makeState(), e))).toBe('RELATION_ENDPOINT_MISMATCH')
    const e2 = event('RELATION_REMOVED', {
      relation_id: 'REL-1',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'CONTRADICTED_BY', // wrong type
      target: { kind: 'FACT', id: 'F-1' },
    })
    expect(codeOf(() => reduceSemanticEvent(makeState(), e2))).toBe('RELATION_ENDPOINT_MISMATCH')
  })

  it('ARTIFACT_REGISTERED with a nonexistent supersedes → OBJECT_NOT_FOUND (catalog §5.4 「supersedes 存在」)', () => {
    const e = event('ARTIFACT_REGISTERED', { artifact_id: 'A-9', type: 'NOTE', title: 't', uri: 'u', supersedes: 'A-99' })
    expect(codeOf(() => reduceSemanticEvent(makeState(), e))).toBe('OBJECT_NOT_FOUND')
  })

  it('a rejected fold leaves the input state untouched (same reference, frozen)', () => {
    const frozen = deepFreeze(makeState())
    const e = event('CLAIM_RETRACTED', { claim_id: 'C-99' })
    let threw = false
    try {
      reduceSemanticEvent(frozen, e)
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    expect(frozen.claims.get('C-1')?.status).toBe('ACTIVE') // unchanged
  })

  it('fold stops at the first violating event (no partial application after the failure point)', () => {
    const stream = [
      event('CLAIM_RECORDED', { claim_id: 'C-50', statement: 'ok' }, { eventSeq: 1 }),
      event('CLAIM_RETRACTED', { claim_id: 'C-999', reason: 'boom' }, { eventSeq: 2 }),
      event('FACT_RECORDED', { fact_id: 'F-50', statement: 'never reached' }, { eventSeq: 3 }),
    ]
    expect(() => foldSemanticEvents(stream)).toThrow(SemanticDomainError)
    // the state after the successful first event is not what a caller can observe
    // from the throwing fold — the contract is fail-loud, no partial result.
  })
})

describe('reducer negatives: the INV-REL rule family (TC-DOM-014 halves)', () => {
  const stateWithClaimsAndFacts = () => {
    const s1 = reduceSemanticEvent(initialSemanticState(), event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 's' }))
    const s2 = reduceSemanticEvent(s1, event('CLAIM_RECORDED', { claim_id: 'C-2', statement: 't' }))
    return reduceSemanticEvent(s2, event('FACT_RECORDED', { fact_id: 'F-1', statement: 'f' }))
  }

  it('unknown relation type → RELATION_TYPE_UNKNOWN (INV-REL-3)', () => {
    const e = event('RELATION_ADDED', {
      relation_id: 'REL-50',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'CAUSES',
      target: { kind: 'FACT', id: 'F-1' },
    })
    const frozen = deepFreeze(stateWithClaimsAndFacts())
    expect(codeOf(() => reduceSemanticEvent(frozen, e))).toBe('RELATION_TYPE_UNKNOWN')
  })

  it.each(['SUPPORTS', 'PRODUCES', 'REQUIRED_BY', 'VALIDATES'])(
    'reverse form %s → RELATION_TYPE_UNKNOWN naming INV-REL-2 (the §8 不保存的反向形式)',
    (rev) => {
      const e = event('RELATION_ADDED', {
        relation_id: 'REL-51',
        source: { kind: 'CLAIM', id: 'C-1' },
        relation_type: rev,
        target: { kind: 'FACT', id: 'F-1' },
      })
      const frozen = deepFreeze(stateWithClaimsAndFacts())
      try {
        reduceSemanticEvent(frozen, e)
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(SemanticDomainError)
        expect((err as SemanticDomainError).code).toBe('RELATION_TYPE_UNKNOWN')
        expect((err as SemanticDomainError).message).toContain('INV-REL-2')
      }
    },
  )

  it('combination-table violation → RELATION_COMBINATION (INV-REL-1 direction)', () => {
    // FACT cannot be a SUPPORTED_BY source (table: source = CLAIM only)
    const e = event('RELATION_ADDED', {
      relation_id: 'REL-52',
      source: { kind: 'FACT', id: 'F-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
    })
    // note: also a self-loop, but the combination check fires first (F:CLAIM-only source)
    expect(codeOf(() => reduceSemanticEvent(stateWithClaimsAndFacts(), e))).toBe('RELATION_COMBINATION')
    // ARTIFACT → CLAIM is not a listed target pair for SUPPORTED_BY (FACT/ARTIFACT/CLAIM listed; check a real violation):
    // TASK cannot be the target of SUPPORTED_BY:
    const e2 = event('RELATION_ADDED', {
      relation_id: 'REL-53',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'TASK', id: 'T-1' },
    })
    expect(codeOf(() => reduceSemanticEvent(stateWithClaimsAndFacts(), e2))).toBe('RELATION_COMBINATION')
  })

  it('self-loop → RELATION_SELF_LOOP (a RELY_ON premise cannot be itself)', () => {
    const e = event('RELATION_ADDED', {
      relation_id: 'REL-54',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'RELATED_TO',
      target: { kind: 'CLAIM', id: 'C-1' },
    })
    expect(codeOf(() => reduceSemanticEvent(stateWithClaimsAndFacts(), e))).toBe('RELATION_SELF_LOOP')
  })

  it('duplicate 5-tuple (same direction, ANY status row) → RELATION_DUPLICATE (§8 唯一性 / §15 UNIQUE)', () => {
    const base = stateWithClaimsAndFacts()
    const first = event('RELATION_ADDED', {
      relation_id: 'REL-60',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
    })
    const withFirst = reduceSemanticEvent(base, first)
    const dup = event('RELATION_ADDED', {
      relation_id: 'REL-61', // fresh id — the 5-tuple, not the id, is the edge identity
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
    })
    expect(codeOf(() => reduceSemanticEvent(withFirst, dup))).toBe('RELATION_DUPLICATE')
  })

  it('a REMOVED edge still blocks a re-add of the same 5-tuple (§15 UNIQUE has no status qualifier; INV-HIST-7: rows stay)', () => {
    const base = stateWithClaimsAndFacts()
    const add = event('RELATION_ADDED', {
      relation_id: 'REL-62',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
    })
    const removed = event('RELATION_REMOVED', {
      relation_id: 'REL-62',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
    })
    const state = reduceSemanticEvent(reduceSemanticEvent(base, add), removed)
    expect(state.relations.get('REL-62')?.status).toBe('REMOVED')
    const readd = event('RELATION_ADDED', {
      relation_id: 'REL-63',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
    })
    expect(codeOf(() => reduceSemanticEvent(state, readd))).toBe('RELATION_DUPLICATE')
  })

  it('mutual asymmetric edges are DIFFERENT edges (A DEPENDS_ON B and B DEPENDS_ON A both allowed)', () => {
    const s1 = reduceSemanticEvent(initialSemanticState(), event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 's' }))
    const s2 = reduceSemanticEvent(s1, event('CLAIM_RECORDED', { claim_id: 'C-2', statement: 't' }))
    const ab = reduceSemanticEvent(
      s2,
      event('RELATION_ADDED', {
        relation_id: 'REL-70',
        source: { kind: 'CLAIM', id: 'C-1' },
        relation_type: 'CONTRADICTED_BY',
        target: { kind: 'CLAIM', id: 'C-2' },
      }),
    )
    const ba = reduceSemanticEvent(
      ab,
      event('RELATION_ADDED', {
        relation_id: 'REL-71',
        source: { kind: 'CLAIM', id: 'C-2' },
        relation_type: 'CONTRADICTED_BY',
        target: { kind: 'CLAIM', id: 'C-1' },
      }),
    )
    expect(ba.relations.get('REL-70')?.status).toBe('ACTIVE')
    expect(ba.relations.get('REL-71')?.status).toBe('ACTIVE')
  })

  it('owner rule: source.ws ?? target.ws ≠ event owner (when resolvable) → OWNER_MISMATCH', () => {
    const base = stateWithClaimsAndFacts() // C-1/F-1 in WS-1
    const e = event(
      'RELATION_ADDED',
      {
        relation_id: 'REL-80',
        source: { kind: 'CLAIM', id: 'C-1' },
        relation_type: 'SUPPORTED_BY',
        target: { kind: 'FACT', id: 'F-1' },
      },
      { ownerWorkstreamId: 'WS-2' }, // ≠ WS-1 (source claim's WS wins)
    )
    expect(codeOf(() => reduceSemanticEvent(base, e))).toBe('OWNER_MISMATCH')
  })
})
