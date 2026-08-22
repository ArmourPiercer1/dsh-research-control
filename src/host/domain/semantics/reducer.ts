/**
 * WP-2.5 — the pure semantic reducer: event stream → derived registry state.
 *
 * ## Contract (HISTORY_EVENT_CATALOG §6 「事件 → 派生状态」)
 *
 *  - `reduceSemanticEvent(state, event)` is a PURE function: no I/O, no
 *    clock, no mutation of `state` (structural sharing; the input maps are
 *    only read). It returns a NEW `SemanticState`, or the SAME reference for
 *    the 13 non-semantic events (catalog §6: those events update OTHER
 *    derived caches — run/task/gate/… — not the four semantic registries).
 *  - One reducer, two consumers: the WP-2.3 replay engine (fold the full
 *    stream from an empty state — TC-HIST-006 rebuild) and incremental
 *    maintenance (fold one appended event onto the current derived state).
 *    Both get the same code path by construction.
 *  - A VALID stream (shape-checked + state-validated at write time,
 *    WP-2.2 `validateEvent`) never makes the reducer throw. A CORRUPT
 *    stream must fail the fold LOUDLY (`SemanticDomainError`) rather than
 *    produce wrong derived rows — the derived columns are only as good as
 *    the fold, and TC-HIST-006 asserts exactness.
 *
 * ## Determinism (catalog §2)
 *
 *  - Folding the same ordered stream twice yields byte-identical states
 *    (TC-HIST-005 幂等 replay — the maps are rebuilt from the same inputs,
 *    the conflict flags are a pure derivation, relationIds are sorted);
 *  - `orderByAudit` / `orderBySemantic` implement the §2 replay orderings
 *    (`ORDER BY event_seq` / `ORDER BY occurred_at, event_seq` with the
 *    deterministic event_seq tie-break, TC-HIST-004) — domain-owned copies
 *    of the WP-2.2 sorters (domain may not import history), cross-checked
 *    for identity in `tests/semantics/reducer-determinism.test.ts`.
 *
 * ## Owner checks (state-local)
 *
 * The reducer re-checks what it CAN check from the semantic state alone
 * (subject object's workstream on retract/mark-missing; the §8
 * `source.ws ?? target.ws` rule when both endpoints are semantic or
 * WORKSTREAM-kind). Endpoints outside the semantic state (TASK/GATE/…)
 * cannot be resolved here — the write-time validator (full
 * `HistoryObjectContext`) owns the complete check; the reducer skips what
 * it cannot see rather than guess.
 *
 * Zero I/O, zero DSH (INV-PERM-5).
 */

import { parseId } from '../../../shared/ids/index.js'
import { ARTIFACT_TYPES, isArtifactType } from './types.js'
import { deriveConflictFlags } from './conflict.js'
import {
  findDuplicateEdge,
  findReverseDuplicateEdge,
  isForbiddenReverseForm,
  isLegalRelationCombination,
  isRelationType,
  isSelfLoop,
  isWellFormedRef,
  sameRef,
} from './relations.js'
import { checkArtifactTransition, checkClaimTransition, checkRelationTransition } from './state-machine.js'
import {
  FACT_STATUS,
  SemanticDomainError,
  type ActorRefDoc,
  type ArtifactRow,
  type ArtifactStatus,
  type ClaimRow,
  type ClaimStatus,
  type FactRow,
  type RelationRow,
  type RelationStatus,
  type SemanticEvent,
  type SemanticInputEvent,
  type SemanticObjectContext,
  type SemanticState,
  type SemanticTypedRef,
} from './types.js'

/* ------------------------------------------------------------------ *
 * The seven-event type surface (guards + membership)
 * ------------------------------------------------------------------ */

/** eventType → the concrete union member (narrowing target for the guards). */
type Member<T extends SemanticInputEvent['eventType']> = Extract<SemanticEvent, { eventType: T }>

