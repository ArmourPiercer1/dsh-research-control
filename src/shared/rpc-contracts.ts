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
 */

import { z } from 'zod'

/** npm package name owning both artifact faces; the loader requires manifest.package to match it. */
export const RESEARCH_CONTROL_PACKAGE = 'dsh-research-control'

/** Wire namespace of the Research Control service (`TypertRemoteService` super key). */
export const RESEARCH_CONTROL_NAMESPACE = 'researchControl'

/**
 * Result of the ping RPC spike. `time` is the host wall-clock at ping
 * moment in **epoch milliseconds (UTC)**: a plain JSON number, unambiguous
 * across time zones (DSH_ADAPTER §5 step 3: pure JSON DTOs only).
 */
export interface PingResult {
  readonly ok: true
  readonly service: typeof RESEARCH_CONTROL_NAMESPACE
  readonly time: number
}

/**
 * Strict codec schema for `PingResult` (zod v4 instance — carries the `_zod`
 * brand the loader and the gateway's strict path require).
 */
export const PingResultSchema = z.object({
  ok: z.literal(true),
  service: z.literal(RESEARCH_CONTROL_NAMESPACE),
  time: z.number(),
})

/**
 * Structural mirror of the protocol `TypertSchema` (the minimal runtime
 * capability a strict codec schema must carry).
 */
export interface TypertSchemaLike {
  parse(value: unknown): unknown
}

/** Structural mirror of the protocol `TypertCodec` union. */
export type TypertCodecMirror =
  | { readonly mode: 'strict'; readonly typeSymbol: string; readonly schema: TypertSchemaLike }
  | { readonly mode: 'src-json' }

/** Structural mirror of the protocol `InvocationParameterDescriptor`. */
export interface InvocationParameterMirror {
  readonly name: string
  readonly wire: string
  readonly source: 'json' | 'lookup'
  readonly lookup?: string
  readonly codec: TypertCodecMirror
  readonly acceptsUndefined?: true
}

/**
 * Structural mirror of the protocol `InvocationDescriptor`
 * (types.d.ts:140-178, field-for-field).
 */
export interface InvocationDescriptorMirror {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  readonly implementation?: string
  readonly invocation:
    | { readonly kind: 'direct' }
    | { readonly kind: 'context'; readonly context: string; readonly wire: string; readonly codec: TypertCodecMirror }
  readonly scope?: { readonly context: string; readonly wire: string }
  readonly parameters: readonly InvocationParameterMirror[]
  readonly cancellation?: { readonly parameter: 'signal' }
  readonly result: TypertCodecMirror
  readonly sourceLocation?: { readonly file: string; readonly line: number; readonly column: number }
}

/** Structural mirror of the registry `TypertDocTag`. */
export interface TypertDocTagMirror {
  readonly name: string
  readonly argument?: string
  readonly comment?: string
  readonly text: string
}

interface TypertDocumentationMirror {
  readonly description?: string
  readonly summary?: string
  readonly tags: readonly TypertDocTagMirror[]
  readonly jsDoc?: string
}

/** Structural mirror of the registry `TypertMemberModel`. */
export interface TypertMemberModelMirror {
  readonly kind: 'property' | 'method' | 'getter' | 'setter' | 'call' | 'construct' | 'index'
  readonly name: string
  readonly signature: string
  readonly summary?: string
  readonly jsDoc?: string
}

/** Structural mirror of the registry `TypertTypeModel`. */
export interface TypertTypeModelMirror {
  readonly name: string
  readonly declaration: string
}

/** Structural mirror of the registry `TypertServiceModel`. */
export interface TypertServiceModelMirror extends TypertDocumentationMirror {
  readonly key: string
  readonly exportName: string
  readonly members: readonly TypertMemberModelMirror[]
  readonly types: readonly TypertTypeModelMirror[]
}

/** Structural mirror of the registry `TypertEventModel`. */
export interface TypertEventModelMirror extends TypertDocumentationMirror {
  readonly name: string
  readonly mode?: string
  readonly signature: string
}

/** Structural mirror of the registry `TypertObjectModel`. */
export interface TypertObjectModelMirror extends TypertDocumentationMirror {
  readonly name: string
  readonly exportName: string
  readonly members: readonly TypertMemberModelMirror[]
  readonly types: readonly TypertTypeModelMirror[]
}

/** Structural mirror of the registry `TypertPackageModel`. */
export interface TypertPackageModelMirror {
  readonly services: readonly TypertServiceModelMirror[]
  readonly events: readonly TypertEventModelMirror[]
  readonly objects: readonly TypertObjectModelMirror[]
}

/** Structural mirror of the registry `TypertSchema`. */
export interface TypertSchemaMirror {
  readonly name: string
  readonly schema: TypertSchemaLike
}

/**
 * Structural mirror of the registry `TypertContribution` (the `TYPERT`
 * manifest object a `./typert` module must export).
 */
export interface TypertContributionMirror {
  readonly package: string
  readonly face: 'host' | 'client'
  readonly schemas: readonly TypertSchemaMirror[]
  readonly model: TypertPackageModelMirror
  readonly invocations: readonly InvocationDescriptorMirror[]
}

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
export const pingInvocation: InvocationDescriptorMirror = {
  id: `${RESEARCH_CONTROL_NAMESPACE}#${RESEARCH_CONTROL_NAMESPACE}/ping`,
  service: RESEARCH_CONTROL_NAMESPACE,
  namespace: RESEARCH_CONTROL_NAMESPACE,
  method: 'ping',
  invocation: { kind: 'direct' },
  parameters: [],
  result: { mode: 'strict', typeSymbol: 'PingResult', schema: PingResultSchema },
}

/* ===================================================================== *
 * WP-4.1a — the 13-RPC client face (ARCHITECTURE.md §7.1, verbatim list)
 *
 *   getDashboard · getProject · getTopic · getWorkstream · queryHistory
 *   reorderPlan · selectPlanFork · dismissPlanFork · updateInterventionState
 *   registerInteraction · saveResearchCheckpoint · getGitHistory
 *   restoreDeclarativeFile
 *
 * Result DTOs are the「GUI 需要的最小快照」(plan doc §27.1–§27.4 view
 * data needs); data sources are the existing service query faces
 * (declarative tree loader, history replay query, planfork/intervention/
 * run table stores, checkpoint/git services). Unimplemented Phase 5/6
 * data is an explicit `null` placeholder (never fabricated).
 * ===================================================================== */

