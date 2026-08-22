/**
 * WP-3.1 — `PlanForkStore`: PlanFork 创建落库 + 状态迁移 (append-only 账本
 * 同事务) + 查询面 (无 delete)。
 *
 * 存储设计 (任务边界: 「PlanFork 记录存 operational DB, 复用 store 的
 * DatabaseSync 封装模式, DDL 放本目录」):
 *   - 驱动是注入的 `PlanForkDb` 结构端口 (node:sqlite DatabaseSync 使用
 *     面 — exec 幂等 DDL / 参数化 run/get/all / BEGIN IMMEDIATE 事务);
 *     域层零 sqlite import (ARCHITECTURE §2.2 rule 1)。DB 文件本身的
 *     open/WAL/user_version 归 WP-2.1 `openDatabase` 封装 (第二连接模式,
 *     schema.ts 头注 + tests/planfork/persist.test.ts 实证);
 *   - 构造时 `exec(planForkDdl())` (幂等 IF NOT EXISTS — 同 runbinding);
 *   - **创建** (§4 原文「通过后: 分配 PF id, status=OPEN, append 写入
 *     operational DB; 记录 ManagementAction(PF_CREATED)」): 八步纯校验
 *     (create.ts) → reserve PF id + reserve MA id → 单事务
 *     { INSERT plan_fork; INSERT management_action } → 双 commit;
 *     失败 → 双 release (烧号留 gap, §1.1 规则 2) + PF_STORE;
 *   - **状态迁移** (§10 「全部状态迁移 append-only 记录」): catalog 无
 *     PLAN_FORK_* 事件 ⇒ 迁移 = ① 乐观条件 UPDATE (WHERE status=from —
 *     并发双迁移只有一个成功, 0 行 ⇒ 重读判别 PF_NOT_FOUND/PF_WRONG_STATE)
 *     ② 同事务 append ManagementAction (action_kind 按
 *     TRANSITION_ACTION_KIND; actor 由调用方传入 — SELECT/DISMISS=用户,
 *     STALE=插件, 发射者语义归 WP-3.2/3.4 的矩阵)。
 *   - **查询面**: get/list (workstream/status 过滤 — §15 索引)/ countOpen
 *     (WP-3.5 flooding 的计数缝)/ ManagementAction 读取。**无 delete 方法**
 *     (INV-PLAN-4; 存储层 trigger 兜底任何连接的 raw DELETE)。
 *
 * Invariant mapping (逐条, 全表见报告 §实现要点):
 *   - INV-PLAN-4: 无 delete API + no-DELETE/内容不可变 trigger (schema.ts)
 *     + 迁移面只触状态缓存列 (SQL_TRANSITION_PLAN_FORK 逐字段);
 *   - INV-PLAN-5: 落库的 base_plan_objects 来自 step 3 服务端捕获 (捕获
 *     失败 ⇒ 零行落地, 事务全回滚);
 *   - INV-PLAN-6: 创建面不接受 base (create.ts 类型面 + 运行时守卫);
 *   - INV-PLAN-7: transition('SELECTED') + transition('STALE') 的乐观门 +
 *     字段共现 CHECK (同基准连锁失效 = WP-3.4 对每个 OPEN PF 调 transition
 *     STALE, stale_reason 原文 "superseded by PF-<id> selection");
 *   - INV-PLAN-8: transition('STALE') 的字段面 (stale_reason 首个差异);
 *   - §10 「PF 行永不删除」: 存储层 trigger (任何连接)。
 *
 * 错误纪律 (同 WP-2.4): PlanForkError 原样穿透 (caller-owned); 驱动/SQL
 * 失败包 PF_STORE (cause 保留)。
 */

