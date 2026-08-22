/**
 * TC-GIT-007 (TEST_MATRIX §3.3): detached HEAD.
 * 断言要点: log/show 正常; checkpoint 给出警告.
 *
 * 依据 §9「detached HEAD → 读操作正常; checkpoint 前警告」与 §5「detached
 * HEAD 状态: 允许但给出明确警告 (提交会落在游离 HEAD 上, 可能被丢弃)」。
 * §5.2 实测第 6 条: 「detached HEAD 下 git log -- <path> / git show
 * <commit>:<path> 正常工作」。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { makeTempRepo, PLAN_PATH, PLAN_V1, TASK1_PATH, type TempRepo } from './temp-repo.js'

describe('TC-GIT-007 detached HEAD', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('log/show 正常; checkpoint 允许但明确警告', async () => {
    repo = await makeTempRepo({ detachedHead: true })
    const root = repo.root
    const headBefore = await repo.head()

    // 状态面: detached (branch.head (detached) → head.kind === 'detached')
    const st0 = await git.status(root)
    expect(st0.head).toEqual({ kind: 'detached', oid: headBefore })
    const conflict = await git.detectConflictState(root)
    expect(conflict.inProgress).toBe(false)

    // 读操作正常 (§5.2 实测第 6 条)
    const log = await git.logFile(root, PLAN_PATH)
    expect(log).toHaveLength(1)
    expect(log[0]!.oid).toBe(headBefore)
    expect(await git.showFile(root, headBefore, PLAN_PATH)).toBe(PLAN_V1)

    // checkpoint: 允许, 但 warnings 含 detached HEAD 警告 (§5)
    await repo.write(TASK1_PATH, 'id: T-1\ngoal: detached edit\n')
    const cp = await git.saveCheckpoint(root, 'TC-007 detached HEAD checkpoint')
    expect(cp.committed).toBe(true)
    expect(cp.commitOid).toMatch(/^[0-9a-f]{40}$/)
    expect(cp.commitOid).not.toBe(headBefore)
    expect(cp.warnings.some((w) => /detached/i.test(w))).toBe(true)

    // 提交落在游离 HEAD 上, 记录在 status 的 branch.oid
    const st1 = await git.status(root)
    expect(st1.head).toEqual({ kind: 'detached', oid: cp.commitOid })
  })
})
