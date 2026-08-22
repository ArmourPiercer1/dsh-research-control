/**
 * WP-2.5 — state machines: full transition coverage (claim / artifact /
 * relation; fact = const ACTIVE, no machine).
 *
 * Frozen basis: DOMAIN_SCHEMA §13 (claim L556 ACTIVE→RETRACTED terminal;
 * artifact L557 REGISTERED↔MISSING) + §7/§8 状态列. Every (from, to) pair
 * of each machine is asserted exactly once — legal pairs pass, illegal
 * pairs throw WRONG_STATE (the §13 table, not a subset, is enforced).
 */
import { describe, expect, it } from 'vitest'

import {
  SEMANTIC_EVENT_TYPES,
  SEMANTIC_TRANSITIONS,
  checkArtifactTransition,
  checkClaimTransition,
  checkRelationTransition,
  checkTransition,
  isLegalTransition,
  legalTargets,
  reduceSemanticEvent,
  SemanticDomainError,
} from '../../src/host/domain/semantics/index.js'
import { event, makeState } from './fixtures.js'

const reduceEvent = reduceSemanticEvent

/* ------------------------------------------------------------------ *
 * The frozen tables, exhaustively
 * ------------------------------------------------------------------ */

describe('SEMANTIC_TRANSITIONS (the frozen §13/§7/§8 tables)', () => {
  it('claim: ACTIVE → RETRACTED; RETRACTED terminal', () => {
    expect(legalTargets('claim', 'ACTIVE')).toEqual(['RETRACTED'])
    expect(legalTargets('claim', 'RETRACTED')).toEqual([])
    expect(Object.keys(SEMANTIC_TRANSITIONS.claim).sort()).toEqual(['ACTIVE', 'RETRACTED'])
  })

  it('artifact: REGISTERED ↔ MISSING (both directions legal per §13)', () => {
    expect(legalTargets('artifact', 'REGISTERED')).toEqual(['MISSING'])
    expect(legalTargets('artifact', 'MISSING')).toEqual(['REGISTERED'])
    expect(Object.keys(SEMANTIC_TRANSITIONS.artifact).sort()).toEqual(['MISSING', 'REGISTERED'])
  })

  it('relation: ACTIVE → REMOVED; REMOVED terminal', () => {
    expect(legalTargets('relation', 'ACTIVE')).toEqual(['REMOVED'])
    expect(legalTargets('relation', 'REMOVED')).toEqual([])
    expect(Object.keys(SEMANTIC_TRANSITIONS.relation).sort()).toEqual(['ACTIVE', 'REMOVED'])
  })

  it('fact has NO machine (status const ACTIVE — §7.2 「恒 ACTIVE」)', () => {
    // the table has exactly the three stateful machines; fact is deliberately absent
    expect(Object.keys(SEMANTIC_TRANSITIONS).sort()).toEqual(['artifact', 'claim', 'relation'])
    expect(() => checkTransition('fact' as never, 'F-1', 'ACTIVE', 'RETRACTED')).toThrow(TypeError)
  })

  it('every (from, to) pair of every machine: legal ⇔ in the table; same-state never legal', () => {
    const all = ['ACTIVE', 'RETRACTED', 'REGISTERED', 'MISSING', 'REMOVED']
    for (const machine of ['claim', 'artifact', 'relation'] as const) {
      for (const from of all) {
        for (const to of all) {
          const legal = isLegalTransition(machine, from, to)
          const inTable = legalTargets(machine, from).includes(to)
          expect(legal, `${machine} ${from}→${to}`).toBe(inTable)
          if (from === to) expect(legal, `${machine} ${from}→${from} (no-op)`).toBe(false)
        }
      }
    }
  })

  it('illegal transitions throw WRONG_STATE naming the machine, the object, and the legal set', () => {
    expect(() => checkClaimTransition('C-9', 'RETRACTED', 'ACTIVE')).toThrow(SemanticDomainError)
    try {
      checkClaimTransition('C-9', 'RETRACTED', 'ACTIVE')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(SemanticDomainError)
      expect((err as SemanticDomainError).code).toBe('WRONG_STATE')
      expect((err as SemanticDomainError).message).toContain('RETRACTED is terminal')
      expect((err as SemanticDomainError).message).toContain('C-9')
      expect((err as SemanticDomainError).message).toContain('claim')
    }
    expect(() => checkArtifactTransition('A-9', 'REGISTERED', 'REGISTERED')).toThrow(/not in the §13 legal table/)
    expect(() => checkRelationTransition('REL-9', 'REMOVED', 'ACTIVE')).toThrow(/terminal/)
  })
})

