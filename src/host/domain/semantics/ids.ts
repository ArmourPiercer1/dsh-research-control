/**
 * WP-2.5 — ID allocation seam for the four semantic registries.
 *
 * DOMAIN_SCHEMA §1.1 规则 2: ids are allocated by the plugin via
 * project-unique monotonic counters (shared/ids `IdAllocator` over an
 * injected `IdCounterPort`; the WP-2.1 sqlite `meta` table is the
 * persistence backend). The §1.1 prefix registry assigns each semantic
 * family its allocation point — exactly the four event families of this
 * module:
 *
 *   | prefix | kind     | allocated at      | §1.1 row / CATALOG event        |
 *   |--------|----------|-------------------|---------------------------------|
 *   | `C`    | CLAIM    | 记录 Claim        | CLAIM_RECORDED (catalog §5.3)   |
 *   | `F`    | FACT     | 记录 Fact         | FACT_RECORDED (catalog §5.3)    |
 *   | `A`    | ARTIFACT | 注册 Artifact     | ARTIFACT_REGISTERED (§5.4)      |
 *   | `REL`  | RELATION | 添加 Relation     | RELATION_ADDED (§5.5)           |
 *
 * The `REL` prefix produces the §8 `relation_id` 形态 (`REL-<n>`,
 * common.schema `idRelation` pattern `^REL-[1-9][0-9]*$`) via the same
 * allocator — no separate id scheme.
 *
 * ## Service-layer protocol (reserve → append → commit)
 *
 *   1. `reserve = allocateSemanticId(allocator, 'CLAIM', projectId)` —
 *      burns the next sequence (monotonic, no reuse, §1.1 规则 1/3);
 *   2. build the event with `payload.claim_id = reserve.id`, validate
 *      (shape + `validateSemanticEvent` + `validateEvent`), append
 *      (store, WP-2.1) + `reduceSemanticEvent`;
 *   3. on success `allocator.commit(reserve)`; on failure
 *      `allocator.release(reserve)` (the sequence stays burned — a
 *      permanent gap, never a duplicate; shared/ids semantics).
 *
 * This module is a thin TYPED seam over shared/ids — it owns the
 * semantic-family → §1.1 kind mapping and nothing else (zero I/O).
 */

import { IdAllocator, type Reservation } from '../../../shared/ids/index.js'

/** The four semantic id families (their §1.1 IdKinds). */
export type SemanticIdKind = 'CLAIM' | 'FACT' | 'ARTIFACT' | 'RELATION'

/** The frozen set of semantic id families (shared/ids registry rows). */
export const SEMANTIC_ID_KINDS: readonly SemanticIdKind[] = ['CLAIM', 'FACT', 'ARTIFACT', 'RELATION']

/** True iff `value` is one of the four semantic id families. */
export function isSemanticIdKind(value: unknown): value is SemanticIdKind {
  return typeof value === 'string' && (SEMANTIC_ID_KINDS as readonly string[]).includes(value)
}

/** The §1.1 prefix each family allocates (C / F / A / REL). */
export const SEMANTIC_ID_PREFIXES: Readonly<Record<SemanticIdKind, string>> = {
  CLAIM: 'C',
  FACT: 'F',
  ARTIFACT: 'A',
  RELATION: 'REL',
}

/**
 * Reserve the next id of a semantic family via the shared/ids allocator
 * (per-project monotonic counter). Burns the sequence immediately — commit
 * or release the returned reservation exactly once (see module doc).
 *
 * @throws (from shared/ids) on a malformed `projectId` for PROJECT-scoped
 *   kinds (all four are PROJECT-scoped) or a corrupt counter backend.
 */
export function allocateSemanticId(allocator: IdAllocator, kind: SemanticIdKind, projectId: string): Reservation {
  if (!isSemanticIdKind(kind)) {
    throw new TypeError(`allocateSemanticId: unknown semantic id kind ${JSON.stringify(kind)} (expected one of ${SEMANTIC_ID_KINDS.join(' / ')})`)
  }
  return allocator.reserve(kind, projectId)
}
