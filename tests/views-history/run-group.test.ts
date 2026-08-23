/**
 * WP-4.4 — the per-Run wrapper projection (pure unit tests).
 *
 * Pins the client display twin of the host wrapper semantics
 * (src/host/history/replay/wrapper.ts, WP-2.3; catalog §3.7 / INV-HIST-8):
 * run-lifecycle grouping (RUN_STARTED / RUNS_STARTED fan-out / the three
 * per-Run end events), leniency on odd payloads, zero-copy (member rows
 * are references into the input; deep-frozen input survives byte-identical),
 * determinism (groups sorted by runId, members in input order), and the
 * status rule (the LAST end event in input order wins over starts — the
 * late-registered-end semantic quirk included).
 */

import { describe, expect, it } from 'vitest'
import type { HistoryEventDto } from '../../src/shared/rpc-contracts.js'
import { runGroups } from '../../src/client/views/history/index.js'
import { makeEvent } from './fixtures.js'

const e = makeEvent

function started(id: string, runId: string, seq: number, occurredAt = 0): HistoryEventDto {
  return e({ eventId: id, eventType: 'RUN_STARTED', schemaVersion: 1, occurredAt, recordedAt: occurredAt + 1, eventSeq: seq, payload: { run_id: runId } })
}

function ended(id: string, runId: string, type: 'RUN_FINISHED' | 'RUN_FAILED' | 'RUN_CANCELLED', seq: number, occurredAt = 0): HistoryEventDto {
  return e({ eventId: id, eventType: type, schemaVersion: 1, occurredAt, recordedAt: occurredAt + 1, eventSeq: seq, payload: { run_id: runId } })
}

function batched(id: string, runIds: readonly string[], seq: number, occurredAt = 0): HistoryEventDto {
  return e({ eventId: id, eventType: 'RUNS_STARTED', schemaVersion: 1, occurredAt, recordedAt: occurredAt + 1, eventSeq: seq, payload: { runs: runIds.map(run_id => ({ run_id })) } })
}

function other(id: string, type: string, seq: number, payload: Record<string, unknown> = {}): HistoryEventDto {
  return e({ eventId: id, eventType: type, schemaVersion: 1, occurredAt: 0, recordedAt: 1, eventSeq: seq, payload })
}

describe('grouping — the run-lifecycle reference set', () => {
  it('groups start + end of one run with the derived status and event ids', () => {
    const groups = runGroups([
      started('H-1', 'R-1', 1),
      other('H-2', 'FACT_RECORDED', 2, { fact_id: 'F-1' }),
      ended('H-3', 'R-1', 'RUN_FINISHED', 3),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].runId).toBe('R-1')
    expect(groups[0].status).toBe('FINISHED')
    expect(groups[0].startEventId).toBe('H-1')
    expect(groups[0].endEventId).toBe('H-3')
    expect(groups[0].endEventType).toBe('RUN_FINISHED')
    expect(groups[0].events.map(ev => ev.eventId)).toEqual(['H-1', 'H-3'])
    expect(groups[0].ownerWorkstreams).toEqual(['WS-1'])
  })

  it('maps each end event type to its status', () => {
    expect(runGroups([ended('H-1', 'R-1', 'RUN_FAILED', 1)])[0].status).toBe('FAILED')
    expect(runGroups([ended('H-1', 'R-1', 'RUN_CANCELLED', 1)])[0].status).toBe('CANCELLED')
    expect(runGroups([started('H-1', 'R-1', 1)])[0].status).toBe('RUNNING')
  })

  it('passes non-run event types through ungrouped (no entries, no loss of input)', () => {
    const events = [other('H-1', 'GATE_EVALUATED', 1, { gate_id: 'G-1' }), other('H-2', 'MILESTONE_ACHIEVED', 2, { milestone_id: 'M-1' })]
    expect(runGroups(events)).toEqual([])
  })
})

describe('RUNS_STARTED fan-out — the projection duplication', () => {
  it('projects the SAME row into every member run group (zero-copy reference)', () => {
    const batch = batched('H-1', ['R-2', 'R-3'], 1)
    const second = ended('H-2', 'R-2', 'RUN_CANCELLED', 2)
    const groups = runGroups([batch, second])
    expect(groups.map(g => g.runId)).toEqual(['R-2', 'R-3'])
    // The batch row is the reference of the input array — not a copy.
    expect(groups[0].events[0]).toBe(batch)
    expect(groups[1].events[0]).toBe(batch)
    expect(groups[0].events).toHaveLength(2) // R-2: batch + its cancel
    expect(groups[1].events).toHaveLength(1) // R-3: batch only → RUNNING
    expect(groups[0].status).toBe('CANCELLED')
    expect(groups[1].status).toBe('RUNNING')
    expect(groups[0].startEventId).toBe('H-1')
    expect(groups[1].startEventId).toBe('H-1')
  })
})

