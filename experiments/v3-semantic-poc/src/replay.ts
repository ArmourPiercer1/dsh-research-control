/**
 * V3 PoC · P1 —— 确定性重放器（#10 §4-P1 工作项 3：「在隔离本地存储中形成可以
 * 重复构建的轨迹视图（Run 时间线、输入产物、执行状态、未知项、源事件定位）」；
 * 离线机制部分只用合成素材验证，Gate P1 的宣称等真实历史接入）。
 *
 * 纯只读：本模块从磁盘读信封文件构建视图，自身零写入；任何导出落盘都必须由
 * 调用方先过 writeguard.assertWritable（poc-run.mjs --project --export 已接）。
 *
 * 幂等语义（Gate P1 第一条的机制层预验）：
 *  - 同一输入两次 buildReplayView/exportReplayView → 逐字节相同（视图内所有
 *    集合排序确定、时间戳字符串原样透传、canonicalize 与 envelope.normalizeExport
 *    共用同一规范化器）；
 *  - importRunFiles 以「解析后绝对路径」为键合并文件条目：重复导入同一 run
 *    文件 = 覆盖同键条目，实体/事件绝不重复；knownRuns 解析表在每次 build 时
 *    由并集重算，先导入谁不影响最终视图；
 *  - 断链（based_on 解析表外引用、校验器问题行）与 unknowns 非空的源 → 显式
 *    进入 unresolved 列表：**不报错也不静默**，构建永不抛（读不到的文件同样
 *    落成 unresolved 条目）。
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { canonicalize, normalizeExport, parseEnvelopeFile, type EnvelopeEvent, type Problem } from './envelope.ts'
import { countSosaObservations, countSosaResults, projectEvents, type Projection, type ProjectionInput } from './prov.ts'

export const REPLAY_VIEW_VERSION = 'poc/replay-view/v0.1'

/** 视图中的一条显式未决项：宁可行多，不可静默。 */
export interface UnresolvedEntry {
  kind: string
  file: string
  /** JSONL 1 基行号（校验器问题行）；事件级条目时为 null。 */
  line: number | null
  run_id: string | null
  event_seq: number | null
  message: string
}

export interface RunEventView {
  event_seq: number
  kind: string
  channel: string
  occurred_at: string
  recorded_at: string
  /** 源定位三元组之二（file 见 RunView.file）：seq 可在源文件中定位。 */
  file: string
  unknowns: string[]
}

export interface RunView {
  run_id: string
  file: string
  source_project: string
  /** 有效事件顺序 = event_seq 升序（信封层语义，SPEC 硬规则 3）。 */
  events: RunEventView[]
  event_count: number
  /** 执行状态：FAILED > FINISHED > RUNNING，全部由事件推出，不伪造终态。 */
  status: 'FAILED' | 'FINISHED' | 'RUNNING'
  started_at: string
  ended_at: string
  /** 输入产物：本 run 活动实际使用过的实体 id（prov:used 的投影结果）。 */
  input_artifact_ids: string[]
  /** 产出实体 id（生成边指向本 run 活动的实体）；失败 run 可为空，属合法。 */
  output_entity_ids: string[]
  unknown_event_count: number
}

export interface ReplayView {
  view_version: string
  files: string[]
  runs: RunView[]
  unresolved: UnresolvedEntry[]
  stats: {
    file_count: number
    run_count: number
    event_count: number
    unknown_item_count: number
    unresolved_count: number
    activities: number
    entities: number
    agents: number
    sosa_observations: number
    sosa_results: number
  }
  projection: Projection
}

interface StoredFile {
  absPath: string
  /** 内容哈希仅作为导入批次指纹（Gate 报告用），不参与排序。 */
  content_sha256: string
}

export interface ReplayState {
  files: Map<string, StoredFile>
}

export interface ImportReport {
  imported: string[]
  already_present: string[]
}

function cmpStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function createReplayState(): ReplayState {
  return { files: new Map() }
}

/**
 * 导入信封文件（按解析后的绝对路径幂等合并）。此函数不解析内容——解析在
 * buildReplayView 时对着当时的文件并集进行，保证 knownRuns 跨文件解析表
 * 完整、导入顺序不影响结果。
 */
