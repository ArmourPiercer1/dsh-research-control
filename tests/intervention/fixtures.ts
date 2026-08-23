/**
 * WP-5.1 test infrastructure (tests/intervention/).
 *
 * 每个 service 级测试开一个真实 research.sqlite（mkdtemp 一次性目录, 同
 * WP-3.5 flooding fixtures 纪律）:
 *   1. WP-2.1 `openDatabase`（经 flooding `openFloodingDatabase` — 文件
 *      init/WAL/user_version 门）— 事件 append 连接（`store`）;
 *   2. 第二连接（`openFloodingDatabase` 适配为 `FloodingDb`）— intervention
 *      表（WP-3.5 DDL 幂等应用）+ 本 WP 生命周期 store;
 *   3. 全部端口用**真实冻结面**:
 *      - 事件 registry = 真实冻结 `schema/history` 目录（WP-2.2 装载 —
 *        INTERVENTION_CREATED 的 E 列矩阵 / owner 规则 / CROSS_FIELD 全真）;
 *      - intervention 形状网 = 真实冻结 `schema/operational/attention.schema.json`;
 *      - id allocator = 真实 `IdAllocator`（InMemoryMetaStore 计数器后端）;
 *      - 声明式快照 = WS-1/WS-2（REALIZED）+ R-1/R-2（RUNNING）Run 缝。
 *
 * 时钟 = 单一共享单调时钟（每调用 +1ms）— 行 created_at 与事件
 * occurredAt 同源（service 单次采样纪律）, 顺序断言即真实顺序。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

import { IdAllocator } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import { loadHistoryEventRegistry } from '../../src/host/history/registry/index.js'
import type { HistoryEventRegistry, RunSnapshot, WorkstreamSnapshot } from '../../src/host/history/registry/index.js'
import {
  InterventionStore,
  loadInterventionSchemas,
  openFloodingDatabase,
  type FloodingDatabase,
  type FloodingDb,
  type InterventionSchemas,
} from '../../src/host/service/flooding/index.js'
import {
  InterventionLifecycleStore,
  InterventionService,
  isInterventionError,
  type InterventionError,
  type InterventionErrorCode,
  type InterventionExternalState,
} from '../../src/host/service/intervention/index.js'
import {
  MEM_OPERATIONAL_SCHEMA_DIR,
  realOperationalSchemaFiles,
} from '../planfork/fixtures.js'
import { WR_ROOT } from '../loader/fixtures.js'
import { MemoryReader } from '../loader/memory-reader.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The real frozen history schema dir（registry 源 — 只读契约）。 */
export const WR_HISTORY_SCHEMA_DIR = join(WR_ROOT, 'schema', 'history')

/** fs-backed schema reader（测试可 I/O — 同 tests/runbinding/helpers）。 */
export class FsReader {
  readFile(path: string): string | null {
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return readFileSync(path, 'utf8')
  }
}

/* ------------------------------------------------------------------ *
 * Temp dirs（afterAll 清理 — 同 tests/store 纪律）
 * ------------------------------------------------------------------ */

const roots: string[] = []

export function makeTempDir(prefix = 'wp51-iv-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ *
 * The harness
 * ------------------------------------------------------------------ */

export interface InterventionHarness {
  readonly dir: string
  /** WP-2.1 store + 第二连接（intervention 表, WP-3.5 DDL）。 */
  readonly dbPair: FloodingDatabase
  /** raw 第二连接（负例 / 触发器 / 并发探针用）。 */
  readonly raw: import('node:sqlite').DatabaseSync
  readonly interventions: InterventionStore
  readonly lifecycle: InterventionLifecycleStore
  readonly schemas: InterventionSchemas
  readonly registry: HistoryEventRegistry
  readonly allocator: IdAllocator
  /** 声明式 + Run 快照缝（测试可增删 WS/Run 模拟声明式侧状态）。 */
  readonly external: InterventionExternalState
  readonly service: InterventionService
  /** 单一共享单调时钟（每调用 +1ms）。 */
  readonly now: () => number
  close(): void
}

export function makeInterventionHarness(): InterventionHarness {
  const dir = makeTempDir()
  const dbPair = openFloodingDatabase(join(dir, 'research.sqlite'))
  const rawDb = new DatabaseSync(resolve(join(dir, 'research.sqlite')))
  rawDb.exec('PRAGMA busy_timeout = 5000')

  const opReader = new MemoryReader(realOperationalSchemaFiles())
  const schemas = loadInterventionSchemas(opReader, MEM_OPERATIONAL_SCHEMA_DIR)
  if (!schemas.isUsable) {
    throw new Error(`harness: intervention schemas unavailable: ${schemas.loadErrors.map((e) => `${e.path}: ${e.message}`).join(' | ')}`)
  }
  const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)
  if (!registry.isUsable) {
    throw new Error(`harness: event registry unusable: ${registry.loadErrors.map((e) => e.message).join('; ')}`)
  }

  const clockState = { t: 1_700_000_000_000 }
  const now = (): number => {
    clockState.t += 1
    return clockState.t
  }

  const interventions = new InterventionStore({ db: dbPair.db, schemas })
  const lifecycle = new InterventionLifecycleStore({ db: dbPair.db, interventions })
  const allocator = new IdAllocator(new InMemoryMetaStore())

  const external: InterventionExternalState = {
    workstreams: new Map<string, WorkstreamSnapshot>([
      ['WS-1', { topicId: 'TPC-1', lifecycle: 'REALIZED' }],
      ['WS-2', { topicId: 'TPC-1', lifecycle: 'REALIZED' }],
    ]),
    runs: new Map<string, RunSnapshot>([
      ['R-1', { workstreamId: 'WS-1', status: 'RUNNING' }],
      ['R-2', { workstreamId: 'WS-2', status: 'RUNNING' }],
    ]),
  }

  const service = new InterventionService({
    store: dbPair.store,
    registry,
    lifecycle,
    allocator,
    projectId: 'PRJ-1',
    externalState: () => external,
    now,
  })

  return {
    dir,
    dbPair,
    raw: rawDb,
    interventions,
    lifecycle,
    schemas,
    registry,
    allocator,
    external,
    service,
    now,
    close() {
      try {
        rawDb.close()
      } catch {
        /* idempotent */
      }
      dbPair.close()
    },
  }
}

/* ------------------------------------------------------------------ *
 * 断言助手（同 WP-3.5 throwsFlooding 纪律 — vitest toThrowError 不收
 * 函数谓词, 集中 code 级断言, 返回抛出错误供进一步断言）
 * ------------------------------------------------------------------ */

/** 期望 `fn` 抛 `InterventionError`（code 匹配, 可选消息正则）; 返回该错误。 */
export function throwsIntervention(fn: () => unknown, code: InterventionErrorCode, msgPattern?: RegExp): InterventionError {
  try {
    fn()
  } catch (e) {
    if (!isInterventionError(e) || e.code !== code) {
      throw new Error(`expected InterventionError(code=${code}), got ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
    }
    if (msgPattern !== undefined && !msgPattern.test(e.message)) {
      throw new Error(`expected message to match ${msgPattern}, got: ${e.message}`)
    }
    return e
  }
  throw new Error(`expected InterventionError(code=${code}) but nothing was thrown`)
}
