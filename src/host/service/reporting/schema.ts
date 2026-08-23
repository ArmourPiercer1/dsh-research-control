/**
 * WP-5.3 — interaction / reporting_item / scheduled_event tables: DDL +
 * 行↔记录映射 (纯数据).
 *
 * 表映射 (DOMAIN_SCHEMA §15 L624, 逐字):
 *   - `interaction`          §10.1 — PK `id` (INT-<n>, PROJECT scope);
 *   - `reporting_item`       §10.2 — PK `id` (RPT-<n>, PROJECT scope);
 *   - `scheduled_event`      §10.3 — PK `id` (SEV-<n>, PROJECT scope).
 * §15 对本三表的「关键约束/索引」列为空 (PK only) — 本 DDL 严格对齐,
 * 不额外加索引 (V1 规模 10^4 行直接扫描即可, 计划书 §29)。
 * 行形状 = 冻结 `schema/operational/reporting.schema.json` $defs 逐字段
 * (additionalProperties:false — 行即投影, 不加任何内部审计列)。
 *
 * DatabaseSync 封装模式 (同 planfork/runbinding 先例): DB 文件的
 * open/初始化归 WP-2.1 `openDatabase`; 本模块 DDL 在**第二连接**上以
 * 幂等 `IF NOT EXISTS` 应用 (`ReportingService` 构造时经注入
 * `ReportingDb.exec` — 域/服务层零 sqlite import, ARCHITECTURE §2.2)。
 *
 * 存储层不变量 (trigger 级, 任何连接上生效 — 同 planfork 双触发器形态):
 *   - §15 通则 / INV-HIST-7: 三张表各一个 `_no_delete` trigger, ABORT
 *     任何 DELETE (含第二连接 raw SQL) — operational 表不 hard delete
 *     一等 identity 行;
 *   - 内容不可变: 三张表各一个 `_no_content_update` trigger:
 *     * `interaction` / `scheduled_event` — 无状态缓存列 (冻结 schema
 *       无 status), 全部内容列任何 UPDATE 都 ABORT (创建后整体不可变);
 *     * `reporting_item` — 6 个内容列 (id/audience/statement/
 *       material_refs/occasion_ref/created_at) ABORT; 合法 UPDATE 面 =
 *       状态缓存列 status/reported_at (§13 状态机的行侧机制, 同
 *       intervention 的 state-cache 列先例)。
 *   - CHECK 约束: kind/status/freq 枚举面 + reminder_lead_ms ≥ 0 (冻结
 *     词汇的第二道防线 — 参数化写入之外的任何连接都过 CHECK)。
 *
 * 纯模块: DDL 字符串 + 行映射 + SQL 语句常量 (零 I/O, 零驱动 import)。
 */

import {
  isInteractionKind,
  isRptStatus,
  isSevFreq,
  isSevRelatedRefKind,
  type InteractionRecord,
  type ReportingItemRecord,
  type ScheduledEventRecord,
  type SevFreq,
  type SevSchedule,
  type TypedRefJson,
} from './types.js'

export const INTERACTION_TABLE = 'interaction'
export const REPORTING_ITEM_TABLE = 'reporting_item'
export const SCHEDULED_EVENT_TABLE = 'scheduled_event'

/* ------------------------------------------------------------------ *
 * DDL
 * ------------------------------------------------------------------ */

