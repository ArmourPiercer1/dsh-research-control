#!/usr/bin/env node
/**
 * E4b 案例库确定性校验器（零第三方依赖）。
 * 用法：node experiments/v3-necessity-probe/e4b/validate-cases.mjs [casesDir] [keysDir]
 * 退出码 0=合格；1=有违规（逐条打印）。EXEMPLAR-* 案例也一并校验，作为格式基准。
 *
 * 检查项（对应 PROTOCOL.md「E4b 可检性自检」与席位要求）：
 *  ① key.clue_record_ids / conclusion_record_ids / distractor_ids 全部存在于 records
 *  ② records 的任何 text/params 都不含 key.answer_keywords（大小写不敏感）与判语词
 *  ③ key.stable_label 在 records 中出现 ≥3 次；key.forbidden_aliases 一次都不许出现
 *  ④ 干扰项 ≥4
 *  ⑤ **单条记录结构检查不得命中**（悬空 refs / 空 sha / 自相矛盾）——命中即说明它是
 *     伪装的 T0/T1，不配作 T2–T5 素材（此条即 E0 那个扁平 linter，改作质量门复用）
 *  ⑥ 答案不泄漏：key.error_statement / key.correct_verdict 的正文不得出现在 records；
 *     cases 目录下不得有 *.key.json
 *  ⑦ 计数与档位：records 10–20 条；tier ∈ {T2,T3,T4,T5}；detectable_by 与 tier 匹配
 *  ⑨ 物理换算方向自洽（META.conversions 声明时启用）：拦"归一化/几何"配对值写反
 *  ⑧ 线索前置且不共现（确定性代理判据）：clue 记录的 t 必须早于 conclusion 记录；
 *     且 clue 与 conclusion 的正文共享 token（去掉 stable_label 与停用词后）≤ 2 个
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CASES = path.resolve(process.argv[2] ?? path.join(HERE, 'cases'))
const KEYS = path.resolve(process.argv[3] ?? path.join(HERE, 'keys'))
const TIER_REQUIRES = { T2: 'caliber-registry', T3: 'design-record', T4: 'premise-graph', T5: 'negative-state' }
const JUDGEMENT_WORDS = ['口径', '应为', '实际上', '误用', '错误', '错把', '混淆', '正确答案', '本案例的错误', '缺陷', 'erratum', 'should be', 'actually', 'mistaken']
const STOP = new Set('the a an of and or to in for on with is are was were by at as be it this that from run case data value values used using'.split(' '))

const fail = []
const err = (c, m) => fail.push(`[${c}] ${m}`)
const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => {
  try { return JSON.parse(l) } catch { fail.push(`[json] ${p}:${i + 1} 不是合法 JSON`); return null }
}).filter(Boolean)

if (!existsSync(CASES) || !existsSync(KEYS)) { console.error(`目录不存在：${CASES} / ${KEYS}`); process.exit(1) }

// ⑥ cases 目录内不得有 key 文件
for (const f of readdirSync(CASES, { recursive: true })) {
  if (String(f).endsWith('.key.json')) err('cases', `cases 目录内发现答案文件 ${f}`)
}

const dirs = readdirSync(CASES, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
if (dirs.length === 0) { console.error('cases/ 为空，无案例可校验'); process.exit(1) }

for (const name of dirs) {
  const dir = path.join(CASES, name)
  const rp = path.join(dir, 'records.jsonl'), mp = path.join(dir, 'META.json')
  const kp = path.join(KEYS, `${name}.key.json`)
  if (!existsSync(rp)) { err(name, '缺 records.jsonl'); continue }
  if (!existsSync(mp)) { err(name, '缺 META.json'); continue }
  if (!existsSync(kp)) { err(name, `缺 keys/${name}.key.json`); continue }

  const meta = JSON.parse(readFileSync(mp, 'utf8'))
  const key = JSON.parse(readFileSync(kp, 'utf8'))
  const recs = readJsonl(rp)
  const ids = new Set(recs.map(r => r.id))
  const blob = recs.map(r => `${r.text ?? ''} ${JSON.stringify(r.params ?? {})} ${JSON.stringify(r.artifact ?? {})}`).join('\n')
  const low = blob.toLowerCase()

  // ⑦
  if (!['T2', 'T3', 'T4', 'T5'].includes(meta.tier)) err(name, `META.tier 非法：${meta.tier}`)
  const isV2 = meta.sessions && typeof meta.sessions === 'object'
  if (isV2) {
    if (recs.length < 40) err(name, `V2 格式 records 数 ${recs.length} < 40`)
    const seen = { S1: 0, S2: 0, S3: 0 }
    for (const r of recs) {
      if (!(r.session in seen)) err(name, `记录 ${r.id} 缺 session 或取值非 S1/S2/S3`)
      else seen[r.session] += 1
    }
    for (const s of ['S1', 'S2', 'S3'])
      if (meta.sessions[s] !== seen[s]) err(name, `META.sessions.${s}=${meta.sessions[s]} 与实际 ${seen[s]} 不符`)
    const ts = recs.map(r => Date.parse(r.t)).filter(n => !Number.isNaN(n))
    if (Math.max(...ts) - Math.min(...ts) < 14 * 86400e3) err(name, 'V2 时间跨度不足 2 周')
    if (!(Number.isInteger(meta.buried_clue_index) && meta.buried_clue_index > 25 && meta.buried_clue_index <= recs.length))
      err(name, `buried_clue_index=${meta.buried_clue_index} 须 >25 且 ≤ 记录数`)
    else if (!(key.clue_record_ids ?? []).includes(recs[meta.buried_clue_index - 1].id))
      err(name, `buried_clue_index 指向的 ${recs[meta.buried_clue_index - 1].id} 不在 key.clue_record_ids 里`)
    for (const cid of key.conclusion_record_ids ?? []) {
      const ci = recs.findIndex(r => r.id === cid)
      const cl = Math.min(...(key.clue_record_ids ?? []).map(x => recs.findIndex(r => r.id === x)).filter(i => i >= 0))
      if (ci >= 0 && cl >= 0 && ci - cl < 15) err(name, `结论 ${cid} 距最近线索 ${ci - cl} 条，V2 要求 ≥15`)
    }
  } else if (recs.length < 10 || recs.length > 30) err(name, `records 数 ${recs.length} 不在 10–30（2026-11-02 放宽：按用户指示把证据拆成多种存储形态后，单案例真实规模 25–30 条；≥40 条走 sessions 分支。埋深改由"形态分散"承担，不再用数组距离充数）`)
  if (isV2 && (key.distractor_ids ?? []).length < 8) err(name, `V2 干扰项 ${key.distractor_ids?.length ?? 0} < 8`)
  if (meta.tier && TIER_REQUIRES[meta.tier] && key.detectable_by !== TIER_REQUIRES[meta.tier])
    err(name, `tier=${meta.tier} 要求 detectable_by=${TIER_REQUIRES[meta.tier]}，实为 ${key.detectable_by}`)
  if (meta.record_count !== undefined && meta.record_count !== recs.length) err(name, 'META.record_count 与实际不符')
  if (['id', 't', 'actor', 'channel', 'text'].some(k => recs.some(r => typeof r[k] !== 'string'))) err(name, '记录缺必填字段或类型不对')
  if (recs.some(r => !['source', 'inference', 'suggestion'].includes(r.channel))) err(name, 'channel 必须 source|inference|suggestion')
  if (JSON.stringify(recs).match(/Assertion|Proposition|\bH-S-R\b|facet|DECLARED|NOT_APPLICABLE|ResearchSpace|ObjectID/))
    err(name, '记录里出现 V3 专有术语（会污染双臂对照）')

  // ①
  for (const f of ['clue_record_ids', 'conclusion_record_ids', 'distractor_ids']) {
    const arr = Array.isArray(key[f]) ? key[f] : []
    if (arr.length === 0) err(name, `key.${f} 为空`)
    for (const id of arr) if (!ids.has(id)) err(name, `key.${f} 引用不存在的记录 id: ${id}`)
  }
  // ④
  if ((key.distractor_ids ?? []).length < 4) err(name, `干扰项 ${key.distractor_ids?.length ?? 0} < 4`)
  // ②
  for (const kw of [...(key.answer_keywords ?? []), ...JUDGEMENT_WORDS]) {
    if (kw && low.includes(String(kw).toLowerCase())) err(name, `记录正文含答案/判语关键词「${kw}」`)
  }
  // ③
  const label = key.stable_label ?? ''
  if (!label) err(name, 'key.stable_label 缺失')
  else {
    const n = (blob.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length
    if (n < 3) err(name, `稳定标签 ${label} 仅出现 ${n} 次（要求 ≥3）`)
    for (const a of key.forbidden_aliases ?? []) if (blob.includes(a)) err(name, `出现改名别名「${a}」（稳定标签不许改名）`)
  }
  // ⑤ 单条结构检查（E0 的扁平 linter 复用为质量门）
  const seqRef = (r) => {
    const out = []
    for (const ref of (Array.isArray(r.refs) ? r.refs : [])) {
      if (typeof ref === 'string') out.push(ref)
      else if (ref && typeof ref === 'object' && typeof ref.id === 'string') out.push(ref.id)
    }
    return out
  }
  for (const r of recs) {
    for (const ref of seqRef(r)) if (!ids.has(ref)) err(name, `记录 ${r.id} 的 refs 指向不存在的 ${ref}（这是 T0 缺陷，不配当 T2–T5 素材）`)
    if (r.artifact && r.artifact.name !== undefined) {
      const sha = r.artifact.sha
      if (typeof sha !== 'string' || sha.length < 8 || /^0+$/.test(sha) || /todo|tbd/i.test(sha))
        err(name, `记录 ${r.id} 的 artifact.sha 缺失/占位（T0 缺陷）`)
      if (typeof r.artifact.tool !== 'string' || typeof r.artifact.version !== 'string')
        err(name, `记录 ${r.id} 的 artifact 缺 tool/version（T4 类案例必须有工具与版本）`)
    }
  }
  // ⑥ 答案文本不得出现在记录里
  for (const f of ['error_statement', 'correct_verdict', 'why_each_record_is_locally_correct']) {
    const s = String(key[f] ?? '')
    if (s.length > 12) {
      const frag = s.slice(0, 40)
      if (blob.includes(frag)) err(name, `key.${f} 的前 40 字出现在记录正文中（答案泄漏）`)
    }
  }
  // ⑧ 线索前置 + 不共现
  const byId = new Map(recs.map(r => [r.id, r]))
  const clues = (key.clue_record_ids ?? []).map(i => byId.get(i)).filter(Boolean)
  const cons = (key.conclusion_record_ids ?? []).map(i => byId.get(i)).filter(Boolean)
  for (const c of cons) for (const cl of clues) if (String(cl.t) >= String(c.t)) err(name, `线索 ${cl.id} 的 t 未早于结论 ${c.id}`)
  const toks = (r) => new Set(String(r.text).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)))
  for (const c of cons) for (const cl of clues) {
    const shared = [...toks(c)].filter(w => toks(cl).has(w) && !label.toLowerCase().includes(w))
    if (shared.length > 2) err(name, `线索 ${cl.id} 与结论 ${c.id} 正文共现 token 过多：${shared.slice(0, 5).join(',')}（应只用标签关联）`)
  }

  // ⑨ 换算方向自洽（META.conversions 声明时启用）：拦"归一化/几何"配对值方向写反
  //    缺陷来源：EXEMPLAR 与 C4 都误用 ε_n = ε_geo/βγ，被独立接手席与独立复核席各发现一次，而①–⑧全绿
  if (Array.isArray(meta.conversions)) {
    for (const r of recs) {
      for (const m of String(r.text).matchAll(/([\d.]+)\s*pi-mm（几何值\s*([\d.]+)/g)) {
        const norm = parseFloat(m[1]), geo = parseFloat(m[2])
        if (!(norm > 0 && geo > 0)) continue
        for (const cv of meta.conversions) {
          const want = cv.normalized_to_geometric, tol = cv.tolerance ?? 0.01
          const got = norm / geo
          if (Math.abs(got - 1 / want) / (1 / want) <= tol)
            err(name, `记录 ${r.id} 换算方向写反：归一化/几何 = ${got.toFixed(4)} ≈ 1/${want}，正确应为 ${want}`)
          else if (Math.abs(got - want) / want > tol)
            err(name, `记录 ${r.id} 换算比例可疑：归一化/几何 = ${got.toFixed(4)}，声明为 ${want}（容差 ${tol}）`)
        }
      }
    }
  }

  // ⑩ 因果序：正文里引用的日期不得晚于该记录自身的时间戳
  //    缺陷来源：C5 的 r06（06-16）写"窗参数取自 07-15 标定"，被开放式席位当成溯源隐患发现，而①–⑨全绿
  for (const r of recs) {
    if (r.channel === 'suggestion') continue
    if (/补记|复盘|事后|回顾/.test(String(r.text))) continue
    const stamp = new Date(String(r.t)).getTime()
    if (!Number.isFinite(stamp)) { err(name, `记录 ${r.id} 的 t 不是合法时间戳`); continue }
    const yr = String(r.t).slice(0, 4)
    const refs = [...new Set([...String(r.text).matchAll(/(?<!\d)(\d{2})-(\d{2})(?!\d)/g)].map(m => `${yr}-${m[1]}-${m[2]}`))]
    for (const d of refs) {
      const ms = new Date(d + 'T00:00:00Z').getTime()
      if (Number.isFinite(ms) && ms > stamp) err(name, `记录 ${r.id}（${String(r.t).slice(0, 10)}）正文引用日期 ${d} 晚于自身时间戳（因果序不可能）`)
    }
  }
  // ⑪ 定义完备：带数值使用的自造量（snake_case）必须在库内定义，否则修正量随读者口径漂移
  //    缺陷来源：C5 的 resid_dark_share 未定义，同一机制两位读者给出 4.70 倍与 7.59 倍两种杠杆
  const snakeUses = new Map()
  for (const r of recs) {
    for (const m of String(r.text).matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\s*[=＝]\s*[-+]?[\d.]/g))
      snakeUses.set(m[1], (snakeUses.get(m[1]) ?? new Set()).add(r.id))
  }
  const defined = new Set()
  // 裸 `=` 不算定义：`x=0.5` 是**使用**，不是定义；否则该量会把自己判成已定义（第一版就踩了这个）
  for (const r of recs) for (const m of String(r.text).matchAll(/([a-z][a-z0-9]*(?:_[a-z0-9]+)+)[^。\n]{0,40}?(定义为|含义|口径为|归一化基准为)/g)) defined.add(m[1])
  for (const [tok, where] of snakeUses) {
    const loose = new Set([...defined].filter(d => d.includes(tok) || tok.includes(d)))
    if (loose.size === 0) err(name, `自造量 ${tok} 被赋数值（记录 ${[...where].join(',')}）但库内无定义 → 修正量不唯一`)
  }
}

if (fail.length) {
  console.log(`E4b 校验 FAIL — ${fail.length} 条违规（案例目录 ${dirs.length} 个：${dirs.join(', ')}）`)
  for (const f of fail) console.log('  - ' + f)
  process.exit(1)
}
console.log(`E4b 校验 PASS — ${dirs.length} 个案例，全部通过 ①–⑪（含答案零泄漏、结构门、换算方向门、正文因果序门、自造量定义完备门）`)
console.log('  注意：本校验器只证明**形式合格**；物理正确性需由独立复核席判定（作者 ≠ 复核者）。')