describe('status precedence — the end wins over the start', () => {
  it('a late-registered end that SORTS BEFORE its start (semantic order) still wins', () => {
    // Semantic order: the end (occurredAt 5s) precedes the start (10s)
    // in the input, yet the wrapper reports the terminal status.
    const groups = runGroups([
      ended('H-2', 'R-1', 'RUN_FAILED', 3, 5_000),
      started('H-1', 'R-1', 1, 10_000),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].status).toBe('FAILED')
    expect(groups[0].endEventId).toBe('H-2')
    expect(groups[0].startEventId).toBe('H-1') // first start in input order
    expect(groups[0].events.map(ev => ev.eventId)).toEqual(['H-2', 'H-1']) // input order kept
  })

  it('the LAST end in input order wins when a run has several ends (defensive)', () => {
    const groups = runGroups([
      started('H-1', 'R-1', 1),
      ended('H-2', 'R-1', 'RUN_CANCELLED', 2),
      ended('H-3', 'R-1', 'RUN_FINISHED', 3),
    ])
    expect(groups[0].status).toBe('FINISHED')
    expect(groups[0].endEventId).toBe('H-3')
  })
})

describe('leniency — odd data degrades, never throws', () => {
  it('skips a run-lifecycle event whose payload lacks a usable run_id', () => {
    const noRun = e({ eventId: 'H-1', eventType: 'RUN_STARTED', schemaVersion: 1, occurredAt: 0, recordedAt: 1, eventSeq: 1, payload: { note: 'missing run_id' } })
    const badRuns = e({ eventId: 'H-2', eventType: 'RUNS_STARTED', schemaVersion: 1, occurredAt: 0, recordedAt: 1, eventSeq: 2, payload: { runs: [{ nope: true }, 'R-x'] } })
    const noPayload = e({ eventId: 'H-3', eventType: 'RUN_FINISHED', schemaVersion: 1, occurredAt: 0, recordedAt: 1, eventSeq: 3, payload: {} })
    expect(() => runGroups([noRun, badRuns, noPayload])).not.toThrow()
    expect(runGroups([noRun, badRuns, noPayload])).toEqual([])
  })

  it('rejects a non-array input loudly (programming error, not data)', () => {
    expect(() => runGroups(undefined as unknown as readonly HistoryEventDto[])).toThrow(TypeError)
  })
})

describe('zero-copy + input invariance (INV-HIST-8 / TC-HIST-007 client half)', () => {
  it('deep-frozen input survives the projection byte-identical; members are references', () => {
    const batch = batched('H-1', ['R-2', 'R-3'], 1)
    const start = started('H-2', 'R-4', 2)
    const input = [batch, start]
    Object.freeze(input)
    for (const ev of input) {
      Object.freeze(ev)
      Object.freeze(ev.payload)
      Object.freeze(ev.actor)
      Object.freeze(ev.source ?? {})
    }
    const groups = runGroups(input)
    expect(groups.map(g => g.runId)).toEqual(['R-2', 'R-3', 'R-4'])
    expect(groups[0].events[0]).toBe(batch)
    expect(groups[1].events[0]).toBe(batch)
    expect(groups[2].events[0]).toBe(start)
    // The underlying rows are untouched (frozen ⇒ any mutation would throw).
    expect(input[0]).toBe(batch)
    expect(input[0].eventType).toBe('RUNS_STARTED')
    expect(input[1].payload).toBe(start.payload)
  })
})

describe('determinism — input-order-independent group order, input-order members', () => {
  it('groups sort by runId whatever the input order; members keep input order', () => {
    const a = started('H-1', 'R-A', 1)
    const b = started('H-2', 'R-B', 2)
    const c = started('H-3', 'R-C', 3)
    const shuffled = [c, a, b]
    const groups = runGroups(shuffled)
    expect(groups.map(g => g.runId)).toEqual(['R-A', 'R-B', 'R-C'])
    expect(groups[0].events.map(ev => ev.eventId)).toEqual(['H-1'])
    expect(groups[1].events.map(ev => ev.eventId)).toEqual(['H-2'])
    expect(groups[2].events.map(ev => ev.eventId)).toEqual(['H-3'])
  })

  it('ownerWorkstreams are the distinct sorted owners of the member events', () => {
    const inA = e({ ...started('H-1', 'R-1', 1), ownerWorkstreamId: 'WS-A' })
    const inB = e({ ...started('H-2', 'R-1', 2), ownerWorkstreamId: 'WS-B' })
    const groups = runGroups([inB, inA])
    expect(groups[0].ownerWorkstreams).toEqual(['WS-A', 'WS-B'])
  })
})
