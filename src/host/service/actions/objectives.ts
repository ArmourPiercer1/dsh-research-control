/**
 * WP-5.2 — Objective 声明式变更服务面（`.research/objectives.yaml` 原子写）。
 *
 * 冻结契约依据:
 *  - DOMAIN_SCHEMA §9.1: Objective 是**声明式**对象（`.research/objectives.yaml`，
 *    计划书 §17.3）— 真源是文件 + Git; loader（WP-1.1）已能加载
 *    （`tree.objectives: ObjectiveDoc[]`，schema 校验 + §16.1 交叉引用全量
 *    校验 + 默认值物化）;
 *  - §13 状态机: `Objective | ACTIVE → ACHIEVED | DROPPED（仅用户）`;
 *  - §12.1 ManagementAction: `action_kind` 冻结枚举含 **`OBJECTIVE_EDITED`**
 *    （三对象中唯一有对应 kind 的 — 无 NA_* 与 BLK_* kind, 冻结不可扩）⇒
 *    每次文件改写 append 一行 `OBJECTIVE_EDITED` 账本（provenance: 谁在
 *    何时把 objectives.yaml 改成了什么形态 — 不存 before/after 快照,
 *    §12.1 原文; 声明式状态的历史回放以 Git 为准）;
 *  - ARCHITECTURE §10 失效面: 「插件崩溃 ⇒ 原子文件写（临时文件+rename）
 *    保证 `.research/` 不留半写状态」（INV-DB-3）; §6 矩阵首行
 *    「创建/编辑 … manifest ✅/❌/❌/❌」⇒ 编辑面 USER-only;
 *  - HISTORY_EVENT_CATALOG §4: **无** Objective 事件 ⇒ 不构造 History 事件
 *    （同 WP-3.1 核查口径）; ResearchHistory 也不记录管理操作（§12.1 原文:
 *    「ResearchHistory 不记录 plan reorder、contract edit 等管理操作」）—
 *    账本行是唯一落库痕迹。
 *
 * 写协议（同 WP-3.4 SELECT 物化/补偿纪律, 文件半边先行）:
 *   1. 前置: 现状 `loadResearchTree`（真 reader — 文件是当下真值, 无缓存）;
 *      树错误 ⇒ 拒绝（不给一棵坏树叠写 — 同 RPC 面 `#loadTree` 口径）;
 *   2. **虚拟 reader 预校验**: 包装 reader（objectives.yaml 路径回注新内容,
 *      其余字节原样）跑同一个 `loadResearchTree` — 新文档与**其余文件**的
 *      §16.1 交叉引用在项目内闭环才许落盘（失败 = 精确 file+path 错误,
 *      零字节落地）;
 *   3. 原子写（tmp+rename — `PlanFileWriter` 面, 同 WP-1.3 内核;
 *      写前留存旧文件精确字节, 补偿用）;
 *   4. 后置校验: 再跑 `loadResearchTree`（真 reader）— 与第 1 步基线比对,
 *      **新增**的 objectives.yaml 错误 ⇒ 回写旧字节（补偿）+ 大声错误
 *      （第 2 步已预校验, 此处只兜「写后并发他文件变更」的理论窗口 +
 *       writer 故障注入 — 测试实证）;
 *   5. `OBJECTIVE_EDITED` 账本行（reserve/commit/release 协议同 WP-3.1;
 *      账本失败 ⇒ 文件已在盘 — 大声错误 + 手动对账, 同 reorderPlan 先例;
 *      绝不回滚文件 — Git 是声明式真源的版本面, 用户可显式 restore）。
 *
 * 序列化: 确定性 YAML（§9.1 字段表顺序; epoch ms → ISO 8601 UTC 走
 * WP-1.3 `epochToIso` 单一来源; `YAML_OPTIONS` 固定 `lineWidth: 0` —
 * 同数据 ⇒ 同字节, TC-DOM-005 同款保证）。
 */

import { stringify } from 'yaml'

