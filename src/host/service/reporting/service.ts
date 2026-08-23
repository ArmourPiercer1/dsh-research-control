/**
 * WP-5.3 — `ReportingService`: Interaction / ReportingItem / ScheduledEvent
 * 的 operational service (登记 + 查询 + RPT 状态机; 无 delete / 无内容
 * update — 存储层 trigger 兜底任何连接的 raw 写, schema.ts)。
 *
 * 任务边界落地:
 *  - **三对象 CRUD/状态机按 §10/§13**: Interaction = 登记 + 查询 (无状态
 *    列); ReportingItem = 登记 + 查询 + §13 状态迁移 (乐观条件 UPDATE,
 *    非法转换 service 层拒绝 — INV-TASK-1); ScheduledEvent = 登记 +
 *    查询 (**到期语义 = 查询面按时间窗过滤**, schedule.ts 的 V1 语义 —
 *    无调度器/无提醒推送);
 *  - **registerInteraction 的生产实现挂点**: `registerInteraction` 是
 *    冻结 13-RPC 中唯一的 reporting 写入面 (WP-4.1a 缝; RPC 层负责
 *    related_workstreams 对声明式树的写入时存在性校验 — §16 规则 2,
 *    operational → declarative; 本 service 做形状 + 落库);
 *  - **引用完整性 (§16)**: 写入时存在性校验 (operational → operational
 *    规则 3/4): ReportingItem.occasion_ref 必须指向已存在的 SEV;
 *    ScheduledEvent.related_refs 的 RPT/IV 引用必须存在 (TPC 为声明式
 *    引用, 形状校验 — 树校验归调用方上下文); material_refs = 形状校验
 *    (kind ∈ ObjectKind + id 良构 — 跨表/跨声明式存在性由调用方上下文
 *    负责, V1 收窄, 报告注明);
 *  - **无 registry 事件**: HISTORY_EVENT_CATALOG §4 无 Interaction/
 *    ReportingItem/ScheduledEvent 事件 (任务矩阵按 §4 E 列 — 本层不在
 *    §4 ⇒ 不 append 事件, 与 WP-3.1 PF / WP-3.5 intervention 同口径);
 *    冻结的 ManagementAction action_kind 15 值枚举亦无对应种类 (审计
 *    面 = 不可变行本身)。
 *
 * 存储设计 (同 planfork store 先例): 驱动是注入的 `ReportingDb` 结构
 * 端口 (第二连接双连模式); 构造时 `exec(reportingDdl())` (幂等);
 * id 经共享 `IdAllocator` (INT/RPT/SEV, PROJECT scope, §1.1 规则 2 —
 * 失败 release 留 gap 不重复); 零 DSH import (INV-PERM-5)。
 *
 * Invariant mapping:
 *   - INV-HIST-7 (§15 通则): 无 delete API + 三张表 `_no_delete` trigger;
 *   - 内容不可变: `_no_content_update` trigger (RPT 仅 status/reported_at
 *     状态缓存列可动 — 迁移面 SQL_TRANSITION_REPORTING_ITEM 逐字段);
 *   - INV-TASK-1: `transitionReportingItem` 先纯 guard 后乐观条件 UPDATE
 *     (0 行 ⇒ 重读判别 RPT_NOT_FOUND / RPT_WRONG_STATE);
 *   - §16 规则 3/4: occasion_ref / related_refs 写入时存在性校验。
 *
 * 错误纪律 (同 WP-2.4/WP-3.1): ReportingError 原样穿透 (caller-owned);
 * 驱动/SQL 失败包 REPORTING_STORE (cause 保留)。
 */

import type { IdAllocator, Reservation } from '../../../shared/ids/index.js'
import { OBJECT_KIND_VALUES, parseId } from '../../../shared/ids/index.js'
import {
  INTERACTION_TABLE,
  REPORTING_ITEM_TABLE,
  SCHEDULED_EVENT_TABLE,
  interactionToParams,
  reportingDdl,
  reportingItemToParams,
  rowToInteraction,
  rowToReportingItem,
  rowToScheduledEvent,
  scheduledEventToParams,
  SQL_INSERT_INTERACTION,
  SQL_INSERT_REPORTING_ITEM,
  SQL_INSERT_SCHEDULED_EVENT,
  SQL_SELECT_INTERACTION_BY_ID,
  SQL_SELECT_REPORTING_ITEM_BY_ID,
  SQL_SELECT_SCHEDULED_EVENT_BY_ID,
  SQL_TRANSITION_REPORTING_ITEM,
} from './schema.js'
import { checkRptTransition } from './state-machine.js'
import { eventActiveInWindow, scheduleSortKey, type ScheduleWindow } from './schedule.js'
import {
  isInteractionKind,
  isRptStatus,
  isSevFreq,
  isSevRelatedRefKind,
  ReportingError,
  type InteractionKind,
  type InteractionRecord,
  type ReportingDb,
  type ReportingItemRecord,
  type RptStatus,
  type ScheduledEventRecord,
  type SevSchedule,
  type TypedRefJson,
} from './types.js'

