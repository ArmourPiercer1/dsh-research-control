/**
 * WP-2.2 — owner-workstream rules (§4 owner column, INV-HIST-3/9) + payload
 * cross-field rules (catalog §5 per-event constraints: WAIVED⇒USER+note,
 * NOT_REQUIRED⇒AC empty (INV-TASK-3), AUTO_*⇒PLUGIN, AGENT⇒created_by_run,
 * relation 组合表 (DOMAIN_SCHEMA §8, INV-REL-1/2), endpoint redundancy,
 * payload-vs-edge mirror, supersedes/related_task existence + WS).
 */
import { describe, expect, it } from 'vitest'

import type { EventValidationResult } from '../../src/host/history/registry/index.js'
import { loadHistoryEventRegistry, validateEvent } from '../../src/host/history/registry/index.js'
import { FsReader, WR_HISTORY_SCHEMA_DIR, envelope, makeCtx } from './fixtures.js'

const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)

function resultOf(event: Record<string, unknown>): EventValidationResult {
  return validateEvent(registry, event, makeCtx())
}

function expectCode(result: EventValidationResult, code: string, path?: string): void {
  expect(result.ok).toBe(false)
  if (!result.ok) {
    const err = result.errors.find((e) => e.code === code && (path === undefined || e.path === path))
    expect(err, `expected ${code}${path ? ` @${path}` : ''} in ${JSON.stringify(result.errors)}`).toBeDefined()
  }
}

