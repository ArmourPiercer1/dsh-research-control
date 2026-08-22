/**
 * TC-GIT-010 (TEST_MATRIX §3.3): cherry-pick 进行中.
 * 断言要点: 同 TC-GIT-008 (CHERRY_PICK_HEAD 标志).
 */
import { describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { makeTempRepo, type TempRepo } from './temp-repo.js'

describe('TC-GIT-010 cherry-pick 进行中 (INV-GIT-4)', () => {
  it('CHERRY_PICK_HEAD 存在 → checkpoint 拒绝 (fail loud)', async () => {
    const repo: TempRepo = await makeTempRepo({ conflict: 'cherry-pick' })
    try {
      const state = await git.detectConflictState(repo.root)
      expect(state.inProgress).toBe(true)
      expect(state.flags).toEqual({
        mergeHead: false,
        cherryPickHead: true,
        revertHead: false,
        rebaseApply: false,
        rebaseMerge: false,
      })

      await expect(git.saveCheckpoint(repo.root, 'TC-010 cherry-pick in progress')).rejects.toMatchObject({
        code: 'GIT_CONFLICT',
      })
    } finally {
      await repo.dispose()
    }
  })
})