/** `ReportingService` construction options (DI — 同 planfork 先例). */
export interface ReportingServiceOptions {
  /** The injected operational-DB surface (dual-connection pattern). */
  readonly db: ReportingDb
  /** The shared project-scoped id allocator (INT/RPT/SEV families). */
  readonly allocator: IdAllocator
  /** The `PRJ-<n>` the counters are scoped to. */
  readonly projectId: string
  /** Clock (A-3 epoch ms; tests inject). */
  readonly now?: () => number
}

/* ------------------------------------------------------------------ *
 * Parameter faces (frozen shapes — validated at the boundary)
 * ------------------------------------------------------------------ */

/** `registerInteraction` params (the RPC face's decoded args mirror). */
export interface RegisterInteractionParams {
  readonly kind: InteractionKind
  readonly title: string
  /** epoch ms. */
  readonly occurredAt: number
  readonly participants?: readonly string[]
  readonly notes?: string
  /** WS id[] — 存在性由 RPC 层对声明式树校验 (§16 规则 2). */
  readonly relatedWorkstreams?: readonly string[]
}

/** The registration outcome: the row + the registration time (echo). */
export interface RegisterInteractionOutcome {
  readonly record: InteractionRecord
  /** epoch ms — the moment of registration (the wire result's createdAt). */
  readonly createdAt: number
}

/** `createReportingItem` params. */
export interface CreateReportingItemParams {
  readonly audience: string
  readonly statement: string
  readonly materialRefs?: readonly TypedRefJson[]
  /** SEV id — must exist (写入时校验, §16 规则 3/4). */
  readonly occasionRef?: string
}

/** `createScheduledEvent` params. */
export interface CreateScheduledEventParams {
  readonly title: string
  readonly schedule: SevSchedule
  readonly relatedRefs?: readonly TypedRefJson[]
  readonly reminderLeadMs?: number
}

/** Interaction list filters (all optional; 查询面按时间窗过滤). */
export interface InteractionListFilter {
  readonly kind?: InteractionKind
  /** WS id — matches `related_workstreams` containment. */
  readonly workstreamId?: string
  /** epoch ms lower bound (inclusive) on occurred_at. */
  readonly from?: number
  /** epoch ms upper bound (inclusive) on occurred_at. */
  readonly to?: number
}

/** ReportingItem list filters (all optional). */
export interface ReportingItemListFilter {
  readonly status?: RptStatus
  readonly occasionRef?: string
  readonly audience?: string
}

/* ------------------------------------------------------------------ *
 * The service
 * ------------------------------------------------------------------ */

export class ReportingService {
  private readonly db: ReportingDb
  private readonly allocator: IdAllocator
  private readonly projectId: string
  private readonly now: () => number
  private closed = false

  constructor(options: ReportingServiceOptions) {
    this.db = options.db
    this.allocator = options.allocator
    this.projectId = options.projectId
    this.now = options.now ?? Date.now
    // Idempotent DDL (IF NOT EXISTS) — re-applied on every open (先例).
    this.db.exec(reportingDdl())
  }

  /* ---------------------------------------------------------------- *
   * Interaction (登记 + 查询; 无状态列 ⇒ 创建后整体不可变)
   * ---------------------------------------------------------------- */

