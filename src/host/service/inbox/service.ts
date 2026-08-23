/**
 * WP-6.4 — `InboxService`: Research Inbox（DOMAIN_SCHEMA §11 / 计划书
 * §28 / §22.3）— 条目 CRUD + 状态机 + 转换流 + 高影响升级。
 *
 * ## 条目构造器接缝（任务目标 1: 来源 audit/discovery/reconcile/
 * flooding 机械入口 + 用户快捷捕获）
 *
 *   `captureHuman(params, actor: UserActorRef)`
 *      — source 常量 HUMAN_QUICK_CAPTURE（构建面不接受 source 参数）;
 *   `captureMechanical(params, actor: MechanicalActorRef)`
 *      — source ∈ 6 值机械闭集（类型面）; WP-6.1 audit 缝
 *      （UNCLASSIFIED_AUDIT_FINDING）/ WP-6.2 discovery 缝
 *      （UNREGISTERED_WORKSPACE_CHANGE）/ WP-6.3 reconciliation 三档
 *      （PROPOSE_RECONCILIATION 材料 / ESCALATE 经 `escalateMechanical`）/
 *      flooding / session discovery 的**唯一**落库入口 — 零第二入口。
 *
 * 共同纪律（顺序）:
 *   ① 全预校验（无写）: payload 非空 / contextRefs 形状 / source 闭集;
 *   ② reserve IN 号（§1.1 规则 2, PROJECT scope, capture 时分配）;
 *   ③ 行落库（state = CAPTURED — 初始态; 整行过真实冻结
 *      inbox.schema.json 形状网, store 内嵌）;
 *   ④ commit 号。任何失败都 release（§1.1 单调, gap 合法）。
 *
 * 无 History 事件: 冻结目录（HISTORY_EVENT_CATALOG）无 Inbox 事件
 * （Inbox item 不是正式科研状态 — §11 原文; 落事件 = 虚构, 同 WP-5.1
 * 「状态迁移无对应事件不落」口径）。
 *
 * ## 状态迁移（§13: CAPTURED → CONVERTED | DISMISSED 终态）
 *
 * `dismiss(id, actor: UserActorRef)` — 仅用户（类型面 + 运行面
 * `assertUserActor` 双面, 同 WP-5.1 INV-PERM-4 先例）; §13 门
 * （state-machine.ts, 含自环/终态出口全拒）; 行侧写 = 条件 UPDATE
 * （`AND state = ?` 乐观并发门; 0 行 ⇒ IN_CONCURRENT_STATE, 大声不猜）。
 *
 * ## 转换流（任务目标 1: §28 原文转换动作集 — 显式确认）
 *
 * `convert(params, actor: UserActorRef)`:
 *   - **显式确认（类型面）**: actor 参数类型 `UserActorRef`（§28「转换
 *     需要显式确认或明确 policy」的 GUI 落点 — 非 USER = 编译错误）+
 *     运行面断言（伪造 ⇒ IN_ACTOR_FORBIDDEN, 零写入）;
 *   - `fields` 判别联合与 `targetKind` 配对（类型面配对 + 运行面再断言）;
 *   - 目标 kind 执行器端口（DI — 生产传真实 WP-5.1/5.2/5.3 service 闭集;
 *     未接线 ⇒ IN_TARGET_NOT_WIRED 指名 kind — V1 诚实边界: CLAIM/FACT
 *     记录 service / TASK 声明式完成内核未交付, 见报告「未决」）;
 *   - 顺序纪律: ① 预校验（条目存在 / §13 门 / 执行器在位）→ ② 执行器
 *     创建正式对象（失败 ⇒ IN_CONVERT_TARGET, 条目保持 CAPTURED 零状态
 *     写）→ ③ 条件 UPDATE（CAPTURED → CONVERTED + converted_to; 0 行 ⇒
 *     IN_CONCURRENT_STATE — 正式对象已建的残差在消息里大声指明）→ ④
 *     INBOX_CONVERTED 账本行（§12.1 冻结 15 值 action_kind; 失败 ⇒
 *     IN_LEDGER 大声 + 手动 reconciliation 指引, 同 WP-4.1a reorderPlan
 *     账本残差先例）。
 *
 * ## 高影响升级（任务目标 1: §22.3 ESCALATE 档 — 机械判定 → Intervention）
 *
 * `escalateMechanical(params, actor: MechanicalActorRef)`:
 *   1. 机械判定（escalation.ts 纯函数 — 关键路径/损失/批量影响三规则,
 *      零语义判断）;
 *   2. 判定 highImpact 时**先验**联动端口在位（IN_INPUT, 零写入大声）;
 *   3. 恒先捕获条目（capture-first: 升级也是 Inbox 一条目 — 机械证据落
 *      `raw` + 机械升级标记 `raw.escalation` + `context_refs`）;
 *   4. highImpact ⇒ Intervention 创建联动（`mechanicalInterventionCreator`
 *      端口 — 生产 = WP-5.1 `createMechanicalIntervention`
 *      trigger=AUDIT_HIGH_IMPACT_DISCREPANCY ⇒ origin AUTO_AUDIT,
 *      INV-ATTN-5 闭集成员; source_refs 以 INBOX_ITEM ref 打头 +
 *      证据 contextRefs; 失败 ⇒ IN_ESCALATION, 条目已捕获大声指明）;
 *   5. 非高影响 ⇒ 条目留在 CAPTURED（§22.3 PROPOSE 档语义 — 等用户）。
 *
 * Layer (ARCHITECTURE §2.2): service — 唯一写 operational DB 的层。
 * 无 DSH import (INV-PERM-5)。
 */

