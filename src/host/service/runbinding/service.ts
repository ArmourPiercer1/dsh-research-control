/**
 * WP-2.4 — RunBindingService: formal Run registration + DiscoveredSession
 * lifecycle + RUN_* event wiring (the 「event construction → registry
 * validation → store append → row projection」 closed loop).
 *
 * ## Operations (ARCHITECTURE §6 matrix row 「Run 生命周期事件」 /
 * DOMAIN_SCHEMA §6.2 「用户 BIND/DETACH/IGNORE」)
 *
 *  DiscoveredSession side (USER-only — the parameter types are
 *  `UserActorRef` so an AGENT actor is a compile error; forged runtime
 *  actors are rejected with RB_ACTOR_FORBIDDEN):
 *    - `bindDiscoveredSession`   PENDING → BOUND + formal Run +
 *      RUN_STARTED (matrix U, 手工登记 via explicit user bind)
 *    - `detachDiscoveredSession` PENDING → DETACHED (移出范围, 原 DSH
 *      session 保留; NO event — a PENDING DS has no run, and the frozen
 *      catalog §5.1 defines no detach event; the DSH session itself is
 *      untouched)
 *    - `ignoreDiscoveredSession` PENDING → IGNORED (防重复发现; NO event,
 *      same reason)
 *
 *  Run side (emitter matrix enforced by the WP-2.2 registry — catalog §4
 *  E column; AGENT actors must carry a run_id, registry-checked):
 *    - `registerRun`  manual formal-Run registration (no DS involved)
 *      → run row + RUN_STARTED
 *    - `finishRun` / `failRun` / `cancelRun`  RUNNING → FINISHED /
 *      FAILED / CANCELLED (§13 L549, terminal) → conditional run-row
 *      update + RUN_FINISHED / RUN_FAILED / RUN_CANCELLED
 *    - `recordCheckpoint`  §6.1 last_checkpoint_* update (the backing
 *      store of the future `research_run_checkpoint` agent tool;
 *      USER-or-AGENT actors per the matrix row; NO event — a checkpoint
 *      is an operational note, not a chronicle entry)
 *
 *  Read side (CRUD): `getRun` / `listRuns` / `listDiscoveredSessions` /
 *  `getDiscoveredSession` / `findDiscoveredSessionBySessionId`. There is
 *  NO delete: §15 通则 — operational tables never hard-delete first-
 *  class identity rows (INV-HIST-7); invalidation is expressed by the
 *  terminal states / retract-style events.
 *
 * ## Event-vs-row order (two-connection write discipline)
 *
 * The event log (WP-2.1 store connection) and the run/DS rows (this WP's
 * table connection) cannot share one SQLite transaction — there is no
 * cross-connection transaction in SQLite, and the store's in-transaction
 * `TxScope` reaches only `derived_state`. The service therefore orders
 * writes so the derived cache NEVER LEADS the truth:
 *
 *   ① all pre-validation (state machines, refs, emitter actor) — no
 *     write on either connection;
 *   ② the RUN_* event is appended via `store.appendEvents` with the
 *     registry `validate` hook INSIDE the store write transaction
 *     (INV-HIST-4: an unvalidated event never lands) — after this step
 *     History is self-consistent regardless of what follows;
 *   ③ the row-side projection (DS flip + run insert, or the conditional
 *     terminal update) commits on the table connection.
 *
 * Failure modes (documented residual; converges by a future run-vs-
 * history reconciliation sweep — the V1 window is a crash between ② and
 * ③ or a concurrent double operation):
 *   - ② ok, ③ fails → a committed RUN_* event without its row update.
 *     The event is a valid catalog event (it passed the frozen
 *     validation); the row lags the truth — the correct lag direction
 *     (cache trails, never leads). A concurrent loser of a double bind
 *     ends up here: its RUN_STARTED stays in History (a valid chronicle
 *     entry — the user did click BIND), while the DS flip belongs to the
 *     winner (one DS : one run, preserved by the flip's PENDING gate).
 *   - DETACH/IGNORE (row only, no event) and `recordCheckpoint` (row
 *     only) have no history half — a failure there is a clean RB_TABLE
 *     rollback with zero side effects.
 *
 * ## Discovery (DOMAIN_SCHEMA §6.2 规则; DSH_ADAPTER §7/§8/§11)
 *
 * `reconcileSessions` (pull) + `startDiscovery` (push over the
 * `DshSessionAdapter` port — initial full pass + the `created`
 * lifecycle edge; the host wiring's reset/periodic reconcile re-calls
 * `reconcileSessions` — DSH_ADAPTER §11 item 4). Attribution = canonical
 * cwd containment under the injected registered workspace roots
 * (discovery.ts). The three-way §6.2 rule: explicit ResearchContext →
 * auto-register (matrix P, via the U9 seam `researchContextResolver`;
 * V1 default = always null ⇒ the frozen fallback 「仅 DiscoveredSession
 * + 手动 BIND」); registered workspace, no context → PENDING DS row;
 * external workspace → 忽略. Idempotent: a session with a DS row in ANY
 * state is never re-created (TC-DSH-001/003).
 *
 * Layer (ARCHITECTURE §2.2): service — the only layer that writes the
 * operational DB. No DSH imports (INV-PERM-5): the session data plane
 * is the plugin-owned port `DshSessionAdapter` (src/shared, WP-0.4).
 */

