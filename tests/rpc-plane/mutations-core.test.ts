/**
 * V2-T3.2b (part 1/2) — the plane-mutation CORE: setHub / rescan /
 * ackMissingReminder (design §12 rows 4/8/9), over the REAL discovery
 * + REAL temp workspaces.
 *
 * Style: the tests/rpc-plane/helpers.ts fake-fs discipline — real temp
 * roots under the OS temp dir (tracked, cleaned in afterAll), NO cordis
 * App, NO real user data, the configured dir names come from the
 * settings domain's DEFAULTS (never a hardcoded literal in a fixture).
 * The mutation port is driven DIRECTLY here (its `@Remote` wiring in
 * index.ts is the follow-up task): the production class is composed over
 * the REAL discovery half of `#initResearchPlane` — the exact §4 scan
 * index.ts runs (probe → the one-hub registry read, with the same
 * `REGISTRY_ABSENT` wrap → discoverPlane); the per-project rewiring is
 * out of scope for this suite (no wirings are composed).
 *
 * Coverage (the T3.2b-A1 brief + the plan gate 「每个方法至少一条拒绝
 * 路径」):
 *  - setHub: create (marker dir + EMPTY registry, the commit protocol —
 *    the plane refreshed by the re-init) / hub-already-exists
 *    (`PLANE_HUB_EXISTS` at another ws, `PLANE_HUB_MARKER_EXISTS` on the
 *    hub itself and on a since-created drift marker) / malformed-registry
 *    (the P2 `RegistryFormatError` fails loud BEFORE the refusal) /
 *    not-a-registered-workspace / a drift hub at ANOTHER ws (refused
 *    before the commit — no two-hub disk state ever created);
 *  - rescan: a fresh state after an fs change (the 重扫并连接 refresh) /
 *    the deferredReminders SURVIVAL across rescans (brief item (b)) +
 *    the flag is NOT persisted (registry text + hub dir unchanged; a
 *    fresh backend run — fresh discovery + fresh service — restores the
 *    reminder, design §14) / rejection paths (the pre-init guard; a
 *    re-init failure — two hubs on disk — propagates the §4
 *    `DiscoverError` verbatim; a marker without a registry →
 *    `REGISTRY_ABSENT`);
 *  - ackMissingReminder: a known MISSING id (acknowledged + the live
 *    plane state's flag set) / an unknown id (`PLANE_NOT_MISSING`) / a
 *    MANAGED id (`PLANE_NOT_MISSING`);
 *  - the MUTEX (brief item (a) — the QUEUE decision): two concurrent
 *    mutations → at most one in flight (the queued mutation cannot
 *    complete while the gated one is in flight), FIFO order, and a
 *    failed mutation does not poison the queue.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'

import {
  DEFAULT_HUB_DIR,
  DEFAULT_PROJECT_TREE_DIR,
  type ResearchDirNames,
} from '../../src/host/dsh-adapter/host/settings.js'
import {
  discoverPlane,
  probeWorkspaces,
  DiscoverError,
  type PlaneState,
} from '../../src/host/dsh-adapter/host/discovery.js'
import {
  ProductionResearchPlaneMutationServices,
  type ProductionResearchPlaneMutationServicesOptions,
} from '../../src/host/dsh-adapter/host/plane-mutation-services.js'
import { parseRegistry, serializeRegistry } from '../../src/host/domain/registry/index.js'
import { RegistryFormatError, type RegistryEntry } from '../../src/host/domain/registry/index.js'

/* ------------------------------------------------------------------ *
 * Temp plumbing (the helpers.ts pattern: tracked roots, afterAll sweep)
 * ------------------------------------------------------------------ */

const roots: string[] = []

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** The configured directory names — the settings domain's own defaults. */
const DIRS: ResearchDirNames = { treeDir: DEFAULT_PROJECT_TREE_DIR, hubDir: DEFAULT_HUB_DIR }

/** One epoch-ms carrier (the frozen §3.2 example value). */
const BOUND_AT = 1_770_000_000_000

/* ------------------------------------------------------------------ *
 * Workspace fixtures (minimal — the discovery probe reads only
 * project.yaml / the hub marker; no git repo needed in this suite)
 * ------------------------------------------------------------------ */

/** A plain (empty) registered workspace. */
function makePlainWs(): string {
  return makeTemp('t32b-plain-')
}

