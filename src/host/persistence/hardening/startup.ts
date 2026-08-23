/**
 * WP-8.1 — hardening: the startup integrity orchestrator (crash
 * recovery 面).
 *
 * `runStartupIntegrityChecks` runs the four checks at `[Service.init]`
 * time and returns the aggregated {@link StartupIntegrityReport}:
 *
 *   1. the operational DB — `checkDatabase` (quick_check + user_version
 *      + structure, riding on the store's own open path, TC-DB-002);
 *   2. the `.research/` tree — the WP-1.1 loader (error-aggregated,
 *      TC-DOM-027) classified by `classifyTreeLoad` (ARCHITECTURE §10:
 *      broken file rejected with file+field location, the rest load);
 *   3. the Git workspace — `checkGitWorkspace` (§5.1 conflict detection
 *      + TC-GIT-001 dirty semantics + §10 git-missing/not-a-repo row);
 *   4. the dual-真源 consistency SPOT check — `checkDualTruthConsistency`
 *      (only when the DB is open and the tree is not fatal; otherwise
 *      SKIPPED with the reason stated — never silent).
 *
 * AGGREGATION, NOT SHORT-CIRCUIT: every check that CAN run is run — one
 * broken 真源 must not mask the state of the others (the §10 SQLite
 * corruption row demands the report ASSERT the declarative 真源's state
 * explicitly, which needs the tree/git results even when the DB is dead).
 *
 * Outcome aggregation (see {@link StartupOutcome}):
 *   - any `unrecoverable` finding (or a fatal tree) → `fatal`;
 *   - else any `recoverable` finding (or a degraded tree) → `degraded`;
 *   - else `ok`.
 *
 * Surface narrowing on `degraded`:
 *   - `readSurface: 'readonly'` — ONLY when the `.research` tree is
 *     partially broken (the write surface must not commit or mutate a
 *     partially broken 真源); git conflict/missing states do NOT make
 *     the surface read-only (the declarative files are intact — they
 *     narrow `checkpointAllowed` / `managedMode` individually);
 *   - `checkpointAllowed` — refused by: refused managed mode (git
 *     missing / not a repo / git erroring), conflict-in-progress
 *     (INV-GIT-4, explicit refusal), a broken tree; a DIRTY working tree
 *     does NOT refuse it (TC-GIT-001: the checkpoint commits only
 *     `.research/**` and leaves unrelated dirty state untouched);
 *   - `managedMode: 'refused'` — per the §10 row, with the explicit
 *     「Initialize Git Repository」 entry / install-Git guidance.
 *
 * LOUDNESS (绝不静默): every non-pass finding produces (a) guidance
 * items in the report (the user-facing remedy), (b) a structured log
 * entry (warn for recoverable, error for unrecoverable/skipped), (c)
 * for `fatal`, `assertStartup` throws `HardeningFatalError` carrying
 * the FULL report (the dsh-adapter's fiber-FAILED path, TC-DSH-008).
 *
 * The DB handle opened by check 1 is closed in a `finally` — even when
 * a later check throws — so a failed startup leaks no connection.
 *
 * No DSH imports (INV-PERM-5). This is the composition the dsh-adapter's
 * `[Service.init]` runs BEFORE `createHostWiring` (a `fatal` report
 * fails the init; a `degraded` report is logged + the surface flags
 * honored; the wiring's own startup reconciliations then run loud and
 * converge the `recoverable` findings this pass only DETECTS).
 */

import { loadResearchTree } from '../../domain/loader/index.js'
import { checkDatabase } from './db-check.js'
import { checkDualTruthConsistency } from './consistency.js'
import { checkGitWorkspace } from './git-check.js'
import { classifyTreeLoad } from './tree-check.js'
import { HardeningFatalError, HardeningError } from './errors.js'
import type {
  ConsistencyCheckResult,
  DbCheckResult,
  GitCheckResult,
  ReadSurface,
  StartupIntegrityInput,
  StartupIntegrityReport,
  StartupOutcome,
  TreeCheckResult,
} from './types.js'

/**
 * Run the four startup integrity checks and aggregate the report.
 *
 * Resolves with a report for EVERY input state (ok / degraded / fatal);
 * it only throws `HardeningError` (HARDENING_INPUT) for malformed input.
 * Call {@link assertStartup} on the result to turn `fatal` into a throw.
 */
