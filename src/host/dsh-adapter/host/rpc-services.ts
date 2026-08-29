/**
 * WP-4.1a — the host RPC service PORT + its PRODUCTION implementation
 * (the 13-RPC client face of ARCHITECTURE.md §7.1).
 *
 * Layering (ARCHITECTURE.md §2.2, INV-PERM-5):
 *  - the `@Remote` method bodies on `ResearchControlService`
 *    (`./index.ts`, the only host surface allowed to import DSH packages)
 *    are THIN: `zod decode → forward to this port`. No business rule,
 *    no I/O, no projection happens in the method body;
 *  - this port (`ResearchRpcServices`) is the plugin-own service port the
 *    method bodies forward to — the「注入的 service 端口」of the WP-4.1a
 *    brief. In production it is the `ProductionResearchRpcServices` below,
 *    composed in `ResearchControlService.[Service.init]` (the composition
 *    root, which already builds the host wiring) from the WIRING-ASSEMBLED
 *    instances (`HostWiring.*`); tests inject a stub implementation
 *    through the constructor seam;
 *  - this file is dsh-adapter territory: it imports plugin business
 *    modules (service/domain/history layers) but NO DSH package.
 *
 * Per-RPC forwarding map (wiring-assembly result → forward target):
 *  | RPC                    | forwards to                                                                 |
 *  |------------------------|------------------------------------------------------------------------------|
 *  | getDashboard           | stale pre-check (checkAllOpen sweep, WP-4.6 RR-015①) + declarative tree loader (query) + InterventionStore.query + null placeholders |
 *  | getProject             | declarative tree loader (query) + null placeholders                           |
 *  | getTopic               | tree loader + Workstream cards (planfork countOpen + run table RUNNING)      |
 *  | getWorkstream          | stale pre-check (checkAllOpen(wsId) sweep, WP-4.6 RR-015①) + tree loader + history event log (size + fold projection) + run table + PF store |
 *  | queryHistory           | history replay query face (`queryEvents` — seq-cursor pagination, verbatim)  |
 *  | reorderPlan            | PlanStore.savePlan (§4.4 validations + atomic write) + PLAN_REORDER ledger row |
 *  | selectPlanFork         | PlanForkSelectService.select (WP-3.4: actor re-asserted USER at runtime)     |
 *  | dismissPlanFork        | PlanForkSelectService.dismiss (WP-3.4: actor re-asserted USER at runtime)    |
 *  | updateInterventionState| InterventionService.updateState (RR-017②, WP-6.4: §13    |
 *  |                        | guard single source + state-cache row — WP-5.1 layer on the |
 *  |                        | user-surface second connection)                     |
 *  | registerInteraction    | reporting service `registerInteraction` (WP-5.3 production: the           |
 *  |                        | interaction table on the user-surface second connection; related_         |
 *  |                        | workstreams existence checked against the declarative tree, §16 rule 2)   |
 *  | saveResearchCheckpoint | checkpoint service `saveResearchCheckpoint` (§5 flow, user-triggered only)   |
 *  | getGitHistory          | checkpoint service `diffHistory` (W6 file log, `.research/**`-scoped)        |
 *  | restoreDeclarativeFile | checkpoint service `restoreResearchFile` (W6/W7/W8 + post-restore check)    |
 *
 * User semantics (ARCHITECTURE.md §6): reorderPlan / selectPlanFork /
 * dismissPlanFork / updateInterventionState / restoreDeclarativeFile /
 * saveResearchCheckpoint are USER operations — the RPC face makes NO
 * actor distinction (the client face IS the user face; the host gateway
 * bounds the matrix), and the forwarded services KEEP their existing
 * permission checks (WP-3.4 re-asserts `actor.kind === USER` for
 * select/dismiss; the §13 guard + DDL trigger keep intervention state
 * user-only; the checkpoint/restore services are explicit-trigger only —
 * INV-GIT-2/INV-GIT-5). `registerInteraction` is a user登记 operation
 * (DOMAIN_SCHEMA §10.1; the §6 matrix has no AGENT row for it).
 *
 * One extra resource: a SECOND `node:sqlite` connection over the same
 * `research.sqlite` (the established dual-connection pattern of the
 * wiring — runbinding/planfork/flooding each open their own). It serves
 * the three user-surface writes the wiring-internal services do not
 * expose: the PLAN_REORDER ledger INSERT, the intervention state-cache
 * UPDATE, and the SELECTED transaction of the select service. Owned by
 * this object; closed by `close()` (idempotent), which the dsh-adapter
 * registers with `ctx.effect`.
 */

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

import {
  type CurrentTaskDto,
  type CreateTopicArgs,
  type CreateTopicResult,
  type CreateWorkstreamArgs,
  type CreateWorkstreamResult,
  type DashboardSnapshot,
  type DismissPlanForkArgs,
  type DismissPlanForkResult,
  type DropWorkstreamArgs,
  type DropWorkstreamResult,
  type GetCurrentFocusArgs,
  type GetCurrentFocusResult,
  type GetGitHistoryArgs,
  type GetGitHistoryResult,
  type GetTopicArgs,
  type GetWorkstreamArgs,
  type InterventionDto,
  type MergeContractRefDto,
  type ObjectiveDto,
  type PlanForkDto,
  type PlanItemDto,
  type ProjectSnapshot,
  type HistoryEventDto,
  type QueryHistoryArgs,
  type QueryHistoryResult,
  type ReorderPlanArgs,
  type ReorderPlanResult,
  type RegisterInteractionArgs,
  type RegisterInteractionResult,
  type RestoreDeclarativeFileArgs,
  type RestoreDeclarativeFileResult,
  type SaveResearchCheckpointArgs,
  type SaveResearchCheckpointResult,
  type SelectPlanForkArgs,
  type SelectPlanForkResult,
  type SetCurrentFocusArgs,
  type SetCurrentFocusResult,
  type TopologyEdgeDto,
  type TopicCardDto,
  type TopicSnapshot,
  type UpdateInterventionStateArgs,
  type UpdateInterventionStateResult,
  type UpdateProjectMetadataArgs,
  type UpdateProjectMetadataResult,
  type UpdateTopicArgs,
  type UpdateTopicResult,
  type UpdateWorkstreamArgs,
  type UpdateWorkstreamResult,
  type WorkstreamCardDto,
  type WorkstreamSnapshot,
} from '../../../shared/rpc-contracts.js'
import { isCurrentFocusError } from '../../service/current-focus/index.js'
import { isHierarchyError } from '../../service/hierarchy/index.js'
import {
  adaptDatabaseSync,
  type HostWiring,
} from '../../service/wiring/index.js'
import {
  loadResearchTree,
  type ObjectiveDoc,
  type ResearchFileReader,
  type ResearchTree,
  type TopicNode,
  type WorkstreamNode,
} from '../../domain/loader/index.js'
import {
  foldEvents,
  queryEvents,
} from '../../history/replay/index.js'
import type { HistoryEventRecord } from '../../persistence/store/index.js'
import {
  FsResearchReader,
  diffHistory,
  restoreResearchFile,
  saveResearchCheckpoint,
  type StructuredLogger,
} from '../../service/checkpoint/index.js'
import { FsPlanFileWriter } from '../../service/fs/index.js'
import { PlanStore } from '../../domain/plan/index.js'
import {
  PlanForkSelectService,
  type PlanForkSelectOptions,
} from '../../service/select/index.js'
import { ReportingService } from '../../service/reporting/index.js'
import {
  InterventionLifecycleStore,
  InterventionService,
  USER_ACTOR as INTERVENTION_USER_ACTOR,
} from '../../service/intervention/index.js'
import type { InterventionRecord } from '../../service/flooding/index.js'
import {
  managementActionToParams,
  SQL_INSERT_MANAGEMENT_ACTION,
  type ActorRef,
  type CanonicalPlanProvider,
  type CanonicalPlanView,
  type ManagementActionRecord,
  type PlanForkRecord,
} from '../../domain/planfork/index.js'

