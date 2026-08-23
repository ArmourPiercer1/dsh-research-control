/**
 * WP-8.1 — hardening: the schema-migration strategy (documented decision
 * + reserved implementation skeleton).
 *
 * ## The decision (pre-release — DSH_ADAPTER §9)
 *
 * `PRAGMA user_version` is the MONOTONIC schema version of
 * research.sqlite (DSH_ADAPTER §9, the DSH storage-sqlite pattern this
 * store follows verbatim):
 *
 *   - `0`           → fresh file: the V1 init transaction runs (one
 *                     all-or-nothing transaction — the WP-2.1 open path);
 *   - `1` (supported) → open (the open path re-verifies the V1
 *                     structure — a stale pre-release V1 structure is
 *                     rejected as `STORE_SCHEMA_STALE`);
 *   - anything else → REJECTED. Pre-release does NOT migrate: the
 *                     version is monotonic and a mismatch is refused
 *                     (「不匹配即拒绝」) — silently opening a DB written
 *                     by another schema build risks misreading columns.
 *                     The remedy is the user's: delete the file and
 *                     reinitialize (the data is a pre-release dev
 *                     artifact — known and accepted, DSH_ADAPTER §9).
 *
 * {@link resolveVersionPolicy} is the machine-readable form of this
 * decision — the open path's numeric gate is its implementation, and
 * this function is the single place the decision is stated so the
 * future migration switch (below) changes ONE function, not several.
 *
 * ## The reserved mechanism (the skeleton this WP delivers)
 *
 * When a post-release version 2 arrives, the policy flips from
 * `reject` to `plan + run`: the registry gains steps, `DB_USER_VERSION`
 * bumps to the new version in the SAME change, and the open path runs
 * {@link planMigrations} + {@link runMigrations} between reading
 * `user_version` and opening. This WP delivers that mechanism, proven
 * by a FAKE migration round (tests/hardening/migrations.test.ts — a
 * 1→2→3 chain over a real temp SQLite file), WITHOUT wiring it into the
 * live open path:
 *
 *   - `PRE_RELEASE_MIGRATIONS` is deliberately EMPTY — the pre-release
 *     registry has no steps, so the live behavior stays EXACTLY
 *     「不匹配即拒绝」(the test pins this: the registry is empty and the
 *     policy rejects 99);
 *   - {@link SchemaMigration} is the upgrade hook: `fromVersion` /
 *     `toVersion` + an `upgrade(db)` applied inside ONE transaction
 *     whose LAST statement bumps `user_version` to `toVersion` — a
 *     crash mid-step rolls the step back and the file sits at the
 *     previous step's version (always a complete, openable state;
 *     re-running resumes from there);
 *   - {@link planMigrations} computes the upgrade path over the
 *     registry (monotonic, no downgrades, no gaps — a missing link is a
 *     structured error, never a silent skip);
 *   - {@link runMigrations} applies the plan with the per-step version
 *     guard: a step whose `fromVersion` does not match the running
 *     version is REJECTED before any SQL (a stale plan must never
 *     half-apply).
 *
 * The {@link MigrationDb} seam is minimal (exec + get) so the mechanism
 * is testable without a live store handle; the production adapter for a
 * node:sqlite `DatabaseSync` is {@link toMigrationDb}.
 *
 * No DSH imports (INV-PERM-5). This module is the only hardening file
 * that carries a DB-WRITE surface — and only as the reserved mechanism:
 * pre-release, nothing in the live path calls `runMigrations` with a
 * non-empty plan (the registry is empty; the open path still rejects).
 */

import { HardeningError } from './errors.js'

/* ==================================================================== *
 * The reserved migration seam
 * ==================================================================== */

/**
 * The minimal structural seam the migration mechanism needs from a
 * SQLite connection. A node:sqlite `DatabaseSync` satisfies it through
 * {@link toMigrationDb}; tests may use fakes. (Deliberately NOT the
 * `ResearchStore` handle: the mechanism must work on the raw connection
 * the open path holds, before any store-level guard is relevant — DDL
 * is trusted plugin code, like the V1 init transaction.)
 */
export interface MigrationDb {
  /** Execute one (multi-statement) SQL script. */
  exec(sql: string): void
  /** Run a single-row query (the mechanism uses it for `PRAGMA user_version`). */
  get(sql: string): Record<string, unknown> | undefined
}

/**
 * Adapt any node:sqlite-shaped connection (`DatabaseSync`) to the
 * mechanism's seam.
 */
