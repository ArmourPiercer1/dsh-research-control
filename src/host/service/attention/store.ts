/**
 * WP-5.4 — `AwarenessStore`: awareness 行落库 + 查询面（状态缓存表;
 * 无 delete — INV-HIST-7 / §15 通则; 无内容迁移面 — object_ref 即行身份）。
 *
 * 写入面（唯一写入者 = `AttentionService.setAwareness`, 且 actor 门
 * 已在 service 层放行 USER — INV-PERM-2 矩阵行「Awareness 状态」）:
 *   - `upsert(record)` — 用户改状态/首见建记录; 只触状态缓存列
 *     （state/updated_at）, 身份列（object_kind/object_id）经 PK upsert
 *     保持不动 ⇒ `awareness_no_content_update` trigger 不触发。
 *
 * 查询面:
 *   - `get(ref)` — 无记录 = `null`（视图/评分按 §9.5 默认 UNSEEN 语义,
 *     不伪造行）;
 *   - `list()` — 稳定顺序 kind ASC, object_id ASC。
 *
 * 不变量（API 面）:
 *   - **无 delete 方法**（§15 通则 / INV-HIST-7; 存储层 trigger 兜底任何
 *     连接的 raw DELETE — REPLACE 类同理: upsert 走 ON CONFLICT DO UPDATE,
 *     不产生内部 delete, 不触 DELETE trigger, 与 connection-guard 的
 *     RR-013 口径一致 — awareness 不是 append-only 事件表, 其威胁面由
 *     PK upsert + 双 trigger 闭合）;
 *   - **无「改身份」方法**（object_ref 不可动 — trigger 钉, 类型面不暴露）。
 *
 * 错误纪律（同 WP-2.4/WP-3.1）: 驱动/SQL 失败包 ATTN_STORE（cause 保留）;
 * 入参契约失败 ATTN_INPUT（本 store 只做廉价边界断言, 语义门在 service）。
 */

import {
  AWARENESS_KIND_VALUES,
  AWARENESS_STATE_VALUES,
  SQL_LIST_AWARENESS,
  SQL_SELECT_AWARENESS,
  SQL_UPSERT_AWARENESS,
  awarenessDdl,
  awarenessToParams,
  rowToAwareness,
} from './schema.js'
import {
  AttentionError,
  type AwarenessObjectRef,
  type AwarenessRecord,
  type AwarenessState,
  type AttentionDb,
} from './types.js'

export interface AwarenessStoreOptions {
  /** The injected operational-DB surface（schema.ts 头注的双连接模式）。 */
  readonly db: AttentionDb
}

export class AwarenessStore {
  private readonly db: AttentionDb
  private closed = false

  constructor(options: AwarenessStoreOptions) {
    if (options.db === undefined || typeof options.db.exec !== 'function' || typeof options.db.run !== 'function') {
      throw new AttentionError({
        code: 'ATTN_INPUT',
        message: 'db: the injected operational-DB face (exec/run/get/all/transaction) is required',
      })
    }
    this.db = options.db
    // Idempotent DDL (IF NOT EXISTS) — re-applied on every open（同 WP-3.1
    // / WP-2.4 / WP-3.5 先例）: 第二连接开库后, awareness 表 + PK + trigger 就位。
    this.db.exec(awarenessDdl())
  }

  /* ---------------------------------------------------------------- *
   * Write face（唯一写入者: AttentionService.setAwareness, USER 门已过）
   * ---------------------------------------------------------------- */

  /** 用户改状态 / 首见建记录（upsert; 只触状态缓存列）。 */
  upsert(objectRef: AwarenessObjectRef, state: AwarenessState, updatedAt: number): AwarenessRecord {
    this.#assertOpen('upsert')
    assertRef(objectRef, 'objectRef')
    assertState(state, 'state')
    assertEpoch(updatedAt, 'updatedAt')
    try {
      this.db.run(SQL_UPSERT_AWARENESS, objectRef.kind, objectRef.id, state, updatedAt)
    } catch (cause) {
      throw this.#wrap('upsert', cause)
    }
    const record: AwarenessRecord = {
      object_kind: objectRef.kind,
      object_id: objectRef.id,
      state,
      updated_at: updatedAt,
    }
    return record
  }

  /* ---------------------------------------------------------------- *
   * Query face（只读; 无 delete — INV-HIST-7）
   * ---------------------------------------------------------------- */

  /** One record by object_ref（`null` when absent — 默认 UNSEEN 语义由
   *  消费方解释, 不在此伪造行）。 */
  get(objectRef: AwarenessObjectRef): AwarenessRecord | null {
    this.#assertOpen('get')
    assertRef(objectRef, 'objectRef')
    const row = this.db.get(SQL_SELECT_AWARENESS, objectRef.kind, objectRef.id)
    return row === undefined ? null : rowToAwareness(row)
  }

  /** All records（稳定顺序 kind ASC, object_id ASC）。 */
  list(): AwarenessRecord[] {
    this.#assertOpen('list')
    const rows = this.db.all(SQL_LIST_AWARENESS)
    return rows.map((r) => rowToAwareness(r))
  }

  /* ---------------------------------------------------------------- */

  #assertOpen(operation: string): void {
    if (this.closed) {
      throw new AttentionError({ code: 'ATTN_STORE', message: `${operation}: store is closed` })
    }
  }

  /** Test/inspection seam（no-op 语义: store 无生命周期状态可关）。 */
  close(): void {
    this.closed = true
  }

  #wrap(context: string, cause: unknown): AttentionError {
    const msg = cause instanceof Error ? cause.message : String(cause)
    return new AttentionError({ code: 'ATTN_STORE', message: `${context}: ${msg}`, cause })
  }
}

/* ------------------------------------------------------------------ *
 * 边界断言（精确指名失败项 — 同 WP-3.1 assertEpoch 纪律）
 * ------------------------------------------------------------------ */

function assertRef(ref: AwarenessObjectRef, what: string): void {
  if (ref === null || typeof ref !== 'object') {
    throw new AttentionError({ code: 'ATTN_INPUT', message: `${what} must be an {kind, id} object` })
  }
  if (typeof ref.kind !== 'string' || !(AWARENESS_KIND_VALUES as readonly string[]).includes(ref.kind)) {
    throw new AttentionError({
      code: 'ATTN_INPUT',
      message: `${what}.kind must be one of ${AWARENESS_KIND_VALUES.join('|')} (INV-ATTN-4 awareness kind whitelist; got ${JSON.stringify(String(ref.kind))})`,
    })
  }
  if (typeof ref.id !== 'string' || ref.id.length === 0) {
    throw new AttentionError({ code: 'ATTN_INPUT', message: `${what}.id must be a non-empty string` })
  }
}

function assertState(state: AwarenessState, what: string): void {
  if (typeof state !== 'string' || !(AWARENESS_STATE_VALUES as readonly string[]).includes(state)) {
    throw new AttentionError({
      code: 'ATTN_INPUT',
      message: `${what} must be one of ${AWARENESS_STATE_VALUES.join('|')} (got ${JSON.stringify(String(state))})`,
    })
  }
}

function assertEpoch(value: number, what: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AttentionError({
      code: 'ATTN_INPUT',
      message: `${what} must be a non-negative safe integer epoch ms (got ${String(value)}; §1.2/A-3)`,
    })
  }
}
