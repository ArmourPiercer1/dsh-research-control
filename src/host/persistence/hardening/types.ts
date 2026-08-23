/**
 * WP-8.1 — hardening (crash recovery + boundary): shared types.
 *
 * The startup integrity surface of the plugin (ARCHITECTURE §10 失效与降级,
 * DSH_ADAPTER §9, GIT_INTEGRATION §5.1/§9, TEST_MATRIX TC-DB-002/003,
 * TC-GIT-001):
 *
 *   - {@link runStartupIntegrityChecks} (startup.ts) runs the four checks
 *     at `[Service.init]` time and returns a {@link StartupIntegrityReport}:
 *       1. the operational DB (quick_check + user_version + structure —
 *          the probes ride on the store's own `openDatabase`, WP-2.1);
 *       2. the `.research/` declarative 真源 load (the WP-1.1 loader's
 *          error-aggregated result, classified into ok / degraded / fatal);
 *       3. the Git workspace boundary (§5.1 conflict detection + the
 *          TC-GIT-001 dirty-tree semantics);
 *       4. a dual-真源 consistency SPOT check (declarative lifecycle vs
 *          History; project scope vs registered id).
 *   - every finding is classed {@link CheckStatus}:
 *       `pass`          — healthy;
 *       `recoverable`   — 可恢复: a known mechanism or user action fixes it
 *                         (derived-state rebuild / loud reconciliation /
 *                         explicit user entry); startup may proceed in a
 *                         DEGRADED mode with the service surface narrowed;
 *       `unrecoverable` — 不可恢复: the build cannot proceed; a structured
 *                         error with user guidance is produced (绝不静默);
 *       `skipped`       — a prerequisite check failed so this check could
 *                         not run (the reason is always stated).
 *   - {@link assertStartup} turns a `fatal` report into a
 *     `HardeningFatalError` (the dsh-adapter's fiber-FAILED path,
 *     TC-DSH-008); a `degraded` report proceeds with loud logging + the
 *     narrowed surface flags.
 *
 * Read-only by construction: this layer only READS the two 真源 at startup
 * (store probe reads + file reads + whitelisted git reads). It never
 * repairs, never inits, never rewrites — the convergence mechanisms are
 * the already-delivered startup reconciliations (wiring) and the
 * explicit user operations (GIT_INTEGRATION §6/§9). The single exception
 * is the RESERVED migration mechanism (migrations.ts), which pre-release
 * is not wired into any live path (the registry is empty; the open path
 * still rejects version mismatch — DSH_ADAPTER §9).
 *
 * No DSH imports (INV-PERM-5): `node:sqlite`/`node:fs` are Node builtins;
 * git access goes through the `src/host/git` layer (the sole spawn point,
 * INV-GIT-6) behind the injectable {@link GitOps} port.
 */

import type {
  ConflictFlags,
  ConflictState,
  GitStatus,
  RepoDetection,
} from '../../git/index.js'
import type { LoadResult, ResearchFileReader, ResearchLoadError, ResearchTree } from '../../domain/loader/index.js'
import type { ResearchStore } from '../store/index.js'

/* ==================================================================== *
 * Check results
 * ==================================================================== */

/** The disposition class of one integrity check (see module header). */
export type CheckStatus = 'pass' | 'recoverable' | 'unrecoverable' | 'skipped'

/**
 * A structured log injection (same shape as the wiring's logger —
 * 「loud」 means at minimum a structured log entry the fiber can see).
 * Declared here rather than imported from the service layer: the
 * persistence layer must not depend upward on service/.
 */
export interface IntegrityLogger {
  readonly info: (step: string, message: string) => void
  readonly warn: (step: string, message: string) => void
  readonly error: (step: string, message: string) => void
}

