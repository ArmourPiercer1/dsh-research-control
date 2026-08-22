/**
 * Frozen ID prefix registry — DOMAIN_SCHEMA.md §1.1 (L18-44), verbatim.
 *
 * All 25 prefixes, enumerated one-for-one with the §1.1 table rows (object,
 * example, uniqueness scope, allocation timing) plus the object's chapter
 * annotation (`section`). The table is FROZEN: adding a prefix requires
 * bumping `.research/schema-version` (§1.1 L16) — never extend this array
 * silently.
 *
 * Pure data + pure lookups (zero I/O, WP-1.6 boundary). Machine-readable
 * twin: `schema/common.schema.json#/$defs/id<Name>` (25 patterns).
 *
 * The `example` field copies the §1.1 示例 column, which the document marks
 * explanatory-not-normative (L6); it is kept as frozen data for traceability
 * and is smoke-checked by tests (each example must parse to its own kind).
 */

import type { IdKind, ObjectKind, UniquenessScope } from './types.js'

/** One row of the frozen §1.1 prefix registry. */
export interface IdPrefixEntry {
  /** 前缀 (§1.1 前缀 column), e.g. `TE`. */
  readonly prefix: string
  /** 对象 kind (§1.1 对象 column → `IdKind`). */
  readonly kind: IdKind
  /** §1.1 示例 column (explanatory per L6; frozen data here). */
  readonly example: string
  /** 唯一性范围 (§1.1): 插件安装内全局 → GLOBAL, Project 内 → PROJECT. */
  readonly scope: UniquenessScope
  /** 分配时机 (§1.1, documentation). */
  readonly allocatedAt: string
  /** 对象所属章节 (DOMAIN_SCHEMA.md / HISTORY_EVENT_CATALOG.md). */
  readonly section: string
}

/**
 * The 25 rows, in §1.1 table order (L20-44).
 *
 * Prefix-containment pairs present in the frozen set (the ones §1.1 rule 4's
 * 最长前缀优先 protects against): `T`⊂`TE`, `T`⊂`TPC`, `R`⊂`REL`,
 * `R`⊂`RPT`, `M`⊂`MA`, `A`⊂`AN`, `IN`⊂`INT` — hence the ambiguity samples
 * beyond the spec's `TE`/`T` and `INT`/`IN` (see tests/ids/parse.test.ts).
 */
