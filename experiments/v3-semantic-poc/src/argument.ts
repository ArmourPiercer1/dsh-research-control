/**
 * P3 离线机制层 —— EvidenceRelation / ArgumentRevision / Assessment 与
 * FactStanding 状态历史（合成范围，无 Gate 声称）。
 *
 * 上游权威：docs/poc/V3_POC_EXECUTION_PLAN.md §4「P3」；设计裁定回放见
 * NOTES.md「P3 机制层」节。L0/L1 语义与 undercut/rebut 算子直接复用
 * semantics.ts（P2），本文件不重复实现评分/传播。
 *
 * 核心纪律（每条都有负例测试锁定）：
 *  1. **证据强度无数值面**：EvidenceStrength 在 schema 层面就不存在数值概率
 *     字段——只有 QUALITATIVE（WEAK/MODERATE/STRONG + basis）与
 *     NOT_QUANTIFIED（+reason）两种形态；parseEvidenceRelation 对任何
 *     probability/p_ho/confidence 键名一律拒收（宁缺勿错）。
 *  2. **ArgumentRevision 不可变**（同 P2 L0 纪律）：修订=新 revision +
 *     based_on 指旧版；原对象逐字段不动。
 *  3. **Assessment 日志 append-only**：导出面上不存在删除/覆盖 API；
 *     「当前判断」只能由 latestFor 派生。可攻击目标必须能追踪到
 *     「哪个论证 / 哪个前提 / 哪个适用性」三形态之一，格式非法→拒记列账。
 *  4. **FactStanding 无自动升级通道**：只有带 actor 的显式确认能推 STANDING
 *     （同 P2「无授权人不可归因」裁定）；本文件没有任何从报告/LLM 分数
 *     生成 standing 的函数（负例测导出面白名单）。
 *  5. 槽位缺失 = 'UNKNOWN'，禁止编造（scope 等文本槽同 P2 纪律）。
 *
 * 合成声明：本层自身不含数据；配套 fixtures 为合成场景 + 2026-10-26 真实
 * GPT 运行信封（合成研究场景）。不声称任何 Gate 通过。
 */
import { stableId } from './semantics.ts'
import type { SourceRef } from './semantics.ts'

// ── 小件 ────────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isSourceRef(value: unknown): value is SourceRef {
  if (!isPlainObject(value)) return false
  return (
    isNonEmptyString(value['file']) &&
    isNonEmptyString(value['run_id']) &&
    typeof value['seq'] === 'number' &&
    Number.isInteger(value['seq']) &&
    (value['seq'] as number) >= 0
  )
}

// ── 1. EvidenceRelation（记录用，不评分） ───────────────────────────────────

/**
 * 证据强度：schema 层面**没有**数值概率字段。要么给定性等级 + 依据，要么
 * 显式 NOT_QUANTIFIED + 原因。任何 probability/confidence/p_ho 数值都不在
 * 本类型可表达的范围里，parse 层按键名扫描拒收。
 */
export type EvidenceStrength =
  | { kind: 'QUALITATIVE'; level: 'WEAK' | 'MODERATE' | 'STRONG'; basis: string }
  | { kind: 'NOT_QUANTIFIED'; reason: string }

export type EvidencePolarity = 'SUPPORTS' | 'CONTRADICTS' | 'CONTEXTUALIZES'

const POLARITIES: readonly string[] = ['SUPPORTS', 'CONTRADICTS', 'CONTEXTUALIZES']
const LEVELS: readonly string[] = ['WEAK', 'MODERATE', 'STRONG']

export interface EvidenceRelation {
  relation_id: string
  /** 证据锚点：回源到信封事件（复用 P2 SourceRef）。 */
  evidence: SourceRef
  /** 靶：assertion / argument 节点 id（本层不校验存在性——记账先于裁决）。 */
  target: string
  polarity: EvidencePolarity
  /** 证据成立所附条件；缺省记 ['UNKNOWN']（缺失就是缺失，不补全）。 */
  conditions: string[]
  strength: EvidenceStrength
}

/** 数值强度键名扫描（负例核心）：命中即整条拒收。 */
const NUMERIC_STRENGTH_KEY_RE = /probability|p_ho|confidence/i

