/**
 * WP-3.6 (RR-011 (d)) — `createHostWiring`: the host service dependency
 * graph.
 *
 * ```text
 * store (openDatabase — ONE research.sqlite, DSH_ADAPTER §9; the RR-013
 *   connection guard rides on this connection)
 *   → registry (frozen WP-2.2 schema load — unusable ⇒ startup fails)
 *   → tree   (the .research/ 真源 load — any load error ⇒ startup fails)
 *   → tables (run/DS second connection, WP-2.4)
 *   → allocator (the store meta counter face, §1.1 规则 2)
 *   → semantics (RR-011 (b): the store-level incremental fold + the
 *     startup replay rebuild)
 *   → realizer (RR-011 (a) / RR-010: the workstream.yaml flip + the
 *     append-outcome compensation, wired through the realize-store seam)
 *   → runbinding + sessionlink (the WP-2.6 half extended to full
 *     instantiation — both services over the WRAPPED store)
 *   → planfork store (PF/MA second connection)
 *   → stale service (the production creation flow: real git W3/W11)
 *   → flooding (intervention second connection + the §8 hooks, hung on
 *     BOTH creation flows)
 *   → tools (the WP-3.3 11-tool face, deps composed from the live
 *     services — registered by the dsh-adapter, INV-PERM-5)
 *   → startup reconciliation (lifecycle convergence → run-vs-history →
 *     semantics rebuild; each loud, in this order)
 * ```
 *
 * Every step throws a structured `HostWiringError` on failure (the caller
 * — the dsh-adapter's `[Service.init]` — turns it into a fiber FAILED,
 * TC-DSH-008) and unwinds the resources opened so far (a failed init
 * leaks nothing). On success, `close()` is the SINGLE disposer for
 * everything (idempotent; the dsh-adapter registers it with `ctx.effect`).
 *
 * No DSH imports (INV-PERM-5): this module is business code — the DSH
 * half (home resolution, workspace registry, `defineTool` registration,
 * `ctx.effect`) lives in `src/host/dsh-adapter/host/index.ts`.
 */

import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { loadResearchTree, type ResearchFileReader } from '../../domain/loader/index.js'
import {
  PlanForkStore,
  loadPlanForkPolicy,
  loadPlanForkSchemas,
  type CanonicalPlanView,
  type CreatePlanForkParams,
  type FormalRunLookup,
  type PlanForkCreationContext,
  type PlanForkRecord,
  type TriggerRef,
  type TriggerRefResolver,
} from '../../domain/planfork/index.js'
import type {
  TaskSnapshot,
  WorkstreamSnapshot,
} from '../../history/registry/index.js'
import {
  loadHistoryEventRegistry,
  type HistoryEventRegistry,
  type HistorySchemaReader,
} from '../../history/registry/index.js'
import { readDerivedState } from '../../history/replay/index.js'
import { openDatabase } from '../../persistence/store/index.js'
import type { ResearchStore } from '../../persistence/store/index.js'
import {
  FloodingService,
  InterventionStore,
  loadInterventionSchemas,
} from '../../service/flooding/index.js'
import {
  PlanForkStaleService,
  type PlanForkStoreFace,
} from '../../service/stale/index.js'
import {
  RunBindingService,
  openRunBindingTables,
  type RunBindingExternalState,
  type RunBindingTables,
} from '../../service/runbinding/index.js'
import {
  SessionLinkService,
  type WorkstreamContextSource,
} from '../../service/sessionlink/index.js'
import {
  PlanStore,
  type PlanFileWriter,
} from '../../domain/plan/index.js'
import { IdAllocator } from '../../../shared/ids/index.js'
import {
  createResearchTools,
  type ResearchToolDeps,
  type ResearchToolDefinition,
} from '../../tools/index.js'
import { PlanForkError } from '../../domain/planfork/index.js'

