/**
 * WP-2.5 — `validateSemanticEvent`: structured pre-validation against the
 * derived semantic state (the incremental-maintenance gate).
 *
 * Covers: per-event positive/negative (codes + JSON-pointer paths, TC-DOM-027
 * style), the §8 owner rule (`source.ws ?? target.ws` incl. the both-non-
 * local rejection + the external resolver for non-semantic endpoints), and
 * purity (a frozen input state survives validation byte-for-byte).
 */
import { describe, expect, it } from 'vitest'

import {
  errorFromDomainError,
  SemanticDomainError,
  validateSemanticEvent,
  type SemanticValidateOptions,
} from '../../src/host/domain/semantics/index.js'
import { deepFreeze, event, makeState } from './fixtures.js'

function codes(res: { ok: boolean } & Record<string, unknown>): string[] {
  return res.ok ? [] : ((res as unknown as { errors: Array<{ code: string }> }).errors.map((e) => e.code))
}

describe('validateSemanticEvent: FACT_RECORDED / CLAIM_RECORDED (§5.3)', () => {
  it('positive: fresh id + non-empty statement → ok', () => {
    expect(validateSemanticEvent(makeState(), event('FACT_RECORDED', { fact_id: 'F-9', statement: 's' })).ok).toBe(true)
    expect(validateSemanticEvent(makeState(), event('CLAIM_RECORDED', { claim_id: 'C-9', statement: 's' })).ok).toBe(true)
  })

  it('negative: existing id → OBJECT_ALREADY_EXISTS @/payload/<id>', () => {
    const res = validateSemanticEvent(makeState(), event('FACT_RECORDED', { fact_id: 'F-1', statement: 's' }))
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(codes(res)).toEqual(['OBJECT_ALREADY_EXISTS'])
      expect(res.errors[0].path).toBe('/payload/fact_id')
    }
  })

  it('negative: malformed / empty statement → INVALID_PAYLOAD', () => {
    expect(codes(validateSemanticEvent(makeState(), event('FACT_RECORDED', { fact_id: 'F-9', statement: '' })))).toContain('INVALID_PAYLOAD')
    expect(codes(validateSemanticEvent(makeState(), event('CLAIM_RECORDED', { claim_id: 'C-9' })))).toContain('INVALID_PAYLOAD')
  })

  it('negative: bad id family → INVALID_ID (F-… for a claim, etc.)', () => {
    expect(codes(validateSemanticEvent(makeState(), event('CLAIM_RECORDED', { claim_id: 'F-1', statement: 's' })))).toContain('INVALID_ID')
    expect(codes(validateSemanticEvent(makeState(), event('FACT_RECORDED', { fact_id: 'C-1', statement: 's' })))).toContain('INVALID_ID')
  })
})

