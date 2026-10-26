/**
 * V3 PoC · P4 —— W3C 风格 JSON-LD 导出/再导入 + 形状校验子集（零依赖手写）。
 *
 * 范围裁定（2026-10-26 用户裁定，写死）：PoC 素材 =「合成 + 真实 GPT 运行」
 * （strk-05/06 信封）。#10 P4 的「脱敏真实任务四组人工标注 A/B」与「live task
 * 侧车试运行」= 素材不存在 → **N/A（范围裁定）≠ PASS**；本文件是机械可测替代面。
 *
 * 与 W3C 的关系（如实声明）：本模块是 **JSON-LD 形状** 的导出/导入 +
 * **SHACL-*风格*** 的形状校验**子集**（node kind 必填属性/枚举值域），
 * **非 RDF/SHACL 完整实现**——无图规范化（URDNA2015）、无 SPARQL、无
 * shape 继承/约束组件库；PoC 形状子集。前缀词表自研 `poc:` + 引用
 * `sosa:`（W3C SOSA/SSN 命名空间，仅用作状态门的谓词面词汇，不声称语义完备）。
 *
 * 接纳状态门（负例④，硬规则）：
 *  - 只有带 actor 确认记录（graph.ConfirmationRecord，P2/P3 confirmation 面）
 *    的断言对象可打 `poc:status:'asserted'`；
 *  - 未确认 Assertion 一律 `poc:status:'candidate'`，且**不得**携带任何
 *    `sosa:` 事实谓词——构造期即由 `sosaAllowed` 把关；`findGateViolations`
 *    是独立守卫（对人工构造的 doc 也能查）。
 *
 * 导入不静默：不支持/未知字段逐条列入 lossReport（`{at, field, action:'dropped'}`）；
 * 确定性：@graph 排序输出，@id 由 run_id/seq 确定性派生；零 Date.now/随机。
 */
import { canonicalize } from './envelope.ts'
import type { GraphEdge, GraphNode, GraphView, ViewName } from './graph.ts'
import { ASSOCIATION_EDGE_TYPES, INFERENCE_EDGE_TYPES, sortGraphEdges } from './graph.ts'
import type { BrokenReference, ConfirmationRecord } from './graph.ts'

export const JSONLD_CONTEXT_VERSION = 'poc/jsonld/v0'

export const JSONLD_CONTEXT: Readonly<Record<string, string>> = Object.freeze({
  poc: 'https://poc.example.org/v3-semantic#',
  sosa: 'http://www.w3.org/ns/sosa/',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
})

/** sosa 事实谓词清单：只有过状态门（asserted）的对象可用。 */
export const SOSA_FACT_PREDICATES = ['sosa:hasResult', 'sosa:hasFeatureOfInterest', 'sosa:madeObservation'] as const

// ── 导出 ────────────────────────────────────────────────────────────────────

export interface JsonLdNode {
  '@id': string
  '@type': string[]
  [key: string]: unknown
}

export interface JsonLdDoc {
  '@context': Record<string, string>
  'poc:projectionVersion': string
  'poc:view': string
  '@graph': JsonLdNode[]
}

/** @id 由 run_id/seq 确定性派生（路径式 IRI，回源可定位）。 */
export function iriForNode(n: GraphNode): string {
  switch (n.kind) {
    case 'run':
      return `poc:run/${n.run_id}`
    case 'event':
      return `poc:event/${n.run_id}/${n.seq}`
    case 'assertion':
      return `poc:assertion/${n.run_id}/${n.seq}`
    case 'observation':
      return `poc:observation/${n.run_id}/${n.seq}`
    case 'argument':
      return `poc:argument/${n.node_id}`
    case 'external_anchor':
      return `poc:anchor/${n.node_id}`
  }
}

function isConfirmed(view: GraphView, n: GraphNode): boolean {
  return (
    n.kind === 'assertion' &&
    view.confirmations.some((c: ConfirmationRecord) => c.target_run_id === n.run_id && c.target_seq === n.seq)
  )
}

/** 状态门唯一裁决：asserted 只允许出现在有 actor 确认记录的断言上。 */
function statusFor(view: GraphView, n: GraphNode): 'asserted' | 'candidate' {
  return isConfirmed(view, n) ? 'asserted' : 'candidate'
}

/** 构造期门：sosa 谓词只随过门对象出场（负例④第一道）。 */
function sosaAllowed(view: GraphView, n: GraphNode): boolean {
  return n.kind === 'assertion' && isConfirmed(view, n)
}

