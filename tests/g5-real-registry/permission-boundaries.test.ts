/**
 * G5 §B — permission-boundary matrix THROUGH THE REAL REGISTRY.
 *
 *  1. operations that are NOT on the agent tool face resolve as
 *     `UNKNOWN_TOOL` — two POLICY classes, pinned apart (§B.1):
 *       (a) genuinely §6 USER-only lanes (canonical plan edits,
 *           SELECT/DISMISS, PROMOTE/DISMISS, intervention state,
 *           checkpoint commit, git restore, history mutation);
 *       (b) FROZEN-§6 AGENT-ALLOWED operations that the current
 *           11-tool API simply does not expose (Claim retraction,
 *           Artifact mark-missing) — unavailable, NOT forbidden
 *           (BASELINE_PLAN §1 non-goal 2).
 *     Either way the agent has no call face; USER lanes are exercised
 *     through the real production classes in workflow.test.ts;
 *  2. the Investigator persona AS A RUN-LESS SESSION: the 4 read tools
 *     SUCCEED, the 7 write tools are refused with `TOOL_RUN_REQUIRED`
 *     (the RUN gate). The REAL scoped-restriction layer
 *     (`HostAgentLauncherAdapter` + `tools.restrict`) is proven
 *     SEPARATELY in investigator-restricted.test.ts — a run-bound
 *     agent losing the 7 names to the registry restriction, so the two
 *     gates are never conflated;
 *  3. identity forgery via args (extra `actor`/`run_id`/
 *     `created_by_run`/`caller` keys) → `TOOL_INPUT` at the frozen
 *     key-set gate BEFORE any lane runs.
 *
 * Zero-delta proof = the FULL persisted face, re-read after EVERY
 * individual refusal: every table of every operational sqlite store
 * (history_event, derived_state, runs, plan forks, interventions, NEXT
 * ACTIONS, blockers, inbox, …) + the declarative-tree sha256. The
 * `meta` id-allocator counters are tracked under their own rule
 * (below) because reserved-then-burned ids (gaps) are the EXISTING
 * legal design — never assert blanket "nothing anywhere changed".
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import {
  bootRealRegistryHarness,
  expectDispatchErr,
  expectDispatchOk,
  g5BusinessRowDiff,
  g5CleanupAll,
  g5DbRowSnapshot,
  g5MetaRows,
  g5SnapshotDiff,
  g5TreeSnapshot,
  type RealRegistryHarness,
} from '../helpers/real-registry-host.js'
import { USER } from '../wiring/helpers.js'
import { readSemanticRow } from '../semantics-records/harness.js'

const READ_4 = [
  'research_context_get',
  'research_plan_get',
  'research_history_query',
  'research_contract_read',
]
const WRITE_7 = [
  'research_fact_record',
  'research_claim_record',
  'research_artifact_register',
  'research_intervention_create',
  'research_next_action_create',
  'research_plan_fork_create',
  'research_run_checkpoint',
]

/** A valid-shaped wire face per tool (only the FORGED key differs). */
const WIRE_ARGS: Record<string, Record<string, unknown>> = {
  research_fact_record: { workstream_id: 'WS-1', statement: 's' },
  research_claim_record: { workstream_id: 'WS-1', statement: 's' },
  research_artifact_register: { workstream_id: 'WS-1', type: 'DATASET', title: 't', uri: 'u' },
  research_intervention_create: { title: 't', workstream_ids: [], source_refs: [] },
  research_next_action_create: { statement: 's' },
  research_plan_fork_create: {
    workstream_id: 'WS-1',
    fork_anchor: 'T-1',
    merge_anchor: 'T-1',
    proposed_items: [{ action: 'NEW', kind: 'TASK', spec: { title: 'x', goal: 'y' } }],
    trigger_refs: [{ kind: 'MILESTONE', id: 'M-1' }],
    reason: 'r',
    necessity: 'n',
  },
  research_run_checkpoint: { run_id: 'R-1', note: 'x' },
  research_context_get: {},
  research_plan_get: { workstream_id: 'WS-1' },
  research_history_query: { workstream_id: 'WS-1' },
  research_contract_read: { edge_id: 'TE-2' },
}

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})
afterEach(() => logSpy.mockClear())
afterAll(async () => {
  logSpy.mockRestore()
  await g5CleanupAll()
})

let h: RealRegistryHarness

async function setup(): Promise<RealRegistryHarness> {
  h = await bootRealRegistryHarness()
  return h
}

/** The FULL persisted-face snapshot: every operational-store table
 *  (business) + the meta counters (own rule) + derived semantic rows
 *  (API-level double-check) + declarative tree. */
