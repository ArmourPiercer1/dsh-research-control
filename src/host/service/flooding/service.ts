/**
 * WP-3.5 — `FloodingService`: PLAN_FORK_SPEC §8 的接线缝 + §8 动作执行面。
 *
 * ## 钩子面（任务「接线缝」— 宿主接线 WP 挂到创建流 / plan 加载流）
 *
 *   `onPlanForkCreated(pf)`  — §8 触发点 1: 每次 PF 创建后（PF 创建已在
 *     `PlanForkStore.createPlanFork` 提交之后被钩到 — 钩子读到的 OPEN 集合
 *     含刚创建的 PF）;
 *   `onPlanLoaded(workstreamId)` — §8 触发点 2: 每次 plan 加载后。
 *
 * **不阻止创建（§8 末行: V1 不做更复杂自动限流）— 双钉**:
 *   类型面: `FloodingCheckResult.blocked` 字面类型 `false`（本模块不产出
 *     任何拒绝信号）;
 *   运行面: 两个钩子**永不抛** — policy 装载 / OPEN 集合读取 / 抑制探针 /
 *     检测 / Intervention 创建 / 事件 append 任何一步失败都收敛为结果内的
 *     结构化 `error`（PF 创建本身在钩子之前已提交 — 钩子失败无回滚语义,
 *     宿主接线 WP 据此只做信息展示, 绝不据此拒绝/重试创建流）。
 *
 * ## §8 动作执行（triggered && !suppressed 时, 顺序纪律 = WP-2.4 两连接写序）
 *
 *   ① 全预校验 — 无写;
 *   ② reserve IV + H 双号（§1.1 规则 2, 共享 allocator）;
 *   ③ INTERVENTION_CREATED 事件经 `store.appendEvents` append, registry
 *      `validate` hook 在 store 写事务内（INV-HIST-4: 未过冻结校验的事件
 *      永不落地; 校验 ctx 的 interventions map 排除本批新建 IV id —
 *      「新建」检查语义, 同 WP-2.4 `excludeRunIds` 先例）;
 *   ④ intervention 行落库（第二连接; 冻结形状网过真实 attention.schema.json）;
 *   ⑤ commit 双号。
 *
 * 失败窗口（文档化残差, 同 WP-2.4 头注）: ③ 已提交、④ 失败 ⇒ 事件在、
 * 行缺（事件是合法 catalog 事件; 行滞后收敛 — V1 无跨连接事务, 由未来
 * run-vs-history 对账扫收敛）。抑制探针在 ③ 之前读行, 单线程同步路径内
 * 无同进程竞态。
 *
 * ## 记录面决策（§12.1 核查结论）
 *
 * DOMAIN_SCHEMA §12.1 ManagementAction 的 15 值 `action_kind` 冻结枚举
 * **不含**任何 Intervention kind ⇒ 本 WP **不落 ManagementAction 账本行**;
 * §8 动作的记录面 = operational `intervention` 行 + INTERVENTION_CREATED
 * History 事件（CATALOG §5.7 — 该事件存在, 故发）。
 *
 * Layer (ARCHITECTURE §2.2): service — 唯一写 operational DB 的层。
 * 无 DSH import (INV-PERM-5)。
 */

import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

import { openDatabase, type ResearchStore } from '../../persistence/store/index.js'
import {
  loadPlanForkPolicy,
  type PlanForkRecord,
  type PlanForkStore,
} from '../../domain/planfork/index.js'
import {
  validateEvent,
  type HistoryEventRegistry,
  type HistoryObjectContext,
  type InterventionSnapshot,
} from '../../history/registry/index.js'
import type { HistoryEventInput, HistoryEventRecord } from '../../persistence/store/index.js'
import type { Reservation } from '../../../shared/ids/index.js'
import { detectPlanForkFlooding } from './detector.js'
import { buildAutoFloodingIntervention, buildInterventionCreatedEvent } from './intervention.js'
import type { InterventionStore } from './store.js'
import {
  FloodingError,
  isFloodingError,
  type FloodingCheckResult,
  type FloodingDb,
  type FloodingExternalState,
  type FloodingServiceOptions,
  type FloodingTrigger,
  type InterventionRecord,
} from './types.js'

