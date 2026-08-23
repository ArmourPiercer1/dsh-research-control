/**
 * WP-5.2 — `ActionsService`: NextAction / Blocker 的用户+Agent 业务面
 * （§16.3 写时引用校验 + §13 状态机 + §6 权限矩阵 + PROMOTE 物化流）。
 *
 * 与 `ActionsStore` 的分工（同 WP-3.1 create.ts/store.ts 先例）:
 *   - store = 纯 DB 面（DDL/INSERT/条件 UPDATE/查询 + 存储层权限门）;
 *   - service = 需要**上下文**的业务面: 声明式树（§16.3 存在性）、
 *     run 表（RUN 引用）、PlanStore 物化（PROMOTE 转正为 Task）。
 *
 * 面清单（任务书目标 2 + §6 矩阵泳道）:
 *   - `createNextAction`      — USER ✅ / AGENT ✅（§6 行「NextAction 创建」;
 *     AGENT 经 `research_next_action_create` 工具面转发, WP-3.3 stub 的
 *     plannedService 即本面）;
 *   - `promoteNextAction`     — **USER only**（§6 行「NextAction
 *     PROMOTE/DISMISS ✅/❌/❌/❌」; §9.3「用户才 PROMOTE（转正为 Task）」）
 *     — 完整物化流（见下）;
 *   - `dismissNextAction`     — **USER only**（同上矩阵行）;
 *   - `createBlocker` / `clearBlocker` — **USER only**（INV-PERM-1 闭集外;
 *     §6 无 Blocker 行 — state-machine.ts 头注②）;
 *   - 查询面透传（RPC/视图数据缝 — 冻结 13 RPC 无注意力面, 接线面归
 *     后续集成, 见报告「实现要点」§3）。
 *
 * ## PROMOTE 物化流（§9.3「转正为 Task」— 同 WP-3.4 SELECT 物化/补偿纪律）
 *
 *   前置 `NA.status == PROPOSED`（§13 守卫）⇒
 *   1. **目标 WS 判定**: `params.workstreamId ?? NA.workstream_id` —
 *      Task 必须属一个 WS（task.schema.json 必填 workstream_id）⇒
 *      无 workstream_id 的 NA 在 PROMOTE 时**必须**显式给 WS（GUI 选择面）;
 *      NA 已带 WS 时显式参数必须一致（不允许静默改挂）; WS 必须在树中存在
 *      （§16.3）;
 *   2. **计划前置**: 目标 WS 的 `plan.yaml` 必须存在（物化 = 插入既有
 *      canonical plan — 无计划文件的 WS 先建计划; 同时此前置让补偿面
 *      永远有旧字节可恢复 — writer 无 unlink 面, 不制造「补偿即删除」）;
 *   3. **物化 Task 定义文件**（§4.1）: 分配 T id（共享 allocator, §1.1
 *      规则 2）→ `PlanStore.createItem('task', doc)`（冻结 task.schema.json
 *      前置校验 + 原子写; title = NA.statement（≤200, schema maxLength）,
 *      goal = statement + rationale 附注, acceptance_criteria=[] ⇒
 *      validation 只能 NOT_REQUIRED — INV-TASK-3 合法; created_by = USER
 *      执行者）;
 *   4. **重写 plan.yaml**（§4.4）: 旧文件精确字节留存（补偿用）→
 *      `PlanStore.savePlan(新序)`（§4.4 三校验 + 原子写）; 插入位置
 *      `params.index`（默认末尾）;
 *   5. **DB 事务**: NA 行乐观条件 UPDATE `PROPOSED → PROMOTED`
 *      （promoted_to_task_id 落定 — 存储层 trigger 钉死一经生成不可更换）
 *      + `PLAN_ITEM_ADDED` 账本行（§12.1 冻结 kind — 「新 item 进计划」的
 *      provenance; actor = USER 执行者）; 0 行 ⇒ 并发迁移 ⇒ 整事务回滚;
 *   6. **补偿**（文件半边已落而 DB 失败 / 并发迁移）: 恢复旧 plan.yaml
 *      精确字节（原子回写）; Task 定义文件**保留**为未列入定义
 *      （INV-PLAN-9 合法部分态 — 本服务从不删除 .research 文件, §10
 *      「restore 显式触发」）; 烧号留 gap（§1.1 规则 2）; 大声错误
 *      （PROMOTE_CONCURRENT / PROMOTE_DB_FAILED; 补偿自身失败 ⇒
 *      PROMOTE_COMPENSATION_FAILED — 人工介入, 同 WP-3.4 §6.6 口径）。
 *   7. §12.1/§13: 不写 ResearchHistory（CATALOG 无 NA 事件 — 模块头核查
 *      口径; 账本行是唯一落库痕迹）。
 */