function persistedFace(w: RealRegistryHarness) {
  const db = g5DbRowSnapshot(w.workspacePaths)
  const wiring = w.wiring()
  const row = readSemanticRow(wiring.store, wiring.projectId)
  return {
    dbBusiness: db.business,
    dbMeta: db.meta,
    metaRows: g5MetaRows(w.workspacePaths),
    facts: [...(row?.facts.keys() ?? [])].sort().join(','),
    claims: [...(row?.claims.keys() ?? [])].sort().join(','),
    artifacts: [...(row?.artifacts.keys() ?? [])].sort().join(','),
    tree: g5TreeSnapshot(w.workspacePaths[1] ?? ''),
  }
}
type PersistedFace = ReturnType<typeof persistedFace>

/** Business-face equality: every table + derived rows + tree. Returns
 *  the first difference or null. Allocator meta is EXCLUDED here on
 *  purpose — it has its own assertion below. */
function businessDiff(a: PersistedFace, b: PersistedFace): string | null {
  return (
    g5BusinessRowDiff(a.dbBusiness, b.dbBusiness) ??
    (a.facts !== b.facts ? `facts ${a.facts} vs ${b.facts}` : null) ??
    (a.claims !== b.claims ? `claims ${a.claims} vs ${b.claims}` : null) ??
    (a.artifacts !== b.artifacts ? `artifacts ${a.artifacts} vs ${b.artifacts}` : null) ??
    (g5SnapshotDiff(a.tree, b.tree) !== null ? `declarative tree diff: ${g5SnapshotDiff(a.tree, b.tree)}` : null)
  )
}

/** Meta (id-allocator counters / fold watermarks) key-wise drift. For
 *  THESE refusal paths the refusal happens BEFORE any lane, so no id is
 *  even reserved — equality is the honest expectation here. (Elsewhere,
 *  reserved-then-burned ids leaving gaps are the existing legal design;
 *  this helper reports drift, the caller decides, and monotonicity is
 *  always mandatory.) */
function metaDiff(a: PersistedFace, b: PersistedFace): string | null {
  const keys = [...new Set([...Object.keys(a.metaRows), ...Object.keys(b.metaRows)])].sort()
  for (const k of keys) {
    if (a.metaRows[k] !== b.metaRows[k]) return `meta row changed/absent: ${k}`
  }
  return null
}

function assertUnchanged(before: PersistedFace, label: string): PersistedFace {
  const after = persistedFace(h)
  // non-triviality guard: the snapshot must actually SEE the persisted
  // face (a vacuous empty map would "prove" nothing)
  expect(Object.keys(after.dbBusiness).length, 'db table snapshot must cover the operational tables').toBeGreaterThan(5)
  expect(businessDiff(before, after), `${label}: partial business write detected`).toBeNull()
  expect(metaDiff(before, after), `${label}: meta/allocator moved on a pre-lane refusal`).toBeNull()
  return after
}

describe('G5 §B.1 operations absent from the agent tool face (registry UNKNOWN_TOOL)', () => {
  it('class (a): genuinely §6 USER-only lanes have no agent call face', async () => {
    await setup()
    try {
      const userOnlyLanes = [
        'research_plan_fork_select',
        'research_plan_fork_dismiss',
        'research_plan_reorder',
        'research_canonical_plan_edit',
        'research_intervention_update_state',
        'research_next_action_promote',
        'research_next_action_dismiss',
        'research_checkpoint_commit',
        'research_git_restore',
        'research_history_mutation',
      ]
      for (const name of userOnlyLanes) {
        const r = await h.callTool(name, {}, { sessionId: 'sess-g5b-user' })
        expectDispatchErr(r, 'UNKNOWN_TOOL', name)
      }
    } finally {
      await h.dispose()
    }
  }, 60_000)

  it('class (b): FROZEN-§6 AGENT-ALLOWED operations not exposed by the current 11-tool API (unavailable, NOT forbidden)', async () => {
    await setup()
    try {
      // The frozen §6 matrix permits AGENT-initiated Claim RETRACTION and
      // Artifact MARK-MISSING; the current 11-tool API ships no such tool
      // (scope, not policy). They are UNAVAILABLE on the registry — the
      // same UNKNOWN_TOOL resolution as class (a), a DIFFERENT policy:
      // a future tool group may expose them; class (a) names must NEVER
      // reach the agent face. (BASELINE_PLAN §1 non-goal 2.)
      const agentAllowedNotExposed = ['research_claim_retract', 'research_artifact_mark_missing']
      for (const name of agentAllowedNotExposed) {
        const r = await h.callTool(name, {}, { sessionId: 'sess-g5b-user' })
        expectDispatchErr(r, 'UNKNOWN_TOOL', name)
      }
    } finally {
      await h.dispose()
    }
  }, 60_000)
})

