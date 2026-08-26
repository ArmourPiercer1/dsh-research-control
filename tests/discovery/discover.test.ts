/**
 * V2-T2.2 — `discoverPlane` pure-classification matrix (design §4 全文).
 *
 * Coverage: hub 0/1/2 × tree 0/1/N × registry 空/有条目/条目路径无树,
 * plus the fail-loud points (TC-DSH-008 shape): ≥ 2 hubs, malformed
 * registry (two flavors), the §3.2 entry-id conflict, duplicate entry
 * paths, duplicate project ids, and the hub-without-text caller
 * invariant. The I/O seam (`probeWorkspaces`) and the host-side startup
 * matrix live in host-startup.test.ts (real temp dirs + fake
 * workspaceRegistry.list).
 */
import { describe, expect, it } from 'vitest'

import {
  DiscoverError,
  discoverPlane,
  resolveProject,
  type PlaneProject,
  type ProbedWorkspace,
} from '../../src/host/dsh-adapter/host/discovery.js'
import {
  RegistryFormatError,
  serializeRegistry,
  type RegistryEntry,
} from '../../src/host/domain/registry/index.js'
import { makeFile } from '../registry/fixtures.js'
import type { ResearchDirNames } from '../../src/host/dsh-adapter/host/settings.js'

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** The configured directory names (the T2.1 defaults — discovery only
 *  ever sees names, never literals). */
const DIRS: ResearchDirNames = { treeDir: '.research', hubDir: '.research-control' }

/** One probed workspace (pure — no disk; the I/O seam is tested in
 *  host-startup.test.ts). */
function ws(
  path: string,
  flags: { hub?: boolean; tree?: boolean; treeId?: string } = {},
): ProbedWorkspace {
  return {
    path,
    hasHubDir: flags.hub === true,
    hasTreeDir: flags.tree === true,
    ...(flags.tree === true && flags.treeId !== undefined ? { treeProjectId: flags.treeId } : {}),
  }
}

/** One registry entry (absolute path — the frozen §3.2 carrier rule). */
function entry(id: string, path: string, opts: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id,
    path,
    displayName: `display-${id}`,
    status: 'active',
    boundAt: 1770000000000,
    archivedAt: null,
    ...opts,
  }
}

/** Valid `registry.yaml` text for the given entries (T2.3 canonical form). */
function registryText(entries: readonly RegistryEntry[] = []): string {
  return serializeRegistry(makeFile(entries))
}

const WS_HUB = '/workspaces/hub'
const WS_A = '/workspaces/ws-a'
const WS_B = '/workspaces/ws-b'

/* ------------------------------------------------------------------ *
 * hub 0 (no management center) — every tree is STANDALONE
 * ------------------------------------------------------------------ */

