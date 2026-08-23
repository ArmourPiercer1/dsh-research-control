/**
 * WP-5.2 — `next_action` + `blocker` 表: DDL + 行↔记录映射 + SQL（纯数据, 零 I/O）。
 *
 * 表映射（DOMAIN_SCHEMA §15 L621, 逐字）:
 *   - `next_action` / `blocker` — 主键 `id`；§15 未列关键索引（「| |」空）
 *     ⇒ 索引为本 WP 自加的查询面（GUI 分组/显著区列表）, 不违反 §15
 *     （§15 是映射概要, 与 WP-2.9 history_event 加索引同口径 — 只增不改）。
 * §15 通则: operational 表**不 hard delete** 一等 identity 行（INV-HIST-7）。
 *
 * 冻结行形状 = `schema/operational/attention.schema.json`
 * `$defs/NextAction`（8 键）/ `$defs/Blocker`（9 键）— additionalProperties:false;
 * 本文件列集与其逐字同构（snake_case; JSON TEXT 承载结构化值 — §15 通则）。
 *
 * DatabaseSync 封装模式（同 WP-3.1 planfork / WP-3.5 intervention 先例）:
 *   1. DB 文件 open/初始化归 WP-2.1 `openDatabase`;
 *   2. 本模块 DDL 在第二连接上以幂等 `IF NOT EXISTS` 应用
 *     （`ActionsStore` 构造时经注入 `ActionsDb.exec`）;
 *   3. 多连接 WAL 共存, 写经文件锁串行化。
 *
 * 存储层不变量（trigger 级, 任何连接上生效 — 同 WP-3.1/WP-3.5 先例）:
 *   - INV-HIST-7（§15 通则）: `*_no_delete` ABORT 任何 DELETE;
 *   - 内容不可变: `*_no_content_update` ABORT 任何对创建后不变列的 UPDATE —
 *     NextAction 内容列 = id/workstream_id/statement/rationale/created_by/
 *     created_at（状态面只有 §13 迁移: status + promoted_to_task_id）;
 *     Blocker 内容列 = id/statement/affects/source/references/created_at
 *     （状态面只有 §13 迁移: status + cleared_at）;
 *   - 终态不可回（§13 双终态）: `*_no_status_regression` — 任何把状态改回
 *     初始态（PROPOSED/ACTIVE）的 UPDATE 都 ABORT（并发双迁移竞争与 raw
 *     SQL 改写的存储层兜底; 合法迁移面只有一条条件 UPDATE, service 层
 *     另有 §13 纯守卫）;
 *   - 字段共现 CHECK（§9.3/§9.4 字段表必填语义）:
 *     `promoted_to_task_id` ⇔ status='PROMOTED'; `cleared_at` ⇔ status='CLEARED'。
 */

import {
  type AffectsRef,
  type BlockerRecord,
  type NaStatus,
  type NextActionRecord,
} from './types.js'

export const NEXT_ACTION_TABLE = 'next_action'
export const BLOCKER_TABLE = 'blocker'

