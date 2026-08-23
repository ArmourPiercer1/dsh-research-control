/**
 * WP-7.4 / G7 S1 — the production analysis data-face commands（host 半
 * — G7 裁决 S1「AnalysisDataProvider 生产实现注入（保存按钮解禁）」的
 * 宿主落点, 与 `investigate-command.ts` 同一注册机制/同一论证）。
 *
 * ## 三个插件自有 host 命令（DSH 内置 `commands/execute` 网关域承载 —
 * 零新增插件 RPC, 13-RPC 清单零 diff — 见 WP-7.4 报告「四面 13-RPC
 * 兼容性论证」）:
 *
 *   1. `/research-transient-read <会话id>` — GUI transient 面板的
 *      生产数据面: `wiring.analysisTransient.read`（三读端口全读 —
 *      sessionlink `pointerOf` / adapter `listSessions` / run 表
 *      `dshSessionId` — **零 operational 表写入**, INV-PERM-3「默认
 *      transient」的只读呈现）→ camelCase 投影
 *      （{@link InvestigatorTransientDto} 单源）JSON;
 *   2. `/research-analysis-list` — 已保存 AnalysisRecord 列表面:
 *      `wiring.analysisService.listAnalysisRecords`（无隐藏过滤器 —
 *      稳定序 createdAt ASC）→ {@link AnalysisRecordDto}[] JSON;
 *   3. `/research-analysis-save <单行JSON>` — **用户显式保存**（INV-
 *      PERM-3 落地面 — 「仅用户显式保存才落 AnalysisRecord」的生产
 *      可达半边）: 线形门解析（共享单源 `parseAnalysisSaveInput` —
 *      形状偏离 = 逐字原因 error 结果）→ `wiring.analysisService.
 *      saveAsAnalysisRecord(args, USER_ACTOR)`（宿主用户门 — 伪造
 *      actor 零写入的既有纪律, WP-7.3 全真测试钉）→ 保存产物
 *      {@link AnalysisRecordDto} JSON。
 *
 * ## 权限语义（ARCHITECTURE §6: 保存 AnalysisRecord U ✅ / P ❌ —
 * 与一键启动同一论证, 见 WP-7.4 报告）
 *
 * 命令注册表只收**用户**指令（GUI 保存按钮 / 命令行 — `command/run`
 * 生命周期 `source.kind 'user'` 实机钉）; 插件 host 代码**不自我调度**
 * 这三个命令（本文件只注册 handler, 无任何自调路径 — 代码面可证）;
 * 模型无命令调度工具面（Investigator 的工具面 = preset 闭集 2 工具 +
 * 只读 4 研究工具 — §7.2, 无任何命令工具; 11 研究工具中可写 7 工具亦
 * 被 restriction 拒 — 三层保障）⇒ 「仅用户显式保存」在通道层成立,
 * 宿主 `assertUserActor` 门是第二道保险（双钉）。
 *
 * ## 失败面（fail loud, 映射到命令 error 结果 — 不裸抛, 同
 * `investigate-command.ts` 纪律）
 *
 *   - 语法/线形偏离 ⇒ error 结果带逐字原因（共享单源构建器/解析器）;
 *   - 宿主 `AnalysisError`（`AN_INPUT` / `AN_STORE` /
 *     `AN_ACTOR_FORBIDDEN` …）⇒ `[<code>] <message>` 逐字;
 *   - 意外错误 ⇒ `[AN_CHANNEL]` 兜底（大声, 不吞 cause 语义）。
 *
 * DSH 面: cordis `Context` 类型 only（dsh-adapter 领地 — INV-PERM-5
 * 豁免目录; 命令注册表经结构 Like 面消费 — 同 `investigate-command.ts`
 * `CommandRegistrarLike`）。
 */

import type { Context } from '@deepseek-ai/cordis'

import {
  ANALYSIS_LIST_COMMAND_NAME,
  ANALYSIS_SAVE_COMMAND_NAME,
  ANALYSIS_TRANSIENT_READ_COMMAND_NAME,
  analysisCommandGrammar,
  isSavePayloadShapeError,
  parseAnalysisSaveInput,
  parseTransientReadInput,
  type AnalysisRecordDto,
  type InvestigatorTransientDto,
  type SaveAnalysisRecordArgs,
} from '../../../shared/analysis-command.js'
import { isAnalysisError } from '../../service/analysis/index.js'
import { USER_ACTOR } from '../../service/analysis/index.js'
import type { AnalysisRecordRecord } from '../../service/analysis/index.js'
import type { AnalysisTransientSnapshot } from '../../service/analysis/index.js'
import type { SaveAnalysisRecordParams } from '../../service/analysis/index.js'
import type { HostWiring } from '../../service/wiring/index.js'
import type { CommandOutcome } from './investigate-command.js'
import type { CommandRegistrarLike } from './investigate-command.js'

