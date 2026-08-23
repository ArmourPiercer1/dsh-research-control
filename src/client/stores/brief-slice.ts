/**
 * WP-5.5 — brief store 切片（**独立新文件** — 多 WP 并行的 store 目录
 * 冲突纪律: 本切片不修改 `model.ts` / `research-store.ts` / `index.ts`
 * 任何既有文件, 容器只 import 本文件）。
 *
 * 数据路径（为什么是「派生切片」而不是新 RPC — 同 WP-5.4 attention
 * 切片口径）:
 *  冻结 14 方法面（ARCHITECTURE §7.1）无 brief 方法, 本 WP 不造第 15 个
 *  RPC（WP-4.1b RR-015① 同口径）。client 可见的数据面 = 既有 `dashboard`
 *  切片（`DashboardSnapshot`: 项目/主题 + OPEN/PENDING Intervention 全集 —
 *  INV-ATTN-1）与 `project` 切片（`ProjectSnapshot`: Objectives）⇒ brief
 *  切片 = 这两个切片经**同一**投影引擎
 *  （`src/host/service/brief/project.ts` `projectBrief` — host
 *  `buildBrief()` 与 client 切片共用算法单一真源, 两侧投影必然同形）
 *  的现算投影。
 *
 * 数据面诚实边界（不虚构 — WP-4.1a 占位纪律）:
 *  client 无 wire 路径的面（最近 History 摘要 / NextAction / Blocker /
 *  ScheduledEvent / ReportingItem / Interaction / Future Plan 头部）在
 *  引擎输入里给**空集** ⇒ L2 该类要点为「暂无数据」占位、L3 对应行
 *  `EMPTY`（视图层以数据面说明文案补足「client 侧无 wire 路径, host
 *  buildBrief 有完整数据底座」的上下文）。Phase 6 面（audit/inbox）恒为
 *  「待开通」占位（引擎硬编码, 两侧同形）。
 *
 * 引擎纪律（WP-4.1b）: 复用 `./engine.js` 的 `createStore`（只读 import）;
 *  切片形状复用 `./model.js` 的 `SliceState`（只读 import）。工厂导出、
 *  零模块级句柄（DSH_ADAPTER §6）。`now` 经 `Date.now` 注入面（测试
 *  确定性时钟）。
 */

import type { DashboardSnapshot, ProjectSnapshot } from '../../shared/rpc-contracts.js'
import { projectBrief } from '../../host/service/brief/project.js'
import { briefInterventionsFromDashboard, objectiveDtoToBrief } from '../../host/service/brief/mapping.js'
import type { BriefInputs, LivingBrief } from '../../host/service/brief/types.js'
import { rankingFromDashboard, type DashboardProjection } from './attention-slices.js'
import { createStore } from './engine.js'
import { idleSlice, type SliceState } from './model.js'

/* -------------------------------------------------------------------- *
 * 切片形状（= 主 store 的 SliceState<LivingBrief> — 形状同族）
 * -------------------------------------------------------------------- */

export type BriefSlice = SliceState<LivingBrief>

/** 初始（idle）切片 — 未请求。 */
export function initialBriefSlice(): BriefSlice {
  return idleSlice<LivingBrief>()
}

/* -------------------------------------------------------------------- *
 * client 数据面 → 引擎输入（纯映射; 无 wire 路径的面给空集 — 不虚构）
 * -------------------------------------------------------------------- */

/**
 * 从 `dashboard` + `project` 快照派生三级 Brief（纯函数）。
 *
 * client 侧可用面:
 *  - interventions = dashboard OPEN+PENDING 全集（组内防御过滤 —
 *    WP-5.4 `rankingFromDashboard` 同口径）;
 *  - attention = 同一评分器 `rankingFromDashboard`（host/client 算法
 *    单一真源）;
 *  - objectives = project 快照的 ObjectiveDto（project 未加载 = 空集 —
 *    「暂无数据」占位, 加载后 slice 更新自动收敛）;
 *  - 其余面 = 空集（client 无 wire 路径 — 见模块头诚实边界）。
 */
