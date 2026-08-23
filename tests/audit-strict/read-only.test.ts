/**
 * WP-6.1 — 审计只读证明 (目标 3): 类型面 + 行为面.
 *
 * 类型面 (AST 静态证明, src/host/audit/strict/** 全文件):
 *  1. 零 spawn 通道: 无 node:child_process import — audit 层自身**无法**
 *     执行任何 git 子进程 (git 能力唯一来源 = src/host/git 公开面,
 *     其内部白名单护栏 INV-GIT-7 仍逐次生效);
 *  2. 零文件 I/O: 无 node:fs* import + 无 fs 写 API 调用标识符 —
 *     审计是「纯 git + 纯函数」, 无任何写路径 (discovery fs 扫描归 WP-6.2);
 *  3. git 面精确集合: 自 git wrapper 的**值导入** ⊆ {detectRepo(W1),
 *     status(W4), diffNameStatus(W5), lsFiles(W13), RESEARCH_PATHSPEC} —
 *     全部自动触发只读操作; W6–W12 (含全部写能力 W8/W9/W10/W12) 与
 *     组合原语 (saveCheckpoint/detectConflictState) 在类型面上不可达;
 *  4. INV-PERM-5 本地双查: 无 @deepseek-ai/* / deepseek-harness 面。
 *
 * 行为面 (临时仓全形态脏树): 执行 audit (双模式) 前后, 仓库**语义状态**
 * 逐位不变 — HEAD / index 语义 (ls-files -s) / 工作树文件集与内容哈希 /
 * .git 文件集 (index 的 stat-cache 字节除外 — git 自身元数据簿记, 非状态)。
 *
 * 与 §5.1 正交 (目标 4) 由 audit.test.ts「merge 冲突进行中照常执行」承载。
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import ts from 'typescript-6'

import { runStrictAudit } from '../../src/host/audit/strict/index.js'
import { makeTempRepo, PLAN_PATH, PLAN_V2, TASK1_PATH } from '../git/temp-repo.js'

const AUDIT_SRC_DIR = fileURLToPath(new URL('../../src/host/audit/strict/', import.meta.url))
const GIT_INDEX_SPEC = '../../git/index.js'

/** 允许的 git wrapper 值导入 (W1/W4/W5/W13 + 常量) — 全部自动触发只读. */
const ALLOWED_GIT_VALUE_IMPORTS = new Set([
  'detectRepo', // W1 仓库检测 (自动)
  'status', // W4 工作区状态 (自动)
  'diffNameStatus', // W5 变更清单 (自动)
  'lsFiles', // W13 枚举 tracked 文件 (自动)
  'RESEARCH_PATHSPEC', // 常量 (非能力)
])
/** 写能力/非 audit 面 (类型面必须不可达 — 允许集之外即违规). */
const WRITE_CAPABLE_GIT_EXPORTS = [
  'hashObject', // W3 (读, 非 audit 面)
  'logFile', // W6 (用户触发)
  'showFile', // W7 (用户触发)
  'restoreFile', // W8 **写**
  'stageResearch', // W9 **写**
  'commitResearch', // W10 **写**
  'revParseHead', // W11
  'initRepo', // W12 **写**
  'saveCheckpoint', // 组合原语 (含写)
  'detectConflictState', // 组合原语 (checkpoint 前置面)
  'parsePorcelainV2',
  'unquotePath',
]

interface ImportSite {
  rel: string
  specifier: string
  valueNames: string[]
  typeNames: string[]
  isDynamic: boolean
}

function auditSourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (p.endsWith('.ts')) out.push(p)
    }
  }
  walk(AUDIT_SRC_DIR)
  return out.sort()
}

