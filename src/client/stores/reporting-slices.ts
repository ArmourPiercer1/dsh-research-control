/**
 * WP-5.3 — reporting store 切片（**独立新文件** — 多 WP 并行的 store 目录
 * 冲突纪律: 本切片不修改 `model.ts` / `research-store.ts` / `registry.ts`
 * / `index.ts` 任何既有文件, 容器只 import 本文件 — 同 WP-5.4
 * `attention-slices.ts` 先例）。
 *
 * 数据路径（为什么是「客户端工作区」而不是新 RPC）:
 *  冻结 13-RPC 面（ARCHITECTURE §7.1）中 reporting 唯一写入面 =
 *  `registerInteraction`（WP-4.1a 冻结契约, 本 WP 落地生产实现）; 无
 *  Interaction/ReportingItem/ScheduledEvent 查询 RPC, 且
 *  `DashboardSnapshot.scheduledEvents/reportingItems` 与
 *  `ProjectSnapshot.upcomingInteractions/upcomingReporting` 是冻结
 *  `null` 占位（共享契约不在本 WP 授权改动面 — 填实归后续契约解冻
 *  裁决, 本 WP 不造第 14/15 个 RPC, WP-4.1b RR-015① 同口径）。⇒
 *  本切片 = 客户端会话工作区:
 *   - `interactions` — 经**生产** `registerInteraction` RPC 成功登记
 *     的记录流（host 已落库 research.sqlite; 完整历史查询面不在冻结
 *     13-RPC 内 — 视图如实标注, 不伪造历史数据）;
 *   - `reportingItems` / `scheduledEvents` — 本地草稿工作区（V1: 冻结
 *     面无可写 RPC; host 侧 DDL + service 持久化面本 WP 已交付, 供
 *     host 流/未来 RPC 消费 — 报告注明 V1 语义）。草稿 id 用
 *     `loc-<n>` 本地命名空间（**非** §1.1 注册前缀 — 绝不与 host 分配
 *     的 RPT/SEV id 混淆, parseId 不可解析即证明）。
 *
 * 规则单一真源: §13 RPT 状态机与 V1 时间窗语义直接 import host 纯模块
 * （`state-machine.js` / `schedule.js` — 零 I/O 零 import, 与 WP-5.4
 *  client→host 纯函数 import 先例同形）— client 迁移 guard 与 host
 *  service 必然同表。
 *
 * 引擎纪律（WP-4.1b）: 复用 `./engine.js` 的 `createStore`（只读 import）;
 * 工厂导出、零模块级句柄（DSH_ADAPTER §6）; 无 DSH import（INV-PERM-5）。
 */

import {
  type RegisterInteractionResult,
} from '../../shared/rpc-contracts.js'
import {
  RPT_LEGAL_TRANSITIONS,
  checkRptTransition,
} from '../../host/service/reporting/state-machine.js'
import {
  eventActiveInWindow,
  scheduleSortKey,
  type ScheduleWindow,
} from '../../host/service/reporting/schedule.js'
import type {
  RptStatus,
  SevFreq,
  SevRelatedRefKind,
} from '../../host/service/reporting/types.js'
import { createStore } from './engine.js'

/* -------------------------------------------------------------------- *
 * 条目形状
 * -------------------------------------------------------------------- */

/** 一条经生产 RPC 成功登记的 Interaction（= 冻结 wire 结果, 逐字）。 */
export type RegisteredInteractionEntry = RegisterInteractionResult

/** 本地 RPT 草稿（V1 客户端工作区 — 未落库; id 为本地命名空间）。 */
export interface LocalReportingItem {
  /** `loc-<n>` — 本地草稿 id（非 §1.1 前缀, 绝不与 host RPT id 混淆）。 */
  readonly localId: string
  readonly audience: string
  readonly statement: string
  readonly status: RptStatus
  /** host SEV id（用户手填; 草稿不校验存在性 — host service 才校验）。 */
  readonly occasionRef: string | null
  /** epoch ms. */
  readonly createdAt: number
  readonly reportedAt: number | null
}

