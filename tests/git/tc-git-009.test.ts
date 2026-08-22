/**
 * TC-GIT-009 (TEST_MATRIX §3.3): rebase 进行中.
 * 断言要点: 同 TC-GIT-008 (rebase-apply / rebase-merge 标志).
 *
 * 说明: git 2.53 旧 `am` rebase 后端已不可选, 真实停下的 rebase 写
 * rebase-merge/; §5.1 检测基于标志**存在性**, 故 rebase-apply 变体由夹具
 * 直接注入标志目录 (与检测面一致, 见 temp-repo.ts 头注)。
 */
import { describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { makeTempRepo, type TempRepo } from './temp-repo.js'

describe('TC-GIT-009 rebase 进行中 (INV-GIT-4)', () => {
  for (const kind of ['rebase-apply', 'rebase-merge'] as const) {
    it(`${kind} 标志存在 → checkpoint 拒绝`, async () => {
      const repo: TempRepo = await makeTempRepo({ conflict: kind })
      try {
        const state = await git.detectConflictState(repo.root)
        expect(state.inProgress).toBe(true)
        expect(state.flags[kind === 'rebase-apply' ? 'rebaseApply' : 'rebaseMerge']).toBe(true)
        // 其余标志不受注入影响
        expect(state.flags.mergeHead).toBe(false)
        expect(state.flags.cherryPickHead).toBe(false)
        expect(state.flags.revertHead).toBe(false)

        await expect(git.saveCheckpoint(repo.root, 'TC-009 rebase in progress')).rejects.toMatchObject({
          code: 'GIT_CONFLICT',
        })
      } finally {
        await repo.dispose()
      }
    })
  }
})
