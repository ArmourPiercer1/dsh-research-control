/**
 * WP-6.4 — `InboxStore`: inbox_item 行的存储面（insert + 查询 + 状态
 * 缓存 UPDATE; append-only 内容语义）。
 *
 * 表 / 触发器 / 行形状 = 本 WP schema.ts（`inbox_item` DDL — 第二连接
 * 模式: 多连接 WAL 共存, 写经文件锁串行化, 同 WP-3.5/WP-5.3 先例;
 * 构造时对注入连接幂等应用 `inboxItemDdl()`）。
 *
 * 面（API 面即权限面 — 同 WP-3.5 纪律）:
 *   - **无 delete 方法**（§15 通则 / INV-HIST-7; 存储层 trigger 兜底任何
 *     连接的 raw DELETE）;
 *   - **无内容 UPDATE 方法**（capture 后 5 个内容列不可变 — trigger 兜底;
 *     唯一的合法行侧写 = `updateState` 的状态缓存两列 state/converted_to,
 *     §13 迁移仅用户 — actor 门在 service 层, 本层只执行行侧机械动作,
 *     同 WP-5.1 lifecycle store 分工）;
 *   - 查询**无隐藏过滤器**: `listItems` 按 (state?, source?) 任一子集
 *     过滤, 全部参数缺省 = 全量（稳定顺序 created_at ASC, id ASC —
 *     §15 索引 (state, created_at) + id 全序兜底）。
 *
 * 错误纪律: 边界参数畸形 = IN_INPUT; 形状网不可用/整行违例 = IN_INPUT
 * （与冻结网同类的「输入不合法」分类）; 驱动/SQL 失败包 IN_STORE
 * （cause 保留）。
 */

import {
  inboxItemDdl,
  inboxItemToParams,
  rowToInboxItem,
  SQL_INSERT_INBOX_ITEM,
  SQL_LIST_INBOX_ITEMS,
  SQL_SELECT_INBOX_ITEM_BY_ID,
  SQL_UPDATE_INBOX_ITEM_STATE,
} from './schema.js'
import type { FloodingDb } from '../flooding/index.js'
import {
  InboxError,
  INBOX_SOURCES,
  INBOX_STATES,
  type InboxItemRecord,
  type InboxSchemas,
  type InboxState,
} from './types.js'

export interface InboxListFilter {
  /** 按状态过滤（§15 索引列; 缺省 = 不过滤）。 */
  readonly state?: InboxState
  /** 按来源过滤（§11 source; 缺省 = 不过滤）。 */
  readonly source?: InboxItemRecord['source']
}

export interface InboxStoreOptions {
  /** 本 store 的连接面（第二连接 — exec 幂等 DDL / run 写 / get+all 读）。 */
  readonly db: FloodingDb
  /** 冻结 inbox.schema.json 形状网（insert 整行网 — 同 WP-3.5 先例）。 */
  readonly schemas: InboxSchemas
}

export class InboxStore {
  readonly #db: FloodingDb
  readonly #schemas: InboxSchemas
  private closed = false

  constructor(options: InboxStoreOptions) {
    if (options.db === undefined || typeof options.db.exec !== 'function' || typeof options.db.run !== 'function') {
      throw new InboxError({ code: 'IN_INPUT', message: 'db: the injected operational-DB face (exec/run/get/all/transaction) is required' })
    }
    if (options.schemas === undefined || typeof options.schemas.checkInboxShape !== 'function') {
      throw new InboxError({ code: 'IN_INPUT', message: 'schemas: the frozen inbox schema face (loadInboxSchemas) is required' })
    }
    this.#db = options.db
    this.#schemas = options.schemas
    // 幂等 DDL（IF NOT EXISTS）— 第二连接开库后表 + 索引 + 触发器就位
    // （同 WP-3.1 / WP-3.5 / WP-5.3 先例; DDL 单一来源在本 WP schema.ts）。
    this.#db.exec(inboxItemDdl())
  }

  /* ---------------------------------------------------------------- *
   * 写面
   * ---------------------------------------------------------------- */

  /**
   * Insert ONE inbox item row（单语句 autocommit）。落库前: 整行过
   * **真实冻结** `$defs/InboxItem`（shape net 不可用 ⇒ IN_STORE 大声
   * 失败, 绝不在无 schema 时放行 — 同 WP-3.5 口径; 整行违例 ⇒ IN_INPUT）。
   * 调用方（service）负责 IN 号 reserve/commit。
   */
  insertItem(record: InboxItemRecord): InboxItemRecord {
    this.#assertOpen('insertItem')
    if (record === null || typeof record !== 'object') {
      throw new InboxError({ code: 'IN_INPUT', message: 'insertItem: record must be an InboxItemRecord object' })
    }
    if (!this.#schemas.isUsable) {
      throw new InboxError({
        code: 'IN_STORE',
        message: 'frozen inbox schema set unavailable — no inbox row can be shape-checked (see InboxSchemas.loadErrors)',
      })
    }
    const shape = this.#schemas.checkInboxShape(record)
    if (!shape.ok) {
      throw new InboxError({
        code: 'IN_INPUT',
        message: `internal: inbox record failed the frozen inbox schema: ${shape.errors.map((e) => `${e.path || '/'}: ${e.message}`).join(' | ')}`,
      })
    }
    try {
      this.#db.run(SQL_INSERT_INBOX_ITEM, ...inboxItemToParams(record))
    } catch (cause) {
      throw this.#wrap('insertItem', cause)
    }
    return record
  }