  /**
   * 登记一个 Interaction (DOMAIN_SCHEMA §10.1; USER 语义 — 冻结 13-RPC
   * 的 registerInteraction 经此落库). 分配 INT id (PROJECT scope) → 单
   * 事务 INSERT → commit; 失败 release (烧号留 gap, §1.1 规则 2)。
   */
  registerInteraction(params: RegisterInteractionParams): RegisterInteractionOutcome {
    this.assertOpen('registerInteraction')
    assertNonEmptyString(params.title, 'title')
    assertEpoch(params.occurredAt, 'occurredAt')
    if (!isInteractionKind(params.kind)) {
      throw new ReportingError({ code: 'INT_INPUT', message: `kind must be one of the 6 frozen InteractionKind values (got ${JSON.stringify(params.kind)})` })
    }
    if (params.participants !== undefined) assertNonEmptyStringArray(params.participants, 'participants')
    if (params.notes !== undefined && typeof params.notes !== 'string') {
      throw new ReportingError({ code: 'INT_INPUT', message: 'notes must be a string (Markdown 会议纪要等)' })
    }
    if (params.relatedWorkstreams !== undefined) {
      assertNonEmptyStringArray(params.relatedWorkstreams, 'relatedWorkstreams')
      for (const ws of params.relatedWorkstreams) {
        assertWorkstreamId(ws, 'relatedWorkstreams')
      }
    }

    const at = this.now()
    const res = this.allocator.reserve('INTERACTION', this.projectId)
    const record: InteractionRecord = {
      id: res.id,
      kind: params.kind,
      title: params.title,
      occurred_at: params.occurredAt,
      ...(params.participants !== undefined ? { participants: [...params.participants] } : {}),
      ...(params.notes !== undefined ? { notes: params.notes } : {}),
      ...(params.relatedWorkstreams !== undefined ? { related_workstreams: [...params.relatedWorkstreams] } : {}),
    }
    try {
      this.db.transaction(() => {
        this.db.run(SQL_INSERT_INTERACTION, ...interactionToParams(record))
      })
    } catch (cause) {
      this.allocator.release(res)
      throw this.wrap('registerInteraction', cause)
    }
    this.allocator.commit(res)
    return { record, createdAt: at }
  }

  /** One record by id (`null` when absent). */
  getInteraction(id: string): InteractionRecord | null {
    this.assertOpen('getInteraction')
    return this.readInteraction(id)
  }