import type { DshSessionAdapter, SessionSummary } from '../../../shared/host-adapter-ports.js'
import type { RealizeHooks } from '../../persistence/store/index.js'
import { StoreError } from '../../persistence/store/index.js'
import type { ActorRef, WorkstreamSnapshot } from '../../history/registry/index.js'
import {
  buildRunCancelledEvent,
  buildRunFailedEvent,
  buildRunFinishedEvent,
  buildObjectContext,
  buildRunStartedEvent,
  makeValidateHook,
} from './events.js'
import { NO_RESEARCH_CONTEXT, decideDiscovery, normalizeWorkspaceRoots } from './discovery.js'
import { assertDsCanMove, assertRunCanBeEnded } from './state-machine.js'
import type { RunBindingTables } from './tables.js'
import {
  RunBindingError,
  USER_ACTOR,
  type BindParams,
  type BindResult,
  type DiscoveredSessionListFilter,
  type DiscoveredSessionRecord,
  type ResearchContext,
  type RegisterRunParams,
  type RunBindingServiceOptions,
  type RunListFilter,
  type RunLifecycleActorRef,
  type RunRecord,
  type RunResult,
  type UserActorRef,
  type UserOrAgentActorRef,
} from './types.js'

/** The default actor label for PLUGIN-emitted (auto-registration) events. */
const PLUGIN_ACTOR_LABEL = 'research-control'

/**
 * The Run binding + DiscoveredSession service (module header = full
 * operation/order/discovery contract). All methods are synchronous
 * (node:sqlite); failures are structured `RunBindingError`s.
 */
export class RunBindingService {
  readonly #store: RunBindingServiceOptions['store']
  readonly #tables: RunBindingTables
  readonly #registry: RunBindingServiceOptions['registry']
  readonly #allocator: RunBindingServiceOptions['allocator']
  readonly #projectId: string
  readonly #roots: readonly string[]
  readonly #external: () => import('./types.js').RunBindingExternalState
  readonly #resolver: NonNullable<RunBindingServiceOptions['researchContextResolver']>
  readonly #now: () => number
  readonly #onWorkstreamRealized: ((workstreamId: string) => void) | undefined

  constructor(options: RunBindingServiceOptions) {
    assertNonEmptyString(options.projectId, 'projectId')
    if (options.store === undefined || typeof options.store.appendEvents !== 'function') {
      throw new RunBindingError('RB_INPUT', 'store: a WP-2.1 ResearchStore is required')
    }
    if (options.tables === undefined || typeof options.tables.transaction !== 'function') {
      throw new RunBindingError('RB_INPUT', 'tables: the runbinding table face is required')
    }
    if (options.registry === undefined) {
      throw new RunBindingError('RB_INPUT', 'registry: the WP-2.2 event registry is required')
    }
    if (options.allocator === undefined || typeof options.allocator.reserve !== 'function') {
      throw new RunBindingError('RB_INPUT', 'allocator: the shared IdAllocator is required')
    }
    this.#store = options.store
    this.#tables = options.tables
    this.#registry = options.registry
    this.#allocator = options.allocator
    this.#projectId = options.projectId
    this.#roots = normalizeWorkspaceRoots(options.workspaceRoots ?? [])
    this.#external = options.externalState ?? (() => ({ workstreams: new Map(), tasks: new Map() }))
    this.#resolver = options.researchContextResolver ?? NO_RESEARCH_CONTEXT
    this.#now = options.now ?? Date.now
    this.#onWorkstreamRealized = options.onWorkstreamRealized
  }

  /* ================================================================== *
   * DiscoveredSession discovery
   * ================================================================== */

