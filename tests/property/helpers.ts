/**
 * WP-2.10 — fast-check property-test infrastructure (RR-012 / TEST_MATRIX
 * §2: the TC-HIST 族 tooling was declared 「vitest + fast-check（随机事件
 * 序列）」; round-1 delivered deterministic enumeration only. This WP closes
 * the gap with the minimal property set the risk register names:
 * random legal event streams × ① seq strictly +1 per WS, ② full-replay
 * fold idempotency, ③ semantic/audit dual-order determinism).
 *
 * Generation constraint (task wording: 「用 registry 校验通过为生成约束——
 * 先构造后校验过滤，或按 schema 生成」): this helper takes BOTH edges —
 *   - streams are constructed strictly from the frozen schema's catalog
 *     (per-type `fc.record` arbitraries built field-by-field from
 *     `schema/history/history-events.schema.json` branches + the catalog
 *     §4 emitter matrix + the §5 cross-field rules — generation per
 *     schema by design);
 *   - AND every constructed event is passed through the REAL frozen
 *     registry's `validateEvent` as a LOUD constraint (`assertStreamLegal`,
 *     called by every property): a generator that ever drifts from the
 *     frozen schema fails the property on the spot with the structured
 *     registry errors — no silent filtering that could hide generator
 *     bugs.
 *
 * Scope note: the constraint is PER-EVENT against a static
 * `HistoryObjectContext` (the catalog's validation unit). Cross-event
 * state evolution (e.g. two PLANNED→ACTIVE transitions on one task) is a
 * SERVICE-layer concern — the store and the replay face under test here
 * are stateless with respect to it (seq allocation, replay fold, query
 * determinism are functions of the log).
 *
 * Scale (modest, per task): 60 fast-check runs per property (the 50–100
 * window keeps the suite runtime controlled — see each file's seed).
 *
 * Seed strategy + failure reproduction (per task): every property file
 * pins an explicit `seed` in its `fc.assert` params, so every run is
 * byte-deterministic. If a property ever fails:
 *   1. the vitest run prints the fast-check counterexample (the failing
 *      generated stream); re-running the SAME file reproduces it
 *      deterministically (the seed lives in the source, not the clock):
 *        npx vitest run tests/property/<file>.test.ts
 *   2. to replay one specific counterexample outside fast-check, paste the
 *      printed element list into a one-off script running the same
 *      construction/append/property body (construct → assertStreamLegal
 *      → the property's assertion block).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterAll } from 'vitest'
import fc from 'fast-check'

import {
  loadHistoryEventRegistry,
  validateEvent,
  type HistoryEventRegistry,
  type HistoryObjectContext,
} from '../../src/host/history/registry/index.js'
import {
  openDatabase,
  type HistoryEventInput,
  type ResearchStore,
} from '../../src/host/persistence/store/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** WR root (three levels up: tests/property → tests → plugin repo → WR). */
export const WR_ROOT = resolve(HERE, '..', '..', '..')
/** The real frozen history schema dir (registry source). */
export const WR_HISTORY_SCHEMA_DIR = join(WR_ROOT, 'schema', 'history')

/** fs-backed `HistorySchemaReader` (tests may do I/O). */
export class FsReader {
  readFile(path: string): string | null {
    if (!isAbsolute(path)) throw new Error(`FsReader requires absolute paths, got ${path}`)
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return readFileSync(path, 'utf8')
  }
}

/* ------------------------------------------------------------------ *
 * Temp stores (afterAll cleanup — the repo's real-sqlite discipline)
 * ------------------------------------------------------------------ */

const roots: string[] = []

/** Fresh temp directory (tracked for afterAll cleanup). */
export function makeTempDir(prefix = 'wp210prop-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) {
    rmSync(r, { recursive: true, force: true })
  }
})

/** Reference "now" (epoch ms, 2026-08-22T09:00:00Z). */
export const T0 = Date.parse('2026-08-22T09:00:00Z')

/** Deterministic reference clock. */
export function makeClock(start = T0): () => number {
  let t = start
  return () => (t += 1_000)
}

