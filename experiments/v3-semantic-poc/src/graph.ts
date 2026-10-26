/**
 * V3 PoC · P4 —— 双可重建图谱视图 + 自由组合读操作（合成 + 真实 GPT 运行素材）。
 *
 * 上游权威：docs/poc/V3_POC_EXECUTION_PLAN.md「P4」；设计裁定见 NOTES.md「P4 机制层」。
 *
 * 范围裁定（2026-10-26 用户裁定，写死）：PoC 素材 =「合成 + 真实 GPT 运行」
 * （strk-05/06 信封，samples/gpt-streak/envelopes.strk-05-live-nominal.jsonl /
 * strk-06-live-quaderr.jsonl）。#10 P4 的「脱敏真实任务四组人工标注 A/B」与
 * 「live task 侧车试运行」= 素材不存在 → **N/A（范围裁定）≠ PASS**；本文件是
 * 机械可测替代面，偏差如实标注。
 *
 * 核心纪律（与 P1/P2/P3 同源）：
 *  1. **可重建**：buildViews 是从同一批信封事件纯函数派生的两视图
 *     （inference / association），**无独立存储**；同一输入两次 build，
 *     canonicalize 后逐字节相同（负例②）。
 *  2. **Association 边类型闭集**：SAME_RUN / SHARED_ARTIFACT / SHARED_DECK /
 *     CROSS_RUN_BASIS / REGISTERED_FINDING / SOURCED_ASSOCIATION，超出即拒；
 *     SOURCED_ASSOCIATION 必须带 source 锚，无锚 → 拒收并列账（负例①），
 *     **弱边绝不升格**：edge.origin 在构造时一次定死，本模块不存在任何
 *     改写 origin / 改写 scope 的 API。
 *  3. **读操作无默认必查工作流**：queryView 只提供 start/direction/edgeTypes/
 *     maxHops/prune/limit 的自由组合；返回固定注记「关联不等于因果/已支持」；
 *     超限路径计数入账（truncated/dropped_count 真实，禁静默丢，负例③）。
 *  4. 缺失就是缺失：scope/version 无登记 → 'UNKNOWN' 字符串占位，禁止补全；
 *     provenance 逐边携带 SourceRef[]，可回源定位。
 *  5. 确定性：所有集合输出按字典序（node_id/edge_id/部件排序）；零
 *     Date.now / 随机；节点 id = stableId(run_id+seq+kind 部件)。
 *
 * 纯 TypeScript、零运行时依赖（仅 node 内置 + 本 PoC 既有模块）；不接线
 * src/host；仅可擦除 TS 语法。不声称任何 Gate 通过。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { canonicalize, parseEnvelopeFile } from './envelope.ts'
import type { EnvelopeEvent, Problem } from './envelope.ts'
import { stableId } from './semantics.ts'
import type { SourceRef } from './semantics.ts'

export const GRAPH_PROJECTION_VERSION = 'poc/graph-projection/v0'
export const UNKNOWN = 'UNKNOWN'

/** queryView 固定注记（常量——每次查询结果必带，防「图上可达=成立」误读）。 */
export const QUERY_NOTE = '关联不等于因果/已支持（固定注记：边只登记出处可回溯的关系，不携带真值）'

// ── 类型 ────────────────────────────────────────────────────────────────────

export type ViewName = 'inference' | 'association'

export type NodeKind =
  | 'run'
  | 'event'
  | 'assertion'
  | 'observation'
  | 'argument'
  | 'external_anchor'

export interface GraphNode {
  node_id: string
  kind: NodeKind
  run_id: string | null
  seq: number | null
  file: string | null
  /** 视图相关属性投影：inference 视图带 run_failed/channel/kind，
   *  association 视图带 artifact/deck sha 状态。属性归属即视图边界——
   *  某读法看不见某属性，就是该读法的真实盲区，不做跨视图补全。 */
  attrs: Record<string, unknown>
}

export type EdgeOrigin = 'STRUCTURAL' | 'REGISTERED' | 'SOURCED'

/** Inference 视图边类型闭集。EVIDENCE 带 polarity；CLAIM_BASIS=非 claim 推测事件的
 *  based_on 推得的 claim 级边（P3 scenario 缺位时的替代面，见 buildViews 注释）。 */
export const INFERENCE_EDGE_TYPES = ['EVIDENCE', 'CLAIM_BASIS', 'ARGUMENT_SUPPORT'] as const
export type InferenceEdgeType = (typeof INFERENCE_EDGE_TYPES)[number]

/** Association 视图边类型闭集（超出即拒，负例①的「超出」同样被拒）。 */
export const ASSOCIATION_EDGE_TYPES = [
  'SAME_RUN',
  'SHARED_ARTIFACT',
  'SHARED_DECK',
  'CROSS_RUN_BASIS',
  'REGISTERED_FINDING',
  'SOURCED_ASSOCIATION',
] as const
export type AssociationEdgeType = (typeof ASSOCIATION_EDGE_TYPES)[number]

export const ALL_EDGE_TYPES: readonly string[] = [...INFERENCE_EDGE_TYPES, ...ASSOCIATION_EDGE_TYPES]

export const EVIDENCE_POLARITIES = ['SUPPORTS', 'CONTRADICTS', 'CONTEXTUALIZES'] as const

export interface GraphEdge {
  edge_id: string
  edge_type: string
  from: string
  to: string
  origin: EdgeOrigin
  /** 仅 EVIDENCE 边携带；其余为 null。数值强度键在本层不存在（P3 同源纪律）。 */
  polarity: string | null
  provenance: SourceRef[]
  scope: string
  version: string
}

