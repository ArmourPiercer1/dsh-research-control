/**
 * WP-2.3 — replay/query module: error taxonomy.
 *
 * Every failure OWNED BY THE REPLAY MODULE is a structured `ReplayError`
 * with a stable `code` — the module never throws a raw node:sqlite
 * exception to its callers (the store, WP-2.1, keeps its own `STORE_*`
 * taxonomy; store-owned errors propagate through this module UNCHANGED).
 *
 * One deliberate exception: errors thrown by CALLER-supplied reducers
 * (the WP-2.5/domain reducer injected into `foldEvents` /
 * `rebuildDerivedState`) propagate UNCHANGED — they are the caller's own
 * error types; no write of this module is in flight when a reducer throws
 * (the apply transaction only starts AFTER the fold completes).
 *
 * Codes (stable — the service layer and tests branch on them):
 *   REPLAY_INPUT  — malformed caller arguments (bad order / cursor / limit /
 *                   workstream list / store face / reducer shape)
 *   REPLAY_STATE  — a reducer produced a derived-state map that violates
 *                   the `derived_state` contract (malformed key, or a
 *                   non-strict-JSON value)
 *   REPLAY_APPLY  — the independent `derived_state` read/write transaction
 *                   against the SQLite file failed (open / SQL / commit)
 */

export type ReplayErrorCode = 'REPLAY_INPUT' | 'REPLAY_STATE' | 'REPLAY_APPLY'

export class ReplayError extends Error {
  readonly code: ReplayErrorCode

  constructor(code: ReplayErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }
}

/** Malformed caller input; thrown BEFORE any I/O — nothing is side-effected. */
export class ReplayInputError extends ReplayError {
  constructor(message: string, options?: ErrorOptions) {
    super('REPLAY_INPUT', message, options)
  }
}

/** A reducer output that cannot be persisted to `derived_state`. */
export class ReplayStateError extends ReplayError {
  constructor(message: string, options?: ErrorOptions) {
    super('REPLAY_STATE', message, options)
  }
}

/** The independent `derived_state` transaction against the SQLite file failed. */
export class ReplayApplyError extends ReplayError {
  constructor(message: string, options?: ErrorOptions) {
    super('REPLAY_APPLY', message, options)
  }
}
