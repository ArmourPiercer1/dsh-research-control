/**
 * V3 PoC · P1 —— V1 只读适配层测试（任务 E）：
 *  - 事件零静默丢失：输入行数 = mapped + unmapped + UNKNOWN 三表之和；
 *  - FACT_RECORDED → claim.candidate + SOURCE_RECORD + 「登记过 Fact 标签 ≠
 *    科学确认」注记；输出键名层面不存在任何科学确认字段；
 *  - 缺字段 → UNKNOWN 表显式保留（不补时间戳/不猜类型）；
 *  - 未知事件类型 → unmapped 表原样保留（含目录已知但 v0.1 故意不映射者）；
 *  - mapped 事件写成逐 run 信封文件后过 P0 校验器零 problems；
 *  - 端到端：转换 → 投影，source_ref 全部可定位。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseEnvelopeFile } from './envelope.ts'
import { projectEvents } from './prov.ts'
import {
  FACT_RECORDED_NOTE,
  V1_CROSSWALK_VERSION,
  convertV1File,
  convertV1Text,
  runFilesOf,
} from './v1adapter.ts'

const POC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const V1_DIR = path.join(POC_ROOT, 'fixtures', 'v1-style')
const SUCCESS = path.join(V1_DIR, 'v1-success-run.jsonl')
const FAILED = path.join(V1_DIR, 'v1-failed-run.jsonl')

let tmpRoot = ''
beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'poc-v1adapter-'))
})
afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

function convertBoth() {
  return {
    success: convertV1File(SUCCESS, { accessBoundary: 'synthetic' }),
    failed: convertV1File(FAILED, { accessBoundary: 'synthetic' }),
  }
}

describe('事件零静默丢失（行数守恒）', () => {
  it('v1-success-run：5 行事件 = mapped 3 + unmapped 2 + UNKNOWN 0', () => {
    const r = convertV1File(SUCCESS, { accessBoundary: 'synthetic' })
    expect(r.counts.mapped + r.counts.unmapped + r.counts.unknown).toBe(r.input_event_lines)
    expect(r.input_event_lines).toBe(5)
    expect(r.counts).toEqual({ mapped: 3, unmapped: 2, unknown: 0 })
    expect(r.comment_lines).toBe(8) // 合成声明头，不计事件
    expect(r.blank_lines).toBe(1)
  })

  it('v1-failed-run：5 行事件 = mapped 3 + unmapped 1 + UNKNOWN 1', () => {
    const r = convertV1File(FAILED, { accessBoundary: 'synthetic' })
    expect(r.counts.mapped + r.counts.unmapped + r.counts.unknown).toBe(r.input_event_lines)
    expect(r.input_event_lines).toBe(5)
    expect(r.counts).toEqual({ mapped: 3, unmapped: 1, unknown: 1 })
  })
})

describe('FACT_RECORDED 不产生任何「科学确认」语义', () => {
  it('映射为 claim.candidate + SOURCE_RECORD，且注入「仅登记过 Fact 标签」注记', () => {
    const r = convertV1File(SUCCESS, { accessBoundary: 'synthetic' })
    const fact = r.mapped.find((e) => (e['v1'] as { event_type?: string }).event_type === 'FACT_RECORDED')!
    expect(fact.kind).toBe('claim.candidate')
    expect(fact.channel).toBe('SOURCE_RECORD')
    expect(fact.unknowns).toContain(FACT_RECORDED_NOTE)
    // V1 原始字段原样保留（statement 不丢）
    expect(fact.payload['statement']).toContain('0.65 mm')
    expect(fact.payload['fact_id']).toBe('F-SYNTH-9')
  })

  it('mapped 输出递归键名扫描：无 standing/confirm/verif/accept/valid/proven 类字段', () => {
    const { success, failed } = convertBoth()
    const FORBIDDEN_KEY = /standing|confirm|verif|accept|valid|proven|truth/i
    const collectKeys = (value: unknown, trail: string, hits: string[]): void => {
      if (Array.isArray(value)) {
        for (const [i, item] of value.entries()) collectKeys(item, `${trail}[${i}]`, hits)
        return
      }
      if (typeof value === 'object' && value !== null) {
        for (const [k, v] of Object.entries(value)) {
          if (FORBIDDEN_KEY.test(k)) hits.push(`${trail}.${k}`)
          collectKeys(v, `${trail}.${k}`, hits)
        }
      }
    }
    const hits: string[] = []
    collectKeys([...success.mapped, ...failed.mapped], '$', hits)
    expect(hits).toEqual([])
  })

  it('端到端投影：FACT 转换物只成 claim_record 实体，零 sosa，不进 derivation', () => {
    const r = convertV1File(SUCCESS, { accessBoundary: 'synthetic' })
    const p = projectEvents([{ file: 'inline://v1-converted-success', events: r.mapped }])
    const claim = p.entities.find((e) => e.roles.includes('claim_record'))!
    expect(claim.statement).toContain('0.65 mm')
    expect(claim.unknowns.some((u) => u.includes('不是已确认事实'))).toBe(true)
    expect(p.activities.some((a) => a.sosa !== null)).toBe(false)
    expect(p.derivation.filter((d) => d.derived_entity_id === claim.id || d.from_entity_id === claim.id)).toEqual([])
  })
})

describe('缺字段 → UNKNOWN，禁止补全', () => {
  it('recordedAt 缺失的 CLAIM_RECORDED 落 UNKNOWN 表，raw 原样保留', () => {
    const r = convertV1File(FAILED, { accessBoundary: 'synthetic' })
    expect(r.unknown_table.length).toBe(1)
    const entry = r.unknown_table[0]!
    expect(entry.event_type).toBe('CLAIM_RECORDED')
    expect(entry.reason).toContain('recordedAt')
    expect((entry.raw as { payload: { claim_id: string } }).payload.claim_id).toBe('C-SYNTH-4')
    // 未被顶替：mapped 里不存在该 claim 的伪造分身
    expect(r.mapped.some((e) => e.kind === 'claim.candidate' && e.payload['claim_id'] === 'C-SYNTH-4')).toBe(false)
  })

  it('occurredAt 缺失同样入 UNKNOWN 表（时间戳不编造）', () => {
    const line = {
      eventId: 'H-T1',
      ownerWorkstreamId: 'WS-T',
      eventSeq: 1,
      eventType: 'RUN_STARTED',
      schemaVersion: 1,
      recordedAt: 1778464841000,
      actor: { kind: 'USER' },
      payload: { run_id: 'R-T1', initiated_by: { kind: 'USER' } },
    }
    const r = convertV1Text(`${JSON.stringify(line)}\n`, 'inline://missing-occurred')
    expect(r.counts).toEqual({ mapped: 0, unmapped: 0, unknown: 1 })
    expect(r.unknown_table[0]!.reason).toContain('occurredAt')
  })

  it('created_by_run 缺失 → 显式 UNATTRIBUTED run 桶 + unknown 注记（不猜归属）', () => {
    const line = {
      eventId: 'H-T2',
      ownerWorkstreamId: 'WS-T2',
      eventSeq: 1,
      eventType: 'ARTIFACT_REGISTERED',
      schemaVersion: 1,
      occurredAt: 1778464800000,
      recordedAt: 1778464841000,
      actor: { kind: 'USER' },
      payload: { artifact_id: 'A-T2', type: 'DATA', title: 't', uri: 'file:///tmp/x' },
    }
    const r = convertV1Text(`${JSON.stringify(line)}\n`, 'inline://no-attribution')
    expect(r.counts.mapped).toBe(1)
    const env = r.mapped[0]!
    expect(env.run_id).toBe('RUN-UNATTRIBUTED-WS-T2')
    expect(env.unknowns.some((u) => String(u).includes('UNATTRIBUTED 桶'))).toBe(true)
  })

  it('actor 缺失 → unknowns 显式记「执行者归因 UNKNOWN」，事件仍映射', () => {
    const line = {
      eventId: 'H-T3',
      ownerWorkstreamId: 'WS-T3',
      eventSeq: 1,
      eventType: 'RUN_STARTED',
      schemaVersion: 1,
      occurredAt: 1778464800000,
      recordedAt: 1778464841000,
      payload: { run_id: 'R-T3', initiated_by: { kind: 'USER' } },
    }
    const r = convertV1Text(`${JSON.stringify(line)}\n`, 'inline://no-actor')
    expect(r.counts.mapped).toBe(1)
    expect(r.mapped[0]!.unknowns.some((u) => String(u).includes('执行者归因记 UNKNOWN'))).toBe(true)
    expect((r.mapped[0]!['v1'] as { actor: unknown }).actor).toBe('UNKNOWN')
  })
})

describe('unmapped：不丢事件、不伪造映射', () => {
  it('目录已知但 v0.1 故意不映射：GATE_EVALUATED / TASK_EXECUTION_CHANGED 带逐类原因', () => {
    const ok = convertV1File(SUCCESS, { accessBoundary: 'synthetic' })
    const gate = ok.unmapped.find((u) => u.event_type === 'GATE_EVALUATED')!
    expect(gate.reason).toContain('验收')
    expect((gate.raw as { payload: { gate_id: string } }).payload.gate_id).toBe('G-STREAK-2')
    const bad = convertV1File(FAILED, { accessBoundary: 'synthetic' })
    const task = bad.unmapped.find((u) => u.event_type === 'TASK_EXECUTION_CHANGED')!
    expect(task.reason).toContain('不投影')
  })

  it('目录外未知 eventType：显式 unmapped，raw 完整保留', () => {
    const r = convertV1File(SUCCESS, { accessBoundary: 'synthetic' })
    const weird = r.unmapped.find((u) => u.event_type === 'SPECTROMETER_PING_LOGGED')!
    expect(weird.reason).toContain('未知 eventType')
    expect(weird.reason).toContain('HISTORY_EVENT_CATALOG.md')
    expect((weird.raw as { payload: { rtt_us: number } }).payload.rtt_us).toBe(812)
  })

  it('RUN_CANCELLED 是显式有损折叠（run.failed + 注记），不是静默改写', () => {
    const line = {
      eventId: 'H-T4',
      ownerWorkstreamId: 'WS-T4',
      eventSeq: 1,
      eventType: 'RUN_CANCELLED',
      schemaVersion: 1,
      occurredAt: 1778464800000,
      recordedAt: 1778464841000,
      actor: { kind: 'USER' },
      payload: { run_id: 'R-T4', reason: 'operator aborted', cancelled_by: { kind: 'USER' } },
    }
    const r = convertV1Text(`${JSON.stringify(line)}\n`, 'inline://cancelled')
    expect(r.counts.mapped).toBe(1)
    expect(r.mapped[0]!.kind).toBe('run.failed')
    expect(r.mapped[0]!.unknowns.some((u) => String(u).includes('RUN_CANCELLED 折叠'))).toBe(true)
    expect(r.mapped[0]!.payload['reason']).toBe('operator aborted')
  })
})

describe('crosswalk 元数据与信封兼容性', () => {
  it('VERSION 常量 = v1crosswalk/0.1（代码常量，#10 §4-P1 版本化 Crosswalk）', () => {
    expect(V1_CROSSWALK_VERSION).toBe('v1crosswalk/0.1')
    const r = convertV1File(SUCCESS, { accessBoundary: 'synthetic' })
    for (const env of r.mapped) {
      expect((env['v1'] as { crosswalk: string }).crosswalk).toBe('v1crosswalk/0.1')
    }
  })

  it('双时序：epoch ms → RFC3339；已是 RFC3339 的字符串原样透传（不 Date 往返）', () => {
    const r = convertV1File(SUCCESS, { accessBoundary: 'synthetic' })
    const started = r.mapped.find((e) => e.kind === 'run.started')!
    expect(started.occurred_at).toBe('2026-05-11T02:00:00.000Z')
    expect(started.recorded_at).toBe('2026-05-11T02:00:41.000Z')
    const finished = r.mapped.find((e) => e.kind === 'run.finished')!
    expect(finished.occurred_at).toBe('2026-05-11T02:41:10Z') // 原样字符串
  })

  it('V1 原始定位（eventId/eventSeq/origin_line）永久保留；信封 event_seq 按 run 从 0 重排', () => {
    const r = convertV1File(SUCCESS, { accessBoundary: 'synthetic' })
    const fact = r.mapped.find((e) => e.kind === 'claim.candidate')!
    const meta = fact['v1'] as { event_id: string; event_seq: number; origin_line: number }
    expect(meta.event_id).toBe('H-3103')
    expect(meta.event_seq).toBe(3) // V1 workstream 内序号
    expect(meta.origin_line).toBe(11) // 声明头 8 行 + 前两条事件 → 第 11 行
    expect(fact.event_seq).toBe(2) // run 文件内 0 基序号
  })

  it('mapped 写成逐 run 信封文件 → P0 校验器零 problems；两次转换字节一致', () => {
    const dir = path.join(tmpRoot, 'converted')
    mkdirSync(dir, { recursive: true })
    const r1 = convertV1File(SUCCESS, { accessBoundary: 'synthetic' })
    const r2 = convertV1File(FAILED, { accessBoundary: 'synthetic' })
    for (const r of [r1, r2]) {
      const files = runFilesOf(r)
      expect(Object.keys(files).length).toBe(1)
      for (const [runId, text] of Object.entries(files)) {
        const p = path.join(dir, `${r === r1 ? 'ok-' : 'bad-'}${runId}.jsonl`)
        writeFileSync(p, text, 'utf8')
        const v = parseEnvelopeFile(p)
        expect(v.problems, `${p}: ${JSON.stringify(v.problems)}`).toEqual([])
        expect(v.events.length).toBeGreaterThan(0)
      }
    }
    const again = runFilesOf(convertV1File(SUCCESS, { accessBoundary: 'synthetic' }))
    expect(again['RUN-V1S-101']).toBe(runFilesOf(r1)['RUN-V1S-101'])
  })

  it('端到端：转换 → 信封文件 → 投影，source_ref 100% 可在转换文件定位', () => {
    const dir = path.join(tmpRoot, 'e2e')
    mkdirSync(dir, { recursive: true })
    const inputs = []
    for (const src of [SUCCESS, FAILED]) {
      const r = convertV1File(src, { accessBoundary: 'synthetic' })
      for (const [runId, text] of Object.entries(runFilesOf(r))) {
        const p = path.join(dir, `${runId}.jsonl`)
        writeFileSync(p, text, 'utf8')
        inputs.push({ file: p, events: parseEnvelopeFile(p).events })
      }
    }
    const proj = projectEvents(inputs)
    expect(proj.unmapped_events).toEqual([])
    const locators = new Map<string, Set<string>>()
    for (const input of inputs) {
      const set = new Set<string>()
      for (const line of readFileSync(input.file, 'utf8').split('\n')) {
        if (!line.trim()) continue
        const o = JSON.parse(line) as { run_id: string; event_seq: number }
        set.add(`${o.run_id}#${o.event_seq}`)
      }
      locators.set(input.file, set)
    }
    const refs = [
      ...proj.activities.map((a) => a.source_ref),
      ...proj.entities.map((e) => e.source_ref),
      ...proj.agents.map((a) => a.source_ref),
      ...proj.usage.map((u) => u.source_ref),
      ...proj.generation.map((g) => g.source_ref),
      ...proj.derivation.map((d) => d.source_ref),
    ]
    expect(refs.length).toBeGreaterThanOrEqual(10)
    for (const ref of refs) {
      expect(locators.get(ref.file)?.has(`${ref.run_id}#${ref.event_seq}`), `定位失败 ${JSON.stringify(ref)}`).toBe(true)
    }
    // 失败 run 投影状态 FAILED（Gate P1「失败 Run 可保留」在 V1 通路的形式）
    expect(proj.activities.find((a) => a.run_id === 'RUN-V1F-202' && a.activity_kind === 'run')!.status).toBe('FAILED')
  })

  it('默认 access_boundary = sanitized-snapshot（真实快照用途）；合成素材必须显式传 synthetic', () => {
    const dflt = convertV1File(SUCCESS)
    expect(dflt.mapped[0]!.access_boundary).toBe('sanitized-snapshot')
    const synth = convertV1File(SUCCESS, { accessBoundary: 'synthetic' })
    expect(synth.mapped[0]!.access_boundary).toBe('synthetic')
  })
})
