/**
 * TC-GIT-003 (TEST_MATRIX §3.3): untracked `.research` 文件.
 * 断言要点: 经 add + pathspec commit 进入 commit.
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { makeTempRepo, type TempRepo } from './temp-repo.js'

const T3_PATH = '.research/topics/TPC-1/workstreams/WS-1/items/tasks/T-3.yaml'

describe('TC-GIT-003 untracked .research 文件', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('新增未跟踪 .research 文件经 W9+W10 进入 checkpoint commit', async () => {
    repo = await makeTempRepo()
    const root = repo.root
    await repo.write(T3_PATH, 'id: T-3\ngoal: new untracked task\n')

    const st0 = await git.status(root)
    expect(st0.entries.find((e) => e.path === T3_PATH)!.kind).toBe('untracked')

    const cp = await git.saveCheckpoint(root, 'TC-003 untracked .research file')
    expect(cp.committed).toBe(true)
    expect(cp.commitOid).toMatch(/^[0-9a-f]{40}$/)

    // 新文件在 commit 中 (status A = added)
    const shown = await repo.git(['show', '--name-status', '--format=', 'HEAD'])
    const lines = shown.stdout.trim().split('\n').filter(Boolean)
    expect(lines).toContain(`A\t${T3_PATH}`)

    // 提交后不再是 untracked (工作区对 .research 干净)
    const st1 = await git.status(root)
    expect(st1.entries.find((e) => e.path === T3_PATH)).toBeUndefined()
    expect(await git.lsFiles(root, '.research/')).toContain(T3_PATH)
  })
})
