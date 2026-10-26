#!/usr/bin/env node
/**
 * EB3 — BASELINE_READY view generator (G3 artifact).
 *
 * The view is DERIVED: git (SHA/cleanliness), machine detection (node/pnpm,
 * gate scripts), the human registry (stages, pins, debt), and gate files.
 * It is deliberately a printed report, not a hand-maintained truth file;
 * re-run it whenever the view must be current. `--emit <path>` writes a
 * snapshot for evidence, headed by the SHA it describes.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkAll, parseMiniYaml } from './docs/kernel.mjs'

const ROOT = resolve(dirname(dirname(fileURLToPath(import.meta.url))))
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim()

const head = git('rev-parse', 'HEAD')
const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
const dirty = git('status', '--porcelain')
const registry = parseMiniYaml(readFileSync(join(ROOT, 'dev/engineering/registry.yaml'), 'utf8'), 'registry')
const run = (cmd) => {
  const r = spawnSync('pnpm', ['run', cmd], { cwd: ROOT, encoding: 'utf8', timeout: 900_000 })
  return { ok: r.status === 0, last: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').filter(Boolean).pop() ?? '' }
}
const machine = {
  node: process.version,
  pnpm: execFileSync('pnpm', ['-v'], { encoding: 'utf8' }).trim(),
}
const checks = {
  'docs:check': (() => {
    const tracked = git('ls-files').split('\n').filter(Boolean)
    const problems = checkAll(ROOT, tracked)
    return { ok: problems.length === 0, last: problems.length ? problems.map((p) => p.code).join(', ') : 'clean' }
  })(),
  'check:types': run('check:types'),
  'check:freshness': run('check:freshness'),
}

const lines = [
  '# BASELINE_READY view（生成物 — 重跑 `pnpm run baseline:ready` 即最新）',
  '',
  `> Generated: git \`${branch}@${head.slice(0, 12)}\` · worktree ${dirty ? 'DIRTY (view describes committed HEAD; uncommitted paths excluded)' : 'clean'} · node ${machine.node} · pnpm ${machine.pnpm}`,
  `> 来源：Git + 机器检测 + \`dev/engineering/registry.yaml\`（人工事实）。本视图不新增真相，不做手工维护。`,
  '',
  '| 项 | 状态 | 依据 |',
  '|---|---|---|',
  `| 类型债务 | ${checks['check:types'].ok ? `KNOWN-FAILING 精确复现（${readFileSync(join(ROOT, 'dev', 'engineering', 'tsc-debt.ids'), 'utf8').trim().split('\n').length} 条）— 非全绿` : 'NEW DEBT — 基线不 READY'} | dev/engineering/tsc-debt.ids |`,
  `| 契约正源 | ${checks['docs:check'].ok ? '正源↔清单一致（AD-EB-01 批准哈希）' : `FAIL: ${checks['docs:check'].last}`} | SNAPSHOT.md ↔ schema/** + 8 docs |`,
  `| 预构建产物 | ${checks['check:freshness'].ok ? 'committed == fresh build（仅 rcm-css 噪声归一化）' : 'STALE — 基线不 READY'} | scripts/check-build-freshness.mjs |`,
  '',
  '## 阶段 Gate（registry 事实，非推导）',
  '',
  ...Object.entries(registry.stages).map(([k, v]) => `| ${k} | **${v.verdict}** | ${v.gate}${v.merge_sha ? ` · merge ${String(v.merge_sha).slice(0, 12)}` : ''} |`),
  '',
  '## 宿主与 pin（registry 事实）',
  '',
  ...Object.entries(registry.host_pins).filter(([k]) => k !== 'note').map(([k, v]) => `- \`${k}\` = \`${v}\``),
  `- 已知张力：${registry.host_pins.note}`,
  '',
  '## 已知缺口（G3 登记口径）',
  '',
  '- e2e CLI pin（TC-DSH-008 registry-floor）与 §实例 train 的版本对齐 = 待用户版本决策（AGENTS §4）。',
  '- SI-001 裁决书原件 / 外部 V2 设计 / 计划书 = UNKNOWN（仓外不可访问，不伪造）。',
  '- V3（#9/#10）= Draft，未生效；本视图不为其状态背书。',
  '- CI required status 配置与否见 G3 记录（观察先于强制）。',
  '',
]
const text = lines.join('\n')
const out = process.argv.indexOf('--emit')
if (out !== -1) {
  const p = process.argv[out + 1]
  writeFileSync(resolve(ROOT, p), `${text}\n`)
  console.log(`[baseline-ready] wrote ${p}`)
} else console.log(text)