/** The seven semantic event names (catalog §4 类别 语义标签/Artifact/Relation). */
export const SEMANTIC_EVENT_TYPES: readonly string[] = [
  'FACT_RECORDED',
  'CLAIM_RECORDED',
  'CLAIM_RETRACTED',
  'ARTIFACT_REGISTERED',
  'ARTIFACT_MARKED_MISSING',
  'RELATION_ADDED',
  'RELATION_REMOVED',
]
const SEMANTIC_EVENT_SET: ReadonlySet<string> = new Set(SEMANTIC_EVENT_TYPES)

/** True iff `event.eventType` is one of the seven semantic events (no narrowing). */
export function isSemanticEvent(event: SemanticInputEvent): boolean {
  return SEMANTIC_EVENT_SET.has(event.eventType)
}

/** Type guards (one per semantic event): `if (isFactRecorded(e)) e.payload.fact_id`. */
export const isFactRecorded = (e: SemanticInputEvent): e is Member<'FACT_RECORDED'> => e.eventType === 'FACT_RECORDED'
export const isClaimRecorded = (e: SemanticInputEvent): e is Member<'CLAIM_RECORDED'> => e.eventType === 'CLAIM_RECORDED'
export const isClaimRetracted = (e: SemanticInputEvent): e is Member<'CLAIM_RETRACTED'> => e.eventType === 'CLAIM_RETRACTED'
export const isArtifactRegistered = (e: SemanticInputEvent): e is Member<'ARTIFACT_REGISTERED'> => e.eventType === 'ARTIFACT_REGISTERED'
export const isArtifactMarkedMissing = (e: SemanticInputEvent): e is Member<'ARTIFACT_MARKED_MISSING'> => e.eventType === 'ARTIFACT_MARKED_MISSING'
export const isRelationAdded = (e: SemanticInputEvent): e is Member<'RELATION_ADDED'> => e.eventType === 'RELATION_ADDED'
export const isRelationRemoved = (e: SemanticInputEvent): e is Member<'RELATION_REMOVED'> => e.eventType === 'RELATION_REMOVED'

/* ------------------------------------------------------------------ *
 * Initial state
 * ------------------------------------------------------------------ */

/** The EMPTY semantic state — the replay start (catalog §6 重放: 从空 DB). */
export function initialSemanticState(): SemanticState {
  return {
    claims: new Map(),
    facts: new Map(),
    artifacts: new Map(),
    relations: new Map(),
    conflict: new Map(),
  }
}

/* ------------------------------------------------------------------ *
 * The reducer
 * ------------------------------------------------------------------ */

/**
 * Reduce ONE event into a new semantic state (pure; throws
 * `SemanticDomainError` on a precondition violation — see module doc).
 * Non-semantic events return the input reference unchanged (no-op, §6).
 */
