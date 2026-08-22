/**
 * WP-2.5 — the RELY_ON direction semantics: the INV-REL-1/2/3 rule family
 * (DOMAIN_SCHEMA §8; ARCHITECTURE §5.7), implemented as domain validation
 * rules over the relation registry.
 *
 * ## The rules
 *
 *  - **INV-REL-1** (S): Relations are uniformly RELY_ON — TARGET is always
 *    SOURCE's premise/source/input/evidence/superordinate goal. Mechanical
 *    encoding: the frozen §8 组合表 (one row per relation type listing the
 *    allowed `source.kind → target.kind` pairs) + the self-loop prohibition
 *    (a premise cannot be its own subject).
 *  - **INV-REL-2** (R+T): only DIRECT edges are persisted; no transitive
 *    closure, no reverse edges. Mechanical encoding: (a) the frozen 10-type
 *    set contains no reverse forms (`SUPPORTS` / `PRODUCES` / `REQUIRED_BY`
 *    / `VALIDATES` are NOT types — §8 「不保存的反向形式」), so a reversed
 *    fact cannot be persisted as a different type; (b) 「禁止同边反向重复」 —
 *    the one case where the reverse of a legal edge is itself expressible
 *    (RELATED_TO, the only symmetric type: A→B and B→A are the same weak
 *    association) is rejected; (c) the reverse view is DERIVED at query
 *    time (`reverseView` below) and never stored — `SemanticState` holds
 *    direct edges only, so no closure/reverse table can exist.
 *  - **INV-REL-3** (S): `relation_type` is limited to the frozen 10-type V1
 *    目录 (扩展需 bump schema-version) — `isRelationType`.
 *  - **Uniqueness** (§8 「唯一性」 + §15 `relation` 表
 *    `UNIQUE(source_kind, source_id, relation_type, target_kind, target_id)`):
 *    the 5-tuple identifies an edge; a second row with the same 5-tuple is
 *    rejected. The frozen §15 UNIQUE carries no status qualifier and rows
 *    are never hard-deleted (INV-HIST-7), so an edge whose row is REMOVED
 *    also blocks a re-add of the same 5-tuple — edges are one-shot
 *    identities, like claims (retract, never re-record).
 *
 * ## Domain ownership
 *
 * The WP-2.2 registry keeps its own copy of this table
 * (`history/registry/relations.ts`) because the registry validates
 * RELATION_ADDED at write time; `domain/` may not import `history/`
 * (ARCHITECTURE §2.2: `domain ← history`). Both copies encode the same
 * frozen §8 table and `tests/semantics/relations.test.ts` asserts they are
 * IDENTICAL (mechanical sync check — a drift in either copy fails the tree).
 *
 * Pure data + pure lookups (zero I/O).
 */

import type { ObjectKind } from '../../../shared/ids/index.js'
import {
  isRelationType,
  RELATION_TYPES,
  type RelationRow,
  type RelationType,
  type SemanticState,
  type SemanticTypedRef,
} from './types.js'

/** One row of the §8 组合表. */
export interface RelationCombinationRow {
  /** Allowed source kinds. */
  readonly sources: readonly ObjectKind[]
  /** Allowed target kinds. */
  readonly targets: readonly ObjectKind[]
}

/** All 24 object kinds (RELATED_TO is 任意 → 任意). */
const ALL_KINDS: readonly ObjectKind[] = [
  'PROJECT',
  'TOPIC',
  'WORKSTREAM',
  'TASK',
  'GATE',
  'MILESTONE',
  'RUN',
  'CLAIM',
  'FACT',
  'ARTIFACT',
  'RELATION',
  'OBJECTIVE',
  'INTERVENTION',
  'NEXT_ACTION',
  'BLOCKER',
  'INTERACTION',
  'REPORTING_ITEM',
  'SCHEDULED_EVENT',
  'INBOX_ITEM',
  'PLAN_FORK',
  'TOPOLOGY_EDGE',
  'DISCOVERED_SESSION',
  'HISTORY_EVENT',
  'ANALYSIS_RECORD',
]

/**
 * The frozen §8 组合表（工程默认；扩展需 bump schema-version）, one row per
 * relation type — field-for-field with DOMAIN_SCHEMA §8 L380-391.
 */
export const RELATION_COMBINATION_TABLE: Readonly<Record<RelationType, RelationCombinationRow>> = {
  DEPENDS_ON: { sources: ['TASK', 'GATE'], targets: ['TASK', 'GATE', 'MILESTONE'] },
  SUPPORTED_BY: { sources: ['CLAIM'], targets: ['FACT', 'ARTIFACT', 'CLAIM'] },
  CONTRADICTED_BY: { sources: ['CLAIM'], targets: ['FACT', 'CLAIM', 'ARTIFACT'] },
  DERIVED_FROM: { sources: ['FACT'], targets: ['ARTIFACT', 'FACT'] },
  PRODUCED_BY: { sources: ['ARTIFACT'], targets: ['RUN'] },
  VALIDATED_BY: { sources: ['GATE'], targets: ['FACT', 'ARTIFACT'] },
  CONSUMES: { sources: ['TASK', 'RUN'], targets: ['ARTIFACT'] },
  CONTRIBUTES_TO: { sources: ['TASK', 'WORKSTREAM', 'CLAIM'], targets: ['OBJECTIVE'] },
  IMPLEMENTS: { sources: ['TASK'], targets: ['OBJECTIVE', 'MILESTONE'] },
  RELATED_TO: { sources: ALL_KINDS, targets: ALL_KINDS },
}

