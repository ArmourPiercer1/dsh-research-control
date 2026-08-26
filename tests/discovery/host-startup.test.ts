/**
 * V2-T2.2 — the rewritten host-side startup matrix (design §4 + §13 row 1).
 *
 * Drives the REAL `ResearchControlService.[Service.init]` end-to-end with
 * the WP-0.2/host-mount structural ctx double extended with the faces the
 * init consumes (workspaceRegistry / tools / events / sessions / get) and
 * REAL temp workspaces (the loader fixtures' complete `.research` tree +
 * real git repos + the real frozen schemas + a per-test `$DSH_HOME`):
 *
 *   - single managed   (1 hub + 1 registered tree)  → one wiring, 11 tools
 *   - single standalone (0 hub + 1 tree)             → one wiring, 11 tools
 *                                                     (the V1 plane, byte-
 *                                                     compatible: the frozen
 *                                                     RPCs route to the sole
 *                                                     project), one standalone warn
 *   - mixed            (1 hub + 2 trees, 1 registered)
 *                                                    → two wirings, NO tools
 *                                                     (the frozen face carries
 *                                                     no projectId — §12.1), a
 *                                                     multi-project warn, and the
 *                                                     13 RPCs fail loud with the
 *                                                     project list
 *   - MISSING          (1 hub + 2 entries, 1 tree)   → one wiring + one
 *                                                     MISSING warn (displayName +
 *                                                     path + 等待用户处置)
 *   - RENAMED          (tree on disk under a
 *     configured name, settings present)             → init succeeds: the
 *                                                     per-project wiring uses
 *                                                     the CONFIGURED treeDir
 *                                                     (V2-T6.1-r1 regression —
 *                                                     the r1 fix's pin)
 *   - dual hub         (2 hubs)                      → fiber FAILED:
 *                                                     DiscoverError MULTIPLE_HUBS
 *                                                     (all hub paths listed)
 *   - empty            (no tree, no hub)             → the V1 spike mode as a
 *                                                     plane shape: no tools, one
 *                                                     empty-plane warn
 *   - id conflict      (entry id ≠ tree id)          → fiber FAILED:
 *                                                     PROJECT_ID_CONFLICT (§3.2)
 *   - hub without a registry.yaml                     → fiber FAILED:
 *                                                     REGISTRY_ABSENT
 *
 * The pure classification matrix lives in discover.test.ts; the §12.1
 * routing branches there too. No cordis App is started (the host-mount
 * convention) — the ctx double is the assembly seam.
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  renameSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import {
  DiscoverError,
  probeWorkspaces,
} from '../../src/host/dsh-adapter/host/discovery.js'
import {
  DEFAULT_HUB_DIR,
  DEFAULT_PROJECT_TREE_DIR,
} from '../../src/host/dsh-adapter/host/settings.js'
import { ResearchControlService } from '../../src/host/dsh-adapter/host/index.js'
import { serializeRegistry } from '../../src/host/domain/registry/index.js'
import type { RegistryEntry } from '../../src/host/domain/registry/index.js'
import { makeFile } from '../registry/fixtures.js'
import { APPENDIX_A_PROJECT_YAML, TOPIC_YAML } from '../loader/fixtures.js'
import { initGitRepo, writeResearchTree } from '../wiring/helpers.js'

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
  // The startup integrity gate's git boundary check is the one ASYNC
  // check (git spawns, never fatal): let the last composed wirings'
  // pending checks settle BEFORE the temp dirs disappear, so the bench
  // output stays clean (a late ENOENT would log the recoverable
  // 「repo corruption」 warn — by design non-fatal, but noise here).
  await new Promise((r) => setTimeout(r, 500))
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** Point DSH_HOME at a fresh per-test home (dshHomePath reads the env live). */
function freshDshHome(): string {
  const home = makeTemp('t22-dsh-home-')
  process.env['DSH_HOME'] = home
  return home
}

/* ------------------------------------------------------------------ *
 * Workspace fixtures
 * ------------------------------------------------------------------ */

