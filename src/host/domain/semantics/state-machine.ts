/**
 * WP-2.5 — the §13/§7/§8 state machines of the four semantic registries.
 *
 * Frozen basis:
 *  - DOMAIN_SCHEMA §13 「状态机定义」（合法转换表）: claim（L556: ACTIVE →
 *    RETRACTED 终态）/ artifact（L557: REGISTERED ↔ MISSING，「MISSING 经事件
 *    标记; 找回经用户操作」）;
 *  - DOMAIN_SCHEMA §7 状态列: Claim `ACTIVE`/`RETRACTED`（撤销经 CLAIM_RETRACTED
 *    事件）; Fact 恒 `ACTIVE`（无状态机）; Artifact `REGISTERED`/`MISSING`
 *    （ARTIFACT_MARKED_MISSING 标记; 找回可恢复）;
 *  - DOMAIN_SCHEMA §8 状态列: Relation `ACTIVE`/`REMOVED`（RELATION_REMOVED 撤销）。
 *
 * ## Event coverage in V1 (HISTORY_EVENT_CATALOG §4/§5)
 *
 * The §13 table is WIDER than the event catalog (same relationship the
 * WP-2.2 `transitions.ts` documents for its machines):
 *  - claim:      ACTIVE → RETRACTED via CLAIM_RETRACTED (the only event);
 *  - fact:       NO machine — status is the const `ACTIVE` (§7.2 「恒 ACTIVE」);
 *  - artifact:   REGISTERED → MISSING via ARTIFACT_MARKED_MISSING (the only
 *                event). MISSING → REGISTERED (「找回经用户操作」) is LEGAL in
 *                §13 but has NO V1 HistoryEvent — unreachable through the
 *                reducer by construction (a service-level recovery operation
 *                would drive it later; `checkTransition` already accepts it);
 *  - relation:   ACTIVE → REMOVED via RELATION_REMOVED (the only event).
 *
 * Pure data + pure guards (zero I/O). `checkTransition` throws
 * `SemanticDomainError` (WRONG_STATE) on illegal pairs — the reducer and
 * the validator share this one guard, so the §13 table cannot drift between
 * the two paths.
 */

import {
  SemanticDomainError,
  type ArtifactStatus,
  type ClaimStatus,
  type RelationStatus,
} from './types.js'

/** The semantic machines that have a legal-transition table. */
export type SemanticMachine = 'claim' | 'artifact' | 'relation'

/**
 * The frozen legal-transition tables for the three stateful semantic
 * registries (key = machine → from → legal tos; terminal states → `[]`).
 * Fact has no machine (status const ACTIVE, §7.2) and is deliberately absent.
 */
export const SEMANTIC_TRANSITIONS: Readonly<
  Record<SemanticMachine, Readonly<Record<string, readonly string[]>>>
> = {
  // Claim (§13 L556 / §7.1): ACTIVE → RETRACTED (terminal).
  claim: {
    ACTIVE: ['RETRACTED'],
    RETRACTED: [],
  },
  // Artifact (§13 L557 / §7.3): REGISTERED ↔ MISSING. V1 event coverage:
  // only REGISTERED → MISSING (ARTIFACT_MARKED_MISSING); the reverse is
  // 「找回经用户操作」 (no V1 event — see module doc).
  artifact: {
    REGISTERED: ['MISSING'],
    MISSING: ['REGISTERED'],
  },
  // Relation (§8): ACTIVE → REMOVED (terminal; INV-HIST-7 — the row stays).
  relation: {
    ACTIVE: ['REMOVED'],
    REMOVED: [],
  },
}

/** The legal target states of `from` on `machine` (`[]` = terminal). */
export function legalTargets(machine: SemanticMachine, from: string): readonly string[] {
  return SEMANTIC_TRANSITIONS[machine][from] ?? []
}

/** True iff `from -> to` appears in the table for `machine` (same-state = illegal). */
export function isLegalTransition(machine: SemanticMachine, from: string, to: string): boolean {
  return legalTargets(machine, from).includes(to)
}

/**
 * Guard one transition. Throws `SemanticDomainError` (code WRONG_STATE) when
 * `to` is not in the legal set for `from` (including same-state no-ops, which
 * the table does not list). The message always names the machine, the CURRENT
 * state, the TARGET state, and the LEGAL SET (「terminal」 when empty).
 *
 * Returns void on success (the caller performs the row update).
 */
export function checkTransition(machine: SemanticMachine, objectId: string, from: string, to: string): void {
  const legal = legalTargets(machine, from)
  if (!legal.includes(to)) {
    const suffix = legal.length === 0 ? ` (${from} is terminal)` : ` (legal from ${from}: ${legal.join(' | ')})`
    throw new SemanticDomainError(
      'WRONG_STATE',
      `${machine} ${JSON.stringify(objectId)} is ${from}; transition to ${to} is not in the §13 legal table${suffix}`,
    )
  }
}

/**
 * The three typed transition checks the reducer / validator use (one per
 * stateful registry). Each throws WRONG_STATE on an illegal move.
 */
export function checkClaimTransition(claimId: string, from: ClaimStatus, to: ClaimStatus): void {
  checkTransition('claim', claimId, from, to)
}
export function checkArtifactTransition(artifactId: string, from: ArtifactStatus, to: ArtifactStatus): void {
  checkTransition('artifact', artifactId, from, to)
}
export function checkRelationTransition(relationId: string, from: RelationStatus, to: RelationStatus): void {
  checkTransition('relation', relationId, from, to)
}
