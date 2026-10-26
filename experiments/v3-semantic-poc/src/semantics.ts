/**
 * P2 离线语义机制层（合成范围）——L0/L1 渐进语义 + 选择性影响（selective impact）。
 *
 * 上游权威：docs/poc/V3_POC_EXECUTION_PLAN.md §1（问题 2/4）与 §4「P2」；
 * ARCHITECTURE_BASELINE.md §4（L0/L1 定义）。设计裁定见 NOTES.md「P2 机制层」节。
 *
 * 核心纪律（都有对应负例测试，一个都不能松）：
 *  1. **选择性影响**：undercut（攻击推理适用性）只降级「依赖被攻击节点」的路径，
 *     claim 存在性与独立路径**不级联**（#10 §1 问题 4；P4 验收组反例）。
 *     rebut（攻击结论）才触及 claim 状态。
 *  2. L0 原稿**不可变**：修订=新 revision，基于 based_on 指旧版，永不覆盖。
 *  3. L1 候选**默认且默认停留** NEEDS_CLARIFICATION：唯一升级通道是显式确认
 *     事件（RESEARCHER_INFERENCE + payload.action='semantic_confirmation' +
 *     payload.confirming 指向存在对象 + payload.actor 非空——无授权人不可归因，
 *     宁停留不升级；我方加严，待 P2 Gate 评审）。
 *  4. 槽位缺失 = 'UNKNOWN' 字符串占位，**禁止任何补全**（本层没有 LLM，
 *     也不得模仿 LLM 填空）。
 *  5. 论证结构 = scenario 文件**显式声明**（nodes + paths）；based_on 只作
 *     来源线索，**禁止**从 based_on 猜论证结构（P1「派生≠证明」同源纪律）。
 *
 * 合成声明：全部输入为 P0/P1 合成 fixtures + 2026-10-26 合成研究场景的真实
 * GPT 运行信封；无任何真实实验数据。不声称任何 Gate 通过。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { canonicalize, parseEnvelopeFile } from './envelope.ts'
import type { EnvelopeEvent } from './envelope.ts'

// ── 公共小件 ────────────────────────────────────────────────────────────────

export interface SourceRef {
  file: string
  run_id: string
  seq: number
}

/** 稳定 id：canonical 化后的 sha256 前 16 位（与 P1 身份纪律同源：可回源定位）。 */
export function stableId(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(parts))).digest('hex').slice(0, 16)
}

// ── 论证图：scenario 显式声明 ───────────────────────────────────────────────

export type NodeKind = 'observation_record' | 'analysis_result' | 'mechanism_reading' | 'assumption' | 'claim'

export interface ArgNode {
  node_id: string
  kind: NodeKind
  /** assumption 节点无信封来源，只有文本；其余节点必须带 source_ref。 */
  source_ref?: SourceRef
  assumption_text?: string
}

export interface PathDecl {
  path_id: string
  /** 该路径的全部前提节点（缺一经 verify 记 unresolved）。 */
  premises: string[]
  /** 该路径依赖的「机制读数」节点（可缺）。 */
  via_mechanism_of?: string
}

export interface Scenario {
  scenario_id: string
  nodes: ArgNode[]
  paths: PathDecl[]
  claim: string
}

/** 读 scenario（结构错→unresolved，不抛）；baseDir 解析 source_ref.file。 */
export function loadScenarioFile(filePath: string): { scenario: Scenario | null; unresolved: string[] } {
  const unresolved: string[] = []
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    unresolved.push(`scenario_unreadable: ${filePath}`)
    return { scenario: null, unresolved }
  }
  if (typeof raw !== 'object' || raw === null) {
    unresolved.push('scenario_not_object')
    return { scenario: null, unresolved }
  }
  const o = raw as Record<string, unknown>
  if (typeof o.scenario_id !== 'string' || !Array.isArray(o.nodes) || !Array.isArray(o.paths) || typeof o.claim !== 'string') {
    unresolved.push('scenario_shape_invalid')
    return { scenario: null, unresolved }
  }
  return { scenario: o as unknown as Scenario, unresolved }
}