export function importRunFiles(state: ReplayState, filePaths: readonly string[]): ImportReport {
  const imported: string[] = []
  const alreadyPresent: string[] = []
  for (const p of filePaths) {
    const abs = path.resolve(p)
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      // 读不到也要显式记账（不静默丢）：落成 UNREADABLE 条目，build 时报 unresolved。
      if (!state.files.has(abs)) {
        state.files.set(abs, { absPath: abs, content_sha256: 'UNREADABLE' })
        imported.push(abs)
      } else alreadyPresent.push(abs)
      continue
    }
    if (state.files.get(abs)?.content_sha256 === sha256(text) && state.files.has(abs)) alreadyPresent.push(abs)
    else imported.push(abs)
    state.files.set(abs, { absPath: abs, content_sha256: sha256(text) })
  }
  return { imported: imported.sort(cmpStrings), already_present: alreadyPresent.sort(cmpStrings) }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 目录内全部 *.jsonl（排序），供 --project 使用。 */
export function listEnvelopeFiles(dirPath: string): string[] {
  const dir = path.resolve(dirPath)
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.filter((n) => n.endsWith('.jsonl')).map((n) => path.join(dir, n)).sort(cmpStrings)
}

/** 宽松收集 run_id → seq 集（与 poc-run.mjs --fixture 的 v0.1 解析表同源规则）。 */
function collectKnownRuns(texts: Map<string, string>): Map<string, Set<number>> {
  const known = new Map<string, Set<number>>()
  for (const text of texts.values()) {
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const o = JSON.parse(line) as { run_id?: unknown; event_seq?: unknown }
        if (o && typeof o.run_id === 'string' && Number.isInteger(o.event_seq)) {
          if (!known.has(o.run_id)) known.set(o.run_id, new Set())
          known.get(o.run_id)!.add(o.event_seq as number)
        }
      } catch {
        /* 解析表宽松：坏行在这里不记账，后面 parseEnvelopeFile 会记账 */
      }
    }
  }
  return known
}

function problemToUnresolved(p: Problem, file: string): UnresolvedEntry {
  return {
    kind: `validator_${p.kind}`,
    file,
    line: p.line,
    run_id: null,
    event_seq: p.event_seq,
    message: p.message,
  }
}

function compareUnresolved(a: UnresolvedEntry, b: UnresolvedEntry): number {
  const ka = `${a.file}|${a.line ?? -1}|${a.run_id ?? ''}|${a.event_seq ?? -1}|${a.kind}|${a.message}`
  const kb = `${b.file}|${b.line ?? -1}|${b.run_id ?? ''}|${b.event_seq ?? -1}|${b.kind}|${b.message}`
  return cmpStrings(ka, kb)
}

/**
 * 由当前导入并集重建视图（纯函数式重建：state 只读，返回全新对象）。
 * 任何文件级/行级/事件级问题都落成 unresolved 条目，本函数不抛。
 */
