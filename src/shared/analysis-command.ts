/**
 * WP-7.4 / G7 S1 — analysis 数据面命令线的**单一真源**（host 解析 /
 * client 构建共用 — 与 `investigation-command.ts` 同款纪律: 一条命令行
 * 的语法/载荷形状只有一处定义, 漂移由往返测试钉）。
 *
 * ## 三个插件自有 host 命令（DSH 内置 `commands/execute` 网关域承载 —
 * 零新增插件 RPC, ARCHITECTURE §7.1 13-RPC 清单零 diff, 见 WP-7.4 报告
 * 「四面 13-RPC 兼容性论证」）:
 *
 *   - `research-transient-read <sessionId>`
 *     → 宿主 `AnalysisTransientReader.read`（三读端口全读, 零写入）的
 *       camelCase 投影（{@link InvestigatorTransientDto}）JSON — GUI
 *       transient 面板的生产数据面（INV-PERM-3「默认 transient」的
 *       只读呈现 — 读本身不落任何 operational 表）;
 *   - `research-analysis-list`
 *     → 宿主 `AnalysisRecordService.listAnalysisRecords`（无隐藏过滤
 *       器 — 稳定序 createdAt ASC）的 camelCase 投影
 *       （{@link AnalysisRecordDto}[]）JSON — 已保存记录列表面;
 *   - `research-analysis-save <单行 JSON>`
 *     → 宿主 `AnalysisRecordService.saveAsAnalysisRecord(params,
 *       USER_ACTOR)`（用户门 — INV-PERM-3「仅用户显式保存」; 触发面 =
 *       用户经 GUI 保存按钮/命令行的显式提交, 插件永不自我调度）的
 *       保存产物（{@link AnalysisRecordDto}）JSON — **保存按钮解禁**
 *       的生产通道（G7 S1: `AnalysisDataProvider` 生产实现注入）。
 *
 * ## 载荷纪律（单行 JSON 载包）
 *
 * 命令线是单行文本载包（`parseCommand` 的 rawInput 保留原样, 但命令行
 * 语义是单行 — GUI 输入面亦单行）: 所有载荷 JSON 经 `JSON.stringify`
 * 成单行（无排版换行）; 解析面**严格**（非 JSON / 非对象 / 形状偏离
 * ⇒ 命令 error 结果带逐字原因 — 不猜、不降级, 同 WP-7.1 请求闭集
 * 纪律的数据面版本）。成功结果文本 = 载荷 JSON 逐字（client 回解）。
 *
 * Layer: shared — 零 DSH import, 零 host/client import（纯数据/纯函数
 * — check-imports 0 违规可证）。
 */

/* -------------------------------------------------------------------- *
 * 线形 DTO（camelCase 显示面 — host snake_case 行 → client 渲染面投影;
 * 与冻结 provenance.schema.json $defs/AnalysisRecord 字段集合一一对应,
 * 与 WP-7.3 `analysis-slice.ts` 的 GUI 载荷类型**同一定义源** — 该文件
 * re-export 本模块的类型, 保持 WP-7.3 消费面名称不变）
 * -------------------------------------------------------------------- */

/** 一个 typedRef 元素（冻结 `typedRef` 投影 — `{kind, id}` 形状）。 */
export interface AnalysisTypedRef {
  readonly kind: string
  readonly id: string
}

/** One AnalysisRecord for the GUI（§12.2; snake→camel 投影）。 */
export interface AnalysisRecordDto {
  readonly id: string
  readonly sourceRef: AnalysisTypedRef
  readonly investigatorRunId: string | null
  readonly dshSessionId: string | null
  /** 分析内容（Markdown — §12.2 必填）。 */
  readonly content: string
  readonly createdAt: number
}

/** transient 快照中 live session 摘要的投影（WP-0.4 `SessionSummary` 面）。 */
export interface TransientSessionDto {
  readonly id: string
  readonly cwd: string | null
  readonly title: string | null
  readonly running: boolean
  readonly createdAt: number
}

/** transient 快照中 sessionlink 指针行的投影（WP-2.6 `SessionPointer` 面）。 */
export interface TransientPointerDto {
  readonly workstreamId: string
  readonly taskId: string | null
  readonly intent: string | null
  readonly lastSeq: number
  readonly runId: string | null
  readonly runStartedAt: number | null
}