  /**
   * The push discovery surface (module header): an initial full
   * reconcile over `adapter.listSessions()`, then a subscription to the
   * store lifecycle edges — on each `created` edge a full reconcile runs
   * (a `disposed` edge changes nothing: DS rows persist, and reconcile
   * only ever inserts). Returns the composed disposer (reversible
   * registration, cordis convention — the host wiring disposes it on
   * fiber unmount).
   */
  startDiscovery(adapter: DshSessionAdapter): () => void {
    if (adapter === undefined || typeof adapter.observeSessionLifecycle !== 'function') {
      throw new RunBindingError('RB_INPUT', 'startDiscovery: a DshSessionAdapter is required')
    }
    this.reconcileSessions(adapter.listSessions())
    const dispose = adapter.observeSessionLifecycle((event) => {
      if (event.kind !== 'created') return
      // A reconcile failure surfaces to the host event bus as a handler
      // failure (fail loud); the standing subscription survives it (the
      // next edge / the wiring's reset reconcile retries — reconcile is
      // idempotent, so no discovery is lost).
      this.reconcileSessions(adapter.listSessions())
    })
    return dispose
  }

  /**
   * The pull discovery surface (§6.2 规则, module header). Returns the
   * DS rows created/registered by THIS reconcile (empty = nothing new —
   * idempotent re-runs). Throws `RB_INPUT` on a malformed session row.
   */
  reconcileSessions(sessions: readonly SessionSummary[]): readonly DiscoveredSessionRecord[] {
    if (!Array.isArray(sessions)) {
      throw new RunBindingError('RB_INPUT', 'reconcileSessions: sessions must be an array')
    }
    const created: DiscoveredSessionRecord[] = []
    for (const session of sessions) {
      if (typeof session?.id !== 'string' || session.id.length === 0) {
        throw new RunBindingError('RB_INPUT', 'reconcileSessions: every session row needs a non-empty id')
      }
      // TC-DSH-003: any existing DS row (PENDING/BOUND/DETACHED/IGNORED)
      // ends discovery for this session — never re-create, never mutate.
      if (this.#tables.getDiscoveredSessionBySessionId(session.id) !== null) continue

      const decision = decideDiscovery(session, this.#roots, this.#resolver)
      if (decision.kind === 'skip') continue // external workspace → 忽略 (§6.2)

      if (decision.kind === 'discover') {
        created.push(this.#discover(session, decision.root))
      } else {
        created.push(this.#autoRegister(session, decision.root, decision.context))
      }
    }
    return created
  }

  /* ================================================================== *
   * DiscoveredSession queries + USER lifecycle
   * ================================================================== */

  listDiscoveredSessions(filter: DiscoveredSessionListFilter = {}): readonly DiscoveredSessionRecord[] {
    return this.#tables.listDiscoveredSessions(filter)
  }

  getDiscoveredSession(id: string): DiscoveredSessionRecord | null {
    assertNonEmptyString(id, 'id')
    return this.#tables.getDiscoveredSession(id)
  }

  findDiscoveredSessionBySessionId(dshSessionId: string): DiscoveredSessionRecord | null {
    assertNonEmptyString(dshSessionId, 'dshSessionId')
    return this.#tables.getDiscoveredSessionBySessionId(dshSessionId)
  }

  /**
   * The user's explicit BIND (§6.2): PENDING → BOUND + a formal Run +
   * RUN_STARTED (emitter matrix U). One DS : one run (the flip is gated
   * on PENDING; a second concurrent BIND loses the gate and its
   * RUN_STARTED remains a valid History entry — module header ②/③ note).
   */
  bindDiscoveredSession(dsId: string, params: BindParams, actor: UserActorRef = USER_ACTOR): BindResult {
    assertUserActor(actor, 'bindDiscoveredSession')
    assertNonEmptyString(dsId, 'dsId')
    if (params === undefined || typeof params !== 'object') {
      throw new RunBindingError('RB_INPUT', 'bindDiscoveredSession: params are required')
    }
    const ds = this.#tables.getDiscoveredSession(dsId)
    if (ds === null) throw new RunBindingError('RB_DS_NOT_FOUND', `no DiscoveredSession with id ${dsId}`)
    assertDsCanMove(ds.state, 'BOUND') // §13 L554 — PENDING only
    const { workstreamId, taskId } = this.#checkWorkstreamAndTask(params.workstreamId, params.taskId)

    // A PENDING DS never has a run row (registerRun refuses scoped
    // sessions) — defense-in-depth guard anyway (corruption tolerance).
    if (this.#tables.getRunBySessionId(ds.dsh_session_id) !== null) {
      throw new RunBindingError(
        'RB_SESSION_ALREADY_BOUND',
        `session ${ds.dsh_session_id} already has a formal run; one DS : one run (DOMAIN_SCHEMA §6.2)`,
      )
    }

    const occurredAt = this.#now()
    const runReservation = this.#allocator.reserve('RUN', this.#projectId)
    const eventReservation = this.#allocator.reserve('HISTORY_EVENT', this.#projectId)
    const run: RunRecord = {
      id: runReservation.id,
      workstream_id: workstreamId,
      status: 'RUNNING',
      initiated_by: actor,
      started_at: occurredAt,
      dsh_session_id: ds.dsh_session_id,
      ...(params.taskId === undefined ? {} : { task_id: params.taskId }),
      ...(params.intent === undefined ? {} : { intent: params.intent }),
    }
    const event = buildRunStartedEvent({
      eventId: eventReservation.id,
      runId: run.id,
      workstreamId,
      ...(params.taskId === undefined ? {} : { taskId: params.taskId }),
      dshSessionId: ds.dsh_session_id,
      ...(params.intent === undefined ? {} : { intent: params.intent }),
      actor,
      occurredAt,
    })

    // ② event first (History self-consistent from here on).
    const appended = this.#appendRunEvent(event, workstreamId)
    // ③ row projection: DS flip (PENDING gate) + run insert, ONE table
    //    transaction. A 0-row flip = a concurrent winner took the bind.
    try {
      this.#tables.transaction(() => {
        const changed = this.#tables.transitionDiscoveredSession(dsId, 'PENDING', 'BOUND', run.id)
        if (changed === 0) {
          throw new RunBindingError(
            'RB_DS_NOT_PENDING',
            `DiscoveredSession ${dsId} left PENDING concurrently (state moved); the bind lost the gate`,
          )
        }
        this.#tables.insertRun(run)
      })
    } catch (e) {
      // The event IS committed (②) → its id is in use; the run row is
      // NOT (③ rolled back) → its id burns as a gap. Documented residual
      // (module header): a valid RUN_STARTED without its row projection.
      this.#allocator.commit(eventReservation)
      this.#allocator.release(runReservation)
      throw e
    }
    this.#allocator.commit(runReservation)
    const boundDs = this.#tables.getDiscoveredSession(dsId)
    const boundRun = this.#tables.getRun(run.id)
    if (boundDs === null || boundRun === null) {
      throw new RunBindingError('RB_TABLE', `bind ${dsId}: row projection not readable back after commit`)
    }
    return { ds: boundDs, run: boundRun, event: appended }
  }

  /**
   * DETACH (§6.2): PENDING → DETACHED — 移出范围, 原 DSH session 保留.
   * Row-only (no RUN_* event exists for a PENDING DS — module header).
   * After DETACH the session is never re-discovered (TC-DSH-003).
   */
  detachDiscoveredSession(dsId: string, actor: UserActorRef = USER_ACTOR): DiscoveredSessionRecord {
    assertUserActor(actor, 'detachDiscoveredSession')
    assertNonEmptyString(dsId, 'dsId')
    const ds = this.#tables.getDiscoveredSession(dsId)
    if (ds === null) throw new RunBindingError('RB_DS_NOT_FOUND', `no DiscoveredSession with id ${dsId}`)
    assertDsCanMove(ds.state, 'DETACHED')
    const changed = this.#tables.transitionDiscoveredSession(ds.id, 'PENDING', 'DETACHED')
    if (changed === 0) {
      throw new RunBindingError('RB_DS_NOT_PENDING', `DiscoveredSession ${dsId} left PENDING concurrently`)
    }
    const updated = this.#tables.getDiscoveredSession(dsId)
    if (updated === null) throw new RunBindingError('RB_TABLE', `detach ${dsId}: row not readable back`)
    return updated
  }

  /**
   * IGNORE (§6.2): PENDING → IGNORED — 防重复发现. Row-only (no event).
   * After IGNORE the session is never re-discovered (TC-DSH-003).
   */
  ignoreDiscoveredSession(dsId: string, actor: UserActorRef = USER_ACTOR): DiscoveredSessionRecord {
    assertUserActor(actor, 'ignoreDiscoveredSession')
    assertNonEmptyString(dsId, 'dsId')
    const ds = this.#tables.getDiscoveredSession(dsId)
    if (ds === null) throw new RunBindingError('RB_DS_NOT_FOUND', `no DiscoveredSession with id ${dsId}`)
    assertDsCanMove(ds.state, 'IGNORED')
    const changed = this.#tables.transitionDiscoveredSession(ds.id, 'PENDING', 'IGNORED')
    if (changed === 0) {
      throw new RunBindingError('RB_DS_NOT_PENDING', `DiscoveredSession ${dsId} left PENDING concurrently`)
    }
    const updated = this.#tables.getDiscoveredSession(dsId)
    if (updated === null) throw new RunBindingError('RB_TABLE', `ignore ${dsId}: row not readable back`)
    return updated
  }

  /* ================================================================== *
   * Run lifecycle
   * ================================================================== */

  /**
   * Manual formal-Run registration (matrix U 手工登记): no DS involved —
   * for runs the user records directly (an optional DSH session pointer,
   * INV-DB-2: pointer only, and the session must NOT already be inside
   * the control-plane scope — scoped sessions go through BIND).
   */
  registerRun(params: RegisterRunParams, actor: RunLifecycleActorRef = USER_ACTOR): RunResult {
    if (params === undefined || typeof params !== 'object') {
      throw new RunBindingError('RB_INPUT', 'registerRun: params are required')
    }
    const { workstreamId, taskId } = this.#checkWorkstreamAndTask(params.workstreamId, params.taskId)
    if (params.dshSessionId !== undefined) {
      assertNonEmptyString(params.dshSessionId, 'params.dshSessionId')
      const existingDs = this.#tables.getDiscoveredSessionBySessionId(params.dshSessionId)
      if (existingDs !== null) {
        throw new RunBindingError(
          'RB_SESSION_IN_SCOPE',
          `session ${params.dshSessionId} is inside the control-plane scope (DiscoveredSession ${existingDs.id}, state ${existingDs.state}); use the DS lifecycle (BIND), not registerRun (DOMAIN_SCHEMA §6.2)`,
        )
      }
      if (this.#tables.getRunBySessionId(params.dshSessionId) !== null) {
        throw new RunBindingError(
          'RB_SESSION_ALREADY_BOUND',
          `session ${params.dshSessionId} already has a formal run`,
        )
      }
    }

    const occurredAt = this.#now()
    const runReservation = this.#allocator.reserve('RUN', this.#projectId)
    const eventReservation = this.#allocator.reserve('HISTORY_EVENT', this.#projectId)
    const run: RunRecord = {
      id: runReservation.id,
      workstream_id: workstreamId,
      status: 'RUNNING',
      initiated_by: actor,
      started_at: occurredAt,
      ...(taskId === undefined ? {} : { task_id: taskId }),
      ...(params.dshSessionId === undefined ? {} : { dsh_session_id: params.dshSessionId }),
      ...(params.intent === undefined ? {} : { intent: params.intent }),
    }
    const event = buildRunStartedEvent({
      eventId: eventReservation.id,
      runId: run.id,
      workstreamId,
      ...(taskId === undefined ? {} : { taskId }),
      ...(params.dshSessionId === undefined ? {} : { dshSessionId: params.dshSessionId }),
      ...(params.intent === undefined ? {} : { intent: params.intent }),
      actor,
      occurredAt,
    })

    const appended = this.#appendRunEvent(event, workstreamId) // ②
    try {
      this.#tables.insertRun(run) // ③ (autocommit single statement)
    } catch (e) {
      this.#allocator.commit(eventReservation) // event committed → id in use
      this.#allocator.release(runReservation) // no row → id burns
      throw e
    }
    this.#allocator.commit(runReservation)
    const storedRun = this.#tables.getRun(run.id)
    if (storedRun === null) throw new RunBindingError('RB_TABLE', `registerRun: run ${run.id} not readable back`)
    return { run: storedRun, event: appended }
  }

  /** Finish a RUNNING run → RUN_FINISHED (§5.1; side effect: status, ended_at). */
  finishRun(runId: string, params: { outcomeSummary?: string } = {}, actor: RunLifecycleActorRef = USER_ACTOR): RunResult {
    return this.#endRun(runId, 'FINISHED', actor, (spec) =>
      buildRunFinishedEvent(spec, params.outcomeSummary),
    )
  }

  /** Fail a RUNNING run → RUN_FAILED (§5.1; optional error_summary/failure_kind). */
  failRun(
    runId: string,
    params: { errorSummary?: string; failureKind?: string } = {},
    actor: RunLifecycleActorRef = USER_ACTOR,
  ): RunResult {
    return this.#endRun(runId, 'FAILED', actor, (spec) =>
      buildRunFailedEvent(spec, params.errorSummary, params.failureKind),
    )
  }

