/**
 * WP-7.3 — `AnalysisRecordService`: AnalysisRecord 显式保存（INV-PERM-3
 * 落地面）+ 查询。
 *
 * ## 保存流（任务目标 2 — 用户显式, 双面门）
 *
 * `saveAsAnalysisRecord(params, actor: UserActorRef)`:
 *   - **类型面（编译期半边）**: actor 参数类型 `UserActorRef` — 非 USER
 *     actor（AGENT/PLUGIN/SYSTEM — 含 Investigator Agent 的任何化身）是
 *     编译错误; `InvestigatorLaunchResult` 本身**不携带**任何落库方法
 *     （WP-7.1: transient 宿主引用, 不虚构持久化）— Agent 侧不存在调用
 *     入口（INV-PERM-3 类型面 + ARCHITECTURE §6 矩阵 INVESTIGATOR 列全 ❌）;
 *   - **运行面（`assertUserActor` — 同 WP-5.1 INV-PERM-4 / WP-6.4 转换面
 *     先例）**: 伪造 actor（cast / 多余键）⇒ AN_ACTOR_FORBIDDEN, **零写入**
 *     （断言先于任何 id 预留 / 行写）;
 *   - 顺序纪律: ① actor 门 + 全预校验（无写）→ ② AN 号 reserve（§1.1
 *     规则 2, PROJECT scope, 「用户保存分析时」分配）→ ③ 行落库（整行过
 *     真实冻结 $defs/AnalysisRecord 形状网, store 内嵌）→ ④ commit 号。
 *     任何失败都 release（§1.1 单调, gap 合法 — 烧号不回收）。
 *
 * 无 History 事件: 冻结目录（HISTORY_EVENT_CATALOG 20 事件）无
 * AnalysisRecord 事件（§12.2 未入史 — 落事件 = 虚构, 同 WP-5.1「状态迁移
 * 无对应事件不落」/ WP-6.4 Inbox 口径）。
 *
 * 无 ManagementAction 账本行: §12.1 `action_kind` 冻结 15 值枚举无
 * AnalysisRecord 成员 — 不虚构 provenance（同 WP-5.5 GAP 纪律; 保存的
 * provenance 即记录自身的 source_ref + dsh_session_id + created_at,
 * 冻结 schema 的形状）。
 *
 * 无 DSH import (INV-PERM-5)。
 */

import type { Reservation } from '../../../shared/ids/index.js'
import { OBJECT_KIND_VALUES, type ObjectKind } from '../../../shared/ids/index.js'
import { AnalysisStore } from './store.js'
import {
  RUN_ID_PATTERN,
  TYPED_REF_ID_PATTERN,
  AnalysisError,
  isAnalysisError,
  type AnalysisListFilter,
  type AnalysisRecordRecord,
  type AnalysisServiceOptions,
  type SaveAnalysisRecordParams,
  type SaveAnalysisRecordResult,
  type UserActorRef,
} from './types.js'

export class AnalysisRecordService {
  readonly #store: AnalysisStore
  readonly #allocator: AnalysisServiceOptions['allocator']
  readonly #projectId: string
  readonly #now: () => number

  constructor(options: AnalysisServiceOptions) {
    if (options.store === undefined || options.store === null || typeof options.store.insertRecord !== 'function') {
      throw new AnalysisError({ code: 'AN_INPUT', message: 'store: an AnalysisStore is required' })
    }
    if (options.allocator === undefined || options.allocator === null || typeof options.allocator.reserve !== 'function') {
      throw new AnalysisError({ code: 'AN_INPUT', message: 'allocator: the shared IdAllocator is required' })
    }
    if (typeof options.projectId !== 'string' || options.projectId.length === 0) {
      throw new AnalysisError({ code: 'AN_INPUT', message: 'projectId must be a non-empty string' })
    }
    this.#store = options.store
    this.#allocator = options.allocator
    this.#projectId = options.projectId
    this.#now = options.now ?? Date.now
  }

  /* ================================================================== *
   * 保存面（用户显式 — INV-PERM-3 唯一落库入口）
   * ================================================================== */

  /**
   * 用户显式保存一条 investigator 分析（module header 顺序纪律 ①–④）。
   *
   * @param actor - 必须是 USER actor（类型面 `UserActorRef` + 运行面
   *   `assertUserActor` 双面; 非 USER ⇒ AN_ACTOR_FORBIDDEN, 零写入）。
   */
  saveAsAnalysisRecord(params: SaveAnalysisRecordParams, actor: UserActorRef): SaveAnalysisRecordResult {
    // ① actor 运行面门 + 全预校验（无写）— 拒绝先于任何 id 预留。
    assertUserActor(actor, 'saveAsAnalysisRecord')
    const sourceRef = assertSourceRef(params.sourceRef, 'saveAsAnalysisRecord.sourceRef')
    const content = assertContent(params.content, 'saveAsAnalysisRecord.content')
    const investigatorRunId = assertOptionalRunId(params.investigatorRunId, 'saveAsAnalysisRecord.investigatorRunId')
    const dshSessionId = assertOptionalSessionId(params.dshSessionId, 'saveAsAnalysisRecord.dshSessionId')

    const createdAt = this.#now()
    let res: Reservation | null = null
    try {
      // ② AN 号预留（§1.1: 「用户保存分析时」分配, PROJECT scope）。
      res = this.#allocator.reserve('ANALYSIS_RECORD', this.#projectId)

      // ③ 行落库（整行冻结形状网在 store 内嵌）。
      const record: AnalysisRecordRecord = {
        id: res.id,
        source_ref: sourceRef,
        content,
        created_at: createdAt,
        ...(investigatorRunId !== undefined ? { investigator_run_id: investigatorRunId } : {}),
        ...(dshSessionId !== undefined ? { dsh_session_id: dshSessionId } : {}),
      }
      this.#store.insertRecord(record)

      // ④ commit 号。
      this.#allocator.commit(res)
      return { record }
    } catch (cause) {
      if (res !== null) this.#releaseQuietly(res)
      throw this.#wrapCause(cause)
    }
  }