/** 无法回源解析的登记引用（例如 REGISTERED_FINDING 指向不存在的 run/seq）。
 *  不静默：列入视图账目，读操作可查。 */
export interface BrokenReference {
  edge_type: string
  at: SourceRef
  target: { run_id: string; seq: number }
  reason: string
}

/** 拒收账（负例①）：无锚 SOURCED_ASSOCIATION、未知边类型、无 actor 确认尝试等。 */
export interface Rejection {
  at: SourceRef
  edge_type: string
  reason: string
}

/** actor 确认记录（P2/P3 confirmation 面的图侧形态）：RESEARCHER_INFERENCE +
 *  payload.action='semantic_confirmation' + payload.actor 非空 +
 *  payload.confirming.claim_ref={run_id,seq} 指向已存在的 claim.candidate 事件。
 *  缺任一 → 不入确认账（列入 rejections），对应对象在 w3c 导出面永为 candidate。 */
export interface ConfirmationRecord {
  target_run_id: string
  target_seq: number
  actor: string
  via: SourceRef
}

/** 被严格解析整行拒绝的事件账（例如 based_on 断链）——inference 读法可据此
 *  检出「信封登记了 claim 但图中无断言节点」的结构性缺口。 */
export interface DroppedEvent {
  file: string
  run_id: string | null
  seq: number | null
  kind: string | null
  reasons: string[]
}

export interface GraphView {
  view: ViewName
  projection_version: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  broken_references: BrokenReference[]
  /** 两视图携带同一确认账（w3c 状态门依据；association 侧只读同份）。 */
  confirmations: ConfirmationRecord[]
}

export interface BuildResult {
  inference: GraphView
  association: GraphView
  rejections: Rejection[]
  dropped_events: DroppedEvent[]
  problems: (Problem & { file: string })[]
  stats: {
    files: number
    events_kept: number
    inference_nodes: number
    inference_edges: number
    association_nodes: number
    association_edges: number
    rejections: number
    broken_references: number
  }
}

// ── 小件 ────────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function eventId(runId: string, seq: number, kind: 'event' | 'assertion' | 'observation'): string {
  return stableId({ run_id: runId, seq, kind })
}

type BasedRef = number | { run_id: string; seq: number }

function collectBasedOnRefs(payload: Record<string, unknown>): BasedRef[] {
  const raw = payload['based_on']
  if (!Array.isArray(raw)) return []
  const refs: BasedRef[] = []
  for (const r of raw) {
    if (Number.isInteger(r)) refs.push(r as number)
    else if (isPlainObject(r) && isNonEmptyString(r['run_id']) && Number.isInteger(r['seq'])) {
      refs.push({ run_id: r['run_id'], seq: r['seq'] as number })
    }
  }
  return refs
}

/** payload 显式关系：payload.evidence=[{ref,relation}] 或 payload.relation。 */
function explicitRelation(payload: Record<string, unknown>, ref: BasedRef): string | null {
  const rel = payload['relation']
  if (typeof rel === 'string' && (EVIDENCE_POLARITIES as readonly string[]).includes(rel)) return rel
  const ev = payload['evidence']
  if (Array.isArray(ev)) {
    for (const item of ev) {
      if (!isPlainObject(item)) continue
      const r = item['ref']
      const same =
        (typeof r === 'number' && r === ref) ||
        (isPlainObject(r) && typeof ref === 'object' && r['run_id'] === ref.run_id && r['seq'] === ref.seq)
      if (same && typeof item['relation'] === 'string' &&
          (EVIDENCE_POLARITIES as readonly string[]).includes(item['relation'])) {
        return item['relation']
      }
    }
  }
  return null
}

function edgeOf(
  edge_type: string,
  from: string,
  to: string,
  origin: EdgeOrigin,
  polarity: string | null,
  provenance: SourceRef[],
  scope: string,
  version: string,
): GraphEdge {
  const sortedProv = [...provenance].sort((a, b) =>
    a.file === b.file ? (a.run_id === b.run_id ? a.seq - b.seq : a.run_id < b.run_id ? -1 : 1) : a.file < b.file ? -1 : 1)
  const edge_id = stableId({ edge_type, from, to, origin, polarity, provenance: sortedProv })
  return { edge_id, edge_type, from, to, origin, polarity, provenance: sortedProv, scope, version }
}

/** 视图边排序规则（w3c 导入侧同源复用，往返序一致）。 */
export function sortGraphEdges(edges: GraphEdge[]): GraphEdge[] {
  return [...edges].sort((a, b) =>
    a.edge_type === b.edge_type
      ? a.from === b.from
        ? a.to === b.to
          ? a.edge_id < b.edge_id
            ? -1
            : 1
          : a.to < b.to
            ? -1
            : 1
        : a.from < b.from
          ? -1
          : 1
      : a.edge_type < b.edge_type
        ? -1
        : 1)
}

function sortNodes(nodes: GraphNode[]): GraphNode[] {
  return [...nodes].sort((a, b) => (a.node_id === b.node_id ? 0 : a.node_id < b.node_id ? -1 : 1))
}

// ── buildViews ──────────────────────────────────────────────────────────────

interface LooseRow {
  file: string
  line: number
  run_id: string | null
  seq: number | null
  kind: string | null
}

