/**
 * WP-5.2 — `ActionsStore`: NextAction / Blocker 落库 + §13 状态迁移
 * （乐观条件 UPDATE, 同事务零事件）+ 查询面（无 delete）。
 *
 * 存储设计（同 WP-3.1 planfork / WP-3.5 intervention 双连接先例）:
 *   - 驱动是注入的 `ActionsDb` 结构端口（schema.ts 头注）;
 *   - 构造时 `exec(actionsDdl())`（幂等 IF NOT EXISTS — 每次 open 重放）;
 *   - **创建**（§9.3/§9.4）: 输入校验 → reserve id → INSERT → commit;
 *     失败 → release（烧号留 gap, §1.1 规则 2）+ ACT_INPUT/STORE;
 *   - **状态迁移**（§13 双终态状态机）: catalog 无 NA/BLK 事件（CATALOG
 *     §4 逐条核对）⇒ 迁移 = 乐观条件 UPDATE（WHERE status=from — 并发双
 *     迁移只有一个成功, 0 行 ⇒ 重读判别 NOT_FOUND / WRONG_STATE）;
 *     无 ManagementAction 账本行（§12.1 冻结 action_kind 枚举无
 *     NA_* 与 BLK_* kind — 行即记录: created_by/created_at + 状态缓存列）;
 *   - **权限面在存储层钉死**: PROMOTE/DISMISS/CLEAR 面 `assertUserActor`
 *     （§6 矩阵 / INV-PERM-1 闭集 — 见 state-machine.ts 头注核对结论）,
 *     创建面 `assertNextActionCreator`（USER|AGENT 泳道）;
 *   - **查询面**: get/list（status/workstream 过滤 — schema.ts 索引）;
 *     **无 delete 方法**（§15 通则; 存储层 trigger 兜底任何连接的 raw
 *     DELETE）。
 *
 * 错误纪律（同 WP-2.4）: ActionsError 原样穿透（caller-owned）; 驱动/SQL
 * 失败包 STORE（cause 保留）。
 */

import type { IdAllocator } from '../../../shared/ids/index.js'
import type { ActorRef } from '../../domain/planfork/index.js'
import {
  SQL_INSERT_BLOCKER,
  SQL_INSERT_NEXT_ACTION,
  SQL_SELECT_BLOCKER_BY_ID,
  SQL_SELECT_NEXT_ACTION_BY_ID,
  SQL_TRANSITION_BLOCKER,
  SQL_TRANSITION_NEXT_ACTION,
  actionsDdl,
  blockerToParams,
  nextActionToParams,
  rowToBlocker,
  rowToNextAction,
  BLOCKER_TABLE,
  NEXT_ACTION_TABLE,
} from './schema.js'
import {
  checkBlockerTransition,
  checkNextActionTransition,
  assertNextActionCreator,
  assertUserActor,
  isBlkStatus,
  isNaStatus,
} from './state-machine.js'
import {
  ActionsError,
  ID_PATTERNS,
  type ActionsDb,
  type AffectsRef,
  type BlockerRecord,
  type NextActionRecord,
} from './types.js'

/** `ActionsStore` construction options (DI — 同 planfork 先例). */
export interface ActionsStoreOptions {
  /** The injected operational-DB surface (schema.ts 头注的双连接模式). */
  readonly db: ActionsDb
  /** The shared project-scoped id allocator (NA/BLK families, §1.1 规则 2). */
  readonly allocator: IdAllocator
  /** The `PRJ-<n>` the counters are scoped to. */
  readonly projectId: string
  /** Clock for created_at/cleared_at (A-3 epoch ms; tests inject). */
  readonly now?: () => number
}

/** `listNextActions` filters (all optional; schema.ts 索引覆盖). */
export interface NextActionListFilter {
  readonly status?: NextActionRecord['status']
  readonly workstreamId?: string
}

/** `listBlockers` filters (all optional). */
export interface BlockerListFilter {
  readonly status?: BlockerRecord['status']
}

/** `createNextAction` 输入面（§9.3 字段表 — id/created_by/created_at 由
 *  store 与调用上下文给出; status 恒 PROPOSED — 不是参数）。 */
