/**
 * WP-2.5 — semantic event pre-validation against the derived semantic state
 * (the incremental-maintenance gate).
 *
 * ## Role in the write path
 *
 * `validateEvent` (WP-2.2) validates an event against a FULL
 * `HistoryObjectContext` snapshot (11 object families). This function
 * validates the SEVEN semantic events against the derived `SemanticState`
 * ALONE — plus an optional external resolver for non-semantic workstream-
 * local endpoints (TASK/GATE/MILESTONE/RUN). The service layer composes:
 *
 *   1. `registry.checkShape(event)`        — frozen envelope + payload shape (INV-HIST-4);
 *   2. `validateSemanticEvent(state, event)` — this module: the §5.3–5.5
 *      preconditions + the §8/INV-REL rule family (the rules WP-2.2 does
 *      NOT check: duplicate 5-tuple, self-loop, reverse duplicate, owner);
 *   3. `validateEvent(registry, event, fullCtx)` — cross-family checks
 *      (run/task existence, emitter matrix, mutation from→to for the task
 *      events, …);
 *   4. store append (WP-2.1) + `reduceSemanticEvent` (derived state).
 *
 * Pure: reads `state` only, never writes, collects ALL errors (no
 * short-circuit beyond the unknown-type/invalid-envelope boundary).
 * Zero I/O, zero DSH (INV-PERM-5).
 */

import { parseId } from '../../../shared/ids/index.js'
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
import {
  ARTIFACT_TYPES,
  isArtifactType,
  SemanticDomainError,
  type SemanticErrorCode,
  type SemanticState,
  type SemanticValidationResult,
  type SemanticValidationError,
  type SemanticTypedRef,
} from './types.js'
import { SEMANTIC_EVENT_TYPES } from './reducer.js'
import type { SemanticInputEvent } from './types.js'

/**
 * Options for `validateSemanticEvent`.
 * `externalWorkstream` resolves the owner workstream of NON-semantic
 * workstream-local endpoints (kind TASK/GATE/MILESTONE/RUN, or a WORKSTREAM
 * ref whose existence must be checked). The service adapts its
 * `HistoryObjectContext` (workstreams/tasks/gates/milestones/runs) to this
 * one function; without it, non-semantic endpoints are treated as
 * UNRESOLVABLE for the owner rule (documented under the rule family below).
 */
export interface SemanticValidateOptions {
  readonly externalWorkstream?: (kind: string, id: string) => string | undefined
}

/**
 * Validate ONE semantic event against the current derived semantic state.
 * Returns a structured result (never throws; an invalid `event` reference
 * itself — not an object / no string eventType — is reported, not raised).
 */
