/**
 * G3 (semantic write tools) — the narrow AGENT create lane of the
 * semantic records service (BASELINE_PLAN §2a row 2-4, parent review #2).
 *
 * The lane the three `research_*` write tools forward into (through the
 * `semanticAgentCreate` tool port — identity NEVER comes from tool args,
 * the host resolves it from the calling session, G1):
 *
 *   recordFactAsAgent / recordClaimAsAgent / registerArtifactAsAgent
 *     (args, caller)   caller = the trusted AGENT actorRef + formal run
 *
 * Pinned here at the SERVICE boundary (production-faithful harness: real
 * store + frozen registry + RR-011(b) fold seam + real IdAllocator — the
 * same stack as the USER-lane tests; only the injected run-registry port
 * is a fake, the port is a port):
 *
 *  - the event envelope carries actor {kind:'AGENT', run_id, session_id}
 *    (catalog §3 U A emitters; §5 actor.run_id must reference an existing
 *    Run) and the payload carries created_by_run (FACT/CLAIM: AGENT ⇒
 *    required; artifact: stamped for attribution);
 *  - the derived row carries created_by (the AGENT actorRef) +
 *    created_by_run (the reducer reads the payload field — provenance is
 *    the event log itself, ADJ-1);
 *  - the caller run is verified against the injected run registry:
 *    unknown run ⇒ OBJECT_NOT_FOUND, run.workstream_id ≠ target WS ⇒
 *    OWNER_MISMATCH (the same-WS gate; no event row, reservations
 *    released — ADJ-3 discipline unchanged);
 *  - a non-AGENT / run-less caller is refused BEFORE any reservation
 *    (INVALID_ENVELOPE — the lane cannot be used to forge a USER write);
 *  - the composed registry validate hook now sees the REAL caller run in
 *    ctx.runs (the registry cross-checks actor.run_id / created_by_run —
 *    an empty run map would reject a legitimate AGENT event);
 *  - the USER lane is byte-identical next to it (actor USER, NO
 *    created_by_run — no USER → AGENT bleed in either direction).
 */
import { describe, expect, it } from 'vitest'

import { makeService, readSemanticRow, countEvents, findEvent, defaultPlans } from './harness.js'
import { expectCarrierCode, countDerivedKind } from './helpers.js'
import type { SemanticAgentActor, SemanticRunRegistryPort } from '../../src/host/service/semantics/index.js'

/* ------------------------------------------------------------------ *
 * The trusted-run fixture (the narrow run-registry port)
 * ------------------------------------------------------------------ */

/** Two formal runs: R-1 on WS-1, R-2 on WS-2 (cross-WS cases). */
function makeRunsPort(): SemanticRunRegistryPort & { calls: string[] } {
  const rows = new Map<string, { id: string; workstream_id: string; status: 'RUNNING' | 'FINISHED' | 'FAILED' | 'CANCELLED' }>([
    ['R-1', { id: 'R-1', workstream_id: 'WS-1', status: 'RUNNING' }],
    ['R-2', { id: 'R-2', workstream_id: 'WS-2', status: 'RUNNING' }],
  ])
  const calls: string[] = []
  return {
    calls,
    getRun: (runId) => {
      calls.push(runId)
      return rows.get(runId) ?? null
    },
  }
}

const CALLER_WS1: SemanticAgentActor = { kind: 'AGENT', run_id: 'R-1', session_id: 'sess-g3-a' }
const CALLER_WS2: SemanticAgentActor = { kind: 'AGENT', run_id: 'R-2', session_id: 'sess-g3-b' }

/* ------------------------------------------------------------------ *
 * The happy paths (event actor + payload created_by_run + derived row)
 * ------------------------------------------------------------------ */

describe('G3 agent create lane — recordFactAsAgent', () => {
  it('records a fact attributed to the run: AGENT envelope actor, created_by_run payload + row', () => {
    const runs = makeRunsPort()
    const h = makeService(defaultPlans(), { runs })
    try {
      const res = h.service.recordFactAsAgent(
        { workstreamId: 'WS-1', statement: 'loss plateaued at epoch 12', references: ['T-1'] },
        CALLER_WS1,
      )
      expect(res.factId).toBe('F-1')
      expect(res.workstreamId).toBe('WS-1')
      expect(res.status).toBe('ACTIVE')
      expect(res.createdByRun).toBe('R-1')
      expect(res.eventId).toBe('H-1')

      // The event: AGENT actor with run_id + session_id, payload stamped
      // with created_by_run (catalog §5.3: AGENT 发射时必填).
      const ev = findEvent(h.store, 'H-1')!
      expect(ev.eventType).toBe('FACT_RECORDED')
      expect(ev.ownerWorkstreamId).toBe('WS-1')
      expect(ev.actor).toEqual({ kind: 'AGENT', run_id: 'R-1', session_id: 'sess-g3-a' })
      expect(ev.payload).toMatchObject({
        fact_id: 'F-1',
        statement: 'loss plateaued at epoch 12',
        references: ['T-1'],
        created_by_run: 'R-1',
      })

      // The derived row (reducer: created_by = envelope actor,
      // created_by_run = payload field).
      const row = readSemanticRow(h.store, h.projectId)!.facts.get('F-1')!
      expect(row.created_by).toEqual({ kind: 'AGENT', run_id: 'R-1', session_id: 'sess-g3-a' })
      expect(row.created_by_run).toBe('R-1')
      expect(row.status).toBe('ACTIVE')

      // ADJ-1 unchanged: no management_action row on this path either.
      expect(countDerivedKind(h.store, 'management_action')).toBe(0)
      // The lane consulted the injected run registry for the caller run.
      expect(runs.calls).toContain('R-1')
    } finally {
      h.close()
    }
  })
})