/**
 * 导出 JSON-LD。runSet 给出时只导出这些 run 的对象（+双端点均在集内的边）。
 * 未确认 Assertion：poc:status='candidate'，零 sosa 谓词（attrs 里的文本走
 * poc: 命名空间，不占事实谓词）。
 */
export function exportJsonLd(view: GraphView, runSet?: readonly string[]): JsonLdDoc {
  const runFilter = runSet ? new Set(runSet) : null
  const nodes: GraphNode[] = view.nodes.filter((n) => runFilter === null || n.run_id === null || runFilter.has(n.run_id))
  const includedIds = new Set(nodes.map(iriForNode))
  const graph: JsonLdNode[] = []
  for (const n of nodes) {
    const id = iriForNode(n)
    const confirmed = isConfirmed(view, n)
    const obj: JsonLdNode = {
      '@id': id,
      '@type': [`poc:${kindTypeName(n.kind)}`],
      'poc:nodeId': n.node_id,
      'poc:projectionVersion': view.projection_version,
    }
    if (n.run_id !== null) obj['poc:runId'] = n.run_id
    if (n.seq !== null) obj['poc:seq'] = n.seq
    if (n.file !== null) obj['poc:file'] = n.file
    obj['poc:attrs'] = canonicalize(n.attrs) as Record<string, unknown>
    if (n.kind === 'assertion') {
      obj['poc:status'] = statusFor(view, n)
      if (confirmed) {
        // 过门后才允许事实谓词面（值只搬运登记文本，不做真值判断）。
        obj['@type'] = [...obj['@type'], 'sosa:Result']
        const text = n.attrs['claim_text']
        if (typeof text === 'string') obj['sosa:hasResult'] = text
        obj['poc:confirmedBy'] = view.confirmations
          .filter((c) => c.target_run_id === n.run_id && c.target_seq === n.seq)
          .map((c) => ({ 'poc:actor': c.actor, 'poc:via': { 'poc:file': c.via.file, 'poc:runId': c.via.run_id, 'poc:seq': c.via.seq } }))
      }
    }
    graph.push(obj)
  }
  for (const e of view.edges) {
    const fromIri = view.nodes.find((x) => x.node_id === e.from)
    const toIri = view.nodes.find((x) => x.node_id === e.to)
    if (!fromIri || !toIri) continue
    const f = iriForNode(fromIri)
    const t = iriForNode(toIri)
    if (runFilter && (!includedIds.has(f) || !includedIds.has(t))) continue
    graph.push({
      '@id': `poc:edge/${e.edge_id}`,
      '@type': ['poc:GraphEdge'],
      'poc:edgeId': e.edge_id,
      'poc:edgeType': e.edge_type,
      'poc:origin': e.origin,
      'poc:from': f,
      'poc:to': t,
      'poc:polarity': e.polarity,
      'poc:provenance': e.provenance.map((p) => ({ 'poc:file': p.file, 'poc:runId': p.run_id, 'poc:seq': p.seq })),
      'poc:scope': e.scope,
      'poc:version': e.version,
    })
  }
  for (const br of view.broken_references) {
    graph.push({
      '@id': `poc:broken/${br.at.run_id}/${br.at.seq}/${br.edge_type}/${br.target.run_id}/${br.target.seq}`,
      '@type': ['poc:BrokenReference'],
      'poc:edgeType': br.edge_type,
      'poc:at': { 'poc:file': br.at.file, 'poc:runId': br.at.run_id, 'poc:seq': br.at.seq },
      'poc:target': { 'poc:runId': br.target.run_id, 'poc:seq': br.target.seq },
      'poc:reason': br.reason,
    })
  }
  for (const c of view.confirmations) {
    if (runFilter && !runFilter.has(c.target_run_id)) continue
    graph.push({
      '@id': `poc:confirmation/${c.target_run_id}/${c.target_seq}/${c.via.run_id}/${c.via.seq}`,
      '@type': ['poc:ConfirmationRecord'],
      'poc:targets': { 'poc:runId': c.target_run_id, 'poc:seq': c.target_seq },
      'poc:actor': c.actor,
      'poc:via': { 'poc:file': c.via.file, 'poc:runId': c.via.run_id, 'poc:seq': c.via.seq },
    })
  }
  graph.sort((a, b) => (a['@id'] === b['@id'] ? 0 : String(a['@id']) < String(b['@id']) ? -1 : 1))
  return {
    '@context': { ...JSONLD_CONTEXT },
    'poc:projectionVersion': view.projection_version,
    'poc:view': view.view,
    '@graph': graph,
  }
}

