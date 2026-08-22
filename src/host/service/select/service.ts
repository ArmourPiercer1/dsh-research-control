/**
 * WP-3.4 — `PlanForkSelectService`：SELECT 物化 / DISMISS / 连锁 STALE /
 * 崩溃一致性审计（用户面，无 Agent 面 — INV-PERM-2）。
 *
 * ## SELECT（PLAN_FORK_SPEC §6 全步原文，用户 GUI 触发）
 *
 *   前置 `PF.status == OPEN`（STALE/DISMISSED/SELECTED 均拒绝 — 经 WP-3.1
 *   `checkPfTransition` 守卫，错误点名当前态 + 合法集）⇒
 *
 *   1. **复核基准**（§6.1, INV-PLAN-8）：重算当前 closure（WP-3.2
 *      `hashClosure` W3 单一来源；plan 不一致/缺失时走 WP-3.2 宽松闭包
 *      同语义）与 `PF.base_plan_objects` 集合比较（WP-3.2
 *      `compareClosureBases` 单一来源）⇒ 有差异：**自动置 STALE**
 *      （WP-3.1 `transition` 乐观门 + 同事务 PF_STALE_MARKED 账本,
 *      actor=PLUGIN, stale_reason = §5 首个差异三元组）并**拒绝本次
 *      SELECT**，返回差异说明。差异恰为本 PF 的 §6.3 物化形态
 *      （crash-signature.ts (a)(b)(c) 签名）⇒ 专用大声错误
 *      SELECT_CRASH_INCOMPLETE（不静默修复 — 不自动恢复、不自动补迁移）；
 *      否则 SELECT_REFUSED_STALE（附结构化 diff）。
 *   2. **物化新 items**（§6.2）：per-kind 下一序号（formula.ts
 *      `computeNewPlan` 纯核心 — 含 anchor 解析 + KEEP 子检查 + 分配 +
 *      §6.3 拼接），定义文件经 WP-1.3 `PlanStore.createItem` **原子写入**
 *      （冻结 schema 前置校验; `created_by = { kind: AGENT,
 *      run_id: PF.created_by_run }` 内容作者; `created_at` = 物化时刻）;
 *   3. **重写 plan.yaml**（§6.3 修正版公式 — formula.ts）：经 `PlanStore
 *      .savePlan` 原子写（§4.4 三校验前置）。写前留存旧 plan.yaml **精确
 *      字节**（补偿用）。
 *   4. **DB 事务**（§6.4/§6.5/§6.6 单一事务 — 两系统跨界的原子核心）：
 *      ① 目标 PF 乐观条件 UPDATE `status='OPEN' → SELECTED`
 *      （`SQL_TRANSITION_PLAN_FORK.SELECTED` — WP-3.1 导出常量, 0 行 ⇒
 *      重读判别 PF_NOT_FOUND/PF_WRONG_STATE/并发迁移）
 *      ② 同 WS 其余每个 OPEN PF 条件 UPDATE `→ STALE`
 *      （stale_reason = §6.5 原文 `superseded by PF-<id> selection`,
 *      actor=PLUGIN; 0 行 ⇒ 并发迁移竞争 ⇒ 整事务回滚）
 *      ③ 账本 append：PF_SELECTED（actor=USER 执行者, **git_blob_oids =
 *      物化后新 closure 的 (path, oid) 集** — §6.6 原文「含新 plan.yaml
 *      与各定义文件的 blob OID」; detail = 机械摘要）+ 每连锁 STALE 一行
 *      PF_STALE_MARKED。MA id 经共享 IdAllocator（reserve/commit/release
 *      协议同 WP-3.1 store）。
 *      **§6.6 不写 ResearchHistory**：本服务只产 management_action 行
 *      （HISTORY_EVENT_CATALOG 无 PLAN_FORK_* 事件 — WP-3.1 核查口径）。
 *   5. **原子性与补偿**（goal 4）：文件写成功而 DB 事务失败（或物化后
 *      闭包捕获的 git 失败 — 同一「文件半边已落」窗口）⇒ **恢复旧
 *      plan.yaml 精确字节**（writer 原子回写）+ 大声错误
 *      （SELECT_DB_FAILED / SELECT_CONCURRENT_STATE / SELECT_GIT; 新定义
 *      文件保留为未列入定义 — INV-PLAN-9 合法部分态, 烧号留 gap §1.1
 *      规则 2; PF 保持 OPEN 可重试）。补偿自身失败 ⇒
 *      SELECT_COMPENSATION_FAILED（人工介入 — git restore, INV-GIT-8）。
 *      文件阶段失败（定义文件/plan.yaml 写失败）⇒ plan.yaml 未被触及
 *      ⇒ 无需补偿（SELECT_WRITE; 已写定义文件同属合法未列入态）。
 *   6. §6.7 checkpoint 提示（outcome.checkpointHint — 显式、可选、绝不
 *      自动; resulting commit OID 归 CHECKPOINT_SAVED 账本行, 用户显式
 *      保存时记录 — INV-GIT-2）; §6.8 被替换旧 items 定义文件保留
 *      （INV-PLAN-9 — 本服务从不删除任何 .research 文件）。
 *
 * ## DISMISS（§7，用户）
 *
 *   OPEN 或 STALE ⇒ `store.transition(DISMISSED)`（WP-3.1 面：乐观门 +
 *   同事务 PF_DISMISSED 账本）⇒ DISMISSED（终态）。只改状态不删除
 *   （append-only — 存储层 trigger 兜底）。SELECTED/DISMISSED 来源态
 *   拒绝（checkPfTransition 守卫）。
 *
 * ## 崩溃一致性审计（goal 4 重启面）
 *
 *   `auditSelectConsistency(workstreamId?)`：对每个 OPEN PF 重算闭包
 *   （只读 — 零状态变更、零账本）+ 崩溃签名判定（crash-signature.ts）：
 *   OK / BASIS_STALE（信息性）/ UNVERIFIABLE（plan 缺失/不一致, 信息性）/
 *   **CRASH_INCOMPLETE（违规 — 文件半边已落、DB 半边丢失）**。存在违规 ⇒
 *   **大声抛错**（SELECT_CONSISTENCY + 结构化 report — 重启后检测不静默）;
 *   无违规 ⇒ 返回 report（信息性条目随附）。
 *
 * ## 不变量映射（ARCHITECTURE §5.4 — 全表见报告）
 *
 *   - INV-PLAN-2: 纯位置拼接, 零位置语义解释（formula.ts 纪律 + 测试）;
 *   - INV-PLAN-3: 类型面 — select/dismiss 入口 actor 运行时强制 USER
 *     （SELECT_ACTOR_NOT_USER）, 无任何 AGENT 可达物化面; 工具面（WP-3.3）
 *     无 select/dismiss 工具（RESEARCH_TOOL_NAMES 恰为 §7.2 11 项 —
 *     tests/select 双钉）;
 *   - INV-PLAN-4: PF 内容列永不触碰（只经状态机面动状态缓存列; 无 delete
 *     面; trigger 兜底）;
 *   - INV-PLAN-5: 复核 = 当前闭包集合 vs 存库 base 集合（单一来源比较）;
 *     物化从不改写 base_plan_objects;
 *   - INV-PLAN-7: SELECTED 边 + 同 WS 其余 OPEN 一律 STALE（§6.5 原文
 *     reason）+ DISMISS 只改状态;
 *   - INV-PLAN-8: 复核不一致 ⇒ 自动 STALE + 拒绝（§6.1）;
 *   - INV-PLAN-9: 零删除 — 离开计划的定义文件保留（removedIds 只是离开
 *     ordered_items）;
 *   - INV-PERM-2 / INV-GIT-2: 见模块头。
 */

