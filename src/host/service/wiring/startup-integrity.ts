/**
 * WP-8.5 (G8 S2) — the PRODUCTION wiring of the WP-8.1 startup integrity
 * checks: the [Service.init] dependency-graph step 0.5 (the integrity
 * gate), run BEFORE any service is instantiated.
 *
 * The WP-8.1 hardening module (src/host/persistence/hardening) delivered
 * the four-check startup pass as a frozen, fully-tested composition —
 * `runStartupIntegrityChecks` (the async orchestrator) + the four check
 * primitives. G8 round-1 (spec-hunter R1 / host-integrator R2) found the
 * pass had ZERO production callers: the `[Service.init]` graph
 * (createHostWiring) never ran it. This module is the adoption:
 *
 *   - it composes the SAME frozen check primitives the orchestrator
 *     composes (check 1 `checkDatabase` — the store's own open path;
 *     check 2 `loadResearchTree` + `classifyTreeLoad`; check 3
 *     `checkGitWorkspace` — the real git layer; check 4
 *     `checkDualTruthConsistency`) with the orchestrator's identical
 *     aggregation rule (any unrecoverable ⇒ fatal; else any recoverable
 *     ⇒ degraded; else ok; readSurface readonly ⇔ the tree is partially
 *     broken);
 *   - the three SYNCHRONOUS checks (db / tree / consistency) run in the
 *     gate's own step, BEFORE the dependency graph's instantiation steps
 *     (store → registry → … → tools) and BEFORE the step-13 startup
 *     reconciliations: an unrecoverable finding throws a structured
 *     `HostWiringError` (code `WIRING_INTEGRITY`) here — the fiber never
 *     reaches ACTIVE (TC-DSH-008) and NO resource was opened yet (the
 *     gate's own check-1 handle is closed in a finally, always), so the
 *     failed-init-leaks-nothing property holds for free;
 *   - a `recoverable` finding is LOUD (one warn per guidance item, plus
 *     a summary warn) and then AUTO-DISPOSED by the already-delivered
 *     step-13 startup reconciliations (lifecycle convergence →
 *     run-vs-history → semantics rebuild — the frozen convergence
 *     mechanisms this gate only DETECTS, per the WP-8.1 module doc);
 *   - check 3 (the git boundary) is the ONLY async check (the git layer
 *     spawns). The gate FIRES it (no blocking — the dependency graph
 *     step is synchronous, pinned by the frozen test suite) and the
 *     result settles within milliseconds: loud-logged on settle
 *     (pass → info, recoverable → warn + guidance) and exposed on
 *     `wiring.integrity.git`. Git is NEVER fatal — `checkGitWorkspace`
 *     classifies every outcome as pass/recoverable (git-missing /
 *     not-a-repo / conflict-in-progress / repo-error all refuse the
 *     MANAGED mode or the CHECKPOINT, never the read surface; the
 *     runtime refusals are enforced by the git/checkpoint layers
 *     themselves) — so no ACTIVE-blocking decision waits on the async
 *     half. The async orchestrator `runStartupIntegrityChecks` itself
 *     remains the tested canonical composition (tests/hardening) and is
 *     driven end-to-end by the e2e factory as the cross-check that the
 *     production gate and the orchestrator classify the SAME tree
 *     identically (e2e/factory/factory.ts integrity scenarios).
 *
 * V1 boundary (documented, see the WP-8.5 report): a PARTIALLY broken
 * `.research` tree is classified `recoverable` here (the §10 readonly
 * surface — `readSurface: 'readonly'`), but the V1 wiring's WIRING_TREE
 * step (step 3) keeps its STRICT policy — any load error fails startup
 * (frozen by tests/wiring). The `readSurface` flag is still honored at
 * the one tree-write path the wiring owns (the workstream.yaml flip
 * refuses under readonly — a defensive contract for when a follow-up WP
 * adopts the §10 degraded surface).
 *
 * No DSH imports (INV-PERM-5); git access rides the frozen git layer
 * behind the check's own injectable port (INV-GIT-6).
 */

import {
  loadResearchTree,
  type LoadResult,
  type ResearchFileReader,
} from '../../domain/loader/index.js'
import {
  checkDatabase,
  checkDualTruthConsistency,
  checkGitWorkspace,
  classifyTreeLoad,
  type ConsistencyCheckResult,
  type DbCheckResult,
  type GitCheckResult,
  type ReadSurface,
  type StartupOutcome,
  type TreeCheckResult,
} from '../../persistence/hardening/index.js'
import { HostWiringError, type HostWiringLogger } from './types.js'

/** The gate inputs (everything absolute + injectable — the dsh-adapter's
 *  `[Service.init]` resolves the paths; tests/factory inject temps). */
