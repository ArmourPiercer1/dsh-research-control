/**
 * WP-3.2 test infrastructure — REAL end-to-end harness:
 *
 *   - REAL temp git repo (tests/git `makeTempRepo` factory, independent
 *     mkdtemp per harness, disposed afterAll — TEST_MATRIX §5.1 纪律);
 *   - the REAL declarative plan tree (`baseTreeFiles()` — the WP-1.1 fixture:
 *     WS-1 §11 canonical G-1, T-1, T-2, T-3, M-1, T-4, G-2 + 7 definition
 *     files + policy) written into `<repo>/.research/` (committed or left as
 *     a bare working copy — §3.2 「无需 commit」 both states);
 *   - REAL operational sqlite (`openDatabase` WP-2.1 封装 + second
 *     `DatabaseSync` adapted to the WP-3.1 `PlanForkDb` structural port —
 *     the persist-harness pattern) hosting a REAL `PlanForkStore`;
 *   - REAL canonical plan loading: WP-1.3 `PlanStore.loadPlan` behind the
 *     service-layer `FsResearchReader` (the production canonical-load path,
 *     fresh per call);
 *   - REAL frozen schemas: operational `plan-fork.schema.json` (+ parent
 *     common) for the §4 chain, declarative `schema/declarative/*` for the
 *     policy load;
 *   - the `PlanForkStaleService` under test, wired exactly like production
 *     (repoRoot + store face + planProvider).
 *
 * Every test opens its OWN harness (independent repo + DB) and closes it —
 * no shared mutable state across tests.
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

import { openDatabase } from '../../src/host/persistence/store/index.js'
import { IdAllocator } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import { PlanStore } from '../../src/host/domain/plan/index.js'
import {
  loadPlanForkPolicy,
  loadPlanForkSchemas,
  PlanForkStore,
  type AgentPlanForkPolicy,
  type CanonicalPlanProvider,
  type CanonicalPlanView,
  type ClosureBlobBase,
  type ClosureBlobCapturer,
  type PlanForkCreationContext,
  type PlanForkDb,
  type PlanForkRecord,
  type PlanForkSchemas,
} from '../../src/host/domain/planfork/index.js'
import { FsResearchReader } from '../../src/host/service/checkpoint/fs-reader.js'
import { PlanForkStaleService } from '../../src/host/service/stale/index.js'
import { makeTempRepo, type TempRepo } from '../git/temp-repo.js'
import { baseTreeFiles, WR_SCHEMA_DIR } from '../loader/fixtures.js'
import { MemoryReader } from '../loader/memory-reader.js'
import {
  MEM_OPERATIONAL_SCHEMA_DIR,
  makeParams,
  makeRunLookup,
  makeTriggerResolver,
  realOperationalSchemaFiles,
  T_CREATE,
  WS1_CANONICAL,
} from '../planfork/fixtures.js'

const roots: string[] = []

export function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wp32-stale-'))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** Adapt a real node:sqlite DatabaseSync to the domain PlanForkDb port (WP-3.1 pattern). */
export function adaptDatabaseSync(db: DatabaseSync): PlanForkDb {
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, ...params) => Number(db.prepare(sql).run(...params).changes),
    get: (sql, ...params) => db.prepare(sql).get(...params) as Record<string, unknown> | undefined,
    all: (sql, ...params) => db.prepare(sql).all(...params) as Record<string, unknown>[],
    transaction: <T>(work: () => T): T => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = work()
        db.exec('COMMIT')
        return result
      } catch (cause) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* the transaction may already have rolled back */
        }
        throw cause
      }
    },
  }
}

/** The repo-root-relative plan path (WS-1, TPC-1). */
export const PLAN_PATH = '.research/topics/TPC-1/workstreams/WS-1/plan.yaml'
/** The repo-root-relative definition file path of one canonical item. */
export const itemPath = (id: string): string => {
  const dir = id.startsWith('G') ? 'gates' : id.startsWith('M') ? 'milestones' : 'tasks'
  return `.research/topics/TPC-1/workstreams/WS-1/items/${dir}/${id}.yaml`
}