/** 逐节点回源核验：source_ref 必须能在信封文件里按 run_id+seq 找到（禁止引用不存在的靶）。 */
export function verifyScenario(scenario: Scenario, baseDir: string): string[] {
  const unresolved: string[] = []
  const cache = new Map<string, EnvelopeEvent[] | null>()
  const refs = scenario.nodes.filter((n) => n.source_ref).map((n) => n.source_ref!)
  // v0.1 跨文件 based_on 需要先有解析表：对被引用的信封文件做宽松一趟收集
  // （与 poc-run.mjs --fixture 的同源规则），再严格解析。
  const knownRuns = new Map<string, Set<number>>()
  for (const ref of refs) {
    const abs = path.join(baseDir, ref.file)
    if (cache.has(abs)) continue
    cache.set(abs, [])
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
    } catch { /* 不可读由严格趟记账 */ }
  }
  cache.clear()
  const eventsFor = (abs: string): EnvelopeEvent[] | null => {
    if (!cache.has(abs)) {
      const r = parseEnvelopeFile(abs, { knownRuns })
      cache.set(abs, r.problems.length > 0 ? null : r.events)
    }
    return cache.get(abs)!
  }
  const ids = new Set(scenario.nodes.map((n) => n.node_id))
  for (const n of scenario.nodes) {
    if (!n.source_ref) {
      if (n.kind !== 'assumption' || typeof n.assumption_text !== 'string') {
        unresolved.push(`node_without_source: ${n.node_id}（非 assumption 或无文本）`)
      }
      continue
    }
    const abs = path.join(baseDir, n.source_ref.file)
    const events = eventsFor(abs)
    if (!events) {
      unresolved.push(`source_file_rejected: ${n.node_id}`)
      continue
    }
    if (!events.some((e) => e.run_id === n.source_ref!.run_id && e.event_seq === n.source_ref!.seq)) {
      unresolved.push(`source_ref_missing: ${n.node_id} ${n.source_ref.run_id}#${n.source_ref.seq}`)
    }
  }
  for (const p of scenario.paths) {
    for (const pr of p.premises) if (!ids.has(pr)) unresolved.push(`path_premise_unknown: ${p.path_id}/${pr}`)
    if (p.via_mechanism_of && !ids.has(p.via_mechanism_of)) unresolved.push(`path_mechanism_unknown: ${p.path_id}/${p.via_mechanism_of}`)
  }
  if (!ids.has(scenario.claim)) unresolved.push(`claim_node_unknown: ${scenario.claim}`)
  return unresolved
}

// ── 选择性影响评估 ──────────────────────────────────────────────────────────

export type NodeStatus = 'SUPPORTED' | 'NEEDS_CLARIFICATION'
export type ClaimStatus = 'OPEN' | 'WITHDRAWN'

export interface EvalState {
  scenario_id: string
  node_status: Record<string, NodeStatus>
  claim_status: ClaimStatus
  log: string[]
}

export interface ImpactResult {
  state: EvalState
  affected_paths: string[]
  unaffected_paths: string[]
}

export function createEvalState(scenario: Scenario): EvalState {
  const node_status: Record<string, NodeStatus> = {}
  for (const n of scenario.nodes) node_status[n.node_id] = 'SUPPORTED'
  return { scenario_id: scenario.scenario_id, node_status, claim_status: 'OPEN', log: [] }
}

/** 受攻击节点直接支撑的路径（前提含 target，或 via_mechanism_of=target）。 */
function dependentPaths(scenario: Scenario, target: string): string[] {
  return scenario.paths
    .filter((p) => p.premises.includes(target) || p.via_mechanism_of === target)
    .map((p) => p.path_id)
}

/**
 * undercut(target)：target 降 NEEDS_CLARIFICATION，依赖它的路径降级；
 * **claim 不动、独立路径不动**（不可达 ⇒ 天然不级联）。
 * rebut(target)：target=claim ⇒ claim WITHDRAWN（唯一能撤 claim 的算子）；
 * target=节点 ⇒ 该节点及其直接路径降级（claim 仍 OPEN——撤一个前提不等于撤结论）。
 */
