// 最小臂 vs 全量臂对照（C-12 的检验）。谓词只从 value 计算，不读任何"已捕获"标记。
// A 臂 = 真实 run 产物里物理存在的输入（可核对 src）；B 臂 = 按 HSR 规约代填的登记（测**可表达性**，不测人是否真会填对）。
import { readFileSync } from 'node:fs'

const D = JSON.parse(readFileSync(new URL('./items.json', import.meta.url), 'utf8'))
const TOL_REL = 0.05
const SCOPE_RE = /本设计|该构型|此工况|工作点|适用|限于|范围内|domain|scope/
const IMPOSS = /不可达|不可能|无法达成|no-go|not reachable|infeasible|地板|floor|极限/
// B 臂每案的写时代价（行数），按规约最小填写量估
const COST_B = { I1: 1, I2: 2, I3: 2, I4: 3, I5: 2, I6: 2, I7: 3, I8: 2, I9: 2, I10: 2, I11: 2, I12: 1, I13: 2 }

const P = {
  // 同一量的口径/优先级冲突：同名量的域不同，或任务书域与硬件域不交，或硬件约束优先级低于性能
  P1(a) {
    const q = a.qtyDefs
    if (!Array.isArray(q) || q.length === 0) return { run: false, fire: false, why: '无量→定义/域的可查输入' }
    const byQty = new Map()
    for (const d of q) (byQty.get(d.qty) ?? byQty.set(d.qty, []).get(d.qty)).push(d)
    for (const [name, ds] of byQty) {
      const sig = d => [d.domain, d.grid, d.waist, d.defSource].filter(x => x != null).join('|')
      const doms = new Set(ds.map(sig))
      if (ds.length > 1 && doms.size > 1) return { run: true, fire: true, why: `${name} 同名不同定义：${[...doms].join(' / ')}` }
      for (const d of ds) {
        if (d.hardwareDomain && d.domain && d.domain !== d.hardwareDomain)
          return { run: true, fire: true, why: `${name} 任务书域 ${d.domain} 与硬件域 ${d.hardwareDomain} 不交，且 priority=「${d.priority}」把它降到性能之下` }
      }
    }
    return { run: true, fire: false, why: '同组内未见冲突' }
  },
  // 比较的两端点必须带求解设置指纹，且该设置须已被确认对本量有效
  P2(a) {
    const c = a.comparison
    if (!c) return { run: false, fire: false, why: '无比较记录的结构化端点' }
    const fps = c.endpoints.map(e => e.fp)
    if (fps.some(f => f == null)) return { run: false, fire: false, why: '端点未带设置指纹 → 该比较不可判定（读时也判不了）' }
    if (new Set(fps).size > 1) return { run: true, fire: true, why: `端点设置不一致：${[...new Set(fps)].join(' vs ')}` }
    if (c.resolutionOk !== true) return { run: true, fire: true, why: `比较在未经确认有效的数值设置下作出（${fps[0]}）` }
    return { run: true, fire: false, why: '端点同设置且已确认有效' }
  },
  // 退化最优：自由量落在域端点/零点 ⇒ 部件不起作用
  P3(a) {
    const v = a.freeVars
    if (!Array.isArray(v) || v.length === 0) return { run: false, fire: false, why: '无自由量取值' }
    for (const x of v) {
      const tol = Math.max(0.01 * (x.hi - x.lo), 1e-9)
      if (Math.abs(x.value - x.lo) <= tol || Math.abs(x.value - x.hi) <= tol)
        return { run: true, fire: true, why: `${x.name}=${x.value} 落在域 [${x.lo},${x.hi}] 端点 ⇒ 该部件不起作用` }
    }
    return { run: true, fire: false, why: '无退化' }
  },
  // 不可达/唯一类主张：适用域必须与结论同层出现，且结论强度 ≤ 采样证据
  P4(a) {
    if (a.claims) {
      for (const c of a.claims) {
        if (c.kind === 'impossibility' && c.headline && IMPOSS.test(c.headline) && !SCOPE_RE.test(c.headline))
          return { run: true, fire: true, why: `出口措辞「${c.headline}」比已登记适用域「${c.scope}」更泛 ⇒ 须改写或补测` }
        if (c.kind === 'uniqueness') {
          const untested = (c.alternatives ?? []).some(s => /未测|盒内不可达|未扫/.test(String(s)))
          const cov = /(\d+)\/(\d+)/.exec(String(c.fingerprint ?? ''))
          const low = cov ? Number(cov[1]) / Number(cov[2]) < 0.1 : true
          if (untested || low) return { run: true, fire: true, why: `唯一性主张超出证据：盒排除的备选未测，命中率 ${cov ? cov[0] : '未知'}` }
        }
      }
      return { run: true, fire: false, why: '主张带域且强度不超证据' }
    }
    const t = String(a.headline ?? a.claimText ?? '')
    if (!t) return { run: false, fire: false, why: '无主张文本' }
    if (!IMPOSS.test(t)) return { run: true, fire: false, why: '非不可达类主张' }
    if (SCOPE_RE.test(a.claimText ?? '') && !SCOPE_RE.test(t)) return { run: true, fire: true, why: '限定语只在正文，标题级结论未带适用域' }
    if (!SCOPE_RE.test(t)) return { run: true, fire: true, why: '不可达结论无适用域' }
    return { run: true, fire: false, why: '结论自带适用域' }
  },
  // 同一观测点同一量的互斥取值 ⇒ 该点判定禁止升级为"已验证"
  P5(a) {
    const m = a.measurements
    if (!Array.isArray(m) || m.length === 0) return { run: false, fire: false, why: '取值在散文里，无 (观测点,量,值) 三元组 → 需人读' }
    const g = new Map()
    for (const x of m) (g.get(`${x.site}|${x.qty}`) ?? g.set(`${x.site}|${x.qty}`, []).get(`${x.site}|${x.qty}`)).push(x.value)
    for (const [k, vs] of g) {
      const lo = Math.min(...vs), hi = Math.max(...vs)
      if (hi > 0 && (hi - lo) / Math.max(lo, 1e-12) > TOL_REL)
        return { run: true, fire: true, why: `${k} 互斥取值 ${vs.join(' / ')} ⇒ 禁止写"已验证"` }
    }
    return { run: true, fire: false, why: '同点取值一致' }
  },
  // 不可达类判断出口门：须带 适用域 + 已排除备选 + 判据指纹（+ 参照）。行动决策与自我证伪**不得**被阻断
  P6(a) {
    if (a.claims) {
      const gated = a.claims.filter(c => ['impossibility', 'skip-verification'].includes(c.kind))
      if (gated.length === 0) return { run: true, fire: false, why: '非不可达/跳过复核类（升级与自我证伪放行）' }
      for (const c of gated) {
        const miss = [!c.scope && '适用域', !c.alternatives && '已排除备选', !c.fingerprint && '判据指纹',
          c.kind === 'impossibility' && !c.reference && '基线参照'].filter(Boolean)
        if (miss.length) return { run: true, fire: true, why: `「${c.kind}」出口缺 ${miss.join('、')} ⇒ 阻断` }
      }
      return { run: true, fire: false, why: '出口字段齐备' }
    }
    const t = String(a.claimText ?? '')
    if (/未宣布|不宣布|并未|并非不可达|而非/.test(t)) return { run: true, fire: false, why: '否定/转述语境，非本席位作出不可达宣称' }
    const impossible = IMPOSS.test(t) || /NOT run|跳过/.test(t)
    if (!impossible) return { run: true, fire: false, why: '文本层非不可达宣称' }
    const hasAlt = /未测|未扫|待测|备选|alternative/.test(t)
    const hasRef = /基线|baseline|对照|[0-9.]+\s*(nm|µm).*参照/.test(t)
    if (!hasAlt && !hasRef) return { run: true, fire: true, why: '不可达宣称既无已排除备选也无参照（文本层可查）' }
    return { run: true, fire: false, why: '文本层已含备选或参照' }
  },
  // 跨 run 互斥裁决
  P7(a) {
    if (!Array.isArray(a.claimsInScope)) return { run: false, fire: false, why: '无主张登记' }
    const ec = a.externalCitations ?? []
    if (ec.length === 0) return { run: true, fire: false, why: '工作区内无反例可查' }
    const unres = ec.filter(c => c.resolvable !== true)
    if (unres.length) return { run: true, fire: true, mark: true, why: `存在互斥裁决但引用不可解析（SD-20）⇒ 只能标记，不能自动判负` }
    return { run: true, fire: true, why: '互斥裁决可判负' }
  },
}

