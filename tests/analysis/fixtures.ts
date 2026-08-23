/**
 * WP-7.3 test infrastructure (tests/analysis/).
 *
 * 每个 service/store 级测试开一个真实 research.sqlite（mkdtemp 一次性目录,
 * 同 WP-3.5 flooding / WP-6.4 inbox fixtures 纪律）:
 *   1. WP-2.1 `openDatabase`（经 flooding `openFloodingDatabase` — 文件
 *      init/WAL/user_version 门）— 同文件保持生产形状（本 WP 不用事件面）;
 *   2. 第二连接（`openFloodingDatabase` 适配为 `FloodingDb` 结构端口）—
 *      `analysis_record` 表（本 WP DDL 幂等应用）;
 *   3. 全部端口用**真实冻结面**:
 *      - analysis 形状网 = 真实冻结 `schema/operational/
 *        provenance.schema.json`（$defs/AnalysisRecord; common.schema.json
 *        父 ref 同载）;
 *      - id allocator = 真实 `IdAllocator`（InMemoryMetaStore 计数器
 *        后端 — AN 族真预留/commit/release 语义）。
 *
 * 时钟 = 单一共享单调时钟（每调用 +1ms）— 行 created_at 同源, 顺序断言
 * 即真实顺序。
 *
 * transient 读取面端口 stub（记录型 — 行为可注入）:
 *   - `makeTransientInput` — 三个只读端口的 stub（pointerOf / listSessions
 *     / runs）+ 调用日志; 零写成员（类型面即零写入 — 探针见
 *     transient.test.ts 的写计数 db 包装）。
 *
 * 零写入探针（INV-PERM-3 行为面）: `countingDb` — 在真实第二连接上包一层
 * write 计数器（run/exec 计数）; transient 读取路径经该连接执行后,
 * 计数必须为零（DDL 应用先于探针安装 — 只数探针之后的调用）。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'os'
import { afterAll } from 'vitest'

import { IdAllocator } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import {
  AnalysisError,
  AnalysisRecordService,
  AnalysisStore,
  AnalysisTransientReader,
  loadAnalysisSchemas,
  isAnalysisError,
  type AnalysisErrorCode,
  type AnalysisRecordRecord,
  type AnalysisServiceOptions,
  type AnalysisSchemas,
  type AnalysisTransientReaderInput,
  type TransientRunRow,
  type UserActorRef,
} from '../../src/host/service/analysis/index.js'
import type { TypedRef } from '../../src/host/history/registry/index.js'
import type { SessionPointer } from '../../src/host/service/sessionlink/index.js'
import type { PlanForkDb } from '../../src/host/domain/planfork/index.js'
import type { SessionSummary } from '../../src/shared/host-adapter-ports.js'
import {
  openFloodingDatabase,
  type FloodingDatabase,
} from '../../src/host/service/flooding/index.js'
import { runBindingDdl } from '../../src/host/service/runbinding/index.js'
import {
  decodePointer,
  encodePointer,
  pointerKey,
} from '../../src/host/service/sessionlink/index.js'
import {
  MEM_OPERATIONAL_SCHEMA_DIR,
  realOperationalSchemaFiles,
} from '../planfork/fixtures.js'
import { MemoryReader } from '../loader/memory-reader.js'

/* ------------------------------------------------------------------ *
 * Temp dirs（beforeEach 级清理 — vitest 每文件独立模块, 同 WP-6.4 纪律）
 * ------------------------------------------------------------------ */

const roots: string[] = []

