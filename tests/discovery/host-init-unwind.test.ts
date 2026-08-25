/**
 * V2-T2.2 (design §13 row 1) — the PARTIAL-COMPOSITION UNWIND of
 * `#initResearchPlane` (the hardening discipline 「a failed startup
 * leaks nothing」, tests/hardening precedent): when a LATER project's
 * `createHostWiring` fails, every EARLIER already-composed project's
 * resources — its RPC service port AND its `HostWiring` — must be
 * closed before the error propagates.
 *
 * Why this seam is tested with a module mock: the catch block is the
 * ONLY disposer on the failed-init path (the `ctx.effect` plane disposer
 * is registered only after `#initResearchPlane` RETURNS — a throw means
 * it never runs). Close observability is therefore injected at the
 * `createHostWiring` / `ProductionResearchRpcServices` seams: both
 * wrappers delegate to the REAL implementation (importOriginal) and
 * only COUNT the `close()` calls — the failure itself is a REAL one
 * (the second workspace carries a broken tree: its `topic.yaml`
 * violates the frozen topic schema, so the real loader fails and the
 * real wiring throws `WIRING_INPUT`).
 *
 * Plane: 1 hub + 2 registered entries — wsA (PRJ-1, a complete valid
 * tree) wires first, wsB (PRJ-2, valid project id, broken topic) fails.
 * Pinned outcomes:
 *   - init rejects with the structured `HostWiringError` (fiber FAILED
 *     before ACTIVE);
 *   - the 11 tools / the commands are NOT registered;
 *   - wsA's wiring AND its RPC port were closed (one each);
 *   - the plane state was never published (the 13 RPCs fail loud with
 *     the spike-mode message — no half-plane is servable);
 *   - wsA's data dir exists on disk (layout residue is legal — the
 *     DISCIPLINE is that no live connection survives).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import type { HostWiring, HostWiringOptions } from '../../src/host/service/wiring/index.js'
import { ResearchControlService } from '../../src/host/dsh-adapter/host/index.js'
import { serializeRegistry } from '../../src/host/domain/registry/index.js'
import type { RegistryEntry } from '../../src/host/domain/registry/index.js'
import { makeFile } from '../registry/fixtures.js'
import { APPENDIX_A_PROJECT_YAML, TOPIC_YAML } from '../loader/fixtures.js'
import { initGitRepo, writeResearchTree } from '../wiring/helpers.js'

/* ------------------------------------------------------------------ *
 * Close-tracking seams (REAL implementations, counting wrappers only)
 * ------------------------------------------------------------------ */

const counters = vi.hoisted(() => ({
  /** Every `createHostWiring` call, in scan order (repoRoot). */
  createCalls: [] as string[],
  /** Every `HostWiring.close()` call (projectId), in close order. */
  closedWirings: [] as string[],
  /** Every `ProductionResearchRpcServices.close()` call. */
  closedRpcs: 0,
}))

vi.mock('../../src/host/service/wiring/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/host/service/wiring/index.js')>()
  return {
    ...actual,
    createHostWiring: (options: HostWiringOptions): HostWiring => {
      counters.createCalls.push(options.repoRoot)
      const real = actual.createHostWiring(options)
      return new Proxy(real, {
        get(target, prop) {
          if (prop === 'close') {
            return (): void => {
              counters.closedWirings.push(target.projectId)
              target.close()
            }
          }
          const value = Reflect.get(target, prop)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
  }
})

vi.mock('../../src/host/dsh-adapter/host/rpc-services.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/host/dsh-adapter/host/rpc-services.js')>()
  return {
    ...actual,
    ProductionResearchRpcServices: class extends actual.ProductionResearchRpcServices {
      close(): void {
        counters.closedRpcs += 1
        super.close()
      }
    },
  }
})

/* ------------------------------------------------------------------ *
 * Temp plumbing + harness (host-startup.test.ts technique)
 * ------------------------------------------------------------------ */

