/**
 * WP-1.3 — canonical plan CRUD: types, injected ports, error model.
 *
 * Frozen contracts implemented here (read-only):
 *  - DOMAIN_SCHEMA.md §4.1/§4.2/§4.3 (G/T/M 定义文件：声明式内容 only,
 *    INV-PLAN-9), §4.4 (canonical plan.yaml：有序 ID 语义 — 元素「定义文件存在
 *    ∧ 属于本 WS ∧ 无重复」；顺序即用户意图), §1.1 规则 1/2/3 (ID 不可变 /
 *    文件名↔id 一致性 / 不得复用篡改), §1.2 (时间承载：文件 ISO 8601 UTC ↔
 *    内存 epoch ms);
 *  - ARCHITECTURE.md §5.4: INV-PLAN-1 (顺序持久化；加载/刷新/重启不改变顺序)、
 *    INV-PLAN-9 (plan.yaml 只保存当前 Future zone 的有序 ID；G/T/M 定义文件
 *    长期保留，不随离开计划而删除)、INV-PLAN-3 (Agent 无 canonical plan 变更
 *    API — 服务/工具层职责，本 kernel 不感知调用者身份);
 *  - schema/declarative/{plan,task,gate,milestone}.schema.json +
 *    common.schema.json (draft 2020-12，经 WP-1.1 `loadSchemas` 原样编译)。
 *
 * Layer rules (ARCHITECTURE §2.2 rule 1): pure domain kernel — ZERO direct
 * I/O. Every byte is read through the injected WP-1.1 `ResearchFileReader`
 * and written through the injected `PlanFileWriter` below. No git (WP
 * boundary, §2.1), no DSH imports (INV-PERM-5), no Node builtins.
 */

import type { IdKind } from '../../../shared/ids/index.js'
import type { ResearchFileReader, TaskDoc, GateDoc, MilestoneDoc } from '../loader/index.js'

/* ------------------------------------------------------------------ *
 * Plan item kinds (§4.1 task / §4.2 gate / §4.3 milestone)
 * ------------------------------------------------------------------ */

/** The three canonical plan item kinds. */
export type PlanItemKind = 'task' | 'gate' | 'milestone'

/** All plan item kinds, canonical order. */
export const PLAN_ITEM_KINDS: readonly PlanItemKind[] = ['task', 'gate', 'milestone'] as const

/** The shared/ids IdKind each plan item kind resolves to (§1.1 registry). */
export const KIND_TO_ID_KIND: Readonly<Record<PlanItemKind, IdKind>> = {
  task: 'TASK',
  gate: 'GATE',
  milestone: 'MILESTONE',
}

/** The `items/` subdirectory per kind (DOMAIN_SCHEMA §14 layout). */
export const KIND_TO_DIR: Readonly<Record<PlanItemKind, 'tasks' | 'gates' | 'milestones'>> = {
  task: 'tasks',
  gate: 'gates',
  milestone: 'milestones',
}

/** The in-memory definition carrier (§1.2: epoch-ms times), per kind. */
export type DefinitionDoc = TaskDoc | GateDoc | MilestoneDoc

/* ------------------------------------------------------------------ *
 * Injected write port (the only write seam of this module)
 * ------------------------------------------------------------------ */

/**
 * Atomic file writer — the injected write counterpart of the WP-1.1
 * `ResearchFileReader` read port.
 *
 * Contract (implemented by the fs-backed service layer in a later WP, or by
 * an in-memory fake in tests — the kernel never implements it):
 *   - `writeAtomic(path, content)` replaces the WHOLE file content of `path`
 *     in one all-or-nothing step (real fs: write a tmp file in the same
 *     directory, then `rename` over `path` — rename is atomic on POSIX);
 *   - on success, subsequent reads of `path` see exactly `content`;
 *   - on throw, `path` keeps its previous content (or stays absent) — no
 *     partial file is ever observable to a reader.
 *
 * The kernel treats `writeAtomic` as opaque: it never creates tmp files
 * itself and never observes them. Atomicity is a writer OBLIGATION documented
 * here, exactly as null/throw semantics are the reader's (WP-1.1).
 */
export interface PlanFileWriter {
  /** Atomically write UTF-8 `content` to `path` (tmp+rename). Throws on failure. */
  writeAtomic(path: string, content: string): void
}

/* ------------------------------------------------------------------ *
 * Store configuration
 * ------------------------------------------------------------------ */

/**
 * One store instance manages the canonical plan of EXACTLY ONE workstream
 * (`topics/<topicId>/workstreams/<wsId>/`): its `plan.yaml` plus the
 * G/T/M definition files under `items/`. The store is STATELESS and
 * reentrant: every public operation re-reads the current state through the
 * reader (no cache) and writes through the writer — the service layer (a
 * later WP) may hold many instances or recreate them per operation
 * (TC-DOM-005 "restart simulation" = a fresh instance over the same files).
 */