function kindTypeName(kind: GraphNode['kind']): string {
  return kind
}

/** 独立守卫：candidate 断言携带 sosa:* 谓词 = 状态门违规（对任何 doc 可查）。 */
export function findGateViolations(doc: JsonLdDoc): { at: string; field: string }[] {
  const out: { at: string; field: string }[] = []
  for (const node of doc['@graph']) {
    const types = Array.isArray(node['@type']) ? node['@type'] : []
    const isAssertion = types.includes('poc:assertion')
    const status = node['poc:status']
    if (status !== 'asserted' && isAssertion) {
      for (const key of Object.keys(node)) {
        if (key.startsWith('sosa:')) out.push({ at: String(node['@id']), field: key })
      }
    }
    if (status === 'asserted' && isAssertion) {
      const confirmedBy = node['poc:confirmedBy']
      if (!Array.isArray(confirmedBy) || confirmedBy.length === 0) {
        out.push({ at: String(node['@id']), field: 'poc:status=asserted 但无 poc:confirmedBy（确认记录缺失）' })
      }
    }
  }
  return out
}

// ── 导入 ────────────────────────────────────────────────────────────────────

export interface LossEntry {
  at: string
  field: string
  action: 'dropped'
}

export interface ImportResult {
  view: GraphView
  lossReport: LossEntry[]
}

const NODE_FIELD_MAP: Readonly<Record<string, string>> = {
  'poc:nodeId': 'node_id',
  'poc:runId': 'run_id',
  'poc:seq': 'seq',
  'poc:file': 'file',
  'poc:attrs': 'attrs',
  'poc:projectionVersion': 'projection_version',
}

/**
 * 导入 JSON-LD → GraphView。未知/不支持字段**逐条**列入 lossReport
 * （at=@id/'@context'/顶层, field=原字段名, action='dropped'），禁静默。
 * poc:status 为 'candidate'/'asserted' 的断言对象原样保留状态（语义等价面），
 * 但 asserted 的真实性仍以确认记录在场为准（往返不改写）。
 */