const DDL = `
CREATE TABLE IF NOT EXISTS ${NEXT_ACTION_TABLE} (
  id                  TEXT    NOT NULL PRIMARY KEY,
  workstream_id       TEXT,                         -- 可选（§9.3 ❌）
  statement           TEXT    NOT NULL,
  rationale           TEXT,
  status              TEXT    NOT NULL CHECK (status IN ('PROPOSED', 'PROMOTED', 'DISMISSED')),
  promoted_to_task_id TEXT,
  created_by          TEXT    NOT NULL,             -- ActorRef JSON（USER 或 AGENT）
  created_at          INTEGER NOT NULL,             -- epoch ms（§1.2, A-3）
  -- 字段共现（§9.3: promoted_to_task_id 「PROMOTE 时生成」）:
  CHECK (status = 'PROMOTED' OR promoted_to_task_id IS NULL),
  CHECK (status <> 'PROMOTED' OR promoted_to_task_id IS NOT NULL)
);
-- 查询面索引（GUI: 按状态分组 / 按 WS 过滤; §15 未列 ⇒ 本 WP 自加, 只增）。
CREATE INDEX IF NOT EXISTS idx_next_action_status
  ON ${NEXT_ACTION_TABLE} (status);
CREATE INDEX IF NOT EXISTS idx_next_action_workstream
  ON ${NEXT_ACTION_TABLE} (workstream_id);
-- §15 通则 / INV-HIST-7: 一等 identity 行不 hard delete。
CREATE TRIGGER IF NOT EXISTS next_action_no_delete
  BEFORE DELETE ON ${NEXT_ACTION_TABLE}
  BEGIN
    SELECT RAISE(ABORT, 'next_action rows are never deleted (DOMAIN_SCHEMA §15 通则; ARCHITECTURE §5.4 INV-HIST-7)');
  END;
-- 内容不可变半边: 创建后的 6 个内容列任何 UPDATE 都 ABORT（状态缓存列
-- status/promoted_to_task_id 是 §13 迁移的唯一合法行侧面 — PROMOTE/DISMISS
-- 仅用户, ARCHITECTURE §6 矩阵行; trigger 只钉「内容列不可动」）。
CREATE TRIGGER IF NOT EXISTS next_action_no_content_update
  BEFORE UPDATE ON ${NEXT_ACTION_TABLE}
  WHEN NEW.id IS NOT OLD.id
   OR IFNULL(NEW.workstream_id, '') IS NOT IFNULL(OLD.workstream_id, '')
   OR NEW.statement IS NOT OLD.statement
   OR IFNULL(NEW.rationale, '') IS NOT IFNULL(OLD.rationale, '')
   OR NEW.created_by IS NOT OLD.created_by
   OR NEW.created_at IS NOT OLD.created_at
  BEGIN
    SELECT RAISE(ABORT, 'next_action content is immutable after creation (DOMAIN_SCHEMA §9.3; only the state-cache columns status/promoted_to_task_id may change, user-only per ARCHITECTURE §6)');
  END;
-- 终态无出边（§13: PROMOTED/DISMISSED 均为终态）: 任何从终态出发的状态
-- UPDATE 都 ABORT — 含「复活」回 PROPOSED 与跨终态跳转（service 层有 §13
-- 纯守卫, 本 trigger 是并发双迁移竞争与 raw SQL 改写的存储层兜底）。
CREATE TRIGGER IF NOT EXISTS next_action_no_status_regression
  BEFORE UPDATE ON ${NEXT_ACTION_TABLE}
  WHEN OLD.status IN ('PROMOTED', 'DISMISSED') AND NEW.status IS NOT OLD.status
  BEGIN
    SELECT RAISE(ABORT, 'next_action terminal states (PROMOTED/DISMISSED) have no outgoing edges (DOMAIN_SCHEMA §13)');
  END;
-- promoted_to_task_id 一经生成不可更换（§13 终态 ⇒ 行状态面冻结）。
CREATE TRIGGER IF NOT EXISTS next_action_promoted_task_immutable
  BEFORE UPDATE ON ${NEXT_ACTION_TABLE}
  WHEN OLD.promoted_to_task_id IS NOT NULL AND NEW.promoted_to_task_id IS NOT OLD.promoted_to_task_id
  BEGIN
    SELECT RAISE(ABORT, 'next_action.promoted_to_task_id is immutable once set (DOMAIN_SCHEMA §13)');
  END;

CREATE TABLE IF NOT EXISTS ${BLOCKER_TABLE} (
  id          TEXT    NOT NULL PRIMARY KEY,
  statement   TEXT    NOT NULL,
  affects     TEXT    NOT NULL,                     -- JSON [{kind,id}]（§9.4 必填 ≥1）
  status      TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'CLEARED')),
  source      TEXT    NOT NULL,                     -- 来源说明（§9.4 必填）
  "references"    TEXT,                           -- JSON string[]（可选; references 是 SQLite 关键字, 须引号）
  created_at  INTEGER NOT NULL,                     -- epoch ms（§1.2, A-3）
  cleared_at  INTEGER,
  -- 字段共现（§9.4: cleared_at 在 CLEAR 时落）:
  CHECK (status = 'CLEARED' OR cleared_at IS NULL),
  CHECK (status <> 'CLEARED' OR cleared_at IS NOT NULL)
);
-- 查询面索引（GUI: 显著区按状态取 ACTIVE; §15 未列 ⇒ 本 WP 自加, 只增）。
CREATE INDEX IF NOT EXISTS idx_blocker_status
  ON ${BLOCKER_TABLE} (status);
-- §15 通则 / INV-HIST-7: 一等 identity 行不 hard delete。
CREATE TRIGGER IF NOT EXISTS blocker_no_delete
  BEFORE DELETE ON ${BLOCKER_TABLE}
  BEGIN
    SELECT RAISE(ABORT, 'blocker rows are never deleted (DOMAIN_SCHEMA §15 通则; ARCHITECTURE §5.4 INV-HIST-7)');
  END;
-- 内容不可变半边: 创建后的 6 个内容列任何 UPDATE 都 ABORT（状态缓存列
-- status/cleared_at 是 §13 迁移的唯一合法行侧面 — CLEARED 仅用户,
-- ARCHITECTURE §5.9 INV-PERM-1 闭集外）。
CREATE TRIGGER IF NOT EXISTS blocker_no_content_update
  BEFORE UPDATE ON ${BLOCKER_TABLE}
  WHEN NEW.id IS NOT OLD.id
   OR NEW.statement IS NOT OLD.statement
   OR NEW.affects IS NOT OLD.affects
   OR NEW.source IS NOT OLD.source
   OR IFNULL(NEW."references", '') IS NOT IFNULL(OLD."references", '')
   OR NEW.created_at IS NOT OLD.created_at
  BEGIN
    SELECT RAISE(ABORT, 'blocker content is immutable after creation (DOMAIN_SCHEMA §9.4; only the state-cache columns status/cleared_at may change, user-only per INV-PERM-1)');
  END;
-- 终态无出边（§13: CLEARED 终态; 复发 = 新 Blocker）: 任何从 CLEARED 出
-- 发的状态 UPDATE 都 ABORT（storage 层兜底 — 同 next_action 口径）。
CREATE TRIGGER IF NOT EXISTS blocker_no_status_regression
  BEFORE UPDATE ON ${BLOCKER_TABLE}
  WHEN OLD.status IS 'CLEARED' AND NEW.status IS NOT OLD.status
  BEGIN
    SELECT RAISE(ABORT, 'blocker CLEARED is terminal — recurrence is a new blocker row (DOMAIN_SCHEMA §13)');
  END;
-- cleared_at 一经落定不可改写（§13 终态 ⇒ 行状态面冻结）。
CREATE TRIGGER IF NOT EXISTS blocker_cleared_at_immutable
  BEFORE UPDATE ON ${BLOCKER_TABLE}
  WHEN OLD.cleared_at IS NOT NULL AND NEW.cleared_at IS NOT OLD.cleared_at
  BEGIN
    SELECT RAISE(ABORT, 'blocker.cleared_at is immutable once set (DOMAIN_SCHEMA §13)');
  END;
`

