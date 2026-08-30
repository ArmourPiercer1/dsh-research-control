import { z } from "zod";
//#region src/shared/rpc-contracts.d.ts
/** Wire namespace of the Research Control service (`TypertRemoteService` super key). */
declare const RESEARCH_CONTROL_NAMESPACE = "researchControl";
/**
 * Result of the ping RPC spike. `time` is the host wall-clock at ping
 * moment in **epoch milliseconds (UTC)**: a plain JSON number, unambiguous
 * across time zones (DSH_ADAPTER §5 step 3: pure JSON DTOs only).
 */
interface PingResult {
  readonly ok: true;
  readonly service: typeof RESEARCH_CONTROL_NAMESPACE;
  readonly time: number;
}
/**
 * Structural mirror of the protocol `TypertSchema` (the minimal runtime
 * capability a strict codec schema must carry).
 */
interface TypertSchemaLike {
  parse(value: unknown): unknown;
}
/** Structural mirror of the protocol `TypertCodec` union. */
type TypertCodecMirror = {
  readonly mode: 'strict';
  readonly typeSymbol: string;
  readonly schema: TypertSchemaLike;
} | {
  readonly mode: 'src-json';
};
/** Structural mirror of the protocol `InvocationParameterDescriptor`. */
interface InvocationParameterMirror {
  readonly name: string;
  readonly wire: string;
  readonly source: 'json' | 'lookup';
  readonly lookup?: string;
  readonly codec: TypertCodecMirror;
  readonly acceptsUndefined?: true;
}
/**
 * Structural mirror of the protocol `InvocationDescriptor`
 * (types.d.ts:140-178, field-for-field).
 */
interface InvocationDescriptorMirror {
  readonly id: string;
  readonly service: string;
  readonly namespace: string;
  readonly method: string;
  readonly implementation?: string;
  readonly invocation: {
    readonly kind: 'direct';
  } | {
    readonly kind: 'context';
    readonly context: string;
    readonly wire: string;
    readonly codec: TypertCodecMirror;
  };
  readonly scope?: {
    readonly context: string;
    readonly wire: string;
  };
  readonly parameters: readonly InvocationParameterMirror[];
  readonly cancellation?: {
    readonly parameter: 'signal';
  };
  readonly result: TypertCodecMirror;
  readonly sourceLocation?: {
    readonly file: string;
    readonly line: number;
    readonly column: number;
  };
}
/** Structural mirror of the registry `TypertDocTag`. */
interface TypertDocTagMirror {
  readonly name: string;
  readonly argument?: string;
  readonly comment?: string;
  readonly text: string;
}
interface TypertDocumentationMirror {
  readonly description?: string;
  readonly summary?: string;
  readonly tags: readonly TypertDocTagMirror[];
  readonly jsDoc?: string;
}
/** Structural mirror of the registry `TypertMemberModel`. */
interface TypertMemberModelMirror {
  readonly kind: 'property' | 'method' | 'getter' | 'setter' | 'call' | 'construct' | 'index';
  readonly name: string;
  readonly signature: string;
  readonly summary?: string;
  readonly jsDoc?: string;
}
/** Structural mirror of the registry `TypertTypeModel`. */
interface TypertTypeModelMirror {
  readonly name: string;
  readonly declaration: string;
}
/** Structural mirror of the registry `TypertServiceModel`. */
interface TypertServiceModelMirror extends TypertDocumentationMirror {
  readonly key: string;
  readonly exportName: string;
  readonly members: readonly TypertMemberModelMirror[];
  readonly types: readonly TypertTypeModelMirror[];
}
/** Structural mirror of the registry `TypertEventModel`. */
interface TypertEventModelMirror extends TypertDocumentationMirror {
  readonly name: string;
  readonly mode?: string;
  readonly signature: string;
}
/** Structural mirror of the registry `TypertObjectModel`. */
interface TypertObjectModelMirror extends TypertDocumentationMirror {
  readonly name: string;
  readonly exportName: string;
  readonly members: readonly TypertMemberModelMirror[];
  readonly types: readonly TypertTypeModelMirror[];
}
/** Structural mirror of the registry `TypertPackageModel`. */
interface TypertPackageModelMirror {
  readonly services: readonly TypertServiceModelMirror[];
  readonly events: readonly TypertEventModelMirror[];
  readonly objects: readonly TypertObjectModelMirror[];
}
/** Structural mirror of the registry `TypertSchema`. */
interface TypertSchemaMirror {
  readonly name: string;
  readonly schema: TypertSchemaLike;
}
/**
 * Structural mirror of the registry `TypertContribution` (the `TYPERT`
 * manifest object a `./typert` module must export).
 */
interface TypertContributionMirror {
  readonly package: string;
  readonly face: 'host' | 'client';
  readonly schemas: readonly TypertSchemaMirror[];
  readonly model: TypertPackageModelMirror;
  readonly invocations: readonly InvocationDescriptorMirror[];
}
/** One Intervention in a GUI list (DOMAIN_SCHEMA §9.2; the store record
 *  minus the audit-only fields). */
interface InterventionDto {
  readonly id: string;
  readonly title: string;
  readonly origin: 'USER' | 'AGENT_REPORT' | 'AUTO_FLOODING' | 'AUTO_AUDIT';
  readonly status: 'OPEN' | 'PENDING' | 'CLOSED';
  readonly workstreamIds: readonly string[];
  readonly createdAt: number;
}
/** One Objective (DOMAIN_SCHEMA §9.1) in a project/topic snapshot. */
interface ObjectiveDto {
  readonly id: string;
  readonly scope: 'PROJECT' | 'TOPIC';
  readonly statement: string;
  readonly status: 'ACTIVE' | 'ACHIEVED' | 'DROPPED';
  readonly priority: 'P0' | 'P1' | 'P2' | 'P3';
  readonly targetDate: number | null;
}
/** One Topic card (dashboard/project level — §27.1/§27.2). */
interface TopicCardDto {
  readonly id: string;
  readonly title: string;
  readonly workstreamCount: number;
}
/** One Workstream summary card (topic page — §27.3). */
interface WorkstreamCardDto {
  readonly id: string;
  readonly title: string;
  readonly lifecycle: 'PLANNED' | 'REALIZED' | 'DROPPED';
  readonly summary: string | null;
  /** Canonical plan size (ordered G/T/M ids in `plan.yaml`). */
  readonly planItemCount: number;
  /** PF with status OPEN (the actionable overlay proposals). */
  readonly openPlanForkCount: number;
  /** Runs with status RUNNING (the Current-zone live signal). */
  readonly runningRunCount: number;
}
/** One topology edge (§3.1; the topic graph's node/edge data — §27.5). */
interface TopologyEdgeDto {
  readonly id: string;
  readonly operation: 'FORK' | 'MERGE';
  readonly lifecycle: 'PLANNED' | 'REALIZED' | 'DROPPED';
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly note: string | null;
}
/** A merge-contract reference (badge data — §27.5; the content itself is
 *  free Markdown read on demand, not part of the snapshot). */
