/**
 * WP-4.4 — fixtures for the history timeline view suite.
 *
 * Two halves:
 *  - the SCENARIO event log: six wire-valid HistoryEventDto rows of one
 *    owner workstream (INV-HIST-3), including the dual-order centerpiece —
 *    a LATE-REGISTERED `RUN_FINISHED` (H-3): its `occurredAt` sits between
 *    H-1 and H-2, but its `eventSeq`/`recordedAt` are seq 3 / last. That
 *    one row is what separates the semantic timeline (H-3 at position 2)
 *    from the audit timeline (H-3 at position 3 — catalog §2).
 *    A batch start (H-4, RUNS_STARTED with R-2 + R-3) exercises the
 *    wrapper fan-out (one row projected into two run groups).
 *  - a controllable RPC facade: structurally `ResearchRpcFacade`
 *    (tsc-verified against the full 14-method face); `queryHistory`
 *    emulates the host's seq-axis window protocol (rpc-contracts §5:
 *    window `(afterSeq, afterSeq+limit]`, density-based exhaustion,
 *    rows presented in the requested order) over the in-memory log and
 *    records every call verbatim. The other 13 methods throw — the
 *    history view never calls them (the call log pins that).
 */

import type { QueryHistoryArgs, QueryHistoryResult, ResearchRpcFacade, ResearchStore } from '../../src/client/stores/index.js'
import { createResearchStore } from '../../src/client/stores/index.js'
import type { HistoryEventDto } from '../../src/shared/rpc-contracts.js'

/* -------------------------------------------------------------------- *
 * The scenario log
 * -------------------------------------------------------------------- */

/** A stable epoch base (the WP-4.1a fixture convention). */
export const T0 = 1_755_000_000_000

/** Build a wire-valid event with scenario defaults (single owner WS-1). */
export function makeEvent(
  overrides: Partial<HistoryEventDto> &
    Pick<HistoryEventDto, 'eventId' | 'eventType' | 'schemaVersion' | 'occurredAt' | 'recordedAt' | 'eventSeq' | 'payload'>,
): HistoryEventDto {
  return {
    ownerWorkstreamId: 'WS-1',
    actor: { kind: 'USER', user_id: 'u1' },
    source: null,
    ...overrides,
  }
}

export const SCENARIO: readonly HistoryEventDto[] = [
  // seq 1 — a run starts (USER).
  makeEvent({
    eventId: 'H-1',
    eventType: 'RUN_STARTED',
    schemaVersion: 1,
    occurredAt: T0,
    recordedAt: T0 + 1_000,
    eventSeq: 1,
    payload: { run_id: 'R-1' },
    actor: { kind: 'USER', user_id: 'u1' },
  }),
  // seq 2 — a fact recorded by the run's agent.
  makeEvent({
    eventId: 'H-2',
    eventType: 'FACT_RECORDED',
    schemaVersion: 1,
    occurredAt: T0 + 10_000,
    recordedAt: T0 + 11_000,
    eventSeq: 2,
    payload: { fact_id: 'F-1', statement: 'baseline converges' },
    actor: { kind: 'AGENT', run_id: 'R-1' },
  }),
  // seq 3 — THE LATE REGISTRATION: the run actually ended 5s after start
  // (between seq 1 and seq 2 in research time), but the plugin only
  // recorded it last (seq 3, recordedAt last). Semantic order places it
  // at position 2; audit order keeps it at position 3 (catalog §2).
  makeEvent({
    eventId: 'H-3',
    eventType: 'RUN_FINISHED',
    schemaVersion: 1,
    occurredAt: T0 + 5_000,
    recordedAt: T0 + 50_000,
    eventSeq: 3,
    payload: { run_id: 'R-1', result_note: 'converged in 5s' },
    actor: { kind: 'USER', user_id: 'u1' },
  }),
  // seq 4 — a batch launch (PLUGIN) of two runs: the wrapper fan-out row.
  makeEvent({
    eventId: 'H-4',
    eventType: 'RUNS_STARTED',
    schemaVersion: 1,
    occurredAt: T0 + 20_000,
    recordedAt: T0 + 21_000,
    eventSeq: 4,
    payload: { runs: [{ run_id: 'R-2' }, { run_id: 'R-3' }], batch_note: 'ablation pair' },
    actor: { kind: 'PLUGIN', label: 'batch launcher' },
  }),
  // seq 5 — one batch member gets cancelled by its agent.
  makeEvent({
    eventId: 'H-5',
    eventType: 'RUN_CANCELLED',
    schemaVersion: 1,
    occurredAt: T0 + 30_000,
    recordedAt: T0 + 31_000,
    eventSeq: 5,
    payload: { run_id: 'R-2', reason: 'diverged', cancelled_by: { kind: 'AGENT', run_id: 'R-2' } },
    actor: { kind: 'AGENT', run_id: 'R-2' },
  }),
  // seq 6 — a user gate evaluation (no run reference: ungrouped).
  makeEvent({
    eventId: 'H-6',
    eventType: 'GATE_EVALUATED',
    schemaVersion: 1,
    occurredAt: T0 + 40_000,
    recordedAt: T0 + 41_000,
    eventSeq: 6,
    payload: { gate_id: 'G-1', result: 'PASSED' },
    actor: { kind: 'USER', user_id: 'u1' },
  }),
]