import type { IdAllocator, Reservation } from '../../../shared/ids/index.js'
import { validatePlanForkCreation, type CreatePlanForkParams, type PlanForkCreationContext } from './create.js'
import {
  checkPfTransition,
  isPfStatus,
  TRANSITION_ACTION_KIND,
  type PfTransition,
} from './state-machine.js'
import {
  MANAGEMENT_ACTION_TABLE,
  PLAN_FORK_TABLE,
  managementActionToParams,
  planForkDdl,
  planForkToParams,
  rowToManagementAction,
  rowToPlanFork,
  SQL_INSERT_MANAGEMENT_ACTION,
  SQL_INSERT_PLAN_FORK,
  SQL_SELECT_MANAGEMENT_ACTION_BY_ID,
  SQL_SELECT_PLAN_FORK_BY_ID,
  SQL_TRANSITION_PLAN_FORK,
} from './schema.js'
import {
  ACTOR_KINDS,
  PlanForkError,
  type ActorRef,
  type ManagementActionRecord,
  type PlanForkDb,
  type PlanForkRecord,
} from './types.js'

/** `PlanForkStore` construction options (DI — 同 runbinding 先例). */
export interface PlanForkStoreOptions {
  /** The injected operational-DB surface (schema.ts 头注的双连接模式). */
  readonly db: PlanForkDb
  /** The shared project-scoped id allocator (PF/MA families, §1.1 规则 2). */
  readonly allocator: IdAllocator
  /** The `PRJ-<n>` the counters are scoped to. */
  readonly projectId: string
  /** Clock for created_at/occurred_at (A-3 epoch ms; tests inject). */
  readonly now?: () => number
}

/** `listPlanForks` filters (all optional; §15 索引 (workstream_id, status)). */
export interface PlanForkListFilter {
  readonly workstreamId?: string
  readonly status?: PlanForkRecord['status']
}

export class PlanForkStore {
  private readonly db: PlanForkDb
  private readonly allocator: IdAllocator
  private readonly projectId: string
  private readonly now: () => number
  private closed = false

  constructor(options: PlanForkStoreOptions) {
    this.db = options.db
    this.allocator = options.allocator
    this.projectId = options.projectId
    this.now = options.now ?? Date.now
    // Idempotent DDL (IF NOT EXISTS) — re-applied on every open (runbinding
    // 先例): a fresh file opened by the WP-2.1 wrapper ends with both the
    // core three tables and this WP's two.
    this.db.exec(planForkDdl())
  }

  /* ---------------------------------------------------------------- *
   * Creation (§4 八步 → id 分配 → 双写单事务 → PF_CREATED 账本)
   * ---------------------------------------------------------------- */

  /**
   * Create one OPEN PlanFork (the §4 flow). `ctx` carries the SERVER-SIDE
   * read context (policy / fresh canonical plan / frozen schemas / base
   * capturer / resolvers / clock) — the input `params` is the frozen §4
   * surface (NO base — INV-PLAN-6). Throws the first violated step's
   * `PlanForkError` (step + path 指明失败项); on storage failure after
   * validation: both reserved ids are released (burned gap) + PF_STORE.
   */
  createPlanFork(params: CreatePlanForkParams, ctx: PlanForkCreationContext): PlanForkRecord {
    this.assertOpen('createPlanFork')

    // 1) 八步纯校验 (任一失败即拒绝 — 零行落地).
    const draft = validatePlanForkCreation(params, ctx)

    // 2) 冻结行形状网 (类型面同构的运行时保证 — 构造出的记录必须过
    //    真实冻结 $defs/PlanFork; 此处以占位 PF id 校验 draft, 真实 id 在
    //    步骤 3 分配后落库; 失败 = 内部 bug, 大声)。
    if (!ctx.schemas.isUsable) {
      throw new PlanForkError({
        code: 'PF_SCHEMA_UNAVAILABLE',
        message: 'frozen plan-fork schema set unavailable — no record can be shape-checked (see PlanForkSchemas.loadErrors)',
      })
    }
    const shape = ctx.schemas.checkRecordShape({ ...draft, id: 'PF-1' })
    if (!shape.ok) {
      throw new PlanForkError({
        code: 'PF_INPUT',
        message: `internal: validated draft failed the frozen plan-fork record schema: ${shape.errors.map((e) => `${e.path || '/'}: ${e.message}`).join(' | ')}`,
      })
    }

    // 3) 分配 id (§4 「通过后: 分配 PF id」) — PF + MA (PF_CREATED 账本行).
    const pfRes = this.allocator.reserve('PLAN_FORK', this.projectId)
    const maRes = this.allocator.reserve('MANAGEMENT_ACTION', this.projectId)
    const finalRecord: PlanForkRecord = { ...draft, id: pfRes.id }

    // 4) 单事务双写 (plan_fork 行 + PF_CREATED ManagementAction)。
    const ma = this.buildPfCreatedAction(maRes.id, finalRecord, params.createdByRun, ctx.now())
    try {
      this.db.transaction(() => {
        this.db.run(SQL_INSERT_PLAN_FORK, ...planForkToParams(finalRecord))
        this.db.run(SQL_INSERT_MANAGEMENT_ACTION, ...managementActionToParams(ma))
      })
    } catch (cause) {
      this.allocator.release(pfRes)
      this.allocator.release(maRes)
      throw this.wrap('createPlanFork', cause)
    }
    this.allocator.commit(pfRes)
    this.allocator.commit(maRes)
    return finalRecord
  }