function collectNumericStrengthKeyPaths(node: unknown, trail: string): string[] {
  const hits: string[] = []
  if (Array.isArray(node)) {
    node.forEach((item, i) => hits.push(...collectNumericStrengthKeyPaths(item, `${trail}[${i}]`)))
    return hits
  }
  if (isPlainObject(node)) {
    for (const key of Object.keys(node)) {
      const path = `${trail}.${key}`
      if (NUMERIC_STRENGTH_KEY_RE.test(key)) hits.push(path)
      hits.push(...collectNumericStrengthKeyPaths(node[key], path))
    }
  }
  return hits
}

export function computeRelationId(relation: Omit<EvidenceRelation, 'relation_id'>): string {
  return stableId({
    evidence: relation.evidence,
    target: relation.target,
    polarity: relation.polarity,
    conditions: relation.conditions,
    strength: relation.strength,
  })
}

export interface EvidenceRelationInput {
  evidence: SourceRef
  target: string
  polarity: EvidencePolarity
  conditions?: string[]
  strength: EvidenceStrength
}

/** 构造（记录用）：conditions 缺省/空数组 → ['UNKNOWN']。不评分。 */
export function buildEvidenceRelation(input: EvidenceRelationInput): EvidenceRelation {
  const core: Omit<EvidenceRelation, 'relation_id'> = {
    evidence: { ...input.evidence },
    target: input.target,
    polarity: input.polarity,
    conditions: input.conditions && input.conditions.length > 0 ? [...input.conditions] : ['UNKNOWN'],
    strength: input.strength.kind === 'QUALITATIVE'
      ? { kind: 'QUALITATIVE', level: input.strength.level, basis: input.strength.basis }
      : { kind: 'NOT_QUANTIFIED', reason: input.strength.reason },
  }
  return { relation_id: computeRelationId(core), ...core }
}

/**
 * 校验外部来源（如手写 JSON）的关系记录。返回 {relation} 或 {rejected: 原因}，
 * **永不抛**。规则：
 *  - 任何层级键名命中 /probability|p_ho|confidence/i → 拒（数值强度不入 schema）；
 *  - 形状非法 → 拒；conditions 缺省 → ['UNKNOWN']（这是允许项，不是拒因）；
 *  - relation_id 若提供必须等于重算的 stableId（身份不可手写冒充）。
 */
export function parseEvidenceRelation(raw: unknown): { relation?: EvidenceRelation; rejected?: string } {
  const numericHits = collectNumericStrengthKeyPaths(raw, 'relation')
  if (numericHits.length > 0) {
    return { rejected: `numeric_strength_key: ${numericHits.join(', ')}（强度只允许 QUALITATIVE/NOT_QUANTIFIED，schema 无数值概率面）` }
  }
  if (!isPlainObject(raw)) return { rejected: 'not_object' }

  if (!isSourceRef(raw['evidence'])) return { rejected: 'bad_evidence（须为 {file,run_id,seq}）' }
  const target = raw['target']
  if (!isNonEmptyString(target)) return { rejected: 'bad_target' }
  const polarity = raw['polarity']
  if (typeof polarity !== 'string' || !POLARITIES.includes(polarity)) {
    return { rejected: `bad_polarity（须为 ${POLARITIES.join('|')}）` }
  }
  const condRaw = raw['conditions']
  let conditions: string[] = ['UNKNOWN']
  if (condRaw !== undefined) {
    if (!Array.isArray(condRaw) || !condRaw.every(isNonEmptyString)) return { rejected: 'bad_conditions（若提供须为字符串数组）' }
    conditions = condRaw.length > 0 ? [...condRaw] : ['UNKNOWN']
  }
  const s = raw['strength']
  if (!isPlainObject(s)) return { rejected: 'bad_strength（须为对象）' }
  let strength: EvidenceStrength
  if (s['kind'] === 'QUALITATIVE') {
    if (typeof s['level'] !== 'string' || !LEVELS.includes(s['level'])) {
      return { rejected: `bad_strength.level（须为 ${LEVELS.join('|')}）` }
    }
    if (!isNonEmptyString(s['basis'])) return { rejected: 'bad_strength.basis（定性等级必须给依据）' }
    strength = { kind: 'QUALITATIVE', level: s['level'] as 'WEAK' | 'MODERATE' | 'STRONG', basis: s['basis'] }
  } else if (s['kind'] === 'NOT_QUANTIFIED') {
    if (!isNonEmptyString(s['reason'])) return { rejected: 'bad_strength.reason（不量化必须给原因）' }
    strength = { kind: 'NOT_QUANTIFIED', reason: s['reason'] }
  } else {
    return { rejected: 'bad_strength.kind（须为 QUALITATIVE|NOT_QUANTIFIED）' }
  }

  const core: Omit<EvidenceRelation, 'relation_id'> = {
    evidence: raw['evidence'] as SourceRef,
    target,
    polarity: polarity as EvidencePolarity,
    conditions,
    strength,
  }
  const derived = computeRelationId(core)
  if (raw['relation_id'] !== undefined) {
    if (raw['relation_id'] !== derived) return { rejected: 'relation_id_mismatch（身份由内容重算，不可手写冒充）' }
  }
  return { relation: { relation_id: derived, ...core } }
}

