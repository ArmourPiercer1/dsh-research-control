/**
 * src/host/tools — G2 read-port contract surface (BASELINE_PLAN §2d).
 *
 * The four read tools (`research_context_get` / `research_plan_get` /
 * `research_history_query` / `research_contract_read`) forward to exactly
 * four narrow service ports on `ResearchToolDeps`. This module is the
 * PORTFOLIO CONTRACT: the DTO shapes the composed services return, the
 * structured error they throw, and the shared tool-boundary error
 * mapping (the one piece of behavior, extracted so all four handlers
 * carry the identical carrier discipline — the composition lives in
 * `service/wiring/read-services.ts`, the forwarding in the four tool
 * modules).
 *
 * Discipline (per the plan and the parent ruling):
 *  - SINGLE SUBJECT, FULL RETURN — one binding / one workstream plan /
 *    one page of the event log / one edge's contract. NO invented
 *    pagination or truncation anywhere except the history page cursor,
 *    which is the frozen WP-2.3 `queryEvents` protocol verbatim
 *    (`after_seq` / `before_seq` / `limit`, `next_after_seq` /
 *    `exhausted`). The history default page size (100) and the tool-face
 *    max (1000, refused — never silently truncated) are the §5-Q2
 *    engineering decision, scoped to this tool only.
 *  - READ-ONLY BY CONSTRUCTION — every DTO is a plain frozen-record
 *    projection; the ports expose no write method of any kind
 *    (INV-PERM-2: History mutation/delete, canonical-plan writes,
 *    contract writes have NO agent lane).
 *  - VERBATIM DATA — frozen rows (RunRecord, HistoryEventRecord) flow
 *    through `toToolJsonValue` unchanged; ordered plan items keep the
 *    file order (INV-PLAN-1); declarative titles come from the loader
 *    tree, `null` when a declaration is unresolvable (reported, never
 *    invented).
 */

import type { ReplayOrder } from '../history/replay/index.js'
import type { HistoryEventRecord } from '../persistence/store/index.js'
import type { RunRecord } from '../service/runbinding/index.js'
import { ToolError } from './types.js'

/* ------------------------------------------------------------------ *
 * Tool-boundary error mapping (the four read handlers share it)
 * ------------------------------------------------------------------ */

/** A thrown value carrying a stable machine code (the service error
 *  families the read ports may surface: ToolReadServiceError, ReplayError,
 *  TopologyStoreError, … — duck-typed on `code` so the mapping never
 *  needs per-service imports; a `ToolError` passes through untouched). */
function codedError(cause: unknown): { code: string; message: string } | null {
  if (cause instanceof ToolError) return null // already mapped (TOOL_INPUT etc.)
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code
    if (typeof code === 'string') return { code, message: cause.message }
  }
  return null
}

/**
 * Map any forwarding failure onto the structured tool carrier (the
 * `RB_CHECKPOINT_FOREIGN_RUN` precedent): `ToolError('TOOL_SERVICE')`
 * with `detail.serviceCode` when the cause carries a stable code, bare
 * `TOOL_SERVICE` (message verbatim) otherwise. A `ToolError` (e.g. the
 * already-validated TOOL_INPUT surface) is never re-wrapped.
 */
export function mapReadServiceError(toolName: string, cause: unknown): ToolError {
  if (cause instanceof ToolError) return cause
  const coded = codedError(cause)
  const message = cause instanceof Error ? cause.message : String(cause)
  return new ToolError(
    'TOOL_SERVICE',
    `${toolName}: ${message}`,
    coded === null
      ? { cause, detail: { tool: toolName } }
      : { cause, detail: { tool: toolName, serviceCode: coded.code } },
  )
}

/* ------------------------------------------------------------------ *
 * Structured read-service error
 * ------------------------------------------------------------------ */

/**
 * Stable codes of the composed read services (they ride into
 * `ToolError.detail.serviceCode` at the tool boundary — the same carrier
 * shape as `RB_*`/`CF_*` precedents):
 *  - WS_NOT_FOUND        — the workstream the read names does not exist
 *    (the declarative tree / the live workstream set is the authority);
 *  - EDGE_NOT_FOUND      — the topology edge the contract read names
 *    does not exist (the tree's edges are the snapshot);
 *  - DECLARATIVE_TREE_UNAVAILABLE — a fresh declarative load failed
 *    (fail-loud: the tree IS the truth the join reads).
 */
export type ToolReadServiceErrorCode = 'WS_NOT_FOUND' | 'EDGE_NOT_FOUND' | 'DECLARATIVE_TREE_UNAVAILABLE'

