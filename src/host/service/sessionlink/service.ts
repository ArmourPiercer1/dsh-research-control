/**
 * WP-2.6 — `SessionLinkService`: DSH session → ResearchHistory wiring.
 *
 * Subscribes to the injected WP-0.4 `DshSessionAdapter` event stream (host
 * `session/event` post-commit feed + `session/created|disposed` lifecycle
 * edges), maps the session Run lifecycle to RUN_STARTED / RUN_FINISHED
 * (DSH_ADAPTER §7 / TC-DSH-004 — the pure constructor is `mapSessionWindow`),
 * validates the constructed events through the WP-2.2 registry and appends
 * them to the WP-2.1 operational store — with the RUN derived-state rows in
 * the SAME transaction (catalog §6 / §15: 与事件 append 同事务写入).
 *
 * INV-DB-2 (ARCHITECTURE §5.11): the session's raw log is NEVER copied. The
 * plugin stores, per wired session, exactly the pointer row
 * (`SessionPointer` in the `meta` KV: bound workstream, open-run binding +
 * started_at, event-seq pointer) and, per run, the RUN_* events whose
 * payloads carry only the session POINTER (`dsh_session_id`), the
 * `source: {kind: 'DSH_SESSION'}` envelope ref, and the mechanical
 * `outcome_summary` close notes (「只存 session_id、Run 绑定、事件指针、摘要」).
 *
 * Idempotency — the two halves the brief names:
 *   - CONSTRAINT: the pointer row's `lastSeq` gate rejects every re-delivery
 *     of an already-consumed edge (`seq <= lastSeq`); a second `wireSession`
 *     for the same session with the SAME binding is a no-op returning the
 *     stored pointer (it persists nothing new and produces NO events);
 *   - REJECTION PATH: `wireSession` of a session already bound to a
 *     DIFFERENT workstream throws `BINDING_CONFLICT`; a constructed event
 *     the registry rejects (e.g. a RUN_FINISHED for a run the derived state
 *     does not hold — `OBJECT_NOT_FOUND`) throws `VALIDATION_REJECTED` with
 *     the structured errors, the whole batch rolls back, and every reserved
 *     id is released (burned, never reused — DOMAIN_SCHEMA §1.1).
 *
 * id reservation protocol (WP-1.6 reserve/commit/release): run ids are
 * reserved INSIDE `mapSessionWindow` (its `allocateRunId` seam), event ids
 * just before the append; a rejected/failed batch RELEASES every
 * reservation (a permanent gap — monotonicity + no-reuse, §1.1) and
 * propagates the structured error. A crash between reserve and append burns
 * the ids the same way; uniqueness holds by construction.
 *
 * Crash ordering (documented, self-healing): `appendEvents` (event rows +
 * RUN derived rows, one atomic transaction) happens BEFORE the pointer
 * `meta.set`. A crash in between leaves the event in the log (append-only —
 * it happened) with a lagging pointer; on re-wire the lagging pointer
 * re-derives at most one extra finish for an already-finished run, which
 * the registry rejects (WRONG_STATE) — a structured rejection, never a
 * duplicate event in the log.
 *
 * Run = one turn (DOMAIN_SCHEMA §6.1 「一次连续执行尝试」; a DSH turn = user
 * prompt → agent loop → turn close). A session may therefore own N runs
 * (Task : Run = 1 : N applies across the turns of one session).
 */

import { validateEvent, type HistoryEventRegistry } from '../../history/registry/index.js'
import type { DerivedStatePatch, HistoryEventInput, ResearchStore } from '../../persistence/store/index.js'
import {
  pointerKey,
  type RunEventDraft,
  type RunStateDoc,
  type SessionPointer,
  SessionLinkError,
  type SessionWindowMapping,
} from './types.js'
import { mapSessionWindow } from './map.js'
import { decodePointer, encodePointer } from './pointer.js'
import { buildValidationContext, readRunStateDoc, type WorkstreamContextSource } from './context.js'
import type { IdAllocator, Reservation } from '../../../shared/ids/index.js'
import type { DshSessionAdapter } from '../../../shared/host-adapter-ports.js'

/** A session → workstream binding (the runbinding WP owns the DISCOVERY of
 *  these; sessionlink only consumes explicit bindings — DSH_ADAPTER §13-U9). */
