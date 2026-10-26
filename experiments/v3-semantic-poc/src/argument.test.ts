/**
 * P3 机制层测试（合成范围）——正例 + 固定负例（①~④ + 三反例 golden）。
 * 负例即纪律：数值强度键、修订覆盖、日志覆盖/目标形态失控、FactStanding
 * 自动升级，任何一条红 = 该层撒谎，不可放行。
 *
 * 合成声明：fixtures/argument 为合成场景声明；反例 2/3 的 source_ref 指向
 * samples/gpt-streak 真实 GPT 运行信封（真实运行、合成研究场景）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as argumentApi from './argument.ts'
import { parseEnvelopeFile } from './envelope.ts'
import { assess, createEvalState, verifyScenario } from './semantics.ts'
import type { Scenario, SourceRef } from './semantics.ts'
import {
  buildEvidenceRelation,
  checkArgumentMethod,
  checkAttackTarget,
  createArgumentRevision,
  createAssessmentLog,
  createFactStanding,
  currentStanding,
  historyFor,
  latestFor,
  parseEvidenceRelation,
  recordAttack,
  recordConfirmation,
  recordFactAttack,
  recordFactConfirmation,
  reviseArgument,
  supportBranches,
  supportLeaves,
} from './argument.ts'
import type { ArgumentRevision } from './argument.ts'

const POC_DIR = fileURLToPath(new URL('../', import.meta.url))
const FIX = path.join(POC_DIR, 'fixtures/argument')

const ref = (file: string, run_id: string, seq: number): SourceRef => ({ file, run_id, seq })

interface ScenarioDoc {
  scenario_id: string
  scenario: Scenario
  argument: ArgumentRevision
  attack: { op: 'undercut' | 'rebut'; target: string }
}
interface HistoryItem {
  at_type: string
  op: string
  target: string
  reason: string
  actor?: string
  source: SourceRef
  evidence_refs?: SourceRef[]
}
interface HistoryDoc {
  scenario_id: string
  argument: ArgumentRevision
  assessment_history: HistoryItem[]
}

const scenarioDoc = (name: string): ScenarioDoc =>
  JSON.parse(readFileSync(path.join(FIX, `${name}.scenario.json`), 'utf8')) as ScenarioDoc
const historyDoc = (name: string): HistoryDoc =>
  JSON.parse(readFileSync(path.join(FIX, `${name}.scenario.json`), 'utf8')) as HistoryDoc
const goldenOf = <T>(name: string): T =>
  JSON.parse(readFileSync(path.join(FIX, `${name}.expected.json`), 'utf8')) as T

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
    Object.freeze(value)
  }
  return value
}
const snapshot = (value: unknown): string => JSON.stringify(value)

/**
 * 两趟法解析（与 verifyScenario/poc-run 同源）：先对被解析文件宽松收集
 * knownRuns，再严格解析——strk-06#4 的跨文件 based_on（RUN-STRK-05@4）需要
 * 解析表，单文件裸解析必然 dangling（这是 v0.1 规则的正确行为，不是缺陷）。
 */
function parseWithResolution(files: string[]): Map<string, ReturnType<typeof parseEnvelopeFile>> {
  const knownRuns = new Map<string, Set<number>>()
  for (const f of files) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const o = JSON.parse(line) as { run_id?: unknown; event_seq?: unknown }
        if (o && typeof o.run_id === 'string' && Number.isInteger(o.event_seq)) {
          if (!knownRuns.has(o.run_id)) knownRuns.set(o.run_id, new Set())
          knownRuns.get(o.run_id)!.add(o.event_seq as number)
        }
      } catch { /* 宽松趟 */ }
    }
  }
  const out = new Map<string, ReturnType<typeof parseEnvelopeFile>>()
  for (const f of files) out.set(f, parseEnvelopeFile(f, { knownRuns }))
  return out
}

const srcRef = ref('fixtures/independent-support.jsonl', 'RUN-SYNTH-INDSUP-1', 3)

