/**
 * WP-5.1 — `InterventionService`: Intervention 生命周期（创建 / 状态迁移 /
 * 全量查询）。
 *
 * ## 创建（两类来源, 任务目标 1）
 *
 *   `createUserIntervention(params, actor: UserActorRef)`
 *      — 用户类（GUI 手工登记）: origin 常量 `USER`（构建面不接受 origin
 *        参数）, created_by = actor;
 *   `createMechanicalIntervention(params, actor: MechanicalActorRef)`
 *      — 机械类: origin + actor kind 由 `trigger: MechanicalTriggerKind`
 *        （INV-ATTN-5 闭集, WP-3.5 冻结面）推导（types.ts 映射, 零自由度:
 *        AUTO_* ⇒ PLUGIN; AGENT_REPORT ⇒ AGENT）; 触发种类与 actor kind
 *        不配对 ⇒ IV_ACTOR_FORBIDDEN（运行面, 同类型面双钉）。
 *
 * 共同纪律（顺序, 同 WP-3.5 §8 动作 / WP-2.4 两连接写序）:
 *   ① 全预校验（无写）: title/WS id 模式/WS 存在性（§16 规则 2 写入时
 *      校验: 新引用失败 = 拒绝）/trigger 配对;
 *   ② reserve IV 号（+ H 号 — 仅当有 WS 关联, 无关联不发事件,
 *      TC-DOM-023）;
 *   ③ INTERVENTION_CREATED 事件经 `store.appendEvents` append — registry
 *      `validate` hook 在 store 写事务内（INV-HIST-4: 未过冻结校验的事件
 *      永不落地; E 列矩阵 U/A/P + origin=AUTO_* ⇒ actor.kind=PLUGIN 的
 *      CROSS_FIELD 在 registry 内钉; ctx 的 interventions map 排除本批
 *      新建 IV id — 「新建」检查语义, 同 WP-2.4 excludeRunIds 先例）;
 *   ④ intervention 行落库（lifecycle store; 整行过真实冻结
 *      attention.schema.json 形状网）;
 *   ⑤ commit 号。
 *
 * 失败窗口（文档化残差, 同 WP-3.5 头注）: ③ 已提交、④ 失败 ⇒ 事件在、
 * 行缺（事件是合法 catalog 事件; 行滞后收敛 — V1 无跨连接事务）; 任何
 * 失败都 release 全部预留号（§1.1 单调, gap 合法）。
 *
 * ## 状态迁移（INV-PERM-4 — 仅用户, 双面）
 *
 * `updateState(id, status, actor: UserActorRef, resolutionNote?)`:
 *   - **类型面**: actor 参数类型 `UserActorRef`（AGENT/PLUGIN/SYSTEM 是
 *     编译错误）;
 *   - **运行面**: `assertUserActor`（伪造的非 USER actor ⇒ IV_ACTOR_FORBIDDEN,
 *     零写入）— 同 WP-3.4 `assertUserActor` / WP-2.4 `UserActorRef` 先例;
 *   - §13 合法性（state-machine.ts 门, 冻结表单一来源在 WP-3.5）:
 *     OPEN ↔ PENDING; OPEN|PENDING → CLOSED 终态; 自环非法; 重开 = 新
 *     Intervention（CLOSED 无出口）;
 *   - resolutionNote 仅 CLOSED 合法（「关闭时用户填写」, §9.2; 与
 *     WP-4.1a 线面语义逐字一致 — 非关闭携带 note ⇒ IV_INPUT）;
 *   - 行侧写 = lifecycle store 的条件 UPDATE（`AND status = ?` 乐观并发
 *     门; 0 行 ⇒ IV_CONCURRENT_STATE, 大声不猜）;
 *   - **无 History 事件**: 冻结目录（CATALOG §4）的人类注意力事件**只有**
 *     INTERVENTION_CREATED — 状态迁移无对应事件, 不落事件 = 不虚构
 *     （目录 §7 新增事件需 bump schemaVersion, 归冻结文档维护面）。
 *
 * ## 查询（INV-ATTN-1 的 service 层落点: 无隐藏过滤器）
 *
 * `get` / `listOpen` / `listPending` / `listActive`（OPEN + PENDING 全量
 * 成对）/ `listClosed`: 返回该状态集的**全部**行（不排序、不截断、不
 * 按 origin/WS 筛选 — 稳定顺序 created_at ASC, id ASC 继承 WP-3.5 查询
 * 面）。「Attention Manager 只排序、不隐藏」的展示面 = client 分组视图
 * （views/intervention）, service 层保证数据完整这一半。
 *
 * Layer (ARCHITECTURE §2.2): service — 唯一写 operational DB 的层。
 * 无 DSH import (INV-PERM-5)。
 */

