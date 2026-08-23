/**
 * WP-5.4 — attention store 切片（**独立新文件** — 多 WP 并行的 store 目录
 * 冲突纪律: 本切片不修改 `model.ts` / `research-store.ts` / `index.ts`
 * 任何既有文件, 容器只 import 本文件）。
 *
 * 数据路径（为什么是「派生切片」而不是新 RPC）:
 *  冻结 13-RPC 面（ARCHITECTURE §7.1）无 attention 方法, 本 WP 不造第
 *  14/15 个 RPC（WP-4.1b RR-015① 同口径）。`DashboardSnapshot` 已经携带
 *  OPEN/PENDING Interventions 全集（§27.1: always complete — INV-ATTN-1）
 *  与 project importance/attention_mode, 而 `scheduledEvents` /
 *  `reportingItems` 是冻结 `null` 占位（WP-5.3 数据面后到）⇒ attention
 *  切片 = 既有 `dashboard` 切片经**同一个** baseline 评分器
 *  （`src/host/service/attention/scorer.ts` — 纯函数零 import, 与 host
 *  `AttentionService.getAttentionRanking` 共用算法单一真源）的投影。
 *  WP-5.5 Living Brief（host 侧）消费 host 服务面; 本切片消费 client 侧
 *  同一评分器 — 两侧排序必然一致（baseline context 特征零权重, 见
 *  scorer.ts 权重表注释）。
 *
 * 引擎纪律（WP-4.1b）: 复用 `./engine.js` 的 `createStore`（只读 import —
 * 不修改既有文件）; 切片形状复用 `./model.js` 的 `SliceState`（只读
 * import）。工厂导出、零模块级句柄（DSH_ADAPTER §6）。
 */

import type { DashboardSnapshot, InterventionDto } from '../../shared/rpc-contracts.js'
import {
  rankAttention,
  type AttentionContext,
  type AttentionItem,
  type AttentionRanking,
} from '../../host/service/attention/scorer.js'
import { createStore } from './engine.js'
import { idleSlice, type SliceState } from './model.js'

/* -------------------------------------------------------------------- *
 * 切片形状（= 主 store 的 SliceState<AttentionRanking> — 形状同族）
 * -------------------------------------------------------------------- */

export type AttentionRankingSlice = SliceState<AttentionRanking>

/** 初始（idle）切片 — 未请求。 */
export function initialAttentionRankingSlice(): AttentionRankingSlice {
  return idleSlice<AttentionRanking>()
}

/* -------------------------------------------------------------------- *
 * dashboard 快照 → 评分输入（DTO 映射; 与 host 的
 * interventionToAttentionItem 同口径: 第一个关联 WS, 无则 null）
 * -------------------------------------------------------------------- */

/**
 * 从 `DashboardSnapshot` 派生 baseline 排序（纯函数）。
 *
 * 候选面（V1 client 可见数据）: OPEN + PENDING Interventions 全集
 * （INV-ATTN-1: 恒完整 — 评分器再排序, 不隐藏）。组内防御性过滤
 * （openInterventions 组只收 status=OPEN, pendingInterventions 组只收
 * PENDING — 与 host `AttentionService` 的 CLOSED 防御口径同族; wire
 * schema 本身不强制组内状态一致性）。ScheduledEvent / NextAction /
 * Blocker 的 client 数据面是冻结 `null` 占位或 WP-5.2/5.3 未交付
 * ⇒ 基线不含（不伪造数据 — 同 WP-4.1a 占位纪律）。
 *
 * context 取 dashboard.project 的真实 importance/attention_mode（baseline
 * 零权重 ⇒ 与 host 默认值不产生排序分歧; 第 3/4 步激活权重时两侧同表）。
 */
export function rankingFromDashboard(snapshot: DashboardSnapshot, now: number): AttentionRanking {
  // 组内防御性过滤用类型谓词做窄化（DTO 的 status 是完整三值联合, wire
  // schema 不强制组内一致性 — host 侧同口径, 见 service.ts 头注）。
  const isOpen = (dto: InterventionDto): dto is InterventionDto & { status: 'OPEN' } => dto.status === 'OPEN'
  const isPending = (dto: InterventionDto): dto is InterventionDto & { status: 'PENDING' } => dto.status === 'PENDING'
  const items: AttentionItem[] = [
    ...snapshot.openInterventions.filter(isOpen).map((dto) => ({
      kind: 'INTERVENTION' as const,
      id: dto.id,
      title: dto.title,
      createdAt: dto.createdAt,
      workstreamId: dto.workstreamIds[0] ?? null,
      status: dto.status,
      origin: dto.origin,
    })),
    ...snapshot.pendingInterventions.filter(isPending).map((dto) => ({
      kind: 'INTERVENTION' as const,
      id: dto.id,
      title: dto.title,
      createdAt: dto.createdAt,
      workstreamId: dto.workstreamIds[0] ?? null,
      status: dto.status,
      origin: dto.origin,
    })),
  ]
  const context: AttentionContext = {
    now,
    projectImportance: snapshot.project.importance,
    attentionMode: snapshot.project.attentionMode,
  }
  return rankAttention(items, context)
}