const INTERACTION_DDL = `
CREATE TABLE IF NOT EXISTS ${INTERACTION_TABLE} (
  id                  TEXT    NOT NULL PRIMARY KEY,   -- INT-<n> (§1.1 L37)
  kind                TEXT    NOT NULL CHECK (kind IN ('MEETING', 'AD_HOC_DISCUSSION', 'SUPERVISOR_UPDATE', 'COLLABORATOR_DISCUSSION', 'EXPERIMENT_SHIFT_HANDOFF', 'OTHER')),
  title               TEXT    NOT NULL,
  occurred_at         INTEGER NOT NULL,               -- epoch ms (§1.2)
  participants        TEXT,                           -- JSON string[] (可选)
  notes               TEXT,                           -- Markdown 会议纪要等
  related_workstreams TEXT                            -- JSON WS id[] (可选, §10.1)
);
-- §15 通则 / INV-HIST-7: 一等 identity 行不 hard delete。
CREATE TRIGGER IF NOT EXISTS interaction_no_delete
  BEFORE DELETE ON ${INTERACTION_TABLE}
  BEGIN
    SELECT RAISE(ABORT, 'interaction rows are never deleted (DOMAIN_SCHEMA §15 通则; ARCHITECTURE §5.4 INV-HIST-7)');
  END;
-- 内容不可变: 冻结 schema 无状态缓存列 ⇒ 7 个内容列任何 UPDATE 都 ABORT。
CREATE TRIGGER IF NOT EXISTS interaction_no_content_update
  BEFORE UPDATE ON ${INTERACTION_TABLE}
  WHEN NEW.id IS NOT OLD.id
   OR NEW.kind IS NOT OLD.kind
   OR NEW.title IS NOT OLD.title
   OR NEW.occurred_at IS NOT OLD.occurred_at
   OR IFNULL(NEW.participants, '') IS NOT IFNULL(OLD.participants, '')
   OR IFNULL(NEW.notes, '') IS NOT IFNULL(OLD.notes, '')
   OR IFNULL(NEW.related_workstreams, '') IS NOT IFNULL(OLD.related_workstreams, '')
  BEGIN
    SELECT RAISE(ABORT, 'interaction content is immutable after registration (reporting.schema.json 无状态列; WP-5.3 V1)');
  END;
`

const REPORTING_ITEM_DDL = `
CREATE TABLE IF NOT EXISTS ${REPORTING_ITEM_TABLE} (
  id            TEXT    NOT NULL PRIMARY KEY,         -- RPT-<n> (§1.1 L38)
  audience      TEXT    NOT NULL,
  statement     TEXT    NOT NULL,
  material_refs TEXT,                                 -- JSON TypedRef[] (可选)
  status        TEXT    NOT NULL CHECK (status IN ('OPEN', 'MATERIAL_READY', 'READY_TO_REPORT', 'REPORTED', 'FOLLOW_UP_REQUIRED')),
  occasion_ref  TEXT,                                 -- SEV-<n> (可选; 写入时存在性校验)
  created_at    INTEGER NOT NULL,                     -- epoch ms (§1.2)
  reported_at   INTEGER                               -- 首次 REPORTED 时写入 (状态缓存列)
);
-- §15 通则 / INV-HIST-7: 一等 identity 行不 hard delete。
CREATE TRIGGER IF NOT EXISTS reporting_item_no_delete
  BEFORE DELETE ON ${REPORTING_ITEM_TABLE}
  BEGIN
    SELECT RAISE(ABORT, 'reporting_item rows are never deleted (DOMAIN_SCHEMA §15 通则; ARCHITECTURE §5.4 INV-HIST-7)');
  END;
-- 内容不可变半边: 6 个内容列任何 UPDATE 都 ABORT; 合法 UPDATE 面 =
-- 状态缓存列 status/reported_at (DOMAIN_SCHEMA §13 状态机的行侧机制)。
CREATE TRIGGER IF NOT EXISTS reporting_item_no_content_update
  BEFORE UPDATE ON ${REPORTING_ITEM_TABLE}
  WHEN NEW.id IS NOT OLD.id
   OR NEW.audience IS NOT OLD.audience
   OR NEW.statement IS NOT OLD.statement
   OR IFNULL(NEW.material_refs, '') IS NOT IFNULL(OLD.material_refs, '')
   OR IFNULL(NEW.occasion_ref, '') IS NOT IFNULL(OLD.occasion_ref, '')
   OR NEW.created_at IS NOT OLD.created_at
  BEGIN
    SELECT RAISE(ABORT, 'reporting_item content is immutable after creation (only the state-cache columns status/reported_at may change — DOMAIN_SCHEMA §13/§15)');
  END;
`