import {
  validateEvent,
  type HistoryEventRegistry,
  type HistoryObjectContext,
  type InterventionSnapshot,
  type TypedRef,
} from '../../history/registry/index.js'
import type { HistoryEventInput, HistoryEventRecord } from '../../persistence/store/index.js'
import type { Reservation } from '../../../shared/ids/index.js'
import {
  INTERVENTION_EVENT_SCHEMA_VERSION,
  type FloodingDb,
  type InterventionRecord,
  type IvStatus,
} from '../flooding/index.js'
import { assertInterventionTransition } from './state-machine.js'
import {
  InterventionError,
  MECHANICAL_TRIGGER_ACTOR_KIND,
  MECHANICAL_TRIGGER_ORIGIN,
  isInterventionError,
  toActorRef,
  type CreateInterventionResult,
  type InterventionCreateParams,
  type InterventionExternalState,
  type InterventionServiceOptions,
  type MechanicalInterventionCreateParams,
  type UpdateInterventionStateResult,
  type UserActorRef,
  type MechanicalActorRef,
} from './types.js'

/** 冻结 WS id 模式（common.schema.json idWorkstream）。 */
const WS_ID_PATTERN = /^WS-[1-9][0-9]*$/
/** 冻结 IV id 模式（common.schema.json idIntervention）。 */
const IV_ID_PATTERN = /^IV-[1-9][0-9]*$/

export class InterventionService {
  readonly #store: InterventionServiceOptions['store']
  readonly #registry: HistoryEventRegistry
  readonly #lifecycle: InterventionServiceOptions['lifecycle']
  readonly #allocator: InterventionServiceOptions['allocator']
  readonly #projectId: string
  readonly #externalState: () => InterventionExternalState
  readonly #now: () => number

  constructor(options: InterventionServiceOptions) {
    if (options.store === undefined || options.store === null || typeof options.store.appendEvents !== 'function') {
      throw new InterventionError({ code: 'IV_INPUT', message: 'store: a WP-2.1 ResearchStore is required' })
    }
    if (options.registry === undefined || options.registry === null) {
      throw new InterventionError({ code: 'IV_INPUT', message: 'registry: a WP-2.2 event registry is required' })
    }
    if (options.lifecycle === undefined || options.lifecycle === null || typeof options.lifecycle.updateState !== 'function') {
      throw new InterventionError({ code: 'IV_INPUT', message: 'lifecycle: an InterventionLifecycleStore is required' })
    }
    if (options.allocator === undefined || options.allocator === null || typeof options.allocator.reserve !== 'function') {
      throw new InterventionError({ code: 'IV_INPUT', message: 'allocator: the shared IdAllocator is required' })
    }
    if (typeof options.projectId !== 'string' || options.projectId.length === 0) {
      throw new InterventionError({ code: 'IV_INPUT', message: 'projectId must be a non-empty string' })
    }
    if (typeof options.externalState !== 'function') {
      throw new InterventionError({ code: 'IV_INPUT', message: 'externalState: a declarative-snapshot provider is required' })
    }
    this.#store = options.store
    this.#registry = options.registry
    this.#lifecycle = options.lifecycle
    this.#allocator = options.allocator
    this.#projectId = options.projectId
    this.#externalState = options.externalState
    this.#now = options.now ?? Date.now
  }

