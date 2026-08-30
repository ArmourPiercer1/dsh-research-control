/**
 * UI-6 D1 — `TopologyService.createWorkstreamFork` unit suite (D §12.2,
 * BRIEF §3 contract 1 / §5 test matrix fork rows).
 *
 * Real kernels, one shared MemoryFs (the harness doc): the REAL
 * HierarchyService (child WS allocation + the DANGLING_REF loader gate
 * stay live), the REAL TopologyStore (explicit-id addEdge + deleteEdge
 * over the frozen schema), the REAL frozen `schema/declarative`
 * validation, the REAL IdAllocator (spied). Fakes: MemoryFs, the
 * recording LedgerDb, the deterministic clock.
 *
 * Matrix (BRIEF §5 fork rows + the compensation discipline):
 *   - legal single / double child (ids, 1:1 edges, origin ref on disk,
 *     edge note landing, TOPOLOGY_EDITED ledger row);
 *   - parent nonexistent / parent cross-topic / topic nonexistent;
 *   - child title > 200 (TOPO_INPUT);
 *   - WS id collision via the TOCTOU seam (TOPO_WORKSTREAM_EXISTS);
 *   - broken pre-load (TOPO_TREE_BROKEN, fail-loud before any write);
 *   - inverse compensation: clean no-residue rollback vs the residue
 *     path (loud TOPO_COMPLETION listing the residual ids);
 *   - the post-mutation full re-validation gate (cross-file);
 *   - ledger failure: NOT compensated (files stand, provenance gap
 *     explicit — the plan-writer caliber).
 */
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { SQL_INSERT_MANAGEMENT_ACTION } from '../../src/host/domain/planfork/index.js'
import { TopologyServiceError } from '../../src/host/service/topology/index.js'
import {
  baseTreeFiles,
  CONTRACT_MD,
  load,
  makeReader,
  mutate,
  TOPOLOGY_YAML,
} from '../loader/fixtures.js'
import { makeTopologyHarness, researchFilesOf } from './harness.js'

/* ------------------------------------------------------------------ *
 * Local helpers
 * ------------------------------------------------------------------ */

/** The on-disk edge rows (structural view of the parsed topology.yaml). */
interface EdgeView {
  id: string
  operation: string
  lifecycle: string
  inputs: string[]
  outputs: string[]
  note?: string
}

/** The parsed on-disk edge list (via the shared fs). */
function topologyEdgesOf(h: ReturnType<typeof makeTopologyHarness>): EdgeView[] {
  const text = h.fs.content(h.abs('topics/TPC-1/topology.yaml'))
  expect(text).not.toBeNull()
  return (parse(text!) as { topology: { edges: EdgeView[] } }).topology.edges
}

/** Run `fn`, require a `TopologyServiceError` of `code` (+ optional
 *  message substring). Returns the error for extra assertions. */
function expectTopoCode(fn: () => unknown, code: string, msgPart?: string): TopologyServiceError {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(TopologyServiceError)
    const err = e as TopologyServiceError
    expect(err.code).toBe(code)
    if (msgPart !== undefined) expect(err.message).toContain(msgPart)
    return err
  }
  throw new Error(`expected TopologyServiceError(${code}), nothing thrown`)
}

/* ------------------------------------------------------------------ *
 * Legal forks
 * ------------------------------------------------------------------ */

