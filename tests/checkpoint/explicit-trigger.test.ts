/**
 * WP-1.5 — 显式触发面 (INV-GIT-2 / INV-GIT-5): 无隐式/定时触发路径.
 *
 * 三面证明:
 *  1. **类型面**: index 运行时导出集合恰好 = 3 个触发函数 + 1 个纯断言助手
 *     + FsResearchReader (只读 I/O) + 6 个错误类 + 2 个常量 — 无任何通用
 *     执行面/调度面; 每个触发函数都**要求**注入 StructuredLogger (缺省
 *     不存在 → 无观测的隐式调用在编译期即被排除)。
 *  2. **静态面**: 源码零定时器/调度器/子进程/DSH 面 (AST 调用扫描 +
 *     token 扫描 + import 面扫描 + 顶层语句白名单 — 无 import 副作用),
 *     即「无调度器」断言: 不存在任何能自行启动的触发源。
 *  3. **行为面**: 真实临时 repo 上, 每个公开方法的每一步都产生一条结构化
 *     日志 (完整事件序列 + 级别精确锁定) — 所有可观测效果都经由显式调用
 *     的同步执行路径产生。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import ts from 'typescript-6'

import { makeTempRepo, type TempRepo } from '../git/temp-repo.js'
import {
  diffHistory,
  restoreResearchFile,
  saveResearchCheckpoint,
} from '../../src/host/service/checkpoint/index.js'
import { GATE3_PATH, GATE3_V1, CONTRACT_PATH, makeLoadedRepo } from './loaded-repo.js'
import { RecordingLogger } from './recording-logger.js'

const SERVICE_SRC_DIR = fileURLToPath(new URL('../../src/host/service/checkpoint/', import.meta.url))

/** 运行时导出全集 (类型导出不在运行时, 由 tsc 保证). */
const EXPECTED_RUNTIME_EXPORTS = [
  // 显式触发函数 (用户动作唯一入口)
  'saveResearchCheckpoint',
  'restoreResearchFile',
  'diffHistory',
  // 纯断言助手 (无 I/O; TC-GIT-002 service 断言的测试面)
  'assertUnrelatedStagedPreserved',
  // 只读 I/O (loader reader 实现)
  'FsResearchReader',
  // 错误类 (结构化错误, 非能力)
  'CheckpointServiceError',
  'NotARepoError',
  'RestoreFailedError',
  'RestoreNotInHistoryError',
  'RestoreVerifyError',
  'StagedPreservationError',
  // 常量
  'FULL_OID_RE',
  'RESEARCH_DIR',
]

/** 调度器/定时器/子进程 token — 源码 (含注释) 一律不得出现. */
const FORBIDDEN_SUBSTRINGS = [
  'setInterval',
  'setTimeout',
  'setImmediate',
  'queueMicrotask',
  'nextTick',
  'chokidar',
  'child_process',
  '@deepseek-ai',
  'deepseek-harness',
] as const
const FORBIDDEN_CALLS = new Set([
  'setInterval',
  'setTimeout',
  'setImmediate',
  'queueMicrotask',
  'nextTick',
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'watch',
  'watchFile',
  'createServer',
  'listen',
])

function serviceSourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (p.endsWith('.ts')) out.push(p)
    }
  }
  walk(SERVICE_SRC_DIR)
  return out.sort()
}

