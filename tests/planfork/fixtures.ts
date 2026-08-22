/**
 * WP-3.1 test infrastructure — port fakes over the REAL frozen schemas.
 *
 *  - declarative side: the WP-1.1 fixture tree (`baseTreeFiles`) + the REAL
 *    frozen declarative schemas (`realSchemaFiles`) through `MemoryReader`
 *    (WS-1 canonical plan = §11 初始 canonical: G-1, T-1, T-2, T-3, M-1,
 *    T-4, G-2 — all 7 definition files present);
 *  - operational side: the REAL frozen `schema/operational/*.schema.json`
 *    (plan-fork + provenance + parent common) for `loadPlanForkSchemas`;
 *  - `CanonicalPlanProvider` backed by the REAL WP-1.3 `PlanStore`
 *    (loadPlan — the production canonical-load path);
 *  - `ClosureBlobCapturer` = deterministic content-hash fake (sha1 hex —
 *    40 chars, the frozen git_blob_oid pattern; a file the plan view
 *    claims but the reader lacks ⇒ throw ⇒ PF_BASE_CAPTURE 可测);
 *  - `FormalRunLookup` / `TriggerRefResolver` = map/set fakes (seeded with
 *    the §11 example: run R-81 of WS-1; fact F-31 exists);
 *  - clock = deterministic monotonic epoch-ms sequence.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { IdAllocator } from '../../src/shared/ids/index.js'
import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import { PlanStore } from '../../src/host/domain/plan/index.js'
import {
  loadPlanForkSchemas,
  type PlanForkSchemas,
} from '../../src/host/domain/planfork/index.js'
import {
  loadPlanForkPolicy,
  type AgentPlanForkPolicy,
} from '../../src/host/domain/planfork/index.js'
import type {
  CanonicalPlanProvider,
  CanonicalPlanView,
  ClosureBlobCapturer,
  ClosureBlobBase,
  FormalRunLookup,
  FormalRunView,
  PlanForkRecord,
  ProposedItem,
  TriggerRef,
  TriggerRefResolver,
  CreatePlanForkParams,
} from '../../src/host/domain/planfork/index.js'
import type { PlanForkCreationContext } from '../../src/host/domain/planfork/create.js'
import {
  MEM_RESEARCH_ROOT,
  MEM_SCHEMA_DIR,
  WR_ROOT,
  baseTreeFiles,
  makeReader,
  realSchemaFiles,
} from '../loader/fixtures.js'
import { MemoryReader } from '../loader/memory-reader.js'

// Re-exports for the test files (single import surface).
export { MEM_RESEARCH_ROOT, MEM_SCHEMA_DIR, baseTreeFiles, makeReader } from '../loader/fixtures.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The real frozen operational schema dir (WR schema/operational). */
export const WR_OPERATIONAL_SCHEMA_DIR = join(WR_ROOT, 'schema', 'operational')
/** In-memory mirror path of the operational dir (reader keys). */
export const MEM_OPERATIONAL_SCHEMA_DIR = '/mem/wr/schema/operational'

/** 2026-08-22T10:00:00Z — the deterministic creation clock origin. */
export const T_CREATE = Date.parse('2026-08-22T10:00:00Z')

/** A fixed 40-hex commit-ish constant (informational base_git_commit). */
export const FAKE_HEAD = 'a'.repeat(39) + 'b'

/** Deterministic git-blob-like OID for content (sha1 hex — 40 chars). */
export function fakeBlobOid(content: string): string {
  return createHash('sha1').update(content, 'utf8').digest('hex')
}

let operationalSchemaCache: Record<string, string> | null = null

