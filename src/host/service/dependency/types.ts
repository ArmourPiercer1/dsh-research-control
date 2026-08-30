/**
 * UI-5 (D2) — the dependency service's frozen types (BRIEF §3 / §4 D2).
 *
 * The two wire-level mutations of the UI-5 management face:
 *
 *   - `addDependency({ workstreamId, source, target })` — persist a
 *     DEPENDS_ON edge as a RELATION_ADDED history event (the §30 red line:
 *     relations live ONLY in the semantic relation space — no second
 *     storage, no new table). The relation id is reserved from the shared
 *     `IdAllocator` (`RELATION` kind); the event lands in the OWNER
 *     workstream's log, where owner = `source.ws ?? target.ws` (the
 *     validator enforces the owner rule against the `workstreamId`
 *     argument — catalog §4 特例).
 *   - `removeDependency({ workstreamId, relationId })` — RELATION_REMOVED;
 *     the relation must be ACTIVE (WRONG_STATE otherwise) and the payload
 *     redundantly records the stored endpoints (§5.5 audit redundancy —
 *     recovered from the owner log fold; the row is never re-invented).
 *
 * Module placement: `src/host/service/dependency/` (BRIEF §4 D2 leaves the
 * placement to the implementer — a sibling host service, mirroring the
 * plan-writer layout; the semantics DOMAIN is untouched — the service
 * only COMPOSES its incremental validate hook, RR-011(b)).
 */

import type {
  AppendEventsOptions,
  AppendResult,
  HistoryEventInput,
  HistoryEventRecord,
  TxScope,
} from '../../persistence/store/types.js'
import type { HistoryEventRegistry } from '../../history/registry/types.js'
import type { IdKind, Reservation } from '../../../shared/ids/index.js'

/* ------------------------------------------------------------------ *
 * The endpoint vocabulary
 * ------------------------------------------------------------------ */

/** The wire endpoint kinds (BRIEF §3: kind ∈ TASK/GATE/MILESTONE). The
 *  §8 combination table then decides legality per direction (e.g. a
 *  MILESTONE source is refused by the frozen table as CROSS_FIELD). */
export const DEPENDENCY_ENDPOINT_KINDS = ['TASK', 'GATE', 'MILESTONE'] as const
export type DependencyEndpointKind = (typeof DEPENDENCY_ENDPOINT_KINDS)[number]

/** One plan-item endpoint reference (wire shape, camelCase). */
export interface DependencyEndpointRef {
  readonly kind: DependencyEndpointKind
  readonly id: string
}

/* ------------------------------------------------------------------ *
 * Args / results (the service-level face; D3 maps the wire DTO onto it)
 * ------------------------------------------------------------------ */

export interface AddDependencyArgs {
  /** The owner workstream (must equal `source.ws ?? target.ws` — the
   *  validator rejects the mismatch as OWNER_MISMATCH). */
  readonly workstreamId: string
  readonly source: DependencyEndpointRef
  readonly target: DependencyEndpointRef
}

export interface AddDependencyResult {
  readonly relationId: string
  readonly source: DependencyEndpointRef
  readonly target: DependencyEndpointRef
}

export interface RemoveDependencyArgs {
  /** The owner workstream (the log the relation was recorded in). */
  readonly workstreamId: string
  readonly relationId: string
}

export interface RemoveDependencyResult {
  readonly relationId: string
}

/* ------------------------------------------------------------------ *
 * The ports (structural — the service stays wiring-free and memory-
 * fs / in-memory-store drivable; D3 feeds the production wiring)
 * ------------------------------------------------------------------ */

/**
 * One workstream's index entry (D3 builds it from the loaded tree node:
 * the `tasks` / `gates` / `milestones` item lists are the WS's canonical
 * DEFINITION files — the superset of the plan listing, so an item that
 * left `ordered_items` (INV-PLAN-9 keeps its definition) is still
 * addressable: its edge owner stays derivable, and removing such an edge
 * works).
 */
export interface DependencyWorkstreamIndex {
  readonly id: string
  readonly topicId: string
  readonly taskIds: readonly string[]
  readonly gateIds: readonly string[]
  readonly milestoneIds: readonly string[]
}

/**
 * The workstream index (one snapshot per service call — D3 builds it
 * from the loaded tree; tests build it by hand). Absence of a
 * workstream from the index is NOT a service error: the validator's
 * OBJECT_NOT_FOUND / OWNER_MISMATCH owns that verdict.
 */
export interface DependencyPlanIndex {
  readonly workstreams: readonly DependencyWorkstreamIndex[]
}

/** The store face the service drives (a structural subset of the
 *  production `ResearchStore` — append + owner-log read only). */
export interface DependencyStorePort {
  appendEvents(
    events: readonly HistoryEventInput[],
    options?: AppendEventsOptions,
  ): AppendResult
  /** Owner-workstream events in `[fromSeq, +∞)`, audit order. */
  listRange(ownerWorkstreamId: string, fromSeq: number, toSeq?: number): readonly HistoryEventRecord[]
}

/** The allocator face (structural mirror of the shared `IdAllocator`;
 *  same shape as plan-writer's `PlanWriterIdAllocator`). */
export interface DependencyIdAllocator {
  reserve(kind: IdKind, projectId: string): Reservation
  commit(reservation: Reservation): void
  release(reservation: Reservation): void
}

/** The incremental semantic-fold hook (RR-011(b)) — in the production
 *  wiring this is `SemanticMaintainer.validateHook`; composed (registry
 *  hook FIRST, fold hook second) inside the store write transaction. */
export type SemanticValidateHook = (events: readonly HistoryEventRecord[], tx: TxScope) => void

export interface DependencyServiceOptions {
  readonly store: DependencyStorePort
  /** The frozen event registry (WP-2.2) — the write-time validator. */
  readonly registry: HistoryEventRegistry
  /** The semantics incremental fold (wired into `semantics:<projectId>`). */
  readonly semanticValidateHook: SemanticValidateHook
  readonly allocator: DependencyIdAllocator
  readonly plans: DependencyPlanIndex
  /** The project the relation ids attribute to. */
  readonly projectId: string
  /** Event `occurredAt` clock (default Date.now). */
  readonly now?: () => number
}
