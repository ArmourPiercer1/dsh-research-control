/**
 * G4 (attention write lane) — the two now-LIVE attention tools through the
 * REAL host codec: registration surface, session-resolved trusted actor,
 * strict success values, and the machine codes riding `ResearchToolHostError.code`
 * (G1 §4 Review-#1 discipline: exact `error.code` equality; message substrings
 * are corroborating evidence only, never a substitute for the machine code).
 *
 * This is also the production-context proof for the G4 gap (BASELINE_PLAN
 * §2b): the boot wiring must feed the intervention service the REAL run /
 * semantic maps — a formal run created through `runBinding.registerRun` is a
 * table row, and the host-lane AGENT_REPORT creation with a source ref to
 * THAT run must therefore succeed (pre-fix the injected context was empty and
 * every WS-related report died in the frozen registry).
 *
 * Same real-seam harness as host-tools-reinit.test.ts (temp workspaces + fake
 * cordis ctx double + NO App; the ctx.tools.register face captures the
 * registered definitions — `output.schema` verbatim-projected, WP-3.3 codec).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import { afterAll, describe, expect, it } from 'vitest'

import { ResearchControlService } from '../../src/host/dsh-adapter/host/index.js'
import type { HostWiring } from '../../src/host/service/wiring/index.js'
import { serializeRegistry } from '../../src/host/domain/registry/index.js'
import { makeFile } from '../registry/fixtures.js'
import { initGitRepo, writeResearchTree, USER } from '../wiring/helpers.js'

const roots: string[] = []

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(async () => {
  // The startup integrity gate's git boundary check is the one ASYNC
  // check — let pending checks settle BEFORE the temp dirs disappear.
  await new Promise((r) => setTimeout(r, 500))
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

function freshDshHome(): string {
  const home = makeTemp('dsh-g4-home-')
  process.env['DSH_HOME'] = home
  return home
}

function makeValidWs(name = 'ws'): string {
  const root = makeTemp(`dsh-g4-${name}-`)
  writeResearchTree(root)
  initGitRepo(root)
  return root
}

function makeHubWs(wsPath: string): string {
  const root = makeTemp('dsh-g4-hub-')
  const hubDir = join(root, '.research-control')
  mkdirSync(hubDir, { recursive: true })
  const entry = {
    id: 'PRJ-1',
    path: wsPath,
    displayName: 'G4 注意力写面',
    status: 'active' as const,
    boundAt: 1770000000000,
    archivedAt: null,
  }
  writeFileSync(join(hubDir, 'registry.yaml'), serializeRegistry(makeFile([entry])), 'utf8')
  return root
}

/* ------------------------------------------------------------------ *
 * The harness (host-tools-reinit.test.ts convention — the tools face
 * CAPTURES the full registered definitions, incl. output.schema).
 * ------------------------------------------------------------------ */

interface RegisteredTool {
  readonly name: string
  readonly output: { schema: Record<string, unknown>; render: (a: unknown, v: unknown) => unknown }
  readonly parameters: Record<string, unknown>
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
  const svc = new ResearchControlService(ctx, { minDshVersion: '0.1.0-rc.8' })
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
    try {
      const disposer = body()
      if (typeof disposer === 'function') disposer()
    } catch {
      /* best effort */
    }
  }
}

/** The LIVE single-project wiring (the TS-private plane map). */
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

/** Structured host error: the MACHINE code rides `error.code` (exact equality — the message only corroborates). */
function expectHostError(thrown: unknown, code: string, messagePart?: string): void {
  expect(thrown).toBeInstanceOf(Error)
  const error = thrown as { code?: string; message?: string }
  expect(error.code, `host error code (message was ${JSON.stringify(error.message)})`).toBe(code)
  if (messagePart !== undefined) expect(String(error.message)).toContain(messagePart)
}

