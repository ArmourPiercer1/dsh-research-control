/**
 * V3 PoC · P1 —— V1 ResearchHistory **只读**适配器（版本化 Crosswalk）。
 *
 * 上游事实源（只读，未做任何修改）：
 *  - HISTORY_EVENT_CATALOG.md（Frozen V1，2026-08-22 冻结）§1 事件信封、
 *    §4 事件目录总表（20 类 eventType）、§5 各事件 payload 字段；
 *  - 执行计划 #10 §2.1/§2.2：只读快照、保留未知/缺失项、禁止捏造事件或补齐
 *    缺失科学结论；「不把历史 FACT_RECORDED 转成新的可信 FactStanding=ACTIVE；
 *    它只证明 V1 当时登记过一个名为 Fact 的标签」。
 *  - W3C_ALIGNMENT §六：「旧 FACT_RECORDED 不能无审查自动转成新的 ACTIVE
 *    FactStanding」。
 *
 * 方向：V1 JSONL（每行一个 HistoryEventEnvelope）→ 信封 v0.1
 * （SPEC.md + P0 裁定），全程只读输入、内存输出；映射表版本
 * `v1crosswalk/0.1` 是代码常量（#10 §4-P1「用版本化 Crosswalk 映射来源链」）。
 *
 * 纪律（全部有对应测试）：
 *  1. **零静默丢失**：输入事件行数 = mapped + unmapped + UNKNOWN 三表之和；
 *     `#` 注释行与空行单独计数（合成素材的声明头），不算事件。
 *  2. 缺字段 → UNKNOWN 显式标记；**禁止补全**——补不出合法信封必填字段的行
 *     落入 UNKNOWN 表原样保留，不臆造时间戳/事件类型。
 *  3. 目录中已知但 v0.1 无忠实信封落点的 eventType → 显式 unmapped 表
 *     （不丢事件、不伪造近似映射）；目录外未知 eventType 同样入 unmapped，
 *     reason 区分。
 *  4. FACT_RECORDED → kind=claim.candidate + channel=SOURCE_RECORD，并注入
 *     unknowns「仅证明当时登记过 Fact 标签，非科学确认」；输出**绝不**出现
 *     FactStanding/确认/验证类字段（键名级测试强制）。
 *  5. 双时序保留：occurredAt（epoch ms）→ occurred_at、recordedAt →
 *     recorded_at（RFC3339 字符串；ms→ISO 是格式转换非语义补全），互不顶替。
 *  6. V1 原始定位（eventId/ownerWorkstreamId/eventSeq/actor/source/行号）完整
 *     保留在输出的 `v1` 元数据键里——信封层的 event_seq 是「一个文件一个 run」
 *     重排结果（SPEC 硬规则 0 要求按 run 分文件），原 audit 序号永不丢失。
 */

import { readFileSync } from 'node:fs'

import { canonicalize, type EnvelopeEvent } from './envelope.ts'

export const V1_CROSSWALK_VERSION = 'v1crosswalk/0.1'
export const V1_CROSSWALK_SCHEMA = 'poc/prov-envelope/v0'

/** FACT_RECORDED 强制注入的 unknowns 条目（Gate P1 第四条的机械形式）。 */
export const FACT_RECORDED_NOTE =
  'FACT_RECORDED 仅证明 V1 当时登记过一个 Fact 标签，非科学确认（#10 §2.1：不转成新可信 FactStanding=ACTIVE；W3C_ALIGNMENT §六：不能无审查自动转 ACTIVE）'

const RFC3339_RE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/
const SHA256_HEX_RE = /^[0-9a-f]{64}$/

/** eventType → 信封 kind 的映射（含强制 unknowns 注记）。以目录 §4/§5 实际事件名为准。 */
interface KindMapEntry {
  kind: string
  notes?: string[]
}

