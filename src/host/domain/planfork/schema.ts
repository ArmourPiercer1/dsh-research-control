/**
 * WP-3.1 — plan_fork + management_action 表: DDL + 行↔记录映射 (纯数据).
 *
 * 表映射 (DOMAIN_SCHEMA §15, 逐字):
 *   - `plan_fork`           §15 L625 — PK `id`; 索引 `(workstream_id, status)`;
 *   - `management_action`   §15 L626 — PK `id` (本 WP 只 append PF_* 行;
 *     表归 §15 映射, 冻结形状 = provenance.schema.json $defs/ManagementAction)。
 * §15 通则: operational 表**不 hard delete** 一等 identity 行 (INV-HIST-7);
 * 状态列是派生缓存 (本表: PF 状态机 §10 的 status 缓存列)。
 *
 * DatabaseSync 封装模式 (任务边界: 「复用 store 的 DatabaseSync 封装模式,
 * DDL 放本目录」— 同 WP-2.4 runbinding tables 的双连接模式):
 *   1. DB 文件的 open/初始化 (0o700/0o600、WAL、user_version 门、
 *      quick_check) 归 WP-2.1 `persistence/store` 的 `openDatabase` 封装;
 *   2. 本模块的 DDL 在**第二连接**上以幂等 `IF NOT EXISTS` 应用
 *      (`PlanForkStore` 构造时经注入 `PlanForkDb.exec` — 域层零 sqlite
 *      import, ARCHITECTURE §2.2 rule 1; 驱动是注入的 I/O);
 *   3. 两连接 WAL 共存, 写经文件锁串行化 (busy_timeout 同 store 默认)。
 * tests/planfork/persist.test.ts 用真实 research.sqlite (store 封装开库 +
 * 第二连接) 证明该模式端到端可用。
 *
 * 存储层不变量 (trigger 级, 任何连接上生效 — 同 WP-2.1/WP-2.4 先例):
 *   - INV-PLAN-4 / §10 「PF 行永不删除」: `plan_fork_no_delete` ABORT 任何
 *     DELETE (含第二连接 raw SQL);
 *   - INV-PLAN-4 「不能修改已有 PlanFork」(创建后内容不可变):
 *     `plan_fork_no_content_update` ABORT 任何对 11 个创建后不变列的
 *     UPDATE (id/workstream_id/base_plan_objects/base_git_commit/
 *     fork_anchor/merge_anchor/proposed_items/trigger_refs/reason/
 *     necessity/created_by_run/created_at); 允许 UPDATE 的只有状态缓存列
 *     (status/selected_at/selected_by/dismissed_at/stale_reason) — 即
 *     §10 「全部状态迁移 append-only 记录」的行侧机制;
 *   - INV-HIST-7: `management_action_no_delete` ABORT 账本行删除;
 *   - 账本内容不可变 (G3 R1 防御纵深加固, 对齐 `plan_fork` 双触发器形态):
 *     `management_action_no_content_update` ABORT 对 8 个内容列任何
 *     UPDATE — 账本行无状态缓存列, 创建后整体不可变 (append-only)。
 *   - §5 字段共现 (CHECK): selected_at/selected_by ⇔ status=SELECTED;
 *     dismissed_at ⇔ status=DISMISSED; stale_reason ⇔ status=STALE。
 *
 * 纯模块: DDL 字符串 + 行映射 + SQL 语句常量 (零 I/O, 零驱动 import)。
 */

import type {
  ActorRef,
  BasePlanObject,
  GitBlobOid,
  ManagementActionRecord,
  PfStatus,
  PlanForkRecord,
  ProposedItem,
  TriggerRef,
} from './types.js'
import { isPfStatus } from './state-machine.js'

export const PLAN_FORK_TABLE = 'plan_fork'
export const MANAGEMENT_ACTION_TABLE = 'management_action'

