/**
 * WP-3.5 — `intervention` 表: DDL + 行↔记录映射 + SQL（纯数据, 零 I/O）。
 *
 * 表映射（DOMAIN_SCHEMA §15, 逐字）:
 *   - `intervention` — PK `id`; 关键索引 `(status)`（GUI 分组面: OPEN 一组 /
 *     PENDING 一组 / CLOSED 折叠, §9.2）。
 * §15 通则: operational 表**不 hard delete** 一等 identity 行（INV-HIST-7）。
 *
 * 冻结行形状 = `schema/operational/attention.schema.json` `$defs/Intervention`
 * （11 键 snake_case, additionalProperties:false; 本文件的列集与其逐字同构 —
 * `InterventionRecord` 类型面同款的 SQL 侧）。
 *
 * DatabaseSync 封装模式（同 WP-3.1 planfork / WP-2.4 runbinding 双连接）:
 *   1. DB 文件的 open/初始化（0o700/0o600、WAL、user_version 门、quick_check）
 *      归 WP-2.1 `openDatabase` 封装;
 *   2. 本模块 DDL 在**第二连接**上以幂等 `IF NOT EXISTS` 应用
 *      （`InterventionStore` 构造时经注入 `FloodingDb.exec` — service 层
 *      驱动是注入的 I/O, 零 sqlite import, ARCHITECTURE §2.2）;
 *   3. 多连接 WAL 共存, 写经文件锁串行化（busy_timeout 同 store 默认）。
 *
 * 存储层不变量（trigger 级, 任何连接上生效 — 同 WP-3.1 先例）:
 *   - INV-HIST-7（§15 通则）: `intervention_no_delete` ABORT 任何 DELETE;
 *   - 内容不可变（§9.2 语义: 创建后内容不变更; 变更面只有状态迁移）:
 *     `intervention_no_content_update` ABORT 任何对创建后不变列
 *     （id/title/detail/origin/workstream_ids/source_refs/created_by/
 *     created_at）的 UPDATE — 允许 UPDATE 的只有状态缓存列
 *     （status/closed_at/resolution_note）, 即 §13 迁移（仅用户,
 *     INV-PERM-4）的行侧机制; 本 WP 不提供该 UPDATE 的 API 面
 *     （未来用户面 WP 才交付, 且带 USER actor 门）。
 *   - origin/status 枚举 = 冻结 4 值 / 3 值（CHECK 与 schema 枚举逐字）。
 *
 * closed_at 字段共现: §9.2 未规定 CLOSED ⇔ closed_at 必填（closed_at 在
 * 字段表中为整体可选 ✅/❌）⇒ 不加共现 CHECK（不过度约束冻结契约; 与
 * WP-3.1 plan_fork 的显式「status=SELECTED 时必填」共现不同 — 那里字段表
 * 有明确必填语义, 这里没有）。
 */

import { IV_STATUSES, INTERVENTION_ORIGINS, type InterventionRecord } from './types.js'

export const INTERVENTION_TABLE = 'intervention'

const DDL = `
CREATE TABLE IF NOT EXISTS ${INTERVENTION_TABLE} (
  id              TEXT    NOT NULL PRIMARY KEY,
  title           TEXT    NOT NULL,
  detail          TEXT,                       -- 机械证据摘要（§8 证据字段落点）
  origin          TEXT    NOT NULL CHECK (origin IN ('USER', 'AGENT_REPORT', 'AUTO_FLOODING', 'AUTO_AUDIT')),
  workstream_ids  TEXT    NOT NULL,           -- JSON WS id[]（事件 owner = 第一个）
  source_refs     TEXT    NOT NULL,           -- JSON TypedRef[]（§8: 相关 PF）
  status          TEXT    NOT NULL CHECK (status IN ('OPEN', 'PENDING', 'CLOSED')),
  created_by      TEXT    NOT NULL,           -- ActorRef JSON（AUTO_FLOODING ⇒ kind=PLUGIN）
  created_at      INTEGER NOT NULL,           -- epoch ms（§1.2, A-3 修订）
  closed_at       INTEGER,                    -- 用户关闭时（INV-PERM-4, 本 WP 不写）
  resolution_note TEXT                        -- 关闭时用户填写（本 WP 不写）
);
-- §15 关键索引 (status): GUI 分组面（OPEN/PENDING/CLOSED 三组, §9.2）。
CREATE INDEX IF NOT EXISTS idx_intervention_status
  ON ${INTERVENTION_TABLE} (status);
-- §15 通则 / INV-HIST-7: 一等 identity 行不 hard delete。
CREATE TRIGGER IF NOT EXISTS intervention_no_delete
  BEFORE DELETE ON ${INTERVENTION_TABLE}
  BEGIN
    SELECT RAISE(ABORT, 'intervention rows are never deleted (DOMAIN_SCHEMA §15 通则; ARCHITECTURE §5.4 INV-HIST-7)');
  END;
-- 内容不可变半边: 创建后的 8 个内容列任何 UPDATE 都 ABORT（状态缓存列
-- status/closed_at/resolution_note 是 §13 迁移的唯一合法行侧面 — 仅用户,
-- INV-PERM-4; 本 WP 不交付该面的 API, trigger 只钉「内容列不可动」）。
CREATE TRIGGER IF NOT EXISTS intervention_no_content_update
  BEFORE UPDATE ON ${INTERVENTION_TABLE}
  WHEN NEW.id IS NOT OLD.id
   OR NEW.title IS NOT OLD.title
   OR IFNULL(NEW.detail, '') IS NOT IFNULL(OLD.detail, '')
   OR NEW.origin IS NOT OLD.origin
   OR NEW.workstream_ids IS NOT OLD.workstream_ids
   OR NEW.source_refs IS NOT OLD.source_refs
   OR NEW.created_by IS NOT OLD.created_by
   OR NEW.created_at IS NOT OLD.created_at
  BEGIN
    SELECT RAISE(ABORT, 'intervention content is immutable after creation (DOMAIN_SCHEMA §9.2; only the state-cache columns status/closed_at/resolution_note may change, user-only per INV-PERM-4)');
  END;
`

