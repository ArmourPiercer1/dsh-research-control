/**
 * WP-2.8 — TC-PERF-001..005 synthetic event dataset generator (test infra).
 *
 * TEST_MATRIX §3.7 TC-PERF-001/002/004/005 的数据面：确定性（固定种子）合成
 * 10k 事件数据集，事件类型分布混合 RUN_* / TASK_* / CLAIM_* / FACT_* /
 * ARTIFACT_* / RELATION_* 六大族，并注入 late registration 形态
 * （occurredAt 早于既有事件，登记位置却在尾部 — catalog §1 L32 / TC-HIST-002
 * store 半边）。
 *
 * 「合法形态」的验证口径（任务书：合成事件需过校验）：每个事件在生成时即过
 * **完整 `validateEvent`**（真实冻结 schema 目录 + 逐步维护的 HistoryObjectContext
 * 快照：emitter 矩阵 / owner 规则 / 引用存在 / 迁移一致性 INV-HIST-5 /
 * 交叉字段规则 — WP-2.2 全量校验，不止 checkShape）。生成器对 ctx 的推进
 * 严格发生在校验通过**之后**（validateEvent 的 ctx 是「事件将变更前的」只读
 * 快照 — 新建事件校验时新 id 必须尚不存在）；任一事件校验失败 = 生成器 bug，
 * 立即抛错（数据集不合法则性能数字无意义）。
 *
 * 输出的是 store 输入形态 `HistoryEventInput`（**不含** store-owned 的
 * `eventSeq`/`recordedAt` — 那是 WP-2.1 事务内分配）；校验用的临时信封字段
 * 在产出时剥离。
 *
 * 确定性：mulberry32(seed) PRNG + 固定权重分布 + `ws = i % 5` 轮转 +
 * late 注入规则 `i % 53 === 11`（≈1.9%）。同种子 ⇒ 逐字节同数据集
 * （1k 数据集 = 10k 数据集的**前缀**，前缀流自身合法 — 供 TC-PERF-004/005
 * 的 1k vs 10k 规模对比）。
 *
 * 时间线：base = PERF_T0 + i × 60s（每分钟一件，10k ≈ 6.9 天）；late 事件
 * 回拨 2h。seq 轴（append 序）≈ 时间轴（occurredAt 大体单调），使
 * TC-PERF-004 的「连续 seq 窗口」同时是「连续时间窗口」。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { HistoryEventInput } from '../../src/host/persistence/store/index.js'
import {
  loadHistoryEventRegistry,
  validateEvent,
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
const LATE_EVERY = 53
const LATE_PHASE = 11

/** Workstreams in the synthetic project (one topic). */
const WS_COUNT = 5
/** Pre-existing tasks per workstream (tasks come from the declarative plan,
 *  not from history events — seeded in ctx, then mutated by TASK_* events). */
const TASKS_PER_WS = 300

export interface PerfDataset {
  /** Store-ready events (no eventSeq/recordedAt), append order = audit order. */
  readonly events: readonly HistoryEventInput[]
  /** The 5 owner workstreams. */
  readonly workstreams: readonly string[]
  /** Realized event-type distribution (target mix vs fallback rotation). */
  readonly byType: Readonly<Record<string, number>>
  /** Events whose occurredAt was pulled 2h earlier (late registration). */
  readonly lateCount: number
  readonly seed: number
}

interface GenTask {
  execution: TaskExecution
  validation: TaskValidation
  /** Current AC snapshot (kept non-empty ⇒ to=NOT_REQUIRED stays illegal, INV-TASK-3). */
  ac: string[]
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
  /** Runs currently RUNNING (candidates for RUN_FINISHED). */
  readonly runningRuns: string[]
  /** Claims currently ACTIVE (candidates for CLAIM_RETRACTED). */
  readonly activeClaims: string[]
  /** Artifacts currently REGISTERED (candidates for ARTIFACT_MARKED_MISSING). */
  readonly registeredArtifacts: string[]
  /** Relations currently ACTIVE (candidates for RELATION_REMOVED). */
  readonly activeRelations: GenRelation[]
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
  gates: Map<string, unknown>
  milestones: Map<string, unknown>
  interventions: Map<string, unknown>
  topologyEdges: Map<string, unknown>
}