export function reduceSemanticEvent(state: SemanticState, event: SemanticInputEvent): SemanticState {
  if (typeof event !== 'object' || event === null || typeof event.eventType !== 'string') {
    throw new TypeError('reduceSemanticEvent: event must be an object with a string eventType')
  }
  if (!isSemanticEvent(event)) return state

  const owner = envelopeOwner(event)

  switch (event.eventType) {
    case 'FACT_RECORDED': {
      const p = event.payload
      if (!isRecord(p) || typeof p.fact_id !== 'string' || typeof p.statement !== 'string' || p.statement.length === 0) {
        throwInvalidPayload('FACT_RECORDED', 'payload requires string fact_id + non-empty string statement')
      }
      requireIdKind(p.fact_id, 'FACT', '/payload/fact_id')
      if (state.facts.has(p.fact_id)) {
        throw new SemanticDomainError(
          'OBJECT_ALREADY_EXISTS',
          `Fact ${JSON.stringify(p.fact_id)} already exists; FACT_RECORDED requires a fresh fact_id (catalog §5.3: 新建)`,
          '/payload/fact_id',
        )
      }
      const row: FactRow = {
        id: p.fact_id,
        workstream_id: owner,
        statement: p.statement,
        ...(typeof p.created_by_run === 'string' ? { created_by_run: p.created_by_run } : {}),
        created_by: actorOf(event, 'FACT_RECORDED'),
        ...(isArrayOfStrings(p.references) ? { references: [...p.references] } : {}),
        recorded_at: event.occurredAt,
        status: FACT_STATUS,
      }
      const facts = new Map(state.facts)
      facts.set(p.fact_id, row)
      return { ...state, facts }
    }
    case 'CLAIM_RECORDED': {
      const p = event.payload
      if (!isRecord(p) || typeof p.claim_id !== 'string' || typeof p.statement !== 'string' || p.statement.length === 0) {
        throwInvalidPayload('CLAIM_RECORDED', 'payload requires string claim_id + non-empty string statement')
      }
      requireIdKind(p.claim_id, 'CLAIM', '/payload/claim_id')
      if (state.claims.has(p.claim_id)) {
        throw new SemanticDomainError(
          'OBJECT_ALREADY_EXISTS',
          `Claim ${JSON.stringify(p.claim_id)} already exists; CLAIM_RECORDED requires a fresh claim_id (catalog §5.3: 新建)`,
          '/payload/claim_id',
        )
      }
      const row: ClaimRow = {
        id: p.claim_id,
        workstream_id: owner,
        statement: p.statement,
        ...(typeof p.created_by_run === 'string' ? { created_by_run: p.created_by_run } : {}),
        created_by: actorOf(event, 'CLAIM_RECORDED'),
        ...(isArrayOfStrings(p.references) ? { references: [...p.references] } : {}),
        recorded_at: event.occurredAt,
        status: 'ACTIVE',
      }
      const claims = new Map(state.claims)
      claims.set(p.claim_id, row)
      return { ...state, claims }
    }
    case 'CLAIM_RETRACTED': {
      const p = event.payload
      if (!isRecord(p) || typeof p.claim_id !== 'string') {
        throwInvalidPayload('CLAIM_RETRACTED', 'payload requires string claim_id')
      }
      requireIdKind(p.claim_id, 'CLAIM', '/payload/claim_id')
      const claim = state.claims.get(p.claim_id)
      if (claim === undefined) {
        throw new SemanticDomainError(
          'OBJECT_NOT_FOUND',
          `Claim ${JSON.stringify(p.claim_id)} does not exist (catalog §5.3: 存在)`,
          '/payload/claim_id',
        )
      }
      checkClaimTransition(p.claim_id, claim.status, 'RETRACTED')
      if (claim.workstream_id !== owner) {
        throwOwnerMismatch(`Claim ${p.claim_id}`, claim.workstream_id, owner, '/payload/claim_id')
      }
      const row: ClaimRow = { ...claim, status: 'RETRACTED' satisfies ClaimStatus }
      const claims = new Map(state.claims)
      claims.set(p.claim_id, row)
      return { ...state, claims, conflict: deriveConflictFlags({ claims, relations: state.relations }) }
    }
    case 'ARTIFACT_REGISTERED': {
      const p = event.payload
      if (
        !isRecord(p) ||
        typeof p.artifact_id !== 'string' ||
        !isArtifactType(p.type) ||
        typeof p.title !== 'string' ||
        p.title.length === 0 ||
        typeof p.uri !== 'string' ||
        p.uri.length === 0
      ) {
        throwInvalidPayload('ARTIFACT_REGISTERED', `payload requires string artifact_id + artifact type ∈ {${ARTIFACT_TYPES.join(', ')}} + non-empty title/uri`)
      }
      requireIdKind(p.artifact_id, 'ARTIFACT', '/payload/artifact_id')
      if (state.artifacts.has(p.artifact_id)) {
        throw new SemanticDomainError(
          'OBJECT_ALREADY_EXISTS',
          `Artifact ${JSON.stringify(p.artifact_id)} already exists; ARTIFACT_REGISTERED requires a fresh artifact_id (catalog §5.4: 新建)`,
          '/payload/artifact_id',
        )
      }
      if (typeof p.supersedes === 'string') {
        requireIdKind(p.supersedes, 'ARTIFACT', '/payload/supersedes')
        if (!state.artifacts.has(p.supersedes)) {
          throw new SemanticDomainError(
            'OBJECT_NOT_FOUND',
            `supersedes artifact ${JSON.stringify(p.supersedes)} does not exist (catalog §5.4: supersedes 存在)`,
            '/payload/supersedes',
          )
        }
      }
      const row: ArtifactRow = {
        id: p.artifact_id,
        workstream_id: owner,
        type: p.type,
        title: p.title,
        uri: p.uri,
        ...(typeof p.content_hash === 'string' ? { content_hash: p.content_hash } : {}),
        ...(typeof p.created_by_run === 'string' ? { created_by_run: p.created_by_run } : {}),
        ...(typeof p.related_task === 'string' ? { related_task: p.related_task } : {}),
        ...(typeof p.supersedes === 'string' ? { supersedes: p.supersedes } : {}),
        recorded_at: event.occurredAt,
        status: 'REGISTERED' satisfies ArtifactStatus,
      }
      const artifacts = new Map(state.artifacts)
      artifacts.set(p.artifact_id, row)
      return { ...state, artifacts }
    }
    case 'ARTIFACT_MARKED_MISSING': {
      const p = event.payload
      if (!isRecord(p) || typeof p.artifact_id !== 'string') {
        throwInvalidPayload('ARTIFACT_MARKED_MISSING', 'payload requires string artifact_id')
      }
      requireIdKind(p.artifact_id, 'ARTIFACT', '/payload/artifact_id')
      const artifact = state.artifacts.get(p.artifact_id)
      if (artifact === undefined) {
        throw new SemanticDomainError(
          'OBJECT_NOT_FOUND',
          `Artifact ${JSON.stringify(p.artifact_id)} does not exist (catalog §5.4: 存在)`,
          '/payload/artifact_id',
        )
      }
      checkArtifactTransition(p.artifact_id, artifact.status, 'MISSING')
      if (artifact.workstream_id !== owner) {
        throwOwnerMismatch(`Artifact ${p.artifact_id}`, artifact.workstream_id, owner, '/payload/artifact_id')
      }
      const row: ArtifactRow = { ...artifact, status: 'MISSING' satisfies ArtifactStatus }
      const artifacts = new Map(state.artifacts)
      artifacts.set(p.artifact_id, row)
      return { ...state, artifacts }
    }
    case 'RELATION_ADDED': {
      const p = event.payload
      if (
        !isRecord(p) ||
        typeof p.relation_id !== 'string' ||
        typeof p.relation_type !== 'string' ||
        !isWellFormedRef(p.source) ||
        !isWellFormedRef(p.target)
      ) {
        throwInvalidPayload('RELATION_ADDED', 'payload requires string relation_id/relation_type + well-formed {kind,id} source/target')
      }
      requireIdKind(p.relation_id, 'RELATION', '/payload/relation_id')
      if (state.relations.has(p.relation_id)) {
        throw new SemanticDomainError(
          'OBJECT_ALREADY_EXISTS',
          `Relation ${JSON.stringify(p.relation_id)} already exists; RELATION_ADDED requires a fresh relation_id (catalog §5.5: 新建)`,
          '/payload/relation_id',
        )
      }
      // INV-REL-3 (frozen 10-type set) — with a precise message for the
      // §8 reverse forms (INV-REL-2: 不保存的反向形式).
      if (isForbiddenReverseForm(p.relation_type)) {
        throw new SemanticDomainError(
          'RELATION_TYPE_UNKNOWN',
          `${p.relation_type} is a reverse form refused by §8 (INV-REL-2: only RELY_ON direct edges are persisted; the reverse view is derived by incoming-edge query)`,
          '/payload/relation_type',
        )
      }
      if (!isRelationType(p.relation_type)) {
        throw new SemanticDomainError(
          'RELATION_TYPE_UNKNOWN',
          `${p.relation_type} is not one of the frozen 10 relation types (DOMAIN_SCHEMA §8, INV-REL-3)`,
          '/payload/relation_type',
        )
      }
      // INV-REL-1: §8 组合表 direction + self-loop prohibition.
      if (!isLegalRelationCombination(p.relation_type, p.source.kind, p.target.kind)) {
        throw new SemanticDomainError(
          'RELATION_COMBINATION',
          `${p.relation_type} from ${p.source.kind} to ${p.target.kind} is not in the frozen §8 combination table (INV-REL-1: TARGET 始终是 SOURCE 的前提/来源/输入/证据/上位目标)`,
          '/payload/relation_type',
        )
      }
      if (isSelfLoop(p.source, p.target)) {
        throw new SemanticDomainError(
          'RELATION_SELF_LOOP',
          `Relation ${p.relation_id} sources and targets the same object (${p.source.kind} ${p.source.id}); a RELY_ON premise cannot be itself (INV-REL-1)`,
          '/payload/source',
        )
      }
      // §8 唯一性 / §15 UNIQUE 5-tuple (any-status rows: edges are one-shot, INV-HIST-7).
      const dup = findDuplicateEdge(state.relations, p.source, p.relation_type, p.target)
      if (dup !== undefined) {
        throw new SemanticDomainError(
          'RELATION_DUPLICATE',
          `An edge with the same 5-tuple already exists as relation ${dup.id} (DOMAIN_SCHEMA §8 唯一性 / §15 UNIQUE(source_kind, source_id, relation_type, target_kind, target_id))`,
          '/payload/source',
        )
      }
      const rev = findReverseDuplicateEdge(state.relations, p.source, p.relation_type, p.target)
      if (rev !== undefined) {
        throw new SemanticDomainError(
          'RELATION_REVERSE_DUPLICATE',
          `The same edge in reverse already exists as relation ${rev.id} (DOMAIN_SCHEMA §8: 禁止同边反向重复)`,
          '/payload/source',
        )
      }
      // §8 owner rule (state-local half): source.ws ?? target.ws.
      const ownerWs = endpointWorkstream(p.source, state) ?? endpointWorkstream(p.target, state)
      if (ownerWs !== undefined && ownerWs !== owner) {
        throwOwnerMismatch(`Relation ${p.relation_id}`, ownerWs, owner, '/ownerWorkstreamId')
      }
      const row: RelationRow = {
        id: p.relation_id,
        source: { kind: p.source.kind, id: p.source.id },
        relation_type: p.relation_type,
        target: { kind: p.target.kind, id: p.target.id },
        created_by: actorOf(event, 'RELATION_ADDED'),
        created_at: event.occurredAt,
        status: 'ACTIVE' satisfies RelationStatus,
      }
      const relations = new Map(state.relations)
      relations.set(p.relation_id, row)
      return { ...state, relations, conflict: deriveConflictFlags({ claims: state.claims, relations }) }
    }
    case 'RELATION_REMOVED': {
      const p = event.payload
      if (!isRecord(p) || typeof p.relation_id !== 'string') {
        throwInvalidPayload('RELATION_REMOVED', 'payload requires string relation_id')
      }
      requireIdKind(p.relation_id, 'RELATION', '/payload/relation_id')
      const relation = state.relations.get(p.relation_id)
      if (relation === undefined) {
        throw new SemanticDomainError(
          'OBJECT_NOT_FOUND',
          `Relation ${JSON.stringify(p.relation_id)} does not exist (catalog §5.5: 存在)`,
          '/payload/relation_id',
        )
      }
      checkRelationTransition(p.relation_id, relation.status, 'REMOVED')
      // §5.5 audit redundancy: the recorded endpoints must mirror the stored edge.
      if (
        !isWellFormedRef(p.source) ||
        !isWellFormedRef(p.target) ||
        typeof p.relation_type !== 'string' ||
        !sameRef(p.source, relation.source) ||
        p.relation_type !== relation.relation_type ||
        !sameRef(p.target, relation.target)
      ) {
        throw new SemanticDomainError(
          'RELATION_ENDPOINT_MISMATCH',
          `Recorded source/relation_type/target must match the existing relation (catalog §5.5 audit redundancy); stored: source=${JSON.stringify(relation.source)} relation_type=${relation.relation_type} target=${JSON.stringify(relation.target)}`,
          '/payload/source',
        )
      }
      const ownerWs = endpointWorkstream(relation.source, state) ?? endpointWorkstream(relation.target, state)
      if (ownerWs !== undefined && ownerWs !== owner) {
        throwOwnerMismatch(`Relation ${p.relation_id}`, ownerWs, owner, '/ownerWorkstreamId')
      }
      const row: RelationRow = { ...relation, status: 'REMOVED' satisfies RelationStatus, removed_at: event.occurredAt }
      const relations = new Map(state.relations)
      relations.set(p.relation_id, row)
      return { ...state, relations, conflict: deriveConflictFlags({ claims: state.claims, relations }) }
    }
    default:
      // Unreachable: isSemanticEvent already filtered to the seven names.
      return state
  }
}

