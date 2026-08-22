/**
 * WP-2.2 — envelope negatives (§1 field violations → structured ENVELOPE
 * rejection; INV-HIST-4: unknown (eventType, schemaVersion) ⇒ reject).
 * All checked against the REAL frozen schema (WR/schema/history).
 */
import { describe, expect, it } from 'vitest'

import { loadHistoryEventRegistry, validateEvent } from '../../src/host/history/registry/index.js'
import { FsReader, T0, WR_HISTORY_SCHEMA_DIR, envelope, makeCtx } from './fixtures.js'

const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)
const ctx = makeCtx()

function rejectCodes(event: unknown): string[] {
  const result = validateEvent(registry, event, ctx)
  if (result.ok) throw new Error(`expected rejection, got ok for ${JSON.stringify(event)}`)
  return result.errors.map((e) => `${e.code}${e.path ? ` @${e.path}` : ''}`)
}

describe('WP-2.2 validateEvent — envelope negatives (§1)', () => {
  it('rejects an event that is not an object', () => {
    const codes = rejectCodes([])
    expect(codes.some((c) => c.startsWith('ENVELOPE'))).toBe(true)
  })

  it('rejects a missing eventId', () => {
    const event = envelope('RUN_FINISHED', { run_id: 'R-1' })
    delete event.eventId
    expect(rejectCodes(event)).toContain('ENVELOPE @/eventId')
  })

  it('rejects an ill-formed eventId pattern (H-0 / lowercase)', () => {
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { eventId: 'H-0' })).some((c) => c.startsWith('ENVELOPE @/eventId'))).toBe(true)
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { eventId: 'h-1' })).some((c) => c.startsWith('ENVELOPE @/eventId'))).toBe(true)
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { eventId: 'E-1' })).some((c) => c.startsWith('ENVELOPE @/eventId'))).toBe(true)
  })

  it('rejects a missing/ill-formed ownerWorkstreamId', () => {
    const event = envelope('RUN_FINISHED', { run_id: 'R-1' })
    delete event.ownerWorkstreamId
    expect(rejectCodes(event)).toContain('ENVELOPE @/ownerWorkstreamId')
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { ownerWorkstreamId: 'ws-1' })).some((c) => c.startsWith('ENVELOPE @/ownerWorkstreamId'))).toBe(true)
  })

  it('rejects eventSeq below 1 / non-integer', () => {
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { eventSeq: 0 }))).toContain('ENVELOPE @/eventSeq')
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { eventSeq: 1.5 }))).toContain('ENVELOPE @/eventSeq')
  })

  it('rejects an unknown eventType (INV-HIST-4)', () => {
    const codes = rejectCodes(envelope('TASK_RENAMED', { task_id: 'T-1' }, {}))
    expect(codes).toContain('ENVELOPE @/eventType')
    const result = validateEvent(registry, envelope('TASK_RENAMED', { task_id: 'T-1' }), ctx)
    if (!result.ok) {
      expect(result.errors[0]!.message).toContain('TASK_RENAMED')
      expect(result.errors[0]!.message).toContain('INV-HIST-4')
    }
  })

  it('rejects a missing eventType and a non-string eventType', () => {
    const event = envelope('RUN_FINISHED', { run_id: 'R-1' })
    delete event.eventType
    expect(rejectCodes(event)).toContain('ENVELOPE @/eventType')
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { eventType: 7 }))).toContain('ENVELOPE @/eventType')
  })

  it('rejects an unknown (eventType, schemaVersion) pair (V1: all versions are 1)', () => {
    const codes = rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { schemaVersion: 2 }))
    expect(codes).toContain('ENVELOPE @/schemaVersion')
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { schemaVersion: 0 }))).toContain('ENVELOPE @/schemaVersion')
  })

  it('rejects missing / non-epoch time fields', () => {
    const noOccurred = envelope('RUN_FINISHED', { run_id: 'R-1' })
    delete noOccurred.occurredAt
    expect(rejectCodes(noOccurred)).toContain('ENVELOPE @/occurredAt')
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { occurredAt: '2026-08-22T09:00:00Z' })).some((c) => c.startsWith('ENVELOPE @/occurredAt'))).toBe(true)
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { occurredAt: -1 }))).toContain('ENVELOPE @/occurredAt')
    const noRecorded = envelope('RUN_FINISHED', { run_id: 'R-1' })
    delete noRecorded.recordedAt
    expect(rejectCodes(noRecorded)).toContain('ENVELOPE @/recordedAt')
  })

  it('rejects a missing or schema-invalid actor', () => {
    const noActor = envelope('RUN_FINISHED', { run_id: 'R-1' })
    delete noActor.actor
    expect(rejectCodes(noActor)).toContain('ENVELOPE @/actor')
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { actor: { user_id: 'u-alice' } }))).toContain('ENVELOPE @/actor/kind')
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { actor: { kind: 'GHOST' } })).some((c) => c.startsWith('ENVELOPE @/actor/kind'))).toBe(true)
    // actorRef is closed: unexpected actor properties are rejected
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { actor: { kind: 'USER', extra: true } })).some((c) => c.startsWith('ENVELOPE @/actor'))).toBe(true)
    // label maxLength 200
    expect(
      rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { actor: { kind: 'USER', label: 'x'.repeat(201) } })).some((c) => c.startsWith('ENVELOPE @/actor/label')),
    ).toBe(true)
    // run_id pattern inside actorRef
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { actor: { kind: 'AGENT', run_id: 'R-0' } })).some((c) => c.startsWith('ENVELOPE @/actor/run_id'))).toBe(true)
  })

  it('rejects a missing / non-object payload and closed-payload violations', () => {
    const noPayload = envelope('RUN_FINISHED', { run_id: 'R-1' })
    delete noPayload.payload
    expect(rejectCodes(noPayload)).toContain('ENVELOPE @/payload')
    expect(rejectCodes(envelope('RUN_FINISHED', 'not-an-object'))).toContain('ENVELOPE @/payload')
    // additionalProperties: false on the payload (INV-HIST-4)
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1', surprise: 1 })).some((c) => c.startsWith('ENVELOPE @/payload'))).toBe(true)
  })

  it('rejects id-pattern violations in payload id fields', () => {
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'X-1' })).some((c) => c.startsWith('ENVELOPE @/payload/run_id'))).toBe(true)
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-0' })).some((c) => c.startsWith('ENVELOPE @/payload/run_id'))).toBe(true)
  })

  it('an optional source must be a valid SourceRef when present', () => {
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1' }, { source: { kind: 'PORTAL' } })).some((c) => c.startsWith('ENVELOPE @/source/kind'))).toBe(true)
    // a valid sourceRef passes shape
    const result = validateEvent(registry, envelope('RUN_FINISHED', { run_id: 'R-1' }, { source: { kind: 'GIT', commit_oid: 'a'.repeat(40) } }), ctx)
    expect(result.ok).toBe(true)
  })
})

