/**
 * WP-1.2 — 临时 Git repo 工厂 (测试基建).
 *
 * TEST_MATRIX §5.1: 「临时 Git repo 工厂: mkdtemp + 初始化 + 预置 .research/
 * 样本; 支持注入冲突状态 (merge/rebase/cherry-pick)、detached HEAD、
 * dirty/staged 变体」; TEST_MATRIX §1 原则: 每个 TC-GIT 用例使用独立
 * mkdtemp 仓库, 测试后销毁 (各用例自足)。
 *
 * 边界声明: 本模块是**测试基建**, 非生产代码 — src/host/git/** 从不 import
 * 它。它刻意执行插件在用户仓库上**被禁止**的 git 操作 (建分支、任意
 * add/commit、merge/rebase/cherry-pick/checkout): 夹具的职责正是注入插件
 * 必须检测并拒绝的状态 (INV-GIT-4 / TC-GIT-006..010)。
 *
 * INV-GIT-6 对本文件同样适用: 每次调用都是纯 argv 数组 (spawn,
 * shell: false), 无 shell 字符串。
 *
 * git 2.53 实测 (本 WP 验证): 旧 `am` rebase 后端已不可选
 * (`rebase.backend=am` → "Unknown rebase backend"), 真实停下的 rebase 只写
 * rebase-merge/; §5.1 检测是基于标志**存在性**的, 故 rebase-apply 变体
 * 直接注入标志目录 (与插件检测面完全一致)。
 */
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveGitExecutable } from '../../src/host/git/runner.js'

/** 预置 .research/ 样本 (TEST_MATRIX §5.1). */
export const PLAN_V1 = [
  'topic: TPC-1',
  'workstream: WS-1',
  'ordered_items:',
  '  - T-1',
  '  - T-2',
  '',
].join('\n')
export const PLAN_V2 = [
  'topic: TPC-1',
  'workstream: WS-1',
  'ordered_items:',
  '  - T-2',
  '  - T-1',
  '',
].join('\n')
export const PLAN_PATH = '.research/topics/TPC-1/workstreams/WS-1/plan.yaml'
export const TASK1_PATH = '.research/topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml'
export const TASK2_PATH = '.research/topics/TPC-1/workstreams/WS-1/items/tasks/T-2.yaml'

export interface TempRepoOptions {
  /** 预置 .research/ 样本 + README.md 并提交初始提交 (default true). */
  seedResearch?: boolean
  /** 注入进行中操作状态 (按 §5.1 检测面: 标志文件/目录存在). */
  conflict?: 'merge' | 'rebase-apply' | 'rebase-merge' | 'cherry-pick' | null
  /** 仓库处于 detached HEAD. */
  detachedHead?: boolean
}

export interface RawGitResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface TempRepo {
  /** repo 根绝对路径. */
  root: string
  /** .git 目录绝对路径. */
  gitDir: string
  /** raw argv git (夹具装配用; 期望失败传 { fail: true }). */
  git: (argv: string[], expect?: { fail?: boolean }) => Promise<RawGitResult>
  write: (relPath: string, content: string) => Promise<void>
  read: (relPath: string) => Promise<string>
  /** 当前 HEAD OID. */
  head: () => Promise<string>
  dispose: () => Promise<void>
}

function rawGit(gitExe: string, root: string, argv: string[]): Promise<RawGitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(gitExe, ['-C', root, ...argv], {
      // INV-GIT-6 同样适用于夹具装配: argv 数组直传, 禁 shell.
      shell: false,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')))
    child.on('error', reject)
    child.on('close', (code) => resolve({ exitCode: code ?? -1, stdout: out, stderr: err }))
  })
}

async function expectOk(gitExe: string, root: string, argv: string[]): Promise<void> {
  const r = await rawGit(gitExe, root, argv)
  if (r.exitCode !== 0) {
    throw new Error(`fixture: git ${argv.join(' ')} failed (exit ${r.exitCode}): ${r.stderr || r.stdout}`)
  }
}

async function writeInto(root: string, rel: string, content: string): Promise<void> {
  const abs = join(root, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content, 'utf8')
}

