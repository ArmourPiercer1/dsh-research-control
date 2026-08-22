/**
 * WP-2.4 — runbinding tables: V1 DDL + row mapping (DOMAIN_SCHEMA §15).
 *
 * Table mapping (frozen §15 L615-616, 逐字):
 *
 *   run                 PK `run_id`; 索引 (workstream_id, started_at)、dsh_session_id
 *   discovered_session  PK `id`;      UNIQUE(dsh_session_id)
 *
 * These two §15 tables are NOT created by the WP-2.1 `openDatabase`
 * (its schema.ts owns history_event / derived_state / meta and gates
 * `user_version=1`); this WP creates them in the SAME research.sqlite
 * file through a second `node:sqlite` connection (the store's
 * `openDatabase` wrapper is still used first — it performs the file
 * init, the owner-only permission bits, the WAL setup and the
 * version gate). Pre-release does no migrations (§15 is a single V1
 * mapping): `CREATE TABLE IF NOT EXISTS` makes (re)open idempotent, and
 * the store's `user_version` gate keeps applying to the whole file.
 *
 * §15 通则: no operational table hard-deletes first-class identity rows
 * (INV-HIST-7) — the table faces in tables.ts therefore expose NO
 * DELETE method for `run`/`discovered_session`; the storage layer
 * additionally rejects raw DELETE via triggers, exactly like WP-2.1 did
 * for `history_event`.
 *
 * Column set = the frozen `schema/operational/run.schema.json` $defs
 * (Run / DiscoveredSession, additionalProperties:false), snake_case,
 * epoch-ms integers (DOMAIN_SCHEMA §1.2), JSON TEXT for `initiated_by`
 * (frozen `actorRef` object). CHECK constraints pin the two frozen
 * enums (§13 state machines) at the storage level.
 *
 * No DSH imports (INV-PERM-5); `node:sqlite` is the Node builtin the
 * store already uses.
 */

import type { ActorRef, RunStatus } from '../../history/registry/index.js'
import type { DiscoveredSessionRecord, DsState, RunRecord } from './types.js'

export const RUN_TABLE = 'run'
export const DISCOVERED_SESSION_TABLE = 'discovered_session'

/** The frozen RunStatus enum (DOMAIN_SCHEMA §13 L549) as a SQL CHECK list. */
const RUN_STATUSES = ['RUNNING', 'FINISHED', 'FAILED', 'CANCELLED'] as const
/** The frozen DsState enum (DOMAIN_SCHEMA §13 L554) as a SQL CHECK list. */
const DS_STATES = ['PENDING', 'BOUND', 'DETACHED', 'IGNORED'] as const

const RUN_DDL = `
CREATE TABLE IF NOT EXISTS ${RUN_TABLE} (
  run_id                 TEXT    NOT NULL PRIMARY KEY,
  workstream_id          TEXT    NOT NULL,           -- Formal Run 必须绑定 WS (§6.1)
  task_id                TEXT,                       -- 可空 (exploratory run, §6.1)
  dsh_session_id         TEXT,                       -- 指针, 不复制内容 (INV-DB-2)
  status                 TEXT    NOT NULL CHECK (status IN ('RUNNING','FINISHED','FAILED','CANCELLED')),
  intent                 TEXT,
  initiated_by           TEXT    NOT NULL,           -- ActorRef JSON (frozen actorRef)
  started_at             INTEGER NOT NULL,           -- epoch ms (§1.2)
  ended_at               INTEGER,                    -- epoch ms (§1.2)
  summary                TEXT,
  last_checkpoint_at     INTEGER,                    -- epoch ms (§1.2)
  last_checkpoint_note   TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_ws_started
  ON ${RUN_TABLE} (workstream_id, started_at);
CREATE INDEX IF NOT EXISTS idx_run_dsh_session
  ON ${RUN_TABLE} (dsh_session_id);
-- INV-HIST-7 存储层半边: 一等 identity 行不 hard delete (raw SQL 也拒绝)。
CREATE TRIGGER IF NOT EXISTS ${RUN_TABLE}_no_delete
  BEFORE DELETE ON ${RUN_TABLE}
  BEGIN
    SELECT RAISE(ABORT, 'run rows are first-class identity and cannot be hard-deleted (INV-HIST-7)');
  END;
`

const DISCOVERED_SESSION_DDL = `
CREATE TABLE IF NOT EXISTS ${DISCOVERED_SESSION_TABLE} (
  id               TEXT    NOT NULL PRIMARY KEY,
  dsh_session_id   TEXT    NOT NULL UNIQUE,          -- §15 L616: UNIQUE(dsh_session_id)
  workspace_root   TEXT    NOT NULL,                 -- 归属的注册 workspace 根
  discovered_at    INTEGER NOT NULL,                 -- epoch ms (§1.2)
  state            TEXT    NOT NULL CHECK (state IN ('PENDING','BOUND','DETACHED','IGNORED')),
  bound_run_id     TEXT,                             -- state=BOUND 时 (CHECK 联动见下)
  summary          TEXT,
  CHECK (
    (state = 'BOUND') = (bound_run_id IS NOT NULL)   -- §6.2: bound_run_id iff state=BOUND
  )
);
CREATE TRIGGER IF NOT EXISTS ${DISCOVERED_SESSION_TABLE}_no_delete
  BEFORE DELETE ON ${DISCOVERED_SESSION_TABLE}
  BEGIN
    SELECT RAISE(ABORT, 'discovered_session rows are first-class identity and cannot be hard-deleted (INV-HIST-7)');
  END;
`

