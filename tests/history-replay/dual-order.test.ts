/**
 * WP-2.3 — dual-order queries (HISTORY_EVENT_CATALOG §2) on a REAL temp
 * sqlite store:
 *   - TC-HIST-002 (store/query half): late registration — semantic position
 *     correct, audit tail;
 *   - TC-HIST-004: occurredAt ties break deterministically on eventSeq;
 *   - TC-HIST-009 (query half): one owner per event, per-WS isolation;
 *   - cross-workstream total orders (collectAllEvents).
 */
import { describe, expect, it } from 'vitest'

import {
  collectAllEvents,
  queryEvents,
  type QueryPage,
} from '../../src/host/history/replay/index.js'
import { semanticOrder } from '../../src/host/history/registry/index.js'
import { makeEvent, makeTempDir, dbPath, T0, type EventSpec } from './helpers.js'
import { openDatabase } from '../../src/host/persistence/store/index.js'
import type { ResearchStore } from '../../src/host/persistence/store/index.js'

const M = 60_000
const at = (n: number): number => T0 + M * n

function freshWithBatches(batches: readonly (readonly EventSpec[])[]): ResearchStore {
  const dir = makeTempDir()
  const store = openDatabase(dbPath(dir))
  for (const batch of batches) {
    store.appendEvents(batch.map(makeEvent))
  }
  return store
}

function ids(page: QueryPage): string[] {
  return page.events.map((e) => e.eventId)
}

