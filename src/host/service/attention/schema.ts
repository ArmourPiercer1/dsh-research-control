/**
 * WP-5.4 — `awareness` 表: V1 DDL + 行映射（纯数据, 零 I/O）。
 *
 * 表映射（DOMAIN_SCHEMA §15 冻结行, 逐字）:
 *   `awareness` | PK `(object_kind, object_id)` | —
 * §15 无额外关键索引 ⇒ 本 DDL 只建 PK, 不造索引。
 *
 * DatabaseSync 封装模式（同 WP-3.1 planfork / WP-2.4 runbinding /
 * WP-3.5 flooding 双连接）:
 *   1. DB 文件 open/初始化（0o700/0o600、WAL、user_version 门）归
 *      WP-2.1 `openDatabase` 封装;
 *   2. 本模块 DDL 在**第二连接**上以幂等 `IF NOT EXISTS` 应用
 *      （`AwarenessStore` 构造时经注入 `AttentionDb.exec` — service 层
 *      驱动是注入的 I/O, 零 sqlite import, ARCHITECTURE §2.2）;
 *   3. 多连接 WAL 共存, 写经文件锁串行化。
 *
 * 冻结行形状 = `schema/operational/attention.schema.json` `$defs/Awareness`
 * （object_ref（kind 白名单 + id）/state/updated_at, additionalProperties:
 * false）— `object_ref` typedRef 按 §15 PK 拆两列（object_kind, object_id）;
 * snake_case, epoch-ms 整数（§1.2）。CHECK 与冻结枚举逐字。
 *
 * 存储层不变量（trigger 级, 任何连接上生效 — 同 WP-3.1 先例）:
 *   - INV-HIST-7 / §15 通则: operational 表不 hard delete 一等 identity 行
 *     —— `awareness_no_delete` ABORT 任何 DELETE（awareness 行是用户注意力
 *     状态的身份行; 「取消知悉」= 用户显式把 state 迁回, 不是删行）;
 *   - 内容不可变（PK = object_ref 即行身份）: `awareness_no_content_update`
 *     ABORT 任何对 object_kind/object_id 的 UPDATE — 允许 UPDATE 的只有
 *     状态缓存列（state/updated_at）, 即用户改状态的唯一合法行侧面
 *     （INV-PERM-2: 仅用户; service 层 actor 门是该行的 API 面落地）。
 */

import type { AwarenessKind, AwarenessRecord, AwarenessState } from './types.js'

export const AWARENESS_TABLE = 'awareness'

/** 冻结 kind 白名单（schema $defs/Awareness.object_ref.kind; INV-ATTN-4）作为 SQL CHECK 列表。 */
const AWARENESS_KIND_SQL = ['CLAIM', 'FACT', 'ARTIFACT', 'MILESTONE', 'INTERVENTION', 'PLAN_FORK'] as const
/** 冻结四态（schema $defs/Awareness.state; §19.1）作为 SQL CHECK 列表。 */
const AWARENESS_STATE_SQL = ['UNSEEN', 'SEEN', 'REVIEWED', 'ASSESSED'] as const

const DDL = `
CREATE TABLE IF NOT EXISTS ${AWARENESS_TABLE} (
  object_kind  TEXT    NOT NULL CHECK (object_kind IN ('CLAIM','FACT','ARTIFACT','MILESTONE','INTERVENTION','PLAN_FORK')),
  object_id    TEXT    NOT NULL,
  state        TEXT    NOT NULL CHECK (state IN ('UNSEEN','SEEN','REVIEWED','ASSESSED')),
  updated_at   INTEGER NOT NULL,               -- epoch ms（§1.2, A-3）
  PRIMARY KEY (object_kind, object_id)         -- §15 冻结 PK
);
-- §15 通则 / INV-HIST-7: 一等 identity 行不 hard delete。
CREATE TRIGGER IF NOT EXISTS awareness_no_delete
  BEFORE DELETE ON ${AWARENESS_TABLE}
  BEGIN
    SELECT RAISE(ABORT, 'awareness rows are never deleted (DOMAIN_SCHEMA §15 通则; ARCHITECTURE §5.4 INV-HIST-7)');
  END;
-- 内容不可变半边: PK（= object_ref 行身份）任何 UPDATE 都 ABORT。状态缓存列
-- state/updated_at 是唯一合法可动面（用户改状态, INV-PERM-2 仅用户 —
-- service 层 actor 门; 本 trigger 只钉「身份列不可动」, 与 WP-3.5
-- intervention_no_content_update 同形）。
CREATE TRIGGER IF NOT EXISTS awareness_no_content_update
  BEFORE UPDATE ON ${AWARENESS_TABLE}
  WHEN NEW.object_kind IS NOT OLD.object_kind
   OR NEW.object_id IS NOT OLD.object_id
  BEGIN
    SELECT RAISE(ABORT, 'awareness object_ref is immutable (DOMAIN_SCHEMA §9.5/§15 PK; only the state-cache columns state/updated_at may change, user-only per INV-PERM-2)');
  END;
`

