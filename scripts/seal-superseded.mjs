#!/usr/bin/env node
/**
 * 已取代设计文档的**哈希封存门**（B+，2026-10-27 用户批准；DSH 同构：
 * archived = 冻结历史快照，非现行权威）。
 *
 * 树：docs/architecture/superseded/。清单：同目录 SEAL.yaml，单行条目：
 *   - <repo相对路径> | sha256=<hex> | sealed=<YYYY-MM-DD> | origin=<出处一句话>
 *
 * 语义：
 *  - 封存 = 原件字节 + 出处 + 封存日。已封存文件**不得再改**（要改即还原原件，
 *    或由用户裁决后以新文件重新封存——本脚本永远不重记已有路径的哈希）。
 *  - 树内未登记文件 = UNSEALED_FILE（红）：防止「悄悄放一份进目录就冒充留档」。
 *  - origin 未人工补写（UNKNOWN）= 红：留档必须说明它是谁的哪一代。
 *
 * 用法：
 *   node scripts/seal-superseded.mjs --write   # 只追加未登记文件（origin 待人工补）
 *   node scripts/seal-superseded.mjs --verify  # 全量校验（CI/测试走这条）
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const TREE_REL = 'docs/architecture/superseded'
const TREE = join(ROOT, TREE_REL)
const MANIFEST = join(TREE, 'SEAL.yaml')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const walk = (dir) => {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(abs))
    else if (e.name !== 'SEAL.yaml' && e.name !== '.gitkeep') out.push(relative(ROOT, abs).split('\\').join('/'))
  }
  return out.sort()
}
const parse = () => {
  if (!existsSync(MANIFEST)) return []
  const rows = []
  for (const line of readFileSync(MANIFEST, 'utf8').split('\n')) {
    const m = line.match(/^- (\S+) \| sha256=([0-9a-f]{64}) \| sealed=(\d{4}-\d{2}-\d{2}) \| origin=(.+)$/)
    if (m) rows.push({ path: m[1], sha: m[2], sealed: m[3], origin: m[4] })
    else if (line.trim().startsWith('- ')) rows.push({ path: line, bad: true })
  }
  return rows
}

const fail = (code, detail) => {
  console.error(`[seal-superseded] FATAL ${code}: ${detail}`)
  process.exit(1)
}

if (!existsSync(TREE)) {
  if (process.argv.includes('--write')) mkdirSync(TREE, { recursive: true })
  else { console.log('[seal-superseded] 无封存树（空目录即绿：机制在场，尚无封存对象）')
    process.exit(0) }
}

if (process.argv.includes('--write')) {
  const rows = parse()
  const known = new Set(rows.map((r) => r.path))
  const fresh = walk(TREE).filter((p) => !known.has(p) && !p.endsWith('SEAL.yaml'))
  if (fresh.length === 0) { console.log('[seal-superseded] 无新文件可封存（已登记条目永不重记——原件不可改）'); process.exit(0) }
  const today = new Date().toISOString().slice(0, 10)
  let text = existsSync(MANIFEST) ? readFileSync(MANIFEST, 'utf8') : '# SEAL.yaml — 已取代设计文档封存清单（机验：scripts/seal-superseded.mjs --verify）\n# 条目单行：- <路径> | sha256=<hex> | sealed=<日期> | origin=<出处>。追加式：已登记条目的哈希永不重记。\nversion: 1\nfiles:\n'
  for (const p of fresh) {
    text += `- ${p} | sha256=${sha256(readFileSync(join(ROOT, p)))} | sealed=${today} | origin=UNKNOWN——人工补写（谁的哪一代、被谁取代、裁定在哪）\n`
    console.log(`[seal-superseded] 追加封存：${p}`)
  }
  writeFileSync(MANIFEST, text)
  console.log('[seal-superseded] 提示：origin=UNKNOWN 条目须人工补写后 --verify 才会绿')
  process.exit(0)
}

// --verify（默认）
const problems = []
const rows = parse()
for (const r of rows) {
  if (r.bad) { problems.push(`SEAL_PARSE: 清单条目不合式：${r.path}`); continue }
  const abs = join(ROOT, r.path)
  if (!r.path.startsWith(TREE_REL + '/')) { problems.push(`SEALED_ESCAPE: ${r.path} 不在封存树内（清单只能指树内）`); continue }
  if (!existsSync(abs)) { problems.push(`SEALED_MISSING: 已封存原件不存在：${r.path}`); continue }
  if (sha256(readFileSync(abs)) !== r.sha) problems.push(`SEALED_TAMPERED: ${r.path} 与封存哈希不符——封存面不可改；还原原件，或经用户裁决以新文件重新封存`)
  if (/UNKNOWN/.test(r.origin)) problems.push(`SEAL_ORIGIN_UNKNOWN: ${r.path} 的 origin 未人工补写（留档必须说明代次与取代关系）`)
}
const listed = new Set(rows.map((r) => r.path))
for (const p of walk(TREE)) if (!listed.has(p)) problems.push(`UNSEALED_FILE: 树内文件未登记：${p}（--write 追加 + 人工补 origin，或移出错封树）`)

if (problems.length > 0) {
  for (const p of problems) console.error(`[seal-superseded] FATAL ${p}`)
  process.exit(1)
}
console.log(`[seal-superseded] verified: ${rows.length} 个封存原件哈希一致、出处齐、无未登记件`)