import { PlanStore, type PlanFileWriter } from '../../domain/plan/index.js'
import {
  loadResearchTree,
  pjoin,
  type ObjectiveDoc,
  type ResearchFileReader,
  type ResearchTree,
  type TaskDoc,
  type WorkstreamNode,
} from '../../domain/loader/index.js'
import {
  managementActionToParams,
  SQL_INSERT_MANAGEMENT_ACTION,
  type ActorRef,
  type ManagementActionRecord,
} from '../../domain/planfork/index.js'
import { SQL_TRANSITION_NEXT_ACTION } from './schema.js'
import type { IdAllocator } from '../../../shared/ids/index.js'
import {
  checkNextActionTransition,
  assertNextActionCreator,
  assertUserActor,
} from './state-machine.js'
import { ObjectiveFileService } from './objectives.js'
import { ActionsError, ID_PATTERNS, type ActionsDb, type AffectsRef, type BlockerRecord, type NextActionRecord } from './types.js'
import {
  ActionsStore,
  type BlockerListFilter,
  type CreateBlockerParams,
  type CreateNextActionParams,
  type NextActionListFilter,
} from './store.js'

/** `promoteNextAction` 输入面（用户选择的目标 WS + 插入位置）。 */
export interface PromoteNextActionParams {
  /** 目标 workstream（NA 无 workstream_id 时必填; 有时必须一致）。 */
  readonly workstreamId?: string
  /** 插入 canonical plan 的位置（0-based; 默认末尾）。 */
  readonly index?: number
}

/** `promoteNextAction` 结果（物化面全量回执 — 同 SELECT outcome 口径）。 */
export interface PromoteNextActionResult {
  readonly nextActionId: string
  /** 转正生成的 Task id（§9.3 promoted_to_task_id）。 */
  readonly taskId: string
  readonly workstreamId: string
  /** `.research/` 相对的 plan.yaml 路径（checkpoint 提示面）。 */
  readonly planPath: string
  /** 物化后的 canonical plan 顺序。 */
  readonly newOrder: string[]
  readonly managementActionId: string
}

/** The injected run-existence face（§16.3 第 3 条: RUN 引用写时校验）。 */
export interface RunExistence {
  exists(runId: string): boolean
}

/**
 * 物化 Task 的下一个 id（WP-3.4 `computeNewPlan` 同款先例 — 目标 plan 内
 * 该 kind 最大序号 + 1; Task 定义在声明式层, 其 id 面是 plan-local 的,
 * 不经 §1.1 meta 计数器 — 与既有声明式 T 序号零碰撞）。
 */
export function nextTaskSequence(planItems: readonly string[]): number {
  let max = 0
  for (const id of planItems) {
    if (!ID_PATTERNS.task.test(id)) continue
    const n = Number(id.slice(2))
    if (n > max) max = n
  }
  return max + 1
}

/**
 * 下一个**可用** Task id（nextTaskSequence 起, 跳过已存在定义文件的 id —
 * 上一次失败物化留下的未列入孤儿定义: §1.1 规则 3 禁覆盖, 孤儿按
 * INV-PLAN-9 保留不删 ⇒ 本物化取下一个空位, 孤儿留在盘上合法）。
 */
export function allocateTaskId(
  planItems: readonly string[],
  definitionExists: (taskId: string) => boolean,
): string {
  let seq = nextTaskSequence(planItems)
  let taskId = `T-${seq}`
  while (definitionExists(taskId)) {
    seq += 1
    taskId = `T-${seq}`
  }
  return taskId
}

export interface ActionsServiceOptions {
  readonly store: ActionsStore
  /** The declarative source reader（§16.3 存在性 + PROMOTE 物化面）。 */
  readonly reader: ResearchFileReader
  /** The atomic writer（PROMOTE plan 补偿 + Objective 文件面 — 同一 tmp+rename 面; 域 `PlanFileWriter` 面）。 */
  readonly writer: PlanFileWriter
  /** The `.research/` root (absolute). */
  readonly researchRoot: string
  /** The frozen `schema/declarative` directory。 */
  readonly schemaDir: string
  readonly allocator: IdAllocator
  readonly projectId: string
  readonly db: ActionsDb
  /** RUN 引用存在性（run 表查询面 — wiring 注入; 测试可假）。 */
  readonly runExists: RunExistence
  readonly now?: () => number
}