export interface WireBinding {
  /** The workstream the session's runs belong to (must be known to the
   *  declarative source; a Project/Topic-level session cannot become a
   *  formal Run — DOMAIN_SCHEMA §6.1). */
  readonly workstreamId: string
  /** Carried into every RUN_STARTED payload (`intent`). */
  readonly intent?: string
  /** Carried into every RUN_STARTED payload (`task_id`). */
  readonly taskId?: string
}

/** `wireSession` result. `already-wired` = the idempotent re-wire path:
 *  the stored pointer is returned, nothing new is persisted, no events. */
export type WireResult =
  | { readonly status: 'wired' }
  | { readonly status: 'already-wired'; readonly pointer: SessionPointer }

export interface SessionLinkServiceOptions {
  /** The operational store (append + `meta` KV + `path`). */
  readonly store: ResearchStore
  /** The loaded typed event registry (WP-2.2; the validation gate). */
  readonly registry: HistoryEventRegistry
  /** The WP-0.4 session adapter port (the event stream to subscribe). */
  readonly adapter: DshSessionAdapter
  /** The project id allocator (RUN + HISTORY_EVENT counters, §1.1 规则 2). */
  readonly ids: IdAllocator
  /** The project scope for id allocation (a well-formed `PRJ` id). */
  readonly projectId: string
  /** The declarative workstream source (loaded `.research/` tree). */
  readonly workstreams: WorkstreamContextSource
  /** The registration clock (default `Date.now`). */
  readonly now?: () => number
}

/** The `label` of the PLUGIN actor that registers the events mechanically. */
export const ACTOR_LABEL = 'sessionlink'

export class SessionLinkService {
  readonly #store: ResearchStore
  readonly #registry: HistoryEventRegistry
  readonly #adapter: DshSessionAdapter
  readonly #ids: IdAllocator
  readonly #projectId: string
  readonly #workstreams: WorkstreamContextSource
  readonly #now: () => number

  /** In-memory mirror of the pointer rows (the `meta` rows are the truth;
   *  the mirror keeps the per-event hot path off the KV). */
  readonly #pointers = new Map<string, SessionPointer>()

  constructor(options: SessionLinkServiceOptions) {
    this.#store = options.store
    this.#registry = options.registry
    this.#adapter = options.adapter
    this.#ids = options.ids
    this.#projectId = options.projectId
    this.#workstreams = options.workstreams
    this.#now = options.now ?? Date.now
  }

  /* ---------------------------------------------------------------- *
   * Wiring
   * ---------------------------------------------------------------- */

  /**
   * Wire one session to a workstream (explicit binding — the discovery/BIND
   * flow is the runbinding WP's; this is the pointer-row + subscription
   * half). Idempotent for the SAME binding (returns the stored pointer,
   * persists nothing new, produces no events); a conflicting binding
   * (different workstream) is REJECTED (`BINDING_CONFLICT`); an unknown
   * workstream is rejected (`WORKSTREAM_NOT_FOUND`).
   */
  wireSession(sessionId: string, binding: WireBinding): WireResult {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new TypeError('wireSession: sessionId must be a non-empty string')
    }
    const ws = this.#workstreams(binding.workstreamId)
    if (ws === null) {
      throw new SessionLinkError({
        code: 'WORKSTREAM_NOT_FOUND',
        message:
          `cannot wire session ${JSON.stringify(sessionId)}: workstream ${JSON.stringify(binding.workstreamId)} ` +
          'is unknown to the declarative source',
      })
    }

    const key = pointerKey(sessionId)
    const existingRaw = this.#store.meta().get(key)
    if (existingRaw !== null) {
      let existing = decodePointer(existingRaw, sessionId)
      // Resume reconciliation (restart / crash window): the pointer is a
      // CACHE of the event log — the log is the durable truth. If the row
      // and the log disagree on the open run (the documented crash window:
      // the append landed, the pointer `meta.set` did not), adopt the LOG:
      // a run started-but-unfinished in the log must stay "open" so its
      // finish can still be derived, and a finished run must not be
      // re-finished. `lastSeq` is deliberately left as stored (it errs LOW
      // — a re-processed edge re-derives at most the documented,
      // duplicate-free recovery pair; see the module doc).
      const reconciled = this.#reconcileFromLog(sessionId, existing)
      if (reconciled !== null) {
        existing = reconciled
        this.#store.meta().set(key, encodePointer(existing))
      }
      if (existing.workstreamId !== binding.workstreamId) {
        throw new SessionLinkError({
          code: 'BINDING_CONFLICT',
          message:
            `cannot wire session ${JSON.stringify(sessionId)}: already bound to workstream ` +
            `${JSON.stringify(existing.workstreamId)} (requested ${JSON.stringify(binding.workstreamId)}) — ` +
            'a DSH session maps to at most one workstream (INV-DB-2 binding)',
          detail: { existing, requested: binding },
        })
      }
      this.#pointers.set(sessionId, existing)
      return { status: 'already-wired', pointer: existing }
    }

