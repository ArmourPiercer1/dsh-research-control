/**
 * WP-7.3 — AnalysisRecord / transient investigator 客户端切片（独立新文件 —
 * 多 WP 并行纪律: 不改 `research-store.ts` / `model.ts` / `registry.ts`）。
 *
 * DSH_ADAPTER §6 合规（与 WP-5.2 actions-slices / WP-6.4 inbox-slice 同款
 * 硬规则）:
 *  - **工厂非句柄**: `createAnalysisSliceStore` 是导出工厂; 无模块级实例;
 *    宿主接线（后续集成）经 slot option `store` 传工厂结果;
 *  - **组件不见 ctx**: 本文件零 DSH import（INV-PERM-5 — check-imports
 *    可证）; 与宿主只经结构端口说话（`AnalysisDataProvider`）, 生产实现
 *    由接线面注入（测试注入 stub）。
 *
 * 数据面与接线状态（冻结 13 RPC 现实 — ARCHITECTURE §7.1 无 AnalysisRecord
 * / investigator 面 — 「数据面裁决」未决, 同 WP-6.4 Inbox 面纪律）:
 *  - `transient` 切片 — **provider 缝**: `loadTransient(sessionId)` 经注入
 *    的 `AnalysisDataProvider.readTransient` 端口进入; 宿主侧真值来源 =
 *    本 WP `AnalysisTransientReader`（launcher 会话指针 → sessionlink 读取
 *    面 — 纯读, 零 operational 表写入 — INV-PERM-3 零写入类型面）; 缺省
 *    provider **fail-loud**（`NOT_WIRED` — 绝不伪造数据, 同 WP-6.4 缝纪律）;
 *  - `records` 切片 — 同缝: `loadAnalysisRecords()` 经
 *    `listAnalysisRecords` 端口进入; 宿主侧真值来源 = 本 WP
 *    `AnalysisRecordService.listAnalysisRecords` 查询面;
 *  - **保存流（用户显式 — INV-PERM-3 落地面）**: `saveAnalysisRecord(args)`
 *    = provider 透传（宿主侧 `AnalysisRecordService.saveAsAnalysisRecord`
 *    的 `UserActorRef` 门 — Agent 保存被拒, 零写入）+ 成功后自动刷新
 *    `records` 切片（宿主是数据真值, 本地不镜像变更 — 同 WP-6.4 操作面
 *    口径）。
 *
 * 切片状态机: 复用 WP-4.1b `SliceState`（idle/loading/ready/error +
 * stale-while-revalidate: refetch 失败保留最后好数据, 首载失败 data=null）。
 */

import { createStore } from './engine.js'
import { idleSlice, type SliceState } from './model.js'

/* -------------------------------------------------------------------- *
 * 载荷类型（显示面 — 宿主 record/snapshot 的 camelCase 投影;
 * 冻结 provenance.schema.json $defs/AnalysisRecord 字段集合, 一一对应）
 * -------------------------------------------------------------------- */

/** 一个 typedRef 元素（冻结 `typedRef` 投影）。 */
export interface AnalysisTypedRef {
  readonly kind: string
  readonly id: string
}

/** One AnalysisRecord for the GUI（§12.2; snake→camel 投影）。 */
export interface AnalysisRecordDto {
  readonly id: string
  readonly sourceRef: AnalysisTypedRef
  readonly investigatorRunId: string | null
  readonly dshSessionId: string | null
  /** 分析内容（Markdown — §12.2 必填）。 */
  readonly content: string
  readonly createdAt: number
}

/** transient 快照中 live session 摘要的投影（WP-0.4 `SessionSummary` 面）。 */
export interface TransientSessionDto {
  readonly id: string
  readonly cwd: string | null
  readonly title: string | null
  readonly running: boolean
  readonly createdAt: number
}

/** transient 快照中 sessionlink 指针行的投影（WP-2.6 `SessionPointer` 面）。 */
export interface TransientPointerDto {
  readonly workstreamId: string
  readonly taskId: string | null
  readonly intent: string | null
  readonly lastSeq: number
  readonly runId: string | null
  readonly runStartedAt: number | null
}

/** transient 快照中 formal run 行的投影（§6.1 run 表 `dsh_session_id` 关联）。 */
export interface TransientRunDto {
  readonly id: string
  readonly workstreamId: string
  readonly status: string
  readonly startedAt: number
  readonly endedAt: number | null
}

/**
 * 一个 investigator 会话的 transient 快照（GUI transient 面板的数据面 —
 * 只读渲染; 数据来源 = launcher 会话指针 → sessionlink 读取面, 不落任何
 * operational 表 — 计划书 §26.2「默认 transient」）。三个可选面 `null` =
 * 缺席诚实透出（会话已 dispose / 未绑定 workstream / 无 formal run）。
 */
export interface InvestigatorTransientDto {
  readonly sessionId: string
  readonly session: TransientSessionDto | null
  readonly pointer: TransientPointerDto | null
  readonly run: TransientRunDto | null
}

/** `records` 切片载荷。 */
export interface AnalysisRecordListData {
  readonly records: readonly AnalysisRecordDto[]
}

