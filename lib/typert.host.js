import { A as RescanResultSchema, B as SetHubResultSchema, C as REGISTERED_RESEARCH_INVOCATIONS, D as ReorderPlanArgsSchema, E as RegisterInteractionResultSchema, F as SaveResearchCheckpointArgsSchema, G as UpdateInterventionStateResultSchema, H as UnbindProjectArgsSchema, I as SaveResearchCheckpointResultSchema, K as WorkstreamSnapshotSchema, L as SelectPlanForkArgsSchema, M as RestoreDeclarativeFileResultSchema, N as RestoreProjectArgsSchema, O as ReorderPlanResultSchema, P as RestoreProjectResultSchema, R as SelectPlanForkResultSchema, S as QueryHistoryResultSchema, T as RegisterInteractionArgsSchema, U as UnbindProjectResultSchema, V as TopicSnapshotSchema, W as UpdateInterventionStateArgsSchema, _ as HubOverviewResultSchema, a as DashboardSnapshotSchema, b as ProjectSnapshotSchema, c as GetGitHistoryArgsSchema, d as GetPortfolioInterventionsArgsSchema, f as GetPortfolioInterventionsResultSchema, g as GetWorkstreamArgsSchema, h as GetTopicArgsSchema, i as BindProjectResultSchema, j as RestoreDeclarativeFileArgsSchema, k as RescanArgsSchema, l as GetGitHistoryResultSchema, m as GetResearchPlaneStateResultSchema, n as AckMissingReminderResultSchema, o as DismissPlanForkArgsSchema, p as GetResearchPlaneStateArgsSchema, r as BindProjectArgsSchema, s as DismissPlanForkResultSchema, t as AckMissingReminderArgsSchema, u as GetHubOverviewArgsSchema, v as PingResultSchema, w as RESEARCH_CONTROL_PACKAGE, x as QueryHistoryArgsSchema, z as SetHubArgsSchema } from "./rpc-contracts-Cq8esQs8.js";
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
				}
			]
		}],
		events: [],
		objects: []
	}
};
//#endregion
export { TYPERT };
