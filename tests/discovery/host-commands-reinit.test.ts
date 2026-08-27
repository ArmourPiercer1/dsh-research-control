/**
 * V2 修复回归 — the COMMAND channels must survive a plane-mutation
 * RE-INIT (the user-visible 「分析数据面不可用: database is not open」
 * bug).
 *
 * ## The bug（the diagnosis this test pins）
 *
 * The 4 plugin-owned global commands（/research-investigate +
 * /research-transient-read / /research-analysis-list /
 * /research-analysis-save）were registered at `[Service.init]` with the
 * BOOT-TIME wiring VALUE captured into the handler closures. Every plane
 * mutation（setHub / bindProject / unbindProject / restoreProject /
 * rescan — all of them end in `#reinitResearchPlane`）CLOSES the
 * boot-time wiring's second connections and swaps a fresh one in place.
 * A value-capturing handler then executes its reads on the CLOSED
 * handles — node:sqlite's C-level 「database is not open」, surfaced in
 * the investigator page as the 「分析数据面不可用」 red state. The fix:
 * the handlers receive the `() => this.#wiring` getter and re-resolve
 * the LIVE wiring on every invocation（the same live-field discipline
 * as `requireRpc` / `#runResearchTool`）.
 *
 * ## The regression matrix（the REAL full-service seam）
 *
 *   - a single MANAGED project plane（1 hub + 1 valid tree）boots; the
 *     4 commands register on a capturing fake command registry;
 *   - the captured /research-analysis-list handler succeeds on the boot
 *     wiring（an empty `[]` over the REAL analysis store）;
 *   - `rescan({})` re-initializes the plane（the production mutation
 *     path — closes the boot wiring, swaps a fresh one）;
 *   - the SAME captured handler succeeds again（live re-resolution — the
 *     pre-fix code failed exactly here with 「database is not open」）;
 *   - /research-investigate resolves the intervention store on the FRESH
 *     wiring（a non-existent id → the clear not-found text — not a
 *     closed-handle failure）;
 *   - after `unbindProject`（the plane leaves the single-project shape —
 *     no wiring at all）the captured handlers fail loud with the clear
 *     no-wiring texts（INVESTIGATION_NO_WIRING_TEXT /
 *     ANALYSIS_NO_WIRING_TEXT）— never a closed-handle failure.
 *
 * Style: the tests/discovery/host-startup.test.ts harness — real temp
 * workspaces（REAL `.research` trees + REAL git repos）, a fake cordis
 * ctx double（the assembly seam — no App started）, the configured dir
 * names from the settings domain's DEFAULTS.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { ResearchControlService } from '../../src/host/dsh-adapter/host/index.js'
import {
  ANALYSIS_NO_WIRING_TEXT,
} from '../../src/host/dsh-adapter/host/analysis-commands.js'
import {
  INVESTIGATION_NO_WIRING_TEXT,
  type CommandOutcome,
  type CommandRegistrarLike,
} from '../../src/host/dsh-adapter/host/investigate-command.js'
import { serializeRegistry } from '../../src/host/domain/registry/index.js'
import { makeFile } from '../registry/fixtures.js'
import { initGitRepo, writeResearchTree } from '../wiring/helpers.js'

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
  // check（git spawns, never fatal）: let the composed wirings' pending
  // checks settle BEFORE the temp dirs disappear.
  await new Promise((r) => setTimeout(r, 500))
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

function freshDshHome(): string {
  const home = makeTemp('cmd-reinit-home-')
  process.env['DSH_HOME'] = home
  return home
}

/** A complete valid project workspace（PRJ-1 — the APPENDIX_A tree）. */
function makeValidWs(): string {
  const root = makeTemp('cmd-reinit-wsA-')
  writeResearchTree(root)
  initGitRepo(root)
  return root
}

