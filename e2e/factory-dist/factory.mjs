import { execFileSync, spawn, spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { YAMLMap, parseAllDocuments, parseDocument, stringify } from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createHash } from "node:crypto";
//#region src/host/persistence/store/schema.ts
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
`;
const DERIVED_STATE_DDL = `
CREATE TABLE derived_state (
  object_kind TEXT NOT NULL,
  object_id   TEXT NOT NULL,
  state       TEXT NOT NULL,  -- JSON document, replaced wholesale (§15 L627)
  PRIMARY KEY (object_kind, object_id)
);
`;
const META_DDL = `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
/** Full V1 DDL, executed once inside a single transaction on a fresh DB
*  (all-or-nothing; a crash mid-init rolls back to an empty file that the
*  next open re-initializes). */
function schemaDdl() {
	return [
		HISTORY_EVENT_DDL,
		DERIVED_STATE_DDL,
		META_DDL
	].join("\n");
}
/** Tables that MUST exist under `user_version = 1`; a missing one means
*  the file is corrupted (a valid version number with a broken schema). */
const EXPECTED_TABLES = [
	"history_event",
	"derived_state",
	"meta"
];
/** The EXACT `history_event` column set of this build's V1 DDL (order as
*  declared). A user_version=1 file whose column set differs — a column
*  missing (older pre-release build) or extra (newer/unknown build) — is
*  STALE: rejected on open with STORE_SCHEMA_STALE, no migration (the
*  numeric version gate's「不匹配即拒绝」policy applied to structure; see
*  the WP-2.9 header block). */
const HISTORY_EVENT_COLUMNS = [
	"event_id",
	"owner_workstream_id",
	"event_seq",
	"event_type",
	"schema_version",
	"occurred_at",
	"recorded_at",
	"actor",
	"source",
	"payload",
	"payload_run_id",
	"payload_task_id"
];
/** The VIRTUAL generated columns — `PRAGMA table_xinfo` reports them with
*  `hidden = 2` (SQLite ≥ 3.36: 0 = regular, 1 = stored generated,
*  2 = virtual generated); every other column must be regular (0). */
const HISTORY_EVENT_GENERATED = /* @__PURE__ */ new Set(["payload_run_id", "payload_task_id"]);
/** The NAMED indexes V1 declares on `history_event`. (The UNIQUE/PK
*  autoindexes `sqlite_autoindex_history_event_*` are expected as well
*  but are implementation artifacts, not part of this set.) */
const HISTORY_EVENT_INDEXES = [
	"idx_history_event_ws_occurred_seq",
	"idx_history_event_type_occurred",
	"idx_history_event_recorded",
	"idx_history_event_payload_run_occurred",
	"idx_history_event_payload_task_occurred"
];
//#endregion
//#region src/host/persistence/store/errors.ts
var StoreError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.name = new.target.name;
		this.code = code;
	}
};
/** The DB file or its directory could not be created/opened (bad path,
*  permission failure, path is a directory). The DB file was left in
*  whatever state it had; no partial schema is ever written. */
var StoreOpenError = class extends StoreError {
	constructor(message, options) {
		super("STORE_OPEN", message, options);
	}
};
/**
* The file exists but is not a usable SQLite database (garbage bytes,
* truncated header, failed `quick_check`, missing schema tables under a
* valid `user_version`, or a JSON column that can no longer be parsed).
* TC-DB-002 semantics: this IS the 「明确报错」 — the store refuses to
* proceed and never tries to repair; `.research/` and Git are untouched by
* the store by construction (it only ever writes its own file).
*/
var StoreCorruptError = class extends StoreError {
	constructor(message, options) {
		super("STORE_CORRUPT", message, options);
	}
};
/**
* `PRAGMA user_version` is neither 0 (fresh) nor the supported V1 version.
* Pre-release policy (DSH_ADAPTER §9): the version is monotonic and a
* mismatch is REJECTED — there is no migration path, and silently opening a
* DB written by a newer/unknown schema would risk misreading columns.
*/
var StoreVersionError = class extends StoreError {
	/** The `user_version` actually found in the file. */
	found;
	/** The version this store supports (1). */
	expected;
	constructor(found, expected) {
		super("STORE_VERSION", `unsupported schema version: found user_version=${String(found)}, expected ${String(expected)} — pre-release store does not migrate (DSH_ADAPTER §9)`);
		this.found = found;
		this.expected = expected;
	}
};
/**
* `PRAGMA user_version` says 1 (the supported V1) but the on-disk
* `history_event` structure does not match this build's V1 DDL — the file
* was written by an OLDER pre-release build (e.g. a pre-WP-2.9 dev DB
* missing the generated filter columns / indexes) or by a NEWER/unknown
* one (extra columns or named indexes). Same policy as the numeric
* version gate (DSH_ADAPTER §9): REJECTED, no migration. The file's data
* is a pre-release dev artifact — the remedy is to delete the file and
* reinitialize (a fresh open re-runs the V1 init transaction).
*/
var StoreSchemaStaleError = class extends StoreError {
	constructor(message, options) {
		super("STORE_SCHEMA_STALE", message, options);
	}
};
/** An operation was attempted on a store after `close()`. */
var StoreClosedError = class extends StoreError {
	constructor(operation) {
		super("STORE_CLOSED", `${operation}: store is closed`);
	}
};
/** Malformed caller input (bad shapes, store-owned fields supplied, …).
*  Thrown BEFORE any write; nothing is side-effected. */
var StoreInputError = class extends StoreError {
	constructor(message, options) {
		super("STORE_INPUT", message, options);
	}
};
/** Uniqueness violation: `event_id` PK or `UNIQUE(owner_workstream_id,
*  event_seq)`. The whole batch rolled back. */
var StoreConflictError = class extends StoreError {
	constructor(message, options) {
		super("STORE_CONFLICT", message, options);
	}
};
/** Unexpected SQLite failure inside an open operation (driver-level
*  problems that are not input/conflict/corruption/version). */
var StoreSqlError = class extends StoreError {
	constructor(message, options) {
		super("STORE_SQL", message, options);
	}
};
/**
* A statement reaching the store's OWN connection used a write class the
* append-only surface forbids — RR-013 (G2 r2 inv-attacker): `REPLACE INTO`
* / `INSERT … OR REPLACE` / `INSERT … ON CONFLICT … REPLACE` against
* `history_event` bypass the BEFORE DELETE trigger (SQLite's internal
* conflict-row delete does not fire triggers), silently rewriting or
* deleting event rows. `openDatabase` installs the store-connection guard
* (store.ts `installStoreConnectionGuard`) which rejects these at
* prepare/exec time on the canonical connection; this is the structured
* error it throws.
*/
var StoreForbiddenSqlError = class extends StoreError {
	constructor(message, options) {
		super("STORE_SQL_FORBIDDEN", message, options);
	}
};
//#endregion
//#region src/host/persistence/store/sqlite-meta.ts
/** The single atomic bump (WP-1.6 reserved seam): INSERT for the unset
*  counter (0 + delta), upsert-accumulate when set, RETURNING the new
*  value — one round-trip, no read-modify-write window. */
const BUMP_SQL = "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + CAST(excluded.value AS INTEGER) RETURNING value";
var SqliteMetaStore = class {
	port;
	backend = "sqlite";
	constructor(port) {
		this.port = port;
	}
	stmt(sql) {
		this.port.assertOpen();
		return this.port.prepare(sql);
	}
	get(key) {
		assertNonEmptyKey(key);
		const row = this.stmt("SELECT value FROM meta WHERE key = ?").get(key);
		return row === void 0 ? null : String(row.value);
	}
	set(key, value) {
		assertNonEmptyKey(key);
		if (typeof value !== "string") throw new StoreInputError(`meta.set: value must be a string (got ${typeof value})`);
		this.stmt("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
	}
	/** No-op when absent. Meta rows are bookkeeping, not first-class
	*  identity (the §15 通则 deletion ban does not apply — same as the
	*  WP-1.6 memory backend). */
	delete(key) {
		assertNonEmptyKey(key);
		this.stmt("DELETE FROM meta WHERE key = ?").run(key);
	}
	keys() {
		return this.stmt("SELECT key FROM meta ORDER BY key").all().map((r) => String(r.key));
	}
	/** Read the integer counter at `key`; 0 when unset. @throws
	*  {@link StoreCorruptError} when the stored value is not a
	*  non-negative safe integer. */
	getCounter(key) {
		assertNonEmptyKey(key);
		const raw = this.get(key);
		if (raw === null) return 0;
		const value = Number(raw);
		if (!Number.isSafeInteger(value) || value < 0) throw new StoreCorruptError(`meta corruption: counter "${key}" holds ${JSON.stringify(raw)}, expected a non-negative integer`);
		return value;
	}
	/** Atomically bump the counter by `delta` (default 1) and return the
	*  NEW value — one SQL statement (see BUMP_SQL); a cross-connection
	*  atomicity upgrade over the in-memory backend. @throws RangeError on
	*  an invalid delta (mirrors the WP-1.6 surface), {@link
	*  StoreCorruptError} on stored-value corruption. */
	bumpCounter(key, delta = 1) {
		assertNonEmptyKey(key);
		if (!Number.isSafeInteger(delta) || delta < 1) throw new RangeError(`invalid counter delta ${String(delta)} — must be a positive safe integer`);
		this.getCounter(key);
		const row = this.stmt(BUMP_SQL).get(key, String(delta));
		const next = Number(row?.value);
		if (!Number.isSafeInteger(next) || next < 0) throw new StoreCorruptError(`meta corruption: counter "${key}" bumped to ${String(row?.value)}, expected a non-negative integer`);
		return next;
	}
};
function assertNonEmptyKey(key) {
	if (typeof key !== "string" || key.length === 0) throw new StoreInputError("meta: key must be a non-empty string");
}
//#endregion
//#region src/host/persistence/store/connection-guard.ts
/** The action-code table of the SQLite authorizer callback (sqlite3.h,
*  the modern numbering shipped by Node 22/24's bundled SQLite ≥3.46). */
const SQLITE_DELETE = 9;
const SQLITE_UPDATE = 23;
/** Authorizer verdicts (sqlite3.h). */
const SQLITE_OK = 0;
const SQLITE_DENY = 1;
/**
* Mask the parts of a SQL statement that carry DATA, keeping the
* STRUCTURAL text: single-quoted string literals (with the `''` escape)
* become `''` placeholders; `--` line and block-style comments become
* whitespace; double-quoted and backtick-quoted identifiers keep their
* content (an identifier named after a keyword is structure, and
* `history_event` has no column whose name could contain `REPLACE` — a
* false positive would require a statement that SQLite itself rejects).
*/
function stripDataLiterals(sql) {
	let out = "";
	let i = 0;
	const n = sql.length;
	while (i < n) {
		const c = sql[i];
		if (c === "'") {
			i += 1;
			while (i < n) {
				if (sql[i] === "'") {
					if (sql[i + 1] === "'") {
						i += 2;
						continue;
					}
					i += 1;
					break;
				}
				i += 1;
			}
			out += "''";
		} else if (c === "\"" || c === "`") {
			const quote = c;
			out += c;
			i += 1;
			while (i < n) {
				if (sql[i] === quote) {
					if (sql[i + 1] === quote) {
						out += quote + quote;
						i += 2;
						continue;
					}
					out += quote;
					i += 1;
					break;
				}
				out += sql[i];
				i += 1;
			}
		} else if (c === "-" && sql[i + 1] === "-") {
			while (i < n && sql[i] !== "\n") i += 1;
			out += " ";
		} else if (c === "/" && sql[i + 1] === "*") {
			i += 2;
			while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
			i += 2;
			out += " ";
		} else {
			out += c;
			i += 1;
		}
	}
	return out;
}
/** `[schema.]history_event` with optional identifier quoting — the
*  schema prefix and the table name may each be unquoted, double-quoted
*  or backtick-quoted (G3 r1 R2: the unquoted-schema-only pattern let
*  `REPLACE INTO "main".history_event` / backtick variants slip through).
*  Whitespace around the `.` is structural in SQLite (token grammar). */
const EVENT_TABLE = `(?:(?:"[^"]+"|\`[^\`]+\`|[A-Z_][A-Z0-9_]*)\\s*\\.\\s*)?(?:"HISTORY_EVENT"|\`HISTORY_EVENT\`|HISTORY_EVENT\\b)`;
/** `REPLACE INTO [schema.]history_event` (shorthand form). */
const RE_REPLACE_INTO = new RegExp(`\\bREPLACE\\s+INTO\\s+${EVENT_TABLE}`);
/** `INSERT [OR REPLACE] INTO [schema.]history_event`; group 1 = the
*  `OR REPLACE` conflict prefix when present. */
const RE_INSERT_INTO_EVENT = new RegExp(`\\bINSERT\\s+(OR\\s+REPLACE\\s+)?INTO\\s+${EVENT_TABLE}`);
/**
* Detect a REPLACE-class write of the event log.
*
* @param sql - the full statement text.
* @returns a precise human-readable reason when the statement carries a
*  REPLACE-class conflict resolution targeting `history_event` (shorthand
*  `REPLACE INTO`, `INSERT … OR REPLACE`, or `ON CONFLICT … REPLACE`),
*  otherwise `null` (statement is not of the forbidden class).
*  Pure and total — never throws.
*/
function classifyForbiddenWrite(sql) {
	if (typeof sql !== "string" || sql.length === 0) return null;
	const norm = stripDataLiterals(sql).toUpperCase().replace(/\s+/g, " ");
	if (RE_REPLACE_INTO.test(norm)) return "REPLACE INTO history_event is a REPLACE-class write — it bypasses the BEFORE DELETE trigger (RR-013) and is forbidden on the store connection";
	const m = RE_INSERT_INTO_EVENT.exec(norm);
	if (m !== null) {
		if (m[1] !== void 0) return "INSERT OR REPLACE INTO history_event is a REPLACE-class write — it bypasses the BEFORE DELETE trigger (RR-013) and is forbidden on the store connection";
		if (/\bREPLACE\b/.test(norm)) return "INSERT … ON CONFLICT … REPLACE on history_event is a REPLACE-class write — it bypasses the BEFORE DELETE trigger (RR-013) and is forbidden on the store connection";
	}
	return null;
}
/**
* Install the store-connection guard on `db` (the connection
* `openDatabase` owns):
*   1. shadows `prepare` / `exec` with the REPLACE-class statement gate;
*   2. when the runtime provides `setAuthorizer` (Node ≥24.10), installs
*      the action-level backstop (DENY UPDATE/DELETE on `history_event`).
*
* Idempotency is NOT claimed: call exactly once, on a freshly opened
* connection, before any other user of the connection (the store is the
* first). The wrapped methods keep the original signatures and forward
* everything they do not reject.
*/
function installStoreConnectionGuard(db) {
	if (db === null || typeof db !== "object") throw new TypeError("installStoreConnectionGuard: db must be a DatabaseSync");
	const anyDb = db;
	const origPrepare = db.prepare.bind(db);
	const origExec = db.exec.bind(db);
	const gate = (sql, entry) => {
		const reason = classifyForbiddenWrite(sql);
		if (reason !== null) throw new StoreForbiddenSqlError(`store connection ${entry}: ${reason}`, { cause: /* @__PURE__ */ new Error(`statement: ${sql}`) });
	};
	anyDb.prepare = (sql) => {
		gate(sql, "prepare");
		return origPrepare(sql);
	};
	anyDb.exec = (sql) => {
		gate(sql, "exec");
		origExec(sql);
	};
	const cap = db.setAuthorizer;
	if (typeof cap === "function") cap.call(db, (actionCode, arg1) => {
		if ((actionCode === SQLITE_DELETE || actionCode === SQLITE_UPDATE) && arg1 === "history_event") return SQLITE_DENY;
		return SQLITE_OK;
	});
}
//#endregion
//#region src/host/persistence/store/store.ts
/**
* WP-2.1 — operational SQLite store: `openDatabase` (DatabaseSync wrapper)
* + the append-only `ResearchStore` handle.
*
* Follows the DSH `node:sqlite` pattern (DSH_ADAPTER §9):
*   - owner-only permissions: DB directory 0o700, file 0o600 (enforced on
*     every open, umask-proof);
*   - `PRAGMA journal_mode=WAL`;
*   - `PRAGMA user_version` is the monotonic schema version: 0 = fresh
*     (init V1 DDL + set to 1, one transaction), 1 = open, anything else =
*     REJECTED (pre-release: no migration, DSH_ADAPTER §9「不匹配即拒绝」);
*     under version 1 the history_event STRUCTURE is verified as well
*     (WP-2.9): a stale pre-release V1 file (older/newer column set or
*     named indexes — e.g. a pre-WP-2.9 dev DB missing the generated
*     filter columns) is rejected with STORE_SCHEMA_STALE, same
*     no-migration policy, remedy = delete the file and reinitialize;
*   - `PRAGMA quick_check` on open: a damaged file fails open with a
*     structured `STORE_CORRUPT` — never a raw driver exception, never a
*     repair attempt (TC-DB-002 「明确报错」);
*   - connection lifecycle: the caller opens (`openDatabase`, in
*     `[Service.init]`) and closes (`close()`, in the effect disposer) —
*     this WP provides the injectable factory; the DSH wiring is a later
*     WP. `close()` is idempotent.
*
* INV-DB-3 boundary: the store writes ONLY its own file (and its
* -wal/-shm siblings). It has no view of `.research/` or Git, so a crash
* anywhere inside a store operation can never corrupt the declarative 真源
* or the Git workspace; and inside the store, every multi-write operation
* is ONE SQLite transaction (or, for init, one init transaction) — WAL
* recovery makes a mid-transaction crash leave the DB either pre- or
* post-transaction, never partial (TC-DB-003 DB half, kill -9 tested).
*
* RR-013 hardening (WP-3.6): every connection this opener creates carries
* the store-connection guard (connection-guard.ts `installStoreConnectionGuard`)
* — REPLACE-class writes of `history_event` (`REPLACE INTO` /
* `INSERT … OR REPLACE` / `ON CONFLICT … REPLACE`) are rejected at
* prepare/exec time on the canonical connection (the BEFORE DELETE trigger
* is bypassed by the internal conflict-row delete of the REPLACE class —
* G2 r2 inv-attacker), plus an action-level authorizer backstop on
* runtimes that provide `setAuthorizer` (Node ≥24.10). The storage
* triggers remain the primary DELETE/UPDATE denial on any connection.
*
* No DSH imports (INV-PERM-5): `node:sqlite` is the Node builtin.
*/
const DEFAULT_BUSY_TIMEOUT_MS$1 = 5e3;
/**
* Open (or initialize) the operational SQLite store at `path`.
*
* Fresh path → parent dir created owner-only (0o700), file created
* owner-only (0o600), WAL enabled, V1 schema + `user_version=1` written in
* one transaction. Existing path → permissions re-enforced, WAL on,
* `user_version` checked (mismatch → {@link StoreVersionError}),
* `quick_check` corruption probe, then opened read-write.
*
* All failures are structured `StoreError`s (never raw driver exceptions).
*/
function openDatabase(path, options = {}) {
	if (typeof path !== "string" || path.length === 0) throw new StoreInputError("openDatabase: path must be a non-empty string");
	const abs = resolve(path);
	ensureOwnerOnlyDir(dirname(abs));
	let isDir = false;
	try {
		isDir = existsSync(abs) && lstatSync(abs).isDirectory();
	} catch (e) {
		throw new StoreOpenError(`openDatabase: cannot stat ${abs}: ${errMsg$4(e)}`, { cause: e });
	}
	if (isDir) throw new StoreOpenError(`openDatabase: ${abs} is a directory, not a SQLite file`);
	let db;
	try {
		db = new DatabaseSync(abs);
	} catch (e) {
		throw classifyOpenFailure(abs, e);
	}
	try {
		try {
			chmodSync(abs, 384);
		} catch (e) {
			closeQuietly(db);
			throw new StoreOpenError(`openDatabase: cannot chmod ${abs} to 0o600: ${errMsg$4(e)}`, { cause: e });
		}
		const journalMode = String(db.prepare("PRAGMA journal_mode = WAL").get()?.journal_mode ?? "");
		if (journalMode.toLowerCase() !== "wal") {
			closeQuietly(db);
			throw new StoreCorruptError(`openDatabase: WAL journal mode could not be enabled at ${abs} (got "${journalMode}")`);
		}
		const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS$1;
		assertPositiveInt$1(busyTimeoutMs, "busyTimeoutMs");
		db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
		checkIntegrity(db, abs);
		const version = readUserVersion(db, abs);
		if (version === 0) initializeSchema(db, abs);
		else if (version !== 1) {
			closeQuietly(db);
			throw new StoreVersionError(version, 1);
		} else verifyExpectedSchema(db, abs);
		installStoreConnectionGuard(db);
	} catch (e) {
		throw toStoreError(e, `openDatabase: ${abs}`);
	}
	const now = options.now ?? Date.now;
	return createStore(db, abs, 1, now);
}
/** Build the handle. Kept out of `openDatabase` so the open path stays
*  readable; the returned object is a plain sealed record — its OWN
*  property names are exactly the public `ResearchStore` surface (tests
*  lock this down: no hidden mutation methods). */
function createStore(db, abs, userVersion, now) {
	let closed = false;
	let metaInstance = null;
	const assertOpen = (operation) => {
		if (closed) throw new StoreClosedError(operation);
		return db;
	};
	const prepare = (operation, sql) => assertOpen(operation).prepare(sql);
	/** MetaDbPort seam for the SqliteMetaStore (its methods stay closed-safe). */
	const metaPort = {
		assertOpen: () => {
			assertOpen("meta");
		},
		prepare: (sql) => prepare("meta", sql)
	};
	const meta = () => {
		if (metaInstance === null) metaInstance = new SqliteMetaStore(metaPort);
		return metaInstance;
	};
	const close = () => {
		if (closed) return;
		closed = true;
		try {
			db.close();
		} catch {}
	};
	/** Internal transaction scope factory (hooks only). */
	const makeTxScope = (operation) => {
		const getStmt = prepare(operation, "SELECT state FROM derived_state WHERE object_kind = ? AND object_id = ?");
		const upsertStmt = prepare(operation, "INSERT INTO derived_state (object_kind, object_id, state) VALUES (?, ?, ?) ON CONFLICT(object_kind, object_id) DO UPDATE SET state = excluded.state");
		return {
			getDerivedState(objectKind, objectId) {
				const kind = assertNonEmptyString$2(objectKind, "objectKind");
				const id = assertNonEmptyString$2(objectId, "objectId");
				const row = getStmt.get(kind, id);
				if (row === void 0) return null;
				return safeParse(String(row.state), `derived_state[${kind}:${id}].state`);
			},
			setDerivedState(objectKind, objectId, state) {
				const kind = assertNonEmptyString$2(objectKind, "objectKind");
				const id = assertNonEmptyString$2(objectId, "objectId");
				upsertStmt.run(kind, id, safeStringify(state, `derived_state[${kind}:${id}].state`));
			}
		};
	};
	return {
		path: abs,
		userVersion,
		close,
		appendEvents: (events, options) => appendEventsImpl(events, options),
		getEvent: (ownerWorkstreamId, seq) => getEventImpl(ownerWorkstreamId, seq),
		listRange: (ownerWorkstreamId, fromSeq, toSeq) => listRangeImpl(ownerWorkstreamId, fromSeq, toSeq),
		meta
	};
	function appendEventsImpl(events, options = {}) {
		const operation = "appendEvents";
		const dbConn = assertOpen(operation);
		if (!Array.isArray(events) || events.length === 0) throw new StoreInputError("appendEvents: events must be a non-empty array");
		const rows = events.map((ev, i) => parseEventInput(ev, i));
		const seenIds = /* @__PURE__ */ new Set();
		for (const row of rows) {
			if (seenIds.has(row.eventId)) throw new StoreInputError(`appendEvents: duplicate eventId within one batch: ${row.eventId} — one event per id (INV-HIST-6)`);
			seenIds.add(row.eventId);
		}
		const validateHook = options.validate;
		if (validateHook !== void 0 && typeof validateHook !== "function") throw new StoreInputError("appendEvents: options.validate must be a function");
		const realize = normalizeRealizeOptions(options.realize);
		const derivedPatches = normalizeDerivedState(options.derivedState);
		const recordedAt = now();
		let inHook = false;
		dbConn.exec("BEGIN IMMEDIATE");
		try {
			const maxStmt = dbConn.prepare("SELECT MAX(event_seq) AS m FROM history_event WHERE owner_workstream_id = ?");
			const baseByWs = /* @__PURE__ */ new Map();
			for (const row of rows) {
				const ws = row.ownerWorkstreamId;
				if (!baseByWs.has(ws)) {
					const m = maxStmt.get(ws)?.m ?? null;
					const base = m === null || m === void 0 ? 0 : Number(m);
					if (!Number.isSafeInteger(base) || base < 0) throw new StoreCorruptError(`appendEvents: history_event holds a non-integer MAX(event_seq)=${String(m)} for ${ws} — database corruption`);
					baseByWs.set(ws, base);
				}
			}
			const nextByWs = new Map([...baseByWs.entries()].map(([ws, base]) => [ws, base + 1]));
			for (const row of rows) {
				row.eventSeq = nextByWs.get(row.ownerWorkstreamId);
				row.recordedAt = recordedAt;
				nextByWs.set(row.ownerWorkstreamId, row.eventSeq + 1);
			}
			const tx = makeTxScope(operation);
			if (validateHook !== void 0) {
				inHook = true;
				validateHook(rows.map(toRecord), tx);
				inHook = false;
			}
			const insertStmt = dbConn.prepare("INSERT INTO history_event (event_id, owner_workstream_id, event_seq, event_type, schema_version, occurred_at, recorded_at, actor, source, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
			for (const row of rows) insertStmt.run(row.eventId, row.ownerWorkstreamId, row.eventSeq, row.eventType, row.schemaVersion, row.occurredAt, row.recordedAt, row.actorJson, row.sourceJson, row.payloadJson);
			for (const patch of derivedPatches) tx.setDerivedState(patch.objectKind, patch.objectId, patch.state);
			if (realize !== null) {
				const wanted = new Set(realize.workstreamIds);
				const fired = /* @__PURE__ */ new Set();
				for (const row of rows) {
					const ws = row.ownerWorkstreamId;
					if (!wanted.has(ws) || fired.has(ws)) continue;
					if ((baseByWs.get(ws) ?? 0) !== 0) continue;
					fired.add(ws);
					inHook = true;
					realize.apply({
						workstreamId: ws,
						event: toRecord(row),
						tx
					});
					inHook = false;
				}
			}
			dbConn.exec("COMMIT");
		} catch (e) {
			rollbackQuietly$1(dbConn);
			if (inHook) throw e;
			throw toStoreError(e, operation);
		}
		const lastSeqByWorkstream = {};
		for (const row of rows) lastSeqByWorkstream[row.ownerWorkstreamId] = row.eventSeq;
		return {
			events: rows.map(toRecord),
			lastSeqByWorkstream
		};
	}
	function getEventImpl(ownerWorkstreamId, seq) {
		const dbConn = assertOpen("getEvent");
		const ws = assertNonEmptyString$2(ownerWorkstreamId, "ownerWorkstreamId");
		assertSeq(seq, "seq");
		const row = dbConn.prepare("SELECT * FROM history_event WHERE owner_workstream_id = ? AND event_seq = ?").get(ws, seq);
		return row === void 0 ? null : dbRowToRecord(row);
	}
	function listRangeImpl(ownerWorkstreamId, fromSeq, toSeq) {
		const dbConn = assertOpen("listRange");
		const ws = assertNonEmptyString$2(ownerWorkstreamId, "ownerWorkstreamId");
		assertSeq(fromSeq, "fromSeq");
		let rows;
		if (toSeq === void 0) rows = dbConn.prepare("SELECT * FROM history_event WHERE owner_workstream_id = ? AND event_seq >= ? ORDER BY event_seq").all(ws, fromSeq);
		else {
			assertSeq(toSeq, "toSeq");
			if (toSeq < fromSeq) throw new StoreInputError(`listRange: toSeq (${toSeq}) must be >= fromSeq (${fromSeq})`);
			rows = dbConn.prepare("SELECT * FROM history_event WHERE owner_workstream_id = ? AND event_seq >= ? AND event_seq <= ? ORDER BY event_seq").all(ws, fromSeq, toSeq);
		}
		return rows.map((r) => dbRowToRecord(r));
	}
}
function parseEventInput(ev, index) {
	const what = `events[${index}]`;
	if (typeof ev !== "object" || ev === null) throw new StoreInputError(`appendEvents: ${what} is not an object`);
	const e = ev;
	if ("eventSeq" in e) throw new StoreInputError(`appendEvents: ${what}.eventSeq is store-assigned (per owner WS, MAX+1 inside the transaction — TC-HIST-003); remove it from the input (HISTORY_EVENT_CATALOG §1)`);
	if ("recordedAt" in e) throw new StoreInputError(`appendEvents: ${what}.recordedAt is generated by the plugin at write time (HISTORY_EVENT_CATALOG §1 L33); remove it from the input`);
	const eventId = assertNonEmptyString$2(e.eventId, `${what}.eventId`);
	const ownerWorkstreamId = assertNonEmptyString$2(e.ownerWorkstreamId, `${what}.ownerWorkstreamId`);
	const eventType = assertNonEmptyString$2(e.eventType, `${what}.eventType`);
	const schemaVersion = e.schemaVersion;
	if (typeof schemaVersion !== "number" || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new StoreInputError(`appendEvents: ${what}.schemaVersion must be a positive safe integer`);
	const occurredAt = e.occurredAt;
	if (typeof occurredAt !== "number" || !Number.isSafeInteger(occurredAt) || occurredAt < 0) throw new StoreInputError(`appendEvents: ${what}.occurredAt must be a non-negative safe integer (epoch ms)`);
	const actor = e.actor;
	if (typeof actor !== "object" || actor === null) throw new StoreInputError(`appendEvents: ${what}.actor must be an ActorRef object`);
	if (typeof actor.kind !== "string" || actor.kind.length === 0) throw new StoreInputError(`appendEvents: ${what}.actor.kind must be a non-empty string`);
	const payload = e.payload;
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new StoreInputError(`appendEvents: ${what}.payload must be a JSON object`);
	const actorJson = safeStringify(actor, `${what}.actor`);
	const source = e.source === void 0 ? null : e.source;
	let sourceJson = null;
	if (source !== null) {
		if (typeof source !== "object" || Array.isArray(source)) throw new StoreInputError(`appendEvents: ${what}.source must be a SourceRef object or null`);
		sourceJson = safeStringify(source, `${what}.source`);
	}
	const payloadJson = safeStringify(payload, `${what}.payload`);
	return {
		eventId,
		ownerWorkstreamId,
		eventType,
		schemaVersion,
		occurredAt,
		recordedAt: 0,
		actor,
		source: source ?? null,
		payload,
		actorJson,
		sourceJson,
		payloadJson,
		eventSeq: 0
	};
}
function normalizeRealizeOptions(realize) {
	if (realize === void 0) return null;
	if (typeof realize !== "object" || realize === null) throw new StoreInputError("appendEvents: options.realize must be an object");
	if (!Array.isArray(realize.workstreamIds)) throw new StoreInputError("appendEvents: options.realize.workstreamIds must be an array");
	for (const ws of realize.workstreamIds) assertNonEmptyString$2(ws, "options.realize.workstreamIds entry");
	if (typeof realize.apply !== "function") throw new StoreInputError("appendEvents: options.realize.apply must be a function");
	return realize;
}
function normalizeDerivedState(patches) {
	if (patches === void 0) return [];
	if (!Array.isArray(patches)) throw new StoreInputError("appendEvents: options.derivedState must be an array");
	for (const [i, p] of patches.entries()) {
		if (typeof p !== "object" || p === null) throw new StoreInputError(`appendEvents: options.derivedState[${i}] is not an object`);
		assertNonEmptyString$2(p.objectKind, `options.derivedState[${i}].objectKind`);
		assertNonEmptyString$2(p.objectId, `options.derivedState[${i}].objectId`);
		if (p.state === void 0) throw new StoreInputError(`appendEvents: options.derivedState[${i}].state must not be undefined`);
	}
	return patches;
}
function toRecord(row) {
	const base = {
		eventId: row.eventId,
		ownerWorkstreamId: row.ownerWorkstreamId,
		eventSeq: row.eventSeq,
		eventType: row.eventType,
		schemaVersion: row.schemaVersion,
		occurredAt: row.occurredAt,
		recordedAt: row.recordedAt,
		actor: row.actor,
		payload: row.payload
	};
	return row.source === null ? base : {
		...base,
		source: row.source
	};
}
function dbRowToRecord(row) {
	const id = String(row.event_id ?? "");
	const base = {
		eventId: id,
		ownerWorkstreamId: String(row.owner_workstream_id ?? ""),
		eventSeq: Number(row.event_seq ?? 0),
		eventType: String(row.event_type ?? ""),
		schemaVersion: Number(row.schema_version ?? 0),
		occurredAt: Number(row.occurred_at ?? 0),
		recordedAt: Number(row.recorded_at ?? 0),
		actor: safeParse(String(row.actor ?? ""), `history_event[${id}].actor`),
		payload: safeParse(String(row.payload ?? ""), `history_event[${id}].payload`)
	};
	if (row.source !== null && row.source !== void 0) return {
		...base,
		source: safeParse(String(row.source), `history_event[${id}].source`)
	};
	return base;
}
/**
* Create `dir` (and any missing ancestors) and enforce owner-only 0o700 on
* every directory THIS call created; a pre-existing parent is left at its
* current mode (it may hold sibling projects — the DB file itself is
* 0o600, which is the owner-only boundary that matters for the DB).
*/
function ensureOwnerOnlyDir(dir) {
	const missing = [];
	let cur = resolve(dir);
	while (!existsSync(cur)) {
		missing.push(cur);
		const parent = dirname(cur);
		if (parent === cur) break;
		cur = parent;
	}
	try {
		mkdirSync(dir, { recursive: true });
	} catch (e) {
		throw new StoreOpenError(`openDatabase: cannot create directory ${dir}: ${errMsg$4(e)}`, { cause: e });
	}
	for (const m of missing) try {
		chmodSync(m, 448);
	} catch (e) {
		throw new StoreOpenError(`openDatabase: cannot set owner-only mode 0o700 on ${m}: ${errMsg$4(e)}`, { cause: e });
	}
}
/** Driver error from `new DatabaseSync(path)` → structured. */
function classifyOpenFailure(abs, e) {
	const msg = errMsg$4(e);
	if (/not a database|malformed|file is not a database/i.test(msg)) return new StoreCorruptError(`openDatabase: ${abs} is not a usable SQLite database (corrupt or non-DB file): ${msg}`, { cause: e });
	return new StoreOpenError(`openDatabase: cannot open ${abs}: ${msg}`, { cause: e });
}
/** `PRAGMA quick_check` — a damaged file fails here (TC-DB-002). */
function checkIntegrity(db, abs) {
	let rows;
	try {
		rows = db.prepare("PRAGMA quick_check").all();
	} catch (e) {
		throw new StoreCorruptError(`openDatabase: ${abs} is corrupted or unreadable: ${errMsg$4(e)}`, { cause: e });
	}
	const problems = rows.map((r) => String(r.quick_check ?? "")).filter((s) => s.toLowerCase() !== "ok");
	if (problems.length > 0) throw new StoreCorruptError(`openDatabase: ${abs} failed quick_check: ${problems.join("; ")}`);
}
function readUserVersion(db, abs) {
	let row;
	try {
		row = db.prepare("PRAGMA user_version").get();
	} catch (e) {
		throw new StoreCorruptError(`openDatabase: ${abs} is corrupted (cannot read user_version): ${errMsg$4(e)}`, { cause: e });
	}
	const v = Number(row?.user_version ?? 0);
	if (!Number.isSafeInteger(v) || v < 0) throw new StoreCorruptError(`openDatabase: ${abs} has a non-integer user_version`);
	return v;
}
/** Fresh DB (user_version 0): V1 DDL + version bump, ONE transaction.
*  user_version 0 with schema tables already present is an INCONSISTENT
*  file (a torn init that somehow escaped the init transaction) →
*  corruption, not a re-init. */
function initializeSchema(db, abs) {
	const tables = readExistingTables(db, abs);
	for (const t of tables) if (EXPECTED_TABLES.includes(t)) throw new StoreCorruptError(`openDatabase: ${abs} has user_version=0 but table "${t}" already exists — inconsistent database (corruption)`);
	db.exec("BEGIN");
	try {
		db.exec(schemaDdl());
		db.exec(`PRAGMA user_version = 1`);
		db.exec("COMMIT");
	} catch (e) {
		rollbackQuietly$1(db);
		throw toStoreError(e, `openDatabase (schema init at ${abs})`);
	}
}
function readExistingTables(db, abs) {
	let rows;
	try {
		rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
	} catch (e) {
		throw new StoreCorruptError(`openDatabase: ${abs} is corrupted (cannot read sqlite_master): ${errMsg$4(e)}`, { cause: e });
	}
	return rows.map((r) => String(r.name ?? ""));
}
/** user_version=1 but a §15 table missing → the file is broken. */
function verifyExpectedSchema(db, abs) {
	verifyExpectedTables(db, abs);
	verifyHistoryEventStructure(db, abs);
}
function verifyExpectedTables(db, abs) {
	const tables = new Set(readExistingTables(db, abs));
	for (const t of EXPECTED_TABLES) if (!tables.has(t)) throw new StoreCorruptError(`openDatabase: ${abs} has user_version=1 but is missing table "${t}" — database corruption`);
}
/**
* user_version=1 + tables present, but the `history_event` structure does
* not match this build's V1 DDL → STALE pre-release schema (an older dev
* build: missing the WP-2.9 generated columns / filter indexes; or a
* newer/unknown build: extra columns or named indexes). Rejected with a
* structured STORE_SCHEMA_STALE — no migration path (DSH_ADAPTER §9);
* the remedy is to delete the file and reinitialize. Column facts come
* from `PRAGMA table_xinfo` (unlike `table_info`, it also reports the
* generated columns, flagged `hidden = 2` for virtual generated —
* SQLite ≥ 3.36, available on every node:sqlite build the store supports).
*/
function verifyHistoryEventStructure(db, abs) {
	let colRows;
	let idxRows;
	try {
		colRows = db.prepare("PRAGMA table_xinfo(history_event)").all();
		idxRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'history_event'").all();
	} catch (e) {
		throw new StoreCorruptError(`openDatabase: ${abs} is corrupted (cannot read the history_event structure): ${errMsg$4(e)}`);
	}
	const hiddenByColumn = /* @__PURE__ */ new Map();
	for (const r of colRows) hiddenByColumn.set(String(r.name ?? ""), Number(r.hidden ?? 0));
	const expectedColumns = new Set(HISTORY_EVENT_COLUMNS);
	const colMissing = [];
	const colUnexpected = [];
	const colWrongKind = [];
	for (const c of HISTORY_EVENT_COLUMNS) if (!hiddenByColumn.has(c)) colMissing.push(c);
	for (const [c, hidden] of hiddenByColumn) if (!expectedColumns.has(c)) colUnexpected.push(c);
	else if (hidden !== (HISTORY_EVENT_GENERATED.has(c) ? 2 : 0)) colWrongKind.push(c);
	const namedIndexes = new Set(idxRows.map((r) => String(r.name ?? "")).filter((n) => !n.startsWith("sqlite_autoindex_")));
	const idxMissing = [];
	const idxUnexpected = [];
	for (const i of HISTORY_EVENT_INDEXES) if (!namedIndexes.has(i)) idxMissing.push(i);
	const expectedIndexes = new Set(HISTORY_EVENT_INDEXES);
	for (const n of namedIndexes) if (!expectedIndexes.has(n)) idxUnexpected.push(n);
	if (colMissing.length > 0 || colUnexpected.length > 0 || colWrongKind.length > 0 || idxMissing.length > 0 || idxUnexpected.length > 0) {
		const parts = [];
		if (colMissing.length > 0) parts.push(`missing columns: ${colMissing.join(", ")}`);
		if (colUnexpected.length > 0) parts.push(`unexpected columns: ${colUnexpected.join(", ")}`);
		if (colWrongKind.length > 0) parts.push(`columns with wrong kind (generated vs regular): ${colWrongKind.join(", ")}`);
		if (idxMissing.length > 0) parts.push(`missing indexes: ${idxMissing.join(", ")}`);
		if (idxUnexpected.length > 0) parts.push(`unexpected indexes: ${idxUnexpected.join(", ")}`);
		throw new StoreSchemaStaleError(`openDatabase: ${abs} has user_version=1 but its history_event structure differs from this build's V1 DDL (${parts.join("; ")}) — stale pre-release schema; the pre-release store does not migrate (DSH_ADAPTER §9): delete the file and reinitialize`);
	}
}
function errMsg$4(e) {
	return e instanceof Error ? e.message : String(e);
}
function assertNonEmptyString$2(value, what) {
	if (typeof value !== "string" || value.length === 0) throw new StoreInputError(`${what} must be a non-empty string`);
	return value;
}
function assertSeq(value, what) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new StoreInputError(`${what} must be a positive safe integer (event_seq >= 1)`);
}
function assertPositiveInt$1(value, what) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new StoreInputError(`${what} must be a positive safe integer`);
}
function safeStringify(value, what) {
	assertJsonValue(value, what, 0);
	try {
		const out = JSON.stringify(value);
		if (typeof out !== "string") throw new Error(`JSON.stringify returned ${typeof out}`);
		return out;
	} catch (e) {
		throw new StoreInputError(`${what} is not JSON-serializable: ${errMsg$4(e)}`, { cause: e });
	}
}
/**
* Strict-JSON gate: `JSON.stringify` silently DROPS function/symbol/
* undefined property values and silently coerces NaN/Infinity to null —
* for persisted envelope data that is silent corruption, not
* serialization. Only strict JSON values pass: null, string, boolean,
* finite number, arrays, and PLAIN objects (no Date/RegExp/Map/custom
* class, no symbol keys, no undefined values). Depth-capped (64).
*/
function assertJsonValue(value, what, depth) {
	if (depth > 64) throw new StoreInputError(`${what}: nesting deeper than 64 levels — refusing to persist`);
	if (value === null) return;
	const t = typeof value;
	if (t === "string" || t === "boolean") return;
	if (t === "number") {
		if (!Number.isFinite(value)) throw new StoreInputError(`${what}: non-finite number (NaN/±Infinity are not JSON)`);
		return;
	}
	if (t === "function" || t === "symbol" || t === "bigint" || t === "undefined") throw new StoreInputError(`${what}: not a strict JSON value (got ${t})`);
	if (Array.isArray(value)) {
		for (const item of value) assertJsonValue(item, what, depth + 1);
		return;
	}
	const obj = value;
	const proto = Object.getPrototypeOf(obj);
	if (proto !== Object.prototype && proto !== null) throw new StoreInputError(`${what}: contains a non-plain object (${obj.constructor?.name ?? "unknown"}) — strict JSON only (no Date/RegExp/Map/...)`);
	if (Object.getOwnPropertySymbols(obj).length > 0) throw new StoreInputError(`${what}: contains symbol-keyed properties — not JSON`);
	for (const v of Object.values(obj)) assertJsonValue(v, what, depth + 1);
}
function safeParse(raw, what) {
	try {
		return JSON.parse(raw);
	} catch (e) {
		throw new StoreCorruptError(`${what} is not valid JSON — database corruption`, { cause: e });
	}
}
function rollbackQuietly$1(db) {
	try {
		db.exec("ROLLBACK");
	} catch {}
}
function closeQuietly(db) {
	try {
		db.close();
	} catch {}
}
/**
* Store-owned failure → structured StoreError. Caller-owned hook errors
* (thrown by the caller's validate/realize callbacks) propagate UNCHANGED —
* they are the caller's error type; the transaction is already rolled back.
*/
function toStoreError(e, context) {
	if (e instanceof StoreError) return e;
	const msg = errMsg$4(e);
	if (/UNIQUE constraint failed/i.test(msg)) return new StoreConflictError(`${context}: uniqueness violation: ${msg}`, { cause: e });
	if (/not a database|database disk image is malformed/i.test(msg)) return new StoreCorruptError(`${context}: corrupt or unreadable SQLite file: ${msg}`, { cause: e });
	return new StoreSqlError(`${context}: ${msg}`, { cause: e });
}
//#endregion
//#region src/host/persistence/hardening/db-check.ts
/**
* WP-8.1 — hardening: check 1, the operational DB integrity probe.
*
* The probe RIDES on the store's own `openDatabase` (WP-2.1): that open
* path IS the integrity check — owner-only permissions, WAL, the
* `PRAGMA quick_check` corruption probe, the monotonic `user_version`
* gate, the V1 structure verification (WP-2.9). This module adds the
* FAILURE CLASSIFICATION the §10 失效表 requires on top of the
* structured `StoreError`s (「明确报错 + 指向数据库文件 + 用户指引，绝不
* 静默」):
*
*   STORE_CORRUPT        → unrecoverable — TC-DB-002: the operational
*                          data (History/Run/Intervention/…) is NOT
*                          recoverable (known risk, V1: no event
*                          export/backup); the declarative 真源
*                          (`.research/` + Git) is a separate file the
*                          store never touches (INV-DB-3) — the
*                          ORCHESTRATOR asserts that intactness from the
*                          tree/git check results and adds it to the
*                          guidance;
*   STORE_VERSION        → unrecoverable — pre-release does not migrate
*                          (DSH_ADAPTER §9「不匹配即拒绝」);
*   STORE_SCHEMA_STALE   → unrecoverable — same no-migration policy for
*                          a stale pre-release V1 structure;
*   STORE_OPEN           → unrecoverable — the file/dir cannot be created
*                          or opened (environment: path/permissions);
*   anything else        → unrecoverable with code `UNEXPECTED` (fail
*                          loud — a non-`StoreError` here is a store bug,
*                          never swallowed).
*
* A FRESH path (no file yet) opens as pass: first startup initializes
* the V1 schema — exactly what the wiring's first open would do, so the
* check neither over- nor under-creates state.
*
* The open handle is returned to the caller (the orchestrator's
* consistency spot check probes through it and closes it, ALWAYS — even
* on later check failures).
*/
function errMsg$3(e) {
	return e instanceof Error ? e.message : String(e);
}
/**
* Run the DB integrity probe at `dbPath`.
*
* Never throws: every failure (including a non-`StoreError` escape) is
* classified into the returned result — the startup pass must see ALL
* four checks' results, so one broken 真源 must not mask the others
* (aggregation, not short-circuit — TC-DB-002「明确报错」applies to the
* report as a whole).
*/
function checkDatabase(dbPath) {
	try {
		const handle = openDatabase(dbPath);
		return {
			result: {
				status: "pass",
				userVersion: handle.userVersion,
				message: `database opened (user_version=${String(handle.userVersion)}; quick_check + structure verified)`,
				guidance: []
			},
			handle
		};
	} catch (e) {
		if (e instanceof StoreError) return {
			result: classifyStoreError(dbPath, e.code, errMsg$3(e)),
			handle: null
		};
		return {
			result: {
				status: "unrecoverable",
				code: "UNEXPECTED",
				message: `database check failed with an unexpected error (store bug — fail loud): ${errMsg$3(e)}`,
				guidance: [`the operational database at ${dbPath} could not be opened and the failure is outside the store's own error taxonomy — this is a plugin defect, report it with the message above`]
			},
			handle: null
		};
	}
}
function classifyStoreError(dbPath, code, message) {
	switch (code) {
		case "STORE_CORRUPT": return {
			status: "unrecoverable",
			code,
			message,
			guidance: [
				`${dbPath} is corrupted (SQLite quick_check / structure failure) — the operational data it holds (History / Run / Claim / Fact / Intervention / Inbox / Audit / PlanFork runtime records) is NOT recoverable: V1 has no event export or backup (ARCHITECTURE §10, known risk; derived-column rebuild only applies while the event table is intact, TC-HIST-006) — it must be re-accumulated`,
				`the declarative 真源 (.research/ + Git) is a separate file this database never touches (INV-DB-3) — it is NOT affected by this corruption (the report's tree/git checks assert its state explicitly)`,
				`remedy (user action, never automatic): keep ${dbPath} for forensics if needed, then delete it together with its -wal/-shm siblings and restart — the next start re-initializes a fresh V1 database`
			]
		};
		case "STORE_VERSION": return {
			status: "unrecoverable",
			code,
			message,
			guidance: [`${dbPath} carries a schema version this build does not support (${message}) — the pre-release store does not migrate (DSH_ADAPTER §9「user_version 单调、不匹配即拒绝」)`, `remedy (user action, never automatic): the file's data is a pre-release dev artifact — delete ${dbPath} with its -wal/-shm siblings and restart to re-initialize (operational data in it is lost)`]
		};
		case "STORE_SCHEMA_STALE": return {
			status: "unrecoverable",
			code,
			message,
			guidance: [`${dbPath} was written by a different pre-release build (same user_version, different V1 structure) — rejected: no migration path (DSH_ADAPTER §9)`, `remedy (user action, never automatic): delete ${dbPath} with its -wal/-shm siblings and restart to re-initialize (operational data in it is lost)`]
		};
		case "STORE_OPEN": return {
			status: "unrecoverable",
			code,
			message,
			guidance: [`the operational database cannot be created or opened at ${dbPath} (${message}) — check that the path is usable and writable by the plugin's user`, "the plugin cannot serve a research project without its operational store — this is not retryable until the environment is fixed"]
		};
		default: return {
			status: "unrecoverable",
			code,
			message,
			guidance: [`the operational database at ${dbPath} failed its integrity check with code ${code}: ${message}`, `the plugin does not proceed over a failed database check and does not attempt automatic repair (remedy: investigate ${dbPath}; deleting it re-initializes at the cost of the operational data)`]
		};
	}
}
//#endregion
//#region src/host/persistence/hardening/consistency.ts
/**
* Run the dual-真源 consistency spot check. READ-ONLY: the store handle
* is used for `getEvent` probes only; the caller keeps ownership.
*/
function checkDualTruthConsistency(input) {
	const maxSample = input.maxSample ?? 16;
	if (!Number.isSafeInteger(maxSample) || maxSample < 1) throw new TypeError("checkDualTruthConsistency: maxSample must be a positive safe integer");
	const findings = [];
	let projectIdChecked = false;
	const projectDoc = input.tree.project;
	if (projectDoc !== null) {
		projectIdChecked = true;
		if (projectDoc.id !== input.projectId) findings.push({
			kind: "project-id-mismatch",
			message: `the declarative 真源 declares project ${JSON.stringify(projectDoc.id)} (.research/project.yaml) but the operational store lives under the registered scope ${JSON.stringify(input.projectId)} (DSH_ADAPTER §9 data dir) — the two 真源 disagree about WHICH project this is`
		});
	}
	const candidates = [];
	for (const topic of input.tree.topics) for (const ws of topic.workstreams) {
		const doc = ws.doc;
		if (doc === null) continue;
		candidates.push({
			workstreamId: ws.id,
			lifecycle: doc.lifecycle
		});
	}
	candidates.sort((a, b) => a.workstreamId < b.workstreamId ? -1 : a.workstreamId > b.workstreamId ? 1 : 0);
	const sample = candidates.slice(0, maxSample);
	const checked = [];
	let divergent = false;
	for (const ws of sample) {
		checked.push(ws.workstreamId);
		if (ws.lifecycle === "DROPPED") continue;
		let hasEvents;
		try {
			hasEvents = input.store.getEvent(ws.workstreamId, 1) !== null;
		} catch (e) {
			if (e instanceof StoreError) return {
				status: "unrecoverable",
				checked,
				findings,
				projectIdChecked,
				message: `consistency probe of ${ws.workstreamId} failed with a store error (${e.code}): ${e.message}`,
				guidance: [`the operational database FAILED A ROW READ during the consistency probe (${e.code}: ${e.message}) — it passed the open-time quick_check but is corrupt for our purposes; treat it as the TC-DB-002 corruption case (structured error, no repair attempt, operational data not recoverable)`]
			};
			throw e;
		}
		if (ws.lifecycle === "REALIZED" && !hasEvents) {
			findings.push({
				kind: "file-leads",
				workstreamId: ws.workstreamId,
				message: `${ws.workstreamId}: the file says lifecycle=REALIZED but History has NO events (RR-010 crash-window residue) — recoverable: the startup lifecycle reconciliation rolls the file back to PLANNED (loud; History is the truth 「did it happen」)`
			});
			divergent = true;
		} else if (ws.lifecycle === "PLANNED" && hasEvents) {
			findings.push({
				kind: "file-trails",
				workstreamId: ws.workstreamId,
				message: `${ws.workstreamId}: History HAS events but the file says lifecycle=PLANNED (the flip half was lost) — recoverable: the startup lifecycle reconciliation converges the file forward to REALIZED (loud)`
			});
			divergent = true;
		}
	}
	const mismatch = findings.some((f) => f.kind === "project-id-mismatch");
	const status = mismatch ? "unrecoverable" : divergent ? "recoverable" : "pass";
	const guidance = [];
	if (mismatch) {
		for (const f of findings) if (f.kind === "project-id-mismatch") guidance.push(f.message);
		guidance.push(`remedy (user action, never automatic — the plugin must not guess which side to rewrite): restore the correct side (e.g. .research/project.yaml via \`git restore --source=<commit> -- .research/project.yaml\`, or the matching data dir under $DSH_HOME/research-control/<project-id>/), then restart`);
	} else if (divergent) {
		for (const f of findings) guidance.push(f.message);
		guidance.push("no automatic convergence happens at this check (it is read-only): the wiring's startup reconciliation (lifecycle convergence → run-vs-history → semantics rebuild) applies the fixes LOUD after this report");
	}
	return {
		status,
		checked,
		findings,
		projectIdChecked,
		message: findings.length === 0 ? `consistent: ${String(checked.length)} workstream(s) spot-checked (file lifecycle vs History)` + (projectIdChecked ? "; project scope matches" : "; project doc absent — scope check not applicable") : `${String(findings.length)} consistency finding(s): ${findings.map((f) => f.kind).join(", ")}`,
		guidance
	};
}
//#endregion
//#region src/host/git/errors.ts
var GitError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.name = new.target.name;
		this.code = code;
	}
};
/** Git executable missing / spawn ENOENT (§2, §9「Git 可执行缺失」). */
var GitMissingError = class extends GitError {
	constructor(message, options) {
		super("GIT_MISSING", message, options);
	}
};
/** 命令超时 (默认 10s) — kill 后按错误处理, 不重试自动写操作 (§1.9, §9). */
var GitTimeoutError = class extends GitError {
	command;
	timeoutMs;
	constructor(command, timeoutMs) {
		super("GIT_TIMEOUT", `Git 操作超时 (${timeoutMs}ms): git ${command.join(" ")}`);
		this.command = command;
		this.timeoutMs = timeoutMs;
	}
};
/** Non-zero exit outside a specific known class — git 自身报错, 原样展示 (§9「repo 损坏」). */
var GitCommandError = class extends GitError {
	command;
	exitCode;
	stdout;
	stderr;
	constructor(command, exitCode, stdout, stderr) {
		super("GIT_COMMAND", `git ${command.join(" ")} exited ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
		this.command = command;
		this.exitCode = exitCode;
		this.stdout = stdout;
		this.stderr = stderr;
	}
};
/** 白名单外命令 (INV-GIT-7 运行时面) — 不可达. */
var GitWhitelistViolationError = class extends GitError {
	attempted;
	constructor(attempted) {
		super("GIT_WHITELIST", `git command not in W1–W13 whitelist (INV-GIT-7): git ${attempted.join(" ")}`);
		this.attempted = attempted;
	}
};
/** Invalid caller input (bad OID shape, pathspec not under .research/…). */
var GitInputError = class extends GitError {
	constructor(message) {
		super("GIT_INPUT", message);
	}
};
//#endregion
//#region src/host/git/whitelist.ts
/**
* WP-1.2 — the frozen W1–W13 operation whitelist (GIT_INTEGRATION §3),
* encoded as the single source of truth for argv validation.
*
* 「白名单外命令不可达」 is enforced at two layers:
*  1. 类型面: index.ts exports only the named operations below — there is no
*     generic run/exec/spawn export (statically asserted by
*     tests/git/inv-git-static.test.ts);
*  2. 运行时: runner.ts calls the scope-bound `assertWhitelisted` before
*     every spawn and throws GitWhitelistViolationError for any argv that
*     does not match one of these exact shapes (INV-GIT-7).
*
* argv shapes are relative to the repo root; the transport layer prepends
* `-C <root>` (工作目录强制 -C root, never `cwd:`).
*
* V2 (design §3.1 Q4: the tree directory name is CONFIGURABLE through the
* DSH settings plane, 「发现逻辑只认配置后的名字」) — the W9/W10 commit
* pathspecs (and the W8 restore scope) are NO LONGER a hardcoded `.research`
* literal: the WHITELIST CONSTRUCTOR is parameterized over the tree
* directory name ({@link buildResearchTreeScope} / {@link
* buildWhitelistRows}), and every git call carries the configured name
* through {@link GitOptions.treeDir} (absent = the frozen default
* `.research`). At the default the argv is BYTE-IDENTICAL to the V1
* frozen shapes (tests/git pin that: zero changes pass), and the
* checkpoint flow under a renamed tree commits exactly the renamed
* directory (tests/git/t32-git-scope.test.ts).
*/
/** The frozen DEFAULT tree directory name (the V1 literal, the settings
*  domain's own default — T2.1 `DEFAULT_PROJECT_TREE_DIR`). */
const DEFAULT_TREE_DIR = ".research";
/** W6 log 格式串 — 冻结建议 (§3 说明): OID、作者时间、标题, 单元分隔符 \x1f.
*  声明必须先于模块级 {@link DEFAULT_RESEARCH_TREE_SCOPE} 求值(W6 行在
*  导入期构造时引用它)。 */
const LOG_FORMAT_ARG = "--format=%H%x1f%aI%x1f%s";
/**
* V2 (design §3.3): the STANDALONE state sub-directory — the runtime
* database area (`<treeDir>/state/research.sqlite`). 状态区，不入声明树
* 语义: it is OUTSIDE the checkpoint commit scope (the W9/W10 pathspec
* excludes it explicitly, see {@link ResearchTreeScope.stateExcludeSpec}).
*/
const RESEARCH_STATE_EXCLUDE_SUFFIX = ":(exclude)";
/**
* Build the W1–W13 whitelist rows for ONE tree directory name — the
* parameterized constructor (V2 T3.2b: the W9/W10 pathspecs + the W8
* restore scope are generated from `treeDir`; the other 10 rows are
* name-independent and byte-identical across scopes).
*
* @throws {GitInputError} when `treeDir` is not a bare directory name.
*/
function buildWhitelistRows(treeDir) {
	assertTreeDir(treeDir);
	const pathspec = `${treeDir}/`;
	const statePathspec = `${treeDir}/state/`;
	const stateExcludeSpec = `${RESEARCH_STATE_EXCLUDE_SUFFIX}${statePathspec}`;
	const isUnderResearch = (p) => p === pathspec || p.startsWith(pathspec);
	return [
		{
			id: "W1",
			operation: "仓库检测",
			trigger: "auto",
			argv: ["rev-parse", "--show-toplevel"],
			match: (a) => a.length === 2 && is(a, 0, "rev-parse") && is(a, 1, "--show-toplevel")
		},
		{
			id: "W2",
			operation: "git dir 定位",
			trigger: "auto",
			argv: ["rev-parse", "--git-dir"],
			match: (a) => a.length === 2 && is(a, 0, "rev-parse") && is(a, 1, "--git-dir")
		},
		{
			id: "W3",
			operation: "blob OID 计算",
			trigger: "auto",
			argv: [
				"hash-object",
				"--",
				"<path>"
			],
			match: (a) => a.length === 3 && is(a, 0, "hash-object") && is(a, 1, "--") && isPathArg(a[2])
		},
		{
			id: "W4",
			operation: "工作区状态",
			trigger: "auto",
			argv: [
				"status",
				"--porcelain=v2",
				"[--branch]"
			],
			match: (a) => is(a, 0, "status") && is(a, 1, "--porcelain=v2") && (a.length === 2 || a.length === 3 && is(a, 2, "--branch"))
		},
		{
			id: "W5",
			operation: "变更清单",
			trigger: "auto",
			argv: [
				"diff",
				"--name-status",
				"[<baseline-oid>]"
			],
			match: (a) => is(a, 0, "diff") && is(a, 1, "--name-status") && (a.length === 2 || a.length === 3 && OID_RE$1.test(a[2]))
		},
		{
			id: "W6",
			operation: "文件历史",
			trigger: "user",
			argv: [
				"log",
				LOG_FORMAT_ARG,
				"[-n <count>]",
				"[--skip <n>]",
				"--",
				"<path>"
			],
			match: (a) => {
				if (!is(a, 0, "log") || !is(a, 1, "--format=%H%x1f%aI%x1f%s")) return false;
				let i = 2;
				if (is(a, i, "-n")) {
					if (!DIGITS_RE.test(a[i + 1] ?? "")) return false;
					i += 2;
				}
				if (is(a, i, "--skip")) {
					if (!DIGITS_RE.test(a[i + 1] ?? "")) return false;
					i += 2;
				}
				return is(a, i, "--") && i + 2 === a.length && isPathArg(a[i + 1]);
			}
		},
		{
			id: "W7",
			operation: "历史版本内容",
			trigger: "user",
			argv: ["show", "<commit-oid>:<path>"],
			match: (a) => {
				if (a.length !== 2 || !is(a, 0, "show")) return false;
				const ref = a[1];
				const i = ref.indexOf(":");
				return i > 0 && OID_RE$1.test(ref.slice(0, i)) && isPathArg(ref.slice(i + 1));
			}
		},
		{
			id: "W8",
			operation: "恢复文件",
			trigger: "user",
			argv: [
				"restore",
				"--source=<commit-oid>",
				"--",
				`${treeDir}/<path>`
			],
			match: (a) => a.length === 4 && is(a, 0, "restore") && typeof a[1] === "string" && a[1].startsWith("--source=") && OID_RE$1.test(a[1].slice(9)) && is(a, 2, "--") && isPathArg(a[3]) && isUnderResearch(a[3])
		},
		{
			id: "W9",
			operation: "暂存",
			trigger: "user",
			argv: [
				"add",
				"--",
				pathspec,
				stateExcludeSpec
			],
			match: (a) => a.length === 4 && is(a, 0, "add") && is(a, 1, "--") && is(a, 2, pathspec) && is(a, 3, stateExcludeSpec)
		},
		{
			id: "W10",
			operation: "检查点提交",
			trigger: "user",
			argv: [
				"commit",
				"-m",
				"<research: summary>",
				"--",
				pathspec,
				stateExcludeSpec
			],
			match: (a) => a.length === 6 && is(a, 0, "commit") && is(a, 1, "-m") && typeof a[2] === "string" && a[2].length > 0 && !a[2].includes("\0") && is(a, 3, "--") && is(a, 4, pathspec) && is(a, 5, stateExcludeSpec)
		},
		{
			id: "W11",
			operation: "取提交 OID",
			trigger: "user",
			argv: ["rev-parse", "HEAD"],
			match: (a) => a.length === 2 && is(a, 0, "rev-parse") && is(a, 1, "HEAD")
		},
		{
			id: "W12",
			operation: "显式初始化",
			trigger: "user",
			argv: ["init"],
			match: (a) => a.length === 1 && is(a, 0, "init")
		},
		{
			id: "W13",
			operation: "枚举 tracked 文件",
			trigger: "auto",
			argv: [
				"ls-files",
				"--",
				"<pathspec>"
			],
			match: (a) => a.length === 3 && is(a, 0, "ls-files") && is(a, 1, "--") && isPathArg(a[2])
		}
	];
}
/**
* Build the full research-tree scope for one tree directory name (module
* doc): the derived pathspecs + the rows + the bound predicates/validator.
*
* @throws {GitInputError} when `treeDir` is not a bare directory name
*  (a settings value that survived T2.1's validation must never reach
*  this boundary malformed — fail loud anyway).
*/
function buildResearchTreeScope(treeDir) {
	const rows = buildWhitelistRows(treeDir);
	const pathspec = `${treeDir}/`;
	const statePathspec = `${treeDir}/state/`;
	return {
		treeDir,
		pathspec,
		statePathspec,
		stateExcludeSpec: `${RESEARCH_STATE_EXCLUDE_SUFFIX}${statePathspec}`,
		rows,
		assertWhitelisted: (argv) => {
			for (const row of rows) if (row.match(argv)) return row;
			throw new GitWhitelistViolationError([...argv]);
		},
		isWithinCommitScope: (p) => {
			if (typeof p !== "string") return false;
			if (!p.startsWith(pathspec)) return false;
			if (p.startsWith(statePathspec)) return false;
			return true;
		},
		isUnderResearch: (p) => p === pathspec || p.startsWith(pathspec)
	};
}
/** The V1 default research-tree scope (`.research`), byte-identical argv. */
const DEFAULT_RESEARCH_TREE_SCOPE = buildResearchTreeScope(DEFAULT_TREE_DIR);
/**
* Resolve the scope of one git call from its options: an explicit
* `opts.treeDir` (the production plane's configured name — T3.2b) builds
* that scope; absent → the frozen default.
*/
function scopeFor(opts) {
	const treeDir = opts?.treeDir;
	if (treeDir === void 0 || treeDir === null) return DEFAULT_RESEARCH_TREE_SCOPE;
	return buildResearchTreeScope(treeDir);
}
/**
* W9/W10 pathspec and W8 restore scope (INV-GIT-3 / §6) — the DEFAULT
* scope's pathspec (the frozen V1 constant; the parameterized face is
* {@link buildResearchTreeScope}).
*/
const RESEARCH_PATHSPEC = DEFAULT_RESEARCH_TREE_SCOPE.pathspec;
DEFAULT_RESEARCH_TREE_SCOPE.statePathspec;
DEFAULT_RESEARCH_TREE_SCOPE.stateExcludeSpec;
DEFAULT_RESEARCH_TREE_SCOPE.rows;
/**
* Full 40-hex commit OID. Short OIDs and refs (HEAD, main, HEAD~1) are
* deliberately rejected: the whitelist is exact, and every commit value the
* plugin passes (W7/W8) comes from W11 (`rev-parse HEAD`, full OID).
*/
const OID_RE$1 = /^[0-9a-f]{40}$/;
const DIGITS_RE = /^[0-9]+$/;
/**
* Repo-root-relative path argument (W3/W6/W8/W13): non-empty, not absolute,
* not a `..` escape, no NUL, not option-like. The `--` separator in each
* argv shape is the second line of defense against option smuggling.
*/
function isPathArg(p) {
	return p.length > 0 && p !== ".." && !p.startsWith("../") && !p.startsWith("/") && !p.startsWith("-") && !p.includes("\0");
}
const is = (a, i, v) => a[i] === v;
/**
* Validate a tree directory name (the settings `treeDir` rule, the git
* layer's own boundary — T2.1's `validateDirName` already guards the
* settings write; this re-checks at the argv-generation boundary so a
* malformed value can never shape a pathspec, fail loud).
*/
function assertTreeDir(treeDir) {
	if (typeof treeDir !== "string" || treeDir.length === 0 || treeDir === "." || treeDir === ".." || treeDir.includes("/")) throw new GitInputError(`the research tree directory name must be a bare segment (got ${JSON.stringify(treeDir ?? null)}) — a malformed name must never shape the W8/W9/W10 pathspecs (GIT_INTEGRATION §3)`);
}
//#endregion
//#region src/host/git/runner.ts
/**
* WP-1.2 — Git wrapper: argv-array transport layer (INV-GIT-6).
*
* This is the ONLY place in the plugin that spawns `git` (ARCHITECTURE §2.2
* rule 3). Guarantees:
*  - argv 数组直传 spawn, `shell: false` — 禁 shell 拼接 (INV-GIT-6; 静态核验
*    tests/git/inv-git-static.test.ts);
*  - 工作目录强制 `-C <root>` (not `cwd:`);
*  - 每调用超时 (默认 10s, 可配) → process-group kill + GitTimeoutError,
*    不重试自动写操作 (§1.9 / §9);
*  - stdout/stderr 字节上限 → 截断+标记 (§1.9 / §9「输出超大」);
*  - git 可执行解析失败响亮报错 (GitMissingError, §2: 拒绝 managed mode,
*    提示安装 Git).
*
* NOTE: `spawnGitProcess` / `runGit` are internal — index.ts deliberately
* does NOT export them. Only the named whitelist operations (operations.ts)
* reach the transport from production code. Test infrastructure
* (tests/git/temp-repo.ts) deep-imports `spawnGitProcess` for fixture setup
* of states the plugin must never produce on a user's repo (see that file's
* header for the rationale).
*/
/**
* Resolve the path of the git executable. 响亮报错 (GitMissingError) when it
* cannot be resolved — per §2「git 可执行缺失 -> 同样拒绝，提示安装 Git」.
* Deliberately NOT cached: resolution happens per call so PATH changes
* (e.g. TC-GIT-011) are observed.
*/
function resolveGitExecutable(override) {
	if (override !== void 0) {
		if (override.length === 0) throw new GitMissingError("git executable override is empty — refusing to run git (GIT_INTEGRATION §2)");
		try {
			if (!statSync(override).isFile()) throw new Error(`not a file: ${override}`);
			accessSync(override, constants.X_OK);
		} catch (e) {
			throw new GitMissingError(`git executable at "${override}" is not usable (GIT_INTEGRATION §2: 提示安装 Git)`, { cause: e });
		}
		return override;
	}
	const separator = process.platform === "win32" ? ";" : ":";
	const pathEnv = process.env.PATH ?? process.env.Path ?? "";
	const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
	for (const dir of pathEnv.split(separator)) {
		if (dir.length === 0) continue;
		for (const ext of exts) {
			const candidate = join(dir, `git${ext.toLowerCase()}`);
			try {
				if (!statSync(candidate).isFile()) continue;
				accessSync(candidate, constants.X_OK);
				return candidate;
			} catch {}
		}
	}
	throw new GitMissingError("git executable not found in PATH — 拒绝进入 managed research mode; 请安装 Git (GIT_INTEGRATION §2)");
}
/**
* Spawn `git -C <root> <argv…>` as a plain argv array (INV-GIT-6).
* No whitelist check here — callers: {@link runGit} (checked) and test
* infrastructure (fixture setup for states the plugin itself must never
* perform; see file header).
*
* The child runs in its own process group (Linux) so the timeout kill also
* reaches helper processes (e.g. a `sleep` under a test fake-git) — an
* orphan holding the stdio pipes would otherwise hang the promise.
*/
function spawnGitProcess(executable, root, argv, spec) {
	const command = [
		"-C",
		root,
		...argv
	];
	return new Promise((resolve, reject) => {
		let settled = false;
		const child = spawn(executable, command, {
			shell: false,
			env: process.env,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			detached: process.platform !== "win32"
		});
		const stdoutChunks = [];
		let stdoutBytes = 0;
		const stderrChunks = [];
		let stderrBytes = 0;
		let truncated = false;
		const pushCapped = (chunks, bytes, chunk) => {
			const remaining = spec.maxOutputBytes - bytes;
			if (remaining <= 0) return {
				bytes,
				capped: true
			};
			if (chunk.length > remaining) {
				chunks.push(chunk.subarray(0, remaining));
				return {
					bytes: spec.maxOutputBytes,
					capped: true
				};
			}
			chunks.push(chunk);
			return {
				bytes: bytes + chunk.length,
				capped: false
			};
		};
		child.stdout?.on("data", (chunk) => {
			const r = pushCapped(stdoutChunks, stdoutBytes, chunk);
			stdoutBytes = r.bytes;
			if (r.capped) truncated = true;
		});
		child.stderr?.on("data", (chunk) => {
			const r = pushCapped(stderrChunks, stderrBytes, chunk);
			stderrBytes = r.bytes;
			if (r.capped) truncated = true;
		});
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			killProcessGroup(child);
			reject(new GitTimeoutError(command, spec.timeoutMs));
		}, spec.timeoutMs);
		child.on("error", (e) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (e.code === "ENOENT") reject(new GitMissingError(`failed to spawn git at "${executable}" (ENOENT) — 请安装 Git (GIT_INTEGRATION §2)`, { cause: e }));
			else reject(new GitMissingError(`failed to spawn git at "${executable}": ${e.message}`, { cause: e }));
		});
		child.on("close", (code, signal) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (code === null) {
				reject(new GitCommandError(command, -1, Buffer.concat(stdoutChunks).toString("utf8"), `killed by signal ${signal ?? "unknown"}`));
				return;
			}
			resolve({
				exitCode: code,
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
				truncated
			});
		});
	});
}
function killProcessGroup(child) {
	try {
		if (child.pid != null && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
		else child.kill("SIGKILL");
	} catch {}
}
/**
* The checked path: validate argv against the W1–W13 whitelist (INV-GIT-7
* 运行时面 — through the CALL's tree scope: `opts.treeDir`'s rows, or the
* frozen default scope when absent — V2 T3.2b: the W9/W10 pathspecs are
* generated from the configured tree name), resolve the executable (fail
* loud), then spawn with the §1.9 guards. Every operation in operations.ts
* goes through here.
*/
async function runGit(root, argv, opts) {
	scopeFor(opts).assertWhitelisted(argv);
	return await spawnGitProcess(resolveGitExecutable(opts?.gitExecutable), root, argv, {
		timeoutMs: opts?.timeoutMs ?? 1e4,
		maxOutputBytes: opts?.maxOutputBytes ?? 1048576
	});
}
//#endregion
//#region src/host/git/operations.ts
const OID_RE = /^[0-9a-f]{40}$/;
function withC(root, argv) {
	return [
		"-C",
		root,
		...argv
	];
}
function assertRepoRelativePath(p, op) {
	if (typeof p !== "string" || p.length === 0) throw new GitInputError(`${op}: path must be a non-empty string`);
	if (p === ".." || p.startsWith("../") || p.startsWith("/") || p.includes("\0")) throw new GitInputError(`${op}: path must be repo-root-relative (GIT_INTEGRATION §3 说明), got: ${p}`);
	return p;
}
function assertOid(oid, op) {
	if (typeof oid !== "string" || !OID_RE.test(oid)) throw new GitInputError(`${op}: expected a full 40-hex commit OID, got: ${String(oid)}`);
	return oid;
}
function commandFailed(root, argv, res) {
	throw new GitCommandError(withC(root, argv), res.exitCode, res.stdout, res.stderr);
}
/** W1 (§2): `git -C <candidate> rev-parse --show-toplevel`. exit≠0 → 不是 Git repo. */
async function detectRepo(candidateRoot, opts) {
	const res = await runGit(candidateRoot, ["rev-parse", "--show-toplevel"], opts);
	if (res.exitCode !== 0) return {
		ok: false,
		reason: "not-a-repo"
	};
	return {
		ok: true,
		repoRoot: res.stdout.trim()
	};
}
/** W2 (§5.1 前置): `git rev-parse --git-dir`, returned absolute (resolved against root). */
async function resolveGitDir(root, opts) {
	const argv = ["rev-parse", "--git-dir"];
	const res = await runGit(root, argv, opts);
	if (res.exitCode !== 0) commandFailed(root, argv, res);
	const raw = res.stdout.trim();
	return isAbsolute(raw) ? raw : join(root, raw);
}
/**
* W3 (§7): `git hash-object -- <path>` — 对 working copy 内容计算 Git blob
* OID，无需 commit → stale 检测不依赖用户 commit 频率 (PLAN_FORK_SPEC §3/§5).
*/
async function hashObject(root, filePath, opts) {
	const argv = [
		"hash-object",
		"--",
		assertRepoRelativePath(filePath, "hashObject")
	];
	const res = await runGit(root, argv, opts);
	if (res.exitCode !== 0) commandFailed(root, argv, res);
	return res.stdout.trim();
}
/** W4 (§8 audit / checkpoint 前置): `git status --porcelain=v2 [--branch]`. */
async function status(root, opts) {
	const argv = ["status", "--porcelain=v2"];
	if (opts?.includeBranch ?? true) argv.push("--branch");
	const res = await runGit(root, argv, opts);
	if (res.exitCode !== 0) commandFailed(root, argv, res);
	const { head, entries } = parsePorcelainV2(res.stdout);
	return {
		head,
		entries,
		raw: res.stdout,
		truncated: res.truncated
	};
}
/**
* Parse `git status --porcelain=v2 [--branch]`.
*
* Line grammar (git-status(1), verified against git 2.53 output):
*   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
*   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<origPath>
*   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <hI> <path>
*   ? <path>
* Forward-compatible: the path is always the LAST token (quoted paths
* contain no raw spaces), rename lines carry a tab between path/origPath;
* unknown lines (`# …` comments, `header …` extensions) are skipped — raw
* is kept verbatim in the result.
*/
function parsePorcelainV2(raw) {
	let head;
	let branchOid;
	const entries = [];
	for (const line of raw.split("\n")) {
		if (line.length === 0) continue;
		if (line.startsWith("# branch.oid ")) {
			const v = line.slice(13);
			if (/^[0-9a-f]{40}$/.test(v)) {
				branchOid = v;
				if (head?.kind === "detached") head.oid = v;
			}
		} else if (line.startsWith("# branch.head ")) {
			const v = line.slice(14);
			head = v === "(detached)" ? {
				kind: "detached",
				oid: branchOid
			} : {
				kind: "branch",
				name: v
			};
		} else if (line.startsWith("# branch.upstream ")) {
			if (head?.kind === "branch") head.upstream = line.slice(18);
		} else if (line.startsWith("# branch.ab ")) {
			const m = /^\+(-?\d+) -(-?\d+)$/.exec(line.slice(12));
			if (m && head?.kind === "branch") {
				head.ahead = Number(m[1]);
				head.behind = Number(m[2]);
			}
		} else if (line.startsWith("1 ") || line.startsWith("u ")) {
			const parts = line.slice(2).split(" ");
			const xy = parts[0] ?? "";
			entries.push({
				kind: line.startsWith("u ") ? "unmerged" : "tracked",
				x: xy.slice(0, 1),
				y: xy.slice(1, 2),
				path: unquotePath(parts[parts.length - 1] ?? "")
			});
		} else if (line.startsWith("2 ")) {
			const parts = line.slice(2).split(" ");
			const xy = parts[0] ?? "";
			const last = parts[parts.length - 1] ?? "";
			const sep = last.indexOf("	");
			const [path, origPath] = sep >= 0 ? [last.slice(0, sep), last.slice(sep + 1)] : [last, ""];
			entries.push({
				kind: "renamed",
				x: xy.slice(0, 1),
				y: xy.slice(1, 2),
				path: unquotePath(path),
				origPath: unquotePath(origPath)
			});
		} else if (line.startsWith("? ")) entries.push({
			kind: "untracked",
			x: "",
			y: "",
			path: unquotePath(line.slice(2))
		});
	}
	return {
		head,
		entries
	};
}
/** Unquote a C-quoted path from git output (core.quotePath). */
function unquotePath(p) {
	if (p.length < 2 || !p.startsWith("\"") || !p.endsWith("\"")) return p;
	const inner = p.slice(1, -1);
	let out = "";
	for (let i = 0; i < inner.length; i++) {
		const c = inner[i];
		if (c !== "\\") {
			out += c;
			continue;
		}
		const n = inner[++i];
		if (n === void 0) {
			out += c;
			break;
		}
		if (n === "t") out += "	";
		else if (n === "n") out += "\n";
		else if (n === "r") out += "\r";
		else if (n === "\"" || n === "\\") out += n;
		else if (n >= "0" && n <= "7") {
			let digits = n;
			while (digits.length < 3 && inner[i + 1] >= "0" && inner[i + 1] <= "7") digits += inner[++i];
			out += String.fromCharCode(parseInt(digits, 8));
		} else out += n;
	}
	return out;
}
/** W5 (§8 audit): `git diff --name-status [<baseline>]` (baseline: 40-hex OID). */
async function diffNameStatus(root, baseline, opts) {
	const argv = ["diff", "--name-status"];
	if (baseline !== void 0) argv.push(assertOid(baseline, "diffNameStatus"));
	const res = await runGit(root, argv, opts);
	if (res.exitCode !== 0) commandFailed(root, argv, res);
	const out = [];
	for (const line of res.stdout.split("\n")) {
		if (line.length === 0) continue;
		const parts = line.split("	");
		if (parts.length >= 3 && /^[RC]/.test(parts[0])) out.push({
			status: parts[0],
			oldPath: unquotePath(parts[1]),
			path: unquotePath(parts[2])
		});
		else if (parts.length === 2) out.push({
			status: parts[0],
			path: unquotePath(parts[1])
		});
	}
	return out;
}
/** W11 (checkpoint 第三步, **用户**): `git rev-parse HEAD` → 记录 commit OID. */
async function revParseHead(root, opts) {
	const argv = ["rev-parse", "HEAD"];
	const res = await runGit(root, argv, opts);
	if (res.exitCode !== 0) commandFailed(root, argv, res);
	return res.stdout.trim();
}
/** W13 (§8 audit, Phase 6): `git ls-files -- <pathspec>` — strict tracked 路径集. */
async function lsFiles(root, pathspec, opts) {
	const argv = [
		"ls-files",
		"--",
		assertRepoRelativePath(pathspec, "lsFiles")
	];
	const res = await runGit(root, argv, opts);
	if (res.exitCode !== 0) commandFailed(root, argv, res);
	return res.stdout.split("\n").filter((l) => l.length > 0).map(unquotePath);
}
//#endregion
//#region src/host/git/conflict.ts
/**
* WP-1.2 — Git wrapper: §5.1 冲突状态检测.
*
* 每次 checkpoint 前必须执行 (§5 步骤 1): 先 W2 定位 git dir, 再检查五个
* 「仓库处于进行中操作」标志文件/目录:
*
*   <gitdir>/MERGE_HEAD          merge 进行中
*   <gitdir>/CHERRY_PICK_HEAD    cherry-pick 进行中
*   <gitdir>/REVERT_HEAD         revert 进行中
*   <gitdir>/rebase-apply/       rebase (apply) 进行中
*   <gitdir>/rebase-merge/       rebase (merge) 进行中
*
* 存在任一项 → 拒绝 checkpoint (INV-GIT-4 fail loud)。
*
* 双保险 (照录 §5.1): 即便检测遗漏, git 本身也会拒绝 (实测: merge 进行中
* 执行 pathspec commit 返回 `fatal: cannot do a partial commit during a
* merge.`, exit 128) — 本层从不单独依赖检测。
*/
function flagPresent(dir, name, wantDir) {
	try {
		const st = statSync(join(dir, name));
		return wantDir ? st.isDirectory() : st.isFile();
	} catch {
		return false;
	}
}
/** §5.1: `git rev-parse --git-dir` + 五个标志文件/目录存在性. */
async function detectConflictState(root, opts) {
	const gitDir = await resolveGitDir(root, opts);
	const flags = {
		mergeHead: flagPresent(gitDir, "MERGE_HEAD", false),
		cherryPickHead: flagPresent(gitDir, "CHERRY_PICK_HEAD", false),
		revertHead: flagPresent(gitDir, "REVERT_HEAD", false),
		rebaseApply: flagPresent(gitDir, "rebase-apply", true),
		rebaseMerge: flagPresent(gitDir, "rebase-merge", true)
	};
	return {
		gitDir,
		flags,
		inProgress: flags.mergeHead || flags.cherryPickHead || flags.revertHead || flags.rebaseApply || flags.rebaseMerge
	};
}
//#endregion
//#region src/host/persistence/hardening/git-check.ts
/**
* WP-8.1 — hardening: check 3, the Git workspace boundary at startup.
*
* Orchestrates the already-delivered `src/host/git` layer (the sole spawn
* point, INV-GIT-6) into the startup classification — GIT_INTEGRATION
* §5.1 冲突状态检测 + §9 错误分类 + the TC-GIT-001 dirty-tree semantics:
*
*   1. W1 `detectRepo` — git executable missing (spawn ENOENT →
*      `GitMissingError`) or not a repo: the ARCHITECTURE §10 row
*      「拒绝 managed research mode，给出「Initialize Git Repository」显式
*      操作入口；绝不静默 init」→ `recoverable`, `managedMode: 'refused'`,
*      checkpoint refused; the READ surface over `.research/` files is
*      unaffected (reading a file does not need git).
*   2. §5.1 `detectConflictState` — any of the five in-progress flags
*      (MERGE_HEAD / CHERRY_PICK_HEAD / REVERT_HEAD / rebase-apply /
*      rebase-merge): the checkpoint is EXPLICITLY refused (INV-GIT-4 —
*      resolve first); the read surface is unaffected (the working copy
*      IS the canonical current state, §9「读 working copy」) →
*      `recoverable`, `checkpointAllowed: false`.
*   3. W4 `status` — a dirty working tree is a NORMAL state (TC-GIT-001):
*      reads are unaffected and the checkpoint REMAINS allowed — it
*      commits only `.research/**` and leaves unrelated dirty state
*      untouched (never unstages, never cleans) → `pass` with the dirty
*      facts recorded (total entries + the entries under `.research/`).
*   4. git itself erroring (repo corruption — §9「原样展示 git 错误；插件
*      不尝试修复」): managed mode refused (checkpoint safety cannot be
*      verified), the git error shown VERBATIM in the report →
*      `recoverable`, `reason: 'repo-error'`.
*
* The git operations ride on the injectable {@link GitOps} port (default:
* the real layer) so the ENOENT / repo-error forms are testable without
* uninstalling git or corrupting a real repo.
*
* This check NEVER writes to the repository (no init, no stage, no
* commit — the read-only startup probe; 绝不静默 init, §10).
*/
/** The production default: the real `src/host/git` layer. */
const realGitOps = {
	detectRepo: (root) => detectRepo(root),
	detectConflictState: (root) => detectConflictState(root),
	status: (root) => status(root)
};
function describeFlags(flags) {
	const active = [];
	if (flags.mergeHead) active.push("MERGE_HEAD (merge 进行中)");
	if (flags.cherryPickHead) active.push("CHERRY_PICK_HEAD (cherry-pick 进行中)");
	if (flags.revertHead) active.push("REVERT_HEAD (revert 进行中)");
	if (flags.rebaseApply) active.push("rebase-apply/ (rebase 进行中)");
	if (flags.rebaseMerge) active.push("rebase-merge/ (rebase 进行中)");
	return active.join(", ");
}
function errMsg$2(e) {
	return e instanceof Error ? e.message : String(e);
}
/**
* Run the Git workspace boundary check at `root`.
*
* Never throws: git-layer failures are classified (see module header).
* `researchDir` filters the dirty entries reported under the `.research`
* scope (repo-root-relative paths).
*/
async function checkGitWorkspace(root, options = {}) {
	const ops = options.ops ?? realGitOps;
	const researchDir = options.researchDir ?? ".research";
	let detected;
	let repoRoot = null;
	try {
		const det = await ops.detectRepo(root);
		detected = det.ok;
		if (det.ok) repoRoot = det.repoRoot;
	} catch (e) {
		if (e instanceof GitMissingError) return {
			status: "recoverable",
			repoDetected: false,
			repoRoot: null,
			conflictInProgress: false,
			dirty: false,
			dirtyResearchPaths: [],
			managedMode: "refused",
			checkpointAllowed: false,
			reason: "git-missing",
			message: "the git executable is missing (spawn ENOENT) — managed research mode refused",
			guidance: ["Git is not installed (or not on PATH) — managed research mode (checkpoint / git history / restore) is REFUSED (ARCHITECTURE §10): the read surface over .research/ files is unaffected", "remedy (user action, never automatic): install Git, then restart — the plugin never initializes a repository or installs anything on its own"]
		};
		return repoErrorResult(root, e, "detectRepo");
	}
	if (!detected) return {
		status: "recoverable",
		repoDetected: false,
		repoRoot: null,
		conflictInProgress: false,
		dirty: false,
		dirtyResearchPaths: [],
		managedMode: "refused",
		checkpointAllowed: false,
		reason: "not-a-repo",
		message: "the workspace is not a Git repository — managed research mode refused",
		guidance: ["this workspace is not a Git repository — managed research mode (checkpoint / git history / restore) is REFUSED (ARCHITECTURE §10); the read surface over .research/ files is unaffected", "remedy (user action, never automatic — 绝不静默 init): use the explicit 「Initialize Git Repository」 operation entry to start a repository for this workspace, then restart"]
	};
	let inProgress = false;
	let flags;
	try {
		const conflict = await ops.detectConflictState(root);
		inProgress = conflict.inProgress;
		flags = conflict.flags;
	} catch (e) {
		return repoErrorResult(root, e, "detectConflictState");
	}
	let dirty = false;
	let dirtyTotal = 0;
	const dirtyResearchPaths = [];
	try {
		const st = await ops.status(root);
		dirty = st.entries.length > 0;
		dirtyTotal = st.entries.length;
		const prefix = `${researchDir}/`;
		for (const entry of st.entries) if (entry.path.startsWith(prefix)) dirtyResearchPaths.push(entry.path);
	} catch (e) {
		return repoErrorResult(root, e, "status");
	}
	if (inProgress) {
		const detail = describeFlags(flags);
		return {
			status: "recoverable",
			repoDetected: true,
			repoRoot,
			conflictInProgress: true,
			conflictFlags: flags,
			conflictDetail: detail,
			dirty,
			dirtyResearchPaths,
			managedMode: "ok",
			checkpointAllowed: false,
			reason: "conflict-in-progress",
			message: `repository is mid-operation: ${detail} — checkpoint explicitly refused`,
			guidance: [`the repository has an in-progress operation (${detail}) — the checkpoint is EXPLICITLY REFUSED (INV-GIT-4, GIT_INTEGRATION §5.1): resolve it first (finish/abort the merge/rebase/cherry-pick/revert)`, "the read surface is unaffected — the working copy IS the canonical current state (GIT_INTEGRATION §9); nothing is auto-resolved or auto-committed by the plugin"]
		};
	}
	const researchCount = dirtyResearchPaths.length;
	return {
		status: "pass",
		repoDetected: true,
		repoRoot,
		conflictInProgress: false,
		conflictFlags: flags,
		dirty,
		dirtyResearchPaths,
		managedMode: "ok",
		checkpointAllowed: true,
		message: dirty ? `dirty working tree (${String(dirtyTotal)} dirty path(s), ${String(researchCount)} under ${researchDir}/) — reads unaffected; the checkpoint commits only ${researchDir}/** (TC-GIT-001)` : "clean working tree (no dirty paths)",
		guidance: []
	};
}
function repoErrorResult(root, e, step) {
	const shown = e instanceof GitError ? errMsg$2(e) : `unexpected error during the git check (${step}): ${errMsg$2(e)}`;
	return {
		status: "recoverable",
		repoDetected: true,
		repoRoot: null,
		conflictInProgress: false,
		dirty: false,
		dirtyResearchPaths: [],
		managedMode: "refused",
		checkpointAllowed: false,
		reason: "repo-error",
		message: `git failed during the startup check (${step}) at ${root} — shown as-is, the plugin does not attempt repair (GIT_INTEGRATION §9「repo 损坏」): ${shown}`,
		guidance: [
			`git itself reported an error during the startup check (repo corruption or a git failure) — displayed as-is, the plugin does NOT attempt to repair it (GIT_INTEGRATION §9): ${shown}`,
			"managed research mode (checkpoint / git history / restore) is REFUSED until the repository is healthy again (checkpoint safety cannot be verified); the read surface over .research/ files is unaffected",
			"remedy (user action): inspect the repository (e.g. `git fsck`) and repair it outside the plugin, then restart"
		]
	};
}
//#endregion
//#region src/host/persistence/hardening/tree-check.ts
/** The per-file errors that make the WHOLE tree unusable (see header). */
function isFatalLoadError(e) {
	if (e.file === "") return true;
	if (e.code === "SCHEMA_LOAD") return true;
	if (e.code === "SCHEMA_VERSION") return true;
	if (e.code === "SCHEMA_UNAVAILABLE") return true;
	if (e.code === "MISSING_REQUIRED" && (e.file === "project.yaml" || e.file === "schema-version")) return true;
	return false;
}
/** Locate one error for messages: `file` + optional `path` (the field). */
function located(e) {
	const file = e.file === "" ? "<research root>" : e.file;
	return e.path ? `${file}${e.path}` : file;
}
/**
* Classify a loader result into the startup semantics (see module header).
* Pure: no I/O, no store — the orchestrator passes the `LoadResult`.
*/
function classifyTreeLoad(load) {
	if (load.errors.length === 0) return {
		status: "pass",
		usable: true,
		load,
		fatalErrors: [],
		degradedErrors: [],
		guidance: []
	};
	const fatalErrors = [];
	const degradedErrors = [];
	for (const e of load.errors) if (isFatalLoadError(e)) fatalErrors.push(e);
	else degradedErrors.push(e);
	if (fatalErrors.length > 0) return {
		status: "unrecoverable",
		usable: false,
		load,
		fatalErrors,
		degradedErrors,
		guidance: [
			"the .research declarative 真源 cannot be loaded at all — refusing to start against it (fail loud, no guess-repair):",
			...fatalErrors.map((e) => `  [${e.code}] ${located(e)}: ${e.message}`),
			...fatalRemedy(fatalErrors)
		]
	};
	return {
		status: "recoverable",
		usable: true,
		load,
		fatalErrors: [],
		degradedErrors,
		guidance: [
			`the .research tree loaded with ${degradedErrors.length} broken file(s) — the broken file(s) are REJECTED with precise location and the rest loaded normally (ARCHITECTURE §10; no guess-repair):`,
			...degradedErrors.map((e) => `  [${e.code}] ${located(e)}: ${e.message}`),
			"the plugin serves the READONLY usable surface until the broken file(s) are fixed by the USER (fix the file in place, or `git restore --source=<commit> -- <path>` for a committed-good version) — the write surface (checkpoint / plan mutations / event appends over the broken 真源) is refused"
		]
	};
}
/** The user-facing remedy per fatal-error shape (never a generic shrug). */
function fatalRemedy(errors) {
	const remedy = [];
	const has = (pred) => errors.some(pred);
	if (has((e) => e.file === "" && e.code === "MISSING_REQUIRED")) remedy.push("remedy: the workspace carries no .research tree — open a workspace that does, or create one (the plugin never creates research content silently)");
	else if (has((e) => e.file === "" && e.code === "READ")) remedy.push("remedy: the .research root is unreadable (I/O failure) — check permissions/path, then restart");
	if (has((e) => e.code === "MISSING_REQUIRED" && e.file === "project.yaml")) remedy.push("remedy: .research/project.yaml is missing (the root object) — restore it from Git history (`git restore --source=<commit> -- .research/project.yaml`) or recreate it");
	if (has((e) => e.code === "MISSING_REQUIRED" && e.file === "schema-version")) remedy.push("remedy: .research/schema-version is missing — restore it (V1 = a single line \"1\")");
	if (has((e) => e.code === "SCHEMA_VERSION")) remedy.push("remedy: the .research/schema-version value is unsupported by this build — restore the V1 value (a single line \"1\") or update the plugin to a build that supports the contract");
	if (has((e) => e.code === "SCHEMA_LOAD" || e.code === "SCHEMA_UNAVAILABLE")) remedy.push("remedy: the FROZEN schema set this build ships is incomplete or unreadable — that is a broken plugin installation, not user data: reinstall the plugin and restart");
	if (remedy.length === 0) remedy.push("remedy: restore the affected file(s) from Git history or recreate them, then restart");
	return remedy;
}
//#endregion
//#region src/shared/ids/registry.ts
/**
* The 25 rows, in §1.1 table order (L20-44).
*
* Prefix-containment pairs present in the frozen set (the ones §1.1 rule 4's
* 最长前缀优先 protects against): `T`⊂`TE`, `T`⊂`TPC`, `R`⊂`REL`,
* `R`⊂`RPT`, `M`⊂`MA`, `A`⊂`AN`, `IN`⊂`INT` — hence the ambiguity samples
* beyond the spec's `TE`/`T` and `INT`/`IN` (see tests/ids/parse.test.ts).
*/
const ID_PREFIX_REGISTRY = [
	{
		prefix: "PRJ",
		kind: "PROJECT",
		example: "PRJ-1",
		scope: "GLOBAL",
		allocatedAt: "创建 Project",
		section: "DOMAIN_SCHEMA §2.1"
	},
	{
		prefix: "TPC",
		kind: "TOPIC",
		example: "TPC-3",
		scope: "PROJECT",
		allocatedAt: "创建 Topic",
		section: "DOMAIN_SCHEMA §2.2"
	},
	{
		prefix: "WS",
		kind: "WORKSTREAM",
		example: "WS-12",
		scope: "PROJECT",
		allocatedAt: "创建 Workstream",
		section: "DOMAIN_SCHEMA §2.3"
	},
	{
		prefix: "TE",
		kind: "TOPOLOGY_EDGE",
		example: "TE-17",
		scope: "PROJECT",
		allocatedAt: "创建拓扑边",
		section: "DOMAIN_SCHEMA §3.1"
	},
	{
		prefix: "PF",
		kind: "PLAN_FORK",
		example: "PF-17",
		scope: "PROJECT",
		allocatedAt: "Agent 创建 proposal",
		section: "DOMAIN_SCHEMA §5（规则见 PLAN_FORK_SPEC.md）"
	},
	{
		prefix: "T",
		kind: "TASK",
		example: "T-17",
		scope: "PROJECT",
		allocatedAt: "创建 Task 定义",
		section: "DOMAIN_SCHEMA §4.1"
	},
	{
		prefix: "G",
		kind: "GATE",
		example: "G-2",
		scope: "PROJECT",
		allocatedAt: "创建 Gate 定义",
		section: "DOMAIN_SCHEMA §4.2"
	},
	{
		prefix: "M",
		kind: "MILESTONE",
		example: "M-1",
		scope: "PROJECT",
		allocatedAt: "创建 Milestone 定义",
		section: "DOMAIN_SCHEMA §4.3"
	},
	{
		prefix: "R",
		kind: "RUN",
		example: "R-81",
		scope: "PROJECT",
		allocatedAt: "注册 Run",
		section: "DOMAIN_SCHEMA §6.1"
	},
	{
		prefix: "C",
		kind: "CLAIM",
		example: "C-17",
		scope: "PROJECT",
		allocatedAt: "记录 Claim",
		section: "DOMAIN_SCHEMA §7.1"
	},
	{
		prefix: "F",
		kind: "FACT",
		example: "F-31",
		scope: "PROJECT",
		allocatedAt: "记录 Fact",
		section: "DOMAIN_SCHEMA §7.2"
	},
	{
		prefix: "A",
		kind: "ARTIFACT",
		example: "A-9",
		scope: "PROJECT",
		allocatedAt: "注册 Artifact",
		section: "DOMAIN_SCHEMA §7.3"
	},
	{
		prefix: "REL",
		kind: "RELATION",
		example: "REL-40",
		scope: "PROJECT",
		allocatedAt: "添加 Relation",
		section: "DOMAIN_SCHEMA §8"
	},
	{
		prefix: "OBJ",
		kind: "OBJECTIVE",
		example: "OBJ-1",
		scope: "PROJECT",
		allocatedAt: "创建 Objective",
		section: "DOMAIN_SCHEMA §9.1"
	},
	{
		prefix: "IV",
		kind: "INTERVENTION",
		example: "IV-5",
		scope: "PROJECT",
		allocatedAt: "创建 Intervention",
		section: "DOMAIN_SCHEMA §9.2"
	},
	{
		prefix: "NA",
		kind: "NEXT_ACTION",
		example: "NA-2",
		scope: "PROJECT",
		allocatedAt: "创建 NextAction",
		section: "DOMAIN_SCHEMA §9.3"
	},
	{
		prefix: "BLK",
		kind: "BLOCKER",
		example: "BLK-3",
		scope: "PROJECT",
		allocatedAt: "创建 Blocker",
		section: "DOMAIN_SCHEMA §9.4"
	},
	{
		prefix: "INT",
		kind: "INTERACTION",
		example: "INT-7",
		scope: "PROJECT",
		allocatedAt: "登记 Interaction",
		section: "DOMAIN_SCHEMA §10.1"
	},
	{
		prefix: "RPT",
		kind: "REPORTING_ITEM",
		example: "RPT-4",
		scope: "PROJECT",
		allocatedAt: "创建 ReportingItem",
		section: "DOMAIN_SCHEMA §10.2"
	},
	{
		prefix: "SEV",
		kind: "SCHEDULED_EVENT",
		example: "SEV-6",
		scope: "PROJECT",
		allocatedAt: "登记 ScheduledEvent",
		section: "DOMAIN_SCHEMA §10.3"
	},
	{
		prefix: "H",
		kind: "HISTORY_EVENT",
		example: "H-1001",
		scope: "PROJECT",
		allocatedAt: "append 时",
		section: "HISTORY_EVENT_CATALOG §1（事件信封）；DOMAIN_SCHEMA §15 history_event 表"
	},
	{
		prefix: "IN",
		kind: "INBOX_ITEM",
		example: "IN-11",
		scope: "PROJECT",
		allocatedAt: "capture 时",
		section: "DOMAIN_SCHEMA §11"
	},
	{
		prefix: "DS",
		kind: "DISCOVERED_SESSION",
		example: "DS-2",
		scope: "PROJECT",
		allocatedAt: "发现时",
		section: "DOMAIN_SCHEMA §6.2"
	},
	{
		prefix: "MA",
		kind: "MANAGEMENT_ACTION",
		example: "MA-30",
		scope: "PROJECT",
		allocatedAt: "管理操作时",
		section: "DOMAIN_SCHEMA §12.1"
	},
	{
		prefix: "AN",
		kind: "ANALYSIS_RECORD",
		example: "AN-1",
		scope: "PROJECT",
		allocatedAt: "用户保存分析时",
		section: "DOMAIN_SCHEMA §12.2"
	}
];
const PREFIX_TO_ENTRY = new Map(ID_PREFIX_REGISTRY.map((entry) => [entry.prefix, entry]));
const KIND_TO_ENTRY = new Map(ID_PREFIX_REGISTRY.map((entry) => [entry.kind, entry]));
/** All 25 prefixes, in §1.1 table order. */
const ALL_PREFIXES = ID_PREFIX_REGISTRY.map((entry) => entry.prefix);
/**
* The 24 §1.3 ObjectKind values (the 25 IdKinds minus MANAGEMENT_ACTION),
* in §1.1 table order.
*/
const OBJECT_KIND_VALUES = ID_PREFIX_REGISTRY.map((entry) => entry.kind).filter((kind) => kind !== "MANAGEMENT_ACTION");
/** Exact registry lookup by prefix (§1.1 row); undefined for unregistered prefixes. */
function entryForPrefix(prefix) {
	return PREFIX_TO_ENTRY.get(prefix);
}
/** Exact registry lookup by kind (always defined for a valid IdKind). */
function entryForKind(kind) {
	const entry = KIND_TO_ENTRY.get(kind);
	if (entry === void 0) throw new Error(`unknown IdKind: ${String(kind)}`);
	return entry;
}
/** The registered prefix for a kind (e.g. `TASK` → `T`). */
function prefixForKind(kind) {
	return entryForKind(kind).prefix;
}
//#endregion
//#region src/shared/ids/parse.ts
/**
* ID parsing — DOMAIN_SCHEMA.md §1.1 规则 4 (L51): 「ID 解析按**最长前缀优先**
* （`TE`/`T`、`INT`/`IN` 等有前缀包含关系）」.
*
* Pure function surface (zero I/O, WP-1.6 boundary).
*
* Algorithm (longest-prefix-first + exactness):
*   1. The input must match the frozen format regex `^[A-Z]+-[1-9][0-9]*$`
*      (§1.1 L14) — uppercase prefix run, dash, positive integer without a
*      leading zero.
*   2. Let `run` be the uppercase run before the dash. Among the registered
*      prefixes that are a leading substring of `run`, take the LONGEST
*      (rule 4). Example resolutions: `TE` → `TE` (not `T`), `INT` → `INT`
*      (not `IN`), `TPC` → `TPC` (not `T`), `REL`/`RPT` → not `R`,
*      `MA` → not `M`, `AN` → not `A`.
*   3. The run must equal the matched prefix exactly — a run that merely
*      EXTENDS a registered prefix (`TEX-1`, `TTE-1`) names an unregistered
*      prefix and is rejected (§1.1: the registry is frozen; new prefixes
*      require a schema-version bump).
*   4. The sequence must be a safe integer: V1 counters are JS numbers here
*      and SQLite INTEGERs in WP-2.1; the frozen regex admits longer digit
*      runs, which parse rejects (strictness note, see WP-1.6 report).
*/
const PARSE_RE = /^([A-Z]+)-([1-9][0-9]*)$/;
/** Registered prefixes ordered longest-first (rule 4's resolution order). */
const PREFIXES_BY_LENGTH_DESC = [...ALL_PREFIXES].sort((a, b) => b.length - a.length);
/**
* Longest-prefix match (rule 4): the longest registered prefix that is a
* leading substring of `letterRun`; `null` when none matches.
*
* `TE` → `TE`, `T` → `T`, `INT` → `INT`, `IN` → `IN`, `TEX` → `TE`
* (the caller then rejects the non-exact run), `X` → `null`.
*/
function longestPrefixMatch(letterRun) {
	for (const prefix of PREFIXES_BY_LENGTH_DESC) if (letterRun.startsWith(prefix)) return prefix;
	return null;
}
/**
* Parse a research ID. Returns `null` (not throws) for anything that is not
* a well-formed ID of a registered prefix — callers that need the throwing
* form use {@link assertId}.
*/
function parseId(id) {
	const match = PARSE_RE.exec(id);
	if (match === null) return null;
	const run = match[1];
	const prefix = longestPrefixMatch(run);
	if (prefix === null || run !== prefix) return null;
	const entry = entryForPrefix(prefix);
	if (entry === void 0) return null;
	const sequence = Number(match[2]);
	if (!Number.isSafeInteger(sequence)) return null;
	return {
		kind: entry.kind,
		prefix,
		sequence,
		raw: id
	};
}
/** True iff `id` is well-formed AND resolves to exactly `kind`. */
function idMatchesKind(id, kind) {
	const parsed = parseId(id);
	return parsed !== null && parsed.kind === kind;
}
//#endregion
//#region src/shared/ids/construct.ts
/**
* ID construction — DOMAIN_SCHEMA.md §1.1 格式 (L14): `<PREFIX>-<正整数>`.
*
* The frozen spec defines exactly ONE form: a registered prefix plus the
* positive integer allocated from the (monotonic) project counter. There is
* no timestamp form in §1.1 (见 WP-1.6 报告「关键决策」); constructing
* anything else would violate the frozen format regex.
*
* Pure function surface (zero I/O, WP-1.6 boundary).
*/
/**
* Build the canonical ID string for `kind` + `sequence`
* (e.g. `makeId('TOPOLOGY_EDGE', 17)` → `'TE-17'`).
*
* @throws RangeError when `sequence` is not a positive safe integer
*   (the §1.1 regex admits no zero, no leading zeros; safe-integer bound
*   matches the parse side and the SQLite INTEGER backend of WP-2.1).
*/
function makeId(kind, sequence) {
	if (!Number.isSafeInteger(sequence) || sequence < 1) throw new RangeError(`invalid sequence ${String(sequence)} for kind ${kind} — §1.1 requires a positive integer (1..Number.MAX_SAFE_INTEGER)`);
	return `${prefixForKind(kind)}-${sequence}`;
}
//#endregion
//#region src/shared/ids/file-name.ts
/**
* 文件名 ↔ id 一致性校验助手 — DOMAIN_SCHEMA.md §1.1 规则 2/3 (L49-50) and
* §14 规则 (L606):
*
*   「文件名/目录名中的 `<id>` 即对象 ID（加载期与文件内 `id` 字段核对）」；
*   「声明式对象的 ID 同步持久化于文件名与文件内 `id` 字段，二者必须一致
*   （加载期校验）」；「加载期发现文件名与 `id` 不一致即报错」。
*
* Scope of this helper (WP-1.6): it checks the FILENAME face — the id
* carried by a file's own name vs the declared `id` field. DIRECTORY-segment
* ids (`.research/topics/<topic-id>/`, `workstreams/<ws-id>/`, §14) and the
* schema-level kind expectation (a `tasks/` file must carry a `T` id) are
* the WP-1.1 loader's validation; this helper stays kind-agnostic so both
* consumers compose it.
*
* Pure function surface (zero I/O, WP-1.6 boundary): paths are plain
* strings, POSIX or Windows separators.
*/
/**
* Extract the id carried by a filename or path: the basename with its last
* extension removed must itself be a well-formed research id (§1.1) —
* `items/tasks/T-1.yaml` → `T-1`, `TE-17.yaml` → `TE-17`, `workstream.yaml`
* → `null` (no id in the name).
*
* @returns the well-formed id, or `null` when the name carries none.
*/
function idFromFileName(fileNameOrPath) {
	const basename = fileNameOrPath.split(/[\\/]/).pop() ?? "";
	const dot = basename.lastIndexOf(".");
	const stem = dot > 0 ? basename.slice(0, dot) : basename;
	return parseId(stem) !== null ? stem : null;
}
/**
* §1.1 rule-2/3 load-time check: does the id in the filename equal the
* declared `id` field? See {@link FileNameIdCheck} for the three outcomes.
* String equality suffices: both sides are canonical `<PREFIX>-<positive
* integer>` strings (the declared side is validated against the same
* frozen regex upstream).
*/
function checkFileNameId(fileNameOrPath, declaredId) {
	const fileNameId = idFromFileName(fileNameOrPath);
	if (fileNameId === null) return {
		status: "no-id-in-name",
		declaredId
	};
	if (fileNameId === declaredId) return {
		status: "match",
		fileNameId,
		declaredId
	};
	return {
		status: "mismatch",
		fileNameId,
		declaredId
	};
}
//#endregion
//#region src/shared/ids/allocator.ts
/**
* Per-project ID allocation — DOMAIN_SCHEMA.md §1.1 规则 2 (L49): 「分配由
* 插件执行（Project 内单调递增计数器，持久化于 operational DB `meta` 表）」
* and the registry 唯一性范围 column (Project 内 vs 插件安装内全局).
*
* Pure logic, zero I/O (WP-1.6 boundary): the allocator depends ONLY on the
* structural `IdCounterPort` below — it never touches the meta table, the
* MetaStore, or any DSH/I/O package. The host-side `MetaStore`
* (`src/host/persistence/meta`) satisfies this port structurally (verified
* by tests), and the WP-2.1 sqlite backend must satisfy the SAME port with
* a genuinely atomic `bumpCounter` — that is the reserved seam.
*
* ## reserve / commit / release semantics
*
* §1.1 mandates a monotonic counter and forbids reusing issued ids
* (规则 1 ID 不可变; 规则 3 不得复用/篡改已有 ID) but does NOT define a
* reserve/commit/release protocol. The semantics implemented here are the
* simplest ones consistent with those two frozen rules (decision recorded in
* the WP-1.6 report):
*
*   - `reserve(kind, projectId)` — atomically bump the counter for
*     (uniqueness scope, kind, projectId) and hand out the next sequence.
*     The sequence is BURNED the moment it is reserved: the counter never
*     moves back.
*   - `commit(reservation)` — mark the reserved id live (in use).
*   - `release(reservation)` — abandon the reservation. The sequence is NOT
*     returned to the counter (monotonicity + no-reuse), so a RELEASED id
*     leaves a permanent GAP and can never be handed out again.
*
* Uniqueness therefore holds by construction: two `reserve` calls for the
* same (scope, kind, projectId) always yield distinct sequences because the
* counter strictly increases. A crash between `reserve` and `commit` burns
* that sequence (gap) but can never cause a duplicate — consistent with
* §1.1.
*
* commit/release are EXACTLY-ONCE and INSTANCE-BOUND: only the allocator
* that reserved an id may commit or release it, and only once (the
* reservation object is the token; a foreign instance's attempt throws).
* The pending set is per-instance in-memory bookkeeping; the persisted
* counter is the single source of truth for uniqueness.
*/
/** Key namespace for id counters inside the meta table (see module doc). */
const COUNTER_KEY_PREFIX = "id-counter";
/** Sentinel scope-part for kinds whose uniqueness scope is 插件安装内全局. */
const GLOBAL_SCOPE_KEY = "GLOBAL";
/**
* Compute the meta-table key for the counter of `kind` within `projectId`.
*
*   - GLOBAL scope (Project):  `id-counter:GLOBAL:PROJECT`  (projectId ignored)
*   - PROJECT scope (others):  `id-counter:<projectId>:<kind>`
*
* The GLOBAL key carries no project component because §1.1 makes Project
* unique across the whole plugin installation, not within a single project.
*/
function counterKey(kind, projectId) {
	const scopePart = entryForKind(kind).scope === "GLOBAL" ? GLOBAL_SCOPE_KEY : projectId;
	return `${COUNTER_KEY_PREFIX}:${scopePart}:${kind}`;
}
/** Reservation bookkeeping key: counter slot (counterKey + sequence). */
function slotOf(counterKeyStr, sequence) {
	return `${counterKeyStr}:${sequence}`;
}
/**
* The allocator. Inject the counter backend (an `IdCounterPort`); the same
* instance is safe to interleave in a single thread (each reserve performs a
* full read-modify-write through the port).
*/
var IdAllocator = class {
	counters;
	/**
	* Pending reservations, keyed by counter SLOT (counterKey:sequence) —
	* deliberately NOT by id string: the same id string may legitimately
	* exist in different projects (uniqueness scope = project, §1.1), so
	* `T-1` in PRJ-1 and `T-1` in PRJ-2 are distinct reservations.
	*/
	pending = /* @__PURE__ */ new Map();
	constructor(counters) {
		this.counters = counters;
	}
	/**
	* Reserve the next id for `kind` (uniqueness scoped per the frozen
	* registry). Burns the sequence immediately; the returned reservation is
	* in state `reserved` and must be `commit`-ed or `release`-d.
	*
	* @throws on a malformed projectId for PROJECT-scoped kinds, or when the
	*   counter backend reports a non-integer value (corruption).
	*/
	reserve(kind, projectId) {
		const entry = entryForKind(kind);
		if (entry.scope === "PROJECT") assertValidProjectId(projectId);
		const key = counterKey(kind, projectId);
		const sequence = this.counters.bumpCounter(key, 1);
		const reservation = {
			id: makeId(kind, sequence),
			kind,
			projectId: entry.scope === "GLOBAL" ? null : projectId,
			sequence,
			state: "reserved"
		};
		const slot = slotOf(key, sequence);
		if (this.pending.has(slot)) throw new Error(`allocator invariant violated: slot ${slot} already reserved`);
		this.pending.set(slot, reservation);
		return reservation;
	}
	/**
	* Mark a reserved id live (in use). Exactly once, and only for a
	* reservation created by THIS allocator instance.
	* @throws when the reservation is unknown to this instance or already
	*   committed/released.
	*/
	commit(reservation) {
		this.transition(reservation, "committed");
	}
	/**
	* Abandon a reservation. The sequence is burned (no reuse, monotonic),
	* leaving a permanent gap in the sequence. Exactly once, and only for a
	* reservation created by THIS allocator instance.
	* @throws when the reservation is unknown to this instance or already
	*   committed/released.
	*/
	release(reservation) {
		this.transition(reservation, "released");
	}
	/** Read the current counter for (kind, projectId) without bumping. */
	peek(kind, projectId) {
		if (entryForKind(kind).scope === "PROJECT") assertValidProjectId(projectId);
		return this.counters.getCounter(counterKey(kind, projectId));
	}
	slotFor(reservation) {
		return slotOf(counterKey(reservation.kind, reservation.projectId ?? ""), reservation.sequence);
	}
	transition(reservation, next) {
		if (this.pending.get(this.slotFor(reservation)) !== reservation) throw new Error(`reservation ${reservation.id} was not created by this allocator instance; commit/release only the reservations you reserved`);
		if (reservation.state !== "reserved") throw new Error(`reservation ${reservation.id} is already ${reservation.state}; commit/release exactly once`);
		reservation.state = next;
	}
};
/**
* PROJECT-scoped kinds require the counter key to name a real project:
* `projectId` must be a well-formed `PRJ` id (fail loud at the allocation
* boundary rather than burning counter space under a garbage key).
*/
function assertValidProjectId(projectId) {
	const parsed = parseId(projectId);
	if (parsed === null || parsed.kind !== "PROJECT") throw new Error(`invalid projectId ${JSON.stringify(projectId)} — PROJECT-scoped kinds require a well-formed PRJ id (DOMAIN_SCHEMA §1.1)`);
}
//#endregion
//#region src/host/domain/loader/path.ts
/**
* WP-1.1 — minimal POSIX path join for the pure domain kernel.
*
* The domain layer must not import Node builtins (ARCHITECTURE §2.2 rule 1:
* pure logic, no I/O — `node:path` is avoided so this module stays
* platform-free and the kernel has zero runtime deps outside the schema
* tooling). All `.research/` layout paths are POSIX-style by contract (§14);
* the injected reader is responsible for mapping onto the host FS.
*/
/**
* Join path segments POSIX-style, resolving `.` and `..`.
* A leading `/` on the FIRST segment (absolute reader paths) is preserved;
* later absolute segments are joined like `path.join`.
*/
function pjoin(...segments) {
	const absolute = segments.length > 0 && segments[0].startsWith("/");
	const out = [];
	for (const segment of segments) for (const part of segment.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
			else if (!absolute) out.push("..");
			continue;
		}
		out.push(part);
	}
	return (absolute ? "/" : "") + out.join("/");
}
//#endregion
//#region src/host/domain/loader/schemas.ts
/**
* WP-1.1 — schema loading & compilation (JSON Schema draft 2020-12).
*
* Loads the 11 frozen declarative schemas from `schemaDir` (read through the
* injected reader — the domain kernel itself performs no I/O) plus
* `common.schema.json` from the PARENT directory: every declarative schema
* `$ref`s its shared structures as `../common.schema.json#/$defs/<name>`, which
* AJV resolves against each schema's own `$id`
* (`https://dsh-research-control.invalid/schema/declarative/*.json`);
* registering common under its `$id`
* (`https://dsh-research-control.invalid/schema/common.schema.json`) makes all
* relative refs resolve without any schema mutation (frozen, read-only).
*
* `ajv-formats` is required because common.schema.json declares
* `format: "date-time"` / `"date"` (DOMAIN_SCHEMA §1.2) — AJV 8 does not
* validate unknown formats, so the formats package is what makes the frozen
* time-carrier contract actually enforce.
*/
/** Frozen declarative schema inventory: logical type → file name in schemaDir. */
const DECLARATIVE_SCHEMAS = [
	["project", "project.schema.json"],
	["topic", "topic.schema.json"],
	["workstream", "workstream.schema.json"],
	["topology", "topology.schema.json"],
	["plan", "plan.schema.json"],
	["task", "task.schema.json"],
	["gate", "gate.schema.json"],
	["milestone", "milestone.schema.json"],
	["objectives", "objectives.schema.json"],
	["workspace", "workspace.schema.json"],
	["agent-plan-fork-policy", "agent-plan-fork-policy.schema.json"]
];
/**
* Load + compile the frozen schema set.
*
* Failures are aggregated (one `SCHEMA_LOAD`/`SCHEMA_COMPILE`-class error per
* broken file, code `SCHEMA_LOAD`), never thrown: a missing declarative schema
* only invalidates its own document type (`SCHEMA_UNAVAILABLE` at validation
* time); a missing common schema invalidates all types (fail loud).
*/
function loadSchemas(reader, schemaDir, errors) {
	const validators = /* @__PURE__ */ new Map();
	const ajv = new Ajv2020({
		allErrors: true,
		strict: false,
		useDefaults: true,
		verbose: true
	});
	addFormats(ajv);
	const readJson = (path) => {
		let text;
		try {
			text = reader.readFile(path);
		} catch (cause) {
			errors.push({
				code: "SCHEMA_LOAD",
				file: path,
				message: `schema file read failed: ${cause instanceof Error ? cause.message : String(cause)}`
			});
			return null;
		}
		if (text === null) {
			errors.push({
				code: "SCHEMA_LOAD",
				file: path,
				message: `schema file not found (schemaDir=${schemaDir})`
			});
			return null;
		}
		try {
			return JSON.parse(text);
		} catch (cause) {
			errors.push({
				code: "SCHEMA_LOAD",
				file: path,
				message: `schema file is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
			});
			return null;
		}
	};
	const common = readJson(pjoin(schemaDir, "..", "common.schema.json"));
	if (common === null || typeof common.$id !== "string") {
		errors.push({
			code: "SCHEMA_LOAD",
			file: pjoin(schemaDir, "..", "common.schema.json"),
			message: "common.schema.json is missing or has no $id; no declarative schema can be validated"
		});
		return {
			validators,
			commonFailed: true
		};
	}
	try {
		ajv.addSchema(common, common.$id);
	} catch (cause) {
		errors.push({
			code: "SCHEMA_LOAD",
			file: pjoin(schemaDir, "..", "common.schema.json"),
			message: `common.schema.json rejected by validator engine: ${cause instanceof Error ? cause.message : String(cause)}`
		});
		return {
			validators,
			commonFailed: true
		};
	}
	for (const [type, file] of DECLARATIVE_SCHEMAS) {
		const path = pjoin(schemaDir, file);
		const schema = readJson(path);
		if (schema === null) continue;
		if (typeof schema.$id !== "string") {
			errors.push({
				code: "SCHEMA_LOAD",
				file: path,
				message: "schema has no $id; cannot register"
			});
			continue;
		}
		try {
			ajv.addSchema(schema, schema.$id);
			const validator = ajv.getSchema(schema.$id);
			if (validator === void 0) {
				errors.push({
					code: "SCHEMA_LOAD",
					file: path,
					message: `schema compile failed for $id ${schema.$id}`
				});
				continue;
			}
			validators.set(type, validator);
		} catch (cause) {
			errors.push({
				code: "SCHEMA_LOAD",
				file: path,
				message: `schema rejected by validator engine: ${cause instanceof Error ? cause.message : String(cause)}`
			});
		}
	}
	return {
		validators,
		commonFailed: false
	};
}
/** Compact digest of a violating value (truncated; never throws). */
function describeValue$1(value) {
	if (value === void 0) return void 0;
	let text;
	try {
		text = JSON.stringify(value);
	} catch {
		text = String(value);
	}
	if (text === void 0) return void 0;
	if (text.length > 80) text = `${text.slice(0, 77)}…`;
	return text;
}
/**
* Build the "违规内容摘要" for one AJV error (TC-DOM-027: file path + schema
* error path + violation summary). The instance path comes from
* `error.instancePath`; this message carries the keyword detail and the value.
*/
function schemaErrorSummary(error) {
	const base = error.message ?? `failed ${error.keyword}`;
	const got = describeValue$1(error.data);
	const params = error.params;
	switch (error.keyword) {
		case "additionalProperties": return `unexpected property "${typeof params.additionalProperty === "string" ? params.additionalProperty : "?"}"${got !== void 0 ? ` (value ${got})` : ""}`;
		case "enum": return `not an allowed value [${Array.isArray(params.allowedValues) ? params.allowedValues.map((v) => JSON.stringify(v)).join(" | ") : ""}]${got !== void 0 ? ` (got ${got})` : ""}`;
		case "const": return `must equal ${JSON.stringify(params.allowedValue)}${got !== void 0 ? ` (got ${got})` : ""}`;
		case "required": return `missing required property "${typeof params.missingProperty === "string" ? params.missingProperty : "?"}"`;
		case "format": return `invalid ${JSON.stringify(params.format)} value${got !== void 0 ? ` (got ${got})` : ""}`;
		case "pattern": return `does not match pattern ${JSON.stringify(params.pattern)}${got !== void 0 ? ` (got ${got})` : ""}`;
		default: return got !== void 0 ? `${base} (got ${got})` : base;
	}
}
//#endregion
//#region src/host/domain/loader/load.ts
/**
* WP-1.1 — `loadResearchTree`: the declarative `.research/` source-of-truth
* loader + validator (pure domain kernel, ARCHITECTURE §2.2 rule 1).
*
* Pipeline (two phases, error-aggregating per TC-DOM-027 / §16.1 / ARCH §10 —
* one broken file never blocks the rest):
*
*  phase 0  walk the §14 layout through the injected reader: structural
*           violations (UNKNOWN_ENTRY / PATH_RULE / MISSING_REQUIRED /
*           SCHEMA_VERSION) are reported as found; a slot list + directory
*           skeleton are collected in deterministic (sorted) order.
*  phase 1  per file: YAML parse → JSON Schema 2020-12 validation (frozen
*           schema/declarative/*.json) → path-id cross-checks (filename/dir
*           name vs in-file `id`/`project_id`/`topic_id`/`workstream`
*           fields, DOMAIN_SCHEMA §1.1 rule 3, §2.2/§2.3/§3.1/§4.x, §14).
*           A failed file is rejected (its node stays `doc: null`) with
*           precise `file + path + summary` errors.
*  phase 2  §16.1 declarative→declarative reference integrity over the
*           phase-1 accepted set: plan.ordered_items existence/WS-ownership/
*           duplicates, topic project_id match, objective refs, objective
*           topic_id/linked_refs, topology edge workstream membership
*           (INV-STRUCT-2), TE/item/OBJ id uniqueness, merge-contract edge
*           existence. Failures reject the REFERRING file (no cascade loop:
*           phase 2 runs once over the phase-1 accepted set).
*
* In-memory carriers follow DOMAIN_SCHEMA §1.2: ISO 8601 UTC strings from the
* YAML files are converted to epoch-ms integers at this boundary, and schema
* defaults (§14.1 工程默认) are materialized by the validator.
*/
const TOP_LEVEL_FILES = /* @__PURE__ */ new Set([
	"schema-version",
	"project.yaml",
	"objectives.yaml",
	"workspace.yaml"
]);
const TOP_LEVEL_DIRS = /* @__PURE__ */ new Set([
	"topics",
	"merges",
	"policies"
]);
/**
* V2 (design §3.1/§3.3): the STANDALONE state area — the runtime home of
* the project database (`state/research.sqlite`). 状态区，不入声明树语义:
* the walk RECOGNIZES it as a known entry (no UNKNOWN_ENTRY) but never
* DESCENDS into it — it is outside the declarative layout (and outside
* the checkpoint commit scope — the git whitelist excludes it).
*/
const TOP_LEVEL_STATE_DIR = "state";
function loadResearchTree(reader, root, schemaDir) {
	const errors = [];
	const schemas = loadSchemas(reader, schemaDir, errors);
	let rootEntries;
	try {
		rootEntries = reader.readDir(root);
	} catch (cause) {
		errors.push({
			code: "READ",
			file: "",
			message: `read of research root failed: ${cause instanceof Error ? cause.message : String(cause)}`
		});
		return emptyResult(errors);
	}
	if (rootEntries === null) {
		errors.push({
			code: "MISSING_REQUIRED",
			file: "",
			message: "research root directory does not exist (DOMAIN_SCHEMA §14)"
		});
		return emptyResult(errors);
	}
	const walk = walkLayout(reader, root, errors);
	const accepted = /* @__PURE__ */ new Map();
	const contracts = /* @__PURE__ */ new Map();
	for (const slot of walk.slots) {
		const abs = pjoin(root, slot.relPath);
		if (slot.kind === "contract") {
			let text;
			try {
				text = reader.readFile(abs);
			} catch (cause) {
				errors.push({
					code: "READ",
					file: slot.relPath,
					message: ioError(cause)
				});
				continue;
			}
			if (text === null) {
				errors.push({
					code: "MISSING_REQUIRED",
					file: slot.relPath,
					message: requiredMissing(slot.relPath)
				});
				continue;
			}
			contracts.set(slot.relPath, text);
			continue;
		}
		const doc = readYamlDoc(reader, abs, slot.relPath, slot.required, errors);
		if (doc === null) continue;
		const converted = validateAndConvert(slot, doc, schemas, errors);
		if (converted === null) continue;
		if (!pathIdChecks(slot, converted, errors)) continue;
		accepted.set(slot.relPath, converted);
	}
	const rejected = /* @__PURE__ */ new Set();
	runReferenceChecks(walk, accepted, contracts, errors, rejected);
	return {
		tree: assembleTree(walk, accepted, rejected, contracts),
		errors
	};
}
function emptyResult(errors) {
	return {
		tree: {
			schemaVersion: null,
			project: null,
			objectives: [],
			workspace: null,
			policy: null,
			topics: [],
			mergeContracts: []
		},
		errors
	};
}
function ioError(cause) {
	return `read failed: ${cause instanceof Error ? cause.message : String(cause)}`;
}
function requiredMissing(relPath) {
	return `required file ${JSON.stringify(relPath)} is missing (DOMAIN_SCHEMA §14)`;
}
function walkLayout(reader, root, errors) {
	const slots = [];
	const topicIds = [];
	const wsIdsByTopic = /* @__PURE__ */ new Map();
	const wsIds = [];
	const contractRelPaths = [];
	const unknownEntry = (rel, detail) => {
		errors.push({
			code: "UNKNOWN_ENTRY",
			file: rel,
			message: `entry is not part of the .research layout (DOMAIN_SCHEMA §14)${detail ? `: ${detail}` : ""}`
		});
	};
	const listDir = (rel) => {
		let entries;
		try {
			entries = reader.readDir(pjoin(root, rel));
		} catch (cause) {
			errors.push({
				code: "READ",
				file: rel,
				message: ioError(cause)
			});
			return [];
		}
		if (entries === null) return [];
		return [...entries].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
	};
	let schemaVersion = null;
	let svText = null;
	try {
		svText = reader.readFile(pjoin(root, "schema-version"));
	} catch (cause) {
		errors.push({
			code: "READ",
			file: "schema-version",
			message: ioError(cause)
		});
	}
	if (svText === null) errors.push({
		code: "MISSING_REQUIRED",
		file: "schema-version",
		message: requiredMissing("schema-version")
	});
	else {
		const trimmed = svText.trim();
		if (!/^\d+$/.test(trimmed)) errors.push({
			code: "SCHEMA_VERSION",
			file: "schema-version",
			message: `schema-version is not a single-line integer (got ${JSON.stringify(trimmed.slice(0, 40))}) (DOMAIN_SCHEMA §14)`
		});
		else if (!Number.isSafeInteger(Number(trimmed))) errors.push({
			code: "SCHEMA_VERSION",
			file: "schema-version",
			message: `schema-version out of range: ${trimmed}`
		});
		else {
			schemaVersion = Number(trimmed);
			if (schemaVersion !== 1) errors.push({
				code: "SCHEMA_VERSION",
				file: "schema-version",
				message: `unsupported schema-version ${schemaVersion} (V1 loader expects 1; bump contract per DOMAIN_SCHEMA §1.1)`
			});
		}
	}
	const topLevelNames = /* @__PURE__ */ new Set();
	for (const entry of listDir("")) {
		topLevelNames.add(entry.name);
		if (TOP_LEVEL_FILES.has(entry.name)) {
			if (entry.kind !== "file") unknownEntry(entry.name, `expected a file, got a directory`);
			else if (entry.name !== "schema-version") {
				const kind = entry.name === "project.yaml" ? "project" : entry.name === "objectives.yaml" ? "objectives" : "workspace";
				slots.push({
					kind,
					relPath: entry.name,
					required: entry.name === "project.yaml"
				});
			}
		} else if (TOP_LEVEL_DIRS.has(entry.name)) {
			if (entry.kind !== "directory") unknownEntry(entry.name, `expected a directory, got a file`);
		} else if (entry.name === TOP_LEVEL_STATE_DIR) {
			if (entry.kind !== "directory") unknownEntry(entry.name, `expected a directory, got a file`);
		} else unknownEntry(entry.name);
	}
	if (!slots.some((s) => s.kind === "project") && !topLevelNames.has("project.yaml")) errors.push({
		code: "MISSING_REQUIRED",
		file: "project.yaml",
		message: requiredMissing("project.yaml")
	});
	for (const tEntry of listDir("topics")) {
		if (tEntry.kind === "file") {
			unknownEntry(`topics/${tEntry.name}`, "entries under topics/ must be directories");
			continue;
		}
		const t = tEntry.name;
		if (!idMatchesKind(t, "TOPIC")) {
			errors.push({
				code: "PATH_RULE",
				file: `topics/${t}`,
				message: `directory name ${JSON.stringify(t)} is not a TPC id (DOMAIN_SCHEMA §14)`
			});
			continue;
		}
		topicIds.push(t);
		const topicRel = `topics/${t}`;
		const topicEntries = listDir(topicRel);
		const byName = new Map(topicEntries.map((e) => [e.name, e]));
		const topicFile = byName.get("topic.yaml");
		if (topicFile === void 0 || topicFile.kind !== "file") errors.push({
			code: "MISSING_REQUIRED",
			file: `${topicRel}/topic.yaml`,
			message: requiredMissing(`${topicRel}/topic.yaml`)
		});
		else slots.push({
			kind: "topic",
			relPath: `${topicRel}/topic.yaml`,
			topicId: t,
			pathId: t,
			required: true
		});
		const topoFile = byName.get("topology.yaml");
		if (topoFile !== void 0) {
			if (topoFile.kind !== "file") unknownEntry(`${topicRel}/topology.yaml`, "expected a file");
			else slots.push({
				kind: "topology",
				relPath: `${topicRel}/topology.yaml`,
				topicId: t,
				required: false
			});
		}
		const wsEntry = byName.get("workstreams");
		if (wsEntry === void 0) wsIdsByTopic.set(t, []);
		else if (wsEntry.kind !== "directory") {
			unknownEntry(`${topicRel}/workstreams`, "expected a directory");
			wsIdsByTopic.set(t, []);
		} else {
			const tWsIds = [];
			for (const wEntry of listDir(`${topicRel}/workstreams`)) {
				if (wEntry.kind === "file") {
					unknownEntry(`${topicRel}/workstreams/${wEntry.name}`, "entries under workstreams/ must be directories");
					continue;
				}
				const w = wEntry.name;
				if (!idMatchesKind(w, "WORKSTREAM")) {
					errors.push({
						code: "PATH_RULE",
						file: `${topicRel}/workstreams/${w}`,
						message: `directory name ${JSON.stringify(w)} is not a WS id (DOMAIN_SCHEMA §14)`
					});
					continue;
				}
				tWsIds.push(w);
				wsIds.push(w);
				const wsRel = `${topicRel}/workstreams/${w}`;
				const wsEntries = listDir(wsRel);
				const wsByName = new Map(wsEntries.map((e) => [e.name, e]));
				const wsFile = wsByName.get("workstream.yaml");
				if (wsFile === void 0 || wsFile.kind !== "file") errors.push({
					code: "MISSING_REQUIRED",
					file: `${wsRel}/workstream.yaml`,
					message: requiredMissing(`${wsRel}/workstream.yaml`)
				});
				else slots.push({
					kind: "workstream",
					relPath: `${wsRel}/workstream.yaml`,
					topicId: t,
					wsId: w,
					pathId: w,
					required: true
				});
				const planFile = wsByName.get("plan.yaml");
				if (planFile !== void 0) {
					if (planFile.kind !== "file") unknownEntry(`${wsRel}/plan.yaml`, "expected a file");
					else slots.push({
						kind: "plan",
						relPath: `${wsRel}/plan.yaml`,
						topicId: t,
						wsId: w,
						required: false
					});
				}
				const itemsEntry = wsByName.get("items");
				if (itemsEntry !== void 0) {
					if (itemsEntry.kind !== "directory") unknownEntry(`${wsRel}/items`, "expected a directory");
					else walkItemsDir(wsRel, t, w, slots, errors, listDir, unknownEntry);
				}
				for (const [name, e] of wsByName) {
					if (name === "workstream.yaml" || name === "plan.yaml" || name === "items") continue;
					unknownEntry(`${wsRel}/${name}`);
				}
			}
			wsIdsByTopic.set(t, tWsIds);
		}
		for (const [name, e] of byName) {
			if (name === "topic.yaml" || name === "topology.yaml" || name === "workstreams") continue;
			unknownEntry(`${topicRel}/${name}`);
		}
	}
	for (const mEntry of listDir("merges")) {
		if (mEntry.kind === "file") {
			unknownEntry(`merges/${mEntry.name}`, "entries under merges/ must be directories");
			continue;
		}
		const te = mEntry.name;
		if (!idMatchesKind(te, "TOPOLOGY_EDGE")) {
			errors.push({
				code: "PATH_RULE",
				file: `merges/${te}`,
				message: `directory name ${JSON.stringify(te)} is not a TE id (DOMAIN_SCHEMA §14/§3.2)`
			});
			continue;
		}
		const rel = `merges/${te}`;
		const byName = new Map(listDir(rel).map((e) => [e.name, e]));
		const contract = byName.get("contract.md");
		if (contract === void 0 || contract.kind !== "file") errors.push({
			code: "MISSING_REQUIRED",
			file: `${rel}/contract.md`,
			message: requiredMissing(`${rel}/contract.md`)
		});
		else {
			slots.push({
				kind: "contract",
				relPath: `${rel}/contract.md`,
				pathId: te,
				required: true
			});
			contractRelPaths.push(`${rel}/contract.md`);
		}
		for (const name of byName.keys()) if (name !== "contract.md") unknownEntry(`${rel}/${name}`);
	}
	for (const pEntry of listDir("policies")) {
		if (pEntry.kind !== "file") {
			unknownEntry(`policies/${pEntry.name}`, "entries under policies/ must be files");
			continue;
		}
		if (pEntry.name === "agent-plan-fork.yaml") slots.push({
			kind: "policy",
			relPath: "policies/agent-plan-fork.yaml",
			required: false
		});
		else unknownEntry(`policies/${pEntry.name}`);
	}
	return {
		slots,
		topicIds,
		wsIdsByTopic,
		wsIds,
		contractRelPaths,
		schemaVersion
	};
}
const ITEM_DIR_PREFIX = {
	tasks: {
		kind: "task",
		prefix: "T",
		pattern: /^T-[1-9][0-9]*\.yaml$/
	},
	gates: {
		kind: "gate",
		prefix: "G",
		pattern: /^G-[1-9][0-9]*\.yaml$/
	},
	milestones: {
		kind: "milestone",
		prefix: "M",
		pattern: /^M-[1-9][0-9]*\.yaml$/
	}
};
function walkItemsDir(wsRel, topicId, wsId, slots, errors, listDir, unknownEntry) {
	for (const iEntry of listDir(`${wsRel}/items`)) {
		if (iEntry.kind === "file") {
			unknownEntry(`${wsRel}/items/${iEntry.name}`, "items/ contains only tasks/, gates/, milestones/ directories");
			continue;
		}
		const spec = iEntry.name === "tasks" || iEntry.name === "gates" || iEntry.name === "milestones" ? ITEM_DIR_PREFIX[iEntry.name] : void 0;
		if (spec === void 0) {
			unknownEntry(`${wsRel}/items/${iEntry.name}`, "items/ contains only tasks/, gates/, milestones/ directories");
			continue;
		}
		for (const fEntry of listDir(`${wsRel}/items/${iEntry.name}`)) {
			const fileRel = `${wsRel}/items/${iEntry.name}/${fEntry.name}`;
			if (fEntry.kind !== "file") {
				unknownEntry(fileRel);
				continue;
			}
			if (!spec.pattern.test(fEntry.name)) {
				errors.push({
					code: "PATH_RULE",
					file: fileRel,
					message: `file name ${JSON.stringify(fEntry.name)} is not named "<${spec.prefix}-id>.yaml" (DOMAIN_SCHEMA §14)`
				});
				continue;
			}
			slots.push({
				kind: spec.kind,
				relPath: fileRel,
				topicId,
				wsId,
				pathId: fEntry.name.slice(0, -5),
				required: false
			});
		}
	}
}
/**
* Read + parse one YAML document file. Returns the parsed mapping, or null
* with an aggregated error (PARSE / READ / MISSING_REQUIRED). A top-level
* non-mapping is reported as SCHEMA (the frozen schemas are all
* `type: "object"` at the root).
*/
function readYamlDoc(reader, abs, rel, required, errors) {
	let text;
	try {
		text = reader.readFile(abs);
	} catch (cause) {
		errors.push({
			code: "READ",
			file: rel,
			message: ioError(cause)
		});
		return null;
	}
	if (text === null) {
		if (required) errors.push({
			code: "MISSING_REQUIRED",
			file: rel,
			message: requiredMissing(rel)
		});
		return null;
	}
	let docs;
	try {
		docs = parseAllDocuments(text);
	} catch (cause) {
		errors.push({
			code: "PARSE",
			file: rel,
			message: `YAML parse failed: ${cause instanceof Error ? cause.message : String(cause)}`
		});
		return null;
	}
	const substantive = docs.filter((d) => d.errors.length > 0 || d.contents !== null && d.contents !== void 0);
	if (substantive.length === 0) {
		errors.push({
			code: "PARSE",
			file: rel,
			message: "empty or comment-only YAML file (expected a mapping)"
		});
		return null;
	}
	if (substantive.length > 1) {
		errors.push({
			code: "PARSE",
			file: rel,
			message: `multiple YAML documents (${substantive.length}); expected exactly one (DOMAIN_SCHEMA §14)`
		});
		return null;
	}
	const doc = substantive[0];
	if (doc.errors.length > 0) {
		for (const e of doc.errors) {
			const first = e.linePos?.[0];
			const shortMsg = e.message.split("\n")[0];
			const where = first ? ` (line ${first.line}, col ${first.col})` : "";
			errors.push({
				code: "PARSE",
				file: rel,
				message: `YAML: ${shortMsg}${where}`
			});
		}
		return null;
	}
	let value;
	try {
		value = doc.toJS();
	} catch (cause) {
		errors.push({
			code: "PARSE",
			file: rel,
			message: `YAML parse failed: ${cause instanceof Error ? cause.message : String(cause)}`
		});
		return null;
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		const what = value === null ? "null" : Array.isArray(value) ? "sequence" : typeof value;
		errors.push({
			code: "SCHEMA",
			file: rel,
			message: `top-level YAML document must be a mapping (got ${what})`
		});
		return null;
	}
	return value;
}
/**
* Validate one parsed doc against its frozen schema and convert time fields
* to epoch ms (§1.2). Returns the converted doc, or null (error recorded).
* On success, schema defaults (§14.1 工程默认) are materialized in place by
* the validator (ajv useDefaults).
*/
function validateAndConvert(slot, doc, schemas, errors) {
	const validator = schemas.validators.get(schemaTypeOf(slot.kind));
	if (validator === void 0) {
		errors.push({
			code: "SCHEMA_UNAVAILABLE",
			file: slot.relPath,
			message: `no compiled validator for ${schemaTypeOf(slot.kind)} (see SCHEMA_LOAD errors under schemaDir)`
		});
		return null;
	}
	if (!validator(doc)) {
		for (const err of validator.errors ?? []) errors.push({
			code: "SCHEMA",
			file: slot.relPath,
			path: err.instancePath === "" ? void 0 : err.instancePath,
			message: schemaErrorSummary(err)
		});
		return null;
	}
	return convertTimes(slot, doc, errors);
}
function schemaTypeOf(kind) {
	switch (kind) {
		case "project": return "project";
		case "topic": return "topic";
		case "workstream": return "workstream";
		case "topology": return "topology";
		case "plan": return "plan";
		case "task": return "task";
		case "gate": return "gate";
		case "milestone": return "milestone";
		case "objectives": return "objectives";
		case "workspace": return "workspace";
		case "policy": return "agent-plan-fork-policy";
		default: throw new Error(`contract slot has no schema: ${kind}`);
	}
}
/**
* DOMAIN_SCHEMA §1.2: the loader serialization boundary converts the YAML
* time carrier (ISO 8601 UTC string) into the memory carrier (epoch ms).
* Only schema-validated time fields are touched (explicit list, no guessing).
*/
function convertTimes(slot, doc, errors) {
	const out = { ...doc };
	const convert = (field) => {
		const raw = out[field];
		if (raw === void 0) return;
		if (typeof raw !== "string") return;
		const ms = Date.parse(raw);
		if (!Number.isFinite(ms)) {
			errors.push({
				code: "PARSE",
				file: slot.relPath,
				path: `/${field}`,
				message: `timestamp ${JSON.stringify(raw)} cannot be converted to epoch ms (internal invariant)`
			});
			throw new ConversionFailed();
		}
		out[field] = ms;
	};
	try {
		if (slot.kind === "project" || slot.kind === "topic" || slot.kind === "workstream" || slot.kind === "task" || slot.kind === "gate" || slot.kind === "milestone") convert("created_at");
		if (slot.kind === "project") convert("target_date");
		if (slot.kind === "objectives") {
			const list = out.objectives;
			if (Array.isArray(list)) {
				const convertedList = [];
				for (const [i, item] of list.entries()) if (item !== null && typeof item === "object") {
					const obj = { ...item };
					const o = obj;
					if (typeof o.created_at === "string") {
						const ms = Date.parse(o.created_at);
						if (!Number.isFinite(ms)) throw new ConversionFailed();
						o.created_at = ms;
					}
					if (typeof o.target_date === "string") {
						const ms = Date.parse(o.target_date);
						if (!Number.isFinite(ms)) throw new ConversionFailed();
						o.target_date = ms;
					}
					convertedList.push(obj);
				} else convertedList.push(item);
				out.objectives = convertedList;
			}
		}
	} catch (e) {
		if (e instanceof ConversionFailed) return null;
		throw e;
	}
	return out;
}
var ConversionFailed = class extends Error {
	constructor() {
		super("conversion failed");
	}
};
/**
* Path-id cross-checks (DOMAIN_SCHEMA §1.1 rule 3 "加载期发现文件名与 id 不一致
* 即报错", §14 rule, per-object path rules in §2.2/§2.3/§3.1/§4.1-4.4).
* Runs AFTER schema validation, so all checked fields exist and are strings.
*/
function pathIdChecks(slot, doc, errors) {
	const rel = slot.relPath;
	const base = rel.slice(rel.lastIndexOf("/") + 1);
	const fail = (path, message) => {
		errors.push({
			code: "PATH_ID_MISMATCH",
			file: rel,
			path,
			message
		});
		return false;
	};
	switch (slot.kind) {
		case "topic": {
			const d = doc;
			return d.id === slot.pathId ? true : fail(void 0, `id ${JSON.stringify(d.id)} does not match directory name ${JSON.stringify(slot.pathId)} (DOMAIN_SCHEMA §2.2)`);
		}
		case "workstream": {
			const d = doc;
			if (d.id !== slot.pathId) return fail(void 0, `id ${JSON.stringify(d.id)} does not match directory name ${JSON.stringify(slot.pathId)} (DOMAIN_SCHEMA §2.3)`);
			return d.topic_id === slot.topicId ? true : fail("/topic_id", `topic_id ${JSON.stringify(d.topic_id)} does not match containing topic directory ${JSON.stringify(slot.topicId)} (INV-STRUCT-1)`);
		}
		case "plan": {
			const d = doc;
			return d.workstream === slot.wsId ? true : fail("/workstream", `workstream ${JSON.stringify(d.workstream)} does not match containing workstream directory ${JSON.stringify(slot.wsId)} (DOMAIN_SCHEMA §4.4)`);
		}
		case "task":
		case "gate":
		case "milestone": {
			const d = doc;
			if (d.id !== slot.pathId) return fail(void 0, `id ${JSON.stringify(d.id)} does not match file name ${JSON.stringify(base)} (DOMAIN_SCHEMA §4.1/§4.2/§4.3)`);
			return d.workstream_id === slot.wsId ? true : fail("/workstream_id", `workstream_id ${JSON.stringify(d.workstream_id)} does not match containing workstream directory ${JSON.stringify(slot.wsId)} (DOMAIN_SCHEMA §4.1/§4.2/§4.3)`);
		}
		case "topology": {
			const d = doc;
			if (d.topology.topic_id !== slot.topicId) return fail("/topology/topic_id", `topology.topic_id ${JSON.stringify(d.topology.topic_id)} does not match containing topic directory ${JSON.stringify(slot.topicId)} (DOMAIN_SCHEMA §3.1)`);
			for (let i = 0; i < d.topology.edges.length; i++) {
				const edge = d.topology.edges[i];
				if (edge.topic_id !== slot.topicId) return fail(`/topology/edges/${i}/topic_id`, `edges[${i}].topic_id ${JSON.stringify(edge.topic_id)} does not match containing topic directory ${JSON.stringify(slot.topicId)} (DOMAIN_SCHEMA §3.1)`);
			}
			return true;
		}
		default: return true;
	}
}
function runReferenceChecks(walk, accepted, contracts, errors, rejected) {
	const reject = (file, path, message, code = "DANGLING_REF") => {
		errors.push({
			code,
			file,
			path,
			message
		});
		rejected.add(file);
	};
	const projectDoc = accepted.get("project.yaml");
	const objectivesFile = accepted.get("objectives.yaml");
	const topicDirs = new Set(walk.topicIds);
	const wsDirSet = new Set(walk.wsIds);
	const wsDirsByTopic = walk.wsIdsByTopic;
	const topicDocs = [];
	const wsDocs = [];
	const edgeLocs = [];
	const itemLocs = [];
	for (const [rel, value] of accepted) if (rel.endsWith("/topic.yaml")) {
		const topicId = rel.split("/")[1];
		topicDocs.push({
			topicId,
			file: rel,
			doc: value
		});
	} else if (rel.endsWith("/workstream.yaml")) {
		const parts = rel.split("/");
		wsDocs.push({
			wsId: parts[3],
			topicId: parts[1],
			file: rel,
			doc: value
		});
	} else if (rel.endsWith("/topology.yaml")) {
		const topicId = rel.split("/")[1];
		value.topology.edges.forEach((edge, index) => edgeLocs.push({
			topicId,
			file: rel,
			index,
			edge
		}));
	} else if (/\/items\/(tasks|gates|milestones)\//.test(rel)) {
		const m = rel.match(/\/items\/(tasks|gates|milestones)\//);
		const parts = rel.split("/");
		const kind = m[1] === "tasks" ? "task" : m[1] === "gates" ? "gate" : "milestone";
		const id = rel.slice(rel.lastIndexOf("/") + 1, -5);
		itemLocs.push({
			kind,
			id,
			wsId: parts[3],
			file: rel
		});
	}
	const itemById = /* @__PURE__ */ new Map();
	for (const loc of itemLocs) if (!itemById.has(loc.id)) itemById.set(loc.id, loc);
	const edgeById = /* @__PURE__ */ new Map();
	for (const loc of edgeLocs) if (!edgeById.has(loc.edge.id)) edgeById.set(loc.edge.id, loc);
	const objectiveIds = new Set(objectivesFile?.objectives.map((o) => o.id) ?? []);
	if (objectivesFile !== void 0) {
		const seen = /* @__PURE__ */ new Map();
		objectivesFile.objectives.forEach((o, i) => {
			const first = seen.get(o.id);
			if (first !== void 0) reject("objectives.yaml", `/objectives/${i}/id`, `duplicate Objective id ${JSON.stringify(o.id)} (first defined at objectives[${first}]) (DOMAIN_SCHEMA §9.1/§1.1)`, "DUPLICATE_ID");
			else seen.set(o.id, i);
		});
		objectivesFile.objectives.forEach((o, i) => {
			if (o.scope === "TOPIC" && o.topic_id !== void 0 && !topicDirs.has(o.topic_id)) reject("objectives.yaml", `/objectives/${i}/topic_id`, `objectives[${i}].topic_id ${JSON.stringify(o.topic_id)} does not exist (DOMAIN_SCHEMA §9.1/§16.1)`);
			o.linked_refs.forEach((lr, j) => {
				if (!(lr.kind === "WORKSTREAM" ? wsDirSet.has(lr.id) : itemById.get(lr.id)?.kind === (lr.kind === "GATE" ? "gate" : "milestone"))) reject("objectives.yaml", `/objectives/${i}/linked_refs/${j}`, `objectives[${i}].linked_refs[${j}] { kind: ${lr.kind}, id: ${JSON.stringify(lr.id)} } does not exist (DOMAIN_SCHEMA §9.1/§16.1)`);
			});
		});
	}
	if (projectDoc !== void 0) projectDoc.current_objective_refs.forEach((ref, i) => {
		if (!objectiveIds.has(ref)) reject("project.yaml", `/current_objective_refs/${i}`, `current_objective_refs[${i}] ${JSON.stringify(ref)} does not exist in objectives.yaml (DOMAIN_SCHEMA §2.1/§16.1)`);
	});
	for (const { topicId, file, doc } of topicDocs) {
		if (projectDoc === void 0) reject(file, "/project_id", `project_id ${JSON.stringify(doc.project_id)} does not match any loaded Project (project.yaml missing or rejected) (DOMAIN_SCHEMA §2.2/§16.1)`);
		else if (doc.project_id !== projectDoc.id) reject(file, "/project_id", `project_id ${JSON.stringify(doc.project_id)} does not match loaded project id ${JSON.stringify(projectDoc.id)} (DOMAIN_SCHEMA §2.2/§16.1)`);
		doc.objective_refs.forEach((ref, i) => {
			if (!objectiveIds.has(ref)) reject(file, `/objective_refs/${i}`, `objective_refs[${i}] ${JSON.stringify(ref)} does not exist in objectives.yaml (DOMAIN_SCHEMA §2.2/§16.1)`);
		});
	}
	for (const { topicId, file, doc } of wsDocs) {
		if (doc.origin_topology_edge_ref === void 0) continue;
		const loc = edgeById.get(doc.origin_topology_edge_ref);
		if (loc === void 0 || loc.topicId !== topicId) reject(file, "/origin_topology_edge_ref", `origin_topology_edge_ref ${JSON.stringify(doc.origin_topology_edge_ref)} is not an edge of topic ${JSON.stringify(topicId)} (DOMAIN_SCHEMA §2.3/§16.1)`);
	}
	for (const loc of edgeLocs) {
		const first = edgeById.get(loc.edge.id);
		if (first !== void 0 && first !== loc) reject(loc.file, `/topology/edges/${loc.index}/id`, `topology edge id ${JSON.stringify(loc.edge.id)} is already defined in ${JSON.stringify(first.file)} (DOMAIN_SCHEMA §3.1/§1.1)`, "DUPLICATE_ID");
		const topicWs = wsDirsByTopic.get(loc.topicId) ?? [];
		loc.edge.inputs.forEach((ws, j) => {
			if (!topicWs.includes(ws)) reject(loc.file, `/topology/edges/${loc.index}/inputs/${j}`, `inputs[${j}] ${JSON.stringify(ws)} is not a workstream of topic ${JSON.stringify(loc.topicId)} (INV-STRUCT-2/§16.1)`);
		});
		loc.edge.outputs.forEach((ws, j) => {
			if (!topicWs.includes(ws)) reject(loc.file, `/topology/edges/${loc.index}/outputs/${j}`, `outputs[${j}] ${JSON.stringify(ws)} is not a workstream of topic ${JSON.stringify(loc.topicId)} (INV-STRUCT-2/§16.1)`);
		});
	}
	for (const [rel, value] of accepted) {
		if (!rel.endsWith("/plan.yaml")) continue;
		const doc = value;
		const wsId = doc.workstream;
		const seen = /* @__PURE__ */ new Set();
		doc.ordered_items.forEach((id, i) => {
			if (seen.has(id)) {
				reject(rel, `/ordered_items/${i}`, `duplicate item ${JSON.stringify(id)} in ordered_items (DOMAIN_SCHEMA §4.4)`, "DUPLICATE_ID");
				return;
			}
			seen.add(id);
			const loc = itemById.get(id);
			if (loc === void 0) reject(rel, `/ordered_items/${i}`, `ordered_items[${i}] ${JSON.stringify(id)} has no definition file in workstream ${JSON.stringify(wsId)} (DOMAIN_SCHEMA §4.4/§16.1)`);
			else if (loc.wsId !== wsId) reject(rel, `/ordered_items/${i}`, `ordered_items[${i}] ${JSON.stringify(id)} is defined in workstream ${JSON.stringify(loc.wsId)}, not in ${JSON.stringify(wsId)} (DOMAIN_SCHEMA §4.4/§16.1)`);
		});
	}
	const itemFirst = /* @__PURE__ */ new Map();
	for (const loc of itemLocs) {
		const first = itemFirst.get(loc.id);
		if (first !== void 0 && first !== loc.file) reject(loc.file, void 0, `item id ${JSON.stringify(loc.id)} is already defined in ${JSON.stringify(first)} (DOMAIN_SCHEMA §4.1/§4.2/§4.3/§1.1)`, "DUPLICATE_ID");
		else if (first === void 0) itemFirst.set(loc.id, loc.file);
	}
	for (const rel of walk.contractRelPaths) {
		if (!contracts.has(rel)) continue;
		const teId = rel.split("/")[1];
		if (!edgeById.has(teId)) reject(rel, void 0, `merge contract for ${JSON.stringify(teId)} references a topology edge that does not exist in any topic (DOMAIN_SCHEMA §3.2/§16.1)`);
	}
}
function assembleTree(walk, accepted, rejected, contracts) {
	const isLoaded = (rel) => accepted.has(rel) && !rejected.has(rel);
	const topics = walk.topicIds.map((t) => {
		const topicRel = `topics/${t}`;
		const topicSlots = walk.slots.filter((s) => s.topicId === t);
		const wsNodes = (walk.wsIdsByTopic.get(t) ?? []).map((w) => {
			const wsRel = `${topicRel}/workstreams/${w}`;
			return {
				id: w,
				topicId: t,
				path: wsRel,
				doc: isLoaded(`${wsRel}/workstream.yaml`) ? accepted.get(`${wsRel}/workstream.yaml`) : null,
				plan: isLoaded(`${wsRel}/plan.yaml`) ? accepted.get(`${wsRel}/plan.yaml`) : null,
				tasks: itemNodes(topicSlots, accepted, rejected, w, "task"),
				gates: itemNodes(topicSlots, accepted, rejected, w, "gate"),
				milestones: itemNodes(topicSlots, accepted, rejected, w, "milestone")
			};
		});
		return {
			id: t,
			path: topicRel,
			doc: isLoaded(`${topicRel}/topic.yaml`) ? accepted.get(`${topicRel}/topic.yaml`) : null,
			topology: isLoaded(`${topicRel}/topology.yaml`) ? accepted.get(`${topicRel}/topology.yaml`) : null,
			workstreams: wsNodes
		};
	});
	const mergeContracts = walk.contractRelPaths.filter((rel) => contracts.has(rel) && !rejected.has(rel)).map((rel) => ({
		edgeId: rel.split("/")[1],
		path: rel,
		content: contracts.get(rel)
	}));
	return {
		schemaVersion: walk.schemaVersion,
		project: isLoaded("project.yaml") ? accepted.get("project.yaml") : null,
		objectives: isLoaded("objectives.yaml") ? accepted.get("objectives.yaml").objectives : [],
		workspace: isLoaded("workspace.yaml") ? accepted.get("workspace.yaml") : null,
		policy: isLoaded("policies/agent-plan-fork.yaml") ? accepted.get("policies/agent-plan-fork.yaml") : null,
		topics,
		mergeContracts
	};
}
/** Item nodes for one workstream: one slot per discovered item file (walk
*  order), `doc: null` when the file was missing or rejected. */
function itemNodes(topicSlots, accepted, rejected, wsId, kind) {
	return topicSlots.filter((s) => s.kind === kind && s.wsId === wsId).map((s) => ({
		id: s.pathId,
		doc: accepted.has(s.relPath) && !rejected.has(s.relPath) ? accepted.get(s.relPath) : null
	}));
}
//#endregion
//#region src/host/persistence/hardening/errors.ts
var HardeningError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.name = new.target.name;
		this.code = code;
	}
};
/**
* `assertStartup` over a report whose outcome is `fatal` (an unrecoverable
* finding: SQLite corruption, an unsupported/stale schema version, a broken
* frozen-schema set, a missing research root or project.yaml, a
* project-id scope mismatch). The error carries the FULL report so the
* `[Service.init]` caller can surface every finding + the user guidance
* (never a bare string).
*/
var HardeningFatalError = class extends HardeningError {
	report;
	constructor(message, report, options) {
		super("HARDENING_FATAL", message, options);
		this.report = report;
	}
};
//#endregion
//#region src/host/persistence/hardening/startup.ts
/**
* WP-8.1 — hardening: the startup integrity orchestrator (crash
* recovery 面).
*
* `runStartupIntegrityChecks` runs the four checks at `[Service.init]`
* time and returns the aggregated {@link StartupIntegrityReport}:
*
*   1. the operational DB — `checkDatabase` (quick_check + user_version
*      + structure, riding on the store's own open path, TC-DB-002);
*   2. the `.research/` tree — the WP-1.1 loader (error-aggregated,
*      TC-DOM-027) classified by `classifyTreeLoad` (ARCHITECTURE §10:
*      broken file rejected with file+field location, the rest load);
*   3. the Git workspace — `checkGitWorkspace` (§5.1 conflict detection
*      + TC-GIT-001 dirty semantics + §10 git-missing/not-a-repo row);
*   4. the dual-真源 consistency SPOT check — `checkDualTruthConsistency`
*      (only when the DB is open and the tree is not fatal; otherwise
*      SKIPPED with the reason stated — never silent).
*
* AGGREGATION, NOT SHORT-CIRCUIT: every check that CAN run is run — one
* broken 真源 must not mask the state of the others (the §10 SQLite
* corruption row demands the report ASSERT the declarative 真源's state
* explicitly, which needs the tree/git results even when the DB is dead).
*
* Outcome aggregation (see {@link StartupOutcome}):
*   - any `unrecoverable` finding (or a fatal tree) → `fatal`;
*   - else any `recoverable` finding (or a degraded tree) → `degraded`;
*   - else `ok`.
*
* Surface narrowing on `degraded`:
*   - `readSurface: 'readonly'` — ONLY when the `.research` tree is
*     partially broken (the write surface must not commit or mutate a
*     partially broken 真源); git conflict/missing states do NOT make
*     the surface read-only (the declarative files are intact — they
*     narrow `checkpointAllowed` / `managedMode` individually);
*   - `checkpointAllowed` — refused by: refused managed mode (git
*     missing / not a repo / git erroring), conflict-in-progress
*     (INV-GIT-4, explicit refusal), a broken tree; a DIRTY working tree
*     does NOT refuse it (TC-GIT-001: the checkpoint commits only
*     `.research/**` and leaves unrelated dirty state untouched);
*   - `managedMode: 'refused'` — per the §10 row, with the explicit
*     「Initialize Git Repository」 entry / install-Git guidance.
*
* LOUDNESS (绝不静默): every non-pass finding produces (a) guidance
* items in the report (the user-facing remedy), (b) a structured log
* entry (warn for recoverable, error for unrecoverable/skipped), (c)
* for `fatal`, `assertStartup` throws `HardeningFatalError` carrying
* the FULL report (the dsh-adapter's fiber-FAILED path, TC-DSH-008).
*
* The DB handle opened by check 1 is closed in a `finally` — even when
* a later check throws — so a failed startup leaks no connection.
*
* No DSH imports (INV-PERM-5). This is the composition the dsh-adapter's
* `[Service.init]` runs BEFORE `createHostWiring` (a `fatal` report
* fails the init; a `degraded` report is logged + the surface flags
* honored; the wiring's own startup reconciliations then run loud and
* converge the `recoverable` findings this pass only DETECTS).
*/
/**
* Run the four startup integrity checks and aggregate the report.
*
* Resolves with a report for EVERY input state (ok / degraded / fatal);
* it only throws `HardeningError` (HARDENING_INPUT) for malformed input.
* Call {@link assertStartup} on the result to turn `fatal` into a throw.
*/
async function runStartupIntegrityChecks(input) {
	const dbPath = requireAbs(input.dbPath, "dbPath");
	const repoRoot = requireAbs(input.repoRoot, "repoRoot");
	const researchRoot = requireAbs(input.researchRoot, "researchRoot");
	const schemaDir = requireAbs(input.schemaDir, "schemaDir");
	if (typeof input.projectId !== "string" || !/^PRJ-\d+$/.test(input.projectId)) throw new HardeningError("HARDENING_INPUT", `projectId must be a well-formed PRJ-<n> id (got ${JSON.stringify(input.projectId ?? null)})`);
	if (input.reader === null || typeof input.reader !== "object" || typeof input.reader.readDir !== "function" || typeof input.reader.readFile !== "function") throw new HardeningError("HARDENING_INPUT", "reader must be a ResearchFileReader (readDir + readFile)");
	const researchDir = input.researchDir ?? ".research";
	if (typeof researchDir !== "string" || researchDir.length === 0 || researchDir.includes("/")) throw new HardeningError("HARDENING_INPUT", `researchDir must be a bare directory name (got ${JSON.stringify(researchDir ?? null)})`);
	const logger = input.logger;
	const dbOutcome = checkDatabase(dbPath);
	const db = dbOutcome.result;
	logCheck(logger, "db", db.status, db.message);
	let tree;
	try {
		tree = classifyTreeLoad(loadResearchTree(input.reader, researchRoot, schemaDir));
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		tree = {
			status: "unrecoverable",
			usable: false,
			load: {
				tree: emptyTree$1(),
				errors: []
			},
			fatalErrors: [{
				code: "READ",
				file: "",
				message: `loader threw unexpectedly (bug — fail loud): ${msg}`
			}],
			degradedErrors: [],
			guidance: [`the .research loader threw unexpectedly instead of aggregating errors (loader bug): ${msg}`]
		};
	}
	logCheck(logger, "tree", tree.status, treeMessage(tree));
	const git = await checkGitWorkspace(repoRoot, {
		ops: input.git,
		researchDir
	});
	logCheck(logger, "git", git.status, git.message);
	const consistency = runConsistencyCheck$1({
		handle: dbOutcome.handle,
		tree,
		input
	});
	logCheck(logger, "consistency", consistency.status, consistency.message);
	const extraGuidance = [];
	if (db.status === "unrecoverable" && db.code === "STORE_CORRUPT") {
		const treeState = tree.status === "pass" ? "the .research tree loaded clean" : `the .research tree check itself found problems (${tree.status})`;
		const gitState = git.status === "pass" ? "the Git workspace check passed" : `the Git workspace check itself found problems (${git.status})`;
		extraGuidance.push(tree.status === "pass" && git.status === "pass" ? `intactness assertion (ARCHITECTURE §10): the declarative 真源 is INTACT — ${treeState}; ${gitState} (the corrupted database is a separate file, INV-DB-3)` : `intactness note (ARCHITECTURE §10): the corrupted database is a separate file (INV-DB-3), but the declarative 真源 is NOT clean either — ${treeState}; ${gitState} (both sides need attention; the operational data loss stands)`);
	}
	const guidance = [];
	if (db.status !== "pass") for (const g of db.guidance) guidance.push(`[db] ${g}`);
	if (tree.status !== "pass") for (const g of tree.guidance) guidance.push(`[tree] ${g}`);
	if (git.status !== "pass") for (const g of git.guidance) guidance.push(`[git] ${g}`);
	if (consistency.status !== "pass") for (const g of consistency.guidance) guidance.push(`[consistency] ${g}`);
	for (const g of extraGuidance) guidance.push(`[db] ${g}`);
	const outcome = db.status === "unrecoverable" || tree.status === "unrecoverable" || git.status === "unrecoverable" || consistency.status === "unrecoverable" ? "fatal" : tree.status === "recoverable" || git.status === "recoverable" || consistency.status === "recoverable" ? "degraded" : "ok";
	const readSurface = tree.status === "recoverable" ? "readonly" : "ok";
	const managedMode = git.managedMode;
	const checkpointAllowed = managedMode === "ok" && !git.conflictInProgress && tree.status !== "recoverable" && tree.status !== "unrecoverable";
	const summary = makeSummary(outcome, {
		db,
		tree,
		git,
		consistency
	});
	logger?.info("startup-integrity", summary);
	return {
		outcome,
		db,
		tree,
		git,
		consistency,
		readSurface,
		managedMode,
		checkpointAllowed,
		guidance,
		summary,
		projectId: input.projectId,
		dbPath,
		researchRoot
	};
}
/** `assertStartup`: the fail-loud gate (TC-DSH-008 fiber-FAILED). */
function assertStartup(report) {
	if (report.outcome !== "fatal") return;
	throw new HardeningFatalError(`startup integrity check FAILED (unrecoverable): ${report.summary}`, report);
}
function runConsistencyCheck$1(args) {
	const { handle, tree, input } = args;
	try {
		if (handle === null) return skipped$1("the operational database is unavailable (the db check failed — see its findings; the consistency probe needs an open store)");
		if (tree.status === "unrecoverable") return skipped$1("the .research tree is unusable (the tree check found a fatal breakage — there is no declarative side to cross-check)");
		return checkDualTruthConsistency({
			store: handle,
			tree: tree.load.tree,
			projectId: input.projectId,
			maxSample: input.maxConsistencySample
		});
	} finally {
		if (handle !== null) try {
			handle.close();
		} catch {}
	}
}
function skipped$1(reason) {
	return {
		status: "skipped",
		checked: [],
		findings: [],
		projectIdChecked: false,
		skipReason: reason,
		message: `skipped: ${reason}`,
		guidance: []
	};
}
function treeMessage(tree) {
	if (tree.status === "pass") return "the .research tree loaded clean (no load errors)";
	if (tree.status === "unrecoverable") return `the .research tree is unusable (${String(tree.fatalErrors.length)} fatal error(s))`;
	return `the .research tree loaded with ${String(tree.degradedErrors.length)} broken file(s) — readonly usable surface (ARCHITECTURE §10)`;
}
function makeSummary(outcome, checks) {
	const parts = [];
	parts.push(checks.db.status === "pass" ? `db V${checks.db.userVersion === void 0 ? "?" : String(checks.db.userVersion)} ok` : `db ${checks.db.status}${checks.db.code ? ` (${checks.db.code})` : ""}`);
	parts.push(checks.tree.status === "pass" ? "tree clean" : checks.tree.status === "unrecoverable" ? `tree unusable (${String(checks.tree.fatalErrors.length)} fatal error(s))` : `tree degraded (${String(checks.tree.degradedErrors.length)} broken file(s))`);
	parts.push(checks.git.status === "pass" ? `git ${checks.git.dirty ? "dirty (reads + checkpoint ok, TC-GIT-001)" : "clean"}` : `git ${checks.git.status}${checks.git.reason ? ` (${checks.git.reason})` : ""}`);
	parts.push(checks.consistency.status === "pass" ? `consistency ok (${String(checks.consistency.checked.length)} ws probed)` : checks.consistency.status === "skipped" ? "consistency skipped" : `consistency ${checks.consistency.status} (${String(checks.consistency.findings.length)} finding(s))`);
	return `startup integrity: ${outcome} — ${parts.join("; ")}`;
}
function logCheck(logger, check, status, message) {
	if (logger === void 0) return;
	const line = `${check}: ${status} — ${message}`;
	if (status === "pass") logger.info(check, line);
	else if (status === "unrecoverable") logger.error(check, line);
	else logger.warn(check, line);
}
function emptyTree$1() {
	return {
		schemaVersion: null,
		project: null,
		objectives: [],
		workspace: null,
		policy: null,
		topics: [],
		mergeContracts: []
	};
}
function requireAbs(value, name) {
	if (typeof value !== "string" || value.length === 0 || !value.startsWith("/")) throw new HardeningError("HARDENING_INPUT", `${name} must be an absolute path (got ${JSON.stringify(value ?? null)})`);
	return value;
}
//#endregion
//#region src/host/domain/planfork/types.ts
/** The 4 frozen actor kinds (actorRef.kind). */
const ACTOR_KINDS$1 = [
	"USER",
	"AGENT",
	"PLUGIN",
	"SYSTEM"
];
/** All 4 states, canonical order (frozen schema enum order). */
const PF_STATUSES = [
	"OPEN",
	"SELECTED",
	"DISMISSED",
	"STALE"
];
/** All 5 frozen trigger kinds (schema default allowed_kinds 全集). */
const PLAN_FORK_TRIGGER_KINDS$1 = [
	"CLAIM",
	"FACT",
	"ARTIFACT",
	"MILESTONE",
	"OBJECTIVE"
];
/**
* One precisely-located PlanFork violation (ARCHITECTURE §10: 错误信息指明
* 失败项 — code + 失败步骤 (creation path) + 位置摘要, no guess-repair).
* Mutating operations throw the FIRST violated check before any write.
*/
var PlanForkError = class extends Error {
	code;
	/** The failed §4 step (creation-path errors only; undefined for store/transition errors). */
	step;
	/** JSON-pointer-style location inside the input/record (e.g. `/proposed_items/2/ref`). */
	path;
	constructor(init) {
		super(init.message, init.cause === void 0 ? void 0 : { cause: init.cause });
		this.name = "PlanForkError";
		this.code = init.code;
		this.step = init.step;
		this.path = init.path;
	}
};
//#endregion
//#region src/host/domain/planfork/schemas.ts
/**
* WP-3.1 — frozen operational plan-fork schema loading (loader pattern).
*
* Loads the FROZEN `schema/operational/plan-fork.schema.json` (+ its parent
* `common.schema.json` for the `planItemId`/`typedRef`/`actorRef`/
* `epochMs`/$id refs) through the injected `ResearchFileReader` (the kernel
* performs no I/O; same pattern as WP-2.5 `loadSemanticSchemas` and WP-1.1
* `loadSchemas`):
*
*   - per-part validators come straight from the frozen document via
*     `ajv.getSchema($id + '#/$defs/<Name>')` — NO derived schemas, no
*     mutation of `schema/` (frozen, read-only);
*   - failures AGGREGATE (loadErrors; `isUsable` false ⇒ every check
*     reports unavailable — the creation chain fails loud with
*     PF_SCHEMA_UNAVAILABLE, never validates against nothing);
*   - AJV 2020-12 (the frozen `$schema` dialect), allErrors + verbose
*     (precise multi-error location, TC-DOM-027 style), useDefaults off
*     (the operational record has NO schema defaults — every field is
*     explicit in the row).
*
* Consumers:
*   - create.ts step 4 — `checkNewItemSpec(kind, spec)` (NEW.spec 过对应
*     item schema 校验, PLAN_FORK_SPEC §4 步骤 4 原文);
*   - store.ts — `checkRecordShape(record)` (构造出的记录过整行冻结
*     $defs/PlanFork — 类型面同构的运行时网);
*   - tests/planfork/model.test.ts — 模型往返 (schema 同构) 断言面。
*/
/** kind → frozen $defs name (plan-fork.schema.json $defs, 逐字). */
const SPEC_DEF_BY_KIND = {
	TASK: "NewItemSpecTask",
	GATE: "NewItemSpecGate",
	MILESTONE: "NewItemSpecMilestone"
};
/**
* Load + compile the frozen plan-fork operational schema. Aggregates
* failures, never throws (loader pattern).
*/
function loadPlanForkSchemas(reader, schemaDir) {
	const errors = [];
	const ajv = new Ajv2020({
		allErrors: true,
		strict: false,
		verbose: true
	});
	addFormats(ajv);
	const readJson = (path) => {
		let text;
		try {
			text = reader.readFile(path);
		} catch (cause) {
			errors.push({
				path,
				message: `schema file read failed: ${cause instanceof Error ? cause.message : String(cause)}`
			});
			return null;
		}
		if (text === null) {
			errors.push({
				path,
				message: `schema file not found (schemaDir=${schemaDir})`
			});
			return null;
		}
		try {
			return JSON.parse(text);
		} catch (cause) {
			errors.push({
				path,
				message: `schema file is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
			});
			return null;
		}
	};
	const common = readJson(pjoin(schemaDir, "..", "common.schema.json"));
	if (common === null || typeof common.$id !== "string") {
		errors.push({
			path: pjoin(schemaDir, "..", "common.schema.json"),
			message: "common.schema.json is missing or has no $id"
		});
		return unavailableSchemas(schemaDir, errors);
	}
	try {
		ajv.addSchema(common, common.$id);
	} catch (cause) {
		errors.push({
			path: pjoin(schemaDir, "..", "common.schema.json"),
			message: `common.schema.json rejected: ${cause instanceof Error ? cause.message : String(cause)}`
		});
		return unavailableSchemas(schemaDir, errors);
	}
	const doc = readJson(pjoin(schemaDir, "plan-fork.schema.json"));
	if (doc === null || typeof doc.$id !== "string") {
		errors.push({
			path: pjoin(schemaDir, "plan-fork.schema.json"),
			message: "plan-fork.schema.json is missing or has no $id"
		});
		return unavailableSchemas(schemaDir, errors);
	}
	try {
		ajv.addSchema(doc, doc.$id);
	} catch (cause) {
		errors.push({
			path: pjoin(schemaDir, "plan-fork.schema.json"),
			message: `plan-fork.schema.json rejected: ${cause instanceof Error ? cause.message : String(cause)}`
		});
		return unavailableSchemas(schemaDir, errors);
	}
	const getValidator = (def) => {
		const validator = ajv.getSchema(`${doc.$id}#/$defs/${def}`);
		if (validator === void 0) errors.push({
			path: pjoin(schemaDir, "plan-fork.schema.json"),
			message: `schema compile failed for $defs/${def}`
		});
		return validator;
	};
	const recordValidator = getValidator("PlanFork");
	const proposedItemValidator = getValidator("ProposedItem");
	const taskSpecValidator = getValidator("NewItemSpecTask");
	const gateSpecValidator = getValidator("NewItemSpecGate");
	const milestoneSpecValidator = getValidator("NewItemSpecMilestone");
	const baseObjectValidator = getValidator("BasePlanObject");
	if (errors.length > 0 || recordValidator === void 0 || proposedItemValidator === void 0 || taskSpecValidator === void 0 || gateSpecValidator === void 0 || milestoneSpecValidator === void 0 || baseObjectValidator === void 0) return unavailableSchemas(schemaDir, errors);
	const specValidatorFor = (kind) => {
		SPEC_DEF_BY_KIND[kind];
		return kind === "TASK" ? taskSpecValidator : kind === "GATE" ? gateSpecValidator : milestoneSpecValidator;
	};
	return {
		schemaDir,
		isUsable: true,
		loadErrors: [],
		checkRecordShape: (record) => runCheck$3(recordValidator, record),
		checkProposedItem: (item) => runCheck$3(proposedItemValidator, item),
		checkNewItemSpec: (kind, spec) => runCheck$3(specValidatorFor(kind), spec),
		checkBasePlanObjects: (objects) => {
			if (!Array.isArray(objects) || objects.length === 0) return {
				ok: false,
				errors: [{
					path: "/base_plan_objects",
					message: `base_plan_objects must be a non-empty array (frozen minItems 1)`
				}]
			};
			const errorsOut = [];
			for (let i = 0; i < objects.length; i++) if (!baseObjectValidator(objects[i])) for (const err of baseObjectValidator.errors ?? []) errorsOut.push({
				path: `/base_plan_objects/${i}${err.instancePath}`,
				message: schemaErrorSummary(err)
			});
			return errorsOut.length === 0 ? {
				ok: true,
				errors: []
			} : {
				ok: false,
				errors: errorsOut
			};
		}
	};
}
function mapErrors$3(validator) {
	return (validator.errors ?? []).map((err) => ({
		path: err.instancePath,
		message: schemaErrorSummary(err)
	}));
}
function runCheck$3(validator, value) {
	if (validator(value)) return {
		ok: true,
		errors: []
	};
	return {
		ok: false,
		errors: mapErrors$3(validator)
	};
}
function unavailableSchemas(schemaDir, errors) {
	const unavailable = {
		ok: false,
		errors: [{
			path: "",
			message: `plan-fork schema set unavailable — see PlanForkSchemas.loadErrors`
		}]
	};
	return {
		schemaDir,
		isUsable: false,
		loadErrors: errors,
		checkRecordShape: () => unavailable,
		checkProposedItem: () => unavailable,
		checkNewItemSpec: () => unavailable,
		checkBasePlanObjects: () => unavailable
	};
}
//#endregion
//#region src/host/domain/planfork/policy.ts
/**
* WP-3.1 — AgentPlanForkPolicy (PLAN_FORK_SPEC §9): load, defaults, checks.
*
* Frozen contracts (read-only):
*  - PLAN_FORK_SPEC §9 — `.research/policies/agent-plan-fork.yaml` 文档
*    (enabled / anchors.{allow_boundary_sentinels, required_item_types} /
*    flooding.threshold / triggers.{require_at_least_one, allowed_kinds})
*    + 默认值语义 (schema `default`: enabled=true, sentinels=true,
*    required_item_types=[], threshold=5, require_at_least_one=true,
*    allowed_kinds=全部 5 种);
*  - schema/declarative/agent-plan-fork-policy.schema.json (冻结, 经 WP-1.1
*    `loadSchemas` 原样编译 — 单一编译路径, 零 schema 改写);
*  - DOMAIN_SCHEMA §14 (布局: `policies/agent-plan-fork.yaml`; 所有 YAML 经
*    冻结 schema 校验, 失败即拒绝并精确定位) + §16.1 (policy 文件为可选
*    slot — WP-1.1 loader 以 `required: false` 装载: **文件缺失 = 全默认
*    policy**, 非错误)。
*
* 消费点 (PLAN_FORK_SPEC §4 创建八步):
*   - step 1 — `enabled = true` (本文件 `assertPolicyEnabled`);
*   - step 5 — anchor 约束 (`applyAnchorPolicy`: 哨兵开关 + required_item_types);
*   - step 6 — trigger 约束 (`applyTriggerPolicy`: allowed_kinds 子集 +
*     require_at_least_one);
*   - flooding.threshold — WP-3.5 消费 (本 WP 只装载 + 校验, 不做 flooding)。
*
* Pure: YAML 读经注入 `ResearchFileReader`; 编译经 WP-1.1 `loadSchemas`。
*/
/** The §9 default policy (schema defaults materialized; 文件缺失即此值). */
const DEFAULT_AGENT_PLAN_FORK_POLICY = {
	enabled: true,
	anchors: {
		allow_boundary_sentinels: true,
		required_item_types: []
	},
	flooding: { threshold: 5 },
	triggers: {
		require_at_least_one: true,
		allowed_kinds: [...PLAN_FORK_TRIGGER_KINDS$1]
	}
};
/** The policy file's `.research`-relative path (DOMAIN_SCHEMA §14). */
const POLICY_REL_PATH = "policies/agent-plan-fork.yaml";
/**
* Load + validate `.research/policies/agent-plan-fork.yaml`.
*
*  - file ABSENT ⇒ `{ policy: DEFAULT_AGENT_PLAN_FORK_POLICY, defaulted: true }`
*    (DOMAIN_SCHEMA §14: policy 为可选 slot; §9 defaults 即工程默认);
*  - file PRESENT ⇒ single-YAML-document parse (loader 同款语义: 空文件 /
*    多文档 / 非 mapping ⇒ PF_POLICY_INVALID) + 冻结 schema 校验
*    (`loadSchemas` 编译, useDefaults 物化默认) — 逐错误精确定位 (path)。
*  - policy schema 文件缺失/不可编译 ⇒ PF_POLICY_INVALID (fail loud,
*    绝不在无 schema 时放行)。
*/
function loadPlanForkPolicy(reader, researchRoot, schemaDir) {
	const loadErrors = [];
	const validator = loadSchemas(reader, schemaDir, loadErrors).validators.get("agent-plan-fork-policy");
	if (validator === void 0 || loadErrors.length > 0) {
		const first = loadErrors[0];
		return {
			policy: null,
			defaulted: false,
			errors: [new PlanForkError({
				code: "PF_POLICY_INVALID",
				path: first?.file,
				message: `agent-plan-fork policy schema unavailable${first ? `: ${first.message}` : ""} — no plan fork can be created until the frozen policy schema loads (schema/declarative/agent-plan-fork-policy.schema.json)`
			})]
		};
	}
	const abs = pjoin(researchRoot, POLICY_REL_PATH);
	let text;
	try {
		text = reader.readFile(abs);
	} catch (cause) {
		return {
			policy: null,
			defaulted: false,
			errors: [new PlanForkError({
				code: "PF_POLICY_INVALID",
				path: POLICY_REL_PATH,
				message: `policy file read failed: ${cause instanceof Error ? cause.message : String(cause)}`,
				cause
			})]
		};
	}
	if (text === null) return {
		policy: DEFAULT_AGENT_PLAN_FORK_POLICY,
		defaulted: true,
		errors: []
	};
	const errors = [];
	const carrier = parseSingleYamlDoc(POLICY_REL_PATH, text, errors);
	if (carrier === null) return {
		policy: null,
		defaulted: false,
		errors
	};
	const validated = { ...carrier };
	if (!validator(validated)) {
		for (const err of validator.errors ?? []) errors.push(new PlanForkError({
			code: "PF_POLICY_INVALID",
			path: err.instancePath === "" ? void 0 : err.instancePath,
			message: schemaErrorSummary(err)
		}));
		return {
			policy: null,
			defaulted: false,
			errors
		};
	}
	return {
		policy: normalizePolicy$1(validated),
		defaulted: false,
		errors: []
	};
}
/** Field-for-field normalization (validator-accepted shape → frozen policy type). */
function normalizePolicy$1(doc) {
	const d = DEFAULT_AGENT_PLAN_FORK_POLICY;
	const anchors = doc.anchors ?? {};
	const flooding = doc.flooding ?? {};
	const triggers = doc.triggers ?? {};
	return {
		enabled: doc.enabled,
		anchors: {
			allow_boundary_sentinels: anchors.allow_boundary_sentinels ?? d.anchors.allow_boundary_sentinels,
			required_item_types: anchors.required_item_types ?? d.anchors.required_item_types
		},
		flooding: { threshold: flooding.threshold ?? d.flooding.threshold },
		triggers: {
			require_at_least_one: triggers.require_at_least_one ?? d.triggers.require_at_least_one,
			allowed_kinds: triggers.allowed_kinds ?? d.triggers.allowed_kinds
		}
	};
}
/**
* §4 step 1 — `policy enabled = true`. Throws PF_POLICY_DISABLED (step 1)
* when the policy is disabled.
*/
function assertPolicyEnabled(policy) {
	if (!policy.enabled) throw new PlanForkError({
		code: "PF_POLICY_DISABLED",
		step: 1,
		path: "/enabled",
		message: "agent-plan-fork policy is disabled (enabled=false in " + POLICY_REL_PATH + ") — plan fork creation refused (PLAN_FORK_SPEC §4 步骤 1)"
	});
}
/**
* §4 step 5 — policy anchor constraints on an ALREADY-RESOLVED anchor pair
* (存在性/顺序 in anchors.ts; 本 gate 只做 policy 半边):
*   - a sentinel anchor requires `anchors.allow_boundary_sentinels = true`;
*   - a non-sentinel anchor whose item kind ∉ `anchors.required_item_types`
*     (non-empty) is refused (「required_item_types: 空 = 任意 item 可作
*     anchor；可设 [GATE]」— §9 原文).
* `anchorKind` is the id prefix kind of a non-sentinel anchor (TASK/GATE/
* MILESTONE) or null for sentinels.
*/
function applyAnchorPolicy(policy, name, anchor, isSentinel, anchorKind) {
	if (isSentinel && !policy.anchors.allow_boundary_sentinels) throw new PlanForkError({
		code: "PF_ANCHOR_POLICY",
		step: 5,
		path: `/${name}`,
		message: `anchor ${name}=${JSON.stringify(anchor)} is a boundary sentinel but policy anchors.allow_boundary_sentinels=false (${POLICY_REL_PATH}) — sentinel anchors refused (PLAN_FORK_SPEC §4 步骤 5/§9)`
	});
	if (!isSentinel && policy.anchors.required_item_types.length > 0 && anchorKind !== null) {
		if (!policy.anchors.required_item_types.includes(anchorKind)) throw new PlanForkError({
			code: "PF_ANCHOR_POLICY",
			step: 5,
			path: `/${name}`,
			message: `anchor ${name}=${JSON.stringify(anchor)} (kind ${anchorKind}) violates policy anchors.required_item_types=[${policy.anchors.required_item_types.join(", ")}] (${POLICY_REL_PATH}) — only the listed item kinds may serve as anchors (PLAN_FORK_SPEC §4 步骤 5/§9)`
		});
	}
}
/**
* §4 step 6 — policy trigger constraints (the per-ref 存在性 is step 6's
* resolver half, in create.ts):
*   - `triggers.require_at_least_one = true` with an empty `trigger_refs`
*     ⇒ PF_TRIGGERS_EMPTY;
*   - a ref kind ∉ `triggers.allowed_kinds` ⇒ PF_TRIGGER_KIND_FORBIDDEN.
*/
function applyTriggerPolicy(policy, triggerRefs) {
	if (policy.triggers.require_at_least_one && triggerRefs.length === 0) throw new PlanForkError({
		code: "PF_TRIGGERS_EMPTY",
		step: 6,
		path: "/trigger_refs",
		message: "policy triggers.require_at_least_one=true but trigger_refs is empty — at least one existing trigger ref is required (PLAN_FORK_SPEC §4 步骤 6/§9)"
	});
	for (let i = 0; i < triggerRefs.length; i++) {
		const kind = triggerRefs[i].kind;
		if (!policy.triggers.allowed_kinds.includes(kind)) throw new PlanForkError({
			code: "PF_TRIGGER_KIND_FORBIDDEN",
			step: 6,
			path: `/trigger_refs/${i}/kind`,
			message: `trigger_refs[${i}].kind=${JSON.stringify(kind)} is not in policy triggers.allowed_kinds=[${policy.triggers.allowed_kinds.join(", ")}] (${POLICY_REL_PATH}) (PLAN_FORK_SPEC §4 步骤 6/§9)`
		});
	}
}
function parseSingleYamlDoc(rel, text, errors) {
	let docs;
	try {
		docs = parseAllDocuments(text);
	} catch (cause) {
		errors.push(new PlanForkError({
			code: "PF_POLICY_INVALID",
			path: rel,
			message: `YAML parse failed: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause
		}));
		return null;
	}
	const substantive = docs.filter((d) => d.errors.length > 0 || d.contents !== null && d.contents !== void 0);
	if (substantive.length === 0) {
		errors.push(new PlanForkError({
			code: "PF_POLICY_INVALID",
			path: rel,
			message: "empty or comment-only YAML file (expected a mapping)"
		}));
		return null;
	}
	if (substantive.length > 1) {
		errors.push(new PlanForkError({
			code: "PF_POLICY_INVALID",
			path: rel,
			message: `multiple YAML documents (${substantive.length}); expected exactly one`
		}));
		return null;
	}
	const doc = substantive[0];
	if (doc.errors.length > 0) {
		for (const e of doc.errors) {
			const first = e.linePos?.[0];
			const shortMsg = e.message.split("\n")[0];
			const where = first ? ` (line ${first.line}, col ${first.col})` : "";
			errors.push(new PlanForkError({
				code: "PF_POLICY_INVALID",
				path: rel,
				message: `YAML: ${shortMsg}${where}`
			}));
		}
		return null;
	}
	let value;
	try {
		value = doc.toJS();
	} catch (cause) {
		errors.push(new PlanForkError({
			code: "PF_POLICY_INVALID",
			path: rel,
			message: `YAML parse failed: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause
		}));
		return null;
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		const what = value === null ? "null" : Array.isArray(value) ? "sequence" : typeof value;
		errors.push(new PlanForkError({
			code: "PF_POLICY_INVALID",
			path: rel,
			message: `top-level YAML document must be a mapping (got ${what})`
		}));
		return null;
	}
	return value;
}
//#endregion
//#region src/host/domain/planfork/anchors.ts
/**
* WP-3.1 — anchor semantics + plan closure (PLAN_FORK_SPEC §2.2/§3.1) and
* the three change forms derived from the §2.1 original text.
*
* Frozen contracts (read-only):
*  - PLAN_FORK_SPEC §2.2 (anchor 语义, 原文):
*      · `fork_anchor` — canonical 中**保留**的最后一个分叉点;
*      · `merge_anchor` — proposal **重新接入** canonical 的汇合点;
*      · 替换区间为**开区间** `(fork_anchor, merge_anchor)`: 两个 anchor
*        本身保留在 canonical 中, 区间内的 canonical items 被
*        `proposed_items` 替换 (可增删改);
*      · 边界哨兵 `__START__` (计划起点之前) / `__END__` (计划终点之后),
*        是否允许由 policy 控制;
*      · 校验: anchor 若非哨兵, 必须是当前 canonical `ordered_items` 中
*        存在的 id, 且 fork 序号 ≤ merge 序号 (**相等 = 纯插入**);
*  - PLAN_FORK_SPEC §3.1 (Plan closure: `plan.yaml` ∪ ordered_items 每个
*    item 的定义文件 — 相对 workspace 根的路径集合; V1 默认保存整个当前
*    closure 而非仅 anchor 区间, 消除区间裁剪歧义);
*  - DOMAIN_SCHEMA §4.4 (plan 元素类型 = T/G/M id — 闭包路径推导的 kind 依据).
*
* ## 三种变更形态 (INSERT/MOVE/DELETE) 的原文表达 (types.ts 头注同文)
*
* §2.1 原文只给了两种 ProposedItem 形态 (KEEP / NEW); 三种变更形态从
* 替换区间语义机械派生 (`derivePlanForkChanges`):
*   - INSERT  = `NEW` 项 (物化于 SELECT 时获得正式 ID — 本 WP 不物化);
*   - MOVE    = `KEEP` 项且物化后位置 ≠ canonical 位置 (区间重排);
*   - DELETE  = 开区间 (fork, merge) 内未被 KEEP 引用的 canonical 项
*     (omission = removal; 定义文件保留 — INV-PLAN-9).
* 物化后的位置按 §6.3 的拼接形状计算: `prefix(含 fork) + proposed +
* suffix(含 merge)`, 纯插入特例 `prefix(含 X) + proposed + suffix(X 之后)`
* (§6.3 公式). 注意: 本函数只**分类变更形态并给出位置**, 不计算/返回
* new_plan 本身 — new_plan 物化 (正式 ID 分配 + 文件写入 + plan.yaml 重写)
* 是 §6.3 SELECT 流程, 属 WP-3.4 (本 WP 边界, create.ts 头注同文)。
*
* Pure: zero I/O, zero schema imports (canonical 顺序由调用方现读后经
* `CanonicalPlanView.ordered_items` 传入 — INV-PLAN-1 逐字顺序)。
*/
/** True iff `anchor` is one of the two §2.2 sentinels (exact string match). */
function isBoundarySentinel(anchor) {
	return anchor === "__START__" || anchor === "__END__";
}
/**
* The ordinal of an anchor in the canonical sequence:
*   - `__START__` → `-1` (计划起点之前);
*   - `__END__`   → `orderedItems.length` (计划终点之后);
*   - item id     → its 0-based index in `orderedItems`;
*   - anything else (unknown id) → `null`.
*/
function anchorOrdinal(anchor, orderedItems) {
	if (anchor === "__START__") return -1;
	if (anchor === "__END__") return orderedItems.length;
	const i = orderedItems.indexOf(anchor);
	return i === -1 ? null : i;
}
/** A short, precise summary of the canonical order for error messages. */
function canonicalSummary(orderedItems) {
	if (orderedItems.length === 0) return "[]";
	return orderedItems.length > 8 ? `[${orderedItems.slice(0, 4).join(", ")}, …, ${orderedItems.slice(-2).join(", ")}] (${orderedItems.length} items)` : `[${orderedItems.join(", ")}]`;
}
function resolveAnchors(forkAnchor, mergeAnchor, orderedItems) {
	const forkIndex = anchorOrdinal(forkAnchor, orderedItems);
	if (forkIndex === null) throw new PlanForkError({
		code: "PF_ANCHOR_MISSING",
		step: 5,
		path: "/fork_anchor",
		message: `fork_anchor=${JSON.stringify(forkAnchor)} is neither a boundary sentinel (__START__/__END__) nor an id present in the current canonical ordered_items (${canonicalSummary(orderedItems)}) (PLAN_FORK_SPEC §2.2/§4 步骤 5)`
	});
	const mergeIndex = anchorOrdinal(mergeAnchor, orderedItems);
	if (mergeIndex === null) throw new PlanForkError({
		code: "PF_ANCHOR_MISSING",
		step: 5,
		path: "/merge_anchor",
		message: `merge_anchor=${JSON.stringify(mergeAnchor)} is neither a boundary sentinel (__START__/__END__) nor an id present in the current canonical ordered_items (${canonicalSummary(orderedItems)}) (PLAN_FORK_SPEC §2.2/§4 步骤 5)`
	});
	if (forkIndex > mergeIndex) throw new PlanForkError({
		code: "PF_ANCHOR_ORDER",
		step: 5,
		path: "/merge_anchor",
		message: `anchor order illegal: fork_anchor=${JSON.stringify(forkAnchor)} (ordinal ${forkIndex}) is after merge_anchor=${JSON.stringify(mergeAnchor)} (ordinal ${mergeIndex}) — §2.2 requires fork 序号 ≤ merge 序号 (相等 = 纯插入) (PLAN_FORK_SPEC §4 步骤 5)`
	});
	return {
		forkAnchor,
		mergeAnchor,
		forkIndex,
		mergeIndex,
		pureInsertion: forkIndex === mergeIndex
	};
}
/** The item kind of a non-sentinel anchor id (null when the id is not a well-formed T/G/M id). */
function anchorItemKind(anchor) {
	const parsed = parseId(anchor);
	if (parsed === null) return null;
	return parsed.kind === "TASK" || parsed.kind === "GATE" || parsed.kind === "MILESTONE" ? parsed.kind : null;
}
/** The `items/<dir>` subdirectory per item kind (DOMAIN_SCHEMA §14 布局). */
const KIND_TO_DIR$2 = {
	TASK: "tasks",
	GATE: "gates",
	MILESTONE: "milestones"
};
/**
* The §3.1 plan closure, `.research`-relative POSIX paths, in the STABLE
* order this module produces bases with (PLAN_FORK_SPEC §3.1/§3.2):
*
*   1. `<wsDir>/plan.yaml`
*   2. one definition file per `ordered_items` element, CANONICAL ORDER
*      (`<wsDir>/items/<tasks|gates|milestones>/<id>.yaml`)
*
* V1 默认保存整个当前 closure (非仅 anchor 区间 — §3.1 末行). 调用方必须
* 传入 step 2 校验通过的 canonical 顺序 (全部 T/G/M 且定义文件存在);
* 一个非 T/G/M 的元素是上游校验失效 — fail loud (PF_INPUT)。
*
* `wsDir` = the `.research`-relative workstream directory
* (`topics/<TPC>/workstreams/<WS>`, CanonicalPlanView.wsDir)。
*/
function closureRelativePaths(wsDir, orderedItems) {
	const normalized = wsDir.endsWith("/") ? wsDir.slice(0, -1) : wsDir;
	const paths = [`${normalized}/plan.yaml`];
	for (const id of orderedItems) {
		const parsed = parseId(id);
		if (parsed === null || parsed.kind !== "TASK" && parsed.kind !== "GATE" && parsed.kind !== "MILESTONE") throw new PlanForkError({
			code: "PF_INPUT",
			message: `closure computation: canonical ordered_items element ${JSON.stringify(id)} is not a well-formed T/G/M id — the step-2 canonical consistency check must have passed first (DOMAIN_SCHEMA §4.4)`
		});
		paths.push(`${normalized}/items/${KIND_TO_DIR$2[parsed.kind]}/${id}.yaml`);
	}
	return paths;
}
//#endregion
//#region src/host/domain/planfork/state-machine.ts
/**
* WP-3.1 — PlanFork state machine (PLAN_FORK_SPEC §10, 原文转换表):
*
*   ```text
*              ┌────────────┐  SELECT(用户)  ┌──────────┐
*     创建 ──> │    OPEN    │ ────────────> │ SELECTED │（终态）
*              └─┬───────┬──┘               └──────────┘
*        基准失效│       │ DISMISS(用户)
*              ┌▼───────▼──┐ DISMISS(用户) ┌──────────┘
*              │   STALE   │ ───────────> │ DISMISSED │（终态）
*              └───────────┘
*   ```
*
* 转换表 (冻结语义, 逐条):
*   - OPEN    → SELECTED | DISMISSED | STALE
*   - STALE   → DISMISSED
*   - SELECTED / DISMISSED → 终态 (无出边)
*   - 自环 (S → S) 非法 (表中未列)。
*
* 「全部状态迁移 append-only 记录, PF 行永不删除」(§10): 每次迁移在
* store.transition 中 ① 乐观条件更新行内 status 缓存列 (WHERE status=from)
* ② 同事务 append 一条 ManagementAction (action_kind 映射见
* `TRANSITION_ACTION_KIND`)。catalog 核查: HISTORY_EVENT_CATALOG §4 无
* PLAN_FORK_* 事件 ⇒ PF 迁移**不产 ResearchHistory 事件** (管理操作,
* §4/§6.6/§7 口径), 账本 = operational `management_action` 表。
*
* 各迁移的调用方 (本 WP 交付状态机 + 字段面 + 乐观门; 触发逻辑归后续 WP):
*   - OPEN → STALE:      §5 stale 检测 (基准失真) + §6.5 同基准连锁失效
*                        (「superseded by PF-<id> selection」) — WP-3.2/3.4;
*   - OPEN → SELECTED:   §6 SELECT 物化 (前置 PF.status == OPEN) — WP-3.4;
*   - OPEN → DISMISSED / STALE → DISMISSED: §7 DISMISS (用户) — WP-3.4。
*
* Invariant mapping (ARCHITECTURE §5.4):
*  - INV-PLAN-7 (SELECT 后 PF=SELECTED、同基准 OPEN PF=STALE、DISMISS 只改
*    状态不删除): 本表 SELECTED 边 + OPEN→STALE 边 + 存储层 no-DELETE
*    trigger (schema.ts) — 「只改状态不删除」由状态缓存列 UPDATE 表达;
*  - INV-PLAN-8 (基准被修改后旧基准 PF 判 STALE): OPEN→STALE 边 +
*    stale_reason 字段面 (stale 判定算法本身 = WP-3.2);
*  - INV-PLAN-4 (PF 不可修改/删除): 内容字段不可变 trigger + 无 delete API。
*
* Pure data + pure guards (zero I/O, 同 WP-2.5 semantics state-machine
* 模式): `checkPfTransition` throws `PlanForkError` (PF_WRONG_STATE) on
* illegal pairs — 守卫消息点名当前态、目标态、合法集 (terminal 明示)。
*/
/**
* The frozen §10 legal-transition table (key = from → legal tos; 终态 → []).
* 逐字对照 §10 ASCII 图 (SELECT=用户、DISMISS=用户、基准失效=插件懒检测/
* 加载后检测 — 发射者语义见各迁移调用方 WP; 本 WP 的 transition API 对
* actor 只做冻结 actorRef 形状校验, 不重述权限矩阵 — 权限门在工具面
* WP-3.3/3.4 的 actor 类型面 + 运行时门)。
*/
const PF_TRANSITIONS = {
	OPEN: [
		"SELECTED",
		"DISMISSED",
		"STALE"
	],
	STALE: ["DISMISSED"],
	SELECTED: [],
	DISMISSED: []
};
/** The legal target states of `from` (`[]` = terminal). */
function legalPfTargets(from) {
	return PF_TRANSITIONS[from] ?? [];
}
/**
* Guard one transition. Throws `PlanForkError` (PF_WRONG_STATE) when `to`
* is not legal for `from` — the message names the PF id, the CURRENT
* state, the TARGET, and the LEGAL SET (「terminal」 when empty), per
* ARCHITECTURE §10 错误定位纪律.
*/
function checkPfTransition(pfId, from, to) {
	const legal = legalPfTargets(from);
	if (!legal.includes(to)) {
		const suffix = legal.length === 0 ? ` (${from} 是终态, 无出边)` : ` (legal from ${from}: ${legal.join(" | ")})`;
		throw new PlanForkError({
			code: "PF_WRONG_STATE",
			message: `plan fork ${JSON.stringify(pfId)} is ${from}; transition to ${to} is not in the §10 legal table` + suffix + ` (PLAN_FORK_SPEC §10; ARCHITECTURE §5.4 INV-PLAN-7)`
		});
	}
}
/** The ManagementAction action_kind each transition appends (§4/§5/§6/§7 原文). */
const TRANSITION_ACTION_KIND = {
	SELECTED: "PF_SELECTED",
	DISMISSED: "PF_DISMISSED",
	STALE: "PF_STALE_MARKED"
};
/** True iff `value` is one of the 4 frozen states (runtime gate on stored rows). */
function isPfStatus(value) {
	return typeof value === "string" && PF_STATUSES.includes(value);
}
//#endregion
//#region src/host/domain/planfork/create.ts
/**
* WP-3.1 — PlanFork 创建校验: PLAN_FORK_SPEC §4 八步, 原文逐步实现的
* 纯函数链 + 编排器。
*
* 输入 (§4 原文, 逐字): `workstream_id`, `fork_anchor`, `merge_anchor`,
* `proposed_items[]`, `trigger_refs[]`, `reason`, `necessity` (+ 调用上下
* 文中的 actor/run = `createdByRun`)。**无 base 参数** (INV-PLAN-6:
* 「不接受客户端提交 base — INV-PLAN-6 的结构性保证」) — 类型面
* (`CreatePlanForkParams` 无 base 键) + 运行时冻结输入面守卫
* (`assertFrozenInputSurface`, 对 JS 调用者绕过类型也拒绝未知键, 点名
* INV-PLAN-6) 双保险; tests/planfork/inv-plan-6.test.ts 双钉。
*
* 校验顺序 (§4 原文: 「任一失败即拒绝, 错误信息指明失败项」):
*   1. policy `enabled = true`;
*   2. `workstream_id` 存在且 canonical plan 已加载;
*   3. **基准由服务端重算**: 当前 closure 的 blob OID 集合 (注入
*      `ClosureBlobCapturer` — production = git 层 hash-object,
*      GIT_INTEGRATION §7);
*   4. `proposed_items` 非空有序; `KEEP.ref` 必须存在于当前 canonical
*      (anchor 哨兵策略校验同 §2.2 — 见步骤 5); `NEW.spec` 通过对应
*      item schema 校验 (冻结 $defs/NewItemSpec<kind>);
*   5. anchor 合法 (§2.2: 哨兵或 canonical 存在的 id + fork 序号 ≤ merge
*      序号, 相等 = 纯插入) 且满足 policy 的 anchor 约束
*      (allow_boundary_sentinels / required_item_types);
*   6. `trigger_refs` ≥1 (policy require_at_least_one) 且全部存在
*      (注入 `TriggerRefResolver`), kind ∈ policy 允许集合 (默认
*      CLAIM/FACT/ARTIFACT/MILESTONE/OBJECTIVE);
*   7. `reason`, `necessity` 非空;
*   8. `created_by_run` 存在且**属于该 workstream** (formal run,
*      DOMAIN_SCHEMA §6.1 绑定 — 注入 `FormalRunLookup`)。
*
* **new_plan 不在本 WP 计算** (任务边界 + §4 原文核查): §4 八步中**没有**
* new_plan 预演步骤 — new_plan 的拼接公式是 §6.3 SELECT 物化流程的公式
* (属 WP-3.4: 正式 ID 分配 + 定义文件原子写入 + plan.yaml 重写)。本 WP
* 提供的 `derivePlanForkChanges` (anchors.ts) 只做**变更形态分类**
* (INSERT/MOVE/DELETE, §2.1 原文表达) 与位置推导, 不产出 new_plan。
*
* 八步全部通过后: 「分配 PF id, status=OPEN, append 写入 operational DB;
* 记录 ManagementAction(PF_CREATED)」(§4 原文) — id 分配 + 双写事务由
* store.ts `PlanForkStore.createPlanFork` 执行 (本文件只交付纯校验链 +
* draft; id 未分配时记录不完整, 故 draft 类型 = Omit<PlanForkRecord,'id'>)。
*
* 插件只做上述**机械校验** (引用存在、字段存在、拓扑合法), 不判断科研
* 理由是否正确 (INV-SCI-2) — `reason`/`necessity` 只查非空 (step 7)。
*
* 额外机械约束 (超出 §4 字面、由 §2.2/§4.4 必然推出, 决策记录见报告):
*   - `KEEP.ref` 必须位于替换**开区间** (fork, merge) 内 — 区间外的
*     canonical item 若被 KEEP, 物化后计划将**重复列出**该 item
*     (§4.4 「无重复」违例, SELECT 必失败); 纯插入时开区间为空 ⇒
*     proposed_items 只可含 NEW (否则同样重复)。码 PF_KEEP_REF_OUTSIDE_SPAN。
*   - `KEEP.ref` 不得重复 (同样 ⇒ 物化后重复列出)。码 PF_KEEP_REF_DUPLICATE。
*
* Pure: zero I/O (全部上下文经 `PlanForkCreationContext` 注入)。
*/
/**
* The FROZEN input key set — `CreatePlanForkParams` 的运行时镜像
* (文档 + 运行时守卫的依据; 类型面才是权威, 本元组随类型演进)。
*/
const CREATE_PARAM_KEYS = [
	"workstreamId",
	"forkAnchor",
	"mergeAnchor",
	"proposedItems",
	"triggerRefs",
	"reason",
	"necessity",
	"createdByRun"
];
/**
* Runtime guard for the frozen input surface (INV-PLAN-6 的运行时半边):
* a JS caller that bypasses the TS type and smuggles extra keys (in
* particular any `base*` key) is refused with the first unknown key named
* and the invariant cited. The frozen 8 keys above are the ONLY surface.
*/
function assertFrozenInputSurface(params) {
	if (params === null || typeof params !== "object" || Array.isArray(params)) throw new PlanForkError({
		code: "PF_INPUT",
		message: `createPlanFork params must be an object with exactly the frozen §4 input keys [${CREATE_PARAM_KEYS.join(", ")}]`
	});
	const keys = Object.keys(params).sort();
	const allowed = new Set(CREATE_PARAM_KEYS);
	for (const key of keys) if (!allowed.has(key)) {
		const baseNote = /base/i.test(key) ? ` — a base is NEVER an input: 基准由服务端重算 (PLAN_FORK_SPEC §4 步骤 3 / ARCHITECTURE §5.4 INV-PLAN-6)` : "";
		throw new PlanForkError({
			code: "PF_INPUT",
			path: `/${key}`,
			message: `createPlanFork input has unknown key ${JSON.stringify(key)} — the frozen §4 input surface is exactly [${CREATE_PARAM_KEYS.join(", ")}]${baseNote}`
		});
	}
	if (keys.length !== CREATE_PARAM_KEYS.length) throw new PlanForkError({
		code: "PF_INPUT",
		message: `createPlanFork input is missing frozen §4 keys — expected exactly [${CREATE_PARAM_KEYS.join(", ")}], got [${keys.join(", ")}]`
	});
}
/** Step 1 — policy `enabled = true` (§4 原文). */
function step1_policyEnabled(policy) {
	assertPolicyEnabled(policy);
}
/** Step 2 — `workstream_id` 存在且 canonical plan 已加载 (§4 原文). */
function step2_workstreamAndPlan(params, plan) {
	if (plan.workstream_id !== params.workstreamId) throw new PlanForkError({
		code: "PF_INPUT",
		step: 2,
		path: "/workstream_id",
		message: `context canonical plan view is for ${JSON.stringify(plan.workstream_id)} but params request ${JSON.stringify(params.workstreamId)} — load the plan of the requested workstream`
	});
	if (!plan.workstream_exists) throw new PlanForkError({
		code: "PF_WORKSTREAM_MISSING",
		step: 2,
		path: "/workstream_id",
		message: `workstream_id=${JSON.stringify(params.workstreamId)} not found (no workstream directory) — creation refused (PLAN_FORK_SPEC §4 步骤 2)`
	});
	if (!plan.present) throw new PlanForkError({
		code: "PF_PLAN_NOT_LOADED",
		step: 2,
		path: "/workstream_id",
		message: `workstream ${JSON.stringify(params.workstreamId)} exists but its canonical plan is not loaded (no plan.yaml) — a plan fork needs a loaded canonical plan (PLAN_FORK_SPEC §4 步骤 2)`
	});
	if (!plan.consistent) throw new PlanForkError({
		code: "PF_PLAN_INCONSISTENT",
		step: 2,
		path: "/workstream_id",
		message: `canonical plan of ${JSON.stringify(params.workstreamId)} is loaded but inconsistent: ${plan.problem ?? "unspecified"} — a plan fork may only be based on a consistent canonical plan (DOMAIN_SCHEMA §4.4; PLAN_FORK_SPEC §4 步骤 2)`
	});
}
/**
* Step 3 — 基准由服务端重算 (§4 原文, INV-PLAN-6 的结构性保证): 计算
* §3.1 closure 路径 (本模块 `closureRelativePaths`) 并经注入 capturer 捕获
* working-copy blob OID 集合 + 信息性 HEAD。客户端提交的 base 不存在于
* 输入面 (INV-PLAN-6) — 这里的基准**只能**来自 capturer。
*/
function step3_captureBase(params, plan, capturer) {
	const closure = closureRelativePaths(plan.wsDir, plan.ordered_items);
	let base;
	try {
		base = capturer.capture(plan.wsDir, closure);
	} catch (cause) {
		throw new PlanForkError({
			code: "PF_BASE_CAPTURE",
			step: 3,
			message: `server-side closure base capture failed for ${JSON.stringify(plan.workstream_id)} (${closure.length} closure files): ${cause instanceof Error ? cause.message : String(cause)} (PLAN_FORK_SPEC §4 步骤 3/§3.2; 基准永远重算, 不接受客户端提交 base — INV-PLAN-6)`,
			cause
		});
	}
	if (base === null || base === void 0 || !Array.isArray(base.objects) || base.objects.length === 0) throw new PlanForkError({
		code: "PF_BASE_CAPTURE",
		step: 3,
		message: `capturer returned an empty base closure for ${JSON.stringify(plan.workstream_id)} — the closure always contains at least plan.yaml (PLAN_FORK_SPEC §3.1)`
	});
	return base;
}
/**
* Step 4 — proposed_items 校验 (§4 原文):
*   - 非空 (空 ⇒ PF_ITEMS_EMPTY; schema minItems 1 同型);
*   - 逐项 (有序 — 顺序即物化顺序): 外层形状过冻结 $defs/ProposedItem
*     (shape 违例 ⇒ PF_SPEC_INVALID, 精确 path);
*   - KEEP: kind ↔ ref 前缀一致 (类型一致性 ⇒ PF_ITEM_KIND_MISMATCH) →
*     ref 存在于当前 canonical (⇒ PF_KEEP_REF_MISSING) → ref 位于替换
*     开区间 (fork, merge) 内 (⇒ PF_KEEP_REF_OUTSIDE_SPAN; 纯插入时开区间
*     为空 ⇒ KEEP 一律不合法) → 无重复 ref (⇒ PF_KEEP_REF_DUPLICATE);
*   - NEW: spec 过**对应 kind** 的冻结 item spec schema (⇒ PF_SPEC_INVALID;
*     kind↔spec 对应由「按声明 kind 校验」机械保证)。
* 开区间端点需要 resolved anchors — 先做一次**存在性+顺序**解析
* (与 step 5 同一解析; step 5 再做 policy 半边)。
*/
function step4_proposedItems(params, plan, schemas, resolution) {
	const items = params.proposedItems;
	if (items.length === 0) throw new PlanForkError({
		code: "PF_ITEMS_EMPTY",
		step: 4,
		path: "/proposed_items",
		message: "proposed_items is empty — a plan fork must propose a non-empty ordered replacement (PLAN_FORK_SPEC §4 步骤 4; frozen minItems 1)"
	});
	const spanItems = resolution === null ? null : new Set(plan.ordered_items.slice(resolution.forkIndex + 1, resolution.mergeIndex));
	const seenKeepRefs = /* @__PURE__ */ new Map();
	items.forEach((item, i) => {
		const pointer = `/proposed_items/${i}`;
		if (typeof item === "object" && item !== null && item.action === "NEW") {
			const newIt = item;
			checkNewSpec(schemas, newIt.kind, newIt.spec, i, pointer);
		}
		if (schemas.isUsable) {
			const shape = schemas.checkProposedItem(item);
			if (!shape.ok) throw new PlanForkError({
				code: "PF_SPEC_INVALID",
				step: 4,
				path: pointer,
				message: `proposed_items[${i}] fails the frozen ProposedItem schema: ${shape.errors.map((e) => `${e.path || "/"}: ${e.message}`).join(" | ")}`
			});
		} else throw new PlanForkError({
			code: "PF_SCHEMA_UNAVAILABLE",
			step: 4,
			path: pointer,
			message: "frozen plan-fork schema set unavailable — proposed_items cannot be validated (see PlanForkSchemas.loadErrors)"
		});
		if (item.action === "KEEP") checkKeepRef(params, plan, item.ref, i, pointer, spanItems, resolution, seenKeepRefs);
	});
}
function checkKeepRef(params, plan, ref, i, pointer, spanItems, resolution, seen) {
	const item = params.proposedItems[i];
	if (item.action !== "KEEP") return;
	const parsed = parseId(ref);
	const expected = item.kind;
	if (parsed === null || parsed.kind !== expected) throw new PlanForkError({
		code: "PF_ITEM_KIND_MISMATCH",
		step: 4,
		path: `${pointer}/ref`,
		message: `proposed_items[${i}].ref=${JSON.stringify(ref)} has id kind ${parsed === null ? "(unparseable)" : parsed.kind} but declared kind ${JSON.stringify(expected)} — 类型一致性 (DOMAIN_SCHEMA §4.4/§1.1)`
	});
	if (!plan.ordered_items.includes(ref)) throw new PlanForkError({
		code: "PF_KEEP_REF_MISSING",
		step: 4,
		path: `${pointer}/ref`,
		message: `proposed_items[${i}].ref=${JSON.stringify(ref)} does not exist in the current canonical ordered_items of ${JSON.stringify(plan.workstream_id)} (PLAN_FORK_SPEC §4 步骤 4: KEEP.ref 必须存在于当前 canonical)`
	});
	if (spanItems !== null && resolution !== null && !spanItems.has(ref)) throw new PlanForkError({
		code: "PF_KEEP_REF_OUTSIDE_SPAN",
		step: 4,
		path: `${pointer}/ref`,
		message: `proposed_items[${i}].ref=${JSON.stringify(ref)} is not inside the replacement span (${JSON.stringify(resolution.forkAnchor)}, ${JSON.stringify(resolution.mergeAnchor)}) — keeping an outside-span item would LIST IT TWICE in the materialized plan (DOMAIN_SCHEMA §4.4 无重复; 纯插入时 span 为空, proposed_items 只可含 NEW) (PLAN_FORK_SPEC §2.2)`
	});
	const firstAt = seen.get(ref);
	if (firstAt !== void 0) throw new PlanForkError({
		code: "PF_KEEP_REF_DUPLICATE",
		step: 4,
		path: `${pointer}/ref`,
		message: `proposed_items[${i}].ref=${JSON.stringify(ref)} is already KEEP-referenced at proposed_items[${firstAt}] — a duplicate would list the item twice in the materialized plan (DOMAIN_SCHEMA §4.4 无重复)`
	});
	seen.set(ref, i);
}
function checkNewSpec(schemas, kind, spec, i, pointer) {
	if (!(kind === "TASK" || kind === "GATE" || kind === "MILESTONE")) throw new PlanForkError({
		code: "PF_SPEC_INVALID",
		step: 4,
		path: `${pointer}/kind`,
		message: `proposed_items[${i}].kind=${JSON.stringify(String(kind))} is not a plan item kind (TASK|GATE|MILESTONE) (frozen schema enum)`
	});
	const shape = schemas.checkNewItemSpec(kind, spec);
	if (!shape.ok) throw new PlanForkError({
		code: "PF_SPEC_INVALID",
		step: 4,
		path: `${pointer}/spec`,
		message: `proposed_items[${i}] (NEW ${kind}) spec fails the frozen NewItemSpec${kind} schema: ${shape.errors.map((e) => `${e.path || "/"}: ${e.message}`).join(" | ")} (PLAN_FORK_SPEC §4 步骤 4: NEW.spec 通过对应 item schema 校验)`
	});
}
/**
* Step 5 — anchor 合法 (§2.2) 且满足 policy 的 anchor 约束 (§4 原文):
*   - 解析 (存在性 + 顺序) 由 anchors.ts `resolveAnchors` 承担 (step 4 已
*     解析一次, 这里复用 — 解析是纯函数且幂等);
*   - policy 半边: 哨兵开关 + required_item_types (policy.ts
*     `applyAnchorPolicy`), 逐 anchor 报告 (fork 先于 merge)。
*/
function step5_anchors(params, policy, resolution) {
	for (const [name, anchor] of [["fork_anchor", params.forkAnchor], ["merge_anchor", params.mergeAnchor]]) {
		const sentinel = isBoundarySentinel(anchor);
		applyAnchorPolicy(policy, name, anchor, sentinel, sentinel ? null : anchorItemKind(anchor));
	}
}
/**
* Step 6 — trigger_refs (§4 原文):
*   - policy `require_at_least_one` 时 ≥1 (PF_TRIGGERS_EMPTY);
*   - 逐项: kind ∈ policy `allowed_kinds` (PF_TRIGGER_KIND_FORBIDDEN) →
*     kind ↔ id 前缀一致 (PF_TRIGGER_REF_INVALID) → 存在
*     (PF_TRIGGER_MISSING, §16.3 写入时校验)。
*/
function step6_triggerRefs(params, policy, resolver) {
	const refs = params.triggerRefs;
	applyTriggerPolicy(policy, refs);
	refs.forEach((ref, i) => {
		const pointer = `/trigger_refs/${i}`;
		if (!isFrozenTriggerKind(ref.kind)) throw new PlanForkError({
			code: "PF_TRIGGER_KIND_FORBIDDEN",
			step: 6,
			path: `${pointer}/kind`,
			message: `trigger_refs[${i}].kind=${JSON.stringify(String(ref.kind))} is not one of the 5 frozen trigger kinds (CLAIM|FACT|ARTIFACT|MILESTONE|OBJECTIVE) (frozen schema)`
		});
		const parsed = parseId(ref.id);
		if (parsed === null || parsed.kind !== ref.kind) throw new PlanForkError({
			code: "PF_TRIGGER_REF_INVALID",
			step: 6,
			path: `${pointer}/id`,
			message: `trigger_refs[${i}].id=${JSON.stringify(ref.id)} has id kind ${parsed === null ? "(unparseable)" : parsed.kind} but declared kind ${JSON.stringify(ref.kind)} — 类型一致性 (DOMAIN_SCHEMA §1.1/§7)`
		});
		if (!resolver.exists(ref)) throw new PlanForkError({
			code: "PF_TRIGGER_MISSING",
			step: 6,
			path: pointer,
			message: `trigger_refs[${i}] {kind: ${JSON.stringify(ref.kind)}, id: ${JSON.stringify(ref.id)}} does not exist — trigger refs must all exist (PLAN_FORK_SPEC §4 步骤 6; DOMAIN_SCHEMA §16.3 写入时校验)`
		});
	});
}
function isFrozenTriggerKind(kind) {
	return kind === "CLAIM" || kind === "FACT" || kind === "ARTIFACT" || kind === "MILESTONE" || kind === "OBJECTIVE";
}
/** Step 7 — `reason`, `necessity` 非空 (§4 原文). */
function step7_texts(params) {
	if (typeof params.reason !== "string" || params.reason.length === 0) throw new PlanForkError({
		code: "PF_REASON_EMPTY",
		step: 7,
		path: "/reason",
		message: "reason is empty — a plan fork proposal requires a non-empty reason (PLAN_FORK_SPEC §4 步骤 7; DOMAIN_SCHEMA §5)"
	});
	if (typeof params.necessity !== "string" || params.necessity.length === 0) throw new PlanForkError({
		code: "PF_NECCESSITY_EMPTY",
		step: 7,
		path: "/necessity",
		message: "necessity is empty — a plan fork proposal requires a non-empty necessity (PLAN_FORK_SPEC §4 步骤 7; DOMAIN_SCHEMA §5)"
	});
}
/**
* Step 8 — `created_by_run` 存在且属于该 workstream (§4 原文; formal run
* 绑定 DOMAIN_SCHEMA §6.1). Returns the run view (the store records it in
* the PF_CREATED ManagementAction actor).
*/
function step8_createdByRun(params, lookup) {
	const run = lookup.get(params.createdByRun);
	if (run === null) throw new PlanForkError({
		code: "PF_RUN_NOT_FOUND",
		step: 8,
		path: "/created_by_run",
		message: `created_by_run=${JSON.stringify(params.createdByRun)} does not exist (no formal run row) — a plan fork proposal must be created BY a run (PLAN_FORK_SPEC §4 步骤 8; DOMAIN_SCHEMA §6.1)`
	});
	if (run.workstream_id !== params.workstreamId) throw new PlanForkError({
		code: "PF_RUN_WS_MISMATCH",
		step: 8,
		path: "/created_by_run",
		message: `created_by_run=${JSON.stringify(params.createdByRun)} belongs to ${JSON.stringify(run.workstream_id)} but the fork targets ${JSON.stringify(params.workstreamId)} — a formal run's workstream binding must match (PLAN_FORK_SPEC §4 步骤 8; DOMAIN_SCHEMA §6.1)`
	});
	return run;
}
/**
* Run the §4 八步 chain in order (任一失败即拒绝 — the FIRST violated
* step throws PlanForkError with `step` + `path` 指明失败项). All eight
* pass ⇒ the creation draft (record minus id — §4 「通过后: 分配 PF id」
* is the store's job; status=OPEN, created_at = now() epoch ms, A-3)。
*
* The draft's `base_plan_objects` is the step-3 server-side capture
* (INV-PLAN-5: 创建时刻 closure 的精确 (path, oid) 集合; 稳定顺序 =
* closure 顺序 — capturer 必须按 `closureRelativePaths` 顺序回显)。
*/
function validatePlanForkCreation(params, ctx) {
	assertFrozenInputSurface(params);
	step1_policyEnabled(ctx.policy);
	step2_workstreamAndPlan(params, ctx.plan);
	const base = step3_captureBase(params, ctx.plan, ctx.baseCapturer);
	let resolution = null;
	let deferredAnchorError = null;
	try {
		resolution = resolveAnchors(params.forkAnchor, params.mergeAnchor, ctx.plan.ordered_items);
	} catch (cause) {
		deferredAnchorError = cause instanceof PlanForkError ? cause : new PlanForkError({
			code: "PF_INPUT",
			message: String(cause),
			cause
		});
	}
	step4_proposedItems(params, ctx.plan, ctx.schemas, resolution);
	if (deferredAnchorError !== null) throw deferredAnchorError;
	step5_anchors(params, ctx.policy, resolution);
	step6_triggerRefs(params, ctx.policy, ctx.triggerRefResolver);
	step7_texts(params);
	step8_createdByRun(params, ctx.formalRunLookup);
	return {
		workstream_id: params.workstreamId,
		base_plan_objects: base.objects,
		...base.gitCommit !== void 0 ? { base_git_commit: base.gitCommit } : {},
		fork_anchor: params.forkAnchor,
		merge_anchor: params.mergeAnchor,
		proposed_items: params.proposedItems,
		trigger_refs: params.triggerRefs,
		reason: params.reason,
		necessity: params.necessity,
		created_by_run: params.createdByRun,
		created_at: ctx.now(),
		status: "OPEN"
	};
}
//#endregion
//#region src/host/domain/planfork/schema.ts
const PLAN_FORK_TABLE = "plan_fork";
const MANAGEMENT_ACTION_TABLE = "management_action";
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
`;
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
`;
/** Full DDL (idempotent — re-applied on every store open, 同 runbinding 先例). */
function planForkDdl() {
	return PLAN_FORK_DDL + MANAGEMENT_ACTION_DDL;
}
const SQL_INSERT_PLAN_FORK = `
INSERT INTO ${PLAN_FORK_TABLE} (id, workstream_id, base_plan_objects, base_git_commit, fork_anchor, merge_anchor, proposed_items, trigger_refs, reason, necessity, created_by_run, created_at, status, selected_at, selected_by, dismissed_at, stale_reason)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const SQL_SELECT_PLAN_FORK_BY_ID = `SELECT * FROM ${PLAN_FORK_TABLE} WHERE id = ?`;
const SQL_SELECT_MANAGEMENT_ACTION_BY_ID = `SELECT * FROM ${MANAGEMENT_ACTION_TABLE} WHERE id = ?`;
/** The optimistic state-machine UPDATE per target (WHERE status = from). */
/**
* Transition UPDATEs — each sets its own state's co-occurring fields AND
* NULLs the other states' fields (字段共现 CHECK 的 UPDATE 面: 从 STALE
* 转 DISMISSED 必须清 stale_reason, 否则 (status='STALE')⇔(stale_reason
* IS NOT NULL) CHECK 违例). `WHERE status = ?` = 乐观并发门。
*/
const SQL_TRANSITION_PLAN_FORK = {
	SELECTED: `UPDATE ${PLAN_FORK_TABLE} SET status = 'SELECTED', selected_at = ?, selected_by = ?, dismissed_at = NULL, stale_reason = NULL WHERE id = ? AND status = ?`,
	DISMISSED: `UPDATE ${PLAN_FORK_TABLE} SET status = 'DISMISSED', dismissed_at = ?, selected_at = NULL, selected_by = NULL, stale_reason = NULL WHERE id = ? AND status = ?`,
	STALE: `UPDATE ${PLAN_FORK_TABLE} SET status = 'STALE', stale_reason = ?, selected_at = NULL, selected_by = NULL, dismissed_at = NULL WHERE id = ? AND status = ?`
};
const SQL_INSERT_MANAGEMENT_ACTION = `
INSERT INTO ${MANAGEMENT_ACTION_TABLE} (id, action_kind, actor, subject_refs, git_commit_oid, git_blob_oids, detail, occurred_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;
const CORRUPT$5 = (what, detail) => {
	throw new Error(`planfork row corruption at ${what}: ${detail}`);
};
function decodeJson$5(value, what) {
	if (typeof value !== "string") return CORRUPT$5(what, `expected JSON string, got ${typeof value}`);
	try {
		return JSON.parse(value);
	} catch (cause) {
		return CORRUPT$5(what, `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
	}
}
/** Encode `PlanForkRecord` into the INSERT parameter list (column order = DDL). */
function planForkToParams(r) {
	return [
		r.id,
		r.workstream_id,
		JSON.stringify(r.base_plan_objects.map((o) => ({
			path: o.path,
			git_blob_oid: o.git_blob_oid
		}))),
		r.base_git_commit ?? null,
		r.fork_anchor,
		r.merge_anchor,
		JSON.stringify(r.proposed_items.map((p) => p.action === "KEEP" ? {
			action: p.action,
			kind: p.kind,
			ref: p.ref
		} : {
			action: p.action,
			kind: p.kind,
			spec: { ...p.spec }
		})),
		JSON.stringify(r.trigger_refs.map((t) => ({
			kind: t.kind,
			id: t.id
		}))),
		r.reason,
		r.necessity,
		r.created_by_run,
		r.created_at,
		r.status,
		r.selected_at ?? null,
		r.selected_by === void 0 ? null : JSON.stringify(r.selected_by),
		r.dismissed_at ?? null,
		r.stale_reason ?? null
	];
}
/** Decode a `plan_fork` row back to the record (throws on corruption). */
function rowToPlanFork(row) {
	const status = row.status;
	if (typeof status !== "string" || !isPfStatus(status)) return CORRUPT$5("plan_fork.status", `unknown status ${JSON.stringify(String(status))}`);
	for (const name of [
		"id",
		"workstream_id",
		"fork_anchor",
		"merge_anchor",
		"reason",
		"necessity",
		"created_by_run"
	]) if (typeof row[name] !== "string") return CORRUPT$5(`plan_fork.${name}`, `expected string, got ${typeof row[name]}`);
	if (typeof row.created_at !== "number") return CORRUPT$5("plan_fork.created_at", `expected number, got ${typeof row.created_at}`);
	return {
		id: row.id,
		workstream_id: row.workstream_id,
		base_plan_objects: decodeJson$5(row.base_plan_objects, "plan_fork.base_plan_objects"),
		fork_anchor: row.fork_anchor,
		merge_anchor: row.merge_anchor,
		proposed_items: decodeJson$5(row.proposed_items, "plan_fork.proposed_items"),
		trigger_refs: decodeJson$5(row.trigger_refs, "plan_fork.trigger_refs"),
		reason: row.reason,
		necessity: row.necessity,
		created_by_run: row.created_by_run,
		created_at: row.created_at,
		status,
		...row.base_git_commit != null ? { base_git_commit: String(row.base_git_commit) } : {},
		...row.selected_at != null ? { selected_at: row.selected_at } : {},
		...row.selected_by != null ? { selected_by: decodeJson$5(row.selected_by, "plan_fork.selected_by") } : {},
		...row.dismissed_at != null ? { dismissed_at: row.dismissed_at } : {},
		...row.stale_reason != null ? { stale_reason: String(row.stale_reason) } : {}
	};
}
/** Encode `ManagementActionRecord` into the INSERT parameter list. */
function managementActionToParams(a) {
	return [
		a.id,
		a.action_kind,
		JSON.stringify(a.actor),
		JSON.stringify(a.subject_refs),
		a.git_commit_oid ?? null,
		a.git_blob_oids === void 0 ? null : JSON.stringify(a.git_blob_oids.map((g) => ({
			path: g.path,
			oid: g.oid
		}))),
		a.detail ?? null,
		a.occurred_at
	];
}
/** Decode a `management_action` row (throws on corruption). */
function rowToManagementAction(row) {
	if (typeof row.id !== "string") return CORRUPT$5("management_action.id", `expected string, got ${typeof row.id}`);
	if (typeof row.action_kind !== "string") return CORRUPT$5("management_action.action_kind", `expected string, got ${typeof row.action_kind}`);
	if (typeof row.occurred_at !== "number") return CORRUPT$5("management_action.occurred_at", `expected number, got ${typeof row.occurred_at}`);
	return {
		id: row.id,
		action_kind: row.action_kind,
		actor: decodeJson$5(row.actor, "management_action.actor"),
		subject_refs: decodeJson$5(row.subject_refs, "management_action.subject_refs"),
		occurred_at: row.occurred_at,
		...row.git_commit_oid != null ? { git_commit_oid: String(row.git_commit_oid) } : {},
		...row.git_blob_oids != null ? { git_blob_oids: decodeJson$5(row.git_blob_oids, "management_action.git_blob_oids") } : {},
		...row.detail != null ? { detail: String(row.detail) } : {}
	};
}
//#endregion
//#region src/host/domain/planfork/store.ts
var PlanForkStore = class {
	db;
	allocator;
	projectId;
	now;
	closed = false;
	constructor(options) {
		this.db = options.db;
		this.allocator = options.allocator;
		this.projectId = options.projectId;
		this.now = options.now ?? Date.now;
		this.db.exec(planForkDdl());
	}
	/**
	* Create one OPEN PlanFork (the §4 flow). `ctx` carries the SERVER-SIDE
	* read context (policy / fresh canonical plan / frozen schemas / base
	* capturer / resolvers / clock) — the input `params` is the frozen §4
	* surface (NO base — INV-PLAN-6). Throws the first violated step's
	* `PlanForkError` (step + path 指明失败项); on storage failure after
	* validation: both reserved ids are released (burned gap) + PF_STORE.
	*/
	createPlanFork(params, ctx) {
		this.assertOpen("createPlanFork");
		const draft = validatePlanForkCreation(params, ctx);
		if (!ctx.schemas.isUsable) throw new PlanForkError({
			code: "PF_SCHEMA_UNAVAILABLE",
			message: "frozen plan-fork schema set unavailable — no record can be shape-checked (see PlanForkSchemas.loadErrors)"
		});
		const shape = ctx.schemas.checkRecordShape({
			...draft,
			id: "PF-1"
		});
		if (!shape.ok) throw new PlanForkError({
			code: "PF_INPUT",
			message: `internal: validated draft failed the frozen plan-fork record schema: ${shape.errors.map((e) => `${e.path || "/"}: ${e.message}`).join(" | ")}`
		});
		const pfRes = this.allocator.reserve("PLAN_FORK", this.projectId);
		const maRes = this.allocator.reserve("MANAGEMENT_ACTION", this.projectId);
		const finalRecord = {
			...draft,
			id: pfRes.id
		};
		const ma = this.buildPfCreatedAction(maRes.id, finalRecord, params.createdByRun, ctx.now());
		try {
			this.db.transaction(() => {
				this.db.run(SQL_INSERT_PLAN_FORK, ...planForkToParams(finalRecord));
				this.db.run(SQL_INSERT_MANAGEMENT_ACTION, ...managementActionToParams(ma));
			});
		} catch (cause) {
			this.allocator.release(pfRes);
			this.allocator.release(maRes);
			throw this.wrap("createPlanFork", cause);
		}
		this.allocator.commit(pfRes);
		this.allocator.commit(maRes);
		return finalRecord;
	}
	/** The PF_CREATED ledger row (§4 原文「记录 ManagementAction(PF_CREATED)」). */
	buildPfCreatedAction(maId, record, createdByRun, at) {
		return {
			id: maId,
			action_kind: "PF_CREATED",
			actor: {
				kind: "AGENT",
				run_id: createdByRun
			},
			subject_refs: [{
				kind: "PLAN_FORK",
				id: record.id
			}],
			git_blob_oids: record.base_plan_objects.map((o) => ({
				path: o.path,
				oid: o.git_blob_oid
			})),
			detail: `plan fork ${record.id} created for ${record.workstream_id} (fork_anchor=${record.fork_anchor}, merge_anchor=${record.merge_anchor}, proposed_items=${record.proposed_items.length}, trigger_refs=${record.trigger_refs.length})`,
			occurred_at: at
		};
	}
	/**
	* Execute ONE legal §10 transition (OPEN→SELECTED|DISMISSED|STALE,
	* STALE→DISMISSED). `actor` = who performs it (the ManagementAction's
	* actor — 用户 for SELECT/DISMISS, 插件 for stale marking; 发射者矩阵
	* 由调用方 WP 负责, 本 store 只做冻结 actorRef 形状校验)。
	*
	* Two-phase concurrency gate: ① pre-check against the READ row
	* (checkPfTransition — PF_WRONG_STATE with the §10 legal set); ② the
	* conditional UPDATE (WHERE id=? AND status=from) — 0 rows ⇒ a concurrent
	* transition won the race: re-read and report PF_NOT_FOUND / PF_WRONG_STATE
	* precisely. The row update + the ledger append are ONE transaction
	* (任何一半失败 ⇒ 全回滚, 行状态与账本永不分叉)。
	* Returns the UPDATED record (fresh read after commit).
	*/
	transition(id, target, actor) {
		this.assertOpen("transition");
		this.assertActor(actor, `transition(${id})`);
		const current = this.readRow(id);
		if (current === null) throw new PlanForkError({
			code: "PF_NOT_FOUND",
			message: `plan fork ${JSON.stringify(id)} does not exist`
		});
		checkPfTransition(id, current.status, target.to);
		const maRes = this.allocator.reserve("MANAGEMENT_ACTION", this.projectId);
		const at = this.now();
		try {
			this.db.transaction(() => {
				let changes;
				switch (target.to) {
					case "SELECTED":
						this.assertEpoch(target.selected_at, "selected_at");
						changes = this.db.run(SQL_TRANSITION_PLAN_FORK.SELECTED, target.selected_at, JSON.stringify(target.selected_by), id, current.status);
						break;
					case "DISMISSED":
						this.assertEpoch(target.dismissed_at, "dismissed_at");
						changes = this.db.run(SQL_TRANSITION_PLAN_FORK.DISMISSED, target.dismissed_at, id, current.status);
						break;
					case "STALE": changes = this.db.run(SQL_TRANSITION_PLAN_FORK.STALE, target.stale_reason, id, current.status);
				}
				if (changes === 0) {
					const reread = this.readRow(id);
					if (reread === null) throw new PlanForkError({
						code: "PF_NOT_FOUND",
						message: `plan fork ${JSON.stringify(id)} vanished during transition (no-delete trigger in effect — investigate)`
					});
					checkPfTransition(id, reread.status, target.to);
				}
				const ma = {
					id: maRes.id,
					action_kind: TRANSITION_ACTION_KIND[target.to],
					actor,
					subject_refs: [{
						kind: "PLAN_FORK",
						id
					}],
					...target.to === "SELECTED" ? { detail: `plan fork ${id} selected for ${current.workstream_id}` } : {},
					...target.to === "DISMISSED" ? { detail: `plan fork ${id} dismissed (was ${current.status})` } : {},
					...target.to === "STALE" ? { detail: `plan fork ${id} marked stale (was ${current.status}): ${target.stale_reason}` } : {},
					occurred_at: at
				};
				this.db.run(SQL_INSERT_MANAGEMENT_ACTION, ...managementActionToParams(ma));
			});
		} catch (cause) {
			if (cause instanceof PlanForkError) {
				this.allocator.release(maRes);
				throw cause;
			}
			this.allocator.release(maRes);
			throw this.wrap(`transition(${id})`, cause);
		}
		this.allocator.commit(maRes);
		const updated = this.readRow(id);
		if (updated === null) throw new PlanForkError({
			code: "PF_NOT_FOUND",
			message: `plan fork ${JSON.stringify(id)} vanished after transition (internal)`
		});
		return updated;
	}
	/** One record by id (`null` when absent). */
	getPlanFork(id) {
		this.assertOpen("getPlanFork");
		return this.readRow(id);
	}
	/**
	* List by (workstreamId?, status?) — the §15 index (workstream_id,
	* status) covers the flooding count and per-WS listings. Order:
	* created_at ASC, id ASC (stable).
	*/
	listPlanForks(filter = {}) {
		this.assertOpen("listPlanForks");
		const clauses = [];
		const params = [];
		if (filter.workstreamId !== void 0) {
			assertNonEmpty$2(filter.workstreamId, "filter.workstreamId");
			clauses.push("workstream_id = ?");
			params.push(filter.workstreamId);
		}
		if (filter.status !== void 0) {
			if (!isPfStatus(filter.status)) throw new PlanForkError({
				code: "PF_INPUT",
				message: `filter.status must be one of OPEN|SELECTED|DISMISSED|STALE (got ${JSON.stringify(filter.status)})`
			});
			clauses.push("status = ?");
			params.push(filter.status);
		}
		const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
		return this.db.all(`SELECT * FROM ${PLAN_FORK_TABLE} ${where} ORDER BY created_at ASC, id ASC`, ...params).map((r) => rowToPlanFork(r));
	}
	/**
	* `count(status == OPEN, per workstream)` — the WP-3.5 flooding rule's
	* input (PLAN_FORK_SPEC §8: 「count(status == OPEN 的 PF, per workstream)
	* > threshold」; 本 WP 只交付计数缝, 不做 Intervention 创建)。
	*/
	countOpen(workstreamId) {
		this.assertOpen("countOpen");
		assertNonEmpty$2(workstreamId, "workstreamId");
		const row = this.db.get(`SELECT COUNT(*) AS n FROM ${PLAN_FORK_TABLE} WHERE workstream_id = ? AND status = 'OPEN'`, workstreamId);
		return Number(row?.n ?? 0);
	}
	/** One ledger row by MA id (`null` when absent). */
	getManagementAction(id) {
		this.assertOpen("getManagementAction");
		const row = this.db.get(SQL_SELECT_MANAGEMENT_ACTION_BY_ID, id);
		return row === void 0 ? null : rowToManagementAction(row);
	}
	/** All ledger rows (stable order: occurred_at ASC, id ASC). */
	listManagementActions() {
		this.assertOpen("listManagementActions");
		return this.db.all(`SELECT * FROM ${MANAGEMENT_ACTION_TABLE} ORDER BY occurred_at ASC, id ASC`).map((r) => rowToManagementAction(r));
	}
	/** The id families this store allocates (diagnostics). */
	get allocatedCounters() {
		return {
			planFork: this.allocator.peek("PLAN_FORK", this.projectId),
			managementAction: this.allocator.peek("MANAGEMENT_ACTION", this.projectId)
		};
	}
	readRow(id) {
		if (typeof id !== "string" || id.length === 0) throw new PlanForkError({
			code: "PF_INPUT",
			message: "plan fork id must be a non-empty string"
		});
		const row = this.db.get(SQL_SELECT_PLAN_FORK_BY_ID, id);
		return row === void 0 ? null : rowToPlanFork(row);
	}
	assertOpen(operation) {
		if (this.closed) throw new PlanForkError({
			code: "PF_STORE",
			message: `${operation}: store is closed`
		});
	}
	/** 冻结 actorRef 形状 (kind 枚举; run_id 前缀; label ≤200 — common.schema.json). */
	assertActor(actor, context) {
		if (actor === null || typeof actor !== "object" || typeof actor.kind !== "string" || !ACTOR_KINDS$1.includes(actor.kind)) throw new PlanForkError({
			code: "PF_INPUT",
			message: `${context}: actor must be a frozen actorRef (kind ∈ USER|AGENT|PLUGIN|SYSTEM; got ${JSON.stringify(actor)})`
		});
		if (actor.run_id !== void 0 && !/^R-[1-9][0-9]*$/.test(actor.run_id)) throw new PlanForkError({
			code: "PF_INPUT",
			message: `${context}: actor.run_id ${JSON.stringify(actor.run_id)} is not a well-formed R id (common.schema.json actorRef)`
		});
		if (actor.label !== void 0 && (typeof actor.label !== "string" || actor.label.length > 200)) throw new PlanForkError({
			code: "PF_INPUT",
			message: `${context}: actor.label must be a string of ≤200 chars (common.schema.json actorRef)`
		});
	}
	assertEpoch(value, field) {
		if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new PlanForkError({
			code: "PF_INPUT",
			message: `${field} must be a non-negative safe integer epoch ms (got ${String(value)}; §1.2/A-3)`
		});
	}
	wrap(context, cause) {
		return new PlanForkError({
			code: "PF_STORE",
			message: `${context}: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause
		});
	}
};
function assertNonEmpty$2(value, what) {
	if (typeof value !== "string" || value.length === 0) throw new PlanForkError({
		code: "PF_INPUT",
		message: `${what} must be a non-empty string`
	});
}
//#endregion
//#region src/host/history/registry/emitters.ts
const OBJECT_WS = { kind: "objectWs" };
/** The 20 rows of the §4 总表 + §5 详细规范, keyed by the schema eventType name. */
const EVENT_METADATA = {
	RUN_STARTED: {
		category: "Run",
		isMutation: false,
		emitters: [
			"USER",
			"AGENT",
			"PLUGIN"
		],
		ownerRule: OBJECT_WS,
		semantics: "一个 Run 开始（run 行创建，status=RUNNING）"
	},
	RUNS_STARTED: {
		category: "Run",
		isMutation: false,
		emitters: ["USER", "PLUGIN"],
		ownerRule: { kind: "perOwnerBatch" },
		aggregate: {
			eventType: "RUNS_STARTED",
			memberField: "runs",
			minMembers: 2,
			perOwnerEnvelope: true,
			runEndsPerRun: true
		},
		semantics: "一次 batch launch 启动多个 Run（INV-HIST-2 唯一例外；每 owner 一条同 payload 事件）"
	},
	RUN_FINISHED: {
		category: "Run",
		isMutation: false,
		emitters: [
			"USER",
			"AGENT",
			"PLUGIN"
		],
		ownerRule: OBJECT_WS,
		transition: {
			machine: "run",
			fromSource: "implicit",
			expectedFrom: ["RUNNING"]
		},
		semantics: "Run 正常结束（run.status=FINISHED）"
	},
	RUN_FAILED: {
		category: "Run",
		isMutation: false,
		emitters: [
			"USER",
			"AGENT",
			"PLUGIN"
		],
		ownerRule: OBJECT_WS,
		transition: {
			machine: "run",
			fromSource: "implicit",
			expectedFrom: ["RUNNING"]
		},
		semantics: "Run 失败（run.status=FAILED）"
	},
	RUN_CANCELLED: {
		category: "Run",
		isMutation: false,
		emitters: ["USER", "AGENT"],
		ownerRule: OBJECT_WS,
		transition: {
			machine: "run",
			fromSource: "implicit",
			expectedFrom: ["RUNNING"]
		},
		semantics: "Run 被取消（run.status=CANCELLED）"
	},
	TASK_EXECUTION_CHANGED: {
		category: "Task",
		isMutation: true,
		emitters: ["USER"],
		ownerRule: OBJECT_WS,
		transition: {
			machine: "taskExecution",
			fromSource: "payload"
		},
		semantics: "execution 状态迁移（from = 当前派生值，INV-HIST-5）"
	},
	TASK_VALIDATION_CHANGED: {
		category: "Task",
		isMutation: true,
		emitters: ["USER"],
		ownerRule: OBJECT_WS,
		transition: {
			machine: "taskValidation",
			fromSource: "payload"
		},
		semantics: "validation 状态迁移（to=NOT_REQUIRED 仅当 AC 为空，INV-TASK-3）"
	},
	/** Schema spelling; catalog §4/§5 spells this event `ACCEPTANCE_CRITERION_CHANGED`. */
	ACCEPTANCE_CRITERIA_CHANGED: {
		category: "Task",
		isMutation: true,
		emitters: ["USER"],
		ownerRule: OBJECT_WS,
		transition: {
			machine: "acSnapshot",
			fromSource: "payload"
		},
		semantics: "AC 定义变化（语义快照；定义文件版本由 Git 管理）"
	},
	FACT_RECORDED: {
		category: "SemanticTag",
		isMutation: false,
		emitters: ["USER", "AGENT"],
		ownerRule: OBJECT_WS,
		semantics: "记录 Fact（fact 行创建，status 恒 ACTIVE）"
	},
	CLAIM_RECORDED: {
		category: "SemanticTag",
		isMutation: false,
		emitters: ["USER", "AGENT"],
		ownerRule: OBJECT_WS,
		semantics: "记录 Claim（claim 行创建，status=ACTIVE）"
	},
	CLAIM_RETRACTED: {
		category: "SemanticTag",
		isMutation: false,
		emitters: ["USER", "AGENT"],
		ownerRule: OBJECT_WS,
		transition: {
			machine: "claim",
			fromSource: "implicit",
			expectedFrom: ["ACTIVE"]
		},
		semantics: "撤回 Claim（claim.status=RETRACTED 终态；INV-HIST-7 撤销经新事件）"
	},
	ARTIFACT_REGISTERED: {
		category: "Artifact",
		isMutation: false,
		emitters: ["USER", "AGENT"],
		ownerRule: OBJECT_WS,
		semantics: "注册 Artifact（artifact 行创建，status=REGISTERED）"
	},
	ARTIFACT_MARKED_MISSING: {
		category: "Artifact",
		isMutation: false,
		emitters: [
			"USER",
			"AGENT",
			"PLUGIN"
		],
		ownerRule: OBJECT_WS,
		transition: {
			machine: "artifact",
			fromSource: "implicit",
			expectedFrom: ["REGISTERED"]
		},
		semantics: "Artifact 缺失（artifact.status=MISSING）"
	},
	RELATION_ADDED: {
		category: "Relation",
		isMutation: false,
		emitters: ["USER", "AGENT"],
		ownerRule: { kind: "relationEndpoints" },
		semantics: "添加直接边（满足 DOMAIN_SCHEMA §8 组合表与方向规范，INV-REL-1/2）"
	},
	RELATION_REMOVED: {
		category: "Relation",
		isMutation: false,
		emitters: ["USER", "AGENT"],
		ownerRule: { kind: "relationEndpoints" },
		transition: {
			machine: "relation",
			fromSource: "implicit",
			expectedFrom: ["ACTIVE"]
		},
		semantics: "移除边（端点冗余记录便于审计回放；INV-HIST-7 撤销经新事件）"
	},
	GATE_EVALUATED: {
		category: "GateMilestone",
		isMutation: false,
		emitters: ["USER"],
		ownerRule: OBJECT_WS,
		transition: {
			machine: "gate",
			fromSource: "implicit",
			expectedFrom: [
				"PLANNED",
				"PASSED",
				"FAILED",
				"WAIVED"
			]
		},
		semantics: "一次 Gate 评估（WAIVED 仅 actor.kind=USER 且 note 非空）"
	},
	MILESTONE_ACHIEVED: {
		category: "GateMilestone",
		isMutation: false,
		emitters: ["USER"],
		ownerRule: OBJECT_WS,
		transition: {
			machine: "milestone",
			fromSource: "implicit",
			expectedFrom: ["PLANNED"]
		},
		semantics: "里程碑达成（milestone 派生状态=ACHIEVED 终态）"
	},
	INTERVENTION_CREATED: {
		category: "HumanAttention",
		isMutation: false,
		emitters: [
			"USER",
			"AGENT",
			"PLUGIN"
		],
		ownerRule: { kind: "firstRelatedWs" },
		semantics: "创建 Intervention（origin=AUTO_* 时 actor.kind=PLUGIN）"
	},
	TOPOLOGY_FORK_REALIZED: {
		category: "Topology",
		isMutation: false,
		emitters: ["USER"],
		ownerRule: { kind: "topologyInputs0" },
		transition: {
			machine: "topologyEdge",
			fromSource: "implicit",
			expectedFrom: ["PLANNED"]
		},
		semantics: "fork 边实现（edge.lifecycle→REALIZED，realized_event_id 回填）"
	},
	TOPOLOGY_MERGE_REALIZED: {
		category: "Topology",
		isMutation: false,
		emitters: ["USER"],
		ownerRule: { kind: "topologyOutputs0" },
		transition: {
			machine: "topologyEdge",
			fromSource: "implicit",
			expectedFrom: ["PLANNED"]
		},
		semantics: "merge 边实现（edge.lifecycle→REALIZED，realized_event_id 回填）"
	}
};
//#endregion
//#region src/host/history/registry/registry.ts
/**
* WP-2.2 — `loadHistoryEventRegistry`: the schema-driven typed event registry
* (loader pattern, cf. WP-1.1 `loadSchemas`).
*
* The EVENT TYPE SET is decided by the frozen machine-readable truth
* `schema/history/history-events.schema.json` (20 `oneOf` branches, each
* pinning `eventType` + `schemaVersion` consts and the payload schema). The
* §4/§5 semantic columns (emitters, mutation flag, owner rule, transition,
* category) come from the hand-frozen `EVENT_METADATA` table. Loading
* performs the mechanized frozen-contract sync check (catalog §7.2 「冻结时
* 人工核对一次」): the two type sets must match EXACTLY (same names, each
* with schemaVersion 1), else the registry is unusable with `CATALOG_SYNC`
* errors — a drift between the semantic document and the machine schema can
* never go silent.
*
* Per-event validation precision: instead of running the whole `oneOf`
* (whose sub-branch errors AJV does not surface cleanly), each branch is
* wrapped as `$defs/perEvent_<TYPE>` inside an in-memory DERIVED copy of the
* frozen schema (the frozen file itself is never mutated) and compiled as a
* standalone validator `#per-event/<TYPE>`. Dispatch is on the candidate's
* `eventType` string: unknown type → precise `ENVELOPE` error at
* `/eventType`; known type → the per-event validator yields precise
* envelope+payload errors (INV-HIST-4: unknown (eventType, schemaVersion) or
* payload violation ⇒ reject).
*
* I/O: exactly two reads through the injected `HistorySchemaReader`
* (loader pattern) — no fs, no DSH (INV-PERM-5), no persistence.
*/
/** Frozen layout: the events schema lives in `schema/history/`, common in `schema/`. */
const EVENTS_FILE = "history-events.schema.json";
const COMMON_FILE = "common.schema.json";
/** Minimal POSIX join with `.`/`..` resolution for the two-file layout (kernel stays platform-free, cf. WP-1.1 pjoin). */
function joinPath$1(base, ...segments) {
	const absolute = base.startsWith("/");
	const out = [];
	for (const segment of [base, ...segments]) for (const part of segment.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
			else out.push("..");
			continue;
		}
		out.push(part);
	}
	return (absolute ? "/" : "") + out.join("/");
}
function loadHistoryEventRegistry(reader, schemaDir) {
	const loadErrors = [];
	const eventsFile = joinPath$1(schemaDir, EVENTS_FILE);
	const commonFile = joinPath$1(schemaDir, "..", COMMON_FILE);
	const readJson = (file) => {
		let text;
		try {
			text = reader.readFile(file);
		} catch (cause) {
			loadErrors.push({
				code: "SCHEMA_LOAD",
				file,
				message: `schema file read failed: ${errMsg$1(cause)}`
			});
			return null;
		}
		if (text === null) {
			loadErrors.push({
				code: "SCHEMA_LOAD",
				file,
				message: `schema file not found (schemaDir=${schemaDir})`
			});
			return null;
		}
		try {
			const parsed = JSON.parse(text);
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
				loadErrors.push({
					code: "SCHEMA_LOAD",
					file,
					message: "schema file is not a JSON object"
				});
				return null;
			}
			return parsed;
		} catch (cause) {
			loadErrors.push({
				code: "SCHEMA_LOAD",
				file,
				message: `schema file is not valid JSON: ${errMsg$1(cause)}`
			});
			return null;
		}
	};
	const common = readJson(commonFile);
	const events = readJson(eventsFile);
	const branches = [];
	if (events !== null && typeof events.$id === "string") {
		const oneOf = events.oneOf;
		if (!Array.isArray(oneOf) || oneOf.length === 0) loadErrors.push({
			code: "SCHEMA_LOAD",
			file: eventsFile,
			message: "history-events.schema.json has no oneOf branches"
		});
		else for (const raw of oneOf) {
			const branch = raw;
			const name = branch?.properties?.eventType?.const;
			const version = branch?.properties?.schemaVersion?.const;
			if (typeof name !== "string" || typeof version !== "number") {
				loadErrors.push({
					code: "SCHEMA_LOAD",
					file: eventsFile,
					message: `oneOf branch is missing the eventType/schemaVersion consts: ${compact(raw)}`
				});
				continue;
			}
			branches.push({
				name,
				version,
				schema: raw
			});
		}
	}
	if (events !== null && typeof events.$id === "string") {
		const metaNames = Object.keys(EVENT_METADATA);
		const metaSet = new Set(metaNames);
		const seen = /* @__PURE__ */ new Set();
		for (const branch of branches) {
			if (seen.has(branch.name)) {
				loadErrors.push({
					code: "CATALOG_SYNC",
					message: `duplicate eventType in schema oneOf: ${branch.name}`
				});
				continue;
			}
			seen.add(branch.name);
			if (!metaSet.has(branch.name)) loadErrors.push({
				code: "CATALOG_SYNC",
				message: `schema eventType ${JSON.stringify(branch.name)} has no §4/§5 registry metadata (frozen catalog out of sync)`
			});
			if (branch.version !== 1) loadErrors.push({
				code: "CATALOG_SYNC",
				message: `schema eventType ${branch.name} declares schemaVersion ${branch.version}; the V1 registry expects 1 (HISTORY_EVENT_CATALOG §1)`
			});
		}
		for (const name of metaNames) if (!seen.has(name)) loadErrors.push({
			code: "CATALOG_SYNC",
			message: `§4/§5 metadata for ${name} has no matching oneOf branch in the schema`
		});
	}
	const eventsById = /* @__PURE__ */ new Map();
	for (const branch of branches) if (!eventsById.has(branch.name)) eventsById.set(branch.name, branch);
	const unusable = (eventTypes, events) => ({
		schemaDir,
		isUsable: false,
		loadErrors,
		eventTypes,
		events,
		checkShape: () => ({
			ok: false,
			errors: [{
				code: "REGISTRY_UNUSABLE",
				message: `registry is unusable (load errors: ${loadErrors.map((e) => e.code).join(", ")}); see HistoryEventRegistry.loadErrors`
			}]
		})
	});
	if (loadErrors.length > 0) return unusable([], /* @__PURE__ */ new Map());
	if (common === null || events === null || typeof common.$id !== "string" || typeof events.$id !== "string") return unusable([], /* @__PURE__ */ new Map());
	const ajv = new Ajv2020({
		allErrors: true,
		strict: false,
		verbose: true
	});
	addFormats(ajv);
	try {
		ajv.addSchema(common, common.$id);
	} catch (cause) {
		loadErrors.push({
			code: "SCHEMA_COMPILE",
			file: commonFile,
			message: `common.schema.json rejected by validator engine: ${errMsg$1(cause)}`
		});
		return unusable([], /* @__PURE__ */ new Map());
	}
	const derived = { ...events };
	derived.$defs = {
		...events.$defs ?? {},
		...Object.fromEntries(branches.map((b) => [`perEvent_${b.name}`, b.schema]))
	};
	try {
		ajv.addSchema(derived, events.$id);
	} catch (cause) {
		loadErrors.push({
			code: "SCHEMA_COMPILE",
			file: eventsFile,
			message: `derived events schema rejected by validator engine: ${errMsg$1(cause)}`
		});
		return unusable([], /* @__PURE__ */ new Map());
	}
	const baseId = events.$id.replace(/\.json(#.*)?$/, "");
	const validators = /* @__PURE__ */ new Map();
	for (const branch of branches) {
		const type = branch.name;
		const perEventSchema = {
			$id: `${baseId}/per-event/${branch.name}.schema.json`,
			$ref: `${events.$id}#/$defs/perEvent_${branch.name}`
		};
		try {
			validators.set(type, ajv.compile(perEventSchema));
		} catch (cause) {
			loadErrors.push({
				code: "SCHEMA_COMPILE",
				file: eventsFile,
				message: `per-event validator compile failed for ${branch.name}: ${errMsg$1(cause)}`
			});
		}
	}
	if (loadErrors.length > 0) return unusable([], /* @__PURE__ */ new Map());
	const eventTypes = [];
	const entries = /* @__PURE__ */ new Map();
	for (const branch of branches) {
		const type = branch.name;
		const meta = EVENT_METADATA[type];
		if (meta === void 0) continue;
		eventTypes.push(type);
		entries.set(type, {
			eventType: type,
			schemaVersion: branch.version,
			category: meta.category,
			isMutation: meta.isMutation,
			emitters: meta.emitters,
			ownerRule: meta.ownerRule,
			...meta.transition !== void 0 ? { transition: meta.transition } : {},
			...meta.aggregate !== void 0 ? { aggregate: meta.aggregate } : {},
			semantics: meta.semantics
		});
	}
	const checkShape = (event) => {
		if (event === null || typeof event !== "object" || Array.isArray(event)) return {
			ok: false,
			errors: [{
				code: "ENVELOPE",
				message: `event must be a JSON object (got ${describeType(event)}) (HISTORY_EVENT_CATALOG §1)`
			}]
		};
		const type = event.eventType;
		if (typeof type !== "string") return {
			ok: false,
			errors: [{
				code: "ENVELOPE",
				path: "/eventType",
				message: `eventType must be a string (got ${describeValue(type)}) (HISTORY_EVENT_CATALOG §1)`
			}]
		};
		const validator = validators.get(type);
		if (validator === void 0) return {
			ok: false,
			errors: [{
				code: "ENVELOPE",
				path: "/eventType",
				message: `unknown eventType ${JSON.stringify(type)} (not one of the ${eventTypes.length} §4 catalog types; INV-HIST-4)`
			}]
		};
		if (!validator(event)) return {
			ok: false,
			errors: (validator.errors ?? []).map(shapeError)
		};
		return {
			ok: true,
			eventType: type
		};
	};
	return {
		schemaDir,
		isUsable: true,
		loadErrors: [],
		eventTypes,
		events: entries,
		checkShape
	};
}
function shapeError(err) {
	const params = err.params;
	let path = err.instancePath === "" ? void 0 : err.instancePath;
	if (err.keyword === "required" && typeof params.missingProperty === "string") path = `${err.instancePath}/${params.missingProperty}`;
	return {
		code: "ENVELOPE",
		path,
		message: summarize(err, params)
	};
}
function describeValue(value) {
	if (value === void 0) return "undefined";
	try {
		const text = JSON.stringify(value);
		if (text === void 0) return String(value);
		return text.length > 60 ? `${text.slice(0, 57)}…` : text;
	} catch {
		return String(value);
	}
}
function describeType(value) {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}
function summarize(err, params) {
	const got = ` (got ${describeValue(err.data)})`;
	switch (err.keyword) {
		case "required": return `missing required property "${String(params.missingProperty ?? "?")}" (HISTORY_EVENT_CATALOG §1/§5)`;
		case "additionalProperties": return `unexpected property "${String(params.additionalProperty ?? "?")}"${got} (payload is closed, INV-HIST-4)`;
		case "const": return `must equal ${JSON.stringify(params.allowedValue)}${got}`;
		case "enum": return `must be one of [${Array.isArray(params.allowedValues) ? params.allowedValues.map((v) => JSON.stringify(v)).join(" | ") : ""}]${got}`;
		case "pattern": return `must match pattern ${JSON.stringify(params.pattern)}${got}`;
		case "minLength": return `must have length >= ${String(params.limit)}${got}`;
		case "maxLength": return `must have length <= ${String(params.limit)}${got}`;
		case "minItems": return `must have >= ${String(params.limit)} item(s)${got}`;
		case "maxItems": return `must have <= ${String(params.limit)} item(s)${got}`;
		case "minimum": return `must be >= ${String(params.limit)}${got}`;
		case "maximum": return `must be <= ${String(params.limit)}${got}`;
		case "uniqueItems": return `must have unique items${got}`;
		case "type": return `must be of type ${String(params.type)}${got}`;
		case "format": return `invalid ${JSON.stringify(params.format)} value${got}`;
		default: return `${err.message ?? `failed ${err.keyword}`}${got}`;
	}
}
function errMsg$1(cause) {
	return cause instanceof Error ? cause.message : String(cause);
}
function compact(value) {
	try {
		const text = JSON.stringify(value);
		return text === void 0 ? String(value) : text.length > 120 ? `${text.slice(0, 117)}…` : text;
	} catch {
		return String(value);
	}
}
//#endregion
//#region src/host/history/registry/transitions.ts
/**
* The frozen §13 legal-transition table, keyed (machine → from → legal tos).
* Terminal states map to `[]`.
*/
const LEGAL_TRANSITIONS = {
	taskExecution: {
		PLANNED: [
			"ACTIVE",
			"EXECUTED",
			"CANCELLED"
		],
		ACTIVE: [
			"PAUSED",
			"EXECUTED",
			"CANCELLED"
		],
		PAUSED: [
			"ACTIVE",
			"EXECUTED",
			"CANCELLED"
		],
		EXECUTED: [],
		CANCELLED: []
	},
	taskValidation: {
		NOT_REQUIRED: ["PENDING"],
		PENDING: ["UNDER_REVIEW", "NOT_REQUIRED"],
		UNDER_REVIEW: ["PASSED", "FAILED"],
		PASSED: ["PENDING"],
		FAILED: ["PENDING"]
	},
	run: {
		RUNNING: [
			"FINISHED",
			"FAILED",
			"CANCELLED"
		],
		FINISHED: [],
		FAILED: [],
		CANCELLED: []
	},
	claim: {
		ACTIVE: ["RETRACTED"],
		RETRACTED: []
	},
	artifact: {
		REGISTERED: ["MISSING"],
		MISSING: ["REGISTERED"]
	},
	milestone: {
		PLANNED: ["ACHIEVED", "DROPPED"],
		ACHIEVED: [],
		DROPPED: []
	},
	gate: {
		PLANNED: [
			"PASSED",
			"FAILED",
			"WAIVED"
		],
		PASSED: [
			"PASSED",
			"FAILED",
			"WAIVED"
		],
		FAILED: [
			"PASSED",
			"FAILED",
			"WAIVED"
		],
		WAIVED: [
			"PASSED",
			"FAILED",
			"WAIVED"
		]
	},
	relation: {
		ACTIVE: ["REMOVED"],
		REMOVED: []
	},
	topologyEdge: {
		PLANNED: ["REALIZED", "DROPPED"],
		REALIZED: ["DROPPED"],
		DROPPED: []
	}
};
/** The legal target states of `from` on `machine` (`[]` = terminal). */
function legalTargets$1(machine, from) {
	return LEGAL_TRANSITIONS[machine][from] ?? [];
}
/** True iff `from -> to` appears in the §13 table for `machine` (INV-TASK-1). */
function isLegalTransition(machine, from, to) {
	return legalTargets$1(machine, from).includes(to);
}
//#endregion
//#region src/host/history/registry/relations.ts
/** All 24 object kinds (RELATED_TO is 任意 → 任意). */
const ALL_KINDS$1 = [
	"PROJECT",
	"TOPIC",
	"WORKSTREAM",
	"TASK",
	"GATE",
	"MILESTONE",
	"RUN",
	"CLAIM",
	"FACT",
	"ARTIFACT",
	"RELATION",
	"OBJECTIVE",
	"INTERVENTION",
	"NEXT_ACTION",
	"BLOCKER",
	"INTERACTION",
	"REPORTING_ITEM",
	"SCHEDULED_EVENT",
	"INBOX_ITEM",
	"PLAN_FORK",
	"TOPOLOGY_EDGE",
	"DISCOVERED_SESSION",
	"HISTORY_EVENT",
	"ANALYSIS_RECORD"
];
/** The frozen §8 组合表, one row per relation type. */
const RELATION_COMBINATION_TABLE$1 = {
	DEPENDS_ON: {
		sources: ["TASK", "GATE"],
		targets: [
			"TASK",
			"GATE",
			"MILESTONE"
		]
	},
	SUPPORTED_BY: {
		sources: ["CLAIM"],
		targets: [
			"FACT",
			"ARTIFACT",
			"CLAIM"
		]
	},
	CONTRADICTED_BY: {
		sources: ["CLAIM"],
		targets: [
			"FACT",
			"CLAIM",
			"ARTIFACT"
		]
	},
	DERIVED_FROM: {
		sources: ["FACT"],
		targets: ["ARTIFACT", "FACT"]
	},
	PRODUCED_BY: {
		sources: ["ARTIFACT"],
		targets: ["RUN"]
	},
	VALIDATED_BY: {
		sources: ["GATE"],
		targets: ["FACT", "ARTIFACT"]
	},
	CONSUMES: {
		sources: ["TASK", "RUN"],
		targets: ["ARTIFACT"]
	},
	CONTRIBUTES_TO: {
		sources: [
			"TASK",
			"WORKSTREAM",
			"CLAIM"
		],
		targets: ["OBJECTIVE"]
	},
	IMPLEMENTS: {
		sources: ["TASK"],
		targets: ["OBJECTIVE", "MILESTONE"]
	},
	RELATED_TO: {
		sources: ALL_KINDS$1,
		targets: ALL_KINDS$1
	}
};
/** True iff `source.kind → target.kind` is a listed combination for `relationType`. */
function isLegalRelationCombination$1(relationType, sourceKind, targetKind) {
	const row = RELATION_COMBINATION_TABLE$1[relationType];
	return row.sources.includes(sourceKind) && row.targets.includes(targetKind);
}
//#endregion
//#region src/host/history/registry/validate.ts
/** Object kinds that are workstream-local (DOMAIN_SCHEMA: they carry a WS). */
const WS_LOCAL_KINDS = /* @__PURE__ */ new Set([
	"TASK",
	"GATE",
	"MILESTONE",
	"RUN",
	"CLAIM",
	"FACT",
	"ARTIFACT",
	"WORKSTREAM"
]);
const SUBJECT_LABEL = {
	run: "Run",
	taskExecution: "Task execution",
	taskValidation: "Task validation",
	acSnapshot: "Task AC snapshot",
	claim: "Claim",
	artifact: "Artifact",
	relation: "Relation",
	milestone: "Milestone",
	topologyEdge: "Topology edge",
	gate: "Gate"
};
/**
* The object's CURRENT derived state (or `undefined` when the object does
* not exist in the snapshot). Gate current state = last evaluation result,
* `PLANNED` when never evaluated (§5.6).
*/
function currentStateOf(subject, id, ctx) {
	switch (subject) {
		case "run": return ctx.runs.get(id)?.status;
		case "taskExecution": return ctx.tasks.get(id)?.execution;
		case "taskValidation": return ctx.tasks.get(id)?.validation;
		case "acSnapshot": return ctx.tasks.get(id) !== void 0 ? JSON.stringify(ctx.tasks.get(id).acceptanceCriteria) : void 0;
		case "claim": return ctx.claims.get(id)?.status;
		case "artifact": return ctx.artifacts.get(id)?.status;
		case "relation": return ctx.relations.get(id)?.status;
		case "milestone": return ctx.milestones.get(id)?.status;
		case "topologyEdge": return ctx.topologyEdges.get(id)?.lifecycle;
		case "gate": {
			const gate = ctx.gates.get(id);
			return gate === void 0 ? void 0 : gate.lastResult ?? "PLANNED";
		}
	}
}
/**
* Transition consistency for one event (INV-HIST-5 + INV-TASK-1):
*  - object must exist (OBJECT_NOT_FOUND);
*  - `fromSource=payload` (mutation, M column ●): payload.from must EQUAL the
*    current derived state (FROM_MISMATCH) and (from,to) must be a legal §13
*    transition (ILLEGAL_TRANSITION); the acSnapshot machine compares text
*    snapshots (no state machine) and has no legal-transition step;
*  - `fromSource=implicit`: the current state must be one of the event's
*    declared implicit-from states (WRONG_STATE).
*/
function checkTransitionConsistency(event, entry, subject, id, idPath, declaredPath, ctx, push) {
	const transition = entry.transition;
	if (transition === void 0) return;
	const current = currentStateOf(subject, id, ctx);
	if (current === void 0) {
		push("OBJECT_NOT_FOUND", idPath, `${SUBJECT_LABEL[subject]} ${JSON.stringify(id)} does not exist (catalog §5: payload 内引用的对象存在)`);
		return;
	}
	const label = SUBJECT_LABEL[subject];
	if (transition.fromSource === "implicit") {
		const expected = transition.expectedFrom ?? [];
		if (!expected.includes(current)) push("WRONG_STATE", idPath, `${label} ${JSON.stringify(id)} is currently ${current}; ${event.eventType} requires ${expected.join(" | ")} (DOMAIN_SCHEMA §13)`);
		return;
	}
	const fromPath = `${declaredPath}/from`;
	const toPath = `${declaredPath}/to`;
	const payload = event.payload;
	const from = payload.from;
	const to = payload.to;
	if (transition.machine === "acSnapshot") {
		if (typeof from === "string" || Array.isArray(from) === false) {
			push("CROSS_FIELD", fromPath, `AC snapshot from must be a string[] (got ${describe$1(from)})`);
			return;
		}
		if (JSON.stringify(ctx.tasks.get(id).acceptanceCriteria) !== JSON.stringify(from)) {
			push("FROM_MISMATCH", fromPath, `Task ${JSON.stringify(id)} AC snapshot is currently ${JSON.stringify(ctx.tasks.get(id).acceptanceCriteria)}; event declares from=${JSON.stringify(from)} (INV-HIST-5: from must equal the current derived state)`);
			return;
		}
		if (Array.isArray(to) === false || to.some((item) => typeof item !== "string")) push("CROSS_FIELD", toPath, `AC snapshot to must be a string[] (got ${describe$1(to)})`);
		return;
	}
	const machine = transition.machine;
	if (typeof from !== "string") {
		push("CROSS_FIELD", fromPath, `${label} from must be a state string (got ${describe$1(from)}) (DOMAIN_SCHEMA §13)`);
		return;
	}
	if (from !== current) {
		push("FROM_MISMATCH", fromPath, `${label} ${JSON.stringify(id)} is currently ${current}; event declares from=${from} (INV-HIST-5: from must equal the current derived state; TC-HIST-001)`);
		return;
	}
	if (typeof to !== "string" || !isLegalTransition(machine, from, to)) {
		const legal = legalTargets$1(machine, from);
		push("ILLEGAL_TRANSITION", toPath, `illegal ${label.toLowerCase()} transition ${from} -> ${describe$1(to)}; ${legal.length === 0 ? `${from} is terminal` : `legal targets from ${from}: [${legal.join(", ")}]`} (DOMAIN_SCHEMA §13, INV-TASK-1)`);
	}
}
function describe$1(value) {
	try {
		const text = JSON.stringify(value);
		return text === void 0 ? String(value) : text;
	} catch {
		return String(value);
	}
}
/** The workstream a typed ref is local to (`undefined` = not workstream-local or missing). */
function workstreamOf(ref, ctx) {
	switch (ref.kind) {
		case "WORKSTREAM": return ctx.workstreams.has(ref.id) ? ref.id : void 0;
		case "TASK": return ctx.tasks.get(ref.id)?.workstreamId;
		case "GATE": return ctx.gates.get(ref.id)?.workstreamId;
		case "MILESTONE": return ctx.milestones.get(ref.id)?.workstreamId;
		case "RUN": return ctx.runs.get(ref.id)?.workstreamId;
		case "CLAIM": return ctx.claims.get(ref.id)?.workstreamId;
		case "FACT": return ctx.facts.get(ref.id)?.workstreamId;
		case "ARTIFACT": return ctx.artifacts.get(ref.id)?.workstreamId;
		default: return;
	}
}
/** Existence check for typed refs of workstream-local kinds (catalog §5 通用校验: referenced objects exist). */
function checkTypedRefs(refs, basePath, ctx, push) {
	if (refs === void 0) return;
	refs.forEach((ref, i) => {
		const path = `${basePath}/${i}`;
		if (!WS_LOCAL_KINDS.has(ref.kind)) return;
		if (!(ref.kind === "WORKSTREAM" ? ctx.workstreams.has(ref.id) : ref.kind === "TASK" ? ctx.tasks.has(ref.id) : ref.kind === "GATE" ? ctx.gates.has(ref.id) : ref.kind === "MILESTONE" ? ctx.milestones.has(ref.id) : ref.kind === "RUN" ? ctx.runs.has(ref.id) : ref.kind === "CLAIM" ? ctx.claims.has(ref.id) : ref.kind === "FACT" ? ctx.facts.has(ref.id) : ctx.artifacts.has(ref.id))) push("OBJECT_NOT_FOUND", path, `referenced ${ref.kind} ${JSON.stringify(ref.id)} does not exist (catalog §5: payload 内引用的对象存在)`);
	});
}
function checkTopologyRealize(event, op, ctx, push) {
	const payload = event.payload;
	const edge = ctx.topologyEdges.get(payload.topology_edge_id);
	if (edge === void 0) {
		push("OBJECT_NOT_FOUND", "/payload/topology_edge_id", `Topology edge ${JSON.stringify(payload.topology_edge_id)} does not exist (catalog §5.8: 存在)`);
		return;
	}
	if (edge.lifecycle !== "PLANNED") push("WRONG_STATE", "/payload/topology_edge_id", `Topology edge ${payload.topology_edge_id} has lifecycle ${edge.lifecycle}; only PLANNED edges can be realized (catalog §5.8: PLANNED)`);
	if (edge.operation !== op) push("CROSS_FIELD", "/payload/topology_edge_id", `Edge ${payload.topology_edge_id} is a ${edge.operation} edge; ${event.eventType} applies to ${op} edges (DOMAIN_SCHEMA §3.1)`);
	const mirror = (field) => {
		const declared = edge[field];
		const given = payload[field];
		if (given.length !== declared.length || given.some((id, i) => declared[i] !== id)) push("CROSS_FIELD", `/payload/${field}`, `${event.eventType} payload.${field} ${JSON.stringify(given)} must mirror the edge's declared ${field} ${JSON.stringify(declared)} (catalog §5.8)`);
	};
	mirror("inputs");
	mirror("outputs");
	const owner = op === "FORK" ? payload.inputs[0] : payload.outputs[0];
	if (owner === void 0) {
		push("OWNER_MISMATCH", "/ownerWorkstreamId", `${event.eventType} requires ${op === "FORK" ? "inputs[0]" : "outputs[0]"} as owner (schema enforces ≥1)`);
		return;
	}
	if (owner !== event.ownerWorkstreamId) push("OWNER_MISMATCH", "/ownerWorkstreamId", `Owner must be ${op === "FORK" ? "inputs[0]" : "outputs[0]"} = ${owner} (INV-HIST-9, catalog §5.8)`);
	const ownerWs = ctx.workstreams.get(event.ownerWorkstreamId);
	if (ownerWs !== void 0 && ownerWs.topicId !== edge.topicId) push("OWNER_MISMATCH", "/ownerWorkstreamId", `Owner workstream ${event.ownerWorkstreamId} is in topic ${ownerWs.topicId}; edge ${payload.topology_edge_id} belongs to topic ${edge.topicId} (catalog §5.8: 同 owner Topic)`);
}
/**
* Validate one candidate event against the registry and the state snapshot.
* Pure: never throws on validation failure (only on an unusable registry's
* impossible state — see REGISTRY_UNUSABLE), never mutates `event` or `ctx`.
*/
function validateEvent(registry, event, ctx) {
	if (!registry.isUsable) return {
		ok: false,
		errors: [{
			code: "REGISTRY_UNUSABLE",
			message: `registry is unusable (load errors: ${registry.loadErrors.map((e) => e.code).join(", ")}); see HistoryEventRegistry.loadErrors`
		}]
	};
	const shape = registry.checkShape(event);
	if (!shape.ok) return {
		ok: false,
		errors: shape.errors
	};
	const e = event;
	const entry = registry.events.get(e.eventType);
	const errors = [];
	const push = (code, path, message) => errors.push({
		code,
		path,
		message
	});
	if (!ctx.workstreams.has(e.ownerWorkstreamId)) push("OBJECT_NOT_FOUND", "/ownerWorkstreamId", `ownerWorkstreamId ${JSON.stringify(e.ownerWorkstreamId)} does not exist (catalog §5: ownerWorkstreamId 存在; INV-HIST-3)`);
	if (!entry.emitters.some((emitter) => emitter === e.actor.kind)) push("EMITTER_FORBIDDEN", "/actor/kind", `actor kind ${e.actor.kind} is not an allowed emitter for ${e.eventType} (allowed: [${entry.emitters.join(", ")}]) (catalog §3.6/§4 E column)`);
	if (e.actor.kind === "AGENT") {
		if (e.actor.run_id === void 0) push("CROSS_FIELD", "/actor/run_id", "AGENT actor must carry a run_id referencing the emitting Run (catalog §5: actor.run_id 对应 Run 存在)");
		else if (!ctx.runs.has(e.actor.run_id)) push("OBJECT_NOT_FOUND", "/actor/run_id", `actor.run_id ${JSON.stringify(e.actor.run_id)} does not reference an existing Run (catalog §5)`);
	}
	switch (e.eventType) {
		case "RUN_STARTED": {
			const p = e.payload;
			if (ctx.runs.has(p.run_id)) push("OBJECT_ALREADY_EXISTS", "/payload/run_id", `Run ${JSON.stringify(p.run_id)} already exists; RUN_STARTED requires a fresh run_id (catalog §5.1: 新建)`);
			if (p.task_id !== void 0) {
				const task = ctx.tasks.get(p.task_id);
				if (task === void 0) push("OBJECT_NOT_FOUND", "/payload/task_id", `Task ${JSON.stringify(p.task_id)} does not exist (catalog §5.1: 存在)`);
				else if (task.workstreamId !== e.ownerWorkstreamId) push("OWNER_MISMATCH", "/payload/task_id", `Task ${JSON.stringify(p.task_id)} belongs to workstream ${task.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §5.1: 属同 WS)`);
			}
			break;
		}
		case "RUNS_STARTED":
			e.payload.runs.forEach((run, i) => {
				if (ctx.runs.has(run.run_id)) push("OBJECT_ALREADY_EXISTS", `/payload/runs/${i}/run_id`, `Run ${JSON.stringify(run.run_id)} already exists; batch launches create fresh runs (catalog §5.1/§5.2: 新建)`);
				if (run.task_id !== void 0 && ctx.tasks.get(run.task_id) === void 0) push("OBJECT_NOT_FOUND", `/payload/runs/${i}/task_id`, `Task ${JSON.stringify(run.task_id)} does not exist (catalog §5.1: 存在)`);
			});
			break;
		case "RUN_FINISHED":
		case "RUN_FAILED":
		case "RUN_CANCELLED": {
			const p = e.payload;
			checkTransitionConsistency(e, entry, "run", p.run_id, "/payload/run_id", void 0, ctx, push);
			const run = ctx.runs.get(p.run_id);
			if (run !== void 0 && run.workstreamId !== e.ownerWorkstreamId) push("OWNER_MISMATCH", "/payload/run_id", `Run ${JSON.stringify(p.run_id)} belongs to workstream ${run.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §4: run 所属 WS)`);
			break;
		}
		case "TASK_EXECUTION_CHANGED": {
			const p = e.payload;
			const task = ctx.tasks.get(p.task_id);
			if (task === void 0) push("OBJECT_NOT_FOUND", "/payload/task_id", `Task ${JSON.stringify(p.task_id)} does not exist (catalog §5.2: 存在)`);
			else {
				if (task.workstreamId !== e.ownerWorkstreamId) push("OWNER_MISMATCH", "/payload/task_id", `Task ${JSON.stringify(p.task_id)} belongs to workstream ${task.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §5.2: 属 owner WS)`);
				checkTransitionConsistency(e, entry, "taskExecution", p.task_id, "/payload/task_id", "/payload", ctx, push);
			}
			break;
		}
		case "TASK_VALIDATION_CHANGED": {
			const p = e.payload;
			const task = ctx.tasks.get(p.task_id);
			if (task === void 0) push("OBJECT_NOT_FOUND", "/payload/task_id", `Task ${JSON.stringify(p.task_id)} does not exist (catalog §5.2: 存在)`);
			else {
				if (task.workstreamId !== e.ownerWorkstreamId) push("OWNER_MISMATCH", "/payload/task_id", `Task ${JSON.stringify(p.task_id)} belongs to workstream ${task.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §5.2: 属 owner WS)`);
				checkTransitionConsistency(e, entry, "taskValidation", p.task_id, "/payload/task_id", "/payload", ctx, push);
				if (p.to === "NOT_REQUIRED" && task.acceptanceCriteria.length > 0) push("CROSS_FIELD", "/payload/to", `to=NOT_REQUIRED requires empty acceptance_criteria; task ${p.task_id} has ${task.acceptanceCriteria.length} (INV-TASK-3, catalog §5.2)`);
			}
			break;
		}
		case "ACCEPTANCE_CRITERIA_CHANGED": {
			const p = e.payload;
			const task = ctx.tasks.get(p.task_id);
			if (task === void 0) push("OBJECT_NOT_FOUND", "/payload/task_id", `Task ${JSON.stringify(p.task_id)} does not exist (catalog §5.2: 存在)`);
			else {
				if (task.workstreamId !== e.ownerWorkstreamId) push("OWNER_MISMATCH", "/payload/task_id", `Task ${JSON.stringify(p.task_id)} belongs to workstream ${task.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §5.2)`);
				checkTransitionConsistency(e, entry, "acSnapshot", p.task_id, "/payload/task_id", "/payload", ctx, push);
			}
			break;
		}
		case "FACT_RECORDED": {
			const p = e.payload;
			if (ctx.facts.has(p.fact_id)) push("OBJECT_ALREADY_EXISTS", "/payload/fact_id", `Fact ${JSON.stringify(p.fact_id)} already exists; FACT_RECORDED requires a fresh fact_id (catalog §5.3: 新建)`);
			if (e.actor.kind === "AGENT" && p.created_by_run === void 0) push("CROSS_FIELD", "/payload/created_by_run", "FACT_RECORDED emitted by AGENT requires created_by_run (catalog §5.3: AGENT 发射时必填)");
			if (p.created_by_run !== void 0 && ctx.runs.get(p.created_by_run) === void 0) push("OBJECT_NOT_FOUND", "/payload/created_by_run", `Run ${JSON.stringify(p.created_by_run)} does not exist (catalog §5)`);
			break;
		}
		case "CLAIM_RECORDED": {
			const p = e.payload;
			if (ctx.claims.has(p.claim_id)) push("OBJECT_ALREADY_EXISTS", "/payload/claim_id", `Claim ${JSON.stringify(p.claim_id)} already exists; CLAIM_RECORDED requires a fresh claim_id (catalog §5.3: 新建)`);
			if (e.actor.kind === "AGENT" && p.created_by_run === void 0) push("CROSS_FIELD", "/payload/created_by_run", "CLAIM_RECORDED emitted by AGENT requires created_by_run (catalog §5.3: AGENT 发射时必填)");
			if (p.created_by_run !== void 0 && ctx.runs.get(p.created_by_run) === void 0) push("OBJECT_NOT_FOUND", "/payload/created_by_run", `Run ${JSON.stringify(p.created_by_run)} does not exist (catalog §5)`);
			break;
		}
		case "CLAIM_RETRACTED": {
			const p = e.payload;
			checkTransitionConsistency(e, entry, "claim", p.claim_id, "/payload/claim_id", void 0, ctx, push);
			const claim = ctx.claims.get(p.claim_id);
			if (claim !== void 0 && claim.workstreamId !== e.ownerWorkstreamId) push("OWNER_MISMATCH", "/payload/claim_id", `Claim ${JSON.stringify(p.claim_id)} belongs to workstream ${claim.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §4: claim 所属 WS)`);
			break;
		}
		case "ARTIFACT_REGISTERED": {
			const p = e.payload;
			if (ctx.artifacts.has(p.artifact_id)) push("OBJECT_ALREADY_EXISTS", "/payload/artifact_id", `Artifact ${JSON.stringify(p.artifact_id)} already exists; ARTIFACT_REGISTERED requires a fresh artifact_id (catalog §5.4: 新建)`);
			if (p.created_by_run !== void 0 && ctx.runs.get(p.created_by_run) === void 0) push("OBJECT_NOT_FOUND", "/payload/created_by_run", `Run ${JSON.stringify(p.created_by_run)} does not exist (catalog §5)`);
			if (p.related_task !== void 0) {
				const task = ctx.tasks.get(p.related_task);
				if (task === void 0) push("OBJECT_NOT_FOUND", "/payload/related_task", `Task ${JSON.stringify(p.related_task)} does not exist (catalog §5.4)`);
				else if (task.workstreamId !== e.ownerWorkstreamId) push("OWNER_MISMATCH", "/payload/related_task", `Task ${JSON.stringify(p.related_task)} belongs to workstream ${task.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §5.4: 属同 WS)`);
			}
			if (p.supersedes !== void 0 && ctx.artifacts.get(p.supersedes) === void 0) push("OBJECT_NOT_FOUND", "/payload/supersedes", `Artifact ${JSON.stringify(p.supersedes)} does not exist (catalog §5.4: supersedes 存在)`);
			break;
		}
		case "ARTIFACT_MARKED_MISSING": {
			const p = e.payload;
			checkTransitionConsistency(e, entry, "artifact", p.artifact_id, "/payload/artifact_id", void 0, ctx, push);
			const artifact = ctx.artifacts.get(p.artifact_id);
			if (artifact !== void 0 && artifact.workstreamId !== e.ownerWorkstreamId) push("OWNER_MISMATCH", "/payload/artifact_id", `Artifact ${JSON.stringify(p.artifact_id)} belongs to workstream ${artifact.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §4: artifact 所属 WS)`);
			break;
		}
		case "RELATION_ADDED": {
			const p = e.payload;
			if (ctx.relations.has(p.relation_id)) push("OBJECT_ALREADY_EXISTS", "/payload/relation_id", `Relation ${JSON.stringify(p.relation_id)} already exists; RELATION_ADDED requires a fresh relation_id (catalog §5.5: 新建)`);
			if (!isLegalRelationCombination$1(p.relation_type, p.source.kind, p.target.kind)) push("CROSS_FIELD", "/payload/relation_type", `${p.relation_type} from ${p.source.kind} to ${p.target.kind} is not in the frozen combination table (DOMAIN_SCHEMA §8, INV-REL-1/2: TARGET 始终是 SOURCE 的前提/来源/输入/证据/上位目标)`);
			const checkEndpoint = (ref, path) => {
				if (WS_LOCAL_KINDS.has(ref.kind) && workstreamOf(ref, ctx) === void 0) push("OBJECT_NOT_FOUND", path, `referenced ${ref.kind} ${JSON.stringify(ref.id)} does not exist (catalog §5)`);
			};
			checkEndpoint(p.source, "/payload/source");
			checkEndpoint(p.target, "/payload/target");
			const owner = workstreamOf(p.source, ctx) ?? workstreamOf(p.target, ctx);
			if (owner === void 0) push("OWNER_MISMATCH", "/ownerWorkstreamId", `Neither relation endpoint is workstream-local; V1 refuses to create such relations (no owner workstream) (DOMAIN_SCHEMA §8: 两端都非 workstream-local 的 relation 拒绝创建)`);
			else if (owner !== e.ownerWorkstreamId) push("OWNER_MISMATCH", "/ownerWorkstreamId", `Relation owner must be source.ws ?? target.ws = ${owner} (catalog §4 特例)`);
			break;
		}
		case "RELATION_REMOVED": {
			const p = e.payload;
			const relation = ctx.relations.get(p.relation_id);
			if (relation === void 0) push("OBJECT_NOT_FOUND", "/payload/relation_id", `Relation ${JSON.stringify(p.relation_id)} does not exist (catalog §5.5: 存在)`);
			else {
				if (relation.status !== "ACTIVE") push("WRONG_STATE", "/payload/relation_id", `Relation ${JSON.stringify(p.relation_id)} is ${relation.status}; RELATION_REMOVED requires ACTIVE (catalog §5.5)`);
				if (!(relation.source.kind === p.source.kind && relation.source.id === p.source.id && relation.relationType === p.relation_type && relation.target.kind === p.target.kind && relation.target.id === p.target.id)) push("CROSS_FIELD", "/payload/source", `Recorded source/relation_type/target must match the existing relation (audit redundancy, catalog §5.5); stored: source=${JSON.stringify(relation.source)} relation_type=${relation.relationType} target=${JSON.stringify(relation.target)}`);
				const owner = workstreamOf(relation.source, ctx) ?? workstreamOf(relation.target, ctx);
				if (owner === void 0) push("OWNER_MISMATCH", "/ownerWorkstreamId", `Neither endpoint of relation ${p.relation_id} is workstream-local; no owner workstream (DOMAIN_SCHEMA §8)`);
				else if (owner !== e.ownerWorkstreamId) push("OWNER_MISMATCH", "/ownerWorkstreamId", `Relation owner must be source.ws ?? target.ws = ${owner} (catalog §4 特例)`);
			}
			break;
		}
		case "GATE_EVALUATED": {
			const p = e.payload;
			const gate = ctx.gates.get(p.gate_id);
			if (gate === void 0) push("OBJECT_NOT_FOUND", "/payload/gate_id", `Gate ${JSON.stringify(p.gate_id)} does not exist (catalog §5.6: 存在)`);
			else if (gate.workstreamId !== e.ownerWorkstreamId) push("OWNER_MISMATCH", "/payload/gate_id", `Gate ${JSON.stringify(p.gate_id)} belongs to workstream ${gate.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §5.6: 属 owner WS)`);
			if (p.result === "WAIVED") {
				if (e.actor.kind !== "USER") push("CROSS_FIELD", "/payload/result", `WAIVED requires actor.kind=USER (got ${e.actor.kind}) (catalog §5.6: WAIVED 仅 actor.kind=USER 且 note 非空)`);
				if (p.note === void 0 || p.note.trim() === "") push("CROSS_FIELD", "/payload/note", "WAIVED requires a non-empty note (catalog §5.6: WAIVED 仅用户+理由)");
			}
			checkTypedRefs(p.evidence_refs, "/payload/evidence_refs", ctx, push);
			break;
		}
		case "MILESTONE_ACHIEVED": {
			const p = e.payload;
			const milestone = ctx.milestones.get(p.milestone_id);
			if (milestone === void 0) push("OBJECT_NOT_FOUND", "/payload/milestone_id", `Milestone ${JSON.stringify(p.milestone_id)} does not exist (catalog §5.6: 存在)`);
			else {
				if (milestone.workstreamId !== e.ownerWorkstreamId) push("OWNER_MISMATCH", "/payload/milestone_id", `Milestone ${JSON.stringify(p.milestone_id)} belongs to workstream ${milestone.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §5.6)`);
				checkTransitionConsistency(e, entry, "milestone", p.milestone_id, "/payload/milestone_id", void 0, ctx, push);
			}
			checkTypedRefs(p.evidence_refs, "/payload/evidence_refs", ctx, push);
			break;
		}
		case "INTERVENTION_CREATED": {
			const p = e.payload;
			if (ctx.interventions.has(p.intervention_id)) push("OBJECT_ALREADY_EXISTS", "/payload/intervention_id", `Intervention ${JSON.stringify(p.intervention_id)} already exists; INTERVENTION_CREATED requires a fresh intervention_id (catalog §5.7: 新建)`);
			if ((p.origin === "AUTO_FLOODING" || p.origin === "AUTO_AUDIT") && e.actor.kind !== "PLUGIN") push("CROSS_FIELD", "/payload/origin", `origin=${p.origin} requires actor.kind=PLUGIN (got ${e.actor.kind}) (catalog §5.7)`);
			checkTypedRefs(p.source_refs, "/payload/source_refs", ctx, push);
			const firstWs = (p.source_refs ?? []).map((ref) => workstreamOf(ref, ctx)).find((ws) => ws !== void 0);
			if (firstWs === void 0) push("OWNER_MISMATCH", "/ownerWorkstreamId", `Intervention has no workstream-related source ref; such interventions emit NO HistoryEvent (catalog §5.7: 完全无 WS 关联的 Intervention 不发事件)`);
			else if (firstWs !== e.ownerWorkstreamId) push("OWNER_MISMATCH", "/ownerWorkstreamId", `Owner must be the first related workstream ${firstWs} (workstream_ids[0] derived from source_refs, catalog §5.7)`);
			break;
		}
		case "TOPOLOGY_FORK_REALIZED":
			checkTopologyRealize(e, "FORK", ctx, push);
			break;
		case "TOPOLOGY_MERGE_REALIZED": checkTopologyRealize(e, "MERGE", ctx, push);
	}
	if (errors.length > 0) return {
		ok: false,
		errors
	};
	return {
		ok: true,
		eventType: e.eventType,
		ownerWorkstreamId: e.ownerWorkstreamId
	};
}
//#endregion
//#region src/host/history/registry/late-registration.ts
function byString(a, b) {
	if (a === b) return 0;
	if (a === void 0) return -1;
	if (b === void 0) return 1;
	return a < b ? -1 : 1;
}
/**
* Semantic replay order (catalog §2): `ORDER BY occurred_at, event_seq` —
* equal `occurredAt` tie-breaks on `eventSeq` (deterministic, TC-HIST-004);
* a cross-workstream residual tie (same occurredAt AND same seq in different
* owners) resolves on (ownerWorkstreamId, eventId) so the order is TOTAL and
* repeatable (TC-HIST-005). Returns a new array.
*/
function semanticOrder(events) {
	return [...events].sort((a, b) => a.occurredAt - b.occurredAt || a.eventSeq - b.eventSeq || byString(a.ownerWorkstreamId, b.ownerWorkstreamId) || byString(a.eventId, b.eventId));
}
/**
* Audit replay order (catalog §2): `ORDER BY event_seq` (registration order —
* a late-registered event stays at the TAIL, TC-HIST-002). The residual tie
* (same seq across owners) resolves on (ownerWorkstreamId, eventId). Returns a new array.
*/
function auditOrder(events) {
	return [...events].sort((a, b) => a.eventSeq - b.eventSeq || byString(a.ownerWorkstreamId, b.ownerWorkstreamId) || byString(a.eventId, b.eventId));
}
//#endregion
//#region src/host/history/replay/errors.ts
var ReplayError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.name = new.target.name;
		this.code = code;
	}
};
/** Malformed caller input; thrown BEFORE any I/O — nothing is side-effected. */
var ReplayInputError = class extends ReplayError {
	constructor(message, options) {
		super("REPLAY_INPUT", message, options);
	}
};
/** A reducer output that cannot be persisted to `derived_state`. */
var ReplayStateError = class extends ReplayError {
	constructor(message, options) {
		super("REPLAY_STATE", message, options);
	}
};
/** The independent `derived_state` transaction against the SQLite file failed. */
var ReplayApplyError = class extends ReplayError {
	constructor(message, options) {
		super("REPLAY_APPLY", message, options);
	}
};
//#endregion
//#region src/host/history/replay/state-map.ts
/**
* WP-2.3 — derived-state map: key format + strict-JSON + canonical form.
*
* The replay engine rebuilds the `derived_state` table (DOMAIN_SCHEMA §15
* L627: PK `(object_kind, object_id)`, `state` JSON, 「replaced wholesale」,
* rebuildable by replay — TC-HIST-006). In memory that table is a map keyed
* by a single STRING `objectKind:objectId` (no object id in the frozen id
* alphabet — T-1 / R-1 / WS-1 / H-1001 / TPC-1 / … — contains a colon, so
* the separator is unambiguous).
*
* Value discipline mirrors the store's (WP-2.1 `safeStringify`): only
* STRICT JSON values are persistable (the store silently-drops guard); a
* reducer output that is not strict JSON is a reducer bug and is rejected
* with REPLAY_STATE before any write.
*
* `canonicalJson` (sorted object keys) is the equality form used by
* `compareDerivedStates` (rebuild-vs-incremental consistency, TC-HIST-006):
* the incremental path (store `safeStringify`) and the rebuild path may
* store the same document with different KEY ORDER — semantic equality is
* what the consistency check measures.
*/
const SEPARATOR = ":";
/** Compose the derived-state key for (objectKind, objectId). */
function stateKey(objectKind, objectId) {
	assertKeyPart(objectKind, "objectKind");
	assertKeyPart(objectId, "objectId");
	return `${objectKind}${SEPARATOR}${objectId}`;
}
function assertKeyPart(value, what) {
	if (typeof value !== "string" || value.length === 0) throw new ReplayStateError(`${what} must be a non-empty string (derived_state key part)`);
	if (value.includes(SEPARATOR)) throw new ReplayStateError(`${what} must not contain "${SEPARATOR}" (the derived_state key separator)`);
}
/** Split a derived-state key back into (objectKind, objectId). */
function parseStateKey(key) {
	if (typeof key !== "string" || key.length === 0) throw new ReplayStateError("derived_state key must be a non-empty string");
	const i = key.indexOf(SEPARATOR);
	if (i <= 0 || i === key.length - 1 || key.indexOf(SEPARATOR, i + 1) !== -1) throw new ReplayStateError(`derived_state key "${key}" is malformed — expected "<objectKind>:<objectId>" with exactly one separator and non-empty parts`);
	const objectKind = key.slice(0, i);
	const objectId = key.slice(i + 1);
	assertKeyPart(objectKind, "objectKind");
	assertKeyPart(objectId, "objectId");
	return {
		objectKind,
		objectId
	};
}
/**
* Strict-JSON gate (mirrors WP-2.1 `assertJsonValue`): only null, string,
* boolean, FINITE number, arrays and PLAIN objects (no Date/RegExp/Map/custom
* class, no symbol keys, no undefined values) are persistable. Depth-capped
* (64). Throws {@link ReplayStateError} — a reducer emitting any other value
* would be silently corrupted by `JSON.stringify`, so it is rejected.
*/
function assertStrictJson(value, what, depth = 0) {
	if (depth > 64) throw new ReplayStateError(`${what}: nesting deeper than 64 levels — refusing to persist`);
	if (value === null) return;
	const t = typeof value;
	if (t === "string" || t === "boolean") return;
	if (t === "number") {
		if (!Number.isFinite(value)) throw new ReplayStateError(`${what}: non-finite number (NaN/±Infinity are not JSON)`);
		return;
	}
	if (t === "function" || t === "symbol" || t === "bigint" || t === "undefined") throw new ReplayStateError(`${what}: not a strict JSON value (got ${t})`);
	if (Array.isArray(value)) {
		for (const item of value) assertStrictJson(item, what, depth + 1);
		return;
	}
	const obj = value;
	const proto = Object.getPrototypeOf(obj);
	if (proto !== Object.prototype && proto !== null) throw new ReplayStateError(`${what}: contains a non-plain object (${obj.constructor?.name ?? "unknown"}) — strict JSON only (no Date/RegExp/Map/...)`);
	if (Object.getOwnPropertySymbols(obj).length > 0) throw new ReplayStateError(`${what}: contains symbol-keyed properties — not JSON`);
	for (const v of Object.values(obj)) assertStrictJson(v, what, depth + 1);
}
/**
* Canonical JSON: objects with keys sorted lexicographically (arrays keep
* order). The deterministic equality form for derived-state documents —
* two states are semantically equal iff their canonical forms are byte
* equal. The input must be strict JSON (assert first).
*/
function canonicalJson(value) {
	assertStrictJson(value, "derived_state value");
	return stringifyCanonical(value);
}
function stringifyCanonical(value) {
	if (value === null) return "null";
	const t = typeof value;
	if (t === "string" || t === "boolean") return JSON.stringify(value);
	if (t === "number") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((v) => stringifyCanonical(v)).join(",")}]`;
	const obj = value;
	return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stringifyCanonical(obj[k])}`).join(",")}}`;
}
//#endregion
//#region src/host/history/replay/query.ts
/**
* Collect ALL events of the listed workstreams and merge them into one
* deterministic total order (`semantic` = occurredAt, eventSeq, owner, id;
* `audit` = eventSeq, owner, id — the WP-2.2 total orders, TC-HIST-005).
* A project-wide replay/timeline helper; `rebuildDerivedState` uses the
* audit merge. Duplicate workstream ids are fetched once. A workstream
* with no events contributes nothing (a PLANNED WS without events is
* legal). Full scan by design (a full replay is O(total) — TC-PERF-001/002
* measure it; pagination is the O(window) path, see {@link queryEvents}).
*/
function collectAllEvents(store, workstreams, order) {
	assertOrder(order);
	if (!Array.isArray(workstreams)) throw new ReplayInputError("collectAllEvents: workstreams must be an array");
	const all = [...new Set(workstreams.map(assertWorkstreamId$1))].flatMap((ws) => store.listRange(ws, 1));
	return order === "semantic" ? semanticOrder(all) : auditOrder(all);
}
function assertWorkstreamId$1(value) {
	if (typeof value !== "string" || value.length === 0) throw new ReplayInputError("ownerWorkstreamId must be a non-empty string");
	return value;
}
function assertOrder(order) {
	if (order !== "semantic" && order !== "audit") throw new ReplayInputError(`query order must be "semantic" or "audit" (got ${JSON.stringify(String(order))})`);
}
//#endregion
//#region src/host/history/replay/rebuild.ts
/**
* WP-2.3 — derived_state rebuild from the event log (TC-HIST-006;
* TC-DB-002's「派生列重建能力」) + the rebuild-vs-incremental consistency
* verification framework.
*
* Semantics pinned by the frozen contract:
*   - DOMAIN_SCHEMA §15 L627: `derived_state` is a REBUILDABLE cache —
*     「与事件 append 同事务写入；可由 replay 重建（TC-HIST-006）」. The
*     SAME-TRANSACTION write is the NORMAL path (WP-2.1 `appendEvents`'
*     `derivedState` patches); this module owns the REBUILD path.
*   - HISTORY_EVENT_CATALOG §6 L279: 「从空 DB 按 audit 顺序重放全部事件可
*     重建所有派生列（测试 TC-HIST-006）；重放不得产生新的 HistoryEvent」 —
*     the rebuild replays in CANONICAL AUDIT ORDER (eventSeq,
*     ownerWorkstreamId, eventId — the WP-2.2 `auditOrder` total order),
*     and structurally cannot write the event table (below).
*   - DOMAIN_SCHEMA §15 通则: state columns are History's derived caches,
*     rebuildable by replay; `derived_state` is deliberately NOT
*     first-class identity (INV-HIST-7) — the store's schema keeps it
*     updatable precisely for this.
*
* WRITE-PATH DECISION (read §15, per WP boundary note): the WP-2.1 store
* deliberately exposes NO derived-only write seam (its only write is
* `appendEvents`, which always writes event rows + assigns seqs — using it
* for a rebuild would append events, i.e. the exact thing §6 forbids).
* This WP therefore rebuilds through an INDEPENDENT TRANSACTION:
*   1. READ — the store's public read face only (`listRange`);
*   2. FOLD — in memory, audit order, via `foldEvents` (no I/O);
*   3. WRITE — ONE `BEGIN IMMEDIATE` transaction on a second connection to
*      the SAME WAL file, touching ONLY `derived_state`
*      (DELETE + INSERT all rows — 「replaced wholesale」), then close.
* The transaction is atomic (crash ⇒ pre- or post-, never partial), is
* fully disjoint from any event append (a concurrent `appendEvents`
* `BEGIN IMMEDIATE` holds the write lock; one side waits per busy_timeout
* or fails clean), and CANNOT touch `history_event` — even a raw SQL write
* there is aborted by the WP-2.1 storage triggers (INV-HIST-1,
* TC-HIST-003). The tests assert the event table is byte-identical around
* a rebuild.
*
* CONSISTENCY PRECONDITION (why `compareDerivedStates` exists): the
* rebuild folds in canonical audit order, so the INCREMENTAL maintainer
* must apply events in that same order for the two to agree. A single-WS
* log is compliant automatically; a cross-workstream batch must be
* appended in canonical (eventSeq, owner) order. Any drift (reorder,
* patch loss) surfaces as a non-empty `ConsistencyReport` — that is the
* framework's job: it does not fix, it DETECTS and localizes.
*/
/**
* Read the live `derived_state` table (the incrementally maintained side of
* the consistency check). READ-ONLY by construction: the connection is
* opened `readOnly: true`, so a write through it is a driver-level
* structural impossibility, not a policy. Used by the verification
* framework / tests; the incremental writer (service, later WP) keeps its
* own in-memory copy and does not need this.
*/
function readDerivedState(store) {
	if (typeof store?.path !== "string" || store.path.length === 0) throw new ReplayInputError("readDerivedState: store.path must be a non-empty string");
	let db;
	try {
		db = new DatabaseSync(store.path, { readOnly: true });
	} catch (e) {
		throw toApplyError(`readDerivedState: cannot open ${store.path}`, e);
	}
	try {
		const rows = db.prepare("SELECT object_kind, object_id, state FROM derived_state").all();
		const out = /* @__PURE__ */ new Map();
		for (const row of rows) {
			const key = `${String(row.object_kind)}:${String(row.object_id)}`;
			out.set(key, safeParseState(String(row.state), key));
		}
		return out;
	} catch (e) {
		if (e instanceof ReplayError) throw e;
		throw toApplyError(`readDerivedState: ${store.path}`, e);
	} finally {
		try {
			db.close();
		} catch {}
	}
}
/**
* Deep-compare a REBUILT derived-state table against the INCREMENTALLY
* maintained one (canonical-JSON equality per row; keys compared as the
* union, sorted for deterministic reports). This is the TC-HIST-006
* 「所有派生列与原状态一致」 check made reusable: it neither writes nor
* fixes — it localizes drift (missing row / extra row / changed value).
*/
function compareDerivedStates(rebuilt, incremental) {
	const keys = [.../* @__PURE__ */ new Set([...rebuilt.keys(), ...incremental.keys()])].sort();
	const onlyInRebuilt = [];
	const onlyInIncremental = [];
	const differing = [];
	for (const key of keys) {
		const inRebuilt = rebuilt.has(key);
		const inIncremental = incremental.has(key);
		if (inRebuilt && !inIncremental) onlyInRebuilt.push(key);
		else if (!inRebuilt && inIncremental) onlyInIncremental.push(key);
		else if (canonicalJson(rebuilt.get(key)) !== canonicalJson(incremental.get(key))) differing.push({
			key,
			rebuilt: rebuilt.get(key),
			incremental: incremental.get(key)
		});
	}
	return {
		ok: onlyInRebuilt.length === 0 && onlyInIncremental.length === 0 && differing.length === 0,
		rebuiltCount: rebuilt.size,
		incrementalCount: incremental.size,
		onlyInRebuilt,
		onlyInIncremental,
		differing
	};
}
function toApplyError(context, e) {
	return new ReplayApplyError(`${context}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
}
function safeParseState(raw, key) {
	try {
		return JSON.parse(raw);
	} catch (e) {
		throw new ReplayApplyError(`derived_state[${key}].state is not valid JSON — corruption`, { cause: e });
	}
}
//#endregion
//#region src/host/service/flooding/types.ts
/** The 4 frozen Intervention origins (attention.schema.json `origin` enum). */
const INTERVENTION_ORIGINS = [
	"USER",
	"AGENT_REPORT",
	"AUTO_FLOODING",
	"AUTO_AUDIT"
];
/**
* The 3 Intervention states (DOMAIN_SCHEMA §13: `OPEN ↔ PENDING`;
* `OPEN | PENDING → CLOSED` 终态; 仅用户显式修改, INV-PERM-4).
*/
const IV_STATUSES = [
	"OPEN",
	"PENDING",
	"CLOSED"
];
var FloodingError = class extends Error {
	code;
	constructor(init) {
		super(init.message, init.cause === void 0 ? void 0 : { cause: init.cause });
		this.name = "FloodingError";
		this.code = init.code;
	}
};
function isFloodingError(error) {
	return error instanceof FloodingError;
}
/** §8 规则原文（证据可读性 + 测试锚点）。 */
const FLOODING_RULE = "count(status == OPEN, per workstream) > threshold";
/** 冻结 idWorkstream 模式（common.schema.json `^WS-[1-9][0-9]*$`）。 */
const WS_ID_PATTERN$1 = /^WS-[1-9][0-9]*$/;
/**
* §8 判定（module header 规则原文的机械实现）。
*
* 输入校验（FLOODING_INPUT, 精确指名失败项）:
*   - `workstreamId` 非空且过冻结 WS id 模式;
*   - `asOf` 非负 safe-integer epoch ms（§1.2/A-3）;
*   - `threshold`（提供时）= safe-integer **≥ 1**（冻结 policy schema
*     `flooding.threshold`: integer minimum 1 — 0 非法, 同 WP-3.1 policy 负例）;
*   - `planForks` 数组; 每元素 `id` 非空且**全部属 `workstreamId`**（跨 WS
*     混合 ⇒ 拒绝 — per-WS 口径的结构性保证, 不静默过滤）; id 不重复。
*/
function detectPlanForkFlooding(params) {
	const ws = params?.workstreamId;
	if (typeof ws !== "string" || ws.length === 0) throw new FloodingError({
		code: "FLOODING_INPUT",
		message: "workstreamId must be a non-empty string"
	});
	if (!WS_ID_PATTERN$1.test(ws)) throw new FloodingError({
		code: "FLOODING_INPUT",
		message: `workstreamId ${JSON.stringify(ws)} is not a well-formed WS id (common.schema.json idWorkstream: ^WS-[1-9][0-9]*$)`
	});
	const asOf = params.asOf;
	if (typeof asOf !== "number" || !Number.isSafeInteger(asOf) || asOf < 0) throw new FloodingError({
		code: "FLOODING_INPUT",
		message: `asOf must be a non-negative safe integer epoch ms (got ${String(asOf)}; §1.2/A-3)`
	});
	const threshold = params.threshold ?? 5;
	if (typeof threshold !== "number" || !Number.isSafeInteger(threshold) || threshold < 1) throw new FloodingError({
		code: "FLOODING_INPUT",
		message: `threshold must be an integer >= 1 (got ${String(threshold)}; 冻结 policy schema flooding.threshold: integer minimum 1, default 5 — PLAN_FORK_SPEC §8/§9)`
	});
	const forks = params.planForks;
	if (!Array.isArray(forks)) throw new FloodingError({
		code: "FLOODING_INPUT",
		message: "planForks must be an array (the in-window PF records of ONE workstream)"
	});
	const seen = /* @__PURE__ */ new Set();
	for (let i = 0; i < forks.length; i++) {
		const pf = forks[i];
		if (pf === null || typeof pf !== "object") throw new FloodingError({
			code: "FLOODING_INPUT",
			message: `planForks[${i}] must be a PlanFork record (got ${typeof pf})`
		});
		const id = pf.id;
		if (typeof id !== "string" || id.length === 0) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: `planForks[${i}].id must be a non-empty string`
		});
		if (seen.has(id)) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: `planForks contains duplicate PF id ${JSON.stringify(id)} (the in-window record set must be a set)`
		});
		seen.add(id);
		const pfWs = pf.workstream_id;
		if (pfWs !== ws) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: `planForks[${i}] (${id}) belongs to ${JSON.stringify(String(pfWs))}, not ${JSON.stringify(ws)} — flooding counts are PER WORKSTREAM (A-15 口径, 用户确认); pass that workstream's own records`
		});
		const status = pf.status;
		if (typeof status !== "string" || !PF_STATUSES.includes(status)) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: `planForks[${i}].status must be one of ${PF_STATUSES.join("|")} (got ${JSON.stringify(String(status))})`
		});
		const createdAt = pf.created_at;
		if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt < 0) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: `planForks[${i}].created_at must be a non-negative safe integer epoch ms (got ${String(createdAt)})`
		});
	}
	const openPfIds = forks.filter((pf) => pf.status === "OPEN").sort((a, b) => a.created_at === b.created_at ? a.id < b.id ? -1 : a.id > b.id ? 1 : 0 : a.created_at - b.created_at).map((pf) => pf.id);
	const count = openPfIds.length;
	const evidence = {
		workstream_id: ws,
		window: {
			kind: "OPEN_STATE",
			as_of: asOf,
			open_pf_ids: openPfIds
		},
		count,
		threshold,
		rule: FLOODING_RULE
	};
	if (!(count > threshold)) return {
		triggered: false,
		suppressed: false,
		reason: "COUNT_AT_OR_BELOW_THRESHOLD",
		evidence
	};
	if (params.hasOpenAutoFloodingIntervention === true) return {
		triggered: true,
		suppressed: true,
		reason: "OPEN_AUTO_FLOODING_EXISTS",
		evidence
	};
	return {
		triggered: true,
		suppressed: false,
		evidence
	};
}
//#endregion
//#region src/host/service/flooding/intervention.ts
/** §8 动作的发射者（AUTO_FLOODING ⇒ PLUGIN; 与 WP-2.4 自动登记同款 label）。 */
const AUTO_FLOODING_PLUGIN_ACTOR = {
	kind: "PLUGIN",
	label: "research-control"
};
/** 冻结 IV id 模式（common.schema.json idIntervention）。 */
const IV_ID_PATTERN$1 = /^IV-[1-9][0-9]*$/;
/** 冻结 H id 模式（common.schema.json idHistoryEvent; 与 WP-2.1 一致）。 */
const H_ID_PATTERN = /^H-[1-9][0-9]*$/;
/** §8 原文 title（逐字: `Review accumulated agent plan forks [WS-<n>]`）。 */
function autoFloodingInterventionTitle(workstreamId) {
	return `Review accumulated agent plan forks [${workstreamId}]`;
}
/**
* §8 证据的机械 detail 摘要（确定性格式 — 窗口/计数/阈值/open PF 列表全在;
* 不判断科研理由, INV-SCI-2 同精神: 只陈述计数事实）。
*/
function buildAutoFloodingDetail(evidence) {
	return `auto flooding (PLAN_FORK_SPEC §8): ${evidence.workstream_id} count(OPEN)=${evidence.count} > threshold=${evidence.threshold}; window=${evidence.window.kind} as_of=${evidence.window.as_of}; open_pf=[${evidence.window.open_pf_ids.join(", ")}]`;
}
/**
* §8 动作的 Intervention 记录（11 键冻结形状, 初始 OPEN, origin=AUTO_FLOODING）。
* 输入校验: IV id 模式 / 证据窗口非空（触发的定义即 count > threshold ≥ 1）/
* created_at epoch。
*/
function buildAutoFloodingIntervention(params) {
	const id = params.id;
	if (typeof id !== "string" || !IV_ID_PATTERN$1.test(id)) throw new FloodingError({
		code: "FLOODING_INPUT",
		message: `intervention id ${JSON.stringify(String(id))} is not a well-formed IV id (common.schema.json idIntervention: ^IV-[1-9][0-9]*$)`
	});
	const createdAt = params.createdAt;
	if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt < 0) throw new FloodingError({
		code: "FLOODING_INPUT",
		message: `createdAt must be a non-negative safe integer epoch ms (got ${String(createdAt)}; §1.2/A-3)`
	});
	const evidence = params.evidence;
	if (evidence.window.open_pf_ids.length === 0) throw new FloodingError({
		code: "FLOODING_INPUT",
		message: "evidence window is empty — an AUTO_FLOODING intervention requires the OPEN PF set that tripped the threshold (PLAN_FORK_SPEC §8 source_refs=[相关 PF])"
	});
	return {
		id,
		title: autoFloodingInterventionTitle(evidence.workstream_id),
		detail: buildAutoFloodingDetail(evidence),
		origin: "AUTO_FLOODING",
		workstream_ids: [evidence.workstream_id],
		source_refs: evidence.window.open_pf_ids.map((pfId) => ({
			kind: "PLAN_FORK",
			id: pfId
		})),
		status: "OPEN",
		created_by: AUTO_FLOODING_PLUGIN_ACTOR,
		created_at: createdAt
	};
}
/**
* §5.7 INTERVENTION_CREATED 事件（module header: payload 逐字 + owner 规则 +
* WORKSTREAM ref 打头的 V1 适配）。无 WS 关联的记录大声失败（§5.7: 完全无
* WS 关联的 Intervention 不发事件 — 不该走到构造）。
*/
function buildInterventionCreatedEvent(params) {
	const eventId = params.eventId;
	if (typeof eventId !== "string" || !H_ID_PATTERN.test(eventId)) throw new FloodingError({
		code: "FLOODING_INPUT",
		message: `eventId ${JSON.stringify(String(eventId))} is not a well-formed H id (^H-[1-9][0-9]*$)`
	});
	const occurredAt = params.occurredAt;
	if (typeof occurredAt !== "number" || !Number.isSafeInteger(occurredAt) || occurredAt < 0) throw new FloodingError({
		code: "FLOODING_INPUT",
		message: `occurredAt must be a non-negative safe integer epoch ms (got ${String(occurredAt)}; §1.2/A-3)`
	});
	const record = params.record;
	const workstreamId = record.workstream_ids[0];
	if (typeof workstreamId !== "string" || workstreamId.length === 0) throw new FloodingError({
		code: "FLOODING_INPUT",
		message: `intervention ${record.id} has no associated workstream — such interventions emit NO HistoryEvent (catalog §5.7); nothing to build`
	});
	return {
		eventId,
		ownerWorkstreamId: workstreamId,
		eventType: "INTERVENTION_CREATED",
		schemaVersion: 1,
		occurredAt,
		actor: record.created_by,
		payload: {
			intervention_id: record.id,
			title: record.title,
			origin: record.origin,
			source_refs: [{
				kind: "WORKSTREAM",
				id: workstreamId
			}, ...record.source_refs]
		}
	};
}
//#endregion
//#region src/host/service/flooding/state-machine.ts
/**
* WP-3.5 — Intervention 状态机（DOMAIN_SCHEMA §13 冻结表, 纯函数面）。
*
* §13 原文:
*   Intervention | `OPEN ↔ PENDING`; `OPEN | PENDING → CLOSED`（终态;
*                 重开 = 新 Intervention）; **仅用户**
*
* 冻结表:
*   OPEN    → PENDING | CLOSED
*   PENDING → OPEN    | CLOSED
*   CLOSED  → （终态, 无出口; 重开 = 新 Intervention, 不是迁移）
*
* INV-PERM-4（「Intervention 状态只允许用户显式修改」）的**类型面**落地:
* 本模块只交付纯判定函数（供未来用户面 WP 与其测试消费）——本 WP 的
* `InterventionStore` **没有任何迁移/更新方法**（API 面零迁移口, 测试以
* 原型键审计钉死）, service 同样无迁移操作。非用户（AGENT/PLUGIN/SYSTEM）
* 因此在本 WP 交付物中**不存在**任何可调用面。存储层另以 trigger 限制
* 内容列 UPDATE（状态缓存列 status/closed_at/resolution_note 是冻结
* 迁移语义的唯一合法行侧面, 供未来用户面使用）。
*/
/** §13 冻结迁移表（逐字: OPEN ↔ PENDING; OPEN|PENDING → CLOSED 终态）。 */
const IV_TRANSITIONS = {
	OPEN: ["PENDING", "CLOSED"],
	PENDING: ["OPEN", "CLOSED"],
	CLOSED: []
};
/** 类型守卫（冻结 3 值）。 */
function isIvStatus(value) {
	return typeof value === "string" && IV_STATUSES.includes(value);
}
/** `from` 的合法目标集（终态 = 空集）。 */
function legalInterventionTargets(from) {
	return IV_TRANSITIONS[from];
}
/** §13 合法性判定（自环一律非法 — 表中无自环边）。 */
function isLegalInterventionTransition(from, to) {
	return IV_TRANSITIONS[from].includes(to);
}
/**
* §13 门（非法迁移抛 FLOODING_ILLEGAL_TRANSITION, 消息列合法集 + 终态点名 —
* 同 WP-3.1 `checkPfTransition` 纪律）。本 WP 无调用面; 交付给未来用户面
* WP（actor 门 = USER, INV-PERM-4）与测试。
*/
function checkInterventionTransition(id, from, to) {
	if (!isIvStatus(from)) throw new FloodingError({
		code: "FLOODING_INPUT",
		message: `checkInterventionTransition: from must be one of ${IV_STATUSES.join("|")} (got ${JSON.stringify(String(from))})`
	});
	if (!isIvStatus(to)) throw new FloodingError({
		code: "FLOODING_INPUT",
		message: `checkInterventionTransition: to must be one of ${IV_STATUSES.join("|")} (got ${JSON.stringify(String(to))})`
	});
	if (!isLegalInterventionTransition(from, to)) {
		const legal = legalInterventionTargets(from);
		throw new FloodingError({
			code: "FLOODING_ILLEGAL_TRANSITION",
			message: `illegal intervention transition for ${JSON.stringify(id)}: ${from} -> ${to}; ` + (legal.length === 0 ? `${from} is terminal (DOMAIN_SCHEMA §13; 重开 = 新 Intervention)` : `legal targets from ${from}: [${legal.join(", ")}] (DOMAIN_SCHEMA §13, INV-TASK-1)`) + " — and transitions are USER-only (INV-PERM-4); this WP provides no transition face"
		});
	}
}
//#endregion
//#region src/host/service/flooding/schemas.ts
/**
* WP-3.5 — frozen operational attention schema loading (loader pattern,
* 同 WP-3.1 `loadPlanForkSchemas` / WP-2.5 `loadSemanticSchemas`)。
*
* 通过注入的 `ResearchFileReader` 装载**冻结** `schema/operational/
* attention.schema.json`（+ 父 `schema/common.schema.json` 的
* idIntervention/typedRef/actorRef/epochMs/idWorkstream refs）:
*
*   - 校验器直接取自冻结文档（`ajv.getSchema($id + '#/$defs/Intervention')`）
*     — 零派生 schema, 零 `schema/` 改写（冻结只读）;
*   - 失败聚合（loadErrors; isUsable=false ⇒ `InterventionStore` 拒绝写入,
*     fail loud — 绝不在无 schema 时放行, 同 WP-3.1 PF_SCHEMA_UNAVAILABLE）;
*   - AJV 2020-12（冻结 `$schema` 方言）, allErrors + verbose（精确定位）,
*     useDefaults off（operational 记录无 schema 默认 — 每字段显式）。
*
* 消费: `InterventionStore.insertIntervention`（行落库前的整行冻结形状网 —
* 类型面同构的运行时保证）+ tests/flooding 的模型往返断言面。
*/
/**
* 装载 + 编译冻结 attention schema。聚合失败, 永不抛（loader 模式）。
*/
function loadInterventionSchemas(reader, schemaDir) {
	const errors = [];
	const ajv = new Ajv2020({
		allErrors: true,
		strict: false,
		verbose: true
	});
	addFormats(ajv);
	const readJson = (path) => {
		let text;
		try {
			text = reader.readFile(path);
		} catch (cause) {
			errors.push({
				path,
				message: `schema file read failed: ${cause instanceof Error ? cause.message : String(cause)}`
			});
			return null;
		}
		if (text === null) {
			errors.push({
				path,
				message: `schema file not found (schemaDir=${schemaDir})`
			});
			return null;
		}
		try {
			return JSON.parse(text);
		} catch (cause) {
			errors.push({
				path,
				message: `schema file is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
			});
			return null;
		}
	};
	const common = readJson(pjoin(schemaDir, "..", "common.schema.json"));
	if (common === null || typeof common.$id !== "string") {
		errors.push({
			path: pjoin(schemaDir, "..", "common.schema.json"),
			message: "common.schema.json is missing or has no $id"
		});
		return unavailable$2(schemaDir, errors);
	}
	try {
		ajv.addSchema(common, common.$id);
	} catch (cause) {
		errors.push({
			path: pjoin(schemaDir, "..", "common.schema.json"),
			message: `common.schema.json rejected: ${cause instanceof Error ? cause.message : String(cause)}`
		});
		return unavailable$2(schemaDir, errors);
	}
	const doc = readJson(pjoin(schemaDir, "attention.schema.json"));
	if (doc === null || typeof doc.$id !== "string") {
		errors.push({
			path: pjoin(schemaDir, "attention.schema.json"),
			message: "attention.schema.json is missing or has no $id"
		});
		return unavailable$2(schemaDir, errors);
	}
	try {
		ajv.addSchema(doc, doc.$id);
	} catch (cause) {
		errors.push({
			path: pjoin(schemaDir, "attention.schema.json"),
			message: `attention.schema.json rejected: ${cause instanceof Error ? cause.message : String(cause)}`
		});
		return unavailable$2(schemaDir, errors);
	}
	const recordValidator = ajv.getSchema(`${doc.$id}#/$defs/Intervention`);
	if (recordValidator === void 0) {
		errors.push({
			path: pjoin(schemaDir, "attention.schema.json"),
			message: "schema compile failed for $defs/Intervention"
		});
		return unavailable$2(schemaDir, errors);
	}
	return {
		schemaDir,
		isUsable: true,
		loadErrors: [],
		checkInterventionShape: (record) => runCheck$2(recordValidator, record)
	};
}
function mapErrors$2(validator) {
	return (validator.errors ?? []).map((err) => ({
		path: err.instancePath,
		message: schemaErrorSummary(err)
	}));
}
function runCheck$2(validator, value) {
	if (validator(value)) return {
		ok: true,
		errors: []
	};
	return {
		ok: false,
		errors: mapErrors$2(validator)
	};
}
function unavailable$2(schemaDir, errors) {
	const unavailableCheck = {
		ok: false,
		errors: [{
			path: "",
			message: "intervention schema set unavailable — see InterventionSchemas.loadErrors"
		}]
	};
	return {
		schemaDir,
		isUsable: false,
		loadErrors: errors,
		checkInterventionShape: () => unavailableCheck
	};
}
//#endregion
//#region src/host/service/flooding/schema.ts
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
const INTERVENTION_TABLE = "intervention";
const DDL$3 = `
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
`;
/** Full DDL (idempotent — re-applied on every store open, 同 WP-3.1 先例). */
function interventionDdl() {
	return DDL$3;
}
const SQL_INSERT_INTERVENTION = `
INSERT INTO ${INTERVENTION_TABLE} (id, title, detail, origin, workstream_ids, source_refs, status, created_by, created_at, closed_at, resolution_note)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const SQL_SELECT_INTERVENTION_BY_ID = `SELECT * FROM ${INTERVENTION_TABLE} WHERE id = ?`;
/**
* §8 规则后半句的探针: OPEN AUTO_FLOODING Intervention 候选行（WS 关联在
* JSON 列内 — node:sqlite 无 JSON 函数, WS 成员过滤在 JS 侧, 见 store）。
* 行序 created_at ASC, id ASC（探针取第一个）。
*/
const SQL_FIND_OPEN_AUTO_FLOODING = `
SELECT * FROM ${INTERVENTION_TABLE}
WHERE origin = 'AUTO_FLOODING' AND status = 'OPEN'
ORDER BY created_at ASC, id ASC
`;
const CORRUPT$4 = (what, detail) => {
	throw new Error(`flooding row corruption at ${what}: ${detail}`);
};
function decodeJson$4(value, what) {
	if (typeof value !== "string") return CORRUPT$4(what, `expected JSON string, got ${typeof value}`);
	try {
		return JSON.parse(value);
	} catch (cause) {
		return CORRUPT$4(what, `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
	}
}
/** Encode `InterventionRecord` into the INSERT parameter list（列序 = DDL）。 */
function interventionToParams(r) {
	return [
		r.id,
		r.title,
		r.detail ?? null,
		r.origin,
		JSON.stringify(r.workstream_ids.map((ws) => ws)),
		JSON.stringify(r.source_refs.map((ref) => ({
			kind: ref.kind,
			id: ref.id
		}))),
		r.status,
		JSON.stringify(r.created_by),
		r.created_at,
		r.closed_at ?? null,
		r.resolution_note ?? null
	];
}
/** Decode an `intervention` row back to the record（throws on corruption）。 */
function rowToIntervention(row) {
	const status = row.status;
	if (typeof status !== "string" || !IV_STATUSES.includes(status)) return CORRUPT$4("intervention.status", `unknown status ${JSON.stringify(String(status))}`);
	const origin = row.origin;
	if (typeof origin !== "string" || !INTERVENTION_ORIGINS.includes(origin)) return CORRUPT$4("intervention.origin", `unknown origin ${JSON.stringify(String(origin))}`);
	for (const name of [
		"id",
		"title",
		"workstream_ids",
		"source_refs",
		"created_by"
	]) if (typeof row[name] !== "string") return CORRUPT$4(`intervention.${name}`, `expected string, got ${typeof row[name]}`);
	if (typeof row.created_at !== "number") return CORRUPT$4("intervention.created_at", `expected number, got ${typeof row.created_at}`);
	const workstreamIds = decodeJson$4(row.workstream_ids, "intervention.workstream_ids");
	for (const ws of workstreamIds) if (typeof ws !== "string") return CORRUPT$4("intervention.workstream_ids", `element must be a string (got ${typeof ws})`);
	const sourceRefs = decodeJson$4(row.source_refs, "intervention.source_refs");
	for (const ref of sourceRefs) if (ref === null || typeof ref !== "object" || typeof ref.kind !== "string" || typeof ref.id !== "string") return CORRUPT$4("intervention.source_refs", `element must be a {kind, id} typedRef`);
	return {
		id: row.id,
		title: row.title,
		origin,
		workstream_ids: workstreamIds,
		source_refs: sourceRefs,
		status,
		created_by: decodeJson$4(row.created_by, "intervention.created_by"),
		created_at: row.created_at,
		...row.detail != null ? { detail: String(row.detail) } : {},
		...row.closed_at != null ? { closed_at: row.closed_at } : {},
		...row.resolution_note != null ? { resolution_note: String(row.resolution_note) } : {}
	};
}
//#endregion
//#region src/host/service/flooding/store.ts
/**
* WP-3.5 — `InterventionStore`: AUTO_FLOODING Intervention 落库 + 查询面
* （append-only; 无 delete, 无迁移 — INV-HIST-7 / INV-PERM-4 的 API 面）。
*
* 写入面（本 WP 唯一写入者 = `FloodingService` 的 §8 动作路径）:
*   - `insertIntervention(record)` — 记录带已分配 IV id（service 协调
*     IV+H 双号, 见 service.ts）; 落库前整行过**真实冻结**
*     `$defs/Intervention`（schemas.ts — 类型面同构的运行时网, 同
*     WP-3.1 `checkRecordShape` 纪律; 不可用 ⇒ FLOODING_SCHEMA_UNAVAILABLE
*     fail loud, 绝不在无 schema 时放行）。
*
* 查询面:
*   - `getIntervention(id)` / `listInterventions({workstreamId?, status?,
*     origin?})`（§15 索引 (status) + per-WS/origin 面; 稳定顺序
*     created_at ASC, id ASC）;
*   - `findOpenAutoFlooding(workstreamId)` — §8 规则后半句 + 任务「重复
*     抑制」的探针: 该 WS 已存在 origin=AUTO_FLOODING 的 OPEN Intervention
*     ⇒ 不重复建。
*
* 不变量（API 面）:
*   - **无 delete 方法**（§15 通则 / INV-HIST-7; 存储层 trigger 兜底任何
*     连接的 raw DELETE）;
*   - **无任何迁移/更新方法**（INV-PERM-4「Intervention 状态只允许用户
*     显式修改」— 本 WP 不提供任何非用户迁移面, 类型面即闭集; 状态缓存列
*     的 UPDATE 触发面留给未来用户面 WP, 存储层 trigger 已钉内容列不可动）。
*
* 错误纪律（同 WP-3.1）: `FloodingError` 原样穿透（caller-owned）;
* 驱动/SQL 失败包 FLOODING_STORE（cause 保留）。
*/
var InterventionStore = class {
	db;
	schemas;
	closed = false;
	constructor(options) {
		if (options.db === void 0 || typeof options.db.exec !== "function" || typeof options.db.run !== "function") throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "db: the injected operational-DB face (exec/run/get/all/transaction) is required"
		});
		if (options.schemas === void 0 || typeof options.schemas.checkInterventionShape !== "function") throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "schemas: the frozen attention schema face (loadInterventionSchemas) is required"
		});
		this.db = options.db;
		this.schemas = options.schemas;
		this.db.exec(interventionDdl());
	}
	/**
	* Insert ONE intervention row（单语句 autocommit — 事件 append 在
	* WP-2.1 store 连接上先行, 两连接间无跨事务, service.ts 头注）。
	* 落库前: 整行冻结形状网（FLOODING_SCHEMA_UNAVAILABLE / FLOODING_INPUT）。
	*/
	insertIntervention(record) {
		this.#assertOpen("insertIntervention");
		this.#assertShape(record);
		if (!this.schemas.isUsable) throw new FloodingError({
			code: "FLOODING_SCHEMA_UNAVAILABLE",
			message: "frozen attention schema set unavailable — no intervention row can be shape-checked (see InterventionSchemas.loadErrors)"
		});
		const shape = this.schemas.checkInterventionShape(record);
		if (!shape.ok) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: `internal: intervention record failed the frozen attention schema: ${shape.errors.map((e) => `${e.path || "/"}: ${e.message}`).join(" | ")}`
		});
		try {
			this.db.run(SQL_INSERT_INTERVENTION, ...interventionToParams(record));
		} catch (cause) {
			throw this.#wrap("insertIntervention", cause);
		}
		return record;
	}
	/** 冻结形状前的廉价边界断言（精确指名失败项 — 同 WP-3.1 assertEpoch 纪律）。 */
	#assertShape(record) {
		if (record === null || typeof record !== "object") throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "insertIntervention: record must be an InterventionRecord object"
		});
		if (typeof record.id !== "string" || !/^IV-[1-9][0-9]*$/.test(record.id)) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: `insertIntervention: id must be a well-formed IV id (got ${JSON.stringify(String(record.id))})`
		});
		if (typeof record.title !== "string" || record.title.length === 0) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "insertIntervention: title must be a non-empty string (§9.2)"
		});
		if (typeof record.origin !== "string" || !INTERVENTION_ORIGINS.includes(record.origin)) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: `insertIntervention: origin must be one of ${INTERVENTION_ORIGINS.join("|")} (got ${JSON.stringify(String(record.origin))})`
		});
		if (typeof record.status !== "string" || !IV_STATUSES.includes(record.status)) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: `insertIntervention: status must be one of ${IV_STATUSES.join("|")} (got ${JSON.stringify(String(record.status))})`
		});
		if (!Array.isArray(record.workstream_ids) || record.workstream_ids.some((ws) => typeof ws !== "string" || ws.length === 0)) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "insertIntervention: workstream_ids must be an array of non-empty WS id strings (§9.2)"
		});
		if (!Array.isArray(record.source_refs) || record.source_refs.some((ref) => ref === null || typeof ref !== "object" || typeof ref.kind !== "string" || typeof ref.id !== "string")) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "insertIntervention: source_refs must be an array of {kind, id} typedRefs (§9.2)"
		});
		if (record.created_by === null || typeof record.created_by !== "object" || typeof record.created_by.kind !== "string") throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "insertIntervention: created_by must be a frozen actorRef (kind ∈ USER|AGENT|PLUGIN|SYSTEM; §9.2)"
		});
		if (typeof record.created_at !== "number" || !Number.isSafeInteger(record.created_at) || record.created_at < 0) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: `insertIntervention: created_at must be a non-negative safe integer epoch ms (got ${String(record.created_at)}; §1.2/A-3)`
		});
	}
	/** One record by id（`null` when absent）。 */
	getIntervention(id) {
		this.#assertOpen("getIntervention");
		assertNonEmpty$1(id, "id");
		const row = this.db.get(SQL_SELECT_INTERVENTION_BY_ID, id);
		return row === void 0 ? null : rowToIntervention(row);
	}
	/**
	* List by (workstreamId?, status?, origin?) — 稳定顺序
	* created_at ASC, id ASC。status/origin 走 SQL（§15 索引 (status)）;
	* workstreamId 过滤 = workstream_ids **含**该 WS（关联语义, 非仅第一个）
	* — WS 关联在 JSON 列内, node:sqlite 无 JSON 函数 ⇒ JS 侧成员过滤。
	*/
	listInterventions(filter = {}) {
		this.#assertOpen("listInterventions");
		const clauses = [];
		const params = [];
		if (filter.workstreamId !== void 0) assertNonEmpty$1(filter.workstreamId, "filter.workstreamId");
		if (filter.status !== void 0) {
			if (typeof filter.status !== "string" || !IV_STATUSES.includes(filter.status)) throw new FloodingError({
				code: "FLOODING_INPUT",
				message: `filter.status must be one of ${IV_STATUSES.join("|")} (got ${JSON.stringify(String(filter.status))})`
			});
			clauses.push("status = ?");
			params.push(filter.status);
		}
		if (filter.origin !== void 0) {
			if (typeof filter.origin !== "string" || !INTERVENTION_ORIGINS.includes(filter.origin)) throw new FloodingError({
				code: "FLOODING_INPUT",
				message: `filter.origin must be one of ${INTERVENTION_ORIGINS.join("|")} (got ${JSON.stringify(String(filter.origin))})`
			});
			clauses.push("origin = ?");
			params.push(filter.origin);
		}
		const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
		let records = this.db.all(`SELECT * FROM ${INTERVENTION_TABLE} ${where} ORDER BY created_at ASC, id ASC`, ...params).map((r) => rowToIntervention(r));
		if (filter.workstreamId !== void 0) {
			const ws = filter.workstreamId;
			records = records.filter((r) => r.workstream_ids.includes(ws));
		}
		return records;
	}
	/**
	* §8 规则后半句 / 重复抑制探针: 该 WS 是否存在 origin=AUTO_FLOODING 的
	* OPEN Intervention（存在 ⇒ 不重复建 — 同 WS 已有 OPEN 时不重复建）。
	* WS 成员在 JS 侧判定（JSON 列; node:sqlite 无 JSON 函数）, 取
	* created_at ASC, id ASC 第一个。
	*/
	findOpenAutoFlooding(workstreamId) {
		this.#assertOpen("findOpenAutoFlooding");
		assertNonEmpty$1(workstreamId, "workstreamId");
		const rows = this.db.all(SQL_FIND_OPEN_AUTO_FLOODING);
		for (const row of rows) {
			const record = rowToIntervention(row);
			if (record.workstream_ids.includes(workstreamId)) return record;
		}
		return null;
	}
	#assertOpen(operation) {
		if (this.closed) throw new FloodingError({
			code: "FLOODING_STORE",
			message: `${operation}: store is closed`
		});
	}
	/** Test/inspection seam（no-op 语义: store 无生命周期状态可关）。 */
	close() {
		this.closed = true;
	}
	#wrap(context, cause) {
		return new FloodingError({
			code: "FLOODING_STORE",
			message: `${context}: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause
		});
	}
};
function assertNonEmpty$1(value, what) {
	if (typeof value !== "string" || value.length === 0) throw new FloodingError({
		code: "FLOODING_INPUT",
		message: `${what} must be a non-empty string`
	});
}
//#endregion
//#region src/host/service/flooding/service.ts
var FloodingService = class {
	#store;
	#registry;
	#planForks;
	#interventions;
	#allocator;
	#projectId;
	#reader;
	#researchRoot;
	#schemaDir;
	#externalState;
	#now;
	constructor(options) {
		if (options.store === void 0 || options.store === null || typeof options.store.appendEvents !== "function") throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "store: a WP-2.1 ResearchStore is required"
		});
		if (options.registry === void 0 || options.registry === null) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "registry: a WP-2.2 event registry is required"
		});
		if (options.planForks === void 0 || options.planForks === null || typeof options.planForks.listPlanForks !== "function") throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "planForks: a WP-3.1 PlanForkStore is required"
		});
		if (options.interventions === void 0 || options.interventions === null || typeof options.interventions.insertIntervention !== "function") throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "interventions: an InterventionStore is required"
		});
		if (options.allocator === void 0 || options.allocator === null || typeof options.allocator.reserve !== "function") throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "allocator: the shared IdAllocator is required"
		});
		if (options.researchFileReader === void 0 || options.researchFileReader === null || typeof options.researchFileReader.readFile !== "function") throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "researchFileReader: a .research file reader is required"
		});
		if (typeof options.projectId !== "string" || options.projectId.length === 0) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "projectId must be a non-empty string"
		});
		if (typeof options.researchRoot !== "string" || options.researchRoot.length === 0) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "researchRoot must be a non-empty string"
		});
		if (typeof options.schemaDir !== "string" || options.schemaDir.length === 0) throw new FloodingError({
			code: "FLOODING_INPUT",
			message: "schemaDir must be a non-empty string"
		});
		this.#store = options.store;
		this.#registry = options.registry;
		this.#planForks = options.planForks;
		this.#interventions = options.interventions;
		this.#allocator = options.allocator;
		this.#projectId = options.projectId;
		this.#reader = options.researchFileReader;
		this.#researchRoot = options.researchRoot;
		this.#schemaDir = options.schemaDir;
		this.#externalState = options.externalState ?? (() => ({ workstreams: /* @__PURE__ */ new Map() }));
		this.#now = options.now ?? Date.now;
	}
	/**
	* §8 触发点 1 — 每次 PF 创建后（宿主接线 WP 在 `createPlanFork` 提交后
	* 调用; `pf` = 刚创建的记录, 仅用于信息性 — 检测读库不读参数, 刚创建的
	* 行已在库内）。返回值仅信息性: 不阻止创建（§8 V1）。
	*/
	onPlanForkCreated(pf) {
		if (pf === null || typeof pf !== "object" || typeof pf.workstream_id !== "string" || pf.workstream_id.length === 0) return {
			workstream_id: "",
			trigger: "PLAN_FORK_CREATED",
			checked: false,
			blocked: false,
			error: {
				code: "FLOODING_INPUT",
				message: "onPlanForkCreated: pf must be a PlanForkRecord with a non-empty workstream_id"
			}
		};
		return this.#checkWorkstream(pf.workstream_id, "PLAN_FORK_CREATED");
	}
	/** §8 触发点 2 — 每次 plan 加载后（宿主接线 WP 在 canonical plan 加载后调用）。 */
	onPlanLoaded(workstreamId) {
		return this.#checkWorkstream(workstreamId, "PLAN_LOADED");
	}
	#checkWorkstream(workstreamId, trigger) {
		const base = {
			workstream_id: workstreamId,
			trigger,
			checked: false,
			blocked: false
		};
		if (typeof workstreamId !== "string" || workstreamId.length === 0) return {
			...base,
			workstream_id: "",
			error: {
				code: "FLOODING_INPUT",
				message: `${trigger}: workstreamId must be a non-empty string`
			}
		};
		const asOf = this.#now();
		let threshold;
		try {
			const policyResult = loadPlanForkPolicy(this.#reader, this.#researchRoot, this.#schemaDir);
			if (policyResult.policy === null) return {
				...base,
				error: {
					code: "FLOODING_POLICY",
					message: policyResult.errors.map((e) => e.message).join("; ")
				}
			};
			threshold = policyResult.policy.flooding.threshold;
		} catch (cause) {
			return {
				...base,
				error: {
					code: "FLOODING_POLICY",
					message: `policy load failed: ${describe(cause)}`
				}
			};
		}
		let openForks;
		try {
			openForks = this.#planForks.listPlanForks({
				workstreamId,
				status: "OPEN"
			});
		} catch (cause) {
			return {
				...base,
				error: {
					code: "FLOODING_STORE",
					message: `open PF window read failed: ${describe(cause)}`
				}
			};
		}
		let existing;
		try {
			existing = this.#interventions.findOpenAutoFlooding(workstreamId);
		} catch (cause) {
			return {
				...base,
				error: {
					code: "FLOODING_STORE",
					message: `suppression probe failed: ${describe(cause)}`
				}
			};
		}
		let verdict;
		try {
			verdict = detectPlanForkFlooding({
				workstreamId,
				planForks: openForks,
				threshold,
				hasOpenAutoFloodingIntervention: existing !== null,
				asOf
			});
		} catch (cause) {
			return {
				...base,
				checked: true,
				error: {
					code: isFloodingError(cause) ? cause.code : "FLOODING_INPUT",
					message: describe(cause)
				}
			};
		}
		if (!verdict.triggered || verdict.suppressed) return {
			...base,
			checked: true,
			verdict
		};
		let ivRes = null;
		let hRes = null;
		const releaseAll = () => {
			for (const res of [ivRes, hRes]) {
				if (res === null) continue;
				try {
					this.#allocator.release(res);
				} catch {}
			}
		};
		try {
			ivRes = this.#allocator.reserve("INTERVENTION", this.#projectId);
			hRes = this.#allocator.reserve("HISTORY_EVENT", this.#projectId);
			let record;
			try {
				record = buildAutoFloodingIntervention({
					id: ivRes.id,
					evidence: verdict.evidence,
					createdAt: asOf
				});
			} catch (cause) {
				releaseAll();
				return {
					...base,
					checked: true,
					verdict,
					error: {
						code: isFloodingError(cause) ? cause.code : "FLOODING_INPUT",
						message: describe(cause)
					}
				};
			}
			let event;
			try {
				event = buildInterventionCreatedEvent({
					eventId: hRes.id,
					record,
					occurredAt: record.created_at
				});
			} catch (cause) {
				releaseAll();
				return {
					...base,
					checked: true,
					verdict,
					error: {
						code: isFloodingError(cause) ? cause.code : "FLOODING_INPUT",
						message: describe(cause)
					}
				};
			}
			let appended;
			try {
				appended = this.#store.appendEvents([event], { validate: makeValidateHook$2(this.#registry, () => this.#buildEventContext(ivRes.id)) }).events[0];
			} catch (cause) {
				releaseAll();
				return {
					...base,
					checked: true,
					verdict,
					error: {
						code: isFloodingError(cause) ? cause.code : "FLOODING_EVENT",
						message: describe(cause)
					}
				};
			}
			try {
				this.#interventions.insertIntervention(record);
			} catch (cause) {
				releaseAll();
				return {
					...base,
					checked: true,
					verdict,
					error: {
						code: isFloodingError(cause) ? cause.code : "FLOODING_STORE",
						message: describe(cause)
					}
				};
			}
			this.#allocator.commit(ivRes);
			this.#allocator.commit(hRes);
			return {
				...base,
				checked: true,
				verdict,
				intervention_id: record.id,
				event_id: appended.eventId
			};
		} catch (cause) {
			releaseAll();
			return {
				...base,
				checked: true,
				verdict,
				error: {
					code: isFloodingError(cause) ? cause.code : "FLOODING_STORE",
					message: describe(cause)
				}
			};
		}
	}
	/**
	* INTERVENTION_CREATED 的校验 ctx（module header ③）: interventions map
	* = 现行所有行 **排除本批新建 IV id**（「新建」检查语义 — 同 WP-2.4
	* excludeRunIds 先例）; workstreams = 注入的声明式侧快照（WORKSTREAM ref
	* 存在性 + owner 推导, catalog §5.7）; 其余 map 空（validator 对本事件
	* 只查 interventions/workstreams/source refs）。
	*/
	#buildEventContext(excludeInterventionId) {
		const interventions = /* @__PURE__ */ new Map();
		for (const row of this.#interventions.listInterventions()) {
			if (row.id === excludeInterventionId) continue;
			interventions.set(row.id, { workstreamIds: row.workstream_ids });
		}
		return {
			workstreams: this.#externalState().workstreams,
			tasks: /* @__PURE__ */ new Map(),
			runs: /* @__PURE__ */ new Map(),
			claims: /* @__PURE__ */ new Map(),
			facts: /* @__PURE__ */ new Map(),
			artifacts: /* @__PURE__ */ new Map(),
			relations: /* @__PURE__ */ new Map(),
			gates: /* @__PURE__ */ new Map(),
			milestones: /* @__PURE__ */ new Map(),
			interventions,
			topologyEdges: /* @__PURE__ */ new Map()
		};
	}
};
/**
* store `validate` hook 工厂: 批内每个事件过**冻结 registry** 校验
* （payload 严格性 INV-HIST-4 / 存在性 / owner 规则 / 发射者矩阵 —
* AUTO_FLOODING ⇒ actor.kind=PLUGIN 的 CROSS_FIELD 亦在此钉）, 任一失败
* 抛结构化 `FloodingError`（FLOODING_EVENT）⇒ store 全批回滚
* （未过校验的事件永不落地）。registry 不可用 ⇒ fail loud。
*/
function makeValidateHook$2(registry, buildContext) {
	return (events) => {
		if (!registry.isUsable) throw new FloodingError({
			code: "FLOODING_EVENT",
			message: `the event registry is unusable (load errors: ${registry.loadErrors.map((e) => e.code).join(", ")}); refusing to append an unvalidated event`
		});
		const ctx = buildContext();
		for (const event of events) {
			const result = validateEvent(registry, event, ctx);
			if (!result.ok) throw new FloodingError({
				code: "FLOODING_EVENT",
				message: `${event.eventType} (${event.eventId}) rejected by the frozen registry: ` + result.errors.map((e) => `[${e.code}] ${e.message}`).join("; ")
			});
		}
	};
}
function describe(cause) {
	return cause instanceof Error ? cause.message : String(cause);
}
//#endregion
//#region src/host/service/actions/types.ts
/** 本模块的唯一错误载体（caller-owned — 同 PlanForkError 纪律）。 */
var ActionsError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.name = "ActionsError";
		this.code = code;
	}
};
const ID_PATTERNS = {
	ws: /^WS-[1-9][0-9]*$/,
	task: /^T-[1-9][0-9]*$/,
	run: /^R-[1-9][0-9]*$/,
	objective: /^OBJ-[1-9][0-9]*$/
};
/** 冻结 actorRef 形状校验（common.schema.json：kind 枚举；run_id 前缀；label ≤200）。 */
function assertActorShape(actor, context) {
	if (actor === null || typeof actor !== "object" || typeof actor.kind !== "string" || ![
		"USER",
		"AGENT",
		"PLUGIN",
		"SYSTEM"
	].includes(actor.kind)) throw new ActionsError("ACT_INPUT", `${context}: actor must be a frozen actorRef (kind ∈ USER|AGENT|PLUGIN|SYSTEM; got ${JSON.stringify(actor)})`);
	const a = actor;
	if (a.run_id !== void 0 && !ID_PATTERNS.run.test(a.run_id)) throw new ActionsError("ACT_INPUT", `${context}: actor.run_id ${JSON.stringify(a.run_id)} is not a well-formed R id (common.schema.json actorRef)`);
	if (a.label !== void 0 && (typeof a.label !== "string" || a.label.length > 200)) throw new ActionsError("ACT_INPUT", `${context}: actor.label must be a string of ≤200 chars (common.schema.json actorRef)`);
}
//#endregion
//#region src/host/service/actions/schema.ts
const NEXT_ACTION_TABLE = "next_action";
const BLOCKER_TABLE = "blocker";
const DDL$2 = `
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
`;
/** Full DDL (idempotent — re-applied on every store open, 同 WP-3.1 先例). */
function actionsDdl() {
	return DDL$2;
}
const SQL_INSERT_NEXT_ACTION = `
INSERT INTO ${NEXT_ACTION_TABLE} (id, workstream_id, statement, rationale, status, promoted_to_task_id, created_by, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;
const SQL_SELECT_NEXT_ACTION_BY_ID = `SELECT * FROM ${NEXT_ACTION_TABLE} WHERE id = ?`;
/**
* §13 迁移的条件 UPDATE（乐观并发门 — 同 WP-3.1 planfork 先例）:
* `WHERE id=? AND status='PROPOSED'` ⇒ 并发双迁移只有一个成功; 0 行由
* 调用方重读判别 NA_NOT_FOUND / NA_WRONG_STATE。
*/
const SQL_TRANSITION_NEXT_ACTION = `
UPDATE ${NEXT_ACTION_TABLE} SET status = ?, promoted_to_task_id = ? WHERE id = ? AND status = 'PROPOSED'
`;
const SQL_INSERT_BLOCKER = `
INSERT INTO ${BLOCKER_TABLE} (id, statement, affects, status, source, "references", created_at, cleared_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;
const SQL_SELECT_BLOCKER_BY_ID = `SELECT * FROM ${BLOCKER_TABLE} WHERE id = ?`;
/** §13 迁移的条件 UPDATE（乐观并发门）: `WHERE id=? AND status='ACTIVE'`。 */
const SQL_TRANSITION_BLOCKER = `
UPDATE ${BLOCKER_TABLE} SET status = ?, cleared_at = ? WHERE id = ? AND status = 'ACTIVE'
`;
const CORRUPT$3 = (what, detail) => {
	throw new Error(`actions row corruption at ${what}: ${detail}`);
};
function decodeJson$3(value, what) {
	if (typeof value !== "string") return CORRUPT$3(what, `expected JSON string, got ${typeof value}`);
	try {
		return JSON.parse(value);
	} catch (cause) {
		return CORRUPT$3(what, `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
	}
}
const NA_STATUSES$1 = [
	"PROPOSED",
	"PROMOTED",
	"DISMISSED"
];
const BLK_STATUSES$1 = ["ACTIVE", "CLEARED"];
const AFFECTS_KINDS = [
	"WORKSTREAM",
	"TASK",
	"RUN"
];
/** Encode `NextActionRecord` into the INSERT parameter list（列序 = DDL）。 */
function nextActionToParams(r) {
	return [
		r.id,
		r.workstream_id ?? null,
		r.statement,
		r.rationale ?? null,
		r.status,
		r.promoted_to_task_id ?? null,
		JSON.stringify(r.created_by),
		r.created_at
	];
}
/** Decode a `next_action` row back to the record（throws on corruption）。 */
function rowToNextAction(row) {
	const status = row.status;
	if (typeof status !== "string" || !NA_STATUSES$1.includes(status)) return CORRUPT$3("next_action.status", `unknown status ${JSON.stringify(String(status))}`);
	for (const name of [
		"id",
		"statement",
		"created_by"
	]) if (typeof row[name] !== "string") return CORRUPT$3(`next_action.${name}`, `expected string, got ${typeof row[name]}`);
	if (typeof row.created_at !== "number") return CORRUPT$3("next_action.created_at", `expected number, got ${typeof row.created_at}`);
	const affectedTaskId = row.promoted_to_task_id;
	if (affectedTaskId !== null && typeof affectedTaskId !== "string") return CORRUPT$3("next_action.promoted_to_task_id", `expected string or null, got ${typeof affectedTaskId}`);
	return {
		id: row.id,
		statement: row.statement,
		status,
		created_by: decodeJson$3(row.created_by, "next_action.created_by"),
		created_at: row.created_at,
		...row.workstream_id != null ? { workstream_id: String(row.workstream_id) } : {},
		...row.rationale != null ? { rationale: String(row.rationale) } : {},
		...affectedTaskId != null ? { promoted_to_task_id: String(affectedTaskId) } : {}
	};
}
/** Encode `BlockerRecord` into the INSERT parameter list（列序 = DDL）。 */
function blockerToParams(r) {
	return [
		r.id,
		r.statement,
		JSON.stringify(r.affects.map((ref) => ({
			kind: ref.kind,
			id: ref.id
		}))),
		r.status,
		r.source,
		r.references !== void 0 ? JSON.stringify(r.references) : null,
		r.created_at,
		r.cleared_at ?? null
	];
}
/** Decode a `blocker` row back to the record（throws on corruption）。 */
function rowToBlocker(row) {
	const status = row.status;
	if (typeof status !== "string" || !BLK_STATUSES$1.includes(status)) return CORRUPT$3("blocker.status", `unknown status ${JSON.stringify(String(status))}`);
	for (const name of [
		"id",
		"statement",
		"affects",
		"source"
	]) if (typeof row[name] !== "string") return CORRUPT$3(`blocker.${name}`, `expected string, got ${typeof row[name]}`);
	if (typeof row.created_at !== "number") return CORRUPT$3("blocker.created_at", `expected number, got ${typeof row.created_at}`);
	const affects = decodeJson$3(row.affects, "blocker.affects");
	for (const ref of affects) if (ref === null || typeof ref !== "object" || typeof ref.kind !== "string" || typeof ref.id !== "string" || !AFFECTS_KINDS.includes(ref.kind)) return CORRUPT$3("blocker.affects", `element must be a {kind ∈ WORKSTREAM|TASK|RUN, id} typedRef (got ${JSON.stringify(ref)})`);
	const references = row.references;
	let referencesValue;
	if (references != null) {
		const decoded = decodeJson$3(references, "blocker.references");
		if (!Array.isArray(decoded)) return CORRUPT$3("blocker.references", `expected a JSON array of strings, got ${typeof decoded}`);
		for (const item of decoded) if (typeof item !== "string") return CORRUPT$3("blocker.references", `element must be a string (got ${typeof item})`);
		referencesValue = [...decoded];
	}
	return {
		id: row.id,
		statement: row.statement,
		affects,
		status,
		source: row.source,
		created_at: row.created_at,
		...referencesValue !== void 0 ? { references: referencesValue } : {},
		...row.cleared_at != null ? { cleared_at: row.cleared_at } : {}
	};
}
//#endregion
//#region src/host/service/actions/state-machine.ts
const NA_STATUSES = [
	"PROPOSED",
	"PROMOTED",
	"DISMISSED"
];
const BLK_STATUSES = ["ACTIVE", "CLEARED"];
function isNaStatus(v) {
	return typeof v === "string" && NA_STATUSES.includes(v);
}
function isBlkStatus(v) {
	return typeof v === "string" && BLK_STATUSES.includes(v);
}
/** NextAction 合法迁移集（§13 行原文; 双终态）。 */
const NA_TRANSITIONS = {
	PROPOSED: ["PROMOTED", "DISMISSED"],
	PROMOTED: [],
	DISMISSED: []
};
/** Blocker 合法迁移集（§13 行原文; CLEARED 终态, 复发 = 新行）。 */
const BLK_TRANSITIONS = {
	ACTIVE: ["CLEARED"],
	CLEARED: []
};
/** Objective 合法迁移集（§13 行原文; ACHIEVED/DROPPED 终态, 仅用户）。 */
const OBJ_TRANSITIONS = {
	ACTIVE: ["ACHIEVED", "DROPPED"],
	ACHIEVED: [],
	DROPPED: []
};
function guard(code, objectName, id, from, to, legal) {
	const allowed = legal[from];
	if (allowed.includes(to)) return;
	throw new ActionsError(code, `${objectName} ${JSON.stringify(id)}: illegal ${from} → ${to} (DOMAIN_SCHEMA §13: from ${from} the legal targets are [${allowed.join(", ")}] — 终态无出边)`);
}
/** §13 NextAction 行: `PROPOSED → PROMOTED | DISMISSED`（终态; PROMOTE 仅用户）。 */
function checkNextActionTransition(id, from, to) {
	guard("NA_WRONG_STATE", "next action", id, from, to, NA_TRANSITIONS);
}
/** §13 Blocker 行: `ACTIVE → CLEARED`（终态; 复发 = 新 Blocker）。 */
function checkBlockerTransition(id, from, to) {
	guard("BLK_WRONG_STATE", "blocker", id, from, to, BLK_TRANSITIONS);
}
/** §13 Objective 行: `ACTIVE → ACHIEVED | DROPPED`（仅用户）。 */
function checkObjectiveTransition(id, from, to) {
	guard("OBJ_WRONG_STATE", "objective", id, from, to, OBJ_TRANSITIONS);
}
/**
* USER-only 门（PROMOTE/DISMISS、Blocker 全泳道、Objective 全泳道）。
* 裸 `{ kind: 'USER' }` 合法（WP-3.4 `assertUserActor` 同款口径 —
* RPC 面转发的 USER_ACTOR 即此形状）。`code` 供调用方保留对象维度的
* 错误码（NA_ACTOR / BLK_ACTOR / OBJ_ACTOR）。
*/
function assertUserActor$4(actor, operation, code = "NA_ACTOR") {
	assertActorShape(actor, operation);
	if (actor.kind !== "USER") throw new ActionsError(code, `${operation}: user-only operation (ARCHITECTURE §6 矩阵 / INV-PERM-1 闭集 / §13「仅用户」) — actor.kind is ${JSON.stringify(actor.kind)}, expected USER`);
}
/**
* NextAction 创建面泳道（§6 行「NextAction 创建 | ✅ | ✅ | ❌ | ❌」）:
* USER 或 AGENT; AGENT 必须携 well-formed run_id（R-<n>）。
* （INV-PERM-1: 创建 NextAction 在 Agent 可写闭集内; PLUGIN/SYSTEM 无授权行。）
*/
function assertNextActionCreator(actor, operation) {
	assertActorShape(actor, operation);
	if (actor.kind === "USER") return;
	if (actor.kind === "AGENT") {
		if (typeof actor.run_id !== "string") throw new ActionsError("NA_ACTOR", `${operation}: an AGENT creator must carry its run (actor.run_id, common.schema.json actorRef) — the tool face requires a run-bound context`);
		return;
	}
	throw new ActionsError("NA_ACTOR", `${operation}: only USER or AGENT may create a NextAction (ARCHITECTURE §6 行「NextAction 创建 ✅/✅/❌/❌」) — actor.kind is ${JSON.stringify(actor.kind)}`);
}
//#endregion
//#region src/host/service/actions/store.ts
var ActionsStore = class {
	db;
	allocator;
	projectId;
	now;
	closed = false;
	constructor(options) {
		this.db = options.db;
		this.allocator = options.allocator;
		this.projectId = options.projectId;
		this.now = options.now ?? Date.now;
		this.db.exec(actionsDdl());
	}
	/**
	* Create one PROPOSED NextAction（§9.3; 矩阵行「NextAction 创建
	* ✅/✅」— USER 或 AGENT）。`workstreamId` 可选（形状在此钉, 存在性
	* 归 service 层 §16.3）.
	*/
	createNextAction(params, actor) {
		this.assertOpen("createNextAction");
		assertNextActionCreator(actor, "createNextAction");
		const record = this.validateNextActionInput(params);
		const at = this.now();
		const res = this.allocator.reserve("NEXT_ACTION", this.projectId);
		const finalRecord = {
			...record,
			id: res.id,
			status: "PROPOSED",
			created_by: actor,
			created_at: at
		};
		try {
			this.db.run(SQL_INSERT_NEXT_ACTION, ...nextActionToParams(finalRecord));
		} catch (cause) {
			this.allocator.release(res);
			throw this.wrap("createNextAction", cause);
		}
		this.allocator.commit(res);
		return finalRecord;
	}
	validateNextActionInput(params) {
		if (typeof params.statement !== "string" || params.statement.length === 0) throw new ActionsError("ACT_INPUT", "createNextAction: statement must be a non-empty string (DOMAIN_SCHEMA §9.3)");
		let workstream_id;
		if (params.workstreamId !== void 0) {
			if (typeof params.workstreamId !== "string" || !ID_PATTERNS.ws.test(params.workstreamId)) throw new ActionsError("ACT_INPUT", `createNextAction: workstreamId ${JSON.stringify(params.workstreamId)} is not a well-formed WS id (common.schema.json idWorkstream)`);
			workstream_id = params.workstreamId;
		}
		let rationale;
		if (params.rationale !== void 0) {
			if (typeof params.rationale !== "string" || params.rationale.length === 0) throw new ActionsError("ACT_INPUT", "createNextAction: rationale must be a non-empty string when present (DOMAIN_SCHEMA §9.3)");
			rationale = params.rationale;
		}
		return workstream_id === void 0 ? {
			statement: params.statement,
			...rationale !== void 0 ? { rationale } : {}
		} : {
			workstream_id,
			statement: params.statement,
			...rationale !== void 0 ? { rationale } : {}
		};
	}
	/**
	* PROMOTE（§9.3「转正为 Task」的行侧 — **仅用户**, §6 矩阵行）。
	* `taskId` 由调用方（service 层物化流）给出; 本方法只做行状态面:
	* 乐观条件 UPDATE `PROPOSED → PROMOTED`（0 行 ⇒ 重读判别）。
	* 存储层 trigger 钉死 promoted_to_task_id 一经生成不可更换。
	*/
	promoteNextAction(id, taskId, actor) {
		this.assertOpen("promoteNextAction");
		assertUserActor$4(actor, `promoteNextAction(${id})`);
		if (typeof taskId !== "string" || !ID_PATTERNS.task.test(taskId)) throw new ActionsError("ACT_INPUT", `promoteNextAction(${id}): taskId ${JSON.stringify(taskId)} is not a well-formed T id (common.schema.json idTask)`);
		const current = this.readNextActionRow(id);
		if (current === null) throw new ActionsError("NA_NOT_FOUND", `next action ${JSON.stringify(id)} does not exist`);
		checkNextActionTransition(id, current.status, "PROMOTED");
		if (this.db.run(SQL_TRANSITION_NEXT_ACTION, "PROMOTED", taskId, id) === 0) this.reportConcurrent(id);
		const updated = this.readNextActionRow(id);
		if (updated === null) throw new ActionsError("NA_NOT_FOUND", `next action ${JSON.stringify(id)} vanished after transition (no-delete trigger in effect — investigate)`);
		return updated;
	}
	/**
	* DISMISS（§13 终态 — **仅用户**, §6 矩阵行「NextAction PROMOTE/DISMISS」）。
	*/
	dismissNextAction(id, actor) {
		this.assertOpen("dismissNextAction");
		assertUserActor$4(actor, `dismissNextAction(${id})`);
		const current = this.readNextActionRow(id);
		if (current === null) throw new ActionsError("NA_NOT_FOUND", `next action ${JSON.stringify(id)} does not exist`);
		checkNextActionTransition(id, current.status, "DISMISSED");
		if (this.db.run(SQL_TRANSITION_NEXT_ACTION, "DISMISSED", null, id) === 0) this.reportConcurrent(id);
		const updated = this.readNextActionRow(id);
		if (updated === null) throw new ActionsError("NA_NOT_FOUND", `next action ${JSON.stringify(id)} vanished after transition (no-delete trigger in effect — investigate)`);
		return updated;
	}
	/** 条件 UPDATE 0 行的判别（同 WP-3.1 transition 先例）: 行消失 vs 状态已动。 */
	reportConcurrent(id) {
		const reread = this.readNextActionRow(id);
		if (reread === null) throw new ActionsError("NA_NOT_FOUND", `next action ${JSON.stringify(id)} vanished during transition (no-delete trigger in effect — investigate)`);
		if (reread.status !== "PROPOSED") throw new ActionsError("NA_WRONG_STATE", `next action ${JSON.stringify(id)} moved concurrently (expected PROPOSED, now ${reread.status}) — refetch and retry`);
		throw new ActionsError("NA_WRONG_STATE", `next action ${JSON.stringify(id)} moved concurrently (expected PROPOSED) — refetch and retry`);
	}
	/**
	* Create one ACTIVE Blocker（§9.4 — **USER-only**: INV-PERM-1 闭集外,
	* §6 无 Blocker 行 — state-machine.ts 头注②）.
	*/
	createBlocker(params, actor) {
		this.assertOpen("createBlocker");
		assertUserActor$4(actor, "createBlocker", "BLK_ACTOR");
		const record = this.validateBlockerInput(params);
		const at = this.now();
		const res = this.allocator.reserve("BLOCKER", this.projectId);
		const finalRecord = {
			...record,
			id: res.id,
			status: "ACTIVE",
			created_at: at
		};
		try {
			this.db.run(SQL_INSERT_BLOCKER, ...blockerToParams(finalRecord));
		} catch (cause) {
			this.allocator.release(res);
			throw this.wrap("createBlocker", cause);
		}
		this.allocator.commit(res);
		return finalRecord;
	}
	validateBlockerInput(params) {
		if (typeof params.statement !== "string" || params.statement.length === 0) throw new ActionsError("ACT_INPUT", "createBlocker: statement must be a non-empty string (DOMAIN_SCHEMA §9.4)");
		if (typeof params.source !== "string" || params.source.length === 0) throw new ActionsError("ACT_INPUT", "createBlocker: source must be a non-empty string (DOMAIN_SCHEMA §9.4 必填「来源说明」)");
		if (!Array.isArray(params.affects) || params.affects.length === 0) throw new ActionsError("ACT_INPUT", "createBlocker: affects must be a non-empty TypedRef[] (DOMAIN_SCHEMA §9.4 必填, kind 限 WORKSTREAM/TASK/RUN)");
		const affects = params.affects.map((ref, i) => {
			if (ref === null || typeof ref !== "object" || typeof ref.kind !== "string" || typeof ref.id !== "string" || ref.id.length === 0) throw new ActionsError("ACT_INPUT", `createBlocker: affects[${i}] must be a {kind, id} typedRef (DOMAIN_SCHEMA §9.4)`);
			const kind = ref.kind;
			if (kind !== "WORKSTREAM" && kind !== "TASK" && kind !== "RUN") throw new ActionsError("ACT_INPUT", `createBlocker: affects[${i}].kind ${JSON.stringify(kind)} not allowed (attention.schema.json $defs/Blocker.affects: WORKSTREAM/TASK/RUN)`);
			if (!(kind === "WORKSTREAM" ? ID_PATTERNS.ws : kind === "TASK" ? ID_PATTERNS.task : ID_PATTERNS.run).test(ref.id)) throw new ActionsError("ACT_INPUT", `createBlocker: affects[${i}].id ${JSON.stringify(ref.id)} is not a well-formed ${kind} id`);
			return {
				kind,
				id: ref.id
			};
		});
		let references;
		if (params.references !== void 0) {
			if (!Array.isArray(params.references) || params.references.some((r) => typeof r !== "string")) throw new ActionsError("ACT_INPUT", "createBlocker: references must be a string[] when present (DOMAIN_SCHEMA §9.4)");
			references = [...params.references];
		}
		return references === void 0 ? {
			statement: params.statement,
			affects,
			source: params.source
		} : {
			statement: params.statement,
			affects,
			source: params.source,
			references
		};
	}
	/**
	* CLEAR（§13 终态 — **USER-only**; 复发 = 新 Blocker 行, 不改旧行）。
	* `cleared_at` 落迁移时刻（乐观条件 UPDATE `ACTIVE → CLEARED`）。
	*/
	clearBlocker(id, actor) {
		this.assertOpen("clearBlocker");
		assertUserActor$4(actor, `clearBlocker(${id})`, "BLK_ACTOR");
		const current = this.readBlockerRow(id);
		if (current === null) throw new ActionsError("BLK_NOT_FOUND", `blocker ${JSON.stringify(id)} does not exist`);
		checkBlockerTransition(id, current.status, "CLEARED");
		if (this.db.run(SQL_TRANSITION_BLOCKER, "CLEARED", this.now(), id) === 0) {
			const reread = this.readBlockerRow(id);
			if (reread === null) throw new ActionsError("BLK_NOT_FOUND", `blocker ${JSON.stringify(id)} vanished during transition (no-delete trigger in effect — investigate)`);
			throw new ActionsError("BLK_WRONG_STATE", `blocker ${JSON.stringify(id)} moved concurrently (expected ACTIVE, now ${reread.status}) — refetch and retry`);
		}
		const updated = this.readBlockerRow(id);
		if (updated === null) throw new ActionsError("BLK_NOT_FOUND", `blocker ${JSON.stringify(id)} vanished after transition (no-delete trigger in effect — investigate)`);
		return updated;
	}
	/** One record by id (`null` when absent). */
	getNextAction(id) {
		this.assertOpen("getNextAction");
		return this.readNextActionRow(id);
	}
	/**
	* List by (status?, workstreamId?) — schema.ts 索引面（GUI 分组/过滤）.
	* Order: created_at ASC, id ASC (stable — 同 planfork 先例)。
	*/
	listNextActions(filter = {}) {
		this.assertOpen("listNextActions");
		const clauses = [];
		const params = [];
		if (filter.status !== void 0) {
			if (!isNaStatus(filter.status)) throw new ActionsError("ACT_INPUT", `listNextActions: filter.status must be one of PROPOSED|PROMOTED|DISMISSED (got ${JSON.stringify(filter.status)})`);
			clauses.push("status = ?");
			params.push(filter.status);
		}
		if (filter.workstreamId !== void 0) {
			if (typeof filter.workstreamId !== "string" || !ID_PATTERNS.ws.test(filter.workstreamId)) throw new ActionsError("ACT_INPUT", `listNextActions: filter.workstreamId ${JSON.stringify(filter.workstreamId)} is not a well-formed WS id`);
			clauses.push("workstream_id = ?");
			params.push(filter.workstreamId);
		}
		const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
		return this.db.all(`SELECT * FROM ${NEXT_ACTION_TABLE} ${where} ORDER BY created_at ASC, id ASC`, ...params).map((r) => rowToNextAction(r));
	}
	/** One record by id (`null` when absent). */
	getBlocker(id) {
		this.assertOpen("getBlocker");
		return this.readBlockerRow(id);
	}
	/** List by (status?) — 显著区面（ACTIVE 优先展示归视图层）。 */
	listBlockers(filter = {}) {
		this.assertOpen("listBlockers");
		const clauses = [];
		const params = [];
		if (filter.status !== void 0) {
			if (!isBlkStatus(filter.status)) throw new ActionsError("ACT_INPUT", `listBlockers: filter.status must be one of ACTIVE|CLEARED (got ${JSON.stringify(filter.status)})`);
			clauses.push("status = ?");
			params.push(filter.status);
		}
		const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
		return this.db.all(`SELECT * FROM ${BLOCKER_TABLE} ${where} ORDER BY created_at ASC, id ASC`, ...params).map((r) => rowToBlocker(r));
	}
	/** The id families this store allocates (diagnostics). */
	get allocatedCounters() {
		return {
			nextAction: this.allocator.peek("NEXT_ACTION", this.projectId),
			blocker: this.allocator.peek("BLOCKER", this.projectId)
		};
	}
	readNextActionRow(id) {
		if (typeof id !== "string" || id.length === 0) throw new ActionsError("ACT_INPUT", "next action id must be a non-empty string");
		const row = this.db.get(SQL_SELECT_NEXT_ACTION_BY_ID, id);
		return row === void 0 ? null : rowToNextAction(row);
	}
	readBlockerRow(id) {
		if (typeof id !== "string" || id.length === 0) throw new ActionsError("ACT_INPUT", "blocker id must be a non-empty string");
		const row = this.db.get(SQL_SELECT_BLOCKER_BY_ID, id);
		return row === void 0 ? null : rowToBlocker(row);
	}
	assertOpen(operation) {
		if (this.closed) throw new ActionsError("STORE", `${operation}: store is closed`);
	}
	wrap(context, cause) {
		return new ActionsError("STORE", `${context}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
	}
};
//#endregion
//#region src/host/domain/plan/serialize.ts
/** Pinned `yaml` options (frozen for byte-stability; see module doc). */
const YAML_OPTIONS = { lineWidth: 0 };
/**
* §1.2: epoch ms (memory carrier) → ISO 8601 UTC string (YAML carrier).
* Whole-second values drop the `.000` group: `…09:00:00.000Z` → `…09:00:00Z`.
*/
function epochToIso(ms) {
	if (!Number.isFinite(ms)) return "Invalid Date";
	const iso = new Date(ms).toISOString();
	return iso.endsWith(".000Z") ? `${iso.slice(0, -5)}Z` : iso;
}
/**
* Serialize `plan.yaml` for `wsId` with the given ordered item ids.
*
* Output form (the frozen §4.4 example, byte-for-byte shape):
* ```yaml
* workstream: WS-1
* ordered_items: [G-1, T-1, T-2, T-3, M-1, T-4, G-2]
* ```
* Empty plan: `ordered_items: []`.
*
* @precondition ids are validated T/G/M ids (pattern-safe); `wsId` a validated WS id.
*/
function serializePlan(wsId, orderedItems) {
	return `workstream: ${wsId}\nordered_items: ${orderedItems.length === 0 ? "[]" : `[${orderedItems.join(", ")}]`}\n`;
}
/**
* The DEFINITION (declarative) fields of each kind, frozen field-table order.
* This is the single authority for `updateItem` patch-key checks: a patch key
* outside this list is either a typo or DERIVED/runtime state (execution /
* validation / blockage / completion, INV-PLAN-9 / INV-TASK-2) and is
* rejected — the frozen schemas' `additionalProperties: false` agree.
*/
const DEFINITION_FIELDS = {
	task: [
		"id",
		"workstream_id",
		"title",
		"goal",
		"deliverables",
		"acceptance_criteria",
		"created_by",
		"created_at",
		"note"
	],
	gate: [
		"id",
		"workstream_id",
		"title",
		"criteria",
		"references",
		"created_by",
		"created_at"
	],
	milestone: [
		"id",
		"workstream_id",
		"title",
		"statement",
		"created_by",
		"created_at"
	]
};
/** common.schema.json actorRef property order. */
const ACTOR_FIELDS = [
	"kind",
	"user_id",
	"run_id",
	"session_id",
	"label"
];
/**
* Re-order one doc into a plain object in frozen field-table order,
* converting `created_at` to its YAML carrier (§1.2) and skipping absent
* (undefined) optional fields. The result is the EXACT object that gets
* serialized — field order is the insertion order.
*/
function toYamlCarrier(kind, doc) {
	const src = doc;
	const ordered = {};
	for (const field of DEFINITION_FIELDS[kind]) {
		const value = src[field];
		if (value === void 0) continue;
		if (field === "created_at") ordered[field] = epochToIso(value);
		else if (field === "created_by") ordered[field] = orderActor(value);
		else ordered[field] = value;
	}
	return ordered;
}
/** Re-order an ActorRef into frozen actorRef property order (skip absent). */
function orderActor(actor) {
	const out = {};
	for (const field of ACTOR_FIELDS) {
		const value = actor[field];
		if (value !== void 0) out[field] = value;
	}
	return out;
}
//#endregion
//#region src/host/service/actions/objectives.ts
/**
* WP-5.2 — Objective 声明式变更服务面（`.research/objectives.yaml` 原子写）。
*
* 冻结契约依据:
*  - DOMAIN_SCHEMA §9.1: Objective 是**声明式**对象（`.research/objectives.yaml`，
*    计划书 §17.3）— 真源是文件 + Git; loader（WP-1.1）已能加载
*    （`tree.objectives: ObjectiveDoc[]`，schema 校验 + §16.1 交叉引用全量
*    校验 + 默认值物化）;
*  - §13 状态机: `Objective | ACTIVE → ACHIEVED | DROPPED（仅用户）`;
*  - §12.1 ManagementAction: `action_kind` 冻结枚举含 **`OBJECTIVE_EDITED`**
*    （三对象中唯一有对应 kind 的 — 无 NA_* 与 BLK_* kind, 冻结不可扩）⇒
*    每次文件改写 append 一行 `OBJECTIVE_EDITED` 账本（provenance: 谁在
*    何时把 objectives.yaml 改成了什么形态 — 不存 before/after 快照,
*    §12.1 原文; 声明式状态的历史回放以 Git 为准）;
*  - ARCHITECTURE §10 失效面: 「插件崩溃 ⇒ 原子文件写（临时文件+rename）
*    保证 `.research/` 不留半写状态」（INV-DB-3）; §6 矩阵首行
*    「创建/编辑 … manifest ✅/❌/❌/❌」⇒ 编辑面 USER-only;
*  - HISTORY_EVENT_CATALOG §4: **无** Objective 事件 ⇒ 不构造 History 事件
*    （同 WP-3.1 核查口径）; ResearchHistory 也不记录管理操作（§12.1 原文:
*    「ResearchHistory 不记录 plan reorder、contract edit 等管理操作」）—
*    账本行是唯一落库痕迹。
*
* 写协议（同 WP-3.4 SELECT 物化/补偿纪律, 文件半边先行）:
*   1. 前置: 现状 `loadResearchTree`（真 reader — 文件是当下真值, 无缓存）;
*      树错误 ⇒ 拒绝（不给一棵坏树叠写 — 同 RPC 面 `#loadTree` 口径）;
*   2. **虚拟 reader 预校验**: 包装 reader（objectives.yaml 路径回注新内容,
*      其余字节原样）跑同一个 `loadResearchTree` — 新文档与**其余文件**的
*      §16.1 交叉引用在项目内闭环才许落盘（失败 = 精确 file+path 错误,
*      零字节落地）;
*   3. 原子写（tmp+rename — `PlanFileWriter` 面, 同 WP-1.3 内核;
*      写前留存旧文件精确字节, 补偿用）;
*   4. 后置校验: 再跑 `loadResearchTree`（真 reader）— 与第 1 步基线比对,
*      **新增**的 objectives.yaml 错误 ⇒ 回写旧字节（补偿）+ 大声错误
*      （第 2 步已预校验, 此处只兜「写后并发他文件变更」的理论窗口 +
*       writer 故障注入 — 测试实证）;
*   5. `OBJECTIVE_EDITED` 账本行（reserve/commit/release 协议同 WP-3.1;
*      账本失败 ⇒ 文件已在盘 — 大声错误 + 手动对账, 同 reorderPlan 先例;
*      绝不回滚文件 — Git 是声明式真源的版本面, 用户可显式 restore）。
*
* 序列化: 确定性 YAML（§9.1 字段表顺序; epoch ms → ISO 8601 UTC 走
* WP-1.3 `epochToIso` 单一来源; `YAML_OPTIONS` 固定 `lineWidth: 0` —
* 同数据 ⇒ 同字节, TC-DOM-005 同款保证）。
*/
/** §9.1 字段表顺序（L401-412）— 序列化单一来源（同 WP-1.3 TASK_FIELDS 先例）。 */
const OBJECTIVE_FIELDS = [
	"id",
	"scope",
	"topic_id",
	"statement",
	"success_criteria",
	"status",
	"target_date",
	"priority",
	"linked_refs",
	"created_at"
];
/**
* 把一个 Objective doc 排成冻结字段表顺序的 YAML carrier（跳过 absent
* 可选字段; `created_at`/`target_date` 跨 §1.2 序列化边界 → ISO 8601 UTC）。
*/
function toObjectiveCarrier(doc) {
	const out = {};
	for (const field of OBJECTIVE_FIELDS) {
		const value = doc[field];
		if (value === void 0) continue;
		if (field === "created_at" || field === "target_date") out[field] = epochToIso(value);
		else if (field === "linked_refs") out[field] = value.map((ref) => ({
			kind: ref.kind,
			id: ref.id
		}));
		else if (field === "success_criteria") out[field] = [...value];
		else out[field] = value;
	}
	return out;
}
/**
* 确定性序列化 `.research/objectives.yaml`（顶层 `objectives:` 包装 —
* objectives.schema.json 冻结形状; 同数据 ⇒ 同字节）。
*/
function serializeObjectives(objectives) {
	const wrapper = { objectives: objectives.map((doc) => toObjectiveCarrier(doc)) };
	return stringify(wrapper, YAML_OPTIONS);
}
var ObjectiveFileService = class {
	reader;
	writer;
	researchRoot;
	schemaDir;
	allocator;
	projectId;
	db;
	now;
	constructor(options) {
		this.reader = options.reader;
		this.writer = options.writer;
		this.researchRoot = options.researchRoot;
		this.schemaDir = options.schemaDir;
		this.allocator = options.allocator;
		this.projectId = options.projectId;
		this.db = options.db;
		this.now = options.now ?? Date.now;
	}
	/** The objectives.yaml path (absolute, reader/writer 面). */
	objectivesPath() {
		return pjoin(this.researchRoot, "objectives.yaml");
	}
	/**
	* 读取面（声明式真源 — 新鲜加载, 无缓存; 同 RPC 面 `#loadTree` 口径）.
	* 树错误 ⇒ 拒绝服务（错误聚合逐条报出 — 不给坏树投影）。
	*/
	loadObjectives() {
		const load = this.loadTreeOrThrow("loadObjectives");
		return {
			present: this.reader.readFile(this.objectivesPath()) !== null,
			objectives: load.tree.objectives.map((o) => ({ ...o }))
		};
	}
	/**
	* 整文件保存面（用户经 GUI 编辑 objectives.yaml — 任务书目标 1）。
	* `objectives` = 完整的新文档列表（含未变项 — 文件级原子替换, 无行级
	* diff 语义; §13 状态迁移的便捷面走 `setObjectiveStatus`）。
	* 协议见模块头（虚拟 reader 预校验 → 原子写 → 后置校验/补偿 → 账本）。
	*/
	saveObjectives(objectives, actor) {
		assertUserActor$4(actor, "saveObjectives", "OBJ_ACTOR");
		this.assertObjectiveDocs(objectives);
		const baseline = this.loadTreeOrThrow("saveObjectives");
		const previousBytes = this.reader.readFile(this.objectivesPath());
		const beforeStatus = new Map(baseline.tree.objectives.map((o) => [o.id, o.status]));
		const content = serializeObjectives(objectives);
		const preObjectiveErrors = this.loadTree(this.virtualReader(content)).errors.filter((e) => e.file === "objectives.yaml");
		if (preObjectiveErrors.length > 0) {
			const e = preObjectiveErrors[0];
			throw new ActionsError("OBJ_FILE", `saveObjectives: the new objectives.yaml fails validation — refusing the write: [${e.code}]${e.path !== void 0 ? ` ${e.path}` : ""}: ${e.message}` + (preObjectiveErrors.length > 1 ? ` (+${preObjectiveErrors.length - 1} more)` : ""));
		}
		let writeFailed = null;
		try {
			this.writer.writeAtomic(this.objectivesPath(), content);
		} catch (cause) {
			writeFailed = cause;
		}
		if (writeFailed !== null) throw new ActionsError("OBJ_FILE", `saveObjectives: atomic write failed: ${writeFailed instanceof Error ? writeFailed.message : String(writeFailed)}`, { cause: writeFailed });
		const postObjectiveErrors = this.loadTree(this.reader).errors.filter((e) => e.file === "objectives.yaml");
		if (postObjectiveErrors.length > 0) {
			const msg = postObjectiveErrors.map((e) => `[${e.code}] ${e.path ?? "/"}: ${e.message}`).join(" | ");
			let compensateFailed = null;
			if (previousBytes !== null) try {
				this.writer.writeAtomic(this.objectivesPath(), previousBytes);
			} catch (cause) {
				compensateFailed = cause;
			}
			if (compensateFailed !== null || previousBytes === null) {
				const cmsg = compensateFailed instanceof Error ? compensateFailed.message : String(compensateFailed);
				throw new ActionsError("OBJ_FILE", `saveObjectives: the written objectives.yaml failed post-validation (${msg}) AND ${previousBytes === null ? "no previous file bytes exist to restore (the file was newly created)" : `restoring the previous bytes also failed: ${cmsg}`} — manual reconciliation required (git restore ${pjoin(this.researchRoot, "objectives.yaml")})`, { cause: compensateFailed ?? void 0 });
			}
			throw new ActionsError("OBJ_FILE", `saveObjectives: the written objectives.yaml failed post-validation (${msg}) — the previous file content was restored atomically (concurrent tree change outside this service; re-read and retry)`);
		}
		const maRes = this.allocator.reserve("MANAGEMENT_ACTION", this.projectId);
		const ma = this.buildObjectiveEditedAction(maRes.id, actor, objectives, beforeStatus, previousBytes === null, this.now());
		try {
			this.db.run(SQL_INSERT_MANAGEMENT_ACTION, ...managementActionToParams(ma));
		} catch (cause) {
			this.allocator.release(maRes);
			throw new ActionsError("OBJ_STORE", `saveObjectives: the objectives.yaml was rewritten but the OBJECTIVE_EDITED ledger row failed — the file is on disk, the provenance row is missing (manual reconciliation): ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
		}
		this.allocator.commit(maRes);
		return {
			objectives: objectives.map((o) => ({ ...o })),
			managementActionId: maRes.id,
			fileCreated: previousBytes === null
		};
	}
	/**
	* §13 状态迁移便捷面（`ACTIVE → ACHIEVED | DROPPED`, 仅用户）:
	* 读现状 → 守卫 → 单字段改写 → `saveObjectives`（同一写协议 + 账本）。
	*/
	setObjectiveStatus(objectiveId, status, actor) {
		assertUserActor$4(actor, `setObjectiveStatus(${objectiveId})`, "OBJ_ACTOR");
		if (typeof objectiveId !== "string" || !ID_PATTERNS.objective.test(objectiveId)) throw new ActionsError("ACT_INPUT", `setObjectiveStatus: objective id ${JSON.stringify(objectiveId)} is not a well-formed OBJ id (common.schema.json idObjective)`);
		const current = this.loadObjectives().objectives;
		const target = current.find((o) => o.id === objectiveId);
		if (target === void 0) throw new ActionsError("OBJ_NOT_FOUND", `objective ${JSON.stringify(objectiveId)} does not exist in objectives.yaml`);
		checkObjectiveTransition(objectiveId, target.status, status);
		const next = current.map((o) => o.id === objectiveId ? {
			...o,
			status
		} : o);
		return this.saveObjectives(next, actor);
	}
	/** 全树加载（错误聚合原样返回 — 调用方决定拒绝口径）。 */
	loadTree(reader) {
		return loadResearchTree(reader, this.researchRoot, this.schemaDir);
	}
	/** 树错误 ⇒ 拒绝（精确错误聚合 — 同 RPC 面 `#loadTree`）。 */
	loadTreeOrThrow(operation) {
		const load = this.loadTree(this.reader);
		if (load.errors.length > 0) {
			const e = load.errors[0];
			throw new ActionsError("OBJ_FILE", `${operation}: the declarative tree failed to load — refusing to write on a broken tree: [${e.code}] ${e.file || "<root>"}${e.path !== void 0 ? ` ${e.path}` : ""}: ${e.message}` + (load.errors.length > 1 ? ` (+${load.errors.length - 1} more)` : ""));
		}
		return load;
	}
	/** 虚拟 reader: 仅 objectives.yaml 路径回注新内容, 其余字节原样委托。 */
	virtualReader(objectivesContent) {
		const self = this;
		const target = this.objectivesPath();
		return {
			readDir(path) {
				return self.reader.readDir(path);
			},
			readFile(path) {
				if (path === target) return objectivesContent;
				return self.reader.readFile(path);
			}
		};
	}
	/** 入参文档形状钉死（id 形状/必填字段 — 落盘前的类型面兜底）。 */
	assertObjectiveDocs(objectives) {
		if (!Array.isArray(objectives)) throw new ActionsError("ACT_INPUT", "saveObjectives: objectives must be an array (objectives.schema.json top-level `objectives` list)");
		const seen = /* @__PURE__ */ new Set();
		objectives.forEach((doc, i) => {
			if (doc === null || typeof doc !== "object") throw new ActionsError("ACT_INPUT", `saveObjectives: objectives[${i}] must be an object`);
			if (typeof doc.id !== "string" || !ID_PATTERNS.objective.test(doc.id)) throw new ActionsError("ACT_INPUT", `saveObjectives: objectives[${i}].id ${JSON.stringify(doc.id)} is not a well-formed OBJ id`);
			if (seen.has(doc.id)) throw new ActionsError("ACT_INPUT", `saveObjectives: duplicate objective id ${JSON.stringify(doc.id)} (DOMAIN_SCHEMA §1.1 — 预校验; loader 亦拒)`);
			seen.add(doc.id);
			if (doc.scope !== "PROJECT" && doc.scope !== "TOPIC") throw new ActionsError("ACT_INPUT", `saveObjectives: objectives[${i}].scope ${JSON.stringify(doc.scope)} not allowed (PROJECT|TOPIC)`);
			if (doc.scope === "TOPIC" && (typeof doc.topic_id !== "string" || doc.topic_id.length === 0)) throw new ActionsError("ACT_INPUT", `saveObjectives: objectives[${i}] (scope=TOPIC) requires topic_id (objectives.schema.json if/then)`);
			if (typeof doc.statement !== "string" || doc.statement.length === 0) throw new ActionsError("ACT_INPUT", `saveObjectives: objectives[${i}].statement must be a non-empty string`);
			if (!Array.isArray(doc.success_criteria) || doc.success_criteria.length === 0) throw new ActionsError("ACT_INPUT", `saveObjectives: objectives[${i}].success_criteria must be a non-empty string[] (objectives.schema.json minItems:1)`);
			if (typeof doc.created_at !== "number" || !Number.isSafeInteger(doc.created_at) || doc.created_at < 0) throw new ActionsError("ACT_INPUT", `saveObjectives: objectives[${i}].created_at must be a non-negative epoch ms (DOMAIN_SCHEMA §1.2)`);
		});
	}
	/** §12.1 `OBJECTIVE_EDITED` 账本行（不存 before/after 快照 — 原文）。 */
	buildObjectiveEditedAction(maId, actor, objectives, beforeStatus, fileCreated, at) {
		const changes = [];
		for (const o of objectives) {
			const before = beforeStatus.get(o.id);
			if (before === void 0) changes.push(`${o.id} added`);
			else if (before !== o.status) changes.push(`${o.id}: ${before} → ${o.status}`);
		}
		const detail = `objectives.yaml ${fileCreated ? "created" : "updated"} via GUI edit: ${objectives.length} objective(s) [${objectives.map((o) => o.id).join(", ")}]` + (changes.length > 0 ? `; status changes: ${changes.join("; ")}` : "");
		return {
			id: maId,
			action_kind: "OBJECTIVE_EDITED",
			actor,
			subject_refs: objectives.map((o) => ({
				kind: "OBJECTIVE",
				id: o.id
			})),
			detail,
			occurred_at: at
		};
	}
};
//#endregion
//#region src/host/domain/plan/types.ts
/** The shared/ids IdKind each plan item kind resolves to (§1.1 registry). */
const KIND_TO_ID_KIND = {
	task: "TASK",
	gate: "GATE",
	milestone: "MILESTONE"
};
/** The `items/` subdirectory per kind (DOMAIN_SCHEMA §14 layout). */
const KIND_TO_DIR$1 = {
	task: "tasks",
	gate: "gates",
	milestone: "milestones"
};
/**
* One precisely-located plan-store violation (ARCHITECTURE §10: file +
* field + 违规内容摘要, no guess-repair). Mutating operations throw the
* FIRST violated check (fail before any write); `loadPlan` AGGREGATES
* (WP-1.1 style) into `PlanLoadResult.errors`.
*/
var PlanStoreError = class extends Error {
	code;
	/** File (or entry) location, relative to the `.research/` root, POSIX-style. */
	file;
	/** JSON-pointer-style path inside the document; `undefined` for document-level errors. */
	path;
	constructor(init) {
		super(init.message);
		this.name = "PlanStoreError";
		this.code = init.code;
		this.file = init.file;
		this.path = init.path;
	}
};
//#endregion
//#region src/host/domain/plan/plan-store.ts
/**
* WP-1.3 — `PlanStore`: canonical plan CRUD for one workstream.
*
* Frozen contracts (read-only):
*  - DOMAIN_SCHEMA §4.4 — `plan.yaml`: `{ workstream, ordered_items }`;
*    elements must satisfy 「定义文件存在 ∧ 属于本 WS ∧ 无重复」; order is
*    user intent and MUST be persisted verbatim (INV-PLAN-1);
*  - DOMAIN_SCHEMA §4.1/§4.2/§4.3 — G/T/M definition files: declarative
*    content only (INV-PLAN-9); file name = id (§1.1 规则 2/3);
*    `workstream_id` path-bound;
*  - DOMAIN_SCHEMA §1.1 规则 1 — ids are immutable once assigned;
*  - ARCHITECTURE §5.4 INV-PLAN-1/9 (see types.ts);
*  - schema/declarative/{plan,task,gate,milestone}.schema.json consumed
*    VERBATIM through the WP-1.1 `loadSchemas` (frozen, no mutation).
*
* ## Design (pure kernel, ARCHITECTURE §2.2 rule 1)
*
*  - ZERO direct I/O: reads go through the injected WP-1.1
*    `ResearchFileReader`, writes through the injected `PlanFileWriter`
*    (atomic tmp+rename is the writer's obligation — see types.ts).
*  - STATELESS & reentrant: every public operation re-reads the current
*    state (no cache); a "restart" is a fresh instance over the same files
*    (TC-DOM-005).
*  - VALIDATE BEFORE WRITE: mutations throw the first violated check before
*    any write happens; `loadPlan` aggregates (WP-1.1 style). Mutating
*    operations additionally refuse to build on an already-inconsistent
*    plan.yaml (no guess-repair, ARCHITECTURE §10).
*  - §1.2 time boundary: in-memory carriers carry epoch ms (the WP-1.1
*    loader's carriers); file carriers carry ISO 8601 UTC strings — the
*    conversion happens here, in `serialize.ts` / `carrierToMemory`, at the
*    same serialization boundary the loader owns on the read side.
*/
/** Reverse of KIND_TO_ID_KIND: the plan kinds that are plan-item kinds (§4.4 T/G/M). */
const ID_KIND_TO_PLAN_KIND = {
	TASK: "task",
	GATE: "gate",
	MILESTONE: "milestone"
};
function errMsg(cause) {
	return cause instanceof Error ? cause.message : String(cause);
}
var PlanStore = class {
	opts;
	schemas;
	constructor(options) {
		if (!idMatchesKind(options.topicId, "TOPIC")) throw new PlanStoreError({
			code: "PATH_RULE",
			file: `topics/${options.topicId}`,
			message: `topicId ${JSON.stringify(options.topicId)} is not a well-formed TPC id (DOMAIN_SCHEMA §14)`
		});
		if (!idMatchesKind(options.wsId, "WORKSTREAM")) throw new PlanStoreError({
			code: "PATH_RULE",
			file: `topics/${options.topicId}/workstreams/${options.wsId}`,
			message: `wsId ${JSON.stringify(options.wsId)} is not a well-formed WS id (DOMAIN_SCHEMA §14)`
		});
		const loadErrors = [];
		const compiled = loadSchemas(options.reader, options.schemaDir, loadErrors);
		const missing = [
			"plan",
			"task",
			"gate",
			"milestone"
		].filter((t) => !compiled.validators.has(t));
		if (missing.length > 0 || loadErrors.length > 0) throw new PlanStoreError({
			code: "SCHEMA_LOAD",
			file: loadErrors[0]?.file ?? options.schemaDir,
			message: `frozen schema set unavailable for canonical plan CRUD` + (missing.length > 0 ? ` (missing validators: ${missing.join(", ")})` : "") + (loadErrors.length > 0 ? ` — ${loadErrors.map((e) => e.message).join(" | ")}` : "")
		});
		this.schemas = compiled;
		this.opts = options;
		const wsRel = this.wsPath();
		let entries;
		try {
			entries = options.reader.readDir(this.abs(wsRel));
		} catch (cause) {
			throw new PlanStoreError({
				code: "READ",
				file: wsRel,
				message: `read failed: ${errMsg(cause)}`
			});
		}
		if (entries === null) throw new PlanStoreError({
			code: "WORKSTREAM_MISSING",
			file: wsRel,
			message: `workstream directory ${JSON.stringify(wsRel)} does not exist (DOMAIN_SCHEMA §14)`
		});
	}
	/** `topics/<t>/workstreams/<w>` — the managed workstream directory. */
	wsPath() {
		return `topics/${this.opts.topicId}/workstreams/${this.opts.wsId}`;
	}
	/** `topics/<t>/workstreams/<w>/plan.yaml` — the canonical plan file. */
	planPath() {
		return `${this.wsPath()}/plan.yaml`;
	}
	/** `topics/<t>/workstreams/<w>/items/<dir>/<id>.yaml` — a definition file. */
	itemPath(kind, id) {
		return `${this.wsPath()}/items/${KIND_TO_DIR$1[kind]}/${id}.yaml`;
	}
	abs(rel) {
		return pjoin(this.opts.researchRoot, rel);
	}
	/**
	* Load `plan.yaml` (aggregated-error result, WP-1.1 style).
	*
	* `items` is the file's `ordered_items` VERBATIM (no sort, no dedup —
	* INV-PLAN-1). Missing file ⇒ `{ present: false, items: [], errors: [] }`
	* (a workstream without a plan is legal — the loader marks plan.yaml
	* optional). Non-empty `errors` ⇒ the plan is inconsistent; mutating
	* operations then refuse to build on it (the FIRST error is thrown).
	*/
	loadPlan() {
		const rel = this.planPath();
		let text;
		try {
			text = this.opts.reader.readFile(this.abs(rel));
		} catch (cause) {
			return {
				present: false,
				items: [],
				errors: [new PlanStoreError({
					code: "READ",
					file: rel,
					message: `read failed: ${errMsg(cause)}`
				})]
			};
		}
		if (text === null) return {
			present: false,
			items: [],
			errors: []
		};
		const errors = [];
		const carrier = this.parseSingleYamlDoc(rel, text, errors);
		if (carrier === null) return {
			present: true,
			items: [],
			errors
		};
		const validator = this.schemas.validators.get("plan");
		if (!validator(carrier)) {
			for (const err of validator.errors ?? []) errors.push(new PlanStoreError({
				code: "SCHEMA",
				file: rel,
				path: err.instancePath === "" ? void 0 : err.instancePath,
				message: schemaErrorSummary(err)
			}));
			return {
				present: true,
				items: [],
				errors
			};
		}
		const doc = carrier;
		if (doc.workstream !== this.opts.wsId) errors.push(new PlanStoreError({
			code: "PATH_ID_MISMATCH",
			file: rel,
			path: "/workstream",
			message: `workstream ${JSON.stringify(doc.workstream)} does not match containing workstream directory ${JSON.stringify(this.opts.wsId)} (DOMAIN_SCHEMA §4.4)`
		}));
		const items = [];
		const firstAt = /* @__PURE__ */ new Map();
		doc.ordered_items.forEach((id, i) => {
			items.push(id);
			const first = firstAt.get(id);
			if (first !== void 0) {
				errors.push(new PlanStoreError({
					code: "DUPLICATE_ID",
					file: rel,
					path: `/ordered_items/${i}`,
					message: `duplicate item ${JSON.stringify(id)} (first listed at position ${first}) (DOMAIN_SCHEMA §4.4)`
				}));
				return;
			}
			firstAt.set(id, i);
			const problem = this.definitionProblem(id);
			if (problem !== null) errors.push(new PlanStoreError({
				code: "DANGLING_REF",
				file: rel,
				path: `/ordered_items/${i}`,
				message: `ordered_items[${i}] ${JSON.stringify(id)}: ${problem} (DOMAIN_SCHEMA §4.4/§16.1)`
			}));
		});
		return {
			present: true,
			items,
			errors
		};
	}
	/**
	* Validate and atomically (re)write `plan.yaml` with the given ordered
	* ids — the SINGLE canonical write path of the store (all mutating
	* operations funnel through it).
	*
	* Checks, in order, BEFORE any write:
	*   1. frozen plan schema (类型一致性: elements must be T/G/M ids, §4.4);
	*   2. no duplicate ids (DUPLICATE_ID, pointer to the second occurrence);
	*   3. every id has a VALID definition file in THIS workstream
	*      (DANGLING_REF — exists ∧ belongs to this WS, §4.4/§16.1).
	* The serialization is deterministic (serialize.ts): same data ⇒ same
	* bytes (TC-DOM-005), order preserved position-for-position (INV-PLAN-1).
	*/
	savePlan(orderedItems) {
		const rel = this.planPath();
		const doc = {
			workstream: this.opts.wsId,
			ordered_items: [...orderedItems]
		};
		const validator = this.schemas.validators.get("plan");
		if (!validator(doc)) for (const err of validator.errors ?? []) throw new PlanStoreError({
			code: "SCHEMA",
			file: rel,
			path: err.instancePath === "" ? void 0 : err.instancePath,
			message: schemaErrorSummary(err)
		});
		const firstAt = /* @__PURE__ */ new Map();
		doc.ordered_items.forEach((id, i) => {
			const first = firstAt.get(id);
			if (first !== void 0) throw new PlanStoreError({
				code: "DUPLICATE_ID",
				file: rel,
				path: `/ordered_items/${i}`,
				message: `duplicate item ${JSON.stringify(id)} (first listed at position ${first}) (DOMAIN_SCHEMA §4.4)`
			});
			firstAt.set(id, i);
		});
		for (const [id, i] of firstAt) {
			const problem = this.definitionProblem(id);
			if (problem !== null) throw new PlanStoreError({
				code: "DANGLING_REF",
				file: rel,
				path: `/ordered_items/${i}`,
				message: `ordered_items[${i}] ${JSON.stringify(id)}: ${problem} (DOMAIN_SCHEMA §4.4/§16.1)`
			});
		}
		this.writeAtomicOrThrow(rel, serializePlan(this.opts.wsId, doc.ordered_items));
	}
	readItem(kind, id) {
		return this.readItemImpl(kind, id);
	}
	readItemImpl(kind, id) {
		this.assertItemKind(kind, id, this.itemPath(kind, id));
		const rel = this.itemPath(kind, id);
		let text;
		try {
			text = this.opts.reader.readFile(this.abs(rel));
		} catch (cause) {
			throw new PlanStoreError({
				code: "READ",
				file: rel,
				message: `read failed: ${errMsg(cause)}`
			});
		}
		if (text === null) throw new PlanStoreError({
			code: "NOT_FOUND",
			file: rel,
			message: `no ${kind} definition file for ${JSON.stringify(id)} at ${JSON.stringify(rel)} (DOMAIN_SCHEMA §4.1/§4.2/§4.3)`
		});
		const errors = [];
		const carrier = this.parseSingleYamlDoc(rel, text, errors);
		if (carrier !== null) this.validateDefinitionCarrier(kind, rel, carrier, errors);
		if (errors.length > 0) throw errors[0];
		if (carrier === null) throw new PlanStoreError({
			code: "PARSE",
			file: rel,
			message: "internal invariant: no YAML document and no error recorded"
		});
		return this.carrierToMemory(rel, carrier);
	}
	createItem(kind, doc) {
		const rel = this.itemPath(kind, doc.id);
		const content = this.prepareDefinitionWrite(kind, doc, rel);
		this.writeAtomicOrThrow(rel, content);
	}
	updateItem(kind, id, changes) {
		const rel = this.itemPath(kind, id);
		this.assertItemKind(kind, id, rel);
		const current = this.readItemImpl(kind, id);
		const fields = DEFINITION_FIELDS[kind];
		for (const key of Object.keys(changes)) {
			if (key === "id" || key === "workstream_id") throw new PlanStoreError({
				code: "IMMUTABLE_FIELD",
				file: rel,
				path: `/${key}`,
				message: `field "${key}" is immutable in updateItem — id is frozen once assigned (DOMAIN_SCHEMA §1.1 规则 1; file name = id); workstream_id is path-bound to ${JSON.stringify(`${this.wsPath()}/items/${KIND_TO_DIR$1[kind]}`)}`
			});
			if (!fields.includes(key)) throw new PlanStoreError({
				code: "SCHEMA",
				file: rel,
				path: `/${key}`,
				message: `unknown field "${key}" — not a definition field of the frozen ${kind} schema (derived/runtime state is rejected, INV-PLAN-9/INV-TASK-2; additionalProperties: false)`
			});
		}
		const merged = {};
		for (const field of fields) {
			const raw = Object.prototype.hasOwnProperty.call(changes, field) ? changes[field] : current[field];
			if (raw === void 0) continue;
			merged[field] = raw;
		}
		const carrier = toYamlCarrier(kind, merged);
		const errors = [];
		this.validateDefinitionCarrier(kind, rel, carrier, errors);
		if (errors.length > 0) throw errors[0];
		this.writeAtomicOrThrow(rel, stringify(carrier, YAML_OPTIONS));
	}
	/**
	* List an EXISTING item definition into the plan at `index`
	* (0 = head, length = tail). Rejects: non-item ids (TYPE_MISMATCH),
	* out-of-range `index` (BOUNDARY), already-listed ids (DUPLICATE_ID),
	* ids without a valid definition in this WS (DANGLING_REF).
	*/
	insertItemAt(id, index) {
		const items = this.currentItems();
		const rel = this.planPath();
		this.assertPlanItemId(id);
		this.assertInsertIndex("insertItemAt", id, index, items.length);
		const existingAt = items.indexOf(id);
		if (existingAt !== -1) throw new PlanStoreError({
			code: "DUPLICATE_ID",
			file: rel,
			path: `/ordered_items/${existingAt}`,
			message: `item ${JSON.stringify(id)} is already listed at position ${existingAt} (DOMAIN_SCHEMA §4.4)`
		});
		const problem = this.definitionProblem(id);
		if (problem !== null) throw new PlanStoreError({
			code: "DANGLING_REF",
			file: rel,
			path: `/ordered_items/${index}`,
			message: `ordered_items[${index}] ${JSON.stringify(id)}: ${problem} (DOMAIN_SCHEMA §4.4/§16.1)`
		});
		this.savePlan([
			...items.slice(0, index),
			id,
			...items.slice(index)
		]);
	}
	/**
	* Move a listed item to `toIndex` (position in the RESULTING list: the
	* item is removed first, leaving `length-1` slots, so `0..length-1`).
	* Rejects: unlisted ids (NOT_FOUND), out-of-range targets (BOUNDARY).
	* All other ids keep their relative order (INV-PLAN-1: only the moved
	* item's position changes).
	*/
	moveItem(id, toIndex) {
		const items = this.currentItems();
		const rel = this.planPath();
		const from = items.indexOf(id);
		if (from === -1) throw new PlanStoreError({
			code: "NOT_FOUND",
			file: rel,
			path: "/ordered_items",
			message: `moveItem(${JSON.stringify(id)}): item is not listed in the plan of ${JSON.stringify(this.opts.wsId)} (DOMAIN_SCHEMA §4.4)`
		});
		if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > items.length - 1) throw new PlanStoreError({
			code: "BOUNDARY",
			file: rel,
			path: "/ordered_items",
			message: `moveItem(${JSON.stringify(id)}, ${String(toIndex)}): target position out of range — the item is removed first, leaving ${items.length - 1} slots (0..${items.length - 1}) (INV-PLAN-1 position bounds)`
		});
		const rest = items.filter((_, i) => i !== from);
		rest.splice(toIndex, 0, id);
		this.savePlan(rest);
	}
	/**
	* Remove an item from `plan.yaml` ONLY (INV-PLAN-9): the G/T/M definition
	* file is RETAINED — it leaves the current Future zone but is not deleted
	* (long-term retention; a later re-insert lists it again without any
	* definition work). Rejects unlisted ids (NOT_FOUND).
	*/
	removeItem(id) {
		const items = this.currentItems();
		const rel = this.planPath();
		const at = items.indexOf(id);
		if (at === -1) throw new PlanStoreError({
			code: "NOT_FOUND",
			file: rel,
			path: "/ordered_items",
			message: `removeItem(${JSON.stringify(id)}): item is not listed in the plan of ${JSON.stringify(this.opts.wsId)} (DOMAIN_SCHEMA §4.4)`
		});
		this.savePlan(items.filter((_, i) => i !== at));
	}
	addItem(kind, doc, index) {
		const rel = this.itemPath(kind, doc.id);
		const items = this.currentItems();
		const at = index === void 0 ? items.length : index;
		this.assertInsertIndex(`addItem(${JSON.stringify(doc.id)}, …)`, doc.id, at, items.length);
		const content = this.prepareDefinitionWrite(kind, doc, rel);
		this.writeAtomicOrThrow(rel, content);
		this.writeAtomicOrThrow(this.planPath(), serializePlan(this.opts.wsId, [
			...items.slice(0, at),
			doc.id,
			...items.slice(at)
		]));
	}
	/** The current plan's ordered ids, or throw the first inconsistency. */
	currentItems() {
		const result = this.loadPlan();
		if (result.errors.length > 0) throw result.errors[0];
		return result.items;
	}
	/**
	* §4.4 element check for one plan id: a valid definition file in THIS
	* workstream. Returns `null` when the id is OK, else the precise reason
	* (embedded into the caller's DANGLING_REF/TYPE_MISMATCH message).
	*/
	definitionProblem(id) {
		const parsed = parseId(id);
		if (parsed === null) return `not a well-formed research id (DOMAIN_SCHEMA §1.1)`;
		const kind = ID_KIND_TO_PLAN_KIND[parsed.kind];
		if (kind === void 0) return `id kind ${parsed.kind} is not a plan item kind (T/G/M required, DOMAIN_SCHEMA §4.4)`;
		const rel = this.itemPath(kind, id);
		let text;
		try {
			text = this.opts.reader.readFile(this.abs(rel));
		} catch {
			return `definition file read failed at ${JSON.stringify(rel)} (I/O)`;
		}
		if (text === null) return `has no definition file at ${JSON.stringify(rel)} (DOMAIN_SCHEMA §4.4/§16.1)`;
		const errors = [];
		const carrier = this.parseSingleYamlDoc(rel, text, errors);
		if (carrier !== null) this.validateDefinitionCarrier(kind, rel, carrier, errors);
		if (errors.length > 0) return `definition file ${JSON.stringify(rel)} failed validation: ${errors[0].message}`;
		return null;
	}
	/**
	* All pre-write checks for a definition file, shared by `createItem` and
	* `addItem` — returns the serialized (validated) file content:
	* id kind (TYPE_MISMATCH) → 文件名=id (shared/ids 一致性助手, §1.1 规则 2/3)
	* → workstream_id path match → no overwrite (FILE_EXISTS) → frozen schema.
	*/
	prepareDefinitionWrite(kind, doc, rel) {
		this.assertItemKind(kind, doc.id, rel);
		const nameCheck = checkFileNameId(`${doc.id}.yaml`, doc.id);
		if (nameCheck.status !== "match") throw new PlanStoreError({
			code: "PATH_ID_MISMATCH",
			file: rel,
			path: "/id",
			message: `file name ${JSON.stringify(nameCheck.fileNameId ?? "(no id in name)")} does not match declared id ${JSON.stringify(doc.id)} (DOMAIN_SCHEMA §1.1 规则 2/3)`
		});
		if (doc.workstream_id !== this.opts.wsId) throw new PlanStoreError({
			code: "PATH_ID_MISMATCH",
			file: rel,
			path: "/workstream_id",
			message: `workstream_id ${JSON.stringify(doc.workstream_id)} does not match containing workstream directory ${JSON.stringify(this.opts.wsId)} (DOMAIN_SCHEMA §4.1/§4.2/§4.3)`
		});
		let existing;
		try {
			existing = this.opts.reader.readFile(this.abs(rel));
		} catch (cause) {
			throw new PlanStoreError({
				code: "READ",
				file: rel,
				message: `read failed: ${errMsg(cause)}`
			});
		}
		if (existing !== null) throw new PlanStoreError({
			code: "FILE_EXISTS",
			file: rel,
			message: `definition file for ${JSON.stringify(doc.id)} already exists (create refused — use updateItem; no overwrite, DOMAIN_SCHEMA §1.1 规则 3)`
		});
		const carrier = toYamlCarrier(kind, doc);
		const errors = [];
		this.validateDefinitionCarrier(kind, rel, carrier, errors);
		if (errors.length > 0) throw errors[0];
		return stringify(carrier, YAML_OPTIONS);
	}
	/**
	* Frozen-schema + path-id validation of one definition CARRIER (the
	* on-file shape: ISO timestamps, field order irrelevant). Aggregates into
	* `errors`; returns true when the carrier is accepted. Mirrors the WP-1.1
	* loader's per-file pipeline (schema → §1.1 规则 3 文件名↔id → §4.x
	* workstream field), so store and loader reject the same files.
	*/
	validateDefinitionCarrier(kind, rel, carrier, errors) {
		const validator = this.schemas.validators.get(kind);
		if (!validator(carrier)) {
			for (const err of validator.errors ?? []) errors.push(new PlanStoreError({
				code: "SCHEMA",
				file: rel,
				path: err.instancePath === "" ? void 0 : err.instancePath,
				message: schemaErrorSummary(err)
			}));
			return false;
		}
		const fileName = rel.slice(rel.lastIndexOf("/") + 1);
		const nameCheck = checkFileNameId(fileName, String(carrier.id));
		if (nameCheck.status !== "match") {
			errors.push(new PlanStoreError({
				code: "PATH_ID_MISMATCH",
				file: rel,
				message: `id ${JSON.stringify(nameCheck.declaredId)} does not match file name ${JSON.stringify(fileName)} (DOMAIN_SCHEMA §1.1 规则 3/§4.1-4.3)`
			}));
			return false;
		}
		if (carrier.workstream_id !== this.opts.wsId) {
			errors.push(new PlanStoreError({
				code: "PATH_ID_MISMATCH",
				file: rel,
				path: "/workstream_id",
				message: `workstream_id ${JSON.stringify(String(carrier.workstream_id))} does not match containing workstream directory ${JSON.stringify(this.opts.wsId)} (DOMAIN_SCHEMA §4.1/§4.2/§4.3)`
			}));
			return false;
		}
		return true;
	}
	/** Parse exactly one YAML document (WP-1.1 loader semantics, throwing-free). */
	parseSingleYamlDoc(rel, text, errors) {
		let docs;
		try {
			docs = parseAllDocuments(text);
		} catch (cause) {
			errors.push(new PlanStoreError({
				code: "PARSE",
				file: rel,
				message: `YAML parse failed: ${errMsg(cause)}`
			}));
			return null;
		}
		const substantive = docs.filter((d) => d.errors.length > 0 || d.contents !== null && d.contents !== void 0);
		if (substantive.length === 0) {
			errors.push(new PlanStoreError({
				code: "PARSE",
				file: rel,
				message: "empty or comment-only YAML file (expected a mapping)"
			}));
			return null;
		}
		if (substantive.length > 1) {
			errors.push(new PlanStoreError({
				code: "PARSE",
				file: rel,
				message: `multiple YAML documents (${substantive.length}); expected exactly one (DOMAIN_SCHEMA §14)`
			}));
			return null;
		}
		const doc = substantive[0];
		if (doc.errors.length > 0) {
			for (const e of doc.errors) {
				const first = e.linePos?.[0];
				const shortMsg = e.message.split("\n")[0];
				const where = first ? ` (line ${first.line}, col ${first.col})` : "";
				errors.push(new PlanStoreError({
					code: "PARSE",
					file: rel,
					message: `YAML: ${shortMsg}${where}`
				}));
			}
			return null;
		}
		let value;
		try {
			value = doc.toJS();
		} catch (cause) {
			errors.push(new PlanStoreError({
				code: "PARSE",
				file: rel,
				message: `YAML parse failed: ${errMsg(cause)}`
			}));
			return null;
		}
		if (value === null || typeof value !== "object" || Array.isArray(value)) {
			const what = value === null ? "null" : Array.isArray(value) ? "sequence" : typeof value;
			errors.push(new PlanStoreError({
				code: "SCHEMA",
				file: rel,
				message: `top-level YAML document must be a mapping (got ${what})`
			}));
			return null;
		}
		return value;
	}
	/** §1.2 boundary (read side): carrier `created_at` ISO string → epoch ms. */
	carrierToMemory(rel, carrier) {
		const raw = carrier.created_at;
		const ms = typeof raw === "string" ? Date.parse(raw) : NaN;
		if (!Number.isFinite(ms)) throw new PlanStoreError({
			code: "PARSE",
			file: rel,
			path: "/created_at",
			message: `timestamp ${JSON.stringify(String(raw))} cannot be converted to epoch ms (internal invariant)`
		});
		return {
			...carrier,
			created_at: ms
		};
	}
	/** `id` must be a well-formed id of exactly the requested kind (类型一致性). */
	assertItemKind(kind, id, file) {
		const expected = KIND_TO_ID_KIND[kind];
		const parsed = parseId(id);
		if (parsed === null) throw new PlanStoreError({
			code: "TYPE_MISMATCH",
			file,
			path: "/id",
			message: `id ${JSON.stringify(id)} is not a well-formed research id (<PREFIX>-<positive integer>, DOMAIN_SCHEMA §1.1); expected a ${expected} id for items/${KIND_TO_DIR$1[kind]}/`
		});
		if (parsed.kind !== expected) throw new PlanStoreError({
			code: "TYPE_MISMATCH",
			file,
			path: "/id",
			message: `id ${JSON.stringify(id)} is a ${parsed.kind} id, not a ${expected} id (type mismatch for items/${KIND_TO_DIR$1[kind]}/, DOMAIN_SCHEMA §1.1/§4.4)`
		});
	}
	/** A plan-operation id must be a well-formed T/G/M id (§4.4 类型一致性). */
	assertPlanItemId(id) {
		const parsed = parseId(id);
		if (parsed === null) throw new PlanStoreError({
			code: "TYPE_MISMATCH",
			file: this.planPath(),
			path: "/ordered_items",
			message: `id ${JSON.stringify(id)} is not a well-formed research id (<PREFIX>-<positive integer>, DOMAIN_SCHEMA §1.1); plan items must be T/G/M ids (§4.4)`
		});
		if (ID_KIND_TO_PLAN_KIND[parsed.kind] === void 0) throw new PlanStoreError({
			code: "TYPE_MISMATCH",
			file: this.planPath(),
			path: "/ordered_items",
			message: `id ${JSON.stringify(id)} is a ${parsed.kind} id, not a plan item kind (T/G/M required, DOMAIN_SCHEMA §4.4)`
		});
	}
	/** Insert position bounds: integer `0..length` (inserting into `length` items). */
	assertInsertIndex(op, id, index, length) {
		if (!Number.isInteger(index) || index < 0 || index > length) throw new PlanStoreError({
			code: "BOUNDARY",
			file: this.planPath(),
			path: "/ordered_items",
			message: `${op} ${JSON.stringify(id)}: position ${String(index)} out of range — inserting into a plan of ${length} items allows 0..${length} (INV-PLAN-1 position bounds)`
		});
	}
	writeAtomicOrThrow(rel, content) {
		try {
			this.opts.writer.writeAtomic(this.abs(rel), content);
		} catch (cause) {
			throw new PlanStoreError({
				code: "WRITE",
				file: rel,
				message: `write failed: ${errMsg(cause)}`
			});
		}
	}
};
//#endregion
//#region src/host/service/actions/service.ts
/**
* WP-5.2 — `ActionsService`: NextAction / Blocker 的用户+Agent 业务面
* （§16.3 写时引用校验 + §13 状态机 + §6 权限矩阵 + PROMOTE 物化流）。
*
* 与 `ActionsStore` 的分工（同 WP-3.1 create.ts/store.ts 先例）:
*   - store = 纯 DB 面（DDL/INSERT/条件 UPDATE/查询 + 存储层权限门）;
*   - service = 需要**上下文**的业务面: 声明式树（§16.3 存在性）、
*     run 表（RUN 引用）、PlanStore 物化（PROMOTE 转正为 Task）。
*
* 面清单（任务书目标 2 + §6 矩阵泳道）:
*   - `createNextAction`      — USER ✅ / AGENT ✅（§6 行「NextAction 创建」;
*     AGENT 经 `research_next_action_create` 工具面转发, WP-3.3 stub 的
*     plannedService 即本面）;
*   - `promoteNextAction`     — **USER only**（§6 行「NextAction
*     PROMOTE/DISMISS ✅/❌/❌/❌」; §9.3「用户才 PROMOTE（转正为 Task）」）
*     — 完整物化流（见下）;
*   - `dismissNextAction`     — **USER only**（同上矩阵行）;
*   - `createBlocker` / `clearBlocker` — **USER only**（INV-PERM-1 闭集外;
*     §6 无 Blocker 行 — state-machine.ts 头注②）;
*   - 查询面透传（RPC/视图数据缝 — 冻结 13 RPC 无注意力面, 接线面归
*     后续集成, 见报告「实现要点」§3）。
*
* ## PROMOTE 物化流（§9.3「转正为 Task」— 同 WP-3.4 SELECT 物化/补偿纪律）
*
*   前置 `NA.status == PROPOSED`（§13 守卫）⇒
*   1. **目标 WS 判定**: `params.workstreamId ?? NA.workstream_id` —
*      Task 必须属一个 WS（task.schema.json 必填 workstream_id）⇒
*      无 workstream_id 的 NA 在 PROMOTE 时**必须**显式给 WS（GUI 选择面）;
*      NA 已带 WS 时显式参数必须一致（不允许静默改挂）; WS 必须在树中存在
*      （§16.3）;
*   2. **计划前置**: 目标 WS 的 `plan.yaml` 必须存在（物化 = 插入既有
*      canonical plan — 无计划文件的 WS 先建计划; 同时此前置让补偿面
*      永远有旧字节可恢复 — writer 无 unlink 面, 不制造「补偿即删除」）;
*   3. **物化 Task 定义文件**（§4.1）: 分配 T id（共享 allocator, §1.1
*      规则 2）→ `PlanStore.createItem('task', doc)`（冻结 task.schema.json
*      前置校验 + 原子写; title = NA.statement（≤200, schema maxLength）,
*      goal = statement + rationale 附注, acceptance_criteria=[] ⇒
*      validation 只能 NOT_REQUIRED — INV-TASK-3 合法; created_by = USER
*      执行者）;
*   4. **重写 plan.yaml**（§4.4）: 旧文件精确字节留存（补偿用）→
*      `PlanStore.savePlan(新序)`（§4.4 三校验 + 原子写）; 插入位置
*      `params.index`（默认末尾）;
*   5. **DB 事务**: NA 行乐观条件 UPDATE `PROPOSED → PROMOTED`
*      （promoted_to_task_id 落定 — 存储层 trigger 钉死一经生成不可更换）
*      + `PLAN_ITEM_ADDED` 账本行（§12.1 冻结 kind — 「新 item 进计划」的
*      provenance; actor = USER 执行者）; 0 行 ⇒ 并发迁移 ⇒ 整事务回滚;
*   6. **补偿**（文件半边已落而 DB 失败 / 并发迁移）: 恢复旧 plan.yaml
*      精确字节（原子回写）; Task 定义文件**保留**为未列入定义
*      （INV-PLAN-9 合法部分态 — 本服务从不删除 .research 文件, §10
*      「restore 显式触发」）; 烧号留 gap（§1.1 规则 2）; 大声错误
*      （PROMOTE_CONCURRENT / PROMOTE_DB_FAILED; 补偿自身失败 ⇒
*      PROMOTE_COMPENSATION_FAILED — 人工介入, 同 WP-3.4 §6.6 口径）。
*   7. §12.1/§13: 不写 ResearchHistory（CATALOG 无 NA 事件 — 模块头核查
*      口径; 账本行是唯一落库痕迹）。
*/
/**
* 物化 Task 的下一个 id（WP-3.4 `computeNewPlan` 同款先例 — 目标 plan 内
* 该 kind 最大序号 + 1; Task 定义在声明式层, 其 id 面是 plan-local 的,
* 不经 §1.1 meta 计数器 — 与既有声明式 T 序号零碰撞）。
*/
function nextTaskSequence(planItems) {
	let max = 0;
	for (const id of planItems) {
		if (!ID_PATTERNS.task.test(id)) continue;
		const n = Number(id.slice(2));
		if (n > max) max = n;
	}
	return max + 1;
}
/**
* 下一个**可用** Task id（nextTaskSequence 起, 跳过已存在定义文件的 id —
* 上一次失败物化留下的未列入孤儿定义: §1.1 规则 3 禁覆盖, 孤儿按
* INV-PLAN-9 保留不删 ⇒ 本物化取下一个空位, 孤儿留在盘上合法）。
*/
function allocateTaskId(planItems, definitionExists) {
	let seq = nextTaskSequence(planItems);
	let taskId = `T-${seq}`;
	while (definitionExists(taskId)) {
		seq += 1;
		taskId = `T-${seq}`;
	}
	return taskId;
}
var ActionsService = class {
	store;
	reader;
	writer;
	researchRoot;
	schemaDir;
	allocator;
	projectId;
	db;
	runExists;
	now;
	/** Objective 声明式面（任务书目标 1 — 同一模块的第三对象）。 */
	objectives;
	constructor(options) {
		this.store = options.store;
		this.reader = options.reader;
		this.writer = options.writer;
		this.researchRoot = options.researchRoot;
		this.schemaDir = options.schemaDir;
		this.allocator = options.allocator;
		this.projectId = options.projectId;
		this.db = options.db;
		this.runExists = options.runExists;
		this.now = options.now ?? Date.now;
		this.objectives = new ObjectiveFileService({
			reader: this.reader,
			writer: this.writer,
			researchRoot: this.researchRoot,
			schemaDir: this.schemaDir,
			allocator: this.allocator,
			projectId: this.projectId,
			db: this.db,
			now: this.now
		});
	}
	/**
	* Create one PROPOSED NextAction（USER 或 AGENT — AGENT 泳道经
	* `research_next_action_create` 工具面; `workstreamId` 存在性在此
	* 按 §16.3 第 2 条写时校验）。
	*/
	createNextAction(params, actor) {
		assertNextActionCreator(actor, "createNextAction");
		if (params.workstreamId !== void 0) this.assertWorkstreamExists(params.workstreamId, "createNextAction", "ACT_INPUT");
		return this.store.createNextAction(params, actor);
	}
	/**
	* PROMOTE — 转正为 Task（用户 only; 物化流见模块头）。
	*/
	promoteNextAction(id, params = {}, actor) {
		assertUserActor$4(actor, `promoteNextAction(${id})`);
		if (typeof id !== "string" || id.length === 0) throw new ActionsError("ACT_INPUT", "promoteNextAction: next action id must be a non-empty string");
		if (params.index !== void 0 && (!Number.isSafeInteger(params.index) || params.index < 0)) throw new ActionsError("PROMOTE_INPUT", `promoteNextAction(${id}): index must be a non-negative safe integer (got ${String(params.index)})`);
		const na = this.store.getNextAction(id);
		if (na === null) throw new ActionsError("NA_NOT_FOUND", `next action ${JSON.stringify(id)} does not exist`);
		checkNextActionTransition(id, na.status, "PROMOTED");
		const wsId = params.workstreamId ?? na.workstream_id;
		if (wsId === void 0) throw new ActionsError("PROMOTE_INPUT", `promoteNextAction(${id}): a Task must belong to a workstream (task.schema.json required workstream_id) — this NextAction carries no workstream_id, so the PROMOTE call must name one (GUI 选择面)`);
		if (na.workstream_id !== void 0 && na.workstream_id !== wsId) throw new ActionsError("PROMOTE_INPUT", `promoteNextAction(${id}): the NextAction is tied to ${na.workstream_id} but the call targets ${wsId} — a promote never re-hangs the action onto another workstream (explicit mismatch, fail loud)`);
		const tree = this.loadTreeOrThrow(`promoteNextAction(${id})`, "PROMOTE_PLAN");
		const wsNode = this.findWorkstream(tree, wsId, `promoteNextAction(${id})`, "PROMOTE_INPUT");
		const planStore = this.planStore(wsNode);
		const plan = planStore.loadPlan();
		if (plan.errors.length > 0) {
			const e = plan.errors[0];
			throw new ActionsError("PROMOTE_PLAN", `promoteNextAction(${id}): the canonical plan of ${wsId} is inconsistent — refusing to build on it: [${e.code}] ${e.file}${e.path !== void 0 ? ` ${e.path}` : ""}: ${e.message}`);
		}
		if (!plan.present) throw new ActionsError("PROMOTE_PLAN", `promoteNextAction(${id}): ${wsId} has no canonical plan.yaml — materialization inserts into an EXISTING plan; create/seed the plan first`);
		const oldPlanBytes = this.reader.readFile(pjoin(this.researchRoot, planStore.planPath()));
		if (oldPlanBytes === null) throw new ActionsError("PROMOTE_PLAN", `promoteNextAction(${id}): the plan file of ${wsId} is present per loadPlan but unreadable — internal reader inconsistency`);
		const index = params.index ?? plan.items.length;
		if (index > plan.items.length) throw new ActionsError("PROMOTE_INPUT", `promoteNextAction(${id}): index ${index} is beyond the plan length ${plan.items.length} (0..${plan.items.length})`);
		const now = this.now();
		const taskId = allocateTaskId(plan.items, (tid) => this.reader.readFile(pjoin(this.researchRoot, planStore.itemPath("task", tid))) !== null);
		let newOrder;
		try {
			const taskDoc = this.buildTaskDoc(taskId, wsId, na, actor, now);
			planStore.createItem("task", taskDoc);
			newOrder = [
				...plan.items.slice(0, index),
				taskId,
				...plan.items.slice(index)
			];
			planStore.savePlan(newOrder);
		} catch (cause) {
			if (cause instanceof ActionsError) throw cause;
			throw new ActionsError("PROMOTE_PLAN", `promoteNextAction(${id}): the file stage failed (${cause instanceof Error ? cause.message : String(cause)}) — plan.yaml was not successfully rewritten; the new task definition file, if written, remains unlisted (INV-PLAN-9 合法部分态); the NextAction stays PROPOSED and is retryable`, { cause });
		}
		const maRes = this.allocator.reserve("MANAGEMENT_ACTION", this.projectId);
		try {
			this.db.transaction(() => {
				if (this.db.run(SQL_TRANSITION_NEXT_ACTION, "PROMOTED", taskId, id) === 0) {
					const reread = this.store.getNextAction(id);
					if (reread === null) throw new ActionsError("NA_NOT_FOUND", `next action ${JSON.stringify(id)} vanished during transition (no-delete trigger in effect — investigate)`);
					throw new ActionsError("PROMOTE_CONCURRENT", `next action ${JSON.stringify(id)} moved concurrently (expected PROPOSED, now ${reread.status}) — refetch and retry`);
				}
				const ma = {
					id: maRes.id,
					action_kind: "PLAN_ITEM_ADDED",
					actor,
					subject_refs: [{
						kind: "TASK",
						id: taskId
					}, {
						kind: "WORKSTREAM",
						id: wsId
					}],
					detail: `next action ${id} promoted to task ${taskId} in ${wsId} plan (index ${index}; new plan length ${newOrder.length})`,
					occurred_at: now
				};
				this.db.run(SQL_INSERT_MANAGEMENT_ACTION, ...managementActionToParams(ma));
			});
		} catch (cause) {
			this.allocator.release(maRes);
			this.compensatePlan(planStore, oldPlanBytes, `promoteNextAction(${id})`, true);
			if (cause instanceof ActionsError && (cause.code === "PROMOTE_CONCURRENT" || cause.code === "NA_NOT_FOUND")) throw cause;
			throw new ActionsError("PROMOTE_DB_FAILED", `promoteNextAction(${id}): the DB transaction failed (${cause instanceof Error ? cause.message : String(cause)}) — plan.yaml was restored to its previous bytes; the new task definition file remains unlisted (INV-PLAN-9); the NextAction stays PROPOSED and is retryable`, { cause });
		}
		this.allocator.commit(maRes);
		return {
			nextActionId: id,
			taskId,
			workstreamId: wsId,
			planPath: planStore.planPath(),
			newOrder,
			managementActionId: maRes.id
		};
	}
	/**
	* DISMISS（§13 终态; 用户 only）。无物化面 — 纯行状态迁移。
	*/
	dismissNextAction(id, actor) {
		assertUserActor$4(actor, `dismissNextAction(${id})`);
		return this.store.dismissNextAction(id, actor);
	}
	/**
	* Create one ACTIVE Blocker（§9.4; `affects` 引用存在性按 §16.3 写时
	* 校验: WS/T 经声明式树, RUN 经 run 表面 — 「写入新引用时失败 = 拒绝」）。
	*/
	createBlocker(params, actor) {
		assertUserActor$4(actor, "createBlocker", "BLK_ACTOR");
		this.assertAffectsExist(params.affects, "createBlocker");
		return this.store.createBlocker(params, actor);
	}
	/**
	* CLEAR（§13 终态; 用户 only; 复发 = 新 Blocker 行）。
	*/
	clearBlocker(id, actor) {
		assertUserActor$4(actor, `clearBlocker(${id})`, "BLK_ACTOR");
		return this.store.clearBlocker(id, actor);
	}
	listNextActions(filter = {}) {
		return this.store.listNextActions(filter);
	}
	listBlockers(filter = {}) {
		return this.store.listBlockers(filter);
	}
	listObjectives() {
		return this.objectives.loadObjectives().objectives;
	}
	planStore(wsNode) {
		return new PlanStore({
			reader: this.reader,
			writer: this.writer,
			researchRoot: this.researchRoot,
			schemaDir: this.schemaDir,
			topicId: wsNode.topicId,
			wsId: wsNode.id
		});
	}
	/**
	* 补偿: 恢复旧 plan.yaml 精确字节（原子回写）。定义文件保留（INV-PLAN-9
	* 未列入定义合法态 — 本服务零删除）。补偿失败 ⇒ PROMOTE_COMPENSATION_FAILED
	* （人工介入, 同 WP-3.4 §6.6 口径）— 原错误丢失, 补偿失败是更严重的状态。
	*/
	compensatePlan(planStore, oldPlanBytes, context, planDirty) {
		if (!planDirty) return;
		const absPlan = pjoin(this.researchRoot, planStore.planPath());
		try {
			this.writer.writeAtomic(absPlan, oldPlanBytes);
		} catch (cause) {
			throw new ActionsError("PROMOTE_COMPENSATION_FAILED", `COMPENSATION FAILED: ${context} — the plan.yaml could not be restored to its previous bytes (${cause instanceof Error ? cause.message : String(cause)}); the plan file may hold the NEW materialized order while the NextAction is still PROPOSED. Manual intervention required (git restore — INV-GIT-8)`, { cause });
		}
	}
	/** PROMOTE 物化的 TaskDoc（§4.1 字段面; acceptance_criteria=[] — INV-TASK-3）。 */
	buildTaskDoc(taskId, wsId, na, actor, at) {
		return {
			id: taskId,
			workstream_id: wsId,
			title: na.statement.length > 200 ? `${na.statement.slice(0, 197)}…` : na.statement,
			goal: na.rationale !== void 0 ? `${na.statement}\n\n（NextAction 提案理由）${na.rationale}` : na.statement,
			deliverables: [],
			acceptance_criteria: [],
			created_by: { ...actor },
			created_at: at
		};
	}
	loadTreeOrThrow(operation, code) {
		const load = loadResearchTree(this.reader, this.researchRoot, this.schemaDir);
		if (load.errors.length > 0) {
			const e = load.errors[0];
			throw new ActionsError(code, `${operation}: the declarative tree failed to load — refusing to operate on a broken tree: [${e.code}] ${e.file || "<root>"}${e.path !== void 0 ? ` ${e.path}` : ""}: ${e.message}`);
		}
		return load.tree;
	}
	findWorkstream(tree, wsId, operation, code) {
		for (const topic of tree.topics) {
			const ws = topic.workstreams.find((w) => w.id === wsId);
			if (ws !== void 0) return ws;
		}
		throw new ActionsError(code, `${operation}: workstream ${JSON.stringify(wsId)} does not exist (DOMAIN_SCHEMA §16.3 — 写入时引用校验 = 拒绝)`);
	}
	/** §16.3 第 2 条: operational → 声明式, 写入时校验（WS 存在）。 */
	assertWorkstreamExists(wsId, operation, code) {
		const tree = this.loadTreeOrThrow(operation, code);
		this.findWorkstream(tree, wsId, operation, code);
	}
	/** §16.3 写时校验: affects 引用逐一存在（WS/T 树; RUN 表面）。 */
	assertAffectsExist(affects, operation) {
		const tree = this.loadTreeOrThrow(operation, "ACT_INPUT");
		const wsIds = /* @__PURE__ */ new Set();
		const taskIds = /* @__PURE__ */ new Set();
		for (const topic of tree.topics) for (const ws of topic.workstreams) {
			wsIds.add(ws.id);
			for (const t of ws.tasks) taskIds.add(t.id);
		}
		for (const ref of affects) if (ref.kind === "WORKSTREAM") {
			if (!wsIds.has(ref.id)) throw new ActionsError("BLK_REF_MISSING", `${operation}: affects reference {kind: WORKSTREAM, id: ${JSON.stringify(ref.id)}} does not exist (DOMAIN_SCHEMA §16.3 — 写入新引用时失败 = 拒绝)`);
		} else if (ref.kind === "TASK") {
			if (!taskIds.has(ref.id)) throw new ActionsError("BLK_REF_MISSING", `${operation}: affects reference {kind: TASK, id: ${JSON.stringify(ref.id)}} does not exist (DOMAIN_SCHEMA §16.3)`);
		} else if (!this.runExists.exists(ref.id)) throw new ActionsError("BLK_REF_MISSING", `${operation}: affects reference {kind: RUN, id: ${JSON.stringify(ref.id)}} does not exist in the run table (DOMAIN_SCHEMA §16.3 第 3 条)`);
	}
};
//#endregion
//#region src/host/service/reporting/types.ts
/**
* WP-5.3 — reporting layer shared types: Interaction / ReportingItem /
* ScheduledEvent (DOMAIN_SCHEMA §10, operational 真源 = research.sqlite;
* the frozen row projection is `schema/operational/reporting.schema.json`).
*
* Layering (ARCHITECTURE §2.2): this module is pure data + pure guards —
* zero I/O, zero driver import, zero DSH import (INV-PERM-5). The DB is
* reached only through the injected `ReportingDb` structural port (the
* established dual-connection pattern: runbinding / planfork / flooding
* each carry the same five-method face — re-declared here field-for-field
* so the reporting layer has no cross-WP dependency; the wiring's
* `adaptDatabaseSync` satisfies it structurally).
*
* 对象纪律 (per 任务边界 + §10/§13):
*  - 三对象全部 operational, 全部**登记制** (no delete / no content
*    update — 存储层 trigger 兜底, schema.ts);
*  - Interaction / ScheduledEvent 无状态列 ⇒ 创建后整体不可变;
*  - ReportingItem 有状态机 (§13): `OPEN → MATERIAL_READY →
*    READY_TO_REPORT → REPORTED → FOLLOW_UP_REQUIRED` (+回退边), 状态列
*    status/reported_at 是派生缓存列 (合法 UPDATE 面), 其余内容列不可变;
*  - ScheduledEvent **不接外部 Calendar** (§10.3 原文): 只管理用户登记的
*    事件; V1 无调度器/提醒推送 (到期语义 = 查询面按时间窗过滤,
*    schedule.ts 头注)。
*/
/** `InteractionKind` (reporting.schema.json $defs/Interaction.kind). */
const INTERACTION_KINDS = [
	"MEETING",
	"AD_HOC_DISCUSSION",
	"SUPERVISOR_UPDATE",
	"COLLABORATOR_DISCUSSION",
	"EXPERIMENT_SHIFT_HANDOFF",
	"OTHER"
];
function isInteractionKind(value) {
	return typeof value === "string" && INTERACTION_KINDS.includes(value);
}
/** `RptStatus` (reporting.schema.json $defs/ReportingItem.status). */
const RPT_STATUSES = [
	"OPEN",
	"MATERIAL_READY",
	"READY_TO_REPORT",
	"REPORTED",
	"FOLLOW_UP_REQUIRED"
];
function isRptStatus(value) {
	return typeof value === "string" && RPT_STATUSES.includes(value);
}
/** `SevFreq` (reporting.schema.json $defs/ScheduledEvent.schedule RECURRING). */
const SEV_FREQS = [
	"DAILY",
	"WEEKLY",
	"MONTHLY"
];
function isSevFreq(value) {
	return typeof value === "string" && SEV_FREQS.includes(value);
}
/**
* The frozen `related_refs` kind restriction of ScheduledEvent
* (reporting.schema.json: 「提醒 research-aware: 显示关联 RPT/IV/TPC」).
*/
const SEV_RELATED_REF_KINDS = [
	"REPORTING_ITEM",
	"INTERVENTION",
	"TOPIC"
];
function isSevRelatedRefKind(value) {
	return typeof value === "string" && SEV_RELATED_REF_KINDS.includes(value);
}
/** A structured reporting-layer failure (never a raw driver exception). */
var ReportingError = class extends Error {
	code;
	constructor(options) {
		super(options.message, options.cause !== void 0 ? { cause: options.cause } : void 0);
		this.name = "ReportingError";
		this.code = options.code;
	}
};
//#endregion
//#region src/host/service/reporting/schema.ts
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
const INTERACTION_TABLE = "interaction";
const REPORTING_ITEM_TABLE = "reporting_item";
const SCHEDULED_EVENT_TABLE = "scheduled_event";
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
`;
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
`;
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
`;
/** Full DDL (idempotent — re-applied on every service open, 同先例). */
function reportingDdl() {
	return INTERACTION_DDL + REPORTING_ITEM_DDL + SCHEDULED_EVENT_DDL;
}
const SQL_INSERT_INTERACTION = `
INSERT INTO ${INTERACTION_TABLE} (id, kind, title, occurred_at, participants, notes, related_workstreams)
VALUES (?, ?, ?, ?, ?, ?, ?)
`;
const SQL_SELECT_INTERACTION_BY_ID = `SELECT * FROM ${INTERACTION_TABLE} WHERE id = ?`;
const SQL_INSERT_REPORTING_ITEM = `
INSERT INTO ${REPORTING_ITEM_TABLE} (id, audience, statement, material_refs, status, occasion_ref, created_at, reported_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;
const SQL_SELECT_REPORTING_ITEM_BY_ID = `SELECT * FROM ${REPORTING_ITEM_TABLE} WHERE id = ?`;
/**
* The optimistic state-machine UPDATE (WHERE status = from — 并发双迁移
* 只有一个成功; 0 行 ⇒ 重读判别 RPT_NOT_FOUND / RPT_WRONG_STATE, 同
* planfork/intervention 先例). `reported_at` = 新值由 service 计算
* (进入 REPORTED 且尚未记录时写入 now; 其余情况保持原值 — 历史事实列)。
*/
const SQL_TRANSITION_REPORTING_ITEM = `
UPDATE ${REPORTING_ITEM_TABLE} SET status = ?, reported_at = ? WHERE id = ? AND status = ?
`;
const SQL_INSERT_SCHEDULED_EVENT = `
INSERT INTO ${SCHEDULED_EVENT_TABLE} (id, title, schedule, related_refs, reminder_lead_ms)
VALUES (?, ?, ?, ?, ?)
`;
const SQL_SELECT_SCHEDULED_EVENT_BY_ID = `SELECT * FROM ${SCHEDULED_EVENT_TABLE} WHERE id = ?`;
const CORRUPT$2 = (what, detail) => {
	throw new Error(`reporting row corruption at ${what}: ${detail}`);
};
function decodeJson$2(value, what) {
	if (typeof value !== "string") return CORRUPT$2(what, `expected JSON string, got ${typeof value}`);
	try {
		return JSON.parse(value);
	} catch (cause) {
		return CORRUPT$2(what, `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
	}
}
function decodeStringArray(value, what) {
	const arr = decodeJson$2(value, what);
	if (!Array.isArray(arr) || arr.some((item) => typeof item !== "string")) return CORRUPT$2(what, `expected a JSON string array, got ${JSON.stringify(String(value)).slice(0, 80)}`);
	return arr;
}
function decodeTypedRefs(value, what) {
	const arr = decodeJson$2(value, what);
	if (!Array.isArray(arr) || arr.some((item) => item === null || typeof item !== "object" || typeof item.kind !== "string" || typeof item.id !== "string")) return CORRUPT$2(what, `expected a JSON TypedRef array, got ${JSON.stringify(String(value)).slice(0, 80)}`);
	return arr;
}
/** Decode a `schedule` cell (ONCE / RECURRING 封闭联合; 冻结形状校验). */
function decodeSchedule(value, what) {
	const obj = decodeJson$2(value, what);
	if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return CORRUPT$2(what, `expected a schedule object, got ${typeof value}`);
	if (obj.kind === "ONCE") {
		if (typeof obj.at !== "number" || !Number.isSafeInteger(obj.at) || obj.at < 0) return CORRUPT$2(`${what}.at`, `expected non-negative epoch ms, got ${JSON.stringify(obj.at)}`);
		return {
			kind: "ONCE",
			at: obj.at
		};
	}
	if (obj.kind === "RECURRING") {
		if (!isSevFreq(obj.freq)) return CORRUPT$2(`${what}.freq`, `unknown freq ${JSON.stringify(obj.freq)}`);
		const result = {
			kind: "RECURRING",
			freq: obj.freq
		};
		if (obj.interval !== void 0) {
			if (typeof obj.interval !== "number" || !Number.isSafeInteger(obj.interval) || obj.interval < 1) return CORRUPT$2(`${what}.interval`, `expected integer ≥ 1, got ${JSON.stringify(obj.interval)}`);
			result.interval = obj.interval;
		}
		if (obj.until !== void 0) {
			if (typeof obj.until !== "number" || !Number.isSafeInteger(obj.until) || obj.until < 0) return CORRUPT$2(`${what}.until`, `expected non-negative epoch ms, got ${JSON.stringify(obj.until)}`);
			result.until = obj.until;
		}
		return result;
	}
	return CORRUPT$2(`${what}.kind`, `unknown schedule kind ${JSON.stringify(obj.kind)}`);
}
/** The normalized schedule cell form (interval default 1 落库 — 确定性展示). */
function encodeSchedule(schedule) {
	if (schedule.kind === "ONCE") return JSON.stringify({
		kind: "ONCE",
		at: schedule.at
	});
	return JSON.stringify({
		kind: "RECURRING",
		freq: schedule.freq,
		interval: schedule.interval ?? 1,
		...schedule.until !== void 0 ? { until: schedule.until } : {}
	});
}
/** Encode `InteractionRecord` into the INSERT parameter list (column order = DDL). */
function interactionToParams(r) {
	return [
		r.id,
		r.kind,
		r.title,
		r.occurred_at,
		r.participants === void 0 ? null : JSON.stringify([...r.participants]),
		r.notes ?? null,
		r.related_workstreams === void 0 ? null : JSON.stringify([...r.related_workstreams])
	];
}
/** Decode an `interaction` row back to the record (throws on corruption). */
function rowToInteraction(row) {
	if (typeof row.id !== "string") return CORRUPT$2("interaction.id", `expected string, got ${typeof row.id}`);
	if (!isInteractionKind(row.kind)) return CORRUPT$2("interaction.kind", `unknown kind ${JSON.stringify(String(row.kind))}`);
	if (typeof row.title !== "string") return CORRUPT$2("interaction.title", `expected string, got ${typeof row.title}`);
	if (typeof row.occurred_at !== "number") return CORRUPT$2("interaction.occurred_at", `expected number, got ${typeof row.occurred_at}`);
	return {
		id: row.id,
		kind: row.kind,
		title: row.title,
		occurred_at: row.occurred_at,
		...row.participants != null ? { participants: decodeStringArray(row.participants, "interaction.participants") } : {},
		...row.notes != null ? { notes: String(row.notes) } : {},
		...row.related_workstreams != null ? { related_workstreams: decodeStringArray(row.related_workstreams, "interaction.related_workstreams") } : {}
	};
}
/** Encode `ReportingItemRecord` into the INSERT parameter list (column order = DDL). */
function reportingItemToParams(r) {
	return [
		r.id,
		r.audience,
		r.statement,
		r.material_refs === void 0 ? null : JSON.stringify(r.material_refs.map((t) => ({
			kind: t.kind,
			id: t.id
		}))),
		r.status,
		r.occasion_ref ?? null,
		r.created_at,
		r.reported_at ?? null
	];
}
/** Decode a `reporting_item` row back to the record (throws on corruption). */
function rowToReportingItem(row) {
	if (typeof row.id !== "string") return CORRUPT$2("reporting_item.id", `expected string, got ${typeof row.id}`);
	if (typeof row.audience !== "string") return CORRUPT$2("reporting_item.audience", `expected string, got ${typeof row.audience}`);
	if (typeof row.statement !== "string") return CORRUPT$2("reporting_item.statement", `expected string, got ${typeof row.statement}`);
	if (!isRptStatus(row.status)) return CORRUPT$2("reporting_item.status", `unknown status ${JSON.stringify(String(row.status))}`);
	if (typeof row.created_at !== "number") return CORRUPT$2("reporting_item.created_at", `expected number, got ${typeof row.created_at}`);
	return {
		id: row.id,
		audience: row.audience,
		statement: row.statement,
		...row.material_refs != null ? { material_refs: decodeTypedRefs(row.material_refs, "reporting_item.material_refs") } : {},
		status: row.status,
		...row.occasion_ref != null ? { occasion_ref: String(row.occasion_ref) } : {},
		created_at: row.created_at,
		...row.reported_at != null ? { reported_at: row.reported_at } : {}
	};
}
/** Encode `ScheduledEventRecord` into the INSERT parameter list (column order = DDL). */
function scheduledEventToParams(r) {
	return [
		r.id,
		r.title,
		encodeSchedule(r.schedule),
		r.related_refs === void 0 ? null : JSON.stringify(r.related_refs.map((t) => ({
			kind: t.kind,
			id: t.id
		}))),
		r.reminder_lead_ms ?? null
	];
}
/** Decode a `scheduled_event` row back to the record (throws on corruption). */
function rowToScheduledEvent(row) {
	if (typeof row.id !== "string") return CORRUPT$2("scheduled_event.id", `expected string, got ${typeof row.id}`);
	if (typeof row.title !== "string") return CORRUPT$2("scheduled_event.title", `expected string, got ${typeof row.title}`);
	const result = {
		id: row.id,
		title: row.title,
		schedule: decodeSchedule(row.schedule, "scheduled_event.schedule")
	};
	if (row.related_refs != null) {
		const refs = decodeTypedRefs(row.related_refs, "scheduled_event.related_refs");
		for (const ref of refs) if (!isSevRelatedRefKind(ref.kind)) return CORRUPT$2("scheduled_event.related_refs", `ref kind ${JSON.stringify(ref.kind)} is not one of REPORTING_ITEM|INTERVENTION|TOPIC`);
		result.related_refs = refs;
	}
	if (row.reminder_lead_ms != null) {
		if (typeof row.reminder_lead_ms !== "number") return CORRUPT$2("scheduled_event.reminder_lead_ms", `expected number, got ${typeof row.reminder_lead_ms}`);
		result.reminder_lead_ms = row.reminder_lead_ms;
	}
	return result;
}
//#endregion
//#region src/host/service/reporting/state-machine.ts
/**
* WP-5.3 — ReportingItem 状态机 (纯函数, 零 I/O).
*
* 合法转换表 = DOMAIN_SCHEMA §13 逐字 (ReportingItem 行):
*
*   OPEN               → MATERIAL_READY
*   MATERIAL_READY     → READY_TO_REPORT | OPEN
*   READY_TO_REPORT    → REPORTED | MATERIAL_READY
*   REPORTED           → FOLLOW_UP_REQUIRED
*   FOLLOW_UP_REQUIRED → READY_TO_REPORT
*
* 规则 (同 §13 通则 / INV-TASK-1):
*   - 非法转换在 **service 层拒绝** (本模块的纯 guard, `ReportingError`
*     code `RPT_WRONG_STATE`, 消息携带合法集);
*   - 自环拒绝 (表外 — 同 intervention §13 guard 的 self-loop 纪律);
*   - 无终态 (表内所有状态均有出边 — REPORTED 经 FOLLOW_UP_REQUIRED 回到
*     READY_TO_REPORT, 汇报可多轮)。
*
* CATALOG 侧: HISTORY_EVENT_CATALOG §4 无 RPT_* 事件 (本层无 registry
* 事件 — 与 WP-3.1 PlanFork / WP-3.5 intervention 状态缓存同口径: 状态
* 迁移 = 条件 UPDATE 状态缓存列, 行内容不可变 trigger 兜底)。
*/
/** The §13 legal transition table (the single source for the guard). */
const RPT_LEGAL_TRANSITIONS = {
	OPEN: ["MATERIAL_READY"],
	MATERIAL_READY: ["READY_TO_REPORT", "OPEN"],
	READY_TO_REPORT: ["REPORTED", "MATERIAL_READY"],
	REPORTED: ["FOLLOW_UP_REQUIRED"],
	FOLLOW_UP_REQUIRED: ["READY_TO_REPORT"]
};
/** True iff `to` is a legal §13 successor of `from` (self-loops illegal). */
function isRptTransitionLegal(from, to) {
	return RPT_LEGAL_TRANSITIONS[from].includes(to);
}
/**
* Guard one transition: throw `RPT_WRONG_STATE` when `to` is not a legal
* successor of `from` (message carries the legal set — the same UX
* contract as the planfork/intervention §13 guards).
*/
function checkRptTransition(id, from, to) {
	if (from === to) {
		const legal = RPT_LEGAL_TRANSITIONS[from].join(" | ");
		throw new ReportingError({
			code: "RPT_WRONG_STATE",
			message: `reporting item ${JSON.stringify(id)} is already ${from} (self-loops are rejected; legal from ${from}: ${legal === "" ? "none" : legal} — DOMAIN_SCHEMA §13)`
		});
	}
	if (!isRptTransitionLegal(from, to)) {
		const legal = RPT_LEGAL_TRANSITIONS[from].join(" | ");
		throw new ReportingError({
			code: "RPT_WRONG_STATE",
			message: `reporting item ${JSON.stringify(id)} cannot transition ${from} → ${to} (legal from ${from}: ${legal === "" ? "none" : legal} — DOMAIN_SCHEMA §13)`
		});
	}
}
//#endregion
//#region src/host/service/reporting/schedule.ts
/**
* V1 窗口过滤 (§10.3 到期语义): 事件在窗口内「到期/活跃」当且仅当
*  - ONCE: `at` ∈ [from, to];
*  - RECURRING: 活跃跨度 (−∞, until or +∞) 与 [from, to] 相交。
*/
function eventActiveInWindow(schedule, window) {
	if (schedule.kind === "ONCE") {
		if (schedule.at < window.from) return false;
		return window.to === void 0 || schedule.at <= window.to;
	}
	return schedule.until === void 0 || schedule.until >= window.from;
}
/**
* 时间轴排序键: ONCE → `at`; RECURRING → `until` (无 until →
* `Number.MAX_SAFE_INTEGER`, 活跃中的 recurring 排在列表尾部)。
* 同键时由调用方以 id 破平 (确定性)。
*/
function scheduleSortKey(schedule) {
	if (schedule.kind === "ONCE") return schedule.at;
	return schedule.until ?? Number.MAX_SAFE_INTEGER;
}
//#endregion
//#region src/host/service/reporting/service.ts
var ReportingService = class {
	db;
	allocator;
	projectId;
	now;
	closed = false;
	constructor(options) {
		this.db = options.db;
		this.allocator = options.allocator;
		this.projectId = options.projectId;
		this.now = options.now ?? Date.now;
		this.db.exec(reportingDdl());
	}
	/**
	* 登记一个 Interaction (DOMAIN_SCHEMA §10.1; USER 语义 — 冻结 13-RPC
	* 的 registerInteraction 经此落库). 分配 INT id (PROJECT scope) → 单
	* 事务 INSERT → commit; 失败 release (烧号留 gap, §1.1 规则 2)。
	*/
	registerInteraction(params) {
		this.assertOpen("registerInteraction");
		assertNonEmptyString$1(params.title, "title");
		assertEpoch(params.occurredAt, "occurredAt");
		if (!isInteractionKind(params.kind)) throw new ReportingError({
			code: "INT_INPUT",
			message: `kind must be one of the 6 frozen InteractionKind values (got ${JSON.stringify(params.kind)})`
		});
		if (params.participants !== void 0) assertNonEmptyStringArray(params.participants, "participants");
		if (params.notes !== void 0 && typeof params.notes !== "string") throw new ReportingError({
			code: "INT_INPUT",
			message: "notes must be a string (Markdown 会议纪要等)"
		});
		if (params.relatedWorkstreams !== void 0) {
			assertNonEmptyStringArray(params.relatedWorkstreams, "relatedWorkstreams");
			for (const ws of params.relatedWorkstreams) assertWorkstreamId(ws, "relatedWorkstreams");
		}
		const at = this.now();
		const res = this.allocator.reserve("INTERACTION", this.projectId);
		const record = {
			id: res.id,
			kind: params.kind,
			title: params.title,
			occurred_at: params.occurredAt,
			...params.participants !== void 0 ? { participants: [...params.participants] } : {},
			...params.notes !== void 0 ? { notes: params.notes } : {},
			...params.relatedWorkstreams !== void 0 ? { related_workstreams: [...params.relatedWorkstreams] } : {}
		};
		try {
			this.db.transaction(() => {
				this.db.run(SQL_INSERT_INTERACTION, ...interactionToParams(record));
			});
		} catch (cause) {
			this.allocator.release(res);
			throw this.wrap("registerInteraction", cause);
		}
		this.allocator.commit(res);
		return {
			record,
			createdAt: at
		};
	}
	/** One record by id (`null` when absent). */
	getInteraction(id) {
		this.assertOpen("getInteraction");
		return this.readInteraction(id);
	}
	/**
	* List with filters (kind / workstreamId containment / occurred_at
	* window). Order: occurred_at ASC, id ASC (stable). V1 规模全表过滤
	* (10^4 行, §15 未要求索引)。
	*/
	listInteractions(filter = {}) {
		this.assertOpen("listInteractions");
		if (filter.kind !== void 0 && !isInteractionKind(filter.kind)) throw new ReportingError({
			code: "INT_INPUT",
			message: `filter.kind must be a frozen InteractionKind (got ${JSON.stringify(filter.kind)})`
		});
		if (filter.workstreamId !== void 0) assertWorkstreamId(filter.workstreamId, "filter.workstreamId");
		if (filter.from !== void 0) assertEpoch(filter.from, "filter.from");
		if (filter.to !== void 0) assertEpoch(filter.to, "filter.to");
		if (filter.from !== void 0 && filter.to !== void 0 && filter.from > filter.to) throw new ReportingError({
			code: "INT_INPUT",
			message: `filter window is inverted (from ${filter.from} > to ${filter.to})`
		});
		const clauses = [];
		const params = [];
		if (filter.kind !== void 0) {
			clauses.push("kind = ?");
			params.push(filter.kind);
		}
		if (filter.workstreamId !== void 0) {
			clauses.push("related_workstreams LIKE ?");
			params.push(`%"${filter.workstreamId}"%`);
		}
		if (filter.from !== void 0) {
			clauses.push("occurred_at >= ?");
			params.push(filter.from);
		}
		if (filter.to !== void 0) {
			clauses.push("occurred_at <= ?");
			params.push(filter.to);
		}
		const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
		return this.db.all(`SELECT * FROM ${INTERACTION_TABLE} ${where} ORDER BY occurred_at ASC, id ASC`, ...params).map((r) => rowToInteraction(r));
	}
	/**
	* 登记一个 ReportingItem (DOMAIN_SCHEMA §10.2 — 「要向谁、何时、
	* 汇报什么」; 不是 Task). 初始状态 OPEN。occasion_ref 写入时存在性
	* 校验 (必须指向已存在的 SEV — §16 规则 3/4); material_refs 形状
	* 校验 (kind ∈ ObjectKind + id 良构 — 跨对象存在性由调用方上下文
	* 负责, V1 收窄)。
	*/
	createReportingItem(params) {
		this.assertOpen("createReportingItem");
		assertNonEmptyString$1(params.audience, "audience");
		assertNonEmptyString$1(params.statement, "statement");
		if (params.materialRefs !== void 0) assertTypedRefArray(params.materialRefs, "materialRefs");
		if (params.occasionRef !== void 0) {
			assertScheduledEventId(params.occasionRef, "occasionRef");
			if (this.readScheduledEvent(params.occasionRef) === null) throw new ReportingError({
				code: "RPT_INPUT",
				message: `occasionRef ${JSON.stringify(params.occasionRef)} does not reference an existing scheduled event (DOMAIN_SCHEMA §16 规则 3/4 — 写入新引用失败即拒绝)`
			});
		}
		const at = this.now();
		const res = this.allocator.reserve("REPORTING_ITEM", this.projectId);
		const record = {
			id: res.id,
			audience: params.audience,
			statement: params.statement,
			...params.materialRefs !== void 0 ? { material_refs: params.materialRefs.map((t) => ({
				kind: t.kind,
				id: t.id
			})) } : {},
			status: "OPEN",
			...params.occasionRef !== void 0 ? { occasion_ref: params.occasionRef } : {},
			created_at: at
		};
		try {
			this.db.transaction(() => {
				this.db.run(SQL_INSERT_REPORTING_ITEM, ...reportingItemToParams(record));
			});
		} catch (cause) {
			this.allocator.release(res);
			throw this.wrap("createReportingItem", cause);
		}
		this.allocator.commit(res);
		return record;
	}
	/**
	* 执行一次 §13 状态迁移 (非法转换拒绝 — INV-TASK-1)。两步并发门:
	* ① 读行 + 纯 guard (RPT_WRONG_STATE 携带合法集); ② 乐观条件 UPDATE
	* (WHERE status = from) — 0 行 ⇒ 并发迁移已先行, 重读判别
	* RPT_NOT_FOUND / RPT_WRONG_STATE。`reported_at` 语义: 进入 REPORTED
	* 且尚未记录时写入 now (历史事实列 — 后续 FOLLOW_UP_REQUIRED 保留)。
	* Returns the UPDATED record (fresh read after commit)。
	*/
	transitionReportingItem(id, to) {
		this.assertOpen("transitionReportingItem");
		if (!isRptStatus(to)) throw new ReportingError({
			code: "RPT_INPUT",
			message: `target status must be one of the 5 frozen RptStatus values (got ${JSON.stringify(to)})`
		});
		const current = this.readReportingItem(id);
		if (current === null) throw new ReportingError({
			code: "RPT_NOT_FOUND",
			message: `reporting item ${JSON.stringify(id)} does not exist`
		});
		checkRptTransition(id, current.status, to);
		const reportedAt = to === "REPORTED" && current.reported_at === void 0 ? this.now() : current.reported_at;
		try {
			if (this.db.run(SQL_TRANSITION_REPORTING_ITEM, to, reportedAt ?? null, id, current.status) === 0) {
				const reread = this.readReportingItem(id);
				if (reread === null) throw new ReportingError({
					code: "RPT_NOT_FOUND",
					message: `reporting item ${JSON.stringify(id)} vanished during transition (no-delete trigger in effect — investigate)`
				});
				checkRptTransition(id, reread.status, to);
				throw new ReportingError({
					code: "RPT_WRONG_STATE",
					message: `reporting item ${JSON.stringify(id)} moved concurrently (expected ${current.status}) — refetch and retry`
				});
			}
		} catch (cause) {
			if (cause instanceof ReportingError) throw cause;
			throw this.wrap(`transitionReportingItem(${id})`, cause);
		}
		const updated = this.readReportingItem(id);
		if (updated === null) throw new ReportingError({
			code: "RPT_NOT_FOUND",
			message: `reporting item ${JSON.stringify(id)} vanished after transition (internal)`
		});
		return updated;
	}
	/** One record by id (`null` when absent). */
	getReportingItem(id) {
		this.assertOpen("getReportingItem");
		return this.readReportingItem(id);
	}
	/**
	* List with filters (status / occasionRef / audience). Order:
	* created_at ASC, id ASC (stable).
	*/
	listReportingItems(filter = {}) {
		this.assertOpen("listReportingItems");
		if (filter.status !== void 0 && !isRptStatus(filter.status)) throw new ReportingError({
			code: "RPT_INPUT",
			message: `filter.status must be a frozen RptStatus (got ${JSON.stringify(filter.status)})`
		});
		if (filter.occasionRef !== void 0) assertScheduledEventId(filter.occasionRef, "filter.occasionRef");
		if (filter.audience !== void 0) assertNonEmptyString$1(filter.audience, "filter.audience");
		const clauses = [];
		const params = [];
		if (filter.status !== void 0) {
			clauses.push("status = ?");
			params.push(filter.status);
		}
		if (filter.occasionRef !== void 0) {
			clauses.push("occasion_ref = ?");
			params.push(filter.occasionRef);
		}
		if (filter.audience !== void 0) {
			clauses.push("audience = ?");
			params.push(filter.audience);
		}
		const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
		return this.db.all(`SELECT * FROM ${REPORTING_ITEM_TABLE} ${where} ORDER BY created_at ASC, id ASC`, ...params).map((r) => rowToReportingItem(r));
	}
	/**
	* 登记一个 ScheduledEvent (DOMAIN_SCHEMA §10.3 — **只管理用户登记的
	* 事件; 不接外部 Calendar**). related_refs 的 kind 受限
	* (REPORTING_ITEM | INTERVENTION | TOPIC — 冻结 schema): RPT/IV 引用
	* 写入时存在性校验 (同一 operational DB 面); TOPIC 为声明式引用
	* (形状校验 — 树校验归调用方上下文)。
	*/
	createScheduledEvent(params) {
		this.assertOpen("createScheduledEvent");
		assertNonEmptyString$1(params.title, "title");
		this.assertScheduleShape(params.schedule, "schedule");
		if (params.relatedRefs !== void 0) {
			if (!Array.isArray(params.relatedRefs)) throw new ReportingError({
				code: "SEV_INPUT",
				message: "relatedRefs must be a TypedRef array"
			});
			for (const ref of params.relatedRefs) {
				assertTypedRef$3(ref, "relatedRefs");
				if (!isSevRelatedRefKind(ref.kind)) throw new ReportingError({
					code: "SEV_INPUT",
					message: `relatedRefs kind ${JSON.stringify(ref.kind)} is not one of REPORTING_ITEM | INTERVENTION | TOPIC (reporting.schema.json 冻结限制)`
				});
				if (ref.kind === "REPORTING_ITEM") {
					assertReportingItemId(ref.id, "relatedRefs");
					if (this.readReportingItem(ref.id) === null) throw new ReportingError({
						code: "SEV_INPUT",
						message: `relatedRefs ${ref.id} does not reference an existing reporting item (DOMAIN_SCHEMA §16 规则 3/4)`
					});
				}
				if (ref.kind === "INTERVENTION") {
					if (!/^IV-[1-9][0-9]*$/.test(ref.id)) throw new ReportingError({
						code: "SEV_INPUT",
						message: `relatedRefs id ${JSON.stringify(ref.id)} is not a well-formed IV id`
					});
					if (this.db.get(`SELECT id FROM intervention WHERE id = ?`, ref.id) === void 0) throw new ReportingError({
						code: "SEV_INPUT",
						message: `relatedRefs ${ref.id} does not reference an existing intervention (DOMAIN_SCHEMA §16 规则 3/4)`
					});
				}
				if (ref.kind === "TOPIC") {
					if (!/^TPC-[1-9][0-9]*$/.test(ref.id)) throw new ReportingError({
						code: "SEV_INPUT",
						message: `relatedRefs id ${JSON.stringify(ref.id)} is not a well-formed TPC id`
					});
				}
			}
		}
		if (params.reminderLeadMs !== void 0) {
			if (typeof params.reminderLeadMs !== "number" || !Number.isSafeInteger(params.reminderLeadMs) || params.reminderLeadMs < 0) throw new ReportingError({
				code: "SEV_INPUT",
				message: `reminderLeadMs must be a non-negative safe integer (got ${String(params.reminderLeadMs)})`
			});
		}
		const res = this.allocator.reserve("SCHEDULED_EVENT", this.projectId);
		const record = {
			id: res.id,
			title: params.title,
			schedule: params.schedule,
			...params.relatedRefs !== void 0 ? { related_refs: params.relatedRefs.map((t) => ({
				kind: t.kind,
				id: t.id
			})) } : {},
			...params.reminderLeadMs !== void 0 ? { reminder_lead_ms: params.reminderLeadMs } : {}
		};
		try {
			this.db.transaction(() => {
				this.db.run(SQL_INSERT_SCHEDULED_EVENT, ...scheduledEventToParams(record));
			});
		} catch (cause) {
			this.allocator.release(res);
			throw this.wrap("createScheduledEvent", cause);
		}
		this.allocator.commit(res);
		return record;
	}
	/** One record by id (`null` when absent). */
	getScheduledEvent(id) {
		this.assertOpen("getScheduledEvent");
		return this.readScheduledEvent(id);
	}
	/**
	* List all scheduled events, optionally V1 时间窗过滤 (到期语义,
	* schedule.ts): ONCE → `at` ∈ 窗口; RECURRING → 活跃跨度与窗口相交。
	* Order: scheduleSortKey ASC, id ASC (时间轴; 活跃 recurring 排尾部)。
	*/
	listScheduledEvents(window = null) {
		this.assertOpen("listScheduledEvents");
		if (window !== null) {
			assertEpoch(window.from, "window.from");
			if (window.to !== void 0) assertEpoch(window.to, "window.to");
			if (window.to !== void 0 && window.from > window.to) throw new ReportingError({
				code: "SEV_INPUT",
				message: `window is inverted (from ${window.from} > to ${window.to})`
			});
		}
		const records = this.db.all(`SELECT * FROM ${SCHEDULED_EVENT_TABLE} ORDER BY id ASC`).map((r) => rowToScheduledEvent(r));
		return (window === null ? records : records.filter((rec) => eventActiveInWindow(rec.schedule, window))).sort((a, b) => {
			const ka = scheduleSortKey(a.schedule);
			const kb = scheduleSortKey(b.schedule);
			if (ka !== kb) return ka - kb;
			return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
		});
	}
	readInteraction(id) {
		assertIdInput(id, "id");
		const row = this.db.get(SQL_SELECT_INTERACTION_BY_ID, id);
		return row === void 0 ? null : rowToInteraction(row);
	}
	readReportingItem(id) {
		assertIdInput(id, "id");
		const row = this.db.get(SQL_SELECT_REPORTING_ITEM_BY_ID, id);
		return row === void 0 ? null : rowToReportingItem(row);
	}
	readScheduledEvent(id) {
		assertIdInput(id, "id");
		const row = this.db.get(SQL_SELECT_SCHEDULED_EVENT_BY_ID, id);
		return row === void 0 ? null : rowToScheduledEvent(row);
	}
	assertScheduleShape(schedule, what) {
		if (schedule === null || typeof schedule !== "object") throw new ReportingError({
			code: "SEV_INPUT",
			message: `${what} must be an ONCE or RECURRING schedule object`
		});
		const kind = schedule.kind;
		if (schedule.kind === "ONCE") {
			assertEpoch(schedule.at, `${what}.at`);
			return;
		}
		if (schedule.kind === "RECURRING") {
			if (!isSevFreq(schedule.freq)) throw new ReportingError({
				code: "SEV_INPUT",
				message: `${what}.freq must be one of DAILY | WEEKLY | MONTHLY (got ${JSON.stringify(schedule.freq)})`
			});
			if (schedule.interval !== void 0 && (typeof schedule.interval !== "number" || !Number.isSafeInteger(schedule.interval) || schedule.interval < 1)) throw new ReportingError({
				code: "SEV_INPUT",
				message: `${what}.interval must be an integer ≥ 1 (got ${String(schedule.interval)})`
			});
			if (schedule.until !== void 0) assertEpoch(schedule.until, `${what}.until`);
			return;
		}
		throw new ReportingError({
			code: "SEV_INPUT",
			message: `${what}.kind must be 'ONCE' or 'RECURRING' (got ${JSON.stringify(kind)})`
		});
	}
	assertOpen(operation) {
		if (this.closed) throw new ReportingError({
			code: "REPORTING_STORE",
			message: `${operation}: service is closed`
		});
	}
	wrap(context, cause) {
		return new ReportingError({
			code: "REPORTING_STORE",
			message: `${context}: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause
		});
	}
};
function assertIdInput(id, what) {
	if (typeof id !== "string" || id.length === 0) throw new ReportingError({
		code: "RPT_INPUT",
		message: `${what} must be a non-empty string`
	});
}
function assertNonEmptyString$1(value, what) {
	if (typeof value !== "string" || value.length === 0) throw new ReportingError({
		code: "RPT_INPUT",
		message: `${what} must be a non-empty string`
	});
}
function assertNonEmptyStringArray(value, what) {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) throw new ReportingError({
		code: "RPT_INPUT",
		message: `${what} must be an array of non-empty strings`
	});
}
function assertEpoch(value, what) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ReportingError({
		code: "RPT_INPUT",
		message: `${what} must be a non-negative safe integer epoch ms (got ${String(value)}; §1.2/A-3)`
	});
}
function assertWorkstreamId(id, what) {
	if (!/^WS-[1-9][0-9]*$/.test(id)) throw new ReportingError({
		code: "RPT_INPUT",
		message: `${what} entry ${JSON.stringify(id)} is not a well-formed WS id (§1.1)`
	});
}
function assertScheduledEventId(id, what) {
	if (!/^SEV-[1-9][0-9]*$/.test(id)) throw new ReportingError({
		code: "RPT_INPUT",
		message: `${what} ${JSON.stringify(id)} is not a well-formed SEV id (§1.1)`
	});
}
function assertReportingItemId(id, what) {
	if (!/^RPT-[1-9][0-9]*$/.test(id)) throw new ReportingError({
		code: "RPT_INPUT",
		message: `${what} entry ${JSON.stringify(id)} is not a well-formed RPT id (§1.1)`
	});
}
/** `TypedRef` 形状 (kind 非空 + id 良构 — 前缀注册表可解析). */
function assertTypedRef$3(ref, what) {
	if (ref === null || typeof ref !== "object" || typeof ref.kind !== "string" || ref.kind.length === 0 || typeof ref.id !== "string" || ref.id.length === 0) throw new ReportingError({
		code: "RPT_INPUT",
		message: `${what} entries must be TypedRef {kind, id} (frozen shape)`
	});
	if (parseId(ref.id) === null) throw new ReportingError({
		code: "RPT_INPUT",
		message: `${what} id ${JSON.stringify(ref.id)} is not well-formed (no registered §1.1 prefix)`
	});
}
function assertTypedRefArray(refs, what) {
	if (!Array.isArray(refs)) throw new ReportingError({
		code: "RPT_INPUT",
		message: `${what} must be a TypedRef array`
	});
	for (const ref of refs) {
		assertTypedRef$3(ref, what);
		if (!OBJECT_KIND_VALUES.includes(ref.kind)) throw new ReportingError({
			code: "RPT_INPUT",
			message: `${what} kind ${JSON.stringify(ref.kind)} is not a §1.3 ObjectKind`
		});
	}
}
//#endregion
//#region src/host/service/intervention/types.ts
/**
* 机械触发种类（WP-3.5 冻结闭集, INV-ATTN-5）→ Intervention origin。
* 闭集即 §6 脚注 ¹ 三类; **不**含 Claim scientific conflict（INV-ATTN-5
* 明言）— 该映射的键集 = 闭集, 无第四种入口。
*/
const MECHANICAL_TRIGGER_ORIGIN = {
	PLAN_FORK_FLOODING: "AUTO_FLOODING",
	AUDIT_HIGH_IMPACT_DISCREPANCY: "AUTO_AUDIT",
	AGENT_REPORT_REQUIRES_HUMAN: "AGENT_REPORT"
};
/** 机械触发种类 → 允许的 actor kind（catalog §5.7: origin=AUTO_* ⇒ PLUGIN;
*  AGENT_REPORT = Agent 报告面 ⇒ AGENT）。 */
const MECHANICAL_TRIGGER_ACTOR_KIND = {
	PLAN_FORK_FLOODING: "PLUGIN",
	AUDIT_HIGH_IMPACT_DISCREPANCY: "PLUGIN",
	AGENT_REPORT_REQUIRES_HUMAN: "AGENT"
};
var InterventionError = class extends Error {
	code;
	constructor(init) {
		super(init.message, init.cause === void 0 ? void 0 : { cause: init.cause });
		this.name = "InterventionError";
		this.code = init.code;
	}
};
function isInterventionError(error) {
	return error instanceof InterventionError;
}
/** 供事件面/测试消费的 actor 归一（本模块 actor 面 → 冻结 ActorRef 载体）。 */
function toActorRef(actor) {
	const ref = { kind: actor.kind };
	if (actor.kind === "AGENT" && actor.run_id !== void 0) ref.run_id = actor.run_id;
	if (actor.kind === "USER" && actor.user_id !== void 0) ref.user_id = actor.user_id;
	if (actor.label !== void 0) ref.label = actor.label;
	return ref;
}
//#endregion
//#region src/host/service/intervention/state-machine.ts
/**
* WP-5.1 — §13 Intervention 状态机的**服务面**（门 + 查询）。
*
* 冻结迁移表本身在 WP-3.5 `service/flooding/state-machine.ts`（单一来源,
* 本模块只加门语义 + 本模块错误码, 不复制表 — 决策见报告「实现要点 1」）:
*
*   OPEN    → PENDING | CLOSED
*   PENDING → OPEN    | CLOSED
*   CLOSED  → （终态, 无出口; 重开 = 新 Intervention, 不是迁移）
*
* INV-PERM-4（「Intervention 状态只允许用户显式修改」）: 本模块的门函数
* **不携带 actor 参数** — actor 门在 `InterventionService.updateState`
* （UserActorRef 类型面 + 运行面断言, 双面拒绝）; 状态机只管「迁移本身
* 是否合法」这一维。
*/
/**
* §13 门（service 面）: 非法迁移抛 `IV_ILLEGAL_TRANSITION`, 消息列合法集
* + 终态点名（同 WP-3.1 `checkPfTransition` / WP-3.5 纪律）。
*
* 与 WP-3.5 纯面的唯一差别 = 错误载体: 本面抛 `InterventionError`
* （service 错误分类法）, WP-3.5 面抛 `FloodingError`（其调用面用）。
* 判定逻辑零重复（`checkInterventionTransition` 委托 + 重包）。
*/
function assertInterventionTransition(id, from, to) {
	try {
		checkInterventionTransition(id, from, to);
	} catch (cause) {
		if (isFloodingError(cause) && cause.code === "FLOODING_ILLEGAL_TRANSITION") throw new InterventionError({
			code: "IV_ILLEGAL_TRANSITION",
			message: cause.message
		});
		throw new InterventionError({
			code: "IV_INPUT",
			message: cause instanceof Error ? cause.message : String(cause)
		});
	}
}
//#endregion
//#region src/host/service/intervention/schema.ts
/**
* WP-5.1 — intervention 表生命周期 SQL（纯数据, 零 I/O）。
*
* 表 DDL / 行映射 / INSERT / 查询 SQL 的**单一来源在 WP-3.5**
* `service/flooding/schema.ts`（本模块原样复用, 不复制 — 决策见报告
* 「实现要点 1」: 复用既有表, 不迁移新模块、不建第二张表）。本文件只
* 交付 WP-5.1 新增的唯一 SQL: 状态缓存列的条件 UPDATE。
*
* 冻结触发器语义（flooding DDL `intervention_no_content_update`）:
* 创建后**只有** status/closed_at/resolution_note 三个状态缓存列可
* UPDATE（§13 迁移的合法行侧面 — 仅用户, INV-PERM-4）。本 SQL 恰好只
* 触这三列; 任何内容列写入会被存储层 trigger ABORT（任何连接生效,
* 双保险）。
*
* 乐观并发门 `AND status = ?`（同 WP-4.1a 原线面 / planfork 条件 UPDATE
* 模式）: 迁移前读到的状态与写时不一致 ⇒ 0 行 ⇒ service 大声失败
* （IV_CONCURRENT_STATE）, 不猜。
*/
/**
* 状态缓存列条件 UPDATE（INV-PERM-4 用户面唯一行侧写; DDL 触发器放行的
* 三列 = 本 SQL 的 SET 列表, 逐字对齐）。
* 参数序: (status, closed_at, resolution_note, id, expectedStatus)。
*/
const SQL_UPDATE_INTERVENTION_STATE = `UPDATE ${INTERVENTION_TABLE} SET status = ?, closed_at = ?, resolution_note = ? WHERE id = ? AND status = ?`;
//#endregion
//#region src/host/service/intervention/store.ts
/**
* WP-5.1 — `InterventionLifecycleStore`: intervention 行的**生命周期面**
* （insert + 全量查询 + 用户状态缓存 UPDATE; append-only）。
*
* 表 / 触发器 / 行形状 = WP-3.5 冻结面（复用 — 本文件**不**含 CREATE
* TABLE; 构造时对注入连接幂等应用 WP-3.5 `interventionDdl()` — 第二连接
* 模式: 多连接 WAL 共存, 写经文件锁串行化, 同 WP-3.5/WP-3.1 先例）。
*
* 面（API 面即权限面 — 同 WP-3.5 纪律）:
*   - **无 delete 方法**（§15 通则 / INV-HIST-7; 存储层 trigger 兜底任何
*     连接的 raw DELETE）;
*   - **无内容 UPDATE 方法**（创建后 8 个内容列不可变 — trigger 兜底;
*     唯一的合法行侧写 = `updateState` 的状态缓存三列, §13 迁移仅用户,
*     INV-PERM-4 — actor 门在 service 层, 本层只执行行侧机械动作）;
*   - 查询**无隐藏过滤器**: `listInterventions` 按 (workstreamId?,
*     status?, origin?) 任一子集过滤, 全部参数缺省 = 全量（INV-ATTN-1
*     「完整展示」的存储半边 — 过滤只用于调用方显式指名, service 查询
*     面从不替调用方隐藏行）。
*
* 组合（决策: 复用 WP-3.5 `InterventionStore` 作 insert/查询委托, 零形状
* 网重复）:
*   - `interventions`（WP-3.5 store, 注入的既有实例 — 生产 = wiring 的
*     同一 intervention 连接上的实例）: insert（整行过真实冻结
*     attention.schema.json 形状网）+ get/list;
*   - `db`（本 store 自有连接面）: 状态缓存列条件 UPDATE
*     （`SQL_UPDATE_INTERVENTION_STATE`, 乐观并发门 `AND status = ?`）。
*
* 错误纪律: 边界参数畸形 = IV_INPUT; 驱动/SQL 失败包 IV_STORE（cause
* 保留）。
*/
var InterventionLifecycleStore = class {
	#db;
	#interventions;
	closed = false;
	constructor(options) {
		if (options.db === void 0 || typeof options.db.exec !== "function" || typeof options.db.run !== "function") throw new InterventionError({
			code: "IV_INPUT",
			message: "db: the injected operational-DB face (exec/run/get/all/transaction) is required"
		});
		if (options.interventions === void 0 || typeof options.interventions.insertIntervention !== "function") throw new InterventionError({
			code: "IV_INPUT",
			message: "interventions: a WP-3.5 InterventionStore (insert/query face) is required"
		});
		this.#db = options.db;
		this.#interventions = options.interventions;
		this.#db.exec(interventionDdl());
	}
	/**
	* Insert ONE intervention row（委托 WP-3.5 store — 整行过真实冻结
	* `$defs/Intervention` 形状网; 单语句 autocommit）。调用方（service）
	* 负责 IV/H 双号 reserve/commit 与事件先行纪律。
	*/
	insertIntervention(record) {
		this.#assertOpen("insertIntervention");
		try {
			return this.#interventions.insertIntervention(record);
		} catch (cause) {
			if (cause instanceof InterventionError) throw cause;
			if (isFloodingError(cause)) throw new InterventionError({
				code: cause.code === "FLOODING_INPUT" || cause.code === "FLOODING_SCHEMA_UNAVAILABLE" ? "IV_INPUT" : "IV_STORE",
				message: cause.message,
				cause
			});
			throw this.#wrap("insertIntervention", cause);
		}
	}
	/**
	* §13 迁移的行侧写（状态缓存三列; DDL 触发器放行的唯一 UPDATE 面）:
	* 条件 `AND status = expectedStatus`（乐观并发门）— 返回受影响行数
	* （0 ⇒ 迁移期间状态已变, service 大声失败 IV_CONCURRENT_STATE）。
	*/
	updateState(id, status, closedAt, resolutionNote, expectedStatus) {
		this.#assertOpen("updateState");
		if (typeof id !== "string" || !/^IV-[1-9][0-9]*$/.test(id)) throw new InterventionError({
			code: "IV_INPUT",
			message: `updateState: id must be a well-formed IV id (got ${JSON.stringify(String(id))})`
		});
		assertIvStatus("updateState.status", status);
		assertIvStatus("updateState.expectedStatus", expectedStatus);
		if (closedAt !== null && (typeof closedAt !== "number" || !Number.isSafeInteger(closedAt) || closedAt < 0)) throw new InterventionError({
			code: "IV_INPUT",
			message: `updateState: closedAt must be null or a non-negative safe integer epoch ms (got ${String(closedAt)})`
		});
		if (resolutionNote !== null && typeof resolutionNote !== "string") throw new InterventionError({
			code: "IV_INPUT",
			message: `updateState: resolutionNote must be null or a string (got ${typeof resolutionNote})`
		});
		try {
			return this.#db.run(SQL_UPDATE_INTERVENTION_STATE, status, closedAt, resolutionNote, id, expectedStatus);
		} catch (cause) {
			throw this.#wrap("updateState", cause);
		}
	}
	/** One record by id（`null` when absent）。 */
	getIntervention(id) {
		this.#assertOpen("getIntervention");
		try {
			return this.#interventions.getIntervention(id);
		} catch (cause) {
			throw this.#wrap("getIntervention", cause);
		}
	}
	/** List by (workstreamId?, status?, origin?) — 稳定顺序
	*  created_at ASC, id ASC（继承 WP-3.5 查询面; 全缺省 = 全量）。 */
	listInterventions(filter = {}) {
		this.#assertOpen("listInterventions");
		try {
			return this.#interventions.listInterventions(filter);
		} catch (cause) {
			throw this.#wrap("listInterventions", cause);
		}
	}
	#assertOpen(operation) {
		if (this.closed) throw new InterventionError({
			code: "IV_STORE",
			message: `${operation}: store is closed`
		});
	}
	/** Test/inspection seam（no-op 语义: store 无生命周期状态可关 — 连接
	*  归 wiring 的单一 disposer）。 */
	close() {
		this.closed = true;
	}
	#wrap(context, cause) {
		return new InterventionError({
			code: "IV_STORE",
			message: `${context}: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause
		});
	}
};
function assertIvStatus(what, value) {
	if (typeof value !== "string" || !IV_STATUSES.includes(value)) throw new InterventionError({
		code: "IV_INPUT",
		message: `${what} must be one of ${IV_STATUSES.join("|")} (got ${JSON.stringify(String(value))})`
	});
}
//#endregion
//#region src/host/service/intervention/service.ts
/**
* WP-5.1 — `InterventionService`: Intervention 生命周期（创建 / 状态迁移 /
* 全量查询）。
*
* ## 创建（两类来源, 任务目标 1）
*
*   `createUserIntervention(params, actor: UserActorRef)`
*      — 用户类（GUI 手工登记）: origin 常量 `USER`（构建面不接受 origin
*        参数）, created_by = actor;
*   `createMechanicalIntervention(params, actor: MechanicalActorRef)`
*      — 机械类: origin + actor kind 由 `trigger: MechanicalTriggerKind`
*        （INV-ATTN-5 闭集, WP-3.5 冻结面）推导（types.ts 映射, 零自由度:
*        AUTO_* ⇒ PLUGIN; AGENT_REPORT ⇒ AGENT）; 触发种类与 actor kind
*        不配对 ⇒ IV_ACTOR_FORBIDDEN（运行面, 同类型面双钉）。
*
* 共同纪律（顺序, 同 WP-3.5 §8 动作 / WP-2.4 两连接写序）:
*   ① 全预校验（无写）: title/WS id 模式/WS 存在性（§16 规则 2 写入时
*      校验: 新引用失败 = 拒绝）/trigger 配对;
*   ② reserve IV 号（+ H 号 — 仅当有 WS 关联, 无关联不发事件,
*      TC-DOM-023）;
*   ③ INTERVENTION_CREATED 事件经 `store.appendEvents` append — registry
*      `validate` hook 在 store 写事务内（INV-HIST-4: 未过冻结校验的事件
*      永不落地; E 列矩阵 U/A/P + origin=AUTO_* ⇒ actor.kind=PLUGIN 的
*      CROSS_FIELD 在 registry 内钉; ctx 的 interventions map 排除本批
*      新建 IV id — 「新建」检查语义, 同 WP-2.4 excludeRunIds 先例）;
*   ④ intervention 行落库（lifecycle store; 整行过真实冻结
*      attention.schema.json 形状网）;
*   ⑤ commit 号。
*
* 失败窗口（文档化残差, 同 WP-3.5 头注）: ③ 已提交、④ 失败 ⇒ 事件在、
* 行缺（事件是合法 catalog 事件; 行滞后收敛 — V1 无跨连接事务）; 任何
* 失败都 release 全部预留号（§1.1 单调, gap 合法）。
*
* ## 状态迁移（INV-PERM-4 — 仅用户, 双面）
*
* `updateState(id, status, actor: UserActorRef, resolutionNote?)`:
*   - **类型面**: actor 参数类型 `UserActorRef`（AGENT/PLUGIN/SYSTEM 是
*     编译错误）;
*   - **运行面**: `assertUserActor`（伪造的非 USER actor ⇒ IV_ACTOR_FORBIDDEN,
*     零写入）— 同 WP-3.4 `assertUserActor` / WP-2.4 `UserActorRef` 先例;
*   - §13 合法性（state-machine.ts 门, 冻结表单一来源在 WP-3.5）:
*     OPEN ↔ PENDING; OPEN|PENDING → CLOSED 终态; 自环非法; 重开 = 新
*     Intervention（CLOSED 无出口）;
*   - resolutionNote 仅 CLOSED 合法（「关闭时用户填写」, §9.2; 与
*     WP-4.1a 线面语义逐字一致 — 非关闭携带 note ⇒ IV_INPUT）;
*   - 行侧写 = lifecycle store 的条件 UPDATE（`AND status = ?` 乐观并发
*     门; 0 行 ⇒ IV_CONCURRENT_STATE, 大声不猜）;
*   - **无 History 事件**: 冻结目录（CATALOG §4）的人类注意力事件**只有**
*     INTERVENTION_CREATED — 状态迁移无对应事件, 不落事件 = 不虚构
*     （目录 §7 新增事件需 bump schemaVersion, 归冻结文档维护面）。
*
* ## 查询（INV-ATTN-1 的 service 层落点: 无隐藏过滤器）
*
* `get` / `listOpen` / `listPending` / `listActive`（OPEN + PENDING 全量
* 成对）/ `listClosed`: 返回该状态集的**全部**行（不排序、不截断、不
* 按 origin/WS 筛选 — 稳定顺序 created_at ASC, id ASC 继承 WP-3.5 查询
* 面）。「Attention Manager 只排序、不隐藏」的展示面 = client 分组视图
* （views/intervention）, service 层保证数据完整这一半。
*
* Layer (ARCHITECTURE §2.2): service — 唯一写 operational DB 的层。
* 无 DSH import (INV-PERM-5)。
*/
/** 冻结 WS id 模式（common.schema.json idWorkstream）。 */
const WS_ID_PATTERN = /^WS-[1-9][0-9]*$/;
/** 冻结 IV id 模式（common.schema.json idIntervention）。 */
const IV_ID_PATTERN = /^IV-[1-9][0-9]*$/;
var InterventionService = class {
	#store;
	#registry;
	#lifecycle;
	#allocator;
	#projectId;
	#externalState;
	#now;
	constructor(options) {
		if (options.store === void 0 || options.store === null || typeof options.store.appendEvents !== "function") throw new InterventionError({
			code: "IV_INPUT",
			message: "store: a WP-2.1 ResearchStore is required"
		});
		if (options.registry === void 0 || options.registry === null) throw new InterventionError({
			code: "IV_INPUT",
			message: "registry: a WP-2.2 event registry is required"
		});
		if (options.lifecycle === void 0 || options.lifecycle === null || typeof options.lifecycle.updateState !== "function") throw new InterventionError({
			code: "IV_INPUT",
			message: "lifecycle: an InterventionLifecycleStore is required"
		});
		if (options.allocator === void 0 || options.allocator === null || typeof options.allocator.reserve !== "function") throw new InterventionError({
			code: "IV_INPUT",
			message: "allocator: the shared IdAllocator is required"
		});
		if (typeof options.projectId !== "string" || options.projectId.length === 0) throw new InterventionError({
			code: "IV_INPUT",
			message: "projectId must be a non-empty string"
		});
		if (typeof options.externalState !== "function") throw new InterventionError({
			code: "IV_INPUT",
			message: "externalState: a declarative-snapshot provider is required"
		});
		this.#store = options.store;
		this.#registry = options.registry;
		this.#lifecycle = options.lifecycle;
		this.#allocator = options.allocator;
		this.#projectId = options.projectId;
		this.#externalState = options.externalState;
		this.#now = options.now ?? Date.now;
	}
	/**
	* 用户类创建（§6 矩阵行「Intervention 创建」U 栏）: origin 常量 USER;
	* actor 必须 USER（运行面断言 — 类型面在参数上）。
	*/
	createUserIntervention(params, actor) {
		assertUserActor$3(actor, "createUserIntervention");
		return this.#create(params, {
			origin: "USER",
			actor
		}, "createUserIntervention");
	}
	/**
	* 机械类创建（§6 矩阵行 A/P 栏 — 仅机械触发¹, INV-ATTN-5 闭集）:
	* origin 由 trigger 推导（types.ts 映射）; actor kind 必须与 trigger
	* 配对（AUTO_* ⇒ PLUGIN; AGENT_REPORT ⇒ AGENT — 运行面断言）。
	*/
	createMechanicalIntervention(params, actor) {
		const trigger = params.trigger;
		const expectedKind = MECHANICAL_TRIGGER_ACTOR_KIND[trigger];
		if (expectedKind === void 0) throw new InterventionError({
			code: "IV_INPUT",
			message: `createMechanicalIntervention: trigger ${JSON.stringify(String(trigger))} is not a member of the INV-ATTN-5 mechanical-trigger closed set`
		});
		if (actor === null || typeof actor !== "object" || actor.kind !== expectedKind) throw new InterventionError({
			code: "IV_ACTOR_FORBIDDEN",
			message: `createMechanicalIntervention: trigger ${trigger} requires an actor of kind ${expectedKind} (catalog §5.7: origin=AUTO_* ⇒ actor.kind=PLUGIN; AGENT_REPORT = agent report lane) — got ${JSON.stringify(actor)}`
		});
		return this.#create(params, {
			origin: MECHANICAL_TRIGGER_ORIGIN[trigger],
			actor
		}, "createMechanicalIntervention");
	}
	/**
	* 共同创建管线（module header 顺序纪律 ①–⑤）。抛出 `InterventionError`
	* （预校验/actor = IV_INPUT/IV_ACTOR_FORBIDDEN; registry 拒绝/append =
	* IV_EVENT; 行落库 = IV_STORE; 号预留 = IV_STORE）— 直接操作面（用户
	* GUI / agent 工具）, 失败必须大声, 与 flooding 钩子的非阻塞契约不同。
	*/
	#create(params, derived, operation) {
		const title = params.title;
		if (typeof title !== "string" || title.length === 0) throw new InterventionError({
			code: "IV_INPUT",
			message: `${operation}: title must be a non-empty string (DOMAIN_SCHEMA §9.2)`
		});
		const detail = params.detail;
		if (detail !== void 0 && (typeof detail !== "string" || detail.length === 0)) throw new InterventionError({
			code: "IV_INPUT",
			message: `${operation}: detail must be a non-empty string when present (DOMAIN_SCHEMA §9.2)`
		});
		const workstreamIds = params.workstream_ids ?? [];
		for (const ws of workstreamIds) if (typeof ws !== "string" || !WS_ID_PATTERN.test(ws)) throw new InterventionError({
			code: "IV_INPUT",
			message: `${operation}: workstream_ids must be well-formed WS ids ^WS-[1-9][0-9]*$ (got ${JSON.stringify(ws)})`
		});
		const sourceRefs = (params.source_refs ?? []).map((ref, i) => {
			if (ref === null || typeof ref !== "object" || typeof ref.kind !== "string" || typeof ref.id !== "string" || ref.id.length === 0) throw new InterventionError({
				code: "IV_INPUT",
				message: `${operation}: source_refs[${i}] must be a {kind, id} typedRef (got ${JSON.stringify(ref)})`
			});
			return {
				kind: ref.kind,
				id: ref.id
			};
		});
		const workstreams = this.#externalState().workstreams;
		for (const ws of workstreamIds) if (!workstreams.has(ws)) throw new InterventionError({
			code: "IV_INPUT",
			message: `${operation}: workstream ${ws} does not exist in the declarative snapshot (DOMAIN_SCHEMA §16 规则 2: 写入时校验)`
		});
		const createdAt = this.#now();
		const origin = derived.origin;
		const actor = toActorRef(derived.actor);
		const ownerWs = workstreamIds[0];
		let ivRes = null;
		let hRes = null;
		const releaseAll = () => {
			for (const res of [ivRes, hRes]) {
				if (res === null) continue;
				try {
					this.#allocator.release(res);
				} catch {}
			}
		};
		try {
			ivRes = this.#allocator.reserve("INTERVENTION", this.#projectId);
			if (ownerWs !== void 0) hRes = this.#allocator.reserve("HISTORY_EVENT", this.#projectId);
			let eventId = null;
			if (ownerWs !== void 0) {
				let event;
				try {
					event = this.#buildCreatedEvent(hRes.id, {
						id: ivRes.id,
						title,
						origin,
						ownerWs,
						sourceRefs,
						actor: derived.actor,
						occurredAt: createdAt
					});
				} catch (cause) {
					releaseAll();
					throw this.#wrapCause(cause, "IV_EVENT");
				}
				let appended;
				try {
					appended = this.#store.appendEvents([event], { validate: makeValidateHook$1(this.#registry, () => this.#buildEventContext(ivRes.id)) }).events[0];
				} catch (cause) {
					releaseAll();
					throw this.#wrapCause(cause, "IV_EVENT");
				}
				eventId = appended.eventId;
			}
			const record = {
				id: ivRes.id,
				title,
				origin,
				workstream_ids: [...workstreamIds],
				source_refs: sourceRefs,
				status: "OPEN",
				created_by: actor,
				created_at: createdAt,
				...detail !== void 0 ? { detail } : {}
			};
			try {
				this.#lifecycle.insertIntervention(record);
			} catch (cause) {
				releaseAll();
				throw this.#wrapCause(cause, "IV_STORE");
			}
			this.#allocator.commit(ivRes);
			if (hRes !== null) this.#allocator.commit(hRes);
			return {
				intervention: record,
				eventId
			};
		} catch (cause) {
			releaseAll();
			throw this.#wrapCause(cause, "IV_STORE");
		}
	}
	/**
	* CATALOG §5.7 INTERVENTION_CREATED 事件（payload 逐字:
	* intervention_id(新建)/title/origin/source_refs?）。
	*
	* V1 owner 推导适配（同 WP-3.5 头注）: registry 的 owner 规则只认
	* payload source_refs 内的 **WS-local** ref（`workstreamOf`）⇒ 事件
	* payload 的 `source_refs` 以**显式 WORKSTREAM ref（owner WS）打头**
	* （与 record.workstream_ids[0] 冗余一致, 非新信息）, 后跟记录本身的
	* source_refs; 记录行保持参数原样（§9.2: workstream_ids 独立承载 WS
	* 关联）。owner WS ref 已在记录 source_refs 内打头时不重复。
	*/
	#buildCreatedEvent(eventId, input) {
		if (typeof eventId !== "string" || !/^H-[1-9][0-9]*$/.test(eventId)) throw new InterventionError({
			code: "IV_INPUT",
			message: `buildCreatedEvent: eventId ${JSON.stringify(String(eventId))} is not a well-formed H id (^H-[1-9][0-9]*$)`
		});
		if (typeof input.id !== "string" || !IV_ID_PATTERN.test(input.id)) throw new InterventionError({
			code: "IV_INPUT",
			message: `buildCreatedEvent: intervention id ${JSON.stringify(String(input.id))} is not a well-formed IV id`
		});
		if (typeof input.occurredAt !== "number" || !Number.isSafeInteger(input.occurredAt) || input.occurredAt < 0) throw new InterventionError({
			code: "IV_INPUT",
			message: `buildCreatedEvent: occurredAt must be a non-negative safe integer epoch ms (got ${String(input.occurredAt)})`
		});
		const payloadRefs = input.sourceRefs.some((ref) => ref.kind === "WORKSTREAM" && ref.id === input.ownerWs) ? [...input.sourceRefs] : [{
			kind: "WORKSTREAM",
			id: input.ownerWs
		}, ...input.sourceRefs];
		return {
			eventId,
			ownerWorkstreamId: input.ownerWs,
			eventType: "INTERVENTION_CREATED",
			schemaVersion: 1,
			occurredAt: input.occurredAt,
			actor: toActorRef(input.actor),
			payload: {
				intervention_id: input.id,
				title: input.title,
				origin: input.origin,
				source_refs: payloadRefs
			}
		};
	}
	/**
	* INTERVENTION_CREATED 的校验 ctx（module header ③）: interventions
	* map = 现行所有行**排除本批新建 IV id**（「新建」检查语义）;
	* workstreams/runs = 注入的外部快照（WS 存在性 + owner 推导 + AGENT
	* actor.run_id 存在性, catalog §5）; 其余 map 空（validator 对本事件
	* 只查 interventions/workstreams/runs/source refs — 同 WP-3.5 先例）。
	*/
	#buildEventContext(excludeInterventionId) {
		const interventions = /* @__PURE__ */ new Map();
		for (const row of this.#lifecycle.listInterventions()) {
			if (row.id === excludeInterventionId) continue;
			interventions.set(row.id, { workstreamIds: row.workstream_ids });
		}
		const external = this.#externalState();
		return {
			workstreams: external.workstreams,
			tasks: /* @__PURE__ */ new Map(),
			runs: external.runs ?? /* @__PURE__ */ new Map(),
			claims: /* @__PURE__ */ new Map(),
			facts: /* @__PURE__ */ new Map(),
			artifacts: /* @__PURE__ */ new Map(),
			relations: /* @__PURE__ */ new Map(),
			gates: /* @__PURE__ */ new Map(),
			milestones: /* @__PURE__ */ new Map(),
			interventions,
			topologyEdges: /* @__PURE__ */ new Map()
		};
	}
	/**
	* §13 迁移（仅用户显式修改）:
	*   1. actor 运行面断言（类型面 = `UserActorRef` 参数 — 双面, 测试钉死）;
	*   2. 行存在（IV_NOT_FOUND）;
	*   3. §13 合法性门（IV_ILLEGAL_TRANSITION — 含自环; CLOSED 终态）;
	*   4. resolutionNote 仅 CLOSED（IV_INPUT — WP-4.1a 线面语义逐字）;
	*   5. 条件 UPDATE（`AND status = ?`; 0 行 ⇒ IV_CONCURRENT_STATE）。
	*
	* 无 History 事件（冻结目录无对应事件 — 不虚构, module header）。
	* 结果 DTO 与共享契约 `UpdateInterventionStateResult` 字段 1:1。
	*/
	updateState(interventionId, status, actor, resolutionNote) {
		assertUserActor$3(actor, "updateState");
		if (typeof interventionId !== "string" || !IV_ID_PATTERN.test(interventionId)) throw new InterventionError({
			code: "IV_INPUT",
			message: `updateState: interventionId must be a well-formed IV id (got ${JSON.stringify(String(interventionId))})`
		});
		if (typeof status !== "string" || ![
			"OPEN",
			"PENDING",
			"CLOSED"
		].includes(status)) throw new InterventionError({
			code: "IV_INPUT",
			message: `updateState: status must be one of OPEN|PENDING|CLOSED (got ${JSON.stringify(String(status))})`
		});
		if (resolutionNote !== void 0 && (typeof resolutionNote !== "string" || resolutionNote.length === 0)) throw new InterventionError({
			code: "IV_INPUT",
			message: "updateState: resolutionNote must be a non-empty string when present (DOMAIN_SCHEMA §9.2)"
		});
		const current = this.#lifecycle.getIntervention(interventionId);
		if (current === null) throw new InterventionError({
			code: "IV_NOT_FOUND",
			message: `intervention ${interventionId} does not exist`
		});
		assertInterventionTransition(interventionId, current.status, status);
		if (resolutionNote !== void 0 && status !== "CLOSED") throw new InterventionError({
			code: "IV_INPUT",
			message: "resolutionNote is only valid when closing an Intervention (status CLOSED; DOMAIN_SCHEMA §9.2)"
		});
		const closedAt = status === "CLOSED" ? this.#now() : null;
		let affected;
		try {
			affected = this.#lifecycle.updateState(interventionId, status, closedAt, resolutionNote ?? null, current.status);
		} catch (cause) {
			throw this.#wrapCause(cause, "IV_STORE");
		}
		if (affected === 0) throw new InterventionError({
			code: "IV_CONCURRENT_STATE",
			message: `intervention ${interventionId} moved concurrently (expected status ${current.status}) — refetch and retry`
		});
		return {
			interventionId,
			statusFrom: current.status,
			statusTo: status,
			closedAt,
			resolutionNote: status === "CLOSED" ? resolutionNote ?? null : null
		};
	}
	/** One record by id（`null` when absent）。 */
	get(interventionId) {
		return this.#lifecycle.getIntervention(interventionId);
	}
	/** OPEN 全量（稳定顺序 created_at ASC, id ASC; 不筛选不截断）。 */
	listOpen() {
		return this.#lifecycle.listInterventions({ status: "OPEN" });
	}
	/** PENDING 全量（同上）。 */
	listPending() {
		return this.#lifecycle.listInterventions({ status: "PENDING" });
	}
	/**
	* OPEN + PENDING 全量成对（§9.2 GUI 两个恒显组 — INV-ATTN-1: 始终完整
	* 展示; service 层 = 无隐藏过滤器, 展示层的排序/分组在 client 视图）。
	*/
	listActive() {
		return {
			open: this.listOpen(),
			pending: this.listPending()
		};
	}
	/** CLOSED 全量（§9.2「CLOSED 折叠」组 — 折叠是展示面, 数据仍完整）。 */
	listClosed() {
		return this.#lifecycle.listInterventions({ status: "CLOSED" });
	}
	#wrapCause(cause, code) {
		if (isInterventionError(cause)) return cause;
		return new InterventionError({
			code,
			message: cause instanceof Error ? cause.message : String(cause),
			cause
		});
	}
};
function assertUserActor$3(actor, operation) {
	if (actor === null || typeof actor !== "object" || actor.kind !== "USER") throw new InterventionError({
		code: "IV_ACTOR_FORBIDDEN",
		message: `${operation}: requires a USER actor (INV-PERM-4: Intervention 状态/用户创建面只允许用户显式操作; ARCHITECTURE §6 矩阵 U 栏) — got ${JSON.stringify(actor)}`
	});
	if (actor.user_id !== void 0 && typeof actor.user_id !== "string") throw new InterventionError({
		code: "IV_INPUT",
		message: `${operation}: actor.user_id must be a string (common.schema.json actorRef)`
	});
	if (actor.label !== void 0 && (typeof actor.label !== "string" || actor.label.length > 200)) throw new InterventionError({
		code: "IV_INPUT",
		message: `${operation}: actor.label must be a string of ≤200 chars (common.schema.json actorRef)`
	});
}
/**
* store `validate` hook 工厂: 批内每个事件过**冻结 registry** 校验
* （payload 严格性 INV-HIST-4 / 存在性 / owner 规则 / 发射者矩阵 E 列
* U/A/P / origin=AUTO_* ⇒ actor.kind=PLUGIN 的 CROSS_FIELD）, 任一失败
* 抛结构化 `InterventionError`（IV_EVENT）⇒ store 全批回滚（未过校验的
* 事件永不落地）。registry 不可用 ⇒ fail loud。
*/
function makeValidateHook$1(registry, buildContext) {
	return (events) => {
		if (!registry.isUsable) throw new InterventionError({
			code: "IV_EVENT",
			message: `the event registry is unusable (load errors: ${registry.loadErrors.map((e) => e.code).join(", ")}); refusing to append an unvalidated event`
		});
		const ctx = buildContext();
		for (const event of events) {
			const result = validateEvent(registry, event, ctx);
			if (!result.ok) throw new InterventionError({
				code: "IV_EVENT",
				message: `${event.eventType} (${event.eventId}) rejected by the frozen registry: ` + result.errors.map((e) => `[${e.code}] ${e.message}`).join("; ")
			});
		}
	};
}
//#endregion
//#region src/host/service/inbox/types.ts
/** `InboxSource` 7 值（§1.4 逐字）。 */
const INBOX_SOURCES = [
	"HUMAN_QUICK_CAPTURE",
	"UNCLASSIFIED_AUDIT_FINDING",
	"IMPORTED_MEETING_NOTE",
	"UNREGISTERED_WORKSPACE_CHANGE",
	"AGENT_UNSTRUCTURED_REPORT",
	"EXTERNAL_NOTE",
	"DISCOVERED_SESSION"
];
/** `InboxState` 3 值（§1.4 逐字; §13: CAPTURED → CONVERTED|DISMISSED 终态）。 */
const INBOX_STATES = [
	"CAPTURED",
	"CONVERTED",
	"DISMISSED"
];
/** 用户类捕获的 source（常量 — `captureHuman` 不接受 source 参数）。 */
const HUMAN_INBOX_SOURCE = "HUMAN_QUICK_CAPTURE";
/** 机械捕获 source 闭集（6 值 — §1.4 去掉 HUMAN_QUICK_CAPTURE）。 */
const MECHANICAL_INBOX_SOURCES = [
	"UNCLASSIFIED_AUDIT_FINDING",
	"IMPORTED_MEETING_NOTE",
	"UNREGISTERED_WORKSPACE_CHANGE",
	"AGENT_UNSTRUCTURED_REPORT",
	"EXTERNAL_NOTE",
	"DISCOVERED_SESSION"
];
/**
* §28 转换动作集（原文: Task / NextAction / Intervention / Claim / Fact /
* ReportingItem / Interaction — 7 类, 逐字映射为 TypedRef.kind 词面）。
*/
const CONVERSION_TARGET_KINDS = [
	"TASK",
	"NEXT_ACTION",
	"INTERVENTION",
	"CLAIM",
	"FACT",
	"REPORTING_ITEM",
	"INTERACTION"
];
/** The default user actor for GUI operations (matrix column U). */
const USER_ACTOR$1 = {
	kind: "USER",
	label: "user"
};
/** 升级理由（机械规则名 — 冻结 3 值; 判定见 escalation.ts）。 */
const ESCALATION_REASONS = [
	"STRICT_TRACKED_CHANGE",
	"DELETION",
	"BATCH_IMPACT"
];
var InboxError = class extends Error {
	code;
	constructor(init) {
		super(init.message, init.cause === void 0 ? void 0 : { cause: init.cause });
		this.name = "InboxError";
		this.code = init.code;
	}
};
function isInboxError(error) {
	return error instanceof InboxError;
}
//#endregion
//#region src/host/service/inbox/state-machine.ts
/**
* WP-6.4 — InboxItem §13 状态机（纯迁移表 + 门; 冻结表单一来源在
* DOMAIN_SCHEMA §13, 本文件是其 service 层门 — 同 WP-5.1
* intervention/state-machine.ts 先例）。
*
* 冻结表（§13 逐字）:
*   InboxItem: `CAPTURED → CONVERTED | DISMISSED`（终态）。
*
* 语义:
*  - 自环非法（状态机无自环 — 同 §13 全部对象口径）;
*  - CONVERTED / DISMISSED 均为终态（无出口; 重开/重转 = 新条目 —
*    §13 同 Intervention「重开 = 新 Intervention」口径: 终态对象不可
*    复活, capture-first 层的再次捕获 = 新 IN id）;
*  - 非法转换在 service 层拒绝（INV-TASK-1 同款纪律 — 存储层 trigger
*    只钉「状态缓存列才可变」, 迁移合法性归本门）。
*/
/** 合法迁移表（§13 逐字; 终态 = 空集）。 */
const INBOX_TRANSITIONS = {
	CAPTURED: ["CONVERTED", "DISMISSED"],
	CONVERTED: [],
	DISMISSED: []
};
/**
* §13 迁移门（纯; 非法对 ⇒ `IN_ILLEGAL_TRANSITION` — 含自环、终态出口、
* 未知状态）。
*/
function assertInboxTransition(inboxItemId, from, to) {
	if (!INBOX_STATES.includes(from)) throw new InboxError({
		code: "IN_ILLEGAL_TRANSITION",
		message: `${inboxItemId}: unknown source state ${JSON.stringify(String(from))} (frozen InboxState = ${INBOX_STATES.join("|")})`
	});
	if (!INBOX_STATES.includes(to)) throw new InboxError({
		code: "IN_ILLEGAL_TRANSITION",
		message: `${inboxItemId}: unknown target state ${JSON.stringify(String(to))} (frozen InboxState = ${INBOX_STATES.join("|")})`
	});
	if (from === to) throw new InboxError({
		code: "IN_ILLEGAL_TRANSITION",
		message: `${inboxItemId}: self-loop ${from} -> ${to} is not a transition (DOMAIN_SCHEMA §13: InboxItem 无自环)`
	});
	if (!INBOX_TRANSITIONS[from].includes(to)) throw new InboxError({
		code: "IN_ILLEGAL_TRANSITION",
		message: `${inboxItemId}: ${from} -> ${to} is not a legal InboxItem transition (DOMAIN_SCHEMA §13: CAPTURED -> CONVERTED | DISMISSED; CONVERTED/DISMISSED 终态)`
	});
}
/**
* 机械高影响判定（纯; 永不抛 — 证据缺省字段 = 该规则不命中）。
*
* 证据字段口径（机械事实面, 见 `EscalationEvidence`）:
*  - `strictTrackedPaths` — 触及的第一层路径（空/缺省 = 无关键路径触及）;
*  - `deletedPaths` — 被删除路径（空/缺省 = 无删除）;
*  - `affectedPathCount` — 受影响路径计数（缺省 = 0 = 不触发批量规则）。
*/
function assessEscalation(evidence, options = {}) {
	const reasons = [];
	for (const reason of ESCALATION_REASONS) if (reason === "STRICT_TRACKED_CHANGE") {
		if ((evidence.strictTrackedPaths?.length ?? 0) > 0) reasons.push(reason);
	} else if (reason === "DELETION") {
		if ((evidence.deletedPaths?.length ?? 0) > 0) reasons.push(reason);
	} else if (reason === "BATCH_IMPACT") {
		const threshold = options.batchThreshold ?? 5;
		if (typeof threshold !== "number" || !Number.isSafeInteger(threshold) || threshold < 1) throw new RangeError(`assessEscalation: batchThreshold must be a safe integer >= 1 (got ${String(threshold)}; frozen policy 口径 = integer minimum 1, default 5)`);
		if ((evidence.affectedPathCount ?? 0) >= threshold) reasons.push(reason);
	}
	return {
		highImpact: reasons.length > 0,
		reasons
	};
}
/**
* 机械证据摘要（确定性格式 — 升级 Intervention 的 `detail` 落点, 同
* WP-3.5 `buildAutoFloodingDetail` 先例: 只陈述计数/路径事实, 不判断
* 科研理由）。
*/
function buildEscalationDetail(evidence, assessment, threshold) {
	const parts = [];
	parts.push(`escalation (plan §22.3): highImpact=${assessment.highImpact}`);
	if (assessment.reasons.length > 0) parts.push(`reasons=[${assessment.reasons.join(", ")}]`);
	const strictCount = evidence.strictTrackedPaths?.length ?? 0;
	if (strictCount > 0) parts.push(`strict_tracked=${strictCount} [${evidence.strictTrackedPaths.join(", ")}]`);
	const deletedCount = evidence.deletedPaths?.length ?? 0;
	if (deletedCount > 0) parts.push(`deleted=${deletedCount} [${evidence.deletedPaths.join(", ")}]`);
	parts.push(`affected_paths=${evidence.affectedPathCount ?? 0}`);
	parts.push(`batch_threshold=${threshold}`);
	if ((evidence.workstreamIds?.length ?? 0) > 0) parts.push(`workstreams=[${evidence.workstreamIds.join(", ")}]`);
	return parts.join("; ");
}
/** 升级 Intervention 的机械标题（§9.2 title 落点 — 非冻结字符串,
*  机械派生: 无 WS 关联 = `High-impact research discrepancy`; 有 =
*  首 WS id 逐字嵌入（同 WP-3.5 flooding 标题的 [WS-<n>] 机械格式））。 */
function escalationInterventionTitle(workstreamIds) {
	const ws = workstreamIds?.[0];
	return ws === void 0 ? "High-impact research discrepancy" : `High-impact research discrepancy [${ws}]`;
}
//#endregion
//#region src/host/service/inbox/service.ts
/** 冻结 IN id 模式（common.schema.json idInboxItem）。 */
const IN_ID_PATTERN = /^IN-[1-9][0-9]*$/;
var InboxService = class {
	#store;
	#allocator;
	#projectId;
	#targets;
	#mechanicalInterventionCreator;
	#managementActionRecorder;
	#batchThreshold;
	#now;
	constructor(options) {
		if (options.store === void 0 || options.store === null || typeof options.store.insertItem !== "function") throw new InboxError({
			code: "IN_INPUT",
			message: "store: an InboxStore is required"
		});
		if (options.allocator === void 0 || options.allocator === null || typeof options.allocator.reserve !== "function") throw new InboxError({
			code: "IN_INPUT",
			message: "allocator: the shared IdAllocator is required"
		});
		if (typeof options.projectId !== "string" || options.projectId.length === 0) throw new InboxError({
			code: "IN_INPUT",
			message: "projectId must be a non-empty string"
		});
		const threshold = options.escalation?.batchThreshold;
		if (threshold !== void 0 && (typeof threshold !== "number" || !Number.isSafeInteger(threshold) || threshold < 1)) throw new InboxError({
			code: "IN_INPUT",
			message: `escalation.batchThreshold must be a safe integer >= 1 (got ${String(threshold)}; default 5)`
		});
		this.#store = options.store;
		this.#allocator = options.allocator;
		this.#projectId = options.projectId;
		this.#targets = options.conversionTargets;
		this.#mechanicalInterventionCreator = options.mechanicalInterventionCreator;
		this.#managementActionRecorder = options.managementActionRecorder;
		this.#batchThreshold = threshold ?? 5;
		this.#now = options.now ?? Date.now;
	}
	/**
	* 用户类捕获（§11 `HUMAN_QUICK_CAPTURE`）: source 常量（构建面不接受
	* source 参数 — 类型即闭集）; actor 必须 USER（运行面断言）。
	*/
	captureHuman(params, actor) {
		assertUserActor$2(actor, "captureHuman");
		return this.#capture(HUMAN_INBOX_SOURCE, params, "captureHuman");
	}
	/**
	* 机械类捕获（§11 其余 6 source — 类型面闭集; 运行面再断言）: audit /
	* discovery / reconcile / flooding / session 机械入口的唯一落库面。
	* actor = AGENT | PLUGIN（非 USER — §11 未冻结 per-source 配对矩阵,
	* 本面只钉「非 USER」, 见 types.ts 头注）。
	*/
	captureMechanical(params, actor) {
		assertMechanicalActor(actor, "captureMechanical");
		if (typeof params.source !== "string" || !MECHANICAL_INBOX_SOURCES.includes(params.source)) throw new InboxError({
			code: "IN_INPUT",
			message: `captureMechanical: source ${JSON.stringify(String(params.source))} is not a member of the mechanical source closed set (${MECHANICAL_INBOX_SOURCES.join("|")} — DOMAIN_SCHEMA §1.4 minus HUMAN_QUICK_CAPTURE)`
		});
		return this.#capture(params.source, params, "captureMechanical");
	}
	/**
	* 共同捕获管线（module header ①–④）。抛出 `InboxError`（预校验 =
	* IN_INPUT; 行落库/形状网 = IN_INPUT/IN_STORE; 号预留失败 = IN_STORE）
	* — 机械入口（WP-6.1/6.2/6.3 缝）的失败必须大声, 不静默丢弃发现。
	*/
	#capture(source, params, operation) {
		const payload = params.payload;
		if (typeof payload !== "string" || payload.length === 0) throw new InboxError({
			code: "IN_INPUT",
			message: `${operation}: payload must be a non-empty string (DOMAIN_SCHEMA §11; frozen schema minLength 1)`
		});
		const contextRefs = (params.contextRefs ?? []).map((ref, i) => assertTypedRef$2(ref, `${operation}.contextRefs[${i}]`));
		const raw = params.raw;
		const createdAt = this.#now();
		let res = null;
		try {
			res = this.#allocator.reserve("INBOX_ITEM", this.#projectId);
			const record = {
				id: res.id,
				source,
				payload,
				context_refs: contextRefs,
				state: "CAPTURED",
				created_at: createdAt,
				...raw !== void 0 ? { raw } : {}
			};
			this.#store.insertItem(record);
			this.#allocator.commit(res);
			return { item: record };
		} catch (cause) {
			if (res !== null) this.#releaseQuietly(res);
			throw this.#wrapCause(cause);
		}
	}
	/**
	* 忽略条目（CAPTURED → DISMISSED 终态; 仅用户显式操作）:
	*   1. actor 运行面断言（类型面 = `UserActorRef` 参数 — 双面）;
	*   2. 条目存在（IN_NOT_FOUND）;
	*   3. §13 合法性门（IN_ILLEGAL_TRANSITION — 含自环/终态出口）;
	*   4. 条件 UPDATE（`AND state = ?`; 0 行 ⇒ IN_CONCURRENT_STATE）。
	*/
	dismiss(inboxItemId, actor) {
		assertUserActor$2(actor, "dismiss");
		const item = this.#requireItem(inboxItemId, "dismiss");
		assertInboxTransition(inboxItemId, item.state, "DISMISSED");
		if (this.#store.updateState(inboxItemId, "DISMISSED", null, item.state) === 0) throw this.#concurrent(inboxItemId, item.state, "dismiss");
		return {
			inboxItemId,
			stateFrom: "CAPTURED",
			stateTo: "DISMISSED"
		};
	}
	/**
	* 条目 → 正式对象（§28 转换动作集: Task/NextAction/Intervention/
	* Claim/Fact/ReportingItem/Interaction）— module header 顺序纪律
	* ①–④。
	*/
	convert(params, actor) {
		assertUserActor$2(actor, "convert");
		const inboxItemId = params.inboxItemId;
		if (typeof inboxItemId !== "string" || !IN_ID_PATTERN.test(inboxItemId)) throw new InboxError({
			code: "IN_INPUT",
			message: `convert: inboxItemId must be a well-formed IN id (got ${JSON.stringify(String(inboxItemId))})`
		});
		const targetKind = params.targetKind;
		if (typeof targetKind !== "string" || !CONVERSION_TARGET_KINDS.includes(targetKind)) throw new InboxError({
			code: "IN_INPUT",
			message: `convert: targetKind ${JSON.stringify(String(targetKind))} is not a member of the §28 conversion action set (${CONVERSION_TARGET_KINDS.join("|")})`
		});
		const fields = params.fields;
		if (fields === null || typeof fields !== "object" || fields.kind !== targetKind) throw new InboxError({
			code: "IN_INPUT",
			message: `convert: fields.kind must pair with targetKind (got fields.kind=${JSON.stringify(fields === null || typeof fields !== "object" ? fields : fields.kind)} for targetKind=${targetKind})`
		});
		if (this.#targets === void 0) throw new InboxError({
			code: "IN_TARGET_NOT_WIRED",
			message: `convert IN -> ${targetKind}: the conversion-target executor is not wired in this composition (IN_TARGET_NOT_WIRED) — the frozen 7-kind action set (§28) has no production executor; production wiring passes the real WP-5.1/5.2/5.3 service closures (WP-6.4 报告「实现要点」§2)`
		});
		const item = this.#requireItem(inboxItemId, "convert");
		assertInboxTransition(inboxItemId, item.state, "CONVERTED");
		const occurredAt = this.#now();
		let ref;
		try {
			ref = this.#targets.execute(targetKind, fields, item, occurredAt);
		} catch (cause) {
			throw new InboxError({
				code: "IN_CONVERT_TARGET",
				message: `convert ${inboxItemId} -> ${targetKind} failed at the target executor: ${cause instanceof Error ? cause.message : String(cause)} — the item stays CAPTURED (fix the target, retry)`,
				cause
			});
		}
		if (ref === null || typeof ref !== "object" || typeof ref.kind !== "string" || typeof ref.id !== "string" || ref.id.length === 0 || ref.kind !== targetKind) throw new InboxError({
			code: "IN_CONVERT_TARGET",
			message: `convert ${inboxItemId} -> ${targetKind}: the executor returned a malformed ref (expected {kind: ${targetKind}, id: <non-empty string>}; got ${JSON.stringify(ref)})`
		});
		if (this.#store.updateState(inboxItemId, "CONVERTED", ref, "CAPTURED") === 0) throw new InboxError({
			code: "IN_CONCURRENT_STATE",
			message: `convert: inbox item ${inboxItemId} moved concurrently (expected CAPTURED) — the formal object ${targetKind} ${ref.id} WAS created; refetch and reconcile (dismiss the duplicate or re-convert a fresh capture)`
		});
		const converted = this.#store.getItem(inboxItemId);
		if (converted === null) throw new InboxError({
			code: "IN_NOT_FOUND",
			message: `convert: item ${inboxItemId} vanished after the state update (store inconsistency — loud, no guess)`
		});
		let managementActionId = null;
		if (this.#managementActionRecorder !== void 0) {
			const maRes = this.#allocator.reserve("MANAGEMENT_ACTION", this.#projectId);
			try {
				const record = {
					id: maRes.id,
					action_kind: "INBOX_CONVERTED",
					actor: toUserActorRef(actor),
					subject_refs: [{
						kind: "INBOX_ITEM",
						id: inboxItemId
					}, {
						kind: targetKind,
						id: ref.id
					}],
					detail: `inbox ${inboxItemId} (source ${item.source}) converted to ${targetKind} ${ref.id} (user-explicit confirmation, plan §28)`,
					occurred_at: occurredAt
				};
				this.#managementActionRecorder(record);
				this.#allocator.commit(maRes);
				managementActionId = maRes.id;
			} catch (cause) {
				this.#releaseQuietly(maRes);
				throw new InboxError({
					code: "IN_LEDGER",
					message: `convert ${inboxItemId} -> ${targetKind}: the INBOX_CONVERTED ledger row failed — the formal object ${targetKind} ${ref.id} exists and the item is marked CONVERTED, but the provenance row is missing (manual reconciliation): ` + (cause instanceof Error ? cause.message : String(cause)),
					cause
				});
			}
		}
		return {
			item: converted,
			convertedTo: ref,
			managementActionId
		};
	}
	/**
	* 机械升级入口（audit/discovery/reconcile 缝 — §22.3「ESCALATE: 高
	* 影响/未知/损失 → Intervention」的落库联动面）:
	*   1. 机械判定（纯 — 三规则; 零语义判断, escalation.ts）;
	*   2. highImpact 且联动端口缺位 ⇒ IN_INPUT（**写前**大声, 零部分状态）;
	*   3. 恒先捕获条目（capture-first — 机械证据 + 升级标记落 raw）;
	*   4. highImpact ⇒ Intervention 创建联动（失败 ⇒ IN_ESCALATION 大声,
	*      条目已捕获保留供人工复核）。
	*/
	escalateMechanical(params, actor) {
		assertMechanicalActor(actor, "escalateMechanical");
		const evidence = params.evidence;
		if (evidence === null || typeof evidence !== "object") throw new InboxError({
			code: "IN_INPUT",
			message: "escalateMechanical: evidence must be an EscalationEvidence object"
		});
		if (typeof evidence.summary !== "string" || evidence.summary.length === 0) throw new InboxError({
			code: "IN_INPUT",
			message: "escalateMechanical: evidence.summary must be a non-empty string (the capture payload)"
		});
		const source = params.source ?? "UNCLASSIFIED_AUDIT_FINDING";
		if (typeof source !== "string" || !MECHANICAL_INBOX_SOURCES.includes(source)) throw new InboxError({
			code: "IN_INPUT",
			message: `escalateMechanical: source ${JSON.stringify(String(source))} is not a member of the mechanical source closed set (${MECHANICAL_INBOX_SOURCES.join("|")})`
		});
		let assessment;
		try {
			assessment = assessEscalation(evidence, { batchThreshold: this.#batchThreshold });
		} catch (cause) {
			throw new InboxError({
				code: "IN_INPUT",
				message: `escalateMechanical: assessment failed: ${cause instanceof Error ? cause.message : String(cause)}`,
				cause
			});
		}
		const creator = this.#mechanicalInterventionCreator;
		if (assessment.highImpact && creator === void 0) throw new InboxError({
			code: "IN_INPUT",
			message: `escalateMechanical: the assessment is HIGH-IMPACT (reasons=[${assessment.reasons.join(", ")}]) but the mechanicalInterventionCreator port is not wired — the ESCALATE ⇒ Intervention linkage (plan §22.3) cannot complete; wire the WP-5.1 createMechanicalIntervention closure (trigger AUDIT_HIGH_IMPACT_DISCREPANCY) and retry`
		});
		const { item } = this.captureMechanical({
			source,
			payload: evidence.summary,
			contextRefs: evidence.contextRefs ?? [],
			raw: {
				...evidence,
				escalation: {
					highImpact: assessment.highImpact,
					reasons: [...assessment.reasons]
				}
			}
		}, actor);
		if (!assessment.highImpact) return {
			item,
			assessment,
			intervention: null
		};
		const workstreamIds = evidence.workstreamIds ?? [];
		if (creator === void 0) throw new InboxError({
			code: "IN_ESCALATION",
			message: "escalateMechanical: highImpact assessment but the mechanicalInterventionCreator port is missing (invariant violation — the pre-write check should have fired)"
		});
		let created;
		try {
			created = creator({
				title: escalationInterventionTitle(workstreamIds),
				detail: buildEscalationDetail(evidence, assessment, this.#batchThreshold),
				workstreamIds: workstreamIds.length > 0 ? workstreamIds : void 0,
				sourceRefs: [{
					kind: "INBOX_ITEM",
					id: item.id
				}, ...evidence.contextRefs ?? []]
			});
		} catch (cause) {
			throw new InboxError({
				code: "IN_ESCALATION",
				message: `escalateMechanical: item ${item.id} captured; the intervention creation failed: ${cause instanceof Error ? cause.message : String(cause)} — the item stays CAPTURED for manual review (create the Intervention through the user face, or dismiss)`,
				cause
			});
		}
		if (created === null || typeof created !== "object" || typeof created.id !== "string" || created.id.length === 0 || typeof created.title !== "string") throw new InboxError({
			code: "IN_ESCALATION",
			message: `escalateMechanical: item ${item.id} captured; the intervention creator returned a malformed ref (expected {id, title}; got ${JSON.stringify(created)}) — reconcile manually`
		});
		return {
			item,
			assessment,
			intervention: {
				id: created.id,
				title: created.title
			}
		};
	}
	/** One record by id（`null` when absent）。 */
	getItem(inboxItemId) {
		return this.#store.getItem(inboxItemId);
	}
	/** List by (state?, source?) — 稳定顺序 created_at ASC, id ASC（全缺省
	*  = 全量）。 */
	listItems(filter) {
		return this.#store.listItems(filter ?? {});
	}
	/** CAPTURED 全量（GUI 待处理组 — 视图的数据面; 终态组经 listItems 指名）。 */
	listCaptured() {
		return this.#store.listItems({ state: "CAPTURED" });
	}
	#requireItem(inboxItemId, operation) {
		if (typeof inboxItemId !== "string" || !IN_ID_PATTERN.test(inboxItemId)) throw new InboxError({
			code: "IN_INPUT",
			message: `${operation}: inboxItemId must be a well-formed IN id (got ${JSON.stringify(String(inboxItemId))})`
		});
		const item = this.#store.getItem(inboxItemId);
		if (item === null) throw new InboxError({
			code: "IN_NOT_FOUND",
			message: `inbox item ${inboxItemId} does not exist`
		});
		return item;
	}
	#concurrent(inboxItemId, expected, operation) {
		return new InboxError({
			code: "IN_CONCURRENT_STATE",
			message: `${operation}: inbox item ${inboxItemId} moved concurrently (expected ${expected}) — refetch and retry`
		});
	}
	#releaseQuietly(res) {
		try {
			this.#allocator.release(res);
		} catch {}
	}
	#wrapCause(cause) {
		if (isInboxError(cause)) return cause;
		return new InboxError({
			code: "IN_STORE",
			message: cause instanceof Error ? cause.message : String(cause),
			cause
		});
	}
};
function assertUserActor$2(actor, operation) {
	if (actor === null || typeof actor !== "object" || actor.kind !== "USER") throw new InboxError({
		code: "IN_ACTOR_FORBIDDEN",
		message: `${operation}: requires a USER actor (plan §28: 转换/忽略需要用户显式确认; §13 迁移仅用户 — ARCHITECTURE §6 矩阵 U 栏) — got ${JSON.stringify(actor)}`
	});
	if (actor.user_id !== void 0 && typeof actor.user_id !== "string") throw new InboxError({
		code: "IN_INPUT",
		message: `${operation}: actor.user_id must be a string (common.schema.json actorRef)`
	});
	if (actor.label !== void 0 && (typeof actor.label !== "string" || actor.label.length > 200)) throw new InboxError({
		code: "IN_INPUT",
		message: `${operation}: actor.label must be a string of ≤200 chars (common.schema.json actorRef)`
	});
}
function assertMechanicalActor(actor, operation) {
	if (actor === null || typeof actor !== "object" || actor.kind !== "AGENT" && actor.kind !== "PLUGIN") throw new InboxError({
		code: "IN_ACTOR_FORBIDDEN",
		message: `${operation}: requires a mechanical actor (kind AGENT | PLUGIN — 非 USER; §11 捕获缝的机械面) — got ${JSON.stringify(actor)}`
	});
}
/** actor 归一（本模块 actor 面 → 冻结 ActorRef 载体 — 账本行用）。 */
function toUserActorRef(actor) {
	return {
		kind: "USER",
		...actor.user_id !== void 0 ? { user_id: actor.user_id } : {},
		...actor.label !== void 0 ? { label: actor.label } : {}
	};
}
/** TypedRef 形状断言（冻结 {kind, id} 廉价边界 — 精确指名失败项;
*  kind 的 objectKind 枚举面与 id 模式面归冻结形状网在 insert 时复验 —
*  与 WP-5.1 source_refs 断言同款分工）。 */
function assertTypedRef$2(value, what) {
	const kind = value === null || typeof value !== "object" ? void 0 : value.kind;
	const id = value === null || typeof value !== "object" ? void 0 : value.id;
	if (typeof kind !== "string" || kind.length === 0 || typeof id !== "string" || id.length === 0) throw new InboxError({
		code: "IN_INPUT",
		message: `${what} must be a {kind, id} typedRef (got ${JSON.stringify(value)})`
	});
	return value;
}
//#endregion
//#region src/host/service/inbox/schema.ts
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
const INBOX_ITEM_TABLE = "inbox_item";
const DDL$1 = `
CREATE TABLE IF NOT EXISTS ${INBOX_ITEM_TABLE} (
  id            TEXT    NOT NULL PRIMARY KEY,
  source        TEXT    NOT NULL CHECK (source IN (${INBOX_SOURCES.map((s) => `'${s}'`).join(", ")})),
  payload       TEXT    NOT NULL,           -- 文本/摘要（§11 必填, minLength 1）
  raw           TEXT,                       -- 原始数据 JSON（§11 可选, any — audit 细节/升级证据）
  context_refs  TEXT    NOT NULL,           -- JSON TypedRef[]（§11 可选, 缺省 []）
  state         TEXT    NOT NULL CHECK (state IN (${INBOX_STATES.map((s) => `'${s}'`).join(", ")})),
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
`;
/** Full DDL (idempotent — re-applied on every store open, 同 WP-3.1 先例). */
function inboxItemDdl() {
	return DDL$1;
}
const SQL_INSERT_INBOX_ITEM = `
INSERT INTO ${INBOX_ITEM_TABLE} (id, source, payload, raw, context_refs, state, converted_to, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;
const SQL_SELECT_INBOX_ITEM_BY_ID = `SELECT * FROM ${INBOX_ITEM_TABLE} WHERE id = ?`;
/** 列表查询（可选 state/source 过滤; 稳定顺序 created_at ASC, id ASC —
*  §15 索引 (state, created_at) + id 兜底全序; 无隐藏过滤器, 调用方
*  指名才过滤 — INV-ATTN-1 同款查询面纪律）。 */
const SQL_LIST_INBOX_ITEMS = `SELECT * FROM ${INBOX_ITEM_TABLE} ORDER BY created_at ASC, id ASC`;
/**
* §13 迁移的行侧写（状态缓存两列; DDL 触发器放行的唯一 UPDATE 面）:
* 条件 `AND state = ?`（乐观并发门）— 返回受影响行数（0 ⇒ 迁移期间
* 状态已变, service 大声失败 IN_CONCURRENT_STATE）。
*/
const SQL_UPDATE_INBOX_ITEM_STATE = `
UPDATE ${INBOX_ITEM_TABLE}
SET state = ?, converted_to = ?
WHERE id = ? AND state = ?
`;
const CORRUPT$1 = (what, detail) => {
	throw new Error(`inbox row corruption at ${what}: ${detail}`);
};
function decodeJson$1(value, what) {
	if (typeof value !== "string") return CORRUPT$1(what, `expected JSON string, got ${typeof value}`);
	try {
		return JSON.parse(value);
	} catch (cause) {
		return CORRUPT$1(what, `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
	}
}
function assertTypedRef$1(value, what) {
	if (value === null || typeof value !== "object" || typeof value.kind !== "string" || typeof value.id !== "string") return CORRUPT$1(what, `element must be a {kind, id} typedRef (got ${JSON.stringify(value)})`);
}
/** Encode `InboxItemRecord` into the INSERT parameter list（列序 = DDL）。 */
function inboxItemToParams(r) {
	return [
		r.id,
		r.source,
		r.payload,
		r.raw === void 0 ? null : JSON.stringify(r.raw),
		JSON.stringify(r.context_refs.map((ref) => ({
			kind: ref.kind,
			id: ref.id
		}))),
		r.state,
		r.converted_to === void 0 ? null : JSON.stringify({
			kind: r.converted_to.kind,
			id: r.converted_to.id
		}),
		r.created_at
	];
}
/** Decode an `inbox_item` row back to the record（throws on corruption）。 */
function rowToInboxItem(row) {
	const source = row.source;
	if (typeof source !== "string" || !INBOX_SOURCES.includes(source)) return CORRUPT$1("inbox_item.source", `unknown source ${JSON.stringify(String(source))}`);
	const state = row.state;
	if (typeof state !== "string" || !INBOX_STATES.includes(state)) return CORRUPT$1("inbox_item.state", `unknown state ${JSON.stringify(String(state))}`);
	if (typeof row.id !== "string") return CORRUPT$1("inbox_item.id", `expected string, got ${typeof row.id}`);
	if (typeof row.payload !== "string") return CORRUPT$1("inbox_item.payload", `expected string, got ${typeof row.payload}`);
	if (typeof row.context_refs !== "string") return CORRUPT$1("inbox_item.context_refs", `expected JSON string, got ${typeof row.context_refs}`);
	if (typeof row.created_at !== "number") return CORRUPT$1("inbox_item.created_at", `expected number, got ${typeof row.created_at}`);
	const contextRefs = decodeJson$1(row.context_refs, "inbox_item.context_refs");
	if (!Array.isArray(contextRefs)) return CORRUPT$1("inbox_item.context_refs", "expected JSON array of typedRef");
	for (const ref of contextRefs) assertTypedRef$1(ref, "inbox_item.context_refs");
	const convertedTo = row.converted_to === null || row.converted_to === void 0 ? void 0 : decodeJson$1(row.converted_to, "inbox_item.converted_to");
	if (convertedTo !== void 0) assertTypedRef$1(convertedTo, "inbox_item.converted_to");
	const raw = row.raw === null || row.raw === void 0 ? void 0 : decodeJson$1(row.raw, "inbox_item.raw");
	return {
		id: row.id,
		source,
		payload: row.payload,
		context_refs: contextRefs,
		state,
		created_at: row.created_at,
		...raw !== void 0 ? { raw } : {},
		...convertedTo !== void 0 ? { converted_to: convertedTo } : {}
	};
}
//#endregion
//#region src/host/service/inbox/store.ts
/**
* WP-6.4 — `InboxStore`: inbox_item 行的存储面（insert + 查询 + 状态
* 缓存 UPDATE; append-only 内容语义）。
*
* 表 / 触发器 / 行形状 = 本 WP schema.ts（`inbox_item` DDL — 第二连接
* 模式: 多连接 WAL 共存, 写经文件锁串行化, 同 WP-3.5/WP-5.3 先例;
* 构造时对注入连接幂等应用 `inboxItemDdl()`）。
*
* 面（API 面即权限面 — 同 WP-3.5 纪律）:
*   - **无 delete 方法**（§15 通则 / INV-HIST-7; 存储层 trigger 兜底任何
*     连接的 raw DELETE）;
*   - **无内容 UPDATE 方法**（capture 后 5 个内容列不可变 — trigger 兜底;
*     唯一的合法行侧写 = `updateState` 的状态缓存两列 state/converted_to,
*     §13 迁移仅用户 — actor 门在 service 层, 本层只执行行侧机械动作,
*     同 WP-5.1 lifecycle store 分工）;
*   - 查询**无隐藏过滤器**: `listItems` 按 (state?, source?) 任一子集
*     过滤, 全部参数缺省 = 全量（稳定顺序 created_at ASC, id ASC —
*     §15 索引 (state, created_at) + id 全序兜底）。
*
* 错误纪律: 边界参数畸形 = IN_INPUT; 形状网不可用/整行违例 = IN_INPUT
* （与冻结网同类的「输入不合法」分类）; 驱动/SQL 失败包 IN_STORE
* （cause 保留）。
*/
var InboxStore = class {
	#db;
	#schemas;
	closed = false;
	constructor(options) {
		if (options.db === void 0 || typeof options.db.exec !== "function" || typeof options.db.run !== "function") throw new InboxError({
			code: "IN_INPUT",
			message: "db: the injected operational-DB face (exec/run/get/all/transaction) is required"
		});
		if (options.schemas === void 0 || typeof options.schemas.checkInboxShape !== "function") throw new InboxError({
			code: "IN_INPUT",
			message: "schemas: the frozen inbox schema face (loadInboxSchemas) is required"
		});
		this.#db = options.db;
		this.#schemas = options.schemas;
		this.#db.exec(inboxItemDdl());
	}
	/**
	* Insert ONE inbox item row（单语句 autocommit）。落库前: 整行过
	* **真实冻结** `$defs/InboxItem`（shape net 不可用 ⇒ IN_STORE 大声
	* 失败, 绝不在无 schema 时放行 — 同 WP-3.5 口径; 整行违例 ⇒ IN_INPUT）。
	* 调用方（service）负责 IN 号 reserve/commit。
	*/
	insertItem(record) {
		this.#assertOpen("insertItem");
		if (record === null || typeof record !== "object") throw new InboxError({
			code: "IN_INPUT",
			message: "insertItem: record must be an InboxItemRecord object"
		});
		if (!this.#schemas.isUsable) throw new InboxError({
			code: "IN_STORE",
			message: "frozen inbox schema set unavailable — no inbox row can be shape-checked (see InboxSchemas.loadErrors)"
		});
		const shape = this.#schemas.checkInboxShape(record);
		if (!shape.ok) throw new InboxError({
			code: "IN_INPUT",
			message: `internal: inbox record failed the frozen inbox schema: ${shape.errors.map((e) => `${e.path || "/"}: ${e.message}`).join(" | ")}`
		});
		try {
			this.#db.run(SQL_INSERT_INBOX_ITEM, ...inboxItemToParams(record));
		} catch (cause) {
			throw this.#wrap("insertItem", cause);
		}
		return record;
	}
	/**
	* §13 迁移的行侧写（状态缓存两列; DDL 触发器放行的唯一 UPDATE 面）:
	* 条件 `AND state = expectedState`（乐观并发门）— 返回受影响行数
	* （0 ⇒ 迁移期间状态已变, service 大声失败 IN_CONCURRENT_STATE）。
	* `convertedTo` 仅 CONVERTED 迁移携带（其余迁移 = null — 唯一写点
	* 语义在 service 层, 本层不重复判定）。
	*/
	updateState(id, state, convertedTo, expectedState) {
		this.#assertOpen("updateState");
		if (typeof id !== "string" || !/^IN-[1-9][0-9]*$/.test(id)) throw new InboxError({
			code: "IN_INPUT",
			message: `updateState: id must be a well-formed IN id (got ${JSON.stringify(String(id))})`
		});
		assertInboxEnum("updateState.state", state, INBOX_STATES);
		assertInboxEnum("updateState.expectedState", expectedState, INBOX_STATES);
		if (convertedTo !== null) {
			if (convertedTo === void 0 || typeof convertedTo !== "object" || typeof convertedTo.kind !== "string" || typeof convertedTo.id !== "string" || convertedTo.id.length === 0) throw new InboxError({
				code: "IN_INPUT",
				message: `updateState: convertedTo must be null or a {kind, id} typedRef (got ${JSON.stringify(convertedTo)})`
			});
		}
		try {
			return this.#db.run(SQL_UPDATE_INBOX_ITEM_STATE, state, convertedTo === null ? null : JSON.stringify({
				kind: convertedTo.kind,
				id: convertedTo.id
			}), id, expectedState);
		} catch (cause) {
			throw this.#wrap("updateState", cause);
		}
	}
	/** One record by id（`null` when absent）。 */
	getItem(id) {
		this.#assertOpen("getItem");
		if (typeof id !== "string" || id.length === 0) throw new InboxError({
			code: "IN_INPUT",
			message: `getItem: id must be a non-empty string (got ${JSON.stringify(String(id))})`
		});
		try {
			const row = this.#db.get(SQL_SELECT_INBOX_ITEM_BY_ID, id);
			return row === void 0 ? null : rowToInboxItem(row);
		} catch (cause) {
			throw this.#wrap("getItem", cause);
		}
	}
	/** List by (state?, source?) — 稳定顺序 created_at ASC, id ASC
	*  （全缺省 = 全量; 过滤参数由调用方显式指名 — 无隐藏过滤器）。 */
	listItems(filter = {}) {
		this.#assertOpen("listItems");
		if (filter.state !== void 0) assertInboxEnum("listItems.filter.state", filter.state, INBOX_STATES);
		if (filter.source !== void 0) assertInboxEnum("listItems.filter.source", filter.source, INBOX_SOURCES);
		try {
			const items = this.#db.all(SQL_LIST_INBOX_ITEMS).map((row) => rowToInboxItem(row));
			if (filter.state !== void 0) return items.filter((item) => item.state === filter.state);
			if (filter.source !== void 0) return items.filter((item) => item.source === filter.source);
			return items;
		} catch (cause) {
			throw this.#wrap("listItems", cause);
		}
	}
	#assertOpen(operation) {
		if (this.closed) throw new InboxError({
			code: "IN_STORE",
			message: `${operation}: store is closed`
		});
	}
	/** Test/inspection seam（no-op 语义: store 无生命周期状态可关 — 连接
	*  归 wiring 的单一 disposer, 同 WP-5.1 lifecycle store 先例）。 */
	close() {
		this.closed = true;
	}
	#wrap(context, cause) {
		if (cause instanceof InboxError) throw cause;
		return new InboxError({
			code: "IN_STORE",
			message: `${context}: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause
		});
	}
};
function assertInboxEnum(what, value, frozen) {
	if (typeof value !== "string" || !frozen.includes(value)) throw new InboxError({
		code: "IN_INPUT",
		message: `${what} must be one of ${frozen.join("|")} (got ${JSON.stringify(String(value))})`
	});
}
//#endregion
//#region src/host/service/inbox/schemas.ts
/**
* WP-6.4 — 冻结 operational inbox schema 装载（loader 模式, 同 WP-3.5
* `loadInterventionSchemas` / WP-3.1 `loadPlanForkSchemas` / WP-5.3
* reporting schemas 先例）。
*
* 通过注入的 `ResearchFileReader` 装载**冻结** `schema/operational/
* inbox.schema.json`（+ 父 `schema/common.schema.json` 的
* idInboxItem/typedRef/epochMs refs）:
*
*   - 校验器直接取自冻结文档（`ajv.getSchema($id + '#/$defs/InboxItem')`）
*     — 零派生 schema, 零 `schema/` 改写（冻结只读）;
*   - 失败聚合（loadErrors; isUsable=false ⇒ `InboxStore` 拒绝写入,
*     fail loud — 绝不在无 schema 时放行, 同 WP-3.5
*     FLOODING_SCHEMA_UNAVAILABLE 口径）;
*   - AJV 2020-12（冻结 `$schema` 方言）, allErrors + verbose
*     （精确定位）, useDefaults off（operational 记录无 schema 默认 —
*     每字段显式）。
*
* 消费: `InboxStore.insertItem`（行落库前的整行冻结形状网 — 类型面
* 同构的运行时保证）+ tests/inbox 的模型往返断言面。
*/
/**
* 装载 + 编译冻结 inbox schema。聚合失败, 永不抛（loader 模式）。
*/
function loadInboxSchemas(reader, schemaDir) {
	const errors = [];
	const ajv = new Ajv2020({
		allErrors: true,
		strict: false,
		verbose: true
	});
	addFormats(ajv);
	const readJson = (path) => {
		let text;
		try {
			text = reader.readFile(path);
		} catch (cause) {
			errors.push({
				path,
				message: `schema file read failed: ${cause instanceof Error ? cause.message : String(cause)}`
			});
			return null;
		}
		if (text === null) {
			errors.push({
				path,
				message: `schema file not found (schemaDir=${schemaDir})`
			});
			return null;
		}
		try {
			return JSON.parse(text);
		} catch (cause) {
			errors.push({
				path,
				message: `schema file is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
			});
			return null;
		}
	};
	const common = readJson(pjoin(schemaDir, "..", "common.schema.json"));
	if (common === null || typeof common.$id !== "string") {
		errors.push({
			path: pjoin(schemaDir, "..", "common.schema.json"),
			message: "common.schema.json is missing or has no $id"
		});
		return unavailable$1(schemaDir, errors);
	}
	try {
		ajv.addSchema(common, common.$id);
	} catch (cause) {
		errors.push({
			path: pjoin(schemaDir, "..", "common.schema.json"),
			message: `common.schema.json rejected: ${cause instanceof Error ? cause.message : String(cause)}`
		});
		return unavailable$1(schemaDir, errors);
	}
	const doc = readJson(pjoin(schemaDir, "inbox.schema.json"));
	if (doc === null || typeof doc.$id !== "string") {
		errors.push({
			path: pjoin(schemaDir, "inbox.schema.json"),
			message: "inbox.schema.json is missing or has no $id"
		});
		return unavailable$1(schemaDir, errors);
	}
	try {
		ajv.addSchema(doc, doc.$id);
	} catch (cause) {
		errors.push({
			path: pjoin(schemaDir, "inbox.schema.json"),
			message: `inbox.schema.json rejected: ${cause instanceof Error ? cause.message : String(cause)}`
		});
		return unavailable$1(schemaDir, errors);
	}
	const recordValidator = ajv.getSchema(`${doc.$id}#/$defs/InboxItem`);
	if (recordValidator === void 0) {
		errors.push({
			path: pjoin(schemaDir, "inbox.schema.json"),
			message: "schema compile failed for $defs/InboxItem"
		});
		return unavailable$1(schemaDir, errors);
	}
	return {
		schemaDir,
		isUsable: true,
		loadErrors: [],
		checkInboxShape: (record) => runCheck$1(recordValidator, record)
	};
}
function mapErrors$1(validator) {
	return (validator.errors ?? []).map((err) => ({
		path: err.instancePath,
		message: schemaErrorSummary(err)
	}));
}
function runCheck$1(validator, value) {
	if (validator(value)) return {
		ok: true,
		errors: []
	};
	return {
		ok: false,
		errors: mapErrors$1(validator)
	};
}
function unavailable$1(schemaDir, errors) {
	const unavailableCheck = {
		ok: false,
		errors: [{
			path: "",
			message: "inbox schema set unavailable — see InboxSchemas.loadErrors"
		}]
	};
	return {
		schemaDir,
		isUsable: false,
		loadErrors: errors,
		checkInboxShape: () => unavailableCheck
	};
}
//#endregion
//#region src/host/audit/discovery/policy.ts
/**
* Thrown for policy misconfiguration (fail loud, 同 loader 口径).
* `code` is stable for machine dispatch; `message` is human-readable.
*/
var DiscoveryPolicyError = class extends Error {
	code;
	constructor(message) {
		super(message);
		this.name = "DiscoveryPolicyError";
		this.code = "DISC_POLICY_INVALID";
	}
};
/**
* Normalize one policy path entry (zone dir / ignored dir / glob).
*
* Rules (mechanical, frozen):
*  - backslashes are treated as separators (user-authored YAML
*    convenience; a literal `\` in a workspace path is out of V1 scope);
*  - leading `./` and leading `/` are stripped;
*  - trailing `/` is stripped (zone `results/` ≡ `results`);
*  - an entry that is empty (or only `.`/`/`) normalizes to `''`
*    (the workspace root) for zones and ignored; for strict globs an
*    empty entry matches NOTHING (see `compileGlob`) — the caller
*    decides;
*  - any `..` segment throws `DiscoveryPolicyError`.
*
* `path` is the raw entry (for error messages).
*/
function normalizePolicyPath(path, label) {
	if (typeof path !== "string") throw new DiscoveryPolicyError(`${label}: not a string (${String(path)})`);
	const segments = path.replace(/\\/g, "/").split("/");
	for (const seg of segments) if (seg === "..") throw new DiscoveryPolicyError(`${label}: "${path}" contains a ".." segment — policy paths must stay inside the workspace root`);
	let out = "";
	if (segments.length > 0) out = segments.filter((s) => s.length > 0 && s !== ".").join("/");
	return out;
}
/**
* Normalize the §14.1 `audit` block into a {@link DiscoveryPolicy}
* (schema defaults materialized; zones de-duplicated by normalized dir —
* duplicate dirs merge their `artifact_types` hints in first-seen order,
* preserving the frozen ArtifactType vocabulary order).
*
* @throws DiscoveryPolicyError on `..` segments or non-array blocks.
*/
function normalizePolicy(audit) {
	const rawZones = audit?.discovery_zones;
	const rawIgnored = audit?.ignored;
	const rawStrict = audit?.strict_tracked?.paths;
	if (rawZones !== void 0 && !Array.isArray(rawZones)) throw new DiscoveryPolicyError("audit.discovery_zones: not an array");
	if (rawIgnored !== void 0 && !Array.isArray(rawIgnored)) throw new DiscoveryPolicyError("audit.ignored: not an array");
	if (rawStrict !== void 0 && !Array.isArray(rawStrict)) throw new DiscoveryPolicyError("audit.strict_tracked.paths: not an array");
	const byDir = /* @__PURE__ */ new Map();
	for (const zone of rawZones ?? []) {
		const rawPath = zone?.path;
		if (typeof rawPath !== "string" || rawPath.length === 0) throw new DiscoveryPolicyError(`audit.discovery_zones: entry without a non-empty "path" (${JSON.stringify(zone)})`);
		const dir = normalizePolicyPath(rawPath, "audit.discovery_zones");
		const hint = Array.isArray(zone?.artifact_types) ? zone?.artifact_types : [];
		const existing = byDir.get(dir);
		if (existing === void 0) byDir.set(dir, {
			rawPath,
			dir,
			artifactTypes: [...hint]
		});
		else if (existing.artifactTypes.length === 0 && hint.length > 0) byDir.set(dir, {
			...existing,
			artifactTypes: [...hint]
		});
	}
	const ignored = (rawIgnored ?? []).map((entry, i) => normalizePolicyPath(String(entry), `audit.ignored[${i}]`));
	const strictTrackedGlobs = (rawStrict ?? []).map((entry, i) => normalizePolicyPath(String(entry), `audit.strict_tracked.paths[${i}]`));
	return {
		zones: [...byDir.values()],
		ignored: [...new Set(ignored)],
		strictTrackedGlobs: [...new Set(strictTrackedGlobs)]
	};
}
/**
* Compile one strict-tracked glob (计划书 §14.1「glob」) to an anchored
* RegExp over workspace-root-relative POSIX paths. Mechanical V1 subset:
*  - `**`  — any number (≥ 0) of whole path segments; a trailing
*    `src/**` (or trailing `/` form `src/`) matches every file UNDER
*    `src` at any depth;
*  - `*`   — any run of characters except `/` (within one segment);
*  - `?`   — exactly one character except `/`;
*  - every other character is matched literally (escaped);
*  - a trailing `/` marks a DIRECTORY glob (matches all files under it,
*    any depth) — `src/` ≡ `src/**`;
*  - a glob with no `/` (after normalization) matches exactly one file
*    with that name at the root (standard glob semantics — NOT a
*    directory prefix; zones are where directory-whitelist semantics
*    live);
*  - the empty glob matches nothing (a no-op entry).
*
* @returns the anchored RegExp, or `null` for the empty (no-op) glob.
*/
function compileGlob(glob) {
	if (glob.length === 0) return null;
	let body = glob;
	let dirGlob = false;
	if (body.endsWith("/")) {
		dirGlob = true;
		body = body.slice(0, -1);
	}
	if (body.length === 0) return /* @__PURE__ */ new RegExp("^[^/]+(?:/[^/]+)*$");
	const segments = body.split("/");
	let re = "";
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		if (seg === "**") {
			re += "(?:[^/]+/)*";
			continue;
		}
		for (const ch of seg) if (ch === "*") re += "[^/]*";
		else if (ch === "?") re += "[^/]";
		else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
		if (i < segments.length - 1) re += "/";
	}
	if (segments[segments.length - 1] === "**") re += "[^/]+(?:/[^/]+)*";
	else if (dirGlob) re += "/[^/]+(?:/[^/]+)*";
	return new RegExp(`^${re}$`);
}
/** Directory-prefix match: `rel` is strictly UNDER `dir` (or `dir` is the root). */
function underDir(rel, dir) {
	if (dir.length === 0) return true;
	if (rel === dir) return false;
	return rel.startsWith(dir + "/");
}
/** The zone whose normalized dir contains `rel` (first zone wins; `null` = none). */
function matchZone(policy, rel) {
	for (const zone of policy.zones) if (underDir(rel, zone.dir)) return zone;
	return null;
}
/** Third layer (不扫描): `rel` is under an ignored dir, or IS one. */
function isIgnored(policy, rel) {
	return policy.ignored.some((dir) => rel === dir || underDir(rel, dir));
}
/** First layer (WP-6.1 jurisdiction): `rel` matches any strict-tracked glob. */
function isStrictTracked(policy, rel) {
	for (const glob of policy.strictTrackedGlobs) {
		const re = compileGlob(glob);
		if (re !== null && re.test(rel)) return true;
	}
	return false;
}
/**
* The three-layer partition for one relative path (precedence frozen):
* `.git/` and top-level `.research/` are OUT_OF_SCOPE by construction at
* the walk/feed boundary (they never reach here as candidates);
* otherwise IGNORED (第三层) > STRICT_TRACKED (第一层) > ZONE (第二层)
* > OUT_OF_SCOPE.
*/
function classifyPath(policy, rel) {
	if (isIgnored(policy, rel)) return "IGNORED";
	if (isStrictTracked(policy, rel)) return "STRICT_TRACKED";
	if (matchZone(policy, rel) !== null) return "ZONE";
	return "OUT_OF_SCOPE";
}
/**
* Validate + normalize one FEED path (git-reported, so NO backslash
* rewriting — git porcelain on POSIX emits real names). Rules:
* non-empty; strip a single leading `./`; reject absolute paths, `..`
* segments, and empty-after-strip.
*
* @returns the normalized relative path, or `null` when the entry is a
*   `BAD_PATH` skip.
*/
function normalizeFeedPath(path) {
	if (typeof path !== "string" || path.length === 0) return null;
	let out = path;
	if (out.startsWith("./")) out = out.slice(2);
	if (out.length === 0) return null;
	if (out.startsWith("/")) return null;
	for (const seg of out.split("/")) if (seg === "..") return null;
	return out;
}
//#endregion
//#region src/host/audit/discovery/classify.ts
/**
* Frozen extension table (V1 conventions). Key = extension WITHOUT the
* leading dot, lowercased; double extensions included as full tails.
* Anything absent → `guessFromExtension` returns `null` (→ naming
* pattern, else `OTHER`).
*/
const EXTENSION_TYPE_TABLE = {
	csv: "DATASET",
	tsv: "DATASET",
	json: "DATASET",
	jsonl: "DATASET",
	ndjson: "DATASET",
	parquet: "DATASET",
	feather: "DATASET",
	arrow: "DATASET",
	h5: "DATASET",
	hdf5: "DATASET",
	npy: "DATASET",
	pkl: "DATASET",
	pickle: "DATASET",
	xlsx: "DATASET",
	xls: "DATASET",
	mat: "DATASET",
	rdata: "DATASET",
	rds: "DATASET",
	db: "DATASET",
	sqlite: "DATASET",
	sqlite3: "DATASET",
	dat: "DATASET",
	avro: "DATASET",
	"csv.gz": "DATASET",
	"tsv.gz": "DATASET",
	"json.gz": "DATASET",
	"jsonl.gz": "DATASET",
	"parquet.gz": "DATASET",
	"npy.gz": "DATASET",
	png: "FIGURE",
	jpg: "FIGURE",
	jpeg: "FIGURE",
	gif: "FIGURE",
	bmp: "FIGURE",
	tiff: "FIGURE",
	tif: "FIGURE",
	svg: "FIGURE",
	webp: "FIGURE",
	ico: "FIGURE",
	eps: "FIGURE",
	ps: "FIGURE",
	fig: "FIGURE",
	heic: "FIGURE",
	avif: "FIGURE",
	onnx: "MODEL",
	tflite: "MODEL",
	pb: "MODEL",
	pt: "MODEL",
	pth: "MODEL",
	safetensors: "MODEL",
	gguf: "MODEL",
	mnn: "MODEL",
	py: "CODE",
	pyi: "CODE",
	ipynb: "CODE",
	js: "CODE",
	mjs: "CODE",
	cjs: "CODE",
	jsx: "CODE",
	ts: "CODE",
	tsx: "CODE",
	r: "CODE",
	sh: "CODE",
	bash: "CODE",
	zsh: "CODE",
	jl: "CODE",
	scala: "CODE",
	java: "CODE",
	c: "CODE",
	h: "CODE",
	cpp: "CODE",
	cc: "CODE",
	cxx: "CODE",
	hpp: "CODE",
	cs: "CODE",
	go: "CODE",
	rs: "CODE",
	rb: "CODE",
	pl: "CODE",
	pm: "CODE",
	lua: "CODE",
	m: "CODE",
	f: "CODE",
	f90: "CODE",
	f95: "CODE",
	sql: "CODE",
	proto: "CODE",
	graphql: "CODE",
	pdf: "REPORT",
	tex: "REPORT",
	rmd: "REPORT",
	html: "REPORT",
	htm: "REPORT",
	doc: "REPORT",
	docx: "REPORT",
	odt: "REPORT",
	ppt: "REPORT",
	pptx: "REPORT",
	epub: "REPORT",
	md: "NOTE",
	markdown: "NOTE",
	rst: "NOTE",
	txt: "NOTE",
	text: "NOTE",
	org: "NOTE"
};
/**
* Frozen naming-pattern signals (substring over the lowercased stem),
* in PRIORITY order — the first pattern that occurs anywhere in the
* stem wins (so `model_data` → MODEL, not DATASET). Coarse by design:
* these are mechanical string conventions (`readme`, `ckpt`, `plot`),
* not interpretations.
*/
const NAMING_PATTERN_SIGNALS = [
	["model", "MODEL"],
	["weights", "MODEL"],
	["checkpoint", "MODEL"],
	["ckpt", "MODEL"],
	["corpus", "DATASET"],
	["sample", "DATASET"],
	["data", "DATASET"],
	["figure", "FIGURE"],
	["fig", "FIGURE"],
	["plot", "FIGURE"],
	["chart", "FIGURE"],
	["heatmap", "FIGURE"],
	["manuscript", "REPORT"],
	["report", "REPORT"],
	["draft", "REPORT"],
	["summary", "REPORT"],
	["review", "REPORT"],
	["readme", "NOTE"],
	["note", "NOTE"],
	["memo", "NOTE"],
	["todo", "NOTE"],
	["script", "CODE"],
	["train", "CODE"],
	["eval", "CODE"],
	["pipeline", "CODE"],
	["experiment", "CODE"]
];
/**
* Extract the (lowercased) extension tail of a basename: the last
* `.`-suffix, or the last TWO suffixes when the two-suffix tail is a
* known double extension (`archive.csv.gz` → `csv.gz`). Dotfiles
* (`.env`) and extension-less names have no extension → `null`.
*/
function extractExtension(basename) {
	const name = basename.toLowerCase();
	if (name.length === 0 || name.startsWith(".")) {
		const rest = name.slice(1);
		if (rest.length === 0 || !rest.includes(".")) return null;
		return extensionOf(rest);
	}
	return extensionOf(name);
}
function extensionOf(name) {
	const dot = name.lastIndexOf(".");
	if (dot <= 0 || dot === name.length - 1) return null;
	const ext = name.slice(dot + 1);
	const prevDot = name.lastIndexOf(".", dot - 1);
	if (prevDot > 0) {
		const double = name.slice(prevDot + 1);
		if (double.length > 0 && EXTENSION_TYPE_TABLE[double] !== void 0) return double;
	}
	return ext;
}
/** Extension-table guess for a basename (`null` = no table entry). */
function guessFromExtension(basename) {
	const ext = extractExtension(basename);
	if (ext === null) return null;
	return EXTENSION_TYPE_TABLE[ext] ?? null;
}
/** Lowercased stem (basename minus its extension tail). */
function stemOf(basename) {
	const name = basename.toLowerCase();
	const eff = name.startsWith(".") ? name.slice(1) : name;
	const dot = eff.lastIndexOf(".");
	if (dot <= 0) return eff;
	const prevDot = eff.lastIndexOf(".", dot - 1);
	if (prevDot > 0 && EXTENSION_TYPE_TABLE[eff.slice(prevDot + 1)] !== void 0) return eff.slice(0, prevDot);
	return eff.slice(0, dot);
}
/** Naming-pattern guess for a basename (`null` = no pattern hit). */
function guessFromNamingPattern(basename) {
	const stem = stemOf(basename);
	if (stem.length === 0) return null;
	for (const [pattern, type] of NAMING_PATTERN_SIGNALS) if (stem.includes(pattern)) return type;
	return null;
}
/**
* The frozen combination rule: extension table first, then naming
* pattern, else `OTHER`. Pure and total — never throws, never nulls
* the suggestion.
*/
function combineTypeSignal(basename) {
	const guessedType = guessFromExtension(basename);
	if (guessedType !== null) return {
		guessedType,
		suggestedType: guessedType
	};
	return {
		guessedType: null,
		suggestedType: guessFromNamingPattern(basename) ?? "OTHER"
	};
}
//#endregion
//#region src/host/audit/discovery/snapshot.ts
/** The single operational-KV key holding the latest scan snapshot. */
const SNAPSHOT_KEY = "discovery.scan-snapshot.v1";
/**
* Thrown when a stored snapshot cannot be decoded / is structurally
* invalid (fail loud, 同 MetaStore 计数器损坏 guard 口径 — a corrupted
* audit baseline is reported, never silently reset).
*/
var DiscoverySnapshotError = class extends Error {
	code;
	constructor(message) {
		super(message);
		this.name = "DiscoverySnapshotError";
		this.code = "DISC_SNAPSHOT_CORRUPT";
	}
};
/** Validate one stored path entry (relative POSIX, no escape, no dot). */
function assertPathEntry(value, index) {
	if (typeof value !== "string" || value.length === 0) throw new DiscoverySnapshotError(`snapshot.paths[${index}]: not a non-empty string`);
	if (value.startsWith("/")) throw new DiscoverySnapshotError(`snapshot.paths[${index}]: absolute path ${JSON.stringify(value)}`);
	if (value.split("/").includes("..")) throw new DiscoverySnapshotError(`snapshot.paths[${index}]: ".." segment in ${JSON.stringify(value)}`);
	return value;
}
/**
* Decode + validate one stored snapshot document.
*
* Structural rules (all fail loud with `DISC_SNAPSHOT_CORRUPT`):
*  - JSON object; `v` === 1; `capturedAt` a non-negative safe integer
*    (epoch ms); `paths` an array of valid relative POSIX paths with
*    NO duplicates (a duplicate row is corruption, not a benign
*    no-op — the encoder cannot produce one).
*
* @returns a fresh immutable snapshot (paths re-sorted — the stored
*   order is normalized away, so a hand-edited order never leaks into
*   diff output).
*/
function decodeSnapshot(raw) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new DiscoverySnapshotError(`snapshot is not valid JSON: ${String(cause)}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new DiscoverySnapshotError("snapshot root must be a JSON object");
	const obj = parsed;
	if (obj["v"] !== 1) throw new DiscoverySnapshotError(`snapshot.v must be 1 (got ${JSON.stringify(obj["v"])})`);
	const capturedAt = obj["capturedAt"];
	if (typeof capturedAt !== "number" || !Number.isSafeInteger(capturedAt) || capturedAt < 0) throw new DiscoverySnapshotError(`snapshot.capturedAt must be a non-negative safe integer (got ${JSON.stringify(capturedAt)})`);
	if (!Array.isArray(obj["paths"])) throw new DiscoverySnapshotError("snapshot.paths must be an array");
	const paths = obj["paths"].map((p, i) => assertPathEntry(p, i));
	const seen = /* @__PURE__ */ new Set();
	for (const p of paths) {
		if (seen.has(p)) throw new DiscoverySnapshotError(`snapshot.paths: duplicate ${JSON.stringify(p)}`);
		seen.add(p);
	}
	return {
		v: 1,
		capturedAt,
		paths: [...paths].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
	};
}
/** Encode a snapshot to its canonical JSON form (stable key order). */
function encodeSnapshot(snapshot) {
	return JSON.stringify({
		v: snapshot.v,
		capturedAt: snapshot.capturedAt,
		paths: [...snapshot.paths]
	});
}
/** Build a snapshot from a current candidate path set (sorted, de-duped). */
function buildSnapshot(paths, capturedAt) {
	return {
		v: 1,
		capturedAt,
		paths: [...new Set(paths)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
	};
}
/**
* The incremental diff (任务书「新增/消失」) between the previous
* snapshot and the current candidate path set. Total: any `prev`
* (including `null`) and any (even unsorted/duplicated) current list.
*/
function diffSnapshots(prev, currentPaths) {
	const current = [...new Set(currentPaths)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
	if (prev === null) return {
		firstScan: true,
		added: current,
		removed: [],
		unchanged: []
	};
	const prevSet = new Set(prev.paths);
	const curSet = new Set(current);
	const added = [];
	const unchanged = [];
	for (const p of current) if (prevSet.has(p)) unchanged.push(p);
	else added.push(p);
	const removed = [];
	for (const p of prev.paths) if (!curSet.has(p)) removed.push(p);
	return {
		firstScan: false,
		added,
		removed,
		unchanged
	};
}
//#endregion
//#region src/host/audit/discovery/scan.ts
/**
* WP-6.2 — discovery zone scanner: read-only filesystem walk + scan
* composition + the WP-6.1 AuditReport untracked feed (mechanical).
*
* 只读契约 (任务书目标 4「只读扫描」): this module ONLY reads the
* workspace (`readdir`/`lstat` — no `stat` following symlinks, no
* writes, no renames, no tmp files, no deletion, no git). The only
* write the whole scanner performs is the service's snapshot persist
* into the operational KV (service.ts) — never into the workspace.
*
* Walk rules (mechanical, frozen):
*  - scope = the workspace root (`workspace.root` resolved to an
*    absolute path by the CALLER — 相对 Git repo root, §14.1; the
*    resolver lives in the wiring/WP-6.1, this layer is git-free);
*  - the top-level `.research/` directory is never entered (声明式真源,
*    §14 布局 — out of discovery scope by definition);
*  - `.git/` directories at any depth are never entered (VCS metadata —
*    Git owns it, §22.3);
*  - symlinked DIRECTORIES are never followed (loop/escape protection);
*    a symlink to a file (or a broken symlink) IS a candidate entry
*    (`sizeBytes` from `lstat`, the link itself);
*  - directory pruning: a subtree is entered only when it is (or may
*    contain) a zone and is not ignored — so `cache/` under a zone is
*    pruned at the directory level (第三层「不扫描」, GIT_INTEGRATION
*    §8);
*  - every surviving file is passed through `classifyPath` (precedence
*    IGNORED > STRICT_TRACKED > ZONE) — only ZONE paths become
*    candidates;
*  - output is sorted by path (byte-wise) — deterministic.
*
* Feed (任务书目标 3 接缝, 接口对齐): `feedUntracked` turns a
* normalized WP-6.1 `AuditReport.untracked` list into candidates —
* PURE (no fs, no KV): it never stats (a fed path that no longer exists
* still classifies — the feed's job is classification, existence is
* the strict layer's W4 fact) and never writes. Every input entry
* lands in exactly one of `candidates` / `skipped(reason)`.
*/
/** The declarative source tree — never discovery material (§14). */
const RESEARCH_DIR = ".research";
/** VCS metadata — Git's, not the scanner's (§22.3). */
const GIT_DIR = ".git";
/**
* Read-only walk of `root` under `policy`.
*
* CONTRACT: `files` contains EXACTLY the files that are
* (a) under a discovery zone, and (b) not ignored / not strict-tracked
* (i.e. `classifyPath === 'ZONE'`) — the candidate SCOPE. Classification
* (type guess / zone hint) is the separate concern of `scanWorkspace`.
*
* @throws (raw Error, service maps to `DISC_ROOT_MISSING`) when `root`
*   is missing or not a directory.
*/
function walkWorkspaceFiles(root, policy) {
	if (typeof root !== "string" || root.length === 0) throw new Error("walkWorkspaceFiles: workspace root must be a non-empty absolute path");
	if (!isAbsolute(root)) throw new Error(`walkWorkspaceFiles: workspace root must be absolute (got "${root}")`);
	let rootStat;
	try {
		rootStat = statSync(root);
	} catch {
		throw new Error(`walkWorkspaceFiles: workspace root does not exist: ${root}`);
	}
	if (!rootStat.isDirectory()) throw new Error(`walkWorkspaceFiles: workspace root is not a directory: ${root}`);
	const zoneDirs = policy.zones.map((z) => z.dir);
	const mayContainZone = (relDir) => zoneDirs.some((d) => d.length === 0 || d === relDir || relDir.startsWith(d + "/"));
	const files = [];
	const stack = [""];
	while (stack.length > 0) {
		const relDir = stack.pop();
		if (relDir.length > 0) {
			if (!mayContainZone(relDir)) continue;
			if (isIgnored(policy, relDir)) continue;
		}
		const absDir = relDir.length === 0 ? root : join(root, relDir);
		let entries;
		try {
			entries = readdirSync(absDir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const name = entry.name;
			const rel = relDir.length === 0 ? name : `${relDir}/${name}`;
			if (entry.isDirectory()) {
				if (relDir.length === 0 && name === RESEARCH_DIR) continue;
				if (name === GIT_DIR) continue;
				stack.push(rel);
			} else if (entry.isFile()) {
				if (classifyPath(policy, rel) === "ZONE") pushFile(files, rel, absDir, name, false);
			} else if (entry.isSymbolicLink()) {
				let targetIsDir = false;
				try {
					targetIsDir = statSync(join(absDir, name)).isDirectory();
				} catch {
					targetIsDir = false;
				}
				if (!targetIsDir && classifyPath(policy, rel) === "ZONE") pushFile(files, rel, absDir, name, true);
			}
		}
	}
	files.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
	const zoneDirMissing = [];
	for (const zone of policy.zones) {
		if (zone.dir.length === 0) continue;
		const absZone = join(root, zone.dir);
		let isDir = false;
		try {
			isDir = statSync(absZone).isDirectory();
		} catch {
			isDir = false;
		}
		if (!isDir) zoneDirMissing.push(zone.dir);
	}
	zoneDirMissing.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
	return {
		files,
		zoneDirMissing
	};
}
function pushFile(files, rel, absDir, name, isSymlink) {
	let sizeBytes = 0;
	try {
		sizeBytes = lstatSync(join(absDir, name)).size;
	} catch {
		sizeBytes = 0;
	}
	files.push({
		rel,
		sizeBytes,
		isSymlink
	});
}
/**
* One filesystem scan (composition only — NO KV access; the service
* owns snapshot read/persist). `prevSnapshot = null` → first scan.
*/
function scanWorkspace(args) {
	const { root, policy, now } = args;
	const { files, zoneDirMissing } = walkWorkspaceFiles(root, policy);
	const candidates = [];
	for (const file of files) {
		const zone = matchZone(policy, file.rel);
		const signal = combineTypeSignal(file.rel.slice(file.rel.lastIndexOf("/") + 1));
		candidates.push({
			path: file.rel,
			sizeBytes: file.sizeBytes,
			zone: zone?.dir ?? null,
			zoneArtifactTypes: zone?.artifactTypes ?? [],
			guessedType: signal.guessedType,
			suggestedType: signal.suggestedType
		});
	}
	const capturedAt = now();
	return {
		workspaceRoot: root,
		scannedAt: capturedAt,
		policy,
		candidates,
		diff: diffSnapshots(args.prevSnapshot, candidates.map((c) => c.path)),
		zoneDirMissing,
		snapshot: buildSnapshot(candidates.map((c) => c.path), capturedAt)
	};
}
/**
* The WP-6.1 seam (pure): feed a normalized AuditReport untracked list
* (types.ts `UntrackedFileRef`) → candidates + reasoned skips.
*
* Rules per entry (deterministic; output sorted by path):
*  - `BAD_PATH`         — fails `normalizeFeedPath` (empty/absolute/
*    `..`);
*  - `RESEARCH_TREE`    — `.research` or under it (声明式真源, never
*    discovery material — even when untracked);
*  - `VCS_METADATA`     — `.git` or under it;
*  - `DIRECTORY_MARKER` — git untracked `dir/` notation (unexpanded —
*    「展开归 WP-6.2 fs 扫描」; the feed stays fs-free, the walk
*    covers the contents when they are on disk);
*  - `IGNORED`          — 第三层 (不扫描 — even if a zone also claims
*    it);
*  - `STRICT_TRACKED`   — 第一层 (WP-6.1 already reports it; no
*    double-report to 6.3);
*  - otherwise          → candidate: classified mechanically, `zone` =
*    matching zone dir or `null` (OUT_OF_SCOPE untracked paths ARE
*    classified — the strict layer found the change; 6.3 partitions on
*    the `zone` field), `sizeBytes: null` (never stat'd).
*/
function feedUntracked(policy, untracked) {
	const candidates = [];
	const skipped = [];
	for (const entry of untracked) {
		const raw = entry?.path ?? "";
		if (typeof raw !== "string" || raw.length === 0) {
			skipped.push({
				path: String(entry?.path),
				reason: "BAD_PATH"
			});
			continue;
		}
		if ((raw.startsWith("./") ? raw.slice(2) : raw).endsWith("/")) {
			const norm = normalizeFeedPath(raw);
			skipped.push({
				path: norm ?? raw,
				reason: "DIRECTORY_MARKER"
			});
			continue;
		}
		const rel = normalizeFeedPath(raw);
		if (rel === null) {
			skipped.push({
				path: raw,
				reason: "BAD_PATH"
			});
			continue;
		}
		if (rel === RESEARCH_DIR || rel.startsWith(`${RESEARCH_DIR}/`)) {
			skipped.push({
				path: rel,
				reason: "RESEARCH_TREE"
			});
			continue;
		}
		if (rel === GIT_DIR || rel.startsWith(`${GIT_DIR}/`)) {
			skipped.push({
				path: rel,
				reason: "VCS_METADATA"
			});
			continue;
		}
		const layer = classifyPath(policy, rel);
		if (layer === "IGNORED") {
			skipped.push({
				path: rel,
				reason: "IGNORED"
			});
			continue;
		}
		if (layer === "STRICT_TRACKED") {
			skipped.push({
				path: rel,
				reason: "STRICT_TRACKED"
			});
			continue;
		}
		const zone = matchZone(policy, rel);
		const signal = combineTypeSignal(rel.slice(rel.lastIndexOf("/") + 1));
		candidates.push({
			path: rel,
			sizeBytes: null,
			zone: zone?.dir ?? null,
			zoneArtifactTypes: zone?.artifactTypes ?? [],
			guessedType: signal.guessedType,
			suggestedType: signal.suggestedType
		});
	}
	const byPath = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
	candidates.sort(byPath);
	skipped.sort(byPath);
	return {
		candidates,
		skipped
	};
}
/**
* Adapter for path-only producers (WP-6.1's `AuditReport.newFiles
* .outsideResearch: string[]` — no status column): lift raw paths to
* {@link UntrackedFileRef} entries (status stays undefined — the feed
* never branches on it anyway).
*/
function untrackedRefsFromPaths(paths) {
	return paths.map((path) => ({ path }));
}
//#endregion
//#region src/host/audit/discovery/service.ts
/** Service-layer error with a stable machine code. */
var DiscoveryScannerError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.name = "DiscoveryScannerError";
		this.code = code;
	}
};
/** The scanner service (stateless — all state lives in the KV store). */
var DiscoveryScanner = class {
	meta;
	now;
	constructor(meta, now = () => Date.now()) {
		this.meta = meta;
		this.now = now;
	}
	/**
	* The operational-KV key of the latest scan snapshot (exposed for
	* diagnostics; `meta` is per-project — §15 — so no project prefix).
	*/
	static snapshotKey = SNAPSHOT_KEY;
	/**
	* Read the previous snapshot from the operational KV.
	* @returns `null` when none stored yet (first scan).
	* @throws DiscoveryScannerError(`DISC_SNAPSHOT_CORRUPT`) on a stored
	*   value that fails structural decode (fail loud).
	*/
	readSnapshot() {
		const raw = this.meta.get(SNAPSHOT_KEY);
		if (raw === null) return null;
		try {
			return decodeSnapshot(raw);
		} catch (cause) {
			if (cause instanceof DiscoverySnapshotError) throw new DiscoveryScannerError("DISC_SNAPSHOT_CORRUPT", cause.message, { cause });
			throw cause;
		}
	}
	/**
	* One discovery scan of the workspace (read-only) + incremental diff
	* vs the previous snapshot + snapshot persistence (on success only).
	*
	* @param args.workspaceRoot absolute path (the caller resolves
	*   `workspace.root` against the Git repo root — §14.1; git-free here)
	* @param args.policy normalized policy (`normalizePolicy` output)
	*/
	scan(args) {
		const prev = this.readSnapshot();
		let report;
		try {
			report = scanWorkspace({
				root: args.workspaceRoot,
				policy: args.policy,
				now: this.now,
				prevSnapshot: prev
			});
		} catch (cause) {
			if (cause instanceof Error && cause.message.startsWith("walkWorkspaceFiles:")) throw new DiscoveryScannerError("DISC_ROOT_MISSING", cause.message, { cause });
			throw cause;
		}
		this.meta.set(SNAPSHOT_KEY, encodeSnapshot(report.snapshot));
		return report;
	}
	/**
	* The WP-6.1 seam: feed a normalized `AuditReport.untracked` list
	* (types.ts `UntrackedFileRef` contract) → classified candidates +
	* reasoned skips. Pure (no fs, no KV) — see `feedUntracked`.
	*/
	scanFromUntracked(args) {
		return feedUntracked(args.policy, args.untracked);
	}
	/** Delete the stored snapshot (reset the incremental baseline). */
	clearSnapshot() {
		this.meta.delete(SNAPSHOT_KEY);
	}
};
/**
* Convenience: normalize a raw §14.1 `audit` block (wiring boundary).
* Accepts the full loader `WorkspaceDoc` or just its `audit` face
* (`null` = no workspace.yaml → all engineering defaults).
*/
function policyFromWorkspaceDoc(doc) {
	return normalizePolicy(doc?.audit ?? null);
}
//#endregion
//#region src/host/audit/reconcile/types.ts
/** 冻结类别集（排序/计数/映射用; 与上类型逐字一致 — tests 漂移 guard）。 */
const DISCREPANCY_CATEGORIES = [
	"ARTIFACT_RECOVERABLE",
	"DECLARED_MISSING",
	"RESEARCH_UNCHECKPOINTED",
	"TRACKED_UNDECLARED",
	"UNREGISTERED_WORKSPACE_CHANGE"
];
/** 冻结来源映射（机械; tests 钉）: 类别 → Inbox source。 */
const CATEGORY_INBOX_SOURCE = {
	UNREGISTERED_WORKSPACE_CHANGE: "UNREGISTERED_WORKSPACE_CHANGE",
	TRACKED_UNDECLARED: "UNCLASSIFIED_AUDIT_FINDING",
	DECLARED_MISSING: "UNCLASSIFIED_AUDIT_FINDING",
	RESEARCH_UNCHECKPOINTED: "UNCLASSIFIED_AUDIT_FINDING",
	ARTIFACT_RECOVERABLE: "UNCLASSIFIED_AUDIT_FINDING"
};
/** 路径 ∈ `.research/` 域（恰为目录记法或其内 — WP-6.1 `inResearch` 同语义）。 */
function isResearchTreePath(p) {
	return p === ".research/" || p.startsWith(".research/");
}
//#endregion
//#region src/host/audit/reconcile/inbox.ts
/** `key=value` 对拼装（值原样; 空值对省略; 布尔小写）。 */
function kv(pairs) {
	return pairs.filter((pair) => pair[1] !== null && pair[1] !== void 0).map(([k, v]) => `${k}=${v === true ? "true" : v === false ? "false" : v}`).join(" ");
}
/** 各变体的 artifact 关联字段（机械提取 — 无 = undefined）。 */
function artifactIdOf(d) {
	if (d.category === "ARTIFACT_RECOVERABLE") return d.artifactId;
	if (d.category === "DECLARED_MISSING") return d.artifactId;
	if (d.category === "TRACKED_UNDECLARED") return d.matchedArtifactId;
}
/** 每条 Discrepancy 的机械文本摘要（Inbox `payload` 面 — §11「文本/
*  摘要」; 全字段值拼装, 零推断）。 */
function payloadOf(d, tier) {
	const base = [kv([
		["finding", `${d.category}/${d.subkind}`],
		["path", d.path],
		["artifact", artifactIdOf(d)],
		["tier", tier],
		["reason", d.tierReason]
	])];
	if (d.category === "TRACKED_UNDECLARED") base.push(kv([
		["x", d.x],
		["y", d.y],
		["inStrictTracked", d.inStrictTracked]
	]));
	else if (d.category === "UNREGISTERED_WORKSPACE_CHANGE") base.push(kv([
		["source", d.subkind],
		["zone", d.zone],
		["suggestedType", d.suggestedType],
		["sizeBytes", d.sizeBytes],
		["isNew", d.isNew]
	]));
	else if (d.category === "DECLARED_MISSING") base.push(kv([["signal", d.signal]]));
	return base.join(" ");
}
/** `context_refs` 机械构造（封闭 {ARTIFACT, WORKSTREAM}; 字段齐备才
*  发 — 无 artifact 关联 = 空集, 不虚构引用）。 */
function contextRefsOf(d) {
	const refs = [];
	const artifactId = d.category === "ARTIFACT_RECOVERABLE" ? d.artifactId : d.category === "DECLARED_MISSING" && d.artifactId !== void 0 ? d.artifactId : d.category === "TRACKED_UNDECLARED" ? d.matchedArtifactId : void 0;
	if (artifactId !== void 0) refs.push({
		kind: "ARTIFACT",
		id: artifactId
	});
	const wsId = d.category === "ARTIFACT_RECOVERABLE" ? d.workstreamId : d.category === "DECLARED_MISSING" ? d.workstreamId : void 0;
	if (wsId !== void 0) refs.push({
		kind: "WORKSTREAM",
		id: wsId
	});
	return refs;
}
/**
* Inbox 条目草稿构造（任务书目标 4「输出可入 Inbox 的条目构造器」）。
* 纯函数: 零分配器、零存储 — `id` 由 WP-6.4 落库时经共享 IdAllocator
* 分配（§1.1 IN 族）; 其余 §11 字段 1:1。
*
* `source` 冻结映射（`CATEGORY_INBOX_SOURCE` — GIT_INTEGRATION §8
* 「发现未注册产物 -> Inbox（UNREGISTERED_WORKSPACE_CHANGE）」逐字;
* 其余类别 = `UNCLASSIFIED_AUDIT_FINDING`, §1.4/§28 同名来源）;
* `raw` = 结构化 Discrepancy（§11「原始数据（如 audit finding 细节）」
* 的机器形态 — WP-6.4 落库时 JSON 序列化, 本层不预序列化）;
* `createdAt` = 注入 `now`（确定性）。
*/
function toInboxEntry(d, tier, now) {
	return {
		source: CATEGORY_INBOX_SOURCE[d.category],
		payload: payloadOf(d, tier),
		raw: d,
		contextRefs: contextRefsOf(d),
		state: "CAPTURED",
		createdAt: now
	};
}
//#endregion
//#region src/host/audit/reconcile/tiers.ts
/**
* 机械推荐档位（§22.3 冻结映射 — module doc 表; 单一真源）。
* 纯函数, never throws（类别集封闭）。
*/
function recommendTier(s) {
	switch (s.category) {
		case "UNREGISTERED_WORKSPACE_CHANGE": return s.zone === null ? {
			tier: "PROPOSE_RECONCILIATION",
			reason: "OUT_OF_ZONE"
		} : {
			tier: "AUTO_RECONCILE",
			reason: "ZONE_DECLARED"
		};
		case "TRACKED_UNDECLARED": return {
			tier: "PROPOSE_RECONCILIATION",
			reason: "TRACKED_CHANGE_CONFIRM"
		};
		case "DECLARED_MISSING": return {
			tier: "ESCALATE",
			reason: "DECLARED_LOSS"
		};
		case "RESEARCH_UNCHECKPOINTED": return {
			tier: "AUTO_RECONCILE",
			reason: "CHECKPOINT_GAP"
		};
		case "ARTIFACT_RECOVERABLE": return {
			tier: "AUTO_RECONCILE",
			reason: "URI_MATCH"
		};
	}
}
//#endregion
//#region src/host/audit/reconcile/classify.ts
/** 归一化目录记法（zone/policy 前缀匹配用）: 去 `./`/尾 `/`/空 = root。 */
function normalizeDir(p) {
	let out = p;
	if (out.startsWith("./")) out = out.slice(2);
	if (out.endsWith("/")) out = out.slice(0, -1);
	return out;
}
/** workspace-root-relative → repo-root-relative（`wsRoot` 归一化后）。 */
function toRepoRel(p, wsRoot) {
	return wsRoot === "" || wsRoot === "." ? p : `${wsRoot}/${p}`;
}
/**
* artifact `uri` 的**可验证子集**（机械判定, 零推断）: workspace-
* relative 文件路径 — 非空、非 `.`、非绝对、无 scheme、无 `..` 段、
* 无空段、无 `\`、非目录记法（尾 `/`）。scheme/绝对路径 = 外部资源
* （§7.3「path 或 URI」— URI 形态存在性不可机械验证 → 不报缺失/找回）。
*/
function isVerifiableUri(uri) {
	if (typeof uri !== "string" || uri.length === 0 || uri === ".") return false;
	if (uri.startsWith("/") || uri.endsWith("/") || uri.includes("\\")) return false;
	if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri)) return false;
	for (const seg of uri.split("/")) if (seg === "" || seg === "..") return false;
	return true;
}
/**
* 声明 zone 的目录前缀匹配（WP-6.2 `matchZone` 同语义: 「严格位于其下」
* — 等 zone 名的散文件不匹配; root zone（归一化 `''`）覆盖一切;
* 声明序先胜 — 与 WP-6.2「重叠先胜」口径一致）。
*/
function zoneOfWsPath(pWs, zones) {
	for (const zn of zones) {
		const d = normalizeDir(zn.path);
		if (d === "" || pWs !== d && pWs.startsWith(`${d}/`)) return {
			dir: d,
			artifactTypes: zn.artifactTypes ?? []
		};
	}
	return null;
}
/** trackedChanges 条目中工作树文件**确定在场**的机械判定（保守）:
*  Y=M/T（工作树修改/类型变更）; 或 Y='.' 且 X∈{M,R}（暂存修改/
*  暂存重命名 — 工作树与 index 一致且 index 有内容）; rename 行
*  新路径恒在场。X=D/A（intent-to-add 不可区分）/U 冲突态等不确定态
*  不计（不产生假「找回」/假「在场」）。 */
function worktreeFilePresent(x, y, kind) {
	if (kind === "renamed") return true;
	if (y === "M" || y === "T") return true;
	if (y === "." && (x === "M" || x === "R")) return true;
	return false;
}
/**
* discrepancy 分类（任务书目标 1）— 纯函数:
* strict audit + discovery 差分 + `.research/` 声明态 → 结构化
* Discrepancy 清单。全机械（module doc 逐条规则）; 确定性排序;
* 同输入同报告; 输入零改动（readonly 契约）。
*/
function classifyDiscrepancies(input) {
	const { audit, declared } = input;
	const discovery = input.discovery ?? null;
	const feed = input.untrackedFeed ?? null;
	const wsRoot = normalizeDir(declared.policy.workspaceRoot);
	const artifacts = declared.artifacts;
	const rowsSorted = [...artifacts.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
	const uriToArtifacts = /* @__PURE__ */ new Map();
	for (const row of rowsSorted) {
		if (!isVerifiableUri(row.uri)) continue;
		const p = toRepoRel(row.uri, wsRoot);
		const list = uriToArtifacts.get(p);
		if (list) list.push(row);
		else uriToArtifacts.set(p, [row]);
	}
	const matchedArtifactIdAt = (pRepo) => {
		const list = uriToArtifacts.get(pRepo);
		return list === void 0 ? void 0 : list[0].id;
	};
	const candidateMap = /* @__PURE__ */ new Map();
	const putCandidate = (c, fromFs, isNewFs) => {
		const pRepo = toRepoRel(c.path, wsRoot);
		if (candidateMap.has(pRepo) && candidateMap.get(pRepo).fromFs) return;
		candidateMap.set(pRepo, {
			pathRepo: pRepo,
			zone: c.zone,
			zoneArtifactTypes: c.zoneArtifactTypes,
			suggestedType: c.suggestedType,
			sizeBytes: c.sizeBytes,
			fromFs,
			isNew: fromFs ? isNewFs : true
		});
	};
	const diffAdded = new Set(discovery === null ? [] : discovery.diff.added);
	if (discovery !== null) for (const c of discovery.candidates) putCandidate(c, true, !discovery.diff.firstScan && diffAdded.has(c.path));
	if (feed !== null) for (const c of feed.candidates) putCandidate(c, false, true);
	const worktreeDeletedY = /* @__PURE__ */ new Set();
	const worktreePresentY = /* @__PURE__ */ new Set();
	for (const tc of audit.trackedChanges) {
		if (tc.y === "D") worktreeDeletedY.add(tc.path);
		if (worktreeFilePresent(tc.x, tc.y, tc.kind)) worktreePresentY.add(tc.path);
	}
	const strictTrackedSet = new Set(audit.strictTracked.tracked);
	const strictDeletedSet = new Set(audit.strictTracked.deleted);
	const researchMissingSet = new Set(audit.research.missing);
	const indexPresent = new Set([...strictTrackedSet].filter((p) => !worktreeDeletedY.has(p)));
	const diffRemoved = new Set(discovery === null ? [] : discovery.diff.removed);
	const zoneDirMissing = new Set((discovery === null ? [] : discovery.zoneDirMissing).map((z) => normalizeDir(z)));
	const isPresent = (pRepo) => candidateMap.has(pRepo) || worktreePresentY.has(pRepo) || indexPresent.has(pRepo);
	const out = [];
	const push = (d) => {
		out.push(d);
	};
	for (const tc of audit.trackedChanges) {
		if (isResearchTreePath(tc.path)) continue;
		if (tc.x === "D" || tc.y === "D") {
			if (strictDeletedSet.has(tc.path)) continue;
			const t = recommendTier({ category: "TRACKED_UNDECLARED" });
			push({
				category: "TRACKED_UNDECLARED",
				subkind: "deleted",
				path: tc.path,
				x: tc.x,
				y: tc.y,
				...tc.origPath !== void 0 ? { origPath: tc.origPath } : {},
				inStrictTracked: false,
				...matchedArtifactIdAt(tc.path) !== void 0 ? { matchedArtifactId: matchedArtifactIdAt(tc.path) } : {},
				recommendedTier: t.tier,
				tierReason: t.reason
			});
			continue;
		}
		const subkind = tc.kind === "renamed" ? "renamed" : tc.kind === "unmerged" ? "unmerged" : "modified";
		const t = recommendTier({ category: "TRACKED_UNDECLARED" });
		push({
			category: "TRACKED_UNDECLARED",
			subkind,
			path: tc.path,
			x: tc.x,
			y: tc.y,
			...tc.origPath !== void 0 ? { origPath: tc.origPath } : {},
			inStrictTracked: strictTrackedSet.has(tc.path) || strictDeletedSet.has(tc.path),
			...matchedArtifactIdAt(tc.path) !== void 0 ? { matchedArtifactId: matchedArtifactIdAt(tc.path) } : {},
			recommendedTier: t.tier,
			tierReason: t.reason
		});
	}
	for (const p of audit.strictTracked.deleted) {
		const t = recommendTier({ category: "DECLARED_MISSING" });
		push({
			category: "DECLARED_MISSING",
			subkind: "strict-tracked",
			path: p,
			signal: "git-deleted",
			recommendedTier: t.tier,
			tierReason: t.reason
		});
	}
	for (const p of audit.research.missing) {
		const t = recommendTier({ category: "DECLARED_MISSING" });
		push({
			category: "DECLARED_MISSING",
			subkind: "research-tree",
			path: p,
			signal: "research-missing",
			recommendedTier: t.tier,
			tierReason: t.reason
		});
	}
	for (const p of audit.research.untracked) {
		const t = recommendTier({ category: "RESEARCH_UNCHECKPOINTED" });
		push({
			category: "RESEARCH_UNCHECKPOINTED",
			subkind: "untracked-new",
			path: p,
			recommendedTier: t.tier,
			tierReason: t.reason
		});
	}
	for (const p of audit.research.trackedModified) {
		if (researchMissingSet.has(p)) continue;
		const t = recommendTier({ category: "RESEARCH_UNCHECKPOINTED" });
		push({
			category: "RESEARCH_UNCHECKPOINTED",
			subkind: "tracked-modified",
			path: p,
			recommendedTier: t.tier,
			tierReason: t.reason
		});
	}
	const candidatesSorted = [...candidateMap.values()].sort((a, b) => a.pathRepo < b.pathRepo ? -1 : a.pathRepo > b.pathRepo ? 1 : 0);
	for (const c of candidatesSorted) {
		if (uriToArtifacts.has(c.pathRepo)) continue;
		const t = recommendTier({
			category: "UNREGISTERED_WORKSPACE_CHANGE",
			zone: c.zone
		});
		push({
			category: "UNREGISTERED_WORKSPACE_CHANGE",
			subkind: c.fromFs ? "zone" : "feed",
			path: c.pathRepo,
			zone: c.zone,
			zoneArtifactTypes: c.zoneArtifactTypes,
			suggestedType: c.suggestedType,
			sizeBytes: c.sizeBytes,
			isNew: c.isNew,
			recommendedTier: t.tier,
			tierReason: t.reason
		});
	}
	const zones = declared.policy.discoveryZones;
	for (const row of rowsSorted) {
		if (!isVerifiableUri(row.uri)) continue;
		const pRepo = toRepoRel(row.uri, wsRoot);
		if (isPresent(pRepo)) {
			if (row.status === "MISSING") {
				const t = recommendTier({ category: "ARTIFACT_RECOVERABLE" });
				push({
					category: "ARTIFACT_RECOVERABLE",
					subkind: "found",
					path: pRepo,
					artifactId: row.id,
					workstreamId: row.workstream_id,
					recommendedTier: t.tier,
					tierReason: t.reason
				});
			}
			continue;
		}
		if (row.status !== "REGISTERED") continue;
		const gitDeleted = strictDeletedSet.has(pRepo) || researchMissingSet.has(pRepo);
		if (gitDeleted || diffRemoved.has(pRepo)) {
			const t = recommendTier({ category: "DECLARED_MISSING" });
			push({
				category: "DECLARED_MISSING",
				subkind: "artifact",
				path: pRepo,
				artifactId: row.id,
				workstreamId: row.workstream_id,
				signal: gitDeleted ? "git-deleted" : "diff-removed",
				recommendedTier: t.tier,
				tierReason: t.reason
			});
			continue;
		}
		if (discovery !== null) {
			const zn = zoneOfWsPath(row.uri, zones);
			if (zn !== null && !zoneDirMissing.has(zn.dir)) {
				const t = recommendTier({ category: "DECLARED_MISSING" });
				push({
					category: "DECLARED_MISSING",
					subkind: "artifact",
					path: pRepo,
					artifactId: row.id,
					workstreamId: row.workstream_id,
					signal: "zone-scan-absent",
					recommendedTier: t.tier,
					tierReason: t.reason
				});
			}
		}
	}
	const sorted = [];
	{
		const tmp = out.map((d) => ({
			d,
			key: [
				d.category,
				d.subkind,
				d.path
			].join("\0")
		}));
		tmp.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
		for (let i = 0; i < tmp.length; i++) sorted.push({
			...tmp[i].d,
			id: `RD-${i + 1}`
		});
	}
	const byCategory = {};
	for (const cat of DISCREPANCY_CATEGORIES) byCategory[cat] = 0;
	for (const d of sorted) byCategory[d.category]++;
	return {
		input: {
			workspaceRoot: wsRoot,
			artifactCount: artifacts.size,
			discoveryScanned: discovery !== null,
			fedUntracked: feed !== null,
			firstScan: discovery === null ? false : discovery.diff.firstScan
		},
		discrepancies: sorted,
		byCategory
	};
}
//#endregion
//#region src/host/audit/strict/errors.ts
/**
* WP-6.1 — strict git audit: 错误分类.
*
* 分工 (与 src/host/git 错误分类的关系, 同 WP-1.5 checkpoint/errors.ts 口径):
*  - git 层错误 (GitError 家族, 已结构化: 白名单/超时/命令失败/输入/越界)
*    **原样透传** — 本层不重新包装, 不丢失 git 精确信息
*    (GIT_INTEGRATION §9「repo 损坏 → 原样展示 git 错误; 插件不尝试修复」);
*  - 本层只新增 **audit 层自身不变量** 的错误 (非 repo 目录、baseline 形状、
*    policy 形状), 一律继承 {@link AuditError}。
*
* 只读边界: audit 从不执行写操作, 因此不存在 checkpoint 侧的
* StagedPreservation/Restore 一类「写后校验」错误 — 错误面只有**前置输入
* 校验**与**git 透传**两类 (结构上无写失败路径, 见 read-only 静态测试)。
*/
/** audit 层服务错误基类。code = 稳定机器码 (`AUDIT_*`), 不解析 message 文本。 */
var AuditError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.name = new.target.name;
		this.code = code;
	}
};
/** 目录不是 Git repo (W1 检测失败; GIT_INTEGRATION §2 — 未注册 workspace 拒绝 audit). */
var NotARepoAuditError = class extends AuditError {
	root;
	constructor(root) {
		super("AUDIT_NOT_A_REPO", `directory is not a Git repository (GIT_INTEGRATION §2): ${root}`);
		this.root = root;
	}
};
/** 输入形状非法 (baseline 非 40-hex OID、workspaceRoot 空路径等) — spawn 之前拒绝. */
var AuditInputError = class extends AuditError {
	constructor(message) {
		super("AUDIT_INPUT", message);
	}
};
/** workspace policy 形状非法 (§14.1 归一化防御面 — 正常经 loader 校验的文档不应触达). */
var AuditPolicyError = class extends AuditError {
	constructor(message) {
		super("AUDIT_POLICY", message);
	}
};
//#endregion
//#region src/host/audit/strict/policy.ts
/** §14.1 工程默认 (workspace.yaml 缺省时的 audit 面). */
const DEFAULT_AUDIT_POLICY = Object.freeze({
	workspaceRoot: ".",
	gitRequired: true,
	strictTrackedPaths: Object.freeze([]),
	discoveryZones: Object.freeze([]),
	ignored: Object.freeze([])
});
function assertPathList(value, field) {
	if (!Array.isArray(value)) throw new AuditPolicyError(`${field} must be an array (DOMAIN_SCHEMA §14.1), got: ${typeName(value)}`);
	return Object.freeze(value.map((entry, i) => {
		if (typeof entry !== "string" || entry.length === 0) throw new AuditPolicyError(`${field}[${i}] must be a non-empty path string (DOMAIN_SCHEMA §14.1), got: ${typeName(entry)}`);
		return entry;
	}));
}
function assertZoneList(value) {
	if (!Array.isArray(value)) throw new AuditPolicyError(`audit.discovery_zones must be an array (DOMAIN_SCHEMA §14.1), got: ${typeName(value)}`);
	return Object.freeze(value.map((zone, i) => {
		if (typeof zone !== "object" || zone === null) throw new AuditPolicyError(`audit.discovery_zones[${i}] must be an object (DOMAIN_SCHEMA §14.1), got: ${typeName(zone)}`);
		const z = zone;
		if (typeof z.path !== "string" || z.path.length === 0) throw new AuditPolicyError(`audit.discovery_zones[${i}].path must be a non-empty path string (DOMAIN_SCHEMA §14.1), got: ${typeName(z.path)}`);
		let artifactTypes;
		if (z.artifact_types !== void 0) {
			if (!Array.isArray(z.artifact_types) || z.artifact_types.some((t) => typeof t !== "string")) throw new AuditPolicyError(`audit.discovery_zones[${i}].artifact_types must be an ArtifactType string array (DOMAIN_SCHEMA §14.1), got: ${typeName(z.artifact_types)}`);
			artifactTypes = Object.freeze([...z.artifact_types]);
		}
		return Object.freeze({
			path: z.path,
			...artifactTypes !== void 0 ? { artifactTypes } : {}
		});
	}));
}
/**
* 归一化 workspace policy (§14.1).
*
* @param doc loader 侧 `.research/workspace.yaml` 文档
*   (`ResearchTree.workspace`; 文件缺失 = `null` → 全工程默认)。
* @returns 冻结的只读 {@link AuditPolicy} (同输入同输出, 确定性)。
* @throws AuditPolicyError 输入形状违反 §14.1 (loader 已校验时不可达).
*/
function normalizeWorkspacePolicy(doc) {
	if (doc === null || doc === void 0) return {
		workspaceRoot: DEFAULT_AUDIT_POLICY.workspaceRoot,
		gitRequired: DEFAULT_AUDIT_POLICY.gitRequired,
		strictTrackedPaths: [...DEFAULT_AUDIT_POLICY.strictTrackedPaths],
		discoveryZones: [...DEFAULT_AUDIT_POLICY.discoveryZones],
		ignored: [...DEFAULT_AUDIT_POLICY.ignored]
	};
	const workspace = doc.workspace;
	if (typeof workspace !== "object" || workspace === null) throw new AuditPolicyError(`workspace.yaml: \`workspace\` mapping is required (DOMAIN_SCHEMA §14.1 / workspace.schema.json), got: ${typeName(workspace)}`);
	const workspaceRoot = typeof workspace.root === "string" && workspace.root.length > 0 ? workspace.root : DEFAULT_AUDIT_POLICY.workspaceRoot;
	const gitRequired = typeof workspace.git_required === "boolean" ? workspace.git_required : DEFAULT_AUDIT_POLICY.gitRequired;
	const audit = doc.audit;
	if (audit !== void 0 && (typeof audit !== "object" || audit === null)) throw new AuditPolicyError(`workspace.yaml: \`audit\` must be a mapping (DOMAIN_SCHEMA §14.1), got: ${typeName(audit)}`);
	const strictTracked = audit?.strict_tracked;
	if (strictTracked !== void 0 && (typeof strictTracked !== "object" || strictTracked === null)) throw new AuditPolicyError(`workspace.yaml: \`audit.strict_tracked\` must be a mapping (DOMAIN_SCHEMA §14.1), got: ${typeName(strictTracked)}`);
	const strictTrackedPaths = assertPathList(strictTracked?.paths ?? [], "audit.strict_tracked.paths");
	const discoveryZones = assertZoneList(audit?.discovery_zones ?? []);
	const ignored = assertPathList(audit?.ignored ?? [], "audit.ignored");
	return Object.freeze({
		workspaceRoot,
		gitRequired,
		strictTrackedPaths,
		discoveryZones,
		ignored
	});
}
function typeName(v) {
	if (v === null) return "null";
	if (Array.isArray(v)) return "array";
	return typeof v;
}
//#endregion
//#region src/host/audit/strict/audit.ts
/**
* WP-6.1 — strict git audit (GIT_INTEGRATION §8 第一层, 计划书 §22.1).
*
* 对**注册 workspace** 执行严格跟踪层审计, 编排 = W1 → W4 → W5 → W13,
* 全部经 git wrapper 白名单 (INV-GIT-7 运行时护栏仍逐次生效):
*
*   W1 `detectRepo`     仓库检测 (§2; 非 repo → NotARepoAuditError, 拒绝 audit)
*   W4 `status`         --porcelain=v2 --branch: tracked 修改分类 (X/Y 语义:
*                       staged vs worktree vs unmerged) + untracked 新文件清单
*                       (按 `.research/` 内外分列) + 分支头 (detached/空仓)
*   W5 `diffNameStatus` 变更摘要: 缺省 = index ↔ worktree (未暂存);
*                       给定 baseline (40-hex) = 基线 ↔ worktree
*   W13 `lsFiles`       权威 tracked 集枚举: `.research/` (一致性 missing 面)
*                       + policy `strict_tracked.paths` (逐 pathspec,
*                       已做 workspace→repo root 前缀换算, §3 说明) —
*                       「判定 strict tracked 路径集内的删除/缺失」(§3 表 W13 行)
*
* 只读边界 (目标 3, 类型面证明见 tests/audit-strict/read-only.test.ts):
*   - 唯一 git 能力来源 = src/host/git 公开面; 只用 W1/W4/W5/W13 四个自动
*     触发只读操作 — W6–W12 (含全部写能力) 在本模块不可达;
*   - 零 node:fs / node:child_process import — 无任何文件 I/O;
*   - git 层错误 (GitCommandError 等) 原样透传 (§9「原样展示 git 错误」)。
*
* 与 §5.1 冲突检测**正交** (目标 4): §5.1 门禁是 checkpoint 前置
* (save 流程步骤 1, 写历史保护); audit 是纯读操作, 不受 merge/rebase/
* cherry-pick 进行中状态阻塞 (GIT_INTEGRATION §9 读操作行) — 冲突态下的
* unmerged 条目照常分类入报告。本 WP 不做 checkpoint, 不产生 ManagementAction。
*
* 边界 (§8): 报告只回答「工作区发生了哪些插件尚未登记的变化」, 不推断
* 科研含义; discovery zones 扫描 (第二层, fs 面) 归 WP-6.2, reconciliation
* 三档 (§22.3) 归 WP-6.3 — 两者消费本报告的 `newFiles.outsideResearch` 与
* `strictTracked`/`trackedChanges` 输入面。
*/
/** 全量 40-hex commit OID (W5 baseline 形状; 短 OID/refs 拒绝 — 白名单同口径). */
const FULL_OID_RE = /^[0-9a-f]{40}$/;
function byPath(a, b) {
	return a < b ? -1 : a > b ? 1 : 0;
}
function sortPaths(list) {
	return [...list].sort(byPath);
}
function sortDiff(list) {
	return [...list].sort((a, b) => byPath(a.path, b.path));
}
/** POSIX 化 (分隔符归一; 测试环境 = Linux, 跨平台安全). */
function toPosix(p) {
	return p.split(sep).join("/");
}
/** workspace.root 记法归一 (去尾随 `/`; `.`/`./`/`./a/` → `a`; 仅用于比对, 不改 pathspec 语义). */
function normRoot(p) {
	const t = toPosix(p).replace(/\/+$/, "");
	return t === "" || t === "." ? "." : t;
}
/**
* workspace root 相对 repo root 的路径 (POSIX; 相同 = `.`)。
* W1 保证 workspace root 在 repo 内; 越出 = 输入矛盾, fail loud。
*/
function workspaceRelPath(repoRoot, workspaceRootAbs) {
	const rel = relative(toPosix(repoRoot), toPosix(workspaceRootAbs));
	if (rel === "") return ".";
	if (rel === ".." || rel.startsWith("../")) throw new AuditInputError(`runStrictAudit: workspace root ${workspaceRootAbs} is outside the detected repo root ${repoRoot} (GIT_INTEGRATION §2)`);
	return toPosix(rel);
}
/**
* policy pathspec (workspace-root-relative) → repo-root-relative 前缀换算
* (GIT_INTEGRATION §3 说明「若 workspace root ≠ repo root, 插件负责前缀
* 换算」)。pathspec 字面保留 (glob / 尾随 `/` 语义归 git)。
*/
function joinPathspec(wsRel, p) {
	const b = p.startsWith("./") ? p.slice(2) : p;
	if (wsRel === ".") return b === "" || b === "." ? "." : b;
	if (b === "" || b === ".") return wsRel;
	const a = wsRel.replace(/\/+$/, "");
	const trailing = p.endsWith("/") ? "/" : "";
	return `${a}/${b.replace(/\/+$/, "")}${trailing}`;
}
/** `.research/` 域判定 (路径恰为目录记法或其内). */
function inResearch(p) {
	return p === RESEARCH_PATHSPEC || p.startsWith(RESEARCH_PATHSPEC);
}
const GLOB_CHARS_RE = /[*?\[]/;
/**
* 判定路径是否落在声明的 pathspec 内 (git-glob(7) 语义子集, 与 git 对同一
* pathspec 的 ls-files 解释一致):
*  - 字面目录 (尾随 `/`, 无 glob 字符): 该目录或其下任意路径;
*  - 字面文件 (无 glob 字符): 全等;
*  - glob: `*` = 不含 `/` 的任意串, `**` = 含 `/` 的任意串, `?` = 单个非 `/`
*    字符, `[...]` 字符类透传; 尾随 `/` = 目录前缀语义。
*/
function pathspecMatches(path, spec) {
	const dirForm = spec.endsWith("/");
	const core = dirForm ? spec.slice(0, -1) : spec;
	if (core.length === 0) return false;
	if (!GLOB_CHARS_RE.test(core)) return dirForm ? path === core || path.startsWith(`${core}/`) : path === core;
	let re = "";
	for (let i = 0; i < core.length; i++) {
		const c = core[i];
		if (c === "*") {
			if (core[i + 1] === "*") {
				re += ".*";
				i++;
			} else re += "[^/]*";
		} else if (c === "?") re += "[^/]";
		else if (c === "[") {
			const close = core.indexOf("]", i + 1);
			if (close < 0) re += "\\[";
			else {
				re += core.slice(i, close + 1);
				i = close;
			}
		} else re += c.replace(/[.*+^${}()|\\]/g, "\\$&");
	}
	const m = new RegExp(`^${re}$`).exec(path);
	if (m === null) return false;
	if (!dirForm) return true;
	const dir = m[0];
	return path === dir || path.startsWith(`${dir}/`);
}
/** W4 条目分类: tracked 变更清单 + untracked 新文件 (git 记法原样, 目录含 `/`). */
function classifyStatus(entries) {
	const changes = [];
	const untracked = [];
	for (const e of entries) {
		if (e.kind === "untracked") {
			untracked.push(e.path);
			continue;
		}
		const change = {
			path: e.path,
			kind: e.kind,
			x: e.x,
			y: e.y,
			staged: e.x !== ".",
			worktreeModified: e.y !== ".",
			stagedForDeletion: e.x === "D",
			deletedInWorktree: e.y === "D"
		};
		if (e.kind === "renamed") change.origPath = e.origPath;
		changes.push(change);
	}
	return {
		changes: changes.sort((a, b) => byPath(a.path, b.path)),
		untracked: sortPaths(untracked)
	};
}
/**
* strict git audit (目标 2) — 对注册 workspace 执行 W4/W5/W13 只读审计,
* 输出结构化 {@link AuditReport}。
*
* @throws AuditInputError      workspaceRoot/baseline 形状非法 (spawn 之前).
* @throws NotARepoAuditError   目录不是 Git repo (W1, §2).
* @throws (git 层错误原样)     GitCommandError / GitTimeoutError / GitMissingError /
*                             GitInputError (W13 pathspec 越界等, §9 原样展示)。
*/
async function runStrictAudit(opts) {
	if (typeof opts.workspaceRoot !== "string" || opts.workspaceRoot.length === 0) throw new AuditInputError("runStrictAudit: workspaceRoot must be a non-empty path");
	if (opts.baseline !== void 0 && (typeof opts.baseline !== "string" || !FULL_OID_RE.test(opts.baseline))) throw new AuditInputError(`runStrictAudit: baseline must be a full 40-hex commit OID (W5 白名单形状), got: ${String(opts.baseline).slice(0, 40)}`);
	const policy = opts.policy;
	const det = await detectRepo(opts.workspaceRoot, opts.gitOptions);
	if (!det.ok) throw new NotARepoAuditError(opts.workspaceRoot);
	const repoRoot = det.repoRoot;
	const wsRel = workspaceRelPath(repoRoot, resolve(opts.workspaceRoot));
	const st = await status(repoRoot, {
		...opts.gitOptions,
		includeBranch: true
	});
	const { changes, untracked } = classifyStatus(st.entries);
	const diffSummary = sortDiff(await diffNameStatus(repoRoot, opts.baseline, opts.gitOptions));
	const diffStatusByPath = /* @__PURE__ */ new Map();
	for (const e of diffSummary) {
		if (!diffStatusByPath.has(e.path)) diffStatusByPath.set(e.path, e.status);
		if (e.oldPath !== void 0 && !diffStatusByPath.has(e.oldPath)) diffStatusByPath.set(e.oldPath, e.status);
	}
	const trackedChanges = changes.map((c) => ({
		...c,
		diffStatus: diffStatusByPath.get(c.path) ?? (c.origPath !== void 0 ? diffStatusByPath.get(c.origPath) : void 0)
	}));
	const researchTracked = await lsFiles(repoRoot, RESEARCH_PATHSPEC, opts.gitOptions);
	const pathspecs = (policy?.strictTrackedPaths ?? []).map((p) => joinPathspec(wsRel, p));
	const strictTrackedSet = /* @__PURE__ */ new Set();
	for (const ps of pathspecs) for (const p of await lsFiles(repoRoot, ps, opts.gitOptions)) strictTrackedSet.add(p);
	const w4Deleted = changes.filter((c) => c.stagedForDeletion || c.deletedInWorktree);
	const w4DeletedPaths = new Set(w4Deleted.map((c) => c.path));
	const researchTrackedSet = new Set(researchTracked);
	const changedPaths = new Set(changes.filter((c) => c.staged || c.worktreeModified).map((c) => c.path));
	const research = {
		trackedModified: sortPaths(changes.filter((c) => inResearch(c.path) && (c.staged || c.worktreeModified)).map((c) => c.path)),
		untracked: untracked.filter((p) => inResearch(p)),
		missing: sortPaths([...researchTracked.filter((p) => w4DeletedPaths.has(p)), ...w4Deleted.filter((c) => inResearch(c.path) && !researchTrackedSet.has(c.path)).map((c) => c.path)]),
		consistent: false
	};
	research.consistent = research.trackedModified.length === 0 && research.untracked.length === 0 && research.missing.length === 0;
	const strictTrackedList = sortPaths([...strictTrackedSet]);
	const strictTracked = {
		pathspecs,
		tracked: strictTrackedList,
		modified: strictTrackedList.filter((p) => changedPaths.has(p)),
		deleted: sortPaths([...strictTrackedList.filter((p) => w4DeletedPaths.has(p)), ...w4Deleted.filter((c) => !strictTrackedSet.has(c.path)).filter((c) => pathspecs.some((ps) => pathspecMatches(c.path, ps))).map((c) => c.path)])
	};
	const warnings = [];
	if (st.head?.kind === "detached") warnings.push({
		code: "AUDIT_DETACHED_HEAD",
		message: `audit executed on detached HEAD${st.head.oid ? ` (${st.head.oid})` : ""} — read-only audit unaffected (GIT_INTEGRATION §9); checkpoint would warn before committing (§5)`
	});
	else if (st.head?.kind === "branch" && /^# branch\.oid \(initial\)\s*$/m.test(st.raw)) warnings.push({
		code: "AUDIT_EMPTY_REPO",
		message: "repository has no commits yet — W5 baseline mode unavailable; report reflects index/working tree state"
	});
	if (st.truncated) warnings.push({
		code: "AUDIT_TRUNCATED",
		message: "W4 status output exceeded maxOutputBytes — trackedChanges/newFiles may be incomplete (raise gitOptions.maxOutputBytes)"
	});
	if (policy !== void 0 && normRoot(policy.workspaceRoot) !== wsRel) warnings.push({
		code: "AUDIT_POLICY_MISMATCH",
		message: `workspace.yaml workspace.root=${JSON.stringify(policy.workspaceRoot)} but the registered workspace root is ${JSON.stringify(wsRel)} relative to the repo root — pathspec conversion used the actual location (GIT_INTEGRATION §2)`
	});
	return {
		head: st.head ?? null,
		...opts.baseline !== void 0 ? { baseline: opts.baseline } : {},
		trackedChanges,
		diffSummary,
		newFiles: {
			outsideResearch: untracked.filter((p) => !inResearch(p)),
			insideResearch: untracked.filter((p) => inResearch(p))
		},
		research,
		strictTracked,
		warnings
	};
}
//#endregion
//#region src/host/service/wiring/audit-refresh.ts
/**
* WP-7.2（RR-018①）— audit 生产触发: 审计链刷新段（wiring 的 refresh 段）。
*
* RR-018① 原文缺口: 「审计链无端到端测试与生产触发（audit 服务未挂
* [Service.init] 刷新循环）」。本模块交付该生产触发面:
*
* ```text
* run()
*  1. fresh 树加载（workspace.yaml policy 面 — 文件即真值; 树坏 =
*     默认 policy + 大声 warn — 刷新不阻塞, 查询主路径自己 loud）
*  2. runStrictAudit（WP-6.1: W1/W4/W5/W13 只读 git 面）
*  3. DiscoveryScanner.scan（WP-6.2: fs 只读扫描 + 快照增量差分 —
*     operational KV 基线; 失败不毁基线, 其既有纪律）
*  4. feedUntracked（W4 untracked → discovery 归一化 feed 通道）
*  5. classifyDiscrepancies（WP-6.3: strict + discovery 差分 + 声明态
*     → 结构化 Discrepancy 清单 — 全机械规则, §22.2 边界）
*  6. 机械路由（§22.3 三档的机械半边 — 不触达用户显式档位面
*     `reconcileDiscrepancies`, 那是用户 actor 面, INV-PERM-4）:
*     - AUTO_RECONCILE / PROPOSE_RECONCILIATION ⇒ Inbox 机械入口
*       `captureMechanical`（条目 = `toInboxEntry` 草稿, WP-6.3 缝）;
*     - ESCALATE ⇒ 单批 `escalateMechanical`（capture-first + 高影响
*       机械判定 ⇒ Intervention 联动 — WP-6.4 面; 证据 = 机械事实
*       聚合, 零语义判断）。
*  7. 去重基线（operational KV `audit-refresh:reported-v1` — 指纹集合:
*     已报告且未变的 finding 不重复落条目; 消失的 finding 从基线移除,
*     复发重新报告 — 同 WP-6.2 快照增量差分纪律; 失败不标记, 下轮重试）。
* ```
*
* 触发策略（任务书「失败 loud 不阻塞查询主路径, 报告注明策略」）:
*  - **查询路径触发**: 生产挂点 = `getDashboard`（RR-018② 聚合段）—
*    客户端 dashboard 刷新循环即生产触发循环（每次刷新一次 audit
*    链; 与 WP-4.6 懒检测先例同一形态 — 查询路径上的幂等机械面）;
*  - **无独立定时器**: 间隔调参需要 config 面（插件 Config 无 audit
*    间隔字段, 硬编码间隔 = 不该存在的调参 — 红线纪律）; 去重基线 +
*    discovery 快照保证稳态下每次刷新的**写入**为零（只有 git 只读
*    开销, 与 stale 懒检测同级）;
*  - **失败 loud 不阻塞**: 任何一步失败 = `AuditRefreshError`（稳定
*    机器码）上抛; 调用方（getDashboard）catch + logger.error 大声
*    记录后**继续查询投影**（audit 链失败 ≠ 数据面失败 — 查询主
*    路径返回的是它自己的投影, 不因旁路机械面 abort）。
*
* 层边界（ARCHITECTURE §2.2）: wiring（组合根）— 本模块只做组合与
* 路由; 全部事实/规则归 audit 三层（strict/discovery/reconcile）与
* inbox 服务; 零 DSH import（INV-PERM-5）; 唯一写路径 = inbox 机械
* 入口 + 两个 operational KV（discovery 快照 — scanner 既有 + 本模块
* 去重基线 — meta 簿记面, 非一等 identity 行, 允许覆写/清理）。
*/
/** 去重基线的 operational KV 键（meta 簿记面 — 非一等 identity 行）。 */
const AUDIT_REFRESH_REPORTED_KEY = "audit-refresh:reported-v1";
const DEDUPE_VERSION = 1;
/** 机械 actor（PLUGIN — 审计链的机械入口, §11 非 USER 闭集）。 */
const AUDIT_REFRESH_ACTOR = {
	kind: "PLUGIN",
	label: "audit-refresh"
};
var AuditRefreshError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.name = "AuditRefreshError";
		this.code = code;
	}
};
/** 构造 audit 刷新运行器（组合根注入 — create.ts 持有, getDashboard 触发）。 */
function createAuditRefreshRunner(options) {
	if (typeof options.repoRoot !== "string" || options.repoRoot.length === 0) throw new AuditRefreshError("ARF_INPUT", "createAuditRefreshRunner: repoRoot is required");
	if (options.meta === null || typeof options.meta !== "object" || typeof options.meta.get !== "function") throw new AuditRefreshError("ARF_INPUT", "createAuditRefreshRunner: the operational meta KV face is required");
	if (options.inbox === null || typeof options.inbox !== "object" || typeof options.inbox.captureMechanical !== "function") throw new AuditRefreshError("ARF_INPUT", "createAuditRefreshRunner: the InboxService mechanical entry is required");
	const now = options.now ?? Date.now;
	const actor = options.actor ?? AUDIT_REFRESH_ACTOR;
	return { run: () => runRefresh(options, now, actor) };
}
async function runRefresh(options, now, actor) {
	const { repoRoot, meta, inbox, logger } = options;
	let workspaceDoc = null;
	try {
		workspaceDoc = loadResearchTree(options.reader, options.researchRoot, options.declarativeDir).tree.workspace;
	} catch (cause) {
		logger?.warn("audit-refresh.tree", `tree load failed — defaulting to the engineering audit policy: ${messageOf(cause)}`);
	}
	let strictPolicy;
	let discoveryPolicy;
	try {
		strictPolicy = workspaceDoc === null ? null : normalizeWorkspacePolicy(workspaceDoc);
	} catch (cause) {
		throw new AuditRefreshError("ARF_AUDIT", `audit-refresh: workspace.yaml policy normalization failed: ${messageOf(cause)}`, { cause });
	}
	try {
		discoveryPolicy = policyFromWorkspaceDoc(workspaceDoc);
	} catch (cause) {
		throw new AuditRefreshError("ARF_DISCOVERY", `audit-refresh: discovery policy normalization failed: ${messageOf(cause)}`, { cause });
	}
	let report;
	try {
		report = await runStrictAudit({
			workspaceRoot: repoRoot,
			...strictPolicy !== null ? { policy: strictPolicy } : {}
		});
	} catch (cause) {
		throw new AuditRefreshError("ARF_AUDIT", `audit-refresh: strict audit failed: ${messageOf(cause)}`, { cause });
	}
	const effectivePolicy = strictPolicy ?? DEFAULT_AUDIT_POLICY;
	const wsRoot = effectivePolicy.workspaceRoot === "." ? repoRoot : resolve(repoRoot, effectivePolicy.workspaceRoot);
	const scanner = new DiscoveryScanner(meta, now);
	let scan;
	try {
		scan = scanner.scan({
			workspaceRoot: wsRoot,
			policy: discoveryPolicy
		});
	} catch (cause) {
		throw new AuditRefreshError("ARF_DISCOVERY", `audit-refresh: discovery scan failed: ${messageOf(cause)}`, { cause });
	}
	const feed = feedUntracked(discoveryPolicy, untrackedRefsFromPaths(report.newFiles.outsideResearch));
	let classified;
	try {
		const declared = {
			artifacts: options.readSemanticState().artifacts,
			policy: effectivePolicy
		};
		classified = classifyDiscrepancies({
			audit: report,
			discovery: scan,
			untrackedFeed: feed,
			declared
		});
	} catch (cause) {
		throw new AuditRefreshError("ARF_CLASSIFY", `audit-refresh: discrepancy classification failed: ${messageOf(cause)}`, { cause });
	}
	const reported = readDedupeSet(meta, AUDIT_REFRESH_REPORTED_KEY);
	const captured = [];
	const captureFailures = [];
	let skippedDedupe = 0;
	let skippedBaseline = 0;
	const escalateBatch = [];
	const currentFps = /* @__PURE__ */ new Set();
	const persistSet = /* @__PURE__ */ new Set();
	for (const d of classified.discrepancies) {
		const fp = fingerprint(d);
		currentFps.add(fp);
		if (d.category === "UNREGISTERED_WORKSPACE_CHANGE" && d.subkind === "zone" && !d.isNew) {
			skippedBaseline += 1;
			if (reported.has(fp)) persistSet.add(fp);
			continue;
		}
		if (reported.has(fp)) {
			skippedDedupe += 1;
			persistSet.add(fp);
			continue;
		}
		if (d.recommendedTier === "ESCALATE") {
			escalateBatch.push(d);
			continue;
		}
		const draft = toInboxEntry(d, d.recommendedTier, now());
		try {
			const res = inbox.captureMechanical({
				source: draft.source,
				payload: draft.payload,
				raw: draft.raw,
				contextRefs: draft.contextRefs
			}, actor);
			captured.push({
				key: fp,
				inboxItemId: res.item.id,
				source: draft.source
			});
			persistSet.add(fp);
		} catch (cause) {
			const code = inboxErrorCode(cause);
			captureFailures.push({
				key: fp,
				code,
				message: messageOf(cause)
			});
			logger?.error("audit-refresh.capture", `[${code}] ${messageOf(cause)}`);
		}
	}
	let escalated = null;
	if (escalateBatch.length > 0) {
		const evidence = escalationEvidence(escalateBatch);
		try {
			const res = inbox.escalateMechanical({
				source: "UNCLASSIFIED_AUDIT_FINDING",
				evidence
			}, actor);
			escalated = {
				inboxItemId: res.item.id,
				interventionId: res.intervention === null ? null : res.intervention.id,
				highImpact: res.assessment.highImpact,
				reasons: [...res.assessment.reasons]
			};
			for (const d of escalateBatch) persistSet.add(fingerprint(d));
		} catch (cause) {
			const code = inboxErrorCode(cause);
			captureFailures.push({
				key: `ESCALATE-BATCH(${escalateBatch.length})`,
				code,
				message: messageOf(cause)
			});
			logger?.error("audit-refresh.escalate", `[${code}] ${messageOf(cause)}`);
		}
	}
	try {
		meta.set(AUDIT_REFRESH_REPORTED_KEY, JSON.stringify({
			version: DEDUPE_VERSION,
			entries: [...persistSet].sort()
		}));
	} catch (cause) {
		throw new AuditRefreshError("ARF_STATE", `audit-refresh: the dedupe baseline persist failed: ${messageOf(cause)}`, { cause });
	}
	return {
		audit: {
			trackedChangeCount: report.trackedChanges.length,
			newFilesOutsideResearch: report.newFiles.outsideResearch.length,
			newFilesInsideResearch: report.newFiles.insideResearch.length,
			researchConsistent: report.research.consistent,
			strictTrackedModified: report.strictTracked.modified.length,
			strictTrackedDeleted: report.strictTracked.deleted.length,
			warningCount: report.warnings.length
		},
		discovery: {
			firstScan: scan.diff.firstScan,
			addedCount: scan.diff.added.length,
			removedCount: scan.diff.removed.length,
			candidateCount: scan.candidates.length
		},
		discrepancyCount: classified.discrepancies.length,
		byCategory: { ...classified.byCategory },
		captured,
		escalated,
		skippedDedupe,
		skippedBaseline,
		captureFailures
	};
}
/** 一条 finding 的稳定指纹（去重基线键 — 含全部机械事实字段）。 */
function fingerprint(d) {
	switch (d.category) {
		case "TRACKED_UNDECLARED": return JSON.stringify([
			"T",
			d.subkind,
			d.path,
			d.x,
			d.y,
			d.origPath ?? null,
			d.inStrictTracked
		]);
		case "UNREGISTERED_WORKSPACE_CHANGE": return JSON.stringify([
			"U",
			d.subkind,
			d.path,
			d.zone,
			d.suggestedType
		]);
		case "DECLARED_MISSING": return JSON.stringify([
			"M",
			d.subkind,
			d.path,
			d.signal,
			d.artifactId ?? null
		]);
		case "RESEARCH_UNCHECKPOINTED": return JSON.stringify([
			"R",
			d.subkind,
			d.path
		]);
		case "ARTIFACT_RECOVERABLE": return JSON.stringify([
			"A",
			d.path,
			d.artifactId
		]);
	}
}
/** ESCALATE 批的升级证据（机械事实聚合 — 零语义判断, §22.3 损失面）。 */
function escalationEvidence(batch) {
	const strictTrackedPaths = [];
	const deletedPaths = [];
	const workstreamIds = /* @__PURE__ */ new Set();
	const contextRefs = [];
	const seenRefs = /* @__PURE__ */ new Set();
	const categories = /* @__PURE__ */ new Set();
	const addRefs = (refs) => {
		for (const ref of refs) {
			const k = `${ref.kind}:${ref.id}`;
			if (!seenRefs.has(k)) {
				seenRefs.add(k);
				contextRefs.push(ref);
			}
		}
	};
	for (const d of batch) {
		categories.add(d.category);
		if (d.category === "TRACKED_UNDECLARED") {
			if (d.inStrictTracked) strictTrackedPaths.push(d.path);
			if (d.subkind === "deleted") deletedPaths.push(d.path);
		} else if (d.category === "DECLARED_MISSING") {
			deletedPaths.push(d.path);
			if (d.subkind === "strict-tracked") strictTrackedPaths.push(d.path);
			if (d.workstreamId !== void 0) workstreamIds.add(d.workstreamId);
			addRefs(toInboxEntry(d, "ESCALATE", 0).contextRefs);
		} else if (d.category === "UNREGISTERED_WORKSPACE_CHANGE") addRefs(toInboxEntry(d, "ESCALATE", 0).contextRefs);
		else if (d.category === "RESEARCH_UNCHECKPOINTED" || d.category === "ARTIFACT_RECOVERABLE") addRefs(toInboxEntry(d, "ESCALATE", 0).contextRefs);
	}
	return {
		summary: `audit ESCALATE batch: ${batch.length} high-impact discrepancy(ies) — ` + [...categories].sort().join(", "),
		...workstreamIds.size > 0 ? { workstreamIds: [...workstreamIds].sort() } : {},
		...strictTrackedPaths.length > 0 ? { strictTrackedPaths: [...new Set(strictTrackedPaths)].sort() } : {},
		...deletedPaths.length > 0 ? { deletedPaths: [...new Set(deletedPaths)].sort() } : {},
		affectedPathCount: batch.length,
		...contextRefs.length > 0 ? { contextRefs: contextRefs.sort((a, b) => a.kind + a.id < b.kind + b.id ? -1 : 1) } : {}
	};
}
function readDedupeSet(meta, key) {
	const raw = meta.get(key);
	if (raw === null) return /* @__PURE__ */ new Set();
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new AuditRefreshError("ARF_STATE", `audit-refresh: the dedupe baseline at ${JSON.stringify(key)} is not valid JSON (corrupt — never silently reset): ${messageOf(cause)}`, { cause });
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new AuditRefreshError("ARF_STATE", `audit-refresh: the dedupe baseline at ${JSON.stringify(key)} is not an object (corrupt)`);
	const doc = parsed;
	if (doc.version !== DEDUPE_VERSION) throw new AuditRefreshError("ARF_STATE", `audit-refresh: the dedupe baseline at ${JSON.stringify(key)} has version ${JSON.stringify(doc.version)} (expected ${DEDUPE_VERSION} — corrupt/foreign)`);
	if (!Array.isArray(doc.entries) || doc.entries.some((e) => typeof e !== "string")) throw new AuditRefreshError("ARF_STATE", `audit-refresh: the dedupe baseline at ${JSON.stringify(key)} has a malformed entries array (corrupt)`);
	return new Set(doc.entries);
}
function inboxErrorCode(cause) {
	if (cause instanceof InboxError) return cause.code;
	if (cause instanceof AuditRefreshError) return cause.code;
	return "ARF_INBOX";
}
function messageOf(cause) {
	return cause instanceof Error ? cause.message : String(cause);
}
//#endregion
//#region src/host/service/stale/types.ts
/**
* A stale-service violation (ARCHITECTURE §10: 错误信息指明失败项 — precise
* message, no guess-repair). Domain-level failures (PF_NOT_FOUND /
* PF_WRONG_STATE / PF_BASE_CAPTURE …) propagate as WP-3.1 `PlanForkError`
* unchanged — this class only covers service-boundary conditions.
*/
var StaleServiceError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.name = "StaleServiceError";
		this.code = code;
	}
};
//#endregion
//#region src/host/service/stale/closure.ts
/**
* WP-3.2 — the §5 stale-detection set comparison (PURE — zero I/O).
*
* Frozen contract (PLAN_FORK_SPEC §5, 原文):
*
*   ```text
*   stale(PF) ⇔ currentClosure(WS) ≠ PF.base_plan_objects     # (path, oid) 集合不相等
*   ```
*
*   - 集合比较：路径集合不同（增/删文件）或任一同路径文件 blob OID 不同，
*     均判 stale；文件缺失视为不同；
*   - 判 stale 后：`stale_reason` 记录**首个差异**（path + old/new oid）。
*
* This module is the mechanical heart of the algorithm: it receives the
* frozen base set (`base_plan_objects`, creation order) and the recomputed
* current set (working-copy OIDs, `null` = the file is not a regular file on
* disk — 「文件缺失视为不同」) and produces the structured diff + the
* `stale_reason` string. No git, no fs, no DB — unit-testable in isolation
* (tests/stale/compare.test.ts 钉死全部分支).
*
* Determinism: the diff is ordered by (1) CURRENT closure order (plan.yaml
* first, then canonical order — the same stable order §3.2 bases use) for
* added/changed/missing entries, then (2) BASE closure order for removed
* entries. `diff[0]` is therefore THE 「首个差异」 of §5: plan.yaml comes
* first in both orders, and within each order the canonical item order is
* preserved.
*/
/** The `items/<dir>` subdirectory per item kind (DOMAIN_SCHEMA §14 布局 — mirrors the WP-3.1 anchors.ts table). */
const KIND_TO_DIR = {
	TASK: "tasks",
	GATE: "gates",
	MILESTONE: "milestones"
};
/**
* The §3.1 closure paths in LENIENT form — for stale rechecks where the
* canonical plan may be INCONSISTENT (user mid-edit: a malformed
* `ordered_items` element, a dangling definition file …):
*
*   1. `<wsDir>/plan.yaml`
*   2. one definition file per WELL-FORMED T/G/M element of `ordered_items`,
*      canonical order (`<wsDir>/items/<tasks|gates|milestones>/<id>.yaml`);
*      malformed elements are skipped (they have no definition file — the
*      §5 set comparison then runs on the computable part, and plan.yaml's
*      own OID almost certainly changed too).
*
* The STRICT face (creation path) is WP-3.1 `closureRelativePaths` (a
* malformed element is an upstream validation failure ⇒ PF_INPUT). This
* lenient face never throws on element shape — it only computes paths;
* disk presence is judged by the caller (hashing layer).
*
* Duplicates in `ordered_items` (inconsistent plan) are deduplicated — a
* closure is a SET (§5 集合比较).
*/
function closurePathsLenient(wsDir, orderedItems) {
	const normalized = wsDir.endsWith("/") ? wsDir.slice(0, -1) : wsDir;
	const paths = [`${normalized}/plan.yaml`];
	const seen = new Set(paths);
	for (const id of orderedItems) {
		const parsed = parseId(id);
		if (parsed === null) continue;
		if (parsed.kind !== "TASK" && parsed.kind !== "GATE" && parsed.kind !== "MILESTONE") continue;
		const p = `${normalized}/items/${KIND_TO_DIR[parsed.kind]}/${id}.yaml`;
		if (!seen.has(p)) {
			seen.add(p);
			paths.push(p);
		}
	}
	return paths;
}
/**
* The §5 set comparison: `stale(PF) ⇔ current ≠ base`.
*
* Returns the structured diff (EMPTY ⇔ the sets are EQUAL — not stale).
* Kinds (see `ClosureDiffKind`):
*  - current-only path, on disk        → `added`       (base_oid=null, current_oid=oid)
*  - current-only path, not on disk    → `missing`     (base_oid=null, current_oid=null)
*  - base+current path, OIDs differ    → `oid_changed` (both OIDs set)
*  - base+current path, not on disk    → `missing`     (base_oid set,   current_oid=null)
*  - base-only path                    → `removed`     (base_oid set,   current_oid=null)
*
* Order: current-set order first, then base-set order for removed entries
* (见模块头注 — `diff[0]` = §5 「首个差异」).
*
* Set semantics: element ORDER is irrelevant (a canonical reorder keeps the
* same file set — it is caught via plan.yaml's OID instead); duplicate paths
* on either side are first-occurrence-wins (a closure is a set).
*/
function compareClosureBases(base, current) {
	const baseByPath = /* @__PURE__ */ new Map();
	for (const b of base) if (!baseByPath.has(b.path)) baseByPath.set(b.path, b.git_blob_oid);
	const currentByPath = /* @__PURE__ */ new Map();
	for (const c of current) if (!currentByPath.has(c.path)) currentByPath.set(c.path, c.oid);
	const diff = [];
	for (const c of current) {
		const baseOid = baseByPath.get(c.path);
		if (baseOid === void 0) diff.push(c.oid === null ? {
			path: c.path,
			kind: "missing",
			base_oid: null,
			current_oid: null
		} : {
			path: c.path,
			kind: "added",
			base_oid: null,
			current_oid: c.oid
		});
		else if (c.oid === null) diff.push({
			path: c.path,
			kind: "missing",
			base_oid: baseOid,
			current_oid: null
		});
		else if (baseOid !== c.oid) diff.push({
			path: c.path,
			kind: "oid_changed",
			base_oid: baseOid,
			current_oid: c.oid
		});
	}
	const removedReported = /* @__PURE__ */ new Set();
	for (const b of base) {
		if (removedReported.has(b.path) || currentByPath.has(b.path)) continue;
		removedReported.add(b.path);
		diff.push({
			path: b.path,
			kind: "removed",
			base_oid: b.git_blob_oid,
			current_oid: null
		});
	}
	return diff;
}
/**
* The §5 `stale_reason` string: the FIRST diff as a mechanical triple
* （「path + old/new oid」原文口径）:
*
*   `path=<p>; base_oid=<oid|absent>; current_oid=<oid|missing|absent>`
*
* Sentinels: `absent` = the path was not in that set; `missing` = the path
* was in the current set but not a regular file on disk (current side only).
* Throws on an empty diff (there is no stale reason to format — callers must
* check `diff.length > 0` first; fail loud, no empty-reason STALE rows).
*/
function formatStaleReason(diff) {
	const d = diff[0];
	if (d === void 0) throw new Error("formatStaleReason: diff is empty — no stale reason exists (PLAN_FORK_SPEC §5)");
	const baseOid = d.base_oid === null ? "absent" : d.base_oid;
	const currentOid = d.kind === "removed" ? "absent" : d.current_oid === null ? "missing" : d.current_oid;
	return `path=${d.path}; base_oid=${baseOid}; current_oid=${currentOid}`;
}
//#endregion
//#region src/host/service/stale/git-capture.ts
/**
* WP-3.2 — git-backed closure blob capture (W3 batch + W11 HEAD).
*
* Frozen contract (PLAN_FORK_SPEC §3.2 + GIT_INTEGRATION §7 W3):
*
*   ```text
*   对 closure 中每个文件:  git hash-object -- <path>
*   保存 base_plan_objects: { path, git_blob_oid }[]（稳定集合）
*   同时记录 base_git_commit（当时 HEAD，信息性，不参与 stale 判定）
*   ```
*
*   - `hash-object` 对 **working copy** 内容计算，无需 commit → stale 检测
*     不依赖用户 commit 频率（§5.2 实测: 内容一致时 hash-object ==
*     rev-parse HEAD:path; 修改后 OID 改变）;
*   - 相同内容重写（无实质变化）OID 不变，不误报（TC-GIT-004 语义）。
*
* ## 性能约束: 「batch hash-object (W13/W3 组合)」的落地口径
*
* The frozen W3 whitelist row (GIT_INTEGRATION §3, 冻结) is EXACTLY
* `git hash-object -- <path>` — ONE path per invocation
* (src/host/git/whitelist.ts: `a.length === 3`). Native git accepts
* multiple paths in one `hash-object` call, but that argv shape is NOT in
* the frozen whitelist and unreachable without amending the frozen contract
* (本 WP 无此权限 — spec-issue 通道, 见报告). W13 (`git ls-files --
* <pathspec>`) enumerates TRACKED paths (index state) — it cannot produce
* working-copy blob OIDs (an UNTRACKED new closure file — e.g. a just-added
* T-5.yaml the user never committed — is exactly the state §3.2 must cover),
* so W13 cannot replace W3 here; running it would ADD a process per
* capture without removing any.
*
* The per-file process storm is therefore avoided at the ORCHESTRATION
* level: all W3 invocations of one closure run through a bounded
* concurrency pool (default 8 in-flight, `mapWithConcurrency` below) —
* wall time ≈ ⌈N/8⌉ × (spawn + hash) instead of N × (spawn + hash).
* Process count stays N (+1 for the informational W11 HEAD read) — the
* measurement is recorded in the WP-3.2 report (§测试结果).
*
* Missing-file semantics (§5 「文件缺失视为不同」): a closure path that is
* not a regular file in the working copy is classified AS a result entry
* (`oid: null`) instead of aborting the recheck — the §5 set comparison
* then reports it as a `missing` diff. For the CREATION face (base capture)
* a missing file is an anomaly (a consistent canonical plan cannot reference
* a nonexistent definition file) and fails loud (`STALE_CAPTURE`; the
* creation path re-wraps it as `PF_BASE_CAPTURE`, §4 步骤 3).
*
* Layer rule (ARCHITECTURE §2.2): this module only calls the named git
* operations (W3 `hashObject`, W11 `revParseHead`) — the git layer is the
* sole spawn point (INV-GIT-6). The `fs` calls here are READ-ONLY
* classification (is-regular-file), not git logic.
*/
/**
* Map `items` through async `fn` with at most `limit` in-flight calls,
* preserving INPUT order in the result. Fail-fast: the first rejection
* rejects the whole promise once in-flight calls settle (git processes are
* short-lived; no cancellation of in-flight W3 calls).
*
* `limit` must be a positive integer (validated by the caller). Exported
* for unit testing (tests/stale — max-in-flight / order / error semantics).
*/
async function mapWithConcurrency(items, limit, fn) {
	const results = new Array(items.length);
	let next = 0;
	const workerCount = Math.min(limit, items.length);
	const workers = [];
	for (let w = 0; w < workerCount; w++) workers.push((async () => {
		for (;;) {
			const i = next++;
			if (i >= items.length) return;
			results[i] = await fn(items[i]);
		}
	})());
	await Promise.all(workers);
	return results;
}
function assertClosurePath(rel, researchDir) {
	if (typeof rel !== "string" || rel.length === 0) throw new StaleServiceError("STALE_INPUT", `closure path must be a non-empty string (got ${JSON.stringify(rel)})`);
	if (rel === ".." || rel.startsWith("../") || rel.startsWith("/") || rel.includes("\0")) throw new StaleServiceError("STALE_INPUT", `closure path must be .research-relative POSIX (no absolute / .. / NUL), got: ${JSON.stringify(rel)}`);
	return `${researchDir}/${rel}`;
}
/** True iff `abs` is a regular file (stat failures — races — count as absent). */
function isRegularFile(abs) {
	try {
		if (!existsSync(abs)) return false;
		return statSync(abs).isFile();
	} catch {
		return false;
	}
}
async function hashOne(opts, rel) {
	const repoRel = assertClosurePath(rel, opts.researchDir);
	const abs = join(opts.repoRoot, repoRel);
	if (!isRegularFile(abs)) return {
		path: rel,
		oid: null
	};
	try {
		return {
			path: rel,
			oid: await hashObject(opts.repoRoot, repoRel, opts.git)
		};
	} catch (cause) {
		if (!isRegularFile(abs)) return {
			path: rel,
			oid: null
		};
		throw cause;
	}
}
/**
* The informational HEAD read (W11). A repository with NO commits yet is a
* legal state (working-copy basis — §3.2 「无需 commit」): `rev-parse HEAD`
* fails with git's standard no-history message ⇒ `gitCommit: undefined`
* (the model field is optional). Any OTHER git error fails loud (GIT
* INTEGRATION §9: repo 损坏 → 原样展示; 插件不尝试修复).
*/
const NO_HEAD_RE = /does not have any commits yet|unknown revision 'HEAD'|ambiguous argument 'HEAD'/;
async function readHeadOrUndefined(opts) {
	try {
		return await revParseHead(opts.repoRoot, opts.git);
	} catch (cause) {
		if (cause instanceof GitCommandError && NO_HEAD_RE.test(cause.stderr)) return void 0;
		throw cause;
	}
}
/** Deduplicate preserving first-occurrence order (a closure is a SET — §5). */
function dedupeInOrder(paths) {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const p of paths) if (!seen.has(p)) {
		seen.add(p);
		out.push(p);
	}
	return out;
}
/**
* Recheck face (stale detection): hash every closure path with the bounded
* W3 pool; missing files become `oid: null` entries (the §5 comparison
* turns them into `missing` diffs). Git infrastructure errors (GitError
* family) propagate UNWRAPPED — the service classifies them (STALE_GIT) and
* NO state change happens (the transition only runs after a successful
* recompute).
*/
async function hashClosure(opts, closure) {
	const unique = dedupeInOrder(closure);
	const entries = await mapWithConcurrency(unique, opts.concurrency, (rel) => hashOne(opts, rel));
	const gitCommit = unique.length > 0 ? await readHeadOrUndefined(opts) : void 0;
	return {
		entries,
		...gitCommit !== void 0 ? { gitCommit } : {}
	};
}
/**
* Creation face (§3.2 base capture): same bounded W3 pool + HEAD, but a
* missing closure file FAILS LOUD (`STALE_CAPTURE`) — a base closure must be
* fully present (the §4 步骤 2 canonical consistency check guarantees this
* for a valid creation; this is the belt-and-suspenders face). The service
* creation path re-wraps the error as `PF_BASE_CAPTURE` (step 3) so the
* domain error taxonomy stays single-sourced.
*/
async function captureGitClosureBase(opts, closure) {
	const { entries, gitCommit } = await hashClosure(opts, closure);
	const missing = entries.find((e) => e.oid === null);
	if (missing !== void 0) throw new StaleServiceError("STALE_CAPTURE", `closure file missing from working copy: ${missing.path} (PLAN_FORK_SPEC §3.1 — every closure file must be a regular file for a base capture)`);
	return {
		objects: entries.map((e) => ({
			path: e.path,
			git_blob_oid: e.oid
		})),
		...gitCommit !== void 0 ? { gitCommit } : {}
	};
}
/**
* Wrap an ALREADY-CAPTURED base for the WP-3.1 `ClosureBlobCapturer` port
* (which is SYNCHRONOUS — the pure domain layer never awaits).
*
* The service pre-captures asynchronously (git), then injects this adapter
* into the §4 chain's context; step 3 re-computes the closure from the plan
* view and calls `capture` synchronously. The adapter returns the pre-
* captured base ONLY when the requested (wsDir, closure) is IDENTICAL to
* the one it was built for (first call records the expectation; any other
* request throws — the domain wraps it as PF_BASE_CAPTURE). The mismatch
* can only mean the canonical plan changed between pre-capture and step-3
* recompute — exactly the race INV-PLAN-6 forbids (base is always
* server-recomputed, never client-supplied or stale).
*/
function withCapturedBase(captured) {
	let expectedWsDir = null;
	let expectedKey = null;
	const keyOf = (wsDir, closure) => `${wsDir}\u0000${closure.join("\0")}`;
	return { capture(wsDir, closure) {
		const key = keyOf(wsDir, closure);
		if (expectedWsDir === null) {
			expectedWsDir = wsDir;
			expectedKey = key;
			return captured;
		}
		if (wsDir !== expectedWsDir || key !== expectedKey) throw new Error(`pre-captured base closure does not match the requested closure (wsDir=${JSON.stringify(wsDir)}; ${closure.length} paths) — the canonical plan changed between server-side capture and step-3 recompute; re-run creation (INV-PLAN-6: base is always server-recomputed)`);
		return captured;
	} };
}
//#endregion
//#region src/host/service/stale/service.ts
/**
* WP-3.2 — `PlanForkStaleService`: closure blob-OID basis + stale detection.
*
* The three deliverable faces (PLAN_FORK_SPEC §3/§5/§10; GIT_INTEGRATION §7):
*
* 1. **closure 捕获（§3.1 + §3.2）** — `capturePlanClosure(wsId)` computes
*    the §3.1 closure of the CURRENT canonical plan and captures per-file
*    working-copy blob OIDs via the git wrapper's W3 (bounded pool) + the
*    informational HEAD (W11). `createPlanFork(params, ctx)` is the
*    production creation path: it pre-captures the base (real git), then
*    runs the WP-3.1 八步 chain + `PlanForkStore.createPlanFork` with a
*    synchronous adapter that hands the captured base to step 3 — the
*    record's `base_plan_objects` (+ `base_git_commit`) thus always come
*    from the server-side git recompute (INV-PLAN-6).
*
* 2. **stale 检测（§5 算法原文）** — `checkStale(pfId)`: for an OPEN PF,
*    recompute the current closure OID set and compare it with
*    `PF.base_plan_objects` as SETS (路径集合不同 或 同路径 OID 不同 ⇒
*    stale; 文件缺失视为不同). A difference ⇒ `OPEN → STALE` via the
*    WP-3.1 state-machine face (`store.transition` — 乐观条件更新 +
*    同事务 `ManagementAction(PF_STALE_MARKED)`, actor=PLUGIN) with
*    `stale_reason` = the FIRST diff (path + old/new oid — §5 原文口径)
*    + the full structured diff in the outcome.
*
* 3. **检测触发面** — `checkStale(pfId)` (manual, single) +
*    `checkAllOpen(workstreamId?)` (sweep; per-PF failures are collected,
*    never abort the sweep). The TRIGGER TIMING (plan/item 加载/变更后、PF
*    列表查询懒检测、SELECT 前强制复核 — §5) is the host wiring's
*    decision (later WP); this WP provides the API only.
*
* Idempotency: re-checking a non-OPEN PF is a NO-OP (no recompute, no
* transition, no ledger row — `STALE → STALE` is not in the §10 table; a
* STALE PF stays STALE with its original first-difference reason until the
* Agent re-proposes or the user dismisses).
*
* stale is an INFORMATIONAL state (§5): nothing here blocks any user
* operation; SELECT refusal for STALE PFs is the WP-3.4 preface
* (`PF.status == OPEN` 前置 — INV-PLAN-8).
*
* Layer direction (ARCHITECTURE §2.2): service → domain/planfork (port +
* 状态机 + store seam) + git 具名 W 操作 (W3/W11) + shared/ids. No DSH
* imports (INV-PERM-5). No direct spawn (INV-GIT-6). No canonical writes
* (INV-PLAN-3 — this service only READS .research/).
*/
/** The stale-marking actor (§5: 判 stale 是插件的机械动作 — actor=PLUGIN). */
const STALE_ACTOR = { kind: "PLUGIN" };
var PlanForkStaleService = class {
	repoRoot;
	researchDir;
	store;
	planProvider;
	git;
	concurrency;
	constructor(options) {
		if (options === null || typeof options !== "object") throw new StaleServiceError("STALE_INPUT", "options must be an object (StaleServiceOptions)");
		if (typeof options.repoRoot !== "string" || options.repoRoot.length === 0) throw new StaleServiceError("STALE_INPUT", "repoRoot must be a non-empty string (the Git repository root containing .research/)");
		const researchDir = options.researchDir ?? ".research";
		if (typeof researchDir !== "string" || researchDir.length === 0 || researchDir === "." || researchDir === ".." || researchDir.startsWith("/") || researchDir.startsWith("..") || researchDir.includes("\0")) throw new StaleServiceError("STALE_INPUT", `researchDir must be a repo-root-relative directory name (default '.research'; got ${JSON.stringify(researchDir)})`);
		const concurrency = options.concurrency ?? 8;
		if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new StaleServiceError("STALE_INPUT", `concurrency must be a positive safe integer (default 8; got ${String(concurrency)})`);
		if (options.store === null || typeof options.store !== "object") throw new StaleServiceError("STALE_INPUT", "store is required (the WP-3.1 PlanForkStore face)");
		if (options.planProvider === null || typeof options.planProvider !== "object") throw new StaleServiceError("STALE_INPUT", "planProvider is required (the WP-3.1 CanonicalPlanProvider face)");
		this.repoRoot = options.repoRoot;
		this.researchDir = researchDir;
		this.store = options.store;
		this.planProvider = options.planProvider;
		this.git = options.git;
		this.concurrency = concurrency;
	}
	get gitOpts() {
		return {
			repoRoot: this.repoRoot,
			researchDir: this.researchDir,
			git: this.git,
			concurrency: this.concurrency
		};
	}
	/**
	* Capture the CURRENT canonical plan closure of `workstreamId` (§3.1
	* file set in stable order + §3.2 per-file working-copy blob OID via the
	* bounded W3 pool + informational HEAD). A workstream/plan that no longer
	* exists yields the EMPTY closure (no files to hash) — the caller
	* decides what that means; a missing closure FILE fails loud
	* (`STALE_CAPTURE`).
	*/
	async capturePlanClosure(workstreamId) {
		if (typeof workstreamId !== "string" || workstreamId.length === 0) throw new StaleServiceError("STALE_INPUT", "workstreamId must be a non-empty string (a WS id)");
		const view = this.planProvider.load(workstreamId);
		if (!view.workstream_exists || !view.present) return {
			workstreamId,
			wsDir: view.wsDir,
			paths: [],
			objects: []
		};
		const paths = closureRelativePaths(view.wsDir, view.ordered_items);
		const base = await captureGitClosureBase(this.gitOpts, paths);
		return {
			workstreamId,
			wsDir: view.wsDir,
			paths,
			objects: base.objects,
			...base.gitCommit !== void 0 ? { gitCommit: base.gitCommit } : {}
		};
	}
	/**
	* The production PF creation path (PLAN_FORK_SPEC §4 + §3.2):
	*
	* 1. **The pure §4 八步 chain FIRST** (with a recording placeholder
	*    capturer) — any §4 violation (steps 1–2 in particular) rejects with
	*    the EXACT frozen error priority before any git work happens (zero W3
	*    cost for invalid creations; a malformed plan never triggers a
	*    capture);
	* 2. the REAL git capture of exactly the closure step 3 used (W3 bounded
	*    pool + W11 HEAD) — failures throw `PF_BASE_CAPTURE` (step 3) exactly
	*    as the domain chain would;
	* 3. a shape re-verification that the canonical plan did not change
	*    between the (caller-supplied) view snapshot and the completed
	*    capture — a changed closure means the base no longer matches the
	*    validated plan ⇒ `PF_BASE_CAPTURE` (re-run creation);
	* 4. persist through the WP-3.1 store (which re-runs the chain with the
	*    real base and writes the PF_CREATED ledger row).
	*
	* The record's `base_plan_objects` / `base_git_commit` are thus always
	* server-side git recomputes (INV-PLAN-6 — no client base, structurally:
	* `CreatePlanForkParams` has no base key).
	*
	* `ctx` is the §4 creation context (policy / FRESH canonical plan view /
	* frozen schemas / resolvers / clock) — the service replaces ONLY
	* `ctx.baseCapturer`.
	*/
	async createPlanFork(params, ctx) {
		const view = ctx.plan;
		if (view === null || typeof view !== "object" || typeof view.wsDir !== "string" || !Array.isArray(view.ordered_items)) throw new StaleServiceError("STALE_INPUT", "ctx.plan is required (the fresh canonical plan view — §4 步骤 2)");
		let recordedWsDir = null;
		let recordedClosure = [];
		const recordingCapturer = { capture(wsDir, closure) {
			recordedWsDir = wsDir;
			recordedClosure = [...closure];
			return { objects: [{
				path: "placeholder",
				git_blob_oid: "0".repeat(40)
			}] };
		} };
		validatePlanForkCreation(params, {
			...ctx,
			baseCapturer: recordingCapturer
		});
		if (recordedWsDir === null) throw new StaleServiceError("STALE_INPUT", "internal: the §4 chain did not reach step-3 capture (creation must be invalid — investigate)");
		let base;
		try {
			base = await captureGitClosureBase(this.gitOpts, recordedClosure);
		} catch (cause) {
			throw new PlanForkError({
				code: "PF_BASE_CAPTURE",
				step: 3,
				message: `server-side closure base capture failed for ${JSON.stringify(view.workstream_id)} (${recordedClosure.length} closure files): ${cause instanceof Error ? cause.message : String(cause)} (PLAN_FORK_SPEC §4 步骤 3/§3.2; 基准永远重算, 不接受客户端提交 base — INV-PLAN-6)`,
				cause
			});
		}
		const fresh = this.planProvider.load(view.workstream_id);
		if (fresh.workstream_exists && fresh.present) {
			let freshClosure;
			try {
				freshClosure = closureRelativePaths(fresh.wsDir, fresh.ordered_items);
			} catch {
				freshClosure = closurePathsLenient(fresh.wsDir, fresh.ordered_items);
			}
			if (fresh.wsDir !== recordedWsDir || JSON.stringify(freshClosure) !== JSON.stringify(recordedClosure)) throw new PlanForkError({
				code: "PF_BASE_CAPTURE",
				step: 3,
				message: `the canonical plan changed during base capture (closure ${recordedClosure.length} → ${freshClosure.length} files) for ${JSON.stringify(view.workstream_id)} — re-run creation with a fresh plan view (INV-PLAN-6)`
			});
		}
		return this.store.createPlanFork(params, {
			...ctx,
			baseCapturer: withCapturedBase(base)
		});
	}
	/**
	* Check ONE PlanFork for basis staleness (PLAN_FORK_SPEC §5):
	*
	*   `stale(PF) ⇔ currentClosure(WS) ≠ PF.base_plan_objects`
	*
	*  - OPEN PF: recompute the current closure (fresh canonical plan view →
	*    §3.1 paths → bounded W3 rehash), set-compare with the base; a
	*    difference ⇒ `OPEN → STALE` (state-machine face: 乐观条件更新 +
	*    同事务 PF_STALE_MARKED 账本, actor=PLUGIN) + `stale_reason` = the
	*    first diff (path + old/new oid) + the full structured diff;
	*  - non-OPEN PF: NO-OP (idempotent — no recompute, no transition, no
	*    ledger row; the §10 table has no STALE→STALE edge);
	*  - git infrastructure failure: throw `STALE_GIT` — the check aborts
	*    with NO state change (fail loud — never guess staleness).
	*
	* The current closure when the plan is inconsistent (user mid-edit) is
	* computed LENIENTLY (plan.yaml + well-formed T/G/M elements only) — the
	* §5 set comparison then runs on the computable part (and plan.yaml's own
	* OID changed too, in practice). A vanished workstream/plan.yaml ⇒ empty
	* current set ⇒ every base entry is `removed` ⇒ stale.
	*/
	async checkStale(pfId) {
		if (typeof pfId !== "string" || pfId.length === 0) throw new StaleServiceError("STALE_INPUT", "pfId must be a non-empty string (a PF id)");
		const record = this.store.getPlanFork(pfId);
		if (record === null) throw new PlanForkError({
			code: "PF_NOT_FOUND",
			message: `plan fork ${JSON.stringify(pfId)} does not exist`
		});
		if (record.status !== "OPEN") return {
			pfId: record.id,
			workstreamId: record.workstream_id,
			statusBefore: record.status,
			statusAfter: record.status,
			stale: record.status === "STALE",
			markedStale: false,
			diff: [],
			currentClosure: []
		};
		const view = this.planProvider.load(record.workstream_id);
		let paths;
		if (!view.workstream_exists || !view.present) paths = [];
		else try {
			paths = closureRelativePaths(view.wsDir, view.ordered_items);
		} catch {
			paths = closurePathsLenient(view.wsDir, view.ordered_items);
		}
		let hashed;
		try {
			hashed = await hashClosure(this.gitOpts, paths);
		} catch (cause) {
			if (cause instanceof GitError) throw new StaleServiceError("STALE_GIT", `git recheck failed for ${JSON.stringify(record.workstream_id)}: ${cause.message} — no state change`, { cause });
			throw cause;
		}
		const diff = compareClosureBases(record.base_plan_objects, hashed.entries);
		const currentClosure = hashed.entries.filter((e) => e.oid !== null).map((e) => ({
			path: e.path,
			git_blob_oid: e.oid
		}));
		const commitPart = hashed.gitCommit !== void 0 ? { gitCommit: hashed.gitCommit } : {};
		if (diff.length === 0) return {
			pfId: record.id,
			workstreamId: record.workstream_id,
			statusBefore: "OPEN",
			statusAfter: "OPEN",
			stale: false,
			markedStale: false,
			diff: [],
			currentClosure,
			...commitPart
		};
		const reason = formatStaleReason(diff);
		const updated = this.store.transition(record.id, {
			to: "STALE",
			stale_reason: reason
		}, STALE_ACTOR);
		return {
			pfId: updated.id,
			workstreamId: updated.workstream_id,
			statusBefore: "OPEN",
			statusAfter: updated.status,
			stale: true,
			markedStale: true,
			diff,
			currentClosure,
			...commitPart
		};
	}
	/**
	* Sweep ALL OPEN PFs (optionally one workstream) through `checkStale`.
	* Runs sequentially in the store's stable order (created_at ASC, id ASC) —
	* deterministic, and per-PF closure hashing is already batched internally.
	* A per-PF failure (e.g. a concurrent DISMISS racing the sweep, a DB
	* fault) is COLLECTED in `failures`, never aborting the remaining PFs.
	*/
	async checkAllOpen(workstreamId) {
		if (workstreamId !== void 0 && (typeof workstreamId !== "string" || workstreamId.length === 0)) throw new StaleServiceError("STALE_INPUT", "workstreamId must be a non-empty string (or undefined to sweep all workstreams)");
		const open = this.store.listPlanForks(workstreamId === void 0 ? { status: "OPEN" } : {
			status: "OPEN",
			workstreamId
		});
		const outcomes = [];
		const failures = [];
		for (const rec of open) try {
			outcomes.push(await this.checkStale(rec.id));
		} catch (error) {
			failures.push({
				pfId: rec.id,
				error
			});
		}
		return {
			outcomes,
			failures
		};
	}
};
//#endregion
//#region src/host/service/runbinding/types.ts
/** The default user actor for GUI operations (matrix column U). */
const USER_ACTOR = {
	kind: "USER",
	label: "user"
};
/**
* Structured service error. `errors` carries the registry's
* `EventValidationError[]` for `RB_EVENT_REJECTED` (code+path+message,
* TC-DOM-027 style); `code` otherwise has no attached payload.
*/
var RunBindingError = class extends Error {
	code;
	/** Structured registry errors (RB_EVENT_REJECTED only). */
	errors;
	constructor(code, message, options) {
		super(message, options?.cause === void 0 ? void 0 : { cause: options.cause });
		this.name = "RunBindingError";
		this.code = code;
		this.errors = options?.errors;
	}
};
/** §5.1 RUN_STARTED — 「一个 Run 开始」(side effect: run 行, RUNNING). */
function buildRunStartedEvent(spec) {
	const payload = {
		run_id: spec.runId,
		initiated_by: spec.actor
	};
	if (spec.taskId !== void 0) payload.task_id = spec.taskId;
	if (spec.dshSessionId !== void 0) payload.dsh_session_id = spec.dshSessionId;
	if (spec.intent !== void 0) payload.intent = spec.intent;
	return {
		eventId: spec.eventId,
		ownerWorkstreamId: spec.workstreamId,
		eventType: "RUN_STARTED",
		schemaVersion: 1,
		occurredAt: spec.occurredAt,
		actor: spec.actor,
		...spec.dshSessionId === void 0 ? {} : { source: {
			kind: "DSH_SESSION",
			session_id: spec.dshSessionId
		} },
		payload
	};
}
/** §5.1 RUN_FINISHED — run must be RUNNING (implicit from). */
function buildRunFinishedEvent(spec, outcomeSummary) {
	const payload = { run_id: spec.runId };
	if (outcomeSummary !== void 0) payload.outcome_summary = outcomeSummary;
	return endEnvelope(spec, "RUN_FINISHED", payload);
}
/** §5.1 RUN_FAILED — run must be RUNNING (implicit from). */
function buildRunFailedEvent(spec, errorSummary, failureKind) {
	const payload = { run_id: spec.runId };
	if (errorSummary !== void 0) payload.error_summary = errorSummary;
	if (failureKind !== void 0) payload.failure_kind = failureKind;
	return endEnvelope(spec, "RUN_FAILED", payload);
}
/** §5.1 RUN_CANCELLED — run must be RUNNING; `cancelled_by` required. */
function buildRunCancelledEvent(spec, reason) {
	const payload = {
		run_id: spec.runId,
		cancelled_by: spec.actor
	};
	if (reason !== void 0) payload.reason = reason;
	return endEnvelope(spec, "RUN_CANCELLED", payload);
}
function endEnvelope(spec, eventType, payload) {
	return {
		eventId: spec.eventId,
		ownerWorkstreamId: spec.workstreamId,
		eventType,
		schemaVersion: 1,
		occurredAt: spec.occurredAt,
		actor: spec.actor,
		payload
	};
}
/**
* Assemble the `HistoryObjectContext` for RUN_* validation (module
* header). `tables` is read through its query face (a plain SELECT — no
* write path is touched, and this runs INSIDE the store transaction
* where that distinction matters least; the read sees the committed
* row state, which is exactly the state the event would mutate).
*/
function buildObjectContext(tables, external, options = {}) {
	const exclude = options.excludeRunIds ?? /* @__PURE__ */ new Set();
	const runs = /* @__PURE__ */ new Map();
	for (const run of tables.listAllRuns()) {
		if (exclude.has(run.id)) continue;
		runs.set(run.id, {
			workstreamId: run.workstream_id,
			status: run.status
		});
	}
	return {
		workstreams: external.workstreams,
		tasks: external.tasks,
		runs,
		claims: /* @__PURE__ */ new Map(),
		facts: /* @__PURE__ */ new Map(),
		artifacts: /* @__PURE__ */ new Map(),
		relations: /* @__PURE__ */ new Map(),
		gates: /* @__PURE__ */ new Map(),
		milestones: /* @__PURE__ */ new Map(),
		interventions: /* @__PURE__ */ new Map(),
		topologyEdges: /* @__PURE__ */ new Map()
	};
}
/**
* The store `validate` hook factory (WP-2.1 seam, AppendEventsOptions):
* validates EVERY event of the batch against the frozen registry
* (INV-HIST-4: unknown (eventType, schemaVersion) or payload violation
* → 拒绝写入) and THROWS a structured `RunBindingError`
* (RB_EVENT_REJECTED, registry's code+path+message list) on any failure
* — the store rolls the whole batch back (the thrown error is
* caller-owned and propagates unchanged, WP-2.1 contract).
*
* `registry` unusable (load errors) → RB_REGISTRY_UNUSABLE, fail loud
* (never append an unvalidated event).
*/
function makeValidateHook(registry, buildContext) {
	return (events) => {
		if (!registry.isUsable) throw new RunBindingError("RB_REGISTRY_UNUSABLE", `the event registry is unusable (load errors: ${registry.loadErrors.map((e) => e.code).join(", ")}); refusing to append an unvalidated event`);
		const ctx = buildContext();
		for (const event of events) {
			const result = validateEvent(registry, event, ctx);
			if (!result.ok) throw new RunBindingError("RB_EVENT_REJECTED", `${event.eventType} (${event.eventId}) rejected by the frozen registry: ` + result.errors.map((e) => `[${e.code}] ${e.message}`).join("; "), { errors: result.errors });
		}
	};
}
//#endregion
//#region src/host/service/runbinding/discovery.ts
/**
* WP-2.4 — DiscoveredSession discovery: cwd attribution + reconcile core.
*
* Frozen rule (DOMAIN_SCHEMA §6.2 L312, 计划书 §12.3):
*   「session 有显式 ResearchContext/workstream → 自动注册 Run；
*     位于注册 workspace 但无 context → DiscoveredSession；
*     外部 workspace → 忽略。」
*
* Attribution (DSH_ADAPTER §8 L168: 「SessionSummary.cwd 与
* WorkspaceView.path 的 canonical 相等比较（两边都经 host realpath
* canon；symlink 需归一后比)」): this module canonicalizes both sides
* (`realpathSync` when the path exists, `path.resolve` fallback for
* vanished directories — a session whose cwd was deleted must still
* attribute, not crash) and matches on CONTAINMENT: exact equality (the
* DSH workspace double-condition, §8 L164) or the session cwd being
* nested UNDER a registered root (「位于注册 workspace」 = located
* inside; a research session opened in a subdirectory of the research
* root is still inside it). The matched root (canonical) is what the DS
* row stores as `workspace_root`.
*
* `reconcileSessions` is the pull half of the discovery surface; the
* push half (lifecycle edges) is wired by the service's
* `startDiscovery` over the plugin-owned `DshSessionAdapter` port
* (DSH_ADAPTER §7 映射 / §11 item 2: `host/session-added` → 增量发现).
*
* Idempotency (TC-DSH-001/003): a session already carrying a DS row in
* ANY state (PENDING/BOUND/DETACHED/IGNORED) is never re-created or
* mutated — DETACH/IGNORE is 「防重复发现」 by construction, and BOUND
* rows must not drift. Reconcile therefore only ever INSERTS missing
* rows (PENDING, or straight BOUND under the U9 auto-registration seam).
*
* Pure logic over injected rows (no I/O here; the service performs the
* writes). The ResearchContext seam (`ResearchContextResolver`, types.ts)
* is the U9 定案 landing spot: V1 default = always null (fallback:
* 仅 DiscoveredSession + 手动 BIND, DSH_ADAPTER §13-U9).
*/
/**
* Canonicalize one path for attribution comparison: `realpathSync` when
* the path exists (symlink normalization per DSH_ADAPTER §8),
* `path.resolve` fallback otherwise (a deleted cwd still string-matches;
* a relative cwd is resolved against the process cwd — session cwds are
* absolute in practice, the fallback only keeps the function total).
*/
function canonicalizePath(p) {
	try {
		return realpathSync(p);
	} catch {
		return resolve(p);
	}
}
/**
* Match one session cwd against the registered workspace roots.
* @returns the canonical root the session is located in, or `null`
*   (no cwd / no root / external workspace → 忽略 per §6.2).
*/
function matchWorkspaceRoot(cwd, roots) {
	if (typeof cwd !== "string" || cwd.length === 0) return null;
	const canonicalCwd = canonicalizePath(cwd);
	for (const root of roots) {
		if (typeof root !== "string" || root.length === 0) continue;
		const canonicalRoot = canonicalizePath(root);
		if (canonicalCwd === canonicalRoot) return canonicalRoot;
		if (canonicalCwd.startsWith(canonicalRoot.endsWith(sep) ? canonicalRoot : canonicalRoot + sep)) return canonicalRoot;
	}
	return null;
}
function decideDiscovery(session, roots, resolver) {
	const root = matchWorkspaceRoot(session.cwd, roots);
	if (root === null) return { kind: "skip" };
	const context = resolver(session);
	if (context !== null) return {
		kind: "autoRegister",
		root,
		context
	};
	return {
		kind: "discover",
		root
	};
}
/** The default resolver: no ResearchContext channel in V1 (U9 fallback). */
const NO_RESEARCH_CONTEXT = () => null;
/**
* The workspace-root list the service attributes against (normalized:
* deduplicated, canonicalized at construction — callers may pass raw
* registered roots and never see a raw root echoed back).
*/
function normalizeWorkspaceRoots(roots) {
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const root of roots) {
		if (typeof root !== "string" || root.length === 0 || !isAbsolute(root)) continue;
		const c = canonicalizePath(root);
		if (!seen.has(c)) {
			seen.add(c);
			out.push(c);
		}
	}
	return out;
}
//#endregion
//#region src/host/service/runbinding/state-machine.ts
/**
* WP-2.4 — state machines for the two runbinding objects (frozen §13).
*
*  - Run: `RUNNING → FINISHED | FAILED | CANCELLED` (terminal) — the
*    frozen table already lives in the WP-2.2 registry
*    (`LEGAL_TRANSITIONS.run`, DOMAIN_SCHEMA §13 L549); this module
*    REUSES that single source for run-legality queries (no local copy —
*    drift is impossible) and wraps it in the service-facing check.
*  - DiscoveredSession: `PENDING → BOUND | DETACHED | IGNORED`
*    (terminal; after DETACH/IGNORE the same session is never
*    re-discovered — §13 L554 / TC-DSH-003). The DS machine has no
*    HistoryEvent (the DS row is an operational record, not a History
*    object), so the frozen §13 row is coded here; the state-machine
*    test pins the FULL 4×4 matrix against the §13 literal.
*
* Pure logic, zero I/O (layer: service-local domain logic; the service
* is the only layer that writes, and these helpers write nothing).
*/
/** The frozen legal targets of a run status (terminal ⇒ `[]`). */
function legalRunTargets(status) {
	return legalTargets$1("run", status);
}
/** True iff `from → to` is in the frozen §13 run row. */
function isLegalRunTransition(from, to) {
	return isLegalTransition("run", from, to);
}
/**
* The service-side guard for the three end operations: the current
* status must be RUNNING and the target must be its frozen legal
* terminal. Throws `RB_RUN_NOT_RUNNING` (service taxonomy) — the registry
* re-checks the implicit-from state at event validation (defense in depth).
*/
function assertRunCanBeEnded(current, target) {
	if (current !== "RUNNING") throw new RunBindingError("RB_RUN_NOT_RUNNING", `run is ${current}; only a RUNNING run can move to ${target} (DOMAIN_SCHEMA §13 L549: RUNNING → FINISHED|FAILED|CANCELLED, terminal)`);
	if (!isLegalRunTransition("RUNNING", target)) throw new RunBindingError("RB_RUN_NOT_RUNNING", `RUNNING → ${target} is not a legal §13 run transition (legal: ${legalRunTargets("RUNNING").join("|")})`);
}
/** The frozen §13 L554 DS row: PENDING → BOUND | DETACHED | IGNORED (terminal). */
const DS_TRANSITIONS = {
	PENDING: [
		"BOUND",
		"DETACHED",
		"IGNORED"
	],
	BOUND: [],
	DETACHED: [],
	IGNORED: []
};
/** True iff `from → to` is in the frozen §13 DS row. */
function isLegalDsTransition(from, to) {
	return DS_TRANSITIONS[from].includes(to);
}
/**
* The service-side guard for BIND/DETACH/IGNORE: the row must be PENDING
* (all three frozen targets leave PENDING; every other state is
* terminal — §13 L554, TC-DSH-003). Throws `RB_DS_NOT_PENDING`.
*/
function assertDsCanMove(current, target) {
	if (!isLegalDsTransition(current, target)) throw new RunBindingError("RB_DS_NOT_PENDING", `DiscoveredSession is ${current}; only PENDING can move to ${target} (DOMAIN_SCHEMA §13 L554: PENDING → BOUND|DETACHED|IGNORED, terminal — no re-discovery after DETACH/IGNORE)`);
}
//#endregion
//#region src/host/service/runbinding/service.ts
/** The default actor label for PLUGIN-emitted (auto-registration) events. */
const PLUGIN_ACTOR_LABEL = "research-control";
/**
* The Run binding + DiscoveredSession service (module header = full
* operation/order/discovery contract). All methods are synchronous
* (node:sqlite); failures are structured `RunBindingError`s.
*/
var RunBindingService = class {
	#store;
	#tables;
	#registry;
	#allocator;
	#projectId;
	#roots;
	#external;
	#resolver;
	#now;
	#onWorkstreamRealized;
	constructor(options) {
		assertNonEmptyString(options.projectId, "projectId");
		if (options.store === void 0 || typeof options.store.appendEvents !== "function") throw new RunBindingError("RB_INPUT", "store: a WP-2.1 ResearchStore is required");
		if (options.tables === void 0 || typeof options.tables.transaction !== "function") throw new RunBindingError("RB_INPUT", "tables: the runbinding table face is required");
		if (options.registry === void 0) throw new RunBindingError("RB_INPUT", "registry: the WP-2.2 event registry is required");
		if (options.allocator === void 0 || typeof options.allocator.reserve !== "function") throw new RunBindingError("RB_INPUT", "allocator: the shared IdAllocator is required");
		this.#store = options.store;
		this.#tables = options.tables;
		this.#registry = options.registry;
		this.#allocator = options.allocator;
		this.#projectId = options.projectId;
		this.#roots = normalizeWorkspaceRoots(options.workspaceRoots ?? []);
		this.#external = options.externalState ?? (() => ({
			workstreams: /* @__PURE__ */ new Map(),
			tasks: /* @__PURE__ */ new Map()
		}));
		this.#resolver = options.researchContextResolver ?? NO_RESEARCH_CONTEXT;
		this.#now = options.now ?? Date.now;
		this.#onWorkstreamRealized = options.onWorkstreamRealized;
	}
	/**
	* The push discovery surface (module header): an initial full
	* reconcile over `adapter.listSessions()`, then a subscription to the
	* store lifecycle edges — on each `created` edge a full reconcile runs
	* (a `disposed` edge changes nothing: DS rows persist, and reconcile
	* only ever inserts). Returns the composed disposer (reversible
	* registration, cordis convention — the host wiring disposes it on
	* fiber unmount).
	*/
	startDiscovery(adapter) {
		if (adapter === void 0 || typeof adapter.observeSessionLifecycle !== "function") throw new RunBindingError("RB_INPUT", "startDiscovery: a DshSessionAdapter is required");
		this.reconcileSessions(adapter.listSessions());
		return adapter.observeSessionLifecycle((event) => {
			if (event.kind !== "created") return;
			this.reconcileSessions(adapter.listSessions());
		});
	}
	/**
	* The pull discovery surface (§6.2 规则, module header). Returns the
	* DS rows created/registered by THIS reconcile (empty = nothing new —
	* idempotent re-runs). Throws `RB_INPUT` on a malformed session row.
	*/
	reconcileSessions(sessions) {
		if (!Array.isArray(sessions)) throw new RunBindingError("RB_INPUT", "reconcileSessions: sessions must be an array");
		const created = [];
		for (const session of sessions) {
			if (typeof session?.id !== "string" || session.id.length === 0) throw new RunBindingError("RB_INPUT", "reconcileSessions: every session row needs a non-empty id");
			if (this.#tables.getDiscoveredSessionBySessionId(session.id) !== null) continue;
			const decision = decideDiscovery(session, this.#roots, this.#resolver);
			if (decision.kind === "skip") continue;
			if (decision.kind === "discover") created.push(this.#discover(session, decision.root));
			else created.push(this.#autoRegister(session, decision.root, decision.context));
		}
		return created;
	}
	listDiscoveredSessions(filter = {}) {
		return this.#tables.listDiscoveredSessions(filter);
	}
	getDiscoveredSession(id) {
		assertNonEmptyString(id, "id");
		return this.#tables.getDiscoveredSession(id);
	}
	findDiscoveredSessionBySessionId(dshSessionId) {
		assertNonEmptyString(dshSessionId, "dshSessionId");
		return this.#tables.getDiscoveredSessionBySessionId(dshSessionId);
	}
	/**
	* The user's explicit BIND (§6.2): PENDING → BOUND + a formal Run +
	* RUN_STARTED (emitter matrix U). One DS : one run (the flip is gated
	* on PENDING; a second concurrent BIND loses the gate and its
	* RUN_STARTED remains a valid History entry — module header ②/③ note).
	*/
	bindDiscoveredSession(dsId, params, actor = USER_ACTOR) {
		assertUserActor$1(actor, "bindDiscoveredSession");
		assertNonEmptyString(dsId, "dsId");
		if (params === void 0 || typeof params !== "object") throw new RunBindingError("RB_INPUT", "bindDiscoveredSession: params are required");
		const ds = this.#tables.getDiscoveredSession(dsId);
		if (ds === null) throw new RunBindingError("RB_DS_NOT_FOUND", `no DiscoveredSession with id ${dsId}`);
		assertDsCanMove(ds.state, "BOUND");
		const { workstreamId, taskId } = this.#checkWorkstreamAndTask(params.workstreamId, params.taskId);
		if (this.#tables.getRunBySessionId(ds.dsh_session_id) !== null) throw new RunBindingError("RB_SESSION_ALREADY_BOUND", `session ${ds.dsh_session_id} already has a formal run; one DS : one run (DOMAIN_SCHEMA §6.2)`);
		const occurredAt = this.#now();
		const runReservation = this.#allocator.reserve("RUN", this.#projectId);
		const eventReservation = this.#allocator.reserve("HISTORY_EVENT", this.#projectId);
		const run = {
			id: runReservation.id,
			workstream_id: workstreamId,
			status: "RUNNING",
			initiated_by: actor,
			started_at: occurredAt,
			dsh_session_id: ds.dsh_session_id,
			...params.taskId === void 0 ? {} : { task_id: params.taskId },
			...params.intent === void 0 ? {} : { intent: params.intent }
		};
		const event = buildRunStartedEvent({
			eventId: eventReservation.id,
			runId: run.id,
			workstreamId,
			...params.taskId === void 0 ? {} : { taskId: params.taskId },
			dshSessionId: ds.dsh_session_id,
			...params.intent === void 0 ? {} : { intent: params.intent },
			actor,
			occurredAt
		});
		const appended = this.#appendRunEvent(event, workstreamId);
		try {
			this.#tables.transaction(() => {
				if (this.#tables.transitionDiscoveredSession(dsId, "PENDING", "BOUND", run.id) === 0) throw new RunBindingError("RB_DS_NOT_PENDING", `DiscoveredSession ${dsId} left PENDING concurrently (state moved); the bind lost the gate`);
				this.#tables.insertRun(run);
			});
		} catch (e) {
			this.#allocator.commit(eventReservation);
			this.#allocator.release(runReservation);
			throw e;
		}
		this.#allocator.commit(runReservation);
		const boundDs = this.#tables.getDiscoveredSession(dsId);
		const boundRun = this.#tables.getRun(run.id);
		if (boundDs === null || boundRun === null) throw new RunBindingError("RB_TABLE", `bind ${dsId}: row projection not readable back after commit`);
		return {
			ds: boundDs,
			run: boundRun,
			event: appended
		};
	}
	/**
	* DETACH (§6.2): PENDING → DETACHED — 移出范围, 原 DSH session 保留.
	* Row-only (no RUN_* event exists for a PENDING DS — module header).
	* After DETACH the session is never re-discovered (TC-DSH-003).
	*/
	detachDiscoveredSession(dsId, actor = USER_ACTOR) {
		assertUserActor$1(actor, "detachDiscoveredSession");
		assertNonEmptyString(dsId, "dsId");
		const ds = this.#tables.getDiscoveredSession(dsId);
		if (ds === null) throw new RunBindingError("RB_DS_NOT_FOUND", `no DiscoveredSession with id ${dsId}`);
		assertDsCanMove(ds.state, "DETACHED");
		if (this.#tables.transitionDiscoveredSession(ds.id, "PENDING", "DETACHED") === 0) throw new RunBindingError("RB_DS_NOT_PENDING", `DiscoveredSession ${dsId} left PENDING concurrently`);
		const updated = this.#tables.getDiscoveredSession(dsId);
		if (updated === null) throw new RunBindingError("RB_TABLE", `detach ${dsId}: row not readable back`);
		return updated;
	}
	/**
	* IGNORE (§6.2): PENDING → IGNORED — 防重复发现. Row-only (no event).
	* After IGNORE the session is never re-discovered (TC-DSH-003).
	*/
	ignoreDiscoveredSession(dsId, actor = USER_ACTOR) {
		assertUserActor$1(actor, "ignoreDiscoveredSession");
		assertNonEmptyString(dsId, "dsId");
		const ds = this.#tables.getDiscoveredSession(dsId);
		if (ds === null) throw new RunBindingError("RB_DS_NOT_FOUND", `no DiscoveredSession with id ${dsId}`);
		assertDsCanMove(ds.state, "IGNORED");
		if (this.#tables.transitionDiscoveredSession(ds.id, "PENDING", "IGNORED") === 0) throw new RunBindingError("RB_DS_NOT_PENDING", `DiscoveredSession ${dsId} left PENDING concurrently`);
		const updated = this.#tables.getDiscoveredSession(dsId);
		if (updated === null) throw new RunBindingError("RB_TABLE", `ignore ${dsId}: row not readable back`);
		return updated;
	}
	/**
	* Manual formal-Run registration (matrix U 手工登记): no DS involved —
	* for runs the user records directly (an optional DSH session pointer,
	* INV-DB-2: pointer only, and the session must NOT already be inside
	* the control-plane scope — scoped sessions go through BIND).
	*/
	registerRun(params, actor = USER_ACTOR) {
		if (params === void 0 || typeof params !== "object") throw new RunBindingError("RB_INPUT", "registerRun: params are required");
		const { workstreamId, taskId } = this.#checkWorkstreamAndTask(params.workstreamId, params.taskId);
		if (params.dshSessionId !== void 0) {
			assertNonEmptyString(params.dshSessionId, "params.dshSessionId");
			const existingDs = this.#tables.getDiscoveredSessionBySessionId(params.dshSessionId);
			if (existingDs !== null) throw new RunBindingError("RB_SESSION_IN_SCOPE", `session ${params.dshSessionId} is inside the control-plane scope (DiscoveredSession ${existingDs.id}, state ${existingDs.state}); use the DS lifecycle (BIND), not registerRun (DOMAIN_SCHEMA §6.2)`);
			if (this.#tables.getRunBySessionId(params.dshSessionId) !== null) throw new RunBindingError("RB_SESSION_ALREADY_BOUND", `session ${params.dshSessionId} already has a formal run`);
		}
		const occurredAt = this.#now();
		const runReservation = this.#allocator.reserve("RUN", this.#projectId);
		const eventReservation = this.#allocator.reserve("HISTORY_EVENT", this.#projectId);
		const run = {
			id: runReservation.id,
			workstream_id: workstreamId,
			status: "RUNNING",
			initiated_by: actor,
			started_at: occurredAt,
			...taskId === void 0 ? {} : { task_id: taskId },
			...params.dshSessionId === void 0 ? {} : { dsh_session_id: params.dshSessionId },
			...params.intent === void 0 ? {} : { intent: params.intent }
		};
		const event = buildRunStartedEvent({
			eventId: eventReservation.id,
			runId: run.id,
			workstreamId,
			...taskId === void 0 ? {} : { taskId },
			...params.dshSessionId === void 0 ? {} : { dshSessionId: params.dshSessionId },
			...params.intent === void 0 ? {} : { intent: params.intent },
			actor,
			occurredAt
		});
		const appended = this.#appendRunEvent(event, workstreamId);
		try {
			this.#tables.insertRun(run);
		} catch (e) {
			this.#allocator.commit(eventReservation);
			this.#allocator.release(runReservation);
			throw e;
		}
		this.#allocator.commit(runReservation);
		const storedRun = this.#tables.getRun(run.id);
		if (storedRun === null) throw new RunBindingError("RB_TABLE", `registerRun: run ${run.id} not readable back`);
		return {
			run: storedRun,
			event: appended
		};
	}
	/** Finish a RUNNING run → RUN_FINISHED (§5.1; side effect: status, ended_at). */
	finishRun(runId, params = {}, actor = USER_ACTOR) {
		return this.#endRun(runId, "FINISHED", actor, (spec) => buildRunFinishedEvent(spec, params.outcomeSummary));
	}
	/** Fail a RUNNING run → RUN_FAILED (§5.1; optional error_summary/failure_kind). */
	failRun(runId, params = {}, actor = USER_ACTOR) {
		return this.#endRun(runId, "FAILED", actor, (spec) => buildRunFailedEvent(spec, params.errorSummary, params.failureKind));
	}
	/** Cancel a RUNNING run → RUN_CANCELLED (§5.1; `cancelled_by` = actor). */
	cancelRun(runId, params = {}, actor = USER_ACTOR) {
		return this.#endRun(runId, "CANCELLED", actor, (spec) => buildRunCancelledEvent(spec, params.reason));
	}
	/**
	* §6.1 `last_checkpoint_*` update — the operational backing store of
	* the future `research_run_checkpoint` agent tool (matrix row: AGENT
	* 「checkpoint 报告触发」). NO History event (a checkpoint is an
	* operational note; the chronicle records Run boundaries only).
	* USER-or-AGENT actors (PLUGIN/SYSTEM are not checkpoint reporters).
	*/
	recordCheckpoint(runId, params = {}, actor = USER_ACTOR) {
		assertUserOrAgentActor(actor, "recordCheckpoint");
		assertNonEmptyString(runId, "runId");
		if (this.#tables.getRun(runId) === null) throw new RunBindingError("RB_RUN_NOT_FOUND", `no run with id ${runId}`);
		const at = this.#now();
		if (this.#tables.updateRunCheckpoint(runId, at, params.note) === 0) throw new RunBindingError("RB_RUN_NOT_FOUND", `run ${runId} disappeared concurrently`);
		const updated = this.#tables.getRun(runId);
		if (updated === null) throw new RunBindingError("RB_TABLE", `recordCheckpoint ${runId}: row not readable back`);
		return updated;
	}
	getRun(runId) {
		assertNonEmptyString(runId, "runId");
		return this.#tables.getRun(runId);
	}
	listRuns(filter = {}) {
		return this.#tables.listRuns(filter);
	}
	/**
	* One RUN_* end: pre-validation (§13 L549 via the state machine;
	* refs), then ② append (registry-validated in-transaction) and ③ the
	* CONDITIONAL row update (`WHERE status='RUNNING'` — the sequential
	* double-end gate: the first end flips the row, the second pre-check
	* already fails; a true concurrent double-end leaves the extra event
	* in History — module header residual).
	*/
	#endRun(runId, target, actor, build) {
		assertNonEmptyString(runId, "runId");
		const run = this.#tables.getRun(runId);
		if (run === null) throw new RunBindingError("RB_RUN_NOT_FOUND", `no run with id ${runId}`);
		assertRunCanBeEnded(run.status, target);
		const occurredAt = this.#now();
		const eventReservation = this.#allocator.reserve("HISTORY_EVENT", this.#projectId);
		const event = build({
			eventId: eventReservation.id,
			runId: run.id,
			workstreamId: run.workstream_id,
			actor,
			occurredAt
		});
		const appended = this.#appendRunEvent(event, run.workstream_id);
		const summary = target === "FINISHED" ? event.payload.outcome_summary : void 0;
		if (this.#tables.updateRunStatus(run.id, target, occurredAt, summary) === 0) {
			this.#allocator.commit(eventReservation);
			throw new RunBindingError("RB_RUN_NOT_RUNNING", `run ${runId} left RUNNING concurrently (state moved); the ${event.eventType} event was recorded but the row update was refused`);
		}
		this.#allocator.commit(eventReservation);
		const updated = this.#tables.getRun(run.id);
		if (updated === null) throw new RunBindingError("RB_TABLE", `${event.eventType} ${runId}: row not readable back`);
		return {
			run: updated,
			event: appended
		};
	}
	/**
	* ② — the event append half of every event-producing operation:
	* registry-validated INSIDE the store write transaction
	* (`AppendEventsOptions.validate` — WP-2.1 seam; INV-HIST-4), with the
	* PLANNED→REALIZED atomic-realize hooks when the owner workstream is
	* PLANNED (TC-DOM-033 persistence half; the declarative file half is
	* the `onWorkstreamRealized` seam, wired by WP-2.6).
	*
	* Error discipline: `RunBindingError`s (including the registry
	* rejection raised by the validate hook — caller-owned per the WP-2.1
	* contract) propagate UNCHANGED; store-level failures are wrapped
	* RB_STORE.
	*/
	#appendRunEvent(event, ownerWorkstreamId) {
		const realize = this.#realizeHooksFor(ownerWorkstreamId);
		const validate = makeValidateHook(this.#registry, () => buildObjectContext(this.#tables, this.#external()));
		try {
			return this.#store.appendEvents([event], {
				validate,
				...realize === void 0 ? {} : { realize }
			}).events[0];
		} catch (e) {
			if (e instanceof RunBindingError) throw e;
			if (e instanceof StoreError) throw new RunBindingError("RB_STORE", `${event.eventType}: ${e.message}`, { cause: e });
			throw e;
		}
	}
	/**
	* TC-DOM-033 persistence half: when the owner workstream is PLANNED,
	* the store fires the hooks (inside its write transaction) exactly
	* once — only if this batch carries that WS's FIRST event. The
	* service writes the workstream-lifecycle derived_state row (the
	* §15 L627「workstream lifecycle」derived cache) and notifies the
	* declarative half (`onWorkstreamRealized` — workstream.yaml flip,
	* WP-1.1 loader, wired by WP-2.6).
	*/
	#realizeHooksFor(workstreamId) {
		const ws = this.#external().workstreams.get(workstreamId);
		if (ws === void 0 || ws.lifecycle !== "PLANNED") return void 0;
		return {
			workstreamIds: [workstreamId],
			apply: (context) => {
				context.tx.setDerivedState("workstream", context.workstreamId, {
					topicId: ws.topicId,
					lifecycle: "REALIZED"
				});
				this.#onWorkstreamRealized?.(context.workstreamId);
			}
		};
	}
	/** §6.2 规则 2 — a PENDING DS row (manual-BIND fallback lane). */
	#discover(session, root) {
		const reservation = this.#allocator.reserve("DISCOVERED_SESSION", this.#projectId);
		const record = {
			id: reservation.id,
			dsh_session_id: session.id,
			workspace_root: root,
			discovered_at: this.#now(),
			state: "PENDING",
			...session.title === void 0 || session.title.length === 0 ? {} : { summary: session.title }
		};
		try {
			this.#tables.insertDiscoveredSession(record);
		} catch (e) {
			this.#allocator.release(reservation);
			throw e;
		}
		this.#allocator.commit(reservation);
		return record;
	}
	/**
	* §6.2 规则 1 — explicit ResearchContext → 自动注册 Run (matrix P,
	* 「session 绑定自动登记」): a BOUND DS row + a formal Run + a
	* RUN_STARTED with a PLUGIN actor, ONE table transaction for the rows.
	* V1-dormant: the default resolver never fires (U9 fallback) — the
	* seam exists so a future carrier activates this path without a
	* service API change.
	*/
	#autoRegister(session, root, context) {
		const { workstreamId, taskId } = this.#checkWorkstreamAndTask(context.workstreamId, context.taskId);
		const actor = {
			kind: "PLUGIN",
			label: PLUGIN_ACTOR_LABEL
		};
		const occurredAt = this.#now();
		const runReservation = this.#allocator.reserve("RUN", this.#projectId);
		const eventReservation = this.#allocator.reserve("HISTORY_EVENT", this.#projectId);
		const dsReservation = this.#allocator.reserve("DISCOVERED_SESSION", this.#projectId);
		const run = {
			id: runReservation.id,
			workstream_id: workstreamId,
			status: "RUNNING",
			initiated_by: actor,
			started_at: occurredAt,
			dsh_session_id: session.id,
			...taskId === void 0 ? {} : { task_id: taskId },
			...context.intent === void 0 ? {} : { intent: context.intent }
		};
		const event = buildRunStartedEvent({
			eventId: eventReservation.id,
			runId: run.id,
			workstreamId,
			...taskId === void 0 ? {} : { taskId },
			dshSessionId: session.id,
			...context.intent === void 0 ? {} : { intent: context.intent },
			actor,
			occurredAt
		});
		this.#appendRunEvent(event, workstreamId);
		try {
			this.#tables.transaction(() => {
				this.#tables.insertRun(run);
				this.#tables.insertDiscoveredSession({
					id: dsReservation.id,
					dsh_session_id: session.id,
					workspace_root: root,
					discovered_at: occurredAt,
					state: "BOUND",
					bound_run_id: run.id,
					...session.title === void 0 || session.title.length === 0 ? {} : { summary: session.title }
				});
			});
		} catch (e) {
			this.#allocator.commit(eventReservation);
			this.#allocator.release(runReservation);
			this.#allocator.release(dsReservation);
			throw e;
		}
		this.#allocator.commit(runReservation);
		this.#allocator.commit(dsReservation);
		const ds = this.#tables.getDiscoveredSession(dsReservation.id);
		if (ds === null) throw new RunBindingError("RB_TABLE", `auto-register: DS row ${dsReservation.id} not readable back`);
		return ds;
	}
	/** Owner-workstream + task reference checks (catalog §5.1 通用校验). */
	#checkWorkstreamAndTask(workstreamId, taskId) {
		assertNonEmptyString(workstreamId, "workstreamId");
		const external = this.#external();
		if (!external.workstreams.has(workstreamId)) throw new RunBindingError("RB_WORKSTREAM_NOT_FOUND", `workstream ${workstreamId} does not exist (DOMAIN_SCHEMA §6.1: Formal Run 必须绑定 Workstream; catalog §5: ownerWorkstreamId 存在)`);
		if (taskId === void 0) return { workstreamId };
		assertNonEmptyString(taskId, "taskId");
		const task = external.tasks.get(taskId);
		if (task === void 0) throw new RunBindingError("RB_TASK_NOT_FOUND", `task ${taskId} does not exist (catalog §5.1: 存在)`);
		if (task.workstreamId !== workstreamId) throw new RunBindingError("RB_TASK_WS_MISMATCH", `task ${taskId} belongs to workstream ${task.workstreamId}, not ${workstreamId} (catalog §5.1: 属同 WS)`);
		return {
			workstreamId,
			taskId
		};
	}
};
function assertUserActor$1(actor, operation) {
	if (typeof actor?.kind !== "string" || actor.kind !== "USER") throw new RunBindingError("RB_ACTOR_FORBIDDEN", `${operation}: requires a USER actor (DOMAIN_SCHEMA §6.2 「用户 BIND/DETACH/IGNORE」; ARCHITECTURE §6: no agent lane for session-binding operations) — got ${describeActor(actor)}`);
}
function assertUserOrAgentActor(actor, operation) {
	if (typeof actor?.kind !== "string" || actor.kind !== "USER" && actor.kind !== "AGENT") throw new RunBindingError("RB_ACTOR_FORBIDDEN", `${operation}: requires a USER or AGENT actor (ARCHITECTURE §6 row 「Run 生命周期事件」: checkpoint 报告 = agent lane) — got ${describeActor(actor)}`);
}
function describeActor(actor) {
	if (typeof actor === "object" && actor !== null && "kind" in actor) return `kind=${String(actor.kind)}`;
	return String(actor);
}
function assertNonEmptyString(value, what) {
	if (typeof value !== "string" || value.length === 0) throw new RunBindingError("RB_INPUT", `${what} must be a non-empty string`);
}
const DISCOVERED_SESSION_TABLE = "discovered_session";
const RUN_DDL = `
CREATE TABLE IF NOT EXISTS run (
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
  ON run (workstream_id, started_at);
CREATE INDEX IF NOT EXISTS idx_run_dsh_session
  ON run (dsh_session_id);
-- INV-HIST-7 存储层半边: 一等 identity 行不 hard delete (raw SQL 也拒绝)。
CREATE TRIGGER IF NOT EXISTS run_no_delete
  BEFORE DELETE ON run
  BEGIN
    SELECT RAISE(ABORT, 'run rows are first-class identity and cannot be hard-deleted (INV-HIST-7)');
  END;
`;
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
`;
/** Full runbinding V1 DDL (idempotent; executed on the second connection). */
function runBindingDdl() {
	return [RUN_DDL, DISCOVERED_SESSION_DDL].join("\n");
}
/** Serialize a run record to a parameter list (insert). */
function runToParams(run) {
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
		run.last_checkpoint_note ?? null
	];
}
/** Serialize a DS record to a parameter list (insert). */
function discoveredSessionToParams(ds) {
	return [
		ds.id,
		ds.dsh_session_id,
		ds.workspace_root,
		ds.discovered_at,
		ds.state,
		ds.bound_run_id ?? null,
		ds.summary ?? null
	];
}
/** `run` row → `RunRecord` (frozen schema keys; optional keys dropped when NULL). */
function rowToRun(row) {
	return withOptional({
		id: str$1(row, "run_id"),
		workstream_id: str$1(row, "workstream_id"),
		status: str$1(row, "status"),
		initiated_by: parseActor(str$1(row, "initiated_by")),
		started_at: int(row, "started_at")
	}, row);
}
function withOptional(base, row) {
	const out = base;
	const taskId = opt(row, "task_id");
	if (taskId !== null) out.task_id = taskId;
	const sessionId = opt(row, "dsh_session_id");
	if (sessionId !== null) out.dsh_session_id = sessionId;
	const intent = opt(row, "intent");
	if (intent !== null) out.intent = intent;
	const endedAt = optInt(row, "ended_at");
	if (endedAt !== null) out.ended_at = endedAt;
	const summary = opt(row, "summary");
	if (summary !== null) out.summary = summary;
	const checkpointAt = optInt(row, "last_checkpoint_at");
	if (checkpointAt !== null) out.last_checkpoint_at = checkpointAt;
	const checkpointNote = opt(row, "last_checkpoint_note");
	if (checkpointNote !== null) out.last_checkpoint_note = checkpointNote;
	return out;
}
/** `discovered_session` row → `DiscoveredSessionRecord`. */
function rowToDiscoveredSession(row) {
	const out = {
		id: str$1(row, "id"),
		dsh_session_id: str$1(row, "dsh_session_id"),
		workspace_root: str$1(row, "workspace_root"),
		discovered_at: int(row, "discovered_at"),
		state: str$1(row, "state")
	};
	const boundRunId = opt(row, "bound_run_id");
	if (boundRunId !== null) out.bound_run_id = boundRunId;
	const summary = opt(row, "summary");
	if (summary !== null) out.summary = summary;
	return out;
}
function actorToJson(actor) {
	return JSON.stringify(actor);
}
function parseActor(json) {
	const value = JSON.parse(json);
	if (typeof value !== "object" || value === null) throw new Error("run.initiated_by is not a JSON object — database corruption");
	return value;
}
function str$1(row, key) {
	const v = row[key];
	if (typeof v !== "string") throw new Error(`${key} is not a string — database corruption`);
	return v;
}
function int(row, key) {
	const v = row[key];
	if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new Error(`${key} is not an integer — database corruption`);
	return v;
}
function opt(row, key) {
	const v = row[key];
	if (v === null || v === void 0) return null;
	if (typeof v !== "string") throw new Error(`${key} is not a string/null — database corruption`);
	return v;
}
function optInt(row, key) {
	const v = row[key];
	if (v === null || v === void 0) return null;
	if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new Error(`${key} is not an integer/null — database corruption`);
	return v;
}
//#endregion
//#region src/host/service/runbinding/tables.ts
/**
* WP-2.4 — runbinding tables: the `run` + `discovered_session` table face.
*
* DB access follows the persistence/store pattern (task boundary: 「DB 访问
* 经 persistence/store 模式自建表或复用其 DatabaseSync 封装（表定义放本目录，
* openDatabase 复用）」):
*
*   1. `openRunBindingDatabase(path)` FIRST calls the WP-2.1
*      `openDatabase` wrapper — the file init (owner-only 0o700/0o600),
*      the WAL setup, the `user_version` gate and the quick_check
*      corruption probe all belong to that wrapper, exactly as for the
*      core three tables;
*   2. it then opens a SECOND `node:sqlite` `DatabaseSync` connection on
*      the SAME file and applies this WP's DDL (schema.ts: §15 L615-616
*      `run` / `discovered_session`, idempotent `IF NOT EXISTS` —
*      pre-release does no migrations);
*   3. the two connections coexist in WAL mode: the store connection
*      owns the append-only event transaction, this connection owns the
*      run/DS row transactions; writes serialize on the file lock
*      (`busy_timeout` set here, mirroring the store's default).
*
* Two-connection write ordering (documented service contract, see
* service.ts 「event-vs-row order」): History events are the 真源
* (INV-TZ-1) and the run/DS rows are operational projections — the
* service orders writes so that every failure mode converges by replay
* rebuild (TC-HIST-006 semantics) rather than by a cross-connection
* transaction (SQLite offers none).
*
* INV-HIST-7 存储层半边: no DELETE method on either table — and the
* schema triggers ABORT raw DELETE even through another connection.
* No DSH imports (INV-PERM-5).
*/
/** The busy timeout for the second connection (same default as the store). */
const DEFAULT_BUSY_TIMEOUT_MS = 5e3;
/**
* Open only the table face on an EXISTING file that a WP-2.1
* `openDatabase` call already validated (service-level composition when
* the caller owns the store handle; tests use `openRunBindingDatabase`).
*/
function openRunBindingTables(path, options = {}) {
	const db = openTablesConnection(resolve(path), options.busyTimeoutMs);
	return makeTables(resolve(path), db);
}
function openTablesConnection(abs, busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS) {
	let db;
	try {
		db = new DatabaseSync(abs);
	} catch (e) {
		throw toTableError(`openRunBindingTables: cannot open ${abs}`, e);
	}
	try {
		assertPositiveInt(busyTimeoutMs, "busyTimeoutMs");
		db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
		db.exec(runBindingDdl());
	} catch (e) {
		try {
			db.close();
		} catch {}
		throw toTableError(`openRunBindingTables: DDL at ${abs}`, e);
	}
	return db;
}
function makeTables(path, db) {
	let closed = false;
	const assertOpen = (operation) => {
		if (closed) throw new RunBindingError("RB_TABLE", `${operation}: runbinding tables are closed (file ${path})`);
		return db;
	};
	const prepare = (operation, sql) => assertOpen(operation).prepare(sql);
	const selectOne = (operation, sql, param) => {
		const row = prepare(operation, sql).get(param);
		return row === void 0 ? void 0 : row;
	};
	const selectMany = (operation, sql, params = []) => {
		return prepare(operation, sql).all(...params);
	};
	const close = () => {
		if (closed) return;
		closed = true;
		try {
			db.close();
		} catch {}
	};
	return {
		path,
		close,
		insertRun(run) {
			const params = runToParams(run);
			try {
				prepare("insertRun", `INSERT INTO run (run_id, workstream_id, task_id, dsh_session_id, status, intent, initiated_by, started_at, ended_at, summary, last_checkpoint_at, last_checkpoint_note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...params);
			} catch (e) {
				throw toTableError(`insertRun(${run.id})`, e);
			}
		},
		updateRunStatus(runId, status, endedAt, summary) {
			try {
				const r = summary === void 0 ? prepare("updateRunStatus", `UPDATE run SET status = ?, ended_at = ?, summary = summary WHERE run_id = ? AND status = 'RUNNING'`).run(status, endedAt, runId) : prepare("updateRunStatus", `UPDATE run SET status = ?, ended_at = ?, summary = ? WHERE run_id = ? AND status = 'RUNNING'`).run(status, endedAt, summary, runId);
				return Number(r.changes);
			} catch (e) {
				throw toTableError(`updateRunStatus(${runId})`, e);
			}
		},
		updateRunCheckpoint(runId, at, note) {
			try {
				const r = note === void 0 ? prepare("updateRunCheckpoint", `UPDATE run SET last_checkpoint_at = ? WHERE run_id = ?`).run(at, runId) : prepare("updateRunCheckpoint", `UPDATE run SET last_checkpoint_at = ?, last_checkpoint_note = ? WHERE run_id = ?`).run(at, note, runId);
				return Number(r.changes);
			} catch (e) {
				throw toTableError(`updateRunCheckpoint(${runId})`, e);
			}
		},
		getRun(runId) {
			const row = selectOne("getRun", `SELECT * FROM run WHERE run_id = ?`, runId);
			return row === void 0 ? null : rowToRun(row);
		},
		getRunBySessionId(dshSessionId) {
			const row = selectOne("getRunBySessionId", `SELECT * FROM run WHERE dsh_session_id = ? ORDER BY started_at DESC, run_id DESC LIMIT 1`, dshSessionId);
			return row === void 0 ? null : rowToRun(row);
		},
		listRuns(filter) {
			const clauses = [];
			const params = [];
			if (filter.workstreamId !== void 0) {
				assertNonEmpty(filter.workstreamId, "filter.workstreamId");
				clauses.push("workstream_id = ?");
				params.push(filter.workstreamId);
			}
			if (filter.status !== void 0) {
				if (!isRunStatus(filter.status)) throw inputError$1(`filter.status must be one of ${JSON.stringify(RUN_STATUSES_LOCAL)}`);
				clauses.push("status = ?");
				params.push(filter.status);
			}
			if (filter.dshSessionId !== void 0) {
				assertNonEmpty(filter.dshSessionId, "filter.dshSessionId");
				clauses.push("dsh_session_id = ?");
				params.push(filter.dshSessionId);
			}
			const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
			return selectMany("listRuns", `SELECT * FROM run ${where} ORDER BY started_at DESC, run_id DESC`, params).map(rowToRun);
		},
		listAllRuns() {
			return selectMany("listAllRuns", `SELECT * FROM run ORDER BY started_at ASC, run_id ASC`).map(rowToRun);
		},
		insertDiscoveredSession(ds) {
			const params = discoveredSessionToParams(ds);
			try {
				prepare("insertDiscoveredSession", `INSERT INTO ${DISCOVERED_SESSION_TABLE} (id, dsh_session_id, workspace_root, discovered_at, state, bound_run_id, summary)
           VALUES (?, ?, ?, ?, ?, ?, ?)`).run(...params);
			} catch (e) {
				throw toTableError(`insertDiscoveredSession(${ds.id})`, e);
			}
		},
		transitionDiscoveredSession(id, from, to, boundRunId) {
			if (!isDsState(from) || !isDsState(to)) throw inputError$1(`transitionDiscoveredSession: invalid state (from=${String(from)}, to=${String(to)})`);
			try {
				const r = boundRunId === void 0 ? prepare("transitionDiscoveredSession", `UPDATE ${DISCOVERED_SESSION_TABLE} SET state = ? WHERE id = ? AND state = ?`).run(to, id, from) : prepare("transitionDiscoveredSession", `UPDATE ${DISCOVERED_SESSION_TABLE} SET state = ?, bound_run_id = ? WHERE id = ? AND state = ?`).run(to, boundRunId, id, from);
				return Number(r.changes);
			} catch (e) {
				throw toTableError(`transitionDiscoveredSession(${id})`, e);
			}
		},
		getDiscoveredSession(id) {
			const row = selectOne("getDiscoveredSession", `SELECT * FROM ${DISCOVERED_SESSION_TABLE} WHERE id = ?`, id);
			return row === void 0 ? null : rowToDiscoveredSession(row);
		},
		getDiscoveredSessionBySessionId(dshSessionId) {
			const row = selectOne("getDiscoveredSessionBySessionId", `SELECT * FROM ${DISCOVERED_SESSION_TABLE} WHERE dsh_session_id = ?`, dshSessionId);
			return row === void 0 ? null : rowToDiscoveredSession(row);
		},
		listDiscoveredSessions(filter) {
			const clauses = [];
			const params = [];
			if (filter.state !== void 0) {
				if (!isDsState(filter.state)) throw inputError$1(`filter.state must be one of ${JSON.stringify(DS_STATES_LOCAL)}`);
				clauses.push("state = ?");
				params.push(filter.state);
			}
			if (filter.workspaceRoot !== void 0) {
				assertNonEmpty(filter.workspaceRoot, "filter.workspaceRoot");
				clauses.push("workspace_root = ?");
				params.push(filter.workspaceRoot);
			}
			const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
			return selectMany("listDiscoveredSessions", `SELECT * FROM ${DISCOVERED_SESSION_TABLE} ${where} ORDER BY discovered_at ASC, id ASC`, params).map(rowToDiscoveredSession);
		},
		transaction(work) {
			const conn = assertOpen("transaction");
			try {
				conn.exec("BEGIN IMMEDIATE");
				try {
					const result = work();
					conn.exec("COMMIT");
					return result;
				} catch (e) {
					rollbackQuietly(conn);
					throw e;
				}
			} catch (e) {
				if (e instanceof RunBindingError) throw e;
				throw toTableError("transaction", e);
			}
		}
	};
}
const RUN_STATUSES_LOCAL = [
	"RUNNING",
	"FINISHED",
	"FAILED",
	"CANCELLED"
];
const DS_STATES_LOCAL = [
	"PENDING",
	"BOUND",
	"DETACHED",
	"IGNORED"
];
function isRunStatus(v) {
	return RUN_STATUSES_LOCAL.includes(v);
}
function isDsState(v) {
	return DS_STATES_LOCAL.includes(v);
}
function assertNonEmpty(value, what) {
	if (typeof value !== "string" || value.length === 0) throw inputError$1(`${what} must be a non-empty string`);
}
function assertPositiveInt(value, what) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw inputError$1(`${what} must be a positive safe integer`);
}
function inputError$1(message) {
	return new RunBindingError("RB_INPUT", message);
}
function toTableError(context, e) {
	if (e instanceof RunBindingError) return e;
	return new RunBindingError("RB_TABLE", `${context}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
}
function rollbackQuietly(db) {
	try {
		db.exec("ROLLBACK");
	} catch {}
}
//#endregion
//#region src/host/service/sessionlink/types.ts
/** One precisely-located sessionlink failure (WP-2.2/2.5 结构错误惯例). */
var SessionLinkError = class extends Error {
	code;
	/** Structured detail (e.g. the registry's validation errors). */
	detail;
	constructor(init) {
		super(init.message, init.cause !== void 0 ? { cause: init.cause } : void 0);
		this.name = "SessionLinkError";
		this.code = init.code;
		if (init.detail !== void 0) this.detail = init.detail;
	}
};
/** The operational `meta` KV key of one session's pointer row. */
function pointerKey(sessionId) {
	return `sessionlink:pointer:${sessionId}`;
}
/** Structural check for a RUN derived-state row (rebuildable cache — a
*  malformed row is SKIPPED by the context builder, never trusted). */
function isRunStateDoc(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const d = value;
	return typeof d.workstreamId === "string" && d.workstreamId.length > 0 && typeof d.status === "string" && (d.status === "RUNNING" || d.status === "FINISHED" || d.status === "FAILED" || d.status === "CANCELLED") && typeof d.startedAt === "number" && typeof d.initiatedBy === "object" && d.initiatedBy !== null;
}
//#endregion
//#region src/host/service/sessionlink/map.ts
/** The mechanical close note when a run is ended by something other than a clean `turn/end`. */
const LATE_CLOSE_SUMMARY = "superseded by next turn (no turn/end observed)";
const DISPOSED_CLOSE_SUMMARY = "session disposed with open turn";
/** `initiated_by` of a mechanically registered run: the session's user (the
*  prompt that opened the turn) — the plugin does not know user ids, the
*  session pointer is the honest mechanical attribution (catalog §5.1). */
function initiatedBy(sessionId) {
	return {
		kind: "USER",
		session_id: sessionId
	};
}
/** The `occurredAt` of one window event: its projected `time`, else `now`. */
function occurredAtOf(event, now) {
	return event.time === void 0 ? now : event.time;
}
/**
* Map one session event window to the RUN_* events to append.
*
* @returns the mapping (drafts in append order + resulting active run +
*   pointer advance), or `null` when the window produces no transition.
*   `null` vs `{events: []}`: never — any non-null result carries ≥1 draft
*   by construction (the two cases are one: no transition ⇔ null).
*/
function mapSessionWindow(input) {
	if (typeof input?.sessionId !== "string" || input.sessionId.length === 0) throw new TypeError("mapSessionWindow: sessionId must be a non-empty string");
	if (typeof input.now !== "number" || !Number.isFinite(input.now)) throw new TypeError("mapSessionWindow: now must be a finite epoch-ms number");
	if (typeof input.allocateRunId !== "function") throw new TypeError("mapSessionWindow: allocateRunId must be a function");
	const events = input.events;
	if (!Array.isArray(events)) throw new TypeError("mapSessionWindow: events must be an array");
	const afterSeq = input.afterSeq ?? 0;
	if (typeof afterSeq !== "number" || !Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new TypeError("mapSessionWindow: afterSeq must be a non-negative safe integer");
	let active = input.activeRunId ?? null;
	const drafts = [];
	let lastSeq = afterSeq;
	const startDraft = (runId, at) => ({
		eventType: "RUN_STARTED",
		occurredAt: at,
		runId,
		payload: {
			run_id: runId,
			dsh_session_id: input.sessionId,
			...input.taskId !== void 0 ? { task_id: input.taskId } : {},
			...input.intent !== void 0 ? { intent: input.intent } : {},
			initiated_by: initiatedBy(input.sessionId)
		}
	});
	const finishDraft = (runId, at, summary) => ({
		eventType: "RUN_FINISHED",
		occurredAt: at,
		runId,
		payload: {
			run_id: runId,
			...summary !== void 0 ? { outcome_summary: summary } : {}
		}
	});
	for (const event of events) {
		if (event.seq <= afterSeq) continue;
		if (event.seq <= lastSeq) continue;
		switch (event.type) {
			case "turn/start": {
				const at = occurredAtOf(event, input.now);
				if (active !== null) drafts.push(finishDraft(active, at, LATE_CLOSE_SUMMARY));
				active = input.allocateRunId();
				drafts.push(startDraft(active, at));
				lastSeq = event.seq;
				break;
			}
			case "turn/end": if (active !== null) {
				drafts.push(finishDraft(active, occurredAtOf(event, input.now), void 0));
				active = null;
				lastSeq = event.seq;
			}
		}
	}
	if (input.disposed && active !== null) {
		drafts.push(finishDraft(active, input.now, DISPOSED_CLOSE_SUMMARY));
		active = null;
	}
	if (drafts.length === 0) return null;
	return {
		events: drafts,
		activeRunId: active,
		lastSeq
	};
}
//#endregion
//#region src/host/service/sessionlink/pointer.ts
/**
* WP-2.6 — pointer-row codec (the `meta` KV value for one wired session).
*
* The pointer row (INV-DB-2: session_id → Run 绑定 + 事件指针, 无 raw log)
* is persisted as ONE strict-JSON string in the operational `meta` table
* under `pointerKey(sessionId)`. The `meta` table is the right home:
*  - it is bookkeeping, NOT the rebuildable `derived_state` cache — a
*    WP-2.3 `rebuildDerivedState` (wholesale replace) can never drop it;
*  - it lives in the same SQLite file as the event log (one operational
*    store per project, DOMAIN_SCHEMA §15), so a pointer + its events are
*    crash-consistent in the file sense (WAL: each write is atomic on its
*    own; the append→pointer ordering is documented on the service).
*
* Decoding is STRICT and fails loud (`STATE_CORRUPT`): a malformed row must
* never be silently half-consumed (it would either re-process consumed
* edges or finish the wrong run). The shape is exactly `SessionPointer` —
* no field is ever ignored, no extra field is ever accepted.
*/
/**
* Encode a pointer row to its `meta` value (canonical strict JSON).
* @throws `TypeError` on a structurally invalid row (the service never
*   encodes one; the guard is the codec's own boundary).
*/
function encodePointer(pointer) {
	validatePointer(pointer, "encode");
	return JSON.stringify({
		workstreamId: pointer.workstreamId,
		...pointer.intent !== void 0 ? { intent: pointer.intent } : {},
		...pointer.taskId !== void 0 ? { taskId: pointer.taskId } : {},
		lastSeq: pointer.lastSeq,
		runId: pointer.runId,
		runStartedAt: pointer.runStartedAt
	});
}
/**
* Decode a `meta` value into a pointer row (strict shape check).
* @throws `SessionLinkError` (`STATE_CORRUPT`) when the value is not valid
*   JSON or violates the row shape — fail loud, never guess.
*/
function decodePointer(raw, sessionId) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new SessionLinkError({
			code: "STATE_CORRUPT",
			message: `pointer row of session ${JSON.stringify(sessionId)} is not valid JSON: ${cause.message}`
		});
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw corrupt(`pointer row of session ${JSON.stringify(sessionId)} must be a JSON object`);
	const d = parsed;
	let runId = null;
	if (d.runId !== void 0 && d.runId !== null) {
		if (typeof d.runId !== "string" || d.runId.length === 0) throw corrupt(`pointer row of session ${JSON.stringify(sessionId)}: runId must be a non-empty string or null`);
		runId = d.runId;
	}
	let runStartedAt = null;
	if (d.runStartedAt !== void 0 && d.runStartedAt !== null) {
		if (typeof d.runStartedAt !== "number" || !Number.isSafeInteger(d.runStartedAt) || d.runStartedAt < 0) throw corrupt(`pointer row of session ${JSON.stringify(sessionId)}: runStartedAt must be a non-negative safe integer or null`);
		runStartedAt = d.runStartedAt;
	}
	if (runId === null !== (runStartedAt === null)) throw corrupt(`pointer row of session ${JSON.stringify(sessionId)}: runId and runStartedAt must be both null or both set (open-run binding pair)`);
	return {
		workstreamId: requireString(d, "workstreamId", sessionId),
		...d.intent !== void 0 ? { intent: requireString(d, "intent", sessionId) } : {},
		...d.taskId !== void 0 ? { taskId: requireString(d, "taskId", sessionId) } : {},
		lastSeq: requireNonNegativeInt(d, "lastSeq", sessionId),
		runId,
		runStartedAt
	};
}
/** Cross-field shape validation (shared by encode + decode). */
function validatePointer(p, what) {
	if (typeof p.workstreamId !== "string" || p.workstreamId.length === 0) throw new TypeError(`${what}: workstreamId must be a non-empty string`);
	if (!Number.isSafeInteger(p.lastSeq) || p.lastSeq < 0) throw new TypeError(`${what}: lastSeq must be a non-negative safe integer`);
	if (p.intent !== void 0 && typeof p.intent !== "string") throw new TypeError(`${what}: intent must be a string when present`);
	if (p.taskId !== void 0 && typeof p.taskId !== "string") throw new TypeError(`${what}: taskId must be a string when present`);
	if (p.runId === null !== (p.runStartedAt === null)) throw new TypeError(`${what}: runId and runStartedAt must be both null or both set (open-run binding pair)`);
	if (p.runId !== null && typeof p.runId !== "string" && typeof p.runId !== "number") throw new TypeError(`${what}: runId must be null or a string when set`);
	if (p.runStartedAt !== null && (typeof p.runStartedAt !== "number" || !Number.isSafeInteger(p.runStartedAt) || p.runStartedAt < 0)) throw new TypeError(`${what}: runStartedAt must be null or a non-negative safe integer when set`);
}
function requireString(d, field, sessionId) {
	if (typeof d[field] !== "string" || d[field].length === 0) throw corrupt(`pointer row of session ${JSON.stringify(sessionId)}: ${field} must be a non-empty string`);
	return d[field];
}
function requireNonNegativeInt(d, field, sessionId) {
	if (typeof d[field] !== "number" || !Number.isSafeInteger(d[field]) || d[field] < 0) throw corrupt(`pointer row of session ${JSON.stringify(sessionId)}: ${field} must be a non-negative safe integer`);
	return d[field];
}
function corrupt(message) {
	return new SessionLinkError({
		code: "STATE_CORRUPT",
		message
	});
}
//#endregion
//#region src/host/service/sessionlink/context.ts
/**
* WP-2.6 — validation-context assembly for the registry gate.
*
* `validateEvent(registry, event, ctx)` is a pure function over the
* injected read-only state snapshot (`HistoryObjectContext`, WP-2.2).
* This module assembles that snapshot from the two sources the service
* owns:
*
*   - `workstreams` — the injected DECLARATIVE source (the loaded
*     `.research/` tree; the domain loader's workstream registry). Only the
*     BOUND workstream is materialized: sessionlink events never reference
*     another workstream (the owner is the binding by construction), so
*     over-claiming other rows would be false precision;
*   - `runs` / `tasks` — the operational `derived_state` cache, read through
*     the WP-2.3 read-only face (`readDerivedState` opens a `readOnly`
*     connection — a write through it is structurally impossible).
*
* The other eight maps are EMPTY by construction: the two event types
* sessionlink emits (RUN_STARTED / RUN_FINISHED, catalog §5.1) only touch
* `ctx.workstreams`, `ctx.runs`, and `ctx.tasks` (the optional `task_id`)
* inside `validateEvent` — no sessionlink event can reference a
* claim/fact/artifact/relation/gate/milestone/intervention/edge, so those
* maps are provably never read for these events.
*
* Reading model: the read happens OUTSIDE the append transaction, just
* before `appendEvents`. Node is single-threaded and the store's append is
* synchronous, so no event can interleave between the read and the write —
* the snapshot the in-transaction validate hook sees is EXACTLY the
* pre-batch state `validateEvent` requires (INV-HIST-5 semantics).
*/
/** Structural check for a TASK derived-state row (camelCase convention,
*  same as the RUN row — the row's future owner is the task-service WP). */
function isTaskStateDoc(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const d = value;
	return typeof d.workstreamId === "string" && d.workstreamId.length > 0 && typeof d.execution === "string" && typeof d.validation === "string" && Array.isArray(d.acceptanceCriteria) && d.acceptanceCriteria.every((x) => typeof x === "string");
}
/**
* Assemble the validation snapshot for one bound workstream over the
* current operational state.
*
* @param store - the operational store (read-only face + file path).
* @param boundWorkstreamId - the session's bound WS (the only owner).
* @param workstreams - the declarative workstream source.
* @throws `SessionLinkError` (`DERIVED_STATE_UNREADABLE`) when the
*   `derived_state` table cannot be read or a state key is malformed.
*/
function buildValidationContext(store, boundWorkstreamId, workstreams) {
	let derived;
	try {
		derived = readDerivedState(store);
	} catch (cause) {
		if (cause instanceof SessionLinkError) throw cause;
		throw new SessionLinkError({
			code: "DERIVED_STATE_UNREADABLE",
			message: `cannot read derived_state for validation: ${cause.message}`,
			cause
		});
	}
	const runs = /* @__PURE__ */ new Map();
	const tasks = /* @__PURE__ */ new Map();
	for (const [key, doc] of derived) {
		let kind;
		let id;
		try {
			const parsed = parseStateKey(key);
			kind = parsed.objectKind;
			id = parsed.objectId;
		} catch {
			continue;
		}
		if (kind === "RUN" && isRunStateDoc(doc)) runs.set(id, {
			workstreamId: doc.workstreamId,
			status: doc.status
		});
		else if (kind === "TASK" && isTaskStateDoc(doc)) tasks.set(id, {
			workstreamId: doc.workstreamId,
			execution: doc.execution,
			validation: doc.validation,
			acceptanceCriteria: doc.acceptanceCriteria
		});
	}
	const ws = workstreams(boundWorkstreamId);
	const workstreamMap = /* @__PURE__ */ new Map();
	if (ws !== null) workstreamMap.set(boundWorkstreamId, ws);
	return {
		workstreams: workstreamMap,
		runs,
		tasks,
		claims: /* @__PURE__ */ new Map(),
		facts: /* @__PURE__ */ new Map(),
		artifacts: /* @__PURE__ */ new Map(),
		relations: /* @__PURE__ */ new Map(),
		gates: /* @__PURE__ */ new Map(),
		milestones: /* @__PURE__ */ new Map(),
		interventions: /* @__PURE__ */ new Map(),
		topologyEdges: /* @__PURE__ */ new Map()
	};
}
/**
* The current RUN derived-state doc for `runId`, or `null` when absent
* (never written, or dropped by a rebuild — the run's START fact then comes
* from the pointer row; see the service). Same read model as
* {@link buildValidationContext}.
*/
function readRunStateDoc(store, runId) {
	let derived;
	try {
		derived = readDerivedState(store);
	} catch (cause) {
		if (cause instanceof SessionLinkError) throw cause;
		throw new SessionLinkError({
			code: "DERIVED_STATE_UNREADABLE",
			message: `cannot read derived_state for run ${JSON.stringify(runId)}: ${cause.message}`,
			cause
		});
	}
	const doc = derived.get(`RUN:${runId}`);
	return doc !== void 0 && isRunStateDoc(doc) ? doc : null;
}
//#endregion
//#region src/host/service/sessionlink/service.ts
/**
* WP-2.6 — `SessionLinkService`: DSH session → ResearchHistory wiring.
*
* Subscribes to the injected WP-0.4 `DshSessionAdapter` event stream (host
* `session/event` post-commit feed + `session/created|disposed` lifecycle
* edges), maps the session Run lifecycle to RUN_STARTED / RUN_FINISHED
* (DSH_ADAPTER §7 / TC-DSH-004 — the pure constructor is `mapSessionWindow`),
* validates the constructed events through the WP-2.2 registry and appends
* them to the WP-2.1 operational store — with the RUN derived-state rows in
* the SAME transaction (catalog §6 / §15: 与事件 append 同事务写入).
*
* INV-DB-2 (ARCHITECTURE §5.11): the session's raw log is NEVER copied. The
* plugin stores, per wired session, exactly the pointer row
* (`SessionPointer` in the `meta` KV: bound workstream, open-run binding +
* started_at, event-seq pointer) and, per run, the RUN_* events whose
* payloads carry only the session POINTER (`dsh_session_id`), the
* `source: {kind: 'DSH_SESSION'}` envelope ref, and the mechanical
* `outcome_summary` close notes (「只存 session_id、Run 绑定、事件指针、摘要」).
*
* Idempotency — the two halves the brief names:
*   - CONSTRAINT: the pointer row's `lastSeq` gate rejects every re-delivery
*     of an already-consumed edge (`seq <= lastSeq`); a second `wireSession`
*     for the same session with the SAME binding is a no-op returning the
*     stored pointer (it persists nothing new and produces NO events);
*   - REJECTION PATH: `wireSession` of a session already bound to a
*     DIFFERENT workstream throws `BINDING_CONFLICT`; a constructed event
*     the registry rejects (e.g. a RUN_FINISHED for a run the derived state
*     does not hold — `OBJECT_NOT_FOUND`) throws `VALIDATION_REJECTED` with
*     the structured errors, the whole batch rolls back, and every reserved
*     id is released (burned, never reused — DOMAIN_SCHEMA §1.1).
*
* id reservation protocol (WP-1.6 reserve/commit/release): run ids are
* reserved INSIDE `mapSessionWindow` (its `allocateRunId` seam), event ids
* just before the append; a rejected/failed batch RELEASES every
* reservation (a permanent gap — monotonicity + no-reuse, §1.1) and
* propagates the structured error. A crash between reserve and append burns
* the ids the same way; uniqueness holds by construction.
*
* Crash ordering (documented, self-healing): `appendEvents` (event rows +
* RUN derived rows, one atomic transaction) happens BEFORE the pointer
* `meta.set`. A crash in between leaves the event in the log (append-only —
* it happened) with a lagging pointer; on re-wire the lagging pointer
* re-derives at most one extra finish for an already-finished run, which
* the registry rejects (WRONG_STATE) — a structured rejection, never a
* duplicate event in the log.
*
* Run = one turn (DOMAIN_SCHEMA §6.1 「一次连续执行尝试」; a DSH turn = user
* prompt → agent loop → turn close). A session may therefore own N runs
* (Task : Run = 1 : N applies across the turns of one session).
*/
/** The `label` of the PLUGIN actor that registers the events mechanically. */
const ACTOR_LABEL = "sessionlink";
var SessionLinkService = class {
	#store;
	#registry;
	#adapter;
	#ids;
	#projectId;
	#workstreams;
	#now;
	/** In-memory mirror of the pointer rows (the `meta` rows are the truth;
	*  the mirror keeps the per-event hot path off the KV). */
	#pointers = /* @__PURE__ */ new Map();
	constructor(options) {
		this.#store = options.store;
		this.#registry = options.registry;
		this.#adapter = options.adapter;
		this.#ids = options.ids;
		this.#projectId = options.projectId;
		this.#workstreams = options.workstreams;
		this.#now = options.now ?? Date.now;
	}
	/**
	* Wire one session to a workstream (explicit binding — the discovery/BIND
	* flow is the runbinding WP's; this is the pointer-row + subscription
	* half). Idempotent for the SAME binding (returns the stored pointer,
	* persists nothing new, produces no events); a conflicting binding
	* (different workstream) is REJECTED (`BINDING_CONFLICT`); an unknown
	* workstream is rejected (`WORKSTREAM_NOT_FOUND`).
	*/
	wireSession(sessionId, binding) {
		if (typeof sessionId !== "string" || sessionId.length === 0) throw new TypeError("wireSession: sessionId must be a non-empty string");
		if (this.#workstreams(binding.workstreamId) === null) throw new SessionLinkError({
			code: "WORKSTREAM_NOT_FOUND",
			message: `cannot wire session ${JSON.stringify(sessionId)}: workstream ${JSON.stringify(binding.workstreamId)} is unknown to the declarative source`
		});
		const key = pointerKey(sessionId);
		const existingRaw = this.#store.meta().get(key);
		if (existingRaw !== null) {
			let existing = decodePointer(existingRaw, sessionId);
			const reconciled = this.#reconcileFromLog(sessionId, existing);
			if (reconciled !== null) {
				existing = reconciled;
				this.#store.meta().set(key, encodePointer(existing));
			}
			if (existing.workstreamId !== binding.workstreamId) throw new SessionLinkError({
				code: "BINDING_CONFLICT",
				message: `cannot wire session ${JSON.stringify(sessionId)}: already bound to workstream ${JSON.stringify(existing.workstreamId)} (requested ${JSON.stringify(binding.workstreamId)}) — a DSH session maps to at most one workstream (INV-DB-2 binding)`,
				detail: {
					existing,
					requested: binding
				}
			});
			this.#pointers.set(sessionId, existing);
			return {
				status: "already-wired",
				pointer: existing
			};
		}
		const pointer = {
			workstreamId: binding.workstreamId,
			...binding.intent !== void 0 ? { intent: binding.intent } : {},
			...binding.taskId !== void 0 ? { taskId: binding.taskId } : {},
			lastSeq: 0,
			runId: null,
			runStartedAt: null
		};
		this.#store.meta().set(key, encodePointer(pointer));
		this.#pointers.set(sessionId, pointer);
		return { status: "wired" };
	}
	/**
	* Detach: stop processing events for the session (in-memory only). The
	* pointer row is KEPT (durable binding + resume facts) — an open run stays
	* open in History and can be finished on re-wire. `null` when the session
	* was not wired.
	*/
	detachSession(sessionId) {
		const pointer = this.#pointers.get(sessionId) ?? null;
		this.#pointers.delete(sessionId);
		return pointer;
	}
	/** The durable pointer row for a session (re-read from `meta`), or `null`. */
	pointerOf(sessionId) {
		const raw = this.#store.meta().get(pointerKey(sessionId));
		if (raw === null) return null;
		return decodePointer(raw, sessionId);
	}
	/**
	* Resume reconciliation (module doc, crash ordering): re-derive the open
	* run for this session from the BOUND WS's event log (audit order) and
	* compare with the pointer row.
	*
	*   - log says a run is open, pointer says none (or a different one) →
	*     adopt the log's run (the append landed; the pointer `meta.set` did
	*     not — or a previous recovery pair ran);
	*   - log says the pointer's run is finished, pointer says open → adopt
	*     the log (the finish landed; the pointer lagged);
	*   - agreement → `null` (no write).
	*
	* Only the `runId`/`runStartedAt` pair moves; `lastSeq` stays as stored
	* (LOW-err: a re-processed edge can re-derive at most the documented
	* recovery pair — never a duplicate log row, because every derived event
	* still passes the registry state gate).
	*/
	#reconcileFromLog(sessionId, pointer) {
		const runs = /* @__PURE__ */ new Map();
		for (const event of this.#store.listRange(pointer.workstreamId, 1)) {
			const payload = event.payload;
			if (event.eventType === "RUN_STARTED" && payload.dsh_session_id === sessionId) {
				const runId = typeof payload.run_id === "string" ? payload.run_id : null;
				if (runId !== null) runs.set(runId, {
					startedAt: event.occurredAt,
					finished: false
				});
			} else if (event.eventType === "RUN_FINISHED") {
				const runId = typeof payload.run_id === "string" ? payload.run_id : null;
				if (runId !== null) {
					const run = runs.get(runId);
					if (run !== void 0) run.finished = true;
				}
			}
		}
		let openId = null;
		let openStartedAt = 0;
		for (const [runId, run] of runs) if (!run.finished) {
			openId = runId;
			openStartedAt = run.startedAt;
		}
		if (pointer.runId === openId) return null;
		return {
			workstreamId: pointer.workstreamId,
			...pointer.intent !== void 0 ? { intent: pointer.intent } : {},
			...pointer.taskId !== void 0 ? { taskId: pointer.taskId } : {},
			lastSeq: pointer.lastSeq,
			runId: openId,
			runStartedAt: openId === null ? null : openStartedAt
		};
	}
	/**
	* Subscribe to the adapter's session event stream (the WP-0.4 port:
	* `session/event` feed + `session/created|disposed` lifecycle edges).
	* Unwired sessions are ignored (the runbinding WP's concern).
	*
	* @returns a single disposer (unsubscribes BOTH subscriptions — cordis
	*   convention: registration is the effect, the disposer is the rollback).
	*/
	start() {
		const offEvents = this.#adapter.onSessionEvent((info) => this.#consumeEvent(info.sessionId, info.type, info.seq));
		const offLifecycle = this.#adapter.observeSessionLifecycle((edge) => {
			if (edge.kind === "disposed") this.#consumeDisposed(edge.sessionId);
		});
		return () => {
			offEvents();
			offLifecycle();
		};
	}
	/**
	* The per-event hot path (also the seam tests drive directly): consume
	* one observed `session/event` of a wired session. No-op for unwired
	* sessions and for rejected re-deliveries (`seq <= lastSeq`).
	*/
	#consumeEvent(sessionId, type, seq) {
		const pointer = this.#pointers.get(sessionId);
		if (pointer === void 0) return;
		const runReservations = [];
		const mapping = mapSessionWindow({
			sessionId,
			events: [{
				seq,
				type
			}],
			afterSeq: pointer.lastSeq,
			activeRunId: pointer.runId,
			taskId: pointer.taskId,
			intent: pointer.intent,
			now: this.#now(),
			allocateRunId: () => {
				const r = this.#ids.reserve("RUN", this.#projectId);
				runReservations.push(r);
				return r.id;
			}
		});
		if (mapping === null) return;
		this.#commit(sessionId, pointer, mapping, runReservations);
	}
	/** The `session/disposed` lifecycle edge (no seq): close an open run. */
	#consumeDisposed(sessionId) {
		const pointer = this.#pointers.get(sessionId);
		if (pointer === void 0 || pointer.runId === null) return;
		const runReservations = [];
		const mapping = mapSessionWindow({
			sessionId,
			events: [],
			afterSeq: pointer.lastSeq,
			activeRunId: pointer.runId,
			taskId: pointer.taskId,
			intent: pointer.intent,
			now: this.#now(),
			disposed: true,
			allocateRunId: () => {
				const r = this.#ids.reserve("RUN", this.#projectId);
				runReservations.push(r);
				return r.id;
			}
		});
		if (mapping === null) return;
		this.#commit(sessionId, pointer, mapping, runReservations);
	}
	/**
	* Commit one mapping: reserve event ids → build envelope + RUN
	* derived-state patches → `appendEvents` (registry validation INSIDE the
	* write transaction; throw ⇒ the whole batch rolls back) → persist the
	* pointer AFTER the append (documented crash ordering, module doc).
	* Any failure releases every reserved id (burned gap, §1.1) and
	* propagates a `SessionLinkError`.
	*/
	#commit(sessionId, pointer, mapping, runReservations) {
		const hReservations = mapping.events.map(() => this.#ids.reserve("HISTORY_EVENT", this.#projectId));
		const ctx = buildValidationContext(this.#store, pointer.workstreamId, this.#workstreams);
		const events = mapping.events.map((d, i) => ({
			eventId: hReservations[i].id,
			ownerWorkstreamId: pointer.workstreamId,
			eventType: d.eventType,
			schemaVersion: 1,
			occurredAt: d.occurredAt,
			actor: {
				kind: "PLUGIN",
				session_id: sessionId,
				label: ACTOR_LABEL
			},
			source: {
				kind: "DSH_SESSION",
				session_id: sessionId
			},
			payload: d.payload
		}));
		const derivedState = mapping.events.map((d) => this.#runDocPatch(sessionId, pointer, d));
		try {
			this.#store.appendEvents(events, {
				derivedState,
				validate: (finalized) => {
					for (const event of finalized) {
						const verdict = validateEvent(this.#registry, event, ctx);
						if (!verdict.ok) throw new SessionLinkError({
							code: "VALIDATION_REJECTED",
							message: `registry rejected ${event.eventType} (${event.eventId}) of session ${JSON.stringify(sessionId)}: ` + verdict.errors.map((e) => `${e.code}@${e.path ?? "/"}: ${e.message}`).join("; "),
							detail: verdict.errors
						});
					}
				}
			});
		} catch (cause) {
			for (const r of hReservations) this.#ids.release(r);
			for (const r of runReservations) this.#ids.release(r);
			if (cause instanceof SessionLinkError) throw cause;
			throw new SessionLinkError({
				code: "STORE_FAILED",
				message: `store append for session ${JSON.stringify(sessionId)} failed: ${cause.message}`,
				cause
			});
		}
		for (const r of hReservations) this.#ids.commit(r);
		for (const r of runReservations) this.#ids.commit(r);
		const next = {
			workstreamId: pointer.workstreamId,
			...pointer.intent !== void 0 ? { intent: pointer.intent } : {},
			...pointer.taskId !== void 0 ? { taskId: pointer.taskId } : {},
			lastSeq: mapping.lastSeq,
			runId: mapping.activeRunId,
			runStartedAt: mapping.activeRunId === null ? null : startedAtOf(mapping, sessionId)
		};
		this.#store.meta().set(pointerKey(sessionId), encodePointer(next));
		this.#pointers.set(sessionId, next);
	}
	/**
	* The RUN derived-state patch for one draft:
	*  - RUN_STARTED → the full doc (fresh run row, status RUNNING);
	*  - RUN_FINISHED → the PRE-batch doc (the same read-only derived-state
	*    snapshot the validation ctx used) + status FINISHED / endedAt /
	*    optional outcomeSummary; when the doc is ABSENT (a rebuild dropped
	*    the rebuildable cache — TC-HIST-006 semantics), reconstruct it from
	*    the pointer's durable start facts (INV-DB-2 「Run 绑定」).
	*/
	#runDocPatch(sessionId, pointer, draft) {
		if (draft.eventType === "RUN_STARTED") {
			const doc = {
				workstreamId: pointer.workstreamId,
				status: "RUNNING",
				startedAt: draft.occurredAt,
				dshSessionId: sessionId,
				...pointer.taskId !== void 0 ? { taskId: pointer.taskId } : {},
				...pointer.intent !== void 0 ? { intent: pointer.intent } : {},
				initiatedBy: {
					kind: "USER",
					session_id: sessionId
				}
			};
			return {
				objectKind: "RUN",
				objectId: draft.runId,
				state: doc
			};
		}
		const outcome = typeof draft.payload.outcome_summary === "string" ? draft.payload.outcome_summary : void 0;
		const prev = readRunStateDoc(this.#store, draft.runId);
		const doc = {
			...prev !== null ? prev : {
				workstreamId: pointer.workstreamId,
				status: "RUNNING",
				startedAt: pointer.runStartedAt ?? 0,
				dshSessionId: sessionId,
				...pointer.taskId !== void 0 ? { taskId: pointer.taskId } : {},
				...pointer.intent !== void 0 ? { intent: pointer.intent } : {},
				initiatedBy: {
					kind: "USER",
					session_id: sessionId
				}
			},
			status: "FINISHED",
			endedAt: draft.occurredAt,
			...outcome !== void 0 ? { outcomeSummary: outcome } : {}
		};
		return {
			objectKind: "RUN",
			objectId: draft.runId,
			state: doc
		};
	}
};
/** The `started_at` of the run left open after the mapping (the pointer's
*  durable start fact): the last RUN_STARTED draft's `occurredAt`. */
function startedAtOf(mapping, sessionId) {
	for (let i = mapping.events.length - 1; i >= 0; i -= 1) {
		const d = mapping.events[i];
		if (d.eventType === "RUN_STARTED") return d.occurredAt;
	}
	throw new SessionLinkError({
		code: "STATE_CORRUPT",
		message: `internal: mapping left a run open without a RUN_STARTED draft (session ${JSON.stringify(sessionId)})`
	});
}
//#endregion
//#region src/host/domain/topology/types.ts
/**
* Suffix for the temp file the store's atomic-write protocol uses
* (`<target>.dshrc-tmp`). Exported so tests can observe the protocol.
*/
const TMP_FILE_SUFFIX = ".dshrc-tmp";
//#endregion
//#region src/host/tools/types.ts
/**
* Project a service record into a lossless-JSON value (structural deep
* copy — the host registry does the same materialization; a service
* record interface carries no string index signature, so the copy is
* the type-safe bridge, not a cast). Only lossless-JSON record shapes
* (the frozen snake_case rows) flow through here.
* @param value - a plain JSON-shaped value (frozen records, arrays, scalars).
* @returns the projected ToolJsonValue.
*/
function toToolJsonValue(value) {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map((item) => toToolJsonValue(item));
	const out = {};
	for (const [key, child] of Object.entries(value)) out[key] = toToolJsonValue(child);
	return out;
}
/** One structured tool failure (thrown; never returned as a success value). */
var ToolError = class extends Error {
	/** The taxonomy code above. */
	code;
	/** Structured extras (service code/step/path, the tool name, the planned service). */
	detail;
	constructor(code, message, options) {
		super(message, options?.cause !== void 0 ? { cause: options.cause } : void 0);
		this.name = "ToolError";
		this.code = code;
		if (options?.detail !== void 0) this.detail = options.detail;
	}
};
/**
* Assemble one tool: wraps `handle` with the built-in permission gate
* (allowedActorKinds → run requirement → abort checks around the body).
* The static definition is frozen on creation (HMR-safe, host convention:
* registration is an effect, the definition is data).
*/
function buildTool(build) {
	if (build.requiresRun !== (build.access === "write")) throw new Error(`tool "${build.name}": requiresRun must equal (access === 'write') — the §6 matrix gives the agent NO write lane without a formal run (INV-PERM-1) and NO run requirement for reads`);
	const allowedActorKinds = ["AGENT"];
	const definition = {
		name: build.name,
		description: build.description,
		access: build.access,
		allowedActorKinds,
		requiresRun: build.requiresRun,
		parameters: build.parameters,
		output: build.output,
		execute: async (args, exec) => {
			const { name, requiresRun, handle } = build;
			if (!allowedActorKinds.includes(exec.actor.kind)) throw new ToolError("TOOL_ACTOR_FORBIDDEN", `${name}: actor kind ${JSON.stringify(exec.actor.kind)} is not allowed — this is an agent-facing tool (allowed kinds: ${allowedActorKinds.join(", ")})`);
			const runId = requiresRun ? exec.actor.run_id : void 0;
			if (requiresRun && (typeof runId !== "string" || runId.length === 0)) throw new ToolError("TOOL_RUN_REQUIRED", `${name}: an AGENT actor on the write set must carry its formal run_id (INV-PERM-1: every agent write is attributed to a run)`);
			if (exec.signal.aborted) throw new ToolError("TOOL_ABORTED", `${name}: aborted before dispatch`);
			const value = await handle(args, {
				signal: exec.signal,
				actor: exec.actor,
				runId
			});
			if (exec.signal.aborted) throw new ToolError("TOOL_ABORTED", `${name}: aborted after dispatch`);
			return value;
		}
	};
	freezeToolDefinition(definition);
	return definition;
}
/** Deep-freeze the static parts (parameters/output); the execute closure stays intact. */
function freezeToolDefinition(definition) {
	deepFreeze(definition.parameters);
	deepFreeze(definition.output.schema);
	Object.freeze(definition);
}
/** Recursively freeze plain JSON-ish data (functions pass through untouched). */
function deepFreeze(value) {
	if (value === null || typeof value !== "object") return;
	Object.freeze(value);
	for (const child of Object.values(value)) deepFreeze(child);
}
//#endregion
//#region src/host/tools/args.ts
/**
* Wire-boundary argument parsing for the agent tool face (WP-3.3).
*
* The host `defineTool` derives a JSON Schema from each tool's `parameters`
* and validates model args BEFORE `execute` (DSH_ADAPTER §10.1) — but the
* plugin must be self-contained (tests call `execute` directly; a future
* code-mode SDK dispatch is another wire): every handler therefore re-checks
* the SAME face here, at the wire boundary, with precise `/path` locations.
* All violations throw `ToolError('TOOL_INPUT')`.
*
* The faces mirror the FROZEN schemas field-for-field (the host JSON Schema
* derived from `parameters` and this parser must never diverge — the test
* suite pins both sides).
*/
/** Construct one TOOL_INPUT violation with a JSON-pointer path. */
function inputError(path, message) {
	return new ToolError("TOOL_INPUT", `${path}: ${message}`);
}
/** Join a (possibly empty) parent pointer with a key into a full path. */
function joinPath(base, key) {
	return base === "" ? `/${key}` : `${base}/${key}`;
}
/** The args must be a plain JSON object (arrays/nulls/primitives refused). */
function assertArgsObject(args, toolName) {
	if (args === null || typeof args !== "object" || Array.isArray(args)) throw inputError("/", `arguments must be a JSON object (tool ${toolName})`);
	return args;
}
/**
* The object's key set must equal the frozen parameter key set (the
* `additionalProperties: false` semantics of the host-derived schema).
* `base` is the parent JSON pointer ('' at the top level). A `base*` key
* on a tool that names `baseViolationNote` gets the INV-PLAN-6-specific
* message (the base is server-recomputed, never input).
*/
function checkKeySet(obj, allowedKeys, context, base = "", baseViolationNote) {
	for (const key of Object.keys(obj)) if (!allowedKeys.includes(key)) {
		const note = baseViolationNote?.(key) ?? null;
		if (note !== null) throw new ToolError("TOOL_INPUT", `${joinPath(base, key)}: ${note}`);
		throw inputError(joinPath(base, key), `unknown argument (frozen face for ${context}: [${allowedKeys.join(", ")}])`);
	}
}
/** A required key must be present (value shape checked by the caller). */
function requireKey(obj, key, context, base = "") {
	if (obj[key] === void 0) throw inputError(joinPath(base, key), `missing required argument (frozen face for ${context})`);
}
/** A present value must be a string (optionally non-empty). */
function assertString(value, path, nonEmpty = false) {
	if (typeof value !== "string") throw inputError(path, `expected a string, got ${jsonType(value)}`);
	if (nonEmpty && value.length === 0) throw inputError(path, "must be a non-empty string");
	return value;
}
/** An optional string key: `undefined` passes, anything else must be a non-empty string. */
function assertOptionalString(obj, key, base = "") {
	const value = obj[key];
	if (value === void 0) return void 0;
	return assertString(value, joinPath(base, key), true);
}
/** A present value must be a non-empty string array (frozen `string[]` faces). */
function assertStringArray(value, path) {
	if (!Array.isArray(value)) throw inputError(path, `expected an array of strings, got ${jsonType(value)}`);
	for (let i = 0; i < value.length; i += 1) assertString(value[i], `${path}/${i}`, true);
	return value;
}
/** An optional string-array key. */
function assertOptionalStringArray(obj, key, base = "") {
	const value = obj[key];
	if (value === void 0) return void 0;
	return assertStringArray(value, joinPath(base, key));
}
/** A present value must be one of the frozen enum values (returns the narrowed member). */
function assertEnum(value, path, values) {
	const s = assertString(value, path);
	if (!values.includes(s)) throw inputError(path, `expected one of [${values.join(", ")}], got ${JSON.stringify(s)}`);
	return s;
}
/** A present value must be an integer within the bounds. */
function assertInteger(value, path, bounds) {
	if (typeof value !== "number" || !Number.isInteger(value)) throw inputError(path, `expected an integer, got ${JSON.stringify(value)}`);
	if (bounds?.min !== void 0 && value < bounds.min) throw inputError(path, `must be >= ${bounds.min}`);
	if (bounds?.max !== void 0 && value > bounds.max) throw inputError(path, `must be <= ${bounds.max}`);
	return value;
}
/** An optional integer key within the bounds. */
function assertOptionalInteger(obj, key, bounds) {
	const value = obj[key];
	if (value === void 0) return void 0;
	return assertInteger(value, `/${key}`, bounds);
}
/** A present value must be a plain object (for element-wise parsing). */
function assertObject(value, path) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw inputError(path, `expected an object, got ${jsonType(value)}`);
	return value;
}
/** A present value must be an array (for element-wise parsing). */
function assertArray(value, path, minItems = 0) {
	if (!Array.isArray(value)) throw inputError(path, `expected an array, got ${jsonType(value)}`);
	if (value.length < minItems) throw inputError(path, `must have at least ${minItems} item(s)`);
	return value;
}
/** The JSON type name for error messages (`null`/`array`/`object`/…). */
function jsonType(value) {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}
//#endregion
//#region src/host/tools/stub.ts
/**
* The stub tool factory (WP-3.3): tools whose forwarding service has not
* landed yet (the Phase-3/Phase-5 service WPs — see the report's stub
* table). A stub keeps the FULL frozen tool face (name / description /
* parameters — so the model-facing schema never changes when the service
* lands) and a handler that:
*   1. passes the built-in permission gate (actor kind + run requirement);
*   2. validates the wire arguments against the frozen face (TOOL_INPUT);
*   3. throws `ToolError('TOOL_NOT_IMPLEMENTED')` with the planned service
*      named in `detail.plannedService` (WP-3.4/3.5/3.6 et al. replace the
*      stub with a forwarding handler and delete the code path).
*/
/** Permissive output schema: a stub never produces a success value (it throws). */
const STUB_OUTPUT_SCHEMA = {
	type: "object",
	description: "placeholder — a stub tool never returns a success value (it throws NOT_IMPLEMENTED)",
	additionalProperties: true
};
/** Build one stub tool definition (the gate + arg validation + NOT_IMPLEMENTED). */
function makeStubDefinition(spec) {
	return buildTool({
		name: spec.name,
		description: spec.description,
		access: spec.access,
		requiresRun: spec.access === "write",
		parameters: spec.parameters,
		output: {
			schema: STUB_OUTPUT_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value)
			}]
		},
		handle: async (args, _ctx) => {
			spec.parseArgs(args);
			throw new ToolError("TOOL_NOT_IMPLEMENTED", `${spec.name}: not wired in this build yet (${spec.plannedService})`, { detail: {
				tool: spec.name,
				plannedService: spec.plannedService
			} });
		}
	});
}
/**
* The shared parameter helpers for the stub faces (the frozen field tables
* of the semantic/event payloads — see each tool module's JSDoc).
*/
const str = (description, required = false) => required ? {
	type: "string",
	required: true,
	description
} : {
	type: "string",
	description
};
const optStrArray = (description) => ({
	type: "array",
	items: { type: "string" },
	description
});
//#endregion
//#region src/host/tools/artifact-register.ts
/**
* research_artifact_register (WP-3.3) — STUB (the forwarding service has
* not landed yet; the report's stub table names the replacement).
*
* Parameter face — frozen ARTIFACT_REGISTERED payload + envelope owner:
* `workstream_id` (artifacts are Workstream-local; the service
* cross-checks it against the calling run's WS), `type` (frozen
* artifactType enum), `title`, `uri` (the plugin stores path/URI/reference
* only — never copies content, ARCHITECTURE §9.3), optional
* `content_hash` / `related_task` / `supersedes`. The id (A-<n>) and
* `created_by_run` are NOT arguments — allocated / attributed by the
* service from the call context.
*/
/** Frozen §7.2 name. */
const RESEARCH_ARTIFACT_REGISTER = "research_artifact_register";
/** The frozen artifact type vocabulary (common.schema.json $defs/artifactType). */
const ARTIFACT_TYPES$1 = [
	"DATASET",
	"FIGURE",
	"MODEL",
	"CODE",
	"REPORT",
	"NOTE",
	"OTHER"
];
/** The frozen tool parameter key set. */
const ARTIFACT_REGISTER_ARG_KEYS = [
	"workstream_id",
	"type",
	"title",
	"uri",
	"content_hash",
	"related_task",
	"supersedes"
];
/** The tool's model-facing parameter face (frozen 7 keys). */
const ARTIFACT_REGISTER_PARAMETERS = {
	workstream_id: str("The workstream (WS id) the artifact belongs to.", true),
	type: {
		type: "string",
		enum: [...ARTIFACT_TYPES$1],
		required: true,
		description: "The artifact kind (frozen vocabulary)."
	},
	title: str("Short title of the artifact.", true),
	uri: str("Where the artifact lives (workspace-relative path or URI) — the plugin stores the reference, never copies the content.", true),
	content_hash: str("Optional content hash (integrity pointer)."),
	related_task: str("Optional id of the task (T-<n>) that produced the artifact."),
	supersedes: str("Optional id of the earlier artifact (A-<n>) this one replaces.")
};
function parseArtifactRegisterArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_ARTIFACT_REGISTER);
	checkKeySet(obj, ARTIFACT_REGISTER_ARG_KEYS, RESEARCH_ARTIFACT_REGISTER);
	for (const key of [
		"workstream_id",
		"type",
		"title",
		"uri"
	]) requireKey(obj, key, RESEARCH_ARTIFACT_REGISTER);
	for (const key of [
		"workstream_id",
		"title",
		"uri"
	]) {
		const value = obj[key];
		if (typeof value !== "string" || value.length === 0) throw new ToolError("TOOL_INPUT", `/${key}: must be a non-empty string`);
	}
	assertEnum(obj["type"], "/type", ARTIFACT_TYPES$1);
	assertOptionalString(obj, "content_hash");
	assertOptionalString(obj, "related_task");
	assertOptionalString(obj, "supersedes");
}
function makeArtifactRegisterDefinition() {
	return makeStubDefinition({
		name: RESEARCH_ARTIFACT_REGISTER,
		description: "Register an artifact (dataset / figure / model / code / report / note) by reference: the plugin stores the path/URI and metadata, never copies the content.",
		access: "write",
		parameters: ARTIFACT_REGISTER_PARAMETERS,
		plannedService: "the artifact-recording service (ARTIFACT_REGISTERED + registry row) — not yet landed (stub; see report)",
		parseArgs: parseArtifactRegisterArgs
	});
}
//#endregion
//#region src/host/tools/claim-record.ts
/**
* research_claim_record (WP-3.3) — STUB (the forwarding service has not
* landed yet; the report's stub table names the replacement).
*
* Parameter face — frozen CLAIM_RECORDED payload + envelope owner:
* `workstream_id` (claims are Workstream-local, INV-SCI-1; the service
* cross-checks it against the calling run's WS), `statement` (minLength 1),
* optional `references`. The id (C-<n>) and `created_by_run` are NOT
* arguments — allocated / attributed by the service from the call context.
*/
/** Frozen §7.2 name. */
const RESEARCH_CLAIM_RECORD = "research_claim_record";
/** The frozen tool parameter key set. */
const CLAIM_RECORD_ARG_KEYS = [
	"workstream_id",
	"statement",
	"references"
];
/** The tool's model-facing parameter face (frozen 3 keys). */
const CLAIM_RECORD_PARAMETERS = {
	workstream_id: str("The workstream (WS id) the claim belongs to.", true),
	statement: str("The claim (a scientific statement you stand behind), stated precisely.", true),
	references: optStrArray("Ids of the objects the claim references or rests on (T-/G-/M-/F-/A-/C-…).")
};
function parseClaimRecordArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_CLAIM_RECORD);
	checkKeySet(obj, CLAIM_RECORD_ARG_KEYS, RESEARCH_CLAIM_RECORD);
	requireKey(obj, "workstream_id", RESEARCH_CLAIM_RECORD);
	requireKey(obj, "statement", RESEARCH_CLAIM_RECORD);
	if (typeof obj["workstream_id"] !== "string" || obj["workstream_id"].length === 0) throw new ToolError("TOOL_INPUT", "/workstream_id: must be a non-empty string");
	if (typeof obj["statement"] !== "string" || obj["statement"].length === 0) throw new ToolError("TOOL_INPUT", "/statement: must be a non-empty string");
	assertOptionalStringArray(obj, "references");
}
function makeClaimRecordDefinition() {
	return makeStubDefinition({
		name: RESEARCH_CLAIM_RECORD,
		description: "Record a claim (a scientific statement you stand behind, e.g. a hypothesis or conclusion) into the workstream semantic registry. Workstream-local; attributed to your run. The plugin records and indexes claims — it never judges their scientific correctness (INV-SCI-2).",
		access: "write",
		parameters: CLAIM_RECORD_PARAMETERS,
		plannedService: "the claim-recording service (CLAIM_RECORDED + registry row) — not yet landed (stub; see report)",
		parseArgs: parseClaimRecordArgs
	});
}
//#endregion
//#region src/host/tools/context-get.ts
/**
* research_context_get (WP-3.3) — STUB (the forwarding service has not
* landed yet; the report's stub table names the replacement).
*
* Parameter face: NONE — the tool reports the research context bound to
* the CALLING session (workstream, task, Run binding): there is no
* argument because there is no other subject to ask about (the session's
* own binding IS the context; the DSH session identity comes from the
* call context, never from arguments).
*/
/** Frozen §7.2 name. */
const RESEARCH_CONTEXT_GET = "research_context_get";
/** The frozen tool parameter key set (empty — the session context has no subject argument). */
const CONTEXT_GET_ARG_KEYS = [];
/** The tool's model-facing parameter face (no parameters). */
const CONTEXT_GET_PARAMETERS = {};
function parseContextGetArgs(args) {
	checkKeySet(assertArgsObject(args, RESEARCH_CONTEXT_GET), CONTEXT_GET_ARG_KEYS, RESEARCH_CONTEXT_GET);
}
function makeContextGetDefinition() {
	return makeStubDefinition({
		name: RESEARCH_CONTEXT_GET,
		description: "Get the research context bound to the current session: the workstream, the task (if any), and the formal Run binding.",
		access: "read",
		parameters: CONTEXT_GET_PARAMETERS,
		plannedService: "the research-context query service (runbinding + declarative loader composition; host wiring WP-3.6) — not yet landed (stub; see report)",
		parseArgs: parseContextGetArgs
	});
}
//#endregion
//#region src/host/tools/contract-read.ts
/**
* research_contract_read (WP-3.3) — STUB (the forwarding service has not
* landed yet; the report's stub table names the replacement).
*
* Parameter face: `edge_id` — the topology edge (TE-<n>) whose merge
* contract (`contract.md`) is read. The agent may EDIT contracts only by
* direct file editing inside the workspace (ARCHITECTURE §6 脚注 ²: the
* plugin neither blocks nor prompts it — there is deliberately NO
* contract-write tool; the read is the structured lane). Read-only by
* construction.
*/
/** Frozen §7.2 name. */
const RESEARCH_CONTRACT_READ = "research_contract_read";
/** The frozen tool parameter key set. */
const CONTRACT_READ_ARG_KEYS = ["edge_id"];
/** The tool's model-facing parameter face (frozen 1 key). */
const CONTRACT_READ_PARAMETERS = { edge_id: str("The topology edge id (TE-<n>) whose merge contract to read.", true) };
function parseContractReadArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_CONTRACT_READ);
	checkKeySet(obj, CONTRACT_READ_ARG_KEYS, RESEARCH_CONTRACT_READ);
	requireKey(obj, "edge_id", RESEARCH_CONTRACT_READ);
	if (typeof obj["edge_id"] !== "string" || obj["edge_id"].length === 0) throw new ToolError("TOOL_INPUT", "/edge_id: must be a non-empty string");
}
function makeContractReadDefinition() {
	return makeStubDefinition({
		name: RESEARCH_CONTRACT_READ,
		description: "Read the merge contract (contract.md) of a topology edge — the agreed integration conditions between workstreams. Read-only (editing happens by direct file edit in the workspace, not through a tool).",
		access: "read",
		parameters: CONTRACT_READ_PARAMETERS,
		plannedService: "the contract-read service (WP-1.4 MergeContractStore.readContract composition; host wiring WP-3.6) — not yet landed (stub; see report)",
		parseArgs: parseContractReadArgs
	});
}
//#endregion
//#region src/host/tools/fact-record.ts
/**
* research_fact_record (WP-3.3) — STUB (the forwarding service has not
* landed yet; the report's stub table names the replacement).
*
* Parameter face — frozen FACT_RECORDED payload (history-events.schema.json
* §5) + the envelope owner: `workstream_id` is the record's Workstream
* (INV-SCI-1: facts are Workstream-local; the service cross-checks it
* against the calling run's WS), `statement` (minLength 1), optional
* `references`. The id (F-<n>) and `created_by_run` are NOT arguments —
* the service allocates the id and attributes the event to the call
* context's run.
*/
/** Frozen §7.2 name. */
const RESEARCH_FACT_RECORD = "research_fact_record";
/** The frozen tool parameter key set. */
const FACT_RECORD_ARG_KEYS = [
	"workstream_id",
	"statement",
	"references"
];
/** The tool's model-facing parameter face (frozen 3 keys). */
const FACT_RECORD_PARAMETERS = {
	workstream_id: str("The workstream (WS id) the fact belongs to.", true),
	statement: str("The observed fact (data, measurement, observation), stated precisely.", true),
	references: optStrArray("Ids of the objects the fact references (T-/G-/M-/F-/C-…).")
};
function parseFactRecordArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_FACT_RECORD);
	checkKeySet(obj, FACT_RECORD_ARG_KEYS, RESEARCH_FACT_RECORD);
	requireKey(obj, "workstream_id", RESEARCH_FACT_RECORD);
	requireKey(obj, "statement", RESEARCH_FACT_RECORD);
	if (typeof obj["workstream_id"] !== "string" || obj["workstream_id"].length === 0) throw new ToolError("TOOL_INPUT", "/workstream_id: must be a non-empty string");
	if (typeof obj["statement"] !== "string" || obj["statement"].length === 0) throw new ToolError("TOOL_INPUT", "/statement: must be a non-empty string");
	assertOptionalStringArray(obj, "references");
}
function makeFactRecordDefinition() {
	return makeStubDefinition({
		name: RESEARCH_FACT_RECORD,
		description: "Record an observed fact (data, measurement, observation) into the workstream semantic registry. Workstream-local; attributed to your run.",
		access: "write",
		parameters: FACT_RECORD_PARAMETERS,
		plannedService: "the fact-recording service (FACT_RECORDED + registry row) — not yet landed (stub; see report)",
		parseArgs: parseFactRecordArgs
	});
}
//#endregion
//#region src/host/tools/history-query.ts
/**
* research_history_query (WP-3.3) — STUB (the forwarding service has not
* landed yet; the report's stub table names the replacement).
*
* Parameter face — a faithful projection of the WP-2.3 read-only query
* surface (`queryEvents`, seq-cursor pagination, §8 「History 按页面/时间
* 窗口分页」): `workstream_id` (the owner WS whose log is read — every
* HistoryEvent has exactly one owner, INV-HIST-3) + optional `order`
* ('semantic' | 'audit'), `after_seq` (exclusive lower bound, ≥ 0),
* `before_seq` (exclusive upper bound), `limit` (page size, ≥ 1).
* Read-only by construction — History mutation/delete has NO tool
* (INV-PERM-2; the matrix row 「History update/delete ❌ ❌ ❌ ❌」).
*/
/** Frozen §7.2 name. */
const RESEARCH_HISTORY_QUERY = "research_history_query";
/** The frozen replay-order vocabulary (WP-2.3 ReplayOrder). */
const HISTORY_ORDERS = ["semantic", "audit"];
/** The frozen tool parameter key set. */
const HISTORY_QUERY_ARG_KEYS = [
	"workstream_id",
	"order",
	"after_seq",
	"before_seq",
	"limit"
];
/** The tool's model-facing parameter face (frozen 5 keys). */
const HISTORY_QUERY_PARAMETERS = {
	workstream_id: str("The workstream (WS id) whose ResearchHistory to query (the event-log owner).", true),
	order: {
		type: "string",
		enum: [...HISTORY_ORDERS],
		description: "Replay order: semantic (research-time timeline, default) or audit (registration order)."
	},
	after_seq: {
		type: "integer",
		description: "Exclusive lower bound on eventSeq (start after this event; default 0 = from the beginning)."
	},
	before_seq: {
		type: "integer",
		description: "Exclusive upper bound on eventSeq (the first seq NOT included)."
	},
	limit: {
		type: "integer",
		description: "Page size in events (caps the window)."
	}
};
function parseHistoryQueryArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_HISTORY_QUERY);
	checkKeySet(obj, HISTORY_QUERY_ARG_KEYS, RESEARCH_HISTORY_QUERY);
	requireKey(obj, "workstream_id", RESEARCH_HISTORY_QUERY);
	if (typeof obj["workstream_id"] !== "string" || obj["workstream_id"].length === 0) throw new ToolError("TOOL_INPUT", "/workstream_id: must be a non-empty string");
	if (obj["order"] !== void 0) assertEnum(obj["order"], "/order", HISTORY_ORDERS);
	assertOptionalInteger(obj, "after_seq", { min: 0 });
	assertOptionalInteger(obj, "before_seq", { min: 1 });
	assertOptionalInteger(obj, "limit", { min: 1 });
}
function makeHistoryQueryDefinition() {
	return makeStubDefinition({
		name: RESEARCH_HISTORY_QUERY,
		description: "Query a workstream ResearchHistory (the append-only research event log) with seq-cursor pagination. Read-only: the log cannot be mutated or deleted from any agent surface.",
		access: "read",
		parameters: HISTORY_QUERY_PARAMETERS,
		plannedService: "the history-query service (WP-2.3 queryEvents composition; host wiring WP-3.6) — not yet landed (stub; see report)",
		parseArgs: parseHistoryQueryArgs
	});
}
//#endregion
//#region src/host/tools/intervention-create.ts
/**
* research_intervention_create (WP-3.3) — STUB (the forwarding service has
* not landed yet; the report's stub table names the replacement).
*
* Parameter face — frozen INTERVENTION_CREATED payload / DOMAIN_SCHEMA
* §9.2, restricted to the agent's matrix lane: the agent CREATES
* interventions (origin is fixed to AGENT_REPORT — the matrix footnote
* 「运行时明确要求人工判断的 Agent report」), but may NEVER touch their
* state (OPEN/PENDING/CLOSED is user-only, INV-PERM-4 — no state tool
* exists). `origin` is therefore NOT an argument; the `created_by` actor
* comes from the call context.
*/
/** Frozen §7.2 name. */
const RESEARCH_INTERVENTION_CREATE = "research_intervention_create";
/** The frozen object-kind vocabulary (common.schema.json $defs/objectKind — typedRef.kind). */
const OBJECT_KINDS = [
	"PROJECT",
	"TOPIC",
	"WORKSTREAM",
	"TASK",
	"GATE",
	"MILESTONE",
	"RUN",
	"CLAIM",
	"FACT",
	"ARTIFACT",
	"RELATION",
	"OBJECTIVE",
	"INTERVENTION",
	"NEXT_ACTION",
	"BLOCKER",
	"INTERACTION",
	"REPORTING_ITEM",
	"SCHEDULED_EVENT",
	"INBOX_ITEM",
	"PLAN_FORK",
	"TOPOLOGY_EDGE",
	"DISCOVERED_SESSION",
	"HISTORY_EVENT",
	"ANALYSIS_RECORD"
];
/** The frozen tool parameter key set. */
const INTERVENTION_CREATE_ARG_KEYS = [
	"title",
	"detail",
	"workstream_ids",
	"source_refs"
];
/** The tool's model-facing parameter face (frozen 4 keys). */
const INTERVENTION_CREATE_PARAMETERS = {
	title: str("What the human must decide or attend to, in one line.", true),
	detail: str("Optional supporting detail (what was observed, what is at stake)."),
	workstream_ids: {
		type: "array",
		items: { type: "string" },
		description: "Optional related workstream ids (WS-<n>); the first is the event owner when one exists."
	},
	source_refs: {
		type: "array",
		items: {
			type: "object",
			additionalProperties: false,
			properties: {
				kind: {
					type: "string",
					required: true,
					enum: [...OBJECT_KINDS],
					description: "The referenced object kind (common.schema.json objectKind — e.g. PLAN_FORK, FACT, CLAIM, TASK)."
				},
				id: {
					type: "string",
					required: true,
					description: "The object id."
				}
			}
		},
		description: "Optional references to the triggering objects."
	}
};
function parseInterventionCreateArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_INTERVENTION_CREATE);
	checkKeySet(obj, INTERVENTION_CREATE_ARG_KEYS, RESEARCH_INTERVENTION_CREATE);
	requireKey(obj, "title", RESEARCH_INTERVENTION_CREATE);
	if (typeof obj["title"] !== "string" || obj["title"].length === 0) throw new ToolError("TOOL_INPUT", "/title: must be a non-empty string");
	const detail = obj["detail"];
	if (detail !== void 0 && (typeof detail !== "string" || detail.length === 0)) throw new ToolError("TOOL_INPUT", "/detail: must be a non-empty string");
	assertOptionalStringArray(obj, "workstream_ids");
	const sourceRefs = obj["source_refs"];
	if (sourceRefs !== void 0) {
		if (!Array.isArray(sourceRefs)) throw new ToolError("TOOL_INPUT", "/source_refs: must be an array");
		sourceRefs.forEach((ref, i) => {
			const r = assertObject(ref, `/source_refs/${i}`);
			checkKeySet(r, ["kind", "id"], "a source ref", `/source_refs/${i}`);
			assertEnum(r["kind"], `/source_refs/${i}/kind`, OBJECT_KINDS);
			if (typeof r["id"] !== "string" || r["id"].length === 0) throw new ToolError("TOOL_INPUT", `/source_refs/${i}/id: must be a non-empty string`);
		});
	}
}
function makeInterventionCreateDefinition() {
	return makeStubDefinition({
		name: RESEARCH_INTERVENTION_CREATE,
		description: "Raise an item that requires a human decision or attention (it lands as an OPEN intervention the user manages). Use only when the work genuinely needs human judgment — the plugin never raises one for scientific conflicts on its own, and you cannot change an intervention's state after creating it.",
		access: "write",
		parameters: INTERVENTION_CREATE_PARAMETERS,
		plannedService: "the intervention service (INTERVENTION_CREATED; WP-5.1 lifecycle) — not yet landed (stub; see report)",
		parseArgs: parseInterventionCreateArgs
	});
}
//#endregion
//#region src/host/tools/next-action-create.ts
/**
* research_next_action_create (WP-3.3) — STUB (the forwarding service has
* not landed yet; the report's stub table names the replacement).
*
* Parameter face — DOMAIN_SCHEMA §9.3 NextAction, restricted to the
* agent's matrix lane: the agent CREATES NextActions (status defaults to
* PROPOSED — not an argument), but may NEVER PROMOTE (→ Task) or DISMISS
* them (user-only, the matrix row 「NextAction PROMOTE/DISMISS ✅/❌」 —
* no such tool exists). `id` / `created_by` / `created_at` come from the
* service and the call context.
*/
/** Frozen §7.2 name. */
const RESEARCH_NEXT_ACTION_CREATE = "research_next_action_create";
/** The frozen tool parameter key set. */
const NEXT_ACTION_CREATE_ARG_KEYS = [
	"workstream_id",
	"statement",
	"rationale"
];
/** The tool's model-facing parameter face (frozen 3 keys). */
const NEXT_ACTION_CREATE_PARAMETERS = {
	workstream_id: str("Optional workstream (WS id) the next action belongs to."),
	statement: str("The lightweight \"possibly worth doing\" action, in one line (not a Task).", true),
	rationale: str("Optional: why it is worth considering.")
};
function parseNextActionCreateArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_NEXT_ACTION_CREATE);
	checkKeySet(obj, NEXT_ACTION_CREATE_ARG_KEYS, RESEARCH_NEXT_ACTION_CREATE);
	requireKey(obj, "statement", RESEARCH_NEXT_ACTION_CREATE);
	if (typeof obj["statement"] !== "string" || obj["statement"].length === 0) throw new ToolError("TOOL_INPUT", "/statement: must be a non-empty string");
	assertOptionalString(obj, "workstream_id");
	assertOptionalString(obj, "rationale");
}
function makeNextActionCreateDefinition() {
	return makeStubDefinition({
		name: RESEARCH_NEXT_ACTION_CREATE,
		description: "Propose a lightweight next action that may be worth doing (NOT a Task). The user decides: they promote it into a formal Task or dismiss it — you cannot do either.",
		access: "write",
		parameters: NEXT_ACTION_CREATE_PARAMETERS,
		plannedService: "the next-action service (PROPOSED row; WP-5.2 lifecycle) — not yet landed (stub; see report)",
		parseArgs: parseNextActionCreateArgs
	});
}
//#endregion
//#region src/host/tools/plan-fork-create.ts
/** Frozen §7.2 name. */
const RESEARCH_PLAN_FORK_CREATE = "research_plan_fork_create";
/**
* The frozen tool parameter key set — the §4 input list MINUS the call
* context (actor/run) and MINUS any base (INV-PLAN-6). The runtime guard
* below refuses every other key; a `base*` key gets the invariant-specific
* message.
*/
const PLAN_FORK_CREATE_ARG_KEYS = [
	"workstream_id",
	"fork_anchor",
	"merge_anchor",
	"proposed_items",
	"trigger_refs",
	"reason",
	"necessity"
];
/** The frozen item-kind / trigger-kind vocabularies (frozen schema spellings). */
const PLAN_FORK_ITEM_KINDS = [
	"TASK",
	"GATE",
	"MILESTONE"
];
const PLAN_FORK_TRIGGER_KINDS = [
	"CLAIM",
	"FACT",
	"ARTIFACT",
	"MILESTONE",
	"OBJECTIVE"
];
const titleSpec = (description) => ({
	type: "string",
	required: true,
	description
});
/** NewItemSpecTask (frozen $defs — title+goal required, exact keys). */
const TASK_SPEC = {
	type: "object",
	additionalProperties: false,
	properties: {
		title: titleSpec("Task title (<= 200 chars)."),
		goal: {
			type: "string",
			required: true,
			description: "What the task achieves."
		},
		deliverables: {
			type: "array",
			items: { type: "string" },
			description: "Concretes the task delivers."
		},
		acceptance_criteria: {
			type: "array",
			items: { type: "string" },
			description: "How success is verified."
		}
	}
};
/** NewItemSpecGate (frozen $defs — title+criteria required, exact keys). */
const GATE_SPEC = {
	type: "object",
	additionalProperties: false,
	properties: {
		title: titleSpec("Gate title (<= 200 chars)."),
		criteria: {
			type: "string",
			required: true,
			description: "What must hold for the gate to pass."
		},
		references: {
			type: "array",
			items: { type: "string" },
			description: "Ids of the objects the criteria reference."
		}
	}
};
/** NewItemSpecMilestone (frozen $defs — title+statement required, exact keys). */
const MILESTONE_SPEC = {
	type: "object",
	additionalProperties: false,
	properties: {
		title: titleSpec("Milestone title (<= 200 chars)."),
		statement: {
			type: "string",
			required: true,
			description: "The state the milestone declares."
		}
	}
};
/** The tool's model-facing parameter face (frozen 7 keys — no base, no run). */
const PLAN_FORK_CREATE_PARAMETERS = {
	workstream_id: {
		type: "string",
		required: true,
		description: "The workstream (WS id) whose canonical future plan the proposal replaces a span of."
	},
	fork_anchor: {
		type: "string",
		required: true,
		description: "Canonical item id (T-/G-/M-<n>) or the boundary sentinel __START__: the last canonical item kept before the replaced open span."
	},
	merge_anchor: {
		type: "string",
		required: true,
		description: "Canonical item id or __END__: the canonical item the proposal re-joins at; its ordinal must be >= fork_anchor (equal = pure insertion)."
	},
	proposed_items: {
		type: "array",
		required: true,
		description: "Ordered replacement for the open span (fork_anchor, merge_anchor): KEEP keeps a canonical item (it may move), NEW adds a new one. Unreferenced items in the span are dropped. At least one entry.",
		items: { oneOf: [{
			type: "object",
			additionalProperties: false,
			properties: {
				action: {
					type: "string",
					const: "KEEP",
					required: true,
					description: "Keep an existing canonical item."
				},
				kind: {
					type: "string",
					enum: [...PLAN_FORK_ITEM_KINDS],
					required: true,
					description: "The item kind of the reference."
				},
				ref: {
					type: "string",
					required: true,
					description: "The canonical item id (T-<n>/G-<n>/M-<n>) to keep."
				}
			}
		}, {
			type: "object",
			additionalProperties: false,
			properties: {
				action: {
					type: "string",
					const: "NEW",
					required: true,
					description: "Add a new item (formal id assigned only if the user SELECTs)."
				},
				kind: {
					type: "string",
					enum: [...PLAN_FORK_ITEM_KINDS],
					required: true,
					description: "The kind of the new item; the spec shape must match."
				},
				spec: {
					required: true,
					description: "The declaration of the new item (frozen per-kind shape).",
					oneOf: [
						TASK_SPEC,
						GATE_SPEC,
						MILESTONE_SPEC
					]
				}
			}
		}] }
	},
	trigger_refs: {
		type: "array",
		required: true,
		description: "Existing objects that justify the proposal (CLAIM/FACT/ARTIFACT/MILESTONE/OBJECTIVE). At least one; each must exist.",
		items: {
			type: "object",
			additionalProperties: false,
			properties: {
				kind: {
					type: "string",
					enum: [...PLAN_FORK_TRIGGER_KINDS],
					required: true,
					description: "The kind of the referenced object."
				},
				id: {
					type: "string",
					required: true,
					description: "The id of the referenced object."
				}
			}
		}
	},
	reason: {
		type: "string",
		required: true,
		description: "Why the plan needs this change (the scientific rationale, in your words)."
	},
	necessity: {
		type: "string",
		required: true,
		description: "What breaks if the change is not made."
	}
};
/**
* The canonical output contract (frozen $defs/PlanFork, 17 properties /
* 12 required — the created record is always OPEN, so the selected-at /
* dismissed-at / stale-reason keys are absent in practice but part of the
* frozen record shape).
*/
const PLAN_FORK_CREATE_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["status", "plan_fork"],
	properties: {
		status: { const: "created" },
		plan_fork: {
			type: "object",
			additionalProperties: false,
			required: [
				"id",
				"workstream_id",
				"base_plan_objects",
				"fork_anchor",
				"merge_anchor",
				"proposed_items",
				"trigger_refs",
				"reason",
				"necessity",
				"created_by_run",
				"created_at",
				"status"
			],
			properties: {
				id: { type: "string" },
				workstream_id: { type: "string" },
				base_plan_objects: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						required: ["path", "git_blob_oid"],
						properties: {
							path: { type: "string" },
							git_blob_oid: {
								type: "string",
								pattern: "^[0-9a-f]{40}$"
							}
						}
					}
				},
				base_git_commit: { type: "string" },
				fork_anchor: { type: "string" },
				merge_anchor: { type: "string" },
				proposed_items: { type: "array" },
				trigger_refs: { type: "array" },
				reason: { type: "string" },
				necessity: { type: "string" },
				created_by_run: { type: "string" },
				created_at: { type: "integer" },
				status: { enum: [
					"OPEN",
					"SELECTED",
					"DISMISSED",
					"STALE"
				] },
				selected_at: { type: "integer" },
				selected_by: { type: "object" },
				dismissed_at: { type: "integer" },
				stale_reason: { type: "string" }
			}
		}
	}
};
const BASE_VIOLATION_NOTE = (key) => /^base/i.test(key) ? `${JSON.stringify(key)} is never an input: the proposal base is ALWAYS recomputed by the server from the current canonical plan (PLAN_FORK_SPEC §4 步骤 3 / ARCHITECTURE §5.4 INV-PLAN-6)` : null;
function parseProposedItem(value, path) {
	const obj = assertObject(value, path);
	const action = obj["action"];
	if (action !== "KEEP" && action !== "NEW") throw new ToolError("TOOL_INPUT", `${path}/action: expected 'KEEP' or 'NEW', got ${JSON.stringify(action)}`);
	const kind = assertEnum(obj["kind"], `${path}/kind`, PLAN_FORK_ITEM_KINDS);
	if (action === "KEEP") {
		checkKeySet(obj, [
			"action",
			"kind",
			"ref"
		], "a KEEP proposed item", path);
		return {
			action: "KEEP",
			kind,
			ref: assertString(obj["ref"], `${path}/ref`, true)
		};
	}
	checkKeySet(obj, [
		"action",
		"kind",
		"spec"
	], "a NEW proposed item", path);
	return {
		action: "NEW",
		kind,
		spec: parseNewItemSpec(obj["spec"], `${path}/spec`)
	};
}
/** Shape-based parse of the frozen per-kind spec oneOf (kind↔spec matching is step 4's job). */
function parseNewItemSpec(value, path) {
	const obj = assertObject(value, path);
	if ("goal" in obj) {
		checkKeySet(obj, [
			"title",
			"goal",
			"deliverables",
			"acceptance_criteria"
		], "a task spec", path);
		const deliverables = assertOptionalStringArray(obj, "deliverables", path);
		const acceptanceCriteria = assertOptionalStringArray(obj, "acceptance_criteria", path);
		return {
			title: assertString(obj["title"], `${path}/title`, true),
			goal: assertString(obj["goal"], `${path}/goal`, true),
			...deliverables !== void 0 ? { deliverables: [...deliverables] } : {},
			...acceptanceCriteria !== void 0 ? { acceptance_criteria: [...acceptanceCriteria] } : {}
		};
	}
	if ("criteria" in obj) {
		checkKeySet(obj, [
			"title",
			"criteria",
			"references"
		], "a gate spec", path);
		const references = assertOptionalStringArray(obj, "references", path);
		return {
			title: assertString(obj["title"], `${path}/title`, true),
			criteria: assertString(obj["criteria"], `${path}/criteria`, true),
			...references !== void 0 ? { references: [...references] } : {}
		};
	}
	if ("statement" in obj) {
		checkKeySet(obj, ["title", "statement"], "a milestone spec", path);
		return {
			title: assertString(obj["title"], `${path}/title`, true),
			statement: assertString(obj["statement"], `${path}/statement`, true)
		};
	}
	throw new ToolError("TOOL_INPUT", `${path}: a spec must declare one of the frozen shapes (task: title+goal; gate: title+criteria; milestone: title+statement)`);
}
function parseTriggerRef(value, path) {
	const obj = assertObject(value, path);
	checkKeySet(obj, ["kind", "id"], "a trigger ref", path);
	return {
		kind: assertEnum(obj["kind"], `${path}/kind`, PLAN_FORK_TRIGGER_KINDS),
		id: assertString(obj["id"], `${path}/id`, true)
	};
}
/**
* Validate + parse the frozen 7-key wire face. Throws TOOL_INPUT with a
* precise path on any violation; a `base*` key is refused with the
* INV-PLAN-6 note (the tool face is base-less by construction).
*/
function parsePlanForkCreateArgs(args) {
	const obj = assertObjectOrToolInput(args);
	checkKeySet(obj, PLAN_FORK_CREATE_ARG_KEYS, RESEARCH_PLAN_FORK_CREATE, "", BASE_VIOLATION_NOTE);
	for (const key of PLAN_FORK_CREATE_ARG_KEYS) requireKey(obj, key, RESEARCH_PLAN_FORK_CREATE);
	const items = assertArray(obj["proposed_items"], "/proposed_items", 1);
	const refs = assertArray(obj["trigger_refs"], "/trigger_refs", 1);
	return {
		workstream_id: assertString(obj["workstream_id"], "/workstream_id", true),
		fork_anchor: assertString(obj["fork_anchor"], "/fork_anchor", true),
		merge_anchor: assertString(obj["merge_anchor"], "/merge_anchor", true),
		proposed_items: items.map((item, i) => parseProposedItem(item, `/proposed_items/${i}`)),
		trigger_refs: refs.map((ref, i) => parseTriggerRef(ref, `/trigger_refs/${i}`)),
		reason: assertString(obj["reason"], "/reason", true),
		necessity: assertString(obj["necessity"], "/necessity", true)
	};
}
/** args.ts's assertArgsObject re-pointed at this tool (path `/`). */
function assertObjectOrToolInput(args) {
	if (args === null || typeof args !== "object" || Array.isArray(args)) throw new ToolError("TOOL_INPUT", `/: arguments must be a JSON object (tool ${RESEARCH_PLAN_FORK_CREATE})`);
	return args;
}
function makePlanForkCreateDefinition(deps) {
	return buildTool({
		name: RESEARCH_PLAN_FORK_CREATE,
		description: "Propose a change to a workstream canonical future plan as an append-only PlanFork proposal for the user to SELECT or DISMISS — you cannot modify the canonical plan directly. proposed_items replace the open span (fork_anchor, merge_anchor): KEEP keeps a canonical item (it may move), NEW adds a new item (formal ids are assigned only on selection); unreferenced items in the span are dropped. The proposal base is always recomputed by the server from the current canonical plan — a base is never an input. The creating run comes from your session binding, not an argument. Validation is mechanical only (references exist, fields present, anchors legal); the scientific justification is yours to state in reason/necessity.",
		access: "write",
		requiresRun: true,
		parameters: PLAN_FORK_CREATE_PARAMETERS,
		output: {
			schema: PLAN_FORK_CREATE_OUTPUT_SCHEMA,
			render: (_args, value) => {
				const v = value;
				return [{
					type: "text",
					text: `Plan fork ${v.plan_fork.id} created for ${v.plan_fork.workstream_id} (status ${v.plan_fork.status}) — awaiting the user's SELECT/DISMISS`
				}];
			}
		},
		handle: async (args, ctx) => {
			const parsed = parsePlanForkCreateArgs(args);
			if (ctx.runId === void 0) throw new ToolError("TOOL_RUN_REQUIRED", `${RESEARCH_PLAN_FORK_CREATE}: the creating run is missing from the call context`);
			try {
				return {
					status: "created",
					plan_fork: toToolJsonValue(deps.planForkCreate({
						workstreamId: parsed.workstream_id,
						forkAnchor: parsed.fork_anchor,
						mergeAnchor: parsed.merge_anchor,
						proposedItems: parsed.proposed_items,
						triggerRefs: parsed.trigger_refs,
						reason: parsed.reason,
						necessity: parsed.necessity,
						createdByRun: ctx.runId
					}))
				};
			} catch (cause) {
				if (cause instanceof PlanForkError) throw new ToolError("TOOL_SERVICE", `${RESEARCH_PLAN_FORK_CREATE}: ${cause.message}`, {
					cause,
					detail: {
						serviceCode: cause.code,
						...cause.step !== void 0 ? { step: cause.step } : {},
						...cause.path !== void 0 ? { path: cause.path } : {}
					}
				});
				throw new ToolError("TOOL_SERVICE", `${RESEARCH_PLAN_FORK_CREATE}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
			}
		}
	});
}
//#endregion
//#region src/host/tools/plan-get.ts
/**
* research_plan_get (WP-3.3) — STUB (the forwarding service has not
* landed yet; the report's stub table names the replacement).
*
* Parameter face: `workstream_id` — the tool reads the workstream's
* canonical Future Plan (the stable ordered G/T/M sequence,
* `plan.yaml`). Read-only by construction (INV-PLAN-3: the agent has no
* plan write path at any surface; the read is the only lane).
*/
/** Frozen §7.2 name. */
const RESEARCH_PLAN_GET = "research_plan_get";
/** The frozen tool parameter key set. */
const PLAN_GET_ARG_KEYS = ["workstream_id"];
/** The tool's model-facing parameter face (frozen 1 key). */
const PLAN_GET_PARAMETERS = { workstream_id: str("The workstream (WS id) whose canonical future plan to read.", true) };
function parsePlanGetArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_PLAN_GET);
	checkKeySet(obj, PLAN_GET_ARG_KEYS, RESEARCH_PLAN_GET);
	requireKey(obj, "workstream_id", RESEARCH_PLAN_GET);
	if (typeof obj["workstream_id"] !== "string" || obj["workstream_id"].length === 0) throw new ToolError("TOOL_INPUT", "/workstream_id: must be a non-empty string");
}
function makePlanGetDefinition() {
	return makeStubDefinition({
		name: RESEARCH_PLAN_GET,
		description: "Read a workstream canonical future plan: the stable ordered sequence of Goals / Tasks / Gates / Milestones (plan.yaml). Read-only.",
		access: "read",
		parameters: PLAN_GET_PARAMETERS,
		plannedService: "the canonical-plan query service (WP-1.3 PlanStore.loadPlan composition; host wiring WP-3.6) — not yet landed (stub; see report)",
		parseArgs: parsePlanGetArgs
	});
}
//#endregion
//#region src/host/tools/run-checkpoint.ts
/**
* research_run_checkpoint (WP-3.3) — the agent's Run checkpoint report.
*
* The matrix row 「Run 生命周期事件」 gives the agent exactly ONE lane: the
* checkpoint report (INV-PERM-1 「Run checkpoint 报告」). This tool forwards
* to the WP-2.4 `RunBindingService.recordCheckpoint` surface (injected as
* `ResearchToolDeps.recordCheckpoint`): the operational `last_checkpoint_at`
* / `last_checkpoint_note` update — an operational note, NO History event
* (the chronicle records Run boundaries only) and NO git commit (that is
* the user-only `saveResearchCheckpoint`, INV-GIT-2 — a different surface,
* absent from the tool face).
*
* Parameter face: `run_id` (the formal run to note — the agent reports its
* OWN run; the forwarded actor is the calling AGENT actorRef, so the
* service's USER-or-AGENT gate sees a legitimate agent reporter) + optional
* `note`. The success value is the updated frozen run record (run.schema.json
* `$defs/Run`, 14 properties / 5 required).
*/
/** Frozen §7.2 name. */
const RESEARCH_RUN_CHECKPOINT = "research_run_checkpoint";
/** The frozen tool parameter key set. */
const RUN_CHECKPOINT_ARG_KEYS = ["run_id", "note"];
/** The tool's model-facing parameter face (frozen 2 keys). */
const RUN_CHECKPOINT_PARAMETERS = {
	run_id: {
		type: "string",
		required: true,
		description: "The id (R-<n>) of the formal run to report a checkpoint for — normally your own run."
	},
	note: {
		type: "string",
		description: "Optional short note: which stable point you reached and what it was."
	}
};
/** The canonical output contract (frozen $defs/Run). */
const RUN_CHECKPOINT_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["status", "run"],
	properties: {
		status: { const: "ok" },
		run: {
			type: "object",
			additionalProperties: false,
			required: [
				"id",
				"workstream_id",
				"status",
				"initiated_by",
				"started_at"
			],
			properties: {
				id: { type: "string" },
				workstream_id: { type: "string" },
				task_id: { type: "string" },
				dsh_session_id: { type: "string" },
				status: { enum: [
					"RUNNING",
					"FINISHED",
					"FAILED",
					"CANCELLED"
				] },
				intent: { type: "string" },
				initiated_by: { type: "object" },
				started_at: { type: "integer" },
				ended_at: { type: "integer" },
				summary: { type: "string" },
				last_checkpoint_at: { type: "integer" },
				last_checkpoint_note: { type: "string" }
			}
		}
	}
};
/** Validate + parse the frozen 2-key wire face. */
function parseRunCheckpointArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_RUN_CHECKPOINT);
	checkKeySet(obj, RUN_CHECKPOINT_ARG_KEYS, RESEARCH_RUN_CHECKPOINT);
	requireKey(obj, "run_id", RESEARCH_RUN_CHECKPOINT);
	const runId = obj["run_id"];
	if (typeof runId !== "string" || runId.length === 0) throw new ToolError("TOOL_INPUT", "/run_id: must be a non-empty string");
	return {
		run_id: runId,
		note: assertOptionalString(obj, "note")
	};
}
function makeRunCheckpointDefinition(deps) {
	return buildTool({
		name: RESEARCH_RUN_CHECKPOINT,
		description: "Report a checkpoint note for a research run: an operational note recording that you reached a stable point (what it was). Does not commit anything to Git and does not change the run state or write a History event.",
		access: "write",
		requiresRun: true,
		parameters: RUN_CHECKPOINT_PARAMETERS,
		output: {
			schema: RUN_CHECKPOINT_OUTPUT_SCHEMA,
			render: (_args, value) => {
				const v = value;
				const note = v.run.last_checkpoint_note;
				return [{
					type: "text",
					text: `Checkpoint recorded on run ${v.run.id}${note !== void 0 && note.length > 0 ? ` — ${note}` : ""}`
				}];
			}
		},
		handle: async (args, ctx) => {
			const parsed = parseRunCheckpointArgs(args);
			const reporter = {
				kind: "AGENT",
				...ctx.actor.run_id !== void 0 ? { run_id: ctx.actor.run_id } : {},
				...ctx.actor.session_id !== void 0 ? { session_id: ctx.actor.session_id } : {},
				...ctx.actor.label !== void 0 ? { label: ctx.actor.label } : {}
			};
			try {
				return {
					status: "ok",
					run: toToolJsonValue(deps.recordCheckpoint(parsed.run_id, parsed.note === void 0 ? {} : { note: parsed.note }, reporter))
				};
			} catch (cause) {
				if (cause instanceof RunBindingError) throw new ToolError("TOOL_SERVICE", `${RESEARCH_RUN_CHECKPOINT}: ${cause.message}`, {
					cause,
					detail: { serviceCode: cause.code }
				});
				throw new ToolError("TOOL_SERVICE", `${RESEARCH_RUN_CHECKPOINT}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
			}
		}
	});
}
//#endregion
//#region src/host/tools/index.ts
/**
* The exact §7.2 tool list (doc order: writable group, then read-only
* group). This constant IS the frozen list — tests audit it verbatim and
* the host wiring WP registers exactly these names.
*/
const RESEARCH_TOOL_NAMES = [
	RESEARCH_FACT_RECORD,
	RESEARCH_CLAIM_RECORD,
	RESEARCH_ARTIFACT_REGISTER,
	RESEARCH_INTERVENTION_CREATE,
	RESEARCH_NEXT_ACTION_CREATE,
	RESEARCH_PLAN_FORK_CREATE,
	RESEARCH_RUN_CHECKPOINT,
	RESEARCH_CONTEXT_GET,
	RESEARCH_PLAN_GET,
	RESEARCH_HISTORY_QUERY,
	RESEARCH_CONTRACT_READ
];
RESEARCH_TOOL_NAMES.slice(0, 7);
RESEARCH_TOOL_NAMES.slice(7);
/**
* Compose the complete tool face over the two service ports.
* Fail-loud on a malformed deps object (misconfiguration is a
* composition-time error, not a per-call surprise). The returned
* definitions are frozen and registered by the host wiring WP (WP-3.6)
* — one `defineTool` adaptation per definition.
*/
function createResearchTools(deps) {
	assertDeps(deps);
	return [
		makeFactRecordDefinition(),
		makeClaimRecordDefinition(),
		makeArtifactRegisterDefinition(),
		makeInterventionCreateDefinition(),
		makeNextActionCreateDefinition(),
		makePlanForkCreateDefinition(deps),
		makeRunCheckpointDefinition(deps),
		makeContextGetDefinition(),
		makePlanGetDefinition(),
		makeHistoryQueryDefinition(),
		makeContractReadDefinition()
	];
}
/** Both ports must be functions (fail loud at composition). */
function assertDeps(deps) {
	if (deps === null || typeof deps !== "object") throw new TypeError("createResearchTools: deps must be an object with the two service ports");
	if (typeof deps.planForkCreate !== "function") throw new TypeError("createResearchTools: deps.planForkCreate must be the PlanFork creation service (WP-3.1 chain)");
	if (typeof deps.recordCheckpoint !== "function") throw new TypeError("createResearchTools: deps.recordCheckpoint must be the RunBindingService.recordCheckpoint surface (WP-2.4)");
}
//#endregion
//#region src/host/service/investigator/types.ts
/**
* The agent preset the plugin authors and the launcher mounts
* (`research-investigator/agent.cordis.yml` under the user preset root
* `$DSH_HOME/.agent-presets` — DSH_ADAPTER §10.2 路径 A step 3 「专用
* agent preset（agent.cordis.yml 只挂只读工具）」）。The id IS a path
* segment (DSH `PRESET_ID = /^[a-z0-9][a-z0-9-]*$/`), so a lowercase
* hyphenated literal.
*/
const INVESTIGATOR_PRESET_ID = "research-investigator";
/**
* The permission preset the launcher submits as `/permission read-only`
* (DSH_ADAPTER §10.2 路径 A step 2). The name is FROZEN by the host's
* preset table (checkout `packages/bundle/base/cordis.patch.yml:197-199`:
* `read-only: {sandbox: read-only, approval: ask}` — the web profile) and
* by the `SandboxMode` vocabulary (`packages/sandbox/sandbox-policy/src/
* session-mode.ts:42` — `'read-only'` is the first, fail-safe mode;
* `sandbox-policy/src/index.ts:94` default). Only this literal is
* launchable — `workspace-write` / `danger-full-access` are compile
* errors on the request face (INV-PERM-3 类型面).
*/
const READ_ONLY_PERMISSION_PRESET = "read-only";
/**
* The closed set of DSH tool packages the investigator preset
* composition may mount (DSH_ADAPTER §10.2: 「preset 只注册只读工具」—
* INV-PERM-3 第一层). Chosen for 计划书 §26.1 可读清单:
*  - `@deepseek-ai/dsh-tool-bash` — workspace files + Git history/diff
*    (read commands; every write is rejected by the read-only sandbox
*    backend — session-mode.ts:11-12 「EXECUTION honors the same fold」);
*  - `@deepseek-ai/dsh-tool-fs-search` — pure workspace file search
*    (no write function exists in the tool).
* `@deepseek-ai/dsh-tool-fs` is deliberately EXCLUDED (its `write`/`edit`
* functions would sit in the catalog and be rejected per-call — noise for
* the model; bash + search cover §26.1's file reads). The 4 read-only
* research tools (ARCHITECTURE §7.2) need no preset row: the plugin's
* host service registers them on the GLOBAL tools layer, and the
* per-agent restriction below denies only the writable 7.
*/
const INVESTIGATOR_PRESET_TOOL_NAMES = ["@deepseek-ai/dsh-tool-bash", "@deepseek-ai/dsh-tool-fs-search"];
/**
* The closed set of capabilities a read-only Investigator may have —
* the whitelist the runtime assertion measures against（INV-PERM-3:
* 「无任何写路径」; 计划书 §26.1 可读清单的机械编码）。**No write
* capability exists in the set — not even as a refused option**（the
* matrix column is all-❌, ARCHITECTURE §6）.
*/
const INVESTIGATOR_CAPABILITIES = [
	"read-workspace-files",
	"read-git-history",
	"read-research-state"
];
var InvestigatorLaunchError = class extends Error {
	code;
	constructor(init) {
		super(init.message, init.cause === void 0 ? void 0 : { cause: init.cause });
		this.name = "InvestigatorLaunchError";
		this.code = init.code;
	}
};
//#endregion
//#region src/host/service/investigator/context.ts
/**
* 前置校验错误码归一: 缝入口的输入畸形统一 `IVL_INPUT`（模块边界参数
* 畸形 — 同 IV_INPUT 口径）; 指名失败项进 message（fail loud, 不猜）。
*/
function badInput(what, value) {
	return new InvestigatorLaunchError({
		code: "IVL_INPUT",
		message: `buildInvestigationContext: ${what} is invalid: ${JSON.stringify(value)}`
	});
}
/** `IV-<n>` 形状（DOMAIN_SCHEMA §1.1 — 与 IdAllocator 产物同形, 不跨包
*  import 解析器: 缝只验形状, id 注册表归 shared/ids 单一来源）。 */
const IV_ID = /^IV-\d+$/u;
/**
* 从 Intervention 行构建一键启动上下文（任务目标 3）。
*
* @param intervention - Intervention 记录（WP-3.5 `InterventionRecord`
*   1:1 类型 — 不复制字段面; 本函数只**读**）。
* @param question - 用户的调查问题（trim 后非空 — 「进一步解释」的
*   解释目标; 空问题无调查, IVL_INPUT）。
* @param cwd - 研究工作区根（absolute — 只读沙箱的 workspace 边界;
*   相对路径 IVL_INPUT: 沙箱边界必须是 canonical 绝对路径）。
* @returns 冻结的 `InvestigationContext`（引用相关上下文 ①-④: id/title/
*   detail/origin/workstreams/sourceRefs + question + cwd）。
* @throws {@link InvestigatorLaunchError} `IVL_INPUT` — 空 question /
*   非 absolute cwd / 坏 intervention id / 未知 origin。
*/
function buildInvestigationContext(intervention, question, cwd) {
	if (typeof question !== "string" || question.trim() === "") throw badInput("question", question);
	if (typeof cwd !== "string" || !cwd.startsWith("/")) throw badInput("cwd (must be an absolute path)", cwd);
	if (typeof intervention.id !== "string" || !IV_ID.test(intervention.id)) throw badInput("intervention.id", intervention.id);
	if (typeof intervention.title !== "string" || intervention.title.trim() === "") throw badInput("intervention.title", intervention.title);
	if (!isInterventionOrigin(intervention.origin)) throw badInput("intervention.origin (§1.4 4 值闭集)", intervention.origin);
	const workstreamIds = [];
	for (const ws of intervention.workstream_ids) {
		if (typeof ws !== "string" || ws.trim() === "") throw badInput("intervention.workstream_ids entry", ws);
		workstreamIds.push(ws);
	}
	const sourceRefs = [];
	for (const ref of intervention.source_refs) {
		if (typeof ref !== "object" || ref === null || typeof ref.kind !== "string" || typeof ref.id !== "string" || ref.kind === "" || ref.id === "") throw badInput("intervention.source_refs entry (TypedRef {kind,id})", ref);
		sourceRefs.push({
			kind: ref.kind,
			id: ref.id
		});
	}
	return Object.freeze({
		interventionId: intervention.id,
		title: intervention.title,
		...intervention.detail === void 0 ? {} : { detail: intervention.detail },
		origin: intervention.origin,
		workstreamIds: Object.freeze(workstreamIds),
		sourceRefs: Object.freeze(sourceRefs),
		question: question.trim(),
		cwd
	});
}
/** §1.4 origin 4 值闭集守卫（运行面 — 类型面是 InterventionOrigin）。 */
function isInterventionOrigin(value) {
	return value === "USER" || value === "AGENT_REPORT" || value === "AUTO_FLOODING" || value === "AUTO_AUDIT";
}
/**
* 上下文 → 任务 prompt（纯渲染 — 冻结格式, tests 逐字钉）。
*
* 结构: 调查对象（Intervention id/title/origin）→ 范围（workstreams /
* source refs / detail）→ 问题 → 只读立场（INV-PERM-3 口径: 可读面 =
* 闭集能力清单 `INVESTIGATOR_CAPABILITIES` 的展开; 写路径声明不存在 —
* 与 preset 闭集 / restriction 黑名单 / sandbox read-only 同一事实的
* prompt 面表述）。
*/
/**
* 英文列举收尾（`a, b and c` — 无 Oxford comma, tests 逐字钉）.
*
* 不用正则替换尾逗号（V8 对 lookahead 内 `$` 锚的求值位置与 `[^,]*$`
* 组合的行为不可依赖 — WP-7.1 第二次尝试的实证缺陷）: 显式 slice 拼接,
* 确定性 + 无引擎差异。
*/
function andList(items) {
	if (items.length === 0) return "nothing";
	if (items.length === 1) return items[0];
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
function investigationTask(context) {
	const workstreams = context.workstreamIds.length === 0 ? "none" : context.workstreamIds.join(", ");
	const refs = context.sourceRefs.length === 0 ? "none" : context.sourceRefs.map((ref) => `${ref.kind}:${ref.id}`).join(", ");
	const lines = [
		`Read-only investigation of Intervention ${context.interventionId} "${context.title}".`,
		`Origin: ${context.origin}`,
		`Workstreams: ${workstreams}`,
		`Source refs: ${refs}`
	];
	if (context.detail !== void 0) lines.push(`Evidence: ${context.detail}`);
	lines.push("", `Question: ${context.question}`, "", `You are read-only. You may ${andList(INVESTIGATOR_CAPABILITIES)} — nothing else: you cannot modify the workspace, the plan, history, claims/facts, or any research state, and your answer is transient (only the user can save it). Ground every statement in the readable context (workspace files, git history/diff, plugin state, ResearchHistory).`);
	return lines.join("\n");
}
//#endregion
//#region src/host/service/investigator/preset.ts
/** The fs-search package name（the one row that carries the config）. */
const FS_SEARCH_TOOL_NAME = "@deepseek-ai/dsh-tool-fs-search";
/**
* 渲染 `research-investigator` 的 `agent.cordis.yml` 文本（确定性 —
* 同一闭集永远渲染同一文本, tests 逐字钉; 注释声明只读契约与「勿加行」
* 纪律 — launcher 会回读解析并拒绝非闭集行）。
*
* @param presetId - the preset id（必须是 `INVESTIGATOR_PRESET_ID` —
*   本插件只拥有这一个 investigator preset; 其他 id 是 IVL_INPUT,
*   防误用）。
* @returns the complete composition text.
* @throws {@link InvestigatorLaunchError} `IVL_INPUT` — 非闭集 presetId.
*/
function renderInvestigatorPresetComposition(presetId) {
	if (presetId !== "research-investigator") throw new InvestigatorLaunchError({
		code: "IVL_INPUT",
		message: `renderInvestigatorPresetComposition: presetId must be "${INVESTIGATOR_PRESET_ID}" (the plugin authors exactly one investigator preset), got ${JSON.stringify(presetId)}`
	});
	const rows = INVESTIGATOR_PRESET_TOOL_NAMES.map((name) => {
		const lines = [`- id: ${name.replace(/^@deepseek-ai\/dsh-/, "")}`, `  name: '${name}'`];
		if (name === FS_SEARCH_TOOL_NAME) lines.push("  config:", "    sampleOverCapGlobResults: false");
		return lines.join("\n");
	});
	return [
		`# ${INVESTIGATOR_PRESET_ID} — read-only Investigator agent preset (dsh-research-control WP-7.1).`,
		"#",
		"# AGENT-PLANE composition: read-only tools ONLY (INV-PERM-3 layer 1 —",
		"# DSH_ADAPTER §10.2 「preset 只注册只读工具」). The write path is excluded at",
		"# THREE layers: this composition (no write tool registers), the per-agent",
		"# tools.restrict() deny list over the research write set, and the",
		"# `/permission read-only` sandbox mode (the fs/bash backends reject every",
		"# write — the preset itself CANNOT set the sandbox mode: the permission",
		"# stack is host-plane, U5 resolution — see the plugin WP-7.1 report).",
		"#",
		"# Do not add rows or config keys: the plugin launcher parses this file",
		"# back and refuses to launch when a row (or the one audited fs-search",
		"# config key) is not in its closed read-only set.",
		...rows,
		""
	].join("\n");
}
//#endregion
//#region src/host/service/investigator/guard.ts
/**
* WP-7.1 — INV-PERM-3 运行面（任务目标 2 的运行半边: 「运行时断言
* （非白名单能力即拒）」）。
*
* 类型面（types.ts 闭集 4 字段 + 两个字面量）挡不住**运行时**伪造:
* `as InvestigatorLaunchRequest` cast、JSON 反序列化、原型注入都能带进
* 多余键。守卫在**触达宿主前**把闭集重新验一遍（launcher 的 build 后
* 一验 + 适配器端口边界再一验 — 双钉）:
*
*  - 键闭集: 请求对象的自有属性键必须 ⊆ {presetId, permissionPreset,
*    cwd, task}（多余键 — 无论叫什么 — 即非白名单能力, 拒）;
*  - 能力键具名拒: 已知写能力键（sandbox / sandboxMode / approval /
*    approvalPolicy / mode / policy / tools / capabilities / capability /
*    permission / permissions / write / writable / allowWrite / signal /
*    sessionId / …）在拒因里**指名**（INV-PERM-3: 写能力注入零容忍,
*    错误消息是审计面）;
*  - 值闭集: presetId / permissionPreset 必须逐字等于字面量常量;
*    cwd 必须 absolute; task 必须非空纯文本字符串;
*  - 原型纯净: 请求对象必须是 null-原型或 Object 原型（原型链上夹带
*    方法/字段 = 注入面, 拒）。
*
* 全部拒绝 = `IVL_WRITE_CAPABILITY`（非白名单能力即拒 — 单一错误码,
* 字段名进 message）或 `IVL_INPUT`（值畸形 — 闭集内但值不合法）;
* 零宿主调用（断言在 agents.create / commands.execute 之前, 失败路径
* 不碰宿主 — tests 以假宿主计数钉死）。
*/
/** 请求闭集键（types.ts 的 4 字段 — 单一来源, 不复制字面）。 */
const REQUEST_KEYS = [
	"presetId",
	"permissionPreset",
	"cwd",
	"task"
];
/**
* 已知写能力键（具名拒因 — 审计面: 错误消息点名「这是写能力」而非
* 泛泛的未知键）。键集是**识别表**不是白名单: 白名单是 REQUEST_KEYS,
* 这里只为拒因措辞服务（未知多余键同样拒, 只是措辞为 unknown field）。
*/
const KNOWN_CAPABILITY_KEYS = /* @__PURE__ */ new Map([
	["sandbox", "a sandbox mode override"],
	["sandboxMode", "a sandbox mode override"],
	["approval", "an approval policy override"],
	["approvalPolicy", "an approval policy override"],
	["mode", "a sandbox mode override"],
	["policy", "an approval policy override"],
	["tools", "a tool set override"],
	["toolFilter", "a tool filter override (path B host capability — not a launch parameter)"],
	["capabilities", "a capability list override"],
	["capability", "a capability override"],
	["permission", "a permission override"],
	["permissions", "a permission override"],
	["write", "a write-capability flag"],
	["writable", "a write-capability flag"],
	["allowWrite", "a write-capability flag"],
	["signal", "a caller cancellation signal (not a launch parameter)"],
	["sessionId", "a preallocated session id (not a launch parameter)"],
	["parent", "a parent-session capability (not a launch parameter)"],
	["persona", "a persona override (not a launch parameter)"],
	["outputSchema", "an output schema (not a launch parameter)"],
	["maxDepth", "a delegation depth (not a launch parameter)"]
]);
function ownKeys(value) {
	return Object.getOwnPropertyNames(value);
}
function prototypeIsClean(value) {
	const proto = Object.getPrototypeOf(value);
	return proto === null || proto === Object.prototype;
}
/**
* 闭集断言: 一个启动请求是否可提交给宿主（INV-PERM-3 运行面）。
*
* @param request - the candidate request（可以是任何值 — 非对象即
*   IVL_INPUT; 键/值/原型逐层验）.
* @throws {@link InvestigatorLaunchError} `IVL_INPUT`（非对象 / 值畸形）
*   或 `IVL_WRITE_CAPABILITY`（多余键 / 字面量不符 — 指名 + INV-PERM-3）。
*/
function assertReadonlyLaunchRequest(request) {
	if (typeof request !== "object" || request === null || Array.isArray(request)) throw new InvestigatorLaunchError({
		code: "IVL_INPUT",
		message: `assertReadonlyLaunchRequest: the launch request must be an object, got ${request === null ? "null" : typeof request}`
	});
	if (!prototypeIsClean(request)) throw new InvestigatorLaunchError({
		code: "IVL_WRITE_CAPABILITY",
		message: "assertReadonlyLaunchRequest: the launch request carries a non-clean prototype (a method or field inherited off Object.prototype is an injection surface — INV-PERM-3)"
	});
	const keys = ownKeys(request);
	for (const key of keys) if (!REQUEST_KEYS.includes(key)) throw new InvestigatorLaunchError({
		code: "IVL_WRITE_CAPABILITY",
		message: `assertReadonlyLaunchRequest: the field "${key}" is ${KNOWN_CAPABILITY_KEYS.get(key) ?? "an unknown field"} — the closed launch request carries exactly [${REQUEST_KEYS.join(", ")}]; a non-whitelisted capability is refused (INV-PERM-3)`
	});
	for (const key of REQUEST_KEYS) if (!keys.includes(key)) throw new InvestigatorLaunchError({
		code: "IVL_INPUT",
		message: `assertReadonlyLaunchRequest: the field "${key}" is missing (the closed launch request requires exactly [${REQUEST_KEYS.join(", ")}])`
	});
	if (request.presetId !== "research-investigator") throw new InvestigatorLaunchError({
		code: "IVL_WRITE_CAPABILITY",
		message: `assertReadonlyLaunchRequest: presetId ${JSON.stringify(request.presetId)} is not the investigator preset "${INVESTIGATOR_PRESET_ID}" (only the closed read-only preset is launchable — INV-PERM-3)`
	});
	if (request.permissionPreset !== "read-only") throw new InvestigatorLaunchError({
		code: "IVL_WRITE_CAPABILITY",
		message: `assertReadonlyLaunchRequest: permissionPreset ${JSON.stringify(request.permissionPreset)} is not "${READ_ONLY_PERMISSION_PRESET}" (only the read-only permission preset is launchable — INV-PERM-3)`
	});
	assertAbsoluteCwd(request.cwd);
	if (typeof request.task !== "string" || request.task.trim() === "") throw new InvestigatorLaunchError({
		code: "IVL_INPUT",
		message: "assertReadonlyLaunchRequest: task must be a non-empty string"
	});
}
/**
* 上下文闭集断言（一键缝的运行面 — build 后 / launch 前; 同口径）。
*
* @param context - the candidate context.
* @throws {@link InvestigatorLaunchError} `IVL_INPUT` / `IVL_WRITE_CAPABILITY`.
*/
function assertInvestigationContext(context) {
	if (typeof context !== "object" || context === null || Array.isArray(context)) throw new InvestigatorLaunchError({
		code: "IVL_INPUT",
		message: "assertInvestigationContext: the context must be an object"
	});
	if (!prototypeIsClean(context)) throw new InvestigatorLaunchError({
		code: "IVL_WRITE_CAPABILITY",
		message: "assertInvestigationContext: the context carries a non-clean prototype (an injection surface — INV-PERM-3)"
	});
	const allowed = [
		"interventionId",
		"title",
		"detail",
		"origin",
		"workstreamIds",
		"sourceRefs",
		"question",
		"cwd"
	];
	for (const key of ownKeys(context)) if (!allowed.includes(key)) throw new InvestigatorLaunchError({
		code: "IVL_WRITE_CAPABILITY",
		message: `assertInvestigationContext: the field "${key}" is ${KNOWN_CAPABILITY_KEYS.get(key) ?? "an unknown field"} — the context carries exactly [${allowed.join(", ")}]; a non-whitelisted capability is refused (INV-PERM-3)`
	});
	if (typeof context.interventionId !== "string" || !/^IV-\d+$/u.test(context.interventionId)) throw new InvestigatorLaunchError({
		code: "IVL_INPUT",
		message: `assertInvestigationContext: interventionId must match "IV-<n>", got ${JSON.stringify(context.interventionId)}`
	});
	if (typeof context.title !== "string" || context.title.trim() === "") throw new InvestigatorLaunchError({
		code: "IVL_INPUT",
		message: "assertInvestigationContext: title must be a non-empty string"
	});
	if (context.detail !== void 0 && typeof context.detail !== "string") throw new InvestigatorLaunchError({
		code: "IVL_INPUT",
		message: "assertInvestigationContext: detail must be a string when present"
	});
	if (context.origin !== "USER" && context.origin !== "AGENT_REPORT" && context.origin !== "AUTO_FLOODING" && context.origin !== "AUTO_AUDIT") throw new InvestigatorLaunchError({
		code: "IVL_INPUT",
		message: `assertInvestigationContext: origin must be one of the §1.4 4 值闭集 [USER, AGENT_REPORT, AUTO_FLOODING, AUTO_AUDIT], got ${JSON.stringify(context.origin)}`
	});
	if (!Array.isArray(context.workstreamIds) || !context.workstreamIds.every((ws) => typeof ws === "string" && ws !== "")) throw new InvestigatorLaunchError({
		code: "IVL_INPUT",
		message: "assertInvestigationContext: workstreamIds must be an array of non-empty strings"
	});
	if (!Array.isArray(context.sourceRefs) || !context.sourceRefs.every((ref) => typeof ref === "object" && ref !== null && typeof ref.kind === "string" && typeof ref.id === "string")) throw new InvestigatorLaunchError({
		code: "IVL_INPUT",
		message: "assertInvestigationContext: sourceRefs must be an array of {kind, id} refs"
	});
	if (typeof context.question !== "string" || context.question.trim() === "") throw new InvestigatorLaunchError({
		code: "IVL_INPUT",
		message: "assertInvestigationContext: question must be a non-empty string"
	});
	assertAbsoluteCwd(context.cwd);
}
/** absolute 路径守卫（沙箱边界必须是 canonical 绝对路径 — IVL_INPUT）。 */
function assertAbsoluteCwd(cwd) {
	if (typeof cwd !== "string" || !cwd.startsWith("/")) throw new InvestigatorLaunchError({
		code: "IVL_INPUT",
		message: `assertAbsoluteCwd: cwd must be an absolute path, got ${JSON.stringify(cwd)}`
	});
}
//#endregion
//#region src/host/service/investigator/launcher.ts
/**
* WP-7.1 — `InvestigatorLauncher`（任务目标 1 的 service 半边 + 任务目标 3
* 的一键缝）: 从 `InvestigationContext` 构造只读启动请求, 过闭集断言,
* 交给 `DshAgentLauncherAdapter` 端口（host 半边 = dsh-adapter/launcher,
* 路径 A 执行: ensure preset → agents.create(+setup) → /permission
* read-only → followup task）。
*
* 本类是**纯编排**（无 DSH import — INV-PERM-5; 无 I/O）:
*  - `launch(context)` — 一键入口（Gate P7 三）: 上下文断言 →
*    `buildRequest`（纯构造）→ 请求断言（INV-PERM-3 运行面 — 失败不
*    触达端口）→ 端口 `launchInvestigator`（宿主面）;
*  - `buildRequest(context)` — 纯构造（导出 — 测试钉全形态 + 未来接线
*    复用; 构造值必然过断言: 字面量常量 + 已校验的 cwd/question）;
*  - `presetComposition()` — 渲染 `agent.cordis.yml`（ensure 的输入 —
*    文件落盘归适配器, 文本构造归本包: 组合文本是 service 的冻结产物,
*    适配器只是搬运工 + 回读校验方）。
*
* 依赖注入: 构造器只收一个端口（`DshAgentLauncherAdapter`）— 零其他
* 依赖（无 store / 无 registry / 无 allocator — 启动是瞬态操作, 输出
* transient, 不落 operational DB, INV-PERM-3 / 计划书 §26.2）。
*/
var InvestigatorLauncher = class {
	#launcher;
	/**
	* @param options - the port-only options（fail loud on a missing port —
	*   构造期配置错是组合期错误, 不是调用期惊喜, 同 createResearchTools
	*   `assertDeps` 先例）。
	*/
	constructor(options) {
		if (typeof options?.launcher?.launchInvestigator !== "function") throw new TypeError("InvestigatorLauncher: options.launcher.launchInvestigator must be the DshAgentLauncherAdapter port (the host half — src/host/dsh-adapter/launcher)");
		this.#launcher = options.launcher;
	}
	/**
	* 一键启动（任务目标 3 — Gate P7 三条之三）: Intervention 上下文 →
	* 只读 Investigator 会话 + 任务提交。
	*
	* 序（fail-fast, 失败零宿主调用）:
	*  1. `assertInvestigationContext`（运行面 — 上下文闭集）;
	*  2. `buildRequest`（纯构造 — 闭集 4 字段）;
	*  3. `assertReadonlyLaunchRequest`（INV-PERM-3 运行面 — 非白名单
	*     能力即拒, 端口不被触达）;
	*  4. 端口 `launchInvestigator`（宿主面 — 路径 A 全序, 适配器在端口
	*     边界再断言一次）。
	*
	* @param context - the one-click context（`buildInvestigationContext`
	*   产物; 直接构造的对象同样过断言）。
	* @returns the settled launch result（sessionId + echoes — transient
	*   输出, 落 AnalysisRecord 归 WP-7.3 用户显式保存）.
	* @throws {@link InvestigatorLaunchError} — 断言拒因（IVL_INPUT /
	*   IVL_WRITE_CAPABILITY）或端口透传（IVL_PRESET* / IVL_PERMISSION /
	*   IVL_LAUNCH — cause 保留）。
	*/
	async launch(context) {
		assertInvestigationContext(context);
		const request = this.buildRequest(context);
		assertReadonlyLaunchRequest(request);
		return this.#launcher.launchInvestigator(request);
	}
	/**
	* 纯构造: 上下文 → 闭集启动请求（4 字段, 两个字面量 — 构造面零自由
	* 度: preset / permission 是常量, cwd / task 来自已校验上下文）。
	* 导出供测试逐字钉全形态 + 未来接线（RPC/GUI 缝）复用同一构造。
	*
	* @param context - the investigation context.
	* @returns the closed-set request（frozen）.
	*/
	buildRequest(context) {
		return Object.freeze({
			presetId: INVESTIGATOR_PRESET_ID,
			permissionPreset: READ_ONLY_PERMISSION_PRESET,
			cwd: context.cwd,
			task: investigationTask(context)
		});
	}
	/**
	* The investigator preset composition text（`agent.cordis.yml`）—
	* the ensure 步的输入（适配器落盘 + 回读解析 + 闭集断言）。
	* @returns the deterministic composition text.
	*/
	presetComposition() {
		return renderInvestigatorPresetComposition(INVESTIGATOR_PRESET_ID);
	}
	/**
	* 便捷缝: Intervention 行 + 问题 + 根 → 一键启动（组合
	* `buildInvestigationContext` + `launch` — 调用方一步到底）。
	*
	* @param intervention - the Intervention record（WP-3.5 冻结形状）.
	* @param question - the user's investigation question.
	* @param cwd - the research workspace root（absolute）.
	* @returns the settled launch result.
	* @throws {@link InvestigatorLaunchError} — 缝校验 / 断言 / 端口透传.
	*/
	async launchFromIntervention(intervention, question, cwd) {
		return this.launch(buildInvestigationContext(intervention, question, cwd));
	}
};
//#endregion
//#region src/host/service/analysis/types.ts
/** 冻结 AN id 模式（common.schema.json `idAnalysisRecord`）。 */
const AN_ID_PATTERN = /^AN-[1-9][0-9]*$/;
/** 冻结 R id 模式（common.schema.json `idRun` — investigator_run_id）。 */
const RUN_ID_PATTERN = /^R-[1-9][0-9]*$/;
/** 冻结 typedRef id 模式（common.schema.json `typedRef.id`）。 */
const TYPED_REF_ID_PATTERN = /^[A-Z]+-[1-9][0-9]*$/;
var AnalysisError = class extends Error {
	code;
	constructor(init) {
		super(init.message, init.cause === void 0 ? void 0 : { cause: init.cause });
		this.name = "AnalysisError";
		this.code = init.code;
	}
};
function isAnalysisError(error) {
	return error instanceof AnalysisError;
}
//#endregion
//#region src/host/service/analysis/service.ts
var AnalysisRecordService = class {
	#store;
	#allocator;
	#projectId;
	#now;
	constructor(options) {
		if (options.store === void 0 || options.store === null || typeof options.store.insertRecord !== "function") throw new AnalysisError({
			code: "AN_INPUT",
			message: "store: an AnalysisStore is required"
		});
		if (options.allocator === void 0 || options.allocator === null || typeof options.allocator.reserve !== "function") throw new AnalysisError({
			code: "AN_INPUT",
			message: "allocator: the shared IdAllocator is required"
		});
		if (typeof options.projectId !== "string" || options.projectId.length === 0) throw new AnalysisError({
			code: "AN_INPUT",
			message: "projectId must be a non-empty string"
		});
		this.#store = options.store;
		this.#allocator = options.allocator;
		this.#projectId = options.projectId;
		this.#now = options.now ?? Date.now;
	}
	/**
	* 用户显式保存一条 investigator 分析（module header 顺序纪律 ①–④）。
	*
	* @param actor - 必须是 USER actor（类型面 `UserActorRef` + 运行面
	*   `assertUserActor` 双面; 非 USER ⇒ AN_ACTOR_FORBIDDEN, 零写入）。
	*/
	saveAsAnalysisRecord(params, actor) {
		assertUserActor(actor, "saveAsAnalysisRecord");
		const sourceRef = assertSourceRef(params.sourceRef, "saveAsAnalysisRecord.sourceRef");
		const content = assertContent(params.content, "saveAsAnalysisRecord.content");
		const investigatorRunId = assertOptionalRunId(params.investigatorRunId, "saveAsAnalysisRecord.investigatorRunId");
		const dshSessionId = assertOptionalSessionId(params.dshSessionId, "saveAsAnalysisRecord.dshSessionId");
		const createdAt = this.#now();
		let res = null;
		try {
			res = this.#allocator.reserve("ANALYSIS_RECORD", this.#projectId);
			const record = {
				id: res.id,
				source_ref: sourceRef,
				content,
				created_at: createdAt,
				...investigatorRunId !== void 0 ? { investigator_run_id: investigatorRunId } : {},
				...dshSessionId !== void 0 ? { dsh_session_id: dshSessionId } : {}
			};
			this.#store.insertRecord(record);
			this.#allocator.commit(res);
			return { record };
		} catch (cause) {
			if (res !== null) this.#releaseQuietly(res);
			throw this.#wrapCause(cause);
		}
	}
	/** One record by id（`null` when absent — 缺席是正常结果, 非错误）。 */
	getAnalysisRecord(id) {
		return this.#store.getRecord(id);
	}
	/** List by (sourceKind?, sourceId?) — 稳定顺序 created_at ASC, id ASC
	*  （全缺省 = 全量）。 */
	listAnalysisRecords(filter = {}) {
		return this.#store.listRecords(filter);
	}
	#releaseQuietly(res) {
		try {
			this.#allocator.release(res);
		} catch {}
	}
	#wrapCause(cause) {
		if (isAnalysisError(cause)) return cause;
		return new AnalysisError({
			code: "AN_STORE",
			message: cause instanceof Error ? cause.message : String(cause),
			cause
		});
	}
};
/**
* actor 运行面门（类型面的运行半边 — INV-PERM-3「仅用户显式保存才落
* AnalysisRecord」; 同 WP-5.1 `assertUserActor` / WP-6.4 先例）。
*/
function assertUserActor(actor, operation) {
	if (actor === null || typeof actor !== "object" || actor.kind !== "USER") throw new AnalysisError({
		code: "AN_ACTOR_FORBIDDEN",
		message: `${operation}: requires a USER actor (INV-PERM-3 — investigator 输出默认 transient, 仅用户显式保存才落 AnalysisRecord; ARCHITECTURE §6 矩阵: INVESTIGATOR/AGENT 无任何落库路径) — got ${JSON.stringify(actor)}`
	});
	if (actor.user_id !== void 0 && typeof actor.user_id !== "string") throw new AnalysisError({
		code: "AN_INPUT",
		message: `${operation}: actor.user_id must be a string (common.schema.json actorRef)`
	});
	if (actor.label !== void 0 && (typeof actor.label !== "string" || actor.label.length > 200)) throw new AnalysisError({
		code: "AN_INPUT",
		message: `${operation}: actor.label must be a string of ≤200 chars (common.schema.json actorRef)`
	});
}
/** source_ref 形状断言（冻结 typedRef: kind ∈ 24 ObjectKind + id 模式）。 */
function assertSourceRef(value, what) {
	if (value === null || typeof value !== "object") throw new AnalysisError({
		code: "AN_INPUT",
		message: `${what} must be a {kind, id} typedRef (got ${JSON.stringify(value)})`
	});
	const kind = value.kind;
	const id = value.id;
	if (typeof kind !== "string" || kind.length === 0) throw new AnalysisError({
		code: "AN_INPUT",
		message: `${what}.kind must be a non-empty string ObjectKind (got ${JSON.stringify(kind)})`
	});
	if (!OBJECT_KIND_VALUES.includes(kind)) throw new AnalysisError({
		code: "AN_INPUT",
		message: `${what}.kind ${JSON.stringify(kind)} is not a member of the frozen 24-kind ObjectKind registry (DOMAIN_SCHEMA §1.3; §12.2 source_ref: Intervention / Audit finding / Brief 引用经此形状)`
	});
	if (typeof id !== "string" || !TYPED_REF_ID_PATTERN.test(id)) throw new AnalysisError({
		code: "AN_INPUT",
		message: `${what}.id must be a well-formed object id (^[A-Z]+-[1-9][0-9]*$; got ${JSON.stringify(String(id))})`
	});
	return {
		kind,
		id
	};
}
/** content 断言（Markdown — 非空, 冻结 schema minLength 1）。 */
function assertContent(value, what) {
	if (typeof value !== "string" || value.length === 0) throw new AnalysisError({
		code: "AN_INPUT",
		message: `${what} must be a non-empty Markdown string (DOMAIN_SCHEMA §12.2 content; frozen schema minLength 1; got ${JSON.stringify(String(value))})`
	});
	return value;
}
/** investigator_run_id 断言（冻结 idRun 模式; 缺席 = 合法）。 */
function assertOptionalRunId(value, what) {
	if (value === void 0) return void 0;
	if (typeof value !== "string" || !RUN_ID_PATTERN.test(value)) throw new AnalysisError({
		code: "AN_INPUT",
		message: `${what} must be a well-formed R id (^R-[1-9][0-9]*$; common.schema.json idRun; got ${JSON.stringify(String(value))})`
	});
	return value;
}
/** dsh_session_id 断言（自由文本 — 冻结 schema 只钉 string; 缺席 = 合法）。 */
function assertOptionalSessionId(value, what) {
	if (value === void 0) return void 0;
	if (typeof value !== "string" || value.length === 0) throw new AnalysisError({
		code: "AN_INPUT",
		message: `${what} must be a non-empty string (got ${JSON.stringify(String(value))})`
	});
	return value;
}
//#endregion
//#region src/host/service/analysis/schema.ts
const ANALYSIS_RECORD_TABLE = "analysis_record";
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
`;
/** Full DDL (idempotent — re-applied on every store open, 同 WP-3.1 先例). */
function analysisRecordDdl() {
	return DDL;
}
const SQL_INSERT_ANALYSIS_RECORD = `
INSERT INTO ${ANALYSIS_RECORD_TABLE} (id, source_ref, investigator_run_id, dsh_session_id, content, created_at)
VALUES (?, ?, ?, ?, ?, ?)
`;
const SQL_SELECT_ANALYSIS_RECORD_BY_ID = `SELECT * FROM ${ANALYSIS_RECORD_TABLE} WHERE id = ?`;
/** 列表查询（稳定顺序 created_at ASC, id ASC — 全序兜底; §15 无索引。
*  source_ref 过滤在 store 层对解码后的行做 — JSON 文本列不做 SQL 侧
*  模式猜测, 无隐藏过滤器, 调用方指名才过滤）。 */
const SQL_LIST_ANALYSIS_RECORDS = `SELECT * FROM ${ANALYSIS_RECORD_TABLE} ORDER BY created_at ASC, id ASC`;
const CORRUPT = (what, detail) => {
	throw new Error(`analysis_record row corruption at ${what}: ${detail}`);
};
function decodeJson(value, what) {
	if (typeof value !== "string") return CORRUPT(what, `expected JSON string, got ${typeof value}`);
	try {
		return JSON.parse(value);
	} catch (cause) {
		return CORRUPT(what, `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
	}
}
function assertTypedRef(value, what) {
	if (value === null || typeof value !== "object" || typeof value.kind !== "string" || typeof value.id !== "string") return CORRUPT(what, `must be a {kind, id} typedRef (got ${JSON.stringify(value)})`);
}
/** Encode `AnalysisRecordRecord` into the INSERT parameter list（列序 = DDL）。 */
function analysisRecordToParams(r) {
	return [
		r.id,
		JSON.stringify({
			kind: r.source_ref.kind,
			id: r.source_ref.id
		}),
		r.investigator_run_id === void 0 ? null : r.investigator_run_id,
		r.dsh_session_id === void 0 ? null : r.dsh_session_id,
		r.content,
		r.created_at
	];
}
/** Decode an `analysis_record` row back to the record（throws on corruption）。 */
function rowToAnalysisRecord(row) {
	if (typeof row.id !== "string") return CORRUPT("analysis_record.id", `expected string, got ${typeof row.id}`);
	if (typeof row.source_ref !== "string") return CORRUPT("analysis_record.source_ref", `expected JSON string, got ${typeof row.source_ref}`);
	if (typeof row.content !== "string") return CORRUPT("analysis_record.content", `expected string, got ${typeof row.content}`);
	if (typeof row.created_at !== "number") return CORRUPT("analysis_record.created_at", `expected number, got ${typeof row.created_at}`);
	const sourceRef = decodeJson(row.source_ref, "analysis_record.source_ref");
	assertTypedRef(sourceRef, "analysis_record.source_ref");
	const investigatorRunId = row.investigator_run_id === null || row.investigator_run_id === void 0 ? void 0 : row.investigator_run_id;
	if (investigatorRunId !== void 0 && typeof investigatorRunId !== "string") return CORRUPT("analysis_record.investigator_run_id", `expected string or NULL, got ${typeof investigatorRunId}`);
	const dshSessionId = row.dsh_session_id === null || row.dsh_session_id === void 0 ? void 0 : row.dsh_session_id;
	if (dshSessionId !== void 0 && typeof dshSessionId !== "string") return CORRUPT("analysis_record.dsh_session_id", `expected string or NULL, got ${typeof dshSessionId}`);
	return {
		id: row.id,
		source_ref: sourceRef,
		content: row.content,
		created_at: row.created_at,
		...investigatorRunId !== void 0 ? { investigator_run_id: investigatorRunId } : {},
		...dshSessionId !== void 0 ? { dsh_session_id: dshSessionId } : {}
	};
}
//#endregion
//#region src/host/service/analysis/store.ts
var AnalysisStore = class {
	#db;
	#schemas;
	closed = false;
	constructor(options) {
		if (options.db === void 0 || typeof options.db.exec !== "function" || typeof options.db.run !== "function") throw new AnalysisError({
			code: "AN_INPUT",
			message: "db: the injected operational-DB face (exec/run/get/all) is required"
		});
		if (options.schemas === void 0 || typeof options.schemas.checkAnalysisShape !== "function") throw new AnalysisError({
			code: "AN_INPUT",
			message: "schemas: the frozen provenance schema face (loadAnalysisSchemas) is required"
		});
		this.#db = options.db;
		this.#schemas = options.schemas;
		this.#db.exec(analysisRecordDdl());
	}
	/**
	* Insert ONE analysis_record row（单语句 autocommit）。落库前: 整行过
	* **真实冻结** `$defs/AnalysisRecord`（shape net 不可用 ⇒ AN_STORE 大声
	* 失败, 绝不在无 schema 时放行 — 同 WP-6.4 口径; 整行违例 ⇒ AN_INPUT）。
	* 调用方（service）负责 AN 号 reserve/commit + 用户门。
	*/
	insertRecord(record) {
		this.#assertOpen("insertRecord");
		if (record === null || typeof record !== "object") throw new AnalysisError({
			code: "AN_INPUT",
			message: "insertRecord: record must be an AnalysisRecordRecord object"
		});
		if (!this.#schemas.isUsable) throw new AnalysisError({
			code: "AN_STORE",
			message: "frozen provenance schema set unavailable — no analysis record can be shape-checked (see AnalysisSchemas.loadErrors)"
		});
		const shape = this.#schemas.checkAnalysisShape(record);
		if (!shape.ok) throw new AnalysisError({
			code: "AN_INPUT",
			message: `internal: analysis record failed the frozen AnalysisRecord schema: ${shape.errors.map((e) => `${e.path || "/"}: ${e.message}`).join(" | ")}`
		});
		try {
			this.#db.run(SQL_INSERT_ANALYSIS_RECORD, ...analysisRecordToParams(record));
		} catch (cause) {
			throw this.#wrap("insertRecord", cause);
		}
		return record;
	}
	/** One record by id（`null` when absent）。 */
	getRecord(id) {
		this.#assertOpen("getRecord");
		if (typeof id !== "string" || !AN_ID_PATTERN.test(id)) throw new AnalysisError({
			code: "AN_INPUT",
			message: `getRecord: id must be a well-formed AN id (got ${JSON.stringify(String(id))})`
		});
		try {
			const row = this.#db.get(SQL_SELECT_ANALYSIS_RECORD_BY_ID, id);
			return row === void 0 ? null : rowToAnalysisRecord(row);
		} catch (cause) {
			throw this.#wrap("getRecord", cause);
		}
	}
	/** List by (sourceKind?, sourceId?) — 稳定顺序 created_at ASC, id ASC
	*  （全缺省 = 全量; 过滤参数由调用方显式指名 — 无隐藏过滤器）。 */
	listRecords(filter = {}) {
		this.#assertOpen("listRecords");
		if (filter.sourceKind !== void 0 && (typeof filter.sourceKind !== "string" || filter.sourceKind.length === 0)) throw new AnalysisError({
			code: "AN_INPUT",
			message: `listRecords.filter.sourceKind must be a non-empty string (got ${JSON.stringify(filter.sourceKind)})`
		});
		if (filter.sourceId !== void 0 && (typeof filter.sourceId !== "string" || filter.sourceId.length === 0)) throw new AnalysisError({
			code: "AN_INPUT",
			message: `listRecords.filter.sourceId must be a non-empty string (got ${JSON.stringify(filter.sourceId)})`
		});
		try {
			const records = this.#db.all(SQL_LIST_ANALYSIS_RECORDS).map((row) => rowToAnalysisRecord(row));
			const kind = filter.sourceKind;
			const id = filter.sourceId;
			if (kind === void 0 && id === void 0) return records;
			return records.filter((r) => (kind === void 0 || r.source_ref.kind === kind) && (id === void 0 || r.source_ref.id === id));
		} catch (cause) {
			throw this.#wrap("listRecords", cause);
		}
	}
	#assertOpen(operation) {
		if (this.closed) throw new AnalysisError({
			code: "AN_STORE",
			message: `${operation}: store is closed`
		});
	}
	/** Test/inspection seam（no-op 语义: store 无生命周期状态可关 — 连接
	*  归 wiring 的单一 disposer, 同 WP-6.4 先例）。 */
	close() {
		this.closed = true;
	}
	#wrap(context, cause) {
		if (cause instanceof AnalysisError) throw cause;
		return new AnalysisError({
			code: "AN_STORE",
			message: `${context}: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause
		});
	}
};
//#endregion
//#region src/host/service/analysis/transient.ts
/**
* WP-7.3 — `AnalysisTransientReader`: transient 结果读取面（任务目标 1 —
* 计划书 §26.2「默认 transient」的 GUI 数据面）。
*
* ## 数据来源链（任务书逐字: 「launcher 的会话指针 → sessionlink 读取面」）
*
* `InvestigatorLaunchResult.sessionId`（WP-7.1 launcher 的会话指针 —
* transient 宿主引用, 不虚构持久化）→ `read(sessionId)` → 三个注入的
* **只读**端口（`AnalysisTransientReaderInput`）:
*
*   1. `pointerOf(sessionId)` — sessionlink 指针行（WP-2.6
*      `SessionLinkService.pointerOf` — meta KV 直读; INV-DB-2「只存
*      session_id、Run 绑定、事件指针、摘要」的唯一持久绑定面; 未绑定 =
*      null 诚实透出 — investigator 会话通常不绑定 formal workstream,
*      它是一次性只读调查; 不用 cwd 猜, 同 WP-7.2 绑定语义口径）;
*   2. `listSessions()` — DSH live session 摘要（WP-0.4
*      `DshSessionAdapter.listSessions` 端口面 — 只读列出, **不进 session
*      内容** — INV-DB-2 不复制 raw log; investigator 的中间输出文本在
*      DSH session 内, 由 DSH GUI 呈现; 本面只呈现指针/摘要/运行状态 —
*      这正是 transient 的语义: 不落任何 operational 表）;
*   3. `runs({dshSessionId})` — run 表 `dsh_session_id` 关联（§6.1 记录面;
*      每 session 至多一条 formal run）。
*
* ## 零写入的类型面断言（INV-PERM-3 — 任务测试项「transient 零写入」）
*
*  - `AnalysisTransientReaderInput` 的成员集合**全是读操作** — 接口上
*    不存在任何 run/exec/insert/set/update 成员: 写能力在该面上**无法
*    表达**（同 WP-7.1 请求闭集纪律的读面对偶: 不是「拒绝写」, 而是「写
*    不存在」）;
*  - 本类只有 `read` 一个公开方法 — 原型面零写方法（tests/analysis/
*    transient.test.ts 钉死 `Object.getOwnPropertyNames(prototype)` 面）;
*  - 行为面: `read` 的全部 I/O 都是经上述三个只读端口的 SELECT 语义 —
*    测试以真实 sqlite + 写计数探针钉死「transient 路径零写入」
*    （`analysis_record` 行数不变 + 驱动 write 调用计数零）。
*
* 只读边界: 零 DSH import（经注入的端口 face — `SessionSummary` 是插件
* 自有 shared 接口, 实现在 dsh-adapter, 本层不见 ctx, INV-PERM-5）。
*/
/**
* transient 读取面（构造注入三个只读端口; `read` 是唯一公开方法）。
*
* @throws {AnalysisError} `AN_INPUT` — 端口缺位（构造）/ sessionId 畸形;
*   `AN_STORE` — 只读端口调用失败（cause 保留）。
*/
var AnalysisTransientReader = class {
	#input;
	constructor(input) {
		if (input === null || typeof input !== "object" || typeof input.pointerOf !== "function" || typeof input.listSessions !== "function" || typeof input.runs !== "function") throw new AnalysisError({
			code: "AN_INPUT",
			message: "AnalysisTransientReader: input must carry the three READ faces (pointerOf / listSessions / runs) — the transient face has no write members by construction (INV-PERM-3 零写入类型面)"
		});
		this.#input = input;
	}
	/**
	* 读取一个 investigator 会话的 transient 快照（全读 — 零写入）。
	*
	* 诚实透出（不虚构）: `session = null`（live 列表无此 id — 已 dispose）/
	* `pointer = null`（未绑定 workstream）/ `run = null`（无 formal run）—
	* 三个 null 各自独立, 展示层逐字段渲染缺席态。
	*/
	read(sessionId) {
		if (typeof sessionId !== "string" || sessionId.length === 0) throw new AnalysisError({
			code: "AN_INPUT",
			message: `read: sessionId must be a non-empty string (the launcher session pointer — InvestigatorLaunchResult.sessionId; got ${JSON.stringify(String(sessionId))})`
		});
		let pointer;
		try {
			pointer = this.#input.pointerOf(sessionId);
		} catch (cause) {
			throw this.#wrap("pointerOf", cause);
		}
		if (pointer !== null && (pointer === void 0 || typeof pointer !== "object")) throw new AnalysisError({
			code: "AN_STORE",
			message: `read: pointerOf(${sessionId}) returned a non-pointer value (expected SessionPointer or null; got ${JSON.stringify(pointer)}) — port contract violation, loud`
		});
		let session = null;
		try {
			const sessions = this.#input.listSessions();
			for (const s of sessions) if (s !== null && typeof s === "object" && s.id === sessionId) {
				session = s;
				break;
			}
		} catch (cause) {
			throw this.#wrap("listSessions", cause);
		}
		let run = null;
		try {
			const rows = this.#input.runs({ dshSessionId: sessionId });
			if (rows.length > 0) run = rows[0];
		} catch (cause) {
			throw this.#wrap("runs", cause);
		}
		return {
			sessionId,
			session,
			pointer,
			run
		};
	}
	#wrap(face, cause) {
		if (cause instanceof AnalysisError) return cause;
		return new AnalysisError({
			code: "AN_STORE",
			message: `transient read: the ${face} face failed: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause
		});
	}
};
//#endregion
//#region src/host/service/analysis/schemas.ts
/**
* WP-7.3 — 冻结 operational provenance schema 装载（loader 模式, 同 WP-3.1
* `loadPlanForkSchemas` / WP-3.5 `loadInterventionSchemas` / WP-6.4
* `loadInboxSchemas` 先例）。
*
* 通过注入的 `ResearchFileReader` 装载**冻结** `schema/operational/
* provenance.schema.json`（+ 父 `schema/common.schema.json` 的
* idAnalysisRecord/idRun/typedRef/epochMs refs）:
*
*   - 校验器直接取自冻结文档（`ajv.getSchema($id + '#/$defs/AnalysisRecord')`）
*     — 零派生 schema, 零 `schema/` 改写（冻结只读）;
*   - 失败聚合（loadErrors; isUsable=false ⇒ `AnalysisStore` 拒绝写入,
*     fail loud — 绝不在无 schema 时放行, 同 WP-6.4 口径）;
*   - AJV 2020-12（冻结 `$schema` 方言）, allErrors + verbose
*     （精确定位）, useDefaults off（operational 记录无 schema 默认 —
*     每字段显式）。
*
* 消费: `AnalysisStore.insertRecord`（行落库前的整行冻结形状网 — 类型面
* 同构的运行时保证）+ tests/analysis 的模型往返断言面。
*/
/**
* 装载 + 编译冻结 provenance schema（AnalysisRecord def）。
* 聚合失败, 永不抛（loader 模式）。
*/
function loadAnalysisSchemas(reader, schemaDir) {
	const errors = [];
	const ajv = new Ajv2020({
		allErrors: true,
		strict: false,
		verbose: true
	});
	addFormats(ajv);
	const readJson = (path) => {
		let text;
		try {
			text = reader.readFile(path);
		} catch (cause) {
			errors.push({
				path,
				message: `schema file read failed: ${cause instanceof Error ? cause.message : String(cause)}`
			});
			return null;
		}
		if (text === null) {
			errors.push({
				path,
				message: `schema file not found (schemaDir=${schemaDir})`
			});
			return null;
		}
		try {
			return JSON.parse(text);
		} catch (cause) {
			errors.push({
				path,
				message: `schema file is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
			});
			return null;
		}
	};
	const common = readJson(pjoin(schemaDir, "..", "common.schema.json"));
	if (common === null || typeof common.$id !== "string") {
		errors.push({
			path: pjoin(schemaDir, "..", "common.schema.json"),
			message: "common.schema.json is missing or has no $id"
		});
		return unavailable(schemaDir, errors);
	}
	try {
		ajv.addSchema(common, common.$id);
	} catch (cause) {
		errors.push({
			path: pjoin(schemaDir, "..", "common.schema.json"),
			message: `common.schema.json rejected: ${cause instanceof Error ? cause.message : String(cause)}`
		});
		return unavailable(schemaDir, errors);
	}
	const doc = readJson(pjoin(schemaDir, "provenance.schema.json"));
	if (doc === null || typeof doc.$id !== "string") {
		errors.push({
			path: pjoin(schemaDir, "provenance.schema.json"),
			message: "provenance.schema.json is missing or has no $id"
		});
		return unavailable(schemaDir, errors);
	}
	try {
		ajv.addSchema(doc, doc.$id);
	} catch (cause) {
		errors.push({
			path: pjoin(schemaDir, "provenance.schema.json"),
			message: `provenance.schema.json rejected: ${cause instanceof Error ? cause.message : String(cause)}`
		});
		return unavailable(schemaDir, errors);
	}
	const recordValidator = ajv.getSchema(`${doc.$id}#/$defs/AnalysisRecord`);
	if (recordValidator === void 0) {
		errors.push({
			path: pjoin(schemaDir, "provenance.schema.json"),
			message: "schema compile failed for $defs/AnalysisRecord"
		});
		return unavailable(schemaDir, errors);
	}
	return {
		schemaDir,
		isUsable: true,
		loadErrors: [],
		checkAnalysisShape: (record) => runCheck(recordValidator, record)
	};
}
function mapErrors(validator) {
	return (validator.errors ?? []).map((err) => ({
		path: err.instancePath,
		message: schemaErrorSummary(err)
	}));
}
function runCheck(validator, value) {
	if (validator(value)) return {
		ok: true,
		errors: []
	};
	return {
		ok: false,
		errors: mapErrors(validator)
	};
}
function unavailable(schemaDir, errors) {
	const unavailableCheck = {
		ok: false,
		errors: [{
			path: "",
			message: "analysis schema set unavailable — see AnalysisSchemas.loadErrors"
		}]
	};
	return {
		schemaDir,
		isUsable: false,
		loadErrors: errors,
		checkAnalysisShape: () => unavailableCheck
	};
}
//#endregion
//#region src/host/service/wiring/types.ts
/** A structured wiring failure (never a raw driver/service exception). */
var HostWiringError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.name = "HostWiringError";
		this.code = code;
	}
};
function makeCollectingLogger() {
	const entries = [];
	const push = (level) => (step, message) => {
		entries.push({
			level,
			step,
			message
		});
	};
	return {
		entries,
		info: push("info"),
		warn: push("warn"),
		error: push("error")
	};
}
//#endregion
//#region src/host/service/wiring/db-adapter.ts
/**
* Adapt `db` to the `PlanForkDb` port.
*
* - `exec` — one-or-more statements without parameters (idempotent DDL);
* - `run` — one parameterized write, returning affected rows;
* - `get` / `all` — parameterized reads (row shape is the caller's
*   responsibility — the domain maps them);
* - `transaction` — ONE `BEGIN IMMEDIATE … COMMIT` unit (any throw →
*   `ROLLBACK`; the roll-back itself is best-effort — the transaction may
*   already be dead, e.g. on a constraint abort).
*
* Failures are wrapped as structured `HostWiringError`s (`WIRING_PLANFORK`
* scope — the wiring layer owns both the planfork and the flooding second
* connections) so the `[Service.init]` caller never sees a raw driver
* exception.
*/
function adaptDatabaseSync(db) {
	if (db === null || typeof db !== "object") throw new TypeError("adaptDatabaseSync: db must be a DatabaseSync");
	return {
		exec(sql) {
			try {
				db.exec(sql);
			} catch (cause) {
				throw wrap("exec", sql, cause);
			}
		},
		run(sql, ...params) {
			try {
				return Number(db.prepare(sql).run(...params).changes);
			} catch (cause) {
				throw wrap("run", sql, cause);
			}
		},
		get(sql, ...params) {
			try {
				return db.prepare(sql).get(...params);
			} catch (cause) {
				throw wrap("get", sql, cause);
			}
		},
		all(sql, ...params) {
			try {
				return db.prepare(sql).all(...params);
			} catch (cause) {
				throw wrap("all", sql, cause);
			}
		},
		transaction(work) {
			try {
				db.exec("BEGIN IMMEDIATE");
			} catch (cause) {
				throw wrap("BEGIN IMMEDIATE", "BEGIN IMMEDIATE", cause);
			}
			try {
				const result = work();
				try {
					db.exec("COMMIT");
				} catch (cause) {
					try {
						db.exec("ROLLBACK");
					} catch {}
					throw wrap("COMMIT", "COMMIT", cause);
				}
				return result;
			} catch (cause) {
				try {
					db.exec("ROLLBACK");
				} catch {}
				throw cause;
			}
		}
	};
}
function wrap(operation, sql, cause) {
	return new HostWiringError("WIRING_PLANFORK", `wiring second connection ${operation} failed: ${cause instanceof Error ? cause.message : String(cause)} (statement: ${sql})`, { cause });
}
//#endregion
//#region src/host/service/wiring/content-hash-capture.ts
/**
* WP-3.6 (RR-011 (d)) — the SYNCHRONOUS closure blob capture for the
* agent tool face.
*
* ## Why a second capture path exists
*
* The WP-3.3 tool face freezes the creation port as SYNCHRONOUS
* (`ResearchToolDeps.planForkCreate(params): PlanForkRecord` — the tool
* handler calls it without `await` and serializes the returned record).
* The production creation flow (the WP-3.2 stale service) is ASYNC because
* the frozen W3 whitelist row is one `git hash-object -- <path>` spawn per
* closure file (async child process). The domain's eight-step chain is
* pure-synchronous and accepts a synchronous `ClosureBlobCapturer` — so
* the tool face needs a synchronous capturer, and this module is it.
*
* ## The equivalence (documented + machine-checked)
*
* A git blob OID is, by definition, `sha1("blob " + byteLength + "\0" +
* bytes)`. For working-copy content WITHOUT a clean filter (the `.research`
* tree is plain text; a default repo has no `.gitattributes` filters — and
* `git hash-object` does not apply clean filters either, which is exactly
* the WP-3.2 「hash-object 对 working copy 内容计算」 premise), the
* content-addressed OID below is BYTE-IDENTICAL to the W3 `git hash-object`
* output. `tests/wiring/content-hash-capture.test.ts` pins this against a
* REAL temporary git repo (async git layer + real `hash-object`) — text
* and binary content — so any future divergence (e.g. someone configuring
* filters on `.research/`) is a test failure, not a silent base drift.
*
* `gitCommit` (the informational W11 HEAD, §3.2 「不参与 stale 判定」) is
* DELIBERATELY OMITTED here: reading HEAD through the git layer is async,
* and the frozen record schema leaves `base_git_commit` optional. The
* stale check (which is where the base is ever compared) recomputes the
* CURRENT closure through the real git path (WP-3.2), so the omission
* cannot affect staleness.
*
* Missing-file semantics: a closure path that is not a regular file in the
* working copy is an anomaly on the CREATION face (a consistent canonical
* plan cannot reference a missing definition file) — fail loud; the
* domain chain wraps it as `PF_BASE_CAPTURE` (step 3), same as the git
* path (WP-3.2 `captureGitClosureBase`).
*
* Layer rule: this module spawns NOTHING (no `child_process` at all) —
* there is no git invocation, hence no INV-GIT-6 surface. It is pure
* content addressing over the working copy, which the git layer's W3
* would compute identically for unfiltered content.
*
* No DSH imports (INV-PERM-5).
*/
/** The git blob header (`git hash-object` / `git-write-tree` definition). */
const BLOB_HEADER = "blob ";
/**
* The git blob OID of a buffer: `sha1("blob <len>\0" + bytes)` — the exact
* content addressing git uses for blobs (no filter applied; see the module
* header for the equivalence argument + the machine check in
* tests/wiring/content-hash-capture.test.ts).
*/
function gitBlobOid(bytes) {
	const digest = createHash("sha1");
	digest.update(BLOB_HEADER);
	digest.update(String(bytes.length));
	digest.update("\0");
	digest.update(bytes);
	return digest.digest("hex");
}
/**
* A synchronous `ClosureBlobCapturer` over the working copy: every closure
* path must be a regular file under `researchRoot`; the OID is the git
* blob OID of its bytes. Throws (any `Error`) on a missing/non-regular
* path or an unreadable file — the §4 chain step 3 wraps the throw as
* `PF_BASE_CAPTURE`.
*
* @param researchRoot - the ABSOLUTE `.research` directory (closure paths
*  are `.research`-relative, the same basis the W3 capture uses via
*  `researchDir`).
*/
function makeContentHashCapturer(researchRoot) {
	return { capture(wsDir, closure) {
		const objects = [];
		for (const rel of closure) {
			const abs = join(researchRoot, rel);
			let st;
			try {
				st = statSync(abs);
			} catch (cause) {
				throw new Error(`closure file missing from working copy: ${rel} (wsDir ${wsDir}) — a consistent canonical plan cannot reference a nonexistent definition file: ${cause instanceof Error ? cause.message : String(cause)}`);
			}
			if (!st.isFile()) throw new Error(`closure path is not a regular file: ${rel} (wsDir ${wsDir}) — a consistent canonical plan cannot reference a non-file definition`);
			let bytes;
			try {
				bytes = readFileSync(abs);
			} catch (cause) {
				throw new Error(`closure file unreadable: ${rel} (wsDir ${wsDir}): ${cause instanceof Error ? cause.message : String(cause)}`);
			}
			objects.push({
				path: rel,
				git_blob_oid: gitBlobOid(bytes)
			});
		}
		return { objects };
	} };
}
//#endregion
//#region src/host/service/wiring/startup-integrity.ts
/**
* WP-8.5 (G8 S2) — the PRODUCTION wiring of the WP-8.1 startup integrity
* checks: the [Service.init] dependency-graph step 0.5 (the integrity
* gate), run BEFORE any service is instantiated.
*
* The WP-8.1 hardening module (src/host/persistence/hardening) delivered
* the four-check startup pass as a frozen, fully-tested composition —
* `runStartupIntegrityChecks` (the async orchestrator) + the four check
* primitives. G8 round-1 (spec-hunter R1 / host-integrator R2) found the
* pass had ZERO production callers: the `[Service.init]` graph
* (createHostWiring) never ran it. This module is the adoption:
*
*   - it composes the SAME frozen check primitives the orchestrator
*     composes (check 1 `checkDatabase` — the store's own open path;
*     check 2 `loadResearchTree` + `classifyTreeLoad`; check 3
*     `checkGitWorkspace` — the real git layer; check 4
*     `checkDualTruthConsistency`) with the orchestrator's identical
*     aggregation rule (any unrecoverable ⇒ fatal; else any recoverable
*     ⇒ degraded; else ok; readSurface readonly ⇔ the tree is partially
*     broken);
*   - the three SYNCHRONOUS checks (db / tree / consistency) run in the
*     gate's own step, BEFORE the dependency graph's instantiation steps
*     (store → registry → … → tools) and BEFORE the step-13 startup
*     reconciliations: an unrecoverable finding throws a structured
*     `HostWiringError` (code `WIRING_INTEGRITY`) here — the fiber never
*     reaches ACTIVE (TC-DSH-008) and NO resource was opened yet (the
*     gate's own check-1 handle is closed in a finally, always), so the
*     failed-init-leaks-nothing property holds for free;
*   - a `recoverable` finding is LOUD (one warn per guidance item, plus
*     a summary warn) and then AUTO-DISPOSED by the already-delivered
*     step-13 startup reconciliations (lifecycle convergence →
*     run-vs-history → semantics rebuild — the frozen convergence
*     mechanisms this gate only DETECTS, per the WP-8.1 module doc);
*   - check 3 (the git boundary) is the ONLY async check (the git layer
*     spawns). The gate FIRES it (no blocking — the dependency graph
*     step is synchronous, pinned by the frozen test suite) and the
*     result settles within milliseconds: loud-logged on settle
*     (pass → info, recoverable → warn + guidance) and exposed on
*     `wiring.integrity.git`. Git is NEVER fatal — `checkGitWorkspace`
*     classifies every outcome as pass/recoverable (git-missing /
*     not-a-repo / conflict-in-progress / repo-error all refuse the
*     MANAGED mode or the CHECKPOINT, never the read surface; the
*     runtime refusals are enforced by the git/checkpoint layers
*     themselves) — so no ACTIVE-blocking decision waits on the async
*     half. The async orchestrator `runStartupIntegrityChecks` itself
*     remains the tested canonical composition (tests/hardening) and is
*     driven end-to-end by the e2e factory as the cross-check that the
*     production gate and the orchestrator classify the SAME tree
*     identically (e2e/factory/factory.ts integrity scenarios).
*
* V1 boundary (documented, see the WP-8.5 report): a PARTIALLY broken
* `.research` tree is classified `recoverable` here (the §10 readonly
* surface — `readSurface: 'readonly'`), but the V1 wiring's WIRING_TREE
* step (step 3) keeps its STRICT policy — any load error fails startup
* (frozen by tests/wiring). The `readSurface` flag is still honored at
* the one tree-write path the wiring owns (the workstream.yaml flip
* refuses under readonly — a defensive contract for when a follow-up WP
* adopts the §10 degraded surface).
*
* No DSH imports (INV-PERM-5); git access rides the frozen git layer
* behind the check's own injectable port (INV-GIT-6).
*/
/**
* Run the startup integrity gate (module header).
*
* @throws {HostWiringError} code `WIRING_INTEGRITY` when any synchronous
*  check is unrecoverable — BEFORE any resource of the dependency graph
*  is opened (the caller's fiber fails before ACTIVE, TC-DSH-008).
*/
function runStartupIntegrityGate(input) {
	const logger = input.logger;
	const dbOutcome = checkDatabase(input.dbPath);
	const db = dbOutcome.result;
	let treeLoad;
	let tree;
	try {
		treeLoad = loadResearchTree(input.reader, input.researchRoot, input.schemaDir);
		tree = classifyTreeLoad(treeLoad);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		treeLoad = {
			tree: emptyTree(),
			errors: []
		};
		tree = {
			status: "unrecoverable",
			usable: false,
			load: treeLoad,
			fatalErrors: [{
				code: "READ",
				file: "",
				message: `loader threw unexpectedly (bug — fail loud): ${msg}`
			}],
			degradedErrors: [],
			guidance: [`the .research loader threw unexpectedly instead of aggregating errors (loader bug): ${msg}`]
		};
	}
	const consistency = runConsistencyCheck({
		handle: dbOutcome.handle,
		tree,
		input
	});
	const guidance = [];
	if (db.status !== "pass") for (const g of db.guidance) guidance.push(`[db] ${g}`);
	if (tree.status !== "pass") for (const g of tree.guidance) guidance.push(`[tree] ${g}`);
	if (consistency.status !== "pass") for (const g of consistency.guidance) guidance.push(`[consistency] ${g}`);
	const outcome = db.status === "unrecoverable" || tree.status === "unrecoverable" || consistency.status === "unrecoverable" ? "fatal" : tree.status === "recoverable" || consistency.status === "recoverable" ? "degraded" : "ok";
	const readSurface = tree.status === "recoverable" ? "readonly" : "ok";
	const git = fireGitCheck(input.repoRoot, input.researchDir, logger);
	if (outcome === "fatal") {
		for (const g of guidance) logger?.error("startup-integrity", g);
		throw new HostWiringError("WIRING_INTEGRITY", `the startup integrity gate FAILED (unrecoverable — ARCHITECTURE §10 / TC-DSH-008): db=${db.status}${db.code ? ` (${db.code})` : ""}; tree=${tree.status}; consistency=${consistency.status} — refusing to instantiate the service graph. Guidance:\n${guidance.join("\n")}`);
	}
	if (outcome === "degraded") {
		for (const g of guidance) logger?.warn("startup-integrity", g);
		logger?.warn("startup-integrity", `startup integrity GATE: outcome=degraded (db=${db.status}; tree=${tree.status}; consistency=${consistency.status}) — startup PROCEEDS: the recoverable findings are auto-disposed by the step-13 startup reconciliations (lifecycle convergence → run-vs-history → semantics rebuild, loud); readSurface=${readSurface}; the git boundary check settles and logs separately (git is never fatal)`);
	} else logger?.info("startup-integrity", `startup integrity GATE: outcome=ok (db=${db.status}; tree=${tree.status}; consistency=${consistency.status}) — the git boundary check settles and logs separately`);
	return {
		outcome,
		db,
		tree,
		consistency,
		readSurface,
		guidance,
		treeLoad,
		git
	};
}
function runConsistencyCheck(args) {
	const { handle, tree, input } = args;
	try {
		if (handle === null) return skipped("the operational database is unavailable (the db check failed — see its findings; the consistency probe needs an open store)");
		if (tree.status === "unrecoverable") return skipped("the .research tree is unusable (the tree check found a fatal breakage — there is no declarative side to cross-check)");
		return checkDualTruthConsistency({
			store: handle,
			tree: tree.load.tree,
			projectId: input.projectId,
			maxSample: input.maxConsistencySample
		});
	} finally {
		if (handle !== null) try {
			handle.close();
		} catch {}
	}
}
function skipped(reason) {
	return {
		status: "skipped",
		checked: [],
		findings: [],
		projectIdChecked: false,
		skipReason: reason,
		message: `skipped: ${reason}`,
		guidance: []
	};
}
/**
* Fire the git boundary check (the only async one — the git layer spawns).
* NEVER rejects: `checkGitWorkspace` classifies every git failure
* (contract); a throw of its own is a bug — classed repo-error-shaped
* and loud, so the fire-and-forget promise cannot become an unhandled
* rejection (which would crash the host process — worse than any
* classification).
*/
function fireGitCheck(repoRoot, researchDir, logger) {
	return checkGitWorkspace(repoRoot, { researchDir }).then((git) => {
		if (git.status === "pass") logger?.info("startup-integrity", `git boundary: pass — ${git.message}`);
		else {
			logger?.warn("startup-integrity", `git boundary: ${git.status} — ${git.message}`);
			for (const g of git.guidance) logger?.warn("startup-integrity", `[git] ${g}`);
		}
		return git;
	}).catch((e) => {
		const msg = e instanceof Error ? e.message : String(e);
		const result = {
			status: "recoverable",
			repoDetected: false,
			repoRoot: null,
			conflictInProgress: false,
			dirty: false,
			dirtyResearchPaths: [],
			managedMode: "refused",
			checkpointAllowed: false,
			reason: "repo-error",
			message: `the git boundary check threw unexpectedly (check bug — fail loud): ${msg}`,
			guidance: [`the startup git check itself failed unexpectedly: ${msg} — managed research mode is refused (fail-safe); report this message`]
		};
		logger?.error("startup-integrity", `git boundary: the check threw unexpectedly (bug — fail loud): ${msg}`);
		return result;
	});
}
/** The empty-tree shape of a loader that threw before producing a result
*  (mirror of the orchestrator's own fallback). */
function emptyTree() {
	return {
		schemaVersion: null,
		project: null,
		objectives: [],
		workspace: null,
		policy: null,
		topics: [],
		mergeContracts: []
	};
}
//#endregion
//#region src/host/service/wiring/workstream-flip.ts
/**
* WP-3.6 (RR-011 (a) / RR-010 / TC-DOM-033 声明式半边) — the
* workstream.yaml PLANNED→REALIZED flip with the RR-010 file compensation
* protocol.
*
* ## The atomic-realize seam (store side, WP-2.1/2.4 delivered)
*
* The store fires `realize.apply` INSIDE the event write transaction,
* exactly once per workstream whose FIRST event is appended
* (`externalState` lifecycle PLANNED gate, WP-2.4). The hook performs:
*   1. the derived_state half (`tx.setDerivedState('workstream', ws, …)`)
*      — WP-2.4's service code;
*   2. the DECLARATIVE half — this module: flip `workstream.yaml`
*      `lifecycle` PLANNED→REALIZED with an atomic file write.
*
* ## The RR-010 compensation window (G2 r1 攻击者 B5)
*
* The file flip happens BEFORE the store's `COMMIT` (the hook runs inside
* the transaction). If the COMMIT (or anything after the flip) fails, the
* event rows roll back but the file is already flipped — file says
* REALIZED, History says never happened. The compensation protocol:
*
*   - the flip captures the file's PRE-flip content (or its absence);
*   - after `appendEvents` settles, the guarded store wrapper
*     (realize-store.ts) tells the realizer the outcome:
*       - committed → the flip is permanent (a later ROW-projection
*         failure keeps the flip — the documented WP-2.4 residual, the
*         run-row lag converges by reconciliation);
*       - failed → run the compensation: restore the pre-flip content, or
*         DELETE the file when it did not exist before (the flip only
*         modifies a file that the loaded tree already had — the delete
*         arm covers the crash-recovery re-flip edge where a prior
*         incomplete flip left a file the tree no longer claims);
*   - the compensation is best-effort-LOUD: if IT fails, the original
*     append error still propagates and the anomaly is left for the
*     STARTUP lifecycle reconciliation (lifecycle-reconcile.ts), which
*     converges file/DB divergence either way — the two mechanisms are
*     belt and braces for the same window.
*
* Crash after a committed flip is a no-op (file and DB agree). A crash
* BETWEEN the flip and the COMMIT leaves file=REALIZED without events —
* the startup reconciliation rolls the file back to PLANNED (History is
* the 真源 for "did it happen").
*
* The flip itself:
*   - single-document YAML round-trip through the `yaml` library's
*     Document API (style-preserving for untouched nodes);
*   - the `lifecycle` key is ABSENT in many legal files (schema default
*     PLANNED) — the flip inserts it when absent, rewrites it when
*     present-and-PLANNED, and FAILS LOUD on any other state (the file is
*     the declarative 真源: a mismatch with the PLANNED expectation the
*     service already gated means tree/DB divergence — fail the batch,
*     never guess);
*   - atomic write: `<path>.dshrc-tmp` + rename (the domain's
*     `TMP_FILE_SUFFIX`, the same crash-residue the WP-2.6 startup sweep
*     cleans); a failed temp write or rename leaves the previous content
*     intact (best-effort tmp cleanup).
*
* No DSH imports (INV-PERM-5).
*/
/** The `.research`-relative path of one workstream's declarative file. */
function workstreamYamlRelPath(topicId, workstreamId) {
	return join("topics", topicId, "workstreams", workstreamId, "workstream.yaml");
}
/** Atomic `<path>.dshrc-tmp` + rename; on failure the previous content
*  (or absence) is intact and the tmp residue is best-effort removed. */
function atomicWriteText$1(absPath, content) {
	const tmp = absPath + TMP_FILE_SUFFIX;
	try {
		writeFileSync(tmp, content, "utf8");
	} catch (cause) {
		try {
			unlinkSync(tmp);
		} catch {}
		throw cause;
	}
	try {
		renameSync(tmp, absPath);
	} catch (cause) {
		try {
			unlinkSync(tmp);
		} catch {}
		throw cause;
	}
}
/**
* Flip ONE workstream.yaml from PLANNED to REALIZED (the declarative half
* of TC-DOM-033).
*
* @returns the compensation that restores the pre-flip file state (or
*  deletes the file when it was newly created) — the caller (the realizer)
*  holds it until the store append settles.
* @throws {HostWiringError} `WIRING_REALIZE` on a missing/unreadable file,
*  a non-single-document or non-mapping YAML, an unreadable/illegal
*  lifecycle, or a write failure.
*/
function flipWorkstreamYamlToRealized(input) {
	const absPath = join(input.researchRoot, workstreamYamlRelPath(input.topicId, input.workstreamId));
	let oldText;
	try {
		oldText = readFileSync(absPath, "utf8");
	} catch {
		throw new HostWiringError("WIRING_REALIZE", `workstream flip: ${absPath} is missing or unreadable — the loaded tree claims this workstream; refusing to fabricate the declarative 真源`);
	}
	let doc;
	try {
		doc = parseDocument(oldText);
	} catch (cause) {
		throw new HostWiringError("WIRING_REALIZE", `workstream flip: ${absPath} is not parseable YAML: ${causeMessage(cause)}`);
	}
	if (doc.errors.length > 0) throw new HostWiringError("WIRING_REALIZE", `workstream flip: ${absPath} YAML errors: ${doc.errors.map((e) => e.message).join("; ")}`);
	if (!(doc.contents instanceof YAMLMap)) throw new HostWiringError("WIRING_REALIZE", `workstream flip: ${absPath} is not a YAML mapping`);
	const lifecycleValue = doc.contents.get("lifecycle");
	const current = lifecycleValue === void 0 || lifecycleValue === null ? "PLANNED" : String(lifecycleValue);
	if (current !== "PLANNED") throw new HostWiringError("WIRING_REALIZE", `workstream flip: ${input.workstreamId} file lifecycle is ${current}, expected PLANNED — file/DB divergence; the append batch is rejected (TC-DOM-033)`);
	doc.set("lifecycle", "REALIZED");
	const newContent = doc.toString();
	const check = parseDocument(newContent);
	if (check.errors.length > 0 || !(check.contents instanceof YAMLMap)) throw new HostWiringError("WIRING_REALIZE", `workstream flip: the flipped document of ${absPath} is not a well-formed mapping`);
	if (String(check.contents.get("lifecycle")) !== "REALIZED") throw new HostWiringError("WIRING_REALIZE", `workstream flip: the flipped document of ${absPath} does not carry lifecycle: REALIZED`);
	try {
		mkdirSync(dirname(absPath), { recursive: true });
		atomicWriteText$1(absPath, newContent);
	} catch (cause) {
		throw new HostWiringError("WIRING_REALIZE", `workstream flip: writing ${absPath} failed: ${causeMessage(cause)}`, { cause });
	}
	input.logger?.info("workstream-flip", `${input.workstreamId}: workstream.yaml flipped PLANNED→REALIZED (${absPath})`);
	return () => {
		if (oldText === null) {
			try {
				if (existsSync(absPath)) unlinkSync(absPath);
			} catch (cause) {
				throw new HostWiringError("WIRING_REALIZE", `workstream compensation: could not delete ${absPath}: ${causeMessage(cause)}`, { cause });
			}
			return;
		}
		try {
			atomicWriteText$1(absPath, oldText);
		} catch (cause) {
			throw new HostWiringError("WIRING_REALIZE", `workstream compensation: could not restore ${absPath}: ${causeMessage(cause)}`, { cause });
		}
	};
}
function causeMessage(cause) {
	return cause instanceof Error ? cause.message : String(cause);
}
/**
* The RR-010 compensation state machine, owned by the wiring:
*
*   - `onWorkstreamRealized(wsId)` — called INSIDE the store write
*     transaction by the RunBindingService's realize hook. Performs the
*     file flip and arms the pending compensation.
*   - `settleAppend(outcome)` — called by the guarded store wrapper
*     (realize-store.ts) after `appendEvents` returns or throws:
*     `committed` disarms (the flip is permanent); `failed` RUNS the
*     compensation (restoring the pre-flip file state) before the append
*     error propagates.
*
* At most one flip is pending at a time (the store transaction is
* synchronous; a second `onWorkstreamRealized` with a pending
* compensation is a wiring bug and fails loud).
*/
var WorkstreamRealizer = class {
	#input;
	#pending = null;
	constructor(input) {
		this.#input = input;
	}
	/** The workstream with an armed compensation (diagnostics). */
	get pendingWorkstreamId() {
		return this.#pending === null ? null : this.#pending.workstreamId;
	}
	/** Realize the declarative half for one workstream (IN-TRANSACTION). */
	onWorkstreamRealized(workstreamId) {
		if (this.#pending !== null) throw new HostWiringError("WIRING_REALIZE", `workstream realizer: ${workstreamId} realized while ${this.#pending.workstreamId}'s compensation is still armed — wiring bug (one realize per store transaction)`);
		const topic = this.#input.workstreams.get(workstreamId);
		if (topic === void 0) throw new HostWiringError("WIRING_REALIZE", `workstream realizer: ${workstreamId} is not in the loaded tree — refusing to write a workstream.yaml for an unknown workstream`);
		const compensate = flipWorkstreamYamlToRealized({
			researchRoot: this.#input.researchRoot,
			topicId: topic.topicId,
			workstreamId,
			logger: this.#input.logger
		});
		this.#pending = {
			workstreamId,
			compensate
		};
	}
	/**
	* Settle the in-flight append: `committed` → the flip stands; `failed`
	* → run the compensation (its own failure is logged LOUD and rethrown
	* AFTER the caller has been given the original error — the wrapper
	* calls this inside its catch, so this method must not mask the append
	* error: it throws ONLY when the compensation fails, in which case the
	* startup lifecycle reconciliation is the backstop).
	*/
	settleAppend(outcome) {
		if (this.#pending === null) return;
		const pending = this.#pending;
		this.#pending = null;
		if (outcome === "committed") return;
		try {
			pending.compensate();
		} catch (cause) {
			this.#input.logger?.error("workstream-realize", `${pending.workstreamId}: the RR-010 file compensation FAILED after the append rolled back — the startup lifecycle reconciliation will converge file/DB: ${causeMessage(cause)}`);
			throw cause;
		}
		this.#input.logger?.warn("workstream-realize", `${pending.workstreamId}: append failed after the file flip — workstream.yaml compensated back to PLANNED (RR-010)`);
	}
};
//#endregion
//#region src/host/service/wiring/lifecycle-reconcile.ts
/**
* WP-3.6 (RR-011 (a) / RR-010 崩溃后一致性) — the startup
* workstream-lifecycle reconciliation: the DETECTION PATH for file/DB
* divergence left by a crash inside the RR-010 window.
*
* ## The window and its residue
*
* The atomic-realize flip (workstream-flip.ts) writes workstream.yaml
* INSIDE the event transaction, before COMMIT. A crash between the file
* write and the COMMIT (or a failed RR-010 compensation) leaves:
*
*   - file `lifecycle: REALIZED` while the workstream has NO events in
*     History — the file LEADS the truth. History is the 真源 for "did it
*     happen": no event ⇒ it did not happen ⇒ the flip is residue ⇒ roll
*     the file back to PLANNED.
*   - conversely, file `lifecycle: PLANNED` while the workstream HAS
*     events — the file TRAILS the truth (e.g. the flip was undone, or
*     the wiring landed after events already existed). The forward
*     convergence is the flip itself (idempotent, one-shot semantics
*     preserved: the workstream is realized — its first event exists).
*
* Both directions are converged at STARTUP (the [Service.init] wiring
* runs this before any service is used) and are reported loudly: every
* convergence is a structured finding in the result AND a log entry. A
* workstream whose file is missing/unreadable or whose non-PLANNED/
* REALIZED state cannot be interpreted is NOT converged silently — the
* reconciliation fails loud (the tree and the DB disagree in a way this
* mechanism must not guess about).
*
* DROPPED workstreams are out of scope in both directions: a dropped WS
* with history is consistent (it was realized, then dropped), and a
* dropped WS without history is simply never used — the declarative
* 真源 (DROPPED) stands.
*
* No DSH imports (INV-PERM-5).
*/
function atomicWriteText(absPath, content) {
	const tmp = absPath + TMP_FILE_SUFFIX;
	try {
		writeFileSync(tmp, content, "utf8");
	} catch (cause) {
		try {
			unlinkSync(tmp);
		} catch {}
		throw cause;
	}
	try {
		renameSync(tmp, absPath);
	} catch (cause) {
		try {
			unlinkSync(tmp);
		} catch {}
		throw cause;
	}
}
/** Read + parse one workstream.yaml; fail loud on any unreadable/illegal
*  file (the reconciliation must not guess about a broken 真源). Returns
*  the whole Document (narrowed — the doc must be a mapping to be legal). */
function readLifecycleDoc(researchRoot, ws) {
	const absPath = join(researchRoot, workstreamYamlRelPath(ws.topicId, ws.workstreamId));
	let text;
	try {
		text = readFileSync(absPath, "utf8");
	} catch (cause) {
		throw new HostWiringError("WIRING_RECONCILE", `lifecycle reconciliation: ${absPath} is missing or unreadable for tree-claimed workstream ${ws.workstreamId} — refusing to converge against a broken 真源: ${cause instanceof Error ? cause.message : String(cause)}`);
	}
	const doc = parseDocument(text);
	if (doc.errors.length > 0 || !(doc.contents instanceof YAMLMap)) throw new HostWiringError("WIRING_RECONCILE", `lifecycle reconciliation: ${absPath} is not a well-formed YAML mapping — refusing to converge ${ws.workstreamId} against a broken 真源`);
	const raw = doc.contents.get("lifecycle");
	const lifecycle = raw === void 0 || raw === null ? "PLANNED" : String(raw);
	if (lifecycle !== "PLANNED" && lifecycle !== "REALIZED" && lifecycle !== "DROPPED") throw new HostWiringError("WIRING_RECONCILE", `lifecycle reconciliation: ${absPath} carries lifecycle ${JSON.stringify(lifecycle)} — not a legal WsLifecycle; refusing to converge ${ws.workstreamId} (loader error surface)`);
	return {
		absPath,
		doc
	};
}
/**
* Reconcile every listed workstream's declarative lifecycle against its
* History truth (file/DB divergence → converge the FILE toward the DB,
* loud report). `store` must be the live wiring store (read face only is
* used for the event probe).
*/
function reconcileWorkstreamLifecycles(input) {
	const findings = [];
	let changed = 0;
	for (const ws of input.workstreams) {
		const { absPath, doc } = readLifecycleDoc(input.researchRoot, ws);
		const raw = doc.get("lifecycle");
		const fileLifecycle = raw === void 0 || raw === null ? "PLANNED" : String(raw);
		const hasEvents = input.store.listRange(ws.workstreamId, 1, 1).length > 0;
		if (fileLifecycle === "DROPPED") {
			findings.push({
				workstreamId: ws.workstreamId,
				fileLifecycle,
				hasEvents,
				action: "skipped-dropped"
			});
			continue;
		}
		if (fileLifecycle === "REALIZED" && !hasEvents) {
			doc.set("lifecycle", "PLANNED");
			const newContent = doc.toString();
			try {
				atomicWriteText(absPath, newContent);
			} catch (cause) {
				throw new HostWiringError("WIRING_RECONCILE", `lifecycle reconciliation: could not roll ${ws.workstreamId}'s workstream.yaml back to PLANNED: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
			}
			input.logger?.error("lifecycle-reconcile", `${ws.workstreamId}: file said REALIZED but History has no events (RR-010 crash window residue) — file rolled back to PLANNED`);
			findings.push({
				workstreamId: ws.workstreamId,
				fileLifecycle,
				hasEvents,
				action: "file-rolled-back-to-planned"
			});
			changed += 1;
			continue;
		}
		if (fileLifecycle === "PLANNED" && hasEvents) {
			doc.set("lifecycle", "REALIZED");
			const newContent = doc.toString();
			try {
				mkdirSync(dirname(absPath), { recursive: true });
				atomicWriteText(absPath, newContent);
			} catch (cause) {
				throw new HostWiringError("WIRING_RECONCILE", `lifecycle reconciliation: could not flip ${ws.workstreamId}'s workstream.yaml to REALIZED: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
			}
			input.logger?.error("lifecycle-reconcile", `${ws.workstreamId}: History has events but the file said PLANNED (flipped half lost) — file flipped to REALIZED`);
			findings.push({
				workstreamId: ws.workstreamId,
				fileLifecycle,
				hasEvents,
				action: "file-flipped-to-realized"
			});
			changed += 1;
			continue;
		}
		findings.push({
			workstreamId: ws.workstreamId,
			fileLifecycle,
			hasEvents,
			action: "none"
		});
	}
	return {
		findings,
		changed
	};
}
//#endregion
//#region src/host/service/wiring/run-reconcile.ts
/** RUN_* event types (frozen catalog §5.1). */
const RUN_START_EVENT = "RUN_STARTED";
const TERMINAL_EVENTS = {
	RUN_FINISHED: "FINISHED",
	RUN_FAILED: "FAILED",
	RUN_CANCELLED: "CANCELLED"
};
/** `run_id` is a TOP-LEVEL payload field of every RUN_* event (frozen
*  catalog §5). Absent/non-string ⇒ malformed (the caller's finding). */
function runIdOf(event) {
	const v = event.payload?.run_id;
	return typeof v === "string" && v.length > 0 ? v : null;
}
/**
* Reconcile the `run`/`discovered_session` row projection against the
* RUN_* event 真源. See the module header for the full finding table.
*
* @throws {HostWiringError} `WIRING_RECONCILE` when a finding is fatal
*  under `policy` (the [Service.init] caller fails the fiber loud).
*/
function reconcileRunsAgainstHistory(input) {
	const policy = input.policy ?? "rebuild";
	const failLoud = policy === "failLoud";
	const events = collectAllEvents(input.store, input.workstreams, "audit");
	const groups = /* @__PURE__ */ new Map();
	const malformed = [];
	for (const event of events) {
		const terminalStatus = TERMINAL_EVENTS[event.eventType];
		if (!(event.eventType === RUN_START_EVENT || terminalStatus !== void 0)) continue;
		const runId = runIdOf(event);
		if (runId === null) {
			malformed.push(event);
			continue;
		}
		const group = groups.get(runId) ?? {
			starts: [],
			terminals: []
		};
		if (event.eventType === RUN_START_EVENT) group.starts.push(event);
		else group.terminals.push({
			event,
			status: terminalStatus
		});
		groups.set(runId, group);
	}
	const rows = new Map(input.tables.listAllRuns().map((r) => [r.id, r]));
	const dsBySession = new Map(input.tables.listDiscoveredSessions({}).map((d) => [d.dsh_session_id, d]));
	const rowBySession = /* @__PURE__ */ new Map();
	for (const r of rows.values()) if (r.dsh_session_id !== void 0 && !rowBySession.has(r.dsh_session_id)) rowBySession.set(r.dsh_session_id, r);
	const findings = [];
	let rebuiltCount = 0;
	const note = (finding) => {
		findings.push(finding);
		(finding.kind === "rebuilt-run-row" ? input.logger?.warn : input.logger?.error)?.("run-reconcile", `[${finding.kind}] ${finding.runId}: ${finding.detail}`);
	};
	for (const runId of groups.keys()) {
		const group = groups.get(runId);
		const row = rows.get(runId);
		if (row !== void 0) {
			if (group.starts.length > 1) note({
				kind: "orphan-double-start",
				runId,
				detail: `${group.starts.length} RUN_STARTED events for one run (double bind / double start) — the event log keeps them all (append-only); the row belongs to the winner`,
				fatal: failLoud
			});
			if (group.terminals.length > 1) note({
				kind: "orphan-double-terminal",
				runId,
				detail: `${group.terminals.length} terminal events (double terminal) — the row holds the first terminal's state (audit order: ${group.terminals.map((t) => `${t.event.eventType}@seq${t.event.eventSeq}`).join(" vs ")}); later events are orphans in History`,
				fatal: failLoud
			});
			if (group.terminals.length === 1) {
				const t = group.terminals[0];
				if (row.status !== t.status || row.ended_at !== t.event.occurredAt) note({
					kind: "status-drift",
					runId,
					detail: `row status ${row.status}/ended_at ${String(row.ended_at)} disagrees with the terminal event ${t.event.eventType} (status ${t.status}, occurred_at ${t.event.occurredAt}) — the derived cache is wrong beyond the documented window`,
					fatal: failLoud
				});
			}
			continue;
		}
		if (group.starts.length === 0) {
			note({
				kind: "orphan-terminal-only",
				runId,
				detail: `referenced only by ${group.terminals.length} terminal event(s) — no RUN_STARTED payload to rebuild the row from (workstream/initiated_by/started_at unknown); this is corruption beyond the documented ②→③ window`,
				fatal: true
			});
			continue;
		}
		const start = group.starts[0];
		const session = typeof start.payload.dsh_session_id === "string" ? start.payload.dsh_session_id : void 0;
		if (failLoud) {
			note({
				kind: "row-missing",
				runId,
				detail: `row missing (RUN_STARTED ${start.eventId} committed, row projection lost) — policy "failLoud": NOT rebuilt, the operator reconciles by hand`,
				fatal: true
			});
			continue;
		}
		if (session !== void 0) {
			const otherRow = rowBySession.get(session);
			const ds = dsBySession.get(session);
			const dsBoundElsewhere = ds !== void 0 && ds.state === "BOUND" && ds.bound_run_id !== void 0 && ds.bound_run_id !== runId;
			const dsBoundToSelf = ds !== void 0 && ds.state === "BOUND" && ds.bound_run_id === runId;
			const otherStarted = [...groups.entries()].find(([otherId, otherGroup]) => otherId !== runId && typeof otherGroup.starts[0]?.payload.dsh_session_id === "string" && otherGroup.starts[0].payload.dsh_session_id === session);
			if (otherRow !== void 0 && otherRow.id !== runId || dsBoundElsewhere || otherStarted !== void 0 && !dsBoundToSelf) {
				note({
					kind: "orphan-session-conflict",
					runId,
					detail: `RUN_STARTED carries dsh_session_id ${JSON.stringify(session)} which already belongs to ${otherRow !== void 0 ? `run ${otherRow.id}` : dsBoundElsewhere ? `the DS row (bound to ${ds.bound_run_id})` : `another started run (${otherStarted[0]}) of the same session`} — the double-bind loser: NOT rebuilt (one DS : one run); the event remains a valid chronicle entry`,
					fatal: false
				});
				continue;
			}
		}
		const rebuilt = rebuildRunRow(input.tables, runId, group, dsBySession);
		rows.set(runId, rebuilt);
		if (rebuilt.dsh_session_id !== void 0) rowBySession.set(rebuilt.dsh_session_id, rebuilt);
		rebuiltCount += 1;
		note({
			kind: "rebuilt-run-row",
			runId,
			detail: `row rebuilt from RUN_STARTED ${start.eventId} (audit seq ${start.eventSeq})${group.terminals.length > 0 ? ` + terminal ${group.terminals[group.terminals.length - 1].event.eventType}` : " (still RUNNING)"}`,
			fatal: false
		});
	}
	for (const event of malformed) {
		findings.push({
			kind: "malformed-run-event",
			runId: "(unknown)",
			detail: `${event.eventType} ${event.eventId} (audit seq ${event.eventSeq}) carries no usable payload.run_id — a corrupt stream the registry should have rejected at write time`,
			fatal: true
		});
		input.logger?.error("run-reconcile", `[malformed-run-event] ${event.eventId}: no payload.run_id`);
	}
	for (const row of rows.values()) if (!groups.has(row.id)) note({
		kind: "row-without-events",
		runId: row.id,
		detail: "run row exists but History has no RUN_* events for it — impossible through the services (event-first write order); the row is kept (INV-HIST-7: no hard delete) and the anomaly is reported",
		fatal: failLoud
	});
	const fatal = findings.filter((f) => f.fatal);
	if (fatal.length > 0) throw new HostWiringError("WIRING_RECONCILE", `run-vs-history reconciliation found ${fatal.length} fatal finding(s) under policy "${policy}": ` + fatal.map((f) => `${f.kind}(${f.runId})`).join(", ") + " — the run/DS row projection cannot be converged automatically; fix the operational DB by hand and restart");
	return {
		findings,
		rebuiltCount,
		ok: findings.length === 0
	};
}
/**
* Rebuild ONE missing run row from its event group: the first RUN_STARTED
* payload (workstream = event owner; task_id / dsh_session_id / intent /
* initiated_by / started_at) + the latest terminal event (status /
* ended_at / summary) when present; the session's PENDING DS row flips to
* BOUND in the SAME table transaction (the documented ②→③ window left
* both halves behind).
*/
function rebuildRunRow(tables, runId, group, dsBySession) {
	const start = group.starts[0];
	const lastTerminal = group.terminals.length > 0 ? group.terminals[group.terminals.length - 1] : void 0;
	const payload = start.payload;
	const initiatedBy = payload.initiated_by;
	if (typeof initiatedBy !== "object" || initiatedBy === null) throw new HostWiringError("WIRING_RECONCILE", `run rebuild: ${runId}'s RUN_STARTED ${start.eventId} carries no usable payload.initiated_by — cannot rebuild the row (fail loud)`);
	const started = start.occurredAt;
	const taskId = typeof payload.task_id === "string" ? payload.task_id : void 0;
	const sessionId = typeof payload.dsh_session_id === "string" ? payload.dsh_session_id : void 0;
	const intent = typeof payload.intent === "string" ? payload.intent : void 0;
	const summary = lastTerminal !== void 0 && typeof lastTerminal.event.payload?.outcome_summary === "string" ? lastTerminal.event.payload.outcome_summary : void 0;
	const run = {
		id: runId,
		workstream_id: start.ownerWorkstreamId,
		status: lastTerminal === void 0 ? "RUNNING" : lastTerminal.status,
		initiated_by: initiatedBy,
		started_at: started,
		...taskId !== void 0 ? { task_id: taskId } : {},
		...sessionId !== void 0 ? { dsh_session_id: sessionId } : {},
		...intent !== void 0 ? { intent } : {},
		...lastTerminal !== void 0 ? {
			ended_at: lastTerminal.event.occurredAt,
			...summary !== void 0 ? { summary } : {}
		} : {}
	};
	const ds = sessionId !== void 0 ? dsBySession.get(sessionId) : void 0;
	const flipPendingDs = ds !== void 0 && ds.state === "PENDING";
	tables.transaction(() => {
		tables.insertRun(run);
		if (flipPendingDs) {
			const flipped = tables.transitionDiscoveredSession(ds.id, "PENDING", "BOUND", runId);
			if (flipped !== 1) throw new HostWiringError("WIRING_RECONCILE", `run rebuild: DS row ${ds.id} for session ${JSON.stringify(sessionId)} moved out of PENDING concurrently (flipped=${flipped}) — the transaction rolls back`);
		}
	});
	return run;
}
//#endregion
//#region src/host/domain/semantics/types.ts
/** Fact status is CONST (§7.2: 「Fact: 恒 ACTIVE」) — no state machine. */
const FACT_STATUS = "ACTIVE";
/** Frozen artifactType enum (common.schema.json `artifactType`; §7.3 Artifact.type). */
const ARTIFACT_TYPES = [
	"DATASET",
	"FIGURE",
	"MODEL",
	"CODE",
	"REPORT",
	"NOTE",
	"OTHER"
];
/** True iff `value` is one of the frozen 7 artifact types. */
function isArtifactType(value) {
	return typeof value === "string" && ARTIFACT_TYPES.includes(value);
}
/** The frozen 10-type set (INV-REL-3). Structural mirror of the registry's union. */
const RELATION_TYPES = [
	"DEPENDS_ON",
	"SUPPORTED_BY",
	"CONTRADICTED_BY",
	"DERIVED_FROM",
	"PRODUCED_BY",
	"VALIDATED_BY",
	"CONSUMES",
	"CONTRIBUTES_TO",
	"IMPLEMENTS",
	"RELATED_TO"
];
/** True iff `value` is one of the 10 frozen relation types (INV-REL-3). */
function isRelationType(value) {
	return typeof value === "string" && RELATION_TYPES.includes(value);
}
/**
* The fail-loud error the REDUCER throws on a precondition violation.
* A valid stream (shape-checked + state-validated at write time) never
* triggers it; a corrupt stream must fail the fold loudly rather than
* produce wrong derived rows (TC-HIST-006).
*/
var SemanticDomainError = class extends Error {
	code;
	path;
	constructor(code, message, path) {
		super(message);
		this.name = "SemanticDomainError";
		this.code = code;
		this.path = path;
	}
};
//#endregion
//#region src/host/domain/semantics/state-machine.ts
/**
* WP-2.5 — the §13/§7/§8 state machines of the four semantic registries.
*
* Frozen basis:
*  - DOMAIN_SCHEMA §13 「状态机定义」（合法转换表）: claim（L556: ACTIVE →
*    RETRACTED 终态）/ artifact（L557: REGISTERED ↔ MISSING，「MISSING 经事件
*    标记; 找回经用户操作」）;
*  - DOMAIN_SCHEMA §7 状态列: Claim `ACTIVE`/`RETRACTED`（撤销经 CLAIM_RETRACTED
*    事件）; Fact 恒 `ACTIVE`（无状态机）; Artifact `REGISTERED`/`MISSING`
*    （ARTIFACT_MARKED_MISSING 标记; 找回可恢复）;
*  - DOMAIN_SCHEMA §8 状态列: Relation `ACTIVE`/`REMOVED`（RELATION_REMOVED 撤销）。
*
* ## Event coverage in V1 (HISTORY_EVENT_CATALOG §4/§5)
*
* The §13 table is WIDER than the event catalog (same relationship the
* WP-2.2 `transitions.ts` documents for its machines):
*  - claim:      ACTIVE → RETRACTED via CLAIM_RETRACTED (the only event);
*  - fact:       NO machine — status is the const `ACTIVE` (§7.2 「恒 ACTIVE」);
*  - artifact:   REGISTERED → MISSING via ARTIFACT_MARKED_MISSING (the only
*                event). MISSING → REGISTERED (「找回经用户操作」) is LEGAL in
*                §13 but has NO V1 HistoryEvent — unreachable through the
*                reducer by construction (a service-level recovery operation
*                would drive it later; `checkTransition` already accepts it);
*  - relation:   ACTIVE → REMOVED via RELATION_REMOVED (the only event).
*
* Pure data + pure guards (zero I/O). `checkTransition` throws
* `SemanticDomainError` (WRONG_STATE) on illegal pairs — the reducer and
* the validator share this one guard, so the §13 table cannot drift between
* the two paths.
*/
/**
* The frozen legal-transition tables for the three stateful semantic
* registries (key = machine → from → legal tos; terminal states → `[]`).
* Fact has no machine (status const ACTIVE, §7.2) and is deliberately absent.
*/
const SEMANTIC_TRANSITIONS = {
	claim: {
		ACTIVE: ["RETRACTED"],
		RETRACTED: []
	},
	artifact: {
		REGISTERED: ["MISSING"],
		MISSING: ["REGISTERED"]
	},
	relation: {
		ACTIVE: ["REMOVED"],
		REMOVED: []
	}
};
/** The legal target states of `from` on `machine` (`[]` = terminal). */
function legalTargets(machine, from) {
	return SEMANTIC_TRANSITIONS[machine][from] ?? [];
}
/**
* Guard one transition. Throws `SemanticDomainError` (code WRONG_STATE) when
* `to` is not in the legal set for `from` (including same-state no-ops, which
* the table does not list). The message always names the machine, the CURRENT
* state, the TARGET state, and the LEGAL SET (「terminal」 when empty).
*
* Returns void on success (the caller performs the row update).
*/
function checkTransition(machine, objectId, from, to) {
	const legal = legalTargets(machine, from);
	if (!legal.includes(to)) {
		const suffix = legal.length === 0 ? ` (${from} is terminal)` : ` (legal from ${from}: ${legal.join(" | ")})`;
		throw new SemanticDomainError("WRONG_STATE", `${machine} ${JSON.stringify(objectId)} is ${from}; transition to ${to} is not in the §13 legal table${suffix}`);
	}
}
/**
* The three typed transition checks the reducer / validator use (one per
* stateful registry). Each throws WRONG_STATE on an illegal move.
*/
function checkClaimTransition(claimId, from, to) {
	checkTransition("claim", claimId, from, to);
}
function checkArtifactTransition(artifactId, from, to) {
	checkTransition("artifact", artifactId, from, to);
}
function checkRelationTransition(relationId, from, to) {
	checkTransition("relation", relationId, from, to);
}
//#endregion
//#region src/host/domain/semantics/relations.ts
/** All 24 object kinds (RELATED_TO is 任意 → 任意). */
const ALL_KINDS = [
	"PROJECT",
	"TOPIC",
	"WORKSTREAM",
	"TASK",
	"GATE",
	"MILESTONE",
	"RUN",
	"CLAIM",
	"FACT",
	"ARTIFACT",
	"RELATION",
	"OBJECTIVE",
	"INTERVENTION",
	"NEXT_ACTION",
	"BLOCKER",
	"INTERACTION",
	"REPORTING_ITEM",
	"SCHEDULED_EVENT",
	"INBOX_ITEM",
	"PLAN_FORK",
	"TOPOLOGY_EDGE",
	"DISCOVERED_SESSION",
	"HISTORY_EVENT",
	"ANALYSIS_RECORD"
];
/**
* The frozen §8 组合表（工程默认；扩展需 bump schema-version）, one row per
* relation type — field-for-field with DOMAIN_SCHEMA §8 L380-391.
*/
const RELATION_COMBINATION_TABLE = {
	DEPENDS_ON: {
		sources: ["TASK", "GATE"],
		targets: [
			"TASK",
			"GATE",
			"MILESTONE"
		]
	},
	SUPPORTED_BY: {
		sources: ["CLAIM"],
		targets: [
			"FACT",
			"ARTIFACT",
			"CLAIM"
		]
	},
	CONTRADICTED_BY: {
		sources: ["CLAIM"],
		targets: [
			"FACT",
			"CLAIM",
			"ARTIFACT"
		]
	},
	DERIVED_FROM: {
		sources: ["FACT"],
		targets: ["ARTIFACT", "FACT"]
	},
	PRODUCED_BY: {
		sources: ["ARTIFACT"],
		targets: ["RUN"]
	},
	VALIDATED_BY: {
		sources: ["GATE"],
		targets: ["FACT", "ARTIFACT"]
	},
	CONSUMES: {
		sources: ["TASK", "RUN"],
		targets: ["ARTIFACT"]
	},
	CONTRIBUTES_TO: {
		sources: [
			"TASK",
			"WORKSTREAM",
			"CLAIM"
		],
		targets: ["OBJECTIVE"]
	},
	IMPLEMENTS: {
		sources: ["TASK"],
		targets: ["OBJECTIVE", "MILESTONE"]
	},
	RELATED_TO: {
		sources: ALL_KINDS,
		targets: ALL_KINDS
	}
};
/**
* INV-REL-1/3: true iff `source.kind → target.kind` is a listed combination
* for `relationType`. Unknown types (outside the frozen 10) are illegal here
* as well (the row is undefined → false).
*/
function isLegalRelationCombination(relationType, sourceKind, targetKind) {
	const row = RELATION_COMBINATION_TABLE[relationType];
	return row !== void 0 && row.sources.includes(sourceKind) && row.targets.includes(targetKind);
}
/**
* The reverse forms §8 refuses to persist (INV-REL-2 「不保存的反向形式」).
* They are not members of the frozen 10-type set — this list exists so a
* payload carrying one (e.g. a legacy `SUPPORTS`) is rejected with a precise
* message naming the RELY_ON direction, not a generic type error.
*/
const FORBIDDEN_REVERSE_FORMS = [
	"SUPPORTS",
	"PRODUCES",
	"REQUIRED_BY",
	"VALIDATES"
];
/** True iff `value` is one of the §8 reverse forms (INV-REL-2). */
function isForbiddenReverseForm(value) {
	return typeof value === "string" && FORBIDDEN_REVERSE_FORMS.includes(value);
}
/** Structural equality of two typed refs. */
function sameRef(a, b) {
	return a.kind === b.kind && a.id === b.id;
}
/**
* The canonical §8 唯一性 key:
* `(source.kind, source.id, relation_type, target.kind, target.id)`.
*/
function relationEdgeKey(source, relationType, target) {
	return `${source.kind}:${source.id}|${relationType}|${target.kind}:${target.id}`;
}
/**
* INV-REL-1: a self-loop (`source` === `target`) — the premise of a RELY_ON
* edge cannot be the edge's own subject.
*/
function isSelfLoop(source, target) {
	return sameRef(source, target);
}
/**
* Find an existing row (ANY status — §15 UNIQUE has no status qualifier)
* carrying the SAME 5-tuple as the proposed edge. `undefined` = no duplicate.
*/
function findDuplicateEdge(relations, source, relationType, target) {
	const key = relationEdgeKey(source, relationType, target);
	for (const row of relations.values()) if (relationEdgeKey(row.source, row.relation_type, row.target) === key) return row;
}
/**
* §8 「禁止同边反向重复」: find an existing row (ANY status) carrying the
* SAME edge in the REVERSE direction (target↔source, same type).
*
* Only meaningful for the symmetric type — RELATED_TO is the unique row of
* the §8 table whose reverse direction is expressible within the frozen
* 10-type set (A→B and B→A are the same weak association). For every other
* type the reverse of a legal edge is a DIFFERENT fact (A DEPENDS_ON B and
* B DEPENDS_ON A are both legal, distinct edges) and never returned.
*/
function findReverseDuplicateEdge(relations, source, relationType, target) {
	if (relationType !== "RELATED_TO") return void 0;
	return findDuplicateEdge(relations, target, relationType, source);
}
/**
* True iff `ref` is a well-formed typed ref for the row/edge checks:
* a non-empty `id` string and one of the 24 frozen object kinds.
*/
function isWellFormedRef(value) {
	if (typeof value !== "object" || value === null) return false;
	const v = value;
	return typeof v.kind === "string" && typeof v.id === "string" && v.id.length > 0 && isObjectKind(v.kind);
}
const ALL_KIND_SET = new Set(ALL_KINDS);
/** True iff `value` is one of the 24 frozen object kinds (common.schema `objectKind`). */
function isObjectKind(value) {
	return typeof value === "string" && ALL_KIND_SET.has(value);
}
/**
* Derive the conflict flags for ALL claims from the current (claims,
* relations) — the pure derivation the reducer re-runs after every
* claim/relation change. Deterministic: `relationIds` sorted, claims
* visited in map (insertion) order.
*
* A claim is flagged iff:
*  - its row exists and is ACTIVE (RETRACTED claims are cleared), and
*  - ≥1 ACTIVE relation has `source = (CLAIM, claim.id)` and
*    `relation_type = CONTRADICTED_BY`.
*/
function deriveConflictFlags(state) {
	const bySource = /* @__PURE__ */ new Map();
	for (const row of state.relations.values()) if (row.status === "ACTIVE" && row.relation_type === "CONTRADICTED_BY" && row.source.kind === "CLAIM") {
		const ids = bySource.get(row.source.id);
		if (ids === void 0) bySource.set(row.source.id, [row.id]);
		else ids.push(row.id);
	}
	const flags = /* @__PURE__ */ new Map();
	for (const [claimId, claim] of state.claims) {
		if (claim.status !== "ACTIVE") continue;
		const edges = bySource.get(claimId);
		if (edges === void 0 || edges.length === 0) continue;
		flags.set(claimId, {
			kind: "PENDING_REVIEW",
			relationIds: [...edges].sort()
		});
	}
	return flags;
}
//#endregion
//#region src/host/domain/semantics/reducer.ts
/**
* WP-2.5 — the pure semantic reducer: event stream → derived registry state.
*
* ## Contract (HISTORY_EVENT_CATALOG §6 「事件 → 派生状态」)
*
*  - `reduceSemanticEvent(state, event)` is a PURE function: no I/O, no
*    clock, no mutation of `state` (structural sharing; the input maps are
*    only read). It returns a NEW `SemanticState`, or the SAME reference for
*    the 13 non-semantic events (catalog §6: those events update OTHER
*    derived caches — run/task/gate/… — not the four semantic registries).
*  - One reducer, two consumers: the WP-2.3 replay engine (fold the full
*    stream from an empty state — TC-HIST-006 rebuild) and incremental
*    maintenance (fold one appended event onto the current derived state).
*    Both get the same code path by construction.
*  - A VALID stream (shape-checked + state-validated at write time,
*    WP-2.2 `validateEvent`) never makes the reducer throw. A CORRUPT
*    stream must fail the fold LOUDLY (`SemanticDomainError`) rather than
*    produce wrong derived rows — the derived columns are only as good as
*    the fold, and TC-HIST-006 asserts exactness.
*
* ## Determinism (catalog §2)
*
*  - Folding the same ordered stream twice yields byte-identical states
*    (TC-HIST-005 幂等 replay — the maps are rebuilt from the same inputs,
*    the conflict flags are a pure derivation, relationIds are sorted);
*  - `orderByAudit` / `orderBySemantic` implement the §2 replay orderings
*    (`ORDER BY event_seq` / `ORDER BY occurred_at, event_seq` with the
*    deterministic event_seq tie-break, TC-HIST-004) — domain-owned copies
*    of the WP-2.2 sorters (domain may not import history), cross-checked
*    for identity in `tests/semantics/reducer-determinism.test.ts`.
*
* ## Owner checks (state-local)
*
* The reducer re-checks what it CAN check from the semantic state alone
* (subject object's workstream on retract/mark-missing; the §8
* `source.ws ?? target.ws` rule when both endpoints are semantic or
* WORKSTREAM-kind). Endpoints outside the semantic state (TASK/GATE/…)
* cannot be resolved here — the write-time validator (full
* `HistoryObjectContext`) owns the complete check; the reducer skips what
* it cannot see rather than guess.
*
* Zero I/O, zero DSH (INV-PERM-5).
*/
/** The seven semantic event names (catalog §4 类别 语义标签/Artifact/Relation). */
const SEMANTIC_EVENT_TYPES = [
	"FACT_RECORDED",
	"CLAIM_RECORDED",
	"CLAIM_RETRACTED",
	"ARTIFACT_REGISTERED",
	"ARTIFACT_MARKED_MISSING",
	"RELATION_ADDED",
	"RELATION_REMOVED"
];
const SEMANTIC_EVENT_SET = new Set(SEMANTIC_EVENT_TYPES);
/** True iff `event.eventType` is one of the seven semantic events (no narrowing). */
function isSemanticEvent(event) {
	return SEMANTIC_EVENT_SET.has(event.eventType);
}
/** The EMPTY semantic state — the replay start (catalog §6 重放: 从空 DB). */
function initialSemanticState() {
	return {
		claims: /* @__PURE__ */ new Map(),
		facts: /* @__PURE__ */ new Map(),
		artifacts: /* @__PURE__ */ new Map(),
		relations: /* @__PURE__ */ new Map(),
		conflict: /* @__PURE__ */ new Map()
	};
}
/**
* Reduce ONE event into a new semantic state (pure; throws
* `SemanticDomainError` on a precondition violation — see module doc).
* Non-semantic events return the input reference unchanged (no-op, §6).
*/
function reduceSemanticEvent(state, event) {
	if (typeof event !== "object" || event === null || typeof event.eventType !== "string") throw new TypeError("reduceSemanticEvent: event must be an object with a string eventType");
	if (!isSemanticEvent(event)) return state;
	const owner = envelopeOwner(event);
	switch (event.eventType) {
		case "FACT_RECORDED": {
			const p = event.payload;
			if (!isRecord(p) || typeof p.fact_id !== "string" || typeof p.statement !== "string" || p.statement.length === 0) throwInvalidPayload("FACT_RECORDED", "payload requires string fact_id + non-empty string statement");
			requireIdKind(p.fact_id, "FACT", "/payload/fact_id");
			if (state.facts.has(p.fact_id)) throw new SemanticDomainError("OBJECT_ALREADY_EXISTS", `Fact ${JSON.stringify(p.fact_id)} already exists; FACT_RECORDED requires a fresh fact_id (catalog §5.3: 新建)`, "/payload/fact_id");
			const row = {
				id: p.fact_id,
				workstream_id: owner,
				statement: p.statement,
				...typeof p.created_by_run === "string" ? { created_by_run: p.created_by_run } : {},
				created_by: actorOf(event, "FACT_RECORDED"),
				...isArrayOfStrings(p.references) ? { references: [...p.references] } : {},
				recorded_at: event.occurredAt,
				status: FACT_STATUS
			};
			const facts = new Map(state.facts);
			facts.set(p.fact_id, row);
			return {
				...state,
				facts
			};
		}
		case "CLAIM_RECORDED": {
			const p = event.payload;
			if (!isRecord(p) || typeof p.claim_id !== "string" || typeof p.statement !== "string" || p.statement.length === 0) throwInvalidPayload("CLAIM_RECORDED", "payload requires string claim_id + non-empty string statement");
			requireIdKind(p.claim_id, "CLAIM", "/payload/claim_id");
			if (state.claims.has(p.claim_id)) throw new SemanticDomainError("OBJECT_ALREADY_EXISTS", `Claim ${JSON.stringify(p.claim_id)} already exists; CLAIM_RECORDED requires a fresh claim_id (catalog §5.3: 新建)`, "/payload/claim_id");
			const row = {
				id: p.claim_id,
				workstream_id: owner,
				statement: p.statement,
				...typeof p.created_by_run === "string" ? { created_by_run: p.created_by_run } : {},
				created_by: actorOf(event, "CLAIM_RECORDED"),
				...isArrayOfStrings(p.references) ? { references: [...p.references] } : {},
				recorded_at: event.occurredAt,
				status: "ACTIVE"
			};
			const claims = new Map(state.claims);
			claims.set(p.claim_id, row);
			return {
				...state,
				claims
			};
		}
		case "CLAIM_RETRACTED": {
			const p = event.payload;
			if (!isRecord(p) || typeof p.claim_id !== "string") throwInvalidPayload("CLAIM_RETRACTED", "payload requires string claim_id");
			requireIdKind(p.claim_id, "CLAIM", "/payload/claim_id");
			const claim = state.claims.get(p.claim_id);
			if (claim === void 0) throw new SemanticDomainError("OBJECT_NOT_FOUND", `Claim ${JSON.stringify(p.claim_id)} does not exist (catalog §5.3: 存在)`, "/payload/claim_id");
			checkClaimTransition(p.claim_id, claim.status, "RETRACTED");
			if (claim.workstream_id !== owner) throwOwnerMismatch(`Claim ${p.claim_id}`, claim.workstream_id, owner, "/payload/claim_id");
			const row = {
				...claim,
				status: "RETRACTED"
			};
			const claims = new Map(state.claims);
			claims.set(p.claim_id, row);
			return {
				...state,
				claims,
				conflict: deriveConflictFlags({
					claims,
					relations: state.relations
				})
			};
		}
		case "ARTIFACT_REGISTERED": {
			const p = event.payload;
			if (!isRecord(p) || typeof p.artifact_id !== "string" || !isArtifactType(p.type) || typeof p.title !== "string" || p.title.length === 0 || typeof p.uri !== "string" || p.uri.length === 0) throwInvalidPayload("ARTIFACT_REGISTERED", `payload requires string artifact_id + artifact type ∈ {${ARTIFACT_TYPES.join(", ")}} + non-empty title/uri`);
			requireIdKind(p.artifact_id, "ARTIFACT", "/payload/artifact_id");
			if (state.artifacts.has(p.artifact_id)) throw new SemanticDomainError("OBJECT_ALREADY_EXISTS", `Artifact ${JSON.stringify(p.artifact_id)} already exists; ARTIFACT_REGISTERED requires a fresh artifact_id (catalog §5.4: 新建)`, "/payload/artifact_id");
			if (typeof p.supersedes === "string") {
				requireIdKind(p.supersedes, "ARTIFACT", "/payload/supersedes");
				if (!state.artifacts.has(p.supersedes)) throw new SemanticDomainError("OBJECT_NOT_FOUND", `supersedes artifact ${JSON.stringify(p.supersedes)} does not exist (catalog §5.4: supersedes 存在)`, "/payload/supersedes");
			}
			const row = {
				id: p.artifact_id,
				workstream_id: owner,
				type: p.type,
				title: p.title,
				uri: p.uri,
				...typeof p.content_hash === "string" ? { content_hash: p.content_hash } : {},
				...typeof p.created_by_run === "string" ? { created_by_run: p.created_by_run } : {},
				...typeof p.related_task === "string" ? { related_task: p.related_task } : {},
				...typeof p.supersedes === "string" ? { supersedes: p.supersedes } : {},
				recorded_at: event.occurredAt,
				status: "REGISTERED"
			};
			const artifacts = new Map(state.artifacts);
			artifacts.set(p.artifact_id, row);
			return {
				...state,
				artifacts
			};
		}
		case "ARTIFACT_MARKED_MISSING": {
			const p = event.payload;
			if (!isRecord(p) || typeof p.artifact_id !== "string") throwInvalidPayload("ARTIFACT_MARKED_MISSING", "payload requires string artifact_id");
			requireIdKind(p.artifact_id, "ARTIFACT", "/payload/artifact_id");
			const artifact = state.artifacts.get(p.artifact_id);
			if (artifact === void 0) throw new SemanticDomainError("OBJECT_NOT_FOUND", `Artifact ${JSON.stringify(p.artifact_id)} does not exist (catalog §5.4: 存在)`, "/payload/artifact_id");
			checkArtifactTransition(p.artifact_id, artifact.status, "MISSING");
			if (artifact.workstream_id !== owner) throwOwnerMismatch(`Artifact ${p.artifact_id}`, artifact.workstream_id, owner, "/payload/artifact_id");
			const row = {
				...artifact,
				status: "MISSING"
			};
			const artifacts = new Map(state.artifacts);
			artifacts.set(p.artifact_id, row);
			return {
				...state,
				artifacts
			};
		}
		case "RELATION_ADDED": {
			const p = event.payload;
			if (!isRecord(p) || typeof p.relation_id !== "string" || typeof p.relation_type !== "string" || !isWellFormedRef(p.source) || !isWellFormedRef(p.target)) throwInvalidPayload("RELATION_ADDED", "payload requires string relation_id/relation_type + well-formed {kind,id} source/target");
			requireIdKind(p.relation_id, "RELATION", "/payload/relation_id");
			if (state.relations.has(p.relation_id)) throw new SemanticDomainError("OBJECT_ALREADY_EXISTS", `Relation ${JSON.stringify(p.relation_id)} already exists; RELATION_ADDED requires a fresh relation_id (catalog §5.5: 新建)`, "/payload/relation_id");
			if (isForbiddenReverseForm(p.relation_type)) throw new SemanticDomainError("RELATION_TYPE_UNKNOWN", `${p.relation_type} is a reverse form refused by §8 (INV-REL-2: only RELY_ON direct edges are persisted; the reverse view is derived by incoming-edge query)`, "/payload/relation_type");
			if (!isRelationType(p.relation_type)) throw new SemanticDomainError("RELATION_TYPE_UNKNOWN", `${p.relation_type} is not one of the frozen 10 relation types (DOMAIN_SCHEMA §8, INV-REL-3)`, "/payload/relation_type");
			if (!isLegalRelationCombination(p.relation_type, p.source.kind, p.target.kind)) throw new SemanticDomainError("RELATION_COMBINATION", `${p.relation_type} from ${p.source.kind} to ${p.target.kind} is not in the frozen §8 combination table (INV-REL-1: TARGET 始终是 SOURCE 的前提/来源/输入/证据/上位目标)`, "/payload/relation_type");
			if (isSelfLoop(p.source, p.target)) throw new SemanticDomainError("RELATION_SELF_LOOP", `Relation ${p.relation_id} sources and targets the same object (${p.source.kind} ${p.source.id}); a RELY_ON premise cannot be itself (INV-REL-1)`, "/payload/source");
			const dup = findDuplicateEdge(state.relations, p.source, p.relation_type, p.target);
			if (dup !== void 0) throw new SemanticDomainError("RELATION_DUPLICATE", `An edge with the same 5-tuple already exists as relation ${dup.id} (DOMAIN_SCHEMA §8 唯一性 / §15 UNIQUE(source_kind, source_id, relation_type, target_kind, target_id))`, "/payload/source");
			const rev = findReverseDuplicateEdge(state.relations, p.source, p.relation_type, p.target);
			if (rev !== void 0) throw new SemanticDomainError("RELATION_REVERSE_DUPLICATE", `The same edge in reverse already exists as relation ${rev.id} (DOMAIN_SCHEMA §8: 禁止同边反向重复)`, "/payload/source");
			const ownerWs = endpointWorkstream(p.source, state) ?? endpointWorkstream(p.target, state);
			if (ownerWs !== void 0 && ownerWs !== owner) throwOwnerMismatch(`Relation ${p.relation_id}`, ownerWs, owner, "/ownerWorkstreamId");
			const row = {
				id: p.relation_id,
				source: {
					kind: p.source.kind,
					id: p.source.id
				},
				relation_type: p.relation_type,
				target: {
					kind: p.target.kind,
					id: p.target.id
				},
				created_by: actorOf(event, "RELATION_ADDED"),
				created_at: event.occurredAt,
				status: "ACTIVE"
			};
			const relations = new Map(state.relations);
			relations.set(p.relation_id, row);
			return {
				...state,
				relations,
				conflict: deriveConflictFlags({
					claims: state.claims,
					relations
				})
			};
		}
		case "RELATION_REMOVED": {
			const p = event.payload;
			if (!isRecord(p) || typeof p.relation_id !== "string") throwInvalidPayload("RELATION_REMOVED", "payload requires string relation_id");
			requireIdKind(p.relation_id, "RELATION", "/payload/relation_id");
			const relation = state.relations.get(p.relation_id);
			if (relation === void 0) throw new SemanticDomainError("OBJECT_NOT_FOUND", `Relation ${JSON.stringify(p.relation_id)} does not exist (catalog §5.5: 存在)`, "/payload/relation_id");
			checkRelationTransition(p.relation_id, relation.status, "REMOVED");
			if (!isWellFormedRef(p.source) || !isWellFormedRef(p.target) || typeof p.relation_type !== "string" || !sameRef(p.source, relation.source) || p.relation_type !== relation.relation_type || !sameRef(p.target, relation.target)) throw new SemanticDomainError("RELATION_ENDPOINT_MISMATCH", `Recorded source/relation_type/target must match the existing relation (catalog §5.5 audit redundancy); stored: source=${JSON.stringify(relation.source)} relation_type=${relation.relation_type} target=${JSON.stringify(relation.target)}`, "/payload/source");
			const ownerWs = endpointWorkstream(relation.source, state) ?? endpointWorkstream(relation.target, state);
			if (ownerWs !== void 0 && ownerWs !== owner) throwOwnerMismatch(`Relation ${p.relation_id}`, ownerWs, owner, "/ownerWorkstreamId");
			const row = {
				...relation,
				status: "REMOVED",
				removed_at: event.occurredAt
			};
			const relations = new Map(state.relations);
			relations.set(p.relation_id, row);
			return {
				...state,
				relations,
				conflict: deriveConflictFlags({
					claims: state.claims,
					relations
				})
			};
		}
		default: return state;
	}
}
/**
* Fold a stream in the GIVEN order (pure). Replay from empty:
* `foldSemanticEvents(orderByAudit(allEvents))` rebuilds the derived
* semantic state (catalog §6 重放 / TC-HIST-006).
*/
function foldSemanticEvents(events, init = initialSemanticState()) {
	let state = init;
	for (const event of events) state = reduceSemanticEvent(state, event);
	return state;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isArrayOfStrings(value) {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}
const ACTOR_KINDS = [
	"USER",
	"AGENT",
	"PLUGIN",
	"SYSTEM"
];
function actorOf(event, eventType) {
	const actor = event.actor;
	if (!isRecord(actor) || typeof actor.kind !== "string" || !ACTOR_KINDS.includes(actor.kind)) throw new SemanticDomainError("INVALID_PAYLOAD", `${eventType} requires a well-formed envelope actor (kind ∈ USER|AGENT|PLUGIN|SYSTEM) — it becomes the row's created_by (common.schema actorRef)`, "/actor");
	return actor;
}
function envelopeOwner(event) {
	const owner = event.ownerWorkstreamId;
	if (typeof owner !== "string" || parseId(owner)?.kind !== "WORKSTREAM") throw new SemanticDomainError("INVALID_ENVELOPE", `ownerWorkstreamId must be a well-formed WS id (got ${JSON.stringify(owner)}) — the row's workstream_id (INV-SCI-1: workstream-local label)`, "/ownerWorkstreamId");
	return owner;
}
function requireIdKind(id, kind, path) {
	const parsed = parseId(id);
	if (parsed === null || parsed.kind !== kind) throw new SemanticDomainError("INVALID_ID", `${path} must be a well-formed ${kind} id (${kind === "RELATION" ? "REL-<n>" : `${kind.slice(0, 1)}-<n>`}; got ${JSON.stringify(id)})`, path);
}
function throwInvalidPayload(eventType, what) {
	throw new SemanticDomainError("INVALID_PAYLOAD", `${eventType}: ${what}`, "/payload");
}
function throwOwnerMismatch(object, actualWs, eventOwner, path) {
	throw new SemanticDomainError("OWNER_MISMATCH", `${object} belongs to workstream ${actualWs}, not the event owner ${eventOwner} (catalog §4 owner 列)`, path);
}
/**
* The workstream a typed ref is local to, resolvable from the SEMANTIC
* STATE ALONE (state-local owner check):
*  - WORKSTREAM ref → itself;
*  - CLAIM/FACT/ARTIFACT → the row's workstream_id (undefined = row absent);
*  - anything else (TASK/GATE/MILESTONE/RUN/…) → undefined: outside this
*    state; the write-time validator (full ctx) owns that resolution.
*/
function endpointWorkstream(ref, state) {
	switch (ref.kind) {
		case "WORKSTREAM": return ref.id;
		case "CLAIM": return state.claims.get(ref.id)?.workstream_id;
		case "FACT": return state.facts.get(ref.id)?.workstream_id;
		case "ARTIFACT": return state.artifacts.get(ref.id)?.workstream_id;
		default: return;
	}
}
//#endregion
//#region src/host/service/wiring/semantics.ts
/**
* WP-3.6 (RR-011 (b)) — the semantics stack wired at the STORE level:
* one reducer, two consumers, one derived_state row.
*
* Claim/Fact/Artifact/Relation (the four semantic registries,
* HISTORY_EVENT_CATALOG §6 / DOMAIN_SCHEMA §7–8) live as ONE
* `derived_state` row per project — key `semantics:<projectId>`
* (objectKind `semantics`, objectId = the project id; the registry is
* project-scoped by construction: ids are allocated per project,
* §1.1 规则 2) — maintained by the SAME `reduceSemanticEvent` the replay
* fold uses (WP-2.5: "One reducer, two consumers"):
*
*   1. INCREMENTAL — `validateHook` runs INSIDE the `appendEvents` write
*      transaction (the store's `validate` hook seam): it reads the
*      current `semantics` row through the TxScope, folds every semantic
*      event of the batch onto it (non-semantic events pass through
*      untouched), and writes the result back via the TxScope — so the
*      derived row updates in the SAME transaction as the event append
*      (§15: 与事件 append 同事务写入) and rolls back with it.
*   2. REPLAY — `rebuild` collects the FULL event log in canonical AUDIT
*      order (`collectAllEvents`, the pinned rebuild order), folds from
*      the empty state through `foldSemanticEvents` (the same reducer),
*      and — the WP-2.3 consistency framework — deep-compares the
*      rebuilt table against the incrementally maintained one
*      (`compareDerivedStates`), then (default) replaces the
*      `derived_state` table in ONE independent transaction touching
*      ONLY `derived_state` (the WP-2.3 write discipline; rows of other
*      object kinds — `workstream` lifecycle, `RUN` docs, … — pass
*      through untouched: this rebuild is the SEMANTICS slice, and the
*      event log is provably unable to touch any other row).
*
* The consistency guarantee: a valid stream appended incrementally
* (one batch per append, in canonical order) yields a table that a full
* audit-order rebuild reproduces BYTE-for-byte (canonical JSON) — the
* tests pin this, including the corruption→rebuild→clean cycle.
*
* A CORRUPT `semantics` row (non-strict-JSON, malformed codec shape)
* fails LOUD on the incremental path (the append is rejected — the
* corrupt cache never silently poisons a fold) and on the rebuild read
* (the rebuild refuses to pass through garbage it cannot parse —
* `readDerivedState` already asserts strict JSON per row, so the codec
* check here covers the semantic shape).
*
* No DSH imports (INV-PERM-5).
*/
/** The frozen actorRef kinds (common.schema.json `$defs/actorRef.kind`). */
function isActorKind(value) {
	return value === "USER" || value === "AGENT" || value === "PLUGIN" || value === "SYSTEM";
}
/**
* Adapt a store `HistoryEventRecord` (the opaque-JSON carrier) to the
* domain's `SemanticInputEvent` (the strict carrier). The registry
* already guaranteed the envelope at write time; a record that fails the
* actor-kind check here is a CORRUPT event log and fails loud (the fold
* must never silently drop or misattribute an event).
*/
function toSemanticInputEvent(record) {
	const kind = record.actor?.kind;
	if (typeof kind !== "string" || !isActorKind(kind)) throw new HostWiringError("WIRING_SERVICE", `semantic fold: ${record.eventType} ${record.eventId} (audit seq ${record.eventSeq}) carries an illegal actor.kind ${JSON.stringify(kind ?? null)} — corrupt event log (fail loud)`);
	const actor = {
		...record.actor,
		kind
	};
	return {
		...record,
		actor
	};
}
/** The single derived_state key holding the project's semantic registry. */
function semanticStateKey(projectId) {
	return stateKey("semantics", projectId);
}
const SEMANTICS_KIND = "semantics";
function mapToRecord(entries) {
	const out = {};
	for (const [k, v] of [...entries.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) out[k] = v;
	return out;
}
/** Serialize (pure; canonical — section keys sorted, RR-011 (b)). */
function semanticStateToJson(state) {
	return {
		claims: mapToRecord(state.claims),
		facts: mapToRecord(state.facts),
		artifacts: mapToRecord(state.artifacts),
		relations: mapToRecord(state.relations),
		conflict: mapToRecord(state.conflict)
	};
}
function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertRowKeyedRecord(doc, section, key) {
	if (!isPlainObject(doc[section])) throw new HostWiringError("WIRING_SERVICE", `semantic state doc: ${section} must be an object (corrupt derived_state row ${key})`);
	const record = doc[section];
	for (const [id, row] of Object.entries(record)) if (!isPlainObject(row) || row.id !== id) throw new HostWiringError("WIRING_SERVICE", `semantic state doc: ${section} entry ${JSON.stringify(id)} is not a row object keyed by its id (corrupt derived_state row ${key})`);
	return record;
}
/** Deserialize with strict shape checks (corruption ⇒ fail loud). */
function jsonToSemanticState(doc, key) {
	if (!isPlainObject(doc)) throw new HostWiringError("WIRING_SERVICE", `semantic state doc at ${key} is not an object (corrupt)`);
	const claims = assertRowKeyedRecord(doc, "claims", key);
	const facts = assertRowKeyedRecord(doc, "facts", key);
	const artifacts = assertRowKeyedRecord(doc, "artifacts", key);
	const relations = assertRowKeyedRecord(doc, "relations", key);
	if (!isPlainObject(doc.conflict)) throw new HostWiringError("WIRING_SERVICE", `semantic state doc: conflict must be an object (corrupt derived_state row ${key})`);
	const conflict = /* @__PURE__ */ new Map();
	for (const [claimId, flag] of Object.entries(doc.conflict)) {
		if (!isPlainObject(flag) || flag.kind !== "PENDING_REVIEW" || !Array.isArray(flag.relationIds)) throw new HostWiringError("WIRING_SERVICE", `semantic state doc: conflict flag for ${JSON.stringify(claimId)} is malformed (corrupt derived_state row ${key})`);
		conflict.set(claimId, flag);
	}
	return {
		claims: new Map(Object.entries(claims)),
		facts: new Map(Object.entries(facts)),
		artifacts: new Map(Object.entries(artifacts)),
		relations: new Map(Object.entries(relations)),
		conflict
	};
}
/**
* Build the store-level semantics maintainer (RR-011 (b)).
*/
function makeSemanticMaintainer(input) {
	const key = semanticStateKey(input.projectId);
	if (!/^[A-Z]{3}-\d+$/.test(input.projectId)) throw new HostWiringError("WIRING_SERVICE", `semantic maintainer: projectId must be a well-formed PRJ id (got ${JSON.stringify(input.projectId)})`);
	const validateHook = (events, tx) => {
		const current = tx.getDerivedState(SEMANTICS_KIND, input.projectId);
		let state = current === null ? initialSemanticState() : jsonToSemanticState(current, key);
		let touched = false;
		for (const event of events) {
			if (!SEMANTIC_EVENT_TYPES.includes(event.eventType)) continue;
			const semantic = toSemanticInputEvent(event);
			if (!isSemanticEvent(semantic)) continue;
			state = reduceSemanticEvent(state, semantic);
			touched = true;
		}
		if (touched) tx.setDerivedState(SEMANTICS_KIND, input.projectId, semanticStateToJson(state));
	};
	const rebuild = (rebuildInput) => {
		const semantic = collectAllEvents(input.store, rebuildInput.workstreams, "audit").filter((e) => SEMANTIC_EVENT_TYPES.includes(e.eventType));
		const folded = foldSemanticEvents(semantic.map(toSemanticInputEvent));
		const touched = semantic.length > 0;
		const current = readDerivedState(input.store);
		const rebuilt = /* @__PURE__ */ new Map();
		for (const [k, value] of current) {
			let kind;
			try {
				kind = parseStateKey(k).objectKind;
			} catch {
				throw new HostWiringError("WIRING_SERVICE", `semantic rebuild: derived_state key ${JSON.stringify(k)} is malformed — refusing to pass a corrupt key through`);
			}
			if (kind === SEMANTICS_KIND && k === key) continue;
			rebuilt.set(k, value);
		}
		if (touched) rebuilt.set(key, semanticStateToJson(folded));
		const report = compareDerivedStates(rebuilt, current);
		if (!report.ok) input.logger?.error("semantic-rebuild", `incremental vs rebuild DRIFT: ${report.onlyInRebuilt.length} only-in-rebuilt, ${report.onlyInIncremental.length} only-in-incremental, ${report.differing.length} differing`);
		else input.logger?.info("semantic-rebuild", `incremental ≡ rebuild (${rebuilt.size} rows)`);
		let applied = false;
		if (rebuildInput.apply !== false) {
			replaceDerivedStateTable(input.store.path, rebuilt);
			applied = true;
			input.logger?.info("semantic-rebuild", `derived_state replaced (${rebuilt.size} rows, one independent transaction)`);
		}
		return {
			report,
			applied,
			rowCount: rebuilt.size
		};
	};
	return {
		key,
		validateHook,
		rebuild
	};
}
/**
* Replace the `derived_state` table with `states` in ONE independent
* `BEGIN IMMEDIATE` transaction on a second connection to the SAME WAL
* file — touching ONLY `derived_state` (the event table is
* trigger-protected and is not prepared here at all). Crash ⇒ pre- or
* post-transaction, never partial.
*/
function replaceDerivedStateTable(dbPath, states) {
	let db;
	try {
		db = new DatabaseSync(dbPath);
	} catch (cause) {
		throw new HostWiringError("WIRING_SERVICE", `semantic rebuild: cannot open ${dbPath} for the derived_state replace: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
	}
	try {
		db.exec("BEGIN IMMEDIATE");
		db.exec("DELETE FROM derived_state");
		const insert = db.prepare("INSERT INTO derived_state (object_kind, object_id, state) VALUES (?, ?, ?)");
		for (const [key, value] of states) {
			const parsed = parseStateKey(key);
			insert.run(parsed.objectKind, parsed.objectId, JSON.stringify(value));
		}
		db.exec("COMMIT");
	} catch (e) {
		try {
			db.exec("ROLLBACK");
		} catch {}
		throw new HostWiringError("WIRING_SERVICE", `semantic rebuild: the derived_state replace failed (rolled back): ${e instanceof Error ? e.message : String(e)}`, { cause: e });
	} finally {
		try {
			db.close();
		} catch {}
	}
	return states.size;
}
//#endregion
//#region src/host/service/wiring/realize-store.ts
/**
* Wrap `store` so every append settles the realizer's pending file
* compensation AND (optionally) composes the wiring's extra in-transaction
* validate hooks. All other members are the same functions (closure-bound
* on the underlying store — no state of this wrapper survives between
* calls). The wrapped handle keeps the EXACT `ResearchStore` surface (the
* append-only type-surface audit in tests/store/append-only.test.ts keeps
* pinning it).
*/
function withRealizeCompensation(store, realizer, options = {}) {
	const extraHooks = options.validateHooks ?? [];
	return {
		path: store.path,
		userVersion: store.userVersion,
		close: store.close,
		getEvent: store.getEvent,
		listRange: store.listRange,
		meta: store.meta,
		appendEvents(events, options) {
			const composed = extraHooks.length === 0 ? options : {
				...options ?? {},
				validate: (finalized, tx) => {
					options?.validate?.(finalized, tx);
					for (const hook of extraHooks) hook(finalized, tx);
				}
			};
			try {
				const result = store.appendEvents(events, composed);
				realizer.settleAppend("committed");
				return result;
			} catch (e) {
				realizer.settleAppend("failed");
				throw e;
			}
		}
	};
}
//#endregion
//#region src/host/service/wiring/create.ts
/**
* WP-3.6 (RR-011 (d)) — `createHostWiring`: the host service dependency
* graph.
*
* ```text
* gate   (WP-8.5 / G8 S2: the WP-8.1 startup integrity checks — DB /
*   tree / git / consistency, ARCHITECTURE §10 — run BEFORE any service
*   is instantiated: unrecoverable ⇒ throw WIRING_INTEGRITY (the fiber
*   never reaches ACTIVE, TC-DSH-008); recoverable ⇒ loud + auto-disposed
*   by the step-13 reconciliations; the git boundary check is fired here
*   (async, never fatal) and settles loud on `wiring.integrity.git`)
*   → store (openDatabase — ONE research.sqlite, DSH_ADAPTER §9; the RR-013
*   connection guard rides on this connection)
*   → registry (frozen WP-2.2 schema load — unusable ⇒ startup fails)
*   → tree   (the .research/ 真源 load — any load error ⇒ startup fails)
*   → tables (run/DS second connection, WP-2.4)
*   → allocator (the store meta counter face, §1.1 规则 2)
*   → semantics (RR-011 (b): the store-level incremental fold + the
*     startup replay rebuild)
*   → realizer (RR-011 (a) / RR-010: the workstream.yaml flip + the
*     append-outcome compensation, wired through the realize-store seam)
*   → runbinding + sessionlink (the WP-2.6 half extended to full
*     instantiation — both services over the WRAPPED store)
*   → planfork store (PF/MA second connection)
*   → stale service (the production creation flow: real git W3/W11)
*   → flooding (intervention second connection + the §8 hooks, hung on
*     BOTH creation flows)
*   → tools (the WP-3.3 11-tool face, deps composed from the live
*     services — registered by the dsh-adapter, INV-PERM-5)
*   → startup reconciliation (lifecycle convergence → run-vs-history →
*     semantics rebuild; each loud, in this order)
* ```
*
* Every step throws a structured `HostWiringError` on failure (the caller
* — the dsh-adapter's `[Service.init]` — turns it into a fiber FAILED,
* TC-DSH-008) and unwinds the resources opened so far (a failed init
* leaks nothing). On success, `close()` is the SINGLE disposer for
* everything (idempotent; the dsh-adapter registers it with `ctx.effect`).
*
* No DSH imports (INV-PERM-5): this module is business code — the DSH
* half (home resolution, workspace registry, `defineTool` registration,
* `ctx.effect`) lives in `src/host/dsh-adapter/host/index.ts`.
*/
/** The `research.sqlite` file name (DSH_ADAPTER §9). */
const DB_FILE = "research.sqlite";
/**
* The fs-backed reader serving BOTH the declarative tree load
* (`ResearchFileReader`) and the registry/intervention/planfork schema
* loads (`HistorySchemaReader`) — the loader-pattern single reader.
*/
var FsReader = class {
	readDir(path) {
		if (!existsSync(path) || !statSync(path).isDirectory()) return null;
		return readdirSync(path, { withFileTypes: true }).map((e) => ({
			name: e.name,
			kind: e.isDirectory() ? "directory" : "file"
		}));
	}
	readFile(path) {
		if (!existsSync(path) || !statSync(path).isFile()) return null;
		return readFileSync(path, "utf8");
	}
};
/** A rejecting plan writer — the wiring only READS canonical plans. */
const REJECTING_WRITER = { writeAtomic(path) {
	throw new Error(`the host wiring is read-only for canonical plans (writeAtomic ${path})`);
} };
/**
* Instantiate the complete host service graph (module header).
*
* @throws {HostWiringError} on any step failure (structured code per
*  step) — resources opened so far are closed before the throw.
*/
function createHostWiring(options) {
	const logger = options.logger;
	const now = options.now ?? Date.now;
	const requireAbs = (value, name) => {
		if (typeof value !== "string" || value.length === 0 || !value.startsWith("/")) throw new HostWiringError("WIRING_INPUT", `${name} must be an absolute path (got ${JSON.stringify(value ?? null)})`);
		return value;
	};
	const repoRoot = requireAbs(options.repoRoot, "repoRoot");
	const schemaRoot = requireAbs(options.schemaRoot, "schemaRoot");
	const dataDir = requireAbs(options.dataDir, "dataDir");
	const researchDir = options.researchDir ?? ".research";
	if (typeof researchDir !== "string" || researchDir.length === 0 || researchDir.includes("/")) throw new HostWiringError("WIRING_INPUT", `researchDir must be a bare directory name (got ${JSON.stringify(researchDir)})`);
	if (!/^PRJ-\d+$/.test(options.projectId)) throw new HostWiringError("WIRING_INPUT", `projectId must be a well-formed PRJ-<n> id (got ${JSON.stringify(options.projectId)})`);
	const researchRoot = join(repoRoot, researchDir);
	if (!existsSync(researchRoot) || !statSync(researchRoot).isDirectory()) throw new HostWiringError("WIRING_INPUT", `${researchRoot} is not a directory — the workspace carries no ${researchDir} tree`);
	const reader = new FsReader();
	const workstreamList = [];
	const liveWorkstreams = /* @__PURE__ */ new Map();
	const liveTasks = /* @__PURE__ */ new Map();
	const milestoneIds = /* @__PURE__ */ new Set();
	const objectiveIds = /* @__PURE__ */ new Set();
	/** Opened second connections + the discovery disposer — closed by `close()`. */
	const disposers = [];
	const openSecondConnection = (label) => {
		let db;
		try {
			db = new DatabaseSync(join(dataDir, DB_FILE));
		} catch (cause) {
			throw new HostWiringError("WIRING_TABLES", `cannot open the ${label} second connection: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
		}
		disposers.push(() => {
			try {
				db.close();
			} catch {}
		});
		return db;
	};
	try {
		const gate = runStartupIntegrityGate({
			dbPath: join(dataDir, DB_FILE),
			repoRoot,
			researchRoot,
			schemaDir: join(schemaRoot, "declarative"),
			projectId: options.projectId,
			researchDir,
			reader,
			logger
		});
		const rawStore = openDatabase(join(dataDir, DB_FILE));
		disposers.push(() => {
			try {
				rawStore.close();
			} catch {}
		});
		const registry = loadHistoryEventRegistry(reader, join(schemaRoot, "history"));
		if (!registry.isUsable) throw new HostWiringError("WIRING_REGISTRY", `the frozen event registry is unusable — every append would be unvalidated (INV-HIST-4): ` + registry.loadErrors.map((e) => `[${e.code}] ${e.message}`).join("; "));
		const load = gate.treeLoad;
		if (load.errors.length > 0) throw new HostWiringError("WIRING_TREE", `the .research tree failed to load — refusing to serve a broken declarative 真源: ` + load.errors.map((e) => `[${e.code}] ${e.file || "<root>"}: ${e.message}`).join("; "));
		for (const topic of load.tree.topics) for (const ws of topic.workstreams) {
			const doc = ws.doc;
			if (doc === null) continue;
			liveWorkstreams.set(ws.id, {
				topicId: topic.id,
				lifecycle: doc.lifecycle
			});
			workstreamList.push(ws.id);
			for (const t of ws.tasks) {
				if (t.doc === null) continue;
				const ac = t.doc.acceptance_criteria;
				liveTasks.set(t.id, {
					workstreamId: ws.id,
					execution: "PLANNED",
					validation: ac.length > 0 ? "PENDING" : "NOT_REQUIRED",
					acceptanceCriteria: ac
				});
			}
			for (const g of ws.gates);
			for (const m of ws.milestones) milestoneIds.add(m.id);
		}
		for (const o of load.tree.objectives) objectiveIds.add(o.id);
		load.tree;
		const tables = openRunBindingTables(join(dataDir, DB_FILE));
		disposers.push(() => {
			try {
				tables.close();
			} catch {}
		});
		const allocator = new IdAllocator(rawStore.meta());
		const semantics = makeSemanticMaintainer({
			store: rawStore,
			projectId: options.projectId,
			logger
		});
		const realizer = new WorkstreamRealizer({
			researchRoot,
			workstreams: new Map([...liveWorkstreams.entries()].map(([id, s]) => [id, { topicId: s.topicId }])),
			logger
		});
		const flipSpy = (wsId) => {
			if (gate.readSurface === "readonly") throw new HostWiringError("WIRING_REALIZE", `the startup integrity gate set the surface READONLY (the .research tree is partially broken) — the workstream.yaml flip of ${wsId} is refused (ARCHITECTURE §10: a partially broken 真源 must not be committed or mutated)`);
			realizer.onWorkstreamRealized(wsId);
			const snapshot = liveWorkstreams.get(wsId);
			if (snapshot !== void 0 && snapshot.lifecycle === "PLANNED") liveWorkstreams.set(wsId, {
				topicId: snapshot.topicId,
				lifecycle: "REALIZED"
			});
		};
		const store = withRealizeCompensation(rawStore, realizer, { validateHooks: [semantics.validateHook] });
		const externalState = () => ({
			workstreams: liveWorkstreams,
			tasks: liveTasks
		});
		const workstreamsSource = (wsId) => liveWorkstreams.get(wsId) ?? null;
		const runBinding = new RunBindingService({
			store,
			tables,
			registry,
			allocator,
			projectId: options.projectId,
			workspaceRoots: options.workspaceRoots,
			externalState,
			now,
			onWorkstreamRealized: flipSpy
		});
		const sessionLink = new SessionLinkService({
			store,
			registry,
			adapter: options.adapter,
			ids: allocator,
			projectId: options.projectId,
			workstreams: workstreamsSource,
			now
		});
		const disposeDiscovery = runBinding.startDiscovery(options.adapter);
		disposers.push(disposeDiscovery);
		const planForks = new PlanForkStore({
			db: adaptDatabaseSync(openSecondConnection("planfork")),
			allocator,
			projectId: options.projectId,
			now
		});
		const pfSchemas = loadPlanForkSchemas(reader, join(schemaRoot, "operational"));
		if (!pfSchemas.isUsable) throw new HostWiringError("WIRING_PLANFORK", `the frozen plan-fork schemas are unusable — no PF record can be shape-checked: ` + pfSchemas.loadErrors.map((e) => `${e.path || "/"}: ${e.message}`).join("; "));
		const declarativeDir = join(schemaRoot, "declarative");
		const planProvider = { load(workstreamId) {
			const topics = reader.readDir(join(researchRoot, "topics"));
			if (topics === null) return absentView(workstreamId, "");
			for (const t of topics) {
				if (t.kind !== "directory") continue;
				const wsDirRel = `topics/${t.name}/workstreams/${workstreamId}`;
				if (reader.readDir(join(researchRoot, wsDirRel)) === null) continue;
				try {
					const view = new PlanStore({
						reader,
						writer: REJECTING_WRITER,
						researchRoot,
						schemaDir: declarativeDir,
						topicId: t.name,
						wsId: workstreamId
					}).loadPlan();
					const problem = view.errors.length > 0 ? view.errors[0].message : void 0;
					return {
						workstream_id: workstreamId,
						wsDir: wsDirRel,
						workstream_exists: true,
						present: view.present,
						ordered_items: view.items,
						consistent: view.errors.length === 0,
						...problem !== void 0 ? { problem } : {}
					};
				} catch (cause) {
					return absentView(workstreamId, wsDirRel, cause instanceof Error ? cause.message : String(cause));
				}
			}
			return absentView(workstreamId, "");
		} };
		const stale = new PlanForkStaleService({
			repoRoot,
			researchDir,
			store: planForks,
			planProvider
		});
		const ivDb = openSecondConnection("intervention");
		const ivSchemas = loadInterventionSchemas(reader, join(schemaRoot, "operational"));
		if (!ivSchemas.isUsable) throw new HostWiringError("WIRING_FLOODING", `the frozen attention schemas are unusable — no Intervention can be shape-checked: ` + ivSchemas.loadErrors.map((e) => `${e.path || "/"}: ${e.message}`).join("; "));
		const interventions = new InterventionStore({
			db: adaptDatabaseSync(ivDb),
			schemas: ivSchemas
		});
		const flooding = new FloodingService({
			store,
			registry,
			planForks,
			interventions,
			allocator,
			projectId: options.projectId,
			researchFileReader: reader,
			researchRoot,
			schemaDir: declarativeDir,
			externalState: () => ({ workstreams: liveWorkstreams }),
			now
		});
		const semanticKey = semanticStateKey(options.projectId);
		const readSemanticState = () => {
			const raw = readDerivedState(rawStore).get(semanticKey);
			return raw === void 0 ? initialSemanticState() : jsonToSemanticState(raw, semanticKey);
		};
		const inboxDb = openSecondConnection("inbox");
		const inboxSchemas = loadInboxSchemas(reader, join(schemaRoot, "operational"));
		if (!inboxSchemas.isUsable) throw new HostWiringError("WIRING_INBOX", `the frozen inbox schemas are unusable — no Inbox item can be shape-checked: ` + inboxSchemas.loadErrors.map((e) => `${e.path || "/"}: ${e.message}`).join("; "));
		const inboxDbFace = adaptDatabaseSync(inboxDb);
		const inboxStore = new InboxStore({
			db: inboxDbFace,
			schemas: inboxSchemas
		});
		const reporting = new ReportingService({
			db: inboxDbFace,
			allocator,
			projectId: options.projectId,
			now
		});
		const actions = new ActionsService({
			store: new ActionsStore({
				db: inboxDbFace,
				allocator,
				projectId: options.projectId,
				now
			}),
			reader,
			writer: REJECTING_WRITER,
			researchRoot,
			schemaDir: declarativeDir,
			allocator,
			projectId: options.projectId,
			db: inboxDbFace,
			runExists: { exists: (runId) => tables.getRun(runId) !== null },
			now
		});
		const interventionService = new InterventionService({
			store,
			registry,
			lifecycle: new InterventionLifecycleStore({
				db: inboxDbFace,
				interventions
			}),
			allocator,
			projectId: options.projectId,
			externalState: () => ({ workstreams: liveWorkstreams }),
			now
		});
		const inbox = new InboxService({
			store: inboxStore,
			allocator,
			projectId: options.projectId,
			now,
			conversionTargets: { execute(_kind, fields, item) {
				switch (fields.kind) {
					case "INTERVENTION": return {
						kind: "INTERVENTION",
						id: interventionService.createUserIntervention({
							title: fields.title,
							...fields.detail !== void 0 && fields.detail.length > 0 ? { detail: fields.detail } : {},
							...fields.workstreamIds !== void 0 && fields.workstreamIds.length > 0 ? { workstream_ids: fields.workstreamIds } : {},
							source_refs: [{
								kind: "INBOX_ITEM",
								id: item.id
							}]
						}, USER_ACTOR$1).intervention.id
					};
					case "NEXT_ACTION": return {
						kind: "NEXT_ACTION",
						id: actions.createNextAction({
							statement: fields.statement,
							...fields.rationale !== void 0 && fields.rationale.length > 0 ? { rationale: fields.rationale } : {},
							...fields.workstreamId !== void 0 && fields.workstreamId.length > 0 ? { workstreamId: fields.workstreamId } : {}
						}, USER_ACTOR$1).id
					};
					case "REPORTING_ITEM": return {
						kind: "REPORTING_ITEM",
						id: reporting.createReportingItem({
							audience: fields.audience,
							statement: fields.statement,
							...fields.materialRefs !== void 0 ? { materialRefs: fields.materialRefs } : {},
							...fields.occasionRef !== void 0 ? { occasionRef: fields.occasionRef } : {}
						}).id
					};
					case "INTERACTION": return {
						kind: "INTERACTION",
						id: reporting.registerInteraction({
							kind: fields.interactionKind,
							title: fields.title,
							occurredAt: fields.occurredAt,
							...fields.participants !== void 0 ? { participants: fields.participants } : {},
							...fields.notes !== void 0 ? { notes: fields.notes } : {},
							...fields.relatedWorkstreams !== void 0 ? { relatedWorkstreams: fields.relatedWorkstreams } : {}
						}).record.id
					};
					case "CLAIM":
					case "FACT":
					case "TASK": throw new Error(`the ${fields.kind} conversion target is not wired (V1 boundary — the production executor is the closed set over the delivered WP-5 services)`);
				}
			} },
			mechanicalInterventionCreator: (params) => {
				const res = interventionService.createMechanicalIntervention({
					title: params.title,
					...params.detail !== void 0 ? { detail: params.detail } : {},
					...params.workstreamIds !== void 0 ? { workstream_ids: params.workstreamIds } : {},
					...params.sourceRefs !== void 0 ? { source_refs: params.sourceRefs } : {},
					trigger: "AUDIT_HIGH_IMPACT_DISCREPANCY"
				}, { kind: "PLUGIN" });
				return {
					id: res.intervention.id,
					title: res.intervention.title
				};
			},
			managementActionRecorder: (record) => {
				inboxDbFace.run(SQL_INSERT_MANAGEMENT_ACTION, ...managementActionToParams(record));
			}
		});
		const auditRefresh = createAuditRefreshRunner({
			repoRoot,
			researchRoot,
			reader,
			declarativeDir,
			meta: rawStore.meta(),
			readSemanticState,
			inbox,
			now,
			logger
		});
		let investigator;
		try {
			investigator = new InvestigatorLauncher({ launcher: options.launcherAdapter });
		} catch (cause) {
			throw new HostWiringError("WIRING_INVESTIGATOR", `the investigator launcher port is unusable: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
		}
		const analysisDb = openSecondConnection("analysis");
		const analysisSchemas = loadAnalysisSchemas(reader, join(schemaRoot, "operational"));
		if (!analysisSchemas.isUsable) throw new HostWiringError("WIRING_ANALYSIS", `the frozen analysis schemas are unusable — no AnalysisRecord can be shape-checked: ` + analysisSchemas.loadErrors.map((e) => `${e.path || "/"}: ${e.message}`).join("; "));
		const analysisStore = new AnalysisStore({
			db: adaptDatabaseSync(analysisDb),
			schemas: analysisSchemas
		});
		const analysisService = new AnalysisRecordService({
			store: analysisStore,
			allocator,
			projectId: options.projectId,
			now
		});
		const analysisTransient = new AnalysisTransientReader({
			pointerOf: (sessionId) => sessionLink.pointerOf(sessionId),
			listSessions: () => options.adapter.listSessions(),
			runs: (filter) => [...tables.listRuns({ dshSessionId: filter.dshSessionId })].map((row) => ({
				id: row.id,
				workstreamId: row.workstream_id,
				status: row.status,
				startedAt: row.started_at,
				endedAt: row.ended_at ?? null
			}))
		});
		logger?.info("investigator", "the production investigator face is wired (launcher port bound + analysis_record face + all-read transient reader — WP-7.4 / G7 S1)");
		const contentHashCapturer = makeContentHashCapturer(researchRoot);
		const loadPolicy = () => {
			const result = loadPlanForkPolicy(reader, researchRoot, declarativeDir);
			if (result.policy === null) throw new PlanForkError({
				code: "PF_POLICY_INVALID",
				message: `the agent plan-fork policy failed to load: ${result.errors.map((e) => e.message).join("; ")}`
			});
			return result.policy;
		};
		const formalRunLookup = { get(runId) {
			const row = tables.getRun(runId);
			return row === null ? null : {
				id: row.id,
				workstream_id: row.workstream_id,
				...row.task_id !== void 0 ? { task_id: row.task_id } : {}
			};
		} };
		const triggerRefResolver = makeTriggerRefResolver({
			readSemanticState,
			milestoneIds,
			objectiveIds
		});
		const tools = createResearchTools({
			planForkCreate: (params) => {
				const view = planProvider.load(params.workstreamId);
				const ctx = {
					policy: loadPolicy(),
					plan: view,
					schemas: pfSchemas,
					baseCapturer: contentHashCapturer,
					triggerRefResolver,
					formalRunLookup,
					now
				};
				const record = planForks.createPlanFork(params, ctx);
				const check = flooding.onPlanForkCreated(record);
				if (check.error !== void 0) logger?.warn("flooding", `onPlanForkCreated after tool creation of ${record.id}: [${check.error.code}] ${check.error.message}`);
				return record;
			},
			recordCheckpoint: (runId, params, actor) => runBinding.recordCheckpoint(runId, params, actor)
		});
		const lifecycleReport = reconcileWorkstreamLifecycles({
			store: rawStore,
			researchRoot,
			workstreams: workstreamList.map((id) => {
				return {
					workstreamId: id,
					topicId: liveWorkstreams.get(id)?.topicId ?? ""
				};
			}),
			logger
		});
		for (const finding of lifecycleReport.findings) {
			const snapshot = liveWorkstreams.get(finding.workstreamId);
			if (snapshot === void 0) continue;
			if (finding.action === "file-flipped-to-realized") liveWorkstreams.set(finding.workstreamId, {
				topicId: snapshot.topicId,
				lifecycle: "REALIZED"
			});
			else if (finding.action === "file-rolled-back-to-planned") liveWorkstreams.set(finding.workstreamId, {
				topicId: snapshot.topicId,
				lifecycle: "PLANNED"
			});
		}
		const startup = {
			lifecycle: lifecycleReport,
			runs: reconcileRunsAgainstHistory({
				store: rawStore,
				tables,
				workstreams: workstreamList,
				policy: options.reconcileRuns ?? "rebuild",
				logger
			}),
			semantics: semantics.rebuild({ workstreams: workstreamList })
		};
		const wiring = {
			repoRoot,
			researchRoot,
			researchDir,
			projectId: options.projectId,
			dataDir,
			store,
			registry,
			tables,
			allocator,
			runBinding,
			sessionLink,
			planForks,
			stale,
			flooding,
			interventions,
			semantics,
			tools,
			schemaRoot,
			sessionAdapter: options.adapter,
			inbox,
			auditRefresh,
			investigator,
			analysisStore,
			analysisService,
			analysisTransient,
			startup,
			integrity: gate,
			externalState,
			createPlanFork: async (params) => {
				const view = planProvider.load(params.workstreamId);
				const ctx = {
					policy: loadPolicy(),
					plan: view,
					schemas: pfSchemas,
					baseCapturer: contentHashCapturer,
					triggerRefResolver,
					formalRunLookup,
					now
				};
				const record = await stale.createPlanFork(params, ctx);
				const check = flooding.onPlanForkCreated(record);
				if (check.error !== void 0) logger?.warn("flooding", `onPlanForkCreated after creation of ${record.id}: [${check.error.code}] ${check.error.message}`);
				return record;
			},
			onPlanLoaded: (workstreamId) => {
				const check = flooding.onPlanLoaded(workstreamId);
				if (check.error !== void 0) logger?.warn("flooding", `onPlanLoaded(${workstreamId}): [${check.error.code}] ${check.error.message}`);
			},
			close() {
				for (const dispose of disposers.splice(0).reverse()) try {
					dispose();
				} catch {}
			}
		};
		logger?.info("wiring", `host wiring ready (project ${options.projectId}; ${workstreamList.length} workstreams; ${liveTasks.size} tasks)`);
		return wiring;
	} catch (e) {
		for (const dispose of disposers.splice(0).reverse()) try {
			dispose();
		} catch {}
		if (e instanceof HostWiringError) throw e;
		throw new HostWiringError("WIRING_SERVICE", `host wiring failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
	}
}
function absentView(workstreamId, wsDir, problem) {
	return {
		workstream_id: workstreamId,
		wsDir,
		workstream_exists: false,
		present: false,
		ordered_items: [],
		consistent: false,
		...problem !== void 0 ? { problem } : {}
	};
}
function makeTriggerRefResolver(input) {
	const exists = (ref) => {
		switch (ref.kind) {
			case "CLAIM": return input.readSemanticState().claims.has(ref.id);
			case "FACT": return input.readSemanticState().facts.has(ref.id);
			case "ARTIFACT": return input.readSemanticState().artifacts.has(ref.id);
			case "MILESTONE": return input.milestoneIds.has(ref.id);
			case "OBJECTIVE": return input.objectiveIds.has(ref.id);
		}
	};
	return { exists };
}
//#endregion
//#region e2e/factory/factory.ts
/**
* WP-4.6 — TC-E2E data factory (the e2e test-data seed).
*
* Runs on Node (bundled to `e2e/factory-dist/factory.cjs` by the tsdown
* `factory` entry — see tsdown.config.ts) BEFORE the smoke server starts
* (scripts/e2e-run.sh invokes it): it writes the canonical `.research/`
* tree into the smoke workspace (the repo root), git-commits it, opens the
* REAL host wiring over it (`createHostWiring` — the production service
* graph, fake session adapter, isolated data dir), and seeds the control
* plane through the PRODUCTION mutation paths:
*
*   runs      R-1 (WS-1/T-1, DSH session pointer, FINISHED) and
*             R-2 (WS-1/T-2, no session pointer, RUNNING) via
*             `runBinding.registerRun/finishRun`;
*   events    the semantic trail (TASK_EXECUTION_CHANGED T-1
*             PLANNED→ACTIVE→EXECUTED, T-2 PLANNED→ACTIVE; CLAIM_RECORDED
*             C-1/C-2; ARTIFACT_REGISTERED A-1; RELATION_ADDED REL-1
*             SUPPORTED_BY, REL-2 PRODUCED_BY) via the wrapped
*             `store.appendEvents` with the production validate hook —
*             the same path the agent tools use;
*   flooding  6 × `createPlanFork` (createdByRun R-1, trigger M-1) —
*             the §8 flooding hook fires after the 6th OPEN PF and
*             creates the AUTO_FLOODING intervention (TC-E2E-009);
*   contract  the merge contract TE-2 is committed, then the WORKING COPY
*             is drifted (uncommitted) — TC-E2E-010 restores it from Git;
*   big plan  WS-4 (long-range validation matrix) carries a 106-item
*             canonical plan — the TC-PERF-006 viewport-virtualization
*             fixture (WP-4.7, G4 S2; its own workstream so the WS-1
*             seed order asserted 逐位 by TC-E2E-002/003/007 is untouched).
*
* Idempotency: the script refuses to run over an existing `research.sqlite`
* (a re-run means the seed would double-append — the operator must reset
* the smoke home first). The `.research` tree is rewritten from scratch.
*
* Usage: node e2e/factory-dist/factory.cjs --repo <ws> --home <dsh-home> \
*          --schema-root <WR/schema>
*/
function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === void 0) continue;
		const next = argv[i + 1];
		if (a === "--repo") {
			out.repo = next;
			i++;
		} else if (a === "--home") {
			out.home = next;
			i++;
		} else if (a === "--schema-root") {
			out.schemaRoot = next;
			i++;
		} else throw new Error(`unknown arg: ${a} (usage: --repo <ws> --home <dsh-home> --schema-root <schema>)`);
	}
	const abs = (v, name) => {
		if (v === void 0 || !isAbsolute(v)) throw new Error(`${name} must be an absolute path (got ${JSON.stringify(v)})`);
		return resolve(v);
	};
	return {
		repo: abs(out.repo, "--repo"),
		home: abs(out.home, "--home"),
		schemaRoot: abs(out.schemaRoot, "--schema-root")
	};
}
const PROJECT_YAML = `id: PRJ-1
title: 机器人视觉定位系统
description: 多传感器融合的亚像素级视觉定位
importance: 4
attention_mode: FOCUS
current_objective_refs: [OBJ-1]
created_at: 2026-08-21T09:00:00Z
`;
const WORKSPACE_YAML = `workspace:
  root: .                # 相对 Git repo root
  git_required: true     # INV-GIT-1
audit:
  strict_tracked:        # 计划书 §22.1 第一层
    paths: []            # 关键代码 / Task deliverables / merge 相关文件 glob
  discovery_zones:       # 第二层：发现未注册 Artifact / workspace change
    - path: results/
      artifact_types: [DATASET, FIGURE]   # 可选：该 zone 期望的 ArtifactType（发现分类提示）
    - path: docs/
  ignored:               # 第三层
    - cache/
    - build/
    - tmp/
`;
const OBJECTIVES_YAML = `objectives:
  - id: OBJ-1
    scope: TOPIC
    topic_id: TPC-1
    statement: 完成亚像素级视觉定位原型
    success_criteria:
      - 重投影误差 <2px
    status: ACTIVE
    priority: P1
    linked_refs:
      - { kind: WORKSTREAM, id: WS-1 }
      - { kind: GATE, id: G-1 }
    created_at: 2026-08-21T09:00:00Z
`;
const TOPIC_YAML = `id: TPC-1
project_id: PRJ-1
title: 标定与配准
description: 机器人视觉定位的标定与配准研究主题（亚像素级精度目标）
objective_refs: [OBJ-1]
created_at: 2026-08-21T09:05:00Z
`;
const TOPOLOGY_YAML = `topology:
  topic_id: TPC-1
  edges:
    - id: TE-1
      topic_id: TPC-1
      operation: FORK
      lifecycle: PLANNED
      inputs: [WS-1]
      outputs: [WS-2]
      note: 分支出独立标定管线
    - id: TE-2
      topic_id: TPC-1
      operation: MERGE
      lifecycle: PLANNED
      inputs: [WS-1, WS-2]
      outputs: [WS-3]
`;
const WS1_YAML = `id: WS-1
topic_id: TPC-1
title: 主标定管线
created_at: 2026-08-21T09:10:00Z
`;
const WS2_YAML = `id: WS-2
topic_id: TPC-1
title: 独立标定管线
origin_topology_edge_ref: TE-1
created_at: 2026-08-21T09:12:00Z
`;
const WS3_YAML = `id: WS-3
topic_id: TPC-1
title: 合并后管线
origin_topology_edge_ref: TE-2
created_at: 2026-08-21T09:14:00Z
`;
const PLAN_YAML = `workstream: WS-1
ordered_items: [G-1, T-1, T-2, T-3, M-1, T-4, G-2]
`;
const G1_YAML = `id: G-1
workstream_id: WS-1
title: 数据就绪评审
criteria: 标定数据集完整、标注规范且可复现
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:35:00Z
`;
const T1_YAML = `id: T-1
workstream_id: WS-1
title: 标定数据采集方案对比
goal: 确定 EURA 相机阵列的标定数据采集方案，误差目标 <2px 重投影误差
deliverables:
  - docs/calibration-plan.md
acceptance_criteria:
  - 三种候选方案均有实测重投影误差数据
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:30:00Z
`;
const T2_YAML = `id: T-2
workstream_id: WS-1
title: 候选方案 A 实现
goal: 实现基于棋盘格的标定采集与求解
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:36:00Z
`;
const T3_YAML = `id: T-3
workstream_id: WS-1
title: 候选方案 B 实现
goal: 实现基于 ARUKO 标记的标定采集与求解
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:37:00Z
`;
const T4_YAML = `id: T-4
workstream_id: WS-1
title: 三方案误差对比
goal: 在统一测试集上对比三方案重投影误差
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:38:00Z
`;
const M1_YAML = `id: M-1
workstream_id: WS-1
title: 标定管线 v1 冻结
statement: 重投影误差 <2px 的标定管线代码冻结并进入合并评审
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:39:00Z
`;
const G2_YAML = `id: G-2
workstream_id: WS-1
title: 合并评审
criteria: 三方案对比数据完整且 M-1 已达成
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:40:00Z
`;
const CONTRACT_MD = `# Merge Contract TE-2

- 接口: 标定结果统一输出 CalibrationResult (JSON schema v1)
- 坐标系: 相机系，右手系
- benchmark protocol: 统一 5 组标定板位姿
- 期望产物: docs/merge-contract-verification.md
`;
const POLICY_YAML = `enabled: true
anchors:
  allow_boundary_sentinels: true   # 允许 __START__ / __END__
  required_item_types: []          # 空 = 任意 item 可作 anchor；可设 [GATE]
flooding:
  threshold: 5                     # 每 workstream unresolved OPEN PF 数上限
triggers:
  require_at_least_one: true
  allowed_kinds: [CLAIM, FACT, ARTIFACT, MILESTONE, OBJECTIVE]
`;
const WS4_BASE = "topics/TPC-1/workstreams/WS-4";
const WS4_CREATED_AT = "2026-08-21T09:16:00Z";
/** WS-4's 100 task items (T-11..T-110 — no collision with WS-1's T-1..T-4). */
const WS4_TASKS = Array.from({ length: 100 }, (_, i) => `T-${i + 11}`);
const WS4_GATES = [
	"G-11",
	"G-12",
	"G-13",
	"G-14"
];
const WS4_MILESTONES = ["M-11", "M-12"];
/** The canonical order (1 + 50 + 1 + 30 + 1 + 20 + 1 + 1 + 1 = 106 items). */
const WS4_ORDER = [
	"G-11",
	...WS4_TASKS.slice(0, 50),
	"M-11",
	...WS4_TASKS.slice(50, 80),
	"G-12",
	...WS4_TASKS.slice(80),
	"M-12",
	"G-13",
	"G-14"
];
/** One WS-4 item YAML (per kind — the frozen declarative schemas). */
function ws4Item(kind, id) {
	const common = `id: ${id}\nworkstream_id: WS-4\n`;
	if (kind === "gates") return `${common}title: 长程验证关卡 ${id}\ncriteria: 长程验证矩阵阶段关口（e2e 大计划样例）\ncreated_by: { kind: USER, label: researcher }\ncreated_at: ${WS4_CREATED_AT}\n`;
	if (kind === "milestones") return `${common}title: 长程验证里程碑 ${id}\nstatement: 长程验证矩阵阶段里程碑达成\ncreated_by: { kind: USER, label: researcher }\ncreated_at: ${WS4_CREATED_AT}\n`;
	return `${common}title: 长程验证任务 ${id}\ngoal: 长程验证矩阵条目（e2e 大计划性能样例）\ncreated_by: { kind: USER, label: researcher }\ncreated_at: ${WS4_CREATED_AT}\n`;
}
/** The WS-4 tree slice (workstream.yaml + plan.yaml + the 106 item files). */
function buildWs4Tree() {
	const out = {
		[`${WS4_BASE}/workstream.yaml`]: `id: WS-4\ntopic_id: TPC-1\ntitle: 长程验证矩阵（大计划）\ncreated_at: ${WS4_CREATED_AT}\n`,
		[`${WS4_BASE}/plan.yaml`]: `workstream: WS-4\nordered_items: [${WS4_ORDER.join(", ")}]\n`
	};
	for (const id of WS4_TASKS) out[`${WS4_BASE}/items/tasks/${id}.yaml`] = ws4Item("tasks", id);
	for (const id of WS4_GATES) out[`${WS4_BASE}/items/gates/${id}.yaml`] = ws4Item("gates", id);
	for (const id of WS4_MILESTONES) out[`${WS4_BASE}/items/milestones/${id}.yaml`] = ws4Item("milestones", id);
	return out;
}
const TREE = {
	"schema-version": "1\n",
	"project.yaml": PROJECT_YAML,
	"workspace.yaml": WORKSPACE_YAML,
	"objectives.yaml": OBJECTIVES_YAML,
	"topics/TPC-1/topic.yaml": TOPIC_YAML,
	"topics/TPC-1/topology.yaml": TOPOLOGY_YAML,
	"topics/TPC-1/workstreams/WS-1/workstream.yaml": WS1_YAML,
	"topics/TPC-1/workstreams/WS-1/plan.yaml": PLAN_YAML,
	"topics/TPC-1/workstreams/WS-1/items/gates/G-1.yaml": G1_YAML,
	"topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml": T1_YAML,
	"topics/TPC-1/workstreams/WS-1/items/tasks/T-2.yaml": T2_YAML,
	"topics/TPC-1/workstreams/WS-1/items/tasks/T-3.yaml": T3_YAML,
	"topics/TPC-1/workstreams/WS-1/items/tasks/T-4.yaml": T4_YAML,
	"topics/TPC-1/workstreams/WS-1/items/milestones/M-1.yaml": M1_YAML,
	"topics/TPC-1/workstreams/WS-1/items/gates/G-2.yaml": G2_YAML,
	"topics/TPC-1/workstreams/WS-2/workstream.yaml": WS2_YAML,
	"topics/TPC-1/workstreams/WS-3/workstream.yaml": WS3_YAML,
	"merges/TE-2/contract.md": CONTRACT_MD,
	"policies/agent-plan-fork.yaml": POLICY_YAML,
	...buildWs4Tree()
};
function writeTree(researchRoot, patch = {}) {
	rmSync(researchRoot, {
		recursive: true,
		force: true
	});
	for (const [rel, content] of Object.entries({
		...TREE,
		...patch
	})) {
		const p = join(researchRoot, rel);
		mkdirSync(join(p, ".."), { recursive: true });
		writeFileSync(p, content);
	}
}
function git(args, cwd) {
	execFileSync("git", args, {
		cwd,
		stdio: "pipe"
	});
}
/** A git call whose NON-ZERO exit is an expected outcome (the merge
*  conflict scenario — the conflict IS the fixture). Returns the exit
*  code; throws only on spawn failure. */
function gitMaybe(args, cwd) {
	const res = spawnSync("git", args, {
		cwd,
		stdio: "pipe"
	});
	if (res.error !== void 0) throw res.error;
	return res.status ?? -1;
}
function ensureGitRepo(repo) {
	if (!existsSync(join(repo, ".git"))) git([
		"init",
		"-b",
		"main"
	], repo);
	git([
		"config",
		"user.email",
		"e2e-factory@research.local"
	], repo);
	git([
		"config",
		"user.name",
		"e2e factory"
	], repo);
}
/** The fake session adapter port (WP-0.4): no live DSH sessions here —
*  the seed is pointer-only (INV-DB-2); the workspace's registered
*  session ids are read from workspace.json for the RUN_STARTED pointer. */
function makeFakeAdapter() {
	return {
		listSessions: () => [],
		onSessionEvent: () => () => void 0,
		observeSessionLifecycle: () => () => void 0,
		querySession: async () => {
			throw new Error("factory adapter: querySession is not used by the seed");
		}
	};
}
/**
* The WP-7.4 factory fake for the investigator launcher port (the seed
* never launches an investigator — the e2e one-click spec does, through
* the REAL host half). The wiring requires the port (no guessed launch
* capability), so the factory supplies a failing loud fake: a call here
* means the seed reached code that must not exist.
*/
function makeFakeLauncherAdapter() {
	return { launchInvestigator: async () => {
		throw new Error("factory seed: no investigator launch in the seed phase");
	} };
}
/** Read the first registered session id of the workspace (the RUN_STARTED
*  pointer of R-1 — 「在宿主会话列表中打开」 then targets a REAL session). */
function firstRegisteredSession(home, repo) {
	const p = join(home, "storages", "workspace.json");
	if (!existsSync(p)) return null;
	const raw = JSON.parse(readFileSync(p, "utf8"));
	for (const ws of Object.values(raw.tables?.workspaces ?? {})) {
		if (ws.path !== repo) continue;
		const ids = ws.sessionIds ?? [];
		if (ids.length > 0) return ids[0] ?? null;
	}
	return null;
}
function scenarioAssert(cond, msg) {
	if (!cond) throw new Error(msg);
}
/** The file reader for the integrity checks (the wiring's own FsReader
*  is module-private — an equivalent minimal reader for the scenario
*  path; the PRODUCTION wiring's gate uses the real one). */
function makeScenarioReader() {
	return {
		readDir: (p) => existsSync(p) && statSync(p).isDirectory() ? readdirSync(p, { withFileTypes: true }).map((e) => ({
			name: e.name,
			kind: e.isDirectory() ? "directory" : "file"
		})) : null,
		readFile: (p) => existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : null
	};
}
/** A fresh temp workspace (repo + data dir) for one scenario. */
function makeScenarioWorkspace(tag) {
	const root = mkdtempSync(join(tmpdir(), `wp85-sc-${tag}-`));
	mkdirSync(root, { recursive: true });
	return {
		root,
		researchRoot: join(root, ".research"),
		dataDir: join(root, "data")
	};
}
/**
* Scenario A — degraded + auto-disposition: a REALIZED file with EMPTY
* History (the RR-010 crash-window residue — `file-leads`). The gate
* must DETECT it loud, startup must PROCEED (no throw), and the step-13
* lifecycle reconciliation must AUTO-CONVERGE the file back to PLANNED.
*/
async function scenarioDegradedAutoDispose(schemaRoot) {
	const { root, researchRoot, dataDir } = makeScenarioWorkspace("deg");
	const facts = {};
	try {
		writeTree(researchRoot, { "topics/TPC-1/workstreams/WS-1/workstream.yaml": `${WS1_YAML}lifecycle: REALIZED\n` });
		ensureGitRepo(root);
		git(["add", ".research"], root);
		git([
			"commit",
			"-m",
			"seed: .research tree (integrity scenario: file-leads residue)"
		], root);
		mkdirSync(dataDir, { recursive: true });
		const logger = makeCollectingLogger();
		const reader = makeScenarioReader();
		const report = await runStartupIntegrityChecks({
			dbPath: join(dataDir, "research.sqlite"),
			repoRoot: root,
			researchRoot,
			schemaDir: join(schemaRoot, "declarative"),
			projectId: "PRJ-1",
			reader,
			logger
		});
		facts.orchestratorOutcome = report.outcome;
		facts.orchestratorFileLeads = report.consistency.findings.filter((f) => f.kind === "file-leads").map((f) => f.workstreamId);
		scenarioAssert(report.outcome === "degraded", `orchestrator: expected degraded, got ${report.outcome}`);
		scenarioAssert(facts.orchestratorFileLeads.length === 1 && facts.orchestratorFileLeads[0] === "WS-1", "orchestrator: the WS-1 residue must be classed file-leads");
		const wiring = createHostWiring({
			repoRoot: root,
			schemaRoot,
			projectId: "PRJ-1",
			dataDir,
			adapter: makeFakeAdapter(),
			launcherAdapter: makeFakeLauncherAdapter(),
			workspaceRoots: [root],
			logger
		});
		try {
			facts.gateOutcome = wiring.integrity.outcome;
			facts.gateReadSurface = wiring.integrity.readSurface;
			facts.gateFindings = wiring.integrity.consistency.findings.map((f) => `${f.kind}:${f.workstreamId ?? ""}`);
			facts.gateLoudWarns = logger.entries.filter((e) => e.level === "warn" && e.step === "startup-integrity").length;
			scenarioAssert(wiring.integrity.outcome === "degraded", `gate: expected degraded, got ${wiring.integrity.outcome}`);
			scenarioAssert(facts.gateFindings.includes("file-leads:WS-1"), `gate: must class the same file-leads:WS-1 finding as the orchestrator (got ${JSON.stringify(facts.gateFindings)})`);
			scenarioAssert(facts.gateLoudWarns > 0, "gate: the recoverable finding must be LOUD (warn entries), never silent");
			facts.convergence = wiring.startup.lifecycle.findings.map((f) => `${f.workstreamId}:${f.action}`);
			scenarioAssert(wiring.startup.lifecycle.findings.some((f) => f.workstreamId === "WS-1" && f.action === "file-rolled-back-to-planned"), "the startup reconciliation must AUTO-CONVERGE the file-leads residue back to PLANNED");
			const ws1 = readFileSync(join(researchRoot, "topics/TPC-1/workstreams/WS-1/workstream.yaml"), "utf8");
			facts.fileLifecycleAfterInit = /lifecycle:\s*(\w+)/.exec(ws1)?.[1] ?? "(absent = PLANNED)";
			scenarioAssert(!/lifecycle:\s*REALIZED/.test(ws1), "the file on disk must no longer say REALIZED after auto-convergence");
			facts.gitStatus = (await wiring.integrity.git).status;
			facts.orchestratorGitStatus = report.git.status;
			scenarioAssert(facts.gitStatus === facts.orchestratorGitStatus, "gate git half and orchestrator git check must agree");
		} finally {
			wiring.close();
		}
		return {
			scenario: "degraded-auto-disposition",
			ok: true,
			facts
		};
	} finally {
		rmSync(root, {
			recursive: true,
			force: true
		});
	}
}
/**
* Scenario B — unrecoverable operational DB (TC-DB-002 form): the gate
* must REFUSE startup with a structured WIRING_INTEGRITY error BEFORE
* any service is instantiated (fail-loud; the fiber never reaches
* ACTIVE), and the orchestrator's report must be fatal +
* `assertStartup`-throwing (the TC-DSH-008 channel).
*/
async function scenarioFatalDb(schemaRoot) {
	const { root, researchRoot, dataDir } = makeScenarioWorkspace("fatdb");
	const facts = {};
	try {
		writeTree(researchRoot);
		ensureGitRepo(root);
		git(["add", ".research"], root);
		git([
			"commit",
			"-m",
			"seed: .research tree (integrity scenario: fatal db)"
		], root);
		mkdirSync(dataDir, { recursive: true });
		writeFileSync(join(dataDir, "research.sqlite"), "THIS IS NOT A SQLITE DATABASE — corrupted on purpose (WP-8.5 integrity scenario: the TC-DB-002 garbage-bytes form)\n");
		const logger = makeCollectingLogger();
		const report = await runStartupIntegrityChecks({
			dbPath: join(dataDir, "research.sqlite"),
			repoRoot: root,
			researchRoot,
			schemaDir: join(schemaRoot, "declarative"),
			projectId: "PRJ-1",
			reader: makeScenarioReader(),
			logger
		});
		facts.orchestratorOutcome = report.outcome;
		facts.dbCode = report.db.code;
		let fatalThrew = false;
		try {
			assertStartup(report);
		} catch (e) {
			fatalThrew = e instanceof HardeningFatalError;
		}
		scenarioAssert(report.outcome === "fatal", `orchestrator: expected fatal, got ${report.outcome}`);
		scenarioAssert(report.db.code === "STORE_CORRUPT", `orchestrator db code: expected STORE_CORRUPT, got ${String(report.db.code)}`);
		scenarioAssert(fatalThrew, "assertStartup must throw HardeningFatalError on a fatal report (the TC-DSH-008 channel)");
		let gateError = null;
		try {
			createHostWiring({
				repoRoot: root,
				schemaRoot,
				projectId: "PRJ-1",
				dataDir,
				adapter: makeFakeAdapter(),
				launcherAdapter: makeFakeLauncherAdapter(),
				workspaceRoots: [root],
				logger
			});
		} catch (e) {
			gateError = e;
		}
		scenarioAssert(gateError !== null, "gate: a corrupted operational DB must REFUSE the wiring (no service graph returned)");
		facts.gateCode = gateError.code;
		scenarioAssert(gateError.code === "WIRING_INTEGRITY", `gate: expected WIRING_INTEGRITY, got ${String(gateError.code)}`);
		scenarioAssert(/corrupt/i.test(gateError.message ?? ""), "gate: the error must NAME the corruption (明确报错, 绝不静默)");
		facts.gateErrorHead = (gateError.message ?? "").split("\n")[0];
		scenarioAssert(logger.entries.some((e) => e.level === "error" && e.step === "startup-integrity"), "gate: the fatal finding must be LOUD (error entries)");
		return {
			scenario: "unrecoverable-db-fail-loud",
			ok: true,
			facts
		};
	} finally {
		rmSync(root, {
			recursive: true,
			force: true
		});
	}
}
/**
* Scenario C — project-scope mismatch (the dual-真源 invariant): the
* tree declares PRJ-9 but the wiring (and its data dir) are keyed PRJ-1
* — UNRECOVERABLE (the plugin must not guess which side to rewrite).
* The gate refuses before instantiation; the orchestrator reports fatal.
*/
async function scenarioProjectScopeMismatch(schemaRoot) {
	const { root, researchRoot, dataDir } = makeScenarioWorkspace("scope");
	const facts = {};
	try {
		writeTree(researchRoot, { "project.yaml": PROJECT_YAML.replace("id: PRJ-1", "id: PRJ-9") });
		ensureGitRepo(root);
		git(["add", ".research"], root);
		git([
			"commit",
			"-m",
			"seed: .research tree (integrity scenario: scope mismatch)"
		], root);
		mkdirSync(dataDir, { recursive: true });
		const logger = makeCollectingLogger();
		const report = await runStartupIntegrityChecks({
			dbPath: join(dataDir, "research.sqlite"),
			repoRoot: root,
			researchRoot,
			schemaDir: join(schemaRoot, "declarative"),
			projectId: "PRJ-1",
			reader: makeScenarioReader(),
			logger
		});
		facts.orchestratorOutcome = report.outcome;
		facts.scopeFinding = report.consistency.findings.filter((f) => f.kind === "project-id-mismatch").map((f) => f.message);
		scenarioAssert(report.outcome === "fatal", `orchestrator: expected fatal, got ${report.outcome}`);
		scenarioAssert(report.consistency.findings.some((f) => f.kind === "project-id-mismatch"), "orchestrator: the project-scope mismatch must be a consistency finding");
		let fatalThrew = false;
		try {
			assertStartup(report);
		} catch (e) {
			fatalThrew = e instanceof HardeningFatalError;
		}
		scenarioAssert(fatalThrew, "assertStartup must throw HardeningFatalError on the scope-mismatch report");
		let gateError = null;
		try {
			createHostWiring({
				repoRoot: root,
				schemaRoot,
				projectId: "PRJ-1",
				dataDir,
				adapter: makeFakeAdapter(),
				launcherAdapter: makeFakeLauncherAdapter(),
				workspaceRoots: [root],
				logger
			});
		} catch (e) {
			gateError = e;
		}
		scenarioAssert(gateError !== null, "gate: a project-scope mismatch must REFUSE the wiring (no guessing which side to rewrite)");
		facts.gateCode = gateError.code;
		scenarioAssert(gateError.code === "WIRING_INTEGRITY", `gate: expected WIRING_INTEGRITY, got ${String(gateError.code)}`);
		scenarioAssert((gateError.message ?? "").includes("PRJ-9") && (gateError.message ?? "").includes("PRJ-1"), "gate: the error must name BOTH scopes (the tree id and the registered id)");
		facts.gateErrorHead = (gateError.message ?? "").split("\n")[0];
		return {
			scenario: "unrecoverable-project-scope",
			ok: true,
			facts
		};
	} finally {
		rmSync(root, {
			recursive: true,
			force: true
		});
	}
}
/**
* Scenario D — the git boundary (check 3, the async half): a REAL
* mid-merge conflict on a NON-research file (the .research tree stays
* intact — a conflicted declarative file would fail the V1 strict
* WIRING_TREE step, which is the designed behavior and covered by
* scenario A's classification). The wiring must COMPLETE (git is never
* fatal), the async git half must class the conflict (checkpoint
* EXPLICITLY refused — INV-GIT-4), and the orchestrator must agree
* (degraded via the git half).
*/
async function scenarioGitConflict(schemaRoot) {
	const { root, researchRoot, dataDir } = makeScenarioWorkspace("gitcf");
	const facts = {};
	try {
		writeTree(researchRoot);
		const notesDir = join(root, "notes");
		mkdirSync(notesDir, { recursive: true });
		writeFileSync(join(notesDir, "diverge.txt"), "baseline line\n");
		ensureGitRepo(root);
		git([
			"add",
			".research",
			"notes"
		], root);
		git([
			"commit",
			"-m",
			"seed: baseline (integrity scenario: git conflict)"
		], root);
		mkdirSync(dataDir, { recursive: true });
		git([
			"checkout",
			"-b",
			"diverge-a"
		], root);
		writeFileSync(join(notesDir, "diverge.txt"), "baseline line\nappend-a\n");
		git(["add", "notes"], root);
		git([
			"commit",
			"-m",
			"diverge a"
		], root);
		git(["checkout", "main"], root);
		writeFileSync(join(notesDir, "diverge.txt"), "baseline line\nappend-main\n");
		git(["add", "notes"], root);
		git([
			"commit",
			"-m",
			"diverge main"
		], root);
		const mergeExit = gitMaybe(["merge", "diverge-a"], root);
		facts.mergeExitCode = mergeExit;
		scenarioAssert(mergeExit !== 0 && existsSync(join(root, ".git", "MERGE_HEAD")), "the fixture repo must be mid-merge (MERGE_HEAD present)");
		const logger = makeCollectingLogger();
		const wiring = createHostWiring({
			repoRoot: root,
			schemaRoot,
			projectId: "PRJ-1",
			dataDir,
			adapter: makeFakeAdapter(),
			launcherAdapter: makeFakeLauncherAdapter(),
			workspaceRoots: [root],
			logger
		});
		try {
			const gitResult = await wiring.integrity.git;
			facts.gitStatus = gitResult.status;
			facts.gitReason = gitResult.reason;
			facts.checkpointAllowed = gitResult.checkpointAllowed;
			facts.gitLoudWarns = logger.entries.filter((e) => e.level === "warn" && e.step === "startup-integrity" && e.message.includes("git boundary")).length;
			scenarioAssert(gitResult.status === "recoverable" && gitResult.reason === "conflict-in-progress", `gate git: expected recoverable/conflict-in-progress, got ${gitResult.status}/${String(gitResult.reason)}`);
			scenarioAssert(gitResult.checkpointAllowed === false, "gate git: the checkpoint must be EXPLICITLY refused mid-conflict (INV-GIT-4)");
			scenarioAssert(facts.gitLoudWarns > 0, "gate git: the conflict classification must be LOUD (warn)");
			const report = await runStartupIntegrityChecks({
				dbPath: join(dataDir, "research.sqlite"),
				repoRoot: root,
				researchRoot,
				schemaDir: join(schemaRoot, "declarative"),
				projectId: "PRJ-1",
				reader: makeScenarioReader(),
				logger
			});
			facts.orchestratorOutcome = report.outcome;
			facts.orchestratorGitReason = report.git.reason;
			scenarioAssert(report.outcome === "degraded", `orchestrator: expected degraded (the git half), got ${report.outcome}`);
			scenarioAssert(facts.orchestratorGitReason === "conflict-in-progress", "orchestrator git half must class the same conflict");
		} finally {
			wiring.close();
		}
		return {
			scenario: "git-conflict-checkpoint-refused",
			ok: true,
			facts
		};
	} finally {
		rmSync(root, {
			recursive: true,
			force: true
		});
	}
}
async function runIntegrityScenarios(schemaRoot) {
	const scenarios = [
		scenarioDegradedAutoDispose,
		scenarioFatalDb,
		scenarioProjectScopeMismatch,
		scenarioGitConflict
	];
	const out = [];
	for (const run of scenarios) out.push(await run(schemaRoot));
	return out;
}
async function main() {
	const { repo, home, schemaRoot } = parseArgs(process.argv.slice(2));
	const researchRoot = join(repo, ".research");
	const dataDir = join(home, "research-control", "PRJ-1");
	if (existsSync(join(dataDir, "research.sqlite"))) throw new Error(`${join(dataDir, "research.sqlite")} already exists — the factory seeds exactly once (reset the smoke home data dir to re-run)`);
	writeTree(researchRoot);
	ensureGitRepo(repo);
	git(["add", ".research"], repo);
	git([
		"commit",
		"-m",
		"seed: .research tree (e2e factory)"
	], repo);
	mkdirSync(dataDir, { recursive: true });
	const wiring = createHostWiring({
		repoRoot: repo,
		schemaRoot,
		projectId: "PRJ-1",
		dataDir,
		adapter: makeFakeAdapter(),
		launcherAdapter: makeFakeLauncherAdapter(),
		workspaceRoots: [repo]
	});
	const summary = {
		researchRoot,
		dataDir,
		runs: [],
		events: [],
		planForks: [],
		floodingIntervention: null,
		contractPath: ".research/merges/TE-2/contract.md",
		drifted: false,
		bigPlan: {
			workstreamId: "WS-4",
			itemCount: WS4_ORDER.length,
			order: WS4_ORDER
		}
	};
	try {
		const sessionForR1 = firstRegisteredSession(home, repo);
		const claims = /* @__PURE__ */ new Map();
		const artifacts = /* @__PURE__ */ new Map();
		const relations = /* @__PURE__ */ new Map();
		const taskExec = /* @__PURE__ */ new Map();
		const validate = makeValidateHook(wiring.registry, () => {
			const base = buildObjectContext(wiring.tables, wiring.externalState());
			const tasks = new Map(base.tasks);
			for (const [id, execution] of taskExec) {
				const t = tasks.get(id);
				if (t !== void 0) tasks.set(id, {
					...t,
					execution
				});
			}
			return {
				...base,
				tasks,
				claims: new Map(claims),
				artifacts: new Map(artifacts),
				relations: new Map(relations)
			};
		});
		const trackSemantic = (eventType, payload) => {
			if (eventType === "CLAIM_RECORDED") claims.set(String(payload.claim_id), {
				workstreamId: "WS-1",
				status: "ACTIVE"
			});
			else if (eventType === "CLAIM_RETRACTED") {
				const c = claims.get(String(payload.claim_id));
				if (c !== void 0) claims.set(String(payload.claim_id), {
					...c,
					status: "RETRACTED"
				});
			} else if (eventType === "ARTIFACT_REGISTERED") artifacts.set(String(payload.artifact_id), {
				workstreamId: "WS-1",
				status: "REGISTERED"
			});
			else if (eventType === "ARTIFACT_MARKED_MISSING") {
				const a = artifacts.get(String(payload.artifact_id));
				if (a !== void 0) artifacts.set(String(payload.artifact_id), {
					...a,
					status: "MISSING"
				});
			} else if (eventType === "RELATION_ADDED") {
				const src = payload.source;
				const tgt = payload.target;
				relations.set(String(payload.relation_id), {
					status: "ACTIVE",
					source: {
						kind: String(src.kind),
						id: String(src.id)
					},
					relationType: String(payload.relation_type),
					target: {
						kind: String(tgt.kind),
						id: String(tgt.id)
					}
				});
			} else if (eventType === "TASK_EXECUTION_CHANGED") taskExec.set(String(payload.task_id), String(payload.to));
		};
		const r1 = wiring.runBinding.registerRun({
			workstreamId: "WS-1",
			taskId: "T-1",
			...sessionForR1 !== null ? { dshSessionId: sessionForR1 } : {},
			intent: "调研标定数据采集方案"
		}, {
			kind: "USER",
			...sessionForR1 !== null ? { session_id: sessionForR1 } : {}
		});
		summary.runs.push(r1.run.id);
		const mkEvent = (actorKind, eventType, occurredAt, payload, runId) => {
			const reservation = wiring.allocator.reserve("HISTORY_EVENT", "PRJ-1");
			return {
				event: {
					eventId: reservation.id,
					ownerWorkstreamId: "WS-1",
					eventType,
					schemaVersion: 1,
					occurredAt,
					actor: {
						kind: actorKind,
						run_id: runId
					},
					source: null,
					payload
				},
				reservation
			};
		};
		const r1Batch = [
			mkEvent("USER", "TASK_EXECUTION_CHANGED", 175500001e4, {
				task_id: "T-1",
				from: "PLANNED",
				to: "ACTIVE",
				reason: "R-1 开始执行"
			}, r1.run.id),
			mkEvent("AGENT", "CLAIM_RECORDED", 175500002e4, {
				claim_id: "C-1",
				statement: "棋盘格方案的实测重投影误差最低",
				created_by_run: r1.run.id
			}, r1.run.id),
			mkEvent("AGENT", "ARTIFACT_REGISTERED", 175500003e4, {
				artifact_id: "A-1",
				type: "REPORT",
				title: "标定方案对比报告",
				uri: "file:///docs/calibration-plan.md",
				created_by_run: r1.run.id,
				related_task: "T-1"
			}, r1.run.id),
			mkEvent("AGENT", "RELATION_ADDED", 175500004e4, {
				relation_id: "REL-1",
				source: {
					kind: "CLAIM",
					id: "C-1"
				},
				relation_type: "SUPPORTED_BY",
				target: {
					kind: "ARTIFACT",
					id: "A-1"
				}
			}, r1.run.id),
			mkEvent("AGENT", "RELATION_ADDED", 175500005e4, {
				relation_id: "REL-2",
				source: {
					kind: "ARTIFACT",
					id: "A-1"
				},
				relation_type: "PRODUCED_BY",
				target: {
					kind: "RUN",
					id: r1.run.id
				}
			}, r1.run.id),
			mkEvent("USER", "TASK_EXECUTION_CHANGED", 175500006e4, {
				task_id: "T-1",
				from: "ACTIVE",
				to: "EXECUTED",
				reason: "R-1 完成"
			}, r1.run.id)
		];
		for (const part of r1Batch) {
			const appended = wiring.store.appendEvents([part.event], { validate }).events[0];
			summary.events.push(`${appended.eventId}:${appended.eventType}`);
			trackSemantic(appended.eventType, appended.payload);
			wiring.allocator.commit(part.reservation);
		}
		wiring.runBinding.finishRun(r1.run.id, { outcomeSummary: "方案对比完成" });
		const r2 = wiring.runBinding.registerRun({
			workstreamId: "WS-1",
			taskId: "T-2",
			intent: "实现候选方案 A"
		}, { kind: "USER" });
		summary.runs.push(r2.run.id);
		const r2Batch = [mkEvent("USER", "TASK_EXECUTION_CHANGED", 175500007e4, {
			task_id: "T-2",
			from: "PLANNED",
			to: "ACTIVE",
			reason: "R-2 开始执行"
		}, r2.run.id), mkEvent("AGENT", "CLAIM_RECORDED", 175500008e4, {
			claim_id: "C-2",
			statement: "ARUKO 标记在低光环境下更稳定",
			created_by_run: r2.run.id
		}, r2.run.id)];
		for (const part of r2Batch) {
			const appended = wiring.store.appendEvents([part.event], { validate }).events[0];
			summary.events.push(`${appended.eventId}:${appended.eventType}`);
			trackSemantic(appended.eventType, appended.payload);
			wiring.allocator.commit(part.reservation);
		}
		for (let i = 1; i <= 6; i++) {
			const pf = await wiring.createPlanFork({
				workstreamId: "WS-1",
				forkAnchor: "T-1",
				mergeAnchor: "T-2",
				proposedItems: [{
					action: "NEW",
					kind: "TASK",
					spec: {
						title: `PF-${i} 提案任务`,
						goal: `第 ${i} 条备选验证路径（洪泛种子）`
					}
				}],
				triggerRefs: [{
					kind: "MILESTONE",
					id: "M-1"
				}],
				reason: `e2e 洪泛种子 PF-${i}：备选验证路径`,
				necessity: `需要第 ${i} 条备选路径以验证未决 PlanFork 的展示与裁决`,
				createdByRun: r1.run.id
			});
			summary.planForks.push(pf.id);
		}
		summary.floodingIntervention = wiring.interventions.listInterventions({ origin: "AUTO_FLOODING" }).find((iv) => iv.origin === "AUTO_FLOODING")?.id ?? null;
		const contract = join(researchRoot, "merges", "TE-2", "contract.md");
		writeFileSync(contract, `${readFileSync(contract, "utf8")}<!-- e2e drift: working copy modified (TC-E2E-010 restore target) -->\n`);
		summary.drifted = true;
	} finally {
		wiring.close();
	}
	summary.integrity = await runIntegrityScenarios(schemaRoot);
	console.log(JSON.stringify(summary, null, 2));
}
main().catch((err) => {
	console.error(`e2e factory failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
	process.exit(1);
});
//#endregion
export {};