/**
 * Check 1 — the operational database (the WP-2.1 `openDatabase` open path
 * IS the integrity check: permissions, WAL, `quick_check` corruption
 * probe, `user_version` gate, V1 structure verification).
 *
 * TC-DB-002 semantics: a damaged file fails here with a structured
 * error (「明确报错」) — never a raw driver exception, never a repair
 * attempt. Classification:
 *   - `STORE_CORRUPT` / `STORE_VERSION` / `STORE_SCHEMA_STALE` /
 *     `STORE_OPEN` → `unrecoverable` (the §10 rows: operational data is
 *     NOT recoverable — V1 has no event export/backup; the remedy is the
 *     user's, always stated in {@link guidance});
 *   - unexpected (non-`StoreError`) failure → `unrecoverable` with
 *     `UNEXPECTED` (fail loud, never silent).
 */
export interface DbCheckResult {
  readonly status: Extract<CheckStatus, 'pass' | 'unrecoverable'>
  /** The underlying `StoreError` code (STORE_*) on failure; `UNEXPECTED`
   *  when the open path escaped its own taxonomy. */
  readonly code?: string
  /** The `user_version` when the DB opened (always 1 in V1). */
  readonly userVersion?: number
  /** One-line finding (the store error message on failure). */
  readonly message: string
  /** Structured user-facing remedy — non-empty whenever status ≠ pass. */
  readonly guidance: readonly string[]
}

/**
 * {@link checkDatabase} outcome: the classified result + the open store
 * handle (ONLY when the check passed — the orchestrator's consistency
 * spot check probes through it; the orchestrator closes it, always).
 */
export interface DbCheckOutcome {
  readonly result: DbCheckResult
  readonly handle: ResearchStore | null
}

/**
 * Check 2 — the `.research/` declarative 真源 load (the WP-1.1 loader's
 * error-aggregated `LoadResult`, classified per ARCHITECTURE §10 row
 * 「`.research/` 文件非法 → 拒绝加载该文件并报错定位（文件+字段），不猜测
 * 修复；其余文件正常加载」):
 *
 *   `fatal` — the tree cannot serve as a 真源 AT ALL (missing research
 *             root, missing `project.yaml`/`schema-version`, an
 *             unsupported contract version, a broken FROZEN schema set —
 *             plugin-side fault): startup refuses (fail loud).
 *   `degraded` — one or more individual files are broken (schema/parse/
 *             path-id/reference-integrity violations, a broken required
 *             topic/workstream/contract, an unknown layout entry): the
 *             broken files are REJECTED with precise file+field location,
 *             the rest load (the loader already did that); startup may
 *             proceed on the READONLY usable surface (the write surface
 *             is refused — it must not commit or mutate a partially
 *             broken 真源), with a loud warning per broken file.
 */
export interface TreeCheckResult {
  readonly status: Extract<CheckStatus, 'pass' | 'recoverable' | 'unrecoverable'>
  /** `recoverable` = partial breakage (degraded surface);
   *  `unrecoverable` = the tree is unusable (fatal). */
  readonly usable: boolean
  /** The loader's full result (the orchestrator needs `tree` for the
   *  consistency spot check). */
  readonly load: LoadResult
  readonly fatalErrors: readonly ResearchLoadError[]
  /** The per-file broken entries (each precisely located: file + field). */
  readonly degradedErrors: readonly ResearchLoadError[]
  readonly guidance: readonly string[]
}

/**
 * Check 3 — the Git workspace boundary (GIT_INTEGRATION §5.1 冲突状态检测
 * + §9 错误分类 + the TC-GIT-001 dirty-tree semantics):
 *
 *   - git executable missing / not a repo → §10 row: refuse MANAGED
 *     research mode (checkpoint / git history / restore), provide the
 *     explicit 「Initialize Git Repository」 operation entry, 绝不静默
 *     init → `recoverable` (the read surface over `.research/` files is
 *     unaffected), `managedMode: 'refused'`;
 *   - merge/rebase/cherry-pick/revert in progress (§5.1 flags) → the
 *     checkpoint is EXPLICITLY refused (INV-GIT-4, the user resolves
 *     first), the read surface is unaffected (working copy IS the
 *     canonical current state) → `recoverable`, `checkpointAllowed: false`;
 *   - dirty working tree (TC-GIT-001) → reads are unaffected; the
 *     checkpoint remains allowed and commits ONLY `.research/**` (the
 *     unrelated dirty state is preserved, never unstaged/cleaned) →
 *     `pass` with the dirty facts recorded;
 *   - git itself errors (repo corruption, §9「原样展示，不修复」) →
 *     `recoverable`, managed mode refused, the git error shown verbatim.
 */