/** 冻结 schedule 形状（ONCE / RECURRING — 与 host 类型同构）。 */
export type LocalSevSchedule =
  | { readonly kind: 'ONCE'; readonly at: number }
  | { readonly kind: 'RECURRING'; readonly freq: SevFreq; readonly interval?: number; readonly until?: number }

/** 本地 SEV 草稿（V1 客户端工作区 — 未落库; 不接外部 Calendar）。 */
export interface LocalScheduledEvent {
  /** `loc-<n>` — 本地草稿 id。 */
  readonly localId: string
  readonly title: string
  readonly schedule: LocalSevSchedule
  readonly relatedRefs: readonly { readonly kind: SevRelatedRefKind; readonly id: string }[]
  readonly reminderLeadMs: number | null
  /** epoch ms. */
  readonly createdAt: number
}

/** 工作区快照（uSES 引用稳定 — 引擎保证）。 */
export interface ReportingWorkspaceState {
  readonly interactions: readonly RegisteredInteractionEntry[]
  readonly reportingItems: readonly LocalReportingItem[]
  readonly scheduledEvents: readonly LocalScheduledEvent[]
}

/* -------------------------------------------------------------------- *
 * 输入面（容器表单 → 工作区）
 * -------------------------------------------------------------------- */

/** `addReportingItem` 输入（V1: 本地草稿, 形状校验最小集）。 */
export interface AddReportingItemInput {
  readonly audience: string
  readonly statement: string
  readonly occasionRef?: string
}

/** `addScheduledEvent` 输入（V1: 本地草稿, 形状校验最小集）。 */
export interface AddScheduledEventInput {
  readonly title: string
  readonly schedule: LocalSevSchedule
  readonly relatedRefs?: readonly { readonly kind: SevRelatedRefKind; readonly id: string }[]
  readonly reminderLeadMs?: number
}

/* -------------------------------------------------------------------- *
 * 工作区工厂
 * -------------------------------------------------------------------- */

export interface ReportingWorkspace {
  /** 当前快照（引用稳定直到 commit — 引擎语义）。 */
  getSnapshot(): ReportingWorkspaceState
  getState(): ReportingWorkspaceState
  subscribe(listener: () => void): () => void

  /**
   * 追加一条经生产 `registerInteraction` RPC 成功登记的记录
   * （容器在 mutation resolve 后调用; 按 id 幂等去重 — 重试不重复）。
   */
  recordInteraction(result: RegisterInteractionResult): void
  /** 新增本地 RPT 草稿（初始 OPEN）— 返回本地 id。 */
  addReportingItem(input: AddReportingItemInput): string
  /**
   * 本地 RPT 草稿 §13 状态迁移（guard = host 纯模块单一真源; 非法迁移
   * 抛 `ReportingError`（RPT_WRONG_STATE）— 视图层按钮只渲染合法迁移,
   * guard 为纵深防御）。
   */
  transitionReportingItem(localId: string, to: RptStatus): void
  /** 新增本地 SEV 草稿 — 返回本地 id。 */
  addScheduledEvent(input: AddScheduledEventInput): string
}

export interface ReportingWorkspaceOptions {
  /** Injectable clock（默认 `Date.now` — 测试注入确定性时钟）。 */
  readonly now?: () => number
}

/** 初始（空）工作区快照。 */
export function initialReportingWorkspaceState(): ReportingWorkspaceState {
  return { interactions: [], reportingItems: [], scheduledEvents: [] }
}

/**
 * 创建 reporting 工作区 store（工厂 — 零模块级句柄; DSH_ADAPTER §6:
 * 容器经 props 传递, 组件不见 DSH ctx）。
 * @param options - clock 注入。
 * @returns 工作区 store 面。
 */