/** Full DDL (idempotent — re-applied on every store open, 同 WP-3.1 先例). */
export function actionsDdl(): string {
  return DDL
}

/** Tables this WP's DDL declares (EXPECTED-tables 诊断面). */
export const ACTIONS_TABLES = [NEXT_ACTION_TABLE, BLOCKER_TABLE] as const

/* ------------------------------------------------------------------ *
 * SQL statements（参数化; 驱动经 ActionsDb 端口）
 * ------------------------------------------------------------------ */

export const SQL_INSERT_NEXT_ACTION = `
INSERT INTO ${NEXT_ACTION_TABLE} (id, workstream_id, statement, rationale, status, promoted_to_task_id, created_by, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`

export const SQL_SELECT_NEXT_ACTION_BY_ID = `SELECT * FROM ${NEXT_ACTION_TABLE} WHERE id = ?`

/**
 * §13 迁移的条件 UPDATE（乐观并发门 — 同 WP-3.1 planfork 先例）:
 * `WHERE id=? AND status='PROPOSED'` ⇒ 并发双迁移只有一个成功; 0 行由
 * 调用方重读判别 NA_NOT_FOUND / NA_WRONG_STATE。
 */
export const SQL_TRANSITION_NEXT_ACTION = `
UPDATE ${NEXT_ACTION_TABLE} SET status = ?, promoted_to_task_id = ? WHERE id = ? AND status = 'PROPOSED'
`

export const SQL_INSERT_BLOCKER = `
INSERT INTO ${BLOCKER_TABLE} (id, statement, affects, status, source, "references", created_at, cleared_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`

export const SQL_SELECT_BLOCKER_BY_ID = `SELECT * FROM ${BLOCKER_TABLE} WHERE id = ?`

/** §13 迁移的条件 UPDATE（乐观并发门）: `WHERE id=? AND status='ACTIVE'`。 */
export const SQL_TRANSITION_BLOCKER = `
UPDATE ${BLOCKER_TABLE} SET status = ?, cleared_at = ? WHERE id = ? AND status = 'ACTIVE'
`

/* ------------------------------------------------------------------ *
 * Row ↔ record mapping（损坏行大声失败 — 同 WP-3.1 rowToPlanFork 纪律）
 * ------------------------------------------------------------------ */

const CORRUPT = (what: string, detail: string): never => {
  throw new Error(`actions row corruption at ${what}: ${detail}`)
}

