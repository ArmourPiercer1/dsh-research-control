import { $ as SetHubArgsSchema, A as PingResultSchema, B as ReorderPlanResultSchema, C as GetResearchPlaneStateArgsSchema, D as HubOverviewResultSchema, E as GetWorkstreamArgsSchema, F as REGISTERED_RESEARCH_INVOCATIONS, G as RestoreProjectArgsSchema, H as RescanResultSchema, I as RESEARCH_CONTROL_PACKAGE, J as SaveResearchCheckpointResultSchema, K as RestoreProjectResultSchema, L as RegisterInteractionArgsSchema, M as ProjectSnapshotSchema, N as QueryHistoryArgsSchema, O as InspectProjectDirectoryArgsSchema, P as QueryHistoryResultSchema, Q as SetCurrentFocusResultSchema, R as RegisterInteractionResultSchema, S as GetPortfolioInterventionsResultSchema, T as GetTopicArgsSchema, U as RestoreDeclarativeFileArgsSchema, V as RescanArgsSchema, W as RestoreDeclarativeFileResultSchema, X as SelectPlanForkResultSchema, Y as SelectPlanForkArgsSchema, Z as SetCurrentFocusArgsSchema, _ as GetCurrentFocusResultSchema, a as CreateLocalResearchProjectArgsSchema, at as UpdateInterventionStateResultSchema, b as GetHubOverviewArgsSchema, c as CreateTopicResultSchema, ct as UpdateTopicArgsSchema, d as DashboardSnapshotSchema, dt as UpdateWorkstreamResultSchema, et as SetHubResultSchema, f as DismissPlanForkArgsSchema, ft as WorkstreamSnapshotSchema, g as GetCurrentFocusArgsSchema, h as DropWorkstreamResultSchema, i as BindProjectResultSchema, it as UpdateInterventionStateArgsSchema, k as InspectProjectDirectoryResultSchema, l as CreateWorkstreamArgsSchema, lt as UpdateTopicResultSchema, m as DropWorkstreamArgsSchema, n as AckMissingReminderResultSchema, nt as UnbindProjectArgsSchema, o as CreateLocalResearchProjectResultSchema, ot as UpdateProjectMetadataArgsSchema, p as DismissPlanForkResultSchema, q as SaveResearchCheckpointArgsSchema, r as BindProjectArgsSchema, rt as UnbindProjectResultSchema, s as CreateTopicArgsSchema, st as UpdateProjectMetadataResultSchema, t as AckMissingReminderArgsSchema, tt as TopicSnapshotSchema, u as CreateWorkstreamResultSchema, ut as UpdateWorkstreamArgsSchema, v as GetGitHistoryArgsSchema, w as GetResearchPlaneStateResultSchema, x as GetPortfolioInterventionsArgsSchema, y as GetGitHistoryResultSchema, z as ReorderPlanArgsSchema } from "./rpc-contracts-CVznR3Ti.js";
const TYPERT = {
	package: RESEARCH_CONTROL_PACKAGE,
	face: "host",
	schemas: [
		{
			name: "PingResult",
			schema: PingResultSchema
		},
		{
			name: "DashboardSnapshot",
			schema: DashboardSnapshotSchema
		},
		{
			name: "ProjectSnapshot",
			schema: ProjectSnapshotSchema
		},
		{
			name: "GetTopicArgs",
			schema: GetTopicArgsSchema
		},
		{
			name: "TopicSnapshot",
			schema: TopicSnapshotSchema
		},
		{
			name: "GetWorkstreamArgs",
			schema: GetWorkstreamArgsSchema
		},
		{
			name: "WorkstreamSnapshot",
			schema: WorkstreamSnapshotSchema
		},
		{
			name: "QueryHistoryArgs",
			schema: QueryHistoryArgsSchema
		},
		{
			name: "QueryHistoryResult",
			schema: QueryHistoryResultSchema
		},
		{
			name: "ReorderPlanArgs",
			schema: ReorderPlanArgsSchema
		},
		{
			name: "ReorderPlanResult",
			schema: ReorderPlanResultSchema
		},
		{
			name: "SelectPlanForkArgs",
			schema: SelectPlanForkArgsSchema
		},
		{
			name: "SelectPlanForkResult",
			schema: SelectPlanForkResultSchema
		},
		{
			name: "DismissPlanForkArgs",
			schema: DismissPlanForkArgsSchema
		},
		{
			name: "DismissPlanForkResult",
			schema: DismissPlanForkResultSchema
		},
		{
			name: "UpdateInterventionStateArgs",
			schema: UpdateInterventionStateArgsSchema
		},
		{
			name: "UpdateInterventionStateResult",
			schema: UpdateInterventionStateResultSchema
		},
		{
			name: "RegisterInteractionArgs",
			schema: RegisterInteractionArgsSchema
		},
		{
			name: "RegisterInteractionResult",
			schema: RegisterInteractionResultSchema
		},
		{
			name: "SaveResearchCheckpointArgs",
			schema: SaveResearchCheckpointArgsSchema
		},
		{
			name: "SaveResearchCheckpointResult",
			schema: SaveResearchCheckpointResultSchema
		},
		{
			name: "GetGitHistoryArgs",
			schema: GetGitHistoryArgsSchema
		},
		{
			name: "GetGitHistoryResult",
			schema: GetGitHistoryResultSchema
		},
		{
			name: "RestoreDeclarativeFileArgs",
			schema: RestoreDeclarativeFileArgsSchema
		},
		{
			name: "RestoreDeclarativeFileResult",
			schema: RestoreDeclarativeFileResultSchema
		},
		{
			name: "GetResearchPlaneStateArgs",
			schema: GetResearchPlaneStateArgsSchema
		},
		{
			name: "GetResearchPlaneStateResult",
			schema: GetResearchPlaneStateResultSchema
		},
		{
			name: "GetHubOverviewArgs",
			schema: GetHubOverviewArgsSchema
		},
		{
			name: "HubOverviewResult",
			schema: HubOverviewResultSchema
		},
		{
			name: "GetPortfolioInterventionsArgs",
			schema: GetPortfolioInterventionsArgsSchema
		},
		{
			name: "GetPortfolioInterventionsResult",
			schema: GetPortfolioInterventionsResultSchema
		},
		{
			name: "SetHubArgs",
			schema: SetHubArgsSchema
		},
		{
			name: "SetHubResult",
			schema: SetHubResultSchema
		},
		{
			name: "BindProjectArgs",
			schema: BindProjectArgsSchema
		},
		{
			name: "BindProjectResult",
			schema: BindProjectResultSchema
		},
		{
			name: "UnbindProjectArgs",
			schema: UnbindProjectArgsSchema
		},
		{
			name: "UnbindProjectResult",
			schema: UnbindProjectResultSchema
		},
		{
			name: "RestoreProjectArgs",
			schema: RestoreProjectArgsSchema
		},
		{
			name: "RestoreProjectResult",
			schema: RestoreProjectResultSchema
		},
		{
			name: "RescanArgs",
			schema: RescanArgsSchema
		},
		{
			name: "RescanResult",
			schema: RescanResultSchema
		},
		{
			name: "AckMissingReminderArgs",
			schema: AckMissingReminderArgsSchema
		},
		{
			name: "AckMissingReminderResult",
			schema: AckMissingReminderResultSchema
		},
		{
			name: "SetCurrentFocusArgs",
			schema: SetCurrentFocusArgsSchema
		},
		{
			name: "SetCurrentFocusResult",
			schema: SetCurrentFocusResultSchema
		},
		{
			name: "GetCurrentFocusArgs",
			schema: GetCurrentFocusArgsSchema
		},
		{
			name: "GetCurrentFocusResult",
			schema: GetCurrentFocusResultSchema
		},
		{
			name: "CreateTopicArgs",
			schema: CreateTopicArgsSchema
		},
		{
			name: "CreateTopicResult",
			schema: CreateTopicResultSchema
		},
		{
			name: "CreateWorkstreamArgs",
			schema: CreateWorkstreamArgsSchema
		},
		{
			name: "CreateWorkstreamResult",
			schema: CreateWorkstreamResultSchema
		},
		{
			name: "UpdateProjectMetadataArgs",
			schema: UpdateProjectMetadataArgsSchema
		},
		{
			name: "UpdateProjectMetadataResult",
			schema: UpdateProjectMetadataResultSchema
		},
		{
			name: "UpdateTopicArgs",
			schema: UpdateTopicArgsSchema
		},
		{
			name: "UpdateTopicResult",
			schema: UpdateTopicResultSchema
		},
		{
			name: "UpdateWorkstreamArgs",
			schema: UpdateWorkstreamArgsSchema
		},
		{
			name: "UpdateWorkstreamResult",
			schema: UpdateWorkstreamResultSchema
		},
		{
			name: "DropWorkstreamArgs",
			schema: DropWorkstreamArgsSchema
		},
		{
			name: "DropWorkstreamResult",
			schema: DropWorkstreamResultSchema
		},
		{
			name: "InspectProjectDirectoryArgs",
			schema: InspectProjectDirectoryArgsSchema
		},
		{
			name: "InspectProjectDirectoryResult",
			schema: InspectProjectDirectoryResultSchema
		},
		{
			name: "CreateLocalResearchProjectArgs",
			schema: CreateLocalResearchProjectArgsSchema
		},
		{
			name: "CreateLocalResearchProjectResult",
			schema: CreateLocalResearchProjectResultSchema
		}
	],
	invocations: REGISTERED_RESEARCH_INVOCATIONS,
	model: {
		services: [{
			key: "researchControl",
			exportName: "ResearchControlService",
			description: "Research Control Plane host service (WP-4.1a: the 13-RPC client face of ARCHITECTURE §7.1 + the WP-0.3 ping diagnostic; V2-T3.2a: the 3 read-only plane RPCs of design §12 rows 1-3; V2-T3.2b: the 6 change-family plane RPCs of design §12 rows 4-6/8/9 — the 23-endpoint registered face).",
			tags: [],
			members: [
				{
					name: "ping",
					signature: "ping(): Promise<PingResult>",
					kind: "method",
					summary: "WP-0.3 liveness round-trip marker (diagnostic only)."
				},
				{
					name: "getDashboard",
					signature: "getDashboard(): Promise<DashboardSnapshot>",
					kind: "method",
					summary: "Home/Portfolio dashboard minimal snapshot (plan §27.1)."
				},
				{
					name: "getProject",
					signature: "getProject(): Promise<ProjectSnapshot>",
					kind: "method",
					summary: "Project page minimal snapshot (plan §27.2)."
				},
				{
					name: "getTopic",
					signature: "getTopic(args: GetTopicArgs): Promise<TopicSnapshot>",
					kind: "method",
					summary: "Topic page minimal snapshot (plan §27.3)."
				},
				{
					name: "getWorkstream",
					signature: "getWorkstream(args: GetWorkstreamArgs): Promise<WorkstreamSnapshot>",
					kind: "method",
					summary: "Workstream 核心三区 minimal snapshot (plan §27.4)."
				},
				{
					name: "queryHistory",
					signature: "queryHistory(args: QueryHistoryArgs): Promise<QueryHistoryResult>",
					kind: "method",
					summary: "History page with seq-cursor pagination (replay query face)."
				},
				{
					name: "reorderPlan",
					signature: "reorderPlan(args: ReorderPlanArgs): Promise<ReorderPlanResult>",
					kind: "method",
					summary: "USER: canonical plan reorder (same item set, new order)."
				},
				{
					name: "selectPlanFork",
					signature: "selectPlanFork(args: SelectPlanForkArgs): Promise<SelectPlanForkResult>",
					kind: "method",
					summary: "USER: SELECT an OPEN PlanFork (§6 materialization)."
				},
				{
					name: "dismissPlanFork",
					signature: "dismissPlanFork(args: DismissPlanForkArgs): Promise<DismissPlanForkResult>",
					kind: "method",
					summary: "USER: DISMISS an OPEN/STALE PlanFork (§7)."
				},
				{
					name: "updateInterventionState",
					signature: "updateInterventionState(args: UpdateInterventionStateArgs): Promise<UpdateInterventionStateResult>",
					kind: "method",
					summary: "USER: Intervention OPEN/PENDING/CLOSED (§13 state machine)."
				},
				{
					name: "registerInteraction",
					signature: "registerInteraction(args: RegisterInteractionArgs): Promise<RegisterInteractionResult>",
					kind: "method",
					summary: "USER: 登记 Interaction (DOMAIN_SCHEMA §10.1) — production storage lands in PHASE 5 (WP-5.3); the wire contract and port seam are frozen."
				},
				{
					name: "saveResearchCheckpoint",
					signature: "saveResearchCheckpoint(args: SaveResearchCheckpointArgs): Promise<SaveResearchCheckpointResult>",
					kind: "method",
					summary: "USER: explicit git checkpoint of .research/** (INV-GIT-2/3)."
				},
				{
					name: "getGitHistory",
					signature: "getGitHistory(args: GetGitHistoryArgs): Promise<GetGitHistoryResult>",
					kind: "method",
					summary: "Read-only .research/** git log + baseline diff face (W6/W5)."
				},
				{
					name: "restoreDeclarativeFile",
					signature: "restoreDeclarativeFile(args: RestoreDeclarativeFileArgs): Promise<RestoreDeclarativeFileResult>",
					kind: "method",
					summary: "USER: explicit restore of one .research file (INV-GIT-5)."
				},
				{
					name: "getResearchPlaneState",
					signature: "getResearchPlaneState(args: GetResearchPlaneStateArgs): Promise<GetResearchPlaneStateResult>",
					kind: "method",
					summary: "Plane state + caller-session role (design §5 标签页分流 + 设置页① 数据源)."
				},
				{
					name: "getHubOverview",
					signature: "getHubOverview(args: GetHubOverviewArgs): Promise<HubOverviewResult>",
					kind: "method",
					summary: "Cross-project aggregation: 聚合条 + 需关注行 + 项目卡墙 (design §7.1)."
				},
				{
					name: "getPortfolioInterventions",
					signature: "getPortfolioInterventions(args: GetPortfolioInterventionsArgs): Promise<GetPortfolioInterventionsResult>",
					kind: "method",
					summary: "Cross-project intervention list, projectId-labeled, 状态过滤 (design §7.2)."
				},
				{
					name: "setHub",
					signature: "setHub(args: SetHubArgs): Promise<SetHubResult>",
					kind: "method",
					summary: "Plane-level: mark a registered workspace as the hub (design §8 设为中枢)."
				},
				{
					name: "bindProject",
					signature: "bindProject(args: BindProjectArgs): Promise<BindProjectResult>",
					kind: "method",
					summary: "Plane-level: bind (接入) a standalone workspace into the plane; migrates a standalone db (design §8/§9)."
				},
				{
					name: "unbindProject",
					signature: "unbindProject(args: UnbindProjectArgs): Promise<UnbindProjectResult>",
					kind: "method",
					summary: "Plane-level: unbind (解除绑定) a project; archives its tree for later restore (design §8)."
				},
				{
					name: "restoreProject",
					signature: "restoreProject(args: RestoreProjectArgs): Promise<RestoreProjectResult>",
					kind: "method",
					summary: "Plane-level: restore (恢复登记) an archived project back into the plane (design §8)."
				},
				{
					name: "rescan",
					signature: "rescan(args: RescanArgs): Promise<RescanResult>",
					kind: "method",
					summary: "Plane-level: re-run discovery (重新扫描) and return the fresh plane state (design §4/§7.1)."
				},
				{
					name: "ackMissingReminder",
					signature: "ackMissingReminder(args: AckMissingReminderArgs): Promise<AckMissingReminderResult>",
					kind: "method",
					summary: "Plane-level: acknowledge a MISSING-project reminder (design §4/§7.1)."
				},
				{
					name: "setCurrentFocus",
					signature: "setCurrentFocus(args: SetCurrentFocusArgs): Promise<SetCurrentFocusResult>",
					kind: "method",
					summary: "GUI management (UI-0.4 / R-01): point the workstream current-focus pointer at a canonical Plan member."
				},
				{
					name: "getCurrentFocus",
					signature: "getCurrentFocus(args: GetCurrentFocusArgs): Promise<GetCurrentFocusResult>",
					kind: "method",
					summary: "GUI management (UI-0.4 / R-01): read back the workstream current-focus pointer (null when absent)."
				},
				{
					name: "createTopic",
					signature: "createTopic(args: CreateTopicArgs): Promise<CreateTopicResult>",
					kind: "method",
					summary: "GUI management (V2-UI-0.4 Task 3): create a new Topic in the routed project (allocates the next TPC-<n>; writes the minimal topic.yaml)."
				},
				{
					name: "createWorkstream",
					signature: "createWorkstream(args: CreateWorkstreamArgs): Promise<CreateWorkstreamResult>",
					kind: "method",
					summary: "GUI management (V2-UI-0.4 Task 3): create a new Workstream under an existing topic (allocates the next WS-<n> project-wide; writes the minimal workstream.yaml)."
				},
				{
					name: "updateProjectMetadata",
					signature: "updateProjectMetadata(args: UpdateProjectMetadataArgs): Promise<UpdateProjectMetadataResult>",
					kind: "method",
					summary: "GUI management (V2-UI-0.4 UI-2): rewrite the provided project metadata fields (title / description / importance / attention mode / target date) of the routed project (read-modify-write; untouched fields stay byte-identical)."
				},
				{
					name: "updateTopic",
					signature: "updateTopic(args: UpdateTopicArgs): Promise<UpdateTopicResult>",
					kind: "method",
					summary: "GUI management (V2-UI-0.4 UI-2): update a topic title / description / importance / attention mode in the routed project (read-modify-write)."
				},
				{
					name: "updateWorkstream",
					signature: "updateWorkstream(args: UpdateWorkstreamArgs): Promise<UpdateWorkstreamResult>",
					kind: "method",
					summary: "GUI management (V2-UI-0.4 UI-2): update a workstream title / summary in the routed project (read-modify-write)."
				},
				{
					name: "dropWorkstream",
					signature: "dropWorkstream(args: DropWorkstreamArgs): Promise<DropWorkstreamResult>",
					kind: "method",
					summary: "GUI management (V2-UI-0.4 UI-2): delete a workstream (its directory + reference) in the routed project; refuses when the workstream has history; clears the current-focus pointer best-effort."
				},
				{
					name: "inspectProjectDirectory",
					signature: "inspectProjectDirectory(args: InspectProjectDirectoryArgs): Promise<InspectProjectDirectoryResult>",
					kind: "method",
					summary: "GUI management (V2-UI-0.4 UI-2B, plane-level): classify a candidate directory into one of the 4 bind states (existing RC project / git-only / plain directory / incompatible)."
				},
				{
					name: "createLocalResearchProject",
					signature: "createLocalResearchProject(args: CreateLocalResearchProjectArgs): Promise<CreateLocalResearchProjectResult>",
					kind: "method",
					summary: "GUI management (V2-UI-0.4 UI-2B, plane-level): create a fresh local research project end-to-end (mkdir → git init → tree scaffold → metadata → registry commit; the registry commit is LAST — a step failure returns a three-stage failure DTO, no rollback)."
				}
			],
			types: [
				{
					name: "PingResult",
					declaration: "interface PingResult { readonly ok: true; readonly service: \"researchControl\"; readonly time: number }"
				},
				{
					name: "DashboardSnapshot",
					declaration: "interface DashboardSnapshot { readonly project: { id; title; description; importance; attentionMode; targetDate }; readonly topics: TopicCardDto[]; readonly openInterventions: InterventionDto[]; readonly pendingInterventions: InterventionDto[]; readonly scheduledEvents: null; readonly reportingItems: null; readonly inboxCount: number; readonly attention: null }"
				},
				{
					name: "ProjectSnapshot",
					declaration: "interface ProjectSnapshot { readonly project: { id; title; description; importance; attentionMode; targetDate; currentObjectiveRefs; createdAt }; readonly objectives: ObjectiveDto[]; readonly topics: TopicCardDto[]; readonly upcomingInteractions: null; readonly upcomingReporting: null }"
				},
				{
					name: "TopicSnapshot",
					declaration: "interface TopicSnapshot { readonly topic: { id; title; description; importance; attentionMode; objectiveRefs; createdAt }; readonly workstreams: WorkstreamCardDto[]; readonly topology: { edges: TopologyEdgeDto[] }; readonly mergeContracts: MergeContractRefDto[]; readonly objectives: ObjectiveDto[] }"
				},
				{
					name: "WorkstreamSnapshot",
					declaration: "interface WorkstreamSnapshot { readonly workstream: { id; topicId; title; lifecycle; summary; createdAt }; readonly history: { eventCount }; readonly current: { tasks: CurrentTaskDto[]; runs: RunDto[] }; readonly future: { plan: { orderedItems: PlanItemDto[] }; planForks: PlanForkDto[]; unresolvedPlanForkCount } }"
				},
				{
					name: "QueryHistoryResult",
					declaration: "interface QueryHistoryResult { readonly events: HistoryEventDto[]; readonly nextAfterSeq: number | null; readonly exhausted: boolean }"
				},
				{
					name: "ReorderPlanResult",
					declaration: "interface ReorderPlanResult { readonly workstreamId: string; readonly orderedItemIds: string[]; readonly planPath: string; readonly managementActionId: string }"
				},
				{
					name: "SelectPlanForkResult",
					declaration: "interface SelectPlanForkResult { readonly planForkId; readonly workstreamId; readonly statusBefore: \"OPEN\"; readonly statusAfter: \"SELECTED\"; readonly selectedAt; readonly oldOrder: string[]; readonly newOrder: string[]; readonly newItems: { id; kind; path }[]; readonly removedIds: string[]; readonly staleOthers: { planForkId; staleReason }[]; readonly planYamlPath; readonly checkpointHint }"
				},
				{
					name: "DismissPlanForkResult",
					declaration: "interface DismissPlanForkResult { readonly planForkId; readonly workstreamId; readonly statusBefore: \"OPEN\" | \"STALE\"; readonly statusAfter: \"DISMISSED\"; readonly dismissedAt }"
				},
				{
					name: "UpdateInterventionStateResult",
					declaration: "interface UpdateInterventionStateResult { readonly interventionId; readonly statusFrom: IvStatus; readonly statusTo: IvStatus; readonly closedAt: number | null; readonly resolutionNote: string | null }"
				},
				{
					name: "RegisterInteractionResult",
					declaration: "interface RegisterInteractionResult { readonly id: string; readonly kind: InteractionKind; readonly title; readonly occurredAt; readonly participants: string[]; readonly notes: string | null; readonly relatedWorkstreams: string[]; readonly createdAt }"
				},
				{
					name: "SaveResearchCheckpointResult",
					declaration: "interface SaveResearchCheckpointResult { readonly committed: boolean; readonly commitOid: string | null; readonly changedFiles: string[]; readonly warnings: string[]; readonly message: string | null }"
				},
				{
					name: "GetGitHistoryResult",
					declaration: "interface GetGitHistoryResult { readonly versions: GitVersionDto[]; readonly fileDiff: GitDiffEntryDto[] | null; readonly baseline: string | null; readonly pathContent: { path; sameAsBaseline } | null }"
				},
				{
					name: "RestoreDeclarativeFileResult",
					declaration: "interface RestoreDeclarativeFileResult { readonly path; readonly commitOid; readonly validationOk: boolean; readonly validationErrors: { file; path; summary }[]; readonly warnings: string[] }"
				},
				{
					name: "GetResearchPlaneStateResult",
					declaration: "interface GetResearchPlaneStateResult { readonly hub: { path } | null; readonly dirNames: { treeDir; hubDir }; readonly projects: PlaneProjectDto[]; readonly missing: PlaneMissingDto[]; readonly session: PlaneSessionDto | null }"
				},
				{
					name: "HubOverviewResult",
					declaration: "interface HubOverviewResult { readonly totals: { projects; openInterventions; inbox }; readonly attention: { projectId; displayName; openCount; oldestHours }[]; readonly cards: { projectId; displayName; title; description; attentionMode; targetDate; openInterventions; pendingInterventions; topics; inboxCount }[] }"
				},
				{
					name: "GetPortfolioInterventionsResult",
					declaration: "interface GetPortfolioInterventionsResult { readonly items: { projectId; displayName; id; title; origin; status; workstreamIds; createdAt }[] }"
				},
				{
					name: "SetHubResult",
					declaration: "interface SetHubResult { readonly hubPath; readonly registryPath }"
				},
				{
					name: "BindProjectResult",
					declaration: "interface BindProjectResult { readonly projectId; readonly registryPath: string | null; readonly dbMigrated: boolean }"
				},
				{
					name: "UnbindProjectResult",
					declaration: "interface UnbindProjectResult { readonly projectId; readonly archivedDir }"
				},
				{
					name: "RestoreProjectResult",
					declaration: "interface RestoreProjectResult { readonly wsPath }"
				},
				{
					name: "RescanResult",
					declaration: "interface RescanResult { readonly hub: { path } | null; readonly dirNames: { treeDir; hubDir }; readonly projects: PlaneProjectDto[]; readonly missing: PlaneMissingDto[] }"
				},
				{
					name: "AckMissingReminderResult",
					declaration: "interface AckMissingReminderResult { readonly acknowledged: true }"
				},
				{
					name: "SetCurrentFocusResult",
					declaration: "interface SetCurrentFocusResult { readonly workstreamId: string; readonly planItemId: string; readonly updatedAt: number }"
				},
				{
					name: "GetCurrentFocusResult",
					declaration: "interface GetCurrentFocusResult { readonly workstreamId: string; readonly focus: { planItemId: string; updatedAt: number } | null }"
				},
				{
					name: "CreateTopicResult",
					declaration: "interface CreateTopicResult { readonly topicId: string; readonly title: string; readonly path: string; readonly createdAt: number }"
				},
				{
					name: "CreateWorkstreamResult",
					declaration: "interface CreateWorkstreamResult { readonly workstreamId: string; readonly topicId: string; readonly title: string; readonly path: string; readonly createdAt: number }"
				},
				{
					name: "UpdateProjectMetadataResult",
					declaration: "interface UpdateProjectMetadataResult { readonly projectId: string; readonly title: string; readonly updatedAt: number }"
				},
				{
					name: "UpdateTopicResult",
					declaration: "interface UpdateTopicResult { readonly topicId: string; readonly title: string; readonly updatedAt: number }"
				},
				{
					name: "UpdateWorkstreamResult",
					declaration: "interface UpdateWorkstreamResult { readonly workstreamId: string; readonly topicId: string; readonly title: string; readonly updatedAt: number }"
				},
				{
					name: "DropWorkstreamResult",
					declaration: "interface DropWorkstreamResult { readonly workstreamId: string; readonly topicId: string; readonly currentFocusCleared: boolean }"
				},
				{
					name: "InspectProjectDirectoryResult",
					declaration: "interface InspectProjectDirectoryResult { readonly wsPath: string; readonly state: \"RC_PROJECT\" | \"GIT_ONLY\" | \"PLAIN_DIR\" | \"INCOMPATIBLE\"; readonly message: string; readonly detail: string | null; readonly hasGitRepo: boolean; readonly hasResearchTree: boolean; readonly treeValid: boolean; readonly alreadyManaged: boolean; readonly projectId?: string; readonly title?: string }"
				},
				{
					name: "CreateLocalResearchProjectResult",
					declaration: "type CreateLocalResearchProjectResult = { ok: true; readonly projectId: string; readonly treePath: string; readonly registryPath: string | null; readonly dbMigrated: boolean } | { ok: false; readonly code: \"LP_MKDIR\" | \"LP_GIT_INIT\" | \"LP_SCAFFOLD\" | \"LP_METADATA\" | \"LP_REGISTER\"; readonly failedStep: \"mkdir\" | \"gitInit\" | \"scaffold\" | \"metadata\" | \"register\"; readonly completedSteps: (\"mkdir\" | \"gitInit\" | \"scaffold\" | \"metadata\" | \"register\")[]; readonly partialChangeNote: string; readonly detail: string }"
				}
			]
		}],
		events: [],
		objects: []
	}
};
//#endregion
export { TYPERT };
