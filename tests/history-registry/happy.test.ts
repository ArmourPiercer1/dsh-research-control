/**
 * WP-2.2 — happy path: the registry loaded from the REAL frozen
 * WR/schema/history is complete and consistent, and all 20 event types
 * validate their §5 real-form positives.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import type { HistoryEvent, HistoryEventType } from '../../src/host/history/registry/index.js'
import {
  EVENT_METADATA,
  LEGAL_TRANSITIONS,
  RELATION_COMBINATION_TABLE,
  isEventOf,
  isInterventionCreated,
  isRunStarted,
  isTopologyMergeRealized,
  loadHistoryEventRegistry,
  validateEvent,
} from '../../src/host/history/registry/index.js'
import { FsReader, POSITIVE_EVENTS, WR_HISTORY_SCHEMA_DIR, makeCtx, positiveEvent } from './fixtures.js'

describe('WP-2.2 registry — schema-driven load (real WR/schema/history)', () => {
  const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)

  it('loads the 20 types from the frozen oneOf, schema order, all schemaVersion 1', () => {
    expect(registry.loadErrors).toEqual([])
    expect(registry.isUsable).toBe(true)
    expect(registry.eventTypes).toEqual([
      'RUN_STARTED',
      'RUNS_STARTED',
      'RUN_FINISHED',
      'RUN_FAILED',
      'RUN_CANCELLED',
      'TASK_EXECUTION_CHANGED',
      'TASK_VALIDATION_CHANGED',
      'ACCEPTANCE_CRITERIA_CHANGED',
      'FACT_RECORDED',
      'CLAIM_RECORDED',
      'CLAIM_RETRACTED',
      'ARTIFACT_REGISTERED',
      'ARTIFACT_MARKED_MISSING',
      'RELATION_ADDED',
      'RELATION_REMOVED',
      'GATE_EVALUATED',
      'MILESTONE_ACHIEVED',
      'INTERVENTION_CREATED',
      'TOPOLOGY_FORK_REALIZED',
      'TOPOLOGY_MERGE_REALIZED',
    ])
    expect(registry.events.size).toBe(20)
    for (const type of registry.eventTypes) {
      expect(registry.events.get(type)?.schemaVersion).toBe(1)
    }
  })

  it('carries the §4 emitter matrix verbatim (incl. the conservative USER-only set)', () => {
    const emitters = (type: HistoryEventType) => registry.events.get(type)!.emitters
    expect(emitters('RUN_STARTED')).toEqual(['USER', 'AGENT', 'PLUGIN'])
    expect(emitters('RUNS_STARTED')).toEqual(['USER', 'PLUGIN']) // no AGENT
    expect(emitters('RUN_FINISHED')).toEqual(['USER', 'AGENT', 'PLUGIN'])
    expect(emitters('RUN_FAILED')).toEqual(['USER', 'AGENT', 'PLUGIN'])
    expect(emitters('RUN_CANCELLED')).toEqual(['USER', 'AGENT']) // no PLUGIN
    expect(emitters('TASK_EXECUTION_CHANGED')).toEqual(['USER'])
    expect(emitters('TASK_VALIDATION_CHANGED')).toEqual(['USER'])
    expect(emitters('ACCEPTANCE_CRITERIA_CHANGED')).toEqual(['USER'])
    expect(emitters('FACT_RECORDED')).toEqual(['USER', 'AGENT'])
    expect(emitters('CLAIM_RECORDED')).toEqual(['USER', 'AGENT'])
    expect(emitters('CLAIM_RETRACTED')).toEqual(['USER', 'AGENT'])
    expect(emitters('ARTIFACT_REGISTERED')).toEqual(['USER', 'AGENT'])
    expect(emitters('ARTIFACT_MARKED_MISSING')).toEqual(['USER', 'AGENT', 'PLUGIN'])
    expect(emitters('RELATION_ADDED')).toEqual(['USER', 'AGENT'])
    expect(emitters('RELATION_REMOVED')).toEqual(['USER', 'AGENT'])
    expect(emitters('GATE_EVALUATED')).toEqual(['USER'])
    expect(emitters('MILESTONE_ACHIEVED')).toEqual(['USER'])
    expect(emitters('INTERVENTION_CREATED')).toEqual(['USER', 'AGENT', 'PLUGIN'])
    expect(emitters('TOPOLOGY_FORK_REALIZED')).toEqual(['USER'])
    expect(emitters('TOPOLOGY_MERGE_REALIZED')).toEqual(['USER'])
  })

  it('marks exactly the three §4 M-column events as mutations', () => {
    const mutations = registry.eventTypes.filter((t) => registry.events.get(t)!.isMutation)
    expect(mutations).toEqual(['TASK_EXECUTION_CHANGED', 'TASK_VALIDATION_CHANGED', 'ACCEPTANCE_CRITERIA_CHANGED'])
  })

  it('carries a transition (from→to) row for every state-moving event, none for pure creations', () => {
    const withTransition = registry.eventTypes.filter((t) => registry.events.get(t)!.transition !== undefined)
    expect(withTransition.sort()).toEqual(
      [
        'ACCEPTANCE_CRITERIA_CHANGED',
        'ARTIFACT_MARKED_MISSING',
        'CLAIM_RETRACTED',
        'GATE_EVALUATED',
        'MILESTONE_ACHIEVED',
        'RELATION_REMOVED',
        'RUN_CANCELLED',
        'RUN_FAILED',
        'RUN_FINISHED',
        'TASK_EXECUTION_CHANGED',
        'TASK_VALIDATION_CHANGED',
        'TOPOLOGY_FORK_REALIZED',
        'TOPOLOGY_MERGE_REALIZED',
      ].sort(),
    )
    expect(registry.events.get('RUN_STARTED')!.transition).toBeUndefined()
    expect(registry.events.get('FACT_RECORDED')!.transition).toBeUndefined()
  })

  it('encodes the §13 transition table used for mutation consistency', () => {
    expect(LEGAL_TRANSITIONS.taskExecution.EXECUTED).toEqual([])
    expect(LEGAL_TRANSITIONS.taskExecution.PLANNED).toEqual(['ACTIVE', 'EXECUTED', 'CANCELLED'])
    expect(LEGAL_TRANSITIONS.taskValidation.PASSED).toEqual(['PENDING'])
    expect(LEGAL_TRANSITIONS.run.RUNNING).toEqual(['FINISHED', 'FAILED', 'CANCELLED'])
    expect(LEGAL_TRANSITIONS.claim.ACTIVE).toEqual(['RETRACTED'])
    expect(LEGAL_TRANSITIONS.topologyEdge.PLANNED).toEqual(['REALIZED', 'DROPPED'])
  })

  it('carries the owner rules (§4 owner column + INV-HIST-9 special cases)', () => {
    expect(registry.events.get('RUN_STARTED')!.ownerRule).toEqual({ kind: 'objectWs' })
    expect(registry.events.get('RUNS_STARTED')!.ownerRule).toEqual({ kind: 'perOwnerBatch' })
    expect(registry.events.get('RELATION_ADDED')!.ownerRule).toEqual({ kind: 'relationEndpoints' })
    expect(registry.events.get('INTERVENTION_CREATED')!.ownerRule).toEqual({ kind: 'firstRelatedWs' })
    expect(registry.events.get('TOPOLOGY_FORK_REALIZED')!.ownerRule).toEqual({ kind: 'topologyInputs0' })
    expect(registry.events.get('TOPOLOGY_MERGE_REALIZED')!.ownerRule).toEqual({ kind: 'topologyOutputs0' })
  })

  it('marks RUNS_STARTED as the sole aggregate event with the §3.1/§5.2 member rules', () => {
    expect(registry.events.get('RUNS_STARTED')!.aggregate).toEqual({
      eventType: 'RUNS_STARTED',
      memberField: 'runs',
      minMembers: 2,
      perOwnerEnvelope: true,
      runEndsPerRun: true,
    })
    for (const type of registry.eventTypes) {
      if (type !== 'RUNS_STARTED') expect(registry.events.get(type)!.aggregate, type).toBeUndefined()
    }
  })

  it('exposes the 10-row §8 relation combination table', () => {
    expect(Object.keys(RELATION_COMBINATION_TABLE).sort()).toEqual(
      ['CONSUMES', 'CONTRADICTED_BY', 'CONTRIBUTES_TO', 'DEPENDS_ON', 'DERIVED_FROM', 'IMPLEMENTS', 'PRODUCED_BY', 'RELATED_TO', 'SUPPORTED_BY', 'VALIDATED_BY'].sort(),
    )
    expect(EVENT_METADATA).toBeDefined()
  })
})

describe('WP-2.2 validateEvent — 20 real-form positives (catalog §5 tables)', () => {
  const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)

  beforeAll(() => {
    expect(registry.isUsable).toBe(true)
  })

  it.each(Object.keys(POSITIVE_EVENTS) as (keyof typeof POSITIVE_EVENTS)[])('%s accepts its §5 real-form payload', (type) => {
    const event = positiveEvent(type)
    const result = validateEvent(registry, event, makeCtx())
    expect(result, JSON.stringify(result, null, 2)).toEqual({ ok: true, eventType: type, ownerWorkstreamId: 'WS-1' })
  })

  it('the EventOf<T> type surface narrows payloads through the guards', () => {
    const started = positiveEvent('RUN_STARTED') as HistoryEvent
    const intervention = positiveEvent('INTERVENTION_CREATED') as HistoryEvent
    const merged = positiveEvent('TOPOLOGY_MERGE_REALIZED') as HistoryEvent
    expect(isRunStarted(started)).toBe(true)
    expect(isRunStarted(intervention)).toBe(false)
    expect(isInterventionCreated(intervention)).toBe(true)
    expect(isTopologyMergeRealized(merged)).toBe(true)
    // isEventOf is a plain checker (non-narrowing)
    expect(isEventOf('RUNS_STARTED', started)).toBe(false)
    // narrowed payload fields type-check:
    if (isRunStarted(started)) {
      expect(started.payload.run_id).toBe('R-10')
    } else {
      throw new Error('expected isRunStarted to narrow')
    }
  })
})
