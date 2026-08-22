/**
 * WP-2.5 — Claim / Fact / Artifact / Relation registries: type surface.
 *
 * Frozen-contract basis:
 *  - DOMAIN_SCHEMA.md §7（语义标签：Claim C-<n> / Fact F-<n> / Artifact A-<n>，
 *    状态列派生）+ §8（Relation：RELY_ON 方向规范、relation_id 形态、组合表、
 *    唯一性、History owner 推导规则）+ §13（状态机合法转换表）+ §15（operational
 *    表映射：relation UNIQUE 5 元组）；
 *  - `schema/operational/semantic-labels.schema.json`（Claim/Fact/Artifact 行投影，
 *    oneOf + additionalProperties:false）+ `schema/operational/relation.schema.json`
 *    （Relation 行投影）+ `schema/common.schema.json`（id 模式 / typedRef /
 *    actorRef / epochMs / artifactType）；
 *  - HISTORY_EVENT_CATALOG.md §5.3（FACT_RECORDED / CLAIM_RECORDED /
 *    CLAIM_RETRACTED）/ §5.4（ARTIFACT_REGISTERED / ARTIFACT_MARKED_MISSING）/
 *    §5.5（RELATION_ADDED / RELATION_REMOVED）+ §2（双时序）+ §6（事件→派生状态）；
 *  - ARCHITECTURE.md §5.6（INV-SCI-1..4）/ §5.7（INV-REL-1..4）。
 *
 * ## Layering (ARCHITECTURE §2.2: `domain ← history`)
 *
 * `domain/` may NOT import `host/history/**` — the event registry (WP-2.2)
 * sits ABOVE this module. Therefore the seven semantic event payload types
 * below are LOCAL structural mirrors of the frozen
 * `schema/history/history-events.schema.json` payloads (same snake_case keys,
 * same fields). Structural typing makes the registry's `HistoryEvent` union
 * assignable to `SemanticInputEvent` without any import: the integration is
 * compile-enforced in `tests/semantics/fold-integration.test.ts` (which
 * imports the registry types and folds them through this reducer).
 *
 * Shared structures come from the layers below domain:
 *  - `ObjectKind` (the 24 referable kinds, field-for-field with
 *    common.schema.json `objectKind`) from `shared/ids` (WP-1.6);
 *  - `ActorRefDoc` / `ArtifactType` from `domain/loader` (WP-1.1) — the
 *    established intra-domain import pattern (cf. `topology` → `loader`).
 *
 * ## INV-SCI-2 boundary
 *
 * No field, function, or derived value in this module interprets statement
 * content. The only conflict machinery is the mechanical `conflict` flag
 * (see `conflict.ts`), driven solely by the EXISTENCE of ACTIVE
 * `CONTRADICTED_BY` edges (§8: 「证据冲突（只记录，不推理）」).
 *
 * Pure types (zero I/O, zero DSH — INV-PERM-5).
 */

import type { ObjectKind } from '../../../shared/ids/index.js'
import type { ActorRefDoc, ArtifactType } from '../loader/index.js'

/** Re-exported for consumers: the frozen common structures the rows use. */
export type { ActorRefDoc, ArtifactType }

/* ------------------------------------------------------------------ *
 * Status unions (mirrors of the frozen operational schemas + §13 table)
 * ------------------------------------------------------------------ */

/** Claim status (§7.1 状态列, derived; §13: ACTIVE → RETRACTED terminal). */
export type ClaimStatus = 'ACTIVE' | 'RETRACTED'
/** Artifact status (§7.3 状态列; §13: REGISTERED ↔ MISSING). */
export type ArtifactStatus = 'REGISTERED' | 'MISSING'
/** Relation status (§8 状态列, derived; REMOVED via RELATION_REMOVED). */
export type RelationStatus = 'ACTIVE' | 'REMOVED'
/** Fact status is CONST (§7.2: 「Fact: 恒 ACTIVE」) — no state machine. */
export const FACT_STATUS = 'ACTIVE' as const
export type FactStatus = typeof FACT_STATUS

/** Frozen artifactType enum (common.schema.json `artifactType`; §7.3 Artifact.type). */
export const ARTIFACT_TYPES: readonly ArtifactType[] = ['DATASET', 'FIGURE', 'MODEL', 'CODE', 'REPORT', 'NOTE', 'OTHER']