import { join } from 'node:path'

import {
  checkPfTransition,
  closureRelativePaths,
  managementActionToParams,
  PlanForkError,
  rowToPlanFork,
  SQL_INSERT_MANAGEMENT_ACTION,
  SQL_SELECT_PLAN_FORK_BY_ID,
  SQL_TRANSITION_PLAN_FORK,
  type ActorRef,
  type BasePlanObject,
  type CanonicalPlanProvider,
  type CanonicalPlanView,
  type ManagementActionRecord,
  type NewItemSpec,
  type NewItemSpecGate,
  type NewItemSpecMilestone,
  type NewItemSpecTask,
  type PlanForkItemKind,
  type PlanForkRecord,
} from '../../domain/planfork/index.js'
import {
  KIND_TO_DIR,
  PlanStore,
  type PlanFileWriter,
} from '../../domain/plan/index.js'
import type {
  GateDoc,
  MilestoneDoc,
  ResearchFileReader,
  TaskDoc,
} from '../../domain/loader/index.js'
import { parseId, type IdAllocator, type Reservation } from '../../../shared/ids/index.js'
import type { GitOptions } from '../../git/index.js'
import {
  closurePathsLenient,
  compareClosureBases,
  DEFAULT_STALE_CONCURRENCY,
  formatStaleReason,
  hashClosure,
  type ClosureDiffEntry,
  type GitClosureOptions,
} from '../stale/index.js'
import { computeNewPlan, type ComputeNewPlanInput } from './formula.js'
import {
  detectCrashSignature,
  type CrashedNewFile,
} from './crash-signature.js'
import {
  SelectServiceError,
  type DismissOutcome,
  type MaterializedItem,
  type PlanForkSelectOptions,
  type PlanForkSelectStoreFace,
  type SelectAuditEntry,
  type SelectAuditReport,
  type SelectOutcome,
} from './types.js'

/** §6.5 连锁失效 reason 原文（stale_reason 逐字）。 */
const CHAINED_STALE_REASON = (pfId: string): string => `superseded by ${pfId} selection`

/** §6.7 checkpoint 提示文案（INV-GIT-2: 显式、可选、绝不自动）。 */
const CHECKPOINT_HINT =
  'Save Research Checkpoint is now available (git commit of .research/**, explicit + optional, NEVER automatic — INV-GIT-2). ' +
  'The resulting commit OID is recorded by the CHECKPOINT_SAVED ManagementAction when the user saves.'

/** `items/<dir>` 目录名的 PF kind（扫描用; 与 KIND_TO_DIR 互为逆）。 */
const DIR_TO_PF_KIND: Readonly<Record<string, PlanForkItemKind>> = {
  tasks: 'TASK',
  gates: 'GATE',
  milestones: 'MILESTONE',
}

/** PF kind → 定义文件 kind（domain/plan 小写词汇）。 */
const PF_KIND_TO_DOC_KIND: Readonly<Record<PlanForkItemKind, 'task' | 'gate' | 'milestone'>> = {
  TASK: 'task',
  GATE: 'gate',
  MILESTONE: 'milestone',
}

export class PlanForkSelectService {
  private readonly repoRoot: string
  private readonly researchDir: string
  private readonly store: PlanForkSelectStoreFace
  private readonly db: PlanForkSelectOptions['db']
  private readonly allocator: IdAllocator
  private readonly projectId: string
  private readonly planProvider: CanonicalPlanProvider
  private readonly reader: ResearchFileReader
  private readonly writer: PlanFileWriter
  private readonly schemaDir: string
  private readonly git: GitOptions | undefined
  private readonly concurrency: number
  private readonly now: () => number