import type { TypedRef } from '../../history/registry/index.js'
import type { ManagementActionRecord } from '../../domain/planfork/index.js'
import type { Reservation } from '../../../shared/ids/index.js'
import { assertInboxTransition } from './state-machine.js'
import { assessEscalation, buildEscalationDetail, DEFAULT_ESCALATION_BATCH_THRESHOLD, escalationInterventionTitle } from './escalation.js'
import { InboxStore } from './store.js'
import {
  CONVERSION_TARGET_KINDS,
  HUMAN_INBOX_SOURCE,
  InboxError,
  MECHANICAL_INBOX_SOURCES,
  isInboxError,
  type CaptureParams,
  type CaptureResult,
  type ConvertInboxParams,
  type ConvertResult,
  type DismissResult,
  type EscalateMechanicalParams,
  type EscalationAssessment,
  type EscalationResult,
  type InboxItemRecord,
  type InboxServiceOptions,
  type InboxSource,
  type InboxConversionTargetExecutor,
  type MechanicalActorRef,
  type MechanicalCaptureParams,
  type MechanicalInboxSource,
  type MechanicalInterventionCreator,
  type InterventionCreatedRef,
  type ManagementActionRecorder,
  type UserActorRef,
} from './types.js'

/** 冻结 IN id 模式（common.schema.json idInboxItem）。 */
const IN_ID_PATTERN = /^IN-[1-9][0-9]*$/
/** 冻结 MA id 模式（common.schema.json idManagementAction）。 */
const MA_ID_PATTERN = /^MA-[1-9][0-9]*$/

export class InboxService {
  readonly #store: InboxStore
  readonly #allocator: InboxServiceOptions['allocator']
  readonly #projectId: string
  readonly #targets: InboxConversionTargetExecutor | undefined
  readonly #mechanicalInterventionCreator: MechanicalInterventionCreator | undefined
  readonly #managementActionRecorder: ManagementActionRecorder | undefined
  readonly #batchThreshold: number
  readonly #now: () => number

  constructor(options: InboxServiceOptions) {
    if (options.store === undefined || options.store === null || typeof options.store.insertItem !== 'function') {
      throw new InboxError({ code: 'IN_INPUT', message: 'store: an InboxStore is required' })
    }
    if (options.allocator === undefined || options.allocator === null || typeof options.allocator.reserve !== 'function') {
      throw new InboxError({ code: 'IN_INPUT', message: 'allocator: the shared IdAllocator is required' })
    }
    if (typeof options.projectId !== 'string' || options.projectId.length === 0) {
      throw new InboxError({ code: 'IN_INPUT', message: 'projectId must be a non-empty string' })
    }
    const threshold = options.escalation?.batchThreshold
    if (threshold !== undefined && (typeof threshold !== 'number' || !Number.isSafeInteger(threshold) || threshold < 1)) {
      throw new InboxError({
        code: 'IN_INPUT',
        message: `escalation.batchThreshold must be a safe integer >= 1 (got ${String(threshold)}; default ${DEFAULT_ESCALATION_BATCH_THRESHOLD})`,
      })
    }
    this.#store = options.store
    this.#allocator = options.allocator
    this.#projectId = options.projectId
    this.#targets = options.conversionTargets
    this.#mechanicalInterventionCreator = options.mechanicalInterventionCreator
    this.#managementActionRecorder = options.managementActionRecorder
    this.#batchThreshold = threshold ?? DEFAULT_ESCALATION_BATCH_THRESHOLD
    this.#now = options.now ?? Date.now
  }

