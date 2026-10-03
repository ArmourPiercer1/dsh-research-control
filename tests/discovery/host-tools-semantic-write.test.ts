/**
 * G3 (semantic write tools) — the three semantic writes through the REAL
 * host lane (BASELINE_PLAN §2a; the trusted-identity chain of G1 extended
 * to the newly-live trio). Harness = the host-tools-reinit.test.ts
 * convention (temp workspaces + fake cordis ctx + NO App; the
 * `ctx.tools.register` face CAPTURES the registered definitions, whose
 * `execute` runs the FULL production wiring).
 *
 * What only THIS seam can pin:
 *  - the strict success schemas passed the pinned host's output-schema
 *    codec at registration (init registers the 11 through
 *    projectNodeToDshSubset — a rejected schema fails the boot);
 *  - the caller identity rides session → run row → AGENT actorRef →
 *    service lane: events land with actor {kind:'AGENT', run_id,
 *    session_id} + payload created_by_run + the derived row provenance;
 *  - a run-less session cannot manufacture attribution through args
 *    (TOOL_RUN_REQUIRED); an identity key on the wire is TOOL_INPUT;
 *  - the same-WS gate rides the whole lane: AGENT(run on WS-2) recording
 *    on WS-1 is a structured TOOL_SERVICE/OWNER_MISMATCH and writes
 *    NOTHING on either workstream.
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
import { readSemanticRow } from '../semantics-records/harness.js'

/* ------------------------------------------------------------------ *
 * Temp plumbing + host harness (host-tools-reinit.test.ts convention)
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
  const home = makeTemp('g3-semantic-home-')
  process.env['DSH_HOME'] = home
  return home
}
function makeValidWs(): string {
  const root = makeTemp('g3-semantic-ws-')
  writeResearchTree(root)
  initGitRepo(root)
  return root
}
function makeHubWs(wsPath: string): string {
  const root = makeTemp('g3-semantic-hub-')
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

interface RegisteredTool {
  readonly name: string
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
    tools: { register: (def: RegisteredTool): (() => void) => {
      tools.push(def)
      return () => {}
    } },
    workspaceRegistry: { list: () => workspaces.map((path) => ({ path })) },
  } as unknown as Context
  const svc = new ResearchControlService(ctx, { minDshVersion: '0.2.0-rc.2' })
  return { svc, effectBodies, tools }
}
function initPlane(svc: ResearchControlService): Promise<void> {
  const init = (ResearchControlService.prototype as unknown as Record<symbol, unknown>)[Service.init] as unknown as (
    this: ResearchControlService,
  ) => Promise<void>
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

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
afterEach(() => {
  logSpy.mockClear()
  warnSpy.mockClear()
  errorSpy.mockClear()
})
afterAll(() => {
  logSpy.mockRestore()
  warnSpy.mockRestore()
  errorSpy.mockRestore()
})

/* ------------------------------------------------------------------ *
 * The matrix
 * ------------------------------------------------------------------ */

