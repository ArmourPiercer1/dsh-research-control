/**
 * G1 (trusted boundary / lifecycle) — the 11 agent tools must dispatch on
 * the LIVE wiring, never on a stale closure captured at registration
 * (BASELINE_PLAN §2c row 1, parent review #1〔实证: the self-documented
 * boundary — tool closures captured the boot-time wiring's `tools` value;
 * `#reinitResearchPlane` closed that wiring but kept the registration, so
 * the first post-rescan call hit the closed store〕).
 *
 * ## The regression matrix (the REAL full-service seam)
 *
 * Same harness as `host-commands-reinit.test.ts` (temp workspaces + fake
 * cordis ctx double + NO App): the `ctx.tools.register` face here CAPTURES
 * the registered definitions (the command harness only captured names),
 * because the regression lives in the captured `execute` closure itself.
 *
 *   - a single MANAGED project plane (1 hub + 1 valid tree) boots; the 11
 *     tools register exactly ONCE (the explicit single-project
 *     registration boundary — unchanged by G1);
 *   - two formal runs exist, bound to sessions sess-g1-a / sess-g1-b
 *     (created through the BOOT wiring's runBinding — the rows live in the
 *     on-disk store, so the FRESH wiring sees the same rows);
 *   - pre-rescan: `research_run_checkpoint` (own run) and
 *     `research_plan_fork_create` succeed through the captured defs;
 *   - `rescan({})` re-initializes the plane (the production mutation path:
 *     closes the boot wiring, swaps a fresh one); the boot wiring's table
 *     reads now throw (the stale-handle class) — yet the SAME captured
 *     tool defs keep succeeding: dispatch re-resolves `wiring.tools` LIVE
 *     per call (the `() => this.#wiring` getter discipline the command
 *     channels already had);
 *   - the registration count stays 11 after rescan (live dispatch, NOT
 *     re-registration — the frozen single-registration boundary);
 *   - the trusted identity stays host-owned: the actor/run come from the
 *     CALLING SESSION (`exec.agent.sessionId`), never from args — a
 *     run-less session cannot target a run through its args
 *     (TOOL_RUN_REQUIRED), and an AGENT cannot stamp another run's
 *     checkpoint (the same-run gate rides through the host lane);
 *   - after `unbindProject` (the plane leaves the single-project shape)
 *     every captured tool fails loud with the clear no-wiring
 *     TOOL_INTERNAL — never a raw closed-handle failure.
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

/* ------------------------------------------------------------------ *
 * Temp plumbing（per-test $DSH_HOME; tracked for cleanup）
 * ------------------------------------------------------------------ */

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
  const home = makeTemp('tools-reinit-home-')
  process.env['DSH_HOME'] = home
  return home
}

function makeValidWs(): string {
  const root = makeTemp('tools-reinit-wsA-')
  writeResearchTree(root)
  initGitRepo(root)
  return root
}

function makeHubWs(wsPath: string): string {
  const root = makeTemp('tools-reinit-hub-')
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
 * The harness（host-commands-reinit.test.ts convention — the tools face
 * CAPTURES the full registered definitions）
 * ------------------------------------------------------------------ */

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
    const disposer = body()
    if (typeof disposer === 'function') disposer()
  }
}

/** The LIVE single-project wiring (the TS-private plane map — the same
 *  in-place field `#reinitResearchPlane` swaps). */
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

/** Precise host-machine error assertion. `ResearchToolHostError.code` is
 *  the machine-routable code (WP-3.3 contract — the registry's errorInfo
 *  extracts `info.code` verbatim), so it must EQUAL the expected code —
 *  a haystack `includes` would mask the code/message swap (a sentence in
 *  `code` would pass). `message` is the carried human-readable text. */
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

/** The frozen §7.2 11-name face (the registration boundary constant). */
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
]

