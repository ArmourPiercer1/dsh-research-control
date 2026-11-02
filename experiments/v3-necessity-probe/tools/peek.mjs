#!/usr/bin/env node
/**
 * 受硬预算的取阅工具（实验装置）。
 * 用法：node peek.mjs r03 r07 ...
 * - 预算读自本目录 BUDGET.json 的 budget 字段；用尽即拒绝，不再放行。
 * - 不存在 / 非法 id 不计入取阅次数（修掉旧版把 --help 计次的缺陷）。
 * - 每次成功取阅追加一行 ACCESS-LOG.jsonl，供事后审计命中与归属。
 * 历史缺陷（2026-11-02 前）：旧版只打印硬编码「预算 12」，完全不拦截，
 * 预算合规全靠席位自律，并实测有席位取到 9 条（任务书 8 条）。
 */
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import path from 'node:path'
const HERE = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname))
const log = path.join(HERE, 'ACCESS-LOG.jsonl')
const cap = JSON.parse(readFileSync(path.join(HERE, 'BUDGET.json'), 'utf8')).budget
const used = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0)
for (const id of process.argv.slice(2)) {
  if (!/^r\d+$/.test(id)) { console.log(`(${id} 不是合法记录 id，不计入取阅次数)`); continue }
  const f = path.join(HERE, 'lib', `${id}.json`)
  if (!existsSync(f)) { console.log(`(${id} 不存在，不计入取阅次数)`); continue }
  if (used() >= cap) { console.log(`\n[拒绝：取阅预算 ${cap} 条已用尽，请基于已读内容作答]`); break }
  appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), id, ok: true }) + '\n')
  console.log(readFileSync(f, 'utf8'))
}
console.log(`\n[已取阅 ${used()} / 预算 ${cap}（硬约束）]`)
