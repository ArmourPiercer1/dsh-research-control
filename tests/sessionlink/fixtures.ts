/**
 * WP-2.6 test fixtures: real sqlite temp dirs + the real frozen history
 * registry + the fake WP-0.4 session adapter (in-memory event feed).
 *
 * - The store is a REAL research.sqlite in a throwaway directory (the
 *   WP-2.1 helper pattern — node:sqlite semantics are only observable on
 *   real files);
 * - the registry loads the REAL frozen `schema/history` bytes (read-only
 *   contract — the validation gate under test is the production one);
 * - `FakeSessionAdapter` implements the WP-0.4 `DshSessionAdapter` port
 *   with in-memory subscriptions + a test driver (`emit` / `emitLifecycle`)
 *   standing in for the host's `session/event` feed + lifecycle edges.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll } from 'vitest'

import { loadHistoryEventRegistry } from '../../src/host/history/registry/index.js'
import { openDatabase, type ResearchStore } from '../../src/host/persistence/store/index.js'
import type { WorkstreamContextSource } from '../../src/host/service/sessionlink/index.js'
import { IdAllocator } from '../../src/shared/ids/index.js'
import type {
  DshSessionAdapter,
  SessionEventInfo,
  SessionEventSubscriber,
  SessionLifecycleEvent,
  SessionLifecycleHandler,
  SessionQueryWindow,
  SessionSummary,
} from '../../src/shared/host-adapter-ports.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** WR root (three levels up: tests/sessionlink → tests → plugin repo → WR). */
export const WR_ROOT = join(HERE, '..', '..', '..')
/** The real frozen history schema dir (read-only contract). */
export const WR_HISTORY_SCHEMA_DIR = join(WR_ROOT, 'schema', 'history')

/** The test project scope (well-formed PRJ id, DOMAIN_SCHEMA §1.1). */
export const PROJECT_ID = 'PRJ-1'

const roots: string[] = []

/** Fresh temp directory (tracked for afterAll cleanup). */
export function makeTempDir(prefix = 'wp26-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) {
    rmSync(r, { recursive: true, force: true })
  }
})

/** A REAL operational store in a fresh throwaway directory. */
export function makeStore(): ResearchStore {
  return openDatabase(join(makeTempDir(), 'research.sqlite'))
}

/** An `IdAllocator` over the store's `meta` KV (the reserved seam, §1.1 规则 2). */
export function makeAllocator(store: ResearchStore): IdAllocator {
  return new IdAllocator(store.meta())
}

/** The real frozen registry (production validation gate). */
export function makeRegistry() {
  return loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)
}

/** fs-backed schema reader (tests may do I/O; the kernel may not). */
export class FsReader {
  readFile(path: string): string | null {
    if (!isAbsolute(path)) throw new Error(`FsReader requires absolute paths, got ${path}`)
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return readFileSync(path, 'utf8')
  }
}

/**
 * The declarative workstream source for the tests: two known workstreams
 * (one per topic would over-claim; both REALIZED — RUN events need no
 * realize hook) and nothing else.
 */
export const WORKSTREAMS: WorkstreamContextSource = (workstreamId: string): { topicId: string; lifecycle: 'REALIZED' } | null => {
  if (workstreamId === 'WS-1' || workstreamId === 'WS-2') {
    return { topicId: 'TPC-1', lifecycle: 'REALIZED' }
  }
  return null
}

/**
 * The fake WP-0.4 `DshSessionAdapter` — in-memory subscriptions + test
 * driver. Subscriptions behave like the real port: each returns a working
 * disposer, and handlers are called synchronously in registration order.
 */
export class FakeSessionAdapter implements DshSessionAdapter {
  readonly #eventSubs: SessionEventSubscriber[] = []
  readonly #lifecycleSubs: SessionLifecycleHandler[] = []
  /** Observations: the driver's emissions (tests assert subscription wiring). */
  readonly emitted: SessionEventInfo[] = []
  readonly emittedLifecycle: SessionLifecycleEvent[] = []

  listSessions(): SessionSummary[] {
    return []
  }

  onSessionEvent(handler: SessionEventSubscriber): () => void {
    this.#eventSubs.push(handler)
    return () => {
      const i = this.#eventSubs.indexOf(handler)
      if (i !== -1) this.#eventSubs.splice(i, 1)
    }
  }

  observeSessionLifecycle(handler: SessionLifecycleHandler): () => void {
    this.#lifecycleSubs.push(handler)
    return () => {
      const i = this.#lifecycleSubs.indexOf(handler)
      if (i !== -1) this.#lifecycleSubs.splice(i, 1)
    }
  }

  querySession(_id: string, _window: SessionQueryWindow): Promise<never> {
    throw new Error('FakeSessionAdapter.querySession: not needed in WP-2.6 tests')
  }

  /** Driver: deliver one `session/event` to every live subscription. */
  emit(info: SessionEventInfo): void {
    this.emitted.push(info)
    for (const sub of [...this.#eventSubs]) sub(info)
  }

  /** Driver: deliver one lifecycle edge to every live subscription. */
  emitLifecycle(edge: SessionLifecycleEvent): void {
    this.emittedLifecycle.push(edge)
    for (const sub of [...this.#lifecycleSubs]) sub(edge)
  }
}
