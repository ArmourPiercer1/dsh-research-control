/**
 * V2-T3.2b — RPC-level tests for the 6 plane MUTATION RPCs, driven
 * THROUGH the @Remote face (the plan T3.2 gate: for each of the 6
 * mutations, one happy path + at least one rejection path through the
 * face).
 *
 * Style: the REAL `ResearchControlService.[Service.init]` over real
 * temp workspaces (the tests/rpc-plane/helpers.ts harness — the same
 * mountHost/initPlane drive the T3.2a read-face suites use); the
 * mutations are called DIRECTLY on the service instance
 * (`h.svc.<method>(args)` — @Remote is a marker, the body IS the RPC
 * face), the results are re-parsed through the shared STRICT result
 * schemas (the gateway's strict result decode, emulated), and the
 * rejections are asserted on the `PlaneError` code + message (business
 * failure — the gateway would fold it into `{ ok: false, error }`) or
 * at the strict args-schema boundary (a malformed wire args object —
 * rejected before the port is ever reached).
 *
 * The 6 mutations are PLANE-LEVEL (design §12 rows 4-6/8/9): NOT
 * project-routed (§12.1 applies to the frozen 13 only) — callable on
 * the EMPTY plane too (that is the onboarding path, design §8 设为中枢
 * / 接入: setHub on an empty plane, then bindProject). A successful
 * mutation re-runs `#initResearchPlane` through the port's re-init
 * hook, so the NEXT RPC call sees the fresh plane state — asserted
 * after every happy path via a strict-decoded `getResearchPlaneState`.
 *
 * Coverage (one happy + one-or-more rejections per mutation):
 *  - setHub (§12 row 4): create on the EMPTY plane (the onboarding
 *    path — the hub visible to the NEXT read); rejections: a
 *    non-registered path (`PLANE_NOT_REGISTERED_WORKSPACE`), a hub
 *    already existing at another ws (`PLANE_HUB_EXISTS`), the hub ws
 *    itself (`PLANE_HUB_MARKER_EXISTS`), the strict-args boundary.
 *  - bindProject (§12 row 5): bind a STANDALONE project (接入) — the
 *    REAL standalone research.sqlite is sealed + migrated to the hub
 *    placement (`dbMigrated: true`, 一次只有一份), the NEXT read shows
 *    MANAGED; rejections: the hub workspace itself
 *    (`PLANE_HUB_WORKSPACE`), an already-MANAGED project
 *    (`PLANE_ALREADY_MANAGED`).
 *  - unbindProject (§12 row 6): unbind a MANAGED project (解除绑定 —
 *    the entry tombstoned + the tree renamed to
 *    `<treeDir>.archived-<时间戳>`, the NEXT read sees neither a
 *    project nor a missing); rejections: a STANDALONE project
 *    (`PLANE_NOT_MANAGED`).
 *  - restoreProject (§12 row 7): restore the just-unbound project
 *    (恢复登记 — the tree renamed back, the entry re-activated, the
 *    NEXT read shows MANAGED again); rejections: an unknown id
 *    (`PLANE_NOT_ARCHIVED`), the same id twice (it is active again
 *    after the first restore).
 *  - rescan (§12 row 8): the fresh plane summary over a 2-project
 *    plane (the 重扫并连接); rejection: a non-empty strict-args
 *    object (the request is the EMPTY strict object — any field is a
 *    decode fault).
 *  - ackMissingReminder (§12 row 9): ack a live MISSING registration
 *    (the 推后处理 flag set — it SURVIVES the re-init, the NEXT read's
 *    `deferred` is true); rejections: an active MANAGED id and an
 *    unknown id (`PLANE_NOT_MISSING` — the flag is for live MISSING
 *    entries only).
 *  - the pre-init guard (all 6): a service WITHOUT `[Service.init]`
 *    fails loud on every mutation (the spike-mode contract — ping
 *    stays available, the mutation face does not).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import { ResearchControlService } from '../../src/host/dsh-adapter/host/index.js'
import type { RegistryEntry } from '../../src/host/domain/registry/types.js'
import {
  AckMissingReminderResultSchema,
  BindProjectResultSchema,
  GetResearchPlaneStateResultSchema,
  RescanResultSchema,
  RestoreProjectResultSchema,
  SetHubResultSchema,
  UnbindProjectResultSchema,
  type GetResearchPlaneStateResult,
} from '../../src/shared/rpc-contracts.js'
import {
  disposeFiber,
  freshDshHome,
  initPlane,
  makeHubWs,
  makePlainWs,
  makeProjectWs,
  mountHost,
} from './helpers.js'

/* ------------------------------------------------------------------ *
 * Small local helpers (the routing.test.ts conventions)
 * ------------------------------------------------------------------ */

