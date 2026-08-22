/**
 * WP-1.1 — `.research/` declarative source-of-truth: loader types.
 *
 * Frozen contracts implemented here (read-only):
 *  - DOMAIN_SCHEMA.md §1 (ID rules, §1.2 time carriers, §1.3/§1.4), §2 (hierarchy
 *    objects), §3 (topology), §4 (plan objects), §9.1 (Objectives), §14 (layout +
 *    §14.1 workspace.yaml), §16.1 (declarative→declarative reference integrity);
 *  - schema/declarative/*.json (11 files) + schema/common.schema.json (draft 2020-12);
 *  - PLAN_FORK_SPEC.md §9 (agent-plan-fork policy document).
 *
 * Layer rules (ARCHITECTURE.md §2.2 rule 1): this module is pure domain logic.
 * It performs no I/O of its own — every byte is read through the injected
 * `ResearchFileReader` (implemented by the service/workspace layer in a later
 * WP, or by an in-memory fake in tests). No DSH imports (INV-PERM-5), no
 * git imports (WP boundary: git is a separate layer, §2.1).
 */

/* ------------------------------------------------------------------ *
 * File access (injected; the only I/O seam into this module)
 * ------------------------------------------------------------------ */

/** One entry of a directory listing. */
export interface DirEntry {
  name: string
  kind: 'file' | 'directory'
}

/**
 * Synchronous read-only file access. The domain kernel stays synchronous and
 * deterministic: the fs-backed implementation (later service-layer WP) maps
 * `readDir`/`readFile` onto `fs.readdirSync`/`fs.readFileSync`.
 *
 * - `readDir` returns `null` when the path does not exist;
 * - `readFile` returns `null` when the path does not exist or is not a regular file;
 * - any other failure (permissions, I/O) throws, and the loader converts the
 *   throw into a `READ` load error (aggregation, TC-DOM-027).
 */
export interface ResearchFileReader {
  readDir(path: string): DirEntry[] | null
  readFile(path: string): string | null
}

/* ------------------------------------------------------------------ *
 * Load errors (precise location: file + in-document path + summary)
 * ------------------------------------------------------------------ */

export type LoadErrorCode =
  /** Reader threw (I/O failure at that path). */
  | 'READ'
  /** A schema file under schemaDir is missing or not valid JSON. */
  | 'SCHEMA_LOAD'
  /** A compiled validator for this document type is unavailable (schema failed to load/compile). */
  | 'SCHEMA_UNAVAILABLE'
  /** YAML parse failure (bad syntax, empty file, multiple documents, duplicate keys). */
  | 'PARSE'
  /** JSON Schema (2020-12) validation failure — `path` is the schema instance path, `message` includes the violating value. */
  | 'SCHEMA'
  /** A directory/file name does not conform to the §14 layout id naming rule. */
  | 'PATH_RULE'
  /** File location vs in-file `id`/`*_id`/`workstream` field mismatch (§1.1 rule 3, §14 rule, §2.2/§2.3/§3.1/§4.x path rules). */
  | 'PATH_ID_MISMATCH'
  /** Entry that does not belong to the §14 `.research/` layout at all. */
  | 'UNKNOWN_ENTRY'
  /** Required file absent (schema-version, project.yaml, topic.yaml, workstream.yaml, contract.md). */
  | 'MISSING_REQUIRED'
  /** Dangling declarative→declarative reference (§16.1 load-time full check). */
  | 'DANGLING_REF'
  /** Uniqueness-scope violation within the Project (§1.1, §3.1, §4.4, §9.1). */
  | 'DUPLICATE_ID'
  /** `.research/schema-version` missing, not an integer, or unsupported (V1 loader expects 1). */
  | 'SCHEMA_VERSION'