/** The REAL frozen operational schemas (plan-fork + provenance + parent common). */
export function realOperationalSchemaFiles(): Record<string, string> {
  if (operationalSchemaCache !== null) return operationalSchemaCache
  const out: Record<string, string> = {}
  for (const f of readdirSync(WR_OPERATIONAL_SCHEMA_DIR).sort()) {
    out[`${MEM_OPERATIONAL_SCHEMA_DIR}/${f}`] = readFileSync(join(WR_OPERATIONAL_SCHEMA_DIR, f), 'utf8')
  }
  out[`${MEM_OPERATIONAL_SCHEMA_DIR}/../common.schema.json`] = readFileSync(join(WR_ROOT, 'schema', 'common.schema.json'), 'utf8')
  operationalSchemaCache = out
  return out
}

/* ------------------------------------------------------------------ *
 * Canonical plan provider — REAL WP-1.3 PlanStore backend
 * ------------------------------------------------------------------ */

/** A PlanFileWriter that throws (the provider only READS — loadPlan). */
const REJECTING_WRITER = {
  writeAtomic(path: string, _content: string): void {
    throw new Error(`CanonicalPlanProvider is read-only (writeAtomic ${path})`)
  },
}

/**
 * The provider: for a WS id, discover `topics/<TPC>/workstreams/<ws>` via
 * the reader, then run the REAL `PlanStore.loadPlan` (fresh per call, no
 * cache — the production canonical-load path). Missing workstream directory
 * ⇒ workstream_exists:false (PlanStore's constructor WORKSTREAM_MISSING is
 * mapped); a found workstream without plan.yaml ⇒ present:false.
 */
export function makeCanonicalPlanProvider(reader: MemoryReader): CanonicalPlanProvider {
  return {
    load(workstreamId): CanonicalPlanView {
      const topics = reader.readDir(`${MEM_RESEARCH_ROOT}/topics`)
      if (topics === null) return absent(workstreamId, '')
      for (const t of topics) {
        if (t.kind !== 'directory') continue
        const wsDirRel = `topics/${t.name}/workstreams/${workstreamId}`
        const wsDir = reader.readDir(`${MEM_RESEARCH_ROOT}/${wsDirRel}`)
        if (wsDir === null) continue
        let store: PlanStore
        try {
          store = new PlanStore({
            reader,
            writer: REJECTING_WRITER,
            researchRoot: MEM_RESEARCH_ROOT,
            schemaDir: MEM_SCHEMA_DIR,
            topicId: t.name,
            wsId: workstreamId,
          })
        } catch (cause) {
          return absent(workstreamId, wsDirRel, cause instanceof Error ? cause.message : String(cause))
        }
        const view = store.loadPlan()
        return {
          workstream_id: workstreamId,
          wsDir: wsDirRel,
          workstream_exists: true,
          present: view.present,
          ordered_items: view.items,
          consistent: view.errors.length === 0,
          ...(view.errors.length > 0 ? { problem: view.errors.map((e) => `${e.file}${e.path ?? ''}: ${e.message}`).join(' | ') } : {}),
        }
      }
      return absent(workstreamId, '')
    },
  }
}

function absent(workstreamId: string, wsDir: string, problem?: string): CanonicalPlanView {
  return {
    workstream_id: workstreamId,
    wsDir,
    workstream_exists: false,
    present: false,
    ordered_items: [],
    consistent: false,
    ...(problem !== undefined ? { problem } : { problem: 'workstream directory not found' }),
  }
}

/* ------------------------------------------------------------------ *
 * Closure capturer — deterministic content-hash fake
 * ------------------------------------------------------------------ */

/**
 * The fake capturer: for each `.research`-relative closure path, read the
 * working-copy content through the reader and hash it (sha1 hex — the
 * frozen git_blob_oid shape); a missing file throws (⇒ PF_BASE_CAPTURE).
 * `failNext` injects a one-shot I/O failure (capturer 失败路径测试).
 */