/** 保存请求（宿主 `AnalysisRecordService.saveAsAnalysisRecord` 参数面 —
 *  用户显式确认载荷; 形状由保存对话框收集, 宿主侧全预校验复验）。 */
export interface SaveAnalysisRecordArgs {
  readonly sourceRef: AnalysisTypedRef
  readonly content: string
  readonly investigatorRunId?: string
  readonly dshSessionId?: string
}

/* -------------------------------------------------------------------- *
 * 注入端口（零 DSH import — 结构端口, 生产实现由接线面提供）
 * -------------------------------------------------------------------- */

/**
 * Analysis 数据缝（宿主 `AnalysisRecordService` 查询/保存面 +
 * `AnalysisTransientReader` 读取面的未来接线目标 — 冻结 13-RPC 无
 * AnalysisRecord/investigator 面, 数据面裁决后接 slot data 通道 /
 * 宿主直连）。
 */
export interface AnalysisDataProvider {
  /** transient 快照（sessionId = launcher 的会话指针; 纯读零写入）。 */
  readTransient(sessionId: string): Promise<InvestigatorTransientDto>
  /** 已保存 AnalysisRecord 列表（宿主查询面 — 稳定顺序 createdAt ASC）。 */
  listAnalysisRecords(): Promise<readonly AnalysisRecordDto[]>
  /** 用户显式保存（宿主 `UserActorRef` 门 — 非 USER 被拒, 零写入）。 */
  saveAnalysisRecord(args: SaveAnalysisRecordArgs): Promise<AnalysisRecordDto>
}

/** 本模块错误载体（fail-loud 缝 — 消息点名接线缺口）。 */
export class AnalysisSliceError extends Error {
  readonly code: 'NOT_WIRED'

  constructor(code: 'NOT_WIRED', message: string) {
    super(message)
    this.name = 'AnalysisSliceError'
    this.code = code
  }
}

/** 缺省 provider（无接线时 — 每次调用大声失败, 绝不返回伪造数据）。 */
export const NOT_WIRED_PROVIDER: AnalysisDataProvider = {
  async readTransient(_sessionId: string): Promise<never> {
    throw new AnalysisSliceError(
      'NOT_WIRED',
      'investigator transient face not wired in this build — the frozen 13-RPC list (ARCHITECTURE §7.1) carries no investigator face; the host AnalysisTransientReader (launcher session pointer → sessionlink read face, zero operational writes — INV-PERM-3) is the future wiring target (WP-7.3 报告「实现要点」)',
    )
  },
  async listAnalysisRecords(): Promise<never> {
    throw new AnalysisSliceError(
      'NOT_WIRED',
      'analysis record list not wired in this build — the frozen 13-RPC list (ARCHITECTURE §7.1) carries no AnalysisRecord face; the host AnalysisRecordService.listAnalysisRecords query face is the future wiring target',
    )
  },
  async saveAnalysisRecord(_args: SaveAnalysisRecordArgs): Promise<never> {
    throw new AnalysisSliceError(
      'NOT_WIRED',
      'analysis save not wired in this build — the frozen 13-RPC list (ARCHITECTURE §7.1) carries no AnalysisRecord face; the host AnalysisRecordService.saveAsAnalysisRecord (user-explicit gate — INV-PERM-3) is the future wiring target',
    )
  },
}

/* -------------------------------------------------------------------- *
 * Store
 * -------------------------------------------------------------------- */

export interface AnalysisSliceState {
  /** transient 快照切片（按 `loadTransient(sessionId)` 请求的 session）。 */
  readonly transient: SliceState<InvestigatorTransientDto>
  /** 已保存记录列表切片。 */
  readonly records: SliceState<AnalysisRecordListData>
}

export interface AnalysisSliceStoreOptions {
  /** Analysis 数据缝（缺省 = `NOT_WIRED_PROVIDER` — fail-loud）。 */
  readonly dataProvider?: AnalysisDataProvider
  /** 时钟（updatedAt 标记; 测试可注入）。 */
  readonly now?: () => number
}

export interface AnalysisSliceStore {
  /** 数据缝接线状态（false = 缺省 NOT_WIRED_PROVIDER — 操作面据此禁用,
   *  fail-loud 不止于抛错, 入口即不可用 — 容器保存按钮面）。 */
  readonly providerWired: boolean
  getSnapshot(): AnalysisSliceState
  getState(): AnalysisSliceState
  subscribe(listener: () => void): () => void
  /** 惰性加载 transient 快照（sessionId = launcher 会话指针 — 首请求才取;
   *  不同 session 的请求排队, 乱序 settle 不可能覆盖新值）。 */
  loadTransient(sessionId: string): Promise<void>
  /** 惰性加载已保存记录列表（ARCHITECTURE §8 懒加载）。 */
  loadAnalysisRecords(): Promise<void>
  /** 用户显式保存（成功后自动刷新 records 切片 — 宿主是数据真值）;
   *  返回宿主保存产物（容器成功 chip 的即时反馈面）。 */
  saveAnalysisRecord(args: SaveAnalysisRecordArgs): Promise<AnalysisRecordDto>
}

