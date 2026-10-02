/**
 * G5 §A — the 11-tool integrated workflow THROUGH THE REAL REGISTRY.
 *
 * Every successful output below is executed by the pinned
 * `@deepseek-ai/dsh-tools` `ToolRuntime.execute` — the registry itself
 * snapshots the value, runs the REAL `validateJsonSchemaValue` output
 * validator (violations fold to `INVALID_TOOL_OUTPUT`) and runs the
 * real `output.render` projection. `expectDispatchOk` therefore fails
 * unless the ACTUAL host codec accepted the value.
 *
 * The workflow is the frozen closed loop:
 *   read lane (context/plan/contract/history)
 *   → trusted run (USER registerRun lane — real RunBindingService)
 *   → research_plan_fork_create (AGENT, real WP-3.1 chain + real git)
 *   → USER SELECT through the REAL production user lane
 *     (ProductionResearchRpcServices — the GUI-lane class; no agent
 *     surface can reach it — see the surface suite)
 *   → fact/claim/artifact with AGENT(run) actor + created_by_run
 *     provenance verified in BOTH the event envelope and the derived
 *     semantic row
 *   → next_action (optional WS) + intervention (multi-WS, refs; event
 *     + row) → own-run checkpoint
 *   → history/read replay of everything the run produced.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  bootRealRegistryHarness,
  expectDispatchOk,
  g5CleanupAll,
  type RealRegistryHarness,
} from '../helpers/real-registry-host.js'
import { USER } from '../wiring/helpers.js'
import { readSemanticRow } from '../semantics-records/harness.js'

const FROZEN_11 = [
  'research_fact_record',
  'research_claim_record',
  'research_artifact_register',
  'research_intervention_create',
  'research_next_action_create',
  'research_plan_fork_create',
  'research_run_checkpoint',
  'research_context_get',
  'research_plan_get',
  'research_history_query',
  'research_contract_read',
].sort()

const AGENT_SESSION = 'sess-g5-agent-a'

const PF_ARGS = {
  workstream_id: 'WS-1',
  fork_anchor: 'T-1',
  merge_anchor: 'T-1',
  proposed_items: [
    { action: 'NEW', kind: 'TASK', spec: { title: 't-g5-materialized', goal: 'g-g5' } },
  ],
  trigger_refs: [{ kind: 'MILESTONE', id: 'M-1' }],
  reason: 'G5 真实 registry 闭环：可信 run 发起的合法 fork',
  necessity: '验证 USER 决策边界经真实服务、Agent 面全部输出过真实 codec',
}

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})
afterEach(() => logSpy.mockClear())
afterAll(async () => {
  logSpy.mockRestore()
  await g5CleanupAll()
})

/** The harness is HEAVY (real boot + git + sqlite); the workflow is a
 *  single ordered story, so one harness serves the ordered suite. */
let h: RealRegistryHarness
const ids = { runId: '', pfId: '', factId: '', claimId: '', artifactId: '', ivId: '', naId: '', materializedTask: '' }

beforeAll(async () => {
  h = await bootRealRegistryHarness()
}, 90_000)

afterAll(async () => {
  await h?.dispose()
})

describe('G5 §A registry surface (real ToolRuntime)', () => {
  it('the real registry carries EXACTLY the frozen 11 research tools', () => {
    const names = h.runtime.schemas().map((t) => t.name).sort()
    expect(names).toEqual(FROZEN_11)
  })

  it('step 0 · reads BEFORE any binding are honest empty subjects (context unbound)', async () => {
    const ctx = expectDispatchOk(await h.callTool('research_context_get', {}, { sessionId: AGENT_SESSION }), 'context_get')
    expect(ctx['bound']).toBe(false)
    expect(ctx['session_id']).toBe(AGENT_SESSION)
  })
})