const PLAN_FORK_DDL = `
CREATE TABLE IF NOT EXISTS ${PLAN_FORK_TABLE} (
  id                TEXT    NOT NULL PRIMARY KEY,
  workstream_id     TEXT    NOT NULL,
  base_plan_objects TEXT    NOT NULL,  -- JSON [{path, git_blob_oid}] (§3.2 稳定集合)
  base_git_commit   TEXT,              -- 信息性 HEAD (§3.2, 不参与 stale 判定)
  fork_anchor       TEXT    NOT NULL,  -- canonical item id 或 __START__/__END__ (§2.2)
  merge_anchor      TEXT    NOT NULL,
  proposed_items    TEXT    NOT NULL,  -- JSON ProposedItem[] (有序, §2.1)
  trigger_refs      TEXT    NOT NULL,  -- JSON TypedRef[] (≥1, kind 5 种)
  reason            TEXT    NOT NULL,
  necessity         TEXT    NOT NULL,
  created_by_run    TEXT    NOT NULL,
  created_at        INTEGER NOT NULL,  -- epoch ms (§1.2, A-3 修订)
  status            TEXT    NOT NULL CHECK (status IN ('OPEN', 'SELECTED', 'DISMISSED', 'STALE')),
  selected_at       INTEGER,
  selected_by       TEXT,              -- ActorRef JSON (用户, WP-3.4)
  dismissed_at      INTEGER,
  stale_reason      TEXT,
  -- §5 字段共现 (状态 ↔ 迁移字段, 逐一对应):
  CHECK ((status = 'SELECTED')  = (selected_at IS NOT NULL AND selected_by IS NOT NULL)),
  CHECK ((status = 'DISMISSED') = (dismissed_at IS NOT NULL)),
  CHECK ((status = 'STALE')     = (stale_reason IS NOT NULL))
);
-- §15 L625 关键索引 (workstream_id, status): flooding 计数 (WP-3.5) 与
-- 按 WS 列表查询的单结构入口。
CREATE INDEX IF NOT EXISTS idx_plan_fork_ws_status
  ON ${PLAN_FORK_TABLE} (workstream_id, status);
-- §10 / INV-PLAN-4: PF 行永不删除 (append-only proposal 的身份行)。
CREATE TRIGGER IF NOT EXISTS plan_fork_no_delete
  BEFORE DELETE ON ${PLAN_FORK_TABLE}
  BEGIN
    SELECT RAISE(ABORT, 'plan_fork rows are never deleted (PLAN_FORK_SPEC §10; ARCHITECTURE §5.4 INV-PLAN-4)');
  END;
-- INV-PLAN-4 内容不可变半边: 创建后的 11 个内容列任何 UPDATE 都 ABORT
-- (状态缓存列 status/selected_at/selected_by/dismissed_at/stale_reason
-- 是 §10 状态迁移的合法 UPDATE 面)。
CREATE TRIGGER IF NOT EXISTS plan_fork_no_content_update
  BEFORE UPDATE ON ${PLAN_FORK_TABLE}
  WHEN NEW.id IS NOT OLD.id
   OR NEW.workstream_id IS NOT OLD.workstream_id
   OR NEW.base_plan_objects IS NOT OLD.base_plan_objects
   OR IFNULL(NEW.base_git_commit, '') IS NOT IFNULL(OLD.base_git_commit, '')
   OR NEW.fork_anchor IS NOT OLD.fork_anchor
   OR NEW.merge_anchor IS NOT OLD.merge_anchor
   OR NEW.proposed_items IS NOT OLD.proposed_items
   OR NEW.trigger_refs IS NOT OLD.trigger_refs
   OR NEW.reason IS NOT OLD.reason
   OR NEW.necessity IS NOT OLD.necessity
   OR NEW.created_by_run IS NOT OLD.created_by_run
   OR NEW.created_at IS NOT OLD.created_at
  BEGIN
    SELECT RAISE(ABORT, 'plan_fork content is immutable after creation (ARCHITECTURE §5.4 INV-PLAN-4; only the state-cache columns may change)');
  END;
`

const MANAGEMENT_ACTION_DDL = `
CREATE TABLE IF NOT EXISTS ${MANAGEMENT_ACTION_TABLE} (
  id             TEXT    NOT NULL PRIMARY KEY,
  action_kind    TEXT    NOT NULL,  -- 15 值冻结枚举 (provenance.schema.json)
  actor          TEXT    NOT NULL,  -- ActorRef JSON
  subject_refs   TEXT    NOT NULL,  -- TypedRef[] JSON
  git_commit_oid TEXT,
  git_blob_oids  TEXT,              -- [{path, oid}] JSON
  detail         TEXT,
  occurred_at    INTEGER NOT NULL   -- epoch ms (§1.2)
);
-- §15 通则 / INV-HIST-7: 一等 identity 行不 hard delete。
CREATE TRIGGER IF NOT EXISTS management_action_no_delete
  BEFORE DELETE ON ${MANAGEMENT_ACTION_TABLE}
  BEGIN
    SELECT RAISE(ABORT, 'management_action rows are never deleted (DOMAIN_SCHEMA §15 通则; ARCHITECTURE §5.4 INV-HIST-7)');
  END;
-- 账本内容不可变 (G3 R1 加固, 对齐 plan_fork_no_content_update 形态):
-- 8 列全是内容列 (无状态缓存列), 任何 UPDATE 都 ABORT (append-only)。
CREATE TRIGGER IF NOT EXISTS management_action_no_content_update
  BEFORE UPDATE ON ${MANAGEMENT_ACTION_TABLE}
  WHEN NEW.id IS NOT OLD.id
   OR NEW.action_kind IS NOT OLD.action_kind
   OR NEW.actor IS NOT OLD.actor
   OR NEW.subject_refs IS NOT OLD.subject_refs
   OR IFNULL(NEW.git_commit_oid, '') IS NOT IFNULL(OLD.git_commit_oid, '')
   OR IFNULL(NEW.git_blob_oids, '') IS NOT IFNULL(OLD.git_blob_oids, '')
   OR IFNULL(NEW.detail, '') IS NOT IFNULL(OLD.detail, '')
   OR NEW.occurred_at IS NOT OLD.occurred_at
  BEGIN
    SELECT RAISE(ABORT, 'management_action ledger rows are immutable after creation (DOMAIN_SCHEMA §15 通则; G3 R1 defense in depth, aligned with plan_fork_no_content_update)');
  END;
`

