/**
 * WP-3.4 test infrastructure — REAL end-to-end harness（同 tests/stale 纪律）：
 *
 *   - REAL temp git repo（tests/git `makeTempRepo`, 每 harness 独立 mkdtemp,
 *     afterAll 销毁 — TEST_MATRIX §5.1）+ REAL declarative 树
 *     （`baseTreeFiles` — WS-1 §11 canonical G-1,T-1,T-2,T-3,M-1,T-4,G-2
 *     + 7 定义文件 + policy; 自定义 tree 支持跨 WS 用例）;
 *   - REAL operational sqlite（WP-2.1 `openDatabase` 封装 + **双连接**
 *     WAL 模式: store 连接 + select-service 连接 — WP-3.1 persist 模式;
 *     select-service 连接经**故障注入 facade** — DB 事务失败 / plan.yaml
 *     写失败 / 补偿恢复失败 三缝）;
 *   - REAL `PlanForkStore`（共享 IdAllocator — InMemoryMetaStore 可复制,
 *     支撑 restart 模拟的计数器连续性 — 生产 sqlite meta 的测试等价物）;
 *   - REAL canonical plan 加载（WP-1.3 `PlanStore.loadPlan` 经
 *     `makeFsPlanProvider` — 同 stale harness）;
 *   - REAL frozen schemas（operational + declarative）+ REAL §9 policy;
 *   - `PlanForkStaleService`（生产创建路径 — 真实 git base 捕获）+
 *     `PlanForkSelectService`（被测对象, 与 stale service 共享 store 面）。
 *
 * 每个测试开自己的 harness（独立 repo + DB）, close 释放 — 无跨测试共享态。
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

import { openDatabase } from '../../src/host/persistence/store/index.js'
import { IdAllocator } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import {
  loadPlanForkPolicy,
  loadPlanForkSchemas,
  PlanForkStore,
  type AgentPlanForkPolicy,
  type CanonicalPlanProvider,
  type PlanForkCreationContext,
  type PlanForkDb,
  type PlanForkRecord,
  type PlanForkSchemas,
} from '../../src/host/domain/planfork/index.js'
import { FsResearchReader } from '../../src/host/service/checkpoint/fs-reader.js'
import { FsPlanFileWriter } from '../../src/host/service/fs/index.js'
import { PlanForkStaleService } from '../../src/host/service/stale/index.js'
import { PlanForkSelectService } from '../../src/host/service/select/index.js'
import { type PlanFileWriter } from '../../src/host/domain/plan/index.js'
import { makeTempRepo, type TempRepo } from '../git/temp-repo.js'
import { WR_SCHEMA_DIR } from '../loader/fixtures.js'
import { MemoryReader } from '../loader/memory-reader.js'
import {
  MEM_OPERATIONAL_SCHEMA_DIR,
  makeParams,
  makeRunLookup,
  makeTriggerResolver,
  realOperationalSchemaFiles,
  T_CREATE,
} from '../planfork/fixtures.js'
import {
  adaptDatabaseSync,
  makeFsPlanProvider,
  RESEARCH_TREE,
  seedResearchTree,
  type StaleHarnessOptions,
} from '../stale/harness.js'

const roots: string[] = []

export function makeSelectTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wp34-select-'))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ *
 * 故障注入 facade（补偿协议测试缝 — 只作用于 select-service 连接/写器）
 * ------------------------------------------------------------------ */

/**
 * DB 事务注入缝：前 N 次 `transaction` 调用直接回滚 + 抛错（其余透传）。
 * `raceHook` 在第**一**次 `transaction` 调用开始处（工作体执行前）恰运行一
 * 次 — 模拟并发写者在「服务读取 others 列表之后、SELECT 事务开始之前」
 * 窗口提交的迁移（乐观门 0 行竞争 — SELECT_CONCURRENT_STATE 测试缝）。
 */
export function makeFailingDbAdapter(
  rawDb: DatabaseSync,
  transactionFailures: number,
  raceHook?: (raw: DatabaseSync) => void,
): PlanForkDb {
  const base = adaptDatabaseSync(rawDb)
  let remaining = transactionFailures
  let raced = false
  return {
    exec: (sql) => base.exec(sql),
    run: (sql, ...params) => base.run(sql, ...params),
    get: (sql, ...params) => base.get(sql, ...params),
    all: (sql, ...params) => base.all(sql, ...params),
    transaction: <T>(work: () => T): T => {
      if (!raced && raceHook !== undefined) {
        raced = true
        raceHook(rawDb)
      }
      if (remaining > 0) {
        remaining -= 1
        try {
          base.exec('BEGIN IMMEDIATE')
        } catch {
          /* a busy lock may already be held by the caller */
        }
        try {
          base.exec('ROLLBACK')
        } catch {
          /* nothing was open */
        }
        throw new Error(`harness: injected SELECTED-transaction failure (${remaining} more pending)`)
      }
      return base.transaction(work)
    },
  }
}

