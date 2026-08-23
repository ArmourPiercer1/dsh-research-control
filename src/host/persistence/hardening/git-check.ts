/**
 * WP-8.1 — hardening: check 3, the Git workspace boundary at startup.
 *
 * Orchestrates the already-delivered `src/host/git` layer (the sole spawn
 * point, INV-GIT-6) into the startup classification — GIT_INTEGRATION
 * §5.1 冲突状态检测 + §9 错误分类 + the TC-GIT-001 dirty-tree semantics:
 *
 *   1. W1 `detectRepo` — git executable missing (spawn ENOENT →
 *      `GitMissingError`) or not a repo: the ARCHITECTURE §10 row
 *      「拒绝 managed research mode，给出「Initialize Git Repository」显式
 *      操作入口；绝不静默 init」→ `recoverable`, `managedMode: 'refused'`,
 *      checkpoint refused; the READ surface over `.research/` files is
 *      unaffected (reading a file does not need git).
 *   2. §5.1 `detectConflictState` — any of the five in-progress flags
 *      (MERGE_HEAD / CHERRY_PICK_HEAD / REVERT_HEAD / rebase-apply /
 *      rebase-merge): the checkpoint is EXPLICITLY refused (INV-GIT-4 —
 *      resolve first); the read surface is unaffected (the working copy
 *      IS the canonical current state, §9「读 working copy」) →
 *      `recoverable`, `checkpointAllowed: false`.
 *   3. W4 `status` — a dirty working tree is a NORMAL state (TC-GIT-001):
 *      reads are unaffected and the checkpoint REMAINS allowed — it
 *      commits only `.research/**` and leaves unrelated dirty state
 *      untouched (never unstages, never cleans) → `pass` with the dirty
 *      facts recorded (total entries + the entries under `.research/`).
 *   4. git itself erroring (repo corruption — §9「原样展示 git 错误；插件
 *      不尝试修复」): managed mode refused (checkpoint safety cannot be
 *      verified), the git error shown VERBATIM in the report →
 *      `recoverable`, `reason: 'repo-error'`.
 *
 * The git operations ride on the injectable {@link GitOps} port (default:
 * the real layer) so the ENOENT / repo-error forms are testable without
 * uninstalling git or corrupting a real repo.
 *
 * This check NEVER writes to the repository (no init, no stage, no
 * commit — the read-only startup probe; 绝不静默 init, §10).
 */

import {
  detectConflictState,
  detectRepo,
  GitMissingError,
  status,
  type ConflictFlags,
} from '../../git/index.js'
import { GitError } from '../../git/errors.js'
import type { GitCheckResult, GitOps } from './types.js'

/** The production default: the real `src/host/git` layer. */
export const realGitOps: GitOps = {
  detectRepo: (root) => detectRepo(root),
  detectConflictState: (root) => detectConflictState(root),
  status: (root) => status(root),
}

