/**
 * WP-5.5 — `buildBrief()` host 服务面（投影组装 — 纯组装, 零持久化）。
 *
 * 职责（任务目标 2）: 组装各数据面快照 → `projectBrief` 三级投影。
 * 「Brief 是 projection，不是 source of truth」（INV-ATTN-3 / 计划书
 * §19.2）的存储面表达: **无表、无 DDL、无 RPC、无写路径** — 每次
 * `buildBrief()` 从注入端口取活数据现算; 数据面变更 ⇒ 下次 build 即
 * 收敛（不需要同步, 因为本层从不持有一等状态）。冻结 14 方法面
 * （ARCHITECTURE §7.1）无 brief RPC — 本 WP 不造第 15 个
 * （WP-4.1b RR-015① 同口径）; client 侧由 store 切片经**同一**
 * `projectBrief` 从 wire 快照派生（`src/client/stores/brief-slice.ts`）,
 * 两侧算法单一真源（同 WP-5.4 attention 评分器口径）。
 *
 * 端口（thunk — 每次 build 取活数据; 全部可选, 缺省 = 空集/null —
 * **不伪造数据**, WP-4.1a `null` 占位纪律）。生产数据源与映射:
 *   - getDashboard        → host 组装面（同 RPC getDashboard 的 host 侧真身）;
 *   - getAttentionRanking → WP-5.4 `AttentionService.getAttentionRanking()`;
 *   - getInterventions    → WP-5.1 `InterventionService.listActive()`
 *                           （flooding `InterventionRecord`; CLOSED 行
 *                           buildBrief 防御性过滤 — WP-5.4 service 同口径）;
 *   - getObjectives       → WP-5.2 `ActionsService.listObjectives()`
 *                           （loader `ObjectiveDoc` 声明式面）;
 *   - getHistoryDigest    → 各 owner WS 的 `queryEvents`/`collectAllEvents`
 *                           最近窗口（存储 `HistoryEventRecord`; 窗口大小
 *                           归调用方 — 引擎再截断最近 5 条摘要）;
 *   - getNextActions      → WP-5.2 `ActionsService.listNextActions()`
 *                           （buildBrief 只收 PROPOSED — §9.3 状态机）;
 *   - getBlockers         → WP-5.2 `ActionsService.listBlockers()`
 *                           （buildBrief 只收 ACTIVE — §9.4 状态机）;
 *   - getScheduledEvents  → WP-5.3 `ReportingService.listScheduledEvents()`;
 *   - getReportingItems   → WP-5.3 `ReportingService.listReportingItems()`;
 *   - getInteractions     → WP-5.3 `ReportingService.listInteractions()`;
 *   - getFuturePlans      → 声明式层 canonical plan 头部（调用方经
 *                           loader/PlanStore 抽取后直接给引擎形状 —
 *                           本层不读文件, service/ 编排面不代 domain/ 越权）。
 *
 * 端口抛出 = buildBrief 抛出（fail loud — caller-owned; 不做逐端口
 * 降级: 数据面故障时宁可整个 Brief 失败, 也不渲染半真半假的投影）。
 *
 * 自检门（INV-ATTN-3 机器形态的执行面）: 每次 build 后跑
 * `validateBriefRefs` — 非空违规 = 内部一致性破坏 ⇒ 大声抛错
 * （引擎全定义下本不应发生; 发生即规格违反, 不静默）。
 *
 * 无 DSH import（INV-PERM-5）; 零 sqlite import（本层零持久化）。
 */

import type { DashboardSnapshot } from '../../../shared/rpc-contracts.js'
import type { AttentionRanking } from '../attention/scorer.js'
import type { InterventionRecord } from '../flooding/types.js'
import type { ObjectiveDoc } from '../../domain/loader/types.js'
import type { HistoryEventRecord } from '../../persistence/store/types.js'
import type { BlockerRecord, NextActionRecord } from '../actions/types.js'
import type { InteractionRecord, ReportingItemRecord, ScheduledEventRecord } from '../reporting/types.js'
import {
  blockerToBrief,
  historyEventToBrief,
  interactionToBrief,
  interventionToBrief,
  nextActionToBrief,
  objectiveDocToBrief,
  reportingItemToBrief,
  scheduledEventToBrief,
} from './mapping.js'
import { projectBrief, validateBriefRefs } from './project.js'
import type { BriefFuturePlan, BriefInputs, LivingBrief } from './types.js'

/** 内部一致性违规（自检门失败 — 引擎全定义下不应发生, 发生即规格违反）。 */
export class BriefServiceError extends Error {
  readonly code = 'BRIEF_INTERNAL' as const

  constructor(message: string) {
    super(message)
    this.name = 'BriefServiceError'
  }
}