describe('WP-2.2 — owner rules (§4 owner column)', () => {
  it('ownerWorkstreamId must exist (INV-HIST-3)', () => {
    expectCode(resultOf(envelope('RUN_FINISHED', { run_id: 'R-1' }, { ownerWorkstreamId: 'WS-99' })), 'OBJECT_NOT_FOUND', '/ownerWorkstreamId')
  })

  it('RUN_STARTED: task_id must belong to the owner WS', () => {
    // T-3 belongs to WS-2; event owner WS-1
    expectCode(resultOf(envelope('RUN_STARTED', { run_id: 'R-10', task_id: 'T-3', initiated_by: { kind: 'USER' } })), 'OWNER_MISMATCH', '/payload/task_id')
    expectCode(resultOf(envelope('RUN_STARTED', { run_id: 'R-10', task_id: 'T-99', initiated_by: { kind: 'USER' } })), 'OBJECT_NOT_FOUND', '/payload/task_id')
  })

  it('run-end / claim / artifact events: subject must belong to the owner WS', () => {
    expectCode(resultOf(envelope('RUN_FINISHED', { run_id: 'R-3' })), 'OWNER_MISMATCH', '/payload/run_id') // R-3 ∈ WS-2
    expectCode(resultOf(envelope('CLAIM_RETRACTED', { claim_id: 'C-1' }, { ownerWorkstreamId: 'WS-2' })), 'OWNER_MISMATCH', '/payload/claim_id')
    expectCode(resultOf(envelope('ARTIFACT_MARKED_MISSING', { artifact_id: 'A-1' }, { ownerWorkstreamId: 'WS-2' })), 'OWNER_MISMATCH', '/payload/artifact_id')
  })

  it('TASK_*_CHANGED: task must belong to the owner WS', () => {
    expectCode(resultOf(envelope('TASK_EXECUTION_CHANGED', { task_id: 'T-3', from: 'EXECUTED', to: 'EXECUTED' })), 'OWNER_MISMATCH', '/payload/task_id')
    // positive control: T-3 with its own WS as owner
    expect(resultOf(envelope('TASK_VALIDATION_CHANGED', { task_id: 'T-3', from: 'PASSED', to: 'PENDING' }, { ownerWorkstreamId: 'WS-2' })).ok).toBe(true)
  })

  it('GATE_EVALUATED / MILESTONE_ACHIEVED: subject must belong to the owner WS', () => {
    expectCode(resultOf(envelope('GATE_EVALUATED', { gate_id: 'G-2', result: 'PASSED', evaluated_by: { kind: 'USER' } })), 'OWNER_MISMATCH', '/payload/gate_id') // G-2 ∈ WS-2
    expectCode(resultOf(envelope('MILESTONE_ACHIEVED', { milestone_id: 'M-1' }, { ownerWorkstreamId: 'WS-2' })), 'OWNER_MISMATCH', '/payload/milestone_id')
  })

  it('ARTIFACT_REGISTERED: related_task in the owner WS, supersedes must exist', () => {
    expectCode(resultOf(envelope('ARTIFACT_REGISTERED', { artifact_id: 'A-20', type: 'NOTE', title: 't', uri: 'u', related_task: 'T-3' })), 'OWNER_MISMATCH', '/payload/related_task')
    expectCode(resultOf(envelope('ARTIFACT_REGISTERED', { artifact_id: 'A-20', type: 'NOTE', title: 't', uri: 'u', related_task: 'T-99' })), 'OBJECT_NOT_FOUND', '/payload/related_task')
    expectCode(resultOf(envelope('ARTIFACT_REGISTERED', { artifact_id: 'A-20', type: 'NOTE', title: 't', uri: 'u', supersedes: 'A-99' })), 'OBJECT_NOT_FOUND', '/payload/supersedes')
    expectCode(resultOf(envelope('ARTIFACT_REGISTERED', { artifact_id: 'A-20', type: 'NOTE', title: 't', uri: 'u', created_by_run: 'R-99' })), 'OBJECT_NOT_FOUND', '/payload/created_by_run')
  })

  it('RELATION_ADDED: owner = source.ws ?? target.ws', () => {
    // source C-1 (WS-1) + target F-1 (WS-1), owner WS-2 ⇒ mismatch
    expectCode(
      resultOf(envelope('RELATION_ADDED', { relation_id: 'REL-20', source: { kind: 'CLAIM', id: 'C-1' }, relation_type: 'SUPPORTED_BY', target: { kind: 'FACT', id: 'F-1' } }, { ownerWorkstreamId: 'WS-2' })),
      'OWNER_MISMATCH',
      '/ownerWorkstreamId',
    )
    // source has no WS (OBJECTIVE) → owner falls back to the target's WS
    const ok = resultOf(envelope('RELATION_ADDED', { relation_id: 'REL-20', source: { kind: 'OBJECTIVE', id: 'OBJ-1' }, relation_type: 'RELATED_TO', target: { kind: 'TASK', id: 'T-1' } }))
    expect(ok.ok).toBe(true)
  })

  it('RELATION_ADDED: both endpoints non-workstream-local ⇒ V1 refuses (no owner)', () => {
    expectCode(
      resultOf(envelope('RELATION_ADDED', { relation_id: 'REL-20', source: { kind: 'OBJECTIVE', id: 'OBJ-1' }, relation_type: 'RELATED_TO', target: { kind: 'OBJECTIVE', id: 'OBJ-2' } })),
      'OWNER_MISMATCH',
      '/ownerWorkstreamId',
    )
  })

  it('RELATION_ADDED: dangling workstream-local endpoint ⇒ OBJECT_NOT_FOUND', () => {
    expectCode(resultOf(envelope('RELATION_ADDED', { relation_id: 'REL-20', source: { kind: 'TASK', id: 'T-99' }, relation_type: 'DEPENDS_ON', target: { kind: 'TASK', id: 'T-2' } })), 'OBJECT_NOT_FOUND', '/payload/source')
    expectCode(resultOf(envelope('RELATION_ADDED', { relation_id: 'REL-20', source: { kind: 'CLAIM', id: 'C-1' }, relation_type: 'SUPPORTED_BY', target: { kind: 'FACT', id: 'F-99' } })), 'OBJECT_NOT_FOUND', '/payload/target')
  })

  it('RELATION_REMOVED: owner rule applies to the STORED relation; redundancy must match', () => {
    const base = { relation_id: 'REL-1', source: { kind: 'TASK', id: 'T-1' }, relation_type: 'DEPENDS_ON', target: { kind: 'TASK', id: 'T-2' } }
    expectCode(resultOf(envelope('RELATION_REMOVED', base, { ownerWorkstreamId: 'WS-2' })), 'OWNER_MISMATCH', '/ownerWorkstreamId')
    expectCode(resultOf(envelope('RELATION_REMOVED', { ...base, relation_type: 'CONSUMES' })), 'CROSS_FIELD', '/payload/source')
    expectCode(resultOf(envelope('RELATION_REMOVED', { ...base, target: { kind: 'TASK', id: 'T-3' } })), 'CROSS_FIELD', '/payload/source')
  })

  it('INTERVENTION_CREATED: owner = first related WS; no related WS ⇒ no event', () => {
    // first related WS derivable from source_refs: R-3 (WS-2) — owner must be WS-2
    expectCode(
      resultOf(envelope('INTERVENTION_CREATED', { intervention_id: 'IV-20', title: 't', origin: 'USER', source_refs: [{ kind: 'RUN', id: 'R-3' }, { kind: 'RUN', id: 'R-1' }] })),
      'OWNER_MISMATCH',
      '/ownerWorkstreamId',
    )
    // OBJECTIVE-only refs carry no WS ⇒ the intervention must not emit an event
    expectCode(
      resultOf(envelope('INTERVENTION_CREATED', { intervention_id: 'IV-20', title: 't', origin: 'USER', source_refs: [{ kind: 'OBJECTIVE', id: 'OBJ-1' }] })),
      'OWNER_MISMATCH',
      '/ownerWorkstreamId',
    )
    expectCode(resultOf(envelope('INTERVENTION_CREATED', { intervention_id: 'IV-20', title: 't', origin: 'USER' })), 'OWNER_MISMATCH', '/ownerWorkstreamId')
    // dangling WS-local source ref ⇒ OBJECT_NOT_FOUND
    expectCode(resultOf(envelope('INTERVENTION_CREATED', { intervention_id: 'IV-20', title: 't', origin: 'USER', source_refs: [{ kind: 'RUN', id: 'R-99' }] })), 'OBJECT_NOT_FOUND', '/payload/source_refs/0')
  })

  it('TOPOLOGY_FORK_REALIZED: owner = inputs[0] (INV-HIST-9), same owner Topic', () => {
    expectCode(resultOf(envelope('TOPOLOGY_FORK_REALIZED', { topology_edge_id: 'TE-1', inputs: ['WS-1'], outputs: ['WS-2'] }, { ownerWorkstreamId: 'WS-2' })), 'OWNER_MISMATCH', '/ownerWorkstreamId')
    // owner matches inputs[0] but sits in a different topic than the edge
    // (TE-4 ∈ TPC-2, owner WS-1 ∈ TPC-1): also, the payload must mirror the
    // edge's declared endpoints.
    const result = resultOf(envelope('TOPOLOGY_FORK_REALIZED', { topology_edge_id: 'TE-4', inputs: ['WS-3'], outputs: ['WS-5'] }, { ownerWorkstreamId: 'WS-3' }))
    expect(result.ok).toBe(true) // WS-3 (TPC-2) = inputs[0], edge topic TPC-2 ✓
    const wrongTopic = resultOf(envelope('TOPOLOGY_FORK_REALIZED', { topology_edge_id: 'TE-1', inputs: ['WS-1'], outputs: ['WS-2'] }, { ownerWorkstreamId: 'WS-3' }))
    expectCode(wrongTopic, 'OWNER_MISMATCH', '/ownerWorkstreamId') // owner ≠ inputs[0] AND cross-topic
  })

  it('TOPOLOGY_MERGE_REALIZED: owner = outputs[0] (INV-HIST-9)', () => {
    expectCode(resultOf(envelope('TOPOLOGY_MERGE_REALIZED', { topology_edge_id: 'TE-2', inputs: ['WS-2', 'WS-4'], outputs: ['WS-1'] }, { ownerWorkstreamId: 'WS-2' })), 'OWNER_MISMATCH', '/ownerWorkstreamId')
  })

  it('TOPOLOGY_*_REALIZED: payload endpoints must mirror the edge; a FORK event on a MERGE edge is rejected', () => {
    expectCode(resultOf(envelope('TOPOLOGY_FORK_REALIZED', { topology_edge_id: 'TE-1', inputs: ['WS-1'], outputs: ['WS-2', 'WS-4'] })), 'CROSS_FIELD', '/payload/outputs')
    // a FORK event naming the MERGE edge TE-2: the single-input FORK payload
    // cannot mirror TE-2's two declared inputs — both the operation and the
    // mirror checks fire (the operation check is the point under test)
    expectCode(resultOf(envelope('TOPOLOGY_FORK_REALIZED', { topology_edge_id: 'TE-2', inputs: ['WS-2'], outputs: ['WS-1'] })), 'CROSS_FIELD', '/payload/topology_edge_id')
  })
})

