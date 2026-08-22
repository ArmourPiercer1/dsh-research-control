/**
 * Frozen ID contract types — DOMAIN_SCHEMA.md §1.1 (ID 规范, L12-52) and
 * §1.3 (公共结构, L84-95).
 *
 * WP-1.6 boundary: this file is pure types only — no imports, no I/O, no DSH
 * packages (the shared face must import nothing I/O or DSH; the
 * `src/shared/ids/**` surface is pure types + pure functions).
 *
 * Machine-readable twins (frozen `schema/`, read-only):
 *   - `common.schema.json#/$defs/objectKind` — the 24 referable kinds;
 *   - `common.schema.json#/$defs/id<Name>`   — all 25 prefixes,
 *     each `^<PREFIX>-[1-9][0-9]*$` (identical to §1.1's format regex).
 */

/**
 * §1.3 `ObjectKind` (L89-95) — the 24 referable object kinds, i.e. the
 * `TypedRef.kind` union. Re-declared here (field-for-field with the frozen
 * union) because the shared face may not import DSH packages and the domain
 * model owning type materializes in a later WP (WP-1.1 loader) — this
 * re-declaration is the shared-level single source of truth for ID parsing
 * and construction.
 */
export type ObjectKind =
  | 'PROJECT' | 'TOPIC' | 'WORKSTREAM' | 'TASK' | 'GATE' | 'MILESTONE' | 'RUN'
  | 'CLAIM' | 'FACT' | 'ARTIFACT' | 'RELATION' | 'OBJECTIVE' | 'INTERVENTION'
  | 'NEXT_ACTION' | 'BLOCKER' | 'INTERACTION' | 'REPORTING_ITEM'
  | 'SCHEDULED_EVENT' | 'INBOX_ITEM' | 'PLAN_FORK' | 'TOPOLOGY_EDGE'
  | 'DISCOVERED_SESSION' | 'HISTORY_EVENT' | 'ANALYSIS_RECORD'

/**
 * The 25 ID kinds — one per row of the frozen §1.1 prefix registry (L18-44).
 *
 * The 24-vs-25 asymmetry: `MANAGEMENT_ACTION` (§12.1 provenance) carries the
 * `MA` prefix (§1.1 row 24) but is NOT in the §1.3 `ObjectKind` union — it is
 * recorded, never the target of a `TypedRef`. The frozen schema mirrors this:
 * `objectKind` has 24 values while `idManagementAction` exists as a pattern.
 */
export type IdKind = ObjectKind | 'MANAGEMENT_ACTION'

/**
 * Uniqueness scope — §1.1 registry column 唯一性范围:
 *   - `GLOBAL`  = 插件安装内全局 (Project only);
 *   - `PROJECT` = Project 内 (all other 24 kinds; HistoryEvent's
 *     「单调递增」 note reinforces the monotonic counter, it does not
 *     change the scope).
 */
export type UniquenessScope = 'GLOBAL' | 'PROJECT'
