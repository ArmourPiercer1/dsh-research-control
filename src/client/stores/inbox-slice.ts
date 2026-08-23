/**
 * WP-6.4 — Research Inbox 客户端切片（独立新文件 — 多 WP 并行纪律:
 * 不改 `research-store.ts` / `model.ts` / `registry.ts`）。
 *
 * DSH_ADAPTER §6 合规（与 WP-5.2 actions-slices 同款硬规则）:
 *  - **工厂非句柄**: `createInboxSliceStore` 是导出工厂; 无模块级实例;
 *    宿主接线（后续集成）经 slot option `store` 传工厂结果;
 *  - **组件不见 ctx**: 本文件零 DSH import（INV-PERM-5 — check-imports
 *    可证）; 与宿主只经结构端口说话（`InboxDataProvider`）, 生产实现
 *    由接线面注入（测试注入 stub）。
 *
 * 数据面与接线状态（冻结 13 RPC 现实 — ARCHITECTURE §7.1 无 Inbox 面,
 * dashboard snapshot 的 `inboxCount` 冻结 `z.null()` — 「数据面裁决」
 * 未决, 同 WP-5.2 `nextActions`/`blockers` 缝的纪律）:
 *  - `items` 切片 — **provider 缝**: 经注入的 `InboxDataProvider` 端口
 *    进入; 缺省 provider **fail-loud**（`NOT_WIRED` — 绝不伪造数据,
 *    同 RR-015① / WP-5.2 缝的纪律）;
 *  - 宿主侧真值来源 = 本 WP `InboxService`（capture/dismiss/convert/
 *    escalate 查询面 — 报告「实现要点」§3）。
 *
 * 操作面（转换/忽略/快捷捕获 — 全部仅用户, §6 矩阵 + §28「显式确认」）:
 * store 方法直接透传 provider（失败原样上抛 — 容器持 transient UI 反馈）;
 * 成功后自动刷新 `items` 切片（宿主是数据真值, 本地不镜像变更）。
 *
 * 切片状态机: 复用 WP-4.1b `SliceState`（idle/loading/ready/error +
 * stale-while-revalidate: refetch 失败保留最后好数据, 首载失败 data=null）。
 */

import { createStore } from './engine.js'
import { idleSlice, type SliceState } from './model.js'

/* -------------------------------------------------------------------- *
 * 载荷类型（显示面 — 宿主 `InboxItemRecord` 的 camelCase 投影;
 * 冻结 inbox.schema.json $defs/InboxItem 字段集合, 一一对应）
 * -------------------------------------------------------------------- */

/** 一个 context_ref / converted_to 元素（冻结 `typedRef` 投影）。 */
export interface InboxTypedRef {
  readonly kind: string
  readonly id: string
}

/** One InboxItem for the GUI（§11; snake→camel 投影）。 */
export interface InboxItemDto {
  readonly id: string
  readonly source: string
  /** 文本/摘要（§11 `payload` — 捕获时刻的用户/机械文本）。 */
  readonly payload: string
  /** 原始数据（§11 `raw: any` — 机器形态; 升级条目标记 `escalation`
   *  键由宿主 `InboxService.escalateMechanical` 写入 — 展示层读它）。 */
  readonly raw: Record<string, unknown> | null
  readonly contextRefs: readonly InboxTypedRef[]
  readonly state: 'CAPTURED' | 'CONVERTED' | 'DISMISSED'
  readonly convertedTo: InboxTypedRef | null
  readonly createdAt: number
}

/** `items` 切片载荷。 */
export interface InboxListData {
  readonly items: readonly InboxItemDto[]
}

/** 转换目标 kind（计划书 §28 转换动作集 — 7 值封闭）。 */
export type InboxConversionKind =
  | 'TASK'
  | 'NEXT_ACTION'
  | 'INTERVENTION'
  | 'CLAIM'
  | 'FACT'
  | 'REPORTING_ITEM'
  | 'INTERACTION'

/** 转换请求（宿主 `InboxService.convert` 参数面 — 显式确认载荷）。 */
export interface InboxConvertArgs {
  readonly inboxItemId: string
  readonly targetKind: InboxConversionKind
  /** 目标 kind 的配对字段（§28 动作集; 形状由展示层字段模型收集,
   *  宿主侧按 kind 分派到目标 service — 本层不校验字段内容, 宿主做）。 */
  readonly fields: Record<string, unknown>
}

/* -------------------------------------------------------------------- *
 * 注入端口（零 DSH import — 结构端口, 生产实现由接线面提供）
 * -------------------------------------------------------------------- */

/**
 * Inbox 数据缝（宿主 `InboxService` 查询 + 操作面的未来接线目标 —
 * 冻结 13 RPC 无 Inbox 面, 数据面裁决后接 slot data 通道 / 宿主直连）。
 */
export interface InboxDataProvider {
  listInboxItems(): Promise<readonly InboxItemDto[]>
  convertInboxItem(args: InboxConvertArgs): Promise<void>
  dismissInboxItem(inboxItemId: string): Promise<void>
  /** 用户快捷捕获（§11 HUMAN_QUICK_CAPTURE — 仅用户面）。 */
  quickCapture(payload: string, contextRefs?: readonly InboxTypedRef[]): Promise<void>
}

/** 本模块错误载体（fail-loud 缝 — 消息点名接线缺口）。 */
export class InboxSliceError extends Error {
  readonly code: 'NOT_WIRED'

  constructor(code: 'NOT_WIRED', message: string) {
    super(message)
    this.name = 'InboxSliceError'
    this.code = code
  }
}