describe('WP-2.2 — payload cross-field rules (catalog §5)', () => {
  it('GATE_EVALUATED: WAIVED requires actor.kind=USER and a non-empty note (§5.6)', () => {
    // USER-only event ⇒ the actor-kind half is exercised via the note half and
    // the emitter layer; with a USER actor a missing note is the violation:
    expectCode(resultOf(envelope('GATE_EVALUATED', { gate_id: 'G-1', result: 'WAIVED', evaluated_by: { kind: 'USER' } })), 'CROSS_FIELD', '/payload/note')
    expectCode(resultOf(envelope('GATE_EVALUATED', { gate_id: 'G-1', result: 'WAIVED', evaluated_by: { kind: 'USER' }, note: '   ' })), 'CROSS_FIELD', '/payload/note')
    const ok = resultOf(envelope('GATE_EVALUATED', { gate_id: 'G-1', result: 'WAIVED', evaluated_by: { kind: 'USER' }, note: 'criteria met in practice' }))
    expect(ok.ok).toBe(true)
  })

  it('TASK_VALIDATION_CHANGED: to=NOT_REQUIRED requires empty acceptance_criteria (INV-TASK-3)', () => {
    // T-1 has 2 ACs
    expectCode(resultOf(envelope('TASK_VALIDATION_CHANGED', { task_id: 'T-1', from: 'PENDING', to: 'NOT_REQUIRED' })), 'CROSS_FIELD', '/payload/to')
    // T-2 has empty ACs — legal
    expect(resultOf(envelope('TASK_VALIDATION_CHANGED', { task_id: 'T-2', from: 'PENDING', to: 'NOT_REQUIRED' })).ok).toBe(true)
  })

  it('FACT/CLAIM_RECORDED: AGENT emitter requires created_by_run (§5.3)', () => {
    expectCode(resultOf(envelope('FACT_RECORDED', { fact_id: 'F-20', statement: 's' }, { actor: { kind: 'AGENT', run_id: 'R-1' } })), 'CROSS_FIELD', '/payload/created_by_run')
    expectCode(resultOf(envelope('CLAIM_RECORDED', { claim_id: 'C-20', statement: 's' }, { actor: { kind: 'AGENT', run_id: 'R-1' } })), 'CROSS_FIELD', '/payload/created_by_run')
    // USER emitter: created_by_run optional (positive control)
    expect(resultOf(envelope('FACT_RECORDED', { fact_id: 'F-20', statement: 's' })).ok).toBe(true)
    // provided but dangling
    expectCode(resultOf(envelope('FACT_RECORDED', { fact_id: 'F-20', statement: 's', created_by_run: 'R-99' }, { actor: { kind: 'AGENT', run_id: 'R-1' } })), 'OBJECT_NOT_FOUND', '/payload/created_by_run')
  })

  it('INTERVENTION_CREATED: origin=AUTO_* requires actor.kind=PLUGIN (§5.7)', () => {
    expectCode(resultOf(envelope('INTERVENTION_CREATED', { intervention_id: 'IV-20', title: 't', origin: 'AUTO_FLOODING', source_refs: [{ kind: 'RUN', id: 'R-1' }] }, { actor: { kind: 'USER' } })), 'CROSS_FIELD', '/payload/origin')
    expectCode(resultOf(envelope('INTERVENTION_CREATED', { intervention_id: 'IV-20', title: 't', origin: 'AUTO_AUDIT', source_refs: [{ kind: 'RUN', id: 'R-1' }] }, { actor: { kind: 'AGENT', run_id: 'R-1' } })), 'CROSS_FIELD', '/payload/origin')
    // AGENT_REPORT allows AGENT (positive control)
    expect(resultOf(envelope('INTERVENTION_CREATED', { intervention_id: 'IV-20', title: 't', origin: 'AGENT_REPORT', source_refs: [{ kind: 'RUN', id: 'R-1' }] }, { actor: { kind: 'AGENT', run_id: 'R-1' } })).ok).toBe(true)
  })

  it('evidence_refs / source_refs of workstream-local kinds must exist', () => {
    expectCode(resultOf(envelope('GATE_EVALUATED', { gate_id: 'G-1', result: 'PASSED', evaluated_by: { kind: 'USER' }, evidence_refs: [{ kind: 'FACT', id: 'F-99' }] })), 'OBJECT_NOT_FOUND', '/payload/evidence_refs/0')
    expectCode(resultOf(envelope('MILESTONE_ACHIEVED', { milestone_id: 'M-1', evidence_refs: [{ kind: 'ARTIFACT', id: 'A-99' }] })), 'OBJECT_NOT_FOUND', '/payload/evidence_refs/0')
  })
})

