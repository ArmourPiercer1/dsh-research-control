/**
 * Review item 2 (pinned 0.2.0-rc.2, no LLM, no paid calls) — POSITIVE real
 * register→mount→launch lifecycle through the REAL adapter, with real
 * enforcement, plus the RESUME-shape denial proof.
 *
 * REAL: cordis Context + event dispatch, `ToolRuntime` (@deepseek-ai/dsh-tools),
 * `createScope` (dsh-scope), `AgentRegistry.create` routing (dsh-agent),
 * TypertRegistry / PluginLoader / SessionProjectionRegistry /
 * AgentPresetRegistry, and the REAL preset rows `@deepseek-ai/dsh-tool-bash`
 * + `@deepseek-ai/dsh-tool-fs-search` (activated and mounted — bash/glob/grep
 * enter the agent surface), plus the adapter's own `launchInvestigator`
 * (resolveOrEnsure → agents.create(setupInvestigator = mount+restrict) →
 * `/permission read-only` settle → followup).
 *
 * FAKE (disclosed — host-app faces the pinned packages do not ship
 * standalone; the same seam investigator-restricted.test.ts discloses):
 * systemPrompt (3-member face), shell ({sandboxMode: undefined} — skips the
 * sandboxPolicy requirement, tool-bash index.ts:218-220), shellEnv/subprocess
 * (never touched at activation), commands (recorder), and the AgentLoop
 * FACTORY BODY (real `createScope` + `setup(scope.ctx, agent)` +
 * serial `agent/created` dispatch mirroring core/agent src/index.ts:550 —
 * not the LLM/session loop).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { default as TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { default as PluginLoader } from '@deepseek-ai/cordis-plugin-loader'
import { default as SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { default as AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'

import { HostAgentLauncherAdapter, installInvestigatorRestrictionWatch, restrictInvestigatorCtx } from '../../src/host/dsh-adapter/launcher/index.js'
import type { InvestigatorLaunchRequest } from '../../src/host/service/investigator/index.js'
import {
  INVESTIGATOR_DENIED_TOOL_NAMES,
  INVESTIGATOR_PRESET_ID,
  READ_ONLY_PERMISSION_PRESET,
  investigatorPresetDefinition,
} from '../../src/host/service/investigator/index.js'
import { RESEARCH_TOOL_NAMES } from '../../src/host/tools/index.js'

const WRITE7 = [...INVESTIGATOR_DENIED_TOOL_NAMES]
const READ4 = RESEARCH_TOOL_NAMES.filter((name: string) => !WRITE7.includes(name))

function stubTool(name: string) {
  return {
    name,
    description: `stub ${name}`,
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } },
      render: () => [{ type: 'text', text: name }],
    },
    execute: async () => ({ ok: true }),
  } as never
}

async function boot() {
  const root = new Context()
  const order: string[] = []
  root.provide('systemPrompt', {
    tools: (_cb: unknown) => ({ dispose: () => {} }),
    section: (_s: unknown) => ({ dispose: () => {} }),
    getSectionOrder: (_n: string) => 0,
  })
  root.provide('shell', { sandboxMode: undefined })
  root.provide('shellEnv', { collect: () => ({}) })
  root.provide('subprocess', { spawn: async () => ({ exitCode: 0, stdout: '', stderr: '' }) })
  root.provide('commands', {
    async execute(_agent: unknown, line: string) {
      order.push(`permission:${line}`)
      return { commandId: 'cmd-1', result: { kind: 'success', text: 'ok' } }
    },
  })
  const runtime = new ToolRuntime(root, { mode: 'native' })
  await root.plugin(TypertRegistry)
  await root.plugin(PluginLoader)
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(AgentPresetRegistry, { default: 'standard' })
  const roster = root.get('agentPresets') as {
    resolve(id?: string): Promise<{ id: string; broken?: string }>
    mount(ctx: unknown, id?: string): Promise<unknown>
    register(definition: unknown): Promise<() => Promise<void>>
    readDocument(id: string): Promise<{ content: string }>
  }
  // Wrap mount + restrict so the ORDER and the restrict COUNT are observable
  // without touching production code (the watch dedupe rides the same call).
  const realMount = roster.mount.bind(roster)
  roster.mount = (async (ctx: unknown, id?: string) => {
    await realMount(ctx, id)
    order.push('mount')
  }) as typeof roster.mount
  // NOTE: `runtime.restrict` is NOT wrapped — the scoped call goes through
  // cordis's proxy which binds the agent scope; a plain reassignment loses
  // that and ToolRuntime.restrict throws "requires a scoped context". The
  // restriction's correctness is proven by its EFFECT (writes refused) + the
  // mount→permission→followup order; per-ctx dedupe is a unit concern
  // (dedupe test at the bottom of this file).

  // Disclosed factory seam (see header): real createScope, setup call site,
  // serial `agent/created` dispatch mirroring core/agent src/index.ts:550.
  const registry = new AgentRegistry(root)
  type Minted = {
    agent: { id: string; session: { id: string; meta?: Record<string, unknown> }; followups: unknown[]; followup(m: unknown): void; [k: string]: unknown }
    scope: { ctx: Context; dispose(): Promise<void> }
  }
  const minted: Minted[] = []
  registry.setFactory({
    async createAgent(ownerCtx: Context, options: {
      sessionId: string
      meta?: Record<string, unknown>
      setup?: (ctx: Context, agent: unknown) => Promise<void> | void
    }) {
      const agent: Minted['agent'] = {
        id: options.sessionId,
        session: { id: options.sessionId, meta: { ...(options.meta ?? {}) } },
        followups: [],
        followup(m: unknown) {
          agent.followups.push(m)
          order.push('followup')
        },
      }
      const scope = createScope(ownerCtx, agent)
      agent.ctx = scope.ctx
      await options.setup?.(scope.ctx, agent)
      minted.push({ agent, scope })
      // agent/created fires after setup completes, before any work runs.
      await (root as unknown as {
        serial(carrier: unknown, name: string, payload: unknown): Promise<unknown>
      }).serial(scope.ctx, 'agent/created', { agent, source: options.meta?.source ?? 'startup' })
      return {
        agent,
        dispose: async () => {
          await scope.dispose()
        },
      }
    },
    async resume() {
      throw new Error('unused in this suite')
    },
  } as never)

  const patched = {
    get: (name: string) => (root as unknown as { get(n: string): unknown }).get(name),
    effect: async (execute: () => unknown) => {
      const produced = (await (execute as () => unknown)()) as (() => void | Promise<void>) | void
      return async () => {
        if (typeof produced === 'function') await produced()
      }
    },
  }
  const adapter = new HostAgentLauncherAdapter(patched as never)
  const watchCtx = () => ({
    get: (name: string) => (root as unknown as { get(n: string): unknown }).get(name),
    on: (event: string, listener: (p: { agent: unknown }) => void, opts?: { global?: boolean }) =>
      (root as unknown as { on(n: string, l: unknown, o?: unknown): () => void }).on(event, listener, opts),
  })
  return { root, roster, runtime, registry, adapter, watchCtx, order, minted }
}

async function executeTool(runtime: ToolRuntime, name: string, agent: unknown) {
  return await (runtime as unknown as {
    execute(exec: unknown): Promise<{
      isError: boolean
      value?: unknown
      error?: { info?: { code?: string }; code?: string }
    }>
  }).execute({
    callId: ToolCallId(`lifecycle-${name}-${Math.random()}`),
    name,
    arguments: {},
    signal: new AbortController().signal,
    agent,
  })
}

const REQUEST: InvestigatorLaunchRequest = {
  presetId: INVESTIGATOR_PRESET_ID,
  permissionPreset: READ_ONLY_PERMISSION_PRESET,
  cwd: '/ws/project',
  task: '生命周期验收：只读 investigator',
}

let h: Awaited<ReturnType<typeof boot>> | undefined
let unregister: (() => Promise<void>) | undefined

afterEach(async () => {
  await unregister?.().catch(() => undefined)
  unregister = undefined
  await h?.root.fiber.dispose()
  h = undefined
})

describe('review item 2 — real register→mount→launch lifecycle (adapter-driven)', () => {
  it('POSITIVE: REAL rows activate & mount; adapter order mount→restrict→/permission→followup; 7 writes ENFORCED; dispose unwinds', async () => {
    h = await boot()
    const watchDisposer = installInvestigatorRestrictionWatch(h.watchCtx() as never)
    for (const name of [...WRITE7, ...READ4]) h.runtime.register(stubTool(name))
    unregister = await h.roster.register(investigatorPresetDefinition())
    // THE crux: the real rows activate (packages resolve from the worktree).
    const resolved = await h.roster.resolve(INVESTIGATOR_PRESET_ID)
    expect(resolved).toEqual({ id: INVESTIGATOR_PRESET_ID })

    const result = await h.adapter.launchInvestigator(REQUEST)
    expect(result.presetId).toBe(INVESTIGATOR_PRESET_ID)
    const agent = h.minted[0]?.agent
    expect(agent, 'agent minted').toBeDefined()

    // Order, end to end (adapter-owned, not replayed).
    expect(h.order).toEqual(['mount', `permission:/permission ${READ_ONLY_PERMISSION_PRESET}`, 'followup'])
    // Setup ran mount THEN restrict synchronously (module order); /permission
    // and followup are strictly after agents.create returned. The agent/created
    // watch then fired on the SAME scoped ctx and deduped (restrictInvestigatorCtx
    // returns false) — see the dedupe unit test below for that primitive.
    expect(restrictInvestigatorCtx(agent!.ctx as never), 'launch setup already restricted this scoped ctx').toBe(false)
    watchDisposer()
    // The task was queued verbatim, once.
    expect(agent?.followups).toHaveLength(1)
    expect((agent?.followups[0] as { content?: Array<{ text?: string }> }).content?.[0]?.text).toBe(REQUEST.task)

    // Visible surface: preset rows mounted + 4 reads kept, 7 writes gone.
    const visible = (h.runtime as unknown as { schemas(a: unknown): Array<{ name: string }> }).schemas(agent).map((s) => s.name)
    for (const mounted of ['bash', 'glob', 'grep']) expect(visible, `mounted ${mounted}`).toContain(mounted)
    for (const read of READ4) expect(visible, `read ${read}`).toContain(read)
    for (const write of WRITE7) expect(visible, `write ${write} hidden`).not.toContain(write)

    // ENFORCEMENT at execute: reads run, writes refused with UNKNOWN_TOOL.
    for (const name of READ4) {
      const ran = await executeTool(h.runtime, name, agent)
      expect(ran.isError, `read ${name} runs`).toBe(false)
      expect(ran.value).toEqual({ ok: true })
    }
    for (const name of WRITE7) {
      const refused = await executeTool(h.runtime, name, agent)
      expect(refused.isError, `write ${name} refused`).toBe(true)
      expect(refused.error?.info?.code ?? refused.error?.code, `write ${name} code`).toBe('UNKNOWN_TOOL')
    }

    // CONTROL: an unrestricted scoped agent runs the same write tool.
    const control: Record<string, unknown> = { id: 'ctrl', session: { id: 'ctrl' } }
    const controlScope = createScope(h.root, control)
    try {
      const open = await executeTool(h.runtime, WRITE7[0]!, control)
      expect(open.isError).toBe(false)
    } finally {
      await controlScope.dispose()
    }

    // Dispose: the factory handle unwinds the agent scope without throwing.
    // (Scoped-tool teardown is host-internal; the plugin-meaningful dispose
    // semantics — ctx.effect registration lease ⇒ unload = real unregister,
    // clean re-register — are pinned in investigator-preset-registry.test.ts.)
    await expect(h.minted[0]?.scope.dispose()).resolves.toBeUndefined()
  }, 30000)

  it('RESUME shape (host setup = mount only): the agent/created watch restores deny-7; WITHOUT the watch the gap is real (existing-debt evidence)', async () => {
    h = await boot()
    for (const name of [...WRITE7, ...READ4]) h.runtime.register(stubTool(name))
    unregister = await h.roster.register(investigatorPresetDefinition())

    // ── Gap WITHOUT the watch (the pre-fix / launch-time-only behavior —
    // marks the EXISTING DEBT honestly: host resume setup only does
    // selection+mount, api/session-controller/src/agent.ts:391-395):
    const bare = await h.registry.create({
      sessionId: 'investigator-resume-bare',
      meta: { cwd: '/ws', agentPreset: INVESTIGATOR_PRESET_ID, source: 'resume' },
      setup: (agentCtx: Context) => h!.roster.mount(agentCtx, INVESTIGATOR_PRESET_ID),
    } as never)
    const bareAgent = bare.agent as unknown as Record<string, unknown>
    const bareVisible = (h.runtime as unknown as { schemas(a: unknown): Array<{ name: string }> }).schemas(bareAgent).map((s) => s.name)
    for (const read of READ4) expect(bareVisible, `bare read ${read}`).toContain(read)
    for (const write of WRITE7) expect(bareVisible, `bare write ${write} VISIBLE without watch`).toContain(write)
    const bareWrite = await executeTool(h.runtime, WRITE7[0]!, bareAgent)
    expect(bareWrite.isError, 'write EXECUTES without the watch — the debt').toBe(false)
    await bare.dispose()

    // ── WITH the watch (the fix): same mount-only resume → watch applies
    // deny-7 at agent/created → 4 reads work, all 7 writes refused.
    const watchDisposer = installInvestigatorRestrictionWatch(h.watchCtx() as never)
    try {
      const fixed = await h.registry.create({
        sessionId: 'investigator-resume-fixed',
        meta: { cwd: '/ws', agentPreset: INVESTIGATOR_PRESET_ID, source: 'resume' },
        setup: (agentCtx: Context) => h!.roster.mount(agentCtx, INVESTIGATOR_PRESET_ID),
      } as never)
      const fixedAgent = fixed.agent as unknown as Record<string, unknown>
      const fixedVisible = (h.runtime as unknown as { schemas(a: unknown): Array<{ name: string }> }).schemas(fixedAgent).map((s) => s.name)
      for (const read of READ4) expect(fixedVisible, `watched read ${read}`).toContain(read)
      for (const write of WRITE7) expect(fixedVisible, `watched write ${write} hidden`).not.toContain(write)
      for (const name of READ4) expect((await executeTool(h.runtime, name, fixedAgent)).isError).toBe(false)
      for (const name of WRITE7) {
        const refused = await executeTool(h.runtime, name, fixedAgent)
        expect(refused.isError, `watched write ${name} refused`).toBe(true)
        expect(refused.error?.info?.code ?? refused.error?.code).toBe('UNKNOWN_TOOL')
      }
      await fixed.dispose()

      // A FOREIGN (non-investigator) session through agent/created is untouched.
      const foreign = await h.registry.create({
        sessionId: 'standard-resume',
        meta: { cwd: '/ws', agentPreset: 'standard', source: 'resume' },
        setup: async () => {},
      } as never)
      const foreignVisible = (h.runtime as unknown as { schemas(a: unknown): Array<{ name: string }> }).schemas(foreign.agent as unknown as Record<string, unknown>).map((s) => s.name)
      for (const write of WRITE7) expect(foreignVisible, `foreign write ${write} untouched`).toContain(write)
      await foreign.dispose()
    } finally {
      watchDisposer()
    }
  }, 30000)
})

describe('review item 2 — dedupe primitive (per-scoped-ctx WeakSet)', () => {
  it('restrictInvestigatorCtx applies once, then no-ops on the same ctx; different ctx re-applies', () => {
    let calls = 0
    const mk = () => ({ tools: { restrict: () => { calls += 1 } } })
    const ctxA = mk()
    expect(restrictInvestigatorCtx(ctxA as never)).toBe(true)
    expect(restrictInvestigatorCtx(ctxA as never)).toBe(false)
    expect(restrictInvestigatorCtx(mk() as never)).toBe(true)
    expect(calls).toBe(2)
  })
})
