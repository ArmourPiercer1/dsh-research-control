/**
 * WP-2.5 — the mechanical conflict flag (INV-SCI-2: 不做科学判断).
 *
 * ## What the frozen documents DO and DO NOT define
 *
 *  - DOMAIN_SCHEMA §7 defines NO conflict-marking rule (read in full: the
 *    only status machinery is ACTIVE/RETRACTED for claims);
 *  - DOMAIN_SCHEMA §8 defines the `CONTRADICTED_BY` relation type
 *    （「证据冲突（只记录，不推理）」）— a contradiction is a RECORDED EDGE,
 *    never a computed conclusion;
 *  - ARCHITECTURE §5.6 INV-SCI-2: the plugin does not judge claim
 *    correctness, does not auto-verify evidence, does not auto-detect
 *    conflicts, does not score credibility.
 *
 * ## The implemented marker (minimal 「待人工」, per the WP-2.5 boundary)
 *
 * A claim is flagged `PENDING_REVIEW` iff at least one ACTIVE relation row
 * names it as the SOURCE of a `CONTRADICTED_BY` edge. The flag is a pure
 * function of (claim status, active relation edges) — recomputed from
 * scratch whenever claims or relations change — and reads NO statement
 * content (the mechanical nature is pinned by `tests/semantics/conflict.test.ts`:
 * identical statements get flagged, contradicting statements do not, when
 * the edges say so / don't).
 *
 * Flag lifecycle (all mechanical):
 *  - set:      RELATION_ADDED with type CONTRADICTED_BY and an ACTIVE source claim;
 *  - cleared:  the edge is REMOVED (RELATION_REMOVED) or the claim is
 *              RETRACTED (a retracted claim needs no human review).
 *
 * Pure function (zero I/O).
 */

import type { ConflictFlag, RelationRow, SemanticState } from './types.js'

/** The single source relation type that triggers the flag (§8 CONTRADICTED_BY). */
export const CONFLICT_EDGE_TYPE = 'CONTRADICTED_BY' as const

/**
 * Derive the conflict flags for ALL claims from the current (claims,
 * relations) — the pure derivation the reducer re-runs after every
 * claim/relation change. Deterministic: `relationIds` sorted, claims
 * visited in map (insertion) order.
 *
 * A claim is flagged iff:
 *  - its row exists and is ACTIVE (RETRACTED claims are cleared), and
 *  - ≥1 ACTIVE relation has `source = (CLAIM, claim.id)` and
 *    `relation_type = CONTRADICTED_BY`.
 */
export function deriveConflictFlags(state: Pick<SemanticState, 'claims' | 'relations'>): ReadonlyMap<string, ConflictFlag> {
  // index the active contradiction edges by source claim id (single pass).
  const bySource = new Map<string, string[]>()
  for (const row of state.relations.values()) {
    if (row.status === 'ACTIVE' && row.relation_type === CONFLICT_EDGE_TYPE && row.source.kind === 'CLAIM') {
      const ids = bySource.get(row.source.id)
      if (ids === undefined) bySource.set(row.source.id, [row.id])
      else ids.push(row.id)
    }
  }

  const flags = new Map<string, ConflictFlag>()
  for (const [claimId, claim] of state.claims) {
    if (claim.status !== 'ACTIVE') continue
    const edges = bySource.get(claimId)
    if (edges === undefined || edges.length === 0) continue
    flags.set(claimId, { kind: 'PENDING_REVIEW', relationIds: [...edges].sort() })
  }
  return flags
}

/** The flag of one claim under the current state (`undefined` = unflagged). */
export function conflictFlagOf(state: SemanticState, claimId: string): ConflictFlag | undefined {
  return state.conflict.get(claimId)
}

/** True iff the claim currently carries the PENDING_REVIEW flag. */
export function isConflictPendingReview(state: SemanticState, claimId: string): boolean {
  return state.conflict.has(claimId)
}

/**
 * The relation rows that currently flag `claimId` (defensive view over the
 * derived `conflict` map cross-checked against the ACTIVE rows — always
 * consistent because the flag is derived from exactly these rows).
 */
export function conflictEdgesOf(state: SemanticState, claimId: string): readonly RelationRow[] {
  const out: RelationRow[] = []
  for (const row of state.relations.values()) {
    if (row.status === 'ACTIVE' && row.relation_type === CONFLICT_EDGE_TYPE && row.source.kind === 'CLAIM' && row.source.id === claimId) {
      out.push(row)
    }
  }
  return out
}