describe('discoverPlane — hub 0 (V1 shape, no management center)', () => {
  it('tree 0 → the empty plane (V1 spike mode: ping only, one warn at the caller)', () => {
    const state = discoverPlane([], DIRS, null)
    expect(state.hub).toBeNull()
    expect(state.projects).toEqual([])
    expect(state.missing).toEqual([])
    expect(state.deferredReminders).toBeInstanceOf(Set)
    expect(state.deferredReminders.size).toBe(0)
  })

  it('tree 1 → one STANDALONE project (the V1 single-project plane, byte-compatible shape)', () => {
    const state = discoverPlane([ws(WS_A, { tree: true, treeId: 'PRJ-1' })], DIRS, null)
    expect(state.hub).toBeNull()
    expect(state.projects).toHaveLength(1)
    expect(state.projects[0]).toMatchObject({
      projectId: 'PRJ-1',
      entry: null,
      wsPath: WS_A,
      kind: 'STANDALONE',
    })
    expect(state.missing).toEqual([])
  })

  it('tree N → every tree STANDALONE, in scan order (no hub to claim any)', () => {
    const state = discoverPlane(
      [
        ws(WS_A, { tree: true, treeId: 'PRJ-1' }),
        ws(WS_B, { tree: true, treeId: 'PRJ-2' }),
        ws(WS_HUB, {}), // a plain workspace (no tree, no hub) — ignored
      ],
      DIRS,
      null,
    )
    expect(state.hub).toBeNull()
    expect(state.projects.map((p) => p.projectId)).toEqual(['PRJ-1', 'PRJ-2'])
    expect(state.projects.every((p) => p.kind === 'STANDALONE' && p.entry === null)).toBe(true)
    expect(state.missing).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * hub 1 × registry variants
 * ------------------------------------------------------------------ */

describe('discoverPlane — hub 1 (registry reconciliation, §4 step 5)', () => {
  it('empty registry × tree 1 → the tree is STANDALONE (no entry claims it), hub set', () => {
    const state = discoverPlane(
      [ws(WS_HUB, { hub: true }), ws(WS_A, { tree: true, treeId: 'PRJ-1' })],
      DIRS,
      registryText([]),
    )
    expect(state.hub).toEqual({ path: WS_HUB })
    expect(state.projects).toHaveLength(1)
    expect(state.projects[0]).toMatchObject({ projectId: 'PRJ-1', kind: 'STANDALONE', entry: null })
    expect(state.missing).toEqual([])
  })

  it('1 active entry × tree at entry.path (ids agree) → one MANAGED project (entry carried)', () => {
    const reg = entry('PRJ-1', WS_A)
    const state = discoverPlane(
      [ws(WS_HUB, { hub: true }), ws(WS_A, { tree: true, treeId: 'PRJ-1' })],
      DIRS,
      registryText([reg]),
    )
    expect(state.hub).toEqual({ path: WS_HUB })
    expect(state.projects).toHaveLength(1)
    expect(state.projects[0]).toMatchObject({
      projectId: 'PRJ-1',
      wsPath: WS_A,
      kind: 'MANAGED',
    })
    // parseRegistry deep-freezes (fresh objects) — deep equality, not identity.
    expect(state.projects[0]!.entry).toEqual(reg)
    expect(state.missing).toEqual([])
  })

  it('2 entries (one with tree, one without) → MANAGED + the tree-less one MISSING', () => {
    const managedEntry = entry('PRJ-1', WS_A)
    const missingEntry = entry('PRJ-2', WS_B, { displayName: '缺失项目' })
    const state = discoverPlane(
      [ws(WS_HUB, { hub: true }), ws(WS_A, { tree: true, treeId: 'PRJ-1' })],
      DIRS,
      registryText([managedEntry, missingEntry]),
    )
    expect(state.projects.map((p) => p.kind)).toEqual(['MANAGED'])
    expect(state.missing).toEqual([missingEntry])
  })

  it('1 entry, no tree anywhere → one MISSING, zero projects (nothing to wire)', () => {
    const missingEntry = entry('PRJ-1', WS_A)
    const state = discoverPlane(
      [ws(WS_HUB, { hub: true })],
      DIRS,
      registryText([missingEntry]),
    )
    expect(state.projects).toEqual([])
    expect(state.missing).toEqual([missingEntry])
  })

  it('entry path not among the scanned workspaces → MISSING (membership is proven by absence)', () => {
    const unregisteredPath = '/workspaces/not-a-dsh-workspace'
    const state = discoverPlane(
      [ws(WS_HUB, { hub: true }), ws(WS_A, { tree: true, treeId: 'PRJ-1' })],
      DIRS,
      registryText([entry('PRJ-1', WS_A), entry('PRJ-2', unregisteredPath)]),
    )
    expect(state.projects.map((p) => p.projectId)).toEqual(['PRJ-1'])
    expect(state.missing.map((e) => e.id)).toEqual(['PRJ-2'])
  })

  it('active + archived entries, no trees → only the ACTIVE one is MISSING (archived = tombstone, not a live candidate)', () => {
    const state = discoverPlane(
      [ws(WS_HUB, { hub: true })],
      DIRS,
      registryText([
        entry('PRJ-1', WS_A),
        entry('PRJ-2', WS_B, { status: 'archived', archivedAt: 1765000000000 }),
      ]),
    )
    expect(state.projects).toEqual([])
    expect(state.missing.map((e) => e.id)).toEqual(['PRJ-1'])
  })

  it('archived entry with its (re)discovered tree → STANDALONE (a 解绑 tombstone does not claim the tree — §7.4 恢复登记 is the remedy)', () => {
    const state = discoverPlane(
      [ws(WS_HUB, { hub: true }), ws(WS_A, { tree: true, treeId: 'PRJ-2' })],
      DIRS,
      registryText([entry('PRJ-2', WS_A, { status: 'archived', archivedAt: 1765000000000 })]),
    )
    expect(state.hub).toEqual({ path: WS_HUB })
    expect(state.projects).toHaveLength(1)
    expect(state.projects[0]).toMatchObject({ projectId: 'PRJ-2', kind: 'STANDALONE', entry: null })
    expect(state.missing).toEqual([])
  })

  it('the hub workspace may itself carry a tree (no entry → STANDALONE, hub still resolves)', () => {
    const state = discoverPlane(
      [ws(WS_HUB, { hub: true, tree: true, treeId: 'PRJ-9' })],
      DIRS,
      registryText([]),
    )
    expect(state.hub).toEqual({ path: WS_HUB })
    expect(state.projects).toHaveLength(1)
    expect(state.projects[0]).toMatchObject({ projectId: 'PRJ-9', kind: 'STANDALONE', wsPath: WS_HUB })
  })

  it('two active entries, both with trees → two MANAGED projects (the multi-project plane)', () => {
    const state = discoverPlane(
      [
        ws(WS_HUB, { hub: true }),
        ws(WS_A, { tree: true, treeId: 'PRJ-1' }),
        ws(WS_B, { tree: true, treeId: 'PRJ-2' }),
      ],
      DIRS,
      registryText([entry('PRJ-1', WS_A), entry('PRJ-2', WS_B)]),
    )
    expect(state.projects.map((p) => p.kind)).toEqual(['MANAGED', 'MANAGED'])
    expect(state.projects.map((p) => p.projectId)).toEqual(['PRJ-1', 'PRJ-2'])
    expect(state.missing).toEqual([])
  })

  it('mixed: registered + unregistered trees → MANAGED + STANDALONE in scan order; MISSING keeps registry order', () => {
    const state = discoverPlane(
      [
        ws(WS_HUB, { hub: true }),
        ws(WS_B, { tree: true, treeId: 'PRJ-2' }), // unregistered — scan-order second
        ws(WS_A, { tree: true, treeId: 'PRJ-1' }), // registered
      ],
      DIRS,
      registryText([entry('PRJ-1', WS_A), entry('PRJ-3', '/workspaces/ws-c'), entry('PRJ-4', '/workspaces/ws-d')]),
    )
    expect(state.projects.map((p) => `${p.projectId}:${p.kind}`)).toEqual([
      'PRJ-2:STANDALONE',
      'PRJ-1:MANAGED',
    ])
    expect(state.missing.map((e) => e.id)).toEqual(['PRJ-3', 'PRJ-4'])
  })

  it('deferredReminders is a fresh empty Set per call (the 推后处理 runtime flag — never persisted)', () => {
    const a = discoverPlane([], DIRS, null)
    a.deferredReminders.add('PRJ-1')
    const b = discoverPlane([], DIRS, null)
    expect(b.deferredReminders.size).toBe(0)
    expect(b.deferredReminders).not.toBe(a.deferredReminders)
  })
})

/* ------------------------------------------------------------------ *
 * Fail-loud points (TC-DSH-008 — the plane refuses to start)
 * ------------------------------------------------------------------ */

describe('discoverPlane — fail-loud (TC-DSH-008)', () => {
  it('two hubs → DiscoverError MULTIPLE_HUBS (message lists EVERY hub path)', () => {
    const hub2 = '/workspaces/other-hub'
    let caught: unknown
    try {
      discoverPlane(
        [ws(WS_HUB, { hub: true }), ws(hub2, { hub: true }), ws(WS_A, { tree: true, treeId: 'PRJ-1' })],
        DIRS,
        registryText([]),
      )
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DiscoverError)
    const err = caught as DiscoverError
    expect(err.code).toBe('MULTIPLE_HUBS')
    expect(err.name).toBe('DiscoverError')
    expect(err.message).toContain(WS_HUB)
    expect(err.message).toContain(hub2)
    expect(err.message).toContain('exactly one hub')
  })

  it('one hub + malformed registry (YAML syntax) → DiscoverError REGISTRY_MALFORMED (the RegistryFormatError rides in cause)', () => {
    let caught: unknown
    try {
      discoverPlane([ws(WS_HUB, { hub: true })], DIRS, 'version: 1\nprojects: [unclosed\n')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DiscoverError)
    const err = caught as DiscoverError & { cause?: unknown }
    expect(err.code).toBe('REGISTRY_MALFORMED')
    expect(err.message).toContain(`${WS_HUB}/.research-control/registry.yaml`)
    expect(err.cause).toBeInstanceOf(RegistryFormatError)
  })

  it('one hub + empty registry file → REGISTRY_MALFORMED (NOT_MAPPING through the wrap)', () => {
    let caught: unknown
    try {
      discoverPlane([ws(WS_HUB, { hub: true })], DIRS, '')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DiscoverError)
    expect((caught as DiscoverError).code).toBe('REGISTRY_MALFORMED')
    expect((caught as { cause?: unknown }).cause).toBeInstanceOf(RegistryFormatError)
  })

  it('one hub + registry entry id ≠ tree project id → PROJECT_ID_CONFLICT (§3.2 冲突，启动期报出)', () => {
    let caught: unknown
    try {
      discoverPlane(
        [ws(WS_HUB, { hub: true }), ws(WS_A, { tree: true, treeId: 'PRJ-1' })],
        DIRS,
        registryText([entry('PRJ-2', WS_A)]),
      )
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DiscoverError)
    const err = caught as DiscoverError
    expect(err.code).toBe('PROJECT_ID_CONFLICT')
    expect(err.message).toContain('PRJ-2')
    expect(err.message).toContain('PRJ-1')
    expect(err.message).toContain(WS_A)
  })

  it('two registry entries claiming one workspace path → DUPLICATE_ENTRY_PATH', () => {
    let caught: unknown
    try {
      discoverPlane(
        [ws(WS_HUB, { hub: true }), ws(WS_A, { tree: true, treeId: 'PRJ-1' })],
        DIRS,
        registryText([entry('PRJ-1', WS_A), entry('PRJ-2', WS_A)]),
      )
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DiscoverError)
    expect((caught as DiscoverError).code).toBe('DUPLICATE_ENTRY_PATH')
    expect((caught as DiscoverError).message).toContain(WS_A)
  })

  it('two trees declaring the same project id → DUPLICATE_PROJECT_ID (the id keys the data dir)', () => {
    let caught: unknown
    try {
      discoverPlane(
        [ws(WS_A, { tree: true, treeId: 'PRJ-1' }), ws(WS_B, { tree: true, treeId: 'PRJ-1' })],
        DIRS,
        null,
      )
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DiscoverError)
    const err = caught as DiscoverError
    expect(err.code).toBe('DUPLICATE_PROJECT_ID')
    expect(err.message).toContain('PRJ-1')
    expect(err.message).toContain(WS_A)
    expect(err.message).toContain(WS_B)
  })

  it('a hub was discovered but registryText is null → REGISTRY_ABSENT (caller invariant — never silently degrades)', () => {
    let caught: unknown
    try {
      discoverPlane([ws(WS_HUB, { hub: true })], DIRS, null)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DiscoverError)
    expect((caught as DiscoverError).code).toBe('REGISTRY_ABSENT')
  })
})

/* ------------------------------------------------------------------ *
 * resolveProject — the §12.1 routing reservation (three branches + the
 * two error edges)
 * ------------------------------------------------------------------ */

function stateWithProjects(
  projects: readonly PlaneProject[],
  missing: readonly RegistryEntry[] = [],
): Parameters<typeof resolveProject>[0] {
  return { hub: null, projects, missing, deferredReminders: new Set() }
}

function planeProject(id: string, kind: PlaneProject['kind']): PlaneProject {
  return {
    projectId: id,
    entry: kind === 'MANAGED' ? entry(id, `/workspaces/${id.toLowerCase()}`) : null,
    wsPath: `/workspaces/${id.toLowerCase()}`,
    kind,
    treeTitle: `Title of ${id}`,
  }
}

describe('resolveProject (design §12.1 裁决)', () => {
  const single = stateWithProjects([planeProject('PRJ-1', 'MANAGED')])
  const multi = stateWithProjects([
    planeProject('PRJ-1', 'MANAGED'),
    planeProject('PRJ-2', 'STANDALONE'),
  ])

  it('explicit projectId → that project (MANAGED or STANDALONE)', () => {
    expect(resolveProject(multi, 'PRJ-1').projectId).toBe('PRJ-1')
    expect(resolveProject(multi, 'PRJ-2').projectId).toBe('PRJ-2')
  })

  it('explicit projectId absent → UNKNOWN_PROJECT (the message lists the active ids)', () => {
    expect(() => resolveProject(multi, 'PRJ-9')).toThrow(
      /project PRJ-9 is not an active project/,
    )
    try {
      resolveProject(multi, 'PRJ-9')
      expect.unreachable()
    } catch (e) {
      expect((e as { code?: string }).code).toBe('UNKNOWN_PROJECT')
      expect((e as { candidates?: readonly string[] }).candidates).toEqual(['PRJ-1', 'PRJ-2'])
    }
  })

  it('explicit projectId naming a MISSING entry → UNKNOWN_PROJECT (MISSING is not routable — the disposition runs through the T3/T4 新面)', () => {
    const withMissing = stateWithProjects([planeProject('PRJ-1', 'MANAGED')], [entry('PRJ-2', WS_B)])
    expect(() => resolveProject(withMissing, 'PRJ-2')).toThrow(/not an active project/)
  })

  it('omitted & exactly one active project → that project (the V1 implicit-single behavior)', () => {
    expect(resolveProject(single)).toMatchObject({ projectId: 'PRJ-1', kind: 'MANAGED' })
  })

  it('omitted & zero active projects → NO_PROJECTS', () => {
    try {
      resolveProject(stateWithProjects([], [entry('PRJ-1', WS_A)]))
      expect.unreachable()
    } catch (e) {
      expect((e as { code?: string }).code).toBe('NO_PROJECTS')
      expect((e as Error).message).toContain('no active project')
    }
  })

  it('omitted & several active projects → AMBIGUOUS_PROJECT (the message lists every project id 供选择)', () => {
    try {
      resolveProject(multi)
      expect.unreachable()
    } catch (e) {
      const err = e as Error & { code?: string; candidates?: readonly string[] }
      expect(err.code).toBe('AMBIGUOUS_PROJECT')
      expect(err.message).toContain('PRJ-1')
      expect(err.message).toContain('PRJ-2')
      expect(err.candidates).toEqual(['PRJ-1', 'PRJ-2'])
    }
  })
})
