/**
 * Hand-written `./typert` host-face artifact (WP-0.3 RPC spike,
 * WP-4.1a: the full 13-RPC client face).
 *
 * U4 fallback (STATUS E009): the typert generator cannot run in this
 * workspace (npm registry is stale at 0.0.1-rc.1; the harness checkout has
 * no node_modules), so this module mirrors the shape of the generated
 * `lib/typert.host.{js,d.ts}` by hand: a named `TYPERT` export of the
 * contribution manifest. The `dsh-typert-loader` imports `./typert`,
 * validates `mod.TYPERT` field-by-field (`validateTypertManifest`,
 * checkout packages/typert/loader/src/index.ts:83-142) and registers the
 * contribution into `ctx.typert`; tests/rpc-spike.test.ts (ping) and
 * tests/rpc-face/manifest.test.ts (the full face) replicate those rules.
 *
 * WP-4.1a: the manifest now carries the FULL service model, every wire
 * schema as a live zod v4 instance (the loader's `_zod` brand check),
 * and the strict invocation descriptors — the SAME shared objects the
 * client `./remote` contribution exports (no drift by construction, the
 * WP-0.3 rule extended from ping to the whole face). V2-T3.2a: the
 * registered face is the 17-member model (ping + the 13 §7.1 RPCs + the
 * 3 read-only plane RPCs of design §12 rows 1-3 — the shared
 * `REGISTERED_RESEARCH_INVOCATIONS`; the 6 change-family plane RPCs stay
 * contract-only until their @Remote bodies land in T3.2b+).
 *
 * Type note: the whole-manifest type is the LOCAL `TypertContributionMirror`
 * (registry package stale/uninstallable) — 以 loader 运行时校验为准. The
 * `invocations` field is deliberately typed with the REAL protocol
 * `InvocationDescriptor`: that structural check proves the shared
 * hand-written descriptors stay identical to what the gateway dispatch
 * consumes.
 *
 * This file is host-dsh-adapter territory: it may import `@deepseek-ai/*`
 * (INV-PERM-5 exempt set).
 */

import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import {
  DashboardSnapshotSchema,
  DismissPlanForkArgsSchema,
  DismissPlanForkResultSchema,
  GetGitHistoryArgsSchema,
  GetGitHistoryResultSchema,
  GetHubOverviewArgsSchema,
  GetPortfolioInterventionsArgsSchema,
  GetPortfolioInterventionsResultSchema,
  GetResearchPlaneStateArgsSchema,
  GetResearchPlaneStateResultSchema,
  GetTopicArgsSchema,
  GetWorkstreamArgsSchema,
  HubOverviewResultSchema,
  PingResultSchema,
  ProjectSnapshotSchema,
  QueryHistoryArgsSchema,
  QueryHistoryResultSchema,
  RESEARCH_CONTROL_PACKAGE,
  REGISTERED_RESEARCH_INVOCATIONS,
  ReorderPlanArgsSchema,
  ReorderPlanResultSchema,
  RegisterInteractionArgsSchema,
  RegisterInteractionResultSchema,
  RestoreDeclarativeFileArgsSchema,
  RestoreDeclarativeFileResultSchema,
  SaveResearchCheckpointArgsSchema,
  SaveResearchCheckpointResultSchema,
  SelectPlanForkArgsSchema,
  SelectPlanForkResultSchema,
  TopicSnapshotSchema,
  UpdateInterventionStateArgsSchema,
  UpdateInterventionStateResultSchema,
  WorkstreamSnapshotSchema,
  type TypertContributionMirror,
  type TypertSchemaMirror,
} from '../../../shared/rpc-contracts.js'

/**
 * The host-face `TYPERT` manifest (mirror of the registry `TypertContribution`;
 * the loader's runtime validation is the authority).
 */
export interface TypertHostManifest extends Omit<TypertContributionMirror, 'face' | 'invocations'> {
  readonly face: 'host'
  /** Real protocol type: cross-checks the shared mirror at the module boundary. */
  readonly invocations: readonly InvocationDescriptor[]
}

/**
 * Every wire schema the face uses, as a live zod v4 instance (the loader
 * requires the `_zod` brand on each `TYPERT.schemas` entry). 31 entries:
 * ping's result + the 13 RPCs' args/results (the two zero-arg queries
 * carry no args schema) + the 3 read-only plane RPCs' args/results
 * (V2-T3.2a — the 6 change-family plane RPCs' schemas join this list with
 * their implementation tasks).
 */
