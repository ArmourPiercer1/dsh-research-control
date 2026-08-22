/**
 * WP-3.5 — `InterventionStore`: AUTO_FLOODING Intervention 落库 + 查询面
 * （append-only; 无 delete, 无迁移 — INV-HIST-7 / INV-PERM-4 的 API 面）。
 *
 * 写入面（本 WP 唯一写入者 = `FloodingService` 的 §8 动作路径）:
 *   - `insertIntervention(record)` — 记录带已分配 IV id（service 协调
 *     IV+H 双号, 见 service.ts）; 落库前整行过**真实冻结**
 *     `$defs/Intervention`（schemas.ts — 类型面同构的运行时网, 同
 *     WP-3.1 `checkRecordShape` 纪律; 不可用 ⇒ FLOODING_SCHEMA_UNAVAILABLE
 *     fail loud, 绝不在无 schema 时放行）。
 *
 * 查询面:
 *   - `getIntervention(id)` / `listInterventions({workstreamId?, status?,
 *     origin?})`（§15 索引 (status) + per-WS/origin 面; 稳定顺序
 *     created_at ASC, id ASC）;
 *   - `findOpenAutoFlooding(workstreamId)` — §8 规则后半句 + 任务「重复
 *     抑制」的探针: 该 WS 已存在 origin=AUTO_FLOODING 的 OPEN Intervention
 *     ⇒ 不重复建。
 *
 * 不变量（API 面）:
 *   - **无 delete 方法**（§15 通则 / INV-HIST-7; 存储层 trigger 兜底任何
 *     连接的 raw DELETE）;
 *   - **无任何迁移/更新方法**（INV-PERM-4「Intervention 状态只允许用户
 *     显式修改」— 本 WP 不提供任何非用户迁移面, 类型面即闭集; 状态缓存列
 *     的 UPDATE 触发面留给未来用户面 WP, 存储层 trigger 已钉内容列不可动）。
 *
 * 错误纪律（同 WP-3.1）: `FloodingError` 原样穿透（caller-owned）;
 * 驱动/SQL 失败包 FLOODING_STORE（cause 保留）。
 */

import {
  interventionDdl,
  interventionToParams,
  rowToIntervention,
  SQL_FIND_OPEN_AUTO_FLOODING,
  SQL_INSERT_INTERVENTION,
  SQL_SELECT_INTERVENTION_BY_ID,
  INTERVENTION_TABLE,
} from './schema.js'
import {
  FloodingError,
  IV_STATUSES,
  INTERVENTION_ORIGINS,
  type InterventionListFilter,
  type InterventionRecord,
  type InterventionSchemas,
  type InterventionStoreOptions,
  type FloodingDb,
} from './types.js'

export class InterventionStore {
  private readonly db: FloodingDb
  private readonly schemas: InterventionSchemas
  private closed = false

