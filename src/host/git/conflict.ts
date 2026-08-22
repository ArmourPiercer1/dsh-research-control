/**
 * WP-1.2 — Git wrapper: §5.1 冲突状态检测.
 *
 * 每次 checkpoint 前必须执行 (§5 步骤 1): 先 W2 定位 git dir, 再检查五个
 * 「仓库处于进行中操作」标志文件/目录:
 *
 *   <gitdir>/MERGE_HEAD          merge 进行中
 *   <gitdir>/CHERRY_PICK_HEAD    cherry-pick 进行中
 *   <gitdir>/REVERT_HEAD         revert 进行中
 *   <gitdir>/rebase-apply/       rebase (apply) 进行中
 *   <gitdir>/rebase-merge/       rebase (merge) 进行中
 *
 * 存在任一项 → 拒绝 checkpoint (INV-GIT-4 fail loud)。
 *
 * 双保险 (照录 §5.1): 即便检测遗漏, git 本身也会拒绝 (实测: merge 进行中
 * 执行 pathspec commit 返回 `fatal: cannot do a partial commit during a
 * merge.`, exit 128) — 本层从不单独依赖检测。
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { GitConflictStateError } from './errors.js'
import { resolveGitDir } from './operations.js'
import type { ConflictFlags, ConflictState, GitOptions } from './types.js'

function flagPresent(dir: string, name: string, wantDir: boolean): boolean {
  try {
    const st = statSync(join(dir, name))
    return wantDir ? st.isDirectory() : st.isFile()
  } catch {
    return false
  }
}

/** §5.1: `git rev-parse --git-dir` + 五个标志文件/目录存在性. */
export async function detectConflictState(root: string, opts?: GitOptions): Promise<ConflictState> {
  const gitDir = await resolveGitDir(root, opts)
  const flags: ConflictFlags = {
    mergeHead: flagPresent(gitDir, 'MERGE_HEAD', false),
    cherryPickHead: flagPresent(gitDir, 'CHERRY_PICK_HEAD', false),
    revertHead: flagPresent(gitDir, 'REVERT_HEAD', false),
    rebaseApply: flagPresent(gitDir, 'rebase-apply', true),
    rebaseMerge: flagPresent(gitDir, 'rebase-merge', true),
  }
  return {
    gitDir,
    flags,
    inProgress:
      flags.mergeHead || flags.cherryPickHead || flags.revertHead || flags.rebaseApply || flags.rebaseMerge,
  }
}

/** Describe the active flags for error messages. */
export function describeConflictFlags(flags: ConflictFlags): string {
  const active: string[] = []
  if (flags.mergeHead) active.push('MERGE_HEAD (merge 进行中)')
  if (flags.cherryPickHead) active.push('CHERRY_PICK_HEAD (cherry-pick 进行中)')
  if (flags.revertHead) active.push('REVERT_HEAD (revert 进行中)')
  if (flags.rebaseApply) active.push('rebase-apply/ (rebase 进行中)')
  if (flags.rebaseMerge) active.push('rebase-merge/ (rebase 进行中)')
  return active.join(', ')
}

/** 拒绝 (fail loud) when the repository is mid-operation — §5 步骤 1. */
export function assertNoConflictState(state: ConflictState): void {
  if (state.inProgress) {
    throw new GitConflictStateError(state.flags, describeConflictFlags(state.flags))
  }
}
