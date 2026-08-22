/**
 * WP-2.6 — validation-context assembly for the registry gate.
 *
 * `validateEvent(registry, event, ctx)` is a pure function over the
 * injected read-only state snapshot (`HistoryObjectContext`, WP-2.2).
 * This module assembles that snapshot from the two sources the service
 * owns:
 *
 *   - `workstreams` — the injected DECLARATIVE source (the loaded
 *     `.research/` tree; the domain loader's workstream registry). Only the
 *     BOUND workstream is materialized: sessionlink events never reference
 *     another workstream (the owner is the binding by construction), so
 *     over-claiming other rows would be false precision;
 *   - `runs` / `tasks` — the operational `derived_state` cache, read through
 *     the WP-2.3 read-only face (`readDerivedState` opens a `readOnly`
 *     connection — a write through it is structurally impossible).
 *
 * The other eight maps are EMPTY by construction: the two event types
 * sessionlink emits (RUN_STARTED / RUN_FINISHED, catalog §5.1) only touch
 * `ctx.workstreams`, `ctx.runs`, and `ctx.tasks` (the optional `task_id`)
 * inside `validateEvent` — no sessionlink event can reference a
 * claim/fact/artifact/relation/gate/milestone/intervention/edge, so those
 * maps are provably never read for these events.
 *
 * Reading model: the read happens OUTSIDE the append transaction, just
 * before `appendEvents`. Node is single-threaded and the store's append is
 * synchronous, so no event can interleave between the read and the write —
 * the snapshot the in-transaction validate hook sees is EXACTLY the
 * pre-batch state `validateEvent` requires (INV-HIST-5 semantics).
 */

import { readDerivedState, parseStateKey, type DerivedStateMap } from '../../history/replay/index.js'
import type { HistoryObjectContext, RunSnapshot, TaskSnapshot, WorkstreamSnapshot } from '../../history/registry/index.js'
import { isRunStateDoc, SessionLinkError, type RunStateDoc } from './types.js'

/**
 * The declarative workstream source (the loaded `.research/` tree's
 * workstream registry — WP-1.1 loader output in the host wiring). `null` =
 * the workstream is unknown (the service rejects the binding at wire time).
 */
export type WorkstreamContextSource = (workstreamId: string) => WorkstreamSnapshot | null

/** Structural check for a TASK derived-state row (camelCase convention,
 *  same as the RUN row — the row's future owner is the task-service WP). */
function isTaskStateDoc(value: unknown): value is {
  workstreamId: string
  execution: string
  validation: string
  acceptanceCriteria: string[]
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const d = value as Record<string, unknown>
  return (
    typeof d.workstreamId === 'string' &&
    d.workstreamId.length > 0 &&
    typeof d.execution === 'string' &&
    typeof d.validation === 'string' &&
    Array.isArray(d.acceptanceCriteria) &&
    (d.acceptanceCriteria as unknown[]).every((x) => typeof x === 'string')
  )
}

/**
 * Assemble the validation snapshot for one bound workstream over the
 * current operational state.
 *
 * @param store - the operational store (read-only face + file path).
 * @param boundWorkstreamId - the session's bound WS (the only owner).
 * @param workstreams - the declarative workstream source.
 * @throws `SessionLinkError` (`DERIVED_STATE_UNREADABLE`) when the
 *   `derived_state` table cannot be read or a state key is malformed.
 */
export function buildValidationContext(
  store: { readonly path: string },
  boundWorkstreamId: string,
  workstreams: WorkstreamContextSource,
): HistoryObjectContext {
  let derived: DerivedStateMap
  try {
    derived = readDerivedState(store)
  } catch (cause) {
    if (cause instanceof SessionLinkError) throw cause
    throw new SessionLinkError({
      code: 'DERIVED_STATE_UNREADABLE',
      message: `cannot read derived_state for validation: ${(cause as Error).message}`,
      cause,
    })
  }

  const runs = new Map<string, RunSnapshot>()
  const tasks = new Map<string, TaskSnapshot>()
  for (const [key, doc] of derived) {
    let kind: string
    let id: string
    try {
      const parsed = parseStateKey(key)
      kind = parsed.objectKind
      id = parsed.objectId
    } catch {
      // A malformed state key is a corrupt cache row: skip it — the row is
      // unusable for its purpose, and the validator reports the absence
      // (a structured rejection surfaces the drift; guessing is worse).
      continue
    }
    if (kind === 'RUN' && isRunStateDoc(doc)) {
      runs.set(id, { workstreamId: doc.workstreamId, status: doc.status })
    } else if (kind === 'TASK' && isTaskStateDoc(doc)) {
      tasks.set(id, {
        workstreamId: doc.workstreamId,
        execution: doc.execution as TaskSnapshot['execution'],
        validation: doc.validation as TaskSnapshot['validation'],
        acceptanceCriteria: doc.acceptanceCriteria,
      })
    }
  }

  const ws = workstreams(boundWorkstreamId)
  const workstreamMap = new Map<string, WorkstreamSnapshot>()
  if (ws !== null) workstreamMap.set(boundWorkstreamId, ws)

  return {
    workstreams: workstreamMap,
    runs,
    tasks,
    claims: new Map(),
    facts: new Map(),
    artifacts: new Map(),
    relations: new Map(),
    gates: new Map(),
    milestones: new Map(),
    interventions: new Map(),
    topologyEdges: new Map(),
  }
}

/**
 * The current RUN derived-state doc for `runId`, or `null` when absent
 * (never written, or dropped by a rebuild — the run's START fact then comes
 * from the pointer row; see the service). Same read model as
 * {@link buildValidationContext}.
 */
export function readRunStateDoc(store: { readonly path: string }, runId: string): RunStateDoc | null {
  let derived: DerivedStateMap
  try {
    derived = readDerivedState(store)
  } catch (cause) {
    if (cause instanceof SessionLinkError) throw cause
    throw new SessionLinkError({
      code: 'DERIVED_STATE_UNREADABLE',
      message: `cannot read derived_state for run ${JSON.stringify(runId)}: ${(cause as Error).message}`,
      cause,
    })
  }
  const doc = derived.get(`RUN:${runId}`)
  return doc !== undefined && isRunStateDoc(doc) ? doc : null
}