/** plan.yaml 写注入缝：前 N 次 plan.yaml 写抛错（定义文件写不受影响）。 */
export function makeFailingPlanWriter(real: PlanFileWriter, planYamlFailures: number): PlanFileWriter {
  let remaining = planYamlFailures
  return {
    writeAtomic(path: string, content: string): void {
      if (remaining > 0 && path.endsWith('plan.yaml')) {
        remaining -= 1
        throw new Error(`harness: injected plan.yaml write failure (${remaining} more pending)`)
      }
      real.writeAtomic(path, content)
    },
  }
}

/**
 * 补偿恢复注入缝：第一次 plan.yaml 写（物化）成功后, 第二次（补偿恢复旧
 * 内容）抛错 — 仅 `failRestore = true` 时生效（补偿失败测试缝）。
 */
export function makeRestoreFailingPlanWriter(real: PlanFileWriter, failRestore: boolean): PlanFileWriter {
  let planWrites = 0
  return {
    writeAtomic(path: string, content: string): void {
      if (path.endsWith('plan.yaml')) {
        planWrites += 1
        if (failRestore && planWrites >= 2) {
          throw new Error('harness: injected plan.yaml RESTORE failure (compensation path)')
        }
      }
      real.writeAtomic(path, content)
    },
  }
}

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

export interface SelectHarnessOptions extends StaleHarnessOptions {
  /** 前 N 次 select-service 的 `db.transaction` 注入失败（0 = 从不）。 */
  readonly dbTransactionFailures?: number
  /** 前 N 次 plan.yaml 写（物化）注入失败（0 = 从不）。 */
  readonly planWriteFailures?: number
  /** 物化写成功后的补偿恢复写注入失败（补偿失败测试缝）。 */
  readonly failCompensationRestore?: boolean
  /**
   * 并发竞争缝：第一次 `db.transaction` 开始处（工作体前）运行一次的
   * hook（直接操作 select-service 的原始连接 — 模拟并发写者的已提交
   * 迁移落在 others 读取与事务开始之间）。
   */
  readonly raceBeforeTransaction?: (raw: import('node:sqlite').DatabaseSync) => void
}

export interface SelectHarness {
  /** The temp git repo (write/read/git/head/dispose). */
  readonly repo: TempRepo
  /** sqlite 文件路径（restart 重开用）。 */
  readonly sqlitePath: string
  /** The REAL PlanForkStore（store 连接）. */
  readonly store: PlanForkStore
  /** store 连接的 raw DatabaseSync（ledger 检查用）。 */
  readonly rawDb: DatabaseSync
  /** select-service 连接的 raw DatabaseSync。 */
  readonly selectRawDb: DatabaseSync
  /** 共享 IdAllocator（MA 家族 — restart 时 meta 复制）。 */
  readonly allocator: IdAllocator
  /** allocator 的 meta（restart 复制源）。 */
  readonly metaStore: InMemoryMetaStore
  /** 确定性单调钟（T_CREATE 起, +1s/tick — store/service/ctx 共享）。 */
  readonly clock: () => number
  readonly planProvider: CanonicalPlanProvider
  readonly policy: AgentPlanForkPolicy
  /** §4 步骤 8 formal run 假件（测试可 `runs.set('R-90', {...})` 扩种）。 */
  readonly runLookup: ReturnType<typeof makeRunLookup>
  /** §4 步骤 6 trigger ref 假件（测试可 `refs.add('FACT:F-90')` 扩种）。 */
  readonly triggerResolver: ReturnType<typeof makeTriggerResolver>
  /** 生产创建路径（真实 git base 捕获 + 八步链）。 */
  readonly staleService: PlanForkStaleService
  /** 被测对象。 */
  readonly selectService: PlanForkSelectService
  /** 装配 §4 创建上下文。 */
  ctx(wsId?: string): PlanForkCreationContext
  /**
   * 重启模拟：关闭两条 DB 连接, 对同一 sqlite 文件 + 同一 repo 文件重开
   * （新 store + 新 select service; allocator meta 全量复制 — 生产
   * sqlite meta 持久化的测试等价物; 故障注入缝复位为健康）。
   */
  restart(): Promise<SelectHarness>
  close(): Promise<void>
}

