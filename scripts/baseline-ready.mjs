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
import { execFileSync, spawnSync } from 'node:child_process' // --emit 前置 docs:sync（视图自入册），杜绝视图提交自身 DOCS_INDEX_STALE
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
  '## 已知欠账与缺口（registry 派生 + G3 登记口径）',
  '',
  // DERIVED from `known_debts` in the registry: a hand-maintained bullet list
  // here is exactly how this view went stale once (a "待用户版本决策" line
  // outlived its adjudication). Facts live in the registry; this mirrors them.
  ...Object.entries(registry.known_debts ?? {}).map(([k, v]) => {
    const facts = v.summary ?? (v.baseline ? `基线清单 \`${v.baseline}\`` : '')
    return `- \`${k}\`（${v.kind}）：${facts}`
  }),
  '- SI-001 裁决书原件 / 外部 V2 设计 / 计划书 = UNKNOWN（仓外不可访问，不伪造）。',
  // V3 status is a REGISTRY fact (审查意见 P1#4): the hand-typed "V3 = Draft"
  // line outlived #9/#10's merge and would let an agent act on a stale PR
  // state. 设计通道 vs 正式契约状态 分开表述，本视图仍不背书批准与否。
  ...Object.entries(registry.v3_status ?? { missing: 'registry.v3_status 缺失——补登记（人工事实）' }).map(([k, v]) => `- V3（${k}）：${v}`),
  '- CI required status 配置与否见 G3 记录（观察先于强制）。',
  '',
  // 设计线（ADR-0003）：现行代/切换锚/封存策略全部 registry 派生——本视图
  // 不手写任何代次状态（手写 = 上次失真的成因）。
  '## 设计线（registry.design_lines 派生）',
  '',
  ...Object.entries(registry.design_lines ?? {}).map(([k, v]) =>
    `- \`${k}\`：现行 = \`${v.current}\`（${v.current_state}）· 切换锚 \`${v.switch_anchor}\` · 首代 \`${v.first_gen}\` · 封存：${v.seal_policy}`),
  '',
]
const text = lines.join('\n')
// 证书新鲜度（审查意见 P1#4）：`--check <path>` 比较生成内容与已提交文件，
// 忽略 `> Generated:` 头（它按定义描述生成时的 SHA）。内容漂移 = exit 1：
// 历史证书不得冒充最新状态——事实变了必须在同 PR `--emit` 重生成。
const checkIdx = process.argv.indexOf('--check')
if (checkIdx !== -1) {
  const p = resolve(ROOT, process.argv[checkIdx + 1] ?? 'docs/engineering-baseline/gates/G3-baseline-ready.md')
  let committed = ''
  try {
    committed = readFileSync(p, 'utf8')
  } catch {
    console.error(`[baseline-ready] --check: 证书不存在：${p}`)
    process.exit(1)
  }
  const strip = (t) => t.split('\n').filter((l) => !l.startsWith('> Generated:')).join('\n').trimEnd()
  if (strip(committed) !== strip(text)) {
    const a = strip(committed).split('\n')
    const b = strip(text).split('\n')
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) console.error(`  diff@${i + 1}:\n    committed: ${a[i] ?? '(absent)'}\n    generated: ${b[i] ?? '(absent)'}`)
    }
    console.error('[baseline-ready] STALE：已提交证书与当前生成内容不一致（忽略 Generated 头后仍有差异）。事实已变化——运行 pnpm run baseline:ready --emit docs/engineering-baseline/gates/G3-baseline-ready.md 并随本 PR 提交。')
    process.exit(1)
  }
  console.log('[baseline-ready] certificate current (ignoring the Generated header)')
  process.exit(0)
}
const out = process.argv.indexOf('--emit')
if (out !== -1) {
  const p = process.argv[out + 1]
  writeFileSync(resolve(ROOT, p), `${text}\n`)
  console.log(`[baseline-ready] wrote ${p}`)
} else console.log(text)
