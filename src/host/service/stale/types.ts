/**
 * WP-3.2 — closure blob-OID basis + stale detection (service layer): shared types.
 *
 * Frozen contracts implemented here (all read-only):
 *  - PLAN_FORK_SPEC §3 (Plan Closure: §3.1 `closure(WS) = { plan.yaml } ∪
 *    { ordered_items 中每个 item 的定义文件 }` — V1 默认保存整个当前 closure;
 *    §3.2 创建时逐文件 `git hash-object -- <path>` 捕获 `base_plan_objects:
 *    { path, git_blob_oid }[]` + 信息性 `base_git_commit` (当时 HEAD, 不参与
 *    stale 判定); 不自建 plan_revision_id — blob OID 让 stale 检测不依赖用户
 *    commit 频率);
 *  - PLAN_FORK_SPEC §5 (Stale 检测算法, 原文):
 *      `stale(PF) ⇔ currentClosure(WS) ≠ PF.base_plan_objects`  # (path, oid) 集合不相等
 *    集合比较：路径集合不同（增/删文件）或任一同路径文件 blob OID 不同，均判
 *    stale；文件缺失视为不同；判 stale 后：status OPEN → STALE, `stale_reason`
 *    记录首个差异（path + old/new oid）, `ManagementAction(PF_STALE_MARKED)`；
 *    stale 是信息性状态：不阻塞用户任何操作, STALE 的 PF 不能被 SELECT；
 *  - PLAN_FORK_SPEC §10 (状态机: OPEN→STALE 边 + append-only 记录；本 WP 只做
 *    OPEN→STALE, 经 WP-3.1 `PlanForkStore.transition` 乐观门 + 同事务账本);
 *  - GIT_INTEGRATION §7 (W3 用法: `hash-object` 对 **working copy** 内容计算,
 *    无需 commit；§5.2 实测: 内容一致时 hash-object == rev-parse HEAD:path,
 *    文件修改后 OID 改变 — stale 检测的正确性基础);
 *  - ARCHITECTURE §2.2 (service = 唯一允许编排 operational DB + .research 的
 *    层；git/ = 唯一允许 spawn git 的层 — 本模块只调 W3/W11 具名操作, 从不
 *    直接 spawn；无 DSH imports — INV-PERM-5).
 *
 * Layer direction (ARCHITECTURE §2.2):
 *   service → domain/planfork 公开面 (port + 状态机 + store seam)
 *           → domain/plan (真实 PlanStore canonical 加载, 经注入 reader)
 *           → domain/loader (ResearchFileReader 类型)
 *           → git 具名 W 操作 (W3 hashObject / W11 revParseHead)
 *           → shared/ids (parseId — 宽松 closure 推导的 kind 依据)
 */

import type {
  ActorRef,
  BasePlanObject,
  CanonicalPlanProvider,
  CreatePlanForkParams,
  PlanForkCreationContext,
  PlanForkListFilter,
  PlanForkRecord,
  PfStatus,
  PfTransition,
} from '../../domain/planfork/index.js'
import type { GitOptions } from '../../git/index.js'

/* ------------------------------------------------------------------ *
 * Options
 * ------------------------------------------------------------------ */

/** Default W3 concurrency (bounded pool of in-flight `hash-object` processes). */
export const DEFAULT_STALE_CONCURRENCY = 8

export interface StaleServiceOptions {
  /**
   * The Git repository root (the directory containing `.research/`). All W3
   * paths are resolved repo-root-relative (`git -C <repoRoot>` semantics —
   * GIT_INTEGRATION §3 说明: W7/W8/W3 路径相对 repo 根).
   */
  readonly repoRoot: string
  /**
   * The `.research` directory name directly under `repoRoot` (default
   * `'.research'`; 建议 workspace root = repo root — GIT_INTEGRATION §2).
   */
  readonly researchDir?: string
  /**
   * The WP-3.1 store face (production = `PlanForkStore`; structural typing
   * keeps the service testable — see {@link PlanForkStoreFace}).
   */
  readonly store: PlanForkStoreFace
  /**
   * The canonical plan provider (WP-3.1 port; production = real WP-1.3
   * `PlanStore.loadPlan` behind a filesystem reader — fresh read, no cache).
   */
  readonly planProvider: CanonicalPlanProvider
  /** Git wrapper options (timeout / executable / output cap — GIT_INTEGRATION §1.9). */
  readonly git?: GitOptions
  /**
   * Max in-flight W3 `hash-object` processes per closure capture (bounded
   * pool; 1 = serial). The frozen W3 whitelist row is ONE path per
   * invocation, so process-level batching happens at this orchestration
   * layer, not inside git (see git-capture.ts 头注 for the W13 analysis).
   */
  readonly concurrency?: number
}

/* ------------------------------------------------------------------ *
 * Store face (structural — PlanForkStore satisfies it)
 * ------------------------------------------------------------------ */

/**
 * The structural store face this service persists through (ARCHITECTURE §2.2
 * 注入结构端口 pattern — 同 WP-3.1 `PlanForkDb`). Production = WP-3.1
 * `PlanForkStore` (real sqlite; 乐观门 + 同事务账本 + no-delete trigger);
 * tests may substitute a faithful fake for failure-injection.
 *
 * NO delete face (INV-PLAN-4) — the face mirrors exactly the four
 * read/transition/create methods the stale service needs.
 */