describe('P3 EvidenceRelation（记录用，不评分）', () => {
  it('正例：构造 + 稳定 id + conditions 缺省记 UNKNOWN（不补全）', () => {
    const r = buildEvidenceRelation({
      evidence: srcRef,
      target: 'ARG-INDPATHS-0',
      polarity: 'CONTEXTUALIZES',
      strength: { kind: 'NOT_QUANTIFIED', reason: '合成 fixtures 无量化通道' },
    })
    expect(r.conditions).toEqual(['UNKNOWN'])
    expect(r.relation_id).toMatch(/^[0-9a-f]{16}$/)
    const again = buildEvidenceRelation({
      evidence: { ...srcRef },
      target: 'ARG-INDPATHS-0',
      polarity: 'CONTEXTUALIZES',
      strength: { kind: 'NOT_QUANTIFIED', reason: '合成 fixtures 无量化通道' },
    })
    expect(again.relation_id).toBe(r.relation_id)
  })

  it('负例①：probability/p_ho/confidence_score 数值强度键一律被 parse 拒收', () => {
    const base = {
      evidence: srcRef,
      target: 'CL',
      polarity: 'SUPPORTS',
      strength: { kind: 'QUALITATIVE', level: 'MODERATE', basis: '两条独立观测同向（合成）' },
    }
    for (const poison of [
      { probability: 0.9 },
      { strength: { kind: 'QUALITATIVE', level: 'STRONG', basis: 'x', confidence_score: 88 } },
      { nested: { deep: [{ p_ho: 0.05 }] } },
    ]) {
      const out = parseEvidenceRelation({ ...base, ...poison })
      expect(out.relation).toBeUndefined()
      expect(out.rejected).toContain('numeric_strength_key')
    }
    // 拒数值的键名规则与值无关：probability 键即拒，哪怕值为字符串。
    expect(parseEvidenceRelation({ ...base, probability: 'unknown' }).rejected).toContain('numeric_strength_key')
  })

  it('正例：build→parse 回环通过；手写 relation_id 冒充被拒；conditions 缺省合法', () => {
    const built = buildEvidenceRelation({
      evidence: srcRef,
      target: 'CL',
      polarity: 'SUPPORTS',
      conditions: ['合成场景 nps=100'],
      strength: { kind: 'QUALITATIVE', level: 'WEAK', basis: '合成 n=2 定性' },
    })
    const ok = parseEvidenceRelation({ ...built })
    expect(ok.relation).toEqual(built)
    expect(parseEvidenceRelation({ ...built, relation_id: 'deadbeefdeadbeef' }).rejected).toContain('relation_id_mismatch')
    const { relation_id: _omit, ...noId } = built
    expect(parseEvidenceRelation(noId).relation?.relation_id).toBe(built.relation_id)
    // 形状非法同样列账不静默
    expect(parseEvidenceRelation({ ...built, polarity: 'PROVES' }).rejected).toContain('bad_polarity')
  })
})

describe('P3 ArgumentRevision（不可变，同 L0 纪律）', () => {
  const rev0 = createArgumentRevision({
    argument_id: 'ARG-REV-T',
    claim: '合成断言：效应随梯度单调',
    support: { type: 'OR', children: [
      { type: 'AND', children: [{ type: 'LEAF', premise: 'O1' }] },
      { type: 'LEAF', premise: 'O2' },
    ] },
    method: 'inductive',
  })

  it('正例：rev-0 起；scope 缺省 UNKNOWN（禁编造）；叶子/分支可枚举', () => {
    expect(rev0.revision_id).toBe('rev-0')
    expect(rev0.scope).toBe('UNKNOWN')
    expect(rev0.based_on).toEqual([])
    expect(supportLeaves(rev0.support)).toEqual(['O1', 'O2'])
    expect(supportBranches(rev0.support)).toEqual([
      { index: 0, leaves: ['O1'] },
      { index: 1, leaves: ['O2'] },
    ])
    expect(checkArgumentMethod('deductive')).toBeNull()
    expect(checkArgumentMethod('vibes')).not.toBeNull()
  })

  it('负例②：旧对象深冻结后 revise 不抛且分毫不动；修订链 based_on 指旧版', () => {
    deepFreeze(rev0)
    const before = snapshot(rev0)
    const rev1 = reviseArgument(rev0, { scope: '合成两设置范围', open_obligations: ['机制未检验'] })
    expect(snapshot(rev0)).toBe(before) // 旧对象逐字段不变
    expect(rev1.revision_id).toBe('rev-1')
    expect(rev1.based_on).toEqual(['ARG-REV-T@rev-0'])
    expect(rev1.scope).toBe('合成两设置范围')
    expect(rev1.support).toEqual(rev0.support) // 未 patch 字段值等携带
    const rev2 = reviseArgument(rev1, { claim: '合成断言（收窄）：两设置内单调' })
    expect(rev2.based_on).toEqual(['ARG-REV-T@rev-1'])
    expect(rev2.revision_id).toBe('rev-2')
    expect(snapshot(rev1)).not.toBe(snapshot(rev2))
  })
})

