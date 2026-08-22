/**
 * WP-2.6 — session→History wiring: shared types + error model.
 *
 * Frozen contracts implemented here (read-only):
 *  - DSH_ADAPTER.md §7 (L143-158): Host 面 `session/event` (post-commit
 *    fire-and-forget 广播, durable) + `SessionEventMap`（含 `turn/start|end`、
 *    `agent/*`）；「Run 生命周期 -> RUN_STARTED/RUN_FINISHED 的映射从
 *    `agent/*` live 事件 + turn 事件推导（TC-DSH-004）」；
 *  - HISTORY_EVENT_CATALOG.md §5.1 (RUN_STARTED: run_id 新建 + dsh_session_id +
 *    initiated_by 必填；RUN_FINISHED: run_id 存在且 RUNNING) + §1 信封
 *    (actor/source) + §3.6 (PLUGIN = 机械自动：session 绑定)；
 *  - ARCHITECTURE.md §5.11 INV-DB-2 (不复制 DSH Session raw log；只存
 *    session_id、Run 绑定、事件指针、摘要) + §4 双真源 (operational = SQLite)；
 *  - DOMAIN_SCHEMA.md §6.1 (Run = 一次连续执行尝试；dsh_session_id 指针) /
 *    §1.1 (ID 经 IdAllocator，operational `meta` 表计数) / §1.2 (epoch ms)；
 *  - TEST_MATRIX.md TC-DSH-004 (生命周期入史：只存指针/摘要)。
 *
 * Layer rules (ARCHITECTURE §2.2): service layer — the only layer allowed to
 * write the operational DB. This module imports domain/history/persistence
 * public faces + shared ports ONLY; no `@deepseek-ai/*` (INV-PERM-5), no git.
 */

import type { ActorRefJson } from '../../persistence/store/index.js'

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/** SessionLink structured error codes. */
export type SessionLinkErrorCode =
  /** The workstream id is unknown to the injected declarative source. */
  | 'WORKSTREAM_NOT_FOUND'
  /** `wireSession` on a session already bound to a DIFFERENT workstream. */
  | 'BINDING_CONFLICT'
  /** A stored pointer row is malformed (corruption — fail loud). */
  | 'STATE_CORRUPT'
  /** The registry rejected a constructed event (INV-HIST-4 / catalog §5). */
  | 'VALIDATION_REJECTED'
  /** The store append failed (store's own structured error preserved as cause). */
  | 'STORE_FAILED'
  /** A derived-state row the service needs is unreadable/corrupt. */
  | 'DERIVED_STATE_UNREADABLE'

/** One precisely-located sessionlink failure (WP-2.2/2.5 结构错误惯例). */
export class SessionLinkError extends Error {
  readonly code: SessionLinkErrorCode
  /** Structured detail (e.g. the registry's validation errors). */
  readonly detail?: unknown

  constructor(init: { code: SessionLinkErrorCode; message: string; detail?: unknown; cause?: unknown }) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined)
    this.name = 'SessionLinkError'
    this.code = init.code
    if (init.detail !== undefined) this.detail = init.detail
  }
}

/** Type guard for `SessionLinkError`. */
export function isSessionLinkError(error: unknown): error is SessionLinkError {
  return error instanceof SessionLinkError
}

/* ------------------------------------------------------------------ *
 * The mapping window (constructor input)
 * ------------------------------------------------------------------ */

/**
 * One session event inside a mapping window — the fields the WP-0.4
 * `DshSessionAdapter` port projects (`SessionEventInfo` minus `sessionId`,
 * which is the window key) plus the DSH session-log envelope `time`
 * (epoch ms; the port does NOT project it yet — when absent the mapping
 * falls back to the window's `now`).
 */
export interface SessionWindowEvent {
  /** Monotonic session-local sequence (DSH `SessionEvent.seq`). */
  readonly seq: number
  /** Event type string (DSH `SessionEvent.type`, e.g. `'turn/start'`). */
  readonly type: string
  /** Epoch ms of the session event, when the observer projected it. */
  readonly time?: number
}

/**
 * Input of the pure mapping constructor (`mapSessionWindow`).
 *
 * The window is ONE session's observed event slice. The constructor derives
 * the Run lifecycle from the turn bracketing (DSH_ADAPTER §7 / TC-DSH-004:
 * 「从 `agent/*` live 事件 + turn 事件推导起止」):
 *
 *   - `turn/start` opens a run (a run = one continuous execution attempt,
 *     DOMAIN_SCHEMA §6.1 — in DSH terms one turn: user prompt → agent loop
 *     → turn close);
 *   - `turn/end` closes it;
 *   - a `turn/start` while a run is still open closes the open run first
 *     (late close — the superseding moment is attributed to the new
 *     `turn/start`'s time) and opens the next one (defensive: DSH brackets
 *     turns, a crash can orphan one — `TurnEndReason.interrupted`);
 *   - a `turn/end` with no open run is ignored (orphan edge);
 *   - other event types never map (they carry no Run-lifecycle boundary —
 *     the mapping is deliberately type-only: the WP-0.4 port projects
 *     `type`+`seq` only, and TC-DSH-004 names exactly
 *     RUN_STARTED/RUN_FINISHED — no failure-kind discrimination in V1);
 *   - `disposed` (the `session/disposed` lifecycle edge) closes an open run
 *     (the session is gone; the run cannot continue) with a mechanical
 *     `outcome_summary` marking the forced close.
 *
 * Idempotency (constraint half): every event with `seq <= afterSeq` is
 * REJECTED (re-delivery of an already-consumed edge produces nothing);
 * `lastSeq` in the result advances only past events that produced a Run
 * transition, so the pointer = the last seq that had an effect (a re-read
 * of a no-op event is harmless: it still produces nothing).
 */