const rows = []
for (const it of D.items) {
  const wantFire = /应报警/.test(it.truth)
  const wantMark = /只能标记/.test(it.truth)
  const run = (arm, label) => {
    const r = P[it.pred](it[arm])
    const ok = r.mark ? wantMark : (r.fire === wantFire)
    return { run: r.run, fire: r.fire, ok, why: r.why }
  }
  const Ap = it.armAp ? { ...it.armAp } : { ...it.armA }
  const rp = it.armAp ? P[it.pred](Ap) : P[it.pred](it.armA)
  const ApOK = it.armAp?._blocked ? false : (rp.mark ? wantMark : (rp.fire === wantFire))
  const Awhy = it.armAp?._blocked ?? rp.why
  rows.push({ id: it.id, pred: it.pred, wantFire, A: run('armA', 'A'), Ap: { run: !it.armAp?._blocked, fire: !!rp.fire, ok: ApOK, why: Awhy }, B: run('armB', 'B'), costB: COST_B[it.id] ?? 0, src: it.src, truth: it.truth })
}

const n = rows.length
const cnt = (arm, k) => rows.filter(r => r[arm][k]).length
console.log(`\n════ 最小臂(A) vs 全量臂(B) — ${n} 条真实条目，谓词 ${[...new Set(rows.map(r => r.pred))].length} 个 ════\n`)
console.log('条目  谓词  A对  A+对  B对  B写行  期望   （A=真实产物 / A+=最小臂做满 / B=全量记录面）')
for (const r of rows) {
  const f = v => (v.run ? (v.fire ? '报警' : '放行') : '不可判')
  const m = v => (v.ok ? '  ✓' : '  ✗')
  console.log(`${r.id.padEnd(4)}  ${r.pred.padEnd(4)}  ${m(r.A).trim()}   ${m(r.Ap).trim()}   ${m(r.B).trim()}    ${String(r.costB).padStart(3)}     ${r.wantFire ? '报警' : '放行'}`)
}
console.log(`\n──── 汇总 ────`)
console.log(`A  臂（真实 run 产物，零改造）：可运行 ${cnt('A','run')}/${n}，裁决正确 ${cnt('A','ok')}/${n}，写时代价 0 行/案`)
  console.log(`A+ 臂（最小臂按规约做满：一行主题 + 量→定义出处 + 适用域 + 结论侧 1–3 行声明）：裁决正确 ${cnt('Ap','ok')}/${n}`)
  console.log(`     A+ 仍漏的：${rows.filter(r=>!r.Ap.ok).map(r=>`${r.id}（${r.Ap.why.slice(0,34)}…）`).join('；')||'无'}`)
console.log(`B 臂：可运行 ${cnt('B', 'run')}/${n}，裁决正确 ${cnt('B', 'ok')}/${n}，写时代价 ${rows.reduce((s, r) => s + r.costB, 0)} 行（均 ${ (rows.reduce((s, r) => s + r.costB, 0) / n).toFixed(1) } 行/案）`)
console.log(`\n──── A 臂判错/判不了的条目（HSR 的增量证据）────`)
for (const r of rows) if (!r.A.ok) console.log(`  ${r.id} [${r.pred}] ${r.A.run ? '判错' : '不可判'}：${r.A.why}\n        真值：${r.truth}\n        B 臂：${r.B.ok ? '正确' : '也错'}（${r.B.why}）`)
console.log(`\n──── B 臂判错的条目（全量臂也不解决）────`)
for (const r of rows) if (!r.B.ok) console.log(`  ${r.id} [${r.pred}] ${r.B.why}`)
console.log(`\n──── A 臂已正确、B 臂无增量的条目（过剩怀疑的证据）────`)
for (const r of rows) if (r.A.ok && r.A.run && r.B.ok) console.log(`  ${r.id} [${r.pred}] 两臂同判，B 需 ${r.costB} 行/案`)