const PF_ARGS = {
  workstream_id: 'WS-1',
  fork_anchor: 'T-1',
  merge_anchor: 'T-1',
  proposed_items: [
    { action: 'NEW', kind: 'TASK', spec: { title: 't-live', goal: 'g-live' } },
  ],
  trigger_refs: [{ kind: 'MILESTONE', id: 'M-1' }],
  reason: 'live-wiring 回归：跨 rescan 的合法创建',
  necessity: '验证 dispatch 每次现取 live wiring（G1 修复钉）',
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

/* ------------------------------------------------------------------ *
 * The lifecycle matrix
 * ------------------------------------------------------------------ */

describe('agent tools across a plane-mutation RE-INIT（G1 live-wiring dispatch）', () => {
  it('rescan 重初始化后: 同一批已注册工具仍成功（绝不再触 closed wiring）', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)

      // Registration boundary (UNCHANGED by G1): exactly the frozen 11,
      // registered ONCE on the single-project plane.
      expect(h.tools.map((t) => t.name).sort()).toEqual([...FROZEN_11].sort())

      // Two formal runs, one per session, on the BOOT wiring (rows live
      // in the on-disk store → the fresh wiring reads the same rows).
      const boot = liveWiring(h.svc)
      const runA = boot.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g1-a' }, USER).run
      const runB = boot.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g1-b' }, USER).run

      const checkpoint = tool(h, 'research_run_checkpoint')
      const planFork = tool(h, 'research_plan_fork_create')

      // (1) Boot wiring: both live tools succeed through the captured defs.
      const cp1 = (await checkpoint.execute({ run_id: runA.id, note: 'boot 前报告' }, execAs('sess-g1-a'))) as {
        status: string
        run: { id: string; last_checkpoint_note?: string }
      }
      expect(cp1.status).toBe('ok')
      expect(cp1.run.id).toBe(runA.id)
      const pf1 = (await planFork.execute(PF_ARGS, execAs('sess-g1-b'))) as { status: string }
      expect(pf1.status).toBe('created')

      // (2) The production mutation path: rescan CLOSES the boot wiring
      //     and swaps a fresh one in place.
      const rescanResult = await h.svc.rescan({})
      expect(rescanResult.projects.length).toBe(1)
      expect(h.tools.length).toBe(11) // NO re-registration — live dispatch

      // The boot wiring really is the stale side: a direct read on its
      // tables now throws (the exact handle class the pre-fix closures
      // were left on — 「database is not open」).
      expect(() => boot.tables.getRun(runA.id)).toThrow()

      // (3) THE REGRESSION: the SAME captured defs must keep succeeding —
      //     dispatch re-resolves the LIVE wiring per call. Pre-fix: both
      //     calls fail through the closed old wiring (the fail-loud
      //     WIRING_CLOSED / closed-db class), never silently.
      const cp2 = (await checkpoint.execute({ run_id: runA.id, note: 'rescan 后同 run 再报告' }, execAs('sess-g1-a'))) as {
        status: string
        run: { id: string; last_checkpoint_note?: string }
      }
      expect(cp2.status).toBe('ok')
      expect(cp2.run.last_checkpoint_note).toBe('rescan 后同 run 再报告')

      const pf2 = (await planFork.execute(
        { ...PF_ARGS, reason: 'rescan 后的第二次合法创建（live wiring）' },
        execAs('sess-g1-b'),
      )) as { status: string; plan_fork: { status: string } }
      expect(pf2.status).toBe('created')
      expect(pf2.plan_fork.status).toBe('OPEN')

      // The fresh wiring really moved the rows (read back through it):
      const fresh = liveWiring(h.svc)
      expect(fresh.runBinding.getRun(runA.id)?.last_checkpoint_note).toBe('rescan 后同 run 再报告')
      void runB
    } finally {
      disposeFiber(h)
    }
  }, 40_000)

  it('trusted identity: actor/run 由 calling session 决定，args 无法伪造', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)
      const wiring = liveWiring(h.svc)
      const runA = wiring.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g1-a' }, USER).run
      const runB = wiring.runBinding.registerRun({ workstreamId: 'WS-2', dshSessionId: 'sess-g1-b' }, USER).run

      const checkpoint = tool(h, 'research_run_checkpoint')

      // ① A run-less session pointing its args at a REAL run: the run
      //    attribution comes from the session, so the write gate fires —
      //    args never manufacture an identity (INV-PERM-1). EXACT machine
      //    code (a sentence in `code` must not pass).
      await expect(
        checkpoint.execute({ run_id: runA.id }, execAs('sess-no-run')),
      ).rejects.toSatisfy((e: unknown) => expectHostError(e, 'TOOL_RUN_REQUIRED', 'research_run_checkpoint'))

      // ② An unknown session id is likewise unattributed (a forged
      //    session id in the run's row would be needed — not input).
      await expect(
        checkpoint.execute({ run_id: runA.id }, execAs('sess-forged')),
      ).rejects.toSatisfy((e: unknown) => expectHostError(e, 'TOOL_RUN_REQUIRED'))

      // ③ The same-run gate rides through the host lane: AGENT(sess-a →
      //    run A) checkpointing run B is a structured service rejection —
      //    the existing ToolError mapping with the EXACT code
      //    `TOOL_SERVICE` (not the whole sentence) — and B stays
      //    untouched.
      await expect(
        checkpoint.execute({ run_id: runB.id, note: '跨 run 伪造' }, execAs('sess-g1-a')),
      ).rejects.toSatisfy((e: unknown) => expectHostError(e, 'TOOL_SERVICE', 'recordCheckpoint'))
      expect(wiring.runBinding.getRun(runB.id)?.last_checkpoint_at).toBeUndefined()

      // ④ The same-run positive keeps working (no over-tightening).
      const ok = (await checkpoint.execute({ run_id: runA.id, note: 'own' }, execAs('sess-g1-a'))) as { status: string }
      expect(ok.status).toBe('ok')

      // ⑤ An UNEXPECTED (non-ToolError) throw below the boundary maps to
      //    the EXACT code `TOOL_INTERNAL` (never a raw unstructured leak).
      //    Fault injection replaces one live definition with an
      //    always-throwing stand-in (the frozen array is rebuilt per
      //    wiring — the host resolves it LIVE, so the swap is observed;
      //    restored in finally).
      const tools = wiring.tools as unknown as Array<{ name: string; execute: (a: unknown, e: unknown) => Promise<unknown> }>
      const idx = tools.findIndex((t) => t.name === 'research_plan_get')
      const original = tools[idx]!
      tools[idx] = {
        name: original.name,
        execute: async (): Promise<unknown> => {
          throw new Error('injected internal boom')
        },
      }
      try {
        await expect(
          tool(h, 'research_plan_get').execute({}, execAs('sess-g1-a')),
        ).rejects.toSatisfy((e: unknown) => expectHostError(e, 'TOOL_INTERNAL', 'unexpected failure'))
      } finally {
        tools[idx] = original
      }
    } finally {
      disposeFiber(h)
    }
  }, 40_000)

  it('unbindProject 后平面离开单项目形态: 工具以清晰 TOOL_INTERNAL 失败（绝不裸抛已关闭连接）', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)
      const wiring = liveWiring(h.svc)
      const runA = wiring.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: 'sess-g1-a' }, USER).run

      const unbind = await h.svc.unbindProject({ wsPath: wsA })
      expect(unbind.projectId).toBe('PRJ-1')

      for (const def of h.tools) {
        await expect(def.execute({ run_id: runA.id }, execAs('sess-g1-a')))
          .rejects.toSatisfy((e: unknown) => expectHostError(e, 'TOOL_INTERNAL', 'not initialized'))
      }
    } finally {
      disposeFiber(h)
    }
  }, 40_000)
})
