/**
 * TC-GIT-014 (TEST_MATRIX §3.3): 空 checkpoint.
 * 断言要点: `.research/` 无变更 → 「无可提交内容」成功短路, 无空 commit.
 *
 * §5.2 实测行为固化 (2026-08-21) 第 2 条: 「.research/ 无变更时执行
 * pathspec commit → 失败 exit 1 ("no changes added to commit") -> 流程步骤 2
 * 前置短路, 视为成功空操作」。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { makeTempRepo, type TempRepo } from './temp-repo.js'

describe('TC-GIT-014 空 checkpoint (成功短路, §5.2 回归)', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('.research/ 无变更 → committed=false 成功返回, 无空 commit', async () => {
    repo = await makeTempRepo()
    const root = repo.root
    const headBefore = await repo.head()

    const cp = await git.saveCheckpoint(root, 'TC-014 empty checkpoint')
    expect(cp).toEqual({ committed: false, shortCircuited: true, commitOid: null, warnings: [] })

    // 无空 commit: HEAD 未变
    expect(await repo.head()).toBe(headBefore)
  })

  it('仅无关 dirty 时同样短路 (步骤 2 只汇总 .research/**)', async () => {
    repo = await makeTempRepo()
    const root = repo.root
    const headBefore = await repo.head()

    await repo.write('README.md', 'dirty but unrelated\n')
    const cp = await git.saveCheckpoint(root, 'TC-014 empty checkpoint 2')
    expect(cp.committed).toBe(false)
    expect(cp.shortCircuited).toBe(true)
    expect(cp.commitOid).toBeNull()
    expect(await repo.head()).toBe(headBefore)
  })

  it('§5.2 回归: 无前短路直接 pathspec commit → exit 1 (无变更消息)', async () => {
    repo = await makeTempRepo()
    // 夹具直接执行 W10 形状命令 (绕过流程步骤 2), 固化实测行为。
    // git 2.53 实测: 完全干净 → "nothing to commit, working tree clean";
    // 存在无关 dirty/untracked → "no changes added to commit" (§5.2 记录的消息)。
    const raw = await repo.git(['commit', '-m', 'research: direct', '--', '.research/'], {
      fail: true,
    })
    expect(raw.exitCode).toBe(1)
    expect(`${raw.stdout}\n${raw.stderr}`).toMatch(/no changes added to commit|nothing to commit/)
  })
})
