/**
 * G5 §D — the RESTRICTED Investigator scope, end to end through the
 * REAL registry (distinct from the run-less §B.2 persona).
 *
 * Production composition replayed here (Gate P7 二 — INV-PERM-3):
 *   real `HostAgentLauncherAdapter.launchInvestigator` → the host agent
 *   factory seam (`agents.create({ sessionId, meta, setup })`) mints the
 *   agent scope with the REAL `@deepseek-ai/dsh-scope` `createScope`
 *   (the same function the DSH agent factory uses) → `setupInvestigator`
 *   calls `agentCtx.tools.restrict({ deny: INVESTIGATOR_DENIED_TOOL_NAMES })`
 *   ON THE REAL ToolRuntime SCOPE (registry restriction layer, no fake
 *   deny-list involved — the restriction lives inside the registry's own
 *   scoped-layers machinery).
 *
 * The INVESTIGATOR SESSION IS GIVEN A FORMAL RUN (USER lane, like any
 * operator-launched session) so a refused write can NEVER be attributed
 * to the run gate: the refusal must come from the registry restriction
 * (UNKNOWN_TOOL — the name is not in the agent's visible surface at
 * all), and the CONTROL agent (no restriction, same plane, its own run)
 * proves the same write SUCCEEDS in the same state.
 *
 * REAL: HostAgentLauncherAdapter (plugin source, unpatched), dsh-scope
 * createScope (the pinned package dsh-tools itself imports — resolved
 * through dsh-tools' dependency view, same instance, disclosed), the
 * ToolRuntime scope restriction + schemas(scope) masking + dispatch
 * folding, the plugin host + registry + stores underneath.
 * SIMULATED (disclosed — host-app capabilities the pinned packages do
 * not ship standalone): the `agents` registry (`agents.create` here
 * mints the scope the same way and hands the setup callback the real
 * scoped ctx), the `commands` runtime (records the mandatory
 * `/permission read-only` settlement — the permission-preset ENFORCEMENT
 * layer lives in the host app; the plugin-side registry layer proven
 * HERE is the restriction half, per INV-PERM-3's layered design), and
 * and, for the 0.2.0-rc.2 fail-loud tightening (no roster = the closed
 * read-only composition cannot be proven = refusal), a MINIMAL SIMULATED
 * `agentPresets` roster (declared row + frozen-render readDocument — the
 * mount is a recorded no-op here: the preset ROW composition is not what
 * §D proves; the REAL roster surface is covered by
 * investigator-preset-registry.test.ts and the real-host e2e).
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import {
  bootRealRegistryHarness,
  expectDispatchErr,
  expectDispatchOk,
  g5CleanupAll,
  g5RealScopeLib,
  type RealRegistryHarness,
  type RealScope,
} from '../helpers/real-registry-host.js'
import { HostAgentLauncherAdapter } from '../../src/host/dsh-adapter/launcher/index.js'
import { INVESTIGATOR_DENIED_TOOL_NAMES, INVESTIGATOR_PRESET_ID, READ_ONLY_PERMISSION_PRESET, renderInvestigatorPresetComposition } from '../../src/host/service/investigator/index.js'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { USER } from '../wiring/helpers.js'

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
const WIRE_ARGS: Record<string, Record<string, unknown>> = {
  research_context_get: {},
  research_plan_get: { workstream_id: 'WS-1' },
  research_history_query: { workstream_id: 'WS-1' },
  research_contract_read: { edge_id: 'TE-2' },
  research_fact_record: { workstream_id: 'WS-1', statement: '受限 Investigator 不应写入' },
  research_claim_record: { workstream_id: 'WS-1', statement: '受限 Investigator 不应写入' },
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
}

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'warn').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})
afterEach(() => logSpy.mockClear())
afterAll(async () => {
  logSpy.mockRestore()
  await g5CleanupAll()
})

interface Minted {
  sessionId: string
  agentKey: Record<string, unknown>
  scope: RealScope
}

describe('G5 §D real restricted Investigator (adapter + scoped tools.restrict on the real registry)', () => {
  it('formally-run investigator agent: 4 reads visible/succeed, 7 writes unavailable via the REGISTRY RESTRICTION (not the run gate), control agent writes fine', async () => {
    const h = await bootRealRegistryHarness()
    const minted: Minted[] = []
    const permissionLines: string[] = []
    try {
      const scopeLib = await g5RealScopeLib()

      // ── SIMULATED host-app faces (disclosed in the module header) ──
      // The agent factory seam: mint the scope exactly as the production
      // factory does (real dsh-scope createScope under the SAME root
      // context) and hand setup the real scoped ctx.
      const fakeAgents = {
        async create(req: {
          sessionId: string
          meta: Record<string, unknown>
          setup: (agentCtx: unknown) => void | Promise<void>
        }): Promise<{ agent: Record<string, unknown> }> {
          const agentKey: Record<string, unknown> = {
            sessionId: req.sessionId,
            followup: async (): Promise<void> => {},
          }
          const scope = scopeLib.createScope(h.root, agentKey)
          await req.setup(scope.ctx)
          minted.push({ sessionId: req.sessionId, agentKey, scope })
          return { agent: agentKey }
        },
      }
      // The command runtime seam: the adapter REQUIRES the /permission
      // read-only settlement to succeed (IVL_PERMISSION otherwise) —
      // record the exact command line it settles.
      const fakeCommands = {
        async execute(_agent: unknown, line: string): Promise<{ result: { kind: string; text: string } }> {
          permissionLines.push(line)
          return { result: { kind: 'success', text: `settled: ${line}` } }
        },
      }
      h.root.provide('agents', fakeAgents)
      h.root.provide('commands', fakeCommands)
      // 0.2 收紧后的最小 SIMULATED roster（披露见文件头）: 行已声明 +
      // readDocument = 冻结渲染（闭集门照常执行）; mount 为记录性 no-op
      // — §D 的证明对象是 restriction 层, 不是 preset 行组合本身。
      const presetMounts: string[] = []
      h.root.provide('agentPresets', {
        async resolve() { return { id: INVESTIGATOR_PRESET_ID } },
        async list() { return [{ id: INVESTIGATOR_PRESET_ID }] },
        async register() { throw new Error(`Duplicate agent preset: ${INVESTIGATOR_PRESET_ID}`) },
        async readDocument() {
          return { agentPreset: INVESTIGATOR_PRESET_ID, content: renderInvestigatorPresetComposition(INVESTIGATOR_PRESET_ID) }
        },
        async mount(_agentCtx: unknown, id?: string) { presetMounts.push(id ?? ''); return { id: id ?? '' } },
      })

      // ── REAL adapter: one launch, production order ──
      const adapter = new HostAgentLauncherAdapter(
        h.root as unknown as ConstructorParameters<typeof HostAgentLauncherAdapter>[0],
      )
      const launch = await adapter.launchInvestigator({
        presetId: INVESTIGATOR_PRESET_ID,
        permissionPreset: READ_ONLY_PERMISSION_PRESET,
        cwd: h.workspacePaths[1]!,
        task: 'G5 §D：真实受限 Investigator 验收',
      })
      expect(adapter.lastPresetEnsure).toBe('present')
      expect(presetMounts).toEqual([INVESTIGATOR_PRESET_ID])
      expect(permissionLines).toEqual(['/permission read-only'])
      expect(minted).toHaveLength(1)
      const inv = minted[0]!
      expect(inv.sessionId).toBe(launch.sessionId)

      // ── deny list = exactly the 7 write tools (source pin) ──
      expect([...INVESTIGATOR_DENIED_TOOL_NAMES].sort()).toEqual([...WRITE_7].sort())

      // ── FORMAL RUN bound for the investigator session (USER lane) ──
      // From here the run gate is SATISFIED for this session: any write
      // refusal is provably NOT TOOL_RUN_REQUIRED.
      const invRun = h.wiring().runBinding.registerRun(
        { workstreamId: 'WS-1', dshSessionId: launch.sessionId },
        USER,
      ).run
      expect(invRun.id).toMatch(/^R-[1-9][0-9]*$/)

      // ── (1) visible surface under the RESTRICTED scope ──
      const visible = h.runtime.schemas(inv.agentKey as never).map((s) => s.name).filter((n) => n.startsWith('research_'))
      expect(visible.sort()).toEqual([...READ_4].sort())
      for (const denied of WRITE_7) expect(visible).not.toContain(denied)

      // ── (2) the 4 reads SUCCEED through real dispatch (agent scope) ──
      for (const name of READ_4) {
        const r = (await h.runtime.execute({
          callId: ToolCallId(`g5d-read-${name}`),
          name,
          arguments: WIRE_ARGS[name],
          signal: new AbortController().signal,
          agent: inv.agentKey as never,
        })) as Parameters<typeof expectDispatchOk>[0]
        expectDispatchOk(r, `restricted read ${name}`)
      }

      // ── (3) the 7 writes are UNAVAILABLE: registry restriction,
      //        machine code UNKNOWN_TOOL (ToolNotFoundError — the name
      //        is absent from this scope's visible surface) ──
      for (const name of WRITE_7) {
        const r = (await h.runtime.execute({
          callId: ToolCallId(`g5d-write-${name}`),
          name,
          arguments: WIRE_ARGS[name],
          signal: new AbortController().signal,
          agent: inv.agentKey as never,
        })) as Parameters<typeof expectDispatchErr>[0]
        expectDispatchErr(r, 'UNKNOWN_TOOL', name)
        const info = (r.error as { info?: { name?: string } }).info
        expect(info?.name, `${name}: refusal must come from the registry restriction (ToolNotFoundError), not a lane error`).toBe('ToolNotFoundError')
      }
      // the investigator session recorded NOTHING beyond its own
      // RUN_STARTED (emitted by the USER-lane registerRun, actor = USER
      // per §6): no AGENT-run event exists for the run — every refused
      // write left no trace.
      const invEvents = h.wiring().store.listRange('WS-1', 1).filter(
        (e) => (e.actor as unknown as Record<string, unknown>)['run_id'] === invRun.id,
      )
      expect(invEvents).toHaveLength(0)
      const runStarted = h.wiring().store.listRange('WS-1', 1).filter(
        (e) => e.eventType === 'RUN_STARTED' && JSON.stringify(e.payload).includes(invRun.id),
      )
      expect(runStarted).toHaveLength(1)

      // ── (4) CONTROL: unrestricted agent session, its own formal run,
      //        the SAME write succeeds — the refusal above is the
      //        restriction, never the run gate ──
      const ctl = h.wiring().runBinding.registerRun(
        { workstreamId: 'WS-1', dshSessionId: 'sess-g5d-control' },
        USER,
      ).run
      const fact = expectDispatchOk(await h.callTool('research_fact_record', { workstream_id: 'WS-1', statement: '对照：未受限 run 照常可写' }, { sessionId: 'sess-g5d-control' }), 'control write')
      expect((fact['fact'] as Record<string, unknown>)['created_by_run']).toBe(ctl.id)
    } finally {
      for (const m of minted) await m.scope.dispose()
      await h.dispose()
    }
  }, 120_000)

  it('lifting the restriction (scope disposer) restores the full 11-name surface — the denial boundary IS the scope layer', async () => {
    const h = await bootRealRegistryHarness()
    try {
      const scopeLib = await g5RealScopeLib()
      const agentKey = { sessionId: 'sess-g5d-lift', followup: async (): Promise<void> => {} }
      const scope = scopeLib.createScope(h.root, agentKey)
      const lift = (scope.ctx as unknown as { tools: { restrict: (f: { deny: readonly string[] }) => () => void } })
        .tools.restrict({ deny: [...INVESTIGATOR_DENIED_TOOL_NAMES] })
      const research = (): string[] => h.runtime.schemas(agentKey as never).map((s) => s.name).filter((n) => n.startsWith('research_'))
      expect(research()).toHaveLength(4)
      lift()
      expect(research().sort()).toEqual([...READ_4, ...WRITE_7].sort())
      await scope.dispose()
    } finally {
      await h.dispose()
    }
  }, 60_000)
})
