/**
 * WP-5.1 — `InterventionLifecycleStore`: intervention 行的**生命周期面**
 * （insert + 全量查询 + 用户状态缓存 UPDATE; append-only）。
 *
 * 表 / 触发器 / 行形状 = WP-3.5 冻结面（复用 — 本文件**不**含 CREATE
 * TABLE; 构造时对注入连接幂等应用 WP-3.5 `interventionDdl()` — 第二连接
 * 模式: 多连接 WAL 共存, 写经文件锁串行化, 同 WP-3.5/WP-3.1 先例）。
 *
 * 面（API 面即权限面 — 同 WP-3.5 纪律）:
 *   - **无 delete 方法**（§15 通则 / INV-HIST-7; 存储层 trigger 兜底任何
 *     连接的 raw DELETE）;
 *   - **无内容 UPDATE 方法**（创建后 8 个内容列不可变 — trigger 兜底;
 *     唯一的合法行侧写 = `updateState` 的状态缓存三列, §13 迁移仅用户,
 *     INV-PERM-4 — actor 门在 service 层, 本层只执行行侧机械动作）;
 *   - 查询**无隐藏过滤器**: `listInterventions` 按 (workstreamId?,
 *     status?, origin?) 任一子集过滤, 全部参数缺省 = 全量（INV-ATTN-1
 *     「完整展示」的存储半边 — 过滤只用于调用方显式指名, service 查询
 *     面从不替调用方隐藏行）。
 *
 * 组合（决策: 复用 WP-3.5 `InterventionStore` 作 insert/查询委托, 零形状
 * 网重复）:
 *   - `interventions`（WP-3.5 store, 注入的既有实例 — 生产 = wiring 的
 *     同一 intervention 连接上的实例）: insert（整行过真实冻结
 *     attention.schema.json 形状网）+ get/list;
 *   - `db`（本 store 自有连接面）: 状态缓存列条件 UPDATE
 *     （`SQL_UPDATE_INTERVENTION_STATE`, 乐观并发门 `AND status = ?`）。
 *
 * 错误纪律: 边界参数畸形 = IV_INPUT; 驱动/SQL 失败包 IV_STORE（cause
 * 保留）。
 */

import {
  IV_STATUSES,
  interventionDdl,
  isFloodingError,
  type FloodingDb,
  type InterventionListFilter,
  type InterventionRecord,
  type InterventionStore,
  type IvStatus,
} from '../flooding/index.js'
import { SQL_UPDATE_INTERVENTION_STATE } from './schema.js'
import { InterventionError, type InterventionErrorCode } from './types.js'

export interface InterventionLifecycleStoreOptions {
  /** 本 store 的连接面（状态缓存列 UPDATE; DDL 幂等应用也走它）。 */
  readonly db: FloodingDb
  /** WP-3.5 intervention store（insert 形状网 + 查询委托; 生产 = wiring
   *  同一 intervention 连接上的实例, 测试 = 同 harness 实例）。 */
  readonly interventions: InterventionStore
}

export class InterventionLifecycleStore {
  readonly #db: FloodingDb
  readonly #interventions: InterventionStore
  private closed = false

  constructor(options: InterventionLifecycleStoreOptions) {
    if (options.db === undefined || typeof options.db.exec !== 'function' || typeof options.db.run !== 'function') {
      throw new InterventionError({ code: 'IV_INPUT', message: 'db: the injected operational-DB face (exec/run/get/all/transaction) is required' })
    }
    if (options.interventions === undefined || typeof options.interventions.insertIntervention !== 'function') {
      throw new InterventionError({ code: 'IV_INPUT', message: 'interventions: a WP-3.5 InterventionStore (insert/query face) is required' })
    }
    this.#db = options.db
    this.#interventions = options.interventions
    // 幂等 DDL（IF NOT EXISTS）— 第二连接开库后表 + 索引 + 触发器就位
    // （同 WP-3.1 / WP-3.5 / WP-2.4 先例; DDL 单一来源在 flooding）。
    this.#db.exec(interventionDdl())
  }

  /* ---------------------------------------------------------------- *
   * 写面
   * ---------------------------------------------------------------- */