describe('dual-order queries (catalog §2)', () => {
  it('semantic order follows occurredAt (research timeline), independent of append order', () => {
    const store = freshWithBatches([
      [
        { eventId: 'E-A', occurredAt: at(5), payload: { fact_id: 'F-A' } },
        { eventId: 'E-B', occurredAt: at(2), payload: { fact_id: 'F-B' } },
        { eventId: 'E-C', occurredAt: at(9), payload: { fact_id: 'F-C' } },
        { eventId: 'E-D', occurredAt: at(7), payload: { fact_id: 'F-D' } },
      ],
    ])
    const page = queryEvents(store, 'WS-1', { order: 'semantic' })
    expect(ids(page)).toEqual(['E-B', 'E-A', 'E-D', 'E-C'])
    expect(page.exhausted).toBe(true)
    expect(page.nextAfterSeq).toBeNull()
  })

  it('audit order is eventSeq strictly ascending (registration order)', () => {
    const store = freshWithBatches([
      [
        { eventId: 'E-A', occurredAt: at(5), payload: { fact_id: 'F-A' } },
        { eventId: 'E-B', occurredAt: at(2), payload: { fact_id: 'F-B' } },
        { eventId: 'E-C', occurredAt: at(9), payload: { fact_id: 'F-C' } },
      ],
    ])
    const page = queryEvents(store, 'WS-1', { order: 'audit' })
    expect(ids(page)).toEqual(['E-A', 'E-B', 'E-C'])
    const seqs = page.events.map((e) => e.eventSeq)
    expect(seqs).toEqual([1, 2, 3])
  })

  it('TC-HIST-002: late registration (occurredAt older than existing) — semantic inserts at the time position, audit stays at the tail', () => {
    const store = freshWithBatches([
      [
        { eventId: 'E-1', occurredAt: at(1), payload: { fact_id: 'F-1' } },
        { eventId: 'E-2', occurredAt: at(2), payload: { fact_id: 'F-2' } },
        { eventId: 'E-3', occurredAt: at(3), payload: { fact_id: 'F-3' } },
      ],
      // late backfill: time position BETWEEN seq 1 and 2, registration LAST
      [{ eventId: 'E-LATE', occurredAt: at(1.5), payload: { fact_id: 'F-LATE' } }],
    ])
    // the store assigned the late event the tail seq (max+1 — TC-HIST-003)
    expect(store.getEvent('WS-1', 4)?.eventId).toBe('E-LATE')

    const semantic = queryEvents(store, 'WS-1', { order: 'semantic' })
    expect(ids(semantic)).toEqual(['E-1', 'E-LATE', 'E-2', 'E-3'])
    // the late event sits at its TIME position (between t(1) and t(2))
    const lateIdx = semantic.events.findIndex((e) => e.eventId === 'E-LATE')
    expect(semantic.events[lateIdx - 1].occurredAt).toBeLessThan(semantic.events[lateIdx].occurredAt)
    expect(semantic.events[lateIdx + 1].occurredAt).toBeGreaterThan(semantic.events[lateIdx].occurredAt)

    const audit = queryEvents(store, 'WS-1', { order: 'audit' })
    expect(ids(audit)).toEqual(['E-1', 'E-2', 'E-3', 'E-LATE'])
    expect(audit.events[audit.events.length - 1].eventSeq).toBe(4)
  })

  it('TC-HIST-002: a late event OLDER than ALL existing events — semantic head, audit tail', () => {
    const store = freshWithBatches([
      [
        { eventId: 'E-1', occurredAt: at(2), payload: { fact_id: 'F-1' } },
        { eventId: 'E-2', occurredAt: at(3), payload: { fact_id: 'F-2' } },
      ],
      [{ eventId: 'E-LATE', occurredAt: at(1), payload: { fact_id: 'F-LATE' } }],
    ])
    expect(ids(queryEvents(store, 'WS-1', { order: 'semantic' }))).toEqual(['E-LATE', 'E-1', 'E-2'])
    expect(ids(queryEvents(store, 'WS-1', { order: 'audit' }))).toEqual(['E-1', 'E-2', 'E-LATE'])
  })

  it('TC-HIST-004: equal occurredAt tie-breaks on eventSeq (deterministic)', () => {
    const store = freshWithBatches([
      // appended in NON-seq order of the same timestamp batch:
      [{ eventId: 'E-C', occurredAt: at(1), payload: { fact_id: 'F-C' } }],
      [{ eventId: 'E-A', occurredAt: at(1), payload: { fact_id: 'F-A' } }],
      [{ eventId: 'E-B', occurredAt: at(1), payload: { fact_id: 'F-B' } }],
    ])
    // seqs: E-C=1, E-A=2, E-B=3 — the semantic order must be seq order
    expect(ids(queryEvents(store, 'WS-1', { order: 'semantic' }))).toEqual(['E-C', 'E-A', 'E-B'])
  })

  it('TC-HIST-004 (full tie-break check): five-way occurredAt tie orders exactly by eventSeq', () => {
    const store = freshWithBatches([
      [{ eventId: 'E-C', occurredAt: at(1), payload: { fact_id: 'F-C' } }],
      [{ eventId: 'E-A', occurredAt: at(1), payload: { fact_id: 'F-A' } }],
      [{ eventId: 'E-B', occurredAt: at(1), payload: { fact_id: 'F-B' } }],
      [{ eventId: 'E-D', occurredAt: at(1), payload: { fact_id: 'F-D' } }],
      [{ eventId: 'E-LATE', occurredAt: at(1), payload: { fact_id: 'F-LATE' } }],
    ])
    // seqs: E-C=1, E-A=2, E-B=3, E-D=4, E-LATE=5
    expect(ids(queryEvents(store, 'WS-1', { order: 'semantic' }))).toEqual(['E-C', 'E-A', 'E-B', 'E-D', 'E-LATE'])
  })

  it('TC-HIST-004 determinism: repeated queries return byte-identical results (both orders)', () => {
    const store = freshWithBatches([
      [
        { eventId: 'E-1', occurredAt: at(1), payload: { fact_id: 'F-1' } },
        { eventId: 'E-2', occurredAt: at(1), payload: { fact_id: 'F-2' } },
        { eventId: 'E-3', occurredAt: at(2), payload: { fact_id: 'F-3' } },
        { eventId: 'E-4', occurredAt: at(1), payload: { fact_id: 'F-4' } },
      ],
      [{ eventId: 'E-LATE', occurredAt: at(1), payload: { fact_id: 'F-LATE' } }],
    ])
    const semantic0 = JSON.stringify(queryEvents(store, 'WS-1', { order: 'semantic' }))
    const audit0 = JSON.stringify(queryEvents(store, 'WS-1', { order: 'audit' }))
    for (let i = 0; i < 5; i++) {
      expect(JSON.stringify(queryEvents(store, 'WS-1', { order: 'semantic' }))).toBe(semantic0)
      expect(JSON.stringify(queryEvents(store, 'WS-1', { order: 'audit' }))).toBe(audit0)
    }
    // and the tie-break is EXACTLY eventSeq among the four t(1) ties:
    expect(ids(queryEvents(store, 'WS-1', { order: 'semantic' }))).toEqual(['E-1', 'E-2', 'E-4', 'E-LATE', 'E-3'])
  })

  it('TC-HIST-009 (query half): every record carries its single non-empty owner; per-WS query is owner-isolated', () => {
    const store = freshWithBatches([
      [
        { eventId: 'A-1', ownerWorkstreamId: 'WS-1', occurredAt: at(1), payload: { fact_id: 'F-A1' } },
        { eventId: 'B-1', ownerWorkstreamId: 'WS-2', occurredAt: at(2), payload: { fact_id: 'F-B1' } },
        { eventId: 'A-2', ownerWorkstreamId: 'WS-1', occurredAt: at(3), payload: { fact_id: 'F-A2' } },
      ],
    ])
    const pageA = queryEvents(store, 'WS-1', { order: 'semantic' })
    expect(ids(pageA)).toEqual(['A-1', 'A-2'])
    const pageB = queryEvents(store, 'WS-2', { order: 'semantic' })
    expect(ids(pageB)).toEqual(['B-1'])
    for (const ev of [...pageA.events, ...pageB.events]) {
      expect(typeof ev.ownerWorkstreamId).toBe('string')
      expect(ev.ownerWorkstreamId.length).toBeGreaterThan(0)
    }
    expect(pageA.events.every((e) => e.ownerWorkstreamId === 'WS-1')).toBe(true)
    expect(pageB.events.every((e) => e.ownerWorkstreamId === 'WS-2')).toBe(true)
  })

  it('collectAllEvents: cross-WS audit merge is (eventSeq, owner) total order; semantic merge is (occurredAt, eventSeq, owner)', () => {
    const store = freshWithBatches([
      [
        { eventId: 'A-1', ownerWorkstreamId: 'WS-1', occurredAt: at(3), payload: { fact_id: 'F-A1' } },
        { eventId: 'B-1', ownerWorkstreamId: 'WS-2', occurredAt: at(1), payload: { fact_id: 'F-B1' } },
        { eventId: 'A-2', ownerWorkstreamId: 'WS-1', occurredAt: at(2), payload: { fact_id: 'F-A2' } },
      ],
    ])
    // audit: seq1 {WS-1 A-1, WS-2 B-1} → owner WS-1 first, then seq2 WS-1 A-2
    expect(collectAllEvents(store, ['WS-1', 'WS-2'], 'audit').map((e) => e.eventId)).toEqual(['A-1', 'B-1', 'A-2'])
    // semantic: B-1 t(1), A-2 t(2), A-1 t(3)
    expect(collectAllEvents(store, ['WS-1', 'WS-2'], 'semantic').map((e) => e.eventId)).toEqual(['B-1', 'A-2', 'A-1'])
    // duplicate workstream ids are fetched once
    expect(collectAllEvents(store, ['WS-1', 'WS-2', 'WS-1'], 'audit').map((e) => e.eventId)).toEqual(['A-1', 'B-1', 'A-2'])
    // a workstream with no events contributes nothing
    expect(collectAllEvents(store, ['WS-1', 'WS-2', 'WS-9'], 'audit').map((e) => e.eventId)).toEqual(['A-1', 'B-1', 'A-2'])
  })

  it('empty workstream → empty exhausted page', () => {
    const store = freshWithBatches([])
    const page = queryEvents(store, 'WS-1')
    expect(page.events).toEqual([])
    expect(page.exhausted).toBe(true)
    expect(page.nextAfterSeq).toBeNull()
  })

  it('default order is semantic (catalog §2: default UI History timeline)', () => {
    const store = freshWithBatches([
      [
        { eventId: 'E-A', occurredAt: at(5), payload: { fact_id: 'F-A' } },
        { eventId: 'E-B', occurredAt: at(2), payload: { fact_id: 'F-B' } },
      ],
    ])
    expect(ids(queryEvents(store, 'WS-1'))).toEqual(['E-B', 'E-A'])
  })

  it('full unbounded query equals the manual ordering of the raw range (both orders)', () => {
    const store = freshWithBatches([
      [
        { eventId: 'E-1', occurredAt: at(3), payload: { fact_id: 'F-1' } },
        { eventId: 'E-2', occurredAt: at(1), payload: { fact_id: 'F-2' } },
        { eventId: 'E-3', occurredAt: at(1), payload: { fact_id: 'F-3' } },
      ],
      [{ eventId: 'E-LATE', occurredAt: at(0), payload: { fact_id: 'F-LATE' } }],
    ])
    const raw = store.listRange('WS-1', 1)
    expect(queryEvents(store, 'WS-1', { order: 'semantic' }).events).toEqual(semanticOrder(raw))
    expect(queryEvents(store, 'WS-1', { order: 'audit' }).events).toEqual(raw)
  })
})