const T = 1_755_000_000_000

function entry(id: string, path: string, displayName: string): RegistryEntry {
  return { id, path, displayName, status: 'active', boundAt: T, archivedAt: null }
}

/** Re-parse a plane read through the strict result schema (the gateway decode). */
function wire(v: unknown): GetResearchPlaneStateResult {
  return GetResearchPlaneStateResultSchema.parse(v)
}

/** Minimal context double (construction wiring only — the rpc-spike form). */
function minimalCtx(): Context {
  return {
    reflect: { provide: () => undefined },
    effect: () => ({}),
  } as unknown as Context
}

describe('setHub (§12 row 4) — the onboarding face', () => {
  it('happy: creates the hub on the EMPTY plane — the NEXT read sees it (the re-init hook ran)', async () => {
    freshDshHome()
    const ws = makePlainWs()
    const h = mountHost([ws])
    try {
      await initPlane(h)
      // Pre-state: the empty plane (no hub, no projects — the V1 spike
      // mode in the multi-project vocabulary; the mutation face is live
      // even here, that IS the onboarding path, design §8).
      const before = wire(await h.svc.getResearchPlaneState({}))
      expect(before.hub).toBeNull()
      expect(before.projects).toEqual([])
      // The onboarding call (design §8 设为中枢).
      const res = SetHubResultSchema.parse(await h.svc.setHub({ wsPath: ws }))
      expect(res.hubPath).toBe(ws)
      expect(res.registryPath).toBe(join(ws, '.research-control', 'registry.yaml'))
      expect(existsSync(res.registryPath)).toBe(true)
      // The NEXT RPC call sees the fresh plane state (the re-init hook
      // re-ran discovery after the mutation's commit).
      const after = wire(await h.svc.getResearchPlaneState({}))
      expect(after.hub).toEqual({ path: ws })
      expect(after.projects).toEqual([])
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('rejects: a non-registered path → PLANE_NOT_REGISTERED_WORKSPACE (the hub can only live in a REGISTERED workspace)', async () => {
    freshDshHome()
    const ws = makePlainWs()
    const ghost = makePlainWs() // on disk, but NOT a registered DSH workspace
    const h = mountHost([ws])
    try {
      await initPlane(h)
      try {
        await h.svc.setHub({ wsPath: ghost })
        expect.unreachable()
      } catch (e) {
        expect((e as { code?: string }).code).toBe('PLANE_NOT_REGISTERED_WORKSPACE')
        expect((e as Error).message).toContain(ghost)
      }
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('rejects: a hub already exists at another ws (PLANE_HUB_EXISTS) / the hub ws itself (PLANE_HUB_MARKER_EXISTS)', async () => {
    freshDshHome()
    const hub = makeHubWs([])
    const other = makePlainWs()
    const h = mountHost([hub, other])
    try {
      await initPlane(h)
      try {
        await h.svc.setHub({ wsPath: other })
        expect.unreachable()
      } catch (e) {
        expect((e as { code?: string }).code).toBe('PLANE_HUB_EXISTS')
      }
      try {
        await h.svc.setHub({ wsPath: hub })
        expect.unreachable()
      } catch (e) {
        expect((e as { code?: string }).code).toBe('PLANE_HUB_MARKER_EXISTS')
      }
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('rejects: a malformed args object at the strict schema boundary (relative path / unknown field)', async () => {
    freshDshHome()
    const ws = makePlainWs()
    const h = mountHost([ws])
    try {
      await initPlane(h)
      // The @Remote body decodes with the strict schema: a relative
      // wsPath (the absolutePath regex) and an unknown field are both
      // decode faults — a ZodError, never a business PlaneError.
      await expect(h.svc.setHub({ wsPath: 'relative/path' })).rejects.toThrow(z.ZodError)
      await expect(h.svc.setHub({ wsPath: ws, surprise: 1 } as unknown)).rejects.toThrow(z.ZodError)
    } finally {
      disposeFiber(h)
    }
  }, 30_000)
})

describe('bindProject (§12 row 5) — the 接入 face', () => {
  it('happy: binds a STANDALONE project — the db 收编 migrates the real research.sqlite to the hub, the NEXT read shows MANAGED', async () => {
    freshDshHome()
    const hub = makeHubWs([])
    const wsA = makeProjectWs('PRJ-1') // a registered tree the registry does not claim → STANDALONE
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h)
      const before = wire(await h.svc.getResearchPlaneState({}))
      expect(before.projects).toEqual([
        {
          projectId: 'PRJ-1',
          displayName: '机器人视觉定位系统',
          kind: 'STANDALONE',
          wsPath: wsA,
        },
      ])
      // The init's rewiring opened the standalone store (the db the
      // 收编 will migrate):
      const standaloneDb = join(wsA, '.research', 'state', 'research.sqlite')
      expect(existsSync(standaloneDb)).toBe(true)
      // The 接入 call (design §8):
      const res = BindProjectResultSchema.parse(
        await h.svc.bindProject({ wsPath: wsA, displayName: '绑定项目' }),
      )
      expect(res.projectId).toBe('PRJ-1')
      expect(res.registryPath).toBe(join(hub, '.research-control', 'registry.yaml'))
      // The db 收编: a real standalone db was present → sealed (the
      // wiring closed) + MIGRATED to the MANAGED placement, never
      // copied (一次只有一份, design §9 推论 1):
      expect(res.dbMigrated).toBe(true)
      expect(existsSync(standaloneDb)).toBe(false)
      expect(existsSync(join(hub, '.research-control', 'projects', 'PRJ-1', 'research.sqlite'))).toBe(true)
      // The NEXT read: MANAGED now (the re-init rewired the project at
      // its new hub placement; the entry's display name is live):
      const after = wire(await h.svc.getResearchPlaneState({}))
      expect(after.projects).toEqual([
        { projectId: 'PRJ-1', displayName: '绑定项目', kind: 'MANAGED', wsPath: wsA },
      ])
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('rejects: the hub workspace itself (PLANE_HUB_WORKSPACE) / an already-MANAGED project (PLANE_ALREADY_MANAGED)', async () => {
    freshDshHome()
    const hub = makeHubWs([])
    const wsA = makeProjectWs('PRJ-1')
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h)
      await h.svc.bindProject({ wsPath: wsA }) // PRJ-1 is MANAGED now
      try {
        await h.svc.bindProject({ wsPath: wsA })
        expect.unreachable()
      } catch (e) {
        expect((e as { code?: string }).code).toBe('PLANE_ALREADY_MANAGED')
      }
      try {
        await h.svc.bindProject({ wsPath: hub })
        expect.unreachable()
      } catch (e) {
        expect((e as { code?: string }).code).toBe('PLANE_HUB_WORKSPACE')
      }
    } finally {
      disposeFiber(h)
    }
  }, 30_000)
})

describe('unbindProject (§12 row 6) — the 解除绑定 face', () => {
  it('happy: unbinds a MANAGED project — the entry tombstoned, the tree renamed to <treeDir>.archived-<ts>, the NEXT read sees neither', async () => {
    freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const hub = makeHubWs([entry('PRJ-1', wsA, '机器人视觉定位系统')])
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h)
      const res = UnbindProjectResultSchema.parse(await h.svc.unbindProject({ wsPath: wsA }))
      expect(res.projectId).toBe('PRJ-1')
      // The archive dir is <ws>/.research.archived-<epoch-ms>:
      const prefix = join(wsA, '.research.archived-')
      expect(res.archivedDir.startsWith(prefix)).toBe(true)
      expect(res.archivedDir.slice(prefix.length)).toMatch(/^\d+$/)
      // The tree is renamed away (the registry archive was the commit
      // point, the rename followed):
      expect(existsSync(join(wsA, '.research'))).toBe(false)
      expect(existsSync(res.archivedDir)).toBe(true)
      // The NEXT read: neither an active project nor a MISSING entry —
      // the tombstone is a burned id, not a live candidate:
      const after = wire(await h.svc.getResearchPlaneState({}))
      expect(after.projects).toEqual([])
      expect(after.missing).toEqual([])
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('rejects: a STANDALONE project → PLANE_NOT_MANAGED (bindProject first)', async () => {
    freshDshHome()
    const hub = makeHubWs([])
    const wsB = makeProjectWs('PRJ-2') // a tree the registry does not claim → STANDALONE
    const h = mountHost([hub, wsB])
    try {
      await initPlane(h)
      try {
        await h.svc.unbindProject({ wsPath: wsB })
        expect.unreachable()
      } catch (e) {
        expect((e as { code?: string }).code).toBe('PLANE_NOT_MANAGED')
        expect((e as Error).message).toContain('STANDALONE')
      }
    } finally {
      disposeFiber(h)
    }
  }, 30_000)
})

describe('restoreProject (§12 row 7) — the 恢复登记 face', () => {
  it('happy: restores the just-unbound project — the tree renamed back, the entry re-activated, the NEXT read shows MANAGED', async () => {
    freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const hub = makeHubWs([entry('PRJ-1', wsA, '机器人视觉定位系统')])
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h)
      const un = UnbindProjectResultSchema.parse(await h.svc.unbindProject({ wsPath: wsA }))
      expect(existsSync(un.archivedDir)).toBe(true)
      // The 恢复登记 call (design §8):
      const res = RestoreProjectResultSchema.parse(await h.svc.restoreProject({ projectId: 'PRJ-1' }))
      expect(res.wsPath).toBe(wsA)
      // The tree is renamed back (与解绑对称) and the archive is gone:
      expect(existsSync(join(wsA, '.research'))).toBe(true)
      expect(existsSync(un.archivedDir)).toBe(false)
      // The NEXT read: MANAGED again (the entry re-activated):
      const after = wire(await h.svc.getResearchPlaneState({}))
      expect(after.projects).toEqual([
        { projectId: 'PRJ-1', displayName: '机器人视觉定位系统', kind: 'MANAGED', wsPath: wsA },
      ])
      expect(after.missing).toEqual([])
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('rejects: an unknown id and the same id twice → PLANE_NOT_ARCHIVED (an active id is not a tombstone)', async () => {
    freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const hub = makeHubWs([entry('PRJ-1', wsA, '机器人视觉定位系统')])
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h)
      await h.svc.unbindProject({ wsPath: wsA })
      // Unknown id (never registered, active or archived):
      try {
        await h.svc.restoreProject({ projectId: 'PRJ-9' })
        expect.unreachable()
      } catch (e) {
        expect((e as { code?: string }).code).toBe('PLANE_NOT_ARCHIVED')
      }
      // Restore once, then again: the second call names a LIVE ACTIVE
      // id — not a tombstone:
      await h.svc.restoreProject({ projectId: 'PRJ-1' })
      try {
        await h.svc.restoreProject({ projectId: 'PRJ-1' })
        expect.unreachable()
      } catch (e) {
        expect((e as { code?: string }).code).toBe('PLANE_NOT_ARCHIVED')
      }
    } finally {
      disposeFiber(h)
    }
  }, 30_000)
})

describe('rescan (§12 row 8) — the 重扫并连接 face', () => {
  it('happy: returns the fresh plane summary over a 2-project plane (MANAGED + STANDALONE)', async () => {
    freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const wsB = makeProjectWs('PRJ-2')
    const hub = makeHubWs([entry('PRJ-1', wsA, '机器人视觉定位系统')])
    const h = mountHost([hub, wsA, wsB])
    try {
      await initPlane(h)
      const res = RescanResultSchema.parse(await h.svc.rescan({}))
      expect(res.hub).toEqual({ path: hub })
      expect(res.dirNames).toEqual({ treeDir: '.research', hubDir: '.research-control' })
      expect(res.projects.map((p) => p.projectId)).toEqual(['PRJ-1', 'PRJ-2'])
      expect(res.projects.map((p) => p.kind)).toEqual(['MANAGED', 'STANDALONE'])
      expect(res.missing).toEqual([])
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('rejects: a non-empty strict-args object (the request is the EMPTY strict object — any field is a decode fault)', async () => {
    freshDshHome()
    const h = mountHost([makePlainWs()])
    try {
      await initPlane(h)
      await expect(h.svc.rescan({ surprise: 1 } as unknown)).rejects.toThrow(z.ZodError)
      await expect(h.svc.rescan({ wsPath: '/home/u/ws' } as unknown)).rejects.toThrow(z.ZodError)
    } finally {
      disposeFiber(h)
    }
  }, 30_000)
})

describe('ackMissingReminder (§12 row 9) — the 推后处理 face', () => {
  it('happy: acks a live MISSING registration — the flag SURVIVES the re-init, the NEXT read shows deferred: true', async () => {
    freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const wsGone = makePlainWs() // registered, but its tree is lost → MISSING
    const hub = makeHubWs([
      entry('PRJ-1', wsA, '机器人视觉定位系统'),
      entry('PRJ-3', wsGone, '缺失的项目'),
    ])
    const h = mountHost([hub, wsA, wsGone])
    try {
      await initPlane(h)
      // Pre-ack: the reminder is live (deferred: false):
      const before = wire(await h.svc.getResearchPlaneState({}))
      expect(before.missing).toEqual([
        { projectId: 'PRJ-3', displayName: '缺失的项目', wsPath: wsGone, deferred: false },
      ])
      // The 推后处理 call (design §4 MISSING 处置):
      const res = AckMissingReminderResultSchema.parse(
        await h.svc.ackMissingReminder({ projectId: 'PRJ-3' }),
      )
      expect(res).toEqual({ acknowledged: true })
      // The NEXT read: the runtime flag set (the re-init's re-seed
      // carried it onto the fresh discovery):
      const after = wire(await h.svc.getResearchPlaneState({}))
      expect(after.missing).toEqual([
        { projectId: 'PRJ-3', displayName: '缺失的项目', wsPath: wsGone, deferred: true },
      ])
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('rejects: an active MANAGED id and an unknown id → PLANE_NOT_MISSING (the flag is for live MISSING entries only)', async () => {
    freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const wsGone = makePlainWs()
    const hub = makeHubWs([
      entry('PRJ-1', wsA, '机器人视觉定位系统'),
      entry('PRJ-3', wsGone, '缺失的项目'),
    ])
    const h = mountHost([hub, wsA, wsGone])
    try {
      await initPlane(h)
      // An active (MANAGED) project id:
      try {
        await h.svc.ackMissingReminder({ projectId: 'PRJ-1' })
        expect.unreachable()
      } catch (e) {
        expect((e as { code?: string }).code).toBe('PLANE_NOT_MISSING')
      }
      // An unknown id (never registered):
      try {
        await h.svc.ackMissingReminder({ projectId: 'PRJ-9' })
        expect.unreachable()
      } catch (e) {
        expect((e as { code?: string }).code).toBe('PLANE_NOT_MISSING')
      }
    } finally {
      disposeFiber(h)
    }
  }, 30_000)
})

describe('the pre-init guard — the mutation face without [Service.init]', () => {
  it('all 6 mutations fail loud on an uninitialized service (the spike-mode contract — ping stays available)', async () => {
    const svc = new ResearchControlService(minimalCtx(), {})
    // The guard fires BEFORE the args decode (the port is required
    // first), so every body rejects with the same spike-mode message:
    await expect(svc.setHub({ wsPath: '/home/u/hub' })).rejects.toThrow(/plane mutation RPCs/)
    await expect(svc.bindProject({ wsPath: '/home/u/ws' })).rejects.toThrow(/plane mutation RPCs/)
    await expect(svc.unbindProject({ wsPath: '/home/u/ws' })).rejects.toThrow(/plane mutation RPCs/)
    await expect(svc.restoreProject({ projectId: 'PRJ-1' })).rejects.toThrow(/plane mutation RPCs/)
    await expect(svc.rescan({})).rejects.toThrow(/plane mutation RPCs/)
    await expect(svc.ackMissingReminder({ projectId: 'PRJ-1' })).rejects.toThrow(/plane mutation RPCs/)
    // ping is NOT guarded (the WP-0.3 spike-mode contract):
    await expect(svc.ping()).resolves.toMatchObject({ ok: true, service: 'researchControl' })
  })
})