  /* ================================================================== *
   * 创建面（两类来源 — 任务目标 1）
   * ================================================================== */

  /**
   * 用户类创建（§6 矩阵行「Intervention 创建」U 栏）: origin 常量 USER;
   * actor 必须 USER（运行面断言 — 类型面在参数上）。
   */
  createUserIntervention(params: InterventionCreateParams, actor: UserActorRef): CreateInterventionResult {
    assertUserActor(actor, 'createUserIntervention')
    return this.#create(
      params,
      { origin: 'USER', actor },
      'createUserIntervention',
    )
  }

  /**
   * 机械类创建（§6 矩阵行 A/P 栏 — 仅机械触发¹, INV-ATTN-5 闭集）:
   * origin 由 trigger 推导（types.ts 映射）; actor kind 必须与 trigger
   * 配对（AUTO_* ⇒ PLUGIN; AGENT_REPORT ⇒ AGENT — 运行面断言）。
   */
  createMechanicalIntervention(
    params: MechanicalInterventionCreateParams,
    actor: MechanicalActorRef,
  ): CreateInterventionResult {
    const trigger = params.trigger
    const expectedKind = MECHANICAL_TRIGGER_ACTOR_KIND[trigger]
    if (expectedKind === undefined) {
      throw new InterventionError({
        code: 'IV_INPUT',
        message: `createMechanicalIntervention: trigger ${JSON.stringify(String(trigger))} is not a member of the INV-ATTN-5 mechanical-trigger closed set`,
      })
    }
    if (actor === null || typeof actor !== 'object' || actor.kind !== expectedKind) {
      throw new InterventionError({
        code: 'IV_ACTOR_FORBIDDEN',
        message: `createMechanicalIntervention: trigger ${trigger} requires an actor of kind ${expectedKind} (catalog §5.7: origin=AUTO_* ⇒ actor.kind=PLUGIN; AGENT_REPORT = agent report lane) — got ${JSON.stringify(actor)}`,
      })
    }
    return this.#create(
      params,
      { origin: MECHANICAL_TRIGGER_ORIGIN[trigger]!, actor },
      'createMechanicalIntervention',
    )
  }

  /**
   * 共同创建管线（module header 顺序纪律 ①–⑤）。抛出 `InterventionError`
   * （预校验/actor = IV_INPUT/IV_ACTOR_FORBIDDEN; registry 拒绝/append =
   * IV_EVENT; 行落库 = IV_STORE; 号预留 = IV_STORE）— 直接操作面（用户
   * GUI / agent 工具）, 失败必须大声, 与 flooding 钩子的非阻塞契约不同。
   */
  #create(
    params: InterventionCreateParams,
    derived: { origin: InterventionRecord['origin']; actor: UserActorRef | MechanicalActorRef },
    operation: string,
  ): CreateInterventionResult {
    // ① 全预校验（无写）。
    const title = params.title
    if (typeof title !== 'string' || title.length === 0) {
      throw new InterventionError({ code: 'IV_INPUT', message: `${operation}: title must be a non-empty string (DOMAIN_SCHEMA §9.2)` })
    }
    const detail = params.detail
    if (detail !== undefined && (typeof detail !== 'string' || detail.length === 0)) {
      throw new InterventionError({ code: 'IV_INPUT', message: `${operation}: detail must be a non-empty string when present (DOMAIN_SCHEMA §9.2)` })
    }
    const workstreamIds = params.workstream_ids ?? []
    for (const ws of workstreamIds) {
      if (typeof ws !== 'string' || !WS_ID_PATTERN.test(ws)) {
        throw new InterventionError({ code: 'IV_INPUT', message: `${operation}: workstream_ids must be well-formed WS ids ^WS-[1-9][0-9]*$ (got ${JSON.stringify(ws)})` })
      }
    }
    const sourceRefs = (params.source_refs ?? []).map((ref, i): TypedRef => {
      if (ref === null || typeof ref !== 'object' || typeof ref.kind !== 'string' || typeof ref.id !== 'string' || ref.id.length === 0) {
        throw new InterventionError({ code: 'IV_INPUT', message: `${operation}: source_refs[${i}] must be a {kind, id} typedRef (got ${JSON.stringify(ref)})` })
      }
      return { kind: ref.kind, id: ref.id }
    })
    // §16 规则 2（operational → 声明式: 写入时校验）: 每个关联 WS 必须
    // 存在于声明式快照（新引用写入失败 = 拒绝）。
    const workstreams = this.#externalState().workstreams
    for (const ws of workstreamIds) {
      if (!workstreams.has(ws)) {
        throw new InterventionError({
          code: 'IV_INPUT',
          message: `${operation}: workstream ${ws} does not exist in the declarative snapshot (DOMAIN_SCHEMA §16 规则 2: 写入时校验)`,
        })
      }
    }

    const createdAt = this.#now()
    const origin = derived.origin
    const actor = toActorRef(derived.actor)

    // ② 号预留（IV 恒; H 仅当有 WS 关联 — 无关联不发事件, TC-DOM-023）。
    const ownerWs = workstreamIds[0]
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
      if (ownerWs !== undefined) hRes = this.#allocator.reserve('HISTORY_EVENT', this.#projectId)

      // ③ 事件先行（有 WS 关联时）: INTERVENTION_CREATED（CATALOG §5.7
      //    payload 逐字 + WORKSTREAM ref 打头的 V1 owner 推导适配）。
      let eventId: string | null = null
      if (ownerWs !== undefined) {
        let event: HistoryEventInput
        try {
          event = this.#buildCreatedEvent(hRes!.id, {
            id: ivRes!.id,
            title,
            origin,
            ownerWs,
            sourceRefs,
            actor: derived.actor, // 原始类型化 actor（归一载体仅用于行/事件字段）
            occurredAt: createdAt, // 单次时钟采样（同 WP-3.5 纪律）
          })
        } catch (cause) {
          releaseAll()
          throw this.#wrapCause(cause, 'IV_EVENT')
        }
        let appended: HistoryEventRecord
        try {
          const result = this.#store.appendEvents([event], {
            validate: makeValidateHook(this.#registry, () => this.#buildEventContext(ivRes!.id)),
          })
          appended = result.events[0]!
        } catch (cause) {
          releaseAll()
          throw this.#wrapCause(cause, 'IV_EVENT')
        }
        eventId = appended.eventId
      }

      // ④ 行落库（冻结形状网 — 真实 attention.schema.json）。
      const record: InterventionRecord = {
        id: ivRes!.id,
        title,
        origin,
        workstream_ids: [...workstreamIds],
        source_refs: sourceRefs,
        status: 'OPEN',
        created_by: actor,
        created_at: createdAt,
        ...(detail !== undefined ? { detail } : {}),
      }
      try {
        this.#lifecycle.insertIntervention(record)
      } catch (cause) {
        releaseAll()
        throw this.#wrapCause(cause, 'IV_STORE')
      }

      // ⑤ commit 双号。
      this.#allocator.commit(ivRes)
      if (hRes !== null) this.#allocator.commit(hRes)
      return { intervention: record, eventId }
    } catch (cause) {
      // reserve() 自身失败（allocator/meta 面）或意外抛出。
      releaseAll()
      throw this.#wrapCause(cause, 'IV_STORE')
    }
  }

  /**
   * CATALOG §5.7 INTERVENTION_CREATED 事件（payload 逐字:
   * intervention_id(新建)/title/origin/source_refs?）。
   *
   * V1 owner 推导适配（同 WP-3.5 头注）: registry 的 owner 规则只认
   * payload source_refs 内的 **WS-local** ref（`workstreamOf`）⇒ 事件
   * payload 的 `source_refs` 以**显式 WORKSTREAM ref（owner WS）打头**
   * （与 record.workstream_ids[0] 冗余一致, 非新信息）, 后跟记录本身的
   * source_refs; 记录行保持参数原样（§9.2: workstream_ids 独立承载 WS
   * 关联）。owner WS ref 已在记录 source_refs 内打头时不重复。
   */
  #buildCreatedEvent(
    eventId: string,
    input: {
      id: string
      title: string
      origin: InterventionRecord['origin']
      ownerWs: string
      sourceRefs: readonly TypedRef[]
      actor: UserActorRef | MechanicalActorRef
      /** epoch ms（事件现实时刻 = 创建时刻 — 单次采样, 同 WP-3.5 纪律）。 */
      occurredAt: number
    },
  ): HistoryEventInput {
    if (typeof eventId !== 'string' || !/^H-[1-9][0-9]*$/.test(eventId)) {
      throw new InterventionError({ code: 'IV_INPUT', message: `buildCreatedEvent: eventId ${JSON.stringify(String(eventId))} is not a well-formed H id (^H-[1-9][0-9]*$)` })
    }
    if (typeof input.id !== 'string' || !IV_ID_PATTERN.test(input.id)) {
      throw new InterventionError({ code: 'IV_INPUT', message: `buildCreatedEvent: intervention id ${JSON.stringify(String(input.id))} is not a well-formed IV id` })
    }
    if (typeof input.occurredAt !== 'number' || !Number.isSafeInteger(input.occurredAt) || input.occurredAt < 0) {
      throw new InterventionError({ code: 'IV_INPUT', message: `buildCreatedEvent: occurredAt must be a non-negative safe integer epoch ms (got ${String(input.occurredAt)})` })
    }
    const anchored = input.sourceRefs.some((ref) => ref.kind === 'WORKSTREAM' && ref.id === input.ownerWs)
    const payloadRefs: TypedRef[] = anchored ? [...input.sourceRefs] : [{ kind: 'WORKSTREAM', id: input.ownerWs }, ...input.sourceRefs]
    return {
      eventId,
      ownerWorkstreamId: input.ownerWs,
      eventType: 'INTERVENTION_CREATED',
      schemaVersion: INTERVENTION_EVENT_SCHEMA_VERSION,
      occurredAt: input.occurredAt,
      actor: toActorRef(input.actor),
      payload: {
        intervention_id: input.id,
        title: input.title,
        origin: input.origin,
        source_refs: payloadRefs,
      },
    }
  }

  /**
   * INTERVENTION_CREATED 的校验 ctx（module header ③）: interventions
   * map = 现行所有行**排除本批新建 IV id**（「新建」检查语义）;
   * workstreams/runs = 注入的外部快照（WS 存在性 + owner 推导 + AGENT
   * actor.run_id 存在性, catalog §5）; 其余 map 空（validator 对本事件
   * 只查 interventions/workstreams/runs/source refs — 同 WP-3.5 先例）。
   */
  #buildEventContext(excludeInterventionId: string): HistoryObjectContext {
    const interventions = new Map<string, InterventionSnapshot>()
    for (const row of this.#lifecycle.listInterventions()) {
      if (row.id === excludeInterventionId) continue
      interventions.set(row.id, { workstreamIds: row.workstream_ids })
    }
    const external = this.#externalState()
    return {
      workstreams: external.workstreams,
      tasks: new Map(),
      runs: external.runs ?? new Map(),
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

  /* ================================================================== *
   * 状态迁移（INV-PERM-4 — 仅用户, 类型面 + 运行面双面）
   * ================================================================== */

  /**
   * §13 迁移（仅用户显式修改）:
   *   1. actor 运行面断言（类型面 = `UserActorRef` 参数 — 双面, 测试钉死）;
   *   2. 行存在（IV_NOT_FOUND）;
   *   3. §13 合法性门（IV_ILLEGAL_TRANSITION — 含自环; CLOSED 终态）;
   *   4. resolutionNote 仅 CLOSED（IV_INPUT — WP-4.1a 线面语义逐字）;
   *   5. 条件 UPDATE（`AND status = ?`; 0 行 ⇒ IV_CONCURRENT_STATE）。
   *
   * 无 History 事件（冻结目录无对应事件 — 不虚构, module header）。
   * 结果 DTO 与共享契约 `UpdateInterventionStateResult` 字段 1:1。
   */
  updateState(
    interventionId: string,
    status: IvStatus,
    actor: UserActorRef,
    resolutionNote?: string,
  ): UpdateInterventionStateResult {
    assertUserActor(actor, 'updateState')
    if (typeof interventionId !== 'string' || !IV_ID_PATTERN.test(interventionId)) {
      throw new InterventionError({ code: 'IV_INPUT', message: `updateState: interventionId must be a well-formed IV id (got ${JSON.stringify(String(interventionId))})` })
    }
    if (typeof status !== 'string' || !(['OPEN', 'PENDING', 'CLOSED'] as readonly string[]).includes(status)) {
      throw new InterventionError({ code: 'IV_INPUT', message: `updateState: status must be one of OPEN|PENDING|CLOSED (got ${JSON.stringify(String(status))})` })
    }
    if (resolutionNote !== undefined && (typeof resolutionNote !== 'string' || resolutionNote.length === 0)) {
      throw new InterventionError({ code: 'IV_INPUT', message: 'updateState: resolutionNote must be a non-empty string when present (DOMAIN_SCHEMA §9.2)' })
    }

    const current = this.#lifecycle.getIntervention(interventionId)
    if (current === null) {
      throw new InterventionError({ code: 'IV_NOT_FOUND', message: `intervention ${interventionId} does not exist` })
    }

    // §13 门（冻结表 — WP-3.5 单一来源; 自环/终态出口全拒）。
    assertInterventionTransition(interventionId, current.status, status)

    // 「关闭时用户填写」: note 仅随 CLOSED 出现（WP-4.1a 线面语义逐字）。
    if (resolutionNote !== undefined && status !== 'CLOSED') {
      throw new InterventionError({
        code: 'IV_INPUT',
        message: 'resolutionNote is only valid when closing an Intervention (status CLOSED; DOMAIN_SCHEMA §9.2)',
      })
    }

    const closedAt = status === 'CLOSED' ? this.#now() : null
    let affected: number
    try {
      affected = this.#lifecycle.updateState(interventionId, status, closedAt, resolutionNote ?? null, current.status)
    } catch (cause) {
      throw this.#wrapCause(cause, 'IV_STORE')
    }
    if (affected === 0) {
      throw new InterventionError({
        code: 'IV_CONCURRENT_STATE',
        message: `intervention ${interventionId} moved concurrently (expected status ${current.status}) — refetch and retry`,
      })
    }
    return {
      interventionId,
      statusFrom: current.status,
      statusTo: status,
      closedAt,
      resolutionNote: status === 'CLOSED' ? (resolutionNote ?? null) : null,
    }
  }

  /* ================================================================== *
   * 查询面（INV-ATTN-1: 全量, 无隐藏过滤器）
   * ================================================================== */

  /** One record by id（`null` when absent）。 */
  get(interventionId: string): InterventionRecord | null {
    return this.#lifecycle.getIntervention(interventionId)
  }

  /** OPEN 全量（稳定顺序 created_at ASC, id ASC; 不筛选不截断）。 */
  listOpen(): readonly InterventionRecord[] {
    return this.#lifecycle.listInterventions({ status: 'OPEN' })
  }

  /** PENDING 全量（同上）。 */
  listPending(): readonly InterventionRecord[] {
    return this.#lifecycle.listInterventions({ status: 'PENDING' })
  }

  /**
   * OPEN + PENDING 全量成对（§9.2 GUI 两个恒显组 — INV-ATTN-1: 始终完整
   * 展示; service 层 = 无隐藏过滤器, 展示层的排序/分组在 client 视图）。
   */
  listActive(): { readonly open: readonly InterventionRecord[]; readonly pending: readonly InterventionRecord[] } {
    return { open: this.listOpen(), pending: this.listPending() }
  }

  /** CLOSED 全量（§9.2「CLOSED 折叠」组 — 折叠是展示面, 数据仍完整）。 */
  listClosed(): readonly InterventionRecord[] {
    return this.#lifecycle.listInterventions({ status: 'CLOSED' })
  }

  /**
   * UI-4 (ADJ-7): the WS-local list — the `workstream_ids` contains
   * semantics live in the lifecycle store's filter; this method is a
   * store passthrough (INV-ATTN-1 无隐藏过滤器 — the ONLY filter is the
   * WS membership itself; the stable created_at ASC / id ASC order is
   * kept, so the client renders the full WS intervention set incl.
   * CLOSED for the 「已关闭」 group, B §15.7).
   */
  listForWorkstream(workstreamId: string): readonly InterventionRecord[] {
    return this.#lifecycle.listInterventions({ workstreamId })
  }

  /* ---------------------------------------------------------------- */

  #wrapCause(cause: unknown, code: 'IV_EVENT' | 'IV_STORE'): InterventionError {
    if (isInterventionError(cause)) {
      // 下层（lifecycle store / state 门 / registry hook）已给出精确分类 —
      // 原样穿透（不重包, 不掩盖 code）。
      return cause
    }
    const msg = cause instanceof Error ? cause.message : String(cause)
    return new InterventionError({ code, message: msg, cause })
  }
}

