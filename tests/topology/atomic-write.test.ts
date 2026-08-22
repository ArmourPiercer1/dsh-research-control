/**
 * WP-1.4 — atomic-write protocol (TopologyStore.save / MergeContractStore
 * .writeContract via contract.ts `atomicWrite`):
 *
 *   1. writeFile(`<target>.dshrc-tmp`, full content)
 *   2. rename(tmp → target)         (atomic on POSIX)
 *   3. on rename failure: unlink(tmp) best-effort, then throw WRITE
 *
 * Invariants under failure: the target file is either the OLD complete
 * document or the NEW complete document — never a mix, never a partial
 * write, and (except when cleanup itself fails) no temp file behind.
 */
import { describe, expect, it } from 'vitest'

import {
  expectStoreError,
  makeContractStore,
  makeIo,
  makeStore,
  parseTopologyFile,
  TOPOLOGY_PATH,
} from './fixtures.js'
import { TMP_FILE_SUFFIX } from '../../src/host/domain/topology/index.js'

const TMP = TOPOLOGY_PATH + TMP_FILE_SUFFIX

describe('atomicWrite — happy path', () => {
  it('saves through exactly [writeFile(tmp), rename(tmp → target)] and leaves no temp file', () => {
    const io = makeIo()
    makeStore(io).save(makeStore(io).load())
    expect(io.ops.map((o) => o.op)).toEqual(['writeFile', 'rename'])
    expect(io.ops[0]!.path).toBe(TMP)
    expect(io.ops[1]!.path).toBe(TMP)
    expect(io.ops[1]!.to).toBe(TOPOLOGY_PATH)
    expect(io.hasFile(TMP)).toBe(false)
  })

  it('the target holds the complete NEW document after the rename', () => {
    const io = makeIo()
    const store = makeStore(io)
    store.addEdge({ id: 'TE-3', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'] })
    const parsed = parseTopologyFile(io)
    expect(parsed.topology.edges.map((e) => e.id)).toEqual(['TE-1', 'TE-2', 'TE-3'])
    // and the saved file is a schema-valid complete document (full loader: zero errors)
    expect(parsed.topology.topic_id).toBe('TPC-1')
  })

  it('contract writes use the same protocol (merges/<TE>/contract.md)', () => {
    const io = makeIo()
    makeContractStore(io).writeContract('TE-1', '# c\n')
    const target = '/mem/ws/.research/merges/TE-1/contract.md'
    expect(io.ops.map((o) => o.op)).toEqual(['writeFile', 'rename'])
    expect(io.ops[1]!.path).toBe(target + TMP_FILE_SUFFIX)
    expect(io.ops[1]!.to).toBe(target)
    expect(io.hasFile(target + TMP_FILE_SUFFIX)).toBe(false)
  })
})

describe('atomicWrite — write(tmp) failure', () => {
  it('target untouched, no rename attempted, no temp file, WRITE error', () => {
    const io = makeIo()
    const before = io.fileContent(TOPOLOGY_PATH)!
    io.failWriteAt(TMP)
    const err = expectStoreError(() => makeStore(io).save(makeStore(io).load()), 'WRITE')
    expect(err.message).toContain('temp-file write failed')
    expect(err.file).toBe('topics/TPC-1/topology.yaml')
    expect(io.fileContent(TOPOLOGY_PATH)).toBe(before)
    expect(io.hasFile(TMP)).toBe(false)
    expect(io.ops.map((o) => o.op)).toEqual(['writeFile']) // no rename
  })
})

describe('atomicWrite — rename failure (the atomicity core)', () => {
  it('previous document stays INTACT (full old bytes), temp cleaned up, WRITE error', () => {
    const io = makeIo()
    const before = io.fileContent(TOPOLOGY_PATH)!
    io.failRenameFrom(TMP)
    const err = expectStoreError(() => {
      const store = makeStore(io)
      store.addEdge({ id: 'TE-3', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'] })
    }, 'WRITE')
    expect(err.message).toContain('rename into place failed')
    // the old complete document — byte-for-byte (the new one was in the temp file only)
    expect(io.fileContent(TOPOLOGY_PATH)).toBe(before)
    expect(io.hasFile(TMP)).toBe(false) // best-effort cleanup ran
    expect(io.ops.map((o) => o.op)).toEqual(['writeFile', 'rename', 'unlink'])
    // a fresh store still loads the old state
    expect(makeStore(io).edges().map((e) => e.id)).toEqual(['TE-1', 'TE-2'])
  })

  it('the failed addEdge burned no file state and left the counter reservation released (gap, no reuse)', () => {
    // covered together with the state-machine suite's counter test; here:
    // a second write on a fresh io succeeds and sees the old edges
    const io = makeIo()
    io.failRenameFrom(TMP)
    expectStoreError(() => {
      const store = makeStore(io)
      store.addEdge({ id: 'TE-3', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'] })
    }, 'WRITE')
    const io2 = makeIo()
    const store2 = makeStore(io2)
    store2.addEdge({ id: 'TE-3', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'] })
    expect(store2.edges().map((e) => e.id)).toEqual(['TE-1', 'TE-2', 'TE-3'])
  })

  it('cleanup failure does NOT mask the rename error (best effort), temp file remains visible', () => {
    const io = makeIo()
    const before = io.fileContent(TOPOLOGY_PATH)!
    io.failRenameFrom(TMP)
    io.failUnlinkAt(TMP)
    const err = expectStoreError(() => makeStore(io).save(makeStore(io).load()), 'WRITE')
    expect(err.message).toContain('rename into place failed') // still the rename error
    expect(io.hasFile(TMP)).toBe(true) // cleanup failed — observable, not fatal
    expect(io.fileContent(TOPOLOGY_PATH)).toBe(before) // target untouched (old complete doc)
  })

  it('contract write with rename failure: previous contract intact', () => {
    const io = makeIo()
    const target = '/mem/ws/.research/merges/TE-2/contract.md'
    const before = io.fileContent(target)!
    io.failRenameFrom(target + TMP_FILE_SUFFIX)
    expectStoreError(() => makeContractStore(io).writeContract('TE-2', '# new\n'), 'WRITE')
    expect(io.fileContent(target)).toBe(before)
    expect(io.hasFile(target + TMP_FILE_SUFFIX)).toBe(false)
  })
})

describe('atomicWrite — target appears when absent (creation through the same protocol)', () => {
  it('saving the empty document to a missing topology.yaml creates the file', () => {
    const io = makeIo()
    io.removeFile(TOPOLOGY_PATH)
    makeStore(io).save(makeStore(io).load()) // empty-doc save
    expect(io.hasFile(TOPOLOGY_PATH)).toBe(true)
    expect(parseTopologyFile(io)).toEqual({ topology: { topic_id: 'TPC-1', edges: [] } })
    expect(io.ops.map((o) => o.op)).toEqual(['writeFile', 'rename'])
  })

  it('addEdge on a missing file creates it with only the new edge', () => {
    const io = makeIo()
    io.removeFile(TOPOLOGY_PATH)
    const store = makeStore(io)
    store.addEdge({ id: 'TE-1', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'] })
    const parsed = parseTopologyFile(io)
    expect(parsed.topology.edges.map((e) => e.id)).toEqual(['TE-1'])
    expect(io.hasFile(TMP)).toBe(false)
  })
})