export class ActionsService {
  private readonly store: ActionsStore
  private readonly reader: ResearchFileReader
  private readonly writer: PlanFileWriter
  private readonly researchRoot: string
  private readonly schemaDir: string
  private readonly allocator: IdAllocator
  private readonly projectId: string
  private readonly db: ActionsDb
  private readonly runExists: RunExistence
  private readonly now: () => number

  /** Objective 声明式面（任务书目标 1 — 同一模块的第三对象）。 */
  readonly objectives: ObjectiveFileService

  constructor(options: ActionsServiceOptions) {
    this.store = options.store
    this.reader = options.reader
    this.writer = options.writer
    this.researchRoot = options.researchRoot
    this.schemaDir = options.schemaDir
    this.allocator = options.allocator
    this.projectId = options.projectId
    this.db = options.db
    this.runExists = options.runExists
    this.now = options.now ?? Date.now
    this.objectives = new ObjectiveFileService({
      reader: this.reader,
      writer: this.writer,
      researchRoot: this.researchRoot,
      schemaDir: this.schemaDir,
      allocator: this.allocator,
      projectId: this.projectId,
      db: this.db,
      now: this.now,
    })
  }

  /* ---------------------------------------------------------------- *
   * NextAction 创建（§6 行「NextAction 创建 ✅/✅」）
   * ---------------------------------------------------------------- */

  /**
   * Create one PROPOSED NextAction（USER 或 AGENT — AGENT 泳道经
   * `research_next_action_create` 工具面; `workstreamId` 存在性在此
   * 按 §16.3 第 2 条写时校验）。
   */
  createNextAction(params: CreateNextActionParams, actor: ActorRef): NextActionRecord {
    assertNextActionCreator(actor, 'createNextAction')
    if (params.workstreamId !== undefined) {
      this.assertWorkstreamExists(params.workstreamId, 'createNextAction', 'ACT_INPUT')
    }
    return this.store.createNextAction(params, actor)
  }

  /* ---------------------------------------------------------------- *
   * NextAction PROMOTE / DISMISS（§6 行「PROMOTE/DISMISS ✅/❌/❌/❌」）
   * ---------------------------------------------------------------- */