/* ------------------------------------------------------------------ *
 * actor 运行面门（INV-PERM-4 的运行半边 — 类型面在参数类型上）
 * ------------------------------------------------------------------ */

function assertUserActor(actor: UserActorRef, operation: string): void {
  if (actor === null || typeof actor !== 'object' || actor.kind !== 'USER') {
    throw new InterventionError({
      code: 'IV_ACTOR_FORBIDDEN',
      message: `${operation}: requires a USER actor (INV-PERM-4: Intervention 状态/用户创建面只允许用户显式操作; ARCHITECTURE §6 矩阵 U 栏) — got ${JSON.stringify(actor)}`,
    })
  }
  if (actor.user_id !== undefined && typeof actor.user_id !== 'string') {
    throw new InterventionError({ code: 'IV_INPUT', message: `${operation}: actor.user_id must be a string (common.schema.json actorRef)` })
  }
  if (actor.label !== undefined && (typeof actor.label !== 'string' || actor.label.length > 200)) {
    throw new InterventionError({ code: 'IV_INPUT', message: `${operation}: actor.label must be a string of ≤200 chars (common.schema.json actorRef)` })
  }
}

/* ------------------------------------------------------------------ *
 * Registry validate hook（WP-2.2 缝 — 同 WP-3.5 makeValidateHook 纪律）
 * ------------------------------------------------------------------ */

