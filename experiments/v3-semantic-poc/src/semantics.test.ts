/**
 * P2 语义机制层测试（合成范围）。核心=五道负例锁死选择性影响与不可变/不猜纪律：
 *  a) undercut 机制后撤销独立观测路径 ⇒ 红；b) 目标在路径前提里却没命中 ⇒ 红
 *  （实现过弱）；c) 无确认/缺 actor 自动 CONFIRMED ⇒ 红；d) L0 修订覆盖原稿 ⇒ 红；
 *  e) 槽位缺省出现任何补全 ⇒ 红。golden 期望表由 integrator 标注， disagreements 无。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseEnvelopeFile } from './envelope.ts'
import type { EnvelopeEvent } from './envelope.ts'
import {
  applySemanticConfirmations,
  assess,
  buildL0Findings,
  buildL1Candidates,
  createEvalState,
  loadScenarioFile,
  reviseL0,
  verifyScenario,
} from './semantics.ts'

const POC_DIR = fileURLToPath(new URL('../', import.meta.url))
const scn = (name: string): { scenario: ReturnType<typeof loadScenarioFile>['scenario']; unresolved: string[] } =>
  loadScenarioFile(path.join(POC_DIR, 'fixtures/semantics', `${name}.scenario.json`))
const golden = (name: string): { attack: { op: 'undercut' | 'rebut'; target: string }; affected_paths: string[]; unaffected_paths: string[]; claim_status: string } =>
  JSON.parse(readFileSync(path.join(POC_DIR, 'fixtures/semantics', `${name}.expected.json`), 'utf8'))

describe('P2 论证图与 golden 选择性影响', () => {
  it('两个 scenario 的节点/路径引用全部可回源核验', () => {
    for (const name of ['independent-support', 'strk04-degeneracy']) {
      const { scenario, unresolved } = scn(name)
      expect(unresolved, name).toEqual([])
      expect(scenario).not.toBeNull()
      expect(verifyScenario(scenario!, POC_DIR), name).toEqual([])
    }
  })

  it('golden：undercut(机制读数) 只染依赖路径，claim 与独立路径不动（independent-support）', () => {
    const { scenario } = scn('independent-support')
    const g = golden('independent-support')
    const out = assess(scenario!, createEvalState(scenario!), g.attack.op, g.attack.target)
    expect(out.affected_paths).toEqual(g.affected_paths)
    expect(out.unaffected_paths).toEqual(g.unaffected_paths)
    expect(out.state.claim_status).toBe(g.claim_status)
    expect(out.state.node_status.MR2).toBe('NEEDS_CLARIFICATION')
  })

  it('golden：undercut(独立性假设) 命中束斑对比路径，v2 残余路径不动（strk04）', () => {
    const { scenario } = scn('strk04-degeneracy')
    const g = golden('strk04-degeneracy')
    const out = assess(scenario!, createEvalState(scenario!), g.attack.op, g.attack.target)
    expect(out.affected_paths).toEqual(g.affected_paths)
    expect(out.unaffected_paths).toEqual(g.unaffected_paths)
    expect(out.state.claim_status).toBe(g.claim_status)
  })

  // 负例 a：级联撤销独立证据 = 红
  it('负例a：undercut(MR2) 之后，独立观测 O2 与 P-direct 前提必须原样 SUPPORTED', () => {
    const { scenario } = scn('independent-support')
    const out = assess(scenario!, createEvalState(scenario!), 'undercut', 'MR2')
    expect(out.state.node_status.O2).toBe('SUPPORTED')
    expect(out.state.node_status.O1).toBe('SUPPORTED')
    expect(out.state.claim_status).toBe('OPEN')
  })

  // 负例 b：实现过弱（目标在前提里却没命中）= 红
  it('负例b：undercut(O2) 必须命中把 O2 列为前提的 P-mech', () => {
    const { scenario } = scn('independent-support')
    const out = assess(scenario!, createEvalState(scenario!), 'undercut', 'O2')
    expect(out.affected_paths).toContain('P-mech')
    expect(out.unaffected_paths).toEqual(['P-direct'])
  })

  it('rebut(claim) 是唯一撤 claim 的算子；rebut/undercut 节点都不动 claim 状态', () => {
    const { scenario } = scn('independent-support')
    const s0 = createEvalState(scenario!)
    expect(assess(scenario!, s0, 'rebut', 'CL').state.claim_status).toBe('WITHDRAWN')
    expect(assess(scenario!, s0, 'rebut', 'MR2').state.claim_status).toBe('OPEN')
    expect(assess(scenario!, s0, 'undercut', 'CL').state.claim_status).toBe('OPEN')
  })
})

describe('P2 L0 不可变与不猜槽位', () => {
  const events = parseEnvelopeFile(path.join(POC_DIR, 'fixtures/independent-support.jsonl')).events
  const findings = buildL0Findings(events, 'fixtures/independent-support.jsonl')

  it('L0 覆盖 claim/observation/note.unknown 事件；text 逐字取自 payload', () => {
    expect(findings).toHaveLength(4)
    const claim = findings.find((f) => f.source_refs[0]?.seq === 7)
    expect(claim?.text).toBe('高光强下光输出增益压缩到约 0.7 是稳健行为，两条独立路径均复现')
  })

  // 负例 e：槽位补全 = 红
  it('负例e：payload 无槽位字段时，槽位只能是 UNKNOWN 且记入 uncertainties', () => {
    for (const f of findings) {
      expect(Object.values(f.slots).filter((v) => v === 'UNKNOWN').length).toBeGreaterThanOrEqual(4)
      expect(f.uncertainties.some((u) => u.includes('槽位缺失'))).toBe(true)
    }
  })

  // 负例 d：修订覆盖原稿 = 红
  it('负例d：reviseL0 产出新对象，原 rev-0 文本/槽位/不确定项分毫不动', () => {
    const original = findings.find((f) => f.source_refs[0]?.seq === 3)!
    const snapshot = JSON.parse(JSON.stringify(original))
    const rev1 = reviseL0(original, '修订：0.71 为屏面均值口径', '口径澄清')
    expect(rev1.revision_id).toBe('rev-1')
    expect(rev1.based_on).toEqual([`${original.finding_id}@rev-0`])
    expect(JSON.parse(JSON.stringify(original))).toEqual(snapshot)
  })
})

describe('P2 L1 语义确认状态机', () => {
  const events = parseEnvelopeFile(path.join(POC_DIR, 'fixtures/independent-support.jsonl')).events
  const findings = buildL0Findings(events, 'fixtures/independent-support.jsonl')
  const base = {
    schema: 'poc/prov-envelope/v0',
    source_project: 'numerical-streak-camera',
    run_id: 'RUN-SYNTH-INDSUP-1',
    event_seq: 99,
    occurred_at: '2026-10-26T00:00:00Z',
    recorded_at: '2026-10-26T00:00:01Z',
    snapshot_ref: { kind: 'none', id: '', content_sha256: null },
    access_boundary: 'synthetic',
    kind: 'claim.candidate',
    unknowns: [],
  }
  const mkEvent = (payload: Record<string, unknown>, channel = 'RESEARCHER_INFERENCE'): EnvelopeEvent =>
    ({ ...base, payload, channel }) as EnvelopeEvent

  it('L1 从 claim.candidate 建立，默认 NEEDS_CLARIFICATION（完成率不是目标）', () => {
    const l1s = buildL1Candidates(events, 'fixtures/independent-support.jsonl', findings)
    expect(l1s).toHaveLength(1)
    expect(l1s[0]!.status).toBe('NEEDS_CLARIFICATION')
    expect(l1s[0]!.refs[0]).toMatch(/@rev-0$/)
  })

  // 负例 c：各种"看似确认"都不许升级 = 红
  it('负例c：缺 actor / 缺 confirming / 错通道 / 目标不存在 → 停留 + 显式列账', () => {
    const cands = buildL1Candidates(events, 'fixtures/independent-support.jsonl', findings)
    const target = cands[0]!
    const ref = target.refs[0]!
    const noActor = mkEvent({ action: 'semantic_confirmation', confirming: { candidate_id: target.candidate_id } })
    const noRef = mkEvent({ action: 'semantic_confirmation', actor: ' researcher ' })
    const wrongCh = mkEvent({ action: 'semantic_confirmation', confirming: { l0_revision_id: ref }, actor: 'annotator-A' }, 'SOURCE_RECORD')
    const ghost = mkEvent({ action: 'semantic_confirmation', confirming: { candidate_id: 'L1-ghost' }, actor: 'annotator-A' })
    const out = applySemanticConfirmations(cands, [noActor, noRef, wrongCh, ghost], 'test.jsonl')
    expect(out.candidates[0]!.status).toBe('NEEDS_CLARIFICATION')
    expect(out.candidates[0]!.confirmations).toHaveLength(0)
    expect(out.unresolved.map((u) => u.reason.split('（')[0])).toEqual(['missing_actor', 'missing_confirming_ref', 'wrong_channel', 'unknown_target'])
  })

  it('完整确认（RESEARCHER_INFERENCE + confirming + actor）→ CONFIRMED 且可归因', () => {
    const cands = buildL1Candidates(events, 'fixtures/independent-support.jsonl', findings)
    const target = cands[0]!
    const good = mkEvent({ action: 'semantic_confirmation', confirming: { l0_revision_id: target.refs[0] }, actor: 'annotator-A' })
    const out = applySemanticConfirmations(cands, [good], 'test.jsonl')
    expect(out.candidates[0]!.status).toBe('CONFIRMED')
    expect(out.candidates[0]!.confirmations[0]).toMatchObject({ by: 'annotator-A' })
    expect(out.unresolved).toEqual([])
  })
})
