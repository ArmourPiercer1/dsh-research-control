/**
 * UI-7 (B §26 — Records 上下文入口) — the pure projections behind the
 * 「Related Records (n)」 context entry (pure unit tests):
 *  - `semanticRecordRef`: which record a history event is about — the
 *    five record-keyed semantic event types map directly; RELATION events
 *    resolve the first record-kind endpoint (SOURCE first); everything
 *    else is `null` (the entry only shows for record-bearing events);
 *  - `relatedRecordCount`: the client mirror of the host `relatedObject`
 *    match (an ACTIVE edge either direction, or a `references` entry in
 *    the bare-id or `KIND:ID` form) — display-only input; the host query
 *    stays the authority.
 */

import { describe, expect, it } from 'vitest'
import { relatedRecordCount, semanticRecordRef } from '../../src/client/views/history/index.js'
import type { HistoryEventDto, SemanticRecordDto } from '../../src/shared/rpc-contracts.js'

/* -- event fixtures (wire-valid rows of one owner workstream) -- */

const T0 = 1_755_000_000_000

function makeEvent(
  overrides: Partial<HistoryEventDto> &
    Pick<HistoryEventDto, 'eventId' | 'eventType' | 'schemaVersion' | 'occurredAt' | 'recordedAt' | 'eventSeq' | 'payload'>,
): HistoryEventDto {
  return {
    ownerWorkstreamId: 'WS-1',
    actor: { kind: 'USER', user_id: 'u1' },
    source: null,
    ...overrides,
  }
}

const FACT_EVENT = makeEvent({
  eventId: 'H-1',
  eventType: 'FACT_RECORDED',
  schemaVersion: 1,
  occurredAt: T0,
  recordedAt: T0 + 1_000,
  eventSeq: 1,
  payload: { fact_id: 'F-1', statement: 'the baseline converges' },
})
const CLAIM_EVENT = makeEvent({
  eventId: 'H-2',
  eventType: 'CLAIM_RECORDED',
  schemaVersion: 1,
  occurredAt: T0 + 2_000,
  recordedAt: T0 + 3_000,
  eventSeq: 2,
  payload: { claim_id: 'C-1', statement: 'the baseline wins' },
})
const RETRACT_EVENT = makeEvent({
  eventId: 'H-3',
  eventType: 'CLAIM_RETRACTED',
  schemaVersion: 1,
  occurredAt: T0 + 4_000,
  recordedAt: T0 + 5_000,
  eventSeq: 3,
  payload: { claim_id: 'C-1', reason: 'disproven' },
})
const ARTIFACT_EVENT = makeEvent({
  eventId: 'H-4',
  eventType: 'ARTIFACT_REGISTERED',
  schemaVersion: 1,
  occurredAt: T0 + 6_000,
  recordedAt: T0 + 7_000,
  eventSeq: 4,
  payload: { artifact_id: 'A-1', type: 'MODEL', title: 'baseline v1', uri: 'file:///baseline.bin' },
})
const MISSING_EVENT = makeEvent({
  eventId: 'H-5',
  eventType: 'ARTIFACT_MARKED_MISSING',
  schemaVersion: 1,
  occurredAt: T0 + 8_000,
  recordedAt: T0 + 9_000,
  eventSeq: 5,
  payload: { artifact_id: 'A-1', reason: 'moved' },
})
const RELATION_RECORD_SOURCE = makeEvent({
  eventId: 'H-6',
  eventType: 'RELATION_ADDED',
  schemaVersion: 1,
  occurredAt: T0 + 10_000,
  recordedAt: T0 + 11_000,
  eventSeq: 6,
  payload: {
    relation_id: 'REL-1',
    source: { kind: 'CLAIM', id: 'C-1' },
    relation_type: 'SUPPORTED_BY',
    target: { kind: 'FACT', id: 'F-1' },
  },
})
const RELATION_RECORD_TARGET_ONLY = makeEvent({
  eventId: 'H-7',
  eventType: 'RELATION_ADDED',
  schemaVersion: 1,
  occurredAt: T0 + 12_000,
  recordedAt: T0 + 13_000,
  eventSeq: 7,
  payload: {
    relation_id: 'REL-2',
    source: { kind: 'TASK', id: 'T-1' },
    relation_type: 'DEPENDS_ON',
    target: { kind: 'FACT', id: 'F-1' },
  },
})
const RELATION_NO_RECORDS = makeEvent({
  eventId: 'H-8',
  eventType: 'RELATION_ADDED',
  schemaVersion: 1,
  occurredAt: T0 + 14_000,
  recordedAt: T0 + 15_000,
  eventSeq: 8,
  payload: {
    relation_id: 'REL-3',
    source: { kind: 'TASK', id: 'T-1' },
    relation_type: 'DEPENDS_ON',
    target: { kind: 'TASK', id: 'T-2' },
  },
})
const RELATION_REMOVED_RECORD = makeEvent({
  eventId: 'H-9',
  eventType: 'RELATION_REMOVED',
  schemaVersion: 1,
  occurredAt: T0 + 16_000,
  recordedAt: T0 + 17_000,
  eventSeq: 9,
  payload: {
    relation_id: 'REL-1',
    source: { kind: 'CLAIM', id: 'C-1' },
    relation_type: 'SUPPORTED_BY',
    target: { kind: 'FACT', id: 'F-1' },
    reason: 'cleaned up',
  },
})
const RUN_EVENT = makeEvent({
  eventId: 'H-10',
  eventType: 'RUN_STARTED',
  schemaVersion: 1,
  occurredAt: T0 + 18_000,
  recordedAt: T0 + 19_000,
  eventSeq: 10,
  payload: { run_id: 'R-1' },
})
const GATE_EVENT = makeEvent({
  eventId: 'H-11',
  eventType: 'GATE_EVALUATED',
  schemaVersion: 1,
  occurredAt: T0 + 20_000,
  recordedAt: T0 + 21_000,
  eventSeq: 11,
  payload: { gate_id: 'G-1', result: 'PASSED' },
})

