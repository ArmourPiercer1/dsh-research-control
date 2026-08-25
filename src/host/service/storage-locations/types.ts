/**
 * V2-T2.4 — storage layout & migration (design §3.3 + §9): shared types.
 *
 * ## The §3.3 layout (frozen)
 *
 * The research event database follows its project (Q9: 「库随项目走，
 * 一次只有一份」):
 *
 *  - MANAGED   → `<hub>/<hubDir>/projects/<projectId>/research.sqlite`
 *    (one db per project, under the management hub — §3.1/§3.3);
 *  - STANDALONE→ `<ws>/<treeDir>/state/research.sqlite`
 *    (the tree's own `state/` area — 状态区，不入声明树语义, and outside
 *    the checkpoint commit scope — the git layer's W9/W10 pathspec
 *    excludes `.research/state/` explicitly, design §3.3);
 *  - the V1 `$DSH_HOME/research-control/<projectId>/` layout is RETIRED:
 *    a startup hint names the legacy dirs when present — no automatic
 *    migration (design §14: 不做 DSH_HOME 旧库自动搬运).
 *
 * ## Layering
 *
 * This module is a PURE FUNCTION layer (ARCHITECTURE §2.2 rule 1): no DSH
 * imports (INV-PERM-5), no settings reads. The directory names arrive
 * PARAMETERIZED (the caller resolves them through T2.1's
 * `getResearchDirNames`), and every disk fact arrives through the injected
 * {@link StorageLocationsFs} face (the dsh-adapter side passes the
 * node:fs-backed `nodeFsStorageIo()`; tests pass an in-memory fake). The
 * node:fs implementation lives in `./fs-io.ts` — the only file of this
 * module that touches a filesystem, and a Node BUILTIN (not a DSH host
 * import).
 */

/** The conventional database file name (DSH_ADAPTER §9, unchanged in V2). */
export const DB_FILE_NAME = 'research.sqlite'

/** The STANDALONE state area directly under the tree (design §3.3). */
export const STANDALONE_STATE_DIR = 'state'

/** The per-project data dirs under the hub (design §3.1/§3.3). */
export const MANAGED_PROJECTS_DIR = 'projects'

/**
 * The frozen V1 data-dir segment directly under `$DSH_HOME`
 * (DSH_ADAPTER §9: the V1 wiring opened
 * `dshHomePath('research-control', <projectId>)`). The segment is
 * HISTORICAL — it does not follow the configurable `<hubDir>` (that is a
 * workspace-root tree name, a different namespace).
 */
export const OLD_DB_HOME_SEGMENT = 'research-control'

/** The 16-byte SQLite header magic ("SQLite format 3\0"). */
export const SQLITE_HEADER_MAGIC = 'SQLite format 3\0'

/** The database placement kind of one active plane project (design §3.1). */
export type DbPlacementKind = 'MANAGED' | 'STANDALONE'

/**
 * The placement input of {@link resolveDbPath} / {@link resolveDbDir}
 * (V2-T2.4 task 1: parameterized — the caller passes the T2.1-resolved
 * directory names, this layer never reads settings).
 */
export interface DbPlacementInput {
  /** The placement kind of the project. */
  readonly kind: DbPlacementKind
  /** The project id (the MANAGED data-dir key; `PRJ-<n>`). */
  readonly projectId: string
  /**
   * The hub workspace path (canonical). REQUIRED for MANAGED — a MANAGED
   * project discovered without a hub is a caller invariant break (the
   * discovery layer fails loud before wiring; this check is the
   * defensive backstop, the `REGISTRY_ABSENT` caller-bug precedent).
   * Ignored for STANDALONE (the db lives in the tree regardless of
   * whether a hub exists elsewhere).
   */
  readonly hubPath: string | null
  /** The project workspace path (canonical — used by STANDALONE). */
  readonly wsPath: string
  /** The management-center directory name (T2.1 `getResearchDirNames`). */
  readonly hubDir: string
  /** The project data directory name (T2.1 `getResearchDirNames`). */
  readonly treeDir: string
}

/**
 * The structured failure of this module (stable codes — callers/tests
 * branch on them, the TC-DSH-008 fail-loud style: every message is
 * self-contained).
 */
export type StorageLocationsErrorCode =
  /** A required input is missing/empty (caller bug — fail loud, never guess). */
  | 'INVALID_INPUT'
  /** A MANAGED project was given no hub path (discovery invariant break). */
  | 'MANAGED_WITHOUT_HUB'
  /** The migration target already exists (design §9: 绝不覆盖 — never overwrite). */
  | 'MIGRATION_CONFLICT'
  /** The migration source is missing / not a file / unreadable / not a SQLite file (checked BEFORE any move). */
  | 'SOURCE_UNREADABLE'
  /** The move itself failed (the source is untouched — nothing to roll back). */
  | 'MOVE_FAILED'
  /** The post-move target verification failed (rolled back to the source location first). */
  | 'TARGET_UNREADABLE'
  /** The post-move verification failed AND the rollback move also failed (the data now lives ONLY at the target — manual recovery, never silently discarded). */
  | 'ROLLBACK_FAILED'
  /** The source location still exists after a successful move (the one-copy invariant of design §9 is broken — resolve by hand). */
  | 'SOURCE_REMAINS'

export class StorageLocationsError extends Error {
  readonly code: StorageLocationsErrorCode

  constructor(code: StorageLocationsErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StorageLocationsError'
    this.code = code
  }
}

/**
 * The migration-target-exists error (design §9 「先校验目标不存在（存在即
 * 冲突、停手报错）」 — the database must live exactly once; a target at
 * the destination means the operator already migrated or a second copy
 * exists — STOP, never overwrite).
 */
export class MigrationConflict extends StorageLocationsError {
  constructor(message: string, options?: ErrorOptions) {
    super('MIGRATION_CONFLICT', message, options)
    this.name = 'MigrationConflict'
  }
}

/**
 * The injected filesystem face (the I/O seam of this pure layer — the
 * dsh-adapter side passes `nodeFsStorageIo()`; tests pass an in-memory
 * fake so the migrateDb drill runs without a disk).
 */
export interface StorageLocationsFs {
  /** `true` when the path exists (file or directory). Never throws. */
  exists(path: string): boolean
  /** `true` when the path exists and is a regular file. Never throws. */
  isFile(path: string): boolean
  /** `true` when the path exists and is a directory. Never throws. */
  isDirectory(path: string): boolean
  /** Directory entry names (may throw when the path is absent — callers probe first). */
  readdir(path: string): readonly string[]
  /** Read up to `maxBytes` leading bytes (the readability probe; throws on I/O failure). */
  readHead(path: string, maxBytes: number): Uint8Array
  /**
   * Move (rename) `from` → `to` (throws on failure — the node:fs
   * implementation falls back to copy+verify+delete across devices,
   * design §9 「移动后验证可读再删源」).
   */
  move(from: string, to: string): void
}

/**
 * The structured log sink of this module (checkpoint/wiring precedent:
 * explicit injection, no global logger). Tests collect the lines; the
 * dsh-adapter side bridges to `console`.
 */
export interface StorageLocationsLogger {
  readonly info: (message: string) => void
  readonly warn: (message: string) => void
  readonly error: (message: string) => void
}

/** The silent default (the pure core stays usable without a sink). */
export const SILENT_LOGGER: StorageLocationsLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}
