/**
 * WP-5.3 — reporting layer shared types: Interaction / ReportingItem /
 * ScheduledEvent (DOMAIN_SCHEMA §10, operational 真源 = research.sqlite;
 * the frozen row projection is `schema/operational/reporting.schema.json`).
 *
 * Layering (ARCHITECTURE §2.2): this module is pure data + pure guards —
 * zero I/O, zero driver import, zero DSH import (INV-PERM-5). The DB is
 * reached only through the injected `ReportingDb` structural port (the
 * established dual-connection pattern: runbinding / planfork / flooding
 * each carry the same five-method face — re-declared here field-for-field
 * so the reporting layer has no cross-WP dependency; the wiring's
 * `adaptDatabaseSync` satisfies it structurally).
 *
 * 对象纪律 (per 任务边界 + §10/§13):
 *  - 三对象全部 operational, 全部**登记制** (no delete / no content
 *    update — 存储层 trigger 兜底, schema.ts);
 *  - Interaction / ScheduledEvent 无状态列 ⇒ 创建后整体不可变;
 *  - ReportingItem 有状态机 (§13): `OPEN → MATERIAL_READY →
 *    READY_TO_REPORT → REPORTED → FOLLOW_UP_REQUIRED` (+回退边), 状态列
 *    status/reported_at 是派生缓存列 (合法 UPDATE 面), 其余内容列不可变;
 *  - ScheduledEvent **不接外部 Calendar** (§10.3 原文): 只管理用户登记的
 *    事件; V1 无调度器/提醒推送 (到期语义 = 查询面按时间窗过滤,
 *    schedule.ts 头注)。
 */

/* ------------------------------------------------------------------ *
 * Frozen vocabulary (DOMAIN_SCHEMA §1.4 / reporting.schema.json)
 * ------------------------------------------------------------------ */

/** `InteractionKind` (reporting.schema.json $defs/Interaction.kind). */
export const INTERACTION_KINDS = [
  'MEETING',
  'AD_HOC_DISCUSSION',
  'SUPERVISOR_UPDATE',
  'COLLABORATOR_DISCUSSION',
  'EXPERIMENT_SHIFT_HANDOFF',
  'OTHER',
] as const
export type InteractionKind = (typeof INTERACTION_KINDS)[number]

export function isInteractionKind(value: unknown): value is InteractionKind {
  return typeof value === 'string' && (INTERACTION_KINDS as readonly string[]).includes(value)
}

/** `RptStatus` (reporting.schema.json $defs/ReportingItem.status). */
export const RPT_STATUSES = [
  'OPEN',
  'MATERIAL_READY',
  'READY_TO_REPORT',
  'REPORTED',
  'FOLLOW_UP_REQUIRED',
] as const
export type RptStatus = (typeof RPT_STATUSES)[number]

export function isRptStatus(value: unknown): value is RptStatus {
  return typeof value === 'string' && (RPT_STATUSES as readonly string[]).includes(value)
}

/** `SevFreq` (reporting.schema.json $defs/ScheduledEvent.schedule RECURRING). */
export const SEV_FREQS = ['DAILY', 'WEEKLY', 'MONTHLY'] as const
export type SevFreq = (typeof SEV_FREQS)[number]

export function isSevFreq(value: unknown): value is SevFreq {
  return typeof value === 'string' && (SEV_FREQS as readonly string[]).includes(value)
}

/**
 * The frozen `related_refs` kind restriction of ScheduledEvent
 * (reporting.schema.json: 「提醒 research-aware: 显示关联 RPT/IV/TPC」).
 */
export const SEV_RELATED_REF_KINDS = ['REPORTING_ITEM', 'INTERVENTION', 'TOPIC'] as const
export type SevRelatedRefKind = (typeof SEV_RELATED_REF_KINDS)[number]

