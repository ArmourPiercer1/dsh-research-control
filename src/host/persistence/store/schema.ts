/**
 * WP-2.1 — research.sqlite V1 schema (DDL + version constant).
 *
 * WP-2.9 (TC-PERF-003): run/task filter indexes.
 *
 * Run/task references live only inside the `payload` JSON (the catalog §5
 * tables make `run_id` / `task_id` TOP-LEVEL payload fields of the
 * RUN_* / TASK_* events), so "filter by run/task" queries had no column to
 * index on — the WP-2.8 triage measured a full-table `payload LIKE` SCAN.
 * This WP closes the gap with two VIRTUAL generated columns + composite
 * indexes, merged into the V1 init DDL below.
 *
 * Why generated columns (option A) over explicit append-maintained columns
 * (option B, WP-2.8 legacy issue 1):
 *   - ZERO append-path change: SQLite computes the columns from `payload`
 *     at insert time; the INSERT statement, the `appendEvents` API shape,
 *     and the append transaction body are untouched, and the columns are
 *     non-writable by construction (INV-HIST-1 surface intact);
 *   - drift is IMPOSSIBLE: the values are a pure function of the payload
 *     (the §1 envelope source of truth). Option B would add a store-owned
 *     derived-data surface to the append transaction (new extraction step,
 *     new failure mode) that §15 通则 would then owe replay-rebuild
 *     semantics ("状态列是 History 的派生缓存，可由 replay 重建");
 *   - §15 compatibility: §15 is a 表映射概要 (mapping OVERVIEW) — the
 *     history_event row pins PK + UNIQUE + three KEY indexes and lists no
 *     columns at all (columns derive from the §1 envelope, cf. this file's
 *     WP-2.1 header); "关键约束/索引" is an overview, not a closed set
 *     (cf. the `run` row, whose second item is a bare column name, not
 *     index syntax). Nothing §15 lists is removed, renamed, or altered —
 *     the addition is strictly additive, and §15 通则 already sanctions
 *     derived-cache data in operational tables: a generated column is that
 *     pattern with zero maintenance.
 *
 * user_version stays 1 (V1 is pre-release, no production deployment —
 * there is nothing to migrate; the version tracks the §15 table mapping,
 * not micro-index changes within it). Consequence for stale DEV files
 * (written by a pre-WP-2.9 build, user_version=1, old structure): the
 * open path now REJECTS them with a structured STORE_SCHEMA_STALE — same
 *「不匹配即拒绝、不迁移」policy as the numeric version gate; the remedy
 * is to delete the file and reinitialize (a fresh open re-runs the V1
 * init transaction).
 *
 * Index shape: (payload_run_id, occurred_at) / (payload_task_id,
 * occurred_at) — isomorphic to the existing (event_type, occurred_at)
 * index: equality filter + time-ordered listing per run/task from one
 * structure (catalog §2 dual-time-line shape). `json_extract` yields NULL
 * when the key is absent (e.g. FACT_RECORDED payloads carry no run_id) —
 * such rows are indexed but never matched by an equality probe.
 *
 * Requires SQLite ≥ 3.31 (generated columns; node:sqlite on Node 22
 * bundles ≥ 3.45, verified 3.51.2) — the store already requires the
 * node:sqlite builtin, so no new runtime floor is introduced.
 *
 * Table mapping follows DOMAIN_SCHEMA §15 verbatim for the three tables
 * this WP owns; the remaining §15 tables (run, claim, fact, artifact, …)
 * are NOT created here — each gets its WP when its service lands (the
 * version stays 1: §15 is a single V1 mapping, and pre-release does no
 * migrations — adding tables later is a user_version bump + migration
 * decision for that WP, out of scope now).
 *
 * Columns beyond the §15 summary (PK / UNIQUE / indexes) come from the
 * frozen event envelope (HISTORY_EVENT_CATALOG §1) and the §15 通则
 * (epoch ms per §1.2; JSON TEXT for structured values):
 *
 *   history_event  §15 L614 — PK `event_id`;
 *                   UNIQUE(owner_workstream_id, event_seq);
 *                   indexes (owner_workstream_id, occurred_at, event_seq),
 *                   (event_type, occurred_at), (recorded_at).
 *                   WP-2.9 addendum: generated query-aid columns
 *                   payload_run_id / payload_task_id (virtual, derived from
 *                   `payload`) + indexes (payload_run_id, occurred_at),
 *                   (payload_task_id, occurred_at) — strictly additive,
 *                   §15-compatible (see WP-2.9 block above).
 *   derived_state  §15 L627 — PK (object_kind, object_id); `state` JSON,
 *                   replaced wholesale; same-transaction write with event
 *                   append; rebuildable by replay (TC-HIST-006).
 *   meta           §15 L628 — PK `key`; ID counters + DB schema version.
 *
 * INV-HIST-1 is enforced at the STORAGE level, not only the API surface:
 * the two triggers below ABORT any UPDATE/DELETE on `history_event` —
 * even raw SQL through a second connection cannot rewrite seq/eventId or
 * delete rows (TC-HIST-003「任何 API 不改写既有 seq/eventId」).
 * `derived_state` deliberately stays updatable: it is a derived cache, not
 * first-class identity (INV-HIST-7 applies to identity rows).
 */

/** V1 schema version written to `PRAGMA user_version` at init. */
export const DB_USER_VERSION = 1

