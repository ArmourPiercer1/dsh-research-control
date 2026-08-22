/**
 * WP-3.5 — flooding 检测器（纯函数; PLAN_FORK_SPEC §8 规则的逐字落地）。
 *
 * 冻结规则（§8 原文）:
 *   触发点: 每次 PF 创建后; 每次 plan 加载后（触发点的挂接 = service 钩子面）;
 *   规则: `count(status == OPEN 的 PF, per workstream) > threshold`
 *         （默认 5，policy 可调）且该 workstream 不存在 origin=AUTO_FLOODING
 *         的 OPEN Intervention;
 *   口径: **per-WS 独立计数**（A-15 修订, 用户确认 — 计划书 §11.6 区域口径的
 *         工程简化: per-WS 总数 ≥ 任意区域覆盖数, 同阈值触发不晚于区域口径,
 *         方向保守且实现确定）。
 *
 * ## 窗口（任务口径「窗口/计数/阈值」证据三件套）
 *
 * 冻结规则的观察窗口 = 该 WS 当前 **OPEN 状态集**（§8 无时间窗字段; §9
 * flooding policy 唯一字段 = `threshold`）。窗口随状态**滑动**: PF 离开 OPEN
 * （STALE/SELECTED/DISMISSED — §10 迁移）即滑出计数, 新创建的 PF 滑入。
 * 输入是「时间窗内 PF 创建记录」形态（调用方按触发点收集该 WS 的 PF 记录,
 * 任意状态均可传入）, 检测器只计 OPEN 子集并输出结构化证据:
 * `{ workstream_id, window: {kind, as_of, open_pf_ids}, count, threshold, rule }`。
 *
 * 纯函数: 零 I/O（OPEN 集合的读取 = service 经 PlanForkStore 缝, 抑制探针
 * = service 经 InterventionStore 缝; 本函数只判定）。
 */

import { PF_STATUSES, type PlanForkRecord } from '../../domain/planfork/index.js'
import {
  FloodingError,
  type FloodingDetectionParams,
  type FloodingEvidence,
  type FloodingVerdict,
} from './types.js'

/** §8 原文默认阈值（「默认 5」; 冻结 policy schema 亦 default: 5）。 */
export const DEFAULT_FLOODING_THRESHOLD = 5

/** §8 规则原文（证据可读性 + 测试锚点）。 */
export const FLOODING_RULE = 'count(status == OPEN, per workstream) > threshold'

/** 冻结 idWorkstream 模式（common.schema.json `^WS-[1-9][0-9]*$`）。 */
const WS_ID_PATTERN = /^WS-[1-9][0-9]*$/

/**
 * §8 判定（module header 规则原文的机械实现）。
 *
 * 输入校验（FLOODING_INPUT, 精确指名失败项）:
 *   - `workstreamId` 非空且过冻结 WS id 模式;
 *   - `asOf` 非负 safe-integer epoch ms（§1.2/A-3）;
 *   - `threshold`（提供时）= safe-integer **≥ 1**（冻结 policy schema
 *     `flooding.threshold`: integer minimum 1 — 0 非法, 同 WP-3.1 policy 负例）;
 *   - `planForks` 数组; 每元素 `id` 非空且**全部属 `workstreamId`**（跨 WS
 *     混合 ⇒ 拒绝 — per-WS 口径的结构性保证, 不静默过滤）; id 不重复。
 */