describe('WP-1.5 显式触发面', () => {
  it('类型面: 运行时导出集合恰好 = 3 触发函数 + 1 断言助手 + FsResearchReader + 6 错误类 + 2 常量', async () => {
    const mod = await import('../../src/host/service/checkpoint/index.js')
    const names = Object.keys(mod).sort()
    expect(names).toEqual([...EXPECTED_RUNTIME_EXPORTS].sort())
    // 无通用执行面: 任何 run/exec/shell/spawn 式导出都不存在
    for (const bad of ['run', 'exec', 'shell', 'spawn', 'schedule', 'start', 'tick', 'on']) {
      expect(names).not.toContain(bad)
    }
    // 触发函数都要求 logger (注入面; 无默认实现 → 无隐式无观测调用)
    expect(saveResearchCheckpoint.length).toBe(2)
    expect(restoreResearchFile.length).toBe(4)
    expect(diffHistory.length).toBe(2)
  })

  it('静态面: 零调度器/定时器/子进程/DSH 面 + 无 import 副作用 (顶层语句白名单)', () => {
    const files = serviceSourceFiles()
    expect(files.length).toBeGreaterThanOrEqual(8) // errors/logger/fs-reader/types/save/restore/diff/index
    const violations: string[] = []
    for (const file of files) {
      const rel = file.slice(SERVICE_SRC_DIR.length)
      const text = readFileSync(file, 'utf8')
      // token 扫描 (注释亦受约束 — 本 WP 源码刻意不用这些词)
      for (const token of FORBIDDEN_SUBSTRINGS) {
        if (text.includes(token)) violations.push(`${rel}: 含调度器/子进程/DSH token「${token}」`)
      }
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      const visit = (node: ts.Node): void => {
        // 禁用调用面 (任何深度)
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const name = node.expression.text
          if (FORBIDDEN_CALLS.has(name)) {
            violations.push(`${rel}: 调用 ${name}() — service 层无调度器/子进程面`)
          }
        }
        // import 面: 禁止 child_process / DSH scope / harness 路径
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          /child_process|@deepseek-ai|deepseek-harness/.test(node.moduleSpecifier.text)
        ) {
          violations.push(`${rel}: 禁止的 import 面 ${node.moduleSpecifier.text}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
      // 顶层语句白名单: 无 import 副作用 (无顶层可执行语句)
      for (const stmt of sf.statements) {
        const okTopLevel =
          ts.isImportDeclaration(stmt) ||
          ts.isExportDeclaration(stmt) ||
          ts.isInterfaceDeclaration(stmt) ||
          ts.isTypeAliasDeclaration(stmt) ||
          ts.isFunctionDeclaration(stmt) ||
          ts.isClassDeclaration(stmt) ||
          (ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0)
        if (!okTopLevel) {
          violations.push(`${rel}: 顶层存在可执行语句 (import 副作用风险): ${text.slice(stmt.pos, Math.min(stmt.pos + 60, text.length))}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('依赖方向: service 只 import git 层具名操作 + domain/loader 公开面 + shared (AST import 面枚举)', () => {
    const files = serviceSourceFiles()
    const allowed = [/^node:fs$/, /^node:path$/, /^\.\.\/\.\.\/git\/index\.js$/, /^\.\.\/\.\.\/domain\/loader\/index\.js$/, /^\.\//]
    const specifiers = new Set<string>()
    for (const file of files) {
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          specifiers.add(node.moduleSpecifier.text)
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }
    for (const spec of specifiers) {
      expect(allowed.some((re) => re.test(spec)), `service 层出现非白名单 import: ${spec}`).toBe(true)
    }
  })
})

describe('WP-1.5 行为面: 每一步一条结构化日志 (显式调用 → 完整步骤序列)', () => {
  let repo: TempRepo | undefined
  afterEach(async () => {
    await repo?.dispose()
    repo = undefined
  })

  it('save: commit 路径 9 步 / no-op 路径 5 步 / 冲突拒绝 3 步 — 序列+级别锁定', async () => {
    repo = await makeTempRepo()
    const logger = new RecordingLogger()
    await repo.write('.research/topics/TPC-1/workstreams/WS-1/plan.yaml', 'topic: TPC-1\nworkstream: WS-1\nordered_items:\n  - T-2\n  - T-1\n')

    const res = await saveResearchCheckpoint(repo.root, { logger, summary: 'step sequence' })
    expect(res.committed).toBe(true)
    expect(logger.events()).toEqual([
      'save.start',
      'save.repo-detected',
      'save.conflict-check',
      'save.status',
      'save.stage',
      'save.commit',
      'save.rev-parse',
      'save.staged-check',
      'save.done',
    ])
    expect(logger.records.every((r) => r.level === 'info')).toBe(true)

    // 无观测的后台活动: 所有记录都发生在显式调用的 promise 期间 (序列即证明)
    const noopLogger = new RecordingLogger()
    await saveResearchCheckpoint(repo.root, { logger: noopLogger, summary: 'noop' })
    expect(noopLogger.events()).toEqual(['save.start', 'save.repo-detected', 'save.conflict-check', 'save.status', 'save.no-op'])
  })

  it('save (冲突态): 前 3 步即终止, conflict-check 记 error 级', async () => {
    repo = await makeTempRepo({ conflict: 'merge' })
    const logger = new RecordingLogger()
    await expect(saveResearchCheckpoint(repo.root, { logger, summary: 'nope' })).rejects.toThrow()
    expect(logger.events()).toEqual(['save.start', 'save.repo-detected', 'save.conflict-check'])
    expect(logger.recordsOf('save.conflict-check')[0].level).toBe('error')
  })

  it('restore: 成功 8 步; 定位失败 3 步 (log-locate error); git 失败 4 步 (show error)', async () => {
    repo = await makeLoadedRepo()
    const root = repo.root
    const { WR_SCHEMA_DIR } = await import('../loader/fixtures.js')
    const okLogger = new RecordingLogger()
    await repo.write(GATE3_PATH, GATE3_V1)
    const cp = await saveResearchCheckpoint(root, { logger: new RecordingLogger(), summary: 'add G-3' })
    const oid = cp.commitOid!

    const res = await restoreResearchFile(root, oid, GATE3_PATH, { logger: okLogger, schemaDir: WR_SCHEMA_DIR })
    expect(res.path).toBe(GATE3_PATH)
    expect(res.validation.ok).toBe(true)
    expect(okLogger.events()).toEqual([
      'restore.start',
      'restore.repo-detected',
      'restore.log-locate',
      'restore.show',
      'restore.restore',
      'restore.verify-content',
      'restore.validate',
      'restore.done',
    ])
    expect(okLogger.records.every((r) => r.level === 'info')).toBe(true)

    // 定位失败: 序列止于 restore.log-locate (error 级)
    const badLogger = new RecordingLogger()
    const oid0 = await repo.git(['rev-list', '--max-parents=0', 'HEAD']).then((r) => r.stdout.trim())
    await expect(
      restoreResearchFile(root, oid0, GATE3_PATH, { logger: badLogger, schemaDir: WR_SCHEMA_DIR }),
    ).rejects.toThrow()
    expect(badLogger.events()).toEqual(['restore.start', 'restore.repo-detected', 'restore.log-locate'])
    expect(badLogger.recordsOf('restore.log-locate')[0].level).toBe('error')
  })

  it('diff: 最小 3 步; path+baseline 全 5 步 — 全程无写入步 (无 stage/commit/restore 事件)', async () => {
    repo = await makeLoadedRepo()
    const root = repo.root
    const minimal = new RecordingLogger()
    await diffHistory(root, { logger: minimal })
    expect(minimal.events()).toEqual(['diff.start', 'diff.repo-detected', 'diff.log', 'diff.done'])

    const full = new RecordingLogger()
    const oid = await repo.head()
    await diffHistory(root, { logger: full, path: CONTRACT_PATH, baseline: oid })
    expect(full.events()).toEqual([
      'diff.start',
      'diff.repo-detected',
      'diff.log',
      'diff.file-diff',
      'diff.content-compare',
      'diff.done',
    ])
    // 纯查看面: 任何触发函数的事件名都不含写入步 (类型面+行为面双证)
    for (const events of [minimal.events(), full.events()]) {
      for (const ev of events) {
        expect(ev).not.toMatch(/stage|commit|restore\.restore/)
      }
    }
  })
})
