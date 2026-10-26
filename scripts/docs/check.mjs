#!/usr/bin/env node
/** docs:check — read-only 全量静态一致性；与 CI 使用同一内核（scripts/docs/kernel.mjs）。 */
import { execFileSync } from 'node:child_process'

import { checkAll } from './kernel.mjs'

const root = process.cwd()
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const problems = checkAll(root, tracked)
if (problems.length === 0) {
  console.log(`[docs:check] OK — ${tracked.length} tracked files, static consistency clean (no claim of empirical/host-verified status)`)
  process.exit(0)
}
for (const p of problems) console.error(`[docs:check] FAIL ${p.code} @ ${p.where}: ${p.detail}`)
console.error(`[docs:check] ${problems.length} problem(s) — read-only check; fix the source docs/registry, never by relaxing this gate`)
process.exit(1)