describe('validateSemanticEvent: CLAIM_RETRACTED / ARTIFACT_MARKED_MISSING / RELATION_REMOVED (mutations)', () => {
  it('positive: existing subject in the right state + right owner → ok', () => {
    expect(validateSemanticEvent(makeState(), event('CLAIM_RETRACTED', { claim_id: 'C-1' })).ok).toBe(true)
    expect(validateSemanticEvent(makeState(), event('ARTIFACT_MARKED_MISSING', { artifact_id: 'A-1' })).ok).toBe(true)
    expect(
      validateSemanticEvent(
        makeState(),
        event('RELATION_REMOVED', {
          relation_id: 'REL-1',
          source: { kind: 'CLAIM', id: 'C-1' },
          relation_type: 'SUPPORTED_BY',
          target: { kind: 'FACT', id: 'F-1' },
        }),
      ).ok,
    ).toBe(true)
  })

  it('negative: nonexistent subject → OBJECT_NOT_FOUND', () => {
    expect(codes(validateSemanticEvent(makeState(), event('CLAIM_RETRACTED', { claim_id: 'C-99' })))).toEqual(['OBJECT_NOT_FOUND'])
    expect(codes(validateSemanticEvent(makeState(), event('ARTIFACT_MARKED_MISSING', { artifact_id: 'A-99' })))).toEqual(['OBJECT_NOT_FOUND'])
    expect(
      codes(
        validateSemanticEvent(
          makeState(),
          event('RELATION_REMOVED', {
            relation_id: 'REL-99',
            source: { kind: 'CLAIM', id: 'C-1' },
            relation_type: 'SUPPORTED_BY',
            target: { kind: 'FACT', id: 'F-1' },
          }),
        ),
      ),
    ).toEqual(['OBJECT_NOT_FOUND'])
  })

  it('negative: terminal state → WRONG_STATE', () => {
    expect(codes(validateSemanticEvent(makeState(), event('CLAIM_RETRACTED', { claim_id: 'C-2' })))).toEqual(['WRONG_STATE'])
    expect(codes(validateSemanticEvent(makeState(), event('ARTIFACT_MARKED_MISSING', { artifact_id: 'A-2' })))).toEqual(['WRONG_STATE'])
    expect(
      codes(
        validateSemanticEvent(
          makeState(),
          event('RELATION_REMOVED', {
            relation_id: 'REL-2',
            source: { kind: 'CLAIM', id: 'C-2' },
            relation_type: 'CONTRADICTED_BY',
            target: { kind: 'FACT', id: 'F-1' },
          }),
        ),
      ),
    ).toEqual(['WRONG_STATE'])
  })

  it('negative: owner mismatch on the subject object → OWNER_MISMATCH', () => {
    expect(codes(validateSemanticEvent(makeState(), event('CLAIM_RETRACTED', { claim_id: 'C-1' }, { ownerWorkstreamId: 'WS-2' })))).toContain('OWNER_MISMATCH')
    expect(codes(validateSemanticEvent(makeState(), event('ARTIFACT_MARKED_MISSING', { artifact_id: 'A-1' }, { ownerWorkstreamId: 'WS-9' })))).toContain('OWNER_MISMATCH')
  })

  it('negative: RELATION_REMOVED redundant endpoints ≠ stored edge → RELATION_ENDPOINT_MISMATCH', () => {
    const res = validateSemanticEvent(makeState(), event('RELATION_REMOVED', {
      relation_id: 'REL-1',
      source: { kind: 'CLAIM', id: 'C-2' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
    }))
    expect(codes(res)).toContain('RELATION_ENDPOINT_MISMATCH')
  })
})

describe('validateSemanticEvent: ARTIFACT_REGISTERED (§5.4)', () => {
  it('positive: fresh artifact with a valid supersedes → ok', () => {
    expect(
      validateSemanticEvent(
        makeState(),
        event('ARTIFACT_REGISTERED', { artifact_id: 'A-9', type: 'REPORT', title: 't', uri: 'u', supersedes: 'A-1' }),
      ).ok,
    ).toBe(true)
  })

  it('negative: bad type enum → INVALID_PAYLOAD naming the 7 frozen values', () => {
    const res = validateSemanticEvent(makeState(), event('ARTIFACT_REGISTERED', { artifact_id: 'A-9', type: 'VIDEO', title: 't', uri: 'u' }))
    expect(codes(res)).toContain('INVALID_PAYLOAD')
    if (!res.ok) expect(res.errors[0].message).toContain('DATASET')
  })

  it('negative: nonexistent supersedes → OBJECT_NOT_FOUND @/payload/supersedes', () => {
    const res = validateSemanticEvent(makeState(), event('ARTIFACT_REGISTERED', { artifact_id: 'A-9', type: 'NOTE', title: 't', uri: 'u', supersedes: 'A-99' }))
    expect(codes(res)).toContain('OBJECT_NOT_FOUND')
    if (!res.ok) expect(res.errors[0].path).toBe('/payload/supersedes')
  })

  it('related_task: with an external resolver — missing task → OBJECT_NOT_FOUND; other-WS task → OWNER_MISMATCH', () => {
    const opts: SemanticValidateOptions = {
      externalWorkstream: (kind, id) => (kind === 'TASK' && id === 'T-1' ? 'WS-1' : kind === 'TASK' && id === 'T-2' ? 'WS-2' : undefined),
    }
    expect(
      codes(
        validateSemanticEvent(makeState(), event('ARTIFACT_REGISTERED', { artifact_id: 'A-9', type: 'NOTE', title: 't', uri: 'u', related_task: 'T-99' }), opts),
      ),
    ).toContain('OBJECT_NOT_FOUND')
    expect(
      codes(
        validateSemanticEvent(makeState(), event('ARTIFACT_REGISTERED', { artifact_id: 'A-9', type: 'NOTE', title: 't', uri: 'u', related_task: 'T-2' }), opts),
      ),
    ).toContain('OWNER_MISMATCH')
    expect(
      validateSemanticEvent(makeState(), event('ARTIFACT_REGISTERED', { artifact_id: 'A-9', type: 'NOTE', title: 't', uri: 'u', related_task: 'T-1' }), opts).ok,
    ).toBe(true)
    // without a resolver the cross-family check is skipped (documented: the write-time validator owns it)
    expect(
      validateSemanticEvent(makeState(), event('ARTIFACT_REGISTERED', { artifact_id: 'A-9', type: 'NOTE', title: 't', uri: 'u', related_task: 'T-99' })).ok,
    ).toBe(true)
  })
})

describe('validateSemanticEvent: RELATION_ADDED — the §8 owner rule (HISTORY owner 推导规则)', () => {
  const rel = (
    id: string,
    source: { kind: string; id: string },
    target: { kind: string; id: string },
    type = 'SUPPORTED_BY',
    over: Record<string, unknown> = {},
  ) => event('RELATION_ADDED', { relation_id: id, source, relation_type: type, target }, over)

  it('owner = source.ws when the source is workstream-local (semantic state resolves it)', () => {
    // C-1 lives in WS-1; owner WS-1 passes, WS-2 fails
    // NOTE: makeState already holds REL-1 = C-1→SUPPORTED_BY→F-1, so use RELATED_TO here (a fresh 5-tuple)
    expect(validateSemanticEvent(makeState(), rel('REL-90', { kind: 'CLAIM', id: 'C-1' }, { kind: 'FACT', id: 'F-1' }, 'RELATED_TO')).ok).toBe(true)
    const bad = validateSemanticEvent(makeState(), rel('REL-90', { kind: 'CLAIM', id: 'C-1' }, { kind: 'FACT', id: 'F-1' }, 'RELATED_TO', { ownerWorkstreamId: 'WS-2' }))
    expect(codes(bad)).toContain('OWNER_MISMATCH')
  })

  it('owner falls back to target.ws when the source is not workstream-local', () => {
    // WORKSTREAM-kind source: owner = the WS id itself (a WS is local to itself)
    expect(validateSemanticEvent(makeState(), rel('REL-91', { kind: 'WORKSTREAM', id: 'WS-2' }, { kind: 'OBJECTIVE', id: 'OBJ-1' }, 'CONTRIBUTES_TO', { ownerWorkstreamId: 'WS-2' })).ok).toBe(true)
    expect(codes(validateSemanticEvent(makeState(), rel('REL-91', { kind: 'WORKSTREAM', id: 'WS-2' }, { kind: 'OBJECTIVE', id: 'OBJ-1' }, 'CONTRIBUTES_TO', { ownerWorkstreamId: 'WS-1' })))).toContain('OWNER_MISMATCH')
    // non-semantic target (TASK) resolved via the external resolver
    const opts: SemanticValidateOptions = { externalWorkstream: (k, id) => (k === 'TASK' && id === 'T-1' ? 'WS-1' : undefined) }
    expect(validateSemanticEvent(makeState(), rel('REL-92', { kind: 'OBJECTIVE', id: 'OBJ-1' }, { kind: 'TASK', id: 'T-1' }, 'RELATED_TO'), opts).ok).toBe(true)
    expect(codes(validateSemanticEvent(makeState(), rel('REL-92', { kind: 'OBJECTIVE', id: 'OBJ-1' }, { kind: 'TASK', id: 'T-1' }, 'RELATED_TO', { ownerWorkstreamId: 'WS-2' }), opts))).toContain('OWNER_MISMATCH')
  })

  it('both endpoints non-workstream-local → OWNER_UNRESOLVABLE (V1 拒绝创建, DOMAIN_SCHEMA §8)', () => {
    // OBJECTIVE ↔ PROJECT: neither is workstream-local; no resolver can resolve them
    const res = validateSemanticEvent(makeState(), rel('REL-93', { kind: 'PROJECT', id: 'PRJ-1' }, { kind: 'OBJECTIVE', id: 'OBJ-1' }, 'RELATED_TO'))
    expect(codes(res)).toContain('OWNER_UNRESOLVABLE')
    // …but WITH a resolver knowing the objective's home workstream, the same edge passes:
    const opts: SemanticValidateOptions = { externalWorkstream: (k) => (k === 'OBJECTIVE' ? 'WS-1' : undefined) }
    expect(validateSemanticEvent(makeState(), rel('REL-93', { kind: 'PROJECT', id: 'PRJ-1' }, { kind: 'OBJECTIVE', id: 'OBJ-1' }, 'RELATED_TO'), opts).ok).toBe(true)
  })

  it('WORKSTREAM-kind endpoints resolve to their own id (a WS is local to itself); the resolver may override', () => {
    // source = WORKSTREAM WS-2 → edge owner = WS-2 (source.ws wins) → event owner WS-2 passes
    expect(validateSemanticEvent(makeState(), rel('REL-94', { kind: 'WORKSTREAM', id: 'WS-2' }, { kind: 'CLAIM', id: 'C-1' }, 'RELATED_TO', { ownerWorkstreamId: 'WS-2' })).ok).toBe(true)
    // …same edge under event owner WS-1 (the target claim's home) fails: source.ws still wins
    expect(codes(validateSemanticEvent(makeState(), rel('REL-94', { kind: 'WORKSTREAM', id: 'WS-2' }, { kind: 'CLAIM', id: 'C-1' }, 'RELATED_TO', { ownerWorkstreamId: 'WS-1' })))).toContain('OWNER_MISMATCH')
    // an external resolver MAY re-resolve the WS endpoint (e.g. to a canonical home)
    const opts: SemanticValidateOptions = { externalWorkstream: (k, id) => (k === 'WORKSTREAM' && id === 'WS-2' ? 'WS-1' : undefined) }
    expect(validateSemanticEvent(makeState(), rel('REL-94', { kind: 'WORKSTREAM', id: 'WS-2' }, { kind: 'CLAIM', id: 'C-1' }, 'RELATED_TO'), opts).ok).toBe(true)
  })

  it('all INV-REL reject paths reachable from the validator (TC-DOM-014 code map)', () => {
    const s = makeState()
    const expectCode = (e: ReturnType<typeof event>, expected: string, opts?: SemanticValidateOptions) => {
      const res = validateSemanticEvent(s, e, opts)
      expect(codes(res), JSON.stringify(e.payload)).toContain(expected)
    }
    // unknown type (INV-REL-3)
    expectCode(rel('REL-95', { kind: 'CLAIM', id: 'C-1' }, { kind: 'FACT', id: 'F-1' }, 'CAUSES'), 'RELATION_TYPE_UNKNOWN')
    // reverse form (INV-REL-2)
    expectCode(rel('REL-96', { kind: 'CLAIM', id: 'C-1' }, { kind: 'FACT', id: 'F-1' }, 'SUPPORTS'), 'RELATION_TYPE_UNKNOWN')
    // combination table (INV-REL-1)
    expectCode(rel('REL-97', { kind: 'CLAIM', id: 'C-1' }, { kind: 'TASK', id: 'T-1' }, 'SUPPORTED_BY'), 'RELATION_COMBINATION')
    // self-loop (INV-REL-1)
    expectCode(rel('REL-98', { kind: 'CLAIM', id: 'C-1' }, { kind: 'CLAIM', id: 'C-1' }, 'RELATED_TO'), 'RELATION_SELF_LOOP')
    // duplicate 5-tuple (§8 唯一性)
    expectCode(rel('REL-99', { kind: 'CLAIM', id: 'C-1' }, { kind: 'FACT', id: 'F-1' }, 'SUPPORTED_BY'), 'RELATION_DUPLICATE')
    // reverse duplicate (RELATED_TO) — build a state that already holds C-1→C-2 RELATED_TO
    const withRelated = { ...s, relations: new Map([...s.relations, ['REL-100', { id: 'REL-100', source: { kind: 'CLAIM', id: 'C-1' }, relation_type: 'RELATED_TO', target: { kind: 'CLAIM', id: 'C-2' }, created_by: { kind: 'USER', user_id: 'u' }, created_at: 1, status: 'ACTIVE' as const }]]), conflict: new Map() }
    const res = validateSemanticEvent(withRelated, rel('REL-101', { kind: 'CLAIM', id: 'C-2' }, { kind: 'CLAIM', id: 'C-1' }, 'RELATED_TO'))
    expect(codes(res)).toContain('RELATION_REVERSE_DUPLICATE')
  })

  it('multiple errors are collected (no short-circuit): a doubly-bad event reports both', () => {
    const res = validateSemanticEvent(makeState(), event('CLAIM_RETRACTED', { claim_id: 'C-99' }, { ownerWorkstreamId: 'T-1' }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(new Set(res.errors.map((e) => e.code))).toEqual(new Set(['INVALID_ENVELOPE', 'OBJECT_NOT_FOUND']))
  })
})

describe('validateSemanticEvent: envelope + non-semantic + purity', () => {
  it('non-semantic eventType → UNKNOWN_EVENT_TYPE (this validator is the semantic gate)', () => {
    const res = validateSemanticEvent(makeState(), event('RUN_STARTED', { run_id: 'R-1' }))
    expect(codes(res)).toEqual(['UNKNOWN_EVENT_TYPE'])
  })

  it('malformed envelope (owner not a WS id / negative occurredAt / bad actor) → INVALID_ENVELOPE', () => {
    expect(codes(validateSemanticEvent(makeState(), event('FACT_RECORDED', { fact_id: 'F-9', statement: 's' }, { ownerWorkstreamId: 'R-1' })))).toContain('INVALID_ENVELOPE')
    expect(codes(validateSemanticEvent(makeState(), event('FACT_RECORDED', { fact_id: 'F-9', statement: 's' }, { occurredAt: -5 })))).toContain('INVALID_ENVELOPE')
    expect(codes(validateSemanticEvent(makeState(), event('FACT_RECORDED', { fact_id: 'F-9', statement: 's' }, { actor: { kind: 'GHOST' } })))).toContain('INVALID_ENVELOPE')
  })

  it('a non-object event is reported, not thrown', () => {
    const res = validateSemanticEvent(makeState(), null as never)
    expect(codes(res)).toEqual(['UNKNOWN_EVENT_TYPE'])
  })

  it('purity: validation never mutates the (frozen) state', () => {
    const frozen = deepFreeze(makeState())
    expect(() => validateSemanticEvent(frozen, event('CLAIM_RETRACTED', { claim_id: 'C-1' }))).not.toThrow()
    expect(frozen.claims.get('C-1')?.status).toBe('ACTIVE')
  })

  it('errorFromDomainError maps a reducer throw into the structured form', () => {
    const err = new SemanticDomainError('WRONG_STATE', 'claim "C-1" is RETRACTED; …', '/payload/claim_id')
    const res = errorFromDomainError(err)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.errors).toEqual([{ code: 'WRONG_STATE', path: '/payload/claim_id', message: 'claim "C-1" is RETRACTED; …' }])
    }
  })
})
