/**
 * WP-2.2 test fixtures.
 *
 * - The real frozen schema dir: WR/schema/history (read-only contract; the
 *   registry under test loads these exact bytes through an fs-backed reader).
 * - `makeCtx()`: a standard operational state snapshot (two topics, four
 *   workstreams, tasks in different states, a RUNNING run, ACTIVE claim,
 *   REGISTERED artifact, ACTIVE relation, un-evaluated gate, PLANNED
 *   milestone, PLANNED FORK+MERGE edges) — rich enough for every §5 example
 *   and for the negative cases (terminal states, other-WS objects, other-topic
 *   edges live alongside).
 * - `POSITIVE_EVENTS`: one REAL-FORM payload per event type, field-by-field
 *   from the HISTORY_EVENT_CATALOG §5 tables (required fields + the optional
 *   fields the tables call out, e.g. failure_kind=OOM, evidence_refs,
 *   batch_source), plus per-event envelope overrides where the §4 emitter
 *   matrix / §5.7 actor rule requires a non-USER actor.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ActorRef, HistoryEventType, HistoryObjectContext } from '../../src/host/history/registry/index.js'
const HERE = dirname(fileURLToPath(import.meta.url))

/** WR root (three levels up: tests/history-registry → tests → plugin repo → WR). */
export const WR_ROOT = join(HERE, '..', '..', '..')
/** The real frozen history schema dir (read-only contract). */
export const WR_HISTORY_SCHEMA_DIR = join(WR_ROOT, 'schema', 'history')

/** fs-backed `HistorySchemaReader` (tests may do I/O; the kernel may not). */
export class FsReader {
  readFile(path: string): string | null {
    if (!isAbsolute(path)) throw new Error(`FsReader requires absolute paths, got ${path}`)
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return readFileSync(path, 'utf8')
  }
}

/* ------------------------------------------------------------------ *
 * Reference time & envelope builder
 * ------------------------------------------------------------------ */

/** Reference "now" for all fixtures (epoch ms). */
export const T0 = Date.parse('2026-08-22T09:00:00Z')

/** Build a schema-conformant envelope (shape checked against the REAL frozen schema).
 *  `over` is intentionally untyped: the negative suites feed invalid values on purpose. */
export function envelope(eventType: string, payload: unknown, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: 'H-1001',
    ownerWorkstreamId: 'WS-1',
    eventSeq: 1,
    eventType,
    schemaVersion: 1,
    occurredAt: T0,
    recordedAt: T0 + 1000,
    actor: { kind: 'USER', user_id: 'u-alice' },
    payload,
    ...over,
  }
}

/* ------------------------------------------------------------------ *
 * Standard operational state snapshot
 * ------------------------------------------------------------------ */

/**
 * The standard snapshot. Notable placements (negative-case anchors):
 *  - T-1: ACTIVE/PENDING with 2 ACs (WS-1); T-2: PLANNED/PENDING, empty ACs;
 *    T-3: EXECUTED (terminal)/PASSED (WS-2);
 *  - R-1 RUNNING, R-2 FINISHED (terminal), R-3 RUNNING (WS-2);
 *  - C-1 ACTIVE, C-2 RETRACTED (terminal); A-1 REGISTERED, A-2 MISSING (terminal);
 *  - REL-1 ACTIVE, REL-2 REMOVED; G-1 un-evaluated (WS-1), G-2 (WS-2);
 *  - M-1 PLANNED, M-2 DROPPED; IV-1 exists;
 *  - TE-1 FORK PLANNED (WS-1→WS-2, TPC-1), TE-2 MERGE PLANNED (WS-2+WS-4→WS-1, TPC-1),
 *    TE-3 FORK REALIZED (terminal, TPC-1), TE-4 FORK PLANNED (TPC-2: WS-3→WS-5).
 */
