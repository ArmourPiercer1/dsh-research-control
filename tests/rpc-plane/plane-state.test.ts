/**
 * V2-T3.2a — getResearchPlaneState: the §5 role-segment + the §4 step-6
 * plane summary (design §12 row 1).
 *
 * Coverage (the T3.2a brief):
 *  - ROLE 五分支 over REAL `[Service.init]` planes + fake sessions:
 *    HUB (cwd == hubPath) / MANAGED (cwd ∈ managed wsPath) /
 *    STANDALONE (cwd ∈ standalone wsPath) / UNREGISTERED (any other
 *    cwd) / NO_CWD (no cwd);
 *  - the hub-that-is-also-a-project: role=HUB + `hubTreeProjectId`
 *    attached (design §5 note) — and `hubTreeProjectId: null` when the
 *    hub carries no own tree;
 *  - the `missing` projection with the 「推后处理」 `deferred` flag
 *    filtered from `PlaneState.deferredReminders` (pure-projection level:
 *    the runtime dedup set is mutated by the T3.2b `ackMissingReminder`
 *    — here the flag is exercised through the projection function, and
 *    end-to-end it reads `false` before any ack exists);
 *  - the success + rejection paths of the method itself:
 *    omitted `sessionId` → `session: null`; unknown `sessionId` →
 *    `PlaneError('PLANE_SESSION_UNKNOWN')`; a malformed args object →
 *    rejected at the strict schema boundary (before anything runs);
 *  - ADJ-11 (UI-9 D4): the MANAGED entries carry the gate's machine
 *    projection (`integrity` — machine codes ONLY, 只传机器码); the
 *    STANDALONE entry (no wiring of its own) keeps the field undefined.
 *    The `projectPlaneIntegrity` projection (per-code emission + the
 *    locked vocabulary) and the attach matrix (wirings map undefined /
 *    MANAGED missing from the map / wired MANAGED vs. STANDALONE skip)
 *    are unit-tested at the bottom of this file.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  projectPlaneIntegrity,
  projectPlaneSummary,
  planeProjectDisplayName,
  resolveSessionRole,
  INTEGRITY_CODE_WIRING_REINITIALIZED,
  INTEGRITY_CODE_TREE_PARTIAL,
  INTEGRITY_CODE_CONSISTENCY_MISMATCH,
  INTEGRITY_CODE_GIT_REPO_ERROR,
  ProductionResearchPlaneServices,
} from '../../src/host/dsh-adapter/host/plane-read-services.js'
import type { GitCheckResult } from '../../src/host/persistence/hardening/index.js'
import type { HostWiring, StartupIntegrityGate } from '../../src/host/service/wiring/index.js'
import type { DshSessionAdapter } from '../../src/shared/host-adapter-ports.js'
import type { PlaneProject, PlaneState } from '../../src/host/dsh-adapter/host/discovery.js'
import { serializeRegistry } from '../../src/host/domain/registry/index.js'
import type { RegistryEntry } from '../../src/host/domain/registry/index.js'
import { makeFile } from '../registry/fixtures.js'
import { APPENDIX_A_PROJECT_YAML, TOPIC_YAML } from '../loader/fixtures.js'
import { initGitRepo, writeResearchTree } from '../wiring/helpers.js'
import { GetResearchPlaneStateResultSchema, type GetResearchPlaneStateResult } from '../../src/shared/rpc-contracts.js'

import {
  freshDshHome,
  makeHubWs,
  makePlainWs,
  makeProjectWs,
  mountHost,
  initPlane,
  disposeFiber,
  type FakeSession,
} from './helpers.js'

const T = 1_770_000_000_000

function entry(id: string, path: string, displayName: string): RegistryEntry {
  return {
    id,
    path,
    displayName,
    status: 'active',
    boundAt: T,
    archivedAt: null,
  }
}

/** A full plane on disk: hub + managed PRJ-1 + standalone PRJ-2 + a
 *  plain workspace + a MISSING registration (PRJ-3, tree lost). The
 *  registry is written LAST (it needs the real workspace paths). */
