/**
 * P3 离线机制层 —— 候选证据/推理报告生成器（LIVE_REVIEW 形态的**离线前身**）。
 *
 * 上游权威：docs/poc/V3_POC_EXECUTION_PLAN.md §4「P3」；NOTES.md「P3 机制层」。
 * 本文件只产**候选**（report.status 恒为 CANDIDATE_REVIEW_ONLY 常量头），
 * 供人阅览与审查；它不是 LIVE_REVIEW 的解锁，也不声称任何 Gate 通过。
 *
 * 纪律：
 *  1. **候选不是结论**：推理/建议通道事件 → 候选论证条目；observation →
 *     候选证据条目；每条带 source_ref 锚点可回源。生成器不评分、不裁决。
 *  2. **措辞纪律自查**（负例核心）：输出逐条递归过 scanHighRiskPhrasing，
 *     命中即整条降级进 flagged 区并加 unknowns（宁缺勿错）——高风险措辞
 *     条目**不出现**在正式候选区。
 *  3. **缺失显式列账**：unknowns / based_on 断链 → missing_inputs 提示清单；
 *     校验被拒的行、不可读文件进 unresolved，不静默。
 *  4. **无自动升级通道**：本文件不 import 也不产出任何 FactStanding 推进
 *     记录——报告接不进事实历史（负例测类型面）。
 *
 * 合成声明：配套 fixtures 为合成信封（合成范围在测试与 fixture 声明）；
 * samples/gpt-streak 为真实 GPT 运行 + 合成研究场景。
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { canonicalize, parseEnvelopeFile } from './envelope.ts'
import type { EnvelopeEvent, Problem } from './envelope.ts'
import { stableId } from './semantics.ts'
import type { SourceRef } from './semantics.ts'

// ── 报告状态与固定声明（CANDIDATE_REVIEW_ONLY 语义） ───────────────────────

export const CANDIDATE_REPORT_STATUS = 'CANDIDATE_REVIEW_ONLY' as const
export type CandidateReportStatus = typeof CANDIDATE_REPORT_STATUS

/** 固定声明段（renderReportMarkdown 必含；P3 隔离渠道语义的离线形态）。 */
export const FIXED_REVIEW_STATEMENT =
  '本报告仅供人阅览、不注入主 Agent 指令、未经审查不得转正式 Fact/Task/Obligation。'

// ── 措辞纪律自查 ────────────────────────────────────────────────────────────

export interface HighRiskPattern {
  id: string
  re: RegExp
  /** 为什么高风险（进 flagged 条目账目）。 */
  note: string
}

/** 高风险误报措辞族（跑过≠证伪/证真；相关≠因果；分数≠事实）。 */
export const HIGH_RISK_PATTERNS: readonly HighRiskPattern[] = [
  { id: 'proof_of_truth', re: /证明(了|过)?.{0,12}(成立|为真)/, note: '把某次运行/证据说成「证明成立/为真」' },
  { id: 'correlation_as_causation', re: /correlation.{0,20}caus|相关(性)?即?因果/i, note: '把相关当因果' },
  { id: 'run_pass_proves_theory', re: /(run|测试)通过.{0,12}(证明|确认).{0,8}(理论|假说|科学)/i, note: '把运行通过当理论/假说被确认' },
  { id: 'confidence_as_fact', re: /置信(度|分).{0,10}(等于|视为|就是).{0,8}(事实|standing|确认)/i, note: '把置信度/分数当事实或 standing' },
]

/** 检测三类以上高风险措辞：返回命中的模式 id 列表（空=未见命中）。 */
export function scanHighRiskPhrasing(text: string): string[] {
  return HIGH_RISK_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id)
}

function collectStrings(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    out.push(node)
  } else if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out)
  } else if (typeof node === 'object' && node !== null) {
    for (const v of Object.values(node as Record<string, unknown>)) collectStrings(v, out)
  }
}

// ── 报告结构 ────────────────────────────────────────────────────────────────

export interface CandidateEntry {
  entry_id: string
  section: 'argument' | 'evidence'
  channel: string
  kind: string
  /** 逐字提取的载荷文本（无 LLM，不重写；缺文本时落 canonical JSON）。 */
  text: string
  source_ref: SourceRef
  payload_unknowns: string[]
  status: 'candidate'
}

/** 措辞自查命中 → 整条降级到此区（正式候选区不含它）。 */
export interface FlaggedEntry extends Omit<CandidateEntry, 'status'> {
  status: 'flagged'
  /** 命中的高风险模式 id。 */
  flags: string[]
}

