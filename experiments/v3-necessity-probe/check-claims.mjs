#!/usr/bin/env node
/**
 * 效应声明校验门（形式化推理检查）
 * 防的是本项目的真实失误：语义通顺但形式无据的效应主张
 *   —— 格内 n=1、跨层事后并池、无预注册、无检验却用"提高/压低/消除"这类因果动词。
 * 规矩：status=MEASURED 必须是**为它设计过的**实验；否则只能 HYPOTHESIS / JUDGED。
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
const ROOT = path.resolve(import.meta.dirname, '../..')
const FILE = process.argv[2] ?? 'experiments/v3-necessity-probe/CLAIMS.md'
const txt = readFileSync(path.resolve(ROOT, FILE), 'utf8')
const blocks = [...txt.matchAll(/```claim\n([\s\S]*?)```/g)].map(m => {
  const o = {}
  for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + 1).trim() }
  return o
})
const REQ = ['id', 'statement', 'design', 'cells', 'metric', 'stat', 'prereg', 'status']
const STATUS = ['HYPOTHESIS', 'MEASURED', 'JUDGED', 'SUPERSEDED']
const EFFECT_RE = /(提高|压低|降低|增加|改善|导致|消除|翻倍|减少|提升|>|×|倍数)/
const POOLED_RE = /(事后|并池|汇总|顺带|复用.*运行)/
const err = [], warn = []
if (!blocks.length) err.push('没有任何 claim 块')
for (const c of blocks) {
  const tag = c.id ?? '(缺 id)'
  for (const f of REQ) if (!c[f]) err.push(`${tag}: 缺必填字段 ${f}`)
  if (c.status && !STATUS.includes(c.status)) err.push(`${tag}: status 非法「${c.status}」（词汇上限 HYPOTHESIS/MEASURED/JUDGED/SUPERSEDED，无 PASS/GO）`)
  const cells = (c.cells ?? '').split('|').map(s => s.trim()).filter(Boolean)
  const ns = cells.map(s => parseInt((s.split(':')[1] ?? 'nan'), 10))
  const tot = ns.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
  const effect = EFFECT_RE.test(c.statement ?? '')
  if (c.status === 'MEASURED') {
    if (cells.length < 2) err.push(`${tag}: MEASURED 需至少一个对照格（cells 只有一格）`)
    if (ns.some(n => !Number.isFinite(n) || n < 2)) err.push(`${tag}: MEASURED 要求每格 n≥2，实为 ${ns.join(',')}（格内 n=1 只能出 HYPOTHESIS）`)
    if (tot < 4) err.push(`${tag}: MEASURED 要求总样本 ≥4，实为 ${tot}`)
    if (/MISSING/.test(c.prereg ?? '')) err.push(`${tag}: MEASURED 必须有预注册文件（prereg=MISSING）`)
    else { const p = (c.prereg ?? '').split('#')[0]; if (p && !existsSync(path.resolve(ROOT, p))) err.push(`${tag}: prereg 指向的文件不存在 ${p}`) }
    if (!/p\s*[=≤<]\s*0?\.\d+/.test(c.stat ?? '') && !/不适用/.test(c.stat ?? '')) err.push(`${tag}: MEASURED 的 stat 缺检验名与 p 值`)
    else if (effect) { const m = (c.stat ?? '').match(/p\s*[=≤<]\s*(0?\.\d+)/); if (m && parseFloat(m[1]) > 0.05) err.push(`${tag}: 主张含因果动词但 p=${m[1]} > 0.05 → 不得称 MEASURED`) }
    if (POOLED_RE.test(c.design ?? '')) err.push(`${tag}: design 含"${(c.design ?? '').match(POOLED_RE)[0]}"——跨用途事后并池不得支撑 MEASURED`)
    if (cells.length >= 2 && !/(配伍|同库|同预算|同序|随机|对照|种子)/.test(c.design ?? '')) err.push(`${tag}: 多格对照必须在 design 里声明对照/唯一差异控制`)
    if (!c.evidence || !existsSync(path.resolve(ROOT, c.evidence))) err.push(`${tag}: MEASURED 的 evidence 文件不存在`)
  }
  // 注：词表曾漏「须/待/尚未」，导致 C-09 写了「须做 2×2」仍被误报——修词表，不改条目措辞去迁就门
  if (c.status === 'HYPOTHESIS' && !/降级|downgrade|缺|不得|需|须|待|尚未/.test((c.downgrade_reason ?? '') + (c.notes ?? ''))) warn.push(`${tag}: HYPOTHESIS 未说明为何不能升级`)
  if (/显著|效应量|证明/.test(c.statement ?? '') && c.status !== 'MEASURED') err.push(`${tag}: 用了「显著/效应量/证明」却非 MEASURED`)
}
for (const w of warn) console.log('  ⚠ ' + w)
for (const e of err) console.log('  ✗ ' + e)
if (err.length) { console.log(`\n[claims] FAIL — ${err.length} 条主张形式不合格（共 ${blocks.length} 条登记）`); process.exit(1) }
console.log(`\n[claims] OK — ${blocks.length} 条主张，形式检查通过（MEASURED ${blocks.filter(b => b.status === 'MEASURED').length} 条 / HYPOTHESIS ${blocks.filter(b => b.status === 'HYPOTHESIS').length} 条 / JUDGED ${blocks.filter(b => b.status === 'JUDGED').length} 条）`)
