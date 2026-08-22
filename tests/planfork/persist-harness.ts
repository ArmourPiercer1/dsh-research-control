/**
 * WP-3.1 persist harness — REAL research.sqlite (the DatabaseSync 封装
 * 模式端到端实证):
 *
 *   1. WP-2.1 `openDatabase` 先行 (文件 init: 0o700/0o600, WAL,
 *      user_version 门, quick_check — 核心三表 DDL);
 *   2. 本 harness 开第二 `DatabaseSync` 连接 (同文件, busy_timeout),
 *      适配为域层 `PlanForkDb` 结构端口 (run/get/all 参数化 + BEGIN
 *      IMMEDIATE 事务) — 与 WP-2.4 runbinding tables 的双连接模式同型;
 *   3. `PlanForkStore` 构造时幂等 DDL (plan_fork + management_action)。
 *
 * 每个测试 = 一个 tmp 目录 (os.tmpdir/mkdtemp, afterAll 递归删除 —
 * tests/store 同款纪律)。
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

import { openDatabase } from '../../src/host/persistence/store/index.js'
import { IdAllocator } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import { PlanForkStore, type PlanForkDb } from '../../src/host/domain/planfork/index.js'
import { loadPlanForkSchemas, loadPlanForkPolicy, type PlanForkCreationContext } from '../../src/host/domain/planfork/index.js'
import {
  MEM_OPERATIONAL_SCHEMA_DIR,
  MEM_RESEARCH_ROOT,
  MEM_SCHEMA_DIR,
  T_CREATE,
  baseTreeFiles,
  makeCanonicalPlanProvider,
  makeHashingCapturer,
  makeReader,
  makeRunLookup,
  makeTriggerResolver,
  realOperationalSchemaFiles,
} from './fixtures.js'
import { MemoryReader } from '../loader/memory-reader.js'

const roots: string[] = []

export function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wp31-pf-'))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** Adapt a real node:sqlite DatabaseSync to the domain PlanForkDb port. */
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

export interface PersistHarness {
  /** The temp dir holding research.sqlite (and its -wal/-shm). */
  readonly dir: string
  /** The WP-2.1 store connection (core three tables; closed by close()). */
  readonly coreStore: ReturnType<typeof openDatabase>
  /** The second-connection PlanForkStore (plan_fork + management_action). */
  readonly store: PlanForkStore
  /** The underlying second connection (raw SQL 负例用). */
  readonly rawDb: DatabaseSync
  /** The declarative tree the harness loaded (mutation surface). */
  readonly reader: MemoryReader
  /** A second PlanForkStore over a THIRD connection of the SAME file. */
  secondStore(): PlanForkStore
  /** Assemble the §4 creation context (fresh canonical plan view). */
  ctx(): PlanForkCreationContext
  close(): void
}

/** The declarative tree the persist harness shares (base tree, WS-1 §11). */
export const PERSIST_TREE_FILES = baseTreeFiles()

/** Open the full real-sqlite harness (fresh temp DB per call). */
export function openStore(): PersistHarness {
  const dir = makeTempDir()
  const coreStore = openDatabase(join(dir, 'research.sqlite'))
  const rawDb = new DatabaseSync(join(dir, 'research.sqlite'))
  rawDb.exec('PRAGMA busy_timeout = 5000')

  // ONE shared monotonic clock for store `now` AND ctx `now` — a real clock
  // never goes backwards, and ledger order (occurred_at) must follow it.
  let tick = 0
  const clock = () => T_CREATE + ++tick * 1000

  const allocator = new IdAllocator(new InMemoryMetaStore())
  const store = new PlanForkStore({ db: adaptDatabaseSync(rawDb), allocator, projectId: 'PRJ-1', now: clock })

  const reader = makeReader(PERSIST_TREE_FILES)
  const opReader = new MemoryReader(realOperationalSchemaFiles())
  const schemas = loadPlanForkSchemas(opReader, MEM_OPERATIONAL_SCHEMA_DIR)
  if (!schemas.isUsable) throw new Error(`persist harness: schemas unavailable: ${schemas.loadErrors.map((e) => `${e.path}: ${e.message}`).join(' | ')}`)
  const policyResult = loadPlanForkPolicy(reader, MEM_RESEARCH_ROOT, MEM_SCHEMA_DIR)
  if (policyResult.policy === null) throw new Error(`persist harness: policy unavailable: ${policyResult.errors.map((e) => e.message).join(' | ')}`)
  const planProvider = makeCanonicalPlanProvider(reader)
  const capturer = makeHashingCapturer(reader)
  const runs = makeRunLookup()
  const triggers = makeTriggerResolver()

  return {
    dir,
    coreStore,
    store,
    rawDb,
    reader,
    secondStore: () => {
      const raw2 = new DatabaseSync(join(dir, 'research.sqlite'))
      raw2.exec('PRAGMA busy_timeout = 5000')
      return new PlanForkStore({ db: adaptDatabaseSync(raw2), allocator, projectId: 'PRJ-1', now: clock })
    },
    ctx: () => ({
      policy: policyResult.policy!,
      plan: planProvider.load('WS-1'),
      schemas,
      baseCapturer: capturer,
      triggerRefResolver: triggers,
      formalRunLookup: runs,
      now: clock,
    }),
    close: () => {
      rawDb.close()
      coreStore.close()
    },
  }
}