/* -------------------------------------------------------------------- *
 * 切片 store 工厂（容器驱动 — 无自己的 RPC, 无 in-flight 去重需求）
 * -------------------------------------------------------------------- */

/**
 * 主 store dashboard 切片的投影面（容器每次 dashboard 切片变更调一次
 * `sync` — 切片节点引用稳定（WP-4.1b 引擎纪律）⇒ 只在真变更时到达）。
 */
export interface DashboardProjection {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly data: DashboardSnapshot | null
  readonly error: string | null
}

export interface AttentionRankingStore {
  /** 当前切片快照（uSES 引用稳定 — 引擎保证）。 */
  getSnapshot(): AttentionRankingSlice
  subscribe(listener: () => void): () => void
  /**
   * 容器驱动同步（dashboard 切片 → attention 切片, stale-while-revalidate
   * 语义与主 store 同族）:
   *   - `loading`  保持最后好的 ranking 可见（无则仅状态迁移）;
   *   - `ready`    重算 ranking（内容未变 ⇒ 快照引用不变, uSES 不重渲）;
   *   - `error`    无缓存 → error 面; 有缓存 → 陈旧 ranking + 错误条。
   */
  sync(projection: DashboardProjection): void
}

export interface AttentionRankingStoreOptions {
  /** Injectable clock（默认 `Date.now` — 测试注入确定性时钟）。 */
  readonly now?: () => number
}

/**
 * 创建 attention ranking 切片 store（工厂 — 零模块级句柄）。
 * @param options - clock 注入。
 * @returns 切片 store 面（容器经 props 传递, 组件不见 DSH ctx）。
 */
export function createAttentionRankingStore(options?: AttentionRankingStoreOptions): AttentionRankingStore {
  const now = options?.now ?? Date.now
  const store = createStore<AttentionRankingSlice>(initialAttentionRankingSlice())

  return {
    getSnapshot: () => store.getSnapshot(),
    subscribe: (listener) => store.subscribe(listener),
    sync(projection) {
      store.setState((prev) => {
        switch (projection.status) {
          case 'idle':
            // 主 store 的 dashboard 切片不会回 idle; 防御: 清空缓存。
            if (prev.status === 'idle' && prev.data === null) return prev
            return { status: 'idle', data: null, error: null, updatedAt: null }
          case 'loading':
            // stale-while-revalidate: 保持最后好的 data 可见。
            if (prev.status === 'loading' && prev.error === null) return prev
            return { ...prev, status: 'loading', error: null }
          case 'error':
            if (prev.data === null) {
              if (prev.status === 'error' && prev.error === projection.error) return prev
              return { status: 'error', data: null, error: projection.error ?? '未知错误', updatedAt: null }
            }
            if (prev.status === 'error' && prev.error === projection.error) return prev
            return { ...prev, status: 'error', error: projection.error ?? '未知错误' }
          case 'ready': {
            if (projection.data === null) return prev // ready 必带 data（契约）
            const ranking = rankingFromDashboard(projection.data, now())
            // uSES 引用稳定（引擎 §1）: 内容未变（items 全等）⇒ 保持引用,
            // 不重渲。generatedAt/updatedAt 是元数据, 不进比较。
            if (prev.status === 'ready' && prev.data !== null && sameItems(prev.data.items, ranking.items)) {
              return prev
            }
            return { status: 'ready', data: ranking, error: null, updatedAt: now() }
          }
        }
      })
    },
  }
}

/** items 内容全等（顺序 + 字段）— 排序结果的引用稳定判据。 */
function sameItems(a: readonly AttentionRanking['items'][number][], b: readonly AttentionRanking['items'][number][]): boolean {
  if (a.length !== b.length) return false
  return JSON.stringify(a) === JSON.stringify(b)
}
