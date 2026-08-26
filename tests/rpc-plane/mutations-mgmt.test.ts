/**
 * V2-T3.2b (part 2/2) — the plane-mutation MANAGEMENT layer:
 * bindProject / unbindProject / restoreProject (design §8 接入 /
 * 解除绑定 / 恢复登记; §12 rows 5-7), over the REAL discovery + REAL
 * temp workspaces + the REAL storage-locations migration (node:fs io
 * wrapped by a move-recording fake) + the REAL sqlite store.
 *
 * Style: the mutations-core.test.ts (part 1) harness — real temp roots
 * under the OS temp dir (tracked, cleaned in afterAll), NO cordis App,
 * the configured dir names from the settings domain's DEFAULTS, the
 * production port driven DIRECTLY (its `@Remote` wiring in index.ts is
 * the follow-up task). The fixed clock (`now`) makes every
 * `<treeDir>.archived-<时间戳>` name and every `boundAt`/`archivedAt`
 * stamp deterministic.
 *
 * Coverage (the T3.2b-A2 brief 「每个方法至少一条 fail-loud 拒绝路径」):
 *  - bindProject: a full bind WITH a live standalone db — the P2
 *    leftover ordering proven by event order (the seal spy records the
 *    close + WAL checkpoint; the io wrapper records the file move:
 *    seal < move, the file at the SOURCE at seal time), the registry
 *    commit with a fresh boundAt, the migrated db re-opened and its
 *    event read back / bind without a db (no seal, no projects/ dir) /
 *    scaffold (id = max+1 over registry ∪ tree ids, tombstone ids
 *    burned) / `PLANE_TREE_EXISTS` / `PLANE_TREE_MISSING` /
 *    `PLANE_ALREADY_MANAGED` (active claim / different-id tombstone /
 *    the id issued elsewhere in the stale-state corner) / the same-id
 *    tombstone REBIND (the upsert replaces in place, no duplicate) /
 *    the no-hub STANDALONE flow (接入（无中枢）: `registryPath: null`) /
 *    `PLANE_HUB_EXISTS` (stale no-hub state over a drifted marker) /
 *    `PLANE_HUB_WORKSPACE` (the hub ws itself + a drifted marker) /
 *    `PLANE_NOT_REGISTERED_WORKSPACE` / the missing seal seam (a plain
 *    Error — the frozen vocabulary has no code for a wiring gap).
 *  - unbindProject: a full unbind (the entry ARCHIVED — never deleted —
 *    the tree renamed to `<treeDir>.archived-<ts>`, the hub db
 *    UNTOUCHED, the fresh state clean of the project) /
 *    `PLANE_NOT_MANAGED` (standalone tree / a MISSING entry / no hub) /
 *    `PLANE_NOT_REGISTERED_WORKSPACE` / `PLANE_TARGET_NAME_TAKEN`
 *    (the pre-commit collision: registry + tree untouched).
 *  - restoreProject: a full unbind→restore round trip (the tree renamed
 *    back, the entry re-activated with `archivedAt: null`, `boundAt`
 *    PRESERVED, the hub db untouched) / `PLANE_NOT_ARCHIVED` (an active
 *    entry / an unknown id / a hubless plane) / `PLANE_HUB_EXISTS`
 *    (stale no-hub drift) / `PLANE_ARCHIVED_DIR_MISSING` /
 *    `PLANE_TARGET_NAME_TAKEN`.
 *
 *  The restore rung 「no OTHER active entry may claim the path」 is a
 *  defensive invariant, unreachable through healthy discovery: the
 *  discovery's `DUPLICATE_ENTRY_PATH` refusal forbids ANY two entries
 *  (active or archived) on one path, so no discoverable state can carry
 *  both a tombstone and a rival active claim at one workspace.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
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
import {
  parseRegistry,
  serializeRegistry,
  type RegistryEntry,
} from '../../src/host/domain/registry/index.js'
import {
  DB_FILE_NAME,
  nodeFsStorageIo,
  type StorageLocationsFs,
} from '../../src/host/service/storage-locations/index.js'
import { openDatabase, type HistoryEventInput } from '../../src/host/persistence/store/index.js'

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

/** The registry `boundAt` carrier (the frozen §3.2 example value). */
const BOUND_AT = 1_770_000_000_000
/** The fixed mutation clock — every stamp this suite writes is deterministic. */
const NOW = 1_770_000_000_123
/** The unbind/restore rename name the fixed clock produces. */
const ARCHIVED_SUFFIX = `${DIRS.treeDir}.archived-${NOW}`

