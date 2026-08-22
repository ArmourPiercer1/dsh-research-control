/**
 * WP-1.4 — TopologyStore CRUD: topology.yaml load/save round-trip, edge
 * add/update/delete/get, and the write-path invariants (ws existence
 * INV-STRUCT-2, TE id uniqueness, §3.1 path rules, realized_event_id).
 */
import { parse as yamlParse } from 'yaml'

import { describe, expect, it } from 'vitest'

import { counterKey, IdAllocator } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import { baseTreeFiles, load } from '../loader/fixtures.js'
import type { TopologyDoc } from '../../src/host/domain/loader/index.js'
import type { EdgePatch } from '../../src/host/domain/topology/index.js'
import {
  BASE_EDGES,
  expectStoreError,
  makeIo,
  makeStore,
  parseTopologyFile,
  TOPOLOGY_PATH,
  TOPOLOGY_REL,
} from './fixtures.js'

const TMP = TOPOLOGY_PATH + '.dshrc-tmp'

describe('TopologyStore.load', () => {
  it('loads the base tree topology verbatim (2 edges, §3.1 fields)', () => {
    const store = makeStore()
    const doc = store.load()
    expect(doc.topology.topic_id).toBe('TPC-1')
    expect(doc.topology.edges).toHaveLength(2)
    expect(doc.topology.edges[0]).toEqual({
      id: 'TE-1',
      topic_id: 'TPC-1',
      operation: 'FORK',
      lifecycle: 'PLANNED',
      inputs: ['WS-1'],
      outputs: ['WS-2'],
      note: '分支出独立标定管线',
    })
    expect(doc.topology.edges[1]).toEqual({
      id: 'TE-2',
      topic_id: 'TPC-1',
      operation: 'MERGE',
      lifecycle: 'PLANNED',
      inputs: ['WS-1', 'WS-2'],
      outputs: ['WS-3'],
    })
    expect(store.edges().map((e) => e.id)).toEqual(['TE-1', 'TE-2'])
  })

  it('a missing topology.yaml is a normal state: empty document (topic_id kept, edges [])', () => {
    const io = makeIo()
    io.removeFile(TOPOLOGY_PATH)
    const store = makeStore(io)
    expect(store.load()).toEqual({ topology: { topic_id: 'TPC-1', edges: [] } })
  })

  it('works for another topic directory with no file (topic-scoped paths)', () => {
    const io = makeIo()
    const store = makeStore(io, { topicId: 'TPC-2' })
    expect(store.topologyPath).toBe('/mem/ws/.research/topics/TPC-2/topology.yaml')
    expect(store.relPath).toBe('topics/TPC-2/topology.yaml')
    expect(store.load()).toEqual({ topology: { topic_id: 'TPC-2', edges: [] } })
  })

  it('rejects a non-well-formed topicId / workstream registry / allocator config at construction', () => {
    const io = makeIo()
    expect(() => makeStore(io, { topicId: 'TPC-x' })).toThrowError(/not a well-formed topic id/)
    expect(() => makeStore(io, { workstreams: ['ws-1'] })).toThrowError(/not a well-formed WS id/)
    expect(() => makeStore(io, { allocator: new IdAllocator(new InMemoryMetaStore()) })).toThrowError(/well-formed projectId/)
  })

  it('rejects a schema-invalid file (frozen topology.schema.json) with pointer + summary', () => {
    const io = makeIo({
      [TOPOLOGY_REL]: `topology:
  topic_id: TPC-1
  edges:
    - id: TE-1
      topic_id: TPC-1
      operation: SPLICE
      lifecycle: PLANNED
      inputs: [WS-1]
      outputs: [WS-2]
`,
    })
    const err = expectStoreError(() => makeStore(io).load(), 'SCHEMA')
    expect(err.file).toBe(TOPOLOGY_REL)
    expect(err.message).toContain('/topology/edges/0/operation')
    expect(err.message).toContain('SPLICE') // the violating value is named
    expect(err.message).toContain('FORK') // the frozen enum is listed
    expect(err.message).toContain('MERGE')
  })

  it('rejects a bad-YAML file (PARSE) and an empty file (PARSE)', () => {
    const io = makeIo({ [TOPOLOGY_REL]: 'topology:\n\ttopic_id: TPC-1\n' })
    const err = expectStoreError(() => makeStore(io).load(), 'PARSE')
    expect(err.message).toMatch(/YAML/i)
    const io2 = makeIo({ [TOPOLOGY_REL]: '' })
    expectStoreError(() => makeStore(io2).load(), 'PARSE')
  })

  it('rejects a non-mapping top-level document (sequence)', () => {
    const io = makeIo({ [TOPOLOGY_REL]: '- TE-1\n- TE-2\n' })
    expectStoreError(() => makeStore(io).load(), 'SCHEMA')
  })

  it('rejects wrapper topic_id mismatch (PATH_ID_MISMATCH, §3.1 path rule)', () => {
    const io = makeIo({
      [TOPOLOGY_REL]: `topology:
  topic_id: TPC-2
  edges: []
`,
    })
    const err = expectStoreError(() => makeStore(io).load(), 'PATH_ID_MISMATCH')
    expect(err.path).toBe('/topology/topic_id')
    expect(err.message).toContain('"TPC-2"')
    expect(err.message).toContain('TPC-1')
  })

  it('rejects per-edge topic_id mismatch with the exact edge pointer', () => {
    const io = makeIo({
      [TOPOLOGY_REL]: `topology:
  topic_id: TPC-1
  edges:
    - id: TE-1
      topic_id: TPC-1
      operation: FORK
      lifecycle: PLANNED
      inputs: [WS-1]
      outputs: [WS-2]
    - id: TE-2
      topic_id: TPC-2
      operation: MERGE
      lifecycle: PLANNED
      inputs: [WS-1, WS-2]
      outputs: [WS-3]
`,
    })
    const err = expectStoreError(() => makeStore(io).load(), 'PATH_ID_MISMATCH')
    expect(err.path).toBe('/topology/edges/1/topic_id')
    expect(err.teId).toBe('TE-2')
  })

  it('rejects duplicate edge ids (DUPLICATE_EDGE_ID, §3.1 uniqueness)', () => {
    const io = makeIo({
      [TOPOLOGY_REL]: `topology:
  topic_id: TPC-1
  edges:
    - id: TE-1
      topic_id: TPC-1
      operation: FORK
      lifecycle: PLANNED
      inputs: [WS-1]
      outputs: [WS-2]
    - id: TE-1
      topic_id: TPC-1
      operation: MERGE
      lifecycle: PLANNED
      inputs: [WS-1, WS-2]
      outputs: [WS-3]
`,
    })
    const err = expectStoreError(() => makeStore(io).load(), 'DUPLICATE_EDGE_ID')
    expect(err.message).toContain('TE-1')
    expect(err.message).toContain('edges[0]')
  })

  it('rejects an edge referencing an unknown workstream (WS_NOT_FOUND, INV-STRUCT-2)', () => {
    const io = makeIo({
      [TOPOLOGY_REL]: `topology:
  topic_id: TPC-1
  edges:
    - id: TE-1
      topic_id: TPC-1
      operation: FORK
      lifecycle: PLANNED
      inputs: [WS-9]
      outputs: [WS-2]
`,
    })
    const err = expectStoreError(() => makeStore(io).load(), 'WS_NOT_FOUND')
    expect(err.message).toContain('WS-9')
    expect(err.message).toContain('TPC-1')
    expect(err.path).toBe('/inputs/0')
  })

  it('rejects a malformed workstream reference in a file (SCHEMA — the frozen idWorkstream pattern catches it)', () => {
    const io = makeIo({
      [TOPOLOGY_REL]: `topology:
  topic_id: TPC-1
  edges:
    - id: TE-1
      topic_id: TPC-1
      operation: FORK
      lifecycle: PLANNED
      inputs: [ws-1]
      outputs: [WS-2]
`,
    })
    // load validates the file against the frozen schema FIRST: 'ws-1' violates
    // the idWorkstream pattern (lowercase), so it is SCHEMA, not the domain
    // WS_NOT_FOUND (which the store applies to pattern-conforming ids)
    const err = expectStoreError(() => makeStore(io).load(), 'SCHEMA')
    expect(err.message).toContain('ws-1')
  })

  it('reports a read failure as READ', () => {
    const io = makeIo()
    io.failReadAt(TOPOLOGY_PATH)
    const err = expectStoreError(() => makeStore(io).load(), 'READ')
    expect(err.message).toContain('injected read failure')
  })

  it('reports an unavailable schema as SCHEMA_UNAVAILABLE (fail loud)', () => {
    // an io that only carries the .research files — no schema dir at all
    const io = makeIo()
    for (const p of io.filePaths()) {
      if (p.startsWith('/mem/wr/')) io.removeFile(p)
    }
    expectStoreError(() => makeStore(io).load(), 'SCHEMA_UNAVAILABLE')
  })
})