  /** The PF_CREATED ledger row (§4 原文「记录 ManagementAction(PF_CREATED)」). */
  private buildPfCreatedAction(maId: string, record: PlanForkRecord, createdByRun: string, at: number): ManagementActionRecord {
    return {
      id: maId,
      action_kind: 'PF_CREATED',
      // 创建者 = 提议的 Agent run (§1 权限表: 创建 PlanFork proposal = Agent ✅)。
      actor: { kind: 'AGENT', run_id: createdByRun },
      subject_refs: [{ kind: 'PLAN_FORK', id: record.id }],
      // 创建时刻 base closure 快照 (provenance: 该 PF 基准的 (path, oid) 集)。
      git_blob_oids: record.base_plan_objects.map((o) => ({ path: o.path, oid: o.git_blob_oid })),
      detail:
        `plan fork ${record.id} created for ${record.workstream_id} ` +
        `(fork_anchor=${record.fork_anchor}, merge_anchor=${record.merge_anchor}, ` +
        `proposed_items=${record.proposed_items.length}, trigger_refs=${record.trigger_refs.length})`,
      occurred_at: at,
    }
  }

  /* ---------------------------------------------------------------- *
   * State transitions (§10 — 乐观门 + 同事务账本 append)
   * ---------------------------------------------------------------- */

