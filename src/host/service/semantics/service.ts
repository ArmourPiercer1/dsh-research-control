/**
 * UI-7 (D1–D3) — the seven-write semantic records service (host).
 *
 * The seven writes of the D §13 Records face, persisted ONLY as semantic
 * history events (the §30 red line: records live ONLY in the operational
 * sqlite — `history_event` + the derived `semantics:<projectId>` row;
 * zero `.research` semantic files):
 *
 *   recordFact          FACT_RECORDED            (status const ACTIVE)
 *   recordClaim         CLAIM_RECORDED           (status=ACTIVE)
 *   retractClaim        CLAIM_RETRACTED          (terminal, §13)
 *   registerArtifact    ARTIFACT_REGISTERED      (BY REFERENCE, §13.6)
 *   markArtifactMissing ARTIFACT_MARKED_MISSING  (V1 one-way, §7.3)
 *   addRelation         RELATION_ADDED           (owner DERIVED:
 *   removeRelation        source.ws ?? target.ws, §8/§4 特例)
 *
 * Write path (the canonical protocol — `./protocol.ts`, ADJ-2):
 *
 *   1. RESERVE the object id (if the write creates a new semantic object)
 *      + the HISTORY_EVENT id (shared `IdAllocator`);
 *   2. PRE-CHECK (ADJ-3): `validateSemanticEvent` (the §5.3–5.5
 *      preconditions + the §8/INV-REL rule family) against the DERIVED
 *      semantic state read read-only OUTSIDE the tx; a failure throws a
 *      `SemanticDomainError` (first structured error), releases ALL
 *      reservations and writes NO event row (test-pinned);
 *   3. `appendEvents` with the COMPOSED REGISTRY VALIDATE HOOK (ADJ-4:
 *      `options.validate` = `makeValidateHook(registry, buildContext)` —
 *      the authoritative in-tx layer; the ctx merges the PLAN index with
 *      the semantic maps projected from the derived state, so
 *      `validateEvent` sees the reducer state). Inside the SAME tx, the
 *      RR-011(b) store seam then applies the semantic incremental fold
 *      EXACTLY ONCE, AFTER the registry hook — the service MUST NOT
 *      compose the fold itself (a second fold would re-apply the event
 *      onto the already-updated state and the reducer would reject it
 *      OBJECT_ALREADY_EXISTS);
 *   4. commit both reservations; release on ANY failure.
 *
 * Error discipline (plan-writer / dependency carrier, service level):
 * the structured rejections (the service's pre-check and the registry
 * hook / fold seam — SemanticDomainError / RunBindingError
 * RB_EVENT_REJECTED) are mapped to `[research-control] <CODE>: <msg>` by
 * `mapSemanticsError`; everything else propagates untouched.
 *
 * ADJ-1: the seven writes do NOT write a `management_action` row — the
 * provenance IS the event log itself (the envelope carries the USER
 * actor; the derived rows carry `created_by`).
 *
 * ADJ-12: the method surface is directly callable by the three research
 * tool stubs (fact-record / claim-record / artifact-register) — the
 * `id` and `created_by_run` fields are NOT parameters.
 *
 * The event envelope's actor is `{kind:'USER'}` (the management face's
 * action — the same carrier the plan-writer ledger rows use).
 */