import {
  epochToIso,
  YAML_OPTIONS,
} from '../../domain/plan/serialize.js'
import {
  loadResearchTree,
  pjoin,
  type DirEntry,
  type ObjectiveDoc,
  type ResearchFileReader,
} from '../../domain/loader/index.js'
import {
  managementActionToParams,
  SQL_INSERT_MANAGEMENT_ACTION,
  type ActorRef,
  type ManagementActionRecord,
} from '../../domain/planfork/index.js'
import type { IdAllocator } from '../../../shared/ids/index.js'
import { checkObjectiveTransition, assertUserActor } from './state-machine.js'
import { ActionsError, ID_PATTERNS, type ActionsDb, type ObjStatus } from './types.js'

/** §9.1 字段表顺序（L401-412）— 序列化单一来源（同 WP-1.3 TASK_FIELDS 先例）。 */
const OBJECTIVE_FIELDS = [
  'id',
  'scope',
  'topic_id',
  'statement',
  'success_criteria',
  'status',
  'target_date',
  'priority',
  'linked_refs',
  'created_at',
] as const

/**
 * 把一个 Objective doc 排成冻结字段表顺序的 YAML carrier（跳过 absent
 * 可选字段; `created_at`/`target_date` 跨 §1.2 序列化边界 → ISO 8601 UTC）。
 */
function toObjectiveCarrier(doc: ObjectiveDoc): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of OBJECTIVE_FIELDS) {
    const value = (doc as unknown as Record<string, unknown>)[field]
    if (value === undefined) continue
    if (field === 'created_at' || field === 'target_date') {
      out[field] = epochToIso(value as number)
    } else if (field === 'linked_refs') {
      out[field] = (value as { kind: string; id: string }[]).map((ref) => ({ kind: ref.kind, id: ref.id }))
    } else if (field === 'success_criteria') {
      out[field] = [...(value as string[])]
    } else {
      out[field] = value
    }
  }
  return out
}

/**
 * 确定性序列化 `.research/objectives.yaml`（顶层 `objectives:` 包装 —
 * objectives.schema.json 冻结形状; 同数据 ⇒ 同字节）。
 */
export function serializeObjectives(objectives: readonly ObjectiveDoc[]): string {
  const wrapper: Record<string, unknown> = {
    objectives: objectives.map((doc) => toObjectiveCarrier(doc)),
  }
  return stringify(wrapper, YAML_OPTIONS)
}

/* ------------------------------------------------------------------ *
 * Service
 * ------------------------------------------------------------------ */

/** The injected writer face（域 `PlanFileWriter` 结构面 — 零 I/O 依赖）。 */
export interface ObjectiveFileWriter {
  writeAtomic(absPath: string, content: string): void
}

export interface ObjectiveFileServiceOptions {
  /** The declarative source reader（fs 实现在 wiring; 测试可注入内存面）。 */
  readonly reader: ResearchFileReader
  /** The atomic writer（tmp+rename — INV-DB-3 崩溃安全半边）。 */
  readonly writer: ObjectiveFileWriter
  /** The `.research/` root (absolute). */
  readonly researchRoot: string
  /** The frozen `schema/declarative` directory（loader 校验面）。 */
  readonly schemaDir: string
  /** The shared project-scoped id allocator（MANAGEMENT_ACTION family）。 */
  readonly allocator: IdAllocator
  /** The `PRJ-<n>` the MA counter is scoped to. */
  readonly projectId: string
  /** The operational-DB face（OBJECTIVE_EDITED 账本 INSERT）。 */
  readonly db: ActionsDb
  /** Clock (A-3 epoch ms; tests inject). */
  readonly now?: () => number
}

export interface ObjectiveSaveResult {
  /** The objectives as saved（= 入参, 规范化拷贝）。 */
  readonly objectives: ObjectiveDoc[]
  /** The provenance ledger row id（§12.1 `OBJECTIVE_EDITED`）。 */
  readonly managementActionId: string
  /** `true` when the file was newly created by this call. */
  readonly fileCreated: boolean
}

export class ObjectiveFileService {
  private readonly reader: ResearchFileReader
  private readonly writer: ObjectiveFileWriter
  private readonly researchRoot: string
  private readonly schemaDir: string
  private readonly allocator: IdAllocator
  private readonly projectId: string
  private readonly db: ActionsDb
  private readonly now: () => number

