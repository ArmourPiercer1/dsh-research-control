/**
 * WP-7.3 — `analysis_record` 表: DDL + 行↔记录映射 + SQL（纯数据, 零 I/O）。
 *
 * 表映射（DOMAIN_SCHEMA §15 逐字）:
 *   - `analysis_record` — PK `id`; §15 表行**未列关键索引**（management_
 *     action / analysis_record 同格, 索引列空白）⇒ 不建索引, 不虚构
 *     （列表查询稳定顺序 = created_at ASC, id ASC 全序兜底）。
 * §15 通则: operational 表**不 hard delete** 一等 identity 行（INV-HIST-7）。
 *
 * 冻结行形状 = `schema/operational/provenance.schema.json`
 * `$defs/AnalysisRecord`（6 键 snake_case, additionalProperties:false;
 * 本文件的列集与其逐字同构 — `AnalysisRecordRecord` 类型面同款的
 * SQL 侧）。
 *
 * DatabaseSync 封装模式（同 WP-3.1 planfork / WP-3.5 flooding / WP-5.3
 * reporting / WP-6.4 inbox 双连接）:
 *   1. DB 文件的 open/初始化（0o700/0o600、WAL、user_version 门、
 *      quick_check）归 WP-2.1 `openDatabase` 封装;
 *   2. 本模块 DDL 在**第二连接**上以幂等 `IF NOT EXISTS` 应用
 *      （`AnalysisStore` 构造时经注入 db face 的 `exec` — service 层
 *      驱动是注入的 I/O, 零 sqlite import, ARCHITECTURE §2.2）;
 *   3. 多连接 WAL 共存, 写经文件锁串行化（busy_timeout 同 store 默认）。
 *
 * 存储层不变量（trigger 级, 任何连接上生效 — 同 WP-6.4 先例）:
 *   - INV-HIST-7（§15 通则）: `analysis_record_no_delete` ABORT 任何
 *     DELETE;
 *   - 快照不可变（§12.2 语义: AnalysisRecord 是**保存时点**的分析快照 —
 *     无 §13 状态机行, 6 列全是内容列; 修正 = 新记录, 用户再显式保存,
 *     不改写已保存的历史）: `analysis_record_no_update` ABORT **任何**
 *     UPDATE — 无状态缓存列可放行（与 inbox 的差异: inbox 保留
 *     state/converted_to 状态缓存列, 本表无状态面, 故 UPDATE 面为零）。
 *
 * 列类型:
 *   - `source_ref` = JSON TypedRef（冻结 typedRef 形状 — 解码后由冻结
 *     形状网复验, 落库前整行网已验）;
 *   - `investigator_run_id` = 冻结 idRun 模式文本（`^R-[1-9][0-9]*$` —
 *     形状网在落库前复验; NULL = 未提供）;
 *   - `dsh_session_id` = 自由文本（DSH session id 是宿主侧 branded
 *     string, 无插件侧模式约束 — 冻结 schema 只钉 type string）;
 *   - `content` = Markdown 文本（minLength 1 — 形状网在落库前复验）。
 */

import type { TypedRef } from '../../history/registry/index.js'
import type { AnalysisRecordRecord } from './types.js'

export const ANALYSIS_RECORD_TABLE = 'analysis_record'

const DDL = `
CREATE TABLE IF NOT EXISTS ${ANALYSIS_RECORD_TABLE} (
  id                  TEXT    NOT NULL PRIMARY KEY,
  source_ref          TEXT    NOT NULL,          -- JSON TypedRef（Intervention / Audit finding / Brief — 冻结 typedRef 形状）
  investigator_run_id TEXT,                      -- R-<n>（§12.2 可选 — 冻结 idRun 模式; NULL = 未提供）
  dsh_session_id      TEXT,                      -- DSH session id（§12.2 可选; INV-DB-2 只存指针）
  content             TEXT    NOT NULL,          -- Markdown（§12.2 必填, minLength 1）
  created_at          INTEGER NOT NULL           -- epoch ms（§1.2, A-3 修订）
);
-- §15 通则 / INV-HIST-7: 一等 identity 行不 hard delete。
CREATE TRIGGER IF NOT EXISTS analysis_record_no_delete
  BEFORE DELETE ON ${ANALYSIS_RECORD_TABLE}
  BEGIN
    SELECT RAISE(ABORT, 'analysis_record rows are never deleted (DOMAIN_SCHEMA §15 通则; ARCHITECTURE §5.4 INV-HIST-7)');
  END;
-- 快照不可变: §12.2 AnalysisRecord 是保存时点快照（无状态面 — 6 列全是
-- 内容列）— 任何 UPDATE 都 ABORT; 修正 = 新记录（用户再次显式保存）。
CREATE TRIGGER IF NOT EXISTS analysis_record_no_update
  BEFORE UPDATE ON ${ANALYSIS_RECORD_TABLE}
  BEGIN
    SELECT RAISE(ABORT, 'analysis_record is immutable after save (DOMAIN_SCHEMA §12.2 — a saved analysis is a snapshot; a correction is a NEW record, user-explicit; no UPDATE face exists)');
  END;
`