/** A FRESH store in a fresh temp dir (one per property run). */
export function freshStore(): ResearchStore {
  return openDatabase(join(makeTempDir(), 'research.sqlite'), { now: makeClock() })
}

/* ------------------------------------------------------------------ *
 * The real frozen registry (module-level: loaded once, reused across
 * all 60 runs of a property — the expensive AJV compile is amortized)
 * ------------------------------------------------------------------ */

let registryCache: HistoryEventRegistry | null = null

/** The real frozen WP-2.2 registry (the validation gate under test). */
export function loadRegistry(): HistoryEventRegistry {
  if (registryCache !== null) return registryCache
  const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)
  if (!registry.isUsable) {
    throw new Error(`registry unusable in property tests: ${registry.loadErrors.map((e) => e.message).join('; ')}`)
  }
  registryCache = registry
  return registry
}

/* ------------------------------------------------------------------ *
 * The static validation context (the catalog's per-event unit)
 * ------------------------------------------------------------------ */

/**
 * A static `HistoryObjectContext` the generated events reference. All
 * objects are in states that admit the generated transitions (run R-1
 * RUNNING — RUN_FINISHED's from-state; task T-1 PLANNED —
 * TASK_EXECUTION_CHANGED's from-state; gate G-1 un-evaluated; milestone
 * M-1 PLANNED). Fresh-object events (RUN_STARTED / RUNS_STARTED /
 * FACT / CLAIM) generate fresh ids that are absent here by construction.
 */
export function makeCtx(): HistoryObjectContext {
  return {
    workstreams: new Map([
      ['WS-1', { topicId: 'TPC-1', lifecycle: 'REALIZED' }],
      ['WS-2', { topicId: 'TPC-1', lifecycle: 'REALIZED' }],
      ['WS-3', { topicId: 'TPC-2', lifecycle: 'REALIZED' }],
    ]),
    tasks: new Map([
      ['T-1', { workstreamId: 'WS-1', execution: 'PLANNED', validation: 'NOT_REQUIRED', acceptanceCriteria: [] }],
      ['T-2', { workstreamId: 'WS-1', execution: 'PLANNED', validation: 'NOT_REQUIRED', acceptanceCriteria: [] }],
      ['T-3', { workstreamId: 'WS-2', execution: 'PLANNED', validation: 'NOT_REQUIRED', acceptanceCriteria: [] }],
      ['T-4', { workstreamId: 'WS-3', execution: 'PLANNED', validation: 'NOT_REQUIRED', acceptanceCriteria: [] }],
    ]),
    runs: new Map([['R-1', { workstreamId: 'WS-1', status: 'RUNNING' }]]),
    claims: new Map(),
    facts: new Map(),
    artifacts: new Map(),
    relations: new Map(),
    gates: new Map([['G-1', { workstreamId: 'WS-1', lastResult: null }]]),
    milestones: new Map([['M-1', { workstreamId: 'WS-1', status: 'PLANNED' }]]),
    interventions: new Map(),
    topologyEdges: new Map(),
  }
}

/* ------------------------------------------------------------------ *
 * Random legal event stream (fast-check arbitrary)
 * ------------------------------------------------------------------ */

/** One owner workstream (all exist in makeCtx). */
export const OWNER_WS = ['WS-1', 'WS-2', 'WS-3'] as const
/** The owner workstream's tasks (for RUN_STARTED `task_id` existence). */
const WS_TASKS: Record<string, readonly string[]> = {
  'WS-1': ['T-1', 'T-2'],
  'WS-2': ['T-3'],
  'WS-3': ['T-4'],
}

const USER_ACTORS: readonly Record<string, unknown>[] = [
  { kind: 'USER', user_id: 'u-1' },
  { kind: 'USER', user_id: 'u-2', label: 'gui' },
  { kind: 'USER' },
]
const PLUGIN_ACTORS: readonly Record<string, unknown>[] = [{ kind: 'PLUGIN', label: 'research-control' }]
/** The ONLY AGENT actor the static ctx can satisfy (run_id must exist). */
const AGENT_ACTOR: Record<string, unknown> = { kind: 'AGENT', run_id: 'R-1' }
const INITIATED_BY: readonly Record<string, unknown>[] = [
  { kind: 'USER', user_id: 'u-1' },
  { kind: 'USER', session_id: 'sess-x' },
  { kind: 'PLUGIN', label: 'research-control' },
]

