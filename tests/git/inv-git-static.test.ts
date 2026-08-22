/**
 * WP-1.2 — 静态不变量 (TEST_MATRIX §2.3 INV-GIT-* 映射表):
 *
 *  - INV-GIT-2 (无自动 commit 路径 — 类型面断言不存在隐式 commit):
 *    导出集合恰为 13 个 W 操作 + 2 个组合原语 + 2 个数据工具 + 8 个错误类;
 *    唯一 commit 能力是 W10 (commitResearch, pathspec 固定 .research/);
 *    行为面 (读操作零 commit) 由 TC-GIT-001 补充。
 *  - INV-GIT-6 (git 层源码无 shell 拼接 — spawn 全 argv 数组):
 *    AST 扫描 src/host/git — 仅 spawn() 自 node:child_process, 参数为
 *    argv 数组, 无 exec* 系 API, 无 shell: true。
 *  - INV-GIT-7 (白名单外的 git 子命令不可达):
 *    类型面 (导出精确集合 + 白名单表 W1..W13 逐行) + 运行时 (禁用 argv
 *    电池逐一被 assertWhitelisted 拒绝, GitWhitelistViolationError)。
 *  - (INV-GIT-8 无 revision 表的 schema 断言在 tc-git-015.test.ts)
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import ts from 'typescript-6'
import * as git from '../../src/host/git/index.js'
import { assertWhitelisted } from '../../src/host/git/whitelist.js'

const GIT_SRC_DIR = fileURLToPath(new URL('../../src/host/git/', import.meta.url))

/** 13 个白名单操作 (W1–W13, 名称 → 白名单行). */
const OPERATION_NAMES = [
  'detectRepo', // W1
  'resolveGitDir', // W2
  'hashObject', // W3
  'status', // W4
  'diffNameStatus', // W5
  'logFile', // W6
  'showFile', // W7
  'restoreFile', // W8
  'stageResearch', // W9
  'commitResearch', // W10
  'revParseHead', // W11
  'initRepo', // W12
  'lsFiles', // W13
] as const
/** 组合原语 (§5.1 / §5 git 半边). */
const COMPOSITE_NAMES = ['detectConflictState', 'saveCheckpoint'] as const
/** 纯数据工具 (无 git 能力). */
const UTILITY_NAMES = ['parsePorcelainV2', 'unquotePath'] as const
/** 错误类 (类型化错误, 非能力). */
const ERROR_NAMES = [
  'GitError',
  'GitCommandError',
  'GitConflictStateError',
  'GitInputError',
  'GitMissingError',
  'GitScopeViolationError',
  'GitTimeoutError',
  'GitWhitelistViolationError',
] as const

function functionExports(): string[] {
  return Object.entries(git)
    .filter(([, v]) => typeof v === 'function')
    .map(([n]) => n)
    .sort()
}

function gitSourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (p.endsWith('.ts')) out.push(p)
    }
  }
  walk(GIT_SRC_DIR)
  return out.sort()
}