  /* ================================================================== *
   * 查询面（无隐藏过滤器 — INV-ATTN-1 同款纪律）
   * ================================================================== */

  /** One record by id（`null` when absent — 缺席是正常结果, 非错误）。 */
  getAnalysisRecord(id: string): AnalysisRecordRecord | null {
    return this.#store.getRecord(id)
  }

  /** List by (sourceKind?, sourceId?) — 稳定顺序 created_at ASC, id ASC
   *  （全缺省 = 全量）。 */
  listAnalysisRecords(filter: AnalysisListFilter = {}): readonly AnalysisRecordRecord[] {
    return this.#store.listRecords(filter)
  }

  /* ---------------------------------------------------------------- */

  #releaseQuietly(res: Reservation): void {
    try {
      this.#allocator.release(res)
    } catch {
      /* 释放失败不掩盖主失败 — 号已烧（§1.1 单调, gap 合法） */
    }
  }

  #wrapCause(cause: unknown): AnalysisError {
    if (isAnalysisError(cause)) return cause
    const msg = cause instanceof Error ? cause.message : String(cause)
    return new AnalysisError({ code: 'AN_STORE', message: msg, cause })
  }
}

/* ------------------------------------------------------------------ *
 * 预校验（无写 — 精确指名失败项; 形状网在 store 落库前复验一遍 —
 * 同 WP-6.4「廉价边界 + 冻结网复验」分工）
 * ------------------------------------------------------------------ */

/**
 * actor 运行面门（类型面的运行半边 — INV-PERM-3「仅用户显式保存才落
 * AnalysisRecord」; 同 WP-5.1 `assertUserActor` / WP-6.4 先例）。
 */
function assertUserActor(actor: UserActorRef, operation: string): void {
  if (actor === null || typeof actor !== 'object' || actor.kind !== 'USER') {
    throw new AnalysisError({
      code: 'AN_ACTOR_FORBIDDEN',
      message:
        `${operation}: requires a USER actor (INV-PERM-3 — investigator 输出默认 transient, ` +
        `仅用户显式保存才落 AnalysisRecord; ARCHITECTURE §6 矩阵: INVESTIGATOR/AGENT 无任何落库路径) — got ${JSON.stringify(actor)}`,
    })
  }
  if (actor.user_id !== undefined && typeof actor.user_id !== 'string') {
    throw new AnalysisError({ code: 'AN_INPUT', message: `${operation}: actor.user_id must be a string (common.schema.json actorRef)` })
  }
  if (actor.label !== undefined && (typeof actor.label !== 'string' || actor.label.length > 200)) {
    throw new AnalysisError({ code: 'AN_INPUT', message: `${operation}: actor.label must be a string of ≤200 chars (common.schema.json actorRef)` })
  }
}

/** source_ref 形状断言（冻结 typedRef: kind ∈ 24 ObjectKind + id 模式）。 */
function assertSourceRef(value: unknown, what: string): { readonly kind: ObjectKind; readonly id: string } {
  if (value === null || typeof value !== 'object') {
    throw new AnalysisError({ code: 'AN_INPUT', message: `${what} must be a {kind, id} typedRef (got ${JSON.stringify(value)})` })
  }
  const kind = (value as { kind?: unknown }).kind
  const id = (value as { id?: unknown }).id
  if (typeof kind !== 'string' || kind.length === 0) {
    throw new AnalysisError({ code: 'AN_INPUT', message: `${what}.kind must be a non-empty string ObjectKind (got ${JSON.stringify(kind)})` })
  }
  if (!(OBJECT_KIND_VALUES as readonly string[]).includes(kind)) {
    throw new AnalysisError({
      code: 'AN_INPUT',
      message: `${what}.kind ${JSON.stringify(kind)} is not a member of the frozen 24-kind ObjectKind registry (DOMAIN_SCHEMA §1.3; §12.2 source_ref: Intervention / Audit finding / Brief 引用经此形状)`,
    })
  }
  if (typeof id !== 'string' || !TYPED_REF_ID_PATTERN.test(id)) {
    throw new AnalysisError({ code: 'AN_INPUT', message: `${what}.id must be a well-formed object id (^[A-Z]+-[1-9][0-9]*$; got ${JSON.stringify(String(id))})` })
  }
  return { kind: kind as ObjectKind, id }
}

/** content 断言（Markdown — 非空, 冻结 schema minLength 1）。 */
function assertContent(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AnalysisError({
      code: 'AN_INPUT',
      message: `${what} must be a non-empty Markdown string (DOMAIN_SCHEMA §12.2 content; frozen schema minLength 1; got ${JSON.stringify(String(value))})`,
    })
  }
  return value
}

/** investigator_run_id 断言（冻结 idRun 模式; 缺席 = 合法）。 */
function assertOptionalRunId(value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value)) {
    throw new AnalysisError({
      code: 'AN_INPUT',
      message: `${what} must be a well-formed R id (^R-[1-9][0-9]*$; common.schema.json idRun; got ${JSON.stringify(String(value))})`,
    })
  }
  return value
}

/** dsh_session_id 断言（自由文本 — 冻结 schema 只钉 string; 缺席 = 合法）。 */
function assertOptionalSessionId(value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new AnalysisError({ code: 'AN_INPUT', message: `${what} must be a non-empty string (got ${JSON.stringify(String(value))})` })
  }
  return value
}
