/**
 * WP-2.10 — Property ② (RR-012): random legal event stream → the FULL
 * replay fold is IDEMPOTENT: replaying the same log twice yields
 * deep-equal derived state, and the replay itself produces NO new events
 * (TC-HIST-006 「空 DB 重放全部事件 -> 所有派生列与原状态一致；重放不产生
 * 新事件」; INV-HIST-5/7 direction: the event log is the 真源, the
 * derived state is a rebuildable cache).
 *
 * Two levels, both pinned here against random streams:
 *   - STORE level: `rebuildDerivedState` (the full audit-order fold +
 *     wholesale derived_state replace) run TWICE → deep-equal state maps
 *     (canonical JSON), and the `history_event` rows are byte-identical
 *     before/after (replay produced no new events — the rebuild face is
 *     `Pick<ResearchStore, 'path' | 'listRange'>`: it structurally cannot
 *     append, and the storage triggers back that up).
 *   - ENGINE level: two independent full replays (`collectAllEvents`
 *     twice) folded twice through the same reducer (`foldEvents`) →
 *     deep-equal states (the fold is a pure function of the log).
 *
 * The reducer is the repo's order-sensitive synthetic §6-semantics
 * reducer (`makeTestReducer` — every update appends to `trail`): any
 * non-determinism in fold order would surface as a `trail` divergence.
 *
 * Scale/seed (task: modest, fixed seed, reproducible failures): 60 runs,
 * seed pinned below. Reproduction on failure: `npx vitest run
 * tests/property/replay-idempotent.test.ts` (deterministic — the seed is
 * in the source; fast-check prints the failing generated stream).
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { foldEvents, collectAllEvents, rebuildDerivedState, readDerivedState } from '../../src/host/history/replay/index.js'
import {
  canonicalMapJson,
  makeTestReducer,
  snapshotEventLines,
} from '../history-replay/helpers.js'
import {
  assertStreamLegal,
  constructStream,
  freshStore,
  loadRegistry,
  makeCtx,
  streamArb,
  streamOwners,
} from './helpers.js'

const SEED = 20260823
const NUM_RUNS = 60

describe('property ② (RR-012): full replay fold is idempotent (two replays deep-equal, no new events)', () => {
  it('two rebuilds deep-equal + event table byte-identical; two engine folds of two full replays deep-equal', () => {
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

          // ---- store level: the full rebuild, twice -------------------
          const beforeLines = snapshotEventLines(store, wss)
          const first = rebuildDerivedState(store, wss, makeTestReducer())
          const second = rebuildDerivedState(store, wss, makeTestReducer())
          expect(first.applied).toBe(true)
          expect(second.applied).toBe(true)
          expect(first.eventCount).toBe(stream.length)
          expect(canonicalMapJson(second.states), 'second rebuild ≠ first rebuild (fold not idempotent)').toBe(
            canonicalMapJson(first.states),
          )
          // The persisted derived table equals BOTH rebuilds (the replace
          // is wholesale — there is no third, drifting state):
          expect(canonicalMapJson(readDerivedState(store))).toBe(canonicalMapJson(first.states))
          // Replay produced NO new events (the 真源 is untouched):
          expect(snapshotEventLines(store, wss), 'event table changed by a replay').toEqual(beforeLines)

          // ---- engine level: two folds over two independent replays ---
          const replayOne = collectAllEvents(store, wss, 'audit')
          const replayTwo = collectAllEvents(store, wss, 'audit')
          expect(replayTwo, 'a second full replay disagrees with the first').toEqual(replayOne)
          const foldOne = foldEvents(replayOne, makeTestReducer(), new Map())
          const foldTwo = foldEvents(replayTwo, makeTestReducer(), new Map())
          expect(canonicalMapJson(foldTwo), 'second fold ≠ first fold (not a pure function of the log)').toBe(
            canonicalMapJson(foldOne),
          )
          // The engine fold of the FULL replay agrees with the store
          // rebuild (same audit order, same reducer):
          expect(canonicalMapJson(foldOne)).toBe(canonicalMapJson(first.states))
        } finally {
          store.close()
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED, endOnFailure: true },
    )
  })
})
