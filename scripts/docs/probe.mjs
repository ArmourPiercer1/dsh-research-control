#!/usr/bin/env node
/**
 * docs:probe — read-only 变更影响探针。
 * 默认 advisory 语义（永远 exit 0，人工参考）；CI 冻结契约审查门用
 * `--fail-on-blocking`（审查意见 P0#1）：任一 BLOCKING 发现即 exit 1，
 * 除非 `--review-marker-file <path>` 指向的文本含机验审查标记行
 * `Frozen-Face-Review: <日期> <批准人>`——哈希/清单同步绝不代替审查。
 */
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
  // fail-loud 守卫（EB3 后 DX 坑）：曾把 md 文档直接当清单传，正文被逐行当
  // 路径吞掉、输出满屏伪 UNOWNED。变更清单的正确来源是 git diff --name-only
  // 之类的每行一路径文件；文档正文的 markdown 特征（标题/围栏/表格/加粗）
  // 在合法清单中不会出现——出现两条即拒绝，不再静默。
  const prose = files.slice(0, 20).filter((l) => /^(#\s|>|\||```|\|)/.test(l) || /\*\*.+\*\*/.test(l))
  if (prose.length >= 2) {
    console.error(`[docs:probe] FATAL: --paths 收到的不像路径清单（${p} 含 markdown 特征 ${prose.length} 行）。正确用法：--paths <每行一路径的清单文件>（如 git diff --name-only origin/main...HEAD > changed.txt）。`)
    process.exit(2)
  }
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
const blocking = findings.filter((f) => f.severity === 'blocking')
if (blocking.length > 0 && args.includes('--fail-on-blocking')) {
  // 投票面 = 实质变更需要人工审查的欠账面（审查意见 P0#1 点名：冻结契约、
  // 事件不变量、权限与持久化格式）。其余 blocking 标签（宿主适配 pin、门禁
  // 工具、产物）照报不投票——它们每个工程 PR 都会路过，逐 PR 求人工批准行
  // 只会把标记稀释成每日图章（审查意见：普通修改保持轻量流程）。
  const VOTING = ['FROZEN_CONTRACT_ROOT', 'CONTRACT_SURFACE', 'EVENT_REPLAY_SEMANTICS', 'HISTORY_CONTRACT', 'PERSISTENCE_OR_PERMISSION']
  const voting = blocking.filter((f) => f.codes.some((c) => VOTING.includes(c)))
  if (voting.length > 0) {
    const markerPath = opt('--review-marker-file')
    const markerText = markerPath ? readFileSync(markerPath, 'utf8') : ''
    const reviewed = /^Frozen-Face-Review:\s*\d{4}-\d{2}-\d{2}\s+\S+/m.test(markerText)
    if (!reviewed) {
      console.error(`[docs:probe] BLOCKING×${voting.length}（${voting.map((f) => f.codes.join('+')).join(', ')}）且未提供审查标记。实质变更面必须在 PR body 写明一行：Frozen-Face-Review: <YYYY-MM-DD> <批准人>（人工批准，快照哈希不代替审查）。`)
      process.exit(1)
    }
  }
}
process.exit(0)