  /**
   * Execute ONE legal §10 transition (OPEN→SELECTED|DISMISSED|STALE,
   * STALE→DISMISSED). `actor` = who performs it (the ManagementAction's
   * actor — 用户 for SELECT/DISMISS, 插件 for stale marking; 发射者矩阵
   * 由调用方 WP 负责, 本 store 只做冻结 actorRef 形状校验)。
   *
   * Two-phase concurrency gate: ① pre-check against the READ row
   * (checkPfTransition — PF_WRONG_STATE with the §10 legal set); ② the
   * conditional UPDATE (WHERE id=? AND status=from) — 0 rows ⇒ a concurrent
   * transition won the race: re-read and report PF_NOT_FOUND / PF_WRONG_STATE
   * precisely. The row update + the ledger append are ONE transaction
   * (任何一半失败 ⇒ 全回滚, 行状态与账本永不分叉)。
   * Returns the UPDATED record (fresh read after commit).
   */
  transition(id: string, target: PfTransition, actor: ActorRef): PlanForkRecord {
    this.assertOpen('transition')
    this.assertActor(actor, `transition(${id})`)

    const current = this.readRow(id)
    if (current === null) throw new PlanForkError({ code: 'PF_NOT_FOUND', message: `plan fork ${JSON.stringify(id)} does not exist` })
    checkPfTransition(id, current.status, target.to)

    const maRes = this.allocator.reserve('MANAGEMENT_ACTION', this.projectId)
    const at = this.now()
    try {
      this.db.transaction(() => {
        let changes: number
        switch (target.to) {
          case 'SELECTED': {
            this.assertEpoch(target.selected_at, 'selected_at')
            changes = this.db.run(
              SQL_TRANSITION_PLAN_FORK.SELECTED,
              target.selected_at,
              JSON.stringify(target.selected_by),
              id,
              current.status,
            )
            break
          }
          case 'DISMISSED': {
            this.assertEpoch(target.dismissed_at, 'dismissed_at')
            changes = this.db.run(SQL_TRANSITION_PLAN_FORK.DISMISSED, target.dismissed_at, id, current.status)
            break
          }
          case 'STALE': {
            changes = this.db.run(SQL_TRANSITION_PLAN_FORK.STALE, target.stale_reason, id, current.status)
            break
          }
        }
        if (changes === 0) {
          // 并发迁移已先行 — 重读判别 (行消失 vs 状态已动)。
          const reread = this.readRow(id)
          if (reread === null) {
            throw new PlanForkError({ code: 'PF_NOT_FOUND', message: `plan fork ${JSON.stringify(id)} vanished during transition (no-delete trigger in effect — investigate)` })
          }
          checkPfTransition(id, reread.status, target.to)
        }
        const ma: ManagementActionRecord = {
          id: maRes.id,
          action_kind: TRANSITION_ACTION_KIND[target.to],
          actor,
          subject_refs: [{ kind: 'PLAN_FORK', id }],
          ...(target.to === 'SELECTED' ? { detail: `plan fork ${id} selected for ${current.workstream_id}` } : {}),
          ...(target.to === 'DISMISSED' ? { detail: `plan fork ${id} dismissed (was ${current.status})` } : {}),
          ...(target.to === 'STALE' ? { detail: `plan fork ${id} marked stale (was ${current.status}): ${target.stale_reason}` } : {}),
          occurred_at: at,
        }
        this.db.run(SQL_INSERT_MANAGEMENT_ACTION, ...managementActionToParams(ma))
      })
    } catch (cause) {
      if (cause instanceof PlanForkError) {
        this.allocator.release(maRes)
        throw cause
      }
      this.allocator.release(maRes)
      throw this.wrap(`transition(${id})`, cause)
    }
    this.allocator.commit(maRes)
    const updated = this.readRow(id)
    if (updated === null) throw new PlanForkError({ code: 'PF_NOT_FOUND', message: `plan fork ${JSON.stringify(id)} vanished after transition (internal)` })
    return updated
  }

  /* ---------------------------------------------------------------- *
   * Query face (read-only; NO delete — INV-PLAN-4)
   * ---------------------------------------------------------------- */

  /** One record by id (`null` when absent). */
  getPlanFork(id: string): PlanForkRecord | null {
    this.assertOpen('getPlanFork')
    return this.readRow(id)
  }