/* ------------------------------------------------------------------ *
 * Folding + the §2 replay orderings
 * ------------------------------------------------------------------ */

/**
 * Fold a stream in the GIVEN order (pure). Replay from empty:
 * `foldSemanticEvents(orderByAudit(allEvents))` rebuilds the derived
 * semantic state (catalog §6 重放 / TC-HIST-006).
 */
export function foldSemanticEvents(
  events: readonly SemanticInputEvent[],
  init: SemanticState = initialSemanticState(),
): SemanticState {
  let state = init
  for (const event of events) {
    state = reduceSemanticEvent(state, event)
  }
  return state
}

function byString(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0
  if (a === undefined) return -1
  if (b === undefined) return 1
  return a < b ? -1 : 1
}

/**
 * Audit replay order (catalog §2): `ORDER BY event_seq` — registration
 * order; a late-registered event stays at the tail (TC-HIST-002). Residual
 * tie on (ownerWorkstreamId, eventId) keeps the order total (TC-HIST-005).
 * Domain-owned copy of the WP-2.2 sorter (identity cross-checked in tests).
 */
export function orderByAudit(events: readonly SemanticInputEvent[]): readonly SemanticInputEvent[] {
  return [...events].sort(
    (a, b) => (a.eventSeq ?? -1) - (b.eventSeq ?? -1) || byString(a.ownerWorkstreamId, b.ownerWorkstreamId) || byString(a.eventId, b.eventId),
  )
}

