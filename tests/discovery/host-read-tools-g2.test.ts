/**
 * G2 — the four read tools through the REAL host lane.
 *
 * Same harness as `host-tools-reinit.test.ts` (temp $DSH_HOME + fake cordis
 * ctx + NO App; the single-project plane boots and the 11 tools register
 * exactly once). What this file pins is the HOST-CODEC half of the G2
 * acceptance — things the plugin-unit face cannot see:
 *
 *  - the REGISTERED (host-projected, `projectNodeToDshSubset`) output
 *    schema of each read tool passes the pinned host's own
 *    `assertSupportedJsonSchema` — the exact registration-time acceptance
 *    the real host applies (no plugin-mirror privilege);
 *  - every SUCCESS value produced through `#runResearchTool` (live
 *    dispatch, host-resolved AGENT actor from `exec.agent.sessionId`)
 *    validates against that registered schema with the host's own
 *    `validateJsonSchemaValue` — the actual host codec, not a mock;
 *  - structured failures ride the host machine codes EXACTLY (G1 review
 *    #1 discipline): a missing workstream/edge → `TOOL_SERVICE`, a bad
 *    wire face (limit above the tool max) → `TOOL_INPUT` — and the read
 *    lane serves a session WITHOUT any run (INV-PERM: reads are
 *    run-free), so `research_context_get` answers `bound: false` instead
 *    of a run-attribution error.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { ResearchControlService } from '../../src/host/dsh-adapter/host/index.js'
import type { HostWiring } from '../../src/host/service/wiring/index.js'
import { serializeRegistry } from '../../src/host/domain/registry/index.js'
import { makeFile } from '../registry/fixtures.js'
import { initGitRepo, writeResearchTree, USER } from '../wiring/helpers.js'
import { assertSchemaIsHostSupported } from '../helpers/host-output-codec.js'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

/* ------------------------------------------------------------------ *
 * Temp plumbing (per-test $DSH_HOME; tracked for cleanup)
 * ------------------------------------------------------------------ */

const roots: string[] = []

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 500))
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

function freshDshHome(): string {
  const home = makeTemp('g2-read-home-')
  process.env['DSH_HOME'] = home
  return home
}

function makeValidWs(): string {
  const root = makeTemp('g2-read-wsA-')
  writeResearchTree(root)
  initGitRepo(root)
  return root
}

function makeHubWs(wsPath: string): string {
  const root = makeTemp('g2-read-hub-')
  const hubDir = join(root, '.research-control')
  mkdirSync(hubDir, { recursive: true })
  const entry = {
    id: 'PRJ-1',
    path: wsPath,
    displayName: '机器人视觉定位系统',
    status: 'active' as const,
    boundAt: 1770000000000,
    archivedAt: null,
  }
  writeFileSync(join(hubDir, 'registry.yaml'), serializeRegistry(makeFile([entry])), 'utf8')
  return root
}

/* ------------------------------------------------------------------ *
 * Harness (host-tools-reinit.test.ts convention; the registered face
 * here ALSO keeps output.schema — the host-projected codec surface)
 * ------------------------------------------------------------------ */

interface RegisteredTool {
  readonly name: string
  readonly output: { schema: unknown }
  execute(args: unknown, exec: { signal: AbortSignal; agent?: { sessionId: string } }): Promise<unknown>
}

interface HostHarness {
  readonly svc: ResearchControlService
  readonly effectBodies: Array<() => unknown>
  readonly tools: RegisteredTool[]
}

function mountHost(workspaces: readonly string[]): HostHarness {
  const effectBodies: Array<() => unknown> = []
  const tools: RegisteredTool[] = []
  const ctx = {
    reflect: { provide: (_name: string, _value: unknown): void => {} },
    effect: (execute: () => unknown): unknown => {
      effectBodies.push(execute)
      return {}
    },
    get: (_name: string): unknown => undefined,
    sessions: { list: (): [] => [] },
    events: { on: (_name: string, _handler: unknown): (() => void) => () => {} },
    tools: {
      register: (def: RegisteredTool): (() => void) => {
        tools.push(def)
        return () => {}
      },
    },
    workspaceRegistry: { list: () => workspaces.map((path) => ({ path })) },
  } as unknown as Context
  const svc = new ResearchControlService(ctx, { minDshVersion: '0.2.0-rc.2' })
  return { svc, effectBodies, tools }
}

function initPlane(svc: ResearchControlService): Promise<void> {
  const init = (ResearchControlService.prototype as unknown as Record<symbol, unknown>)[
    Service.init
  ] as unknown as (this: ResearchControlService) => Promise<void>
  return init.call(svc)
}

function disposeFiber(h: HostHarness): void {
  for (const body of h.effectBodies) {
    const disposer = body()
    if (typeof disposer === 'function') disposer()
  }
}

function liveWiring(svc: ResearchControlService): HostWiring {
  const map = (svc as unknown as { projectWirings?: Map<string, HostWiring> }).projectWirings
  const w = map?.get('PRJ-1')
  if (w === undefined) throw new Error('no PRJ-1 wiring on the plane (harness broken)')
  return w
}

function tool(h: HostHarness, name: string): RegisteredTool {
  const found = h.tools.find((t) => t.name === name)
  if (found === undefined) throw new Error(`tool ${name} was not registered`)
  return found
}

function execAs(sessionId: string): { signal: AbortSignal; agent: { sessionId: string } } {
  return { signal: new AbortController().signal, agent: { sessionId } }
}