describe('WP-2.2 validateEvent — payload-discrimination negatives (per-event schema)', () => {
  it('RUN_STARTED requires run_id + initiated_by', () => {
    expect(rejectCodes(envelope('RUN_STARTED', { initiated_by: { kind: 'USER' } })).some((c) => c.startsWith('ENVELOPE @/payload/run_id'))).toBe(true)
    expect(rejectCodes(envelope('RUN_STARTED', { run_id: 'R-10' })).some((c) => c.startsWith('ENVELOPE @/payload/initiated_by'))).toBe(true)
  })

  it('RUNS_STARTED requires ≥2 runs and well-formed run entries (minItems 2)', () => {
    const one = envelope('RUNS_STARTED', { runs: [{ run_id: 'R-20' }] })
    const codes = rejectCodes(one)
    expect(codes.some((c) => c.startsWith('ENVELOPE @/payload/runs'))).toBe(true)
    expect(rejectCodes(envelope('RUNS_STARTED', { runs: [{ run_id: 'R-20' }, { task_id: 'T-1' }] })).some((c) => c.startsWith('ENVELOPE @/payload/runs/1/run_id'))).toBe(true)
  })

  it('RUN_CANCELLED requires cancelled_by; RUN_FAILED/RUN_FINISHED reject unknown fields', () => {
    expect(rejectCodes(envelope('RUN_CANCELLED', { run_id: 'R-1' })).some((c) => c.startsWith('ENVELOPE @/payload/cancelled_by'))).toBe(true)
    expect(rejectCodes(envelope('RUN_FAILED', { run_id: 'R-1', cancelled_by: { kind: 'USER' } })).some((c) => c.startsWith('ENVELOPE @/payload'))).toBe(true)
    expect(rejectCodes(envelope('RUN_FINISHED', { run_id: 'R-1', error_summary: 'x' })).some((c) => c.startsWith('ENVELOPE @/payload'))).toBe(true)
  })

  it('TASK_EXECUTION_CHANGED / TASK_VALIDATION_CHANGED require from/to state enums', () => {
    expect(rejectCodes(envelope('TASK_EXECUTION_CHANGED', { task_id: 'T-2', from: 'DONE', to: 'ACTIVE' })).some((c) => c.startsWith('ENVELOPE @/payload/from'))).toBe(true)
    expect(rejectCodes(envelope('TASK_VALIDATION_CHANGED', { task_id: 'T-2', to: 'PENDING' })).some((c) => c.startsWith('ENVELOPE @/payload/from'))).toBe(true)
    expect(rejectCodes(envelope('TASK_VALIDATION_CHANGED', { task_id: 'T-2', from: 'PENDING', to: 'MAYBE' })).some((c) => c.startsWith('ENVELOPE @/payload/to'))).toBe(true)
  })

  it('ACCEPTANCE_CRITERIA_CHANGED requires string[] from/to snapshots', () => {
    expect(rejectCodes(envelope('ACCEPTANCE_CRITERIA_CHANGED', { task_id: 'T-2', from: 'AC: one', to: [] })).some((c) => c.startsWith('ENVELOPE @/payload/from'))).toBe(true)
    expect(rejectCodes(envelope('ACCEPTANCE_CRITERIA_CHANGED', { task_id: 'T-2', from: [], to: [42] })).some((c) => c.startsWith('ENVELOPE @/payload/to'))).toBe(true)
  })

  it('FACT_RECORDED / CLAIM_RECORDED require a non-empty statement', () => {
    expect(rejectCodes(envelope('FACT_RECORDED', { fact_id: 'F-20', statement: '' })).some((c) => c.startsWith('ENVELOPE @/payload/statement'))).toBe(true)
    expect(rejectCodes(envelope('CLAIM_RECORDED', { claim_id: 'C-20' })).some((c) => c.startsWith('ENVELOPE @/payload/statement'))).toBe(true)
  })

  it('ARTIFACT_REGISTERED requires type/title/uri with closed enums', () => {
    expect(rejectCodes(envelope('ARTIFACT_REGISTERED', { artifact_id: 'A-20', type: 'VIDEO', title: 't', uri: 'u' })).some((c) => c.startsWith('ENVELOPE @/payload/type'))).toBe(true)
    expect(rejectCodes(envelope('ARTIFACT_REGISTERED', { artifact_id: 'A-20', type: 'NOTE', title: '', uri: 'u' })).some((c) => c.startsWith('ENVELOPE @/payload/title'))).toBe(true)
    expect(rejectCodes(envelope('ARTIFACT_REGISTERED', { artifact_id: 'A-20', type: 'NOTE', title: 't' })).some((c) => c.startsWith('ENVELOPE @/payload/uri'))).toBe(true)
  })

  it('RELATION_ADDED / RELATION_REMOVED require the 4-field edge (10-type relation_type enum)', () => {
    expect(rejectCodes(envelope('RELATION_ADDED', { relation_id: 'REL-20', relation_type: 'DEPENDS_ON', target: { kind: 'TASK', id: 'T-2' } })).some((c) => c.startsWith('ENVELOPE @/payload/source'))).toBe(true)
    // reverse forms do not exist in the frozen 10-type set (INV-REL-2)
    expect(rejectCodes(envelope('RELATION_ADDED', { relation_id: 'REL-20', source: { kind: 'TASK', id: 'T-1' }, relation_type: 'SUPPORTS', target: { kind: 'TASK', id: 'T-2' } })).some((c) => c.startsWith('ENVELOPE @/payload/relation_type'))).toBe(true)
    expect(rejectCodes(envelope('RELATION_REMOVED', { relation_id: 'REL-1', source: { kind: 'TASK', id: 'T-1' }, relation_type: 'DEPENDS_ON' })).some((c) => c.startsWith('ENVELOPE @/payload/target'))).toBe(true)
  })

  it('GATE_EVALUATED requires the 3-result enum; MILESTONE_ACHIEVED requires milestone_id', () => {
    expect(rejectCodes(envelope('GATE_EVALUATED', { gate_id: 'G-1', result: 'MAYBE', evaluated_by: { kind: 'USER' } })).some((c) => c.startsWith('ENVELOPE @/payload/result'))).toBe(true)
    expect(rejectCodes(envelope('GATE_EVALUATED', { gate_id: 'G-1', result: 'PASSED' })).some((c) => c.startsWith('ENVELOPE @/payload/evaluated_by'))).toBe(true)
    expect(rejectCodes(envelope('MILESTONE_ACHIEVED', { note: 'nope' })).some((c) => c.startsWith('ENVELOPE @/payload/milestone_id'))).toBe(true)
  })

  it('INTERVENTION_CREATED requires title + the 4-origin enum', () => {
    expect(rejectCodes(envelope('INTERVENTION_CREATED', { intervention_id: 'IV-20', title: 't', origin: 'AUTO' })).some((c) => c.startsWith('ENVELOPE @/payload/origin'))).toBe(true)
    expect(rejectCodes(envelope('INTERVENTION_CREATED', { intervention_id: 'IV-20', origin: 'USER' })).some((c) => c.startsWith('ENVELOPE @/payload/title'))).toBe(true)
  })

  it('TOPOLOGY_FORK_REALIZED / TOPOLOGY_MERGE_REALIZED enforce the V1 arity (inputs/outputs ≤1 on the owning side)', () => {
    expect(rejectCodes(envelope('TOPOLOGY_FORK_REALIZED', { topology_edge_id: 'TE-1', inputs: ['WS-1', 'WS-2'], outputs: ['WS-3'] })).some((c) => c.startsWith('ENVELOPE @/payload/inputs'))).toBe(true)
    expect(rejectCodes(envelope('TOPOLOGY_MERGE_REALIZED', { topology_edge_id: 'TE-2', inputs: ['WS-2'], outputs: ['WS-1', 'WS-4'] })).some((c) => c.startsWith('ENVELOPE @/payload/outputs'))).toBe(true)
    expect(rejectCodes(envelope('TOPOLOGY_MERGE_REALIZED', { topology_edge_id: 'TE-2', inputs: ['WS-2', 'WS-2'], outputs: ['WS-1'] })).some((c) => c.startsWith('ENVELOPE @/payload/inputs'))).toBe(true)
  })

  it('payload ids follow the common.schema.json patterns', () => {
    expect(rejectCodes(envelope('FACT_RECORDED', { fact_id: 'X-1', statement: 's' })).some((c) => c.startsWith('ENVELOPE @/payload/fact_id'))).toBe(true)
    expect(rejectCodes(envelope('GATE_EVALUATED', { gate_id: 'G-0', result: 'PASSED', evaluated_by: { kind: 'USER' } })).some((c) => c.startsWith('ENVELOPE @/payload/gate_id'))).toBe(true)
  })

  it('occurredAt far in the past is still shape-valid (no monotonicity assumption — TC-HIST-002 validation half)', () => {
    const result = validateEvent(registry, envelope('RUN_FINISHED', { run_id: 'R-1' }, { occurredAt: T0 - 7 * 24 * 3600 * 1000, eventSeq: 42 }), ctx)
    expect(result.ok).toBe(true)
  })
})