describe('P3 Assessment 状态历史（append-only）', () => {
  it('正例：追加序 + latestFor 派生当前判断；historyFor 全史并呈', () => {
    const log = createAssessmentLog()
    expect(recordAttack(log, { argument_id: 'ARG-A', op: 'undercut', target: 'premise:O2', reason: '合成质疑', source: srcRef }).recorded).toBe(true)
    expect(recordAttack(log, { argument_id: 'ARG-A', op: 'rebut', target: 'ARG-A', reason: '合成反驳', source: srcRef }).recorded).toBe(true)
    expect(recordConfirmation(log, { argument_id: 'ARG-A', reason: '合成确认', actor: 'researcher:u1', source: srcRef }).recorded).toBe(true)
    const hist = historyFor(log, 'ARG-A')
    expect(hist.map((e) => e.seq)).toEqual([0, 1, 2])
    expect(hist.map((e) => e.at_type)).toEqual(['ATTACK', 'ATTACK', 'CONFIRM'])
    const last = latestFor(log, 'ARG-A')
    expect(last?.at_type).toBe('CONFIRM')
    expect(last?.actor).toBe('researcher:u1')
    expect(latestFor(log, 'ARG-NONE')).toBeNull()
  })

  it('负例③：target 三形态之外一律拒记列账；日志不变', () => {
    const log = createAssessmentLog()
    const bad = ['bogus', '', 'premise:', 'applicability:', 'observation:O1', 'claim:CL']
    for (const t of bad) {
      const out = recordAttack(log, { argument_id: 'ARG-A', op: 'undercut', target: t, reason: 'r', source: srcRef })
      expect(out.recorded, `target=${JSON.stringify(t)} 应被拒`).toBe(false)
      expect(out.unresolved && out.unresolved.length).toBeGreaterThan(0)
    }
    expect(log.entries.length).toBe(0)
    for (const t of ['ARG-A', 'premise:O2', 'applicability:线性范围']) {
      expect(checkAttackTarget(t, 'ARG-A')).toBeNull()
      expect(recordAttack(log, { argument_id: 'ARG-A', op: 'undercut', target: t, reason: 'r', source: srcRef }).recorded).toBe(true)
    }
    expect(log.entries.length).toBe(3)
  })

  it('负例③续：导出面无删除/覆盖路径；确认无 actor 拒记（宁不记不假记）', () => {
    const offenders = Object.keys(argumentApi).filter((n) => /delete|remove|overwrite|clear|erase|update|replace|prune|drop/i.test(n))
    expect(offenders).toEqual([])
    const log = createAssessmentLog()
    const out = recordConfirmation(log, { argument_id: 'ARG-A', reason: '无归因确认', source: srcRef })
    expect(out.recorded).toBe(false)
    expect(out.unresolved?.[0]).toContain('missing_actor')
    expect(log.entries.length).toBe(0)
    // 已入账条目被冻结：就地篡改抛 TypeError（覆盖不可能静默发生）
    recordAttack(log, { argument_id: 'ARG-A', op: 'rebut', target: 'ARG-A', reason: 'r', source: srcRef })
    const frozen = log.entries[0] as { reason: string }
    expect(() => { 'use strict'; frozen.reason = '篡改' }).toThrow(TypeError)
  })
})

