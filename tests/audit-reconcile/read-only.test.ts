/**
 * WP-6.3 — 不改写历史 / 结构只读证明（任务书「不改写历史断言」+
 * 机械层边界）.
 *
 * 类型面（AST 静态证明, src/host/audit/reconcile/** 全文件）:
 *  1. 零存储通道: 无 node:sqlite / better-sqlite3 import — 本层**无法**
 *     触碰 operational DB（History 事件 / Inbox 行 / intervention 行
 *     的落库全部在 service 层, 结构上不可达）;
 *  2. 零 I/O 通道: 无 node:fs* / node:child_process import — 纯函数层
 *     （文件版本与 diff 归 Git, §22.3「插件不实现自己的文件历史系统」—
 *     本层连读都不读文件系统, 更不改写）;
 *  3. 零 DSH 面（INV-PERM-5 本地双查）: 无 @deepseek-ai/* /
 *     deepseek-harness 面;
 *  4. 零层逆依赖（ARCHITECTURE §2.2）: 无 import 指向
 *     history/ / persistence/ / service/ / git/ — 「不动 History 事件」
 *     的结构性半边: 事件面（registry/store）在本层类型面上不可达;
 *  5. 零动态通道: 无 dynamic import / require（静态面即全能力面）。
 *
 * 行为面（纯函数钉）:
 *  6. 输入深冻结后执行 分类 + 三档 + 忽略 全流程 — 严格模式下任何对
 *     冻结输入的写入即抛错 ⇒ 通过 = 输入零改动;
 *  7. 全流程输出确定性（同输入同输出, 双跑逐字段同）.
 *
 * 与 seams.test.ts 的分工: 彼处钉**产物语义**（封闭 4 形态 / 新建对象
 *  草稿 / CAPTURED 入口态）, 此处钉**通道不可达**（无 I/O / 无存储 /
 *  无层逆依赖）— 两半合起来 = 「不改写历史、不动 History 事件」的
 *  完整证明。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import ts from 'typescript-6'

import {
  RECONCILE_USER_ACTOR,
  classifyDiscrepancies,
  reconcileDiscrepancies,
} from '../../src/host/audit/reconcile/index.js'
import { scenarioA } from './helpers.js'

const RECONCILE_SRC_DIR = fileURLToPath(new URL('../../src/host/audit/reconcile/', import.meta.url))

interface ImportSite {
  rel: string
  specifier: string
  valueNames: string[]
  typeNames: string[]
  isDynamic: boolean
}

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (p.endsWith('.ts')) out.push(p)
    }
  }
  walk(RECONCILE_SRC_DIR)
  return out.sort()
}

function collectImports(file: string, text: string): ImportSite[] {
  const rel = file.slice(RECONCILE_SRC_DIR.length)
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const sites: ImportSite[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const site: ImportSite = { rel, specifier: node.moduleSpecifier.text, valueNames: [], typeNames: [], isDynamic: false }
      const clause = node.importClause
      if (clause) {
        const wholeClauseTypeOnly = (clause as { isTypeOnly?: boolean }).isTypeOnly === true
        if (clause.name) {
          if (wholeClauseTypeOnly) site.typeNames.push(clause.name.text)
          else site.valueNames.push(clause.name.text)
        }
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
          else site.valueNames.push(nb.name.text)
        }
      }
      sites.push(site)
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'import') {
      const arg = node.arguments[0]
      if (ts.isStringLiteral(arg)) {
        sites.push({ rel, specifier: arg.text, valueNames: ['<dynamic>'], typeNames: [], isDynamic: true })
      } else if (ts.isTemplateExpression(arg)) {
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

/** 递归深冻结（Map/Set 冻结包装器 + 逐元素冻结 — 严格模式下写入即抛错）。 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Map) {
    for (const [k, v] of value) {
      deepFreeze(k)
      deepFreeze(v)
    }
    Object.freeze(value)
    return value
  }
  if (value instanceof Set) {
    for (const v of value) deepFreeze(v)
    Object.freeze(value)
    return value
  }
  if (Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const v of Object.values(value)) deepFreeze(v)
  return value
}

describe('INV-RECONCILE-RO（不改写历史 / 结构只读）— 类型面（AST 静态证明）', () => {
  const files = sourceFiles()

  it('扫描面非空（reconcile 模块 = 7 个源文件）', () => {
    expect(files.map((f) => f.slice(RECONCILE_SRC_DIR.length))).toEqual([
      'classify.ts',
      'constants.ts',
      'errors.ts',
      'inbox.ts',
      'index.ts',
      'tiers.ts',
      'types.ts',
    ])
  })

  it('零存储通道（无 node:sqlite/better-sqlite3）+ 零 I/O 通道（无 node:fs*）+ 零 spawn 通道（无 node:child_process）', () => {
    const violations: string[] = []
    for (const file of files) {
      for (const site of collectImports(file, readFileSync(file, 'utf8'))) {
        const spec = site.specifier
        if (spec.includes('node:sqlite') || spec.includes('better-sqlite3') || spec.includes('sqlite')) {
          violations.push(`${site.rel}: import ${spec} — reconcile 不碰 operational DB（History/Inbox 行全部在 service 层）`)
        }
        if (spec === 'node:fs' || spec === 'fs' || spec.startsWith('node:fs/') || spec.startsWith('fs/')) {
          violations.push(`${site.rel}: import ${spec} — reconcile 零文件 I/O（文件历史归 Git, §22.3）`)
        }
        if (spec === 'node:child_process' || spec === 'child_process') {
          violations.push(`${site.rel}: import ${spec} — reconcile 无自持 spawn 通道（git-free 层）`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('INV-PERM-5 本地双查: 无 DSH 包 / harness 路径', () => {
    const violations: string[] = []
    for (const file of files) {
      for (const site of collectImports(file, readFileSync(file, 'utf8'))) {
        const spec = site.specifier
        if (spec.startsWith('@deepseek-ai/') || spec.includes('deepseek-harness')) {
          violations.push(`${site.rel}: import ${spec} — INV-PERM-5`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('零层逆依赖（§2.2）: 无 history/ / persistence/ / service/ / git/ import — 事件面结构不可达', () => {
    const FORBIDDEN_LAYERS = ['/history/', '/persistence/', '/service/', '/git/']
    const violations: string[] = []
    for (const file of files) {
      for (const site of collectImports(file, readFileSync(file, 'utf8'))) {
        for (const layer of FORBIDDEN_LAYERS) {
          if (site.specifier.includes(layer)) {
            violations.push(`${site.rel}: import ${site.specifier} — 层方向违规（audit 不得依赖 ${layer.replace(/\//g, '')} 层, ARCHITECTURE §2.2）`)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('零动态通道: 无 dynamic import / require（静态面 = 全能力面）', () => {
    const violations: string[] = []
    for (const file of files) {
      for (const site of collectImports(file, readFileSync(file, 'utf8'))) {
        if (site.isDynamic || site.valueNames.includes('<require>')) {
          violations.push(`${site.rel}: 动态/require 通道 ${site.specifier}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('值导入面封闭（跨包值依赖仅 WP-6.2 冻结机械表 combineTypeSignal — 同层 audit/discovery）', () => {
    const CROSS_VALUE_IMPORTS = new Map<string, Set<string>>()
    for (const file of files) {
      for (const site of collectImports(file, readFileSync(file, 'utf8'))) {
        if (!site.specifier.startsWith('.') || site.specifier.startsWith('./')) continue
        const names = site.valueNames
        if (names.length === 0) continue
        const key = site.specifier
        const set = CROSS_VALUE_IMPORTS.get(key) ?? new Set<string>()
        for (const n of names) set.add(n)
        CROSS_VALUE_IMPORTS.set(key, set)
      }
    }
    // 跨目录（../ 开头）值导入只允许 discovery/classify 的冻结表:
    const cross = [...CROSS_VALUE_IMPORTS.entries()].filter(([spec]) => spec.startsWith('../'))
    expect(cross).toEqual([
      [
        '../discovery/classify.js',
        new Set(['combineTypeSignal']),
      ],
    ])
  })
})

describe('INV-RECONCILE-RO（不改写历史）— 行为面（纯函数钉）', () => {
  it('输入深冻结全流程通过（分类 + 三档 + 忽略）— 任何写入在严格模式下即抛错', () => {
    const input = deepFreeze(scenarioA())
    const report = classifyDiscrepancies(input) // 冻结输入下执行 — 零改动证明
    expect(report.discrepancies.length).toBe(14)
    const decisions = report.discrepancies.map((d, i) => ({
      refId: d.id,
      choice: (['AUTO_RECONCILE', 'PROPOSE_RECONCILIATION', 'ESCALATE', 'IGNORE'] as const)[i % 4]!,
    }))
    const out = reconcileDiscrepancies(report, decisions, RECONCILE_USER_ACTOR, { now: () => 1 })
    expect(out.byRef.size).toBe(14)
    // 输入仍冻结（未被解除/替换）:
    expect(Object.isFrozen(input.audit)).toBe(true)
    expect(Object.isFrozen(input.declared.policy)).toBe(true)
  })

  it('全流程确定性: 同输入双跑逐字段同报告（分类 + 档位执行）', () => {
    const a = classifyDiscrepancies(scenarioA())
    const b = classifyDiscrepancies(scenarioA())
    expect(b).toEqual(a)
    const decisions = a.discrepancies.map((d) => ({ refId: d.id, choice: 'ESCALATE' as const }))
    const oa = reconcileDiscrepancies(a, decisions, RECONCILE_USER_ACTOR, { now: () => 42 })
    const ob = reconcileDiscrepancies(b, decisions, RECONCILE_USER_ACTOR, { now: () => 42 })
    expect(ob).toEqual(oa)
  })
})