export function makeHashingCapturer(reader: MemoryReader, head: string = FAKE_HEAD): ClosureBlobCapturer & { failNext: () => void; calls: { wsDir: string; closure: readonly string[] }[] } {
  const calls: { wsDir: string; closure: readonly string[] }[] = []
  let failing = false
  return {
    calls,
    failNext: () => {
      failing = true
    },
    capture(wsDir: string, closure: readonly string[]): ClosureBlobBase {
      calls.push({ wsDir, closure })
      if (failing) {
        failing = false
        throw new Error('simulated git hash-object failure (I/O)')
      }
      const objects = closure.map((rel) => {
        const content = reader.readFile(`${MEM_RESEARCH_ROOT}/${rel}`)
        if (content === null) {
          throw new Error(`closure file missing: ${rel}`)
        }
        return { path: rel, git_blob_oid: fakeBlobOid(content) }
      })
      return { objects, gitCommit: head }
    },
  }
}

/* ------------------------------------------------------------------ *
 * Run / trigger fakes (the §11 example seeds)
 * ------------------------------------------------------------------ */

export function makeRunLookup(): FormalRunLookup & { runs: Map<string, FormalRunView> } {
  const runs = new Map<string, FormalRunView>()
  // §11: 「Agent Run R-81 完成实验」— R-81 is a formal run of WS-1.
  runs.set('R-81', { id: 'R-81', workstream_id: 'WS-1', task_id: 'T-2' })
  return { runs, get: (runId) => runs.get(runId) ?? null }
}

export function makeTriggerResolver(): TriggerRefResolver & { refs: Set<string> } {
  const refs = new Set<string>()
  // §11: 「记录 FACT_RECORDED F-31」.
  refs.add('FACT:F-31')
  return { refs, exists: (ref: TriggerRef) => refs.has(`${ref.kind}:${ref.id}`) }
}

/* ------------------------------------------------------------------ *
 * The full pure-creation harness (no DB — validatePlanForkCreation)
 * ------------------------------------------------------------------ */

export interface PlanForkHarness {
  /** The in-memory declarative reader (mutate files to simulate user edits). */
  readonly reader: MemoryReader
  /** The frozen operational schema face (real plan-fork.schema.json). */
  readonly schemas: PlanForkSchemas
  /** The §9 policy (from the base tree's byte-exact §9 example). */
  readonly policy: AgentPlanForkPolicy
  readonly planProvider: CanonicalPlanProvider
  readonly capturer: ReturnType<typeof makeHashingCapturer>
  readonly runs: ReturnType<typeof makeRunLookup>
  readonly triggers: ReturnType<typeof makeTriggerResolver>
  /** Deterministic clock (T_CREATE + 1ms per call). */
  readonly now: () => number
  /** The §4 context assembled from the harness (fresh plan view per call). */
  makeContext(overrides?: Partial<Omit<PlanForkCreationContext, 'plan'>>): PlanForkCreationContext
}

export function makeHarness(files: Record<string, string> = baseTreeFiles()): PlanForkHarness {
  const reader = makeReader(files)
  const opReader = new MemoryReader(realOperationalSchemaFiles())
  const schemas = loadPlanForkSchemas(opReader, MEM_OPERATIONAL_SCHEMA_DIR)
  if (!schemas.isUsable) throw new Error(`harness: operational schemas failed to load: ${schemas.loadErrors.map((e) => `${e.path}: ${e.message}`).join(' | ')}`)
  const policyResult = loadPlanForkPolicy(reader, MEM_RESEARCH_ROOT, MEM_SCHEMA_DIR)
  if (policyResult.policy === null) throw new Error(`harness: policy failed to load: ${policyResult.errors.map((e) => e.message).join(' | ')}`)
  const policy = policyResult.policy
  const planProvider = makeCanonicalPlanProvider(reader)
  const capturer = makeHashingCapturer(reader)
  const runs = makeRunLookup()
  const triggers = makeTriggerResolver()
  let tick = 0
  const now = (): number => T_CREATE + ++tick

  return {
    reader,
    schemas,
    policy,
    planProvider,
    capturer,
    runs,
    triggers,
    now,
    makeContext: (overrides = {}) => ({
      policy,
      plan: planProvider.load('WS-1'),
      schemas,
      baseCapturer: capturer,
      triggerRefResolver: triggers,
      formalRunLookup: runs,
      now,
      ...overrides,
    }),
  }
}