  constructor(options: PlanForkSelectOptions) {
    if (options === null || typeof options !== 'object') {
      throw new SelectServiceError('SELECT_INPUT', 'options must be an object (PlanForkSelectOptions)')
    }
    if (typeof options.repoRoot !== 'string' || options.repoRoot.length === 0) {
      throw new SelectServiceError('SELECT_INPUT', 'repoRoot must be a non-empty string (the Git repository root containing .research/)')
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
      throw new SelectServiceError('SELECT_INPUT', `researchDir must be a repo-root-relative directory name (default '.research'; got ${JSON.stringify(researchDir)})`)
    }
    if (!Number.isSafeInteger(options.concurrency ?? DEFAULT_STALE_CONCURRENCY) || (options.concurrency ?? 1) < 1) {
      throw new SelectServiceError('SELECT_INPUT', `concurrency must be a positive safe integer (default ${DEFAULT_STALE_CONCURRENCY})`)
    }
    for (const what of ['store', 'db', 'allocator', 'planProvider', 'reader', 'writer'] as const) {
      if (options[what] === null || typeof options[what] !== 'object') {
        throw new SelectServiceError('SELECT_INPUT', `${what} is required`)
      }
    }
    if (typeof options.projectId !== 'string' || !/^PRJ-[1-9][0-9]*$/.test(options.projectId)) {
      throw new SelectServiceError('SELECT_INPUT', `projectId must be a well-formed PRJ id (got ${JSON.stringify(options.projectId)})`)
    }
    if (typeof options.schemaDir !== 'string' || options.schemaDir.length === 0) {
      throw new SelectServiceError('SELECT_INPUT', 'schemaDir must be a non-empty string (frozen declarative schema dir)')
    }
    this.repoRoot = options.repoRoot
    this.researchDir = researchDir
    this.store = options.store
    this.db = options.db
    this.allocator = options.allocator
    this.projectId = options.projectId
    this.planProvider = options.planProvider
    this.reader = options.reader
    this.writer = options.writer
    this.schemaDir = options.schemaDir
    this.git = options.git
    this.concurrency = options.concurrency ?? DEFAULT_STALE_CONCURRENCY
    this.now = options.now ?? Date.now
  }

  /* ---------------------------------------------------------------- *
   * Paths & views
   * ---------------------------------------------------------------- */

  private researchRoot(): string {
    return join(this.repoRoot, this.researchDir)
  }

  /** `.research`-relative → reader-absolute。 */
  private abs(rel: string): string {
    return join(this.researchRoot(), rel)
  }

  private gitOpts(): GitClosureOptions {
    return { repoRoot: this.repoRoot, researchDir: this.researchDir, git: this.git, concurrency: this.concurrency }
  }

  /**
   * The `wsDir` layout of a canonical view (`topics/<TPC>/workstreams/<WS>`)
   * — topicId/wsId 派生（PlanStore 构造用）。形状违例 = 内部 bug, 大声。
   */
  private wsLayout(wsDir: string): { topicId: string; wsId: string } {
    const parts = wsDir.split('/')
    if (parts.length !== 4 || parts[0] !== 'topics' || parts[2] !== 'workstreams' || parts[1] === undefined || parts[3] === undefined) {
      throw new SelectServiceError('SELECT_INPUT', `internal: workstream directory ${JSON.stringify(wsDir)} does not match the frozen §14 layout topics/<TPC>/workstreams/<WS>`)
    }
    return { topicId: parts[1], wsId: parts[3] }
  }

