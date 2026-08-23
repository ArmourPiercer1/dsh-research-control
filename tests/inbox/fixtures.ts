/**
 * WP-6.4 test infrastructure (tests/inbox/).
 *
 * 每个 service/store 级测试开一个真实 research.sqlite（mkdtemp 一次性目录,
 * 同 WP-3.5 flooding / WP-5.1 intervention fixtures 纪律）:
 *   1. WP-2.1 `openDatabase`（经 flooding `openFloodingDatabase` — 文件
 *      init/WAL/user_version 门）— 事件 append 连接（`store`, 本 WP 不
 *      用事件面, 但同文件保持生产形状）;
 *   2. 第二连接（`openFloodingDatabase` 适配为 `FloodingDb`）—
 *      `inbox_item` 表（本 WP DDL 幂等应用）;
 *   3. 全部端口用**真实冻结面**:
 *      - inbox 形状网 = 真实冻结 `schema/operational/inbox.schema.json`
 *        （common.schema.json 父 ref 同载）;
 *      - id allocator = 真实 `IdAllocator`（InMemoryMetaStore 计数器
 *        后端 — IN + MA 族真预留/commit/release 语义）。
 *    InboxService 无 History 事件面（冻结目录无 Inbox 事件 — §11「不是
 *    正式科研状态」）⇒ 本 harness 不载事件 registry（与 WP-5.1 差异,
 *    结构使然非裁剪）。
 *
 * 时钟 = 单一共享单调时钟（每调用 +1ms）— 行 created_at 与账本行
 * occurred_at 同源（service 单次采样纪律）, 顺序断言即真实顺序。
 *
 * 端口 stub 面（构造器 options — 测试可换真 service 闭集）:
 *   - `conversionTargets` — 记录型 stub（捕获 kind/fields/item/occurredAt;
 *     可注入 throw / 畸形 ref 行为）;
 *   - `mechanicalInterventionCreator` — 记录型 stub（返回 IV-<n> 递增,
 *     可注入 throw）;
 *   - `managementActionRecorder` — 记录型 stub（捕获账本行, 可注入 throw）。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'os'
import { afterAll } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

import { IdAllocator } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import {
  loadInboxSchemas,
  InboxService,
  InboxStore,
  isInboxError,
  type InboxConversionTargetExecutor,
  type InboxError,
  type InboxErrorCode,
  type InboxServiceOptions,
  type InboxSchemas,
  type MechanicalInterventionCreator,
  type ManagementActionRecorder,
  type UserActorRef,
  type MechanicalActorRef,
} from '../../src/host/service/inbox/index.js'
import type { ManagementActionRecord } from '../../src/host/domain/planfork/index.js'
import type { TypedRef } from '../../src/host/history/registry/index.js'
import {
  openFloodingDatabase,
  type FloodingDatabase,
} from '../../src/host/service/flooding/index.js'
import {
  MEM_OPERATIONAL_SCHEMA_DIR,
  realOperationalSchemaFiles,
} from '../planfork/fixtures.js'
import { MemoryReader } from '../loader/memory-reader.js'

/* ------------------------------------------------------------------ *
 * Temp dirs（beforeEach 级清理 — vitest 每文件独立模块, 同 WP-5.1 纪律）
 * ------------------------------------------------------------------ */

const roots: string[] = []