  /**
   * Insert ONE intervention row（委托 WP-3.5 store — 整行过真实冻结
   * `$defs/Intervention` 形状网; 单语句 autocommit）。调用方（service）
   * 负责 IV/H 双号 reserve/commit 与事件先行纪律。
   */
  insertIntervention(record: InterventionRecord): InterventionRecord {
    this.#assertOpen('insertIntervention')
    try {
      return this.#interventions.insertIntervention(record)
    } catch (cause) {
      if (cause instanceof InterventionError) throw cause
      if (isFloodingError(cause)) {
        // WP-3.5 形状网/边界分类 → 本模块分类（形状不可用/畸形 = 输入面,
        // 其余（SQL 等）= 存储面; 消息逐字保留 — 不掩盖失败项）。
        const code: InterventionErrorCode =
          cause.code === 'FLOODING_INPUT' || cause.code === 'FLOODING_SCHEMA_UNAVAILABLE' ? 'IV_INPUT' : 'IV_STORE'
        throw new InterventionError({ code, message: cause.message, cause })
      }
      throw this.#wrap('insertIntervention', cause)
    }
  }

  /**
   * §13 迁移的行侧写（状态缓存三列; DDL 触发器放行的唯一 UPDATE 面）:
   * 条件 `AND status = expectedStatus`（乐观并发门）— 返回受影响行数
   * （0 ⇒ 迁移期间状态已变, service 大声失败 IV_CONCURRENT_STATE）。
   */
  updateState(
    id: string,
    status: IvStatus,
    closedAt: number | null,
    resolutionNote: string | null,
    expectedStatus: IvStatus,
  ): number {
    this.#assertOpen('updateState')
    if (typeof id !== 'string' || !/^IV-[1-9][0-9]*$/.test(id)) {
      throw new InterventionError({ code: 'IV_INPUT', message: `updateState: id must be a well-formed IV id (got ${JSON.stringify(String(id))})` })
    }
    assertIvStatus('updateState.status', status)
    assertIvStatus('updateState.expectedStatus', expectedStatus)
    if (closedAt !== null && (typeof closedAt !== 'number' || !Number.isSafeInteger(closedAt) || closedAt < 0)) {
      throw new InterventionError({ code: 'IV_INPUT', message: `updateState: closedAt must be null or a non-negative safe integer epoch ms (got ${String(closedAt)})` })
    }
    if (resolutionNote !== null && typeof resolutionNote !== 'string') {
      throw new InterventionError({ code: 'IV_INPUT', message: `updateState: resolutionNote must be null or a string (got ${typeof resolutionNote})` })
    }
    try {
      return this.#db.run(SQL_UPDATE_INTERVENTION_STATE, status, closedAt, resolutionNote, id, expectedStatus)
    } catch (cause) {
      throw this.#wrap('updateState', cause)
    }
  }

  /* ---------------------------------------------------------------- *
   * 查询面（委托 WP-3.5; 无 delete — INV-HIST-7）
   * ---------------------------------------------------------------- */

  /** One record by id（`null` when absent）。 */
  getIntervention(id: string): InterventionRecord | null {
    this.#assertOpen('getIntervention')
    try {
      return this.#interventions.getIntervention(id)
    } catch (cause) {
      throw this.#wrap('getIntervention', cause)
    }
  }

  /** List by (workstreamId?, status?, origin?) — 稳定顺序
   *  created_at ASC, id ASC（继承 WP-3.5 查询面; 全缺省 = 全量）。 */
  listInterventions(filter: InterventionListFilter = {}): InterventionRecord[] {
    this.#assertOpen('listInterventions')
    try {
      return this.#interventions.listInterventions(filter)
    } catch (cause) {
      throw this.#wrap('listInterventions', cause)
    }
  }

  /* ---------------------------------------------------------------- */

  #assertOpen(operation: string): void {
    if (this.closed) throw new InterventionError({ code: 'IV_STORE', message: `${operation}: store is closed` })
  }

  /** Test/inspection seam（no-op 语义: store 无生命周期状态可关 — 连接
   *  归 wiring 的单一 disposer）。 */
  close(): void {
    this.closed = true
  }

  #wrap(context: string, cause: unknown): InterventionError {
    const msg = cause instanceof Error ? cause.message : String(cause)
    return new InterventionError({ code: 'IV_STORE', message: `${context}: ${msg}`, cause })
  }
}

function assertIvStatus(what: string, value: IvStatus): void {
  if (typeof value !== 'string' || !(IV_STATUSES as readonly string[]).includes(value)) {
    throw new InterventionError({ code: 'IV_INPUT', message: `${what} must be one of ${IV_STATUSES.join('|')} (got ${JSON.stringify(String(value))})` })
  }
}
