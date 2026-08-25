/**
 * V2-T2.3 — `registry.yaml` domain types + error classes (domain layer).
 *
 * Design references (docs/design/V2_RESEARCH_PLANE_DESIGN.md):
 *  - §3.2 `registry.yaml` (in the hub, declarative source of truth,
 *    human/plugin co-maintained): entry field table
 *    (id/path/displayName/status/boundAt/archivedAt), strict schema
 *    validation, malformed ⇒ fail-loud;
 *  - §4 step 5 (dual-source reconciliation: registry entry ∧ discovered
 *    tree → MANAGED; entry ∧ no tree → MISSING; no entry ∧ tree →
 *    STANDALONE) — T2.2's plane state consumes the
 *    `validateAgainstTrees` projection built over these types;
 *  - §12/§12.1 (the registry operation RPC family lands in the T3.1
 *    contract layer — this module is its pure domain kernel).
 *
 * Layer rules (ARCHITECTURE.md §2.2 rule 1, same pattern as the WP-1.1
 * loader / WP-1.4 topology store): this module is pure domain logic —
 * no I/O of its own, no node builtins, no git imports, no DSH imports
 * (INV-PERM-5). `yaml` and `zod` are the allowed codec backends (the
 * loader uses `yaml`/`ajv` the same way; neither is a DSH package).
 *
 * Time carrier: epoch-ms integers (the frozen §3.2 example pins the
 * carrier VERBATIM: `boundAt: 1770000000000`; the same epoch-ms carrier
 * as the frozen RPC contracts). Unlike the declarative tree (DOMAIN_SCHEMA
 * §1.2 ISO-8601 YAML carrier), registry.yaml stores epoch ms VERBATIM —
 * no conversion boundary exists.
 */

/* ------------------------------------------------------------------ *
 * Core shapes (design §3.2)
 * ------------------------------------------------------------------ */

/** Registry entry lifecycle (frozen §3.2: `active | archived`). */
export type RegistryEntryStatus = 'active' | 'archived'

/**
 * One registered project (frozen §3.2 field table, verbatim keys —
 * the file is human-visible and human-maintained, so the key names
 * are the contract, exactly as written in the design).
 */
export interface RegistryEntry {
  /**
   * `PRJ-n` — must match the target tree's `.research/project.yaml`
   * `id` (the cross-check is T2.2's startup concern, NOT the
   * registry's — §3.2 「条目 id 与目标树 project.yaml 不一致 = 冲突，
   * 启动期报出」).
   */
  readonly id: string
  /**
   * Absolute path of the project workspace (POSIX `/…`, Windows
   * drive `C:\…` / `C:/…`, or UNC `\\…`). Must be a registered DSH
   * workspace — that membership check is the discovery layer's
   * concern (T2.2), not the file's.
   */
  readonly path: string
  /** Human-facing project name (product copy — any string). */
  readonly displayName: string
  /** `active` = bound to the hub; `archived` = 解绑归档 (the entry is
   *  a tombstone, never deleted — §4 MISSING 处置「移除登记」). */
  readonly status: RegistryEntryStatus
  /** Epoch ms — when the entry was bound. */
  readonly boundAt: number
  /**
   * Epoch ms — REQUIRED (non-null) when `status` is `archived`,
   * REQUIRED `null` while `active` (the status↔timestamp cross-rule,
   * enforced at parse AND at every mutation boundary).
   */
  readonly archivedAt: number | null
}

/**
 * The parsed `registry.yaml` document (frozen §3.2 shape: exactly
 * `version` + `projects`, nothing else — the strict schema rejects
 * unknown keys).
 */
export interface RegistryFile {
  /** File format version; the only accepted value is `1`. */
  readonly version: 1
  /** Registered projects in declaration order (order is user intent). */
  readonly projects: readonly RegistryEntry[]
}

/* ------------------------------------------------------------------ *
 * Reconciliation projection (design §4 step 5, consumed by T2.2)
 * ------------------------------------------------------------------ */

/**
 * The dual-source reconciliation projection: the pure set operation of
 * registry entries against discovered `.research/` tree paths. The
 * resolution INTO plane roles (MANAGED / STANDALONE / MISSING + the
 * MISSING four-choice disposition) is T2.2's I/O-side state machine —
 * see `reconcile.ts` for the exact branch semantics.
 */