  /** 一个 WS 的 PlanStore（每次操作新实例 — 无状态 kernel, TC-DOM-005 精神）。 */
  private planStore(view: CanonicalPlanView): PlanStore {
    const { topicId, wsId } = this.wsLayout(view.wsDir)
    try {
      return new PlanStore({
        reader: this.reader,
        writer: this.writer,
        researchRoot: this.researchRoot(),
        schemaDir: this.schemaDir,
        topicId,
        wsId,
      })
    } catch (cause) {
      throw new SelectServiceError('SELECT_INPUT', `cannot construct the canonical plan store for ${JSON.stringify(view.wsDir)}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    }
  }

  /**
   * 该 WS 每个 kind 的**全部**现有定义文件 id（含未列入计划的保留文件 —
   * §6.2 「下一序号」必须越过它们, INV-PLAN-9）。只数良构 `<KIND>-<n>.yaml`。
   */
  private scanExistingIds(view: CanonicalPlanView): Record<PlanForkItemKind, string[]> {
    const out: Record<PlanForkItemKind, string[]> = { TASK: [], GATE: [], MILESTONE: [] }
    for (const [dir, kind] of Object.entries(DIR_TO_PF_KIND) as [string, PlanForkItemKind][]) {
      const entries = this.reader.readDir(this.abs(`${view.wsDir}/items/${dir}`))
      if (entries === null) continue
      for (const e of entries) {
        if (e.kind !== 'file') continue
        const m = /^([A-Z]+)-([1-9][0-9]*)\.yaml$/.exec(e.name)
        if (m === null) continue
        const parsed = parseId(e.name.replace(/\.yaml$/, ''))
        if (parsed === null || parsed.kind !== kind) continue
        out[kind].push(`${parsed.prefix}-${parsed.sequence}`)
      }
    }
    return out
  }

  /**
   * 该 WS 磁盘上**不在** PF base 闭包内的定义文件（解析后的声明面 —
   * 崩溃签名的文件证据 (a)）。base 内路径 = 创建时刻已有（旧文件, 排除）;
   * 解析失败的文件（malformed/跨 WS）不是签名候选 — 跳过（签名要求
   * well-formed + 属本 WS + created_by 匹配, PlanStore.readItem 全过）。
   * 返回 id 稳定顺序。
   */
  private collectNewFiles(view: CanonicalPlanView, record: PlanForkRecord): CrashedNewFile[] {
    const basePaths = new Set(record.base_plan_objects.map((o) => o.path))
    const pstore = this.planStore(view)
    const out: CrashedNewFile[] = []
    for (const [dir, kind] of Object.entries(DIR_TO_PF_KIND) as [string, PlanForkItemKind][]) {
      const entries = this.reader.readDir(this.abs(`${view.wsDir}/items/${dir}`))
      if (entries === null) continue
      for (const e of entries) {
        if (e.kind !== 'file') continue
        const parsed = parseId(e.name.replace(/\.yaml$/, ''))
        if (parsed === null || parsed.kind !== kind) continue
        const id = parsed.raw
        const rel = `${view.wsDir}/items/${dir}/${e.name}`
        if (basePaths.has(rel)) continue // 旧文件（创建时刻闭包内）
        let doc
        try {
          doc = readItemDoc(pstore, PF_KIND_TO_DOC_KIND[kind], id)
        } catch {
          continue // malformed / 跨 WS / 读取失败 — 非签名候选
        }
        const spec = specFromDoc(kind, doc)
        if (spec === null) continue
        out.push({ id, kind, spec, createdBy: doc.created_by })
      }
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  /* ---------------------------------------------------------------- *
   * SELECT（§6 全步）
   * ---------------------------------------------------------------- */

  /**
   * 物化一个 OPEN PlanFork（§6 全步 — 用户操作, actor 必须 USER,
   * INV-PERM-2）。错误分类：
   *   - WP-3.1 `PlanForkError`（PF_NOT_FOUND / PF_WRONG_STATE — 前置/并发）;
   *   - `SelectServiceError`: SELECT_ACTOR_NOT_USER / SELECT_GIT /
   *     SELECT_REFUSED_STALE / SELECT_CRASH_INCOMPLETE / SELECT_WRITE /
   *     SELECT_DB_FAILED / SELECT_CONCURRENT_STATE /
   *     SELECT_COMPENSATION_FAILED / SELECT_PLAN_INCONSISTENT。
   */
  async select(pfId: string, actor: ActorRef): Promise<SelectOutcome> {
    if (typeof pfId !== 'string' || pfId.length === 0) {
      throw new SelectServiceError('SELECT_INPUT', 'pfId must be a non-empty string (a PF id)')
    }
    this.assertUserActor(actor, 'select')

    // 前置: PF.status == OPEN（§6 原文; STALE/DISMISSED/SELECTED 均拒绝）。
    const record = this.store.getPlanFork(pfId)
    if (record === null) {
      throw new PlanForkError({ code: 'PF_NOT_FOUND', message: `plan fork ${JSON.stringify(pfId)} does not exist` })
    }
    checkPfTransition(pfId, record.status, 'SELECTED')

    // 1) 复核基准（§6.1, INV-PLAN-8）。
    const view = this.planProvider.load(record.workstream_id)
    const diff = await this.recomputeClosureDiff(record, view)
    if (diff.length > 0) {
      // 自动置 STALE（§6.1 — 同 WP-3.2 判定语义: 乐观门 + 同事务账本,
      // actor=PLUGIN; stale_reason = §5 首个差异三元组）。
      const reason = formatStaleReason(diff)
      this.store.transition(record.id, { to: 'STALE', stale_reason: reason }, { kind: 'PLUGIN' })
      // 崩溃签名判定（文件半边已落 / DB 半边丢失 — 专用大声错误, 不静默修复）。
      let crash: { matched: boolean; matchedIds?: readonly string[]; detail: string } | null = null
      if (view.workstream_exists && view.present && view.consistent) {
        crash = detectCrashSignature({
          record,
          canonical: view.ordered_items,
          newFiles: this.collectNewFiles(view, record),
        })
      }
      const base = {
        checked: 1,
        entries: [
          {
            pfId: record.id,
            workstreamId: record.workstream_id,
            kind: 'CRASH_INCOMPLETE' as const,
            diff,
            ...(crash?.matched && crash.matchedIds !== undefined ? { matchedIds: crash.matchedIds } : {}),
            note: crash === null ? 'plan not consistent — crash signature not verifiable' : crash.detail,
          },
        ],
      }
      if (crash !== null && crash.matched) {
        throw new SelectServiceError(
          'SELECT_CRASH_INCOMPLETE',
          `SELECT of ${record.id} refused: the current plan of ${record.workstream_id} is EXACTLY the §6.3 materialization of this fork ` +
            `(${crash.matchedIds?.join(', ')}) while the PF is still OPEN — a previous SELECT left the FILE half applied and the DB half ` +
            `missing (crash between the plan.yaml rewrite and the DB commit), or the plan was hand-edited into this shape. ` +
            `The PF has been auto-marked STALE (its basis is gone — §6.1). NO silent repair: verify the plan manually — keep it ` +
            `(the Agent may re-propose on the new basis) or restore the previous plan from Git (INV-GIT-8).`,
          { diff, report: { ...base, violations: base.entries.filter((e) => e.kind === 'CRASH_INCOMPLETE') } },
        )
      }
      throw new SelectServiceError(
        'SELECT_REFUSED_STALE',
        `SELECT of ${record.id} refused: the closure basis changed since creation (${diff.length} difference(s); ` +
          `first: ${reason}) — the PF has been auto-marked STALE (PLAN_FORK_SPEC §6.1; INV-PLAN-8). Re-propose on the current plan.`,
        { diff },
      )
    }

    // 复核空 diff ⇒ 当前闭包 == base 闭包 ⇒ plan.yaml 内容 == 创建时刻内容
    // ⇒ 视图必一致且存在（防御性断言 — 违例 = 内部 bug, 大声）。
    if (!view.workstream_exists || !view.present || !view.consistent) {
      throw new SelectServiceError('SELECT_PLAN_INCONSISTENT', `internal: basis recheck matched but the canonical view of ${record.workstream_id} is ${view.workstream_exists ? (view.present ? 'inconsistent' : 'absent') : 'missing'} — the view/basis invariant was violated`)
    }

    // 2)+3) 物化（文件半边）：定义文件先行（安全部分序 — 未列入定义合法,
    // INV-PLAN-9）, plan.yaml 最后; 写前留存旧 plan.yaml 精确字节（补偿）。
    const pstore = this.planStore(view)
    const wsId = view.workstream_id
    const at = this.now()
    const existing = this.scanExistingIds(view)
    let computed: ReturnType<typeof computeNewPlan>
    try {
      computed = computeNewPlan({
        canonical: view.ordered_items,
        forkAnchor: record.fork_anchor,
        mergeAnchor: record.merge_anchor,
        proposedItems: record.proposed_items,
        existingIdsByKind: existing,
      })
    } catch (cause) {
      if (cause instanceof PlanForkError) throw cause // 前置不变量违例（不应发生 — §4 链已保证）
      throw new SelectServiceError('SELECT_INPUT', `§6.3 materialization failed for ${record.id}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    }
    const newPlanItems: MaterializedItem[] = []
    let allocIdx = 0
    record.proposed_items.forEach((item) => {
      if (item.action !== 'NEW') return
      const alloc = computed.newItems[allocIdx++]!
      const doc = itemDocFromSpec(item.kind, alloc.id, item.spec, wsId, record.created_by_run, at)
      const dir = KIND_TO_DIR[PF_KIND_TO_DOC_KIND[item.kind]]
      createItemDoc(pstore, PF_KIND_TO_DOC_KIND[item.kind], doc)
      newPlanItems.push({ id: alloc.id, kind: item.kind, path: `${view.wsDir}/items/${dir}/${alloc.id}.yaml`, spec: item.spec })
    })

    const planPathRel = `${view.wsDir}/plan.yaml`
    const oldPlanYaml = this.reader.readFile(this.abs(planPathRel))
    if (oldPlanYaml === null) {
      throw new SelectServiceError('SELECT_PLAN_INCONSISTENT', `internal: plan.yaml of ${record.workstream_id} vanished after the basis recheck matched (TOCTOU) — re-run SELECT`)
    }
    try {
      pstore.savePlan(computed.newOrder)
    } catch (cause) {
      // plan.yaml 未被触及（savePlan 失败前不落盘）⇒ 无需补偿; 已写定义
      // 文件 = 合法未列入态（INV-PLAN-9）。
      throw new SelectServiceError('SELECT_WRITE', `plan.yaml rewrite failed for ${record.id} (definition files written remain unlisted — legal, INV-PLAN-9; PF stays OPEN): ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    }

    // 物化后新闭包 OID（§6.6 PF_SELECTED 账本行的 git_blob_oids — 新
    // plan.yaml + 各定义文件）。git 失败 = 「文件半边已落」窗口 ⇒ 补偿。
    let newClosureObjects: BasePlanObject[]
    try {
      const newPaths = closureRelativePaths(view.wsDir, computed.newOrder)
      const hashed = await hashClosure(this.gitOpts(), newPaths)
      const missing = hashed.entries.find((e) => e.oid === null)
      if (missing !== undefined) {
        throw new Error(`closure file missing from working copy after materialization: ${missing.path} (internal — the materialized files were just written)`)
      }
      newClosureObjects = hashed.entries.map((e) => ({ path: e.path, git_blob_oid: e.oid! }))
    } catch (cause) {
      this.compensatePlan(planPathRel, oldPlanYaml, cause)
      throw new SelectServiceError('SELECT_GIT', `closure capture failed after materialization of ${record.id}: ${cause instanceof Error ? cause.message : String(cause)} — the old plan.yaml has been restored (compensation); the PF stays OPEN; new definition files remain unlisted (INV-PLAN-9)`, { cause })
    }

    // 4) DB 事务（§6.4/§6.5/§6.6 原子核心）。
    const others = this.store.listPlanForks({ workstreamId: record.workstream_id, status: 'OPEN' }).filter((r) => r.id !== record.id)
    const selectedMaRes = this.allocator.reserve('MANAGEMENT_ACTION', this.projectId)
    const othersMaRes: Reservation[] = others.map(() => this.allocator.reserve('MANAGEMENT_ACTION', this.projectId))
    try {
      this.db.transaction(() => {
        // 4.1 目标 PF: OPEN → SELECTED（乐观条件更新 — 并发门）。
        const changes = this.db.run(
          SQL_TRANSITION_PLAN_FORK.SELECTED,
          at,
          JSON.stringify(actor),
          record.id,
          'OPEN',
        )
        if (changes === 0) {
          const reread = this.db.get(SQL_SELECT_PLAN_FORK_BY_ID, record.id)
          if (reread === undefined) {
            throw new PlanForkError({ code: 'PF_NOT_FOUND', message: `plan fork ${JSON.stringify(record.id)} vanished during SELECT (no-delete trigger in effect — investigate)` })
          }
          const row = rowToPlanFork(reread)
          if (row.status === 'OPEN') {
            throw new SelectServiceError('SELECT_CONCURRENT_STATE', `plan fork ${record.id} reads OPEN but the conditional UPDATE matched 0 rows — a concurrent write raced the optimistic gate; the DB transaction rolled back; the old plan.yaml will be restored (compensation); re-run SELECT`)
          }
          checkPfTransition(record.id, row.status, 'SELECTED') // ⇒ PF_WRONG_STATE（点名当前态 + 合法集）
        }
        // 4.2 同 WS 其余 OPEN PF: 一律 → STALE（§6.5 原文 reason, actor=PLUGIN）。
        for (const other of others) {
          const oc = this.db.run(
            SQL_TRANSITION_PLAN_FORK.STALE,
            CHAINED_STALE_REASON(record.id),
            other.id,
            'OPEN',
          )
          if (oc === 0) {
            const reread = this.db.get(SQL_SELECT_PLAN_FORK_BY_ID, other.id)
            if (reread === undefined) {
              throw new PlanForkError({ code: 'PF_NOT_FOUND', message: `plan fork ${JSON.stringify(other.id)} vanished during SELECT (no-delete trigger in effect — investigate)` })
            }
            const row = rowToPlanFork(reread)
            if (row.status === 'OPEN') {
              throw new SelectServiceError('SELECT_CONCURRENT_STATE', `plan fork ${other.id} reads OPEN but the chained-STALE UPDATE matched 0 rows — a concurrent write raced the optimistic gate; the DB transaction rolled back; the old plan.yaml will be restored (compensation); re-run SELECT`)
            }
            throw new SelectServiceError('SELECT_CONCURRENT_STATE', `plan fork ${other.id} (same workstream) moved concurrently to ${row.status} during the chained-STALE phase of SELECT ${record.id} — the DB transaction rolled back; the old plan.yaml will be restored (compensation); re-run SELECT`)
          }
        }
        // 4.3 账本 append（PF_SELECTED 含新闭包 OID — §6.6; 连锁 STALE 逐行）。
        const selectedMa: ManagementActionRecord = {
          id: selectedMaRes.id,
          action_kind: 'PF_SELECTED',
          actor,
          subject_refs: [{ kind: 'PLAN_FORK', id: record.id }],
          git_blob_oids: newClosureObjects.map((o) => ({ path: o.path, oid: o.git_blob_oid })),
          detail:
            `plan fork ${record.id} selected for ${record.workstream_id}: plan.yaml rewritten [${computed.newOrder.join(', ')}]; ` +
            `materialized new items ${newPlanItems.length > 0 ? newPlanItems.map((i) => i.id).join(', ') : 'none'} (created_by=AGENT/${record.created_by_run}, materialized by ${actorLabel(actor)}); ` +
            `left ordered_items: ${computed.removedIds.length > 0 ? computed.removedIds.join(', ') : 'none'} (definition files retained — INV-PLAN-9); ` +
            `chained STALE: ${others.length > 0 ? others.map((o) => o.id).join(', ') : 'none'}`,
          occurred_at: at,
        }
        this.db.run(SQL_INSERT_MANAGEMENT_ACTION, ...managementActionToParams(selectedMa))
        others.forEach((other, i) => {
          const ma: ManagementActionRecord = {
            id: othersMaRes[i]!.id,
            action_kind: 'PF_STALE_MARKED',
            actor: { kind: 'PLUGIN' },
            subject_refs: [{ kind: 'PLAN_FORK', id: other.id }],
            detail: `plan fork ${other.id} marked stale (was OPEN): ${CHAINED_STALE_REASON(record.id)}`,
            occurred_at: at,
          }
          this.db.run(SQL_INSERT_MANAGEMENT_ACTION, ...managementActionToParams(ma))
        })
      })
    } catch (cause) {
      this.allocator.release(selectedMaRes)
      for (const res of othersMaRes) this.allocator.release(res)
      // 补偿协议（goal 4）：文件半边已落 ⇒ 恢复旧 plan.yaml 精确字节。
      this.compensatePlan(planPathRel, oldPlanYaml, cause)
      if (cause instanceof SelectServiceError && cause.code === 'SELECT_CONCURRENT_STATE') throw cause
      if (cause instanceof PlanForkError && (cause.code === 'PF_WRONG_STATE' || cause.code === 'PF_NOT_FOUND')) {
        throw new SelectServiceError('SELECT_CONCURRENT_STATE', `${cause.message} — the DB transaction rolled back; the old plan.yaml has been restored (compensation); the PF state is authoritative — re-run the operation on it`, { cause })
      }
      const msg = cause instanceof Error ? cause.message : String(cause)
      throw new SelectServiceError('SELECT_DB_FAILED', `DB transaction failed after the file side of SELECT ${record.id} succeeded: ${msg} — the old plan.yaml has been restored (compensation); new definition files remain unlisted (legal, INV-PLAN-9); the PF stays OPEN; re-run SELECT`, { cause })
    }
    this.allocator.commit(selectedMaRes)
    for (const res of othersMaRes) this.allocator.commit(res)

    // 6) 结果（§6.7 提示 + §6.8 保留说明随 removedIds 返回）。
    return {
      pfId: record.id,
      workstreamId: record.workstream_id,
      statusBefore: 'OPEN',
      statusAfter: 'SELECTED',
      selectedAt: at,
      selectedBy: actor,
      oldOrder: [...view.ordered_items],
      newOrder: [...computed.newOrder],
      newItems: newPlanItems,
      removedIds: [...computed.removedIds],
      staleOthers: others.map((o) => ({ pfId: o.id, stale_reason: CHAINED_STALE_REASON(record.id) })),
      newClosure: newClosureObjects,
      planYamlPath: planPathRel,
      checkpointHint: CHECKPOINT_HINT,
    }
  }

  /**
   * 补偿（goal 4 原文协议）：恢复旧 plan.yaml 精确字节（writer 原子回写）。
   * 补偿自身失败 ⇒ SELECT_COMPENSATION_FAILED（人工介入 — git restore,
   * INV-GIT-8; 原错误作 cause 保留）。
   */
  private compensatePlan(planPathRel: string, oldPlanYaml: string, originalCause: unknown): void {
    try {
      this.writer.writeAtomic(this.abs(planPathRel), oldPlanYaml)
    } catch (compensationCause) {
      throw new SelectServiceError(
        'SELECT_COMPENSATION_FAILED',
        `COMPENSATION FAILED: the DB transaction of the SELECT failed AND restoring the old plan.yaml (${planPathRel}) also failed — the plan file may hold the NEW materialized content while the PF is still OPEN. Manual intervention required (restore from Git — INV-GIT-8, or fix and re-run SELECT). ` +
          `original: ${originalCause instanceof Error ? originalCause.message : String(originalCause)}; compensation: ${compensationCause instanceof Error ? compensationCause.message : String(compensationCause)}`,
        { cause: compensationCause },
      )
    }
  }

  /* ---------------------------------------------------------------- *
   * DISMISS（§7 — 用户）
   * ---------------------------------------------------------------- */

  /**
   * DISMISS 一个 OPEN 或 STALE PlanFork（§7 原文）。经 WP-3.1
   * `store.transition`（乐观条件更新 + 同事务 PF_DISMISSED 账本 — 账本面
   * 核对后使用: management_action 表 + ManagementAction 映射, WP-3.1 交付）。
   * 只改状态不删除（append-only）。SELECTED/DISMISSED 来源态拒绝。
   */
  dismiss(pfId: string, actor: ActorRef): DismissOutcome {
    if (typeof pfId !== 'string' || pfId.length === 0) {
      throw new SelectServiceError('SELECT_INPUT', 'pfId must be a non-empty string (a PF id)')
    }
    this.assertUserActor(actor, 'dismiss')
    const record = this.store.getPlanFork(pfId)
    if (record === null) {
      throw new PlanForkError({ code: 'PF_NOT_FOUND', message: `plan fork ${JSON.stringify(pfId)} does not exist` })
    }
    // §7 允许来源态 OPEN|STALE — checkPfTransition 对目标 DISMISSED 的合法
    // 集恰为 {OPEN, STALE}（§10 表）; SELECTED/DISMISSED ⇒ PF_WRONG_STATE
    // （点名当前态 + 合法集 — 守卫单一来源, 不重述表）。
    checkPfTransition(pfId, record.status, 'DISMISSED')
    const dismissedAt = this.now()
    const updated = this.store.transition(pfId, { to: 'DISMISSED', dismissed_at: dismissedAt }, actor)
    if (updated.status !== 'DISMISSED' || updated.dismissed_at === undefined) {
      throw new PlanForkError({ code: 'PF_INPUT', message: `internal: transition result for ${pfId} is not a coherent DISMISSED record (status=${updated.status})` })
    }
    return {
      pfId: record.id,
      workstreamId: record.workstream_id,
      statusBefore: record.status as 'OPEN' | 'STALE',
      statusAfter: 'DISMISSED',
      dismissedAt,
      dismissedBy: actor,
    }
  }

  /* ---------------------------------------------------------------- *
   * 崩溃一致性审计（goal 4 — 重启后检测面, 只读）
   * ---------------------------------------------------------------- */

  /**
   * 审计所有（或指定 WS 的）OPEN PF 的 plan.yaml ↔ PF 状态一致性
   * （只读 — 零状态变更、零账本行、零 git 写）。每个 PF：
   *   - plan 缺失/不一致 ⇒ UNVERIFIABLE（信息性 — 复核面走 §5 宽松判定）;
   *   - 闭包 == base ⇒ OK;
   *   - 闭包差异 + 崩溃签名命中 ⇒ **CRASH_INCOMPLETE（违规）**;
   *   - 闭包差异（无签名）⇒ BASIS_STALE（信息性 — §5 stale 为
   *     information-only; 状态迁移属 SELECT 复核/§5 触发面, 不属审计）。
   * 存在违规 ⇒ 抛 SELECT_CONSISTENCY（**大声** — 报告附于错误）;
   * 无违规 ⇒ 返回报告。
   */
  async auditSelectConsistency(workstreamId?: string): Promise<SelectAuditReport> {
    if (workstreamId !== undefined && (typeof workstreamId !== 'string' || workstreamId.length === 0)) {
      throw new SelectServiceError('SELECT_INPUT', 'workstreamId must be a non-empty string (or undefined to audit all workstreams)')
    }
    const open = this.store.listPlanForks(
      workstreamId === undefined ? { status: 'OPEN' } : { status: 'OPEN', workstreamId },
    )
    const entries: SelectAuditEntry[] = []
    for (const record of open) {
      const view = this.planProvider.load(record.workstream_id)
      if (!view.workstream_exists || !view.present || !view.consistent) {
        entries.push({
          pfId: record.id,
          workstreamId: record.workstream_id,
          kind: 'UNVERIFIABLE',
          note: !view.workstream_exists
            ? 'workstream directory absent — the whole base closure is missing (§5: file missing ⇒ different)'
            : !view.present
              ? 'plan.yaml absent — the whole base closure is missing (§5: file missing ⇒ different)'
              : `plan inconsistent (${view.problem ?? 'unspecified'}) — crash signature not verifiable on a mid-edit plan`,
        })
        continue
      }
      const diff = await this.recomputeClosureDiff(record, view)
      if (diff.length === 0) {
        entries.push({ pfId: record.id, workstreamId: record.workstream_id, kind: 'OK' })
        continue
      }
      const crash = detectCrashSignature({
        record,
        canonical: view.ordered_items,
        newFiles: this.collectNewFiles(view, record),
      })
      if (crash.matched) {
        entries.push({
          pfId: record.id,
          workstreamId: record.workstream_id,
          kind: 'CRASH_INCOMPLETE',
          diff,
          ...(crash.matchedIds !== undefined ? { matchedIds: crash.matchedIds } : {}),
          note: crash.detail,
        })
      } else {
        entries.push({
          pfId: record.id,
          workstreamId: record.workstream_id,
          kind: 'BASIS_STALE',
          diff,
          note: `basis differs (${diff.length} diff(s); first: ${formatStaleReason(diff)}); not this PF's materialization form — ${crash.detail}`,
        })
      }
    }
    const violations = entries.filter((e) => e.kind === 'CRASH_INCOMPLETE')
    const report: SelectAuditReport = { checked: open.length, entries, violations }
    if (violations.length > 0) {
      throw new SelectServiceError(
        'SELECT_CONSISTENCY',
        `POST-CRASH CONSISTENCY VIOLATION: ${violations.length} OPEN PlanFork(s) have a plan.yaml that is exactly their §6.3 materialization form while the PF state is still OPEN ` +
          `(${violations.map((v) => `${v.pfId}[${v.workstreamId}]`).join(', ')}) — the file half of a SELECT was applied and the DB half lost. ` +
          `NO silent repair. Verify each plan manually: keep it (the PF will/should be STALE — the Agent re-proposes) or restore from Git (INV-GIT-8).`,
        { report },
      )
    }
    return report
  }

  /* ---------------------------------------------------------------- *
   * 闭包重算（§6.1 复核 + 审计共用 — WP-3.2 单一来源部件）
   * ---------------------------------------------------------------- */

  /**
   * 当前闭包 vs `record.base_plan_objects` 的 §5 集合差异（空 = 基准未失真）。
   * plan 不一致/缺失走 WP-3.2 同语义（宽松闭包 / 空集 — 「文件缺失视为不同」）。
   * git 基础设施失败 ⇒ SELECT_GIT（零状态变更 — 调用方尚未做任何迁移）。
   */
  private async recomputeClosureDiff(record: PlanForkRecord, view: CanonicalPlanView): Promise<ClosureDiffEntry[]> {
    let paths: string[]
    if (!view.workstream_exists || !view.present) {
      paths = [] // plan 缺失 ⇒ 当前闭包空集 ⇒ base 全 removed
    } else {
      try {
        paths = closureRelativePaths(view.wsDir, view.ordered_items)
      } catch {
        paths = closurePathsLenient(view.wsDir, view.ordered_items)
      }
    }
    let hashed
    try {
      hashed = await hashClosure(this.gitOpts(), paths)
    } catch (cause) {
      throw new SelectServiceError('SELECT_GIT', `git closure recompute failed for ${JSON.stringify(record.workstream_id)}: ${cause instanceof Error ? cause.message : String(cause)} — no state change`, { cause })
    }
    return compareClosureBases(record.base_plan_objects, hashed.entries)
  }

  /* ---------------------------------------------------------------- *
   * Actor 守卫（INV-PERM-2 — 类型面 + 运行面双保险）
   * ---------------------------------------------------------------- */

  private assertUserActor(actor: ActorRef, op: string): void {
    if (actor === null || typeof actor !== 'object' || actor.kind !== 'USER') {
      throw new SelectServiceError(
        'SELECT_ACTOR_NOT_USER',
        `${op}: actor must be kind USER — SELECT/DISMISS are USER operations with NO agent face (PLAN_FORK_SPEC §1 权限表: Agent ❌; ARCHITECTURE §5.4 INV-PERM-2; got ${JSON.stringify(actor)})`,
      )
    }
    if (actor.run_id !== undefined && !/^R-[1-9][0-9]*$/.test(actor.run_id)) {
      throw new SelectServiceError('SELECT_INPUT', `${op}: actor.run_id ${JSON.stringify(actor.run_id)} is not a well-formed R id (common.schema.json actorRef)`)
    }
    if (actor.user_id !== undefined && typeof actor.user_id !== 'string') {
      throw new SelectServiceError('SELECT_INPUT', `${op}: actor.user_id must be a string (common.schema.json actorRef)`)
    }
    if (actor.label !== undefined && (typeof actor.label !== 'string' || actor.label.length > 200)) {
      throw new SelectServiceError('SELECT_INPUT', `${op}: actor.label must be a string of ≤200 chars (common.schema.json actorRef)`)
    }
  }
}

