/**
 * UI0 (R-01) — `CurrentFocusService`: Current Focus 的 USER 业务面
 * （set / clear / get / revalidate — 语义门在此层, 行侧机械动作归 store）。
 *
 * 语义（冻结, 逐条）:
 *   - **Set**（不存在则创建）/ **Replace**（已存在则覆盖为新目标）/
 *     **Clear** / **Get** — USER 语义命名（Agent 可读不可写: 本任务无
 *     读 RPC、无 agent 面; 不出现 `agent_xxx` 命名, 也不暴露任何写
 *     路径给 agent — 无 tool、无 RPC）;
 *   - **canonical 成员门**（`set`）: 目标必须属于该 Workstream 的当前
 *     canonical Plan（经注入的 `canonicalPlanItemIds` provider 读取 —
 *     本任务通过注入接口与 `loadPlan()` 解耦, 不直读 .research/**、不拼
 *     Git 命令）; 不在 ⇒ 结构化拒绝 `CF_NOT_CANONICAL`（message 含
 *     workstreamId + planItemId + 「not in the canonical plan」）, 不
 *     静默; **provider 抛错原样透传**（不包装成 CF_* — provider 是
 *     plan 侧的既有真源, 它的错误语义由它自己拥有）;
 *   - **Plan mutation 后的再校验**（`revalidate`）: 无记录 ⇒ `absent`;
 *     目标仍在 canonical ⇒ `retained`（**不重写行** — updatedAt 不变）;
 *     目标已被移出 ⇒ 自动清除 ⇒ `cleared`;
 *   - execution / validation / Run / Blocker / Objective 的任何变化都**不**
 *     自动修改 Current Focus: 本模块没有这些路径, 也**不**为它们留任何
 *     钩子（无 listener、无 event 订阅、无 side-channel 参数）;
 *   - operational DB 丢失 ⇒ get 退化 `undefined`（store 层如实读, 本层
 *     不猜、不重建）。
 *
 * 层纪律（ARCHITECTURE §2.2）: 本文件**无** SQL、**无** fs、**无**
 * Git、**无** HistoryEvent（不产生 / 不追加任何事件行 — Current Focus
 * 的 set/clear 无冻结事件目录条目, 不落事件 = 不虚构）。
 */

import { CurrentFocusError, type CurrentFocusRecord, type CurrentFocusRevalidateOutcome } from './types.js'

/** The current canonical Plan member-ids of one workstream（注入真源缝 —
 *  生产 = 后续 wiring 接 PlanStore.loadPlan() 的 ordered_items id 序列,
 *  本任务测试 = 可变 fake provider 模拟 plan 变化）。 */
export type CanonicalPlanItemIdsProvider = (workstreamId: string) => readonly string[]

/** `CurrentFocusService` construction options (DI). */
export interface CurrentFocusServiceOptions {
  /** The operational persistence face（`current_focus` 表 — 本目录 store）。 */
  readonly store: import('./store.js').CurrentFocusStore
  /** Current canonical Plan membership（workstream → item id 序列 — 见上）。 */
  readonly canonicalPlanItemIds: CanonicalPlanItemIdsProvider
  /** Clock seam（与 store 同口径的注入时钟; store 与 service 必须接同一
   *  个时钟）。本层不自行戳行 — 行戳归 store 写时。构造时采样一次
   *  `nowFloor` 做写后戳一致性守门: store 落库的 updatedAt 不得早于
   *  service 的时钟底（检测 store 接到旧/异时钟的接线错误）。 */
  readonly now?: () => number
}

/** 边界形状面（同 store 的 assertId: 非空、非纯空白字符串）。 */
function assertId(operation: string, what: string, value: unknown): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CurrentFocusError({
      code: 'CF_INPUT',
      message: `${operation}: ${what} must be a non-empty string (got ${JSON.stringify(value)})`,
    })
  }
}

export class CurrentFocusService {
  readonly #store: CurrentFocusServiceOptions['store']
  readonly #canonicalPlanItemIds: CanonicalPlanItemIdsProvider
  /** The service's clock floor (sampled once at construction — see the
   *  options doc; the set-path stamp-coherence guard compares against
   *  it, so a `set` consumes the shared clock exactly ONCE, at the
   *  store's stamp). */
  readonly #nowFloor: number