/** Full DDL (idempotent — re-applied on every store open, 同 WP-3.1 先例). */
export function analysisRecordDdl(): string {
  return DDL
}

/** Tables this WP's DDL declares (EXPECTED-tables 诊断面). */
export const ANALYSIS_TABLES = [ANALYSIS_RECORD_TABLE] as const

/* ------------------------------------------------------------------ *
 * SQL statements（参数化; 驱动经注入 db face 端口）
 * ------------------------------------------------------------------ */

export const SQL_INSERT_ANALYSIS_RECORD = `
INSERT INTO ${ANALYSIS_RECORD_TABLE} (id, source_ref, investigator_run_id, dsh_session_id, content, created_at)
VALUES (?, ?, ?, ?, ?, ?)
`

export const SQL_SELECT_ANALYSIS_RECORD_BY_ID = `SELECT * FROM ${ANALYSIS_RECORD_TABLE} WHERE id = ?`

/** 列表查询（稳定顺序 created_at ASC, id ASC — 全序兜底; §15 无索引。
 *  source_ref 过滤在 store 层对解码后的行做 — JSON 文本列不做 SQL 侧
 *  模式猜测, 无隐藏过滤器, 调用方指名才过滤）。 */
export const SQL_LIST_ANALYSIS_RECORDS = `SELECT * FROM ${ANALYSIS_RECORD_TABLE} ORDER BY created_at ASC, id ASC`

/* ------------------------------------------------------------------ *
 * Row ↔ record mapping（损坏行大声失败 — 同 WP-3.1 / WP-6.4 纪律）
 * ------------------------------------------------------------------ */

const CORRUPT = (what: string, detail: string): never => {
  throw new Error(`analysis_record row corruption at ${what}: ${detail}`)
}

function decodeJson<T>(value: unknown, what: string): T {
  if (typeof value !== 'string') return CORRUPT(what, `expected JSON string, got ${typeof value}`)
  try {
    return JSON.parse(value) as T
  } catch (cause) {
    return CORRUPT(what, `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

function assertTypedRef(value: unknown, what: string): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as { kind?: unknown }).kind !== 'string' ||
    typeof (value as { id?: unknown }).id !== 'string'
  ) {
    return CORRUPT(what, `must be a {kind, id} typedRef (got ${JSON.stringify(value)})`)
  }
}

/** Encode `AnalysisRecordRecord` into the INSERT parameter list（列序 = DDL）。 */
export function analysisRecordToParams(r: AnalysisRecordRecord): (string | number | null)[] {
  return [
    r.id,
    JSON.stringify({ kind: r.source_ref.kind, id: r.source_ref.id }),
    r.investigator_run_id === undefined ? null : r.investigator_run_id,
    r.dsh_session_id === undefined ? null : r.dsh_session_id,
    r.content,
    r.created_at,
  ]
}

/** Decode an `analysis_record` row back to the record（throws on corruption）。 */
export function rowToAnalysisRecord(row: Record<string, unknown>): AnalysisRecordRecord {
  if (typeof row.id !== 'string') return CORRUPT('analysis_record.id', `expected string, got ${typeof row.id}`)
  if (typeof row.source_ref !== 'string') return CORRUPT('analysis_record.source_ref', `expected JSON string, got ${typeof row.source_ref}`)
  if (typeof row.content !== 'string') return CORRUPT('analysis_record.content', `expected string, got ${typeof row.content}`)
  if (typeof row.created_at !== 'number') return CORRUPT('analysis_record.created_at', `expected number, got ${typeof row.created_at}`)
  const sourceRef = decodeJson<unknown>(row.source_ref, 'analysis_record.source_ref')
  assertTypedRef(sourceRef, 'analysis_record.source_ref')
  const investigatorRunId =
    row.investigator_run_id === null || row.investigator_run_id === undefined
      ? undefined
      : (row.investigator_run_id as string)
  if (investigatorRunId !== undefined && typeof investigatorRunId !== 'string') {
    return CORRUPT('analysis_record.investigator_run_id', `expected string or NULL, got ${typeof investigatorRunId}`)
  }
  const dshSessionId =
    row.dsh_session_id === null || row.dsh_session_id === undefined ? undefined : (row.dsh_session_id as string)
  if (dshSessionId !== undefined && typeof dshSessionId !== 'string') {
    return CORRUPT('analysis_record.dsh_session_id', `expected string or NULL, got ${typeof dshSessionId}`)
  }
  return {
    id: row.id,
    source_ref: sourceRef as TypedRef,
    content: row.content,
    created_at: row.created_at,
    ...(investigatorRunId !== undefined ? { investigator_run_id: investigatorRunId } : {}),
    ...(dshSessionId !== undefined ? { dsh_session_id: dshSessionId } : {}),
  }
}
