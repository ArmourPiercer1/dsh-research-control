/**
 * UI-7 (D4 / ADJ-11) — the `queryRecords` read path (D §13.4).
 *
 * A PURE in-memory filter over the DERIVED semantic state (the
 * `semantics:<projectId>` row): the History timeline and every `.research`
 * file read are FORBIDDEN sources for the Records list (ADJ-11; the
 * RECON R-13 client pin forbids `queryHistory` on the client side). This
 * function takes the already-read state and performs ZERO I/O:
 *
 *   - 7 filter dimensions: workstreamId, type, status, keyword
 *     (case-insensitive substring over statement/title ONLY),
 *     relatedObject, timeFrom, timeTo;
 *   - sort: `recorded_at` DESC, id ASC tiebreak (ADJ-11);
 *   - pagination: limit default 50 / cap 200, offset default 0;
 *   - `total` = the filtered count BEFORE pagination.
 *
 * The DTO `relations` array carries the ACTIVE edges touching the record
 * (outgoing + the derived reverse view — one entry per edge, sorted by
 * relation id for determinism). A claim's `conflictFlag` is the frozen
 * mechanical PENDING_REVIEW marker (derived state, never recomputed here).
 */

import type {
  ActorRefDoc,
  ArtifactRow,
  ClaimRow,
  ConflictFlag,
  FactRow,
  SemanticState,
} from '../../domain/semantics/types.js'
import type { QueryRecordsArgs, QueryRecordsResult } from './types.js'
import type { SemanticRecordDto } from '../../../shared/rpc-contracts.js'

/** The ADJ-11 pagination defaults (the wire schema caps limit at 200). */
export const QUERY_DEFAULT_LIMIT = 50
export const QUERY_MAX_LIMIT = 200

/** The DTO actor projection (`created_by` → {kind, label?}). */
function actorDto(a: ActorRefDoc | undefined): SemanticRecordDto['createdBy'] {
  if (a === undefined) return undefined
  return a.label === undefined ? { kind: a.kind } : { kind: a.kind, label: a.label }
}

/** The ACTIVE edges touching one record (out + in, sorted by relation id). */
function edgesFor(state: SemanticState, kind: 'CLAIM' | 'FACT' | 'ARTIFACT', id: string): SemanticRecordDto['relations'] {
  const out: SemanticRecordDto['relations'] = []
  for (const row of state.relations.values()) {
    if (row.status !== 'ACTIVE') continue
    if (row.source.kind === kind && row.source.id === id) {
      out.push({ relationId: row.id, relationType: row.relation_type, direction: 'out', other: { kind: row.target.kind, id: row.target.id } })
    } else if (row.target.kind === kind && row.target.id === id) {
      out.push({ relationId: row.id, relationType: row.relation_type, direction: 'in', other: { kind: row.source.kind, id: row.source.id } })
    }
  }
  return out.sort((a, b) => (a.relationId < b.relationId ? -1 : a.relationId > b.relationId ? 1 : 0))
}

/** One fact row → DTO (status const ACTIVE; ADJ-10). */
function factDto(state: SemanticState, row: FactRow): SemanticRecordDto {
  return {
    id: row.id,
    type: 'FACT',
    workstreamId: row.workstream_id,
    statement: row.statement,
    status: row.status,
    recordedAt: row.recorded_at,
    createdBy: actorDto(row.created_by),
    references: [...(row.references ?? [])],
    relations: edgesFor(state, 'FACT', row.id),
  }
}

/** One claim row → DTO (the conflictFlag is the derived PENDING_REVIEW marker). */
function claimDto(state: SemanticState, row: ClaimRow): SemanticRecordDto {
  const flag: ConflictFlag | undefined = state.conflict.get(row.id)
  return {
    id: row.id,
    type: 'CLAIM',
    workstreamId: row.workstream_id,
    statement: row.statement,
    status: row.status,
    recordedAt: row.recorded_at,
    createdBy: actorDto(row.created_by),
    references: [...(row.references ?? [])],
    relations: edgesFor(state, 'CLAIM', row.id),
    ...(flag !== undefined ? { conflictFlag: { kind: flag.kind, relationIds: [...flag.relationIds] } } : {}),
  }
}

/** One artifact row → DTO (BY REFERENCE — no statement; no created_by
 *  column on the frozen ArtifactRow shape, so the DTO omits it). */
function artifactDto(state: SemanticState, row: ArtifactRow): SemanticRecordDto {
  return {
    id: row.id,
    type: 'ARTIFACT',
    workstreamId: row.workstream_id,
    title: row.title,
    artifactType: row.type,
    uri: row.uri,
    status: row.status,
    recordedAt: row.recorded_at,
    references: [],
    relations: edgesFor(state, 'ARTIFACT', row.id),
  }
}

/** All derived rows → DTOs (facts, claims, artifacts — zero I/O). */
function toDtos(state: SemanticState): SemanticRecordDto[] {
  const out: SemanticRecordDto[] = []
  for (const row of state.facts.values()) out.push(factDto(state, row))
  for (const row of state.claims.values()) out.push(claimDto(state, row))
  for (const row of state.artifacts.values()) out.push(artifactDto(state, row))
  return out
}

/** `relatedObject` match: an ACTIVE edge to the object (either
 *  direction) OR a `references` entry naming it — the reference strings
 *  are free-form (ADJ-12 tool-facing), so both the bare id and the
 *  `KIND:ID` serialization match. */
function matchesRelated(r: SemanticRecordDto, ref: { readonly kind: string; readonly id: string }): boolean {
  if (r.relations.some((e) => e.other.kind === ref.kind && e.other.id === ref.id)) return true
  const qualified = `${ref.kind}:${ref.id}`
  return r.references.some((s) => s === ref.id || s === qualified)
}

/**
 * The full `queryRecords` semantics over one derived state (pure).
 * See the module header for the filter/sort/pagination rules.
 */
export function querySemanticRecords(state: SemanticState, args: QueryRecordsArgs): QueryRecordsResult {
  const keyword = args.keyword === undefined ? undefined : args.keyword.toLowerCase()
  const filtered = toDtos(state).filter((r) => {
    if (args.workstreamId !== undefined && r.workstreamId !== args.workstreamId) return false
    if (args.type !== undefined && r.type !== args.type) return false
    if (args.status !== undefined && r.status !== args.status) return false
    if (keyword !== undefined) {
      const hay = `${r.statement ?? ''} ${r.title ?? ''}`.toLowerCase()
      if (!hay.includes(keyword)) return false
    }
    if (args.relatedObject !== undefined && !matchesRelated(r, args.relatedObject)) return false
    if (args.timeFrom !== undefined && r.recordedAt < args.timeFrom) return false
    if (args.timeTo !== undefined && r.recordedAt > args.timeTo) return false
    return true
  })
  // ADJ-11 sort: recorded_at DESC, id ASC tiebreak.
  filtered.sort((a, b) => {
    if (a.recordedAt !== b.recordedAt) return b.recordedAt - a.recordedAt
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  const limit = Math.min(args.limit ?? QUERY_DEFAULT_LIMIT, QUERY_MAX_LIMIT)
  const offset = args.offset ?? 0
  return { records: filtered.slice(offset, offset + limit), total: filtered.length }
}
