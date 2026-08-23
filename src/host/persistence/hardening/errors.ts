/**
 * WP-8.1 — hardening (crash recovery + boundary): error taxonomy.
 *
 * Every failure OWNED BY THE HARDENING LAYER is a structured
 * `HardeningError` with a stable `code` — the layer never lets a raw
 * driver/loader/git exception escape a public entry point (「绝不静默」:
 * ARCHITECTURE §10; the caller can branch on `code` instead of
 * string-matching underlying output). The original cause is preserved on
 * `cause` for diagnostics.
 *
 * Codes (stable — the dsh-adapter's `[Service.init]` and the tests branch
 * on them):
 *   HARDENING_FATAL      — `assertStartup` over a `fatal` report: the
 *                          startup integrity checks found an unrecoverable
 *                          condition; the report is attached on the error.
 *   HARDENING_INPUT      — malformed orchestrator input (paths, ids).
 *   HARDENING_MIGRATION  — the migration mechanism (migrations.ts) rejected
 *                          or failed an upgrade (plan gap, version guard,
 *                          a step throwing mid-transaction).
 */

export type HardeningErrorCode = 'HARDENING_FATAL' | 'HARDENING_INPUT' | 'HARDENING_MIGRATION'

export class HardeningError extends Error {
  readonly code: HardeningErrorCode

  constructor(code: HardeningErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }
}

/**
 * `assertStartup` over a report whose outcome is `fatal` (an unrecoverable
 * finding: SQLite corruption, an unsupported/stale schema version, a broken
 * frozen-schema set, a missing research root or project.yaml, a
 * project-id scope mismatch). The error carries the FULL report so the
 * `[Service.init]` caller can surface every finding + the user guidance
 * (never a bare string).
 */
export class HardeningFatalError extends HardeningError {
  constructor(message: string, readonly report: import('./types.js').StartupIntegrityReport, options?: ErrorOptions) {
    super('HARDENING_FATAL', message, options)
  }
}
