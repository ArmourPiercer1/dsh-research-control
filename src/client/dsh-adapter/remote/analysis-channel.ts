/**
 * WP-7.4 / G7 S1 — the PRODUCTION `AnalysisDataProvider` implementation
 *（client 半 — G7 裁决 S1 的「AnalysisDataProvider 生产实现注入（保存
 * 按钮解禁）」落点）。
 *
 * ## 通道（四面 13-RPC 兼容性论证 — 既有 seam 复用, 见 WP-7.4 报告）
 *
 * 宿主消费面（`wiring.analysisTransient` / `wiring.analysisService` —
 * 本 WP 组合根 11e 步生产装配）经**插件自有 host 命令**暴露（
 * `src/host/dsh-adapter/host/analysis-commands.ts` — 与一键调查命令
 * 同一注册机制）, client 经 DSH 内置 `commands/execute` 网关域执行
 * （`command-carrier.ts` 共用载包 — 与一键调查通道同一载包路径）。
 * **零新增插件 RPC**: ARCHITECTURE §7.1 13-RPC 清单与
 * `src/shared/rpc-contracts.ts` 零触碰（git 可证）; 载体是 DSH 内置
 * 冻结宿主面, 命令是插件 host 侧注册 — 既有 seam 复用, 非解冻。
 *
 * ## 三个命令（线形 DTO 单源 = `src/shared/analysis-command.ts`）
 *
 *   - `readTransient(sessionId)` → `/research-transient-read <id>`
 *     → `InvestigatorTransientDto` JSON（宿主 `AnalysisTransientReader.
 *     read` — 三读端口全读零写入; 缺席 = null 诚实透出）;
 *   - `listAnalysisRecords()` → `/research-analysis-list`
 *     → `AnalysisRecordDto[]` JSON（宿主查询面 — 无隐藏过滤器,
 *     createdAt ASC 稳定序）;
 *   - `saveAnalysisRecord(args)` → `/research-analysis-save <单行JSON>`
 *     → `AnalysisRecordDto` JSON（宿主 `saveAsAnalysisRecord` 用户门 —
 *     INV-PERM-3「仅用户显式保存」: 本通道的唯一调用方是 GUI 保存按钮
 *     的用户显式提交 — 插件 host 代码不自调该命令, 模型无命令调度工具
 *     面〔§6 启动/保存行 P ❌ 的同一论证 — 见 WP-7.4 报告〕）。
 *
 * ## Fail-loud 面（缝纪律 — 同 NOT_WIRED 的「绝不伪造数据」, 但已接线:
 *  失败 = 大声报错, 成功 = 宿主真值逐字）:
 *  - 无当前宿主会话 id ⇒ throw（先于网络 — 调查员页已大声点名缺口,
 *    本守卫是第二道防线, 不猜目标会话）;
 *  - 载包契约偏离 ⇒ 共用载包 throw（非 2xx / 非 JSON / 非
 *    server-response / 命令未解析 — GUI 必须显示）;
 *  - 命令 error 结果（宿主 `[AN_*]` / 线形门 `[语法]` 映射）⇒ throw
 *    携带逐字文本（操作失败 — 容器 fault 面渲染; 数据面不提交半载荷）;
 *  - 成功文本非合法 JSON / 形状偏离 ⇒ throw（单源漂移 — 契约偏离大声
 *    点名, 不降级渲染）。
 *
 * 零 DSH import（纯载包 fetch — check-imports 0 违规; dsh-adapter/
 * remote 领地 = 载包面归属纪律）。工厂无模块级状态（同 WP-4.1b /
 * WP-5.2 / WP-6.4 工厂纪律 — 会话读取器经闭包注入, 每次命令执行现读,
 * 不缓存挂载时的旧值）。
 */

import type {
  AnalysisDataProvider,
  AnalysisRecordDto,
  InvestigatorTransientDto,
  SaveAnalysisRecordArgs,
} from '../../stores/analysis-slice.js'
import {
  buildAnalysisListLine,
  buildAnalysisSaveLine,
  buildTransientReadLine,
} from '../../../shared/analysis-command.js'
import { executeHostCommand } from './command-carrier.js'

/**
 * 生产 `AnalysisDataProvider`（G7 S1 保存按钮解禁 — 宿主消费面的
 * client 通道）。
 * @param getSessionId - 当前宿主会话 id 的读取器（cockpit 以 ref 闭包
 *  传框架 slot 标准 kit 的 `sessionId` — 每次命令执行时现读, 不缓存
 *  挂载时的旧值; 空白 = 无会话缺口, 大声 throw 先于网络）。
 */
