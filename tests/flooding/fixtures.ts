/**
 * WP-3.5 test infrastructure (tests/flooding/).
 *
 * Every service-level test opens a REAL research.sqlite in a throwaway
 * directory (mkdtemp under os.tmpdir):
 *   1. WP-2.1 `openDatabase` (via `openFloodingDatabase` — file init/WAL/
 *      user_version 门) — 事件 append 连接;
 *   2. 第二连接（`openFloodingDatabase` 适配为 `FloodingDb`）— intervention
 *      表（本 WP DDL, 幂等）;
 *   3. 第三连接 — WP-3.1 `PlanForkStore`（plan_fork + management_action）,
 *      与生产多连接现实同型（WAL 共存, 文件锁串行化）。
 *
 * 全部端口假用**真实冻结面**:
 *   - 事件 registry = 真实冻结 `schema/history` 目录（WP-2.2 装载, 逐字
 *     INTERVENTION_CREATED 分支）;
 *   - intervention 形状网 = 真实冻结 `schema/operational/attention.schema.json`;
 *   - policy = 真实冻结 `schema/declarative/agent-plan-fork-policy.schema.json`
 *     校验的真实 policy 文件（base tree 的 byte-exact §9 例 — threshold 5;
 *     自定义阈值经 `policyYaml` 注入; 文件缺失 = §8 默认）;
 *   - PF 创建 = 真实 WP-3.1 八步链（WP-3.1 fixtures: 真实 PlanStore canonical
 *     加载 + 哈希 capturer + §11 种子 run/trigger）。
 *
 * 时钟 = 单一共享单调时钟（PlanForkStore.now / ctx.now / service.now 同源 —
 * 事件 occurredAt 与行 created_at 顺序即真实顺序, 同 WP-3.1 harness 纪律）。
 */

import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterAll } from 'vitest'

import { IdAllocator } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import { loadHistoryEventRegistry } from '../../src/host/history/registry/index.js'
import type { HistoryEventRegistry, WorkstreamSnapshot } from '../../src/host/history/registry/index.js'
import { PlanForkStore } from '../../src/host/domain/planfork/index.js'
import type { PlanForkCreationContext, PlanForkRecord } from '../../src/host/domain/planfork/index.js'
import {
  FloodingService,
  InterventionStore,
  loadInterventionSchemas,
  openFloodingDatabase,
  type FloodingDatabase,
  type FloodingDb,
  type InterventionSchemas,
} from '../../src/host/service/flooding/index.js'

export { openFloodingDatabase } from '../../src/host/service/flooding/index.js'
import {
  baseTreeFiles,
  keep,
  makeParams,
  makeReader,
  newTask,
  realOperationalSchemaFiles,
  MEM_OPERATIONAL_SCHEMA_DIR,
  MEM_RESEARCH_ROOT,
  MEM_SCHEMA_DIR,
  T_CREATE,
  makeHarness,
  type PlanForkHarness,
} from '../planfork/fixtures.js'
import { WR_ROOT } from '../loader/fixtures.js'
import { MemoryReader } from '../loader/memory-reader.js'
import { isFloodingError, type FloodingError, type FloodingErrorCode } from '../../src/host/service/flooding/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The real frozen history schema dir（registry 源 — 只读契约）. */
export const WR_HISTORY_SCHEMA_DIR = join(WR_ROOT, 'schema', 'history')

/** fs-backed schema reader（测试可 I/O — 同 tests/runbinding/helpers）. */
export class FsReader {
  readFile(path: string): string | null {
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return readFileSync(path, 'utf8')
  }
}

/* ------------------------------------------------------------------ *
 * Temp dirs (afterAll cleanup — tests/store 同款纪律)
 * ------------------------------------------------------------------ */

const roots: string[] = []