describe('TopologyStore.addEdge', () => {
  it('appends an edge with an explicit id; round-trips through reload', () => {
    const io = makeIo()
    const store = makeStore(io)
    const added = store.addEdge({
      id: 'TE-3',
      operation: 'MERGE',
      inputs: ['WS-2', 'WS-3'],
      outputs: ['WS-1'],
      note: '回合并',
    })
    expect(added).toEqual({
      id: 'TE-3',
      topic_id: 'TPC-1',
      operation: 'MERGE',
      lifecycle: 'PLANNED', // default when omitted
      inputs: ['WS-2', 'WS-3'],
      outputs: ['WS-1'],
      note: '回合并',
    })
    const reloaded = parseTopologyFile(io)
    expect(reloaded.topology.edges.map((e) => e.id)).toEqual(['TE-1', 'TE-2', 'TE-3']) // declaration order preserved
    expect(store.load().topology.edges).toEqual(reloaded.topology.edges)
    // the saved file passes the WP-1.1 full-tree loader with zero errors
    const full = load({ ...baseTreeFiles(), [TOPOLOGY_REL]: io.fileContent(TOPOLOGY_PATH)! })
    expect(full.errors).toEqual([])
    expect(full.tree.topics[0]!.topology!.topology.edges).toHaveLength(3)
  })

  it('creates the file when the topic has no topology.yaml yet', () => {
    const io = makeIo()
    io.removeFile(TOPOLOGY_PATH)
    const store = makeStore(io)
    store.addEdge({ id: 'TE-10', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'] })
    expect(io.hasFile(TOPOLOGY_PATH)).toBe(true)
    expect(parseTopologyFile(io).topology.edges.map((e) => e.id)).toEqual(['TE-10'])
  })

  it('allocates the next TE id through the injected IdAllocator (meta counter)', () => {
    const meta = new InMemoryMetaStore()
    // bootstrap: the counter is in sync with the file (TE-1, TE-2 exist)
    meta.bumpCounter(counterKey('TOPOLOGY_EDGE', 'PRJ-1'), 2)
    const allocator = new IdAllocator(meta)
    const store = makeStore(makeIo(), { allocator, projectId: 'PRJ-1' })
    const added = store.addEdge({ operation: 'MERGE', inputs: ['WS-1', 'WS-2'], outputs: ['WS-3'] })
    expect(added.id).toBe('TE-3')
    expect(meta.getCounter(counterKey('TOPOLOGY_EDGE', 'PRJ-1'))).toBe(3)
    // a second allocation continues monotonically
    const second = store.addEdge({ operation: 'FORK', inputs: ['WS-3'], outputs: ['WS-1'] })
    expect(second.id).toBe('TE-4')
    expect(store.edges().map((e) => e.id)).toEqual(['TE-1', 'TE-2', 'TE-3', 'TE-4'])
  })

  it('releases (burns, no reuse) the reserved id when the save fails', () => {
    const meta = new InMemoryMetaStore()
    meta.bumpCounter(counterKey('TOPOLOGY_EDGE', 'PRJ-1'), 2)
    const allocator = new IdAllocator(meta)
    const io = makeIo()
    io.failRenameFrom(TMP)
    const store = makeStore(io, { allocator, projectId: 'PRJ-1' })
    expectStoreError(() => store.addEdge({ operation: 'MERGE', inputs: ['WS-1'], outputs: ['WS-2'] }), 'WRITE')
    // counter burned to 3; the NEXT allocation (fresh io) skips 3 — no reuse
    const store2 = makeStore(makeIo(), { allocator, projectId: 'PRJ-1' })
    expect(store2.addEdge({ operation: 'MERGE', inputs: ['WS-1'], outputs: ['WS-2'] }).id).toBe('TE-4')
  })

  it('rejects addEdge without id when no allocator is configured', () => {
    const store = makeStore()
    const err = expectStoreError(() => store.addEdge({ operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'] }), 'INVALID_ID')
    expect(err.message).toContain('no IdAllocator')
  })

  it('rejects a duplicate explicit id (file untouched)', () => {
    const io = makeIo()
    const before = io.fileContent(TOPOLOGY_PATH)!
    const err = expectStoreError(
      () => makeStore(io).addEdge({ id: 'TE-1', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'] }),
      'DUPLICATE_EDGE_ID',
    )
    expect(err.message).toContain('TE-1')
    expect(io.fileContent(TOPOLOGY_PATH)).toBe(before)
  })

  it('rejects a malformed explicit id (INVALID_ID, file untouched)', () => {
    const io = makeIo()
    const before = io.fileContent(TOPOLOGY_PATH)!
    expectStoreError(
      () => makeStore(io).addEdge({ id: 'TE-x', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'] }),
      'INVALID_ID',
    )
    expect(io.fileContent(TOPOLOGY_PATH)).toBe(before)
  })

  it('rejects unknown / malformed workstream references (file untouched)', () => {
    const io = makeIo()
    const before = io.fileContent(TOPOLOGY_PATH)!
    const e1 = expectStoreError(
      () => makeStore(io).addEdge({ id: 'TE-5', operation: 'FORK', inputs: ['WS-9'], outputs: ['WS-2'] }),
      'WS_NOT_FOUND',
    )
    expect(e1.message).toContain('WS-9')
    const e2 = expectStoreError(
      () => makeStore(io).addEdge({ id: 'TE-5', operation: 'FORK', inputs: ['WS-2'], outputs: ['WS-9'] }),
      'WS_NOT_FOUND',
    )
    expect(e2.path).toBe('/outputs/0')
    expectStoreError(
      () => makeStore(io).addEdge({ id: 'TE-5', operation: 'FORK', inputs: ['T-1'], outputs: ['WS-2'] }),
      'INVALID_ID',
    )
    expect(io.fileContent(TOPOLOGY_PATH)).toBe(before)
  })

  it('rejects empty inputs via the frozen schema (SCHEMA, minItems)', () => {
    const err = expectStoreError(
      () => makeStore().addEdge({ id: 'TE-5', operation: 'FORK', inputs: [], outputs: ['WS-2'] }),
      'SCHEMA',
    )
    expect(err.message).toContain('/topology/edges/2/inputs')
  })

  it('enforces §3.1: REALIZED requires realized_event_id; a present one must be a well-formed H id', () => {
    expectStoreError(
      () => makeStore().addEdge({ id: 'TE-5', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'], lifecycle: 'REALIZED' }),
      'MISSING_REALIZED_EVENT_ID',
    )
    expectStoreError(
      () =>
        makeStore().addEdge({
          id: 'TE-5',
          operation: 'FORK',
          inputs: ['WS-1'],
          outputs: ['WS-2'],
          lifecycle: 'REALIZED',
          realized_event_id: 'H-x',
        }),
      'INVALID_ID',
    )
    const ok = makeStore().addEdge({
      id: 'TE-5',
      operation: 'FORK',
      inputs: ['WS-1'],
      outputs: ['WS-2'],
      lifecycle: 'REALIZED',
      realized_event_id: 'H-1001',
    })
    expect(ok.realized_event_id).toBe('H-1001')
  })
})

describe('TopologyStore.getEdge / updateEdge / deleteEdge', () => {
  it('getEdge returns the edge; EDGE_NOT_FOUND names the id and file', () => {
    const store = makeStore()
    expect(store.getEdge('TE-2').id).toBe('TE-2')
    const err = expectStoreError(() => store.getEdge('TE-9'), 'EDGE_NOT_FOUND')
    expect(err.message).toContain('TE-9')
    expect(err.file).toBe(TOPOLOGY_REL)
    expectStoreError(() => store.getEdge('T-1'), 'INVALID_ID')
  })

  it('updateEdge patches fields and round-trips (note set/clear, outputs swap)', () => {
    const io = makeIo()
    const store = makeStore(io)
    const updated = store.updateEdge('TE-1', { note: '说明更新', outputs: ['WS-2', 'WS-3'] })
    expect(updated.note).toBe('说明更新')
    expect(updated.outputs).toEqual(['WS-2', 'WS-3'])
    expect(parseTopologyFile(io).topology.edges[0]).toEqual(updated)
    // clearing the note removes the key entirely (schema: note optional)
    const cleared = store.updateEdge('TE-1', { note: null })
    expect(cleared.note).toBeUndefined()
    expect(yamlParse(io.fileContent(TOPOLOGY_PATH)!)).toEqual(store.load())
  })

  it('updateEdge does not leak shared references (caller mutation is inert)', () => {
    const store = makeStore()
    const updated = store.updateEdge('TE-2', { note: 'x' })
    updated.inputs.push('WS-9') // would corrupt a later save if aliases leaked
    const again = store.updateEdge('TE-2', { note: 'y' })
    expect(again.inputs).toEqual(['WS-1', 'WS-2'])
  })

  it('updateEdge rejects unknown edges and invariant violations (file untouched)', () => {
    const io = makeIo()
    const before = io.fileContent(TOPOLOGY_PATH)!
    expectStoreError(() => makeStore(io).updateEdge('TE-9', { note: 'x' }), 'EDGE_NOT_FOUND')
    expectStoreError(() => makeStore(io).updateEdge('TE-2', { inputs: ['WS-9'] }), 'WS_NOT_FOUND')
    expect(io.fileContent(TOPOLOGY_PATH)).toBe(before)
  })

  it('lifecycle is not an EdgePatch field (state-machine only, §13)', () => {
    type PatchKeys = keyof EdgePatch
    // compile-time-negative assertion: if 'lifecycle' were a patch key, the
    // alias below would instantiate AssertFalse<true> and fail to compile
    type AssertFalse<T extends false> = T
    type _LcNotAPatchKey = AssertFalse<'lifecycle' extends PatchKeys ? true : false>
    void (null as unknown as _LcNotAPatchKey)
    // runtime: a smuggled-in lifecycle key is ignored — no state change
    const store = makeStore()
    const updated = store.updateEdge('TE-1', { lifecycle: 'DROPPED' } as never)
    expect(updated.lifecycle).toBe('PLANNED')
  })

  it('updateEdge can back-fill / clear realized_event_id (well-formed H ids only)', () => {
    const store = makeStore()
    const withEvent = store.updateEdge('TE-1', { realized_event_id: 'H-7' })
    expect(withEvent.realized_event_id).toBe('H-7')
    expectStoreError(() => store.updateEdge('TE-1', { realized_event_id: 'X-7' }), 'INVALID_ID')
    const cleared = store.updateEdge('TE-1', { realized_event_id: null })
    expect(cleared.realized_event_id).toBeUndefined()
  })

  it('deleteEdge removes the edge and round-trips', () => {
    const io = makeIo()
    const store = makeStore(io)
    store.deleteEdge('TE-2')
    expect(store.edges().map((e) => e.id)).toEqual(['TE-1'])
    expect(parseTopologyFile(io).topology.edges.map((e) => e.id)).toEqual(['TE-1'])
  })

  it('deleteEdge rejects unknown edges (file untouched)', () => {
    const io = makeIo()
    const before = io.fileContent(TOPOLOGY_PATH)!
    expectStoreError(() => makeStore(io).deleteEdge('TE-9'), 'EDGE_NOT_FOUND')
    expect(io.fileContent(TOPOLOGY_PATH)).toBe(before)
  })

  it('two topic stores are independent (TPC-2 file untouched by TPC-1 writes)', () => {
    const io = makeIo()
    const store1 = makeStore(io, { topicId: 'TPC-1' })
    const store2 = makeStore(io, { topicId: 'TPC-2', workstreams: ['WS-1', 'WS-2'] })
    store1.addEdge({ id: 'TE-9', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'] })
    expect(io.hasFile('/mem/ws/.research/topics/TPC-2/topology.yaml')).toBe(false)
    expect(store2.load().topology.edges).toEqual([])
    store2.addEdge({ id: 'TE-1', operation: 'MERGE', inputs: ['WS-1'], outputs: ['WS-2'] }) // same TE id, different topic: allowed
    expect(store1.edges().map((e) => e.id)).toEqual(['TE-1', 'TE-2', 'TE-9'])
  })
})

describe('TopologyStore.save (explicit full-document write)', () => {
  it('saves a constructed document and reloads it unchanged', () => {
    const io = makeIo()
    const store = makeStore(io)
    const doc: TopologyDoc = {
      topology: {
        topic_id: 'TPC-1',
        edges: [
          { id: 'TE-77', topic_id: 'TPC-1', operation: 'FORK', lifecycle: 'PLANNED', inputs: ['WS-2'], outputs: ['WS-3'], note: 'n' },
        ],
      },
    }
    const saved = store.save(doc)
    expect(saved).toBe(doc)
    expect(store.load()).toEqual(doc)
  })

  it('refuses to save an invariant-violating document (file untouched)', () => {
    const io = makeIo()
    const before = io.fileContent(TOPOLOGY_PATH)!
    const bad = makeStore().load()
    bad.topology.edges[0]!.inputs = ['WS-9']
    expectStoreError(() => makeStore(io).save(bad), 'WS_NOT_FOUND')
    expect(io.fileContent(TOPOLOGY_PATH)).toBe(before)
  })

  it('serialization is deterministic (two saves ⇒ identical bytes) and schema-stable', () => {
    const io = makeIo()
    const store = makeStore(io)
    store.save(store.load())
    const first = io.fileContent(TOPOLOGY_PATH)!
    store.save(store.load())
    expect(io.fileContent(TOPOLOGY_PATH)).toBe(first)
    // saved bytes pass the frozen schema + full loader
    const full = load({ ...baseTreeFiles(), [TOPOLOGY_REL]: first })
    expect(full.errors).toEqual([])
    expect(full.tree.topics[0]!.topology!.topology.edges).toEqual(BASE_EDGES)
  })
})
