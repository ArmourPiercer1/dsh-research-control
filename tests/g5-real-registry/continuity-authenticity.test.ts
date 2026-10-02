/**
 * G5 §C — continuity, restart and registry authenticity through the
 * REAL registry (+ the kept G4 post-boot regressions re-run one level
 * UP, on the real ToolRuntime lane).
 *
 *  1. REGISTRY AUTHENTICITY PROBE — negative controls proving the
 *     gates in this suite are the real pinned dsh-tools machinery:
 *     a schema outside the supported subset is REFUSED at register,
 *     a value violating its declared output schema folds into
 *     `INVALID_TOOL_OUTPUT` (ToolOutputError) — the exact validator
 *     our 11 tools' successes passed.
 *  2. RESCAN CONTINUITY — the production mutation path (`rescan({})`)
 *     swaps a fresh wiring under the SAME registry registration (live
 *     dispatch, G1): the same registered defs keep succeeding after
 *     rescan, registration count stays 11, the boot wiring is truly
 *     closed.
 *  3. RESTART SEMANTICS — full host close (every effect disposer run:
 *     wiring + stores + rpc second connections) then a NEW root
 *     Context + a NEW ToolRuntime + a NEW ResearchControlService over
 *     the SAME temp workspace: the persisted state (runs/events/
 *     semantic rows) is visible and the tools CONTINUE (fresh
 *     allocator ids prove the sqlite meta survived).
 *  4. G4 post-boot regressions on the real registry lane: GUI-created
 *     task resolvable WITHOUT rescan; a deleted task file refuses
 *     new refs (current tree = sole authority) with zero side effects.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { rmSync, writeFileSync } from 'node:fs'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { join } from 'node:path'

import {
  bootRealRegistryHarness,
  expectDispatchErr,
  expectDispatchOk,
  g5CleanupAll,
  type RealRegistryHarness,
} from '../helpers/real-registry-host.js'
import { USER } from '../wiring/helpers.js'
import { readSemanticRow } from '../semantics-records/harness.js'

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})
afterEach(() => logSpy.mockClear())
afterAll(async () => {
  logSpy.mockRestore()
  await g5CleanupAll()
})

describe('G5 §C.1 registry authenticity probe (negative controls)', () => {
  it('the pinned registry rejects an unsupported output schema at registration and an invalid success value at dispatch', async () => {
    const h = await bootRealRegistryHarness()
    try {
      // The 11 real registrations already passed `assertSupportedJsonSchema`
      // inside ToolRuntime.register — probe the SAME gate with an
      // unsupported construct ($ref is outside the enforced subset):
      const runtime = h.runtime
      expect(() =>
        runtime.register({
          name: 'g5_probe_bad_schema',
          description: 'x',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          output: {
            schema: { $ref: '#/definitions/X', definitions: { X: { type: 'object' } } } as never,
            render: () => [],
          },
          execute: async () => ({}),
        }),
      ).toThrow()

      // A well-formed definition whose VALUE violates its own schema must
      // fold into INVALID_TOOL_OUTPUT (the real validateJsonSchemaValue).
      runtime.register({
        name: 'g5_probe_bad_value',
        description: 'x',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['status'],
            properties: { status: { type: 'string', const: 'ok' } },
          },
          render: () => [{ type: 'text', text: 'x' }],
        },
        execute: async () => ({ status: 'NOT-OK' }),
      })
      const r = (await runtime.execute({
        callId: ToolCallId('g5-probe-1'),
        name: 'g5_probe_bad_value',
        arguments: {},
        signal: new AbortController().signal,
      })) as { isError: boolean; error?: { info?: { code?: string } } }
      expect(r.isError).toBe(true)
      expect(r.error?.info?.code).toBe('INVALID_TOOL_OUTPUT')

      // The probe registered exactly ONE extra tool (bad schema never landed).
      expect(runtime.schemas().length).toBe(12)
    } finally {
      await h.dispose()
    }
  }, 60_000)
})

describe('G5 §C.2 rescan continuity (production mutation path, same registry)', () => {
  it('tools keep succeeding through the SAME registration after rescan; count stays 11; boot wiring truly closed', async () => {
    const h = await bootRealRegistryHarness()
    try {
      const boot = h.wiring()
      const runA = boot.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g5c-a' }, USER).run
      expectDispatchOk(await h.callTool('research_plan_get', { workstream_id: 'WS-1' }, { sessionId: 'sess-g5c-a' }), 'plan_get(boot)')

      const rescan = await h.svc.rescan({})
      expect(rescan.projects.length).toBe(1)

      // registration identity: same defs, still 11 (live dispatch, NOT re-registration)
      expect(h.runtime.schemas().length).toBe(11)

      // boot wiring really closed
      expect(() => boot.tables.getRun(runA.id)).toThrow()

      // the SAME registry-registered defs now run on the FRESH wiring
      const fresh = h.wiring()
      expect(fresh).not.toBe(boot)
      expect(fresh.runBinding.getRun(runA.id)?.dsh_session_id).toBe('sess-g5c-a')
      const cp = expectDispatchOk(await h.callTool('research_run_checkpoint', { run_id: runA.id, note: 'G5 rescan 后续写' }, { sessionId: 'sess-g5c-a' }), 'run_checkpoint(post-rescan)')
      expect((cp['run'] as Record<string, unknown>)['id']).toBe(runA.id)
      const fact = expectDispatchOk(await h.callTool('research_fact_record', { workstream_id: 'WS-1', statement: 'fresh wiring 续写' }, { sessionId: 'sess-g5c-a' }), 'fact_record(post-rescan)')
      expect((fact['fact'] as Record<string, unknown>)['created_by_run']).toBe(runA.id)
    } finally {
      await h.dispose()
    }
  }, 90_000)
})

describe('G5 §C.3 restart semantics (full close → fresh Context + registry + host over the same state)', () => {
  it('persisted runs/events/semantic rows survive the restart and the tools CONTINUE (allocator + planfork state intact)', async () => {
    // ── life #1
    const first = await bootRealRegistryHarness()
    const paths = first.workspacePaths
    const run = first.wiring().runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g5c-r' }, USER).run
    expectDispatchOk(await first.callTool('research_fact_record', { workstream_id: 'WS-1', statement: '重启前事实' }, { sessionId: 'sess-g5c-r' }), 'fact_record(pre-restart)')
    const pf = expectDispatchOk(await first.callTool('research_plan_fork_create', {
      workstream_id: 'WS-1',
      fork_anchor: 'T-1',
      merge_anchor: 'T-1',
      proposed_items: [{ action: 'NEW', kind: 'TASK', spec: { title: '重启前 fork', goal: 'g' } }],
      trigger_refs: [{ kind: 'MILESTONE', id: 'M-1' }],
      reason: 'restart 语义验证：持久化 fork',
      necessity: '验证重启后 PF 状态可读',
    }, { sessionId: 'sess-g5c-r' }), 'plan_fork_create(pre-restart)')
    const pfId = String((pf['plan_fork'] as Record<string, unknown>)['id'])
    await first.dispose()
    // the closed boot store must be truly closed:
    expect(() => first.wiring().tables.getRun(run.id)).toThrow()

    // ── life #2 (NEW process-like world: new Context, new ToolRuntime, new host)
    const second = await bootRealRegistryHarness(paths)
    try {
      expect(second.runtime.schemas().length).toBe(11)
      // persisted state visible
      const ctx = expectDispatchOk(await second.callTool('research_context_get', {}, { sessionId: 'sess-g5c-r' }), 'context_get(post-restart)')
      expect(ctx['bound']).toBe(true)
      expect((ctx['run'] as Record<string, unknown>)['id']).toBe(run.id)

      const page = expectDispatchOk(await second.callTool('research_history_query', { workstream_id: 'WS-1' }, { sessionId: 'sess-g5c-r' }), 'history_query(post-restart)')
      const types = (page['events'] as Array<Record<string, unknown>>).map((e) => e['eventType'])
      expect(types).toEqual(expect.arrayContaining(['RUN_STARTED', 'FACT_RECORDED']))

      const row = readSemanticRow(second.wiring().store, second.wiring().projectId)
      expect([...(row?.facts.values() ?? [])].some((f) => f.statement === '重启前事实')).toBe(true)
      expect(second.wiring().planForks.getPlanFork(pfId)?.status).toBe('OPEN')

      // tools CONTINUE — allocator ids keep counting (sqlite meta survived)
      const fact = expectDispatchOk(await second.callTool('research_fact_record', { workstream_id: 'WS-1', statement: '重启后续写' }, { sessionId: 'sess-g5c-r' }), 'fact_record(post-restart)')
      expect(String((fact['fact'] as Record<string, unknown>)['id'])).toBe('F-2')
      expect(String((fact['fact'] as Record<string, unknown>)['created_by_run'])).toBe(run.id)
    } finally {
      await second.dispose()
    }
  }, 120_000)
})

describe('G5 §C.4 kept G4 regressions on the real-registry lane', () => {
  it('GUI-created task resolves WITHOUT rescan; a deleted task refuses new refs (zero side effects); surviving tasks stay usable', async () => {
    const h = await bootRealRegistryHarness()
    try {
      h.wiring().runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g5c-d' }, USER)

      // ① GUI plan-editor lane adds a task (rpc createPlanItem — no rewire)
      const created = await h.svc.createPlanItem({
        workstreamId: 'WS-1',
        kind: 'TASK',
        item: { task: { title: '复测 p95 抖动', goal: '确认抖动根因' } },
      })
      const newTaskId = created.itemId
      const rowsBefore = h.wiring().interventions.listInterventions().length
      const evBefore = h.wiring().store.listRange('WS-1', 1).length

      const freshRef = expectDispatchOk(await h.callTool('research_intervention_create', {
        title: '新任务前置假设需人工确认（无 rescan）',
        workstream_ids: ['WS-1'],
        source_refs: [{ kind: 'TASK', id: newTaskId }],
      }, { sessionId: 'sess-g5c-d' }), 'intervention(ref fresh task)')
      expect(freshRef['status']).toBe('created')
      expect(freshRef['event_id']).not.toBeNull()

      // ② boot-legal T-1 is deleted from the CURRENT tree → new refs to it
      //    must be refused (current tree = sole authority, no boot fallback)
      const wsRoot = h.workspacePaths[1]!
      const t1 = join(wsRoot, '.research', 'topics', 'TPC-1', 'workstreams', 'WS-1', 'items', 'tasks', 'T-1.yaml')
      rmSync(t1)
      const rowsMid = h.wiring().interventions.listInterventions().length
      const evMid = h.wiring().store.listRange('WS-1', 1).length
      const refused = await h.callTool('research_intervention_create', {
        title: '对已删除 T-1 的引用必须被拒',
        workstream_ids: ['WS-1'],
        source_refs: [{ kind: 'TASK', id: 'T-1' }],
      }, { sessionId: 'sess-g5c-d' })
      expectDispatchErr(refused, 'TOOL_SERVICE', 'IV_INPUT')
      expect(h.wiring().interventions.listInterventions().length).toBe(rowsMid)
      expect(h.wiring().store.listRange('WS-1', 1).length).toBe(evMid)

      // ③ a SURVIVING task stays usable (no blanket fail-closed)
      const ok2 = expectDispatchOk(await h.callTool('research_intervention_create', {
        title: '存活任务的引用照常通过',
        workstream_ids: ['WS-1'],
        source_refs: [{ kind: 'TASK', id: newTaskId }],
      }, { sessionId: 'sess-g5c-d' }), 'intervention(surviving task)')
      expect(ok2['status']).toBe('created')

      // and a GATE whose doc is corrupted (id invalid) loses existence (§5e guard)
      writeFileSync(join(wsRoot, '.research', 'topics', 'TPC-1', 'workstreams', 'WS-1', 'items', 'gates', 'G-1.yaml'), 'id: 123\nworkstream_id: WS-1\n', 'utf8')
      const refusedGate = await h.callTool('research_intervention_create', {
        title: '改坏 GATE 的引用必须被拒',
        workstream_ids: ['WS-1'],
        source_refs: [{ kind: 'GATE', id: 'G-1' }],
      }, { sessionId: 'sess-g5c-d' })
      expectDispatchErr(refusedGate, 'TOOL_SERVICE', 'IV_INPUT')

      // side-effect ledger: ①③ produced exactly 2 rows + 2 events; ②④ zero.
      expect(h.wiring().interventions.listInterventions().length).toBe(rowsBefore + 2)
    } finally {
      await h.dispose()
    }
  }, 90_000)
})