/* ------------------------------------------------------------------ *
 * 投影（host snake_case 行 → 线形 DTO — 单源类型在 shared; 缺席 =
 * null 诚实透出, 不虚构 — 与 transient 读面的 null 语义一致）
 * ------------------------------------------------------------------ */

/** One analysis_record row → the wire DTO（camelCase 投影 — 冻结
 *  $defs/AnalysisRecord 字段集合逐字）。 */
function toRecordDto(record: AnalysisRecordRecord): AnalysisRecordDto {
  return {
    id: record.id,
    sourceRef: { kind: record.source_ref.kind, id: record.source_ref.id },
    investigatorRunId: record.investigator_run_id ?? null,
    dshSessionId: record.dsh_session_id ?? null,
    content: record.content,
    createdAt: record.created_at,
  }
}

/** A transient snapshot → the wire DTO（三 null 面逐字段投影）。 */
function toTransientDto(snapshot: AnalysisTransientSnapshot): InvestigatorTransientDto {
  const session = snapshot.session === null
    ? null
    : {
        id: snapshot.session.id,
        cwd: snapshot.session.cwd ?? null,
        title: snapshot.session.title ?? null,
        running: snapshot.session.running,
        createdAt: snapshot.session.createdAt,
      }
  const pointer = snapshot.pointer === null
    ? null
    : {
        workstreamId: snapshot.pointer.workstreamId,
        taskId: snapshot.pointer.taskId ?? null,
        intent: snapshot.pointer.intent ?? null,
        lastSeq: snapshot.pointer.lastSeq,
        runId: snapshot.pointer.runId,
        runStartedAt: snapshot.pointer.runStartedAt,
      }
  const run = snapshot.run === null
    ? null
    : {
        id: snapshot.run.id,
        workstreamId: snapshot.run.workstreamId,
        status: snapshot.run.status,
        startedAt: snapshot.run.startedAt,
        endedAt: snapshot.run.endedAt,
      }
  return { sessionId: snapshot.sessionId, session, pointer, run }
}

/* ------------------------------------------------------------------ *
 * Handler 面（导出 — 单测直调; 注册函数是薄包装, 同 investigate-
 * command.ts 的纯 handler + 注册 seam 分割）
 * ------------------------------------------------------------------ */

/**
 * The transient-read handler（`/research-transient-read <会话id>`）.
 * @param wiring - the live host wiring（`analysisTransient` 读面 —
 *  全读零写入, INV-PERM-3 类型面）。
 */
export function makeTransientReadHandler(
  wiring: HostWiring,
): (invocation: { readonly rawInput: string }) => Promise<CommandOutcome> {
  return async (invocation): Promise<CommandOutcome> => {
    const sessionId = parseTransientReadInput(invocation.rawInput)
    if (sessionId === null) {
      return { kind: 'error', text: `语法: ${ANALYSIS_TRANSIENT_READ_COMMAND_NAME} <会话id>（语法全表: ${analysisCommandGrammar}）` }
    }
    try {
      const snapshot = wiring.analysisTransient.read(sessionId)
      return { kind: 'success', text: JSON.stringify(toTransientDto(snapshot)) }
    } catch (cause) {
      return mapAnalysisFailure(cause, 'transient 读取')
    }
  }
}

/**
 * The analysis-list handler（`/research-analysis-list` — 无参）。
 * @param wiring - the live host wiring（`analysisService` 查询面）。
 */
export function makeAnalysisListHandler(
  wiring: HostWiring,
): (invocation: { readonly rawInput: string }) => Promise<CommandOutcome> {
  return async (): Promise<CommandOutcome> => {
    try {
      const rows = wiring.analysisService.listAnalysisRecords()
      return { kind: 'success', text: JSON.stringify([...rows].map(toRecordDto)) }
    } catch (cause) {
      return mapAnalysisFailure(cause, '分析记录列表读取')
    }
  }
}

/**
 * The analysis-save handler（`/research-analysis-save <单行JSON>` —
 * 用户显式保存, INV-PERM-3 落地面; actor = `USER_ACTOR` — 通道层用户
 * 语义见模块头, 宿主 `assertUserActor` 门是第二道保险）。
 * @param wiring - the live host wiring（`analysisService` 保存面）。
 */
