/**
 * WP-3.6 (RR-014⑧ ↔ RR-011 (b)) — the semantic dual-use consistency as a
 * RANDOM-STREAM PROPERTY: the RR-014⑧-widened generator (tests/property/
 * helpers.ts — the full run-terminal + retraction/removal surface) feeds
 * the SAME wiring seam the host uses (`withRealizeCompensation` +
 * `makeSemanticMaintainer().validateHook`), and the incrementally
 * maintained `semantics:<project>` derived row must be canonical-JSON
 * EQUAL to the independent full-replay fold — for every generated legal
 * stream, under RANDOM BATCHING.
 *
 * ## Why a projection pass (and what it does NOT hide)
 *
 * The generator's loud registry constraint (`assertStreamLegal`) checks
 * each event against a STATIC `HistoryObjectContext`; the fold under
 * test evolves its own state from the EMPTY registry. A drawn
 * RETRACT/MARK_MISSING/REMOVED event names a CTX object (C-1 / A-1 /
 * REL-1/REL-2) the fold has never seen — registry-legal, fold-illegal.
 * The property projects the raw stream onto the fold's own state using
 * the REAL reducer as the oracle:
 *
 *   - CLAIM_RETRACTED / ARTIFACT_MARKED_MISSING / RELATION_REMOVED are
 *     RETARGETED to the most recent still-live in-stream object (the
 *     create→remove arcs the RR-014⑧ widening is FOR), or dropped when
 *     no live target exists;
 *   - an ARTIFACT_REGISTERED `supersedes` pointing at the ctx artifact
 *     is retargeted to the most recent in-stream artifact (or dropped);
 *   - anything else the reducer still rejects (e.g. a duplicate §8
 *     5-tuple edge — two draws of the same LEGAL_RELATION_PAIR) is
 *     dropped, never silently mutated.
 *
 * The projection DROPS-or-retargets only; it never invents ids, and the
 * raw stream is registry-checked BEFORE the projection runs. The
 * projected stream is what the store gate actually faces (the store
 * runs the FOLD hook, not the static-ctx registry — that is the
 * service-layer concern under test here, catalog §6).
 *
 * Seed strategy: pinned (`seed: 20260823`, 60 runs) — byte-deterministic
 * like the other three properties; a counterexample replays by re-running
 * this file alone.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { collectAllEvents, readDerivedState } from '../../src/host/history/replay/index.js'
import {
  initialSemanticState,
  reduceSemanticEvent,
  foldSemanticEvents,
  type SemanticInputEvent,
  type SemanticState,
} from '../../src/host/domain/semantics/index.js'
import {
  makeSemanticMaintainer,
  jsonToSemanticState,
  semanticStateKey,
  semanticStateToJson,
  toSemanticInputEvent,
  withRealizeCompensation,
  WorkstreamRealizer,
} from '../../src/host/service/wiring/index.js'
import { canonicalJson } from '../semantics/fixtures.js'
import {
  assertStreamLegal,
  constructStream,
  freshStore,
  loadRegistry,
  makeCtx,
  streamArb,
  streamOwners,
  type CandidateEvent,
} from './helpers.js'
import type { HistoryEventInput } from '../../src/host/persistence/store/index.js'

const PROJECT = 'PRJ-9'

/** The seven semantic event types (catalog §6 — the fold's input set). */
const SEMANTIC_TYPES = new Set([
  'FACT_RECORDED',
  'CLAIM_RECORDED',
  'CLAIM_RETRACTED',
  'ARTIFACT_REGISTERED',
  'ARTIFACT_MARKED_MISSING',
  'RELATION_ADDED',
  'RELATION_REMOVED',
])

/** The drawn input: a raw legal stream + a batch-size schedule. */
const inputArb = fc.record({
  stream: streamArb,
  sizes: fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 24 }),
})

/** Fold one envelope through the real reducer (throw = fold-illegal). */
function tryFold(state: SemanticState, env: Record<string, unknown>): SemanticState {
  return reduceSemanticEvent(state, env as unknown as SemanticInputEvent)
}

