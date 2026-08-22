/**
 * WP-2.2 — public surface of the typed event registry (host/history layer).
 *
 * Usage (service layer, later WP):
 * ```ts
 * const registry = loadHistoryEventRegistry(reader, '/wr/schema/history')
 * if (!registry.isUsable) throw new Error(registry.loadErrors.map((e) => e.message).join('; '))
 * const result = validateEvent(registry, candidate, snapshot)
 * if (!result.ok) return reject(result.errors) // structured; the validator wrote nothing
 * ```
 *
 * Boundary (WP-2.2): pure validation + registration metadata — no replay
 * (WP-2.3), no SQLite (append belongs to the store layer), no persistence
 * imports, no DSH imports (INV-PERM-5). All schema bytes flow through the
 * injected reader (loader pattern).
 */

// Schema-driven registry loading (schema/history JSON, schemaDir injection).
export { loadHistoryEventRegistry } from './registry.js'

// The validation gate (pure).
export { validateEvent } from './validate.js'

// Wrapper / atomic (aggregate) semantics — §3.1/§3.7/§5.2, INV-HIST-2/8.
export { BATCH_LAUNCH_RULES, batchMembers, batchOwnerWorkstreams, isBatchLaunch } from './aggregate.js'

// Dual-timeline (late registration) preparation — §1/§2, TC-HIST-002/004.
export { auditOrder, nextEventSeq, semanticOrder, type OrderedEvent } from './late-registration.js'

// §13 legal transition tables (INV-TASK-1).
export { LEGAL_TRANSITIONS, isLegalTransition, legalTargets, type TabledMachine } from './transitions.js'

// DOMAIN_SCHEMA §8 relation combination table (INV-REL-1/2/3).
export { RELATION_COMBINATION_TABLE, isLegalRelationCombination, type RelationCombinationRow } from './relations.js'

// §4/§5 static metadata (the hand side of the schema-driven registry).
export { EVENT_METADATA, type StaticEventMetadata } from './emitters.js'

// Type surface: envelope, payloads, EventOf<T>, guards, ctx, errors, registry.
export type {
  AcceptanceCriteriaChangedPayload,
  ActorRef,
  AggregateRules,
  ArtifactMarkedMissingPayload,
  ArtifactRegisteredPayload,
  ArtifactStatus,
  ArtifactType,
  ClaimRecordedPayload,
  ClaimRetractedPayload,
  ClaimSnapshot,
  ClaimStatus,
  EdgeOperation,
  EmitterKind,
  EventCategory,
  EventOf,
  EventRegistryEntry,
  EventRejectCode,
  EventTransition,
  EventValidationError,
  EventValidationResult,
  FactRecordedPayload,
  FactSnapshot,
  GateEvaluatedPayload,
  GateResult,
  GateSnapshot,
  HistoryEvent,
  HistoryEventEnvelope,
  HistoryEventMap,
  HistoryEventRegistry,
  HistoryEventType,
  HistoryObjectContext,
  HistoryRegistryErrorCode,
  HistoryRegistryLoadError,
  HistorySchemaReader,
  InterventionCreatedPayload,
  InterventionOrigin,
  InterventionSnapshot,
  MilestoneAchievedPayload,
  MilestoneSnapshot,
  MilestoneStatus,
  ObjectKind,
  OwnerRule,
  RelationAddedPayload,
  RelationRemovedPayload,
  RelationSnapshot,
  RelationStatus,
  RelationType,
  RunCancelledPayload,
  RunFailedPayload,
  RunFinishedPayload,
  RunSnapshot,
  RunStartEntry,
  RunStartedPayload,
  RunStatus,
  RunsStartedPayload,
  ShapeCheck,
  SourceRef,
  StateMachine,
  TaskExecution,
  TaskExecutionChangedPayload,
  TaskSnapshot,
  TaskValidation,
  TaskValidationChangedPayload,
  TopologyEdgeSnapshot,
  TopologyForkRealizedPayload,
  TopologyMergeRealizedPayload,
  TypedRef,
  WsLifecycle,
  WorkstreamSnapshot,
} from './types.js'

// Concrete per-event type guards.
export {
  isAcceptanceCriteriaChanged,
  isArtifactMarkedMissing,
  isArtifactRegistered,
  isClaimRecorded,
  isClaimRetracted,
  isEventOf,
  isFactRecorded,
  isGateEvaluated,
  isInterventionCreated,
  isMilestoneAchieved,
  isRelationAdded,
  isRelationRemoved,
  isRunCancelled,
  isRunFailed,
  isRunFinished,
  isRunStarted,
  isRunsStarted,
  isTaskExecutionChanged,
  isTaskValidationChanged,
  isTopologyForkRealized,
  isTopologyMergeRealized,
} from './types.js'
