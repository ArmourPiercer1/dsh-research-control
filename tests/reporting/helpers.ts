/**
 * WP-5.3 reporting test harness — REAL research.sqlite (the DatabaseSync
 * 封装模式, 同 WP-3.1 persist-harness):
 *
 *   1. WP-2.1 `openDatabase` 先行 (核心三表 + 文件 init 纪律);
 *   2. 第二 `DatabaseSync` 连接适配为 `ReportingDb` 结构端口 (参数化
 *      run/get/all + BEGIN IMMEDIATE 事务);
 *   3. `ReportingService` 构造时幂等 DDL (interaction + reporting_item
 *      + scheduled_event);
 *   4. 同一文件面上补 `intervention` 表 DDL (生产 wiring 的 flooding
 *      第二连接同文件先例 — `createScheduledEvent` 的 IV 引用存在性
 *      校验需要该表在场, 同 rpc-wiring 真实树)。
 *
 * 每个测试 = 一个 tmp 目录 (afterAll 递归删除 — tests/store 同款纪律)。
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

import { openDatabase } from '../../src/host/persistence/store/index.js'
import { IdAllocator } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import { interventionDdl } from '../../src/host/service/flooding/index.js'
import {
  ReportingService,
  type ReportingDb,
} from '../../src/host/service/reporting/index.js'

const roots: string[] = []

export function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wp53-rpt-'))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** Reference "now" (epoch ms) — deterministic. */
export const T0 = Date.parse('2026-08-22T09:00:00Z')

/** Adapt a real node:sqlite DatabaseSync to the ReportingDb port. */
export function adaptReportingDb(db: DatabaseSync): ReportingDb {
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

export interface ReportingHarness {
  /** The temp dir holding research.sqlite (and its -wal/-shm). */
  readonly dir: string
  /** The WP-2.1 store connection (closed by close()). */
  readonly coreStore: ReturnType<typeof openDatabase>
  /** The second connection (raw SQL 负例 / trigger 断言用). */
  readonly rawDb: DatabaseSync
  /** The ReportingService on the second connection. */
  readonly service: ReportingService
  /** The shared clock (deterministic — T0 + n·1s). */
  readonly clock: () => number
  /** A second service over a THIRD connection of the SAME file. */
  secondService(): ReportingService
  close(): void
}

/** Open the full real-sqlite harness (fresh temp DB per call). */
export function openReportingHarness(): ReportingHarness {
  const dir = makeTempDir()
  const coreStore = openDatabase(join(dir, 'research.sqlite'))
  const rawDb = new DatabaseSync(join(dir, 'research.sqlite'))
  rawDb.exec('PRAGMA busy_timeout = 5000')
  // 生产 wiring 同文件面: intervention 表 (IV 引用存在性校验的在场前提)。
  rawDb.exec(interventionDdl())

  let tick = 0
  const clock = () => T0 + ++tick * 1000
  const allocator = new IdAllocator(new InMemoryMetaStore())
  const service = new ReportingService({ db: adaptReportingDb(rawDb), allocator, projectId: 'PRJ-1', now: clock })

  return {
    dir,
    coreStore,
    rawDb,
    service,
    clock,
    secondService: () => {
      const raw2 = new DatabaseSync(join(dir, 'research.sqlite'))
      raw2.exec('PRAGMA busy_timeout = 5000')
      return new ReportingService({ db: adaptReportingDb(raw2), allocator, projectId: 'PRJ-1', now: clock })
    },
    close: () => {
      rawDb.close()
      coreStore.close()
    },
  }
}

/** COUNT(*) rows come back as number|bigint from node:sqlite. */
export const count = (row: Record<string, unknown> | undefined): number => Number(row?.n ?? 0)

/** node:sqlite: all/get live on StatementSync, not DatabaseSync. */
export const qAll = (db: DatabaseSync, sql: string): Record<string, unknown>[] =>
  db.prepare(sql).all() as Record<string, unknown>[]

export const qGet = (db: DatabaseSync, sql: string, ...params: (string | number | null)[]): Record<string, unknown> | undefined =>
  db.prepare(sql).get(...params) as Record<string, unknown> | undefined
