/**
 * UI-6 D1 — `TopologyService` test harness (D §12.2 fork slice).
 *
 * One shared `MemoryFs` backs EVERY port (the plan-writer harness
 * caliber, extended for the topology store's io protocol):
 *   - the TopologyStore / MergeContractStore `TopologyFileIo`
 *     (`MemTopologyIo` — `writeFile` maps onto the atomic `writeAtomic`,
 *     plus `rename` / `unlink` added to the double for the move protocol);
 *   - the `HierarchyService` ports (fresh `loadResearchTree` per call,
 *     `writeAtomic` writer, `hasFile` pre-write probe, `readFile` raw
 *     reader, `removeDir` recursive dir removal, `hasHistory` always
 *     false, `clearCurrentFocus` no-op);
 *   - the service's `loadTree` port (fail-loud over the SAME fresh load).
 *
 * The frozen schemas are the REAL `schema/declarative` directory (the
 * loader fixture caliber — validation runs against the frozen contract).
 * The ONLY fakes: the MemoryFs itself, the recording `LedgerDb`
 * (reused from the plan-writer harness), the spy allocator (same), and a
 * deterministic clock. The reader can be swapped to a FROZEN record —
 * the TOCTOU seam (stale loader snapshot vs live pre-write probe) and
 * the mid-call re-validation injection seam.
 */
import {
  loadResearchTree,
  type LoadResult,
  type ResearchFileReader,
  type ResearchTree,
} from '../../src/host/domain/loader/index.js'
import type { TopologyFileIo } from '../../src/host/domain/topology/index.js'
import { IdAllocator } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import { HierarchyService } from '../../src/host/service/hierarchy/index.js'
import { TopologyService } from '../../src/host/service/topology/index.js'
import { baseTreeFiles, makeReader, MEM_RESEARCH_ROOT, MEM_SCHEMA_DIR, realSchemaFiles } from '../loader/fixtures.js'
import { T09 } from '../plan/fixtures.js'
import { MemoryFs } from '../plan/memory-fs.js'
import { LedgerDb, spyAllocator, type AllocatorEvent } from '../plan-writer/harness.js'

/** `TopologyFileIo` over a shared MemoryFs (the one-map invariant: the
 *  store's writes are immediately visible to every reader port). */
class MemTopologyIo implements TopologyFileIo {
  constructor(private readonly fs: MemoryFs) {}
  readFile(path: string): string | null {
    return this.fs.readFile(path)
  }
  writeFile(path: string, content: string): void {
    this.fs.writeAtomic(path, content)
  }
  rename(from: string, to: string): void {
    this.fs.rename(from, to)
  }
  unlink(path: string): void {
    this.fs.unlink(path)
  }
}

export interface TopologyHarness {
  service: TopologyService
  hierarchy: HierarchyService
  /** The shared file map (assertion + fault-injection surface). */
  fs: MemoryFs
  /** The recording ledger db (MA-INSERT probe; `failNext` injection). */
  db: LedgerDb
  /** reserve/commit/release lifecycle events (the spy allocator). */
  allocatorEvents: AllocatorEvent[]
  /** Research-root-absolute path from a root-relative path. */
  abs: (rel: string) => string
  /** Swap the reader the load ports use (default: the live MemoryFs).
   *  A `makeReader(...)` frozen record = the TOCTOU / re-validation
   *  injection seam. */
  setReader: (reader: ResearchFileReader) => void
  /** Register a hook run (with the 1-based load counter) BEFORE each
   *  tree load — both services' ports count on the same counter. */
  onLoad: (hook: (loadCall: number) => void) => void
}

export function makeTopologyHarness(files: Record<string, string> = baseTreeFiles()): TopologyHarness {
  const fs = new MemoryFs(realSchemaFiles())
  for (const [rel, content] of Object.entries(files)) {
    fs.addFile(`${MEM_RESEARCH_ROOT}/${rel}`, content)
  }

  // The deterministic monotonic clock (the plan-writer harness caliber).
  let clock = T09
  const now = (): number => {
    clock += 1
    return clock
  }

  // The shared fresh-load seam: one counter, swappable reader.
  let reader: ResearchFileReader = fs
  let loadCall = 0
  const loadHooks: Array<(loadCall: number) => void> = []
  const freshLoad = (): LoadResult => {
    loadCall += 1
    for (const hook of loadHooks) hook(loadCall)
    return loadResearchTree(reader, MEM_RESEARCH_ROOT, MEM_SCHEMA_DIR)
  }

  const hierarchy = new HierarchyService({
    loadTree: freshLoad,
    writer: fs,
    fileExists: (absPath) => fs.hasFile(absPath),
    readFile: (absPath) => fs.readFile(absPath),
    removeDir: (absPath) => fs.removeDir(absPath),
    hasHistory: () => false,
    clearCurrentFocus: () => false,
    researchRoot: MEM_RESEARCH_ROOT,
    now,
  })

  const db = new LedgerDb()
  const real = new IdAllocator(new InMemoryMetaStore())
  const { allocator, events } = spyAllocator(real)

  const service = new TopologyService({
    io: new MemTopologyIo(fs),
    researchRoot: MEM_RESEARCH_ROOT,
    schemaDir: MEM_SCHEMA_DIR,
    loadTree: (operation: string): ResearchTree => {
      const res = freshLoad()
      if (res.errors.length > 0) {
        const first = res.errors[0]!
        throw new Error(
          `${operation}: ${res.errors.length} load error(s); first: ${first.file ?? '(root)'}${
            first.path ? ` @ ${first.path}` : ''
          }: ${first.message}`,
        )
      }
      return res.tree
    },
    hierarchy,
    allocator,
    projectId: 'PRJ-1',
    db,
    now,
  })

  return {
    service,
    hierarchy,
    fs,
    db,
    allocatorEvents: events,
    abs: (rel) => `${MEM_RESEARCH_ROOT}/${rel}`,
    setReader: (r) => {
      reader = r
    },
    onLoad: (hook) => {
      loadHooks.push(hook)
    },
  }
}

/** The live `.research` files as a root-relative record (feed to the
 *  loader fixture `load()` for an independent full-tree re-validation). */
export function researchFilesOf(fs: MemoryFs): Record<string, string> {
  const out: Record<string, string> = {}
  const prefix = `${MEM_RESEARCH_ROOT}/`
  for (const [path, content] of Object.entries(fs.snapshot())) {
    if (path.startsWith(prefix)) out[path.slice(prefix.length)] = content
  }
  return out
}
