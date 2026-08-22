/**
 * WP-3.2 — `PlanForkStaleService`: closure blob-OID basis + stale detection.
 *
 * The three deliverable faces (PLAN_FORK_SPEC §3/§5/§10; GIT_INTEGRATION §7):
 *
 * 1. **closure 捕获（§3.1 + §3.2）** — `capturePlanClosure(wsId)` computes
 *    the §3.1 closure of the CURRENT canonical plan and captures per-file
 *    working-copy blob OIDs via the git wrapper's W3 (bounded pool) + the
 *    informational HEAD (W11). `createPlanFork(params, ctx)` is the
 *    production creation path: it pre-captures the base (real git), then
 *    runs the WP-3.1 八步 chain + `PlanForkStore.createPlanFork` with a
 *    synchronous adapter that hands the captured base to step 3 — the
 *    record's `base_plan_objects` (+ `base_git_commit`) thus always come
 *    from the server-side git recompute (INV-PLAN-6).
 *
 * 2. **stale 检测（§5 算法原文）** — `checkStale(pfId)`: for an OPEN PF,
 *    recompute the current closure OID set and compare it with
 *    `PF.base_plan_objects` as SETS (路径集合不同 或 同路径 OID 不同 ⇒
 *    stale; 文件缺失视为不同). A difference ⇒ `OPEN → STALE` via the
 *    WP-3.1 state-machine face (`store.transition` — 乐观条件更新 +
 *    同事务 `ManagementAction(PF_STALE_MARKED)`, actor=PLUGIN) with
 *    `stale_reason` = the FIRST diff (path + old/new oid — §5 原文口径)
 *    + the full structured diff in the outcome.
 *
 * 3. **检测触发面** — `checkStale(pfId)` (manual, single) +
 *    `checkAllOpen(workstreamId?)` (sweep; per-PF failures are collected,
 *    never abort the sweep). The TRIGGER TIMING (plan/item 加载/变更后、PF
 *    列表查询懒检测、SELECT 前强制复核 — §5) is the host wiring's
 *    decision (later WP); this WP provides the API only.
 *
 * Idempotency: re-checking a non-OPEN PF is a NO-OP (no recompute, no
 * transition, no ledger row — `STALE → STALE` is not in the §10 table; a
 * STALE PF stays STALE with its original first-difference reason until the
 * Agent re-proposes or the user dismisses).
 *
 * stale is an INFORMATIONAL state (§5): nothing here blocks any user
 * operation; SELECT refusal for STALE PFs is the WP-3.4 preface
 * (`PF.status == OPEN` 前置 — INV-PLAN-8).
 *
 * Layer direction (ARCHITECTURE §2.2): service → domain/planfork (port +
 * 状态机 + store seam) + git 具名 W 操作 (W3/W11) + shared/ids. No DSH
 * imports (INV-PERM-5). No direct spawn (INV-GIT-6). No canonical writes
 * (INV-PLAN-3 — this service only READS .research/).
 */

import {
  closureRelativePaths,
  PlanForkError,
  validatePlanForkCreation,
  type BasePlanObject,
  type ClosureBlobCapturer,
  type CreatePlanForkParams,
  type PlanForkCreationContext,
  type PlanForkRecord,
} from '../../domain/planfork/index.js'
import { GitError, type GitOptions } from '../../git/index.js'
import {
  closurePathsLenient,
  compareClosureBases,
  formatStaleReason,
} from './closure.js'
import {
  captureGitClosureBase,
  hashClosure,
  withCapturedBase,
  type GitClosureOptions,
  type HashedClosure,
} from './git-capture.js'
import {
  DEFAULT_STALE_CONCURRENCY,
  StaleServiceError,
  type CapturedClosure,
  type StaleCheckOutcome,
  type StaleServiceOptions,
  type StaleSweepResult,
} from './types.js'

/** The stale-marking actor (§5: 判 stale 是插件的机械动作 — actor=PLUGIN). */
const STALE_ACTOR = { kind: 'PLUGIN' as const }

export class PlanForkStaleService {
  private readonly repoRoot: string
  private readonly researchDir: string
  private readonly store: StaleServiceOptions['store']
  private readonly planProvider: StaleServiceOptions['planProvider']
  private readonly git: GitOptions | undefined
  private readonly concurrency: number