/** One structured read-service failure (the tool maps it to TOOL_SERVICE). */
export class ToolReadServiceError extends Error {
  readonly code: ToolReadServiceErrorCode

  constructor(code: ToolReadServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ToolReadServiceError'
    this.code = code
  }
}

/* ------------------------------------------------------------------ *
 * research_context_get — the calling session's bound research context
 * ------------------------------------------------------------------ */

/** The declarative half of a workstream reference (`null` = unresolvable
 *  declaration — reported as-is, never fabricated). */
export interface ToolWorkstreamRef {
  readonly id: string
  readonly title: string | null
  readonly topic_id: string | null
}

/** The declarative half of a task reference. */
export interface ToolTaskRef {
  readonly id: string
  readonly title: string | null
}

/**
 * The context bound to the calling DSH session (§6.2: a session maps to
 * at most one formal Run — a SINGLE binding, so the full structured
 * subject is returned, no pagination surface). `bound: false` is the
 * honest empty result: a read tool must answer an unbound session
 * without an error (the Investigator preset may call it before any
 * registration exists).
 */
export interface ToolSessionContext {
  readonly session_id: string
  readonly bound: boolean
  /** The frozen run row (DOMAIN_SCHEMA §6.1) when bound — verbatim. */
  readonly run?: RunRecord
  /** The declarative join of `run.workstream_id` (when bound). */
  readonly workstream?: ToolWorkstreamRef
  /** The declarative join of `run.task_id` (when the run carries one). */
  readonly task?: ToolTaskRef
}

/* ------------------------------------------------------------------ *
 * research_plan_get — one workstream's canonical plan
 * ------------------------------------------------------------------ */

/**
 * The canonical plan of ONE workstream (plan.yaml is that workstream's
 * full truth source — `ordered_items` VERBATIM in file order,
 * INV-PLAN-1; presence and §4.4 consistency are reported, never
 * repaired). No pagination, no truncation: the plan is bounded by
 * construction.
 */
export interface ToolWorkstreamPlanView {
  readonly workstream: { readonly id: string; readonly title: string | null }
  readonly topic_id: string | null
  /** `plan.yaml` exists on disk. */
  readonly present: boolean
  /** All §4.4 element checks passed (definitions exist, belong to this WS, no duplicates). */
  readonly consistent: boolean
  /** The first inconsistency (when `consistent` is false). */
  readonly problem?: string
  /** `ordered_items` VERBATIM (INV-PLAN-1); `[]` when absent. */
  readonly ordered_items: readonly string[]
}

/* ------------------------------------------------------------------ *
 * research_history_query — one page of one owner WS's event log
 * ------------------------------------------------------------------ */

/** The normalized query the tool hands the port (`limit` is always
 *  resolved at the tool boundary — default applied, max enforced). */
export interface ToolHistoryQuery {
  readonly workstreamId: string
  readonly order?: ReplayOrder
  readonly afterSeq?: number
  readonly beforeSeq?: number
  readonly limit: number
}

/**
 * One page of the WP-2.3 seq-cursor protocol, verbatim
 * (`nextAfterSeq → next_after_seq`; the protocol is self-terminating and
 * never truncates a window). Rows are the frozen envelope
 * (`HistoryEventRecord`) unchanged.
 */
export interface ToolHistoryPage {
  readonly workstream_id: string
  /** The order the page is presented in (the caller's, default `semantic`). */
  readonly order: ReplayOrder
  /** The page size ACTUALLY applied (the resolved limit — never silent). */
  readonly limit: number
  readonly events: readonly HistoryEventRecord[]
  readonly next_after_seq: number | null
  readonly exhausted: boolean
}

/* ------------------------------------------------------------------ *
 * research_contract_read — one topology edge's merge contract
 * ------------------------------------------------------------------ */

/** The declarative identity of the topology edge the contract belongs to
 *  (§3.1 — the subject's anchor; content ownership is by path, §3.2). */
export interface ToolTopologyEdgeRef {
  readonly id: string
  readonly topic_id: string
  readonly operation: string
  readonly lifecycle: string
  readonly inputs: readonly string[]
  readonly outputs: readonly string[]
  readonly note?: string
}

/**
 * ONE edge's merge contract (single edge → the full structured subject;
 * content is free Markdown stored byte-for-byte, §3.2/INV-GIT-8).
 * `content: null` = the edge exists but has no contract.md yet (the
 * ADJ-7 VALUE-face precedent: absence is data, not an error).
 */
export interface ToolMergeContractView {
  readonly edge: ToolTopologyEdgeRef
  readonly content: string | null
  /** Root-relative POSIX path (`merges/<TE-id>/contract.md`). */
  readonly path: string
}
