/**
 * WP-7.2 — reader 1/5: plugin 状态快照（计划书 §26.1 可读清单第一项）。
 *
 * 读什么（只读 — 类型面）:
 *  - 声明式真源（`.research/` 树 — 调用方注入 `readTree` fresh 加载,
 *    文件即真值, 同 rpc 查询面口径）: project / topics / workstreams
 *    (lifecycle + 声明式任务定义);
 *  - ResearchHistory 折叠投影（Current 区 — `taskStates` face: 事件史
 *    的 execution/validation 折叠, 与 rpc `getWorkstream` 同一投影口径;
 *    §27.4 三区投影的「Current Execution」半边）;
 *  - run 表（`runs` face — §6.1 记录面, INV-DB-2 无 session 内容）;
 *  - Intervention（`interventions` face — OPEN/PENDING 分组, INV-ATTN-1
 *    完整展示口径的查询半边）;
 *  - 语义注册表计数（`semanticCounts` face — derived 态计数, 行内容归
 *    artifact-refs reader）。
 *
 * 只读边界: 本类只有 `read(scope)`; 输入 face 全部是读操作（树加载 /
 * 表查询 / derived 态读取）; 无任何写方法、无任何 DSH import。
 *
 * 范围语义: workstream scope = 该 WS 及其所属 topic（topic 行的
 * workstreamIds 收窄到该 WS）; topic scope = 该 topic 全部 WS; 双缺 =
 * project-wide 全集。未知 id = RD_INPUT（大声, 不猜 — 同 getTopic 口径）。
 */

import type { ResearchTree } from '../../../domain/loader/index.js'
import {
  assertInvestigationScope,
  ReaderError,
  type InvestigationScope,
  type PluginStateIntervention,
  type PluginStateRun,
  type PluginStateSemanticCounts,
  type PluginStateSnapshot,
  type PluginStateTask,
  type PluginStateWorkstream,
} from './types.js'

/** run 表 face 的行形状（调用方从 run 行投影; 只读透出）。 */
export type PluginStateRunRow = PluginStateRun

/** Intervention face 的行形状（调用方从 lifecycle 行投影; 只读透出）。 */
export type PluginStateInterventionRow = PluginStateIntervention

/** 一个 workstream 的折叠任务状态（taskId → execution/validation）。 */
export interface FoldedTaskStates {
  readonly get: (taskId: string) => { readonly execution: PluginStateTask['execution']; readonly validation: PluginStateTask['validation'] } | undefined
}

/**
 * reader 1 输入面（窄 face — 生产组装见 `from-wiring.ts`; 测试注入 stub）。
 * 全部成员都是只读操作。
 */
export interface PluginStateReaderInput {
  /** fresh 声明式树加载（文件即真值; 失败由调用方语义 — 本 reader 包 RD_STATE）。 */
  readonly readTree: () => ResearchTree
  /**
   * Current 区折叠: taskId → execution/validation（声明式定义 ⊕ WS 事件
   * 史; 与 rpc `getWorkstream` 同一投影口径 — 未折叠任务缺省
   * PLANNED / NOT_REQUIRED 由本 reader 补齐）。
   */
  readonly taskStates: (workstreamId: string) => FoldedTaskStates
  /** run 表查询面（缺省 = 全量; `workstreamId` 过滤）。 */
  readonly runs: (filter?: { readonly workstreamId?: string }) => readonly PluginStateRunRow[]
  /** Intervention 全量查询面（OPEN/PENDING 分组在本 reader; 无隐藏过滤器）。 */
  readonly interventions: () => readonly PluginStateInterventionRow[]
  /** 一个 WS 的 OPEN PlanFork 计数（WP-3.4 查询面）。 */
  readonly openPlanForkCount: (workstreamId: string) => number
  /** 语义注册表计数面（derived 态 — 计数, 非行）。 */
  readonly semanticCounts: () => PluginStateSemanticCounts
}

export class PluginStateReader {
  constructor(readonly input: PluginStateReaderInput) {
    if (input === null || typeof input !== 'object' || typeof input.readTree !== 'function') {
      throw new ReaderError('RD_INPUT', 'PluginStateReader: input.readTree (a fresh tree load face) is required')
    }
  }

