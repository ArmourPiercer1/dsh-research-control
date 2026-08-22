/**
 * WP-2.2 — wrapper/atomic (aggregate) semantics (§3.1 atomicity + §3.7
 * readability aggregation + §5.2 batch envelope; INV-HIST-2/8, TC-HIST-007).
 */
import { describe, expect, it } from 'vitest'

import type { EventOf, HistoryEvent } from '../../src/host/history/registry/index.js'
import {
  BATCH_LAUNCH_RULES,
  batchMembers,
  batchOwnerWorkstreams,
  isBatchLaunch,
  loadHistoryEventRegistry,
  validateEvent,
} from '../../src/host/history/registry/index.js'
import { FsReader, WR_HISTORY_SCHEMA_DIR, envelope, makeCtx } from './fixtures.js'

const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)

describe('WP-2.2 — the frozen aggregate rule set', () => {
  it('RUNS_STARTED is the sole INV-HIST-2 exception with its member rules', () => {
    expect(BATCH_LAUNCH_RULES).toEqual({
      eventType: 'RUNS_STARTED',
      memberField: 'runs',
      minMembers: 2,
      perOwnerEnvelope: true,
      runEndsPerRun: true,
      underlyingEventsImmutable: true,
    })
    // there is no RUNS_FINISHED / batch-run-end event in the 20-type catalog
    expect(registry.events.has('RUNS_FINISHED' as never)).toBe(false)
    expect(registry.events.has('RUN_ENDED' as never)).toBe(false)
  })
})

describe('WP-2.2 — aggregate member rules at validation time (TC-HIST-007)', () => {
  it('a 1-member "batch" is rejected by the schema (minItems 2 ⇒ use RUN_STARTED)', () => {
    const result = validateEvent(registry, envelope('RUNS_STARTED', { runs: [{ run_id: 'R-20', task_id: 'T-1' }] }), makeCtx())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'ENVELOPE' && e.path === '/payload/runs')).toBe(true)
    }
  })

  it('a 2-member batch validates; members must be fresh and task-anchored', () => {
    const ok = validateEvent(registry, envelope('RUNS_STARTED', { runs: [{ run_id: 'R-20', task_id: 'T-1' }, { run_id: 'R-21', task_id: 'T-2' }] }), makeCtx())
    expect(ok.ok).toBe(true)
    const dup = validateEvent(registry, envelope('RUNS_STARTED', { runs: [{ run_id: 'R-1' }, { run_id: 'R-20' }] }), makeCtx())
    expect(dup.ok).toBe(false)
  })
})

describe('WP-2.2 — §5.2 per-owner envelope fan-out (one same-payload event per owner WS)', () => {
  const batch = { runs: [{ run_id: 'R-30', task_id: 'T-1' }, { run_id: 'R-31', task_id: 'T-3' }] } // T-1 ∈ WS-1, T-3 ∈ WS-2

  it('the same payload registers once per relevant owner WS, both events valid', () => {
    const ws1 = validateEvent(registry, envelope('RUNS_STARTED', batch, { ownerWorkstreamId: 'WS-1' }), makeCtx())
    const ws2 = validateEvent(registry, envelope('RUNS_STARTED', batch, { ownerWorkstreamId: 'WS-2' }), makeCtx())
    expect(ws1.ok).toBe(true)
    expect(ws2.ok).toBe(true)
    // owner existence is the single-event check; a nonexistent owner is rejected
    const ghost = validateEvent(registry, envelope('RUNS_STARTED', batch, { ownerWorkstreamId: 'WS-99' }), makeCtx())
    expect(ghost.ok).toBe(false)
  })

  it('batchOwnerWorkstreams derives the fan-out set (unique, first-seen order)', () => {
    const ctx = makeCtx()
    const lookup = (taskId: string) => ctx.tasks.get(taskId)?.workstreamId
    expect(batchOwnerWorkstreams(batch.runs, lookup)).toEqual(['WS-1', 'WS-2'])
    // bare run entries (no task_id) contribute no owner
    expect(batchOwnerWorkstreams([{ run_id: 'R-30' }], lookup)).toEqual([])
    // duplicates collapse
    expect(batchOwnerWorkstreams([{ run_id: 'R-30', task_id: 'T-1' }, { run_id: 'R-31', task_id: 'T-2' }], lookup)).toEqual(['WS-1'])
  })
})

describe('WP-2.2 — §3.7/INV-HIST-8: the wrapper layer never modifies the underlying events', () => {
  it('isBatchLaunch guards the accessor; batchMembers returns the event\'s own array (no copy, no rewrite)', () => {
    const event = envelope('RUNS_STARTED', { runs: [{ run_id: 'R-20' }, { run_id: 'R-21' }] }) as unknown as EventOf<'RUNS_STARTED'>
    expect(isBatchLaunch(event as HistoryEvent)).toBe(true)
    const finished = envelope('RUN_FINISHED', { run_id: 'R-1' }) as unknown as HistoryEvent
    expect(isBatchLaunch(finished)).toBe(false)
    const members = batchMembers(event)
    expect(members).toBe(event.payload.runs) // identity: the projection sees the base events as-is
    expect(members).toEqual([{ run_id: 'R-20' }, { run_id: 'R-21' }])
    // the accessor throws on a non-batch event (the projection never fabricates members)
    expect(() => batchMembers(finished as EventOf<'RUNS_STARTED'>)).toThrow(TypeError)
    // and reading members changed nothing about the underlying event:
    expect(event.payload.runs).toEqual(members)
    expect((event as HistoryEvent).eventType).toBe('RUNS_STARTED')
  })
})
