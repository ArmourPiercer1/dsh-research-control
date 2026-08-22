/**
 * WP-2.4 test infrastructure (tests/runbinding/).
 *
 * Every test opens a REAL research.sqlite in a throwaway directory
 * (mkdtemp under os.tmpdir) through `openRunBindingDatabase` — the
 * store wrapper + the run/DS tables + WAL semantics are only observable
 * on real files. The registry is the REAL frozen WP-2.2 registry loaded
 * from the WR history schema dir (read-only contract, SI-001 layout).
 *
 * The `Harness` bundles everything the service needs:
 *   store (WP-2.1) + tables (this WP) + registry + allocator (over the
 *   store meta) + external-state provider + the service itself — plus a
 *   deterministic clock. Test cases mutate the harness's `ws`/`tasks`
 *   maps (the provider reads them live) and `roots` (re-normalized).
 *
 * The `FakeSessionAdapter` implements the WP-0.4 `DshSessionAdapter`
 * port in-memory: a session list + recorded subscriptions + manual
 * edge emission (`emitCreated`/`emitDisposed`/`emitSessionEvent`) so
 * the discovery push surface is observable without a host.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterAll } from 'vitest'

import { IdAllocator } from '../../src/shared/ids/index.js'
import { loadHistoryEventRegistry } from '../../src/host/history/registry/index.js'
import type { HistoryEventRegistry } from '../../src/host/history/registry/index.js'
import type { ResearchStore } from '../../src/host/persistence/store/index.js'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import type { DshSessionAdapter, SessionSummary } from '../../src/shared/host-adapter-ports.js'
import {
  RunBindingService,
  openRunBindingDatabase,
  type RunBindingDatabase,
} from '../../src/host/service/runbinding/index.js'
import type {
  RunBindingExternalState,
  UserActorRef,
} from '../../src/host/service/runbinding/index.js'
import type {
  TaskSnapshot,
  WorkstreamSnapshot,
} from '../../src/host/history/registry/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** WR root (three levels up: tests/runbinding → tests → plugin repo → WR). */
export const WR_ROOT = resolve(HERE, '..', '..', '..')
/** The real frozen history schema dir (registry source). */
export const WR_HISTORY_SCHEMA_DIR = join(WR_ROOT, 'schema', 'history')
/** The real frozen operational schema dir (record shape conformance). */
export const WR_OPERATIONAL_SCHEMA_DIR = join(WR_ROOT, 'schema', 'operational')

/** fs-backed `HistorySchemaReader` (tests may do I/O). */
export class FsReader {
  readFile(path: string): string | null {
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return readFileSync(path, 'utf8')
  }
}

/* ------------------------------------------------------------------ *
 * Temp dirs (afterAll cleanup)
 * ------------------------------------------------------------------ */

const roots: string[] = []