async function injectConflict(
  gitExe: string,
  root: string,
  kind: NonNullable<TempRepoOptions['conflict']>,
  gitDir: string,
): Promise<void> {
  // 两侧对 plan 同一行 (topic) 做**不同**修改 → 3-way 合并必然冲突 (确定性).
  const sidePlan = PLAN_V1.replace('topic: TPC-1', 'topic: TPC-1-side')
  const mainPlan = PLAN_V1.replace('topic: TPC-1', 'topic: TPC-1-main')
  switch (kind) {
    case 'merge': {
      await expectOk(gitExe, root, ['checkout', '-b', 'side'])
      await writeInto(root, PLAN_PATH, sidePlan)
      await expectOk(gitExe, root, ['add', '--', PLAN_PATH])
      await expectOk(gitExe, root, ['commit', '-m', 'side: edit plan (fixture)'])
      await expectOk(gitExe, root, ['checkout', 'main'])
      await writeInto(root, PLAN_PATH, mainPlan)
      await expectOk(gitExe, root, ['add', '--', PLAN_PATH])
      await expectOk(gitExe, root, ['commit', '-m', 'main: edit plan (fixture)'])
      const m = await rawGit(gitExe, root, ['merge', 'side'])
      if (m.exitCode === 0) throw new Error('fixture: expected merge conflict, merge succeeded')
      if (!existsSync(join(gitDir, 'MERGE_HEAD')) || !statSync(join(gitDir, 'MERGE_HEAD')).isFile()) {
        throw new Error('fixture: MERGE_HEAD missing after conflicted merge')
      }
      return
    }
    case 'rebase-apply': {
      // git 2.53: am 后端不可选 (见文件头), 真实 rebase 停点写 rebase-merge/。
      // §5.1 检测 = 标志存在性 → 直接注入标志目录, 与检测面一致。
      await mkdir(join(gitDir, 'rebase-apply'), { recursive: true })
      return
    }
    case 'rebase-merge': {
      await expectOk(gitExe, root, ['checkout', '-b', 'side'])
      await writeInto(root, PLAN_PATH, sidePlan)
      await expectOk(gitExe, root, ['add', '--', PLAN_PATH])
      await expectOk(gitExe, root, ['commit', '-m', 'side: edit plan (fixture)'])
      await expectOk(gitExe, root, ['checkout', 'main'])
      await writeInto(root, PLAN_PATH, mainPlan)
      await expectOk(gitExe, root, ['add', '--', PLAN_PATH])
      await expectOk(gitExe, root, ['commit', '-m', 'main: edit plan (fixture)'])
      await expectOk(gitExe, root, ['checkout', 'side'])
      const rb = await rawGit(gitExe, root, ['rebase', 'main'])
      if (rb.exitCode === 0) throw new Error('fixture: expected rebase to stop on conflict')
      if (!existsSync(join(gitDir, 'rebase-merge')) || !statSync(join(gitDir, 'rebase-merge')).isDirectory()) {
        throw new Error('fixture: rebase-merge/ missing after stopped rebase')
      }
      return
    }
    case 'cherry-pick': {
      await expectOk(gitExe, root, ['checkout', '-b', 'side'])
      await writeInto(root, PLAN_PATH, sidePlan)
      await expectOk(gitExe, root, ['add', '--', PLAN_PATH])
      await expectOk(gitExe, root, ['commit', '-m', 'side: edit plan (fixture)'])
      await expectOk(gitExe, root, ['checkout', 'main'])
      await writeInto(root, PLAN_PATH, mainPlan)
      await expectOk(gitExe, root, ['add', '--', PLAN_PATH])
      await expectOk(gitExe, root, ['commit', '-m', 'main: edit plan (fixture)'])
      const mainHead = await rawGit(gitExe, root, ['rev-parse', 'main'])
      if (mainHead.exitCode !== 0) throw new Error('fixture: rev-parse main failed')
      await expectOk(gitExe, root, ['checkout', 'side'])
      const cp = await rawGit(gitExe, root, ['cherry-pick', mainHead.stdout.trim()])
      if (cp.exitCode === 0) throw new Error('fixture: expected cherry-pick conflict')
      if (!existsSync(join(gitDir, 'CHERRY_PICK_HEAD')) || !statSync(join(gitDir, 'CHERRY_PICK_HEAD')).isFile()) {
        throw new Error('fixture: CHERRY_PICK_HEAD missing after conflicted cherry-pick')
      }
      return
    }
  }
}

export async function makeTempRepo(options: TempRepoOptions = {}): Promise<TempRepo> {
  const gitExe = resolveGitExecutable()
  const root = await mkdtemp(join(tmpdir(), 'dsh-tc-git-'))
  try {
    await expectOk(gitExe, root, ['init', '-b', 'main'])
    for (const [k, v] of [
      ['user.name', 'Research Fixture'],
      ['user.email', 'fixture@example.invalid'],
      ['commit.gpgsign', 'false'],
    ]) {
      await expectOk(gitExe, root, ['config', k, v])
    }
    const gitDir = join(root, '.git')
    if (options.seedResearch ?? true) {
      await writeInto(root, '.research/project.yaml', 'project: TPC-1\ntitle: fixture project\n')
      await writeInto(root, PLAN_PATH, PLAN_V1)
      await writeInto(root, TASK1_PATH, 'id: T-1\ngoal: fixture task one\n')
      await writeInto(root, TASK2_PATH, 'id: T-2\ngoal: fixture task two\n')
      await writeInto(root, 'README.md', 'fixture repo — not part of .research/\n')
      await expectOk(gitExe, root, ['add', '--', '.research', 'README.md'])
      await expectOk(gitExe, root, ['commit', '-m', 'fixture: initial commit'])
    }
    if (options.conflict) {
      await injectConflict(gitExe, root, options.conflict, gitDir)
    }
    if (options.detachedHead) {
      await expectOk(gitExe, root, ['checkout', '--detach'])
    }
    return {
      root,
      gitDir,
      git: (argv, expect) => rawGit(gitExe, root, argv).then((r) => {
        if (expect?.fail) {
          if (r.exitCode === 0) {
            throw new Error(`fixture: expected git ${argv.join(' ')} to fail, but it succeeded`)
          }
        } else if (r.exitCode !== 0) {
          throw new Error(
            `fixture: git ${argv.join(' ')} failed (exit ${r.exitCode}): ${r.stderr || r.stdout}`,
          )
        }
        return r
      }),
      write: (rel, content) => writeInto(root, rel, content),
      read: (rel) => readFile(join(root, rel), 'utf8'),
      head: async () => {
        const h = await rawGit(gitExe, root, ['rev-parse', 'HEAD'])
        if (h.exitCode !== 0) throw new Error(`fixture: rev-parse HEAD failed: ${h.stderr}`)
        return h.stdout.trim()
      },
      dispose: () => rm(root, { recursive: true, force: true }),
    }
  } catch (e) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
    throw e
  }
}

/** 解析 fixture plan 的 ordered_items 顺序 (测试本地, 无 YAML 依赖). */
export function planOrder(content: string): string[] {
  const lines = content.split('\n')
  const start = lines.findIndex((l) => l.trim() === 'ordered_items:')
  if (start === -1) return []
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^\s*-\s*(\S+)\s*$/.exec(lines[i]!)
    if (m) out.push(m[1]!)
    else if (lines[i]!.trim() !== '') break
  }
  return out
}