/* ------------------------------------------------------------------ *
 * Workspace fixtures (minimal — the discovery probe reads only
 * project.yaml / the hub marker; no git repo needed in this suite)
 * ------------------------------------------------------------------ */

/** A plain (empty) registered workspace. */
function makePlainWs(): string {
  return makeTemp('t32b-mgmt-plain-')
}

/** A workspace carrying a MINIMAL `<treeDir>/` tree (`project.yaml`). */
function makeTreeWs(projectId: string, title = '树项目'): string {
  const root = makeTemp('t32b-mgmt-tree-')
  mkdirSync(join(root, DIRS.treeDir), { recursive: true })
  writeFileSync(join(root, DIRS.treeDir, 'project.yaml'), `id: ${projectId}\ntitle: ${title}\n`, 'utf8')
  return root
}

/** One ACTIVE registry entry (canonicalized path — the §4 exact-equality contract). */
function activeEntry(id: string, path: string, displayName: string): RegistryEntry {
  return { id, path: resolve(path), displayName, status: 'active', boundAt: BOUND_AT, archivedAt: null }
}

/** One ARCHIVED tombstone entry (the 解绑 remnant; `boundAt` preserved from bind). */
function archivedEntry(id: string, path: string, displayName: string, archivedAt: number): RegistryEntry {
  return { id, path: resolve(path), displayName, status: 'archived', boundAt: BOUND_AT, archivedAt }
}

/** A hub workspace: `<hubDir>/registry.yaml` with the given entries. */
function makeHubWs(entries: readonly RegistryEntry[]): string {
  const root = makeTemp('t32b-mgmt-hub-')
  const hubDir = join(root, DIRS.hubDir)
  mkdirSync(hubDir, { recursive: true })
  writeFileSync(join(hubDir, 'registry.yaml'), serializeRegistry({ version: 1, projects: entries }), 'utf8')
  return root
}

/** Write a `<hubDir>/` marker with a (possibly empty) registry at `ws` — the post-init drift. */
function plantMarker(ws: string, registryText: string): void {
  const hubDir = join(ws, DIRS.hubDir)
  mkdirSync(hubDir, { recursive: true })
  writeFileSync(join(hubDir, 'registry.yaml'), registryText, 'utf8')
}

/* ------------------------------------------------------------------ *
 * Discovery + port composition (the part-1 harness, verbatim shape)
 * ------------------------------------------------------------------ */