/**
 * Semantic replay order (catalog §2): `ORDER BY occurred_at, event_seq` —
 * equal occurredAt tie-breaks on eventSeq (deterministic, TC-HIST-004);
 * residual tie on (ownerWorkstreamId, eventId) (TC-HIST-005). Domain-owned
 * copy of the WP-2.2 sorter (identity cross-checked in tests).
 */
export function orderBySemantic(events: readonly SemanticInputEvent[]): readonly SemanticInputEvent[] {
  return [...events].sort(
    (a, b) =>
      a.occurredAt - b.occurredAt ||
      (a.eventSeq ?? -1) - (b.eventSeq ?? -1) ||
      byString(a.ownerWorkstreamId, b.ownerWorkstreamId) ||
      byString(a.eventId, b.eventId),
  )
}

/**
 * Project the derived semantic state into the four snapshot maps the WP-2.2
 * `HistoryObjectContext` consumes (camelCase; structural mirror of the
 * registry's Claim/Fact/Artifact/RelationSnapshot). The service merges the
 * projection into a full ctx so write-time validation sees the reducer state.
 */
export function toObjectContext(state: SemanticState): SemanticObjectContext {
  const claims = new Map<string, { workstreamId: string; status: ClaimStatus }>()
  for (const [id, row] of state.claims) claims.set(id, { workstreamId: row.workstream_id, status: row.status })
  const facts = new Map<string, { workstreamId: string }>()
  for (const [id, row] of state.facts) facts.set(id, { workstreamId: row.workstream_id })
  const artifacts = new Map<string, { workstreamId: string; status: ArtifactStatus }>()
  for (const [id, row] of state.artifacts) artifacts.set(id, { workstreamId: row.workstream_id, status: row.status })
  const relations = new Map<
    string,
    { status: RelationStatus; source: SemanticTypedRef; relationType: RelationRow['relation_type']; target: SemanticTypedRef }
  >()
  for (const [id, row] of state.relations) {
    relations.set(id, { status: row.status, source: row.source, relationType: row.relation_type, target: row.target })
  }
  return { claims, facts, artifacts, relations }
}