export interface SessionWindowInput {
  /** The session the window belongs to (goes into `dsh_session_id`). */
  readonly sessionId: string
  /** The observed events, in delivery order. */
  readonly events: readonly SessionWindowEvent[]
  /** Last consumed session seq (events with `seq <= afterSeq` are rejected). Default 0. */
  readonly afterSeq?: number
  /** The run already open for this session BEFORE the window (resume across
   *  restarts from the pointer row); the window's first `turn/end` finishes
   * THIS run (no new allocation). */
  readonly activeRunId?: string | null
  /** The `session/disposed` lifecycle edge fell in/after this window. */
  readonly disposed?: boolean
  /**
   * Registration time, epoch ms (the caller's clock; the constructor is
   * pure and never calls `Date.now` itself). Fallback `occurredAt` for
   * window events without a projected `time` and for the `disposed` close.
   */
  readonly now: number
  /** Allocate a fresh run id (invoked ONLY for a new RUN_STARTED). Injected
   *  so the constructor stays pure; the service backs it with the
   *  `IdAllocator` (DOMAIN_SCHEMA §1.1 规则 2). */
  readonly allocateRunId: () => string
  /** The binding's task (optional — exploratory runs carry none). */
  readonly taskId?: string
  /** The binding's intent (applies to every RUN_STARTED of this session). */
  readonly intent?: string
}

/**
 * One RUN_* event to be appended (the mapping's output unit). `payload`
 * matches the frozen `schema/history/history-events.schema.json` branch
 * (snake_case); `occurredAt` is epoch ms (DOMAIN_SCHEMA §1.2).
 */
export interface RunEventDraft {
  readonly eventType: 'RUN_STARTED' | 'RUN_FINISHED'
  readonly occurredAt: number
  /** The run this draft transitions (RUN_STARTED: fresh; RUN_FINISHED: existing). */
  readonly runId: string
  /** Frozen-payload branch (RUN_STARTED / RUN_FINISHED). */
  readonly payload: Record<string, unknown>
}

/**
 * The mapping result. `events` in append order; `activeRunId` = the run left
 * open AFTER the window (the service persists both in the pointer row);
 * `lastSeq` = the highest session seq that produced a transition (pointer
 * advance target).
 */
export interface SessionWindowMapping {
  readonly events: readonly RunEventDraft[]
  readonly activeRunId: string | null
  readonly lastSeq: number
}

/* ------------------------------------------------------------------ *
 * Pointer row (INV-DB-2: session_id → Run 绑定 + 事件指针, no raw log)
 * ------------------------------------------------------------------ */

/**
 * The durable pointer row for one wired session — the ONLY session data the
 * plugin stores (INV-DB-2: 「只存 session_id、Run 绑定、事件指针、摘要」).
 * Persisted as one JSON value in the operational `meta` KV
 * (key `sessionlink:pointer:<sessionId>`); the `meta` table survives derived
 * state rebuilds (it is bookkeeping, not the rebuildable cache — §15).
 */
export interface SessionPointer {
  /** The bound workstream (a DSH session maps to at most one WS). */
  readonly workstreamId: string
  /** The binding's intent (carried into every RUN_STARTED payload). */
  readonly intent?: string
  /** The binding's task (carried into every RUN_STARTED payload). */
  readonly taskId?: string
  /**
   * Event-seq pointer: the last DSH session seq that produced a Run
   * transition. Events with `seq <= lastSeq` are rejected on re-delivery.
   */
  readonly lastSeq: number
  /** The run currently open for this session; `null` when none. */
  readonly runId: string | null
  /** `started_at` of `runId` (RUN_STARTED `occurredAt`); the RUN derived
   *  state doc is rebuildable (a WP-2.3 rebuild can drop it), so the
   *  pointer carries the start fact for doc reconstruction at finish. */
  readonly runStartedAt: number | null
}

/** The operational `meta` KV key of one session's pointer row. */
export function pointerKey(sessionId: string): string {
  return `sessionlink:pointer:${sessionId}`
}

/**
 * The RUN derived-state doc (the `derived_state` row for
 * `objectKind='RUN'`). camelCase, structurally extends the WP-2.2
 * `RunSnapshot` (`workstreamId` + `status`) with the operational facts
 * (RUN_STARTED/RUN_FINISHED payload mirror) — the service is the row's
 * owner; `status` is derived from the RUN_* events (DOMAIN_SCHEMA §6.1).
 */
export interface RunStateDoc {
  readonly workstreamId: string
  readonly status: 'RUNNING' | 'FINISHED' | 'FAILED' | 'CANCELLED'
  readonly startedAt: number
  readonly endedAt?: number
  readonly dshSessionId?: string
  readonly taskId?: string
  readonly intent?: string
  readonly initiatedBy: ActorRefJson
  readonly outcomeSummary?: string
}

/** Structural check for a RUN derived-state row (rebuildable cache — a
 *  malformed row is SKIPPED by the context builder, never trusted). */
export function isRunStateDoc(value: unknown): value is RunStateDoc {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const d = value as Record<string, unknown>
  return (
    typeof d.workstreamId === 'string' &&
    d.workstreamId.length > 0 &&
    typeof d.status === 'string' &&
    (d.status === 'RUNNING' || d.status === 'FINISHED' || d.status === 'FAILED' || d.status === 'CANCELLED') &&
    typeof d.startedAt === 'number' &&
    typeof d.initiatedBy === 'object' &&
    d.initiatedBy !== null
  )
}