describe('G3 agent create lane — recordClaimAsAgent', () => {
  it('records a claim attributed to the run (CLAIM_RECORDED, ACTIVE, created_by_run)', () => {
    const runs = makeRunsPort()
    const h = makeService(defaultPlans(), { runs })
    try {
      const res = h.service.recordClaimAsAgent({ workstreamId: 'WS-1', statement: 'the detector saturates below 5lx' }, CALLER_WS1)
      expect(res.claimId).toBe('C-1')
      expect(res.status).toBe('ACTIVE')
      expect(res.createdByRun).toBe('R-1')

      const ev = findEvent(h.store, res.eventId)!
      expect(ev.eventType).toBe('CLAIM_RECORDED')
      expect(ev.actor).toEqual({ kind: 'AGENT', run_id: 'R-1', session_id: 'sess-g3-a' })
      expect(ev.payload).toMatchObject({ claim_id: 'C-1', created_by_run: 'R-1' })

      const row = readSemanticRow(h.store, h.projectId)!.claims.get('C-1')!
      expect(row.created_by_run).toBe('R-1')
      expect(row.status).toBe('ACTIVE')
    } finally {
      h.close()
    }
  })
})

describe('G3 agent create lane — registerArtifactAsAgent', () => {
  it('registers an artifact by reference attributed to the run (BY REFERENCE, §13.6)', () => {
    const runs = makeRunsPort()
    const h = makeService(defaultPlans(), { runs })
    try {
      const res = h.service.registerArtifactAsAgent(
        {
          workstreamId: 'WS-1',
          type: 'DATASET',
          title: 'night-run frames',
          uri: 'data/night-07/',
          contentHash: 'sha256:ab12',
          relatedTaskId: 'T-1',
        },
        CALLER_WS1,
      )
      expect(res.artifactId).toBe('A-1')
      expect(res.status).toBe('REGISTERED')
      expect(res.createdByRun).toBe('R-1')

      const ev = findEvent(h.store, res.eventId)!
      expect(ev.eventType).toBe('ARTIFACT_REGISTERED')
      expect(ev.actor).toEqual({ kind: 'AGENT', run_id: 'R-1', session_id: 'sess-g3-a' })
      expect(ev.payload).toMatchObject({
        artifact_id: 'A-1',
        type: 'DATASET',
        title: 'night-run frames',
        uri: 'data/night-07/',
        content_hash: 'sha256:ab12',
        related_task: 'T-1',
        created_by_run: 'R-1',
      })

      const row = readSemanticRow(h.store, h.projectId)!.artifacts.get('A-1')!
      expect(row.created_by_run).toBe('R-1')
      expect(row.uri).toBe('data/night-07/')
      expect(row.status).toBe('REGISTERED')
    } finally {
      h.close()
    }
  })

  it('bad refs keep the existing registry rules (related_task / supersedes OBJECT_NOT_FOUND, no event row)', () => {
    const runs = makeRunsPort()
    const h = makeService(defaultPlans(), { runs })
    try {
      expectCarrierCode(
        () =>
          h.service.registerArtifactAsAgent(
            { workstreamId: 'WS-1', type: 'CODE', title: 't', uri: 'u', relatedTaskId: 'T-99' },
            CALLER_WS1,
          ),
        'OBJECT_NOT_FOUND',
      )
      expectCarrierCode(
        () =>
          h.service.registerArtifactAsAgent(
            { workstreamId: 'WS-1', type: 'CODE', title: 't', uri: 'u', supersedes: 'A-77' },
            CALLER_WS1,
          ),
        'OBJECT_NOT_FOUND',
      )
      expect(countEvents(h.store, 'WS-1')).toBe(0)
      // reservations released (gaps legal, §1.1 单调): no commits landed.
      expect(h.allocatorEvents.filter((e) => e.op === 'commit')).toHaveLength(0)
    } finally {
      h.close()
    }
  })
})

/* ------------------------------------------------------------------ *
 * The trusted-run gates (existence + same-WS) — refusals write NOTHING
 * ------------------------------------------------------------------ */

