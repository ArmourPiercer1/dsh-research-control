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
 *    rejected at the strict schema boundary (before anything runs).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  projectPlaneSummary,
  planeProjectDisplayName,
  resolveSessionRole,
} from '../../src/host/dsh-adapter/host/plane-read-services.js'
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
      expect(hubState.projects).toEqual([
        { projectId: 'PRJ-1', displayName: '机器人视觉定位系统', kind: 'MANAGED', wsPath: p.wsA },
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
