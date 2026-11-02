import { runAbStudy } from '../../v3-semantic-poc/src/ab.ts'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
const DIRS: Record<string, string> = {
  '原始语料(含答案标签)': new URL('../../v3-semantic-poc/fixtures/ab/corpus', import.meta.url).pathname,
  '脱敏语料(标签已剥离)': (process.argv[2] ?? new URL('../.data/e0/corpus-scrubbed', import.meta.url).pathname),
}
const arms = ['rawScan', 'inferenceOnly', 'associationOnly', 'bothAlternating'] as const
const rates: Record<string, Record<string, string>> = {}
for (const [label, dir] of Object.entries(DIRS)) {
  const r = runAbStudy(dir) as any
  rates[label] = {}
  for (const a of arms) {
    const rd = r.readings[a]
    rates[label][a] = `${r.per_read_detection_rate[a].detected}/7  q=${rd.cost?.queries} n=${rd.cost?.nodes_visited}`
  }
}
console.log('=== 1) PoC 四臂：脱敏前 vs 脱敏后（同一评分器，同一 planted.json）===')
console.log('语料'.padEnd(22), arms.map(a => a.padEnd(20)).join(''))
for (const [label, v] of Object.entries(rates)) console.log(label.padEnd(20), arms.map(a => v[a].padEnd(20)).join(''))

// ── 2) 对照臂：扁平确定性 linter（单趟扫描；零图、零多跳、零 LLM）──
function lint(dir: string) {
  const files = readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()
  const evs: any[] = []
  for (const f of files) for (const l of readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)) { try { evs.push(JSON.parse(l)) } catch {} }
  const has = new Set(evs.map(e => `${e.run_id}:${e.event_seq}`))
  const failed = new Set(evs.filter(e => e.kind === 'run.failed').map(e => e.run_id))
  const decks = new Map<string, Set<string>>()
  const found = new Set<string>()
  for (const e of evs) {
    const p = e.payload ?? {}, run = e.run_id, seq = e.event_seq
    const refs = (arr: any[]) => arr.filter(Boolean).map((b: any) => (typeof b === 'number' ? `${run}:${b}` : `${b.run_id ?? run}:${b.seq}`))
    // GAP-01 依据断链
    if (refs(Array.isArray(p.based_on) ? p.based_on : []).some(k => !has.has(k))) found.add('dangling_based_on')
    // GAP-02 经验联想无内容锚
    if (Array.isArray(p.experience_association) && p.experience_association.some((a: any) => !a?.source?.content_sha256)) found.add('anchorless_association')
    // GAP-04 结果/工件无 sha
    if (e.kind === 'artifact.registered' && (e.snapshot_ref?.content_sha256 ?? null) === null) found.add('artifact_sha_unanchored')
    // GAP-05 finding 指向不存在的对象
    if (p.finding?.about && refs(p.finding.about).some(k => !has.has(k))) found.add('finding_target_unresolvable')
    // GAP-06 论断无支持关系（只有语境化）
    if (e.kind === 'claim.candidate') {
      const rel: string[] = (p.evidence ?? []).map((x: any) => String(x?.relation ?? '')).concat(p.evidence ? [] : ['BASED_ONLY'])
      if (!rel.some(r0 => /SUPPORT/i.test(r0))) found.add('no_support_evidence')
    }
    // GAP-07 论断落在失败 run 上，或依据含失败 run
    if (e.kind === 'claim.candidate' && (failed.has(run) || refs(Array.isArray(p.based_on) ? p.based_on : []).some(k => failed.has(k.split(':')[0])))) found.add('failed_run_basis')
    const d = e.snapshot_ref?.kind === 'deck' ? e.snapshot_ref.id : null
    if (d) { const s = decks.get(d) ?? new Set(); s.add(run); decks.set(d, s) }
  }
  // GAP-03 共用 deck 且 run 间无任何连接
  const linked = new Set<string>()
  for (const e of evs) { const c = (e.payload ?? {}).connects; if (Array.isArray(c) && c.length === 2) linked.add([c[0].run_id, c[1].run_id].sort().join('|')) }
  for (const [, runs] of decks) { const u = [...runs]; if (u.length > 1) for (let i = 0; i < u.length; i++) for (let j = i + 1; j < u.length; j++) if (!linked.has([u[i], u[j]].sort().join('|'))) found.add('shared_deck_no_mechanism') }
  return { found, n: evs.length }
}
const planted = JSON.parse(readFileSync(DIRS['原始语料(含答案标签)'] + '/planted.json', 'utf8')) as any
for (const [label, dir] of Object.entries(DIRS)) {
  const { found, n } = lint(dir)
  const hit = planted.gaps.filter((g: any) => found.has(g.gap_kind)).length
  console.log(`\n=== 2) 扁平确定性 linter on ${label}: ${hit}/7（事件 ${n} 条，1 趟扫描，0 图查询）`)
  console.log('   漏:', planted.gaps.filter((g: any) => !found.has(g.gap_kind)).map((g: any) => g.gap_kind).join(', ') || '(无)')
}