export function makeTempDir(prefix = 'wp73-analysis-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ *
 * Clock（单一共享单调时钟 — 每调用 +1ms）
 * ------------------------------------------------------------------ */

let clockT = 1_700_000_000_000

export function makeClock(): { readonly now: () => number; readonly value: () => number } {
  return {
    now: () => ++clockT,
    value: () => clockT,
  }
}

/* ------------------------------------------------------------------ *
 * 冻结形状网（真实 provenance.schema.json — 每 harness 一份, 零 I/O 重复
 *  读盘: 文件集经 planfork fixtures 缓存）
 * ------------------------------------------------------------------ */

let schemaCache: AnalysisSchemas | null = null

export function frozenAnalysisSchemas(): AnalysisSchemas {
  if (schemaCache === null) {
    const reader = new MemoryReader(realOperationalSchemaFiles())
    schemaCache = loadAnalysisSchemas(reader, MEM_OPERATIONAL_SCHEMA_DIR)
  }
  return schemaCache
}

/* ------------------------------------------------------------------ *
 * Harness（真实 sqlite + 真实冻结面 + 真实 allocator）
 * ------------------------------------------------------------------ */

export interface AnalysisHarness {
  /** 真实 research.sqlite 第二连接（原始面）。 */
  readonly db: PlanForkDb
  readonly dbPair: FloodingDatabase
  readonly schemas: AnalysisSchemas
  readonly store: AnalysisStore
  readonly allocator: IdAllocator
  readonly clock: ReturnType<typeof makeClock>
  readonly service: AnalysisRecordService
  readonly rawSql: (sql: string) => Record<string, unknown>[]
  close(): void
}

export function makeAnalysisHarness(options: { readonly storeOptions?: Partial<AnalysisServiceOptions> } = {}): AnalysisHarness {
  const dir = makeTempDir()
  const dbPair = openFloodingDatabase(join(dir, 'research.sqlite'))
  // 生产形状: 同文件 run/DS 表（WP-2.4 第二连接 DDL — 幂等）。
  dbPair.db.exec(runBindingDdl())
  const schemas = frozenAnalysisSchemas()
  const store = new AnalysisStore({ db: dbPair.db, schemas })
  const allocator = new IdAllocator(new InMemoryMetaStore())
  const clock = makeClock()
  const service = new AnalysisRecordService({
    store,
    allocator,
    projectId: 'PRJ-1',
    now: clock.now,
    ...options.storeOptions,
  })
  return {
    db: dbPair.db,
    dbPair,
    schemas,
    store,
    allocator,
    clock,
    service,
    rawSql: (sql) => dbPair.db.all(sql) as Record<string, unknown>[],
    close(): void {
      store.close()
      dbPair.close()
    },
  }
}

/* ------------------------------------------------------------------ *
 * transient 读取面 stub（记录型 — 行为可注入; 只读端口, 零写成员）
 * ------------------------------------------------------------------ */

export interface TransientStubOptions {
  readonly pointer?: SessionPointer | null
  readonly sessions?: readonly SessionSummary[]
  readonly runs?: readonly TransientRunRow[]
  /** 端口抛错注入（AN_STORE 路径）。 */
  readonly throwOn?: 'pointerOf' | 'listSessions' | 'runs'
}

export function makeTransientInput(options: TransientStubOptions = {}): {
  readonly input: AnalysisTransientReaderInput
  readonly pointerCalls: string[]
  readonly listCalls: number
  readonly runCalls: string[]
  readonly reader: AnalysisTransientReader
} {
  const pointerCalls: string[] = []
  const runCalls: string[] = []
  let listCalls = 0
  const input: AnalysisTransientReaderInput = {
    pointerOf(sessionId: string): SessionPointer | null {
      pointerCalls.push(sessionId)
      if (options.throwOn === 'pointerOf') throw new Error('pointer face exploded')
      return options.pointer === null ? null : options.pointer ?? null
    },
    listSessions(): readonly SessionSummary[] {
      listCalls += 1
      if (options.throwOn === 'listSessions') throw new Error('list face exploded')
      return options.sessions ?? []
    },
    runs(filter: { readonly dshSessionId: string }): readonly TransientRunRow[] {
      runCalls.push(filter.dshSessionId)
      if (options.throwOn === 'runs') throw new Error('runs face exploded')
      return options.runs ?? []
    },
  }
  return {
    input,
    pointerCalls,
    get listCalls() {
      return listCalls
    },
    runCalls,
    reader: new AnalysisTransientReader(input),
  }
}

/* ------------------------------------------------------------------ *
 * 零写入探针（write 计数器 db 包装 — transient 路径经它执行后计数必须
 * 为零; DDL 应用发生在构造时, 探针只数构造后的调用）
 * ------------------------------------------------------------------ */

export function probeWrites(base: PlanForkDb): { readonly db: PlanForkDb; readonly count: () => number; readonly calls: string[] } {
  let writes = 0
  const calls: string[] = []
  const db: PlanForkDb = {
    exec(sql: string): void {
      writes += 1
      calls.push(sql.slice(0, 48).replace(/\s+/g, ' '))
      base.exec(sql)
    },
    run(sql: string, ...params: (string | number | null)[]): number {
      writes += 1
      calls.push(sql.slice(0, 48).replace(/\s+/g, ' '))
      return base.run(sql, ...params)
    },
    get: (sql: string, ...params: (string | number | null)[]) => base.get(sql, ...params),
    all: (sql: string, ...params: (string | number | null)[]) => base.all(sql, ...params),
    transaction: <T>(work: () => T): T => base.transaction(work),
  }
  return { db, count: () => writes, calls }
}

/* ------------------------------------------------------------------ *
 * 生产形状 transient 输入面（真实 db 读取 — 零写入断言的读侧真值）:
 *   - pointerOf = meta KV 直读（`sessionlink:pointer:<sessionId>` 行 —
 *     WP-2.6 INV-DB-2 指针行的真实载体; SELECT 语义, 零写）;
 *   - listSessions = 注入 stub（WP-0.4 DshSessionAdapter.listSessions
 *     端口面 — 非 db 面, 宿主 adapter 真值）;
 *   - runs = run 表 `dsh_session_id` 关联 SELECT（WP-2.4 记录面）。
 * 该面与 `AnalysisTransientReader` 组合后, 整个 transient 路径的 I/O =
 * 两条 SELECT + 一个非 db 端口 — 经 write 计数探针执行后计数必须为零。
 * ------------------------------------------------------------------ */

export interface RealDbTransientOptions {
  /** live session 列表（DSH adapter 端口 stub 面）。 */
  readonly sessions?: readonly SessionSummary[]
  /** 预置指针（缺省 = 无 meta 行 — pointerOf 返回 null）。 */
  readonly pointer?: SessionPointer
}

export function makeRealDbTransientInput(db: PlanForkDb, options: RealDbTransientOptions = {}): {
  readonly input: AnalysisTransientReaderInput
  readonly reader: AnalysisTransientReader
} {
  const input: AnalysisTransientReaderInput = {
    pointerOf(sessionId: string): SessionPointer | null {
      const row = db.get(`SELECT value FROM meta WHERE key = ?`, pointerKey(sessionId))
      if (row === undefined || row.value === undefined) return null
      return decodePointer(String(row.value), sessionId)
    },
    listSessions(): readonly SessionSummary[] {
      return options.sessions ?? []
    },
    runs(filter: { readonly dshSessionId: string }): readonly TransientRunRow[] {
      const rows = db.all(
        `SELECT run_id, workstream_id, status, started_at, ended_at FROM run WHERE dsh_session_id = ? ORDER BY started_at DESC, run_id DESC`,
        filter.dshSessionId,
      )
      return rows.map((r) => ({
        id: String(r.run_id),
        workstreamId: String(r.workstream_id),
        status: String(r.status),
        startedAt: Number(r.started_at),
        endedAt: r.ended_at === null || r.ended_at === undefined ? null : Number(r.ended_at),
      }))
    },
  }
  return { input, reader: new AnalysisTransientReader(input) }
}

/** 测试预置: sessionlink 指针行写入 meta（探针安装**前** — 装配动作,
 *  不属于 transient 路径）。 */
export function seedPointer(db: PlanForkDb, sessionId: string, pointer: SessionPointer): void {
  db.run(`INSERT INTO meta (key, value) VALUES (?, ?)`, pointerKey(sessionId), encodePointer(pointer))
}

/** 测试预置: run 行写入 run 表（探针安装**前** — 装配动作）。 */
export function seedRun(db: PlanForkDb, sessionId: string, row: { readonly runId: string; readonly workstreamId: string; readonly status: string; readonly startedAt: number; readonly endedAt: number | null }): void {
  db.run(
    `INSERT INTO run (run_id, workstream_id, task_id, dsh_session_id, status, intent, initiated_by, started_at, ended_at, summary, last_checkpoint_at, last_checkpoint_note)
     VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL)`,
    row.runId,
    row.workstreamId,
    sessionId,
    row.status,
    JSON.stringify({ kind: 'USER', label: 'test' }),
    row.startedAt,
    row.endedAt,
  )
}

/* ------------------------------------------------------------------ *
 * 常用构造（测试面）
 * ------------------------------------------------------------------ */

/** 常用 actor 常量（测试面）。 */
export const USER: UserActorRef = { kind: 'USER', user_id: 'u1' }
export const USER_BARE: UserActorRef = { kind: 'USER' }

/** 常用 contextRef（冻结 objectKind 成员; 测试面 cast — 形状网运行时复验）。 */
export function ref(kind: string, id: string): TypedRef {
  return { kind, id } as unknown as TypedRef
}

export function makeRecord(overrides: Partial<AnalysisRecordRecord> & { readonly id: string }): AnalysisRecordRecord {
  return {
    source_ref: ref('INTERVENTION', 'IV-5'),
    content: 'investigator 分析（Markdown）',
    created_at: 1_700_000_000_001,
    ...overrides,
  }
}

export function throwsAnalysis(fn: () => unknown, code: AnalysisErrorCode, msgPattern?: RegExp): AnalysisError {
  try {
    fn()
  } catch (e) {
    if (!isAnalysisError(e) || e.code !== code) {
      throw new Error(`expected AnalysisError(code=${code}), got ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
    }
    if (msgPattern !== undefined && !msgPattern.test(e.message)) {
      throw new Error(`expected message to match ${msgPattern}, got: ${e.message}`)
    }
    return e
  }
  throw new Error(`expected AnalysisError(code=${code}) but nothing was thrown`)
}

/** sessionlink 指针行工厂（SessionPointer 形状 — WP-2.6 只读投影; 键是
 *  sessionId, 行内不携带）。 */
export function makePointer(overrides: Partial<SessionPointer> = {}): SessionPointer {
  return {
    workstreamId: 'WS-1',
    lastSeq: 3,
    runId: null,
    runStartedAt: null,
    ...overrides,
  }
}

/** live session 摘要工厂（WP-0.4 SessionSummary 形状）。 */
export function makeSession(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    cwd: '/home/armourpiercer/projects/demo',
    running: false,
    createdAt: 1_699_999_999_000,
    blank: false,
    ...overrides,
  }
}

/** run 行工厂（§6.1 最小面）。 */
export function makeRunRow(id: string, overrides: Partial<TransientRunRow> = {}): TransientRunRow {
  return {
    id,
    workstreamId: 'WS-1',
    status: 'RUNNING',
    startedAt: 1_700_000_000_100,
    endedAt: null,
    ...overrides,
  }
}
