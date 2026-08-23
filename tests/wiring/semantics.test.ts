/**
 * WP-3.6 (RR-011 (b) / RR-014⑧) — the store-level semantic dual-use
 * consistency: the INCREMENTAL fold (the composed `validateHook` that
 * updates the `semantics:<project>` derived_state row inside every
 * append's write transaction) must stay deep-equal to the FULL REPLAY
 * fold (the audit-order rebuild from the empty state) — the two faces of
 * the SAME derived state, one maintained, one rebuilt.
 *
 * Coverage (the task's (b)):
 *   1. INCREMENTAL ≡ REPLAY on a legal multi-workstream semantic stream
 *      (fact / claim / artifact / relation + retraction + relation
 *      removal): after the appends, the derived_state row the
 *      incremental hook wrote is deep-equal (canonical JSON) to the
 *      independent `collectAllEvents` + `foldSemanticEvents` replay.
 *   2. BATCH ATOMICITY — a batch the fold rejects mid-way (a duplicate
 *      CLAIM_RECORDED) rolls the ENTIRE batch back: no event rows, the
 *      derived row unchanged (a corrupt fold can never poison the cache
 *      silently).
 *   3. DRIFT DETECTION + CORRECTION — a tampered derived_state row
 *      (simulated by a raw second connection: derived_state IS updatable
 *      by design, TC-HIST-006) is detected by the startup rebuild
 *      (consistency report ≠ ok) and replaced by the replay fold in ONE
 *      independent transaction (the event table untouched).
 *
 * The random-stream strength of this property (RR-014⑧) lives in
 * `tests/property/semantics-consistency.test.ts` (the upgraded
 * generator × this same maintainer); here the stream is hand-pinned
 * (deterministic counterexample shape).
 */

import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { collectAllEvents, readDerivedState } from '../../src/host/history/replay/index.js'
import {
  foldSemanticEvents,
  initialSemanticState,
  type SemanticState,
} from '../../src/host/domain/semantics/index.js'
import { canonicalJson } from '../semantics/fixtures.js'
import {
  createHostWiring,
  jsonToSemanticState,
  semanticStateKey,
  toSemanticInputEvent,
  type HostWiring,
} from '../../src/host/service/wiring/index.js'
import type { HistoryEventInput, ResearchStore } from '../../src/host/persistence/store/index.js'
import { makeWiring, rawDb, T0, WR_SCHEMA_ROOT, type WiringBundle } from './helpers.js'

/** A full 9-field envelope builder (the store assigns seq/recordedAt). */
function evt(
  over: Partial<HistoryEventInput> & {
    eventType: string
    payload: Record<string, unknown>
    ownerWorkstreamId: string
    eventId: string
  },
  i: number,
): HistoryEventInput {
  return {
    schemaVersion: 1,
    occurredAt: T0 + i * 1000,
    actor: { kind: 'USER', user_id: 'u-1' },
    ...over,
  }
}

const SEMANTIC_STREAM: readonly HistoryEventInput[] = [
  // WS-1: a fact, a claim, and a SUPPORTED_BY edge between them.
  evt({ eventId: 'H-S1', ownerWorkstreamId: 'WS-1', eventType: 'FACT_RECORDED', payload: { fact_id: 'F-101', statement: 'p95 = 12 ms on run 42' } }, 1),
  evt({ eventId: 'H-S2', ownerWorkstreamId: 'WS-1', eventType: 'CLAIM_RECORDED', payload: { claim_id: 'C-101', statement: 'the treatment reduces latency' } }, 2),
  evt({ eventId: 'H-S3', ownerWorkstreamId: 'WS-1', eventType: 'RELATION_ADDED', payload: { relation_id: 'REL-101', source: { kind: 'CLAIM', id: 'C-101' }, relation_type: 'SUPPORTED_BY', target: { kind: 'FACT', id: 'F-101' } } }, 3),
  // WS-2: an artifact + a fact (multi-workstream scope).
  evt({ eventId: 'H-S4', ownerWorkstreamId: 'WS-2', eventType: 'ARTIFACT_REGISTERED', payload: { artifact_id: 'A-101', type: 'DATASET', title: 'traces', uri: 'data/traces/' } }, 4),
  evt({ eventId: 'H-S5', ownerWorkstreamId: 'WS-2', eventType: 'FACT_RECORDED', payload: { fact_id: 'F-102', statement: 'dataset has 500 samples' } }, 5),
  // WS-1: the claim is retracted and its support edge removed.
  evt({ eventId: 'H-S6', ownerWorkstreamId: 'WS-1', eventType: 'CLAIM_RETRACTED', payload: { claim_id: 'C-101', reason: 'contradicted by run 43' } }, 6),
  evt({ eventId: 'H-S7', ownerWorkstreamId: 'WS-1', eventType: 'RELATION_REMOVED', payload: { relation_id: 'REL-101', source: { kind: 'CLAIM', id: 'C-101' }, relation_type: 'SUPPORTED_BY', target: { kind: 'FACT', id: 'F-101' }, reason: 'claim gone' } }, 7),
]

