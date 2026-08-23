/**
 * WP-4.6 — drill-down MODEL tests (pure projection, no DOM).
 *
 * Pins the TC-E2E-012/013 data path at the pure layer:
 *  - claim/artifact cards fold from the CLAIM_* / ARTIFACT_* events (with
 *    the `created_by_run` event pointer);
 *  - the run → DSH session pointer comes from the RUN_STARTED payload
 *    (`dsh_session_id`) and lands on the run-table rows;
 *  - `linkedRunsFor` resolves claim → run (CREATED_BY_RUN) and
 *    artifact → run (CREATED_BY_RUN + PRODUCED_BY_RELATION, deduped);
 *  - the fold is order-insensitive (the container may pass any replay
 *    order — the model sorts by eventSeq).
 */

import { describe, expect, it } from 'vitest'

import {
  buildDrilldownModel,
  linkedRunsFor,
  sessionPointersFor,
  type DrilldownModel,
} from '../../src/client/views/drilldown'
import {
  DRILLDOWN_HISTORY,
  DRILLDOWN_WORKSTREAM,
} from './fixtures'
import type { HistoryEventDto } from '../../src/shared/rpc-contracts.js'

function modelOf(events: readonly HistoryEventDto[]): DrilldownModel {
  return buildDrilldownModel(events, DRILLDOWN_WORKSTREAM.current.runs)
}

describe('buildDrilldownModel', () => {
  it('folds claims with the created_by_run pointer and ACTIVE status', () => {
    const model = modelOf(DRILLDOWN_HISTORY.events)
    expect(model.claims).toHaveLength(2)
    const c1 = model.claims.find((c) => c.id === 'C-1')
    expect(c1?.createdByRun).toBe('R-1')
    expect(c1?.status).toBe('ACTIVE')
    expect(c1?.statement).toBe('铁基超导的机制以电子关联主导')
    expect(c1?.relationIds).toEqual(['REL-1'])
    expect(model.claims.find((c) => c.id === 'C-2')?.createdByRun).toBe('R-2')
  })

  it('folds the artifact with pointer, related task and the PRODUCED_BY edge', () => {
    const model = modelOf(DRILLDOWN_HISTORY.events)
    expect(model.artifacts).toHaveLength(1)
    const a1 = model.artifacts[0]
    expect(a1.id).toBe('A-1')
    expect(a1.createdByRun).toBe('R-1')
    expect(a1.relatedTask).toBe('T-1')
    expect(a1.type).toBe('REPORT')
    expect(a1.status).toBe('REGISTERED')
    expect(a1.producedByRunIds).toEqual(['R-1'])
    expect(a1.relationIds).toEqual(['REL-2'])
  })

  it('applies terminal semantic events (retract / missing) in seq order', () => {
    const retract: HistoryEventDto = {
      eventId: 'H-9',
      ownerWorkstreamId: 'WS-1',
      eventType: 'CLAIM_RETRACTED',
      schemaVersion: 1,
      occurredAt: 2_000_000_000_000,
      actor: { kind: 'USER' },
      source: null,
      payload: { claim_id: 'C-1' },
      eventSeq: 9,
      recordedAt: 2_000_000_000_001,
    }
    const missing: HistoryEventDto = {
      eventId: 'H-10',
      ownerWorkstreamId: 'WS-1',
      eventType: 'ARTIFACT_MARKED_MISSING',
      schemaVersion: 1,
      occurredAt: 2_000_000_000_100,
      actor: { kind: 'USER' },
      source: null,
      payload: { artifact_id: 'A-1' },
      eventSeq: 10,
      recordedAt: 2_000_000_000_101,
    }
    const model = modelOf([...DRILLDOWN_HISTORY.events, missing, retract])
    expect(model.claims.find((c) => c.id === 'C-1')?.status).toBe('RETRACTED')
    expect(model.artifacts[0].status).toBe('MISSING')
  })

  it('marks ACTIVE relations REMOVED by RELATION_REMOVED (edges disappear)', () => {
    const removed: HistoryEventDto = {
      eventId: 'H-11',
      ownerWorkstreamId: 'WS-1',
      eventType: 'RELATION_REMOVED',
      schemaVersion: 1,
      occurredAt: 2_000_000_000_200,
      actor: { kind: 'USER' },
      source: null,
      payload: { relation_id: 'REL-2' },
      eventSeq: 11,
      recordedAt: 2_000_000_000_201,
    }
    const model = modelOf([...DRILLDOWN_HISTORY.events, removed])
    expect(model.artifacts[0].producedByRunIds).toEqual([])
    expect(model.artifacts[0].relationIds).toEqual([])
  })

  it('reads the session pointers from RUN_STARTED and joins them to the run table', () => {
    const model = modelOf(DRILLDOWN_HISTORY.events)
    expect(model.runs).toHaveLength(2)
    const r1 = model.runById.get('R-1')
    const r2 = model.runById.get('R-2')
    expect(r1?.dshSessionId).toBe('session-e2e-sess-1')
    expect(r2?.dshSessionId).toBe('session-e2e-sess-2')
    // the table row keeps its status (RUNNING survives; the log adds no run).
    expect(r2?.status).toBe('RUNNING')
    expect(r1?.status).toBe('FINISHED')
    // the event trail: RUN_STARTED/FINISHED + the actor-attributed semant-
    // ic events all point at R-1.
    expect(r1?.evidenceEventIds).toContain('H-1')
    expect(r1?.evidenceEventIds).toContain('H-6')
    expect(r1?.evidenceEventIds).toContain('H-2')
  })

  it('is order-insensitive (unsorted input folds to the same model)', () => {
    const shuffled = [...DRILLDOWN_HISTORY.events].reverse()
    const a = modelOf(DRILLDOWN_HISTORY.events)
    const b = modelOf(shuffled)
    expect(b.claims).toEqual(a.claims)
    expect(b.artifacts).toEqual(a.artifacts)
    expect(b.runs).toEqual(a.runs)
  })
})

