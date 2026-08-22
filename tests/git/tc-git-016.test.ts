/**
 * TC-GIT-016 (TEST_MATRIX §3.3): 超时.
 * 断言要点: 慢命令 mock → 超时 kill、错误上报、无重试写操作.
 *
 * §1.9: 「所有 Git 调用带超时 (默认 10s, 可配) 与输出大小上限, 超时即 kill
 * 并按错误处理」; §9: 「命令超时 → 报『Git 操作超时』, 不重试自动写操作」。
 *
 * 慢命令 mock = 假 git 可执行 (gitExecutable 覆盖): 记录每次被 spawn 的
 * argv 到日志文件后 sleep 30 — 日志文件同时是「无重试」与「-C root 强制」
 * 的行为证据 (argv 数组直传, INV-GIT-6)。
 *
 * 附加护栏测试 (任务目标 3, 矩阵外补充): 输出字节上限 (截断+标记)。
 */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { makeTempRepo, type TempRepo } from './temp-repo.js'

describe('TC-GIT-016 超时 (慢命令 mock) + 执行护栏', () => {
  let repo: TempRepo | undefined
  let tmp: string | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
    if (tmp) await rm(tmp, { recursive: true, force: true })
    tmp = undefined
  })

  it('超时 kill + 错误上报 + 无重试写操作 + -C root 强制 + 输出上限截断', async () => {
    repo = await makeTempRepo()
    tmp = await mkdtemp(join(tmpdir(), 'dsh-fake-git-'))
    const root = repo.root
    const headBefore = await repo.head()
    const callLog = join(tmp, 'fake-git.log')
    const fakeGit = join(tmp, 'git')
    await writeFile(
      fakeGit,
      `#!/bin/sh\necho "$@" >> ${JSON.stringify(callLog)}\nsleep 30\n`,
      'utf8',
    )
    await chmod(fakeGit, 0o755)

    // ① 读路径: 超时 kill + 错误上报 (GitTimeoutError, 「Git 操作超时」)
    const t0 = Date.now()
    await expect(git.detectRepo(root, { gitExecutable: fakeGit, timeoutMs: 700 })).rejects.toMatchObject({
      code: 'GIT_TIMEOUT',
    })
    const elapsed = Date.now() - t0
    expect(elapsed).toBeGreaterThanOrEqual(600)
    expect(elapsed).toBeLessThan(5_000)

    // 无重试: 恰好 1 次 spawn; -C root 强制 (argv 数组直传, INV-GIT-6)
    let calls = (await readFile(callLog, 'utf8')).trim().split('\n')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe(`-C ${root} rev-parse --show-toplevel`)

    // ② 写路径: checkpoint 超时 → add/commit 从未下发 (不重试自动写操作)
    await expect(
      git.saveCheckpoint(root, 'TC-016 slow write', { gitExecutable: fakeGit, timeoutMs: 700 }),
    ).rejects.toMatchObject({ code: 'GIT_TIMEOUT' })
    calls = (await readFile(callLog, 'utf8')).trim().split('\n')
    expect(calls).toHaveLength(2)
    // 第二次调用是步骤 1 冲突检测的 W2 (rev-parse --git-dir) — 流程在写操作前超时
    expect(calls[1]).toBe(`-C ${root} rev-parse --git-dir`)
    expect(calls.join(' ')).not.toMatch(/\badd\b|\bcommit\b/)

    // ③ 仓库完好 (真 git 可读, HEAD 未变)
    expect(await repo.head()).toBe(headBefore)
    await git.detectConflictState(root)
    const st = await git.status(root)
    expect(st.entries).toEqual([])

    // ④ 输出字节上限: 截断+标记 (maxOutputBytes=1 KiB, 实际输出 5 MB)
    const bigGit = join(tmp, 'big-git')
    await writeFile(bigGit, '#!/bin/sh\nyes dsh-big-output | head -c 5000000\nexit 0\n', 'utf8')
    await chmod(bigGit, 0o755)
    const big = await git.status(root, {
      gitExecutable: bigGit,
      maxOutputBytes: 1024,
      timeoutMs: 15_000,
    })
    expect(big.truncated).toBe(true)
    expect(big.raw.length).toBe(1024)
  })
})