/* ------------------------------------------------------------------ *
 * 纯辅助（spec 提取 / 定义文档构建 — 无 I/O）
 * ------------------------------------------------------------------ */

/** 一个 `actorLabel` 的机械摘要（账本 detail 用 — 无科研判断）。 */
function actorLabel(actor: ActorRef): string {
  const parts: string[] = [actor.kind]
  if (actor.user_id !== undefined) parts.push(`user=${actor.user_id}`)
  if (actor.label !== undefined) parts.push(`label=${actor.label}`)
  return parts.join(' ')
}

/**
 * per-kind 字面 overload 分发（PlanStore 的 readItem/createItem overload
 * 组是字面 kind 形 — union kind + union doc 不匹配任何单条 overload）。
 */
function readItemDoc(pstore: PlanStore, kind: 'task' | 'gate' | 'milestone', id: string): TaskDoc | GateDoc | MilestoneDoc {
  switch (kind) {
    case 'task':
      return pstore.readItem('task', id)
    case 'gate':
      return pstore.readItem('gate', id)
    case 'milestone':
      return pstore.readItem('milestone', id)
  }
}

function createItemDoc(pstore: PlanStore, kind: 'task' | 'gate' | 'milestone', doc: TaskDoc | GateDoc | MilestoneDoc): void {
  switch (kind) {
    case 'task':
      pstore.createItem('task', doc as TaskDoc)
      return
    case 'gate':
      pstore.createItem('gate', doc as GateDoc)
      return
    case 'milestone':
      pstore.createItem('milestone', doc as MilestoneDoc)
      return
  }
}