export interface CreateNextActionParams {
  readonly workstreamId?: string
  readonly statement: string
  readonly rationale?: string
}

/** `createBlocker` 输入面（§9.4 字段表 — id/created_at 由 store 给出;
 *  status 恒 ACTIVE）。`affects` 的引用**存在性**校验在 service 层
 *  （§16.3 需要声明式树/run 表上下文）— 本层只钉形状。 */
export interface CreateBlockerParams {
  readonly statement: string
  readonly affects: AffectsRef[]
  readonly source: string
  readonly references?: string[]
}

export class ActionsStore {
  private readonly db: ActionsDb
  private readonly allocator: IdAllocator
  private readonly projectId: string
  private readonly now: () => number
  private closed = false

  constructor(options: ActionsStoreOptions) {
    this.db = options.db
    this.allocator = options.allocator
    this.projectId = options.projectId
    this.now = options.now ?? Date.now
    // Idempotent DDL (IF NOT EXISTS) — re-applied on every open (先例:
    // planfork/flooding): 一个 WP-2.1 封装打开的新文件, 结束时同时拥有
    // 核心三表与本 WP 的两表。
    this.db.exec(actionsDdl())
  }

  /* ---------------------------------------------------------------- *
   * NextAction（§9.3）
   * ---------------------------------------------------------------- */

  /**
   * Create one PROPOSED NextAction（§9.3; 矩阵行「NextAction 创建
   * ✅/✅」— USER 或 AGENT）。`workstreamId` 可选（形状在此钉, 存在性
   * 归 service 层 §16.3）.
   */
  createNextAction(params: CreateNextActionParams, actor: ActorRef): NextActionRecord {
    this.assertOpen('createNextAction')
    assertNextActionCreator(actor, 'createNextAction')
    const record = this.validateNextActionInput(params)
    const at = this.now()
    const res = this.allocator.reserve('NEXT_ACTION', this.projectId)
    const finalRecord: NextActionRecord = {
      ...record,
      id: res.id,
      status: 'PROPOSED',
      created_by: actor,
      created_at: at,
    }
    try {
      this.db.run(SQL_INSERT_NEXT_ACTION, ...nextActionToParams(finalRecord))
    } catch (cause) {
      this.allocator.release(res)
      throw this.wrap('createNextAction', cause)
    }
    this.allocator.commit(res)
    return finalRecord
  }

  private validateNextActionInput(params: CreateNextActionParams): {
    workstream_id?: string
    statement: string
    rationale?: string
  } {
    if (typeof params.statement !== 'string' || params.statement.length === 0) {
      throw new ActionsError('ACT_INPUT', 'createNextAction: statement must be a non-empty string (DOMAIN_SCHEMA §9.3)')
    }
    let workstream_id: string | undefined
    if (params.workstreamId !== undefined) {
      if (typeof params.workstreamId !== 'string' || !ID_PATTERNS.ws.test(params.workstreamId)) {
        throw new ActionsError('ACT_INPUT', `createNextAction: workstreamId ${JSON.stringify(params.workstreamId)} is not a well-formed WS id (common.schema.json idWorkstream)`)
      }
      workstream_id = params.workstreamId
    }
    let rationale: string | undefined
    if (params.rationale !== undefined) {
      if (typeof params.rationale !== 'string' || params.rationale.length === 0) {
        throw new ActionsError('ACT_INPUT', 'createNextAction: rationale must be a non-empty string when present (DOMAIN_SCHEMA §9.3)')
      }
      rationale = params.rationale
    }
    return workstream_id === undefined ? { statement: params.statement, ...(rationale !== undefined ? { rationale } : {}) } : { workstream_id, statement: params.statement, ...(rationale !== undefined ? { rationale } : {}) }
  }