  constructor(options: CurrentFocusServiceOptions) {
    if (
      options.store === undefined ||
      typeof options.store.get !== 'function' ||
      typeof options.store.set !== 'function' ||
      typeof options.store.clear !== 'function'
    ) {
      throw new CurrentFocusError({
        code: 'CF_INPUT',
        message: 'store: a CurrentFocusStore (get/set/clear face) is required',
      })
    }
    if (options.canonicalPlanItemIds === undefined || typeof options.canonicalPlanItemIds !== 'function') {
      throw new CurrentFocusError({
        code: 'CF_INPUT',
        message: 'canonicalPlanItemIds: a (workstreamId) => readonly string[] canonical-plan provider is required',
      })
    }
    const now = options.now ?? Date.now
    this.#store = options.store
    this.#canonicalPlanItemIds = options.canonicalPlanItemIds
    this.#nowFloor = now()
  }

  /**
   * Get the workstream's Current Focus（USER 读面）。`undefined` = 无
   * 指针（含 operational DB 丢失的退化 — 语义即无, 不报错）。
   */
  get(workstreamId: string): CurrentFocusRecord | undefined {
    assertId('get', 'workstreamId', workstreamId)
    return this.#store.get(workstreamId)
  }

  /**
   * Set / Replace the workstream's Current Focus（USER 写面 — 不存在则
   * 创建, 已存在则覆盖为新目标; 单值 — 覆盖即替换）。
   *
   * 门序: 输入形状（CF_INPUT）→ canonical 成员（CF_NOT_CANONICAL, 拒绝
   * 不落行）→ store 落库。canonical provider 的异常**原样透传**。
   */
  set(workstreamId: string, planItemId: string): CurrentFocusRecord {
    assertId('set', 'workstreamId', workstreamId)
    assertId('set', 'planItemId', planItemId)
    const canonical = this.#canonicalPlanItemIds(workstreamId)
    if (!canonical.includes(planItemId)) {
      throw new CurrentFocusError({
        code: 'CF_NOT_CANONICAL',
        message:
          `set: plan item ${JSON.stringify(planItemId)} is not in the canonical plan of ` +
          `workstream ${JSON.stringify(workstreamId)} (a Current Focus target must be a ` +
          `Task/Gate/Milestone of that workstream's current canonical plan)`,
      })
    }
    const t0 = this.#nowFloor
    const record = this.#store.set(workstreamId, planItemId)
    if (record.updatedAt < t0) {
      throw new CurrentFocusError({
        code: 'CF_STORE',
        message:
          `set: store stamp ${record.updatedAt} precedes the service clock floor ${t0} ` +
          `(the store and the service must share one injected clock)`,
      })
    }
    return record
  }

  /**
   * Clear the workstream's Current Focus（USER 清除面）。Returns whether
   * a pointer was cleared (false = there was none — a no-op, not an
   * error).
   */
  clear(workstreamId: string): boolean {
    assertId('clear', 'workstreamId', workstreamId)
    return this.#store.clear(workstreamId)
  }

  /**
   * Reconcile the pointer against the CURRENT canonical Plan after a
   * Plan mutation（调用时机 = plan mutation 提交后的 wiring 钩子 —
   * 后续集成任务; 本任务只交付该行为）:
   *
   *   - no pointer            ⇒ `{ outcome: 'absent' }`   （无记录可校验）
   *   - target still canonical⇒ `{ outcome: 'retained' }` （**不重写行**
   *                                          — updatedAt 原样不动）
   *   - target evicted        ⇒ auto-clear ⇒ `{ outcome: 'cleared' }`
   *
   * canonical provider 的异常原样透传。
   */
  revalidate(workstreamId: string): CurrentFocusRevalidateOutcome {
    assertId('revalidate', 'workstreamId', workstreamId)
    const record = this.#store.get(workstreamId)
    if (record === undefined) {
      return { outcome: 'absent' }
    }
    const canonical = this.#canonicalPlanItemIds(workstreamId)
    if (canonical.includes(record.planItemId)) {
      return { outcome: 'retained' }
    }
    this.#store.clear(workstreamId)
    return { outcome: 'cleared' }
  }
}