/**
 * 定义文件 doc → frozen NEW spec 形状（absent 字段保留 absent —
 * 崩溃签名 specKey 的 absent/present 区分依赖此）。malformed ⇒ null。
 */
function specFromDoc(kind: PlanForkItemKind, doc: TaskDoc | GateDoc | MilestoneDoc): NewItemSpec | null {
  const d = doc as unknown as Record<string, unknown>
  if (typeof d.title !== 'string' || d.title.length === 0) return null
  switch (kind) {
    case 'TASK': {
      if (typeof d.goal !== 'string' || d.goal.length === 0) return null
      const spec: Record<string, unknown> = { title: d.title, goal: d.goal }
      if (d.deliverables !== undefined) {
        if (!Array.isArray(d.deliverables) || d.deliverables.some((x) => typeof x !== 'string')) return null
        spec.deliverables = d.deliverables
      }
      if (d.acceptance_criteria !== undefined) {
        if (!Array.isArray(d.acceptance_criteria) || d.acceptance_criteria.some((x) => typeof x !== 'string')) return null
        spec.acceptance_criteria = d.acceptance_criteria
      }
      return spec as unknown as NewItemSpecTask
    }
    case 'GATE': {
      if (typeof d.criteria !== 'string' || d.criteria.length === 0) return null
      const spec: Record<string, unknown> = { title: d.title, criteria: d.criteria }
      if (d.references !== undefined) {
        if (!Array.isArray(d.references) || d.references.some((x) => typeof x !== 'string')) return null
        spec.references = d.references
      }
      return spec as unknown as NewItemSpecGate
    }
    case 'MILESTONE': {
      if (typeof d.statement !== 'string' || d.statement.length === 0) return null
      return { title: d.title, statement: d.statement } as NewItemSpecMilestone
    }
  }
}