/** ±30 days around T0 — late registrations are first-class (catalog
 *  §1 L32: occurredAt may predate earlier events), so the semantic-order
 *  property genuinely exercises the (occurredAt, eventSeq) tie-break. */
const OCCURRED_AT = { min: T0 - 30 * 86_400_000, max: T0 + 30 * 86_400_000 }
/** Sparse booleans (probability p/10; fc.frequency is gone in fast-check
 *  v4 — an integer draw keeps the same distribution AND shrinks to 0). */
const sparse = (p: number): fc.Arbitrary<boolean> => fc.integer({ min: 0, max: 9 }).map((n) => n < p)

/**
 * A drawn stream element — tagged by a `kind` discriminator so
 * `construct` never guesses between overlapping record shapes.
 */
export interface StreamElement {
  readonly kind:
    | 'RUN_STARTED'
    | 'RUNS_STARTED'
    | 'RUN_FINISHED'
    | 'FACT_RECORDED'
    | 'CLAIM_RECORDED'
    | 'GATE_EVALUATED'
    | 'MILESTONE_ACHIEVED'
    | 'TASK_EXECUTION_CHANGED'
  readonly owner: string
  readonly actor: Record<string, unknown>
  readonly occurredAt: number
  /** RUN_STARTED: the payload's `initiated_by` actorRef. */
  readonly initiatedBy?: Record<string, unknown>
  /** RUN_STARTED / RUNS_STARTED: which of the owner's tasks to reference. */
  readonly taskSlot?: number
  readonly withTask?: boolean
  readonly withSession?: boolean
  readonly withIntent?: boolean
  /** RUN_FINISHED: carry `outcome_summary`. */
  readonly withOutcome?: boolean
  /** GATE_EVALUATED: the frozen result enum (no WAIVED — it would need a
   *  note; the generator keeps to the two plain results). */
  readonly result?: string
  readonly withNote?: boolean
}

/**
 * The event-stream arbitrary (fast-check). 3–24 events; each element is
 * drawn per the frozen schema branch of its type, with the catalog §4
 * emitter matrix honored (RUNS_STARTED: U P only — no AGENT lane;
 * GATE_EVALUATED / MILESTONE_ACHIEVED / TASK_EXECUTION_CHANGED: USER
 * only; AGENT actors carry `run_id` R-1; FACT/CLAIM by AGENT carry
 * `created_by_run`). Stream-unique ids are assigned by INDEX in
 * `construct` (fresh-object ids never collide with the ctx's objects).
 */