export function assess(scenario: Scenario, state: EvalState, op: 'undercut' | 'rebut', target: string): ImpactResult {
  const next: EvalState = { scenario_id: state.scenario_id, node_status: { ...state.node_status }, claim_status: state.claim_status, log: [...state.log] }
  const known = Object.prototype.hasOwnProperty.call(next.node_status, target)
  if (!known && !(op === 'rebut' && target === scenario.claim)) {
    next.log.push(`assess_noop_unknown_target: ${op} ${target}`)
    return { state: next, affected_paths: [], unaffected_paths: scenario.paths.map((p) => p.path_id) }
  }
  if (op === 'rebut' && target === scenario.claim) {
    next.claim_status = 'WITHDRAWN'
    next.log.push(`rebut_claim: ${target} -> WITHDRAWN`)
    return { state: next, affected_paths: [], unaffected_paths: scenario.paths.map((p) => p.path_id) }
  }
  next.node_status[target] = 'NEEDS_CLARIFICATION'
  const affected = dependentPaths(scenario, target)
  next.log.push(`${op} ${target}: affected=[${affected.join(',')}] claim 保持 ${next.claim_status}`)
  const all = scenario.paths.map((p) => p.path_id)
  return { state: next, affected_paths: affected, unaffected_paths: all.filter((id) => !affected.includes(id)) }
}

// ── L0 结构化 ResearchFinding（不可变） ─────────────────────────────────────

export interface L0Slots {
  subject: string
  object: string
  activity_result: string
  reasoning_mode: string
}

export interface L0Finding {
  finding_id: string
  revision_id: string
  /** 原文逐字片段——本层无 LLM，禁止重写/补全。 */
  text: string
  slots: L0Slots
  source_refs: SourceRef[]
  uncertainties: string[]
  /** 修订链：rev-1 起指向被修订的 finding。 */
  based_on: string[]
}

const L0_KINDS: Record<string, true> = {
  'observation.recorded': true,
  'analysis.performed': true,
  'claim.candidate': true,
  'note.unknown': true,
}

/** 槽位提取：payload 没有的一律 'UNKNOWN'——负例测试锁定「不得编造」。 */
function extractSlots(payload: Record<string, unknown>): L0Slots {
  const s: L0Slots = { subject: 'UNKNOWN', object: 'UNKNOWN', activity_result: 'UNKNOWN', reasoning_mode: 'UNKNOWN' }
  for (const k of ['subject', 'object', 'activity_result', 'reasoning_mode'] as const) {
    const v = payload[k]
    if (typeof v === 'string' && v.length > 0) s[k] = v
  }
  return s
}

