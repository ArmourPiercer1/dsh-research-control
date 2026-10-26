#!/usr/bin/env node
/**
 * docs:sync — 只写白名单派生索引（当前唯一白名单成员：docs/README.md）。
 * 对 AGENTS.md / 冻结契约 / ADR / dev/engineering/registry.yaml / 业务源码的
 * 写入请求一律拒绝（SYNC_REFUSED）——派生工具永远不能反向改规范与人写文档。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { generateDocsIndex, spliceIndex, SYNC_WHITELIST } from './kernel.mjs'

const args = process.argv.slice(2)
const root = process.cwd()
const WRITE = args.includes('--write')
const targets = args.filter((a) => !a.startsWith('--'))

const refused = targets.filter((t) => !SYNC_WHITELIST.includes(t))
if (refused.length > 0) {
  console.error(`[docs:sync] SYNC_REFUSED: ${refused.join(', ')} — 白名单 = ${SYNC_WHITELIST.join(', ')}；其余文件（AGENTS.md、冻结契约、ADR、registry、源码）不可由 sync 写入`)
  process.exit(1)
}
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const md = tracked.filter((f) => f.endsWith('.md'))
let touched = 0
for (const target of targets.length > 0 ? targets : SYNC_WHITELIST) {
  const abs = join(root, target)
  if (!existsSync(abs)) {
    console.error(`[docs:sync] target missing (标记需手工初始化一次): ${target}`)
    process.exit(1)
  }
  const cur = readFileSync(abs, 'utf8')
  const next = spliceIndex(cur, generateDocsIndex(root, md))
  if (next === cur) {
    console.log(`[docs:sync] up to date: ${target}`)
    continue
  }
  if (!WRITE) {
    console.log(`[docs:sync] would rewrite ${target} — re-run with --write`)
    process.exit(1)
  }
  writeFileSync(abs, next)
  touched += 1
  console.log(`[docs:sync] wrote ${target} (derived index only)`)
}
if (!WRITE && touched === 0) console.log('[docs:sync] nothing to write')
process.exit(0)
