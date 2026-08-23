/**
 * WP-5.2 — 注意力三对象视图模型（纯投影 — 零 I/O、零 store、零 DSH）。
 *
 * 展示分层纪律（同 WP-4.3/4.6 先例）: 本文件只把**冻结 DTO 载荷**投影成
 * 展示行/分组; 容器（actions-container.tsx）经 hook 拿切片状态后调本文件,
 * 再把纯 props 传给展示组件（actions-view.tsx — 零 hook）。
 *
 * ## 「NextAction 清单（按 objective 分组）」的分组规则（任务书目标 3 —
 * 展示投影, 不引入新数据）
 *
 * NextAction（§9.3 冻结字段）本身**没有** objective 引用字段 — 分组只能走
 * objective ↔ workstream 的既有声明式关联（§9.1/§2.2）:
 *   1. `workstreamId → topicId` 经切片载荷的 topic 上下文
 *      （`getTopic` 的 workstream 卡片 — TopicObjectiveContext）;
 *   2. Objective O 的候选 WS 集:
 *      - scope=PROJECT ⇒ 全部 topic 的全部 WS（项目级目标覆盖全项目）;
 *      - scope=TOPIC   ⇒ 把 O.id 列入 `objective_refs` 的那个 topic 的
 *        全部 WS（loader 保证 TOPIC scope 必属一个 topic, §9.1 条件必填
 *        topic_id; DTO 面无 topic_id 字段 ⇒ 经 objectiveRefs 反查, 该
 *        topic 的 `TopicSnapshot.objectives` 与之互证 — 冻结面双路径一致）;
 *   3. 一条 NextAction 进入其 WS 所属全部候选目标组（项目级 + 主题级可
 *      同现 — 展示语义「这些目标下有这些提案」, 非排他归属）;
 *   4. 无 workstreamId、或 WS 不在任何 topic 上下文、或所在 topic 无
 *      objectiveRefs 且无项目级目标覆盖 ⇒ 「未关联目标」组（悬空容错
 *      展示 — 同 §16.2「悬挂引用容错展示」纪律, 不报错）。
 *
 * 排序（全部确定性 — 无 Date.now 依赖）:
 *   - 组序: priority P0→P3, 再 id;「未关联目标」组恒在最后;
 *   - 组内: status 待转正(PROPOSED)→已转正(PROMOTED)→已弃用(DISMISSED),
 *     再 created_at, 再 id（终态沉底 — GUI 只关心可操作项在前）。
 */

import type { ObjectiveDto } from '../../../shared/rpc-contracts.js'
import type {
  BlockerItem,
  NextActionItem,
  ObjectiveProgressData,
  TopicObjectiveContext,
} from '../../stores/actions-slices.js'

/** 一个「按目标分组」的 NextAction 组（`objective: null` = 未关联目标组）。 */
export interface NextActionGroup {
  readonly objective: ObjectiveDto | null
  readonly items: readonly NextActionItem[]
  readonly proposedCount: number
}

const STATUS_RANK: Record<NextActionItem['status'], number> = {
  PROPOSED: 0,
  PROMOTED: 1,
  DISMISSED: 2,
}

const PRIORITY_RANK: Record<ObjectiveDto['priority'], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
}