export function detectPlanForkFlooding(params: FloodingDetectionParams): FloodingVerdict {
  const ws = params?.workstreamId
  if (typeof ws !== 'string' || ws.length === 0) {
    throw new FloodingError({ code: 'FLOODING_INPUT', message: 'workstreamId must be a non-empty string' })
  }
  if (!WS_ID_PATTERN.test(ws)) {
    throw new FloodingError({
      code: 'FLOODING_INPUT',
      message: `workstreamId ${JSON.stringify(ws)} is not a well-formed WS id (common.schema.json idWorkstream: ^WS-[1-9][0-9]*$)`,
    })
  }
  const asOf = params.asOf
  if (typeof asOf !== 'number' || !Number.isSafeInteger(asOf) || asOf < 0) {
    throw new FloodingError({
      code: 'FLOODING_INPUT',
      message: `asOf must be a non-negative safe integer epoch ms (got ${String(asOf)}; §1.2/A-3)`,
    })
  }
  const threshold = params.threshold ?? DEFAULT_FLOODING_THRESHOLD
  if (typeof threshold !== 'number' || !Number.isSafeInteger(threshold) || threshold < 1) {
    throw new FloodingError({
      code: 'FLOODING_INPUT',
      message: `threshold must be an integer >= 1 (got ${String(threshold)}; 冻结 policy schema flooding.threshold: integer minimum 1, default ${DEFAULT_FLOODING_THRESHOLD} — PLAN_FORK_SPEC §8/§9)`,
    })
  }
  const forks = params.planForks
  if (!Array.isArray(forks)) {
    throw new FloodingError({ code: 'FLOODING_INPUT', message: 'planForks must be an array (the in-window PF records of ONE workstream)' })
  }

  // per-WS 口径 (A-15): 输入必须全部属被检 WS（跨 WS 混合 = 调用方口径错误 —
  // 大声失败而非静默过滤, 否则「独立计数」失去结构性保证）。
  const seen = new Set<string>()
  for (let i = 0; i < forks.length; i++) {
    const pf = forks[i]!
    if (pf === null || typeof pf !== 'object') {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: `planForks[${i}] must be a PlanFork record (got ${typeof pf})` })
    }
    const id = (pf as PlanForkRecord).id
    if (typeof id !== 'string' || id.length === 0) {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: `planForks[${i}].id must be a non-empty string` })
    }
    if (seen.has(id)) {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: `planForks contains duplicate PF id ${JSON.stringify(id)} (the in-window record set must be a set)` })
    }
    seen.add(id)
    const pfWs = (pf as PlanForkRecord).workstream_id
    if (pfWs !== ws) {
      throw new FloodingError({
        code: 'FLOODING_INPUT',
        message: `planForks[${i}] (${id}) belongs to ${JSON.stringify(String(pfWs))}, not ${JSON.stringify(ws)} — flooding counts are PER WORKSTREAM (A-15 口径, 用户确认); pass that workstream's own records`,
      })
    }
    const status = (pf as PlanForkRecord).status
    if (typeof status !== 'string' || !(PF_STATUSES as readonly string[]).includes(status)) {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: `planForks[${i}].status must be one of ${PF_STATUSES.join('|')} (got ${JSON.stringify(String(status))})` })
    }
    const createdAt = (pf as PlanForkRecord).created_at
    if (typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) || createdAt < 0) {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: `planForks[${i}].created_at must be a non-negative safe integer epoch ms (got ${String(createdAt)})` })
    }
  }

  // 观察窗口 = OPEN 子集（§8 计数面）; 稳定顺序 (created_at ASC, id ASC)
  // —— 与 PlanForkStore.listPlanForks 的 ORDER BY 一致（source_refs 顺序可重现）。
  const openForks = forks
    .filter((pf) => pf.status === 'OPEN')
    .sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.created_at - b.created_at))
  const openPfIds = openForks.map((pf) => pf.id)
  const count = openPfIds.length

  const evidence: FloodingEvidence = {
    workstream_id: ws,
    window: { kind: 'OPEN_STATE', as_of: asOf, open_pf_ids: openPfIds },
    count,
    threshold,
    rule: FLOODING_RULE,
  }

  // §8 原文: `count > threshold`（严格大于 — count == threshold 不触发）。
  const triggered = count > threshold
  if (!triggered) {
    return { triggered: false, suppressed: false, reason: 'COUNT_AT_OR_BELOW_THRESHOLD', evidence }
  }
  // §8 规则后半句: 且该 WS 不存在 origin=AUTO_FLOODING 的 OPEN Intervention。
  if (params.hasOpenAutoFloodingIntervention === true) {
    return { triggered: true, suppressed: true, reason: 'OPEN_AUTO_FLOODING_EXISTS', evidence }
  }
  return { triggered: true, suppressed: false, evidence }
}
