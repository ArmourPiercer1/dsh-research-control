/**
 * WP-2.10 — Property ③ (RR-012): random legal event stream → the
 * semantic/audit DUAL orders are DETERMINISTIC: repeated queries of the
 * same log are bit-identical, and each order is the frozen total order
 * itself (catalog §2 / TC-HIST-005):
 *   - audit order    = (eventSeq, owner, id) — registration order;
 *   - semantic order = (occurredAt, eventSeq, owner, id) — reality time
 *     first, late registrations slotted into their TIME position
 *     (TC-HIST-002), audit seq as the deterministic tie-break.
 *
 * Because the generator's `occurredAt` spans ±30 days around T0, the
 * streams genuinely interleave time and registration order (late events
 * are common) — the semantic order here is not a monotonic-time
 * shortcut, and the two orders are in general DIFFERENT (a stream where
 * they coincide would make the property vacuous; the property asserts
 * the orders' DEFINING invariants, which hold in both cases).
 *
 * Scale/seed (task: modest, fixed seed, reproducible failures): 60 runs,
 * seed pinned below. Reproduction on failure: `npx vitest run
 * tests/property/dual-order-deterministic.test.ts` (deterministic — the
 * seed is in the source; fast-check prints the failing generated stream).
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { collectAllEvents, queryEvents } from '../../src/host/history/replay/index.js'
import type { HistoryEventRecord } from '../../src/host/persistence/store/index.js'
import {
  assertStreamLegal,
  constructStream,
  freshStore,
  loadRegistry,
  makeCtx,
  streamArb,
  streamOwners,
} from './helpers.js'

const SEED = 20260824
const NUM_RUNS = 60
/** Query each order this many times per workstream (逐位相等 across runs). */
const QUERIES_PER_ORDER = 3

/** The frozen total orders (query.ts / late-registration.ts docs):
 *  audit = (eventSeq, owner, id); semantic = (occurredAt, eventSeq,
 *  owner, id). Single-workstream slices reduce to (eventSeq) and
 *  (occurredAt, eventSeq) respectively. */
function auditSorted(events: readonly HistoryEventRecord[]): HistoryEventRecord[] {
  return [...events].sort((a, b) => a.eventSeq - b.eventSeq)
}
function semanticSorted(events: readonly HistoryEventRecord[]): HistoryEventRecord[] {
  return [...events].sort((a, b) => a.occurredAt - b.occurredAt || a.eventSeq - b.eventSeq)
}

describe('property ③ (RR-012): semantic/audit dual-order determinism (same stream, repeated queries 逐位相等)', () => {
  it('repeated queries are bit-identical; each order equals its frozen total order; both views cover the same events', () => {
    const registry = loadRegistry()
    const ctx = makeCtx()
    fc.assert(
      fc.property(streamArb, (elements) => {
        const stream = constructStream(elements)
        assertStreamLegal(registry, ctx, stream)

        const store = freshStore()
        try {
          store.appendEvents(stream.map((s) => s.input))
          const wss = streamOwners(stream)

          for (const ws of wss) {
            const audits: ReadonlyArray<HistoryEventRecord>[] = []
            const semantics: ReadonlyArray<HistoryEventRecord>[] = []
            for (let q = 0; q < QUERIES_PER_ORDER; q++) {
              audits.push(queryEvents(store, ws, { order: 'audit' }).events)
              semantics.push(queryEvents(store, ws, { order: 'semantic' }).events)
            }
            // ① repeated queries are bit-identical (逐位相等):
            for (let q = 1; q < QUERIES_PER_ORDER; q++) {
              expect(audits[q], `audit order not deterministic for ${ws} (query ${q})`).toEqual(audits[0])
              expect(semantics[q], `semantic order not deterministic for ${ws} (query ${q})`).toEqual(semantics[0])
            }
            // ② each order is the frozen total order itself:
            expect(audits[0], `${ws}: audit order is not (eventSeq) order`).toEqual(auditSorted(audits[0]))
            expect(semantics[0], `${ws}: semantic order is not (occurredAt, eventSeq) order`).toEqual(
              semanticSorted(semantics[0]),
            )
            // ③ both views see exactly the same event set:
            expect(
              semantics[0].map((e) => e.eventId).sort(),
              `${ws}: semantic and audit views disagree on the event set`,
            ).toEqual(audits[0].map((e) => e.eventId).sort())
          }

          // Project-wide merge (collectAllEvents) is deterministic too:
          const mergedOne = collectAllEvents(store, wss, 'audit')
          const mergedTwo = collectAllEvents(store, wss, 'audit')
          expect(mergedTwo, 'cross-WS audit merge not deterministic').toEqual(mergedOne)
          const semMergedOne = collectAllEvents(store, wss, 'semantic')
          const semMergedTwo = collectAllEvents(store, wss, 'semantic')
          expect(semMergedTwo, 'cross-WS semantic merge not deterministic').toEqual(semMergedOne)
        } finally {
          store.close()
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED, endOnFailure: true },
    )
  })
})