function describeFlags(flags: ConflictFlags): string {
  const active: string[] = []
  if (flags.mergeHead) active.push('MERGE_HEAD (merge 进行中)')
  if (flags.cherryPickHead) active.push('CHERRY_PICK_HEAD (cherry-pick 进行中)')
  if (flags.revertHead) active.push('REVERT_HEAD (revert 进行中)')
  if (flags.rebaseApply) active.push('rebase-apply/ (rebase 进行中)')
  if (flags.rebaseMerge) active.push('rebase-merge/ (rebase 进行中)')
  return active.join(', ')
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Run the Git workspace boundary check at `root`.
 *
 * Never throws: git-layer failures are classified (see module header).
 * `researchDir` filters the dirty entries reported under the `.research`
 * scope (repo-root-relative paths).
 */
export async function checkGitWorkspace(
  root: string,
  options: { readonly ops?: GitOps; readonly researchDir?: string } = {},
): Promise<GitCheckResult> {
  const ops = options.ops ?? realGitOps
  const researchDir = options.researchDir ?? '.research'

  // ---- 1. repo detection (git executable present? is this a repo?) ----
  let detected: boolean
  let repoRoot: string | null = null
  try {
    const det = await ops.detectRepo(root)
    detected = det.ok
    if (det.ok) repoRoot = det.repoRoot
  } catch (e) {
    if (e instanceof GitMissingError) {
      return {
        status: 'recoverable',
        repoDetected: false,
        repoRoot: null,
        conflictInProgress: false,
        dirty: false,
        dirtyResearchPaths: [],
        managedMode: 'refused',
        checkpointAllowed: false,
        reason: 'git-missing',
        message: 'the git executable is missing (spawn ENOENT) — managed research mode refused',
        guidance: [
          'Git is not installed (or not on PATH) — managed research mode (checkpoint / git history / restore) is REFUSED (ARCHITECTURE §10): the read surface over .research/ files is unaffected',
          'remedy (user action, never automatic): install Git, then restart — the plugin never initializes a repository or installs anything on its own',
        ],
      }
    }
    return repoErrorResult(root, e, 'detectRepo')
  }
  if (!detected) {
    return {
      status: 'recoverable',
      repoDetected: false,
      repoRoot: null,
      conflictInProgress: false,
      dirty: false,
      dirtyResearchPaths: [],
      managedMode: 'refused',
      checkpointAllowed: false,
      reason: 'not-a-repo',
      message: 'the workspace is not a Git repository — managed research mode refused',
      guidance: [
        'this workspace is not a Git repository — managed research mode (checkpoint / git history / restore) is REFUSED (ARCHITECTURE §10); the read surface over .research/ files is unaffected',
        'remedy (user action, never automatic — 绝不静默 init): use the explicit 「Initialize Git Repository」 operation entry to start a repository for this workspace, then restart',
      ],
    }
  }

  // ---- 2. §5.1 conflict state (the five in-progress flags) ------------
  let inProgress = false
  let flags: ConflictFlags | undefined
  try {
    const conflict = await ops.detectConflictState(root)
    inProgress = conflict.inProgress
    flags = conflict.flags
  } catch (e) {
    return repoErrorResult(root, e, 'detectConflictState')
  }

  // ---- 3. working-tree dirtiness (W4 status) --------------------------
  let dirty = false
  let dirtyTotal = 0
  const dirtyResearchPaths: string[] = []
  try {
    const st = await ops.status(root)
    dirty = st.entries.length > 0
    dirtyTotal = st.entries.length
    const prefix = `${researchDir}/`
    for (const entry of st.entries) {
      if (entry.path.startsWith(prefix)) dirtyResearchPaths.push(entry.path)
    }
  } catch (e) {
    return repoErrorResult(root, e, 'status')
  }

  // ---- classification ---------------------------------------------------
  if (inProgress) {
    const detail = describeFlags(flags!)
    return {
      status: 'recoverable',
      repoDetected: true,
      repoRoot,
      conflictInProgress: true,
      conflictFlags: flags,
      conflictDetail: detail,
      dirty,
      dirtyResearchPaths,
      managedMode: 'ok',
      checkpointAllowed: false, // EXPLICIT refusal (INV-GIT-4 / §5.1)
      reason: 'conflict-in-progress',
      message: `repository is mid-operation: ${detail} — checkpoint explicitly refused`,
      guidance: [
        `the repository has an in-progress operation (${detail}) — the checkpoint is EXPLICITLY REFUSED (INV-GIT-4, GIT_INTEGRATION §5.1): resolve it first (finish/abort the merge/rebase/cherry-pick/revert)`,
        'the read surface is unaffected — the working copy IS the canonical current state (GIT_INTEGRATION §9); nothing is auto-resolved or auto-committed by the plugin',
      ],
    }
  }

  const researchCount = dirtyResearchPaths.length
  return {
    status: 'pass',
    repoDetected: true,
    repoRoot,
    conflictInProgress: false,
    conflictFlags: flags,
    dirty,
    dirtyResearchPaths,
    managedMode: 'ok',
    checkpointAllowed: true, // TC-GIT-001: dirty does NOT block the checkpoint
    message: dirty
      ? `dirty working tree (${String(dirtyTotal)} dirty path(s), ${String(researchCount)} under ${researchDir}/) — reads unaffected; the checkpoint commits only ${researchDir}/** (TC-GIT-001)`
      : 'clean working tree (no dirty paths)',
    guidance: [],
  }
}

function repoErrorResult(
  root: string,
  e: unknown,
  step: string,
): GitCheckResult {
  const isGit = e instanceof GitError
  const shown = isGit ? errMsg(e) : `unexpected error during the git check (${step}): ${errMsg(e)}`
  return {
    status: 'recoverable',
    repoDetected: true,
    repoRoot: null,
    conflictInProgress: false,
    dirty: false,
    dirtyResearchPaths: [],
    managedMode: 'refused',
    checkpointAllowed: false,
    reason: 'repo-error',
    message: `git failed during the startup check (${step}) at ${root} — shown as-is, the plugin does not attempt repair (GIT_INTEGRATION §9「repo 损坏」): ${shown}`,
    guidance: [
      `git itself reported an error during the startup check (repo corruption or a git failure) — displayed as-is, the plugin does NOT attempt to repair it (GIT_INTEGRATION §9): ${shown}`,
      'managed research mode (checkpoint / git history / restore) is REFUSED until the repository is healthy again (checkpoint safety cannot be verified); the read surface over .research/ files is unaffected',
      'remedy (user action): inspect the repository (e.g. `git fsck`) and repair it outside the plugin, then restart',
    ],
  }
}
