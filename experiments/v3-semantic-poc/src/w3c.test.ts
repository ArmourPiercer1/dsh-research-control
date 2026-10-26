/**
 * P4 W3C 交换面测试 —— 固定负例④⑤ + 往返语义等价 + 形状子集。
 *
 * 状态门（负例④）：未确认 Assertion 一律 candidate 且零 sosa 事实谓词；
 * asserted 只随 actor 确认记录出场。lossReport（负例⑤）：exotic 字段恰好
 * 1 条且点名。合成/真实素材声明同 graph.test.ts。
 */
import path from 'node:path'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalize } from './envelope.ts'
import { buildViews } from './graph.ts'
import type { GraphView } from './graph.ts'
import {
  JSONLD_CONTEXT,
  SOSA_FACT_PREDICATES,
  exportJsonLd,
  findGateViolations,
  importJsonLd,
  validateShapes,
} from './w3c.ts'
import type { JsonLdDoc, NodeShape } from './w3c.ts'

const POC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const AB_DIR = path.join(POC_ROOT, 'fixtures/ab/corpus')
const abFiles = (): string[] => readdirSync(AB_DIR).filter((f) => f.endsWith('.jsonl')).sort()
const STRK_FILES = [
  'samples/gpt-streak/envelopes.strk-05-live-nominal.jsonl',
  'samples/gpt-streak/envelopes.strk-06-live-quaderr.jsonl',
]

const eq = (v: GraphView): string =>
  JSON.stringify(canonicalize({ view: v.view, nodes: v.nodes, edges: v.edges, broken: v.broken_references, confirmations: v.confirmations }))

describe('接纳状态门（负例④）', () => {
  const build = buildViews(abFiles(), AB_DIR)
  const doc = exportJsonLd(build.inference)

  it('有 actor 确认记录的断言 → poc:status asserted（且带 poc:confirmedBy）；其余断言一律 candidate', () => {
    const asserted = doc['@graph'].filter((n) => n['poc:status'] === 'asserted')
    const candidates = doc['@graph'].filter((n) => n['poc:status'] === 'candidate')
    expect(asserted.map((n) => n['@id'])).toEqual(['poc:assertion/RUN-AB-A/3'])
    expect(asserted[0]!['poc:confirmedBy']).toEqual([
      { 'poc:actor': 'dr.zhang', 'poc:via': { 'poc:file': 'env-ab-a.jsonl', 'poc:runId': 'RUN-AB-A', 'poc:seq': 4 } },
    ])
    expect(candidates.length).toBe(4) // B/F/G/E 断言（B 断言行保留但无确认）
    expect(candidates.every((c) => Array.isArray(c['@type']) && c['@type'].includes('poc:assertion'))).toBe(true)
  })

  it('未确认 Assertion 零 sosa 事实谓词；asserted 才可用 sosa:hasResult；守卫零违例', () => {
    for (const n of doc['@graph']) {
      const types = Array.isArray(n['@type']) ? (n['@type'] as string[]) : []
      if (types.includes('poc:assertion') && n['poc:status'] !== 'asserted') {
        for (const key of Object.keys(n)) expect(key.startsWith('sosa:')).toBe(false)
      }
    }
    const asserted = doc['@graph'].find((n) => n['poc:status'] === 'asserted')!
    expect(Object.keys(asserted).filter((k) => k.startsWith('sosa:'))).toEqual(['sosa:hasResult'])
    expect(SOSA_FACT_PREDICATES.length).toBeGreaterThan(0)
    expect(findGateViolations(doc)).toEqual([])
  })

  it('负例：手工构造“无确认记录也想 asserted”的视图 → 导出仍 candidate 且零 sosa（asserted 需确认记录）', () => {
    const view: GraphView = {
      view: 'inference',
      projection_version: 'test',
      nodes: [{
        node_id: 'nX', kind: 'assertion', run_id: 'RUN-X', seq: 1, file: 'x.jsonl',
        attrs: { claim_text: '未确认断言', poc_status_wish: 'asserted' },
      }],
      edges: [], broken_references: [], confirmations: [],
    }
    const d = exportJsonLd(view)
    const node = d['@graph'].find((x) => x['@id'] === 'poc:assertion/RUN-X/1')!
    expect(node['poc:status']).toBe('candidate')
    expect(Object.keys(node).some((k) => k.startsWith('sosa:'))).toBe(false)
  })

  it('负例：守卫对人工构造的违规 doc 也能点名（candidate+sosa / asserted 无确认记录）', () => {
    const bad: JsonLdDoc = {
      '@context': { ...JSONLD_CONTEXT },
      'poc:projectionVersion': 't',
      'poc:view': 'inference',
      '@graph': [
        { '@id': 'poc:assertion/R/0', '@type': ['poc:assertion'], 'poc:status': 'candidate', 'sosa:hasResult': '越权事实谓词' },
        { '@id': 'poc:assertion/R/1', '@type': ['poc:assertion'], 'poc:status': 'asserted' },
      ],
    }
    const v = findGateViolations(bad)
    expect(v.length).toBe(2)
    expect(v.map((x) => x.at).sort()).toEqual(['poc:assertion/R/0', 'poc:assertion/R/1'])
  })
})