export function createCommandAnalysisDataProvider(
  getSessionId: () => string,
): AnalysisDataProvider {
  return {
    async readTransient(sessionId: string): Promise<InvestigatorTransientDto> {
      assertCarrierSession(getSessionId)
      const outcome = await executeHostCommand(getSessionId(), buildTransientReadLine(sessionId))
      if (outcome.kind === 'error') {
        throw new Error(`transient 读取失败: ${outcome.message}`)
      }
      return parseJson<InvestigatorTransientDto>(outcome.text, 'transient 快照', (value) =>
        value !== null
        && typeof value === 'object'
        && typeof (value as { sessionId?: unknown }).sessionId === 'string',
      )
    },

    async listAnalysisRecords(): Promise<readonly AnalysisRecordDto[]> {
      assertCarrierSession(getSessionId)
      const outcome = await executeHostCommand(getSessionId(), buildAnalysisListLine())
      if (outcome.kind === 'error') {
        throw new Error(`分析记录列表读取失败: ${outcome.message}`)
      }
      const parsed = parseJson<readonly AnalysisRecordDto[]>(outcome.text, '分析记录列表', (value) =>
        Array.isArray(value),
      )
      for (const record of parsed) {
        assertRecordShape(record)
      }
      return parsed
    },

    async saveAnalysisRecord(args: SaveAnalysisRecordArgs): Promise<AnalysisRecordDto> {
      assertCarrierSession(getSessionId)
      const outcome = await executeHostCommand(getSessionId(), buildAnalysisSaveLine(args))
      if (outcome.kind === 'error') {
        // 宿主用户门拒绝（AN_ACTOR_FORBIDDEN — 不应发生: 本通道只经
        // 用户显式提交, 但拒绝文本必须原样透出, 不静默）/ 冻结网拒绝
        // （AN_STORE）/ 线形门拒绝 — 全部逐字。
        throw new Error(`AnalysisRecord 保存失败: ${outcome.message}`)
      }
      const saved = parseJson<AnalysisRecordDto>(outcome.text, '保存产物', (value) =>
        value !== null && typeof value === 'object',
      )
      assertRecordShape(saved)
      return saved
    },
  }
}

/** 载包会话守卫（先于网络 — 无当前宿主会话 = 缺口, 大声, 不猜目标）。 */
function assertCarrierSession(getSessionId: () => string): void {
  const sessionId = getSessionId()
  if (sessionId === '') {
    throw new Error('analysis 数据通道不可用: 当前无宿主会话 id（session 作用域插槽未解析出 sessionId — 先打开一个宿主会话）')
  }
}

/** 严格 JSON 回解（契约偏离 — 非 JSON / 形状偏离 = throw, 不降级）。 */
function parseJson<T>(
  text: string | undefined,
  what: string,
  shape: (value: unknown) => boolean,
): T {
  if (text === undefined || text === '') {
    throw new Error(`analysis 数据通道: 命令成功但无载荷文本（${what} — 单源漂移, 契约偏离）`)
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`analysis 数据通道: ${what} 载荷不是合法 JSON（前 120 字符: ${text.slice(0, 120)} — 契约偏离）`)
  }
  if (!shape(value)) {
    throw new Error(`analysis 数据通道: ${what} 载荷形状偏离（前 120 字符: ${text.slice(0, 120)} — 单源漂移, 契约偏离）`)
  }
  return value as T
}

/** 记录形状门（线形 DTO 关键字段 — 漂移大声, 不渲染半记录）。 */
function assertRecordShape(record: AnalysisRecordDto): void {
  const bad = record === null
    || typeof record !== 'object'
    || typeof record.id !== 'string'
    || record.id.length === 0
    || typeof record.content !== 'string'
    || record.content.length === 0
    || typeof record.createdAt !== 'number'
    || record.sourceRef === null
    || typeof record.sourceRef !== 'object'
    || typeof record.sourceRef.kind !== 'string'
    || typeof record.sourceRef.id !== 'string'
  if (bad) {
    throw new Error(`analysis 数据通道: AnalysisRecord 载荷形状偏离（${JSON.stringify(record).slice(0, 120)} — 契约偏离）`)
  }
}
