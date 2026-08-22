/**
 * WP-1.4 — MergeContract (`merges/<TE-id>/contract.md`, DOMAIN_SCHEMA §3.2):
 * read/write round-trip, ownership-by-path checks (well-formed TE id +
 * edge existence snapshot), and the 「纯 Markdown 自由内容」 no-content-
 * validation rule (optional front-matter passes through verbatim).
 */
import { describe, expect, it } from 'vitest'

import { baseTreeFiles, load } from '../loader/fixtures.js'
import {
  baseContractContent,
  edgeIdsFromTree,
  expectStoreError,
  makeContractStore,
  makeIo,
  makeStore,
} from './fixtures.js'

const CONTRACT_PATH = '/mem/ws/.research/merges/TE-2/contract.md'
const CONTRACT_REL = 'merges/TE-2/contract.md'

describe('MergeContractStore.readContract', () => {
  it('returns the base-tree contract byte-for-byte', () => {
    expect(makeContractStore().readContract('TE-2')).toBe(baseContractContent())
  })

  it('CONTRACT_NOT_FOUND when the file does not exist (names path + §3.2)', () => {
    const err = expectStoreError(() => makeContractStore().readContract('TE-1'), 'CONTRACT_NOT_FOUND')
    expect(err.message).toContain('TE-1')
    expect(err.message).toContain('merges/TE-1/contract.md')
    expect(err.file).toBe('merges/TE-1/contract.md')
  })

  it('INVALID_ID for malformed / wrong-kind teIds', () => {
    for (const bad of ['TE-x', 'T-1', 'ws-1', '']) {
      expectStoreError(() => makeContractStore().readContract(bad), 'INVALID_ID')
    }
  })

  it('READ on io failure', () => {
    const io = makeIo()
    io.failReadAt(CONTRACT_PATH)
    expectStoreError(() => makeContractStore(io).readContract('TE-2'), 'READ')
  })
})

describe('MergeContractStore.writeContract', () => {
  it('round-trips: write a new contract (TE-1) and read it back', () => {
    const io = makeIo()
    const store = makeContractStore(io)
    const content = `# Merge Contract TE-1\n\n- 接口: 标定中间结果\n- 期望产物: docs/calibration-handoff.md\n`
    expect(store.writeContract('TE-1', content)).toBe(content)
    expect(io.hasFile('/mem/ws/.research/merges/TE-1/contract.md')).toBe(true)
    expect(store.readContract('TE-1')).toBe(content)
  })

  it('overwrites an existing contract (full replacement)', () => {
    const io = makeIo()
    const store = makeContractStore(io)
    store.writeContract('TE-2', '# v2\n')
    expect(store.readContract('TE-2')).toBe('# v2\n')
    expect(io.fileContent(CONTRACT_PATH)).toBe('# v2\n')
  })

  it('optional YAML front-matter + free Markdown pass through VERBATIM (no content validation, §3.2)', () => {
    const store = makeContractStore()
    const withFrontMatter = `---\ntitle: 合并契约（TE-2）\nupdated_at: 2026-08-21T10:00:00Z\n---\n\n正文：坐标系、benchmark protocol、期望产物……\n`
    const withoutFrontMatter = '纯正文，无 front-matter，也无任何结构。\n'
    const garbage = '这不是 YAML，也不是结构化内容：{{{ !!!\n'
    for (const content of [withFrontMatter, withoutFrontMatter, garbage]) {
      expect(store.writeContract('TE-1', content)).toBe(content)
    }
    expect(store.readContract('TE-1')).toBe(garbage)
  })

  it('CONTRACT_TE_UNKNOWN: writing for an edge that does not exist (§3.2/§16.1)', () => {
    const io = makeIo()
    const before = io.filePaths()
    const err = expectStoreError(() => makeContractStore(io).writeContract('TE-99', '# x\n'), 'CONTRACT_TE_UNKNOWN')
    expect(err.message).toContain('TE-99')
    expect(err.message).toContain('does not exist')
    expect(io.filePaths()).toEqual(before) // no file created
  })

  it('INVALID_ID before the edge-existence check (malformed id never touches the file set)', () => {
    const io = makeIo()
    expectStoreError(() => makeContractStore(io).writeContract('TE-x', '# x\n'), 'INVALID_ID')
    expect(io.hasFile('/mem/ws/.research/merges/TE-x/contract.md')).toBe(false)
  })

  it('the edge snapshot comes from the loaded tree (read-only boundary, edgeIdsFromTree)', () => {
    const files = baseTreeFiles()
    const tree = load(files)
    expect(tree.errors).toEqual([])
    expect(edgeIdsFromTree(tree)).toEqual(['TE-1', 'TE-2'])
    // a store built from the tree accepts exactly those edges
    const store = makeContractStore(makeIo(files), edgeIdsFromTree(tree))
    expect(() => store.writeContract('TE-1', 'a')).not.toThrow()
    expect(() => store.writeContract('TE-2', 'b')).not.toThrow()
    expectStoreError(() => store.writeContract('TE-3', 'c'), 'CONTRACT_TE_UNKNOWN')
  })

  it('snapshot semantics: an edge added AFTER construction is unknown to the old store', () => {
    const io = makeIo()
    const oldStore = makeContractStore(io) // snapshot: TE-1, TE-2
    // topology gains TE-3 (via the topology store) — the contract store was not rebuilt
    makeStore(io).addEdge({ id: 'TE-3', operation: 'FORK', inputs: ['WS-1'], outputs: ['WS-2'] })
    expectStoreError(() => oldStore.writeContract('TE-3', '# x\n'), 'CONTRACT_TE_UNKNOWN')
  })
})
