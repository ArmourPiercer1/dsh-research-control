/**
 * WP-5.2 — 注意力三对象（NextAction / Blocker / Objective）客户端切片
 * （独立新文件 — 多 WP 并行纪律: 不改 `research-store.ts` / `model.ts` /
 * `registry.ts`, 容器 import 本文件自己的切片; 命名避开 WP-5.4 已占用的
 * `attention-slices.ts` — 报告「偏离与豁免」§1）。
 *
 * DSH_ADAPTER §6 合规（与 WP-4.1b 同款硬规则）:
 *  - **工厂非句柄**: `createActionsSlicesStore` 是导出工厂; 无模块级实例;
 *    宿主接线（后续集成）经 slot option `store` 传工厂结果, 宿主渲染机制
 *    绑定 `getSnapshot`/`subscribe` 面（结构上 `HostObservable<T>`）;
 *  - **组件不见 ctx**: 本文件零 DSH import（INV-PERM-5 — check-imports
 *    可证）; 与宿主只经结构端口说话（`ProjectTopicSource` /
 *    `ActionsDataProvider`）, 生产实现由接线面注入（mount.ts facade 结构
 *    满足 `ProjectTopicSource`; 测试注入 stub）。
 *
 * 数据面与接线状态（任务书「视图数据走 store 切片」+ 冻结 13 RPC 现实）:
 *  - `objectiveProgress` 切片 — **今天即可用**: 数据全部来自冻结 RPC
 *    `getProject`（objectives 投影）+ `getTopic`（objectiveRefs / workstream
 *    卡片 — 「NextAction 按 objective 分组」的分组上下文, 见
 *    views/actions/actions-model.ts 的分组规则）;
 *  - `nextActions` / `blockers` 切片 — **provider 缝**: 冻结 13 RPC
 *    （ARCHITECTURE §7.1）无 NextAction/Blocker 面（WP-4.6「13 列表保持
 *    冻结」）⇒ 数据经注入的 `ActionsDataProvider` 端口进入; 缺省 provider
 *    **fail-loud**（`NOT_WIRED` — 绝不伪造数据, 同 RR-015① 缝的纪律）;
 *    宿主侧真值来源 = 本 WP `ActionsService.listNextActions/listBlockers`
 *    （接线面: 待注意力 RPC 裁决或 slot data 通道 — 报告「实现要点」§3）。
 *
 * 切片状态机: 复用 WP-4.1b `SliceState`（idle/loading/ready/error +
 * stale-while-revalidate: refetch 失败保留最后好数据, 首载失败 data=null）。
 */

import type {
  GetTopicArgs,
  ObjectiveDto,
  ProjectSnapshot,
  TopicSnapshot,
} from '../../shared/rpc-contracts.js'
import { createStore } from './engine.js'
import { idleSlice, type RpcResult, type SliceState } from './model.js'

/* -------------------------------------------------------------------- *
 * 载荷类型（显示面 — 宿主 `NextActionRecord`/`BlockerRecord` 的 camelCase
 * 投影; 冻结 attention.schema.json $defs 的字段集合, 一一对应）
 * -------------------------------------------------------------------- */

/** One NextAction for the GUI list（§9.3; snake→camel 投影）。 */
export interface NextActionItem {
  readonly id: string
  readonly workstreamId: string | null
  readonly statement: string
  readonly rationale: string | null
  readonly status: 'PROPOSED' | 'PROMOTED' | 'DISMISSED'
  readonly promotedToTaskId: string | null
  readonly createdAt: number
}

/** One Blocker for the GUI 显著区（§9.4; snake→camel 投影）。 */
export interface BlockerItem {
  readonly id: string
  readonly statement: string
  readonly affects: readonly { readonly kind: 'WORKSTREAM' | 'TASK' | 'RUN'; readonly id: string }[]
  readonly status: 'ACTIVE' | 'CLEARED'
  readonly source: string
  readonly references: readonly string[] | null
  readonly createdAt: number
  readonly clearedAt: number | null
}