/** Full DDL（idempotent — re-applied on every store open, 同 WP-3.1 先例）。 */
export function awarenessDdl(): string {
  return DDL
}

/** Tables this WP's DDL declares（EXPECTED-tables 诊断面 / TC-DB-004 注册）。 */
export const ATTENTION_TABLES = [AWARENESS_TABLE] as const

/** 冻结枚举（service/state 面 + 测试用）。 */
export const AWARENESS_KIND_VALUES: readonly AwarenessKind[] = AWARENESS_KIND_SQL
export const AWARENESS_STATE_VALUES: readonly AwarenessState[] = AWARENESS_STATE_SQL

/* ------------------------------------------------------------------ *
 * SQL statements（参数化; 驱动经 AttentionDb 端口）
 * ------------------------------------------------------------------ */

/**
 * 用户改状态（§9.5: 默认 UNSEEN, 仅用户修改）— upsert 到 PK 冲突行:
 * 新对象首见即建记录; 已有记录只动状态缓存列（state/updated_at）,
 * 身份列不变 ⇒ no_content_update trigger 不触发（同 WP-3.5 状态面口径）。
 */
export const SQL_UPSERT_AWARENESS = `
INSERT INTO ${AWARENESS_TABLE} (object_kind, object_id, state, updated_at)
VALUES (?, ?, ?, ?)
ON CONFLICT (object_kind, object_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
`

export const SQL_SELECT_AWARENESS = `SELECT * FROM ${AWARENESS_TABLE} WHERE object_kind = ? AND object_id = ?`

/** 稳定全量顺序（kind 升序, id 升序 — 视图/审计面）。 */
export const SQL_LIST_AWARENESS = `SELECT * FROM ${AWARENESS_TABLE} ORDER BY object_kind ASC, object_id ASC`

/* ------------------------------------------------------------------ *
 * Row ↔ record mapping（损坏行大声失败 — 同 WP-3.1 rowToPlanFork 纪律）
 * ------------------------------------------------------------------ */

const CORRUPT = (what: string, detail: string): never => {
  throw new Error(`awareness row corruption at ${what}: ${detail}`)
}

/** Encode 一行（列序 = DDL）。 */
export function awarenessToParams(record: AwarenessRecord): [string, string, string, number] {
  return [record.object_kind, record.object_id, record.state, record.updated_at]
}

/** `awareness` row → `AwarenessRecord`（throws on corruption）。 */
export function rowToAwareness(row: Record<string, unknown>): AwarenessRecord {
  const kind = row.object_kind
  if (typeof kind !== 'string' || !(AWARENESS_KIND_SQL as readonly string[]).includes(kind)) {
    return CORRUPT('awareness.object_kind', `unknown kind ${JSON.stringify(String(kind))}`)
  }
  const state = row.state
  if (typeof state !== 'string' || !(AWARENESS_STATE_SQL as readonly string[]).includes(state)) {
    return CORRUPT('awareness.state', `unknown state ${JSON.stringify(String(state))}`)
  }
  if (typeof row.object_id !== 'string' || row.object_id.length === 0) {
    return CORRUPT('awareness.object_id', `expected non-empty string, got ${JSON.stringify(String(row.object_id))}`)
  }
  if (typeof row.updated_at !== 'number' || !Number.isSafeInteger(row.updated_at) || row.updated_at < 0) {
    return CORRUPT('awareness.updated_at', `expected non-negative safe integer epoch ms, got ${String(row.updated_at)}`)
  }
  return {
    object_kind: kind as AwarenessKind,
    object_id: row.object_id,
    state: state as AwarenessState,
    updated_at: row.updated_at,
  }
}