/** Rewrite `plan.yaml` with a new `ordered_items` list (same byte shape as the fixture). */
export function planYaml(orderedItems: readonly string[]): string {
  return `workstream: WS-1\nordered_items: [${orderedItems.join(', ')}]\n`
}

/** The base tree's `.research/**` files (loader fixture keys are `.research`-relative). */
export const RESEARCH_TREE: ReadonlyArray<readonly [string, string]> = Object.entries(baseTreeFiles())

/** Write the real declarative tree into `<repo>/.research/`; commit when `committed`. */
export async function seedResearchTree(repo: TempRepo, committed: boolean, tree: ReadonlyArray<readonly [string, string]> = RESEARCH_TREE): Promise<void> {
  for (const [rel, content] of tree) {
    await repo.write(`.research/${rel}`, content)
  }
  if (committed) {
    await repo.git(['add', '--', '.research'])
    await repo.git(['commit', '-m', 'fixture: seed .research tree'])
  }
}

/**
 * The canonical plan provider over the REAL filesystem (WP-3.1 port):
 * discover `topics/<TPC>/workstreams/<ws>` via the reader, then run the
 * REAL `PlanStore.loadPlan` (fresh per call, no cache). Mirrors the
 * tests/planfork fixtures' provider, with a real FsResearchReader backend.
 */
const REJECTING_WRITER = {
  writeAtomic(path: string): void {
    throw new Error(`CanonicalPlanProvider is read-only (writeAtomic ${path})`)
  },
}

export function makeFsPlanProvider(repoRoot: string): CanonicalPlanProvider {
  const researchRoot = join(repoRoot, '.research')
  const reader = new FsResearchReader(researchRoot)
  return {
    load(workstreamId): CanonicalPlanView {
      const topics = reader.readDir(join(researchRoot, 'topics'))
      if (topics === null) return absentView(workstreamId, '')
      for (const t of topics) {
        if (t.kind !== 'directory') continue
        const wsDirRel = `topics/${t.name}/workstreams/${workstreamId}`
        if (reader.readDir(join(researchRoot, wsDirRel)) === null) continue
        let store: PlanStore
        try {
          store = new PlanStore({
            reader,
            writer: REJECTING_WRITER,
            researchRoot,
            schemaDir: WR_SCHEMA_DIR,
            topicId: t.name,
            wsId: workstreamId,
          })
        } catch {
          return absentView(workstreamId, wsDirRel)
        }
        const view = store.loadPlan()
        return {
          workstream_id: workstreamId,
          wsDir: wsDirRel,
          workstream_exists: true,
          present: view.present,
          ordered_items: view.items,
          consistent: view.errors.length === 0,
          ...(view.errors.length > 0
            ? { problem: view.errors.map((e) => `${e.file}${e.path ?? ''}: ${e.message}`).join(' | ') }
            : {}),
        }
      }
      return absentView(workstreamId, '')
    },
  }
}

function absentView(workstreamId: string, wsDir: string): CanonicalPlanView {
  return {
    workstream_id: workstreamId,
    wsDir,
    workstream_exists: false,
    present: false,
    ordered_items: [],
    consistent: false,
    problem: 'workstream directory not found',
  }
}

/** A step-3 capturer stub that MUST be replaced by the service (fail loud if not). */
const THROWS_BASE_CAPTURER: ClosureBlobCapturer = {
  capture(): ClosureBlobBase {
    throw new Error('harness: baseCapturer stub must be replaced by PlanForkStaleService.createPlanFork')
  },
}

export interface StaleHarnessOptions {
  /** Commit the seeded `.research/` tree (default true; false = bare working copy, no HEAD). */
  readonly committed?: boolean
  /** Custom tree (default = the real baseTreeFiles `.research` set). */
  readonly tree?: ReadonlyArray<readonly [string, string]>
  /** The service's W3 pool concurrency (default = the service default). */
  readonly concurrency?: number
}

