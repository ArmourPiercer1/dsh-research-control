/**
 * V3 PoC · P0 —— provenance envelope 校验器与规范化导出（SPEC.md 信封契约 v0）。
 *
 * 纯 TypeScript、零运行时依赖（仅 node 内置模块）；不接线 src/host、不依赖
 * V1 类型（#10 §2.1 失败隔离）。仅使用可擦除 TS 语法，Node ≥23.6 可直接
 * type-strip 运行（poc-run.mjs 以 .mjs 直接 import 本文件）。
 *
 * 强制的 SPEC 硬规则：
 *  1. channel 三通道不混存：SOURCE_RECORD payload（递归键名）不得匹配
 *     /inference|suggestion|llm_/；RESEARCHER_INFERENCE / LLM_SUGGESTION 必须
 *     携带 payload.based_on: [event_seq...] 且引用的 seq 存在于同一文件。
 *  2. 缺失就是缺失：content_sha256 允许 null，但必须配 unknowns 指路——本校验器
 *     只做形状校验（hex|null），不猜测、不补全任何内容。
 *  3. event_seq 每 run 内严格 +1、无空洞、不可回退（断号/重号 = 文件级问题）；
 *     normalizeExport 提供相同输入 → 逐字节相同输出的规范化导出。
 *
 * 注：SPEC 硬规则 4（旁路级别词汇）与 5（FACT_RECORDED 历史标签）在 P0 由
 * kind 枚举与文档约束间接覆盖，校验器不单独检查（见 SPEC.md 33–36 行）。
 */

import { readFileSync } from 'node:fs'

export const ENVELOPE_SCHEMA = 'poc/prov-envelope/v0'

export const CHANNELS = ['SOURCE_RECORD', 'RESEARCHER_INFERENCE', 'LLM_SUGGESTION'] as const
export type Channel = (typeof CHANNELS)[number]

/** SPEC.md kind 枚举（信封 schema 行内列表）。 */
export const EVENT_KINDS = [
  'run.started',
  'run.finished',
  'run.failed',
  'deck.executed',
  'artifact.registered',
  'analysis.performed',
  'observation.recorded',
  'claim.candidate',
  'note.unknown',
] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export const ACCESS_BOUNDARIES = ['synthetic', 'sanitized-snapshot', 'live-mirror'] as const
export const SNAPSHOT_REF_KINDS = ['deck', 'file', 'git', 'none'] as const

/** 推测/建议通道的依据字段位置：payload.based_on（SPEC 硬规则 1）。 */
const SPECULATION_CHANNELS: ReadonlySet<string> = new Set(['RESEARCHER_INFERENCE', 'LLM_SUGGESTION'])

/** SOURCE_RECORD payload 禁止出现的键名片段（SPEC 硬规则 1，按 SPEC 原文大小写）。 */
const SPECULATION_KEY_RE = /inference|suggestion|llm_/

const REQUIRED_TOP_FIELDS = [
  'schema',
  'source_project',
  'run_id',
  'event_seq',
  'occurred_at',
  'recorded_at',
  'snapshot_ref',
  'access_boundary',
  'channel',
  'kind',
  'payload',
  'unknowns',
] as const

/** RFC 3339 date-time（如 2026-03-02T08:00:00Z / +08:00 偏移；小数秒可选）。 */
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/
const SHA256_HEX_RE = /^[0-9a-f]{64}$/

export interface SnapshotRef {
  kind: string
  id: string
  content_sha256: string | null
}

/** 一条信封事件：保留未知字段原样透传（unknowns 之外的额外键不视为错误）。 */
export interface EnvelopeEvent {
  schema: string
  source_project: string
  run_id: string
  event_seq: number
  occurred_at: string
  recorded_at: string
  snapshot_ref: SnapshotRef
  access_boundary: string
  channel: string
  kind: string
  payload: Record<string, unknown>
  unknowns: unknown[]
  [extra: string]: unknown
}