describe('G5 §A trusted run + planfork + USER decision boundary', () => {
  it('step 1 · USER lane registers a formal run bound to the agent session (real service)', () => {
    const run = h.wiring().runBinding.registerRun(
      { workstreamId: 'WS-1', dshSessionId: AGENT_SESSION, intent: 'G5 验收 run' },
      USER,
    ).run
    expect(run.id).toMatch(/^R-\d+$/)
    ids.runId = run.id
  })

  it('step 2 · context_get now reports the trusted run (registry-validated output)', async () => {
    const ctx = expectDispatchOk(await h.callTool('research_context_get', {}, { sessionId: AGENT_SESSION }), 'context_get')
    expect(ctx['bound']).toBe(true)
    expect((ctx['run'] as Record<string, unknown>)['id']).toBe(ids.runId)
    expect((ctx['run'] as Record<string, unknown>)['workstream_id']).toBe('WS-1')
  })

  it('step 3 · plan_fork_create succeeds from the bound AGENT run (real 8-step chain + git capture)', async () => {
    const created = expectDispatchOk(await h.callTool('research_plan_fork_create', PF_ARGS, { sessionId: AGENT_SESSION }), 'plan_fork_create')
    expect(created['status']).toBe('created')
    const pf = created['plan_fork'] as Record<string, unknown>
    expect(pf['status']).toBe('OPEN')
    expect(pf['workstream_id']).toBe('WS-1')
    expect(pf['created_by_run']).toBe(ids.runId)
    expect(typeof pf['id']).toBe('string')
    ids.pfId = String(pf['id'])
    // the §4 base closure really was captured from git (non-empty, real OIDs)
    const base = pf['base_plan_objects'] as Array<Record<string, unknown>>
    expect(base.length).toBeGreaterThan(0)
    for (const o of base) expect(String(o['git_blob_oid'])).toMatch(/^[0-9a-f]{40}$/)
  })

  it('step 4 · USER SELECT materializes the fork through the REAL production user lane', async () => {
    const outcome = await h.rpc().selectPlanFork({ planForkId: ids.pfId })
    expect(outcome.planForkId).toBe(ids.pfId)
    expect(outcome.statusAfter).toBe('SELECTED')
    expect(outcome.newItems.length).toBe(1)
    ids.materializedTask = outcome.newItems[0]!.id
  })

  it('step 5 · plan_get (real registry) shows the materialized item verbatim-ordered', async () => {
    const plan = expectDispatchOk(await h.callTool('research_plan_get', { workstream_id: 'WS-1' }, { sessionId: AGENT_SESSION }), 'plan_get')
    expect(plan['present']).toBe(true)
    expect(plan['consistent']).toBe(true)
    const ordered = plan['ordered_items'] as readonly string[]
    expect(ordered).toContain(ids.materializedTask)
    const pf = h.wiring().planForks.getPlanFork(ids.pfId)
    expect(pf?.status).toBe('SELECTED')
  })
})

