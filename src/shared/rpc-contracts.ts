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

/**
 * The 13 frozen RPC method names (ARCHITECTURE.md §7.1, order preserved).
 *
 * V2 §12.1 (实施期裁决): the 11 parameterized request schemas below gain
 * the OPTIONAL `projectId` field (a strict-schema backward-compatible
 * extension — a caller that omits it parses byte-identically, and the
 * RESULT schemas of all 13 stay zero-touched). Resolution is the
 * §12.1 rule (implemented by the discovery layer's `resolveProject`):
 * explicit id → that project (absent / not active → a clear error);
 * omitted → exactly one active project → it; omitted with several → a
 * clear error listing the projects. The two zero-arg queries
 * (getDashboard / getProject) have no request object and keep their
 * frozen zero-parameter face (see the module header for the ruling).
 */
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
/** UI-4 (D §10): the attention-object id families (§1.1 L33/L35/L36). */
const idObjective = z.string().regex(/^OBJ-[1-9][0-9]*$/)
const idNextAction = z.string().regex(/^NA-[1-9][0-9]*$/)
const idBlocker = z.string().regex(/^BLK-[1-9][0-9]*$/)
const fullOid = z.string().regex(/^[0-9a-f]{40}$/)

/**
 * V2 project id (frozen `PRJ-[1-9][0-9]*` — the same pattern the T2.3
 * registry kernel pins in `PROJECT_ID_PATTERN`; the §12.1 routing key
 * and the plane-state project/missing entries).
 */
const idProject = z.string().regex(/^PRJ-[1-9][0-9]*$/)

/**
 * V2 workspace path (an absolute path — POSIX `/…`, Windows drive
 * `C:\…` / `C:/…`, or UNC `\\…`; the T2.3 registry kernel mirrors the
 * same `ABSOLUTE_PATH_PATTERN`: the registry stores exactly these).
 */
const absolutePath = z.string().regex(/^(?:[A-Za-z]:[\\/]|\\|\/)/)

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
/** UI-4 (D §10): the attention-object status vocabularies. */
const naStatus = z.enum(['PROPOSED', 'PROMOTED', 'DISMISSED'])
const blkStatus = z.enum(['ACTIVE', 'CLEARED'])
const affectsRefKind = z.enum(['WORKSTREAM', 'TASK', 'RUN'])
const linkedRefKind = z.enum(['GATE', 'MILESTONE', 'WORKSTREAM'])
const derivedBlockerSource = z.enum(['DEPENDENCY', 'GATE', 'RULE'])
const derivedBlockerTargetKind = z.enum(['TASK', 'GATE', 'MILESTONE', 'WORKSTREAM', 'RUN'])
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
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string
}