  /**
   * §13 迁移的行侧写（状态缓存两列; DDL 触发器放行的唯一 UPDATE 面）:
   * 条件 `AND state = expectedState`（乐观并发门）— 返回受影响行数
   * （0 ⇒ 迁移期间状态已变, service 大声失败 IN_CONCURRENT_STATE）。
   * `convertedTo` 仅 CONVERTED 迁移携带（其余迁移 = null — 唯一写点
   * 语义在 service 层, 本层不重复判定）。
   */
  updateState(
    id: string,
    state: InboxState,
    convertedTo: { readonly kind: string; readonly id: string } | null,
    expectedState: InboxState,
  ): number {
    this.#assertOpen('updateState')
    if (typeof id !== 'string' || !/^IN-[1-9][0-9]*$/.test(id)) {
      throw new InboxError({ code: 'IN_INPUT', message: `updateState: id must be a well-formed IN id (got ${JSON.stringify(String(id))})` })
    }
    assertInboxEnum('updateState.state', state, INBOX_STATES)
    assertInboxEnum('updateState.expectedState', expectedState, INBOX_STATES)
    if (convertedTo !== null) {
      if (
        convertedTo === undefined ||
        typeof convertedTo !== 'object' ||
        typeof convertedTo.kind !== 'string' ||
        typeof convertedTo.id !== 'string' ||
        convertedTo.id.length === 0
      ) {
        throw new InboxError({ code: 'IN_INPUT', message: `updateState: convertedTo must be null or a {kind, id} typedRef (got ${JSON.stringify(convertedTo)})` })
      }
    }
    try {
      return this.#db.run(
        SQL_UPDATE_INBOX_ITEM_STATE,
        state,
        convertedTo === null ? null : JSON.stringify({ kind: convertedTo.kind, id: convertedTo.id }),
        id,
        expectedState,
      )
    } catch (cause) {
      throw this.#wrap('updateState', cause)
    }
  }

  /* ---------------------------------------------------------------- *
   * 查询面（无 delete — INV-HIST-7）
   * ---------------------------------------------------------------- */

  /** One record by id（`null` when absent）。 */
  getItem(id: string): InboxItemRecord | null {
    this.#assertOpen('getItem')
    if (typeof id !== 'string' || id.length === 0) {
      throw new InboxError({ code: 'IN_INPUT', message: `getItem: id must be a non-empty string (got ${JSON.stringify(String(id))})` })
    }
    try {
      const row = this.#db.get(SQL_SELECT_INBOX_ITEM_BY_ID, id)
      return row === undefined ? null : rowToInboxItem(row)
    } catch (cause) {
      throw this.#wrap('getItem', cause)
    }
  }

  /** List by (state?, source?) — 稳定顺序 created_at ASC, id ASC
   *  （全缺省 = 全量; 过滤参数由调用方显式指名 — 无隐藏过滤器）。 */
  listItems(filter: InboxListFilter = {}): InboxItemRecord[] {
    this.#assertOpen('listItems')
    if (filter.state !== undefined) assertInboxEnum('listItems.filter.state', filter.state, INBOX_STATES)
    if (filter.source !== undefined) assertInboxEnum('listItems.filter.source', filter.source, INBOX_SOURCES)
    try {
      const rows = this.#db.all(SQL_LIST_INBOX_ITEMS)
      const items = rows.map((row) => rowToInboxItem(row))
      if (filter.state !== undefined) {
        return items.filter((item) => item.state === filter.state)
      }
      if (filter.source !== undefined) {
        return items.filter((item) => item.source === filter.source)
      }
      return items
    } catch (cause) {
      throw this.#wrap('listItems', cause)
    }
  }

  /* ---------------------------------------------------------------- */

  #assertOpen(operation: string): void {
    if (this.closed) throw new InboxError({ code: 'IN_STORE', message: `${operation}: store is closed` })
  }

  /** Test/inspection seam（no-op 语义: store 无生命周期状态可关 — 连接
   *  归 wiring 的单一 disposer, 同 WP-5.1 lifecycle store 先例）。 */
  close(): void {
    this.closed = true
  }

  #wrap(context: string, cause: unknown): InboxError {
    if (cause instanceof InboxError) throw cause
    const msg = cause instanceof Error ? cause.message : String(cause)
    return new InboxError({ code: 'IN_STORE', message: `${context}: ${msg}`, cause })
  }
}

function assertInboxEnum(what: string, value: unknown, frozen: readonly string[]): void {
  if (typeof value !== 'string' || !frozen.includes(value)) {
    throw new InboxError({ code: 'IN_INPUT', message: `${what} must be one of ${frozen.join('|')} (got ${JSON.stringify(String(value))})` })
  }
}