interface MergeContractRefDto {
  readonly edgeId: string;
  readonly path: string;
}
interface DashboardSnapshot {
  readonly project: {
    readonly id: string;
    readonly title: string;
    readonly description: string | null;
    readonly importance: number;
    readonly attentionMode: 'FOCUS' | 'NORMAL' | 'BACKGROUND';
    readonly targetDate: number | null;
  };
  readonly topics: readonly TopicCardDto[];
  /** §27.1: OPEN Interventions (always complete — INV-ATTN-1). */
  readonly openInterventions: readonly InterventionDto[];
  /** §27.1: PENDING Interventions (always complete — INV-ATTN-1). */
  readonly pendingInterventions: readonly InterventionDto[];
  /**
   * PHASE 5 placeholder (WP-5.3, DOMAIN_SCHEMA §10.3): the ScheduledEvent
   * operational store does not exist yet — `null` until then, never a
   * fabricated empty list masquerading as data.
   */
  readonly scheduledEvents: null;
  /** PHASE 5 placeholder (WP-5.3, DOMAIN_SCHEMA §10.2): ReportingItem. */
  readonly reportingItems: null;
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
  readonly inboxCount: number;
  /** PHASE 5 placeholder (WP-5.4): Attention Manager recommended order. */
  readonly attention: null;
}
interface ProjectSnapshot {
  readonly project: {
    readonly id: string;
    readonly title: string;
    readonly description: string | null;
    readonly importance: number;
    readonly attentionMode: 'FOCUS' | 'NORMAL' | 'BACKGROUND';
    readonly targetDate: number | null;
    readonly currentObjectiveRefs: readonly string[];
    readonly createdAt: number;
  };
  readonly objectives: readonly ObjectiveDto[];
  readonly topics: readonly TopicCardDto[];
  /** PHASE 5 placeholder (WP-5.3, §27.2 「upcoming interactions/reporting」). */
  readonly upcomingInteractions: null;
  readonly upcomingReporting: null;
}
interface GetTopicArgs {
  readonly topicId: string;
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string;
}
interface TopicSnapshot {
  readonly topic: {
    readonly id: string;
    readonly title: string;
    readonly description: string | null;
    readonly importance: number | null;
    readonly attentionMode: 'FOCUS' | 'NORMAL' | 'BACKGROUND' | null;
    readonly objectiveRefs: readonly string[];
    readonly createdAt: number;
  };
  /** §27.3: Workstream summary cards. */
  readonly workstreams: readonly WorkstreamCardDto[];
  /** §27.5: the Workstream topology graph edge set (topic-scoped). */
  readonly topology: {
    readonly edges: readonly TopologyEdgeDto[];
  };
  /** §27.5: merge contract badges (edges that carry a contract file). */
  readonly mergeContracts: readonly MergeContractRefDto[];
  /** §27.3: Topic-level Objective (scope=TOPIC, this topic). */
  readonly objectives: readonly ObjectiveDto[];
}
interface GetWorkstreamArgs {
  readonly workstreamId: string;
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string;
}
/** One canonical plan item in its plan position (Future zone — §27.4). */
interface PlanItemDto {
  readonly id: string;
  readonly kind: 'TASK' | 'GATE' | 'MILESTONE';
  readonly title: string;
}
/** One task in the Current zone: the declarative definition + the
 *  execution/validation state folded from the WS event log (the history
 *  replay face; the fold is a read projection — the state machine itself
 *  is enforced at append time). */
interface CurrentTaskDto {
  readonly id: string;
  readonly title: string;
  readonly execution: 'PLANNED' | 'ACTIVE' | 'PAUSED' | 'EXECUTED' | 'CANCELLED';
  readonly validation: 'NOT_REQUIRED' | 'PENDING' | 'UNDER_REVIEW' | 'PASSED' | 'FAILED';
  readonly acceptanceCriteria: readonly string[];
  /** Runs with status RUNNING bound to this task (the §27.4 「live Run」
   *  join; the Run detail itself rides in the sibling `runs` list). */
  readonly liveRunIds: readonly string[];
}
/** One Run (Current zone — §27.4 「live Run / last heartbeat/checkpoint」;
 *  the DSH session pointer only — INV-DB-2). */
interface RunDto {
  readonly id: string;
  readonly status: 'RUNNING' | 'FINISHED' | 'FAILED' | 'CANCELLED';
  readonly taskId: string | null;
  readonly intent: string | null;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly lastCheckpointAt: number | null;
  readonly lastCheckpointNote: string | null;
}
/** One unresolved Agent PlanFork (Future zone overlay — §27.4/§27.6:
 *  status OPEN or STALE; SELECTED/DISMISSED are terminal and leave the
 *  overlay). Item-level proposal detail stays in the PF store (the
 *  overlay renders from anchors + count until a PF-detail RPC is needed). */
interface PlanForkDto {
  readonly id: string;
  readonly status: 'OPEN' | 'STALE';
  readonly reason: string;
  readonly necessity: string;
  readonly forkAnchor: string;
  readonly mergeAnchor: string;
  readonly createdByRun: string;
  readonly createdAt: number;
  readonly staleReason: string | null;
  readonly proposedItemCount: number;
  readonly baseGitCommit: string | null;
}
interface WorkstreamSnapshot {
  readonly workstream: {
    readonly id: string;
    readonly topicId: string;
    readonly title: string;
    readonly lifecycle: 'PLANNED' | 'REALIZED' | 'DROPPED';
    readonly summary: string | null;
    readonly createdAt: number;
  };
  /** History zone: the log size (the page itself is `queryHistory`). */
  readonly history: {
    readonly eventCount: number;
  };
  /** Current Execution zone (§27.4). */
  readonly current: {
    readonly tasks: readonly CurrentTaskDto[];
    readonly runs: readonly RunDto[];
  };
  /** Future Plan zone (§27.4): canonical G/T/M + unresolved PF overlay. */
  readonly future: {
    readonly plan: {
      readonly orderedItems: readonly PlanItemDto[];
    };
    readonly planForks: readonly PlanForkDto[];
    /** OPEN + STALE PFs (the unresolved set, §3.1). */
    readonly unresolvedPlanForkCount: number;
  };
}
interface QueryHistoryArgs {
  /** The single owner workstream of the log (INV-HIST-3: a query is
   *  scoped to ONE owner and cannot mix owners). */
  readonly workstreamId: string;
  /** Replay order. Default `'semantic'` (the default UI timeline). */
  readonly order?: 'semantic' | 'audit';
  /** Exclusive lower bound on `eventSeq`. Default 0 = from the beginning. */
  readonly afterSeq?: number;
  /** Exclusive upper bound on `eventSeq` (must be > afterSeq + 1). */
  readonly beforeSeq?: number;
  /** Page size in rows (caps the window at afterSeq + limit). */
  readonly limit?: number;
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string;
}
/** One history event: the frozen envelope (HISTORY_EVENT_CATALOG §1) as
 *  stored — camelCase envelope, frozen snake_case JSON carriers for
 *  actor/source. `payload` is the per-event-type JSON validated against
 *  the frozen catalog schemas at append time (the WP-2.2 registry); the
 *  RPC face carries it verbatim (no re-validation of 20 payload shapes at
 *  the wire — the catalog is a separate frozen face). */
