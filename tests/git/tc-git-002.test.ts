/**
 * TC-GIT-002 (TEST_MATRIX §3.3): 无关 staged 变更保护.
 * 断言要点: checkpoint 后: 无关变更不在 commit 中 **且** 仍保持 staged.
 *
 * §5.2 实测行为固化 (2026-08-21, 临时 repo 验证) 第 1 条:
 * 「git add -- .research/ + git commit -m msg -- .research/ (存在无关 staged
 * 修改 + 新增未跟踪 .research 文件) → commit 只含 .research/ 的修改与新增;
 * 无关 staged 修改**未**进入 commit, 且事后仍保持 staged」。
 *
 * 夹具说明: 插件白名单 W9 的 pathspec 固定为 .research/, 无法暂存其他路径 —
 * 无关 staged 状态由测试基建 (temp-repo raw git) 注入, 这正是被测保护对象。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { makeTempRepo, TASK2_PATH, type TempRepo } from './temp-repo.js'

describe('TC-GIT-002 无关 staged 变更保护 (§5.2 回归)', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('无关 staged 修改: 未进入 commit, 且事后仍保持 staged', async () => {
    repo = await makeTempRepo()
    const root = repo.root

    // 无关 staged 修改 (README.md 已 git add)
    await repo.write('README.md', 'user staged an unrelated edit\n')
    await repo.git(['add', '--', 'README.md'])
    const st0 = await git.status(root)
    expect(st0.entries.find((e) => e.path === 'README.md')!.x).toBe('M')

    // .research 有待提交变更 (checkpoint 的目标)
    await repo.write(TASK2_PATH, 'id: T-2\ngoal: edited task two\n')

    const cp = await git.saveCheckpoint(root, 'TC-002 protect unrelated staged')
    expect(cp.committed).toBe(true)
    expect(cp.commitOid).toMatch(/^[0-9a-f]{40}$/)

    // ① 无关变更未进入 commit
    const shown = await repo.git(['show', '--name-status', '--format=', 'HEAD'])
    const committedPaths = shown.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\t').pop()!)
    expect(committedPaths).toEqual([TASK2_PATH])
    expect(committedPaths).not.toContain('README.md')

    // ② 事后仍保持 staged (index 侧 X='M', worktree == index)
    const st1 = await git.status(root)
    const readme = st1.entries.find((e) => e.path === 'README.md')!
    expect(readme.x).toBe('M')
    expect(readme.y).toBe('.') // v2: '.' = unchanged (worktree == index)
  })
})