/** The 13 frozen RPC method names (ARCHITECTURE.md §7.1, order preserved). */
export const RESEARCH_RPC_METHODS = [
  'getDashboard',
  'getProject',
  'getTopic',
  'getWorkstream',
  'queryHistory',
  'reorderPlan',
  'selectPlanFork',
  'dismissPlanFork',
  'updateInterventionState',
  'registerInteraction',
  'saveResearchCheckpoint',
  'getGitHistory',
  'restoreDeclarativeFile',
] as const

export type ResearchRpcMethod = (typeof RESEARCH_RPC_METHODS)[number]

/* -------------------------------------------------------------------- *
 * Frozen vocabulary mirrors (the plugin-own wire vocabulary — the same
 * frozen enums the operational/declarative carriers use; re-declared
 * here so the wire contract is self-contained and DSH-free).
 * -------------------------------------------------------------------- */

/** `common.schema.json` epoch-ms carrier (A-3). */
const epochMs = z.number().int().nonnegative()

/** `common.schema.json` id patterns (frozen). */
const idTopic = z.string().regex(/^TPC-[1-9][0-9]*$/)
const idWorkstream = z.string().regex(/^WS-[1-9][0-9]*$/)
const idTask = z.string().regex(/^T-[1-9][0-9]*$/)
const idPlanFork = z.string().regex(/^PF-[1-9][0-9]*$/)
const idIntervention = z.string().regex(/^IV-[1-9][0-9]*$/)
const idInteraction = z.string().regex(/^INT-[1-9][0-9]*$/)
const idManagementAction = z.string().regex(/^MA-[1-9][0-9]*$/)
const fullOid = z.string().regex(/^[0-9a-f]{40}$/)

const attentionMode = z.enum(['FOCUS', 'NORMAL', 'BACKGROUND'])
const wsLifecycle = z.enum(['PLANNED', 'REALIZED', 'DROPPED'])
const edgeOp = z.enum(['FORK', 'MERGE'])
const objStatus = z.enum(['ACTIVE', 'ACHIEVED', 'DROPPED'])
const objPriority = z.enum(['P0', 'P1', 'P2', 'P3'])
const taskExecution = z.enum(['PLANNED', 'ACTIVE', 'PAUSED', 'EXECUTED', 'CANCELLED'])
const taskValidation = z.enum(['NOT_REQUIRED', 'PENDING', 'UNDER_REVIEW', 'PASSED', 'FAILED'])
const runStatus = z.enum(['RUNNING', 'FINISHED', 'FAILED', 'CANCELLED'])
const interventionOrigin = z.enum(['USER', 'AGENT_REPORT', 'AUTO_FLOODING', 'AUTO_AUDIT'])
const ivStatus = z.enum(['OPEN', 'PENDING', 'CLOSED'])
const pfStatus = z.enum(['OPEN', 'STALE', 'SELECTED', 'DISMISSED'])
const planItemKind = z.enum(['TASK', 'GATE', 'MILESTONE'])
const replayOrder = z.enum(['semantic', 'audit'])
const interactionKind = z.enum([
  'MEETING',
  'AD_HOC_DISCUSSION',
  'SUPERVISOR_UPDATE',
  'COLLABORATOR_DISCUSSION',
  'EXPERIMENT_SHIFT_HANDOFF',
  'OTHER',
])

/** The frozen `actorRef` JSON carrier (common.schema.json $defs/actorRef). */
const actorRefJson = z
  .object({
    kind: z.string(),
    user_id: z.string().optional(),
    run_id: z.string().optional(),
    session_id: z.string().optional(),
    label: z.string().optional(),
  })
  .strict()