export interface PlanStoreOptions {
  /** Read-only file access (WP-1.1 port; `null` = missing, throw = I/O failure). */
  readonly reader: ResearchFileReader
  /** Atomic write port (this WP). */
  readonly writer: PlanFileWriter
  /** Reader-absolute path of the `.research/` root (e.g. `/workspace/.research`). */
  readonly researchRoot: string
  /** Frozen declarative schema dir (schema/declarative; common.schema.json in its parent). */
  readonly schemaDir: string
  /** The target workstream's topic directory (must be a well-formed TPC id). */
  readonly topicId: string
  /** The target workstream directory (must be a well-formed WS id). */
  readonly wsId: string
}

/* ------------------------------------------------------------------ *
 * Errors (precise location: file + in-document path + summary)
 * ------------------------------------------------------------------ */

/**
 * Plan-store error codes. Vocabulary mirrors the WP-1.1 loader where the
 * same violation class exists (PARSE / SCHEMA / PATH_ID_MISMATCH /
 * DUPLICATE_ID / DANGLING_REF / READ), plus the write-path specific ones.
 */
export type PlanStoreErrorCode =
  /** The target workstream directory does not exist (construction fails loud). */
  | 'WORKSTREAM_MISSING'
  /** A frozen schema file is missing/uncompilable (construction fails loud). */
  | 'SCHEMA_LOAD'
  /** A layout name (topicId/wsId option, directory or file name) does not conform to the §14 id naming rule. */
  | 'PATH_RULE'
  /** YAML parse failure (bad syntax, empty file, multiple documents, duplicate keys). */
  | 'PARSE'
  /** Frozen JSON Schema (2020-12) validation failure — `path` is the schema instance path. */
  | 'SCHEMA'
  /** File location vs in-file `id` / `workstream_id` field mismatch (§1.1 规则 3, §4.x path rules). */
  | 'PATH_ID_MISMATCH'
  /** An id is not well-formed or resolves to a kind different from the requested one (类型一致性, §4.4/§1.1). */
  | 'TYPE_MISMATCH'
  /** A repeated id in `plan.yaml → ordered_items` (§4.4 无重复). */
  | 'DUPLICATE_ID'
  /** A plan entry has no VALID definition file in this workstream (§4.4/§16.1). */
  | 'DANGLING_REF'
  /** The referenced definition file does not exist, or the id is not listed in the plan. */
  | 'NOT_FOUND'
  /** `createItem`/`addItem` while the definition file already exists (no overwrite, §1.1 规则 3). */
  | 'FILE_EXISTS'
  /** An insert/move position index is out of range. */
  | 'BOUNDARY'
  /** An `updateItem` patch touches `id` or `workstream_id` (immutable, §1.1 规则 1 / path-bound). */
  | 'IMMUTABLE_FIELD'
  /** The reader threw at a path (I/O failure). */
  | 'READ'
  /** The writer threw (I/O failure; the file keeps its previous content). */
  | 'WRITE'

/**
 * One precisely-located plan-store violation (ARCHITECTURE §10: file +
 * field + 违规内容摘要, no guess-repair). Mutating operations throw the
 * FIRST violated check (fail before any write); `loadPlan` AGGREGATES
 * (WP-1.1 style) into `PlanLoadResult.errors`.
 */
export class PlanStoreError extends Error {
  readonly code: PlanStoreErrorCode
  /** File (or entry) location, relative to the `.research/` root, POSIX-style. */
  readonly file: string
  /** JSON-pointer-style path inside the document; `undefined` for document-level errors. */
  readonly path?: string

  constructor(init: { code: PlanStoreErrorCode; file: string; path?: string; message: string }) {
    super(init.message)
    this.name = 'PlanStoreError'
    this.code = init.code
    this.file = init.file
    this.path = init.path
  }
}

/**
 * Type guard for `PlanStoreError` (service layer / tests).
 */
export function isPlanStoreError(error: unknown): error is PlanStoreError {
  return error instanceof PlanStoreError
}

/* ------------------------------------------------------------------ *
 * Load result (aggregated, WP-1.1 style)
 * ------------------------------------------------------------------ */

/**
 * Result of `PlanStore.loadPlan()`.
 *
 * - `present` — `plan.yaml` exists on disk;
 * - `items` — `ordered_items` VERBATIM in file order (never sorted, never
 *   deduplicated — INV-PLAN-1: order is user intent); `[]` when absent;
 * - `errors` — aggregated violations (deterministic order); non-empty ⇒ the
 *   plan is inconsistent and mutating operations will refuse to build on it.
 */
export interface PlanLoadResult {
  readonly present: boolean
  readonly items: string[]
  readonly errors: PlanStoreError[]
}
