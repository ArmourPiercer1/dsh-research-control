import { chmodSync, existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseAllDocuments, stringify } from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
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
const DDL$1 = `
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
	return DDL$1;
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
const CORRUPT$2 = (what, detail) => {
	throw new Error(`actions row corruption at ${what}: ${detail}`);
};
function decodeJson$2(value, what) {
	if (typeof value !== "string") return CORRUPT$2(what, `expected JSON string, got ${typeof value}`);
	try {
		return JSON.parse(value);
	} catch (cause) {
		return CORRUPT$2(what, `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
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
	if (typeof status !== "string" || !NA_STATUSES$1.includes(status)) return CORRUPT$2("next_action.status", `unknown status ${JSON.stringify(String(status))}`);
	for (const name of [
		"id",
		"statement",
		"created_by"
	]) if (typeof row[name] !== "string") return CORRUPT$2(`next_action.${name}`, `expected string, got ${typeof row[name]}`);
	if (typeof row.created_at !== "number") return CORRUPT$2("next_action.created_at", `expected number, got ${typeof row.created_at}`);
	const affectedTaskId = row.promoted_to_task_id;
	if (affectedTaskId !== null && typeof affectedTaskId !== "string") return CORRUPT$2("next_action.promoted_to_task_id", `expected string or null, got ${typeof affectedTaskId}`);
	return {
		id: row.id,
		statement: row.statement,
		status,
		created_by: decodeJson$2(row.created_by, "next_action.created_by"),
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
	if (typeof status !== "string" || !BLK_STATUSES$1.includes(status)) return CORRUPT$2("blocker.status", `unknown status ${JSON.stringify(String(status))}`);
	for (const name of [
		"id",
		"statement",
		"affects",
		"source"
	]) if (typeof row[name] !== "string") return CORRUPT$2(`blocker.${name}`, `expected string, got ${typeof row[name]}`);
	if (typeof row.created_at !== "number") return CORRUPT$2("blocker.created_at", `expected number, got ${typeof row.created_at}`);
	const affects = decodeJson$2(row.affects, "blocker.affects");
	for (const ref of affects) if (ref === null || typeof ref !== "object" || typeof ref.kind !== "string" || typeof ref.id !== "string" || !AFFECTS_KINDS.includes(ref.kind)) return CORRUPT$2("blocker.affects", `element must be a {kind ∈ WORKSTREAM|TASK|RUN, id} typedRef (got ${JSON.stringify(ref)})`);
	const references = row.references;
	let referencesValue;
	if (references != null) {
		const decoded = decodeJson$2(references, "blocker.references");
		if (!Array.isArray(decoded)) return CORRUPT$2("blocker.references", `expected a JSON array of strings, got ${typeof decoded}`);
		for (const item of decoded) if (typeof item !== "string") return CORRUPT$2("blocker.references", `element must be a string (got ${typeof item})`);
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
function assertUserActor$2(actor, operation, code = "NA_ACTOR") {
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
		assertUserActor$2(actor, `promoteNextAction(${id})`);
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
		assertUserActor$2(actor, `dismissNextAction(${id})`);
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
		assertUserActor$2(actor, "createBlocker", "BLK_ACTOR");
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
		assertUserActor$2(actor, `clearBlocker(${id})`, "BLK_ACTOR");
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
* WP-1.1 — minimal path join for the pure domain kernel.
*
* The domain layer must not import Node builtins (ARCHITECTURE §2.2 rule 1:
* pure logic, no I/O — `node:path` is avoided so this module stays
* platform-free and the kernel has zero runtime deps outside the schema
* tooling). All `.research/` layout paths are POSIX-style by contract (§14);
* the injected reader is responsible for mapping onto the host FS.
*
* Host ROOTS (`schemaDir`, `researchRoot`) arrive in platform-native shape
* — the DSH host hands the plugin native workspace paths, and on Windows
* that is a drive path like `D:\Projects\…` — so `pjoin` treats BOTH `/`
* and `\` as separators and preserves the absolute prefix of the FIRST
* segment:
*
*   - POSIX root:   `/…`
*   - Drive root:   `C:\…` or `C:/…`
*   - UNC root:     `\\server\share\…` or `//server/share/…`
*
* (Same recognition as the frozen `ABSOLUTE_PATH_PATTERN` twins in
* `host/domain/registry/schemas.ts` / `shared/rpc-contracts.ts`.) The
* OUTPUT is always normalized to forward slashes — legal on BOTH platforms
* (the Windows file APIs accept `/`), byte-identical to the old behavior
* for pure POSIX input — and the injected reader maps it onto the host FS.
* `..` resolution that would climb past an absolute root is clamped (POSIX
* root, drive root, or UNC root alike).
*/
/**
* The absolute prefix the FIRST segment may carry (see the module doc):
* POSIX `/`, a Windows drive (`C:` + separator, or a bare `C:`), or UNC
* (`\\…` / `//…`). Drive-relative paths (`C:foo`) are NOT roots and pass
* through as ordinary parts. Returns `[prefix, body]`.
*/
function splitRoot(segment) {
	if (segment.startsWith("\\\\") || segment.startsWith("//")) return ["//", segment.slice(2)];
	if (segment.startsWith("/")) return ["/", segment.slice(1)];
	const drive = /^([A-Za-z]:)([\\/])(.*)$/.exec(segment);
	if (drive) return [drive[1], drive[3]];
	if (/^[A-Za-z]:$/.test(segment)) return [segment, ""];
	return ["", segment];
}
/**
* Join path segments, resolving `.` and `..`. Both `/` and `\` act as
* separators (host roots arrive in platform-native shape); the absolute
* prefix of the FIRST segment (POSIX `/`, drive `C:`, UNC `//`) is
* preserved; later absolute segments are joined like `path.join`.
* Output is normalized to forward slashes.
*/
function pjoin(...segments) {
	if (segments.length === 0) return "";
	const [prefix, firstBody] = splitRoot(segments[0]);
	const absolute = prefix !== "";
	const out = [];
	const pushParts = (raw) => {
		for (const part of raw.split(/[\\/]/)) {
			if (part === "" || part === ".") continue;
			if (part === "..") {
				if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
				else if (!absolute) out.push("..");
				continue;
			}
			out.push(part);
		}
	};
	pushParts(firstBody);
	for (let i = 1; i < segments.length; i++) pushParts(segments[i]);
	if (out.length === 0) return prefix.endsWith(":") ? `${prefix}/` : prefix;
	return prefix.endsWith(":") ? `${prefix}/${out.join("/")}` : `${prefix}${out.join("/")}`;
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
//#region src/host/domain/planfork/types.ts
/** The 4 frozen actor kinds (actorRef.kind). */
const ACTOR_KINDS = [
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
		checkRecordShape: (record) => runCheck$1(recordValidator, record),
		checkProposedItem: (item) => runCheck$1(proposedItemValidator, item),
		checkNewItemSpec: (kind, spec) => runCheck$1(specValidatorFor(kind), spec),
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
		policy: normalizePolicy(validated),
		defaulted: false,
		errors: []
	};
}
/** Field-for-field normalization (validator-accepted shape → frozen policy type). */
function normalizePolicy(doc) {
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
const KIND_TO_DIR$1 = {
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
		paths.push(`${normalized}/items/${KIND_TO_DIR$1[parsed.kind]}/${id}.yaml`);
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
const CORRUPT$1 = (what, detail) => {
	throw new Error(`planfork row corruption at ${what}: ${detail}`);
};
function decodeJson$1(value, what) {
	if (typeof value !== "string") return CORRUPT$1(what, `expected JSON string, got ${typeof value}`);
	try {
		return JSON.parse(value);
	} catch (cause) {
		return CORRUPT$1(what, `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
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
	if (typeof status !== "string" || !isPfStatus(status)) return CORRUPT$1("plan_fork.status", `unknown status ${JSON.stringify(String(status))}`);
	for (const name of [
		"id",
		"workstream_id",
		"fork_anchor",
		"merge_anchor",
		"reason",
		"necessity",
		"created_by_run"
	]) if (typeof row[name] !== "string") return CORRUPT$1(`plan_fork.${name}`, `expected string, got ${typeof row[name]}`);
	if (typeof row.created_at !== "number") return CORRUPT$1("plan_fork.created_at", `expected number, got ${typeof row.created_at}`);
	return {
		id: row.id,
		workstream_id: row.workstream_id,
		base_plan_objects: decodeJson$1(row.base_plan_objects, "plan_fork.base_plan_objects"),
		fork_anchor: row.fork_anchor,
		merge_anchor: row.merge_anchor,
		proposed_items: decodeJson$1(row.proposed_items, "plan_fork.proposed_items"),
		trigger_refs: decodeJson$1(row.trigger_refs, "plan_fork.trigger_refs"),
		reason: row.reason,
		necessity: row.necessity,
		created_by_run: row.created_by_run,
		created_at: row.created_at,
		status,
		...row.base_git_commit != null ? { base_git_commit: String(row.base_git_commit) } : {},
		...row.selected_at != null ? { selected_at: row.selected_at } : {},
		...row.selected_by != null ? { selected_by: decodeJson$1(row.selected_by, "plan_fork.selected_by") } : {},
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
	if (typeof row.id !== "string") return CORRUPT$1("management_action.id", `expected string, got ${typeof row.id}`);
	if (typeof row.action_kind !== "string") return CORRUPT$1("management_action.action_kind", `expected string, got ${typeof row.action_kind}`);
	if (typeof row.occurred_at !== "number") return CORRUPT$1("management_action.occurred_at", `expected number, got ${typeof row.occurred_at}`);
	return {
		id: row.id,
		action_kind: row.action_kind,
		actor: decodeJson$1(row.actor, "management_action.actor"),
		subject_refs: decodeJson$1(row.subject_refs, "management_action.subject_refs"),
		occurred_at: row.occurred_at,
		...row.git_commit_oid != null ? { git_commit_oid: String(row.git_commit_oid) } : {},
		...row.git_blob_oids != null ? { git_blob_oids: decodeJson$1(row.git_blob_oids, "management_action.git_blob_oids") } : {},
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
		if (actor === null || typeof actor !== "object" || typeof actor.kind !== "string" || !ACTOR_KINDS.includes(actor.kind)) throw new PlanForkError({
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
		assertUserActor$2(actor, "saveObjectives", "OBJ_ACTOR");
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
		assertUserActor$2(actor, `setObjectiveStatus(${objectiveId})`, "OBJ_ACTOR");
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
const KIND_TO_DIR = {
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
/**
* Type guard for `PlanStoreError` (service layer / tests).
*/
function isPlanStoreError(error) {
	return error instanceof PlanStoreError;
}
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
function errMsg$2(cause) {
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
				message: `read failed: ${errMsg$2(cause)}`
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
		return `${this.wsPath()}/items/${KIND_TO_DIR[kind]}/${id}.yaml`;
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
					message: `read failed: ${errMsg$2(cause)}`
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
				message: `read failed: ${errMsg$2(cause)}`
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
				message: `field "${key}" is immutable in updateItem — id is frozen once assigned (DOMAIN_SCHEMA §1.1 规则 1; file name = id); workstream_id is path-bound to ${JSON.stringify(`${this.wsPath()}/items/${KIND_TO_DIR[kind]}`)}`
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
				message: `read failed: ${errMsg$2(cause)}`
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
				message: `YAML parse failed: ${errMsg$2(cause)}`
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
				message: `YAML parse failed: ${errMsg$2(cause)}`
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
			message: `id ${JSON.stringify(id)} is not a well-formed research id (<PREFIX>-<positive integer>, DOMAIN_SCHEMA §1.1); expected a ${expected} id for items/${KIND_TO_DIR[kind]}/`
		});
		if (parsed.kind !== expected) throw new PlanStoreError({
			code: "TYPE_MISMATCH",
			file,
			path: "/id",
			message: `id ${JSON.stringify(id)} is a ${parsed.kind} id, not a ${expected} id (type mismatch for items/${KIND_TO_DIR[kind]}/, DOMAIN_SCHEMA §1.1/§4.4)`
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
				message: `write failed: ${errMsg$2(cause)}`
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
		assertUserActor$2(actor, `promoteNextAction(${id})`);
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
		assertUserActor$2(actor, `dismissNextAction(${id})`);
		return this.store.dismissNextAction(id, actor);
	}
	/**
	* Create one ACTIVE Blocker（§9.4; `affects` 引用存在性按 §16.3 写时
	* 校验: WS/T 经声明式树, RUN 经 run 表面 — 「写入新引用时失败 = 拒绝」）。
	*/
	createBlocker(params, actor) {
		assertUserActor$2(actor, "createBlocker", "BLK_ACTOR");
		this.assertAffectsExist(params.affects, "createBlocker");
		return this.store.createBlocker(params, actor);
	}
	/**
	* CLEAR（§13 终态; 用户 only; 复发 = 新 Blocker 行）。
	*/
	clearBlocker(id, actor) {
		assertUserActor$2(actor, `clearBlocker(${id})`, "BLK_ACTOR");
		return this.store.clearBlocker(id, actor);
	}
	listNextActions(filter = {}) {
		return this.store.listNextActions(filter);
	}
	listBlockers(filter = {}) {
		return this.store.listBlockers(filter);
	}
	/**
	* UI-4 (ADJ-5): the WS-local Blocker view — a MECHANICAL projection
	* over `affects` (the frozen row has no workstream column — the link
	* IS the affects ref set): a blocker is local to `workstreamId` when
	* any affects ref hits the WS itself or one of the given member ids
	* (the WS's tasks + runs; the caller assembles the set from its tree
	* + run-table faces — the service's `runExists` face cannot enumerate).
	* Pure over the store's full `listBlockers` read (no filter push-down —
	* the `affects` match is the projection; the set is small by §9.4).
	*/
	listBlockersForWorkstream(workstreamId, memberIds) {
		return this.store.listBlockers().filter((blocker) => blocker.affects.some((ref) => ref.id === workstreamId || memberIds.has(ref.id)));
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
		throw new StoreOpenError(`openDatabase: cannot stat ${abs}: ${errMsg$1(e)}`, { cause: e });
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
			throw new StoreOpenError(`openDatabase: cannot chmod ${abs} to 0o600: ${errMsg$1(e)}`, { cause: e });
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
				const kind = assertNonEmptyString$1(objectKind, "objectKind");
				const id = assertNonEmptyString$1(objectId, "objectId");
				const row = getStmt.get(kind, id);
				if (row === void 0) return null;
				return safeParse(String(row.state), `derived_state[${kind}:${id}].state`);
			},
			setDerivedState(objectKind, objectId, state) {
				const kind = assertNonEmptyString$1(objectKind, "objectKind");
				const id = assertNonEmptyString$1(objectId, "objectId");
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
		const ws = assertNonEmptyString$1(ownerWorkstreamId, "ownerWorkstreamId");
		assertSeq(seq, "seq");
		const row = dbConn.prepare("SELECT * FROM history_event WHERE owner_workstream_id = ? AND event_seq = ?").get(ws, seq);
		return row === void 0 ? null : dbRowToRecord(row);
	}
	function listRangeImpl(ownerWorkstreamId, fromSeq, toSeq) {
		const dbConn = assertOpen("listRange");
		const ws = assertNonEmptyString$1(ownerWorkstreamId, "ownerWorkstreamId");
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
	const eventId = assertNonEmptyString$1(e.eventId, `${what}.eventId`);
	const ownerWorkstreamId = assertNonEmptyString$1(e.ownerWorkstreamId, `${what}.ownerWorkstreamId`);
	const eventType = assertNonEmptyString$1(e.eventType, `${what}.eventType`);
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
	for (const ws of realize.workstreamIds) assertNonEmptyString$1(ws, "options.realize.workstreamIds entry");
	if (typeof realize.apply !== "function") throw new StoreInputError("appendEvents: options.realize.apply must be a function");
	return realize;
}
function normalizeDerivedState(patches) {
	if (patches === void 0) return [];
	if (!Array.isArray(patches)) throw new StoreInputError("appendEvents: options.derivedState must be an array");
	for (const [i, p] of patches.entries()) {
		if (typeof p !== "object" || p === null) throw new StoreInputError(`appendEvents: options.derivedState[${i}] is not an object`);
		assertNonEmptyString$1(p.objectKind, `options.derivedState[${i}].objectKind`);
		assertNonEmptyString$1(p.objectId, `options.derivedState[${i}].objectId`);
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
		throw new StoreOpenError(`openDatabase: cannot create directory ${dir}: ${errMsg$1(e)}`, { cause: e });
	}
	for (const m of missing) try {
		chmodSync(m, 448);
	} catch (e) {
		throw new StoreOpenError(`openDatabase: cannot set owner-only mode 0o700 on ${m}: ${errMsg$1(e)}`, { cause: e });
	}
}
/** Driver error from `new DatabaseSync(path)` → structured. */
function classifyOpenFailure(abs, e) {
	const msg = errMsg$1(e);
	if (/not a database|malformed|file is not a database/i.test(msg)) return new StoreCorruptError(`openDatabase: ${abs} is not a usable SQLite database (corrupt or non-DB file): ${msg}`, { cause: e });
	return new StoreOpenError(`openDatabase: cannot open ${abs}: ${msg}`, { cause: e });
}
/** `PRAGMA quick_check` — a damaged file fails here (TC-DB-002). */
function checkIntegrity(db, abs) {
	let rows;
	try {
		rows = db.prepare("PRAGMA quick_check").all();
	} catch (e) {
		throw new StoreCorruptError(`openDatabase: ${abs} is corrupted or unreadable: ${errMsg$1(e)}`, { cause: e });
	}
	const problems = rows.map((r) => String(r.quick_check ?? "")).filter((s) => s.toLowerCase() !== "ok");
	if (problems.length > 0) throw new StoreCorruptError(`openDatabase: ${abs} failed quick_check: ${problems.join("; ")}`);
}
function readUserVersion(db, abs) {
	let row;
	try {
		row = db.prepare("PRAGMA user_version").get();
	} catch (e) {
		throw new StoreCorruptError(`openDatabase: ${abs} is corrupted (cannot read user_version): ${errMsg$1(e)}`, { cause: e });
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
		throw new StoreCorruptError(`openDatabase: ${abs} is corrupted (cannot read sqlite_master): ${errMsg$1(e)}`, { cause: e });
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
		throw new StoreCorruptError(`openDatabase: ${abs} is corrupted (cannot read the history_event structure): ${errMsg$1(e)}`);
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
function errMsg$1(e) {
	return e instanceof Error ? e.message : String(e);
}
function assertNonEmptyString$1(value, what) {
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
		throw new StoreInputError(`${what} is not JSON-serializable: ${errMsg$1(e)}`, { cause: e });
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
	const msg = errMsg$1(e);
	if (/UNIQUE constraint failed/i.test(msg)) return new StoreConflictError(`${context}: uniqueness violation: ${msg}`, { cause: e });
	if (/not a database|database disk image is malformed/i.test(msg)) return new StoreCorruptError(`${context}: corrupt or unreadable SQLite file: ${msg}`, { cause: e });
	return new StoreSqlError(`${context}: ${msg}`, { cause: e });
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
/**
* Minimal path join with `.`/`..` resolution for the two-file layout
* (kernel stays platform-free, cf. WP-1.1 `pjoin`). Separator-aware for
* BOTH `/` and `\` with the same absolute-prefix recognition (POSIX `/`,
* Windows drive `C:`, UNC `//`) and forward-slash output normalization —
* the host hands native roots (a Windows `C:\…`), and the injected reader
* maps the normalized output onto the host FS (node fs accepts `/`).
*/
function joinPath$1(base, ...segments) {
	let prefix = "";
	let firstBody = base;
	if (base.startsWith("\\\\") || base.startsWith("//")) {
		prefix = "//";
		firstBody = base.slice(2);
	} else if (base.startsWith("/")) {
		prefix = "/";
		firstBody = base.slice(1);
	} else {
		const drive = /^([A-Za-z]:)([\\/])(.*)$/.exec(base);
		if (drive) {
			prefix = drive[1];
			firstBody = drive[3];
		} else if (/^[A-Za-z]:$/.test(base)) {
			prefix = base;
			firstBody = "";
		}
	}
	const absolute = prefix !== "";
	const out = [];
	const pushParts = (raw) => {
		for (const part of raw.split(/[\\/]/)) {
			if (part === "" || part === ".") continue;
			if (part === "..") {
				if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
				else if (!absolute) out.push("..");
				continue;
			}
			out.push(part);
		}
	};
	pushParts(firstBody);
	for (const segment of segments) pushParts(segment);
	if (out.length === 0) return prefix.endsWith(":") ? `${prefix}/` : prefix;
	return prefix.endsWith(":") ? `${prefix}/${out.join("/")}` : `${prefix}${out.join("/")}`;
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
				message: `schema file read failed: ${errMsg(cause)}`
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
				message: `schema file is not valid JSON: ${errMsg(cause)}`
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
			message: `common.schema.json rejected by validator engine: ${errMsg(cause)}`
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
			message: `derived events schema rejected by validator engine: ${errMsg(cause)}`
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
				message: `per-event validator compile failed for ${branch.name}: ${errMsg(cause)}`
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
function errMsg(cause) {
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
function legalTargets(machine, from) {
	return LEGAL_TRANSITIONS[machine][from] ?? [];
}
/** True iff `from -> to` appears in the §13 table for `machine` (INV-TASK-1). */
function isLegalTransition(machine, from, to) {
	return legalTargets(machine, from).includes(to);
}
//#endregion
//#region src/host/history/registry/relations.ts
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
/** The frozen §8 组合表, one row per relation type. */
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
/** True iff `source.kind → target.kind` is a listed combination for `relationType`. */
function isLegalRelationCombination(relationType, sourceKind, targetKind) {
	const row = RELATION_COMBINATION_TABLE[relationType];
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
		const legal = legalTargets(machine, from);
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
			if (!isLegalRelationCombination(p.relation_type, p.source.kind, p.target.kind)) push("CROSS_FIELD", "/payload/relation_type", `${p.relation_type} from ${p.source.kind} to ${p.target.kind} is not in the frozen combination table (DOMAIN_SCHEMA §8, INV-REL-1/2: TARGET 始终是 SOURCE 的前提/来源/输入/证据/上位目标)`);
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
//#region src/host/service/runbinding/types.ts
/** The default user actor for GUI operations (matrix column U). */
const USER_ACTOR$1 = {
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
function makeValidateHook$2(registry, buildContext) {
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
	const doc = readJson(pjoin(schemaDir, "attention.schema.json"));
	if (doc === null || typeof doc.$id !== "string") {
		errors.push({
			path: pjoin(schemaDir, "attention.schema.json"),
			message: "attention.schema.json is missing or has no $id"
		});
		return unavailable(schemaDir, errors);
	}
	try {
		ajv.addSchema(doc, doc.$id);
	} catch (cause) {
		errors.push({
			path: pjoin(schemaDir, "attention.schema.json"),
			message: `attention.schema.json rejected: ${cause instanceof Error ? cause.message : String(cause)}`
		});
		return unavailable(schemaDir, errors);
	}
	const recordValidator = ajv.getSchema(`${doc.$id}#/$defs/Intervention`);
	if (recordValidator === void 0) {
		errors.push({
			path: pjoin(schemaDir, "attention.schema.json"),
			message: "schema compile failed for $defs/Intervention"
		});
		return unavailable(schemaDir, errors);
	}
	return {
		schemaDir,
		isUsable: true,
		loadErrors: [],
		checkInterventionShape: (record) => runCheck(recordValidator, record)
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
`;
/** Full DDL (idempotent — re-applied on every store open, 同 WP-3.1 先例). */
function interventionDdl() {
	return DDL;
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
const CORRUPT = (what, detail) => {
	throw new Error(`flooding row corruption at ${what}: ${detail}`);
};
function decodeJson(value, what) {
	if (typeof value !== "string") return CORRUPT(what, `expected JSON string, got ${typeof value}`);
	try {
		return JSON.parse(value);
	} catch (cause) {
		return CORRUPT(what, `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
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
	if (typeof status !== "string" || !IV_STATUSES.includes(status)) return CORRUPT("intervention.status", `unknown status ${JSON.stringify(String(status))}`);
	const origin = row.origin;
	if (typeof origin !== "string" || !INTERVENTION_ORIGINS.includes(origin)) return CORRUPT("intervention.origin", `unknown origin ${JSON.stringify(String(origin))}`);
	for (const name of [
		"id",
		"title",
		"workstream_ids",
		"source_refs",
		"created_by"
	]) if (typeof row[name] !== "string") return CORRUPT(`intervention.${name}`, `expected string, got ${typeof row[name]}`);
	if (typeof row.created_at !== "number") return CORRUPT("intervention.created_at", `expected number, got ${typeof row.created_at}`);
	const workstreamIds = decodeJson(row.workstream_ids, "intervention.workstream_ids");
	for (const ws of workstreamIds) if (typeof ws !== "string") return CORRUPT("intervention.workstream_ids", `element must be a string (got ${typeof ws})`);
	const sourceRefs = decodeJson(row.source_refs, "intervention.source_refs");
	for (const ref of sourceRefs) if (ref === null || typeof ref !== "object" || typeof ref.kind !== "string" || typeof ref.id !== "string") return CORRUPT("intervention.source_refs", `element must be a {kind, id} typedRef`);
	return {
		id: row.id,
		title: row.title,
		origin,
		workstream_ids: workstreamIds,
		source_refs: sourceRefs,
		status,
		created_by: decodeJson(row.created_by, "intervention.created_by"),
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
				appended = this.#store.appendEvents([event], { validate: makeValidateHook$1(this.#registry, () => this.#buildEventContext(ivRes.id)) }).events[0];
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
function makeValidateHook$1(registry, buildContext) {
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
/** All 4 frozen actor kinds (mirrors the domain/registry spellings). */
const TOOL_ACTOR_KINDS = [
	"USER",
	"AGENT",
	"PLUGIN",
	"SYSTEM"
];
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
function isToolError(error) {
	return error instanceof ToolError;
}
/**
* G3 — build the trusted lane caller from the exec context ONLY (the
* host resolved actor.kind + run_id from the calling session, G1; the
* gate already enforced the run for writes — this is the defensive
* second look). Identity never comes from args: the frozen faces refuse
* every identity key (tests/tools/trusted-boundary + semantic-create).
*/
function semanticCallerFrom(ctx) {
	if (typeof ctx.runId !== "string" || ctx.runId.length === 0) throw new ToolError("TOOL_RUN_REQUIRED", "the semantic agent create lane requires the run-resolved actor (INV-PERM-1) — unreachable past the gate");
	return {
		kind: "AGENT",
		run_id: ctx.runId,
		...ctx.actor.session_id !== void 0 ? { session_id: ctx.actor.session_id } : {},
		...ctx.actor.label !== void 0 ? { label: ctx.actor.label } : {}
	};
}
/**
* G3 — map a semantic-lane failure into the tool error contract. The
* semantics service throws the documented carrier
* `[research-control] <CODE>: <message>` (service/semantics/errors.ts);
* the machine code rides in `detail.serviceCode` (the run-checkpoint
* precedent), the message carries the full carrier text. Anything else
* maps to TOOL_SERVICE WITHOUT inventing a code.
*/
function toSemanticToolServiceError(toolName, cause) {
	if (cause instanceof ToolError) return cause;
	const message = cause instanceof Error ? cause.message : String(cause);
	const carrier = /^\[research-control\] ([A-Z0-9_]+): /.exec(message);
	return new ToolError("TOOL_SERVICE", `${toolName}: ${message}`, carrier !== null ? {
		cause,
		detail: { serviceCode: carrier[1] }
	} : { cause });
}
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
//#region src/host/tools/read-ports.ts
/** A thrown value carrying a stable machine code (the service error
*  families the read ports may surface: ToolReadServiceError, ReplayError,
*  TopologyStoreError, … — duck-typed on `code` so the mapping never
*  needs per-service imports; a `ToolError` passes through untouched). */
function codedError(cause) {
	if (cause instanceof ToolError) return null;
	if (cause instanceof Error) {
		const code = cause.code;
		if (typeof code === "string") return {
			code,
			message: cause.message
		};
	}
	return null;
}
/**
* Map any forwarding failure onto the structured tool carrier (the
* `RB_CHECKPOINT_FOREIGN_RUN` precedent): `ToolError('TOOL_SERVICE')`
* with `detail.serviceCode` when the cause carries a stable code, bare
* `TOOL_SERVICE` (message verbatim) otherwise. A `ToolError` (e.g. the
* already-validated TOOL_INPUT surface) is never re-wrapped.
*/
function mapReadServiceError(toolName, cause) {
	if (cause instanceof ToolError) return cause;
	const coded = codedError(cause);
	return new ToolError("TOOL_SERVICE", `${toolName}: ${cause instanceof Error ? cause.message : String(cause)}`, coded === null ? {
		cause,
		detail: { tool: toolName }
	} : {
		cause,
		detail: {
			tool: toolName,
			serviceCode: coded.code
		}
	});
}
/** One structured read-service failure (the tool maps it to TOOL_SERVICE). */
var ToolReadServiceError = class extends Error {
	code;
	constructor(code, message, options) {
		super(message, options);
		this.name = "ToolReadServiceError";
		this.code = code;
	}
};
//#endregion
//#region src/host/service/intervention/types.ts
/** The default user actor for GUI operations (matrix column U). */
const USER_ACTOR = {
	kind: "USER",
	label: "user"
};
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
		assertUserActor$1(actor, "createUserIntervention");
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
		const external = this.#externalState();
		const workstreams = external.workstreams;
		for (const ws of workstreamIds) if (!workstreams.has(ws)) throw new InterventionError({
			code: "IV_INPUT",
			message: `${operation}: workstream ${ws} does not exist in the declarative snapshot (DOMAIN_SCHEMA §16 规则 2: 写入时校验)`
		});
		for (const [i, ref] of sourceRefs.entries()) {
			const refs = this.#sourceRefExistence(ref.kind, external);
			if (refs === void 0) continue;
			if (!refs.has(ref.id)) throw new InterventionError({
				code: "IV_INPUT",
				message: `${operation}: source_refs[${i}] references ${ref.kind} ${JSON.stringify(ref.id)} that does not exist (DOMAIN_SCHEMA §16 规则 2: 写入时校验; catalog §5: payload 内引用的对象存在)`
			});
		}
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
					appended = this.#store.appendEvents([event], { validate: makeValidateHook(this.#registry, () => this.#buildEventContext(ivRes.id)) }).events[0];
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
	* 关联）。锚点是**位置性**的（PR5 评审修正）: 无论调用方 source_refs 顺序
	* 如何, payload 恒以 WORKSTREAM:<owner> 打头, 该 ref 的调用方重复项折入
	* 锚点（去重不丢 ref）, 其余 ref 保持相对顺序。
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
		const payloadRefs = [{
			kind: "WORKSTREAM",
			id: input.ownerWs
		}, ...input.sourceRefs.filter((ref) => !(ref.kind === "WORKSTREAM" && ref.id === input.ownerWs))];
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
	* actor.run_id 存在性, catalog §5）; tasks/gates/milestones/claims/
	* facts/artifacts = 注入的 source_refs 校验面（G4 — validator 对本事件
	* 的 checkTypedRefs/owner 推导查这些 map, 生产接线按实际 registry/index
	* 填; 未注入的 map 保持原「空」口径 — 注入面见 InterventionExternalState）。
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
			tasks: external.tasks ?? /* @__PURE__ */ new Map(),
			runs: external.runs ?? /* @__PURE__ */ new Map(),
			claims: external.claims ?? /* @__PURE__ */ new Map(),
			facts: external.facts ?? /* @__PURE__ */ new Map(),
			artifacts: external.artifacts ?? /* @__PURE__ */ new Map(),
			relations: /* @__PURE__ */ new Map(),
			gates: external.gates ?? /* @__PURE__ */ new Map(),
			milestones: external.milestones ?? /* @__PURE__ */ new Map(),
			interventions,
			topologyEdges: /* @__PURE__ */ new Map()
		};
	}
	/**
	* G4: source_refs kind → 注入的校验 map（与冻结 registry 的
	* `WS_LOCAL_KINDS` 同集合 — validate.ts 单一口径, 同步注释在此）。
	* 未建模 / 未注入 = `undefined` = 跳过存在性（V1 shape-only 口径）。
	*/
	#sourceRefExistence(kind, external) {
		switch (kind) {
			case "WORKSTREAM": return external.workstreams;
			case "TASK": return external.tasks;
			case "GATE": return external.gates;
			case "MILESTONE": return external.milestones;
			case "RUN": return external.runs;
			case "CLAIM": return external.claims;
			case "FACT": return external.facts;
			case "ARTIFACT": return external.artifacts;
			default: return;
		}
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
		assertUserActor$1(actor, "updateState");
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
	/**
	* UI-4 (ADJ-7): the WS-local list — the `workstream_ids` contains
	* semantics live in the lifecycle store's filter; this method is a
	* store passthrough (INV-ATTN-1 无隐藏过滤器 — the ONLY filter is the
	* WS membership itself; the stable created_at ASC / id ASC order is
	* kept, so the client renders the full WS intervention set incl.
	* CLOSED for the 「已关闭」 group, B §15.7).
	*/
	listForWorkstream(workstreamId) {
		return this.#lifecycle.listInterventions({ workstreamId });
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
function assertUserActor$1(actor, operation) {
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
function makeValidateHook(registry, buildContext) {
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
	return legalTargets("run", status);
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
	bindDiscoveredSession(dsId, params, actor = USER_ACTOR$1) {
		assertUserActor(actor, "bindDiscoveredSession");
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
	detachDiscoveredSession(dsId, actor = USER_ACTOR$1) {
		assertUserActor(actor, "detachDiscoveredSession");
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
	ignoreDiscoveredSession(dsId, actor = USER_ACTOR$1) {
		assertUserActor(actor, "ignoreDiscoveredSession");
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
	registerRun(params, actor = USER_ACTOR$1) {
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
	finishRun(runId, params = {}, actor = USER_ACTOR$1) {
		return this.#endRun(runId, "FINISHED", actor, (spec) => buildRunFinishedEvent(spec, params.outcomeSummary));
	}
	/** Fail a RUNNING run → RUN_FAILED (§5.1; optional error_summary/failure_kind). */
	failRun(runId, params = {}, actor = USER_ACTOR$1) {
		return this.#endRun(runId, "FAILED", actor, (spec) => buildRunFailedEvent(spec, params.errorSummary, params.failureKind));
	}
	/** Cancel a RUNNING run → RUN_CANCELLED (§5.1; `cancelled_by` = actor). */
	cancelRun(runId, params = {}, actor = USER_ACTOR$1) {
		return this.#endRun(runId, "CANCELLED", actor, (spec) => buildRunCancelledEvent(spec, params.reason));
	}
	/**
	* §6.1 `last_checkpoint_*` update — the operational backing store of
	* the `research_run_checkpoint` agent tool (matrix row: AGENT
	* 「checkpoint 报告触发」). NO History event (a checkpoint is an
	* operational note; the chronicle records Run boundaries only).
	* USER-or-AGENT actors (PLUGIN/SYSTEM are not checkpoint reporters).
	*
	* G1 trusted-boundary gate: an AGENT reporter self-reports — it must
	* carry its OWN formal run_id and that run_id must EQUAL the target
	* run (otherwise `RB_CHECKPOINT_FOREIGN_RUN`, checked after target
	* existence so a wrong id stays `RB_RUN_NOT_FOUND` for every lane).
	* The checkpoint report is the agent's single Run lane, and
	* INV-PERM-1 attributes it to the reporting run; cross-run
	* note-taking and unattributed AGENT reporters stay on the USER
	* lane. NO RUNNING-only policy is invented: §6.1 is status-agnostic
	* and terminal runs keep accepting notes (the pre-existing semantics
	* are respected, not re-strategized).
	*/
	recordCheckpoint(runId, params = {}, actor = USER_ACTOR$1) {
		assertUserOrAgentActor(actor, "recordCheckpoint");
		assertNonEmptyString(runId, "runId");
		if (this.#tables.getRun(runId) === null) throw new RunBindingError("RB_RUN_NOT_FOUND", `no run with id ${runId}`);
		if (actor.kind === "AGENT") {
			const own = typeof actor.run_id === "string" && actor.run_id.length > 0 ? actor.run_id : void 0;
			if (own === void 0 || own !== runId) throw new RunBindingError("RB_CHECKPOINT_FOREIGN_RUN", `recordCheckpoint: an AGENT reporter may only note its OWN run (caller run_id=${own ?? "<missing>"}, target run ${runId}) — cross-run checkpoint notes belong to the USER lane (ARCHITECTURE §6 「Run 生命周期事件」, INV-PERM-1)`);
		}
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
		const validate = makeValidateHook$2(this.#registry, () => buildObjectContext(this.#tables, this.#external()));
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
function assertUserActor(actor, operation) {
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
* research_artifact_register (WP-3.3, live since G3) — register an
* Artifact BY REFERENCE through the narrow AGENT create lane of the
* semantic records service (SemanticsService.registerArtifactAsAgent).
*
* Parameter face — frozen ARTIFACT_REGISTERED payload + envelope owner:
* `workstream_id` (artifacts are Workstream-local; the lane cross-checks
* it against the calling run's WS), `type` (frozen artifactType enum),
* `title`, `uri` (the plugin stores path/URI/reference only — never
* copies content, ARCHITECTURE §9.3), optional `content_hash` /
* `related_task` / `supersedes`. The id (A-<n>) and `created_by_run` are
* NOT arguments — allocated / attributed by the service from the call
* context (host-resolved run, G1). Existence rules (related_task /
* supersedes) ride the frozen registry checks.
*
* The success value is the created artifact row (strict schema).
*/
/** Frozen §7.2 name. */
const RESEARCH_ARTIFACT_REGISTER = "research_artifact_register";
/** The frozen artifact type vocabulary (common.schema.json $defs/artifactType). */
const ARTIFACT_TYPES = [
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
	workstream_id: str("The workstream (WS id) the artifact belongs to — it must be your run's workstream.", true),
	type: {
		type: "string",
		enum: [...ARTIFACT_TYPES],
		required: true,
		description: "The artifact kind (frozen vocabulary)."
	},
	title: str("Short title of the artifact.", true),
	uri: str("Where the artifact lives (workspace-relative path or URI) — the plugin stores the reference, never copies the content.", true),
	content_hash: str("Optional content hash (integrity pointer)."),
	related_task: str("Optional id of the task (T-<n>) that produced the artifact."),
	supersedes: str("Optional id of the earlier artifact (A-<n>) this one replaces.")
};
/** The canonical output contract (G3 strict): the created artifact row. */
const ARTIFACT_REGISTER_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["status", "artifact"],
	properties: {
		status: { const: "ok" },
		artifact: {
			type: "object",
			additionalProperties: false,
			required: [
				"id",
				"workstream_id",
				"type",
				"title",
				"uri",
				"status",
				"created_by_run",
				"recorded_at",
				"event_id"
			],
			properties: {
				id: { type: "string" },
				workstream_id: { type: "string" },
				type: { enum: [...ARTIFACT_TYPES] },
				title: { type: "string" },
				uri: { type: "string" },
				content_hash: { type: "string" },
				related_task: { type: "string" },
				supersedes: { type: "string" },
				status: { const: "REGISTERED" },
				created_by_run: { type: "string" },
				recorded_at: { type: "integer" },
				event_id: { type: "string" }
			}
		}
	}
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
	const type = assertEnum(obj["type"], "/type", ARTIFACT_TYPES);
	const contentHash = assertOptionalString(obj, "content_hash");
	const relatedTask = assertOptionalString(obj, "related_task");
	const supersedes = assertOptionalString(obj, "supersedes");
	return {
		workstream_id: obj["workstream_id"],
		type,
		title: obj["title"],
		uri: obj["uri"],
		...contentHash !== void 0 ? { content_hash: contentHash } : {},
		...relatedTask !== void 0 ? { related_task: relatedTask } : {},
		...supersedes !== void 0 ? { supersedes } : {}
	};
}
function makeArtifactRegisterDefinition(deps) {
	return buildTool({
		name: RESEARCH_ARTIFACT_REGISTER,
		description: "Register an artifact (dataset / figure / model / code / report / note) by reference: the plugin stores the path/URI and metadata, never copies the content. Workstream-local; attributed to your run.",
		access: "write",
		requiresRun: true,
		parameters: ARTIFACT_REGISTER_PARAMETERS,
		output: {
			schema: ARTIFACT_REGISTER_OUTPUT_SCHEMA,
			render: (_args, value) => {
				const v = value;
				return [{
					type: "text",
					text: `Artifact ${v.artifact.id} registered on ${v.artifact.workstream_id}.`
				}];
			}
		},
		handle: async (args, ctx) => {
			const parsed = parseArtifactRegisterArgs(args);
			const caller = semanticCallerFrom(ctx);
			try {
				const res = deps.semanticAgentCreate.registerArtifact({
					workstreamId: parsed.workstream_id,
					type: parsed.type,
					title: parsed.title,
					uri: parsed.uri,
					...parsed.content_hash !== void 0 ? { contentHash: parsed.content_hash } : {},
					...parsed.related_task !== void 0 ? { relatedTaskId: parsed.related_task } : {},
					...parsed.supersedes !== void 0 ? { supersedes: parsed.supersedes } : {}
				}, caller);
				if (typeof res.createdByRun !== "string") throw new ToolError("TOOL_SERVICE", `${RESEARCH_ARTIFACT_REGISTER}: the lane returned an unattributed result (missing createdByRun)`);
				return {
					status: "ok",
					artifact: {
						id: res.artifactId,
						workstream_id: res.workstreamId,
						type: res.type,
						title: res.title,
						uri: res.uri,
						...parsed.content_hash !== void 0 ? { content_hash: parsed.content_hash } : {},
						...parsed.related_task !== void 0 ? { related_task: parsed.related_task } : {},
						...parsed.supersedes !== void 0 ? { supersedes: parsed.supersedes } : {},
						status: res.status,
						created_by_run: res.createdByRun,
						recorded_at: res.recordedAt,
						event_id: res.eventId
					}
				};
			} catch (cause) {
				throw toSemanticToolServiceError(RESEARCH_ARTIFACT_REGISTER, cause);
			}
		}
	});
}
//#endregion
//#region src/host/tools/claim-record.ts
/**
* research_claim_record (WP-3.3, live since G3) — record a Claim through
* the narrow AGENT create lane of the semantic records service
* (SemanticsService.recordClaimAsAgent).
*
* Parameter face — frozen CLAIM_RECORDED payload + envelope owner:
* `workstream_id` (claims are Workstream-local, INV-SCI-1; the lane
* cross-checks it against the calling run's WS), `statement` (minLength
* 1), optional `references`. The id (C-<n>) and `created_by_run` are NOT
* arguments — allocated / attributed by the service from the call
* context (host-resolved run, G1).
*
* The success value is the created claim row (strict schema).
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
	workstream_id: str("The workstream (WS id) the claim belongs to — it must be your run's workstream.", true),
	statement: str("The claim (a scientific statement you stand behind), stated precisely.", true),
	references: optStrArray("Ids of the objects the claim references or rests on (T-/G-/M-/F-/A-/C-…).")
};
/** The canonical output contract (G3 strict): the created claim row. */
const CLAIM_RECORD_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["status", "claim"],
	properties: {
		status: { const: "ok" },
		claim: {
			type: "object",
			additionalProperties: false,
			required: [
				"id",
				"workstream_id",
				"statement",
				"references",
				"status",
				"created_by_run",
				"recorded_at",
				"event_id"
			],
			properties: {
				id: { type: "string" },
				workstream_id: { type: "string" },
				statement: { type: "string" },
				references: {
					type: "array",
					items: { type: "string" }
				},
				status: { const: "ACTIVE" },
				created_by_run: { type: "string" },
				recorded_at: { type: "integer" },
				event_id: { type: "string" }
			}
		}
	}
};
function parseClaimRecordArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_CLAIM_RECORD);
	checkKeySet(obj, CLAIM_RECORD_ARG_KEYS, RESEARCH_CLAIM_RECORD);
	requireKey(obj, "workstream_id", RESEARCH_CLAIM_RECORD);
	requireKey(obj, "statement", RESEARCH_CLAIM_RECORD);
	if (typeof obj["workstream_id"] !== "string" || obj["workstream_id"].length === 0) throw new ToolError("TOOL_INPUT", "/workstream_id: must be a non-empty string");
	if (typeof obj["statement"] !== "string" || obj["statement"].length === 0) throw new ToolError("TOOL_INPUT", "/statement: must be a non-empty string");
	const references = assertOptionalStringArray(obj, "references");
	return {
		workstream_id: obj["workstream_id"],
		statement: obj["statement"],
		...references !== void 0 ? { references } : {}
	};
}
function makeClaimRecordDefinition(deps) {
	return buildTool({
		name: RESEARCH_CLAIM_RECORD,
		description: "Record a claim (a scientific statement you stand behind, e.g. a hypothesis or conclusion) into the workstream semantic registry. Workstream-local; attributed to your run. The plugin records and indexes claims — it never judges their scientific correctness (INV-SCI-2).",
		access: "write",
		requiresRun: true,
		parameters: CLAIM_RECORD_PARAMETERS,
		output: {
			schema: CLAIM_RECORD_OUTPUT_SCHEMA,
			render: (_args, value) => {
				const v = value;
				return [{
					type: "text",
					text: `Claim ${v.claim.id} recorded on ${v.claim.workstream_id}.`
				}];
			}
		},
		handle: async (args, ctx) => {
			const parsed = parseClaimRecordArgs(args);
			const caller = semanticCallerFrom(ctx);
			try {
				const res = deps.semanticAgentCreate.recordClaim({
					workstreamId: parsed.workstream_id,
					statement: parsed.statement,
					...parsed.references !== void 0 ? { references: parsed.references } : {}
				}, caller);
				if (typeof res.createdByRun !== "string") throw new ToolError("TOOL_SERVICE", `${RESEARCH_CLAIM_RECORD}: the lane returned an unattributed result (missing createdByRun)`);
				return {
					status: "ok",
					claim: {
						id: res.claimId,
						workstream_id: res.workstreamId,
						statement: res.statement,
						references: res.references,
						status: res.status,
						created_by_run: res.createdByRun,
						recorded_at: res.recordedAt,
						event_id: res.eventId
					}
				};
			} catch (cause) {
				throw toSemanticToolServiceError(RESEARCH_CLAIM_RECORD, cause);
			}
		}
	});
}
//#endregion
//#region src/host/tools/context-get.ts
/**
* research_context_get (G2 §2d — LIVE forwarding, the stub retired).
*
* Parameter face: NONE — the tool reports the research context bound to
* the CALLING session (workstream, task, Run binding): there is no
* argument because there is no other subject to ask about (the session
* identity comes from the call context, never from arguments).
*
* Forwards to `ResearchToolDeps.contextGet` — the runbinding single
* binding (`getRunBySessionId`) + the declarative loader join. One
* session maps to at most one formal Run (§6.2), so the FULL structured
* subject returns: the frozen run row verbatim plus the declarative
* identity (titles resolve from the tree; an unresolvable declaration
* reports `null`, never a fabrication). An UNBOUND session is the honest
* empty result (`bound: false`) — reads never require a run, so the
* Investigator preset can ask this question before any registration.
*/
/** Frozen §7.2 name. */
const RESEARCH_CONTEXT_GET = "research_context_get";
/** The frozen tool parameter key set (empty — the session context has no subject argument). */
const CONTEXT_GET_ARG_KEYS = [];
/** The tool's model-facing parameter face (no parameters). */
const CONTEXT_GET_PARAMETERS = {};
/** A nullable string leaf (declarative joins report `null` when the
*  declaration is unresolvable — absence as data, never invented). */
const NULLABLE_STRING = { oneOf: [{ type: "string" }, { type: "null" }] };
/** The canonical output contract: the single binding's full subject (the
*  frozen `Run` row — run.schema.json `$defs/Run` — verbatim, plus the
*  declarative workstream/task join). */
const CONTEXT_GET_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: [
		"status",
		"session_id",
		"bound"
	],
	properties: {
		status: {
			type: "string",
			const: "ok"
		},
		session_id: { type: "string" },
		bound: { type: "boolean" },
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
				status: {
					type: "string",
					enum: [
						"RUNNING",
						"FINISHED",
						"FAILED",
						"CANCELLED"
					]
				},
				intent: { type: "string" },
				initiated_by: { type: "object" },
				started_at: { type: "integer" },
				ended_at: { type: "integer" },
				summary: { type: "string" },
				last_checkpoint_at: { type: "integer" },
				last_checkpoint_note: { type: "string" }
			}
		},
		workstream: {
			type: "object",
			additionalProperties: false,
			required: [
				"id",
				"title",
				"topic_id"
			],
			properties: {
				id: { type: "string" },
				title: NULLABLE_STRING,
				topic_id: NULLABLE_STRING
			}
		},
		task: {
			type: "object",
			additionalProperties: false,
			required: ["id", "title"],
			properties: {
				id: { type: "string" },
				title: NULLABLE_STRING
			}
		}
	}
};
/** Validate the frozen NO-ARG face (TOOL_INPUT on any deviation). */
function parseContextGetArgs(args) {
	checkKeySet(assertArgsObject(args, RESEARCH_CONTEXT_GET), CONTEXT_GET_ARG_KEYS, RESEARCH_CONTEXT_GET);
}
function makeContextGetDefinition(deps) {
	return buildTool({
		name: RESEARCH_CONTEXT_GET,
		description: "Get the research context bound to the current session: the workstream, the task (if any), and the formal Run binding.",
		access: "read",
		requiresRun: false,
		parameters: CONTEXT_GET_PARAMETERS,
		output: {
			schema: CONTEXT_GET_OUTPUT_SCHEMA,
			render: (_args, value) => {
				const v = value;
				return [{
					type: "text",
					text: v.bound === true ? `Session ${v.session_id} is bound to run ${v.run?.id} on workstream ${v.run?.workstream_id}${v.task !== void 0 ? ` (task ${v.task.id})` : ""}.` : `Session ${v.session_id} is not bound to a research context (no formal run yet).`
				}];
			}
		},
		handle: async (args, ctx) => {
			parseContextGetArgs(args);
			const sessionId = ctx.actor.session_id;
			if (typeof sessionId !== "string" || sessionId.length === 0) throw new ToolError("TOOL_ACTOR_FORBIDDEN", `${RESEARCH_CONTEXT_GET}: the calling actor carries no session_id — this tool's subject IS the calling session and its identity is host-resolved, never input`);
			try {
				return {
					status: "ok",
					...toToolJsonValue(deps.contextGet(sessionId))
				};
			} catch (cause) {
				throw mapReadServiceError(RESEARCH_CONTEXT_GET, cause);
			}
		}
	});
}
//#endregion
//#region src/host/tools/contract-read.ts
/**
* research_contract_read (G2 §2d — LIVE forwarding, the stub retired).
*
* Parameter face: `edge_id` — the tool reads the merge contract of ONE
* cross-workstream edge (MERGE/FORK, DOMAIN_SCHEMA §3.1) at its
* path-fixed location `merges/<TE-id>/contract.md` (§3.2; INV-GIT-8:
* content ownership by path, no field copy).
*
* Forwards to `ResearchToolDeps.contractRead` — the WP-1.4
* `MergeContractStore.readContract` kernel (Markdown stored/read
* byte-for-byte) composed with the declarative edge snapshot (the tree
* is the edge identity authority, §3.1). Single edge → the FULL
* structured subject (edge identity + content + path), no pagination or
* truncation surface:
*  - a TE id that is malformed → the kernel's structured `INVALID_ID`;
*  - a WELL-FORMED TE id naming no topology edge → `EDGE_NOT_FOUND`
*    (the ownership-by-path file must anchor to a real edge, §16.1(h) —
*    a missing object is a structured error, never an empty result);
*  - an edge that exists WITHOUT a contract.md → the ADJ-7 VALUE face:
*    `content: null`, absence as data (the value has no existence
*    independent of the path — the path is the identity).
* Contract WRITING stays outside the tool face (ARCHITECTURE §6 脚注 ²).
*/
/** Frozen §7.2 name. */
const RESEARCH_CONTRACT_READ = "research_contract_read";
/** The frozen tool parameter key set. */
const CONTRACT_READ_ARG_KEYS = ["edge_id"];
/** The tool's model-facing parameter face (frozen 1 key). */
const CONTRACT_READ_PARAMETERS = { edge_id: str("The cross-workstream topology edge (TE id) whose merge contract to read.", true) };
/** The canonical output contract: ONE edge's identity + its contract
*  bytes (`content: null` = the edge exists but has no contract.md yet). */
const CONTRACT_READ_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: [
		"status",
		"edge",
		"content",
		"path"
	],
	properties: {
		status: {
			type: "string",
			const: "ok"
		},
		edge: {
			type: "object",
			additionalProperties: false,
			required: [
				"id",
				"topic_id",
				"operation",
				"lifecycle",
				"inputs",
				"outputs"
			],
			properties: {
				id: { type: "string" },
				topic_id: { type: "string" },
				operation: {
					type: "string",
					enum: ["FORK", "MERGE"]
				},
				lifecycle: {
					type: "string",
					enum: [
						"PLANNED",
						"REALIZED",
						"DROPPED"
					]
				},
				inputs: {
					type: "array",
					items: { type: "string" }
				},
				outputs: {
					type: "array",
					items: { type: "string" }
				},
				note: { type: "string" }
			}
		},
		content: { oneOf: [{ type: "string" }, { type: "null" }] },
		path: { type: "string" }
	}
};
/** Validate + parse the frozen 1-key wire face. */
function parseContractReadArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_CONTRACT_READ);
	checkKeySet(obj, CONTRACT_READ_ARG_KEYS, RESEARCH_CONTRACT_READ);
	requireKey(obj, "edge_id", RESEARCH_CONTRACT_READ);
	if (typeof obj["edge_id"] !== "string" || obj["edge_id"].length === 0) throw new ToolError("TOOL_INPUT", "/edge_id: must be a non-empty string");
	return { edge_id: obj["edge_id"] };
}
function makeContractReadDefinition(deps) {
	return buildTool({
		name: RESEARCH_CONTRACT_READ,
		description: "Read the merge contract (contract.md) of one cross-workstream topology edge. Read-only: contract content is edited in the workspace, never through an agent tool.",
		access: "read",
		requiresRun: false,
		parameters: CONTRACT_READ_PARAMETERS,
		output: {
			schema: CONTRACT_READ_OUTPUT_SCHEMA,
			render: (_args, value) => {
				const v = value;
				return [{
					type: "text",
					text: v.content === null ? `Edge ${v.edge.id} has no merge contract yet (${v.path} does not exist).` : `Merge contract of edge ${v.edge.id} (${v.path}): ${v.content.length} character(s).`
				}];
			}
		},
		handle: async (args, _ctx) => {
			const parsed = parseContractReadArgs(args);
			try {
				const view = deps.contractRead(parsed.edge_id);
				return {
					status: "ok",
					edge: toToolJsonValue(view.edge),
					content: toToolJsonValue(view.content),
					path: view.path
				};
			} catch (cause) {
				throw mapReadServiceError(RESEARCH_CONTRACT_READ, cause);
			}
		}
	});
}
//#endregion
//#region src/host/tools/fact-record.ts
/**
* research_fact_record (WP-3.3, live since G3) — record a Fact into the
* workstream semantic registry through the narrow AGENT create lane of
* the semantic records service (SemanticsService.recordFactAsAgent).
*
* Parameter face — frozen FACT_RECORDED payload (history-events.schema.json
* §5) + the envelope owner: `workstream_id` is the record's Workstream
* (INV-SCI-1: facts are Workstream-local; the lane cross-checks it
* against the calling run's WS), `statement` (minLength 1), optional
* `references`. The id (F-<n>) and `created_by_run` are NOT arguments —
* the service allocates the id and the lane attributes the event to the
* call context's run (host-resolved, never forgeable from args — G1).
*
* The success value is the created fact row (strict schema: the same
* snake_case fields the derived row carries, plus the event id).
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
	workstream_id: str("The workstream (WS id) the fact belongs to — it must be your run's workstream.", true),
	statement: str("The observed fact (data, measurement, observation), stated precisely.", true),
	references: optStrArray("Ids of the objects the fact references (T-/G-/M-/F-/C-…).")
};
/** The canonical output contract (G3 strict): the created fact row. */
const FACT_RECORD_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["status", "fact"],
	properties: {
		status: { const: "ok" },
		fact: {
			type: "object",
			additionalProperties: false,
			required: [
				"id",
				"workstream_id",
				"statement",
				"references",
				"status",
				"created_by_run",
				"recorded_at",
				"event_id"
			],
			properties: {
				id: { type: "string" },
				workstream_id: { type: "string" },
				statement: { type: "string" },
				references: {
					type: "array",
					items: { type: "string" }
				},
				status: { const: "ACTIVE" },
				created_by_run: { type: "string" },
				recorded_at: { type: "integer" },
				event_id: { type: "string" }
			}
		}
	}
};
function parseFactRecordArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_FACT_RECORD);
	checkKeySet(obj, FACT_RECORD_ARG_KEYS, RESEARCH_FACT_RECORD);
	requireKey(obj, "workstream_id", RESEARCH_FACT_RECORD);
	requireKey(obj, "statement", RESEARCH_FACT_RECORD);
	if (typeof obj["workstream_id"] !== "string" || obj["workstream_id"].length === 0) throw new ToolError("TOOL_INPUT", "/workstream_id: must be a non-empty string");
	if (typeof obj["statement"] !== "string" || obj["statement"].length === 0) throw new ToolError("TOOL_INPUT", "/statement: must be a non-empty string");
	const references = assertOptionalStringArray(obj, "references");
	return {
		workstream_id: obj["workstream_id"],
		statement: obj["statement"],
		...references !== void 0 ? { references } : {}
	};
}
function makeFactRecordDefinition(deps) {
	return buildTool({
		name: RESEARCH_FACT_RECORD,
		description: "Record an observed fact (data, measurement, observation) into the workstream semantic registry. Workstream-local; attributed to your run.",
		access: "write",
		requiresRun: true,
		parameters: FACT_RECORD_PARAMETERS,
		output: {
			schema: FACT_RECORD_OUTPUT_SCHEMA,
			render: (_args, value) => {
				const v = value;
				return [{
					type: "text",
					text: `Fact ${v.fact.id} recorded on ${v.fact.workstream_id}.`
				}];
			}
		},
		handle: async (args, ctx) => {
			const parsed = parseFactRecordArgs(args);
			const caller = semanticCallerFrom(ctx);
			try {
				const res = deps.semanticAgentCreate.recordFact({
					workstreamId: parsed.workstream_id,
					statement: parsed.statement,
					...parsed.references !== void 0 ? { references: parsed.references } : {}
				}, caller);
				if (typeof res.createdByRun !== "string") throw new ToolError("TOOL_SERVICE", `${RESEARCH_FACT_RECORD}: the lane returned an unattributed result (missing createdByRun)`);
				return {
					status: "ok",
					fact: {
						id: res.factId,
						workstream_id: res.workstreamId,
						statement: res.statement,
						references: res.references,
						status: res.status,
						created_by_run: res.createdByRun,
						recorded_at: res.recordedAt,
						event_id: res.eventId
					}
				};
			} catch (cause) {
				throw toSemanticToolServiceError(RESEARCH_FACT_RECORD, cause);
			}
		}
	});
}
//#endregion
//#region src/host/tools/history-query.ts
/**
* research_history_query (G2 §2d — LIVE forwarding, the stub retired).
*
* Parameter face — a faithful projection of the WP-2.3 read-only query
* surface (`queryEvents`, seq-cursor pagination, §8 「History 按页面/时间
* 窗口分页」): `workstream_id` (the owner WS whose log is read — every
* HistoryEvent has exactly one owner, INV-HIST-3) + optional `order`
* ('semantic' | 'audit'), `after_seq` (exclusive lower bound, ≥ 0),
* `before_seq` (exclusive upper bound), `limit` (page size, ≥ 1).
* Read-only by construction — History mutation/delete has NO tool
* (INV-PERM-2; the matrix row 「History update/delete ❌ ❌ ❌ ❌」).
*
* PAGE-SIZE POLICY (BASELINE_PLAN §5 Q2 — the small ruling, THIS tool
* only): no frozen document names a default or a maximum (verified:
* `QueryHistoryArgsSchema` leaves `limit` unbounded; TEST_MATRIX names
* no numbers), so the tool boundary resolves `limit ?? 100` and REFUSES
* `limit > 1000` with TOOL_INPUT — never a silent clamp (the caller
* learns the cap and pages with the frozen cursor instead). The applied
* page size is echoed on every page (`limit`). Everything else is the
* WP-2.3 protocol verbatim: windows PARTITION the seq axis, rows are
* never truncated mid-window, `next_after_seq`/`exhausted` are
* self-terminating.
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
/** Q2 (this tool only): maximum page size — above it the call is REFUSED
*  (TOOL_INPUT), never silently truncated. */
const HISTORY_QUERY_MAX_LIMIT = 1e3;
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
		description: `Page size in events (100 when omitted; maximum ${HISTORY_QUERY_MAX_LIMIT} — larger calls are refused, page with after_seq instead).`
	}
};
/** The frozen event envelope (`HistoryEventRecord`, camelCase carrier —
*  the same DTO face the frozen `queryHistory` RPC row serves). */
const HISTORY_EVENT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: [
		"eventId",
		"ownerWorkstreamId",
		"eventType",
		"schemaVersion",
		"occurredAt",
		"actor",
		"payload",
		"eventSeq",
		"recordedAt"
	],
	properties: {
		eventId: { type: "string" },
		ownerWorkstreamId: { type: "string" },
		eventType: { type: "string" },
		schemaVersion: { type: "integer" },
		occurredAt: { type: "integer" },
		actor: {
			type: "object",
			additionalProperties: false,
			required: ["kind"],
			properties: {
				kind: { type: "string" },
				user_id: { type: "string" },
				run_id: { type: "string" },
				session_id: { type: "string" },
				label: { type: "string" }
			}
		},
		source: { oneOf: [{
			type: "object",
			additionalProperties: false,
			required: ["kind"],
			properties: {
				kind: { type: "string" },
				session_id: { type: "string" },
				path: { type: "string" },
				commit_oid: { type: "string" },
				interaction_id: { type: "string" },
				note: { type: "string" }
			}
		}, { type: "null" }] },
		payload: {
			type: "object",
			additionalProperties: true
		},
		eventSeq: { type: "integer" },
		recordedAt: { type: "integer" }
	}
};
/** The canonical output contract: ONE page of the frozen seq-cursor
*  protocol (rows verbatim; `next_after_seq`/`exhausted` as WP-2.3). */
const HISTORY_QUERY_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: [
		"status",
		"workstream_id",
		"order",
		"limit",
		"events",
		"next_after_seq",
		"exhausted"
	],
	properties: {
		status: {
			type: "string",
			const: "ok"
		},
		workstream_id: { type: "string" },
		order: {
			type: "string",
			enum: [...HISTORY_ORDERS]
		},
		limit: { type: "integer" },
		events: {
			type: "array",
			items: HISTORY_EVENT_SCHEMA
		},
		next_after_seq: { oneOf: [{ type: "integer" }, { type: "null" }] },
		exhausted: { type: "boolean" }
	}
};
/** Validate + parse the frozen 5-key wire face into the port query
*  (the page-size policy resolves HERE: default applied, max REFUSED). */
function parseHistoryQueryArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_HISTORY_QUERY);
	checkKeySet(obj, HISTORY_QUERY_ARG_KEYS, RESEARCH_HISTORY_QUERY);
	requireKey(obj, "workstream_id", RESEARCH_HISTORY_QUERY);
	if (typeof obj["workstream_id"] !== "string" || obj["workstream_id"].length === 0) throw new ToolError("TOOL_INPUT", "/workstream_id: must be a non-empty string");
	const order = obj["order"] !== void 0 ? assertEnum(obj["order"], "/order", HISTORY_ORDERS) : void 0;
	const afterSeq = assertOptionalInteger(obj, "after_seq", { min: 0 });
	const beforeSeq = assertOptionalInteger(obj, "before_seq", { min: 1 });
	const limit = assertOptionalInteger(obj, "limit", {
		min: 1,
		max: HISTORY_QUERY_MAX_LIMIT
	});
	return {
		workstreamId: obj["workstream_id"],
		...order !== void 0 ? { order } : {},
		...afterSeq !== void 0 ? { afterSeq } : {},
		...beforeSeq !== void 0 ? { beforeSeq } : {},
		limit: limit ?? 100
	};
}
function makeHistoryQueryDefinition(deps) {
	return buildTool({
		name: RESEARCH_HISTORY_QUERY,
		description: "Query a workstream ResearchHistory (the append-only research event log) with seq-cursor pagination. Read-only: the log cannot be mutated or deleted from any agent surface.",
		access: "read",
		requiresRun: false,
		parameters: HISTORY_QUERY_PARAMETERS,
		output: {
			schema: HISTORY_QUERY_OUTPUT_SCHEMA,
			render: (_args, value) => {
				const v = value;
				return [{
					type: "text",
					text: `${String(v.events.length)} event(s) of ${v.workstream_id} (${v.order} order, page size ${String(v.limit)})` + (v.exhausted ? " — log exhausted." : ` — next page after seq ${String(v.next_after_seq)}.`)
				}];
			}
		},
		handle: async (args, _ctx) => {
			const query = parseHistoryQueryArgs(args);
			try {
				const page = deps.historyQuery(query);
				return {
					status: "ok",
					workstream_id: page.workstream_id,
					order: page.order,
					limit: page.limit,
					events: toToolJsonValue([...page.events]),
					next_after_seq: toToolJsonValue(page.next_after_seq),
					exhausted: page.exhausted
				};
			} catch (cause) {
				throw mapReadServiceError(RESEARCH_HISTORY_QUERY, cause);
			}
		}
	});
}
//#endregion
//#region src/host/tools/intervention-create.ts
/**
* research_intervention_create (WP-3.3 face; G4: the stub retires into the
* real forward) — the agent's human-attention report.
*
* Parameter face — frozen INTERVENTION_CREATED payload / DOMAIN_SCHEMA
* §9.2, restricted to the agent's matrix lane: the agent CREATES
* interventions (origin is fixed to AGENT_REPORT — the matrix footnote
* 「运行时明确要求人工判断的 Agent report」 — by the wiring-closed
* `AGENT_REPORT_REQUIRES_HUMAN` mechanical trigger, see
* `ResearchToolDeps.interventionCreate`), but may NEVER touch their
* state (OPEN/PENDING/CLOSED is user-only, INV-PERM-4 — no state tool
* exists). `origin` is therefore NOT an argument; the `created_by` actor
* comes from the call context (trusted: the gate's formal run + the host-
* resolved session actor — identity is never read from args).
*
* Forwarding (event-first, row-second — the WP-5.1 pipeline is the single
* write path): the handler maps the frozen 4-key wire face onto
* `InterventionCreateParams` and calls the injected mechanical-creation
* port. The §16 规则 2 write-time checks (workstream existence, source_refs
* typedRef existence over the real validation context) and the frozen
* registry event validation live at the SERVICE — the tool duplicates
* none; service failures keep their machine code in
* `detail.serviceCode` (the `[CODE]`-in-message convention rides the message).
*
* The success value is the created frozen record (attention.schema.json
* `$defs/Intervention`, additionalProperties:false) plus `event_id` — the
* INTERVENTION_CREATED id, `null` exactly when the intervention carries no
* workstream association and therefore emits NO event (TC-DOM-023, CATALOG
* §5.7).
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
/** The canonical output contract (frozen `$defs/Intervention` + the event id). */
const INTERVENTION_CREATE_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: [
		"status",
		"intervention",
		"event_id"
	],
	properties: {
		status: { const: "created" },
		intervention: {
			type: "object",
			additionalProperties: false,
			required: [
				"id",
				"title",
				"origin",
				"status",
				"created_by",
				"created_at"
			],
			properties: {
				id: { type: "string" },
				title: { type: "string" },
				detail: { type: "string" },
				origin: { enum: [
					"USER",
					"AGENT_REPORT",
					"AUTO_FLOODING",
					"AUTO_AUDIT"
				] },
				workstream_ids: {
					type: "array",
					items: { type: "string" }
				},
				source_refs: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						required: ["kind", "id"],
						properties: {
							kind: { type: "string" },
							id: { type: "string" }
						}
					}
				},
				status: { enum: [
					"OPEN",
					"PENDING",
					"CLOSED"
				] },
				created_by: {
					type: "object",
					additionalProperties: false,
					required: ["kind"],
					properties: {
						kind: { enum: [...TOOL_ACTOR_KINDS] },
						user_id: { type: "string" },
						run_id: { type: "string" },
						session_id: { type: "string" },
						label: { type: "string" }
					}
				},
				created_at: { type: "integer" },
				closed_at: { type: "integer" },
				resolution_note: { type: "string" }
			}
		},
		event_id: { oneOf: [{ type: "string" }, { type: "null" }] }
	}
};
/** Validate + parse the frozen 4-key wire face. */
function parseInterventionCreateArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_INTERVENTION_CREATE);
	checkKeySet(obj, INTERVENTION_CREATE_ARG_KEYS, RESEARCH_INTERVENTION_CREATE);
	requireKey(obj, "title", RESEARCH_INTERVENTION_CREATE);
	if (typeof obj["title"] !== "string" || obj["title"].length === 0) throw new ToolError("TOOL_INPUT", "/title: must be a non-empty string");
	const detail = obj["detail"];
	if (detail !== void 0 && (typeof detail !== "string" || detail.length === 0)) throw new ToolError("TOOL_INPUT", "/detail: must be a non-empty string");
	const workstreamIds = assertOptionalStringArray(obj, "workstream_ids");
	let sourceRefs;
	const rawRefs = obj["source_refs"];
	if (rawRefs !== void 0) {
		if (!Array.isArray(rawRefs)) throw new ToolError("TOOL_INPUT", "/source_refs: must be an array");
		sourceRefs = rawRefs.map((ref, i) => {
			const r = assertObject(ref, `/source_refs/${i}`);
			checkKeySet(r, ["kind", "id"], "a source ref", `/source_refs/${i}`);
			assertEnum(r["kind"], `/source_refs/${i}/kind`, OBJECT_KINDS);
			if (typeof r["id"] !== "string" || r["id"].length === 0) throw new ToolError("TOOL_INPUT", `/source_refs/${i}/id: must be a non-empty string`);
			return {
				kind: r["kind"],
				id: r["id"]
			};
		});
	}
	return {
		title: obj["title"],
		...detail !== void 0 ? { detail } : {},
		...workstreamIds !== void 0 ? { workstream_ids: workstreamIds } : {},
		...sourceRefs !== void 0 ? { source_refs: sourceRefs } : {}
	};
}
function makeInterventionCreateDefinition(deps) {
	return buildTool({
		name: RESEARCH_INTERVENTION_CREATE,
		description: "Raise an item that requires a human decision or attention (it lands as an OPEN intervention the user manages). Use only when the work genuinely needs human judgment — the plugin never raises one for scientific conflicts on its own, and you cannot change an intervention's state after creating it.",
		access: "write",
		requiresRun: true,
		parameters: INTERVENTION_CREATE_PARAMETERS,
		output: {
			schema: INTERVENTION_CREATE_OUTPUT_SCHEMA,
			render: (_args, value) => {
				const v = value;
				const tail = v.event_id === null ? "no workstream association — no History event" : `History event ${v.event_id}`;
				return [{
					type: "text",
					text: `Intervention ${v.intervention.id} raised (${v.intervention.status}) — ${tail}`
				}];
			}
		},
		handle: async (args, ctx) => {
			const parsed = parseInterventionCreateArgs(args);
			const actor = {
				kind: "AGENT",
				run_id: ctx.runId,
				...ctx.actor.label !== void 0 ? { label: ctx.actor.label } : {}
			};
			const params = {
				title: parsed.title,
				...parsed.detail !== void 0 ? { detail: parsed.detail } : {},
				...parsed.workstream_ids !== void 0 ? { workstream_ids: parsed.workstream_ids } : {},
				...parsed.source_refs !== void 0 ? { source_refs: parsed.source_refs } : {}
			};
			try {
				const result = deps.interventionCreate(params, actor);
				return {
					status: "created",
					intervention: toToolJsonValue(result.intervention),
					event_id: result.eventId
				};
			} catch (cause) {
				if (cause instanceof InterventionError) throw new ToolError("TOOL_SERVICE", `${RESEARCH_INTERVENTION_CREATE}: [${cause.code}] ${cause.message}`, {
					cause,
					detail: { serviceCode: cause.code }
				});
				throw new ToolError("TOOL_SERVICE", `${RESEARCH_INTERVENTION_CREATE}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
			}
		}
	});
}
//#endregion
//#region src/host/tools/next-action-create.ts
/**
* research_next_action_create (WP-3.3 face; G4: the stub retires into the
* real forward) — the agent's lightweight "possibly worth doing" proposal.
*
* Parameter face — DOMAIN_SCHEMA §9.3 NextAction, restricted to the
* agent's matrix lane: the agent CREATES NextActions (status defaults to
* PROPOSED — not an argument), but may NEVER PROMOTE (→ Task) or DISMISS
* them (user-only, the matrix row 「NextAction PROMOTE/DISMISS ✅/❌/❌/❌」 —
* no such tool exists). `id` / `created_by` / `created_at` come from the
* service and the call context.
*
* Forwarding: the INDEPENDENT WP-5.2 lane `ActionsService.createNextAction`
* (NOT the intervention service — BASELINE_PLAN §2b names two different
* services). The service already owns this lane's complete validation set —
* the creator gate (`assertNextActionCreator`: USER|AGENT, an AGENT must
* carry a formal R id) and the optional-WS existence check against the live
* declarative tree (§16.3, ACT_INPUT) — so the tool reuses it and duplicates
* NOTHING. There is no History event by contract (the frozen 20-event
* catalog has no NA event — the row IS the record).
*
* The success value is the created PROPOSED row (frozen attention.schema.json
* `$defs/NextAction`, additionalProperties:false).
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
/** The canonical output contract (frozen `$defs/NextAction`). */
const NEXT_ACTION_CREATE_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["status", "next_action"],
	properties: {
		status: { const: "created" },
		next_action: {
			type: "object",
			additionalProperties: false,
			required: [
				"id",
				"statement",
				"status",
				"created_by",
				"created_at"
			],
			properties: {
				id: { type: "string" },
				workstream_id: { type: "string" },
				statement: { type: "string" },
				rationale: { type: "string" },
				status: { enum: [
					"PROPOSED",
					"PROMOTED",
					"DISMISSED"
				] },
				promoted_to_task_id: { type: "string" },
				created_by: {
					type: "object",
					additionalProperties: false,
					required: ["kind"],
					properties: {
						kind: { enum: [...TOOL_ACTOR_KINDS] },
						user_id: { type: "string" },
						run_id: { type: "string" },
						session_id: { type: "string" },
						label: { type: "string" }
					}
				},
				created_at: { type: "integer" }
			}
		}
	}
};
/** Validate + parse the frozen 3-key wire face. */
function parseNextActionCreateArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_NEXT_ACTION_CREATE);
	checkKeySet(obj, NEXT_ACTION_CREATE_ARG_KEYS, RESEARCH_NEXT_ACTION_CREATE);
	requireKey(obj, "statement", RESEARCH_NEXT_ACTION_CREATE);
	if (typeof obj["statement"] !== "string" || obj["statement"].length === 0) throw new ToolError("TOOL_INPUT", "/statement: must be a non-empty string");
	const workstreamId = assertOptionalString(obj, "workstream_id");
	const rationale = assertOptionalString(obj, "rationale");
	return {
		statement: obj["statement"],
		...workstreamId !== void 0 ? { workstream_id: workstreamId } : {},
		...rationale !== void 0 ? { rationale } : {}
	};
}
function makeNextActionCreateDefinition(deps) {
	return buildTool({
		name: RESEARCH_NEXT_ACTION_CREATE,
		description: "Propose a lightweight next action that may be worth doing (NOT a Task). The user decides: they promote it into a formal Task or dismiss it — you cannot do either.",
		access: "write",
		requiresRun: true,
		parameters: NEXT_ACTION_CREATE_PARAMETERS,
		output: {
			schema: NEXT_ACTION_CREATE_OUTPUT_SCHEMA,
			render: (_args, value) => {
				const v = value;
				const ws = v.next_action.workstream_id !== void 0 ? ` (workstream ${v.next_action.workstream_id})` : "";
				return [{
					type: "text",
					text: `Next action ${v.next_action.id} proposed${ws} — the user decides: promote to Task or dismiss`
				}];
			}
		},
		handle: async (args, ctx) => {
			const parsed = parseNextActionCreateArgs(args);
			const actor = {
				kind: "AGENT",
				run_id: ctx.runId,
				...ctx.actor.label !== void 0 ? { label: ctx.actor.label } : {}
			};
			const params = {
				statement: parsed.statement,
				...parsed.rationale !== void 0 ? { rationale: parsed.rationale } : {},
				...parsed.workstream_id !== void 0 ? { workstreamId: parsed.workstream_id } : {}
			};
			try {
				return {
					status: "created",
					next_action: toToolJsonValue(deps.nextActionCreate(params, actor))
				};
			} catch (cause) {
				if (cause instanceof ActionsError) throw new ToolError("TOOL_SERVICE", `${RESEARCH_NEXT_ACTION_CREATE}: [${cause.code}] ${cause.message}`, {
					cause,
					detail: { serviceCode: cause.code }
				});
				throw new ToolError("TOOL_SERVICE", `${RESEARCH_NEXT_ACTION_CREATE}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
			}
		}
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
* research_plan_get (G2 §2d — LIVE forwarding, the stub retired).
*
* Parameter face: `workstream_id` — the tool reads the workstream's
* canonical Future Plan (the stable ordered G/T/M sequence,
* `plan.yaml`). Read-only by construction (INV-PLAN-3: the agent has no
* plan write path at any surface; the read is the only lane).
*
* Forwards to `ResearchToolDeps.planGet` — the WP-1.3
* `PlanStore.loadPlan` composition (the wiring's canonical provider,
* fresh per call). One workstream → the FULL subject: `ordered_items`
* VERBATIM in file order (INV-PLAN-1 — never sorted, deduped or
* truncated; the plan is bounded by construction), plus the presence /
* §4.4-consistency facts (`consistent: false` reports the first
* `problem` instead of repairing it — the FILE stays the truth) and the
* declarative identity (title/topic, `null` when unresolvable). A
* missing workstream is a missing OBJECT (structured
* `TOOL_SERVICE/WS_NOT_FOUND`); a missing `plan.yaml` on a real
* workstream is the honest empty plan (`present: false`, `[]`).
*/
/** Frozen §7.2 name. */
const RESEARCH_PLAN_GET = "research_plan_get";
/** The frozen tool parameter key set. */
const PLAN_GET_ARG_KEYS = ["workstream_id"];
/** The tool's model-facing parameter face (frozen 1 key). */
const PLAN_GET_PARAMETERS = { workstream_id: str("The workstream (WS id) whose canonical future plan to read.", true) };
/** The canonical output contract: ONE workstream's full canonical plan
*  (no pagination/truncation surface — the subject is bounded). */
const PLAN_GET_OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: [
		"status",
		"workstream_id",
		"title",
		"topic_id",
		"present",
		"consistent",
		"ordered_items"
	],
	properties: {
		status: {
			type: "string",
			const: "ok"
		},
		workstream_id: { type: "string" },
		title: { oneOf: [{ type: "string" }, { type: "null" }] },
		topic_id: { oneOf: [{ type: "string" }, { type: "null" }] },
		present: { type: "boolean" },
		consistent: { type: "boolean" },
		problem: { type: "string" },
		ordered_items: {
			type: "array",
			items: { type: "string" }
		}
	}
};
/** Validate + parse the frozen 1-key wire face. */
function parsePlanGetArgs(args) {
	const obj = assertArgsObject(args, RESEARCH_PLAN_GET);
	checkKeySet(obj, PLAN_GET_ARG_KEYS, RESEARCH_PLAN_GET);
	requireKey(obj, "workstream_id", RESEARCH_PLAN_GET);
	if (typeof obj["workstream_id"] !== "string" || obj["workstream_id"].length === 0) throw new ToolError("TOOL_INPUT", "/workstream_id: must be a non-empty string");
	return { workstream_id: obj["workstream_id"] };
}
function makePlanGetDefinition(deps) {
	return buildTool({
		name: RESEARCH_PLAN_GET,
		description: "Read a workstream canonical future plan: the stable ordered sequence of Goals / Tasks / Gates / Milestones (plan.yaml). Read-only.",
		access: "read",
		requiresRun: false,
		parameters: PLAN_GET_PARAMETERS,
		output: {
			schema: PLAN_GET_OUTPUT_SCHEMA,
			render: (_args, value) => {
				const v = value;
				return [{
					type: "text",
					text: v.present ? `Canonical plan of ${v.workstream_id}: ${String(v.ordered_items.length)} item(s) in canonical order${v.consistent ? "" : " (INCONSISTENT plan — see the structured result)"}.` : `Workstream ${v.workstream_id} exists but has no canonical plan (plan.yaml absent).`
				}];
			}
		},
		handle: async (args, _ctx) => {
			const parsed = parsePlanGetArgs(args);
			try {
				const view = deps.planGet(parsed.workstream_id);
				return {
					status: "ok",
					workstream_id: view.workstream.id,
					title: toToolJsonValue(view.workstream.title),
					topic_id: toToolJsonValue(view.topic_id),
					present: view.present,
					consistent: view.consistent,
					...view.problem !== void 0 ? { problem: view.problem } : {},
					ordered_items: toToolJsonValue([...view.ordered_items])
				};
			} catch (cause) {
				throw mapReadServiceError(RESEARCH_PLAN_GET, cause);
			}
		}
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
		description: "The id (R-<n>) of the formal run to report a checkpoint for — it must be your own run (the report is verified against the run your session is attributed to)."
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
/** The §7.2 writable group (7 tools — the INV-PERM-1 agent write set). */
const WRITE_TOOL_NAMES = RESEARCH_TOOL_NAMES.slice(0, 7);
RESEARCH_TOOL_NAMES.slice(7);
/**
* Compose the complete tool face over the service ports (two write
* ports + the G3 semantic create lane + the four G2 read ports + the
* two G4 attention-write ports). Fail-loud on a malformed deps object
* (misconfiguration is a composition-time error, not a per-call
* surprise). The returned
* definitions are frozen and registered by the host wiring WP (WP-3.6)
* — one `defineTool` adaptation per definition.
*/
function createResearchTools(deps) {
	assertDeps(deps);
	return [
		makeFactRecordDefinition(deps),
		makeClaimRecordDefinition(deps),
		makeArtifactRegisterDefinition(deps),
		makeInterventionCreateDefinition(deps),
		makeNextActionCreateDefinition(deps),
		makePlanForkCreateDefinition(deps),
		makeRunCheckpointDefinition(deps),
		makeContextGetDefinition(deps),
		makePlanGetDefinition(deps),
		makeHistoryQueryDefinition(deps),
		makeContractReadDefinition(deps)
	];
}
/** Every reviewed port (write surface + lane methods + the four reads + the attention pair) must be a function (fail loud at composition). */
function assertDeps(deps) {
	if (deps === null || typeof deps !== "object") throw new TypeError("createResearchTools: deps must be an object with the reviewed service ports");
	if (typeof deps.planForkCreate !== "function") throw new TypeError("createResearchTools: deps.planForkCreate must be the PlanFork creation service (WP-3.1 chain)");
	if (typeof deps.recordCheckpoint !== "function") throw new TypeError("createResearchTools: deps.recordCheckpoint must be the RunBindingService.recordCheckpoint surface (WP-2.4)");
	if (typeof deps.interventionCreate !== "function") throw new TypeError("createResearchTools: deps.interventionCreate must be the mechanical intervention creation lane (WP-5.1, trigger pinned by the wiring)");
	if (typeof deps.nextActionCreate !== "function") throw new TypeError("createResearchTools: deps.nextActionCreate must be the ActionsService.createNextAction surface (WP-5.2)");
	const lane = deps.semanticAgentCreate;
	if (lane === null || typeof lane !== "object" || typeof lane.recordFact !== "function" || typeof lane.recordClaim !== "function" || typeof lane.registerArtifact !== "function") throw new TypeError("createResearchTools: deps.semanticAgentCreate must be the narrow semantic agent create lane (G3 — recordFact/recordClaim/registerArtifact)");
	for (const port of [
		"contextGet",
		"planGet",
		"historyQuery",
		"contractRead"
	]) if (typeof deps[port] !== "function") throw new TypeError(`createResearchTools: deps.${port} must be the G2 §2d read service (service/wiring/read-services.ts)`);
}
//#endregion
export { validatePlanForkCreation as A, pjoin as B, ObjectiveFileService as C, SQL_TRANSITION_PLAN_FORK as D, SQL_SELECT_PLAN_FORK_BY_ID as E, loadPlanForkSchemas as F, OBJECT_KIND_VALUES as G, counterKey as H, PlanForkError as I, ActionsStore as K, loadResearchTree as L, closureRelativePaths as M, resolveAnchors as N, managementActionToParams as O, loadPlanForkPolicy as P, loadSchemas as R, isPlanStoreError as S, SQL_INSERT_MANAGEMENT_ACTION as T, idMatchesKind as U, IdAllocator as V, parseId as W, openDatabase as _, InterventionService as a, PlanStore as b, ToolReadServiceError as c, InterventionStore as d, loadInterventionSchemas as f, loadHistoryEventRegistry as g, validateEvent as h, RunBindingService as i, checkPfTransition as j, rowToPlanFork as k, isToolError as l, RunBindingError as m, createResearchTools as n, InterventionLifecycleStore as o, makeValidateHook$2 as p, ActionsError as q, openRunBindingTables as r, USER_ACTOR as s, WRITE_TOOL_NAMES as t, FloodingService as u, StoreError as v, PlanForkStore as w, KIND_TO_DIR as x, ActionsService as y, schemaErrorSummary as z };