describe('G5 §B.2 run-less session: 4 reads allowed, 7 writes refused by the RUN gate', () => {
  it('a run-less session completes all four reads and is refused on all seven writes with TOOL_RUN_REQUIRED + zero delta', async () => {
    await setup()
    try {
      const before = persistedFace(h)

      // reads — real-registry SUCCESS for the run-less investigator session
      const ctx = expectDispatchOk(await h.callTool('research_context_get', {}, { sessionId: 'sess-g5b-inv' }), 'context_get')
      expect(ctx['bound']).toBe(false)
      expectDispatchOk(await h.callTool('research_plan_get', WIRE_ARGS.research_plan_get, { sessionId: 'sess-g5b-inv' }), 'plan_get')
      expectDispatchOk(await h.callTool('research_history_query', WIRE_ARGS.research_history_query, { sessionId: 'sess-g5b-inv' }), 'history_query')
      expectDispatchOk(await h.callTool('research_contract_read', WIRE_ARGS.research_contract_read, { sessionId: 'sess-g5b-inv' }), 'contract_read')
      let cursor = assertUnchanged(before, '4 reads (read-only by contract)')

      // writes — every one refused at the RUN gate (this is NOT the
      // registry-restriction layer; see investigator-restricted.test.ts)
      for (const name of WRITE_7) {
        const r = await h.callTool(name, WIRE_ARGS[name]!, { sessionId: 'sess-g5b-inv' })
        expectDispatchErr(r, 'TOOL_RUN_REQUIRED', name)
        cursor = assertUnchanged(cursor, `run-gate refusal ${name}`)
      }
      void cursor
    } finally {
      await h.dispose()
    }
  }, 90_000)
})

describe('G5 §B.3 identity forgery via args is refused at the frozen key-set gate', () => {
  it('every injected identity key on every wire face → TOOL_INPUT before any lane, re-asserted after EACH refusal', async () => {
    await setup()
    try {
      // The write lanes run the ACTOR gate BEFORE the wire face (frozen
      // order) — bind a run so the forged-key refusal observed here is
      // the wire-face TOOL_INPUT, not the earlier TOOL_RUN_REQUIRED.
      h.wiring().runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g5b-forger' }, USER)
      let before = persistedFace(h)
      const forgedKeys: Array<Record<string, unknown>> = [
        { actor: { kind: 'USER', user_id: 'evil' } },
        { run_id: 'R-999' },
        { created_by_run: 'R-999' },
        { caller: { kind: 'AGENT', run_id: 'R-999' } },
      ]
      for (const name of [...READ_4, ...WRITE_7]) {
        for (const forged of forgedKeys) {
          const args = { ...WIRE_ARGS[name]!, ...forged }
          const r = await h.callTool(name, args, { sessionId: 'sess-g5b-forger' })
          if (name === 'research_run_checkpoint' && 'run_id' in forged) {
            // DOCUMENTED frozen-face exception: run_id is a legal TARGET
            // key only on run_checkpoint (the B2 gate then forces
            // target === caller) — here the target simply does not exist.
            expectDispatchErr(r, 'TOOL_SERVICE', 'R-999')
            before = assertUnchanged(before, `${name} × legal target run_id (missing target)`)
            continue
          }
          expectDispatchErr(r, 'TOOL_INPUT', name)
          before = assertUnchanged(before, `${name} × forged ${JSON.stringify(Object.keys(forged))}`)
        }
      }
    } finally {
      await h.dispose()
    }
  }, 120_000)

  it('cross-run checkpoint is refused and the target run row stays untouched', async () => {
    await setup()
    try {
      const runA = h.wiring().runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g5b-a' }, USER).run
      h.wiring().runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g5b-b' }, USER).run
      const before = persistedFace(h)
      // AGENT(session A) checkpointing run B — same-plane cross-run:
      // registry-layer machine code is TOOL_SERVICE (the service code
      // RB_CHECKPOINT_FOREIGN_RUN is asserted exactly at the plugin/host
      // layer in tests/discovery/host-tools-reinit.test.ts — G1 §4);
      // here the message carries the identifying refusal text.
      const r = await h.callTool('research_run_checkpoint', { run_id: 'R-2', note: '越权补记' }, { sessionId: 'sess-g5b-a' })
      expectDispatchErr(r, 'TOOL_SERVICE', 'OWN run')
      // independent target-row check (kept per review — not subsumed by
      // the snapshot): the refused target and the caller row BOTH show
      // no checkpoint note, and the full persisted face is unchanged.
      expect(h.wiring().runBinding.getRun('R-2')?.last_checkpoint_note ?? null).toBeNull()
      expect(runA.last_checkpoint_note ?? null).toBeNull()
      assertUnchanged(before, 'cross-run checkpoint refusal')
    } finally {
      await h.dispose()
    }
  }, 60_000)
})