interface HistoryEventDto {
  readonly eventId: string;
  readonly ownerWorkstreamId: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly occurredAt: number;
  readonly actor: {
    readonly kind: string;
    readonly user_id?: string;
    readonly run_id?: string;
    readonly session_id?: string;
    readonly label?: string;
  };
  readonly source: {
    readonly kind: string;
    readonly session_id?: string;
    readonly path?: string;
    readonly commit_oid?: string;
    readonly interaction_id?: string;
    readonly note?: string;
  } | null;
  readonly payload: Record<string, unknown>;
  readonly eventSeq: number;
  readonly recordedAt: number;
}
interface QueryHistoryResult {
  /** The window's rows, in the requested order (the page is NEVER
   *  truncated mid-window — the seq-axis partition protocol). */
  readonly events: readonly HistoryEventDto[];
  /** Exclusive lower bound for the NEXT page, or `null` when `exhausted`. */
  readonly nextAfterSeq: number | null;
  readonly exhausted: boolean;
}
interface ReorderPlanArgs {
  readonly workstreamId: string;
  readonly orderedItemIds: readonly string[];
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string;
}
interface ReorderPlanResult {
  readonly workstreamId: string;
  readonly orderedItemIds: readonly string[];
  /** The rewritten `plan.yaml` (`.research`-relative POSIX). */
  readonly planPath: string;
  /** The `management_action` PLAN_REORDER ledger row (DOMAIN_SCHEMA
   *  §12.1: ResearchHistory does NOT record plan management ops). */
  readonly managementActionId: string;
}
interface SelectPlanForkArgs {
  readonly planForkId: string;
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string;
}
interface SelectPlanForkResult {
  readonly planForkId: string;
  readonly workstreamId: string;
  readonly statusBefore: 'OPEN';
  readonly statusAfter: 'SELECTED';
  readonly selectedAt: number;
  /** The canonical order before materialization (snapshot). */
  readonly oldOrder: readonly string[];
  /** §6.3 splice result (the post-materialization ordered_items). */
  readonly newOrder: readonly string[];
  /** The materialized NEW items (formal id + definition path). */
  readonly newItems: readonly {
    readonly id: string;
    readonly kind: 'TASK' | 'GATE' | 'MILESTONE';
    readonly path: string;
  }[];
  /** Items leaving the plan (definition files retained — INV-PLAN-9). */
  readonly removedIds: readonly string[];
  /** §6.5 chained stale-marking of the other OPEN PFs of the workstream. */
  readonly staleOthers: readonly {
    readonly planForkId: string;
    readonly staleReason: string;
  }[];
  /** The rewritten `plan.yaml` (`.research`-relative POSIX). */
  readonly planYamlPath: string;
  /** §6.7 checkpoint hint (explicit, optional, NEVER automatic — INV-GIT-2). */
  readonly checkpointHint: string;
}
interface DismissPlanForkArgs {
  readonly planForkId: string;
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string;
}
interface DismissPlanForkResult {
  readonly planForkId: string;
  readonly workstreamId: string;
  readonly statusBefore: 'OPEN' | 'STALE';
  readonly statusAfter: 'DISMISSED';
  readonly dismissedAt: number;
}
interface UpdateInterventionStateArgs {
  readonly interventionId: string;
  readonly status: 'OPEN' | 'PENDING' | 'CLOSED';
  /** Only for `status: 'CLOSED'` (「关闭时用户填写」, DOMAIN_SCHEMA §9.2). */
  readonly resolutionNote?: string;
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string;
}
interface UpdateInterventionStateResult {
  readonly interventionId: string;
  readonly statusFrom: 'OPEN' | 'PENDING' | 'CLOSED';
  readonly statusTo: 'OPEN' | 'PENDING' | 'CLOSED';
  /** Written when `statusTo === 'CLOSED'` (epoch ms). */
  readonly closedAt: number | null;
  readonly resolutionNote: string | null;
}
interface RegisterInteractionArgs {
  readonly kind: 'MEETING' | 'AD_HOC_DISCUSSION' | 'SUPERVISOR_UPDATE' | 'COLLABORATOR_DISCUSSION' | 'EXPERIMENT_SHIFT_HANDOFF' | 'OTHER';
  readonly title: string;
  readonly occurredAt: number;
  readonly participants?: readonly string[];
  readonly notes?: string;
  readonly relatedWorkstreams?: readonly string[];
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string;
}
interface RegisterInteractionResult {
  /** The allocated INT id (`INT-<n>`, PROJECT scope — DOMAIN_SCHEMA §1.1). */
  readonly id: string;
  readonly kind: 'MEETING' | 'AD_HOC_DISCUSSION' | 'SUPERVISOR_UPDATE' | 'COLLABORATOR_DISCUSSION' | 'EXPERIMENT_SHIFT_HANDOFF' | 'OTHER';
  readonly title: string;
  readonly occurredAt: number;
  readonly participants: readonly string[];
  readonly notes: string | null;
  readonly relatedWorkstreams: readonly string[];
  readonly createdAt: number;
}
interface SaveResearchCheckpointArgs {
  /** The commit summary; the message is `research: <summary>` (§5). */
  readonly summary: string;
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string;
}
interface SaveResearchCheckpointResult {
  /** false only for the no-change short-circuit (a successful no-op;
   *  no empty commit — TC-GIT-014). */
  readonly committed: boolean;
  readonly commitOid: string | null;
  /** The `.research/**` paths that entered the commit (sorted). */
  readonly changedFiles: readonly string[];
  readonly warnings: readonly string[];
  readonly message: string | null;
}
interface GetGitHistoryArgs {
  /** One `.research/**` file (repo-root-relative); default: the whole
   *  `.research/**` tree. */
  readonly path?: string;
  /** Baseline commit OID (full 40-hex) for the file-level diff face. */
  readonly baseline?: string;
  /** Max versions returned (W6 pagination). */
  readonly maxCount?: number;
  /** Skip the newest N versions (W6 pagination). */
  readonly skip?: number;
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string;
}
interface GitVersionDto {
  readonly oid: string;
  readonly authorDate: string;
  readonly subject: string;
}
interface GitDiffEntryDto {
  /** Status token as printed: M / A / D / T / R100 / C75 … */
  readonly status: string;
  readonly path: string;
  readonly oldPath: string | null;
}
interface GetGitHistoryResult {
  /** W6 version list, newest → oldest. */
  readonly versions: readonly GitVersionDto[];
  /** Baseline ↔ working-tree file-level M/A/D/R (`.research/**` only);
   *  `null` when no baseline was given. */
  readonly fileDiff: readonly GitDiffEntryDto[] | null;
  readonly baseline: string | null;
  /** Single-file vs baseline content verdict (only when `path` and
   *  `baseline` are both given); `null` otherwise / when the baseline
   *  commit does not contain the path. */
  readonly pathContent: {
    readonly path: string;
    readonly sameAsBaseline: boolean;
  } | null;
}
interface RestoreDeclarativeFileArgs {
  /** The source commit (full 40-hex OID). */
  readonly commitOid: string;
  /** The file to restore (repo-root-relative, inside `.research/**`). */
  readonly path: string;
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it; old callers stay compatible). */
  readonly projectId?: string;
}
interface RestoreDeclarativeFileResult {
  readonly path: string;
  readonly commitOid: string;
  /** Post-restore loader validation verdict for the restored file (§6). */
  readonly validationOk: boolean;
  readonly validationErrors: readonly {
    readonly file: string;
    readonly path: string | null;
    readonly summary: string;
  }[];
  /** §6: illegal content → warning + the file is kept as-is (no silent
   *  rollback). */
  readonly warnings: readonly string[];
}
/**
 * One active plane project on the wire (MANAGED or STANDALONE — both
 * carry a live tree; the §12.1 routable set). `displayName` is the
 * registry entry's `displayName` (MANAGED) or the tree
 * `project.yaml` title (STANDALONE — an unregistered tree has no
 * registry entry to read it from).
 */