/** One precisely-located load error (TC-DOM-027 / ARCHITECTURE §10: file + field, no guess-repair). */
export interface ResearchLoadError {
  code: LoadErrorCode
  /**
   * File (or entry) location, relative to the `.research/` root, POSIX-style:
   * `'topics/TPC-1/topic.yaml'`, `'merges/TE-1/contract.md'`. `''` = the root itself.
   */
  file: string
  /**
   * JSON-pointer-style path inside the document (`'/title'`, `'/topology/edges/0/inputs'`,
   * `'/objectives/1/topic_id'`); `undefined` for document-level errors.
   */
  path?: string
  /** Human-readable violation summary, including the violating content when available. */
  message: string
}

/** Result of `loadResearchTree`: the (partially populated) tree + aggregated errors. */
export interface LoadResult {
  /**
   * Everything that loaded and validated. Files with a load error are ABSENT
   * from the docs of this tree (their nodes keep `doc: null`) but their
   * directory skeleton is preserved, per "其余文件正常加载" (TC-DOM-027).
   */
  tree: ResearchTree
  /** All aggregated errors (deterministic order); non-empty ⇒ the tree is incomplete. */
  errors: ResearchLoadError[]
}

/* ------------------------------------------------------------------ *
 * Document types (in-memory carriers, DOMAIN_SCHEMA §1.2)
 *
 * Field names keep the YAML snake_case keys verbatim (the declarative source
 * is the frozen contract; the service layer may re-serialize the same object
 * without a lossy mapping). Timestamp fields are converted at this loader
 * boundary from the YAML carrier (ISO 8601 UTC string) to the memory carrier
 * (epoch milliseconds, INTEGER) — §1.2 "转换在 loader 序列化边界统一完成".
 * Schema `default`s (§14.1 工程默认) are materialized by the validator
 * (ajv useDefaults) at the same boundary.
 * ------------------------------------------------------------------ */

export type AttentionMode = 'FOCUS' | 'NORMAL' | 'BACKGROUND'
export type WsLifecycle = 'PLANNED' | 'REALIZED' | 'DROPPED'
export type EdgeOp = 'FORK' | 'MERGE'
export type ObjStatus = 'ACTIVE' | 'ACHIEVED' | 'DROPPED'
export type ObjPriority = 'P0' | 'P1' | 'P2' | 'P3'
export type ArtifactType = 'DATASET' | 'FIGURE' | 'MODEL' | 'CODE' | 'REPORT' | 'NOTE' | 'OTHER'
export type ObjectiveLinkedKind = 'GATE' | 'MILESTONE' | 'WORKSTREAM'
export type PolicyItemKind = 'TASK' | 'GATE' | 'MILESTONE'
export type PolicyTriggerKind = 'CLAIM' | 'FACT' | 'ARTIFACT' | 'MILESTONE' | 'OBJECTIVE'

/** `.research/project.yaml` (DOMAIN_SCHEMA §2.1). `created_at`/`target_date` = epoch ms. */
export interface ProjectDoc {
  id: string
  title: string
  description?: string
  /** schema default 3. */
  importance: number
  /** schema default NORMAL. */
  attention_mode: AttentionMode
  /** schema default []. Elements must exist in objectives.yaml (§16.1). */
  current_objective_refs: string[]
  /** epoch ms (UTC midnight of the date). */
  target_date?: number
  /** epoch ms. */
  created_at: number
}

/** `.research/topics/<topic-id>/topic.yaml` (DOMAIN_SCHEMA §2.2). */
export interface TopicDoc {
  /** Must equal the directory name (path-id check, loader). */
  id: string
  /** Must equal the loaded Project id (§16.1). */
  project_id: string
  title: string
  description?: string
  importance?: number
  attention_mode?: AttentionMode
  /** schema default []. Elements must exist in objectives.yaml (§16.1). */
  objective_refs: string[]
  /** epoch ms. */
  created_at: number
}

/** `.research/topics/<t>/workstreams/<ws-id>/workstream.yaml` (DOMAIN_SCHEMA §2.3). */
export interface WorkstreamDoc {
  /** Must equal the directory name (path-id check, loader). */
  id: string
  /** Must equal the containing topic directory (path match, INV-STRUCT-1). */
  topic_id: string
  title: string
  /** schema default PLANNED. */
  lifecycle: WsLifecycle
  summary?: string
  /** If present, must be an edge of the same topic (§16.1, loader). */
  origin_topology_edge_ref?: string
  /** epoch ms. */
  created_at: number
}