  /**
   * List with filters (kind / workstreamId containment / occurred_at
   * window). Order: occurred_at ASC, id ASC (stable). V1 规模全表过滤
   * (10^4 行, §15 未要求索引)。
   */
  listInteractions(filter: InteractionListFilter = {}): InteractionRecord[] {
    this.assertOpen('listInteractions')
    if (filter.kind !== undefined && !isInteractionKind(filter.kind)) {
      throw new ReportingError({ code: 'INT_INPUT', message: `filter.kind must be a frozen InteractionKind (got ${JSON.stringify(filter.kind)})` })
    }
    if (filter.workstreamId !== undefined) assertWorkstreamId(filter.workstreamId, 'filter.workstreamId')
    if (filter.from !== undefined) assertEpoch(filter.from, 'filter.from')
    if (filter.to !== undefined) assertEpoch(filter.to, 'filter.to')
    if (filter.from !== undefined && filter.to !== undefined && filter.from > filter.to) {
      throw new ReportingError({ code: 'INT_INPUT', message: `filter window is inverted (from ${filter.from} > to ${filter.to})` })
    }

    const clauses: string[] = []
    const params: (string | number)[] = []
    if (filter.kind !== undefined) {
      clauses.push('kind = ?')
      params.push(filter.kind)
    }
    if (filter.workstreamId !== undefined) {
      // 存 JSON 数组; id 已校验为 WS-<digits> (无 LIKE 通配符), 引号
      // 包裹的包含匹配即精确元素匹配。
      clauses.push('related_workstreams LIKE ?')
      params.push(`%"${filter.workstreamId}"%`)
    }
    if (filter.from !== undefined) {
      clauses.push('occurred_at >= ?')
      params.push(filter.from)
    }
    if (filter.to !== undefined) {
      clauses.push('occurred_at <= ?')
      params.push(filter.to)
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    const rows = this.db.all(
      `SELECT * FROM ${INTERACTION_TABLE} ${where} ORDER BY occurred_at ASC, id ASC`,
      ...params,
    )
    return rows.map((r) => rowToInteraction(r))
  }

  /* ---------------------------------------------------------------- *
   * ReportingItem (登记 + 查询 + §13 状态机)
   * ---------------------------------------------------------------- */

  /**
   * 登记一个 ReportingItem (DOMAIN_SCHEMA §10.2 — 「要向谁、何时、
   * 汇报什么」; 不是 Task). 初始状态 OPEN。occasion_ref 写入时存在性
   * 校验 (必须指向已存在的 SEV — §16 规则 3/4); material_refs 形状
   * 校验 (kind ∈ ObjectKind + id 良构 — 跨对象存在性由调用方上下文
   * 负责, V1 收窄)。
   */
  createReportingItem(params: CreateReportingItemParams): ReportingItemRecord {
    this.assertOpen('createReportingItem')
    assertNonEmptyString(params.audience, 'audience')
    assertNonEmptyString(params.statement, 'statement')
    if (params.materialRefs !== undefined) {
      assertTypedRefArray(params.materialRefs, 'materialRefs')
    }
    if (params.occasionRef !== undefined) {
      assertScheduledEventId(params.occasionRef, 'occasionRef')
      if (this.readScheduledEvent(params.occasionRef) === null) {
        throw new ReportingError({
          code: 'RPT_INPUT',
          message: `occasionRef ${JSON.stringify(params.occasionRef)} does not reference an existing scheduled event (DOMAIN_SCHEMA §16 规则 3/4 — 写入新引用失败即拒绝)`,
        })
      }
    }

    const at = this.now()
    const res = this.allocator.reserve('REPORTING_ITEM', this.projectId)
    const record: ReportingItemRecord = {
      id: res.id,
      audience: params.audience,
      statement: params.statement,
      ...(params.materialRefs !== undefined ? { material_refs: params.materialRefs.map((t) => ({ kind: t.kind, id: t.id })) } : {}),
      status: 'OPEN',
      ...(params.occasionRef !== undefined ? { occasion_ref: params.occasionRef } : {}),
      created_at: at,
    }
    try {
      this.db.transaction(() => {
        this.db.run(SQL_INSERT_REPORTING_ITEM, ...reportingItemToParams(record))
      })
    } catch (cause) {
      this.allocator.release(res)
      throw this.wrap('createReportingItem', cause)
    }
    this.allocator.commit(res)
    return record
  }

  /**
   * 执行一次 §13 状态迁移 (非法转换拒绝 — INV-TASK-1)。两步并发门:
   * ① 读行 + 纯 guard (RPT_WRONG_STATE 携带合法集); ② 乐观条件 UPDATE
   * (WHERE status = from) — 0 行 ⇒ 并发迁移已先行, 重读判别
   * RPT_NOT_FOUND / RPT_WRONG_STATE。`reported_at` 语义: 进入 REPORTED
   * 且尚未记录时写入 now (历史事实列 — 后续 FOLLOW_UP_REQUIRED 保留)。
   * Returns the UPDATED record (fresh read after commit)。
   */
  transitionReportingItem(id: string, to: RptStatus): ReportingItemRecord {
    this.assertOpen('transitionReportingItem')
    if (!isRptStatus(to)) {
      throw new ReportingError({ code: 'RPT_INPUT', message: `target status must be one of the 5 frozen RptStatus values (got ${JSON.stringify(to)})` })
    }

    const current = this.readReportingItem(id)
    if (current === null) {
      throw new ReportingError({ code: 'RPT_NOT_FOUND', message: `reporting item ${JSON.stringify(id)} does not exist` })
    }
    checkRptTransition(id, current.status, to)

    const reportedAt =
      to === 'REPORTED' && current.reported_at === undefined ? this.now() : current.reported_at
    try {
      const changes = this.db.run(
        SQL_TRANSITION_REPORTING_ITEM,
        to,
        reportedAt ?? null,
        id,
        current.status,
      )
      if (changes === 0) {
        // 并发迁移已先行 — 重读判别 (行消失 vs 状态已动)。
        const reread = this.readReportingItem(id)
        if (reread === null) {
          throw new ReportingError({ code: 'RPT_NOT_FOUND', message: `reporting item ${JSON.stringify(id)} vanished during transition (no-delete trigger in effect — investigate)` })
        }
        checkRptTransition(id, reread.status, to)
        throw new ReportingError({
          code: 'RPT_WRONG_STATE',
          message: `reporting item ${JSON.stringify(id)} moved concurrently (expected ${current.status}) — refetch and retry`,
        })
      }
    } catch (cause) {
      if (cause instanceof ReportingError) throw cause
      throw this.wrap(`transitionReportingItem(${id})`, cause)
    }
    const updated = this.readReportingItem(id)
    if (updated === null) {
      throw new ReportingError({ code: 'RPT_NOT_FOUND', message: `reporting item ${JSON.stringify(id)} vanished after transition (internal)` })
    }
    return updated
  }

  /** One record by id (`null` when absent). */
  getReportingItem(id: string): ReportingItemRecord | null {
    this.assertOpen('getReportingItem')
    return this.readReportingItem(id)
  }

  /**
   * List with filters (status / occasionRef / audience). Order:
   * created_at ASC, id ASC (stable).
   */
  listReportingItems(filter: ReportingItemListFilter = {}): ReportingItemRecord[] {
    this.assertOpen('listReportingItems')
    if (filter.status !== undefined && !isRptStatus(filter.status)) {
      throw new ReportingError({ code: 'RPT_INPUT', message: `filter.status must be a frozen RptStatus (got ${JSON.stringify(filter.status)})` })
    }
    if (filter.occasionRef !== undefined) assertScheduledEventId(filter.occasionRef, 'filter.occasionRef')
    if (filter.audience !== undefined) assertNonEmptyString(filter.audience, 'filter.audience')

    const clauses: string[] = []
    const params: (string | number)[] = []
    if (filter.status !== undefined) {
      clauses.push('status = ?')
      params.push(filter.status)
    }
    if (filter.occasionRef !== undefined) {
      clauses.push('occasion_ref = ?')
      params.push(filter.occasionRef)
    }
    if (filter.audience !== undefined) {
      clauses.push('audience = ?')
      params.push(filter.audience)
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    const rows = this.db.all(
      `SELECT * FROM ${REPORTING_ITEM_TABLE} ${where} ORDER BY created_at ASC, id ASC`,
      ...params,
    )
    return rows.map((r) => rowToReportingItem(r))
  }

  /* ---------------------------------------------------------------- *
   * ScheduledEvent (登记 + 查询; 到期 = 时间窗过滤 — 无调度器/推送)
   * ---------------------------------------------------------------- */

  /**
   * 登记一个 ScheduledEvent (DOMAIN_SCHEMA §10.3 — **只管理用户登记的
   * 事件; 不接外部 Calendar**). related_refs 的 kind 受限
   * (REPORTING_ITEM | INTERVENTION | TOPIC — 冻结 schema): RPT/IV 引用
   * 写入时存在性校验 (同一 operational DB 面); TOPIC 为声明式引用
   * (形状校验 — 树校验归调用方上下文)。
   */
  createScheduledEvent(params: CreateScheduledEventParams): ScheduledEventRecord {
    this.assertOpen('createScheduledEvent')
    assertNonEmptyString(params.title, 'title')
    this.assertScheduleShape(params.schedule, 'schedule')
    if (params.relatedRefs !== undefined) {
      if (!Array.isArray(params.relatedRefs)) {
        throw new ReportingError({ code: 'SEV_INPUT', message: 'relatedRefs must be a TypedRef array' })
      }
      for (const ref of params.relatedRefs) {
        assertTypedRef(ref, 'relatedRefs')
        if (!isSevRelatedRefKind(ref.kind)) {
          throw new ReportingError({
            code: 'SEV_INPUT',
            message: `relatedRefs kind ${JSON.stringify(ref.kind)} is not one of REPORTING_ITEM | INTERVENTION | TOPIC (reporting.schema.json 冻结限制)`,
          })
        }
        if (ref.kind === 'REPORTING_ITEM') {
          assertReportingItemId(ref.id, 'relatedRefs')
          if (this.readReportingItem(ref.id) === null) {
            throw new ReportingError({ code: 'SEV_INPUT', message: `relatedRefs ${ref.id} does not reference an existing reporting item (DOMAIN_SCHEMA §16 规则 3/4)` })
          }
        }
        if (ref.kind === 'INTERVENTION') {
          if (!/^IV-[1-9][0-9]*$/.test(ref.id)) {
            throw new ReportingError({ code: 'SEV_INPUT', message: `relatedRefs id ${JSON.stringify(ref.id)} is not a well-formed IV id` })
          }
          const row = this.db.get(`SELECT id FROM intervention WHERE id = ?`, ref.id)
          if (row === undefined) {
            throw new ReportingError({ code: 'SEV_INPUT', message: `relatedRefs ${ref.id} does not reference an existing intervention (DOMAIN_SCHEMA §16 规则 3/4)` })
          }
        }
        if (ref.kind === 'TOPIC') {
          if (!/^TPC-[1-9][0-9]*$/.test(ref.id)) {
            throw new ReportingError({ code: 'SEV_INPUT', message: `relatedRefs id ${JSON.stringify(ref.id)} is not a well-formed TPC id` })
          }
        }
      }
    }
    if (params.reminderLeadMs !== undefined) {
      if (typeof params.reminderLeadMs !== 'number' || !Number.isSafeInteger(params.reminderLeadMs) || params.reminderLeadMs < 0) {
        throw new ReportingError({ code: 'SEV_INPUT', message: `reminderLeadMs must be a non-negative safe integer (got ${String(params.reminderLeadMs)})` })
      }
    }

    const res = this.allocator.reserve('SCHEDULED_EVENT', this.projectId)
    const record: ScheduledEventRecord = {
      id: res.id,
      title: params.title,
      schedule: params.schedule,
      ...(params.relatedRefs !== undefined ? { related_refs: params.relatedRefs.map((t) => ({ kind: t.kind, id: t.id })) } : {}),
      ...(params.reminderLeadMs !== undefined ? { reminder_lead_ms: params.reminderLeadMs } : {}),
    }
    try {
      this.db.transaction(() => {
        this.db.run(SQL_INSERT_SCHEDULED_EVENT, ...scheduledEventToParams(record))
      })
    } catch (cause) {
      this.allocator.release(res)
      throw this.wrap('createScheduledEvent', cause)
    }
    this.allocator.commit(res)
    return record
  }

  /** One record by id (`null` when absent). */
  getScheduledEvent(id: string): ScheduledEventRecord | null {
    this.assertOpen('getScheduledEvent')
    return this.readScheduledEvent(id)
  }

  /**
   * List all scheduled events, optionally V1 时间窗过滤 (到期语义,
   * schedule.ts): ONCE → `at` ∈ 窗口; RECURRING → 活跃跨度与窗口相交。
   * Order: scheduleSortKey ASC, id ASC (时间轴; 活跃 recurring 排尾部)。
   */
  listScheduledEvents(window: ScheduleWindow | null = null): ScheduledEventRecord[] {
    this.assertOpen('listScheduledEvents')
    if (window !== null) {
      assertEpoch(window.from, 'window.from')
      if (window.to !== undefined) assertEpoch(window.to, 'window.to')
      if (window.to !== undefined && window.from > window.to) {
        throw new ReportingError({ code: 'SEV_INPUT', message: `window is inverted (from ${window.from} > to ${window.to})` })
      }
    }
    const rows = this.db.all(`SELECT * FROM ${SCHEDULED_EVENT_TABLE} ORDER BY id ASC`)
    const records = rows.map((r) => rowToScheduledEvent(r))
    const filtered = window === null ? records : records.filter((rec) => eventActiveInWindow(rec.schedule, window))
    return filtered.sort((a, b) => {
      const ka = scheduleSortKey(a.schedule)
      const kb = scheduleSortKey(b.schedule)
      if (ka !== kb) return ka - kb
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  private readInteraction(id: string): InteractionRecord | null {
    assertIdInput(id, 'id')
    const row = this.db.get(SQL_SELECT_INTERACTION_BY_ID, id)
    return row === undefined ? null : rowToInteraction(row)
  }

  private readReportingItem(id: string): ReportingItemRecord | null {
    assertIdInput(id, 'id')
    const row = this.db.get(SQL_SELECT_REPORTING_ITEM_BY_ID, id)
    return row === undefined ? null : rowToReportingItem(row)
  }

  private readScheduledEvent(id: string): ScheduledEventRecord | null {
    assertIdInput(id, 'id')
    const row = this.db.get(SQL_SELECT_SCHEDULED_EVENT_BY_ID, id)
    return row === undefined ? null : rowToScheduledEvent(row)
  }

  private assertScheduleShape(schedule: SevSchedule, what: string): void {
    if (schedule === null || typeof schedule !== 'object') {
      throw new ReportingError({ code: 'SEV_INPUT', message: `${what} must be an ONCE or RECURRING schedule object` })
    }
    const kind = schedule.kind
    if (schedule.kind === 'ONCE') {
      assertEpoch(schedule.at, `${what}.at`)
      return
    }
    if (schedule.kind === 'RECURRING') {
      if (!isSevFreq(schedule.freq)) {
        throw new ReportingError({ code: 'SEV_INPUT', message: `${what}.freq must be one of DAILY | WEEKLY | MONTHLY (got ${JSON.stringify(schedule.freq)})` })
      }
      if (schedule.interval !== undefined && (typeof schedule.interval !== 'number' || !Number.isSafeInteger(schedule.interval) || schedule.interval < 1)) {
        throw new ReportingError({ code: 'SEV_INPUT', message: `${what}.interval must be an integer ≥ 1 (got ${String(schedule.interval)})` })
      }
      if (schedule.until !== undefined) assertEpoch(schedule.until, `${what}.until`)
      return
    }
    throw new ReportingError({ code: 'SEV_INPUT', message: `${what}.kind must be 'ONCE' or 'RECURRING' (got ${JSON.stringify(kind)})` })
  }

  private assertOpen(operation: string): void {
    if (this.closed) throw new ReportingError({ code: 'REPORTING_STORE', message: `${operation}: service is closed` })
  }

  private wrap(context: string, cause: unknown): ReportingError {
    const msg = cause instanceof Error ? cause.message : String(cause)
    return new ReportingError({ code: 'REPORTING_STORE', message: `${context}: ${msg}`, cause })
  }
}

/* ------------------------------------------------------------------ *
 * Validation helpers (fail loud at the boundary, frozen shapes)
 * ------------------------------------------------------------------ */

function assertIdInput(id: unknown, what: string): void {
  if (typeof id !== 'string' || id.length === 0) {
    throw new ReportingError({ code: 'RPT_INPUT', message: `${what} must be a non-empty string` })
  }
}

function assertNonEmptyString(value: unknown, what: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ReportingError({ code: 'RPT_INPUT', message: `${what} must be a non-empty string` })
  }
}

function assertNonEmptyStringArray(value: readonly unknown[], what: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || (item as string).length === 0)) {
    throw new ReportingError({ code: 'RPT_INPUT', message: `${what} must be an array of non-empty strings` })
  }
}

function assertEpoch(value: unknown, what: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ReportingError({ code: 'RPT_INPUT', message: `${what} must be a non-negative safe integer epoch ms (got ${String(value)}; §1.2/A-3)` })
  }
}

function assertWorkstreamId(id: string, what: string): void {
  if (!/^WS-[1-9][0-9]*$/.test(id)) {
    throw new ReportingError({ code: 'RPT_INPUT', message: `${what} entry ${JSON.stringify(id)} is not a well-formed WS id (§1.1)` })
  }
}

function assertScheduledEventId(id: string, what: string): void {
  if (!/^SEV-[1-9][0-9]*$/.test(id)) {
    throw new ReportingError({ code: 'RPT_INPUT', message: `${what} ${JSON.stringify(id)} is not a well-formed SEV id (§1.1)` })
  }
}

function assertReportingItemId(id: string, what: string): void {
  if (!/^RPT-[1-9][0-9]*$/.test(id)) {
    throw new ReportingError({ code: 'RPT_INPUT', message: `${what} entry ${JSON.stringify(id)} is not a well-formed RPT id (§1.1)` })
  }
}

/** `TypedRef` 形状 (kind 非空 + id 良构 — 前缀注册表可解析). */
function assertTypedRef(ref: TypedRefJson, what: string): void {
  if (ref === null || typeof ref !== 'object' || typeof ref.kind !== 'string' || ref.kind.length === 0 ||
      typeof ref.id !== 'string' || ref.id.length === 0) {
    throw new ReportingError({ code: 'RPT_INPUT', message: `${what} entries must be TypedRef {kind, id} (frozen shape)` })
  }
  if (parseId(ref.id) === null) {
    throw new ReportingError({ code: 'RPT_INPUT', message: `${what} id ${JSON.stringify(ref.id)} is not well-formed (no registered §1.1 prefix)` })
  }
}

function assertTypedRefArray(refs: readonly TypedRefJson[], what: string): void {
  if (!Array.isArray(refs)) {
    throw new ReportingError({ code: 'RPT_INPUT', message: `${what} must be a TypedRef array` })
  }
  for (const ref of refs) {
    assertTypedRef(ref, what)
    if (!(OBJECT_KIND_VALUES as readonly string[]).includes(ref.kind)) {
      throw new ReportingError({ code: 'RPT_INPUT', message: `${what} kind ${JSON.stringify(ref.kind)} is not a §1.3 ObjectKind` })
    }
  }
}