  /** Cancel a RUNNING run → RUN_CANCELLED (§5.1; `cancelled_by` = actor). */
  cancelRun(runId: string, params: { reason?: string } = {}, actor: RunLifecycleActorRef = USER_ACTOR): RunResult {
    return this.#endRun(runId, 'CANCELLED', actor, (spec) => buildRunCancelledEvent(spec, params.reason))
  }

  /**
   * §6.1 `last_checkpoint_*` update — the operational backing store of
   * the future `research_run_checkpoint` agent tool (matrix row: AGENT
   * 「checkpoint 报告触发」). NO History event (a checkpoint is an
   * operational note; the chronicle records Run boundaries only).
   * USER-or-AGENT actors (PLUGIN/SYSTEM are not checkpoint reporters).
   */
  recordCheckpoint(
    runId: string,
    params: { note?: string } = {},
    actor: UserOrAgentActorRef = USER_ACTOR,
  ): RunRecord {
    assertUserOrAgentActor(actor, 'recordCheckpoint')
    assertNonEmptyString(runId, 'runId')
    const run = this.#tables.getRun(runId)
    if (run === null) throw new RunBindingError('RB_RUN_NOT_FOUND', `no run with id ${runId}`)
    const at = this.#now()
    const changed = this.#tables.updateRunCheckpoint(runId, at, params.note)
    if (changed === 0) throw new RunBindingError('RB_RUN_NOT_FOUND', `run ${runId} disappeared concurrently`)
    const updated = this.#tables.getRun(runId)
    if (updated === null) throw new RunBindingError('RB_TABLE', `recordCheckpoint ${runId}: row not readable back`)
    return updated
  }