import { makeValidateHook } from '../runbinding/events.js'
import { readDerivedState } from '../../history/replay/index.js'
import { jsonToSemanticState, semanticStateKey } from '../wiring/semantics.js'
import {
  initialSemanticState,
  toObjectContext,
  validateSemanticEvent,
  type SemanticInputEvent,
  type SemanticState,
} from '../../domain/semantics/index.js'
import {
  SemanticDomainError,
  type ActorRefDoc,
} from '../../domain/semantics/types.js'
import type {
  GateSnapshot,
  HistoryObjectContext,
  MilestoneSnapshot,
  TaskSnapshot,
  WorkstreamSnapshot,
} from '../../history/registry/types.js'
import { canonicalSemanticAppend, type CanonicalAppendIds, type SemanticValidateHook } from './protocol.js'
import { querySemanticRecords } from './query.js'
import { mapSemanticsError } from './errors.js'
import type {
  AddRelationArgs,
  AddRelationResult,
  MarkArtifactMissingArgs,
  MarkArtifactMissingResult,
  RecordClaimArgs,
  RecordClaimResult,
  RecordFactArgs,
  RecordFactResult,
  RegisterArtifactArgs,
  RegisterArtifactResult,
  RetractClaimArgs,
  RetractClaimResult,
  RemoveRelationArgs,
  RemoveRelationResult,
  QueryRecordsArgs,
  QueryRecordsResult,
  SemanticEndpointRef,
  SemanticIdAllocator,
  SemanticPlanIndex,
  SemanticRecordsServiceOptions,
  SemanticRecordsStorePort,
} from './types.js'

const EVENT_SCHEMA_VERSION = 1

/** The USER management actor (the face's action — no user_id in V1;
 *  matches the plan-writer ledger actor carrier). */
const USER_ACTOR: ActorRefDoc = { kind: 'USER' }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asRef(v: unknown): { readonly kind: string; readonly id: string } | null {
  if (!isRecord(v) || typeof v.kind !== 'string' || typeof v.id !== 'string') return null
  return { kind: v.kind, id: v.id }
}

/** The fold state of one stored edge (the payload 5-tuple + status). */
interface StoredEdge {
  readonly status: 'ACTIVE' | 'REMOVED'
  readonly source: { readonly kind: string; readonly id: string }
  readonly relationType: string
  readonly target: { readonly kind: string; readonly id: string }
}

export class SemanticRecordsService {
  readonly #store: SemanticRecordsStorePort
  readonly #registry: SemanticRecordsServiceOptions['registry']
  readonly #allocator: SemanticIdAllocator
  readonly #plans: SemanticPlanIndex
  readonly #projectId: string
  readonly #now: () => number

  constructor(options: SemanticRecordsServiceOptions) {
    if (options.store === undefined || options.store === null) {
      throw new TypeError('SemanticRecordsService: options.store is required (the event store face)')
    }
    if (typeof options.store.path !== 'string' || options.store.path.length === 0) {
      throw new TypeError('SemanticRecordsService: options.store.path is required (the pre-validation derived-state read)')
    }
    if (options.registry === undefined || options.registry === null) {
      throw new TypeError('SemanticRecordsService: options.registry is required (the frozen event registry)')
    }
    if (options.allocator === undefined || options.allocator === null) {
      throw new TypeError('SemanticRecordsService: options.allocator is required (the shared IdAllocator face)')
    }
    if (options.plans === undefined || options.plans === null || !Array.isArray(options.plans.workstreams)) {
      throw new TypeError('SemanticRecordsService: options.plans is required (the workstream index)')
    }
    if (typeof options.projectId !== 'string' || options.projectId.length === 0) {
      throw new TypeError('SemanticRecordsService: options.projectId is required (a well-formed PRJ id)')
    }
    this.#store = options.store
    this.#registry = options.registry
    this.#allocator = options.allocator
    this.#plans = options.plans
    this.#projectId = options.projectId
    this.#now = options.now ?? Date.now
  }

  /* ---------------------------------------------------------------- *
   * The seven writes (public face; the tool stubs call it directly —
   * ADJ-12)
   * ---------------------------------------------------------------- */

  /** recordFact — FACT_RECORDED (D §13.2; status const ACTIVE). */
  recordFact(args: RecordFactArgs): RecordFactResult {
    try {
      return this.#recordFactImpl(args)
    } catch (e) {
      throw mapSemanticsError(e)
    }
  }

