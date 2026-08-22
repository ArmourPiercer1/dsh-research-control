/**
 * WP-2.10 — Property ① (RR-012): random legal event stream → after
 * `appendEvents`, `event_seq` is strictly +1 per workstream.
 *
 * The store assigns seq as per-owner `MAX(event_seq) + 1` INSIDE the
 * write transaction (TC-HIST-003 / Gate P2 第 3 条: event_seq 永不改写).
 * This property pins that assignment against RANDOM multi-workstream
 * streams (3–24 events, owners interleaved, late registrations included):
 * every owner's seqs come out as exactly 1..n — no gaps, no duplicates,
 * no cross-WS interference — both from the append result AND from the
 * DB read face.
 *
 * Scale/seed (task: modest, fixed seed, reproducible failures): 60 runs,
 * seed pinned below. Reproduction on failure: `npx vitest run
 * tests/property/seq-monotonic.test.ts` (deterministic — the seed is in
 * the source; fast-check prints the failing generated stream).
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  assertStreamLegal,
  constructStream,
  freshStore,
  loadRegistry,
  makeCtx,
  streamArb,
  streamOwners,
} from './helpers.js'

const SEED = 20260822
const NUM_RUNS = 60

describe('property ① (RR-012): append → event_seq strictly +1 per workstream', () => {
  it('every owner workstream sees exactly the seqs 1..n (result face AND DB face)', () => {
    const registry = loadRegistry()
    const ctx = makeCtx()
    fc.assert(
      fc.property(streamArb, (elements) => {
        const stream = constructStream(elements)
        // Generation constraint (registry validation pass — fail loud):
        assertStreamLegal(registry, ctx, stream)

        const store = freshStore()
        try {
          const result = store.appendEvents(stream.map((s) => s.input))

          // Per-WS seqs from the append result: strictly 1, 2, …, n.
          const seqsByWs = new Map<string, number[]>()
          for (const ev of result.events) {
            const arr = seqsByWs.get(ev.ownerWorkstreamId) ?? []
            arr.push(ev.eventSeq)
            seqsByWs.set(ev.ownerWorkstreamId, arr)
          }
          expect(seqsByWs.size).toBe(streamOwners(stream).length)
          for (const [ws, seqs] of [...seqsByWs.entries()].sort()) {
            expect(seqs, `result face: ${ws} seqs`).toEqual(seqs.map((_, k) => k + 1))
          }

          // …and from the DB read face (the persisted rows agree).
          for (const [ws, seqs] of [...seqsByWs.entries()].sort()) {
            const stored = store.listRange(ws, 1).map((e) => e.eventSeq)
            expect(stored, `db face: ${ws} seqs`).toEqual(seqs)
            // lastSeqByWorkstream (the AppendResult contract) agrees too:
            expect(result.lastSeqByWorkstream[ws], `lastSeq: ${ws}`).toBe(seqs.length)
          }
        } finally {
          store.close()
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED, endOnFailure: true },
    )
  })
})
