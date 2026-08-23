/**
 * src/host/persistence/hardening — public surface (WP-8.1).
 *
 * The startup hardening layer (crash recovery + boundary handling):
 *
 *   - startup.ts      — `runStartupIntegrityChecks` (the four-check
 *                       orchestrator: DB / tree / git / consistency) +
 *                       `assertStartup` (the fail-loud gate);
 *   - db-check.ts     — check 1: the operational DB probe (the store's
 *                       own open path: quick_check + user_version +
 *                       structure) classified per ARCHITECTURE §10 /
 *                       TC-DB-002;
 *   - tree-check.ts   — check 2: the `.research/` loader error
 *                       aggregation classified into the startup
 *                       semantics (ARCHITECTURE §10 row: broken file
 *                       rejected with file+field location, the rest
 *                       load → readonly usable surface);
 *   - git-check.ts    — check 3: the Git workspace boundary (GIT_
 *                       INTEGRATION §5.1 conflict detection + §9 + the
 *                       TC-GIT-001 dirty semantics; 绝不静默 init);
 *   - consistency.ts  — check 4: the dual-真源 consistency SPOT check
 *                       (declarative lifecycle vs History + project
 *                       scope);
 *   - migrations.ts   — the schema-migration strategy: the documented
 *                       pre-release decision (user_version monotonic,
 *                       mismatch rejected, no migration — DSH_ADAPTER
 *                       §9) + the reserved upgrade mechanism
 *                       (hook interface + planner + runner; the
 *                       pre-release registry is empty);
 *   - types.ts        — the shared types (check results, the startup
 *                       report, the orchestrator input);
 *   - errors.ts       — `HardeningError` taxonomy (HARDENING_*).
 *
 * NOT part of this surface: any write/repair/recovery action — the layer
 * is a read-only startup probe; the convergence mechanisms are the
 * already-delivered wiring reconciliations + the explicit user
 * operations. No DSH imports (INV-PERM-5); git access goes through the
 * `src/host/git` layer behind the injectable `GitOps` port (INV-GIT-6).
 */

export {
  checkDatabase,
} from './db-check.js'
export {
  checkDualTruthConsistency,
} from './consistency.js'
export {
  checkGitWorkspace,
  realGitOps,
} from './git-check.js'
export {
  classifyTreeLoad,
} from './tree-check.js'
export {
  assertStartup,
  runStartupIntegrityChecks,
} from './startup.js'
export {
  HardeningError,
  HardeningFatalError,
  type HardeningErrorCode,
} from './errors.js'
export {
  PRE_RELEASE_MIGRATIONS,
  planMigrations,
  resolveVersionPolicy,
  runMigrations,
  toMigrationDb,
  type MigrationDb,
  type MigrationRunResult,
  type SchemaMigration,
  type VersionPolicyDecision,
} from './migrations.js'
export {
  DEFAULT_CONSISTENCY_SAMPLE,
  type CheckStatus,
  type ConsistencyCheckResult,
  type ConsistencyFinding,
  type ConsistencyFindingKind,
  type DbCheckOutcome,
  type DbCheckResult,
  type DualTruthConsistencyInput,
  type GitCheckResult,
  type GitOps,
  type IntegrityLogger,
  type ReadSurface,
  type StartupIntegrityInput,
  type StartupIntegrityReport,
  type StartupOutcome,
  type TreeCheckResult,
} from './types.js'