  /** recordClaim — CLAIM_RECORDED (D §13.2; status=ACTIVE). */
  recordClaim(args: RecordClaimArgs): RecordClaimResult {
    try {
      return this.#recordClaimImpl(args)
    } catch (e) {
      throw mapSemanticsError(e)
    }
  }

  /** retractClaim — CLAIM_RETRACTED (D §13.2; terminal, §13). */
  retractClaim(args: RetractClaimArgs): RetractClaimResult {
    try {
      return this.#retractClaimImpl(args)
    } catch (e) {
      throw mapSemanticsError(e)
    }
  }

  /** registerArtifact — ARTIFACT_REGISTERED (D §13.2/§13.6; BY REFERENCE). */
  registerArtifact(args: RegisterArtifactArgs): RegisterArtifactResult {
    try {
      return this.#registerArtifactImpl(args)
    } catch (e) {
      throw mapSemanticsError(e)
    }
  }

  /** markArtifactMissing — ARTIFACT_MARKED_MISSING (D §13.2; V1 one-way). */
  markArtifactMissing(args: MarkArtifactMissingArgs): MarkArtifactMissingResult {
    try {
      return this.#markArtifactMissingImpl(args)
    } catch (e) {
      throw mapSemanticsError(e)
    }
  }

  /** addRelation — RELATION_ADDED (D §13.2/§8; owner derived). */
  addRelation(args: AddRelationArgs): AddRelationResult {
    try {
      return this.#addRelationImpl(args)
    } catch (e) {
      throw mapSemanticsError(e)
    }
  }

  /** removeRelation — RELATION_REMOVED (D §13.2; §5.5 audit mirror). */
  removeRelation(args: RemoveRelationArgs): RemoveRelationResult {
    try {
      return this.#removeRelationImpl(args)
    } catch (e) {
      throw mapSemanticsError(e)
    }
  }