  constructor(options: InterventionStoreOptions) {
    if (options.db === undefined || typeof options.db.exec !== 'function' || typeof options.db.run !== 'function') {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'db: the injected operational-DB face (exec/run/get/all/transaction) is required' })
    }
    if (options.schemas === undefined || typeof options.schemas.checkInterventionShape !== 'function') {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'schemas: the frozen attention schema face (loadInterventionSchemas) is required' })
    }
    this.db = options.db
    this.schemas = options.schemas
    // Idempotent DDL (IF NOT EXISTS) — re-applied on every open（同 WP-3.1
    // / WP-2.4 先例）: 第二连接开库后, intervention 表 + 索引 + trigger 就位。
    this.db.exec(interventionDdl())
  }

  /* ---------------------------------------------------------------- *
   * Write face（§8 动作路径的唯一写入者: FloodingService）
   * ---------------------------------------------------------------- */

  /**
   * Insert ONE intervention row（单语句 autocommit — 事件 append 在
   * WP-2.1 store 连接上先行, 两连接间无跨事务, service.ts 头注）。
   * 落库前: 整行冻结形状网（FLOODING_SCHEMA_UNAVAILABLE / FLOODING_INPUT）。
   */
  insertIntervention(record: InterventionRecord): InterventionRecord {
    this.#assertOpen('insertIntervention')
    this.#assertShape(record)
    if (!this.schemas.isUsable) {
      throw new FloodingError({
        code: 'FLOODING_SCHEMA_UNAVAILABLE',
        message: 'frozen attention schema set unavailable — no intervention row can be shape-checked (see InterventionSchemas.loadErrors)',
      })
    }
    const shape = this.schemas.checkInterventionShape(record)
    if (!shape.ok) {
      throw new FloodingError({
        code: 'FLOODING_INPUT',
        message: `internal: intervention record failed the frozen attention schema: ${shape.errors.map((e) => `${e.path || '/'}: ${e.message}`).join(' | ')}`,
      })
    }
    try {
      this.db.run(SQL_INSERT_INTERVENTION, ...interventionToParams(record))
    } catch (cause) {
      throw this.#wrap('insertIntervention', cause)
    }
    return record
  }

  /** 冻结形状前的廉价边界断言（精确指名失败项 — 同 WP-3.1 assertEpoch 纪律）。 */
  #assertShape(record: InterventionRecord): void {
    if (record === null || typeof record !== 'object') {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'insertIntervention: record must be an InterventionRecord object' })
    }
    if (typeof record.id !== 'string' || !/^IV-[1-9][0-9]*$/.test(record.id)) {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: `insertIntervention: id must be a well-formed IV id (got ${JSON.stringify(String(record.id))})` })
    }
    if (typeof record.title !== 'string' || record.title.length === 0) {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'insertIntervention: title must be a non-empty string (§9.2)' })
    }
    if (typeof record.origin !== 'string' || !(INTERVENTION_ORIGINS as readonly string[]).includes(record.origin)) {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: `insertIntervention: origin must be one of ${INTERVENTION_ORIGINS.join('|')} (got ${JSON.stringify(String(record.origin))})` })
    }
    if (typeof record.status !== 'string' || !(IV_STATUSES as readonly string[]).includes(record.status)) {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: `insertIntervention: status must be one of ${IV_STATUSES.join('|')} (got ${JSON.stringify(String(record.status))})` })
    }
    if (!Array.isArray(record.workstream_ids) || record.workstream_ids.some((ws) => typeof ws !== 'string' || ws.length === 0)) {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'insertIntervention: workstream_ids must be an array of non-empty WS id strings (§9.2)' })
    }
    if (!Array.isArray(record.source_refs) || record.source_refs.some((ref) => ref === null || typeof ref !== 'object' || typeof ref.kind !== 'string' || typeof ref.id !== 'string')) {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'insertIntervention: source_refs must be an array of {kind, id} typedRefs (§9.2)' })
    }
    if (record.created_by === null || typeof record.created_by !== 'object' || typeof record.created_by.kind !== 'string') {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'insertIntervention: created_by must be a frozen actorRef (kind ∈ USER|AGENT|PLUGIN|SYSTEM; §9.2)' })
    }
    if (typeof record.created_at !== 'number' || !Number.isSafeInteger(record.created_at) || record.created_at < 0) {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: `insertIntervention: created_at must be a non-negative safe integer epoch ms (got ${String(record.created_at)}; §1.2/A-3)` })
    }
  }

  /* ---------------------------------------------------------------- *
   * Query face（只读; 无 delete — INV-HIST-7; 无迁移 — INV-PERM-4）
   * ---------------------------------------------------------------- */

  /** One record by id（`null` when absent）。 */
  getIntervention(id: string): InterventionRecord | null {
    this.#assertOpen('getIntervention')
    assertNonEmpty(id, 'id')
    const row = this.db.get(SQL_SELECT_INTERVENTION_BY_ID, id)
    return row === undefined ? null : rowToIntervention(row)
  }

  /**
   * List by (workstreamId?, status?, origin?) — 稳定顺序
   * created_at ASC, id ASC。status/origin 走 SQL（§15 索引 (status)）;
   * workstreamId 过滤 = workstream_ids **含**该 WS（关联语义, 非仅第一个）
   * — WS 关联在 JSON 列内, node:sqlite 无 JSON 函数 ⇒ JS 侧成员过滤。
   */
  listInterventions(filter: InterventionListFilter = {}): InterventionRecord[] {
    this.#assertOpen('listInterventions')
    const clauses: string[] = []
    const params: (string | number)[] = []
    if (filter.workstreamId !== undefined) {
      assertNonEmpty(filter.workstreamId, 'filter.workstreamId')
    }
    if (filter.status !== undefined) {
      if (typeof filter.status !== 'string' || !(IV_STATUSES as readonly string[]).includes(filter.status)) {
        throw new FloodingError({ code: 'FLOODING_INPUT', message: `filter.status must be one of ${IV_STATUSES.join('|')} (got ${JSON.stringify(String(filter.status))})` })
      }
      clauses.push('status = ?')
      params.push(filter.status)
    }
    if (filter.origin !== undefined) {
      if (typeof filter.origin !== 'string' || !(INTERVENTION_ORIGINS as readonly string[]).includes(filter.origin)) {
        throw new FloodingError({ code: 'FLOODING_INPUT', message: `filter.origin must be one of ${INTERVENTION_ORIGINS.join('|')} (got ${JSON.stringify(String(filter.origin))})` })
      }
      clauses.push('origin = ?')
      params.push(filter.origin)
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    const rows = this.db.all(`SELECT * FROM ${INTERVENTION_TABLE} ${where} ORDER BY created_at ASC, id ASC`, ...params)
    let records = rows.map((r) => rowToIntervention(r))
    if (filter.workstreamId !== undefined) {
      const ws = filter.workstreamId
      records = records.filter((r) => r.workstream_ids.includes(ws))
    }
    return records
  }

  /**
   * §8 规则后半句 / 重复抑制探针: 该 WS 是否存在 origin=AUTO_FLOODING 的
   * OPEN Intervention（存在 ⇒ 不重复建 — 同 WS 已有 OPEN 时不重复建）。
   * WS 成员在 JS 侧判定（JSON 列; node:sqlite 无 JSON 函数）, 取
   * created_at ASC, id ASC 第一个。
   */
  findOpenAutoFlooding(workstreamId: string): InterventionRecord | null {
    this.#assertOpen('findOpenAutoFlooding')
    assertNonEmpty(workstreamId, 'workstreamId')
    const rows = this.db.all(SQL_FIND_OPEN_AUTO_FLOODING)
    for (const row of rows) {
      const record = rowToIntervention(row)
      if (record.workstream_ids.includes(workstreamId)) return record
    }
    return null
  }

  /* ---------------------------------------------------------------- */

  #assertOpen(operation: string): void {
    if (this.closed) throw new FloodingError({ code: 'FLOODING_STORE', message: `${operation}: store is closed` })
  }

  /** Test/inspection seam（no-op 语义: store 无生命周期状态可关）。 */
  close(): void {
    this.closed = true
  }

  #wrap(context: string, cause: unknown): FloodingError {
    const msg = cause instanceof Error ? cause.message : String(cause)
    return new FloodingError({ code: 'FLOODING_STORE', message: `${context}: ${msg}`, cause })
  }
}

function assertNonEmpty(value: string, what: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new FloodingError({ code: 'FLOODING_INPUT', message: `${what} must be a non-empty string` })
  }
}