describe('linkedRunsFor', () => {
  const model = modelOf(DRILLDOWN_HISTORY.events)

  it('links the claim to its producing run via the event pointer', () => {
    const claim = model.claims.find((c) => c.id === 'C-1')!
    const linked = linkedRunsFor(claim, model)
    expect(linked.map((r) => r.id)).toEqual(['R-1'])
    expect(linked[0].linkKinds).toEqual(['CREATED_BY_RUN'])
  })

  it('links the artifact through BOTH pointer kinds, deduped and sorted', () => {
    const artifact = model.artifacts[0]
    const linked = linkedRunsFor(artifact, model)
    expect(linked.map((r) => r.id)).toEqual(['R-1'])
    expect(linked[0].linkKinds).toEqual(['CREATED_BY_RUN', 'PRODUCED_BY_RELATION'])
  })

  it('returns no runs for a user-registered object (no pointer, no relations)', () => {
    const linked = linkedRunsFor({ createdByRun: null, producedByRunIds: [] }, model)
    expect(linked).toEqual([])
  })

  it('drops run ids absent from the run table (no fabricated rows)', () => {
    const linked = linkedRunsFor({ createdByRun: 'R-99' }, model)
    expect(linked).toEqual([])
  })

  it('returns the empty set for a null selection', () => {
    expect(linkedRunsFor(null, model)).toEqual([])
  })
})

describe('sessionPointersFor', () => {
  it('collects (runId, sessionId) pairs in stable order, skipping null pointers', () => {
    const model = modelOf(DRILLDOWN_HISTORY.events)
    const pointers = sessionPointersFor([
      model.runById.get('R-2')!,
      model.runById.get('R-1')!,
    ])
    expect(pointers).toEqual([
      { runId: 'R-1', sessionId: 'session-e2e-sess-1' },
      { runId: 'R-2', sessionId: 'session-e2e-sess-2' },
    ])
  })
})
