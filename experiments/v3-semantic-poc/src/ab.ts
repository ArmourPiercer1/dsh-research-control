/**
 * V3 PoC · P4 —— 机械召回对照（四读法 × 机器植入答案键）。
 *
 * 范围裁定（2026-10-26 用户裁定，写死）：PoC 素材 =「合成 + 真实 GPT 运行」
 * （strk-05/06 信封）。#10 P4 的「脱敏真实任务四组人工标注 A/B」与「live task
 * 侧车试运行」= 素材不存在 → **N/A（范围裁定）≠ PASS**；本文件是机械可测替代面。
 *
 * **偏差声明（输出 JSON 同样写死）**：本对照测量的是「机器从该读法可达的植入
 * 缺口」（planted.json 机器植入答案键 + 机械可达性判定），**不是人类问题发现
 * 质量**，不外推到任何人类场景结论。
 *
 * 四读法（统一返回 {hits, extras, cost}）：
 *  - rawScan：纯 payload 文本线性扫描（每文件单趟、仅前向、逐行 JSON 文本级
 *    谓词；无索引、无跨行联键、无图）。
 *  - inferenceOnly：只读 inference 视图（参数类型收窄到 Pick<…,'inference'|
 *    'dropped_events'|'problems'>，TS 层面就拿不到 association 视图）+
 *    queryView 自由组合。
 *  - associationOnly：只读 association 视图 + 拒收账 + broken_references 账。
 *  - bothAlternating：两视图检测器**交替**执行（非合并图），并集去重。
 * 视图属性投影即读法边界：某读法看不见某属性就是真实盲区，不做跨视图补全
 * （例：artifact sha 状态只在 association 投影面；run 失败结局只在
 * inference 投影面）。hits 一律回锚答案键定位（run_id#seq / run 对）；
 * 不可回锚的检出列入 extras 不冒充缺口；resolvable_source 逐 hit 真实标注
 * （断链检出一律 false）。
 * 确定性：文件/检出/命中全部排序输出；零 Date.now/随机。
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { buildViews, queryView } from './graph.ts'
import type { BuildResult, GraphNode } from './graph.ts'
import type { SourceRef } from './semantics.ts'

export const AB_STUDY_VERSION = 'poc/ab-study/v0'

export const DEVIATION_STATEMENT =
  '测量的是「机器从该读法可达的植入缺口」（机器植入答案键），不是人类问题发现质量；' +
  '素材为合成任务包 +（挂接面）真实 GPT 运行信封；#10 P4 人工标注 A/B 与 live 侧车 = N/A（范围裁定）≠ PASS。'

export interface GapRef {
  run_id: string
  seq: number | null
}

export interface PlantedGap {
  gap_id: string
  gap_kind: string
  note: string
  ground_truth: string[]
  location: { refs: GapRef[] }
  resolvable_source_expected?: boolean
}

export interface PlantedKey {
  answer_key_version: string
  deviation_statement: string
  gaps: PlantedGap[]
}

export interface Finding {
  gap_kind: string
  location_key: string
  refs: GapRef[]
  provenance: SourceRef[]
  resolvable_source: boolean
  detail: string
}

export interface Hit {
  gap_id: string
  resolvable_source: boolean
}

export interface ReadResult {
  hits: Hit[]
  extras: Finding[]
  cost: { queries: number; nodes_visited: number }
}

export interface GapMatrixRow {
  gap_id: string
  gap_kind: string
  rawScan: boolean
  inferenceOnly: boolean
  associationOnly: boolean
  bothAlternating: boolean
}

export interface AbStudyResult {
  study_version: string
  deviation_statement: string
  corpus: { dir: string; files: string[]; events_kept: number; gaps_planted: number }
  readings: {
    rawScan: ReadResult
    inferenceOnly: ReadResult
    associationOnly: ReadResult
    bothAlternating: ReadResult
  }
  gap_matrix: GapMatrixRow[]
  per_read_detection_rate: Record<'rawScan' | 'inferenceOnly' | 'associationOnly' | 'bothAlternating', { detected: number; planted: number }>
}

// ── 公共小件 ────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function locationKeyOf(kind: string, refs: readonly GapRef[]): string {
  const parts = refs.map((r) => (r.seq === null || r.seq === undefined ? r.run_id : `${r.run_id}#${r.seq}`)).sort()
  return `${kind}|${parts.join('+')}`
}

export function loadAnswerKey(corpusDir: string): PlantedKey {
  const raw = JSON.parse(readFileSync(path.join(corpusDir, 'planted.json'), 'utf8')) as unknown
  if (!isPlainObject(raw) || !Array.isArray(raw['gaps'])) throw new Error(`AB_KEY_INVALID: ${corpusDir}/planted.json`)
  return raw as unknown as PlantedKey
}

function keyIndex(key: PlantedKey): Map<string, PlantedGap> {
  const m = new Map<string, PlantedGap>()
  for (const g of key.gaps) m.set(locationKeyOf(g.gap_kind, g.location.refs), g)
  return m
}

function toReadResult(
  findings: Finding[],
  key: PlantedKey,
  cost: { queries: number; nodes_visited: number },
): ReadResult {
  const idx = keyIndex(key)
  const hits: Hit[] = []
  const extras: Finding[] = []
  const seenGap = new Set<string>()
  for (const f of findings) {
    const gap = idx.get(f.location_key)
    if (gap) {
      if (seenGap.has(gap.gap_id)) continue // 同缺口多检出只计一次（检出率语义）
      seenGap.add(gap.gap_id)
      hits.push({ gap_id: gap.gap_id, resolvable_source: f.resolvable_source })
    } else {
      extras.push(f)
    }
  }
  hits.sort((a, b) => (a.gap_id === b.gap_id ? 0 : a.gap_id < b.gap_id ? -1 : 1))
  extras.sort((a, b) => (a.location_key === b.location_key ? (a.detail < b.detail ? -1 : 1) : a.location_key < b.location_key ? -1 : 1))
  return { hits, extras, cost }
}

function finding(kind: string, refs: GapRef[], provenance: SourceRef[], resolvable: boolean, detail: string): Finding {
  return { gap_kind: kind, location_key: locationKeyOf(kind, refs), refs, provenance, resolvable_source: resolvable, detail }
}

/** source 锚判定（与 graph.ts 同一规则的本文件局部镜像——rawScan 无图权限）。 */
function anchoredLocally(anchor: unknown): boolean {
  if (typeof anchor === 'string' && anchor.length > 0) return true
  if (!isPlainObject(anchor)) return false
  return ['file', 'url', 'run_id', 'sha256'].some((k) => typeof anchor[k] === 'string' && (anchor[k] as string).length > 0)
}

