/**
 * WP-2.1 — operational SQLite store: error taxonomy.
 *
 * Every failure OWNED BY THE STORE is a structured `StoreError` with a
 * stable `code` — the store never throws a raw node:sqlite / node:fs
 * exception to its callers (TC-DB-002 「明确报错」; the caller can
 * branch on `code` instead of string-matching driver output). The original
 * driver error is preserved on `cause` for diagnostics.
 *
 * One deliberate exception: errors thrown by CALLER-supplied hooks
 * (`AppendEventsOptions.validate` / `.realize.apply`) propagate UNCHANGED —
 * they are the caller's own error types (e.g. the WP-2.2 validation
 * domain errors); the store's job in that case is to roll the transaction
 * back, which it does before rethrowing.
 *
 * Codes (stable — the service layer and tests branch on them):
 *   STORE_OPEN        — the file/directory cannot be created or opened
 *   STORE_CORRUPT     — the file exists but is not a usable SQLite DB
 *   STORE_VERSION     — `user_version` != 1 (pre-release: no migrations)
 *   STORE_SCHEMA_STALE — `user_version` = 1 but a history_event structure
 *                        from a different pre-release V1 build (no
 *                        migration; delete the file and reinitialize)
 *   STORE_CLOSED      — operation on a closed store
 *   STORE_INPUT       — malformed caller input (shape / store-owned fields)
 *   STORE_CONFLICT    — uniqueness violation (event_id PK / (ws, seq))
 *   STORE_SQL         — unexpected SQLite failure inside an operation
 */

export type StoreErrorCode =
  | 'STORE_OPEN'
  | 'STORE_CORRUPT'
  | 'STORE_VERSION'
  | 'STORE_SCHEMA_STALE'
  | 'STORE_CLOSED'
  | 'STORE_INPUT'
  | 'STORE_CONFLICT'
  | 'STORE_SQL'

export class StoreError extends Error {
  readonly code: StoreErrorCode

  constructor(code: StoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }
}

/** The DB file or its directory could not be created/opened (bad path,
 *  permission failure, path is a directory). The DB file was left in
 *  whatever state it had; no partial schema is ever written. */
export class StoreOpenError extends StoreError {
  constructor(message: string, options?: ErrorOptions) {
    super('STORE_OPEN', message, options)
  }
}

/**
 * The file exists but is not a usable SQLite database (garbage bytes,
 * truncated header, failed `quick_check`, missing schema tables under a
 * valid `user_version`, or a JSON column that can no longer be parsed).
 * TC-DB-002 semantics: this IS the 「明确报错」 — the store refuses to
 * proceed and never tries to repair; `.research/` and Git are untouched by
 * the store by construction (it only ever writes its own file).
 */
export class StoreCorruptError extends StoreError {
  constructor(message: string, options?: ErrorOptions) {
    super('STORE_CORRUPT', message, options)
  }
}

/**
 * `PRAGMA user_version` is neither 0 (fresh) nor the supported V1 version.
 * Pre-release policy (DSH_ADAPTER §9): the version is monotonic and a
 * mismatch is REJECTED — there is no migration path, and silently opening a
 * DB written by a newer/unknown schema would risk misreading columns.
 */
export class StoreVersionError extends StoreError {
  /** The `user_version` actually found in the file. */
  readonly found: number
  /** The version this store supports (1). */
  readonly expected: number

  constructor(found: number, expected: number) {
    super(
      'STORE_VERSION',
      `unsupported schema version: found user_version=${String(found)}, ` +
        `expected ${String(expected)} — pre-release store does not migrate (DSH_ADAPTER §9)`,
    )
    this.found = found
    this.expected = expected
  }
}

/**
 * `PRAGMA user_version` says 1 (the supported V1) but the on-disk
 * `history_event` structure does not match this build's V1 DDL — the file
 * was written by an OLDER pre-release build (e.g. a pre-WP-2.9 dev DB
 * missing the generated filter columns / indexes) or by a NEWER/unknown
 * one (extra columns or named indexes). Same policy as the numeric
 * version gate (DSH_ADAPTER §9): REJECTED, no migration. The file's data
 * is a pre-release dev artifact — the remedy is to delete the file and
 * reinitialize (a fresh open re-runs the V1 init transaction).
 */
export class StoreSchemaStaleError extends StoreError {
  constructor(message: string, options?: ErrorOptions) {
    super('STORE_SCHEMA_STALE', message, options)
  }
}

/** An operation was attempted on a store after `close()`. */
export class StoreClosedError extends StoreError {
  constructor(operation: string) {
    super('STORE_CLOSED', `${operation}: store is closed`)
  }
}

/** Malformed caller input (bad shapes, store-owned fields supplied, …).
 *  Thrown BEFORE any write; nothing is side-effected. */
export class StoreInputError extends StoreError {
  constructor(message: string, options?: ErrorOptions) {
    super('STORE_INPUT', message, options)
  }
}

/** Uniqueness violation: `event_id` PK or `UNIQUE(owner_workstream_id,
 *  event_seq)`. The whole batch rolled back. */
export class StoreConflictError extends StoreError {
  constructor(message: string, options?: ErrorOptions) {
    super('STORE_CONFLICT', message, options)
  }
}

/** Unexpected SQLite failure inside an open operation (driver-level
 *  problems that are not input/conflict/corruption/version). */
export class StoreSqlError extends StoreError {
  constructor(message: string, options?: ErrorOptions) {
    super('STORE_SQL', message, options)
  }
}