/** 一条文件级校验问题；kind 稳定可断言，line 为 JSONL 内 1 基行号。 */
export interface Problem {
  line: number
  event_seq: number | null
  kind: string
  message: string
}

export interface ParseResult {
  events: EnvelopeEvent[]
  problems: Problem[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isValidRfc3339(value: unknown): value is string {
  return typeof value === 'string' && RFC3339_RE.test(value) && !Number.isNaN(Date.parse(value))
}

/** 递归收集 payload 中命中推测/建议关键词的键路径（SPEC 硬规则 1）。 */
function collectSpeculationKeyPaths(node: unknown, trail: string): string[] {
  const hits: string[] = []
  if (Array.isArray(node)) {
    node.forEach((item, i) => hits.push(...collectSpeculationKeyPaths(item, `${trail}[${i}]`)))
    return hits
  }
  if (isPlainObject(node)) {
    for (const key of Object.keys(node)) {
      const path = `${trail}.${key}`
      if (SPECULATION_KEY_RE.test(key)) hits.push(path)
      hits.push(...collectSpeculationKeyPaths(node[key], path))
    }
  }
  return hits
}

/**
 * 解析并校验一个信封 JSONL 文件（一个文件 = 一个 run）。
 * 返回 events（按文件行序）与 problems（空数组 = 通过全部硬规则）。
 * 校验是累积式的：一行上的多个问题都会记录，便于 P0 调试。
 */
export interface ResolveOpts { /** v0.1：跨文件 based_on 解析表（run_id → 该 run 文件的合法 seq 集）。 */ knownRuns?: Map<string, Set<number>> }
export function parseEnvelopeFile(filePath: string, opts: ResolveOpts = {}): ParseResult {
  const text = readFileSync(filePath, 'utf8')
  const problems: Problem[] = []
  const rawEvents: Array<{ line: number; value: unknown }> = []

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line.length === 0) continue
    const lineNo = i + 1
    try {
      rawEvents.push({ line: lineNo, value: JSON.parse(line) })
    } catch (err) {
      problems.push({
        line: lineNo,
        event_seq: null,
        kind: 'json_parse',
        message: `第 ${lineNo} 行不是合法 JSON：${(err as Error).message}`,
      })
    }
  }