/**
 * The injected service port the 13 `@Remote` method bodies forward to.
 *
 * Arity contract (RR-006): every port method takes exactly the decoded
 * args object of its RPC — 1:1 with the descriptor's parameter face
 * (0 params for getDashboard/getProject, 1 `args` param for the other
 * 11). Tests stub this interface and assert the forwarded args/return.
 */
export interface ResearchRpcServices {
  /**
   * WP-4.6 (RR-015① disposition): the production implementation runs the
   * idempotent `stale.checkAllOpen()` sweep BEFORE the projection (the
   * query-path stale pre-check — the snapshot reflects the current truth,
   * PLAN_FORK_SPEC §5 「PF 列表查询懒检测」 timing). The port is async for
   * the two query RPCs that read the PF state (the sweep is an async W3
   * batch); stub implementations resolve with the fixture.
   */
  getDashboard(): Promise<DashboardSnapshot>
  getProject(): ProjectSnapshot
  getTopic(args: GetTopicArgs): TopicSnapshot
  getWorkstream(args: GetWorkstreamArgs): Promise<WorkstreamSnapshot>
  queryHistory(args: QueryHistoryArgs): QueryHistoryResult
  reorderPlan(args: ReorderPlanArgs): ReorderPlanResult
  selectPlanFork(args: SelectPlanForkArgs): Promise<SelectPlanForkResult>
  dismissPlanFork(args: DismissPlanForkArgs): Promise<DismissPlanForkResult>
  updateInterventionState(args: UpdateInterventionStateArgs): UpdateInterventionStateResult
  registerInteraction(args: RegisterInteractionArgs): Promise<RegisterInteractionResult>
  saveResearchCheckpoint(args: SaveResearchCheckpointArgs): Promise<SaveResearchCheckpointResult>
  getGitHistory(args: GetGitHistoryArgs): Promise<GetGitHistoryResult>
  restoreDeclarativeFile(args: RestoreDeclarativeFileArgs): Promise<RestoreDeclarativeFileResult>
  /**
   * UI-0.4 (R-01): USER mutation — point the workstream's current-focus
   * operational pointer at the given canonical Plan member. The
   * canonical-membership gate runs service-side BEFORE any row write
   * (CF_NOT_CANONICAL — the frozen DDL stays a plain 3-column table).
   * The RPC face IS the USER lane (R-01: no actor parameter, the host
   * gateway bounds who may call it). Returns the canonical record
   * (id + `updatedAt` version) for client invalidation.
   */
  setCurrentFocus(args: SetCurrentFocusArgs): SetCurrentFocusResult
  /**
   * UI-0.4 (R-01): read back the workstream's current-focus pointer.
   * `focus: null` = never set / auto-cleared after the target left the
   * canonical Plan (the R-01 eviction rule).
   */
  getCurrentFocus(args: GetCurrentFocusArgs): GetCurrentFocusResult
  /**
   * V2-UI-0.4 (Task 3): create a new Topic in the routed project —
   * allocates the next TPC-<n> (max+1, never reused) and writes the
   * minimal valid file set (`topic.yaml` only). Returns the canonical
   * record (id + `createdAt` version) for client invalidation.
   */
  createTopic(args: CreateTopicArgs): CreateTopicResult
  /**
   * V2-UI-0.4 (Task 3): create a new Workstream under an existing topic
   * of the routed project — allocates the next WS-<n> project-wide and
   * writes `workstream.yaml`. The topic must be a node of this project
   * (HIER_TOPIC_NOT_FOUND otherwise).
   */
  createWorkstream(args: CreateWorkstreamArgs): CreateWorkstreamResult
  /**
   * V2-UI-0.4 (UI-2A): rewrite the provided project metadata fields
   * (title / description / importance / attention mode / target date)
   * in the routed project — read-modify-write, the OMITTED fields are
   * preserved byte-for-byte (at least one field required, HIER_INPUT
   * otherwise). Returns the effective title + the write stamp
   * (`updatedAt`) for client invalidation.
   */
  updateProjectMetadata(args: UpdateProjectMetadataArgs): UpdateProjectMetadataResult
  /**
   * V2-UI-0.4 (UI-2A): update a topic title / description / importance
   * / attention mode in the routed project (RMW — provided fields
   * only). The topic must be a node of this project
   * (HIER_TOPIC_NOT_FOUND otherwise).
   */
  updateTopic(args: UpdateTopicArgs): UpdateTopicResult
  /**
   * V2-UI-0.4 (UI-2A): update a workstream title / summary in the
   * routed project (RMW — title + summary ONLY; lifecycle changes are
   * not part of this slice). The workstream must belong to this
   * project (HIER_WORKSTREAM_NOT_FOUND otherwise).
   */
  updateWorkstream(args: UpdateWorkstreamArgs): UpdateWorkstreamResult
  /**
   * V2-UI-0.4 (UI-2A): delete a workstream of the routed project —
   * the whole workstream directory plus its reference. CONSERVATIVE
   * ruling: a workstream with history is REFUSED
   * (HIER_WORKSTREAM_HAS_HISTORY) BEFORE any removal; the
   * post-delete current-focus clear is best-effort (surfaced as the
   * `currentFocusCleared` result flag, never as a failure).
   */
  dropWorkstream(args: DropWorkstreamArgs): DropWorkstreamResult
  /**
   * Optional resource teardown (the production implementation owns one
   * second SQLite connection; the dsh-adapter registers it with
   * `ctx.effect`). Stub implementations may omit it.
   */
  close?(): void
}

/**
 * The frozen USER actor the RPC face forwards for user-semantic RPCs.
 * The client has no identity of its own (the host gateway bounds the
 * matrix — ARCHITECTURE §6); the forwarded services keep their checks
 * (WP-3.4 `assertUserActor` accepts a bare `{ kind: 'USER' }`).
 */
const USER_ACTOR: ActorRef = { kind: 'USER' }

/** Task execution/validation vocabularies for the Current-zone fold. */
const TASK_EXECUTIONS = new Set(['PLANNED', 'ACTIVE', 'PAUSED', 'EXECUTED', 'CANCELLED'])
const TASK_VALIDATIONS = new Set(['NOT_REQUIRED', 'PENDING', 'UNDER_REVIEW', 'PASSED', 'FAILED'])

/** Console bridge for the checkpoint services' mandatory logger. */
function consoleLogger(): StructuredLogger {
  return {
    info: (event, fields) => console.log(`[research-control][rpc][${event}]`, fields ?? {}),
    warn: (event, fields) => console.warn(`[research-control][rpc][${event}]`, fields ?? {}),
    error: (event, fields) => console.error(`[research-control][rpc][${event}]`, fields ?? {}),
  }
}