export const streamArb: fc.Arbitrary<readonly StreamElement[]> = fc.array(
  fc.oneof(
    // RUN_STARTED (§5.1): run_id 新建; task_id 属同 WS; emitters U A P.
    fc.record({
      kind: fc.constant('RUN_STARTED' as const),
      owner: fc.constantFrom(...OWNER_WS),
      actor: fc.constantFrom(...USER_ACTORS, AGENT_ACTOR, ...PLUGIN_ACTORS),
      initiatedBy: fc.constantFrom(...INITIATED_BY),
      withTask: sparse(5),
      taskSlot: fc.integer({ min: 0, max: 1 }),
      withSession: sparse(3),
      withIntent: sparse(3),
      occurredAt: fc.integer(OCCURRED_AT),
    }),
    // RUNS_STARTED (§5.2): ≥2 fresh runs; emitters U P only.
    fc.record({
      kind: fc.constant('RUNS_STARTED' as const),
      owner: fc.constantFrom(...OWNER_WS),
      actor: fc.constantFrom(...USER_ACTORS, ...PLUGIN_ACTORS),
      taskSlot: fc.integer({ min: 0, max: 1 }),
      occurredAt: fc.integer(OCCURRED_AT),
    }),
    // RUN_FINISHED (§5.1): run 存在 (R-1 RUNNING in ctx, owner WS-1).
    fc.record({
      kind: fc.constant('RUN_FINISHED' as const),
      owner: fc.constant('WS-1'),
      actor: fc.constantFrom(...USER_ACTORS, AGENT_ACTOR, ...PLUGIN_ACTORS),
      withOutcome: sparse(5),
      occurredAt: fc.integer(OCCURRED_AT),
    }),
    // FACT_RECORDED (§5.3): fact_id 新建; emitters U A.
    fc.record({
      kind: fc.constant('FACT_RECORDED' as const),
      owner: fc.constantFrom(...OWNER_WS),
      actor: fc.constantFrom(...USER_ACTORS, AGENT_ACTOR),
      occurredAt: fc.integer(OCCURRED_AT),
    }),
    // CLAIM_RECORDED (§5.3): claim_id 新建; emitters U A.
    fc.record({
      kind: fc.constant('CLAIM_RECORDED' as const),
      owner: fc.constantFrom(...OWNER_WS),
      actor: fc.constantFrom(...USER_ACTORS, AGENT_ACTOR),
      occurredAt: fc.integer(OCCURRED_AT),
    }),
    // GATE_EVALUATED (§5.6): G-1 ∈ WS-1 pinned; emitters USER only.
    fc.record({
      kind: fc.constant('GATE_EVALUATED' as const),
      owner: fc.constant('WS-1'),
      actor: fc.constantFrom(...USER_ACTORS),
      result: fc.constantFrom('PASSED', 'FAILED'),
      withNote: sparse(3),
      occurredAt: fc.integer(OCCURRED_AT),
    }),
    // MILESTONE_ACHIEVED (§5.6): M-1 PLANNED ∈ WS-1 pinned; USER only.
    fc.record({
      kind: fc.constant('MILESTONE_ACHIEVED' as const),
      owner: fc.constant('WS-1'),
      actor: fc.constantFrom(...USER_ACTORS),
      withNote: sparse(3),
      occurredAt: fc.integer(OCCURRED_AT),
    }),
    // TASK_EXECUTION_CHANGED (§5.2): T-1 PLANNED ∈ WS-1 pinned; from =
    // ctx state, to legal (PLANNED→ACTIVE); emitters USER only.
    fc.record({
      kind: fc.constant('TASK_EXECUTION_CHANGED' as const),
      owner: fc.constant('WS-1'),
      actor: fc.constantFrom(...USER_ACTORS),
      occurredAt: fc.integer(OCCURRED_AT),
    }),
  ),
  { minLength: 3, maxLength: 24 },
)

/**
 * A constructed candidate: the full 9-field envelope (the registry's
 * validation unit — catalog §1) + the store input (envelope minus the
 * store-owned `eventSeq`/`recordedAt`, which `appendEvents` assigns).
 */
export interface CandidateEvent {
  readonly envelope: Record<string, unknown>
  readonly input: HistoryEventInput
}

/** Stream-unique id builders (the PK of history_event is `event_id`;
 *  fresh-object ids must never collide with the ctx's objects). */
const eventId = (i: number): string => `H-${100000 + i + 1}`

function pick<T>(arr: readonly T[], slot: number): T {
  return arr[slot % arr.length]!
}

/** Turn (drawn element, stream index) into a CandidateEvent. PURE in the
 *  fast-check sense: same draw + same index → same event (shrinking-
 *  safe — no hidden counters, no Date.now). */