  const events: EnvelopeEvent[] = []
  let firstRunId: string | null = null
  // 第一遍：逐事件形状校验。seq 集合与 based_on 引用目标供第二遍使用。
  const seqSet = new Set<number>()
  type BasedRef = number | { run_id: string; seq: number }
  const basedOnTargets: Array<{ line: number; seq: number | null; refs: BasedRef[] }> = []
  const badRefs = (refs: unknown): refs is BasedRef[] =>
    Array.isArray(refs) &&
    refs.length > 0 &&
    refs.every((r) =>
      (Number.isInteger(r) && (r as number) >= 0) ||
      (isPlainObject(r) && typeof r['run_id'] === 'string' && Number.isInteger(r['seq']) && (r['seq'] as number) >= 0))
  for (const { line, value } of rawEvents) {
    const push = (kind: string, message: string, seq: number | null = null): void => {
      problems.push({ line, event_seq: seq, kind, message: `第 ${line} 行：${message}` })
    }
    if (!isPlainObject(value)) {
      push('not_object', '信封行必须是 JSON 对象')
      continue
    }
    for (const field of REQUIRED_TOP_FIELDS) {
      if (!(field in value)) push('missing_field', `缺少必填字段 "${field}"`)
    }
    if (value['schema'] !== ENVELOPE_SCHEMA) {
      push('schema_version', `schema 必须为 "${ENVELOPE_SCHEMA}"，实际 ${JSON.stringify(value['schema'])}`)
    }
    if (!isNonEmptyString(value['source_project'])) push('bad_field', 'source_project 必须为非空字符串')
    if (!isNonEmptyString(value['run_id'])) push('bad_field', 'run_id 必须为非空字符串')

    const seqRaw = value['event_seq']
    const seq = typeof seqRaw === 'number' && Number.isInteger(seqRaw) && seqRaw >= 0 ? seqRaw : null
    if (seq === null) push('bad_event_seq', `event_seq 必须为非负整数，实际 ${JSON.stringify(seqRaw)}`)
    else seqSet.add(seq)

    if (!isValidRfc3339(value['occurred_at'])) push('bad_timestamp', 'occurred_at 不是合法 RFC3339 时间', seq)
    if (!isValidRfc3339(value['recorded_at'])) push('bad_timestamp', 'recorded_at 不是合法 RFC3339 时间', seq)

    const ref = value['snapshot_ref']
    if (!isPlainObject(ref)) {
      push('bad_snapshot_ref', 'snapshot_ref 必须是对象', seq)
    } else {
      if (!SNAPSHOT_REF_KINDS.includes(ref['kind'] as never)) {
        push('bad_snapshot_ref', `snapshot_ref.kind 必须为 ${SNAPSHOT_REF_KINDS.join('|')}，实际 ${JSON.stringify(ref['kind'])}`, seq)
      }
      if (!isNonEmptyString(ref['id'])) push('bad_snapshot_ref', 'snapshot_ref.id 必须为非空字符串', seq)
      const sha = ref['content_sha256']
      if (!(sha === null || (typeof sha === 'string' && SHA256_HEX_RE.test(sha)))) {
        push('bad_snapshot_ref', 'snapshot_ref.content_sha256 必须为 64 位小写 hex 或 null（缺失用 null + unknowns 指路，禁止编造）', seq)
      }
    }

    if (typeof value['access_boundary'] !== 'string' || !ACCESS_BOUNDARIES.includes(value['access_boundary'] as never)) {
      push('bad_access_boundary', `access_boundary 必须为 ${ACCESS_BOUNDARIES.join('|')}`, seq)
    }
    const channel = value['channel']
    if (typeof channel !== 'string' || !CHANNELS.includes(channel as never)) {
      push('bad_channel', `channel 必须为 ${CHANNELS.join('|')}，实际 ${JSON.stringify(channel)}`, seq)
    }
    const kind = value['kind']
    if (typeof kind !== 'string' || !EVENT_KINDS.includes(kind as never)) {
      push('bad_kind', `kind 必须为 ${EVENT_KINDS.join('|')} 之一，实际 ${JSON.stringify(kind)}`, seq)
    }
    const payload = value['payload']
    if (!isPlainObject(payload)) {
      push('bad_payload', 'payload 必须是对象', seq)
    }
    const unknowns = value['unknowns']
    if (!Array.isArray(unknowns)) {
      push('bad_unknowns', 'unknowns 必须是数组（可为空数组，但必须存在）', seq)
    }

    if (typeof value['run_id'] === 'string' && value['run_id'].length > 0) {
      if (firstRunId === null) firstRunId = value['run_id']
      else if (value['run_id'] !== firstRunId) push('mixed_run_id', `一个文件一个 run：run_id "${value['run_id']}" ≠ "${firstRunId}"`, seq)
    }

    if (isPlainObject(payload) && typeof channel === 'string') {
      if (channel === 'SOURCE_RECORD') {
        // 硬规则 1（正向）：源记录通道不得混入推测/建议键。
        for (const path of collectSpeculationKeyPaths(payload, 'payload')) {
          push('speculation_in_source_record', `SOURCE_RECORD payload 含推测/建议键 ${path}（三通道不混存）`, seq)
        }
        // SOURCE_RECORD 的 based_on 可选；若提供则必须形状合法且不悬空。
        if ('based_on' in payload) {
          const refs = payload['based_on']
          if (!badRefs(refs)) {
            push('bad_based_on', 'payload.based_on 若出现必须是非空数组，元素为非负整数或 {run_id, seq}（v0.1）', seq)
          } else {
            basedOnTargets.push({ line, seq, refs })
          }
        }
      } else if (SPECULATION_CHANNELS.has(channel)) {
        // 硬规则 1（反向）：推测/建议通道必须 based_on（整数=同文件 seq；
        // {run_id, seq}=跨文件，经调用方 knownRuns 解析表——v0.1）。
        const refs = payload['based_on']
        if (!('based_on' in payload) || !Array.isArray(refs)) {
          push('missing_based_on', `${channel} 通道必须携带 payload.based_on: [event_seq...]`, seq)
        } else if (!badRefs(refs)) {
          push('bad_based_on', `${channel} 的 payload.based_on 必须是非空数组，元素为非负整数或 {run_id, seq}（v0.1）`, seq)
        } else {
          basedOnTargets.push({ line, seq, refs })
        }
      }
    }

    if (!problems.some((p) => p.line === line)) events.push(value as unknown as EnvelopeEvent)
  }

