#!/usr/bin/env node
/** docs:probe — read-only 变更影响探针（不改退出码语义：advisory 永远是 0）。 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { probeFindings } from './kernel.mjs'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const root = process.cwd()
let files
if (args.includes('--paths')) {
  const p = opt('--paths')
  if (!p) {
    console.error('usage: docs:probe --paths <file-list> | --base <ref> [--json]')
    process.exit(2)
  }
  files = readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
} else {
  const base = opt('--base')
  if (!base) {
    console.error('usage: docs:probe --base <ref> | --paths <file-list> [--json]')
    process.exit(2)
  }
  try {
    files = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch (e) {
    console.error(`[docs:probe] FATAL: bad base ref: ${base}`)
    process.exit(2)
  }
}
const findings = probeFindings(root, files)
if (args.includes('--json')) {
  console.log(JSON.stringify({ base: opt('--base') ?? 'paths', files: files.length, findings }, null, 1))
} else {
  if (files.length === 0) console.log('[docs:probe] no changed files vs base — nothing to report')
  for (const f of findings) {
    const tag = f.severity === 'blocking' ? 'BLOCKING' : 'advisory'
    console.log(`[docs:probe] ${tag} ${f.codes.join(',')} — ${f.paths?.length ?? 1} file(s)${f.gate ? ` · gate ${f.gate}` : ''}`)
    for (const p of f.paths ?? []) console.log(`    · ${p}`)
    for (const d of f.docs ?? []) console.log(`    影响文档: ${d}`)
    for (const t of f.tests ?? []) console.log(`    相关测试: ${t}`)
    for (const a of f.actions ?? []) console.log(`    动作: ${a}`)
  }
}
process.exit(0)