export function makeCtx(): HistoryObjectContext {
  return {
    workstreams: new Map([
      ['WS-1', { topicId: 'TPC-1', lifecycle: 'REALIZED' }],
      ['WS-2', { topicId: 'TPC-1', lifecycle: 'PLANNED' }],
      ['WS-3', { topicId: 'TPC-2', lifecycle: 'REALIZED' }],
      ['WS-4', { topicId: 'TPC-1', lifecycle: 'PLANNED' }],
      ['WS-5', { topicId: 'TPC-2', lifecycle: 'PLANNED' }],
    ]),
    tasks: new Map([
      ['T-1', { workstreamId: 'WS-1', execution: 'ACTIVE', validation: 'PENDING', acceptanceCriteria: ['AC: unit tests pass', 'AC: lint clean'] }],
      ['T-2', { workstreamId: 'WS-1', execution: 'PLANNED', validation: 'PENDING', acceptanceCriteria: [] }],
      ['T-3', { workstreamId: 'WS-2', execution: 'EXECUTED', validation: 'PASSED', acceptanceCriteria: ['AC: benchmark report filed'] }],
    ]),
    runs: new Map([
      ['R-1', { workstreamId: 'WS-1', status: 'RUNNING' }],
      ['R-2', { workstreamId: 'WS-1', status: 'FINISHED' }],
      ['R-3', { workstreamId: 'WS-2', status: 'RUNNING' }],
    ]),
    claims: new Map([
      ['C-1', { workstreamId: 'WS-1', status: 'ACTIVE' }],
      ['C-2', { workstreamId: 'WS-1', status: 'RETRACTED' }],
    ]),
    facts: new Map([['F-1', { workstreamId: 'WS-1' }]]),
    artifacts: new Map([
      ['A-1', { workstreamId: 'WS-1', status: 'REGISTERED' }],
      ['A-2', { workstreamId: 'WS-1', status: 'MISSING' }],
    ]),
    relations: new Map([
      ['REL-1', { status: 'ACTIVE', source: { kind: 'TASK', id: 'T-1' }, relationType: 'DEPENDS_ON', target: { kind: 'TASK', id: 'T-2' } }],
      ['REL-2', { status: 'REMOVED', source: { kind: 'CLAIM', id: 'C-1' }, relationType: 'SUPPORTED_BY', target: { kind: 'FACT', id: 'F-1' } }],
    ]),
    gates: new Map([
      ['G-1', { workstreamId: 'WS-1', lastResult: null }],
      ['G-2', { workstreamId: 'WS-2', lastResult: 'PASSED' }],
    ]),
    milestones: new Map([
      ['M-1', { workstreamId: 'WS-1', status: 'PLANNED' }],
      ['M-2', { workstreamId: 'WS-1', status: 'DROPPED' }],
    ]),
    interventions: new Map([['IV-1', { workstreamIds: ['WS-1'] }]]),
    topologyEdges: new Map([
      ['TE-1', { topicId: 'TPC-1', operation: 'FORK', lifecycle: 'PLANNED', inputs: ['WS-1'], outputs: ['WS-2'] }],
      ['TE-2', { topicId: 'TPC-1', operation: 'MERGE', lifecycle: 'PLANNED', inputs: ['WS-2', 'WS-4'], outputs: ['WS-1'] }],
      ['TE-3', { topicId: 'TPC-1', operation: 'FORK', lifecycle: 'REALIZED', inputs: ['WS-1'], outputs: ['WS-4'] }],
      ['TE-4', { topicId: 'TPC-2', operation: 'FORK', lifecycle: 'PLANNED', inputs: ['WS-3'], outputs: ['WS-5'] }],
    ]),
  }
}

/* ------------------------------------------------------------------ *
 * One real-form positive payload per event type (HISTORY_EVENT_CATALOG §5)
 * ------------------------------------------------------------------ */

export interface PositiveEventSpec {
  /** The §5-table real-form payload. */
  readonly payload: unknown
  /** Envelope owner override (default WS-1). */
  readonly owner?: string
  /** Envelope actor override (default USER u-alice). */
  readonly actor?: ActorRef
}

const USER_ALICE: ActorRef = { kind: 'USER', user_id: 'u-alice' }

/**
 * 20 positive events, one per catalog row. Each payload is a real form of the
 * §5 field table (required fields present; the table's notable optionals used).
 */