/** Full runbinding V1 DDL (idempotent; executed on the second connection). */
export function runBindingDdl(): string {
  return [RUN_DDL, DISCOVERED_SESSION_DDL].join('\n')
}

/** Tables this WP owns alongside the WP-2.1 core tables (diagnostics). */
export const RUNBINDING_TABLES = [RUN_TABLE, DISCOVERED_SESSION_TABLE] as const

/** The frozen enums, for the service/state-machine layers + tests. */
export const RUN_STATUS_VALUES: readonly RunStatus[] = RUN_STATUSES
export const DS_STATE_VALUES: readonly DsState[] = DS_STATES

/* ------------------------------------------------------------------ *
 * Row mapping (snake_case columns ↔ record interfaces)
 * ------------------------------------------------------------------ */

/** Serialize a run record to a parameter list (insert). */
export function runToParams(run: RunRecord): [string, string, string | null, string | null, string, string | null, string, number, number | null, string | null, number | null, string | null] {
  return [
    run.id,
    run.workstream_id,
    run.task_id ?? null,
    run.dsh_session_id ?? null,
    run.status,
    run.intent ?? null,
    actorToJson(run.initiated_by),
    run.started_at,
    run.ended_at ?? null,
    run.summary ?? null,
    run.last_checkpoint_at ?? null,
    run.last_checkpoint_note ?? null,
  ]
}

/** Serialize a DS record to a parameter list (insert). */
export function discoveredSessionToParams(ds: DiscoveredSessionRecord): [string, string, string, number, string, string | null, string | null] {
  return [
    ds.id,
    ds.dsh_session_id,
    ds.workspace_root,
    ds.discovered_at,
    ds.state,
    ds.bound_run_id ?? null,
    ds.summary ?? null,
  ]
}

/** `run` row → `RunRecord` (frozen schema keys; optional keys dropped when NULL). */
export function rowToRun(row: Record<string, unknown>): RunRecord {
  const base: RunRecord = {
    id: str(row, 'run_id'),
    workstream_id: str(row, 'workstream_id'),
    status: str(row, 'status') as RunStatus,
    initiated_by: parseActor(str(row, 'initiated_by')),
    started_at: int(row, 'started_at'),
  }
  return withOptional(base, row)
}

function withOptional(base: RunRecord, row: Record<string, unknown>): RunRecord {
  const out = base as unknown as Record<string, unknown>
  const taskId = opt(row, 'task_id')
  if (taskId !== null) out.task_id = taskId
  const sessionId = opt(row, 'dsh_session_id')
  if (sessionId !== null) out.dsh_session_id = sessionId
  const intent = opt(row, 'intent')
  if (intent !== null) out.intent = intent
  const endedAt = optInt(row, 'ended_at')
  if (endedAt !== null) out.ended_at = endedAt
  const summary = opt(row, 'summary')
  if (summary !== null) out.summary = summary
  const checkpointAt = optInt(row, 'last_checkpoint_at')
  if (checkpointAt !== null) out.last_checkpoint_at = checkpointAt
  const checkpointNote = opt(row, 'last_checkpoint_note')
  if (checkpointNote !== null) out.last_checkpoint_note = checkpointNote
  return out as unknown as RunRecord
}

/** `discovered_session` row → `DiscoveredSessionRecord`. */
export function rowToDiscoveredSession(row: Record<string, unknown>): DiscoveredSessionRecord {
  const base: DiscoveredSessionRecord = {
    id: str(row, 'id'),
    dsh_session_id: str(row, 'dsh_session_id'),
    workspace_root: str(row, 'workspace_root'),
    discovered_at: int(row, 'discovered_at'),
    state: str(row, 'state') as DsState,
  }
  const out = base as unknown as Record<string, unknown>
  const boundRunId = opt(row, 'bound_run_id')
  if (boundRunId !== null) out.bound_run_id = boundRunId
  const summary = opt(row, 'summary')
  if (summary !== null) out.summary = summary
  return out as unknown as DiscoveredSessionRecord
}

/* ------------------------------------------------------------------ *
 * JSON (strict, store-style)
 * ------------------------------------------------------------------ */

export function actorToJson(actor: ActorRef): string {
  return JSON.stringify(actor)
}

export function parseActor(json: string): ActorRef {
  const value: unknown = JSON.parse(json)
  if (typeof value !== 'object' || value === null) {
    throw new Error('run.initiated_by is not a JSON object — database corruption')
  }
  return value as ActorRef
}

function str(row: Record<string, unknown>, key: string): string {
  const v = row[key]
  if (typeof v !== 'string') throw new Error(`${key} is not a string — database corruption`)
  return v
}

function int(row: Record<string, unknown>, key: string): number {
  const v = row[key]
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new Error(`${key} is not an integer — database corruption`)
  }
  return v
}

function opt(row: Record<string, unknown>, key: string): string | null {
  const v = row[key]
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') throw new Error(`${key} is not a string/null — database corruption`)
  return v
}

function optInt(row: Record<string, unknown>, key: string): number | null {
  const v = row[key]
  if (v === null || v === undefined) return null
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new Error(`${key} is not an integer/null — database corruption`)
  }
  return v
}