/** A hub workspace with the single PRJ-1 entry. */
function makeHubWs(wsPath: string): string {
  const root = makeTemp('cmd-reinit-hub-')
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
 * The harness（host-startup.test.ts convention + the capturing command
 * registry face）
 * ------------------------------------------------------------------ */

interface RegisteredCommand {
  readonly name: string
  readonly description: string
  readonly handler: (invocation: { readonly rawInput: string }) => Promise<CommandOutcome>
}

interface HostHarness {
  readonly svc: ResearchControlService
  readonly effectBodies: Array<() => unknown>
  readonly toolNames: string[]
  readonly commands: RegisteredCommand[]
  readonly disposedCommands: string[]
}

function mountHost(workspaces: readonly string[]): HostHarness {
  const effectBodies: Array<() => unknown> = []
  const toolNames: string[] = []
  const commands: RegisteredCommand[] = []
  const disposedCommands: string[] = []
  const commandsFace: CommandRegistrarLike = {
    register: (def) => {
      commands.push(def)
      return () => {
        disposedCommands.push(def.name)
      }
    },
  }
  const ctx = {
    reflect: {
      provide: (_name: string, _value: unknown): void => {},
    },
    effect: (execute: () => unknown): unknown => {
      effectBodies.push(execute)
      return {}
    },
    // The web-profile face: the command registry IS present（capturing
    // double）; settings / agents absent as on a minimal deployment.
    get: (name: string): unknown => (name === 'commands' ? commandsFace : undefined),
    sessions: { list: (): [] => [] },
    events: {
      on: (_name: string, _handler: unknown): (() => void) => () => {},
    },
    tools: {
      register: (def: { name: string }): (() => void) => {
        toolNames.push(def.name)
        return () => {}
      },
    },
    workspaceRegistry: {
      list: () => workspaces.map((path) => ({ path })),
    },
  } as unknown as Context
  const svc = new ResearchControlService(ctx, { minDshVersion: '0.1.0-rc.8' })
  return { svc, effectBodies, toolNames, commands, disposedCommands }
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

function byName(h: HostHarness, name: string): (invocation: { readonly rawInput: string }) => Promise<CommandOutcome> {
  const found = h.commands.find((c) => c.name === name)
  if (found === undefined) throw new Error(`command ${name} was not registered`)
  return found.handler
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
 * The re-init matrix
 * ------------------------------------------------------------------ */

describe('command channels across a plane-mutation RE-INIT（the re-init fix）', () => {
  it('rescan 重初始化后: 同一批命令 handler 仍成功（绝不再走已关闭连接）', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)

      // Boot: the single managed project plane carries 4 commands on the
      // fake registry（the registration-as-effect convention — the
      // disposers went through ctx.effect）.
      expect(h.commands.map((c) => c.name).sort()).toEqual([
        'research-analysis-list',
        'research-analysis-save',
        'research-investigate',
        'research-transient-read',
      ])

      const listHandler = byName(h, 'research-analysis-list')

      // (1) On the BOOT wiring: the analysis list reads the REAL store
      // (fresh tree → an honest empty list).
      expect(await listHandler({ rawInput: '' })).toEqual({ kind: 'success', text: '[]' })

      // (2) The production mutation path: rescan re-initializes the
      // plane — it CLOSES the boot wiring（its second connections all of
      // them）and swaps a fresh one in place.
      const rescanResult = await h.svc.rescan({})
      expect(rescanResult.projects.length).toBe(1)

      // (3) THE REGRESSION: the SAME captured handler（registered at
      // boot）must still succeed — it re-resolves the LIVE wiring
      // instead of executing on the closed handles（pre-fix: the raw
      // driver 「database is not open」）.
      expect(await listHandler({ rawInput: '' })).toEqual({ kind: 'success', text: '[]' })

      // (4) /research-investigate resolves the intervention store on the
      // FRESH wiring: a non-existent id → the clear not-found text — a
      // wiring-level store READ that a closed handle could not serve.
      const investigate = byName(h, 'research-investigate')
      expect(await investigate({ rawInput: 'IV-1 为什么' })).toEqual({
        kind: 'error',
        text: 'Intervention IV-1 不存在（本项目 intervention 存储无此 id — 检查 id 或先刷新 dashboard）',
      })
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('unbindProject 后平面离开单项目形态: 命令通道以清晰无-wiring 文本失败（绝不裸抛已关闭连接）', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h.svc)

      const unbind = await h.svc.unbindProject({ wsPath: wsA })
      expect(unbind.projectId).toBe('PRJ-1')

      // The plane is now EMPTY（no project at all → no sole wiring）.
      // Every captured command handler must fail loud with the CLEAR
      // no-wiring text — never a closed-handle failure, never a hang.
      expect(await byName(h, 'research-analysis-list')({ rawInput: '' })).toEqual({
        kind: 'error',
        text: ANALYSIS_NO_WIRING_TEXT,
      })
      expect(await byName(h, 'research-transient-read')({ rawInput: 's-1' })).toEqual({
        kind: 'error',
        text: ANALYSIS_NO_WIRING_TEXT,
      })
      expect(await byName(h, 'research-analysis-save')({ rawInput: '{}' })).toEqual({
        kind: 'error',
        text: ANALYSIS_NO_WIRING_TEXT,
      })
      expect(await byName(h, 'research-investigate')({ rawInput: 'IV-1 为什么' })).toEqual({
        kind: 'error',
        text: INVESTIGATION_NO_WIRING_TEXT,
      })
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('fiber unmount 注销全部 4 条命令（registration-as-effect 不变）', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const hub = makeHubWs(wsA)
    const h = mountHost([hub, wsA])
    await initPlane(h.svc)
    disposeFiber(h)
    expect(h.disposedCommands.sort()).toEqual([
      'research-analysis-list',
      'research-analysis-save',
      'research-investigate',
      'research-transient-read',
    ])
  }, 30_000)
})