export function buildReplayView(state: ReplayState): ReplayView {
  const unresolved: UnresolvedEntry[] = []
  const texts = new Map<string, string>()
  const parsedByFile: Array<{ file: string; events: EnvelopeEvent[] }> = []

  const absPaths = Array.from(state.files.keys()).sort(cmpStrings)
  for (const abs of absPaths) {
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch (err) {
      unresolved.push({
        kind: 'file_unreadable',
        file: abs,
        line: null,
        run_id: null,
        event_seq: null,
        message: `文件读取失败：${(err as Error).message}`,
      })
      continue
    }
    texts.set(abs, text)
  }
  const knownRuns = collectKnownRuns(texts)

  for (const abs of absPaths) {
    if (!texts.has(abs)) continue
    let parsed: { events: EnvelopeEvent[]; problems: Problem[] }
    try {
      parsed = parseEnvelopeFile(abs, { knownRuns })
    } catch (err) {
      unresolved.push({
        kind: 'file_unparseable',
        file: abs,
        line: null,
        run_id: null,
        event_seq: null,
        message: `信封解析异常：${(err as Error).message}`,
      })
      continue
    }
    for (const p of parsed.problems) unresolved.push(problemToUnresolved(p, abs))
    parsedByFile.push({ file: abs, events: parsed.events })
  }

  const projection = projectEvents(parsedByFile.map((f): ProjectionInput => ({ file: f.file, events: f.events })))

  // unknowns 非空的源 → unresolved（「不报错也不静默」的字面实现）。
  let unknownItemCount = 0
  for (const { file, events } of parsedByFile) {
    for (const event of events) {
      for (const item of event.unknowns) {
        unknownItemCount += 1
        unresolved.push({
          kind: 'unknown_item',
          file,
          line: null,
          run_id: String(event.run_id),
          event_seq: Number.isInteger(event.event_seq) ? event.event_seq : null,
          message: String(item ?? ''),
        })
      }
    }
  }

  // Run 时间线视图（按 run_id 聚合；一个 run 正常恰在一个文件——SPEC 硬规则 0）。
  const runsById = new Map<string, RunView>()
  for (const { file, events } of parsedByFile) {
    for (const event of events) {
      const runId = String(event.run_id)
      let run = runsById.get(runId)
      if (!run) {
        run = {
          run_id: runId,
          file,
          source_project: String(event.source_project),
          events: [],
          event_count: 0,
          status: 'RUNNING',
          started_at: 'UNKNOWN',
          ended_at: 'UNKNOWN',
          input_artifact_ids: [],
          output_entity_ids: [],
          unknown_event_count: 0,
        }
        runsById.set(runId, run)
      }
      run.events.push({
        event_seq: Number.isInteger(event.event_seq) ? event.event_seq : -1,
        kind: String(event.kind),
        channel: String(event.channel),
        occurred_at: String(event.occurred_at),
        recorded_at: String(event.recorded_at),
        file,
        unknowns: event.unknowns.map((u) => String(u)),
      })
      if (event.unknowns.length > 0) run.unknown_event_count += 1
      if (event.kind === 'run.started' && run.started_at === 'UNKNOWN') run.started_at = String(event.occurred_at)
      if ((event.kind === 'run.finished' || event.kind === 'run.failed') && run.ended_at === 'UNKNOWN') run.ended_at = String(event.occurred_at)
      if (event.kind === 'run.failed') run.status = 'FAILED'
      else if (event.kind === 'run.finished' && run.status !== 'FAILED') run.status = 'FINISHED'
    }
  }
  const projectionRuns = projection.activities.filter((a) => a.activity_kind === 'run')
  for (const act of projectionRuns) {
    const run = runsById.get(act.run_id)
    if (!run) continue
    run.input_artifact_ids = projection.usage.filter((u) => u.activity_id === act.id).map((u) => u.entity_id)
    run.output_entity_ids = projection.generation.filter((g) => g.activity_id === act.id).map((g) => g.entity_id)
    // 投影层的 started_at/status 是跨文件聚合结果，优先采用（视图与投影同源）。
    if (act.started_at !== 'UNKNOWN') run.started_at = act.started_at
  }
  for (const run of runsById.values()) {
    run.events.sort((a, b) => a.event_seq - b.event_seq)
    run.event_count = run.events.length
    run.input_artifact_ids = Array.from(new Set(run.input_artifact_ids)).sort(cmpStrings)
    run.output_entity_ids = Array.from(new Set(run.output_entity_ids)).sort(cmpStrings)
  }

  unresolved.sort(compareUnresolved)
  const runs = Array.from(runsById.values()).sort((a, b) => cmpStrings(a.run_id, b.run_id))
  const eventCount = runs.reduce((s, r) => s + r.event_count, 0)
  return {
    view_version: REPLAY_VIEW_VERSION,
    files: absPaths,
    runs,
    unresolved,
    stats: {
      file_count: absPaths.length,
      run_count: runs.length,
      event_count: eventCount,
      unknown_item_count: unknownItemCount,
      unresolved_count: unresolved.length,
      activities: projection.activities.length,
      entities: projection.entities.length,
      agents: projection.agents.length,
      sosa_observations: countSosaObservations(projection),
      sosa_results: countSosaResults(projection),
    },
    projection,
  }
}

/**
 * 视图导出：canonicalize（与 normalizeExport 同一规范化器）+ 稳定键序 JSON。
 * 同一输入两次构建 → 本函数输出逐字节相同（测试断言）。
 */
export function exportReplayView(view: ReplayView): string {
  return `${JSON.stringify(canonicalize(view))}\n`
}

/**
 * 视图内全部有效事件的规范化信封导出（保持 run 内 seq 序、run_id 字典序）——
 * 「同一输入两次构建 → normalizeExport 字节一致」的直接对象。
 */
export function exportReplayEvents(view: ReplayView): string {
  const events: EnvelopeEvent[] = []
  for (const run of view.runs) {
    for (const e of run.events) {
      events.push({
        schema: 'poc/replay-event-view/v0.1',
        source_project: run.source_project,
        run_id: run.run_id,
        event_seq: e.event_seq,
        occurred_at: e.occurred_at,
        recorded_at: e.recorded_at,
        snapshot_ref: { kind: 'file', id: e.file, content_sha256: null },
        access_boundary: 'synthetic',
        channel: e.channel,
        kind: e.kind,
        payload: {},
        unknowns: e.unknowns,
      })
    }
  }
  return normalizeExport(events)
}
