/**
 * V2-T3.2a — the §12.1 projectId routing on the frozen 13 RPCs (the
 * `requireRpc` dispatch seam, now fed by the decoded optional `projectId`).
 *
 * Coverage (the T3.2a brief — 三分支 + 两条错误边), over REAL
 * `[Service.init]` planes with DISTINCT per-project data (the two trees
 * carry different topic titles, so the routed project is observable in
 * the response):
 *  - explicit `projectId` → that project (MANAGED or STANDALONE — the
 *    response carries THAT project's data);
 *  - omitted & exactly one active project → that project (the V1
 *    implicit-single behavior — byte-identical on a single-project plane);
 *  - omitted & several → a clear error listing every project id (never
 *    guess — the two zero-arg queries keep their frozen wire face and
 *    hit the same branch);
 *  - explicit naming no active project (UNKNOWN_PROJECT — the error
 *    lists the candidates);
 *  - explicit naming a MISSING registration (not routable — the
 *    disposition runs through the T3/T4 plane face, not the frozen 13).
 *
 * The RESULT schemas stay zero-touched (design §12.1): every response is
 * re-parsed through the frozen strict result schema (the gateway's
 * strict result decode, emulated).
 */
import { describe, expect, it } from 'vitest'

import {
  TopicSnapshotSchema,
  WorkstreamSnapshotSchema,
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
import type { RegistryEntry } from '../../src/host/domain/registry/index.js'

const T = 1_770_000_000_000

function entry(id: string, path: string, displayName: string): RegistryEntry {
  return { id, path, displayName, status: 'active', boundAt: T, archivedAt: null }
}

describe('§12.1 routing — explicit projectId (branch 1)', () => {
  it('routes to the named project on a 2-project plane (the response carries THAT project data)', async () => {
    freshDshHome()
    const wsA = makeProjectWs('PRJ-1') // topic title: 标定与配准
    const wsB = makeProjectWs('PRJ-2') // topic title: Project Two Topic (the patch)
    const hub = makeHubWs([entry('PRJ-1', wsA, '机器人视觉定位系统')])
    const h = mountHost([hub, wsA, wsB])
    try {
      await initPlane(h)
      // Explicit PRJ-2 → PRJ-2's data (the STANDALONE project is
      // routable too — MANAGED/STANDALONE are the active set). The
      // topic title is the routing fingerprint (the PRJ-2 tree carries
      // the patched title — the frozen TopicSnapshot result re-parses
      // cleanly: the result shapes are zero-touched, §12.1).
      const toB = TopicSnapshotSchema.parse(
        await h.svc.getTopic({ topicId: 'TPC-1', projectId: 'PRJ-2' }),
      )
      expect(toB.topic.id).toBe('TPC-1')
      expect(toB.topic.title).toBe('Project Two Topic')
      // Explicit PRJ-1 → PRJ-1's data.
      const toA = TopicSnapshotSchema.parse(
        await h.svc.getTopic({ topicId: 'TPC-1', projectId: 'PRJ-1' }),
      )
      expect(toA.topic.id).toBe('TPC-1')
      expect(toA.topic.title).toBe('标定与配准')
      // The frozen 11 RPCs route the same way (another RPC, same seam —
      // the workstream title is the second fingerprint):
      const wsB2 = WorkstreamSnapshotSchema.parse(
        await h.svc.getWorkstream({ workstreamId: 'WS-1', projectId: 'PRJ-2' }),
      )
      expect(wsB2.workstream.id).toBe('WS-1')
      expect(wsB2.workstream.title).toBe('Project Two Pipeline')
    } finally {
      disposeFiber(h)
    }
  }, 30_000)
})

describe('§12.1 routing — omitted projectId (branches 2 + 3)', () => {
  it('omitted & exactly one active project → that project (the V1 implicit-single behavior)', async () => {
    freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const hub = makeHubWs([entry('PRJ-1', wsA, '机器人视觉定位系统')])
    const h = mountHost([hub, wsA])
    try {
      await initPlane(h)
      // No projectId — the sole active project resolves (byte-identical
      // to the V1 call shape; the result re-parses through the frozen
      // strict schema — the result shapes are zero-touched, §12.1).
      const topic = TopicSnapshotSchema.parse(await h.svc.getTopic({ topicId: 'TPC-1' }))
      expect(topic.topic.id).toBe('TPC-1')
      expect(topic.topic.title).toBe('标定与配准')
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('omitted & several active projects → a clear error listing every project id (never guess)', async () => {
    freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const wsB = makeProjectWs('PRJ-2')
    const hub = makeHubWs([entry('PRJ-1', wsA, '机器人视觉定位系统')])
    const h = mountHost([hub, wsA, wsB])
    try {
      await initPlane(h)
      // The parameterized face …
      await expect(h.svc.getTopic({ topicId: 'TPC-1' })).rejects.toThrow(
        /multiple projects are active in the research plane \(PRJ-1, PRJ-2\)/,
      )
      // … and the frozen zero-arg queries hit the same branch (their
      // wire face carries no projectId — the omitted-id rule only).
      await expect(h.svc.getProject()).rejects.toThrow(/multiple projects are active/)
      await expect(h.svc.getDashboard()).rejects.toThrow(/multiple projects are active/)
    } finally {
      disposeFiber(h)
    }
  }, 30_000)
})

describe('§12.1 routing — the two error edges', () => {
  it('explicit projectId naming no active project → UNKNOWN_PROJECT (the candidates are listed)', async () => {
    freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const wsB = makeProjectWs('PRJ-2')
    const hub = makeHubWs([entry('PRJ-1', wsA, '机器人视觉定位系统')])
    const h = mountHost([hub, wsA, wsB])
    try {
      await initPlane(h)
      try {
        await h.svc.getTopic({ topicId: 'TPC-1', projectId: 'PRJ-9' })
        expect.unreachable()
      } catch (e) {
        expect((e as { code?: string }).code).toBe('UNKNOWN_PROJECT')
        expect((e as Error).message).toContain('PRJ-9')
        expect((e as Error).message).toContain('PRJ-1')
        expect((e as Error).message).toContain('PRJ-2')
      }
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('explicit projectId naming a MISSING registration → not routable (the disposition runs through the plane face, not the frozen 13)', async () => {
    freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const wsC = makePlainWs() // registered, but its tree is lost → MISSING
    const hub = makeHubWs([
      entry('PRJ-1', wsA, '机器人视觉定位系统'),
      entry('PRJ-3', wsC, '缺失的项目'),
    ])
    const h = mountHost([hub, wsA, wsC])
    try {
      await initPlane(h)
      try {
        await h.svc.getTopic({ topicId: 'TPC-1', projectId: 'PRJ-3' })
        expect.unreachable()
      } catch (e) {
        expect((e as { code?: string }).code).toBe('UNKNOWN_PROJECT')
        expect((e as Error).message).toContain('PRJ-3')
        expect((e as Error).message).toContain('not an active project')
      }
      // …and the omitted-id rule still resolves the sole ACTIVE project
      // (the MISSING entry is not a routing candidate).
      const topic = TopicSnapshotSchema.parse(await h.svc.getTopic({ topicId: 'TPC-1' }))
      expect(topic.topic.id).toBe('TPC-1')
      expect(topic.topic.title).toBe('标定与配准') // PRJ-1's tree
    } finally {
      disposeFiber(h)
    }
  }, 30_000)
})