export interface GitCheckResult {
  readonly status: CheckStatus
  readonly repoDetected: boolean
  /** The detected repo root (W1 `--show-toplevel`) when detected. */
  readonly repoRoot: string | null
  readonly conflictInProgress: boolean
  readonly conflictFlags?: ConflictFlags
  /** The §5.1 active-flag description for messages (when in progress). */
  readonly conflictDetail?: string
  /** True when `git status` reports any entry (tracked/untracked/…). */
  readonly dirty: boolean
  /** The dirty entries under the `.research` dir (repo-root-relative). */
  readonly dirtyResearchPaths: readonly string[]
  /** `refused` = managed research mode is off (git missing / not a repo /
   *  git erroring) — the read surface stays available. */
  readonly managedMode: 'ok' | 'refused'
  readonly checkpointAllowed: boolean
  /** The sub-reason when the check did not pass (diagnostics). */
  readonly reason?: 'git-missing' | 'not-a-repo' | 'conflict-in-progress' | 'repo-error'
  readonly message: string
  readonly guidance: readonly string[]
}

/**
 * Check 4 — the dual-真源 consistency SPOT check (ARCHITECTURE §4 双真源):
 * the declarative side (workstream.yaml `lifecycle`) is cross-checked
 * against the operational side (History: does the workstream have
 * events?) for a bounded sample of workstreams, plus the project-scope
 * cross-check (`.research/project.yaml` id vs the registered project
 * id under which the DB lives, DSH_ADAPTER §9 data dir).
 *
 * Divergences are classed, not guessed at (the convergence mechanisms
 * are the already-delivered startup reconciliations, run loud by the
 * wiring AFTER this check):
 *   - `file-leads`  (file REALIZED, History empty)  — RR-010 crash-window
 *     residue; recoverable: the lifecycle reconciliation rolls the file
 *     back to PLANNED (loud);
 *   - `file-trails` (file PLANNED, History non-empty) — the flip half was
 *     lost; recoverable: the reconciliation converges the file forward
 *     to REALIZED (loud);
 *   - `project-id-mismatch` — the DB scope and the declarative 真源
 *     disagree about WHICH project this is: unrecoverable (the plugin
 *     must not guess which side to rewrite; startup refuses with the
 *     guidance to restore one of the two).
 */
export type ConsistencyFindingKind = 'file-leads' | 'file-trails' | 'project-id-mismatch'

export interface ConsistencyFinding {
  readonly kind: ConsistencyFindingKind
  /** For the workstream findings. */
  readonly workstreamId?: string
  /** The finding, one line (always loud — it lands in the report and the log). */
  readonly message: string
}

export interface ConsistencyCheckResult {
  readonly status: CheckStatus
  /** The workstreams actually probed (the sample, sorted by id). */
  readonly checked: readonly string[]
  readonly findings: readonly ConsistencyFinding[]
  /** True when the project-id cross-check ran (the tree carried a
   *  project doc + the DB was open). */
  readonly projectIdChecked: boolean
  /** Why a skipped check could not run (always stated — never silent). */
  readonly skipReason?: string
  readonly message: string
  readonly guidance: readonly string[]
}

/* ==================================================================== *
 * The aggregated startup report
 * ==================================================================== */

/**
 * The outcome of the whole startup integrity pass:
 *   `ok`       — every check passed;
 *   `degraded` — only `recoverable` findings; startup proceeds with the
 *                narrowed surface flags + loud logging;
 *   `fatal`    — at least one `unrecoverable` finding; `assertStartup`
 *                throws `HardeningFatalError` (the caller fails loud,
 *                TC-DSH-008).
 */
export type StartupOutcome = 'ok' | 'degraded' | 'fatal'