interface PlaneProjectDto {
  readonly projectId: string;
  readonly displayName: string;
  readonly kind: 'MANAGED' | 'STANDALONE';
  readonly wsPath: string;
}
/**
 * One MISSING registration on the wire (design §4: active entry whose
 * tree was not discovered — 挂起，等待用户处置). `wsPath` is the entry's
 * registered path (where the tree is expected); `deferred` is the
 * 「推后处理」 runtime flag of THIS backend run (in-memory, never
 * persisted — design §14).
 */
interface PlaneMissingDto {
  readonly projectId: string;
  readonly displayName: string;
  readonly wsPath: string;
  readonly deferred: boolean;
}
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
interface RegistryEntryDto {
  readonly id: string;
  readonly path: string;
  readonly displayName: string;
  readonly status: 'active' | 'archived';
  readonly boundAt: number;
  readonly archivedAt: number | null;
}
/**
 * The plane state summary — design §4 step 6 汇总 as served on the
 * wire: the hub, the configured directory names, the active projects,
 * the MISSING set, and the full registry book (ACTIVE + ARCHIVED,
 * declaration order — design §7.4 ③; `[]` when no hub is set). This
 * IS the `rescan` result, and the `getResearchPlaneState` result
 * minus the caller-session segment (design §12: rescan 返回 plane
 * 摘要 — 同 getResearchPlaneState 去掉 session 段).
 */
interface PlaneStateSummary {
  readonly hub: {
    readonly path: string;
  } | null;
  readonly dirNames: {
    readonly treeDir: string;
    readonly hubDir: string;
  };
  readonly projects: readonly PlaneProjectDto[];
  readonly missing: readonly PlaneMissingDto[];
  /** Every registry.yaml entry, ACTIVE + ARCHIVED, declaration order; `[]` when no hub. */
  readonly registry: readonly RegistryEntryDto[];
}
/**
 * The caller-session segment (design §5 角色解析与标签页分流 — the
 * TAB-BODY role decision). `cwd` is the session's working directory
 * (`null` ⟺ `role === 'NO_CWD'`); `hubTreeProjectId` is attached when
 * `role === 'HUB'` — the project id of the hub workspace's OWN tree
 * when it carries one (a hub that is also a project), `null` when the
 * hub carries no tree — and omitted for every non-HUB session.
 */