  /* ================================================================== *
   * 捕获面（条目构造器接缝 — 任务目标 1）
   * ================================================================== */

  /**
   * 用户类捕获（§11 `HUMAN_QUICK_CAPTURE`）: source 常量（构建面不接受
   * source 参数 — 类型即闭集）; actor 必须 USER（运行面断言）。
   */
  captureHuman(params: CaptureParams, actor: UserActorRef): CaptureResult {
    assertUserActor(actor, 'captureHuman')
    return this.#capture(HUMAN_INBOX_SOURCE, params, 'captureHuman')
  }

  /**
   * 机械类捕获（§11 其余 6 source — 类型面闭集; 运行面再断言）: audit /
   * discovery / reconcile / flooding / session 机械入口的唯一落库面。
   * actor = AGENT | PLUGIN（非 USER — §11 未冻结 per-source 配对矩阵,
   * 本面只钉「非 USER」, 见 types.ts 头注）。
   */
  captureMechanical(params: MechanicalCaptureParams, actor: MechanicalActorRef): CaptureResult {
    assertMechanicalActor(actor, 'captureMechanical')
    if (typeof params.source !== 'string' || !(MECHANICAL_INBOX_SOURCES as readonly string[]).includes(params.source)) {
      throw new InboxError({
        code: 'IN_INPUT',
        message: `captureMechanical: source ${JSON.stringify(String(params.source))} is not a member of the mechanical source closed set (${MECHANICAL_INBOX_SOURCES.join('|')} — DOMAIN_SCHEMA §1.4 minus HUMAN_QUICK_CAPTURE)`,
      })
    }
    return this.#capture(params.source, params, 'captureMechanical')
  }

  /**
   * 共同捕获管线（module header ①–④）。抛出 `InboxError`（预校验 =
   * IN_INPUT; 行落库/形状网 = IN_INPUT/IN_STORE; 号预留失败 = IN_STORE）
   * — 机械入口（WP-6.1/6.2/6.3 缝）的失败必须大声, 不静默丢弃发现。
   */
  #capture(source: InboxSource, params: CaptureParams, operation: string): CaptureResult {
    // ① 全预校验（无写）。
    const payload = params.payload
    if (typeof payload !== 'string' || payload.length === 0) {
      throw new InboxError({ code: 'IN_INPUT', message: `${operation}: payload must be a non-empty string (DOMAIN_SCHEMA §11; frozen schema minLength 1)` })
    }
    const contextRefs = (params.contextRefs ?? []).map((ref, i): TypedRef => assertTypedRef(ref, `${operation}.contextRefs[${i}]`))
    const raw = params.raw

