/**
 * WP-2.3 — wrapper (projection) aggregation, catalog §3.7 / INV-HIST-8 /
 * TC-HIST-007's「wrapper 聚合视图不改底层」half:
 * the per-Run reading view groups run-lifecycle events WITHOUT touching the
 * underlying events (structural: no write path in the module; asserted:
 * frozen inputs + store rows byte-identical around the call).
 */
import { describe, expect, it } from 'vitest'

import {
  canonicalJson,
  collectAllEvents,
  runWrapper,
  type RunWrapperEntry,
} from '../../src/host/history/replay/index.js'
import type { HistoryEventRecord } from '../../src/host/persistence/store/index.js'
import { deepFreeze, makeEvent, snapshotEventLines, T0 } from './helpers.js'
import { freshStore } from './helpers.js'

const M = 60_000
const at = (n: number): number => T0 + M * n

function rec(partial: Partial<HistoryEventRecord> & { eventId: string; eventType: string }): HistoryEventRecord {
  return {
    ownerWorkstreamId: 'WS-1',
    eventSeq: 1,
    schemaVersion: 1,
    occurredAt: at(1),
    recordedAt: at(1) + 1000,
    actor: { kind: 'USER', user_id: 'u-alice' },
    payload: {},
    ...partial,
  }
}

/** The standard wrapper fixture: R-1 (start+finish), a 2-member batch
 *  (R-2, R-3) split per owner workstream (catalog §5.2 信封特例), R-3
 *  fails, plus a non-run event (task) that must pass through ungrouped. */
function fixture(): HistoryEventRecord[] {
  const rStart = rec({ eventId: 'W-1', eventType: 'RUN_STARTED', eventSeq: 1, occurredAt: at(1), payload: { run_id: 'R-1' } })
  const batch1 = rec({ eventId: 'W-2', eventType: 'RUNS_STARTED', eventSeq: 2, occurredAt: at(2), ownerWorkstreamId: 'WS-1', payload: { runs: [{ run_id: 'R-2' }, { run_id: 'R-3' }] } })
  const batch2 = rec({ eventId: 'W-3', eventType: 'RUNS_STARTED', eventSeq: 1, occurredAt: at(2), ownerWorkstreamId: 'WS-2', payload: { runs: [{ run_id: 'R-2' }, { run_id: 'R-3' }] } })
  const rFin = rec({ eventId: 'W-4', eventType: 'RUN_FINISHED', eventSeq: 3, occurredAt: at(3), payload: { run_id: 'R-1' } })
  const rFail = rec({ eventId: 'W-5', eventType: 'RUN_FAILED', eventSeq: 2, occurredAt: at(4), ownerWorkstreamId: 'WS-2', payload: { run_id: 'R-3', failure_kind: 'OOM' } })
  const task = rec({ eventId: 'W-6', eventType: 'TASK_EXECUTION_CHANGED', eventSeq: 4, occurredAt: at(5), payload: { task_id: 'T-1', from: 'PLANNED', to: 'ACTIVE' } })
  return [rStart, batch1, batch2, rFin, rFail, task]
}

function byRun(entries: readonly RunWrapperEntry[]): Map<string, RunWrapperEntry> {
  return new Map(entries.map((e) => [e.runId, e]))
}