function expectHostError(e: unknown, code: string, messageIncludes?: string): true {
  const err = e as { code?: unknown; message?: unknown }
  if (typeof err.code !== 'string' || err.code !== code) {
    throw new Error(
      `expected host error code ${JSON.stringify(code)}, got code=${JSON.stringify(err.code)} message=${JSON.stringify(err.message)}`,
    )
  }
  if (messageIncludes !== undefined && !String(err.message).includes(messageIncludes)) {
    throw new Error(`expected host error message to include ${JSON.stringify(messageIncludes)}, got ${JSON.stringify(err.message)}`)
  }
  return true
}

const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

afterEach(() => {
  warnSpy.mockClear()
  logSpy.mockClear()
  errorSpy.mockClear()
})

afterAll(() => {
  warnSpy.mockRestore()
  logSpy.mockRestore()
  errorSpy.mockRestore()
})

const READ_4 = ['research_context_get', 'research_plan_get', 'research_history_query', 'research_contract_read']

/* ------------------------------------------------------------------ *
 * The host-codec matrix
 * ------------------------------------------------------------------ */

describe('G2 read tools through the real host lane（注册 codec + 成功值 + 结构化错误）', () => {
  it('all four REGISTERED output schemas pass the pinned host subset assertion', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)
      expect(h.tools.map((t) => t.name).sort()).toContain('research_context_get')
      for (const name of READ_4) {
        // the registered schema is the PROJECTED clone (projectNodeToDshSubset)
        // — assertSupportedJsonSchema is the host's own registration gate
        expect(() => assertSchemaIsHostSupported(tool(h, name).output.schema), name).not.toThrow()
      }
    } finally {
      disposeFiber(h)
    }
  }, 40_000)

  it('success values through #runResearchTool validate with the host validateJsonSchemaValue; unbound/runless reads hold', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)
      const boot = liveWiring(h.svc)
      const { run } = boot.runBinding.registerRun({ workstreamId: 'WS-1', taskId: 'T-1', dshSessionId: 'sess-g2-a' }, USER)
      boot.runBinding.finishRun(run.id, { outcomeSummary: 'g2 host lane' }, USER)

      const context = (await tool(h, 'research_context_get').execute({}, execAs('sess-g2-a'))) as Record<string, unknown>
      expect(context['status']).toBe('ok')
      expect(context['bound']).toBe(true)
      expect((context['run'] as Record<string, unknown>)['id']).toBe(run.id)
      expect(validateJsonSchemaValue(assertSchemaIsHostSupported(tool(h, 'research_context_get').output.schema), structuredClone(context))).toEqual([])

      // an unbound session: reads do NOT require a run — bound:false, not an error
      const unbound = (await tool(h, 'research_context_get').execute({}, execAs('sess-g2-none'))) as Record<string, unknown>
      expect(unbound).toEqual({ status: 'ok', session_id: 'sess-g2-none', bound: false })

      const plan = (await tool(h, 'research_plan_get').execute({ workstream_id: 'WS-1' }, execAs('sess-g2-a'))) as Record<string, unknown>
      expect(plan['ordered_items']).toEqual(['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'])
      expect(validateJsonSchemaValue(assertSchemaIsHostSupported(tool(h, 'research_plan_get').output.schema), structuredClone(plan))).toEqual([])

      const history = (await tool(h, 'research_history_query').execute({ workstream_id: 'WS-1', limit: 1 }, execAs('sess-g2-a'))) as Record<string, unknown>
      expect(history['limit']).toBe(1)
      expect(history['exhausted']).toBe(false)
      expect(validateJsonSchemaValue(assertSchemaIsHostSupported(tool(h, 'research_history_query').output.schema), structuredClone(history))).toEqual([])

      const contract = (await tool(h, 'research_contract_read').execute({ edge_id: 'TE-2' }, execAs('sess-g2-a'))) as Record<string, unknown>
      expect(String(contract['content'])).toContain('# Merge Contract TE-2')
      expect(validateJsonSchemaValue(assertSchemaIsHostSupported(tool(h, 'research_contract_read').output.schema), structuredClone(contract))).toEqual([])
    } finally {
      disposeFiber(h)
    }
  }, 40_000)

  it('structured failures carry the exact host machine codes（TOOL_SERVICE / TOOL_INPUT）', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)

      await expect(tool(h, 'research_history_query').execute({ workstream_id: 'WS-404' }, execAs('sess-g2-a')))
        .rejects.toSatisfy((e: unknown) => expectHostError(e, 'TOOL_SERVICE', 'WS-404'))
      await expect(tool(h, 'research_plan_get').execute({ workstream_id: 'WS-404' }, execAs('sess-g2-a')))
        .rejects.toSatisfy((e: unknown) => expectHostError(e, 'TOOL_SERVICE', 'WS-404'))
      await expect(tool(h, 'research_contract_read').execute({ edge_id: 'TE-404' }, execAs('sess-g2-a')))
        .rejects.toSatisfy((e: unknown) => expectHostError(e, 'TOOL_SERVICE', 'TE-404'))
      // above the tool page max → refused at the wire face (never truncated)
      await expect(tool(h, 'research_history_query').execute({ workstream_id: 'WS-1', limit: 1001 }, execAs('sess-g2-a')))
        .rejects.toSatisfy((e: unknown) => expectHostError(e, 'TOOL_INPUT', '/limit'))
      // the frozen face still rejects a forged identity key on a READ tool
      await expect(tool(h, 'research_context_get').execute({ actor: { kind: 'USER', user_id: 'u-9' } }, execAs('sess-g2-a')))
        .rejects.toSatisfy((e: unknown) => expectHostError(e, 'TOOL_INPUT', '/actor'))
    } finally {
      disposeFiber(h)
    }
  }, 40_000)
})