// ── 读法 1：rawScan（纯文本线性扫描，无图）──────────────────────────────────

/**
 * 每文件**单趟前向**扫描：逐行 JSON 文本级谓词，仅允许行内字段与「本文件
 * 已见过的最大 event_seq」这一行序状态；禁止跨文件联键、禁止建边、禁止回看。
 */
export function rawScan(corpusDir: string): ReadResult {
  const key = loadAnswerKey(corpusDir)
  const files = readdirSync(corpusDir).filter((f) => f.endsWith('.jsonl')).sort()
  const findings: Finding[] = []
  let nodesVisited = 0
  for (const f of files) {
    const text = readFileSync(path.join(corpusDir, f), 'utf8')
    let maxSeqSoFar = -1
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim()
      if (line.length === 0) continue
      nodesVisited++
      let v: unknown
      try {
        v = JSON.parse(line)
      } catch {
        continue
      }
      if (!isPlainObject(v)) continue
      const runId = typeof v['run_id'] === 'string' ? v['run_id'] : null
      const seq = Number.isInteger(v['event_seq']) ? (v['event_seq'] as number) : null
      if (seq !== null && seq > maxSeqSoFar) maxSeqSoFar = seq // 前向状态：只增不回看
      if (runId === null || seq === null) continue
      const at: SourceRef = { file: f, run_id: runId, seq }
      const payload = isPlainObject(v['payload']) ? v['payload'] : {}
      const kind = typeof v['kind'] === 'string' ? v['kind'] : ''
      const channel = typeof v['channel'] === 'string' ? v['channel'] : ''

      // 谓词 1：推测/建议通道 based_on 整数引用 > 本文件已见最大 seq（断链，前向可判）。
      if ((channel === 'RESEARCHER_INFERENCE' || channel === 'LLM_SUGGESTION') && Array.isArray(payload['based_on'])) {
        const bad = (payload['based_on'] as unknown[]).filter((r) => Number.isInteger(r) && (r as number) > maxSeqSoFar) as number[]
        if (bad.length > 0) {
          findings.push(finding('dangling_based_on', [{ run_id: runId, seq }], [at], true, `based_on 整数引用 ${bad.join(',')} 超过本文件已见最大 seq ${maxSeqSoFar}`))
        }
      }
      // 谓词 2：experience_association 条目缺 source 锚（行内可见）。
      if (Array.isArray(payload['experience_association'])) {
        const missing = (payload['experience_association'] as unknown[]).filter((a) => !anchoredLocally(isPlainObject(a) ? a['source'] : undefined))
        if (missing.length > 0) {
          findings.push(finding('anchorless_association', [{ run_id: runId, seq }], [at], true, `${missing.length} 条经验联想无 source 锚`))
        }
      }
      // 谓词 3：artifact.registered 的 content_sha256=null 且 unknowns 空。
      const ref = isPlainObject(v['snapshot_ref']) ? v['snapshot_ref'] : null
      if (kind === 'artifact.registered' && ref?.['content_sha256'] === null && Array.isArray(v['unknowns']) && (v['unknowns'] as unknown[]).length === 0) {
        findings.push(finding('artifact_sha_unanchored', [{ run_id: runId, seq }], [at], true, 'content_sha256=null 且 unknowns 空（无指路）'))
      }
      // 谓词 4：claim 行内显式关系字段全部非 SUPPORTS（行内可见；无显式关系字段
      // 的行 rawScan 不猜测默认极性）。
      if (kind === 'claim.candidate') {
        const explicit: string[] = []
        if (typeof payload['relation'] === 'string') explicit.push(payload['relation'])
        if (Array.isArray(payload['evidence'])) {
          for (const e of payload['evidence'] as unknown[]) if (isPlainObject(e) && typeof e['relation'] === 'string') explicit.push(e['relation'])
        }
        if (explicit.length > 0 && !explicit.includes('SUPPORTS')) {
          findings.push(finding('no_support_evidence', [{ run_id: runId, seq }], [at], true, `显式关系 [${explicit.join(',')}] 无 SUPPORTS`))
        }
      }
    }
  }
  return toReadResult(findings, key, { queries: files.length, nodes_visited: nodesVisited })
}