/**
 * INV-REL-1/3: true iff `source.kind → target.kind` is a listed combination
 * for `relationType`. Unknown types (outside the frozen 10) are illegal here
 * as well (the row is undefined → false).
 */
export function isLegalRelationCombination(
  relationType: RelationType,
  sourceKind: ObjectKind,
  targetKind: ObjectKind,
): boolean {
  const row = RELATION_COMBINATION_TABLE[relationType]
  return row !== undefined && row.sources.includes(sourceKind) && row.targets.includes(targetKind)
}

/**
 * The reverse forms §8 refuses to persist (INV-REL-2 「不保存的反向形式」).
 * They are not members of the frozen 10-type set — this list exists so a
 * payload carrying one (e.g. a legacy `SUPPORTS`) is rejected with a precise
 * message naming the RELY_ON direction, not a generic type error.
 */
export const FORBIDDEN_REVERSE_FORMS: readonly string[] = ['SUPPORTS', 'PRODUCES', 'REQUIRED_BY', 'VALIDATES']

/** True iff `value` is one of the §8 reverse forms (INV-REL-2). */
export function isForbiddenReverseForm(value: unknown): boolean {
  return typeof value === 'string' && FORBIDDEN_REVERSE_FORMS.includes(value)
}

/* ------------------------------------------------------------------ *
 * Edge identity (the §8 5-tuple) + duplicate detection
 * ------------------------------------------------------------------ */

/** Structural equality of two typed refs. */
export function sameRef(a: SemanticTypedRef, b: SemanticTypedRef): boolean {
  return a.kind === b.kind && a.id === b.id
}

/**
 * The canonical §8 唯一性 key:
 * `(source.kind, source.id, relation_type, target.kind, target.id)`.
 */
export function relationEdgeKey(source: SemanticTypedRef, relationType: string, target: SemanticTypedRef): string {
  return `${source.kind}:${source.id}|${relationType}|${target.kind}:${target.id}`
}

/**
 * INV-REL-1: a self-loop (`source` === `target`) — the premise of a RELY_ON
 * edge cannot be the edge's own subject.
 */
export function isSelfLoop(source: SemanticTypedRef, target: SemanticTypedRef): boolean {
  return sameRef(source, target)
}

/**
 * Find an existing row (ANY status — §15 UNIQUE has no status qualifier)
 * carrying the SAME 5-tuple as the proposed edge. `undefined` = no duplicate.
 */
export function findDuplicateEdge(
  relations: ReadonlyMap<string, RelationRow>,
  source: SemanticTypedRef,
  relationType: string,
  target: SemanticTypedRef,
): RelationRow | undefined {
  const key = relationEdgeKey(source, relationType, target)
  for (const row of relations.values()) {
    if (relationEdgeKey(row.source, row.relation_type, row.target) === key) return row
  }
  return undefined
}

/**
 * §8 「禁止同边反向重复」: find an existing row (ANY status) carrying the
 * SAME edge in the REVERSE direction (target↔source, same type).
 *
 * Only meaningful for the symmetric type — RELATED_TO is the unique row of
 * the §8 table whose reverse direction is expressible within the frozen
 * 10-type set (A→B and B→A are the same weak association). For every other
 * type the reverse of a legal edge is a DIFFERENT fact (A DEPENDS_ON B and
 * B DEPENDS_ON A are both legal, distinct edges) and never returned.
 */
export function findReverseDuplicateEdge(
  relations: ReadonlyMap<string, RelationRow>,
  source: SemanticTypedRef,
  relationType: RelationType,
  target: SemanticTypedRef,
): RelationRow | undefined {
  if (relationType !== 'RELATED_TO') return undefined
  return findDuplicateEdge(relations, target, relationType, source)
}

/**
 * INV-REL-2 (query half): the reverse (incoming-edge) view of `ref` — the
 * ACTIVE relations whose TARGET is `ref`, i.e. 「who relies on ref」.
 * DERIVED at query time, never stored (no closure, no reverse table):
 * `SemanticState` holds direct edges only.
 */
export function reverseView(state: Pick<SemanticState, 'relations'>, ref: SemanticTypedRef): readonly RelationRow[] {
  const out: RelationRow[] = []
  for (const row of state.relations.values()) {
    if (row.status === 'ACTIVE' && sameRef(row.target, ref)) out.push(row)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * The frozen 10-type set (INV-REL-3) — convenience re-exports + guards
 * ------------------------------------------------------------------ */

export { isRelationType, RELATION_TYPES }
export type { RelationType }

/**
 * True iff `ref` is a well-formed typed ref for the row/edge checks:
 * a non-empty `id` string and one of the 24 frozen object kinds.
 */
export function isWellFormedRef(value: unknown): value is SemanticTypedRef {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { kind?: unknown; id?: unknown }
  return typeof v.kind === 'string' && typeof v.id === 'string' && v.id.length > 0 && isObjectKind(v.kind)
}

const ALL_KIND_SET: ReadonlySet<string> = new Set<string>(ALL_KINDS)

/** True iff `value` is one of the 24 frozen object kinds (common.schema `objectKind`). */
export function isObjectKind(value: unknown): value is ObjectKind {
  return typeof value === 'string' && ALL_KIND_SET.has(value)
}