/** The PRJ-2 id patch (the base tree's project.yaml + topic.yaml cross-ref). */
const PRJ2_PATCH: Record<string, string> = {
  'project.yaml': APPENDIX_A_PROJECT_YAML.replace('id: PRJ-1', 'id: PRJ-2'),
  'topics/TPC-1/topic.yaml': TOPIC_YAML.replace('project_id: PRJ-1', 'project_id: PRJ-2'),
}

/** A project workspace: the complete valid `.research` tree + a real git repo. */
function makeProjectWs(projectId: 'PRJ-1' | 'PRJ-2'): string {
  const root = makeTemp('t22-ws-')
  writeResearchTree(root, projectId === 'PRJ-2' ? PRJ2_PATCH : {})
  initGitRepo(root)
  return root
}

/** A hub workspace: `<hubDir>/registry.yaml` with the given entries. */
function makeHubWs(entries: readonly RegistryEntry[]): string {
  const root = makeTemp('t22-hub-')
  const hubDir = join(root, '.research-control')
  mkdirSync(hubDir, { recursive: true })
  writeFileSync(join(hubDir, 'registry.yaml'), serializeRegistry(makeFile(entries)), 'utf8')
  return root
}

/** A bare hub marker WITHOUT the registry file (the REGISTRY_ABSENT case). */
function makeHubWsNoRegistry(): string {
  const root = makeTemp('t22-hub-')
  mkdirSync(join(root, '.research-control'), { recursive: true })
  return root
}

/** A plain (empty) registered workspace. */
function makePlainWs(): string {
  return makeTemp('t22-plain-')
}

/* ------------------------------------------------------------------ *
 * The host ctx double (host-mount.test.ts assembly technique, extended)
 * ------------------------------------------------------------------ */

interface HostHarness {
  readonly svc: ResearchControlService
  /** Every `ctx.effect` body — run (then dispose) to tear the plane down. */
  readonly effectBodies: Array<() => unknown>
  /** The tool names registered through `ctx.tools.register`. */
  readonly toolNames: string[]
  readonly workspaces: readonly string[]
}

/**
 * The optional host settings section the ctx double reports for the
 * research namespace — `undefined` keeps the settings-ABSENT path
 * (one warn + defaults) exactly as the matrix below exercises it.
 */
interface MountHostOptions {
  readonly settings?: { projectTreeDir: string; hubDir: string }
}