export interface RegistryReconciliation {
  /** Entries whose `path` was discovered as a tree (registry order). */
  readonly managed: readonly RegistryEntry[]
  /** Entries whose `path` was NOT discovered (registry order). */
  readonly missing: readonly RegistryEntry[]
  /** Discovered tree paths no entry claims (input order, deduped). */
  readonly standalone: readonly string[]
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/**
 * Malformed `registry.yaml` — thrown by `parseRegistry` (the registry
 * is a single fail-loud load: design §4 step 4 「解析该中枢
 * registry.yaml（畸形 → fail-loud）」; unlike the tree loader's
 * aggregated error list, one broken registry blocks the hub — there
 * is no "load the rest" semantics for a one-file source of truth).
 *
 * Every message is self-contained (it rides verbatim into the startup
 * log) and the structured `line`/`col`/`pointer` fields carry the
 * 1-based source location when resolvable (行级信息).
 */
export type RegistryFormatCode =
  /** YAML syntax failure, duplicate mapping keys, or a second `---` document — `line`/`col` from the yaml library. */
  | 'PARSE'
  /** Top-level document is not a mapping (empty/comment-only file, a sequence, a scalar). */
  | 'NOT_MAPPING'
  /** Strict-schema violation (unknown key, missing key, wrong type, id pattern, absolute path, status enum, version literal, timestamp shape). */
  | 'SCHEMA'
  /** Two entries declare the same project id — the message names the lines of both occurrences. */
  | 'DUPLICATE_ID'
  /** status↔archivedAt cross-rule broken (archived without archivedAt, or active with a non-null archivedAt). */
  | 'STATUS_TIMESTAMP'

export class RegistryFormatError extends Error {
  readonly code: RegistryFormatCode
  /** 1-based line of the violation (when resolvable from the source). */
  readonly line?: number
  /** 1-based column of the violation (when resolvable from the source). */
  readonly col?: number
  /**
   * JSON-pointer-style path into the document for the violating node
   * (`/projects/1/archivedAt`), or the string `'(document root)'` for
   * a document-level violation; `undefined` when no pointer applies.
   */
  readonly pointer?: string

  constructor(code: RegistryFormatCode, message: string, extra?: { line?: number; col?: number; pointer?: string }) {
    super(message)
    this.name = 'RegistryFormatError'
    this.code = code
    if (extra?.line !== undefined) this.line = extra.line
    if (extra?.col !== undefined) this.col = extra.col
    if (extra?.pointer !== undefined) this.pointer = extra.pointer
  }
}

/**
 * Illegal registry mutation — thrown by the entry state machine
 * (`archiveEntry` / `restoreEntry` / `upsertEntry`) and by
 * `serializeRegistry` on an invalid in-memory file. Always thrown
 * (the service-facing counterpart of RegistryFormatError, same shape
 * as the topology store's TopologyStoreError).
 */
export type RegistryMutationCode =
  /** The registry contains no entry with that id. */
  | 'ENTRY_NOT_FOUND'
  /** `archiveEntry` on an already-archived entry (no silent no-op). */
  | 'ALREADY_ARCHIVED'
  /** `restoreEntry` on an active entry (nothing to restore). */
  | 'NOT_ARCHIVED'
  /** An entry (or the file header) violates the frozen §3.2 contract — the message carries the violating field(s). */
  | 'INVALID_ENTRY'
  /** `archiveEntry` timestamp is not a non-negative integer epoch-ms value. */
  | 'INVALID_TIMESTAMP'

export class RegistryMutationError extends Error {
  readonly code: RegistryMutationCode
  /** The entry id the error is about, when applicable. */
  readonly entryId?: string

  constructor(code: RegistryMutationCode, message: string, extra?: { entryId?: string }) {
    super(message)
    this.name = 'RegistryMutationError'
    this.code = code
    if (extra?.entryId !== undefined) this.entryId = extra.entryId
  }
}

/* ------------------------------------------------------------------ *
 * Shared internal helpers
 * ------------------------------------------------------------------ */

/**
 * Deep-freeze a registry file (entries + array + file) so the
 * immutability contract of parse/state-machine outputs is enforced by
 * the runtime, not just by the `readonly` types. Internal helper used
 * by `parseRegistry` and the state machine (also convenient for T2.2
 * to freeze hand-built files).
 */
export function freezeRegistryFile(file: RegistryFile): RegistryFile {
  const projects: RegistryEntry[] = file.projects.map((entry) => Object.freeze({ ...entry }))
  return Object.freeze({ version: file.version, projects: Object.freeze(projects) })
}
