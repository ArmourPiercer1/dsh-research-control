/**
 * WP-5.1 — Intervention 分组切片（store 层独立新文件 — 多 WP 并行纪律:
 * 不改既有 store 文件, 视图容器 import 本文件）。
 *
 * ## 切片语义（任务目标 4）
 *
 * 数据源 = 既有 **dashboard 切片**（`getDashboard` 的 openInterventions +
 * pendingInterventions — INV-ATTN-1: 两组始终完整, 冻结 RPC 面没有第三组;
 * CLOSED 组数据面待 DTO 扩展, 见报告「未决 2」）。本文件交付**纯投影**:
 *
 *   `deriveInterventionGroups(slice)` — dashboard 切片 → 分组模型
 *   `groupInterventionsByOrigin(open, pending)` — 纯函数（展示/测试可直用）
 *
 * ## 分组口径（任务目标 3: GroupBy 机械触发 / 用户创建）
 *
 *   - **机械触发** `MECHANICAL`: origin ∈ AGENT_REPORT / AUTO_FLOODING /
 *     AUTO_AUDIT — 恰好 = ARCHITECTURE §6 脚注 ¹ 的三类机械触发闭集
 *     （INV-ATTN-5 的展示侧投影; 与 host 侧 WP-5.1
 *     `MECHANICAL_TRIGGER_ORIGIN` 的值集逐字同构 — 双端 pin 在测试）;
 *   - **用户创建** `USER_CREATED`: origin = USER。
 *
 * 未知 origin 大声失败（冻结 4 值枚举外的值 = 线面破损, 不静默归组）。
 *
 * **INV-ATTN-1（只排序不隐藏）的展示半边**: 投影**全量**收纳输入项 —
 * 不截断、不按状态/WS/来源过滤、不折叠; 组内顺序 = 输入顺序（OPEN 组
 * 在前、PENDING 组在后, 各继承 host 稳定顺序 created_at ASC, id ASC）,
 * 组序固定 [机械触发, 用户创建]。排序是**允许**的（「只排序」）, 过滤
 * 是**禁止**的 — 本投影零过滤, 计数逐字可断言。
 *
 * 依赖纪律: 纯函数 + 类型, 零 React / 零 DSH import（store 层保持
 * framework-agnostic — 同 WP-4.1b engine 纪律; 绑定 hook 在视图包
 * binding-hooks.ts, 同 WP-4.3/4.6 每包一个绑定层的先例）。
 */

import type { DashboardSnapshot, InterventionDto } from '../../shared/rpc-contracts.js'
import type { SliceState } from './model.js'

/** 来源组（GroupBy 机械触发 / 用户创建 — 任务目标 3）。 */
export type InterventionSourceGroup = 'MECHANICAL' | 'USER_CREATED'

/** 来源 → 组的分类映射（冻结 4 值 origin 的完整划分 — 零自由度）。 */
export const ORIGIN_SOURCE_GROUP: Readonly<Record<InterventionDto['origin'], InterventionSourceGroup>> = {
  USER: 'USER_CREATED',
  AGENT_REPORT: 'MECHANICAL',
  AUTO_FLOODING: 'MECHANICAL',
  AUTO_AUDIT: 'MECHANICAL',
}

/** 机械触发组 = ARCHITECTURE §6 脚注 ¹ 三类机械触发的 origin 值集（INV-ATTN-5 展示侧）。 */
export const MECHANICAL_ORIGINS: readonly InterventionDto['origin'][] = ['AGENT_REPORT', 'AUTO_FLOODING', 'AUTO_AUDIT']
/** 用户创建组 = 用户类 origin（§6 矩阵「Intervention 创建」U 栏）。 */
export const USER_CREATED_ORIGINS: readonly InterventionDto['origin'][] = ['USER']

/** 一个来源组（组内顺序 = 输入顺序 — 只排序不隐藏, INV-ATTN-1）。 */
export interface InterventionGroup {
  readonly source: InterventionSourceGroup
  readonly items: readonly InterventionDto[]
}

/** 分组模型（组序固定: [机械触发, 用户创建] — 即使空组也在, 计数可断言）。 */
export interface InterventionGrouping {
  readonly groups: readonly InterventionGroup[]
  /** 收纳总数 = open + pending 输入项数（全量 — 无隐藏过滤器）。 */
  readonly total: number
}

/**
 * origin → 来源组（未知 origin 大声失败 — 冻结枚举外的值 = 线面破损,
 * 不静默归组）。
 */
export function classifyOrigin(origin: InterventionDto['origin']): InterventionSourceGroup {
  const group = ORIGIN_SOURCE_GROUP[origin]
  if (group === undefined) {
    throw new Error(`intervention-slices: origin ${JSON.stringify(String(origin))} is not a member of the frozen origin enum — no silent grouping (INV-ATTN-1: 不隐藏, 也不猜)`)
  }
  return group
}

/**
 * 纯分组投影（任务目标 3）: 全量收纳 open + pending（INV-ATTN-1: 无
 * 隐藏过滤器）, 按来源二分（机械触发 / 用户创建）, 组序固定、组内保序。
 */
export function groupInterventionsByOrigin(
  open: readonly InterventionDto[],
  pending: readonly InterventionDto[],
): InterventionGrouping {
  const mechanical: InterventionDto[] = []
  const userCreated: InterventionDto[] = []
  // 输入序: OPEN 组在前、PENDING 组在后（各继承 host 稳定顺序）—
  // 「排序」是允许的（INV-ATTN-1 「只排序」半边）, 过滤是禁止的。
  for (const item of [...open, ...pending]) {
    if (classifyOrigin(item.origin) === 'MECHANICAL') mechanical.push(item)
    else userCreated.push(item)
  }
  return {
    groups: [
      { source: 'MECHANICAL', items: mechanical },
      { source: 'USER_CREATED', items: userCreated },
    ],
    total: mechanical.length + userCreated.length,
  }
}

/**
 * dashboard 切片 → 分组投影（slice 半边）: 未就绪切片 = 空分组（total 0,
 * 两组在位 — 视图据此渲染加载态而非空数据假象）。
 */
export function deriveInterventionGroups(slice: SliceState<DashboardSnapshot>): InterventionGrouping {
  const data = slice.data
  if (data === null) {
    return { groups: [{ source: 'MECHANICAL', items: [] }, { source: 'USER_CREATED', items: [] }], total: 0 }
  }
  return groupInterventionsByOrigin(data.openInterventions, data.pendingInterventions)
}
