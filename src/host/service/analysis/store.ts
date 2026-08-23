/**
 * WP-7.3 — `AnalysisStore`: analysis_record 行的存储面（insert + 查询;
 * append-only 快照语义）。
 *
 * 表 / 触发器 / 行形状 = 本 WP schema.ts（`analysis_record` DDL — 第二连接
 * 模式: 多连接 WAL 共存, 写经文件锁串行化, 同 WP-3.1/WP-3.5/WP-5.3/WP-6.4
 * 先例; 构造时对注入连接幂等应用 `analysisRecordDdl()`）。
 *
 * 面（API 面即权限面 — 同 WP-3.5/WP-6.4 纪律）:
 *   - **无 delete 方法**（§15 通则 / INV-HIST-7; 存储层 trigger 兜底任何
 *     连接的 raw DELETE）;
 *   - **无 UPDATE 方法**（§12.2 快照语义: 保存后全字段不可变 — 6 列全是
 *     内容列, 无状态缓存列可放行; 修正 = 新记录, 用户再显式保存 —
 *     trigger 兜底任何连接的 raw UPDATE）;
 *   - 查询**无隐藏过滤器**: `listRecords` 按 (sourceKind?, sourceId?)
 *     任一子集过滤, 全部参数缺省 = 全量（稳定顺序 created_at ASC,
 *     id ASC — §15 无索引, id 兜底全序）。
 *
 * 错误纪律: 边界参数畸形 = AN_INPUT; 形状网不可用/整行违例 = AN_INPUT
 * （与冻结网同类的「输入不合法」分类）; 驱动/SQL 失败包 AN_STORE
 * （cause 保留）。
 */

import type { PlanForkDb } from '../../domain/planfork/index.js'
import {
  analysisRecordDdl,
  analysisRecordToParams,
  rowToAnalysisRecord,
  SQL_INSERT_ANALYSIS_RECORD,
  SQL_LIST_ANALYSIS_RECORDS,
  SQL_SELECT_ANALYSIS_RECORD_BY_ID,
} from './schema.js'
import {
  AN_ID_PATTERN,
  AnalysisError,
  type AnalysisListFilter,
  type AnalysisRecordRecord,
  type AnalysisSchemas,
} from './types.js'

export interface AnalysisStoreOptions {
  /** 本 store 的连接面（第二连接 — exec 幂等 DDL / run 写 / get+all 读）。 */
  readonly db: PlanForkDb
  /** 冻结 provenance.schema.json 形状网（insert 整行网 — 同 WP-6.4 先例）。 */
  readonly schemas: AnalysisSchemas
}

export class AnalysisStore {
  readonly #db: PlanForkDb
  readonly #schemas: AnalysisSchemas
  private closed = false

  constructor(options: AnalysisStoreOptions) {
    if (options.db === undefined || typeof options.db.exec !== 'function' || typeof options.db.run !== 'function') {
      throw new AnalysisError({ code: 'AN_INPUT', message: 'db: the injected operational-DB face (exec/run/get/all) is required' })
    }
    if (options.schemas === undefined || typeof options.schemas.checkAnalysisShape !== 'function') {
      throw new AnalysisError({ code: 'AN_INPUT', message: 'schemas: the frozen provenance schema face (loadAnalysisSchemas) is required' })
    }
    this.#db = options.db
    this.#schemas = options.schemas
    // 幂等 DDL（IF NOT EXISTS）— 第二连接开库后表 + 触发器就位
    // （同 WP-3.1 / WP-3.5 / WP-5.3 / WP-6.4 先例; DDL 单一来源在本 WP
    // schema.ts）。
    this.#db.exec(analysisRecordDdl())
  }

  /* ---------------------------------------------------------------- *
   * 写面（唯一 — 用户显式保存的落库执行体; actor 门在 service 层）
   * ---------------------------------------------------------------- */