  /**
   * PROMOTE — 转正为 Task（用户 only; 物化流见模块头）。
   */
  promoteNextAction(id: string, params: PromoteNextActionParams = {}, actor: ActorRef): PromoteNextActionResult {
    assertUserActor(actor, `promoteNextAction(${id})`)
    if (typeof id !== 'string' || id.length === 0) {
      throw new ActionsError('ACT_INPUT', 'promoteNextAction: next action id must be a non-empty string')
    }
    if (params.index !== undefined && (!Number.isSafeInteger(params.index) || params.index < 0)) {
      throw new ActionsError('PROMOTE_INPUT', `promoteNextAction(${id}): index must be a non-negative safe integer (got ${String(params.index)})`)
    }

    const na = this.store.getNextAction(id)
    if (na === null) {
      throw new ActionsError('NA_NOT_FOUND', `next action ${JSON.stringify(id)} does not exist`)
    }
    checkNextActionTransition(id, na.status, 'PROMOTED')

    // 1) 目标 WS 判定（Task 必须属 WS — task.schema.json 必填）。
    const wsId = params.workstreamId ?? na.workstream_id
    if (wsId === undefined) {
      throw new ActionsError(
        'PROMOTE_INPUT',
        `promoteNextAction(${id}): a Task must belong to a workstream (task.schema.json required workstream_id) — this NextAction carries no workstream_id, so the PROMOTE call must name one (GUI 选择面)`,
      )
    }
    if (na.workstream_id !== undefined && na.workstream_id !== wsId) {
      throw new ActionsError(
        'PROMOTE_INPUT',
        `promoteNextAction(${id}): the NextAction is tied to ${na.workstream_id} but the call targets ${wsId} — a promote never re-hangs the action onto another workstream (explicit mismatch, fail loud)`,
      )
    }

    // 树 + WS 节点（§16.3 存在性; 坏树拒写）。
    const tree = this.loadTreeOrThrow(`promoteNextAction(${id})`, 'PROMOTE_PLAN')
    const wsNode = this.findWorkstream(tree, wsId, `promoteNextAction(${id})`, 'PROMOTE_INPUT')

    // 2) 计划前置（补偿面恒有旧字节可恢复 — writer 无 unlink 面）。
    const planStore = this.planStore(wsNode)
    const plan = planStore.loadPlan()
    if (plan.errors.length > 0) {
      const e = plan.errors[0]!
      throw new ActionsError('PROMOTE_PLAN', `promoteNextAction(${id}): the canonical plan of ${wsId} is inconsistent — refusing to build on it: [${e.code}] ${e.file}${e.path !== undefined ? ` ${e.path}` : ''}: ${e.message}`)
    }
    if (!plan.present) {
      throw new ActionsError(
        'PROMOTE_PLAN',
        `promoteNextAction(${id}): ${wsId} has no canonical plan.yaml — materialization inserts into an EXISTING plan; create/seed the plan first`,
      )
    }
    const oldPlanBytes = this.reader.readFile(pjoin(this.researchRoot, planStore.planPath()))
    if (oldPlanBytes === null) {
      // plan.present=true 而字节读不到 — reader 面矛盾, fail loud。
      throw new ActionsError('PROMOTE_PLAN', `promoteNextAction(${id}): the plan file of ${wsId} is present per loadPlan but unreadable — internal reader inconsistency`)
    }
    const index = params.index ?? plan.items.length
    if (index > plan.items.length) {
      throw new ActionsError('PROMOTE_INPUT', `promoteNextAction(${id}): index ${index} is beyond the plan length ${plan.items.length} (0..${plan.items.length})`)
    }

    // 3) 物化 Task 定义文件（§4.1; 冻结 schema 前置校验 + 原子写）+
    //    4) 重写 plan.yaml（§4.4 三校验 + 原子写; 旧字节已留存）。
    //    文件阶段失败 ⇒ plan.yaml 未被成功改写 ⇒ 无需补偿; 已写的定义
    //    文件同属 INV-PLAN-9 未列入定义合法态（零删除纪律）。
    //    Task id = 目标 plan 的下一 T 序号（nextTaskSequence — WP-3.4
    //    物化先例; 不经 meta 计数器, 与既有声明式 T 序号零碰撞）。
    const now = this.now()
    const taskId = allocateTaskId(plan.items, (tid) =>
      this.reader.readFile(pjoin(this.researchRoot, planStore.itemPath('task', tid))) !== null,
    )
    let newOrder: string[]
    try {
      const taskDoc = this.buildTaskDoc(taskId, wsId, na, actor, now)
      planStore.createItem('task', taskDoc)
      newOrder = [...plan.items.slice(0, index), taskId, ...plan.items.slice(index)]
      planStore.savePlan(newOrder)
    } catch (cause) {
      if (cause instanceof ActionsError) throw cause
      const msg = cause instanceof Error ? cause.message : String(cause)
      throw new ActionsError('PROMOTE_PLAN', `promoteNextAction(${id}): the file stage failed (${msg}) — plan.yaml was not successfully rewritten; the new task definition file, if written, remains unlisted (INV-PLAN-9 合法部分态); the NextAction stays PROPOSED and is retryable`, { cause })
    }

    // 5) DB 事务（NA 行乐观迁移 + PLAN_ITEM_ADDED 账本 — 单一事务）。
    const maRes = this.allocator.reserve('MANAGEMENT_ACTION', this.projectId)
    try {
      this.db.transaction(() => {
        const changes = this.db.run(SQL_TRANSITION_NEXT_ACTION, 'PROMOTED', taskId, id)
        if (changes === 0) {
          const reread = this.store.getNextAction(id)
          if (reread === null) {
            throw new ActionsError('NA_NOT_FOUND', `next action ${JSON.stringify(id)} vanished during transition (no-delete trigger in effect — investigate)`)
          }
          throw new ActionsError('PROMOTE_CONCURRENT', `next action ${JSON.stringify(id)} moved concurrently (expected PROPOSED, now ${reread.status}) — refetch and retry`)
        }
        const ma: ManagementActionRecord = {
          id: maRes.id,
          action_kind: 'PLAN_ITEM_ADDED',
          actor,
          subject_refs: [
            { kind: 'TASK', id: taskId },
            { kind: 'WORKSTREAM', id: wsId },
          ],
          detail: `next action ${id} promoted to task ${taskId} in ${wsId} plan (index ${index}; new plan length ${newOrder.length})`,
          occurred_at: now,
        }
        this.db.run(SQL_INSERT_MANAGEMENT_ACTION, ...managementActionToParams(ma))
      })
    } catch (cause) {
      // 释放 MA reservation（补偿不改变「行未迁移」的事实 — 重试可再次
      // 分配）; 释放先于补偿, 补偿自身失败也不漏 reservation。
      this.allocator.release(maRes)
      // 6) 补偿（文件半边已落 — plan.yaml 恢复旧字节; 定义文件保留,
      //    INV-PLAN-9 未列入定义合法态）。
      this.compensatePlan(planStore, oldPlanBytes, `promoteNextAction(${id})`, true)
      if (cause instanceof ActionsError && (cause.code === 'PROMOTE_CONCURRENT' || cause.code === 'NA_NOT_FOUND')) {
        throw cause
      }
      const msg = cause instanceof Error ? cause.message : String(cause)
      throw new ActionsError('PROMOTE_DB_FAILED', `promoteNextAction(${id}): the DB transaction failed (${msg}) — plan.yaml was restored to its previous bytes; the new task definition file remains unlisted (INV-PLAN-9); the NextAction stays PROPOSED and is retryable`, { cause })
    }
    this.allocator.commit(maRes)

    return {
      nextActionId: id,
      taskId,
      workstreamId: wsId,
      planPath: planStore.planPath(),
      newOrder,
      managementActionId: maRes.id,
    }
  }