  /**
   * PROMOTE（§9.3「转正为 Task」的行侧 — **仅用户**, §6 矩阵行）。
   * `taskId` 由调用方（service 层物化流）给出; 本方法只做行状态面:
   * 乐观条件 UPDATE `PROPOSED → PROMOTED`（0 行 ⇒ 重读判别）。
   * 存储层 trigger 钉死 promoted_to_task_id 一经生成不可更换。
   */
  promoteNextAction(id: string, taskId: string, actor: ActorRef): NextActionRecord {
    this.assertOpen('promoteNextAction')
    assertUserActor(actor, `promoteNextAction(${id})`)
    if (typeof taskId !== 'string' || !ID_PATTERNS.task.test(taskId)) {
      throw new ActionsError('ACT_INPUT', `promoteNextAction(${id}): taskId ${JSON.stringify(taskId)} is not a well-formed T id (common.schema.json idTask)`)
    }
    const current = this.readNextActionRow(id)
    if (current === null) {
      throw new ActionsError('NA_NOT_FOUND', `next action ${JSON.stringify(id)} does not exist`)
    }
    checkNextActionTransition(id, current.status, 'PROMOTED')

    const changes = this.db.run(SQL_TRANSITION_NEXT_ACTION, 'PROMOTED', taskId, id)
    if (changes === 0) {
      this.reportConcurrent(id)
    }
    const updated = this.readNextActionRow(id)
    if (updated === null) {
      throw new ActionsError('NA_NOT_FOUND', `next action ${JSON.stringify(id)} vanished after transition (no-delete trigger in effect — investigate)`)
    }
    return updated
  }

  /**
   * DISMISS（§13 终态 — **仅用户**, §6 矩阵行「NextAction PROMOTE/DISMISS」）。
   */
  dismissNextAction(id: string, actor: ActorRef): NextActionRecord {
    this.assertOpen('dismissNextAction')
    assertUserActor(actor, `dismissNextAction(${id})`)
    const current = this.readNextActionRow(id)
    if (current === null) {
      throw new ActionsError('NA_NOT_FOUND', `next action ${JSON.stringify(id)} does not exist`)
    }
    checkNextActionTransition(id, current.status, 'DISMISSED')

    const changes = this.db.run(SQL_TRANSITION_NEXT_ACTION, 'DISMISSED', null, id)
    if (changes === 0) {
      this.reportConcurrent(id)
    }
    const updated = this.readNextActionRow(id)
    if (updated === null) {
      throw new ActionsError('NA_NOT_FOUND', `next action ${JSON.stringify(id)} vanished after transition (no-delete trigger in effect — investigate)`)
    }
    return updated
  }

  /** 条件 UPDATE 0 行的判别（同 WP-3.1 transition 先例）: 行消失 vs 状态已动。 */
  private reportConcurrent(id: string): never {
    const reread = this.readNextActionRow(id)
    if (reread === null) {
      throw new ActionsError('NA_NOT_FOUND', `next action ${JSON.stringify(id)} vanished during transition (no-delete trigger in effect — investigate)`)
    }
    // 重读仍 PROPOSED（0 行与重读矛盾 — 理论不可达: 终态无回边, 条件
    // UPDATE 原子）或已迁出（PROMOTED/DISMISSED）⇒ 一律拒绝并点名当下态。
    if (reread.status !== 'PROPOSED') {
      throw new ActionsError('NA_WRONG_STATE', `next action ${JSON.stringify(id)} moved concurrently (expected PROPOSED, now ${reread.status}) — refetch and retry`)
    }
    throw new ActionsError('NA_WRONG_STATE', `next action ${JSON.stringify(id)} moved concurrently (expected PROPOSED) — refetch and retry`)
  }

  /* ---------------------------------------------------------------- *
   * Blocker（§9.4）
   * ---------------------------------------------------------------- */

  /**
   * Create one ACTIVE Blocker（§9.4 — **USER-only**: INV-PERM-1 闭集外,
   * §6 无 Blocker 行 — state-machine.ts 头注②）.
   */
  createBlocker(params: CreateBlockerParams, actor: ActorRef): BlockerRecord {
    this.assertOpen('createBlocker')
    assertUserActor(actor, 'createBlocker', 'BLK_ACTOR')
    const record = this.validateBlockerInput(params)
    const at = this.now()
    const res = this.allocator.reserve('BLOCKER', this.projectId)
    const finalRecord: BlockerRecord = {
      ...record,
      id: res.id,
      status: 'ACTIVE',
      created_at: at,
    }
    try {
      this.db.run(SQL_INSERT_BLOCKER, ...blockerToParams(finalRecord))
    } catch (cause) {
      this.allocator.release(res)
      throw this.wrap('createBlocker', cause)
    }
    this.allocator.commit(res)
    return finalRecord
  }