const SCHEDULED_EVENT_DDL = `
CREATE TABLE IF NOT EXISTS ${SCHEDULED_EVENT_TABLE} (
  id               TEXT    NOT NULL PRIMARY KEY,      -- SEV-<n> (§1.1 L39)
  title            TEXT    NOT NULL,
  schedule         TEXT    NOT NULL,                  -- JSON {kind:ONCE,at} | {kind:RECURRING,freq,interval?,until?}
  related_refs     TEXT,                              -- JSON TypedRef[] (kind ∈ RPT/IV/TPC)
  reminder_lead_ms INTEGER CHECK (reminder_lead_ms IS NULL OR reminder_lead_ms >= 0)
);
-- §15 通则 / INV-HIST-7: 一等 identity 行不 hard delete。
CREATE TRIGGER IF NOT EXISTS scheduled_event_no_delete
  BEFORE DELETE ON ${SCHEDULED_EVENT_TABLE}
  BEGIN
    SELECT RAISE(ABORT, 'scheduled_event rows are never deleted (DOMAIN_SCHEMA §15 通则; ARCHITECTURE §5.4 INV-HIST-7)');
  END;
-- 内容不可变: 冻结 schema 无状态缓存列 ⇒ 5 个内容列任何 UPDATE 都 ABORT
-- (§10.3 「只管理用户登记的事件」— 登记制, 无修改面)。
CREATE TRIGGER IF NOT EXISTS scheduled_event_no_content_update
  BEFORE UPDATE ON ${SCHEDULED_EVENT_TABLE}
  WHEN NEW.id IS NOT OLD.id
   OR NEW.title IS NOT OLD.title
   OR NEW.schedule IS NOT OLD.schedule
   OR IFNULL(NEW.related_refs, '') IS NOT IFNULL(OLD.related_refs, '')
   OR IFNULL(NEW.reminder_lead_ms, -1) IS NOT IFNULL(OLD.reminder_lead_ms, -1)
  BEGIN
    SELECT RAISE(ABORT, 'scheduled_event content is immutable after registration (reporting.schema.json 无状态列; §10.3 不接外部 Calendar, WP-5.3 V1)');
  END;
`

/** Full DDL (idempotent — re-applied on every service open, 同先例). */
export function reportingDdl(): string {
  return INTERACTION_DDL + REPORTING_ITEM_DDL + SCHEDULED_EVENT_DDL
}

/** Tables this WP's DDL declares (EXPECTED-tables 诊断面 / TC-DB-004). */
export const REPORTING_TABLES = [INTERACTION_TABLE, REPORTING_ITEM_TABLE, SCHEDULED_EVENT_TABLE] as const

/* ------------------------------------------------------------------ *
 * SQL statements (参数化; 驱动经 ReportingDb 端口 — 零驱动 import)
 * ------------------------------------------------------------------ */

export const SQL_INSERT_INTERACTION = `
INSERT INTO ${INTERACTION_TABLE} (id, kind, title, occurred_at, participants, notes, related_workstreams)
VALUES (?, ?, ?, ?, ?, ?, ?)
`

export const SQL_SELECT_INTERACTION_BY_ID = `SELECT * FROM ${INTERACTION_TABLE} WHERE id = ?`

export const SQL_INSERT_REPORTING_ITEM = `
INSERT INTO ${REPORTING_ITEM_TABLE} (id, audience, statement, material_refs, status, occasion_ref, created_at, reported_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`

export const SQL_SELECT_REPORTING_ITEM_BY_ID = `SELECT * FROM ${REPORTING_ITEM_TABLE} WHERE id = ?`

/**
 * The optimistic state-machine UPDATE (WHERE status = from — 并发双迁移
 * 只有一个成功; 0 行 ⇒ 重读判别 RPT_NOT_FOUND / RPT_WRONG_STATE, 同
 * planfork/intervention 先例). `reported_at` = 新值由 service 计算
 * (进入 REPORTED 且尚未记录时写入 now; 其余情况保持原值 — 历史事实列)。
 */
export const SQL_TRANSITION_REPORTING_ITEM = `
UPDATE ${REPORTING_ITEM_TABLE} SET status = ?, reported_at = ? WHERE id = ? AND status = ?
`

export const SQL_INSERT_SCHEDULED_EVENT = `
INSERT INTO ${SCHEDULED_EVENT_TABLE} (id, title, schedule, related_refs, reminder_lead_ms)
VALUES (?, ?, ?, ?, ?)
`

export const SQL_SELECT_SCHEDULED_EVENT_BY_ID = `SELECT * FROM ${SCHEDULED_EVENT_TABLE} WHERE id = ?`

/* ------------------------------------------------------------------ *
 * Row ↔ record mapping (损坏行大声失败 — 同 WP-2.4 rowToRun 纪律)
 * ------------------------------------------------------------------ */

const CORRUPT = (what: string, detail: string): never => {
  throw new Error(`reporting row corruption at ${what}: ${detail}`)
}