  /**
   * DISMISS（§13 终态; 用户 only）。无物化面 — 纯行状态迁移。
   */
  dismissNextAction(id: string, actor: ActorRef): NextActionRecord {
    assertUserActor(actor, `dismissNextAction(${id})`)
    return this.store.dismissNextAction(id, actor)
  }

  /* ---------------------------------------------------------------- *
   * Blocker（USER only — INV-PERM-1 闭集外; §6 无 Blocker 行）
   * ---------------------------------------------------------------- */

  /**
   * Create one ACTIVE Blocker（§9.4; `affects` 引用存在性按 §16.3 写时
   * 校验: WS/T 经声明式树, RUN 经 run 表面 — 「写入新引用时失败 = 拒绝」）。
   */
  createBlocker(params: CreateBlockerParams, actor: ActorRef): BlockerRecord {
    assertUserActor(actor, 'createBlocker', 'BLK_ACTOR')
    this.assertAffectsExist(params.affects, 'createBlocker')
    return this.store.createBlocker(params, actor)
  }

  /**
   * CLEAR（§13 终态; 用户 only; 复发 = 新 Blocker 行）。
   */
  clearBlocker(id: string, actor: ActorRef): BlockerRecord {
    assertUserActor(actor, `clearBlocker(${id})`, 'BLK_ACTOR')
    return this.store.clearBlocker(id, actor)
  }

  /* ---------------------------------------------------------------- *
   * 查询面透传（视图/RPC 数据缝 — 冻结 13 RPC 无注意力面, 见报告）
   * ---------------------------------------------------------------- */

  listNextActions(filter: NextActionListFilter = {}): NextActionRecord[] {
    return this.store.listNextActions(filter)
  }

  listBlockers(filter: BlockerListFilter = {}): BlockerRecord[] {
    return this.store.listBlockers(filter)
  }

  listObjectives(): ObjectiveDoc[] {
    return this.objectives.loadObjectives().objectives
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  private planStore(wsNode: WorkstreamNode): PlanStore {
    return new PlanStore({
      reader: this.reader,
      writer: this.writer,
      researchRoot: this.researchRoot,
      schemaDir: this.schemaDir,
      topicId: wsNode.topicId,
      wsId: wsNode.id,
    })
  }

  /**
   * 补偿: 恢复旧 plan.yaml 精确字节（原子回写）。定义文件保留（INV-PLAN-9
   * 未列入定义合法态 — 本服务零删除）。补偿失败 ⇒ PROMOTE_COMPENSATION_FAILED
   * （人工介入, 同 WP-3.4 §6.6 口径）— 原错误丢失, 补偿失败是更严重的状态。
   */
  private compensatePlan(planStore: PlanStore, oldPlanBytes: string, context: string, planDirty: boolean): void {
    if (!planDirty) return // plan.yaml 未被触及 — 无补偿对象。
    const absPlan = pjoin(this.researchRoot, planStore.planPath())
    try {
      this.writer.writeAtomic(absPlan, oldPlanBytes)
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause)
      throw new ActionsError(
        'PROMOTE_COMPENSATION_FAILED',
        `COMPENSATION FAILED: ${context} — the plan.yaml could not be restored to its previous bytes (${msg}); the plan file may hold the NEW materialized order while the NextAction is still PROPOSED. Manual intervention required (git restore — INV-GIT-8)`,
        { cause },
      )
    }
  }

