/**
 * WP-1.4 test fixtures.
 *
 * Reuses the WP-1.1 loader fixtures read-only: `baseTreeFiles()` (the
 * complete valid `.research/` tree — its `topology.yaml` carries TE-1 FORK
 * [WS-1]→[WS-2] and TE-2 MERGE [WS-1,WS-2]→[WS-3], both PLANNED) and
 * `realSchemaFiles()` (the REAL frozen schema JSON under WR/schema).
 */
import { parse as yamlParse } from 'yaml'

import { expect } from 'vitest'

import {
  baseTreeFiles,
  CONTRACT_MD,
  MEM_RESEARCH_ROOT,
  MEM_SCHEMA_DIR,
  realSchemaFiles,
} from '../loader/fixtures.js'
import type { LoadResult } from '../../src/host/domain/loader/index.js'
import {
  MergeContractStore,
  TopologyStore,
  TopologyStoreError,
  type TopologyFileIo,
  type TopologyStoreOptions,
} from '../../src/host/domain/topology/index.js'
import type { TopologyDoc } from '../../src/host/domain/loader/index.js'
import { FakeIo } from './io-fake.js'

export { MEM_RESEARCH_ROOT, MEM_SCHEMA_DIR }

/** Absolute (io-space) path of TPC-1's topology file. */
export const TOPOLOGY_PATH = `${MEM_RESEARCH_ROOT}/topics/TPC-1/topology.yaml`
/** Root-relative path (loader error-location convention). */
export const TOPOLOGY_REL = 'topics/TPC-1/topology.yaml'

export const BASE_WORKSTREAMS = ['WS-1', 'WS-2', 'WS-3'] as const

/** The base tree's topology edges (verbatim from the WP-1.1 fixture). */
export const BASE_EDGES: TopologyDoc['topology']['edges'] = [
  { id: 'TE-1', topic_id: 'TPC-1', operation: 'FORK', lifecycle: 'PLANNED', inputs: ['WS-1'], outputs: ['WS-2'], note: '分支出独立标定管线' },
  { id: 'TE-2', topic_id: 'TPC-1', operation: 'MERGE', lifecycle: 'PLANNED', inputs: ['WS-1', 'WS-2'], outputs: ['WS-3'] },
]

/**
 * FakeIo seeded with the real frozen schemas + the given `.research` files
 * (defaults to the complete valid base tree).
 */
export function makeIo(files: Record<string, string> = baseTreeFiles()): FakeIo {
  const io = new FakeIo()
  for (const [path, content] of Object.entries(realSchemaFiles())) io.addFile(path, content)
  for (const [rel, content] of Object.entries(files)) io.addFile(`${MEM_RESEARCH_ROOT}/${rel}`, content)
  return io
}

/** A TPC-1 store over the given io (defaults: base tree, base workstreams). */
export function makeStore(io: TopologyFileIo = makeIo(), over: Partial<TopologyStoreOptions> = {}): TopologyStore {
  return new TopologyStore({
    io,
    researchRoot: MEM_RESEARCH_ROOT,
    schemaDir: MEM_SCHEMA_DIR,
    topicId: 'TPC-1',
    workstreams: BASE_WORKSTREAMS,
    ...over,
  })
}

/** The caller-side read-only boundary: all TE ids of a loaded tree. */
export function edgeIdsFromTree(result: LoadResult): string[] {
  return result.tree.topics.flatMap((t) => (t.topology?.topology.edges ?? []).map((e) => e.id))
}

/** A MergeContractStore whose edge snapshot comes from the BASE tree (TE-1, TE-2). */
export function makeContractStore(io: TopologyFileIo = makeIo(), edgeIds: readonly string[] = ['TE-1', 'TE-2']): MergeContractStore {
  return new MergeContractStore({ io, researchRoot: MEM_RESEARCH_ROOT, edgeIds })
}

/** The base-tree contract content for TE-2 (verbatim WP-1.1 fixture). */
export function baseContractContent(): string {
  return CONTRACT_MD
}

/** Raw YAML of the topology file, parsed back to a doc (for round-trip asserts). */
export function parseTopologyFile(io: FakeIo, path: string = TOPOLOGY_PATH): TopologyDoc {
  const text = io.fileContent(path)
  if (text === null) throw new Error(`no topology file at ${path} in the fake io`)
  return yamlParse(text) as TopologyDoc
}

/**
 * Assert `fn` throws a `TopologyStoreError` with `code` and return the error
 * for message assertions.
 */
export function expectStoreError(fn: () => unknown, code: TopologyStoreError['code']): TopologyStoreError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(TopologyStoreError)
    const e = error as TopologyStoreError
    expect(e.code).toBe(code)
    return e
  }
  throw new Error(`expected TopologyStoreError(${code}) but the call succeeded`)
}

/** A pure in-memory topology document for validateRealize (no I/O involved). */
export function makeDoc(edges: TopologyDoc['topology']['edges'], topicId: string = 'TPC-1'): TopologyDoc {
  return { topology: { topic_id: topicId, edges: edges.map((e) => ({ ...e, inputs: [...e.inputs], outputs: [...e.outputs] })) } }
}
