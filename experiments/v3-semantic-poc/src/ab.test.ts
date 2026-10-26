/**
 * P4 机械召回对照测试 —— 固定负例⑦ + 真实测出的矩阵/计数 golden。
 *
 * **偏差声明（与被测面同源）**：以下所有命中/率值测量的是「机器从该读法可达
 * 的植入缺口」，不是人类问题发现质量；语料为合成任务包 + 机器植入答案键
 * （fixtures/ab/corpus/，README.md 声明）；#10 P4 人工标注 A/B 与 live 侧车
 * = N/A（范围裁定）≠ PASS。golden 数字来自真实运行输出（禁编造），REPORT-P4.md
 * 引用同一组数字。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEVIATION_STATEMENT, loadAnswerKey, rawScan, runAbStudy } from './ab.ts'

const POC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CORPUS = path.join(POC_ROOT, 'fixtures/ab/corpus')
const study = runAbStudy(CORPUS)

describe('runAbStudy：确定性可重放 + 答案键在场', () => {
  it('两次 runAbStudy 输出逐字节相同（确定性）', () => {
    expect(JSON.stringify(runAbStudy(CORPUS))).toBe(JSON.stringify(study))
  })

  it('植入缺口 ≥6 且全部有 ground-truth 定位；偏差声明写死在输出 JSON 与常量', () => {
    const key = loadAnswerKey(CORPUS)
    expect(key.gaps.length).toBeGreaterThanOrEqual(6)
    expect(key.gaps.every((g) => g.ground_truth.length > 0 && g.location.refs.length > 0)).toBe(true)
    expect(study.deviation_statement).toBe(DEVIATION_STATEMENT)
    expect(DEVIATION_STATEMENT).toContain('不是人类问题发现质量')
  })
})

describe('四读法 hits 全可溯源（负例⑦）', () => {
  it('每个 hit 的 gap_id 都在答案键内；resolvable_source 全真，假者仅 GAP-05（明列）', () => {
    const key = loadAnswerKey(CORPUS)
    const gapIds = new Set(key.gaps.map((g) => g.gap_id))
    for (const [name, r] of Object.entries(study.readings)) {
      const hits = r.hits
      expect(hits.every((h) => gapIds.has(h.gap_id)), name).toBe(true)
      const unresolved = hits.filter((h) => !h.resolvable_source).map((h) => h.gap_id)
      expect(unresolved, name).toEqual(hits.some((h) => h.gap_id === 'GAP-05' && !h.resolvable_source) ? ['GAP-05'] : [])
      // extras = 不可回锚的检出：本语料为 0（出现即答案键污染，红）。
      expect(r.extras, name).toEqual([])
    }
    // GAP-05（finding 指向不存在对象）在两个可达它的读法里都必须标 false，不冒充可回源。
    for (const name of ['associationOnly', 'bothAlternating'] as const) {
      const hit = study.readings[name].hits.find((h) => h.gap_id === 'GAP-05')!
      expect(hit.resolvable_source).toBe(false)
    }
  })
})

describe('per-gap 可达矩阵与检出率（真实运行 golden）', () => {
  it('矩阵逐格锁定：raw 4/7、inference 3/7、association 4/7、both 7/7', () => {
    expect(study.gap_matrix).toEqual([
      { gap_id: 'GAP-01', gap_kind: 'dangling_based_on', rawScan: true, inferenceOnly: true, associationOnly: false, bothAlternating: true },
      { gap_id: 'GAP-02', gap_kind: 'anchorless_association', rawScan: true, inferenceOnly: false, associationOnly: true, bothAlternating: true },
      { gap_id: 'GAP-03', gap_kind: 'shared_deck_no_mechanism', rawScan: false, inferenceOnly: false, associationOnly: true, bothAlternating: true },
      { gap_id: 'GAP-04', gap_kind: 'artifact_sha_unanchored', rawScan: true, inferenceOnly: false, associationOnly: true, bothAlternating: true },
      { gap_id: 'GAP-05', gap_kind: 'finding_target_unresolvable', rawScan: false, inferenceOnly: false, associationOnly: true, bothAlternating: true },
      { gap_id: 'GAP-06', gap_kind: 'no_support_evidence', rawScan: true, inferenceOnly: true, associationOnly: false, bothAlternating: true },
      { gap_id: 'GAP-07', gap_kind: 'failed_run_basis', rawScan: false, inferenceOnly: true, associationOnly: false, bothAlternating: true },
    ])
    expect(study.per_read_detection_rate).toEqual({
      rawScan: { detected: 4, planted: 7 },
      inferenceOnly: { detected: 3, planted: 7 },
      associationOnly: { detected: 4, planted: 7 },
      bothAlternating: { detected: 7, planted: 7 },
    })
  })

  it('成本计数 golden（queries/nodes_visited 真实累加）', () => {
    expect(study.readings.rawScan.cost).toEqual({ queries: 7, nodes_visited: 31 }) // 7 文件单趟；31 行
    expect(study.readings.inferenceOnly.cost).toEqual({ queries: 5, nodes_visited: 62 })
    expect(study.readings.associationOnly.cost).toEqual({ queries: 1, nodes_visited: 42 })
    expect(study.readings.bothAlternating.cost.queries).toBe(
      study.readings.inferenceOnly.cost.queries + study.readings.associationOnly.cost.queries)
    expect(study.readings.bothAlternating.cost.nodes_visited).toBe(
      study.readings.inferenceOnly.cost.nodes_visited + study.readings.associationOnly.cost.nodes_visited)
  })

  it('bothAlternating ⊇ 两单视图 hits 并集；rawScan 无图（查询数=文件数，无视图可查）', () => {
    const bothIds = new Set(study.readings.bothAlternating.hits.map((h) => h.gap_id))
    for (const name of ['inferenceOnly', 'associationOnly'] as const) {
      for (const h of study.readings[name].hits) expect(bothIds.has(h.gap_id), `${name}/${h.gap_id}`).toBe(true)
    }
    const raw = rawScan(CORPUS)
    expect(raw.cost.queries).toBe(study.corpus.files.length)
    expect(study.corpus.files.length).toBeGreaterThanOrEqual(6)
  })
})