  private validateBlockerInput(params: CreateBlockerParams): {
    statement: string
    affects: AffectsRef[]
    source: string
    references?: string[]
  } {
    if (typeof params.statement !== 'string' || params.statement.length === 0) {
      throw new ActionsError('ACT_INPUT', 'createBlocker: statement must be a non-empty string (DOMAIN_SCHEMA §9.4)')
    }
    if (typeof params.source !== 'string' || params.source.length === 0) {
      throw new ActionsError('ACT_INPUT', 'createBlocker: source must be a non-empty string (DOMAIN_SCHEMA §9.4 必填「来源说明」)')
    }
    if (!Array.isArray(params.affects) || params.affects.length === 0) {
      throw new ActionsError('ACT_INPUT', 'createBlocker: affects must be a non-empty TypedRef[] (DOMAIN_SCHEMA §9.4 必填, kind 限 WORKSTREAM/TASK/RUN)')
    }
    const affects: AffectsRef[] = params.affects.map((ref, i) => {
      if (ref === null || typeof ref !== 'object' || typeof ref.kind !== 'string' || typeof ref.id !== 'string' || ref.id.length === 0) {
        throw new ActionsError('ACT_INPUT', `createBlocker: affects[${i}] must be a {kind, id} typedRef (DOMAIN_SCHEMA §9.4)`)
      }
      const kind = ref.kind
      if (kind !== 'WORKSTREAM' && kind !== 'TASK' && kind !== 'RUN') {
        throw new ActionsError('ACT_INPUT', `createBlocker: affects[${i}].kind ${JSON.stringify(kind)} not allowed (attention.schema.json $defs/Blocker.affects: WORKSTREAM/TASK/RUN)`)
      }
      const pattern = kind === 'WORKSTREAM' ? ID_PATTERNS.ws : kind === 'TASK' ? ID_PATTERNS.task : ID_PATTERNS.run
      if (!pattern.test(ref.id)) {
        throw new ActionsError('ACT_INPUT', `createBlocker: affects[${i}].id ${JSON.stringify(ref.id)} is not a well-formed ${kind} id`)
      }
      return { kind, id: ref.id }
    })
    let references: string[] | undefined
    if (params.references !== undefined) {
      if (!Array.isArray(params.references) || params.references.some((r) => typeof r !== 'string')) {
        throw new ActionsError('ACT_INPUT', 'createBlocker: references must be a string[] when present (DOMAIN_SCHEMA §9.4)')
      }
      references = [...params.references]
    }
    return references === undefined ? { statement: params.statement, affects, source: params.source } : { statement: params.statement, affects, source: params.source, references }
  }

  /**
   * CLEAR（§13 终态 — **USER-only**; 复发 = 新 Blocker 行, 不改旧行）。
   * `cleared_at` 落迁移时刻（乐观条件 UPDATE `ACTIVE → CLEARED`）。
   */
  clearBlocker(id: string, actor: ActorRef): BlockerRecord {
    this.assertOpen('clearBlocker')
    assertUserActor(actor, `clearBlocker(${id})`, 'BLK_ACTOR')
    const current = this.readBlockerRow(id)
    if (current === null) {
      throw new ActionsError('BLK_NOT_FOUND', `blocker ${JSON.stringify(id)} does not exist`)
    }
    checkBlockerTransition(id, current.status, 'CLEARED')

    const changes = this.db.run(SQL_TRANSITION_BLOCKER, 'CLEARED', this.now(), id)
    if (changes === 0) {
      const reread = this.readBlockerRow(id)
      if (reread === null) {
        throw new ActionsError('BLK_NOT_FOUND', `blocker ${JSON.stringify(id)} vanished during transition (no-delete trigger in effect — investigate)`)
      }
      throw new ActionsError('BLK_WRONG_STATE', `blocker ${JSON.stringify(id)} moved concurrently (expected ACTIVE, now ${reread.status}) — refetch and retry`)
    }
    const updated = this.readBlockerRow(id)
    if (updated === null) {
      throw new ActionsError('BLK_NOT_FOUND', `blocker ${JSON.stringify(id)} vanished after transition (no-delete trigger in effect — investigate)`)
    }
    return updated
  }