/** transient 快照中 formal run 行的投影（§6.1 run 表 `dsh_session_id` 关联）。 */
export interface TransientRunDto {
  readonly id: string
  readonly workstreamId: string
  readonly status: string
  readonly startedAt: number
  readonly endedAt: number | null
}

/**
 * 一个 investigator 会话的 transient 快照（GUI transient 面板的数据面 —
 * 只读渲染; 三个可选面 `null` = 缺席诚实透出, 不虚构）。
 */
export interface InvestigatorTransientDto {
  readonly sessionId: string
  readonly session: TransientSessionDto | null
  readonly pointer: TransientPointerDto | null
  readonly run: TransientRunDto | null
}

/**
 * 保存请求（宿主 `AnalysisRecordService.saveAsAnalysisRecord` 参数面 —
 * 用户显式确认载荷; 形状由保存对话框收集, 宿主侧全预校验复验）。
 */
export interface SaveAnalysisRecordArgs {
  readonly sourceRef: AnalysisTypedRef
  readonly content: string
  readonly investigatorRunId?: string
  readonly dshSessionId?: string
}

/* -------------------------------------------------------------------- *
 * 命令名 + 命令行构建（client 半 — 与 host 解析面同一模式面）
 * -------------------------------------------------------------------- */

/** 命令名闭集（无斜杠 — 宿主 `parseCommand` 名字语法 `^[a-z][a-z0-9_-]*$`）。 */
export const ANALYSIS_TRANSIENT_READ_COMMAND_NAME = 'research-transient-read'
export const ANALYSIS_LIST_COMMAND_NAME = 'research-analysis-list'
export const ANALYSIS_SAVE_COMMAND_NAME = 'research-analysis-save'

/** 用户可见语法提示（中文组件纪律 — 错误路径与 client 提示同一字符串源）。 */
export const analysisCommandGrammar =
  `${ANALYSIS_TRANSIENT_READ_COMMAND_NAME} <会话id> | ` +
  `${ANALYSIS_LIST_COMMAND_NAME} | ` +
  `${ANALYSIS_SAVE_COMMAND_NAME} <单行JSON载荷>`

/**
 * Build the transient-read command line（`/research-transient-read <id>`）。
 * @throws {Error} on a blank sessionId（channel 不提交无目标的读取 —
 *  同 investigate 通道守卫纪律）。
 */
export function buildTransientReadLine(sessionId: string): string {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new Error('buildTransientReadLine: sessionId must be a non-blank string (the launcher session pointer)')
  }
  return `/${ANALYSIS_TRANSIENT_READ_COMMAND_NAME} ${sessionId.trim()}`
}

/** Build the analysis-list command line（无参）。 */
export function buildAnalysisListLine(): string {
  return `/${ANALYSIS_LIST_COMMAND_NAME}`
}

/**
 * Build the analysis-save command line（`/research-analysis-save <单行
 * JSON>`）。载荷经 `JSON.stringify` 单行化（键序 = 对象插入序 — 解析面
 * 按键名读取, 不依赖序）。
 * @throws {Error} on a blank content / malformed sourceRef（第二道防线 —
 *  GUI 对话框已校验; 坏载荷不提交命令线）。
 */
export function buildAnalysisSaveLine(args: SaveAnalysisRecordArgs): string {
  assertSavePayloadShape(args, 'buildAnalysisSaveLine')
  return `/${ANALYSIS_SAVE_COMMAND_NAME} ${JSON.stringify(args)}`
}

/* -------------------------------------------------------------------- *
 * 命令线解析（host 半 — rawInput 入口; 全失败形态返回 null, error 路径
 * 显示语法; 与 build 面同一形状源 — 不双写）
 * -------------------------------------------------------------------- */

/**
 * Parse a transient-read rawInput（`<sessionId>`）.
 * @returns the session id, or null（blank — 语法提示面）.
 */
export function parseTransientReadInput(rawInput: string): string | null {
  const trimmed = rawInput.trim()
  if (trimmed.length === 0) return null
  return trimmed
}