  constructor(options: ObjectiveFileServiceOptions) {
    this.reader = options.reader
    this.writer = options.writer
    this.researchRoot = options.researchRoot
    this.schemaDir = options.schemaDir
    this.allocator = options.allocator
    this.projectId = options.projectId
    this.db = options.db
    this.now = options.now ?? Date.now
  }

  /** The objectives.yaml path (absolute, reader/writer 面). */
  private objectivesPath(): string {
    return pjoin(this.researchRoot, 'objectives.yaml')
  }

  /**
   * 读取面（声明式真源 — 新鲜加载, 无缓存; 同 RPC 面 `#loadTree` 口径）.
   * 树错误 ⇒ 拒绝服务（错误聚合逐条报出 — 不给坏树投影）。
   */
  loadObjectives(): { present: boolean; objectives: ObjectiveDoc[] } {
    const load = this.loadTreeOrThrow('loadObjectives')
    const present = this.reader.readFile(this.objectivesPath()) !== null
    return { present, objectives: load.tree.objectives.map((o) => ({ ...o })) }
  }

  /**
   * 整文件保存面（用户经 GUI 编辑 objectives.yaml — 任务书目标 1）。
   * `objectives` = 完整的新文档列表（含未变项 — 文件级原子替换, 无行级
   * diff 语义; §13 状态迁移的便捷面走 `setObjectiveStatus`）。
   * 协议见模块头（虚拟 reader 预校验 → 原子写 → 后置校验/补偿 → 账本）。
   */
  saveObjectives(objectives: readonly ObjectiveDoc[], actor: ActorRef): ObjectiveSaveResult {
    assertUserActor(actor, 'saveObjectives', 'OBJ_ACTOR')
    this.assertObjectiveDocs(objectives)

    // 1) 现状基线（真 reader）— 坏树拒写 + 账本 diff 的 before 面。
    const baseline = this.loadTreeOrThrow('saveObjectives')
    const previousBytes = this.reader.readFile(this.objectivesPath())
    const beforeStatus = new Map(baseline.tree.objectives.map((o) => [o.id, o.status] as const))

    // 2) 虚拟 reader 预校验（新内容 × 其余文件, 项目内 §16.1 闭环）。
    const content = serializeObjectives(objectives)
    const pre = this.loadTree(this.virtualReader(content))
    const preObjectiveErrors = pre.errors.filter((e) => e.file === 'objectives.yaml')
    if (preObjectiveErrors.length > 0) {
      const e = preObjectiveErrors[0]!
      throw new ActionsError(
        'OBJ_FILE',
        `saveObjectives: the new objectives.yaml fails validation — refusing the write: [${e.code}]${e.path !== undefined ? ` ${e.path}` : ''}: ${e.message}` +
          (preObjectiveErrors.length > 1 ? ` (+${preObjectiveErrors.length - 1} more)` : ''),
      )
    }

    // 3) 原子写（tmp+rename; 旧字节已在手 — 补偿面）。
    let writeFailed: unknown = null
    try {
      this.writer.writeAtomic(this.objectivesPath(), content)
    } catch (cause) {
      writeFailed = cause
    }
    if (writeFailed !== null) {
      const msg = writeFailed instanceof Error ? writeFailed.message : String(writeFailed)
      throw new ActionsError('OBJ_FILE', `saveObjectives: atomic write failed: ${msg}`, { cause: writeFailed })
    }

    // 4) 后置校验（真 reader 再载; 与基线比对 — 只认**新增**的
    //    objectives.yaml 错误; 他文件的既有错误不阻塞 — 基线已含）。
    const post = this.loadTree(this.reader)
    const postObjectiveErrors = post.errors.filter((e) => e.file === 'objectives.yaml')
    if (postObjectiveErrors.length > 0) {
      const msg = postObjectiveErrors.map((e) => `[${e.code}] ${e.path ?? '/'}: ${e.message}`).join(' | ')
      let compensateFailed: unknown = null
      if (previousBytes !== null) {
        try {
          this.writer.writeAtomic(this.objectivesPath(), previousBytes)
        } catch (cause) {
          compensateFailed = cause
        }
      }
      if (compensateFailed !== null || previousBytes === null) {
        const cmsg = compensateFailed instanceof Error ? compensateFailed.message : String(compensateFailed)
        throw new ActionsError(
          'OBJ_FILE',
          `saveObjectives: the written objectives.yaml failed post-validation (${msg}) AND ${
            previousBytes === null ? 'no previous file bytes exist to restore (the file was newly created)' : `restoring the previous bytes also failed: ${cmsg}`
          } — manual reconciliation required (git restore ${pjoin(this.researchRoot, 'objectives.yaml')})`,
          { cause: compensateFailed ?? undefined },
        )
      }
      throw new ActionsError(
        'OBJ_FILE',
        `saveObjectives: the written objectives.yaml failed post-validation (${msg}) — the previous file content was restored atomically (concurrent tree change outside this service; re-read and retry)`,
      )
    }

    // 5) OBJECTIVE_EDITED 账本（§12.1; 失败 ⇒ 文件已在盘 — 手动对账,
    //    同 reorderPlan 先例 — 不回滚声明式真源, Git 是版本面）。
    const maRes = this.allocator.reserve('MANAGEMENT_ACTION', this.projectId)
    const ma = this.buildObjectiveEditedAction(maRes.id, actor, objectives, beforeStatus, previousBytes === null, this.now())
    try {
      this.db.run(SQL_INSERT_MANAGEMENT_ACTION, ...managementActionToParams(ma))
    } catch (cause) {
      this.allocator.release(maRes)
      const msg = cause instanceof Error ? cause.message : String(cause)
      throw new ActionsError(
        'OBJ_STORE',
        `saveObjectives: the objectives.yaml was rewritten but the OBJECTIVE_EDITED ledger row failed — the file is on disk, the provenance row is missing (manual reconciliation): ${msg}`,
        { cause },
      )
    }
    this.allocator.commit(maRes)
    return {
      objectives: objectives.map((o) => ({ ...o })),
      managementActionId: maRes.id,
      fileCreated: previousBytes === null,
    }
  }