/**
 * A workspace carrying a MINIMAL `<treeDir>/` tree: just the
 * `project.yaml` the probe reads (the id — the routing key — and a
 * title for the STANDALONE display name).
 */
function makeTreeWs(projectId: string, title = '树项目'): string {
  const root = makeTemp('t32b-tree-')
  mkdirSync(join(root, DIRS.treeDir), { recursive: true })
  writeFileSync(
    join(root, DIRS.treeDir, 'project.yaml'),
    `id: ${projectId}\ntitle: ${title}\n`,
    'utf8',
  )
  return root
}

/** One active registry entry (canonicalized path — the §4 exact-equality contract). */
function activeEntry(id: string, path: string, displayName: string): RegistryEntry {
  return { id, path: resolve(path), displayName, status: 'active', boundAt: BOUND_AT, archivedAt: null }
}

/** A hub workspace: `<hubDir>/registry.yaml` with the given entries. */
function makeHubWs(entries: readonly RegistryEntry[]): string {
  const root = makeTemp('t32b-hub-')
  const hubDir = join(root, DIRS.hubDir)
  mkdirSync(hubDir, { recursive: true })
  writeFileSync(join(hubDir, 'registry.yaml'), serializeRegistry({ version: 1, projects: entries }), 'utf8')
  return root
}

/** Write a `<hubDir>/` marker with a (possibly malformed) registry at `ws`. */
function plantMarker(ws: string, registryText: string | null): void {
  const hubDir = join(ws, DIRS.hubDir)
  mkdirSync(hubDir, { recursive: true })
  if (registryText !== null) writeFileSync(join(hubDir, 'registry.yaml'), registryText, 'utf8')
}

/** A one-macrotask tick (let queued promises reach their await boundary). */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/* ------------------------------------------------------------------ *
 * The harness: the production mutation port over the REAL §4 scan
 * ------------------------------------------------------------------ */

interface MutationHarness {
  svc: ProductionResearchPlaneMutationServices
  /** The live plane state holder (the `#initResearchPlane` field stand-in — swapped by the re-init). */
  state: { plane: PlaneState | undefined }
  /** The registered DSH workspaces (mutable — a new registration is a push). */
  registered: string[]
}

/**
 * The re-init hook's DISCOVERY half — the exact §4 scan index.ts's
 * `#initResearchPlane` runs (module doc: the rewiring half composes the
 * HostWiring graph, which this suite does not build): probe → the
 * one-hub registry read (the `REGISTRY_ABSENT` wrap) → discoverPlane.
 */