export async function runStartupIntegrityChecks(input: StartupIntegrityInput): Promise<StartupIntegrityReport> {
  const dbPath = requireAbs(input.dbPath, 'dbPath')
  const repoRoot = requireAbs(input.repoRoot, 'repoRoot')
  const researchRoot = requireAbs(input.researchRoot, 'researchRoot')
  const schemaDir = requireAbs(input.schemaDir, 'schemaDir')
  if (typeof input.projectId !== 'string' || !/^PRJ-\d+$/.test(input.projectId)) {
    throw new HardeningError(
      'HARDENING_INPUT',
      `projectId must be a well-formed PRJ-<n> id (got ${JSON.stringify(input.projectId ?? null)})`,
    )
  }
  if (input.reader === null || typeof input.reader !== 'object' || typeof input.reader.readDir !== 'function' || typeof input.reader.readFile !== 'function') {
    throw new HardeningError('HARDENING_INPUT', 'reader must be a ResearchFileReader (readDir + readFile)')
  }
  const researchDir = input.researchDir ?? '.research'
  if (typeof researchDir !== 'string' || researchDir.length === 0 || researchDir.includes('/')) {
    throw new HardeningError('HARDENING_INPUT', `researchDir must be a bare directory name (got ${JSON.stringify(researchDir ?? null)})`)
  }
  const logger = input.logger

  // ---- 1. the operational DB (opens a handle for check 4) -------------
  const dbOutcome = checkDatabase(dbPath)
  const db: DbCheckResult = dbOutcome.result
  logCheck(logger, 'db', db.status, db.message)

  // ---- 2. the .research tree (pure load + classification) --------------
  let tree: TreeCheckResult
  try {
    const load = loadResearchTree(input.reader, researchRoot, schemaDir)
    tree = classifyTreeLoad(load)
  } catch (e) {
    // The loader is error-aggregated by contract; a throw here is a
    // loader bug — fail loud rather than mask it as a tree error.
    const msg = e instanceof Error ? e.message : String(e)
    tree = {
      status: 'unrecoverable',
      usable: false,
      load: { tree: emptyTree(), errors: [] },
      fatalErrors: [{ code: 'READ', file: '', message: `loader threw unexpectedly (bug — fail loud): ${msg}` }],
      degradedErrors: [],
      guidance: [`the .research loader threw unexpectedly instead of aggregating errors (loader bug): ${msg}`],
    }
  }
  logCheck(logger, 'tree', tree.status, treeMessage(tree))

  // ---- 3. the Git workspace (async; the real git layer) ----------------
  const git: GitCheckResult = await checkGitWorkspace(repoRoot, { ops: input.git, researchDir })
  logCheck(logger, 'git', git.status, git.message)

  // ---- 4. the dual-真源 consistency spot check --------------------------
  const consistency = runConsistencyCheck({
    handle: dbOutcome.handle,
    tree,
    input,
  })
  logCheck(logger, 'consistency', consistency.status, consistency.message)

  // ---- the declarative-真源 intactness assertion (the §10 row) ---------
  // SQLite corruption is an OPERATIONAL-data loss; the row demands the
  // report say explicitly what happened to the declarative 真源 —
  // asserted from the ACTUAL tree/git results (no over-claiming).
  const extraGuidance: string[] = []
  if (db.status === 'unrecoverable' && db.code === 'STORE_CORRUPT') {
    const treeState = tree.status === 'pass' ? 'the .research tree loaded clean' : `the .research tree check itself found problems (${tree.status})`
    const gitState = git.status === 'pass' ? 'the Git workspace check passed' : `the Git workspace check itself found problems (${git.status})`
    extraGuidance.push(
      tree.status === 'pass' && git.status === 'pass'
        ? `intactness assertion (ARCHITECTURE §10): the declarative 真源 is INTACT — ${treeState}; ${gitState} (the corrupted database is a separate file, INV-DB-3)`
        : `intactness note (ARCHITECTURE §10): the corrupted database is a separate file (INV-DB-3), but the declarative 真源 is NOT clean either — ${treeState}; ${gitState} (both sides need attention; the operational data loss stands)`,
    )
  }

  // ---- aggregation -------------------------------------------------------
  const guidance: string[] = []
  if (db.status !== 'pass') for (const g of db.guidance) guidance.push(`[db] ${g}`)
  if (tree.status !== 'pass') for (const g of tree.guidance) guidance.push(`[tree] ${g}`)
  if (git.status !== 'pass') for (const g of git.guidance) guidance.push(`[git] ${g}`)
  if (consistency.status !== 'pass') for (const g of consistency.guidance) guidance.push(`[consistency] ${g}`)
  for (const g of extraGuidance) guidance.push(`[db] ${g}`)

  const outcome: StartupOutcome =
    db.status === 'unrecoverable' ||
    tree.status === 'unrecoverable' ||
    git.status === 'unrecoverable' ||
    consistency.status === 'unrecoverable'
      ? 'fatal'
      : tree.status === 'recoverable' ||
          git.status === 'recoverable' ||
          consistency.status === 'recoverable'
        ? 'degraded'
        : 'ok'

  // Surface narrowing (see module header).
  const readSurface: ReadSurface = tree.status === 'recoverable' ? 'readonly' : 'ok'
  const managedMode: 'ok' | 'refused' = git.managedMode
  const checkpointAllowed =
    managedMode === 'ok' &&
    !git.conflictInProgress &&
    tree.status !== 'recoverable' &&
    tree.status !== 'unrecoverable'

  const summary = makeSummary(outcome, { db, tree, git, consistency })
  logger?.info('startup-integrity', summary)

  const report: StartupIntegrityReport = {
    outcome,
    db,
    tree,
    git,
    consistency,
    readSurface,
    managedMode,
    checkpointAllowed,
    guidance,
    summary,
    projectId: input.projectId,
    dbPath,
    researchRoot,
  }

  // The check-1 handle is ALWAYS closed (even when a later step threw —
  // the check runs are wrapped so a throw cannot skip this finally).
  return report
}