describe('G5 §A semantic provenance lane', () => {
  it('step 6 · fact/claim/artifact succeed with AGENT(run) actor + created_by_run (registry-validated rows)', async () => {
    const fact = expectDispatchOk(await h.callTool('research_fact_record', {
      workstream_id: 'WS-1', statement: 'loss plateaued at epoch 12 across 3 seeds', references: ['T-1'],
    }, { sessionId: AGENT_SESSION }), 'fact_record')
    expect(fact['status']).toBe('ok')
    const f = fact['fact'] as Record<string, unknown>
    expect(f['created_by_run']).toBe(ids.runId)
    expect(f['status']).toBe('ACTIVE')
    ids.factId = String(f['id'])

    const claim = expectDispatchOk(await h.callTool('research_claim_record', {
      workstream_id: 'WS-1', statement: 'the detector saturates below 5 lx',
    }, { sessionId: AGENT_SESSION }), 'claim_record')
    const c = claim['claim'] as Record<string, unknown>
    expect(c['created_by_run']).toBe(ids.runId)
    expect(c['status']).toBe('ACTIVE')
    ids.claimId = String(c['id'])

    const artifact = expectDispatchOk(await h.callTool('research_artifact_register', {
      workstream_id: 'WS-1', type: 'DATASET', title: 'night-run frames', uri: 'data/night-07/', related_task: 'T-1',
    }, { sessionId: AGENT_SESSION }), 'artifact_register')
    const a = artifact['artifact'] as Record<string, unknown>
    expect(a['created_by_run']).toBe(ids.runId)
    expect(a['status']).toBe('REGISTERED')
    ids.artifactId = String(a['id'])
  })

  it('step 7 · events AND derived rows carry the AGENT/run provenance (no forgery, no drift)', () => {
    const wiring = h.wiring()
    const events = wiring.store.listRange('WS-1', 1)
      .filter((e) => ['FACT_RECORDED', 'CLAIM_RECORDED', 'ARTIFACT_REGISTERED'].includes(e.eventType))
    expect(events.map((e) => e.eventType)).toEqual(['FACT_RECORDED', 'CLAIM_RECORDED', 'ARTIFACT_REGISTERED'])
    for (const ev of events) {
      expect(ev.actor).toEqual({ kind: 'AGENT', run_id: ids.runId, session_id: AGENT_SESSION })
      expect((ev.payload as Record<string, unknown>)['created_by_run']).toBe(ids.runId)
    }
    const state = readSemanticRow(wiring.store, wiring.projectId)!
    expect(state.facts.get(ids.factId)?.created_by_run).toBe(ids.runId)
    expect(state.claims.get(ids.claimId)?.created_by_run).toBe(ids.runId)
    expect(state.artifacts.get(ids.artifactId)?.created_by_run).toBe(ids.runId)
  })
})

describe('G5 §A attention lane (events, rows, refs, optional/multi WS)', () => {
  it('step 8 · next_action_create succeeds with and WITHOUT a workstream (optional WS)', async () => {
    const withWs = expectDispatchOk(await h.callTool('research_next_action_create', {
      workstream_id: 'WS-1', statement: '复核对齐度指标的定义', rationale: '与 T-2 假设相关',
    }, { sessionId: AGENT_SESSION }), 'next_action_create(with ws)')
    expect(withWs['status']).toBe('created')
    const na = withWs['next_action'] as Record<string, unknown>
    expect(na['status']).toBe('PROPOSED')
    expect(na['workstream_id']).toBe('WS-1')
    ids.naId = String(na['id'])

    const bare = expectDispatchOk(await h.callTool('research_next_action_create', {
      statement: '整理 G5 验收遗留问题清单',
    }, { sessionId: AGENT_SESSION }), 'next_action_create(optional ws omitted)')
    expect((bare['next_action'] as Record<string, unknown>)['workstream_id'] ?? null).toBeNull()
  })

  it('step 9 · intervention_create multi-WS + typed refs → OPEN row + INTERVENTION_CREATED event (owner-anchored)', async () => {
    const created = expectDispatchOk(await h.callTool('research_intervention_create', {
      title: '需要人工裁决：night-run 数据集对齐',
      detail: 'F/C 与 T-1 引用冲突，请求人类决定重跑还是弃用',
      workstream_ids: ['WS-1', 'WS-2'],
      source_refs: [
        { kind: 'RUN', id: ids.runId },
        { kind: 'FACT', id: ids.factId },
        { kind: 'WORKSTREAM', id: 'WS-1' },
        { kind: 'WORKSTREAM', id: 'WS-2' },
      ],
    }, { sessionId: AGENT_SESSION }), 'intervention_create(multiWS)')
    expect(created['status']).toBe('created')
    const iv = created['intervention'] as Record<string, unknown>
    expect(iv['origin']).toBe('AGENT_REPORT')
    expect(iv['status']).toBe('OPEN')
    ids.ivId = String(iv['id'])
    expect(created['event_id']).not.toBeNull()

    // row + event landed (event-first, row-second both visible)
    const row = h.wiring().interventions.getIntervention(ids.ivId)
    expect(row).not.toBeNull()
    const events = h.wiring().store.listRange('WS-1', 1).filter((e) => e.eventType === 'INTERVENTION_CREATED')
    expect(events.length).toBe(1)
    // frozen mechanical actorRef shape (§9.2): AGENT(run) — NO session_id
    expect(events[0]!.actor).toEqual({ kind: 'AGENT', run_id: ids.runId })
    const payload = events[0]!.payload as Record<string, unknown>
    const refs = payload['source_refs'] as Array<Record<string, unknown>>
    // the frozen owner-anchor rule: the first WS-bearing ref is the OWNER (WS-1)
    expect(refs[0]).toEqual({ kind: 'WORKSTREAM', id: 'WS-1' })
  })

  it('step 10 · intervention WITHOUT workstream association → row queued, event_id null', async () => {
    const created = expectDispatchOk(await h.callTool('research_intervention_create', {
      title: 'G5 全局提示（无 WS 关联）',
      detail: '验证 event_id null 车道（无事件车道，行仍入队）',
      workstream_ids: [],
      source_refs: [],
    }, { sessionId: AGENT_SESSION }), 'intervention_create(no ws)')
    expect(created['event_id']).toBeNull()
    expect((created['intervention'] as Record<string, unknown>)['status']).toBe('OPEN')
  })
})