/** 缺省 provider（无接线时 — 每次调用大声失败, 绝不返回伪造数据）。 */
export const NOT_WIRED_PROVIDER: InboxDataProvider = {
  async listInboxItems(): Promise<never> {
    throw new InboxSliceError(
      'NOT_WIRED',
      'inbox data face not wired in this build — the frozen 13-RPC list (ARCHITECTURE §7.1) carries no Inbox face (dashboard inboxCount is frozen z.null()); the host InboxService query face is the future wiring target (WP-6.4 报告「实现要点」§3)',
    )
  },
  async convertInboxItem(_args: InboxConvertArgs): Promise<never> {
    throw new InboxSliceError(
      'NOT_WIRED',
      'inbox convert operation not wired in this build — the frozen 13-RPC list carries no Inbox face; the host InboxService.convert (explicit user confirmation, plan §28) is the future wiring target',
    )
  },
  async dismissInboxItem(_inboxItemId: string): Promise<never> {
    throw new InboxSliceError(
      'NOT_WIRED',
      'inbox dismiss operation not wired in this build — the frozen 13-RPC list carries no Inbox face; the host InboxService.dismiss is the future wiring target',
    )
  },
  async quickCapture(_payload: string, _contextRefs?: readonly InboxTypedRef[]): Promise<never> {
    throw new InboxSliceError(
      'NOT_WIRED',
      'inbox quick-capture not wired in this build — the frozen 13-RPC list carries no Inbox face; the host InboxService.captureHuman is the future wiring target',
    )
  },
}

/* -------------------------------------------------------------------- *
 * Store
 * -------------------------------------------------------------------- */

export interface InboxSliceState {
  readonly items: SliceState<InboxListData>
}

export interface InboxSliceStoreOptions {
  /** Inbox 数据缝（缺省 = `NOT_WIRED_PROVIDER` — fail-loud）。 */
  readonly dataProvider?: InboxDataProvider
  /** 时钟（updatedAt 标记; 测试可注入）。 */
  readonly now?: () => number
}

export interface InboxSliceStore {
  getSnapshot(): InboxSliceState
  getState(): InboxSliceState
  subscribe(listener: () => void): () => void
  /** 惰性加载 Inbox 列表（首请求才取 — ARCHITECTURE §8 懒加载）。 */
  loadInboxItems(): Promise<void>
  /** 转换（显式确认 — 成功后自动刷新列表）。 */
  convertInboxItem(args: InboxConvertArgs): Promise<void>
  /** 忽略（§13 CAPTURED → DISMISSED — 成功后自动刷新列表）。 */
  dismissInboxItem(inboxItemId: string): Promise<void>
  /** 快捷捕获（成功后自动刷新列表）。 */
  quickCapture(payload: string, contextRefs?: readonly InboxTypedRef[]): Promise<void>
}

const initialInboxSliceState = (): InboxSliceState => ({
  items: idleSlice<InboxListData>(),
})

/**
 * Create the inbox slice store（factory — never module-cached）。
 *
 * 并发纪律（同 WP-4.1b/WP-5.2）: 单切片一个在飞 fetch; 同切片并发 load
 * 共享该 fetch（后到者等待先到者 — 乱序 settle 不可能覆盖新值）。
 * 操作（convert/dismiss/quickCapture）= provider 调用 + 成功刷新 —
 * 操作本身不标记 loading（transient UI 反馈归容器, 同 WP-5.2 操作面口径）。
 */
export function createInboxSliceStore(options: InboxSliceStoreOptions = {}): InboxSliceStore {
  const now = options.now ?? Date.now
  const dataProvider = options.dataProvider ?? NOT_WIRED_PROVIDER

  const store = createStore<InboxSliceState>(initialInboxSliceState())
  let inFlight: Promise<void> | null = null

  const commitItems = (payload: InboxListData): void => {
    store.setState((s) => ({
      ...s,
      items: { status: 'ready', data: payload, error: null, updatedAt: now() },
    }))
  }

  const failItems = (message: string): void => {
    store.setState((s) => {
      const prev = s.items
      return { ...s, items: { status: 'error', data: prev.data, error: message, updatedAt: prev.updatedAt } }
    })
  }

  const markLoading = (): void => {
    store.setState((s) => {
      const prev = s.items
      if (prev.status === 'loading') return s
      return { ...s, items: { status: 'loading', data: prev.data, error: prev.error, updatedAt: prev.updatedAt } }
    })
  }

  const loadInboxItems = async (): Promise<void> => {
    if (inFlight !== null) return inFlight
    const p = (async () => {
      markLoading()
      try {
        const items = await dataProvider.listInboxItems()
        commitItems({ items })
      } catch (cause) {
        failItems(cause instanceof Error ? cause.message : String(cause))
      } finally {
        inFlight = null
      }
    })()
    inFlight = p
    return p
  }

  /** 操作成功后刷新（stale-while-revalidate — 刷新失败保留最后好数据）。 */
  const refreshAfter = async (): Promise<void> => {
    await loadInboxItems()
  }

  const convertInboxItem = async (args: InboxConvertArgs): Promise<void> => {
    await dataProvider.convertInboxItem(args)
    await refreshAfter()
  }

  const dismissInboxItem = async (inboxItemId: string): Promise<void> => {
    await dataProvider.dismissInboxItem(inboxItemId)
    await refreshAfter()
  }

  const quickCapture = async (payload: string, contextRefs?: readonly InboxTypedRef[]): Promise<void> => {
    await dataProvider.quickCapture(payload, contextRefs)
    await refreshAfter()
  }

  return {
    getSnapshot: store.getSnapshot,
    getState: store.getState,
    subscribe: store.subscribe,
    loadInboxItems,
    convertInboxItem,
    dismissInboxItem,
    quickCapture,
  }
}
