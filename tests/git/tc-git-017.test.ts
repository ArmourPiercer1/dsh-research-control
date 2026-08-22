/**
 * TC-GIT-017 (TEST_MATRIX §3.3): 显式 init.
 * 断言要点: 仅 GUI 显式操作触发; 自动路径永不出现在调用图中.
 *
 * INV-GIT-1: 绝不静默 git init (显式 GUI 按钮除外) — W12 是白名单中唯一的
 * `init` 入口。本用例: ① 行为面 (自动路径不产生 .git, 显式 initRepo 成功);
 * ② 调用图静态面 (src/host/git 中 `init` 子命令字面量仅出现于 initRepo
 * 定义处 — 自动路径的调用图中无 init)。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import ts from 'typescript-6'
import * as git from '../../src/host/git/index.js'

const GIT_SRC_DIR = fileURLToPath(new URL('../../src/host/git/', import.meta.url))

function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkFiles(p))
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out.sort()
}

/** src/host/git 中出现在数组字面量里的 'init' 字符串字面量位置. */
function initArrayLiterals(): { file: string; count: number }[] {
  const perFile = new Map<string, number>()
  for (const file of walkFiles(GIT_SRC_DIR)) {
    const text = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    let count = 0
    const visit = (node: ts.Node): void => {
      if (ts.isArrayLiteralExpression(node)) {
        for (const el of node.elements) {
          if (ts.isStringLiteralLike(el) && el.text === 'init') count++
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    perFile.set(file, count)
  }
  return [...perFile.entries()].map(([file, count]) => ({ file, count }))
}

describe('TC-GIT-017 显式 init (INV-GIT-1)', () => {
  it('自动路径永不 init; 显式 initRepo 是唯一入口且有效', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-init-'))
    try {
      // 自动路径: 注册检测拒绝, 无 .git
      expect(await git.detectRepo(dir)).toEqual({ ok: false, reason: 'not-a-repo' })
      // 自动路径: 其他操作 fail loud, 依然无 init 副作用
      await expect(git.lsFiles(dir, '.research/')).rejects.toMatchObject({ code: 'GIT_COMMAND' })
      expect(existsSync(join(dir, '.git'))).toBe(false)

      // 显式路径 (用户确认对话框 → W12): init 成功
      const returned = await git.initRepo(dir)
      expect(returned).toBe(dir)
      expect(existsSync(join(dir, '.git'))).toBe(true)
      expect(await git.detectRepo(dir)).toEqual({ ok: true, repoRoot: dir })

      // initRepo 不创建目录 (fail loud, 不静默建用户目录)
      await expect(git.initRepo(join(dir, 'nope', 'never'))).rejects.toMatchObject({
        code: 'GIT_INPUT',
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('调用图静态断言: init 执行路径仅 initRepo (whitelist.ts 仅一行数据)', () => {
    const sites = initArrayLiterals()
    const total = Object.fromEntries(sites.map((s) => [s.file, s.count]))
    const opFile = sites.find((s) => s.file.endsWith('operations.ts'))!
    const wlFile = sites.find((s) => s.file.endsWith('whitelist.ts'))!
    // 执行面: init argv 仅构造于 operations.ts 的 initRepo 定义处 (1 处)
    expect(opFile.count).toBe(1)
    // 数据面: whitelist.ts 中 'init' 仅出现在 W12 行的代表性 argv (1 处, 非调用)
    expect(wlFile.count).toBe(1)
    // 其余文件 (runner/conflict/checkpoint/…) 的调用图中无任何 init
    for (const s of sites) {
      if (!s.file.endsWith('operations.ts') && !s.file.endsWith('whitelist.ts')) {
        expect(s.count).toBe(0)
      }
    }
    // 白名单表中 init 仅一行 (W12), 且 trigger=user (用户显式触发)
    const initRows = git.WHITELIST_ROWS.filter((r) => r.argv[0] === 'init')
    expect(initRows.map((r) => [r.id, r.trigger])).toEqual([['W12', 'user']])
  })
})