  /** PROMOTE 物化的 TaskDoc（§4.1 字段面; acceptance_criteria=[] — INV-TASK-3）。 */
  private buildTaskDoc(taskId: string, wsId: string, na: NextActionRecord, actor: ActorRef, at: number): TaskDoc {
    const title = na.statement.length > 200 ? `${na.statement.slice(0, 197)}…` : na.statement
    const goal = na.rationale !== undefined ? `${na.statement}\n\n（NextAction 提案理由）${na.rationale}` : na.statement
    return {
      id: taskId,
      workstream_id: wsId,
      title,
      goal,
      deliverables: [] as string[],
      acceptance_criteria: [] as string[],
      created_by: { ...actor },
      created_at: at,
    }
  }

  private loadTreeOrThrow(operation: string, code: 'PROMOTE_PLAN' | 'ACT_INPUT' | 'PROMOTE_INPUT'): ResearchTree {
    const load = loadResearchTree(this.reader, this.researchRoot, this.schemaDir)
    if (load.errors.length > 0) {
      const e = load.errors[0]!
      throw new ActionsError(
        code,
        `${operation}: the declarative tree failed to load — refusing to operate on a broken tree: [${e.code}] ${e.file || '<root>'}${e.path !== undefined ? ` ${e.path}` : ''}: ${e.message}`,
      )
    }
    return load.tree
  }

  private findWorkstream(tree: ResearchTree, wsId: string, operation: string, code: 'PROMOTE_INPUT' | 'ACT_INPUT'): WorkstreamNode {
    for (const topic of tree.topics) {
      const ws = topic.workstreams.find((w) => w.id === wsId)
      if (ws !== undefined) return ws
    }
    throw new ActionsError(code, `${operation}: workstream ${JSON.stringify(wsId)} does not exist (DOMAIN_SCHEMA §16.3 — 写入时引用校验 = 拒绝)`)
  }

  /** §16.3 第 2 条: operational → 声明式, 写入时校验（WS 存在）。 */
  private assertWorkstreamExists(wsId: string, operation: string, code: 'PROMOTE_INPUT' | 'ACT_INPUT'): void {
    const tree = this.loadTreeOrThrow(operation, code)
    this.findWorkstream(tree, wsId, operation, code)
  }

  /** §16.3 写时校验: affects 引用逐一存在（WS/T 树; RUN 表面）。 */
  private assertAffectsExist(affects: readonly AffectsRef[], operation: string): void {
    const tree = this.loadTreeOrThrow(operation, 'ACT_INPUT')
    const wsIds = new Set<string>()
    const taskIds = new Set<string>()
    for (const topic of tree.topics) {
      for (const ws of topic.workstreams) {
        wsIds.add(ws.id)
        for (const t of ws.tasks) taskIds.add(t.id)
      }
    }
    for (const ref of affects) {
      if (ref.kind === 'WORKSTREAM') {
        if (!wsIds.has(ref.id)) {
          throw new ActionsError('BLK_REF_MISSING', `${operation}: affects reference {kind: WORKSTREAM, id: ${JSON.stringify(ref.id)}} does not exist (DOMAIN_SCHEMA §16.3 — 写入新引用时失败 = 拒绝)`)
        }
      } else if (ref.kind === 'TASK') {
        if (!taskIds.has(ref.id)) {
          throw new ActionsError('BLK_REF_MISSING', `${operation}: affects reference {kind: TASK, id: ${JSON.stringify(ref.id)}} does not exist (DOMAIN_SCHEMA §16.3)`)
        }
      } else {
        if (!this.runExists.exists(ref.id)) {
          throw new ActionsError('BLK_REF_MISSING', `${operation}: affects reference {kind: RUN, id: ${JSON.stringify(ref.id)}} does not exist in the run table (DOMAIN_SCHEMA §16.3 第 3 条)`)
        }
      }
    }
  }
}
