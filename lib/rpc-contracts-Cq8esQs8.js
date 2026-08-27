import { z } from "zod";
//#region src/shared/rpc-contracts.ts
/**
* Shared RPC wire contracts for the Research Control Plane's Typert
* artifacts (WP-0.3 ping spike, WP-4.1a: the full 13-RPC client face).
*
* Single source of truth for every wire shape: the host `./typert`
* manifest (`src/host/dsh-adapter/host/typert.artifact.ts`) and the client
* `./remote` contribution (`src/client/dsh-adapter/remote/contribution.ts`)
* are both built from the exports here so the two faces cannot drift.
*
* Dependency rule (ARCHITECTURE.md §2.2 rule 2 / INV-PERM-5, lint-enforced):
* this file is pure TS types plus zod schemas and must NOT import any
* `@deepseek-ai/*` package. zod is not a DSH package — it is the codec
* backend for strict typert codecs: the registry stores live zod v4 schema
* instances and the loader duck-checks them via the `_zod` brand.
*
* The `*Mirror` interfaces below re-declare the Typert protocol types
* (npm `@deepseek-ai/dsh-typert-protocol` 0.1.0-rc.8 `lib/types/types.d.ts`)
* and the registry manifest types (checkout `packages/typert/registry/src/types.ts`)
* because this file cannot import those packages. The host and client
* artifact files re-attach the REAL protocol types at their export
* boundaries — tsc's structural check there keeps every mirror honest.
*
* WP-4.1a wire conventions (all 13 RPCs of ARCHITECTURE.md §7.1):
*  - PURE JSON DTOs (DSH_ADAPTER §5 step 3): no Dates, no class instances,
*    no undefined values on the wire — optionality is expressed as
*    `null` or an absent declared-optional field;
*  - every object schema is `zod .strict()`: unknown keys are rejected at
*    the boundary (the gateway's strict path parses BOTH the wire args and
*    the host result through these same schema instances — the facade
*    projection must be exact, a stray key fails loud);
*  - time fields are epoch milliseconds (A-3 revision, the operational
*    carrier's uniform clock);
*  - every non-ping RPC takes exactly ONE wire parameter `args` (a
*    strict object; genuinely optional fields live INSIDE it, so the
*    descriptor's parameter face stays flat: 0 params for the two
*    zero-arg queries, 1 param for the other 11 — the RR-006 arity test
*    pins this 1:1 against the host method signature);
*  - unimplemented data (Phase 5/6 objects: attention scoring,
*    Interaction/ReportingItem/ScheduledEvent, Research Inbox) rides the
*    wire as explicit `null` placeholder fields — NEVER fabricated values
*    (the placeholder set is pinned by the strict schemas below).
*
* V2-T3.1 (design §12 / §12.1 — the contract layer of the research
* plane face; PURE CONTRACT, no host implementation logic — the
* `@Remote` method bodies, the service-port wiring, and the artifact
* registration land with T3.2):
*  - the 9 new plane RPCs of design §12 (getResearchPlaneState /
*    getHubOverview / getPortfolioInterventions / setHub / bindProject /
*    unbindProject / restoreProject / rescan / ackMissingReminder) are
*    added as `*Args`/`*Result` zod schemas + hand-written invocation
*    descriptors (`RESEARCH_PLANE_INVOCATIONS`), re-using the SAME
*    `descriptor()`/`argsParameter()` helpers and wire conventions as
*    the frozen 13. Every new method carries exactly ONE `args` json
*    parameter — including `getHubOverview`/`rescan`, whose request
*    object is the EMPTY strict object (the flat-parameter-face
*    convention, and the design's `{}` request shapes);
*  - the frozen 13 RESULT schemas are UNCHANGED (结果 schema 零改动).
*    Their 11 parameterized REQUEST schemas gain the OPTIONAL
*    `projectId` field (design §12.1 裁决 — the strict-schema
*    backward-compatible extension: an old caller that omits it parses
*    byte-identically). The two zero-arg queries (getDashboard /
*    getProject) have NO request object — they keep their frozen
*    zero-parameter wire face; §12.1 routing for them runs through the
*    omitted-id rule only (exactly one active project → it, otherwise a
*    clear error — `resolveProject`'s existing behavior);
*  - the `PLANE_*` named error family ({@link PlaneError} /
*    {@link PlaneErrorCode}) names every rejection branch of the new
*    face (the code rides in the message — the gateway folds business
*    errors to `{ ok: false, error: <message> }`, so the code in the
*    text is the machine-matchable carrier, the existing
*    `[${code}]`-in-message precedent).
*/
/** npm package name owning both artifact faces; the loader requires manifest.package to match it. */
const RESEARCH_CONTROL_PACKAGE = "dsh-research-control";
/** Wire namespace of the Research Control service (`TypertRemoteService` super key). */
const RESEARCH_CONTROL_NAMESPACE = "researchControl";
/**
* Strict codec schema for `PingResult` (zod v4 instance — carries the `_zod`
* brand the loader and the gateway's strict path require).
*/
const PingResultSchema = z.object({
	ok: z.literal(true),
	service: z.literal(RESEARCH_CONTROL_NAMESPACE),
	time: z.number()
});
/**
* The ping invocation descriptor shared by both artifact faces.
*
* `id` follows the generator's invocation-identity grammar
* (`<serviceKey>#<namespace>/<exportedMethod>`,
* checkout packages/typert/generator/src/analyzer.ts:1111). No
* `cancellation`/`sourceLocation`: the spike method takes no parameters
* (DSH_ADAPTER §5 step 4 applies to long-running RPCs, not ping), and a
* hand-written source location would rot — the field is optional in both
* the protocol type and the loader.
*/
const pingInvocation = {
	id: `${RESEARCH_CONTROL_NAMESPACE}#${RESEARCH_CONTROL_NAMESPACE}/ping`,
	service: RESEARCH_CONTROL_NAMESPACE,
	namespace: RESEARCH_CONTROL_NAMESPACE,
	method: "ping",
	invocation: { kind: "direct" },
	parameters: [],
	result: {
		mode: "strict",
		typeSymbol: "PingResult",
		schema: PingResultSchema
	}
};
/** `common.schema.json` epoch-ms carrier (A-3). */
const epochMs = z.number().int().nonnegative();
/** `common.schema.json` id patterns (frozen). */
const idTopic = z.string().regex(/^TPC-[1-9][0-9]*$/);
const idWorkstream = z.string().regex(/^WS-[1-9][0-9]*$/);
const idTask = z.string().regex(/^T-[1-9][0-9]*$/);
const idPlanFork = z.string().regex(/^PF-[1-9][0-9]*$/);
const idIntervention = z.string().regex(/^IV-[1-9][0-9]*$/);
const idInteraction = z.string().regex(/^INT-[1-9][0-9]*$/);
const idManagementAction = z.string().regex(/^MA-[1-9][0-9]*$/);
const fullOid = z.string().regex(/^[0-9a-f]{40}$/);
/**
* V2 project id (frozen `PRJ-[1-9][0-9]*` — the same pattern the T2.3
* registry kernel pins in `PROJECT_ID_PATTERN`; the §12.1 routing key
* and the plane-state project/missing entries).
*/
const idProject = z.string().regex(/^PRJ-[1-9][0-9]*$/);
/**
* V2 workspace path (an absolute path — POSIX `/…`, Windows drive
* `C:\…` / `C:/…`, or UNC `\\…`; the T2.3 registry kernel mirrors the
* same `ABSOLUTE_PATH_PATTERN`: the registry stores exactly these).
*/
const absolutePath = z.string().regex(/^(?:[A-Za-z]:[\\/]|\\|\/)/);
const attentionMode = z.enum([
	"FOCUS",
	"NORMAL",
	"BACKGROUND"
]);
const wsLifecycle = z.enum([
	"PLANNED",
	"REALIZED",
	"DROPPED"
]);
const edgeOp = z.enum(["FORK", "MERGE"]);
const objStatus = z.enum([
	"ACTIVE",
	"ACHIEVED",
	"DROPPED"
]);
const objPriority = z.enum([
	"P0",
	"P1",
	"P2",
	"P3"
]);
const taskExecution = z.enum([
	"PLANNED",
	"ACTIVE",
	"PAUSED",
	"EXECUTED",
	"CANCELLED"
]);
const taskValidation = z.enum([
	"NOT_REQUIRED",
	"PENDING",
	"UNDER_REVIEW",
	"PASSED",
	"FAILED"
]);
const runStatus = z.enum([
	"RUNNING",
	"FINISHED",
	"FAILED",
	"CANCELLED"
]);
const interventionOrigin = z.enum([
	"USER",
	"AGENT_REPORT",
	"AUTO_FLOODING",
	"AUTO_AUDIT"
]);
const ivStatus = z.enum([
	"OPEN",
	"PENDING",
	"CLOSED"
]);
z.enum([
	"OPEN",
	"STALE",
	"SELECTED",
	"DISMISSED"
]);
const planItemKind = z.enum([
	"TASK",
	"GATE",
	"MILESTONE"
]);
const replayOrder = z.enum(["semantic", "audit"]);
const interactionKind = z.enum([
	"MEETING",
	"AD_HOC_DISCUSSION",
	"SUPERVISOR_UPDATE",
	"COLLABORATOR_DISCUSSION",
	"EXPERIMENT_SHIFT_HANDOFF",
	"OTHER"
]);
/** The frozen `actorRef` JSON carrier (common.schema.json $defs/actorRef). */
const actorRefJson = z.object({
	kind: z.string(),
	user_id: z.string().optional(),
	run_id: z.string().optional(),
	session_id: z.string().optional(),
	label: z.string().optional()
}).strict();
/** The frozen `sourceRef` JSON carrier (common.schema.json $defs/sourceRef). */
const sourceRefJson = z.object({
	kind: z.string(),
	session_id: z.string().optional(),
	path: z.string().optional(),
	commit_oid: z.string().optional(),
	interaction_id: z.string().optional(),
	note: z.string().optional()
}).strict();
const InterventionDtoSchema = z.object({
	id: idIntervention,
	title: z.string().min(1),
	origin: interventionOrigin,
	status: ivStatus,
	workstreamIds: z.array(idWorkstream),
	createdAt: epochMs
}).strict();
const ObjectiveDtoSchema = z.object({
	id: z.string().regex(/^OBJ-[1-9][0-9]*$/),
	scope: z.enum(["PROJECT", "TOPIC"]),
	statement: z.string().min(1),
	status: objStatus,
	priority: objPriority,
	targetDate: epochMs.nullable()
}).strict();
const TopicCardDtoSchema = z.object({
	id: idTopic,
	title: z.string().min(1),
	workstreamCount: z.number().int().nonnegative()
}).strict();
const WorkstreamCardDtoSchema = z.object({
	id: idWorkstream,
	title: z.string().min(1),
	lifecycle: wsLifecycle,
	summary: z.string().nullish(),
	planItemCount: z.number().int().nonnegative(),
	openPlanForkCount: z.number().int().nonnegative(),
	runningRunCount: z.number().int().nonnegative()
}).strict();
const TopologyEdgeDtoSchema = z.object({
	id: z.string().regex(/^TE-[1-9][0-9]*$/),
	operation: edgeOp,
	lifecycle: wsLifecycle,
	inputs: z.array(idWorkstream),
	outputs: z.array(idWorkstream),
	note: z.string().nullish()
}).strict();
const MergeContractRefDtoSchema = z.object({
	edgeId: z.string().regex(/^TE-[1-9][0-9]*$/),
	path: z.string().min(1)
}).strict();
const DashboardSnapshotSchema = z.object({
	project: z.object({
		id: z.string().regex(/^PRJ-[1-9][0-9]*$/),
		title: z.string().min(1),
		description: z.string().nullish(),
		importance: z.number().int().nonnegative(),
		attentionMode,
		targetDate: epochMs.nullable()
	}).strict(),
	topics: z.array(TopicCardDtoSchema),
	openInterventions: z.array(InterventionDtoSchema),
	pendingInterventions: z.array(InterventionDtoSchema),
	scheduledEvents: z.null(),
	reportingItems: z.null(),
	inboxCount: z.number().int().nonnegative(),
	attention: z.null()
}).strict();
const ProjectSnapshotSchema = z.object({
	project: z.object({
		id: z.string().regex(/^PRJ-[1-9][0-9]*$/),
		title: z.string().min(1),
		description: z.string().nullish(),
		importance: z.number().int().nonnegative(),
		attentionMode,
		targetDate: epochMs.nullable(),
		currentObjectiveRefs: z.array(z.string().regex(/^OBJ-[1-9][0-9]*$/)),
		createdAt: epochMs
	}).strict(),
	objectives: z.array(ObjectiveDtoSchema),
	topics: z.array(TopicCardDtoSchema),
	upcomingInteractions: z.null(),
	upcomingReporting: z.null()
}).strict();
const GetTopicArgsSchema = z.object({
	topicId: idTopic,
	projectId: idProject.optional()
}).strict();
const TopicSnapshotSchema = z.object({
	topic: z.object({
		id: idTopic,
		title: z.string().min(1),
		description: z.string().nullish(),
		importance: z.number().int().nonnegative().nullish(),
		attentionMode: attentionMode.nullable(),
		objectiveRefs: z.array(z.string().regex(/^OBJ-[1-9][0-9]*$/)),
		createdAt: epochMs
	}).strict(),
	workstreams: z.array(WorkstreamCardDtoSchema),
	topology: z.object({ edges: z.array(TopologyEdgeDtoSchema) }).strict(),
	mergeContracts: z.array(MergeContractRefDtoSchema),
	objectives: z.array(ObjectiveDtoSchema)
}).strict();
const GetWorkstreamArgsSchema = z.object({
	workstreamId: idWorkstream,
	projectId: idProject.optional()
}).strict();
const PlanItemDtoSchema = z.object({
	id: z.union([
		idTask,
		z.string().regex(/^G-[1-9][0-9]*$/),
		z.string().regex(/^M-[1-9][0-9]*$/)
	]),
	kind: planItemKind,
	title: z.string().min(1)
}).strict();
const CurrentTaskDtoSchema = z.object({
	id: idTask,
	title: z.string().min(1),
	execution: taskExecution,
	validation: taskValidation,
	acceptanceCriteria: z.array(z.string()),
	liveRunIds: z.array(z.string().regex(/^R-[1-9][0-9]*$/))
}).strict();
const RunDtoSchema = z.object({
	id: z.string().regex(/^R-[1-9][0-9]*$/),
	status: runStatus,
	taskId: idTask.nullable(),
	intent: z.string().nullish(),
	startedAt: epochMs,
	endedAt: epochMs.nullable(),
	lastCheckpointAt: epochMs.nullable(),
	lastCheckpointNote: z.string().nullish()
}).strict();
const PlanForkDtoSchema = z.object({
	id: idPlanFork,
	status: z.enum(["OPEN", "STALE"]),
	reason: z.string().min(1),
	necessity: z.string().min(1),
	forkAnchor: z.string().min(1),
	mergeAnchor: z.string().min(1),
	createdByRun: z.string().regex(/^R-[1-9][0-9]*$/),
	createdAt: epochMs,
	staleReason: z.string().nullish(),
	proposedItemCount: z.number().int().nonnegative(),
	baseGitCommit: fullOid.nullable()
}).strict();
const WorkstreamSnapshotSchema = z.object({
	workstream: z.object({
		id: idWorkstream,
		topicId: idTopic,
		title: z.string().min(1),
		lifecycle: wsLifecycle,
		summary: z.string().nullish(),
		createdAt: epochMs
	}).strict(),
	history: z.object({ eventCount: z.number().int().nonnegative() }).strict(),
	current: z.object({
		tasks: z.array(CurrentTaskDtoSchema),
		runs: z.array(RunDtoSchema)
	}).strict(),
	future: z.object({
		plan: z.object({ orderedItems: z.array(PlanItemDtoSchema) }).strict(),
		planForks: z.array(PlanForkDtoSchema),
		unresolvedPlanForkCount: z.number().int().nonnegative()
	}).strict()
}).strict();
const QueryHistoryArgsSchema = z.object({
	workstreamId: idWorkstream,
	order: replayOrder.optional(),
	afterSeq: z.number().int().nonnegative().optional(),
	beforeSeq: z.number().int().positive().optional(),
	limit: z.number().int().positive().optional(),
	projectId: idProject.optional()
}).strict();
const HistoryEventDtoSchema = z.object({
	eventId: z.string().regex(/^H-[1-9][0-9]*$/),
	ownerWorkstreamId: idWorkstream,
	eventType: z.string().min(1),
	schemaVersion: z.number().int().positive(),
	occurredAt: epochMs,
	actor: actorRefJson,
	source: sourceRefJson.nullable(),
	payload: z.record(z.string(), z.unknown()),
	eventSeq: z.number().int().positive(),
	recordedAt: epochMs
}).strict();
const QueryHistoryResultSchema = z.object({
	events: z.array(HistoryEventDtoSchema),
	nextAfterSeq: z.number().int().nonnegative().nullable(),
	exhausted: z.boolean()
}).strict();
const ReorderPlanArgsSchema = z.object({
	workstreamId: idWorkstream,
	orderedItemIds: z.array(z.string().min(1)),
	projectId: idProject.optional()
}).strict();
const ReorderPlanResultSchema = z.object({
	workstreamId: idWorkstream,
	orderedItemIds: z.array(z.string().min(1)),
	planPath: z.string().min(1),
	managementActionId: idManagementAction
}).strict();
const SelectPlanForkArgsSchema = z.object({
	planForkId: idPlanFork,
	projectId: idProject.optional()
}).strict();
const SelectPlanForkResultSchema = z.object({
	planForkId: idPlanFork,
	workstreamId: idWorkstream,
	statusBefore: z.literal("OPEN"),
	statusAfter: z.literal("SELECTED"),
	selectedAt: epochMs,
	oldOrder: z.array(z.string().min(1)),
	newOrder: z.array(z.string().min(1)),
	/** Materialized NEW items (empty for a reorder-only proposal). */
	newItems: z.array(z.object({
		id: z.string().min(1),
		kind: planItemKind,
		path: z.string().min(1)
	}).strict()),
	removedIds: z.array(z.string().min(1)),
	/** Always present (an empty array when nothing else went stale). */
	staleOthers: z.array(z.object({
		planForkId: idPlanFork,
		staleReason: z.string().min(1)
	}).strict()),
	planYamlPath: z.string().min(1),
	checkpointHint: z.string().min(1)
}).strict();
const DismissPlanForkArgsSchema = z.object({
	planForkId: idPlanFork,
	projectId: idProject.optional()
}).strict();
const DismissPlanForkResultSchema = z.object({
	planForkId: idPlanFork,
	workstreamId: idWorkstream,
	statusBefore: z.enum(["OPEN", "STALE"]),
	statusAfter: z.literal("DISMISSED"),
	dismissedAt: epochMs
}).strict();
const UpdateInterventionStateArgsSchema = z.object({
	interventionId: idIntervention,
	status: ivStatus,
	resolutionNote: z.string().optional(),
	projectId: idProject.optional()
}).strict();
const UpdateInterventionStateResultSchema = z.object({
	interventionId: idIntervention,
	statusFrom: ivStatus,
	statusTo: ivStatus,
	closedAt: epochMs.nullable(),
	resolutionNote: z.string().nullish()
}).strict();
const RegisterInteractionArgsSchema = z.object({
	kind: interactionKind,
	title: z.string().min(1),
	occurredAt: epochMs,
	participants: z.array(z.string().min(1)).optional(),
	notes: z.string().optional(),
	relatedWorkstreams: z.array(idWorkstream).optional(),
	projectId: idProject.optional()
}).strict();
const RegisterInteractionResultSchema = z.object({
	id: idInteraction,
	kind: interactionKind,
	title: z.string().min(1),
	occurredAt: epochMs,
	participants: z.array(z.string().min(1)),
	notes: z.string().nullish(),
	relatedWorkstreams: z.array(idWorkstream),
	createdAt: epochMs
}).strict();
const SaveResearchCheckpointArgsSchema = z.object({
	summary: z.string().min(1),
	projectId: idProject.optional()
}).strict();
const SaveResearchCheckpointResultSchema = z.object({
	committed: z.boolean(),
	commitOid: fullOid.nullable(),
	changedFiles: z.array(z.string().min(1)),
	warnings: z.array(z.string()),
	message: z.string().nullish()
}).strict();
const GetGitHistoryArgsSchema = z.object({
	path: z.string().min(1).optional(),
	baseline: fullOid.optional(),
	maxCount: z.number().int().positive().max(1e3).optional(),
	skip: z.number().int().nonnegative().optional(),
	projectId: idProject.optional()
}).strict();
const GitVersionDtoSchema = z.object({
	oid: fullOid,
	authorDate: z.string().min(1),
	subject: z.string()
}).strict();
const GitDiffEntryDtoSchema = z.object({
	status: z.string().min(1),
	path: z.string().min(1),
	oldPath: z.string().nullish()
}).strict();
const GetGitHistoryResultSchema = z.object({
	versions: z.array(GitVersionDtoSchema),
	fileDiff: z.array(GitDiffEntryDtoSchema).nullable(),
	baseline: fullOid.nullable(),
	pathContent: z.object({
		path: z.string().min(1),
		sameAsBaseline: z.boolean()
	}).strict().nullable()
}).strict();
const RestoreDeclarativeFileArgsSchema = z.object({
	commitOid: fullOid,
	path: z.string().min(1),
	projectId: idProject.optional()
}).strict();
const RestoreDeclarativeFileResultSchema = z.object({
	path: z.string().min(1),
	commitOid: fullOid,
	validationOk: z.boolean(),
	/** Always present (empty when the restored file validates). */
	validationErrors: z.array(z.object({
		file: z.string(),
		path: z.string().nullish(),
		summary: z.string()
	}).strict()),
	warnings: z.array(z.string())
}).strict();
function argsParameter(argsSymbol, schema) {
	return {
		name: "args",
		wire: "args",
		source: "json",
		codec: {
			mode: "strict",
			typeSymbol: argsSymbol,
			schema
		}
	};
}
function descriptor(method, parameters, resultSymbol, resultSchema) {
	return {
		id: `${RESEARCH_CONTROL_NAMESPACE}#${RESEARCH_CONTROL_NAMESPACE}/${method}`,
		service: RESEARCH_CONTROL_NAMESPACE,
		namespace: RESEARCH_CONTROL_NAMESPACE,
		method,
		invocation: { kind: "direct" },
		parameters,
		result: {
			mode: "strict",
			typeSymbol: resultSymbol,
			schema: resultSchema
		}
	};
}
/**
* The FULL invocation list of the FROZEN face (ping first — the WP-0.3
* diagnostic method stays the 14th — then the 13 §7.1 RPCs). This list is
* FROZEN: it names the V1 face exactly as ARCHITECTURE.md §7.1 froze it.
* V2-T3.2a: the artifact faces register the SUPERSET {@link
* REGISTERED_RESEARCH_INVOCATIONS} (frozen 14 + the 3 read-only plane
* RPCs) — the frozen 14 itself stays byte-identical.
*/
const ALL_RESEARCH_INVOCATIONS = [pingInvocation, ...[
	descriptor("getDashboard", [], "DashboardSnapshot", DashboardSnapshotSchema),
	descriptor("getProject", [], "ProjectSnapshot", ProjectSnapshotSchema),
	descriptor("getTopic", [argsParameter("GetTopicArgs", GetTopicArgsSchema)], "TopicSnapshot", TopicSnapshotSchema),
	descriptor("getWorkstream", [argsParameter("GetWorkstreamArgs", GetWorkstreamArgsSchema)], "WorkstreamSnapshot", WorkstreamSnapshotSchema),
	descriptor("queryHistory", [argsParameter("QueryHistoryArgs", QueryHistoryArgsSchema)], "QueryHistoryResult", QueryHistoryResultSchema),
	descriptor("reorderPlan", [argsParameter("ReorderPlanArgs", ReorderPlanArgsSchema)], "ReorderPlanResult", ReorderPlanResultSchema),
	descriptor("selectPlanFork", [argsParameter("SelectPlanForkArgs", SelectPlanForkArgsSchema)], "SelectPlanForkResult", SelectPlanForkResultSchema),
	descriptor("dismissPlanFork", [argsParameter("DismissPlanForkArgs", DismissPlanForkArgsSchema)], "DismissPlanForkResult", DismissPlanForkResultSchema),
	descriptor("updateInterventionState", [argsParameter("UpdateInterventionStateArgs", UpdateInterventionStateArgsSchema)], "UpdateInterventionStateResult", UpdateInterventionStateResultSchema),
	descriptor("registerInteraction", [argsParameter("RegisterInteractionArgs", RegisterInteractionArgsSchema)], "RegisterInteractionResult", RegisterInteractionResultSchema),
	descriptor("saveResearchCheckpoint", [argsParameter("SaveResearchCheckpointArgs", SaveResearchCheckpointArgsSchema)], "SaveResearchCheckpointResult", SaveResearchCheckpointResultSchema),
	descriptor("getGitHistory", [argsParameter("GetGitHistoryArgs", GetGitHistoryArgsSchema)], "GetGitHistoryResult", GetGitHistoryResultSchema),
	descriptor("restoreDeclarativeFile", [argsParameter("RestoreDeclarativeFileArgs", RestoreDeclarativeFileArgsSchema)], "RestoreDeclarativeFileResult", RestoreDeclarativeFileResultSchema)
]];
/**
* A plane-operation rejection (the design §12 拒绝分支). Thrown by the
* T3.2 implementation; the message is self-contained AND carries the
* code — it rides verbatim into the gateway's `{ ok: false, error }`
* fold, where the `PLANE_*` token is the client's machine-matchable
* rejection key (the client has no structured error channel).
*/
var PlaneError = class extends Error {
	code;
	constructor(code, detail) {
		super(`[research-control] ${code}: ${detail}`);
		this.name = "PlaneError";
		this.code = code;
	}
};
const PlaneProjectDtoSchema = z.object({
	projectId: idProject,
	displayName: z.string(),
	kind: z.enum(["MANAGED", "STANDALONE"]),
	wsPath: absolutePath
}).strict();
const PlaneMissingDtoSchema = z.object({
	projectId: idProject,
	displayName: z.string(),
	wsPath: absolutePath,
	deferred: z.boolean()
}).strict();
const RegistryEntryDtoSchema = z.object({
	id: idProject,
	path: absolutePath,
	displayName: z.string(),
	status: z.enum(["active", "archived"]),
	boundAt: epochMs,
	archivedAt: epochMs.nullable()
}).strict();
const PlaneStateSummarySchema = z.object({
	hub: z.object({ path: z.string().min(1) }).strict().nullable(),
	dirNames: z.object({
		treeDir: z.string().min(1),
		hubDir: z.string().min(1)
	}).strict(),
	projects: z.array(PlaneProjectDtoSchema),
	missing: z.array(PlaneMissingDtoSchema),
	registry: z.array(RegistryEntryDtoSchema)
}).strict();
const PlaneSessionDtoSchema = z.object({
	cwd: z.string().nullable(),
	role: z.enum([
		"HUB",
		"MANAGED",
		"STANDALONE",
		"UNREGISTERED",
		"NO_CWD"
	]),
	hubTreeProjectId: idProject.nullable().optional()
}).strict();
const GetResearchPlaneStateArgsSchema = z.object({ sessionId: z.string().min(1).optional() }).strict();
const GetResearchPlaneStateResultSchema = z.object({
	hub: z.object({ path: z.string().min(1) }).strict().nullable(),
	dirNames: z.object({
		treeDir: z.string().min(1),
		hubDir: z.string().min(1)
	}).strict(),
	projects: z.array(PlaneProjectDtoSchema),
	missing: z.array(PlaneMissingDtoSchema),
	registry: z.array(RegistryEntryDtoSchema),
	session: PlaneSessionDtoSchema.nullable()
}).strict();
const GetHubOverviewArgsSchema = z.object({}).strict();
const HubOverviewResultSchema = z.object({
	totals: z.object({
		projects: z.number().int().nonnegative(),
		openInterventions: z.number().int().nonnegative(),
		inbox: z.number().int().nonnegative()
	}).strict(),
	attention: z.array(z.object({
		projectId: idProject,
		displayName: z.string(),
		/** Positive: an attention row without open interventions is never emitted (the host renders the row only when non-empty). */
		openCount: z.number().int().positive(),
		oldestHours: z.number().nonnegative()
	}).strict()),
	cards: z.array(z.object({
		projectId: idProject,
		displayName: z.string(),
		title: z.string().min(1),
		description: z.string().nullable(),
		attentionMode,
		targetDate: epochMs.nullable(),
		openInterventions: z.number().int().nonnegative(),
		pendingInterventions: z.number().int().nonnegative(),
		topics: z.number().int().nonnegative(),
		inboxCount: z.number().int().nonnegative()
	}).strict())
}).strict();
const GetPortfolioInterventionsArgsSchema = z.object({ status: ivStatus.optional() }).strict();
const PortfolioInterventionItemDtoSchema = z.object({
	projectId: idProject,
	displayName: z.string(),
	id: idIntervention,
	title: z.string().min(1),
	origin: interventionOrigin,
	status: ivStatus,
	workstreamIds: z.array(idWorkstream),
	createdAt: epochMs
}).strict();
const GetPortfolioInterventionsResultSchema = z.object({ items: z.array(PortfolioInterventionItemDtoSchema) }).strict();
const SetHubArgsSchema = z.object({ wsPath: absolutePath }).strict();
const SetHubResultSchema = z.object({
	hubPath: z.string().min(1),
	registryPath: z.string().min(1)
}).strict();
const BindProjectArgsSchema = z.object({
	wsPath: absolutePath,
	displayName: z.string().min(1).optional(),
	scaffold: z.boolean().optional()
}).strict();
const BindProjectResultSchema = z.object({
	projectId: idProject,
	registryPath: z.string().min(1).nullable(),
	dbMigrated: z.boolean()
}).strict();
const UnbindProjectArgsSchema = z.object({ wsPath: absolutePath }).strict();
const UnbindProjectResultSchema = z.object({
	projectId: idProject,
	archivedDir: z.string().min(1)
}).strict();
const RestoreProjectArgsSchema = z.object({ projectId: idProject }).strict();
const RestoreProjectResultSchema = z.object({ wsPath: z.string().min(1) }).strict();
const RescanArgsSchema = z.object({}).strict();
const RescanResultSchema = PlaneStateSummarySchema;
const AckMissingReminderArgsSchema = z.object({ projectId: idProject }).strict();
const AckMissingReminderResultSchema = z.object({ acknowledged: z.literal(true) }).strict();
const getResearchPlaneStateInvocation = descriptor("getResearchPlaneState", [argsParameter("GetResearchPlaneStateArgs", GetResearchPlaneStateArgsSchema)], "GetResearchPlaneStateResult", GetResearchPlaneStateResultSchema);
const getHubOverviewInvocation = descriptor("getHubOverview", [argsParameter("GetHubOverviewArgs", GetHubOverviewArgsSchema)], "HubOverviewResult", HubOverviewResultSchema);
const getPortfolioInterventionsInvocation = descriptor("getPortfolioInterventions", [argsParameter("GetPortfolioInterventionsArgs", GetPortfolioInterventionsArgsSchema)], "GetPortfolioInterventionsResult", GetPortfolioInterventionsResultSchema);
const setHubInvocation = descriptor("setHub", [argsParameter("SetHubArgs", SetHubArgsSchema)], "SetHubResult", SetHubResultSchema);
const bindProjectInvocation = descriptor("bindProject", [argsParameter("BindProjectArgs", BindProjectArgsSchema)], "BindProjectResult", BindProjectResultSchema);
const unbindProjectInvocation = descriptor("unbindProject", [argsParameter("UnbindProjectArgs", UnbindProjectArgsSchema)], "UnbindProjectResult", UnbindProjectResultSchema);
const restoreProjectInvocation = descriptor("restoreProject", [argsParameter("RestoreProjectArgs", RestoreProjectArgsSchema)], "RestoreProjectResult", RestoreProjectResultSchema);
const rescanInvocation = descriptor("rescan", [argsParameter("RescanArgs", RescanArgsSchema)], "RescanResult", RescanResultSchema);
const ackMissingReminderInvocation = descriptor("ackMissingReminder", [argsParameter("AckMissingReminderArgs", AckMissingReminderArgsSchema)], "AckMissingReminderResult", AckMissingReminderResultSchema);
/**
* V2-T3.2a — the REGISTERED invocation face of both artifact halves
* (host `./typert` + client `./remote`): the frozen 14 ({@link
* ALL_RESEARCH_INVOCATIONS}) + the 3 READ-ONLY plane RPCs (design §12
* rows 1-3) whose `@Remote` method bodies and artifact registration land
* this task. Both faces must expose EXACTLY this set (the WP-0.3
* no-drift-by-construction rule).
*
* Registration-face evidence (for the T6.3 README update): the frozen
* doc names 13 RPCs; design §12 adds 9 — the full V2 business face is
* 22 RPCs (23 with ping). T3.2a registers 13 + 3 = 16 business RPCs
* (17 with ping); T3.2b registers the 6 change-family plane RPCs
* (setHub / bindProject / unbindProject / restoreProject / rescan /
* ackMissingReminder) — the FULL V2 business face, 22 RPCs (23 with
* ping) — the descriptors above land in this face with their @Remote
* bodies (registering a descriptor without its method would break the
* gateway dispatch).
*/
const REGISTERED_RESEARCH_INVOCATIONS = [
	...ALL_RESEARCH_INVOCATIONS,
	getResearchPlaneStateInvocation,
	getHubOverviewInvocation,
	getPortfolioInterventionsInvocation,
	setHubInvocation,
	bindProjectInvocation,
	unbindProjectInvocation,
	restoreProjectInvocation,
	rescanInvocation,
	ackMissingReminderInvocation
];
//#endregion
export { RescanResultSchema as A, SetHubResultSchema as B, REGISTERED_RESEARCH_INVOCATIONS as C, ReorderPlanArgsSchema as D, RegisterInteractionResultSchema as E, SaveResearchCheckpointArgsSchema as F, UpdateInterventionStateResultSchema as G, UnbindProjectArgsSchema as H, SaveResearchCheckpointResultSchema as I, WorkstreamSnapshotSchema as K, SelectPlanForkArgsSchema as L, RestoreDeclarativeFileResultSchema as M, RestoreProjectArgsSchema as N, ReorderPlanResultSchema as O, RestoreProjectResultSchema as P, SelectPlanForkResultSchema as R, QueryHistoryResultSchema as S, RegisterInteractionArgsSchema as T, UnbindProjectResultSchema as U, TopicSnapshotSchema as V, UpdateInterventionStateArgsSchema as W, HubOverviewResultSchema as _, DashboardSnapshotSchema as a, ProjectSnapshotSchema as b, GetGitHistoryArgsSchema as c, GetPortfolioInterventionsArgsSchema as d, GetPortfolioInterventionsResultSchema as f, GetWorkstreamArgsSchema as g, GetTopicArgsSchema as h, BindProjectResultSchema as i, RestoreDeclarativeFileArgsSchema as j, RescanArgsSchema as k, GetGitHistoryResultSchema as l, GetResearchPlaneStateResultSchema as m, AckMissingReminderResultSchema as n, DismissPlanForkArgsSchema as o, GetResearchPlaneStateArgsSchema as p, BindProjectArgsSchema as r, DismissPlanForkResultSchema as s, AckMissingReminderArgsSchema as t, GetHubOverviewArgsSchema as u, PingResultSchema as v, RESEARCH_CONTROL_PACKAGE as w, QueryHistoryArgsSchema as x, PlaneError as y, SetHubArgsSchema as z };