export function construct(element: StreamElement, i: number): CandidateEvent {
  const actor = element.actor
  const occurredAt = element.occurredAt
  let owner: string
  let payload: Record<string, unknown>
  switch (element.kind) {
    case 'RUN_STARTED': {
      owner = element.owner
      payload = { run_id: `R-${1000 + i}`, initiated_by: element.initiatedBy }
      if (element.withTask) payload.task_id = pick(WS_TASKS[owner], element.taskSlot ?? 0)
      if (element.withSession) payload.dsh_session_id = `sess-gen-${i}`
      if (element.withIntent) payload.intent = `generated intent ${i}`
      break
    }
    case 'RUNS_STARTED': {
      owner = element.owner
      payload = {
        // Fresh run ids (frozen pattern ^R-[1-9][0-9]*$; never in ctx —
        // ctx holds only R-1).
        runs: [
          { run_id: `R-${2000 + 2 * i}` },
          { run_id: `R-${2001 + 2 * i}`, task_id: pick(WS_TASKS[owner], element.taskSlot ?? 0) },
        ],
      }
      break
    }
    case 'RUN_FINISHED': {
      owner = 'WS-1'
      payload = { run_id: 'R-1' }
      if (element.withOutcome) payload.outcome_summary = `outcome ${i}`
      break
    }
    case 'FACT_RECORDED': {
      owner = element.owner
      payload = { fact_id: `F-${3000 + i}`, statement: `generated fact ${i}` }
      if (actor.kind === 'AGENT') payload.created_by_run = 'R-1'
      break
    }
    case 'CLAIM_RECORDED': {
      owner = element.owner
      payload = { claim_id: `C-${4000 + i}`, statement: `generated claim ${i}` }
      if (actor.kind === 'AGENT') payload.created_by_run = 'R-1'
      break
    }
    case 'GATE_EVALUATED': {
      owner = 'WS-1'
      payload = { gate_id: 'G-1', result: element.result ?? 'PASSED', evaluated_by: actor }
      if (element.withNote) payload.note = `gate note ${i}`
      break
    }
    case 'MILESTONE_ACHIEVED': {
      owner = 'WS-1'
      payload = { milestone_id: 'M-1' }
      if (element.withNote) payload.note = `milestone note ${i}`
      break
    }
    default: {
      // TASK_EXECUTION_CHANGED
      owner = 'WS-1'
      payload = { task_id: 'T-1', from: 'PLANNED', to: 'ACTIVE' }
      break
    }
  }
  const env: Record<string, unknown> = {
    eventId: eventId(i),
    ownerWorkstreamId: owner,
    // Placeholder — the store RE-ASSIGNS per-WS MAX+1 inside its
    // transaction (TC-HIST-003); validation does not consult it.
    eventSeq: i + 1,
    eventType: element.kind,
    schemaVersion: 1,
    occurredAt,
    recordedAt: T0 + (i + 1) * 1000,
    actor,
    payload,
  }
  const { eventSeq: _seq, recordedAt: _rec, ...input } = env
  // The rest IS a HistoryEventInput by construction (all required keys
  // were set above); the double cast silences the Record<string,unknown>
  // spread inference.
  return { envelope: env, input: input as unknown as HistoryEventInput }
}

/** Build the full candidate stream from drawn elements (index-unique ids). */
export function constructStream(elements: readonly StreamElement[]): readonly CandidateEvent[] {
  return elements.map((element, i) => construct(element, i))
}

/* ------------------------------------------------------------------ *
 * The loud generation constraint (registry validation pass)
 * ------------------------------------------------------------------ */

/**
 * Assert EVERY constructed event passes the real frozen registry
 * (construct-then-validate, fail-loud — the task's 「registry 校验通过为
 * 生成约束」). Called by every property at the top of its body; a
 * generator drift from the frozen schema surfaces here with the
 * structured registry errors, not as a silently filtered stream.
 */
export function assertStreamLegal(
  registry: HistoryEventRegistry,
  ctx: HistoryObjectContext,
  stream: readonly CandidateEvent[],
): void {
  for (const { envelope } of stream) {
    const verdict = validateEvent(registry, envelope, ctx)
    if (!verdict.ok) {
      throw new Error(
        `generated event ${JSON.stringify(envelope.eventType)}@${JSON.stringify(envelope.eventId)} failed the registry constraint: ` +
          verdict.errors.map((e) => `${e.code}@${e.path ?? '/'}: ${e.message}`).join('; '),
      )
    }
  }
}

/** The owner workstreams of a stream, in first-appearance order. */
export function streamOwners(stream: readonly { readonly input: HistoryEventInput }[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const { input } of stream) {
    if (!seen.has(input.ownerWorkstreamId)) {
      seen.add(input.ownerWorkstreamId)
      out.push(input.ownerWorkstreamId)
    }
  }
  return out
}