/* ------------------------------------------------------------------ *
 * The §11 end-to-end example — the canonical valid creation params
 * ------------------------------------------------------------------ */

/** §11: fork G-1, merge G-2, proposal [NEW, KEEP T-3, NEW, NEW, KEEP T-4], trigger F-31. */
export function makeParams(patch: Partial<CreatePlanForkParams> = {}): CreatePlanForkParams {
  const base: CreatePlanForkParams = {
    workstreamId: 'WS-1',
    forkAnchor: 'G-1',
    mergeAnchor: 'G-2',
    proposedItems: [
      { action: 'NEW', kind: 'TASK', spec: { title: '复算误差预算', goal: '重新推导误差预算并给出复算脚本' } },
      { action: 'KEEP', kind: 'TASK', ref: 'T-3' },
      { action: 'NEW', kind: 'MILESTONE', spec: { title: '标定方案定稿', statement: '误差预算复算通过且标定方案冻结' } },
      { action: 'NEW', kind: 'TASK', spec: { title: '补充实验', goal: '对残余误差项补充测量实验' } },
      { action: 'KEEP', kind: 'TASK', ref: 'T-4' },
    ],
    triggerRefs: [{ kind: 'FACT', id: 'F-31' }],
    reason: '新数据与 T-2 假设冲突, 需要重排验证顺序',
    necessity: '不重排则 M-1 冻结的管线误差预算不可信',
    createdByRun: 'R-81',
  }
  return { ...base, ...patch }
}

/** The base tree's WS-1 canonical order (§11 初始 canonical). */
export const WS1_CANONICAL = ['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'] as const

/** A proposed-item factory (tests patch individual items). */
export function keep(ref: string, kind: 'TASK' | 'GATE' | 'MILESTONE' = ref.startsWith('G') ? 'GATE' : ref.startsWith('M') ? 'MILESTONE' : 'TASK'): ProposedItem {
  return { action: 'KEEP', kind, ref }
}
export function newTask(spec: { title: string; goal: string; deliverables?: string[]; acceptance_criteria?: string[] } = { title: '新任务', goal: '目标' }): ProposedItem {
  return { action: 'NEW', kind: 'TASK', spec }
}
export function newGate(spec: { title: string; criteria: string; references?: string[] } = { title: '新评审', criteria: '标准' }): ProposedItem {
  return { action: 'NEW', kind: 'GATE', spec }
}
export function newMilestone(spec: { title: string; statement: string } = { title: '新里程碑', statement: '状态陈述' }): ProposedItem {
  return { action: 'NEW', kind: 'MILESTONE', spec }
}

/** A fully-populated OPEN record (for the model/round-trip tests). */
export function openRecord(patch: Partial<PlanForkRecord> = {}): PlanForkRecord {
  return {
    id: 'PF-17',
    workstream_id: 'WS-1',
    base_plan_objects: [
      { path: 'topics/TPC-1/workstreams/WS-1/plan.yaml', git_blob_oid: 'b'.repeat(40) },
      { path: 'topics/TPC-1/workstreams/WS-1/items/gates/G-1.yaml', git_blob_oid: 'c'.repeat(40) },
    ],
    base_git_commit: FAKE_HEAD,
    fork_anchor: 'G-1',
    merge_anchor: 'G-2',
    proposed_items: makeParams().proposedItems,
    trigger_refs: [{ kind: 'FACT', id: 'F-31' }],
    reason: 'reason',
    necessity: 'necessity',
    created_by_run: 'R-81',
    created_at: T_CREATE,
    status: 'OPEN',
    ...patch,
  }
}
