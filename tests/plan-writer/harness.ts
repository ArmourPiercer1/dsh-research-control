/**
 * UI-5 D1 — Plan Writer Service test harness: the WP-1.3 MemoryFs (reader
 * + writer on one file map) + a real in-memory IdAllocator + a recording
 * fake ledger db + a deterministic monotonic clock. No sqlite, no fs I/O
 * (the memory-fs discipline of tests/plan + tests/actions).
 */
import { IdAllocator } from '../../src/shared/ids/index.js'
import type { IdKind, Reservation } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import { PlanWriterService } from '../../src/host/service/plan-writer/index.js'
import type { PlanWriterIdAllocator } from '../../src/host/service/plan-writer/index.js'
import {
  baseFs,
  MEM_RESEARCH_ROOT,
  MEM_SCHEMA_DIR,
  T09,
} from '../plan/fixtures.js'
import type { MemoryFs } from '../plan/memory-fs.js'

/** One observed ledger INSERT. */
export interface LedgerCall {
  sql: string
  params: unknown[]
}

/** Recording fake for the MA-INSERT-only `PlanWriterDb` port. */
export class LedgerDb {
  readonly calls: LedgerCall[] = []
  /** Inject the NEXT run() failure (the compensation-path probe). */
  failNext = false

  run(sql: string, ...params: unknown[]): number {
    this.calls.push({ sql, params })
    if (this.failNext) {
      this.failNext = false
      throw new Error('injected ledger write failure')
    }
    return 1
  }
}

export interface AllocatorEvent {
  op: 'reserve' | 'commit' | 'release'
  id: string
  kind: IdKind
}

/** Records the reserve/commit/release lifecycle (the ADJ-4 / compensation
 *  assertions). Delegates to a REAL IdAllocator (the semantics stay live). */
export function spyAllocator(real: IdAllocator): {
  allocator: PlanWriterIdAllocator
  events: AllocatorEvent[]
} {
  const events: AllocatorEvent[] = []
  const allocator: PlanWriterIdAllocator = {
    reserve(kind: IdKind, projectId: string): Reservation {
      const res = real.reserve(kind, projectId)
      events.push({ op: 'reserve', id: res.id, kind })
      return res
    },
    commit(res: Reservation): void {
      events.push({ op: 'commit', id: res.id, kind: res.kind })
      real.commit(res)
    },
    release(res: Reservation): void {
      events.push({ op: 'release', id: res.id, kind: res.kind })
      real.release(res)
    },
  }
  return { allocator, events }
}

export interface ServiceHarness {
  service: PlanWriterService
  db: LedgerDb
  allocator: IdAllocator
  allocatorEvents: AllocatorEvent[]
  fs: MemoryFs
  /** Monotonic epoch-ms clock (starts at T09 + 1 per tick). */
  now: () => number
}

let clock = T09
export function resetClock(): void {
  clock = T09
}

/** Assemble a service over a FRESH MemoryFs (default: the full WP-1.1
 *  base tree — WS-1 plan [G-1, T-1, T-2, T-3, M-1, T-4, G-2]; WS-2/WS-3
 *  without plan.yaml). */
export function makeService(fs: MemoryFs = baseFs()): ServiceHarness {
  resetClock()
  const db = new LedgerDb()
  const real = new IdAllocator(new InMemoryMetaStore())
  const { allocator, events } = spyAllocator(real)
  const now = (): number => {
    clock += 1
    return clock
  }
  const service = new PlanWriterService({
    reader: fs,
    writer: fs,
    researchRoot: MEM_RESEARCH_ROOT,
    schemaDir: MEM_SCHEMA_DIR,
    allocator,
    projectId: 'PRJ-1',
    db,
    now,
  })
  return { service, db, allocator: real, allocatorEvents: events, fs, now }
}