export const GetTopicArgsSchema = z
  .object({
    topicId: idTopic,
    projectId: idProject.optional(),
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
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string
}

export const GetWorkstreamArgsSchema = z
  .object({
    workstreamId: idWorkstream,
    projectId: idProject.optional(),
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
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string
}

export const QueryHistoryArgsSchema = z
  .object({
    workstreamId: idWorkstream,
    order: replayOrder.optional(),
    afterSeq: z.number().int().nonnegative().optional(),
    beforeSeq: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
    projectId: idProject.optional(),
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
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string
}

export const ReorderPlanArgsSchema = z
  .object({
    workstreamId: idWorkstream,
    orderedItemIds: z.array(z.string().min(1)),
    projectId: idProject.optional(),
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
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string
}

export const SelectPlanForkArgsSchema = z
  .object({
    planForkId: idPlanFork,
    projectId: idProject.optional(),
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
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string
}

export const DismissPlanForkArgsSchema = z
  .object({
    planForkId: idPlanFork,
    projectId: idProject.optional(),
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
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string
}

export const UpdateInterventionStateArgsSchema = z
  .object({
    interventionId: idIntervention,
    status: ivStatus,
    resolutionNote: z.string().optional(),
    projectId: idProject.optional(),
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
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string
}

export const RegisterInteractionArgsSchema = z
  .object({
    kind: interactionKind,
    title: z.string().min(1),
    occurredAt: epochMs,
    participants: z.array(z.string().min(1)).optional(),
    notes: z.string().optional(),
    relatedWorkstreams: z.array(idWorkstream).optional(),
    projectId: idProject.optional(),
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
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string
}

export const SaveResearchCheckpointArgsSchema = z
  .object({
    summary: z.string().min(1),
    projectId: idProject.optional(),
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
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string
}

export const GetGitHistoryArgsSchema = z
  .object({
    path: z.string().min(1).optional(),
    baseline: fullOid.optional(),
    maxCount: z.number().int().positive().max(1000).optional(),
    skip: z.number().int().nonnegative().optional(),
    projectId: idProject.optional(),
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
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string
}

export const RestoreDeclarativeFileArgsSchema = z
  .object({
    commitOid: fullOid,
    path: z.string().min(1),
    projectId: idProject.optional(),
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

function descriptor(method: ResearchRpcMethod | ResearchPlaneRpcMethod | ResearchManagementRpcMethod, parameters: readonly InvocationParameterMirror[], resultSymbol: string, resultSchema: TypertSchemaLike): InvocationDescriptorMirror {
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
 * The FULL invocation list of the FROZEN face (ping first — the WP-0.3
 * diagnostic method stays the 14th — then the 13 §7.1 RPCs). This list is
 * FROZEN: it names the V1 face exactly as ARCHITECTURE.md §7.1 froze it.
 * V2-T3.2a: the artifact faces register the SUPERSET {@link
 * REGISTERED_RESEARCH_INVOCATIONS} (frozen 14 + the 3 read-only plane
 * RPCs) — the frozen 14 itself stays byte-identical.
 */
export const ALL_RESEARCH_INVOCATIONS: readonly InvocationDescriptorMirror[] = [
  pingInvocation,
  ...RESEARCH_RPC_INVOCATIONS,
]

/* ===================================================================== *
 * V2-T3.1 — the 9-RPC research plane face (design §12, 纯契约)
 *
 *   getResearchPlaneState · getHubOverview · getPortfolioInterventions
 *   setHub · bindProject · unbindProject · restoreProject · rescan
 *   ackMissingReminder
 *
 * Pure contract (this task): the zod schemas, the TS DTO mirrors, the
 * PLANE_* error family, and the hand-written invocation descriptors.
 * NO implementation logic — the `@Remote` method bodies, the service-
 * port wiring (rpc-services.ts), the fs operation face, and the
 * artifact-face registration (host `./typert` + client `./remote`)
 * land with T3.2. Wire conventions are the SAME as the frozen 13:
 * pure JSON DTOs, every object schema `zod .strict()`, epoch-ms time
 * carriers, and — for every one of the 9 — exactly ONE `args` json
 * parameter (the design's `{}` request shapes of getHubOverview /
 * rescan are EMPTY strict objects; the flat parameter face is kept
 * uniform instead of special-casing zero-param queries the frozen
 * convention reserves for the two V1 no-arg methods).
 * ===================================================================== */

/** The 9 V2 plane RPC method names (design §12 table, order preserved). */
export const RESEARCH_PLANE_RPC_METHODS = [
  'getResearchPlaneState',
  'getHubOverview',
  'getPortfolioInterventions',
  'setHub',
  'bindProject',
  'unbindProject',
  'restoreProject',
  'rescan',
  'ackMissingReminder',
] as const

export type ResearchPlaneRpcMethod = (typeof RESEARCH_PLANE_RPC_METHODS)[number]

/* -------------------------------------------------------------------- *
 * The PLANE_* named error family (design §12 拒绝分支)
 *
 * The 9 plane RPCs reject through this closed code vocabulary (every
 * rejection branch named by the design is a code, never a message-only
 * throw). The gateway folds a host business error to
 * `{ ok: false, error: <message> }` — the message text is the only wire
 * carrier, so {@link PlaneError} embeds its code in the message (the
 * existing `[${code}]`-in-message precedent) and the `code` field stays
 * the structured read point host-side.
 * -------------------------------------------------------------------- */

/** The closed `PLANE_*` error-code vocabulary (one code per rejection branch). */
export type PlaneErrorCode =
  /** `setHub`: the plane already carries a hub at another workspace (design §5 引导卡「已有中枢」). */
  | 'PLANE_HUB_EXISTS'
  /** `setHub`: the target workspace already carries a `<hubDir>/` marker (it is itself a hub — 标记已存在). */
  | 'PLANE_HUB_MARKER_EXISTS'
  /** `setHub` / `bindProject` / `unbindProject`: the `wsPath` is not a registered DSH workspace. */
  | 'PLANE_NOT_REGISTERED_WORKSPACE'
  /** `bindProject`: the workspace already carries an ACTIVE registry entry (已是受管 — re-binding is refused, not a silent upsert). */
  | 'PLANE_ALREADY_MANAGED'
  /** `bindProject`: the target workspace is the hub workspace itself (中枢占用 — the hub is not a project). */
  | 'PLANE_HUB_WORKSPACE'
  /** `bindProject`: no `<treeDir>/` was discovered and `scaffold` is not `true` (nothing to register). */
  | 'PLANE_TREE_MISSING'
  /** `bindProject`: `scaffold` is `true` but a `<treeDir>/` already exists (the scaffold would clobber a live tree). */
  | 'PLANE_TREE_EXISTS'
  /** `unbindProject`: the workspace is not an active managed project (no entry / standalone / archived). */
  | 'PLANE_NOT_MANAGED'
  /** `restoreProject`: no ARCHIVED registry entry carries that project id (not a 解绑 tombstone). */
  | 'PLANE_NOT_ARCHIVED'
  /** `restoreProject`: the `<treeDir>.archived-<时间戳>` directory the entry was renamed to cannot be found on disk (目录找不回). */
  | 'PLANE_ARCHIVED_DIR_MISSING'
  /** `restoreProject`: the restore target `<treeDir>/` is already occupied (a live tree exists at the unbound path — 目标名被占). */
  | 'PLANE_TARGET_NAME_TAKEN'
  /** `ackMissingReminder`: the project id is not in the plane's MISSING set (nothing to defer — the dedup flag is for live MISSING entries only). */
  | 'PLANE_NOT_MISSING'
  /** `getResearchPlaneState`: the `sessionId` names no known session (the session segment is resolved from the host session registry). */
  | 'PLANE_SESSION_UNKNOWN'

/** The closed family as a list (pinned by the contract test — a dropped/renamed code fails the build). */
export const PLANE_ERROR_CODES: readonly PlaneErrorCode[] = [
  'PLANE_HUB_EXISTS',
  'PLANE_HUB_MARKER_EXISTS',
  'PLANE_NOT_REGISTERED_WORKSPACE',
  'PLANE_ALREADY_MANAGED',
  'PLANE_HUB_WORKSPACE',
  'PLANE_TREE_MISSING',
  'PLANE_TREE_EXISTS',
  'PLANE_NOT_MANAGED',
  'PLANE_NOT_ARCHIVED',
  'PLANE_ARCHIVED_DIR_MISSING',
  'PLANE_TARGET_NAME_TAKEN',
  'PLANE_NOT_MISSING',
  'PLANE_SESSION_UNKNOWN',
]

/**
 * A plane-operation rejection (the design §12 拒绝分支). Thrown by the
 * T3.2 implementation; the message is self-contained AND carries the
 * code — it rides verbatim into the gateway's `{ ok: false, error }`
 * fold, where the `PLANE_*` token is the client's machine-matchable
 * rejection key (the client has no structured error channel).
 */
export class PlaneError extends Error {
  readonly code: PlaneErrorCode

  constructor(code: PlaneErrorCode, detail: string) {
    super(`[research-control] ${code}: ${detail}`)
    this.name = 'PlaneError'
    this.code = code
  }
}

/* -------------------------------------------------------------------- *
 * Plane-state shared DTOs (the getResearchPlaneState / rescan core)
 * -------------------------------------------------------------------- */

/**
 * One active plane project on the wire (MANAGED or STANDALONE — both
 * carry a live tree; the §12.1 routable set). `displayName` is the
 * registry entry's `displayName` (MANAGED) or the tree
 * `project.yaml` title (STANDALONE — an unregistered tree has no
 * registry entry to read it from).
 */
export interface PlaneProjectDto {
  readonly projectId: string
  readonly displayName: string
  readonly kind: 'MANAGED' | 'STANDALONE'
  readonly wsPath: string
}

export const PlaneProjectDtoSchema = z
  .object({
    projectId: idProject,
    displayName: z.string(),
    kind: z.enum(['MANAGED', 'STANDALONE']),
    wsPath: absolutePath,
  })
  .strict()

/**
 * One MISSING registration on the wire (design §4: active entry whose
 * tree was not discovered — 挂起，等待用户处置). `wsPath` is the entry's
 * registered path (where the tree is expected); `deferred` is the
 * 「推后处理」 runtime flag of THIS backend run (in-memory, never
 * persisted — design §14).
 */
export interface PlaneMissingDto {
  readonly projectId: string
  readonly displayName: string
  readonly wsPath: string
  readonly deferred: boolean
}

export const PlaneMissingDtoSchema = z
  .object({
    projectId: idProject,
    displayName: z.string(),
    wsPath: absolutePath,
    deferred: z.boolean(),
  })
  .strict()

/**
 * One row of the hub's `registry.yaml` as served on the wire — the
 * 登记册 (design §7.4 section ③, HUB-only) data source. This is the
 * FULL registry: ACTIVE entries (the `projects` / `missing` segments
 * above are derived views of the active set) AND ARCHIVED ones, in
 * declaration order, so the book can render 已归档 rows with their
 * restore entry point (恢复登记).
 *
 * Invariants (mirroring the host's `RegistryEntry` domain type):
 * `status === 'archived'` ⟺ `archivedAt !== null`; an active entry
 * always carries `archivedAt: null`. `boundAt` is always present (the
 * moment the entry was first registered); `archivedAt` is the epoch-ms
 * timestamp the 解绑 commit stamped — the same timestamp that suffixes
 * the renamed `<treeDir>.archived-<ts>` directory the 恢复登记 step
 * renames back.
 */
export interface RegistryEntryDto {
  readonly id: string
  readonly path: string
  readonly displayName: string
  readonly status: 'active' | 'archived'
  readonly boundAt: number
  readonly archivedAt: number | null
}

export const RegistryEntryDtoSchema = z
  .object({
    id: idProject,
    path: absolutePath,
    displayName: z.string(),
    status: z.enum(['active', 'archived']),
    boundAt: epochMs,
    archivedAt: epochMs.nullable(),
  })
  .strict()

/**
 * The plane state summary — design §4 step 6 汇总 as served on the
 * wire: the hub, the configured directory names, the active projects,
 * the MISSING set, and the full registry book (ACTIVE + ARCHIVED,
 * declaration order — design §7.4 ③; `[]` when no hub is set). This
 * IS the `rescan` result, and the `getResearchPlaneState` result
 * minus the caller-session segment (design §12: rescan 返回 plane
 * 摘要 — 同 getResearchPlaneState 去掉 session 段).
 */
export interface PlaneStateSummary {
  readonly hub: { readonly path: string } | null
  readonly dirNames: { readonly treeDir: string; readonly hubDir: string }
  readonly projects: readonly PlaneProjectDto[]
  readonly missing: readonly PlaneMissingDto[]
  /** Every registry.yaml entry, ACTIVE + ARCHIVED, declaration order; `[]` when no hub. */
  readonly registry: readonly RegistryEntryDto[]
}

export const PlaneStateSummarySchema = z
  .object({
    hub: z
      .object({ path: z.string().min(1) })
      .strict()
      .nullable(),
    dirNames: z
      .object({
        treeDir: z.string().min(1),
        hubDir: z.string().min(1),
      })
      .strict(),
    projects: z.array(PlaneProjectDtoSchema),
    missing: z.array(PlaneMissingDtoSchema),
    registry: z.array(RegistryEntryDtoSchema),
  })
  .strict()

/**
 * The caller-session segment (design §5 角色解析与标签页分流 — the
 * TAB-BODY role decision). `cwd` is the session's working directory
 * (`null` ⟺ `role === 'NO_CWD'`); `hubTreeProjectId` is attached when
 * `role === 'HUB'` — the project id of the hub workspace's OWN tree
 * when it carries one (a hub that is also a project), `null` when the
 * hub carries no tree — and omitted for every non-HUB session.
 */
export interface PlaneSessionDto {
  readonly cwd: string | null
  readonly role: 'HUB' | 'MANAGED' | 'STANDALONE' | 'UNREGISTERED' | 'NO_CWD'
  readonly hubTreeProjectId?: string | null
}

export const PlaneSessionDtoSchema = z
  .object({
    cwd: z.string().nullable(),
    role: z.enum(['HUB', 'MANAGED', 'STANDALONE', 'UNREGISTERED', 'NO_CWD']),
    hubTreeProjectId: idProject.nullable().optional(),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 1. getResearchPlaneState — plane state + caller-session role
 *    (design §5 标签页分流与设置页①的唯一数据源; §12 row 1).
 * -------------------------------------------------------------------- */

export interface GetResearchPlaneStateArgs {
  /**
   * The calling session to resolve a `cwd`/role for (the client passes
   * its own session id; the host reads the cwd from the session
   * registry). Omitted → the result's `session` is `null` (the plane
   * state without a caller — the 设置页① read).
   */
  readonly sessionId?: string
}

export const GetResearchPlaneStateArgsSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
  })
  .strict()

export interface GetResearchPlaneStateResult {
  readonly hub: { readonly path: string } | null
  readonly dirNames: { readonly treeDir: string; readonly hubDir: string }
  readonly projects: readonly PlaneProjectDto[]
  readonly missing: readonly PlaneMissingDto[]
  /** Every registry.yaml entry, ACTIVE + ARCHIVED, declaration order; `[]` when no hub. */
  readonly registry: readonly RegistryEntryDto[]
  /** `null` when `sessionId` was omitted (or names an unknown session — see {@link PlaneErrorCode} `PLANE_SESSION_UNKNOWN`; the T3.2 implementation decides the failure branch). */
  readonly session: PlaneSessionDto | null
}

export const GetResearchPlaneStateResultSchema = z
  .object({
    hub: z
      .object({ path: z.string().min(1) })
      .strict()
      .nullable(),
    dirNames: z
      .object({
        treeDir: z.string().min(1),
        hubDir: z.string().min(1),
      })
      .strict(),
    projects: z.array(PlaneProjectDtoSchema),
    missing: z.array(PlaneMissingDtoSchema),
    registry: z.array(RegistryEntryDtoSchema),
    session: PlaneSessionDtoSchema.nullable(),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 2. getHubOverview — cross-project aggregation (design §7.1 总览 =
 *    聚合条 + 项目卡墙; §12 row 2). The empty `{}` request is the
 *    uniform single-`args`-parameter convention of the plane face.
 * -------------------------------------------------------------------- */

export interface GetHubOverviewArgs {}

export const GetHubOverviewArgsSchema = z
  .object({})
  .strict()

export interface HubOverviewResult {
  /** 聚合条 (design §7.1): project count / open-intervention total / inbox total. */
  readonly totals: {
    readonly projects: number
    readonly openInterventions: number
    readonly inbox: number
  }
  /**
   * The 「需关注」 row: ONLY the projects with open interventions
   * (`openCount` is therefore positive — an empty row is an empty
   * array, the host renders nothing for it, 无则整行不渲染).
   * `oldestHours` = hours since the OLDEST open intervention of the
   * project (the 「最旧 3 天」 display carrier).
   */
  readonly attention: readonly {
    readonly projectId: string
    readonly displayName: string
    readonly openCount: number
    readonly oldestHours: number
  }[]
  /** The card wall: one card per ACTIVE project (MANAGED + STANDALONE), all fields from existing data (零新增字段). */
  readonly cards: readonly {
    readonly projectId: string
    readonly displayName: string
    readonly title: string
    readonly description: string | null
    readonly attentionMode: 'FOCUS' | 'NORMAL' | 'BACKGROUND'
    readonly targetDate: number | null
    readonly openInterventions: number
    readonly pendingInterventions: number
    readonly topics: number
    readonly inboxCount: number
  }[]
}

export const HubOverviewResultSchema = z
  .object({
    totals: z
      .object({
        projects: z.number().int().nonnegative(),
        openInterventions: z.number().int().nonnegative(),
        inbox: z.number().int().nonnegative(),
      })
      .strict(),
    attention: z
      .array(
        z
          .object({
            projectId: idProject,
            displayName: z.string(),
            /** Positive: an attention row without open interventions is never emitted (the host renders the row only when non-empty). */
            openCount: z.number().int().positive(),
            oldestHours: z.number().nonnegative(),
          })
          .strict(),
      ),
    cards: z
      .array(
        z
          .object({
            projectId: idProject,
            displayName: z.string(),
            title: z.string().min(1),
            description: z.string().nullable(),
            attentionMode,
            targetDate: epochMs.nullable(),
            openInterventions: z.number().int().nonnegative(),
            pendingInterventions: z.number().int().nonnegative(),
            topics: z.number().int().nonnegative(),
            inboxCount: z.number().int().nonnegative(),
          })
          .strict(),
      ),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 3. getPortfolioInterventions — cross-project intervention list with
 *    the projectId label (design §7.2 重要事件 + §12 row 3).
 * -------------------------------------------------------------------- */

export interface GetPortfolioInterventionsArgs {
  /**
   * Status filter; omitted → the design §7.2 default view (OPEN +
   * PENDING — 待处理+待确认; CLOSED is folded away by default).
   */
  readonly status?: 'OPEN' | 'PENDING' | 'CLOSED'
}

export const GetPortfolioInterventionsArgsSchema = z
  .object({
    status: ivStatus.optional(),
  })
  .strict()

/** One cross-project intervention (the InterventionDto fields + the project label, design §7.2 项目标签). */
export interface PortfolioInterventionItemDto {
  readonly projectId: string
  readonly displayName: string
  readonly id: string
  readonly title: string
  readonly origin: 'USER' | 'AGENT_REPORT' | 'AUTO_FLOODING' | 'AUTO_AUDIT'
  readonly status: 'OPEN' | 'PENDING' | 'CLOSED'
  readonly workstreamIds: readonly string[]
  readonly createdAt: number
}

export const PortfolioInterventionItemDtoSchema = z
  .object({
    projectId: idProject,
    displayName: z.string(),
    id: idIntervention,
    title: z.string().min(1),
    origin: interventionOrigin,
    status: ivStatus,
    workstreamIds: z.array(idWorkstream),
    createdAt: epochMs,
  })
  .strict()

export interface GetPortfolioInterventionsResult {
  readonly items: readonly PortfolioInterventionItemDto[]
}

export const GetPortfolioInterventionsResultSchema = z
  .object({
    items: z.array(PortfolioInterventionItemDtoSchema),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 4. setHub — create the hub marker + an empty registry in a registered
 *    workspace (design §8 设为中枢; §12 row 4).
 * -------------------------------------------------------------------- */

export interface SetHubArgs {
  /** The workspace to turn into the hub (must be a registered DSH workspace, absolute path). */
  readonly wsPath: string
}

export const SetHubArgsSchema = z
  .object({
    wsPath: absolutePath,
  })
  .strict()

export interface SetHubResult {
  /** The hub workspace path (= the requested `wsPath`, canonicalized). */
  readonly hubPath: string
  /** The created registry file: `<hubPath>/<hubDir>/registry.yaml`. */
  readonly registryPath: string
}

export const SetHubResultSchema = z
  .object({
    hubPath: z.string().min(1),
    registryPath: z.string().min(1),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 5. bindProject — register a project in the hub (design §8 接入;
 *    §12 row 5): scaffold option, display name, and the internal db
 *    migration (an existing standalone db moves to the hub — Q9 推论 1,
 *    never copied).
 * -------------------------------------------------------------------- */

export interface BindProjectArgs {
  /** The workspace to register (must be a registered DSH workspace, absolute path). */
  readonly wsPath: string
  /** The registry entry's display name; omitted → the host default (the folder name, design §8 弹窗收集). */
  readonly displayName?: string
  /** `true` → scaffold a minimal tree when none exists; `false`/omitted → a discovered tree is REQUIRED (else `PLANE_TREE_MISSING`). A scaffold never clobbers an existing tree (else `PLANE_TREE_EXISTS`). */
  readonly scaffold?: boolean
}

export const BindProjectArgsSchema = z
  .object({
    wsPath: absolutePath,
    displayName: z.string().min(1).optional(),
    scaffold: z.boolean().optional(),
  })
  .strict()

export interface BindProjectResult {
  readonly projectId: string
  /**
   * The registry file the entry was appended to. `null` when the plane
   * has NO hub (design §8 接入（无中枢）: the standalone flow creates the
   * tree and the db in `<treeDir>/state/` — there is no registry to
   * append to; the plane state then shows the project as STANDALONE).
   */
  readonly registryPath: string | null
  /** Whether an existing standalone db was MIGRATED into the hub (design §9 收编 — move, verify, then delete the source; never a copy). */
  readonly dbMigrated: boolean
}

export const BindProjectResultSchema = z
  .object({
    projectId: idProject,
    registryPath: z.string().min(1).nullable(),
    dbMigrated: z.boolean(),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 6. unbindProject — archive the entry + rename the tree away
 *    (design §8 解除绑定; §12 row 6): the entry goes `archived`
 *    (never deleted), `<treeDir>/` is renamed
 *    `<treeDir>.archived-<时间戳>`, the hub db is kept.
 * -------------------------------------------------------------------- */

export interface UnbindProjectArgs {
  /** The bound project's workspace (absolute path; the entry is located by path, the result names its id). */
  readonly wsPath: string
}

export const UnbindProjectArgsSchema = z
  .object({
    wsPath: absolutePath,
  })
  .strict()

export interface UnbindProjectResult {
  readonly projectId: string
  /** The absolute path of the RENAMED tree directory (`<treeDir>.archived-<时间戳>` — the symmetric restore target, design §7.4 「恢复登记」). */
  readonly archivedDir: string
}

export const UnbindProjectResultSchema = z
  .object({
    projectId: idProject,
    archivedDir: z.string().min(1),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 7. restoreProject — revive an archived entry (design §7.4 「恢复登记」
 *    + §8; §12 row 7): the entry goes `active`, the db re-attaches,
 *    and the plugin renames `<treeDir>.archived-<时间戳>` BACK to
 *    `<treeDir>/` (与解绑对称).
 * -------------------------------------------------------------------- */

export interface RestoreProjectArgs {
  /** The archived entry's project id (a live project id is refused — restore is for 解绑 tombstones only). */
  readonly projectId: string
}

export const RestoreProjectArgsSchema = z
  .object({
    projectId: idProject,
  })
  .strict()

export interface RestoreProjectResult {
  /** The project's workspace path (the entry's registered path, where the tree was renamed back). */
  readonly wsPath: string
}

export const RestoreProjectResultSchema = z
  .object({
    wsPath: z.string().min(1),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * 8. rescan — re-run discovery & reconciliation (design §4 as an RPC:
 *    the §7.5 two-phase settings-save transaction AND the 设置页
 *    「重扫并连接」 share this; §12 row 8). Result = the plane summary
 *    (the getResearchPlaneState result WITHOUT the session segment).
 * -------------------------------------------------------------------- */

export interface RescanArgs {}

export const RescanArgsSchema = z
  .object({})
  .strict()

/** The rescan result: the plane summary, verbatim (no session segment). */
export type RescanResult = PlaneStateSummary

export const RescanResultSchema = PlaneStateSummarySchema

/* -------------------------------------------------------------------- *
 * 9. ackMissingReminder — 「推后处理」 runtime flag set (design §4
 *    MISSING 处置; §12 row 9): the dedup flag is in-memory for THIS
 *    backend run (design §14 — a restart restores the reminder).
 * -------------------------------------------------------------------- */

export interface AckMissingReminderArgs {
  /** The MISSING entry's project id (an id outside the MISSING set is refused with `PLANE_NOT_MISSING`). */
  readonly projectId: string
}

export const AckMissingReminderArgsSchema = z
  .object({
    projectId: idProject,
  })
  .strict()

export interface AckMissingReminderResult {
  readonly acknowledged: true
}

export const AckMissingReminderResultSchema = z
  .object({
    acknowledged: z.literal(true),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * The 9 hand-written InvocationDescriptors (same conventions as the
 * frozen 13: id grammar `<serviceKey>#<namespace>/<method>`, direct
 * receiver, one `args` json parameter, strict codecs, no cancellation).
 * -------------------------------------------------------------------- */

export const getResearchPlaneStateInvocation: InvocationDescriptorMirror = descriptor(
  'getResearchPlaneState',
  [argsParameter('GetResearchPlaneStateArgs', GetResearchPlaneStateArgsSchema)],
  'GetResearchPlaneStateResult',
  GetResearchPlaneStateResultSchema,
)

export const getHubOverviewInvocation: InvocationDescriptorMirror = descriptor(
  'getHubOverview',
  [argsParameter('GetHubOverviewArgs', GetHubOverviewArgsSchema)],
  'HubOverviewResult',
  HubOverviewResultSchema,
)

export const getPortfolioInterventionsInvocation: InvocationDescriptorMirror = descriptor(
  'getPortfolioInterventions',
  [argsParameter('GetPortfolioInterventionsArgs', GetPortfolioInterventionsArgsSchema)],
  'GetPortfolioInterventionsResult',
  GetPortfolioInterventionsResultSchema,
)

export const setHubInvocation: InvocationDescriptorMirror = descriptor(
  'setHub',
  [argsParameter('SetHubArgs', SetHubArgsSchema)],
  'SetHubResult',
  SetHubResultSchema,
)

export const bindProjectInvocation: InvocationDescriptorMirror = descriptor(
  'bindProject',
  [argsParameter('BindProjectArgs', BindProjectArgsSchema)],
  'BindProjectResult',
  BindProjectResultSchema,
)

export const unbindProjectInvocation: InvocationDescriptorMirror = descriptor(
  'unbindProject',
  [argsParameter('UnbindProjectArgs', UnbindProjectArgsSchema)],
  'UnbindProjectResult',
  UnbindProjectResultSchema,
)

export const restoreProjectInvocation: InvocationDescriptorMirror = descriptor(
  'restoreProject',
  [argsParameter('RestoreProjectArgs', RestoreProjectArgsSchema)],
  'RestoreProjectResult',
  RestoreProjectResultSchema,
)

export const rescanInvocation: InvocationDescriptorMirror = descriptor(
  'rescan',
  [argsParameter('RescanArgs', RescanArgsSchema)],
  'RescanResult',
  RescanResultSchema,
)

export const ackMissingReminderInvocation: InvocationDescriptorMirror = descriptor(
  'ackMissingReminder',
  [argsParameter('AckMissingReminderArgs', AckMissingReminderArgsSchema)],
  'AckMissingReminderResult',
  AckMissingReminderResultSchema,
)

/* ===================================================================== *
 * V2-UI-0.4 — GUI management face（增量 management RPC surface, D §7.2）
 *
 * The first slice of the incremental GUI management face (「不要一次性
 * 设计所有 RPC」— D §6.5): Current Focus (R-01 — the user-owned,
 * workstream-scoped, single-value operational pointer).
 *
 * D §6.5 conventions (frozen for every later management RPC):
 *  - explicit `projectId` on every request (multi-project plane — no
 *    implicit wiring; §12.1 resolution via the host's `requireRpc`);
 *  - workstream-scoped mutations carry `workstreamId`;
 *  - the USER mutation actor is established by the host (the RPC face
 *    IS the USER lane — the service exposes no agent-facing surface);
 *  - structured error codes in the message (the gateway folds a host
 *    error to `{ ok: false, error: <message> }` — the `[CODE]` prefix
 *    is the machine-matchable wire carrier, the PLANE_* precedent);
 *  - a mutation returns the canonical record (id + version) for client
 *    invalidation;
 *  - the client never submits raw YAML (Merge Contract excepted — a
 *    later slice).
 * ===================================================================== */

/** The GUI management RPC method names (order preserved; purely
 *  additive — the frozen 13 / frozen 14 / plane 9 lists stay
 *  byte-identical). UI-2A: + the update-and-drop set (D §8.2);
 *  UI-2B: + the local-project pair (D §8.7 Create/Bind);
 *  UI-4: + the attention set (D §10). */
export const RESEARCH_MANAGEMENT_RPC_METHODS = [
  'setCurrentFocus',
  'getCurrentFocus',
  'createTopic',
  'createWorkstream',
  'updateProjectMetadata',
  'updateTopic',
  'updateWorkstream',
  'dropWorkstream',
  'inspectProjectDirectory',
  'createLocalResearchProject',
  'getWorkstreamCurrent',
  'updateObjective',
  'createNextAction',
  'promoteNextAction',
  'dismissNextAction',
  'createBlocker',
  'clearBlocker',
] as const

export type ResearchManagementRpcMethod = (typeof RESEARCH_MANAGEMENT_RPC_METHODS)[number]

/* -------------------------------------------------------------------- *
 * setCurrentFocus — USER mutation (the R-01 operational pointer)
 * -------------------------------------------------------------------- */

export interface SetCurrentFocusArgs {
  readonly workstreamId: string
  /** The target canonical Plan member id (T/G/M). */
  readonly planItemId: string
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it). */
  readonly projectId?: string
}

export const SetCurrentFocusArgsSchema = z
  .object({
    workstreamId: idWorkstream,
    /** Canonical Plan member ids have no dedicated frozen id pattern —
     *  the same bare-string convention as `reorderPlan`'s
     *  `orderedItemIds`; membership is validated service-side
     *  (CF_NOT_CANONICAL), never by a wire regex. */
    planItemId: z.string().min(1),
    projectId: idProject.optional(),
  })
  .strict()

export interface SetCurrentFocusResult {
  readonly workstreamId: string
  readonly planItemId: string
  /** The row write stamp (epoch ms) — the client invalidation version. */
  readonly updatedAt: number
}

export const SetCurrentFocusResultSchema = z
  .object({
    workstreamId: idWorkstream,
    planItemId: z.string().min(1),
    updatedAt: epochMs,
  })
  .strict()

export const setCurrentFocusInvocation: InvocationDescriptorMirror = descriptor(
  'setCurrentFocus',
  [argsParameter('SetCurrentFocusArgs', SetCurrentFocusArgsSchema)],
  'SetCurrentFocusResult',
  SetCurrentFocusResultSchema,
)

/* -------------------------------------------------------------------- *
 * getCurrentFocus — the refetch read face (D §7.5 e2e chain's
 * 「refetch」 step; the frozen `WorkstreamSnapshot` cannot gain the
 * field, so the pointer reads through its own RPC)
 * -------------------------------------------------------------------- */

export interface GetCurrentFocusArgs {
  readonly workstreamId: string
  /** V2 §12.1: optional multi-project routing target. */
  readonly projectId?: string
}

export const GetCurrentFocusArgsSchema = z
  .object({
    workstreamId: idWorkstream,
    projectId: idProject.optional(),
  })
  .strict()

export interface GetCurrentFocusResult {
  readonly workstreamId: string
  /** `null` = no pointer for this workstream (never set / auto-cleared
   *  when the target left the canonical Plan). */
  readonly focus: { readonly planItemId: string; readonly updatedAt: number } | null
}

export const GetCurrentFocusResultSchema = z
  .object({
    workstreamId: idWorkstream,
    focus: z
      .object({
        planItemId: z.string().min(1),
        updatedAt: epochMs,
      })
      .strict()
      .nullable(),
  })
  .strict()

export const getCurrentFocusInvocation: InvocationDescriptorMirror = descriptor(
  'getCurrentFocus',
  [argsParameter('GetCurrentFocusArgs', GetCurrentFocusArgsSchema)],
  'GetCurrentFocusResult',
  GetCurrentFocusResultSchema,
)

/* -------------------------------------------------------------------- *
 * createTopic — declarative tree mutation (D §8.1 create pair,
 * UI-2A): allocates the next TPC-<n> in the target project and writes
 * the minimal valid file set (topic.yaml only — topology.yaml /
 * workstreams/ are optional per the phase-0 layout rules).
 * -------------------------------------------------------------------- */

export interface CreateTopicArgs {
  /** 1–200 chars (frozen topic.schema.json). */
  readonly title: string
  /** Omitted = field absent from the written YAML (no default injected). */
  readonly description?: string
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it). */
  readonly projectId?: string
}

export const CreateTopicArgsSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    projectId: idProject.optional(),
  })
  .strict()

export interface CreateTopicResult {
  readonly topicId: string
  readonly title: string
  /** Root-relative path of the written file (e.g. `topics/TPC-2/topic.yaml`). */
  readonly path: string
  /** `created_at` as epoch ms (the client invalidation version). */
  readonly createdAt: number
}

export const CreateTopicResultSchema = z
  .object({
    topicId: idTopic,
    title: z.string().min(1).max(200),
    path: z.string().min(1),
    createdAt: epochMs,
  })
  .strict()

export const createTopicInvocation: InvocationDescriptorMirror = descriptor(
  'createTopic',
  [argsParameter('CreateTopicArgs', CreateTopicArgsSchema)],
  'CreateTopicResult',
  CreateTopicResultSchema,
)

/* -------------------------------------------------------------------- *
 * createWorkstream — declarative tree mutation (D §8.1 create pair,
 * UI-2A): allocates the next WS-<n> in the target project (project-
 * wide scope, NOT per-topic) and writes workstream.yaml under the
 * given topic. The target topic must belong to the routed project
 * (HIER_TOPIC_NOT_FOUND otherwise).
 * -------------------------------------------------------------------- */

export interface CreateWorkstreamArgs {
  readonly topicId: string
  /** 1–200 chars (frozen workstream.schema.json). */
  readonly title: string
  /** Omitted = field absent from the written YAML (lifecycle defaults to
   *  PLANNED by the frozen schema). */
  readonly summary?: string
  /** V2 §12.1: optional multi-project routing target. */
  readonly projectId?: string
}

export const CreateWorkstreamArgsSchema = z
  .object({
    topicId: idTopic,
    title: z.string().min(1).max(200),
    summary: z.string().optional(),
    projectId: idProject.optional(),
  })
  .strict()

export interface CreateWorkstreamResult {
  readonly workstreamId: string
  readonly topicId: string
  readonly title: string
  /** Root-relative path of the written file (e.g. `topics/TPC-1/workstreams/WS-2/workstream.yaml`). */
  readonly path: string
  /** `created_at` as epoch ms. */
  readonly createdAt: number
}

export const CreateWorkstreamResultSchema = z
  .object({
    workstreamId: idWorkstream,
    topicId: idTopic,
    title: z.string().min(1).max(200),
    path: z.string().min(1),
    createdAt: epochMs,
  })
  .strict()

export const createWorkstreamInvocation: InvocationDescriptorMirror = descriptor(
  'createWorkstream',
  [argsParameter('CreateWorkstreamArgs', CreateWorkstreamArgsSchema)],
  'CreateWorkstreamResult',
  CreateWorkstreamResultSchema,
)

/* -------------------------------------------------------------------- *
 * updateProjectMetadata — declarative-tree update (D §8.2 update-and-
 * drop set, UI-2A): read-modify-write merge of the provided fields
 * (title / description / importance / attention_mode / target_date)
 * into the routed project's project.yaml — omitted fields are preserved
 * byte-for-byte, no default materialization. At least one field is
 * required (HIER_INPUT in the service). Faults ride the HIER_* carrier
 * (`[research-control] <CODE>: <message>`).
 * -------------------------------------------------------------------- */

export interface UpdateProjectMetadataArgs {
  /** 1–200 chars (frozen project.schema.json `title`). */
  readonly title?: string
  /** Any string (frozen `description` — no length cap). */
  readonly description?: string
  /** Integer 1–5 (frozen `importance`). */
  readonly importance?: number
  /** Frozen enum (frozen `attention_mode`). */
  readonly attentionMode?: 'FOCUS' | 'NORMAL' | 'BACKGROUND'
  /** `YYYY-MM-DD` (frozen `target_date`). */
  readonly targetDate?: string
  /** V2 §12.1: optional multi-project routing target. */
  readonly projectId?: string
}

export const UpdateProjectMetadataArgsSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().optional(),
    importance: z.number().int().min(1).max(5).optional(),
    attentionMode: attentionMode.optional(),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    projectId: idProject.optional(),
  })
  .strict()

export interface UpdateProjectMetadataResult {
  readonly projectId: string
  /** The effective title after the merge. */
  readonly title: string
  /** Write stamp, epoch ms (client invalidation version — the frozen
   *  schema has no `updated_at` field). */
  readonly updatedAt: number
}

export const UpdateProjectMetadataResultSchema = z
  .object({
    projectId: idProject,
    title: z.string().min(1).max(200),
    updatedAt: epochMs,
  })
  .strict()

export const updateProjectMetadataInvocation: InvocationDescriptorMirror = descriptor(
  'updateProjectMetadata',
  [argsParameter('UpdateProjectMetadataArgs', UpdateProjectMetadataArgsSchema)],
  'UpdateProjectMetadataResult',
  UpdateProjectMetadataResultSchema,
)

/* -------------------------------------------------------------------- *
 * updateTopic — declarative-tree update (D §8.2, UI-2A): the same RMW
 * spine over the target topic's topic.yaml (title / description /
 * importance / attention_mode). The topic must belong to the routed
 * project (HIER_TOPIC_NOT_FOUND otherwise).
 * -------------------------------------------------------------------- */

export interface UpdateTopicArgs {
  /** An existing topic of the routed project. */
  readonly topicId: string
  /** 1–200 chars (frozen topic.schema.json `title`). */
  readonly title?: string
  readonly description?: string
  readonly importance?: number
  readonly attentionMode?: 'FOCUS' | 'NORMAL' | 'BACKGROUND'
  /** V2 §12.1: optional multi-project routing target. */
  readonly projectId?: string
}

export const UpdateTopicArgsSchema = z
  .object({
    topicId: idTopic,
    title: z.string().min(1).max(200).optional(),
    description: z.string().optional(),
    importance: z.number().int().min(1).max(5).optional(),
    attentionMode: attentionMode.optional(),
    projectId: idProject.optional(),
  })
  .strict()

export interface UpdateTopicResult {
  readonly topicId: string
  /** The effective title after the merge. */
  readonly title: string
  /** Write stamp, epoch ms. */
  readonly updatedAt: number
}

export const UpdateTopicResultSchema = z
  .object({
    topicId: idTopic,
    title: z.string().min(1).max(200),
    updatedAt: epochMs,
  })
  .strict()

export const updateTopicInvocation: InvocationDescriptorMirror = descriptor(
  'updateTopic',
  [argsParameter('UpdateTopicArgs', UpdateTopicArgsSchema)],
  'UpdateTopicResult',
  UpdateTopicResultSchema,
)

/* -------------------------------------------------------------------- *
 * updateWorkstream — declarative-tree update (D §8.2, UI-2A): the same
 * RMW spine over the target workstream's workstream.yaml (title /
 * summary — the update face is title+summary ONLY; lifecycle changes
 * are NOT part of this slice). The workstream must belong to the
 * routed project (HIER_WORKSTREAM_NOT_FOUND otherwise).
 * -------------------------------------------------------------------- */

export interface UpdateWorkstreamArgs {
  /** An existing workstream of the routed project. */
  readonly workstreamId: string
  /** 1–200 chars (frozen workstream.schema.json `title`). */
  readonly title?: string
  readonly summary?: string
  /** V2 §12.1: optional multi-project routing target. */
  readonly projectId?: string
}

export const UpdateWorkstreamArgsSchema = z
  .object({
    workstreamId: idWorkstream,
    title: z.string().min(1).max(200).optional(),
    summary: z.string().optional(),
    projectId: idProject.optional(),
  })
  .strict()

export interface UpdateWorkstreamResult {
  readonly workstreamId: string
  /** The topic the workstream lives under (change fact for
   *  invalidation). */
  readonly topicId: string
  /** The effective title after the merge. */
  readonly title: string
  /** Write stamp, epoch ms. */
  readonly updatedAt: number
}

export const UpdateWorkstreamResultSchema = z
  .object({
    workstreamId: idWorkstream,
    topicId: idTopic,
    title: z.string().min(1).max(200),
    updatedAt: epochMs,
  })
  .strict()

export const updateWorkstreamInvocation: InvocationDescriptorMirror = descriptor(
  'updateWorkstream',
  [argsParameter('UpdateWorkstreamArgs', UpdateWorkstreamArgsSchema)],
  'UpdateWorkstreamResult',
  UpdateWorkstreamResultSchema,
)

/* -------------------------------------------------------------------- *
 * dropWorkstream — declarative-tree drop (D §8.2, UI-2A): deletes the
 * workstream directory tree (the topic survives — an emptied topic is
 * legal). CONSERVATIVE gate: a workstream with ANY history event is
 * refused (HIER_WORKSTREAM_HAS_HISTORY — history is never auto-cleared);
 * the post-delete current-focus clear is best-effort (the result flag
 * says whether it removed a live pointer).
 * -------------------------------------------------------------------- */

export interface DropWorkstreamArgs {
  /** The workstream to drop. */
  readonly workstreamId: string
  /** V2 §12.1: optional multi-project routing target. */
  readonly projectId?: string
}

export const DropWorkstreamArgsSchema = z
  .object({
    workstreamId: idWorkstream,
    projectId: idProject.optional(),
  })
  .strict()

export interface DropWorkstreamResult {
  readonly workstreamId: string
  /** The topic the workstream lived under (change fact for
   *  invalidation — the topic itself still exists). */
  readonly topicId: string
  /** Whether the post-delete best-effort current-focus clear removed a
   *  live pointer (false = no pointer to clear, or the clear failed —
   *  non-blocking either way). */
  readonly currentFocusCleared: boolean
}

export const DropWorkstreamResultSchema = z
  .object({
    workstreamId: idWorkstream,
    topicId: idTopic,
    currentFocusCleared: z.boolean(),
  })
  .strict()

export const dropWorkstreamInvocation: InvocationDescriptorMirror = descriptor(
  'dropWorkstream',
  [argsParameter('DropWorkstreamArgs', DropWorkstreamArgsSchema)],
  'DropWorkstreamResult',
  DropWorkstreamResultSchema,
)

/* -------------------------------------------------------------------- *
 * inspectProjectDirectory — PLANE-level read (D §8.7 Bind journey,
 * UI-2B): classifies a registered workspace directory into the four
 * detected states (an existing Research Control project / a git repo
 * without a research tree / a plain directory / an incompatible one).
 * READ-ONLY — the incompatible state explains (its `detail` carries the
 * reason); nothing is ever auto-repaired. The configured tree directory
 * name is resolved HOST-side from the settings (the wire carries only
 * the workspace path — no stale-client tree names).
 * -------------------------------------------------------------------- */

export type InspectProjectDirectoryState = 'RC_PROJECT' | 'GIT_ONLY' | 'PLAIN_DIR' | 'INCOMPATIBLE'

export interface InspectProjectDirectoryArgs {
  /** The registered DSH workspace path to inspect (absolute). */
  readonly wsPath: string
}

export const InspectProjectDirectoryArgsSchema = z
  .object({
    wsPath: z.string().min(1),
  })
  .strict()

export interface InspectProjectDirectoryResult {
  readonly wsPath: string
  /** The detected state (the B spec's four branch points). */
  readonly state: InspectProjectDirectoryState
  /** The verbatim detected-state line (the B spec copy — the
   *  INCOMPATIBLE reason lives in `detail`). */
  readonly message: string
  /** The second detected-state line (GIT_ONLY / PLAIN_DIR) or the
   *  INCOMPATIBLE conflict reason; `null` for RC_PROJECT. */
  readonly detail: string | null
  readonly hasGitRepo: boolean
  readonly hasResearchTree: boolean
  readonly treeValid: boolean
  /** The plane-state fact (already managed — the Bind action still
   *  offers; a re-bind refusal surfaces from bindProject itself). */
  readonly alreadyManaged: boolean
  /** The tree's project id (RC_PROJECT only). */
  readonly projectId?: string
  /** The `project.yaml` title (RC_PROJECT only). */
  readonly title?: string
}

export const InspectProjectDirectoryResultSchema = z
  .object({
    wsPath: z.string().min(1),
    state: z.enum(['RC_PROJECT', 'GIT_ONLY', 'PLAIN_DIR', 'INCOMPATIBLE']),
    message: z.string().min(1),
    detail: z.string().nullable(),
    hasGitRepo: z.boolean(),
    hasResearchTree: z.boolean(),
    treeValid: z.boolean(),
    alreadyManaged: z.boolean(),
    projectId: idProject.optional(),
    title: z.string().min(1).optional(),
  })
  .strict()

export const inspectProjectDirectoryInvocation: InvocationDescriptorMirror = descriptor(
  'inspectProjectDirectory',
  [argsParameter('InspectProjectDirectoryArgs', InspectProjectDirectoryArgsSchema)],
  'InspectProjectDirectoryResult',
  InspectProjectDirectoryResultSchema,
)

/* -------------------------------------------------------------------- *
 * createLocalResearchProject — PLANE-level mutation (D §8.7 Create
 * journey, UI-2B): creates a research project from scratch under a
 * registered workspace — mkdir → git init (W12 user-explicit) →
 * scaffold the minimal tree → write the full project metadata (only
 * when a field is provided) → registry COMMIT LAST + re-init +
 * post-check (the bindProject ladder). THREE-STAGE failure contract:
 * pre-checks THROW (the PLANE_* rungs + LP_INPUT / LP_PARENT_INVALID /
 * LP_DIR_EXISTS — no partial change yet); a step failure RETURNS the
 * `ok: false` arm of the result union (the failed step + completed
 * steps + the PARTIAL-CHANGE NOTE — there is no rollback engine,
 * frozen ruling); the success arm carries the registration facts.
 * -------------------------------------------------------------------- */

export interface CreateLocalResearchProjectArgs {
  /** The registered DSH workspace path (the tree's parent). */
  readonly wsPath: string
  /** 1–200 chars (frozen project.schema.json `title` — becomes the
   *  scaffolded `project.yaml` title = the registry display name). */
  readonly title: string
  readonly description?: string
  /** Integer 1–5 (frozen `importance`). */
  readonly importance?: number
  readonly attentionMode?: 'FOCUS' | 'NORMAL' | 'BACKGROUND'
  /** `YYYY-MM-DD` (frozen `target_date`). */
  readonly targetDate?: string
}

export const CreateLocalResearchProjectArgsSchema = z
  .object({
    wsPath: z.string().min(1),
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    importance: z.number().int().min(1).max(5).optional(),
    attentionMode: attentionMode.optional(),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict()

/** The create step vocabulary (the failure arm's `failedStep` /
 *  `completedSteps`). */
export type CreateLocalResearchProjectWireStep = 'mkdir' | 'gitInit' | 'scaffold' | 'metadata' | 'register'

/** The LP_* codes that can appear in the failure arm (the STEP codes —
 *  the pre-check codes LP_INPUT / LP_PARENT_INVALID / LP_DIR_EXISTS
 *  throw instead, because no step has started; their carrier rides the
 *  gateway error message like the PLANE_* rung carriers). */
export type CreateLocalResearchProjectWireCode =
  | 'LP_MKDIR'
  | 'LP_GIT_INIT'
  | 'LP_SCAFFOLD'
  | 'LP_METADATA'
  | 'LP_REGISTER'

export interface CreateLocalResearchProjectSuccessResult {
  readonly ok: true
  readonly projectId: string
  /** The absolute tree directory that was created. */
  readonly treePath: string
  /** `null` when the plane has no hub (the standalone flow — no
   *  registry to append to). */
  readonly registryPath: string | null
  readonly dbMigrated: boolean
}

export interface CreateLocalResearchProjectFailureResult {
  readonly ok: false
  readonly code: CreateLocalResearchProjectWireCode
  readonly failedStep: CreateLocalResearchProjectWireStep
  /** The steps that completed (and left a durable trace) before the
   *  failure — `[]` when the first step failed. */
  readonly completedSteps: readonly CreateLocalResearchProjectWireStep[]
  /** Human-facing: what now exists on disk (the spec's partial-change
   *  note). */
  readonly partialChangeNote: string
  /** The raw failure detail (the fs / git / scaffold / registry error
   *  message, carrier-free — `code` is the machine key for this arm). */
  readonly detail: string
}

export type CreateLocalResearchProjectResult =
  | CreateLocalResearchProjectSuccessResult
  | CreateLocalResearchProjectFailureResult

export const CreateLocalResearchProjectResultSchema: TypertSchemaLike = z.union([
  z
    .object({
      ok: z.literal(true),
      projectId: idProject,
      treePath: z.string().min(1),
      registryPath: z.string().min(1).nullable(),
      dbMigrated: z.boolean(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum(['LP_MKDIR', 'LP_GIT_INIT', 'LP_SCAFFOLD', 'LP_METADATA', 'LP_REGISTER']),
      failedStep: z.enum(['mkdir', 'gitInit', 'scaffold', 'metadata', 'register']),
      completedSteps: z.array(z.enum(['mkdir', 'gitInit', 'scaffold', 'metadata', 'register'])),
      partialChangeNote: z.string().min(1),
      detail: z.string(),
    })
    .strict(),
])

export const createLocalResearchProjectInvocation: InvocationDescriptorMirror = descriptor(
  'createLocalResearchProject',
  [argsParameter('CreateLocalResearchProjectArgs', CreateLocalResearchProjectArgsSchema)],
  'CreateLocalResearchProjectResult',
  CreateLocalResearchProjectResultSchema,
)

/* -------------------------------------------------------------------- *
 * UI-4 (D §10) — the Workstream Current-Execution completion: the human-
 * attention item DTOs shared by the getWorkstreamCurrent read face and
 * the five attention mutation faces below. All NEW — the frozen
 * ObjectiveDto / InterventionDto bytes stay untouched (the *Full*
 * carriers add the read fields alongside them).
 * -------------------------------------------------------------------- */

/** One `affects` target (DOMAIN_SCHEMA §9.4 TypedRef; kind WS/T/R). */
export interface AffectsRefDto {
  readonly kind: 'WORKSTREAM' | 'TASK' | 'RUN'
  readonly id: string
}

export const AffectsRefDtoSchema = z
  .object({
    kind: affectsRefKind,
    id: z.string().min(1),
  })
  .strict()

/** One Objective linked-ref (DOMAIN_SCHEMA §9.1; objectives.schema.json
 *  limits the kind to GATE/MILESTONE/WORKSTREAM — the id is a bare
 *  member id, membership validated service-side like CF). */
export interface LinkedRefDto {
  readonly kind: 'GATE' | 'MILESTONE' | 'WORKSTREAM'
  readonly id: string
}

export const LinkedRefDtoSchema = z
  .object({
    kind: linkedRefKind,
    id: z.string().min(1),
  })
  .strict()

/** One full Objective (the frozen {@link ObjectiveDto} fields + the §9.1
 *  success-criteria / linked-refs read face; ADJ-6 current-objective
 *  carrier). */
export interface ObjectiveFullDto {
  readonly id: string
  readonly scope: 'PROJECT' | 'TOPIC'
  readonly statement: string
  readonly status: 'ACTIVE' | 'ACHIEVED' | 'DROPPED'
  readonly priority: 'P0' | 'P1' | 'P2' | 'P3'
  readonly targetDate: number | null
  readonly successCriteria: readonly string[]
  readonly linkedRefs: readonly LinkedRefDto[]
}

export const ObjectiveFullDtoSchema = z
  .object({
    id: idObjective,
    scope: z.enum(['PROJECT', 'TOPIC']),
    statement: z.string().min(1),
    status: objStatus,
    priority: objPriority,
    targetDate: epochMs.nullable(),
    successCriteria: z.array(z.string().min(1)),
    linkedRefs: z.array(LinkedRefDtoSchema),
  })
  .strict()

/** One NextAction (DOMAIN_SCHEMA §9.3; absent optionals → null on the
 *  wire; `promotedToTaskId` only when status = PROMOTED). */
export interface NextActionDto {
  readonly id: string
  readonly workstreamId: string | null
  readonly statement: string
  readonly rationale: string | null
  readonly status: 'PROPOSED' | 'PROMOTED' | 'DISMISSED'
  readonly promotedToTaskId: string | null
  readonly createdAt: number
}

export const NextActionDtoSchema = z
  .object({
    id: idNextAction,
    workstreamId: idWorkstream.nullable(),
    statement: z.string().min(1),
    rationale: z.string().min(1).nullable(),
    status: naStatus,
    promotedToTaskId: idTask.nullable(),
    createdAt: epochMs,
  })
  .strict()

/** One Explicit Blocker (DOMAIN_SCHEMA §9.4). */
export interface BlockerDto {
  readonly id: string
  readonly statement: string
  readonly affects: readonly AffectsRefDto[]
  readonly status: 'ACTIVE' | 'CLEARED'
  /** The source note (§9.4 required free text). */
  readonly source: string
  readonly references: readonly string[] | null
  readonly createdAt: number
  readonly clearedAt: number | null
}

export const BlockerDtoSchema = z
  .object({
    id: idBlocker,
    statement: z.string().min(1),
    affects: z.array(AffectsRefDtoSchema).min(1),
    status: blkStatus,
    source: z.string().min(1),
    references: z.array(z.string().min(1)).nullable(),
    createdAt: epochMs,
    clearedAt: epochMs.nullable(),
  })
  .strict()

/** One DERIVED blocker (ADJ-4: a read-only projection — the synthetic
 *  id `DERIVED-<source>-<refId>` is never allocated, never persisted;
 *  there is NO clear RPC for this face). */
export interface DerivedBlockerDto {
  readonly id: string
  readonly source: 'DEPENDENCY' | 'GATE' | 'RULE'
  readonly statement: string
  readonly reasonRefs: readonly string[]
  /** The true-cause link (the zone renders the label verbatim). */
  readonly primaryAction: {
    readonly label: string
    readonly targetKind: 'TASK' | 'GATE' | 'MILESTONE' | 'WORKSTREAM' | 'RUN'
    readonly targetId: string
  }
}

export const DerivedBlockerDtoSchema = z
  .object({
    id: z.string().min(1),
    source: derivedBlockerSource,
    statement: z.string().min(1),
    reasonRefs: z.array(z.string().min(1)),
    primaryAction: z
      .object({
        label: z.string().min(1),
        targetKind: derivedBlockerTargetKind,
        targetId: z.string().min(1),
      })
      .strict(),
  })
  .strict()

/** One full Intervention (the frozen {@link InterventionDto} fields +
 *  the §9.2 detail / closure read face). */
export interface InterventionFullDto {
  readonly id: string
  readonly title: string
  readonly origin: 'USER' | 'AGENT_REPORT' | 'AUTO_FLOODING' | 'AUTO_AUDIT'
  readonly status: 'OPEN' | 'PENDING' | 'CLOSED'
  readonly workstreamIds: readonly string[]
  readonly createdAt: number
  readonly detail: string | null
  readonly closedAt: number | null
  readonly resolutionNote: string | null
}

export const InterventionFullDtoSchema = z
  .object({
    id: idIntervention,
    title: z.string().min(1),
    origin: interventionOrigin,
    status: ivStatus,
    workstreamIds: z.array(idWorkstream),
    createdAt: epochMs,
    detail: z.string().min(1).nullable(),
    closedAt: epochMs.nullable(),
    resolutionNote: z.string().min(1).nullable(),
  })
  .strict()

/* -------------------------------------------------------------------- *
 * getWorkstreamCurrent — the Current-zone read face (D §10; ADJ-5/6/7/8:
 *  the derived projection + the explicit/intervention thin passes). The
 *  current-focus pointer is NOT in this result — it stays on the main-
 *  store `currentFocus` slice (the D §10.11 CF linkage reads it from
 *  there, keeping the frozen getWorkstream projection untouched).
 * -------------------------------------------------------------------- */

export interface GetWorkstreamCurrentArgs {
  readonly workstreamId: string
  /** V2 §12.1: optional multi-project routing target. */
  readonly projectId?: string
}

export const GetWorkstreamCurrentArgsSchema = z
  .object({
    workstreamId: idWorkstream,
    projectId: idProject.optional(),
  })
  .strict()

export interface GetWorkstreamCurrentResult {
  readonly workstreamId: string
  /** ACTIVE objectives whose linked_refs contain this WORKSTREAM,
   *  priority-sorted (the header row shows the first; ADJ-6). */
  readonly objectives: readonly ObjectiveFullDto[]
  /** Explicit blockers affecting the WS itself or a member Task/Run
   *  (ADJ-5). */
  readonly explicitBlockers: readonly BlockerDto[]
  /** The ADJ-3 mechanical derived projection (DEPENDENCY/GATE; RULE =
   *  the empty set in v1). */
  readonly derivedBlockers: readonly DerivedBlockerDto[]
  /** The PROPOSED next actions naming this WS (the actionable set). */
  readonly nextActions: readonly NextActionDto[]
  /** The interventions naming this WS (all states — the zone renders
   *  the closure state). */
  readonly interventions: readonly InterventionFullDto[]
}

export const GetWorkstreamCurrentResultSchema = z
  .object({
    workstreamId: idWorkstream,
    objectives: z.array(ObjectiveFullDtoSchema),
    explicitBlockers: z.array(BlockerDtoSchema),
    derivedBlockers: z.array(DerivedBlockerDtoSchema),
    nextActions: z.array(NextActionDtoSchema),
    interventions: z.array(InterventionFullDtoSchema),
  })
  .strict()

export const getWorkstreamCurrentInvocation: InvocationDescriptorMirror = descriptor(
  'getWorkstreamCurrent',
  [argsParameter('GetWorkstreamCurrentArgs', GetWorkstreamCurrentArgsSchema)],
  'GetWorkstreamCurrentResult',
  GetWorkstreamCurrentResultSchema,
)

/* -------------------------------------------------------------------- *
 * updateObjective — the basic objective edit (ADJ-6: ≥1 field, enforced
 *  service-side — the RMW save + the transition-checked status path)
 * -------------------------------------------------------------------- */

export interface UpdateObjectiveArgs {
  readonly objectiveId: string
  readonly statement?: string
  /** A status transition (the frozen §13 machine is checked). */
  readonly status?: 'ACTIVE' | 'ACHIEVED' | 'DROPPED'
  readonly projectId?: string
}

export const UpdateObjectiveArgsSchema = z
  .object({
    objectiveId: idObjective,
    statement: z.string().min(1).optional(),
    status: objStatus.optional(),
    projectId: idProject.optional(),
  })
  .strict()

export interface UpdateObjectiveResult {
  readonly objectiveId: string
  /** The effective status after the update. */
  readonly status: 'ACTIVE' | 'ACHIEVED' | 'DROPPED'
  readonly managementActionId: string
  /** Write stamp (epoch ms) — the client invalidation version. */
  readonly updatedAt: number
}

export const UpdateObjectiveResultSchema = z
  .object({
    objectiveId: idObjective,
    status: objStatus,
    managementActionId: idManagementAction,
    updatedAt: epochMs,
  })
  .strict()

export const updateObjectiveInvocation: InvocationDescriptorMirror = descriptor(
  'updateObjective',
  [argsParameter('UpdateObjectiveArgs', UpdateObjectiveArgsSchema)],
  'UpdateObjectiveResult',
  UpdateObjectiveResultSchema,
)

/* -------------------------------------------------------------------- *
 * createNextAction — propose a NextAction (D §10.5; USER/AGENT matrix
 *  row, the USER GUI face)
 * -------------------------------------------------------------------- */

export interface CreateNextActionArgs {
  /** The WS the NA names (absent → the NA is unscoped). */
  readonly workstreamId?: string
  readonly statement: string
  readonly rationale?: string
  readonly projectId?: string
}

export const CreateNextActionArgsSchema = z
  .object({
    workstreamId: idWorkstream.optional(),
    statement: z.string().min(1),
    rationale: z.string().min(1).optional(),
    projectId: idProject.optional(),
  })
  .strict()

export interface CreateNextActionResult {
  readonly nextAction: NextActionDto
}

export const CreateNextActionResultSchema = z
  .object({
    nextAction: NextActionDtoSchema,
  })
  .strict()

export const createNextActionInvocation: InvocationDescriptorMirror = descriptor(
  'createNextAction',
  [argsParameter('CreateNextActionArgs', CreateNextActionArgsSchema)],
  'CreateNextActionResult',
  CreateNextActionResultSchema,
)

/* -------------------------------------------------------------------- *
 * promoteNextAction — materialize the PROPOSED NA as a canonical plan
 *  Task (D §10.6; USER-only — the matrix row「PROMOTE 仅用户」)
 * -------------------------------------------------------------------- */

export interface PromoteNextActionArgs {
  readonly nextActionId: string
  /** Required when the NA carries no workstream_id; must match when it
   *  does (service-checked). */
  readonly workstreamId?: string
  /** 0-based insert position in the canonical plan (default: tail). */
  readonly index?: number
  readonly projectId?: string
}

export const PromoteNextActionArgsSchema = z
  .object({
    nextActionId: idNextAction,
    workstreamId: idWorkstream.optional(),
    index: z.number().int().nonnegative().optional(),
    projectId: idProject.optional(),
  })
  .strict()

/** The materialization receipt (the host ActionsService
 *  `PromoteNextActionResult` mapped verbatim). */
export interface PromoteNextActionResult {
  readonly nextActionId: string
  /** The materialized Task id (§9.3 promoted_to_task_id). */
  readonly taskId: string
  readonly workstreamId: string
  /** The plan.yaml path relative to `.research/`. */
  readonly planPath: string
  /** The canonical plan order after materialization. */
  readonly newOrder: readonly string[]
  readonly managementActionId: string
}

export const PromoteNextActionResultSchema = z
  .object({
    nextActionId: idNextAction,
    taskId: idTask,
    workstreamId: idWorkstream,
    planPath: z.string().min(1),
    newOrder: z.array(z.string().min(1)),
    managementActionId: idManagementAction,
  })
  .strict()

export const promoteNextActionInvocation: InvocationDescriptorMirror = descriptor(
  'promoteNextAction',
  [argsParameter('PromoteNextActionArgs', PromoteNextActionArgsSchema)],
  'PromoteNextActionResult',
  PromoteNextActionResultSchema,
)

/* -------------------------------------------------------------------- *
 * dismissNextAction — terminal-dismiss a PROPOSED NA (D §10.5)
 * -------------------------------------------------------------------- */

export interface DismissNextActionArgs {
  readonly nextActionId: string
  readonly projectId?: string
}

export const DismissNextActionArgsSchema = z
  .object({
    nextActionId: idNextAction,
    projectId: idProject.optional(),
  })
  .strict()

export interface DismissNextActionResult {
  readonly nextAction: NextActionDto
}

export const DismissNextActionResultSchema = z
  .object({
    nextAction: NextActionDtoSchema,
  })
  .strict()

export const dismissNextActionInvocation: InvocationDescriptorMirror = descriptor(
  'dismissNextAction',
  [argsParameter('DismissNextActionArgs', DismissNextActionArgsSchema)],
  'DismissNextActionResult',
  DismissNextActionResultSchema,
)

/* -------------------------------------------------------------------- *
 * createBlocker — raise an Explicit Blocker (D §10.7; USER-only — the
 *  Agent-writable closed set excludes Blockers)
 * -------------------------------------------------------------------- */

export interface CreateBlockerArgs {
  readonly statement: string
  readonly affects: readonly AffectsRefDto[]
  /** The source note (DOMAIN_SCHEMA §9.4 required). */
  readonly source: string
  readonly references?: readonly string[]
  readonly projectId?: string
}

export const CreateBlockerArgsSchema = z
  .object({
    statement: z.string().min(1),
    affects: z.array(AffectsRefDtoSchema).min(1),
    source: z.string().min(1),
    references: z.array(z.string().min(1)).optional(),
    projectId: idProject.optional(),
  })
  .strict()

export interface CreateBlockerResult {
  readonly blocker: BlockerDto
}

export const CreateBlockerResultSchema = z
  .object({
    blocker: BlockerDtoSchema,
  })
  .strict()

export const createBlockerInvocation: InvocationDescriptorMirror = descriptor(
  'createBlocker',
  [argsParameter('CreateBlockerArgs', CreateBlockerArgsSchema)],
  'CreateBlockerResult',
  CreateBlockerResultSchema,
)

/* -------------------------------------------------------------------- *
 * clearBlocker — clear an ACTIVE Explicit Blocker (D §10.7; the DERIVED
 *  face has no clear — ADJ-4)
 * -------------------------------------------------------------------- */

export interface ClearBlockerArgs {
  readonly blockerId: string
  readonly projectId?: string
}

export const ClearBlockerArgsSchema = z
  .object({
    blockerId: idBlocker,
    projectId: idProject.optional(),
  })
  .strict()

export interface ClearBlockerResult {
  readonly blocker: BlockerDto
}

export const ClearBlockerResultSchema = z
  .object({
    blocker: BlockerDtoSchema,
  })
  .strict()

export const clearBlockerInvocation: InvocationDescriptorMirror = descriptor(
  'clearBlocker',
  [argsParameter('ClearBlockerArgs', ClearBlockerArgsSchema)],
  'ClearBlockerResult',
  ClearBlockerResultSchema,
)

/** The GUI management invocation descriptors (appended to the registered
 *  face at the end — the frozen 14 + plane 9 entries stay untouched). */
export const RESEARCH_MANAGEMENT_INVOCATIONS: readonly InvocationDescriptorMirror[] = [
  setCurrentFocusInvocation,
  getCurrentFocusInvocation,
  createTopicInvocation,
  createWorkstreamInvocation,
  updateProjectMetadataInvocation,
  updateTopicInvocation,
  updateWorkstreamInvocation,
  dropWorkstreamInvocation,
  inspectProjectDirectoryInvocation,
  createLocalResearchProjectInvocation,
  getWorkstreamCurrentInvocation,
  updateObjectiveInvocation,
  createNextActionInvocation,
  promoteNextActionInvocation,
  dismissNextActionInvocation,
  createBlockerInvocation,
  clearBlockerInvocation,
]

/**
 * The 9 V2 plane invocation descriptors (order = the design §12 table).
 * CONTRACT-ONLY in T3.1: both artifact faces gain these together with
 * the `@Remote` method bodies in T3.2 (the WP-0.3 no-drift-by-
 * construction rule then extends to the 23-endpoint face — the
 * descriptors are the SAME shared objects on both faces).
 */
export const RESEARCH_PLANE_INVOCATIONS: readonly InvocationDescriptorMirror[] = [
  getResearchPlaneStateInvocation,
  getHubOverviewInvocation,
  getPortfolioInterventionsInvocation,
  setHubInvocation,
  bindProjectInvocation,
  unbindProjectInvocation,
  restoreProjectInvocation,
  rescanInvocation,
  ackMissingReminderInvocation,
]

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
 *
 * UI-0.4 appends the 4 GUI management RPCs ({@link
 * RESEARCH_MANAGEMENT_INVOCATIONS}: setCurrentFocus / getCurrentFocus —
 * slice 1, R-01; createTopic / createWorkstream — Task 3, the D §8.1
 * create pair); UI-2A appends the update-and-drop set (D §8.2:
 * updateProjectMetadata / updateTopic / updateWorkstream /
 * dropWorkstream); UI-2B appends the local-project pair (D §8.7
 * Create/Bind: inspectProjectDirectory / createLocalResearchProject);
 * UI-4 appends the 7 attention RPCs (D §10: getWorkstreamCurrent /
 * updateObjective / createNextAction / promoteNextAction /
 * dismissNextAction / createBlocker / clearBlocker) — the
 * incremental management face grows by slice (D §6.5); the
 * registered face is now 39 business RPCs (40 with ping).
 */
export const REGISTERED_RESEARCH_INVOCATIONS: readonly InvocationDescriptorMirror[] = [
  ...ALL_RESEARCH_INVOCATIONS,
  getResearchPlaneStateInvocation,
  getHubOverviewInvocation,
  getPortfolioInterventionsInvocation,
  setHubInvocation,
  bindProjectInvocation,
  unbindProjectInvocation,
  restoreProjectInvocation,
  rescanInvocation,
  ackMissingReminderInvocation,
  ...RESEARCH_MANAGEMENT_INVOCATIONS,
]