// ── 读法 2：inferenceOnly（只读 inference 视图 + dropped 账）────────────────

export type InferenceAccess = Pick<BuildResult, 'inference' | 'dropped_events' | 'problems'>

export function inferenceFindings(build: InferenceAccess): { findings: Finding[]; cost: { queries: number; nodes_visited: number } } {
  const findings: Finding[] = []
  let queries = 0
  let nodesVisited = 0
  for (const d of build.dropped_events) nodesVisited++
  // 检测器 1：based_on 断链——两种形态都入账，不静默：
  //  a) claim 整行被严格解析拒收（P0 第一遍问题）→ dropped 账；
  //  b) claim 事件保留、但 based_on 目标不在 build 内（P0 第二遍仅记文件级
  //     问题）→ inference 视图 broken_references 账。
  for (const d of build.dropped_events) {
    if (d.kind !== 'claim.candidate' || d.run_id === null || d.seq === null) continue
    if (!d.reasons.includes('dangling_based_on')) continue
    findings.push(finding('dangling_based_on', [{ run_id: d.run_id, seq: d.seq }], [{ file: d.file, run_id: d.run_id, seq: d.seq }], true, 'claim.candidate 整行被拒收（dangling_based_on），推理图中无对应断言节点'))
  }
  const view = build.inference
  for (const br of view.broken_references) {
    if (br.edge_type !== 'EVIDENCE' && br.edge_type !== 'CLAIM_BASIS') continue
    findings.push(finding('dangling_based_on', [{ run_id: br.at.run_id, seq: br.at.seq }], [br.at], true, `based_on 引用 ${br.target.run_id}#${br.target.seq} 不可回源（${br.reason}）`))
  }
  const nodeById = new Map<string, GraphNode>(view.nodes.map((n) => [n.node_id, n]))
  for (const n of view.nodes) {
    nodesVisited++
    if (n.kind !== 'assertion' || n.run_id === null || n.seq === null) continue
    const at: SourceRef = { file: n.file ?? '', run_id: n.run_id, seq: n.seq }
    queries++
    const q = queryView(view, { start: n.node_id, direction: 'in', edgeTypes: ['EVIDENCE'], maxHops: 1 })
    const inEdges = q.paths.map((p) => p.edges[0]!)
    nodesVisited += q.paths.reduce((s, p) => s + p.nodes.length, 0)
    // 检测器 2：断言入边存在但无一 SUPPORTS（支持关系缺失）。
    if (inEdges.length > 0 && !inEdges.some((e) => e.polarity === 'SUPPORTS')) {
      findings.push(finding('no_support_evidence', [{ run_id: n.run_id, seq: n.seq }], [at], true, `入边极性 [${inEdges.map((e) => e.polarity).join(',')}] 无 SUPPORTS`))
    }
    // 检测器 3：证据边源事件位于失败运行（run_failed 是 inference 投影属性）。
    for (const e of inEdges) {
      const basis = nodeById.get(e.from)
      if (basis && basis.attrs['run_failed'] === true) {
        findings.push(finding('failed_run_basis', [{ run_id: n.run_id, seq: n.seq }], [at], true, `证据边 ${e.from} 源事件所在 run 已登记 run.failed`))
        break
      }
    }
  }
  return { findings, cost: { queries, nodes_visited: nodesVisited } }
}