export const POSITIVE_EVENTS: Readonly<Record<HistoryEventType, PositiveEventSpec>> = {
  // §5.1 — fresh R-10 starts on T-1 (same WS-1)
  RUN_STARTED: {
    payload: {
      run_id: 'R-10',
      task_id: 'T-1',
      dsh_session_id: 'dsh-sess-42',
      intent: 'run the training sweep on the calibration board',
      initiated_by: USER_ALICE,
    },
  },
  // §5.2 — batch launch, 2 fresh runs on WS-1 tasks
  RUNS_STARTED: {
    payload: {
      runs: [
        { run_id: 'R-20', task_id: 'T-1' },
        { run_id: 'R-21', task_id: 'T-2', intent: 'baseline without the residual channel' },
      ],
      batch_source: { kind: 'MANUAL', note: 'batch launch from the GUI' },
    },
  },
  // §5.1 — R-1 is RUNNING
  RUN_FINISHED: {
    payload: { run_id: 'R-1', outcome_summary: 'training converged at epoch 40' },
  },
  // §5.1 — R-1 is RUNNING; failure_kind is the table's example free label
  RUN_FAILED: {
    payload: { run_id: 'R-1', error_summary: 'CUDA out of memory at epoch 12', failure_kind: 'OOM' },
  },
  // §5.1 — R-1 is RUNNING
  RUN_CANCELLED: {
    payload: { run_id: 'R-1', reason: 'user stopped the sweep', cancelled_by: USER_ALICE },
  },
  // §5.2 — T-2 execution is PLANNED (from = current), legal PLANNED → ACTIVE
  TASK_EXECUTION_CHANGED: {
    payload: { task_id: 'T-2', from: 'PLANNED', to: 'ACTIVE', reason: 'user started the task' },
  },
  // §5.2 — T-2 validation is PENDING (from = current), legal PENDING → UNDER_REVIEW
  TASK_VALIDATION_CHANGED: {
    payload: { task_id: 'T-2', from: 'PENDING', to: 'UNDER_REVIEW', reviewer: USER_ALICE, note: 'first review pass' },
  },
  // §5.2 — T-2's AC snapshot is currently []; a real snapshot change
  ACCEPTANCE_CRITERIA_CHANGED: {
    payload: { task_id: 'T-2', from: [], to: ['AC: reproduction script runs end-to-end'] },
  },
  // §5.3 — fresh F-20; USER emitter, created_by_run optional but shown
  FACT_RECORDED: {
    payload: {
      fact_id: 'F-20',
      statement: 'learning rate 3e-4 beats 1e-4 on the validation split',
      created_by_run: 'R-1',
      references: ['results/lr-sweep.csv'],
    },
  },
  // §5.3 — fresh C-20
  CLAIM_RECORDED: {
    payload: { claim_id: 'C-20', statement: 'the residual channel explains most of the localization error', references: ['F-1'] },
  },
  // §5.3 — C-1 is ACTIVE
  CLAIM_RETRACTED: {
    payload: { claim_id: 'C-1', reason: 'superseded by C-20 after the ablation study' },
  },
  // §5.4 — fresh A-20; related_task in the same WS; created_by_run exists
  ARTIFACT_REGISTERED: {
    payload: {
      artifact_id: 'A-20',
      type: 'DATASET',
      title: 'calibration board v2',
      uri: 'datasets/calib-v2/',
      content_hash: 'sha256:9f2ab3',
      created_by_run: 'R-1',
      related_task: 'T-1',
    },
  },
  // §5.4 — A-1 is REGISTERED; detected_by shows the P-emitted audit form
  ARTIFACT_MARKED_MISSING: {
    payload: { artifact_id: 'A-1', reason: 'file absent during audit', detected_by: { kind: 'PLUGIN', label: 'audit' } },
  },
  // §5.5 — fresh REL-20; CLAIM → FACT is a listed SUPPORTED_BY combination;
  // owner = source.ws (WS-1)
  RELATION_ADDED: {
    payload: { relation_id: 'REL-20', source: { kind: 'CLAIM', id: 'C-1' }, relation_type: 'SUPPORTED_BY', target: { kind: 'FACT', id: 'F-1' } },
  },
  // §5.5 — REL-1 is ACTIVE; recorded endpoints match the stored relation
  RELATION_REMOVED: {
    payload: {
      relation_id: 'REL-1',
      source: { kind: 'TASK', id: 'T-1' },
      relation_type: 'DEPENDS_ON',
      target: { kind: 'TASK', id: 'T-2' },
      reason: 'dependency dropped after the refactor',
    },
  },
  // §5.6 — G-1 has no evaluation yet (state PLANNED); USER evaluator
  GATE_EVALUATED: {
    payload: { gate_id: 'G-1', result: 'PASSED', evaluated_by: USER_ALICE, note: 'all criteria met', evidence_refs: [{ kind: 'FACT', id: 'F-1' }] },
  },
  // §5.6 — M-1 is PLANNED
  MILESTONE_ACHIEVED: {
    payload: { milestone_id: 'M-1', evidence_refs: [{ kind: 'ARTIFACT', id: 'A-1' }], note: 'calibration pipeline complete' },
  },
  // §5.7 — fresh IV-20; origin AUTO_FLOODING ⇒ PLUGIN actor; owner = first
  // related WS derivable from source_refs (R-1 ⇒ WS-1)
  INTERVENTION_CREATED: {
    payload: { intervention_id: 'IV-20', title: 'GPU queue saturated', origin: 'AUTO_FLOODING', source_refs: [{ kind: 'RUN', id: 'R-1' }] },
    actor: { kind: 'PLUGIN', label: 'auto-flooding' },
  },
  // §5.8 — TE-1 is a PLANNED FORK of TPC-1; owner = inputs[0] = WS-1
  TOPOLOGY_FORK_REALIZED: {
    payload: { topology_edge_id: 'TE-1', inputs: ['WS-1'], outputs: ['WS-2'] },
  },
  // §5.8 — TE-2 is a PLANNED MERGE of TPC-1; owner = outputs[0] = WS-1
  TOPOLOGY_MERGE_REALIZED: {
    payload: { topology_edge_id: 'TE-2', inputs: ['WS-2', 'WS-4'], outputs: ['WS-1'] },
  },
}