describe('P3 FactStanding（本地、无生产影响）', () => {
  it('正例+负例④：只有带 actor 确认推 STANDING；无 actor 停留；attack 记 CONTESTED/SUSPENDED', () => {
    const fs1 = createFactStanding('FND-1@rev-0', srcRef)
    expect(currentStanding(fs1)).toBe('CANDIDATE')
    expect(recordFactAttack(fs1, { mode: 'CONTESTED', via: srcRef }).recorded).toBe(true)
    expect(currentStanding(fs1)).toBe('CONTESTED')
    expect(recordFactAttack(fs1, { mode: 'SUSPENDED', via: srcRef }).recorded).toBe(true)
    const noActor = recordFactConfirmation(fs1, { via: srcRef })
    expect(noActor.recorded).toBe(false)
    expect(noActor.unresolved?.[0]).toContain('missing_actor')
    expect(currentStanding(fs1)).toBe('SUSPENDED') // 无 actor 确认：停留，不升级
    expect(recordFactConfirmation(fs1, { actor: 'researcher:u1', via: srcRef }).recorded).toBe(true)
    expect(currentStanding(fs1)).toBe('STANDING')
    // STANDING 记录带 by（确认须 actor，同 P2 裁定）
    const top = fs1.history[fs1.history.length - 1]!
    expect(top.by).toBe('researcher:u1')
    expect(fs1.history.map((r) => r.seq)).toEqual([0, 1, 2, 3]) // append-only，无历史被抹
  })

  it('负例④续：无「从报告/分数自动生成 standing」通道（导出白名单 + 类型面接不进）', () => {
    const auto = Object.keys(argumentApi).filter((n) => /auto|score|from.?report|generate|fromReport/i.test(n))
    expect(auto).toEqual([])
    const fs2 = createFactStanding('CLAIM-X', srcRef)
    // CandidateReport 形态的对象缺 via/actor——类型面上就接不进确认记录（无适配函数）
    const reportShaped = {
      status: 'CANDIDATE_REVIEW_ONLY' as const,
      fixed_statement: '',
      files: [] as string[],
      argument_candidates: [] as never[],
      evidence_candidates: [] as never[],
      flagged: [] as never[],
      missing_inputs: [] as never[],
    }
    // @ts-expect-error report 输出不可作为事实确认记录（必填 via 缺失，且无此类转换函数）
    recordFactConfirmation(fs2, reportShaped)
    expect(currentStanding(fs2)).toBe('CANDIDATE')
  })
})