function mountHost(workspaces: readonly string[], options: MountHostOptions = {}): HostHarness {
  const effectBodies: Array<() => unknown> = []
  const toolNames: string[] = []
  const ctx = {
    reflect: {
      provide: (_name: string, _value: unknown): void => {},
    },
    effect: (execute: () => unknown): unknown => {
      effectBodies.push(execute)
      return {}
    },
    // Optional-service face: settings / commands / agents all absent —
    // the settings-absent path (one warn + defaults) and the
    // no-command-registry path (null + loud warn) both run, as on a
    // minimal deployment. When `options.settings` IS given, the
    // settings face reports that section for the research namespace
    // (T2.1 §7.5 — the V2-T6.1-r1 regression test: the per-project
    // wiring must honor the CONFIGURED treeDir).
    get: (name: string): unknown =>
      name === 'settings' && options.settings !== undefined
        ? {
            register: (_ns: string, _schema: unknown): void => {},
            get: (ns: string) =>
              ns === 'dsh-research-control' ? options.settings : undefined,
          }
        : undefined,
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
  // The schema default normally applies in the loader; a hand-built
  // config must carry the version floor or [Service.init] fails loud
  // (VERSION_UNREACHABLE) — pass the pinned baseline explicitly.
  const svc = new ResearchControlService(ctx, { minDshVersion: '0.1.0-rc.8' })
  return { svc, effectBodies, toolNames, workspaces }
}

/** Run `[Service.init]` on the harness (the host-mount prototype read). */
function initPlane(h: HostHarness): Promise<void> {
  const init = (ResearchControlService.prototype as unknown as Record<symbol, unknown>)[
    Service.init
  ] as unknown as (this: ResearchControlService) => Promise<void>
  return init.call(h.svc)
}

/** Tear the fiber down (run every effect body, then its disposer). */
function disposeFiber(h: HostHarness): void {
  for (const body of h.effectBodies) {
    const disposer = body()
    if (typeof disposer === 'function') disposer()
  }
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

function warnLines(): string[] {
  return warnSpy.mock.calls.map((c) => c.join(' '))
}

function logLines(): string[] {
  return logSpy.mock.calls.map((c) => c.join(' '))
}

/** The 11 WP-3.3 tool names (the full agent tool face). */
function expectToolsRegistered(h: HostHarness, count = 11): void {
  expect(h.toolNames).toHaveLength(count)
}

/* ------------------------------------------------------------------ *
 * The startup matrix
 * ------------------------------------------------------------------ */

describe('host-side startup matrix (V2-T2.2 — [Service.init] over the §4 state machine)', () => {
  it('single MANAGED project (1 hub + 1 registered tree): one wiring, 11 tools, hub log line, no standalone/missing warns', async () => {
    const home = freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const hub = makeHubWs([
      {
        id: 'PRJ-1',
        path: wsA,
        displayName: '机器人视觉定位系统',
        status: 'active',
        boundAt: 1770000000000,
        archivedAt: null,
      },
    ])
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h)
      expectToolsRegistered(h)
      expect(logLines().some((l) => l.includes(`research hub discovered at ${hub}`))).toBe(true)
      expect(warnLines().filter((l) => l.includes('standalone research tree at'))).toHaveLength(0)
      expect(warnLines().filter((l) => l.includes('MISSING registered project'))).toHaveLength(0)
      // V2-T2.4 (design §3.3): the managed db lives UNDER THE HUB —
      // <hub>/<hubDir>/projects/<id>/research.sqlite — NOT under $DSH_HOME
      // (the retired V1 data-dir layout).
      expect(
        existsSync(join(hub, '.research-control', 'projects', 'PRJ-1', 'research.sqlite')),
      ).toBe(true)
      expect(existsSync(join(home, 'research-control', 'PRJ-1', 'research.sqlite'))).toBe(false)
      // Byte-compat: the frozen RPC face routes to the sole project.
      const project = await h.svc.getProject()
      expect(project.project.id).toBe('PRJ-1')
      expect(project.project.title).toBe('机器人视觉定位系统')
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('single STANDALONE project (0 hub + 1 tree): the V1 plane — one wiring, 11 tools, one standalone warn, RPCs serve', async () => {
    const home = freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const h = mountHost([wsA])
    try {
      await initPlane(h)
      expectToolsRegistered(h)
      const standaloneWarns = warnLines().filter((l) => l.includes(`standalone research tree at ${wsA}`))
      expect(standaloneWarns).toHaveLength(1)
      expect(standaloneWarns[0]).toContain('PRJ-1')
      expect(standaloneWarns[0]).toContain('no popup, this log line is the record')
      expect(warnLines().filter((l) => l.includes('spike mode'))).toHaveLength(0)
      // V2-T2.4 (design §3.3): the standalone db lives in the tree's own
      // state/ area — <ws>/<treeDir>/state/research.sqlite (the data dir
      // is auto-created) — NOT under $DSH_HOME (the retired V1 location).
      expect(existsSync(join(wsA, '.research', 'state', 'research.sqlite'))).toBe(true)
      expect(existsSync(join(home, 'research-control', 'PRJ-1', 'research.sqlite'))).toBe(false)
      // Byte-compat: the frozen RPC face serves the sole project (the V1
      // implicit-single-project behavior, unchanged).
      expect((await h.svc.getProject()).project.id).toBe('PRJ-1')
      const dashboard = await h.svc.getDashboard()
      expect(dashboard.project.id).toBe('PRJ-1')
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('mixed plane (1 hub + 1 registered + 1 unregistered tree): two wirings, NO tools (no projectId in the frozen face), multi-project warn, RPCs fail loud with the project list', async () => {
    const home = freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const wsB = makeProjectWs('PRJ-2')
    const hub = makeHubWs([
      {
        id: 'PRJ-1',
        path: wsA,
        displayName: '机器人视觉定位系统',
        status: 'active',
        boundAt: 1770000000000,
        archivedAt: null,
      },
    ])
    const h = mountHost([hub, wsA, wsB])
    try {
      await initPlane(h)
      // Multi-project: the 11 tools + the commands stay UNregistered
      // (their frozen face carries no projectId — §12.1: never register
      // an ambiguous binding) — the loud warn is the record.
      expect(h.toolNames).toHaveLength(0)
      const multiWarns = warnLines().filter((l) => l.includes('2 projects'))
      expect(multiWarns).toHaveLength(1)
      expect(multiWarns[0]).toContain('PRJ-1')
      expect(multiWarns[0]).toContain('PRJ-2')
      // Both projects are wired — V2-T2.4 (design §3.3): each db follows
      // its own kind: managed under the hub, standalone in the tree's
      // state/ area; the retired $DSH_HOME layout is not touched.
      expect(
        existsSync(join(hub, '.research-control', 'projects', 'PRJ-1', 'research.sqlite')),
      ).toBe(true)
      expect(existsSync(join(wsB, '.research', 'state', 'research.sqlite'))).toBe(true)
      expect(existsSync(join(home, 'research-control', 'PRJ-1', 'research.sqlite'))).toBe(false)
      expect(existsSync(join(home, 'research-control', 'PRJ-2', 'research.sqlite'))).toBe(false)
      // The unregistered tree gets its STANDALONE warn (one line).
      expect(warnLines().filter((l) => l.includes(`standalone research tree at ${wsB}`))).toHaveLength(1)
      // §12.1 at the RPC face: an omitted projectId on a multi-project
      // plane fails loud, listing every project id 供选择 (async method —
      // the failure is a rejection, not a sync throw).
      await expect(h.svc.getProject()).rejects.toThrow(
        /multiple projects are active in the research plane \(PRJ-1, PRJ-2\)/,
      )
      // ping stays the diagnostic 14th method (spike-mode contract).
      await expect(h.svc.ping()).resolves.toMatchObject({ ok: true, service: 'researchControl' })
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('MISSING entry (1 hub + 2 entries, 1 tree): one wiring + one MISSING warn (displayName + path + 等待用户处置)', async () => {
    const home = freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const wsC = makePlainWs() // registered workspace whose tree was lost
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
        path: wsC,
        displayName: '缺失的量化模型项目',
        status: 'active',
        boundAt: 1770000000000,
        archivedAt: null,
      },
    ])
    const h = mountHost([hub, wsA, wsC])
    try {
      await initPlane(h)
      expectToolsRegistered(h) // the sole ACTIVE project still gets its tools
      const missingWarns = warnLines().filter((l) => l.includes('MISSING registered project PRJ-2'))
      expect(missingWarns).toHaveLength(1)
      expect(missingWarns[0]).toContain('缺失的量化模型项目') // displayName
      expect(missingWarns[0]).toContain(wsC) // path
      expect(missingWarns[0]).toContain('awaiting user disposition') // 等待用户处置
      // V2-T2.4 (design §3.3): the wired managed project's db is under
      // the hub; the missing project has no data dir wiring (it is not
      // in the Map) — nowhere in the plane.
      expect(
        existsSync(join(hub, '.research-control', 'projects', 'PRJ-1', 'research.sqlite')),
      ).toBe(true)
      expect(existsSync(join(hub, '.research-control', 'projects', 'PRJ-2'))).toBe(false)
      // The frozen RPC face still routes to the sole active project.
      expect((await h.svc.getProject()).project.id).toBe('PRJ-1')
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('a surviving V1 $DSH_HOME/research-control/<id>/ layout logs ONE migration hint (design §3.3 — 不自动搬)', async () => {
    const home = freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    // The retired V1 data dir (DSH_ADAPTER §9): a per-project dir under
    // $DSH_HOME/research-control/ holding a db file.
    const legacyDir = join(home, 'research-control', 'PRJ-1')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'research.sqlite'), 'legacy-v1-db-bytes\n', 'utf8')
    const h = mountHost([wsA])
    try {
      await initPlane(h)
      // Exactly ONE legacy-hint line (the standalone warn is a different
      // line — the hint is its own one-time startup record, design §3.3).
      const legacyLines = warnLines().filter((l) => l.includes('V1 legacy database layout'))
      expect(legacyLines).toHaveLength(1)
      expect(legacyLines[0]).toContain(legacyDir)
      expect(legacyLines[0]).toContain('does not migrate them automatically')
      // NO automatic migration: the legacy file is byte-identical and
      // still in place; the live db is in the tree's state/ area.
      expect(readFileSync(join(legacyDir, 'research.sqlite'), 'utf8')).toBe('legacy-v1-db-bytes\n')
      expect(existsSync(join(wsA, '.research', 'state', 'research.sqlite'))).toBe(true)
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('dual hub (2 workspaces with <hubDir>): fiber FAILED — DiscoverError MULTIPLE_HUBS, every hub path listed, nothing registered', async () => {
    freshDshHome()
    const hub1 = makeHubWs([])
    const hub2 = makeHubWsNoRegistry()
    const wsA = makeProjectWs('PRJ-1')
    const h = mountHost([hub1, hub2, wsA])
    try {
      let caught: unknown
      try {
        await initPlane(h)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(DiscoverError)
      expect((caught as DiscoverError).code).toBe('MULTIPLE_HUBS')
      expect((caught as DiscoverError).message).toContain(hub1)
      expect((caught as DiscoverError).message).toContain(hub2)
      expect(h.toolNames).toHaveLength(0)
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('empty plane (no tree, no hub — plain workspaces only): the design §6 引导卡 state — no tools, one empty-plane warn, per-project RPCs fail loud', async () => {
    freshDshHome()
    const plain = makePlainWs()
    const h = mountHost([plain])
    try {
      await initPlane(h)
      expect(h.toolNames).toHaveLength(0)
      const emptyWarns = warnLines().filter((l) => l.includes('the plane has no project'))
      expect(emptyWarns).toHaveLength(1)
      expect(emptyWarns[0]).toContain('the tools are NOT registered (single-project planes only)')
      expect(emptyWarns[0]).toContain('the 9 plane RPCs still serve')
      await expect(h.svc.getProject()).rejects.toThrow(/not initialized \(spike mode\)/)
      await expect(h.svc.ping()).resolves.toMatchObject({ ok: true, service: 'researchControl' })
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('id conflict (registry entry id ≠ tree project id): fiber FAILED — PROJECT_ID_CONFLICT (§3.2 冲突，启动期报出), nothing registered', async () => {
    freshDshHome()
    const wsA = makeProjectWs('PRJ-1') // the tree says PRJ-1
    const hub = makeHubWs([
      {
        id: 'PRJ-2', // …but the registry claims PRJ-2
        path: wsA,
        displayName: '机器人视觉定位系统',
        status: 'active',
        boundAt: 1770000000000,
        archivedAt: null,
      },
    ])
    const h = mountHost([hub, wsA])
    try {
      let caught: unknown
      try {
        await initPlane(h)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(DiscoverError)
      expect((caught as DiscoverError).code).toBe('PROJECT_ID_CONFLICT')
      expect((caught as DiscoverError).message).toContain('PRJ-2')
      expect((caught as DiscoverError).message).toContain('PRJ-1')
      expect(h.toolNames).toHaveLength(0)
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('hub without a registry.yaml: fiber FAILED — REGISTRY_ABSENT (a hub without its source of truth is incomplete)', async () => {
    freshDshHome()
    const hub = makeHubWsNoRegistry()
    const wsA = makeProjectWs('PRJ-1')
    const h = mountHost([hub, wsA])
    try {
      let caught: unknown
      try {
        await initPlane(h)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(DiscoverError)
      expect((caught as DiscoverError).code).toBe('REGISTRY_ABSENT')
      expect((caught as DiscoverError).message).toContain(hub)
      expect(h.toolNames).toHaveLength(0)
    } finally {
      disposeFiber(h)
    }
  }, 30_000)
})

/* ------------------------------------------------------------------ *
 * probeWorkspaces — the I/O seam (real disk, configured names)
 * ------------------------------------------------------------------ */

describe('probeWorkspaces (the §4 step-2 disk seam)', () => {
  it('probes the root level with the CONFIGURED names and reads each tree project id', () => {
    const wsA = makeProjectWs('PRJ-1')
    const hub = makeHubWs([])
    const plain = makePlainWs()
    const probed = probeWorkspaces([wsA, hub, plain], {
      treeDir: DEFAULT_PROJECT_TREE_DIR,
      hubDir: DEFAULT_HUB_DIR,
    })
    expect(probed).toHaveLength(3)
    expect(probed[0]).toMatchObject({ path: wsA, hasHubDir: false, hasTreeDir: true, treeProjectId: 'PRJ-1' })
    expect(probed[1]).toMatchObject({ path: hub, hasHubDir: true, hasTreeDir: false })
    expect(probed[2]).toMatchObject({ path: plain, hasHubDir: false, hasTreeDir: false })
  })

  it('recognizes a RENAMED tree dir (the discovery only ever sees configured names — §3.1)', () => {
    const root = makeTemp('t22-renamed-')
    const researchRoot = join(root, 'my-tree')
    mkdirSync(researchRoot, { recursive: true })
    writeFileSync(join(researchRoot, 'project.yaml'), 'id: PRJ-7\n', 'utf8')
    const probed = probeWorkspaces([root], { treeDir: 'my-tree', hubDir: 'my-hub' })
    expect(probed[0]).toMatchObject({ hasTreeDir: true, treeProjectId: 'PRJ-7' })
    // …and the default names see nothing (a renamed tree is invisible to them).
    const defaultProbed = probeWorkspaces([root], {
      treeDir: DEFAULT_PROJECT_TREE_DIR,
      hubDir: DEFAULT_HUB_DIR,
    })
    expect(defaultProbed[0]).toMatchObject({ hasTreeDir: false, hasHubDir: false })
  })

  it('a same-named FILE is not a tree (the V1 directory probe rule)', () => {
    const root = makeTemp('t22-file-')
    writeFileSync(join(root, '.research'), 'not a directory\n', 'utf8')
    const probed = probeWorkspaces([root], {
      treeDir: DEFAULT_PROJECT_TREE_DIR,
      hubDir: DEFAULT_HUB_DIR,
    })
    expect(probed[0]).toMatchObject({ hasTreeDir: false })
  })

  it('renamed tree under a CONFIGURED name (settings present): init wires the configured treeDir — V2-T6.1-r1 regression', async () => {
    // The settings save's whole point (T2.1 §7.5): the operator renamed
    // the tree on disk (.research → my-tree) and saved the new name. The
    // NEXT re-init (a rescan, or a restart) must wire the project under
    // the CONFIGURED name. Pre-r1 the createHostWiring call dropped the
    // researchDir option, so the wiring probed the .research default and
    // failed WIRING_INPUT even though discovery had found the tree —
    // the two-phase save always rolled back. Discovery and the settings
    // plumbing were correct all along; this pins the wiring half.
    const home = freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    renameSync(join(wsA, DEFAULT_PROJECT_TREE_DIR), join(wsA, 'my-tree'))
    const hub = makeHubWs([
      {
        id: 'PRJ-1',
        path: wsA,
        displayName: '机器人视觉定位系统',
        status: 'active',
        boundAt: 1770000000000,
        archivedAt: null,
      },
    ])
    const h = mountHost([hub, wsA], {
      settings: { projectTreeDir: 'my-tree', hubDir: DEFAULT_HUB_DIR },
    })
    try {
      await initPlane(h)
      expectToolsRegistered(h)
      expect(logLines().some((l) => l.includes(`research hub discovered at ${hub}`))).toBe(true)
      expect(warnLines().filter((l) => l.includes('standalone research tree at'))).toHaveLength(0)
      expect(warnLines().filter((l) => l.includes('MISSING registered project'))).toHaveLength(0)
      // The managed db follows the hub under the (default) hubDir.
      expect(
        existsSync(join(hub, DEFAULT_HUB_DIR, 'projects', 'PRJ-1', 'research.sqlite')),
      ).toBe(true)
      // Byte-compat: the frozen RPC face routes to the sole project.
      const project = await h.svc.getProject()
      expect(project.project.id).toBe('PRJ-1')
      expect(project.project.title).toBe('机器人视觉定位系统')
    } finally {
      disposeFiber(h)
    }
  }, 30_000)
})