/** True iff `value` is one of the frozen 7 artifact types. */
export function isArtifactType(value: unknown): value is ArtifactType {
  return typeof value === 'string' && (ARTIFACT_TYPES as readonly string[]).includes(value)
}

/** The 10 V1 relation types (DOMAIN_SCHEMA §8 组合表, INV-REL-3). */
export type RelationType =
  | 'DEPENDS_ON'
  | 'SUPPORTED_BY'
  | 'CONTRADICTED_BY'
  | 'DERIVED_FROM'
  | 'PRODUCED_BY'
  | 'VALIDATED_BY'
  | 'CONSUMES'
  | 'CONTRIBUTES_TO'
  | 'IMPLEMENTS'
  | 'RELATED_TO'

/** The frozen 10-type set (INV-REL-3). Structural mirror of the registry's union. */
export const RELATION_TYPES: readonly RelationType[] = [
  'DEPENDS_ON',
  'SUPPORTED_BY',
  'CONTRADICTED_BY',
  'DERIVED_FROM',
  'PRODUCED_BY',
  'VALIDATED_BY',
  'CONSUMES',
  'CONTRIBUTES_TO',
  'IMPLEMENTS',
  'RELATED_TO',
]

/** True iff `value` is one of the 10 frozen relation types (INV-REL-3). */
export function isRelationType(value: unknown): value is RelationType {
  return typeof value === 'string' && (RELATION_TYPES as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ *
 * The four registry rows (snake_case = frozen operational schema keys;
 * validated as-is by schemas.ts against the real frozen JSON)
 * ------------------------------------------------------------------ */

/**
 * One `claim` row (§7.1 + `semantic-labels.schema.json#/$defs/Claim`).
 * `workstream_id` = the event owner WS at recording time (INV-SCI-1:
 * workstream-local first-class label).
 */
export interface ClaimRow {
  readonly id: string
  readonly workstream_id: string
  readonly statement: string
  readonly created_by_run?: string
  readonly created_by: ActorRefDoc
  readonly references?: readonly string[]
  readonly recorded_at: number
  /** Derived (HISTORY_EVENT_CATALOG §6: CLAIM_RECORDED→ACTIVE, CLAIM_RETRACTED→RETRACTED). */
  readonly status: ClaimStatus
}

/** One `fact` row (§7.2; status const ACTIVE — facts are never retracted in V1). */
export interface FactRow {
  readonly id: string
  readonly workstream_id: string
  readonly statement: string
  readonly created_by_run?: string
  readonly created_by: ActorRefDoc
  readonly references?: readonly string[]
  readonly recorded_at: number
  readonly status: FactStatus
}

/** One `artifact` row (§7.3 「外部资源 registry，不是文件存储」). */
export interface ArtifactRow {
  readonly id: string
  readonly workstream_id: string
  readonly type: ArtifactType
  readonly title: string
  readonly uri: string
  readonly content_hash?: string
  readonly created_by_run?: string
  readonly related_task?: string
  /** A id; the superseded artifact (row stays — no hard delete, INV-HIST-7). */
  readonly supersedes?: string
  readonly recorded_at: number
  /** Derived: REGISTERED at creation; MISSING via ARTIFACT_MARKED_MISSING (§7.3 「找回可恢复」). */
  readonly status: ArtifactStatus
}

/** One `{kind, id}` reference (common.schema.json `typedRef`). */
export interface SemanticTypedRef {
  readonly kind: ObjectKind
  readonly id: string
}

/**
 * One `relation` row (§8 + `relation.schema.json#/$defs/Relation`).
 * RELY_ON direction (INV-REL-1): TARGET is always SOURCE's premise/source/
 * input/evidence/superordinate goal. No `workstream_id` column — the owner
 * is DERIVED from the endpoints (`source.ws ?? target.ws`, §8).
 */
export interface RelationRow {
  readonly id: string
  readonly source: SemanticTypedRef
  readonly relation_type: RelationType
  readonly target: SemanticTypedRef
  readonly created_by: ActorRefDoc
  readonly created_at: number
  /** Derived: ACTIVE at RELATION_ADDED; REMOVED via RELATION_REMOVED. */
  readonly status: RelationStatus
  /** Written by RELATION_REMOVED (§8: 「RELATION_REMOVED 时写入」). */
  readonly removed_at?: number
}

/* ------------------------------------------------------------------ *
 * Mechanical conflict flag (INV-SCI-2: record only, never judge)
 * ------------------------------------------------------------------ */

/**
 * The ONLY conflict machinery in this module. DOMAIN_SCHEMA §7 defines no
 * conflict-marking rule, so per the WP-2.5 boundary the marker is the
 * minimal 「待人工」 flag: a claim is flagged iff an ACTIVE
 * `CONTRADICTED_BY` edge names it as SOURCE (the edge is the recorded
 * contradiction; §8 「只记录，不推理」). No statement content is ever read.
 */
export interface ConflictFlag {
  /** The single marker value — 「待人工」(pending human review). */
  readonly kind: 'PENDING_REVIEW'
  /** The triggering ACTIVE relation ids (sorted — deterministic). */
  readonly relationIds: readonly string[]
}

/* ------------------------------------------------------------------ *
 * The derived semantic state (reducer output; replay + incremental)
 * ------------------------------------------------------------------ */

/**
 * The four semantic registries + the derived conflict flags.
 *
 * This is the derived state of HISTORY_EVENT_CATALOG §6 for the §5.3–5.5
 * event families: rebuildable from an EMPTY state by folding the full event
 * stream in audit order (TC-HIST-006), idempotent (TC-HIST-005). Maps hold
 * ALL rows forever — no hard delete (INV-HIST-7); removed/retracted rows
 * keep their terminal status.
 */
export interface SemanticState {
  /** claim id → row (ACTIVE or RETRACTED). */
  readonly claims: ReadonlyMap<string, ClaimRow>
  /** fact id → row (always ACTIVE). */
  readonly facts: ReadonlyMap<string, FactRow>
  /** artifact id → row (REGISTERED or MISSING). */
  readonly artifacts: ReadonlyMap<string, ArtifactRow>
  /** relation id → row (ACTIVE or REMOVED). §15: relation UNIQUE 5-tuple. */
  readonly relations: ReadonlyMap<string, RelationRow>
  /** claim id → mechanical conflict flag (only claims with ≥1 ACTIVE CONTRADICTED_BY source edge). */
  readonly conflict: ReadonlyMap<string, ConflictFlag>
}

/* ------------------------------------------------------------------ *
 * The seven semantic events (structural mirrors of the frozen §5.3–5.5
 * payloads; snake_case keys exactly as `history-events.schema.json`)
 * ------------------------------------------------------------------ */

/** §5.3 FACT_RECORDED — 「fact 行创建，status 恒 ACTIVE」. */
export interface FactRecordedPayload {
  /** F id; must be NEW (§5.3 「新建」). */
  readonly fact_id: string
  /** Non-empty (schema minLength 1). */
  readonly statement: string
  /** Required when AGENT-emitted (§5.3). */
  readonly created_by_run?: string
  readonly references?: readonly string[]
}

/** §5.3 CLAIM_RECORDED — 「claim 行创建，status=ACTIVE」. */
export interface ClaimRecordedPayload {
  readonly claim_id: string
  readonly statement: string
  readonly created_by_run?: string
  readonly references?: readonly string[]
}

/** §5.3 CLAIM_RETRACTED — 「claim.status=RETRACTED（终态）」; claim must be ACTIVE. */
export interface ClaimRetractedPayload {
  readonly claim_id: string
  readonly reason?: string
}

/** §5.4 ARTIFACT_REGISTERED — 「artifact 行创建，status=REGISTERED」. */
export interface ArtifactRegisteredPayload {
  readonly artifact_id: string
  readonly type: ArtifactType
  readonly title: string
  readonly uri: string
  readonly content_hash?: string
  readonly created_by_run?: string
  /** T id; optional; must belong to the owner WS. */
  readonly related_task?: string
  /** A id; optional; must exist (§5.4 「supersedes 存在」). */
  readonly supersedes?: string
}

/** §5.4 ARTIFACT_MARKED_MISSING — 「artifact.status=MISSING」; artifact must be REGISTERED. */
export interface ArtifactMarkedMissingPayload {
  readonly artifact_id: string
  readonly reason?: string
  /** P-emitted: the audit source. */
  readonly detected_by?: ActorRefDoc
}

/** §5.5 RELATION_ADDED — 「添加直接边」; relation must be NEW; §8 combination table + 唯一性. */
export interface RelationAddedPayload {
  readonly relation_id: string
  readonly source: SemanticTypedRef
  readonly relation_type: RelationType
  readonly target: SemanticTypedRef
}

/** §5.5 RELATION_REMOVED — 「移除边」; relation must be ACTIVE; endpoints redundantly recorded. */
export interface RelationRemovedPayload {
  readonly relation_id: string
  readonly source: SemanticTypedRef
  readonly relation_type: RelationType
  readonly target: SemanticTypedRef
  readonly reason?: string
}

/** eventType → payload type (the seven rows of CATALOG §4, categories 语义标签/Artifact/Relation). */
export interface SemanticEventMap {
  FACT_RECORDED: FactRecordedPayload
  CLAIM_RECORDED: ClaimRecordedPayload
  CLAIM_RETRACTED: ClaimRetractedPayload
  ARTIFACT_REGISTERED: ArtifactRegisteredPayload
  ARTIFACT_MARKED_MISSING: ArtifactMarkedMissingPayload
  RELATION_ADDED: RelationAddedPayload
  RELATION_REMOVED: RelationRemovedPayload
}

/** The seven semantic event type names. */
export type SemanticEventTypeName = keyof SemanticEventMap

/**
 * The seven-event discriminated union (discriminant `eventType`).
 * Built as a homomorphic mapped type (NOT an intersection) so
 * `switch (event.eventType)` narrows `event.payload` — the same pattern
 * the WP-2.2 registry uses for its 20-event union.
 */
export type SemanticEvent = {
  [T in SemanticEventTypeName]: {
    readonly eventId: string
    readonly ownerWorkstreamId: string
    readonly eventSeq: number
    readonly eventType: T
    readonly schemaVersion: number
    readonly occurredAt: number
    readonly recordedAt: number
    readonly actor: ActorRefDoc
    readonly source?: unknown
    readonly payload: SemanticEventMap[T]
  }
}[SemanticEventTypeName]

/**
 * The MINIMAL structural envelope the reducer / validator rely on.
 *
 * Accepts ANY event with an `eventType` string — including the registry's
 * full 20-event `HistoryEvent` union (the 13 non-semantic events are
 * no-ops in the reducer, catalog §6: they touch other derived caches).
 * This is how `domain ← history` integration works without an import:
 * `HistoryEvent` is structurally assignable to this interface.
 */
export interface SemanticInputEvent {
  readonly eventType: string
  readonly ownerWorkstreamId?: string
  readonly eventSeq?: number
  readonly eventId?: string
  readonly occurredAt: number
  readonly recordedAt?: number
  readonly schemaVersion?: number
  readonly actor?: ActorRefDoc
  readonly payload?: unknown
  readonly [key: string]: unknown
}

/* ------------------------------------------------------------------ *
 * Structured errors (TC-DOM-027 style: code + JSON-pointer path + message)
 * ------------------------------------------------------------------ */

/**
 * The semantic reject codes — shared by `validateSemanticEvent` (structured
 * result) and `SemanticDomainError` (reducer fail-loud). Codes with a
 * `RELATION_` prefix are the INV-REL-1/2/3 rule family.
 */
export type SemanticErrorCode =
  /** `eventType` is not one of the seven semantic events (validator only; the reducer no-ops them). */
  | 'UNKNOWN_EVENT_TYPE'
  /** Envelope violation at the semantic boundary: bad owner WS id / occurredAt / actor kind. */
  | 'INVALID_ENVELOPE'
  /** An id is malformed for its expected §1.1 kind (C-/F-/A-/REL-<n>, WS-<n>). */
  | 'INVALID_ID'
  /** A required payload field is missing/mistyped for row construction. */
  | 'INVALID_PAYLOAD'
  /** A 「新建」 id already exists in the registry (catalog §5.3/§5.4/§5.5 「新建」). */
  | 'OBJECT_ALREADY_EXISTS'
  /** A referenced object does not exist (§5 「payload 内引用的对象存在」). */
  | 'OBJECT_NOT_FOUND'
  /** The object exists but is not in the event's implicit `from` state (state machine / §13). */
  | 'WRONG_STATE'
  /** The subject object's workstream ≠ the event owner (catalog §4 owner 列). */
  | 'OWNER_MISMATCH'
  /** Neither relation endpoint is workstream-local ⇒ V1 refuses creation (DOMAIN_SCHEMA §8). */
  | 'OWNER_UNRESOLVABLE'
  /** `relation_type` is not in the frozen 10-type set (INV-REL-3). */
  | 'RELATION_TYPE_UNKNOWN'
  /** `(relation_type, source.kind → target.kind)` not in the §8 组合表 (INV-REL-1 direction). */
  | 'RELATION_COMBINATION'
  /** `source` and `target` are the same object — a RELY_ON premise cannot be itself (INV-REL-1). */
  | 'RELATION_SELF_LOOP'
  /** An existing relation row carries the same (source, type, target) 5-tuple (§8 唯一性 / §15 UNIQUE). */
  | 'RELATION_DUPLICATE'
  /** An existing row carries the SAME edge in reverse (RELATED_TO only; §8 「禁止同边反向重复」). */
  | 'RELATION_REVERSE_DUPLICATE'
  /** RELATION_REMOVED redundant endpoints ≠ the stored edge (catalog §5.5 audit redundancy). */
  | 'RELATION_ENDPOINT_MISMATCH'

/** One precisely-located semantic validation error. */
export interface SemanticValidationError {
  readonly code: SemanticErrorCode
  /** JSON-pointer path (`/payload/claim_id`, `/ownerWorkstreamId`); undefined = event-level. */
  readonly path?: string
  readonly message: string
}

/** Structured outcome of `validateSemanticEvent` (pure: nothing is written). */
export type SemanticValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly SemanticValidationError[] }

/**
 * The fail-loud error the REDUCER throws on a precondition violation.
 * A valid stream (shape-checked + state-validated at write time) never
 * triggers it; a corrupt stream must fail the fold loudly rather than
 * produce wrong derived rows (TC-HIST-006).
 */
export class SemanticDomainError extends Error {
  readonly code: SemanticErrorCode
  readonly path?: string
  constructor(code: SemanticErrorCode, message: string, path?: string) {
    super(message)
    this.name = 'SemanticDomainError'
    this.code = code
    this.path = path
  }
}

/* ------------------------------------------------------------------ *
 * Schema-driven row validation (schemaDir injection; frozen operational
 * schemas — see schemas.ts for the loader)
 * ------------------------------------------------------------------ */

/** One semantic row type (the $defs validated by the frozen operational schemas). */
export type SemanticRowType = 'claim' | 'fact' | 'artifact' | 'relation'

/**
 * Read-only schema access (cf. WP-1.1 `ResearchFileReader` / WP-2.2
 * `HistorySchemaReader`). `readFile` returns `null` for a missing path and
 * throws on I/O failure; the kernel never does I/O itself.
 */
export interface SemanticSchemaReader {
  readonly readFile: (path: string) => string | null
}

export type SemanticSchemaErrorCode =
  /** A schema file is missing, unreadable, or not valid JSON. */
  | 'SCHEMA_LOAD'
  /** A per-row-type validator failed to compile. */
  | 'SCHEMA_COMPILE'

export interface SemanticSchemaLoadError {
  readonly code: SemanticSchemaErrorCode
  readonly file?: string
  readonly message: string
}

/** One AJV violation mapped to a precise path + summary (loader helpers). */
export interface RowShapeError {
  /** JSON-pointer path within the row (`/workstream_id`, `/status`); '' = row-level. */
  readonly path: string
  readonly message: string
}

/** Outcome of validating one row against its frozen operational schema. */
export type RowShapeCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly RowShapeError[] }

/* ------------------------------------------------------------------ *
 * Projection for the WP-2.2 validation context (HistoryObjectContext)
 * ------------------------------------------------------------------ */

/**
 * The camelCase snapshot maps of the four registries — structural mirrors
 * of the registry's `ClaimSnapshot` / `FactSnapshot` / `ArtifactSnapshot` /
 * `RelationSnapshot`. The service layer merges this projection into a full
 * `HistoryObjectContext` so `validateEvent` (WP-2.2) can consume the
 * reducer-derived state (tests prove the assignability).
 */
export interface SemanticObjectContext {
  readonly claims: ReadonlyMap<string, { readonly workstreamId: string; readonly status: ClaimStatus }>
  readonly facts: ReadonlyMap<string, { readonly workstreamId: string }>
  readonly artifacts: ReadonlyMap<string, { readonly workstreamId: string; readonly status: ArtifactStatus }>
  readonly relations: ReadonlyMap<
    string,
    {
      readonly status: RelationStatus
      readonly source: SemanticTypedRef
      readonly relationType: RelationType
      readonly target: SemanticTypedRef
    }
  >
}
