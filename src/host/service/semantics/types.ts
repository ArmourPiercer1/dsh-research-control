/**
 * UI-7 (D1–D3) — the seven-write semantic records service: frozen types.
 *
 * The seven writes of the D §13 Records face, each persisted ONLY as a
 * semantic history event (the §30 red line: records live ONLY in the
 * operational sqlite — `history_event` + the derived `semantics:<projectId>`
 * row; zero `.research` semantic files, zero second storage):
 *
 *   recordFact          FACT_RECORDED            (D §13.2; status const ACTIVE)
 *   recordClaim         CLAIM_RECORDED           (D §13.2; ACTIVE)
 *   retractClaim        CLAIM_RETRACTED          (D §13.2; terminal, §13)
 *   registerArtifact    ARTIFACT_REGISTERED      (D §13.2/§13.6; BY REFERENCE)
 *   markArtifactMissing ARTIFACT_MARKED_MISSING  (D §13.2; V1 one-way, §7.3)
 *   addRelation         RELATION_ADDED           (D §13.2; §8 combination table)
 *   removeRelation      RELATION_REMOVED         (D §13.2; §5.5 audit mirror)
 *
 * ADJ-1: the seven writes do NOT write a `management_action` row — the
 * provenance IS the event log itself (the event envelope carries the USER
 * actor; the derived rows carry `created_by`). The plan-writer ledger face
 * is a separate concern and stays untouched.
 *
 * ADJ-12: the method surface below is directly callable by the three
 * research tool stubs (fact-record / claim-record / artifact-register) —
 * the `id` and `created_by_run` fields are NOT service parameters (the
 * stub parameter surface is frozen; ids come from the shared allocator,
 * and the USER management face has no run attribution).
 *
 * Service-level args/results mirror the wire DTO of
 * `src/shared/rpc-contracts.ts` minus the adapter-owned `projectId`
 * (same discipline as `../dependency/types.js` — the adapter drops the
 * wire `projectId` and uses the project the RPC face was bound to).
 *
 * Module placement: `src/host/service/semantics/` — the canonical
 * semantic write protocol (ADJ-2) lives here as `protocol.ts`; the UI-5
 * dependency service DELEGATES its reserve→append→commit body to it
 * (行为零变化, 纯结构归位 — the dependency suite stays green).
 */

import type {
  AppendEventsOptions,
  AppendResult,
  HistoryEventInput,
  HistoryEventRecord,
} from '../../persistence/store/types.js'
import type { HistoryEventRegistry } from '../../history/registry/types.js'
import type { IdKind, Reservation } from '../../../shared/ids/index.js'
import type { ObjectKind } from '../../../shared/ids/types.js'
import type { SemanticRecordDto } from '../../../shared/rpc-contracts.js'
import type { ArtifactType, RelationType } from '../../domain/semantics/types.js'

/* ------------------------------------------------------------------ *
 * The endpoint vocabulary
 * ------------------------------------------------------------------ */

/** One semantic endpoint reference (wire shape, camelCase). `kind` is the
 *  frozen 24-value `ObjectKind` registry (§1.3); `id` is any well-formed
 *  id of that kind (per-kind id unions would be surface noise without
 *  extra authority — the domain `isWellFormedRef` / the registry and the
 *  derived-state lookup own the shape + existence verdicts). */
export interface SemanticEndpointRef {
  readonly kind: ObjectKind
  readonly id: string
}

/* ------------------------------------------------------------------ *
 * Args / results (the service-level face; the adapter maps the wire
 * DTO onto it)
 * ------------------------------------------------------------------ */

/** recordFact — D §13.2 「fact 行创建, status 恒 ACTIVE」. */
export interface RecordFactArgs {
  readonly workstreamId: string
  readonly statement: string
  readonly references?: readonly string[]
}

export interface RecordFactResult {
  readonly factId: string
  readonly workstreamId: string
  readonly statement: string
  /** Fresh array (the wire shape — the adapter passes it through). */
  readonly references: string[]
  readonly status: 'ACTIVE'
  readonly recordedAt: number
  readonly eventId: string
}

/** recordClaim — D §13.2 「claim 行创建, status=ACTIVE」. */
export interface RecordClaimArgs {
  readonly workstreamId: string
  readonly statement: string
  readonly references?: readonly string[]
}

export interface RecordClaimResult {
  readonly claimId: string
  readonly workstreamId: string
  readonly statement: string
  /** Fresh array (the wire shape — the adapter passes it through). */
  readonly references: string[]
  readonly status: 'ACTIVE'
  readonly recordedAt: number
  readonly eventId: string
}

/** retractClaim — D §13.2 「claim.status=RETRACTED（终态）」. */
export interface RetractClaimArgs {
  readonly claimId: string
  readonly reason?: string
}

export interface RetractClaimResult {
  readonly claimId: string
  readonly status: 'RETRACTED'
  readonly eventId: string
}

/** registerArtifact — D §13.2/§13.6 「外部资源 registry, 不是文件存储」
 *  (the file is registered BY REFERENCE — never copied). */
export interface RegisterArtifactArgs {
  readonly workstreamId: string
  readonly type: ArtifactType
  readonly title: string
  readonly uri: string
  readonly contentHash?: string
  readonly relatedTaskId?: string
  readonly supersedes?: string
}

export interface RegisterArtifactResult {
  readonly artifactId: string
  readonly workstreamId: string
  readonly type: ArtifactType
  readonly title: string
  readonly uri: string
  readonly status: 'REGISTERED'
  readonly recordedAt: number
  readonly eventId: string
}