describe('WP-2.2 — relation combination table (DOMAIN_SCHEMA §8, INV-REL-1/2)', () => {
  const rel = (type: string, source: { kind: string; id: string }, target: { kind: string; id: string }) =>
    resultOf(envelope('RELATION_ADDED', { relation_id: 'REL-20', source, relation_type: type, target }))

  it('listed combinations are accepted', () => {
    expect(rel('DEPENDS_ON', { kind: 'TASK', id: 'T-1' }, { kind: 'TASK', id: 'T-2' }).ok).toBe(true)
    expect(rel('SUPPORTED_BY', { kind: 'CLAIM', id: 'C-1' }, { kind: 'ARTIFACT', id: 'A-1' }).ok).toBe(true)
    expect(rel('PRODUCED_BY', { kind: 'ARTIFACT', id: 'A-1' }, { kind: 'RUN', id: 'R-1' }).ok).toBe(true)
    expect(rel('CONTRIBUTES_TO', { kind: 'WORKSTREAM', id: 'WS-1' }, { kind: 'OBJECTIVE', id: 'OBJ-1' }).ok).toBe(true)
    expect(rel('IMPLEMENTS', { kind: 'TASK', id: 'T-1' }, { kind: 'MILESTONE', id: 'M-1' }).ok).toBe(true)
    expect(rel('RELATED_TO', { kind: 'PROJECT', id: 'PRJ-1' }, { kind: 'RUN', id: 'R-1' }).ok).toBe(true)
  })

  it('unlisted (source.kind → target.kind) pairs are rejected', () => {
    expectCode(rel('DEPENDS_ON', { kind: 'FACT', id: 'F-1' }, { kind: 'TASK', id: 'T-2' }), 'CROSS_FIELD', '/payload/relation_type')
    expectCode(rel('SUPPORTED_BY', { kind: 'TASK', id: 'T-1' }, { kind: 'FACT', id: 'F-1' }), 'CROSS_FIELD', '/payload/relation_type')
    expectCode(rel('PRODUCED_BY', { kind: 'ARTIFACT', id: 'A-1' }, { kind: 'TASK', id: 'T-1' }), 'CROSS_FIELD', '/payload/relation_type')
    expectCode(rel('CONSUMES', { kind: 'GATE', id: 'G-1' }, { kind: 'ARTIFACT', id: 'A-1' }), 'CROSS_FIELD', '/payload/relation_type')
    expectCode(rel('VALIDATED_BY', { kind: 'TASK', id: 'T-1' }, { kind: 'ARTIFACT', id: 'A-1' }), 'CROSS_FIELD', '/payload/relation_type')
    // RELATED_TO accepts any→any (no rejection even for odd pairs)
    expect(rel('RELATED_TO', { kind: 'FACT', id: 'F-1' }, { kind: 'GATE', id: 'G-1' }).ok).toBe(true)
  })
})