export function isSevRelatedRefKind(value: unknown): value is SevRelatedRefKind {
  return typeof value === 'string' && (SEV_RELATED_REF_KINDS as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ *
 * Frozen structures (common.schema.json mirrors — the service layer
 * re-declares field-for-field; frozen-shape round-trip is tested against
 * the real frozen schemas via ajv in tests/reporting/pure.test.ts)
 * ------------------------------------------------------------------ */

/** `TypedRef` (common.schema.json#/$defs/typedRef). */
export interface TypedRefJson {
  readonly kind: string
  readonly id: string
}

/** `{kind: ONCE, at}` — one occurrence. */
export interface OnceSchedule {
  readonly kind: 'ONCE'
  readonly at: number
}

/**
 * `{kind: RECURRING, freq, interval?, until?}` — 轻量 recurrence, 非完整
 * RRULE (§10.3). The frozen shape carries NO anchor/phase field (the
 * V1 semantics consequence is documented in schedule.ts).
 */
export interface RecurringSchedule {
  readonly kind: 'RECURRING'
  readonly freq: SevFreq
  readonly interval?: number
  readonly until?: number
}

export type SevSchedule = OnceSchedule | RecurringSchedule

/* ------------------------------------------------------------------ *
 * Records (the frozen reporting.schema.json $defs, verbatim fields)
 * ------------------------------------------------------------------ */

/** `interaction` row (reporting.schema.json $defs/Interaction). */
export interface InteractionRecord {
  readonly id: string
  readonly kind: InteractionKind
  readonly title: string
  /** epoch ms (§1.2). */
  readonly occurred_at: number
  readonly participants?: readonly string[]
  /** Markdown 会议纪要等. */
  readonly notes?: string
  /** WS id[] — 其产生的具体科研变化**分别**进入对应 WS ResearchHistory. */
  readonly related_workstreams?: readonly string[]
}

/** `reporting_item` row (reporting.schema.json $defs/ReportingItem). */
export interface ReportingItemRecord {
  readonly id: string
  /** 「要向谁…汇报」. */
  readonly audience: string
  /** 「…汇报什么」. */
  readonly statement: string
  readonly material_refs?: readonly TypedRefJson[]
  readonly status: RptStatus
  /** SEV id (关联 ScheduledEvent; 写入时存在性校验, §16 规则 3/4). */
  readonly occasion_ref?: string
  /** epoch ms. */
  readonly created_at: number
  /** epoch ms — set on the first REPORTED transition (state-cache). */
  readonly reported_at?: number
}

/** `scheduled_event` row (reporting.schema.json $defs/ScheduledEvent). */
export interface ScheduledEventRecord {
  readonly id: string
  readonly title: string
  readonly schedule: SevSchedule
  /** TypedRef[] — kind ∈ REPORTING_ITEM | INTERVENTION | TOPIC (frozen). */
  readonly related_refs?: readonly TypedRefJson[]
  /** ≥ 0; V1 展示用 (无提醒推送). */
  readonly reminder_lead_ms?: number
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/** Structured failure codes (stable — callers/tests branch on them). */
export type ReportingErrorCode =
  /** Input of one of the three operations violates the frozen shape. */
  | 'RPT_INPUT'
  | 'INT_INPUT'
  | 'SEV_INPUT'
  /** The addressed row does not exist. */
  | 'RPT_NOT_FOUND'
  | 'SEV_NOT_FOUND'
  /** A ReportingItem §13 transition is illegal (INV-TASK-1). */
  | 'RPT_WRONG_STATE'
  /** Driver/SQL failure (cause preserved). */
  | 'REPORTING_STORE'

/** A structured reporting-layer failure (never a raw driver exception). */
export class ReportingError extends Error {
  readonly code: ReportingErrorCode

  constructor(options: { code: ReportingErrorCode; message: string; cause?: unknown }) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ReportingError'
    this.code = options.code
  }
}

/* ------------------------------------------------------------------ *
 * The injected DB surface (the dual-connection pattern's structural
 * port — same five methods as planfork's `PlanForkDb` / flooding's
 * `FloodingDb`; node:sqlite `DatabaseSync` is adapted to it by the
 * wiring's `adaptDatabaseSync` or a test double)
 * ------------------------------------------------------------------ */

/** The value types the driver parameters accept. */
export type SqlParam = string | number | null

export interface ReportingDb {
  /** Execute one or more statements without parameters (idempotent DDL). */
  exec(sql: string): void
  /** Run one parameterized write; returns affected rows. */
  run(sql: string, ...params: SqlParam[]): number
  /** Fetch one row (undefined when absent). */
  get(sql: string, ...params: SqlParam[]): Record<string, unknown> | undefined
  /** Fetch all matching rows. */
  all(sql: string, ...params: SqlParam[]): Record<string, unknown>[]
  /** ONE transaction (BEGIN IMMEDIATE … COMMIT; any throw → ROLLBACK). */
  transaction<T>(work: () => T): T
}
