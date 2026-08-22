/**
 * WP-2.2 — the DOMAIN_SCHEMA §8 RelationType combination table (frozen
 * engineering default; 「扩展需 bump schema-version」).
 *
 * Encodes the direction norm (INV-REL-1/2): only direct `RELY_ON`-form edges
 * are persisted and TARGET is always the premise/source/input/evidence/
 * superordinate goal of SOURCE. The validator consults this table for
 * RELATION_ADDED (`(source.kind → target.kind)` must be listed for the
 * relation_type; RELATED_TO is 任意→任意); RELATION_REMOVED re-checks nothing
 * combination-wise (the edge was validated when added) but does verify the
 * recorded endpoints match the existing relation (audit redundancy, §5.5).
 *
 * 「禁止同边反向重复」 (INV-REL-2): reverse forms (SUPPORTS, PRODUCES, …) do
 * not exist as relation types in the frozen 10-type set, so a reversed edge
 * can only be persisted as a different (source, target) pair — uniqueness is
 * the store's UNIQUE constraint, not this table's concern.
 *
 * Pure data (zero I/O).
 */

import type { ObjectKind, RelationType } from './types.js'

/** One row of the §8 combination table. */
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

/** The frozen §8 组合表, one row per relation type. */
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

/** True iff `source.kind → target.kind` is a listed combination for `relationType`. */
export function isLegalRelationCombination(
  relationType: RelationType,
  sourceKind: ObjectKind,
  targetKind: ObjectKind,
): boolean {
  const row = RELATION_COMBINATION_TABLE[relationType]
  return row.sources.includes(sourceKind) && row.targets.includes(targetKind)
}
