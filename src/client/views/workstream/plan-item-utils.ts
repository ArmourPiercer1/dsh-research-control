/**
 * plan-item-utils (UI-5 D4) — pure helpers for the Future Plan strip.
 *
 * Zero React / zero store / zero network: plain functions over wire
 * types (PlanItemDto / the task-execution enum), consumed by the strip
 * zone (row rendering) and the page container (the RMW change build and
 * the kind resolution for the dependency face).
 *
 *  - `planKindOfId` — the kind of a plan item from its canonical id
 *    prefix (T-/G-/M- — the same vocabulary the id regexes pin in
 *    rpc-contracts); the dependency face addresses endpoints by id
 *    only (DependencyEdgeDto carries no kind field);
 *  - `hasExecutionHistory` — whether the task-execution enum has left
 *    PLANNED (the item produced history — the B §19.4 state split);
 *  - `classifyRemoveState` + `REMOVE_STATE_KEY` — the B §19.4
 *    three-state classifier that drives the strip Remove-button label
 *    (the three frozen verbatim copy keys live in i18n/copy.ts).
 */

import type { CopyKey } from '../../i18n/copy.js'
import type { CurrentTaskDto, PlanItemDto } from '../../../shared/rpc-contracts.js'

/** The plan-item kind (the PlanItemDto `kind` field — wire vocabulary,
 *  never translated, D §25). */
export type PlanItemKind = PlanItemDto['kind']

/** The task-execution enum (the CurrentTaskDto `execution` field — the
 *  canonical English wire vocabulary, never translated, D §25). */
export type TaskExecution = CurrentTaskDto['execution']

/**
 * The kind of a plan item from its canonical id prefix.
 *
 * Returns `null` for a foreign id (never throws — view-layer defensive;
 * the wire id regexes make a `null` result unreachable for well-formed
 * plan items).
 */
export function planKindOfId(id: string): PlanItemKind | null {
  if (id.startsWith('T-')) return 'TASK'
  if (id.startsWith('G-')) return 'GATE'
  if (id.startsWith('M-')) return 'MILESTONE'
  return null
}

/**
 * B §19.4 state split: has the item's execution left PLANNED (produced
 * history)? A missing join entry means the task is absent from the
 * Current aggregate (no history — the fresh side).
 */
export function hasExecutionHistory(execution: TaskExecution | null | undefined): boolean {
  return execution === 'ACTIVE' || execution === 'PAUSED' || execution === 'EXECUTED' || execution === 'CANCELLED'
}

/**
 * The three B §19.4 remove states (the strip Remove-button label
 * branches on these; a single `removePlanItem` RPC underlies all three
 * — the kernel keeps the definition, INV-PLAN-9).
 */
export type RemoveState = 'IN_PLAN_WITH_HISTORY' | 'IN_PLAN_FRESH' | 'UNUSED_DEFINITION'

/**
 * Classify a canonical plan item for the three-state Remove face:
 *
 *  - `IN_PLAN_WITH_HISTORY` — a task whose execution left PLANNED:
 *    removal drops the planned record, the execution history remains
 *    (label: "Drop planned item");
 *  - `IN_PLAN_FRESH` — a PLANNED task or any gate/milestone (gates and
 *    milestones have no execution face): a plain plan removal (label:
 *    "Remove from Future Plan");
 *  - `UNUSED_DEFINITION` — a definition with no plan entry: reserved
 *    copy, UNREACHABLE in v1 (no definition-deletion RPC yet — the
 *    state exists in the classifier so the frozen key set is complete;
 *    B §11.8 allows the deferral).
 *
 * `executionById` joins the Current aggregate (the same-page slice) by
 * task id — the ADJ-5 client-side join, no extra fetch.
 */
export function classifyRemoveState(
  item: PlanItemDto,
  executionById: ReadonlyMap<string, TaskExecution>,
): RemoveState {
  if (item.kind === 'TASK' && hasExecutionHistory(executionById.get(item.id))) {
    return 'IN_PLAN_WITH_HISTORY'
  }
  return 'IN_PLAN_FRESH'
}

/** The three B §19.4 verbatim copy keys (frozen — ADJ-10), by state. */
export const REMOVE_STATE_KEY: Readonly<Record<RemoveState, CopyKey>> = {
  IN_PLAN_WITH_HISTORY: 'ws.future.remove.drop',
  IN_PLAN_FRESH: 'ws.future.remove.fromPlan',
  UNUSED_DEFINITION: 'ws.future.remove.deleteUnused',
}

/**
 * The strip create/edit form draft (view state — the page owns it, the
 * zone renders it). ONE object with a string field per B §19 optional
 * field, regardless of kind (the form only renders the active kind's
 * fields; the page submits only the matching carrier). List-valued
 * fields (acceptanceCriteria / deliverables / references) are
 * newline-separated in the draft and split on submit.
 */
export interface PlanItemDraft {
  readonly kind: PlanItemKind
  readonly title: string
  readonly goal: string
  readonly acceptanceCriteria: string
  readonly deliverables: string
  readonly note: string
  readonly criteria: string
  readonly references: string
  readonly statement: string
}

/** The empty draft (a fresh form; the kind is set by the caller). */
export const EMPTY_PLAN_ITEM_DRAFT: PlanItemDraft = {
  kind: 'TASK',
  title: '',
  goal: '',
  acceptanceCriteria: '',
  deliverables: '',
  note: '',
  criteria: '',
  references: '',
  statement: '',
}

/** A fresh create-form draft for the given kind. */
export function newPlanItemDraft(kind: PlanItemKind): PlanItemDraft {
  return { ...EMPTY_PLAN_ITEM_DRAFT, kind }
}

/**
 * Split a newline-separated draft list field into wire array entries
 * (trimmed, empty lines dropped — an all-blank textarea means "no
 * entries").
 */
export function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}
