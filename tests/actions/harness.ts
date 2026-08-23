/**
 * WP-5.2 — actions 模块测试 harness:
 *
 *   1. REAL research.sqlite（WP-2.1 `openDatabase` 先行 + 第二
 *      `DatabaseSync` 连接适配为 `ActionsDb` — 同 planfork
 *      persist-harness 双连接模式; DDL/trigger 负例需要真实引擎）;
 *   2. 声明式侧 = 内存树（`baseTreeFiles` + REAL 冻结 schema —
 *      tests/loader/fixtures 复用）经 `MemoryReader`;
 *   3. writer = 内存面（记录每次 writeAtomic + 可注入失败）;
 *   4. 时钟 = 单调递增（T0 + n·1000ms — 同 planfork 纪律, 事件序/
 *      created_at 断言确定性）;
 *   5. run 存在性面 = 可注入 Set（§16.3 第 3 条 RUN 引用校验缝）。
 *
 * 每个 harness = 一个 tmp 目录（afterAll 递归删除 — tests/store 同款纪律）。
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

import { openDatabase } from '../../src/host/persistence/store/index.js'
import { planForkDdl } from '../../src/host/domain/planfork/index.js'
import { IdAllocator } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import {
  ActionsService,
  ActionsStore,
  SQL_TRANSITION_NEXT_ACTION,
  type ActorRef,
  type ActionsDb,
} from '../../src/host/service/actions/index.js'
import {
  MEM_RESEARCH_ROOT,
  MEM_SCHEMA_DIR,
  baseTreeFiles,
  makeReader,
} from '../loader/fixtures.js'
import type { MemoryReader } from '../loader/memory-reader.js'

/** The frozen USER actor（RPC 面转发形状 — 裸 kind, WP-3.4 先例）。 */
export const USER_ACTOR: ActorRef = { kind: 'USER' }
/** One AGENT actor（工具面形状 — run 绑定必填, INV-PERM 面）。 */
export const agentActor = (runId: string): ActorRef => ({ kind: 'AGENT', run_id: runId, label: 'agent-1' })
export const PLUGIN_ACTOR: ActorRef = { kind: 'PLUGIN' }
export const SYSTEM_ACTOR: ActorRef = { kind: 'SYSTEM' }

export const T0 = Date.parse('2026-08-23T10:00:00Z')