import { adaptDatabaseSync } from './db-adapter.js'
import { makeContentHashCapturer } from './content-hash-capture.js'
import {
  reconcileWorkstreamLifecycles,
  type LifecycleReconcileReport,
} from './lifecycle-reconcile.js'
import {
  reconcileRunsAgainstHistory,
  type RunReconcileReport,
} from './run-reconcile.js'
import {
  makeSemanticMaintainer,
  jsonToSemanticState,
  semanticStateKey,
  type SemanticMaintainer,
  type SemanticRebuildResult,
} from './semantics.js'
import { initialSemanticState, type SemanticState } from '../../domain/semantics/index.js'
import { withRealizeCompensation } from './realize-store.js'
import { WorkstreamRealizer } from './workstream-flip.js'
import { HostWiringError, type HostWiringOptions } from './types.js'

/** The `research.sqlite` file name (DSH_ADAPTER §9). */
const DB_FILE = 'research.sqlite'

/**
 * The startup reconciliation + rebuild reports, in execution order
 * (diagnostics + the test surface).
 */
export interface HostWiringStartup {
  readonly lifecycle: LifecycleReconcileReport
  readonly runs: RunReconcileReport
  readonly semantics: SemanticRebuildResult
}

/**
 * The live host wiring (the dsh-adapter's `[Service.init]` result; held
 * for the fiber's lifetime, disposed through `close()`).
 */
export interface HostWiring {
  readonly repoRoot: string
  readonly researchRoot: string
  readonly projectId: string
  /** The data directory holding `research.sqlite` (DSH_ADAPTER §9). */
  readonly dataDir: string
  /** The WRAPPED store: compensated appends (RR-010) + the semantic
   *  incremental fold (RR-011 (b)) composed into every append's
   *  in-transaction validate. */
  readonly store: ResearchStore
  /** The frozen WP-2.2 registry (usable — startup refused otherwise). */
  readonly registry: HistoryEventRegistry
  /** The run/DS table face (second connection). */
  readonly tables: RunBindingTables
  /** The shared id allocator (store meta counters, §1.1 规则 2). */
  readonly allocator: IdAllocator
  readonly runBinding: RunBindingService
  readonly sessionLink: SessionLinkService
  /** The PF/MA store face (second connection). */
  readonly planForks: PlanForkStore
  /** The production creation-flow service (real git capture). */
  readonly stale: PlanForkStaleService
  readonly flooding: FloodingService
  readonly interventions: InterventionStore
  /** The RR-011 (b) semantics maintainer. */
  readonly semantics: SemanticMaintainer
  /** The 11 agent tools (WP-3.3) — the dsh-adapter registers each through
   *  `defineTool` + `ctx.tools.register` (DSH_ADAPTER §10.1). */
  readonly tools: readonly ResearchToolDefinition[]
  /** The startup reconciliation + rebuild reports. */
  readonly startup: HostWiringStartup
  /** The live declarative snapshot (mutated by the realize flip — the
   *  runbinding `externalState` seam reads it per operation). */
  externalState(): RunBindingExternalState
  /** The production (async, real-git) PF creation flow; the §8 flooding
   *  hook runs after a committed creation (never blocks, never throws). */
  createPlanFork(params: CreatePlanForkParams): Promise<PlanForkRecord>
  /** The IDLE flooding probe (the §8 trigger point 2, plan load). */
  onPlanLoaded(workstreamId: string): void
  /** The SINGLE disposer: discovery subscription + every second
   *  connection + the store connection. Idempotent. */
  close(): void
}

/**
 * The fs-backed reader serving BOTH the declarative tree load
 * (`ResearchFileReader`) and the registry/intervention/planfork schema
 * loads (`HistorySchemaReader`) — the loader-pattern single reader.
 */
class FsReader implements ResearchFileReader, HistorySchemaReader {
  readDir(path: string): ReturnType<ResearchFileReader['readDir']> {
    if (!existsSync(path) || !statSync(path).isDirectory()) return null
    return readdirSync(path, { withFileTypes: true }).map((e) => ({
      name: e.name,
      kind: e.isDirectory() ? ('directory' as const) : ('file' as const),
    }))
  }
  readFile(path: string): string | null {
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return readFileSync(path, 'utf8')
  }
}

/** A rejecting plan writer — the wiring only READS canonical plans. */
const REJECTING_WRITER: PlanFileWriter = {
  writeAtomic(path: string): void {
    throw new Error(`the host wiring is read-only for canonical plans (writeAtomic ${path})`)
  },
}

