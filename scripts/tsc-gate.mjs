#!/usr/bin/env node
/**
 * EB3 — temporary `no-new-TypeScript-errors` gate（临时债务门，非 tsc 全绿声明）.
 *
 * 比较**归一化诊断身份**（`<file>(<line>,<col>): error TSxxxx` 的排序集）与
 * 可信基线 `dev/engineering/tsc-debt.ids`（登记于 registry.yaml known_debts）。
 * 计数相等不算通过；集合有任何差异（新增或清偿）都失败：
 *   - 新增 → 本次变更引入债务，红；
 *   - 清偿 → 债务缩水是好事，但必须**同 PR** 重录基线（`pnpm run tsc:record`），
 *     防止基线漂移成无人核对的暗账。
 * 未来独立清偿到零后本门退役、tsc 升级 required。禁止为过门改宽 tsconfig 或
 * 屏蔽测试（STRUCTURE_DESIGN 债务纪律）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = join(ROOT, 'dev', 'engineering', 'tsc-debt.ids')
const RECORD = process.argv.includes('--record')

const out = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const text = `${out.stdout ?? ''}${out.stderr ?? ''}`
const idOf = (l) => { const m = l.match(/^[^ ]+ error TS\d+/); return m ? m[0].replace(/:\s*$/, '') : null }
const ids = [...new Set(text.split('\n').map(idOf).filter(Boolean))].sort()

if (RECORD) {
  writeFileSync(BASELINE, ids.length ? `${ids.join('\n')}\n` : '')
  console.log(`[tsc-gate] baseline recorded: ${ids.length} debt diagnostics → dev/engineering/tsc-debt.ids (commit this in the same PR)`)
  process.exit(0)
}
if (!existsSync(BASELINE)) {
  console.error('[tsc-gate] FATAL: trusted baseline missing (dev/engineering/tsc-debt.ids) — refusing to guess green')
  process.exit(1)
}
const baseline = readFileSync(BASELINE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).sort()
const bset = new Set(baseline)
const iset = new Set(ids)
const added = ids.filter((i) => !bset.has(i))
const fixed = baseline.filter((i) => !iset.has(i))
if (added.length === 0 && fixed.length === 0) {
  console.log(`[tsc-gate] known-failing debt reproduced EXACTLY (${ids.length} diagnostics; identity match, not count match) — this is NOT a clean typecheck`)
  process.exit(0)
}
for (const a of added) console.error(`[tsc-gate] NEW DEBT + ${a}`)
for (const f of fixed) console.error(`[tsc-gate] DEBT FIXED - ${f} (re-record: pnpm run tsc:record, same PR)`)
console.error(`[tsc-gate] FAIL: ${added.length} new / ${fixed.length} changed vs trusted baseline (${baseline.length} entries)`)
process.exit(1)