describe('G5 §A lifecycle + replay', () => {
  it('step 11 · own-run checkpoint succeeds through the registry', async () => {
    const cp = expectDispatchOk(await h.callTool('research_run_checkpoint', {
      run_id: ids.runId, note: 'G5 真实 registry 闭环检查点',
    }, { sessionId: AGENT_SESSION }), 'run_checkpoint(own run)')
    expect(cp['status']).toBe('ok')
    expect((cp['run'] as Record<string, unknown>)['id']).toBe(ids.runId)
    expect(h.wiring().runBinding.getRun(ids.runId)?.last_checkpoint_note).toBe('G5 真实 registry 闭环检查点')
  })

  it('step 12 · history_query replays the whole run through the registry (envelopes verbatim)', async () => {
    const page = expectDispatchOk(await h.callTool('research_history_query', {
      workstream_id: 'WS-1', limit: 50,
    }, { sessionId: AGENT_SESSION }), 'history_query')
    const events = page['events'] as Array<Record<string, unknown>>
    const types = events.map((e) => e['eventType'])
    expect(types).toEqual(expect.arrayContaining([
      'RUN_STARTED', 'FACT_RECORDED', 'CLAIM_RECORDED', 'ARTIFACT_REGISTERED', 'INTERVENTION_CREATED',
    ]))
    for (const e of events) {
      expect(typeof e['eventSeq']).toBe('number')
      expect(typeof e['eventId']).toBe('string')
      expect(e['ownerWorkstreamId']).toBe('WS-1')
    }
    expect(page['exhausted']).toBe(true)
    // density rule verbatim (G2 §2): an exhausted page carries next_after_seq=null
    expect(page['next_after_seq']).toBeNull()
    // cursor protocol: after_seq at the tail seq = empty page
    const lastSeq = (events[events.length - 1] as Record<string, unknown>)['eventSeq'] as number
    const after = expectDispatchOk(await h.callTool('research_history_query', {
      workstream_id: 'WS-1', after_seq: lastSeq,
    }, { sessionId: AGENT_SESSION }), 'history_query(cursor)')
    expect(after['events']).toEqual([])
    expect(after['exhausted']).toBe(true)
  })

  it('step 13 · contract_read completes the four read tools (TE-2 contract, real codec)', async () => {
    const contract = expectDispatchOk(await h.callTool('research_contract_read', { edge_id: 'TE-2' }, { sessionId: AGENT_SESSION }), 'contract_read')
    expect(contract['status']).toBe('ok')
    expect(String(contract['content'])).toContain('# Merge Contract TE-2')
  })
})