describe('runWrapper — the per-Run reading view (§3.7)', () => {
  it('groups run-lifecycle events per run: statuses, start/end markers, sorted entries', () => {
    const entries = runWrapper(fixture())
    expect(entries.map((e) => e.runId)).toEqual(['R-1', 'R-2', 'R-3']) // sorted by runId

    const by = byRun(entries)
    const r1 = by.get('R-1')!
    expect(r1.events.map((e) => e.eventId)).toEqual(['W-1', 'W-4'])
    expect(r1.status).toBe('FINISHED')
    expect(r1.startEventId).toBe('W-1')
    expect(r1.endEventId).toBe('W-4')
    expect(r1.endEventType).toBe('RUN_FINISHED')
    expect(r1.ownerWorkstreams).toEqual(['WS-1'])

    const r2 = by.get('R-2')!
    expect(r2.status).toBe('RUNNING') // batch-started, never ended
    expect(r2.endEventId).toBeNull()
    expect(r2.endEventType).toBeNull()
    expect(r2.ownerWorkstreams).toEqual(['WS-1', 'WS-2']) // the batch's per-owner WSs

    const r3 = by.get('R-3')!
    expect(r3.status).toBe('FAILED')
    expect(r3.endEventType).toBe('RUN_FAILED')
    expect(r3.events.map((e) => e.eventId)).toEqual(['W-2', 'W-3', 'W-5'])
  })

  it('a RUNS_STARTED batch event is projected into EACH member run’s entry (projection duplication — one underlying row, INV-HIST-8)', () => {
    const input = fixture()
    const by = byRun(runWrapper(input))
    const batchWs1 = input[1]
    const batchWs2 = input[2]
    expect(by.get('R-2')!.events).toContain(batchWs1)
    expect(by.get('R-2')!.events).toContain(batchWs2)
    expect(by.get('R-3')!.events).toContain(batchWs1)
    expect(by.get('R-3')!.events).toContain(batchWs2)
    // the SAME references (zero-copy)
    expect(by.get('R-2')!.events.filter((e) => e === batchWs1).length).toBe(1)
  })

  it('zero-copy projection: member events are REFERENCES into the input array', () => {
    const input = fixture()
    const entries = runWrapper(input)
    for (const entry of entries) {
      for (const ev of entry.events) {
        expect(input).toContain(ev) // referential identity, not a copy
      }
    }
  })

  it('non-run events pass through ungrouped (no entry, no crash)', () => {
    const input = fixture()
    const entries = runWrapper(input)
    for (const entry of entries) {
      expect(entry.events.some((e) => e.eventType === 'TASK_EXECUTION_CHANGED')).toBe(false)
    }
    // a stream of ONLY non-run events → no entries at all
    expect(runWrapper([input[5]])).toEqual([])
  })

  it('is lenient on malformed payloads (defensive projection — validation is upstream): skips, never throws', () => {
    const weird = [
      rec({ eventId: 'X-1', eventType: 'RUN_STARTED', payload: {} }), // no run_id
      rec({ eventId: 'X-2', eventType: 'RUNS_STARTED', payload: { runs: 'nope' } }),
      rec({ eventId: 'X-3', eventType: 'RUN_FAILED', payload: { run_id: 42 } }),
      rec({ eventId: 'X-4', eventType: 'RUN_FINISHED', payload: null as never }),
    ]
    expect(runWrapper(weird)).toEqual([])
  })

  it('does NOT mutate its input: deep-frozen records + array survive the call byte-identical', () => {
    const input = deepFreeze(fixture())
    const before = JSON.stringify(input)
    const entries = runWrapper(input)
    expect(JSON.stringify(input)).toBe(before) // no mutation attempt survived under freeze
    expect(entries.length).toBe(3)
  })

  it('deterministic: entries sorted by runId regardless of input order; member order follows the input', () => {
    const input = fixture()
    const forward = runWrapper(input)
    const backward = runWrapper([...input].reverse())
    expect(backward.map((e) => e.runId)).toEqual(forward.map((e) => e.runId))
    expect(backward.map((e) => e.status)).toEqual(forward.map((e) => e.status))
    // member order is INPUT order:
    expect(backward[2].events.map((e) => e.eventId)).toEqual(['W-5', 'W-3', 'W-2']) // R-3, reversed
  })

  it('TC-HIST-007 (wrapper half): the wrapper leaves the UNDERLYING store events byte-identical', () => {
    const store = freshStore()
    const specs = [
      { eventId: 'W-1', eventType: 'RUN_STARTED', occurredAt: at(1), payload: { run_id: 'R-1' } },
      { eventId: 'W-2', eventType: 'RUNS_STARTED', occurredAt: at(2), ownerWorkstreamId: 'WS-1', payload: { runs: [{ run_id: 'R-2' }, { run_id: 'R-3' }] } },
      { eventId: 'W-3', eventType: 'RUNS_STARTED', occurredAt: at(2), ownerWorkstreamId: 'WS-2', payload: { runs: [{ run_id: 'R-2' }, { run_id: 'R-3' }] } },
      { eventId: 'W-4', eventType: 'RUN_FINISHED', occurredAt: at(3), payload: { run_id: 'R-1' } },
      { eventId: 'W-5', eventType: 'RUN_FAILED', occurredAt: at(4), ownerWorkstreamId: 'WS-2', payload: { run_id: 'R-3', failure_kind: 'OOM' } },
      { eventId: 'W-6', eventType: 'TASK_EXECUTION_CHANGED', occurredAt: at(5), payload: { task_id: 'T-1', from: 'PLANNED', to: 'ACTIVE' } },
    ]
    for (const s of specs) store.appendEvents([makeEvent(s)])
    const ws = ['WS-1', 'WS-2']
    const before = snapshotEventLines(store, ws)

    const events = collectAllEvents(store, ws, 'semantic')
    const entries = runWrapper(events)
    expect(entries.map((e) => e.runId)).toEqual(['R-1', 'R-2', 'R-3'])
    // the batch split is visible in the wrapper: two per-owner rows, two owners
    expect(entries.find((e) => e.runId === 'R-2')!.ownerWorkstreams).toEqual(['WS-1', 'WS-2'])
    expect(entries.find((e) => e.runId === 'R-2')!.events.length).toBe(2)

    // the underlying events: byte-identical after the wrapper (and re-query)
    const after = snapshotEventLines(store, ws)
    expect(after).toEqual(before)
    expect(canonicalJson(collectAllEvents(store, ws, 'semantic'))).toBe(canonicalJson(events))
  })
})
