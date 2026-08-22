/**
 * WP-2.2 — emitter matrix negatives (catalog §3.6 / §4 E column; the
 * 「发射者保守性说明」 USER-only set) + the AGENT-actor run_id rule
 * (catalog §5 通用校验: AGENT 发射的事件校验 actor.run_id 对应 Run 存在).
 */
import { describe, expect, it } from 'vitest'

import type { EventValidationResult } from '../../src/host/history/registry/index.js'
import { loadHistoryEventRegistry, validateEvent } from '../../src/host/history/registry/index.js'
import { FsReader, WR_HISTORY_SCHEMA_DIR, envelope, makeCtx, positiveEvent } from './fixtures.js'

const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)

function resultOf(event: Record<string, unknown>): EventValidationResult {
  return validateEvent(registry, event, makeCtx())
}

function expectEmitterRejected(result: EventValidationResult, type: string, kind: string): void {
  expect(result.ok).toBe(false)
  if (!result.ok) {
    const err = result.errors.find((e) => e.code === 'EMITTER_FORBIDDEN')
    expect(err, `expected EMITTER_FORBIDDEN in ${JSON.stringify(result.errors)}`).toBeDefined()
    expect(err!.path).toBe('/actor/kind')
    expect(err!.message).toContain(kind)
    expect(err!.message).toContain(type)
  }
}