export const ID_PREFIX_REGISTRY: readonly IdPrefixEntry[] = [
  // L20 — Project, 插件安装内全局
  { prefix: 'PRJ', kind: 'PROJECT', example: 'PRJ-1', scope: 'GLOBAL', allocatedAt: '创建 Project', section: 'DOMAIN_SCHEMA §2.1' },
  // L21 — Topic
  { prefix: 'TPC', kind: 'TOPIC', example: 'TPC-3', scope: 'PROJECT', allocatedAt: '创建 Topic', section: 'DOMAIN_SCHEMA §2.2' },
  // L22 — Workstream
  { prefix: 'WS', kind: 'WORKSTREAM', example: 'WS-12', scope: 'PROJECT', allocatedAt: '创建 Workstream', section: 'DOMAIN_SCHEMA §2.3' },
  // L23 — TopologyEdge（含前缀关系 T⊂TE）
  { prefix: 'TE', kind: 'TOPOLOGY_EDGE', example: 'TE-17', scope: 'PROJECT', allocatedAt: '创建拓扑边', section: 'DOMAIN_SCHEMA §3.1' },
  // L24 — PlanFork
  { prefix: 'PF', kind: 'PLAN_FORK', example: 'PF-17', scope: 'PROJECT', allocatedAt: 'Agent 创建 proposal', section: 'DOMAIN_SCHEMA §5（规则见 PLAN_FORK_SPEC.md）' },
  // L25 — Task
  { prefix: 'T', kind: 'TASK', example: 'T-17', scope: 'PROJECT', allocatedAt: '创建 Task 定义', section: 'DOMAIN_SCHEMA §4.1' },
  // L26 — Gate
  { prefix: 'G', kind: 'GATE', example: 'G-2', scope: 'PROJECT', allocatedAt: '创建 Gate 定义', section: 'DOMAIN_SCHEMA §4.2' },
  // L27 — Milestone
  { prefix: 'M', kind: 'MILESTONE', example: 'M-1', scope: 'PROJECT', allocatedAt: '创建 Milestone 定义', section: 'DOMAIN_SCHEMA §4.3' },
  // L28 — Run
  { prefix: 'R', kind: 'RUN', example: 'R-81', scope: 'PROJECT', allocatedAt: '注册 Run', section: 'DOMAIN_SCHEMA §6.1' },
  // L29 — Claim
  { prefix: 'C', kind: 'CLAIM', example: 'C-17', scope: 'PROJECT', allocatedAt: '记录 Claim', section: 'DOMAIN_SCHEMA §7.1' },
  // L30 — Fact
  { prefix: 'F', kind: 'FACT', example: 'F-31', scope: 'PROJECT', allocatedAt: '记录 Fact', section: 'DOMAIN_SCHEMA §7.2' },
  // L31 — Artifact
  { prefix: 'A', kind: 'ARTIFACT', example: 'A-9', scope: 'PROJECT', allocatedAt: '注册 Artifact', section: 'DOMAIN_SCHEMA §7.3' },
  // L32 — Relation
  { prefix: 'REL', kind: 'RELATION', example: 'REL-40', scope: 'PROJECT', allocatedAt: '添加 Relation', section: 'DOMAIN_SCHEMA §8' },
  // L33 — Objective
  { prefix: 'OBJ', kind: 'OBJECTIVE', example: 'OBJ-1', scope: 'PROJECT', allocatedAt: '创建 Objective', section: 'DOMAIN_SCHEMA §9.1' },
  // L34 — Intervention
  { prefix: 'IV', kind: 'INTERVENTION', example: 'IV-5', scope: 'PROJECT', allocatedAt: '创建 Intervention', section: 'DOMAIN_SCHEMA §9.2' },
  // L35 — NextAction
  { prefix: 'NA', kind: 'NEXT_ACTION', example: 'NA-2', scope: 'PROJECT', allocatedAt: '创建 NextAction', section: 'DOMAIN_SCHEMA §9.3' },
  // L36 — Blocker
  { prefix: 'BLK', kind: 'BLOCKER', example: 'BLK-3', scope: 'PROJECT', allocatedAt: '创建 Blocker', section: 'DOMAIN_SCHEMA §9.4' },
  // L37 — Interaction（含前缀关系 IN⊂INT）
  { prefix: 'INT', kind: 'INTERACTION', example: 'INT-7', scope: 'PROJECT', allocatedAt: '登记 Interaction', section: 'DOMAIN_SCHEMA §10.1' },
  // L38 — ReportingItem
  { prefix: 'RPT', kind: 'REPORTING_ITEM', example: 'RPT-4', scope: 'PROJECT', allocatedAt: '创建 ReportingItem', section: 'DOMAIN_SCHEMA §10.2' },
  // L39 — ScheduledEvent
  { prefix: 'SEV', kind: 'SCHEDULED_EVENT', example: 'SEV-6', scope: 'PROJECT', allocatedAt: '登记 ScheduledEvent', section: 'DOMAIN_SCHEMA §10.3' },
  // L40 — HistoryEvent, Project 内（单调递增）
  { prefix: 'H', kind: 'HISTORY_EVENT', example: 'H-1001', scope: 'PROJECT', allocatedAt: 'append 时', section: 'HISTORY_EVENT_CATALOG §1（事件信封）；DOMAIN_SCHEMA §15 history_event 表' },
  // L41 — InboxItem
  { prefix: 'IN', kind: 'INBOX_ITEM', example: 'IN-11', scope: 'PROJECT', allocatedAt: 'capture 时', section: 'DOMAIN_SCHEMA §11' },
  // L42 — DiscoveredSession
  { prefix: 'DS', kind: 'DISCOVERED_SESSION', example: 'DS-2', scope: 'PROJECT', allocatedAt: '发现时', section: 'DOMAIN_SCHEMA §6.2' },
  // L43 — ManagementAction（有前缀、非 §1.3 ObjectKind：provenance 记录，非 TypedRef 目标）
  { prefix: 'MA', kind: 'MANAGEMENT_ACTION', example: 'MA-30', scope: 'PROJECT', allocatedAt: '管理操作时', section: 'DOMAIN_SCHEMA §12.1' },
  // L44 — AnalysisRecord
  { prefix: 'AN', kind: 'ANALYSIS_RECORD', example: 'AN-1', scope: 'PROJECT', allocatedAt: '用户保存分析时', section: 'DOMAIN_SCHEMA §12.2' },
]

const PREFIX_TO_ENTRY: ReadonlyMap<string, IdPrefixEntry> = new Map(
  ID_PREFIX_REGISTRY.map(entry => [entry.prefix, entry] as const),
)

const KIND_TO_ENTRY: ReadonlyMap<IdKind, IdPrefixEntry> = new Map(
  ID_PREFIX_REGISTRY.map(entry => [entry.kind, entry] as const),
)

/** All 25 prefixes, in §1.1 table order. */
export const ALL_PREFIXES: readonly string[] = ID_PREFIX_REGISTRY.map(entry => entry.prefix)

/** All 25 IdKinds, in §1.1 table order. */
export const ID_KIND_VALUES: readonly IdKind[] = ID_PREFIX_REGISTRY.map(entry => entry.kind)

/**
 * The 24 §1.3 ObjectKind values (the 25 IdKinds minus MANAGEMENT_ACTION),
 * in §1.1 table order.
 */
export const OBJECT_KIND_VALUES: readonly ObjectKind[] = ID_KIND_VALUES.filter(
  (kind): kind is ObjectKind => kind !== 'MANAGEMENT_ACTION',
)

/** Exact registry lookup by prefix (§1.1 row); undefined for unregistered prefixes. */
export function entryForPrefix(prefix: string): IdPrefixEntry | undefined {
  return PREFIX_TO_ENTRY.get(prefix)
}

/** Exact registry lookup by kind (always defined for a valid IdKind). */
export function entryForKind(kind: IdKind): IdPrefixEntry {
  const entry = KIND_TO_ENTRY.get(kind)
  if (entry === undefined) throw new Error(`unknown IdKind: ${String(kind)}`)
  return entry
}

/** The registered prefix for a kind (e.g. `TASK` → `T`). */
export function prefixForKind(kind: IdKind): string {
  return entryForKind(kind).prefix
}

/** The kind for an exactly registered prefix (e.g. `TE` → `TOPOLOGY_EDGE`); undefined otherwise. */
export function kindForPrefix(prefix: string): IdKind | undefined {
  return PREFIX_TO_ENTRY.get(prefix)?.kind
}

/** True iff `prefix` is one of the 25 frozen prefixes (exact match). */
export function isRegisteredPrefix(prefix: string): boolean {
  return PREFIX_TO_ENTRY.has(prefix)
}
