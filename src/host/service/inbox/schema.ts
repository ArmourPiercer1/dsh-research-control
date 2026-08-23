/**
 * WP-6.4 — `inbox_item` 表: DDL + 行↔记录映射 + SQL（纯数据, 零 I/O）。
 *
 * 表映射（DOMAIN_SCHEMA §15 逐字）:
 *   - `inbox_item` — PK `id`; 关键索引 `(state, created_at)`（GUI 列表面:
 *     CAPTURED 待处理组按捕获序 — 本 WP Inbox 视图的数据面）。
 * §15 通则: operational 表**不 hard delete** 一等 identity 行（INV-HIST-7）。
 *
 * 冻结行形状 = `schema/operational/inbox.schema.json` `$defs/InboxItem`
 * （7 键 snake_case, additionalProperties:false; 本文件的列集与其逐字
 * 同构 — `InboxItemRecord` 类型面同款的 SQL 侧）。
 *
 * DatabaseSync 封装模式（同 WP-3.1 planfork / WP-3.5 flooding / WP-5.3
 * reporting 双连接）:
 *   1. DB 文件的 open/初始化（0o700/0o600、WAL、user_version 门、
 *      quick_check）归 WP-2.1 `openDatabase` 封装;
 *   2. 本模块 DDL 在**第二连接**上以幂等 `IF NOT EXISTS` 应用
 *      （`InboxStore` 构造时经注入 `FloodingDb.exec` — service 层驱动
 *      是注入的 I/O, 零 sqlite import, ARCHITECTURE §2.2）;
 *   3. 多连接 WAL 共存, 写经文件锁串行化（busy_timeout 同 store 默认）。
 *
 * 存储层不变量（trigger 级, 任何连接上生效 — 同 WP-3.5 先例）:
 *   - INV-HIST-7（§15 通则）: `inbox_item_no_delete` ABORT 任何 DELETE;
 *   - 内容不可变（§11 语义: capture 后 source/payload/raw/context_refs/
 *    created_at 不变 — 条目是 staging 快照, 修正 = 新条目）:
 *     `inbox_item_no_content_update` ABORT 任何对创建后不变列的 UPDATE —
 *     允许 UPDATE 的只有状态缓存列（state / converted_to）, 即 §13 迁移
 *     （CAPTURED → CONVERTED|DISMISSED; 仅用户 — actor 门在 service 层,
 *     本层只执行行侧机械动作, 同 WP-5.1 lifecycle store 分工）。
 *
 * 列类型:
 *   - `source` / `state` = 冻结枚举 CHECK（§1.4 逐字 7 值 / 3 值）;
 *   - `raw` = 任意 JSON 文本（§11「any」— 解码后由冻结形状网复验,
 *     NULL = 未提供）;
 *   - `context_refs` = JSON TypedRef[]（冻结 typedRef 形状 — 形状网复验）;
 *   - `converted_to` = JSON TypedRef 或 NULL（仅 CONVERTED 时有值 —
 *     共现纪律在 service 层: `convert` 唯一写点; trigger 不重复判定,
 *     同 WP-3.5 closed_at 共现注释口径）。
 */

import { INBOX_SOURCES, INBOX_STATES, type InboxItemRecord } from './types.js'

export const INBOX_ITEM_TABLE = 'inbox_item'

const DDL = `
CREATE TABLE IF NOT EXISTS ${INBOX_ITEM_TABLE} (
  id            TEXT    NOT NULL PRIMARY KEY,
  source        TEXT    NOT NULL CHECK (source IN (${INBOX_SOURCES.map((s) => `'${s}'`).join(', ')})),
  payload       TEXT    NOT NULL,           -- 文本/摘要（§11 必填, minLength 1）
  raw           TEXT,                       -- 原始数据 JSON（§11 可选, any — audit 细节/升级证据）
  context_refs  TEXT    NOT NULL,           -- JSON TypedRef[]（§11 可选, 缺省 []）
  state         TEXT    NOT NULL CHECK (state IN (${INBOX_STATES.map((s) => `'${s}'`).join(', ')})),
  converted_to  TEXT,                       -- JSON TypedRef（§11 可选 — 仅 CONVERTED 时）
  created_at    INTEGER NOT NULL            -- epoch ms（§1.2, A-3 修订）
);
-- §15 关键索引 (state, created_at): 列表面（CAPTURED 组按捕获序; 终态组归档）。
CREATE INDEX IF NOT EXISTS idx_inbox_item_state_created
  ON ${INBOX_ITEM_TABLE} (state, created_at);
-- §15 通则 / INV-HIST-7: 一等 identity 行不 hard delete。
CREATE TRIGGER IF NOT EXISTS inbox_item_no_delete
  BEFORE DELETE ON ${INBOX_ITEM_TABLE}
  BEGIN
    SELECT RAISE(ABORT, 'inbox_item rows are never deleted (DOMAIN_SCHEMA §15 通则; ARCHITECTURE §5.4 INV-HIST-7)');
  END;
-- 内容不可变半边: 创建后的 5 个内容列任何 UPDATE 都 ABORT（状态缓存列
-- state/converted_to 是 §13 迁移的唯一合法行侧面 — 仅用户, service 层
-- actor 门; trigger 只钉「内容列不可动」, 迁移合法性归 state-machine）。
CREATE TRIGGER IF NOT EXISTS inbox_item_no_content_update
  BEFORE UPDATE ON ${INBOX_ITEM_TABLE}
  WHEN NEW.id IS NOT OLD.id
   OR NEW.source IS NOT OLD.source
   OR NEW.payload IS NOT OLD.payload
   OR IFNULL(NEW.raw, '') IS NOT IFNULL(OLD.raw, '')
   OR NEW.context_refs IS NOT OLD.context_refs
   OR NEW.created_at IS NOT OLD.created_at
  BEGIN
    SELECT RAISE(ABORT, 'inbox_item content is immutable after capture (DOMAIN_SCHEMA §11; only the state-cache columns state/converted_to may change, user-only per §13/§28 显式确认)');
  END;
`