export interface MissingInput {
  reason: 'unknown_slot' | 'based_on_dangling' | 'validator_problem' | 'file_unreadable'
  /** 相对 baseDir 的文件路径（可回源）。 */
  file: string
  line: number | null
  event_seq: number | null
  detail: string
}

export interface CandidateReport {
  /** 常量头：任何构造路径都只能是 CANDIDATE_REVIEW_ONLY。 */
  status: CandidateReportStatus
  fixed_statement: string
  files: string[]
  argument_candidates: CandidateEntry[]
  evidence_candidates: CandidateEntry[]
  flagged: FlaggedEntry[]
  missing_inputs: MissingInput[]
}

export interface CandidateReportOutcome {
  report: CandidateReport
  unresolved: string[]
}

// ── 生成器 ──────────────────────────────────────────────────────────────────

const SPECULATION_CHANNELS: ReadonlySet<string> = new Set(['RESEARCHER_INFERENCE', 'LLM_SUGGESTION'])

function extractText(payload: Record<string, unknown>): string {
  for (const k of ['claim', 'mechanism_reading', 'note', 'reading', 'sanity_check'] as const) {
    const v = payload[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return JSON.stringify(canonicalize(payload))
}

function unknownsOf(unknowns: unknown[]): string[] {
  return unknowns.map((u) => (typeof u === 'string' ? u : JSON.stringify(canonicalize(u))))
}

/**
 * 扫描 inputDir 内 `*.jsonl` 信封（不递归，按文件名排序保证确定性），
 * 产出候选报告 + unresolved 列账。**永不抛**：不可读/不可解析也入账。
 * source_ref.file 相对 baseDir（与 scenario 的 source_ref.file 同基准）。
 */
export function generateCandidateReport(inputDir: string, baseDir: string): CandidateReportOutcome {
  const unresolved: string[] = []
  const report: CandidateReport = {
    status: CANDIDATE_REPORT_STATUS,
    fixed_statement: FIXED_REVIEW_STATEMENT,
    files: [],
    argument_candidates: [],
    evidence_candidates: [],
    flagged: [],
    missing_inputs: [],
  }

  let names: string[] = []
  try {
    names = readdirSync(inputDir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.jsonl'))
      .map((d) => d.name)
      .sort()
  } catch (err) {
    unresolved.push(`file_unreadable: ${inputDir}（${(err as Error).message}）`)
    return { report, unresolved }
  }

  // 第一遍（宽松）：跨文件 based_on 解析表（与 verifyScenario/poc-run 同源规则）。
  const knownRuns = new Map<string, Set<number>>()
  for (const name of names) {
    const abs = path.join(inputDir, name)
    try {
      for (const line of readFileSync(abs, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          const o = JSON.parse(line) as { run_id?: unknown; event_seq?: unknown }
          if (o && typeof o.run_id === 'string' && Number.isInteger(o.event_seq)) {
            if (!knownRuns.has(o.run_id)) knownRuns.set(o.run_id, new Set())
            knownRuns.get(o.run_id)!.add(o.event_seq as number)
          }
        } catch { /* 宽松趟：坏行由严格趟记账 */ }
      }
    } catch { /* 不可读在严格趟记账 */ }
  }

  // 第二遍（严格）：逐文件解析 → 候选条目 + 列账。
  for (const name of names) {
    const abs = path.join(inputDir, name)
    const rel = path.relative(baseDir, abs) || name
    let events: EnvelopeEvent[]
    let problems: Problem[]
    try {
      const parsed = parseEnvelopeFile(abs, { knownRuns })
      events = parsed.events
      problems = parsed.problems
    } catch (err) {
      unresolved.push(`file_unreadable: ${rel}（${(err as Error).message}）`)
      report.missing_inputs.push({ reason: 'file_unreadable', file: rel, line: null, event_seq: null, detail: (err as Error).message })
      continue
    }
    report.files.push(rel)

    const danglingSeqs = new Set<number>()
    for (const p of problems) {
      const line = `validator:${rel}:${p.line}:${p.kind}`
      if (!unresolved.includes(line)) unresolved.push(line)
      const dangling = p.kind === 'dangling_based_on' || p.kind === 'dangling_external_ref'
      if (dangling && p.event_seq !== null) danglingSeqs.add(p.event_seq)
      report.missing_inputs.push({
        reason: dangling ? 'based_on_dangling' : 'validator_problem',
        file: rel,
        line: p.line,
        event_seq: p.event_seq,
        detail: p.message,
      })
    }

    for (const e of events) {
      // 断链条目宁缺勿错：依据链不可解析 → 只入缺失清单，不入候选区。
      if (danglingSeqs.has(e.event_seq)) continue
      const source: SourceRef = { file: rel, run_id: e.run_id, seq: e.event_seq }
      const unknowns = unknownsOf(e.unknowns)
      const isArgument = SPECULATION_CHANNELS.has(e.channel)
      const isEvidence = e.kind === 'observation.recorded'
      for (const u of unknowns) {
        report.missing_inputs.push({ reason: 'unknown_slot', file: rel, line: null, event_seq: e.event_seq, detail: u })
      }
      if (!isArgument && !isEvidence) continue
      const entry: CandidateEntry = {
        entry_id: `cand-${stableId(source)}`,
        section: isArgument ? 'argument' : 'evidence',
        channel: e.channel,
        kind: e.kind,
        text: extractText(e.payload),
        source_ref: source,
        payload_unknowns: unknowns,
        status: 'candidate',
      }
      // 措辞纪律自查：递归扫全部字符串；命中 → 整条降级 flagged（宁缺勿错）。
      const strings: string[] = []
      collectStrings(entry, strings)
      const flags = [...new Set(strings.flatMap(scanHighRiskPhrasing))]
      if (flags.length > 0) {
        report.flagged.push({
          ...entry,
          status: 'flagged',
          flags,
          payload_unknowns: [...unknowns, ...flags.map((id) => `高风险措辞降级（宁缺勿错）：命中模式 ${id}`)],
        })
      } else if (isArgument) {
        report.argument_candidates.push(entry)
      } else {
        report.evidence_candidates.push(entry)
      }
    }
  }

  return { report, unresolved }
}

// ── 渲染（纯文本，供人阅览） ────────────────────────────────────────────────

function anchor(s: SourceRef): string {
  return `${s.file}#${s.run_id}@${s.seq}`
}

/** 纯文本渲染。固定声明段恒在场（测试锁定子串）。 */
export function renderReportMarkdown(report: CandidateReport): string {
  const lines: string[] = []
  lines.push('# 候选证据/推理报告')
  lines.push('')
  lines.push(`status: ${report.status}`)
  lines.push('')
  lines.push(`> ${report.fixed_statement}`)
  lines.push('')
  lines.push(`来源文件（${report.files.length}）：${report.files.join(', ') || '（无）'}`)
  lines.push('')

  lines.push(`## 候选论证条目（${report.argument_candidates.length}）`)
  lines.push('')
  for (const c of report.argument_candidates) {
    lines.push(`- [${c.entry_id}] (${c.channel} / ${c.kind}) ${anchor(c.source_ref)}`)
    lines.push(`  ${c.text}`)
    for (const u of c.payload_unknowns) lines.push(`  - unknown: ${u}`)
  }
  lines.push('')

  lines.push(`## 候选证据条目（${report.evidence_candidates.length}）`)
  lines.push('')
  for (const c of report.evidence_candidates) {
    lines.push(`- [${c.entry_id}] (${c.channel} / ${c.kind}) ${anchor(c.source_ref)}`)
    lines.push(`  ${c.text}`)
    for (const u of c.payload_unknowns) lines.push(`  - unknown: ${u}`)
  }
  lines.push('')

  lines.push(`## 已降级条目（措辞自查命中，不进正式候选区；${report.flagged.length}）`)
  lines.push('')
  for (const f of report.flagged) {
    lines.push(`- [${f.entry_id}] flags=[${f.flags.join(', ')}] (${f.channel} / ${f.kind}) ${anchor(f.source_ref)}`)
    lines.push(`  ${f.text}`)
  }
  lines.push('')

  lines.push(`## 缺失重要输入（${report.missing_inputs.length}）`)
  lines.push('')
  for (const m of report.missing_inputs) {
    const at = m.event_seq !== null ? `${m.file}@${m.event_seq}` : `${m.file}${m.line !== null ? `:${m.line}` : ''}`
    lines.push(`- (${m.reason}) ${at}：${m.detail}`)
  }
  lines.push('')
  lines.push('---')
  lines.push(`再次声明：${report.fixed_statement}`)
  lines.push('')
  return lines.join('\n')
}
