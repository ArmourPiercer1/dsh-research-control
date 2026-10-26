#!/usr/bin/env node
/**
 * V3 PoC · P0 —— poc-run 入口（SPEC.md 目录约定；#10 §4-P0「poc-run 入口」）。
 *
 * 用法（argv-only，绝不经过 shell；无第三方依赖）：
 *   node poc-run.mjs --fixture <file.jsonl> [--export <path>]
 *   node poc-run.mjs --project <dir> [--export <path>]   # P1：轨迹重放视图
 *   node poc-run.mjs --help
 *
 * 行为：
 *  - 解析并校验信封文件（src/envelope.ts，SPEC 硬规则全部通过才继续）；
 *  - 打印事件数与 unknowns 条目总数；
 *  - --export 时对 parse 结果做 normalizeExport（键排序稳定字节序），
 *    写盘前先过 writeguard.assertWritable——只允许 .poc-data/v3/**，越界 FATAL；
 *  - 同一输入重复 --export 产生逐字节相同的文件（幂等由测试断言）。
 *
 * P1 --project 模式（#10 §4-P1「可重复构建的轨迹视图」离线机制）：
 *  - 把 <dir> 内全部 *.jsonl 信封导入 replay 状态并构建 Run 时间线视图；
 *  - 打印活动/实体/观测（sosa）计数与 unresolved 数——断链与 unknowns 显式
 *    列账，**不因此报错**（Gate P1 的宣称等真实历史接入，此处只是机制演示）；
 *  - --export 导出视图 JSON（canonicalize 稳定字节序），同样先过 writeguard。
 *
 * 路径解析：--fixture/--project 相对路径先按 cwd 试，不存在则按本脚本所在目录
 * 解析；--export 相对路径一律按本脚本所在目录解析（除非给出绝对路径）。
 *
 * 退出码：0 成功；1 校验失败/写入被拒（--project 模式下 unresolved 不算失败）；
 * 2 用法错误。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { normalizeExport, parseEnvelopeFile } from './src/envelope.ts'
import { buildReplayView, createReplayState, exportReplayView, importRunFiles, listEnvelopeFiles } from './src/replay.ts'
import { ALLOWED_WRITE_ROOT, assertWritable } from './src/writeguard.ts'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

function usage(out) {
  out('用法: node poc-run.mjs --fixture <file.jsonl> [--export <path>]')
  out('      node poc-run.mjs --project <dir> [--export <path>]')
  out(`（--export 相对路径按 ${SCRIPT_DIR} 解析；只允许写 ${ALLOWED_WRITE_ROOT} 之下）`)
}

function parseArgv(argv) {
  const opts = { fixture: null, project: null, export: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      usage(console.log)
      process.exit(0)
    } else if (arg === '--fixture') {
      const value = argv[++i]
      if (!value) {
        console.error('缺少 --fixture 的参数值')
        usage(console.error)
        process.exit(2)
      }
      opts.fixture = value
    } else if (arg === '--project') {
      const value = argv[++i]
      if (!value) {
        console.error('缺少 --project 的参数值')
        usage(console.error)
        process.exit(2)
      }
      opts.project = value
    } else if (arg === '--export') {
      const value = argv[++i]
      if (!value) {
        console.error('缺少 --export 的参数值')
        usage(console.error)
        process.exit(2)
      }
      opts.export = value
    } else {
      console.error(`未知参数: ${arg}`)
      usage(console.error)
      process.exit(2)
    }
  }
  return opts
}

function resolveFixture(p) {
  if (path.isAbsolute(p)) return p
  const fromCwd = path.resolve(process.cwd(), p)
  if (existsSync(fromCwd)) return fromCwd
  return path.resolve(SCRIPT_DIR, p)
}

function resolveExportPath(p) {
  return path.isAbsolute(p) ? p : path.resolve(SCRIPT_DIR, p)
}

/** P1 --project：导入目录内全部 *.jsonl，构建重放视图并按 --export 落盘。 */
function runProject(opts) {
  const dir = resolveFixture(opts.project) // 同款相对路径解析（cwd → 脚本目录）
  if (!existsSync(dir)) {
    console.error(`--project 目录不存在: ${opts.project}`)
    process.exit(2)
  }
  const files = listEnvelopeFiles(dir)
  const state = createReplayState()
  importRunFiles(state, files)
  const view = buildReplayView(state)
  // unresolved（断链 + unknowns 非空的源 + 校验器问题）显式打印逐条，不静默。
  for (const entry of view.unresolved) {
    console.log(`UNRESOLVED file=${entry.file} line=${entry.line ?? '-'} run=${entry.run_id ?? '-'} seq=${entry.event_seq ?? '-'} kind=${entry.kind} ${entry.message}`)
  }
  console.log(
    `project=${opts.project} files=${view.stats.file_count} runs=${view.stats.run_count} events=${view.stats.event_count} ` +
      `activities=${view.stats.activities} entities=${view.stats.entities} agents=${view.stats.agents} ` +
      `observations=${view.stats.sosa_observations} results=${view.stats.sosa_results} ` +
      `unresolved=${view.stats.unresolved_count} 结果=OK`,
  )
  if (opts.export !== null) {
    const bytes = Buffer.from(exportReplayView(view), 'utf8')
    const outPath = assertWritable(resolveExportPath(opts.export)) // 越界 = FATAL 抛出
    mkdirSync(path.dirname(outPath), { recursive: true })
    writeFileSync(outPath, bytes)
    console.log(`exported=${outPath} bytes=${bytes.length}`)
  }
}