const DEFAULT_BUSY_TIMEOUT_MS = 5000

export class FloodingService {
  readonly #store: ResearchStore
  readonly #registry: HistoryEventRegistry
  readonly #planForks: PlanForkStore
  readonly #interventions: InterventionStore
  readonly #allocator: FloodingServiceOptions['allocator']
  readonly #projectId: string
  readonly #reader: FloodingServiceOptions['researchFileReader']
  readonly #researchRoot: string
  readonly #schemaDir: string
  readonly #externalState: () => FloodingExternalState
  readonly #now: () => number

  constructor(options: FloodingServiceOptions) {
    if (options.store === undefined || options.store === null || typeof options.store.appendEvents !== 'function') {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'store: a WP-2.1 ResearchStore is required' })
    }
    if (options.registry === undefined || options.registry === null) {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'registry: a WP-2.2 event registry is required' })
    }
    if (options.planForks === undefined || options.planForks === null || typeof options.planForks.listPlanForks !== 'function') {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'planForks: a WP-3.1 PlanForkStore is required' })
    }
    if (options.interventions === undefined || options.interventions === null || typeof options.interventions.insertIntervention !== 'function') {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'interventions: an InterventionStore is required' })
    }
    if (options.allocator === undefined || options.allocator === null || typeof options.allocator.reserve !== 'function') {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'allocator: the shared IdAllocator is required' })
    }
    if (options.researchFileReader === undefined || options.researchFileReader === null || typeof options.researchFileReader.readFile !== 'function') {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'researchFileReader: a .research file reader is required' })
    }
    if (typeof options.projectId !== 'string' || options.projectId.length === 0) {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'projectId must be a non-empty string' })
    }
    if (typeof options.researchRoot !== 'string' || options.researchRoot.length === 0) {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'researchRoot must be a non-empty string' })
    }
    if (typeof options.schemaDir !== 'string' || options.schemaDir.length === 0) {
      throw new FloodingError({ code: 'FLOODING_INPUT', message: 'schemaDir must be a non-empty string' })
    }
    this.#store = options.store
    this.#registry = options.registry
    this.#planForks = options.planForks
    this.#interventions = options.interventions
    this.#allocator = options.allocator
    this.#projectId = options.projectId
    this.#reader = options.researchFileReader
    this.#researchRoot = options.researchRoot
    this.#schemaDir = options.schemaDir
    this.#externalState = options.externalState ?? (() => ({ workstreams: new Map() }))
    this.#now = options.now ?? Date.now
  }

  /* ================================================================== *
   * 钩子面（§8 两个触发点; 永不抛 — 非阻塞契约）
   * ================================================================== */

  /**
   * §8 触发点 1 — 每次 PF 创建后（宿主接线 WP 在 `createPlanFork` 提交后
   * 调用; `pf` = 刚创建的记录, 仅用于信息性 — 检测读库不读参数, 刚创建的
   * 行已在库内）。返回值仅信息性: 不阻止创建（§8 V1）。
   */
  onPlanForkCreated(pf: PlanForkRecord): FloodingCheckResult {
    if (pf === null || typeof pf !== 'object' || typeof pf.workstream_id !== 'string' || pf.workstream_id.length === 0) {
      return {
        workstream_id: '',
        trigger: 'PLAN_FORK_CREATED',
        checked: false,
        blocked: false,
        error: { code: 'FLOODING_INPUT', message: 'onPlanForkCreated: pf must be a PlanForkRecord with a non-empty workstream_id' },
      }
    }
    return this.#checkWorkstream(pf.workstream_id, 'PLAN_FORK_CREATED')
  }

  /** §8 触发点 2 — 每次 plan 加载后（宿主接线 WP 在 canonical plan 加载后调用）。 */
  onPlanLoaded(workstreamId: string): FloodingCheckResult {
    return this.#checkWorkstream(workstreamId, 'PLAN_LOADED')
  }

  /* ================================================================== *
   * Core check（module header 顺序纪律; 永不抛）
   * ================================================================== */

  #checkWorkstream(workstreamId: string, trigger: FloodingTrigger): FloodingCheckResult {
    const base: FloodingCheckResult = {
      workstream_id: workstreamId,
      trigger,
      checked: false,
      blocked: false,
    }
    if (typeof workstreamId !== 'string' || workstreamId.length === 0) {
      return { ...base, workstream_id: '', error: { code: 'FLOODING_INPUT', message: `${trigger}: workstreamId must be a non-empty string` } }
    }

    // 单次时钟采样: 证据 as_of / 记录 created_at / 事件 occurredAt 同源同值
    // （单调时钟每次调用推进 — 一次检查内必须共用一个采样点）。
    const asOf = this.#now()

    // ① §9 policy（fresh 装载 — 同 WP-3.1 创建流: 文件缺失=全默认 §8 默认阈值 5）。
    let threshold: number
    try {
      const policyResult = loadPlanForkPolicy(this.#reader, this.#researchRoot, this.#schemaDir)
      if (policyResult.policy === null) {
        return { ...base, error: { code: 'FLOODING_POLICY', message: policyResult.errors.map((e) => e.message).join('; ') } }
      }
      threshold = policyResult.policy.flooding.threshold
    } catch (cause) {
      return { ...base, error: { code: 'FLOODING_POLICY', message: `policy load failed: ${describe(cause)}` } }
    }

    // ② 观察窗口 = 该 WS 当前 OPEN PF 集合（WP-3.1 listPlanForks 缝,
    //    §15 索引 (workstream_id, status); 任意状态记录不传入检测器 —
    //    窗口滑动 = 状态迁移自然改变 OPEN 集合）。
    let openForks: readonly PlanForkRecord[]
    try {
      openForks = this.#planForks.listPlanForks({ workstreamId, status: 'OPEN' })
    } catch (cause) {
      return { ...base, error: { code: 'FLOODING_STORE', message: `open PF window read failed: ${describe(cause)}` } }
    }

    // ③ 抑制探针（§8 规则后半句 + 任务「重复抑制」— 同 WS 已有 OPEN
    //    AUTO_FLOODING 时不重复建）。
    let existing: InterventionRecord | null
    try {
      existing = this.#interventions.findOpenAutoFlooding(workstreamId)
    } catch (cause) {
      return { ...base, error: { code: 'FLOODING_STORE', message: `suppression probe failed: ${describe(cause)}` } }
    }

    // ④ 检测（纯函数; §8 规则逐字 — 含 per-WS 口径的输入面守卫）。
    let verdict: ReturnType<typeof detectPlanForkFlooding>
    try {
      verdict = detectPlanForkFlooding({
        workstreamId,
        planForks: openForks,
        threshold,
        hasOpenAutoFloodingIntervention: existing !== null,
        asOf,
      })
    } catch (cause) {
      return { ...base, checked: true, error: { code: isFloodingError(cause) ? cause.code : 'FLOODING_INPUT', message: describe(cause) } }
    }

    // ⑤ 非「应建」⇒ 仅信息性返回（不建不写）。
    if (!verdict.triggered || verdict.suppressed) {
      return { ...base, checked: true, verdict }
    }

    // ⑥ §8 动作: event 先行（③）→ 行落库（④）— module header 顺序纪律。
    let ivRes: Reservation | null = null
    let hRes: Reservation | null = null
    const releaseAll = (): void => {
      for (const res of [ivRes, hRes]) {
        if (res === null) continue
        try {
          this.#allocator.release(res)
        } catch {
          /* 释放失败不掩盖主失败 — 号已烧（§1.1 单调, gap 合法） */
        }
      }
    }
    try {
      ivRes = this.#allocator.reserve('INTERVENTION', this.#projectId)
      hRes = this.#allocator.reserve('HISTORY_EVENT', this.#projectId)

      let record: InterventionRecord
      try {
        record = buildAutoFloodingIntervention({ id: ivRes.id, evidence: verdict.evidence, createdAt: asOf })
      } catch (cause) {
        releaseAll()
        return { ...base, checked: true, verdict, error: { code: isFloodingError(cause) ? cause.code : 'FLOODING_INPUT', message: describe(cause) } }
      }

      let event: HistoryEventInput
      try {
        event = buildInterventionCreatedEvent({ eventId: hRes.id, record, occurredAt: record.created_at })
      } catch (cause) {
        releaseAll()
        return { ...base, checked: true, verdict, error: { code: isFloodingError(cause) ? cause.code : 'FLOODING_INPUT', message: describe(cause) } }
      }

      let appended: HistoryEventRecord
      try {
        const result = this.#store.appendEvents([event], {
          validate: makeValidateHook(this.#registry, () => this.#buildEventContext(ivRes!.id)),
        })
        appended = result.events[0]!
      } catch (cause) {
        releaseAll()
        return { ...base, checked: true, verdict, error: { code: isFloodingError(cause) ? cause.code : 'FLOODING_EVENT', message: describe(cause) } }
      }

      try {
        this.#interventions.insertIntervention(record)
      } catch (cause) {
        releaseAll()
        return { ...base, checked: true, verdict, error: { code: isFloodingError(cause) ? cause.code : 'FLOODING_STORE', message: describe(cause) } }
      }

      this.#allocator.commit(ivRes)
      this.#allocator.commit(hRes)
      return { ...base, checked: true, verdict, intervention_id: record.id, event_id: appended.eventId }
    } catch (cause) {
      // reserve() 自身失败（allocator/meta 面）或意外抛出 — 收敛为错误结果,
      // 绝不向创建流传播（非阻塞契约）。
      releaseAll()
      return { ...base, checked: true, verdict, error: { code: isFloodingError(cause) ? cause.code : 'FLOODING_STORE', message: describe(cause) } }
    }
  }

  /**
   * INTERVENTION_CREATED 的校验 ctx（module header ③）: interventions map
   * = 现行所有行 **排除本批新建 IV id**（「新建」检查语义 — 同 WP-2.4
   * excludeRunIds 先例）; workstreams = 注入的声明式侧快照（WORKSTREAM ref
   * 存在性 + owner 推导, catalog §5.7）; 其余 map 空（validator 对本事件
   * 只查 interventions/workstreams/source refs）。
   */
  #buildEventContext(excludeInterventionId: string): HistoryObjectContext {
    const interventions = new Map<string, InterventionSnapshot>()
    for (const row of this.#interventions.listInterventions()) {
      if (row.id === excludeInterventionId) continue
      interventions.set(row.id, { workstreamIds: row.workstream_ids })
    }
    return {
      workstreams: this.#externalState().workstreams,
      tasks: new Map(),
      runs: new Map(),
      claims: new Map(),
      facts: new Map(),
      artifacts: new Map(),
      relations: new Map(),
      gates: new Map(),
      milestones: new Map(),
      interventions,
      topologyEdges: new Map(),
    }
  }
}