export function toMigrationDb(
  db: {
    exec(sql: string): void
    prepare(sql: string): { get(...params: unknown[]): Record<string, unknown> | undefined }
  },
): MigrationDb {
  return {
    exec: (sql) => db.exec(sql),
    get: (sql) => db.prepare(sql).get() as Record<string, unknown> | undefined,
  }
}

/**
 * ONE upgrade step (the reserved upgrade hook). `upgrade` runs inside a
 * single transaction; the runner appends the `user_version` bump as the
 * step's LAST statement in the SAME transaction — so a crash mid-step
 * rolls the WHOLE step back (DDL + version bump together) and the file
 * is left at the previous step's version: always complete, always
 * resumable (monotonic).
 */
export interface SchemaMigration {
  /** The `user_version` the step starts from. */
  readonly fromVersion: number
  /** The `user_version` the step ends at (strictly greater than `fromVersion`). */
  readonly toVersion: number
  /** The step's DDL (applied inside the step transaction). */
  readonly upgrade: (db: MigrationDb) => void
  /** One-line description (the report/log surface). */
  readonly description?: string
}

/**
 * The PRE-RELEASE migration registry: deliberately EMPTY.
 *
 * DSH_ADAPTER §9: 「PRAGMA user_version 单调 schema 版本、不匹配即拒绝
 * （pre-release 不做迁移）」. A future (post-release) WP adds its steps
 * HERE and bumps `DB_USER_VERSION` in the same change, then points the
 * open path's mismatch branch at `planMigrations(PRE_RELEASE_MIGRATIONS…)`
 * — the policy switch is `resolveVersionPolicy` + this registry, nothing
 * else. Until then the live behavior is exactly 「不匹配即拒绝」.
 */
export const PRE_RELEASE_MIGRATIONS: readonly SchemaMigration[] = []

/* ==================================================================== *
 * The version policy (the documented decision, machine-readable)
 * ==================================================================== */

export type VersionPolicyDecision =
  | { readonly action: 'initialize' }
  | { readonly action: 'open' }
  | { readonly action: 'reject'; readonly found: number; readonly supported: number; readonly reason: string }

/**
 * The pre-release version policy (module header, decision block):
 *   `0` → initialize (the V1 init transaction);
 *   `supported` → open;
 *   anything else → REJECT (no migration; monotonic; the user deletes
 *   the file and reinitializes).
 *
 * Pure — the open path's numeric gate is this decision; the future
 * post-release flip replaces the `reject` branch with
 * `planMigrations(found, supported, registry)` + `runMigrations`.
 */
export function resolveVersionPolicy(found: number, supported: number): VersionPolicyDecision {
  if (!Number.isSafeInteger(found) || found < 0) {
    return {
      action: 'reject',
      found,
      supported,
      reason: `user_version ${String(found)} is not a non-negative safe integer — unreadable version, rejected (DSH_ADAPTER §9)`,
    }
  }
  if (found === 0) return { action: 'initialize' }
  if (found === supported) return { action: 'open' }
  return {
    action: 'reject',
    found,
    supported,
    reason:
      `user_version ${String(found)} != supported ${String(supported)} — the pre-release store does not migrate ` +
      '(DSH_ADAPTER §9「user_version 单调、不匹配即拒绝」); remedy: delete the file (with -wal/-shm) and reinitialize',
  }
}

/* ==================================================================== *
 * The mechanism (reserved for the post-release switch)
 * ==================================================================== */

/**
 * Compute the upgrade path from `current` to `target` over the registry.
 *
 * Monotonic: `target < current` is a structured error (no downgrades —
 * the version is monotonic, DSH_ADAPTER §9). The walk requires a
 * CONNECTED chain: at every intermediate version v there must be a step
 * with `fromVersion === v` and `toVersion` in `(v, target]` (a step may
 * span several versions, e.g. 1→3; it may never overshoot `target`).
 * Two registry steps sharing a `fromVersion`: the one with the GREATEST
 * `toVersion` wins (deterministic). Any missing link / overshoot /
 * malformed step is a structured {@link HardeningError}
 * (HARDENING_MIGRATION) — a plan gap is never silently skipped.
 */
