/**
 * V3 PoC · P1 —— 投影层测试（任务 E）：
 *  - 投影形状正例（activity/entity/agent/usage/generation/derivation）；
 *  - SOSA 例外正例（deck 执行的数值观测）与负例（analysis.performed 出
 *    sosa:Observation = 测试红；复合观测不配 SOSA；失败 Run 不造 Result）；
 *  - source_ref 100% 可定位（每条投影记录能在其源文件找到该 run_id+event_seq）；
 *  - UNKNOWN 显式保留（缺 run.started、不可解析的 deck/输入等）；
 *  - 纯函数确定性（同输入两次投影逐字节相同；文件/事件乱序输入不影响输出）；
 *  - 逻辑推理依据 based_on 绝不进 prov:wasDerivedFrom。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { normalizeExport, parseEnvelopeFile, type EnvelopeEvent } from './envelope.ts'
import {
  countSosaObservations,
  countSosaResults,
  projectEvents,
  type Projection,
  type ProjectionInput,
  type SourceRef,
} from './prov.ts'

const POC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_DIR = path.join(POC_ROOT, 'fixtures')
const SAMPLE_DIR = path.join(POC_ROOT, 'samples', 'gpt-streak')

const FIXTURE_FILES = [
  'success-run.jsonl',
  'failed-run.jsonl',
  'two-analyses.jsonl',
  'independent-support.jsonl',
  'weak-association.jsonl',
]
const SAMPLE_FILES = ['envelopes.strk-01.jsonl', 'envelopes.strk-02.jsonl', 'envelopes.strk-03.jsonl', 'envelopes.strk-04.jsonl']

function inputsFor(dir: string, files: string[]): ProjectionInput[] {
  return files.map((name) => {
    const file = path.join(dir, name)
    return { file, events: parseEnvelopeFile(file).events }
  })
}

function projectFixtures(): Projection {
  return projectEvents(inputsFor(FIXTURE_DIR, FIXTURE_FILES))
}

function projectSamples(): Projection {
  return projectEvents(inputsFor(SAMPLE_DIR, SAMPLE_FILES))
}

// —— source_ref 100% 可定位：源文件里必须存在该 run_id+event_seq 的事件行 ————

const locatorCache = new Map<string, Set<string>>()
function locatorsOf(filePath: string): Set<string> {
  let set = locatorCache.get(filePath)
  if (!set) {
    set = new Set()
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      const o = JSON.parse(line) as { run_id?: unknown; event_seq?: unknown }
      set.add(`${String(o.run_id)}#${String(o.event_seq)}`)
    }
    locatorCache.set(filePath, set)
  }
  return set
}

function expectLocatable(ref: SourceRef, context: string): void {
  expect(locatorCache.has(ref.file) || locatorCache.set(ref.file, locatorsOf(ref.file)), `${context}: 源文件 ${ref.file} 不存在`).toBeTruthy()
  expect(locatorsOf(ref.file).has(`${ref.run_id}#${ref.event_seq}`), `${context}: ${ref.file} 中找不到 run=${ref.run_id} seq=${ref.event_seq}`).toBe(true)
}

function allSourceRefs(p: Projection): Array<{ ref: SourceRef; context: string }> {
  const out: Array<{ ref: SourceRef; context: string }> = []
  for (const a of p.activities) out.push({ ref: a.source_ref, context: `activity ${a.id}` })
  for (const e of p.entities) {
    out.push({ ref: e.source_ref, context: `entity ${e.id}` })
    for (const seen of e.also_seen_in) out.push({ ref: seen, context: `entity ${e.id} also_seen_in` })
  }
  for (const a of p.agents) out.push({ ref: a.source_ref, context: `agent ${a.id}` })
  for (const u of p.usage) out.push({ ref: u.source_ref, context: `usage ${u.activity_id}->${u.entity_id}` })
  for (const g of p.generation) out.push({ ref: g.source_ref, context: `generation ${g.entity_id}<-${g.activity_id}` })
  for (const d of p.derivation) out.push({ ref: d.source_ref, context: `derivation ${d.derived_entity_id}<-${d.from_entity_id}` })
  return out
}

describe('source_ref 100% 可定位（P0 fixtures + gpt-streak 样本）', () => {
  it('P0 fixtures 投影的每条记录（六表 + also_seen_in）都能回指源事件行', () => {
    const p = projectFixtures()
    const refs = allSourceRefs(p)
    expect(refs.length).toBeGreaterThan(50)
    for (const { ref, context } of refs) expectLocatable(ref, context)
  })

  it('gpt-streak 样本投影同样 100% 可定位', () => {
    const p = projectSamples()
    const refs = allSourceRefs(p)
    expect(refs.length).toBeGreaterThan(30)
    for (const { ref, context } of refs) expectLocatable(ref, context)
  })
})

describe('投影形状正例', () => {
  it('success-run：run/deck_exec/observation 活动 + artifact/deck/结果实体 + 三类边齐全', () => {
    const p = projectEvents(inputsFor(FIXTURE_DIR, ['success-run.jsonl']))
    const runAct = p.activities.find((a) => a.activity_kind === 'run')!
    expect(runAct.run_id).toBe('RUN-SYNTH-SUCCESS-1')
    expect(runAct.prov_type).toBe('prov:Activity')
    expect(runAct.status).toBe('FINISHED')
    expect(runAct.agent).toBe('software:bendix') // payload.solver 归因
    const deckExec = p.activities.find((a) => a.activity_kind === 'deck_execution')!
    expect(deckExec.exit_code).toBe(0)
    // deck 输入被 run 与 deck_exec 使用（prov:used）；实体身份优先按内容哈希，
    // 别名 path:decks/... 指向同一实体（sha 优先规则）。
    const deck = p.entities.find((e) => e.name === 'decks/streak_beamline_v3.in')!
    expect(deck.roles).toContain('deck')
    expect(p.usage.filter((u) => u.entity_id === deck.id).length).toBeGreaterThanOrEqual(2)
    const artifact = p.entities.find((e) => e.name === 'out/synthetic/beam_trace.h5')!
    expect(artifact.roles).toContain('artifact')
    expect(p.generation.some((g) => g.entity_id === artifact.id && g.activity_id === runAct.id)).toBe(true)
    // agent 表含显式 UNKNOWN（run.started 无 tool/solver 时）与 software:bendix
    expect(p.agents.map((a) => a.id).sort()).toEqual(['UNKNOWN', 'software:bendix'])
  })

  it('two-analyses：同一 artifact 上两次分析各成活动，输出实体各一，派生边指回同一输入', () => {
    const p = projectEvents(inputsFor(FIXTURE_DIR, ['two-analyses.jsonl']))
    const analyses = p.activities.filter((a) => a.activity_kind === 'analysis')
    expect(analyses.length).toBe(2)
    expect(analyses.every((a) => a.dsh_subtype === 'dsh:Analysis')).toBe(true)
    const outputs = p.generation.filter((g) => g.activity_id.startsWith('act:analysis:')).map((g) => g.entity_id)
    expect(outputs.length).toBe(2)
    const input = p.entities.find((e) => e.name === 'out/synthetic/beam_scan.h5')!
    const derivs = p.derivation.filter((d) => outputs.includes(d.derived_entity_id))
    expect(derivs.length).toBe(2)
    expect(derivs.every((d) => d.from_entity_id === input.id)).toBe(true)
  })

  it('未映射 kind 显式记账不静默（构造一条投影层未知 kind）', () => {
    const synthetic: EnvelopeEvent = {
      schema: 'poc/prov-envelope/v0',
      source_project: 'neg(P1-synthetic)',
      run_id: 'RUN-P1-NEG-1',
      event_seq: 0,
      occurred_at: '2026-05-01T00:00:00Z',
      recorded_at: '2026-05-01T00:00:30Z',
      snapshot_ref: { kind: 'none', id: 'none', content_sha256: null },
      access_boundary: 'synthetic',
      channel: 'SOURCE_RECORD',
      kind: 'weird.p1.negative',
      payload: {},
      unknowns: ['合成：投影映射表外的 kind'],
    }
    const p = projectEvents([{ file: 'inline://p1-negative', events: [synthetic] }])
    expect(p.unmapped_events).toHaveLength(1)
    expect(p.unmapped_events[0]!.kind).toBe('weird.p1.negative')
  })
})

describe('SOSA 例外纪律（正例）', () => {
  it('deck 执行链上的数值观测 → sosa:Observation + sosa:Result（仿真=测量类比）', () => {
    const p = projectEvents(inputsFor(FIXTURE_DIR, ['success-run.jsonl']))
    const obs = p.activities.filter((a) => a.activity_kind === 'observation')
    expect(obs.length).toBe(1)
    expect(obs[0]!.sosa).toBe('sosa:Observation')
    expect(obs[0]!.sosa_result).not.toBeNull()
    expect(obs[0]!.sosa_result!.observed_property).toBe('emittance_envelope_rms')
    expect(obs[0]!.sosa_result!.has_simple_result).toBe(0.00000421)
    expect(obs[0]!.sosa_result!.unit).toBe('m*rad')
    const result = p.entities.find((e) => e.sosa_role === 'sosa:Result')!
    expect(p.generation.some((g) => g.entity_id === result.id && g.activity_id === obs[0]!.id)).toBe(true)
    // 被观测数据（该 run 登记的产物）解析成功并挂 prov:used
    expect(obs[0]!.observed_entity_id.startsWith('ent:')).toBe(true)
    expect(p.usage.some((u) => u.activity_id === obs[0]!.id)).toBe(true)
  })

  it('五例合计观测数=3、Result 数=3（success 1 + independent-support 2）', () => {
    const p = projectFixtures()
    expect(countSosaObservations(p)).toBe(3)
    expect(countSosaResults(p)).toBe(3)
  })
})

describe('SOSA 例外纪律（负例——若实现破戒，这些测试立即红）', () => {
  it('analysis.performed 绝不出 sosa:Observation/sosa:Result（含 two-analyses 的数值输出）', () => {
    const p = projectEvents(inputsFor(FIXTURE_DIR, ['two-analyses.jsonl']))
    const analyses = p.activities.filter((a) => a.activity_kind === 'analysis')
    expect(analyses.length).toBeGreaterThan(0)
    // 任何分析活动带 sosa 标记 = 破戒（任务 E 明示的红灯条件）
    expect(analyses.filter((a) => a.sosa !== null)).toEqual([])
    expect(analyses.filter((a) => a.sosa_result !== null)).toEqual([])
    // 分析的生成边所指向的实体一律不是 sosa:Result
    const analysisGenerated = p.generation
      .filter((g) => g.activity_id.startsWith('act:analysis:'))
      .map((g) => p.entities.find((e) => e.id === g.entity_id)!)
    expect(analysisGenerated.length).toBeGreaterThan(0)
    expect(analysisGenerated.filter((e) => e.sosa_role === 'sosa:Result')).toEqual([])
    // 数值结果仍以 prov:Entity 保留（不丢数据）
    expect(analysisGenerated.every((e) => e.entity_type === 'prov:Entity')).toBe(true)
  })

  it('gpt-streak 的 analysis.performed（含 readout 数值）同样零 SOSA', () => {
    const p = projectSamples()
    const analyses = p.activities.filter((a) => a.activity_kind === 'analysis')
    expect(analyses.length).toBe(2) // strk-02 seq4/seq5
    expect(analyses.filter((a) => a.sosa !== null)).toEqual([])
  })

  it('复合/跨 run 观测（strk-04 quantities 数组）不配 SOSA，只作记录实体+显式 unknown', () => {
    const p = projectSamples()
    const obs = p.activities.filter((a) => a.activity_kind === 'observation')
    expect(obs.length).toBe(1)
    expect(obs[0]!.sosa).toBeNull()
    expect(obs[0]!.sosa_result).toBeNull()
    expect(obs[0]!.unknowns.some((u) => u.includes('不建 sosa:Observation'))).toBe(true)
    expect(countSosaObservations(p)).toBe(0)
    expect(countSosaResults(p)).toBe(0)
  })

  it('失败 Run（failed-run / strk-01）保留活动与错误记录，零伪造 Result', () => {
    const p = projectEvents(inputsFor(FIXTURE_DIR, ['failed-run.jsonl']))
    const runAct = p.activities.find((a) => a.activity_kind === 'run')!
    expect(runAct.status).toBe('FAILED')
    expect(runAct.sosa_result).toBeNull()
    expect(countSosaObservations(p)).toBe(0)
    expect(countSosaResults(p)).toBe(0)
  })

  it('全量投影中每个 sosa:Result 都由 sosa:Observation 活动生成（无凭空 Result）', () => {
    for (const p of [projectFixtures(), projectSamples()]) {
      const sosaActs = new Set(p.activities.filter((a) => a.sosa === 'sosa:Observation').map((a) => a.id))
      for (const g of p.generation) {
        const ent = p.entities.find((e) => e.id === g.entity_id)!
        if (ent.sosa_role === 'sosa:Result') expect(sosaActs.has(g.activity_id), `Result ${ent.id} 的生成活动不是 sosa:Observation`).toBe(true)
      }
    }
  })
})

describe('派生 ≠ 证明：based_on 推理依据不进 prov:wasDerivedFrom', () => {
  it('independent-support 的 claim.candidate：based_on 保留在实体上、derivation 表无 claim', () => {
    const p = projectEvents(inputsFor(FIXTURE_DIR, ['independent-support.jsonl']))
    const claim = p.entities.find((e) => e.roles.includes('claim_record'))!
    expect(claim.based_on_refs).toEqual([
      { run_id: 'RUN-SYNTH-INDSUP-1', seq: 3 },
      { run_id: 'RUN-SYNTH-INDSUP-1', seq: 6 },
    ])
    expect(claim.unknowns.some((u) => u.includes('不投影为 prov:wasDerivedFrom'))).toBe(true)
    const claimIds = new Set(p.entities.filter((e) => e.roles.includes('claim_record') || e.roles.includes('note_record')).map((e) => e.id))
    expect(p.derivation.filter((d) => claimIds.has(d.derived_entity_id) || claimIds.has(d.from_entity_id))).toEqual([])
  })

  it('跨文件 based_on（strk-04 {run_id,seq}）同样只进 based_on_refs', () => {
    const p = projectSamples()
    const claim = p.entities.find((e) => e.roles.includes('claim_record'))!
    expect(claim.based_on_refs).toEqual([
      { run_id: 'RUN-STRK-02', seq: 5 },
      { run_id: 'RUN-STRK-03', seq: 2 },
    ])
  })
})

describe('UNKNOWN 显式保留而非省略', () => {
  it('strk-01（缺 run.started）：run 活动 started_at=UNKNOWN + 显式注记；状态 FAILED', () => {
    const p = projectEvents(inputsFor(SAMPLE_DIR, ['envelopes.strk-01.jsonl']))
    const runAct = p.activities.find((a) => a.activity_kind === 'run')!
    expect(runAct.started_at).toBe('UNKNOWN')
    expect(runAct.status).toBe('FAILED')
    expect(runAct.unknowns.some((u) => u.startsWith('run_started_missing'))).toBe(true)
    expect(runAct.exit_code).toBe(3)
  })

  it('strk-03（缺 run.started，run.finished 补终态）：FINISHED + started_at UNKNOWN 并存', () => {
    const p = projectEvents(inputsFor(SAMPLE_DIR, ['envelopes.strk-03.jsonl']))
    const runAct = p.activities.find((a) => a.activity_kind === 'run')!
    expect(runAct.status).toBe('FINISHED')
    expect(runAct.started_at).toBe('UNKNOWN')
  })

  it('无终态事件的 run 停留 RUNNING 并注记（不伪造终态）；deck 不可解析时实体退到 (file,seq) 身份', () => {
    const onlyStart: EnvelopeEvent = {
      schema: 'poc/prov-envelope/v0',
      source_project: 'neg(P1-synthetic)',
      run_id: 'RUN-P1-RUNNING-1',
      event_seq: 0,
      occurred_at: '2026-05-01T00:00:00Z',
      recorded_at: '2026-05-01T00:00:30Z',
      snapshot_ref: { kind: 'none', id: 'UNKNOWN', content_sha256: null },
      access_boundary: 'synthetic',
      channel: 'SOURCE_RECORD',
      kind: 'run.started',
      payload: { deck_path: 'decks/only-start.in' },
      unknowns: ['合成：无终态事件'],
    }
    const execNoDeck: EnvelopeEvent = {
      ...onlyStart,
      event_seq: 1,
      kind: 'deck.executed',
      payload: { exit_code: 0 },
      snapshot_ref: { kind: 'none', id: 'UNKNOWN', content_sha256: null },
    }
    const p = projectEvents([{ file: 'inline://p1-running', events: [onlyStart, execNoDeck] }])
    const runAct = p.activities.find((a) => a.activity_kind === 'run')!
    expect(runAct.status).toBe('RUNNING')
    expect(runAct.unknowns.some((u) => u.includes('不伪造终态'))).toBe(true)
    const exec = p.activities.find((a) => a.activity_kind === 'deck_execution')!
    expect(exec.unknowns.some((u) => u.includes('deck 实体记 UNKNOWN'))).toBe(true)
  })

  it('观测载荷无 metric/subject 可解析时 sosa 侧字段仍显式 UNKNOWN（构造例）', () => {
    const obs: EnvelopeEvent = {
      schema: 'poc/prov-envelope/v0',
      source_project: 'neg(P1-synthetic)',
      run_id: 'RUN-P1-OBS-1',
      event_seq: 0,
      occurred_at: '2026-05-01T00:00:00Z',
      recorded_at: '2026-05-01T00:00:30Z',
      snapshot_ref: { kind: 'none', id: 'UNKNOWN', content_sha256: null },
      access_boundary: 'synthetic',
      channel: 'SOURCE_RECORD',
      kind: 'observation.recorded',
      payload: { value: 1.5 },
      unknowns: [],
    }
    const p = projectEvents([{ file: 'inline://p1-obs', events: [obs] }])
    const a = p.activities.find((x) => x.activity_kind === 'observation')!
    expect(a.sosa).toBe('sosa:Observation') // 数值观测符合测量类比
    expect(a.observed_entity_id).toBe('UNKNOWN') // 但被观测对象缺失必须显式
    expect(a.unknowns.some((u) => u.includes('observed_entity_id 记 UNKNOWN'))).toBe(true)
    expect(a.sosa_result!.observed_property).toBe('UNKNOWN')
  })
})

describe('纯函数确定性', () => {
  it('同输入两次投影 JSON.stringify 逐字节相同', () => {
    const a = projectFixtures()
    const b = projectFixtures()
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('文件顺序与事件顺序乱序输入 → 输出不变（内部排序确定性）', () => {
    const inputs = inputsFor(FIXTURE_DIR, FIXTURE_FILES)
    const ordered = projectEvents(inputs)
    const shuffledFiles = projectEvents([...inputs].reverse())
    const shuffledEvents = projectEvents(inputs.map((i) => ({ file: i.file, events: [...i.events].reverse() })))
    expect(JSON.stringify(shuffledFiles)).toBe(JSON.stringify(ordered))
    expect(JSON.stringify(shuffledEvents)).toBe(JSON.stringify(ordered))
  })

  it('投影事件经 normalizeExport 亦字节稳定（与信封规范化器互操作）', () => {
    const events: EnvelopeEvent[] = parseEnvelopeFile(path.join(FIXTURE_DIR, 'success-run.jsonl')).events
    expect(normalizeExport(events)).toBe(normalizeExport([...events]))
  })
})
