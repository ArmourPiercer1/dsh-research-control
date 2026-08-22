/**
 * WP-2.4 — RUN_* event construction + validation-context assembly.
 *
 * The event surface is the frozen contract (HISTORY_EVENT_CATALOG §5.1;
 * schema/history/history-events.schema.json `RUN_*` branches — the WP-2.2
 * registry compiles the payload validators from exactly those branches,
 * so the payload keys below are the frozen snake_case keys verbatim):
 *
 *   RUN_STARTED    { run_id(新建), task_id?(同 WS), dsh_session_id?,
 *                    intent?, initiated_by: ActorRef }
 *   RUN_FINISHED   { run_id(存在且 RUNNING), outcome_summary? }
 *   RUN_FAILED     { run_id(存在且 RUNNING), error_summary?, failure_kind? }
 *   RUN_CANCELLED  { run_id(存在且 RUNNING), reason?, cancelled_by: ActorRef }
 *
 * Owner rule (catalog §4 owner column): `run 所属 WS` — the run's
 * `workstream_id`. Emitter matrix (catalog §4 E column):
 *   RUN_STARTED U A P / RUN_FINISHED U A P / RUN_FAILED U A P /
 *   RUN_CANCELLED U A — enforced by `validateEvent` (EMITTER_FORBIDDEN),
 *   which the service invokes inside the store write transaction
 *   (AppendEventsOptions.validate, WP-2.1 seam) — the 「registry 校验 +
 *   store append」 closed loop this WP is required to wire.
 *
 * Context assembly (`buildObjectContext`): the 12-map
 * `HistoryObjectContext` the validator consults —
 *   - workstreams / tasks: the injected declarative-side snapshot
 *     (RunBindingExternalState);
 *   - runs: the run table (this WP's own projection), EXCLUDING the run
 *     ids the current batch creates (「新建」 check semantics: a run is
 *     fresh for validation purposes until its RUN_STARTED commits — the
 *     row-side projection may already exist, see service.ts ordering);
 *   - the remaining nine maps: empty (RUN_* events consult only
 *     workstreams/tasks/runs — the validator's per-event switch proves
 *     no other map is touched).
 *
 * Pure builders: no I/O, no clock (occurredAt is a parameter — the
 * service injects its `now`).
 */

import type {
  ActorRef,
  HistoryEventRegistry,
  HistoryObjectContext,
  RunStatus,
} from '../../history/registry/index.js'
import type { HistoryEventInput, HistoryEventRecord, TxScope } from '../../persistence/store/index.js'
import { validateEvent } from '../../history/registry/index.js'
import { RunBindingError } from './types.js'
import type {
  RunBindingExternalState,
  RunLifecycleActorRef,
  RunRecord,
} from './types.js'
import type { RunBindingTables } from './tables.js'

/** Payload schema version — V1: all frozen events carry 1 (INV-HIST-4). */
export const RUN_EVENT_SCHEMA_VERSION = 1

export interface RunStartedEventSpec {
  readonly eventId: string
  readonly runId: string
  readonly workstreamId: string
  readonly taskId?: string
  readonly dshSessionId?: string
  readonly intent?: string
  readonly actor: RunLifecycleActorRef
  /** The event's reality time (the service's `now()`). */
  readonly occurredAt: number
}

/** §5.1 RUN_STARTED — 「一个 Run 开始」(side effect: run 行, RUNNING). */
export function buildRunStartedEvent(spec: RunStartedEventSpec): HistoryEventInput {
  const payload: Record<string, unknown> = {
    run_id: spec.runId,
    initiated_by: spec.actor,
  }
  if (spec.taskId !== undefined) payload.task_id = spec.taskId
  if (spec.dshSessionId !== undefined) payload.dsh_session_id = spec.dshSessionId
  if (spec.intent !== undefined) payload.intent = spec.intent
  return {
    eventId: spec.eventId,
    ownerWorkstreamId: spec.workstreamId,
    eventType: 'RUN_STARTED',
    schemaVersion: RUN_EVENT_SCHEMA_VERSION,
    occurredAt: spec.occurredAt,
    actor: spec.actor,
    ...(spec.dshSessionId === undefined ? {} : { source: { kind: 'DSH_SESSION', session_id: spec.dshSessionId } }),
    payload,
  }
}

export interface RunEndEventSpec {
  readonly eventId: string
  readonly runId: string
  readonly workstreamId: string
  readonly actor: RunLifecycleActorRef
  readonly occurredAt: number
}

/** §5.1 RUN_FINISHED — run must be RUNNING (implicit from). */
export function buildRunFinishedEvent(spec: RunEndEventSpec, outcomeSummary?: string): HistoryEventInput {
  const payload: Record<string, unknown> = { run_id: spec.runId }
  if (outcomeSummary !== undefined) payload.outcome_summary = outcomeSummary
  return endEnvelope(spec, 'RUN_FINISHED', payload)
}