function main() {
  const opts = parseArgv(process.argv.slice(2))
  if (opts.fixture !== null && opts.project !== null) {
    console.error('--fixture 与 --project 互斥（前者=单文件校验，后者=P1 重放视图）')
    usage(console.error)
    process.exit(2)
  }
  if (opts.project !== null) {
    runProject(opts)
    return
  }
  if (!opts.fixture) {
    console.error('必须提供 --fixture <file.jsonl> 或 --project <dir>')
    usage(console.error)
    process.exit(2)
  }

  const fixturePath = resolveFixture(opts.fixture)
  // v0.1：跨文件 based_on 解析表 = 同目录所有 *.jsonl 的 run_id → seq 集
  // （宽松收集：坏行忽略——解析表只用于引用目标存在性，不是二次校验）。
  const dir = path.dirname(path.resolve(fixturePath))
  /** @type {Map<string, Set<number>>} */
  const knownRuns = new Map()
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue
    let text = ''
    try { text = readFileSync(path.join(dir, name), 'utf8') } catch { continue }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const o = JSON.parse(line)
        if (o && typeof o.run_id === 'string' && Number.isInteger(o.event_seq)) {
          if (!knownRuns.has(o.run_id)) knownRuns.set(o.run_id, new Set())
          knownRuns.get(o.run_id).add(o.event_seq)
        }
      } catch { /* 解析表宽松 */ }
    }
  }
  const { events, problems } = parseEnvelopeFile(fixturePath, { knownRuns })
  const unknownCount = events.reduce((sum, event) => sum + (Array.isArray(event.unknowns) ? event.unknowns.length : 0), 0)

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`PROBLEM line=${problem.line} kind=${problem.kind} ${problem.message}`)
    }
    console.log(`fixture=${opts.fixture} events=${events.length} problems=${problems.length} unknowns=${unknownCount} 结果=REJECTED`)
    process.exit(1)
  }

  console.log(`fixture=${opts.fixture} events=${events.length} problems=0 unknowns=${unknownCount} 结果=OK`)

  if (opts.export !== null) {
    const bytes = Buffer.from(normalizeExport(events), 'utf8')
    const outPath = assertWritable(resolveExportPath(opts.export)) // 越界 = FATAL 抛出
    mkdirSync(path.dirname(outPath), { recursive: true })
    writeFileSync(outPath, bytes)
    console.log(`exported=${outPath} bytes=${bytes.length}`)
  }
}

main()