describe('G3 agent create lane — trusted-run verification', () => {
  it('unknown caller run ⇒ OBJECT_NOT_FOUND carrier, no event row, no derived row', () => {
    const runs = makeRunsPort()
    const h = makeService(defaultPlans(), { runs })
    try {
      const err = expectCarrierCode(
        () => h.service.recordFactAsAgent({ workstreamId: 'WS-1', statement: 's' }, { kind: 'AGENT', run_id: 'R-404' }),
        'OBJECT_NOT_FOUND',
      )
      expect(err.message).toContain('R-404')
      expect(countEvents(h.store, 'WS-1')).toBe(0)
      expect(readSemanticRow(h.store, h.projectId)).toBeUndefined()
      expect(h.allocatorEvents.filter((e) => e.op === 'commit')).toHaveLength(0)
    } finally {
      h.close()
    }
  })

  it('cross-WS caller (run on WS-2, target WS-1) ⇒ OWNER_MISMATCH, nothing written', () => {
    const runs = makeRunsPort()
    const h = makeService(defaultPlans(), { runs })
    try {
      const err = expectCarrierCode(
        () => h.service.recordFactAsAgent({ workstreamId: 'WS-1', statement: 's' }, CALLER_WS2),
        'OWNER_MISMATCH',
      )
      expect(err.message).toContain('R-2')
      expect(err.message).toContain('WS-2')
      expect(countEvents(h.store, 'WS-1')).toBe(0)
      expect(countEvents(h.store, 'WS-2')).toBe(0)
    } finally {
      h.close()
    }
  })

  it('the same-WS positive on the OTHER workstream keeps working (no WS-1 special-casing)', () => {
    const runs = makeRunsPort()
    const h = makeService(defaultPlans(), { runs })
    try {
      const res = h.service.recordClaimAsAgent({ workstreamId: 'WS-2', statement: 'WS-2 claim' }, CALLER_WS2)
      expect(res.workstreamId).toBe('WS-2')
      expect(findEvent(h.store, res.eventId)!.ownerWorkstreamId).toBe('WS-2')
    } finally {
      h.close()
    }
  })

  it('a non-AGENT or run-less caller is refused BEFORE any reservation (INVALID_ENVELOPE)', () => {
    const runs = makeRunsPort()
    const h = makeService(defaultPlans(), { runs })
    try {
      // A USER actor cannot ride the agent lane (nor impersonate it the
      // other way — the USER entry has no caller parameter at all).
      expectCarrierCode(
        () =>
          h.service.recordFactAsAgent(
            { workstreamId: 'WS-1', statement: 's' },
            { kind: 'USER', run_id: 'R-1' } as unknown as SemanticAgentActor,
          ),
        'INVALID_ENVELOPE',
      )
      expectCarrierCode(
        () => h.service.recordFactAsAgent({ workstreamId: 'WS-1', statement: 's' }, { kind: 'AGENT', run_id: '' } as SemanticAgentActor),
        'INVALID_ENVELOPE',
      )
      expect(countEvents(h.store, 'WS-1')).toBe(0)
      // refused before the reservations (the registry port was not even consulted)
      expect(runs.calls).toHaveLength(0)
      expect(h.allocatorEvents).toHaveLength(0)
    } finally {
      h.close()
    }
  })

  it('the lane fails LOUD when the wiring did not inject the run registry (composition bug, not a runtime surprise)', () => {
    const h = makeService() // no runs port — the USER-lane construction
    try {
      expect(() => h.service.recordFactAsAgent({ workstreamId: 'WS-1', statement: 's' }, CALLER_WS1)).toThrow(TypeError)
      expect(countEvents(h.store, 'WS-1')).toBe(0)
    } finally {
      h.close()
    }
  })
})

/* ------------------------------------------------------------------ *
 * USER-lane isolation (the lane parameter must not bleed)
 * ------------------------------------------------------------------ */

describe('G3 agent create lane — USER lane unchanged next to it', () => {
  it('recordFact (USER) on the same service: actor USER, NO created_by_run anywhere', () => {
    const runs = makeRunsPort()
    const h = makeService(defaultPlans(), { runs })
    try {
      const res = h.service.recordFact({ workstreamId: 'WS-1', statement: 'user note' })
      expect(res.createdByRun).toBeUndefined()

      const ev = findEvent(h.store, res.eventId)!
      expect(ev.actor).toEqual({ kind: 'USER' })
      expect(ev.payload.created_by_run).toBeUndefined()

      const row = readSemanticRow(h.store, h.projectId)!.facts.get(res.factId)!
      expect(row.created_by).toEqual({ kind: 'USER' })
      expect(row.created_by_run).toBeUndefined()
      // the USER lane never consults the run registry
      expect(runs.calls).toHaveLength(0)
    } finally {
      h.close()
    }
  })
})