export const V1_KIND_MAP: Readonly<Record<string, KindMapEntry>> = Object.freeze({
  // §5.1 Run 生命周期
  RUN_STARTED: { kind: 'run.started' },
  RUN_FINISHED: { kind: 'run.finished' },
  RUN_FAILED: { kind: 'run.failed' },
  RUN_CANCELLED: {
    kind: 'run.failed',
    notes: [
      'RUN_CANCELLED 折叠到 run.failed：信封 v0.1 无 run.cancelled kind；取消语义完整保留于 v1 元数据与 payload（reason/cancelled_by），此为显式有损映射非静默改写',
    ],
  },
  // §5.3 语义标签
  FACT_RECORDED: { kind: 'claim.candidate', notes: [FACT_RECORDED_NOTE] },
  CLAIM_RECORDED: { kind: 'claim.candidate' },
  // §5.4 Artifact
  ARTIFACT_REGISTERED: { kind: 'artifact.registered' },
})

/**
 * 目录已知、但 v0.1 **故意不映射**的 eventType（原因逐条写明）。这不是遗漏，
 * 是「不伪造近似映射」的显式决定；unmapped 表逐行保留原始事件。
 */
export const V1_KNOWN_UNMAPPED: Readonly<Record<string, string>> = Object.freeze({
  RUNS_STARTED: '批量启动信封特例（目录 §5.1：一次事件覆盖多 run，各自 owner WS）与 SPEC 硬规则 0「一个文件一个 run」冲突，需逐 run 拆分规则另行裁定，v0.1 不做有损拆分',
  CLAIM_RETRACTED: '撤回语义在信封 v0.1 无对应 kind；折叠成 claim.candidate 会歪曲「撤回」为「提出」，拒绝伪造',
  ARTIFACT_MARKED_MISSING: '缺失登记在信封 v0.1 无对应 kind，不硬造近似映射',
  RELATION_ADDED: 'Relation→PROV 需按 W3C_ALIGNMENT §三逐类型分流（数据派生/论证/关联），P1 离线机制不做一刀切映射',
  RELATION_REMOVED: '同 RELATION_ADDED；移除边另涉非单调语义（P3）',
  TASK_EXECUTION_CHANGED: '计划态 Task 语义不属执行来源（CORE_SEMANTICS §6：Plan/Task/Gate/Run 属工作流程，不自动从科研论点推出），P1 不投影',
  TASK_VALIDATION_CHANGED: '同 TASK_EXECUTION_CHANGED（验收判断是人类动作，目录 §4 发射者保守性说明）',
  ACCEPTANCE_CRITERION_CHANGED: 'AC 定义版本由 Git 管理（目录 §5.2 说明），非科研来源事件',
  GATE_EVALUATED: 'Gate 评估属治理验收（W3C_ALIGNMENT §三 VALIDATED_BY 行：验收通过不等于数据来源），P1 不投影',
  MILESTONE_ACHIEVED: '里程碑达成属治理状态，无 prov 来源语义可无损承载',
  INTERVENTION_CREATED: '人类注意力对象（目录 §5.7），非数据产出事件',
  TOPOLOGY_FORK_REALIZED: '拓扑 realize 是「管理+实际发生混合操作」（目录 §4 发射者保守性说明），管理面不映射',
  TOPOLOGY_MERGE_REALIZED: '同 TOPOLOGY_FORK_REALIZED',
})

// ── 输出结构 ─────────────────────────────────────────────────────────────

export interface UnmappedV1Entry {
  line: number
  event_id: unknown
  event_type: unknown
  reason: string
  /** 原始事件完整保留（不丢事件不伪造；raw 原样透传）。 */
  raw: unknown
}

export interface UnknownV1Entry {
  line: number
  event_id: unknown
  event_type: unknown
  /** 无法构造合法信封的具体缺失（缺哪个必填字段、为什么不能补全）。 */
  reason: string
  raw: unknown
}