    const createdAt = this.#now()
    let res: Reservation | null = null
    try {
      // ② IN 号预留（§1.1: capture 时分配, PROJECT scope）。
      res = this.#allocator.reserve('INBOX_ITEM', this.#projectId)

      // ③ 行落库（state = CAPTURED 初始态; 整行冻结形状网在 store 内嵌）。
      const record: InboxItemRecord = {
        id: res.id,
        source,
        payload,
        context_refs: contextRefs,
        state: 'CAPTURED',
        created_at: createdAt,
        ...(raw !== undefined ? { raw } : {}),
      }
      this.#store.insertItem(record)

      // ④ commit 号。
      this.#allocator.commit(res)
      return { item: record }
    } catch (cause) {
      if (res !== null) this.#releaseQuietly(res)
      throw this.#wrapCause(cause)
    }
  }

  /* ================================================================== *
   * 状态迁移（§13 — 仅用户, 双面）
   * ================================================================== */

  /**
   * 忽略条目（CAPTURED → DISMISSED 终态; 仅用户显式操作）:
   *   1. actor 运行面断言（类型面 = `UserActorRef` 参数 — 双面）;
   *   2. 条目存在（IN_NOT_FOUND）;
   *   3. §13 合法性门（IN_ILLEGAL_TRANSITION — 含自环/终态出口）;
   *   4. 条件 UPDATE（`AND state = ?`; 0 行 ⇒ IN_CONCURRENT_STATE）。
   */
  dismiss(inboxItemId: string, actor: UserActorRef): DismissResult {
    assertUserActor(actor, 'dismiss')
    const item = this.#requireItem(inboxItemId, 'dismiss')
    assertInboxTransition(inboxItemId, item.state, 'DISMISSED')
    const affected = this.#store.updateState(inboxItemId, 'DISMISSED', null, item.state)
    if (affected === 0) {
      throw this.#concurrent(inboxItemId, item.state, 'dismiss')
    }
    return { inboxItemId, stateFrom: 'CAPTURED', stateTo: 'DISMISSED' }
  }

  /* ================================================================== *
   * 转换流（§28 — 显式确认, 类型面 + 运行面）
   * ================================================================== */

  /**
   * 条目 → 正式对象（§28 转换动作集: Task/NextAction/Intervention/
   * Claim/Fact/ReportingItem/Interaction）— module header 顺序纪律
   * ①–④。
   */
  convert(params: ConvertInboxParams, actor: UserActorRef): ConvertResult {
    // ① 预校验（无写）— 显式确认的类型面 + 运行面。
    assertUserActor(actor, 'convert')
    const inboxItemId = params.inboxItemId
    if (typeof inboxItemId !== 'string' || !IN_ID_PATTERN.test(inboxItemId)) {
      throw new InboxError({ code: 'IN_INPUT', message: `convert: inboxItemId must be a well-formed IN id (got ${JSON.stringify(String(inboxItemId))})` })
    }
    const targetKind = params.targetKind
    if (typeof targetKind !== 'string' || !(CONVERSION_TARGET_KINDS as readonly string[]).includes(targetKind)) {
      throw new InboxError({
        code: 'IN_INPUT',
        message: `convert: targetKind ${JSON.stringify(String(targetKind))} is not a member of the §28 conversion action set (${CONVERSION_TARGET_KINDS.join('|')})`,
      })
    }
    const fields = params.fields
    if (fields === null || typeof fields !== 'object' || fields.kind !== targetKind) {
      throw new InboxError({
        code: 'IN_INPUT',
        message: `convert: fields.kind must pair with targetKind (got fields.kind=${JSON.stringify(fields === null || typeof fields !== 'object' ? fields : fields.kind)} for targetKind=${targetKind})`,
      })
    }
    if (this.#targets === undefined) {
      throw new InboxError({
        code: 'IN_TARGET_NOT_WIRED',
        message: `convert IN -> ${targetKind}: the conversion-target executor is not wired in this composition (IN_TARGET_NOT_WIRED) — the frozen 7-kind action set (§28) has no production executor; production wiring passes the real WP-5.1/5.2/5.3 service closures (WP-6.4 报告「实现要点」§2)`,
      })
    }
    const item = this.#requireItem(inboxItemId, 'convert')
    assertInboxTransition(inboxItemId, item.state, 'CONVERTED')

    const occurredAt = this.#now()

    // ② 执行器创建正式对象（失败 ⇒ 条目保持 CAPTURED, 零状态写）。
    let ref: TypedRef
    try {
      ref = this.#targets.execute(targetKind, fields, item, occurredAt)
    } catch (cause) {
      throw new InboxError({
        code: 'IN_CONVERT_TARGET',
        message: `convert ${inboxItemId} -> ${targetKind} failed at the target executor: ${cause instanceof Error ? cause.message : String(cause)} — the item stays CAPTURED (fix the target, retry)`,
        cause,
      })
    }
    // 执行器契约复验（内部契约 — 大声, 不静默接受畸形 ref）。
    if (
      ref === null ||
      typeof ref !== 'object' ||
      typeof ref.kind !== 'string' ||
      typeof ref.id !== 'string' ||
      ref.id.length === 0 ||
      ref.kind !== targetKind
    ) {
      throw new InboxError({
        code: 'IN_CONVERT_TARGET',
        message: `convert ${inboxItemId} -> ${targetKind}: the executor returned a malformed ref (expected {kind: ${targetKind}, id: <non-empty string>}; got ${JSON.stringify(ref)})`,
      })
    }

    // ③ 条件 UPDATE（乐观并发门）— 状态迁移 + converted_to 唯一写点。
    const affected = this.#store.updateState(inboxItemId, 'CONVERTED', ref, 'CAPTURED')
    if (affected === 0) {
      throw new InboxError({
        code: 'IN_CONCURRENT_STATE',
        message: `convert: inbox item ${inboxItemId} moved concurrently (expected CAPTURED) — the formal object ${targetKind} ${ref.id} WAS created; refetch and reconcile (dismiss the duplicate or re-convert a fresh capture)`,
      })
    }
    const converted = this.#store.getItem(inboxItemId)
    if (converted === null) {
      throw new InboxError({ code: 'IN_NOT_FOUND', message: `convert: item ${inboxItemId} vanished after the state update (store inconsistency — loud, no guess)` })
    }

    // ④ INBOX_CONVERTED 账本行（§12.1 — 可选端口; 缺省 = 不虚构 provenance）。
    let managementActionId: string | null = null
    if (this.#managementActionRecorder !== undefined) {
      const maRes = this.#allocator.reserve('MANAGEMENT_ACTION', this.#projectId)
      try {
        const record: ManagementActionRecord = {
          id: maRes.id,
          action_kind: 'INBOX_CONVERTED',
          actor: toUserActorRef(actor),
          subject_refs: [
            { kind: 'INBOX_ITEM', id: inboxItemId },
            { kind: targetKind, id: ref.id },
          ],
          detail: `inbox ${inboxItemId} (source ${item.source}) converted to ${targetKind} ${ref.id} (user-explicit confirmation, plan §28)`,
          occurred_at: occurredAt, // 单次时钟采样（同 WP-3.5 纪律 — 与执行器同刻）
        }
        this.#managementActionRecorder(record)
        this.#allocator.commit(maRes)
        managementActionId = maRes.id
      } catch (cause) {
        this.#releaseQuietly(maRes)
        throw new InboxError({
          code: 'IN_LEDGER',
          message:
            `convert ${inboxItemId} -> ${targetKind}: the INBOX_CONVERTED ledger row failed — ` +
            `the formal object ${targetKind} ${ref.id} exists and the item is marked CONVERTED, ` +
            `but the provenance row is missing (manual reconciliation): ` +
            (cause instanceof Error ? cause.message : String(cause)),
          cause,
        })
      }
    }

    return { item: converted, convertedTo: ref, managementActionId }
  }

  /* ================================================================== *
   * 高影响升级（§22.3 ESCALATE 档 — 机械判定 → Intervention 联动）
   * ================================================================== */

  /**
   * 机械升级入口（audit/discovery/reconcile 缝 — §22.3「ESCALATE: 高
   * 影响/未知/损失 → Intervention」的落库联动面）:
   *   1. 机械判定（纯 — 三规则; 零语义判断, escalation.ts）;
   *   2. highImpact 且联动端口缺位 ⇒ IN_INPUT（**写前**大声, 零部分状态）;
   *   3. 恒先捕获条目（capture-first — 机械证据 + 升级标记落 raw）;
   *   4. highImpact ⇒ Intervention 创建联动（失败 ⇒ IN_ESCALATION 大声,
   *      条目已捕获保留供人工复核）。
   */
  escalateMechanical(params: EscalateMechanicalParams, actor: MechanicalActorRef): EscalationResult {
    assertMechanicalActor(actor, 'escalateMechanical')
    const evidence = params.evidence
    if (evidence === null || typeof evidence !== 'object') {
      throw new InboxError({ code: 'IN_INPUT', message: 'escalateMechanical: evidence must be an EscalationEvidence object' })
    }
    if (typeof evidence.summary !== 'string' || evidence.summary.length === 0) {
      throw new InboxError({ code: 'IN_INPUT', message: 'escalateMechanical: evidence.summary must be a non-empty string (the capture payload)' })
    }
    const source: MechanicalInboxSource = params.source ?? 'UNCLASSIFIED_AUDIT_FINDING'
    if (typeof source !== 'string' || !(MECHANICAL_INBOX_SOURCES as readonly string[]).includes(source)) {
      throw new InboxError({
        code: 'IN_INPUT',
        message: `escalateMechanical: source ${JSON.stringify(String(source))} is not a member of the mechanical source closed set (${MECHANICAL_INBOX_SOURCES.join('|')})`,
      })
    }

    // 1. 机械判定（纯函数 — 同输入同输出）。
    let assessment: EscalationAssessment
    try {
      assessment = assessEscalation(evidence, { batchThreshold: this.#batchThreshold })
    } catch (cause) {
      throw new InboxError({ code: 'IN_INPUT', message: `escalateMechanical: assessment failed: ${cause instanceof Error ? cause.message : String(cause)}`, cause })
    }

    // 2. highImpact 联动端口预验（写前 — 零部分状态）。
    const creator = this.#mechanicalInterventionCreator
    if (assessment.highImpact && creator === undefined) {
      throw new InboxError({
        code: 'IN_INPUT',
        message: `escalateMechanical: the assessment is HIGH-IMPACT (reasons=[${assessment.reasons.join(', ')}]) but the mechanicalInterventionCreator port is not wired — the ESCALATE ⇒ Intervention linkage (plan §22.3) cannot complete; wire the WP-5.1 createMechanicalIntervention closure (trigger AUDIT_HIGH_IMPACT_DISCREPANCY) and retry`,
      })
    }

    // 3. 恒先捕获（capture-first — 升级也是 Inbox 一条目; 机械标记落 raw）。
    const { item } = this.captureMechanical(
      {
        source,
        payload: evidence.summary,
        contextRefs: evidence.contextRefs ?? [],
        raw: {
          ...evidence,
          escalation: { highImpact: assessment.highImpact, reasons: [...assessment.reasons] },
        },
      },
      actor,
    )

    // 4. highImpact ⇒ Intervention 创建联动（失败 ⇒ IN_ESCALATION 大声,
    //    条目已捕获保留供人工复核 — 文档化残差, 同 WP-4.1a 账本残差口径）。
    if (!assessment.highImpact) {
      return { item, assessment, intervention: null }
    }
    const workstreamIds = evidence.workstreamIds ?? []
    if (creator === undefined) {
      // 不可达: highImpact 已在步骤 2 写前预验（creator 缺位 ⇒ IN_INPUT）;
      // 此处显式保留 — 类型面 + 不变量失败大声（绝不静默降级）。
      throw new InboxError({
        code: 'IN_ESCALATION',
        message: 'escalateMechanical: highImpact assessment but the mechanicalInterventionCreator port is missing (invariant violation — the pre-write check should have fired)',
      })
    }
    let created: InterventionCreatedRef
    try {
      created = creator({
        title: escalationInterventionTitle(workstreamIds),
        detail: buildEscalationDetail(evidence, assessment, this.#batchThreshold),
        workstreamIds: workstreamIds.length > 0 ? workstreamIds : undefined,
        sourceRefs: [{ kind: 'INBOX_ITEM', id: item.id }, ...(evidence.contextRefs ?? [])],
      })
    } catch (cause) {
      throw new InboxError({
        code: 'IN_ESCALATION',
        message:
          `escalateMechanical: item ${item.id} captured; the intervention creation failed: ` +
          `${cause instanceof Error ? cause.message : String(cause)} — the item stays CAPTURED for manual review ` +
          `(create the Intervention through the user face, or dismiss)`,
        cause,
      })
    }
    if (created === null || typeof created !== 'object' || typeof created.id !== 'string' || created.id.length === 0 || typeof created.title !== 'string') {
      throw new InboxError({
        code: 'IN_ESCALATION',
        message: `escalateMechanical: item ${item.id} captured; the intervention creator returned a malformed ref (expected {id, title}; got ${JSON.stringify(created)}) — reconcile manually`,
      })
    }
    return { item, assessment, intervention: { id: created.id, title: created.title } }
  }

  /* ================================================================== *
   * 查询面（无隐藏过滤器 — INV-ATTN-1 同款纪律）
   * ================================================================== */

  /** One record by id（`null` when absent）。 */
  getItem(inboxItemId: string): InboxItemRecord | null {
    return this.#store.getItem(inboxItemId)
  }

  /** List by (state?, source?) — 稳定顺序 created_at ASC, id ASC（全缺省
   *  = 全量）。 */
  listItems(filter?: { readonly state?: InboxItemRecord['state']; readonly source?: InboxSource }): readonly InboxItemRecord[] {
    return this.#store.listItems(filter ?? {})
  }

  /** CAPTURED 全量（GUI 待处理组 — 视图的数据面; 终态组经 listItems 指名）。 */
  listCaptured(): readonly InboxItemRecord[] {
    return this.#store.listItems({ state: 'CAPTURED' })
  }

  /* ---------------------------------------------------------------- */

  #requireItem(inboxItemId: string, operation: string): InboxItemRecord {
    if (typeof inboxItemId !== 'string' || !IN_ID_PATTERN.test(inboxItemId)) {
      throw new InboxError({ code: 'IN_INPUT', message: `${operation}: inboxItemId must be a well-formed IN id (got ${JSON.stringify(String(inboxItemId))})` })
    }
    const item = this.#store.getItem(inboxItemId)
    if (item === null) {
      throw new InboxError({ code: 'IN_NOT_FOUND', message: `inbox item ${inboxItemId} does not exist` })
    }
    return item
  }

  #concurrent(inboxItemId: string, expected: InboxItemRecord['state'], operation: string): InboxError {
    return new InboxError({
      code: 'IN_CONCURRENT_STATE',
      message: `${operation}: inbox item ${inboxItemId} moved concurrently (expected ${expected}) — refetch and retry`,
    })
  }

  #releaseQuietly(res: Reservation): void {
    try {
      this.#allocator.release(res)
    } catch {
      /* 释放失败不掩盖主失败 — 号已烧（§1.1 单调, gap 合法） */
    }
  }

  #wrapCause(cause: unknown): InboxError {
    if (isInboxError(cause)) return cause
    const msg = cause instanceof Error ? cause.message : String(cause)
    return new InboxError({ code: 'IN_STORE', message: msg, cause })
  }
}