const initialAnalysisSliceState = (): AnalysisSliceState => ({
  transient: idleSlice<InvestigatorTransientDto>(),
  records: idleSlice<AnalysisRecordListData>(),
})

/**
 * Create the analysis slice store（factory — never module-cached）。
 *
 * 并发纪律（同 WP-4.1b/WP-5.2/WP-6.4）: 每切片一个在飞 fetch; 同切片并发
 * load 共享该 fetch（后到者等待先到者 — 乱序 settle 不可能覆盖新值）。
 * transient 切片的「同切片」= 同一 sessionId; 不同 sessionId 的请求等待
 * 在飞 settle 后按序取新值（排队 — 面板只呈现最新请求的 session）。
 * 操作（saveAnalysisRecord）= provider 调用 + 成功刷新 — 操作本身不标记
 * loading（transient UI 反馈归容器, 同 WP-6.4 操作面口径）。
 */
export function createAnalysisSliceStore(options: AnalysisSliceStoreOptions = {}): AnalysisSliceStore {
  const now = options.now ?? Date.now
  const dataProvider = options.dataProvider ?? NOT_WIRED_PROVIDER
  const providerWired = options.dataProvider !== undefined

  const store = createStore<AnalysisSliceState>(initialAnalysisSliceState())
  let transientInFlight: { readonly sessionId: string; readonly promise: Promise<void> } | null = null
  let recordsInFlight: Promise<void> | null = null

  const commitTransient = (payload: InvestigatorTransientDto): void => {
    store.setState((s) => ({
      ...s,
      transient: { status: 'ready', data: payload, error: null, updatedAt: now() },
    }))
  }

  const failTransient = (message: string): void => {
    store.setState((s) => {
      const prev = s.transient
      return { ...s, transient: { status: 'error', data: prev.data, error: message, updatedAt: prev.updatedAt } }
    })
  }

  const markTransientLoading = (): void => {
    store.setState((s) => {
      const prev = s.transient
      if (prev.status === 'loading') return s
      return { ...s, transient: { status: 'loading', data: prev.data, error: prev.error, updatedAt: prev.updatedAt } }
    })
  }

  const loadTransient = (sessionId: string): Promise<void> => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return Promise.resolve().then(() => {
        failTransient('loadTransient: sessionId must be a non-empty string (the launcher session pointer)')
      })
    }
    if (transientInFlight !== null && transientInFlight.sessionId === sessionId) {
      return transientInFlight.promise
    }
    // 不同 session: 等待在飞 settle 后再取（乱序保护 — 后到请求不覆盖）。
    const prev = transientInFlight?.promise ?? Promise.resolve()
    const p = prev.then(
      () =>
        new Promise<void>((resolve, reject) => {
          markTransientLoading()
          dataProvider
            .readTransient(sessionId)
            .then(
              (data) => {
                commitTransient(data)
                resolve()
              },
              (cause) => {
                failTransient(cause instanceof Error ? cause.message : String(cause))
                resolve()
              },
            )
            .catch(reject)
        }),
    )
    transientInFlight = { sessionId, promise: p }
    return p
  }

  const commitRecords = (payload: AnalysisRecordListData): void => {
    store.setState((s) => ({
      ...s,
      records: { status: 'ready', data: payload, error: null, updatedAt: now() },
    }))
  }

  const failRecords = (message: string): void => {
    store.setState((s) => {
      const prev = s.records
      return { ...s, records: { status: 'error', data: prev.data, error: message, updatedAt: prev.updatedAt } }
    })
  }

  const markRecordsLoading = (): void => {
    store.setState((s) => {
      const prev = s.records
      if (prev.status === 'loading') return s
      return { ...s, records: { status: 'loading', data: prev.data, error: prev.error, updatedAt: prev.updatedAt } }
    })
  }

  const loadAnalysisRecords = async (): Promise<void> => {
    if (recordsInFlight !== null) return recordsInFlight
    const p = (async () => {
      markRecordsLoading()
      try {
        const records = await dataProvider.listAnalysisRecords()
        commitRecords({ records })
      } catch (cause) {
        failRecords(cause instanceof Error ? cause.message : String(cause))
      } finally {
        recordsInFlight = null
      }
    })()
    recordsInFlight = p
    return p
  }

  const saveAnalysisRecord = async (args: SaveAnalysisRecordArgs): Promise<AnalysisRecordDto> => {
    // 失败原样上抛（容器持 transient UI 反馈）; 成功 = 刷新列表（宿主是
    // 数据真值 — 本地不镜像保存产物, 同 WP-6.4 操作面口径）+ 返回宿主
    // 产物（容器成功 chip 的即时反馈面）。
    const saved = await dataProvider.saveAnalysisRecord(args)
    await loadAnalysisRecords()
    return saved
  }

  return {
    providerWired,
    getSnapshot: store.getSnapshot,
    getState: store.getState,
    subscribe: store.subscribe,
    loadTransient,
    loadAnalysisRecords,
    saveAnalysisRecord,
  }
}