/** `nextActions` 切片载荷。 */
export interface NextActionsData {
  readonly items: readonly NextActionItem[]
}

/** `blockers` 切片载荷。 */
export interface BlockersData {
  readonly items: readonly BlockerItem[]
}

/**
 * 一个 topic 的分组上下文（`getTopic` 投影 — 「按 objective 分组」所需:
 * 该 topic 的 objectiveRefs + 该 topic 的 workstream id 集合）。
 */
export interface TopicObjectiveContext {
  readonly topicId: string
  readonly objectiveRefs: readonly string[]
  readonly workstreamIds: readonly string[]
}

/** `objectiveProgress` 切片载荷（全项目 objective 概览 + 分组上下文）。 */
export interface ObjectiveProgressData {
  readonly objectives: readonly ObjectiveDto[]
  readonly topics: readonly TopicObjectiveContext[]
}

/* -------------------------------------------------------------------- *
 * 注入端口（零 DSH import — 结构端口, 生产实现由接线面提供）
 * -------------------------------------------------------------------- */

/**
 * 冻结 RPC 的客观子面（mount.ts `researchRpc` 结构满足 — getProject/
 * getTopic 两方法; 结果形状 = model.ts 结构镜像 `RpcResult`）。
 */
export interface ProjectTopicSource {
  getProject(): Promise<RpcResult<ProjectSnapshot>>
  getTopic(args: GetTopicArgs): Promise<RpcResult<TopicSnapshot>>
}

/** NextAction/Blocker 数据缝（宿主 `ActionsService` 查询面的未来接线目标）。 */
export interface ActionsDataProvider {
  listNextActions(): Promise<readonly NextActionItem[]>
  listBlockers(): Promise<readonly BlockerItem[]>
}

/** 本模块错误载体（fail-loud 缝 — 消息点名接线缺口）。 */
export class ActionsSlicesError extends Error {
  readonly code: 'NOT_WIRED' | 'RPC_FAULT'

  constructor(code: 'NOT_WIRED' | 'RPC_FAULT', message: string) {
    super(message)
    this.name = 'ActionsSlicesError'
    this.code = code
  }
}

/** 缺省 provider（无接线时 — 每次调用大声失败, 绝不返回伪造数据）。 */
export const NOT_WIRED_PROVIDER: ActionsDataProvider = {
  async listNextActions(): Promise<never> {
    throw new ActionsSlicesError(
      'NOT_WIRED',
      'next action data face not wired in this build — the frozen 13-RPC list (ARCHITECTURE §7.1) carries no NextAction face; the host ActionsService.listNextActions is the future wiring target (WP-5.2 报告「实现要点」§3)',
    )
  },
  async listBlockers(): Promise<never> {
    throw new ActionsSlicesError(
      'NOT_WIRED',
      'blocker data face not wired in this build — the frozen 13-RPC list (ARCHITECTURE §7.1) carries no Blocker face; the host ActionsService.listBlockers is the future wiring target (WP-5.2 报告「实现要点」§3)',
    )
  },
}

/* -------------------------------------------------------------------- *
 * Store
 * -------------------------------------------------------------------- */

export interface ActionsSlicesState {
  readonly nextActions: SliceState<NextActionsData>
  readonly blockers: SliceState<BlockersData>
  readonly objectiveProgress: SliceState<ObjectiveProgressData>
}

export interface ActionsSlicesStoreOptions {
  /** 冻结 RPC 客观子面（objectiveProgress 切片; 缺省 = fail-loud NOT_WIRED）。 */
  readonly rpc?: ProjectTopicSource
  /** NextAction/Blocker 数据缝（缺省 = `NOT_WIRED_PROVIDER` — fail-loud）。 */
  readonly dataProvider?: ActionsDataProvider
  /** 时钟（updatedAt 标记; 测试可注入）。 */
  readonly now?: () => number
}