export function planMigrations(
  current: number,
  target: number,
  registry: readonly SchemaMigration[],
): readonly SchemaMigration[] {
  assertVersion(current, 'current')
  assertVersion(target, 'target')
  if (target < current) {
    throw new HardeningError(
      'HARDENING_MIGRATION',
      `cannot plan a migration from ${String(current)} down to ${String(target)} — user_version is monotonic (DSH_ADAPTER §9); no downgrades`,
    )
  }
  validateRegistry(registry)

  const steps: SchemaMigration[] = []
  let v = current
  while (v < target) {
    let best: SchemaMigration | undefined
    for (const step of registry) {
      if (step.fromVersion !== v) continue
      if (step.toVersion <= v || step.toVersion > target) continue
      if (best === undefined || step.toVersion > best.toVersion) best = step
    }
    if (best === undefined) {
      throw new HardeningError(
        'HARDENING_MIGRATION',
        `no migration step leaves user_version ${String(v)} on the way to ${String(target)} — the registry has a gap (a plan gap is never silently skipped)`,
      )
    }
    steps.push(best)
    v = best.toVersion
  }
  return steps
}

export interface MigrationRunResult {
  /** The version before the run. */
  readonly from: number
  /** The version after the run (== the planned target). */
  readonly to: number
  /** The steps actually applied (in order). */
  readonly applied: readonly { readonly fromVersion: number; readonly toVersion: number; readonly description?: string }[]
}

/**
 * Apply a planned migration chain to `db`.
 *
 * Per step: the `fromVersion` GUARD (a stale plan — `fromVersion` ≠ the
 * running version — is rejected BEFORE any SQL), then ONE transaction:
 * `BEGIN` → `upgrade(db)` → `PRAGMA user_version = toVersion` →
 * `COMMIT`. A failing step rolls back its WHOLE transaction (DDL +
 * version bump together) and the run stops with a structured
 * HARDENING_MIGRATION error (the original cause preserved) — the file
 * is left at the previous step's version: complete, openable, resumable
 * (a re-run replans from the running version).
 *
 * An empty plan is a no-op (the pre-release state: nothing to do).
 */
export function runMigrations(
  db: MigrationDb,
  steps: readonly SchemaMigration[],
): MigrationRunResult {
  const from = readUserVersion(db)
  if (steps.length === 0) {
    return { from, to: from, applied: [] }
  }
  const applied: { fromVersion: number; toVersion: number; description?: string }[] = []
  let v = from
  for (const step of steps) {
    if (step.fromVersion !== v) {
      throw new HardeningError(
        'HARDENING_MIGRATION',
        `migration step ${step.fromVersion}→${step.toVersion} does not apply: the running user_version is ${String(v)} — stale plan, rejected before any SQL (no half-applied steps)`,
      )
    }
    db.exec('BEGIN')
    try {
      step.upgrade(db)
      db.exec(`PRAGMA user_version = ${step.toVersion}`)
      db.exec('COMMIT')
    } catch (e) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // the transaction may already be gone (driver rolled it back on
        // the failing statement); nothing to do — the error is what matters
      }
      throw new HardeningError(
        'HARDENING_MIGRATION',
        `migration step ${step.fromVersion}→${step.toVersion}${step.description ? ` (${step.description})` : ''} FAILED and was rolled back: ${e instanceof Error ? e.message : String(e)} — the database is left at user_version ${String(v)} (the previous step's version; re-run resumes from there)`,
        { cause: e },
      )
    }
    v = step.toVersion
    applied.push({
      fromVersion: step.fromVersion,
      toVersion: step.toVersion,
      ...(step.description !== undefined ? { description: step.description } : {}),
    })
  }
  return { from, to: v, applied }
}

/* ==================================================================== *
 * Helpers
 * ==================================================================== */

function readUserVersion(db: MigrationDb): number {
  const row = db.get('PRAGMA user_version')
  const v = Number(row?.user_version ?? 0)
  if (!Number.isSafeInteger(v) || v < 0) {
    throw new HardeningError(
      'HARDENING_MIGRATION',
      `cannot read user_version (got ${String(row?.user_version ?? 'nothing')}) — refusing to migrate over an unreadable version`,
    )
  }
  return v
}

function assertVersion(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HardeningError(
      'HARDENING_MIGRATION',
      `${what} must be a non-negative safe integer (got ${String(value)})`,
    )
  }
}

function validateRegistry(registry: readonly SchemaMigration[]): void {
  registry.forEach((step, i) => {
    assertVersion(step.fromVersion, `registry[${i}].fromVersion`)
    assertVersion(step.toVersion, `registry[${i}].toVersion`)
    if (step.toVersion <= step.fromVersion) {
      throw new HardeningError(
        'HARDENING_MIGRATION',
        `registry[${i}]: toVersion (${String(step.toVersion)}) must be strictly greater than fromVersion (${String(step.fromVersion)}) — the version is monotonic`,
      )
    }
    if (typeof step.upgrade !== 'function') {
      throw new HardeningError('HARDENING_MIGRATION', `registry[${i}].upgrade must be a function`)
    }
  })
}
