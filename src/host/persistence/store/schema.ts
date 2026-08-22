/**
 * WP-2.1 — research.sqlite V1 schema (DDL + version constant).
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
  UNIQUE (owner_workstream_id, event_seq)
);
CREATE INDEX idx_history_event_ws_occurred_seq
  ON history_event (owner_workstream_id, occurred_at, event_seq);
CREATE INDEX idx_history_event_type_occurred
  ON history_event (event_type, occurred_at);
CREATE INDEX idx_history_event_recorded
  ON history_event (recorded_at);
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