/** Target distribution (weights sum to EXACTLY 1.0 — guarded at load; a
 *  sum > 1 silently makes the tail types unreachable, cf. WP-2.8 run 1 where
 *  RELATION_REMOVED never fired). Six required families. */
const TARGET_MIX: ReadonlyArray<readonly [string, number]> = [
  ['RUN_STARTED', 0.15],
  ['RUN_FINISHED', 0.14],
  ['TASK_EXECUTION_CHANGED', 0.13],
  ['TASK_VALIDATION_CHANGED', 0.08],
  ['CLAIM_RECORDED', 0.1],
  ['CLAIM_RETRACTED', 0.05],
  ['FACT_RECORDED', 0.11],
  ['ARTIFACT_REGISTERED', 0.09],
  ['ARTIFACT_MARKED_MISSING', 0.04],
  ['RELATION_ADDED', 0.07],
  ['RELATION_REMOVED', 0.04],
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

const ARTIFACT_TYPES = ['DATASET', 'FIGURE', 'MODEL', 'CODE', 'REPORT', 'NOTE'] as const

/**
 * One event's payload + the deferred state advance. `apply` runs ONLY after
 * `validateEvent` accepts the event (the validator's ctx must be the
 * PRE-event snapshot — a fresh id must not exist yet, a mutation's `from`
 * must still be the current state).
 */
interface BuiltCase {
  readonly payload: Record<string, unknown>
  readonly apply: () => void
}

/**
 * Generate a deterministic synthetic dataset of `count` VALID events
 * (every event passes full `validateEvent` against the real frozen registry
 * with the incrementally maintained ctx snapshot).
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

  const workstreams = Array.from({ length: WS_COUNT }, (_, i) => `WS-${i + 1}`)

  // ---- seed the operational state snapshot (ctx) ---------------------------
  const ctx: MutableCtx = {
    workstreams: new Map(workstreams.map((ws) => [ws, { topicId: 'TPC-1', lifecycle: 'REALIZED' }])),
    tasks: new Map(),
    runs: new Map(),
    claims: new Map(),
    facts: new Map(),
    artifacts: new Map(),
    relations: new Map(),
    gates: new Map(),
    milestones: new Map(),
    interventions: new Map(),
    topologyEdges: new Map(),
  }

  const wsState: Record<string, WsState> = {}
  for (let i = 0; i < WS_COUNT; i++) {
    const ws = workstreams[i]!
    const tasks = new Map<string, GenTask>()
    const allTasks: string[] = []
    for (let t = 0; t < TASKS_PER_WS; t++) {
      const id = `T-${i * TASKS_PER_WS + t + 1}`
      const ac = [`AC ${id} baseline criterion`]
      tasks.set(id, { execution: 'PLANNED', validation: 'PENDING', ac })
      allTasks.push(id)
      ctx.tasks.set(id, { workstreamId: ws, execution: 'PLANNED', validation: 'PENDING', acceptanceCriteria: ac })
    }
    wsState[ws] = {
      tasks,
      allTasks,
      runningRuns: [],
      activeClaims: [],
      registeredArtifacts: [],
      activeRelations: [],
      seq: 0,
    }
  }

  // ---- project-global id counters ------------------------------------------
  const next = { run: 0, claim: 0, fact: 0, artifact: 0, relation: 0 }

  const byType: Record<string, number> = {}
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

  const isLate = (i: number): boolean => i % LATE_EVERY === LATE_PHASE

  for (let i = 0; i < count; i++) {
    const ws = workstreams[i % WS_COUNT]!
    const st = wsState[ws]!

    // ---- pick an event type (target mix; deterministic fallback if the
    //      chosen type has no legal target under the current state) ----------
    const feasible = (type: string): boolean => {
      switch (type) {
        case 'RUN_FINISHED':
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
        default:
          return true // TASK_VALIDATION_CHANGED loops (PASSED/FAILED→PENDING); fresh-id types always legal
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

    const late = isLate(i)
    if (late) lateCount++
    const occurredAt = PERF_T0 + i * STEP_MS - (late ? LATE_OFFSET_MS : 0)
    st.seq += 1

    // ---- build the payload (candidate selection) + the DEFERRED state
    //      advance (applied only after validation accepts the event) -------
    let built: BuiltCase | undefined
    switch (type) {
      case 'RUN_STARTED': {
        next.run++
        const runId = `R-${next.run}`
        built = {
          payload: {
            run_id: runId,
            task_id: st.allTasks[Math.floor(rand() * st.allTasks.length)],
            initiated_by: { kind: 'USER', user_id: 'u-perf' },
          },
          apply: () => {
            ctx.runs.set(runId, { workstreamId: ws, status: 'RUNNING' })
            st.runningRuns.push(runId)
          },
        }
        break
      }
      case 'RUN_FINISHED': {
        const runId = st.runningRuns.shift()!
        built = {
          payload: { run_id: runId, outcome_summary: `perf run ${runId} converged` },
          apply: () => {
            ctx.runs.set(runId, { workstreamId: ws, status: 'FINISHED' })
          },
        }
        break
      }
      case 'TASK_EXECUTION_CHANGED': {
        const start = Math.floor(rand() * st.allTasks.length)
        let taskId = ''
        let from: TaskExecution = 'PLANNED'
        let to: TaskExecution = 'ACTIVE'
        for (let k = 0; k < st.allTasks.length; k++) {
          const id = st.allTasks[(start + k) % st.allTasks.length]!
          const t = st.tasks.get(id)!
          if (t.execution !== 'EXECUTED' && t.execution !== 'CANCELLED') {
            taskId = id
            from = t.execution
            const targets: readonly TaskExecution[] =
              from === 'PLANNED'
                ? ['ACTIVE', 'EXECUTED']
                : from === 'ACTIVE'
                  ? ['PAUSED', 'EXECUTED']
                  : ['ACTIVE', 'EXECUTED']
            to = targets[Math.floor(rand() * targets.length)]!
            break
          }
        }
        if (taskId === '') throw new Error('generator: TASK_EXECUTION_CHANGED passed feasibility but found no candidate')
        built = {
          payload: { task_id: taskId, from, to, reason: `perf transition ${from} → ${to}` },
          apply: () => {
            const task = st.tasks.get(taskId)!
            task.execution = to
            const snap = ctx.tasks.get(taskId)!
            ctx.tasks.set(taskId, { ...snap, execution: to })
          },
        }
        break
      }
      case 'TASK_VALIDATION_CHANGED': {
        const taskId = st.allTasks[Math.floor(rand() * st.allTasks.length)]!
        const from = st.tasks.get(taskId)!.validation
        const to: TaskValidation =
          from === 'PENDING' ? 'UNDER_REVIEW' : from === 'UNDER_REVIEW' ? (rand() < 0.8 ? 'PASSED' : 'FAILED') : 'PENDING'
        built = {
          payload: { task_id: taskId, from, to, note: 'perf validation cycle' },
          apply: () => {
            const task = st.tasks.get(taskId)!
            task.validation = to
            const snap = ctx.tasks.get(taskId)!
            ctx.tasks.set(taskId, { ...snap, validation: to })
          },
        }
        break
      }
      case 'CLAIM_RECORDED': {
        next.claim++
        const claimId = `C-${next.claim}`
        built = {
          payload: {
            claim_id: claimId,
            statement: `perf claim ${claimId}: the sweep generalizes to split ${next.claim % 7}`,
          },
          apply: () => {
            ctx.claims.set(claimId, { workstreamId: ws, status: 'ACTIVE' })
            st.activeClaims.push(claimId)
          },
        }
        break
      }
      case 'CLAIM_RETRACTED': {
        const claimId = st.activeClaims.shift()!
        built = {
          payload: { claim_id: claimId, reason: 'perf: superseded by a later ablation' },
          apply: () => {
            ctx.claims.set(claimId, { workstreamId: ws, status: 'RETRACTED' })
          },
        }
        break
      }
      case 'FACT_RECORDED': {
        next.fact++
        const factId = `F-${next.fact}`
        built = {
          payload: {
            fact_id: factId,
            statement: `perf fact ${factId}: epoch ${next.fact} metric within tolerance`,
          },
          apply: () => {
            ctx.facts.set(factId, { workstreamId: ws })
          },
        }
        break
      }
      case 'ARTIFACT_REGISTERED': {
        next.artifact++
        const artifactId = `A-${next.artifact}`
        built = {
          payload: {
            artifact_id: artifactId,
            type: ARTIFACT_TYPES[next.artifact % ARTIFACT_TYPES.length],
            title: `perf artifact ${artifactId}`,
            uri: `artifacts/${artifactId}/`,
            related_task: st.allTasks[Math.floor(rand() * st.allTasks.length)],
          },
          apply: () => {
            ctx.artifacts.set(artifactId, { workstreamId: ws, status: 'REGISTERED' })
            st.registeredArtifacts.push(artifactId)
          },
        }
        break
      }
      case 'ARTIFACT_MARKED_MISSING': {
        const artifactId = st.registeredArtifacts.shift()!
        built = {
          payload: { artifact_id: artifactId, reason: 'perf: file vanished during audit' },
          apply: () => {
            ctx.artifacts.set(artifactId, { workstreamId: ws, status: 'MISSING' })
          },
        }
        break
      }
      case 'RELATION_ADDED': {
        next.relation++
        const relationId = `REL-${next.relation}`
        const srcIdx = Math.floor(rand() * st.allTasks.length)
        let tgtIdx = Math.floor(rand() * st.allTasks.length)
        if (tgtIdx === srcIdx) tgtIdx = (tgtIdx + 1) % st.allTasks.length
        const source = { kind: 'TASK' as const, id: st.allTasks[srcIdx]! }
        const target = { kind: 'TASK' as const, id: st.allTasks[tgtIdx]! }
        built = {
          payload: {
            relation_id: relationId,
            source,
            relation_type: 'DEPENDS_ON',
            target,
          },
          apply: () => {
            ctx.relations.set(relationId, { status: 'ACTIVE', source, relationType: 'DEPENDS_ON', target })
            st.activeRelations.push({ id: relationId, source, relationType: 'DEPENDS_ON', target })
          },
        }
        break
      }
      case 'RELATION_REMOVED': {
        const rel = st.activeRelations.shift()!
        built = {
          payload: {
            relation_id: rel.id,
            source: rel.source,
            relation_type: rel.relationType,
            target: rel.target,
            reason: 'perf: dependency dropped after the refactor',
          },
          apply: () => {
            ctx.relations.set(rel.id, {
              status: 'REMOVED',
              source: rel.source,
              relationType: rel.relationType,
              target: rel.target,
            })
          },
        }
        break
      }
    }

    // ---- full validation gate (WP-2.2 validateEvent, real frozen schema) ---
    // against the PRE-event snapshot (built.apply has NOT run yet).
    if (built === undefined) {
      throw new Error(`generator: no payload builder for event type ${type} (exhaustiveness bug)`)
    }
    const candidate = {
      eventId: `H-${i + 1}`,
      ownerWorkstreamId: ws,
      eventSeq: st.seq,
      eventType: type,
      schemaVersion: 1,
      occurredAt,
      recordedAt: occurredAt + 50_000,
      actor: { kind: 'USER', user_id: 'u-perf' },
      payload: built.payload,
    }
    const verdict = validateEvent(registry, candidate, ctx as unknown as HistoryObjectContext)
    if (!verdict.ok) {
      throw new Error(
        `generator: event ${candidate.eventId} (${type} @ ${ws}) failed validation: ` +
          JSON.stringify(verdict.errors),
      )
    }

    // ---- validation accepted: commit the state advance + emit the event ---
    built.apply()
    byType[type] = (byType[type] ?? 0) + 1
    // Store-ready form: strip the two store-owned envelope fields.
    events.push({
      eventId: `H-${i + 1}`,
      ownerWorkstreamId: ws,
      eventType: type,
      schemaVersion: 1,
      occurredAt,
      actor: { kind: 'USER', user_id: 'u-perf' },
      payload: built.payload,
    })
  }

  return { events, workstreams, byType, lateCount, seed }
}
