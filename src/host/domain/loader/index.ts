/**
 * WP-1.1 — public surface of the `.research/` declarative loader (domain layer).
 *
 * Usage (service/workspace layer, later WP):
 * ```ts
 * const { tree, errors } = loadResearchTree(reader, '/workspace/.research', '/wr/schema/declarative')
 * ```
 * The kernel is pure (no I/O, no DSH, no git — ARCHITECTURE §2.2): all file
 * access goes through the injected `ResearchFileReader`.
 */

export { loadResearchTree } from './load.js'
export {
  DECLARATIVE_SCHEMAS,
  describeValue,
  loadSchemas,
  schemaErrorSummary,
  type CompiledSchemas,
  type SchemaType,
} from './schemas.js'
export { pjoin, psegments } from './path.js'
export type {
  AgentPlanForkPolicyDoc,
  ArtifactType,
  DirEntry,
  EdgeOp,
  GateDoc,
  LoadResult,
  LoadErrorCode,
  MergeContractNode,
  MilestoneDoc,
  ObjectiveDoc,
  ObjectivesFileDoc,
  PlanDoc,
  PlanItemNode,
  ProjectDoc,
  ResearchFileReader,
  ResearchLoadError,
  ResearchTree,
  TaskDoc,
  TopicDoc,
  TopicNode,
  TopologyDoc,
  TopologyEdgeDoc,
  WorkspaceAuditZone,
  WorkspaceDoc,
  WorkstreamDoc,
  WorkstreamNode,
  AttentionMode,
  WsLifecycle,
  ObjStatus,
  ObjPriority,
  ObjectiveLinkedKind,
  PolicyItemKind,
  PolicyTriggerKind,
  ActorRefDoc,
} from './types.js'