/**
 * V2-T3.2a — the fresh-tree load with the frozen-13 fail-loud verdict
 * (extracted from `ProductionResearchRpcServices.#loadTree`: the same
 * read, the same message — the plane-read face reuses it verbatim so a
 * broken tree refuses the snapshot on every query path).
 */
export function loadResearchTreeOrThrow(researchRoot: string, declarativeDir: string, operation: string): ResearchTree {
  const load = loadResearchTree(new FsResearchReader(researchRoot), researchRoot, declarativeDir)
  if (load.errors.length > 0) {
    const e = load.errors[0]!
    throw new Error(
      `${operation}: the declarative tree failed to load — refusing to serve a broken snapshot: ` +
        `[${e.code}] ${e.file || '<root>'}${e.path !== undefined ? e.path : ''}: ${e.message}`,
    )
  }
  return load.tree
}

/**
 * V2-T3.2a — the V1 getDashboard production REFRESH SIDECAR (extracted
 * from `ProductionResearchRpcServices.getDashboard` — the same two
 * steps, the same order, the same verdicts):
 *   1. the idempotent `stale.checkAllOpen()` FULL sweep (WP-4.6
 *      RR-015① query-path stale pre-check — a sweep-level throw
 *      PROPAGATES: a lying query is worse than a failed one);
 *   2. the RR-018① audit refresh (the client's refresh loop IS the
 *      production trigger; a refresh failure is LOGGED LOUD and never
 *      blocks the query — the sidecar is mechanical, not part of the
 *      data-plane contract).
 *
 * The §7.1 总览 (getHubOverview) runs this per project: under V2 the
 * overview IS the refresh surface for every wired project (the V1
 * dashboard's trigger point, moved with the data), so the audit chain
 * and the stale sweep stay on the refresh loop exactly as in V1.
 */
export async function runProjectRefreshSidecar(wiring: HostWiring, logger: StructuredLogger): Promise<void> {
  await wiring.stale.checkAllOpen()
  try {
    const refresh = await wiring.auditRefresh.run()
    logger.info('auditRefresh', {
      discrepancies: refresh.discrepancyCount,
      captured: refresh.captured.length,
      escalated: refresh.escalated === null ? null : refresh.escalated.inboxItemId,
      skippedDedupe: refresh.skippedDedupe,
      skippedBaseline: refresh.skippedBaseline,
      captureFailures: refresh.captureFailures.length,
    })
  } catch (cause) {
    logger.error(
      'auditRefreshFailed',
      { message: cause instanceof Error ? cause.message : String(cause) },
    )
  }
}

export interface ProductionResearchRpcServicesOptions {
  /** The wiring-assembled service graph (the composition root's output). */
  readonly wiring: HostWiring
  /** The frozen contract schema ROOT (the `schema/` directory). */
  readonly schemaRoot: string
  /** Clock (A-3 epoch ms; default `Date.now`). */
  readonly now?: () => number
}

/**
 * The production implementation of the RPC service port: decode is the
 * method body's job — this layer receives ALREADY-DECODED args and does
 * query projection + delegation to the business services that own the
 * rules (state machines, §4.4 validations, §5 git flow, §13 guard).
 */
export class ProductionResearchRpcServices implements ResearchRpcServices {
  readonly #wiring: HostWiring
  readonly #declarativeDir: string
  readonly #now: () => number
  readonly #logger: StructuredLogger
  /** The user-surface second connection (PLAN REORDER ledger / intervention
   *  state-cache update / the select service's SELECTED transaction). */
  readonly #dbConn: DatabaseSync
  readonly #db: ReturnType<typeof adaptDatabaseSync>
  readonly #select: PlanForkSelectService
  /** The WP-5.3 reporting layer (interaction / reporting_item /
   *  scheduled_event tables) on the same user-surface second connection. */
  readonly #reporting: ReportingService
  /** RR-017② (WP-6.4): the WP-5.1 intervention layer — the 13-RPC
   *  `updateInterventionState` routes through `updateState` (equivalence:
   *  same §13 guard single source, same optimistic conditional UPDATE on
   *  the lifecycle row, same 1:1 result shape; existing tests +
   *  TC-E2E-011 prove the re-route). */
  readonly #intervention: InterventionService
  #closed = false