/** Full DDL (idempotent — re-applied on every store open, 同 WP-3.1 先例). */
export function inboxItemDdl(): string {
  return DDL
}

/** Tables this WP's DDL declares (EXPECTED-tables 诊断面). */
export const INBOX_TABLES = [INBOX_ITEM_TABLE] as const

/* ------------------------------------------------------------------ *
 * SQL statements（参数化; 驱动经 FloodingDb 端口）
 * ------------------------------------------------------------------ */

export const SQL_INSERT_INBOX_ITEM = `
INSERT INTO ${INBOX_ITEM_TABLE} (id, source, payload, raw, context_refs, state, converted_to, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`

export const SQL_SELECT_INBOX_ITEM_BY_ID = `SELECT * FROM ${INBOX_ITEM_TABLE} WHERE id = ?`

/** 列表查询（可选 state/source 过滤; 稳定顺序 created_at ASC, id ASC —
 *  §15 索引 (state, created_at) + id 兜底全序; 无隐藏过滤器, 调用方
 *  指名才过滤 — INV-ATTN-1 同款查询面纪律）。 */
export const SQL_LIST_INBOX_ITEMS = `SELECT * FROM ${INBOX_ITEM_TABLE} ORDER BY created_at ASC, id ASC`

/**
 * §13 迁移的行侧写（状态缓存两列; DDL 触发器放行的唯一 UPDATE 面）:
 * 条件 `AND state = ?`（乐观并发门）— 返回受影响行数（0 ⇒ 迁移期间
 * 状态已变, service 大声失败 IN_CONCURRENT_STATE）。
 */
export const SQL_UPDATE_INBOX_ITEM_STATE = `
UPDATE ${INBOX_ITEM_TABLE}
SET state = ?, converted_to = ?
WHERE id = ? AND state = ?
`

/* ------------------------------------------------------------------ *
 * Row ↔ record mapping（损坏行大声失败 — 同 WP-3.1 rowToPlanFork 纪律）
 * ------------------------------------------------------------------ */

const CORRUPT = (what: string, detail: string): never => {
  throw new Error(`inbox row corruption at ${what}: ${detail}`)
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
    return CORRUPT(what, `element must be a {kind, id} typedRef (got ${JSON.stringify(value)})`)
  }
}

/** Encode `InboxItemRecord` into the INSERT parameter list（列序 = DDL）。 */
export function inboxItemToParams(r: InboxItemRecord): (string | number | null)[] {
  return [
    r.id,
    r.source,
    r.payload,
    r.raw === undefined ? null : JSON.stringify(r.raw),
    JSON.stringify(r.context_refs.map((ref) => ({ kind: ref.kind, id: ref.id }))),
    r.state,
    r.converted_to === undefined ? null : JSON.stringify({ kind: r.converted_to.kind, id: r.converted_to.id }),
    r.created_at,
  ]
}

/** Decode an `inbox_item` row back to the record（throws on corruption）。 */
export function rowToInboxItem(row: Record<string, unknown>): InboxItemRecord {
  const source = row.source
  if (typeof source !== 'string' || !(INBOX_SOURCES as readonly string[]).includes(source)) {
    return CORRUPT('inbox_item.source', `unknown source ${JSON.stringify(String(source))}`)
  }
  const state = row.state
  if (typeof state !== 'string' || !(INBOX_STATES as readonly string[]).includes(state)) {
    return CORRUPT('inbox_item.state', `unknown state ${JSON.stringify(String(state))}`)
  }
  if (typeof row.id !== 'string') return CORRUPT('inbox_item.id', `expected string, got ${typeof row.id}`)
  if (typeof row.payload !== 'string') return CORRUPT('inbox_item.payload', `expected string, got ${typeof row.payload}`)
  if (typeof row.context_refs !== 'string') return CORRUPT('inbox_item.context_refs', `expected JSON string, got ${typeof row.context_refs}`)
  if (typeof row.created_at !== 'number') return CORRUPT('inbox_item.created_at', `expected number, got ${typeof row.created_at}`)
  const contextRefs = decodeJson<readonly unknown[]>(row.context_refs, 'inbox_item.context_refs')
  if (!Array.isArray(contextRefs)) return CORRUPT('inbox_item.context_refs', 'expected JSON array of typedRef')
  for (const ref of contextRefs) assertTypedRef(ref, 'inbox_item.context_refs')
  const convertedTo = row.converted_to === null || row.converted_to === undefined ? undefined : decodeJson<unknown>(row.converted_to, 'inbox_item.converted_to')
  if (convertedTo !== undefined) assertTypedRef(convertedTo, 'inbox_item.converted_to')
  const raw = row.raw === null || row.raw === undefined ? undefined : decodeJson<unknown>(row.raw, 'inbox_item.raw')
  return {
    id: row.id as string,
    source: source as InboxItemRecord['source'],
    payload: row.payload as string,
    context_refs: contextRefs as InboxItemRecord['context_refs'],
    state: state as InboxItemRecord['state'],
    created_at: row.created_at as number,
    ...(raw !== undefined ? { raw } : {}),
    ...(convertedTo !== undefined ? { converted_to: convertedTo as InboxItemRecord['converted_to'] } : {}),
  }
}
