/**
 * TC-GIT-012 (TEST_MATRIX §3.3): 非 repo 目录.
 * 断言要点: 注册拒绝; 无任何 git init 副作用.
 *
 * INV-GIT-1: 不静默 git init — 非 Git repo 的目录拒绝进入 managed research
 * mode; 仅提供显式 GUI 操作 (W12, 见 TC-GIT-017)。§2: W1 exit ≠ 0 → 拒绝
 * 注册, 提示「该目录不是 Git 仓库」。
 */
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'

describe('TC-GIT-012 非 repo 目录 (INV-GIT-1: 不静默 init)', () => {
  it('注册拒绝 (ok:false); 自动路径无 git init 副作用', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-no-repo-'))
    try {
      // W1: exit ≠ 0 → 拒绝注册
      const det = await git.detectRepo(dir)
      expect(det).toEqual({ ok: false, reason: 'not-a-repo' })

      // 自动路径的其他操作: fail loud (GitCommandError), 绝不静默 init
      await expect(git.status(dir)).rejects.toMatchObject({ code: 'GIT_COMMAND' })
      await expect(git.saveCheckpoint(dir, 'TC-012 non-repo')).rejects.toMatchObject({
        code: 'GIT_COMMAND',
      })

      // 无任何 git init 副作用: .git 从未被创建 (INV-GIT-1)
      expect(existsSync(join(dir, '.git'))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