/* ------------------------------------------------------------------ *
 * actor 运行面门（类型面的运行半边 — 同 WP-5.1 先例）
 * ------------------------------------------------------------------ */

function assertUserActor(actor: UserActorRef, operation: string): void {
  if (actor === null || typeof actor !== 'object' || actor.kind !== 'USER') {
    throw new InboxError({
      code: 'IN_ACTOR_FORBIDDEN',
      message: `${operation}: requires a USER actor (plan §28: 转换/忽略需要用户显式确认; §13 迁移仅用户 — ARCHITECTURE §6 矩阵 U 栏) — got ${JSON.stringify(actor)}`,
    })
  }
  if (actor.user_id !== undefined && typeof actor.user_id !== 'string') {
    throw new InboxError({ code: 'IN_INPUT', message: `${operation}: actor.user_id must be a string (common.schema.json actorRef)` })
  }
  if (actor.label !== undefined && (typeof actor.label !== 'string' || actor.label.length > 200)) {
    throw new InboxError({ code: 'IN_INPUT', message: `${operation}: actor.label must be a string of ≤200 chars (common.schema.json actorRef)` })
  }
}

function assertMechanicalActor(actor: MechanicalActorRef, operation: string): void {
  if (actor === null || typeof actor !== 'object' || (actor.kind !== 'AGENT' && actor.kind !== 'PLUGIN')) {
    throw new InboxError({
      code: 'IN_ACTOR_FORBIDDEN',
      message: `${operation}: requires a mechanical actor (kind AGENT | PLUGIN — 非 USER; §11 捕获缝的机械面) — got ${JSON.stringify(actor)}`,
    })
  }
}

/** actor 归一（本模块 actor 面 → 冻结 ActorRef 载体 — 账本行用）。 */
function toUserActorRef(actor: UserActorRef): ManagementActionRecord['actor'] {
  return {
    kind: 'USER',
    ...(actor.user_id !== undefined ? { user_id: actor.user_id } : {}),
    ...(actor.label !== undefined ? { label: actor.label } : {}),
  }
}

/** TypedRef 形状断言（冻结 {kind, id} 廉价边界 — 精确指名失败项;
 *  kind 的 objectKind 枚举面与 id 模式面归冻结形状网在 insert 时复验 —
 *  与 WP-5.1 source_refs 断言同款分工）。 */
function assertTypedRef(value: unknown, what: string): TypedRef {
  const kind = value === null || typeof value !== 'object' ? undefined : (value as { kind?: unknown }).kind
  const id = value === null || typeof value !== 'object' ? undefined : (value as { id?: unknown }).id
  if (typeof kind !== 'string' || kind.length === 0 || typeof id !== 'string' || id.length === 0) {
    throw new InboxError({ code: 'IN_INPUT', message: `${what} must be a {kind, id} typedRef (got ${JSON.stringify(value)})` })
  }
  return value as TypedRef
}
