/**
 * V3 PoC · P1 —— 重放器测试（任务 E）：
 *  - 重放幂等：同一输入两次构建 → exportReplayView / exportReplayEvents
 *    （normalizeExport 语义）逐字节一致；
 *  - 重复导入同一 run 文件 → 幂等合并，不重复实体；导入顺序不影响结果；
 *  - Run 时间线视图：事件序、输入产物、执行状态（失败 Run 保留不伪造结果）、
 *    未知项、源定位；
 *  - 断链（based_on 解析表外引用）与 unknowns 非空的源 → unresolved 显式列表，
 *    不报错也不静默；不可读文件同样显式入账。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseEnvelopeFile } from './envelope.ts'
import {
  buildReplayView,
  createReplayState,
  exportReplayEvents,
  exportReplayView,
  importRunFiles,
  listEnvelopeFiles,
  type ReplayView,
} from './replay.ts'

const POC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_DIR = path.join(POC_ROOT, 'fixtures')
const SAMPLE_DIR = path.join(POC_ROOT, 'samples', 'gpt-streak')

let tmpRoot = ''
beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'poc-replay-'))
})
afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

function buildFixturesView(): ReplayView {
  const state = createReplayState()
  importRunFiles(state, listEnvelopeFiles(FIXTURE_DIR))
  return buildReplayView(state)
}

describe('重放幂等（Gate P1 第一条的机制层形式）', () => {
  it('同一输入两次构建 → exportReplayView 逐字节一致', () => {
    const state = createReplayState()
    importRunFiles(state, listEnvelopeFiles(FIXTURE_DIR))
    const first = exportReplayView(buildReplayView(state))
    const second = exportReplayView(buildReplayView(state))
    expect(second).toBe(first)
    expect(first.length).toBeGreaterThan(1000)
  })

  it('同一输入两次构建 → exportReplayEvents（normalizeExport）逐字节一致', () => {
    const a = exportReplayEvents(buildFixturesView())
    const b = exportReplayEvents(buildFixturesView())
    expect(b).toBe(a)
    expect(a.split('\n').filter(Boolean).length).toBe(29) // 5 个 fixture 共 29 事件
  })

  it('重复导入同一 run 文件 → 幂等合并，实体/事件不翻倍', () => {
    const state = createReplayState()
    const files = listEnvelopeFiles(FIXTURE_DIR)
    importRunFiles(state, files)
    const baseline = buildReplayView(state)
    const again = importRunFiles(state, files)
    expect(again.imported).toEqual([]) // 全部命中 already_present
    expect(again.already_present.length).toBe(files.length)
    const after = buildReplayView(state)
    expect(after.stats.entities).toBe(baseline.stats.entities)
    expect(after.stats.event_count).toBe(baseline.stats.event_count)
    expect(exportReplayView(after)).toBe(exportReplayView(baseline))
  })

  it('导入顺序不影响结果（fixtures 与 samples 两批，交换顺序导出一致）', () => {
    const ab = createReplayState()
    importRunFiles(ab, listEnvelopeFiles(FIXTURE_DIR))
    importRunFiles(ab, listEnvelopeFiles(SAMPLE_DIR))
    const ba = createReplayState()
    importRunFiles(ba, listEnvelopeFiles(SAMPLE_DIR))
    importRunFiles(ba, listEnvelopeFiles(FIXTURE_DIR))
    expect(exportReplayView(buildReplayView(ba))).toBe(exportReplayView(buildReplayView(ab)))
  })
})

describe('Run 时间线视图', () => {
  it('5 个 fixture = 5 个 run；事件按 seq 升序且状态由事件推出', () => {
    const view = buildFixturesView()
    expect(view.stats.run_count).toBe(5)
    for (const run of view.runs) {
      expect(run.events.map((e) => e.event_seq)).toEqual(run.events.map((_e, i) => i))
      expect(run.event_count).toBe(run.events.length)
      expect(['FAILED', 'FINISHED', 'RUNNING']).toContain(run.status)
      // 源定位三元组：每条事件带 file+run_id+event_seq
      for (const e of run.events) {
        expect(e.file.length).toBeGreaterThan(0)
        expect(path.basename(e.file).endsWith('.jsonl')).toBe(true)
      }
    }
  })

  it('失败 Run 保留：status=FAILED、ended_at 有值、无伪造正常结果', () => {
    const run = buildFixturesView().runs.find((r) => r.run_id === 'RUN-SYNTH-FAILED-1')!
    expect(run.status).toBe('FAILED')
    expect(run.ended_at).not.toBe('UNKNOWN')
    // 部分产物可登记（数据实体合法存在），但没有任何 sosa 观测/结果
    const view = buildFixturesView()
    expect(view.projection.activities.filter((a) => a.run_id === run.run_id && a.sosa !== null)).toEqual([])
    expect(view.stats.sosa_results).toBe(3) // 全部 Result 都在别的 run（success/independent-support）
    const sosaResultRunIds = view.projection.generation
      .filter((g) => view.projection.entities.find((e) => e.id === g.entity_id && e.sosa_role === 'sosa:Result'))
      .map((g) => view.projection.activities.find((a) => a.id === g.activity_id)!.run_id)
    expect(sosaResultRunIds).not.toContain('RUN-SYNTH-FAILED-1')
  })

  it('two-analyses：两次分析的输入解析到同一数据实体（prov:used 输入产物可见）', () => {
    const view = buildFixturesView()
    const run = view.runs.find((r) => r.run_id === 'RUN-SYNTH-2ANALYSIS-1')!
    const inputIds = view.projection.usage
      .filter((u) => u.activity_id.startsWith('act:analysis:'))
      .map((u) => u.entity_id)
    expect(inputIds.length).toBe(2)
    // 两版分析共用同一输入实体（按内容哈希/路径别名合并；跨文件同哈希 fake
    // sha 的合并是投影的身份规则，also_seen_in 保留全部来源）
    expect(new Set(inputIds).size).toBe(1)
    expect(run.output_entity_ids.length).toBeGreaterThan(0)
  })

  it('每个带 unknowns 的事件都在 unresolved 里有逐条 unknown_item（不静默）', () => {
    const view = buildFixturesView()
    let expected = 0
    for (const f of listEnvelopeFiles(FIXTURE_DIR)) {
      for (const e of parseEnvelopeFile(f).events) expected += e.unknowns.length
    }
    const items = view.unresolved.filter((u) => u.kind === 'unknown_item')
    expect(items.length).toBe(expected)
    expect(view.stats.unknown_item_count).toBe(expected)
    for (const item of items) {
      expect(typeof item.event_seq).toBe('number')
      expect(item.run_id).not.toBeNull()
    }
  })
})

describe('断链与坏输入：不报错也不静默', () => {
  it('based_on 解析表外引用 → unresolved 显式条目，构建不抛、事件不丢', () => {
    const dir = path.join(tmpRoot, 'dangling')
    mkdirSync(dir, { recursive: true })
    const good = parseEnvelopeFile(path.join(FIXTURE_DIR, 'success-run.jsonl')).events[0]!
    const bad = {
      ...good,
      event_seq: 1,
      kind: 'note.unknown',
      channel: 'RESEARCHER_INFERENCE',
      payload: { topic: '跨 run 悬空引用', based_on: [{ run_id: 'RUN-DOES-NOT-EXIST', seq: 0 }] },
    }
    writeFileSync(
      path.join(dir, 'only.jsonl'),
      [good, bad].map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf8',
    )
    const state = createReplayState()
    importRunFiles(state, [path.join(dir, 'only.jsonl')])
    const view = buildReplayView(state) // 不抛
    const dangling = view.unresolved.filter((u) => u.kind === 'validator_dangling_external_ref')
    expect(dangling.length).toBe(1)
    expect(dangling[0]!.message).toContain('RUN-DOES-NOT-EXIST')
    // 事件保留在视图里（不静默删除引用悬空的事件本体）
    expect(view.runs[0]!.event_count).toBe(2)
  })

  it('gpt-streak 样本目录内跨文件 based_on 全部可解析 → 无 dangling 条目', () => {
    const state = createReplayState()
    importRunFiles(state, listEnvelopeFiles(SAMPLE_DIR))
    const view = buildReplayView(state)
    expect(view.unresolved.filter((u) => u.kind === 'validator_dangling_external_ref')).toEqual([])
    // 6 = 合成样本 4 run + 2026-10-26 真实运行 2 run（strk-05/06，interop 首跑）
    expect(view.stats.run_count).toBe(6)
  })

  it('导入不存在的文件 → file_unreadable 入账，不抛', () => {
    const state = createReplayState()
    importRunFiles(state, [path.join(tmpRoot, 'nope.jsonl')])
    const view = buildReplayView(state)
    expect(view.unresolved.some((u) => u.kind === 'file_unreadable')).toBe(true)
  })

  it('断号文件（文件级拒绝）→ validator 问题入账，视图仍可构建', () => {
    const dir = path.join(tmpRoot, 'gapdir')
    mkdirSync(dir, { recursive: true })
    const line = {
      schema: 'poc/prov-envelope/v0',
      source_project: 'neg(P1-synthetic)',
      run_id: 'RUN-P1-GAP-1',
      event_seq: 0,
      occurred_at: '2026-05-01T00:00:00Z',
      recorded_at: '2026-05-01T00:00:30Z',
      snapshot_ref: { kind: 'none', id: 'none', content_sha256: null },
      access_boundary: 'synthetic',
      channel: 'SOURCE_RECORD',
      kind: 'run.started',
      payload: {},
      unknowns: ['合成断号样本'],
    }
    const gap = { ...line, event_seq: 2, kind: 'run.finished' }
    writeFileSync(path.join(dir, 'gap.jsonl'), `${JSON.stringify(line)}\n${JSON.stringify(gap)}\n`, 'utf8')
    const state = createReplayState()
    importRunFiles(state, [path.join(dir, 'gap.jsonl')])
    const view = buildReplayView(state)
    const gapEntry = view.unresolved.find((u) => u.kind === 'validator_event_seq_gap')
    expect(gapEntry).toBeDefined()
    expect(gapEntry!.message).toContain('断号')
  })

  it('视图导出可读回（JSON 往返无损、幂等字符串可复现）', () => {
    const view = buildFixturesView()
    const text = exportReplayView(view)
    const reparsed = JSON.parse(text) as ReplayView
    expect(reparsed.view_version).toBe('poc/replay-view/v0.1')
    expect(exportReplayView(reparsed)).toBe(text) // canonicalize 幂等：已排序键再排不变
  })

  it('视图里每条 run 事件的源定位可在源文件中按 seq 复核（抽样全量）', () => {
    const view = buildFixturesView()
    for (const run of view.runs) {
      const locators = new Set<string>()
      for (const line of readFileSync(run.file, 'utf8').split('\n')) {
        if (!line.trim()) continue
        const o = JSON.parse(line) as { run_id: string; event_seq: number }
        locators.add(`${o.run_id}#${o.event_seq}`)
      }
      for (const e of run.events) expect(locators.has(`${run.run_id}#${e.event_seq}`)).toBe(true)
    }
  })
})