/**
 * 从同一批信封文件（相对 baseDir 或绝对路径）确定性派生 inference/association
 * 两视图。**纯函数、无独立存储**：任何时刻以同批输入重建，canonicalize 后
 * 逐字节相同（负例②）。scenarioFiles（P3 场景文件，可选）存在时 argument
 * support 用显式声明的 ARGUMENT_SUPPORT 边；缺位时从 RESEARCHER_INFERENCE /
 * LLM_SUGGESTION 非 claim 事件的 based_on 推 claim 级 CLAIM_BASIS 边
 * （「派生≠证明」纪律不变：CLAIM_BASIS 只是边登记，不携带真值）。
 * 两趟 knownRuns 法（与 poc-run/verifyScenario 同源规则）：先宽松收集
 * run_id→seq 解析表，再严格解析跨文件 based_on。
 */
export function buildViews(files: readonly string[], baseDir: string, scenarioFiles: readonly string[] = []): BuildResult {
  const resolved = files.map((f) => path.resolve(baseDir, f)).sort()
  const rejections: Rejection[] = []
  const problems: (Problem & { file: string })[] = []
  const dropped: DroppedEvent[] = []

  // 第一趟（宽松）：knownRuns 解析表 + 行级元数据（供 dropped 账）。
  const knownRuns = new Map<string, Set<number>>()
  const looseByFile = new Map<string, LooseRow[]>()
  for (const abs of resolved) {
    const rel = path.relative(baseDir, abs) || path.basename(abs)
    let text = ''
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue // 不可读由第二趟严格解析记账
    }
    const rows: LooseRow[] = []
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim()
      if (line.length === 0) continue
      let v: unknown
      try {
        v = JSON.parse(line)
      } catch {
        continue
      }
      if (!isPlainObject(v)) continue
      const row: LooseRow = {
        file: rel,
        line: i + 1,
        run_id: isNonEmptyString(v['run_id']) ? v['run_id'] : null,
        seq: Number.isInteger(v['event_seq']) && (v['event_seq'] as number) >= 0 ? (v['event_seq'] as number) : null,
        kind: isNonEmptyString(v['kind']) ? v['kind'] : null,
      }
      rows.push(row)
      if (row.run_id !== null && row.seq !== null) {
        if (!knownRuns.has(row.run_id)) knownRuns.set(row.run_id, new Set())
        knownRuns.get(row.run_id)!.add(row.seq)
      }
    }
    looseByFile.set(abs, rows)
  }

  // 第二趟（严格）：parseEnvelopeFile（P0 复用）。
  const kept: { event: EnvelopeEvent; file: string; abs: string }[] = []
  const fileProblems = new Map<string, Problem[]>()
  for (const abs of resolved) {
    const rel = path.relative(baseDir, abs) || path.basename(abs)
    const r = parseEnvelopeFile(abs, { knownRuns })
    fileProblems.set(abs, r.problems)
    for (const p of r.problems) problems.push({ ...p, file: rel })
    for (const e of r.events) kept.push({ event: e, file: rel, abs })
  }
  // dropped 账：宽松行中未被严格解析保留的行。
  const keptKeys = new Set(kept.map((k) => `${k.event.run_id}#${k.event.event_seq}`))
  for (const abs of resolved) {
    const probs = fileProblems.get(abs) ?? []
    for (const row of looseByFile.get(abs) ?? []) {
      const key = `${row.run_id ?? '?'}#${row.seq ?? '?'}`
      if (row.run_id !== null && row.seq !== null && keptKeys.has(key)) continue
      const reasons = [...new Set(probs.filter((p) => p.line === row.line).map((p) => p.kind))].sort()
      dropped.push({ file: row.file, run_id: row.run_id, seq: row.seq, kind: row.kind, reasons })
    }
  }
  dropped.sort((a, b) =>
    a.file === b.file ? (a.seq ?? -1) - (b.seq ?? -1) : a.file < b.file ? -1 : 1)

  // run 结局（inference 视图属性：failed run 的证据资格是推理侧问题）。
  const runFailed = new Set<string>()
  for (const { event } of kept) {
    if (event.kind === 'run.failed') runFailed.add(event.run_id)
  }

  // ── 节点 ──
  const runIds = [...new Set(kept.map((k) => k.event.run_id))].sort()
  const runNodes: GraphNode[] = runIds.map((rid) => ({
    node_id: stableId({ run_id: rid, kind: 'run' }),
    kind: 'run' as NodeKind,
    run_id: rid,
    seq: null,
    file: null,
    attrs: {},
  }))
  const inferenceEventNodes: GraphNode[] = []
  const associationEventNodes: GraphNode[] = []
  const assertionNodes: GraphNode[] = []
  const observationNodes: GraphNode[] = []
  for (const { event, file } of kept) {
    const payload = isPlainObject(event.payload) ? event.payload : {}
    inferenceEventNodes.push({
      node_id: eventId(event.run_id, event.event_seq, 'event'),
      kind: 'event',
      run_id: event.run_id,
      seq: event.event_seq,
      file,
      attrs: { channel: event.channel, kind: event.kind, run_failed: runFailed.has(event.run_id) },
    })
    associationEventNodes.push({
      node_id: eventId(event.run_id, event.event_seq, 'event'),
      kind: 'event',
      run_id: event.run_id,
      seq: event.event_seq,
      file,
      attrs: {
        kind: event.kind,
        // sha 引用状态：artifact 关联键（SHARED_ARTIFACT 的键面）归 association 视图。
        artifact_sha: shaStatus(event, 'artifact'),
        deck_sha: shaStatus(event, 'deck'),
      },
    })
    if (event.kind === 'claim.candidate') {
      assertionNodes.push({
        node_id: eventId(event.run_id, event.event_seq, 'assertion'),
        kind: 'assertion',
        run_id: event.run_id,
        seq: event.event_seq,
        file,
        attrs: {
          claim_text: isNonEmptyString(payload['claim']) ? payload['claim'] : UNKNOWN,
          channel: event.channel,
          unknowns: Array.isArray(event.unknowns) ? event.unknowns : [],
        },
      })
    }
    if (event.kind === 'observation.recorded') {
      observationNodes.push({
        node_id: eventId(event.run_id, event.event_seq, 'observation'),
        kind: 'observation',
        run_id: event.run_id,
        seq: event.event_seq,
        file,
        attrs: { method: isNonEmptyString(payload['method']) ? payload['method'] : UNKNOWN },
      })
    }
  }

  // ── 确认账（actor 确认记录，w3c 状态门唯一依据）──
  const confirmations: ConfirmationRecord[] = []
  const claimKeys = new Set(kept.filter((k) => k.event.kind === 'claim.candidate').map((k) => `${k.event.run_id}#${k.event.event_seq}`))
  for (const { event, file } of kept) {
    const payload = isPlainObject(event.payload) ? event.payload : {}
    if (payload['action'] !== 'semantic_confirmation') continue
    const at: SourceRef = { file, run_id: event.run_id, seq: event.event_seq }
    const confirming = payload['confirming']
    const claimRef = isPlainObject(confirming) ? confirming['claim_ref'] : undefined
    const target = isPlainObject(claimRef) && isNonEmptyString(claimRef['run_id']) && Number.isInteger(claimRef['seq'])
      ? { run_id: claimRef['run_id'], seq: claimRef['seq'] as number }
      : null
    if (event.channel !== 'RESEARCHER_INFERENCE' || !isNonEmptyString(payload['actor']) || target === null ||
        !claimKeys.has(`${target?.run_id ?? ''}#${target?.seq ?? ''}`)) {
      rejections.push({
        at,
        edge_type: 'CONFIRMATION',
        reason: event.channel !== 'RESEARCHER_INFERENCE'
          ? 'wrong_channel'
          : !isNonEmptyString(payload['actor'])
            ? 'missing_actor（无授权人不可归因，宁 candidate 不 asserted）'
            : target === null
              ? 'missing_claim_ref'
              : 'unknown_target',
      })
      continue
    }
    confirmations.push({ target_run_id: target.run_id, target_seq: target.seq, actor: payload['actor'], via: at })
  }
  confirmations.sort((a, b) =>
    a.target_run_id === b.target_run_id
      ? a.target_seq - b.target_seq
      : a.target_run_id < b.target_run_id ? -1 : 1)

  // ── Inference 边 ──
  const inferenceEdges: GraphEdge[] = []
  const inferenceBroken: BrokenReference[] = []
  const eventNodeExists = (runId: string, seq: number): boolean =>
    kept.some((k) => k.event.run_id === runId && k.event.event_seq === seq)
  for (const { event, file } of kept) {
    const payload = isPlainObject(event.payload) ? event.payload : {}
    const channel = event.channel
    const refs = collectBasedOnRefs(payload)
    if (refs.length === 0) continue
    const scope = isNonEmptyString(payload['scope']) ? payload['scope'] : UNKNOWN
    const version = isNonEmptyString(payload['version']) ? payload['version'] : UNKNOWN
    const at: SourceRef = { file, run_id: event.run_id, seq: event.event_seq }
    const targetIsAssertion = event.kind === 'claim.candidate'
    const edgeType: InferenceEdgeType = targetIsAssertion ? 'EVIDENCE' : 'CLAIM_BASIS'
    if (channel !== 'RESEARCHER_INFERENCE' && channel !== 'LLM_SUGGESTION') continue // 推测/建议通道的 based_on 才成推理边
    for (const ref of refs) {
      const basis = typeof ref === 'number'
        ? { run_id: event.run_id, seq: ref }
        : ref
      if (!eventNodeExists(basis.run_id, basis.seq)) {
        // 断链不静默：列入 inference 视图 broken_references（P0 第二遍问题面在
        // 事件保留的情形下，这里是图的账目侧）。
        inferenceBroken.push({
          edge_type: edgeType,
          at,
          target: basis,
          reason: 'based_on_target_not_in_build',
        })
        continue
      }
      const polarity = targetIsAssertion ? explicitRelation(payload, ref) ?? 'SUPPORTS' : null
      inferenceEdges.push(edgeOf(
        edgeType,
        eventId(basis.run_id, basis.seq, 'event'),
        targetIsAssertion ? eventId(event.run_id, event.event_seq, 'assertion') : eventId(event.run_id, event.event_seq, 'event'),
        'REGISTERED',
        polarity,
        [at],
        scope,
        version,
      ))
    }
  }

  // scenario 文件（P3 场景）存在 → ARGUMENT_SUPPORT 显式边；argument/claim 节点入图。
  const argumentNodes: GraphNode[] = []
  for (const sf of [...scenarioFiles].map((f) => path.resolve(baseDir, f)).sort()) {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(sf, 'utf8'))
    } catch {
      rejections.push({ at: { file: path.relative(baseDir, sf) || sf, run_id: UNKNOWN, seq: -1 }, edge_type: 'ARGUMENT_SUPPORT', reason: 'scenario_unreadable' })
      continue
    }
    if (!isPlainObject(raw) || !isNonEmptyString(raw['scenario_id']) || !Array.isArray(raw['nodes']) || !Array.isArray(raw['paths']) || !isNonEmptyString(raw['claim'])) {
      rejections.push({ at: { file: path.relative(baseDir, sf) || sf, run_id: UNKNOWN, seq: -1 }, edge_type: 'ARGUMENT_SUPPORT', reason: 'scenario_shape_invalid' })
      continue
    }
    const scenarioId = raw['scenario_id']
    const rel = path.relative(baseDir, sf) || sf
    const nodeIdOf = (declNodeId: string): string => stableId({ scenario_id: scenarioId, node_id: declNodeId, kind: 'argument' })
    const declNodes = raw['nodes'].filter(isPlainObject)
    for (const dn of declNodes) {
      if (!isNonEmptyString(dn['node_id']) || !isNonEmptyString(dn['kind'])) continue
      argumentNodes.push({
        node_id: nodeIdOf(dn['node_id']),
        kind: 'argument',
        run_id: null,
        seq: null,
        file: rel,
        attrs: {
          scenario_id: scenarioId,
          decl_node_id: dn['node_id'],
          decl_kind: dn['kind'],
          source_ref: isPlainObject(dn['source_ref']) ? dn['source_ref'] : null,
          assumption_text: isNonEmptyString(dn['assumption_text']) ? dn['assumption_text'] : null,
        },
      })
    }
    const claimDecl = raw['claim']
    if (declNodes.some((n) => n['node_id'] === claimDecl)) {
      for (const p of raw['paths'].filter(isPlainObject)) {
        if (!Array.isArray(p['premises'])) continue
        for (const prem of p['premises']) {
          if (!isNonEmptyString(prem) || !declNodes.some((n) => n['node_id'] === prem)) continue
          inferenceEdges.push(edgeOf('ARGUMENT_SUPPORT', nodeIdOf(prem), nodeIdOf(claimDecl), 'REGISTERED', null,
            [{ file: rel, run_id: UNKNOWN, seq: -1 }], UNKNOWN, UNKNOWN))
        }
        if (isNonEmptyString(p['via_mechanism_of']) && declNodes.some((n) => n['node_id'] === p['via_mechanism_of'])) {
          inferenceEdges.push(edgeOf('ARGUMENT_SUPPORT', nodeIdOf(p['via_mechanism_of']), nodeIdOf(claimDecl), 'REGISTERED', null,
            [{ file: rel, run_id: UNKNOWN, seq: -1 }], UNKNOWN, UNKNOWN))
        }
      }
    }
  }

  // ── Association 边 ──
  const associationEdges: GraphEdge[] = []
  const broken: BrokenReference[] = []
  // SAME_RUN：结构边 run→event（origin STRUCTURAL——结构性永不改写）。
  for (const { event, file } of kept) {
    const payload = isPlainObject(event.payload) ? event.payload : {}
    associationEdges.push(edgeOf(
      'SAME_RUN',
      stableId({ run_id: event.run_id, kind: 'run' }),
      eventId(event.run_id, event.event_seq, 'event'),
      'STRUCTURAL',
      null,
      [{ file, run_id: event.run_id, seq: event.event_seq }],
      isNonEmptyString(payload['scope']) ? payload['scope'] : UNKNOWN,
      event.schema,
    ))
  }
  // SHARED_ARTIFACT / SHARED_DECK：跨 run 的 sha 引用同值（origin REGISTERED）。
  const shaGroups = new Map<string, { kind: 'artifact' | 'deck'; refs: { run_id: string; seq: number; file: string }[] }>()
  for (const { event, file } of kept) {
    for (const kind of ['artifact', 'deck'] as const) {
      const sha = eventSha(event, kind)
      if (sha === null) continue
      const key = `${kind}:${sha}`
      if (!shaGroups.has(key)) shaGroups.set(key, { kind, refs: [] })
      shaGroups.get(key)!.refs.push({ run_id: event.run_id, seq: event.event_seq, file })
    }
  }
  for (const key of [...shaGroups.keys()].sort()) {
    const group = shaGroups.get(key)!
    const refs = [...group.refs].sort((a, b) =>
      a.run_id === b.run_id ? a.seq - b.seq : a.run_id < b.run_id ? -1 : 1)
    const crossRuns = new Set(refs.map((r) => r.run_id))
    if (crossRuns.size < 2) continue // 同 run 内的共享由 SAME_RUN 结构覆盖，不重复成边
    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) {
        const a = refs[i]!
        const b = refs[j]!
        if (a.run_id === b.run_id) continue
        const na = eventId(a.run_id, a.seq, 'event')
        const nb = eventId(b.run_id, b.seq, 'event')
        const [from, to] = na < nb ? [na, nb] : [nb, na]
        associationEdges.push(edgeOf(
          group.kind === 'artifact' ? 'SHARED_ARTIFACT' : 'SHARED_DECK',
          from,
          to,
          'REGISTERED',
          null,
          [
            { file: a.file, run_id: a.run_id, seq: a.seq },
            { file: b.file, run_id: b.run_id, seq: b.seq },
          ],
          UNKNOWN,
          UNKNOWN,
        ))
      }
    }
  }
  // CROSS_RUN_BASIS：跨文件 based_on {run_id,seq}（origin REGISTERED）。
  const brokenSeen = new Set<string>()
  for (const { event, file } of kept) {
    const payload = isPlainObject(event.payload) ? event.payload : {}
    for (const ref of collectBasedOnRefs(payload)) {
      if (typeof ref === 'number' || ref.run_id === event.run_id) continue
      const at: SourceRef = { file, run_id: event.run_id, seq: event.event_seq }
      if (!eventNodeExists(ref.run_id, ref.seq)) {
        const bk = `CROSS_RUN_BASIS|${file}|${event.event_seq}|${ref.run_id}#${ref.seq}`
        if (!brokenSeen.has(bk)) {
          brokenSeen.add(bk)
          broken.push({ edge_type: 'CROSS_RUN_BASIS', at, target: ref, reason: 'target_run_or_seq_not_in_build' })
        }
        continue
      }
      associationEdges.push(edgeOf(
        'CROSS_RUN_BASIS',
        eventId(ref.run_id, ref.seq, 'event'),
        eventId(event.run_id, event.event_seq, 'event'),
        'REGISTERED',
        null,
        [at],
        isNonEmptyString(payload['scope']) ? payload['scope'] : UNKNOWN,
        isNonEmptyString(payload['version']) ? payload['version'] : UNKNOWN,
      ))
    }
  }
  // REGISTERED_FINDING：payload.finding = {about: [{run_id?, seq}]} 指向登记。
  for (const { event, file } of kept) {
    const payload = isPlainObject(event.payload) ? event.payload : {}
    const finding = payload['finding']
    if (!isPlainObject(finding) || !Array.isArray(finding['about'])) continue
    const at: SourceRef = { file, run_id: event.run_id, seq: event.event_seq }
    const scope = isNonEmptyString(finding['scope']) ? finding['scope'] : UNKNOWN
    const version = isNonEmptyString(finding['version']) ? finding['version'] : UNKNOWN
    for (const about of finding['about']) {
      if (!isPlainObject(about) || !Number.isInteger(about['seq'])) continue
      const targetRun = isNonEmptyString(about['run_id']) ? about['run_id'] : event.run_id
      const targetSeq = about['seq'] as number
      if (!eventNodeExists(targetRun, targetSeq)) {
        const bk = `REGISTERED_FINDING|${file}|${event.event_seq}|${targetRun}#${targetSeq}`
        if (!brokenSeen.has(bk)) {
          brokenSeen.add(bk)
          broken.push({ edge_type: 'REGISTERED_FINDING', at, target: { run_id: targetRun, seq: targetSeq }, reason: 'finding_points_to_nonexistent_event' })
        }
        continue
      }
      associationEdges.push(edgeOf(
        'REGISTERED_FINDING',
        eventId(event.run_id, event.event_seq, 'event'),
        eventId(targetRun, targetSeq, 'event'),
        'REGISTERED',
        null,
        [at],
        scope,
        version,
      ))
    }
  }
  // SOURCED_ASSOCIATION：payload.experience_association 显式「经验联想」记录，
  // **必须带 source 锚**；无锚 → 拒收并列账（负例①）。origin=SOURCED 永不可改写。
  const anchorNodes: GraphNode[] = []
  const anchorIds = new Map<string, string>()
  for (const { event, file } of kept) {
    const payload = isPlainObject(event.payload) ? event.payload : {}
    const assocs = payload['experience_association']
    if (!Array.isArray(assocs)) continue
    const at: SourceRef = { file, run_id: event.run_id, seq: event.event_seq }
    for (const item of assocs) {
      if (!isPlainObject(item)) continue
      const anchor = item['source']
      const anchored = anchorAnchorable(anchor)
      if (!anchored) {
        rejections.push({ at, edge_type: 'SOURCED_ASSOCIATION', reason: 'missing_source_anchor（经验联想必须带出处锚；无锚不入库）' })
        continue
      }
      let to: string
      const internal = internalAnchor(anchor)
      if (internal !== null && eventNodeExists(internal.run_id, internal.seq)) {
        to = eventId(internal.run_id, internal.seq, 'event')
      } else {
        const key = JSON.stringify(canonicalize(anchor))
        if (!anchorIds.has(key)) {
          const anchorId = stableId({ anchor: canonicalize(anchor), kind: 'external_anchor' })
          anchorIds.set(key, anchorId)
          anchorNodes.push({
            node_id: anchorId,
            kind: 'external_anchor',
            run_id: null,
            seq: null,
            file: isPlainObject(anchor) && isNonEmptyString(anchor['file']) ? anchor['file'] : null,
            attrs: { anchor: canonicalize(anchor) },
          })
        }
        to = anchorIds.get(key)!
      }
      associationEdges.push(edgeOf(
        'SOURCED_ASSOCIATION',
        eventId(event.run_id, event.event_seq, 'event'),
        to,
        'SOURCED',
        null,
        [at],
        isPlainObject(anchor) && isNonEmptyString(anchor['scope']) ? anchor['scope'] : UNKNOWN,
        isPlainObject(anchor) && isNonEmptyString(anchor['version']) ? anchor['version'] : UNKNOWN,
      ))
    }
  }

  rejections.sort((a, b) =>
    a.at.file === b.at.file
      ? a.at.run_id === b.at.run_id
        ? a.at.seq === b.at.seq
          ? a.edge_type < b.edge_type ? -1 : a.edge_type > b.edge_type ? 1 : (a.reason < b.reason ? -1 : 1)
          : a.at.seq - b.at.seq
        : a.at.run_id < b.at.run_id ? -1 : 1
      : a.at.file < b.at.file ? -1 : 1)
  broken.sort((a, b) =>
    a.at.file === b.at.file
      ? a.at.seq === b.at.seq
        ? a.edge_type < b.edge_type ? -1 : 1
        : a.at.seq - b.at.seq
      : a.at.file < b.at.file ? -1 : 1)
  inferenceBroken.sort((a, b) =>
    a.at.file === b.at.file
      ? a.at.seq === b.at.seq
        ? a.edge_type === b.edge_type
          ? a.target.run_id === b.target.run_id
            ? a.target.seq - b.target.seq
            : a.target.run_id < b.target.run_id ? -1 : 1
          : a.edge_type < b.edge_type ? -1 : 1
        : a.at.seq - b.at.seq
      : a.at.file < b.at.file ? -1 : 1)
  problems.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))

  const inferenceView: GraphView = {
    view: 'inference',
    projection_version: GRAPH_PROJECTION_VERSION,
    nodes: sortNodes([...inferenceEventNodes, ...assertionNodes, ...observationNodes, ...runNodes, ...argumentNodes]),
    edges: sortGraphEdges(dedupeEdges(inferenceEdges)),
    broken_references: inferenceBroken,
    confirmations,
  }
  const associationView: GraphView = {
    view: 'association',
    projection_version: GRAPH_PROJECTION_VERSION,
    nodes: sortNodes([...associationEventNodes, ...runNodes, ...anchorNodes]),
    edges: sortGraphEdges(dedupeEdges(associationEdges)),
    broken_references: broken,
    confirmations,
  }

  return {
    inference: inferenceView,
    association: associationView,
    rejections,
    dropped_events: dropped,
    problems,
    stats: {
      files: resolved.length,
      events_kept: kept.length,
      inference_nodes: inferenceView.nodes.length,
      inference_edges: inferenceView.edges.length,
      association_nodes: associationView.nodes.length,
      association_edges: associationView.edges.length,
      rejections: rejections.length,
      broken_references: broken.length + inferenceBroken.length,
    },
  }
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>()
  const out: GraphEdge[] = []
  for (const e of edges) {
    if (seen.has(e.edge_id)) continue
    seen.add(e.edge_id)
    out.push(e)
  }
  return out
}

