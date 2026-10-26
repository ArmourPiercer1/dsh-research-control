/**
 * V3 PoC · P0 —— 信封校验器测试（任务 B/F：fixture 全绿 + 五类坏文件 +
 * 幂等导出 + 双时序稳定 + golden 一致性）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { normalizeExport, parseEnvelopeFile, type EnvelopeEvent, type Problem } from './envelope.ts'

const POC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_DIR = path.join(POC_ROOT, 'fixtures')
const GOLDEN_DIR = path.join(POC_ROOT, 'golden')
const FIXTURE_FILES = [
  'success-run.jsonl',
  'failed-run.jsonl',
  'two-analyses.jsonl',
  'independent-support.jsonl',
  'weak-association.jsonl',
] as const

function fixturePath(name: string): string {
  return path.join(FIXTURE_DIR, name)
}

function kindsOf(problems: Problem[]): string[] {
  return problems.map((p) => p.kind)
}

// —— B：五个合成 fixture 全部零 problems ——————————————————————————————

describe('P0 fixtures 全部通过信封校验', () => {
  for (const name of FIXTURE_FILES) {
    it(`${name}：parse 零 problems，seq 连续，unknowns 均为数组`, () => {
      const { events, problems } = parseEnvelopeFile(fixturePath(name))
      expect(problems, JSON.stringify(problems)).toEqual([])
      expect(events.length).toBeGreaterThan(0)
      expect(events.length).toBeLessThanOrEqual(10)
      expect(events.map((e) => e.event_seq)).toEqual(events.map((_e, i) => i))
      for (const event of events) {
        expect(Array.isArray(event.unknowns)).toBe(true)
      }
      const unknownTotal = events.reduce((sum, e) => sum + e.unknowns.length, 0)
      expect(unknownTotal, '每个合成案例必须显式保留未知项').toBeGreaterThan(0)
    })
  }
})

describe('P0 fixtures 语义形状（与 #10 §4-P0 工作项一一对应）', () => {
  it('success-run：成功链 run.started→deck.executed→artifact.registered→observation.recorded→run.finished', () => {
    const { events } = parseEnvelopeFile(fixturePath('success-run.jsonl'))
    expect(events.map((e) => e.kind)).toEqual([
      'run.started',
      'deck.executed',
      'artifact.registered',
      'observation.recorded',
      'run.finished',
    ])
    expect(events.every((e) => e.channel === 'SOURCE_RECORD')).toBe(true)
  })

  it('failed-run：run.failed 保留故障 payload，且无伪造正常结果（无 observation.recorded）', () => {
    const { events } = parseEnvelopeFile(fixturePath('failed-run.jsonl'))
    expect(events.at(-1)!.kind).toBe('run.failed')
    const failed = events.at(-1)!
    expect(failed.payload['error_class']).toBeTypeOf('string')
    expect(failed.payload['valid_result']).toBe(false)
    expect(events.some((e) => e.kind === 'observation.recorded')).toBe(false)
    expect(events.some((e) => e.kind === 'run.finished')).toBe(false)
  })

  it('two-analyses：同一 content_sha256 数据两版 analysis.performed 得两个不同 Result', () => {
    const { events } = parseEnvelopeFile(fixturePath('two-analyses.jsonl'))
    const analyses = events.filter((e) => e.kind === 'analysis.performed')
    expect(analyses.length).toBe(2)
    const [v1, v2] = analyses as [EnvelopeEvent, EnvelopeEvent]
    expect(v1.snapshot_ref.content_sha256).toBe(v2.snapshot_ref.content_sha256)
    expect(v1.payload['input_sha256']).toBe(v2.payload['input_sha256'])
    expect(v1.payload['value']).not.toBe(v2.payload['value'])
  })

  it('independent-support：claim.candidate 基于两条独立 observation；受质疑机制经 note.unknown 保留、证据不删', () => {
    const { events } = parseEnvelopeFile(fixturePath('independent-support.jsonl'))
    const claim = events.find((e) => e.kind === 'claim.candidate')!
    expect(claim.channel).toBe('RESEARCHER_INFERENCE')
    expect(claim.payload['based_on']).toEqual([3, 6])
    const obs = events.filter((e) => e.kind === 'observation.recorded')
    expect(obs.length).toBe(2)
    expect(obs[0]!.snapshot_ref.id).not.toBe(obs[1]!.snapshot_ref.id) // 两条独立路径（不同 deck）
    // 受质疑的 O2 观测仍在源记录里（不删证据），质疑以 note.unknown 表达。
    const o2 = events.find((e) => e.event_seq === 6)!
    expect(o2.kind).toBe('observation.recorded')
    const note = events.find((e) => e.kind === 'note.unknown')!
    expect(String(note.payload['details'])).toContain('余辉')
  })

  it('weak-association：仅时间相邻的 artifact+claim，unknowns 声明无机制证据', () => {
    const { events } = parseEnvelopeFile(fixturePath('weak-association.jsonl'))
    const claim = events.find((e) => e.kind === 'claim.candidate')!
    expect(claim.channel).toBe('RESEARCHER_INFERENCE')
    expect(claim.payload['based_on']).toEqual([1])
    expect(claim.payload['association_basis']).toBe('time_adjacency_only')
    const unknownText = claim.unknowns.join('；')
    expect(unknownText).toContain('无机制证据')
    // 除被引用的 artifact 外没有 observation——弱关联没有独立证据。
    expect(events.some((e) => e.kind === 'observation.recorded')).toBe(false)
  })
})

// —— F 负例：五类坏文件（os.tmpdir，逐一断言 problems 命中且 kind 区分）——————

interface RawEvent {
  [key: string]: unknown
}

function baseEvent(overrides: Partial<RawEvent>): RawEvent {
  return {
    schema: 'poc/prov-envelope/v0',
    source_project: 'neg-test(P0-synthetic)',
    run_id: 'RUN-NEG-1',
    event_seq: 0,
    occurred_at: '2026-03-01T00:00:00Z',
    recorded_at: '2026-03-01T00:00:30Z',
    snapshot_ref: { kind: 'deck', id: 'decks/neg.in', content_sha256: 'a'.repeat(64) },
    access_boundary: 'synthetic',
    channel: 'SOURCE_RECORD',
    kind: 'run.started',
    payload: {},
    unknowns: [],
    ...overrides,
  }
}

let tmpRoot = ''

function writeBadFile(name: string, events: RawEvent[]): string {
  const filePath = path.join(tmpRoot, name)
  writeFileSync(filePath, `${events.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8')
  return filePath
}

describe('F 负例：五类坏文件被拒绝且 kind 可区分', () => {
  beforeAll(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'poc-env-neg-'))
  })
  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  const cases: Array<{ name: string; expectedKind: string; events: RawEvent[] }> = [
    {
      name: 'bad-gap.jsonl',
      expectedKind: 'event_seq_gap',
      events: [
        baseEvent({ event_seq: 0 }),
        baseEvent({ event_seq: 1, kind: 'deck.executed' }),
        baseEvent({ event_seq: 3, kind: 'run.finished' }), // 跳过 2：断号
      ],
    },
    {
      name: 'bad-duplicate.jsonl',
      expectedKind: 'event_seq_duplicate',
      events: [
        baseEvent({ event_seq: 0 }),
        baseEvent({ event_seq: 1, kind: 'deck.executed' }),
        baseEvent({ event_seq: 1, kind: 'run.finished' }), // 重号
      ],
    },
    {
      name: 'bad-channel.jsonl',
      expectedKind: 'bad_channel',
      events: [baseEvent({ channel: 'MODEL_GUESS' })],
    },
    {
      name: 'bad-speculation-in-source.jsonl',
      expectedKind: 'speculation_in_source_record',
      events: [
        baseEvent({
          kind: 'observation.recorded',
          payload: { metric: 'emittance_envelope_rms', nested: { inference: '也许漂移了' } },
        }),
      ],
    },
    {
      name: 'bad-dangling-based-on.jsonl',
      expectedKind: 'dangling_based_on',
      events: [
        baseEvent({ event_seq: 0 }),
        baseEvent({
          event_seq: 1,
          kind: 'claim.candidate',
          channel: 'RESEARCHER_INFERENCE',
          payload: { claim: '悬空引用', based_on: [99] }, // 本文件没有 seq 99
        }),
      ],
    },
  ]

  const seenKinds: string[] = []
  for (const testCase of cases) {
    it(`${testCase.name}：problems 恰好命中 ${testCase.expectedKind}`, () => {
      const { problems } = parseEnvelopeFile(writeBadFile(testCase.name, testCase.events))
      const kinds = kindsOf(problems)
      expect(kinds).toContain(testCase.expectedKind)
      expect(kinds).toEqual([testCase.expectedKind]) // 其余校验保持安静，kind 一一对应
      seenKinds.push(testCase.expectedKind)
    })
  }
  it('五类坏文件的 kind 互不相同（可区分）', () => {
    expect(new Set(seenKinds).size).toBe(cases.length)
  })

  it('补充：推测通道缺 based_on 命中 missing_based_on', () => {
    const file = writeBadFile('bad-missing-based-on.jsonl', [
      baseEvent({ kind: 'claim.candidate', channel: 'RESEARCHER_INFERENCE', payload: { claim: '没有依据' } }),
    ])
    expect(kindsOf(parseEnvelopeFile(file).problems)).toEqual(['missing_based_on'])
  })
})

// —— F 幂等 + 双时序 ————————————————————————————————————————————————

describe('normalizeExport 幂等（硬规则 3）与双时序稳定', () => {
  const { events } = parseEnvelopeFile(fixturePath('success-run.jsonl'))

  it('同一 parse 结果两次导出逐字节相同', () => {
    expect(normalizeExport(events)).toBe(normalizeExport(structuredClone(events)))
  })

  it('两次独立读取同一文件 → 导出逐字节相同（重复导入幂等）', () => {
    const a = normalizeExport(parseEnvelopeFile(fixturePath('two-analyses.jsonl')).events)
    const b = normalizeExport(parseEnvelopeFile(fixturePath('two-analyses.jsonl')).events)
    expect(a).toBe(b)
  })

  it('导出与输入键序无关（键递归排序 → 稳定字节序）', () => {
    const original = normalizeExport([events[0]!])
    const shuffled = structuredClone(events[0]!)
    const reordered = Object.fromEntries(Object.entries(shuffled).reverse()) as EnvelopeEvent
    expect(normalizeExport([reordered])).toBe(original)
  })

  it('导出行内键为字典序且逐行一条 JSON', () => {
    const out = normalizeExport(events)
    const lines = out.split('\n')
    expect(lines.at(-1)).toBe('') // 恰以一个换行结尾
    expect(lines.length - 1).toBe(events.length)
    for (const line of lines.slice(0, -1)) {
      const keys = Object.keys(JSON.parse(line) as Record<string, unknown>)
      expect(keys).toEqual([...keys].sort())
    }
  })

  it('空输入导出空串', () => {
    expect(normalizeExport([])).toBe('')
  })

  it('成功与失败 fixture：occurred_at ≠ recorded_at（双时序），且同一事件两次读取值稳定、字段不可互替', () => {
    for (const name of ['success-run.jsonl', 'failed-run.jsonl'] as const) {
      const first = parseEnvelopeFile(fixturePath(name)).events
      const second = parseEnvelopeFile(fixturePath(name)).events
      expect(first.length).toBe(second.length)
      for (let i = 0; i < first.length; i++) {
        const a = first[i]!
        const b = second[i]!
        // 双时序都合法且各自稳定（不是 Date 往返生成的抖动值）。
        expect(a.occurred_at).toBeTypeOf('string')
        expect(a.recorded_at).toBeTypeOf('string')
        expect(a.occurred_at).not.toBe(a.recorded_at) // 可不同
        expect(b.occurred_at).toBe(a.occurred_at) // 两次读取值稳定
        expect(b.recorded_at).toBe(a.recorded_at) // 不可互相顶替
        expect(Date.parse(a.occurred_at)).not.toBeNaN()
      }
    }
  })
})

// —— C：golden annotation 形状与一致性 ————————————————————————————————

interface GoldenAssertion {
  assertion: string
  supported_by: number[]
  truly_supported: boolean
  unrecorded: string[]
}
interface GoldenAnnotation {
  fixture: string
  annotator: string
  basis: string
  assertions: GoldenAssertion[]
  disagreements: unknown[]
}

describe('golden annotations（two-analyses / independent-support）', () => {
  for (const name of ['two-analyses.json', 'independent-support.json']) {
    it(`${name}：形状合 SPEC，supported_by 命中 fixture seq，unrecorded 真列出未记录信息`, () => {
      const golden = JSON.parse(readFileSync(path.join(GOLDEN_DIR, name), 'utf8')) as GoldenAnnotation
      expect(golden.annotator).toBe('dsh-poc-annotator(P0-synthetic)')
      expect(golden.basis).toContain(name.replace('.json', '.jsonl'))
      const fixtureName = golden.fixture.replace(/^fixtures\//, '')
      expect(FIXTURE_FILES).toContain(fixtureName as never)
      const { events, problems } = parseEnvelopeFile(fixturePath(fixtureName))
      expect(problems).toEqual([])
      const seqSet = new Set(events.map((e) => e.event_seq))
      expect(Array.isArray(golden.disagreements)).toBe(true)
      expect(golden.assertions.length).toBeGreaterThan(0)
      for (const assertion of golden.assertions) {
        expect(assertion.assertion.length).toBeGreaterThan(0)
        expect(typeof assertion.truly_supported).toBe('boolean')
        expect(Array.isArray(assertion.supported_by)).toBe(true)
        for (const seq of assertion.supported_by) expect(seqSet.has(seq)).toBe(true)
        if (assertion.truly_supported) expect(assertion.supported_by.length).toBeGreaterThan(0)
        // unrecorded 必须真列出该结论其实没有的信息（非空、非占位）。
        expect(assertion.unrecorded.length).toBeGreaterThan(0)
        for (const item of assertion.unrecorded) expect(item.length).toBeGreaterThan(4)
      }
    })
  }
})

describe('SPEC v0.1 — 跨文件 based_on 解析表', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'poc-xref-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const env = (run: string, seq: number, over: Record<string, unknown> = {}) => JSON.stringify({
    schema: 'poc/prov-envelope/v0', source_project: 'x', run_id: run, event_seq: seq,
    occurred_at: '2026-10-27T00:00:00Z', recorded_at: '2026-10-27T00:00:01Z',
    snapshot_ref: { kind: 'none', id: 'x', content_sha256: null },
    access_boundary: 'synthetic', channel: 'SOURCE_RECORD', kind: 'run.started',
    payload: {}, unknowns: [], ...over,
  })
  it('整数=同文件；{run_id,seq}=解析表；未知 run/越界 seq/坏形状各自判红', () => {
    const base = path.join(dir, 'base.jsonl')
    writeFileSync(base, [env('RUN-A', 0), env('RUN-A', 1)].join('\n') + '\n')
    const infer = (refs: unknown) => env('RUN-B', 0, {
      channel: 'RESEARCHER_INFERENCE', kind: 'claim.candidate', payload: { based_on: refs },
    })
    const good = path.join(dir, 'b-good.jsonl')
    writeFileSync(good, infer([{ run_id: 'RUN-A', seq: 1 }]) + '\n')
    const known = new Map([['RUN-A', new Set([0, 1])]])
    expect(parseEnvelopeFile(good, { knownRuns: known }).problems).toEqual([])
    // 无解析表 → 外部引用悬空
    expect(parseEnvelopeFile(good).problems.some((p) => p.kind === 'dangling_external_ref')).toBe(true)
    // 越界 seq
    const oob = path.join(dir, 'b-oob.jsonl')
    writeFileSync(oob, infer([{ run_id: 'RUN-A', seq: 9 }]) + '\n')
    expect(parseEnvelopeFile(oob, { knownRuns: known }).problems.some((p) => p.kind === 'dangling_external_ref')).toBe(true)
    // 坏形状
    const bad = path.join(dir, 'b-bad.jsonl')
    writeFileSync(bad, infer([{ run_id: 'RUN-A' }]) + '\n')
    expect(parseEnvelopeFile(bad, { knownRuns: known }).problems.some((p) => p.kind === 'bad_based_on')).toBe(true)
    // 旧形状（整数）仍有效——向后兼容
    const legacy = path.join(dir, 'b-legacy.jsonl')
    writeFileSync(legacy, [env('RUN-B', 0, { kind: 'artifact.registered' }),
      env('RUN-B', 1, { channel: 'RESEARCHER_INFERENCE', kind: 'claim.candidate', payload: { based_on: [0] } })].join('\n') + '\n')
    expect(parseEnvelopeFile(legacy, { knownRuns: known }).problems).toEqual([])
  })
})