describe('createWorkstreamFork — legal', () => {
  it('single child → 1:1 FORK edge, file-derived ids, origin ref + edge note on disk, one TOPOLOGY_EDITED row', () => {
    const h = makeTopologyHarness()

    const res = h.service.createWorkstreamFork({
      topicId: 'TPC-1',
      parentWorkstreamId: 'WS-1',
      children: [{ title: '独立标定支线', note: 'D1 测试分支' }],
    })

    // The frozen wire shape (BRIEF §3 contract 1).
    expect(res).toEqual({
      topicId: 'TPC-1',
      edgeIds: ['TE-3'],
      workstreamIds: ['WS-4'],
      managementActionId: res.managementActionId,
    })
    expect(res.managementActionId).toMatch(/^MA-[1-9][0-9]*$/)

    // The child WS on disk: id/topic/title + the ADJ-4 origin ref; the
    // child `note` does NOT land on the WS (it rides the edge).
    const wsYaml = parse(h.fs.content(h.abs('topics/TPC-1/workstreams/WS-4/workstream.yaml'))!)
    expect(wsYaml).toMatchObject({
      id: 'WS-4',
      topic_id: 'TPC-1',
      title: '独立标定支线',
      origin_topology_edge_ref: 'TE-3',
    })
    expect(wsYaml.note).toBeUndefined()
    expect(wsYaml.summary).toBeUndefined()

    // The 1:1 FORK edge on disk (explicit id, PLANNED, parent→child).
    const edges = topologyEdgesOf(h)
    expect(edges).toHaveLength(3)
    expect(edges.find((e) => e.id === 'TE-3')).toMatchObject({
      operation: 'FORK',
      lifecycle: 'PLANNED',
      inputs: ['WS-1'],
      outputs: ['WS-4'],
      note: 'D1 测试分支',
    })

    // Independent full-tree re-validation over the live files: clean,
    // the child WS is a node of TPC-1, the edge is its origin.
    const fresh = load(researchFilesOf(h.fs))
    expect(fresh.errors).toEqual([])
    const tpc = fresh.tree.topics.find((t) => t.id === 'TPC-1')!
    expect(tpc.workstreams.map((w) => w.id)).toEqual(['WS-1', 'WS-2', 'WS-3', 'WS-4'])
    expect(tpc.topology?.topology.edges.map((e) => e.id)).toEqual(['TE-1', 'TE-2', 'TE-3'])

    // The TOPOLOGY_EDITED ledger row: reserved id, USER actor, the edge
    // subject ref, the mechanical detail; reserve→commit lifecycle.
    expect(h.db.calls).toHaveLength(1)
    const call = h.db.calls[0]!
    expect(call.sql).toBe(SQL_INSERT_MANAGEMENT_ACTION)
    const [id, kind, actor, subjects, , , detail, occurredAt] = call.params as unknown[]
    expect(id).toBe(res.managementActionId)
    expect(kind).toBe('TOPOLOGY_EDITED')
    expect(actor).toBe(JSON.stringify({ kind: 'USER' }))
    expect(subjects).toBe(JSON.stringify([{ kind: 'TOPOLOGY_EDGE', id: 'TE-3' }]))
    expect(detail).toContain('FORK WS-1')
    expect(occurredAt).toBeGreaterThan(0)
    expect(h.allocatorEvents.map((e) => e.op)).toEqual(['reserve', 'commit'])
  })

  it('two children → sequential project-wide ids, 1:1 pairing in order, ONE ledger row with both edge refs', () => {
    const h = makeTopologyHarness()

    const res = h.service.createWorkstreamFork({
      topicId: 'TPC-1',
      parentWorkstreamId: 'WS-1',
      children: [
        { title: '支线 A' },
        { title: '支线 B', note: '第二条' },
      ],
    })

    expect(res.topicId).toBe('TPC-1')
    expect(res.workstreamIds).toEqual(['WS-4', 'WS-5'])
    expect(res.edgeIds).toEqual(['TE-3', 'TE-4'])

    const edges = topologyEdgesOf(h)
    expect(edges.find((e) => e.id === 'TE-3')).toMatchObject({
      operation: 'FORK',
      inputs: ['WS-1'],
      outputs: ['WS-4'],
    })
    expect(edges.find((e) => e.id === 'TE-4')).toMatchObject({
      operation: 'FORK',
      inputs: ['WS-1'],
      outputs: ['WS-5'],
      note: '第二条',
    })

    // Each child carries ITS OWN edge as origin (ADJ-4, 1:1 — not a
    // shared fan-out ref).
    for (const [wsId, teId] of [
      ['WS-4', 'TE-3'],
      ['WS-5', 'TE-4'],
    ] as const) {
      const wsYaml = parse(h.fs.content(h.abs(`topics/TPC-1/workstreams/${wsId}/workstream.yaml`))!)
      expect(wsYaml.origin_topology_edge_ref).toBe(teId)
    }

    // One ledger row for the whole fork; both edges are subjects.
    expect(h.db.calls).toHaveLength(1)
    const [, , , subjects] = h.db.calls[0]!.params as unknown[]
    expect(subjects).toBe(
      JSON.stringify([
        { kind: 'TOPOLOGY_EDGE', id: 'TE-3' },
        { kind: 'TOPOLOGY_EDGE', id: 'TE-4' },
      ]),
    )
    expect(h.allocatorEvents.map((e) => e.op)).toEqual(['reserve', 'commit'])

    // Full-tree re-validation: clean.
    expect(load(researchFilesOf(h.fs)).errors).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * Gate negatives (no write, no ledger)
 * ------------------------------------------------------------------ */

describe('createWorkstreamFork — gate negatives', () => {
  it('nonexistent topic → TOPO_TOPIC_NOT_FOUND', () => {
    const h = makeTopologyHarness()
    expectTopoCode(
      () =>
        h.service.createWorkstreamFork({
          topicId: 'TPC-9',
          parentWorkstreamId: 'WS-1',
          children: [{ title: 'X' }],
        }),
      'TOPO_TOPIC_NOT_FOUND',
    )
    expect(h.fs.writes).toEqual([])
    expect(h.db.calls).toEqual([])
  })

  it('parent WS not in the topic → TOPO_WORKSTREAM_NOT_FOUND', () => {
    const h = makeTopologyHarness()
    expectTopoCode(
      () =>
        h.service.createWorkstreamFork({
          topicId: 'TPC-1',
          parentWorkstreamId: 'WS-99',
          children: [{ title: 'X' }],
        }),
      'TOPO_WORKSTREAM_NOT_FOUND',
    )
    expect(h.fs.writes).toEqual([])
    expect(h.db.calls).toEqual([])
  })

  it('parent WS belonging to ANOTHER topic → TOPO_WORKSTREAM_NOT_FOUND (cross-topic is not membership)', () => {
    const TPC2 = `id: TPC-2
project_id: PRJ-1
title: 跨主题
objective_refs: [OBJ-1]
created_at: 2026-08-21T09:15:00Z
`
    const WS4_IN_TPC2 = `id: WS-4
topic_id: TPC-2
title: 另一主题的工作流
created_at: 2026-08-21T09:16:00Z
`
    const h = makeTopologyHarness(
      mutate(baseTreeFiles(), {
        'topics/TPC-2/topic.yaml': TPC2,
        'topics/TPC-2/workstreams/WS-4/workstream.yaml': WS4_IN_TPC2,
      }),
    )
    // Sanity: the two-topic base loads clean (the fixture is valid).
    expect(load(researchFilesOf(h.fs)).errors).toEqual([])
    expectTopoCode(
      () =>
        h.service.createWorkstreamFork({
          topicId: 'TPC-1',
          parentWorkstreamId: 'WS-4',
          children: [{ title: 'X' }],
        }),
      'TOPO_WORKSTREAM_NOT_FOUND',
    )
    expect(h.fs.writes).toEqual([])
    expect(h.db.calls).toEqual([])
  })

  it('child title > 200 chars → TOPO_INPUT (frozen workstream.schema.json title bound)', () => {
    const h = makeTopologyHarness()
    expectTopoCode(
      () =>
        h.service.createWorkstreamFork({
          topicId: 'TPC-1',
          parentWorkstreamId: 'WS-1',
          children: [{ title: 'x'.repeat(201) }],
        }),
      'TOPO_INPUT',
    )
    expect(h.fs.writes).toEqual([])
    expect(h.db.calls).toEqual([])
  })

  it('WS id collision (TOCTOU: stale load, live probe) → TOPO_WORKSTREAM_EXISTS, nothing written', () => {
    const h = makeTopologyHarness()
    // The concurrent creator: the candidate file (WS-4 = stale max+1)
    // exists on the live fs while the loader snapshot lags.
    h.fs.addFile(
      h.abs('topics/TPC-1/workstreams/WS-4/workstream.yaml'),
      'id: WS-4\ntopic_id: TPC-1\ntitle: 并发创建者\ncreated_at: 2026-08-21T09:00:00Z\n',
    )
    h.setReader(makeReader(baseTreeFiles()))
    expectTopoCode(
      () =>
        h.service.createWorkstreamFork({
          topicId: 'TPC-1',
          parentWorkstreamId: 'WS-1',
          children: [{ title: 'X' }],
        }),
      'TOPO_WORKSTREAM_EXISTS',
    )
    expect(h.fs.writes).toEqual([])
    expect(h.db.calls).toEqual([])
  })

  it('broken pre-load tree → TOPO_TREE_BROKEN (fail-loud before any mutation)', () => {
    const h = makeTopologyHarness()
    h.setReader(
      makeReader(
        mutate(baseTreeFiles(), {
          'topics/TPC-1/workstreams/WS-9/workstream.yaml':
            'id: WS-9\ntopic_id: TPC-1\ntitle: 悬空\norigin_topology_edge_ref: TE-9\ncreated_at: 2026-08-21T09:00:00Z\n',
        }),
      ),
    )
    expectTopoCode(
      () =>
        h.service.createWorkstreamFork({
          topicId: 'TPC-1',
          parentWorkstreamId: 'WS-1',
          children: [{ title: 'X' }],
        }),
      'TOPO_TREE_BROKEN',
    )
    expect(h.fs.writes).toEqual([])
    expect(h.db.calls).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * Inverse compensation (ADJ-2)
 * ------------------------------------------------------------------ */

describe('createWorkstreamFork — inverse compensation', () => {
  it('child-2 WS write fails → clean rollback of child 1, NO residue, loud TOPO_WRITE', () => {
    const h = makeTopologyHarness()
    // Write sequence: #1 ws-4 yaml, #2 topology tmp (TE-3), #3 ws-5 yaml
    // ← fails here (the atomic write never lands).
    h.fs.failWriteAt(3)

    expectTopoCode(
      () =>
        h.service.createWorkstreamFork({
          topicId: 'TPC-1',
          parentWorkstreamId: 'WS-1',
          children: [{ title: 'A' }, { title: 'B' }],
        }),
      'TOPO_WRITE',
    )

    // No residue: child 1 fully rolled back (WS dir gone, edge deleted),
    // child 2 never written. The topology doc is back to the base edges.
    expect(h.fs.hasFile(h.abs('topics/TPC-1/workstreams/WS-4/workstream.yaml'))).toBe(false)
    expect(h.fs.hasFile(h.abs('topics/TPC-1/workstreams/WS-5/workstream.yaml'))).toBe(false)
    expect(topologyEdgesOf(h).map((e) => e.id)).toEqual(['TE-1', 'TE-2'])
    // The tree is loadable again (the compensation restored consistency).
    expect(load(researchFilesOf(h.fs)).errors).toEqual([])
    // No ledger row (the mutation never completed), no id spent.
    expect(h.db.calls).toEqual([])
    expect(h.allocatorEvents).toEqual([])
  })

  it('addEdge save fails after the child WS write → dangling ref ⇒ RESIDUE, loud TOPO_COMPLETION listing residual ids', () => {
    const h = makeTopologyHarness()
    // Write sequence: #1 ws-4 yaml, #2 topology tmp (TE-3) ✓, #3 ws-5
    // yaml ✓ (now dangling: TE-4 is NOT written yet), #4 topology tmp
    // ← fails. The child-2 pair is torn: WS on disk, edge never landed.
    h.fs.failWriteAt(4)

    const err = expectTopoCode(
      () =>
        h.service.createWorkstreamFork({
          topicId: 'TPC-1',
          parentWorkstreamId: 'WS-1',
          children: [{ title: 'A' }, { title: 'B' }],
        }),
      'TOPO_COMPLETION',
      'RESIDUE',
    )

    // The residue is listed (manual reconciliation): the dangling child
    // WS CANNOT be dropped (its own origin ref poisons every load), and
    // the never-written edge is reported too; child 1's WS is residue as
    // well (its drop is poisoned by child 2's dangling ref) while its
    // edge WAS deleted.
    expect(err.residuals).toEqual(['WS-5', 'WS-4'])
    expect(err.message).toContain('manual reconciliation')
    expect(err.message).toContain('WS-5')
    expect(err.message).toContain('WS-4')
    expect(h.fs.hasFile(h.abs('topics/TPC-1/workstreams/WS-5/workstream.yaml'))).toBe(true)
    expect(h.fs.hasFile(h.abs('topics/TPC-1/workstreams/WS-4/workstream.yaml'))).toBe(true)
    expect(topologyEdgesOf(h).map((e) => e.id)).toEqual(['TE-1', 'TE-2'])
    expect(h.db.calls).toEqual([])
    expect(h.allocatorEvents).toEqual([])
  })

  it('post-mutation re-validation rejects the written tree → TOPO_COMPLETION (the cross-file gate is live)', () => {
    const h = makeTopologyHarness()
    // Seam: the re-validation load (call #3 — #1 pre, #2 child create)
    // reads a FROZEN record where the child WS landed but its edge did
    // not (the DANGLING_REF the live loader would catch on a real torn
    // write). Pre-loads stay live.
    h.onLoad((n) => {
      if (n === 3) {
        h.setReader(
          makeReader(
            mutate(baseTreeFiles(), {
              'topics/TPC-1/workstreams/WS-4/workstream.yaml':
                'id: WS-4\ntopic_id: TPC-1\ntitle: 悬空\norigin_topology_edge_ref: TE-3\ncreated_at: 2026-08-21T09:00:00Z\n',
            }),
          ),
        )
      }
    })

    const err = expectTopoCode(
      () =>
        h.service.createWorkstreamFork({
          topicId: 'TPC-1',
          parentWorkstreamId: 'WS-1',
          children: [{ title: 'X' }],
        }),
      'TOPO_COMPLETION',
      'RESIDUE',
    )

    // The original (re-validation) error rides the cause chain.
    expect(err.cause).toBeInstanceOf(TopologyServiceError)
    expect((err.cause as TopologyServiceError).code).toBe('TOPO_COMPLETION')
    expect((err.cause as TopologyServiceError).message).toContain('re-validation')

    // Compensation ran: the edge (live io) was deleted; the child WS
    // could not be dropped (the frozen reader keeps DANGLING on every
    // load) ⇒ listed as residue.
    expect(err.residuals).toEqual(['WS-4'])
    expect(topologyEdgesOf(h).map((e) => e.id)).toEqual(['TE-1', 'TE-2'])
    expect(h.fs.hasFile(h.abs('topics/TPC-1/workstreams/WS-4/workstream.yaml'))).toBe(true)
    expect(h.db.calls).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * Ledger failure (NOT compensated — the files stand)
 * ------------------------------------------------------------------ */

describe('createWorkstreamFork — ledger failure', () => {
  it('ledger INSERT fails → files stand, loud provenance-gap error, id released (no commit)', () => {
    const h = makeTopologyHarness()
    h.db.failNext = true

    let caught: unknown
    try {
      h.service.createWorkstreamFork({
        topicId: 'TPC-1',
        parentWorkstreamId: 'WS-1',
        children: [{ title: 'X' }],
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught).not.toBeInstanceOf(TopologyServiceError)
    expect((caught as Error).message).toContain('provenance row is missing')
    expect((caught as Error).message).toContain('manual reconciliation')
    expect((caught as Error).message).toContain('TOPOLOGY_EDITED')

    // The mutation itself SUCCEEDED on disk — the files stand.
    expect(h.fs.hasFile(h.abs('topics/TPC-1/workstreams/WS-4/workstream.yaml'))).toBe(true)
    expect(topologyEdgesOf(h).map((e) => e.id)).toEqual(['TE-1', 'TE-2', 'TE-3'])
    // The failed INSERT was attempted once; the id was released.
    expect(h.db.calls).toHaveLength(1)
    expect(h.allocatorEvents.map((e) => e.op)).toEqual(['reserve', 'release'])
  })
})

/* ------------------------------------------------------------------ *
 * UI-6 D2 — createPlannedMerge (BRIEF §3 contract 2 / §5 matrix)
 * ------------------------------------------------------------------ */

describe('createPlannedMerge — happy path', () => {
  it('non-colliding pair [WS-1, WS-3] → WS-2 ⇒ TE-3, edge on disk, TOPOLOGY_EDITED row, NO new workstream', () => {
    const h = makeTopologyHarness()
    const res = h.service.createPlannedMerge({
      topicId: 'TPC-1',
      inputWorkstreamIds: ['WS-1', 'WS-3'],
      outputWorkstreamId: 'WS-2',
    })

    // The frozen result shape (BRIEF §3 contract 2).
    expect(res).toEqual({
      edgeId: 'TE-3',
      topicId: 'TPC-1',
      inputs: ['WS-1', 'WS-3'],
      outputWorkstreamId: 'WS-2',
      lifecycle: 'PLANNED',
      managementActionId: expect.any(String),
    })
    expect(res.managementActionId).toMatch(/^MA-[1-9][0-9]*$/)

    // The PLANNED MERGE edge on disk (explicit file-derived id —
    // project-wide max+1 over the base TE-2).
    const edges = topologyEdgesOf(h)
    expect(edges).toHaveLength(3)
    expect(edges.find((e) => e.id === 'TE-3')).toMatchObject({
      operation: 'MERGE',
      lifecycle: 'PLANNED',
      inputs: ['WS-1', 'WS-3'],
      outputs: ['WS-2'],
    })
    expect(edges.find((e) => e.id === 'TE-3')?.note).toBeUndefined()

    // Existing-output-first: NO new workstream was created (the output
    // WS-2 pre-existed; no child directories may appear).
    expect(h.fs.hasFile(h.abs('topics/TPC-1/workstreams/WS-4/workstream.yaml'))).toBe(false)

    // Full-tree re-validation: clean.
    expect(load(researchFilesOf(h.fs)).errors).toEqual([])

    // The TOPOLOGY_EDITED ledger row (same caliber as the fork).
    expect(h.db.calls).toHaveLength(1)
    const call = h.db.calls[0]!
    expect(call.sql).toBe(SQL_INSERT_MANAGEMENT_ACTION)
    const [id, kind, actor, subjects, , , detail, occurredAt] = call.params as unknown[]
    expect(id).toBe(res.managementActionId)
    expect(kind).toBe('TOPOLOGY_EDITED')
    expect(actor).toBe(JSON.stringify({ kind: 'USER' }))
    expect(subjects).toBe(JSON.stringify([{ kind: 'TOPOLOGY_EDGE', id: 'TE-3' }]))
    expect(detail).toContain('MERGE [WS-1, WS-3] → WS-2 via TE-3')
    expect(occurredAt).toBeGreaterThan(0)
    expect(h.allocatorEvents.map((e) => e.op)).toEqual(['reserve', 'commit'])
  })

  it('dedup collapses repeated inputs (first-occurrence order) and the note lands on the edge', () => {
    const h = makeTopologyHarness()
    const res = h.service.createPlannedMerge({
      topicId: 'TPC-1',
      inputWorkstreamIds: ['WS-1', 'WS-1', 'WS-3'],
      outputWorkstreamId: 'WS-2',
      note: 'D2 测试合并',
    })

    // Dedup is order-preserving (wire carries .min(2) only — zod 4.4.3
    // has no .unique(); the service is the dedup authority).
    expect(res.inputs).toEqual(['WS-1', 'WS-3'])
    const edge = topologyEdgesOf(h).find((e) => e.id === res.edgeId)!
    expect(edge.inputs).toEqual(['WS-1', 'WS-3'])
    expect(edge.note).toBe('D2 测试合并')
  })
})

describe('createPlannedMerge — gate negatives (no write, no ledger)', () => {
  it('nonexistent topic → TOPO_TOPIC_NOT_FOUND', () => {
    const h = makeTopologyHarness()
    expectTopoCode(
      () =>
        h.service.createPlannedMerge({
          topicId: 'TPC-9',
          inputWorkstreamIds: ['WS-1', 'WS-2'],
          outputWorkstreamId: 'WS-3',
        }),
      'TOPO_TOPIC_NOT_FOUND',
    )
    expect(h.fs.writes).toEqual([])
    expect(h.db.calls).toEqual([])
  })

  it('input WS not in the topic → TOPO_WORKSTREAM_NOT_FOUND', () => {
    const h = makeTopologyHarness()
    expectTopoCode(
      () =>
        h.service.createPlannedMerge({
          topicId: 'TPC-1',
          inputWorkstreamIds: ['WS-1', 'WS-99'],
          outputWorkstreamId: 'WS-2',
        }),
      'TOPO_WORKSTREAM_NOT_FOUND',
    )
    expect(h.fs.writes).toEqual([])
    expect(h.db.calls).toEqual([])
  })

  it('missing output → TOPO_WORKSTREAM_NOT_FOUND with the two-step UI guidance', () => {
    const h = makeTopologyHarness()
    expectTopoCode(
      () =>
        h.service.createPlannedMerge({
          topicId: 'TPC-1',
          inputWorkstreamIds: ['WS-1', 'WS-2'],
          outputWorkstreamId: 'WS-99',
        }),
      'TOPO_WORKSTREAM_NOT_FOUND',
      'create it first',
    )
    expect(h.fs.writes).toEqual([])
    expect(h.db.calls).toEqual([])
  })

  it('dedup collapse below 2 distinct → TOPO_INPUT', () => {
    const h = makeTopologyHarness()
    expectTopoCode(
      () =>
        h.service.createPlannedMerge({
          topicId: 'TPC-1',
          inputWorkstreamIds: ['WS-1', 'WS-1'],
          outputWorkstreamId: 'WS-3',
        }),
      'TOPO_INPUT',
    )
    expect(h.fs.writes).toEqual([])
    expect(h.db.calls).toEqual([])
  })

  it('duplicate LIVE pair [WS-1, WS-2] → WS-3 (collides with TE-2) → TOPO_DUPLICATE_EDGE', () => {
    const h = makeTopologyHarness()
    expectTopoCode(
      () =>
        h.service.createPlannedMerge({
          topicId: 'TPC-1',
          inputWorkstreamIds: ['WS-2', 'WS-1'],
          outputWorkstreamId: 'WS-3',
        }),
      'TOPO_DUPLICATE_EDGE',
      'TE-2',
    )
    expect(h.fs.writes).toEqual([])
    expect(h.db.calls).toEqual([])
  })

  it('output ∈ inputs is NOT a service gate (the UI dialog owns that validation — deviation #7)', () => {
    // The kernel store is permissive about self-referential pairs and
    // the service pair gate only rejects exact duplicate pairs: the
    // product decision to gate self-loops lives in the UI dialog
    // (RECON view row), NOT here — a service-level gate would be an
    // undisclosed semantic change (BRIEF §7 零静默语义变更).
    const h = makeTopologyHarness()
    const res = h.service.createPlannedMerge({
      topicId: 'TPC-1',
      inputWorkstreamIds: ['WS-1', 'WS-2'],
      outputWorkstreamId: 'WS-1',
    })
    expect(res.edgeId).toBe('TE-3')
    expect(topologyEdgesOf(h).find((e) => e.id === 'TE-3')).toMatchObject({
      operation: 'MERGE',
      inputs: ['WS-1', 'WS-2'],
      outputs: ['WS-1'],
    })
  })
})

describe('createPlannedMerge — DROPPED pair re-mergeable', () => {
  it('a DROPPED edge frees its (input-set, output) pair — the same merge now succeeds', () => {
    // Base tree with TE-2 flipped to DROPPED (the drop face's
    // steady state): the pair gate skips non-live edges.
    const droppedTe2 = TOPOLOGY_YAML.replace(
      'operation: MERGE\n      lifecycle: PLANNED',
      'operation: MERGE\n      lifecycle: DROPPED',
    )
    const h = makeTopologyHarness(mutate(baseTreeFiles(), { 'topics/TPC-1/topology.yaml': droppedTe2 }))
    const res = h.service.createPlannedMerge({
      topicId: 'TPC-1',
      inputWorkstreamIds: ['WS-1', 'WS-2'],
      outputWorkstreamId: 'WS-3',
    })
    expect(res.edgeId).toBe('TE-3')
    expect(topologyEdgesOf(h).find((e) => e.id === 'TE-3')).toMatchObject({
      operation: 'MERGE',
      lifecycle: 'PLANNED',
      inputs: ['WS-1', 'WS-2'],
      outputs: ['WS-3'],
    })
    // The DROPPED TE-2 row is untouched (the drop is not reversed by
    // the re-merge — DROPPED is terminal).
    expect(topologyEdgesOf(h).find((e) => e.id === 'TE-2')?.lifecycle).toBe('DROPPED')
  })
})

/* ------------------------------------------------------------------ *
 * UI-6 D2 — getMergeContract (BRIEF §3 contract 4)
 * ------------------------------------------------------------------ */

describe('getMergeContract — read face', () => {
  it('TE-2 (contract file exists) → the raw content + the root-relative path', () => {
    const h = makeTopologyHarness()
    const res = h.service.getMergeContract({ edgeId: 'TE-2' })
    expect(res).toEqual({
      edgeId: 'TE-2',
      content: CONTRACT_MD,
      path: 'merges/TE-2/contract.md',
    })
    // A read writes nothing — no ledger row (BRIEF §3: no ledger).
    expect(h.db.calls).toEqual([])
  })

  it('TE-1 (no contract file) → content NULL (the value face, not an error)', () => {
    const h = makeTopologyHarness()
    const res = h.service.getMergeContract({ edgeId: 'TE-1' })
    expect(res).toEqual({
      edgeId: 'TE-1',
      content: null,
      path: 'merges/TE-1/contract.md',
    })
    expect(h.db.calls).toEqual([])
  })

  it('unknown edge TE-99 → content null (NO edge-existence gate — CONTRACT_NOT_FOUND folds; deviation #3)', () => {
    // The read face carries no TE snapshot gate (unlike the write
    // face): a file that does not exist is a missing contract,
    // whatever the edge's status.
    const h = makeTopologyHarness()
    const res = h.service.getMergeContract({ edgeId: 'TE-99' })
    expect(res.content).toBeNull()
    expect(res.path).toBe('merges/TE-99/contract.md')
    expect(h.db.calls).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * UI-6 D2 — saveMergeContract (BRIEF §3 contract 5)
 * ------------------------------------------------------------------ */

describe('saveMergeContract — write face', () => {
  it('TE-2 overwrite → byte-for-byte file + CONTRACT_EDITED ledger row', () => {
    const h = makeTopologyHarness()
    const next = '# Merge Contract TE-2 (D2 修订)\n\n- 接口: 修订后\n'
    const res = h.service.saveMergeContract({ edgeId: 'TE-2', content: next })

    expect(res).toEqual({
      edgeId: 'TE-2',
      path: 'merges/TE-2/contract.md',
      managementActionId: expect.any(String),
    })
    // Full replacement, byte-for-byte (no parsing, no front-matter —
    // ADJ-7): the previous CONTRACT_MD is gone.
    expect(h.fs.content(h.abs('merges/TE-2/contract.md'))).toBe(next)

    // The CONTRACT_EDITED ledger row (the second production writer of
    // the 15-kind enum — ADJ-10).
    expect(h.db.calls).toHaveLength(1)
    const call = h.db.calls[0]!
    expect(call.sql).toBe(SQL_INSERT_MANAGEMENT_ACTION)
    const [id, kind, actor, subjects, , , detail, occurredAt] = call.params as unknown[]
    expect(id).toBe(res.managementActionId)
    expect(kind).toBe('CONTRACT_EDITED')
    expect(actor).toBe(JSON.stringify({ kind: 'USER' }))
    expect(subjects).toBe(JSON.stringify([{ kind: 'TOPOLOGY_EDGE', id: 'TE-2' }]))
    expect(detail).toContain('merge contract')
    expect(detail).toContain('merges/TE-2/contract.md')
    expect(occurredAt).toBeGreaterThan(0)
    expect(h.allocatorEvents.map((e) => e.op)).toEqual(['reserve', 'commit'])
  })

  it('TE-1 (no contract yet) → the file is created, same CONTRACT_EDITED row', () => {
    const h = makeTopologyHarness()
    expect(h.fs.hasFile(h.abs('merges/TE-1/contract.md'))).toBe(false)
    const res = h.service.saveMergeContract({ edgeId: 'TE-1', content: '首版契约\n' })
    expect(res.path).toBe('merges/TE-1/contract.md')
    expect(h.fs.content(h.abs('merges/TE-1/contract.md'))).toBe('首版契约\n')
    const [, kind] = h.db.calls[0]!.params as unknown[]
    expect(kind).toBe('CONTRACT_EDITED')
  })

  it('unknown edge TE-99 → TOPO_CONTRACT_TE_UNKNOWN pre-gate (no write)', () => {
    const h = makeTopologyHarness()
    expectTopoCode(
      () => h.service.saveMergeContract({ edgeId: 'TE-99', content: 'x' }),
      'TOPO_CONTRACT_TE_UNKNOWN',
    )
    expect(h.fs.writes).toEqual([])
    expect(h.db.calls).toEqual([])
  })

  it('empty content → TOPO_INPUT (the wire also enforces .min(1))', () => {
    const h = makeTopologyHarness()
    expectTopoCode(
      () => h.service.saveMergeContract({ edgeId: 'TE-2', content: '' }),
      'TOPO_INPUT',
    )
    expect(h.fs.writes).toEqual([])
    expect(h.db.calls).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * UI-6 D3 — dropTopologyEdge (BRIEF §3 contract 3)
 * ------------------------------------------------------------------ */

describe('dropTopologyEdge — legal drops (the state machine is the sole authority)', () => {
  it('PLANNED → DROPPED (TE-1) → DROPPED on disk + TOPOLOGY_EDITED row carrying the from-state', () => {
    const h = makeTopologyHarness()
    const res = h.service.dropTopologyEdge({ edgeId: 'TE-1' })
    expect(res).toEqual({
      edgeId: 'TE-1',
      topicId: 'TPC-1',
      lifecycle: 'DROPPED',
      managementActionId: expect.any(String),
    })
    // On disk: TE-1 flipped, the sibling edge untouched (the drop is
    // surgical — the kernel store rewrites only this topic's doc).
    expect(topologyEdgesOf(h).find((e) => e.id === 'TE-1')?.lifecycle).toBe('DROPPED')
    expect(topologyEdgesOf(h).find((e) => e.id === 'TE-2')?.lifecycle).toBe('PLANNED')
    // Exactly one write: the atomic tmp for the owning topic's
    // topology.yaml (the rename-away is the writer's final step).
    expect(h.fs.writes.map((w) => [w.path, w.ok])).toEqual([
      [`${h.abs('topics/TPC-1/topology.yaml')}.dshrc-tmp`, true],
    ])
    // The TOPOLOGY_EDITED ledger row — detail carries the from-state
    // (ADJ-10; the 15-kind enum is zero-diff, drop is a first writer
    // path for this face).
    expect(h.db.calls).toHaveLength(1)
    const call = h.db.calls[0]!
    expect(call.sql).toBe(SQL_INSERT_MANAGEMENT_ACTION)
    const [id, kind, actor, subjects, , , detail, occurredAt] = call.params as unknown[]
    expect(id).toBe(res.managementActionId)
    expect(kind).toBe('TOPOLOGY_EDITED')
    expect(actor).toBe(JSON.stringify({ kind: 'USER' }))
    expect(subjects).toBe(JSON.stringify([{ kind: 'TOPOLOGY_EDGE', id: 'TE-1' }]))
    expect(detail).toBe('topic TPC-1: edge TE-1 dropped (from PLANNED)')
    expect(occurredAt).toBeGreaterThan(0)
    expect(h.allocatorEvents.map((e) => e.op)).toEqual(['reserve', 'commit'])
  })

  it('REALIZED → DROPPED — §13 legal set, detail carries REALIZED (the service does not re-gate the UI-PLANNED-only entry — ADJ-5)', () => {
    // The kernel table gives PLANNED and REALIZED the same legal target
    // set ([DROPPED]); the UI limits its entry to PLANNED edges, but
    // the service must not re-gate — re-gating would be an undisclosed
    // semantic change (BRIEF §7). The anchor targets TE-1 (FORK)
    // specifically; TE-2 stays PLANNED. The store invariant
    // (checkEdgeInvariants, stricter than the JSON schema) requires a
    // realized_event_id on any REALIZED edge — the fixture carries H-1.
    const h = makeTopologyHarness(
      mutate(baseTreeFiles(), {
        'topics/TPC-1/topology.yaml': TOPOLOGY_YAML.replace(
          'operation: FORK\n      lifecycle: PLANNED',
          'operation: FORK\n      lifecycle: REALIZED\n      realized_event_id: H-1',
        ),
      }),
    )
    expect(topologyEdgesOf(h).find((e) => e.id === 'TE-1')?.lifecycle).toBe('REALIZED')
    const res = h.service.dropTopologyEdge({ edgeId: 'TE-1' })
    expect(res).toEqual({
      edgeId: 'TE-1',
      topicId: 'TPC-1',
      lifecycle: 'DROPPED',
      managementActionId: expect.any(String),
    })
    expect(topologyEdgesOf(h).find((e) => e.id === 'TE-1')?.lifecycle).toBe('DROPPED')
    const [, , , , , , detail] = (h.db.calls[0]!.params as unknown[])
    expect(detail).toBe('topic TPC-1: edge TE-1 dropped (from REALIZED)')
  })
})

describe('dropTopologyEdge — state-machine + lookup negatives (no write, no ledger)', () => {
  it('DROPPED → DROPPED (TE-1 pre-DROPPED) → TOPO_INVALID_TRANSITION (DROPPED is terminal)', () => {
    // The §13 legal set for DROPPED is empty — the re-drop rides back
    // as the kernel's INVALID_TRANSITION carrier (message names the
    // current state, the target, and the terminal note).
    const h = makeTopologyHarness(
      mutate(baseTreeFiles(), {
        'topics/TPC-1/topology.yaml': TOPOLOGY_YAML.replace(
          'operation: FORK\n      lifecycle: PLANNED',
          'operation: FORK\n      lifecycle: DROPPED',
        ),
      }),
    )
    expect(
      expectTopoCode(
        () => h.service.dropTopologyEdge({ edgeId: 'TE-1' }),
        'TOPO_INVALID_TRANSITION',
        'DROPPED is terminal',
      ).message,
    ).toContain('DROPPED -> DROPPED')
    // The transition guard fires BEFORE any persistence: no file
    // write, no ledger row.
    expect(h.fs.writes).toEqual([])
    expect(h.db.calls).toEqual([])
    // The doc on disk is untouched.
    expect(topologyEdgesOf(h).find((e) => e.id === 'TE-1')?.lifecycle).toBe('DROPPED')
  })

  it('unknown edge TE-99 → TOPO_EDGE_NOT_FOUND (no silent no-op)', () => {
    const h = makeTopologyHarness()
    expectTopoCode(
      () => h.service.dropTopologyEdge({ edgeId: 'TE-99' }),
      'TOPO_EDGE_NOT_FOUND',
      'dropTopologyEdge: edge TE-99 does not exist in the loaded tree',
    )
    expect(h.fs.writes).toEqual([])
    expect(h.db.calls).toEqual([])
  })
})