/** sha 引用提取：deck=deck 类 snapshot_ref/payload.deck_sha256；
 *  artifact=file 类 snapshot_ref/payload.gdf_sha256/payload.sha256。 */
function eventSha(event: EnvelopeEvent, kind: 'artifact' | 'deck'): string | null {
  const payload = isPlainObject(event.payload) ? event.payload : {}
  const ref = event.snapshot_ref
  const sha = isPlainObject(ref) ? ref['content_sha256'] : null
  if (kind === 'deck') {
    if (isPlainObject(ref) && ref['kind'] === 'deck' && isNonEmptyString(sha)) return sha
    const d = payload['deck_sha256']
    return isNonEmptyString(d) ? d : null
  }
  if (isPlainObject(ref) && ref['kind'] === 'file' && isNonEmptyString(sha)) return sha
  for (const k of ['gdf_sha256', 'sha256']) {
    const v = payload[k]
    if (isNonEmptyString(v)) return v
  }
  return null
}

function shaStatus(event: EnvelopeEvent, kind: 'artifact' | 'deck'): 'present' | 'missing_unanchored' | 'absent' {
  if (eventSha(event, kind) !== null) return 'present'
  // 键在场但为 null 且 unknowns 空 = 缺锚缺失（SPEC 规则 2 的「null 要配 unknowns 指路」）
  const payload = isPlainObject(event.payload) ? event.payload : {}
  const ref = isPlainObject(event.snapshot_ref) ? event.snapshot_ref : null
  const keyNull =
    (kind === 'artifact' && (ref?.['kind'] === 'file' && ref['content_sha256'] === null || payload['gdf_sha256'] === null || payload['sha256'] === null)) ||
    (kind === 'deck' && (ref?.['kind'] === 'deck' && ref['content_sha256'] === null || payload['deck_sha256'] === null))
  if (keyNull && Array.isArray(event.unknowns) && event.unknowns.length === 0) return 'missing_unanchored'
  return 'absent'
}