interface PlaneSessionDto {
  readonly cwd: string | null;
  readonly role: 'HUB' | 'MANAGED' | 'STANDALONE' | 'UNREGISTERED' | 'NO_CWD';
  readonly hubTreeProjectId?: string | null;
}
interface GetResearchPlaneStateArgs {
  /**
   * The calling session to resolve a `cwd`/role for (the client passes
   * its own session id; the host reads the cwd from the session
   * registry). Omitted → the result's `session` is `null` (the plane
   * state without a caller — the 设置页① read).
   */
  readonly sessionId?: string;
}
interface GetResearchPlaneStateResult {
  readonly hub: {
    readonly path: string;
  } | null;
  readonly dirNames: {
    readonly treeDir: string;
    readonly hubDir: string;
  };
  readonly projects: readonly PlaneProjectDto[];
  readonly missing: readonly PlaneMissingDto[];
  /** Every registry.yaml entry, ACTIVE + ARCHIVED, declaration order; `[]` when no hub. */
  readonly registry: readonly RegistryEntryDto[];
  /** `null` when `sessionId` was omitted (or names an unknown session — see {@link PlaneErrorCode} `PLANE_SESSION_UNKNOWN`; the T3.2 implementation decides the failure branch). */
  readonly session: PlaneSessionDto | null;
}
interface GetHubOverviewArgs {}
interface HubOverviewResult {
  /** 聚合条 (design §7.1): project count / open-intervention total / inbox total. */
  readonly totals: {
    readonly projects: number;
    readonly openInterventions: number;
    readonly inbox: number;
  };
  /**
   * The 「需关注」 row: ONLY the projects with open interventions
   * (`openCount` is therefore positive — an empty row is an empty
   * array, the host renders nothing for it, 无则整行不渲染).
   * `oldestHours` = hours since the OLDEST open intervention of the
   * project (the 「最旧 3 天」 display carrier).
   */
  readonly attention: readonly {
    readonly projectId: string;
    readonly displayName: string;
    readonly openCount: number;
    readonly oldestHours: number;
  }[];
  /** The card wall: one card per ACTIVE project (MANAGED + STANDALONE), all fields from existing data (零新增字段). */
  readonly cards: readonly {
    readonly projectId: string;
    readonly displayName: string;
    readonly title: string;
    readonly description: string | null;
    readonly attentionMode: 'FOCUS' | 'NORMAL' | 'BACKGROUND';
    readonly targetDate: number | null;
    readonly openInterventions: number;
    readonly pendingInterventions: number;
    readonly topics: number;
    readonly inboxCount: number;
  }[];
}
interface GetPortfolioInterventionsArgs {
  /**
   * Status filter; omitted → the design §7.2 default view (OPEN +
   * PENDING — 待处理+待确认; CLOSED is folded away by default).
   */
  readonly status?: 'OPEN' | 'PENDING' | 'CLOSED';
}
/** One cross-project intervention (the InterventionDto fields + the project label, design §7.2 项目标签). */
interface PortfolioInterventionItemDto {
  readonly projectId: string;
  readonly displayName: string;
  readonly id: string;
  readonly title: string;
  readonly origin: 'USER' | 'AGENT_REPORT' | 'AUTO_FLOODING' | 'AUTO_AUDIT';
  readonly status: 'OPEN' | 'PENDING' | 'CLOSED';
  readonly workstreamIds: readonly string[];
  readonly createdAt: number;
}
interface GetPortfolioInterventionsResult {
  readonly items: readonly PortfolioInterventionItemDto[];
}
interface SetHubArgs {
  /** The workspace to turn into the hub (must be a registered DSH workspace, absolute path). */
  readonly wsPath: string;
}
interface SetHubResult {
  /** The hub workspace path (= the requested `wsPath`, canonicalized). */
  readonly hubPath: string;
  /** The created registry file: `<hubPath>/<hubDir>/registry.yaml`. */
  readonly registryPath: string;
}
interface BindProjectArgs {
  /** The workspace to register (must be a registered DSH workspace, absolute path). */
  readonly wsPath: string;
  /** The registry entry's display name; omitted → the host default (the folder name, design §8 弹窗收集). */
  readonly displayName?: string;
  /** `true` → scaffold a minimal tree when none exists; `false`/omitted → a discovered tree is REQUIRED (else `PLANE_TREE_MISSING`). A scaffold never clobbers an existing tree (else `PLANE_TREE_EXISTS`). */
  readonly scaffold?: boolean;
}
interface BindProjectResult {
  readonly projectId: string;
  /**
   * The registry file the entry was appended to. `null` when the plane
   * has NO hub (design §8 接入（无中枢）: the standalone flow creates the
   * tree and the db in `<treeDir>/state/` — there is no registry to
   * append to; the plane state then shows the project as STANDALONE).
   */
  readonly registryPath: string | null;
  /** Whether an existing standalone db was MIGRATED into the hub (design §9 收编 — move, verify, then delete the source; never a copy). */
  readonly dbMigrated: boolean;
}
interface UnbindProjectArgs {
  /** The bound project's workspace (absolute path; the entry is located by path, the result names its id). */
  readonly wsPath: string;
}
interface UnbindProjectResult {
  readonly projectId: string;
  /** The absolute path of the RENAMED tree directory (`<treeDir>.archived-<时间戳>` — the symmetric restore target, design §7.4 「恢复登记」). */
  readonly archivedDir: string;
}
interface RestoreProjectArgs {
  /** The archived entry's project id (a live project id is refused — restore is for 解绑 tombstones only). */
  readonly projectId: string;
}
interface RestoreProjectResult {
  /** The project's workspace path (the entry's registered path, where the tree was renamed back). */
  readonly wsPath: string;
}
interface RescanArgs {}
/** The rescan result: the plane summary, verbatim (no session segment). */
type RescanResult = PlaneStateSummary;
interface AckMissingReminderArgs {
  /** The MISSING entry's project id (an id outside the MISSING set is refused with `PLANE_NOT_MISSING`). */
  readonly projectId: string;
}
interface AckMissingReminderResult {
  readonly acknowledged: true;
}
interface SetCurrentFocusArgs {
  readonly workstreamId: string;
  /** The target canonical Plan member id (T/G/M). */
  readonly planItemId: string;
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it). */
  readonly projectId?: string;
}
interface SetCurrentFocusResult {
  readonly workstreamId: string;
  readonly planItemId: string;
  /** The row write stamp (epoch ms) — the client invalidation version. */
  readonly updatedAt: number;
}
interface GetCurrentFocusArgs {
  readonly workstreamId: string;
  /** V2 §12.1: optional multi-project routing target. */
  readonly projectId?: string;
}
interface GetCurrentFocusResult {
  readonly workstreamId: string;
  /** `null` = no pointer for this workstream (never set / auto-cleared
   *  when the target left the canonical Plan). */
  readonly focus: {
    readonly planItemId: string;
    readonly updatedAt: number;
  } | null;
}
interface CreateTopicArgs {
  /** 1–200 chars (frozen topic.schema.json). */
  readonly title: string;
  /** Omitted = field absent from the written YAML (no default injected). */
  readonly description?: string;
  /** V2 §12.1: optional multi-project routing target (omitted → the plane resolves it). */
  readonly projectId?: string;
}
interface CreateTopicResult {
  readonly topicId: string;
  readonly title: string;
  /** Root-relative path of the written file (e.g. `topics/TPC-2/topic.yaml`). */
  readonly path: string;
  /** `created_at` as epoch ms (the client invalidation version). */
  readonly createdAt: number;
}
interface CreateWorkstreamArgs {
  readonly topicId: string;
  /** 1–200 chars (frozen workstream.schema.json). */
  readonly title: string;
  /** Omitted = field absent from the written YAML (lifecycle defaults to
   *  PLANNED by the frozen schema). */
  readonly summary?: string;
  /** V2 §12.1: optional multi-project routing target. */
  readonly projectId?: string;
}
interface CreateWorkstreamResult {
  readonly workstreamId: string;
  readonly topicId: string;
  readonly title: string;
  /** Root-relative path of the written file (e.g. `topics/TPC-1/workstreams/WS-2/workstream.yaml`). */
  readonly path: string;
  /** `created_at` as epoch ms. */
  readonly createdAt: number;
}
interface UpdateProjectMetadataArgs {
  /** 1–200 chars (frozen project.schema.json `title`). */
  readonly title?: string;
  /** Any string (frozen `description` — no length cap). */
  readonly description?: string;
  /** Integer 1–5 (frozen `importance`). */
  readonly importance?: number;
  /** Frozen enum (frozen `attention_mode`). */
  readonly attentionMode?: 'FOCUS' | 'NORMAL' | 'BACKGROUND';
  /** `YYYY-MM-DD` (frozen `target_date`). */
  readonly targetDate?: string;
  /** V2 §12.1: optional multi-project routing target. */
  readonly projectId?: string;
}
interface UpdateProjectMetadataResult {
  readonly projectId: string;
  /** The effective title after the merge. */
  readonly title: string;
  /** Write stamp, epoch ms (client invalidation version — the frozen
   *  schema has no `updated_at` field). */
  readonly updatedAt: number;
}
interface UpdateTopicArgs {
  /** An existing topic of the routed project. */
  readonly topicId: string;
  /** 1–200 chars (frozen topic.schema.json `title`). */
  readonly title?: string;
  readonly description?: string;
  readonly importance?: number;
  readonly attentionMode?: 'FOCUS' | 'NORMAL' | 'BACKGROUND';
  /** V2 §12.1: optional multi-project routing target. */
  readonly projectId?: string;
}
interface UpdateTopicResult {
  readonly topicId: string;
  /** The effective title after the merge. */
  readonly title: string;
  /** Write stamp, epoch ms. */
  readonly updatedAt: number;
}
interface UpdateWorkstreamArgs {
  /** An existing workstream of the routed project. */
  readonly workstreamId: string;
  /** 1–200 chars (frozen workstream.schema.json `title`). */
  readonly title?: string;
  readonly summary?: string;
  /** V2 §12.1: optional multi-project routing target. */
  readonly projectId?: string;
}
interface UpdateWorkstreamResult {
  readonly workstreamId: string;
  /** The topic the workstream lives under (change fact for
   *  invalidation). */
  readonly topicId: string;
  /** The effective title after the merge. */
  readonly title: string;
  /** Write stamp, epoch ms. */
  readonly updatedAt: number;
}
interface DropWorkstreamArgs {
  /** The workstream to drop. */
  readonly workstreamId: string;
  /** V2 §12.1: optional multi-project routing target. */
  readonly projectId?: string;
}
interface DropWorkstreamResult {
  readonly workstreamId: string;
  /** The topic the workstream lived under (change fact for
   *  invalidation — the topic itself still exists). */
  readonly topicId: string;
  /** Whether the post-delete best-effort current-focus clear removed a
   *  live pointer (false = no pointer to clear, or the clear failed —
   *  non-blocking either way). */
  readonly currentFocusCleared: boolean;
}
type InspectProjectDirectoryState = 'RC_PROJECT' | 'GIT_ONLY' | 'PLAIN_DIR' | 'INCOMPATIBLE';
interface InspectProjectDirectoryArgs {
  /** The registered DSH workspace path to inspect (absolute). */
  readonly wsPath: string;
}
interface InspectProjectDirectoryResult {
  readonly wsPath: string;
  /** The detected state (the B spec's four branch points). */
  readonly state: InspectProjectDirectoryState;
  /** The verbatim detected-state line (the B spec copy — the
   *  INCOMPATIBLE reason lives in `detail`). */
  readonly message: string;
  /** The second detected-state line (GIT_ONLY / PLAIN_DIR) or the
   *  INCOMPATIBLE conflict reason; `null` for RC_PROJECT. */
  readonly detail: string | null;
  readonly hasGitRepo: boolean;
  readonly hasResearchTree: boolean;
  readonly treeValid: boolean;
  /** The plane-state fact (already managed — the Bind action still
   *  offers; a re-bind refusal surfaces from bindProject itself). */
  readonly alreadyManaged: boolean;
  /** The tree's project id (RC_PROJECT only). */
  readonly projectId?: string;
  /** The `project.yaml` title (RC_PROJECT only). */
  readonly title?: string;
}
interface CreateLocalResearchProjectArgs {
  /** The registered DSH workspace path (the tree's parent). */
  readonly wsPath: string;
  /** 1–200 chars (frozen project.schema.json `title` — becomes the
   *  scaffolded `project.yaml` title = the registry display name). */
  readonly title: string;
  readonly description?: string;
  /** Integer 1–5 (frozen `importance`). */
  readonly importance?: number;
  readonly attentionMode?: 'FOCUS' | 'NORMAL' | 'BACKGROUND';
  /** `YYYY-MM-DD` (frozen `target_date`). */
  readonly targetDate?: string;
}
/** The create step vocabulary (the failure arm's `failedStep` /
 *  `completedSteps`). */
