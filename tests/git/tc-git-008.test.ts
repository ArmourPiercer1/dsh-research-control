/**
 * TC-GIT-008 (TEST_MATRIX §3.3): merge 进行中.
 * 断言要点: checkpoint 拒绝 (标志文件检测 + git 自身
 * `cannot do a partial commit during a merge` exit 128 双保险).
 *
 * §5.2 实测行为固化 (2026-08-21) 第 3 条: 「merge 冲突进行中的 pathspec
 * commit → fatal: cannot do a partial commit during a merge., exit 128」。
 * 双保险语义照录 §5.1: 即便检测遗漏, git 本身也会拒绝。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { makeTempRepo, type TempRepo } from './temp-repo.js'

describe('TC-GIT-008 merge 进行中 (INV-GIT-4 双保险)', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('标志文件检测拒绝 + git 自身 exit 128 拒绝; 仓库未被插件触碰', async () => {
    repo = await makeTempRepo({ conflict: 'merge' })
    const root = repo.root
    const headBefore = await repo.head()

    // ① 标志文件检测 (§5.1): MERGE_HEAD 存在 → inProgress
    const state = await git.detectConflictState(root)
    expect(state.inProgress).toBe(true)
    expect(state.flags).toEqual({
      mergeHead: true,
      cherryPickHead: false,
      revertHead: false,
      rebaseApply: false,
      rebaseMerge: false,
    })

    // ① checkpoint 拒绝 (fail loud, INV-GIT-4)
    await expect(git.saveCheckpoint(root, 'TC-008 merge in progress')).rejects.toMatchObject({
      code: 'GIT_CONFLICT',
    })

    // ② 双保险: git 自身拒绝 (§5.2 实测, exit 128) — 由夹具直接执行
    //    白名单 W10 形状的 pathspec commit, 验证即便绕过检测 git 也会拒绝
    const raw = await repo.git(['commit', '-m', 'research: should be refused', '--', '.research/'], {
      fail: true,
    })
    expect(raw.exitCode).toBe(128)
    expect(raw.stderr).toContain('cannot do a partial commit during a merge')

    // 插件未触碰仓库: HEAD 未变, 冲突状态仍在
    expect(await repo.head()).toBe(headBefore)
    expect((await git.detectConflictState(root)).flags.mergeHead).toBe(true)
  })
})