// ── 2. ArgumentRevision（不可变，同 L0 纪律） ───────────────────────────────

/**
 * 支持结构：LEAF=单个前提（允许联合 Observation/结果作前提，不要求和评分）；
 * AND=前提合取；OR=多条**替代**支持路径（各自独立成立）。
 */
export type SupportNode =
  | { type: 'LEAF'; premise: string }
  | { type: 'AND'; children: SupportNode[] }
  | { type: 'OR'; children: SupportNode[] }

export type ArgumentMethod = 'deductive' | 'inductive' | 'statistical' | 'abductive' | 'analogical' | 'causal'

const METHODS: readonly string[] = ['deductive', 'inductive', 'statistical', 'abductive', 'analogical', 'causal']

export interface ArgumentRevision {
  argument_id: string
  /** 'rev-0' 起；修订只增不减。 */
  revision_id: string
  claim: string
  support: SupportNode
  method: ArgumentMethod
  /** 适用范围声明；可 'UNKNOWN'，禁止编造。 */
  scope: string
  open_obligations: string[]
  /** 修订链：rev-1 起指向被修订的版本 `argument_id@rev`。 */
  based_on?: string[]
}

function cloneSupport(node: SupportNode): SupportNode {
  if (node.type === 'LEAF') return { type: 'LEAF', premise: node.premise }
  return { type: node.type, children: node.children.map(cloneSupport) }
}

/** 收集支持树的全部叶子前提文本。 */
export function supportLeaves(node: SupportNode): string[] {
  if (node.type === 'LEAF') return [node.premise]
  return node.children.flatMap(supportLeaves)
}

/** 顶层 OR 的各替代分支（非 OR 顶层返回单分支整树），供「受影响分支」追踪。 */
export function supportBranches(node: SupportNode): { index: number; leaves: string[] }[] {
  if (node.type !== 'OR') return [{ index: 0, leaves: supportLeaves(node) }]
  return node.children.map((child, index) => ({ index, leaves: supportLeaves(child) }))
}

function revisionNumber(revision_id: string): number {
  return Number(revision_id.replace('rev-', ''))
}

export interface ArgumentRevisionInput {
  argument_id?: string
  claim: string
  support: SupportNode
  method: ArgumentMethod
  scope?: string
  open_obligations?: string[]
}

/** 新建论证 = rev-0；scope 缺省 'UNKNOWN'（禁编造）；argument_id 缺省按内容稳定派生。 */
export function createArgumentRevision(input: ArgumentRevisionInput): ArgumentRevision {
  const support = cloneSupport(input.support)
  const scope = isNonEmptyString(input.scope) ? input.scope : 'UNKNOWN'
  return {
    argument_id: isNonEmptyString(input.argument_id) ? input.argument_id : stableId({ claim: input.claim, support }),
    revision_id: 'rev-0',
    claim: input.claim,
    support,
    method: input.method,
    scope,
    open_obligations: input.open_obligations ? [...input.open_obligations] : [],
    based_on: [],
  }
}

export type ArgumentPatch = Partial<Pick<ArgumentRevision, 'claim' | 'support' | 'method' | 'scope' | 'open_obligations'>>

/**
 * 修订 = 纯函数产**新对象**：rev+1、based_on 指旧版 `argument_id@rev`，
 * 未 patch 字段原值携带（深拷贝 support/obligations）。**原对象永不动**——
 * 负例测试对旧对象深冻结后 revise，要求不抛且逐字段不变。
 */