/** markArtifactMissing — D §13.2 「artifact.status=MISSING」(V1 one-way;
 *  「找回可恢复」 recovery is out of V1 scope). */
export interface MarkArtifactMissingArgs {
  readonly artifactId: string
  readonly reason?: string
}

export interface MarkArtifactMissingResult {
  readonly artifactId: string
  readonly status: 'MISSING'
  readonly eventId: string
}

/** addRelation — D §13.2/§8 「添加直接边」. The owner is DERIVED:
 *  `source.ws ?? target.ws` (the validator rejects the mismatch as
 *  OWNER_MISMATCH — catalog §4 特例); there is no workstreamId
 *  parameter on the wire. */
export interface AddRelationArgs {
  readonly source: SemanticEndpointRef
  readonly relationType: RelationType
  readonly target: SemanticEndpointRef
}

export interface AddRelationResult {
  readonly relationId: string
  readonly source: SemanticEndpointRef
  readonly relationType: RelationType
  readonly target: SemanticEndpointRef
  readonly status: 'ACTIVE'
  readonly eventId: string
}

/** removeRelation — D §13.2 「移除边」; the payload mirrors the stored
 *  edge (§5.5 audit redundancy — recovered from the owner log fold; the
 *  row is never re-invented). */
export interface RemoveRelationArgs {
  readonly relationId: string
  readonly reason?: string
}

export interface RemoveRelationResult {
  readonly relationId: string
  readonly status: 'REMOVED'
  readonly eventId: string
}

/** queryRecords — D §13.4 / ADJ-11 (wire shape minus the adapter-owned
 *  `projectId`): the derived-state read with its 7 filter dimensions.
 *  `limit` defaults to 50 (cap 200); `offset` defaults to 0. */
export interface QueryRecordsArgs {
  readonly workstreamId?: string
  readonly type?: 'FACT' | 'CLAIM' | 'ARTIFACT'
  /** The derived status column filter (any of the four). */
  readonly status?: string
  /** Case-insensitive substring over statement/title. */
  readonly keyword?: string
  readonly relatedObject?: SemanticEndpointRef
  readonly timeFrom?: number
  readonly timeTo?: number
  readonly limit?: number
  readonly offset?: number
}

export interface QueryRecordsResult {
  readonly records: SemanticRecordDto[]
  /** The filtered total (before pagination). */
  readonly total: number
}

/* ------------------------------------------------------------------ *
 * The plan index (the same workstream index the UI-5 dependency
 * service consumes — the validator's non-semantic endpoint resolver)
 * ------------------------------------------------------------------ */

/** One workstream row of the plan index (definition-file membership:
 *  the ids of the plan items owned by the workstream). Absence of a
 *  workstream from the index is NOT a service error: the validator's
 *  OBJECT_NOT_FOUND / OWNER_MISMATCH owns that verdict. */
export interface SemanticWorkstreamIndex {
  readonly id: string
  readonly topicId: string
  readonly taskIds: readonly string[]
  readonly gateIds: readonly string[]
  readonly milestoneIds: readonly string[]
}

/** The workstream index (one snapshot per service call — the adapter
 *  builds it from the loaded tree; tests build it by hand). */
export interface SemanticPlanIndex {
  readonly workstreams: readonly SemanticWorkstreamIndex[]
}

/* ------------------------------------------------------------------ *
 * The ports
 * ------------------------------------------------------------------ */

/** The store face the service drives (a structural subset of the
 *  production `ResearchStore`):
 *
 *   - `path` — the sqlite file, needed by the pre-validation read
 *     (`readDerivedState` opens a READ-ONLY connection on it);
 *   - `appendEvents` — the single write seam (the RR-011(b) fold hook is
 *     composed by the wiring in the same tx, AFTER the service's
 *     registry hook — the service MUST NOT compose the fold itself);
 *   - `listRange` — the owner-log read, used to recover the stored
 *     relation 5-tuple for the §5.5 remove mirror.
 */
export interface SemanticRecordsStorePort {
  readonly path: string
  appendEvents(
    events: readonly HistoryEventInput[],
    options?: AppendEventsOptions,
  ): AppendResult
  /** Owner-workstream events in `[fromSeq, +∞)`, audit order. */
  listRange(ownerWorkstreamId: string, fromSeq: number, toSeq?: number): readonly HistoryEventRecord[]
}

/** The allocator face (structural mirror of the shared `IdAllocator`;
 *  same shape as `DependencyIdAllocator`). */
export interface SemanticIdAllocator {
  reserve(kind: IdKind, projectId: string): Reservation
  commit(reservation: Reservation): void
  release(reservation: Reservation): void
}

/* ------------------------------------------------------------------ *
 * The service options
 * ------------------------------------------------------------------ */

export interface SemanticRecordsServiceOptions {
  readonly store: SemanticRecordsStorePort
  /** The frozen event registry (WP-2.2) — the write-time validator.
   *  NOTE (RR-011(b)): the semantic incremental fold is NOT an option —
   *  in the production wiring the store seam (`wiring/semantics`
   *  `validateHook`) applies it after the service's registry hook, in
   *  the same transaction, exactly once, for every service. The service
   *  composing its own fold would double-fold (second fold rejected
   *  OBJECT_ALREADY_EXISTS). */
  readonly registry: HistoryEventRegistry
  readonly allocator: SemanticIdAllocator
  readonly plans: SemanticPlanIndex
  /** The project the record ids attribute to. */
  readonly projectId: string
  /** Event `occurredAt` clock (default Date.now). */
  readonly now?: () => number
}