export interface StartupIntegrityGateInput {
  /** Absolute path of `research.sqlite` (DSH_ADAPTER §9 data dir). */
  readonly dbPath: string
  /** Absolute path of the workspace (Git) root. */
  readonly repoRoot: string
  /** Absolute path of the `.research` directory. */
  readonly researchRoot: string
  /** Absolute path of the frozen declarative schema dir (`<schemaRoot>/declarative`). */
  readonly schemaDir: string
  /** The registered project scope (`PRJ-<n>` — the data dir's key). */
  readonly projectId: string
  /** The `.research` directory NAME (for the git dirty-path filter). */
  readonly researchDir: string
  /** The file reader (the wiring's `FsReader`). */
  readonly reader: ResearchFileReader
  /** Structured log sink (「loud」). */
  readonly logger?: HostWiringLogger
  /** Max workstreams the consistency spot check probes (default 16). */
  readonly maxConsistencySample?: number
  /** ADJ-11 (UI-9): `true` when the host's plane RE-INIT (a mid-session
   *  rebuild) created this wiring, not the initial boot. Echoed on the
   *  report surface; the plane projection maps it to the
   *  `WIRING_REINITIALIZED` machine code (a gate-internal code — ADJ-11
   *  sanctions this one new machine code inside the gate, NOT on the
   *  RPC surface). */
  readonly reinitialized?: boolean
}

/**
 * The gate's report surface (exposed on `HostWiring.integrity`): the
 * synchronous check results + the aggregated outcome + the async git
 * boundary promise.
 */
export interface StartupIntegrityGate {
  /** The outcome over the SYNCHRONOUS check subset (db / tree /
   *  consistency) — the git check settles later and is never fatal. */
  readonly outcome: StartupOutcome
  readonly db: DbCheckResult
  readonly tree: TreeCheckResult
  readonly consistency: ConsistencyCheckResult
  /** Effective after the checks (the §10 narrowing: `readonly` ⇔ the
   *  tree is partially broken — honored at the wiring-owned tree-write
   *  path, see module header). */
  readonly readSurface: ReadSurface
  /** Every non-pass guidance item, check-prefixed (user-facing remedy). */
  readonly guidance: readonly string[]
  /** The loader result of check 2 — REUSED by the WIRING_TREE step
   *  (the gate loaded the tree; step 3 must not load it again). */
  readonly treeLoad: LoadResult
  /** Check 3 (the git boundary) — the only async check; settles within
   *  milliseconds of the gate and loud-logs on settle. NEVER rejects
   *  (every outcome is classified — including an unexpected throw,
   *  which is classed repo-error-shaped and loud). */
  readonly git: Promise<GitCheckResult>
  /** ADJ-11 (UI-9): echoes `input.reinitialized` (false unless the host
   *  re-init created this wiring). Session-scoped boot-time state. */
  readonly reinitialized: boolean
}

/**
 * Run the startup integrity gate (module header).
 *
 * @throws {HostWiringError} code `WIRING_INTEGRITY` when any synchronous
 *  check is unrecoverable — BEFORE any resource of the dependency graph
 *  is opened (the caller's fiber fails before ACTIVE, TC-DSH-008).
 */
export function runStartupIntegrityGate(input: StartupIntegrityGateInput): StartupIntegrityGate {
  const logger = input.logger

  // ---- check 1: the operational DB (sync — the store's own open path) --
  const dbOutcome = checkDatabase(input.dbPath)
  const db: DbCheckResult = dbOutcome.result

  // ---- check 2: the .research tree (sync — load + classification) -----
  let treeLoad: LoadResult
  let tree: TreeCheckResult
  try {
    treeLoad = loadResearchTree(input.reader, input.researchRoot, input.schemaDir)
    tree = classifyTreeLoad(treeLoad)
  } catch (e) {
    // The loader is error-aggregated by contract; a throw here is a
    // loader bug — fail loud rather than mask it as a tree error
    // (mirror of the orchestrator's own catch).
    const msg = e instanceof Error ? e.message : String(e)
    treeLoad = { tree: emptyTree(), errors: [] }
    tree = {
      status: 'unrecoverable',
      usable: false,
      load: treeLoad,
      fatalErrors: [{ code: 'READ', file: '', message: `loader threw unexpectedly (bug — fail loud): ${msg}` }],
      degradedErrors: [],
      guidance: [`the .research loader threw unexpectedly instead of aggregating errors (loader bug): ${msg}`],
    }
  }

  // ---- check 4: the dual-真源 consistency spot check (sync) -----------
  const consistency = runConsistencyCheck({
    handle: dbOutcome.handle,
    tree,
    input,
  })

  // ---- aggregation (the orchestrator's rule over the sync subset) -----
  const guidance: string[] = []
  if (db.status !== 'pass') for (const g of db.guidance) guidance.push(`[db] ${g}`)
  if (tree.status !== 'pass') for (const g of tree.guidance) guidance.push(`[tree] ${g}`)
  if (consistency.status !== 'pass') for (const g of consistency.guidance) guidance.push(`[consistency] ${g}`)

  const outcome: StartupOutcome =
    db.status === 'unrecoverable' ||
    tree.status === 'unrecoverable' ||
    consistency.status === 'unrecoverable'
      ? 'fatal'
      : tree.status === 'recoverable' || consistency.status === 'recoverable'
        ? 'degraded'
        : 'ok'

  const readSurface: ReadSurface = tree.status === 'recoverable' ? 'readonly' : 'ok'

  // ---- check 3: the git boundary (the only async check — fired, not
  //     blocked on; loud on settle; exposed for diagnostics) ------------
  const git = fireGitCheck(input.repoRoot, input.researchDir, logger)

  // ---- the gate's disposition (loud, per WP-8.1 分类语义) --------------
  if (outcome === 'fatal') {
    for (const g of guidance) logger?.error('startup-integrity', g)
    throw new HostWiringError(
      'WIRING_INTEGRITY',
      `the startup integrity gate FAILED (unrecoverable — ARCHITECTURE §10 / TC-DSH-008): ` +
        `db=${db.status}${db.code ? ` (${db.code})` : ''}; tree=${tree.status}; consistency=${consistency.status} ` +
        `— refusing to instantiate the service graph. Guidance:\n${guidance.join('\n')}`,
    )
  }
  if (outcome === 'degraded') {
    for (const g of guidance) logger?.warn('startup-integrity', g)
    logger?.warn(
      'startup-integrity',
      `startup integrity GATE: outcome=degraded (db=${db.status}; tree=${tree.status}; consistency=${consistency.status}) ` +
        `— startup PROCEEDS: the recoverable findings are auto-disposed by the step-13 startup reconciliations ` +
        `(lifecycle convergence → run-vs-history → semantics rebuild, loud); readSurface=${readSurface}; ` +
        `the git boundary check settles and logs separately (git is never fatal)`,
    )
  } else {
    logger?.info(
      'startup-integrity',
      `startup integrity GATE: outcome=ok (db=${db.status}; tree=${tree.status}; consistency=${consistency.status}) ` +
        `— the git boundary check settles and logs separately`,
    )
  }

  return { outcome, db, tree, consistency, readSurface, guidance, treeLoad, git, reinitialized: input.reinitialized ?? false }
}