async function buildHarness(
  repo: TempRepo,
  sqlitePath: string,
  options: SelectHarnessOptions,
  reuse?: { allocator: IdAllocator; metaStore: InMemoryMetaStore; clock: () => number },
): Promise<SelectHarness> {
  const coreStore = openDatabase(sqlitePath) // 同一文件（已存在 — WAL 重开; 首建在调用方）

  const rawDb = new DatabaseSync(sqlitePath)
  rawDb.exec('PRAGMA busy_timeout = 5000')
  const selectRawDb = new DatabaseSync(sqlitePath)
  selectRawDb.exec('PRAGMA busy_timeout = 5000')

  const metaStore = reuse?.metaStore ?? new InMemoryMetaStore()
  const allocator = reuse?.allocator ?? new IdAllocator(metaStore)
  const clock = reuse?.clock ?? makeClock()

  const dbFacade = makeFailingDbAdapter(selectRawDb, options.dbTransactionFailures ?? 0, options.raceBeforeTransaction)
  const store = new PlanForkStore({ db: adaptDatabaseSync(rawDb), allocator, projectId: 'PRJ-1', now: clock })

  const planProvider = makeFsPlanProvider(repo.root)
  const researchRoot = join(repo.root, '.research')
  const policyResult = loadPlanForkPolicy(new FsResearchReader(researchRoot), researchRoot, WR_SCHEMA_DIR)
  if (policyResult.policy === null) {
    rawDb.close()
    selectRawDb.close()
    coreStore.close()
    await repo.dispose()
    throw new Error(`select harness: policy failed to load: ${policyResult.errors.map((e) => e.message).join(' | ')}`)
  }
  const policy = policyResult.policy

  const opReader = new MemoryReader(realOperationalSchemaFiles())
  const schemas: PlanForkSchemas = loadPlanForkSchemas(opReader, MEM_OPERATIONAL_SCHEMA_DIR)
  if (!schemas.isUsable) {
    rawDb.close()
    selectRawDb.close()
    coreStore.close()
    await repo.dispose()
    throw new Error(`select harness: operational schemas unavailable: ${schemas.loadErrors.map((e) => `${e.path}: ${e.message}`).join(' | ')}`)
  }

  const runs = makeRunLookup()
  const triggers = makeTriggerResolver()

  const staleService = new PlanForkStaleService({ repoRoot: repo.root, store, planProvider })

  const realWriter = new FsPlanFileWriter()
  const writer: PlanFileWriter =
    (options.planWriteFailures ?? 0) > 0
      ? makeFailingPlanWriter(realWriter, options.planWriteFailures ?? 0)
      : options.failCompensationRestore
        ? makeRestoreFailingPlanWriter(realWriter, true)
        : realWriter

  const selectService = new PlanForkSelectService({
    repoRoot: repo.root,
    store,
    db: dbFacade,
    allocator,
    projectId: 'PRJ-1',
    planProvider,
    reader: new FsResearchReader(researchRoot),
    writer,
    schemaDir: WR_SCHEMA_DIR,
    now: clock,
  })

  return {
    repo,
    sqlitePath,
    store,
    rawDb,
    selectRawDb,
    allocator,
    metaStore,
    clock,
    planProvider,
    policy,
    runLookup: runs,
    triggerResolver: triggers,
    staleService,
    selectService,
    ctx: (wsId = 'WS-1') => ({
      policy,
      plan: planProvider.load(wsId),
      schemas,
      baseCapturer: THROWS_BASE_CAPTURER,
      triggerRefResolver: triggers,
      formalRunLookup: runs,
      now: clock,
    }),
    restart: async () => {
      rawDb.close()
      selectRawDb.close()
      coreStore.close()
      // 同一 sqlite 文件重开（restart）— 健康缝（注入缝不复位携带）。
      return buildHarness(repo, sqlitePath, { committed: options.committed ?? true }, { allocator, metaStore, clock })
    },
    close: async () => {
      rawDb.close()
      selectRawDb.close()
      coreStore.close()
      await repo.dispose()
    },
  }
}

let clockSeq = 0
function makeClock(): () => number {
  clockSeq += 1
  const seq = clockSeq
  let tick = 0
  return () => T_CREATE + seq * 1_000_000 + ++tick * 1000
}

/** A step-3 capturer stub that MUST be replaced by the stale service (fail loud if not). */
const THROWS_BASE_CAPTURER: import('../../src/host/domain/planfork/index.js').ClosureBlobCapturer = {
  capture(): import('../../src/host/domain/planfork/index.js').ClosureBlobBase {
    throw new Error('harness: baseCapturer stub must be replaced by PlanForkStaleService.createPlanFork')
  },
}

/** Open one fully-real select harness（fresh temp repo + fresh sqlite per call）。 */
export async function openSelectHarness(options: SelectHarnessOptions = {}): Promise<SelectHarness> {
  const repo = await makeTempRepo({ seedResearch: false })
  await seedResearchTree(repo, options.committed ?? true, options.tree ?? RESEARCH_TREE)
  const sqlitePath = join(makeSelectTempDir(), 'research.sqlite')
  return buildHarness(repo, sqlitePath, options)
}

/** 经 stale service 创建一个 OPEN PF（真实 git base 捕获 + 八步链 — 默认 §11 参数, WS-1）。 */
export async function createPf(h: SelectHarness, patch: Parameters<typeof makeParams>[0] = {}): Promise<PlanForkRecord> {
  const params = makeParams(patch)
  return h.staleService.createPlanFork(params, h.ctx(params.workstreamId))
}

/** vitest `toThrowError` 不接函数匹配器 — 断言拒绝 + 检查（同 stale harness）。 */
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

export { RESEARCH_TREE, adaptDatabaseSync }