export interface ActionsSlicesStore {
  getSnapshot(): ActionsSlicesState
  getState(): ActionsSlicesState
  subscribe(listener: () => void): () => void
  /** 惰性加载 NextAction 列表（首请求才取 — ARCHITECTURE §8 懒加载）。 */
  loadNextActions(): Promise<void>
  /** 惰性加载 Blocker 显著区数据。 */
  loadBlockers(): Promise<void>
  /** 惰性加载 Objective 进度概览（getProject + per-topic getTopic）。 */
  loadObjectiveProgress(): Promise<void>
  /** 刷新全部非 idle 切片（页面级刷新环钩子 — 同 WP-4.1b `refresh`）。 */
  refresh(): Promise<void>
}

const initialActionsSlicesState = (): ActionsSlicesState => ({
  nextActions: idleSlice<NextActionsData>(),
  blockers: idleSlice<BlockersData>(),
  objectiveProgress: idleSlice<ObjectiveProgressData>(),
})

/**
 * Create the attention-actions slices store（factory — never module-cached）。
 *
 * 并发纪律（同 WP-4.1b）: 每个切片一个在飞 fetch; 同切片并发 load 共享
 * 该 fetch（后到者等待先到者 — 乱序 settle 不可能覆盖新值）。
 */
export function createActionsSlicesStore(options: ActionsSlicesStoreOptions = {}): ActionsSlicesStore {
  const now = options.now ?? Date.now
  const rpc = options.rpc
  const dataProvider = options.dataProvider ?? NOT_WIRED_PROVIDER

  const store = createStore<ActionsSlicesState>(initialActionsSlicesState())
  const inFlight: { [K in 'nextActions' | 'blockers' | 'objectiveProgress']: Promise<void> | null } = {
    nextActions: null,
    blockers: null,
    objectiveProgress: null,
  }

  type SliceKey = 'nextActions' | 'blockers' | 'objectiveProgress'

  /** Per-slice ready commit（引擎不可变纪律: 恰换变化节点 — WP-4.1b）。 */
  const commitNextActions = (payload: NextActionsData): void => {
    store.setState((s) => ({
      ...s,
      nextActions: { status: 'ready', data: payload, error: null, updatedAt: now() },
    }))
  }

  const commitBlockers = (payload: BlockersData): void => {
    store.setState((s) => ({
      ...s,
      blockers: { status: 'ready', data: payload, error: null, updatedAt: now() },
    }))
  }

  const commitProgress = (payload: ObjectiveProgressData): void => {
    store.setState((s) => ({
      ...s,
      objectiveProgress: { status: 'ready', data: payload, error: null, updatedAt: now() },
    }))
  }

  /** Per-slice 失败（stale-while-revalidate: 保留最后好数据 — WP-4.1b）。 */
  const failSlice = (sliceKey: SliceKey, message: string): void => {
    store.setState((s) => {
      if (sliceKey === 'nextActions') {
        const prev = s.nextActions
        return { ...s, nextActions: { status: 'error', data: prev.data, error: message, updatedAt: prev.updatedAt } }
      }
      if (sliceKey === 'blockers') {
        const prev = s.blockers
        return { ...s, blockers: { status: 'error', data: prev.data, error: message, updatedAt: prev.updatedAt } }
      }
      const prev = s.objectiveProgress
      return { ...s, objectiveProgress: { status: 'error', data: prev.data, error: message, updatedAt: prev.updatedAt } }
    })
  }

  const markLoading = (sliceKey: SliceKey): void => {
    store.setState((s) => {
      if (sliceKey === 'nextActions') {
        const prev = s.nextActions
        if (prev.status === 'loading') return s
        return { ...s, nextActions: { status: 'loading', data: prev.data, error: prev.error, updatedAt: prev.updatedAt } }
      }
      if (sliceKey === 'blockers') {
        const prev = s.blockers
        if (prev.status === 'loading') return s
        return { ...s, blockers: { status: 'loading', data: prev.data, error: prev.error, updatedAt: prev.updatedAt } }
      }
      const prev = s.objectiveProgress
      if (prev.status === 'loading') return s
      return { ...s, objectiveProgress: { status: 'loading', data: prev.data, error: prev.error, updatedAt: prev.updatedAt } }
    })
  }

  const loadNextActions = async (): Promise<void> => {
    if (inFlight.nextActions !== null) return inFlight.nextActions
    const p = (async () => {
      markLoading('nextActions')
      try {
        const items = await dataProvider.listNextActions()
        commitNextActions({ items })
      } catch (cause) {
        failSlice('nextActions', cause instanceof Error ? cause.message : String(cause))
      } finally {
        inFlight.nextActions = null
      }
    })()
    inFlight.nextActions = p
    return p
  }

  const loadBlockers = async (): Promise<void> => {
    if (inFlight.blockers !== null) return inFlight.blockers
    const p = (async () => {
      markLoading('blockers')
      try {
        const items = await dataProvider.listBlockers()
        commitBlockers({ items })
      } catch (cause) {
        failSlice('blockers', cause instanceof Error ? cause.message : String(cause))
      } finally {
        inFlight.blockers = null
      }
    })()
    inFlight.blockers = p
    return p
  }

  const loadObjectiveProgress = async (): Promise<void> => {
    if (inFlight.objectiveProgress !== null) return inFlight.objectiveProgress
    if (rpc === undefined) {
      markLoading('objectiveProgress')
      failSlice('objectiveProgress', 'objective progress face not wired — the store was created without a ProjectTopicSource (rpc option); the host wiring passes the frozen-RPC facade (WP-5.2 报告「实现要点」§3)')
      return
    }
    const p = (async () => {
      markLoading('objectiveProgress')
      try {
        const projectResult = await rpc.getProject()
        if (projectResult.ok === false) {
          throw new ActionsSlicesError('RPC_FAULT', `getProject failed: ${projectResult.error.code}: ${projectResult.error.message}`)
        }
        const project = projectResult.value
        const topics: TopicObjectiveContext[] = []
        for (const card of project.topics) {
          const topicResult = await rpc.getTopic({ topicId: card.id })
          if (topicResult.ok === false) {
            // fail-loud: 一个 topic 读不出 ⇒ 分组上下文不完整, 整切片失败
            // （V1 单项目 GUI — 静默降级会给出错误的分组投影）。
            throw new ActionsSlicesError('RPC_FAULT', `getTopic(${card.id}) failed: ${topicResult.error.code}: ${topicResult.error.message}`)
          }
          const snap: TopicSnapshot = topicResult.value
          topics.push({
            topicId: card.id,
            objectiveRefs: [...snap.topic.objectiveRefs],
            workstreamIds: snap.workstreams.map((w) => w.id),
          })
        }
        commitProgress({
          objectives: project.objectives,
          topics,
        })
      } catch (cause) {
        failSlice('objectiveProgress', cause instanceof Error ? cause.message : String(cause))
      } finally {
        inFlight.objectiveProgress = null
      }
    })()
    inFlight.objectiveProgress = p
    return p
  }

  return {
    getSnapshot: store.getSnapshot,
    getState: store.getState,
    subscribe: store.subscribe,
    loadNextActions,
    loadBlockers,
    loadObjectiveProgress,
    async refresh(): Promise<void> {
      const active: ('nextActions' | 'blockers' | 'objectiveProgress')[] = []
      const s = store.getState()
      if (s.nextActions.status !== 'idle') active.push('nextActions')
      if (s.blockers.status !== 'idle') active.push('blockers')
      if (s.objectiveProgress.status !== 'idle') active.push('objectiveProgress')
      await Promise.all([
        ...active.includes('nextActions') ? [loadNextActions()] : [],
        ...active.includes('blockers') ? [loadBlockers()] : [],
        ...active.includes('objectiveProgress') ? [loadObjectiveProgress()] : [],
      ])
    },
  }
}