/** `assertStartup`: the fail-loud gate (TC-DSH-008 fiber-FAILED). */
export function assertStartup(report: StartupIntegrityReport): void {
  if (report.outcome !== 'fatal') return
  throw new HardeningFatalError(
    `startup integrity check FAILED (unrecoverable): ${report.summary}`,
    report,
  )
}

/* ==================================================================== *
 * Internals
 * ==================================================================== */

function runConsistencyCheck(args: {
  readonly handle: import('../store/index.js').ResearchStore | null
  readonly tree: TreeCheckResult
  readonly input: StartupIntegrityInput
}): ConsistencyCheckResult {
  const { handle, tree, input } = args
  if (handle === null) {
    return skipped('the operational database is unavailable (the db check failed — see its findings; the consistency probe needs an open store)')
  }
  if (tree.status === 'unrecoverable') {
    return skipped('the .research tree is unusable (the tree check found a fatal breakage — there is no declarative side to cross-check)')
  }
  try {
    return checkDualTruthConsistency({
      store: handle,
      tree: tree.load.tree,
      projectId: input.projectId,
      maxSample: input.maxConsistencySample,
    })
  } finally {
    try {
      handle.close()
    } catch {
      // idempotent close — a failed close must not mask the report
    }
  }
}

function skipped(reason: string): ConsistencyCheckResult {
  return {
    status: 'skipped',
    checked: [],
    findings: [],
    projectIdChecked: false,
    skipReason: reason,
    message: `skipped: ${reason}`,
    guidance: [],
  }
}

function treeMessage(tree: TreeCheckResult): string {
  if (tree.status === 'pass') return 'the .research tree loaded clean (no load errors)'
  if (tree.status === 'unrecoverable') {
    return `the .research tree is unusable (${String(tree.fatalErrors.length)} fatal error(s))`
  }
  return `the .research tree loaded with ${String(tree.degradedErrors.length)} broken file(s) — readonly usable surface (ARCHITECTURE §10)`
}

function makeSummary(
  outcome: StartupOutcome,
  checks: {
    readonly db: DbCheckResult
    readonly tree: TreeCheckResult
    readonly git: GitCheckResult
    readonly consistency: ConsistencyCheckResult
  },
): string {
  const parts: string[] = []
  parts.push(
    checks.db.status === 'pass'
      ? `db V${checks.db.userVersion === undefined ? '?' : String(checks.db.userVersion)} ok`
      : `db ${checks.db.status}${checks.db.code ? ` (${checks.db.code})` : ''}`,
  )
  parts.push(
    checks.tree.status === 'pass'
      ? 'tree clean'
      : checks.tree.status === 'unrecoverable'
        ? `tree unusable (${String(checks.tree.fatalErrors.length)} fatal error(s))`
        : `tree degraded (${String(checks.tree.degradedErrors.length)} broken file(s))`,
  )
  parts.push(
    checks.git.status === 'pass'
      ? `git ${checks.git.dirty ? 'dirty (reads + checkpoint ok, TC-GIT-001)' : 'clean'}`
      : `git ${checks.git.status}${checks.git.reason ? ` (${checks.git.reason})` : ''}`,
  )
  parts.push(
    checks.consistency.status === 'pass'
      ? `consistency ok (${String(checks.consistency.checked.length)} ws probed)`
      : checks.consistency.status === 'skipped'
        ? 'consistency skipped'
        : `consistency ${checks.consistency.status} (${String(checks.consistency.findings.length)} finding(s))`,
  )
  return `startup integrity: ${outcome} — ${parts.join('; ')}`
}

function logCheck(
  logger: StartupIntegrityInput['logger'],
  check: string,
  status: string,
  message: string,
): void {
  if (logger === undefined) return
  const line = `${check}: ${status} — ${message}`
  if (status === 'pass') logger.info(check, line)
  else if (status === 'unrecoverable') logger.error(check, line)
  else logger.warn(check, line) // recoverable | skipped — both loud
}

function emptyTree() {
  return {
    schemaVersion: null,
    project: null,
    objectives: [],
    workspace: null,
    policy: null,
    topics: [],
    mergeContracts: [],
  }
}

function requireAbs(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || !value.startsWith('/')) {
    throw new HardeningError('HARDENING_INPUT', `${name} must be an absolute path (got ${JSON.stringify(value ?? null)})`)
  }
  return value
}