export interface StaleHarness {
  /** The temp git repo (write/read/git/head/dispose). */
  readonly repo: TempRepo
  /** The REAL PlanForkStore over real research.sqlite (second connection). */
  readonly store: PlanForkStore
  /** The raw second connection (ledger inspection). */
  readonly rawDb: DatabaseSync
  /** The service under test. */
  readonly service: PlanForkStaleService
  /** The canonical plan provider (real FS PlanStore backend). */
  readonly planProvider: CanonicalPlanProvider
  /** The §9 policy loaded from the real tree. */
  readonly policy: AgentPlanForkPolicy
  /** Assemble the §4 creation context (fresh canonical plan view; stub capturer — the service replaces it). */
  ctx(wsId?: string): PlanForkCreationContext
  /** Close DB connections + dispose the repo. */
  close(): Promise<void>
}

/** Open one fully-real harness (fresh temp repo + fresh sqlite per call). */
export async function openStaleHarness(options: StaleHarnessOptions = {}): Promise<StaleHarness> {
  const committed = options.committed ?? true
  const repo = await makeTempRepo({ seedResearch: false })
  await seedResearchTree(repo, committed, options.tree)

  const dir = makeTempDir()
  const coreStore = openDatabase(join(dir, 'research.sqlite'))
  const rawDb = new DatabaseSync(join(dir, 'research.sqlite'))
  rawDb.exec('PRAGMA busy_timeout = 5000')

  // ONE shared monotonic clock for store `now` AND ctx `now` (WP-3.1
  // discipline: ledger order = real order).
  let tick = 0
  const clock = () => T_CREATE + ++tick * 1000

  const allocator = new IdAllocator(new InMemoryMetaStore())
  const store = new PlanForkStore({ db: adaptDatabaseSync(rawDb), allocator, projectId: 'PRJ-1', now: clock })

  const planProvider = makeFsPlanProvider(repo.root)

  const researchRoot = join(repo.root, '.research')
  const policyResult = loadPlanForkPolicy(new FsResearchReader(researchRoot), researchRoot, WR_SCHEMA_DIR)
  if (policyResult.policy === null) {
    await repo.dispose()
    throw new Error(`stale harness: policy failed to load: ${policyResult.errors.map((e) => e.message).join(' | ')}`)
  }
  const policy = policyResult.policy

  const opReader = new MemoryReader(realOperationalSchemaFiles())
  const schemas: PlanForkSchemas = loadPlanForkSchemas(opReader, MEM_OPERATIONAL_SCHEMA_DIR)
  if (!schemas.isUsable) {
    await repo.dispose()
    throw new Error(`stale harness: operational schemas unavailable: ${schemas.loadErrors.map((e) => `${e.path}: ${e.message}`).join(' | ')}`)
  }

  const runs = makeRunLookup()
  const triggers = makeTriggerResolver()

  const service = new PlanForkStaleService({
    repoRoot: repo.root,
    store,
    planProvider,
    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
  })

  return {
    repo,
    store,
    rawDb,
    service,
    planProvider,
    policy,
    ctx: (wsId = 'WS-1') => ({
      policy,
      plan: planProvider.load(wsId),
      schemas,
      baseCapturer: THROWS_BASE_CAPTURER,
      triggerRefResolver: triggers,
      formalRunLookup: runs,
      now: clock,
    }),
    close: async () => {
      rawDb.close()
      coreStore.close()
      await repo.dispose()
    },
  }
}

/**
 * Assert that `fn` REJECTS and the caught error satisfies `check`
 * (vitest's `toThrowError` takes string/regex/class, not a function matcher).
 */
export async function assertRejects(fn: () => Promise<unknown>, check: (e: unknown) => void): Promise<void> {
  let caught: unknown
  let rejected = false
  try {
    await fn()
  } catch (e) {
    rejected = true
    caught = e
  }
  if (!rejected) throw new Error('assertRejects: expected a rejection, but the promise resolved')
  check(caught)
}

/**
 * Create one OPEN PF through the SERVICE (real git base capture + 八步 chain
 * + store). Defaults to the §11 example (fork G-1 / merge G-2 / F-31 / R-81).
 */
export async function createPf(h: StaleHarness, patch: Parameters<typeof makeParams>[0] = {}): Promise<PlanForkRecord> {
  return h.service.createPlanFork(makeParams(patch), h.ctx())
}

/** The base tree's WS-1 canonical order (§11 初始 canonical). */
export { WS1_CANONICAL }
