/**
 * V2-UI-0.4 (Task 3) — the hierarchy create pair RPC FACE behavior
 * (createTopic / createWorkstream over the REAL host service, real
 * wiring, real research tree on real git workspaces).
 *
 * The unit suite (`tests/hierarchy/service.test.ts`) covers the
 * `HierarchyService` kernel in isolation (fake seams for the TOCTOU /
 * write-failure cases). This suite closes the integration gaps:
 *   - the D §8.1 create pair end-to-end: create → canonical result →
 *     IMMEDIATE read-face visibility (the liveness acceptance — every
 *     read is a FRESH `loadResearchTree`, so the new node is visible
 *     on the very next read, same mounted host, NO restart/rescan);
 *   - the minimal-file-set discipline through the REAL loader over the
 *     REAL frozen schemas (the written `topic.yaml` /
 *     `workstream.yaml` must come back clean — path-id rule, project
 *     ref, title bounds, the `lifecycle: PLANNED` default materialized
 *     at load);
 *   - the wire error carrier (the gateway folds a host throw to
 *     `{ ok: false, error: <message> }`; the
 *     `[research-control] <CODE>:` prefix is the machine-matchable
 *     carrier — the CF_ / PLANE_* precedent);
 *   - the strict-decode-before-route ordering (malformed args reject
 *     with a ZodError even though no project state exists to route to
 *     — decode precedes `requireRpc`);
 *   - explicit projectId routing (D §6.5: per-request project scoping,
 *     no cross-project bleed — the create lands in the ROUTED
 *     project's tree, the other project's tree is untouched).
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  disposeFiber,
  freshDshHome,
  initPlane,
  makeProjectWs,
  mountHost,
} from '../rpc-plane/helpers.js'

describe('V2-UI-0.4 (Task 3) — createTopic / createWorkstream over the real host service', () => {
  let ws: string
  let h: ReturnType<typeof mountHost>

  beforeEach(async () => {
    freshDshHome()
    ws = makeProjectWs('PRJ-1')
    h = mountHost([ws])
    await initPlane(h)
  })

  afterEach(() => {
    disposeFiber(h)
  })

  it('createTopic allocates TPC-2 and the new node is VISIBLE ON THE NEXT READ (no restart, no rescan)', async () => {
    const created = await h.svc.createTopic({ title: 'Audit trail' })
    expect(created).toEqual({
      topicId: 'TPC-2',
      title: 'Audit trail',
      path: 'topics/TPC-2/topic.yaml',
      createdAt: expect.any(Number),
    })
    expect(Number.isInteger(created.createdAt)).toBe(true)
    // The liveness acceptance: the SAME mounted host, the very next
    // read. `getTopic` is a FRESH `loadResearchTree` per call — the
    // new file is already on disk, so it must be in the tree NOW.
    const snap = await h.svc.getTopic({ topicId: 'TPC-2' })
    expect(snap.topic.id).toBe('TPC-2')
    expect(snap.topic.title).toBe('Audit trail')
    expect(snap.topic.description).toBeNull()
    // Minimal file set: a fresh topic carries no workstreams, no
    // topology edges, no merge contracts.
    expect(snap.workstreams).toEqual([])
    expect(snap.topology.edges).toEqual([])
  })

  it('createTopic carries the optional description into the read face', async () => {
    await h.svc.createTopic({ title: 'T', description: 'the why' })
    expect((await h.svc.getTopic({ topicId: 'TPC-2' })).topic.description).toBe('the why')
  })

  it('allocation is monotonic across calls (each create re-loads a fresh tree)', async () => {
    const a = await h.svc.createTopic({ title: 'A' })
    const b = await h.svc.createTopic({ title: 'B' })
    expect(a.topicId).toBe('TPC-2')
    expect(b.topicId).toBe('TPC-3')
    expect((await h.svc.getTopic({ topicId: 'TPC-3' })).topic.title).toBe('B')
  })

  it('createWorkstream allocates WS-4 (project-wide max+1) and the frozen default materializes: lifecycle PLANNED', async () => {
    const created = await h.svc.createWorkstream({ topicId: 'TPC-1', title: 'New lane' })
    expect(created).toEqual({
      workstreamId: 'WS-4',
      topicId: 'TPC-1',
      title: 'New lane',
      path: 'topics/TPC-1/workstreams/WS-4/workstream.yaml',
      createdAt: expect.any(Number),
    })
    // The file carries NO lifecycle key (the minimal file set) — the
    // loader materializes the frozen default at read time.
    const snap = await h.svc.getWorkstream({ workstreamId: 'WS-4' })
    expect(snap.workstream.id).toBe('WS-4')
    expect(snap.workstream.topicId).toBe('TPC-1')
    expect(snap.workstream.title).toBe('New lane')
    expect(snap.workstream.lifecycle).toBe('PLANNED')
    expect(snap.workstream.summary).toBeNull()
  })

  it('createWorkstream carries the optional summary into the read face', async () => {
    await h.svc.createWorkstream({ topicId: 'TPC-1', title: 'T', summary: 'the what' })
    const snap = await h.svc.getWorkstream({ workstreamId: 'WS-4' })
    expect(snap.workstream.summary).toBe('the what')
  })

  it('createWorkstream on an absent topic rejects with the [HIER_TOPIC_NOT_FOUND] wire carrier (nothing written)', async () => {
    await expect(h.svc.createWorkstream({ topicId: 'TPC-9', title: 'Ghost' })).rejects.toThrow(
      /\[research-control\] HIER_TOPIC_NOT_FOUND: .*TPC-9/,
    )
    // The gate runs BEFORE allocation + write — no node, no directory.
    expect(existsSync(join(ws, '.research', 'topics', 'TPC-9'))).toBe(false)
  })

  it('the strict-decode rejections precede routing (ZodError, no [research-control] carrier)', async () => {
    const decodeFailures: Array<() => Promise<unknown>> = [
      () => h.svc.createTopic({ title: '' }), // title minLength 1
      () => h.svc.createWorkstream({ topicId: 'TPC-1' }), // title missing
      () => h.svc.createTopic({ title: 'ok', extra: 1 }), // strict: unrecognized key
    ]
    for (const call of decodeFailures) {
      const e = await call().catch((x: unknown) => x)
      expect(e, 'the malformed call must reject').toBeInstanceOf(Error)
      // A decode failure is a raw ZodError — it never enters the
      // HIER_ carrier mapping (the gateway folds it verbatim).
      expect((e as Error).message).not.toContain('[research-control]')
    }
    // Nothing was allocated or written by the rejected calls.
    expect((await h.svc.getTopic({ topicId: 'TPC-1' })).topic.title).toBeTruthy()
    expect(existsSync(join(ws, '.research', 'topics', 'TPC-2'))).toBe(false)
  })
})

describe('V2-UI-0.4 (Task 3) — multi-project routing', () => {
  it('an explicit projectId routes the create to the target project wiring (D §6.5)', async () => {
    freshDshHome()
    const ws1 = makeProjectWs('PRJ-1')
    const ws2 = makeProjectWs('PRJ-2')
    const h = mountHost([ws1, ws2])
    try {
      await initPlane(h)

      // Route a createTopic to PRJ-2 (the fingerprints prove the trees
      // are distinct: 'Project Two Topic' is PRJ-2's TPC-1 title).
      const created = await h.svc.createTopic({ title: 'Routed topic', projectId: 'PRJ-2' })
      expect(created.topicId).toBe('TPC-2')
      expect((await h.svc.getTopic({ topicId: 'TPC-1', projectId: 'PRJ-2' })).topic.title).toBe(
        'Project Two Topic',
      )
      expect((await h.svc.getTopic({ topicId: 'TPC-2', projectId: 'PRJ-2' })).topic.title).toBe(
        'Routed topic',
      )

      // PRJ-1's tree is UNTOUCHED (no cross-project bleed): it has no
      // TPC-2, and its TPC-1 is the base fixture's title.
      await expect(h.svc.getTopic({ topicId: 'TPC-2', projectId: 'PRJ-1' })).rejects.toThrow(
        /does not exist/,
      )
      expect(existsSync(join(ws1, '.research', 'topics', 'TPC-2'))).toBe(false)
      expect(existsSync(join(ws2, '.research', 'topics', 'TPC-2', 'topic.yaml'))).toBe(true)

      // The same for the workstream create: routed to PRJ-2, PRJ-1's
      // TPC-1 still carries exactly the fixture's three workstreams.
      const wsc = await h.svc.createWorkstream({
        topicId: 'TPC-1',
        title: 'Routed lane',
        projectId: 'PRJ-2',
      })
      expect(wsc.workstreamId).toBe('WS-4')
      expect(
        (await h.svc.getWorkstream({ workstreamId: 'WS-4', projectId: 'PRJ-2' })).workstream.title,
      ).toBe('Routed lane')
      const prj1Topic = await h.svc.getTopic({ topicId: 'TPC-1', projectId: 'PRJ-1' })
      expect(prj1Topic.workstreams.map((c) => c.id)).toEqual(['WS-1', 'WS-2', 'WS-3'])
      expect(existsSync(join(ws1, '.research', 'topics', 'TPC-1', 'workstreams', 'WS-4'))).toBe(false)
    } finally {
      disposeFiber(h)
    }
  })
})