function sortItems(items: readonly NextActionItem[]): NextActionItem[] {
  return [...items].sort((a, b) => {
    const s = STATUS_RANK[a.status] - STATUS_RANK[b.status]
    if (s !== 0) return s
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** wsId → topicId 索引（topic 上下文驱动）。 */
function buildWsTopicIndex(topics: readonly TopicObjectiveContext[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const topic of topics) {
    for (const wsId of topic.workstreamIds) index.set(wsId, topic.topicId)
  }
  return index
}

/** Objective O 的候选 WS 集（分组规则 2 — 见模块头）。 */
function candidateWsFor(
  objective: ObjectiveDto,
  topics: readonly TopicObjectiveContext[],
  allWsIds: Set<string>,
): Set<string> {
  if (objective.scope === 'PROJECT') return allWsIds
  const out = new Set<string>()
  for (const topic of topics) {
    if (!topic.objectiveRefs.includes(objective.id)) continue
    for (const wsId of topic.workstreamIds) out.add(wsId)
  }
  return out
}

/**
 * 按 objective 分组 NextAction 清单（规则见模块头; 只含 ≥1 条的组,
 * 「未关联目标」组仅当存在悬空项时出现在末尾）。
 */
export function groupNextActionsByObjective(
  items: readonly NextActionItem[],
  progress: ObjectiveProgressData | null,
): NextActionGroup[] {
  const topics = progress?.topics ?? []
  const objectives = progress?.objectives ?? []
  const wsTopic = buildWsTopicIndex(topics)
  const allWsIds = new Set(wsTopic.keys())

  // 每个 objective 的候选项（规则 2/3）。
  const buckets = new Map<string, NextActionItem[]>()
  const unassigned: NextActionItem[] = []
  for (const item of items) {
    const wsId = item.workstreamId
    if (wsId === null || wsTopic.has(wsId) === false) {
      unassigned.push(item)
      continue
    }
    let hit = false
    for (const objective of objectives) {
      const candidates = candidateWsFor(objective, topics, allWsIds)
      if (!candidates.has(wsId)) continue
      const bucket = buckets.get(objective.id) ?? []
      bucket.push(item)
      buckets.set(objective.id, bucket)
      hit = true
    }
    if (!hit) unassigned.push(item)
  }

  const sortedObjectives = [...objectives].sort((a, b) => {
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (p !== 0) return p
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const groups: NextActionGroup[] = []
  for (const objective of sortedObjectives) {
    const bucket = buckets.get(objective.id)
    if (bucket === undefined || bucket.length === 0) continue
    const sorted = sortItems(bucket)
    groups.push({
      objective,
      items: sorted,
      proposedCount: sorted.filter((i) => i.status === 'PROPOSED').length,
    })
  }
  if (unassigned.length > 0) {
    const sorted = sortItems(unassigned)
    groups.push({
      objective: null,
      items: sorted,
      proposedCount: sorted.filter((i) => i.status === 'PROPOSED').length,
    })
  }
  return groups
}

/** Blocker 显著区排序（ACTIVE 全部在前, CLEARED 沉底折叠 — §9.4/INV-ATTN 面）。 */
export interface BlockerSections {
  readonly active: readonly BlockerItem[]
  readonly cleared: readonly BlockerItem[]
}

export function splitBlockers(items: readonly BlockerItem[]): BlockerSections {
  const byTime = (a: BlockerItem, b: BlockerItem): number => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }
  const active = items.filter((i) => i.status === 'ACTIVE').sort(byTime)
  const cleared = items.filter((i) => i.status === 'CLEARED').sort(byTime)
  return { active, cleared }
}

/** 一个 Objective 进度行（目标 + 其组内待转正提案数）。 */
export interface ObjectiveProgressRow {
  readonly objective: ObjectiveDto
  readonly proposedCount: number
}

/** Objective 进度概览计数（「N 个目标：M 活跃 / K 已达成 / J 已放弃」）。 */
export interface ObjectiveCounts {
  readonly total: number
  readonly active: number
  readonly achieved: number
  readonly dropped: number
}

export function countObjectives(objectives: readonly ObjectiveDto[]): ObjectiveCounts {
  let active = 0
  let achieved = 0
  let dropped = 0
  for (const o of objectives) {
    if (o.status === 'ACTIVE') active += 1
    else if (o.status === 'ACHIEVED') achieved += 1
    else dropped += 1
  }
  return { total: objectives.length, active, achieved, dropped }
}

/**
 * Objective 进度行序（ACTIVE 在前 — 用户在推进的目标优先; 组内同
 * priority→id 序; proposedCount 来自分组投影, 无分组上下文时全 0）。
 */
export function objectiveProgressRows(
  objectives: readonly ObjectiveDto[],
  groups: readonly NextActionGroup[],
): ObjectiveProgressRow[] {
  const proposedByObjective = new Map<string, number>()
  for (const group of groups) {
    if (group.objective !== null) proposedByObjective.set(group.objective.id, group.proposedCount)
  }
  const statusRank: Record<ObjectiveDto['status'], number> = { ACTIVE: 0, ACHIEVED: 1, DROPPED: 2 }
  return [...objectives]
    .sort((a, b) => {
      const s = statusRank[a.status] - statusRank[b.status]
      if (s !== 0) return s
      const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      if (p !== 0) return p
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .map((objective) => ({
      objective,
      proposedCount: proposedByObjective.get(objective.id) ?? 0,
    }))
}