export function makeAnalysisSaveHandler(
  wiring: HostWiring,
): (invocation: { readonly rawInput: string }) => Promise<CommandOutcome> {
  return async (invocation): Promise<CommandOutcome> => {
    let args: SaveAnalysisRecordArgs | null
    try {
      args = parseAnalysisSaveInput(invocation.rawInput)
    } catch (cause) {
      // 线形门形状偏离（共享解析器的 SavePayloadShapeError — 携带逐字
      // 原因 — 比语法提示更精确, 直接透出）。
      if (isSavePayloadShapeError(cause)) {
        return { kind: 'error', text: cause.message }
      }
      return mapAnalysisFailure(cause, '保存载荷解析')
    }
    if (args === null) {
      return { kind: 'error', text: `语法: ${ANALYSIS_SAVE_COMMAND_NAME} <单行JSON: {sourceRef:{kind,id}, content, investigatorRunId?, dshSessionId?}>（载荷须为单行 JSON 对象 — 语法全表: ${analysisCommandGrammar}）` }
    }
    try {
      // 线形 DTO（kind: string — 共享显示面）→ 宿主参数面（kind:
      // ObjectKind 闭集）: 该边界 cast 是安全的 — 宿主 `assertSourceRef`
      // 对 kind 做冻结 24 值闭集复验 + id 模式复验（AN_INPUT 零写入 —
      // 映射回本 error 结果）; 形状门在共享解析器, 契约门在宿主 service,
      // 分层不越权（INV-PERM-3 双钉同款纪律）。
      const params = {
        sourceRef: { kind: args.sourceRef.kind, id: args.sourceRef.id },
        content: args.content,
        ...(args.investigatorRunId === undefined ? {} : { investigatorRunId: args.investigatorRunId }),
        ...(args.dshSessionId === undefined ? {} : { dshSessionId: args.dshSessionId }),
      } as SaveAnalysisRecordParams
      const result = wiring.analysisService.saveAsAnalysisRecord(params, USER_ACTOR)
      return { kind: 'success', text: JSON.stringify(toRecordDto(result.record)) }
    } catch (cause) {
      return mapAnalysisFailure(cause, 'AnalysisRecord 保存')
    }
  }
}

/** 宿主 analysis 失败 → 命令 error 结果（`[<code>] <message>` 逐字 —
 *  GUI fault 行渲染; 非 AnalysisError = `[AN_CHANNEL]` 兜底, 不吞）。 */
function mapAnalysisFailure(cause: unknown, what: string): CommandOutcome {
  if (isAnalysisError(cause)) {
    return { kind: 'error', text: `[${cause.code}] ${cause.message}` }
  }
  const message = cause instanceof Error ? cause.message : String(cause)
  return { kind: 'error', text: `[AN_CHANNEL] ${what}失败: ${message}` }
}

/* ------------------------------------------------------------------ *
 * 注册（disposer 经调用方 `ctx.effect` 挂入插件生命周期 — 同
 * investigate-command.ts 的 registration-as-effect 纪律）
 * ------------------------------------------------------------------ */

/**
 * Register the three analysis data-face commands on the host command
 * registry（the disposer unregisters all three on fiber unmount — 一条
 * disposer 逆序回滚; 无命令注册表的部署返回 `null`, 调用方大声点名 —
 * 数据面随一键入口同批降级, 不静默）。
 *
 * @param ctx - the host context（`ctx.get('commands')` 结构面）。
 * @param wiring - the live host wiring.
 * @returns the disposer, or null（no command registry — non-web
 *  profile）.
 */
export function registerAnalysisCommands(ctx: Context, wiring: HostWiring): (() => void) | null {
  const registrar = (ctx as unknown as { get: (name: string) => unknown }).get('commands') as
    | CommandRegistrarLike
    | undefined
  if (registrar === undefined) return null

  const disposeTransient = registrar.register({
    name: ANALYSIS_TRANSIENT_READ_COMMAND_NAME,
    description: '读取一个 investigator 会话的 transient 分析快照（只读 — 零 operational 表写入; 参数: 会话 id）',
    input: { hint: '<会话id>' },
    handler: makeTransientReadHandler(wiring),
  })
  const disposeList = registrar.register({
    name: ANALYSIS_LIST_COMMAND_NAME,
    description: '列出本项目已保存的 AnalysisRecord（用户显式保存的不可变记录 — createdAt 升序）',
    handler: makeAnalysisListHandler(wiring),
  })
  const disposeSave = registrar.register({
    name: ANALYSIS_SAVE_COMMAND_NAME,
    description: '将一次 investigator 分析显式保存为 AnalysisRecord（仅用户操作落盘 — INV-PERM-3; 参数: 单行 JSON 载荷）',
    // 保存载荷含用户分析全文（Markdown）— 持久面是插件 DB 的不可变
    // 记录, 会话日志只记命令事实不重复携带内容（`recordInput: false`
    // — 生命周期事件不带 args）。
    recordInput: false,
    input: { hint: '<单行JSON载荷>' },
    handler: makeAnalysisSaveHandler(wiring),
  })
  return () => {
    disposeTransient()
    disposeList()
    disposeSave()
  }
}