export function createReportingWorkspace(options?: ReportingWorkspaceOptions): ReportingWorkspace {
  const now = options?.now ?? Date.now
  const store = createStore<ReportingWorkspaceState>(initialReportingWorkspaceState())
  /** 本地 id 序列（会话内单调; 不落库、不进 host 计数器）。 */
  let localSeq = 0

  return {
    getSnapshot: () => store.getSnapshot(),
    getState: () => store.getState(),
    subscribe: (listener) => store.subscribe(listener),

    recordInteraction(result) {
      store.setState((prev) => {
        if (prev.interactions.some((entry) => entry.id === result.id)) return prev
        return { ...prev, interactions: [...prev.interactions, { ...result }] }
      })
    },

    addReportingItem(input) {
      if (typeof input.audience !== 'string' || input.audience.length === 0) {
        throw new Error('addReportingItem: audience must be a non-empty string')
      }
      if (typeof input.statement !== 'string' || input.statement.length === 0) {
        throw new Error('addReportingItem: statement must be a non-empty string')
      }
      const localId = `loc-${++localSeq}`
      const item: LocalReportingItem = {
        localId,
        audience: input.audience,
        statement: input.statement,
        status: 'OPEN',
        occasionRef: input.occasionRef === undefined || input.occasionRef.trim().length === 0 ? null : input.occasionRef.trim(),
        createdAt: now(),
        reportedAt: null,
      }
      store.setState((prev) => ({ ...prev, reportingItems: [...prev.reportingItems, item] }))
      return localId
    },

    transitionReportingItem(localId, to) {
      const current = store.getState().reportingItems.find((item) => item.localId === localId)
      if (current === undefined) {
        throw new Error(`transitionReportingItem: local draft ${localId} does not exist`)
      }
      // 单一真源: host 纯 §13 guard（非法 ⇒ ReportingError RPT_WRONG_STATE）。
      checkRptTransition(localId, current.status, to)
      const reportedAt = to === 'REPORTED' && current.reportedAt === null ? now() : current.reportedAt
      store.setState((prev) => ({
        ...prev,
        reportingItems: prev.reportingItems.map((item) =>
          item.localId === localId ? { ...item, status: to, reportedAt: reportedAt ?? null } : item,
        ),
      }))
    },

    addScheduledEvent(input) {
      if (typeof input.title !== 'string' || input.title.length === 0) {
        throw new Error('addScheduledEvent: title must be a non-empty string')
      }
      const localId = `loc-${++localSeq}`
      const event: LocalScheduledEvent = {
        localId,
        title: input.title,
        schedule: input.schedule,
        relatedRefs: [...(input.relatedRefs ?? [])],
        reminderLeadMs: input.reminderLeadMs ?? null,
        createdAt: now(),
      }
      store.setState((prev) => ({ ...prev, scheduledEvents: [...prev.scheduledEvents, event] }))
      return localId
    },
  }
}

/* -------------------------------------------------------------------- *
 * 展示投影（纯函数 — 与 host service 查询面同语义, 单一真源）
 * -------------------------------------------------------------------- */

/**
 * V1 时间窗过滤 + 时间轴排序（host `schedule.ts` 纯函数 — ONCE → `at`
 * ∈ 窗口; RECURRING → 活跃跨度与窗口相交; 排序 = scheduleSortKey, id 破平）。
 */
export function upcomingEvents(
  events: readonly LocalScheduledEvent[],
  window: ScheduleWindow | null,
): readonly LocalScheduledEvent[] {
  const filtered = window === null ? events : events.filter((event) => eventActiveInWindow(event.schedule, window))
  return [...filtered].sort((a, b) => {
    const ka = scheduleSortKey(a.schedule)
    const kb = scheduleSortKey(b.schedule)
    if (ka !== kb) return ka - kb
    return a.localId < b.localId ? -1 : a.localId > b.localId ? 1 : 0
  })
}

/** 本地 RPT 草稿的合法下一状态（= host §13 表 — 按钮面单一真源）。 */
export function legalRptTransitions(status: RptStatus): readonly RptStatus[] {
  return RPT_LEGAL_TRANSITIONS[status]
}

/** 记录流排序（occurredAt 降序 — 最新在前; id 升序破平）。 */
export function orderedInteractionStream(
  entries: readonly RegisteredInteractionEntry[],
): readonly RegisteredInteractionEntry[] {
  return [...entries].sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) return b.occurredAt - a.occurredAt
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}
