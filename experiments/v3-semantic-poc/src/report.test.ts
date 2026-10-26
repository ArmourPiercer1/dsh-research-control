/**
 * P3 候选报告生成器测试（合成范围）——正例 + 固定负例⑤⑥。
 * ⑤ 高风险措辞必 flagged 且不进正式候选区（端到端：喂故意违规的合成信封）；
 * ⑥ 渲染输出固定声明段恒在场（隔离渠道语义的离线形态）。
 *
 * 合成声明：fixtures/report/high-risk.jsonl 为合成负例素材（文件内逐事件
 * 声明）；samples/gpt-streak 为真实 GPT 运行信封（合成研究场景）仅作正例通路。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CANDIDATE_REPORT_STATUS,
  FIXED_REVIEW_STATEMENT,
  generateCandidateReport,
  renderReportMarkdown,
  scanHighRiskPhrasing,
} from './report.ts'

const POC_DIR = fileURLToPath(new URL('../', import.meta.url))

describe('P3 scanHighRiskPhrasing（措辞纪律自查）', () => {
  it('四类高风险误报逐一命中', () => {
    expect(scanHighRiskPhrasing('run通过，证明了理论成立')).toEqual(expect.arrayContaining(['proof_of_truth', 'run_pass_proves_theory']))
    expect(scanHighRiskPhrasing('correlation implies causation')).toContain('correlation_as_causation')
    expect(scanHighRiskPhrasing('样本相关即因果')).toContain('correlation_as_causation')
    expect(scanHighRiskPhrasing('置信度0.92就是事实')).toContain('confidence_as_fact')
    expect(scanHighRiskPhrasing('测试通过，确认该假说')).toContain('run_pass_proves_theory')
  })

  it('克制措辞不误伤（空命中）', () => {
    expect(scanHighRiskPhrasing('屏面 stdy 实测差异已记录；机制解释待定，成因未归因')).toEqual([])
    expect(scanHighRiskPhrasing('linear model signature mismatch on measured data (cause unresolved)')).toEqual([])
  })
})

describe('P3 generateCandidateReport（CANDIDATE_REVIEW_ONLY）', () => {
  it('负例⑤端到端：高风险 payload → 整条 flagged，不入正式候选区，unknowns 加账', () => {
    const { report, unresolved } = generateCandidateReport(path.join(POC_DIR, 'fixtures/report'), POC_DIR)
    expect(report.status).toBe(CANDIDATE_REPORT_STATUS)
    expect(report.status).toBe('CANDIDATE_REVIEW_ONLY')
    // 两条高风险条目（seq1/seq2）全部落 flagged
    expect(report.flagged.map((f) => f.source_ref.seq).sort()).toEqual([1, 2])
    const f1 = report.flagged.find((f) => f.source_ref.seq === 1)!
    const f2 = report.flagged.find((f) => f.source_ref.seq === 2)!
    expect(f1.flags).toEqual(expect.arrayContaining(['proof_of_truth', 'run_pass_proves_theory']))
    expect(f2.flags).toEqual(expect.arrayContaining(['correlation_as_causation', 'confidence_as_fact']))
    // flagged 不出现在正式候选区
    const formalIds = [...report.argument_candidates, ...report.evidence_candidates].map((c) => c.entry_id)
    for (const f of report.flagged) expect(formalIds).not.toContain(f.entry_id)
    // 命中即加 unknowns（宁缺勿错留痕）
    expect(f1.payload_unknowns.some((u) => u.includes('高风险措辞降级'))).toBe(true)
    // 克制措辞的 seq4 留在正式候选区
    expect(report.argument_candidates.map((c) => c.source_ref.seq)).toEqual([4])
    expect(report.evidence_candidates.map((c) => c.source_ref.seq)).toEqual([3])
    // 断链 based_on → 整行被信封校验拒收 → 缺失清单 + unresolved 列账
    const dangling = report.missing_inputs.filter((m) => m.reason === 'based_on_dangling')
    expect(dangling.length).toBe(1)
    expect(dangling[0]!.event_seq).toBe(5)
    expect(unresolved.some((u) => u.includes('dangling_based_on'))).toBe(true)
    // unknowns → 「缺失重要输入」提示清单
    const unknownSlots = report.missing_inputs.filter((m) => m.reason === 'unknown_slot')
    expect(unknownSlots.length).toBeGreaterThanOrEqual(2)
    expect(unknownSlots.every((m) => m.file === 'fixtures/report/high-risk.jsonl')).toBe(true)
  })

  it('正例通路：真实运行信封（合成研究场景）产出候选论证 + 锚点可回源', () => {
    const { report } = generateCandidateReport(path.join(POC_DIR, 'samples/gpt-streak'), POC_DIR)
    expect(report.files.length).toBe(6)
    const claim = report.argument_candidates.find((c) => c.source_ref.run_id === 'RUN-STRK-06' && c.source_ref.seq === 4)
    expect(claim).toBeDefined()
    expect(claim!.status).toBe('candidate') // 克制措辞（实测记录措辞）不被降级
    expect(claim!.text).toContain('A1 在真实数据上不触发')
    expect(claim!.source_ref.file).toBe('samples/gpt-streak/envelopes.strk-06-live-quaderr.jsonl')
    // 观测 → 候选证据条目（真实 seq）
    expect(report.evidence_candidates.some((c) => c.source_ref.run_id === 'RUN-STRK-05' && c.source_ref.seq === 4)).toBe(true)
  })

  it('确定性：同输入两次生成逐字节一致', () => {
    const a = generateCandidateReport(path.join(POC_DIR, 'fixtures/report'), POC_DIR)
    const b = generateCandidateReport(path.join(POC_DIR, 'fixtures/report'), POC_DIR)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('坏目录不抛：unresolved 列账，报告壳仍在（常量头不可配置）', () => {
    const { report, unresolved } = generateCandidateReport(path.join(POC_DIR, 'fixtures/no-such-dir'), POC_DIR)
    expect(unresolved.some((u) => u.startsWith('file_unreadable'))).toBe(true)
    expect(report.status).toBe('CANDIDATE_REVIEW_ONLY')
  })
})

describe('P3 renderReportMarkdown（隔离渠道语义的离线形态）', () => {
  it('负例⑥：固定声明段恒在场且逐字一致，flagged 区独立渲染', () => {
    const { report } = generateCandidateReport(path.join(POC_DIR, 'fixtures/report'), POC_DIR)
    const md = renderReportMarkdown(report)
    expect(md).toContain(FIXED_REVIEW_STATEMENT)
    expect(md).toContain('仅供人阅览、不注入主 Agent 指令、未经审查不得转正式 Fact/Task/Obligation')
    expect(md).toContain('CANDIDATE_REVIEW_ONLY')
    expect(md.split(FIXED_REVIEW_STATEMENT).length - 1).toBeGreaterThanOrEqual(2) // 头尾各一次
    expect(md).toContain('已降级条目（措辞自查命中，不进正式候选区')
    expect(md).toContain('run通过，证明了理论成立') // flagged 区可见（供人审），但不在候选区标题下
    expect(report.fixed_statement).toBe(FIXED_REVIEW_STATEMENT)
  })
})