/** The most recent still-live claim/artifact/relation in the fold state
 *  (insertion order = fold order — the LAST entry is the most recent). */
function lastLive<K extends string, V extends { status: string }>(map: ReadonlyMap<K, V>, status: string): [K, V] | undefined {
  let found: [K, V] | undefined
  for (const entry of map) if (entry[1].status === status) found = entry
  return found
}

/**
 * Project the registry-legal raw stream onto the fold's own state (module
 * header): retarget-or-drop, using the REAL reducer as the oracle.
 */
function projectOntoFoldState(raw: readonly CandidateEvent[]): readonly CandidateEvent[] {
  let state = initialSemanticState()
  // The owner each in-stream relation was ADDED under — a retargeted
  // RELATION_REMOVED MUST echo it: same-WS ⇒ monotone per-WS seq ⇒ the
  // audit merge (eventSeq, owner, id) never reorders the create/remove
  // PAIR (the registry's §4 特例 derives both owners identically).
  const relationAddOwner = new Map<string, string>()
  const out: CandidateEvent[] = []
  for (const cand of raw) {
    let env = cand.envelope
    let payload = env['payload'] as Record<string, unknown>
    switch (env['eventType']) {
      case 'CLAIM_RETRACTED': {
        const live = lastLive(state.claims, 'ACTIVE')
        if (live === undefined) continue // dropped: no live in-stream claim
        env = { ...env, ownerWorkstreamId: live[1].workstream_id }
        payload = { ...payload, claim_id: live[0] }
        break
      }
      case 'ARTIFACT_MARKED_MISSING': {
        const live = lastLive(state.artifacts, 'REGISTERED')
        if (live === undefined) continue
        env = { ...env, ownerWorkstreamId: live[1].workstream_id }
        payload = { ...payload, artifact_id: live[0] }
        break
      }
      case 'RELATION_REMOVED': {
        const live = lastLive(state.relations, 'ACTIVE')
        if (live === undefined) continue
        const owner = relationAddOwner.get(live[0]) ?? relationOwner(live[1], state) ?? (env['ownerWorkstreamId'] as string)
        env = { ...env, ownerWorkstreamId: owner }
        payload = {
          ...payload,
          relation_id: live[0],
          source: { ...live[1].source },
          relation_type: live[1].relation_type,
          target: { ...live[1].target },
        }
        break
      }
      case 'ARTIFACT_REGISTERED': {
        if (typeof payload['supersedes'] === 'string') {
          // Retarget to the most recent REGISTERED artifact of the SAME
          // workstream: same-WS ⇒ the predecessor's per-WS seq is LOWER
          // ⇒ the audit merge (eventSeq, owner, id) keeps it FIRST ⇒ the
          // rebuild fold sees it exist before the supersedes reference.
          // (A cross-WS predecessor is registry-legal but can audit-
          // reorder under the pinned per-WS-seq merge — the residual is
          // documented in the WP-3.6 report, 未决 2.)
          const owner = env['ownerWorkstreamId'] as string
          let prior: string | undefined
          for (const [id, row] of state.artifacts) {
            if (row.status === 'REGISTERED' && row.workstream_id === owner) prior = id
          }
          if (prior === undefined) {
            // drop the optional field (the ctx artifact is not in fold state)
            payload = { ...payload }
            delete payload['supersedes']
          } else {
            payload = { ...payload, supersedes: prior }
          }
        }
        break
      }
      default:
        break
    }
    env = { ...env, payload }
    try {
      state = tryFold(state, env)
    } catch {
      continue // fold-illegal (e.g. duplicate §8 5-tuple) — dropped
    }
    if (env['eventType'] === 'RELATION_ADDED') {
      relationAddOwner.set((env['payload'] as Record<string, unknown>)['relation_id'] as string, env['ownerWorkstreamId'] as string)
    }
    const { eventSeq: _s, recordedAt: _r, ...input } = env
    out.push({
      envelope: env as CandidateEvent['envelope'],
      input: input as unknown as CandidateEvent['input'],
    })
  }
  return out
}