/* ------------------------------------------------------------------ *
 * Reducer enforcement of the machines (via the event fold)
 * ------------------------------------------------------------------ */

describe('reducer: machine enforcement per event', () => {
  it('CLAIM_RETRACTED: ACTIVE → RETRACTED (the only claim event transition)', () => {
    const e = event('CLAIM_RETRACTED', { claim_id: 'C-1' })
    const next = reduceEvent(makeState(), e)
    expect(next.claims.get('C-1')?.status).toBe('RETRACTED')
  })

  it('CLAIM_RETRACTED on a RETRACTED claim → WRONG_STATE (terminal)', () => {
    const e = event('CLAIM_RETRACTED', { claim_id: 'C-2' })
    try {
      reduceEvent(makeState(), e)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(SemanticDomainError)
      expect((err as SemanticDomainError).code).toBe('WRONG_STATE')
    }
  })

  it('ARTIFACT_MARKED_MISSING: REGISTERED → MISSING', () => {
    const e = event('ARTIFACT_MARKED_MISSING', { artifact_id: 'A-1' })
    const next = reduceEvent(makeState(), e)
    expect(next.artifacts.get('A-1')?.status).toBe('MISSING')
  })

  it('ARTIFACT_MARKED_MISSING on a MISSING artifact → WRONG_STATE', () => {
    const e = event('ARTIFACT_MARKED_MISSING', { artifact_id: 'A-2' })
    try {
      reduceEvent(makeState(), e)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(SemanticDomainError)
      expect((err as SemanticDomainError).code).toBe('WRONG_STATE')
    }
  })

  it('RELATION_REMOVED: ACTIVE → REMOVED (with removed_at = occurredAt)', () => {
    const e = event('RELATION_REMOVED', {
      relation_id: 'REL-1',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
    })
    const next = reduceEvent(makeState(), e)
    const row = next.relations.get('REL-1')
    expect(row?.status).toBe('REMOVED')
    expect(row?.removed_at).toBe(e.occurredAt)
  })

  it('RELATION_REMOVED on a REMOVED relation → WRONG_STATE (terminal)', () => {
    const e = event('RELATION_REMOVED', {
      relation_id: 'REL-2',
      source: { kind: 'CLAIM', id: 'C-2' },
      relation_type: 'CONTRADICTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
    })
    try {
      reduceEvent(makeState(), e)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(SemanticDomainError)
      expect((err as SemanticDomainError).code).toBe('WRONG_STATE')
    }
  })

  it('V1 event coverage: MISSING→REGISTERED (「找回」) is legal in the table but has NO catalog event', () => {
    expect(isLegalTransition('artifact', 'MISSING', 'REGISTERED')).toBe(true)
    // the frozen seven contain no recovery event:
    expect(SEMANTIC_EVENT_TYPES).not.toContain('ARTIFACT_RECOVERED')
    // the state machine guard still accepts the (future service-side) transition:
    expect(() => checkArtifactTransition('A-2', 'MISSING', 'REGISTERED')).not.toThrow()
    // …and no fold over the frozen event set can reach REGISTERED from MISSING
    expect(SEMANTIC_EVENT_TYPES.filter((t) => t.includes('ARTIFACT'))).toEqual(['ARTIFACT_REGISTERED', 'ARTIFACT_MARKED_MISSING'])
  })

  it('fact rows are always ACTIVE (one fact event in the catalog: record; no retraction)', () => {
    const e = event('FACT_RECORDED', { fact_id: 'F-9', statement: 'a new fact' })
    const next = reduceEvent(makeState(), e)
    expect(next.facts.get('F-9')?.status).toBe('ACTIVE')
    expect(SEMANTIC_EVENT_TYPES.filter((t) => t.startsWith('FACT_'))).toEqual(['FACT_RECORDED'])
  })
})