export function importJsonLd(doc: JsonLdDoc): ImportResult {
  const loss: LossEntry[] = []
  // @context：词表必须声明 poc:；未知前缀逐条记账。
  const ctx = doc['@context']
  if (!ctx || typeof ctx['poc'] !== 'string') {
    loss.push({ at: '@context', field: 'poc（必需前缀缺失）', action: 'dropped' })
  }
  const declaredPrefixes = new Set([...Object.keys(JSONLD_CONTEXT), '@vocab', '@language'])
  for (const k of Object.keys(ctx ?? {})) {
    if (!declaredPrefixes.has(k)) loss.push({ at: '@context', field: `prefix:${k}`, action: 'dropped' })
  }
  const viewName: ViewName = doc['poc:view'] === 'association' ? 'association' : 'inference'

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const broken: BrokenReference[] = []
  const confirmations: ConfirmationRecord[] = []
  let projectionVersion = typeof doc['poc:projectionVersion'] === 'string' ? doc['poc:projectionVersion'] : JSONLD_CONTEXT_VERSION

  for (const node of doc['@graph'] ?? []) {
    const at = String(node['@id'] ?? '@graph[i]')
    const types = (Array.isArray(node['@type']) ? node['@type'] : []) as string[]
    if (types.includes('poc:GraphEdge')) {
      const edge: GraphEdge = {
        edge_id: String(node['poc:edgeId'] ?? ''),
        edge_type: String(node['poc:edgeType'] ?? ''),
        from: iriToLocalNode(String(node['poc:from'] ?? '')),
        to: iriToLocalNode(String(node['poc:to'] ?? '')),
        origin: (['STRUCTURAL', 'REGISTERED', 'SOURCED'] as const).includes(node['poc:origin'] as never)
          ? (node['poc:origin'] as GraphEdge['origin'])
          : 'REGISTERED',
        polarity: typeof node['poc:polarity'] === 'string' ? node['poc:polarity'] : null,
        provenance: Array.isArray(node['poc:provenance'])
          ? (node['poc:provenance'] as Record<string, unknown>[]).map((p) => ({
              file: String(p['poc:file'] ?? ''),
              run_id: String(p['poc:runId'] ?? ''),
              seq: Number.isInteger(p['poc:seq']) ? (p['poc:seq'] as number) : -1,
            }))
          : [],
        scope: String(node['poc:scope'] ?? 'UNKNOWN'),
        version: String(node['poc:version'] ?? 'UNKNOWN'),
      }
      if (!edgeValidForView(edge, viewName)) {
        loss.push({ at, field: 'poc:edgeType（不在本视图闭集，边整条不入库）', action: 'dropped' })
        continue
      }
      edges.push(edge)
      for (const k of Object.keys(node)) {
        if (!['@id', '@type', 'poc:edgeId', 'poc:edgeType', 'poc:origin', 'poc:from', 'poc:to', 'poc:polarity', 'poc:provenance', 'poc:scope', 'poc:version'].includes(k)) {
          loss.push({ at, field: k, action: 'dropped' })
        }
      }
      continue
    }
    if (types.includes('poc:BrokenReference')) {
      const tgt = (node['poc:target'] ?? {}) as Record<string, unknown>
      const a = (node['poc:at'] ?? {}) as Record<string, unknown>
      broken.push({
        edge_type: String(node['poc:edgeType'] ?? ''),
        at: { file: String(a['poc:file'] ?? ''), run_id: String(a['poc:runId'] ?? ''), seq: Number.isInteger(a['poc:seq']) ? (a['poc:seq'] as number) : -1 },
        target: { run_id: String(tgt['poc:runId'] ?? ''), seq: Number.isInteger(tgt['poc:seq']) ? (tgt['poc:seq'] as number) : -1 },
        reason: String(node['poc:reason'] ?? ''),
      })
      for (const k of Object.keys(node)) {
        if (!['@id', '@type', 'poc:edgeType', 'poc:at', 'poc:target', 'poc:reason'].includes(k)) loss.push({ at, field: k, action: 'dropped' })
      }
      continue
    }
    if (types.includes('poc:ConfirmationRecord')) {
      const t = (node['poc:targets'] ?? {}) as Record<string, unknown>
      const v = (node['poc:via'] ?? {}) as Record<string, unknown>
      confirmations.push({
        target_run_id: String(t['poc:runId'] ?? ''),
        target_seq: Number.isInteger(t['poc:seq']) ? (t['poc:seq'] as number) : -1,
        actor: String(node['poc:actor'] ?? ''),
        via: { file: String(v['poc:file'] ?? ''), run_id: String(v['poc:runId'] ?? ''), seq: Number.isInteger(v['poc:seq']) ? (v['poc:seq'] as number) : -1 },
      })
      for (const k of Object.keys(node)) {
        if (!['@id', '@type', 'poc:targets', 'poc:actor', 'poc:via'].includes(k)) loss.push({ at, field: k, action: 'dropped' })
      }
      continue
    }
    // 普通对象节点
    const kind = kindFromTypes(types)
    if (kind === null) {
      loss.push({ at, field: '@type（无已知 poc: 节点类型，整节点不入库）', action: 'dropped' })
      continue
    }
    const runId = typeof node['poc:runId'] === 'string' ? (node['poc:runId'] as string) : null
    const seq = Number.isInteger(node['poc:seq']) ? (node['poc:seq'] as number) : null
    const file = typeof node['poc:file'] === 'string' ? (node['poc:file'] as string) : null
    if (typeof node['poc:projectionVersion'] === 'string') projectionVersion = node['poc:projectionVersion']
    const attrs = (node['poc:attrs'] ?? {}) as Record<string, unknown>
    const gn: GraphNode = {
      node_id: String(node['poc:nodeId'] ?? ''),
      kind,
      run_id: runId,
      seq,
      file,
      attrs: canonicalize(attrs) as Record<string, unknown>,
    }
    nodes.push(gn)
    // sosa 事实谓词是**已认识字段**（只随 asserted 出场，导入侧由 attrs+确认记录
      // 重建，不是未知丢弃）；未知字段仍逐条列账。
      const known = new Set(['@id', '@type', ...Object.keys(NODE_FIELD_MAP), 'poc:status', 'poc:confirmedBy', ...SOSA_FACT_PREDICATES])
    for (const k of Object.keys(node)) {
      if (!known.has(k)) loss.push({ at, field: k, action: 'dropped' })
    }
  }

  // 端点先解析为 node_id，再按 buildViews 同一规则排序（IRI 序 ≠ node_id 序，
  // 排序必须在解析之后，往返序才一致）。
  const resolved = resolveEndpoints({
    view: viewName,
    projection_version: projectionVersion,
    nodes: sortById(nodes),
    edges,
    broken_references: broken.sort((a, b) =>
      a.at.file === b.at.file ? (a.at.seq === b.at.seq ? (a.edge_type < b.edge_type ? -1 : 1) : a.at.seq - b.at.seq) : a.at.file < b.at.file ? -1 : 1),
    confirmations: confirmations.sort((a, b) =>
      a.target_run_id === b.target_run_id ? (a.target_seq === b.target_seq ? (a.actor < b.actor ? -1 : 1) : a.target_seq - b.target_seq) : a.target_run_id < b.target_run_id ? -1 : 1),
  })
  const view: GraphView = { ...resolved, edges: sortGraphEdges(resolved.edges) }
  loss.sort((a, b) => (a.at === b.at ? (a.field < b.field ? -1 : 1) : a.at < b.at ? -1 : 1))
  return { view, lossReport: loss }
}