/** One element of `topology.edges` (DOMAIN_SCHEMA §3.1). */
export interface TopologyEdgeDoc {
  /** Unique within the Project (§1.1, loader). */
  id: string
  /** Must equal the containing topic directory (path match, loader). */
  topic_id: string
  operation: EdgeOp
  lifecycle: WsLifecycle
  /** ≥1, unique, workstreams of the same topic (INV-STRUCT-2, loader). */
  inputs: string[]
  /** ≥1, unique, workstreams of the same topic (loader). */
  outputs: string[]
  /** H id; required by the catalog when lifecycle=REALIZED (operational cross-check, out of scope here). */
  realized_event_id?: string
  note?: string
}

/** `.research/topics/<t>/topology.yaml` (DOMAIN_SCHEMA §3.1). The file carries a
 *  single `topology` wrapper mapping (frozen topology.schema.json). */
export interface TopologyDoc {
  topology: {
    /** Must equal the containing topic directory (path match, loader). */
    topic_id: string
    edges: TopologyEdgeDoc[]
  }
}

/** `.research/topics/<t>/workstreams/<w>/plan.yaml` (DOMAIN_SCHEMA §4.4, INV-PLAN-1/9). */
export interface PlanDoc {
  /** Must equal the containing workstream directory (path match, loader). */
  workstream: string
  /**
   * Ordered G/T/M ids (order = user intent, preserved verbatim, INV-PLAN-1).
   * Elements must have a definition file belonging to THIS workstream, no
   * duplicates (§4.4, §16.1, loader).
   */
  ordered_items: string[]
}

/** `items/tasks/<task-id>.yaml` (DOMAIN_SCHEMA §4.1; declaration-only, INV-PLAN-9). */
export interface TaskDoc {
  /** Must equal the file name (path-id check, loader). */
  id: string
  /** Must equal the containing workstream directory (path match, loader). */
  workstream_id: string
  title: string
  goal: string
  /** schema default []. */
  deliverables: string[]
  /** schema default []; empty ⇒ validation can only be NOT_REQUIRED (INV-TASK-3). */
  acceptance_criteria: string[]
  created_by: ActorRefDoc
  /** epoch ms. */
  created_at: number
  note?: string
}

/** `items/gates/<gate-id>.yaml` (DOMAIN_SCHEMA §4.2). */
export interface GateDoc {
  /** Must equal the file name (path-id check, loader). */
  id: string
  /** Must equal the containing workstream directory (path match, loader). */
  workstream_id: string
  title: string
  criteria: string
  /** schema default []. */
  references: string[]
  created_by: ActorRefDoc
  /** epoch ms. */
  created_at: number
}

/** `items/milestones/<milestone-id>.yaml` (DOMAIN_SCHEMA §4.3). */
export interface MilestoneDoc {
  /** Must equal the file name (path-id check, loader). */
  id: string
  /** Must equal the containing workstream directory (path match, loader). */
  workstream_id: string
  title: string
  statement: string
  created_by: ActorRefDoc
  /** epoch ms. */
  created_at: number
}

/** One element of `.research/objectives.yaml` → `objectives` (DOMAIN_SCHEMA §9.1). */
export interface ObjectiveDoc {
  /** Unique within the Project (loader). */
  id: string
  scope: 'PROJECT' | 'TOPIC'
  /** Required when scope=TOPIC; must exist (loader, §16.1). */
  topic_id?: string
  statement: string
  success_criteria: string[]
  /** schema default ACTIVE. */
  status: ObjStatus
  /** epoch ms (UTC midnight of the date). */
  target_date?: number
  /** schema default P2. */
  priority: ObjPriority
  /** schema default []; kinds limited to GATE/MILESTONE/WORKSTREAM by schema; targets must exist (loader, §16.1). */
  linked_refs: { kind: ObjectiveLinkedKind; id: string }[]
  /** epoch ms. */
  created_at: number
}

