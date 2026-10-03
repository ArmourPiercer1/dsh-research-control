/**
 * R3 (reviewer convergence) — REAL lifecycle for the investigator SAFETY
 * row (pinned 0.2.0-rc.2, no LLM, no paid calls).
 *
 * The retired design patched deny-7 from OUTSIDE (a global `agent/created`
 * watch + WeakSet + preset identity guessing) and MISSED the host's real
 * lifecycles (cold resume runs setup = selection+mount only; a blank
 * `select`/`recompose` fires no `agent/created`). The convergence: the
 * closed composition's FIRST row is the dedicated safety plugin; agents are
 * parented to the preset's STANDING scope (agent-preset-registry
 * `standingMountFor`), so guard + visibility are inherited by every joined
 * agent — create, cold resume, blank recompose — and DETACH on leave.
 *
 * REAL: cordis Context + event dispatch, `ToolRuntime` (@deepseek-ai/dsh-tools),
 * `createScope` (dsh-scope), `AgentRegistry.create` routing (dsh-agent),
 * TypertRegistry / PluginLoader / SessionProjectionRegistry /
 * AgentPresetRegistry, the REAL preset rows `@deepseek-ai/dsh-tool-bash` +
 * `@deepseek-ai/dsh-tool-fs-search` (activated and mounted), the REAL
 * `dsh-research-control/investigator-safety` row CLASS (mounted through the
 * loader's `internal.import` seam — on the bench the same row resolves as
 * the installed package subpath; the unit harness supplies the class
 * through the host-shaped internal loader, mirroring app-boot's
 * HostResolvedRootInclude), the adapter's own `launchInvestigator`
 * (mount → `/permission read-only` settle → followup), and REAL
 * ToolRuntime dispatch (guard + restriction evaluated by the registry).
 *
 * FAKE (disclosed): systemPrompt (3-member face), the shell executor face
 * ({sandboxMode: 'workspace-write'} — a WRITABLE deployment default, the
 * reviewer's standing condition), shellEnv/subprocess (never touched),
 * sandboxPolicy (a mode map keyed by session: `/permission read-only`
 * commits like the durable `sandbox/mode` event does), commands (recorder
 * + mode commit), and the AgentLoop FACTORY BODY (real `createScope` +
 * `setup(scope.ctx, agent)` + serial `agent/created` dispatch mirroring
 * core/agent src/index.ts:550 — not the LLM/session loop).
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

import { HostAgentLauncherAdapter } from '../../src/host/dsh-adapter/launcher/index.js'
import InvestigatorSafety from '../../src/host/dsh-adapter/investigator-safety/index.js'
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
  // WRITABLE deployment default (the reviewer's standing condition): the
  // executor DOES sandbox (defined mode) — the session override is what
  // makes an investigator read-only.
  root.provide('shell', { sandboxMode: 'workspace-write' })
  root.provide('shellEnv', { collect: () => ({}) })
  root.provide('subprocess', { spawn: async () => ({ exitCode: 0, stdout: '', stderr: '' }) })
  // Session-scoped mode map — the fake stands in for the durable
  // `sandbox/mode` event log (permissionPresets writes durable events; a
  // resumed session's log already carries read-only). NOT a per-selection
  // sneaky write: entries appear only through the /permission command.
  const sessionModes = new Map<string, string>()
  root.provide('sandboxPolicy', {
    defaultMode: 'workspace-write',
    resolve: (request: { session?: { id?: string } }) => ({
      mode: request.session?.id === undefined ? undefined : sessionModes.get(request.session.id) ?? 'workspace-write',
    }),
  })
  root.provide('commands', {
    async execute(agent: unknown, line: string) {
      order.push(`permission:${line}`)
      if (line === `/permission ${READ_ONLY_PERMISSION_PRESET}`) {
        const sessionId = (agent as { session?: { id?: string } })?.session?.id
        if (sessionId !== undefined) sessionModes.set(sessionId, 'read-only')
      }
      return { commandId: 'cmd-1', result: { kind: 'success', text: 'ok' } }
    },
  })
  const runtime = new ToolRuntime(root, { mode: 'native' })
  await root.plugin(TypertRegistry)
  await root.plugin(PluginLoader)
  // Host-shaped internal import (app-boot HostResolvedRootInclude): the
  // preset subtree resolves `dsh-research-control/investigator-safety`
  // through this seam — on the bench the INSTALLED package's exports
  // subpath resolves natively; the unit mounts the same class.
  const internalImport = async (name: string): Promise<unknown> => {
    if (name === 'dsh-research-control/investigator-safety') return InvestigatorSafety
    return await import(/* @vite-ignore */ name)
  }
  ;(root as unknown as { loader: { internal?: unknown } }).loader.internal = { import: internalImport }
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(AgentPresetRegistry, { default: 'standard' })
  const roster = root.get('agentPresets') as {
    resolve(id?: string): Promise<{ id: string; broken?: string }>
    mount(ctx: unknown, id?: string): Promise<unknown>
    recompose(ctx: unknown, id: string): Promise<unknown>
    register(definition: unknown): Promise<() => Promise<void>>
    readDocument(id: string): Promise<{ content: string }>
  }
  const realMount = roster.mount.bind(roster)
  roster.mount = (async (ctx: unknown, id?: string) => {
    await realMount(ctx, id)
    order.push('mount')
  }) as typeof roster.mount

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
  return { root, roster, runtime, registry, adapter, order, minted, sessionModes }
}