export function validateSemanticEvent(
  state: SemanticState,
  event: SemanticInputEvent,
  options: SemanticValidateOptions = {},
): SemanticValidationResult {
  if (typeof event !== 'object' || event === null || typeof event.eventType !== 'string') {
    return { ok: false, errors: [{ code: 'UNKNOWN_EVENT_TYPE', path: '/eventType', message: `event must be an object with a string eventType (got ${JSON.stringify(event)})` }] }
  }
  const errors: SemanticValidationError[] = []
  const push = (code: SemanticErrorCode, message: string, path?: string): void => {
    errors.push({ code, path, message })
  }

  // -- envelope (semantic boundary) ------------------------------------
  const owner = event.ownerWorkstreamId
  if (typeof owner !== 'string' || parseId(owner)?.kind !== 'WORKSTREAM') {
    push('INVALID_ENVELOPE', `ownerWorkstreamId must be a well-formed WS id (got ${JSON.stringify(owner)})`, '/ownerWorkstreamId')
  }
  if (typeof event.occurredAt !== 'number' || !Number.isInteger(event.occurredAt) || event.occurredAt < 0) {
    push('INVALID_ENVELOPE', `occurredAt must be a non-negative integer epoch ms (got ${JSON.stringify(event.occurredAt)})`, '/occurredAt')
  }
  const actor = event.actor
  if (typeof actor !== 'object' || actor === null || typeof (actor as { kind?: unknown }).kind !== 'string' || !['USER', 'AGENT', 'PLUGIN', 'SYSTEM'].includes((actor as { kind: string }).kind)) {
    push('INVALID_ENVELOPE', `actor must be a well-formed actorRef with kind ∈ USER|AGENT|PLUGIN|SYSTEM (got ${JSON.stringify(actor)})`, '/actor')
  }

  if (!SEMANTIC_EVENT_TYPES.includes(event.eventType)) {
    push(
      'UNKNOWN_EVENT_TYPE',
      `${event.eventType} is not one of the seven semantic events (${SEMANTIC_EVENT_TYPES.join(' / ')})`,
      '/eventType',
    )
    return { ok: false, errors }
  }

  const external = options.externalWorkstream
  const wsOf = (ref: SemanticTypedRef): string | undefined => {
    switch (ref.kind) {
      case 'WORKSTREAM':
        return external?.('WORKSTREAM', ref.id) ?? ref.id
      case 'CLAIM':
        return state.claims.get(ref.id)?.workstream_id
      case 'FACT':
        return state.facts.get(ref.id)?.workstream_id
      case 'ARTIFACT':
        return state.artifacts.get(ref.id)?.workstream_id
      default:
        return external?.(ref.kind, ref.id)
    }
  }
  const ownerOfEdge = (source: SemanticTypedRef, target: SemanticTypedRef): string | undefined => wsOf(source) ?? wsOf(target)
  const checkOwner = (label: string, edgeOwner: string | undefined, path: string): void => {
    if (edgeOwner === undefined) {
      push('OWNER_UNRESOLVABLE', `Neither ${label} endpoint is workstream-local; V1 refuses such relations (DOMAIN_SCHEMA §8: 两端都非 workstream-local 的 relation 拒绝创建)`, path)
    } else if (typeof owner === 'string' && edgeOwner !== owner) {
      push('OWNER_MISMATCH', `${label} owner must be source.ws ?? target.ws = ${edgeOwner}, not the event owner ${owner} (DOMAIN_SCHEMA §8 / catalog §4 特例)`, path)
    }
  }

  switch (event.eventType) {
    case 'FACT_RECORDED': {
      const p = event.payload as Record<string, unknown> | undefined
      const id = p?.fact_id
      if (typeof id !== 'string' || parseId(id)?.kind !== 'FACT') {
        push('INVALID_ID', `fact_id must be a well-formed F-<n> id (got ${JSON.stringify(id)})`, '/payload/fact_id')
      } else if (state.facts.has(id)) {
        push('OBJECT_ALREADY_EXISTS', `Fact ${JSON.stringify(id)} already exists; FACT_RECORDED requires a fresh fact_id (catalog §5.3: 新建)`, '/payload/fact_id')
      }
      if (typeof p?.statement !== 'string' || p.statement.length === 0) {
        push('INVALID_PAYLOAD', 'statement must be a non-empty string (schema minLength 1)', '/payload/statement')
      }
      break
    }
    case 'CLAIM_RECORDED': {
      const p = event.payload as Record<string, unknown> | undefined
      const id = p?.claim_id
      if (typeof id !== 'string' || parseId(id)?.kind !== 'CLAIM') {
        push('INVALID_ID', `claim_id must be a well-formed C-<n> id (got ${JSON.stringify(id)})`, '/payload/claim_id')
      } else if (state.claims.has(id)) {
        push('OBJECT_ALREADY_EXISTS', `Claim ${JSON.stringify(id)} already exists; CLAIM_RECORDED requires a fresh claim_id (catalog §5.3: 新建)`, '/payload/claim_id')
      }
      if (typeof p?.statement !== 'string' || p.statement.length === 0) {
        push('INVALID_PAYLOAD', 'statement must be a non-empty string (schema minLength 1)', '/payload/statement')
      }
      break
    }
    case 'CLAIM_RETRACTED': {
      const p = event.payload as Record<string, unknown> | undefined
      const id = p?.claim_id
      if (typeof id !== 'string' || parseId(id)?.kind !== 'CLAIM') {
        push('INVALID_ID', `claim_id must be a well-formed C-<n> id (got ${JSON.stringify(id)})`, '/payload/claim_id')
        break
      }
      const claim = state.claims.get(id)
      if (claim === undefined) {
        push('OBJECT_NOT_FOUND', `Claim ${JSON.stringify(id)} does not exist (catalog §5.3: 存在)`, '/payload/claim_id')
      } else {
        if (claim.status !== 'ACTIVE') {
          push('WRONG_STATE', `Claim ${id} is ${claim.status}; CLAIM_RETRACTED requires ACTIVE (RETRACTED is terminal, §13)`, '/payload/claim_id')
        }
        if (claim.workstream_id !== owner) {
          push('OWNER_MISMATCH', `Claim ${id} belongs to workstream ${claim.workstream_id}, not the event owner ${owner} (catalog §4: claim 所属 WS)`, '/payload/claim_id')
        }
      }
      break
    }
    case 'ARTIFACT_REGISTERED': {
      const p = event.payload as Record<string, unknown> | undefined
      const id = p?.artifact_id
      if (typeof id !== 'string' || parseId(id)?.kind !== 'ARTIFACT') {
        push('INVALID_ID', `artifact_id must be a well-formed A-<n> id (got ${JSON.stringify(id)})`, '/payload/artifact_id')
      } else if (state.artifacts.has(id)) {
        push('OBJECT_ALREADY_EXISTS', `Artifact ${JSON.stringify(id)} already exists; ARTIFACT_REGISTERED requires a fresh artifact_id (catalog §5.4: 新建)`, '/payload/artifact_id')
      }
      if (typeof p?.title !== 'string' || p.title.length === 0) push('INVALID_PAYLOAD', 'title must be a non-empty string', '/payload/title')
      if (typeof p?.uri !== 'string' || p.uri.length === 0) push('INVALID_PAYLOAD', 'uri must be a non-empty string', '/payload/uri')
      if (!isArtifactType(p?.type)) {
        push('INVALID_PAYLOAD', `type must be one of the frozen artifactType enum [${ARTIFACT_TYPES.join(', ')}] (common.schema.json)`, '/payload/type')
      }
      const supersedes = p?.supersedes
      if (supersedes !== undefined) {
        if (typeof supersedes !== 'string' || parseId(supersedes)?.kind !== 'ARTIFACT') {
          push('INVALID_ID', `supersedes must be a well-formed A-<n> id (got ${JSON.stringify(supersedes)})`, '/payload/supersedes')
        } else if (!state.artifacts.has(supersedes)) {
          push('OBJECT_NOT_FOUND', `supersedes artifact ${JSON.stringify(supersedes)} does not exist (catalog §5.4: supersedes 存在)`, '/payload/supersedes')
        }
      }
      const relatedTask = p?.related_task
      if (relatedTask !== undefined && external !== undefined) {
        if (typeof relatedTask !== 'string' || parseId(relatedTask)?.kind !== 'TASK') {
          push('INVALID_ID', `related_task must be a well-formed T-<n> id (got ${JSON.stringify(relatedTask)})`, '/payload/related_task')
        } else {
          const ws = external('TASK', relatedTask)
          if (ws === undefined) {
            push('OBJECT_NOT_FOUND', `related task ${JSON.stringify(relatedTask)} does not exist (catalog §5.4)`, '/payload/related_task')
          } else if (typeof owner === 'string' && ws !== owner) {
            push('OWNER_MISMATCH', `related task ${relatedTask} belongs to workstream ${ws}, not the event owner ${owner} (catalog §5.4: 属同 WS)`, '/payload/related_task')
          }
        }
      }
      break
    }
    case 'ARTIFACT_MARKED_MISSING': {
      const p = event.payload as Record<string, unknown> | undefined
      const id = p?.artifact_id
      if (typeof id !== 'string' || parseId(id)?.kind !== 'ARTIFACT') {
        push('INVALID_ID', `artifact_id must be a well-formed A-<n> id (got ${JSON.stringify(id)})`, '/payload/artifact_id')
        break
      }
      const artifact = state.artifacts.get(id)
      if (artifact === undefined) {
        push('OBJECT_NOT_FOUND', `Artifact ${JSON.stringify(id)} does not exist (catalog §5.4: 存在)`, '/payload/artifact_id')
      } else {
        if (artifact.status !== 'REGISTERED') {
          push('WRONG_STATE', `Artifact ${id} is ${artifact.status}; ARTIFACT_MARKED_MISSING requires REGISTERED (catalog §5.4)`, '/payload/artifact_id')
        }
        if (artifact.workstream_id !== owner) {
          push('OWNER_MISMATCH', `Artifact ${id} belongs to workstream ${artifact.workstream_id}, not the event owner ${owner} (catalog §4: artifact 所属 WS)`, '/payload/artifact_id')
        }
      }
      break
    }
    case 'RELATION_ADDED': {
      const p = event.payload as Record<string, unknown> | undefined
      const id = p?.relation_id
      if (typeof id !== 'string' || parseId(id)?.kind !== 'RELATION') {
        push('INVALID_ID', `relation_id must be a well-formed REL-<n> id (got ${JSON.stringify(id)}; DOMAIN_SCHEMA §8 relation_id 形态)`, '/payload/relation_id')
      } else if (state.relations.has(id)) {
        push('OBJECT_ALREADY_EXISTS', `Relation ${JSON.stringify(id)} already exists; RELATION_ADDED requires a fresh relation_id (catalog §5.5: 新建)`, '/payload/relation_id')
      }
      const type = p?.relation_type
      if (isForbiddenReverseForm(type)) {
        push('RELATION_TYPE_UNKNOWN', `${String(type)} is a reverse form refused by §8 (INV-REL-2: only RELY_ON direct edges are persisted)`, '/payload/relation_type')
        break
      }
      if (!isRelationType(type)) {
        push('RELATION_TYPE_UNKNOWN', `${JSON.stringify(type)} is not one of the frozen 10 relation types (DOMAIN_SCHEMA §8, INV-REL-3)`, '/payload/relation_type')
        break
      }
      const source = p?.source
      const target = p?.target
      if (!isWellFormedRef(source)) {
        push('INVALID_PAYLOAD', `source must be a well-formed {kind ∈ objectKind, id} typedRef (got ${JSON.stringify(source)})`, '/payload/source')
      }
      if (!isWellFormedRef(target)) {
        push('INVALID_PAYLOAD', `target must be a well-formed {kind ∈ objectKind, id} typedRef (got ${JSON.stringify(target)})`, '/payload/target')
      }
      if (isWellFormedRef(source) && isWellFormedRef(target)) {
        if (!isLegalRelationCombination(type, source.kind, target.kind)) {
          push(
            'RELATION_COMBINATION',
            `${type} from ${source.kind} to ${target.kind} is not in the frozen §8 combination table (INV-REL-1: TARGET 始终是 SOURCE 的前提/来源/输入/证据/上位目标)`,
            '/payload/relation_type',
          )
        }
        if (isSelfLoop(source, target)) {
          push('RELATION_SELF_LOOP', `source and target are the same object (${source.kind} ${source.id}); a RELY_ON premise cannot be itself (INV-REL-1)`, '/payload/source')
        }
        const dup = findDuplicateEdge(state.relations, source, type, target)
        if (dup !== undefined) {
          push('RELATION_DUPLICATE', `An edge with the same 5-tuple already exists as relation ${dup.id} (DOMAIN_SCHEMA §8 唯一性 / §15 UNIQUE)`, '/payload/source')
        }
        const rev = findReverseDuplicateEdge(state.relations, source, type, target)
        if (rev !== undefined) {
          push('RELATION_REVERSE_DUPLICATE', `The same edge in reverse already exists as relation ${rev.id} (DOMAIN_SCHEMA §8: 禁止同边反向重复)`, '/payload/source')
        }
        checkOwner(`relation ${id}`, ownerOfEdge(source, target), '/ownerWorkstreamId')
      }
      break
    }
    case 'RELATION_REMOVED': {
      const p = event.payload as Record<string, unknown> | undefined
      const id = p?.relation_id
      if (typeof id !== 'string' || parseId(id)?.kind !== 'RELATION') {
        push('INVALID_ID', `relation_id must be a well-formed REL-<n> id (got ${JSON.stringify(id)})`, '/payload/relation_id')
        break
      }
      const relation = state.relations.get(id)
      if (relation === undefined) {
        push('OBJECT_NOT_FOUND', `Relation ${JSON.stringify(id)} does not exist (catalog §5.5: 存在)`, '/payload/relation_id')
        break
      }
      if (relation.status !== 'ACTIVE') {
        push('WRONG_STATE', `Relation ${id} is ${relation.status}; RELATION_REMOVED requires ACTIVE (REMOVED is terminal, §8)`, '/payload/relation_id')
      }
      const source = p?.source
      const target = p?.target
      const type = p?.relation_type
      if (!isWellFormedRef(source) || !isWellFormedRef(target) || typeof type !== 'string') {
        push('INVALID_PAYLOAD', 'source/target must be well-formed typedRefs and relation_type a string (audit redundancy, catalog §5.5)', '/payload/source')
      } else if (!sameRef(source, relation.source) || type !== relation.relation_type || !sameRef(target, relation.target)) {
        push(
          'RELATION_ENDPOINT_MISMATCH',
          `Recorded source/relation_type/target must match the existing relation (catalog §5.5 audit redundancy); stored: source=${JSON.stringify(relation.source)} relation_type=${relation.relation_type} target=${JSON.stringify(relation.target)}`,
          '/payload/source',
        )
      }
      checkOwner(`relation ${id}`, ownerOfEdge(relation.source, relation.target), '/ownerWorkstreamId')
      break
    }
    default:
      break // unreachable: SEMANTIC_EVENT_TYPES filter above
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

/* ------------------------------------------------------------------ *
 * Rejection-code catalogue (for tests / docs: the INV-REL-* → code map)
 * ------------------------------------------------------------------ */

/**
 * The INV-REL-* invariants as reject codes (ARCHITECTURE §5.7 → this module):
 *  - INV-REL-1 → RELATION_COMBINATION + RELATION_SELF_LOOP;
 *  - INV-REL-2 → RELATION_TYPE_UNKNOWN (reverse forms) + RELATION_REVERSE_DUPLICATE
 *                (+ structural: SemanticState stores direct edges only, the
 *                reverse view is derived — `reverseView` in relations.ts);
 *  - INV-REL-3 → RELATION_TYPE_UNKNOWN (non-10 types);
 *  - §8 唯一性/§15 → RELATION_DUPLICATE.
 * INV-REL-4 (no scientific reasoning along the graph) is a design constraint:
 * this module exposes NO inference API.
 */
export const INV_REL_CODE_MAP: Readonly<Record<string, readonly SemanticErrorCode[]>> = {
  'INV-REL-1': ['RELATION_COMBINATION', 'RELATION_SELF_LOOP'],
  'INV-REL-2': ['RELATION_TYPE_UNKNOWN', 'RELATION_REVERSE_DUPLICATE'],
  'INV-REL-3': ['RELATION_TYPE_UNKNOWN'],
}

/**
 * Convert a thrown `SemanticDomainError` (reducer fail-loud) into the
 * structured validation form — the single mapping the service layer uses to
 * surface fold failures with the same shape as validation errors.
 */
export function errorFromDomainError(error: SemanticDomainError): SemanticValidationResult {
  if (!(error instanceof SemanticDomainError)) {
    return { ok: false, errors: [{ code: 'INVALID_PAYLOAD', message: `unexpected error type: ${String(error)}` }] }
  }
  return { ok: false, errors: [{ code: error.code, path: error.path, message: error.message }] }
}
