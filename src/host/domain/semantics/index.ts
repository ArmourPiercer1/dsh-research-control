/**
 * WP-2.5 — public surface of the semantic registries (domain layer).
 *
 * Usage (service / replay layers, WP-2.3+):
 * ```ts
 * // schema-driven row validation (frozen operational schemas, injected reader)
 * const schemas = loadSemanticSchemas(reader, '/wr/schema/operational')
 *
 * // incremental maintenance: validate then fold
 * const pre = validateSemanticEvent(state, candidateEvent)
 * if (!pre.ok) return reject(pre.errors)
 * const state2 = reduceSemanticEvent(state, candidateEvent)
 * const ctx = toObjectContext(state2) // merge into HistoryObjectContext for validateEvent
 *
 * // replay (WP-2.3): rebuild from empty in audit order (catalog §6 / TC-HIST-006)
 * const rebuilt = foldSemanticEvents(orderByAudit(allEvents))
 * ```
 *
 * Boundary (WP-2.5): PURE domain layer — zero I/O (schemas flow through the
 * injected reader), zero DSH imports (INV-PERM-5), no scientific judgment
 * (INV-SCI-2: the conflict flag is mechanical — CONTRADICTED_BY edge
 * existence only, no content analysis). The reducer is the single fold
 * shared by replay and incremental maintenance. `domain/` never imports
 * `host/history/**` (ARCHITECTURE §2.2): the event surface is a structural
 * mirror, integration-proven in tests/semantics/fold-integration.test.ts.
 */

// The four registries + derived state + events + errors (type surface).
export type {
  ActorRefDoc,
  ArtifactRegisteredPayload,
  ArtifactRow,
  ArtifactStatus,
  ArtifactType,
  ClaimRecordedPayload,
  ClaimRetractedPayload,
  ClaimRow,
  ClaimStatus,
  ConflictFlag,
  FactRecordedPayload,
  FactRow,
  FactStatus,
  RelationAddedPayload,
  RelationRemovedPayload,
  RelationRow,
  RelationStatus,
  RelationType,
  RowShapeCheck,
  RowShapeError,
  SemanticEvent,
  SemanticEventMap,
  SemanticErrorCode,
  SemanticInputEvent,
  SemanticObjectContext,
  SemanticRowType,
  SemanticSchemaLoadError,
  SemanticSchemaReader,
  SemanticState,
  SemanticTypedRef,
  SemanticValidationResult,
  SemanticValidationError,
} from './types.js'
export { ARTIFACT_TYPES, FACT_STATUS, RELATION_TYPES, isArtifactType, isRelationType, SemanticDomainError } from './types.js'

// §13/§7/§8 state machines (claim / artifact / relation; fact = const ACTIVE).
export {
  SEMANTIC_TRANSITIONS,
  checkArtifactTransition,
  checkClaimTransition,
  checkRelationTransition,
  checkTransition,
  isLegalTransition,
  legalTargets,
  type SemanticMachine,
} from './state-machine.js'

// INV-REL-1/2/3 rule family (§8 组合表 + 唯一性 + 自环 + 反向 + reverse view).
export {
  FORBIDDEN_REVERSE_FORMS,
  RELATION_COMBINATION_TABLE,
  findDuplicateEdge,
  findReverseDuplicateEdge,
  isForbiddenReverseForm,
  isLegalRelationCombination,
  isSelfLoop,
  isWellFormedRef,
  isObjectKind,
  relationEdgeKey,
  reverseView,
  sameRef,
  type RelationCombinationRow,
} from './relations.js'

// Mechanical conflict flag (INV-SCI-2: record only, never judge).
export { CONFLICT_EDGE_TYPE, conflictEdgesOf, conflictFlagOf, deriveConflictFlags, isConflictPendingReview } from './conflict.js'

// The pure reducer + fold + §2 orderings + ctx projection.
export {
  SEMANTIC_EVENT_TYPES,
  foldSemanticEvents,
  initialSemanticState,
  isArtifactMarkedMissing,
  isArtifactRegistered,
  isClaimRecorded,
  isClaimRetracted,
  isFactRecorded,
  isRelationAdded,
  isRelationRemoved,
  isSemanticEvent,
  orderByAudit,
  orderBySemantic,
  reduceSemanticEvent,
  toObjectContext,
} from './reducer.js'

// Semantic pre-validation (incremental gate; structured, never throws).
export {
  INV_REL_CODE_MAP,
  errorFromDomainError,
  validateSemanticEvent,
  type SemanticValidateOptions,
} from './validate.js'

// Schema-driven row validation (frozen operational schemas, schemaDir injection).
export { loadSemanticSchemas, type SemanticSchemas } from './schemas.js'

// ID allocation seam (shared/ids: C/F/A/REL, per-project monotonic counters).
export {
  SEMANTIC_ID_KINDS,
  SEMANTIC_ID_PREFIXES,
  allocateSemanticId,
  isSemanticIdKind,
  type SemanticIdKind,
} from './ids.js'
