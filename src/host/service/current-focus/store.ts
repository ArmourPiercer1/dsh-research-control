/**
 * UI0 (R-01) — `CurrentFocusStore`: `current_focus` 表的存储面
 * （get / set(UPSERT) / clear — 纯行侧机械动作, 零业务判断）。
 *
 * 存储设计（同 WP-3.1 planfork / WP-3.5 intervention / WP-5.2 actions
 * 先例）:
 *   - 驱动是注入的 `PlanForkDb` 结构端口（**复用** WP-3.1 planfork
 *     域层定义的 operational-DB 面 — 不新造重复端口类型; 零 sqlite
 *     import, 驱动是注入的 I/O, ARCHITECTURE §2.2）;
 *   - 构造时 `exec(currentFocusDdl())`（幂等 IF NOT EXISTS — 每次 open
 *     重放; 无 migration engine — 只幂等 DDL）;
 *   - **set** = 单语句 UPSERT（`ON CONFLICT(workstream_id) DO UPDATE`
 *     — 不存在则创建 / 已存在则覆盖, 原子, 无中间态）→ 读回写后行
 *     返回（「返回写后行」= 本连接上 UPSERT 提交后的立即一致读）;
 *   - **clear** = 条件 DELETE, 返回受影响行数 > 0（是否删了行）;
 *   - **无状态机 / 无事件 / 无触发器**: 指针是 operational 偏好缓存
 *     （DB 丢失 ⇒ get 退化 undefined — 调用方语义, 本层只是如实读）,
 *     不是 identity 行（§15 no-delete 通则不适用）。
 *
 * 边界纪律:
 *   - 输入形状在此钉（workstreamId / planItemId 非空字符串 — CF_INPUT;
 *     canonical 成员校验归 service 层 — 存储层不读第二真源）;
 *   - 驱动/SQL 失败包 CF_STORE（cause 保留; 已结构化的
 *     CurrentFocusError 原样穿透, 不二次包装 — 同 WP-2.4/WP-3.5 错误
 *     纪律）;
 *   - 时间戳来自注入时钟（A-3 epoch ms; 默认 Date.now — 测试注入固定
 *     确定性时钟）。
 */

import type { PlanForkDb } from '../../domain/planfork/index.js'
import {
  currentFocusDdl,
  rowToCurrentFocus,
  SQL_DELETE_CURRENT_FOCUS,
  SQL_GET_CURRENT_FOCUS,
  SQL_UPSERT_CURRENT_FOCUS,
} from './schema.js'
import { CurrentFocusError, isCurrentFocusError, type CurrentFocusRecord } from './types.js'

/** `CurrentFocusStore` construction options (DI — 同 planfork / actions 先例). */
export interface CurrentFocusStoreOptions {
  /** 注入的 operational-DB 面（复用 WP-3.1 `PlanForkDb` 结构端口;
   *  生产 = wiring 装配的适配连接, 测试 = 真实临时文件 DatabaseSync
   *  的适配）。 */
  readonly db: PlanForkDb
  /** Clock for `updated_at` (A-3 epoch ms; tests inject a fixed clock). */
  readonly now?: () => number
}

/**
 * Assert an id-shaped boundary argument（形状面: 非空、非纯空白字符串 —
 * 精确指名失败项; 域 id 模式不在此钉 — 冻结 DDL 无 CHECK, 成员语义归
 * service 的 canonical 校验）。
 */
function assertId(operation: string, what: string, value: unknown): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CurrentFocusError({
      code: 'CF_INPUT',
      message: `${operation}: ${what} must be a non-empty string (got ${JSON.stringify(value)})`,
    })
  }
}

export class CurrentFocusStore {
  readonly #db: PlanForkDb
  readonly #now: () => number

  constructor(options: CurrentFocusStoreOptions) {
    if (
      options.db === undefined ||
      typeof options.db.exec !== 'function' ||
      typeof options.db.run !== 'function'
    ) {
      throw new CurrentFocusError({
        code: 'CF_INPUT',
        message: 'db: the injected operational-DB face (exec/run/get/all/transaction) is required',
      })
    }
    this.#db = options.db
    this.#now = options.now ?? Date.now
    // 幂等 DDL（IF NOT EXISTS）— 连接打开后表就位（同 planfork /
    // flooding / actions 先例; DDL 单一来源在本目录 schema.ts）。
    this.#db.exec(currentFocusDdl())
  }

  /**
   * Get the workstream's pointer. Returns `undefined` when the
   * workstream has no pointer — including the case where the
   * operational DB itself is lost / empty (a Current Focus is a
   * preference cache, not a source of truth: the degradation IS the
   * semantics, no error, no re-derivation).
   */
  get(workstreamId: string): CurrentFocusRecord | undefined {
    assertId('get', 'workstreamId', workstreamId)
    try {
      const row = this.#db.get(SQL_GET_CURRENT_FOCUS, workstreamId)
      return row === undefined ? undefined : rowToCurrentFocus(row)
    } catch (cause) {
      throw this.#wrap('get', cause)
    }
  }

  /**
   * Set / Replace the workstream's pointer（USER 语义 — 不存在则创建,
   * 已存在则覆盖为新目标）。`updatedAt` = 注入时钟采样（写时戳）。
   * Returns the row AS WRITTEN (read back on this connection after the
   * UPSERT committed).
   */
  set(workstreamId: string, planItemId: string): CurrentFocusRecord {
    assertId('set', 'workstreamId', workstreamId)
    assertId('set', 'planItemId', planItemId)
    const updatedAt = this.#now()
    try {
      this.#db.run(SQL_UPSERT_CURRENT_FOCUS, workstreamId, planItemId, updatedAt)
      const row = this.#db.get(SQL_GET_CURRENT_FOCUS, workstreamId)
      if (row === undefined) {
        throw new CurrentFocusError({
          code: 'CF_STORE',
          message: `set: row for workstream ${JSON.stringify(workstreamId)} is missing after UPSERT (concurrent delete?)`,
        })
      }
      return rowToCurrentFocus(row)
    } catch (cause) {
      throw this.#wrap('set', cause)
    }
  }

  /**
   * Clear the workstream's pointer. Returns whether a row was deleted
   * (true) or there was none to delete (false — not an error: clearing
   * an absent pointer is a no-op).
   */
  clear(workstreamId: string): boolean {
    assertId('clear', 'workstreamId', workstreamId)
    try {
      const changed = this.#db.run(SQL_DELETE_CURRENT_FOCUS, workstreamId)
      return changed > 0
    } catch (cause) {
      throw this.#wrap('clear', cause)
    }
  }

  /* ---------------------------------------------------------------- */

  /** 边界结构化错误原样穿透（caller-owned）; 驱动/SQL 失败包 CF_STORE
   *  （message 穿透 cause 原文 — 上层结构化错误（如 WIRING_CLOSED）的
   *  WHY + remedy 对用户可见, 不被本层吞掉）. */
  #wrap(context: string, cause: unknown): unknown {
    if (isCurrentFocusError(cause)) return cause
    const msg = cause instanceof Error ? cause.message : String(cause)
    return new CurrentFocusError({ code: 'CF_STORE', message: `${context}: ${msg}`, cause })
  }
}