/** Full DDL (idempotent — re-applied on every store open, 同 WP-3.1 先例). */
export function interventionDdl(): string {
  return DDL
}

/** Tables this WP's DDL declares (EXPECTED-tables 诊断面). */
export const FLOODING_TABLES = [INTERVENTION_TABLE] as const

/* ------------------------------------------------------------------ *
 * SQL statements（参数化; 驱动经 FloodingDb 端口）
 * ------------------------------------------------------------------ */

export const SQL_INSERT_INTERVENTION = `
INSERT INTO ${INTERVENTION_TABLE} (id, title, detail, origin, workstream_ids, source_refs, status, created_by, created_at, closed_at, resolution_note)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

export const SQL_SELECT_INTERVENTION_BY_ID = `SELECT * FROM ${INTERVENTION_TABLE} WHERE id = ?`

/**
 * §8 规则后半句的探针: OPEN AUTO_FLOODING Intervention 候选行（WS 关联在
 * JSON 列内 — node:sqlite 无 JSON 函数, WS 成员过滤在 JS 侧, 见 store）。
 * 行序 created_at ASC, id ASC（探针取第一个）。
 */
export const SQL_FIND_OPEN_AUTO_FLOODING = `
SELECT * FROM ${INTERVENTION_TABLE}
WHERE origin = 'AUTO_FLOODING' AND status = 'OPEN'
ORDER BY created_at ASC, id ASC
`

/* ------------------------------------------------------------------ *
 * Row ↔ record mapping（损坏行大声失败 — 同 WP-3.1 rowToPlanFork 纪律）
 * ------------------------------------------------------------------ */

const CORRUPT = (what: string, detail: string): never => {
  throw new Error(`flooding row corruption at ${what}: ${detail}`)
}

function decodeJson<T>(value: unknown, what: string): T {
  if (typeof value !== 'string') return CORRUPT(what, `expected JSON string, got ${typeof value}`)
  try {
    return JSON.parse(value) as T
  } catch (cause) {
    return CORRUPT(what, `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Encode `InterventionRecord` into the INSERT parameter list（列序 = DDL）。 */
export function interventionToParams(r: InterventionRecord): (string | number | null)[] {
  return [
    r.id,
    r.title,
    r.detail ?? null,
    r.origin,
    JSON.stringify(r.workstream_ids.map((ws) => ws)),
    JSON.stringify(r.source_refs.map((ref) => ({ kind: ref.kind, id: ref.id }))),
    r.status,
    JSON.stringify(r.created_by),
    r.created_at,
    r.closed_at ?? null,
    r.resolution_note ?? null,
  ]
}

/** Decode an `intervention` row back to the record（throws on corruption）。 */
export function rowToIntervention(row: Record<string, unknown>): InterventionRecord {
  const status = row.status
  if (typeof status !== 'string' || !(IV_STATUSES as readonly string[]).includes(status)) {
    return CORRUPT('intervention.status', `unknown status ${JSON.stringify(String(status))}`)
  }
  const origin = row.origin
  if (typeof origin !== 'string' || !(INTERVENTION_ORIGINS as readonly string[]).includes(origin)) {
    return CORRUPT('intervention.origin', `unknown origin ${JSON.stringify(String(origin))}`)
  }
  for (const name of ['id', 'title', 'workstream_ids', 'source_refs', 'created_by'] as const) {
    if (typeof row[name] !== 'string') return CORRUPT(`intervention.${name}`, `expected string, got ${typeof row[name]}`)
  }
  if (typeof row.created_at !== 'number') return CORRUPT('intervention.created_at', `expected number, got ${typeof row.created_at}`)
  const workstreamIds = decodeJson<readonly string[]>(row.workstream_ids, 'intervention.workstream_ids')
  for (const ws of workstreamIds) {
    if (typeof ws !== 'string') return CORRUPT('intervention.workstream_ids', `element must be a string (got ${typeof ws})`)
  }
  const sourceRefs = decodeJson<readonly { kind: string; id: string }[]>(row.source_refs, 'intervention.source_refs')
  for (const ref of sourceRefs) {
    if (ref === null || typeof ref !== 'object' || typeof ref.kind !== 'string' || typeof ref.id !== 'string') {
      return CORRUPT('intervention.source_refs', `element must be a {kind, id} typedRef`)
    }
  }
  return {
    id: row.id as string,
    title: row.title as string,
    origin: origin as InterventionRecord['origin'],
    workstream_ids: workstreamIds,
    source_refs: sourceRefs as InterventionRecord['source_refs'],
    status: status as InterventionRecord['status'],
    created_by: decodeJson<InterventionRecord['created_by']>(row.created_by, 'intervention.created_by'),
    created_at: row.created_at as number,
    ...(row.detail != null ? { detail: String(row.detail) } : {}),
    ...(row.closed_at != null ? { closed_at: row.closed_at as number } : {}),
    ...(row.resolution_note != null ? { resolution_note: String(row.resolution_note) } : {}),
  }
}