/* ------------------------------------------------------------------ *
 * Registry validate hook（WP-2.2 缝 — 同 WP-2.4 makeValidateHook 纪律）
 * ------------------------------------------------------------------ */

/**
 * store `validate` hook 工厂: 批内每个事件过**冻结 registry** 校验
 * （payload 严格性 INV-HIST-4 / 存在性 / owner 规则 / 发射者矩阵 —
 * AUTO_FLOODING ⇒ actor.kind=PLUGIN 的 CROSS_FIELD 亦在此钉）, 任一失败
 * 抛结构化 `FloodingError`（FLOODING_EVENT）⇒ store 全批回滚
 * （未过校验的事件永不落地）。registry 不可用 ⇒ fail loud。
 */
function makeValidateHook(
  registry: HistoryEventRegistry,
  buildContext: () => HistoryObjectContext,
): (events: readonly HistoryEventRecord[], tx: unknown) => void {
  return (events): void => {
    if (!registry.isUsable) {
      throw new FloodingError({
        code: 'FLOODING_EVENT',
        message: `the event registry is unusable (load errors: ${registry.loadErrors.map((e) => e.code).join(', ')}); refusing to append an unvalidated event`,
      })
    }
    const ctx = buildContext()
    for (const event of events) {
      const result = validateEvent(registry, event, ctx)
      if (!result.ok) {
        throw new FloodingError({
          code: 'FLOODING_EVENT',
          message:
            `${event.eventType} (${event.eventId}) rejected by the frozen registry: ` +
            result.errors.map((e) => `[${e.code}] ${e.message}`).join('; '),
        })
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * DB 打开面（宿主接线 WP 用 — 同 WP-2.4 openRunBindingDatabase 模式）
 * ------------------------------------------------------------------ */

/** `openFloodingDatabase` 返回对（第二连接 + WP-2.1 store）。 */
export interface FloodingDatabase {
  /** WP-2.1 store handle（event append + meta）— 同文件。 */
  readonly store: ResearchStore
  /** 本 WP 第二连接（适配为 `FloodingDb` 结构端口; intervention DDL 由
   *  `InterventionStore` 构造时幂等应用）。 */
  readonly db: FloodingDb
  /** 关闭本对（第二连接 + store 连接）— idempotent。 */
  close(): void
}

/**
 * 经 WP-2.1 `openDatabase` 封装打开（或初始化）research.sqlite, 并在同文件
 * 开第二 `node:sqlite` 连接适配为 `FloodingDb`（module 头注双连接模式:
 * 文件 init/WAL/user_version 门归封装; busy_timeout 同 store 默认）。
 */
export function openFloodingDatabase(path: string, options: import('../../persistence/store/index.js').OpenDatabaseOptions = {}): FloodingDatabase {
  const store = openDatabase(path, options)
  const abs = resolve(path)
  let db: DatabaseSync
  try {
    db = new DatabaseSync(abs)
  } catch (cause) {
    store.close()
    throw new FloodingError({ code: 'FLOODING_STORE', message: `openFloodingDatabase: cannot open ${abs}: ${describe(cause)}`, cause })
  }
  try {
    db.exec(`PRAGMA busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`)
  } catch (cause) {
    try {
      db.close()
    } catch {
      /* best effort */
    }
    store.close()
    throw new FloodingError({ code: 'FLOODING_STORE', message: `openFloodingDatabase: busy_timeout at ${abs}: ${describe(cause)}`, cause })
  }
  const adapted: FloodingDb = {
    exec: (sql) => db.exec(sql),
    run: (sql, ...params) => Number(db.prepare(sql).run(...params).changes),
    get: (sql, ...params) => db.prepare(sql).get(...params) as Record<string, unknown> | undefined,
    all: (sql, ...params) => db.prepare(sql).all(...params) as Record<string, unknown>[],
    transaction: <T>(work: () => T): T => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = work()
        db.exec('COMMIT')
        return result
      } catch (cause) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* the transaction may already have rolled back */
        }
        throw cause
      }
    },
  }
  let closed = false
  return {
    store,
    db: adapted,
    close: () => {
      if (closed) return
      closed = true
      try {
        db.close()
      } catch {
        /* a second close must not mask the disposer path */
      }
      store.close()
    },
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
