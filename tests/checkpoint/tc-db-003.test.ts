/**
 * WP-2.8 — TC-DB-003: checkpoint 步骤 3/4 间 kill → 仓库仍合法（最坏 staged
 * 残留），无损坏.
 *
 * TEST_MATRIX §3.5 TC-DB-003: 「checkpoint 中断: 步骤 3/4 间 kill → 仓库仍
 * 合法（最坏 staged 残留），无损坏」. 步骤编号按 GIT_INTEGRATION §5:
 * 步骤 3 = `git add -- .research/`（W9 stageResearch），步骤 4 =
 * `git commit … -- .research/`（W10 commitResearch）— 即 **add 已完成、
 * commit 未执行** 的停点.
 *
 * 故障注入点（任务书: 用故障注入包装 GitExecutor 或 service 钩子 — 读
 * service/checkpoint 实现选定）: 本插件的 git 传输层唯一可注入面是
 * `GitOptions.gitExecutable`（runner.ts 每次调用解析可执行路径；白名单
 * 校验的是 argv 而非可执行体）。测试构造一个 **wrapper git 脚本**:
 * 除 `commit` 外全部 argv 透传给真实 git — 即 `add`（步骤 3）真实执行完毕，
 * 到 `commit`（步骤 4）时以 exit 128 模拟进程死亡（stderr 带 kill 标记，
 * 真实 SIGKILL 的进程级效果对仓库的观测面完全一致: add 落盘、commit 从未
 * 执行）. 停点状态由仓库侧断言锁定（staged 残留 = add 已生效；HEAD 不动 =
 * commit 未执行）.
 *
 * 断言（任务书三条 + 恢复）:
 *  1. 仓库仍合法: `git status`（W4, 插件面）可读、无锁残留（.git/index.lock
 *     不存在）、无进行中冲突态、`git fsck --full` 干净、HEAD 停在初始提交;
 *  2. .research/ 工作副本完整: 两个改动文件内容逐字节 = 中断前写入;
 *  3. 最坏 staged 残留: porcelain=v2 显示 plan 为 M.（已暂存修改）、新文件
 *     为 A.（已暂存新增）; index 与工作区零差异（staged 内容完整, 无半写）;
 *  4. 无损坏（可恢复）: 移除故障后的后续 checkpoint 成功完成（commit 落盘、
 *     .research 归干净、OID 可解析）.
 */
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import * as git from '../../src/host/git/index.js'
import { GitCommandError } from '../../src/host/git/index.js'
import { resolveGitExecutable } from '../../src/host/git/runner.js'
import {
  saveResearchCheckpoint,
} from '../../src/host/service/checkpoint/index.js'
import { makeTempRepo, PLAN_PATH, PLAN_V2, type TempRepo } from '../git/temp-repo.js'
import { RecordingLogger } from './recording-logger.js'

const T3_PATH = '.research/topics/TPC-1/workstreams/WS-1/items/tasks/T-3.yaml'
const T3_CONTENT = 'id: T-3\nworkstream_id: WS-1\ntitle: 新任务\n'

/**
 * Build the fault-injection git wrapper: pass every argv through to the real
 * git, EXCEPT `commit` — on `commit` behave as a killed process (exit 128,
 * kill marker on stderr) before git ever sees the command. This is exactly
 * the §5 step 3/4 kill: `git add` (step 3) has already executed for real;
 * `git commit` (step 4) never runs.
 */
async function makeKillingGit(realGitExe: string, dir: string): Promise<string> {
  const wrapper = join(dir, 'git-kill-on-commit.sh')
  const lines = [
    '#!/bin/sh',
    '# WP-2.8 TC-DB-003 fault injection (test infra only):',
    '# pass every git command through to the real git, but on `commit` die',
    '# like a killed process BEFORE executing it — the §5 kill between step',
    '# 3 (git add .research/, already completed) and step 4 (git commit).',
    'for a in "$@";',
    'do',
    '  if [ "$a" = "commit" ]; then',
    '    echo "simulated process death (SIGKILL): git commit never executed (TC-DB-003 fault injection)" >&2',
    '    exit 128',
    '  fi',
    'done',
    `exec "${realGitExe}" "$@"`,
    '',
  ]
  await writeFile(wrapper, lines.join('\n'))
  await chmod(wrapper, 0o755)
  return wrapper
}