  constructor(options: ProductionResearchRpcServicesOptions) {
    this.#wiring = options.wiring
    this.#declarativeDir = join(options.schemaRoot, 'declarative')
    this.#now = options.now ?? Date.now
    this.#logger = consoleLogger()

    const dbPath = join(options.wiring.dataDir, 'research.sqlite')
    this.#dbConn = new DatabaseSync(dbPath)
    this.#db = adaptDatabaseSync(this.#dbConn)

    // The canonical plan provider (the production read path: fresh
    // PlanStore.loadPlan per call — the same composition the wiring uses
    // for its own planfork creation flow; the select service re-checks
    // the PF base against THIS face, §6.1). Read-only by construction:
    // the writer rejects (the select service writes through its own
    // injected writer, never through the provider).
    const reader = new FsResearchReader(options.wiring.researchRoot)
    this.#select = new PlanForkSelectService({
      repoRoot: options.wiring.repoRoot,
      store: options.wiring.planForks,
      db: this.#db,
      allocator: options.wiring.allocator,
      projectId: options.wiring.projectId,
      planProvider: makeReadonlyPlanProvider({
        reader,
        researchRoot: options.wiring.researchRoot,
        declarativeDir: this.#declarativeDir,
      }),
      reader,
      writer: new FsPlanFileWriter(),
      schemaDir: this.#declarativeDir,
      now: this.#now,
    } satisfies Omit<PlanForkSelectOptions, 'git' | 'concurrency' | 'researchDir'>)

    // WP-5.3 (DOMAIN_SCHEMA §10): the reporting layer (interaction /
    // reporting_item / scheduled_event) — idempotent DDL on the same
    // second connection (the planfork/flooding dual-connection 先例).
    this.#reporting = new ReportingService({
      db: this.#db,
      allocator: options.wiring.allocator,
      projectId: options.wiring.projectId,
      now: this.#now,
    })

    // RR-017② (WP-6.4): the WP-5.1 intervention layer on the same
    // user-surface second connection (dual-connection 先例 — the lifecycle
    // store applies the WP-3.5 DDL single source idempotently). The
    // 13-RPC `updateInterventionState` now routes through
    // `InterventionService.updateState` (equivalence: same §13 guard
    // single source + same optimistic conditional UPDATE + 1:1 result
    // shape; the RPC face keeps its actor-agnostic USER semantics — the
    // service re-asserts USER at runtime, INV-PERM-4).
    const interventionLifecycle = new InterventionLifecycleStore({
      db: this.#db,
      interventions: options.wiring.interventions,
    })
    this.#intervention = new InterventionService({
      store: options.wiring.store,
      registry: options.wiring.registry,
      lifecycle: interventionLifecycle,
      allocator: options.wiring.allocator,
      projectId: options.wiring.projectId,
      externalState: () => ({ workstreams: options.wiring.externalState().workstreams }),
      now: this.#now,
    })
  }

  /**
   * UI-0.4 (R-01): map the service's CF_* error family onto the wire
   * error carrier. The gateway folds a host error to
   * `{ ok: false, error: <message> }` — the `[CODE]` prefix in the
   * message is the machine-matchable carrier (the PLANE_* precedent).
   * Non-CF errors propagate untouched (the kernel's own messages).
   */
  #mapCurrentFocusError(e: unknown): unknown {
    if (isCurrentFocusError(e)) {
      return new Error(`[research-control] ${e.code}: ${e.message}`, { cause: e })
    }
    return e
  }

  /**
   * V2-UI-0.4 (Task 3): map the service's HIER_* error family onto the
   * wire error carrier (same `[research-control] <CODE>: <message>`
   * shape as the CF_ mapper — the gateway folds a host error to
   * `{ ok: false, error: <message> }` and the prefix is the
   * machine-matchable carrier). Non-hierarchy errors propagate
   * untouched (the kernel's own messages).
   */
  #mapHierarchyError(e: unknown): unknown {
    if (isHierarchyError(e)) {
      return new Error(`[research-control] ${e.code}: ${e.message}`, { cause: e })
    }
    return e
  }

  /**
   * UI-0.4 (R-01): BEST-EFFORT current-focus revalidation after a
   * committed Plan mutation (reorderPlan / selectPlanFork). Auto-clears
   * the pointer when its target has left the canonical Plan. Never
   * propagates: the mutation contract (plan.yaml + ledger + result
   * DTO) is already complete, and a cross-domain invalidation failure
   * must not poison a succeeded mutation (D §6.5) — at worst the
   * pointer stays stale until the next revalidation, and the log line
   * below is loud.
   */
  #revalidateCurrentFocus(workstreamId: string): void {
    try {
      this.#wiring.currentFocus.revalidate(workstreamId)
    } catch (e) {
      this.#logger.error('current-focus-revalidate', {
        workstreamId,
        message:
          'current-focus revalidate (best-effort) failed — the plan mutation stands; ' +
          `the pointer may be stale until the next revalidation: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }

  setCurrentFocus(args: SetCurrentFocusArgs): SetCurrentFocusResult {
    // The service owns the semantics: CF_INPUT shape gate → the
    // canonical-membership gate (BEFORE any row write) → the UPSERT.
    // The RPC face IS the USER lane (R-01) — no actor to forward.
    try {
      const record = this.#wiring.currentFocus.set(args.workstreamId, args.planItemId)
      return {
        workstreamId: record.workstreamId,
        planItemId: record.planItemId,
        updatedAt: record.updatedAt,
      }
    } catch (e) {
      throw this.#mapCurrentFocusError(e)
    }
  }

  getCurrentFocus(args: GetCurrentFocusArgs): GetCurrentFocusResult {
    // BL-03 (UI-1): the read face gets the SAME error mapping as
    // `setCurrentFocus` (mirror of :457-471) — a CF_* fault from
    // `currentFocus.get` (CF_STORE: bad row / closed handle — the CF_INPUT
    // shape gate is decoded away earlier at the @Remote zod layer,
    // host/index.ts) rides the same `[research-control] <CODE>: <message>`
    // carrier; non-CF errors propagate untouched.
    try {
      const record = this.#wiring.currentFocus.get(args.workstreamId)
      return {
        workstreamId: args.workstreamId,
        focus:
          record === undefined
            ? null
            : { planItemId: record.planItemId, updatedAt: record.updatedAt },
      }
    } catch (e) {
      throw this.#mapCurrentFocusError(e)
    }
  }

  createTopic(args: CreateTopicArgs): CreateTopicResult {
    // The service owns the semantics: HIER_INPUT shape gate → the fresh
    // load (fail-loud HIER_TREE_BROKEN) → the TPC-<n> allocation → the
    // pre-write probe (HIER_TOPIC_EXISTS) → the atomic write. The RPC
    // face IS the USER lane — no actor to forward; the `projectId`
    // routing already selected this per-project wiring (requireRpc,
    // §12.1).
    try {
      const out = this.#wiring.hierarchy.createTopic({
        title: args.title,
        description: args.description,
      })
      return {
        topicId: out.topicId,
        title: out.title,
        path: out.path,
        createdAt: out.createdAt,
      }
    } catch (e) {
      throw this.#mapHierarchyError(e)
    }
  }

  createWorkstream(args: CreateWorkstreamArgs): CreateWorkstreamResult {
    // Same spine; the topic membership gate (HIER_TOPIC_NOT_FOUND) runs
    // inside the service BEFORE any allocation or write.
    try {
      const out = this.#wiring.hierarchy.createWorkstream({
        topicId: args.topicId,
        title: args.title,
        summary: args.summary,
      })
      return {
        workstreamId: out.workstreamId,
        topicId: out.topicId,
        title: out.title,
        path: out.path,
        createdAt: out.createdAt,
      }
    } catch (e) {
      throw this.#mapHierarchyError(e)
    }
  }

  updateProjectMetadata(args: UpdateProjectMetadataArgs): UpdateProjectMetadataResult {
    // UI-2A: the service owns the spine — the HIER_INPUT "at least one
    // field" gate → the fresh load (fail-loud HIER_TREE_BROKEN) → the
    // merge of the PROVIDED fields only (the rest byte-preserved) → the
    // atomic rewrite. The `projectId` routing already selected this
    // per-project wiring (requireRpc, §12.1).
    try {
      const out = this.#wiring.hierarchy.updateProjectMetadata({
        title: args.title,
        description: args.description,
        importance: args.importance,
        attentionMode: args.attentionMode,
        targetDate: args.targetDate,
      })
      return {
        projectId: out.projectId,
        title: out.title,
        updatedAt: out.updatedAt,
      }
    } catch (e) {
      throw this.#mapHierarchyError(e)
    }
  }

  updateTopic(args: UpdateTopicArgs): UpdateTopicResult {
    // UI-2A: same RMW spine over the target topic.yaml; the topic
    // membership gate (HIER_TOPIC_NOT_FOUND) runs inside the service
    // BEFORE any write.
    try {
      const out = this.#wiring.hierarchy.updateTopic({
        topicId: args.topicId,
        title: args.title,
        description: args.description,
        importance: args.importance,
        attentionMode: args.attentionMode,
      })
      return {
        topicId: out.topicId,
        title: out.title,
        updatedAt: out.updatedAt,
      }
    } catch (e) {
      throw this.#mapHierarchyError(e)
    }
  }

  updateWorkstream(args: UpdateWorkstreamArgs): UpdateWorkstreamResult {
    // UI-2A: same RMW spine over the target workstream.yaml (title +
    // summary ONLY — the update face is frozen); the workstream
    // membership gate (HIER_WORKSTREAM_NOT_FOUND) runs inside the
    // service BEFORE any write.
    try {
      const out = this.#wiring.hierarchy.updateWorkstream({
        workstreamId: args.workstreamId,
        title: args.title,
        summary: args.summary,
      })
      return {
        workstreamId: out.workstreamId,
        topicId: out.topicId,
        title: out.title,
        updatedAt: out.updatedAt,
      }
    } catch (e) {
      throw this.#mapHierarchyError(e)
    }
  }

  dropWorkstream(args: DropWorkstreamArgs): DropWorkstreamResult {
    // UI-2A: the conservative ruling — the history refusal
    // (HIER_WORKSTREAM_HAS_HISTORY) runs inside the service BEFORE the
    // whole-directory removal; the post-delete current-focus clear is
    // BEST-EFFORT (a failure there never undoes the drop — it is
    // folded into the `currentFocusCleared` result flag).
    try {
      const out = this.#wiring.hierarchy.dropWorkstream({
        workstreamId: args.workstreamId,
      })
      return {
        workstreamId: out.workstreamId,
        topicId: out.topicId,
        currentFocusCleared: out.currentFocusCleared,
      }
    } catch (e) {
      throw this.#mapHierarchyError(e)
    }
  }

  /** Close the user-surface connection (idempotent; `ctx.effect`-owned). */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    try {
      this.#dbConn.close()
    } catch {
      /* idempotent close */
    }
  }

  /* ------------------------------------------------------------------ *
   * Snapshot reads (§27.1–§27.4) — the declarative tree is the 真源;
   * every read is a FRESH load (low-frequency unary face, §8: the file
   * is the truth, no cache), plus the operational query faces.
   * ------------------------------------------------------------------ */

  /**
   * WP-4.6 (RR-015① disposition) — the query-path stale pre-check: the
   * idempotent `checkAllOpen()` sweep (PLAN_FORK_SPEC §5 「检测时机」
   * 「PF 列表查询懒检测」; §3 幂等: a non-OPEN PF re-check is a NO-OP)
   * runs BEFORE any projection so the returned snapshot reflects the
   * CURRENT truth (an OPEN PF whose closure diverged since creation is
   * already STALE-with-reason when the client renders it). Per-PF sweep
   * failures are COLLECTED by the service (`StaleSweepResult.failures`)
   * and never abort the query; a sweep-level throw (e.g. an unreadable
   * store) propagates — the query would be lying about the PF state
   * anyway. No new RPC: the 13-list stays frozen (ARCHITECTURE §7.1).
   * `workstreamId` scopes the sweep (getWorkstream) or leaves it undefined
   * (getDashboard — every topic card counts OPEN PFs).
   */
  async #stalePrecheck(workstreamId?: string): Promise<void> {
    await this.#wiring.stale.checkAllOpen(workstreamId)
  }

  async getDashboard(): Promise<DashboardSnapshot> {
    // The production refresh sidecar (V2-T3.2a: extracted as
    // runProjectRefreshSidecar — the §7.1 总览 runs the same per project):
    // RR-015① full stale sweep (a sweep-level throw propagates) + the
    // RR-018① audit refresh (the client's refresh loop IS the production
    // trigger; 失败 loud 不阻塞查询主路径 — a refresh failure is logged
    // loudly and the query projection proceeds).
    await runProjectRefreshSidecar(this.#wiring, this.#logger)
    const tree = this.#loadTree('getDashboard')
    const project = tree.project
    if (project === null) {
      throw new Error('getDashboard: project.yaml is missing or invalid (the tree loaded no project doc)')
    }
    const interventions = this.#wiring.interventions.listInterventions()
    return {
      project: {
        id: project.id,
        title: project.title,
        description: project.description ?? null,
        importance: project.importance,
        attentionMode: project.attention_mode,
        targetDate: project.target_date ?? null,
      },
      topics: tree.topics.map((t) => this.#topicCard(t)),
      openInterventions: interventions.filter((iv) => iv.status === 'OPEN').map((iv) => this.#interventionDto(iv)),
      pendingInterventions: interventions.filter((iv) => iv.status === 'PENDING').map((iv) => this.#interventionDto(iv)),
      // PHASE 5/6 placeholders (never fabricated — the strict schema pins null):
      scheduledEvents: null,
      reportingItems: null,
      // RR-018②: the reserved placeholder is now the REAL count of open
      // (CAPTURED, awaiting the user) inbox items — shape unchanged
      // (same field, same position; the frozen `z.null()` placeholder is
      // relaxed to a non-negative integer — documented exemption).
      inboxCount: this.#wiring.inbox.listItems({ state: 'CAPTURED' }).length,
      attention: null,
    }
  }

  getProject(): ProjectSnapshot {
    const tree = this.#loadTree('getProject')
    const project = tree.project
    if (project === null) {
      throw new Error('getProject: project.yaml is missing or invalid (the tree loaded no project doc)')
    }
    return {
      project: {
        id: project.id,
        title: project.title,
        description: project.description ?? null,
        importance: project.importance,
        attentionMode: project.attention_mode,
        targetDate: project.target_date ?? null,
        currentObjectiveRefs: [...project.current_objective_refs],
        createdAt: project.created_at,
      },
      objectives: tree.objectives.map((o) => this.#objectiveDto(o)),
      topics: tree.topics.map((t) => this.#topicCard(t)),
      // PHASE 5 placeholder (§27.2 「upcoming interactions/reporting」):
      upcomingInteractions: null,
      upcomingReporting: null,
    }
  }

  getTopic(args: GetTopicArgs): TopicSnapshot {
    const tree = this.#loadTree('getTopic')
    const topic = tree.topics.find((t) => t.id === args.topicId)
    if (topic === undefined) {
      throw new Error(`getTopic: topic ${args.topicId} does not exist`)
    }
    const doc = topic.doc
    if (doc === null) {
      throw new Error(`getTopic: topic ${args.topicId} has no loadable topic.yaml`)
    }
    const edges = topic.topology?.topology.edges ?? []
    const edgeIds = new Set(edges.map((e) => e.id))
    return {
      topic: {
        id: doc.id,
        title: doc.title,
        description: doc.description ?? null,
        importance: doc.importance ?? null,
        attentionMode: doc.attention_mode ?? null,
        objectiveRefs: [...doc.objective_refs],
        createdAt: doc.created_at,
      },
      workstreams: topic.workstreams.map((ws) => this.#workstreamCard(ws)),
      topology: {
        edges: edges.map((e) => ({
          id: e.id,
          operation: e.operation,
          lifecycle: e.lifecycle,
          inputs: [...e.inputs],
          outputs: [...e.outputs],
          note: e.note ?? null,
        })),
      },
      mergeContracts: tree.mergeContracts
        .filter((mc) => edgeIds.has(mc.edgeId))
        .map((mc): MergeContractRefDto => ({ edgeId: mc.edgeId, path: mc.path })),
      objectives: tree.objectives
        .filter((o) => o.scope === 'TOPIC' && o.topic_id === doc.id)
        .map((o) => this.#objectiveDto(o)),
    }
  }

  async getWorkstream(args: GetWorkstreamArgs): Promise<WorkstreamSnapshot> {
    await this.#stalePrecheck(args.workstreamId)
    const tree = this.#loadTree('getWorkstream')
    const wsNode = this.#findWorkstreamNode(tree, args.workstreamId, 'getWorkstream')
    const doc = wsNode.doc
    if (doc === null) {
      throw new Error(`getWorkstream: workstream ${args.workstreamId} has no loadable workstream.yaml`)
    }
    const events = this.#wiring.store.listRange(wsNode.id, 1)
    const runs = this.#wiring.tables.listRuns({ workstreamId: wsNode.id })
    const runningByTask = new Map<string, string[]>()
    for (const r of runs) {
      if (r.status !== 'RUNNING' || r.task_id === undefined) continue
      const list = runningByTask.get(r.task_id) ?? []
      list.push(r.id)
      runningByTask.set(r.task_id, list)
    }
    // Current-zone state: the declarative definitions + the execution/
    // validation fold over the WS event log (the history replay face —
    // a read projection; the state machine itself is enforced at append
    // time, DOMAIN_SCHEMA §13). The Set guards below keep the payload
    // (validated against the frozen catalog at append) inside the wire
    // vocabulary.
    type TaskWireState = { execution: CurrentTaskDto['execution']; validation: CurrentTaskDto['validation'] }
    const initial = new Map<string, TaskWireState>()
    for (const t of wsNode.tasks) {
      const ac = t.doc === null ? [] : t.doc.acceptance_criteria
      initial.set(t.id, {
        execution: 'PLANNED',
        validation: ac.length > 0 ? 'PENDING' : 'NOT_REQUIRED',
      })
    }
    const folded = foldEvents(events, (state: Map<string, TaskWireState>, ev) => {
      if (ev.eventType === 'TASK_EXECUTION_CHANGED') {
        const p = ev.payload as { task_id?: unknown; to?: unknown }
        if (
          typeof p.task_id === 'string' &&
          typeof p.to === 'string' &&
          TASK_EXECUTIONS.has(p.to) &&
          state.has(p.task_id)
        ) {
          const cur = state.get(p.task_id)!
          state.set(p.task_id, { ...cur, execution: p.to as TaskWireState['execution'] })
        }
      } else if (ev.eventType === 'TASK_VALIDATION_CHANGED') {
        const p = ev.payload as { task_id?: unknown; to?: unknown }
        if (
          typeof p.task_id === 'string' &&
          typeof p.to === 'string' &&
          TASK_VALIDATIONS.has(p.to) &&
          state.has(p.task_id)
        ) {
          const cur = state.get(p.task_id)!
          state.set(p.task_id, { ...cur, validation: p.to as TaskWireState['validation'] })
        }
      }
      return state
    }, initial)
    const itemTitles = new Map<string, { kind: PlanItemDto['kind']; title: string }>()
    for (const t of wsNode.tasks) {
      itemTitles.set(t.id, { kind: 'TASK', title: t.doc === null ? '' : t.doc.title })
    }
    for (const g of wsNode.gates) {
      itemTitles.set(g.id, { kind: 'GATE', title: g.doc === null ? '' : g.doc.title })
    }
    for (const m of wsNode.milestones) {
      itemTitles.set(m.id, { kind: 'MILESTONE', title: m.doc === null ? '' : m.doc.title })
    }
    const planForks = this.#wiring.planForks
      .listPlanForks({ workstreamId: wsNode.id })
      .filter((pf) => pf.status === 'OPEN' || pf.status === 'STALE')
    return {
      workstream: {
        id: doc.id,
        topicId: doc.topic_id,
        title: doc.title,
        lifecycle: doc.lifecycle,
        summary: doc.summary ?? null,
        createdAt: doc.created_at,
      },
      history: { eventCount: events.length },
      current: {
        tasks: wsNode.tasks
          .filter((t) => t.doc !== null)
          .map((t) => {
            const doc2 = t.doc!
            const state = folded.get(t.id) ?? { execution: 'PLANNED', validation: 'NOT_REQUIRED' }
            return {
              id: doc2.id,
              title: doc2.title,
              execution: state.execution,
              validation: state.validation,
              acceptanceCriteria: [...doc2.acceptance_criteria],
              liveRunIds: [...(runningByTask.get(doc2.id) ?? [])],
            }
          }),
        runs: runs.map((r) => ({
          id: r.id,
          status: r.status,
          taskId: r.task_id ?? null,
          intent: r.intent ?? null,
          startedAt: r.started_at,
          endedAt: r.ended_at ?? null,
          lastCheckpointAt: r.last_checkpoint_at ?? null,
          lastCheckpointNote: r.last_checkpoint_note ?? null,
        })),
      },
      future: {
        plan: {
          orderedItems: (wsNode.plan?.ordered_items ?? []).map((id) => {
            const item = itemTitles.get(id)
            // A dangling plan.yaml reference is a load error (the loader
            // validates it) — unreachable after #loadTree succeeded.
            if (item === undefined) {
              throw new Error(`getWorkstream: plan item ${id} of ${wsNode.id} has no definition (loader should have rejected the tree)`)
            }
            return { id, kind: item.kind, title: item.title }
          }),
        },
        planForks: planForks.map((pf) => this.#planForkDto(pf)),
        unresolvedPlanForkCount: planForks.length,
      },
    }
  }

  /* ------------------------------------------------------------------ *
   * History query — the replay query face, verbatim (seq-cursor
   * pagination; the page is never truncated mid-window).
   * ------------------------------------------------------------------ */

  queryHistory(args: QueryHistoryArgs): QueryHistoryResult {
    const page = queryEvents(this.#wiring.store, args.workstreamId, {
      order: args.order,
      afterSeq: args.afterSeq,
      beforeSeq: args.beforeSeq,
      limit: args.limit,
    })
    return {
      events: page.events.map((ev) => this.#historyEventDto(ev)),
      nextAfterSeq: page.nextAfterSeq,
      exhausted: page.exhausted,
    }
  }

  /* ------------------------------------------------------------------ *
   * User-semantic mutations — thin delegation; the forwarded services
   * own the permission checks and the business rules.
   * ------------------------------------------------------------------ */

  reorderPlan(args: ReorderPlanArgs): ReorderPlanResult {
    const tree = this.#loadTree('reorderPlan')
    const wsNode = this.#findWorkstreamNode(tree, args.workstreamId, 'reorderPlan')
    const reader = new FsResearchReader(this.#wiring.researchRoot)
    const store = new PlanStore({
      reader,
      writer: new FsPlanFileWriter(),
      researchRoot: this.#wiring.researchRoot,
      schemaDir: this.#declarativeDir,
      topicId: wsNode.topicId,
      wsId: args.workstreamId,
    })
    const current = store.loadPlan()
    if (current.errors.length > 0) {
      throw new Error(`reorderPlan: the canonical plan of ${args.workstreamId} failed to load: ${current.errors[0]!.message}`)
    }
    // The RPC contract: a REORDER is the same item set in a new order
    // (insert/delete are NOT in the frozen 13-RPC list — the kernel's
    // §4.4 validations still guard the write itself).
    const currentSet = new Set(current.items)
    for (const id of args.orderedItemIds) {
      if (!currentSet.has(id)) {
        throw new Error(
          `reorderPlan: item ${id} is not in the canonical plan of ${args.workstreamId} ` +
            '— reorder keeps the same item set (insert/delete are not part of the V1 RPC face)',
        )
      }
    }
    if (new Set(args.orderedItemIds).size !== args.orderedItemIds.length) {
      throw new Error('reorderPlan: orderedItemIds contains duplicates (the kernel rejects them too — failing early)')
    }
    const previousOrder = [...current.items]
    // The kernel owns the write: §4.4 three validations + atomic file write.
    store.savePlan(args.orderedItemIds)
    // DOMAIN_SCHEMA §12.1: ResearchHistory does NOT record plan management
    // ops — the management_action ledger is the provenance face.
    const maRes = this.#wiring.allocator.reserve('MANAGEMENT_ACTION', this.#wiring.projectId)
    try {
      const ma: ManagementActionRecord = {
        id: maRes.id,
        action_kind: 'PLAN_REORDER',
        actor: USER_ACTOR,
        subject_refs: [{ kind: 'WORKSTREAM', id: args.workstreamId }],
        detail: `canonical plan of ${args.workstreamId} reordered: [${previousOrder.join(', ')}] -> [${args.orderedItemIds.join(', ')}]`,
        occurred_at: this.#now(),
      }
      this.#db.run(SQL_INSERT_MANAGEMENT_ACTION, ...managementActionToParams(ma))
      this.#wiring.allocator.commit(maRes)
    } catch (cause) {
      this.#wiring.allocator.release(maRes)
      throw new Error(
        `reorderPlan: the plan file was rewritten but the PLAN_REORDER ledger row failed — ` +
          `the order is on disk, the provenance row is missing (manual reconciliation): ` +
          (cause instanceof Error ? cause.message : String(cause)),
      )
    }
    // UI-0.4 (R-01): the frozen reorder guard is membership + dedup
    // only — a STRICT SUBSET of the current items passes it (the kernel
    // savePlan writes it), so a subset reorder can evict the current-
    // focus target from the canonical plan. The post-commit revalidate
    // is the R-01 auto-clear enforcement on that live path (best-effort
    // — the mutation contract stands; a same-set reorder retains the
    // pointer without rewriting the row).
    this.#revalidateCurrentFocus(args.workstreamId)
    return {
      workstreamId: args.workstreamId,
      orderedItemIds: [...args.orderedItemIds],
      planPath: `${wsNode.path}/plan.yaml`,
      managementActionId: maRes.id,
    }
  }

  async selectPlanFork(args: SelectPlanForkArgs): Promise<SelectPlanForkResult> {
    // WP-3.4 owns §6: base re-check → materialize → plan.yaml rewrite →
    // the single SELECTED transaction (chained STALE + PF_SELECTED ledger
    // with the NEW closure OIDs) → compensation on DB failure. It
    // re-asserts actor.kind === USER (INV-PERM-2).
    const outcome = await this.#select.select(args.planForkId, USER_ACTOR)
    // UI-0.4 (R-01): a SELECTED fork rewrites plan.yaml with a NEW
    // closure (items can be added/removed) — the current-focus target
    // may have left the canonical Plan; revalidate enforces the
    // auto-clear (best-effort — the selection outcome stands).
    this.#revalidateCurrentFocus(outcome.workstreamId)
    return {
      planForkId: outcome.pfId,
      workstreamId: outcome.workstreamId,
      statusBefore: outcome.statusBefore,
      statusAfter: outcome.statusAfter,
      selectedAt: outcome.selectedAt,
      oldOrder: [...outcome.oldOrder],
      newOrder: [...outcome.newOrder],
      newItems: outcome.newItems.map((i) => ({ id: i.id, kind: i.kind, path: i.path })),
      removedIds: [...outcome.removedIds],
      staleOthers: outcome.staleOthers.map((s) => ({ planForkId: s.pfId, staleReason: s.stale_reason })),
      planYamlPath: outcome.planYamlPath,
      checkpointHint: outcome.checkpointHint,
    }
  }

  async dismissPlanFork(args: DismissPlanForkArgs): Promise<DismissPlanForkResult> {
    // WP-3.4 §7: OPEN|STALE → DISMISSED (status change only — never a
    // delete, INV-PLAN-4); re-asserts actor.kind === USER.
    const outcome = this.#select.dismiss(args.planForkId, USER_ACTOR)
    return {
      planForkId: outcome.pfId,
      workstreamId: outcome.workstreamId,
      statusBefore: outcome.statusBefore,
      statusAfter: outcome.statusAfter,
      dismissedAt: outcome.dismissedAt,
    }
  }

  updateInterventionState(args: UpdateInterventionStateArgs): UpdateInterventionStateResult {
    // RR-017② (WP-6.4): re-route to the WP-5.1 InterventionService
    // (same §13 guard single source, same optimistic gate, 1:1 result
    // shape — the inline pre-route implementation is retired).
    return this.#intervention.updateState(args.interventionId, args.status, INTERVENTION_USER_ACTOR, args.resolutionNote)
  }

  async registerInteraction(args: RegisterInteractionArgs): Promise<RegisterInteractionResult> {
    // WP-5.3 (DOMAIN_SCHEMA §10.1): production registration through the
    // reporting service (interaction table on the user-surface second
    // connection; INT id allocation; no-delete/no-content-update triggers).
    // USER semantics — the client face IS the user face (ARCHITECTURE §6;
    // the §6 matrix has no AGENT row for Interaction recording).
    // §16 rule 2 (operational → declarative, write-time): related_workstreams
    // must name workstreams that exist in the declarative tree.
    const tree = this.#loadTree('registerInteraction')
    const wsIds = new Set(tree.topics.flatMap((t) => t.workstreams.map((w) => w.id)))
    for (const wsId of args.relatedWorkstreams ?? []) {
      if (!wsIds.has(wsId)) {
        throw new Error(
          `registerInteraction: related workstream ${wsId} does not exist ` +
            '(DOMAIN_SCHEMA §16 rule 2 — writing a new reference to a missing object is rejected)',
        )
      }
    }
    const { record, createdAt } = this.#reporting.registerInteraction({
      kind: args.kind,
      title: args.title,
      occurredAt: args.occurredAt,
      ...(args.participants !== undefined ? { participants: [...args.participants] } : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
      ...(args.relatedWorkstreams !== undefined ? { relatedWorkstreams: [...args.relatedWorkstreams] } : {}),
    })
    return {
      id: record.id,
      kind: record.kind,
      title: record.title,
      occurredAt: record.occurred_at,
      participants: [...(record.participants ?? [])],
      notes: record.notes ?? null,
      relatedWorkstreams: [...(record.related_workstreams ?? [])],
      createdAt,
    }
  }

  async saveResearchCheckpoint(args: SaveResearchCheckpointArgs): Promise<SaveResearchCheckpointResult> {
    // WP-1.5 §5 flow (user-triggered only — INV-GIT-2): repo detect →
    // conflict detection → `.research/**`-only pathspec (INV-GIT-3) →
    // commit; the no-change short-circuit is a success (no empty commit).
    const result = await saveResearchCheckpoint(this.#wiring.repoRoot, {
      summary: args.summary,
      logger: this.#logger,
      // V2 T3.2b: the W9/W10 pathspecs follow the plane's configured tree
      // name (the wiring was built over researchDir; default `.research`
      // keeps the frozen V1 argv byte-identical).
      treeDir: this.#wiring.researchDir,
    })
    return {
      committed: result.committed,
      commitOid: result.commitOid,
      changedFiles: [...result.changedFiles],
      warnings: [...result.warnings],
      message: result.message ?? null,
    }
  }

  async getGitHistory(args: GetGitHistoryArgs): Promise<GetGitHistoryResult> {
    const result = await diffHistory(this.#wiring.repoRoot, {
      logger: this.#logger,
      path: args.path,
      baseline: args.baseline,
      maxCount: args.maxCount,
      skip: args.skip,
      treeDir: this.#wiring.researchDir,
    })
    return {
      versions: result.versions.map((v) => ({ oid: v.oid, authorDate: v.authorDate, subject: v.subject })),
      fileDiff:
        result.fileDiff === undefined
          ? null
          : result.fileDiff.map((d) => ({ status: d.status, path: d.path, oldPath: d.oldPath ?? null })),
      baseline: result.baseline ?? null,
      pathContent:
        result.pathContent === undefined || result.pathContent === null
          ? null
          : { path: result.pathContent.path, sameAsBaseline: result.pathContent.sameAsBaseline },
    }
  }

  async restoreDeclarativeFile(args: RestoreDeclarativeFileArgs): Promise<RestoreDeclarativeFileResult> {
    // WP-1.5 §6 (user-triggered only — INV-GIT-5): W6 locate → W7 prefetch
    // → W8 restore → post-restore loader validation; illegal content is
    // KEPT as-is with warnings (no silent rollback).
    const result = await restoreResearchFile(this.#wiring.repoRoot, args.commitOid, args.path, {
      logger: this.#logger,
      schemaDir: this.#declarativeDir,
      treeDir: this.#wiring.researchDir,
    })
    return {
      path: result.path,
      commitOid: result.commitOid,
      validationOk: result.validation.ok,
      validationErrors: result.validation.errors.map((e) => ({
        file: e.file,
        path: e.path ?? null,
        summary: e.message,
      })),
      warnings: [...result.warnings],
    }
  }

  /* ------------------------------------------------------------------ *
   * Projections (record → wire DTO) + lookups
   * ------------------------------------------------------------------ */

  #loadTree(operation: string): ResearchTree {
    // V2-T3.2a: the read + fail-loud verdict live in loadResearchTreeOrThrow
    // (shared with the plane-read face — one tree-load discipline).
    return loadResearchTreeOrThrow(this.#wiring.researchRoot, this.#declarativeDir, operation)
  }

  #findWorkstreamNode(tree: ResearchTree, workstreamId: string, operation: string): WorkstreamNode {
    for (const topic of tree.topics) {
      const ws = topic.workstreams.find((w) => w.id === workstreamId)
      if (ws !== undefined) return ws
    }
    throw new Error(`${operation}: workstream ${workstreamId} does not exist`)
  }

  #topicCard(topic: TopicNode): TopicCardDto {
    if (topic.doc === null) {
      throw new Error(`topic ${topic.id} has no loadable topic.yaml (loader should have reported the error)`)
    }
    return {
      id: topic.id,
      title: topic.doc.title,
      workstreamCount: topic.workstreams.length,
    }
  }

  #objectiveDto(o: ObjectiveDoc): ObjectiveDto {
    return {
      id: o.id,
      scope: o.scope,
      statement: o.statement,
      status: o.status,
      priority: o.priority,
      targetDate: o.target_date ?? null,
    }
  }

  #interventionDto(iv: InterventionRecord): InterventionDto {
    return {
      id: iv.id,
      title: iv.title,
      origin: iv.origin,
      status: iv.status,
      workstreamIds: [...iv.workstream_ids],
      createdAt: iv.created_at,
    }
  }

  #workstreamCard(ws: WorkstreamNode): WorkstreamCardDto {
    if (ws.doc === null) {
      throw new Error(`workstream ${ws.id} has no loadable workstream.yaml (loader should have reported the error)`)
    }
    return {
      id: ws.id,
      title: ws.doc.title,
      lifecycle: ws.doc.lifecycle,
      summary: ws.doc.summary ?? null,
      planItemCount: ws.plan === null ? 0 : ws.plan.ordered_items.length,
      openPlanForkCount: this.#wiring.planForks.countOpen(ws.id),
      runningRunCount: this.#wiring.tables.listRuns({ workstreamId: ws.id, status: 'RUNNING' }).length,
    }
  }

  #planForkDto(pf: PlanForkRecord): PlanForkDto {
    return {
      id: pf.id,
      // The caller pre-filters to the unresolved overlay set (OPEN|STALE).
      status: pf.status === 'OPEN' ? 'OPEN' : 'STALE',
      reason: pf.reason,
      necessity: pf.necessity,
      forkAnchor: pf.fork_anchor,
      mergeAnchor: pf.merge_anchor,
      createdByRun: pf.created_by_run,
      createdAt: pf.created_at,
      staleReason: pf.stale_reason ?? null,
      proposedItemCount: pf.proposed_items.length,
      baseGitCommit: pf.base_git_commit ?? null,
    }
  }

  #historyEventDto(ev: HistoryEventRecord): HistoryEventDto {
    return {
      eventId: ev.eventId,
      ownerWorkstreamId: ev.ownerWorkstreamId,
      eventType: ev.eventType,
      schemaVersion: ev.schemaVersion,
      occurredAt: ev.occurredAt,
      actor: {
        kind: ev.actor.kind,
        ...(ev.actor.user_id !== undefined ? { user_id: ev.actor.user_id } : {}),
        ...(ev.actor.run_id !== undefined ? { run_id: ev.actor.run_id } : {}),
        ...(ev.actor.session_id !== undefined ? { session_id: ev.actor.session_id } : {}),
        ...(ev.actor.label !== undefined ? { label: ev.actor.label } : {}),
      },
      source:
        ev.source === undefined || ev.source === null
          ? null
          : {
              kind: ev.source.kind,
              ...(ev.source.session_id !== undefined ? { session_id: ev.source.session_id } : {}),
              ...(ev.source.path !== undefined ? { path: ev.source.path } : {}),
              ...(ev.source.commit_oid !== undefined ? { commit_oid: ev.source.commit_oid } : {}),
              ...(ev.source.interaction_id !== undefined ? { interaction_id: ev.source.interaction_id } : {}),
              ...(ev.source.note !== undefined ? { note: ev.source.note } : {}),
            },
      payload: ev.payload,
      eventSeq: ev.eventSeq,
      recordedAt: ev.recordedAt,
    }
  }
}