/** source 锚判定：非空字符串，或含 file/url/run_id/sha 任一定位键的对象。 */
function anchorAnchorable(anchor: unknown): boolean {
  if (isNonEmptyString(anchor)) return true
  if (!isPlainObject(anchor)) return false
  return ['file', 'url', 'run_id', 'sha256'].some((k) => isNonEmptyString(anchor[k]))
}

function internalAnchor(anchor: unknown): { run_id: string; seq: number } | null {
  if (!isPlainObject(anchor)) return null
  if (isNonEmptyString(anchor['run_id']) && Number.isInteger(anchor['seq'])) {
    return { run_id: anchor['run_id'], seq: anchor['seq'] as number }
  }
  return null
}

// ── queryView：自由组合读操作（无默认必查工作流）───────────────────────────

export interface Query {
  start: string
  direction: 'out' | 'in' | 'both'
  /** 本视图边类型闭集的子集；超出即拒（throw，含闭集清单）。缺省=全集。 */
  edgeTypes?: readonly string[]
  maxHops: number
  prune?: (edge: GraphEdge) => boolean
  limit?: number
}

export interface QueryPath {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface QueryResult {
  paths: QueryPath[]
  truncated: boolean
  dropped_count: number
  note: string
}

const QUERY_DEFAULT_LIMIT = 50
const QUERY_ENUM_CAP = 5000 // 内部枚举上限；超限同样计入 dropped_count（禁静默丢）

/**
 * 从 start 节点做简单路径枚举（深度 ≤ maxHops，1..6），按 (跳深, 边类型, 目标
 * node_id) 确定性序输出前 limit 条；truncated/dropped_count 为真实计数：
 * 凡未返回的合法路径一律入账，不存在静默丢弃（负例③）。
 */
export function queryView(view: GraphView, q: Query): QueryResult {
  const closedSet = view.view === 'inference' ? INFERENCE_EDGE_TYPES : ASSOCIATION_EDGE_TYPES
  if (!Number.isInteger(q.maxHops) || q.maxHops < 1 || q.maxHops > 6) {
    throw new Error(`QUERY_INVALID: maxHops 必须为 1..6 整数，实际 ${String(q.maxHops)}`)
  }
  const typeSet = q.edgeTypes ? [...q.edgeTypes] : [...closedSet]
  for (const t of typeSet) {
    if (!(closedSet as readonly string[]).includes(t)) {
      throw new Error(`QUERY_UNKNOWN_EDGE_TYPE: "${t}" 不在 ${view.view} 视图闭集 [${[...closedSet].join(', ')}] 内`)
    }
  }
  const nodeById = new Map(view.nodes.map((n) => [n.node_id, n]))
  const startNode = nodeById.get(q.start)
  if (!startNode) throw new Error(`QUERY_START_NOT_FOUND: ${q.start}`)
  const limit = q.limit ?? QUERY_DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 0) throw new Error(`QUERY_INVALID: limit 必须为非负整数，实际 ${String(q.limit)}`)
  const types = new Set(typeSet)
  const adjacency: { edge: GraphEdge; next: string }[] = []
  for (const e of view.edges) {
    if (!types.has(e.edge_type)) continue
    if (q.direction === 'out' && e.from === q.start) adjacency.push({ edge: e, next: e.to })
    if (q.direction === 'in' && e.to === q.start) adjacency.push({ edge: e, next: e.from })
    if (q.direction === 'both' && (e.from === q.start || e.to === q.start)) {
      adjacency.push({ edge: e, next: e.from === q.start ? e.to : e.from })
    }
  }
  // 全图邻接（多跳展开用），确定性序：edge_type → 边端点字典序。
  const adjAll = new Map<string, { edge: GraphEdge; next: string }[]>()
  for (const e of view.edges) {
    if (!types.has(e.edge_type)) continue
    const outEntry = { edge: e, next: e.to }
    const inEntry = { edge: e, next: e.from }
    if (!adjAll.has(e.from)) adjAll.set(e.from, [])
    adjAll.get(e.from)!.push(outEntry)
    if (q.direction === 'both' || q.direction === 'in') {
      if (!adjAll.has(e.to)) adjAll.set(e.to, [])
      adjAll.get(e.to)!.push(inEntry)
    }
  }
  for (const list of adjAll.values()) {
    list.sort((a, b) =>
      a.edge.edge_type === b.edge.edge_type
        ? a.next === b.next
          ? a.edge.edge_id < b.edge.edge_id ? -1 : 1
          : a.next < b.next ? -1 : 1
        : a.edge.edge_type < b.edge.edge_type ? -1 : 1)
  }