type CreateLocalResearchProjectWireStep = 'mkdir' | 'gitInit' | 'scaffold' | 'metadata' | 'register';
/** The LP_* codes that can appear in the failure arm (the STEP codes —
 *  the pre-check codes LP_INPUT / LP_PARENT_INVALID / LP_DIR_EXISTS
 *  throw instead, because no step has started; their carrier rides the
 *  gateway error message like the PLANE_* rung carriers). */
type CreateLocalResearchProjectWireCode = 'LP_MKDIR' | 'LP_GIT_INIT' | 'LP_SCAFFOLD' | 'LP_METADATA' | 'LP_REGISTER';
interface CreateLocalResearchProjectSuccessResult {
  readonly ok: true;
  readonly projectId: string;
  /** The absolute tree directory that was created. */
  readonly treePath: string;
  /** `null` when the plane has no hub (the standalone flow — no
   *  registry to append to). */
  readonly registryPath: string | null;
  readonly dbMigrated: boolean;
}
interface CreateLocalResearchProjectFailureResult {
  readonly ok: false;
  readonly code: CreateLocalResearchProjectWireCode;
  readonly failedStep: CreateLocalResearchProjectWireStep;
  /** The steps that completed (and left a durable trace) before the
   *  failure — `[]` when the first step failed. */
  readonly completedSteps: readonly CreateLocalResearchProjectWireStep[];
  /** Human-facing: what now exists on disk (the spec's partial-change
   *  note). */
  readonly partialChangeNote: string;
  /** The raw failure detail (the fs / git / scaffold / registry error
   *  message, carrier-free — `code` is the machine key for this arm). */
  readonly detail: string;
}
type CreateLocalResearchProjectResult = CreateLocalResearchProjectSuccessResult | CreateLocalResearchProjectFailureResult;
/** One `affects` target (DOMAIN_SCHEMA §9.4 TypedRef; kind WS/T/R). */
interface AffectsRefDto {
  readonly kind: 'WORKSTREAM' | 'TASK' | 'RUN';
  readonly id: string;
}
/** One Objective linked-ref (DOMAIN_SCHEMA §9.1; objectives.schema.json
 *  limits the kind to GATE/MILESTONE/WORKSTREAM — the id is a bare
 *  member id, membership validated service-side like CF). */
interface LinkedRefDto {
  readonly kind: 'GATE' | 'MILESTONE' | 'WORKSTREAM';
  readonly id: string;
}
/** One full Objective (the frozen {@link ObjectiveDto} fields + the §9.1
 *  success-criteria / linked-refs read face; ADJ-6 current-objective
 *  carrier). */
interface ObjectiveFullDto {
  readonly id: string;
  readonly scope: 'PROJECT' | 'TOPIC';
  readonly statement: string;
  readonly status: 'ACTIVE' | 'ACHIEVED' | 'DROPPED';
  readonly priority: 'P0' | 'P1' | 'P2' | 'P3';
  readonly targetDate: number | null;
  readonly successCriteria: readonly string[];
  readonly linkedRefs: readonly LinkedRefDto[];
}
/** One NextAction (DOMAIN_SCHEMA §9.3; absent optionals → null on the
 *  wire; `promotedToTaskId` only when status = PROMOTED). */
