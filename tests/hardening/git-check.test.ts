/**
 * WP-8.1 — check 3: the Git workspace boundary at startup
 * (GIT_INTEGRATION §5.1 冲突状态检测 + §9 错误分类 + TC-GIT-001 dirty
 * semantics + the ARCHITECTURE §10 git-missing/not-a-repo row).
 *
 * Real git where it matters (a real temp repo: dirty tree, a REAL merge
 * conflict leaving MERGE_HEAD, a planted rebase-merge/ marker); the
 * ENOENT and repo-error forms ride the injectable GitOps port (the
 * production default IS the real layer — pinned in a dedicated case).
 *
 * The contract pinned here (「dirty 允许只读面、checkpoint 显式拒绝」
 * reads: dirty ALLOWS the read surface — and the checkpoint per
 * TC-GIT-001; conflict EXPLICITLY REFUSES the checkpoint):
 *   - not-a-repo / git-missing → managedMode refused + explicit
 *     「Initialize Git Repository」/install entry, 绝不静默 init;
 *   - conflict in progress → checkpointAllowed false, read surface ok;
 *   - dirty → pass: reads unaffected, checkpointAllowed true (commits
 *     only .research/**);
 *   - git erroring → repo-error: managed mode refused, shown as-is.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  checkGitWorkspace,
  realGitOps,
} from '../../src/host/persistence/hardening/index.js'
import { GitCommandError, GitMissingError, type ConflictState, type RepoDetection, type GitStatus } from '../../src/host/git/index.js'
import { makeWorkspace } from './helpers.js'

/** A git invocation that may fail (the conflict-creating merge). */
function gitMayFail(root: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

function git(root: string, args: string[]): string {
  const res = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`)
  return (res.stdout ?? '').trim()
}

describe('checkGitWorkspace — the §10 git-missing / not-a-repo row', () => {
  it('a workspace that is NOT a git repo: managed mode refused, explicit init entry, no silent init', async () => {
    const ws = makeWorkspace({ git: false })
    const r = await checkGitWorkspace(ws.repoRoot)
    expect(r.status).toBe('recoverable')
    expect(r.reason).toBe('not-a-repo')
    expect(r.repoDetected).toBe(false)
    expect(r.managedMode).toBe('refused')
    expect(r.checkpointAllowed).toBe(false)
    expect(r.conflictInProgress).toBe(false)
    const all = r.guidance.join('\n')
    expect(all).toContain('Initialize Git Repository')
    expect(all).toContain('绝不静默 init')
    expect(all).toContain('REFUSED')
  })

  it('the git executable missing (injected ENOENT): install guidance, read surface unaffected', async () => {
    const ws = makeWorkspace()
    const fakeOps = {
      detectRepo: async () => {
        throw new GitMissingError('git executable not found (spawn ENOENT)')
      },
      detectConflictState: async (): Promise<ConflictState> => {
        throw new Error('unreachable')
      },
      status: async (): Promise<GitStatus> => {
        throw new Error('unreachable')
      },
    }
    const r = await checkGitWorkspace(ws.repoRoot, { ops: fakeOps })
    expect(r.status).toBe('recoverable')
    expect(r.reason).toBe('git-missing')
    expect(r.managedMode).toBe('refused')
    expect(r.checkpointAllowed).toBe(false)
    const all = r.guidance.join('\n')
    expect(all).toContain('install Git')
    expect(all).toContain('unaffected')
  })
})

describe('checkGitWorkspace — the TC-GIT-001 dirty-tree semantics', () => {
  it('a dirty working tree: pass — reads unaffected, the checkpoint REMAINS allowed (.research only)', async () => {
    const ws = makeWorkspace()
    // dirty: an unrelated untracked file + a .research edit (the repo's
    // tracked non-.research set is empty — the initial commit carries the
    // tree only; an untracked stray stands in for unrelated dirt)
    writeFileSync(join(ws.repoRoot, 'unrelated.txt'), 'stray untracked\n')
    writeFileSync(join(ws.researchRoot, 'topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml'), 'id: T-1\ngoal: edited\n')

    const r = await checkGitWorkspace(ws.repoRoot)
    expect(r.status).toBe('pass')
    expect(r.repoDetected).toBe(true)
    expect(r.repoRoot).toBe(ws.repoRoot)
    expect(r.conflictInProgress).toBe(false)
    expect(r.dirty).toBe(true)
    // the .research dirty paths are reported repo-root-relative
    expect(r.dirtyResearchPaths).toContain('.research/topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml')
    // TC-GIT-001: dirty does NOT block — the checkpoint stays allowed
    expect(r.checkpointAllowed).toBe(true)
    expect(r.managedMode).toBe('ok')
    expect(r.message).toContain('TC-GIT-001')
  })

  it('a clean working tree: pass, no dirty facts', async () => {
    const ws = makeWorkspace()
    const r = await checkGitWorkspace(ws.repoRoot)
    expect(r.status).toBe('pass')
    expect(r.dirty).toBe(false)
    expect(r.dirtyResearchPaths).toEqual([])
    expect(r.checkpointAllowed).toBe(true)
    expect(r.message).toContain('clean')
  })
})

describe('checkGitWorkspace — the §5.1 conflict detection (checkpoint 显式拒绝)', () => {
  it('a REAL in-progress merge (MERGE_HEAD present): checkpoint explicitly refused, read surface unaffected', async () => {
    const ws = makeWorkspace()
    const root = ws.repoRoot
    // branch + divergent edits on the same file + a conflicting merge
    git(root, ['checkout', '-q', '-b', 'feature'])
    const file = join(ws.researchRoot, 'topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml')
    const original = readFileSync(file, 'utf8')
    writeFileSync(file, original + '# feature edit\n')
    git(root, ['commit', '-qam', 'feature edit'])
    git(root, ['checkout', '-q', 'main'])
    writeFileSync(file, original + '# main edit\n')
    git(root, ['commit', '-qam', 'main edit'])
    const merge = gitMayFail(root, ['merge', 'feature'])
    expect(merge.status).not.toBe(0) // a real conflict
    expect(git(root, ['rev-parse', '--verify', 'MERGE_HEAD'])).toMatch(/^[0-9a-f]{40}$/)

    const r = await checkGitWorkspace(root)
    expect(r.status).toBe('recoverable')
    expect(r.reason).toBe('conflict-in-progress')
    expect(r.repoDetected).toBe(true)
    expect(r.conflictInProgress).toBe(true)
    expect(r.conflictFlags?.mergeHead).toBe(true)
    expect(r.conflictDetail).toContain('MERGE_HEAD')
    // the explicit checkpoint refusal (INV-GIT-4)
    expect(r.checkpointAllowed).toBe(false)
    // but managed mode itself is still ok (a healthy repo) + the read surface is unaffected
    expect(r.managedMode).toBe('ok')
    const all = r.guidance.join('\n')
    expect(all).toContain('EXPLICITLY REFUSED')
    expect(all).toContain('unaffected')
  })

  it('a planted rebase-merge/ marker: the §5.1 flag set detects it (checkpoint refused)', async () => {
    const ws = makeWorkspace()
    const root = ws.repoRoot
    const gitDir = git(root, ['rev-parse', '--git-dir'])
    const absGitDir = join(root, gitDir)
    mkdirSync(join(absGitDir, 'rebase-merge'), { recursive: true })

    const r = await checkGitWorkspace(root)
    expect(r.conflictInProgress).toBe(true)
    expect(r.conflictFlags?.rebaseMerge).toBe(true)
    expect(r.conflictFlags?.mergeHead).toBe(false)
    expect(r.checkpointAllowed).toBe(false)
    expect(r.reason).toBe('conflict-in-progress')
  })
})

describe('checkGitWorkspace — git itself erroring (repo 损坏, §9: 原样展示, 不修复)', () => {
  it('a git command error (injected GitCommandError): shown as-is, managed mode refused', async () => {
    const ws = makeWorkspace()
    const fakeOps = {
      detectRepo: async (): Promise<RepoDetection> => ({ ok: true, repoRoot: ws.repoRoot }),
      detectConflictState: async (): Promise<ConflictState> => {
        throw new GitCommandError(['rev-parse', '--git-dir'], 128, '', 'fatal: unable to read head\n')
      },
      status: async (): Promise<GitStatus> => {
        throw new Error('unreachable')
      },
    }
    const r = await checkGitWorkspace(ws.repoRoot, { ops: fakeOps })
    expect(r.status).toBe('recoverable')
    expect(r.reason).toBe('repo-error')
    expect(r.managedMode).toBe('refused')
    expect(r.checkpointAllowed).toBe(false)
    // shown as-is (the git stderr is in the report, verbatim)
    expect(r.message).toContain('unable to read head')
    const all = r.guidance.join('\n')
    expect(all).toContain('does NOT attempt to repair')
    expect(all).toContain('fsck')
  })
})

describe('checkGitWorkspace — the default port IS the real layer', () => {
  it('realGitOps binds the git-layer functions (no shim drift)', () => {
    expect(typeof realGitOps.detectRepo).toBe('function')
    expect(typeof realGitOps.detectConflictState).toBe('function')
    expect(typeof realGitOps.status).toBe('function')
    // and a real repo passes through the default port end-to-end
    const ws = makeWorkspace()
    const r = checkGitWorkspace(ws.repoRoot) // default ops
    return expect(r).resolves.toMatchObject({ status: 'pass', repoDetected: true })
  })
})