describe('G4 host codec: research_intervention_create over the real wiring + real validation context', () => {
  it('a run-bound session creates the AGENT_REPORT intervention: strict success value + event(actor run) + OPEN row', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)
      expect(h.tools).toHaveLength(11)
      const wiring = liveWiring(h.svc)
      const { run } = wiring.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g4-a' }, USER)

      const value = (await tool(h, 'research_intervention_create').execute(
        { title: '需要人工判断：run 证据与计划冲突', detail: 'd', workstream_ids: ['WS-1'], source_refs: [{ kind: 'RUN', id: run.id }] },
        execAs('sess-g4-a'),
      )) as { status: string; intervention: Record<string, unknown>; event_id: string | null }

      expect(value.status).toBe('created')
      expect(value.intervention.origin).toBe('AGENT_REPORT')
      expect(value.intervention.status).toBe('OPEN')
      expect(value.intervention.created_by).toEqual({ kind: 'AGENT', run_id: run.id })
      expect(value.event_id).toMatch(/^H-[1-9][0-9]*$/)

      // the G4 gap proof: the source-ref RUN is a REAL table row and the
      // production validation context now contains it (empty maps pre-fix ⇒ death in the registry)
      const ev = wiring.store.listRange('WS-1', 1).find((e) => e.eventType === 'INTERVENTION_CREATED')!
      expect(ev.eventType).toBe('INTERVENTION_CREATED')
      expect(ev.actor).toEqual({ kind: 'AGENT', run_id: run.id })
      const row = wiring.interventions.getIntervention(value.intervention.id as string)!
      expect(row.status).toBe('OPEN')
      expect(row.created_by).toEqual({ kind: 'AGENT', run_id: run.id })
    } finally {
      disposeFiber(h)
    }
  }, 40_000)

  it('optionalWS: no association ⇒ event_id null, row in the queue', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)
      const wiring = liveWiring(h.svc)
      wiring.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g4-a' }, USER)

      const value = (await tool(h, 'research_intervention_create').execute(
        { title: '跨工作流事项需人工判断' },
        execAs('sess-g4-a'),
      )) as { status: string; intervention: { id: string }; event_id: string | null }
      expect(value.status).toBe('created')
      expect(value.event_id).toBeNull()
      expect(wiring.interventions.getIntervention(value.intervention.id)!.status).toBe('OPEN')
    } finally {
      disposeFiber(h)
    }
  }, 40_000)

  it('multiWS + cross-WS source ref stays legal (no invented same-WS rule)', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)
      const wiring = liveWiring(h.svc)
      const { run } = wiring.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g4-a' }, USER)

      const value = (await tool(h, 'research_intervention_create').execute(
        { title: '两工作流排期冲突', workstream_ids: ['WS-2', 'WS-1'], source_refs: [{ kind: 'RUN', id: run.id }] },
        execAs('sess-g4-a'),
      )) as { status: string; intervention: { workstream_ids: string[] } }
      expect(value.status).toBe('created')
      expect(value.intervention.workstream_ids).toEqual(['WS-2', 'WS-1'])
    } finally {
      disposeFiber(h)
    }
  }, 40_000)

  it('a run-less session cannot create (TOOL_RUN_REQUIRED, exact host code)', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)
      await tool(h, 'research_intervention_create')
        .execute({ title: 't' }, execAs('sess-unbound'))
        .then(() => { throw new Error('unreachable') })
        .catch((e: unknown) => expectHostError(e, 'TOOL_RUN_REQUIRED'))
    } finally {
      disposeFiber(h)
    }
  }, 40_000)

  it('invalid refs keep the machine code on the host error: unknown WS / dangling RUN ⇒ TOOL_SERVICE (+ IV_INPUT corroborated)', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)
      const wiring = liveWiring(h.svc)
      wiring.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g4-a' }, USER)

      await tool(h, 'research_intervention_create')
        .execute({ title: 't', workstream_ids: ['WS-9'] }, execAs('sess-g4-a'))
        .then(() => { throw new Error('unreachable') })
        .catch((e: unknown) => expectHostError(e, 'TOOL_SERVICE', 'IV_INPUT'))
      await tool(h, 'research_intervention_create')
        .execute({ title: 't', workstream_ids: ['WS-1'], source_refs: [{ kind: 'RUN', id: 'R-404' }] }, execAs('sess-g4-a'))
        .then(() => { throw new Error('unreachable') })
        .catch((e: unknown) => expectHostError(e, 'TOOL_SERVICE', 'IV_INPUT'))
      expect(wiring.interventions.listInterventions()).toHaveLength(0)
    } finally {
      disposeFiber(h)
    }
  }, 40_000)

  it('an injected identity key is refused at the wire (TOOL_INPUT) — the live face keeps the G1 boundary', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)
      const wiring = liveWiring(h.svc)
      wiring.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g4-a' }, USER)
      await tool(h, 'research_intervention_create')
        .execute({ title: 't', actor: { kind: 'USER', user_id: 'u-root' } }, execAs('sess-g4-a'))
        .then(() => { throw new Error('unreachable') })
        .catch((e: unknown) => expectHostError(e, 'TOOL_INPUT', '/actor'))
      expect(wiring.interventions.listInterventions()).toHaveLength(0)
    } finally {
      disposeFiber(h)
    }
  }, 40_000)
})