    const pointer: SessionPointer = {
      workstreamId: binding.workstreamId,
      ...(binding.intent !== undefined ? { intent: binding.intent } : {}),
      ...(binding.taskId !== undefined ? { taskId: binding.taskId } : {}),
      lastSeq: 0,
      runId: null,
      runStartedAt: null,
    }
    this.#store.meta().set(key, encodePointer(pointer))
    this.#pointers.set(sessionId, pointer)
    return { status: 'wired' }
  }

  /**
   * Detach: stop processing events for the session (in-memory only). The
   * pointer row is KEPT (durable binding + resume facts) — an open run stays
   * open in History and can be finished on re-wire. `null` when the session
   * was not wired.
   */
  detachSession(sessionId: string): SessionPointer | null {
    const pointer = this.#pointers.get(sessionId) ?? null
    this.#pointers.delete(sessionId)
    return pointer
  }

  /** The durable pointer row for a session (re-read from `meta`), or `null`. */
  pointerOf(sessionId: string): SessionPointer | null {
    const raw = this.#store.meta().get(pointerKey(sessionId))
    if (raw === null) return null
    return decodePointer(raw, sessionId)
  }

  /**
   * Resume reconciliation (module doc, crash ordering): re-derive the open
   * run for this session from the BOUND WS's event log (audit order) and
   * compare with the pointer row.
   *
   *   - log says a run is open, pointer says none (or a different one) →
   *     adopt the log's run (the append landed; the pointer `meta.set` did
   *     not — or a previous recovery pair ran);
   *   - log says the pointer's run is finished, pointer says open → adopt
   *     the log (the finish landed; the pointer lagged);
   *   - agreement → `null` (no write).
   *
   * Only the `runId`/`runStartedAt` pair moves; `lastSeq` stays as stored
   * (LOW-err: a re-processed edge can re-derive at most the documented
   * recovery pair — never a duplicate log row, because every derived event
   * still passes the registry state gate).
   */
  #reconcileFromLog(sessionId: string, pointer: SessionPointer): SessionPointer | null {
    const runs = new Map<string, { startedAt: number; finished: boolean }>()
    for (const event of this.#store.listRange(pointer.workstreamId, 1)) {
      const payload = event.payload as Record<string, unknown>
      if (event.eventType === 'RUN_STARTED' && payload.dsh_session_id === sessionId) {
        const runId = typeof payload.run_id === 'string' ? payload.run_id : null
        if (runId !== null) runs.set(runId, { startedAt: event.occurredAt, finished: false })
      } else if (event.eventType === 'RUN_FINISHED') {
        const runId = typeof payload.run_id === 'string' ? payload.run_id : null
        if (runId !== null) {
          const run = runs.get(runId)
          if (run !== undefined) run.finished = true
        }
      }
    }
    let openId: string | null = null
    let openStartedAt = 0
    for (const [runId, run] of runs) {
      if (!run.finished) {
        openId = runId
        openStartedAt = run.startedAt
      }
    }
    if (pointer.runId === openId) return null
    return {
      workstreamId: pointer.workstreamId,
      ...(pointer.intent !== undefined ? { intent: pointer.intent } : {}),
      ...(pointer.taskId !== undefined ? { taskId: pointer.taskId } : {}),
      lastSeq: pointer.lastSeq,
      runId: openId,
      runStartedAt: openId === null ? null : openStartedAt,
    }
  }

  /* ---------------------------------------------------------------- *
   * The event stream
   * ---------------------------------------------------------------- */

  /**
   * Subscribe to the adapter's session event stream (the WP-0.4 port:
   * `session/event` feed + `session/created|disposed` lifecycle edges).
   * Unwired sessions are ignored (the runbinding WP's concern).
   *
   * @returns a single disposer (unsubscribes BOTH subscriptions — cordis
   *   convention: registration is the effect, the disposer is the rollback).
   */
  start(): () => void {
    const offEvents = this.#adapter.onSessionEvent((info) => this.#consumeEvent(info.sessionId, info.type, info.seq))
    const offLifecycle = this.#adapter.observeSessionLifecycle((edge) => {
      if (edge.kind === 'disposed') this.#consumeDisposed(edge.sessionId)
      // `created`: wiring is explicit — nothing to do (runbinding territory).
    })
    return () => {
      offEvents()
      offLifecycle()
    }
  }

  /**
   * The per-event hot path (also the seam tests drive directly): consume
   * one observed `session/event` of a wired session. No-op for unwired
   * sessions and for rejected re-deliveries (`seq <= lastSeq`).
   */
  #consumeEvent(sessionId: string, type: string, seq: number): void {
    const pointer = this.#pointers.get(sessionId)
    if (pointer === undefined) return // not wired — ignore (no event, no error)
    const runReservations: Reservation[] = []
    const mapping = mapSessionWindow({
      sessionId,
      events: [{ seq, type }],
      afterSeq: pointer.lastSeq,
      activeRunId: pointer.runId,
      taskId: pointer.taskId,
      intent: pointer.intent,
      now: this.#now(),
      allocateRunId: () => {
        const r = this.#ids.reserve('RUN', this.#projectId)
        runReservations.push(r)
        return r.id
      },
    })
    if (mapping === null) return
    this.#commit(sessionId, pointer, mapping, runReservations)
  }

  /** The `session/disposed` lifecycle edge (no seq): close an open run. */
  #consumeDisposed(sessionId: string): void {
    const pointer = this.#pointers.get(sessionId)
    if (pointer === undefined || pointer.runId === null) return
    const runReservations: Reservation[] = []
    const mapping = mapSessionWindow({
      sessionId,
      events: [],
      afterSeq: pointer.lastSeq,
      activeRunId: pointer.runId,
      taskId: pointer.taskId,
      intent: pointer.intent,
      now: this.#now(),
      disposed: true,
      allocateRunId: () => {
        const r = this.#ids.reserve('RUN', this.#projectId)
        runReservations.push(r)
        return r.id
      },
    })
    if (mapping === null) return
    this.#commit(sessionId, pointer, mapping, runReservations)
  }

  /* ---------------------------------------------------------------- *
   * The commit path (validate → append → pointer)
   * ---------------------------------------------------------------- */

  /**
   * Commit one mapping: reserve event ids → build envelope + RUN
   * derived-state patches → `appendEvents` (registry validation INSIDE the
   * write transaction; throw ⇒ the whole batch rolls back) → persist the
   * pointer AFTER the append (documented crash ordering, module doc).
   * Any failure releases every reserved id (burned gap, §1.1) and
   * propagates a `SessionLinkError`.
   */
  #commit(
    sessionId: string,
    pointer: SessionPointer,
    mapping: SessionWindowMapping,
    runReservations: readonly Reservation[],
  ): void {
    const hReservations: Reservation[] = mapping.events.map(
      () => this.#ids.reserve('HISTORY_EVENT', this.#projectId),
    )

    const ctx = buildValidationContext(this.#store, pointer.workstreamId, this.#workstreams)
    const events: HistoryEventInput[] = mapping.events.map((d, i) => ({
      eventId: hReservations[i].id,
      ownerWorkstreamId: pointer.workstreamId,
      eventType: d.eventType,
      schemaVersion: 1,
      occurredAt: d.occurredAt,
      actor: { kind: 'PLUGIN', session_id: sessionId, label: ACTOR_LABEL },
      source: { kind: 'DSH_SESSION', session_id: sessionId },
      payload: d.payload,
    }))
    const derivedState = mapping.events.map((d) => this.#runDocPatch(sessionId, pointer, d))

    try {
      this.#store.appendEvents(events, {
        derivedState,
        validate: (finalized) => {
          for (const event of finalized) {
            const verdict = validateEvent(this.#registry, event, ctx)
            if (!verdict.ok) {
              throw new SessionLinkError({
                code: 'VALIDATION_REJECTED',
                message:
                  `registry rejected ${event.eventType} (${event.eventId}) of session ${JSON.stringify(sessionId)}: ` +
                  verdict.errors.map((e) => `${e.code}@${e.path ?? '/'}: ${e.message}`).join('; '),
                detail: verdict.errors,
              })
            }
          }
        },
      })
    } catch (cause) {
      for (const r of hReservations) this.#ids.release(r)
      for (const r of runReservations) this.#ids.release(r)
      if (cause instanceof SessionLinkError) throw cause
      throw new SessionLinkError({
        code: 'STORE_FAILED',
        message: `store append for session ${JSON.stringify(sessionId)} failed: ${(cause as Error).message}`,
        cause,
      })
    }

    // Success: commit the ids, then advance the pointer (AFTER the append).
    for (const r of hReservations) this.#ids.commit(r)
    for (const r of runReservations) this.#ids.commit(r)
    const next: SessionPointer = {
      workstreamId: pointer.workstreamId,
      ...(pointer.intent !== undefined ? { intent: pointer.intent } : {}),
      ...(pointer.taskId !== undefined ? { taskId: pointer.taskId } : {}),
      lastSeq: mapping.lastSeq,
      runId: mapping.activeRunId,
      runStartedAt: mapping.activeRunId === null ? null : startedAtOf(mapping, sessionId),
    }
    this.#store.meta().set(pointerKey(sessionId), encodePointer(next))
    this.#pointers.set(sessionId, next)
  }

  /**
   * The RUN derived-state patch for one draft:
   *  - RUN_STARTED → the full doc (fresh run row, status RUNNING);
   *  - RUN_FINISHED → the PRE-batch doc (the same read-only derived-state
   *    snapshot the validation ctx used) + status FINISHED / endedAt /
   *    optional outcomeSummary; when the doc is ABSENT (a rebuild dropped
   *    the rebuildable cache — TC-HIST-006 semantics), reconstruct it from
   *    the pointer's durable start facts (INV-DB-2 「Run 绑定」).
   */
  #runDocPatch(sessionId: string, pointer: SessionPointer, draft: RunEventDraft): DerivedStatePatch {
    if (draft.eventType === 'RUN_STARTED') {
      const doc: RunStateDoc = {
        workstreamId: pointer.workstreamId,
        status: 'RUNNING',
        startedAt: draft.occurredAt,
        dshSessionId: sessionId,
        ...(pointer.taskId !== undefined ? { taskId: pointer.taskId } : {}),
        ...(pointer.intent !== undefined ? { intent: pointer.intent } : {}),
        initiatedBy: { kind: 'USER', session_id: sessionId },
      }
      return { objectKind: 'RUN', objectId: draft.runId, state: doc }
    }
    const outcome = typeof draft.payload.outcome_summary === 'string' ? draft.payload.outcome_summary : undefined
    const prev = readRunStateDoc(this.#store, draft.runId)
    const base: RunStateDoc =
      prev !== null
        ? prev
        : {
            workstreamId: pointer.workstreamId,
            status: 'RUNNING',
            startedAt: pointer.runStartedAt ?? 0,
            dshSessionId: sessionId,
            ...(pointer.taskId !== undefined ? { taskId: pointer.taskId } : {}),
            ...(pointer.intent !== undefined ? { intent: pointer.intent } : {}),
            initiatedBy: { kind: 'USER', session_id: sessionId },
          }
    const doc: RunStateDoc = {
      ...base,
      status: 'FINISHED',
      endedAt: draft.occurredAt,
      ...(outcome !== undefined ? { outcomeSummary: outcome } : {}),
    }
    return { objectKind: 'RUN', objectId: draft.runId, state: doc }
  }
}

/** The `started_at` of the run left open after the mapping (the pointer's
 *  durable start fact): the last RUN_STARTED draft's `occurredAt`. */
function startedAtOf(mapping: SessionWindowMapping, sessionId: string): number {
  for (let i = mapping.events.length - 1; i >= 0; i -= 1) {
    const d = mapping.events[i]
    if (d.eventType === 'RUN_STARTED') return d.occurredAt
  }
  throw new SessionLinkError({
    code: 'STATE_CORRUPT',
    message: `internal: mapping left a run open without a RUN_STARTED draft (session ${JSON.stringify(sessionId)})`,
  })
}
