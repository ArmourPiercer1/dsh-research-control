/**
 * P4 双图谱测试 —— 固定负例①②③ + strk-05/06 golden + 闭集/注记/查询校验。
 *
 * 合成声明：ab 语料为合成任务包；strk-05/06 为真实 GPT 运行信封（合成研究场景）。
 * golden 断言用真实事实：两 strk deck sha 不同 → SHARED_DECK=0；
 * strk-06#4 跨文件 based_on 指 strk-05#4 → CROSS_RUN_BASIS=1。
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalize } from './envelope.ts'
import {
  ASSOCIATION_EDGE_TYPES,
  INFERENCE_EDGE_TYPES,
  QUERY_NOTE,
  buildViews,
  queryView,
} from './graph.ts'
import type { GraphView } from './graph.ts'

const POC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STRK_FILES = [
  'samples/gpt-streak/envelopes.strk-05-live-nominal.jsonl',
  'samples/gpt-streak/envelopes.strk-06-live-quaderr.jsonl',
]

function abFiles(): string[] {
  // 动态取语料文件清单（与 runAbStudy 同源规则：目录内 *.jsonl 字典序）。
  return readdirSync(path.join(POC_ROOT, 'fixtures/ab/corpus')).filter((f) => f.endsWith('.jsonl')).sort()
}

const countType = (view: GraphView, t: string): number => view.edges.filter((e) => e.edge_type === t).length

describe('buildViews：双视图可重建（负例②）', () => {
  it('同一批输入两次 build，canonicalize 后逐字节相同（ab 语料）', () => {
    const a = buildViews(abFiles(), path.join(POC_ROOT, 'fixtures/ab/corpus'))
    const b = buildViews(abFiles(), path.join(POC_ROOT, 'fixtures/ab/corpus'))
    expect(JSON.stringify(canonicalize(a))).toBe(JSON.stringify(canonicalize(b)))
  })

  it('strk-05/06 两视图 build 成功且可重建；文件入参乱序结果不变', () => {
    const a = buildViews(STRK_FILES, POC_ROOT)
    const b = buildViews([...STRK_FILES].reverse(), POC_ROOT)
    expect(a.problems).toEqual([])
    expect(JSON.stringify(canonicalize(a))).toBe(JSON.stringify(canonicalize(b)))
  })
})

describe('association 边类型闭集与 golden 挂接（strk-05/06 真实事实）', () => {
  const build = buildViews(STRK_FILES, POC_ROOT)
  const assoc = build.association

  it('闭集清单钉死（超出即拒的“集”本身不许漂移）', () => {
    expect(ASSOCIATION_EDGE_TYPES).toEqual([
      'SAME_RUN', 'SHARED_ARTIFACT', 'SHARED_DECK', 'CROSS_RUN_BASIS',
      'REGISTERED_FINDING', 'SOURCED_ASSOCIATION',
    ])
    expect(INFERENCE_EDGE_TYPES).toEqual(['EVIDENCE', 'CLAIM_BASIS', 'ARGUMENT_SUPPORT'])
  })

  it('golden：两 strk deck sha 不同 → SHARED_DECK=0、SHARED_ARTIFACT=0；strk-06#4→strk-05#4 → CROSS_RUN_BASIS=1', () => {
    expect(countType(assoc, 'SHARED_DECK')).toBe(0)
    expect(countType(assoc, 'SHARED_ARTIFACT')).toBe(0)
    const cross = assoc.edges.filter((e) => e.edge_type === 'CROSS_RUN_BASIS')
    expect(cross.length).toBeGreaterThanOrEqual(1)
    expect(countType(assoc, 'CROSS_RUN_BASIS')).toBe(1)
    expect(cross[0]!.origin).toBe('REGISTERED')
    expect(cross[0]!.provenance[0]).toMatchObject({ run_id: 'RUN-STRK-06', seq: 4 })
    expect(countType(assoc, 'SAME_RUN')).toBe(build.stats.events_kept) // 10 事件 = 10 结构边
    for (const e of assoc.edges.filter((x) => x.edge_type === 'SAME_RUN')) expect(e.origin).toBe('STRUCTURAL')
  })

  it('inference 视图：strk-06#4 claim 有 2 条 EVIDENCE 入边（本 run #3 + 跨 run strk-05#4），弱登记不升格', () => {
    const assertion = build.inference.nodes.find((n) => n.kind === 'assertion')!
    expect(assertion).toMatchObject({ run_id: 'RUN-STRK-06', seq: 4 })
    const q = queryView(build.inference, { start: assertion.node_id, direction: 'in', edgeTypes: ['EVIDENCE'], maxHops: 1 })
    expect(q.paths.length).toBe(2)
    for (const p of q.paths) expect(p.edges[0]!.origin).toBe('REGISTERED')
  })
})

describe('无锚 SOURCED_ASSOCIATION 拒收列账（负例①）', () => {
  const build = buildViews(abFiles(), path.join(POC_ROOT, 'fixtures/ab/corpus'))

  it('无锚经验联想：零入图 + 拒收账点名 RUN-AB-C#3；有锚的那条成 SOURCED_ASSOCIATION 边', () => {
    const rej = build.rejections.filter((r) => r.edge_type === 'SOURCED_ASSOCIATION')
    expect(rej.length).toBe(1)
    expect(rej[0]!.at).toMatchObject({ run_id: 'RUN-AB-C', seq: 3 })
    expect(rej[0]!.reason).toContain('missing_source_anchor')
    const sourced = build.association.edges.filter((e) => e.edge_type === 'SOURCED_ASSOCIATION')
    expect(sourced.length).toBe(1)
    expect(sourced[0]!.origin).toBe('SOURCED') // origin 一次定死，SOURCED 永不被改写
    expect(sourced[0]!.scope).toBe('历史经验') // 锚上登记的 scope 原样搬运
  })

  it('REGISTERED_FINDING 指向不存在目标 → broken_references 列账（E#3→A#99），不静默', () => {
    const br = build.association.broken_references.filter((b) => b.edge_type === 'REGISTERED_FINDING')
    expect(br.length).toBe(1)
    expect(br[0]!.at).toMatchObject({ run_id: 'RUN-AB-E', seq: 3 })
    expect(br[0]!.target).toEqual({ run_id: 'RUN-AB-A', seq: 99 })
  })

  it('based_on 断链 → inference 视图 broken_references 列账（B#3→#99）', () => {
    const br = build.inference.broken_references.filter((b) => b.edge_type === 'EVIDENCE')
    expect(br.length).toBe(1)
    expect(br[0]!.at).toMatchObject({ run_id: 'RUN-AB-B', seq: 3 })
    expect(br[0]!.target).toEqual({ run_id: 'RUN-AB-B', seq: 99 })
  })
})

describe('queryView：自由组合 + 真实截断计数（负例③）+ 固定注记', () => {
  const build = buildViews(abFiles(), path.join(POC_ROOT, 'fixtures/ab/corpus'))
  const assoc = build.association
  const runA = assoc.nodes.find((n) => n.kind === 'run' && n.run_id === 'RUN-AB-A')!

  it('limit 截断：truncated=true 且 dropped_count = 总数−返回数（超限计数入账，禁静默丢）', () => {
    const full = queryView(assoc, { start: runA.node_id, direction: 'out', edgeTypes: ['SAME_RUN'], maxHops: 1 })
    expect(full.paths.length).toBe(5) // RUN-AB-A 有 5 事件
    expect(full.truncated).toBe(false)
    expect(full.dropped_count).toBe(0)
    const capped = queryView(assoc, { start: runA.node_id, direction: 'out', edgeTypes: ['SAME_RUN'], maxHops: 1, limit: 2 })
    expect(capped.paths.length).toBe(2)
    expect(capped.truncated).toBe(true)
    expect(capped.dropped_count).toBe(full.paths.length - 2)
  })

  it('每条路径逐边携带 type/origin/provenance/scope；固定注记恒在场', () => {
    const q = queryView(assoc, { start: runA.node_id, direction: 'out', maxHops: 2 })
    expect(q.note).toBe(QUERY_NOTE)
    expect(q.note).toContain('关联不等于因果')
    for (const p of q.paths) {
      for (const e of p.edges) {
        expect(ASSOCIATION_EDGE_TYPES as readonly string[]).toContain(e.edge_type)
        expect(['STRUCTURAL', 'REGISTERED', 'SOURCED']).toContain(e.origin)
        expect(Array.isArray(e.provenance)).toBe(true)
        expect(typeof e.scope).toBe('string')
        expect(typeof e.version).toBe('string')
      }
    }
  })

  it('超出闭集的 edgeTypes / 越界 maxHops / 未知 start 一律拒（无默认工作流可逃）', () => {
    expect(() => queryView(assoc, { start: runA.node_id, direction: 'out', edgeTypes: ['CAUSES'], maxHops: 2 }))
      .toThrow(/QUERY_UNKNOWN_EDGE_TYPE/)
    expect(() => queryView(assoc, { start: runA.node_id, direction: 'out', maxHops: 0 })).toThrow(/QUERY_INVALID/)
    expect(() => queryView(assoc, { start: runA.node_id, direction: 'out', maxHops: 7 })).toThrow(/QUERY_INVALID/)
    expect(() => queryView(assoc, { start: 'nope', direction: 'out', maxHops: 1 })).toThrow(/QUERY_START_NOT_FOUND/)
  })

  it('prune 生效且不改变 dropped_count 语义（调用方选择 ≠ 丢弃）', () => {
    const q = queryView(assoc, {
      start: runA.node_id, direction: 'out', edgeTypes: ['SAME_RUN'], maxHops: 1,
      prune: (e) => {
        const t = assoc.nodes.find((n) => n.node_id === e.to)
        return t?.seq !== 0
      },
    })
    expect(q.paths.length).toBe(4) // 5 − 剪掉的 run.started 一条
    expect(q.truncated).toBe(false)
    expect(q.dropped_count).toBe(0)
  })
})

describe('scenario 缺位/在场的推理边替代面（P3 场景文件复用）', () => {
  it('给 scenario → ARGUMENT_SUPPORT 显式边在场（4 条前提边）；不给 → 无边但 CLAIM_BASIS 机制不变', () => {
    const withScenario = buildViews(STRK_FILES, POC_ROOT, ['fixtures/semantics/strk04-degeneracy.scenario.json'])
    const argEdges = withScenario.inference.edges.filter((e) => e.edge_type === 'ARGUMENT_SUPPORT')
    expect(argEdges.length).toBe(4) // P-spot-compare 3 前提 + P-residual-v2 1 前提
    for (const e of argEdges) expect(e.origin).toBe('REGISTERED')
    const noScenario = buildViews(STRK_FILES, POC_ROOT)
    expect(noScenario.inference.edges.some((e) => e.edge_type === 'ARGUMENT_SUPPORT')).toBe(false)
  })

  it('inference 边 scope 缺失 = UNKNOWN 占位，不编造；登记在场则原样搬运', () => {
    const strk = buildViews(STRK_FILES, POC_ROOT)
    // strk-06#4 的 payload 无 scope/version 登记 → 其 EVIDENCE 边两字段必为 UNKNOWN。
    for (const e of strk.inference.edges) {
      expect(e.scope).toBe('UNKNOWN')
      expect(e.version).toBe('UNKNOWN')
    }
    const ab = buildViews(abFiles(), path.join(POC_ROOT, 'fixtures/ab/corpus'))
    const scoped = ab.inference.edges.find((e) => e.provenance.some((p) => p.run_id === 'RUN-AB-A' && p.seq === 3) && e.edge_type === 'EVIDENCE')!
    expect(scoped.scope).toBe('标称工况组') // A#3 登记的 scope 原样搬运，不改写
  })
})