/* ------------------------------------------------------------------ *
 * Internal helpers (structural pre-checks — fail loud, never corrupt a row)
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isArrayOfStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

const ACTOR_KINDS: readonly string[] = ['USER', 'AGENT', 'PLUGIN', 'SYSTEM']

function actorOf(event: SemanticInputEvent, eventType: string): ActorRefDoc {
  const actor = event.actor
  if (!isRecord(actor) || typeof actor.kind !== 'string' || !ACTOR_KINDS.includes(actor.kind)) {
    throw new SemanticDomainError(
      'INVALID_PAYLOAD',
      `${eventType} requires a well-formed envelope actor (kind ∈ USER|AGENT|PLUGIN|SYSTEM) — it becomes the row's created_by (common.schema actorRef)`,
      '/actor',
    )
  }
  return actor as unknown as ActorRefDoc
}

function envelopeOwner(event: SemanticInputEvent): string {
  const owner = event.ownerWorkstreamId
  if (typeof owner !== 'string' || parseId(owner)?.kind !== 'WORKSTREAM') {
    throw new SemanticDomainError(
      'INVALID_ENVELOPE',
      `ownerWorkstreamId must be a well-formed WS id (got ${JSON.stringify(owner)}) — the row's workstream_id (INV-SCI-1: workstream-local label)`,
      '/ownerWorkstreamId',
    )
  }
  return owner
}

function requireIdKind(id: string, kind: 'CLAIM' | 'FACT' | 'ARTIFACT' | 'RELATION', path: string): void {
  const parsed = parseId(id)
  if (parsed === null || parsed.kind !== kind) {
    throw new SemanticDomainError(
      'INVALID_ID',
      `${path} must be a well-formed ${kind} id (${kind === 'RELATION' ? 'REL-<n>' : `${kind.slice(0, 1)}-<n>`}; got ${JSON.stringify(id)})`,
      path,
    )
  }
}

function throwInvalidPayload(eventType: string, what: string): never {
  throw new SemanticDomainError('INVALID_PAYLOAD', `${eventType}: ${what}`, '/payload')
}

function throwOwnerMismatch(object: string, actualWs: string, eventOwner: string, path: string): never {
  throw new SemanticDomainError(
    'OWNER_MISMATCH',
    `${object} belongs to workstream ${actualWs}, not the event owner ${eventOwner} (catalog §4 owner 列)`,
    path,
  )
}

/**
 * The workstream a typed ref is local to, resolvable from the SEMANTIC
 * STATE ALONE (state-local owner check):
 *  - WORKSTREAM ref → itself;
 *  - CLAIM/FACT/ARTIFACT → the row's workstream_id (undefined = row absent);
 *  - anything else (TASK/GATE/MILESTONE/RUN/…) → undefined: outside this
 *    state; the write-time validator (full ctx) owns that resolution.
 */
function endpointWorkstream(ref: SemanticTypedRef, state: SemanticState): string | undefined {
  switch (ref.kind) {
    case 'WORKSTREAM':
      return ref.id
    case 'CLAIM':
      return state.claims.get(ref.id)?.workstream_id
    case 'FACT':
      return state.facts.get(ref.id)?.workstream_id
    case 'ARTIFACT':
      return state.artifacts.get(ref.id)?.workstream_id
    default:
      return undefined
  }
}
