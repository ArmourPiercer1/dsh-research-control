/**
 * WP-2.8 / **WP-8.2** — TC-PERF-001..006 synthetic event dataset generator
 * (test infra). WP-8.2 v2 dataset upgrade (task: 「10k 合成集覆盖全 20 事件
 * 类型分布 + derived_state 满 + 多 WS — 比 WP-2.8 更真形的分布」):
 *
 *  - **All 20 catalog event types** (HISTORY_EVENT_CATALOG §4): the WP-2.8
 *    11-type mix is extended with RUN_FAILED / RUN_CANCELLED /
 *    ACCEPTANCE_CRITERIA_CHANGED / GATE_EVALUATED / MILESTONE_ACHIEVED /
 *    INTERVENTION_CREATED / TOPOLOGY_FORK_REALIZED / TOPOLOGY_MERGE_REALIZED
 *    (the last two FORCED at fixed positions — each topology edge is
 *    PLANNED→REALIZED exactly once, catalog §5.8);
 *  - **derived_state full** (catalog §6 table): the stream exercises every
 *    derived-cache row — RUN / TASK / GATE / MILESTONE / FACT / CLAIM /
 *    ARTIFACT / RELATION / INTERVENTION / TOPOLOGY_EDGE (+ WORKSTREAM
 *    lifecycle flips) — so a catalog-§6 audit-order rebuild (TC-PERF-002
 *    half, tests/perf/derived-reducer.ts) yields non-empty rows for ALL
 *    derived object kinds;
 *  - **8 workstreams, non-uniform weighted distribution** (WP-2.8's strict
 *    i%5 round-robin is replaced by a weighted pattern; WS-7/WS-8 join the
 *    rotation only after their FORK/MERGE edges are realized — a realistic
 *    fork/merge lifecycle: WS-1 forks WS-7, then WS-6×WS-7 merge into WS-8);
 *  - **emitter diversity** (catalog §3.6 / §4 E column): USER ~65%,
 *    AGENT ~25% (allowed types only, `actor.run_id` = an existing Run,
 *    AGENT-emitted FACT/CLAIM carry `created_by_run`), PLUGIN ~10%
 *    (ARTIFACT_MARKED_MISSING audit detection, INTERVENTION AUTO_*);
 *  - late registration kept (`i % 53 === 11`, occurredAt −2h — TC-HIST-002
 *    store/query half, catalog §1 L32).
 *
 * 「合法形态」的验证口径（同 WP-2.8）：每个事件在生成时即过**完整
 * `validateEvent`**（真实冻结 schema 目录 + 逐步维护的 HistoryObjectContext
 * 快照）；ctx 推进严格在校验通过后执行（validateEvent 的 ctx 是「事件将
 * 变更前的」只读快照）；任一事件校验失败 = 生成器 bug，立即抛错。
 *
 * 确定性：mulberry32(seed) + 固定权重 + 固定 WS 模式/forced 位置 + 固定
 * late 规则 ⇒ 同种子逐字节同数据集。1k 数据集 = 10k 流的前 1k 事件行
 * （前缀自身合法 — 供 TC-PERF-004/005 的 1k vs 10k 规模对比；FORK/MERGE
 * 的 forced 位置在 i=2000/6000，晚于 1k 前缀，故 1k 集无拓扑事件）。
 *
 * RUNS_STARTED 信封特例（catalog §5.2）：一次 batch launch 在**每个相关
 * owner WS** 各产生一条同 payload 事件 — 生成器因此发射 2 行（owner =
 * 两个不同 WS，各取该 WS 的一个 task 入 batch）；存储行总数 = 10k 事件位
 * + ~150 条 fan-out 行（1k 集同为前缀行）。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { HistoryEventInput } from '../../src/host/persistence/store/index.js'
import {
  loadHistoryEventRegistry,
  validateEvent,
  type ActorRef,
  type GateResult,
  type HistoryObjectContext,
  type TaskExecution,
  type TaskValidation,
} from '../../src/host/history/registry/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
/** WR root (three levels up: tests/perf → tests → plugin repo → WR). */
export const WR_ROOT = join(HERE, '..', '..', '..')
/** The real frozen history schema dir (read-only contract). */
export const WR_HISTORY_SCHEMA_DIR = join(WR_ROOT, 'schema', 'history')

/** fs-backed `HistorySchemaReader` (tests may do I/O; the kernel may not). */
class FsReader {
  readFile(path: string): string | null {
    if (!isAbsolute(path)) throw new Error(`FsReader requires absolute paths, got ${path}`)
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return readFileSync(path, 'utf8')
  }
}

/** Deterministic PRNG (mulberry32): same seed ⇒ same sequence, cross-platform. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Dataset timeline origin (epoch ms) — all occurredAt derive from it. */
export const PERF_T0 = Date.parse('2026-09-01T00:00:00Z')
/** One event per minute on the base timeline. */
const STEP_MS = 60_000
/** Late-registration offset: pulled 2h EARLIER than its registration position. */
const LATE_OFFSET_MS = 7_200_000
/** Late injection rule: `i % LATE_EVERY === LATE_PHASE` (≈1.9% of events). */
export const LATE_EVERY = 53
export const LATE_PHASE = 11
/** The late rule as a predicate (tests reuse it to mark the late set). */
export const isLateSlot = (i: number): boolean => i % LATE_EVERY === LATE_PHASE