/**
 * The service surface the plugin MAY serve after the checks:
 *   `readonly` — only the read surface (browsing/loadable declarative
 *                objects, History reads): the write surface (checkpoint,
 *                plan mutations, event appends over the broken declarative
 *                真源) is refused — set when the `.research` tree is
 *                partially broken (a broken 真源 must not be written on);
 *   `ok`       — the full surface (git conflict/missing states narrow
 *                `checkpointAllowed`/`managedMode` individually but do not
 *                make the surface read-only: the declarative files are
 *                intact).
 */
export type ReadSurface = 'ok' | 'readonly'

export interface StartupIntegrityReport {
  readonly outcome: StartupOutcome
  readonly db: DbCheckResult
  readonly tree: TreeCheckResult
  readonly git: GitCheckResult
  readonly consistency: ConsistencyCheckResult
  /** Effective after the checks (see {@link ReadSurface}). */
  readonly readSurface: ReadSurface
  /** Managed research mode (git-backed operations): `refused` per §10
   *  when git is missing / not a repo / erroring. */
  readonly managedMode: 'ok' | 'refused'
  /** The checkpoint gate (TC-GIT-001 + §5.1: dirty does NOT block;
   *  conflict-in-progress / refused managed mode / broken tree do). */
  readonly checkpointAllowed: boolean
  /** Every non-pass guidance item, check-prefixed — the user-facing
   *  「明确报错 + 用户指引」 (empty only when outcome is `ok`). */
  readonly guidance: readonly string[]
  /** One-paragraph summary for the log/UI. */
  readonly summary: string
  /** The checked scope (echoed for diagnostics). */
  readonly projectId: string
  readonly dbPath: string
  readonly researchRoot: string
}

/* ==================================================================== *
 * The orchestrator input
 * ==================================================================== */

/**
 * The git operations the checks need — the structural port over the
 * `src/host/git` layer (its default implementation IS the real layer:
 * W1 `detectRepo`, §5.1 `detectConflictState`, W4 `status`). Tests
 * inject fakes to reach the ENOENT / repo-error forms that need no
 * real git misbehavior.
 */
export interface GitOps {
  readonly detectRepo: (root: string) => Promise<RepoDetection>
  readonly detectConflictState: (root: string) => Promise<ConflictState>
  readonly status: (root: string) => Promise<GitStatus>
}

export interface StartupIntegrityInput {
  /** Absolute path of `research.sqlite` (DSH_ADAPTER §9). */
  readonly dbPath: string
  /** Absolute path of the workspace (Git) root. */
  readonly repoRoot: string
  /** Absolute path of the `.research` directory. */
  readonly researchRoot: string
  /** Absolute path of the frozen declarative schema dir (WR `schema/declarative`). */
  readonly schemaDir: string
  /** The registered project scope (`PRJ-<n>` — the data dir's key). */
  readonly projectId: string
  /** The file reader (the production `FsReader`; a fake in tests). */
  readonly reader: ResearchFileReader
  /** The `.research` directory NAME (for the dirty-path filter; default
   *  `'.research'`). */
  readonly researchDir?: string
  /** Max workstreams the consistency spot check probes (default 16 —
   *  the first N by sorted id; the rest are NOT silently dropped from
   *  the report: `checked` says exactly what was probed). */
  readonly maxConsistencySample?: number
  /** Injectable git port (default: the real `src/host/git` layer). */
  readonly git?: GitOps
  /** Structured log sink (「loud」). */
  readonly logger?: IntegrityLogger
}

/** The dual-真源 spot check input (a standalone public entry point —
 *  the orchestrator composes it; the wiring/tests may reuse it). */
export interface DualTruthConsistencyInput {
  /** An OPEN store handle (the caller keeps ownership/closing). */
  readonly store: ResearchStore
  /** The loaded declarative tree (the WP-1.1 loader result). */
  readonly tree: ResearchTree
  /** The registered project scope to cross-check. */
  readonly projectId: string
  /** Max workstreams to probe (default 16). */
  readonly maxSample?: number
}

/** The default sample bound for the consistency spot check. */
export const DEFAULT_CONSISTENCY_SAMPLE = 16
