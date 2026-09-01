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
 * `REGISTERED_RESEARCH_INVOCATIONS`). V2-T3.2b: the registered face is
 * the FULL 23-member V2 business model — the 6 change-family plane RPCs
 * (setHub / bindProject / unbindProject / restoreProject / rescan /
 * ackMissingReminder, design §12 rows 4-6/8/9) join with their @Remote
 * bodies (T3.2b).
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

/**
 * 0.1.2-alpha.3 typert train: merge the owner's domain failure codes into
 * the shared `RemoteErrorDetailsMap` (the gateway merges its infrastructure
 * codes the same way — `remote-error-codes.ts`). Every `PLANE_*` code the
 * host throws via `PlaneError` (the closed 13-code vocabulary, frozen list
 * in `src/shared/rpc-contracts.ts`) is declared here so the typed Remote
 * faces see the full union; the wire payload is the empty object (the
 * message stays the self-contained human carrier). Type-only: no runtime
 * import is added.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** `setHub`: the plane already carries a hub at another workspace. */
    'PLANE_HUB_EXISTS': {}
    /** `setHub`: the target workspace already carries the hub marker. */
    'PLANE_HUB_MARKER_EXISTS': {}
    /** `setHub` / `bindProject` / `unbindProject`: not a registered DSH workspace. */
    'PLANE_NOT_REGISTERED_WORKSPACE': {}
    /** `bindProject`: the workspace already carries an ACTIVE registry entry. */
    'PLANE_ALREADY_MANAGED': {}
    /** `bindProject`: the target workspace is the hub workspace itself. */
    'PLANE_HUB_WORKSPACE': {}
    /** `bindProject`: no tree was discovered and `scaffold` is not `true`. */
    'PLANE_TREE_MISSING': {}
    /** `bindProject`: `scaffold` is `true` but a tree already exists. */
    'PLANE_TREE_EXISTS': {}
    /** `unbindProject`: the workspace is not an active managed project. */
    'PLANE_NOT_MANAGED': {}
    /** `restoreProject`: no ARCHIVED registry entry carries that project id. */
    'PLANE_NOT_ARCHIVED': {}
    /** `restoreProject`: the archived tree directory cannot be found on disk. */
    'PLANE_ARCHIVED_DIR_MISSING': {}
    /** `restoreProject`: the restore target tree name is already occupied. */
    'PLANE_TARGET_NAME_TAKEN': {}
    /** `ackMissingReminder`: the project id is not in the MISSING set. */
    'PLANE_NOT_MISSING': {}
    /** `getResearchPlaneState`: the `sessionId` names no known session. */
    'PLANE_SESSION_UNKNOWN': {}
  }
}