/* ------------------------------------------------------------------ *
 * Workstream topology of the synthetic project (8 WS, one topic)
 * ------------------------------------------------------------------ */

/** Base workstreams (REALIZED from the start, weighted rotation members). */
export const BASE_WS: readonly string[] = ['WS-1', 'WS-2', 'WS-3', 'WS-4', 'WS-5', 'WS-6']
/** Fork output (PLANNED until TE-1 is realized; joins the rotation after). */
export const FORK_WS = 'WS-7'
/** Merge output (PLANNED until TE-2 is realized; joins the rotation after). */
export const MERGE_WS = 'WS-8'
/** All 8 workstreams (the authoritative replay list — ALL carry events). */
export const ALL_WS: readonly string[] = [...BASE_WS, FORK_WS, MERGE_WS]

/** The fork edge: WS-1 → WS-7 (V1 arity: exactly one input). */
export const FORK_EDGE_ID = 'TE-1'
export const FORK_EDGE: { readonly inputs: readonly string[]; readonly outputs: readonly string[] } = {
  inputs: ['WS-1'],
  outputs: [FORK_WS],
}
/** The merge edge: WS-6 × WS-7 → WS-8 (V1 arity: exactly one output). */
export const MERGE_EDGE_ID = 'TE-2'
export const MERGE_EDGE: { readonly inputs: readonly string[]; readonly outputs: readonly string[] } = {
  inputs: ['WS-6', FORK_WS],
  outputs: [MERGE_WS],
}

/** Forced topology positions (slot indices; both > 1k prefix).
 *  Chosen so `isLateSlot` never fires on them (2000%53=39, 6000%53=41). */
export const FORK_SLOT = 2_000
export const MERGE_SLOT = 6_000

/** Per-WS seeded pools (gates/milestones are DECLARATIVE — they exist in
 *  the plan, not in history; the stream mutates/evaluates/achieves them). */
export const TASKS_PER_WS = 300
export const GATES_PER_WS = 12
export const MILESTONES_PER_WS = 30

/** Weighted rotation patterns (slot → workstream). WP-8.2 「更真形的分布」:
 *  WS-1 is the busiest route, WS-5/6 quieter; WS-7 joins at FORK_SLOT
 *  (weight 2), WS-8 at MERGE_SLOT (weight 2). Deterministic per slot. */
const P6: readonly string[] = ['WS-1', 'WS-1', 'WS-1', 'WS-1', 'WS-1', 'WS-2', 'WS-2', 'WS-2', 'WS-2', 'WS-3', 'WS-3', 'WS-3', 'WS-4', 'WS-4', 'WS-4', 'WS-5', 'WS-5', 'WS-6', 'WS-6']
const P7: readonly string[] = [...P6, FORK_WS, FORK_WS]
const P8: readonly string[] = [...P7, MERGE_WS, MERGE_WS]

/** The owner workstream for slot `i` (pre-forced-event override). */
function wsForSlot(i: number): string {
  if (i < FORK_SLOT) return P6[i % P6.length]!
  if (i < MERGE_SLOT) return P7[(i - FORK_SLOT) % P7.length]!
  return P8[(i - MERGE_SLOT) % P8.length]!
}

/* ------------------------------------------------------------------ *
 * The 20-type mix (WP-8.2: full-spectrum distribution)
 * ------------------------------------------------------------------ */

/** All 20 catalog event types (schema oneOf order — CATALOG_SYNC checked
 *  against the registry at load; TC-PERF-001 pins every type > 0). */
export const ALL_EVENT_TYPES: readonly string[] = [
  'RUN_STARTED',
  'RUNS_STARTED',
  'RUN_FINISHED',
  'RUN_FAILED',
  'RUN_CANCELLED',
  'TASK_EXECUTION_CHANGED',
  'TASK_VALIDATION_CHANGED',
  'ACCEPTANCE_CRITERIA_CHANGED',
  'FACT_RECORDED',
  'CLAIM_RECORDED',
  'CLAIM_RETRACTED',
  'ARTIFACT_REGISTERED',
  'ARTIFACT_MARKED_MISSING',
  'RELATION_ADDED',
  'RELATION_REMOVED',
  'GATE_EVALUATED',
  'MILESTONE_ACHIEVED',
  'INTERVENTION_CREATED',
  'TOPOLOGY_FORK_REALIZED',
  'TOPOLOGY_MERGE_REALIZED',
]

/** Mixed (random) weights — the two TOPOLOGY types are FORCED (weight 0),
 *  not mixed (a topology edge is realized exactly once). Sum = EXACTLY 1.0
 *  (guarded at load — a sum > 1 silently makes tail types unreachable,
 *  cf. WP-2.8 run 1). */
const TARGET_MIX: ReadonlyArray<readonly [string, number]> = [
  ['RUN_STARTED', 0.14],
  ['RUNS_STARTED', 0.015],
  ['RUN_FINISHED', 0.08],
  ['RUN_FAILED', 0.025],
  ['RUN_CANCELLED', 0.01],
  ['TASK_EXECUTION_CHANGED', 0.16],
  ['TASK_VALIDATION_CHANGED', 0.08],
  ['ACCEPTANCE_CRITERIA_CHANGED', 0.03],
  ['FACT_RECORDED', 0.12],
  ['CLAIM_RECORDED', 0.07],
  ['CLAIM_RETRACTED', 0.03],
  ['ARTIFACT_REGISTERED', 0.06],
  ['ARTIFACT_MARKED_MISSING', 0.025],
  ['RELATION_ADDED', 0.05],
  ['RELATION_REMOVED', 0.025],
  ['GATE_EVALUATED', 0.04],
  ['MILESTONE_ACHIEVED', 0.02],
  ['INTERVENTION_CREATED', 0.02],
]