interface DispatchResult {
  isError: boolean
  value?: unknown
  error?: { info?: { code?: string }; code?: string }
  content?: Array<{ type: string; text?: string }>
}

async function executeTool(runtime: ToolRuntime, name: string, agent: unknown, args: unknown = {}): Promise<DispatchResult> {
  return await (runtime as unknown as {
    execute(exec: unknown): Promise<DispatchResult>
  }).execute({
    callId: ToolCallId(`lifecycle-${name}-${Math.random()}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
    agent,
  })
}

const refusalText = (r: DispatchResult): string =>
  r.content?.map((c) => c.text ?? '').join(' ') ?? r.error?.info?.code ?? r.error?.code ?? ''

const REQUEST: InvestigatorLaunchRequest = {
  presetId: INVESTIGATOR_PRESET_ID,
  permissionPreset: READ_ONLY_PERMISSION_PRESET,
  cwd: '/ws/project',
  task: '生命周期验收：只读 investigator',
}

let h: Awaited<ReturnType<typeof boot>> | undefined
let unregister: (() => Promise<void>) | undefined
let unregisterPlain: (() => Promise<void>) | undefined

afterEach(async () => {
  await unregister?.().catch(() => undefined)
  unregister = undefined
  await unregisterPlain?.().catch(() => undefined)
  unregisterPlain = undefined
  await h?.root.fiber.dispose()
  h = undefined
})

describe('R3 — preset-generation safety row, real register→mount→launch lifecycle', () => {
  it('POSITIVE: rows + SAFETY row mount; order mount→/permission→followup (no adapter restrict); visibility + GUARD enforcement incl. UNREGISTERED writer and bash WIDENING; writable default REFUSES work', async () => {
    h = await boot()
    // Register only SIX writers — the seventh is never registered anywhere.
    for (const name of [...WRITE7.slice(1), ...READ4]) h.runtime.register(stubTool(name))
    unregister = await h.roster.register(investigatorPresetDefinition())
    const resolved = await h.roster.resolve(INVESTIGATOR_PRESET_ID)
    // THE crux: real rows (bash/glob/grep + the safety row) activate —
    // `broken` undefined proves the SAFETY row resolved, activated and
    // registered its guard/visibility inside the generation.
    expect(resolved).toEqual({ id: INVESTIGATOR_PRESET_ID })

    const result = await h.adapter.launchInvestigator(REQUEST)
    expect(result.presetId).toBe(INVESTIGATOR_PRESET_ID)
    const agent = h.minted[0]?.agent
    expect(agent, 'agent minted').toBeDefined()

    // Order end to end: the adapter setup is mount-ONLY now (R3) — the
    // deny-7 layers belong to the generation the mount joined.
    expect(h.order).toEqual(['mount', `permission:/permission ${READ_ONLY_PERMISSION_PRESET}`, 'followup'])
    expect(agent?.followups).toHaveLength(1)
    expect((agent?.followups[0] as { content?: Array<{ text?: string }> }).content?.[0]?.text).toBe(REQUEST.task)

    // Visibility (generation-owned restrict masks the PRESENT writers —
    // including the unregistered seventh, which is absent by definition).
    const visible = (h.runtime as unknown as { schemas(a: unknown): Array<{ name: string }> }).schemas(agent).map((s) => s.name)
    for (const mounted of ['bash', 'glob', 'grep']) expect(visible, `mounted ${mounted}`).toContain(mounted)
    for (const read of READ4) expect(visible, `read ${read}`).toContain(read)
    for (const write of WRITE7) expect(visible, `write ${write} hidden`).not.toContain(write)

    // Execution: the 4 readers run (the /permission flow committed the
    // read-only session mode; the guard live-reads it per admission).
    for (const name of READ4) {
      const ran = await executeTool(h.runtime, name, agent)
      expect(ran.isError, `read ${name} runs`).toBe(false)
      expect(ran.value).toEqual({ ok: true })
    }
    // All 7 writers are DENIED whether registered or not: six hidden
    // registered writers refused (guard/registry), the UNREGISTERED
    // seventh refused too — the guard matches NAMES, not registrations.
    for (const name of WRITE7) {
      const refused = await executeTool(h.runtime, name, agent)
      expect(refused.isError, `write ${name} refused`).toBe(true)
      expect(refusalText(refused), `write ${name} reason mentions guard or hidden`).toMatch(/investigator guard|UNKNOWN_TOOL/)
    }
    // bash IS visible (preset row) but a sandbox WIDENING request is
    // refused by the guard BEFORE the body (never executed).
    const widening = await executeTool(h.runtime, 'bash', agent, { command: 'true', sandbox_permissions: 'workspace-write' })
    expect(widening.isError, 'widening refused').toBe(true)
    expect(refusalText(widening)).toContain('WIDENING')

    // CONTROL: a foreign scoped agent (never joined the preset) runs the
    // same writer — the generation's guard cannot reach its chain.
    const control: Record<string, unknown> = { id: 'ctrl', session: { id: 'ctrl' } }
    const controlScope = createScope(h.root, control)
    try {
      const open = await executeTool(h.runtime, WRITE7[1]!, control)
      expect(open.isError).toBe(false)
    } finally {
      await controlScope.dispose()
    }

    // WRITABLE DEFAULT (the reviewer's refusal case): an investigator agent
    // created under the writable deployment default WITHOUT the launcher's
    // /permission step — no session override exists → the guard FAILS
    // CLOSED on every tool: work is explicitly refused, not silently run.
    const unconfined = await h.registry.create({
      sessionId: 'investigator-writable-default',
      meta: { cwd: '/ws', agentPreset: INVESTIGATOR_PRESET_ID, source: 'startup' },
      setup: (agentCtx: Context) => h!.roster.mount(agentCtx, INVESTIGATOR_PRESET_ID),
    } as never)
    const unconfinedAgent = unconfined.agent as unknown as Record<string, unknown>
    const refusal = await executeTool(h.runtime, READ4[0]!, unconfinedAgent)
    expect(refusal.isError, 'writable default refuses even a reader').toBe(true)
    expect(refusalText(refusal)).toContain('not "read-only"')
    await unconfined.dispose()

    await expect(h.minted[0]?.scope.dispose()).resolves.toBeUndefined()
  }, 30000)

  it('cold resume + blank select + leave: ONE generation policy covers mount-only resume, recompose covers blank select, leave detaches', async () => {
    h = await boot()
    for (const name of [...WRITE7, ...READ4]) h.runtime.register(stubTool(name))
    unregister = await h.roster.register(investigatorPresetDefinition())
    unregisterPlain = await h.roster.register({
      id: 'plain-control',
      name: 'Plain control',
      description: 'control preset without the safety row (leave-target)',
      plugins: [{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }],
    })

    // ── COLD RESUME, host setup verbatim (selection + mount, NO adapter,
    // NO launch — api/session-controller agent.ts:391-395). The session's
    // durable mode log already says read-only (launcher-origin PRESERVED):
    h.sessionModes.set('investigator-cold-resume', 'read-only')
    const resumed = await h.registry.create({
      sessionId: 'investigator-cold-resume',
      meta: { cwd: '/ws', agentPreset: INVESTIGATOR_PRESET_ID, source: 'resume' },
      setup: (agentCtx: Context) => h!.roster.mount(agentCtx, INVESTIGATOR_PRESET_ID),
    } as never)
    const resumedAgent = resumed.agent as unknown as Record<string, unknown>
    for (const name of READ4) {
      expect((await executeTool(h.runtime, name, resumedAgent)).isError, `resume read ${name} runs`).toBe(false)
    }
    for (const name of WRITE7) {
      const refused = await executeTool(h.runtime, name, resumedAgent)
      expect(refused.isError, `resume write ${name} refused`).toBe(true)
      expect(refusalText(refused)).toMatch(/investigator guard|UNKNOWN_TOOL/)
    }

    // ── BLANK SELECT (registry.recompose — fires NO `agent/created`, the
    // retired watch never saw it). A blank agent starts guard-free…
    const blank = await h.registry.create({
      sessionId: 'investigator-blank',
      meta: { cwd: '/ws', source: 'startup' },
      setup: async () => {},
    } as never)
    const blankAgent = blank.agent as unknown as Record<string, unknown>
    expect((await executeTool(h.runtime, WRITE7[0]!, blankAgent)).isError, 'blank agent: writer runs (no preset yet)').toBe(false)
    // …the select recomposes into the investigator generation…
    await h.roster.recompose(blankAgent.ctx, INVESTIGATOR_PRESET_ID)
    const afterSelect = await executeTool(h.runtime, WRITE7[0]!, blankAgent)
    expect(afterSelect.isError, 'after blank select: writer refused').toBe(true)
    // …and under the WRITABLE default (no /permission ran for this blank
    // session) the whole scope fails closed — explicit refusal, no work.
    const reader = await executeTool(h.runtime, READ4[0]!, blankAgent)
    expect(reader.isError, 'after blank select: even readers refuse under writable default').toBe(true)
    expect(refusalText(reader)).toContain('not "read-only"')

    // ── LEAVE: recompose to another generation → the investigator guard
    // is OFF the scope chain — writers run again WITHOUT any cleanup call
    // on our side (auto-detach; nothing to unwatch, nothing leaked).
    await h.roster.recompose(blankAgent.ctx, 'plain-control')
    const afterLeave = await executeTool(h.runtime, WRITE7[0]!, blankAgent)
    expect(afterLeave.isError, 'after leave: writer runs again (generation detached)').toBe(false)

    await blank.dispose()
    await resumed.dispose()
  }, 30000)
})