import {
  AckMissingReminderArgsSchema,
  AckMissingReminderResultSchema,
  AddDependencyArgsSchema,
  AddDependencyResultSchema,
  AddRelationArgsSchema,
  AddRelationResultSchema,
  BindProjectArgsSchema,
  BindProjectResultSchema,
  ClearBlockerArgsSchema,
  ClearBlockerResultSchema,
  CreateBlockerArgsSchema,
  CreateBlockerResultSchema,
  CreateLocalResearchProjectArgsSchema,
  CreateLocalResearchProjectResultSchema,
  CreateNextActionArgsSchema,
  CreateNextActionResultSchema,
  CreatePlanItemArgsSchema,
  CreatePlanItemResultSchema,
  CreatePlannedMergeArgsSchema,
  CreatePlannedMergeResultSchema,
  CreateTopicArgsSchema,
  CreateTopicResultSchema,
  CreateWorkstreamArgsSchema,
  CreateWorkstreamForkArgsSchema,
  CreateWorkstreamForkResultSchema,
  CreateWorkstreamResultSchema,
  DashboardSnapshotSchema,
  DismissNextActionArgsSchema,
  DismissNextActionResultSchema,
  DismissPlanForkArgsSchema,
  DismissPlanForkResultSchema,
  DropTopologyEdgeArgsSchema,
  DropTopologyEdgeResultSchema,
  DropWorkstreamArgsSchema,
  DropWorkstreamResultSchema,
  GetGitHistoryArgsSchema,
  GetGitHistoryResultSchema,
  GetCurrentFocusArgsSchema,
  GetCurrentFocusResultSchema,
  GetHubOverviewArgsSchema,
  GetMergeContractArgsSchema,
  GetMergeContractResultSchema,
  GetPortfolioInterventionsArgsSchema,
  GetPortfolioInterventionsResultSchema,
  GetResearchPlaneStateArgsSchema,
  GetResearchPlaneStateResultSchema,
  GetTopicArgsSchema,
  GetWorkstreamArgsSchema,
  GetWorkstreamCurrentArgsSchema,
  GetWorkstreamCurrentResultSchema,
  HubOverviewResultSchema,
  InspectProjectDirectoryArgsSchema,
  InspectProjectDirectoryResultSchema,
  MarkArtifactMissingArgsSchema,
  MarkArtifactMissingResultSchema,
  PingResultSchema,
  ProjectSnapshotSchema,
  PromoteNextActionArgsSchema,
  PromoteNextActionResultSchema,
  QueryHistoryArgsSchema,
  QueryHistoryResultSchema,
  QueryAttentionArgsSchema,
  QueryAttentionResultSchema,
  QueryRecordsArgsSchema,
  QueryRecordsResultSchema,
  RecordClaimArgsSchema,
  RecordClaimResultSchema,
  RecordFactArgsSchema,
  RecordFactResultSchema,
  RegisterArtifactArgsSchema,
  RegisterArtifactResultSchema,
  RemoveDependencyArgsSchema,
  RemoveDependencyResultSchema,
  RemoveRelationArgsSchema,
  RemoveRelationResultSchema,
  RemovePlanItemArgsSchema,
  RemovePlanItemResultSchema,
  RESEARCH_CONTROL_PACKAGE,
  REGISTERED_RESEARCH_INVOCATIONS,
  ReorderPlanArgsSchema,
  ReorderPlanResultSchema,
  RegisterInteractionArgsSchema,
  RegisterInteractionResultSchema,
  RescanArgsSchema,
  RescanResultSchema,
  RestoreDeclarativeFileArgsSchema,
  RestoreDeclarativeFileResultSchema,
  RestoreProjectArgsSchema,
  RestoreProjectResultSchema,
  RetractClaimArgsSchema,
  RetractClaimResultSchema,
  SaveMergeContractArgsSchema,
  SaveMergeContractResultSchema,
  SaveResearchCheckpointArgsSchema,
  SaveResearchCheckpointResultSchema,
  SelectPlanForkArgsSchema,
  SelectPlanForkResultSchema,
  SetCurrentFocusArgsSchema,
  SetCurrentFocusResultSchema,
  SetHubArgsSchema,
  SetHubResultSchema,
  TopicSnapshotSchema,
  UnbindProjectArgsSchema,
  UnbindProjectResultSchema,
  UpdateInterventionStateArgsSchema,
  UpdateInterventionStateResultSchema,
  UpdateObjectiveArgsSchema,
  UpdateObjectiveResultSchema,
  UpdatePlanItemArgsSchema,
  UpdatePlanItemResultSchema,
  UpdateProjectMetadataArgsSchema,
  UpdateProjectMetadataResultSchema,
  UpdateTopicArgsSchema,
  UpdateTopicResultSchema,
  UpdateWorkstreamArgsSchema,
  UpdateWorkstreamResultSchema,
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
 * requires the `_zod` brand on each `TYPERT.schemas` entry). 97 entries:
 * ping's result + the 13 RPCs' args/results (the two zero-arg queries
 * carry no args schema) + the 3 read-only plane RPCs' args/results
 * (V2-T3.2a) + the 6 change-family plane RPCs' args/results (V2-T3.2b —
 * design §12 rows 4-6/8/9; `RescanResult` rides the shared
 * `PlaneStateSummary` schema, the rescan's result alias) + the 2
 * current-focus management RPCs' args/results (V2-UI-0.4 slice 1) + the
 * 2 hierarchy-create management RPCs' args/results (V2-UI-0.4 Task 3) +
 * the 6 GUI management RPCs' args/results (V2-UI-0.4 UI-2: the
 * 4 hierarchy update/drop RPCs + the 2 local-project RPCs) + the 7
 * attention RPCs' args/results (V2-UI-0.4 UI-4, D §10) + the 5
 * plan-editor RPCs' args/results (V2-UI-0.4 UI-5, brief §3) + the 1
 * fork RPC's args/results (V2-UI-6 D1, brief §12) + the 3
 * planned-merge / merge-contract RPCs' args/results (V2-UI-6 D2,
 * brief §3) + the 1 edge-drop RPC's args/results (V2-UI-6 D3,
 * brief §3).
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
  // V2-T3.2b: the 6 change-family plane RPCs (design §12 rows 4-6/8/9).
  { name: 'SetHubArgs', schema: SetHubArgsSchema },
  { name: 'SetHubResult', schema: SetHubResultSchema },
  { name: 'BindProjectArgs', schema: BindProjectArgsSchema },
  { name: 'BindProjectResult', schema: BindProjectResultSchema },
  { name: 'UnbindProjectArgs', schema: UnbindProjectArgsSchema },
  { name: 'UnbindProjectResult', schema: UnbindProjectResultSchema },
  { name: 'RestoreProjectArgs', schema: RestoreProjectArgsSchema },
  { name: 'RestoreProjectResult', schema: RestoreProjectResultSchema },
  { name: 'RescanArgs', schema: RescanArgsSchema },
  { name: 'RescanResult', schema: RescanResultSchema },
  { name: 'AckMissingReminderArgs', schema: AckMissingReminderArgsSchema },
  { name: 'AckMissingReminderResult', schema: AckMissingReminderResultSchema },
  { name: 'SetCurrentFocusArgs', schema: SetCurrentFocusArgsSchema },
  { name: 'SetCurrentFocusResult', schema: SetCurrentFocusResultSchema },
  { name: 'GetCurrentFocusArgs', schema: GetCurrentFocusArgsSchema },
  { name: 'GetCurrentFocusResult', schema: GetCurrentFocusResultSchema },
  // V2-UI-0.4 Task 3: the 2 hierarchy-create management RPCs (D §8.1
  // UI-2A create pair).
  { name: 'CreateTopicArgs', schema: CreateTopicArgsSchema },
  { name: 'CreateTopicResult', schema: CreateTopicResultSchema },
  { name: 'CreateWorkstreamArgs', schema: CreateWorkstreamArgsSchema },
  { name: 'CreateWorkstreamResult', schema: CreateWorkstreamResultSchema },
  // V2-UI-0.4 UI-2: the 4 hierarchy update/drop management RPCs (UI-2A) +
  // the 2 local-project management RPCs (UI-2B).
  { name: 'UpdateProjectMetadataArgs', schema: UpdateProjectMetadataArgsSchema },
  { name: 'UpdateProjectMetadataResult', schema: UpdateProjectMetadataResultSchema },
  { name: 'UpdateTopicArgs', schema: UpdateTopicArgsSchema },
  { name: 'UpdateTopicResult', schema: UpdateTopicResultSchema },
  { name: 'UpdateWorkstreamArgs', schema: UpdateWorkstreamArgsSchema },
  { name: 'UpdateWorkstreamResult', schema: UpdateWorkstreamResultSchema },
  { name: 'DropWorkstreamArgs', schema: DropWorkstreamArgsSchema },
  { name: 'DropWorkstreamResult', schema: DropWorkstreamResultSchema },
  { name: 'InspectProjectDirectoryArgs', schema: InspectProjectDirectoryArgsSchema },
  { name: 'InspectProjectDirectoryResult', schema: InspectProjectDirectoryResultSchema },
  { name: 'CreateLocalResearchProjectArgs', schema: CreateLocalResearchProjectArgsSchema },
  { name: 'CreateLocalResearchProjectResult', schema: CreateLocalResearchProjectResultSchema },
  // V2-UI-0.4 UI-4 (D §10): the 7 attention RPCs — the CurrentExecution
  // projection read + the objective/next-action/blocker mutation faces.
  { name: 'GetWorkstreamCurrentArgs', schema: GetWorkstreamCurrentArgsSchema },
  { name: 'GetWorkstreamCurrentResult', schema: GetWorkstreamCurrentResultSchema },
  { name: 'UpdateObjectiveArgs', schema: UpdateObjectiveArgsSchema },
  { name: 'UpdateObjectiveResult', schema: UpdateObjectiveResultSchema },
  { name: 'CreateNextActionArgs', schema: CreateNextActionArgsSchema },
  { name: 'CreateNextActionResult', schema: CreateNextActionResultSchema },
  { name: 'PromoteNextActionArgs', schema: PromoteNextActionArgsSchema },
  { name: 'PromoteNextActionResult', schema: PromoteNextActionResultSchema },
  { name: 'DismissNextActionArgs', schema: DismissNextActionArgsSchema },
  { name: 'DismissNextActionResult', schema: DismissNextActionResultSchema },
  { name: 'CreateBlockerArgs', schema: CreateBlockerArgsSchema },
  { name: 'CreateBlockerResult', schema: CreateBlockerResultSchema },
  { name: 'ClearBlockerArgs', schema: ClearBlockerArgsSchema },
  { name: 'ClearBlockerResult', schema: ClearBlockerResultSchema },
  // V2-UI-0.4 UI-5 (brief §3): the 5 plan-editor RPCs — the plan-item
  // create/update/remove face + the 2 dependency-edge RPCs.
  { name: 'CreatePlanItemArgs', schema: CreatePlanItemArgsSchema },
  { name: 'CreatePlanItemResult', schema: CreatePlanItemResultSchema },
  { name: 'UpdatePlanItemArgs', schema: UpdatePlanItemArgsSchema },
  { name: 'UpdatePlanItemResult', schema: UpdatePlanItemResultSchema },
  { name: 'RemovePlanItemArgs', schema: RemovePlanItemArgsSchema },
  { name: 'RemovePlanItemResult', schema: RemovePlanItemResultSchema },
  { name: 'AddDependencyArgs', schema: AddDependencyArgsSchema },
  { name: 'AddDependencyResult', schema: AddDependencyResultSchema },
  { name: 'RemoveDependencyArgs', schema: RemoveDependencyArgsSchema },
  { name: 'RemoveDependencyResult', schema: RemoveDependencyResultSchema },
  { name: 'CreateWorkstreamForkArgs', schema: CreateWorkstreamForkArgsSchema },
  { name: 'CreateWorkstreamForkResult', schema: CreateWorkstreamForkResultSchema },
  { name: 'CreatePlannedMergeArgs', schema: CreatePlannedMergeArgsSchema },
  { name: 'CreatePlannedMergeResult', schema: CreatePlannedMergeResultSchema },
  { name: 'GetMergeContractArgs', schema: GetMergeContractArgsSchema },
  { name: 'GetMergeContractResult', schema: GetMergeContractResultSchema },
  { name: 'SaveMergeContractArgs', schema: SaveMergeContractArgsSchema },
  { name: 'SaveMergeContractResult', schema: SaveMergeContractResultSchema },
  { name: 'DropTopologyEdgeArgs', schema: DropTopologyEdgeArgsSchema },
  { name: 'DropTopologyEdgeResult', schema: DropTopologyEdgeResultSchema },
  { name: 'RecordFactArgs', schema: RecordFactArgsSchema },
  { name: 'RecordFactResult', schema: RecordFactResultSchema },
  { name: 'RecordClaimArgs', schema: RecordClaimArgsSchema },
  { name: 'RecordClaimResult', schema: RecordClaimResultSchema },
  { name: 'RetractClaimArgs', schema: RetractClaimArgsSchema },
  { name: 'RetractClaimResult', schema: RetractClaimResultSchema },
  { name: 'RegisterArtifactArgs', schema: RegisterArtifactArgsSchema },
  { name: 'RegisterArtifactResult', schema: RegisterArtifactResultSchema },
  { name: 'MarkArtifactMissingArgs', schema: MarkArtifactMissingArgsSchema },
  { name: 'MarkArtifactMissingResult', schema: MarkArtifactMissingResultSchema },
  { name: 'AddRelationArgs', schema: AddRelationArgsSchema },
  { name: 'AddRelationResult', schema: AddRelationResultSchema },
  { name: 'RemoveRelationArgs', schema: RemoveRelationArgsSchema },
  { name: 'RemoveRelationResult', schema: RemoveRelationResultSchema },
  { name: 'QueryRecordsArgs', schema: QueryRecordsArgsSchema },
  { name: 'QueryRecordsResult', schema: QueryRecordsResultSchema },
  { name: 'QueryAttentionArgs', schema: QueryAttentionArgsSchema },
  { name: 'QueryAttentionResult', schema: QueryAttentionResultSchema },
]