  /* ================================================================== *
   * Run queries (CRUD read half)
   * ================================================================== */

  getRun(runId: string): RunRecord | null {
    assertNonEmptyString(runId, 'runId')
    return this.#tables.getRun(runId)
  }

  listRuns(filter: RunListFilter = {}): readonly RunRecord[] {
    return this.#tables.listRuns(filter)
  }

  /* ================================================================== *
   * internals
   * ================================================================== */

  /**
   * One RUN_* end: pre-validation (§13 L549 via the state machine;
   * refs), then ② append (registry-validated in-transaction) and ③ the
   * CONDITIONAL row update (`WHERE status='RUNNING'` — the sequential
   * double-end gate: the first end flips the row, the second pre-check
   * already fails; a true concurrent double-end leaves the extra event
   * in History — module header residual).
   */
  #endRun(
    runId: string,
    target: 'FINISHED' | 'FAILED' | 'CANCELLED',
    actor: RunLifecycleActorRef,
    build: (spec: {
      eventId: string
      runId: string
      workstreamId: string
      actor: RunLifecycleActorRef
      occurredAt: number
    }) => import('../../persistence/store/index.js').HistoryEventInput,
  ): RunResult {    assertNonEmptyString(runId, 'runId')
    const run = this.#tables.getRun(runId)
    if (run === null) throw new RunBindingError('RB_RUN_NOT_FOUND', `no run with id ${runId}`)
    assertRunCanBeEnded(run.status, target) // §13 L549 — RUNNING only

    const occurredAt = this.#now()
    const eventReservation = this.#allocator.reserve('HISTORY_EVENT', this.#projectId)
    const event = build({
      eventId: eventReservation.id,
      runId: run.id,
      workstreamId: run.workstream_id,
      actor,
      occurredAt,
    })

    const appended = this.#appendRunEvent(event, run.workstream_id) // ②
    // ③ conditional row update (status gate). A 0-row result = the row
    // moved concurrently after the pre-check read — the extra event
    // stays in History (documented residual); reject here so the caller
    // sees a failure, not a silent duplicate.
    const summary = target === 'FINISHED' ? (event.payload as { outcome_summary?: string }).outcome_summary : undefined
    const changed = this.#tables.updateRunStatus(run.id, target, occurredAt, summary)
    if (changed === 0) {
      this.#allocator.commit(eventReservation) // event committed → id in use
      throw new RunBindingError(
        'RB_RUN_NOT_RUNNING',
        `run ${runId} left RUNNING concurrently (state moved); the ${event.eventType} event was recorded but the row update was refused`,
      )
    }
    this.#allocator.commit(eventReservation)
    const updated = this.#tables.getRun(run.id)
    if (updated === null) throw new RunBindingError('RB_TABLE', `${event.eventType} ${runId}: row not readable back`)
    return { run: updated, event: appended }
  }

  /**
   * ② — the event append half of every event-producing operation:
   * registry-validated INSIDE the store write transaction
   * (`AppendEventsOptions.validate` — WP-2.1 seam; INV-HIST-4), with the
   * PLANNED→REALIZED atomic-realize hooks when the owner workstream is
   * PLANNED (TC-DOM-033 persistence half; the declarative file half is
   * the `onWorkstreamRealized` seam, wired by WP-2.6).
   *
   * Error discipline: `RunBindingError`s (including the registry
   * rejection raised by the validate hook — caller-owned per the WP-2.1
   * contract) propagate UNCHANGED; store-level failures are wrapped
   * RB_STORE.
   */
  #appendRunEvent(
    event: import('../../persistence/store/index.js').HistoryEventInput,
    ownerWorkstreamId: string,
  ): import('../../persistence/store/index.js').HistoryEventRecord {
    const realize = this.#realizeHooksFor(ownerWorkstreamId)
    const validate = makeValidateHook(this.#registry, () => buildObjectContext(this.#tables, this.#external()))
    try {
      const result = this.#store.appendEvents([event], { validate, ...(realize === undefined ? {} : { realize }) })
      return result.events[0]
    } catch (e) {
      if (e instanceof RunBindingError) throw e
      if (e instanceof StoreError) {
        throw new RunBindingError('RB_STORE', `${event.eventType}: ${e.message}`, { cause: e })
      }
      throw e
    }
  }

  /**
   * TC-DOM-033 persistence half: when the owner workstream is PLANNED,
   * the store fires the hooks (inside its write transaction) exactly
   * once — only if this batch carries that WS's FIRST event. The
   * service writes the workstream-lifecycle derived_state row (the
   * §15 L627「workstream lifecycle」derived cache) and notifies the
   * declarative half (`onWorkstreamRealized` — workstream.yaml flip,
   * WP-1.1 loader, wired by WP-2.6).
   */
  #realizeHooksFor(workstreamId: string): RealizeHooks | undefined {
    const ws = this.#external().workstreams.get(workstreamId)
    if (ws === undefined || ws.lifecycle !== 'PLANNED') return undefined
    return {
      workstreamIds: [workstreamId],
      apply: (context) => {
        context.tx.setDerivedState('workstream', context.workstreamId, {
          topicId: ws.topicId,
          lifecycle: 'REALIZED',
        } satisfies WorkstreamSnapshot)
        this.#onWorkstreamRealized?.(context.workstreamId)
      },
    }
  }

  /** §6.2 规则 2 — a PENDING DS row (manual-BIND fallback lane). */
  #discover(session: SessionSummary, root: string): DiscoveredSessionRecord {
    const reservation = this.#allocator.reserve('DISCOVERED_SESSION', this.#projectId)
    const record: DiscoveredSessionRecord = {
      id: reservation.id,
      dsh_session_id: session.id,
      workspace_root: root,
      discovered_at: this.#now(),
      state: 'PENDING',
      ...(session.title === undefined || session.title.length === 0 ? {} : { summary: session.title }),
    }
    try {
      this.#tables.insertDiscoveredSession(record)
    } catch (e) {
      this.#allocator.release(reservation)
      throw e
    }
    this.#allocator.commit(reservation)
    return record
  }

  /**
   * §6.2 规则 1 — explicit ResearchContext → 自动注册 Run (matrix P,
   * 「session 绑定自动登记」): a BOUND DS row + a formal Run + a
   * RUN_STARTED with a PLUGIN actor, ONE table transaction for the rows.
   * V1-dormant: the default resolver never fires (U9 fallback) — the
   * seam exists so a future carrier activates this path without a
   * service API change.
   */
  #autoRegister(
    session: SessionSummary,
    root: string,
    context: ResearchContext,
  ): DiscoveredSessionRecord {
    const { workstreamId, taskId } = this.#checkWorkstreamAndTask(context.workstreamId, context.taskId)
    const actor: ActorRef = { kind: 'PLUGIN', label: PLUGIN_ACTOR_LABEL }
    const occurredAt = this.#now()
    const runReservation = this.#allocator.reserve('RUN', this.#projectId)
    const eventReservation = this.#allocator.reserve('HISTORY_EVENT', this.#projectId)
    const dsReservation = this.#allocator.reserve('DISCOVERED_SESSION', this.#projectId)

    const run: RunRecord = {
      id: runReservation.id,
      workstream_id: workstreamId,
      status: 'RUNNING',
      initiated_by: actor,
      started_at: occurredAt,
      dsh_session_id: session.id,
      ...(taskId === undefined ? {} : { task_id: taskId }),
      ...(context.intent === undefined ? {} : { intent: context.intent }),
    }
    const event = buildRunStartedEvent({
      eventId: eventReservation.id,
      runId: run.id,
      workstreamId,
      ...(taskId === undefined ? {} : { taskId }),
      dshSessionId: session.id,
      ...(context.intent === undefined ? {} : { intent: context.intent }),
      actor,
      occurredAt,
    })

    const appended = this.#appendRunEvent(event, workstreamId) // ②
    try {
      this.#tables.transaction(() => {
        this.#tables.insertRun(run)
        this.#tables.insertDiscoveredSession({
          id: dsReservation.id,
          dsh_session_id: session.id,
          workspace_root: root,
          discovered_at: occurredAt,
          state: 'BOUND',
          bound_run_id: run.id,
          ...(session.title === undefined || session.title.length === 0 ? {} : { summary: session.title }),
        })
      })
    } catch (e) {
      this.#allocator.commit(eventReservation) // event committed → id in use
      this.#allocator.release(runReservation)
      this.#allocator.release(dsReservation)
      throw e
    }
    this.#allocator.commit(runReservation)
    this.#allocator.commit(dsReservation)
    const ds = this.#tables.getDiscoveredSession(dsReservation.id)
    if (ds === null) throw new RunBindingError('RB_TABLE', `auto-register: DS row ${dsReservation.id} not readable back`)
    return ds
  }

  /** Owner-workstream + task reference checks (catalog §5.1 通用校验). */
  #checkWorkstreamAndTask(workstreamId: unknown, taskId: unknown): { workstreamId: string; taskId?: string } {
    assertNonEmptyString(workstreamId, 'workstreamId')
    const external = this.#external()
    if (!external.workstreams.has(workstreamId)) {
      throw new RunBindingError(
        'RB_WORKSTREAM_NOT_FOUND',
        `workstream ${workstreamId} does not exist (DOMAIN_SCHEMA §6.1: Formal Run 必须绑定 Workstream; catalog §5: ownerWorkstreamId 存在)`,
      )
    }
    if (taskId === undefined) return { workstreamId }
    assertNonEmptyString(taskId, 'taskId')
    const task = external.tasks.get(taskId)
    if (task === undefined) {
      throw new RunBindingError('RB_TASK_NOT_FOUND', `task ${taskId} does not exist (catalog §5.1: 存在)`)
    }
    if (task.workstreamId !== workstreamId) {
      throw new RunBindingError(
        'RB_TASK_WS_MISMATCH',
        `task ${taskId} belongs to workstream ${task.workstreamId}, not ${workstreamId} (catalog §5.1: 属同 WS)`,
      )
    }
    return { workstreamId, taskId }
  }
}