  /** 读取 plugin 状态快照（范围见模块头）。失败 = `ReaderError`（RD_STATE/RD_INPUT）。 */
  read(scope: InvestigationScope): PluginStateSnapshot {
    assertInvestigationScope(scope)
    let tree: ResearchTree
    try {
      tree = this.input.readTree()
    } catch (cause) {
      throw new ReaderError('RD_STATE', `pluginState: declarative tree load failed: ${causeMessage(cause)}`, { cause })
    }

    // 范围解析（未知 id 大声, 不猜）。
    const wsIds = new Set<string>()
    let scopeTopicId: string | null = null
    if (scope.workstreamId !== undefined) {
      const topic = tree.topics.find((t) => t.workstreams.some((w) => w.id === scope.workstreamId))
      if (topic === undefined) {
        throw new ReaderError('RD_INPUT', `pluginState: workstream ${scope.workstreamId} does not exist in the declarative tree`)
      }
      scopeTopicId = topic.id
      wsIds.add(scope.workstreamId)
    } else if (scope.topicId !== undefined) {
      const topic = tree.topics.find((t) => t.id === scope.topicId)
      if (topic === undefined) {
        throw new ReaderError('RD_INPUT', `pluginState: topic ${scope.topicId} does not exist in the declarative tree`)
      }
      scopeTopicId = topic.id
      for (const w of topic.workstreams) wsIds.add(w.id)
    }
    const inScope = (id: string): boolean => (scopeTopicId === null ? true : wsIds.has(id))

    const allRuns = safeFace('runs', this.input.runs)
    const runs = allRuns.filter((r) => inScope(r.workstreamId))
    const runningByWs = new Map<string, number>()
    for (const r of runs) {
      if (r.status !== 'RUNNING') continue
      runningByWs.set(r.workstreamId, (runningByWs.get(r.workstreamId) ?? 0) + 1)
    }

    const allInterventions = safeFace('interventions', this.input.interventions)
    const ivInScope = (iv: PluginStateInterventionRow): boolean => {
      if (scopeTopicId === null) return true
      return iv.workstreamIds.some((id) => wsIds.has(id))
    }

    const topics = tree.topics
      .filter((t) => scopeTopicId === null || t.id === scopeTopicId)
      .map((t) => ({
        id: t.id,
        title: t.doc?.title ?? t.id,
        workstreamIds: (scopeTopicId === null ? t.workstreams : t.workstreams.filter((w) => wsIds.has(w.id))).map((w) => w.id),
      }))

    const workstreams: PluginStateWorkstream[] = []
    for (const t of tree.topics) {
      for (const wsNode of t.workstreams) {
        if (!inScope(wsNode.id)) continue
        const folded = safeFace('taskStates', this.input.taskStates, wsNode.id)
        const tasks: PluginStateTask[] = wsNode.tasks.map((tn) => {
          const current = folded.get(tn.id)
          return {
            id: tn.id,
            title: tn.doc?.title ?? tn.id,
            execution: current?.execution ?? 'PLANNED',
            validation: current?.validation ?? 'NOT_REQUIRED',
          }
        })
        workstreams.push({
          id: wsNode.id,
          topicId: wsNode.topicId,
          title: wsNode.doc?.title ?? wsNode.id,
          lifecycle: wsNode.doc?.lifecycle ?? 'PLANNED',
          tasks,
          openPlanForks: safeFace('openPlanForkCount', this.input.openPlanForkCount, wsNode.id),
          runningRuns: runningByWs.get(wsNode.id) ?? 0,
        })
      }
    }

    const project = tree.project
    return {
      project:
        project === null
          ? null
          : {
              id: project.id,
              title: project.title,
              description: project.description ?? null,
              importance: project.importance,
              attentionMode: project.attention_mode,
              targetDate: project.target_date ?? null,
            },
      topics,
      workstreams,
      runs,
      interventions: {
        open: allInterventions.filter((iv) => iv.status === 'OPEN' && ivInScope(iv)),
        pending: allInterventions.filter((iv) => iv.status === 'PENDING' && ivInScope(iv)),
      },
      semantic: safeFace('semanticCounts', this.input.semanticCounts),
    }
  }
}

/** Face 调用护栏（face 抛错 ⇒ RD_STATE 结构化, cause 保留）。 */
function safeFace<TArgs extends unknown[], TResult>(
  name: string,
  face: (...args: TArgs) => TResult,
  ...args: TArgs
): TResult {
  try {
    return (face as (...a: unknown[]) => TResult)(...args)
  } catch (cause) {
    throw new ReaderError('RD_STATE', `pluginState: the ${name} face failed: ${causeMessage(cause)}`, { cause })
  }
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