  // 第二遍 A：event_seq 严格 +1（SPEC 硬规则 3，断号/重号 = 文件级拒绝）。
  const orderedSeqs: number[] = []
  for (const { line, value } of rawEvents) {
    if (!isPlainObject(value)) continue
    const raw = value['event_seq']
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) continue
    const seq = raw
    if (orderedSeqs.length === 0) {
      if (seq !== 0) problems.push({ line, event_seq: seq, kind: 'event_seq_start', message: `第 ${line} 行：event_seq 应从 0 起算，实际 ${seq}` })
    } else {
      const prev = orderedSeqs[orderedSeqs.length - 1]!
      let kind: string | null = null
      let message = ''
      if (seq === prev) {
        kind = 'event_seq_duplicate'
        message = `event_seq 重号：${seq} 与上一事件相同`
      } else if (seq < prev) {
        kind = 'event_seq_backwards'
        message = `event_seq 不可回退：${seq} < 上一事件 ${prev}`
      } else if (seq > prev + 1) {
        kind = 'event_seq_gap'
        message = `event_seq 断号：${prev} → ${seq}（空洞，文件级拒绝）`
      }
      if (kind) problems.push({ line, event_seq: seq, kind, message: `第 ${line} 行：${message}` })
    }
    orderedSeqs.push(seq)
  }

  // 第二遍 B：based_on 引用解析——整数查同文件 seq 集；{run_id, seq} 查
  // knownRuns 解析表（缺失 run / 越界 seq = dangling_external_ref，v0.1）。
  for (const target of basedOnTargets) {
    for (const ref of target.refs) {
      if (typeof ref === 'number') {
        if (!seqSet.has(ref)) {
          problems.push({
            line: target.line,
            event_seq: target.seq,
            kind: 'dangling_based_on',
            message: `第 ${target.line} 行：based_on 引用了本文件不存在的 event_seq ${ref}`,
          })
        }
      } else {
        const runSeqs = opts.knownRuns?.get(ref.run_id)
        if (!runSeqs || !runSeqs.has(ref.seq)) {
          problems.push({
            line: target.line,
            event_seq: target.seq,
            kind: 'dangling_external_ref',
            message: `第 ${target.line} 行：跨文件 based_on {run_id:${ref.run_id}, seq:${ref.seq}} 不在解析表中（run 未知或 seq 越界）`,
          })
        }
      }
    }
  }

  problems.sort((a, b) => a.line - b.line)
  return { events, problems }
}

/**
 * 递归按字典序排键，JSON.stringify 保持对象插入序 → 稳定字节序。
 * 时间戳原样透传（字符串），绝不 Date 往返，避免任何格式抖动。
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item))
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key])
    return out
  }
  return value
}

/**
 * 规范化导出（SPEC 硬规则 3）：相同输入事件 → 逐字节相同的 JSONL。
 * 键递归排序、事件保持入参顺序（入参通常即 parse 行序 = event_seq 序）；
 * 空数组返回空串。幂等断言以本函数输出为准。
 */
export function normalizeExport(events: readonly EnvelopeEvent[]): string {
  if (events.length === 0) return ''
  return `${events.map((event) => JSON.stringify(canonicalize(event))).join('\n')}\n`
}