// Dev-time guard: the cumulative-weight picker requires sum === 1.0.
const MIX_SUM = TARGET_MIX.reduce((acc, [, w]) => acc + w, 0)
if (Math.abs(MIX_SUM - 1) > 1e-9) {
  throw new Error(`generatePerfDataset: TARGET_MIX weights sum to ${MIX_SUM}, expected exactly 1`)
}

/** Types that are always legal (fresh ids) — the deterministic fallback pool. */
const ALWAYS_LEGAL: readonly string[] = [
  'FACT_RECORDED',
  'CLAIM_RECORDED',
  'ARTIFACT_REGISTERED',
  'RUN_STARTED',
  'RELATION_ADDED',
]

/** Emitters that may be AGENT (catalog §4 E column contains A). */
const AGENT_ALLOWED: ReadonlySet<string> = new Set([
  'RUN_STARTED',
  'RUN_FINISHED',
  'RUN_FAILED',
  'RUN_CANCELLED',
  'FACT_RECORDED',
  'CLAIM_RECORDED',
  'CLAIM_RETRACTED',
  'ARTIFACT_REGISTERED',
  'ARTIFACT_MARKED_MISSING',
  'RELATION_ADDED',
  'RELATION_REMOVED',
  'INTERVENTION_CREATED',
])
/** AGENT-emitted events that REQUIRE created_by_run (catalog §5.3/§5.4). */
const AGENT_NEEDS_CREATED_BY_RUN: ReadonlySet<string> = new Set(['FACT_RECORDED', 'CLAIM_RECORDED'])

const P_USER = 0.65
const P_AGENT = 0.25 // of the remainder (when AGENT_ALLOWED && a Run exists)
// remainder → PLUGIN (only legal for ARTIFACT_MARKED_MISSING / INTERVENTION)

const ARTIFACT_TYPES = ['DATASET', 'FIGURE', 'MODEL', 'CODE', 'REPORT', 'NOTE'] as const

export interface PerfDataset {
  /** Store-ready events (no eventSeq/recordedAt), append order = audit order.
   *  Length = `slots` + the RUNS_STARTED fan-out extra rows. */
  readonly events: readonly HistoryEventInput[]
  /** Logical event positions generated (= `count`). */
  readonly slots: number
  /** The 8 owner workstreams (authoritative replay list). */
  readonly workstreams: readonly string[]
  /** Realized event-type distribution over ALL 20 types. */
  readonly byType: Readonly<Record<string, number>>
  /** Emitted rows per owner workstream. */
  readonly byWs: Readonly<Record<string, number>>
  /** Events whose occurredAt was pulled 2h earlier (late registration). */
  readonly lateCount: number
  /** Late-slot rule (for the audit-tail assertion in TC-PERF-002). */
  readonly lateRule: readonly [number, number]
  /** The eventIds of ALL rows emitted from late slots (fan-out rows of a
   *  late slot are late too) — TC-PERF-002's audit-tail set. */
  readonly lateEventIds: ReadonlySet<string>
  readonly seed: number
}

interface GenTask {
  execution: TaskExecution
  validation: TaskValidation
  /** Current AC snapshot (kept non-empty ⇒ to=NOT_REQUIRED stays illegal, INV-TASK-3). */
  ac: string[]
  acVersion: number
}

interface GenRelation {
  readonly id: string
  readonly source: { kind: 'TASK'; id: string }
  readonly relationType: 'DEPENDS_ON'
  readonly target: { kind: 'TASK'; id: string }
}

interface WsState {
  readonly tasks: Map<string, GenTask>
  readonly allTasks: string[]
  /** Runs currently RUNNING (candidates for terminal run events). */
  readonly runningRuns: string[]
  /** Claims currently ACTIVE (candidates for CLAIM_RETRACTED). */
  readonly activeClaims: string[]
  /** Artifacts currently REGISTERED (candidates for ARTIFACT_MARKED_MISSING). */
  readonly registeredArtifacts: string[]
  /** Relations currently ACTIVE (candidates for RELATION_REMOVED). */
  readonly activeRelations: GenRelation[]
  /** Milestones still PLANNED (candidates for MILESTONE_ACHIEVED — terminal). */
  readonly pendingMilestones: string[]
  /** Per-WS seq counter (validation envelope only; the store assigns its own). */
  seq: number
}

/**
 * Generator-owned state snapshot: a MUTABLE mirror of `HistoryObjectContext`.
 * The registry's ctx is read-only by contract (validateEvent NEVER writes —
 * that is the TC-HIST-001 no-side-effect half), so the generator maintains
 * its own live copy and hands it to the validator through the read-only
 * surface (the cast is sound: every field is only read by the validator).
 */