/**
 * store `validate` hook 工厂: 批内每个事件过**冻结 registry** 校验
 * （payload 严格性 INV-HIST-4 / 存在性 / owner 规则 / 发射者矩阵 E 列
 * U/A/P / origin=AUTO_* ⇒ actor.kind=PLUGIN 的 CROSS_FIELD）, 任一失败
 * 抛结构化 `InterventionError`（IV_EVENT）⇒ store 全批回滚（未过校验的
 * 事件永不落地）。registry 不可用 ⇒ fail loud。
 */
function makeValidateHook(
  registry: HistoryEventRegistry,
  buildContext: () => HistoryObjectContext,
): (events: readonly HistoryEventRecord[], tx: unknown) => void {
  return (events): void => {
    if (!registry.isUsable) {
      throw new InterventionError({
        code: 'IV_EVENT',
        message: `the event registry is unusable (load errors: ${registry.loadErrors.map((e) => e.code).join(', ')}); refusing to append an unvalidated event`,
      })
    }
    const ctx = buildContext()
    for (const event of events) {
      const result = validateEvent(registry, event, ctx)
      if (!result.ok) {
        throw new InterventionError({
          code: 'IV_EVENT',
          message:
            `${event.eventType} (${event.eventId}) rejected by the frozen registry: ` +
            result.errors.map((e) => `[${e.code}] ${e.message}`).join('; '),
        })
      }
    }
  }
}

/** 本 service 使用的 DB 端口（与 WP-3.5 同型 — 重导出便于 wiring 组装）。 */
export type { FloodingDb }