  /**
   * List by (workstreamId?, status?) — the §15 index (workstream_id,
   * status) covers the flooding count and per-WS listings. Order:
   * created_at ASC, id ASC (stable).
   */
  listPlanForks(filter: PlanForkListFilter = {}): PlanForkRecord[] {
    this.assertOpen('listPlanForks')
    const clauses: string[] = []
    const params: (string | number)[] = []
    if (filter.workstreamId !== undefined) {
      assertNonEmpty(filter.workstreamId, 'filter.workstreamId')
      clauses.push('workstream_id = ?')
      params.push(filter.workstreamId)
    }
    if (filter.status !== undefined) {
      if (!isPfStatus(filter.status)) throw new PlanForkError({ code: 'PF_INPUT', message: `filter.status must be one of OPEN|SELECTED|DISMISSED|STALE (got ${JSON.stringify(filter.status)})` })
      clauses.push('status = ?')
      params.push(filter.status)
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    const rows = this.db.all(
      `SELECT * FROM ${PLAN_FORK_TABLE} ${where} ORDER BY created_at ASC, id ASC`,
      ...params,
    )
    return rows.map((r) => rowToPlanFork(r))
  }

  /**
   * `count(status == OPEN, per workstream)` — the WP-3.5 flooding rule's
   * input (PLAN_FORK_SPEC §8: 「count(status == OPEN 的 PF, per workstream)
   * > threshold」; 本 WP 只交付计数缝, 不做 Intervention 创建)。
   */
  countOpen(workstreamId: string): number {
    this.assertOpen('countOpen')
    assertNonEmpty(workstreamId, 'workstreamId')
    const row = this.db.get(`SELECT COUNT(*) AS n FROM ${PLAN_FORK_TABLE} WHERE workstream_id = ? AND status = 'OPEN'`, workstreamId)
    return Number(row?.n ?? 0)
  }

  /** One ledger row by MA id (`null` when absent). */
  getManagementAction(id: string): ManagementActionRecord | null {
    this.assertOpen('getManagementAction')
    const row = this.db.get(SQL_SELECT_MANAGEMENT_ACTION_BY_ID, id)
    return row === undefined ? null : rowToManagementAction(row)
  }

  /** All ledger rows (stable order: occurred_at ASC, id ASC). */
  listManagementActions(): ManagementActionRecord[] {
    this.assertOpen('listManagementActions')
    const rows = this.db.all(`SELECT * FROM ${MANAGEMENT_ACTION_TABLE} ORDER BY occurred_at ASC, id ASC`)
    return rows.map((r) => rowToManagementAction(r))
  }

  /** The id families this store allocates (diagnostics). */
  get allocatedCounters(): { planFork: number; managementAction: number } {
    return {
      planFork: this.allocator.peek('PLAN_FORK', this.projectId),
      managementAction: this.allocator.peek('MANAGEMENT_ACTION', this.projectId),
    }
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  private readRow(id: string): PlanForkRecord | null {
    if (typeof id !== 'string' || id.length === 0) {
      throw new PlanForkError({ code: 'PF_INPUT', message: 'plan fork id must be a non-empty string' })
    }
    const row = this.db.get(SQL_SELECT_PLAN_FORK_BY_ID, id)
    return row === undefined ? null : rowToPlanFork(row)
  }

  private assertOpen(operation: string): void {
    if (this.closed) throw new PlanForkError({ code: 'PF_STORE', message: `${operation}: store is closed` })
  }

  /** 冻结 actorRef 形状 (kind 枚举; run_id 前缀; label ≤200 — common.schema.json). */
  private assertActor(actor: ActorRef, context: string): void {
    if (actor === null || typeof actor !== 'object' || typeof actor.kind !== 'string' ||
        !(ACTOR_KINDS as readonly string[]).includes(actor.kind)) {
      throw new PlanForkError({
        code: 'PF_INPUT',
        message: `${context}: actor must be a frozen actorRef (kind ∈ USER|AGENT|PLUGIN|SYSTEM; got ${JSON.stringify(actor)})`,
      })
    }
    if (actor.run_id !== undefined && !/^R-[1-9][0-9]*$/.test(actor.run_id)) {
      throw new PlanForkError({ code: 'PF_INPUT', message: `${context}: actor.run_id ${JSON.stringify(actor.run_id)} is not a well-formed R id (common.schema.json actorRef)` })
    }
    if (actor.label !== undefined && (typeof actor.label !== 'string' || actor.label.length > 200)) {
      throw new PlanForkError({ code: 'PF_INPUT', message: `${context}: actor.label must be a string of ≤200 chars (common.schema.json actorRef)` })
    }
  }

  private assertEpoch(value: number, field: string): void {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new PlanForkError({ code: 'PF_INPUT', message: `${field} must be a non-negative safe integer epoch ms (got ${String(value)}; §1.2/A-3)` })
    }
  }

  private wrap(context: string, cause: unknown): PlanForkError {
    const msg = cause instanceof Error ? cause.message : String(cause)
    return new PlanForkError({ code: 'PF_STORE', message: `${context}: ${msg}`, cause })
  }
}

/** The Reservation type re-exported for callers (id lifecycle bookkeeping). */
export type { Reservation }

function assertNonEmpty(value: string, what: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PlanForkError({ code: 'PF_INPUT', message: `${what} must be a non-empty string` })
  }
}