/** The fold-side owner of a relation row (§4 特例, state-local half). */
function relationOwner(row: { source: { kind: string; id: string }; target: { kind: string; id: string } }, state: SemanticState): string | undefined {
  const wsOf = (ref: { kind: string; id: string }): string | undefined => {
    if (ref.kind === 'CLAIM') return state.claims.get(ref.id)?.workstream_id
    if (ref.kind === 'FACT') return state.facts.get(ref.id)?.workstream_id
    if (ref.kind === 'ARTIFACT') return state.artifacts.get(ref.id)?.workstream_id
    return undefined
  }
  return wsOf(row.source) ?? wsOf(row.target)
}

describe('RR-014⑧ × RR-011(b): random legal streams — incremental ≡ replay', () => {
  it('the maintained semantics row equals the full replay fold under random batching', () => {
    const registry = loadRegistry()
    fc.assert(
      fc.property(inputArb, ({ stream, sizes }) => {
        // 1. The loud generator constraint (registry, static ctx) — on the
        //    RAW stream, before any projection.
        const raw = constructStream(stream)
        assertStreamLegal(registry, makeCtx(), raw)

        // 2. The fold-state projection (retarget-or-drop, real reducer as
        //    the oracle) + the batching schedule.
        const legal = projectOntoFoldState(raw)
        const batches: HistoryEventInput[][] = []
        let i = 0
        let s = 0
        while (i < legal.length) {
          const size = sizes[Math.min(s, sizes.length - 1)]!
          batches.push(legal.slice(i, i + size).map((c) => c.input))
          i += size
          s += 1
        }

        // 3. The wiring seam: the wrapped store (compensation wrapper +
        //    the semantic validate hook), batch by batch.
        const store = freshStore()
        try {
          const realizer = new WorkstreamRealizer({ researchRoot: store.path, workstreams: new Map() })
          const maintainer = makeSemanticMaintainer({ store, projectId: PROJECT })
          const wrapped = withRealizeCompensation(store, realizer, {
            validateHooks: [maintainer.validateHook],
          })
          for (const batch of batches) wrapped.appendEvents(batch)

          // 4. The two faces must agree on the CANONICAL DOC (the
          //    persisted, key-sorted form — the face
          //    `compareDerivedStates` compares; the in-memory Map
          //    insertion orders legitimately differ: the incremental
          //    face folds in APPEND order, the replay in the audit
          //    merge order).
          const owners = streamOwners(legal)
          const replayed = foldSemanticEvents(
            collectAllEvents(wrapped, owners, 'audit').map(toSemanticInputEvent),
          )
          const row = readDerivedState(wrapped).get(semanticStateKey(PROJECT))
          const semanticCount = legal.filter((c) => SEMANTIC_TYPES.has(c.envelope['eventType'] as string)).length
          if (semanticCount === 0) {
            // Nothing semantic survived the projection — the row must be
            // ABSENT (the hook only writes on a semantic touch).
            expect(row).toBeUndefined()
            expect(replayed.claims.size + replayed.facts.size + replayed.artifacts.size + replayed.relations.size).toBe(0)
            return
          }
          expect(row, 'the semantics row must exist once any semantic event appended').toBeDefined()
          const maintained = jsonToSemanticState(row, semanticStateKey(PROJECT))
          expect(canonicalJson(semanticStateToJson(maintained))).toBe(canonicalJson(semanticStateToJson(replayed)))

          // 5. The startup rebuild face agrees AND reports no drift (the
          //    rebuild compares its own fold against the maintained table).
          const rebuild = maintainer.rebuild({ workstreams: owners })
          expect(rebuild.report.ok, `rebuild drift report: ${JSON.stringify(rebuild.report)}`).toBe(true)
        } finally {
          store.close()
        }
      }),
      { seed: 20260823, numRuns: 60 },
    )
  })
})