describe('G3 semantic writes through the real host lane', () => {
  it('fact/claim/artifact succeed on the bound run; events + rows carry AGENT actor/run provenance', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)
      const wiring = liveWiring(h.svc)
      const runA = wiring.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g3-a' }, USER).run

      const fact = (await tool(h, 'research_fact_record').execute(
        { workstream_id: 'WS-1', statement: 'loss plateaued at epoch 12', references: ['T-1'] },
        execAs('sess-g3-a'),
      )) as { status: string; fact: Record<string, unknown> }
      expect(fact.status).toBe('ok')
      expect(fact.fact).toMatchObject({ id: 'F-1', workstream_id: 'WS-1', status: 'ACTIVE', created_by_run: runA.id })

      const claim = (await tool(h, 'research_claim_record').execute(
        { workstream_id: 'WS-1', statement: 'the detector saturates below 5lx' },
        execAs('sess-g3-a'),
      )) as { status: string; claim: Record<string, unknown> }
      expect(claim.claim).toMatchObject({ id: 'C-1', status: 'ACTIVE', created_by_run: runA.id })

      const artifact = (await tool(h, 'research_artifact_register').execute(
        { workstream_id: 'WS-1', type: 'DATASET', title: 'night-run frames', uri: 'data/night-07/', related_task: 'T-1' },
        execAs('sess-g3-a'),
      )) as { status: string; artifact: Record<string, unknown> }
      expect(artifact.artifact).toMatchObject({ id: 'A-1', status: 'REGISTERED', created_by_run: runA.id, related_task: 'T-1' })

      // The event rows through the live store (envelope actor + payload stamp).
      const events = wiring.store.listRange('WS-1', 1).filter((e) => e.eventType !== 'RUN_STARTED')
      expect(events.map((e) => e.eventType)).toEqual(['FACT_RECORDED', 'CLAIM_RECORDED', 'ARTIFACT_REGISTERED'])
      for (const ev of events) {
        expect(ev.actor).toEqual({ kind: 'AGENT', run_id: runA.id, session_id: 'sess-g3-a' })
        const p = ev.payload as Record<string, unknown>
        expect(p.created_by_run).toBe(runA.id)
      }

      // The derived row provenance (production codec; the frozen Artifact
      // row attributes via created_by_run — it carries no created_by).
      const state = readSemanticRow(wiring.store, wiring.projectId)!
      expect(state.facts.get('F-1')!.created_by_run).toBe(runA.id)
      expect(state.facts.get('F-1')!.created_by).toEqual({ kind: 'AGENT', run_id: runA.id, session_id: 'sess-g3-a' })
      expect(state.artifacts.get('A-1')!.created_by_run).toBe(runA.id)
    } finally {
      disposeFiber(h)
    }
  }, 60_000)

  it('identity is host-owned: run-less session / forged identity keys never reach the lane', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)
      const wiring = liveWiring(h.svc)
      const runA = wiring.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g3-a' }, USER).run
      // baseline = the RUN_STARTED event the registration itself wrote
      const baseline = wiring.store.listRange('WS-1', 1).length

      // ① A run-less session aiming at the REAL run through args: the
      //    attribution comes from the session ⇒ the run gate fires
//    FIRST (before the wire-face parse) — args can never bypass
      //    it (INV-PERM-1: no identity without a bound formal run).
      await expect(
        tool(h, 'research_fact_record').execute({ workstream_id: 'WS-1', statement: 's', run_id: runA.id }, execAs('sess-g3-none')),
      ).rejects.toSatisfy((e: unknown) => expectHostError(e, 'TOOL_RUN_REQUIRED'))

      // ② The same forged keys from an ATTRIBUTED session are refused at
      //    the wire face (TOOL_INPUT) — nothing is written.
      await expect(
        tool(h, 'research_fact_record').execute(
          { workstream_id: 'WS-1', statement: 's', created_by_run: runA.id },
          execAs('sess-g3-a'),
        ),
      ).rejects.toSatisfy((e: unknown) => expectHostError(e, 'TOOL_INPUT'))
      await expect(
        tool(h, 'research_claim_record').execute(
          { workstream_id: 'WS-1', statement: 's', actor: { kind: 'USER' } },
          execAs('sess-g3-a'),
        ),
      ).rejects.toSatisfy((e: unknown) => expectHostError(e, 'TOOL_INPUT'))
      expect(wiring.store.listRange('WS-1', 1)).toHaveLength(baseline)

      // ③ A session with NO formal run: the write gate fires first — the
      //    lane is unreachable without run attribution (INV-PERM-1).
      await expect(
        tool(h, 'research_artifact_register').execute(
          { workstream_id: 'WS-1', type: 'CODE', title: 't', uri: 'u' },
          execAs('sess-g3-none'),
        ),
      ).rejects.toSatisfy((e: unknown) => expectHostError(e, 'TOOL_RUN_REQUIRED'))
    } finally {
      disposeFiber(h)
    }
  }, 60_000)

  it('cross-WS caller: AGENT(run on WS-2) recording on WS-1 is a structured refusal, nothing written', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)
      const wiring = liveWiring(h.svc)
      wiring.runBinding.registerRun({ workstreamId: 'WS-2', dshSessionId: 'sess-g3-b' }, USER)

      await expect(
        tool(h, 'research_fact_record').execute({ workstream_id: 'WS-1', statement: 'cross-WS' }, execAs('sess-g3-b')),
      ).rejects.toSatisfy((e: unknown) => expectHostError(e, 'TOOL_SERVICE', 'OWNER_MISMATCH'))
      expect(wiring.store.listRange('WS-1', 1)).toHaveLength(0)
      // WS-2 keeps ONLY its RUN_STARTED (the registration) — the refused
      // semantic write added nothing anywhere.
      expect(wiring.store.listRange('WS-2', 1).map((e) => e.eventType)).toEqual(['RUN_STARTED'])
    } finally {
      disposeFiber(h)
    }
  }, 60_000)
})