/* ====================================================================== *
 * actor gates (runtime half of the permission surface — the TYPE half
 * is the `UserActorRef`/`UserOrAgentActorRef` parameter types + the
 * permissions test's compile-time assertions)
 * ====================================================================== */

function assertUserActor(actor: UserActorRef, operation: string): void {
  if (typeof actor?.kind !== 'string' || actor.kind !== 'USER') {
    throw new RunBindingError(
      'RB_ACTOR_FORBIDDEN',
      `${operation}: requires a USER actor (DOMAIN_SCHEMA §6.2 「用户 BIND/DETACH/IGNORE」; ARCHITECTURE §6: no agent lane for session-binding operations) — got ${describeActor(actor)}`,
    )
  }
}

function assertUserOrAgentActor(actor: UserOrAgentActorRef, operation: string): void {
  if (typeof actor?.kind !== 'string' || (actor.kind !== 'USER' && actor.kind !== 'AGENT')) {
    throw new RunBindingError(
      'RB_ACTOR_FORBIDDEN',
      `${operation}: requires a USER or AGENT actor (ARCHITECTURE §6 row 「Run 生命周期事件」: checkpoint 报告 = agent lane) — got ${describeActor(actor)}`,
    )
  }
}

function describeActor(actor: unknown): string {
  if (typeof actor === 'object' && actor !== null && 'kind' in actor) {
    return `kind=${String((actor as { kind?: unknown }).kind)}`
  }
  return String(actor)
}

function assertNonEmptyString(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RunBindingError('RB_INPUT', `${what} must be a non-empty string`)
  }
}