/**
 * `buildBrief` 的数据源端口（thunk; 全部可选 — 缺省 = 空集/null,
 * 不伪造数据。生产数据源映射见模块头注; WP-5.4 未决 3 的四个注意力
 * 端口生产映射（NA/BLK/SEV record → 评分输入项）在 `mapping.ts` —
 * 注意力排序的组装归 WP-5.4 `AttentionService`, 本面只消费其输出）。
 */
export interface BriefSourcePorts {
  readonly getDashboard?: () => DashboardSnapshot
  readonly getAttentionRanking?: () => AttentionRanking
  readonly getInterventions?: () => readonly InterventionRecord[]
  readonly getObjectives?: () => readonly ObjectiveDoc[]
  readonly getHistoryDigest?: () => readonly HistoryEventRecord[]
  readonly getNextActions?: () => readonly NextActionRecord[]
  readonly getBlockers?: () => readonly BlockerRecord[]
  readonly getScheduledEvents?: () => readonly ScheduledEventRecord[]
  readonly getReportingItems?: () => readonly ReportingItemRecord[]
  readonly getInteractions?: () => readonly InteractionRecord[]
  readonly getFuturePlans?: () => readonly BriefFuturePlan[]
}

/**
 * host 侧 Brief 组装（纯函数 — 同端口状态 + 同 now ⇒ 同输出）。
 * @param ports - 数据源端口（缺省 = 空集/null 占位）。
 * @param now - 投影时刻 epoch ms（调用方注入 — 确定性）。
 * @returns 三级 `LivingBrief`（已过 `validateBriefRefs` 自检门）。
 */
export function buildBrief(ports: BriefSourcePorts, now: number): LivingBrief {
  const inputs: BriefInputs = {
    attention: ports.getAttentionRanking !== undefined ? ports.getAttentionRanking() : null,
    dashboard: ports.getDashboard !== undefined ? ports.getDashboard() : null,
    // CLOSED 防御性过滤（端口契约已限 OPEN/PENDING — 双保险, WP-5.4 同口径）。
    interventions: (ports.getInterventions?.() ?? [])
      .filter((record) => record.status !== 'CLOSED')
      .map(interventionToBrief),
    objectives: (ports.getObjectives?.() ?? []).map(objectiveDocToBrief),
    history: (ports.getHistoryDigest?.() ?? []).map(historyEventToBrief),
    // 状态机过滤（§9.3/§9.4: 只有 PROPOSED / ACTIVE 属于队列面）。
    nextActions: (ports.getNextActions?.() ?? []).filter((n) => n.status === 'PROPOSED').map(nextActionToBrief),
    blockers: (ports.getBlockers?.() ?? []).filter((b) => b.status === 'ACTIVE').map(blockerToBrief),
    scheduledEvents: (ports.getScheduledEvents?.() ?? []).map(scheduledEventToBrief),
    reportingItems: (ports.getReportingItems?.() ?? []).map(reportingItemToBrief),
    interactions: (ports.getInteractions?.() ?? []).map(interactionToBrief),
    futurePlans: ports.getFuturePlans?.() ?? [],
  }

  const brief = projectBrief(inputs, now)
  const violations = validateBriefRefs(brief)
  if (violations.length > 0) {
    throw new BriefServiceError(
      `buildBrief: self-check failed — INV-ATTN-3 ref 完整性违规（引擎全定义下不应发生）: ${violations.join('; ')}`,
    )
  }
  return brief
}

/**
 * `BriefService` — host 接线用服务对象（薄封装: 端口 + 时钟注入;
 * 与 AttentionService/ActionsService/ReportingService 同族形态,
 * 但**零存储依赖** — Brief 不持久化, 生命周期面不需要 close）。
 */
export interface BriefServiceOptions extends BriefSourcePorts {
  /** Injectable clock（默认 `Date.now` — 测试注入确定性时钟）。 */
  readonly now?: () => number
}

export class BriefService {
  private readonly ports: BriefSourcePorts
  private readonly now: () => number

  constructor(options: BriefServiceOptions) {
    this.ports = {
      getDashboard: options.getDashboard,
      getAttentionRanking: options.getAttentionRanking,
      getInterventions: options.getInterventions,
      getObjectives: options.getObjectives,
      getHistoryDigest: options.getHistoryDigest,
      getNextActions: options.getNextActions,
      getBlockers: options.getBlockers,
      getScheduledEvents: options.getScheduledEvents,
      getReportingItems: options.getReportingItems,
      getInteractions: options.getInteractions,
      getFuturePlans: options.getFuturePlans,
    }
    this.now = options.now ?? Date.now
  }

  /** 组装三级 Brief（每次调用取活数据 — projection 不缓存）。 */
  buildBrief(): LivingBrief {
    return buildBrief(this.ports, this.now())
  }
}