/** §5.1 RUN_FAILED — run must be RUNNING (implicit from). */
export function buildRunFailedEvent(spec: RunEndEventSpec, errorSummary?: string, failureKind?: string): HistoryEventInput {
  const payload: Record<string, unknown> = { run_id: spec.runId }
  if (errorSummary !== undefined) payload.error_summary = errorSummary
  if (failureKind !== undefined) payload.failure_kind = failureKind
  return endEnvelope(spec, 'RUN_FAILED', payload)
}

/** §5.1 RUN_CANCELLED — run must be RUNNING; `cancelled_by` required. */
export function buildRunCancelledEvent(spec: RunEndEventSpec, reason?: string): HistoryEventInput {
  const payload: Record<string, unknown> = {
    run_id: spec.runId,
    cancelled_by: spec.actor,
  }
  if (reason !== undefined) payload.reason = reason
  return endEnvelope(spec, 'RUN_CANCELLED', payload)
}

function endEnvelope(spec: RunEndEventSpec, eventType: 'RUN_FINISHED' | 'RUN_FAILED' | 'RUN_CANCELLED', payload: Record<string, unknown>): HistoryEventInput {
  return {
    eventId: spec.eventId,
    ownerWorkstreamId: spec.workstreamId,
    eventType,
    schemaVersion: RUN_EVENT_SCHEMA_VERSION,
    occurredAt: spec.occurredAt,
    actor: spec.actor,
    payload,
  }
}

/* ------------------------------------------------------------------ *
 * Validation context assembly
 * ------------------------------------------------------------------ */

export interface BuildObjectContextOptions {
  /** Run ids the CURRENT batch creates: excluded from the run map so
   *  their 「新建」 check passes while the row-side projection may
   *  already exist (service.ts ordering note). */
  readonly excludeRunIds?: ReadonlySet<string>
}

/**
 * Assemble the `HistoryObjectContext` for RUN_* validation (module
 * header). `tables` is read through its query face (a plain SELECT — no
 * write path is touched, and this runs INSIDE the store transaction
 * where that distinction matters least; the read sees the committed
 * row state, which is exactly the state the event would mutate).
 */
export function buildObjectContext(
  tables: RunBindingTables,
  external: RunBindingExternalState,
  options: BuildObjectContextOptions = {},
): HistoryObjectContext {
  const exclude = options.excludeRunIds ?? new Set<string>()
  const runs = new Map<string, { readonly workstreamId: string; readonly status: RunStatus }>()
  for (const run of tables.listAllRuns()) {
    if (exclude.has(run.id)) continue
    runs.set(run.id, { workstreamId: run.workstream_id, status: run.status })
  }
  return {
    workstreams: external.workstreams,
    tasks: external.tasks,
    runs,
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
 * The store `validate` hook factory (WP-2.1 seam, AppendEventsOptions):
 * validates EVERY event of the batch against the frozen registry
 * (INV-HIST-4: unknown (eventType, schemaVersion) or payload violation
 * → 拒绝写入) and THROWS a structured `RunBindingError`
 * (RB_EVENT_REJECTED, registry's code+path+message list) on any failure
 * — the store rolls the whole batch back (the thrown error is
 * caller-owned and propagates unchanged, WP-2.1 contract).
 *
 * `registry` unusable (load errors) → RB_REGISTRY_UNUSABLE, fail loud
 * (never append an unvalidated event).
 */
export function makeValidateHook(
  registry: HistoryEventRegistry,
  buildContext: () => HistoryObjectContext,
): (events: readonly HistoryEventRecord[], tx: TxScope) => void {
  return (events): void => {
    if (!registry.isUsable) {
      throw new RunBindingError(
        'RB_REGISTRY_UNUSABLE',
        `the event registry is unusable (load errors: ${registry.loadErrors.map((e) => e.code).join(', ')}); refusing to append an unvalidated event`,
      )
    }
    const ctx = buildContext()
    for (const event of events) {
      const result = validateEvent(registry, event, ctx)
      if (!result.ok) {
        throw new RunBindingError(
          'RB_EVENT_REJECTED',
          `${event.eventType} (${event.eventId}) rejected by the frozen registry: ` +
            result.errors.map((e) => `[${e.code}] ${e.message}`).join('; '),
          { errors: result.errors },
        )
      }
    }
  }
}

/** A RunRecord is a valid RUN_STARTED side-effect row (RUNNING). */
export function isRunningRun(run: RunRecord): boolean {
  return run.status === 'RUNNING'
}