export interface V1ConversionResult {
  crosswalk_version: string
  file: string
  /** 三表守恒：input_event_lines = mapped + unmapped + unknown_table。 */
  input_event_lines: number
  comment_lines: number
  blank_lines: number
  mapped: EnvelopeEvent[]
  unmapped: UnmappedV1Entry[]
  unknown_table: UnknownV1Entry[]
  /** run_id → 该 run 的 mapped 事件（audit 顺序 + 信封 event_seq 已按 run 重排）。 */
  mapped_by_run: Record<string, EnvelopeEvent[]>
  counts: { mapped: number; unmapped: number; unknown: number }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** epoch ms → RFC3339（UTC ISO）；非法值返回 null（调用方禁止补全）。 */
function msToRfc3339(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value)) {
    try {
      return new Date(value).toISOString()
    } catch {
      return null
    }
  }
  // 已是合法 RFC3339 字符串的原样透传（绝不 Date 往返，防格式抖动）。
  if (typeof value === 'string' && RFC3339_RE.test(value)) return value
  return null
}

interface V1SourceRefLike {
  kind?: unknown
  id?: unknown
  uri?: unknown
  path?: unknown
  locator?: unknown
  content_hash?: unknown
}

function snapshotRefOf(source: unknown, notes: string[]): { kind: string; id: string; content_sha256: string | null } {
  if (!isPlainObject(source)) {
    notes.push('V1 信封缺 source（SourceRef 可选字段，目录 §1）：snapshot_ref 记 kind=none + UNKNOWN，不猜测来源')
    return { kind: 'none', id: 'UNKNOWN', content_sha256: null }
  }
  const ref = source as V1SourceRefLike
  const rawKind = typeof ref.kind === 'string' ? ref.kind : 'UNKNOWN'
  // 信封 snapshot_ref.kind 枚举 deck|file|git|none：session/interaction 等
  // V1 来源类别无损折叠到 none 并在 unknowns 留痕（映射表 VERSION 管辖的显式有损）。
  const kind = rawKind === 'deck' || rawKind === 'file' || rawKind === 'git' ? rawKind : 'none'
  if (kind === 'none' && rawKind !== 'none') {
    notes.push(`V1 source.kind=${rawKind} 在信封 snapshot_ref.kind 枚举（deck|file|git|none）无对应，折叠为 none；原始 source 保留在 v1 元数据`)
  }
  const id =
    (typeof ref.id === 'string' && ref.id.length > 0 && ref.id) ||
    (typeof ref.uri === 'string' && ref.uri.length > 0 && ref.uri) ||
    (typeof ref.path === 'string' && ref.path.length > 0 && ref.path) ||
    (typeof ref.locator === 'string' && ref.locator.length > 0 && ref.locator) ||
    'UNKNOWN'
  if (id === 'UNKNOWN') notes.push('V1 source 无可用定位字段（id/uri/path/locator），snapshot_ref.id 记 UNKNOWN，不伪造定位')
  const sha = ref['content_hash']
  return { kind, id, content_sha256: typeof sha === 'string' && SHA256_HEX_RE.test(sha) ? sha : null }
}

/** 该事件的 run 归属；返回 null = 落 UNKNOWN 表（缺 run 定位且类型要求 run）。 */
function runAttributionOf(eventType: string, payload: Record<string, unknown>, ownerWorkstreamId: string): { run_id: string; note?: string } {
  const direct = typeof payload['run_id'] === 'string' && payload['run_id'].length > 0 ? payload['run_id'] : null
  const creator = typeof payload['created_by_run'] === 'string' && payload['created_by_run'].length > 0 ? payload['created_by_run'] : null
  if (eventType.startsWith('RUN_')) {
    // RUN_* 事件的 payload.run_id 是目录 §5.1 必填主键；缺失 = 时间线无处安放，
    // 不猜测归属（UNKNOWN 表保留原始行）。
    if (direct === null) return { run_id: '' }
    return { run_id: direct }
  }
  if (creator !== null) return { run_id: creator }
  return {
    run_id: `RUN-UNATTRIBUTED-${ownerWorkstreamId || 'UNKNOWN-WS'}`,
    note: 'V1 payload.created_by_run 缺失（目录 §5.3/§5.4 该字段可选）：归入显式 UNATTRIBUTED 桶，不猜测其来源 Run',
  }
}

/**
 * 转换一个 V1 HistoryEvent JSONL 文件（只读）。opts.access_boundary 默认
 * 'sanitized-snapshot'（适配器的设计用途 = 真实历史只读快照）；合成素材
 * 测试显式传 'synthetic'。
 */