export function inferenceOnly(corpusDir: string, build: InferenceAccess): ReadResult {
  const key = loadAnswerKey(corpusDir)
  const { findings, cost } = inferenceFindings(build)
  return toReadResult(findings, key, cost)
}

// ── 读法 3：associationOnly（只读 association 视图 + 账目）───────────────────

export type AssociationAccess = Pick<BuildResult, 'association' | 'rejections' | 'problems'>

export function associationFindings(build: AssociationAccess): { findings: Finding[]; cost: { queries: number; nodes_visited: number } } {
  const findings: Finding[] = []
  let queries = 0
  let nodesVisited = 0
  const view = build.association
  const nodeById = new Map<string, GraphNode>(view.nodes.map((n) => [n.node_id, n]))
  // 检测器 1：无锚经验联想（拒收账）。
  for (const r of build.rejections) {
    nodesVisited++
    if (r.edge_type !== 'SOURCED_ASSOCIATION') continue
    findings.push(finding('anchorless_association', [{ run_id: r.at.run_id, seq: r.at.seq }], [r.at], true, `拒收账：${r.reason}`))
  }
  // 检测器 2：artifact sha 缺锚缺失（association 投影属性）。
  for (const n of view.nodes) {
    nodesVisited++
    if (n.kind !== 'event' || n.attrs['kind'] !== 'artifact.registered') continue
    if (n.attrs['artifact_sha'] !== 'missing_unanchored') continue
    findings.push(finding('artifact_sha_unanchored', [{ run_id: n.run_id!, seq: n.seq! }], [{ file: n.file ?? '', run_id: n.run_id!, seq: n.seq! }], true, 'artifact sha 缺锚缺失（unknowns 无指路）'))
  }
  // 检测器 3：共享 deck 但两 run 之间无 REGISTERED_FINDING（机制未登记）。
  const deckEdges = view.edges.filter((e) => e.edge_type === 'SHARED_DECK')
  const pairs = new Set<string>()
  for (const e of deckEdges) {
    nodesVisited++
    const ra = nodeById.get(e.from)?.run_id
    const rb = nodeById.get(e.to)?.run_id
    if (!ra || !rb || ra === rb) continue
    pairs.add([ra, rb].sort().join('|'))
  }
  for (const pair of [...pairs].sort()) {
    const [ra, rb] = pair.split('|') as [string, string]
    queries++
    const hasMechanism = view.edges.some((e) => {
      if (e.edge_type !== 'REGISTERED_FINDING') return false
      const fa = nodeById.get(e.from)?.run_id
      const fb = nodeById.get(e.to)?.run_id
      return (fa === ra && fb === rb) || (fa === rb && fb === ra)
    })
    if (!hasMechanism) {
      const anchor = deckEdges[0]!
      findings.push(finding('shared_deck_no_mechanism', [{ run_id: ra, seq: null }, { run_id: rb, seq: null }],
        anchor.provenance.slice(0, 1).map((p) => ({ ...p })), true, 'SHARED_DECK 边在场但两 run 间无 REGISTERED_FINDING（机制/统计读数未登记）'))
    }
  }
  // 检测器 4：REGISTERED_FINDING 指向不存在对象（broken 账；resolvable_source=false）。
  for (const br of view.broken_references) {
    nodesVisited++
    if (br.edge_type !== 'REGISTERED_FINDING') continue
    findings.push(finding('finding_target_unresolvable', [{ run_id: br.at.run_id, seq: br.at.seq }], [br.at], false, `${br.reason}（目标 ${br.target.run_id}#${br.target.seq} 不可回源）`))
  }
  return { findings, cost: { queries, nodes_visited: nodesVisited } }
}