  const paths: QueryPath[] = []
  let total = 0
  let capped = false
  const visitedOnPath = new Set<string>([q.start])
  const pathEdges: GraphEdge[] = []
  const pathNodes: GraphNode[] = [startNode]

  const walk = (nodeId: string, depth: number): void => {
    if (depth === 0 || capped) return
    const entries = adjAll.get(nodeId) ?? []
    for (const { edge, next } of entries) {
      if (visitedOnPath.has(next)) continue // 简单路径
      if (q.prune && !q.prune(edge)) continue
      if (!nodeById.has(next)) continue
      total++
      if (total > QUERY_ENUM_CAP) { capped = true; return } // 枚举上限同样计入 dropped（禁静默丢）
      const record = total <= limit
      if (record) {
        pathEdges.push(edge)
        pathNodes.push(nodeById.get(next)!)
      }
      visitedOnPath.add(next)
      if (record) paths.push({ nodes: [...pathNodes], edges: [...pathEdges] })
      walk(next, depth - 1)
      visitedOnPath.delete(next)
      if (record) {
        pathEdges.pop()
        pathNodes.pop()
      }
      if (capped) return
    }
  }
  // 首跳直接走邻接表（start 的定向展开），其后走全图邻接。
  // 超出 limit 的路径继续枚举（受枚举上限保护）但只计数不记录——truncated 与
  // dropped_count 因此是真实计数。输出序 = 确定性 DFS 前序（邻接已按
  // edge_type→目标 node_id 字典序排定）。
  for (const { edge, next } of adjacency) {
    if (visitedOnPath.has(next)) continue
    if (q.prune && !q.prune(edge)) continue
    if (!nodeById.has(next)) continue
    total++
    if (total > QUERY_ENUM_CAP) { capped = true; break }
    const record = total <= limit
    if (record) {
      pathEdges.push(edge)
      pathNodes.push(nodeById.get(next)!)
    }
    visitedOnPath.add(next)
    if (record) paths.push({ nodes: [...pathNodes], edges: [...pathEdges] })
    walk(next, q.maxHops - 1)
    visitedOnPath.delete(next)
    if (record) {
      pathEdges.pop()
      pathNodes.pop()
    }
    if (capped) break
  }

  return {
    paths,
    truncated: total > paths.length,
    dropped_count: total - paths.length,
    note: QUERY_NOTE,
  }
}