/* -- record fixtures (the derived-rows DTO shape) -- */

function makeRecord(overrides: Partial<SemanticRecordDto> & Pick<SemanticRecordDto, 'id' | 'type' | 'status'>): SemanticRecordDto {
  return {
    workstreamId: 'WS-1',
    recordedAt: T0,
    references: [],
    relations: [],
    ...overrides,
  }
}

describe('semanticRecordRef — the event → record context map', () => {
  it('maps the five record-keyed semantic events to their payload id', () => {
    expect(semanticRecordRef(FACT_EVENT)).toEqual({ kind: 'FACT', id: 'F-1' })
    expect(semanticRecordRef(CLAIM_EVENT)).toEqual({ kind: 'CLAIM', id: 'C-1' })
    expect(semanticRecordRef(RETRACT_EVENT)).toEqual({ kind: 'CLAIM', id: 'C-1' })
    expect(semanticRecordRef(ARTIFACT_EVENT)).toEqual({ kind: 'ARTIFACT', id: 'A-1' })
    expect(semanticRecordRef(MISSING_EVENT)).toEqual({ kind: 'ARTIFACT', id: 'A-1' })
  })

  it('maps RELATION events to the first record-kind endpoint (SOURCE first)', () => {
    expect(semanticRecordRef(RELATION_RECORD_SOURCE)).toEqual({ kind: 'CLAIM', id: 'C-1' })
  })

  it('falls back to the TARGET when the source is not a record kind', () => {
    expect(semanticRecordRef(RELATION_RECORD_TARGET_ONLY)).toEqual({ kind: 'FACT', id: 'F-1' })
  })

  it('returns null when no endpoint is a record kind (TASK→TASK)', () => {
    expect(semanticRecordRef(RELATION_NO_RECORDS)).toBeNull()
  })

  it('maps RELATION_REMOVED like RELATION_ADDED (the context entry is about the RECORD, not the edge)', () => {
    expect(semanticRecordRef(RELATION_REMOVED_RECORD)).toEqual({ kind: 'CLAIM', id: 'C-1' })
  })

  it('returns null for non-semantic events (no record context)', () => {
    expect(semanticRecordRef(RUN_EVENT)).toBeNull()
    expect(semanticRecordRef(GATE_EVENT)).toBeNull()
  })
})

describe('relatedRecordCount — the client mirror of the host relatedObject match', () => {
  const C1 = makeRecord({
    id: 'C-1',
    type: 'CLAIM',
    status: 'ACTIVE',
    statement: 'the baseline wins',
    relations: [
      { relationId: 'REL-1', relationType: 'SUPPORTED_BY', direction: 'out', other: { kind: 'FACT', id: 'F-1' } },
    ],
  })
  const F1 = makeRecord({
    id: 'F-1',
    type: 'FACT',
    status: 'ACTIVE',
    statement: 'the baseline converges',
    references: ['T-1'],
    relations: [
      { relationId: 'REL-1', relationType: 'SUPPORTED_BY', direction: 'in', other: { kind: 'CLAIM', id: 'C-1' } },
    ],
  })
  const F2 = makeRecord({
    id: 'F-2',
    type: 'FACT',
    status: 'ACTIVE',
    statement: 'the baseline was registered by reference',
    references: ['FACT:F-1'],
  })

  it('counts an outgoing edge whose other endpoint is the ref', () => {
    expect(relatedRecordCount([C1, F1, F2], { kind: 'FACT', id: 'F-1' })).toBe(2) // C-1 (out) + F-1 (in)
  })

  it('counts edges in BOTH directions (the mirror is direction-agnostic)', () => {
    expect(relatedRecordCount([F1], { kind: 'CLAIM', id: 'C-1' })).toBe(1)
  })

  it('matches a references entry in the BARE id form', () => {
    expect(relatedRecordCount([F1, F2], { kind: 'TASK', id: 'T-1' })).toBe(1) // F-1 via references "T-1"
  })

  it('matches a references entry in the KIND:ID form', () => {
    expect(relatedRecordCount([F2], { kind: 'FACT', id: 'F-1' })).toBe(1) // F-2 via references "FACT:F-1"
  })

  it('counts a record ONCE even when it matches by edge and reference alike', () => {
    const both = makeRecord({
      id: 'F-3',
      type: 'FACT',
      status: 'ACTIVE',
      statement: 'double match',
      references: ['FACT:F-1'],
      relations: [
        { relationId: 'REL-9', relationType: 'SUPPORTED_BY', direction: 'in', other: { kind: 'FACT', id: 'F-1' } },
      ],
    })
    expect(relatedRecordCount([both], { kind: 'FACT', id: 'F-1' })).toBe(1)
  })

  it('is 0 for an object nothing relates to (the badge stays hidden)', () => {
    expect(relatedRecordCount([C1, F1, F2], { kind: 'TASK', id: 'T-9' })).toBe(0)
  })
})