/** The two expected renderings of the scenario (the dual-order diff is H-3). */
export const SEMANTIC_ORDER: readonly string[] = ['H-1', 'H-3', 'H-2', 'H-4', 'H-5', 'H-6']
export const AUDIT_ORDER: readonly string[] = ['H-1', 'H-2', 'H-3', 'H-4', 'H-5', 'H-6']

/* -------------------------------------------------------------------- *
 * The controllable facade
 * -------------------------------------------------------------------- */

export interface HistoryFacade {
  /** The facade face (structurally `researchRpc` — full 14-method face). */
  readonly rpc: ResearchRpcFacade
  /** Every `queryHistory` call's args, verbatim, in order. */
  readonly calls: readonly QueryHistoryArgs[]
  /** Arm the NEXT `queryHistory` call to await `resolve` (loading state). */
  readonly nextControlled: () => void
  /** Arm the NEXT `queryHistory` call to answer with a business fault. */
  readonly nextFails: (code: string, message: string) => void
  /** Resolve the armed pending page (must be called while it is pending). */
  readonly resolve: (result: QueryHistoryResult) => void
}

/**
 * One page of the in-memory log, emulating the host queryEvents protocol
 * (rpc-contracts §5): the window `(afterSeq, afterSeq+limit]` on the
 * seq axis, the ENTIRE window returned in the requested order, density-
 * based exhaustion (`nextAfterSeq = null` iff the log ended inside the
 * window).
 */
export function pageOf(log: readonly HistoryEventDto[], args: QueryHistoryArgs): QueryHistoryResult {
  const order = args.order ?? 'semantic'
  const afterSeq = args.afterSeq ?? 0
  const limit = args.limit ?? Number.MAX_SAFE_INTEGER
  const maxSeq = log.reduce((m, e) => Math.max(m, e.eventSeq), 0)
  const upper = Math.min(afterSeq + limit, maxSeq)
  const windowRows = log.filter(e => e.eventSeq > afterSeq && e.eventSeq <= upper)
  const exhausted = upper === maxSeq
  const events =
    order === 'semantic'
      ? [...windowRows].sort((a, b) => a.occurredAt - b.occurredAt || a.eventSeq - b.eventSeq)
      : [...windowRows].sort((a, b) => a.eventSeq - b.eventSeq)
  return { events, nextAfterSeq: exhausted ? null : upper, exhausted }
}