export function makeTempDir(prefix = 'wp64-inbox-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ *
 * Stub ports（记录型 — 行为可注入）
 * ------------------------------------------------------------------ */

export interface StubExecutorCall {
  readonly kind: string
  readonly fields: unknown
  readonly item: { readonly id: string }
  readonly occurredAt: number
}

export interface StubExecutorOptions {
  /** 返回的 ref（缺省 = {kind, id: '<KIND>-1'} 递增）。 */
  readonly makeRef?: (kind: string) => { readonly kind: string; readonly id: string }
  /** 抛错注入（IN_CONVERT_TARGET 路径）。 */
  readonly throw?: Error
}

export function makeStubExecutor(options: StubExecutorOptions = {}): {
  readonly executor: InboxConversionTargetExecutor
  readonly calls: StubExecutorCall[]
} {
  const calls: StubExecutorCall[] = []
  let n = 0
  const executor: InboxConversionTargetExecutor = {
    execute(kind, fields, item, occurredAt) {
      calls.push({ kind, fields, item: { id: item.id }, occurredAt })
      if (options.throw !== undefined) throw options.throw
      const ref = options.makeRef?.(kind) ?? { kind, id: `${kind}-${++n}` }
      return ref as unknown as TypedRef
    },
  }
  return { executor, calls }
}

export interface StubInterventionCall {
  readonly title: string
  readonly detail?: string
  readonly workstreamIds?: readonly string[]
  readonly sourceRefs?: readonly { readonly kind: string; readonly id: string }[]
}

export function makeStubMechanicalIntervention(options: { readonly throw?: Error } = {}): {
  readonly creator: MechanicalInterventionCreator
  readonly calls: StubInterventionCall[]
} {
  const calls: StubInterventionCall[] = []
  let n = 0
  const creator: MechanicalInterventionCreator = (params) => {
    calls.push({
      title: params.title,
      ...(params.detail !== undefined ? { detail: params.detail } : {}),
      ...(params.workstreamIds !== undefined ? { workstreamIds: params.workstreamIds } : {}),
      ...(params.sourceRefs !== undefined ? { sourceRefs: params.sourceRefs } : {}),
    })
    if (options.throw !== undefined) throw options.throw
    return { id: `IV-${++n}`, title: params.title }
  }
  return { creator, calls }
}

export function makeStubLedger(options: { readonly throw?: Error } = {}): {
  readonly recorder: ManagementActionRecorder
  readonly rows: ManagementActionRecord[]
} {
  const rows: ManagementActionRecord[] = []
  const recorder: ManagementActionRecorder = (record) => {
    rows.push(record)
    if (options.throw !== undefined) throw options.throw
  }
  return { recorder, rows }
}

/* ------------------------------------------------------------------ *
 * The harness
 * ------------------------------------------------------------------ */

export interface InboxHarness {
  readonly dir: string
  readonly dbPair: FloodingDatabase
  /** raw 第二连接（负例 / 触发器 / 并发探针用）。 */
  readonly raw: DatabaseSync
  readonly schemas: InboxSchemas
  readonly store: InboxStore
  readonly allocator: IdAllocator
  /** allocator 计数器后端（getCounter 断言面 — 同 InMemoryMetaStore 计数面）。 */
  readonly meta: InMemoryMetaStore
  /** 单一共享单调时钟（每调用 +1ms）。 */
  readonly now: () => number
  /** 端口 stub 全集（测试直读 calls 断言）。 */
  readonly stubs: {
    readonly executor: ReturnType<typeof makeStubExecutor>
    readonly intervention: ReturnType<typeof makeStubMechanicalIntervention>
    readonly ledger: ReturnType<typeof makeStubLedger>
  }
  /** 以覆盖端口建 service（缺省 = 全 stub 接线; store 亦可覆盖 —
   *  并发交错测试面）。 */
  makeService(overrides?: Partial<Omit<InboxServiceOptions, 'allocator' | 'projectId' | 'now'>>): InboxService
  close(): void
}

export function makeInboxHarness(): InboxHarness {
  const dir = makeTempDir()
  const dbPair = openFloodingDatabase(join(dir, 'research.sqlite'))
  const rawDb = new DatabaseSync(resolve(join(dir, 'research.sqlite')))
  rawDb.exec('PRAGMA busy_timeout = 5000')

  const opReader = new MemoryReader(realOperationalSchemaFiles())
  const schemas = loadInboxSchemas(opReader, MEM_OPERATIONAL_SCHEMA_DIR)
  if (!schemas.isUsable) {
    throw new Error(`harness: inbox schemas unavailable: ${schemas.loadErrors.map((e) => `${e.path}: ${e.message}`).join(' | ')}`)
  }

  const clockState = { t: 1_700_000_000_000 }
  const now = (): number => {
    clockState.t += 1
    return clockState.t
  }

  const store = new InboxStore({ db: dbPair.db, schemas })
  const meta = new InMemoryMetaStore()
  const allocator = new IdAllocator(meta)
  const stubs = {
    executor: makeStubExecutor(),
    intervention: makeStubMechanicalIntervention(),
    ledger: makeStubLedger(),
  }

  function makeService(
    overrides: Partial<Omit<InboxServiceOptions, 'allocator' | 'projectId' | 'now'>> = {},
  ): InboxService {
    return new InboxService({
      store,
      allocator,
      projectId: 'PRJ-1',
      now,
      conversionTargets: stubs.executor.executor,
      mechanicalInterventionCreator: stubs.intervention.creator,
      managementActionRecorder: stubs.ledger.recorder,
      ...overrides,
    })
  }

  return {
    dir,
    dbPair,
    raw: rawDb,
    schemas,
    store,
    allocator,
    meta,
    now,
    stubs,
    makeService,
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
 * 断言助手（同 WP-5.1 throwsIntervention 纪律 — 集中 code 级断言,
 * 返回抛出错误供进一步断言）
 * ------------------------------------------------------------------ */

export function throwsInbox(fn: () => unknown, code: InboxErrorCode, msgPattern?: RegExp): InboxError {
  try {
    fn()
  } catch (e) {
    if (!isInboxError(e) || e.code !== code) {
      throw new Error(`expected InboxError(code=${code}), got ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
    }
    if (msgPattern !== undefined && !msgPattern.test(e.message)) {
      throw new Error(`expected message to match ${msgPattern}, got: ${e.message}`)
    }
    return e
  }
  throw new Error(`expected InboxError(code=${code}) but nothing was thrown`)
}

/** 常用 actor 常量（测试面）。 */
export const USER: UserActorRef = { kind: 'USER', user_id: 'u1' }
export const USER_BARE: UserActorRef = { kind: 'USER' }
export const PLUGIN: MechanicalActorRef = { kind: 'PLUGIN', label: 'research-control' }
export const AGENT: MechanicalActorRef = { kind: 'AGENT', run_id: 'R-1' }

/** 常用 contextRef（冻结 objectKind 成员; 测试面 cast — 形状网运行时复验）。 */
export function ref(kind: string, id: string): TypedRef {
  return { kind, id } as unknown as TypedRef
}