/** Top-level wrapper of `.research/objectives.yaml`. */
export interface ObjectivesFileDoc {
  objectives: ObjectiveDoc[]
}

/** `ActorRef` (DOMAIN_SCHEMA §1.3) as stored in declarative files. */
export interface ActorRefDoc {
  kind: 'USER' | 'AGENT' | 'PLUGIN' | 'SYSTEM'
  user_id?: string
  /** R id; no existence check (Run is operational, not in `.research/`). */
  run_id?: string
  session_id?: string
  label?: string
}

/** One `audit.discovery_zones` entry (DOMAIN_SCHEMA §14.1). */
export interface WorkspaceAuditZone {
  path: string
  artifact_types?: ArtifactType[]
}

/** `.research/workspace.yaml` (DOMAIN_SCHEMA §14.1 工程默认结构). */
export interface WorkspaceDoc {
  workspace: {
    /** Relative to the Git repo root; schema default ".". */
    root: string
    /** schema default true (INV-GIT-1). */
    git_required: boolean
  }
  audit?: {
    strict_tracked?: {
      /** schema default []. */
      paths: string[]
    }
    /** schema default []. */
    discovery_zones?: WorkspaceAuditZone[]
    /** schema default []. */
    ignored?: string[]
  }
}

/** `.research/policies/agent-plan-fork.yaml` (PLAN_FORK_SPEC §9). */
export interface AgentPlanForkPolicyDoc {
  /** schema default true. */
  enabled: boolean
  anchors?: {
    /** schema default true. */
    allow_boundary_sentinels?: boolean
    /** schema default []. */
    required_item_types?: PolicyItemKind[]
  }
  flooding?: {
    /** schema default 5. */
    threshold: number
  }
  triggers?: {
    /** schema default true. */
    require_at_least_one?: boolean
    /** schema default [CLAIM, FACT, ARTIFACT, MILESTONE, OBJECTIVE]. */
    allowed_kinds?: PolicyTriggerKind[]
  }
}

/* ------------------------------------------------------------------ *
 * Loaded tree (structure skeleton + validated docs)
 * ------------------------------------------------------------------ */

/** A plan item (task/gate/milestone definition) slot. `doc: null` = file missing or rejected. */
export interface PlanItemNode<D> {
  /** From the file name. */
  id: string
  doc: D | null
}

/** `.research/topics/<t>/workstreams/<w>` node. */
export interface WorkstreamNode {
  /** From the directory name. */
  id: string
  /** The containing topic directory name. */
  topicId: string
  /** 'topics/<t>/workstreams/<w>' */
  path: string
  doc: WorkstreamDoc | null
  plan: PlanDoc | null
  tasks: PlanItemNode<TaskDoc>[]
  gates: PlanItemNode<GateDoc>[]
  milestones: PlanItemNode<MilestoneDoc>[]
}

/** `.research/topics/<t>` node. */
export interface TopicNode {
  /** From the directory name. */
  id: string
  /** 'topics/<t>' */
  path: string
  doc: TopicDoc | null
  topology: TopologyDoc | null
  workstreams: WorkstreamNode[]
}

/** `.research/merges/<TE-id>/contract.md` (DOMAIN_SCHEMA §3.2; free Markdown, no schema). */
export interface MergeContractNode {
  /** From the directory name; must match an existing topology edge (loader, §16.1). */
  edgeId: string
  /** 'merges/<te>/contract.md' */
  path: string
  /** Raw Markdown content (read-only load; the plugin never judges contract fulfilment, §3.2). */
  content: string
}

/** The loaded `.research/` declarative source (ARCHITECTURE §4, declarative half). */
export interface ResearchTree {
  /** From `.research/schema-version` (V1 = 1); `null` when missing/invalid. */
  schemaVersion: number | null
  project: ProjectDoc | null
  /** `[]` when objectives.yaml is absent or rejected. */
  objectives: ObjectiveDoc[]
  workspace: WorkspaceDoc | null
  policy: AgentPlanForkPolicyDoc | null
  topics: TopicNode[]
  mergeContracts: MergeContractNode[]
}