export function makeTempDir(prefix = 'wp35-flood-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ *
 * WS-2 canonical plan（跨 WS 独立计数的真实第二 WS — base tree 的
 * WS-2 无 plan.yaml, 这里补一个最小合法 canonical + 3 定义文件;
 * item id 与 WS-1 不重叠 — 项目内 id 唯一）
 * ------------------------------------------------------------------ */

export const WS2_PLAN_YAML = `workstream: WS-2
ordered_items: [G-3, T-5, G-4]
`
export const WS2_G3_YAML = `id: G-3
workstream_id: WS-2
title: WS-2 数据就绪评审
criteria: WS-2 数据集完整、标注规范且可复现
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:40:00Z
`
export const WS2_T5_YAML = `id: T-5
workstream_id: WS-2
title: WS-2 候选实现
goal: WS-2 标定采集实现
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:41:00Z
`
export const WS2_G4_YAML = `id: G-4
workstream_id: WS-2
title: WS-2 合并评审
criteria: WS-2 对比数据完整
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:42:00Z
`

/** base tree + WS-2 canonical plan（3 定义文件）. */
export function ws2TreeFiles(policyYaml?: string): Record<string, string> {
  const files: Record<string, string> = {
    ...baseTreeFiles(),
    'topics/TPC-1/workstreams/WS-2/plan.yaml': WS2_PLAN_YAML,
    'topics/TPC-1/workstreams/WS-2/items/gates/G-3.yaml': WS2_G3_YAML,
    'topics/TPC-1/workstreams/WS-2/items/tasks/T-5.yaml': WS2_T5_YAML,
    'topics/TPC-1/workstreams/WS-2/items/gates/G-4.yaml': WS2_G4_YAML,
  }
  if (policyYaml !== undefined) files['policies/agent-plan-fork.yaml'] = policyYaml
  return files
}

/* ------------------------------------------------------------------ *
 * Adapt a real node:sqlite DatabaseSync to the FloodingDb port
 * （同 tests/planfork/persist-harness.adaptDatabaseSync）
 * ------------------------------------------------------------------ */

export function adaptDatabaseSync(db: DatabaseSync): FloodingDb {
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

/* ------------------------------------------------------------------ *
 * The harness
 * ------------------------------------------------------------------ */

export interface FloodingHarnessOptions {
  /** `.research` 文件树（默认 = base tree + WS-2 plan; policy 文件可经
   *  `policyYaml` 覆盖 / 经 `files` 整体替换 / 从 files 中移除 = §8 默认）。 */
  readonly files?: Record<string, string>
  /** 覆盖 `policies/agent-plan-fork.yaml`（如 `flooding.threshold: 2`）。 */
  readonly policyYaml?: string
}

export interface FloodingHarness {
  readonly dir: string
  /** WP-2.1 store + 第二连接（intervention 表）。 */
  readonly dbPair: FloodingDatabase
  /** 第三连接 raw（负例 / 状态缓存列 raw UPDATE 面用）。 */
  readonly rawPf: DatabaseSync
  readonly pfDb: FloodingDb
  readonly planForks: PlanForkStore
  readonly interventions: InterventionStore
  readonly schemas: InterventionSchemas
  readonly registry: HistoryEventRegistry
  readonly allocator: IdAllocator
  readonly external: { workstreams: Map<string, WorkstreamSnapshot> }
  readonly service: FloodingService
  /** 声明式文件树（测试侧构造坏 policy reader 用）。 */
  readonly files: Record<string, string>
  /** WP-3.1 纯创建 harness（policy/canonical/capturer/runs/triggers 同源）。 */
  readonly pf: PlanForkHarness
  readonly now: () => number
  /** 经真实 §4 八步链创建 n 个 OPEN PF（默认 WS-1; WS-2 用其 R-82 run）。 */
  createPfs(n: number, ws?: 'WS-1' | 'WS-2'): PlanForkRecord[]
  close(): void
}

export function makeFloodingHarness(options: FloodingHarnessOptions = {}): FloodingHarness {
  const files = options.files ?? ws2TreeFiles(options.policyYaml)
  const dir = makeTempDir()
  const dbPair = openFloodingDatabase(join(dir, 'research.sqlite'))
  const rawPf = new DatabaseSync(join(dir, 'research.sqlite'))
  rawPf.exec('PRAGMA busy_timeout = 5000')
  const pfDb = adaptDatabaseSync(rawPf)

  const opReader = new MemoryReader(realOperationalSchemaFiles())
  const schemas = loadInterventionSchemas(opReader, MEM_OPERATIONAL_SCHEMA_DIR)
  if (!schemas.isUsable) {
    throw new Error(`harness: intervention schemas unavailable: ${schemas.loadErrors.map((e) => `${e.path}: ${e.message}`).join(' | ')}`)
  }
  const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)
  if (!registry.isUsable) {
    throw new Error(`harness: event registry unusable: ${registry.loadErrors.map((e) => e.message).join('; ')}`)
  }

  const pf = makeHarness(files)
  // WS-2 formal run（§11 种子同款: R-81→WS-1; R-82→WS-2 供跨 WS 创建）。
  pf.runs.runs.set('R-82', { id: 'R-82', workstream_id: 'WS-2', task_id: 'T-5' })

  const allocator = new IdAllocator(new InMemoryMetaStore())
  // 单一共享单调时钟（makeHarness 的 tick 时钟 T_CREATE + 1ms/call）:
  // PlanForkStore.now / ctx.now / service.now 同源 — PF 行 created_at 与
  // Intervention 行/事件时间戳的顺序即真实顺序（同 WP-3.1 harness 纪律）。
  const clock = pf.now

  const planForks = new PlanForkStore({ db: pfDb, allocator, projectId: 'PRJ-1', now: clock })
  const interventions = new InterventionStore({ db: dbPair.db, schemas })
  const external: { workstreams: Map<string, WorkstreamSnapshot> } = { workstreams: new Map() }
  external.workstreams.set('WS-1', { topicId: 'TPC-1', lifecycle: 'REALIZED' })
  external.workstreams.set('WS-2', { topicId: 'TPC-1', lifecycle: 'REALIZED' })

  const service = new FloodingService({
    store: dbPair.store,
    registry,
    planForks,
    interventions,
    allocator,
    projectId: 'PRJ-1',
    researchFileReader: pf.reader,
    researchRoot: MEM_RESEARCH_ROOT,
    schemaDir: MEM_SCHEMA_DIR,
    externalState: () => ({ workstreams: external.workstreams }),
    now: clock,
  })

  return {
    dir,
    files,
    dbPair,
    rawPf,
    pfDb,
    planForks,
    interventions,
    schemas,
    registry,
    allocator,
    external,
    service,
    pf,
    now: clock,
    createPfs(n, ws = 'WS-1') {
      const out: PlanForkRecord[] = []
      for (let i = 0; i < n; i++) {
        const params =
          ws === 'WS-1'
            ? makeParams()
            : makeParams({
                workstreamId: 'WS-2',
                forkAnchor: 'G-3',
                mergeAnchor: 'G-4',
                createdByRun: 'R-82',
                // KEEP ref 必须属于 WS-2 canonical（[G-3, T-5, G-4]）— 不混用 WS-1 项。
                proposedItems: [newTask({ title: '复算观测管线误差', goal: '重新推导 WS-2 观测管线误差预算' }), keep('T-5'), newTask({ title: 'WS-2 补充测量', goal: '对残余误差项补充测量实验' })],
              })
        const plan = pf.planProvider.load(ws)
        const ctx: PlanForkCreationContext = { ...pf.makeContext(), plan }
        out.push(planForks.createPlanFork(params, ctx))
      }
      return out
    },
    close() {
      rawPf.close()
      dbPair.close()
    },
  }
}

/* ------------------------------------------------------------------ *
 * Simulated user face（§13 迁移 = 仅用户 — 本 WP 无该面, 测试经
 * 状态缓存列的 raw UPDATE 面模拟用户关闭, 与未来用户面 WP 的合法
 * 行侧机制同位）
 * ------------------------------------------------------------------ */

/** 模拟用户关闭: status→CLOSED + closed_at（状态缓存列 raw UPDATE 面）。 */
export function simulateUserClose(raw: DatabaseSync, id: string, closedAt: number): void {
  raw.prepare(`UPDATE intervention SET status = 'CLOSED', closed_at = ? WHERE id = ?`).run(closedAt, id)
}

/* ------------------------------------------------------------------ *
 * 断言助手（vitest 4 的 toThrowError 不接受函数谓词 — 仓库约定 class /
 * regex 形态; 这里集中 code 级断言, 返回抛出错误供进一步断言）
 * ------------------------------------------------------------------ */

/** 期望 `fn` 抛 `FloodingError`（code 匹配, 可选消息正则）; 返回该错误。 */
export function throwsFlooding(fn: () => unknown, code: FloodingErrorCode, msgPattern?: RegExp): FloodingError {
  try {
    fn()
  } catch (e) {
    if (!isFloodingError(e) || e.code !== code) {
      throw new Error(`expected FloodingError(code=${code}), got ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
    }
    if (msgPattern !== undefined && !msgPattern.test(e.message)) {
      throw new Error(`expected message to match ${msgPattern}, got: ${e.message}`)
    }
    return e
  }
  throw new Error(`expected FloodingError(code=${code}) but nothing was thrown`)
}