/**
 * Parse a save rawInput（单行 JSON 载荷）into a shape-validated
 * {@link SaveAnalysisRecordArgs}.
 * @returns the validated args.
 * @throws — 两级失败面（host handler 分别映射为命令 error 结果, 不裸抛）:
 *  非 JSON / 非对象 / 非保存形状（{@link parseAnalysisSaveInput} 返回
 *  null 由调用方转语法提示 — 见下）; 形状门偏离（{@link SavePayload-
 *  ShapeError} — 携带**逐字原因**, 比语法提示更精确, error 结果直接
 *  透出）. 形状校验 = 线形门（冻结契约复验在宿主 service 层 —
 *  `assertSourceRef` / content / id 模式全量预校验, 失败 = AN_* 结构化
 *  错误映射回命令 error 结果, 零写入）。
 */
export function parseAnalysisSaveInput(rawInput: string): SaveAnalysisRecordArgs | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawInput)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  return assertSavePayloadShape(parsed, 'parseAnalysisSaveInput')
}

/**
 * 保存载荷形状门（build 与 parse 共用 — 单一形状源）: 恰好
 * `sourceRef{kind,id}` + `content`（均非空字符串）+ 可选
 * `investigatorRunId` / `dshSessionId`（字符串; 空串 = 不携带）。
 * 未知键 ⇒ 拒（线形闭集 — 同 WP-7.1 请求闭集纪律; 形状面不校验
 * kind/id 的冻结模式 — 那是宿主 service 的冻结网职责, 分层不越权）。
 * @returns the validated args, or null on shape deviation.
 */
function assertSavePayloadShape(raw: unknown, origin: string): SaveAnalysisRecordArgs | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throwShapeError(origin, 'payload must be a single plain object')
  }
  const obj = raw as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const allowed = new Set(['content', 'dshSessionId', 'investigatorRunId', 'sourceRef'])
  for (const key of keys) {
    if (!allowed.has(key)) throwShapeError(origin, `unknown key "${key}" (closed-set payload)`)
  }
  const sourceRef = obj.sourceRef
  if (typeof sourceRef !== 'object' || sourceRef === null || Array.isArray(sourceRef)) {
    throwShapeError(origin, 'sourceRef must be a plain {kind, id} object')
  }
  const ref = sourceRef as Record<string, unknown>
  const refKeys = Object.keys(ref).sort()
  if (refKeys.length !== 2 || refKeys[0] !== 'id' || refKeys[1] !== 'kind') {
    throwShapeError(origin, `sourceRef must carry exactly {id, kind} (got [${refKeys.join(', ')}])`)
  }
  const kind = ref.kind
  const id = ref.id
  if (typeof kind !== 'string' || kind.trim().length === 0) throwShapeError(origin, 'sourceRef.kind must be a non-blank string')
  if (typeof id !== 'string' || id.trim().length === 0) throwShapeError(origin, 'sourceRef.id must be a non-blank string')
  const content = obj.content
  if (typeof content !== 'string' || content.trim().length === 0) throwShapeError(origin, 'content must be a non-blank string (frozen schema minLength 1)')
  const args: SaveAnalysisRecordArgs = { sourceRef: { kind, id }, content }
  for (const field of ['investigatorRunId', 'dshSessionId'] as const) {
    const value = obj[field]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.trim().length === 0) {
      throwShapeError(origin, `${field} must be a non-blank string when carried (blank = omit the field, not an empty value)`)
    }
    Object.assign(args, { [field]: value })
  }
  return args
}

/** 形状门失败载体（origin 点名调用面 — 宿主 handler 映射为命令 error 文本）。 */
class SavePayloadShapeError extends Error {
  constructor(origin: string, detail: string) {
    super(`${origin}: the save payload is malformed — ${detail}（语法: ${ANALYSIS_SAVE_COMMAND_NAME} <单行JSON: {sourceRef:{kind,id}, content, investigatorRunId?, dshSessionId?}>）`)
    this.name = 'SavePayloadShapeError'
  }
}

function throwShapeError(origin: string, detail: string): never {
  throw new SavePayloadShapeError(origin, detail)
}

/** 形状门错误的判别（host handler 映射 error 结果用 — 不裸抛）。 */
export function isSavePayloadShapeError(error: unknown): error is SavePayloadShapeError {
  return error instanceof SavePayloadShapeError
}
