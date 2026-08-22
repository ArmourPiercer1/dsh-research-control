/**
 * WP-2.2 — late registration preparation (TC-HIST-002 校验半边 + §1/§2 双时序).
 *
 * Validation half: the validator takes NO previous-events context — an event
 * whose `occurredAt` is older than existing events and whose `eventSeq` is
 * the current max+1 validates identically (occurredAt monotonicity is NOT
 * assumed anywhere in validateEvent).
 * Store-facing half (pure helpers the store consumes at append time):
 * `nextEventSeq` (max+1, structurally independent of occurredAt),
 * `semanticOrder` / `auditOrder` (TC-HIST-004 tie-break).
 */
import { describe, expect, it } from 'vitest'

import { auditOrder, loadHistoryEventRegistry, nextEventSeq, semanticOrder, validateEvent } from '../../src/host/history/registry/index.js'
import { FsReader, T0, WR_HISTORY_SCHEMA_DIR, envelope, makeCtx } from './fixtures.js'

const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)

describe('TC-HIST-002 (validation half) — occurredAt / eventSeq independence', () => {
  it('accepts a late-registered event (occurredAt older than "existing", seq = max+1)', () => {
    // A week-old experiment back-filled as the 42nd registration of WS-1:
    const late = envelope('RUN_FINISHED', { run_id: 'R-1' }, { occurredAt: T0 - 7 * 24 * 3600 * 1000, eventSeq: 42 })
    const result = validateEvent(registry, late, makeCtx())
    expect(result.ok).toBe(true)
  })

  it('accepts the same late event with ANY eventSeq ≥ 1 (seq is not compared to occurredAt)', () => {
    for (const eventSeq of [1, 5, 999]) {
      const result = validateEvent(registry, envelope('RUN_FINISHED', { run_id: 'R-1' }, { occurredAt: T0 - 30 * 24 * 3600 * 1000, eventSeq }), makeCtx())
      expect(result.ok, `eventSeq=${eventSeq}`).toBe(true)
    }
  })

  it('accepts recordedAt < a caller might expect (the validator never relates the two clocks)', () => {
    // recordedAt is plugin-generated per §1; the validator only shape-checks it.
    const result = validateEvent(
      registry,
      envelope('RUN_FINISHED', { run_id: 'R-1' }, { occurredAt: T0 + 1234, recordedAt: T0 }),
      makeCtx(),
    )
    expect(result.ok).toBe(true)
  })
})

describe('WP-2.2 — nextEventSeq (max+1, structurally independent of occurredAt)', () => {
  it('allocates max+1 within the owner workstream', () => {
    expect(nextEventSeq([])).toBe(1)
    expect(nextEventSeq([1])).toBe(2)
    expect(nextEventSeq([1, 2, 3, 4, 41])).toBe(42)
    expect(nextEventSeq([7, 2, 9, 2, 7])).toBe(10)
  })

  it('its signature cannot see occurredAt — the independence is structural', () => {
    // the parameter is the seq list alone; even a fully unsorted,
    // occurredAt-decreasing history yields max+1:
    const history = [
      { eventSeq: 1, occurredAt: T0 + 1000 },
      { eventSeq: 2, occurredAt: T0 + 900 },
      { eventSeq: 3, occurredAt: T0 + 100 }, // late registration of an older event
    ]
    expect(nextEventSeq(history.map((h) => h.eventSeq))).toBe(4)
  })
})

describe('WP-2.2 — the two replay orderings (semantic / audit, TC-HIST-004 tie-break)', () => {
  const events = [
    { eventId: 'H-3', ownerWorkstreamId: 'WS-1', eventSeq: 3, occurredAt: T0 + 3000 },
    { eventId: 'H-2', ownerWorkstreamId: 'WS-1', eventSeq: 2, occurredAt: T0 + 2000 },
    // late registration: the OLDEST occurredAt, the NEWEST seq:
    { eventId: 'H-4', ownerWorkstreamId: 'WS-1', eventSeq: 4, occurredAt: T0 + 1000 },
    { eventId: 'H-1', ownerWorkstreamId: 'WS-1', eventSeq: 1, occurredAt: T0 + 4000 },
  ]

  it('semantic order: (occurredAt, eventSeq) — the late event sorts into its semantic slot', () => {
    expect(semanticOrder(events).map((e) => e.eventId)).toEqual(['H-4', 'H-2', 'H-3', 'H-1'])
  })

  it('audit order: eventSeq — the late event stays at the TAIL (TC-HIST-002)', () => {
    expect(auditOrder(events).map((e) => e.eventId)).toEqual(['H-1', 'H-2', 'H-3', 'H-4'])
  })

  it('equal occurredAt tie-breaks on eventSeq deterministically (TC-HIST-004)', () => {
    const tied = [
      { eventId: 'H-b', ownerWorkstreamId: 'WS-1', eventSeq: 2, occurredAt: T0 },
      { eventId: 'H-a', ownerWorkstreamId: 'WS-1', eventSeq: 1, occurredAt: T0 },
      { eventId: 'H-c', ownerWorkstreamId: 'WS-1', eventSeq: 3, occurredAt: T0 },
    ]
    expect(semanticOrder(tied).map((e) => e.eventId)).toEqual(['H-a', 'H-b', 'H-c'])
    // repeatable (idempotent, TC-HIST-005): sorting twice is stable-identical
    expect(semanticOrder(semanticOrder(tied)).map((e) => e.eventId)).toEqual(['H-a', 'H-b', 'H-c'])
  })

  it('cross-workstream residual ties resolve totally on (ownerWorkstreamId, eventId)', () => {
    const cross = [
      { eventId: 'H-2', ownerWorkstreamId: 'WS-2', eventSeq: 1, occurredAt: T0 },
      { eventId: 'H-1', ownerWorkstreamId: 'WS-1', eventSeq: 1, occurredAt: T0 },
    ]
    expect(semanticOrder(cross).map((e) => e.eventId)).toEqual(['H-1', 'H-2'])
    expect(auditOrder(cross).map((e) => e.eventId)).toEqual(['H-1', 'H-2'])
  })
})