/** The independent replay fold (the rebuild face).
 * `toSemanticInputEvent` is the SAME record→input coercion the maintainer
 * uses internally (exported for this cross-check) — the replay stays
 * independent of the incremental row, not of the shared coercion seam. */
function replayFold(bundle: WiringBundle, workstreams: readonly string[]): SemanticState {
  const events = collectAllEvents(bundle.wiring.store, workstreams, 'audit')
  return foldSemanticEvents(events.map(toSemanticInputEvent))
}

/** The incremental derived row (the maintained face). */
function incrementalState(bundle: WiringBundle, projectId: string): SemanticState | undefined {
  const row = readDerivedState(bundle.wiring.store).get(semanticStateKey(projectId))
  if (row === undefined) return undefined
  return jsonToSemanticState(row, semanticStateKey(projectId))
}

describe('(b) semantics: store-level dual-use consistency (incremental ≡ replay)', () => {
  it('the incremental fold row is deep-equal to the full replay fold on a legal multi-WS stream', () => {
    const bundle = makeWiring()
    const { wiring } = bundle
    try {
      // The stream appended in TWO batches (the incremental hook runs per
      // batch — a second batch must fold from the row's CURRENT state,
      // not the empty one).
      wiring.store.appendEvents(SEMANTIC_STREAM.slice(0, 4))
      wiring.store.appendEvents(SEMANTIC_STREAM.slice(4))

      const inc = incrementalState(bundle, 'PRJ-1')
      expect(inc, 'the semantics derived row must exist after semantic appends').toBeDefined()
      const rep = replayFold(bundle, ['WS-1', 'WS-2', 'WS-3'])

      // Canonical-JSON deep equality (key order inside documents does not
      // count — the pinned comparison rule of the WP-2.3 framework).
      expect(canonicalJson(inc)).toBe(canonicalJson(rep))
      expect(canonicalJson(inc)).not.toBe(canonicalJson(initialSemanticState()))

      // Spot-check the folded CONTENTS (the fold did the right thing, not
      // merely the same thing twice):
      expect(inc!.facts.get('F-101')!.workstream_id).toBe('WS-1')
      expect(inc!.facts.get('F-102')!.workstream_id).toBe('WS-2')
      expect(inc!.claims.get('C-101')!.status).toBe('RETRACTED')
      expect(inc!.artifacts.get('A-101')!.status).toBe('REGISTERED')
      expect(inc!.relations.get('REL-101')!.status).toBe('REMOVED')

      // The startup rebuild (the SAME machinery, at process start) agrees
      // and reports NO drift:
      const startup = bundle.wiring.startup.semantics
      expect(startup.report.ok).toBe(true)
    } finally {
      wiring.close()
    }
  })

  it('a fold-rejected batch rolls back entirely: no events, the derived row unchanged', () => {
    const bundle = makeWiring()
    const { wiring } = bundle
    try {
      wiring.store.appendEvents([
        evt({ eventId: 'H-A1', ownerWorkstreamId: 'WS-1', eventType: 'CLAIM_RECORDED', payload: { claim_id: 'C-201', statement: 'first' } }, 1),
      ])
      const before = readDerivedState(wiring.store)

      // The second batch duplicates C-201 — the reducer throws
      // OBJECT_ALREADY_EXISTS INSIDE the validate hook, so the batch is
      // rejected before any event insert:
      expect(() =>
        wiring.store.appendEvents([
          evt({ eventId: 'H-A2', ownerWorkstreamId: 'WS-1', eventType: 'FACT_RECORDED', payload: { fact_id: 'F-201', statement: 'would persist' } }, 2),
          evt({ eventId: 'H-A3', ownerWorkstreamId: 'WS-1', eventType: 'CLAIM_RECORDED', payload: { claim_id: 'C-201', statement: 'duplicate' } }, 3),
        ]),
      ).toThrow(/C-201/)

      const after = readDerivedState(wiring.store)
      expect(canonicalJson([...after])).toBe(canonicalJson([...before]))
      // Neither event of the rejected batch persisted (WS-1 still holds
      // exactly the first batch's single event):
      expect(wiring.store.listRange('WS-1', 1)).toHaveLength(1)
      expect(wiring.store.listRange('WS-1', 1)[0]!.eventId).toBe('H-A1')
      // The surviving claim is untouched:
      expect(
        (after.get(semanticStateKey('PRJ-1')) as unknown as { claims: Record<string, { status: string }> }).claims['C-201'].status,
      ).toBe('ACTIVE')
    } finally {
      wiring.close()
    }
  })

  it('a tampered derived_state row is detected by the startup rebuild and replaced by the replay fold', () => {
    const bundle = makeWiring()
    const { wiring, dataDir } = bundle
    wiring.store.appendEvents(SEMANTIC_STREAM)
    const key = semanticStateKey('PRJ-1')
    const honest = readDerivedState(wiring.store).get(key)!
    expect(canonicalJson(jsonToSemanticState(honest, key))).toBe(canonicalJson(replayFold(bundle, ['WS-1', 'WS-2', 'WS-3'])))
    wiring.close()

    // The tamper: a raw second connection rewrites the row (derived_state
    // is updatable by design — the rebuildable-cache face, TC-HIST-006).
    const db: DatabaseSync = rawDb(dataDir)
    try {
      db.exec(`UPDATE derived_state SET state = '{"tampered":true}' WHERE object_kind = 'semantics' AND object_id = 'PRJ-1'`)
    } finally {
      db.close()
    }

    // A FRESH wiring over the same files: the startup rebuild must find
    // the drift (report ≠ ok) and REPLACE the row with the fold.
    const fresh = createHostWiring({
      repoRoot: bundle.repoRoot,
      schemaRoot: WR_SCHEMA_ROOT,
      projectId: 'PRJ-1',
      dataDir: bundle.dataDir,
      adapter: bundle.adapter,
      launcherAdapter: bundle.launcherAdapter,
      workspaceRoots: [bundle.repoRoot],
      now: () => Date.now(),
    })
    try {
      expect(fresh.startup.semantics.report.ok).toBe(false)
      expect(fresh.startup.semantics.report.differing.length + fresh.startup.semantics.report.onlyInRebuilt.length).toBeGreaterThan(0)
      // The row is now the fold again (one independent transaction):
      const corrected = readDerivedState(fresh.store).get(semanticStateKey('PRJ-1'))!
      expect(canonicalJson(jsonToSemanticState(corrected, semanticStateKey('PRJ-1')))).toBe(canonicalJson(replayFoldFor(fresh, ['WS-1', 'WS-2', 'WS-3'])))
    } finally {
      fresh.close()
    }
  })
})

function replayFoldFor(fresh: { store: ResearchStore }, workstreams: readonly string[]): SemanticState {
  const events = collectAllEvents(fresh.store, workstreams, 'audit')
  return foldSemanticEvents(events.map(toSemanticInputEvent))
}