/** The frozen `sourceRef` JSON carrier (common.schema.json $defs/sourceRef). */
const sourceRefJson = z
  .object({
    kind: z.string(),
    session_id: z.string().optional(),
    path: z.string().optional(),
    commit_oid: z.string().optional(),
    interaction_id: z.string().optional(),
    note: z.string().optional(),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * Shared snapshot DTOs (nested in several result shapes)
 * -------------------------------------------------------------------- */

/** One Intervention in a GUI list (DOMAIN_SCHEMA §9.2; the store record
 *  minus the audit-only fields). */
export interface InterventionDto {
  readonly id: string
  readonly title: string
  readonly origin: 'USER' | 'AGENT_REPORT' | 'AUTO_FLOODING' | 'AUTO_AUDIT'
  readonly status: 'OPEN' | 'PENDING' | 'CLOSED'
  readonly workstreamIds: readonly string[]
  readonly createdAt: number
}

export const InterventionDtoSchema = z
  .object({
    id: idIntervention,
    title: z.string().min(1),
    origin: interventionOrigin,
    status: ivStatus,
    workstreamIds: z.array(idWorkstream),
    createdAt: epochMs,
  })
  .strict()

/** One Objective (DOMAIN_SCHEMA §9.1) in a project/topic snapshot. */
export interface ObjectiveDto {
  readonly id: string
  readonly scope: 'PROJECT' | 'TOPIC'
  readonly statement: string
  readonly status: 'ACTIVE' | 'ACHIEVED' | 'DROPPED'
  readonly priority: 'P0' | 'P1' | 'P2' | 'P3'
  readonly targetDate: number | null
}

export const ObjectiveDtoSchema = z
  .object({
    id: z.string().regex(/^OBJ-[1-9][0-9]*$/),
    scope: z.enum(['PROJECT', 'TOPIC']),
    statement: z.string().min(1),
    status: objStatus,
    priority: objPriority,
    targetDate: epochMs.nullable(),
  })
  .strict()

/** One Topic card (dashboard/project level — §27.1/§27.2). */
export interface TopicCardDto {
  readonly id: string
  readonly title: string
  readonly workstreamCount: number
}

export const TopicCardDtoSchema = z
  .object({
    id: idTopic,
    title: z.string().min(1),
    workstreamCount: z.number().int().nonnegative(),
  })
  .strict()

/** One Workstream summary card (topic page — §27.3). */
export interface WorkstreamCardDto {
  readonly id: string
  readonly title: string
  readonly lifecycle: 'PLANNED' | 'REALIZED' | 'DROPPED'
  readonly summary: string | null
  /** Canonical plan size (ordered G/T/M ids in `plan.yaml`). */
  readonly planItemCount: number
  /** PF with status OPEN (the actionable overlay proposals). */
  readonly openPlanForkCount: number
  /** Runs with status RUNNING (the Current-zone live signal). */
  readonly runningRunCount: number
}

export const WorkstreamCardDtoSchema = z
  .object({
    id: idWorkstream,
    title: z.string().min(1),
    lifecycle: wsLifecycle,
    summary: z.string().nullish(),
    planItemCount: z.number().int().nonnegative(),
    openPlanForkCount: z.number().int().nonnegative(),
    runningRunCount: z.number().int().nonnegative(),
  })
  .strict()

/** One topology edge (§3.1; the topic graph's node/edge data — §27.5). */
export interface TopologyEdgeDto {
  readonly id: string
  readonly operation: 'FORK' | 'MERGE'
  readonly lifecycle: 'PLANNED' | 'REALIZED' | 'DROPPED'
  readonly inputs: readonly string[]
  readonly outputs: readonly string[]
  readonly note: string | null
}

export const TopologyEdgeDtoSchema = z
  .object({
    id: z.string().regex(/^TE-[1-9][0-9]*$/),
    operation: edgeOp,
    lifecycle: wsLifecycle,
    inputs: z.array(idWorkstream),
    outputs: z.array(idWorkstream),
    note: z.string().nullish(),
  })
  .strict()

/** A merge-contract reference (badge data — §27.5; the content itself is
 *  free Markdown read on demand, not part of the snapshot). */
export interface MergeContractRefDto {
  readonly edgeId: string
  readonly path: string
}

export const MergeContractRefDtoSchema = z
  .object({
    edgeId: z.string().regex(/^TE-[1-9][0-9]*$/),
    path: z.string().min(1),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 1. getDashboard — no parameters (the host carries exactly one project;
 *    the V1 precondition the wiring enforces at startup).
 *    §27.1 Home/Portfolio Dashboard minimal snapshot.
 * -------------------------------------------------------------------- */

export interface DashboardSnapshot {
  readonly project: {
    readonly id: string
    readonly title: string
    readonly description: string | null
    readonly importance: number
    readonly attentionMode: 'FOCUS' | 'NORMAL' | 'BACKGROUND'
    readonly targetDate: number | null
  }
  readonly topics: readonly TopicCardDto[]
  /** §27.1: OPEN Interventions (always complete — INV-ATTN-1). */
  readonly openInterventions: readonly InterventionDto[]
  /** §27.1: PENDING Interventions (always complete — INV-ATTN-1). */
  readonly pendingInterventions: readonly InterventionDto[]
  /**
   * PHASE 5 placeholder (WP-5.3, DOMAIN_SCHEMA §10.3): the ScheduledEvent
   * operational store does not exist yet — `null` until then, never a
   * fabricated empty list masquerading as data.
   */
  readonly scheduledEvents: null
  /** PHASE 5 placeholder (WP-5.3, DOMAIN_SCHEMA §10.2): ReportingItem. */
  readonly reportingItems: null
  /**
   * RR-018② (WP-7.2): Research Inbox count — the REAL number of open
   * (CAPTURED, awaiting the user) inbox items, aggregated by getDashboard
   * from the production Inbox service. The reserved Phase 6 placeholder
   * (`null`) is now filled: the field's NAME and POSITION are unchanged
   * (形状不变兼容) — only the value type moves `null → non-negative int`
   * (documented exemption: `src/shared/rpc-contracts.ts` was outside the
   * WP-7.2 authorized-add list; the G6 verdict reserved exactly this
   * placeholder for the real count, and the strict wire schema makes the
   * relaxation the only way the count can cross the frozen 13-RPC).
   */
  readonly inboxCount: number
  /** PHASE 5 placeholder (WP-5.4): Attention Manager recommended order. */
  readonly attention: null
}

export const DashboardSnapshotSchema = z
  .object({
    project: z
      .object({
        id: z.string().regex(/^PRJ-[1-9][0-9]*$/),
        title: z.string().min(1),
        description: z.string().nullish(),
        importance: z.number().int().nonnegative(),
        attentionMode,
        targetDate: epochMs.nullable(),
      })
      .strict(),
    topics: z.array(TopicCardDtoSchema),
    openInterventions: z.array(InterventionDtoSchema),
    pendingInterventions: z.array(InterventionDtoSchema),
    scheduledEvents: z.null(),
    reportingItems: z.null(),
    // RR-018②: the reserved placeholder is now the real CAPTURED count.
    inboxCount: z.number().int().nonnegative(),
    attention: z.null(),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 2. getProject — no parameters (single project per host, V1).
 *    §27.2 Project Page minimal snapshot.
 * -------------------------------------------------------------------- */

export interface ProjectSnapshot {
  readonly project: {
    readonly id: string
    readonly title: string
    readonly description: string | null
    readonly importance: number
    readonly attentionMode: 'FOCUS' | 'NORMAL' | 'BACKGROUND'
    readonly targetDate: number | null
    readonly currentObjectiveRefs: readonly string[]
    readonly createdAt: number
  }
  readonly objectives: readonly ObjectiveDto[]
  readonly topics: readonly TopicCardDto[]
  /** PHASE 5 placeholder (WP-5.3, §27.2 「upcoming interactions/reporting」). */
  readonly upcomingInteractions: null
  readonly upcomingReporting: null
}

export const ProjectSnapshotSchema = z
  .object({
    project: z
      .object({
        id: z.string().regex(/^PRJ-[1-9][0-9]*$/),
        title: z.string().min(1),
        description: z.string().nullish(),
        importance: z.number().int().nonnegative(),
        attentionMode,
        targetDate: epochMs.nullable(),
        currentObjectiveRefs: z.array(z.string().regex(/^OBJ-[1-9][0-9]*$/)),
        createdAt: epochMs,
      })
      .strict(),
    objectives: z.array(ObjectiveDtoSchema),
    topics: z.array(TopicCardDtoSchema),
    upcomingInteractions: z.null(),
    upcomingReporting: z.null(),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 3. getTopic — §27.3 Topic Page minimal snapshot.
 * -------------------------------------------------------------------- */

export interface GetTopicArgs {
  readonly topicId: string
}

export const GetTopicArgsSchema = z
  .object({
    topicId: idTopic,
  })
  .strict()

export interface TopicSnapshot {
  readonly topic: {
    readonly id: string
    readonly title: string
    readonly description: string | null
    readonly importance: number | null
    readonly attentionMode: 'FOCUS' | 'NORMAL' | 'BACKGROUND' | null
    readonly objectiveRefs: readonly string[]
    readonly createdAt: number
  }
  /** §27.3: Workstream summary cards. */
  readonly workstreams: readonly WorkstreamCardDto[]
  /** §27.5: the Workstream topology graph edge set (topic-scoped). */
  readonly topology: { readonly edges: readonly TopologyEdgeDto[] }
  /** §27.5: merge contract badges (edges that carry a contract file). */
  readonly mergeContracts: readonly MergeContractRefDto[]
  /** §27.3: Topic-level Objective (scope=TOPIC, this topic). */
  readonly objectives: readonly ObjectiveDto[]
}

export const TopicSnapshotSchema = z
  .object({
    topic: z
      .object({
        id: idTopic,
        title: z.string().min(1),
        description: z.string().nullish(),
        importance: z.number().int().nonnegative().nullish(),
        attentionMode: attentionMode.nullable(),
        objectiveRefs: z.array(z.string().regex(/^OBJ-[1-9][0-9]*$/)),
        createdAt: epochMs,
      })
      .strict(),
    workstreams: z.array(WorkstreamCardDtoSchema),
    topology: z.object({ edges: z.array(TopologyEdgeDtoSchema) }).strict(),
    mergeContracts: z.array(MergeContractRefDtoSchema),
    objectives: z.array(ObjectiveDtoSchema),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 4. getWorkstream — §27.4 Workstream Page 核心三区 minimal snapshot.
 * -------------------------------------------------------------------- */

export interface GetWorkstreamArgs {
  readonly workstreamId: string
}

export const GetWorkstreamArgsSchema = z
  .object({
    workstreamId: idWorkstream,
  })
  .strict()

/** One canonical plan item in its plan position (Future zone — §27.4). */
export interface PlanItemDto {
  readonly id: string
  readonly kind: 'TASK' | 'GATE' | 'MILESTONE'
  readonly title: string
}

export const PlanItemDtoSchema = z
  .object({
    id: z.union([idTask, z.string().regex(/^G-[1-9][0-9]*$/), z.string().regex(/^M-[1-9][0-9]*$/)]),
    kind: planItemKind,
    title: z.string().min(1),
  })
  .strict()

/** One task in the Current zone: the declarative definition + the
 *  execution/validation state folded from the WS event log (the history
 *  replay face; the fold is a read projection — the state machine itself
 *  is enforced at append time). */
export interface CurrentTaskDto {
  readonly id: string
  readonly title: string
  readonly execution: 'PLANNED' | 'ACTIVE' | 'PAUSED' | 'EXECUTED' | 'CANCELLED'
  readonly validation: 'NOT_REQUIRED' | 'PENDING' | 'UNDER_REVIEW' | 'PASSED' | 'FAILED'
  readonly acceptanceCriteria: readonly string[]
  /** Runs with status RUNNING bound to this task (the §27.4 「live Run」
   *  join; the Run detail itself rides in the sibling `runs` list). */
  readonly liveRunIds: readonly string[]
}

export const CurrentTaskDtoSchema = z
  .object({
    id: idTask,
    title: z.string().min(1),
    execution: taskExecution,
    validation: taskValidation,
    acceptanceCriteria: z.array(z.string()),
    liveRunIds: z.array(z.string().regex(/^R-[1-9][0-9]*$/)),
  })
  .strict()

/** One Run (Current zone — §27.4 「live Run / last heartbeat/checkpoint」;
 *  the DSH session pointer only — INV-DB-2). */
export interface RunDto {
  readonly id: string
  readonly status: 'RUNNING' | 'FINISHED' | 'FAILED' | 'CANCELLED'
  readonly taskId: string | null
  readonly intent: string | null
  readonly startedAt: number
  readonly endedAt: number | null
  readonly lastCheckpointAt: number | null
  readonly lastCheckpointNote: string | null
}

export const RunDtoSchema = z
  .object({
    id: z.string().regex(/^R-[1-9][0-9]*$/),
    status: runStatus,
    taskId: idTask.nullable(),
    intent: z.string().nullish(),
    startedAt: epochMs,
    endedAt: epochMs.nullable(),
    lastCheckpointAt: epochMs.nullable(),
    lastCheckpointNote: z.string().nullish(),
  })
  .strict()

/** One unresolved Agent PlanFork (Future zone overlay — §27.4/§27.6:
 *  status OPEN or STALE; SELECTED/DISMISSED are terminal and leave the
 *  overlay). Item-level proposal detail stays in the PF store (the
 *  overlay renders from anchors + count until a PF-detail RPC is needed). */
export interface PlanForkDto {
  readonly id: string
  readonly status: 'OPEN' | 'STALE'
  readonly reason: string
  readonly necessity: string
  readonly forkAnchor: string
  readonly mergeAnchor: string
  readonly createdByRun: string
  readonly createdAt: number
  readonly staleReason: string | null
  readonly proposedItemCount: number
  readonly baseGitCommit: string | null
}

export const PlanForkDtoSchema = z
  .object({
    id: idPlanFork,
    status: z.enum(['OPEN', 'STALE']),
    reason: z.string().min(1),
    necessity: z.string().min(1),
    forkAnchor: z.string().min(1),
    mergeAnchor: z.string().min(1),
    createdByRun: z.string().regex(/^R-[1-9][0-9]*$/),
    createdAt: epochMs,
    staleReason: z.string().nullish(),
    proposedItemCount: z.number().int().nonnegative(),
    baseGitCommit: fullOid.nullable(),
  })
  .strict()

export interface WorkstreamSnapshot {
  readonly workstream: {
    readonly id: string
    readonly topicId: string
    readonly title: string
    readonly lifecycle: 'PLANNED' | 'REALIZED' | 'DROPPED'
    readonly summary: string | null
    readonly createdAt: number
  }
  /** History zone: the log size (the page itself is `queryHistory`). */
  readonly history: { readonly eventCount: number }
  /** Current Execution zone (§27.4). */
  readonly current: {
    readonly tasks: readonly CurrentTaskDto[]
    readonly runs: readonly RunDto[]
  }
  /** Future Plan zone (§27.4): canonical G/T/M + unresolved PF overlay. */
  readonly future: {
    readonly plan: { readonly orderedItems: readonly PlanItemDto[] }
    readonly planForks: readonly PlanForkDto[]
    /** OPEN + STALE PFs (the unresolved set, §3.1). */
    readonly unresolvedPlanForkCount: number
  }
}

export const WorkstreamSnapshotSchema = z
  .object({
    workstream: z
      .object({
        id: idWorkstream,
        topicId: idTopic,
        title: z.string().min(1),
        lifecycle: wsLifecycle,
        summary: z.string().nullish(),
        createdAt: epochMs,
      })
      .strict(),
    history: z
      .object({ eventCount: z.number().int().nonnegative() })
      .strict(),
    current: z
      .object({
        tasks: z.array(CurrentTaskDtoSchema),
        runs: z.array(RunDtoSchema),
      })
      .strict(),
    future: z
      .object({
        plan: z.object({ orderedItems: z.array(PlanItemDtoSchema) }).strict(),
        planForks: z.array(PlanForkDtoSchema),
        unresolvedPlanForkCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 5. queryHistory — pagination parameters aligned 1:1 with the replay
 *    query face (src/host/history/replay queryEvents: afterSeq/beforeSeq/
 *    limit on the audit-seq axis, semantic/audit order — TC-PERF-004
 *    O(window) protocol; §8: History 按页面/时间窗口分页).
 * -------------------------------------------------------------------- */

export interface QueryHistoryArgs {
  /** The single owner workstream of the log (INV-HIST-3: a query is
   *  scoped to ONE owner and cannot mix owners). */
  readonly workstreamId: string
  /** Replay order. Default `'semantic'` (the default UI timeline). */
  readonly order?: 'semantic' | 'audit'
  /** Exclusive lower bound on `eventSeq`. Default 0 = from the beginning. */
  readonly afterSeq?: number
  /** Exclusive upper bound on `eventSeq` (must be > afterSeq + 1). */
  readonly beforeSeq?: number
  /** Page size in rows (caps the window at afterSeq + limit). */
  readonly limit?: number
}

export const QueryHistoryArgsSchema = z
  .object({
    workstreamId: idWorkstream,
    order: replayOrder.optional(),
    afterSeq: z.number().int().nonnegative().optional(),
    beforeSeq: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict()

/** One history event: the frozen envelope (HISTORY_EVENT_CATALOG §1) as
 *  stored — camelCase envelope, frozen snake_case JSON carriers for
 *  actor/source. `payload` is the per-event-type JSON validated against
 *  the frozen catalog schemas at append time (the WP-2.2 registry); the
 *  RPC face carries it verbatim (no re-validation of 20 payload shapes at
 *  the wire — the catalog is a separate frozen face). */
export interface HistoryEventDto {
  readonly eventId: string
  readonly ownerWorkstreamId: string
  readonly eventType: string
  readonly schemaVersion: number
  readonly occurredAt: number
  readonly actor: {
    readonly kind: string
    readonly user_id?: string
    readonly run_id?: string
    readonly session_id?: string
    readonly label?: string
  }
  readonly source:
    | {
        readonly kind: string
        readonly session_id?: string
        readonly path?: string
        readonly commit_oid?: string
        readonly interaction_id?: string
        readonly note?: string
      }
    | null
  readonly payload: Record<string, unknown>
  readonly eventSeq: number
  readonly recordedAt: number
}

export const HistoryEventDtoSchema = z
  .object({
    eventId: z.string().regex(/^H-[1-9][0-9]*$/),
    ownerWorkstreamId: idWorkstream,
    eventType: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    occurredAt: epochMs,
    actor: actorRefJson,
    source: sourceRefJson.nullable(),
    payload: z.record(z.string(), z.unknown()),
    eventSeq: z.number().int().positive(),
    recordedAt: epochMs,
  })
  .strict()

export interface QueryHistoryResult {
  /** The window's rows, in the requested order (the page is NEVER
   *  truncated mid-window — the seq-axis partition protocol). */
  readonly events: readonly HistoryEventDto[]
  /** Exclusive lower bound for the NEXT page, or `null` when `exhausted`. */
  readonly nextAfterSeq: number | null
  readonly exhausted: boolean
}

export const QueryHistoryResultSchema = z
  .object({
    events: z.array(HistoryEventDtoSchema),
    nextAfterSeq: z.number().int().nonnegative().nullable(),
    exhausted: z.boolean(),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 6. reorderPlan — USER semantics (ARCHITECTURE §6: canonical plan
 *    reorder is ✅ USER / ❌ AGENT; the client face IS the user face and
 *    the host gateway bounds the matrix). The contract is a REORDER:
 *    `orderedItemIds` must be a permutation of the current plan's items
 *    (insert/delete are NOT in the frozen 13-RPC list — the kernel's
 *    §4.4 validations still apply on the write).
 * -------------------------------------------------------------------- */

export interface ReorderPlanArgs {
  readonly workstreamId: string
  readonly orderedItemIds: readonly string[]
}

export const ReorderPlanArgsSchema = z
  .object({
    workstreamId: idWorkstream,
    orderedItemIds: z.array(z.string().min(1)),
  })
  .strict()

export interface ReorderPlanResult {
  readonly workstreamId: string
  readonly orderedItemIds: readonly string[]
  /** The rewritten `plan.yaml` (`.research`-relative POSIX). */
  readonly planPath: string
  /** The `management_action` PLAN_REORDER ledger row (DOMAIN_SCHEMA
   *  §12.1: ResearchHistory does NOT record plan management ops). */
  readonly managementActionId: string
}

export const ReorderPlanResultSchema = z
  .object({
    workstreamId: idWorkstream,
    orderedItemIds: z.array(z.string().min(1)),
    planPath: z.string().min(1),
    managementActionId: idManagementAction,
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 7./8. selectPlanFork / dismissPlanFork — USER semantics (INV-PERM-2:
 *    no Agent face; the forwarded service re-asserts actor.kind == USER
 *    at runtime — the RPC face passes the frozen USER actor, the client
 *    has no identity of its own).
 * -------------------------------------------------------------------- */

export interface SelectPlanForkArgs {
  readonly planForkId: string
}

export const SelectPlanForkArgsSchema = z
  .object({
    planForkId: idPlanFork,
  })
  .strict()

export interface SelectPlanForkResult {
  readonly planForkId: string
  readonly workstreamId: string
  readonly statusBefore: 'OPEN'
  readonly statusAfter: 'SELECTED'
  readonly selectedAt: number
  /** The canonical order before materialization (snapshot). */
  readonly oldOrder: readonly string[]
  /** §6.3 splice result (the post-materialization ordered_items). */
  readonly newOrder: readonly string[]
  /** The materialized NEW items (formal id + definition path). */
  readonly newItems: readonly { readonly id: string; readonly kind: 'TASK' | 'GATE' | 'MILESTONE'; readonly path: string }[]
  /** Items leaving the plan (definition files retained — INV-PLAN-9). */
  readonly removedIds: readonly string[]
  /** §6.5 chained stale-marking of the other OPEN PFs of the workstream. */
  readonly staleOthers: readonly { readonly planForkId: string; readonly staleReason: string }[]
  /** The rewritten `plan.yaml` (`.research`-relative POSIX). */
  readonly planYamlPath: string
  /** §6.7 checkpoint hint (explicit, optional, NEVER automatic — INV-GIT-2). */
  readonly checkpointHint: string
}

export const SelectPlanForkResultSchema = z
  .object({
    planForkId: idPlanFork,
    workstreamId: idWorkstream,
    statusBefore: z.literal('OPEN'),
    statusAfter: z.literal('SELECTED'),
    selectedAt: epochMs,
    oldOrder: z.array(z.string().min(1)),
    newOrder: z.array(z.string().min(1)),
    /** Materialized NEW items (empty for a reorder-only proposal). */
    newItems: z.array(z.object({ id: z.string().min(1), kind: planItemKind, path: z.string().min(1) }).strict()),
    removedIds: z.array(z.string().min(1)),
    /** Always present (an empty array when nothing else went stale). */
    staleOthers: z.array(z.object({ planForkId: idPlanFork, staleReason: z.string().min(1) }).strict()),
    planYamlPath: z.string().min(1),
    checkpointHint: z.string().min(1),
  })
  .strict()

export interface DismissPlanForkArgs {
  readonly planForkId: string
}

export const DismissPlanForkArgsSchema = z
  .object({
    planForkId: idPlanFork,
  })
  .strict()

export interface DismissPlanForkResult {
  readonly planForkId: string
  readonly workstreamId: string
  readonly statusBefore: 'OPEN' | 'STALE'
  readonly statusAfter: 'DISMISSED'
  readonly dismissedAt: number
}

export const DismissPlanForkResultSchema = z
  .object({
    planForkId: idPlanFork,
    workstreamId: idWorkstream,
    statusBefore: z.enum(['OPEN', 'STALE']),
    statusAfter: z.literal('DISMISSED'),
    dismissedAt: epochMs,
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 9. updateInterventionState — USER semantics (INV-PERM-4: Intervention
 *    OPEN/PENDING/CLOSED is user-only; the forwarded §13 transition guard
 *    rejects illegal pairs, self-loops included; CLOSED is terminal —
 *    reopening = a NEW Intervention).
 * -------------------------------------------------------------------- */

export interface UpdateInterventionStateArgs {
  readonly interventionId: string
  readonly status: 'OPEN' | 'PENDING' | 'CLOSED'
  /** Only for `status: 'CLOSED'` (「关闭时用户填写」, DOMAIN_SCHEMA §9.2). */
  readonly resolutionNote?: string
}

export const UpdateInterventionStateArgsSchema = z
  .object({
    interventionId: idIntervention,
    status: ivStatus,
    resolutionNote: z.string().optional(),
  })
  .strict()

export interface UpdateInterventionStateResult {
  readonly interventionId: string
  readonly statusFrom: 'OPEN' | 'PENDING' | 'CLOSED'
  readonly statusTo: 'OPEN' | 'PENDING' | 'CLOSED'
  /** Written when `statusTo === 'CLOSED'` (epoch ms). */
  readonly closedAt: number | null
  readonly resolutionNote: string | null
}

export const UpdateInterventionStateResultSchema = z
  .object({
    interventionId: idIntervention,
    statusFrom: ivStatus,
    statusTo: ivStatus,
    closedAt: epochMs.nullable(),
    resolutionNote: z.string().nullish(),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 10. registerInteraction — USER semantics (DOMAIN_SCHEMA §10.1: 登记
 *    Interaction is a user operation; §6 matrix has no AGENT row for
 *    Interaction recording — user/agent 登记 via the GUI only).
 *    The Interaction operational store is a PHASE 5 deliverable (WP-5.3);
 *    the wire contract and the port seam are frozen HERE, the production
 *    registration lands with the store (the placeholder discipline of
 *    the result DTOs — never a fabricated row).
 * -------------------------------------------------------------------- */

export interface RegisterInteractionArgs {
  readonly kind:
    | 'MEETING'
    | 'AD_HOC_DISCUSSION'
    | 'SUPERVISOR_UPDATE'
    | 'COLLABORATOR_DISCUSSION'
    | 'EXPERIMENT_SHIFT_HANDOFF'
    | 'OTHER'
  readonly title: string
  readonly occurredAt: number
  readonly participants?: readonly string[]
  readonly notes?: string
  readonly relatedWorkstreams?: readonly string[]
}

export const RegisterInteractionArgsSchema = z
  .object({
    kind: interactionKind,
    title: z.string().min(1),
    occurredAt: epochMs,
    participants: z.array(z.string().min(1)).optional(),
    notes: z.string().optional(),
    relatedWorkstreams: z.array(idWorkstream).optional(),
  })
  .strict()

export interface RegisterInteractionResult {
  /** The allocated INT id (`INT-<n>`, PROJECT scope — DOMAIN_SCHEMA §1.1). */
  readonly id: string
  readonly kind:
    | 'MEETING'
    | 'AD_HOC_DISCUSSION'
    | 'SUPERVISOR_UPDATE'
    | 'COLLABORATOR_DISCUSSION'
    | 'EXPERIMENT_SHIFT_HANDOFF'
    | 'OTHER'
  readonly title: string
  readonly occurredAt: number
  readonly participants: readonly string[]
  readonly notes: string | null
  readonly relatedWorkstreams: readonly string[]
  readonly createdAt: number
}

export const RegisterInteractionResultSchema = z
  .object({
    id: idInteraction,
    kind: interactionKind,
    title: z.string().min(1),
    occurredAt: epochMs,
    participants: z.array(z.string().min(1)),
    notes: z.string().nullish(),
    relatedWorkstreams: z.array(idWorkstream),
    createdAt: epochMs,
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 11. saveResearchCheckpoint — USER semantics (INV-GIT-2: checkpoint 仅
 *    用户显式触发; the forwarded service enforces the §5 flow: conflict
 *    detection, `.research/**`-only pathspec (INV-GIT-3), fail-loud).
 * -------------------------------------------------------------------- */

export interface SaveResearchCheckpointArgs {
  /** The commit summary; the message is `research: <summary>` (§5). */
  readonly summary: string
}

export const SaveResearchCheckpointArgsSchema = z
  .object({
    summary: z.string().min(1),
  })
  .strict()

export interface SaveResearchCheckpointResult {
  /** false only for the no-change short-circuit (a successful no-op;
   *  no empty commit — TC-GIT-014). */
  readonly committed: boolean
  readonly commitOid: string | null
  /** The `.research/**` paths that entered the commit (sorted). */
  readonly changedFiles: readonly string[]
  readonly warnings: readonly string[]
  readonly message: string | null
}

export const SaveResearchCheckpointResultSchema = z
  .object({
    committed: z.boolean(),
    commitOid: fullOid.nullable(),
    changedFiles: z.array(z.string().min(1)),
    warnings: z.array(z.string()),
    message: z.string().nullish(),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 12. getGitHistory — read-only (the W6 file-log face of the checkpoint
 *    service, `.research/**`-scoped; pagination per §9 输出超大).
 * -------------------------------------------------------------------- */

export interface GetGitHistoryArgs {
  /** One `.research/**` file (repo-root-relative); default: the whole
   *  `.research/**` tree. */
  readonly path?: string
  /** Baseline commit OID (full 40-hex) for the file-level diff face. */
  readonly baseline?: string
  /** Max versions returned (W6 pagination). */
  readonly maxCount?: number
  /** Skip the newest N versions (W6 pagination). */
  readonly skip?: number
}

export const GetGitHistoryArgsSchema = z
  .object({
    path: z.string().min(1).optional(),
    baseline: fullOid.optional(),
    maxCount: z.number().int().positive().max(1000).optional(),
    skip: z.number().int().nonnegative().optional(),
  })
  .strict()

export interface GitVersionDto {
  readonly oid: string
  readonly authorDate: string
  readonly subject: string
}

export const GitVersionDtoSchema = z
  .object({
    oid: fullOid,
    authorDate: z.string().min(1),
    subject: z.string(),
  })
  .strict()

export interface GitDiffEntryDto {
  /** Status token as printed: M / A / D / T / R100 / C75 … */
  readonly status: string
  readonly path: string
  readonly oldPath: string | null
}

export const GitDiffEntryDtoSchema = z
  .object({
    status: z.string().min(1),
    path: z.string().min(1),
    oldPath: z.string().nullish(),
  })
  .strict()

export interface GetGitHistoryResult {
  /** W6 version list, newest → oldest. */
  readonly versions: readonly GitVersionDto[]
  /** Baseline ↔ working-tree file-level M/A/D/R (`.research/**` only);
   *  `null` when no baseline was given. */
  readonly fileDiff: readonly GitDiffEntryDto[] | null
  readonly baseline: string | null
  /** Single-file vs baseline content verdict (only when `path` and
   *  `baseline` are both given); `null` otherwise / when the baseline
   *  commit does not contain the path. */
  readonly pathContent: { readonly path: string; readonly sameAsBaseline: boolean } | null
}

export const GetGitHistoryResultSchema = z
  .object({
    versions: z.array(GitVersionDtoSchema),
    fileDiff: z.array(GitDiffEntryDtoSchema).nullable(),
    baseline: fullOid.nullable(),
    pathContent: z
      .object({ path: z.string().min(1), sameAsBaseline: z.boolean() })
      .strict()
      .nullable(),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 13. restoreDeclarativeFile — USER semantics (INV-GIT-5: restore 需用户
 *    显式触发; the forwarded service enforces W6/W7/W8 + post-restore
 *    schema validation — 非法内容不静默, 保留原状).
 * -------------------------------------------------------------------- */

export interface RestoreDeclarativeFileArgs {
  /** The source commit (full 40-hex OID). */
  readonly commitOid: string
  /** The file to restore (repo-root-relative, inside `.research/**`). */
  readonly path: string
}

export const RestoreDeclarativeFileArgsSchema = z
  .object({
    commitOid: fullOid,
    path: z.string().min(1),
  })
  .strict()

export interface RestoreDeclarativeFileResult {
  readonly path: string
  readonly commitOid: string
  /** Post-restore loader validation verdict for the restored file (§6). */
  readonly validationOk: boolean
  readonly validationErrors: readonly {
    readonly file: string
    readonly path: string | null
    readonly summary: string
  }[]
  /** §6: illegal content → warning + the file is kept as-is (no silent
   *  rollback). */
  readonly warnings: readonly string[]
}

export const RestoreDeclarativeFileResultSchema = z
  .object({
    path: z.string().min(1),
    commitOid: fullOid,
    validationOk: z.boolean(),
    /** Always present (empty when the restored file validates). */
    validationErrors: z.array(z.object({ file: z.string(), path: z.string().nullish(), summary: z.string() }).strict()),
    warnings: z.array(z.string()),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * The 13 hand-written InvocationDescriptors (U4 fallback — WP-0.3
 * precedent: the typert generator cannot run in this workspace; the
 * strict codec re-uses the shared zod schemas above so the wire contract
 * is identical on both artifact faces).
 *
 * `id` follows the generator's invocation-identity grammar
 * (`<serviceKey>#<namespace>/<exportedMethod>`). Every method takes at
 * most ONE business parameter (wire `args`); no cancellation (the §5
 * step-4 signal contract applies to long-running RPCs — V1 keeps the
 * unary face plain; the low-frequency per §8). The RR-006 arity test
 * pins `descriptor.parameters.length === method.length` for all 14.
 * -------------------------------------------------------------------- */

function argsParameter(argsSymbol: string, schema: TypertSchemaLike): InvocationParameterMirror {
  return {
    name: 'args',
    wire: 'args',
    source: 'json',
    codec: { mode: 'strict', typeSymbol: argsSymbol, schema },
  }
}

function descriptor(method: ResearchRpcMethod, parameters: readonly InvocationParameterMirror[], resultSymbol: string, resultSchema: TypertSchemaLike): InvocationDescriptorMirror {
  return {
    id: `${RESEARCH_CONTROL_NAMESPACE}#${RESEARCH_CONTROL_NAMESPACE}/${method}`,
    service: RESEARCH_CONTROL_NAMESPACE,
    namespace: RESEARCH_CONTROL_NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters,
    result: { mode: 'strict', typeSymbol: resultSymbol, schema: resultSchema },
  }
}

export const getDashboardInvocation: InvocationDescriptorMirror = descriptor(
  'getDashboard',
  [],
  'DashboardSnapshot',
  DashboardSnapshotSchema,
)

export const getProjectInvocation: InvocationDescriptorMirror = descriptor(
  'getProject',
  [],
  'ProjectSnapshot',
  ProjectSnapshotSchema,
)

export const getTopicInvocation: InvocationDescriptorMirror = descriptor(
  'getTopic',
  [argsParameter('GetTopicArgs', GetTopicArgsSchema)],
  'TopicSnapshot',
  TopicSnapshotSchema,
)

export const getWorkstreamInvocation: InvocationDescriptorMirror = descriptor(
  'getWorkstream',
  [argsParameter('GetWorkstreamArgs', GetWorkstreamArgsSchema)],
  'WorkstreamSnapshot',
  WorkstreamSnapshotSchema,
)

export const queryHistoryInvocation: InvocationDescriptorMirror = descriptor(
  'queryHistory',
  [argsParameter('QueryHistoryArgs', QueryHistoryArgsSchema)],
  'QueryHistoryResult',
  QueryHistoryResultSchema,
)

export const reorderPlanInvocation: InvocationDescriptorMirror = descriptor(
  'reorderPlan',
  [argsParameter('ReorderPlanArgs', ReorderPlanArgsSchema)],
  'ReorderPlanResult',
  ReorderPlanResultSchema,
)

export const selectPlanForkInvocation: InvocationDescriptorMirror = descriptor(
  'selectPlanFork',
  [argsParameter('SelectPlanForkArgs', SelectPlanForkArgsSchema)],
  'SelectPlanForkResult',
  SelectPlanForkResultSchema,
)

export const dismissPlanForkInvocation: InvocationDescriptorMirror = descriptor(
  'dismissPlanFork',
  [argsParameter('DismissPlanForkArgs', DismissPlanForkArgsSchema)],
  'DismissPlanForkResult',
  DismissPlanForkResultSchema,
)

export const updateInterventionStateInvocation: InvocationDescriptorMirror = descriptor(
  'updateInterventionState',
  [argsParameter('UpdateInterventionStateArgs', UpdateInterventionStateArgsSchema)],
  'UpdateInterventionStateResult',
  UpdateInterventionStateResultSchema,
)

export const registerInteractionInvocation: InvocationDescriptorMirror = descriptor(
  'registerInteraction',
  [argsParameter('RegisterInteractionArgs', RegisterInteractionArgsSchema)],
  'RegisterInteractionResult',
  RegisterInteractionResultSchema,
)

export const saveResearchCheckpointInvocation: InvocationDescriptorMirror = descriptor(
  'saveResearchCheckpoint',
  [argsParameter('SaveResearchCheckpointArgs', SaveResearchCheckpointArgsSchema)],
  'SaveResearchCheckpointResult',
  SaveResearchCheckpointResultSchema,
)

export const getGitHistoryInvocation: InvocationDescriptorMirror = descriptor(
  'getGitHistory',
  [argsParameter('GetGitHistoryArgs', GetGitHistoryArgsSchema)],
  'GetGitHistoryResult',
  GetGitHistoryResultSchema,
)

export const restoreDeclarativeFileInvocation: InvocationDescriptorMirror = descriptor(
  'restoreDeclarativeFile',
  [argsParameter('RestoreDeclarativeFileArgs', RestoreDeclarativeFileArgsSchema)],
  'RestoreDeclarativeFileResult',
  RestoreDeclarativeFileResultSchema,
)

/**
 * The 13 WP-4.1a invocation descriptors (order = the frozen §7.1 list).
 * Both artifact faces export the SAME objects (the WP-0.3
 * no-drift-by-construction rule, extended from ping to the full face).
 */
export const RESEARCH_RPC_INVOCATIONS: readonly InvocationDescriptorMirror[] = [
  getDashboardInvocation,
  getProjectInvocation,
  getTopicInvocation,
  getWorkstreamInvocation,
  queryHistoryInvocation,
  reorderPlanInvocation,
  selectPlanForkInvocation,
  dismissPlanForkInvocation,
  updateInterventionStateInvocation,
  registerInteractionInvocation,
  saveResearchCheckpointInvocation,
  getGitHistoryInvocation,
  restoreDeclarativeFileInvocation,
]

/**
 * The FULL host-face invocation list (ping first — the WP-0.3 diagnostic
 * method stays the 14th — then the 13 §7.1 RPCs). Both artifact faces
 * (host `./typert`, client `./remote`) must expose exactly this set.
 */
export const ALL_RESEARCH_INVOCATIONS: readonly InvocationDescriptorMirror[] = [
  pingInvocation,
  ...RESEARCH_RPC_INVOCATIONS,
]