describe('导出→导入往返：核心面语义等价 + 逐条 lossReport（负例⑤）', () => {
  it('strk inference/association 两视图往返：对象 ID、关系语义、provenance、unknowns、状态、broken 账全等价', () => {
    const build = buildViews(STRK_FILES, POC_ROOT)
    for (const view of [build.inference, build.association] as const) {
      const { view: back, lossReport } = importJsonLd(exportJsonLd(view))
      expect(lossReport).toEqual([]) // 已知字段零丢失
      expect(eq(back)).toBe(eq(view))
    }
  })

  it('ab 视图往返（含确认记录与 asserted/candidate 状态、REGISTERED_FINDING broken 账）', () => {
    const build = buildViews(abFiles(), AB_DIR)
    for (const view of [build.inference, build.association] as const) {
      const { view: back, lossReport } = importJsonLd(exportJsonLd(view))
      expect(lossReport).toEqual([])
      expect(eq(back)).toBe(eq(view))
      if (view.view === 'inference') {
        expect(back.confirmations).toEqual(view.confirmations)
      }
    }
  })

  it('runSet 过滤：只导出指定 run 的对象与双端点均在集内的边', () => {
    const build = buildViews(STRK_FILES, POC_ROOT)
    const doc = exportJsonLd(build.association, ['RUN-STRK-05'])
    const events = doc['@graph'].filter((n) => (n['@type'] as string[]).includes('poc:event'))
    expect(events.length).toBe(5)
    expect(events.every((e) => e['poc:runId'] === 'RUN-STRK-05')).toBe(true)
    const edges = doc['@graph'].filter((n) => (n['@type'] as string[]).includes('poc:GraphEdge'))
    expect(edges.every((e) => String(e['poc:from']).includes('RUN-STRK-05'))).toBe(true)
  })

  it('负例：故意塞一个 exotic:field → lossReport 恰好 1 条且点名该字段与所在节点', () => {
    const build = buildViews(STRK_FILES, POC_ROOT)
    const doc = exportJsonLd(build.inference)
    const target = doc['@graph'].find((n) => n['@id'] === 'poc:event/RUN-STRK-05/3')!
    target['exotic:field'] = '未登记扩展'
    const { lossReport } = importJsonLd(doc)
    expect(lossReport.length).toBe(1)
    expect(lossReport[0]).toEqual({ at: 'poc:event/RUN-STRK-05/3', field: 'exotic:field', action: 'dropped' })
  })

  it('@context 未知前缀逐条记账（导入不静默）', () => {
    const doc = exportJsonLd(buildViews(STRK_FILES, POC_ROOT).inference)
    doc['@context']['weird'] = 'https://example.org/unknown#'
    const { lossReport } = importJsonLd(doc)
    expect(lossReport).toEqual([{ at: '@context', field: 'prefix:weird', action: 'dropped' }])
  })
})

describe('validateShapes：SHACL-*风格*子集（PoC 面，非完整 RDF/SHACL）', () => {
  it('合规视图零违例；缺必填属性/枚举越界返回违规列表且不 throw', () => {
    const build = buildViews(abFiles(), AB_DIR)
    const shapes: NodeShape[] = [
      { shape_id: 'SH-ASSERTION', targetKind: 'assertion', required_props: ['claim_text', 'unknowns'] },
      { shape_id: 'SH-EVENT', targetKind: 'event', required_props: ['channel', 'kind'], enum_props: { channel: ['SOURCE_RECORD', 'RESEARCHER_INFERENCE', 'LLM_SUGGESTION'] } },
    ]
    expect(validateShapes(build.inference, shapes)).toEqual([])
    const brokenView: GraphView = {
      view: 'inference', projection_version: 't',
      nodes: [
        { node_id: 'nA', kind: 'assertion', run_id: 'R', seq: 0, file: 'f', attrs: { unknowns: [] } }, // 缺 claim_text
        { node_id: 'nB', kind: 'event', run_id: 'R', seq: 1, file: 'f', attrs: { channel: 'ALIEN_CHANNEL', kind: 'run.started' } }, // 枚举越界
      ],
      edges: [], broken_references: [], confirmations: [],
    }
    const v = validateShapes(brokenView, shapes)
    expect(v.length).toBe(2)
    expect(v.find((x) => x.prop === 'claim_text')?.reason).toBe('required_prop_missing')
    expect(v.find((x) => x.prop === 'channel')?.reason).toContain('value_not_in_closed_set')
  })
})