/**
 * Build a facade over an in-memory log. `queryHistory` serves pages per
 * the protocol above and records every call; the other 13 methods reject
 * loudly (the history view must never call them — a call = a failing test
 * through the unhandled rejection the store surfaces as a slice error).
 */
export function makeHistoryFacade(log: readonly HistoryEventDto[]): HistoryFacade {
  const calls: QueryHistoryArgs[] = []
  let armed = false
  let failNext: { code: string; message: string } | null = null
  let resolveNext: ((result: QueryHistoryResult) => void) | null = null
  const notUsed = (name: string): unknown => async (): Promise<never> => {
    throw new Error(`history view test: facade method "${name}" must not be called`)
  }
  return {
    rpc: {
      ping: notUsed('ping'),
      getDashboard: notUsed('getDashboard'),
      getProject: notUsed('getProject'),
      getTopic: notUsed('getTopic'),
      getWorkstream: notUsed('getWorkstream'),
      queryHistory: async (args: QueryHistoryArgs): Promise<
        { ok: true; value: QueryHistoryResult } | { ok: false; error: { code: string; message: string; details: object } }
      > => {
        calls.push(args)
        if (failNext !== null) {
          const fault = failNext
          failNext = null
          return { ok: false, error: { code: fault.code, message: fault.message, details: {} } }
        }
        if (armed) {
          // Loading-state control: this one call awaits the test's resolve.
          armed = false
          const value = await new Promise<QueryHistoryResult>(resolve => {
            resolveNext = resolve
          })
          resolveNext = null
          return { ok: true, value }
        }
        return { ok: true, value: pageOf(log, args) }
      },
      reorderPlan: notUsed('reorderPlan'),
      selectPlanFork: notUsed('selectPlanFork'),
      dismissPlanFork: notUsed('dismissPlanFork'),
      updateInterventionState: notUsed('updateInterventionState'),
      registerInteraction: notUsed('registerInteraction'),
      saveResearchCheckpoint: notUsed('saveResearchCheckpoint'),
      getGitHistory: notUsed('getGitHistory'),
      restoreDeclarativeFile: notUsed('restoreDeclarativeFile'),
    } as ResearchRpcFacade,
    calls,
    nextControlled: () => {
      armed = true
    },
    nextFails: (code, message) => {
      failNext = { code, message }
    },
    resolve: result => {
      if (resolveNext === null) throw new Error('no pending queryHistory to resolve')
      resolveNext(result)
    },
  }
}

/** A facade whose `queryHistory` always fails with a business fault. */
export function makeFaultyFacade(): ResearchRpcFacade {
  const notUsed = (name: string): unknown => async (): Promise<never> => {
    throw new Error(`history view test: facade method "${name}" must not be called`)
  }
  return {
    ping: notUsed('ping'),
    getDashboard: notUsed('getDashboard'),
    getProject: notUsed('getProject'),
    getTopic: notUsed('getTopic'),
    getWorkstream: notUsed('getWorkstream'),
    queryHistory: async (): Promise<{ ok: false; error: { code: string; message: string; details: object } }> => ({
      ok: false,
      error: { code: 'HIST_NOT_FOUND', message: 'workstream log missing', details: {} },
    }),
    reorderPlan: notUsed('reorderPlan'),
    selectPlanFork: notUsed('selectPlanFork'),
    dismissPlanFork: notUsed('dismissPlanFork'),
    updateInterventionState: notUsed('updateInterventionState'),
    registerInteraction: notUsed('registerInteraction'),
    saveResearchCheckpoint: notUsed('saveResearchCheckpoint'),
    getGitHistory: notUsed('getGitHistory'),
    restoreDeclarativeFile: notUsed('restoreDeclarativeFile'),
  } as ResearchRpcFacade
}

/** A fresh store over a facade (the container's real data path). */
export function storeOver(rpc: ResearchRpcFacade): ResearchStore {
  return createResearchStore({ rpc })
}