const ALL_SCHEMAS: readonly TypertSchemaMirror[] = [
  { name: 'PingResult', schema: PingResultSchema },
  { name: 'DashboardSnapshot', schema: DashboardSnapshotSchema },
  { name: 'ProjectSnapshot', schema: ProjectSnapshotSchema },
  { name: 'GetTopicArgs', schema: GetTopicArgsSchema },
  { name: 'TopicSnapshot', schema: TopicSnapshotSchema },
  { name: 'GetWorkstreamArgs', schema: GetWorkstreamArgsSchema },
  { name: 'WorkstreamSnapshot', schema: WorkstreamSnapshotSchema },
  { name: 'QueryHistoryArgs', schema: QueryHistoryArgsSchema },
  { name: 'QueryHistoryResult', schema: QueryHistoryResultSchema },
  { name: 'ReorderPlanArgs', schema: ReorderPlanArgsSchema },
  { name: 'ReorderPlanResult', schema: ReorderPlanResultSchema },
  { name: 'SelectPlanForkArgs', schema: SelectPlanForkArgsSchema },
  { name: 'SelectPlanForkResult', schema: SelectPlanForkResultSchema },
  { name: 'DismissPlanForkArgs', schema: DismissPlanForkArgsSchema },
  { name: 'DismissPlanForkResult', schema: DismissPlanForkResultSchema },
  { name: 'UpdateInterventionStateArgs', schema: UpdateInterventionStateArgsSchema },
  { name: 'UpdateInterventionStateResult', schema: UpdateInterventionStateResultSchema },
  { name: 'RegisterInteractionArgs', schema: RegisterInteractionArgsSchema },
  { name: 'RegisterInteractionResult', schema: RegisterInteractionResultSchema },
  { name: 'SaveResearchCheckpointArgs', schema: SaveResearchCheckpointArgsSchema },
  { name: 'SaveResearchCheckpointResult', schema: SaveResearchCheckpointResultSchema },
  { name: 'GetGitHistoryArgs', schema: GetGitHistoryArgsSchema },
  { name: 'GetGitHistoryResult', schema: GetGitHistoryResultSchema },
  { name: 'RestoreDeclarativeFileArgs', schema: RestoreDeclarativeFileArgsSchema },
  { name: 'RestoreDeclarativeFileResult', schema: RestoreDeclarativeFileResultSchema },
  // V2-T3.2a: the 3 read-only plane RPCs (design §12 rows 1-3).
  { name: 'GetResearchPlaneStateArgs', schema: GetResearchPlaneStateArgsSchema },
  { name: 'GetResearchPlaneStateResult', schema: GetResearchPlaneStateResultSchema },
  { name: 'GetHubOverviewArgs', schema: GetHubOverviewArgsSchema },
  { name: 'HubOverviewResult', schema: HubOverviewResultSchema },
  { name: 'GetPortfolioInterventionsArgs', schema: GetPortfolioInterventionsArgsSchema },
  { name: 'GetPortfolioInterventionsResult', schema: GetPortfolioInterventionsResultSchema },
]