export function associationOnly(corpusDir: string, build: AssociationAccess): ReadResult {
  const key = loadAnswerKey(corpusDir)
  const { findings, cost } = associationFindings(build)
  return toReadResult(findings, key, cost)
}

// ── 读法 4：bothAlternating（两视图交替，非合并图）──────────────────────────

/**
 * 两视图检测器按「推理 → 关联 → 推理 → …」逐轮交替收取（确定性 interleaving，
 * 不是把两视图合并成一张图再查——保持「每步查询知道自己用的是哪个视图」的
 * 读法语义），按 location_key 首次命中去重；cost 为两侧真实总和。
 */
export function bothAlternating(corpusDir: string, build: BuildResult): ReadResult {
  const key = loadAnswerKey(corpusDir)
  const inf = inferenceFindings(build)
  const assoc = associationFindings(build)
  const merged: Finding[] = []
  const seen = new Set<string>()
  const n = Math.max(inf.findings.length, assoc.findings.length)
  for (let i = 0; i < n; i++) {
    for (const list of [inf.findings, assoc.findings]) {
      const f = list[i]
      if (!f || seen.has(f.location_key)) continue
      seen.add(f.location_key)
      merged.push(f)
    }
  }
  return toReadResult(merged, key, {
    queries: inf.cost.queries + assoc.cost.queries,
    nodes_visited: inf.cost.nodes_visited + assoc.cost.nodes_visited,
  })
}

// ── 研究主入口 ──────────────────────────────────────────────────────────────

/**
 * 跑完整对照：四读法 + 每 gap 的 per-read 可达矩阵 + 检出率。输出确定性可
 * 重放（同一语料两次 runAbStudy 逐字节相同）；偏差声明写死在输出内。
 */
export function runAbStudy(corpusDir: string): AbStudyResult {
  const key = loadAnswerKey(corpusDir)
  const files = readdirSync(corpusDir).filter((f) => f.endsWith('.jsonl')).sort()
  const build = buildViews(files, corpusDir)
  const raw = rawScan(corpusDir)
  const inf = inferenceOnly(corpusDir, build)
  const assoc = associationOnly(corpusDir, build)
  const both = bothAlternating(corpusDir, build)
  const hitSet = (r: ReadResult) => new Set(r.hits.map((h) => h.gap_id))
  const rawS = hitSet(raw)
  const infS = hitSet(inf)
  const asS = hitSet(assoc)
  const bothS = hitSet(both)
  const gap_matrix: GapMatrixRow[] = [...key.gaps]
    .sort((a, b) => (a.gap_id < b.gap_id ? -1 : 1))
    .map((g) => ({
      gap_id: g.gap_id,
      gap_kind: g.gap_kind,
      rawScan: rawS.has(g.gap_id),
      inferenceOnly: infS.has(g.gap_id),
      associationOnly: asS.has(g.gap_id),
      bothAlternating: bothS.has(g.gap_id),
    }))
  const rate = (s: Set<string>) => ({ detected: s.size, planted: key.gaps.length })
  return {
    study_version: AB_STUDY_VERSION,
    deviation_statement: DEVIATION_STATEMENT,
    corpus: { dir: path.basename(corpusDir), files, events_kept: build.stats.events_kept, gaps_planted: key.gaps.length },
    readings: { rawScan: raw, inferenceOnly: inf, associationOnly: assoc, bothAlternating: both },
    gap_matrix,
    per_read_detection_rate: {
      rawScan: rate(rawS),
      inferenceOnly: rate(infS),
      associationOnly: rate(asS),
      bothAlternating: rate(bothS),
    },
  }
}
