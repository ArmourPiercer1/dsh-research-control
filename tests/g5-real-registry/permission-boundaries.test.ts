/**
 * G5 §B — permission-boundary matrix THROUGH THE REAL REGISTRY.
 *
 *  1. USER-only canonical/decision operations are NOT EXPOSED: the
 *     registry resolves them as `UNKNOWN_TOOL` (the agent literally has
 *     no call face — the USER lanes live behind the RPC/GUI boundary,
 *     exercised in workflow.test.ts through the real production class);
 *  2. the Investigator persona (a session with NO formal run): the 4
 *     read tools SUCCEED through the registry, the 7 write tools are
 *     refused with the machine code `TOOL_RUN_REQUIRED` — zero store
 *     delta on every refusal;
 *  3. identity forgery via args (extra `actor`/`run_id` keys on every
 *     tool that takes args) → `TOOL_INPUT` at the frozen key-set gate
 *     BEFORE any lane runs, zero store delta.
 *
 * Zero-delta proof = event-stream length + derived semantic row ids +
 * declarative-tree sha256, captured around every refused call.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import {
  bootRealRegistryHarness,
  expectDispatchErr,
  expectDispatchOk,
  g5CleanupAll,
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

/** The store-side delta snapshot (events + semantic ids + tree hash). */
function deltas(w: RealRegistryHarness) {
  const wiring = w.wiring()
  const events = ['WS-1', 'WS-2'].map((ws) => wiring.store.listRange(ws, 1).length)
  const row = readSemanticRow(wiring.store, wiring.projectId)
  return {
    events,
    facts: [...(row?.facts.keys() ?? [])].sort().join(','),
    claims: [...(row?.claims.keys() ?? [])].sort().join(','),
    artifacts: [...(row?.artifacts.keys() ?? [])].sort().join(','),
    interventions: wiring.interventions.listInterventions?.({})?.length ?? 0,
    tree: g5TreeSnapshot(w.workspacePaths[1] ?? ''),
  }
}
type Deltas = ReturnType<typeof deltas>
function deltasEqual(a: Deltas, b: Deltas): string | null {
  if (JSON.stringify(a.events) !== JSON.stringify(b.events)) return `events ${a.events} vs ${b.events}`
  if (a.facts !== b.facts) return `facts ${a.facts} vs ${b.facts}`
  if (a.claims !== b.claims) return `claims ${a.claims} vs ${b.claims}`
  if (a.artifacts !== b.artifacts) return `artifacts ${a.artifacts} vs ${b.artifacts}`
  if (a.interventions !== b.interventions) return `interventions ${a.interventions} vs ${b.interventions}`
  return g5SnapshotDiff(a.tree, b.tree) ? `declarative tree diff: ${g5SnapshotDiff(a.tree, b.tree)}` : null
}

describe('G5 §B USER-only surfaces are NOT exposed on the registry', () => {
  it('every canonical/decision/attention-mutation name resolves UNKNOWN_TOOL (no agent face exists)', async () => {
    await setup()
    try {
      const userOnly = [
        'research_plan_fork_select',
        'research_plan_fork_dismiss',
        'research_plan_reorder',
        'research_canonical_plan_edit',
        'research_intervention_update_state',
        'research_next_action_promote',
        'research_next_action_dismiss',
        'research_claim_retract',
        'research_artifact_mark_missing',
        'research_checkpoint_commit',
        'research_git_restore',
        'research_history_mutation',
      ]
      for (const name of userOnly) {
        const r = await h.callTool(name, {}, { sessionId: 'sess-g5b-user' })
        expectDispatchErr(r, 'UNKNOWN_TOOL', name)
      }
    } finally {
      await h.dispose()
    }
  }, 60_000)
})

describe('G5 §B Investigator: 4 reads allowed, 7 writes refused (registry-dispatched)', () => {
  it('a run-less session completes all four reads and is refused on all seven writes with TOOL_RUN_REQUIRED + zero delta', async () => {
    await setup()
    try {
      const before = deltas(h)

      // reads — real-registry SUCCESS for the run-less investigator session
      const ctx = expectDispatchOk(await h.callTool('research_context_get', {}, { sessionId: 'sess-g5b-inv' }), 'context_get')
      expect(ctx['bound']).toBe(false)
      expectDispatchOk(await h.callTool('research_plan_get', WIRE_ARGS.research_plan_get, { sessionId: 'sess-g5b-inv' }), 'plan_get')
      expectDispatchOk(await h.callTool('research_history_query', WIRE_ARGS.research_history_query, { sessionId: 'sess-g5b-inv' }), 'history_query')
      expectDispatchOk(await h.callTool('research_contract_read', WIRE_ARGS.research_contract_read, { sessionId: 'sess-g5b-inv' }), 'contract_read')

      // writes — every one refused BEFORE the lane (machine code, zero delta)
      for (const name of WRITE_7) {
        const r = await h.callTool(name, WIRE_ARGS[name]!, { sessionId: 'sess-g5b-inv' })
        expectDispatchErr(r, 'TOOL_RUN_REQUIRED', name)
        const diff = deltasEqual(before, deltas(h))
        expect(diff, `${name}: partial write detected`).toBeNull()
      }

      // the read set really is the 4-name READ lane
      expect(READ_4).toHaveLength(4)
      const after = deltas(h)
      expect(deltasEqual(before, after)).toBeNull()
    } finally {
      await h.dispose()
    }
  }, 90_000)
})

describe('G5 §B identity forgery via args is refused at the frozen key-set gate', () => {
  it('every injected identity key on every wire face → TOOL_INPUT before any lane (zero delta)', async () => {
    await setup()
    try {
      // The write lanes run the ACTOR gate BEFORE the wire face (frozen
      // order) — bind a run so the forged-key refusal observed here is
      // the wire-face TOOL_INPUT, not the earlier TOOL_RUN_REQUIRED.
      h.wiring().runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g5b-forger' }, USER)
      const before = deltas(h)
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
            continue
          }
          expectDispatchErr(r, 'TOOL_INPUT', name)
        }
      }
      // run_id is a LEGAL target key ONLY on run_checkpoint (frozen face);
      // every OTHER tool rejects it as an unknown key — pinned above.
      const diff = deltasEqual(before, deltas(h))
      expect(diff).toBeNull()
    } finally {
      await h.dispose()
    }
  }, 90_000)

  it('a USER-actor session cannot be smuggled past the run gate: bound USER-less session + run_id on checkpoint targets the CALLER run (cross-run refused)', async () => {
    await setup()
    try {
      const runA = h.wiring().runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g5b-a' }, USER).run
      h.wiring().runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g5b-b' }, USER).run
      const before = deltas(h)
      // AGENT(session A) checkpointing run B — same-plane cross-run:
      // registry-layer machine code is TOOL_SERVICE (the service code
      // RB_CHECKPOINT_FOREIGN_RUN is asserted exactly at the plugin/host
      // layer in tests/discovery/host-tools-reinit.test.ts — G1 §4);
      // here the message carries the identifying refusal text.
      const r = await h.callTool('research_run_checkpoint', { run_id: 'R-2', note: '越权补记' }, { sessionId: 'sess-g5b-a' })
      expectDispatchErr(r, 'TOOL_SERVICE', 'OWN run')
      expect(h.wiring().runBinding.getRun('R-2')?.last_checkpoint_note ?? null).toBeNull()
      expect(runA.last_checkpoint_note ?? null).toBeNull()
      const diff = deltasEqual(before, deltas(h))
      expect(diff).toBeNull()
    } finally {
      await h.dispose()
    }
  }, 60_000)
})