describe('WP-2.8 TC-DB-003: checkpoint interruption between §5 steps 3 and 4', () => {
  let repo: TempRepo | undefined
  let faultDir: string | undefined

  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
    if (faultDir) await rm(faultDir, { recursive: true, force: true })
    faultDir = undefined
  })

  it('kill between stage and commit → repo legal, worst-case staged residue, no corruption, next checkpoint succeeds', async () => {
    repo = await makeTempRepo()
    faultDir = await mkdtemp(join(tmpdir(), 'wp28-tcdb003-'))
    const headBefore = await repo.head()

    // Dirty .research: modify the tracked plan + add a new file (both must
    // survive the interruption byte-for-byte).
    await repo.write(PLAN_PATH, PLAN_V2)
    await repo.write(T3_PATH, T3_CONTENT)

    const wrapper = await makeKillingGit(resolveGitExecutable(), faultDir)
    const logger = new RecordingLogger()

    // ── the interrupted checkpoint ──────────────────────────────────────
    let caught: unknown
    try {
      await saveResearchCheckpoint(repo.root, {
        logger,
        summary: 'TC-DB-003 kill between stage and commit',
        gitExecutable: wrapper,
      })
      expect.unreachable('saveResearchCheckpoint should have been interrupted')
    } catch (e) {
      caught = e
    }
    // The fault surfaces as a git command error (exit 128, the kill marker),
    // NOT as the §5.2 no-op race (exit 1 + "no changes added to commit").
    expect(caught).toBeInstanceOf(GitCommandError)
    expect(caught).toMatchObject({ code: 'GIT_COMMAND', exitCode: 128 })
    expect((caught as GitCommandError).stderr).toContain('simulated process death')
    // The flow reached step 3 (save.stage logged) and died at step 4
    // (save.commit logged as error) — the kill point is exactly 3/4.
    expect(logger.events()).toEqual([
      'save.start',
      'save.repo-detected',
      'save.conflict-check',
      'save.status',
      'save.stage',
      'save.commit',
    ])
    expect(logger.recordsOf('save.stage')[0]?.level).toBe('info')
    expect(logger.recordsOf('save.commit')[0]?.level).toBe('error')

    // ── 1) repo is still LEGAL ──────────────────────────────────────────
    // status is readable through the plugin's own W4 path (real git):
    const st = await git.status(repo.root, { includeBranch: true })
    expect(st.head).toMatchObject({ kind: 'branch', name: 'main' })
    // HEAD never moved (the commit never executed):
    expect(await repo.head()).toBe(headBefore)
    // No lock residue (a killed git must not leave the index locked):
    expect(existsSync(join(repo.gitDir, 'index.lock'))).toBe(false)
    // No in-progress conflict state:
    const conflict = await git.detectConflictState(repo.root)
    expect(conflict.inProgress).toBe(false)
    // Object store integrity (raw fsck — test infra, not the plugin path):
    const fsck = await repo.git(['fsck', '--full'])
    expect(fsck.exitCode).toBe(0)

    // ── 2) .research/ working copy intact (byte-for-byte) ───────────────
    expect(await repo.read(PLAN_PATH)).toBe(PLAN_V2)
    expect(await repo.read(T3_PATH)).toBe(T3_CONTENT)

    // ── 3) worst case: staged residue (add already committed to the index) ─
    const byPath = new Map(st.entries.map((e) => [e.path, e]))
    // plan: staged modification (x=M, worktree matches index → y=.)
    expect(byPath.get(PLAN_PATH)).toMatchObject({ kind: 'tracked', x: 'M', y: '.' })
    // new file: staged addition (x=A, y=.)
    expect(byPath.get(T3_PATH)).toMatchObject({ kind: 'tracked', x: 'A', y: '.' })
    // Nothing under .research/ is unstaged — the residue is exactly the
    // staged set (the documented worst case). Both sides sorted by an
    // explicit path comparator (locale-independent, no default-sort quirks).
    const pathSort = (a: [string, string, string], b: [string, string, string]): number =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
    const researchEntries = st.entries
      .filter((e) => e.path.startsWith('.research/'))
      .map((e) => [e.path, e.x, e.y] as [string, string, string])
      .sort(pathSort)
    expect(researchEntries).toEqual(
      ([
        [PLAN_PATH, 'M', '.'],
        [T3_PATH, 'A', '.'],
      ] as [string, string, string][]).sort(pathSort),
    )
    // Staged content complete (no half-write): index == worktree for .research/
    const worktreeVsIndex = await repo.git(['diff', '--', '.research/'])
    expect(worktreeVsIndex.stdout).toBe('')
    const stagedNames = (await repo.git(['diff', '--cached', '--name-only'])).stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .sort()
    expect(stagedNames).toEqual([PLAN_PATH, T3_PATH].sort())

    // ── 4) no corruption: the FOLLOWING checkpoint completes normally ────
    const logger2 = new RecordingLogger()
    const res = await saveResearchCheckpoint(repo.root, {
      logger: logger2,
      summary: 'TC-DB-003 recovery checkpoint',
    })
    expect(res.committed).toBe(true)
    expect(res.commitOid).toBe(await repo.head())
    expect(res.commitOid).not.toBe(headBefore)
    expect(res.changedFiles).toEqual([PLAN_PATH, T3_PATH].sort())
    expect(res.message).toBe('research: TC-DB-003 recovery checkpoint')
    // .research/ is clean again (the staged residue was committed, nothing lost):
    const stAfter = await git.status(repo.root)
    expect(stAfter.entries.filter((e) => e.path.startsWith('.research/'))).toEqual([])
    // …and the committed content is the pre-interruption content:
    expect(await repo.read(PLAN_PATH)).toBe(PLAN_V2)
    expect(await repo.read(T3_PATH)).toBe(T3_CONTENT)
  })
})