describe('INV-GIT-7: 白名单外命令不可达 (类型面)', () => {
  it('index 函数导出集合恰好 = 13 W 操作 + 2 组合原语 + 2 数据工具 + 8 错误类', () => {
    const expected = [...OPERATION_NAMES, ...COMPOSITE_NAMES, ...UTILITY_NAMES, ...ERROR_NAMES].sort()
    expect(functionExports()).toEqual(expected)
    // 无通用执行面: 任何 run/exec/spawn/shell/裸 commit/add 导出都不存在
    for (const bad of ['run', 'runGit', 'exec', 'spawn', 'shell', 'commit', 'add', 'git', 'execute']) {
      expect(functionExports()).not.toContain(bad)
    }
  })

  it('白名单表恰为 W1..W13, 与冻结 §3 表逐行一致 (子命令/触发列)', () => {
    expect(git.WHITELIST_ROWS.map((r) => r.id)).toEqual([
      'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12', 'W13',
    ])
    const byId = new Map(git.WHITELIST_ROWS.map((r) => [r.id, r]))
    const expectSubcommand: Record<string, string> = {
      W1: 'rev-parse', W2: 'rev-parse', W3: 'hash-object', W4: 'status', W5: 'diff',
      W6: 'log', W7: 'show', W8: 'restore', W9: 'add', W10: 'commit', W11: 'rev-parse',
      W12: 'init', W13: 'ls-files',
    }
    for (const [id, sub] of Object.entries(expectSubcommand)) {
      expect(byId.get(id)!.argv[0]).toBe(sub)
    }
    // 触发列照录 §3: W6/W7/W8/W9/W10/W11/W12 = 用户, 其余 = 自动
    expect(git.WHITELIST_ROWS.filter((r) => r.trigger === 'user').map((r) => r.id)).toEqual([
      'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12',
    ])
    expect(git.WHITELIST_ROWS.filter((r) => r.trigger === 'auto').map((r) => r.id)).toEqual([
      'W1', 'W2', 'W3', 'W4', 'W5', 'W13',
    ])
  })

  it('运行时: 禁用 argv 电池逐一被拒 (GitWhitelistViolationError)', () => {
    const forbidden: string[][] = [
      // §4 禁止操作清单 (网络/历史改写/分支/清理/…):
      ['push', 'origin', 'main'],
      ['pull'],
      ['fetch', 'origin'],
      ['clone', 'https://example.invalid/x.git'],
      ['merge', 'side'],
      ['rebase', 'main'],
      ['cherry-pick', 'a'.repeat(40)],
      ['revert', 'HEAD'],
      ['reset', '--hard', 'HEAD~1'],
      ['checkout', '-b', 'x'],
      ['switch', 'main'],
      ['clean', '-fd'],
      ['stash'],
      ['rm', '--', 'x.yaml'],
      ['mv', 'a', 'b'],
      ['reflog'],
      ['gc', '--aggressive'],
      ['filter-branch', '--all'],
      ['update-ref', 'refs/heads/x', 'y'.repeat(40)],
      // 同子命令但非白名单形状 (语法面同样精确):
      ['add', '--', 'other.txt'], // W9 pathspec 固定 .research/
      ['commit', '-m', 'x'], // 无 pathspec
      ['commit', '-m', 'research: x'], // 无 pathspec
      ['commit', '-m', 'research: x', '--', 'other/'], // 错误 pathspec
      ['restore', '--', '.research/x.yaml'], // 无 --source
      ['restore', '--source=HEAD', '--', '.research/x.yaml'], // 非 40-hex OID
      ['show', 'HEAD'], // 非 <oid>:<path>
      ['log', '--oneline', '--', '.research/x.yaml'], // 非冻结格式串
      ['status', '--porcelain'], // 非 v2
      ['rev-parse', 'HEAD~1'],
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      ['diff'], // 非 --name-status
      ['diff', '--name-status', 'main'], // baseline 必须 40-hex OID
      ['hash-object', '.research/x.yaml'], // 无 -- 分隔
      ['ls-files'], // 无 pathspec
    ]
    for (const argv of forbidden) {
      expect(() => assertWhitelisted(argv), `expected rejection: git ${argv.join(' ')}`).toThrow(
        git.GitWhitelistViolationError,
      )
    }
    // 正面: 白名单形状放行 (含可选分页/分支头)
    expect(() => assertWhitelisted(['rev-parse', '--show-toplevel'])).not.toThrow()
    expect(() => assertWhitelisted(['commit', '-m', 'research: x', '--', '.research/'])).not.toThrow()
    expect(() =>
      assertWhitelisted(['restore', `--source=${'a'.repeat(40)}`, '--', '.research/x.yaml']),
    ).not.toThrow()
    expect(() =>
      assertWhitelisted(['log', '--format=%H%x1f%aI%x1f%s', '-n', '5', '--skip', '2', '--', '.research/x.yaml']),
    ).not.toThrow()
    expect(() => assertWhitelisted(['status', '--porcelain=v2', '--branch'])).not.toThrow()
    expect(() => assertWhitelisted(['diff', '--name-status', 'a'.repeat(40)])).not.toThrow()
    expect(() => assertWhitelisted(['init'])).not.toThrow()
    expect(() => assertWhitelisted(['ls-files', '--', '.research/'])).not.toThrow()
  })
})

