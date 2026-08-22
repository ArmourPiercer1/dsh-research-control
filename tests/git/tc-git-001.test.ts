/**
 * TC-GIT-001 (TEST_MATRIX §3.3): dirty working tree.
 * 断言要点: 读操作/加载不受影响; checkpoint 仅 `.research/**`.
 *
 * 补充 (INV-GIT-2 行为面): 读操作不产生任何 commit (无隐式 commit 路径;
 * 类型面断言见 tests/git/inv-git-static.test.ts)。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../../src/host/git/index.js'
import { makeTempRepo, PLAN_PATH, PLAN_V1, TASK1_PATH, type TempRepo } from './temp-repo.js'

describe('TC-GIT-001 dirty working tree', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('读操作/加载不受影响; checkpoint 仅 .research/**; 读操作零 commit', async () => {
    repo = await makeTempRepo()
    const root = repo.root

    // dirty working tree: 无关 tracked 修改 + 无关 untracked + .research 修改
    await repo.write('README.md', 'user edited README (dirty, unrelated)\n')
    await repo.write('stray.txt', 'untracked unrelated file\n')
    await repo.write(TASK1_PATH, 'id: T-1\ngoal: edited task one\n')
    const headBefore = await repo.head()

    // ── 读操作不受影响 (canonical current state 就是 working copy, §9) ──
    const det = await git.detectRepo(root)
    expect(det).toEqual({ ok: true, repoRoot: root })

    const st = await git.status(root)
    const byPath = new Map(st.entries.map((e) => [e.path, e]))
    expect(byPath.get('README.md')!.x + byPath.get('README.md')!.y).toBe('.M') // v2: '.' = unchanged
    expect(byPath.get('stray.txt')!.kind).toBe('untracked')
    expect(byPath.get(TASK1_PATH)!.x + byPath.get(TASK1_PATH)!.y).toBe('.M')

    const diff = await git.diffNameStatus(root)
    expect(diff.map((d) => d.path).sort()).toEqual([TASK1_PATH, 'README.md'].sort())
    expect(diff.find((d) => d.path === TASK1_PATH)!.status).toBe('M')

    const log = await git.logFile(root, PLAN_PATH)
    expect(log).toHaveLength(1)
    expect(log[0]!.oid).toBe(headBefore)
    expect(log[0]!.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)

    expect(await git.showFile(root, headBefore, PLAN_PATH)).toBe(PLAN_V1)
    expect(await git.lsFiles(root, '.research/')).toContain(PLAN_PATH)
    expect(await git.hashObject(root, PLAN_PATH)).toMatch(/^[0-9a-f]{40}$/)
    const conflict = await git.detectConflictState(root)
    expect(conflict.inProgress).toBe(false)

    // ── 读操作零 commit (INV-GIT-2: 无隐式 commit 路径) ──
    expect(await repo.head()).toBe(headBefore)

    // ── checkpoint 仅 .research/** ──
    const cp = await git.saveCheckpoint(root, 'TC-001 dirty worktree')
    expect(cp.committed).toBe(true)
    expect(cp.commitOid).toMatch(/^[0-9a-f]{40}$/)
    expect(cp.commitOid).not.toBe(headBefore)
    expect(cp.warnings).toEqual([])

    const shown = await repo.git(['show', '--name-status', '--format=', 'HEAD'])
    const committedPaths = shown.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\t').pop()!)
    expect(committedPaths).toEqual([TASK1_PATH])

    // 无关 dirty 状态原样保留 (不吞、不 unstage、不 clean)
    const st2 = await git.status(root)
    const byPath2 = new Map(st2.entries.map((e) => [e.path, e]))
    expect(byPath2.get('README.md')!.x + byPath2.get('README.md')!.y).toBe('.M')
    expect(byPath2.get('stray.txt')!.kind).toBe('untracked')
    expect(byPath2.get(TASK1_PATH)).toBeUndefined()
  })
})