  /**
   * Insert ONE analysis_record row（单语句 autocommit）。落库前: 整行过
   * **真实冻结** `$defs/AnalysisRecord`（shape net 不可用 ⇒ AN_STORE 大声
   * 失败, 绝不在无 schema 时放行 — 同 WP-6.4 口径; 整行违例 ⇒ AN_INPUT）。
   * 调用方（service）负责 AN 号 reserve/commit + 用户门。
   */
  insertRecord(record: AnalysisRecordRecord): AnalysisRecordRecord {
    this.#assertOpen('insertRecord')
    if (record === null || typeof record !== 'object') {
      throw new AnalysisError({ code: 'AN_INPUT', message: 'insertRecord: record must be an AnalysisRecordRecord object' })
    }
    if (!this.#schemas.isUsable) {
      throw new AnalysisError({
        code: 'AN_STORE',
        message: 'frozen provenance schema set unavailable — no analysis record can be shape-checked (see AnalysisSchemas.loadErrors)',
      })
    }
    const shape = this.#schemas.checkAnalysisShape(record)
    if (!shape.ok) {
      throw new AnalysisError({
        code: 'AN_INPUT',
        message: `internal: analysis record failed the frozen AnalysisRecord schema: ${shape.errors.map((e) => `${e.path || '/'}: ${e.message}`).join(' | ')}`,
      })
    }
    try {
      this.#db.run(SQL_INSERT_ANALYSIS_RECORD, ...analysisRecordToParams(record))
    } catch (cause) {
      throw this.#wrap('insertRecord', cause)
    }
    return record
  }

  /* ---------------------------------------------------------------- *
   * 查询面（无 delete / 无 update — INV-HIST-7 + 快照不可变）
   * ---------------------------------------------------------------- */

  /** One record by id（`null` when absent）。 */
  getRecord(id: string): AnalysisRecordRecord | null {
    this.#assertOpen('getRecord')
    if (typeof id !== 'string' || !AN_ID_PATTERN.test(id)) {
      throw new AnalysisError({ code: 'AN_INPUT', message: `getRecord: id must be a well-formed AN id (got ${JSON.stringify(String(id))})` })
    }
    try {
      const row = this.#db.get(SQL_SELECT_ANALYSIS_RECORD_BY_ID, id)
      return row === undefined ? null : rowToAnalysisRecord(row)
    } catch (cause) {
      throw this.#wrap('getRecord', cause)
    }
  }

  /** List by (sourceKind?, sourceId?) — 稳定顺序 created_at ASC, id ASC
   *  （全缺省 = 全量; 过滤参数由调用方显式指名 — 无隐藏过滤器）。 */
  listRecords(filter: AnalysisListFilter = {}): AnalysisRecordRecord[] {
    this.#assertOpen('listRecords')
    if (filter.sourceKind !== undefined && (typeof filter.sourceKind !== 'string' || filter.sourceKind.length === 0)) {
      throw new AnalysisError({ code: 'AN_INPUT', message: `listRecords.filter.sourceKind must be a non-empty string (got ${JSON.stringify(filter.sourceKind)})` })
    }
    if (filter.sourceId !== undefined && (typeof filter.sourceId !== 'string' || filter.sourceId.length === 0)) {
      throw new AnalysisError({ code: 'AN_INPUT', message: `listRecords.filter.sourceId must be a non-empty string (got ${JSON.stringify(filter.sourceId)})` })
    }
    try {
      const rows = this.#db.all(SQL_LIST_ANALYSIS_RECORDS)
      const records = rows.map((row) => rowToAnalysisRecord(row))
      const kind = filter.sourceKind
      const id = filter.sourceId
      if (kind === undefined && id === undefined) return records
      return records.filter((r) => (kind === undefined || r.source_ref.kind === kind) && (id === undefined || r.source_ref.id === id))
    } catch (cause) {
      throw this.#wrap('listRecords', cause)
    }
  }

  /* ---------------------------------------------------------------- */

  #assertOpen(operation: string): void {
    if (this.closed) throw new AnalysisError({ code: 'AN_STORE', message: `${operation}: store is closed` })
  }

  /** Test/inspection seam（no-op 语义: store 无生命周期状态可关 — 连接
   *  归 wiring 的单一 disposer, 同 WP-6.4 先例）。 */
  close(): void {
    this.closed = true
  }

  #wrap(context: string, cause: unknown): AnalysisError {
    if (cause instanceof AnalysisError) throw cause
    const msg = cause instanceof Error ? cause.message : String(cause)
    return new AnalysisError({ code: 'AN_STORE', message: `${context}: ${msg}`, cause })
  }
}