function iriToLocalNode(iri: string): string {
  // 导出侧 poc:event/RUN/3 等形态 → 反查 node_id 由导入后按 @id→poc:nodeId 映射完成；
  // 这里先存 IRI，importJsonLd 输出前统一替换（见 resolveEndpoints）。
  return iri
}

function resolveEndpoints(view: GraphView): GraphView {
  const byIri = new Map<string, string>()
  for (const n of view.nodes) byIri.set(nodeIriGuess(n), n.node_id)
  const edges = view.edges.map((e) => ({ ...e, from: byIri.get(e.from) ?? e.from, to: byIri.get(e.to) ?? e.to }))
  return { ...view, edges }
}

function nodeIriGuess(n: GraphNode): string {
  return iriForNode(n)
}

function kindFromTypes(types: string[]): GraphNode['kind'] | null {
  for (const t of types) {
    const m = /^poc:(run|event|assertion|observation|argument|external_anchor)$/.exec(t)
    if (m) return m[1] as GraphNode['kind']
  }
  return null
}

function edgeValidForView(edge: GraphEdge, view: ViewName): boolean {
  const closed: readonly string[] = view === 'inference' ? INFERENCE_EDGE_TYPES : ASSOCIATION_EDGE_TYPES
  return closed.includes(edge.edge_type)
}

function sortById(nodes: GraphNode[]): GraphNode[] {
  return [...nodes].sort((a, b) => (a.node_id === b.node_id ? 0 : a.node_id < b.node_id ? -1 : 1))
}

// ── validateShapes：SHACL-风格形状校验子集（非完整 RDF/SHACL）──────────────

export interface NodeShape {
  shape_id: string
  /** 目标节点 kind（本子集按 node kind 圈定目标集）。 */
  targetKind: GraphNode['kind']
  /** attrs 必填属性（值不得为 undefined/null）。 */
  required_props?: readonly string[]
  /** attrs 枚举值域：属性值必须落在给定集合内（值缺失不违例，值在场且越界才违例）。 */
  enum_props?: Readonly<Record<string, readonly string[]>>
}

export interface ShapeViolation {
  shape_id: string
  node_id: string
  prop: string
  reason: string
}

/**
 * 手写 SHACL-*风格* 形状校验子集：node kind 必填属性 / 枚举值域。
 * **非 RDF/SHACL 完整实现**（无 path 表达式、无约束组件库、无目标选择器）；
 * 不通过返回违规列表，**不 throw**。
 */
export function validateShapes(view: GraphView, shapes: readonly NodeShape[]): ShapeViolation[] {
  const out: ShapeViolation[] = []
  for (const shape of shapes) {
    for (const n of view.nodes) {
      if (n.kind !== shape.targetKind) continue
      for (const p of shape.required_props ?? []) {
        if (n.attrs[p] === undefined || n.attrs[p] === null) {
          out.push({ shape_id: shape.shape_id, node_id: n.node_id, prop: p, reason: 'required_prop_missing' })
        }
      }
      for (const [p, allowed] of Object.entries(shape.enum_props ?? {})) {
        const v = n.attrs[p]
        if (v !== undefined && v !== null && !allowed.includes(String(v))) {
          out.push({ shape_id: shape.shape_id, node_id: n.node_id, prop: p, reason: `value_not_in_closed_set(${allowed.join('|')})` })
        }
      }
    }
  }
  out.sort((a, b) =>
    a.shape_id === b.shape_id
      ? a.node_id === b.node_id
        ? a.prop < b.prop
          ? -1
          : 1
        : a.node_id < b.node_id
          ? -1
          : 1
      : a.shape_id < b.shape_id
        ? -1
        : 1)
  return out
}