/* -------------------------------------------------------------------- *
 * The read-only canonical plan provider (the select service's §6.1
 * re-check face — fresh read, no cache; the same composition the wiring
 * uses for its own planfork creation flow).
 * -------------------------------------------------------------------- */

/** A plan writer that refuses: the provider is READ-ONLY by construction. */
const REJECTING_PLAN_WRITER = {
  writeAtomic(_path: string): void {
    throw new Error('the RPC face plan provider is read-only (writeAtomic)')
  },
}

function makeReadonlyPlanProvider(input: {
  readonly reader: ResearchFileReader
  readonly researchRoot: string
  readonly declarativeDir: string
}): CanonicalPlanProvider {
  return {
    load(workstreamId: string) {
      const topics = input.reader.readDir(join(input.researchRoot, 'topics'))
      if (topics === null) return absentPlanView(workstreamId, '')
      for (const t of topics) {
        if (t.kind !== 'directory') continue
        const wsDirRel = `topics/${t.name}/workstreams/${workstreamId}`
        if (input.reader.readDir(join(input.researchRoot, wsDirRel)) === null) continue
        try {
          const ps = new PlanStore({
            reader: input.reader,
            writer: REJECTING_PLAN_WRITER,
            researchRoot: input.researchRoot,
            schemaDir: input.declarativeDir,
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
          return absentPlanView(workstreamId, wsDirRel, cause instanceof Error ? cause.message : String(cause))
        }
      }
      return absentPlanView(workstreamId, '')
    },
  }
}

function absentPlanView(workstreamId: string, wsDir: string, problem?: string): CanonicalPlanView {
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