export function reviseArgument(old: ArgumentRevision, patch: ArgumentPatch): ArgumentRevision {
  const nextRev = revisionNumber(old.revision_id) + 1
  const next: ArgumentRevision = {
    argument_id: old.argument_id,
    revision_id: `rev-${nextRev}`,
    claim: patch.claim !== undefined ? patch.claim : old.claim,
    support: patch.support !== undefined ? cloneSupport(patch.support) : cloneSupport(old.support),
    method: patch.method !== undefined ? patch.method : old.method,
    scope: patch.scope !== undefined ? patch.scope : old.scope,
    open_obligations: patch.open_obligations !== undefined ? [...patch.open_obligations] : [...old.open_obligations],
    based_on: [`${old.argument_id}@${old.revision_id}`],
  }
  return next
}

/** method 词表核验（fixture 加载用；非法返回原因串）。 */
export function checkArgumentMethod(method: unknown): string | null {
  if (typeof method !== 'string' || !METHODS.includes(method)) return `bad_method（须为 ${METHODS.join('|')}）`
  return null
}

// ── 3. Assessment 状态历史（append-only） ──────────────────────────────────

/**
 * 攻击/确认记录。**导出面上没有删除/覆盖/改写 API**（负例测白名单）；
 * 「当前判断」只能由 latestFor 从追加序列派生。
 */
export interface AssessmentEntry {
  seq: number
  at_type: 'ATTACK' | 'CONFIRM'
  argument_id: string
  op: 'undercut' | 'rebut' | 'confirm'
  /** 受攻击对象（三形态，见 checkAttackTarget）；CONFIRM 恒等于 argument_id。 */
  target: string
  reason: string
  /** 确认必须可归因（P2 裁定同规）；攻击由 source 定位。 */
  actor?: string
  source: SourceRef
}

export interface AssessmentLog {
  /** 只增数组；没有任何导出函数能移除/改写已入账条目。 */
  entries: AssessmentEntry[]
}

export function createAssessmentLog(): AssessmentLog {
  return { entries: [] }
}

/**
 * 可攻击目标三形态（追踪「受攻击的是哪个论证/前提/适用性」）：
 *  1. `argument_id` 本身；2. `premise:<x>`；3. `applicability:<x>`。
 * 其余一律非法（返回拒因，调用方列 unresolved 账）。
 */
export function checkAttackTarget(target: unknown, argument_id: string): string | null {
  if (!isNonEmptyString(target)) return 'bad_target（须为非空字符串）'
  if (target === argument_id) return null
  if (target.startsWith('premise:') && target.length > 'premise:'.length) return null
  if (target.startsWith('applicability:') && target.length > 'applicability:'.length) return null
  return `bad_target_form: ${JSON.stringify(target)}（须 ∈ {argument_id, 'premise:'+x, 'applicability:'+x} 三形态之一）`
}

export interface RecordOutcome {
  recorded: boolean
  /** 成功入账时的条目 seq。 */
  seq?: number
  /** 被拒原因（入账失败必须列账，不静默）。 */
  unresolved?: string[]
}

export interface AttackRequest {
  argument_id: string
  op: 'undercut' | 'rebut'
  target: string
  reason: string
  source: SourceRef
}

/** 追加一条攻击记录。非法（op/target/source）→ 不记 + unresolved 列账。 */
export function recordAttack(log: AssessmentLog, req: AttackRequest): RecordOutcome {
  const unresolved: string[] = []
  if (req.op !== 'undercut' && req.op !== 'rebut') unresolved.push(`bad_op: ${JSON.stringify(req.op)}（须 undercut|rebut）`)
  const badTarget = checkAttackTarget(req.target, req.argument_id)
  if (badTarget) unresolved.push(badTarget)
  if (!isNonEmptyString(req.argument_id)) unresolved.push('bad_argument_id')
  if (!isNonEmptyString(req.reason)) unresolved.push('bad_reason（攻击理由必填，供人复核）')
  if (!isSourceRef(req.source)) unresolved.push('bad_source（须为可回源 {file,run_id,seq}）')
  if (unresolved.length > 0) return { recorded: false, unresolved }
  const seq = log.entries.length
  log.entries.push(Object.freeze({ seq, at_type: 'ATTACK' as const, ...req }))
  return { recorded: true, seq }
}

export interface ConfirmAttackLikeRequest {
  argument_id: string
  reason: string
  /** 确认人；缺省/空 → 拒记（无授权人不可归因，同 P2 裁定）。 */
  actor?: string
  source: SourceRef
}