export interface PlanForkStoreFace {
  /** One record by id (`null` when absent). */
  getPlanFork(id: string): PlanForkRecord | null
  /** List by (workstreamId?, status?) — stable order (created_at ASC, id ASC). */
  listPlanForks(filter?: PlanForkListFilter): PlanForkRecord[]
  /** Execute ONE legal §10 transition (乐观条件更新 + 同事务 ManagementAction). */
  transition(id: string, target: PfTransition, actor: ActorRef): PlanForkRecord
  /** Create one OPEN PlanFork (the §4 flow; status=OPEN + PF_CREATED 账本). */
  createPlanFork(params: CreatePlanForkParams, ctx: PlanForkCreationContext): PlanForkRecord
}

/* ------------------------------------------------------------------ *
 * Closure diff (§5 structured report)
 * ------------------------------------------------------------------ */

/**
 * One diff entry kind (PLAN_FORK_SPEC §5 集合比较的四种差异形态):
 *  - `added`       — path in the current closure set, absent from the base set;
 *  - `removed`     — path in the base set, absent from the current closure set
 *                    (定义文件保留 on disk per INV-PLAN-9 is irrelevant — the
 *                    CLOSURE set lost the path because `ordered_items` changed);
 *  - `oid_changed` — same path in both sets, different working-copy blob OID
 *                    (内容变了 — 含 plan.yaml 重排：顺序在 plan.yaml 内容里,
 *                    OID 变了 ⇒ stale);
 *  - `missing`     — path present in a closure set but NOT a regular file on
 *                    disk (「文件缺失视为不同」). `base_oid` set ⇒ was in the
 *                    base set; `base_oid` null ⇒ only in the current set.
 */
export type ClosureDiffKind = 'added' | 'removed' | 'oid_changed' | 'missing'

/** One precisely-located closure difference (structured stale report). */
export interface ClosureDiffEntry {
  /** Workspace-relative closure path (`.research`-relative, POSIX). */
  readonly path: string
  readonly kind: ClosureDiffKind
  /** The creation-time OID (null = the path was not in the base set). */
  readonly base_oid: string | null
  /** The current working-copy OID (null = not in the current set / not on disk). */
  readonly current_oid: string | null
}

/* ------------------------------------------------------------------ *
 * Check / sweep results
 * ------------------------------------------------------------------ */

/** The structured result of ONE `checkStale(pfId)` call. */
export interface StaleCheckOutcome {
  readonly pfId: string
  readonly workstreamId: string
  /** The PF status before this call. */
  readonly statusBefore: PfStatus
  /** The PF status after this call (equals statusBefore for no-ops). */
  readonly statusAfter: PfStatus
  /** True iff `statusAfter === 'STALE'` (covers PFs already STALE before). */
  readonly stale: boolean
  /** True iff THIS call performed the OPEN→STALE transition. */
  readonly markedStale: boolean
  /**
   * The structured (path, old/new oid) diff (§5 原文: 哪些文件变 OID + 增删 +
   * 缺失). Empty for no-op outcomes (already STALE / not OPEN) and for
   * checks that found no difference.
   */
  readonly diff: readonly ClosureDiffEntry[]
  /**
   * The recomputed current closure (path → working-copy blob OID), for
   * entries present on disk (missing entries live in `diff` only). Empty for
   * no-op outcomes (non-OPEN PFs are not re-checked — §5 trigger face is
   * OPEN; idempotency requirement).
   */
  readonly currentClosure: readonly BasePlanObject[]
  /** HEAD at recheck time (信息性 — §3.2: 不参与 stale 判定). */
  readonly gitCommit?: string
}

/** The aggregated result of `checkAllOpen()`. */
export interface StaleSweepResult {
  /** One outcome per successfully checked OPEN PF (store stable order). */
  readonly outcomes: readonly StaleCheckOutcome[]
  /**
   * PFs whose check threw (per-PF failures do NOT abort the sweep — the
   * remaining OPEN PFs are still checked; the error is surfaced here, not
   * swallowed).
   */
  readonly failures: readonly { readonly pfId: string; readonly error: unknown }[]
}

/** A server-side capture of the CURRENT canonical plan closure (§3.1/§3.2). */
export interface CapturedClosure {
  readonly workstreamId: string
  /** The `.research`-relative workstream directory (`topics/<TPC>/workstreams/<WS>`). */
  readonly wsDir: string
  /** The §3.1 closure paths (stable order: plan.yaml first, then canonical order). */
  readonly paths: readonly string[]
  /** Working-copy blob OIDs, 1:1 with `paths` (empty closure ⇒ empty). */
  readonly objects: readonly BasePlanObject[]
  /** HEAD at capture time (信息性; undefined when the repo has no commits yet or the closure is empty). */
  readonly gitCommit?: string
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export type StaleServiceErrorCode =
  /** Malformed argument at the service boundary (non-empty ids, concurrency shape, options). */
  | 'STALE_INPUT'
  /** Git infrastructure failure during a stale recheck (GitError as cause) — the check aborts, NO state change. */
  | 'STALE_GIT'
  /** Closure capture found a closure path that is not a regular file on disk (creation/standalone capture face). */
  | 'STALE_CAPTURE'

/**
 * A stale-service violation (ARCHITECTURE §10: 错误信息指明失败项 — precise
 * message, no guess-repair). Domain-level failures (PF_NOT_FOUND /
 * PF_WRONG_STATE / PF_BASE_CAPTURE …) propagate as WP-3.1 `PlanForkError`
 * unchanged — this class only covers service-boundary conditions.
 */
export class StaleServiceError extends Error {
  readonly code: StaleServiceErrorCode

  constructor(code: StaleServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StaleServiceError'
    this.code = code
  }
}

/** Type guard for `StaleServiceError` (service layer / tests / WP-3.3 tool face). */
export function isStaleServiceError(error: unknown): error is StaleServiceError {
  return error instanceof StaleServiceError
}