describe('P3 三反例 golden（fixtures/argument）', () => {
  it('反例1 independent-paths：undercut(MR2) 只染含 MR2 的 OR 分支；另一分支+claim 不动', () => {
    const doc = scenarioDoc('independent-paths')
    const g = goldenOf<{
      assess: { affected_paths: string[]; unaffected_paths: string[]; claim_status: string; node_status: Record<string, string> }
      branches: { affected: { index: number; leaves: string[] }[]; intact: { index: number; leaves: string[] }[] }
      claim_untouched_by_branch_loss: boolean
    }>('independent-paths')
    expect(verifyScenario(doc.scenario, POC_DIR)).toEqual([])
    const res = assess(doc.scenario, createEvalState(doc.scenario), doc.attack.op, doc.attack.target)
    expect(res.affected_paths).toEqual(g.assess.affected_paths)
    expect(res.unaffected_paths).toEqual(g.assess.unaffected_paths)
    expect(res.state.claim_status).toBe(g.assess.claim_status)
    expect(res.state.node_status).toEqual(g.assess.node_status)
    const branches = supportBranches(doc.argument.support)
    const affected = branches.filter((b) => b.leaves.includes(doc.attack.target))
    const intact = branches.filter((b) => !b.leaves.includes(doc.attack.target))
    expect(affected).toEqual(g.branches.affected)
    expect(intact).toEqual(g.branches.intact)
    if (g.claim_untouched_by_branch_loss) expect(res.state.claim_status).toBe('OPEN')
  })

  it('反例2 explanation-falsified：undercut(explanation) → explanation CONTESTED、观测仍 SUPPORTED、claim 不撤（真实 strk-05/06 素材）', () => {
    const doc = scenarioDoc('explanation-falsified')
    const g = goldenOf<{
      assess: { affected_paths: string[]; unaffected_paths: string[]; claim_status: string; node_status: Record<string, string> }
      fact_standing: Record<string, string>
      claim_text_verbatim_from: { file: string; run_id: string; seq: number }
      claim_not_withdrawn: boolean
    }>('explanation-falsified')
    expect(verifyScenario(doc.scenario, POC_DIR)).toEqual([])
    const res = assess(doc.scenario, createEvalState(doc.scenario), doc.attack.op, doc.attack.target)
    expect(res.affected_paths).toEqual(g.assess.affected_paths)
    expect(res.unaffected_paths).toEqual(g.assess.unaffected_paths)
    expect(res.state.node_status).toEqual(g.assess.node_status)
    expect(res.state.claim_status).toBe('OPEN') // 解释失效不撤历史断言
    // FactStanding 面：攻击只落 explanation；观测事实停留原态
    const nodeRef = (id: string): SourceRef => doc.scenario.nodes.find((n) => n.node_id === id)!.source_ref!
    const standings: Record<string, string | null> = {}
    for (const id of Object.keys(g.fact_standing)) {
      const fs1 = createFactStanding(`${id}@rev-0`, nodeRef(id))
      if (id === doc.attack.target) recordFactAttack(fs1, { mode: 'CONTESTED', via: nodeRef(id) })
      standings[id] = currentStanding(fs1)
    }
    expect(standings).toEqual(g.fact_standing)
    // 真实素材挂接点：argument.claim 逐字=strk-06#4 payload.claim
    // （strk-06#4 的跨文件 based_on 需解析表：与 strk-05 一同两趟法解析）
    const claimFile = path.join(POC_DIR, g.claim_text_verbatim_from.file)
    const parsed = parseWithResolution([
      path.join(POC_DIR, 'samples/gpt-streak/envelopes.strk-05-live-nominal.jsonl'),
      claimFile,
    ]).get(claimFile)!
    expect(parsed.problems).toEqual([])
    const ev = parsed.events.find((e) => e.run_id === g.claim_text_verbatim_from.run_id && e.event_seq === g.claim_text_verbatim_from.seq)!
    expect(doc.argument.claim).toBe(ev.payload.claim)
    if (g.claim_not_withdrawn) expect(res.state.claim_status).not.toBe('WITHDRAWN')
  })

  it('反例3 formal-valid-applied-fails：同 argument 上「数学可信✓」与「适用范围失败✗」并存互不覆盖', () => {
    const doc = historyDoc('formal-valid-applied-fails')
    const g = goldenOf<{
      sequence: string[]
      latest_for_type: string
      coexist: { confirm_reason_contains: string; attack_reason_contains: string; confirm_entry_unchanged: boolean }
      attack_target_form: string
      attack_target_scope_equals_argument_scope: boolean
      evidence_anchor_files: string[]
    }>('formal-valid-applied-fails')
    expect(checkArgumentMethod(doc.argument.method)).toBeNull()
    const log = createAssessmentLog()
    let confirmSnapshot = ''
    for (const item of doc.assessment_history) {
      if (item.at_type === 'CONFIRM') {
        expect(recordConfirmation(log, { argument_id: doc.argument.argument_id, reason: item.reason, actor: item.actor, source: item.source }).recorded).toBe(true)
        confirmSnapshot = snapshot(log.entries[log.entries.length - 1])
      } else {
        expect(recordAttack(log, { argument_id: doc.argument.argument_id, op: item.op as 'undercut' | 'rebut', target: item.target, reason: item.reason, source: item.source }).recorded).toBe(true)
      }
    }
    const hist = historyFor(log, doc.argument.argument_id)
    expect(hist.map((e) => e.at_type)).toEqual(g.sequence)
    expect(hist.length).toBe(2) // 两条并存，追加不覆盖
    expect(latestFor(log, doc.argument.argument_id)?.at_type).toBe(g.latest_for_type)
    const confirm = hist.find((e) => e.at_type === 'CONFIRM')!
    const attack = hist.find((e) => e.at_type === 'ATTACK')!
    expect(confirm.reason).toContain(g.coexist.confirm_reason_contains)
    expect(attack.reason).toContain(g.coexist.attack_reason_contains)
    if (g.coexist.confirm_entry_unchanged) expect(snapshot(confirm)).toBe(confirmSnapshot) // 攻击入账后 CONFIRM 分毫不动
    // 失败限定在适用范围：target=applicability:<scope 原文>，不外推为命题为假
    expect(attack.target.startsWith(`${g.attack_target_form}:`)).toBe(true)
    if (g.attack_target_scope_equals_argument_scope) {
      expect(attack.target.slice('applicability:'.length)).toBe(doc.argument.scope)
    }
    // 证据锚点回源存在（strk-05#4 / strk-06#3/4 真实信封事件；两趟法带解析表）
    const sixRel = 'samples/gpt-streak/envelopes.strk-06-live-quaderr.jsonl'
    const relAnchors = [...new Set([...g.evidence_anchor_files, sixRel])]
    const anchorFiles = relAnchors.map((f) => path.join(POC_DIR, f))
    const parsedMap = parseWithResolution(anchorFiles)
    for (const file of anchorFiles) expect(parsedMap.get(file)!.problems).toEqual([])
    const six = parsedMap.get(path.join(POC_DIR, sixRel))!
    for (const seq of [3, 4]) expect(six.events.some((e) => e.event_seq === seq)).toBe(true)
  })
})