/** Build the full positive event (envelope + §5 payload) for one type. */
export function positiveEvent(type: HistoryEventType): Record<string, unknown> {
  const spec = POSITIVE_EVENTS[type]
  return envelope(type, spec.payload, {
    ...(spec.owner !== undefined ? { ownerWorkstreamId: spec.owner } : {}),
    ...(spec.actor !== undefined ? { actor: spec.actor } : {}),
  })
}

/** Deep-freeze a value (for the no-side-effect assertions, TC-HIST-001). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** Deep-freeze a HistoryObjectContext (maps + their value objects). */
export function freezeCtx(ctx: HistoryObjectContext): HistoryObjectContext {
  deepFreeze(ctx)
  return ctx
}

/**
 * A new ctx with one snapshot map replaced by `entries` (merged over the old
 * map). The validator's ctx is READ-ONLY by contract (validateEvent never
 * writes); tests that need a variant state build one here instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function replaceMap<K extends keyof HistoryObjectContext>(
  ctx: HistoryObjectContext,
  key: K,
  entries: ReadonlyMap<string, unknown> | Iterable<[string, unknown]>,
): HistoryObjectContext {
  const source = ctx[key] as ReadonlyMap<string, unknown>
  const map = new Map<string, unknown>(source)
  for (const [k, v] of entries) map.set(k, v)
  return { ...ctx, [key]: map } as HistoryObjectContext
}

/** Serialize a ctx snapshot to a deterministic string (Map-aware). */
export function ctxSnapshot(ctx: HistoryObjectContext): string {
  const maps = Object.keys(ctx) as (keyof HistoryObjectContext)[]
  const out: Record<string, [string, unknown][]> = {}
  for (const key of maps.sort()) {
    const map = ctx[key]
    const entries: [string, unknown][] = []
    for (const [k, v] of map.entries()) entries.push([k, JSON.parse(JSON.stringify(v))])
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    out[key] = entries
  }
  return JSON.stringify(out)
}
