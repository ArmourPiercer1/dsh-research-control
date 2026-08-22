/**
 * TC-GIT-011 (TEST_MATRIX §3.3): Git 缺失.
 * 断言要点: mock PATH 移除 git → 功能降级、无崩溃.
 *
 * §9: 「Git 可执行缺失 | spawn ENOENT | 功能降级: 拒绝 managed mode /
 * 禁用 checkpoint; 明确提示安装 Git」。git 可执行解析失败响亮报错 (§2)。
 * 「无崩溃」= 每次调用都抛出**类型化** GitMissingError (service 层据此
 * 降级), 而非未处理异常。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { makeTempRepo, PLAN_PATH, type TempRepo } from './temp-repo.js'

describe('TC-GIT-011 Git 缺失 (功能降级, 无崩溃)', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('PATH 无 git → 每次调用抛类型化 GitMissingError (响亮报错, 可降级)', async () => {
    repo = await makeTempRepo()
    const root = repo.root
    const emptyDir = await mkdtemp(join(tmpdir(), 'dsh-no-git-'))
    const oldPath = process.env.PATH
    try {
      process.env.PATH = emptyDir

      await expect(git.detectRepo(root)).rejects.toMatchObject({ code: 'GIT_MISSING' })
      await expect(git.status(root)).rejects.toMatchObject({ code: 'GIT_MISSING' })
      await expect(git.saveCheckpoint(root, 'TC-011 no git')).rejects.toMatchObject({
        code: 'GIT_MISSING',
      })

      // 无崩溃: 类型化错误 (GitMissingError ⊂ GitError), 提示安装 Git
      const e = await git.hashObject(root, PLAN_PATH).catch((x: unknown) => x)
      expect(e).toBeInstanceOf(git.GitMissingError)
      expect(e).toBeInstanceOf(git.GitError)
      expect((e as git.GitError).code).toBe('GIT_MISSING')
      expect(e).toBeInstanceOf(Error)
    } finally {
      process.env.PATH = oldPath
      await rm(emptyDir, { recursive: true, force: true })
    }
  })

  it('gitExecutable 指向不存在路径 → GitMissingError 响亮报错 (§2)', async () => {
    repo = await makeTempRepo()
    await expect(
      git.detectRepo(repo.root, { gitExecutable: '/nonexistent/git-404' }),
    ).rejects.toMatchObject({ code: 'GIT_MISSING' })
    await expect(
      git.revParseHead(repo.root, { gitExecutable: '/nonexistent/git-404' }),
    ).rejects.toBeInstanceOf(git.GitMissingError)
  })
})
