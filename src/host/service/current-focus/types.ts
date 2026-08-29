/**
 * UI0 (R-01) — Current Focus: type surface.
 *
 * Current Focus is a Workstream-level, USER-owned, single-valued
 * OPERATIONAL pointer into the workstream's CURRENT canonical Plan
 * (one Task / Gate / Milestone item). It is persisted in the operational
 * DB (`current_focus`, three columns ONLY — no title / item kind /
 * project id / execution state / validation state / user note /
 * revision history: all of those belong to their own sources of truth
 * and are read from there — no second truth is built here).
 *
 * Permission semantics (ARCHITECTURE §5.9 discipline, USER lane):
 *   - USER may Set (create-if-absent) / Replace (overwrite an existing
 *     pointer to a new target) / Clear / Get;
 *   - the target MUST be a member of the workstream's current canonical
 *     Plan — anything else is a structured rejection (never silent);
 *   - after a Plan mutation: target still canonical ⇒ the pointer is
 *     retained; target evicted ⇒ the pointer is auto-cleared
 *     (exposed as `revalidate` on the service);
 *   - execution / validation / Run / Blocker / Objective changes NEVER
 *     touch Current Focus — there is no such path (and no hook) in this
 *     module;
 *   - Agent-readable, agent-NOT-writable: the public API is named in
 *     USER semantics (`set` / `clear` / `get` / `revalidate`), and no
 *     agent-facing surface exists in this task (no RPC, no tool —
 *     wiring is a later task).
 *
 * Failure tolerance: the operational DB is a CACHE of a user preference,
 * not a source of truth — if the DB is lost, `get` degrades to
 * `undefined` (no error, no re-derivation).
 *
 * Layer (ARCHITECTURE §2.2): host service layer. ZERO DSH imports
 * (INV-PERM-5); ZERO sqlite imports (the driver is the injected
 * `PlanForkDb` structural port — reuse, never a second port type).
 */

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

/**
 * One persisted Current Focus row (three columns, verbatim mapping of
 * the `current_focus` table — schema.ts).
 *
 *   - `workstreamId` — the workstream the pointer belongs to (table PK,
 *     one row per workstream — the single-valued constraint);
 *   - `planItemId`   — the target item (a Task / Gate / Milestone id of
 *     that workstream's current canonical Plan — membership is checked
 *     at the SERVICE boundary, not the table: the frozen DDL is
 *     three-column verbatim, no CHECK, no join);
 *   - `updatedAt`    — epoch ms of the last Set/Replace (A-3 time
 *     boundary; stamped by the store from its injected clock).
 */
export interface CurrentFocusRecord {
  readonly workstreamId: string
  readonly planItemId: string
  readonly updatedAt: number
}

/**
 * Outcome of `CurrentFocusService.revalidate(workstreamId)` — the
 * post-Plan-mutation reconciliation:
 *
 *   - `absent`  — the workstream has no pointer (nothing to reconcile);
 *   - `retained`— the pointer's target is still a canonical Plan member
 *     (the row is NOT rewritten — `updatedAt` is untouched);
 *   - `cleared` — the target was evicted from the canonical Plan and
 *     the pointer was auto-cleared (the row is deleted).
 */
export type CurrentFocusRevalidateOutcome =
  | { readonly outcome: 'retained' }
  | { readonly outcome: 'cleared' }
  | { readonly outcome: 'absent' }

/* ------------------------------------------------------------------ *
 * Error taxonomy
 * ------------------------------------------------------------------ */

export type CurrentFocusErrorCode =
  /** 模块边界参数畸形（workstreamId / planItemId 形状非法 — 空串、非字符串、
   *  纯空白; 精确指名失败项）. */
  | 'CF_INPUT'
  /** 目标不在该 Workstream 的当前 canonical Plan 中（set 拒绝; message
   *  必须含 workstreamId + planItemId + 「not in the canonical plan」）. */
  | 'CF_NOT_CANONICAL'
  /** `current_focus` 行操作失败（驱动/SQL 包一层, cause 保留; 结构化错误
   *  原样穿透, 不二次包装）. */
  | 'CF_STORE'

export class CurrentFocusError extends Error {
  readonly code: CurrentFocusErrorCode
  constructor(init: { code: CurrentFocusErrorCode; message: string; cause?: unknown }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'CurrentFocusError'
    this.code = init.code
  }
}

export function isCurrentFocusError(error: unknown): error is CurrentFocusError {
  return error instanceof CurrentFocusError
}