function discover(registered: readonly string[]): PlaneState {
  const probed = probeWorkspaces([...registered], DIRS)
  const hubCandidates = probed.filter((p) => p.hasHubDir)
  if (hubCandidates.length >= 2) {
    // Two hubs: discoverPlane fails loud (MULTIPLE_HUBS) before any
    // registry read — the same short-circuit as index.ts.
    return discoverPlane(probed, DIRS, null)
  }
  let registryText: string | null = null
  if (hubCandidates.length === 1) {
    const registryPath = join(hubCandidates[0]!.path, DIRS.hubDir, 'registry.yaml')
    try {
      registryText = readFileSync(registryPath, 'utf8')
    } catch (cause) {
      throw new DiscoverError(
        'REGISTRY_ABSENT',
        `[research-control] the hub workspace ${hubCandidates[0]!.path} carries ${DIRS.hubDir}/ but its ` +
          `registry file is missing or unreadable: ${registryPath} — ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
      )
    }
  }
  return discoverPlane(probed, DIRS, registryText)
}

/** Compose the port over the registered workspaces (the `[Service.init]` stand-in). */
function mount(registered: readonly string[], options?: Partial<ProductionResearchPlaneMutationServicesOptions>): MutationHarness {
  const state: { plane: PlaneState | undefined } = { plane: discover(registered) }
  const harness: MutationHarness = { svc: undefined as unknown as ProductionResearchPlaneMutationServices, state, registered: [...registered] }
  harness.svc = new ProductionResearchPlaneMutationServices({
    getPlane: () => state.plane,
    listWorkspacePaths: () => harness.registered,
    dirNames: () => DIRS,
    reinitPlane: () => {
      state.plane = discover(harness.registered)
    },
    ...options,
  })
  return harness
}

/** A port with NO plane (the pre-init guard target — `[Service.init]` never ran). */
function uninitialized(): ProductionResearchPlaneMutationServices {
  return new ProductionResearchPlaneMutationServices({
    getPlane: () => undefined,
    listWorkspacePaths: () => [],
    dirNames: () => DIRS,
    reinitPlane: () => {
      throw new Error('unreachable — the pre-init guard must fire first')
    },
  })
}

/* ------------------------------------------------------------------ *
 * setHub (design §8 设为中枢 / §12 row 4)
 * ------------------------------------------------------------------ */

describe('setHub', () => {
  it('creates the hub marker dir + an EMPTY registry, and the plane refreshes', async () => {
    const ws = makePlainWs()
    const h = mount([ws])
    expect(h.state.plane!.hub).toBeNull()

    const result = await h.svc.setHub({ wsPath: ws })

    // The wire result (the canonicalized paths).
    expect(result.hubPath).toBe(resolve(ws))
    expect(result.registryPath).toBe(join(resolve(ws), DIRS.hubDir, 'registry.yaml'))
    // The fs: the marker dir + a PARSEABLE empty registry (the §3.2 shape).
    expect(statSync(join(resolve(ws), DIRS.hubDir)).isDirectory()).toBe(true)
    expect(statSync(result.registryPath).isFile()).toBe(true)
    const file = parseRegistry(readFileSync(result.registryPath, 'utf8'))
    expect(file).toEqual({ version: 1, projects: [] })
    // The re-init ran: the live plane state carries the new hub.
    expect(h.state.plane!.hub).toEqual({ path: resolve(ws) })
  })

  it('refuses when the plane already carries a hub (PLANE_HUB_EXISTS)', async () => {
    const hubWs = makeHubWs([])
    const plainWs = makePlainWs()
    const h = mount([hubWs, plainWs])

    await expect(h.svc.setHub({ wsPath: plainWs })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_HUB_EXISTS',
    })
    // The message names the existing hub (the operator's remedy).
    await expect(h.svc.setHub({ wsPath: plainWs })).rejects.toThrow(resolve(hubWs))
    // The target was not touched (no partial hub created).
    expect(existsSync(join(plainWs, DIRS.hubDir))).toBe(false)
  })

  it('refuses the hub workspace itself (PLANE_HUB_MARKER_EXISTS)', async () => {
    const hubWs = makeHubWs([])
    const h = mount([hubWs])

    await expect(h.svc.setHub({ wsPath: hubWs })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_HUB_MARKER_EXISTS',
    })
    // The existing registry is untouched (no clobber).
    expect(parseRegistry(readFileSync(join(hubWs, DIRS.hubDir, 'registry.yaml'), 'utf8'))).toEqual({
      version: 1,
      projects: [],
    })
  })

  it('refuses a since-created drift marker (PLANE_HUB_MARKER_EXISTS, state-fresh)', async () => {
    const ws = makePlainWs()
    const h = mount([ws])
    // The marker appeared AFTER the last discovery (the plane state is stale).
    plantMarker(ws, serializeRegistry({ version: 1, projects: [] }))

    await expect(h.svc.setHub({ wsPath: ws })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_HUB_MARKER_EXISTS',
    })
    // The registry that was there is untouched (setHub never repairs/adopts).
    expect(parseRegistry(readFileSync(join(ws, DIRS.hubDir, 'registry.yaml'), 'utf8'))).toEqual({
      version: 1,
      projects: [],
    })
  })

  it('fails loud on a MALFORMED registry at the target (the P2 registry-kernel error, before the refusal)', async () => {
    const ws = makePlainWs()
    const h = mount([ws])
    plantMarker(ws, 'version: banana\nprojects: []\n')

    await expect(h.svc.setHub({ wsPath: ws })).rejects.toThrow(RegistryFormatError)
    // The structured code rides the error (the P2 fail-loud shape).
    await expect(h.svc.setHub({ wsPath: ws })).rejects.toMatchObject({
      name: 'RegistryFormatError',
      code: 'SCHEMA',
    })
  })

  it('refuses a target that is not a registered workspace (PLANE_NOT_REGISTERED_WORKSPACE)', async () => {
    const h = mount([makePlainWs()])
    const unregistered = makePlainWs()

    await expect(h.svc.setHub({ wsPath: unregistered })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_NOT_REGISTERED_WORKSPACE',
    })
    expect(existsSync(join(unregistered, DIRS.hubDir))).toBe(false)
  })

  it('refuses BEFORE the commit when a drift hub exists at ANOTHER ws (no two-hub disk state)', async () => {
    const target = makePlainWs()
    const other = makePlainWs()
    const h = mount([target, other])
    // A hub materialized on disk at `other` since the last discovery.
    plantMarker(other, serializeRegistry({ version: 1, projects: [] }))

    await expect(h.svc.setHub({ wsPath: target })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_HUB_EXISTS',
    })
    await expect(h.svc.setHub({ wsPath: target })).rejects.toThrow(resolve(other))
    // The refusal happened BEFORE the commit: the target carries no hub.
    expect(existsSync(join(target, DIRS.hubDir))).toBe(false)
  })

  it('fails loud pre-init (the read port\'s spike-mode guard, mutation wording)', async () => {
    const svc = uninitialized()
    await expect(svc.setHub({ wsPath: '/nonexistent/ws' })).rejects.toThrow(/not initialized/)
  })
})

/* ------------------------------------------------------------------ *
 * rescan (design §4 as an RPC / §12 row 8)
 * ------------------------------------------------------------------ */

describe('rescan', () => {
  it('re-runs discovery over the plane and returns the fresh state', async () => {
    const hubWs = makeHubWs([])
    const h = mount([hubWs])
    // A new workspace registered + carrying a tree (the fs changed since
    // the last discovery — the 重扫并连接 case).
    const projWs = makeTreeWs('PRJ-1', '新接入项目')
    h.registered.push(projWs)
    expect(h.state.plane!.projects).toEqual([])

    const summary = await h.svc.rescan({})

    // The fresh summary (the PlaneStateSummary, no session segment).
    expect(summary.hub).toEqual({ path: resolve(hubWs) })
    expect(summary.dirNames).toEqual(DIRS)
    expect(summary.projects).toEqual([
      {
        projectId: 'PRJ-1',
        displayName: '新接入项目',
        kind: 'STANDALONE',
        wsPath: resolve(projWs),
      },
    ])
    expect(summary.missing).toEqual([])
    // The live plane state was swapped by the re-init.
    expect(h.state.plane!.projects.map((p) => p.projectId)).toEqual(['PRJ-1'])
  })

  it('the deferredReminders SURVIVE a rescan (and the flag is never persisted)', async () => {
    const treeWs = makeTreeWs('PRJ-1', '受管项目')
    // PRJ-2 has no tree (MISSING) — the reminder candidate.
    const missingPath = makePlainWs()
    const hubWs = makeHubWs([
      activeEntry('PRJ-1', treeWs, '受管项目'),
      activeEntry('PRJ-2', missingPath, '缺失项目'),
    ])
    const h = mount([hubWs, treeWs])
    expect(h.state.plane!.missing.map((e) => e.id)).toEqual(['PRJ-2'])

    await h.svc.ackMissingReminder({ projectId: 'PRJ-2' })
    // The live plane state carries the flag (the read port's wire source).
    expect(h.state.plane!.deferredReminders.has('PRJ-2')).toBe(true)

    // The non-persistence baseline: the registry text + the hub dir
    // contents, BEFORE any rescan after the ack.
    const registryText = readFileSync(join(hubWs, DIRS.hubDir, 'registry.yaml'), 'utf8')
    const hubDirEntries = readdirSync(join(hubWs, DIRS.hubDir)).sort()

    // Two rescans — the flag must survive BOTH (brief item (b)).
    const first = await h.svc.rescan({})
    expect(first.missing).toEqual([
      { projectId: 'PRJ-2', displayName: '缺失项目', wsPath: resolve(missingPath), deferred: true },
    ])
    const second = await h.svc.rescan({})
    expect(second.missing[0]!.deferred).toBe(true)

    // Nothing was persisted (design §14: in-memory, per backend run).
    expect(readFileSync(join(hubWs, DIRS.hubDir, 'registry.yaml'), 'utf8')).toBe(registryText)
    expect(readdirSync(join(hubWs, DIRS.hubDir)).sort()).toEqual(hubDirEntries)

    // A FRESH backend run (fresh discovery + fresh service) restores the
    // reminder, by design.
    const freshRun = mount([hubWs, treeWs])
    const s = await freshRun.svc.rescan({})
    expect(s.missing[0]!.deferred).toBe(false)
  })

  it('propagates the §4 fail-loud re-init failure (two hubs → MULTIPLE_HUBS, state left in place)', async () => {
    const hubA = makeHubWs([])
    const hubB = makePlainWs()
    const h = mount([hubA, hubB])
    // A second hub materialized on disk since the last discovery.
    plantMarker(hubB, serializeRegistry({ version: 1, projects: [] }))

    await expect(h.svc.rescan({})).rejects.toThrow(DiscoverError)
    await expect(h.svc.rescan({})).rejects.toMatchObject({ code: 'MULTIPLE_HUBS' })
    // The previous plane state was left in place (the hook contract).
    expect(h.state.plane!.hub).toEqual({ path: resolve(hubA) })
  })

  it('propagates a marker-without-registry re-init failure (REGISTRY_ABSENT)', async () => {
    const ws = makePlainWs()
    const h = mount([ws])
    // An INCOMPLETE hub (the marker dir, no registry) materialized on disk.
    plantMarker(ws, null)

    await expect(h.svc.rescan({})).rejects.toMatchObject({ code: 'REGISTRY_ABSENT' })
    expect(h.state.plane!.hub).toBeNull()
  })

  it('fails loud pre-init (the read port\'s spike-mode guard, mutation wording)', async () => {
    const svc = uninitialized()
    await expect(svc.rescan({})).rejects.toThrow(/not initialized/)
  })
})

/* ------------------------------------------------------------------ *
 * ackMissingReminder (design §4 「推后处理」 / §12 row 9)
 * ------------------------------------------------------------------ */

describe('ackMissingReminder', () => {
  function missingPlane(): { h: MutationHarness; hubWs: string; treeWs: string; missingPath: string } {
    const treeWs = makeTreeWs('PRJ-1', '受管项目')
    const missingPath = makePlainWs()
    const hubWs = makeHubWs([
      activeEntry('PRJ-1', treeWs, '受管项目'),
      activeEntry('PRJ-2', missingPath, '缺失项目'),
    ])
    const h = mount([hubWs, treeWs])
    expect(h.state.plane!.missing.map((e) => e.id)).toEqual(['PRJ-2'])
    return { h, hubWs, treeWs, missingPath }
  }

  it('acks a KNOWN missing id: acknowledged + the live plane flag set', async () => {
    const { h } = missingPlane()

    const result = await h.svc.ackMissingReminder({ projectId: 'PRJ-2' })

    expect(result).toEqual({ acknowledged: true })
    // The flag is live WITHOUT a rescan (the read port serves it now).
    expect(h.state.plane!.deferredReminders.has('PRJ-2')).toBe(true)
    // Idempotent: a second ack of the same id succeeds (the flag is a set).
    await expect(h.svc.ackMissingReminder({ projectId: 'PRJ-2' })).resolves.toEqual({ acknowledged: true })
  })

  it('refuses an UNKNOWN id (PLANE_NOT_MISSING)', async () => {
    const { h } = missingPlane()

    await expect(h.svc.ackMissingReminder({ projectId: 'PRJ-9' })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_NOT_MISSING',
    })
    expect(h.state.plane!.deferredReminders.size).toBe(0)
  })

  it('refuses a MANAGED (not-missing) id (PLANE_NOT_MISSING)', async () => {
    const { h } = missingPlane()

    await expect(h.svc.ackMissingReminder({ projectId: 'PRJ-1' })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_NOT_MISSING',
    })
  })

  it('fails loud pre-init (the read port\'s spike-mode guard, mutation wording)', async () => {
    const svc = uninitialized()
    await expect(svc.ackMissingReminder({ projectId: 'PRJ-1' })).rejects.toThrow(/not initialized/)
  })
})

/* ------------------------------------------------------------------ *
 * The mutation MUTEX (brief item (a) — the QUEUE decision: serialize,
 * one in flight at a time; no rejection, no PLANE_* busy code — the
 * frozen §12 vocabulary has none, and the module header documents why)
 * ------------------------------------------------------------------ */

describe('the mutation mutex', () => {
  it('serializes two concurrent mutations: one in flight, FIFO, the queue is not poisoned by a failure', async () => {
    const hubWs = makeHubWs([activeEntry('PRJ-2', makePlainWs(), '缺失项目')])
    const h = mount([hubWs])
    expect(h.state.plane!.missing.map((e) => e.id)).toEqual(['PRJ-2'])

    // A re-init hook gated by the test: the FIRST mutation holds the
    // lock behind the gate while the second waits in the queue.
    const order: string[] = []
    let gate: Promise<void> = Promise.resolve()
    let releaseGate: () => void = () => {}
    gate = new Promise<void>((r) => {
      releaseGate = r
    })
    h.svc = new ProductionResearchPlaneMutationServices({
      getPlane: () => h.state.plane,
      listWorkspacePaths: () => h.registered,
      dirNames: () => DIRS,
      reinitPlane: async () => {
        order.push('rescan-reinit')
        await gate
        h.state.plane = discover(h.registered)
      },
    })

    // Two CONCURRENT mutations (same tick): the gated rescan + the
    // sync-critical-section ack.
    const p1 = h.svc.rescan({})
    await tick()
    await tick()
    const p2 = h.svc.ackMissingReminder({ projectId: 'PRJ-2' })
    expect(order).toEqual(['rescan-reinit'])

    // While p1 is IN FLIGHT (behind the gate), p2 must NOT be able to
    // complete — one mutation in flight at a time (the queue holds it).
    let p2Settled = false
    void p2.then(
      () => {
        p2Settled = true
      },
      () => {
        p2Settled = true
      },
    )
    await tick()
    await tick()
    expect(p2Settled).toBe(false)

    // Release the gate: p1 completes FIRST, then p2 (FIFO order).
    releaseGate()
    const s1 = await p1
    // The ack ran AFTER the rescan (it is queued behind p1): at p1's
    // settlement the flag is not there yet.
    expect(s1.missing[0]!.deferred).toBe(false)
    const r2 = await p2
    expect(r2).toEqual({ acknowledged: true })
    // The ack is a pure memory write (no re-init) — and it ran against
    // the FRESH post-rescan plane state (the flag landed there).
    expect(order).toEqual(['rescan-reinit'])
    expect(h.state.plane!.deferredReminders.has('PRJ-2')).toBe(true)
  })

  it('a failed mutation does not poison the queue (the next waiter still runs)', async () => {
    const hubWs = makeHubWs([])
    const h = mount([hubWs])
    let failNext = true
    h.svc = new ProductionResearchPlaneMutationServices({
      getPlane: () => h.state.plane,
      listWorkspacePaths: () => h.registered,
      dirNames: () => DIRS,
      reinitPlane: () => {
        if (failNext) {
          failNext = false
          throw new Error('boom — simulated re-init failure')
        }
        h.state.plane = discover(h.registered)
      },
    })

    const p1 = h.svc.rescan({})
    const p2 = h.svc.rescan({}) // queued behind the failing one

    await expect(p1).rejects.toThrow('boom — simulated re-init failure')
    // The queue survived the failure: p2 still runs and completes.
    const s2 = await p2
    expect(s2.hub).toEqual({ path: resolve(hubWs) })
    // And the plane state is intact (the failure swapped nothing).
    expect(h.state.plane!.hub).toEqual({ path: resolve(hubWs) })
  })

  it('serializes a setHub against a concurrent rescan (the commit is under the lock)', async () => {
    const target = makePlainWs()
    const h = mount([target])

    // Gate the setHub's post-commit re-init; the concurrent rescan must
    // wait for the WHOLE setHub (commit + re-init), not just the fs.
    let gate: Promise<void> = Promise.resolve()
    let releaseGate: () => void = () => {}
    gate = new Promise<void>((r) => {
      releaseGate = r
    })
    h.svc = new ProductionResearchPlaneMutationServices({
      getPlane: () => h.state.plane,
      listWorkspacePaths: () => h.registered,
      dirNames: () => DIRS,
      reinitPlane: async () => {
        await gate
        h.state.plane = discover(h.registered)
      },
    })

    const pSetHub = h.svc.setHub({ wsPath: target })
    await tick()
    await tick()
    // The setHub is IN FLIGHT (behind the gate) — the marker dir exists
    // (committed) but the re-init has not run yet (the plane is stale).
    expect(existsSync(join(target, DIRS.hubDir))).toBe(true)
    const pRescan = h.svc.rescan({})
    let rescanSettled = false
    void pRescan.then(
      () => {
        rescanSettled = true
      },
      () => {
        rescanSettled = true
      },
    )
    await tick()
    await tick()
    // The rescan CANNOT run while the setHub holds the lock (a rescan
    // here would see the committed-but-unrescanned hub mid-commit).
    expect(rescanSettled).toBe(false)

    releaseGate()
    const setHubResult = await pSetHub
    expect(setHubResult.hubPath).toBe(resolve(target))
    // Then the rescan runs (FIFO) over the fresh plane state.
    const s = await pRescan
    expect(s.hub).toEqual({ path: resolve(target) })
    expect(h.state.plane!.hub).toEqual({ path: resolve(target) })
  })
})