/** The exact §4 scan index.ts runs: probe → the one-hub registry read → discoverPlane. */
function discover(registered: readonly string[]): PlaneState {
  const probed = probeWorkspaces(registered.map((p) => resolve(p)), DIRS)
  const hubCandidates = probed.filter((w) => w.hasHubDir)
  if (hubCandidates.length >= 2) {
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

interface MgmtHarness {
  svc: ProductionResearchPlaneMutationServices
  state: { plane: PlaneState | undefined }
  registered: string[]
}

/** Compose the port over the registered workspaces (the `[Service.init]` stand-in). */
function mount(registered: readonly string[], options?: Partial<ProductionResearchPlaneMutationServicesOptions>): MgmtHarness {
  const state: { plane: PlaneState | undefined } = { plane: discover(registered) }
  const harness: MgmtHarness = { svc: undefined as unknown as ProductionResearchPlaneMutationServices, state, registered: [...registered] }
  harness.svc = new ProductionResearchPlaneMutationServices({
    getPlane: () => state.plane,
    listWorkspacePaths: () => harness.registered,
    dirNames: () => DIRS,
    reinitPlane: () => {
      state.plane = discover(harness.registered)
    },
    // The fixed clock by default (every mutation stamp deterministic);
    // callers may override with their own `now`.
    now: () => NOW,
    ...options,
  })
  return harness
}

/* ------------------------------------------------------------------ *
 * The seal spy + the move-recording io (the P2 ordering proof)
 * ------------------------------------------------------------------ */

/** A minimal frozen-envelope event (store-level: no validation hook). */
function makeEvent(eventId = 'H-0'): HistoryEventInput {
  return {
    eventId,
    ownerWorkstreamId: 'WS-1',
    eventType: 'RUN_STARTED',
    schemaVersion: 1,
    occurredAt: BOUND_AT,
    actor: { kind: 'USER', user_id: 'u-alice' },
    payload: { run_id: 'R-0' },
  }
}

/**
 * The `sealStandaloneDb` stand-in (what the production host service
 * composes over its plane wirings): WAL-checkpoint + CLOSE the project's
 * live connection BEFORE any file moves — the persistence/store close
 * discipline (closing the last WAL connection runs the final checkpoint
 * and removes the -wal/-shm siblings: one clean main file). Records
 * `seal:<present|absent>` at entry (the file must still be at the
 * SOURCE), `sealed:closed` after the close, and
 * `postclose:wal-<absent|present>` as the checkpoint proof.
 */
function makeSealSpy(events: string[], store: { close(): void }): (projectId: string, dbPath: string) => Promise<void> {
  return async (projectId, dbPath) => {
    events.push(`seal:${projectId}:${existsSync(dbPath) ? 'present' : 'absent'}`)
    store.close()
    events.push('sealed:closed')
    events.push(`postclose:wal-${existsSync(`${dbPath}-wal`) ? 'present' : 'absent'}`)
  }
}

/** A node:fs io wrapper recording every `move` (the migration's file work). */
function makeRecordingIo(events: string[]): StorageLocationsFs {
  const base = nodeFsStorageIo()
  return {
    exists: (p) => base.exists(p),
    isFile: (p) => base.isFile(p),
    isDirectory: (p) => base.isDirectory(p),
    readdir: (p) => base.readdir(p),
    readHead: (p, n) => base.readHead(p, n),
    move: (from, to) => {
      events.push(`move:${from}->${to}`)
      base.move(from, to)
    },
  }
}

/* ------------------------------------------------------------------ *
 * bindProject (design §8 接入 / §12 row 5)
 * ------------------------------------------------------------------ */

describe('bindProject (T3.2b-A2)', () => {
  it('binds a project WITH a live standalone db: seal (close + checkpoint) BEFORE the move, registry LAST', async () => {
    const hub = makeHubWs([])
    const ws = makeTreeWs('PRJ-1', '树项目')
    // The LIVE standalone connection (the one-copy invariant §9): opened,
    // one event appended, and KEPT OPEN across the bind.
    const source = join(ws, DIRS.treeDir, 'state', DB_FILE_NAME)
    const store = openDatabase(source, { now: () => NOW })
    store.appendEvents([makeEvent('H-BIND-1')])

    const events: string[] = []
    const h = mount([hub, ws], {
      sealStandaloneDb: makeSealSpy(events, store),
      storageIo: makeRecordingIo(events),
    })

    const r = await h.svc.bindProject({ wsPath: ws, displayName: '展示名' })
    expect(r).toEqual({
      projectId: 'PRJ-1',
      registryPath: join(hub, DIRS.hubDir, 'registry.yaml'),
      dbMigrated: true,
    })

    // THE P2 leftover ordering: the seal (close + checkpoint) is recorded
    // BEFORE the migration's move; at seal time the file was still at the
    // source; the close left a single clean main file (the -wal sibling is
    // gone) — so the move carried exactly one file.
    const dest = join(hub, DIRS.hubDir, 'projects', 'PRJ-1', DB_FILE_NAME)
    const moves = events.filter((e) => e.startsWith('move:'))
    expect(moves).toEqual([`move:${source}->${dest}`])
    const sealIdx = events.findIndex((e) => e.startsWith('seal:'))
    expect(sealIdx).toBeGreaterThanOrEqual(0)
    expect(events[sealIdx]).toBe('seal:PRJ-1:present')
    expect(events.indexOf('sealed:closed')).toBeGreaterThan(sealIdx)
    expect(events[events.indexOf('sealed:closed') + 1]).toBe('postclose:wal-absent')
    expect(sealIdx).toBeLessThan(events.indexOf(moves[0]!))

    // The source is gone (move + verify + delete — never a copy), the
    // destination carries the data (re-opened, the event read back).
    expect(existsSync(source)).toBe(false)
    expect(existsSync(dest)).toBe(true)
    const reopened = openDatabase(dest, { now: () => NOW })
    expect(reopened.getEvent('WS-1', 1)?.eventId).toBe('H-BIND-1')
    reopened.close()

    // The registry committed LAST, with the fresh boundAt.
    const file = parseRegistry(readFileSync(join(hub, DIRS.hubDir, 'registry.yaml'), 'utf8'))
    expect(file.projects).toEqual([
      { id: 'PRJ-1', path: resolve(ws), displayName: '展示名', status: 'active', boundAt: NOW, archivedAt: null },
    ])

    // The fresh plane classifies the workspace as MANAGED.
    const proj = h.state.plane!.projects.find((p) => p.wsPath === resolve(ws))
    expect(proj).toEqual(expect.objectContaining({ kind: 'MANAGED', projectId: 'PRJ-1' }))
  })

  it('binds a tree WITHOUT a standalone db: no seal, no projects/ dir, default display name', async () => {
    const hub = makeHubWs([])
    const ws = makeTreeWs('PRJ-1')
    const sealCalls: Array<[string, string]> = []
    const h = mount([hub, ws], {
      sealStandaloneDb: (projectId, dbPath) => {
        sealCalls.push([projectId, dbPath])
      },
    })

    const r = await h.svc.bindProject({ wsPath: ws })
    expect(r).toEqual({ projectId: 'PRJ-1', registryPath: join(hub, DIRS.hubDir, 'registry.yaml'), dbMigrated: false })
    expect(sealCalls).toEqual([])
    // No db → no per-project data dir under the hub at all.
    expect(existsSync(join(hub, DIRS.hubDir, 'projects'))).toBe(false)
    const file = parseRegistry(readFileSync(join(hub, DIRS.hubDir, 'registry.yaml'), 'utf8'))
    // Omitted displayName → the host default (the folder name, §8 弹窗收集).
    expect(file.projects).toEqual([
      { id: 'PRJ-1', path: resolve(ws), displayName: basename(ws), status: 'active', boundAt: NOW, archivedAt: null },
    ])
  })

  it('scaffolds a minimal tree and allocates the next id over registry ∪ tree ids (tombstone ids burned)', async () => {
    const other = makePlainWs()
    const ws = makePlainWs()
    // A burned id: an archived tombstone whose tree no longer exists.
    const hub = makeHubWs([archivedEntry('PRJ-1', other, '已烧号', NOW)])
    const h = mount([hub, other, ws])

    const r = await h.svc.bindProject({ wsPath: ws, displayName: '脚手架', scaffold: true })
    // max(registry ∪ tree ids) + 1 — the P2 allocator precedent (no reuse).
    expect(r).toEqual({ projectId: 'PRJ-2', registryPath: join(hub, DIRS.hubDir, 'registry.yaml'), dbMigrated: false })
    const treeYaml = readFileSync(join(ws, DIRS.treeDir, 'project.yaml'), 'utf8')
    expect(treeYaml).toContain('id: PRJ-2')
    expect(treeYaml).toContain('title: 脚手架')
    const file = parseRegistry(readFileSync(join(hub, DIRS.hubDir, 'registry.yaml'), 'utf8'))
    expect(file.projects).toEqual([
      archivedEntry('PRJ-1', other, '已烧号', NOW),
      { id: 'PRJ-2', path: resolve(ws), displayName: '脚手架', status: 'active', boundAt: NOW, archivedAt: null },
    ])
  })

  it('refuses to scaffold over an existing tree (PLANE_TREE_EXISTS)', async () => {
    const hub = makeHubWs([])
    const ws = makeTreeWs('PRJ-1')
    const h = mount([hub, ws])

    await expect(h.svc.bindProject({ wsPath: ws, scaffold: true })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_TREE_EXISTS',
    })
    // The tree is untouched (the scaffold never clobbers).
    expect(readFileSync(join(ws, DIRS.treeDir, 'project.yaml'), 'utf8')).toContain('id: PRJ-1')
  })

  it('refuses a workspace with no tree and no scaffold (PLANE_TREE_MISSING)', async () => {
    const hub = makeHubWs([])
    const ws = makePlainWs()
    const h = mount([hub, ws])

    await expect(h.svc.bindProject({ wsPath: ws })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_TREE_MISSING',
    })
    expect(existsSync(join(ws, DIRS.treeDir))).toBe(false)
  })

  it('refuses a bind over an ACTIVE claim (PLANE_ALREADY_MANAGED)', async () => {
    const ws = makeTreeWs('PRJ-1')
    const hub = makeHubWs([activeEntry('PRJ-1', ws, '已绑定')])
    const h = mount([hub, ws])

    await expect(h.svc.bindProject({ wsPath: ws })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_ALREADY_MANAGED',
    })
    // The registry is untouched (no silent upsert).
    const file = parseRegistry(readFileSync(join(hub, DIRS.hubDir, 'registry.yaml'), 'utf8'))
    expect(file.projects).toEqual([activeEntry('PRJ-1', ws, '已绑定')])
  })

  it('refuses a bind over a different-id tombstone (PLANE_ALREADY_MANAGED)', async () => {
    const ws = makeTreeWs('PRJ-1')
    const hub = makeHubWs([archivedEntry('PRJ-2', ws, '旧条目', NOW)])
    const h = mount([hub, ws])

    await expect(h.svc.bindProject({ wsPath: ws })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_ALREADY_MANAGED',
    })
  })

  it('refuses a bind whose tree id is issued elsewhere (PLANE_ALREADY_MANAGED, stale-state corner)', async () => {
    const other = makeTreeWs('PRJ-1')
    const ws = makePlainWs()
    const hub = makeHubWs([activeEntry('PRJ-1', other, '已绑定')])
    const h = mount([hub, other, ws])
    // The stale-state corner: after the init discovery, a tree carrying
    // the issued id appears at the target (the state predates it).
    mkdirSync(join(ws, DIRS.treeDir), { recursive: true })
    writeFileSync(join(ws, DIRS.treeDir, 'project.yaml'), 'id: PRJ-1\ntitle: 冲突树\n', 'utf8')

    await expect(h.svc.bindProject({ wsPath: ws })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_ALREADY_MANAGED',
    })
  })

  it('rebinds a same-id tombstone in place (the upsert replaces, no duplicate entry)', async () => {
    const ws = makeTreeWs('PRJ-1')
    const hub = makeHubWs([archivedEntry('PRJ-1', ws, '旧展示名', NOW)])
    const h = mount([hub, ws])

    const r = await h.svc.bindProject({ wsPath: ws, displayName: '新展示名' })
    expect(r).toEqual({ projectId: 'PRJ-1', registryPath: join(hub, DIRS.hubDir, 'registry.yaml'), dbMigrated: false })
    // ONE entry: the tombstone was replaced in place (registry order kept).
    const file = parseRegistry(readFileSync(join(hub, DIRS.hubDir, 'registry.yaml'), 'utf8'))
    expect(file.projects).toEqual([
      { id: 'PRJ-1', path: resolve(ws), displayName: '新展示名', status: 'active', boundAt: NOW, archivedAt: null },
    ])
    const proj = h.state.plane!.projects.find((p) => p.wsPath === resolve(ws))
    expect(proj).toEqual(expect.objectContaining({ kind: 'MANAGED', projectId: 'PRJ-1' }))
  })

  it('binds over a NO-HUB plane as the standalone flow (registryPath: null, 接入（无中枢）)', async () => {
    const ws = makeTreeWs('PRJ-1')
    const h = mount([ws])
    expect(h.state.plane!.hub).toBeNull()

    const r = await h.svc.bindProject({ wsPath: ws })
    // The frozen T3.1 contract: a no-hub bind is a SUCCESS — the
    // standalone flow (no registry to append to; the db stays put).
    expect(r).toEqual({ projectId: 'PRJ-1', registryPath: null, dbMigrated: false })
    expect(h.state.plane!.hub).toBeNull()
    const proj = h.state.plane!.projects.find((p) => p.wsPath === resolve(ws))
    expect(proj).toEqual(expect.objectContaining({ kind: 'STANDALONE', projectId: 'PRJ-1' }))
  })

  it('refuses a stale no-hub state over a drifted on-disk marker (PLANE_HUB_EXISTS)', async () => {
    const ws = makeTreeWs('PRJ-1')
    const other = makePlainWs()
    const h = mount([ws, other])
    expect(h.state.plane!.hub).toBeNull()
    // The drift: a hub marker appears at another registered ws AFTER init.
    plantMarker(other, serializeRegistry({ version: 1, projects: [] }))

    await expect(h.svc.bindProject({ wsPath: ws })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_HUB_EXISTS',
    })
  })

  it('refuses the hub workspace itself (PLANE_HUB_WORKSPACE)', async () => {
    const hub = makeHubWs([])
    const ws = makeTreeWs('PRJ-1')
    const h = mount([hub, ws])

    await expect(h.svc.bindProject({ wsPath: hub })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_HUB_WORKSPACE',
    })
  })

  it('refuses a target carrying a drifted on-disk hub marker (PLANE_HUB_WORKSPACE)', async () => {
    const hub = makeHubWs([])
    const other = makePlainWs()
    const h = mount([hub, other])
    plantMarker(other, serializeRegistry({ version: 1, projects: [] }))

    await expect(h.svc.bindProject({ wsPath: other })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_HUB_WORKSPACE',
    })
  })

  it('refuses an unregistered workspace (PLANE_NOT_REGISTERED_WORKSPACE)', async () => {
    const hub = makeHubWs([])
    const ws = makeTreeWs('PRJ-1')
    const stray = makePlainWs()
    const h = mount([hub, ws])

    await expect(h.svc.bindProject({ wsPath: stray })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_NOT_REGISTERED_WORKSPACE',
    })
  })

  it('fails loud (plain Error) over a standalone db when the seal seam is missing', async () => {
    const hub = makeHubWs([])
    const ws = makeTreeWs('PRJ-1')
    const source = join(ws, DIRS.treeDir, 'state', DB_FILE_NAME)
    const store = openDatabase(source, { now: () => NOW })
    store.appendEvents([makeEvent('H-SEALED')])
    store.close()
    const h = mount([hub, ws]) // NO sealStandaloneDb seam

    // The frozen §12 vocabulary has no code for a wiring gap — the
    // pre-init-guard shape: a plain Error that names the missing seam.
    await expect(h.svc.bindProject({ wsPath: ws })).rejects.toMatchObject({
      name: 'Error',
      message: expect.stringContaining('sealStandaloneDb'),
    })
    // Nothing moved, nothing committed: the db still at the source, the
    // registry untouched.
    expect(existsSync(source)).toBe(true)
    expect(existsSync(join(hub, DIRS.hubDir, 'projects'))).toBe(false)
    expect(parseRegistry(readFileSync(join(hub, DIRS.hubDir, 'registry.yaml'), 'utf8')).projects).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * unbindProject (design §8 解除绑定 / §12 row 6)
 * ------------------------------------------------------------------ */

describe('unbindProject (T3.2b-A2)', () => {
  it('archives the entry (NEVER deleted) and renames the tree away; the hub db is KEPT', async () => {
    const ws = makeTreeWs('PRJ-1', '树项目')
    const hub = makeHubWs([activeEntry('PRJ-1', ws, '树项目')])
    // The managed hub db (库留中枢): created, one event, closed.
    const hubDb = join(hub, DIRS.hubDir, 'projects', 'PRJ-1', DB_FILE_NAME)
    {
      const s = openDatabase(hubDb, { now: () => NOW })
      s.appendEvents([makeEvent('H-KEEP')])
      s.close()
    }
    const h = mount([hub, ws])
    const archivedDir = join(ws, ARCHIVED_SUFFIX)

    const r = await h.svc.unbindProject({ wsPath: ws })
    expect(r).toEqual({ projectId: 'PRJ-1', archivedDir })

    // The tree renamed away (the deterministic fixed-clock name).
    expect(existsSync(join(ws, DIRS.treeDir))).toBe(false)
    expect(existsSync(join(archivedDir, 'project.yaml'))).toBe(true)
    // The entry ARCHIVED with the stamp; `boundAt` preserved.
    const file = parseRegistry(readFileSync(join(hub, DIRS.hubDir, 'registry.yaml'), 'utf8'))
    expect(file.projects).toEqual([archivedEntry('PRJ-1', ws, '树项目', NOW)])
    // The hub db is UNTOUCHED (no file work touches it — 库留中枢).
    expect(existsSync(hubDb)).toBe(true)
    const s2 = openDatabase(hubDb, { now: () => NOW })
    expect(s2.getEvent('WS-1', 1)?.eventId).toBe('H-KEEP')
    s2.close()
    // The fresh state: no project AND no missing at the unbound path
    // (an archived tombstone is neither — §4 step 5).
    expect(h.state.plane!.projects.some((p) => p.wsPath === resolve(ws))).toBe(false)
    expect(h.state.plane!.missing.some((e) => e.path === resolve(ws))).toBe(false)
  })

  it('refuses a STANDALONE tree (PLANE_NOT_MANAGED)', async () => {
    const ws = makeTreeWs('PRJ-1')
    const hub = makeHubWs([])
    const h = mount([hub, ws])

    await expect(h.svc.unbindProject({ wsPath: ws })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_NOT_MANAGED',
    })
    // Tree + registry untouched.
    expect(existsSync(join(ws, DIRS.treeDir, 'project.yaml'))).toBe(true)
    expect(parseRegistry(readFileSync(join(hub, DIRS.hubDir, 'registry.yaml'), 'utf8')).projects).toEqual([])
  })

  it('refuses a MISSING-tree entry (PLANE_NOT_MANAGED — the MISSING set has its own 处置)', async () => {
    const ws = makePlainWs()
    const hub = makeHubWs([activeEntry('PRJ-1', ws, '丢失树')])
    const h = mount([hub, ws])
    // The active claim without a tree sits in the MISSING set.
    expect(h.state.plane!.missing.map((e) => e.id)).toEqual(['PRJ-1'])

    await expect(h.svc.unbindProject({ wsPath: ws })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_NOT_MANAGED',
    })
  })

  it('refuses a hubless plane (PLANE_NOT_MANAGED)', async () => {
    const ws = makeTreeWs('PRJ-1')
    const h = mount([ws])

    await expect(h.svc.unbindProject({ wsPath: ws })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_NOT_MANAGED',
    })
  })

  it('refuses an unregistered workspace (PLANE_NOT_REGISTERED_WORKSPACE)', async () => {
    const hub = makeHubWs([])
    const stray = makeTreeWs('PRJ-1')
    const h = mount([hub])

    await expect(h.svc.unbindProject({ wsPath: stray })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_NOT_REGISTERED_WORKSPACE',
    })
  })

  it('refuses a taken rename target BEFORE the commit (PLANE_TARGET_NAME_TAKEN)', async () => {
    const ws = makeTreeWs('PRJ-1')
    const hub = makeHubWs([activeEntry('PRJ-1', ws, '树项目')])
    const h = mount([hub, ws])
    // A hand-placed (or previous) archive occupies the fixed-clock name.
    const taken = join(ws, ARCHIVED_SUFFIX)
    mkdirSync(taken, { recursive: true })

    await expect(h.svc.unbindProject({ wsPath: ws })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_TARGET_NAME_TAKEN',
    })
    // Pre-commit: the registry and the tree are untouched.
    const file = parseRegistry(readFileSync(join(hub, DIRS.hubDir, 'registry.yaml'), 'utf8'))
    expect(file.projects).toEqual([activeEntry('PRJ-1', ws, '树项目')])
    expect(existsSync(join(ws, DIRS.treeDir, 'project.yaml'))).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * restoreProject (design §7.4 恢复登记 / §12 row 7)
 * ------------------------------------------------------------------ */

describe('restoreProject (T3.2b-A2)', () => {
  it('restores a tombstone: renames the tree back, re-activates the entry, the hub db is KEPT', async () => {
    const ws = makeTreeWs('PRJ-1', '树项目')
    const hub = makeHubWs([activeEntry('PRJ-1', ws, '树项目')])
    const hubDb = join(hub, DIRS.hubDir, 'projects', 'PRJ-1', DB_FILE_NAME)
    {
      const s = openDatabase(hubDb, { now: () => NOW })
      s.appendEvents([makeEvent('H-KEEP')])
      s.close()
    }
    const h = mount([hub, ws])
    const archivedDir = join(ws, ARCHIVED_SUFFIX)

    await h.svc.unbindProject({ wsPath: ws })
    expect(existsSync(archivedDir)).toBe(true)

    // The restore locates the archived dir deterministically from the
    // entry's own `archivedAt` stamp (the same value unbind wrote into
    // the dir name — 与解绑对称).
    const r = await h.svc.restoreProject({ projectId: 'PRJ-1' })
    expect(r).toEqual({ wsPath: resolve(ws) })

    expect(existsSync(archivedDir)).toBe(false)
    expect(existsSync(join(ws, DIRS.treeDir, 'project.yaml'))).toBe(true)
    // Re-activated: `archivedAt` cleared to null, `boundAt` PRESERVED
    // (the original bind stamp — the §3.2 cross-rule).
    const file = parseRegistry(readFileSync(join(hub, DIRS.hubDir, 'registry.yaml'), 'utf8'))
    expect(file.projects).toEqual([activeEntry('PRJ-1', ws, '树项目')])
    // The hub db is untouched (the db never left the hub — no file work).
    expect(existsSync(hubDb)).toBe(true)
    const s2 = openDatabase(hubDb, { now: () => NOW })
    expect(s2.getEvent('WS-1', 1)?.eventId).toBe('H-KEEP')
    s2.close()
    // The fresh state: MANAGED again.
    const proj = h.state.plane!.projects.find((p) => p.wsPath === resolve(ws))
    expect(proj).toEqual(expect.objectContaining({ kind: 'MANAGED', projectId: 'PRJ-1' }))
  })

  it('refuses an ACTIVE entry (PLANE_NOT_ARCHIVED)', async () => {
    const ws = makeTreeWs('PRJ-1')
    const hub = makeHubWs([activeEntry('PRJ-1', ws, '树项目')])
    const h = mount([hub, ws])

    await expect(h.svc.restoreProject({ projectId: 'PRJ-1' })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_NOT_ARCHIVED',
    })
  })

  it('refuses an unknown project id (PLANE_NOT_ARCHIVED)', async () => {
    const ws = makeTreeWs('PRJ-1')
    const hub = makeHubWs([activeEntry('PRJ-1', ws, '树项目')])
    const h = mount([hub, ws])

    await expect(h.svc.restoreProject({ projectId: 'PRJ-99' })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_NOT_ARCHIVED',
    })
  })

  it('refuses a hubless plane (PLANE_NOT_ARCHIVED — no registry, no tombstone)', async () => {
    const ws = makeTreeWs('PRJ-1')
    const h = mount([ws])

    await expect(h.svc.restoreProject({ projectId: 'PRJ-1' })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_NOT_ARCHIVED',
    })
  })

  it('refuses a stale no-hub state over a drifted on-disk marker (PLANE_HUB_EXISTS)', async () => {
    const ws = makeTreeWs('PRJ-1')
    const other = makePlainWs()
    const h = mount([ws, other])
    expect(h.state.plane!.hub).toBeNull()
    plantMarker(other, serializeRegistry({ version: 1, projects: [] }))

    await expect(h.svc.restoreProject({ projectId: 'PRJ-1' })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_HUB_EXISTS',
    })
  })

  it('refuses a tombstone whose archived dir is gone (PLANE_ARCHIVED_DIR_MISSING — 目录找不回)', async () => {
    const ws = makePlainWs()
    const hub = makeHubWs([archivedEntry('PRJ-1', ws, '树项目', NOW)])
    const h = mount([hub, ws])

    await expect(h.svc.restoreProject({ projectId: 'PRJ-1' })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_ARCHIVED_DIR_MISSING',
    })
    // The registry is untouched (still archived).
    const file = parseRegistry(readFileSync(join(hub, DIRS.hubDir, 'registry.yaml'), 'utf8'))
    expect(file.projects).toEqual([archivedEntry('PRJ-1', ws, '树项目', NOW)])
  })

  it('refuses an occupied restore target BEFORE the commit (PLANE_TARGET_NAME_TAKEN)', async () => {
    // A live tree at the unbound path (recreated after the unbind)
    // alongside the surviving archived dir.
    const ws = makeTreeWs('PRJ-1')
    const archivedDir = join(ws, ARCHIVED_SUFFIX)
    mkdirSync(archivedDir, { recursive: true })
    writeFileSync(join(archivedDir, 'project.yaml'), 'id: PRJ-1\ntitle: 归档树\n', 'utf8')
    const hub = makeHubWs([archivedEntry('PRJ-1', ws, '树项目', NOW)])
    const h = mount([hub, ws])

    await expect(h.svc.restoreProject({ projectId: 'PRJ-1' })).rejects.toMatchObject({
      name: 'PlaneError',
      code: 'PLANE_TARGET_NAME_TAKEN',
    })
    // Pre-commit: the archived tree and the registry are untouched.
    expect(existsSync(join(archivedDir, 'project.yaml'))).toBe(true)
    expect(readFileSync(join(ws, DIRS.treeDir, 'project.yaml'), 'utf8')).toContain('id: PRJ-1')
    const file = parseRegistry(readFileSync(join(hub, DIRS.hubDir, 'registry.yaml'), 'utf8'))
    expect(file.projects).toEqual([archivedEntry('PRJ-1', ws, '树项目', NOW)])
  })
})
