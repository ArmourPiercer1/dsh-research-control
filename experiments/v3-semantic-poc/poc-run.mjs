#!/usr/bin/env node
/**
 * V3 PoC · P0 —— poc-run 入口（SPEC.md 目录约定；#10 §4-P0「poc-run 入口」）。
 *
 * 用法（argv-only，绝不经过 shell；无第三方依赖）：
 *   node poc-run.mjs --fixture <file.jsonl> [--export <path>]
 *   node poc-run.mjs --help
 *
 * 行为：
 *  - 解析并校验信封文件（src/envelope.ts，SPEC 硬规则全部通过才继续）；
 *  - 打印事件数与 unknowns 条目总数；
 *  - --export 时对 parse 结果做 normalizeExport（键排序稳定字节序），
 *    写盘前先过 writeguard.assertWritable——只允许 .poc-data/v3/**，越界 FATAL；
 *  - 同一输入重复 --export 产生逐字节相同的文件（幂等由测试断言）。
 *
 * 路径解析：--fixture 相对路径先按 cwd 试，不存在则按本脚本所在目录解析；
 * --export 相对路径一律按本脚本所在目录解析（除非给出绝对路径）。
 *
 * 退出码：0 成功；1 校验失败/写入被拒；2 用法错误。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { normalizeExport, parseEnvelopeFile } from './src/envelope.ts'
import { ALLOWED_WRITE_ROOT, assertWritable } from './src/writeguard.ts'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

function usage(out) {
  out('用法: node poc-run.mjs --fixture <file.jsonl> [--export <path>]')
  out(`（--export 相对路径按 ${SCRIPT_DIR} 解析；只允许写 ${ALLOWED_WRITE_ROOT} 之下）`)
}

function parseArgv(argv) {
  const opts = { fixture: null, export: null }
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

function main() {
  const opts = parseArgv(process.argv.slice(2))
  if (!opts.fixture) {
    console.error('必须提供 --fixture <file.jsonl>')
    usage(console.error)
    process.exit(2)
  }

  const fixturePath = resolveFixture(opts.fixture)
  const { events, problems } = parseEnvelopeFile(fixturePath)
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