describe('INV-GIT-2: 无自动 commit 路径 (类型面)', () => {
  it('唯一 commit 能力 = W10 (pathspec 固定 .research/); add 仅 W9', () => {
    const commitRows = git.WHITELIST_ROWS.filter((r) => r.argv[0] === 'commit')
    expect(commitRows.map((r) => r.id)).toEqual(['W10'])
    expect(commitRows[0]!.argv.at(-1)).toBe('.research/')
    const addRows = git.WHITELIST_ROWS.filter((r) => r.argv[0] === 'add')
    expect(addRows.map((r) => r.id)).toEqual(['W9'])
    expect(addRows[0]!.argv.at(-1)).toBe('.research/')
    // 类型面: 含 "commit" 的导出函数只有 commitResearch (W10 具名操作)
    expect(functionExports().filter((n) => /commit/i.test(n))).toEqual(['commitResearch'])
  })

  it('commitResearch 强制 research: 前缀 (message 格式, §5)', async () => {
    // 不 spawn 即被拒 (输入校验先于 transport) — 无需临时 repo
    await expect(git.commitResearch('/definitely/not/a/repo', 'random message')).rejects.toMatchObject({
      code: 'GIT_INPUT',
    })
    await expect(git.commitResearch('/definitely/not/a/repo', '')).rejects.toMatchObject({
      code: 'GIT_INPUT',
    })
  })
})

describe('INV-GIT-6: git 层源码无 shell 拼接 (spawn 全 argv 数组)', () => {
  it('AST: 仅 spawn() (node:child_process), argv 数组, 无 exec*, 无 shell:true', () => {
    const files = gitSourceFiles()
    expect(files.length).toBeGreaterThanOrEqual(6)
    let spawnCalls = 0
    const violations: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      const importedFromChildProcess = new Set<string>()
      let hasChildProcessImport = false
      const rel = file.slice(GIT_SRC_DIR.length)
      const visit = (node: ts.Node): void => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          (node.moduleSpecifier.text === 'node:child_process' ||
            node.moduleSpecifier.text === 'child_process')
        ) {
          hasChildProcessImport = true
          const clause = node.importClause
          if (clause?.name) importedFromChildProcess.add(clause.name.text)
          // TS 6 (typescript-6) dropped ts.isNamedBindings — duck-type
          // NamedImports (has .elements) vs NamespaceImport (has .name).
          const nb = clause?.namedBindings as unknown as
            | { elements?: { name: { text: string }; isTypeOnly?: boolean }[] }
            | undefined
          if (nb?.elements) {
            for (const el of nb.elements) {
              if (!el.isTypeOnly) importedFromChildProcess.add(el.name.text)
            }
          }
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const name = node.expression.text
          if (
            name === 'exec' ||
            name === 'execSync' ||
            name === 'execFile' ||
            name === 'execFileSync' ||
            name === 'spawnSync'
          ) {
            violations.push(`${rel}: 使用 ${name}() — 仅允许 spawn() argv 数组 (INV-GIT-6)`)
          }
          if (name === 'spawn') {
            spawnCalls++
            const arg1 = node.arguments[1]
            const isArrayArg =
              arg1 !== undefined && (ts.isArrayLiteralExpression(arg1) || ts.isIdentifier(arg1))
            if (!isArrayArg) {
              violations.push(`${rel}: spawn() 的 arguments 参数不是 argv 数组 (字符串拼接?) (INV-GIT-6)`)
            }
          }
        }
        if (
          ts.isPropertyAssignment(node) &&
          node.name.getText() === 'shell' &&
          node.initializer.getText() === 'true'
        ) {
          violations.push(`${rel}: shell: true — 禁止 (INV-GIT-6)`)
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
      if (hasChildProcessImport) {
        for (const name of importedFromChildProcess) {
          if (name !== 'spawn') {
            violations.push(`${rel}: 自 node:child_process 导入 ${name} — 仅允许 spawn (INV-GIT-6)`)
          }
        }
      }
    }
    // 护栏确实存在 (runner 经 spawn 调用 git)
    expect(spawnCalls).toBeGreaterThanOrEqual(1)
    expect(violations).toEqual([])
  })
})