describe('G4 host codec: research_next_action_create + the registered strict output contracts', () => {
  it('a run-bound session creates the PROPOSED row (trusted created_by); dangling WS ⇒ TOOL_SERVICE (+ ACT_INPUT)', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)
      const wiring = liveWiring(h.svc)
      const { run } = wiring.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g4-a' }, USER)

      const value = (await tool(h, 'research_next_action_create').execute(
        { workstream_id: 'WS-1', statement: '或许值得做：复测 p95', rationale: '抖动' },
        execAs('sess-g4-a'),
      )) as { status: string; next_action: Record<string, unknown> }
      expect(value.status).toBe('created')
      expect(value.next_action.status).toBe('PROPOSED')
      expect(value.next_action.created_by).toEqual({ kind: 'AGENT', run_id: run.id })

      await tool(h, 'research_next_action_create')
        .execute({ workstream_id: 'WS-99', statement: 's' }, execAs('sess-g4-a'))
        .then(() => { throw new Error('unreachable') })
        .catch((e: unknown) => expectHostError(e, 'TOOL_SERVICE', 'ACT_INPUT'))
    } finally {
      disposeFiber(h)
    }
  }, 40_000)

  it('the REGISTERED output contracts are the strict frozen projections (not the permissive stub schema)', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)
      const iv = tool(h, 'research_intervention_create').output.schema
      const ivProps = iv.properties as Record<string, Record<string, unknown>>
      expect(iv.required).toEqual(expect.arrayContaining(['status', 'intervention', 'event_id']))
      expect(ivProps.status).toMatchObject({ const: 'created' })
      const rec = ivProps.intervention as Record<string, unknown>
      expect(rec.additionalProperties).toBe(false)
      expect([...(rec.required as string[])].sort()).toEqual(
        ['created_at', 'created_by', 'id', 'origin', 'status', 'title'].sort(),
      )
      expect(rec.properties, 'intervention record props survive the host projection').toHaveProperty('source_refs')
      const na = tool(h, 'research_next_action_create').output.schema
      const naProps = na.properties as Record<string, Record<string, unknown>>
      expect(naProps.status).toMatchObject({ const: 'created' })
      const naRec = naProps.next_action as Record<string, unknown>
      expect(naRec.additionalProperties).toBe(false)
      expect([...(naRec.required as string[])].sort()).toEqual(
        ['created_at', 'created_by', 'id', 'statement', 'status'].sort(),
      )
      // NOT the permissive stub face anymore
      expect(iv.additionalProperties).not.toBe(true)
    } finally {
      disposeFiber(h)
    }
  }, 40_000)
})