/* ==================================================================== *
 * Internals (mirrors of the frozen orchestrator's own helpers)
 * ==================================================================== */

function runConsistencyCheck(args: {
  readonly handle: import('../../persistence/store/index.js').ResearchStore | null
  readonly tree: TreeCheckResult
  readonly input: StartupIntegrityGateInput
}): ConsistencyCheckResult {
  const { handle, tree, input } = args
  // The check-1 handle is closed on EVERY exit path — the skip branches
  // included (G8 round-2 defect 1: the tree-fatal skip used to return
  // before the close, leaking the sqlite/-wal/-shm fds across the
  // WIRING_INTEGRITY throw; the module header's "ALWAYS closed" claim is
  // pinned by tests/hardening/gate-handle-lifecycle.test.ts).
  try {
    if (handle === null) {
      return skipped('the operational database is unavailable (the db check failed — see its findings; the consistency probe needs an open store)')
    }
    if (tree.status === 'unrecoverable') {
      return skipped('the .research tree is unusable (the tree check found a fatal breakage — there is no declarative side to cross-check)')
    }
    return checkDualTruthConsistency({
      store: handle,
      tree: tree.load.tree,
      projectId: input.projectId,
      maxSample: input.maxConsistencySample,
    })
  } finally {
    if (handle !== null) {
      try {
        handle.close()
      } catch {
        // idempotent close — a failed close must not mask the report
      }
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

/**
 * Fire the git boundary check (the only async one — the git layer spawns).
 * NEVER rejects: `checkGitWorkspace` classifies every git failure
 * (contract); a throw of its own is a bug — classed repo-error-shaped
 * and loud, so the fire-and-forget promise cannot become an unhandled
 * rejection (which would crash the host process — worse than any
 * classification).
 */
function fireGitCheck(repoRoot: string, researchDir: string, logger?: HostWiringLogger): Promise<GitCheckResult> {
  return checkGitWorkspace(repoRoot, { researchDir })
    .then((git) => {
      if (git.status === 'pass') {
        logger?.info('startup-integrity', `git boundary: pass — ${git.message}`)
      } else {
        logger?.warn('startup-integrity', `git boundary: ${git.status} — ${git.message}`)
        for (const g of git.guidance) logger?.warn('startup-integrity', `[git] ${g}`)
      }
      return git
    })
    .catch((e: unknown): GitCheckResult => {
      const msg = e instanceof Error ? e.message : String(e)
      const result: GitCheckResult = {
        status: 'recoverable',
        repoDetected: false,
        repoRoot: null,
        conflictInProgress: false,
        dirty: false,
        dirtyResearchPaths: [],
        managedMode: 'refused',
        checkpointAllowed: false,
        reason: 'repo-error',
        message: `the git boundary check threw unexpectedly (check bug — fail loud): ${msg}`,
        guidance: [
          `the startup git check itself failed unexpectedly: ${msg} — managed research mode is refused (fail-safe); report this message`,
        ],
      }
      logger?.error('startup-integrity', `git boundary: the check threw unexpectedly (bug — fail loud): ${msg}`)
      return result
    })
}

/** The empty-tree shape of a loader that threw before producing a result
 *  (mirror of the orchestrator's own fallback). */
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