  /** queryRecords — the Records READ face (D §13.4 / ADJ-11): the
   *  derived `semantics:<projectId>` row + a pure in-memory filter.
   *  NO research-tree load, NO file reads, NO history-timeline access —
   *  the plan index is never consulted (the query is state-local). */
  queryRecords(args: QueryRecordsArgs): QueryRecordsResult {
    try {
      return querySemanticRecords(this.#readSemanticState(), args)
    } catch (e) {
      throw mapSemanticsError(e)
    }
  }

  /* ---------------------------------------------------------------- *
   * recordFact
   * ---------------------------------------------------------------- */

  #recordFactImpl(args: RecordFactArgs): RecordFactResult {
    const ownerWs = args.workstreamId
    const references = [...(args.references ?? [])]
    const occurredAt = this.#now()
    const result = canonicalSemanticAppend(
      { allocator: this.#allocator, store: this.#store, projectId: this.#projectId },
      {
        objectKind: 'FACT',
        eventType: 'FACT_RECORDED',
        ownerWorkstreamId: ownerWs,
        occurredAt,
        actor: USER_ACTOR,
        buildPayload: (ids) => ({
          fact_id: ids.objectId as string,
          statement: args.statement,
          references,
        }),
        precheck: this.#precheck((ids) => ({
          eventType: 'FACT_RECORDED',
          ownerWorkstreamId: ownerWs,
          occurredAt,
          actor: USER_ACTOR,
          payload: { fact_id: ids.objectId as string, statement: args.statement, references },
        })),
        validate: this.#composedValidate(ownerWs),
        label: 'semantics',
      },
    )
    return {
      factId: result.objectId as string,
      workstreamId: ownerWs,
      statement: args.statement,
      references,
      status: 'ACTIVE',
      recordedAt: occurredAt,
      eventId: result.eventId,
    }
  }

  /* ---------------------------------------------------------------- *
   * recordClaim
   * ---------------------------------------------------------------- */

  #recordClaimImpl(args: RecordClaimArgs): RecordClaimResult {
    const ownerWs = args.workstreamId
    const references = [...(args.references ?? [])]
    const occurredAt = this.#now()
    const result = canonicalSemanticAppend(
      { allocator: this.#allocator, store: this.#store, projectId: this.#projectId },
      {
        objectKind: 'CLAIM',
        eventType: 'CLAIM_RECORDED',
        ownerWorkstreamId: ownerWs,
        occurredAt,
        actor: USER_ACTOR,
        buildPayload: (ids) => ({
          claim_id: ids.objectId as string,
          statement: args.statement,
          references,
        }),
        precheck: this.#precheck((ids) => ({
          eventType: 'CLAIM_RECORDED',
          ownerWorkstreamId: ownerWs,
          occurredAt,
          actor: USER_ACTOR,
          payload: { claim_id: ids.objectId as string, statement: args.statement, references },
        })),
        validate: this.#composedValidate(ownerWs),
        label: 'semantics',
      },
    )
    return {
      claimId: result.objectId as string,
      workstreamId: ownerWs,
      statement: args.statement,
      references,
      status: 'ACTIVE',
      recordedAt: occurredAt,
      eventId: result.eventId,
    }
  }

  /* ---------------------------------------------------------------- *
   * retractClaim (HISTORY_EVENT-only — the claim row already exists)
   * ---------------------------------------------------------------- */

  #retractClaimImpl(args: RetractClaimArgs): RetractClaimResult {
    const claimId = args.claimId
    // The claim's owner workstream comes from the derived row (the
    // validator's OWNER_MISMATCH check uses it); the derived row is the
    // fold's output — the single project-wide semantic registry.
    const state = this.#readSemanticState()
    const claim = state.claims.get(claimId)
    if (claim === undefined) {
      throw new SemanticDomainError(
        'OBJECT_NOT_FOUND',
        `Claim ${JSON.stringify(claimId)} does not exist (catalog §5.3: 存在)`,
        '/payload/claim_id',
      )
    }
    const ownerWs = claim.workstream_id
    const occurredAt = this.#now()
    const result = canonicalSemanticAppend(
      { allocator: this.#allocator, store: this.#store, projectId: this.#projectId },
      {
        eventType: 'CLAIM_RETRACTED',
        ownerWorkstreamId: ownerWs,
        occurredAt,
        actor: USER_ACTOR,
        buildPayload: () => ({
          claim_id: claimId,
          ...(args.reason !== undefined ? { reason: args.reason } : {}),
        }),
        precheck: this.#precheck(() => ({
          eventType: 'CLAIM_RETRACTED',
          ownerWorkstreamId: ownerWs,
          occurredAt,
          actor: USER_ACTOR,
          payload: { claim_id: claimId, ...(args.reason !== undefined ? { reason: args.reason } : {}) },
        })),
        validate: this.#composedValidate(ownerWs),
        label: 'semantics',
      },
    )
    return { claimId, status: 'RETRACTED', eventId: result.eventId }
  }

  /* ---------------------------------------------------------------- *
   * registerArtifact (BY REFERENCE — D §13.6: the file is never copied)
   * ---------------------------------------------------------------- */

  #registerArtifactImpl(args: RegisterArtifactArgs): RegisterArtifactResult {
    const ownerWs = args.workstreamId
    const occurredAt = this.#now()
    const buildPayload = (ids: CanonicalAppendIds): Record<string, unknown> => ({
      artifact_id: ids.objectId as string,
      type: args.type,
      title: args.title,
      uri: args.uri,
      ...(args.contentHash !== undefined ? { content_hash: args.contentHash } : {}),
      ...(args.relatedTaskId !== undefined ? { related_task: args.relatedTaskId } : {}),
      ...(args.supersedes !== undefined ? { supersedes: args.supersedes } : {}),
    })
    const result = canonicalSemanticAppend(
      { allocator: this.#allocator, store: this.#store, projectId: this.#projectId },
      {
        objectKind: 'ARTIFACT',
        eventType: 'ARTIFACT_REGISTERED',
        ownerWorkstreamId: ownerWs,
        occurredAt,
        actor: USER_ACTOR,
        buildPayload,
        precheck: this.#precheck((ids) => ({
          eventType: 'ARTIFACT_REGISTERED',
          ownerWorkstreamId: ownerWs,
          occurredAt,
          actor: USER_ACTOR,
          payload: buildPayload(ids),
        })),
        validate: this.#composedValidate(ownerWs),
        label: 'semantics',
      },
    )
    return {
      artifactId: result.objectId as string,
      workstreamId: ownerWs,
      type: args.type,
      title: args.title,
      uri: args.uri,
      status: 'REGISTERED',
      recordedAt: occurredAt,
      eventId: result.eventId,
    }
  }

  /* ---------------------------------------------------------------- *
   * markArtifactMissing (HISTORY_EVENT-only — the row already exists)
   * ---------------------------------------------------------------- */

  #markArtifactMissingImpl(args: MarkArtifactMissingArgs): MarkArtifactMissingResult {
    const artifactId = args.artifactId
    const state = this.#readSemanticState()
    const artifact = state.artifacts.get(artifactId)
    if (artifact === undefined) {
      throw new SemanticDomainError(
        'OBJECT_NOT_FOUND',
        `Artifact ${JSON.stringify(artifactId)} does not exist (catalog §5.4: 存在)`,
        '/payload/artifact_id',
      )
    }
    const ownerWs = artifact.workstream_id
    const occurredAt = this.#now()
    const result = canonicalSemanticAppend(
      { allocator: this.#allocator, store: this.#store, projectId: this.#projectId },
      {
        eventType: 'ARTIFACT_MARKED_MISSING',
        ownerWorkstreamId: ownerWs,
        occurredAt,
        actor: USER_ACTOR,
        buildPayload: () => ({
          artifact_id: artifactId,
          ...(args.reason !== undefined ? { reason: args.reason } : {}),
        }),
        precheck: this.#precheck(() => ({
          eventType: 'ARTIFACT_MARKED_MISSING',
          ownerWorkstreamId: ownerWs,
          occurredAt,
          actor: USER_ACTOR,
          payload: { artifact_id: artifactId, ...(args.reason !== undefined ? { reason: args.reason } : {}) },
        })),
        validate: this.#composedValidate(ownerWs),
        label: 'semantics',
      },
    )
    return { artifactId, status: 'MISSING', eventId: result.eventId }
  }

  /* ---------------------------------------------------------------- *
   * addRelation (owner DERIVED: source.ws ?? target.ws — §8/§4 特例)
   * ---------------------------------------------------------------- */

  #addRelationImpl(args: AddRelationArgs): AddRelationResult {
    const state = this.#readSemanticState()
    const ownerWs =
      this.#endpointWsLocal(args.source, state) ??
      this.#endpointWsLocal(args.target, state) ??
      this.#wsOfRef(args.source, state) ??
      this.#wsOfRef(args.target, state)
    if (ownerWs === undefined) {
      throw new SemanticDomainError(
        'OBJECT_NOT_FOUND',
        `relation ${JSON.stringify(`${args.source.kind}:${args.source.id}`)} → ${JSON.stringify(`${args.target.kind}:${args.target.id}`)}: no workstream-local endpoint (source.ws ?? target.ws unresolved — 非 workstream-local relation 拒绝创建, catalog §4 特例)`,
        '/ownerWorkstreamId',
      )
    }
    const occurredAt = this.#now()
    const buildPayload = (ids: CanonicalAppendIds): Record<string, unknown> => ({
      relation_id: ids.objectId as string,
      source: { kind: args.source.kind, id: args.source.id },
      relation_type: args.relationType,
      target: { kind: args.target.kind, id: args.target.id },
    })
    const result = canonicalSemanticAppend(
      { allocator: this.#allocator, store: this.#store, projectId: this.#projectId },
      {
        objectKind: 'RELATION',
        eventType: 'RELATION_ADDED',
        ownerWorkstreamId: ownerWs,
        occurredAt,
        actor: USER_ACTOR,
        buildPayload,
        precheck: this.#precheck((ids) => ({
          eventType: 'RELATION_ADDED',
          ownerWorkstreamId: ownerWs,
          occurredAt,
          actor: USER_ACTOR,
          payload: buildPayload(ids),
        })),
        validate: this.#composedValidate(ownerWs),
        label: 'semantics',
      },
    )
    return {
      relationId: result.objectId as string,
      source: { kind: args.source.kind, id: args.source.id },
      relationType: args.relationType,
      target: { kind: args.target.kind, id: args.target.id },
      status: 'ACTIVE',
      eventId: result.eventId,
    }
  }

  /* ---------------------------------------------------------------- *
   * removeRelation (HISTORY_EVENT-only — the §5.5 payload mirrors the
   * stored edge, recovered from the owner log fold)
   * ---------------------------------------------------------------- */

  #removeRelationImpl(args: RemoveRelationArgs): RemoveRelationResult {
    const relationId = args.relationId
    // Existence + the owner workstream come from the derived row (the
    // single project-wide semantic registry; the validator's
    // WRONG_STATE / OWNER_MISMATCH checks use the same row).
    const state = this.#readSemanticState()
    const row = state.relations.get(relationId)
    if (row === undefined) {
      throw new SemanticDomainError(
        'OBJECT_NOT_FOUND',
        `Relation ${JSON.stringify(relationId)} does not exist (catalog §5.5: 存在)`,
        '/payload/relation_id',
      )
    }
    const ownerWs =
      this.#endpointWsLocal(row.source, state) ??
      this.#endpointWsLocal(row.target, state) ??
      this.#wsOfRef(row.source, state) ??
      this.#wsOfRef(row.target, state)
    if (ownerWs === undefined) {
      throw new SemanticDomainError(
        'OBJECT_NOT_FOUND',
        `Relation ${JSON.stringify(relationId)}: no workstream-local endpoint (source.ws ?? target.ws unresolved; catalog §4 特例)`,
        '/payload/relation_id',
      )
    }
    // The §5.5 audit redundancy must mirror the STORED edge — recover it
    // from the owner log fold (the single-owner scope that carries it;
    // the canonical dependency pattern). A missing edge here means the
    // derived row and the log disagree — fail loud, BEFORE any id is
    // reserved (the payload's redundancy fields can never be invented).
    const stored = this.#foldOwnerRelations(ownerWs).get(relationId)
    if (stored === undefined) {
      throw new SemanticDomainError(
        'OBJECT_NOT_FOUND',
        `Relation ${JSON.stringify(relationId)} does not exist (catalog §5.5: 存在)`,
        '/payload/relation_id',
      )
    }
    const occurredAt = this.#now()
    const buildPayload = (): Record<string, unknown> => ({
      relation_id: relationId,
      source: { kind: stored.source.kind, id: stored.source.id },
      relation_type: stored.relationType,
      target: { kind: stored.target.kind, id: stored.target.id },
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
    })
    const result = canonicalSemanticAppend(
      { allocator: this.#allocator, store: this.#store, projectId: this.#projectId },
      {
        eventType: 'RELATION_REMOVED',
        ownerWorkstreamId: ownerWs,
        occurredAt,
        actor: USER_ACTOR,
        buildPayload,
        precheck: this.#precheck(() => ({
          eventType: 'RELATION_REMOVED',
          ownerWorkstreamId: ownerWs,
          occurredAt,
          actor: USER_ACTOR,
          payload: buildPayload(),
        })),
        validate: this.#composedValidate(ownerWs),
        label: 'semantics',
      },
    )
    return { relationId, status: 'REMOVED', eventId: result.eventId }
  }

  /* ---------------------------------------------------------------- *
   * The pre-validation read (ADJ-3 — the UX layer OUTSIDE the tx)
   * ---------------------------------------------------------------- */

  /** Read the project's derived semantic state (the `semantics:<projectId>`
   *  row, read-only connection; an absent row — a project with no
   *  semantic events yet — folds to the initial empty state). */
  #readSemanticState(): SemanticState {
    const key = semanticStateKey(this.#projectId)
    const raw = readDerivedState(this.#store).get(key)
    if (raw === undefined) return initialSemanticState()
    return jsonToSemanticState(raw, key)
  }

  /** The service-level pre-check (ADJ-3): validate the candidate event
   *  (built with the reserved ids) against the derived state; a
   *  structured failure throws the FIRST error as a
   *  `SemanticDomainError` (the service error mapper owns the carrier).
   *  Throws BEFORE the append ⇒ NO event row is written. */
  #precheck(
    buildCandidate: (ids: CanonicalAppendIds) => SemanticInputEvent,
  ): (ids: CanonicalAppendIds) => void {
    return (ids): void => {
      const state = this.#readSemanticState()
      const result = validateSemanticEvent(state, buildCandidate(ids), { externalWorkstream: this.#externalWorkstream() })
      if (!result.ok) {
        const first = result.errors[0]
        throw new SemanticDomainError(first.code, first.message, first.path)
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * The validation context (the WP-2.2 12-map snapshot) — the PLAN
   * index (definition-file membership, plan-scoped defaults) merged with
   * the semantic maps projected from the derived state, so the registry
   * half of the composed hook sees the reducer state (the domain's
   * `SemanticObjectContext` is structurally assignable to the snapshot
   * maps — proven by the domain tests).
   * ---------------------------------------------------------------- */

  #buildContext(ownerWs: string): HistoryObjectContext {
    const semantic = toObjectContext(this.#readSemanticState())
    const tasks = new Map<string, TaskSnapshot>()
    const gates = new Map<string, GateSnapshot>()
    const milestones = new Map<string, MilestoneSnapshot>()
    const workstreams = new Map<string, WorkstreamSnapshot>()
    for (const ws of this.#plans.workstreams) {
      workstreams.set(ws.id, { topicId: ws.topicId, lifecycle: ws.taskIds.length + ws.gateIds.length + ws.milestoneIds.length > 0 ? 'REALIZED' : 'PLANNED' })
      for (const id of ws.taskIds) tasks.set(id, { workstreamId: ws.id, execution: 'PLANNED', validation: 'NOT_REQUIRED', acceptanceCriteria: [] })
      for (const id of ws.gateIds) gates.set(id, { workstreamId: ws.id, lastResult: null })
      for (const id of ws.milestoneIds) milestones.set(id, { workstreamId: ws.id, status: 'PLANNED' })
    }
    return {
      workstreams,
      tasks,
      runs: new Map(),
      claims: semantic.claims,
      facts: semantic.facts,
      artifacts: semantic.artifacts,
      relations: semantic.relations,
      gates,
      milestones,
      interventions: new Map(),
      topologyEdges: new Map(),
    }
  }

  /** The composed registry validate hook (ADJ-4: `options.validate`
   *  MUST be this — the authoritative in-tx layer). */
  #composedValidate(ownerWs: string): SemanticValidateHook {
    return makeValidateHook(this.#registry, () => this.#buildContext(ownerWs))
  }

  /* ---------------------------------------------------------------- *
   * The endpoint → workstream resolvers
   * ---------------------------------------------------------------- */

  /** The plan index's endpoint resolver (TASK/GATE/MILESTONE membership;
   *  a WORKSTREAM endpoint resolves to itself when the workstream is in
   *  the index). Used by the pre-check's `externalWorkstream` option. */
  #externalWorkstream(): (kind: string, id: string) => string | undefined {
    const plans = this.#plans
    return (kind: string, id: string): string | undefined => {
      switch (kind) {
        case 'WORKSTREAM':
          return plans.workstreams.some((ws) => ws.id === id) ? id : undefined
        case 'TASK':
          return plans.workstreams.find((ws) => ws.taskIds.includes(id))?.id
        case 'GATE':
          return plans.workstreams.find((ws) => ws.gateIds.includes(id))?.id
        case 'MILESTONE':
          return plans.workstreams.find((ws) => ws.milestoneIds.includes(id))?.id
        default:
          return undefined
      }
    }
  }

  /** The §8 owner rule, STATE-LOCAL half — a verbatim mirror of the
   *  reducer's `endpointWorkstream` (WORKSTREAM → itself, CLAIM/FACT/
   *  ARTIFACT → the derived row, everything else `undefined`). The fold
   *  REJECTS any event whose `ownerWorkstreamId` differs from this value
   *  (reducer RELATION_ADDED/RELATION_REMOVED owner check), so the service
   *  MUST derive the owner from this half first; the plan-index fallback
   *  (`#wsOfRef`) is only consulted when the local half resolves nothing
   *  (then the fold performs no owner check at all). */
  #endpointWsLocal(ref: SemanticEndpointRef, state: SemanticState): string | undefined {
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

  /** Resolve one endpoint to its workstream: WORKSTREAM → itself (when
   *  known), CLAIM/FACT/ARTIFACT → the derived row, TASK/GATE/MILESTONE
   *  → the plan index; `undefined` = not workstream-local / not found. */
  #wsOfRef(ref: SemanticEndpointRef, state: SemanticState): string | undefined {
    switch (ref.kind) {
      case 'WORKSTREAM':
        return this.#plans.workstreams.some((ws) => ws.id === ref.id) ? ref.id : undefined
      case 'CLAIM':
        return state.claims.get(ref.id)?.workstream_id
      case 'FACT':
        return state.facts.get(ref.id)?.workstream_id
      case 'ARTIFACT':
        return state.artifacts.get(ref.id)?.workstream_id
      case 'TASK':
        return this.#plans.workstreams.find((ws) => ws.taskIds.includes(ref.id))?.id
      case 'GATE':
        return this.#plans.workstreams.find((ws) => ws.gateIds.includes(ref.id))?.id
      case 'MILESTONE':
        return this.#plans.workstreams.find((ws) => ws.milestoneIds.includes(ref.id))?.id
      default:
        return undefined
    }
  }

  /* ---------------------------------------------------------------- *
   * The owner-log fold (RELATION_ADDED sets, RELATION_REMOVED marks) —
   * the canonical dependency pattern: the §5.5 stored-edge recovery for
   * the remove mirror.
   * ---------------------------------------------------------------- */

  #foldOwnerRelations(ownerWs: string): Map<string, StoredEdge> {
    const edges = new Map<string, StoredEdge>()
    for (const ev of this.#store.listRange(ownerWs, 1)) {
      if (ev.eventType === 'RELATION_ADDED') {
        const p = isRecord(ev.payload) ? ev.payload : null
        if (p === null || typeof p.relation_id !== 'string' || typeof p.relation_type !== 'string') continue
        const source = asRef(p.source)
        const target = asRef(p.target)
        if (source === null || target === null) continue
        edges.set(p.relation_id, { status: 'ACTIVE', source, relationType: p.relation_type, target })
      } else if (ev.eventType === 'RELATION_REMOVED') {
        const p = isRecord(ev.payload) ? ev.payload : null
        if (p === null || typeof p.relation_id !== 'string') continue
        const prev = edges.get(p.relation_id)
        edges.set(p.relation_id, {
          status: 'REMOVED',
          source: asRef(p.source) ?? prev?.source ?? { kind: 'TASK', id: '' },
          relationType: typeof p.relation_type === 'string' ? p.relation_type : (prev?.relationType ?? 'RELATED_TO'),
          target: asRef(p.target) ?? prev?.target ?? { kind: 'TASK', id: '' },
        })
      }
    }
    return edges
  }
}