describe('WP-2.2 — emitter matrix (catalog §4 E column)', () => {
  it('TASK_EXECUTION_CHANGED / TASK_VALIDATION_CHANGED / ACCEPTANCE_CRITERIA_CHANGED are USER-only', () => {
    expectEmitterRejected(resultOf(envelope('TASK_EXECUTION_CHANGED', { task_id: 'T-2', from: 'PLANNED', to: 'ACTIVE' }, { actor: { kind: 'AGENT', run_id: 'R-1' } })), 'TASK_EXECUTION_CHANGED', 'AGENT')
    expectEmitterRejected(resultOf(envelope('TASK_EXECUTION_CHANGED', { task_id: 'T-2', from: 'PLANNED', to: 'ACTIVE' }, { actor: { kind: 'PLUGIN' } })), 'TASK_EXECUTION_CHANGED', 'PLUGIN')
    expectEmitterRejected(resultOf(envelope('TASK_VALIDATION_CHANGED', { task_id: 'T-2', from: 'PENDING', to: 'UNDER_REVIEW' }, { actor: { kind: 'AGENT', run_id: 'R-1' } })), 'TASK_VALIDATION_CHANGED', 'AGENT')
    expectEmitterRejected(resultOf(envelope('ACCEPTANCE_CRITERIA_CHANGED', { task_id: 'T-2', from: [], to: ['AC: x'] }, { actor: { kind: 'AGENT', run_id: 'R-1' } })), 'ACCEPTANCE_CRITERIA_CHANGED', 'AGENT')
  })

  it('GATE_EVALUATED / MILESTONE_ACHIEVED are USER-only (human judgment)', () => {
    expectEmitterRejected(resultOf(envelope('GATE_EVALUATED', { gate_id: 'G-1', result: 'PASSED', evaluated_by: { kind: 'USER' } }, { actor: { kind: 'AGENT', run_id: 'R-1' } })), 'GATE_EVALUATED', 'AGENT')
    expectEmitterRejected(resultOf(envelope('MILESTONE_ACHIEVED', { milestone_id: 'M-1' }, { actor: { kind: 'PLUGIN' } })), 'MILESTONE_ACHIEVED', 'PLUGIN')
  })

  it('TOPOLOGY_*_REALIZED are USER-only (GUI-confirmed realize)', () => {
    expectEmitterRejected(resultOf(envelope('TOPOLOGY_FORK_REALIZED', { topology_edge_id: 'TE-1', inputs: ['WS-1'], outputs: ['WS-2'] }, { actor: { kind: 'AGENT', run_id: 'R-1' } })), 'TOPOLOGY_FORK_REALIZED', 'AGENT')
    expectEmitterRejected(resultOf(envelope('TOPOLOGY_MERGE_REALIZED', { topology_edge_id: 'TE-2', inputs: ['WS-2', 'WS-4'], outputs: ['WS-1'] }, { actor: { kind: 'PLUGIN' } })), 'TOPOLOGY_MERGE_REALIZED', 'PLUGIN')
  })

  it('RUNS_STARTED is U+P only (no AGENT batch launch)', () => {
    expectEmitterRejected(
      resultOf(envelope('RUNS_STARTED', { runs: [{ run_id: 'R-20' }, { run_id: 'R-21' }] }, { actor: { kind: 'AGENT', run_id: 'R-1' } })),
      'RUNS_STARTED',
      'AGENT',
    )
  })

  it('RUN_CANCELLED is U+A only (no PLUGIN)', () => {
    expectEmitterRejected(resultOf(envelope('RUN_CANCELLED', { run_id: 'R-1', cancelled_by: { kind: 'USER' } }, { actor: { kind: 'PLUGIN' } })), 'RUN_CANCELLED', 'PLUGIN')
  })

  it('SYSTEM is not an emitter for any of the 20 events', () => {
    for (const type of registry.eventTypes) {
      const positive = positiveEvent(type) // §5 real-form payload for THIS type
      ;(positive as { actor?: unknown }).actor = { kind: 'SYSTEM' }
      const result = resultOf(positive)
      expect(result.ok, type).toBe(false)
      if (!result.ok) {
        expect(
          result.errors.some((e) => e.code === 'EMITTER_FORBIDDEN'),
          `${type}: expected EMITTER_FORBIDDEN, got ${JSON.stringify(result.errors.map((e) => e.code))}`,
        ).toBe(true)
      }
    }
  })

  it('the conservative set allows the allowed emitters (positive controls)', () => {
    // AGENT may launch a single run (RUN_STARTED: U A P)
    expect(resultOf(envelope('RUN_STARTED', { run_id: 'R-10', initiated_by: { kind: 'AGENT' } }, { actor: { kind: 'AGENT', run_id: 'R-1' } })).ok).toBe(true)
    // PLUGIN may record a run end (RUN_FINISHED: U A P)
    expect(resultOf(envelope('RUN_FINISHED', { run_id: 'R-1' }, { actor: { kind: 'PLUGIN', label: 'dsh-adapter' } })).ok).toBe(true)
    // AGENT may record fact/claim/relation (U A)
    expect(resultOf(envelope('FACT_RECORDED', { fact_id: 'F-20', statement: 's', created_by_run: 'R-1' }, { actor: { kind: 'AGENT', run_id: 'R-1' } })).ok).toBe(true)
    expect(resultOf(envelope('CLAIM_RECORDED', { claim_id: 'C-20', statement: 's', created_by_run: 'R-1' }, { actor: { kind: 'AGENT', run_id: 'R-1' } })).ok).toBe(true)
    // PLUGIN may mark an artifact missing (U A P)
    expect(resultOf(envelope('ARTIFACT_MARKED_MISSING', { artifact_id: 'A-1', detected_by: { kind: 'PLUGIN' } }, { actor: { kind: 'PLUGIN' } })).ok).toBe(true)
    // AGENT_REPORT intervention from an AGENT actor (U A P; origin is not AUTO_*)
    expect(resultOf(envelope('INTERVENTION_CREATED', { intervention_id: 'IV-20', title: 't', origin: 'AGENT_REPORT', source_refs: [{ kind: 'RUN', id: 'R-1' }] }, { actor: { kind: 'AGENT', run_id: 'R-1' } })).ok).toBe(true)
  })
})

describe('WP-2.2 — AGENT actor ⇒ run_id must reference an existing Run (catalog §5)', () => {
  it('AGENT actor without run_id is rejected (CROSS_FIELD)', () => {
    const result = resultOf(envelope('RUN_STARTED', { run_id: 'R-10', initiated_by: { kind: 'AGENT' } }, { actor: { kind: 'AGENT' } }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const err = result.errors.find((e) => e.code === 'CROSS_FIELD')
      expect(err, JSON.stringify(result.errors)).toBeDefined()
      expect(err!.path).toBe('/actor/run_id')
    }
  })

  it('AGENT actor with a missing run_id is rejected (OBJECT_NOT_FOUND)', () => {
    const result = resultOf(envelope('RUN_STARTED', { run_id: 'R-10', initiated_by: { kind: 'AGENT' } }, { actor: { kind: 'AGENT', run_id: 'R-99' } }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'OBJECT_NOT_FOUND' && e.path === '/actor/run_id')).toBe(true)
    }
  })
})