  /**
   * §13 状态迁移便捷面（`ACTIVE → ACHIEVED | DROPPED`, 仅用户）:
   * 读现状 → 守卫 → 单字段改写 → `saveObjectives`（同一写协议 + 账本）。
   */
  setObjectiveStatus(objectiveId: string, status: ObjStatus, actor: ActorRef): ObjectiveSaveResult {
    assertUserActor(actor, `setObjectiveStatus(${objectiveId})`, 'OBJ_ACTOR')
    if (typeof objectiveId !== 'string' || !ID_PATTERNS.objective.test(objectiveId)) {
      throw new ActionsError('ACT_INPUT', `setObjectiveStatus: objective id ${JSON.stringify(objectiveId)} is not a well-formed OBJ id (common.schema.json idObjective)`)
    }
    const current = this.loadObjectives().objectives
    const target = current.find((o) => o.id === objectiveId)
    if (target === undefined) {
      throw new ActionsError('OBJ_NOT_FOUND', `objective ${JSON.stringify(objectiveId)} does not exist in objectives.yaml`)
    }
    checkObjectiveTransition(objectiveId, target.status, status)
    const next = current.map((o) => (o.id === objectiveId ? { ...o, status } : o))
    return this.saveObjectives(next, actor)
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  /** 全树加载（错误聚合原样返回 — 调用方决定拒绝口径）。 */
  private loadTree(reader: ResearchFileReader) {
    return loadResearchTree(reader, this.researchRoot, this.schemaDir)
  }

  /** 树错误 ⇒ 拒绝（精确错误聚合 — 同 RPC 面 `#loadTree`）。 */
  private loadTreeOrThrow(operation: string) {
    const load = this.loadTree(this.reader)
    if (load.errors.length > 0) {
      const e = load.errors[0]!
      throw new ActionsError(
        'OBJ_FILE',
        `${operation}: the declarative tree failed to load — refusing to write on a broken tree: [${e.code}] ${e.file || '<root>'}${e.path !== undefined ? ` ${e.path}` : ''}: ${e.message}` +
          (load.errors.length > 1 ? ` (+${load.errors.length - 1} more)` : ''),
      )
    }
    return load
  }

  /** 虚拟 reader: 仅 objectives.yaml 路径回注新内容, 其余字节原样委托。 */
  private virtualReader(objectivesContent: string): ResearchFileReader {
    const self = this
    const target = this.objectivesPath()
    return {
      readDir(path: string): DirEntry[] | null {
        return self.reader.readDir(path)
      },
      readFile(path: string): string | null {
        if (path === target) return objectivesContent
        return self.reader.readFile(path)
      },
    }
  }

  /** 入参文档形状钉死（id 形状/必填字段 — 落盘前的类型面兜底）。 */
  private assertObjectiveDocs(objectives: readonly ObjectiveDoc[]): void {
    if (!Array.isArray(objectives)) {
      throw new ActionsError('ACT_INPUT', 'saveObjectives: objectives must be an array (objectives.schema.json top-level `objectives` list)')
    }
    const seen = new Set<string>()
    objectives.forEach((doc, i) => {
      if (doc === null || typeof doc !== 'object') {
        throw new ActionsError('ACT_INPUT', `saveObjectives: objectives[${i}] must be an object`)
      }
      if (typeof doc.id !== 'string' || !ID_PATTERNS.objective.test(doc.id)) {
        throw new ActionsError('ACT_INPUT', `saveObjectives: objectives[${i}].id ${JSON.stringify(doc.id)} is not a well-formed OBJ id`)
      }
      if (seen.has(doc.id)) {
        throw new ActionsError('ACT_INPUT', `saveObjectives: duplicate objective id ${JSON.stringify(doc.id)} (DOMAIN_SCHEMA §1.1 — 预校验; loader 亦拒)`)
      }
      seen.add(doc.id)
      if (doc.scope !== 'PROJECT' && doc.scope !== 'TOPIC') {
        throw new ActionsError('ACT_INPUT', `saveObjectives: objectives[${i}].scope ${JSON.stringify(doc.scope)} not allowed (PROJECT|TOPIC)`)
      }
      if (doc.scope === 'TOPIC' && (typeof doc.topic_id !== 'string' || doc.topic_id.length === 0)) {
        throw new ActionsError('ACT_INPUT', `saveObjectives: objectives[${i}] (scope=TOPIC) requires topic_id (objectives.schema.json if/then)`)
      }
      if (typeof doc.statement !== 'string' || doc.statement.length === 0) {
        throw new ActionsError('ACT_INPUT', `saveObjectives: objectives[${i}].statement must be a non-empty string`)
      }
      if (!Array.isArray(doc.success_criteria) || doc.success_criteria.length === 0) {
        throw new ActionsError('ACT_INPUT', `saveObjectives: objectives[${i}].success_criteria must be a non-empty string[] (objectives.schema.json minItems:1)`)
      }
      if (typeof doc.created_at !== 'number' || !Number.isSafeInteger(doc.created_at) || doc.created_at < 0) {
        throw new ActionsError('ACT_INPUT', `saveObjectives: objectives[${i}].created_at must be a non-negative epoch ms (DOMAIN_SCHEMA §1.2)`)
      }
    })
  }

  /** §12.1 `OBJECTIVE_EDITED` 账本行（不存 before/after 快照 — 原文）。 */
  private buildObjectiveEditedAction(
    maId: string,
    actor: ActorRef,
    objectives: readonly ObjectiveDoc[],
    beforeStatus: ReadonlyMap<string, string>,
    fileCreated: boolean,
    at: number,
  ): ManagementActionRecord {
    const changes: string[] = []
    for (const o of objectives) {
      const before = beforeStatus.get(o.id)
      if (before === undefined) {
        changes.push(`${o.id} added`)
      } else if (before !== o.status) {
        changes.push(`${o.id}: ${before} → ${o.status}`)
      }
    }
    const detail =
      `objectives.yaml ${fileCreated ? 'created' : 'updated'} via GUI edit: ${objectives.length} objective(s) ` +
      `[${objectives.map((o) => o.id).join(', ')}]` +
      (changes.length > 0 ? `; status changes: ${changes.join('; ')}` : '')
    return {
      id: maId,
      action_kind: 'OBJECTIVE_EDITED',
      actor,
      subject_refs: objectives.map((o) => ({ kind: 'OBJECTIVE', id: o.id })),
      detail,
      occurred_at: at,
    }
  }
}