export const TYPERT: TypertHostManifest = {
  package: RESEARCH_CONTROL_PACKAGE,
  face: 'host',
  schemas: ALL_SCHEMAS,
  // The SAME descriptor objects the client `./remote` contribution exports
  // (ping first — the 14th diagnostic method — then the 13 §7.1 RPCs —
  // then the 3 read-only plane RPCs, V2-T3.2a — then the 6 change-family
  // plane RPCs, V2-T3.2b: the full 23-endpoint registered face, design §12).
  invocations: REGISTERED_RESEARCH_INVOCATIONS,
  model: {
    services: [
      {
        key: 'researchControl',
        exportName: 'ResearchControlService',
        description:
          'Research Control Plane host service (WP-4.1a: the 13-RPC client face of ' +
          'ARCHITECTURE §7.1 + the WP-0.3 ping diagnostic; V2-T3.2a: the 3 read-only ' +
          'plane RPCs of design §12 rows 1-3; V2-T3.2b: the 6 change-family plane ' +
          'RPCs of design §12 rows 4-6/8/9 — the 23-endpoint registered face).',
        tags: [],
        // FULL member list (brief: members 全量) — all 23 @Remote methods
        // (ping + the 13 frozen RPCs + the 3 read-only plane RPCs + the 6
        // change-family plane RPCs, design §12).
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
          // V2-T3.2b: the 6 change-family plane RPCs (design §12 rows 4-6/8/9).
          // PLANE-LEVEL — not project-routed; callable on the EMPTY plane too
          // (that is the onboarding path, design §8).
          {
            name: 'setHub',
            signature: 'setHub(args: SetHubArgs): Promise<SetHubResult>',
            kind: 'method',
            summary: 'Plane-level: mark a registered workspace as the hub (design §8 设为中枢).',
          },
          {
            name: 'bindProject',
            signature: 'bindProject(args: BindProjectArgs): Promise<BindProjectResult>',
            kind: 'method',
            summary: 'Plane-level: bind (接入) a standalone workspace into the plane; migrates a standalone db (design §8/§9).',
          },
          {
            name: 'unbindProject',
            signature: 'unbindProject(args: UnbindProjectArgs): Promise<UnbindProjectResult>',
            kind: 'method',
            summary: 'Plane-level: unbind (解除绑定) a project; archives its tree for later restore (design §8).',
          },
          {
            name: 'restoreProject',
            signature: 'restoreProject(args: RestoreProjectArgs): Promise<RestoreProjectResult>',
            kind: 'method',
            summary: 'Plane-level: restore (恢复登记) an archived project back into the plane (design §8).',
          },
          {
            name: 'rescan',
            signature: 'rescan(args: RescanArgs): Promise<RescanResult>',
            kind: 'method',
            summary: 'Plane-level: re-run discovery (重新扫描) and return the fresh plane state (design §4/§7.1).',
          },
          {
            name: 'ackMissingReminder',
            signature: 'ackMissingReminder(args: AckMissingReminderArgs): Promise<AckMissingReminderResult>',
            kind: 'method',
            summary: 'Plane-level: acknowledge a MISSING-project reminder (design §4/§7.1).',
          },
          {
            name: 'setCurrentFocus',
            signature: 'setCurrentFocus(args: SetCurrentFocusArgs): Promise<SetCurrentFocusResult>',
            kind: 'method',
            summary: 'GUI management (UI-0.4 / R-01): point the workstream current-focus pointer at a canonical Plan member.',
          },
          {
            name: 'getCurrentFocus',
            signature: 'getCurrentFocus(args: GetCurrentFocusArgs): Promise<GetCurrentFocusResult>',
            kind: 'method',
            summary: 'GUI management (UI-0.4 / R-01): read back the workstream current-focus pointer (null when absent).',
          },
          {
            name: 'createTopic',
            signature: 'createTopic(args: CreateTopicArgs): Promise<CreateTopicResult>',
            kind: 'method',
            summary: 'GUI management (V2-UI-0.4 Task 3): create a new Topic in the routed project (allocates the next TPC-<n>; writes the minimal topic.yaml).',
          },
          {
            name: 'createWorkstream',
            signature: 'createWorkstream(args: CreateWorkstreamArgs): Promise<CreateWorkstreamResult>',
            kind: 'method',
            summary: 'GUI management (V2-UI-0.4 Task 3): create a new Workstream under an existing topic (allocates the next WS-<n> project-wide; writes the minimal workstream.yaml).',
          },
          {
            name: 'updateProjectMetadata',
            signature: 'updateProjectMetadata(args: UpdateProjectMetadataArgs): Promise<UpdateProjectMetadataResult>',
            kind: 'method',
            summary: 'GUI management (V2-UI-0.4 UI-2): rewrite the provided project metadata fields (title / description / importance / attention mode / target date) of the routed project (read-modify-write; untouched fields stay byte-identical).',
          },
          {
            name: 'updateTopic',
            signature: 'updateTopic(args: UpdateTopicArgs): Promise<UpdateTopicResult>',
            kind: 'method',
            summary: 'GUI management (V2-UI-0.4 UI-2): update a topic title / description / importance / attention mode in the routed project (read-modify-write).',
          },
          {
            name: 'updateWorkstream',
            signature: 'updateWorkstream(args: UpdateWorkstreamArgs): Promise<UpdateWorkstreamResult>',
            kind: 'method',
            summary: 'GUI management (V2-UI-0.4 UI-2): update a workstream title / summary in the routed project (read-modify-write).',
          },
          {
            name: 'dropWorkstream',
            signature: 'dropWorkstream(args: DropWorkstreamArgs): Promise<DropWorkstreamResult>',
            kind: 'method',
            summary: 'GUI management (V2-UI-0.4 UI-2): delete a workstream (its directory + reference) in the routed project; refuses when the workstream has history; clears the current-focus pointer best-effort.',
          },
          {
            name: 'inspectProjectDirectory',
            signature: 'inspectProjectDirectory(args: InspectProjectDirectoryArgs): Promise<InspectProjectDirectoryResult>',
            kind: 'method',
            summary: 'GUI management (V2-UI-0.4 UI-2B, plane-level): classify a candidate directory into one of the 4 bind states (existing RC project / git-only / plain directory / incompatible).',
          },
          {
            name: 'createLocalResearchProject',
            signature: 'createLocalResearchProject(args: CreateLocalResearchProjectArgs): Promise<CreateLocalResearchProjectResult>',
            kind: 'method',
            summary: 'GUI management (V2-UI-0.4 UI-2B, plane-level): create a fresh local research project end-to-end (mkdir → git init → tree scaffold → metadata → registry commit; the registry commit is LAST — a step failure returns a three-stage failure DTO, no rollback).',
          },
          // V2-UI-0.4 UI-4 (D §10): the 7 attention RPCs — the
          // CurrentExecution projection read + the objective/next-action/
          // blocker mutation faces.
          {
            name: 'getWorkstreamCurrent',
            signature: 'getWorkstreamCurrent(args: GetWorkstreamCurrentArgs): Promise<GetWorkstreamCurrentResult>',
            kind: 'method',
            summary: 'GUI management (V2-UI-0.4 UI-4, D §10): read the workstream CurrentExecution attention projection — the ACTIVE objectives linked to this workstream (priority-sorted), the explicit blockers affecting it or a member Task/Run, the derived (mechanical) blockers, the PROPOSED next actions, and the interventions naming it (all states).',
          },
          {
            name: 'updateObjective',
            signature: 'updateObjective(args: UpdateObjectiveArgs): Promise<UpdateObjectiveResult>',
            kind: 'method',
            summary: 'GUI management (V2-UI-0.4 UI-4, D §10): edit an objective statement (read-modify-write) and/or transition its status (transition-checked); at least one field is required.',
          },
          {
            name: 'createNextAction',
            signature: 'createNextAction(args: CreateNextActionArgs): Promise<CreateNextActionResult>',
            kind: 'method',
            summary: 'GUI management (V2-UI-0.4 UI-4, D §10): create a PROPOSED next action (optionally bound to a workstream).',
          },
          {
            name: 'promoteNextAction',
            signature: 'promoteNextAction(args: PromoteNextActionArgs): Promise<PromoteNextActionResult>',
            kind: 'method',
            summary: 'GUI management (V2-UI-0.4 UI-4, D §10): promote a PROPOSED next action into a plan Task (materializes the plan file + ledger; returns the materialization receipt).',
          },
          {
            name: 'dismissNextAction',
            signature: 'dismissNextAction(args: DismissNextActionArgs): Promise<DismissNextActionResult>',
            kind: 'method',
            summary: 'GUI management (V2-UI-0.4 UI-4, D §10): dismiss a PROPOSED next action.',
          },
          {
            name: 'createBlocker',
            signature: 'createBlocker(args: CreateBlockerArgs): Promise<CreateBlockerResult>',
            kind: 'method',
            summary: 'GUI management (V2-UI-0.4 UI-4, D §10): create an explicit ACTIVE blocker with its affects set (workstream / task / run references).',
          },
          {
            name: 'clearBlocker',
            signature: 'clearBlocker(args: ClearBlockerArgs): Promise<ClearBlockerResult>',
            kind: 'method',
            summary: 'GUI management (V2-UI-0.4 UI-4, D §10): clear an explicit ACTIVE blocker (the derived projection has no clear face — its blocker is the cause itself).',
          },
          {
            name: 'createPlanItem',
            signature: 'createPlanItem(args: CreatePlanItemArgs): Promise<CreatePlanItemResult>',
            kind: 'method',
            summary: 'Plan editor (V2-UI-0.4 UI-5, brief §3): create a new TASK / GATE / MILESTONE plan item in the routed workstream (index optional — omitted appends at the tail); returns the new canonical order + the management ledger row id.',
          },
          {
            name: 'updatePlanItem',
            signature: 'updatePlanItem(args: UpdatePlanItemArgs): Promise<UpdatePlanItemResult>',
            kind: 'method',
            summary: 'Plan editor (V2-UI-0.4 UI-5, brief §3): read-modify-write the named plan item (per-kind optional subset: omit = unchanged, explicit null = clear the field); writes no ledger row (ADJ-4) — returns the write stamp only.',
          },
          {
            name: 'removePlanItem',
            signature: 'removePlanItem(args: RemovePlanItemArgs): Promise<RemovePlanItemResult>',
            kind: 'method',
            summary: 'Plan editor (V2-UI-0.4 UI-5, brief §3): remove a plan item from the routed workstream (an ACTIVE gate is rejected — WRONG_STATE); the current-focus pointer is re-validated at the RPC layer (ADJ-14) and currentFocusCleared folds the pre-mutation comparison.',
          },
          {
            name: 'addDependency',
            signature: 'addDependency(args: AddDependencyArgs): Promise<AddDependencyResult>',
            kind: 'method',
            summary: 'Plan editor (V2-UI-0.4 UI-5, brief §3): add a DEPENDS_ON edge between two plan items (the wire carries endpoints only — the type is fixed server-side); the owner workstream is resolved from the endpoints.',
          },
          {
            name: 'removeDependency',
            signature: 'removeDependency(args: RemoveDependencyArgs): Promise<RemoveDependencyResult>',
            kind: 'method',
            summary: 'Plan editor (V2-UI-0.4 UI-5, brief §3): remove an existing DEPENDS_ON edge by relation id (an edge whose target gate is ACTIVE is rejected — WRONG_STATE).',
          },
          {
            name: 'createWorkstreamFork',
            signature: 'createWorkstreamFork(args: CreateWorkstreamForkArgs): Promise<CreateWorkstreamForkResult>',
            kind: 'method',
            summary: 'Topology (V2-UI-6 D1, brief §12): fork N child workstreams off a parent workstream — one PLANNED FORK edge per child, child written before its edge (WS-before-edge); failed pairs are compensated in reverse order and residue is reported loudly (manual reconciliation).',
          },
          {
            name: 'createPlannedMerge',
            signature: 'createPlannedMerge(args: CreatePlannedMergeArgs): Promise<CreatePlannedMergeResult>',
            kind: 'method',
            summary: 'Topology (V2-UI-6 D2, brief §3): plan a merge over existing workstreams — one PLANNED MERGE edge with the deduplicated inputs and a single existing output workstream (existing-output-first: a missing output is an error guiding the two-step UI, never created here); duplicate (inputs, output) pairs over live edges are rejected.',
          },
          {
            name: 'getMergeContract',
            signature: 'getMergeContract(args: GetMergeContractArgs): Promise<GetMergeContractResult>',
            kind: 'method',
            summary: 'Topology (V2-UI-6 D2, brief §3): read the merge contract for an edge — a missing contract is a null `content` value face (not an error code); no ledger row is written.',
          },
          {
            name: 'saveMergeContract',
            signature: 'saveMergeContract(args: SaveMergeContractArgs): Promise<SaveMergeContractResult>',
            kind: 'method',
            summary: 'Topology (V2-UI-6 D2, brief §3): full-replacement write of the merge contract file for an edge (the unknown-edge pre-gate is TOPO_CONTRACT_TE_UNKNOWN); a CONTRACT_EDITED ledger row is recorded.',
          },
          {
            name: 'dropTopologyEdge',
            signature: 'dropTopologyEdge(args: DropTopologyEdgeArgs): Promise<DropTopologyEdgeResult>',
            kind: 'method',
            summary: 'Topology (V2-UI-6 D3, brief §3): drop a topology edge (the state machine is the sole authority — DROPPED → DROPPED is the INVALID_TRANSITION carrier; an unknown edge is TOPO_EDGE_NOT_FOUND); a TOPOLOGY_EDITED ledger row is recorded, its detail carrying the from-state.',
          },
          {
            name: 'recordFact',
            signature: 'recordFact(args: RecordFactArgs): Promise<RecordFactResult>',
            kind: 'method',
            summary: 'Records (V2-UI-0.4 UI-7, brief §3): record a FACT row for the routed workstream (status const ACTIVE); persisted ONLY as a FACT_RECORDED history event with the derived row folded in the same tx (the §30 red line — no .research semantic file, no management_action row).',
          },
          {
            name: 'recordClaim',
            signature: 'recordClaim(args: RecordClaimArgs): Promise<RecordClaimResult>',
            kind: 'method',
            summary: 'Records (V2-UI-0.4 UI-7, brief §3): record a CLAIM row (ACTIVE); the claim id is reserved from the shared allocator and the payload carries the reserved id (ADJ-12: ids and created_by_run are not parameters).',
          },
          {
            name: 'retractClaim',
            signature: 'retractClaim(args: RetractClaimArgs): Promise<RetractClaimResult>',
            kind: 'method',
            summary: 'Records (V2-UI-0.4 UI-7, brief §3): retract an ACTIVE claim (RETRACTED is terminal); a missing or already-retracted claim is a domain-code carrier (OBJECT_NOT_FOUND / WRONG_STATE); the owner is derived from the derived-state row inside the service.',
          },
          {
            name: 'registerArtifact',
            signature: 'registerArtifact(args: RegisterArtifactArgs): Promise<RegisterArtifactResult>',
            kind: 'method',
            summary: 'Records (V2-UI-0.4 UI-7, brief §3): register an external resource BY REFERENCE (7-value frozen artifact type; non-empty title/uri; related_task / supersedes endpoints must exist) — the file is never copied into the plane.',
          },
          {
            name: 'markArtifactMissing',
            signature: 'markArtifactMissing(args: MarkArtifactMissingArgs): Promise<MarkArtifactMissingResult>',
            kind: 'method',
            summary: 'Records (V2-UI-0.4 UI-7, brief §3): flag a REGISTERED artifact MISSING (V1 one-way — the recovery edge has no V1 event); the owner is derived from the derived-state row.',
          },
          {
            name: 'addRelation',
            signature: 'addRelation(args: AddRelationArgs): Promise<AddRelationResult>',
            kind: 'method',
            summary: 'Records (V2-UI-0.4 UI-7, brief §3): add a relation edge of one of the 10 frozen types; the owner workstream is DERIVED from the endpoints (source.ws ?? target.ws — no workstreamId on the wire); the combination table / duplicate / reverse-form / self-loop checks are domain-owned.',
          },
          {
            name: 'removeRelation',
            signature: 'removeRelation(args: RemoveRelationArgs): Promise<RemoveRelationResult>',
            kind: 'method',
            summary: 'Records (V2-UI-0.4 UI-7, brief §3): remove an ACTIVE relation edge by id (REMOVED is terminal); the §5.5 payload mirrors the stored edge recovered from the owner log — the row is never re-invented.',
          },
          {
            name: 'queryRecords',
            signature: 'queryRecords(args: QueryRecordsArgs): Promise<QueryRecordsResult>',
            kind: 'method',
            summary: 'Records (V2-UI-0.4 UI-7, brief §3): query FACT/CLAIM/ARTIFACT records in-memory over the derived semantic state (no file read, zero queryHistory dependency); keyword / type / status / related-object filters + time range + limit/offset pagination; the mechanical PENDING_REVIEW conflict flag rides claims that carry a CONTRADICTED_BY edge.',
          },
          {
            name: 'queryAttention',
            signature: 'queryAttention(args: QueryAttentionArgs): Promise<QueryAttentionResult>',
            kind: 'method',
            summary: 'Needs Attention (D §14, UI-8): the unified 5-kind attention read (intervention / explicit blocker / next action / derived blocker / missing-NextAction synthetic) — one rankAttention total order (cross-project when projectId is omitted, the ADJ-4 dual path), host-computed allowedActions + priority band; kind/status/priority exact filters + workstreamId equality + limit/offset (default 50, cap 200).',
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
          // V2-T3.2b: the 6 change-family plane RPC result types (design §12 rows 4-6/8/9).
          {
            name: 'SetHubResult',
            declaration: 'interface SetHubResult { readonly hubPath; readonly registryPath }',
          },
          {
            name: 'BindProjectResult',
            declaration: 'interface BindProjectResult { readonly projectId; readonly registryPath: string | null; readonly dbMigrated: boolean }',
          },
          {
            name: 'UnbindProjectResult',
            declaration: 'interface UnbindProjectResult { readonly projectId; readonly archivedDir }',
          },
          {
            name: 'RestoreProjectResult',
            declaration: 'interface RestoreProjectResult { readonly wsPath }',
          },
          {
            name: 'RescanResult',
            declaration:
              'interface RescanResult { readonly hub: { path } | null; readonly dirNames: { treeDir; hubDir }; readonly projects: PlaneProjectDto[]; readonly missing: PlaneMissingDto[] }',
          },
          {
            name: 'AckMissingReminderResult',
            declaration: 'interface AckMissingReminderResult { readonly acknowledged: true }',
          },
          {
            name: 'SetCurrentFocusResult',
            declaration:
              'interface SetCurrentFocusResult { readonly workstreamId: string; readonly planItemId: string; readonly updatedAt: number }',
          },
          {
            name: 'GetCurrentFocusResult',
            declaration:
              'interface GetCurrentFocusResult { readonly workstreamId: string; readonly focus: { planItemId: string; updatedAt: number } | null }',
          },
          // V2-UI-0.4 Task 3: the 2 hierarchy-create management RPC result types.
          {
            name: 'CreateTopicResult',
            declaration:
              'interface CreateTopicResult { readonly topicId: string; readonly title: string; readonly path: string; readonly createdAt: number }',
          },
          {
            name: 'CreateWorkstreamResult',
            declaration:
              'interface CreateWorkstreamResult { readonly workstreamId: string; readonly topicId: string; readonly title: string; readonly path: string; readonly createdAt: number }',
          },
          // V2-UI-0.4 UI-2: the 4 hierarchy update/drop management RPC result
          // types + the 2 local-project management RPC result types.
          {
            name: 'UpdateProjectMetadataResult',
            declaration:
              'interface UpdateProjectMetadataResult { readonly projectId: string; readonly title: string; readonly updatedAt: number }',
          },
          {
            name: 'UpdateTopicResult',
            declaration:
              'interface UpdateTopicResult { readonly topicId: string; readonly title: string; readonly updatedAt: number }',
          },
          {
            name: 'UpdateWorkstreamResult',
            declaration:
              'interface UpdateWorkstreamResult { readonly workstreamId: string; readonly topicId: string; readonly title: string; readonly updatedAt: number }',
          },
          {
            name: 'DropWorkstreamResult',
            declaration:
              'interface DropWorkstreamResult { readonly workstreamId: string; readonly topicId: string; readonly currentFocusCleared: boolean }',
          },
          {
            name: 'InspectProjectDirectoryResult',
            declaration:
              'interface InspectProjectDirectoryResult { readonly wsPath: string; readonly state: "RC_PROJECT" | "GIT_ONLY" | "PLAIN_DIR" | "INCOMPATIBLE"; readonly message: string; readonly detail: string | null; readonly hasGitRepo: boolean; readonly hasResearchTree: boolean; readonly treeValid: boolean; readonly alreadyManaged: boolean; readonly projectId?: string; readonly title?: string }',
          },
          {
            name: 'CreateLocalResearchProjectResult',
            declaration:
              'type CreateLocalResearchProjectResult = { ok: true; readonly projectId: string; readonly treePath: string; readonly registryPath: string | null; readonly dbMigrated: boolean } | { ok: false; readonly code: "LP_MKDIR" | "LP_GIT_INIT" | "LP_SCAFFOLD" | "LP_METADATA" | "LP_REGISTER"; readonly failedStep: "mkdir" | "gitInit" | "scaffold" | "metadata" | "register"; readonly completedSteps: ("mkdir" | "gitInit" | "scaffold" | "metadata" | "register")[]; readonly partialChangeNote: string; readonly detail: string }',
          },
          // V2-UI-0.4 UI-4 (D §10): the 7 attention RPCs' result types.
          {
            name: 'GetWorkstreamCurrentResult',
            declaration:
              'interface GetWorkstreamCurrentResult { readonly workstreamId: string; readonly objectives: ObjectiveFullDto[]; readonly explicitBlockers: BlockerDto[]; readonly derivedBlockers: DerivedBlockerDto[]; readonly nextActions: NextActionDto[]; readonly interventions: InterventionFullDto[]; readonly dependencyEdges: DependencyEdgeDto[] }',
          },
          {
            name: 'UpdateObjectiveResult',
            declaration:
              'interface UpdateObjectiveResult { readonly objectiveId: string; readonly status: "ACTIVE" | "ACHIEVED" | "DROPPED"; readonly managementActionId: string; readonly updatedAt: number }',
          },
          {
            name: 'CreateNextActionResult',
            declaration:
              'interface CreateNextActionResult { readonly nextAction: NextActionDto }',
          },
          {
            name: 'PromoteNextActionResult',
            declaration:
              'interface PromoteNextActionResult { readonly nextActionId: string; readonly taskId: string; readonly workstreamId: string; readonly planPath: string; readonly newOrder: string[]; readonly managementActionId: string }',
          },
          {
            name: 'DismissNextActionResult',
            declaration:
              'interface DismissNextActionResult { readonly nextAction: NextActionDto }',
          },
          {
            name: 'CreateBlockerResult',
            declaration:
              'interface CreateBlockerResult { readonly blocker: BlockerDto }',
          },
          {
            name: 'ClearBlockerResult',
            declaration:
              'interface ClearBlockerResult { readonly blocker: BlockerDto }',
          },
          {
            name: 'CreatePlanItemResult',
            declaration:
              'interface CreatePlanItemResult { readonly itemId: string; readonly workstreamId: string; readonly kind: "TASK" | "GATE" | "MILESTONE"; readonly planPath: string; readonly newOrder: string[]; readonly managementActionId: string }',
          },
          {
            name: 'UpdatePlanItemResult',
            declaration:
              'interface UpdatePlanItemResult { readonly itemId: string; readonly workstreamId: string; readonly updatedAt: number }',
          },
          {
            name: 'RemovePlanItemResult',
            declaration:
              'interface RemovePlanItemResult { readonly workstreamId: string; readonly planPath: string; readonly newOrder: string[]; readonly managementActionId: string; readonly currentFocusCleared: boolean }',
          },
          {
            name: 'AddDependencyResult',
            declaration:
              'interface AddDependencyResult { readonly relationId: string; readonly source: DependencyEndpointRef; readonly target: DependencyEndpointRef }',
          },
          {
            name: 'RemoveDependencyResult',
            declaration:
              'interface RemoveDependencyResult { readonly relationId: string }',
          },
          {
            name: 'CreateWorkstreamForkResult',
            declaration:
              'interface CreateWorkstreamForkResult { readonly topicId: string; readonly edgeIds: string[]; readonly workstreamIds: string[]; readonly managementActionId: string }',
          },
          {
            name: 'CreatePlannedMergeResult',
            declaration:
              'interface CreatePlannedMergeResult { readonly edgeId: string; readonly topicId: string; readonly inputs: string[]; readonly outputWorkstreamId: string; readonly lifecycle: "PLANNED"; readonly managementActionId: string }',
          },
          {
            name: 'GetMergeContractResult',
            declaration:
              'interface GetMergeContractResult { readonly edgeId: string; readonly content: string | null; readonly path: string }',
          },
          {
            name: 'SaveMergeContractResult',
            declaration:
              'interface SaveMergeContractResult { readonly edgeId: string; readonly path: string; readonly managementActionId: string }',
          },
          {
            name: 'DropTopologyEdgeResult',
            declaration:
              'interface DropTopologyEdgeResult { readonly edgeId: string; readonly topicId: string; readonly lifecycle: "DROPPED"; readonly managementActionId: string }',
          },
          {
            name: 'RecordFactResult',
            declaration:
              'interface RecordFactResult { readonly factId: string; readonly workstreamId: string; readonly statement: string; readonly references: string[]; readonly status: "ACTIVE"; readonly recordedAt: number; readonly eventId: string }',
          },
          {
            name: 'RecordClaimResult',
            declaration:
              'interface RecordClaimResult { readonly claimId: string; readonly workstreamId: string; readonly statement: string; readonly references: string[]; readonly status: "ACTIVE"; readonly recordedAt: number; readonly eventId: string }',
          },
          {
            name: 'RetractClaimResult',
            declaration:
              'interface RetractClaimResult { readonly claimId: string; readonly status: "RETRACTED"; readonly eventId: string }',
          },
          {
            name: 'RegisterArtifactResult',
            declaration:
              'interface RegisterArtifactResult { readonly artifactId: string; readonly workstreamId: string; readonly type: string; readonly title: string; readonly uri: string; readonly status: "REGISTERED"; readonly recordedAt: number; readonly eventId: string }',
          },
          {
            name: 'MarkArtifactMissingResult',
            declaration:
              'interface MarkArtifactMissingResult { readonly artifactId: string; readonly status: "MISSING"; readonly eventId: string }',
          },
          {
            name: 'AddRelationResult',
            declaration:
              'interface AddRelationResult { readonly relationId: string; readonly source: SemanticEndpointRef; readonly relationType: string; readonly target: SemanticEndpointRef; readonly status: "ACTIVE"; readonly eventId: string }',
          },
          {
            name: 'RemoveRelationResult',
            declaration:
              'interface RemoveRelationResult { readonly relationId: string; readonly status: "REMOVED"; readonly eventId: string }',
          },
          {
            name: 'QueryRecordsResult',
            declaration:
              'interface QueryRecordsResult { readonly records: SemanticRecordDto[]; readonly total: number }',
          },
          {
            name: 'QueryAttentionResult',
            declaration:
              'interface QueryAttentionResult { readonly items: AttentionItemDto[]; readonly total: number }',
          },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}