export function convertV1File(
  filePath: string,
  opts: { accessBoundary?: 'synthetic' | 'sanitized-snapshot' | 'live-mirror' } = {},
): V1ConversionResult {
  const text = readFileSync(filePath, 'utf8')
  return convertV1Text(text, filePath, opts)
}

export function convertV1Text(
  text: string,
  filePath: string,
  opts: { accessBoundary?: 'synthetic' | 'sanitized-snapshot' | 'live-mirror' } = {},
): V1ConversionResult {
  const accessBoundary = opts.accessBoundary ?? 'sanitized-snapshot'
  const mapped: EnvelopeEvent[] = []
  const unmapped: UnmappedV1Entry[] = []
  const unknownTable: UnknownV1Entry[] = []
  let commentLines = 0
  let blankLines = 0
  let eventLines = 0

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const trimmed = lines[i]!.trim()
    if (trimmed.length === 0) {
      blankLines += 1
      continue
    }
    if (trimmed.startsWith('#')) {
      commentLines += 1
      continue
    }
    eventLines += 1
    let value: unknown
    try {
      value = JSON.parse(trimmed)
    } catch (err) {
      unknownTable.push({ line: lineNo, event_id: null, event_type: null, reason: `行不是合法 JSON，无法识别事件，原样保留不补全：${(err as Error).message}`, raw: trimmed })
      continue
    }
    if (!isPlainObject(value)) {
      unknownTable.push({ line: lineNo, event_id: null, event_type: null, reason: '行不是 JSON 对象（HistoryEventEnvelope 必须是对象，目录 §1）', raw: value })
      continue
    }
    const eventType = typeof value['eventType'] === 'string' ? (value['eventType'] as string) : null
    const eventId = value['eventId'] ?? 'UNKNOWN'
    const pushUnmapped = (reason: string): void => {
      unmapped.push({ line: lineNo, event_id: eventId, event_type: eventType, reason, raw: value })
    }
    const pushUnknown = (reason: string): void => {
      unknownTable.push({ line: lineNo, event_id: eventId, event_type: eventType, reason, raw: value })
    }

    if (eventType === null) {
      pushUnknown('缺 eventType（目录 §1 信封必填）：无法映射，不猜测事件类型')
      continue
    }
    const mapEntry = V1_KIND_MAP[eventType]
    if (!mapEntry) {
      const knownReason = V1_KNOWN_UNMAPPED[eventType]
      if (knownReason !== undefined) pushUnmapped(`目录已知事件但 v0.1 不映射：${knownReason}`)
      else pushUnmapped(`未知 eventType "${eventType}"（不在 HISTORY_EVENT_CATALOG.md §4 的 20 类目录内，也不在本 crosswalk）：原样保留，不丢不造`)
      continue
    }

    // —— 已知且可映射：逐字段核对信封必填项，缺 = UNKNOWN 表（禁止补全） ——
    const ownerWs = typeof value['ownerWorkstreamId'] === 'string' && value['ownerWorkstreamId'].length > 0 ? (value['ownerWorkstreamId'] as string) : null
    const payload = value['payload']
    if (!isPlainObject(payload)) {
      pushUnknown('payload 缺失或非对象（目录 §1：payload 为强类型必填）：无内容可投影，不构造空 payload 假装完整')
      continue
    }
    if (typeof value['eventSeq'] !== 'number' || !Number.isInteger(value['eventSeq'])) {
      pushUnknown('缺合法 eventSeq（owner workstream 内单调序号，目录 §1）：audit 顺序不可重建，不补号')
      continue
    }
    const occurredAt = msToRfc3339(value['occurredAt'])
    if (occurredAt === null) {
      pushUnknown('occurredAt 缺失或非法（epoch ms 整数或 RFC3339）：时间戳禁止编造，落入 UNKNOWN 表')
      continue
    }
    const recordedAt = msToRfc3339(value['recordedAt'])
    if (recordedAt === null) {
      pushUnknown('recordedAt 缺失或非法：双时序的登记时间禁止编造，落入 UNKNOWN 表（不用 occurredAt 顶替，SPEC：不可互相顶替）')
      continue
    }
    const attribution = runAttributionOf(eventType, payload, ownerWs ?? 'UNKNOWN-WS')
    if (attribution.run_id === '') {
      pushUnknown(`RUN_* 事件缺 payload.run_id（目录 §5.1 必填）：无法定位 Run，不猜测归属`)
      continue
    }
    if (ownerWs === null) {
      pushUnknown('缺 ownerWorkstreamId（目录 §1 必填，INV-HIST-3 唯一 owner）：来源责任主体不可定位')
      continue
    }

    const unknowns: string[] = [...(mapEntry.notes ?? [])]
    const v1Actor = isPlainObject(value['actor']) ? value['actor'] : null
    if (v1Actor === null) unknowns.push('V1 信封缺 actor（目录 §1 必填）：执行者归因记 UNKNOWN，不猜测')
    if (attribution.note !== undefined) unknowns.push(attribution.note)
    const snapshot = snapshotRefOf(value['source'], unknowns)

    const envelope: EnvelopeEvent = {
      schema: V1_CROSSWALK_SCHEMA,
      source_project: ownerWs,
      run_id: attribution.run_id,
      event_seq: -1, // 占位，按 run 分桶后统一重排（SPEC 硬规则 0：文件内从 0 连续）
      occurred_at: occurredAt,
      recorded_at: recordedAt,
      snapshot_ref: snapshot,
      access_boundary: accessBoundary,
      channel: 'SOURCE_RECORD', // 适配器只产源记录通道；推测/建议通道属 P2（#10 §2.1 禁止 LLM 补全）
      kind: mapEntry.kind,
      // payload 原样透传：Fact/Claim/Artifact 的 V1 字段名（statement、fact_id、
      // uri、content_hash…）全部保留，不改写、不删除、不添加科学结论字段。
      payload: { ...payload },
      unknowns: unknowns.map((u) => String(u)),
      v1: {
        crosswalk: V1_CROSSWALK_VERSION,
        origin_file: filePath,
        origin_line: lineNo,
        event_id: eventId,
        owner_workstream_id: ownerWs,
        event_seq: value['eventSeq'],
        schema_version: value['schemaVersion'] ?? 'UNKNOWN',
        event_type: eventType,
        actor: v1Actor ?? 'UNKNOWN',
        source: value['source'] ?? 'UNKNOWN',
      },
    }
    mapped.push(envelope)
  }

  // 按 run 分桶（audit=文件行序即 V1 append 顺序），信封 event_seq 依 SPEC 硬
  // 规则 0 在每个 run 内从 0 重排；V1 原 eventSeq 永久保留在 v1.event_seq。
  const byRun = new Map<string, EnvelopeEvent[]>()
  for (const envelope of mapped) {
    const list = byRun.get(envelope.run_id) ?? []
    list.push(envelope)
    byRun.set(envelope.run_id, list)
  }
  const mappedByRun: Record<string, EnvelopeEvent[]> = {}
  for (const runId of Array.from(byRun.keys()).sort()) {
    const list = byRun.get(runId)!
    list.forEach((env, idx) => {
      env.event_seq = idx
    })
    mappedByRun[runId] = list
  }

  return {
    crosswalk_version: V1_CROSSWALK_VERSION,
    file: filePath,
    input_event_lines: eventLines,
    comment_lines: commentLines,
    blank_lines: blankLines,
    mapped,
    unmapped,
    unknown_table: unknownTable,
    mapped_by_run: mappedByRun,
    counts: { mapped: mapped.length, unmapped: unmapped.length, unknown: unknownTable.length },
  }
}

/**
 * 把 mapped 事件按 run 序列化为逐 run 的信封 JSONL（调用方落盘前必须过
 * writeguard；规范化器与 envelope.normalizeExport 共用 canonicalize，保证
 * 「相同输入 → 逐字节相同」在 adapter → 信封 → replay 全链同一规则）。
 */
export function runFilesOf(result: V1ConversionResult): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [runId, events] of Object.entries(result.mapped_by_run)) {
    out[runId] = `${events.map((event) => `${JSON.stringify(canonicalize(event))}\n`).join('')}`
  }
  return out
}