/** Adapt a real node:sqlite DatabaseSync to the ActionsDb port. */
export function adaptDatabaseSync(db: DatabaseSync): ActionsDb {
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

/** 内存 FS: reader 面（MemoryReader）+ writer 面（记录 + 失败注入）。 */
export interface MemFs {
  readonly reader: MemoryReader
  /** Every atomic write, in order（path = MEM_RESEARCH_ROOT 绝对面）。 */
  readonly writes: { path: string; content: string }[]
  readonly writer: { writeAtomic: (path: string, content: string) => void }
  /** Next write throws（一次性 — 文件阶段/补偿失败注入）。 */
  failNextWrite: () => void
  /** The next `n` writes succeed; the following one throws（补偿写注入: n=2）。 */
  failWriteAfter: (n: number) => void
  /** Next write succeeds but CORRUPTS the content（后置校验/补偿注入）。 */
  corruptNextWrite: () => void
  /** The content written to a path (absolute) or null. */
  content: (path: string) => string | null
}

export function makeMemFs(files: Record<string, string> = baseTreeFiles()): MemFs {
  const reader = makeReader(files)
  const writes: { path: string; content: string }[] = []
  let failNext = false
  let failAfter = -1
  let corruptNext = false
  return {
    reader,
    writes,
    writer: {
      writeAtomic(path: string, content: string): void {
        if (failAfter >= 0) {
          failAfter -= 1
          if (failAfter === -1) {
            failAfter = -2 // consumed
            throw new Error('injected write failure (test fault injection)')
          }
        }
        if (failNext) {
          failNext = false
          throw new Error('injected write failure (test fault injection)')
        }
        const finalContent = corruptNext ? 'corrupted-by-fault-injection\n' : content
        corruptNext = false
        writes.push({ path, content: finalContent })
        reader.addFile(path, finalContent)
      },
    },
    failNextWrite: () => {
      failNext = true
    },
    failWriteAfter: (n: number) => {
      failAfter = n
    },
    corruptNextWrite: () => {
      corruptNext = true
    },
    content: (path: string) => reader.readFile(path),
  }
}

export interface ActionsHarness {
  /** tmp dir holding research.sqlite（+ -wal/-shm）. */
  readonly dir: string
  /** The core-store connection（closed by close()）. */
  readonly coreStore: ReturnType<typeof openDatabase>
  /** The second raw connection（trigger 负例/直查用）. */
  readonly rawDb: DatabaseSync
  /** The ActionsStore（second-connection face）. */
  readonly store: ActionsStore
  /** The business service（store + memfs + 缝）. */
  readonly service: ActionsService
  readonly fs: MemFs
  /** RUN 存在性面（§16.3 第 3 条; 预置 R-1）。 */
  readonly runs: Set<string>
  /** The shared allocator（diagnostics / gap 断言）. */
  readonly allocator: IdAllocator
  /** Monotonic clock value（T0 + n·1000）. */
  readonly clock: { readonly value: () => number }
  /**
   * DB 层故障注入缝（PROMOTE 物化负例 — 第二连接制造真并发）:
   *  - `preemptBeforeDbTransaction(fn)` — 在 service 的 PROMOTE 事务
   *    BEGIN 之前执行 fn（一次性）: 典型 = 第二连接已提交的并发迁移,
   *    使事务内条件 UPDATE 落 0 行（PROMOTE_CONCURRENT 路径）;
   *  - `failTransitionOnce()` — 下一次 transition UPDATE 抛驱动错
   *    （一次性; PROMOTE_DB_FAILED 路径）。
   */
  readonly faults: {
    preemptBeforeDbTransaction: (fn: () => void) => void
    failTransitionOnce: () => void
  }
  /** A SECOND ActionsStore over a THIRD connection（并发负例）. */
  secondStore(): ActionsStore
  close(): void
}

const roots: string[] = []

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** Open the full real-sqlite + memfs harness（fresh temp DB per call）. */
export function openActionsHarness(files: Record<string, string> = baseTreeFiles()): ActionsHarness {
  const dir = mkdtempSync(join(tmpdir(), 'wp52-actions-'))
  roots.push(dir)
  const coreStore = openDatabase(join(dir, 'research.sqlite'))
  const rawDb = new DatabaseSync(join(dir, 'research.sqlite'))
  rawDb.exec('PRAGMA busy_timeout = 5000')

  // 生产同文件面: WP-3.1 planfork 模块同样在此文件上以 IF NOT EXISTS
  // 应用其 DDL（management_action 账本表 — 本 WP PROMOTE 账本写入面）。
  rawDb.exec(planForkDdl())

  const faultsState = { preempt: null as null | (() => void), failTransition: false }
  const baseAdapter = adaptDatabaseSync(rawDb)
  const faultAdapter: ActionsDb = {
    ...baseAdapter,
    run: (sql, ...params) => {
      if (sql === SQL_TRANSITION_NEXT_ACTION && faultsState.failTransition) {
        faultsState.failTransition = false
        throw new Error('injected driver failure on transition UPDATE (test fault injection)')
      }
      return baseAdapter.run(sql, ...params)
    },
    transaction: <T>(work: () => T): T => {
      if (faultsState.preempt !== null) {
        const fn = faultsState.preempt
        faultsState.preempt = null
        fn()
      }
      return baseAdapter.transaction(work)
    },
  }

  let tick = 0
  const now = () => T0 + ++tick * 1000
  const allocator = new IdAllocator(new InMemoryMetaStore())
  const store = new ActionsStore({ db: faultAdapter, allocator, projectId: 'PRJ-1', now })
  const fs = makeMemFs(files)
  const runs = new Set(['R-1'])
  const service = new ActionsService({
    store,
    reader: fs.reader,
    writer: fs.writer,
    researchRoot: MEM_RESEARCH_ROOT,
    schemaDir: MEM_SCHEMA_DIR,
    allocator,
    projectId: 'PRJ-1',
    db: faultAdapter,
    runExists: { exists: (runId) => runs.has(runId) },
    now,
  })

  return {
    dir,
    coreStore,
    rawDb,
    store,
    service,
    fs,
    runs,
    allocator,
    clock: { value: () => T0 + tick * 1000 },
    faults: {
      preemptBeforeDbTransaction: (fn) => {
        faultsState.preempt = fn
      },
      failTransitionOnce: () => {
        faultsState.failTransition = true
      },
    },
    secondStore: () => {
      const raw2 = new DatabaseSync(join(dir, 'research.sqlite'))
      raw2.exec('PRAGMA busy_timeout = 5000')
      return new ActionsStore({ db: adaptDatabaseSync(raw2), allocator, projectId: 'PRJ-1', now })
    },
    close: () => {
      rawDb.close()
      coreStore.close()
    },
  }
}

/** 基线树里 WS-1 的 canonical plan（tests/loader/fixtures APPENDIX_A_PLAN_YAML）。 */
export const WS1_CANONICAL = ['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'] as const
export const WS1_PLAN_PATH = `${MEM_RESEARCH_ROOT}/topics/TPC-1/workstreams/WS-1/plan.yaml`
export const OBJECTIVES_PATH = `${MEM_RESEARCH_ROOT}/objectives.yaml`