/** The conventional DB file name inside the per-project data dir
 *  (DSH_ADAPTER §9: `…/research-control/<project-id>/research.sqlite`). */
export const DB_FILE_NAME = 'research.sqlite'

/** Owner-only permission bits (DSH_ADAPTER §9: 0o700 dir / 0o600 file). */
export const DIR_MODE = 0o700
export const FILE_MODE = 0o600

const HISTORY_EVENT_DDL = `
CREATE TABLE history_event (
  event_id            TEXT    NOT NULL PRIMARY KEY,
  owner_workstream_id TEXT    NOT NULL,
  event_seq           INTEGER NOT NULL,
  event_type          TEXT    NOT NULL,
  schema_version      INTEGER NOT NULL,
  occurred_at         INTEGER NOT NULL,  -- epoch ms (§1.2)
  recorded_at         INTEGER NOT NULL,  -- epoch ms (§1.2)
  actor               TEXT    NOT NULL,  -- ActorRef JSON (§1.3)
  source              TEXT,              -- SourceRef JSON (§1.3), nullable
  payload             TEXT    NOT NULL,  -- event payload JSON
  -- WP-2.9 query-aid columns (TC-PERF-003): VIRTUAL generated, computed by
  -- SQLite from the payload column at insert time - never writable, never
  -- stored separately, cannot drift from the payload (json_extract yields
  -- NULL when the key is absent, e.g. FACT_RECORDED has no run_id).
  payload_run_id      TEXT    GENERATED ALWAYS AS (json_extract(payload, '$.run_id')) VIRTUAL,
  payload_task_id     TEXT    GENERATED ALWAYS AS (json_extract(payload, '$.task_id')) VIRTUAL,
  UNIQUE (owner_workstream_id, event_seq)
);
CREATE INDEX idx_history_event_ws_occurred_seq
  ON history_event (owner_workstream_id, occurred_at, event_seq);
CREATE INDEX idx_history_event_type_occurred
  ON history_event (event_type, occurred_at);
CREATE INDEX idx_history_event_recorded
  ON history_event (recorded_at);
-- WP-2.9: run/task filter indexes (composite = equality filter + time
-- ordered listing per run/task; isomorphic to idx_history_event_type_occurred).
CREATE INDEX idx_history_event_payload_run_occurred
  ON history_event (payload_run_id, occurred_at);
CREATE INDEX idx_history_event_payload_task_occurred
  ON history_event (payload_task_id, occurred_at);
-- INV-HIST-1 storage-level enforcement (append-only; TC-HIST-003).
CREATE TRIGGER history_event_no_update
  BEFORE UPDATE ON history_event
  BEGIN
    SELECT RAISE(ABORT, 'history_event is append-only (INV-HIST-1)');
  END;
CREATE TRIGGER history_event_no_delete
  BEFORE DELETE ON history_event
  BEGIN
    SELECT RAISE(ABORT, 'history_event is append-only (INV-HIST-1)');
  END;
`

const DERIVED_STATE_DDL = `
CREATE TABLE derived_state (
  object_kind TEXT NOT NULL,
  object_id   TEXT NOT NULL,
  state       TEXT NOT NULL,  -- JSON document, replaced wholesale (§15 L627)
  PRIMARY KEY (object_kind, object_id)
);
`

const META_DDL = `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

/** Full V1 DDL, executed once inside a single transaction on a fresh DB
 *  (all-or-nothing; a crash mid-init rolls back to an empty file that the
 *  next open re-initializes). */
export function schemaDdl(): string {
  return [HISTORY_EVENT_DDL, DERIVED_STATE_DDL, META_DDL].join('\n')
}

/** Tables that MUST exist under `user_version = 1`; a missing one means
 *  the file is corrupted (a valid version number with a broken schema). */
export const EXPECTED_TABLES = ['history_event', 'derived_state', 'meta'] as const

/** The EXACT `history_event` column set of this build's V1 DDL (order as
 *  declared). A user_version=1 file whose column set differs — a column
 *  missing (older pre-release build) or extra (newer/unknown build) — is
 *  STALE: rejected on open with STORE_SCHEMA_STALE, no migration (the
 *  numeric version gate's「不匹配即拒绝」policy applied to structure; see
 *  the WP-2.9 header block). */
export const HISTORY_EVENT_COLUMNS = [
  'event_id',
  'owner_workstream_id',
  'event_seq',
  'event_type',
  'schema_version',
  'occurred_at',
  'recorded_at',
  'actor',
  'source',
  'payload',
  'payload_run_id',
  'payload_task_id',
] as const

/** The VIRTUAL generated columns — `PRAGMA table_xinfo` reports them with
 *  `hidden = 2` (SQLite ≥ 3.36: 0 = regular, 1 = stored generated,
 *  2 = virtual generated); every other column must be regular (0). */
export const HISTORY_EVENT_GENERATED = new Set<string>(['payload_run_id', 'payload_task_id'])

/** The NAMED indexes V1 declares on `history_event`. (The UNIQUE/PK
 *  autoindexes `sqlite_autoindex_history_event_*` are expected as well
 *  but are implementation artifacts, not part of this set.) */
export const HISTORY_EVENT_INDEXES = [
  'idx_history_event_ws_occurred_seq',
  'idx_history_event_type_occurred',
  'idx_history_event_recorded',
  'idx_history_event_payload_run_occurred',
  'idx_history_event_payload_task_occurred',
] as const
