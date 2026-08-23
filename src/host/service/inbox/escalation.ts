/**
 * WP-6.4 — 高影响升级的**机械判定**（纯函数; 计划书 §22.3「ESCALATE:
 * 高影响/未知/损失 → Intervention」的判定半边; 联动半边在
 * service.escalateMechanical）。
 *
 * 三规则（任务目标 1: 「批量影响/关键路径 — 机械判定」+ §22.3 原文
 * 「高影响/未知/损失」的机械落点; 零自由度, 零语义判断 — INV-SCI-2
 * 同精神: 只陈述计数/路径事实, 不判断科研理由）:
 *
 *   STRICT_TRACKED_CHANGE — 关键路径: 任一被触及路径落在 strict-tracked
 *     第一层（§14.1 `audit.strict_tracked.paths` = 「关键代码 / Task
 *     deliverables / merge 相关文件」; §22.1 第一层）⇒ 高影响;
 *   DELETION              — 损失: 存在被删除路径（§22.3「损失」档的
 *     机械面 — git 删除 = 未登记损失信号, 不自动推断含义）⇒ 高影响;
 *   BATCH_IMPACT          — 批量影响: affectedPathCount ≥ threshold
 *     （默认 5 — 对齐 WP-3.5 `DEFAULT_FLOODING_THRESHOLD` 既有阈值口径;
 *     注入面, safe integer ≥ 1）⇒ 高影响。
 *
 * 「未知」（§22.3 第二词）归 WP-6.3 reconciliation 的三档分类
 * （provenance 匹配失败 = 未知来源 — 语义匹配面, 非本层机械面）; 本层
 * 只消费机械事实。三规则任一命中 = highImpact（OR 语义, reasons 按
 * 冻结序全量列出 — 不短路, 证据面完整）。
 *
 * 确定性: 同输入同输出（reasons 冻结序; 无时钟、无 I/O）。
 */

import { ESCALATION_REASONS, type EscalationAssessment, type EscalationEvidence, type EscalationOptions, type EscalationReason } from './types.js'

/** 批量影响阈值默认值（对齐 WP-3.5 flooding 阈值口径 — 见模块头）。 */
export const DEFAULT_ESCALATION_BATCH_THRESHOLD = 5

/**
 * 机械高影响判定（纯; 永不抛 — 证据缺省字段 = 该规则不命中）。
 *
 * 证据字段口径（机械事实面, 见 `EscalationEvidence`）:
 *  - `strictTrackedPaths` — 触及的第一层路径（空/缺省 = 无关键路径触及）;
 *  - `deletedPaths` — 被删除路径（空/缺省 = 无删除）;
 *  - `affectedPathCount` — 受影响路径计数（缺省 = 0 = 不触发批量规则）。
 */
export function assessEscalation(evidence: EscalationEvidence, options: EscalationOptions = {}): EscalationAssessment {
  const reasons: EscalationReason[] = []
  for (const reason of ESCALATION_REASONS) {
    if (reason === 'STRICT_TRACKED_CHANGE') {
      if ((evidence.strictTrackedPaths?.length ?? 0) > 0) reasons.push(reason)
    } else if (reason === 'DELETION') {
      if ((evidence.deletedPaths?.length ?? 0) > 0) reasons.push(reason)
    } else if (reason === 'BATCH_IMPACT') {
      const threshold = options.batchThreshold ?? DEFAULT_ESCALATION_BATCH_THRESHOLD
      if (typeof threshold !== 'number' || !Number.isSafeInteger(threshold) || threshold < 1) {
        throw new RangeError(
          `assessEscalation: batchThreshold must be a safe integer >= 1 (got ${String(threshold)}; frozen policy 口径 = integer minimum 1, default ${DEFAULT_ESCALATION_BATCH_THRESHOLD})`,
        )
      }
      if ((evidence.affectedPathCount ?? 0) >= threshold) reasons.push(reason)
    }
  }
  return { highImpact: reasons.length > 0, reasons }
}

/**
 * 机械证据摘要（确定性格式 — 升级 Intervention 的 `detail` 落点, 同
 * WP-3.5 `buildAutoFloodingDetail` 先例: 只陈述计数/路径事实, 不判断
 * 科研理由）。
 */
export function buildEscalationDetail(evidence: EscalationEvidence, assessment: EscalationAssessment, threshold: number): string {
  const parts: string[] = []
  parts.push(`escalation (plan §22.3): highImpact=${assessment.highImpact}`)
  if (assessment.reasons.length > 0) {
    parts.push(`reasons=[${assessment.reasons.join(', ')}]`)
  }
  const strictCount = evidence.strictTrackedPaths?.length ?? 0
  if (strictCount > 0) {
    parts.push(`strict_tracked=${strictCount} [${evidence.strictTrackedPaths!.join(', ')}]`)
  }
  const deletedCount = evidence.deletedPaths?.length ?? 0
  if (deletedCount > 0) {
    parts.push(`deleted=${deletedCount} [${evidence.deletedPaths!.join(', ')}]`)
  }
  parts.push(`affected_paths=${evidence.affectedPathCount ?? 0}`)
  parts.push(`batch_threshold=${threshold}`)
  if ((evidence.workstreamIds?.length ?? 0) > 0) {
    parts.push(`workstreams=[${evidence.workstreamIds!.join(', ')}]`)
  }
  return parts.join('; ')
}

/** 升级 Intervention 的机械标题（§9.2 title 落点 — 非冻结字符串,
 *  机械派生: 无 WS 关联 = `High-impact research discrepancy`; 有 =
 *  首 WS id 逐字嵌入（同 WP-3.5 flooding 标题的 [WS-<n>] 机械格式））。 */
export function escalationInterventionTitle(workstreamIds: readonly string[] | undefined): string {
  const ws = workstreamIds?.[0]
  return ws === undefined ? 'High-impact research discrepancy' : `High-impact research discrepancy [${ws}]`
}