/**
 * §6.2 物化定义文档：`created_by = { kind: AGENT, run_id: PF.created_by_run }`
 * （内容作者 — §6.2 原文）; `created_at` = 物化时刻（epoch ms — 序列化层
 * 转 ISO 载体, §1.2）。可选数组仅当 spec 提供时随 doc 携带（absent 字段在
 * 冻结内核边界落为 schema 默认 [] — WP-1.1 ajv useDefaults; 崩溃签名比较
 * 经同一归一（crash-signature.ts `field` — `[]` ≡ absent））。
 */
function itemDocFromSpec(
  kind: PlanForkItemKind,
  id: string,
  spec: NewItemSpec,
  workstreamId: string,
  createdByRun: string,
  at: number,
): TaskDoc | GateDoc | MilestoneDoc {
  const s = spec as unknown as Record<string, unknown>
  const base: Record<string, unknown> = {
    id,
    workstream_id: workstreamId,
    created_by: { kind: 'AGENT', run_id: createdByRun },
    created_at: at,
  }
  switch (kind) {
    case 'TASK':
      return {
        ...base,
        title: s.title as string,
        goal: s.goal as string,
        ...(s.deliverables !== undefined ? { deliverables: s.deliverables as string[] } : {}),
        ...(s.acceptance_criteria !== undefined ? { acceptance_criteria: s.acceptance_criteria as string[] } : {}),
      } as unknown as TaskDoc
    case 'GATE':
      return {
        ...base,
        title: s.title as string,
        criteria: s.criteria as string,
        ...(s.references !== undefined ? { references: s.references as string[] } : {}),
      } as unknown as GateDoc
    case 'MILESTONE':
      return {
        ...base,
        title: s.title as string,
        statement: s.statement as string,
      } as unknown as MilestoneDoc
  }
}