/** Fresh temp directory (tracked for afterAll cleanup). */
export function makeTempDir(prefix = 'wp24-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) {
    rmSync(r, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ *
 * Deterministic reference time
 * ------------------------------------------------------------------ */

/** Reference "now" (epoch ms, 2026-08-22T09:00:00Z). */
export const T0 = Date.parse('2026-08-22T09:00:00Z')

/* ------------------------------------------------------------------ *
 * Session fixture
 * ------------------------------------------------------------------ */

let sessionSeq = 0

/** A well-formed `SessionSummary` (the WP-0.4 port row). */
export function makeSession(over: Partial<SessionSummary> = {}): SessionSummary {
  sessionSeq += 1
  const base: SessionSummary = {
    id: `sess-${sessionSeq}`,
    running: false,
    createdAt: T0 + sessionSeq,
    blank: true,
  }
  return { ...base, ...over }
}

/* ------------------------------------------------------------------ *
 * Fake SessionAdapter (the WP-0.4 port, in-memory)
 * ------------------------------------------------------------------ */

export type LifecycleHandler = (event: { kind: 'created' | 'disposed'; sessionId: string }) => void

/**
 * In-memory `DshSessionAdapter`: a mutable session list + recorded
 * subscriptions. `emitCreated`/`emitDisposed` fire the standing
 * lifecycle handler synchronously (the host's post-commit dispatch).
 */
export class FakeSessionAdapter implements DshSessionAdapter {
  readonly sessions: SessionSummary[]
  readonly createdEdges: string[] = []
  readonly disposedEdges: string[] = []
  readonly sessionEventCalls: number[] = []
  #lifecycleHandler: LifecycleHandler | null = null
  #eventHandler: ((e: { sessionId: string; type: string; seq: number }) => void) | null = null

  constructor(initial: readonly SessionSummary[] = []) {
    this.sessions = [...initial]
  }

  listSessions(): SessionSummary[] {
    return [...this.sessions]
  }

  onSessionEvent(handler: (event: { sessionId: string; type: string; seq: number }) => void): () => void {
    this.#eventHandler = handler
    this.sessionEventCalls.push(1)
    return () => {
      this.#eventHandler = null
    }
  }

  observeSessionLifecycle(handler: LifecycleHandler): () => void {
    this.#lifecycleHandler = handler
    return () => {
      this.#lifecycleHandler = null
    }
  }

  querySession(): Promise<never> {
    throw new Error('FakeSessionAdapter.querySession: not used in runbinding tests')
  }

  /** Add a session to the list (as the host store would on create). */
  addSession(session: SessionSummary): void {
    this.sessions.push(session)
  }

  /** Fire the `session/created` edge (post-commit, host-side dispatch). */
  emitCreated(sessionId: string): void {
    this.createdEdges.push(sessionId)
    this.#lifecycleHandler?.({ kind: 'created', sessionId })
  }

  /** Fire the `session/disposed` edge. */
  emitDisposed(sessionId: string): void {
    this.disposedEdges.push(sessionId)
    this.#lifecycleHandler?.({ kind: 'disposed', sessionId })
  }
}

/* ------------------------------------------------------------------ *
 * External declarative state (the validation-context seam)
 * ------------------------------------------------------------------ */

/**
 * The mutable external-state container the harness provider reads:
 * workstreams + tasks maps (the declarative-side snapshot seam).
 */
export class ExternalState implements RunBindingExternalState {
  readonly workstreams = new Map<string, WorkstreamSnapshot>()
  readonly tasks = new Map<string, TaskSnapshot>()

  addWorkstream(id: string, lifecycle: WorkstreamSnapshot['lifecycle'] = 'REALIZED', topicId = 'TPC-1'): void {
    this.workstreams.set(id, { topicId, lifecycle })
  }

  addTask(id: string, workstreamId: string): void {
    this.tasks.set(id, {
      workstreamId,
      execution: 'PLANNED',
      validation: 'NOT_REQUIRED',
      acceptanceCriteria: [],
    })
  }
}

/* ------------------------------------------------------------------ *
 * The harness
 * ------------------------------------------------------------------ */

export interface HarnessOptions {
  /** Injectable clock; default = T0-based monotonic. */
  now?: () => number
  /** Workspace roots for attribution; default = two REAL temp dirs
   *  (`<dir>/ws-a`, `<dir>/ws-b`) created by the harness. */
  workspaceRoots?: readonly string[]
  externalState?: ExternalState
  /** The U9 seam (DOMAIN_SCHEMA §6.2 规则 1; DSH_ADAPTER §13-U9):
   *  explicit ResearchContext detector; default = the frozen fallback
   *  (always null → no auto-registration). */
  researchContextResolver?: import('../../src/host/service/runbinding/index.js').ResearchContextResolver
}

/**
 * A fully-wired runbinding stack on a real temp research.sqlite:
 * WP-2.1 store + this WP's tables + the real frozen registry + an
 * `IdAllocator` over the store `meta` + the `RunBindingService`.
 */
export interface Harness {
  readonly dir: string
  readonly db: RunBindingDatabase
  readonly store: ResearchStore
  readonly registry: HistoryEventRegistry
  readonly allocator: IdAllocator
  readonly external: ExternalState
  readonly service: RunBindingService
  /** Deterministic now() (advance manually for time assertions). */
  readonly now: () => number
  /** The two real workspace roots (default harness). */
  readonly rootA: string
  readonly rootB: string
  close(): void
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const dir = makeTempDir()
  const rootA = join(dir, 'ws-a')
  const rootB = join(dir, 'ws-b')
  if (options.workspaceRoots === undefined) {
    mkdirSync(rootA)
    mkdirSync(rootB)
  }
  const db = openRunBindingDatabase(join(dir, 'research.sqlite'))
  const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)
  if (!registry.isUsable) {
    throw new Error(`registry unusable in test harness: ${registry.loadErrors.map((e) => e.message).join('; ')}`)
  }
  const allocator = new IdAllocator(db.store.meta())
  const external = options.externalState ?? new ExternalState()
  external.addWorkstream('WS-1')
  external.addWorkstream('WS-2')
  external.addTask('T-1', 'WS-1')
  external.addTask('T-2', 'WS-2')

  let t = T0
  const now = options.now ?? (() => (t += 1000))
  const service = new RunBindingService({
    store: db.store,
    tables: db.tables,
    registry,
    allocator,
    projectId: 'PRJ-1',
    workspaceRoots: options.workspaceRoots ?? [rootA, rootB],
    externalState: () => external,
    researchContextResolver: options.researchContextResolver,
    now,
  })
  return {
    dir,
    db,
    store: db.store,
    registry,
    allocator,
    external,
    service,
    now,
    rootA,
    rootB,
    close() {
      db.tables.close()
      db.store.close()
    },
  }
}

/* ------------------------------------------------------------------ *
 * Common actors
 * ------------------------------------------------------------------ */

export const USER: UserActorRef = { kind: 'USER', user_id: 'u-1', label: 'tester' }
export const USER_B: UserActorRef = { kind: 'USER', user_id: 'u-2' }

let seedSeq = 0

/** Seed one discovered (PENDING) DS row: a session whose cwd IS root A. */
export function seedPendingDs(
  h: Harness,
  opts: { sessionId?: string; root?: string; title?: string } = {},
): import('../../src/host/service/runbinding/index.js').DiscoveredSessionRecord {
  seedSeq += 1
  const root = opts.root ?? h.rootA
  const created = h.service.reconcileSessions([
    makeSession({ id: opts.sessionId ?? `sess-seed-${seedSeq}`, cwd: root, title: opts.title }),
  ])
  const row = created[0]
  if (row === undefined) throw new Error(`seedPendingDs: no row created (cwd=${root} attributed?)`)
  return row
}