function collectImports(file: string, text: string): ImportSite[] {
  const rel = file.slice(AUDIT_SRC_DIR.length)
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const sites: ImportSite[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const site: ImportSite = { rel, specifier: node.moduleSpecifier.text, valueNames: [], typeNames: [], isDynamic: false }
      const clause = node.importClause
      if (clause) {
        // `import type { … }` 整句类型导入 — 元素不带 isTypeOnly 标志.
        const wholeClauseTypeOnly = (clause as { isTypeOnly?: boolean }).isTypeOnly === true
        if (clause.name) {
          if (wholeClauseTypeOnly) site.typeNames.push(clause.name.text)
          else site.valueNames.push(clause.name.text)
        }
        // TS 6/7: duck-type NamedImports (.elements) vs NamespaceImport (.name) —
        // 同 tests/git/inv-git-static.test.ts 口径 (ts.isNamedBindings 已移除).
        const nb = clause.namedBindings as unknown as
          | { elements: { name: { text: string }; isTypeOnly?: boolean }[] }
          | { name: { text: string } }
          | undefined
        if (nb && 'elements' in nb) {
          for (const el of nb.elements) {
            if (wholeClauseTypeOnly || el.isTypeOnly) site.typeNames.push(el.name.text)
            else site.valueNames.push(el.name.text)
          }
        } else if (nb && 'name' in nb) {
          if (wholeClauseTypeOnly) site.typeNames.push(nb.name.text)
          else site.valueNames.push(nb.name.text) // namespace import
        }
      }
      sites.push(site)
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'import') {
      const arg = node.arguments[0]
      if (ts.isStringLiteral(arg)) {
        sites.push({ rel, specifier: arg.text, valueNames: ['<dynamic>'], typeNames: [], isDynamic: true })
      } else if (ts.isTemplateExpression(arg)) {
        // 模板字面量: head 为字面部分 — 前缀即静态可查 (check-imports WP-0.7 口径).
        sites.push({ rel, specifier: `<template:${arg.head.text}>`, valueNames: ['<dynamic>'], typeNames: [], isDynamic: true })
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const arg = node.arguments[0]
      if (ts.isStringLiteral(arg)) {
        sites.push({ rel, specifier: arg.text, valueNames: ['<require>'], typeNames: [], isDynamic: false })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return sites
}

describe('INV-AUDIT-RO (审计只读) — 类型面 (AST 静态证明)', () => {
  const files = auditSourceFiles()

  it('扫描面非空 (audit 模块确实存在 5 个源文件)', () => {
    expect(files.map((f) => f.slice(AUDIT_SRC_DIR.length))).toEqual([
      'audit.ts',
      'errors.ts',
      'index.ts',
      'policy.ts',
      'types.ts',
    ])
  })

  it('零 spawn 通道: 无 node:child_process import; 零文件 I/O: 无 node:fs* import', () => {
    const violations: string[] = []
    for (const file of files) {
      for (const site of collectImports(file, readFileSync(file, 'utf8'))) {
        const spec = site.specifier
        if (spec === 'node:child_process' || spec === 'child_process') {
          violations.push(`${site.rel}: import ${spec} — audit 层禁止自持 spawn 通道 (git 唯一面 = src/host/git)`)
        }
        if (spec === 'node:fs' || spec === 'fs' || spec.startsWith('node:fs/') || spec.startsWith('fs/')) {
          violations.push(`${site.rel}: import ${spec} — 审计零文件 I/O (discovery fs 扫描归 WP-6.2)`)
        }
        if (spec.includes('node:sqlite') || spec.includes('better-sqlite3')) {
          violations.push(`${site.rel}: import ${spec} — 审计不碰 operational DB`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('git 面精确集合: 值导入 ⊆ {W1,W4,W5,W13,RESEARCH_PATHSPEC}; 写能力导出不可达', () => {
    const violations: string[] = []
    let gitImportFiles = 0
    for (const file of files) {
      let sawGit = false
      for (const site of collectImports(file, readFileSync(file, 'utf8'))) {
        if (site.specifier !== GIT_INDEX_SPEC) continue
        sawGit = true
        for (const name of site.valueNames) {
          if (!ALLOWED_GIT_VALUE_IMPORTS.has(name)) {
            violations.push(
              `${site.rel}: 自 git wrapper 导入 ${name} — 允许集仅 ${[...ALLOWED_GIT_VALUE_IMPORTS].join('/')}` +
                (WRITE_CAPABLE_GIT_EXPORTS.includes(name) ? ' (写能力/非 audit 面, 结构上必须不可达)' : ''),
            )
          }
        }
      }
      if (sawGit) gitImportFiles++
    }
    expect(violations).toEqual([])
    // 护栏本身: 确实存在经 wrapper 的 git 导入 (证明能力来自白名单层而非旁路)
    expect(gitImportFiles).toBeGreaterThanOrEqual(1)
  })

  it('INV-PERM-5 本地双查: 无 DSH 包 / harness 路径 / 裸 spec 面', () => {
    const violations: string[] = []
    for (const file of files) {
      for (const site of collectImports(file, readFileSync(file, 'utf8'))) {
        const spec = site.specifier
        if (spec.startsWith('@deepseek-ai/') || spec.includes('deepseek-harness')) {
          violations.push(`${site.rel}: import ${spec} — INV-PERM-5 (adapter 外禁 DSH 内部模块)`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('无 fs 写 API 调用标识符 (writeFile/appendFile/unlink/rm/mkdir/rename/createWriteStream)', () => {
    const violations: string[] = []
    const WRITE_CALLS = new Set([
      'writeFile', 'appendFile', 'unlink', 'rm', 'rmSync', 'mkdir', 'mkdirSync',
      'rename', 'renameSync', 'createWriteStream', 'writeFileSync', 'appendFileSync',
    ])
    for (const file of files) {
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      const rel = file.slice(AUDIT_SRC_DIR.length)
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          WRITE_CALLS.has(node.expression.text)
        ) {
          violations.push(`${rel}: 调用 ${node.expression.text}() — 审计无写路径`)
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }
    expect(violations).toEqual([])
  })
})

describe('INV-AUDIT-RO (审计只读) — 行为面 (全形态脏树状态逐位不变)', () => {
  /** 仓库语义状态快照: HEAD + index 语义 + 工作树 (路径+内容哈希) + .git 文件集 (index stat-cache 除外). */
  async function snapshot(repo: Awaited<ReturnType<typeof makeTempRepo>>): Promise<unknown> {
    const head = await repo.git(['rev-parse', 'HEAD'])
    const index = await repo.git(['ls-files', '-s'])
    const tree = await repo.git(['status', '--porcelain=v2'])
    const files = new Map<string, string>()
    const walk = (abs: string, rel: string): void => {
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        const er = rel === '' ? e.name : `${rel}/${e.name}`
        if (e.isDirectory()) walk(join(abs, e.name), er)
        else if (e.isFile()) files.set(er, sha256(readFileSync(join(abs, e.name))))
      }
    }
    walk(repo.root, '')
    const worktree = [...files.entries()].filter(([p]) => !p.startsWith('.git/')).sort()
    const gitdir = [...files.entries()].filter(([p]) => p.startsWith('.git/') && p !== '.git/index').sort()
    return { head: head.stdout, index: index.stdout, status: tree.stdout, worktree, gitdir }
  }

  function sha256(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex')
  }

  it('audit 双模式 (unstaged + baseline) 执行后: HEAD/index 语义/工作树/.git 文件集逐位不变', async () => {
    const repo = await makeTempRepo()
    try {
      // 全形态脏树: 未暂存修改 + 暂存修改 + 暂存删除 + 未暂存删除 + rename + untracked
      await repo.write(PLAN_PATH, PLAN_V2)
      await repo.write('README.md', 'edit\n')
      await repo.git(['add', '--', 'README.md'])
      await repo.git(['rm', '--quiet', TASK1_PATH])
      const T2 = '.research/topics/TPC-1/workstreams/WS-1/items/tasks/T-2.yaml'
      const T2B = '.research/topics/TPC-1/workstreams/WS-1/items/tasks/T-2b.yaml'
      await repo.git(['mv', T2, T2B])
      await repo.write('results/x.csv', 'a\n')
      await repo.write('.research/topics/NEW/topic.yaml', 'id: NEW\n')

      const before = await snapshot(repo)
      const head = await repo.head()
      await runStrictAudit({ workspaceRoot: repo.root })
      await runStrictAudit({
        workspaceRoot: repo.root,
        baseline: head,
        policy: undefined,
      })
      const after = await snapshot(repo)
      expect(after).toEqual(before)
    } finally {
      await repo.dispose()
    }
  })
})