/**
 * Instantiate the complete host service graph (module header).
 *
 * @throws {HostWiringError} on any step failure (structured code per
 *  step) — resources opened so far are closed before the throw.
 */
export function createHostWiring(options: HostWiringOptions): HostWiring {
  const logger = options.logger
  const now = options.now ?? Date.now

  // ------------------------------------------------------------------ *
  // 0. Input validation (WIRING_INPUT)
  // ------------------------------------------------------------------ *
  const requireAbs = (value: string, name: string): string => {
    if (typeof value !== 'string' || value.length === 0 || !value.startsWith('/')) {
      throw new HostWiringError('WIRING_INPUT', `${name} must be an absolute path (got ${JSON.stringify(value ?? null)})`)
    }
    return value
  }
  const repoRoot = requireAbs(options.repoRoot, 'repoRoot')
  const schemaRoot = requireAbs(options.schemaRoot, 'schemaRoot')
  const dataDir = requireAbs(options.dataDir, 'dataDir')
  const researchDir = options.researchDir ?? '.research'
  if (typeof researchDir !== 'string' || researchDir.length === 0 || researchDir.includes('/')) {
    throw new HostWiringError('WIRING_INPUT', `researchDir must be a bare directory name (got ${JSON.stringify(researchDir)})`)
  }
  if (!/^PRJ-\d+$/.test(options.projectId)) {
    throw new HostWiringError('WIRING_INPUT', `projectId must be a well-formed PRJ-<n> id (got ${JSON.stringify(options.projectId)})`)
  }
  const researchRoot = join(repoRoot, researchDir)
  if (!existsSync(researchRoot) || !statSync(researchRoot).isDirectory()) {
    throw new HostWiringError(
      'WIRING_INPUT',
      `${researchRoot} is not a directory — the workspace carries no .research tree`,
    )
  }

  const reader = new FsReader()
  const workstreamList: string[] = []
  const liveWorkstreams = new Map<string, WorkstreamSnapshot>()
  const liveTasks = new Map<string, TaskSnapshot>()
  const milestoneIds = new Set<string>()
  const objectiveIds = new Set<string>()

  /** Opened second connections + the discovery disposer — closed by `close()`. */
  const disposers: (() => void)[] = []
  const openSecondConnection = (label: string): DatabaseSync => {
    let db: DatabaseSync
    try {
      db = new DatabaseSync(join(dataDir, DB_FILE))
    } catch (cause) {
      throw new HostWiringError('WIRING_TABLES', `cannot open the ${label} second connection: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    }
    disposers.push(() => {
      try {
        db.close()
      } catch {
        /* idempotent close */
      }
    })
    return db
  }

  try {
    // ---------------------------------------------------------------- *
    // 1. The store (WIRING_STORE) — the ONE research.sqlite.
    // ---------------------------------------------------------------- *
    const rawStore = openDatabase(join(dataDir, DB_FILE))
    disposers.push(() => {
      try {
        rawStore.close()
      } catch {
        /* idempotent */
      }
    })

    // ---------------------------------------------------------------- *
    // 2. The frozen event registry (WIRING_REGISTRY).
    // ---------------------------------------------------------------- *
    const registry = loadHistoryEventRegistry(reader, join(schemaRoot, 'history'))
    if (!registry.isUsable) {
      throw new HostWiringError(
        'WIRING_REGISTRY',
        `the frozen event registry is unusable — every append would be unvalidated (INV-HIST-4): ` +
          registry.loadErrors.map((e) => `[${e.code}] ${e.message}`).join('; '),
      )
    }

    // ---------------------------------------------------------------- *
    // 3. The declarative 真源 (WIRING_TREE) — any load error fails startup
    //    (the services must not run against a broken tree).
    // ---------------------------------------------------------------- *
    const load = loadResearchTree(reader, researchRoot, join(schemaRoot, 'declarative'))
    if (load.errors.length > 0) {
      throw new HostWiringError(
        'WIRING_TREE',
        `the .research tree failed to load — refusing to serve a broken declarative 真源: ` +
          load.errors.map((e) => `[${e.code}] ${e.file || '<root>'}: ${e.message}`).join('; '),
      )
    }
    for (const topic of load.tree.topics) {
      for (const ws of topic.workstreams) {
        const doc = ws.doc
        if (doc === null) continue // unreachable after the error check; defensive
        liveWorkstreams.set(ws.id, { topicId: topic.id, lifecycle: doc.lifecycle })
        workstreamList.push(ws.id)
        for (const t of ws.tasks) {
          if (t.doc === null) continue
          const ac = t.doc.acceptance_criteria
          liveTasks.set(t.id, {
            workstreamId: ws.id,
            execution: 'PLANNED',
            validation: ac.length > 0 ? 'PENDING' : 'NOT_REQUIRED',
            acceptanceCriteria: ac,
          })
          void liveTasks
        }
        for (const g of ws.gates) void g
        for (const m of ws.milestones) milestoneIds.add(m.id)
      }
    }
    for (const o of load.tree.objectives) objectiveIds.add(o.id)
    const tree = load.tree

    // ---------------------------------------------------------------- *
    // 4. The run/DS tables (WIRING_TABLES) — second connection.
    // ---------------------------------------------------------------- *
    const tables = openRunBindingTables(join(dataDir, DB_FILE))
    disposers.push(() => {
      try {
        tables.close()
      } catch {
        /* idempotent */
      }
    })

    // ---------------------------------------------------------------- *
    // 5. The shared id allocator (store meta counters).
    // ---------------------------------------------------------------- *
    const allocator = new IdAllocator(rawStore.meta())

    // ---------------------------------------------------------------- *
    // 6. The semantics maintainer (RR-011 (b)) + the realizer (RR-011 (a))
    //    + the WRAPPED store (compensation settlement + the incremental
    //    fold composed into every append's in-transaction validate).
    // ---------------------------------------------------------------- *
    const semantics = makeSemanticMaintainer({ store: rawStore, projectId: options.projectId, logger })

    const realizer = new WorkstreamRealizer({
      researchRoot,
      workstreams: new Map([...liveWorkstreams.entries()].map(([id, s]) => [id, { topicId: s.topicId }])),
      logger,
    })
    // A successful flip updates the live snapshot (the runbinding external
    // state seam reads it per operation — after the flip the file is
    // REALIZED and the tree snapshot must agree). The update happens ONLY
    // after the realizer succeeds: a failed flip (file/DB divergence, the
    // batch is rejected) must leave the snapshot untouched.
    const flipSpy = (wsId: string): void => {
      realizer.onWorkstreamRealized(wsId)
      const snapshot = liveWorkstreams.get(wsId)
      if (snapshot !== undefined && snapshot.lifecycle === 'PLANNED') {
        liveWorkstreams.set(wsId, { topicId: snapshot.topicId, lifecycle: 'REALIZED' })
      }
    }

    const store = withRealizeCompensation(rawStore, realizer, {
      validateHooks: [semantics.validateHook],
    })

    // ---------------------------------------------------------------- *
    // 7. runbinding + sessionlink (the WP-2.6 half → full instantiation),
    //    both over the WRAPPED store.
    // ---------------------------------------------------------------- *
    const externalState = (): RunBindingExternalState => ({
      workstreams: liveWorkstreams,
      tasks: liveTasks,
    })
    const workstreamsSource: WorkstreamContextSource = (wsId) => liveWorkstreams.get(wsId) ?? null

    const runBinding = new RunBindingService({
      store,
      tables,
      registry,
      allocator,
      projectId: options.projectId,
      workspaceRoots: options.workspaceRoots,
      externalState,
      now,
      onWorkstreamRealized: flipSpy,
    })

    const sessionLink = new SessionLinkService({
      store,
      registry,
      adapter: options.adapter,
      ids: allocator,
      projectId: options.projectId,
      workstreams: workstreamsSource,
      now,
    })

    // The discovery subscription (runbinding over the DshSessionAdapter
    // port) — the composed disposer goes through `close()`.
    const disposeDiscovery = runBinding.startDiscovery(options.adapter)
    disposers.push(disposeDiscovery)

    // ---------------------------------------------------------------- *
    // 8. The planfork store (PF/MA second connection) + the frozen
    //    planfork schema set (loaded ONCE — the record shape net).
    // ---------------------------------------------------------------- *
    const pfDb = openSecondConnection('planfork')
    const planForks = new PlanForkStore({ db: adaptDatabaseSync(pfDb), allocator, projectId: options.projectId, now })
    const pfSchemas = loadPlanForkSchemas(reader, join(schemaRoot, 'operational'))
    if (!pfSchemas.isUsable) {
      throw new HostWiringError(
        'WIRING_PLANFORK',
        `the frozen plan-fork schemas are unusable — no PF record can be shape-checked: ` +
          pfSchemas.loadErrors.map((e) => `${e.path || '/'}: ${e.message}`).join('; '),
      )
    }

    // ---------------------------------------------------------------- *
    // 9. The canonical plan provider (fresh PlanStore.loadPlan per call —
    //    the production read path; the plan fork creation's §4 步骤 2).
    // ---------------------------------------------------------------- *
    const declarativeDir = join(schemaRoot, 'declarative')
    const planProvider = {
      load(workstreamId: string): CanonicalPlanView {
        const topics = reader.readDir(join(researchRoot, 'topics'))
        if (topics === null) return absentView(workstreamId, '')
        for (const t of topics) {
          if (t.kind !== 'directory') continue
          const wsDirRel = `topics/${t.name}/workstreams/${workstreamId}`
          if (reader.readDir(join(researchRoot, wsDirRel)) === null) continue
          try {
            const ps = new PlanStore({
              reader,
              writer: REJECTING_WRITER,
              researchRoot,
              schemaDir: declarativeDir,
              topicId: t.name,
              wsId: workstreamId,
            })
            const view = ps.loadPlan()
            const problem = view.errors.length > 0 ? view.errors[0]!.message : undefined
            return {
              workstream_id: workstreamId,
              wsDir: wsDirRel,
              workstream_exists: true,
              present: view.present,
              ordered_items: view.items,
              consistent: view.errors.length === 0,
              ...(problem !== undefined ? { problem } : {}),
            }
          } catch (cause) {
            return absentView(workstreamId, wsDirRel, cause instanceof Error ? cause.message : String(cause))
          }
        }
        return absentView(workstreamId, '')
      },
    }

    // ---------------------------------------------------------------- *
    // 10. The stale service (the production creation flow: real git
    //     W3/W11 capture).
    // ---------------------------------------------------------------- *
    const stale = new PlanForkStaleService({
      repoRoot,
      researchDir,
      store: planForks as unknown as PlanForkStoreFace,
      planProvider,
    })

    // ---------------------------------------------------------------- *
    // 11. The flooding service (intervention second connection + §8
    //     hooks).
    // ---------------------------------------------------------------- *
    const ivDb = openSecondConnection('intervention')
    const ivSchemas = loadInterventionSchemas(reader, join(schemaRoot, 'operational'))
    if (!ivSchemas.isUsable) {
      throw new HostWiringError(
        'WIRING_FLOODING',
        `the frozen attention schemas are unusable — no Intervention can be shape-checked: ` +
          ivSchemas.loadErrors.map((e) => `${e.path || '/'}: ${e.message}`).join('; '),
      )
    }
    const interventions = new InterventionStore({ db: adaptDatabaseSync(ivDb), schemas: ivSchemas })
    const flooding = new FloodingService({
      store,
      registry,
      planForks,
      interventions,
      allocator,
      projectId: options.projectId,
      researchFileReader: reader,
      researchRoot,
      schemaDir: declarativeDir,
      externalState: () => ({ workstreams: liveWorkstreams }),
      now,
    })

    // ---------------------------------------------------------------- *
    // 12. The agent tool face (WP-3.3) — deps composed from the LIVE
    //     services. The dsh-adapter registers each definition (DSH_ADAPTER
    //     §10.1); this layer only builds them (no ctx, no DSH).
    // ---------------------------------------------------------------- *
    const contentHashCapturer = makeContentHashCapturer(researchRoot)

    const loadPolicy = () => {
      const result = loadPlanForkPolicy(reader, researchRoot, declarativeDir)
      if (result.policy === null) {
        throw new PlanForkError({
          code: 'PF_POLICY_INVALID',
          message: `the agent plan-fork policy failed to load: ${result.errors.map((e) => e.message).join('; ')}`,
        })
      }
      return result.policy
    }

    const formalRunLookup: FormalRunLookup = {
      get(runId: string) {
        const row = tables.getRun(runId)
        return row === null
          ? null
          : { id: row.id, workstream_id: row.workstream_id, ...(row.task_id !== undefined ? { task_id: row.task_id } : {}) }
      },
    }

    // FRESH semantic-state read for the trigger-ref existence checks: the
    // store-level `semantics:<project>` row (the RR-011 (b) fold's row —
    // the same single source the GUI data face will read), falling back to
    // the empty state when the row has never been written.
    const semanticKey = semanticStateKey(options.projectId)
    const readSemanticState = (): SemanticState => {
      const derived = readDerivedState(rawStore)
      const raw = derived.get(semanticKey)
      return raw === undefined ? initialSemanticState() : jsonToSemanticState(raw, semanticKey)
    }

    // The production trigger-ref resolver (module footer): semantic
    // registries from the store-level derived_state row (fresh read) +
    // milestone/objective from the loaded declarative tree.
    const triggerRefResolver = makeTriggerRefResolver({
      readSemanticState,
      milestoneIds,
      objectiveIds,
    })

    const toolsDeps: ResearchToolDeps = {
      // The SYNCHRONOUS tool port: the eight-step domain chain with the
      // content-addressed capture (module: content-hash-capture.ts — the
      // W3-equivalent for the sync face; machine-checked against real git
      // in tests/wiring). The async production flow (stale service, real
      // git W3/W11) is `createPlanFork` below — both flows share the store
      // persist + the §8 flooding hook.
      planForkCreate: (params) => {
        const view = planProvider.load(params.workstreamId)
        const policy = loadPolicy()
        const ctx: PlanForkCreationContext = {
          policy,
          plan: view,
          schemas: pfSchemas,
          baseCapturer: contentHashCapturer,
          triggerRefResolver,
          formalRunLookup,
          now,
        }
        const record = planForks.createPlanFork(params, ctx)
        const check = flooding.onPlanForkCreated(record) // §8 触发点 1 (never throws)
        if (check.error !== undefined) {
          logger?.warn('flooding', `onPlanForkCreated after tool creation of ${record.id}: [${check.error.code}] ${check.error.message}`)
        }
        return record
      },
      recordCheckpoint: (runId, params, actor) => runBinding.recordCheckpoint(runId, params, actor),
    }
    const tools = createResearchTools(toolsDeps)

    // ---------------------------------------------------------------- *
    // 13. STARTUP RECONCILIATION (before any service is used):
    //     (a) lifecycle convergence (the RR-010 crash-window detection
    //     path — file/DB divergence → converge the FILE toward History);
    //     (c) run-vs-history (WP-2.4 未决 2: rebuild the missing row, or
    //     fail loud; orphan events reported, never deleted);
    //     (b) the semantics replay rebuild (incremental ≡ rebuild; the
    //     derived_state slice is replaced in one independent transaction).
    // ---------------------------------------------------------------- *
    const lifecycleReport = reconcileWorkstreamLifecycles({
      store: rawStore,
      researchRoot,
      workstreams: workstreamList.map((id) => {
        const snapshot = liveWorkstreams.get(id)
        return { workstreamId: id, topicId: snapshot?.topicId ?? '' }
      }),
      logger,
    })
    // The reconciliation may have FLIPPED files (forward convergence) —
    // the live snapshot must agree with the converged files.
    for (const finding of lifecycleReport.findings) {
      const snapshot = liveWorkstreams.get(finding.workstreamId)
      if (snapshot === undefined) continue
      if (finding.action === 'file-flipped-to-realized') {
        liveWorkstreams.set(finding.workstreamId, { topicId: snapshot.topicId, lifecycle: 'REALIZED' })
      } else if (finding.action === 'file-rolled-back-to-planned') {
        liveWorkstreams.set(finding.workstreamId, { topicId: snapshot.topicId, lifecycle: 'PLANNED' })
      }
    }

    const runsReport = reconcileRunsAgainstHistory({
      store: rawStore,
      tables,
      workstreams: workstreamList,
      policy: options.reconcileRuns ?? 'rebuild',
      logger,
    })

    const semanticsReport = semantics.rebuild({ workstreams: workstreamList })

    const startup: HostWiringStartup = { lifecycle: lifecycleReport, runs: runsReport, semantics: semanticsReport }

    // ---------------------------------------------------------------- *
    // The live object.
    // ---------------------------------------------------------------- *
    const wiring: HostWiring = {
      repoRoot,
      researchRoot,
      projectId: options.projectId,
      dataDir,
      store,
      registry,
      tables,
      allocator,
      runBinding,
      sessionLink,
      planForks,
      stale,
      flooding,
      interventions,
      semantics,
      tools,
      startup,
      externalState,
      createPlanFork: async (params): Promise<PlanForkRecord> => {
        const view = planProvider.load(params.workstreamId)
        const policy = loadPolicy()
        const ctx: PlanForkCreationContext = {
          policy,
          plan: view,
          schemas: pfSchemas,
          // The stale service replaces baseCapturer (its own real-git
          // capture); the placeholder is never observed.
          baseCapturer: contentHashCapturer,
          triggerRefResolver,
          formalRunLookup,
          now,
        }
        const record = await stale.createPlanFork(params, ctx)
        const check = flooding.onPlanForkCreated(record) // §8 触发点 1
        if (check.error !== undefined) {
          logger?.warn('flooding', `onPlanForkCreated after creation of ${record.id}: [${check.error.code}] ${check.error.message}`)
        }
        return record
      },
      onPlanLoaded: (workstreamId: string): void => {
        const check = flooding.onPlanLoaded(workstreamId) // §8 触发点 2 (never throws)
        if (check.error !== undefined) {
          logger?.warn('flooding', `onPlanLoaded(${workstreamId}): [${check.error.code}] ${check.error.message}`)
        }
      },
      close(): void {
        for (const dispose of disposers.splice(0).reverse()) {
          try {
            dispose()
          } catch {
            /* one disposer failing never blocks the rest */
          }
        }
      },
    }

    logger?.info('wiring', `host wiring ready (project ${options.projectId}; ${workstreamList.length} workstreams; ${liveTasks.size} tasks)`)
    return wiring
  } catch (e) {
    // Unwind everything opened so far (a failed init leaks nothing).
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch {
        /* best effort */
      }
    }
    if (e instanceof HostWiringError) throw e
    throw new HostWiringError('WIRING_SERVICE', `host wiring failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function absentView(workstreamId: string, wsDir: string, problem?: string): CanonicalPlanView {
  return {
    workstream_id: workstreamId,
    wsDir,
    workstream_exists: false,
    present: false,
    ordered_items: [],
    consistent: false,
    ...(problem !== undefined ? { problem } : {}),
  }
}

/**
 * The PRODUCTION trigger-ref resolver (PLAN_FORK_SPEC §4 步骤 6: each
 * `trigger_refs` object must exist):
 *  - CLAIM / FACT / ARTIFACT — the semantic registries (the store-level
 *    `semantics:<project>` derived_state row, the same row the RR-011 (b)
 *    fold maintains — a FRESH read per creation, no cache);
 *  - MILESTONE — the declarative tree (any workstream's milestone items);
 *  - OBJECTIVE — the declarative `.research/objectives.yaml`.
 *
 * Fresh read: a creation validates against the state as it is NOW (an
 * append that RETRACTs a claim in the same instant loses the race and the
 * step-6 existence check reports the truth).
 */
interface TriggerRefResolverInput {
  readonly readSemanticState: () => SemanticState
  readonly milestoneIds: ReadonlySet<string>
  readonly objectiveIds: ReadonlySet<string>
}

function makeTriggerRefResolver(input: TriggerRefResolverInput): TriggerRefResolver {
  const exists = (ref: TriggerRef): boolean => {
    switch (ref.kind) {
      case 'CLAIM':
        return input.readSemanticState().claims.has(ref.id)
      case 'FACT':
        return input.readSemanticState().facts.has(ref.id)
      case 'ARTIFACT':
        return input.readSemanticState().artifacts.has(ref.id)
      case 'MILESTONE':
        return input.milestoneIds.has(ref.id)
      case 'OBJECTIVE':
        return input.objectiveIds.has(ref.id)
    }
  }
  return { exists }
}
