/**
 * WP-6.1 — strict git audit 行为测试 (目标 2/3/4; GIT_INTEGRATION §8,
 * 计划书 §22.1). 临时仓全形态 (TEST_MATRIX §5.1 基建 makeTempRepo):
 * 干净 / 脏树 (tracked 修改、staged、untracked、删除、rename、.research 内外)
 * / policy 变体 / 空仓边界 / detached / 冲突态正交 / workspace root ≠ repo root.
 *
 * TC 映射 (TEST_MATRIX §3.5): TC-AUDIT-001 (tracked 修改发现 — 本层输出
 * 结构化清单; 「分类入 Inbox」的 conversion 面归 WP-6.3/6.4).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  AuditInputError,
  NotARepoAuditError,
  normalizeWorkspacePolicy,
  runStrictAudit,
  type AuditPolicy,
} from '../../src/host/audit/strict/index.js'
import { GitCommandError } from '../../src/host/git/index.js'
import {
  makeTempRepo,
  PLAN_PATH,
  PLAN_V2,
  TASK1_PATH,
  TASK2_PATH,
  type TempRepo,
} from '../git/temp-repo.js'

const REPOS: TempRepo[] = []
async function repo(opts: Parameters<typeof makeTempRepo>[0] = {}): Promise<TempRepo> {
  const r = await makeTempRepo(opts)
  REPOS.push(r)
  return r
}
afterEach(async () => {
  while (REPOS.length > 0) await REPOS.pop()!.dispose()
})

function policy(strictPaths: string[], workspaceRoot = '.'): AuditPolicy {
  return normalizeWorkspacePolicy({
    workspace: { root: workspaceRoot, git_required: true },
    audit: { strict_tracked: { paths: strictPaths } },
  })
}

const paths = (list: { path: string }[]): string[] => list.map((e) => e.path)
const OID = 'a'.repeat(40)

describe('strict audit — 干净树 (边界: 全空集 + 一致)', () => {
  it('seeded 干净仓 → 零变更 + .research/ consistent + W13 权威集', async () => {
    const r = await repo()
    const report = await runStrictAudit({ workspaceRoot: r.root, policy: policy(['.research/']) })

    expect(report.head).toEqual({ kind: 'branch', name: 'main' })
    expect(report.trackedChanges).toEqual([])
    expect(report.diffSummary).toEqual([])
    expect(report.newFiles).toEqual({ outsideResearch: [], insideResearch: [] })
    expect(report.research).toEqual({
      trackedModified: [],
      untracked: [],
      missing: [],
      consistent: true,
    })
    // W13 `.research/` 枚举 = 预置 4 文件 (权威 tracked 集, 字典序: items/ < plan)
    expect(report.strictTracked.pathspecs).toEqual(['.research/'])
    expect(report.strictTracked.tracked).toEqual([
      '.research/project.yaml',
      TASK1_PATH,
      TASK2_PATH,
      PLAN_PATH,
    ])
    expect(report.strictTracked.modified).toEqual([])
    expect(report.strictTracked.deleted).toEqual([])
    expect(report.warnings).toEqual([])
  })
})

describe('strict audit — tracked 修改发现 (TC-AUDIT-001 输入面)', () => {
  it('未暂存修改: .research/ 内外分类 + W5 摘要 + research 不一致', async () => {
    const r = await repo()
    await r.write('README.md', 'user edit\n')
    await r.write(PLAN_PATH, PLAN_V2)
    const report = await runStrictAudit({ workspaceRoot: r.root, policy: policy(['.research/']) })

    expect(paths(report.trackedChanges)).toEqual([PLAN_PATH, 'README.md'])
    for (const c of report.trackedChanges) {
      expect(c.x).toBe('.')
      expect(c.y).toBe('M')
      expect(c.staged).toBe(false)
      expect(c.worktreeModified).toBe(true)
      expect(c.diffStatus).toBe('M')
    }
    expect(report.diffSummary.map((d) => [d.status, d.path])).toEqual([
      ['M', PLAN_PATH],
      ['M', 'README.md'],
    ])
    expect(report.research).toEqual({
      trackedModified: [PLAN_PATH],
      untracked: [],
      missing: [],
      consistent: false,
    })
    expect(report.strictTracked.modified).toEqual([PLAN_PATH])
  })

  it('staged 修改: W4 X 侧分类权威; unstaged W5 不含暂存-only (白名单单基线形状)', async () => {
    const r = await repo()
    await r.write('README.md', 'edit\n')
    await r.git(['add', '--', 'README.md'])
    const head = await r.head()

    const unstaged = await runStrictAudit({ workspaceRoot: r.root, policy: policy(['.research/']) })
    expect(unstaged.trackedChanges).toHaveLength(1)
    expect(unstaged.trackedChanges[0]).toMatchObject({
      path: 'README.md',
      x: 'M',
      y: '.',
      staged: true,
      worktreeModified: false,
      diffStatus: undefined,
    })
    expect(unstaged.diffSummary).toEqual([]) // index == worktree
    expect(unstaged.research.consistent).toBe(true) // 变更在 .research/ 外

    const vsBaseline = await runStrictAudit({ workspaceRoot: r.root, policy: policy(['.research/']), baseline: head })
    expect(vsBaseline.diffSummary.map((d) => [d.status, d.path])).toEqual([['M', 'README.md']])
    expect(vsBaseline.baseline).toBe(head)
    expect(vsBaseline.trackedChanges[0]!.diffStatus).toBe('M')
  })

  it('MM (暂存+未暂存): 两侧标志 + 两种 W5 模式均可见', async () => {
    const r = await repo()
    await r.write('README.md', 'one\n')
    await r.git(['add', '--', 'README.md'])
    await r.write('README.md', 'two\n')
    const head = await r.head()

    const unstaged = await runStrictAudit({ workspaceRoot: r.root })
    expect(unstaged.trackedChanges[0]).toMatchObject({
      path: 'README.md', x: 'M', y: 'M', staged: true, worktreeModified: true,
    })
    expect(unstaged.diffSummary.map((d) => d.path)).toEqual(['README.md'])

    const vsBaseline = await runStrictAudit({ workspaceRoot: r.root, baseline: head })
    expect(vsBaseline.diffSummary.map((d) => d.path)).toEqual(['README.md'])
  })

  it('git rm (暂存删除): strict 集 deleted + .research/ missing', async () => {
    const r = await repo()
    await r.git(['rm', '--quiet', TASK1_PATH])
    const report = await runStrictAudit({ workspaceRoot: r.root, policy: policy(['.research/']) })

    expect(report.trackedChanges).toHaveLength(1)
    expect(report.trackedChanges[0]).toMatchObject({
      path: TASK1_PATH, x: 'D', y: '.', staged: true, deletedInWorktree: false,
    })
    expect(report.strictTracked.deleted).toEqual([TASK1_PATH])
    expect(report.strictTracked.tracked).not.toContain(TASK1_PATH) // 暂存删除后已离开 index (W13 权威集)
    expect(report.research).toMatchObject({ trackedModified: [TASK1_PATH], missing: [TASK1_PATH], consistent: false })
  })

  it('工作树 rm (未暂存删除): y=D + unstaged W5 D + missing', async () => {
    const r = await repo()
    await rm(join(r.root, TASK2_PATH))
    const report = await runStrictAudit({ workspaceRoot: r.root, policy: policy(['.research/']) })

    expect(report.trackedChanges[0]).toMatchObject({
      path: TASK2_PATH, x: '.', y: 'D', worktreeModified: true, deletedInWorktree: true,
    })
    expect(report.diffSummary.map((d) => [d.status, d.path])).toEqual([['D', TASK2_PATH]])
    expect(report.research.missing).toEqual([TASK2_PATH])
    expect(report.strictTracked.deleted).toEqual([TASK2_PATH])
  })

  it('rename (git mv 暂存): kind=renamed + origPath + R100 摘要 (基线模式)', async () => {
    const r = await repo()
    const newPath = '.research/topics/TPC-1/workstreams/WS-1/items/tasks/T-2b.yaml'
    await r.git(['mv', TASK2_PATH, newPath])
    const head = await r.head()

    const unstaged = await runStrictAudit({ workspaceRoot: r.root, policy: policy(['.research/']) })
    expect(unstaged.trackedChanges).toEqual([
      expect.objectContaining({
        path: newPath, kind: 'renamed', origPath: TASK2_PATH, x: 'R', y: '.', staged: true,
      }),
    ])
    expect(unstaged.diffSummary).toEqual([]) // rename 已暂存 → unstaged 面不可见 (X/Y 权威)
    expect(unstaged.research.trackedModified).toEqual([newPath])

    const vsBaseline = await runStrictAudit({ workspaceRoot: r.root, policy: policy(['.research/']), baseline: head })
    expect(vsBaseline.diffSummary).toEqual([{ status: 'R100', path: newPath, oldPath: TASK2_PATH }])
    expect(vsBaseline.trackedChanges[0]!.diffStatus).toBe('R100')
    // W13 权威集 = 新路径 (旧路径离开 index → 不计 missing)
    expect(vsBaseline.strictTracked.tracked).toContain(newPath)
    expect(vsBaseline.strictTracked.tracked).not.toContain(TASK2_PATH)
    expect(vsBaseline.research.missing).toEqual([])
  })
})

describe('strict audit — 新文件清单 (W4 untracked, .research/ 内外)', () => {
  it('untracked: 外 (git 整目录记法) / 内 (已跟踪树下新目录) 分列 + research 不一致', async () => {
    const r = await repo()
    await r.write('docs/note.md', 'n\n') // docs/ 全新 → git 记法 `docs/` (整目录, 不展开 — 展开归 WP-6.2)
    await r.write('figures/fig-1.png', 'png\n')
    await r.write('results/x.csv', 'a,b\n')
    await r.write('.research/topics/NEW/topic.yaml', 'id: NEW\n') // .research/ 已跟踪 → 记新子目录
    const report = await runStrictAudit({ workspaceRoot: r.root, policy: policy(['.research/']) })

    expect(report.newFiles.outsideResearch).toEqual(['docs/', 'figures/', 'results/'])
    expect(report.newFiles.insideResearch).toEqual(['.research/topics/NEW/'])
    expect(report.research.untracked).toEqual(['.research/topics/NEW/'])
    expect(report.research.consistent).toBe(false)
    expect(report.trackedChanges).toEqual([]) // untracked 不进 tracked 清单
  })

  it('intent-to-add (git add -N): 跟踪变更 (y=A) 而非 untracked', async () => {
    const r = await repo()
    await r.write('results/y.csv', 'z\n')
    await r.git(['add', '-N', 'results/y.csv'])
    const report = await runStrictAudit({ workspaceRoot: r.root, policy: policy(['results/']) })

    expect(report.newFiles).toEqual({ outsideResearch: [], insideResearch: [] })
    expect(report.trackedChanges).toEqual([
      expect.objectContaining({ path: 'results/y.csv', x: '.', y: 'A', worktreeModified: true }),
    ])
    // intent-to-add 已被 ls-files 视为 tracked (W13 权威集含之), 且在 unstaged W5
    expect(report.strictTracked.tracked).toEqual(['results/y.csv'])
    expect(report.diffSummary.map((d) => [d.status, d.path])).toEqual([['A', 'results/y.csv']])
  })
})

describe('strict audit — policy 变体 (strict_tracked.pathspec)', () => {
  it('glob pathspec 只圈定声明的 strict 集 (README 修改不入 strict modified)', async () => {
    const r = await repo()
    await r.write('results/a.csv', '1\n')
    await r.git(['add', '--', 'results/a.csv'])
    await r.git(['commit', '-m', 'fixture: seed results'])
    await r.write('results/a.csv', '2\n')
    await r.write('README.md', 'edit\n')

    const report = await runStrictAudit({ workspaceRoot: r.root, policy: policy(['results/*']) })
    expect(report.strictTracked.pathspecs).toEqual(['results/*'])
    expect(report.strictTracked.tracked).toEqual(['results/a.csv'])
    expect(report.strictTracked.modified).toEqual(['results/a.csv'])
    expect(report.strictTracked.deleted).toEqual([])
    // 全仓 tracked 清单仍含 README (审计不隐藏; strict 集只是投影)
    expect(paths(report.trackedChanges)).toEqual(['README.md', 'results/a.csv'])
  })

  it('空 policy (默认) → strict 空集, 但 .research/ 一致性仍经 W13 枚举', async () => {
    const r = await repo()
    await rm(join(r.root, TASK2_PATH))
    const report = await runStrictAudit({ workspaceRoot: r.root }) // policy 缺省

    expect(report.strictTracked).toEqual({ pathspecs: [], tracked: [], modified: [], deleted: [] })
    expect(report.research.missing).toEqual([TASK2_PATH]) // W13 `.research/` 仍执行
    expect(report.research.consistent).toBe(false)
  })

  it('多 pathspec 并集去重排序 (重叠声明)', async () => {
    const r = await repo()
    const report = await runStrictAudit({
      workspaceRoot: r.root,
      policy: policy(['.research/', '.research/topics/TPC-1/workstreams/WS-1/items/tasks/']),
    })
    expect(report.strictTracked.tracked).toEqual([
      '.research/project.yaml',
      TASK1_PATH,
      TASK2_PATH,
      PLAN_PATH,
    ]) // 重叠并集 = 无重复
  })
})

describe('strict audit — workspace root ≠ repo root (§3 说明前缀换算)', () => {
  async function nestedRepo(): Promise<{ r: TempRepo; ws: string }> {
    const r = await repo()
    await r.write('experiments/code/main.py', 'print(1)\n')
    await r.git(['add', '--', 'experiments'])
    await r.git(['commit', '-m', 'fixture: nested workspace'])
    return { r, ws: join(r.root, 'experiments') }
  }

  it('policy pathspec 前缀换算: experiments/code/ 入 strict 集并分类', async () => {
    const { r, ws } = await nestedRepo()
    await r.write('experiments/code/main.py', 'print(2)\n')
    const report = await runStrictAudit({
      workspaceRoot: ws,
      policy: policy(['code/'], 'experiments/'),
    })

    expect(report.strictTracked.pathspecs).toEqual(['experiments/code/'])
    expect(report.strictTracked.tracked).toEqual(['experiments/code/main.py'])
    expect(report.strictTracked.modified).toEqual(['experiments/code/main.py'])
    // 报告路径一律 repo-root-relative (git 权威)
    expect(paths(report.trackedChanges)).toEqual(['experiments/code/main.py'])
    expect(report.warnings).toEqual([])
  })

  it('policy workspace.root 与实际位置不符 → AUDIT_POLICY_MISMATCH 警告 (不阻断)', async () => {
    const { r, ws } = await nestedRepo()
    await r.write('experiments/code/main.py', 'print(2)\n')
    const report = await runStrictAudit({
      workspaceRoot: ws,
      policy: policy(['code/'], '.'), // policy 声称在 repo root, 实际在 experiments/
    })

    expect(report.strictTracked.modified).toEqual(['experiments/code/main.py']) // 换算仍按实际位置
    expect(report.warnings).toEqual([
      expect.objectContaining({ code: 'AUDIT_POLICY_MISMATCH' }),
    ])
  })
})

describe('strict audit — 空仓边界 (无提交)', () => {
  it('空仓 + untracked: W4/W5/W13 全可用 + AUDIT_EMPTY_REPO 警告', async () => {
    const r = await repo({ seedResearch: false })
    await r.write('x.txt', 'hello\n')
    const report = await runStrictAudit({ workspaceRoot: r.root, policy: policy(['.research/']) })

    expect(report.head).toEqual({ kind: 'branch', name: 'main' })
    expect(report.newFiles.outsideResearch).toEqual(['x.txt'])
    expect(report.research.consistent).toBe(true)
    expect(report.diffSummary).toEqual([])
    expect(report.strictTracked.tracked).toEqual([])
    expect(report.warnings).toEqual([expect.objectContaining({ code: 'AUDIT_EMPTY_REPO' })])
  })

  it('空仓 + baseline → git 自身错误原样透传 (GitCommandError, §9)', async () => {
    const r = await repo({ seedResearch: false })
    await expect(runStrictAudit({ workspaceRoot: r.root, baseline: OID })).rejects.toBeInstanceOf(GitCommandError)
  })
})

describe('strict audit — 输入与仓库边界 (spawn 之前 / W1)', () => {
  it('非 repo 目录 → NotARepoAuditError (W1, §2)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-audit-norepo-'))
    try {
      await expect(runStrictAudit({ workspaceRoot: dir })).rejects.toMatchObject({ code: 'AUDIT_NOT_A_REPO' })
      await expect(runStrictAudit({ workspaceRoot: dir })).rejects.toBeInstanceOf(NotARepoAuditError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('baseline 形状非法 → AuditInputError (先于任何 I/O)', async () => {
    const r = await repo()
    await expect(runStrictAudit({ workspaceRoot: r.root, baseline: 'abc' })).rejects.toMatchObject({ code: 'AUDIT_INPUT' })
    await expect(runStrictAudit({ workspaceRoot: r.root, baseline: 'A'.repeat(40) })).rejects.toBeInstanceOf(AuditInputError)
    await expect(runStrictAudit({ workspaceRoot: '' })).rejects.toMatchObject({ code: 'AUDIT_INPUT' })
  })
})

describe('strict audit — detached HEAD 与冲突态 (§9 读操作不阻塞; §5.1 正交)', () => {
  it('detached HEAD: 读操作正常 + AUDIT_DETACHED_HEAD 警告 (checkpoint 才警告, §5)', async () => {
    const r = await repo({ detachedHead: true })
    await r.write('README.md', 'edit\n')
    const report = await runStrictAudit({ workspaceRoot: r.root })

    expect(report.head).toMatchObject({ kind: 'detached' })
    expect(paths(report.trackedChanges)).toEqual(['README.md'])
    expect(report.warnings).toEqual([expect.objectContaining({ code: 'AUDIT_DETACHED_HEAD' })])
  })

  it('merge 冲突进行中: audit 照常执行 (不调 §5.1 门禁, 无 checkpoint) — unmerged 分类入报告', async () => {
    const r = await repo({ conflict: 'merge' })
    // 若 audit 被冲突态阻塞 (抛 GitConflictStateError 等), 本 await 即红 —
    // §5.1 冲突门禁只属于 checkpoint 前置 (目标 4 正交; GIT_INTEGRATION §9 读操作行)
    const report = await runStrictAudit({ workspaceRoot: r.root, policy: policy(['.research/']) })

    const unmerged = report.trackedChanges.find((c) => c.path === PLAN_PATH)
    expect(unmerged).toMatchObject({ kind: 'unmerged', x: 'U', y: 'U' })
    expect(report.research.consistent).toBe(false)
  })
})

describe('strict audit — 护栏与确定性', () => {
  it('W4 输出截断 (maxOutputBytes) → AUDIT_TRUNCATED 警告 (不静默)', async () => {
    const r = await repo()
    await r.write('README.md', 'edit\n')
    const report = await runStrictAudit({ workspaceRoot: r.root, gitOptions: { maxOutputBytes: 40 } })
    expect(report.warnings).toContainEqual(expect.objectContaining({ code: 'AUDIT_TRUNCATED' }))
  })

  it('确定性: 同仓同输入两次执行 → 逐字段同报告 (无时间戳, 全排序)', async () => {
    const r = await repo()
    await r.write('README.md', 'one\n')
    await r.git(['add', '--', 'README.md'])
    await r.write('results/x.csv', 'a\n')
    await r.write(PLAN_PATH, PLAN_V2)
    const head = await r.head()

    const a = await runStrictAudit({ workspaceRoot: r.root, policy: policy(['.research/']), baseline: head })
    const b = await runStrictAudit({ workspaceRoot: r.root, policy: policy(['.research/']), baseline: head })
    expect(b).toEqual(a)
  })

  it('连续两次 audit 之间仓库状态不变 (只读行为面前置; 完整证明见 read-only.test.ts)', async () => {
    const r = await repo()
    await r.write('README.md', 'edit\n')
    const before = await r.git(['status', '--porcelain'])
    await runStrictAudit({ workspaceRoot: r.root, policy: policy(['.research/']) })
    await runStrictAudit({ workspaceRoot: r.root })
    const after = await r.git(['status', '--porcelain'])
    expect(after).toEqual(before)
  })
})