/** Full DDL (idempotent — re-applied on every store open, 同 runbinding 先例). */
export function planForkDdl(): string {
  return PLAN_FORK_DDL + MANAGEMENT_ACTION_DDL
}

/** Tables this WP's DDL declares (EXPECTED-tables 诊断面). */
export const PLANFORK_TABLES = [PLAN_FORK_TABLE, MANAGEMENT_ACTION_TABLE] as const

/* ------------------------------------------------------------------ *
 * SQL statements (参数化; 驱动经 PlanForkDb 端口 — 域层不 import sqlite)
 * ------------------------------------------------------------------ */

export const SQL_INSERT_PLAN_FORK = `
INSERT INTO ${PLAN_FORK_TABLE} (id, workstream_id, base_plan_objects, base_git_commit, fork_anchor, merge_anchor, proposed_items, trigger_refs, reason, necessity, created_by_run, created_at, status, selected_at, selected_by, dismissed_at, stale_reason)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

export const SQL_SELECT_PLAN_FORK_BY_ID = `SELECT * FROM ${PLAN_FORK_TABLE} WHERE id = ?`

export const SQL_SELECT_MANAGEMENT_ACTION_BY_ID = `SELECT * FROM ${MANAGEMENT_ACTION_TABLE} WHERE id = ?`

/** The optimistic state-machine UPDATE per target (WHERE status = from). */
/**
 * Transition UPDATEs — each sets its own state's co-occurring fields AND
 * NULLs the other states' fields (字段共现 CHECK 的 UPDATE 面: 从 STALE
 * 转 DISMISSED 必须清 stale_reason, 否则 (status='STALE')⇔(stale_reason
 * IS NOT NULL) CHECK 违例). `WHERE status = ?` = 乐观并发门。
 */
export const SQL_TRANSITION_PLAN_FORK = {
  SELECTED: `UPDATE ${PLAN_FORK_TABLE} SET status = 'SELECTED', selected_at = ?, selected_by = ?, dismissed_at = NULL, stale_reason = NULL WHERE id = ? AND status = ?`,
  DISMISSED: `UPDATE ${PLAN_FORK_TABLE} SET status = 'DISMISSED', dismissed_at = ?, selected_at = NULL, selected_by = NULL, stale_reason = NULL WHERE id = ? AND status = ?`,
  STALE: `UPDATE ${PLAN_FORK_TABLE} SET status = 'STALE', stale_reason = ?, selected_at = NULL, selected_by = NULL, dismissed_at = NULL WHERE id = ? AND status = ?`,
} as const

export const SQL_INSERT_MANAGEMENT_ACTION = `
INSERT INTO ${MANAGEMENT_ACTION_TABLE} (id, action_kind, actor, subject_refs, git_commit_oid, git_blob_oids, detail, occurred_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`

/* ------------------------------------------------------------------ *
 * Row ↔ record mapping (损坏行大声失败 — 同 WP-2.4 rowToRun 纪律)
 * ------------------------------------------------------------------ */

const CORRUPT = (what: string, detail: string): never => {
  throw new Error(`planfork row corruption at ${what}: ${detail}`)
}

function decodeJson<T>(value: unknown, what: string): T {
  if (typeof value !== 'string') return CORRUPT(what, `expected JSON string, got ${typeof value}`)
  try {
    return JSON.parse(value) as T
  } catch (cause) {
    return CORRUPT(what, `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Encode `PlanForkRecord` into the INSERT parameter list (column order = DDL). */
export function planForkToParams(r: PlanForkRecord): (string | number | null)[] {
  return [
    r.id,
    r.workstream_id,
    JSON.stringify(r.base_plan_objects.map((o): BasePlanObject => ({ path: o.path, git_blob_oid: o.git_blob_oid }))),
    r.base_git_commit ?? null,
    r.fork_anchor,
    r.merge_anchor,
    // 逐条序列化 (KEEP: {action,kind,ref}; NEW: {action,kind,spec}) — 与
    // 冻结 $defs/ProposedItem 的两种封闭形状逐字对应。
    JSON.stringify(
      r.proposed_items.map((p) =>
        p.action === 'KEEP'
          ? { action: p.action, kind: p.kind, ref: p.ref }
          : { action: p.action, kind: p.kind, spec: { ...p.spec } },
      ),
    ),
    JSON.stringify(r.trigger_refs.map((t): TriggerRef => ({ kind: t.kind, id: t.id }))),
    r.reason,
    r.necessity,
    r.created_by_run,
    r.created_at,
    r.status,
    r.selected_at ?? null,
    r.selected_by === undefined ? null : JSON.stringify(r.selected_by),
    r.dismissed_at ?? null,
    r.stale_reason ?? null,
  ]
}

/** Decode a `plan_fork` row back to the record (throws on corruption). */
export function rowToPlanFork(row: Record<string, unknown>): PlanForkRecord {
  const status = row.status
  if (typeof status !== 'string' || !isPfStatus(status)) {
    return CORRUPT('plan_fork.status', `unknown status ${JSON.stringify(String(status))}`)
  }
  for (const name of ['id', 'workstream_id', 'fork_anchor', 'merge_anchor', 'reason', 'necessity', 'created_by_run'] as const) {
    if (typeof row[name] !== 'string') return CORRUPT(`plan_fork.${name}`, `expected string, got ${typeof row[name]}`)
  }
  if (typeof row.created_at !== 'number') return CORRUPT('plan_fork.created_at', `expected number, got ${typeof row.created_at}`)
  return {
    id: row.id as string,
    workstream_id: row.workstream_id as string,
    base_plan_objects: decodeJson<readonly BasePlanObject[]>(row.base_plan_objects, 'plan_fork.base_plan_objects'),
    fork_anchor: row.fork_anchor as string,
    merge_anchor: row.merge_anchor as string,
    proposed_items: decodeJson<readonly ProposedItem[]>(row.proposed_items, 'plan_fork.proposed_items'),
    trigger_refs: decodeJson<readonly TriggerRef[]>(row.trigger_refs, 'plan_fork.trigger_refs'),
    reason: row.reason as string,
    necessity: row.necessity as string,
    created_by_run: row.created_by_run as string,
    created_at: row.created_at as number,
    status,
    ...(row.base_git_commit != null ? { base_git_commit: String(row.base_git_commit) } : {}),
    ...(row.selected_at != null ? { selected_at: row.selected_at as number } : {}),
    ...(row.selected_by != null ? { selected_by: decodeJson<ActorRef>(row.selected_by, 'plan_fork.selected_by') } : {}),
    ...(row.dismissed_at != null ? { dismissed_at: row.dismissed_at as number } : {}),
    ...(row.stale_reason != null ? { stale_reason: String(row.stale_reason) } : {}),
  }
}

/** Encode `ManagementActionRecord` into the INSERT parameter list. */
export function managementActionToParams(a: ManagementActionRecord): (string | number | null)[] {
  return [
    a.id,
    a.action_kind,
    JSON.stringify(a.actor),
    JSON.stringify(a.subject_refs),
    a.git_commit_oid ?? null,
    a.git_blob_oids === undefined ? null : JSON.stringify(a.git_blob_oids.map((g): GitBlobOid => ({ path: g.path, oid: g.oid }))),
    a.detail ?? null,
    a.occurred_at,
  ]
}

/** Decode a `management_action` row (throws on corruption). */
export function rowToManagementAction(row: Record<string, unknown>): ManagementActionRecord {
  if (typeof row.id !== 'string') return CORRUPT('management_action.id', `expected string, got ${typeof row.id}`)
  if (typeof row.action_kind !== 'string') return CORRUPT('management_action.action_kind', `expected string, got ${typeof row.action_kind}`)
  if (typeof row.occurred_at !== 'number') return CORRUPT('management_action.occurred_at', `expected number, got ${typeof row.occurred_at}`)
  return {
    id: row.id,
    action_kind: row.action_kind as ManagementActionRecord['action_kind'],
    actor: decodeJson<ActorRef>(row.actor, 'management_action.actor'),
    subject_refs: decodeJson<readonly { kind: string; id: string }[]>(row.subject_refs, 'management_action.subject_refs'),
    occurred_at: row.occurred_at,
    ...(row.git_commit_oid != null ? { git_commit_oid: String(row.git_commit_oid) } : {}),
    ...(row.git_blob_oids != null ? { git_blob_oids: decodeJson<readonly GitBlobOid[]>(row.git_blob_oids, 'management_action.git_blob_oids') } : {}),
    ...(row.detail != null ? { detail: String(row.detail) } : {}),
  }
}