  constructor(options: StaleServiceOptions) {
    if (options === null || typeof options !== 'object') {
      throw new StaleServiceError('STALE_INPUT', 'options must be an object (StaleServiceOptions)')
    }
    if (typeof options.repoRoot !== 'string' || options.repoRoot.length === 0) {
      throw new StaleServiceError(
        'STALE_INPUT',
        'repoRoot must be a non-empty string (the Git repository root containing .research/)',
      )
    }
    const researchDir = options.researchDir ?? '.research'
    if (
      typeof researchDir !== 'string' ||
      researchDir.length === 0 ||
      researchDir === '.' ||
      researchDir === '..' ||
      researchDir.startsWith('/') ||
      researchDir.startsWith('..') ||
      researchDir.includes('\0')
    ) {
      throw new StaleServiceError(
        'STALE_INPUT',
        `researchDir must be a repo-root-relative directory name (default '.research'; got ${JSON.stringify(researchDir)})`,
      )
    }
    const concurrency = options.concurrency ?? DEFAULT_STALE_CONCURRENCY
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new StaleServiceError(
        'STALE_INPUT',
        `concurrency must be a positive safe integer (default ${DEFAULT_STALE_CONCURRENCY}; got ${String(concurrency)})`,
      )
    }
    if (options.store === null || typeof options.store !== 'object') {
      throw new StaleServiceError('STALE_INPUT', 'store is required (the WP-3.1 PlanForkStore face)')
    }
    if (options.planProvider === null || typeof options.planProvider !== 'object') {
      throw new StaleServiceError('STALE_INPUT', 'planProvider is required (the WP-3.1 CanonicalPlanProvider face)')
    }
    this.repoRoot = options.repoRoot
    this.researchDir = researchDir
    this.store = options.store
    this.planProvider = options.planProvider
    this.git = options.git
    this.concurrency = concurrency
  }

  private get gitOpts(): GitClosureOptions {
    return {
      repoRoot: this.repoRoot,
      researchDir: this.researchDir,
      git: this.git,
      concurrency: this.concurrency,
    }
  }

  /* ---------------------------------------------------------------- *
   * Deliverable 1 — closure 捕获 (§3.1 文件集 + §3.2 逐文件 W3 blob OID)
   * ---------------------------------------------------------------- */

  /**
   * Capture the CURRENT canonical plan closure of `workstreamId` (§3.1
   * file set in stable order + §3.2 per-file working-copy blob OID via the
   * bounded W3 pool + informational HEAD). A workstream/plan that no longer
   * exists yields the EMPTY closure (no files to hash) — the caller
   * decides what that means; a missing closure FILE fails loud
   * (`STALE_CAPTURE`).
   */
  async capturePlanClosure(workstreamId: string): Promise<CapturedClosure> {
    if (typeof workstreamId !== 'string' || workstreamId.length === 0) {
      throw new StaleServiceError('STALE_INPUT', 'workstreamId must be a non-empty string (a WS id)')
    }
    const view = this.planProvider.load(workstreamId)
    if (!view.workstream_exists || !view.present) {
      return { workstreamId, wsDir: view.wsDir, paths: [], objects: [] }
    }
    // Strict face: the creation path requires a consistent canonical plan;
    // a malformed ordered_items element is an upstream validation failure
    // (PF_INPUT propagates unchanged — same behavior as the §4 chain step 3).
    const paths = closureRelativePaths(view.wsDir, view.ordered_items)
    const base = await captureGitClosureBase(this.gitOpts, paths)
    return {
      workstreamId,
      wsDir: view.wsDir,
      paths,
      objects: base.objects,
      ...(base.gitCommit !== undefined ? { gitCommit: base.gitCommit } : {}),
    }
  }

  /**
   * The production PF creation path (PLAN_FORK_SPEC §4 + §3.2):
   *
   * 1. **The pure §4 八步 chain FIRST** (with a recording placeholder
   *    capturer) — any §4 violation (steps 1–2 in particular) rejects with
   *    the EXACT frozen error priority before any git work happens (zero W3
   *    cost for invalid creations; a malformed plan never triggers a
   *    capture);
   * 2. the REAL git capture of exactly the closure step 3 used (W3 bounded
   *    pool + W11 HEAD) — failures throw `PF_BASE_CAPTURE` (step 3) exactly
   *    as the domain chain would;
   * 3. a shape re-verification that the canonical plan did not change
   *    between the (caller-supplied) view snapshot and the completed
   *    capture — a changed closure means the base no longer matches the
   *    validated plan ⇒ `PF_BASE_CAPTURE` (re-run creation);
   * 4. persist through the WP-3.1 store (which re-runs the chain with the
   *    real base and writes the PF_CREATED ledger row).
   *
   * The record's `base_plan_objects` / `base_git_commit` are thus always
   * server-side git recomputes (INV-PLAN-6 — no client base, structurally:
   * `CreatePlanForkParams` has no base key).
   *
   * `ctx` is the §4 creation context (policy / FRESH canonical plan view /
   * frozen schemas / resolvers / clock) — the service replaces ONLY
   * `ctx.baseCapturer`.
   */
  async createPlanFork(params: CreatePlanForkParams, ctx: PlanForkCreationContext): Promise<PlanForkRecord> {
    const view = ctx.plan
    if (view === null || typeof view !== 'object' || typeof view.wsDir !== 'string' || !Array.isArray(view.ordered_items)) {
      throw new StaleServiceError('STALE_INPUT', 'ctx.plan is required (the fresh canonical plan view — §4 步骤 2)')
    }

    // Phase 1 — pure §4 chain first (frozen error priority; zero git cost).
    // The placeholder base satisfies step 3's non-emptiness check only; the
    // draft it yields is discarded (never persisted).
    let recordedWsDir: string | null = null
    let recordedClosure: string[] = []
    const recordingCapturer: ClosureBlobCapturer = {
      capture(wsDir, closure) {
        recordedWsDir = wsDir
        recordedClosure = [...closure]
        return { objects: [{ path: 'placeholder', git_blob_oid: '0'.repeat(40) }] }
      },
    }
    validatePlanForkCreation(params, { ...ctx, baseCapturer: recordingCapturer })
    if (recordedWsDir === null) {
      throw new StaleServiceError('STALE_INPUT', 'internal: the §4 chain did not reach step-3 capture (creation must be invalid — investigate)')
    }

    // Phase 2 — the real git capture of exactly the closure step 3 used.
    let base
    try {
      base = await captureGitClosureBase(this.gitOpts, recordedClosure)
    } catch (cause) {
      throw new PlanForkError({
        code: 'PF_BASE_CAPTURE',
        step: 3,
        message:
          `server-side closure base capture failed for ${JSON.stringify(view.workstream_id)} ` +
          `(${recordedClosure.length} closure files): ${cause instanceof Error ? cause.message : String(cause)} ` +
          `(PLAN_FORK_SPEC §4 步骤 3/§3.2; 基准永远重算, 不接受客户端提交 base — INV-PLAN-6)`,
        cause,
      })
    }

    // Phase 3 — the view is the caller's snapshot; the disk is the user's.
    // If the plan's shape changed during the async capture, the base no
    // longer matches the validated plan — fail loud (re-run creation).
    const fresh = this.planProvider.load(view.workstream_id)
    if (fresh.workstream_exists && fresh.present) {
      let freshClosure: string[]
      try {
        freshClosure = closureRelativePaths(fresh.wsDir, fresh.ordered_items)
      } catch {
        freshClosure = closurePathsLenient(fresh.wsDir, fresh.ordered_items)
      }
      if (fresh.wsDir !== recordedWsDir || JSON.stringify(freshClosure) !== JSON.stringify(recordedClosure)) {
        throw new PlanForkError({
          code: 'PF_BASE_CAPTURE',
          step: 3,
          message:
            `the canonical plan changed during base capture (closure ${recordedClosure.length} → ${freshClosure.length} files) ` +
            `for ${JSON.stringify(view.workstream_id)} — re-run creation with a fresh plan view (INV-PLAN-6)`,
        })
      }
    }

    // Phase 4 — persist (the store re-runs the chain with the real base).
    return this.store.createPlanFork(params, { ...ctx, baseCapturer: withCapturedBase(base) })
  }

  /* ---------------------------------------------------------------- *
   * Deliverable 2 — stale 检测 (§5 算法原文)
   * ---------------------------------------------------------------- */

  /**
   * Check ONE PlanFork for basis staleness (PLAN_FORK_SPEC §5):
   *
   *   `stale(PF) ⇔ currentClosure(WS) ≠ PF.base_plan_objects`
   *
   *  - OPEN PF: recompute the current closure (fresh canonical plan view →
   *    §3.1 paths → bounded W3 rehash), set-compare with the base; a
   *    difference ⇒ `OPEN → STALE` (state-machine face: 乐观条件更新 +
   *    同事务 PF_STALE_MARKED 账本, actor=PLUGIN) + `stale_reason` = the
   *    first diff (path + old/new oid) + the full structured diff;
   *  - non-OPEN PF: NO-OP (idempotent — no recompute, no transition, no
   *    ledger row; the §10 table has no STALE→STALE edge);
   *  - git infrastructure failure: throw `STALE_GIT` — the check aborts
   *    with NO state change (fail loud — never guess staleness).
   *
   * The current closure when the plan is inconsistent (user mid-edit) is
   * computed LENIENTLY (plan.yaml + well-formed T/G/M elements only) — the
   * §5 set comparison then runs on the computable part (and plan.yaml's own
   * OID changed too, in practice). A vanished workstream/plan.yaml ⇒ empty
   * current set ⇒ every base entry is `removed` ⇒ stale.
   */
  async checkStale(pfId: string): Promise<StaleCheckOutcome> {
    if (typeof pfId !== 'string' || pfId.length === 0) {
      throw new StaleServiceError('STALE_INPUT', 'pfId must be a non-empty string (a PF id)')
    }
    const record = this.store.getPlanFork(pfId)
    if (record === null) {
      throw new PlanForkError({
        code: 'PF_NOT_FOUND',
        message: `plan fork ${JSON.stringify(pfId)} does not exist`,
      })
    }

    if (record.status !== 'OPEN') {
      // §5 trigger face = OPEN PFs; STALE/SELECTED/DISMISSED are no-ops
      // (idempotent re-check — the task requirement 「STALE 后再检测幂等」).
      return {
        pfId: record.id,
        workstreamId: record.workstream_id,
        statusBefore: record.status,
        statusAfter: record.status,
        stale: record.status === 'STALE',
        markedStale: false,
        diff: [],
        currentClosure: [],
      }
    }

    const view = this.planProvider.load(record.workstream_id)
    let paths: string[]
    if (!view.workstream_exists || !view.present) {
      // plan.yaml gone ⇒ the current closure is empty ⇒ the whole base set
      // is 'removed' (「文件缺失视为不同」).
      paths = []
    } else {
      try {
        paths = closureRelativePaths(view.wsDir, view.ordered_items)
      } catch {
        // Inconsistent plan (malformed ordered_items element — the strict
        // face throws PF_INPUT): fall back to the lenient closure so the §5
        // comparison runs on the computable set.
        paths = closurePathsLenient(view.wsDir, view.ordered_items)
      }
    }

    let hashed: HashedClosure
    try {
      hashed = await hashClosure(this.gitOpts, paths)
    } catch (cause) {
      if (cause instanceof GitError) {
        throw new StaleServiceError(
          'STALE_GIT',
          `git recheck failed for ${JSON.stringify(record.workstream_id)}: ${cause.message} — no state change`,
          { cause },
        )
      }
      throw cause
    }

    const diff = compareClosureBases(record.base_plan_objects, hashed.entries)
    const currentClosure: BasePlanObject[] = hashed.entries
      .filter((e) => e.oid !== null)
      .map((e) => ({ path: e.path, git_blob_oid: e.oid! }))
    const commitPart = hashed.gitCommit !== undefined ? { gitCommit: hashed.gitCommit } : {}

    if (diff.length === 0) {
      return {
        pfId: record.id,
        workstreamId: record.workstream_id,
        statusBefore: 'OPEN',
        statusAfter: 'OPEN',
        stale: false,
        markedStale: false,
        diff: [],
        currentClosure,
        ...commitPart,
      }
    }

    // §5: 判 stale 后 — OPEN → STALE, stale_reason 记录首个差异,
    // ManagementAction(PF_STALE_MARKED) (via the WP-3.1 state-machine face:
    // 乐观条件更新 + 同事务账本, actor=PLUGIN — 插件机械动作).
    const reason = formatStaleReason(diff)
    const updated = this.store.transition(record.id, { to: 'STALE', stale_reason: reason }, STALE_ACTOR)
    return {
      pfId: updated.id,
      workstreamId: updated.workstream_id,
      statusBefore: 'OPEN',
      statusAfter: updated.status,
      stale: true,
      markedStale: true,
      diff,
      currentClosure,
      ...commitPart,
    }
  }

  /* ---------------------------------------------------------------- *
   * Deliverable 3 — 检测触发面 (sweep)
   * ---------------------------------------------------------------- */

  /**
   * Sweep ALL OPEN PFs (optionally one workstream) through `checkStale`.
   * Runs sequentially in the store's stable order (created_at ASC, id ASC) —
   * deterministic, and per-PF closure hashing is already batched internally.
   * A per-PF failure (e.g. a concurrent DISMISS racing the sweep, a DB
   * fault) is COLLECTED in `failures`, never aborting the remaining PFs.
   */
  async checkAllOpen(workstreamId?: string): Promise<StaleSweepResult> {
    if (workstreamId !== undefined && (typeof workstreamId !== 'string' || workstreamId.length === 0)) {
      throw new StaleServiceError(
        'STALE_INPUT',
        'workstreamId must be a non-empty string (or undefined to sweep all workstreams)',
      )
    }
    const open = this.store.listPlanForks(
      workstreamId === undefined ? { status: 'OPEN' } : { status: 'OPEN', workstreamId },
    )
    const outcomes: StaleCheckOutcome[] = []
    const failures: { readonly pfId: string; readonly error: unknown }[] = []
    for (const rec of open) {
      try {
        outcomes.push(await this.checkStale(rec.id))
      } catch (error) {
        failures.push({ pfId: rec.id, error })
      }
    }
    return { outcomes, failures }
  }
}