function decodeJson<T>(value: unknown, what: string): T {
  if (typeof value !== 'string') return CORRUPT(what, `expected JSON string, got ${typeof value}`)
  try {
    return JSON.parse(value) as T
  } catch (cause) {
    return CORRUPT(what, `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

function decodeOptionalJson<T>(value: unknown, what: string): T | undefined {
  if (value === null || value === undefined) return undefined
  return decodeJson<T>(value, what)
}

function decodeStringArray(value: unknown, what: string): readonly string[] {
  const arr = decodeJson<unknown>(value, what)
  if (!Array.isArray(arr) || arr.some((item) => typeof item !== 'string')) {
    return CORRUPT(what, `expected a JSON string array, got ${JSON.stringify(String(value)).slice(0, 80)}`)
  }
  return arr as readonly string[]
}

function decodeTypedRefs(value: unknown, what: string): readonly TypedRefJson[] {
  const arr = decodeJson<unknown>(value, what)
  if (
    !Array.isArray(arr) ||
    arr.some((item) => item === null || typeof item !== 'object' || typeof (item as { kind?: unknown }).kind !== 'string' ||
      typeof (item as { id?: unknown }).id !== 'string')
  ) {
    return CORRUPT(what, `expected a JSON TypedRef array, got ${JSON.stringify(String(value)).slice(0, 80)}`)
  }
  return arr as readonly TypedRefJson[]
}

/** Decode a `schedule` cell (ONCE / RECURRING 封闭联合; 冻结形状校验). */
export function decodeSchedule(value: unknown, what: string): SevSchedule {
  const obj = decodeJson<Record<string, unknown>>(value, what)
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return CORRUPT(what, `expected a schedule object, got ${typeof value}`)
  }
  if (obj.kind === 'ONCE') {
    if (typeof obj.at !== 'number' || !Number.isSafeInteger(obj.at) || obj.at < 0) {
      return CORRUPT(`${what}.at`, `expected non-negative epoch ms, got ${JSON.stringify(obj.at)}`)
    }
    return { kind: 'ONCE', at: obj.at }
  }
  if (obj.kind === 'RECURRING') {
    if (!isSevFreq(obj.freq)) return CORRUPT(`${what}.freq`, `unknown freq ${JSON.stringify(obj.freq)}`)
    const result: { kind: 'RECURRING'; freq: SevFreq; interval?: number; until?: number } = { kind: 'RECURRING', freq: obj.freq }
    if (obj.interval !== undefined) {
      if (typeof obj.interval !== 'number' || !Number.isSafeInteger(obj.interval) || obj.interval < 1) {
        return CORRUPT(`${what}.interval`, `expected integer ≥ 1, got ${JSON.stringify(obj.interval)}`)
      }
      result.interval = obj.interval
    }
    if (obj.until !== undefined) {
      if (typeof obj.until !== 'number' || !Number.isSafeInteger(obj.until) || obj.until < 0) {
        return CORRUPT(`${what}.until`, `expected non-negative epoch ms, got ${JSON.stringify(obj.until)}`)
      }
      result.until = obj.until
    }
    return result
  }
  return CORRUPT(`${what}.kind`, `unknown schedule kind ${JSON.stringify(obj.kind)}`)
}

/** The normalized schedule cell form (interval default 1 落库 — 确定性展示). */
export function encodeSchedule(schedule: SevSchedule): string {
  if (schedule.kind === 'ONCE') {
    return JSON.stringify({ kind: 'ONCE', at: schedule.at })
  }
  return JSON.stringify({ kind: 'RECURRING', freq: schedule.freq, interval: schedule.interval ?? 1, ...(schedule.until !== undefined ? { until: schedule.until } : {}) })
}

/** Encode `InteractionRecord` into the INSERT parameter list (column order = DDL). */
export function interactionToParams(r: InteractionRecord): (string | number | null)[] {
  return [
    r.id,
    r.kind,
    r.title,
    r.occurred_at,
    r.participants === undefined ? null : JSON.stringify([...r.participants]),
    r.notes ?? null,
    r.related_workstreams === undefined ? null : JSON.stringify([...r.related_workstreams]),
  ]
}

/** Decode an `interaction` row back to the record (throws on corruption). */
export function rowToInteraction(row: Record<string, unknown>): InteractionRecord {
  if (typeof row.id !== 'string') return CORRUPT('interaction.id', `expected string, got ${typeof row.id}`)
  if (!isInteractionKind(row.kind)) return CORRUPT('interaction.kind', `unknown kind ${JSON.stringify(String(row.kind))}`)
  if (typeof row.title !== 'string') return CORRUPT('interaction.title', `expected string, got ${typeof row.title}`)
  if (typeof row.occurred_at !== 'number') return CORRUPT('interaction.occurred_at', `expected number, got ${typeof row.occurred_at}`)
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    occurred_at: row.occurred_at,
    ...(row.participants != null ? { participants: decodeStringArray(row.participants, 'interaction.participants') } : {}),
    ...(row.notes != null ? { notes: String(row.notes) } : {}),
    ...(row.related_workstreams != null ? { related_workstreams: decodeStringArray(row.related_workstreams, 'interaction.related_workstreams') } : {}),
  }
}

/** Encode `ReportingItemRecord` into the INSERT parameter list (column order = DDL). */
export function reportingItemToParams(r: ReportingItemRecord): (string | number | null)[] {
  return [
    r.id,
    r.audience,
    r.statement,
    r.material_refs === undefined ? null : JSON.stringify(r.material_refs.map((t): TypedRefJson => ({ kind: t.kind, id: t.id }))),
    r.status,
    r.occasion_ref ?? null,
    r.created_at,
    r.reported_at ?? null,
  ]
}

/** Decode a `reporting_item` row back to the record (throws on corruption). */
export function rowToReportingItem(row: Record<string, unknown>): ReportingItemRecord {
  if (typeof row.id !== 'string') return CORRUPT('reporting_item.id', `expected string, got ${typeof row.id}`)
  if (typeof row.audience !== 'string') return CORRUPT('reporting_item.audience', `expected string, got ${typeof row.audience}`)
  if (typeof row.statement !== 'string') return CORRUPT('reporting_item.statement', `expected string, got ${typeof row.statement}`)
  if (!isRptStatus(row.status)) return CORRUPT('reporting_item.status', `unknown status ${JSON.stringify(String(row.status))}`)
  if (typeof row.created_at !== 'number') return CORRUPT('reporting_item.created_at', `expected number, got ${typeof row.created_at}`)
  return {
    id: row.id,
    audience: row.audience,
    statement: row.statement,
    ...(row.material_refs != null ? { material_refs: decodeTypedRefs(row.material_refs, 'reporting_item.material_refs') } : {}),
    status: row.status,
    ...(row.occasion_ref != null ? { occasion_ref: String(row.occasion_ref) } : {}),
    created_at: row.created_at,
    ...(row.reported_at != null ? { reported_at: row.reported_at as number } : {}),
  }
}

/** Encode `ScheduledEventRecord` into the INSERT parameter list (column order = DDL). */
export function scheduledEventToParams(r: ScheduledEventRecord): (string | number | null)[] {
  return [
    r.id,
    r.title,
    encodeSchedule(r.schedule),
    r.related_refs === undefined ? null : JSON.stringify(r.related_refs.map((t): TypedRefJson => ({ kind: t.kind, id: t.id }))),
    r.reminder_lead_ms ?? null,
  ]
}

/** Decode a `scheduled_event` row back to the record (throws on corruption). */
export function rowToScheduledEvent(row: Record<string, unknown>): ScheduledEventRecord {
  if (typeof row.id !== 'string') return CORRUPT('scheduled_event.id', `expected string, got ${typeof row.id}`)
  if (typeof row.title !== 'string') return CORRUPT('scheduled_event.title', `expected string, got ${typeof row.title}`)
  const result: { id: string; title: string; schedule: SevSchedule; related_refs?: readonly TypedRefJson[]; reminder_lead_ms?: number } = {
    id: row.id,
    title: row.title,
    schedule: decodeSchedule(row.schedule, 'scheduled_event.schedule'),
  }
  if (row.related_refs != null) {
    const refs = decodeTypedRefs(row.related_refs, 'scheduled_event.related_refs')
    for (const ref of refs) {
      if (!isSevRelatedRefKind(ref.kind)) {
        return CORRUPT('scheduled_event.related_refs', `ref kind ${JSON.stringify(ref.kind)} is not one of REPORTING_ITEM|INTERVENTION|TOPIC`)
      }
    }
    result.related_refs = refs
  }
  if (row.reminder_lead_ms != null) {
    if (typeof row.reminder_lead_ms !== 'number') return CORRUPT('scheduled_event.reminder_lead_ms', `expected number, got ${typeof row.reminder_lead_ms}`)
    result.reminder_lead_ms = row.reminder_lead_ms
  }
  return result
}