function makeFullPlane(): { hub: string; wsA: string; wsB: string; plain: string; sessions: FakeSession[] } {
  const wsA = makeProjectWs('PRJ-1')
  const wsB = makeProjectWs('PRJ-2')
  const plain = makePlainWs()
  const hub = makeHubWs([
    entry('PRJ-1', wsA, '机器人视觉定位系统'),
    entry('PRJ-3', plain, 'Lost project'),
  ])
  return {
    hub,
    wsA,
    wsB,
    plain,
    sessions: [
      { id: 'sess-hub', cwd: hub },
      { id: 'sess-a', cwd: wsA },
      { id: 'sess-b', cwd: wsB },
      { id: 'sess-plain', cwd: plain },
      { id: 'sess-nocwd' },
    ],
  }
}

describe('getResearchPlaneState — the §5 role segment (REAL init + fake sessions)', () => {
  it('full plane: the 五分支 role matrix + the §4 step-6 summary', async () => {
    freshDshHome()
    const p = makeFullPlane()
    const h = mountHost([p.hub, p.wsA, p.wsB, p.plain], p.sessions)
    try {
      await initPlane(h)
      const wire = (v: unknown): GetResearchPlaneStateResult =>
        GetResearchPlaneStateResultSchema.parse(v)

      // HUB (cwd == hubPath; the hub carries no own tree here).
      const hubState = wire(await h.svc.getResearchPlaneState({ sessionId: 'sess-hub' }))
      expect(hubState.hub).toEqual({ path: p.hub })
      expect(hubState.dirNames).toEqual({ treeDir: '.research', hubDir: '.research-control' })
      // ADJ-11 (UI-9 D4): the MANAGED entry carries the gate's machine
      // projection (init plane = CLEAN gate → writable surface, no codes);
      // the STANDALONE entry has no wiring of its own → integrity omitted.
      expect(hubState.projects).toEqual([
        {
          projectId: 'PRJ-1',
          displayName: '机器人视觉定位系统',
          kind: 'MANAGED',
          wsPath: p.wsA,
          integrity: { readOnly: false, checkCodes: [] },
        },
        { projectId: 'PRJ-2', displayName: '机器人视觉定位系统', kind: 'STANDALONE', wsPath: p.wsB },
      ])
      expect(hubState.missing).toEqual([
        { projectId: 'PRJ-3', displayName: 'Lost project', wsPath: p.plain, deferred: false },
      ])
      expect(hubState.session).toEqual({ cwd: p.hub, role: 'HUB', hubTreeProjectId: null })

      // MANAGED (cwd ∈ a managed wsPath).
      const managedState = wire(await h.svc.getResearchPlaneState({ sessionId: 'sess-a' }))
      expect(managedState.session).toEqual({ cwd: p.wsA, role: 'MANAGED' })

      // STANDALONE (cwd ∈ a standalone wsPath).
      const standaloneState = wire(await h.svc.getResearchPlaneState({ sessionId: 'sess-b' }))
      expect(standaloneState.session).toEqual({ cwd: p.wsB, role: 'STANDALONE' })

      // UNREGISTERED (a registered workspace without a tree).
      const unregisteredState = wire(await h.svc.getResearchPlaneState({ sessionId: 'sess-plain' }))
      expect(unregisteredState.session).toEqual({ cwd: p.plain, role: 'UNREGISTERED' })

      // NO_CWD (the session header carries no cwd — 引导卡收窄文案).
      const noCwdState = wire(await h.svc.getResearchPlaneState({ sessionId: 'sess-nocwd' }))
      expect(noCwdState.session).toEqual({ cwd: null, role: 'NO_CWD' })

      // Omitted sessionId → session: null (the 设置页① read — plane state
      // without a caller). The plane summary is caller-independent.
      const noCallerState = wire(await h.svc.getResearchPlaneState({}))
      expect(noCallerState.session).toBeNull()
      expect(noCallerState.hub).toEqual(hubState.hub)
      expect(noCallerState.projects).toEqual(hubState.projects)
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('the hub that is ALSO a project: role=HUB + hubTreeProjectId attached (design §5 note)', async () => {
    freshDshHome()
    const hub = makePlainWs()
    // The hub marker + the registry (PRJ-9 registered AT the hub path).
    mkdirSync(join(hub, '.research-control'), { recursive: true })
    writeFileSync(
      join(hub, '.research-control', 'registry.yaml'),
      serializeRegistry(makeFile([
        { id: 'PRJ-9', path: hub, displayName: 'Hub project', status: 'active', boundAt: T, archivedAt: null },
      ])),
      'utf8',
    )
    // The hub's own .research tree (id PRJ-9 — the §3.2 cross-check
    // agrees: entry id == tree project.yaml id; the topic cross-ref is
    // patched with it — the loader's project_id check must pass).
    writeResearchTree(hub, {
      'project.yaml': APPENDIX_A_PROJECT_YAML.replace('id: PRJ-1', 'id: PRJ-9'),
      'topics/TPC-1/topic.yaml': TOPIC_YAML.replace('project_id: PRJ-1', 'project_id: PRJ-9'),
    })
    initGitRepo(hub)
    const h = mountHost([hub], [{ id: 'sess-hub', cwd: hub }])
    try {
      await initPlane(h)
      const state: GetResearchPlaneStateResult = await h.svc.getResearchPlaneState({ sessionId: 'sess-hub' })
      expect(state.projects).toHaveLength(1)
      expect(state.projects[0]).toMatchObject({
        projectId: 'PRJ-9',
        kind: 'MANAGED',
        wsPath: hub,
        displayName: 'Hub project',
      })
      expect(state.session).toEqual({ cwd: hub, role: 'HUB', hubTreeProjectId: 'PRJ-9' })
      // The HUB role wins over the coincident project tree (the design's
      // check order: the hub test runs first).
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('unknown sessionId → PlaneError PLANE_SESSION_UNKNOWN (the T3.2 branch decision — never a silent null)', async () => {
    freshDshHome()
    const h = mountHost([makePlainWs()], [{ id: 'sess-1', cwd: 'PLACEHOLDER' }])
    try {
      await initPlane(h)
      await expect(h.svc.getResearchPlaneState({ sessionId: 'sess-ghost' })).rejects.toThrow(
        /PLANE_SESSION_UNKNOWN/,
      )
      try {
        await h.svc.getResearchPlaneState({ sessionId: 'sess-ghost' })
        expect.unreachable()
      } catch (e) {
        expect((e as { code?: string }).code).toBe('PLANE_SESSION_UNKNOWN')
        expect((e as Error).message).toContain('sess-ghost')
      }
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('a malformed args object is rejected at the strict schema boundary (before anything runs)', async () => {
    freshDshHome()
    const h = mountHost([makePlainWs()])
    try {
      await initPlane(h)
      // Unknown key (strict) …
      await expect(h.svc.getResearchPlaneState({ sessionId: 'sess-1', surprise: 1 } as unknown)).rejects.toThrow(z.ZodError)
      // … and a wrong-typed sessionId.
      await expect(h.svc.getResearchPlaneState({ sessionId: 42 } as unknown)).rejects.toThrow(z.ZodError)
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('the empty plane serves the empty state (the 引导卡 data — design §6) without a caller', async () => {
    freshDshHome()
    const h = mountHost([makePlainWs()])
    try {
      await initPlane(h)
      const state = GetResearchPlaneStateResultSchema.parse(await h.svc.getResearchPlaneState({}))
      expect(state.hub).toBeNull()
      expect(state.projects).toEqual([])
      expect(state.missing).toEqual([])
      expect(state.session).toBeNull()
    } finally {
      disposeFiber(h)
    }
  }, 30_000)
})

/* ------------------------------------------------------------------ *
 * Pure projections (unit level — the deferred flag + the display-name
 * rules without a host)
 * ------------------------------------------------------------------ */

function planeState(over: Partial<PlaneState> = {}): PlaneState {
  return {
    hub: null,
    projects: [],
    missing: [],
    registry: [],
    deferredReminders: new Set<string>(),
    ...over,
  }
}

function planeProject(id: string, kind: PlaneProject['kind'], over: Partial<PlaneProject> = {}): PlaneProject {
  return {
    projectId: id,
    entry: kind === 'MANAGED' ? entry(id, `/workspaces/${id}`, `${id} entry name`) : null,
    wsPath: `/workspaces/${id}`,
    kind,
    treeTitle: `${id} tree title`,
    ...over,
  }
}

describe('resolveSessionRole (the §5 decision, pure)', () => {
  const hub = { path: '/workspaces/hub' }
  const withHub = planeState({
    hub,
    projects: [
      planeProject('PRJ-1', 'MANAGED'),
      planeProject('PRJ-2', 'STANDALONE'),
      // A project tree AT the hub path (the hub-that-is-a-project shape).
      planeProject('PRJ-9', 'MANAGED', { wsPath: '/workspaces/hub' }),
    ],
  })

  it('cwd == hubPath → HUB, hubTreeProjectId = the project at the hub path', () => {
    expect(resolveSessionRole(withHub, '/workspaces/hub')).toEqual({
      cwd: '/workspaces/hub',
      role: 'HUB',
      hubTreeProjectId: 'PRJ-9',
    })
  })

  it('cwd == hubPath without an own tree → HUB with hubTreeProjectId null', () => {
    const bareHub = planeState({
      hub,
      projects: [planeProject('PRJ-1', 'MANAGED')],
    })
    expect(resolveSessionRole(bareHub, '/workspaces/hub')).toEqual({
      cwd: '/workspaces/hub',
      role: 'HUB',
      hubTreeProjectId: null,
    })
  })

  it('cwd ∈ managed / standalone wsPath → the tree kind', () => {
    expect(resolveSessionRole(withHub, '/workspaces/PRJ-1')).toEqual({
      cwd: '/workspaces/PRJ-1',
      role: 'MANAGED',
    })
    expect(resolveSessionRole(withHub, '/workspaces/PRJ-2')).toEqual({
      cwd: '/workspaces/PRJ-2',
      role: 'STANDALONE',
    })
  })

  it('any other cwd → UNREGISTERED (the 引导卡 role)', () => {
    expect(resolveSessionRole(withHub, '/workspaces/plain')).toEqual({
      cwd: '/workspaces/plain',
      role: 'UNREGISTERED',
    })
  })

  it('no cwd → NO_CWD (the 收窄 引导卡)', () => {
    expect(resolveSessionRole(withHub, null)).toEqual({ cwd: null, role: 'NO_CWD' })
  })

  it('comparison is canonical (resolve-normalized, like the probe)', () => {
    // A non-canonical spelling of the hub path still resolves to HUB.
    const normalized = resolveSessionRole(withHub, 'workspaces/hub/')
    expect(normalized.role).toBe('UNREGISTERED') // relative → different path
    const abs = resolveSessionRole(withHub, '/workspaces/hub/.')
    expect(abs).toMatchObject({ role: 'HUB' })
  })
})

describe('projectPlaneSummary + planeProjectDisplayName (pure)', () => {
  it('the missing projection filters the deferred flag from deferredReminders (推后处理 — design §4/§14)', () => {
    const plane = planeState({
      missing: [
        entry('PRJ-3', '/workspaces/lost', 'Lost project'),
        entry('PRJ-4', '/workspaces/gone', 'Gone project'),
      ],
      deferredReminders: new Set(['PRJ-4']),
    })
    const summary = projectPlaneSummary(plane, { treeDir: '.research', hubDir: '.research-control' })
    expect(summary.missing).toEqual([
      { projectId: 'PRJ-3', displayName: 'Lost project', wsPath: '/workspaces/lost', deferred: false },
      { projectId: 'PRJ-4', displayName: 'Gone project', wsPath: '/workspaces/gone', deferred: true },
    ])
    expect(summary.projects).toEqual([])
    expect(summary.hub).toBeNull()
    expect(summary.dirNames).toEqual({ treeDir: '.research', hubDir: '.research-control' })
  })

  it('the registry projection is 1:1 with the book (ACTIVE + ARCHIVED, declaration order — V2-T5.4)', () => {
    const active = entry('PRJ-1', '/workspaces/p1', 'P1 name')
    const archived: RegistryEntry = {
      id: 'PRJ-2',
      path: '/workspaces/p2',
      displayName: 'P2 name',
      status: 'archived',
      boundAt: T,
      archivedAt: T + 999,
    }
    const plane = planeState({ hub: { path: '/workspaces/hub' }, registry: [active, archived] })
    const summary = projectPlaneSummary(plane, { treeDir: '.research', hubDir: '.research-control' })
    expect(summary.registry).toEqual([
      {
        id: 'PRJ-1',
        path: '/workspaces/p1',
        displayName: 'P1 name',
        status: 'active',
        boundAt: T,
        archivedAt: null,
      },
      {
        id: 'PRJ-2',
        path: '/workspaces/p2',
        displayName: 'P2 name',
        status: 'archived',
        boundAt: T,
        archivedAt: T + 999,
      },
    ])
  })

  it('the wire displayName: the entry name (MANAGED) / the tree title (STANDALONE)', () => {
    expect(planeProjectDisplayName(planeProject('PRJ-1', 'MANAGED'))).toBe('PRJ-1 entry name')
    expect(planeProjectDisplayName(planeProject('PRJ-2', 'STANDALONE'))).toBe('PRJ-2 tree title')
    // The degenerate fallback (a wired project always has the title —
    // unreachable in production; the id is the honest fallback).
    expect(
      planeProjectDisplayName(planeProject('PRJ-2', 'STANDALONE', { treeTitle: null })),
    ).toBe('PRJ-2')
  })
})

/* ------------------------------------------------------------------ *
 * ADJ-11 (UI-9 D4) — the plane integrity projection
 * ------------------------------------------------------------------ */

/** A synthetic gate. The projection reads exactly: reinitialized /
 *  tree.status / consistency.status / readSurface — the remainder of the
 *  report surface is cast away (the whitebox-cast precedent of this
 *  suite's helpers). */
function gate(
  over: {
    reinitialized?: boolean
    tree?: 'pass' | 'recoverable'
    consistency?: 'pass' | 'recoverable' | 'unrecoverable' | 'skipped'
    readSurface?: 'ok' | 'readonly'
  } = {},
): StartupIntegrityGate {
  return {
    reinitialized: over.reinitialized ?? false,
    tree: { status: over.tree ?? 'pass' },
    consistency: { status: over.consistency ?? 'pass' },
    readSurface: over.readSurface ?? 'ok',
  } as unknown as StartupIntegrityGate
}

/** A synthetic git-boundary result (the classification fields the
 *  projection's sibling surface carries; `message` is diagnostics). */
function gitStatus(status: GitCheckResult['status'] = 'pass'): GitCheckResult {
  return {
    status,
    managedMode: 'ok',
    checkpointAllowed: true,
    message: 'synthetic',
  } as unknown as GitCheckResult
}

/** A synthetic wiring whose `integrity` is the given gate (the attach
 *  reads `wiring.integrity` + awaits `wiring.integrity.git`). */
function wiringWith(
  over: Parameters<typeof gate>[0] = {},
  git: GitCheckResult = gitStatus(),
): HostWiring {
  return { integrity: { ...gate(over), git: Promise.resolve(git) } } as unknown as HostWiring
}

describe('projectPlaneIntegrity — the ADJ-11 machine-code projection (pure)', () => {
  it('pins the LOCKED vocabulary (the client keys on exactly these strings)', () => {
    expect(INTEGRITY_CODE_WIRING_REINITIALIZED).toBe('WIRING_REINITIALIZED')
    expect(INTEGRITY_CODE_TREE_PARTIAL).toBe('TREE_PARTIAL')
    expect(INTEGRITY_CODE_CONSISTENCY_MISMATCH).toBe('CONSISTENCY_MISMATCH')
    expect(INTEGRITY_CODE_GIT_REPO_ERROR).toBe('GIT_REPO_ERROR')
  })

  it('clean gate + clean git → writable surface, no codes', () => {
    expect(projectPlaneIntegrity(gate(), gitStatus())).toEqual({ readOnly: false, checkCodes: [] })
  })

  it('gate.reinitialized ⇔ WIRING_REINITIALIZED (the gate-internal re-init echo)', () => {
    expect(projectPlaneIntegrity(gate({ reinitialized: true }), gitStatus()).checkCodes).toEqual([
      INTEGRITY_CODE_WIRING_REINITIALIZED,
    ])
  })

  it('tree recoverable ⇔ TREE_PARTIAL (partial breakage → degraded surface)', () => {
    expect(projectPlaneIntegrity(gate({ tree: 'recoverable' }), gitStatus()).checkCodes).toEqual([
      INTEGRITY_CODE_TREE_PARTIAL,
    ])
  })

  it('consistency non-pass ⇔ CONSISTENCY_MISMATCH (any non-pass status)', () => {
    for (const status of ['recoverable', 'unrecoverable', 'skipped'] as const) {
      expect(projectPlaneIntegrity(gate({ consistency: status }), gitStatus()).checkCodes).toEqual([
        INTEGRITY_CODE_CONSISTENCY_MISMATCH,
      ])
    }
  })

  it('git non-pass ⇔ GIT_REPO_ERROR (any non-pass status)', () => {
    // CheckStatus has no 'conflict' literal — the host's git check
    // classifies a conflict as `status: 'recoverable'` +
    // `conflictInProgress: true` (git-check.ts), so the projection
    // fires on the status alone.
    for (const status of ['recoverable', 'unrecoverable', 'skipped'] as const) {
      expect(projectPlaneIntegrity(gate(), gitStatus(status)).checkCodes).toEqual([
        INTEGRITY_CODE_GIT_REPO_ERROR,
      ])
    }
  })

  it('readSurface readonly ⇔ readOnly true (the read surface stays available)', () => {
    expect(projectPlaneIntegrity(gate({ readSurface: 'readonly' }), gitStatus()).readOnly).toBe(true)
    expect(projectPlaneIntegrity(gate({ readSurface: 'ok' }), gitStatus()).readOnly).toBe(false)
  })

  it('all four + readonly → all codes in the LOCKED order + readOnly', () => {
    expect(
      projectPlaneIntegrity(
        gate({
          reinitialized: true,
          tree: 'recoverable',
          consistency: 'recoverable',
          readSurface: 'readonly',
        }),
        gitStatus('unrecoverable'),
      ),
    ).toEqual({
      readOnly: true,
      checkCodes: [
        INTEGRITY_CODE_WIRING_REINITIALIZED,
        INTEGRITY_CODE_TREE_PARTIAL,
        INTEGRITY_CODE_CONSISTENCY_MISMATCH,
        INTEGRITY_CODE_GIT_REPO_ERROR,
      ],
    })
  })
})

describe('getResearchPlaneState — the ADJ-11 integrity attach (stubbed composition)', () => {
  /** The production port over a stubbed plane (no host, no disk):
   *  MANAGED PRJ-1 + STANDALONE PRJ-2, the wirings map injectable — the
   *  three attach branches (map undefined / MANAGED missing from the
   *  map / wired) without a REAL init. */
  function attachSvc(wirings: Map<string, HostWiring> | undefined): ProductionResearchPlaneServices {
    return new ProductionResearchPlaneServices({
      getPlane: () =>
        planeState({
          hub: { path: '/workspaces/hub' },
          projects: [planeProject('PRJ-1', 'MANAGED'), planeProject('PRJ-2', 'STANDALONE')],
        }),
      getWirings: () => wirings,
      dirNames: () => ({ treeDir: '.research', hubDir: '.research-control' }),
      sessions: { listSessions: () => [] } as unknown as DshSessionAdapter,
      declarativeDir: '/workspaces/hub/.research-control/declarative',
    })
  }

  it('a composition without the wirings map keeps the field undefined (every entry)', async () => {
    const state = await attachSvc(undefined).getResearchPlaneState({})
    expect(state.projects).toEqual([
      { projectId: 'PRJ-1', displayName: 'PRJ-1 entry name', kind: 'MANAGED', wsPath: '/workspaces/PRJ-1' },
      { projectId: 'PRJ-2', displayName: 'PRJ-2 tree title', kind: 'STANDALONE', wsPath: '/workspaces/PRJ-2' },
    ])
  })

  it('a MANAGED project missing from the wirings map keeps the field undefined', async () => {
    const state = await attachSvc(new Map([['PRJ-9', wiringWith()]]))
      .getResearchPlaneState({})
    expect(state.projects[0]).not.toHaveProperty('integrity')
    expect(state.projects[1]).not.toHaveProperty('integrity')
  })

  it('a wired MANAGED project carries the gate projection; STANDALONE skips even when wired', async () => {
    const state = await attachSvc(
      new Map<string, HostWiring>([
        ['PRJ-1', wiringWith({ reinitialized: true, tree: 'recoverable', readSurface: 'readonly' })],
        ['PRJ-2', wiringWith({ reinitialized: true })],
      ]),
    ).getResearchPlaneState({})
    expect(state.projects[0]).toEqual({
      projectId: 'PRJ-1',
      displayName: 'PRJ-1 entry name',
      kind: 'MANAGED',
      wsPath: '/workspaces/PRJ-1',
      integrity: {
        readOnly: true,
        checkCodes: [INTEGRITY_CODE_WIRING_REINITIALIZED, INTEGRITY_CODE_TREE_PARTIAL],
      },
    })
    expect(state.projects[1]).not.toHaveProperty('integrity')
  })
})