export function briefFromClientSlices(
  dashboard: DashboardSnapshot,
  project: ProjectSnapshot | null,
  now: number,
): LivingBrief {
  const inputs: BriefInputs = {
    attention: rankingFromDashboard(dashboard, now),
    dashboard,
    interventions: briefInterventionsFromDashboard(dashboard),
    objectives: project === null ? [] : project.objectives.map(objectiveDtoToBrief),
    history: [],
    nextActions: [],
    blockers: [],
    scheduledEvents: [],
    reportingItems: [],
    interactions: [],
    futurePlans: [],
  }
  return projectBrief(inputs, now)
}

/* -------------------------------------------------------------------- *
 * 切片 store 工厂（容器驱动 — 无自己的 RPC, 无 in-flight 去重需求）
 * -------------------------------------------------------------------- */

/** 主 store `project` 切片的投影面（容器每次节点变更调一次 `sync`）。 */
export interface ProjectProjection {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly data: ProjectSnapshot | null
  readonly error: string | null
}

export interface BriefSyncInput {
  /** `dashboard` 切片（Brief 的硬依赖 — 未 ready 则不产 Brief）。 */
  readonly dashboard: DashboardProjection
  /** `project` 切片（Objectives 来源 — 未 ready 不阻塞 Brief, 空集占位）。 */
  readonly project: ProjectProjection
}

export interface BriefSliceStore {
  /** 当前切片快照（uSES 引用稳定 — 引擎保证）。 */
  getSnapshot(): BriefSlice
  subscribe(listener: () => void): () => void
  /**
   * 容器驱动同步（dashboard + project 切片 → brief 切片, stale-while-
   * revalidate 语义与主 store/attention 切片同族）:
   *   - dashboard `error`  无缓存 → error 面; 有缓存 → 陈旧 brief + 错误条;
   *   - dashboard `loading` 保持最后好的 brief 可见;
   *   - dashboard `ready`   重算 brief（project 未 ready ⇒ objectives 空集
   *     占位; 内容未变 ⇒ 快照引用不变, uSES 不重渲）;
   *   - dashboard `idle`    防御: 清空缓存。
   * project 的状态不决定切片状态机（Brief 只硬依赖 dashboard）—
   * project 的 ready/error 仅通过其 data 参与重算（容器两个节点都
   * 变更时调用本方法, 节点引用稳定 ⇒ 只在真变更时到达）。
   */
  sync(input: BriefSyncInput): void
}

export interface BriefSliceStoreOptions {
  /** Injectable clock（默认 `Date.now` — 测试注入确定性时钟）。 */
  readonly now?: () => number
}

/**
 * 创建 brief 切片 store（工厂 — 零模块级句柄）。
 * @param options - clock 注入。
 * @returns 切片 store 面（容器经 props 传递, 组件不见 DSH ctx）。
 */
export function createBriefSliceStore(options?: BriefSliceStoreOptions): BriefSliceStore {
  const now = options?.now ?? Date.now
  const store = createStore<BriefSlice>(initialBriefSlice())

  return {
    getSnapshot: () => store.getSnapshot(),
    subscribe: (listener) => store.subscribe(listener),
    sync(input) {
      store.setState((prev) => {
        switch (input.dashboard.status) {
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
              if (prev.status === 'error' && prev.error === input.dashboard.error) return prev
              return { status: 'error', data: null, error: input.dashboard.error ?? '未知错误', updatedAt: null }
            }
            if (prev.status === 'error' && prev.error === input.dashboard.error) return prev
            return { ...prev, status: 'error', error: input.dashboard.error ?? '未知错误' }
          case 'ready': {
            if (input.dashboard.data === null) return prev // ready 必带 data（契约）
            const brief = briefFromClientSlices(
              input.dashboard.data,
              input.project.data,
              now(),
            )
            // uSES 引用稳定（引擎 §1）: 内容未变 ⇒ 保持引用, 不重渲。
            // generatedAt 是元数据, 不进比较（同 WP-5.4 attention 切片口径）。
            if (prev.status === 'ready' && prev.data !== null && sameBrief(prev.data, brief)) {
              return prev
            }
            return { status: 'ready', data: brief, error: null, updatedAt: now() }
          }
        }
      })
    },
  }
}

/** brief 内容全等（L1/L2/L3 — 排除元数据 generatedAt/updatedAt）。 */
function sameBrief(a: LivingBrief, b: LivingBrief): boolean {
  return JSON.stringify({ l1: a.level1, l2: a.level2, l3: a.level3 }) === JSON.stringify({ l1: b.level1, l2: b.level2, l3: b.level3 })
}