  /* ---------------------------------------------------------------- *
   * Query face (read-only; NO delete — §15 通则 / INV-HIST-7)
   * ---------------------------------------------------------------- */

  /** One record by id (`null` when absent). */
  getNextAction(id: string): NextActionRecord | null {
    this.assertOpen('getNextAction')
    return this.readNextActionRow(id)
  }

  /**
   * List by (status?, workstreamId?) — schema.ts 索引面（GUI 分组/过滤）.
   * Order: created_at ASC, id ASC (stable — 同 planfork 先例)。
   */
  listNextActions(filter: NextActionListFilter = {}): NextActionRecord[] {
    this.assertOpen('listNextActions')
    const clauses: string[] = []
    const params: (string | number)[] = []
    if (filter.status !== undefined) {
      if (!isNaStatus(filter.status)) {
        throw new ActionsError('ACT_INPUT', `listNextActions: filter.status must be one of PROPOSED|PROMOTED|DISMISSED (got ${JSON.stringify(filter.status)})`)
      }
      clauses.push('status = ?')
      params.push(filter.status)
    }
    if (filter.workstreamId !== undefined) {
      if (typeof filter.workstreamId !== 'string' || !ID_PATTERNS.ws.test(filter.workstreamId)) {
        throw new ActionsError('ACT_INPUT', `listNextActions: filter.workstreamId ${JSON.stringify(filter.workstreamId)} is not a well-formed WS id`)
      }
      clauses.push('workstream_id = ?')
      params.push(filter.workstreamId)
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    const rows = this.db.all(`SELECT * FROM ${NEXT_ACTION_TABLE} ${where} ORDER BY created_at ASC, id ASC`, ...params)
    return rows.map((r) => rowToNextAction(r))
  }

  /** One record by id (`null` when absent). */
  getBlocker(id: string): BlockerRecord | null {
    this.assertOpen('getBlocker')
    return this.readBlockerRow(id)
  }

  /** List by (status?) — 显著区面（ACTIVE 优先展示归视图层）。 */
  listBlockers(filter: BlockerListFilter = {}): BlockerRecord[] {
    this.assertOpen('listBlockers')
    const clauses: string[] = []
    const params: (string | number)[] = []
    if (filter.status !== undefined) {
      if (!isBlkStatus(filter.status)) {
        throw new ActionsError('ACT_INPUT', `listBlockers: filter.status must be one of ACTIVE|CLEARED (got ${JSON.stringify(filter.status)})`)
      }
      clauses.push('status = ?')
      params.push(filter.status)
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    const rows = this.db.all(`SELECT * FROM ${BLOCKER_TABLE} ${where} ORDER BY created_at ASC, id ASC`, ...params)
    return rows.map((r) => rowToBlocker(r))
  }

  /** The id families this store allocates (diagnostics). */
  get allocatedCounters(): { nextAction: number; blocker: number } {
    return {
      nextAction: this.allocator.peek('NEXT_ACTION', this.projectId),
      blocker: this.allocator.peek('BLOCKER', this.projectId),
    }
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  private readNextActionRow(id: string): NextActionRecord | null {
    if (typeof id !== 'string' || id.length === 0) {
      throw new ActionsError('ACT_INPUT', 'next action id must be a non-empty string')
    }
    const row = this.db.get(SQL_SELECT_NEXT_ACTION_BY_ID, id)
    return row === undefined ? null : rowToNextAction(row)
  }

  private readBlockerRow(id: string): BlockerRecord | null {
    if (typeof id !== 'string' || id.length === 0) {
      throw new ActionsError('ACT_INPUT', 'blocker id must be a non-empty string')
    }
    const row = this.db.get(SQL_SELECT_BLOCKER_BY_ID, id)
    return row === undefined ? null : rowToBlocker(row)
  }

  private assertOpen(operation: string): void {
    if (this.closed) throw new ActionsError('STORE', `${operation}: store is closed`)
  }

  private wrap(context: string, cause: unknown): ActionsError {
    const msg = cause instanceof Error ? cause.message : String(cause)
    return new ActionsError('STORE', `${context}: ${msg}`, { cause })
  }
}