function decodeJson<T>(value: unknown, what: string): T {
  if (typeof value !== 'string') return CORRUPT(what, `expected JSON string, got ${typeof value}`)
  try {
    return JSON.parse(value) as T
  } catch (cause) {
    return CORRUPT(what, `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

const NA_STATUSES: readonly string[] = ['PROPOSED', 'PROMOTED', 'DISMISSED']
const BLK_STATUSES: readonly string[] = ['ACTIVE', 'CLEARED']
const AFFECTS_KINDS: readonly string[] = ['WORKSTREAM', 'TASK', 'RUN']

/** Encode `NextActionRecord` into the INSERT parameter list（列序 = DDL）。 */
export function nextActionToParams(r: NextActionRecord): (string | number | null)[] {
  return [
    r.id,
    r.workstream_id ?? null,
    r.statement,
    r.rationale ?? null,
    r.status,
    r.promoted_to_task_id ?? null,
    JSON.stringify(r.created_by),
    r.created_at,
  ]
}

/** Decode a `next_action` row back to the record（throws on corruption）。 */
export function rowToNextAction(row: Record<string, unknown>): NextActionRecord {
  const status = row.status
  if (typeof status !== 'string' || !NA_STATUSES.includes(status)) {
    return CORRUPT('next_action.status', `unknown status ${JSON.stringify(String(status))}`)
  }
  for (const name of ['id', 'statement', 'created_by'] as const) {
    if (typeof row[name] !== 'string') return CORRUPT(`next_action.${name}`, `expected string, got ${typeof row[name]}`)
  }
  if (typeof row.created_at !== 'number') return CORRUPT('next_action.created_at', `expected number, got ${typeof row.created_at}`)
  const affectedTaskId = row.promoted_to_task_id
  if (affectedTaskId !== null && typeof affectedTaskId !== 'string') {
    return CORRUPT('next_action.promoted_to_task_id', `expected string or null, got ${typeof affectedTaskId}`)
  }
  return {
    id: row.id as string,
    statement: row.statement as string,
    status: status as NaStatus,
    created_by: decodeJson<NextActionRecord['created_by']>(row.created_by, 'next_action.created_by'),
    created_at: row.created_at as number,
    ...(row.workstream_id != null ? { workstream_id: String(row.workstream_id) } : {}),
    ...(row.rationale != null ? { rationale: String(row.rationale) } : {}),
    ...(affectedTaskId != null ? { promoted_to_task_id: String(affectedTaskId) } : {}),
  }
}

/** Encode `BlockerRecord` into the INSERT parameter list（列序 = DDL）。 */
export function blockerToParams(r: BlockerRecord): (string | number | null)[] {
  return [
    r.id,
    r.statement,
    JSON.stringify(r.affects.map((ref) => ({ kind: ref.kind, id: ref.id }))),
    r.status,
    r.source,
    r.references !== undefined ? JSON.stringify(r.references) : null,
    r.created_at,
    r.cleared_at ?? null,
  ]
}

/** Decode a `blocker` row back to the record（throws on corruption）。 */
export function rowToBlocker(row: Record<string, unknown>): BlockerRecord {
  const status = row.status
  if (typeof status !== 'string' || !BLK_STATUSES.includes(status)) {
    return CORRUPT('blocker.status', `unknown status ${JSON.stringify(String(status))}`)
  }
  for (const name of ['id', 'statement', 'affects', 'source'] as const) {
    if (typeof row[name] !== 'string') return CORRUPT(`blocker.${name}`, `expected string, got ${typeof row[name]}`)
  }
  if (typeof row.created_at !== 'number') return CORRUPT('blocker.created_at', `expected number, got ${typeof row.created_at}`)
  const affects = decodeJson<readonly { kind: string; id: string }[]>(row.affects, 'blocker.affects')
  for (const ref of affects) {
    if (ref === null || typeof ref !== 'object' || typeof ref.kind !== 'string' || typeof ref.id !== 'string' ||
        !AFFECTS_KINDS.includes(ref.kind)) {
      return CORRUPT('blocker.affects', `element must be a {kind ∈ WORKSTREAM|TASK|RUN, id} typedRef (got ${JSON.stringify(ref)})`)
    }
  }
  const references = row.references
  let referencesValue: string[] | undefined
  if (references != null) {
    const decoded = decodeJson<unknown>(references, 'blocker.references')
    if (!Array.isArray(decoded)) {
      return CORRUPT('blocker.references', `expected a JSON array of strings, got ${typeof decoded}`)
    }
    for (const item of decoded) {
      if (typeof item !== 'string') return CORRUPT('blocker.references', `element must be a string (got ${typeof item})`)
    }
    referencesValue = [...decoded] as string[]
  }
  return {
    id: row.id as string,
    statement: row.statement as string,
    affects: affects as AffectsRef[],
    status: status as BlockerRecord['status'],
    source: row.source as string,
    created_at: row.created_at as number,
    ...(referencesValue !== undefined ? { references: referencesValue } : {}),
    ...(row.cleared_at != null ? { cleared_at: row.cleared_at as number } : {}),
  }
}