export const TYPERT: TypertHostManifest = {
  package: RESEARCH_CONTROL_PACKAGE,
  face: 'host',
  schemas: ALL_SCHEMAS,
  // The SAME descriptor objects the client `./remote` contribution exports
  // (ping first — the 14th diagnostic method — then the 13 §7.1 RPCs —
  // then the 3 read-only plane RPCs, V2-T3.2a). The 6 change-family plane
  // RPCs stay contract-only until their @Remote bodies land (T3.2b+).
  invocations: REGISTERED_RESEARCH_INVOCATIONS,
  model: {
    services: [
      {
        key: 'researchControl',
        exportName: 'ResearchControlService',
        description:
          'Research Control Plane host service (WP-4.1a: the 13-RPC client face of ' +
          'ARCHITECTURE §7.1 + the WP-0.3 ping diagnostic; V2-T3.2a: the 3 read-only ' +
          'plane RPCs of design §12 rows 1-3 — the 17-endpoint registered face).',
        tags: [],
        // FULL member list (brief: members 全量) — all 17 @Remote methods
        // (ping + the 13 frozen RPCs + the 3 read-only plane RPCs; the 6
        // change-family plane RPCs join with their implementation tasks).
        members: [
          {
            name: 'ping',
            signature: 'ping(): Promise<PingResult>',
            kind: 'method',
            summary: 'WP-0.3 liveness round-trip marker (diagnostic only).',
          },
          {
            name: 'getDashboard',
            signature: 'getDashboard(): Promise<DashboardSnapshot>',
            kind: 'method',
            summary: 'Home/Portfolio dashboard minimal snapshot (plan §27.1).',
          },
          {
            name: 'getProject',
            signature: 'getProject(): Promise<ProjectSnapshot>',
            kind: 'method',
            summary: 'Project page minimal snapshot (plan §27.2).',
          },
          {
            name: 'getTopic',
            signature: 'getTopic(args: GetTopicArgs): Promise<TopicSnapshot>',
            kind: 'method',
            summary: 'Topic page minimal snapshot (plan §27.3).',
          },
          {
            name: 'getWorkstream',
            signature: 'getWorkstream(args: GetWorkstreamArgs): Promise<WorkstreamSnapshot>',
            kind: 'method',
            summary: 'Workstream 核心三区 minimal snapshot (plan §27.4).',
          },
          {
            name: 'queryHistory',
            signature: 'queryHistory(args: QueryHistoryArgs): Promise<QueryHistoryResult>',
            kind: 'method',
            summary: 'History page with seq-cursor pagination (replay query face).',
          },
          {
            name: 'reorderPlan',
            signature: 'reorderPlan(args: ReorderPlanArgs): Promise<ReorderPlanResult>',
            kind: 'method',
            summary: 'USER: canonical plan reorder (same item set, new order).',
          },
          {
            name: 'selectPlanFork',
            signature: 'selectPlanFork(args: SelectPlanForkArgs): Promise<SelectPlanForkResult>',
            kind: 'method',
            summary: 'USER: SELECT an OPEN PlanFork (§6 materialization).',
          },
          {
            name: 'dismissPlanFork',
            signature: 'dismissPlanFork(args: DismissPlanForkArgs): Promise<DismissPlanForkResult>',
            kind: 'method',
            summary: 'USER: DISMISS an OPEN/STALE PlanFork (§7).',
          },
          {
            name: 'updateInterventionState',
            signature: 'updateInterventionState(args: UpdateInterventionStateArgs): Promise<UpdateInterventionStateResult>',
            kind: 'method',
            summary: 'USER: Intervention OPEN/PENDING/CLOSED (§13 state machine).',
          },
          {
            name: 'registerInteraction',
            signature: 'registerInteraction(args: RegisterInteractionArgs): Promise<RegisterInteractionResult>',
            kind: 'method',
            summary:
              'USER: 登记 Interaction (DOMAIN_SCHEMA §10.1) — production storage ' +
              'lands in PHASE 5 (WP-5.3); the wire contract and port seam are frozen.',
          },
          {
            name: 'saveResearchCheckpoint',
            signature: 'saveResearchCheckpoint(args: SaveResearchCheckpointArgs): Promise<SaveResearchCheckpointResult>',
            kind: 'method',
            summary: 'USER: explicit git checkpoint of .research/** (INV-GIT-2/3).',
          },
          {
            name: 'getGitHistory',
            signature: 'getGitHistory(args: GetGitHistoryArgs): Promise<GetGitHistoryResult>',
            kind: 'method',
            summary: 'Read-only .research/** git log + baseline diff face (W6/W5).',
          },
          {
            name: 'restoreDeclarativeFile',
            signature: 'restoreDeclarativeFile(args: RestoreDeclarativeFileArgs): Promise<RestoreDeclarativeFileResult>',
            kind: 'method',
            summary: 'USER: explicit restore of one .research file (INV-GIT-5).',
          },
          // V2-T3.2a: the 3 read-only plane RPCs (design §12 rows 1-3).
          {
            name: 'getResearchPlaneState',
            signature: 'getResearchPlaneState(args: GetResearchPlaneStateArgs): Promise<GetResearchPlaneStateResult>',
            kind: 'method',
            summary: 'Plane state + caller-session role (design §5 标签页分流 + 设置页① 数据源).',
          },
          {
            name: 'getHubOverview',
            signature: 'getHubOverview(args: GetHubOverviewArgs): Promise<HubOverviewResult>',
            kind: 'method',
            summary: 'Cross-project aggregation: 聚合条 + 需关注行 + 项目卡墙 (design §7.1).',
          },
          {
            name: 'getPortfolioInterventions',
            signature: 'getPortfolioInterventions(args: GetPortfolioInterventionsArgs): Promise<GetPortfolioInterventionsResult>',
            kind: 'method',
            summary: 'Cross-project intervention list, projectId-labeled, 状态过滤 (design §7.2).',
          },
        ],
        types: [
          {
            name: 'PingResult',
            declaration:
              'interface PingResult { readonly ok: true; readonly service: "researchControl"; readonly time: number }',
          },
          {
            name: 'DashboardSnapshot',
            declaration:
              'interface DashboardSnapshot { readonly project: { id; title; description; importance; attentionMode; targetDate }; readonly topics: TopicCardDto[]; readonly openInterventions: InterventionDto[]; readonly pendingInterventions: InterventionDto[]; readonly scheduledEvents: null; readonly reportingItems: null; readonly inboxCount: number; readonly attention: null }',
          },
          {
            name: 'ProjectSnapshot',
            declaration:
              'interface ProjectSnapshot { readonly project: { id; title; description; importance; attentionMode; targetDate; currentObjectiveRefs; createdAt }; readonly objectives: ObjectiveDto[]; readonly topics: TopicCardDto[]; readonly upcomingInteractions: null; readonly upcomingReporting: null }',
          },
          {
            name: 'TopicSnapshot',
            declaration:
              'interface TopicSnapshot { readonly topic: { id; title; description; importance; attentionMode; objectiveRefs; createdAt }; readonly workstreams: WorkstreamCardDto[]; readonly topology: { edges: TopologyEdgeDto[] }; readonly mergeContracts: MergeContractRefDto[]; readonly objectives: ObjectiveDto[] }',
          },
          {
            name: 'WorkstreamSnapshot',
            declaration:
              'interface WorkstreamSnapshot { readonly workstream: { id; topicId; title; lifecycle; summary; createdAt }; readonly history: { eventCount }; readonly current: { tasks: CurrentTaskDto[]; runs: RunDto[] }; readonly future: { plan: { orderedItems: PlanItemDto[] }; planForks: PlanForkDto[]; unresolvedPlanForkCount } }',
          },
          {
            name: 'QueryHistoryResult',
            declaration:
              'interface QueryHistoryResult { readonly events: HistoryEventDto[]; readonly nextAfterSeq: number | null; readonly exhausted: boolean }',
          },
          {
            name: 'ReorderPlanResult',
            declaration:
              'interface ReorderPlanResult { readonly workstreamId: string; readonly orderedItemIds: string[]; readonly planPath: string; readonly managementActionId: string }',
          },
          {
            name: 'SelectPlanForkResult',
            declaration:
              'interface SelectPlanForkResult { readonly planForkId; readonly workstreamId; readonly statusBefore: "OPEN"; readonly statusAfter: "SELECTED"; readonly selectedAt; readonly oldOrder: string[]; readonly newOrder: string[]; readonly newItems: { id; kind; path }[]; readonly removedIds: string[]; readonly staleOthers: { planForkId; staleReason }[]; readonly planYamlPath; readonly checkpointHint }',
          },
          {
            name: 'DismissPlanForkResult',
            declaration:
              'interface DismissPlanForkResult { readonly planForkId; readonly workstreamId; readonly statusBefore: "OPEN" | "STALE"; readonly statusAfter: "DISMISSED"; readonly dismissedAt }',
          },
          {
            name: 'UpdateInterventionStateResult',
            declaration:
              'interface UpdateInterventionStateResult { readonly interventionId; readonly statusFrom: IvStatus; readonly statusTo: IvStatus; readonly closedAt: number | null; readonly resolutionNote: string | null }',
          },
          {
            name: 'RegisterInteractionResult',
            declaration:
              'interface RegisterInteractionResult { readonly id: string; readonly kind: InteractionKind; readonly title; readonly occurredAt; readonly participants: string[]; readonly notes: string | null; readonly relatedWorkstreams: string[]; readonly createdAt }',
          },
          {
            name: 'SaveResearchCheckpointResult',
            declaration:
              'interface SaveResearchCheckpointResult { readonly committed: boolean; readonly commitOid: string | null; readonly changedFiles: string[]; readonly warnings: string[]; readonly message: string | null }',
          },
          {
            name: 'GetGitHistoryResult',
            declaration:
              'interface GetGitHistoryResult { readonly versions: GitVersionDto[]; readonly fileDiff: GitDiffEntryDto[] | null; readonly baseline: string | null; readonly pathContent: { path; sameAsBaseline } | null }',
          },
          {
            name: 'RestoreDeclarativeFileResult',
            declaration:
              'interface RestoreDeclarativeFileResult { readonly path; readonly commitOid; readonly validationOk: boolean; readonly validationErrors: { file; path; summary }[]; readonly warnings: string[] }',
          },
          // V2-T3.2a: the 3 read-only plane RPC result types (design §12 rows 1-3).
          {
            name: 'GetResearchPlaneStateResult',
            declaration:
              'interface GetResearchPlaneStateResult { readonly hub: { path } | null; readonly dirNames: { treeDir; hubDir }; readonly projects: PlaneProjectDto[]; readonly missing: PlaneMissingDto[]; readonly session: PlaneSessionDto | null }',
          },
          {
            name: 'HubOverviewResult',
            declaration:
              'interface HubOverviewResult { readonly totals: { projects; openInterventions; inbox }; readonly attention: { projectId; displayName; openCount; oldestHours }[]; readonly cards: { projectId; displayName; title; description; attentionMode; targetDate; openInterventions; pendingInterventions; topics; inboxCount }[] }',
          },
          {
            name: 'GetPortfolioInterventionsResult',
            declaration:
              'interface GetPortfolioInterventionsResult { readonly items: { projectId; displayName; id; title; origin; status; workstreamIds; createdAt }[] }',
          },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}