const roots: string[] = []

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(async () => {
  // Let any pending async integrity checks settle before cleanup (the
  // bench output stays clean; the checks are non-fatal by design).
  await new Promise((r) => setTimeout(r, 500))
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

function freshDshHome(): string {
  const home = makeTemp('t22-unwind-home-')
  process.env['DSH_HOME'] = home
  return home
}

/** The PRJ-2 id patch + the BROKEN topic (the failure injection). */
const BROKEN_TREE_PATCH: Record<string, string> = {
  'project.yaml': APPENDIX_A_PROJECT_YAML.replace('id: PRJ-1', 'id: PRJ-2'),
  'topics/TPC-1/topic.yaml':
    TOPIC_YAML.replace('id: TPC-1', 'id: NOT_A_TOPIC_ID').replace('project_id: PRJ-1', 'project_id: PRJ-2'),
}

/** A complete valid project workspace (PRJ-1 — wires successfully). */
function makeValidWs(): string {
  const root = makeTemp('t22-unwind-wsA-')
  writeResearchTree(root)
  initGitRepo(root)
  return root
}

/** A project workspace whose project id is valid but the tree is broken (PRJ-2 — the wiring fails). */
function makeBrokenWs(): string {
  const root = makeTemp('t22-unwind-wsB-')
  writeResearchTree(root, BROKEN_TREE_PATCH)
  initGitRepo(root)
  return root
}

/** A hub workspace with the given entries. */
function makeHubWs(entries: readonly RegistryEntry[]): string {
  const root = makeTemp('t22-unwind-hub-')
  const hubDir = join(root, '.research-control')
  mkdirSync(hubDir, { recursive: true })
  writeFileSync(join(hubDir, 'registry.yaml'), serializeRegistry(makeFile(entries)), 'utf8')
  return root
}

interface HostHarness {
  readonly svc: ResearchControlService
  readonly toolNames: string[]
}

function mountHost(workspaces: readonly string[]): HostHarness {
  const toolNames: string[] = []
  const ctx = {
    reflect: {
      provide: (_name: string, _value: unknown): void => {},
    },
    effect: (_execute: () => unknown): unknown => ({}),
    // Optional-service face: settings / commands / agents all absent.
    get: (_name: string): unknown => undefined,
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
  return {
    svc: new ResearchControlService(ctx, { minDshVersion: '0.1.0-rc.8' }),
    toolNames,
  }
}

function initPlane(svc: ResearchControlService): Promise<void> {
  const init = (ResearchControlService.prototype as unknown as Record<symbol, unknown>)[
    Service.init
  ] as unknown as (this: ResearchControlService) => Promise<void>
  return init.call(svc)
}

const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

afterEach(() => {
  warnSpy.mockClear()
  logSpy.mockClear()
  errorSpy.mockClear()
  counters.createCalls.length = 0
  counters.closedWirings.length = 0
  counters.closedRpcs = 0
})

afterAll(() => {
  warnSpy.mockRestore()
  logSpy.mockRestore()
  errorSpy.mockRestore()
})

/* ------------------------------------------------------------------ *
 * The unwind matrix
 * ------------------------------------------------------------------ */

describe('partial-composition unwind (a failed multi-project init leaks nothing)', () => {
  it('a LATER project wiring failure closes every EARLIER composed wiring + RPC port, then propagates', async () => {
    freshDshHome()
    const wsA = makeValidWs()
    const wsB = makeBrokenWs()
    const hub = makeHubWs([
      {
        id: 'PRJ-1',
        path: wsA,
        displayName: '机器人视觉定位系统',
        status: 'active',
        boundAt: 1770000000000,
        archivedAt: null,
      },
      {
        id: 'PRJ-2',
        path: wsB,
        displayName: '破碎树项目',
        status: 'active',
        boundAt: 1770000000000,
        archivedAt: null,
      },
    ])

    const h = mountHost([hub, wsA, wsB])
    let caught: unknown
    try {
      await initPlane(h.svc)
    } catch (e) {
      caught = e
    }

    // The failure propagates (fiber FAILED before ACTIVE), structured.
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('NOT_A_TOPIC_ID')

    // The 11 tools + the commands never register (the init threw before
    // the registration step — no ambiguous or partial surface).
    expect(h.toolNames).toHaveLength(0)

    // Both projects were ATTEMPTED in scan order…
    expect(counters.createCalls).toEqual([wsA, wsB])
    // …and every already-composed resource was closed exactly once:
    // wsA's wiring AND its RPC port. wsB never had a wiring (the throw
    // happened inside createHostWiring — its own partial resources are
    // unwound by the wiring itself).
    expect(counters.closedWirings).toEqual(['PRJ-1'])
    expect(counters.closedRpcs).toBe(1)

    // The plane state was never published: the 13 RPCs fail loud with
    // the spike-mode message (a half-plane must never be servable).
    await expect(h.svc.getProject()).rejects.toThrow(/not initialized \(spike mode\)/)

    // Layout residue is legal — the discipline is about LIVE resources:
    // wsA's data dir (auto-created, owner-only) exists on disk…
    expect(existsSync(join(hub, '.research-control', 'projects', 'PRJ-1'))).toBe(true)
    // …with the owner-only 0o700 mode (DSH_ADAPTER §9 — the adapter
    // pre-creates the dir, so it must set the mode itself).
    expect(statSync(join(hub, '.research-control', 'projects', 'PRJ-1')).mode & 0o777).toBe(0o700)
  }, 30_000)
})