interface NextActionDto {
  readonly id: string;
  readonly workstreamId: string | null;
  readonly statement: string;
  readonly rationale: string | null;
  readonly status: 'PROPOSED' | 'PROMOTED' | 'DISMISSED';
  readonly promotedToTaskId: string | null;
  readonly createdAt: number;
}
/** One Explicit Blocker (DOMAIN_SCHEMA §9.4). */
interface BlockerDto {
  readonly id: string;
  readonly statement: string;
  readonly affects: readonly AffectsRefDto[];
  readonly status: 'ACTIVE' | 'CLEARED';
  /** The source note (§9.4 required free text). */
  readonly source: string;
  readonly references: readonly string[] | null;
  readonly createdAt: number;
  readonly clearedAt: number | null;
}
/** One DERIVED blocker (ADJ-4: a read-only projection — the synthetic
 *  id `DERIVED-<source>-<refId>` is never allocated, never persisted;
 *  there is NO clear RPC for this face). */
interface DerivedBlockerDto {
  readonly id: string;
  readonly source: 'DEPENDENCY' | 'GATE' | 'RULE';
  readonly statement: string;
  readonly reasonRefs: readonly string[];
  /** The true-cause link (the zone renders the label verbatim). */
  readonly primaryAction: {
    readonly label: string;
    readonly targetKind: 'TASK' | 'GATE' | 'MILESTONE' | 'WORKSTREAM' | 'RUN';
    readonly targetId: string;
  };
}
/** One full Intervention (the frozen {@link InterventionDto} fields +
 *  the §9.2 detail / closure read face). */
interface InterventionFullDto {
  readonly id: string;
  readonly title: string;
  readonly origin: 'USER' | 'AGENT_REPORT' | 'AUTO_FLOODING' | 'AUTO_AUDIT';
  readonly status: 'OPEN' | 'PENDING' | 'CLOSED';
  readonly workstreamIds: readonly string[];
  readonly createdAt: number;
  readonly detail: string | null;
  readonly closedAt: number | null;
  readonly resolutionNote: string | null;
}
/** UI-5 (ADJ-7): one ACTIVE DEPENDS_ON edge of the canonical plan —
 *  both endpoints in the plan, sorted by relation id (the strip/graph
 *  face; the WorkstreamSnapshot itself stays zero-touched). */
interface DependencyEdgeDto {
  readonly relationId: string;
  /** The source plan-item id (T-…/G-…/M-…). */
  readonly sourceId: string;
  /** The target plan-item id (T-…/G-…/M-…). */
  readonly targetId: string;
}
interface GetWorkstreamCurrentArgs {
  readonly workstreamId: string;
  /** V2 §12.1: optional multi-project routing target. */
  readonly projectId?: string;
}
interface GetWorkstreamCurrentResult {
  readonly workstreamId: string;
  /** ACTIVE objectives whose linked_refs contain this WORKSTREAM,
   *  priority-sorted (the header row shows the first; ADJ-6). */
  readonly objectives: readonly ObjectiveFullDto[];
  /** Explicit blockers affecting the WS itself or a member Task/Run
   *  (ADJ-5). */
  readonly explicitBlockers: readonly BlockerDto[];
  /** The ADJ-3 mechanical derived projection (DEPENDENCY/GATE; RULE =
   *  the empty set in v1). */
  readonly derivedBlockers: readonly DerivedBlockerDto[];
  /** The PROPOSED next actions naming this WS (the actionable set). */
  readonly nextActions: readonly NextActionDto[];
  /** The interventions naming this WS (all states — the zone renders
   *  the closure state). */
  readonly interventions: readonly InterventionFullDto[];
  /** UI-5 (ADJ-7): the ACTIVE DEPENDS_ON edges of the canonical plan
   *  (both endpoints in the plan; sorted by relation id — zero new
   *  reads: folded from the events the zone already loads). */
  readonly dependencyEdges: readonly DependencyEdgeDto[];
}
interface UpdateObjectiveArgs {
  readonly objectiveId: string;
  readonly statement?: string;
  /** A status transition (the frozen §13 machine is checked). */
  readonly status?: 'ACTIVE' | 'ACHIEVED' | 'DROPPED';
  readonly projectId?: string;
}
interface UpdateObjectiveResult {
  readonly objectiveId: string;
  /** The effective status after the update. */
  readonly status: 'ACTIVE' | 'ACHIEVED' | 'DROPPED';
  readonly managementActionId: string;
  /** Write stamp (epoch ms) — the client invalidation version. */
  readonly updatedAt: number;
}
interface CreateNextActionArgs {
  /** The WS the NA names (absent → the NA is unscoped). */
  readonly workstreamId?: string;
  readonly statement: string;
  readonly rationale?: string;
  readonly projectId?: string;
}
interface CreateNextActionResult {
  readonly nextAction: NextActionDto;
}
interface PromoteNextActionArgs {
  readonly nextActionId: string;
  /** Required when the NA carries no workstream_id; must match when it
   *  does (service-checked). */
  readonly workstreamId?: string;
  /** 0-based insert position in the canonical plan (default: tail). */
  readonly index?: number;
  readonly projectId?: string;
}
/** The materialization receipt (the host ActionsService
 *  `PromoteNextActionResult` mapped verbatim). */
interface PromoteNextActionResult {
  readonly nextActionId: string;
  /** The materialized Task id (§9.3 promoted_to_task_id). */
  readonly taskId: string;
  readonly workstreamId: string;
  /** The plan.yaml path relative to `.research/`. */
  readonly planPath: string;
  /** The canonical plan order after materialization. */
  readonly newOrder: readonly string[];
  readonly managementActionId: string;
}
interface DismissNextActionArgs {
  readonly nextActionId: string;
  readonly projectId?: string;
}
interface DismissNextActionResult {
  readonly nextAction: NextActionDto;
}
interface CreateBlockerArgs {
  readonly statement: string;
  readonly affects: readonly AffectsRefDto[];
  /** The source note (DOMAIN_SCHEMA §9.4 required). */
  readonly source: string;
  readonly references?: readonly string[];
  readonly projectId?: string;
}
interface CreateBlockerResult {
  readonly blocker: BlockerDto;
}
interface ClearBlockerArgs {
  readonly blockerId: string;
  readonly projectId?: string;
}
interface ClearBlockerResult {
  readonly blocker: BlockerDto;
}
/** `createPlanItem` TASK payload (the actual declarative
 *  `task.schema.json` fields: title/goal/acceptance_criteria/
 *  deliverables/note). */
interface CreatePlanItemTaskInput {
  readonly title: string;
  readonly goal?: string;
  readonly acceptanceCriteria?: string[];
  readonly deliverables?: string[];
  readonly note?: string;
}
/** `createPlanItem` GATE payload (the actual declarative
 *  `gate.schema.json` fields — the schema has NO note key). */
interface CreatePlanItemGateInput {
  readonly title: string;
  readonly criteria?: string;
  readonly references?: string[];
}
/** `createPlanItem` MILESTONE payload (the actual declarative
 *  `milestone.schema.json` fields — the schema has NO note key). */
interface CreatePlanItemMilestoneInput {
  readonly title: string;
  readonly statement?: string;
}
/** The wire `item` field — exactly one per-kind payload (the `kind`
 *  arg must name the same kind; the server rejects a disagreeing pair). */