function findingText(payload: Record<string, unknown>): string {
  for (const k of ['claim', 'mechanism_reading', 'note', 'reading'] as const) {
    const v = payload[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return JSON.stringify(canonicalize(payload))
}

export function buildL0Findings(events: EnvelopeEvent[], file: string): L0Finding[] {
  const out: L0Finding[] = []
  for (const e of events) {
    if (!L0_KINDS[e.kind]) continue
    const source: SourceRef = { file, run_id: e.run_id, seq: e.event_seq }
    const uncertainties = e.unknowns.map((u) => typeof u === 'string' ? u : JSON.stringify(canonicalize(u)))
    for (const [k, v] of Object.entries(extractSlots(e.payload))) {
      if (v === 'UNKNOWN') uncertainties.push(`槽位缺失：${k}=UNKNOWN（未补全）`)
    }
    out.push({
      finding_id: stableId(source),
      revision_id: 'rev-0',
      text: findingText(e.payload),
      slots: extractSlots(e.payload),
      source_refs: [source],
      uncertainties,
      based_on: [],
    })
  }
  return out
}

/** 修订 = 新对象 + based_on 指旧版；**原对象永不修改**（不可变纪律）。 */
export function reviseL0(old: L0Finding, newText: string, reason: string): L0Finding {
  const revN = Number(old.revision_id.replace('rev-', '')) + 1
  return {
    finding_id: old.finding_id,
    revision_id: `rev-${revN}`,
    text: newText,
    slots: { ...old.slots },
    source_refs: [...old.source_refs],
    uncertainties: [...old.uncertainties, `修订理由：${reason}`],
    based_on: [`${old.finding_id}@${old.revision_id}`],
  }
}

// ── L1 候选 + 语义确认状态机 ────────────────────────────────────────────────

export type L1Status = 'NEEDS_CLARIFICATION' | 'CONFIRMED'

export interface L1Candidate {
  candidate_id: string
  /** 引用的 L0 revision（`finding_id@rev`）。 */
  refs: string[]
  concept_tags: string[]
  world_context: string
  research_scope: string
  status: L1Status
  confirmations: { by: string; via: SourceRef }[]
}

/** 从 claim.candidate 事件建 L1；一切初始状态 = NEEDS_CLARIFICATION（完成率不是目标）。 */
export function buildL1Candidates(events: EnvelopeEvent[], file: string, findings: L0Finding[]): L1Candidate[] {
  const out: L1Candidate[] = []
  for (const e of events) {
    if (e.kind !== 'claim.candidate') continue
    const source: SourceRef = { file, run_id: e.run_id, seq: e.event_seq }
    const f = findings.find((x) => x.source_refs[0]?.run_id === e.run_id && x.source_refs[0]?.seq === e.event_seq)
    out.push({
      candidate_id: `L1-${stableId(source)}`,
      refs: f ? [`${f.finding_id}@${f.revision_id}`] : [],
      concept_tags: Array.isArray(e.payload.concept_tags) ? (e.payload.concept_tags as unknown[]).filter((t) => typeof t === 'string') as string[] : [],
      world_context: typeof e.payload.world_context === 'string' ? e.payload.world_context : 'UNKNOWN',
      research_scope: typeof e.payload.research_scope === 'string' ? e.payload.research_scope : 'UNKNOWN',
      status: 'NEEDS_CLARIFICATION',
      confirmations: [],
    })
  }
  return out
}

export interface ConfirmOutcome {
  candidates: L1Candidate[]
  /** 每条被拒绝/失效的确认尝试的显式账目（不猜、不静默）。 */
  unresolved: { candidate_id: string; reason: string; source: SourceRef }[]
}

/**
 * 唯一升级通道（约定 payload.action='semantic_confirmation'，kind 枚举不可扩）：
 * 必须 ①channel=RESEARCHER_INFERENCE ②payload.confirming 指向本候选
 * （candidate_id 或引用的 l0 revision）③payload.actor 非空。缺任一 → 停留 + 列账。
 */
export function applySemanticConfirmations(candidates: L1Candidate[], events: EnvelopeEvent[], file: string): ConfirmOutcome {
  const unresolved: ConfirmOutcome['unresolved'] = []
  const next = candidates.map((c) => ({ ...c, refs: [...c.refs], concept_tags: [...c.concept_tags], confirmations: [...c.confirmations] }))
  for (const e of events) {
    if (e.payload.action !== 'semantic_confirmation') continue
    const source: SourceRef = { file, run_id: e.run_id, seq: e.event_seq }
    const confirming = e.payload.confirming
    if (typeof confirming !== 'object' || confirming === null) {
      unresolved.push({ candidate_id: 'UNKNOWN', reason: 'missing_confirming_ref', source })
      continue
    }
    const cf = confirming as Record<string, unknown>
    const targetId = typeof cf.candidate_id === 'string' ? cf.candidate_id : typeof cf.l0_revision_id === 'string' ? cf.l0_revision_id : ''
    const hit = next.find((c) => c.candidate_id === targetId || c.refs.some((r) => r.startsWith(targetId)))
    if (!hit) {
      unresolved.push({ candidate_id: targetId || 'UNKNOWN', reason: 'unknown_target', source })
      continue
    }
    if (e.channel !== 'RESEARCHER_INFERENCE') {
      unresolved.push({ candidate_id: hit.candidate_id, reason: 'wrong_channel', source })
      continue
    }
    if (typeof e.payload.actor !== 'string' || e.payload.actor.length === 0) {
      unresolved.push({ candidate_id: hit.candidate_id, reason: 'missing_actor（无授权人不可归因，停留 NEEDS_CLARIFICATION）', source })
      continue
    }
    hit.status = 'CONFIRMED'
    hit.confirmations.push({ by: e.payload.actor, via: source })
  }
  return { candidates: next, unresolved }
}