/** 追加一条确认记录（target=论证本身）。actor 缺失 → 拒记列账。 */
export function recordConfirmation(log: AssessmentLog, req: ConfirmAttackLikeRequest): RecordOutcome {
  const unresolved: string[] = []
  if (!isNonEmptyString(req.actor)) unresolved.push('missing_actor（无授权人不可归因确认，宁不记不假记）')
  if (!isNonEmptyString(req.argument_id)) unresolved.push('bad_argument_id')
  if (!isNonEmptyString(req.reason)) unresolved.push('bad_reason')
  if (!isSourceRef(req.source)) unresolved.push('bad_source（须为可回源 {file,run_id,seq}）')
  if (unresolved.length > 0) return { recorded: false, unresolved }
  const seq = log.entries.length
  log.entries.push(Object.freeze({
    seq,
    at_type: 'CONFIRM' as const,
    argument_id: req.argument_id,
    op: 'confirm' as const,
    target: req.argument_id,
    reason: req.reason,
    actor: req.actor,
    source: req.source,
  }))
  return { recorded: true, seq }
}

/** 某论证的全部追加历史（按入账序）。 */
export function historyFor(log: AssessmentLog, argument_id: string): AssessmentEntry[] {
  return log.entries.filter((e) => e.argument_id === argument_id)
}

/** 派生「当前判断」= 该论证最后一条入账；无记录 → null（不猜）。 */
export function latestFor(log: AssessmentLog, argument_id: string): AssessmentEntry | null {
  const hist = historyFor(log, argument_id)
  return hist.length > 0 ? hist[hist.length - 1]! : null
}

// ── 4. FactStanding（本地、无生产影响） ────────────────────────────────────

export type FactStandingStatus = 'CANDIDATE' | 'CONTESTED' | 'SUSPENDED' | 'STANDING'

export interface FactHistoryRecord {
  seq: number
  standing: FactStandingStatus
  /** 推进 STANDING 的确认人（P2 同规：无 actor 不可归因）。 */
  by?: string
  via: SourceRef
}

export interface FactStanding {
  /** L0 `finding_id@rev` 或 claim id——只指已存在对象。 */
  fact_ref: string
  /** append-only 历史；**没有**从 report/LLM 分数自动生成记录的通道（无此类函数）。 */
  history: FactHistoryRecord[]
}

/** 新建 = CANDIDATE（默认且默认停留）。 */
export function createFactStanding(fact_ref: string, via: SourceRef): FactStanding {
  return { fact_ref, history: [Object.freeze({ seq: 0, standing: 'CANDIDATE' as const, via })] }
}

/**
 * 确认推进：只有**带 actor** 的显式确认能推 STANDING（brief 中
 * 「recordConfirmation(带 actor)」在 FactStanding 面的落点）。
 * actor 缺失 → 停留 + 列账，绝不静默升级。
 */
export function recordFactConfirmation(fs: FactStanding, req: { actor?: string; via: SourceRef }): RecordOutcome {
  if (!isNonEmptyString(req.actor)) {
    return { recorded: false, unresolved: ['missing_actor（确认停留 CANDIDATE）'] }
  }
  if (!isSourceRef(req.via)) return { recorded: false, unresolved: ['bad_via（须为可回源 {file,run_id,seq}）'] }
  const seq = fs.history.length
  fs.history.push(Object.freeze({ seq, standing: 'STANDING' as const, by: req.actor, via: req.via }))
  return { recorded: true, seq }
}

/** 攻击记账：CONTESTED（被疑）或 SUSPENDED（暂缓）——不删除历史。 */
export function recordFactAttack(fs: FactStanding, req: { mode: 'CONTESTED' | 'SUSPENDED'; via: SourceRef }): RecordOutcome {
  if (req.mode !== 'CONTESTED' && req.mode !== 'SUSPENDED') {
    return { recorded: false, unresolved: [`bad_mode: ${JSON.stringify(req.mode)}`] }
  }
  if (!isSourceRef(req.via)) return { recorded: false, unresolved: ['bad_via（须为可回源 {file,run_id,seq}）'] }
  const seq = fs.history.length
  fs.history.push(Object.freeze({ seq, standing: req.mode, via: req.via }))
  return { recorded: true, seq }
}

/** 派生当前 standing = 最后一条记录；空史（不可能）→ null。 */
export function currentStanding(fs: FactStanding): FactStandingStatus | null {
  return fs.history.length > 0 ? fs.history[fs.history.length - 1]!.standing : null
}