type CreatePlanItemInput = {
  readonly task: CreatePlanItemTaskInput;
} | {
  readonly gate: CreatePlanItemGateInput;
} | {
  readonly milestone: CreatePlanItemMilestoneInput;
};
interface CreatePlanItemArgs {
  readonly workstreamId: string;
  readonly kind: 'TASK' | 'GATE' | 'MILESTONE';
  readonly item: CreatePlanItemInput;
  /** 0-based insertion index into the canonical order (default = tail). */
  readonly index?: number;
  readonly projectId?: string;
}
interface CreatePlanItemResult {
  readonly itemId: string;
  readonly workstreamId: string;
  readonly kind: 'TASK' | 'GATE' | 'MILESTONE';
  /** The `.research/`-relative `plan.yaml` path. */
  readonly planPath: string;
  /** The canonical order AFTER the create (full id list). */
  readonly newOrder: string[];
  readonly managementActionId: string;
}
/** `updatePlanItem` changes — a per-kind OPTIONAL SUBSET (RMW: omit =
 *  unchanged; explicit `null` = clear the named optional field). The
 *  item kind is derived from the `itemId` prefix server-side; a field
 *  that belongs to a different kind is rejected by the kernel's frozen
 *  schema re-validation (fail-loud — the SCHEMA carrier rides the wire). */
interface UpdatePlanItemChanges {
  readonly title?: string;
  readonly goal?: string | null;
  readonly criteria?: string | null;
  readonly statement?: string | null;
  readonly acceptanceCriteria?: string[] | null;
  readonly deliverables?: string[] | null;
  readonly references?: string[] | null;
  readonly note?: string | null;
}
interface UpdatePlanItemArgs {
  readonly workstreamId: string;
  readonly itemId: string;
  readonly changes: UpdatePlanItemChanges;
  readonly projectId?: string;
}
interface UpdatePlanItemResult {
  readonly itemId: string;
  readonly workstreamId: string;
  /** The write stamp (epoch ms) — the client invalidation version.
   *  ADJ-4: NO managementActionId field (update writes no ledger row —
   *  the frozen 15-kind enum has no update kind; the field is absent,
   *  not null). */
  readonly updatedAt: number;
}
interface RemovePlanItemArgs {
  readonly workstreamId: string;
  readonly itemId: string;
  readonly projectId?: string;
}
interface RemovePlanItemResult {
  readonly workstreamId: string;
  /** The `.research/`-relative `plan.yaml` path. */
  readonly planPath: string;
  /** The canonical order AFTER the remove (full id list). */
  readonly newOrder: string[];
  readonly managementActionId: string;
  /** ADJ-14 (RPC layer): true when the removed item WAS the WS current
   *  focus — the @Remote wrapper clears the stale pointer after the
   *  service succeeds and folds this flag into the wire result. */
  readonly currentFocusCleared: boolean;
}
/** A plan-item endpoint of a dependency edge (kind ∈ TASK/GATE/
 *  MILESTONE; both endpoints must resolve inside the same workstream —
 *  the `workstreamId` arg names that WS, validated server-side). */
interface DependencyEndpointRef {
  readonly kind: 'TASK' | 'GATE' | 'MILESTONE';
  readonly id: string;
}
interface AddDependencyArgs {
  readonly workstreamId: string;
  readonly source: DependencyEndpointRef;
  readonly target: DependencyEndpointRef;
  readonly projectId?: string;
}
interface AddDependencyResult {
  readonly relationId: string;
  /** The echoed source endpoint. */
  readonly source: DependencyEndpointRef;
  /** The echoed target endpoint. */
  readonly target: DependencyEndpointRef;
}
interface RemoveDependencyArgs {
  readonly workstreamId: string;
  readonly relationId: string;
  readonly projectId?: string;
}
interface RemoveDependencyResult {
  readonly relationId: string;
}
//#endregion
export { RemoveDependencyResult as $, GetGitHistoryArgs as A, UpdateTopicArgs as At, GetWorkstreamCurrentResult as B, DismissNextActionResult as C, UpdateInterventionStateResult as Ct, DropWorkstreamResult as D, UpdatePlanItemResult as Dt, DropWorkstreamArgs as E, UpdatePlanItemArgs as Et, GetResearchPlaneStateArgs as F, ProjectSnapshot as G, InspectProjectDirectoryArgs as H, GetResearchPlaneStateResult as I, QueryHistoryArgs as J, PromoteNextActionArgs as K, GetTopicArgs as L, GetHubOverviewArgs as M, UpdateWorkstreamArgs as Mt, GetPortfolioInterventionsArgs as N, UpdateWorkstreamResult as Nt, GetCurrentFocusArgs as O, UpdateProjectMetadataArgs as Ot, GetPortfolioInterventionsResult as P, WorkstreamSnapshot as Pt, RemoveDependencyArgs as Q, GetWorkstreamArgs as R, DismissNextActionArgs as S, UpdateInterventionStateArgs as St, DismissPlanForkResult as T, UpdateObjectiveResult as Tt, InspectProjectDirectoryResult as U, HubOverviewResult as V, PingResult as W, RegisterInteractionArgs as X, QueryHistoryResult as Y, RegisterInteractionResult as Z, CreateTopicArgs as _, SetHubResult as _t, BindProjectArgs as a, RescanResult as at, CreateWorkstreamResult as b, UnbindProjectArgs as bt, ClearBlockerResult as c, RestoreProjectArgs as ct, CreateLocalResearchProjectArgs as d, SaveResearchCheckpointResult as dt, RemovePlanItemArgs as et, CreateLocalResearchProjectResult as f, SelectPlanForkArgs as ft, CreatePlanItemResult as g, SetHubArgs as gt, CreatePlanItemArgs as h, SetCurrentFocusResult as ht, AddDependencyResult as i, RescanArgs as it, GetGitHistoryResult as j, UpdateTopicResult as jt, GetCurrentFocusResult as k, UpdateProjectMetadataResult as kt, CreateBlockerArgs as l, RestoreProjectResult as lt, CreateNextActionResult as m, SetCurrentFocusArgs as mt, AckMissingReminderResult as n, ReorderPlanArgs as nt, BindProjectResult as o, RestoreDeclarativeFileArgs as ot, CreateNextActionArgs as p, SelectPlanForkResult as pt, PromoteNextActionResult as q, AddDependencyArgs as r, ReorderPlanResult as rt, ClearBlockerArgs as s, RestoreDeclarativeFileResult as st, AckMissingReminderArgs as t, RemovePlanItemResult as tt, CreateBlockerResult as u, SaveResearchCheckpointArgs as ut, CreateTopicResult as v, TopicSnapshot as vt, DismissPlanForkArgs as w, UpdateObjectiveArgs as wt, DashboardSnapshot as x, UnbindProjectResult as xt, CreateWorkstreamArgs as y, TypertContributionMirror as yt, GetWorkstreamCurrentArgs as z };