interface MutableCtx {
  workstreams: Map<string, { topicId: string; lifecycle: string }>
  tasks: Map<
    string,
    { workstreamId: string; execution: TaskExecution; validation: TaskValidation; acceptanceCriteria: string[] }
  >
  runs: Map<string, { workstreamId: string; status: string }>
  claims: Map<string, { workstreamId: string; status: string }>
  facts: Map<string, { workstreamId: string }>
  artifacts: Map<string, { workstreamId: string; status: string }>
  relations: Map<
    string,
    { status: string; source: { kind: string; id: string }; relationType: string; target: { kind: string; id: string } }
  >
  gates: Map<string, { workstreamId: string; lastResult: string | null }>
  milestones: Map<string, { workstreamId: string; status: string }>
  interventions: Map<string, { workstreamIds: string[] }>
  topologyEdges: Map<
    string,
    { topicId: string; operation: string; lifecycle: string; inputs: string[]; outputs: string[] }
  >
}

/**
 * Generate a deterministic synthetic dataset of `count` VALID event
 * positions (every emitted row passes full `validateEvent` against the real
 * frozen registry with the incrementally maintained ctx snapshot).
 */
export function generatePerfDataset(opts: { count: number; seed?: number }): PerfDataset {
  const count = opts.count
  const seed = opts.seed ?? 0x5eed
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error(`generatePerfDataset: count must be a positive safe integer (got ${String(count)})`)
  }
  const rand = mulberry32(seed)
  const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)
  if (!registry.isUsable) {
    throw new Error(`generatePerfDataset: registry unusable: ${registry.loadErrors.map((e) => e.code).join(', ')}`)
  }

  // ---- seed the operational state snapshot (ctx) ---------------------------
  const ctx: MutableCtx = {
    workstreams: new Map(
      ALL_WS.map((ws) => [
        ws,
        { topicId: 'TPC-1', lifecycle: ws === FORK_WS || ws === MERGE_WS ? 'PLANNED' : 'REALIZED' },
      ]),
    ),
    tasks: new Map(),
    runs: new Map(),
    claims: new Map(),
    facts: new Map(),
    artifacts: new Map(),
    relations: new Map(),
    gates: new Map(),
    milestones: new Map(),
    interventions: new Map(),
    topologyEdges: new Map([
      [FORK_EDGE_ID, { topicId: 'TPC-1', operation: 'FORK', lifecycle: 'PLANNED', inputs: [...FORK_EDGE.inputs], outputs: [...FORK_EDGE.outputs] }],
      [MERGE_EDGE_ID, { topicId: 'TPC-1', operation: 'MERGE', lifecycle: 'PLANNED', inputs: [...MERGE_EDGE.inputs], outputs: [...MERGE_EDGE.outputs] }],
    ]),
  }

  const wsState: Record<string, WsState> = {}
  for (let i = 0; i < ALL_WS.length; i++) {
    const ws = ALL_WS[i]!
    const tasks = new Map<string, GenTask>()
    const allTasks: string[] = []
    for (let t = 0; t < TASKS_PER_WS; t++) {
      const id = `T-${i * TASKS_PER_WS + t + 1}`
      const ac = [`AC ${id} baseline criterion`]
      tasks.set(id, { execution: 'PLANNED', validation: 'PENDING', ac, acVersion: 0 })
      allTasks.push(id)
      ctx.tasks.set(id, { workstreamId: ws, execution: 'PLANNED', validation: 'PENDING', acceptanceCriteria: ac })
    }
    const gates: string[] = []
    for (let g = 0; g < GATES_PER_WS; g++) {
      const id = `G-${i * GATES_PER_WS + g + 1}`
      gates.push(id)
      ctx.gates.set(id, { workstreamId: ws, lastResult: null })
    }
    const pendingMilestones: string[] = []
    for (let m = 0; m < MILESTONES_PER_WS; m++) {
      const id = `M-${i * MILESTONES_PER_WS + m + 1}`
      pendingMilestones.push(id)
      ctx.milestones.set(id, { workstreamId: ws, status: 'PLANNED' })
    }
    wsState[ws] = {
      tasks,
      allTasks,
      runningRuns: [],
      activeClaims: [],
      registeredArtifacts: [],
      activeRelations: [],
      pendingMilestones,
      seq: 0,
    }
  }

  // ---- project-global id counters ------------------------------------------
  const next = { run: 0, claim: 0, fact: 0, artifact: 0, relation: 0, intervention: 0, event: 0 }
  /** The most recent Run (for AGENT `actor.run_id` — must exist). */
  let lastRunId: string | null = null

  const byType: Record<string, number> = {}
  const byWs: Record<string, number> = {}
  const lateEventIds = new Set<string>()
  /** Late flag of the slot currently being emitted (set per iteration). */
  let slotLate = false
  let lateCount = 0
  let fallbackIdx = 0
  const events: HistoryEventInput[] = []

  const pickType = (): string => {
    let r = rand()
    for (const [type, weight] of TARGET_MIX) {
      if (r < weight) return type
      r -= weight
    }
    return 'FACT_RECORDED'
  }

  /** Pick the emitter for a type (USER / AGENT / PLUGIN per the §4 E column). */
  const pickActor = (type: string): ActorRef => {
    const r = rand()
    if (r < P_USER) return { kind: 'USER', user_id: 'u-perf' }
    if (AGENT_ALLOWED.has(type) && lastRunId !== null && r < P_USER + P_AGENT) {
      return { kind: 'AGENT', run_id: lastRunId }
    }
    // PLUGIN-only types get the PLUGIN share; otherwise fall back to USER.
    if (type === 'ARTIFACT_MARKED_MISSING' || type === 'INTERVENTION_CREATED') {
      return { kind: 'PLUGIN' }
    }
    return { kind: 'USER', user_id: 'u-perf' }
  }

  const randTask = (ws: string): string => wsState[ws]!.allTasks[Math.floor(rand() * TASKS_PER_WS)]!

  /**
   * Validate + emit a batch of rows (usually one; two for the RUNS_STARTED
   * §5.2 fan-out). The seq simulation matches the store's in-row-order
   * per-owner MAX+1 assignment (store.ts ①); ALL rows are validated against
   * the SAME pre-apply ctx — the validator's ctx is the 「事件将变更前的」
   * snapshot of the whole registration (the fan-out rows are ONE atomic
   * registration; validating row 2 after row 1's apply would wrongly see
   * row 1's run ids as existing). `apply` runs once, only after every row
   * is accepted (validation-failure = generator bug ⇒ the dataset is
   * discarded, so the seq increments need no rollback).
   */
  const emitMany = (
    rows: readonly { ws: string; type: string; actor: ActorRef; payload: Record<string, unknown> }[],
    occurredAt: number,
    apply: () => void,
  ): void => {
    const built = rows.map((row) => {
      next.event += 1
      const st = wsState[row.ws]!
      st.seq += 1
      return {
        row,
        candidate: {
          eventId: `H-${next.event}`,
          ownerWorkstreamId: row.ws,
          eventSeq: st.seq,
          eventType: row.type,
          schemaVersion: 1,
          occurredAt,
          recordedAt: occurredAt + 50_000,
          actor: row.actor,
          payload: row.payload,
        },
      }
    })
    for (const b of built) {
      const verdict = validateEvent(registry, b.candidate, ctx as unknown as HistoryObjectContext)
      if (!verdict.ok) {
        throw new Error(
          `generator: event ${b.candidate.eventId} (${b.candidate.eventType} @ ${b.candidate.ownerWorkstreamId}) ` +
            `failed validation: ${JSON.stringify(verdict.errors)}`,
        )
      }
    }
    // all rows accepted: commit the state advance + emit the store-ready rows
    apply()
    for (const b of built) {
      byType[b.row.type] = (byType[b.row.type] ?? 0) + 1
      byWs[b.row.ws] = (byWs[b.row.ws] ?? 0) + 1
      if (slotLate) lateEventIds.add(b.candidate.eventId)
      events.push({
        eventId: b.candidate.eventId,
        ownerWorkstreamId: b.row.ws,
        eventType: b.row.type,
        schemaVersion: 1,
        occurredAt,
        actor: b.row.actor,
        payload: b.row.payload,
      })
    }
  }

  const emit = (
    ws: string,
    type: string,
    occurredAt: number,
    actor: ActorRef,
    payload: Record<string, unknown>,
    apply: () => void,
  ): void => {
    emitMany([{ ws, type, actor, payload }], occurredAt, apply)
  }

  for (let i = 0; i < count; i++) {
    const late = isLateSlot(i)
    if (late) lateCount++
    slotLate = late
    const occurredAt = PERF_T0 + i * STEP_MS - (late ? LATE_OFFSET_MS : 0)

    // ---- forced topology realizations (one per edge, fixed positions) -------
    if (i === FORK_SLOT) {
      const ws = FORK_EDGE.inputs[0]!
      emit(
        ws,
        'TOPOLOGY_FORK_REALIZED',
        occurredAt,
        { kind: 'USER', user_id: 'u-perf' },
        { topology_edge_id: FORK_EDGE_ID, inputs: [...FORK_EDGE.inputs], outputs: [...FORK_EDGE.outputs] },
        () => {
          ctx.topologyEdges.set(FORK_EDGE_ID, {
            topicId: 'TPC-1',
            operation: 'FORK',
            lifecycle: 'REALIZED',
            inputs: [...FORK_EDGE.inputs],
            outputs: [...FORK_EDGE.outputs],
          })
          const out = FORK_EDGE.outputs[0]!
          if (ctx.workstreams.get(out)!.lifecycle === 'PLANNED') {
            ctx.workstreams.set(out, { topicId: 'TPC-1', lifecycle: 'REALIZED' })
          }
        },
      )
      continue
    }
    if (i === MERGE_SLOT) {
      const ws = MERGE_EDGE.outputs[0]!
      emit(
        ws,
        'TOPOLOGY_MERGE_REALIZED',
        occurredAt,
        { kind: 'USER', user_id: 'u-perf' },
        { topology_edge_id: MERGE_EDGE_ID, inputs: [...MERGE_EDGE.inputs], outputs: [...MERGE_EDGE.outputs] },
        () => {
          ctx.topologyEdges.set(MERGE_EDGE_ID, {
            topicId: 'TPC-1',
            operation: 'MERGE',
            lifecycle: 'REALIZED',
            inputs: [...MERGE_EDGE.inputs],
            outputs: [...MERGE_EDGE.outputs],
          })
          const out = MERGE_EDGE.outputs[0]!
          if (ctx.workstreams.get(out)!.lifecycle === 'PLANNED') {
            ctx.workstreams.set(out, { topicId: 'TPC-1', lifecycle: 'REALIZED' })
          }
        },
      )
      continue
    }

    const ws = wsForSlot(i)
    const st = wsState[ws]!

    // ---- pick an event type (target mix; deterministic fallback if the
    //      chosen type has no legal target under the current state) ----------
    const feasible = (type: string): boolean => {
      switch (type) {
        case 'RUN_FINISHED':
        case 'RUN_FAILED':
        case 'RUN_CANCELLED':
          return st.runningRuns.length > 0
        case 'TASK_EXECUTION_CHANGED':
          return st.allTasks.some((id) => {
            const ex = st.tasks.get(id)!.execution
            return ex !== 'EXECUTED' && ex !== 'CANCELLED'
          })
        case 'CLAIM_RETRACTED':
          return st.activeClaims.length > 0
        case 'ARTIFACT_MARKED_MISSING':
          return st.registeredArtifacts.length > 0
        case 'RELATION_REMOVED':
          return st.activeRelations.length > 0
        case 'MILESTONE_ACHIEVED':
          return st.pendingMilestones.length > 0
        default:
          return true // TASK_VALIDATION_CHANGED loops; ACCEPTANCE_* always legal; fresh-id types always legal
      }
    }
    let type = pickType()
    if (!feasible(type)) {
      for (let k = 0; k < ALWAYS_LEGAL.length; k++) {
        const cand = ALWAYS_LEGAL[(fallbackIdx + k) % ALWAYS_LEGAL.length]!
        if (feasible(cand)) {
          type = cand
          break
        }
      }
      fallbackIdx++
    }

    const actor = pickActor(type)
    const agentRun = actor.kind === 'AGENT' ? actor.run_id : undefined

    // ---- build the payload + the DEFERRED state advance (applied only after
    //      validation accepts the event) --------------------------------------
    switch (type) {
      case 'RUN_STARTED': {
        next.run++
        const runId = `R-${next.run}`
        emit(
          ws,
          type,
          occurredAt,
          actor,
          {
            run_id: runId,
            task_id: randTask(ws),
            initiated_by: { kind: 'USER', user_id: 'u-perf' },
          },
          () => {
            ctx.runs.set(runId, { workstreamId: ws, status: 'RUNNING' })
            st.runningRuns.push(runId)
            lastRunId = runId
          },
        )
        break
      }
      case 'RUNS_STARTED': {
        // catalog §5.2 信封特例: one SAME-PAYLOAD event per relevant owner WS.
        // Two distinct owners, each contributing one fresh run (its task in
        // its own WS); ≥2 runs (schema minItems — 1 run ⇒ RUN_STARTED).
        next.run += 2
        const runA = `R-${next.run - 1}`
        const runB = `R-${next.run}`
        let wsB = BASE_WS[Math.floor(rand() * BASE_WS.length)]!
        if (wsB === ws) wsB = BASE_WS[(BASE_WS.indexOf(ws) + 1) % BASE_WS.length]!
        const taskA = randTask(ws)
        const taskB = randTask(wsB)
        const payload = {
          runs: [
            { run_id: runA, task_id: taskA, intent: 'perf batch: split A' },
            { run_id: runB, task_id: taskB, intent: 'perf batch: split B' },
          ],
        }
        const batchActor: ActorRef = { kind: 'USER', user_id: 'u-perf' } // E column: U P
        // Rows ordered alphabetically by owner (ws first, then wsB) — the
        // store assigns per-owner seqs in row order.
        const [firstWs, secondWs] = ws < wsB ? [ws, wsB] : [wsB, ws]
        emitMany(
          [
            { ws: firstWs, type, actor: batchActor, payload },
            { ws: secondWs, type, actor: batchActor, payload },
          ],
          occurredAt,
          () => {
            ctx.runs.set(runA, { workstreamId: ws, status: 'RUNNING' })
            st.runningRuns.push(runA)
            ctx.runs.set(runB, { workstreamId: wsB, status: 'RUNNING' })
            wsState[wsB]!.runningRuns.push(runB)
            lastRunId = runB
          },
        )
        break
      }
      case 'RUN_FINISHED': {
        const runId = st.runningRuns.shift()!
        emit(ws, type, occurredAt, actor, { run_id: runId, outcome_summary: `perf run ${runId} converged` }, () => {
          ctx.runs.set(runId, { workstreamId: ws, status: 'FINISHED' })
        })
        break
      }
      case 'RUN_FAILED': {
        const runId = st.runningRuns.shift()!
        const kind = rand() < 0.5 ? 'OOM' : 'DATA_MISSING'
        emit(
          ws,
          type,
          occurredAt,
          actor,
          { run_id: runId, error_summary: `perf run ${runId} crashed`, failure_kind: kind },
          () => {
            ctx.runs.set(runId, { workstreamId: ws, status: 'FAILED' })
          },
        )
        break
      }
      case 'RUN_CANCELLED': {
        const runId = st.runningRuns.shift()!
        emit(
          ws,
          type,
          occurredAt,
          actor,
          { run_id: runId, reason: 'perf: superseded by a rerun', cancelled_by: { kind: 'USER', user_id: 'u-perf' } },
          () => {
            ctx.runs.set(runId, { workstreamId: ws, status: 'CANCELLED' })
          },
        )
        break
      }
      case 'TASK_EXECUTION_CHANGED': {
        const start = Math.floor(rand() * TASKS_PER_WS)
        let taskId = ''
        let from: TaskExecution = 'PLANNED'
        let to: TaskExecution = 'ACTIVE'
        for (let k = 0; k < TASKS_PER_WS; k++) {
          const id = st.allTasks[(start + k) % TASKS_PER_WS]!
          const t = st.tasks.get(id)!
          if (t.execution !== 'EXECUTED' && t.execution !== 'CANCELLED') {
            taskId = id
            from = t.execution
            const targets: readonly [TaskExecution, number][] =
              from === 'PLANNED'
                ? [
                    ['ACTIVE', 0.6],
                    ['EXECUTED', 0.3],
                    ['CANCELLED', 0.1],
                  ]
                : from === 'ACTIVE'
                  ? [
                      ['PAUSED', 0.3],
                      ['EXECUTED', 0.5],
                      ['CANCELLED', 0.2],
                    ]
                  : [
                      ['ACTIVE', 0.5],
                      ['EXECUTED', 0.4],
                      ['CANCELLED', 0.1],
                    ]
            let pick = rand()
            to = targets[targets.length - 1]![0]
            for (const [cand, w] of targets) {
              if (pick < w) {
                to = cand
                break
              }
              pick -= w
            }
            break
          }
        }
        if (taskId === '') throw new Error('generator: TASK_EXECUTION_CHANGED passed feasibility but found no candidate')
        emit(
          ws,
          type,
          occurredAt,
          { kind: 'USER', user_id: 'u-perf' }, // USER-only emitter (§4 E)
          { task_id: taskId, from, to, reason: `perf transition ${from} → ${to}` },
          () => {
            const task = st.tasks.get(taskId)!
            task.execution = to
            const snap = ctx.tasks.get(taskId)!
            ctx.tasks.set(taskId, { ...snap, execution: to })
          },
        )
        break
      }
      case 'TASK_VALIDATION_CHANGED': {
        const taskId = randTask(ws)
        const from = st.tasks.get(taskId)!.validation
        const to: TaskValidation =
          from === 'PENDING' ? 'UNDER_REVIEW' : from === 'UNDER_REVIEW' ? (rand() < 0.8 ? 'PASSED' : 'FAILED') : 'PENDING'
        emit(
          ws,
          type,
          occurredAt,
          { kind: 'USER', user_id: 'u-perf' }, // USER-only emitter (§4 E)
          { task_id: taskId, from, to, note: 'perf validation cycle' },
          () => {
            const task = st.tasks.get(taskId)!
            task.validation = to
            const snap = ctx.tasks.get(taskId)!
            ctx.tasks.set(taskId, { ...snap, validation: to })
          },
        )
        break
      }
      case 'ACCEPTANCE_CRITERIA_CHANGED': {
        const taskId = randTask(ws)
        const task = st.tasks.get(taskId)!
        const from = [...task.ac]
        task.acVersion += 1
        const to =
          rand() < 0.5
            ? [...task.ac, `AC ${taskId} refinement v${task.acVersion}`]
            : task.ac.slice(0, -1).concat(`AC ${taskId} revised v${task.acVersion}`)
        emit(
          ws,
          type,
          occurredAt,
          { kind: 'USER', user_id: 'u-perf' }, // USER-only emitter (§4 E)
          { task_id: taskId, from, to },
          () => {
            task.ac = to
            const snap = ctx.tasks.get(taskId)!
            ctx.tasks.set(taskId, { ...snap, acceptanceCriteria: to })
          },
        )
        break
      }
      case 'FACT_RECORDED': {
        next.fact++
        const factId = `F-${next.fact}`
        emit(
          ws,
          type,
          occurredAt,
          actor,
          {
            fact_id: factId,
            statement: `perf fact ${factId}: epoch ${next.fact} metric within tolerance`,
            ...(AGENT_NEEDS_CREATED_BY_RUN.has(type) && agentRun !== undefined ? { created_by_run: agentRun } : {}),
          },
          () => {
            ctx.facts.set(factId, { workstreamId: ws })
          },
        )
        break
      }
      case 'CLAIM_RECORDED': {
        next.claim++
        const claimId = `C-${next.claim}`
        emit(
          ws,
          type,
          occurredAt,
          actor,
          {
            claim_id: claimId,
            statement: `perf claim ${claimId}: the sweep generalizes to split ${next.claim % 7}`,
            ...(AGENT_NEEDS_CREATED_BY_RUN.has(type) && agentRun !== undefined ? { created_by_run: agentRun } : {}),
          },
          () => {
            ctx.claims.set(claimId, { workstreamId: ws, status: 'ACTIVE' })
            st.activeClaims.push(claimId)
          },
        )
        break
      }
      case 'CLAIM_RETRACTED': {
        const claimId = st.activeClaims.shift()!
        emit(
          ws,
          type,
          occurredAt,
          actor,
          { claim_id: claimId, reason: 'perf: superseded by a later ablation' },
          () => {
            ctx.claims.set(claimId, { workstreamId: ws, status: 'RETRACTED' })
          },
        )
        break
      }
      case 'ARTIFACT_REGISTERED': {
        next.artifact++
        const artifactId = `A-${next.artifact}`
        emit(
          ws,
          type,
          occurredAt,
          actor,
          {
            artifact_id: artifactId,
            type: ARTIFACT_TYPES[next.artifact % ARTIFACT_TYPES.length],
            title: `perf artifact ${artifactId}`,
            uri: `artifacts/${artifactId}/`,
            related_task: randTask(ws),
            ...(agentRun !== undefined ? { created_by_run: agentRun } : {}),
          },
          () => {
            ctx.artifacts.set(artifactId, { workstreamId: ws, status: 'REGISTERED' })
            st.registeredArtifacts.push(artifactId)
          },
        )
        break
      }
      case 'ARTIFACT_MARKED_MISSING': {
        const artifactId = st.registeredArtifacts.shift()!
        emit(
          ws,
          type,
          occurredAt,
          actor,
          {
            artifact_id: artifactId,
            reason: 'perf: file vanished during audit',
            ...(actor.kind === 'PLUGIN' ? { detected_by: { kind: 'PLUGIN', label: 'audit-sweep' } } : {}),
          },
          () => {
            ctx.artifacts.set(artifactId, { workstreamId: ws, status: 'MISSING' })
          },
        )
        break
      }
      case 'RELATION_ADDED': {
        next.relation++
        const relationId = `REL-${next.relation}`
        const srcIdx = Math.floor(rand() * TASKS_PER_WS)
        let tgtIdx = Math.floor(rand() * TASKS_PER_WS)
        if (tgtIdx === srcIdx) tgtIdx = (tgtIdx + 1) % TASKS_PER_WS
        const source = { kind: 'TASK' as const, id: st.allTasks[srcIdx]! }
        const target = { kind: 'TASK' as const, id: st.allTasks[tgtIdx]! }
        emit(
          ws,
          type,
          occurredAt,
          actor,
          { relation_id: relationId, source, relation_type: 'DEPENDS_ON', target },
          () => {
            ctx.relations.set(relationId, { status: 'ACTIVE', source, relationType: 'DEPENDS_ON', target })
            st.activeRelations.push({ id: relationId, source, relationType: 'DEPENDS_ON', target })
          },
        )
        break
      }
      case 'RELATION_REMOVED': {
        const rel = st.activeRelations.shift()!
        emit(
          ws,
          type,
          occurredAt,
          actor,
          {
            relation_id: rel.id,
            source: rel.source,
            relation_type: rel.relationType,
            target: rel.target,
            reason: 'perf: dependency dropped after the refactor',
          },
          () => {
            ctx.relations.set(rel.id, {
              status: 'REMOVED',
              source: rel.source,
              relationType: rel.relationType,
              target: rel.target,
            })
          },
        )
        break
      }
      case 'GATE_EVALUATED': {
        const gateId = `G-${ALL_WS.indexOf(ws) * GATES_PER_WS + (Math.floor(rand() * GATES_PER_WS) + 1)}`
        const results: readonly [GateResult, number][] = [
          ['PASSED', 0.6],
          ['FAILED', 0.3],
          ['WAIVED', 0.1],
        ]
        let pick = rand()
        let result: GateResult = 'PASSED'
        for (const [cand, w] of results) {
          if (pick < w) {
            result = cand
            break
          }
          pick -= w
        }
        // WAIVED requires USER + non-empty note (catalog §5.6) — the actor is
        // always USER for GATE_EVALUATED (§4 E: U only), so a note suffices.
        emit(
          ws,
          type,
          occurredAt,
          { kind: 'USER', user_id: 'u-perf' },
          {
            gate_id: gateId,
            result,
            evaluated_by: { kind: 'USER', user_id: 'u-gate' },
            ...(result === 'WAIVED' ? { note: 'perf: waived for the V1 baseline' } : {}),
          },
          () => {
            ctx.gates.set(gateId, { workstreamId: ws, lastResult: result })
          },
        )
        break
      }
      case 'MILESTONE_ACHIEVED': {
        const milestoneId = st.pendingMilestones.shift()!
        emit(
          ws,
          type,
          occurredAt,
          { kind: 'USER', user_id: 'u-perf' }, // USER-only emitter (§4 E)
          { milestone_id: milestoneId, note: 'perf: milestone baseline met' },
          () => {
            ctx.milestones.set(milestoneId, { workstreamId: ws, status: 'ACHIEVED' })
          },
        )
        break
      }
      case 'INTERVENTION_CREATED': {
        next.intervention++
        const interventionId = `IV-${next.intervention}`
        const origin =
          actor.kind === 'PLUGIN' ? (rand() < 0.5 ? 'AUTO_FLOODING' : 'AUTO_AUDIT') : actor.kind === 'AGENT' ? 'AGENT_REPORT' : 'USER'
        const sourceRefs = [{ kind: 'TASK' as const, id: randTask(ws) }]
        emit(
          ws,
          type,
          occurredAt,
          actor,
          {
            intervention_id: interventionId,
            title: `perf intervention ${interventionId}: metric drift on split ${next.intervention % 5}`,
            origin,
            source_refs: sourceRefs,
          },
          () => {
            ctx.interventions.set(interventionId, { workstreamIds: [ws] })
          },
        )
        break
      }
      default: {
        throw new Error(`generator: no payload builder for event type ${type} (exhaustiveness bug)`)
      }
    }
  }

  return {
    events,
    slots: count,
    workstreams: ALL_WS,
    byType,
    byWs,
    lateCount,
    lateRule: [LATE_EVERY, LATE_PHASE],
    lateEventIds,
    seed,
  }
}
