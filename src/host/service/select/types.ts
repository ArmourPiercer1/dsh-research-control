/**
 * WP-3.4 — SELECT 物化 / DISMISS / 连锁 STALE（service 层）：共享类型面。
 *
 * Frozen contracts implemented here (all read-only):
 *  - PLAN_FORK_SPEC §6（SELECT 物化流程，用户 GUI 触发，全 8 步原文）：
 *      前置 `PF.status == OPEN`（STALE/DISMISSED/SELECTED 均拒绝）；
 *      ① 复核基准：重算当前 closure 与 `PF.base_plan_objects` 不一致 ⇒
 *        自动置 STALE 并拒绝本次 SELECT，返回差异说明（INV-PLAN-8）；
 *      ② 物化新 items：每个 `NEW` item 分配正式 ID（T/G/M 各自下一序号），
 *        原子写入定义文件；`created_by = { kind: AGENT, run_id:
 *        PF.created_by_run }`（内容作者），物化执行者记录在 ManagementAction；
 *      ③ 重写 plan.yaml（§6.3 修正版拼接公式，A-13 修订原文 — 见 formula.ts）；
 *      ④ `PF.status = SELECTED`，记录 selected_at/selected_by；
 *      ⑤ 同基准连锁失效：该 workstream 其余 OPEN PF 一律置 STALE
 *        （stale_reason = "superseded by PF-<id> selection"，INV-PLAN-7）；
 *      ⑥ **不写 ResearchHistory**：只记录 ManagementAction(PF_SELECTED)
 *        （含新 plan.yaml 与各定义文件的 blob OID）；
 *      ⑦ 提示用户 Save Research Checkpoint（git commit，显式、可选、绝不
 *        自动 — INV-GIT-2；resulting commit OID 由 CHECKPOINT_SAVED 记录）；
 *      ⑧ 被替换掉的旧 canonical items：定义文件**保留**（INV-PLAN-9），
 *        只是不再出现在 ordered_items；旧计划不进 ResearchHistory。
 *  - PLAN_FORK_SPEC §7（DISMISS，用户）：允许 OPEN 或 STALE 的 PF；
 *    status → DISMISSED + ManagementAction(PF_DISMISSED)；只改状态，
 *    不删除记录（append-only）。
 *  - PLAN_FORK_SPEC §5（连锁 STALE 语义：物化后其他 OPEN PF 的基准失效
 *    判定 — §3.1 closure 恒含 plan.yaml，plan.yaml 被物化重写 ⇒ 同 WS 其
 *    余 OPEN PF 的基准 closure 已不存在，INV-PLAN-7 的机械规则 = 全部置
 *    STALE；跨 WS 不受影响 — 不同 plan.yaml）。
 *  - PLAN_FORK_SPEC §10（状态机：OPEN→SELECTED|DISMISSED|STALE,
 *    STALE→DISMISSED, 终态；全部迁移 append-only 记录，PF 行永不删除）。
 *  - ARCHITECTURE §5.4：
 *      INV-PLAN-2（plan order ≠ dependency：本服务不做任何位置科研含义
 *        解释 — formula 是纯位置拼接，reason/necessity 从不重判）；
 *      INV-PLAN-3（Agent 无 canonical plan 修改 API：类型面 — 本服务的
 *        物化入口 select/dismiss 只接受 USER actor（运行时强制，
 *        SELECT_ACTOR_NOT_USER），无任何 AGENT actor 可达的物化面；
 *        工具面（WP-3.3）的 RESEARCH_TOOL_NAMES 恰为 §7.2 11 项，无
 *        select/dismiss 工具 — tests/select 双钉）；
 *      INV-PLAN-4（PF append-only：本服务从不动 PF 内容列 — 状态迁移只
 *        经 WP-3.1 状态机面的状态缓存列 UPDATE；无 delete 面；存储层
 *        no-DELETE/内容不可变 trigger 兜底任何连接）；
 *      INV-PLAN-5（base = 创建时刻 closure 精确 (path, oid) 集合：SELECT
 *        前置复核 = 当前闭包集合 vs 存库 base 集合的比较
 *        （WP-3.2 `compareClosureBases` 单一来源）；物化从不改写
 *        base_plan_objects）；
 *      INV-PERM-2（SELECT/DISMISS 无 Agent 面 — §1 权限表：用户 ✅ /
 *        Agent ❌）；INV-GIT-2（checkpoint 显式可选，绝不自动）。
 *
 * Layer direction (ARCHITECTURE §2.2): service → domain/planfork（状态机 +
 * SQL 面 + 端口）+ domain/plan（PlanStore 原子写 — §6.2/§6.3 的唯一
 * canonical 写口）+ domain/loader（ResearchFileReader 端口）+ git 具名
 * W 操作（W3/W11，经 WP-3.2 hashClosure 单一来源）+ shared/ids。本层是
 * 唯一允许写 operational DB 与 .research/ 的编排层；无 DSH imports
 * (INV-PERM-5)；无直接 spawn (INV-GIT-6)。
 */

import type {
  ActorRef,
  AnchorResolution,
  BasePlanObject,
  CanonicalPlanProvider,
  NewItemSpec,
  PlanForkDb,
  PlanForkItemKind,
  PlanForkRecord,
  PfTransition,
} from '../../domain/planfork/index.js'
import type { PlanFileWriter } from '../../domain/plan/index.js'
import type { ResearchFileReader } from '../../domain/loader/index.js'
import type { IdAllocator } from '../../../shared/ids/index.js'
import type { GitOptions } from '../../git/index.js'
import type { ClosureDiffEntry } from '../stale/index.js'

/* ------------------------------------------------------------------ *
 * Options
 * ------------------------------------------------------------------ */

/**
 * `PlanForkSelectService` 构造选项（DI — 同 WP-3.2 StaleServiceOptions 风格）。
 *
 *  - `store` — WP-3.1 结构面（读 PF + DISMISS/复核 STALE 迁移；生产 =
 *    `PlanForkStore`）；
 *  - `db` — **同一个** operational DB 面（与 store 共享的注入端口）：
 *    SELECTED 迁移事务需要在其 PF_SELECTED 账本行上携带新 closure 的
 *    blob OID（§6.6 原文「含新 plan.yaml 与各定义文件的 blob OID」）—
 *    WP-3.1 `transition()` 的通用账本行不带 `git_blob_oids`，故 SELECTED
 *    迁移由本服务在同一事务内经 WP-3.1 导出的 SQL 常量
 *    （`SQL_TRANSITION_PLAN_FORK.SELECTED` / `SQL_INSERT_MANAGEMENT_ACTION`
 *    / `managementActionToParams` — 单一来源，零 SQL 重述）执行；
 *  - `allocator` — 与 store 共享的 project-scoped id 分配器
 *    （MANAGEMENT_ACTION 家族）；
 *  - `reader`/`writer` — WP-1.1 读端口 + WP-1.3 原子写端口（补偿协议
 *    「恢复旧 plan.yaml 内容」经 writer 原子回写精确旧字节）；
 *  - `schemaDir` — 冻结 declarative schema 目录（PlanStore 构造，
 *    §6.2/§6.3 定义文件与 plan.yaml 写入前的冻结 schema 校验）。
 */
export interface PlanForkSelectOptions {
  /** The Git repository root (the directory containing `.research/`). */
  readonly repoRoot: string
  /** The `.research` directory name directly under `repoRoot` (default `'.research'`). */
  readonly researchDir?: string
  /** The WP-3.1 store face (reads + DISMISS/复核 STALE transitions). */
  readonly store: PlanForkSelectStoreFace
  /** The operational DB surface SHARED with the store (SELECTED 事务). */
  readonly db: PlanForkDb
  /** The shared project-scoped id allocator (MANAGEMENT_ACTION family). */
  readonly allocator: IdAllocator
  /** The `PRJ-<n>` the counters are scoped to. */
  readonly projectId: string
  /** The canonical plan provider (WP-3.1 port — fresh read, no cache). */
  readonly planProvider: CanonicalPlanProvider
  /** Read-only file access (WP-1.1 port; absolute paths). */
  readonly reader: ResearchFileReader
  /** Atomic write port (WP-1.3 `PlanFileWriter`; compensation 回写). */
  readonly writer: PlanFileWriter
  /** Frozen declarative schema dir (schema/declarative; common in its parent). */
  readonly schemaDir: string
  /** Git wrapper options (timeout / executable / output cap). */
  readonly git?: GitOptions
  /** Max in-flight W3 `hash-object` processes per closure recompute. */
  readonly concurrency?: number
  /** Clock for selected_at/dismissed_at/occurred_at (A-3 epoch ms; tests inject). */
  readonly now?: () => number
}

/**
 * The structural store face this service persists through (ARCHITECTURE §2.2
 * 注入结构端口 pattern — 同 WP-3.2 `PlanForkStoreFace`)。生产 = WP-3.1
 * `PlanForkStore`（乐观门 + 同事务账本 + no-delete trigger）；测试可换
 * 忠实假件做失败注入。**无 delete 面**（INV-PLAN-4）；**无 create 面**
 * （创建属 WP-3.1/3.2 — 本服务只物化/关闭已有 PF）。
 */
export interface PlanForkSelectStoreFace {
  /** One record by id (`null` when absent). */
  getPlanFork(id: string): PlanForkRecord | null
  /** List by (workstreamId?, status?) — stable order (created_at ASC, id ASC). */
  listPlanForks(filter?: { readonly workstreamId?: string; readonly status?: PlanForkRecord['status'] }): PlanForkRecord[]
  /** Execute ONE legal §10 transition (乐观条件更新 + 同事务 ManagementAction). */
  transition(id: string, target: PfTransition, actor: ActorRef): PlanForkRecord
}

/* ------------------------------------------------------------------ *
 * Materialization output (formula + service 共用)
 * ------------------------------------------------------------------ */

/**
 * One §6.2 materialized NEW item（正式 ID + 定义文件路径 + 原 spec）。
 * `kind` 用 PF 词汇（TASK/GATE/MILESTONE — 冻结 schema 拼写）；`path` 为
 * `.research`-relative POSIX 路径（`<wsDir>/items/<dir>/<id>.yaml`）。
 */
export interface MaterializedItem {
  readonly id: string
  readonly kind: PlanForkItemKind
  readonly path: string
  readonly spec: NewItemSpec
}

/** The §6.3 修正版公式的完整输出（formula.ts 纯函数 + 服务复用）。 */
export interface NewPlanResult {
  /** The final `ordered_items` sequence（KEEP refs + NEW 正式 ID, 位置即 §6.3 拼接结果）。 */
  readonly newOrder: readonly string[]
  /** One formal id per `NEW` proposed item（proposed 顺序; proposedIndex 定位）。 */
  readonly newItems: readonly { readonly proposedIndex: number; readonly kind: PlanForkItemKind; readonly id: string }[]
  /** 离开 ordered_items 的 canonical ids（开区间内未被 KEEP 引用；定义文件保留 — INV-PLAN-9）。 */
  readonly removedIds: readonly string[]
  /** KEEP 引用的 ids（proposed 顺序）。 */
  readonly keptIds: readonly string[]
  /** The resolved anchor pair (re-exported for callers). */
  readonly resolution: AnchorResolution
}

/* ------------------------------------------------------------------ *
 * SELECT outcome（§6 全步的结构化结果）
 * ------------------------------------------------------------------ */

/**
 * `select(pfId, actor)` 成功结果（§6 各步的机械产物 — 含 §6.7 的
 * checkpoint 提示文案；resulting commit OID 归 CHECKPOINT_SAVED 账本行，
 * 由用户显式保存 checkpoint 时记录 — INV-GIT-2）。
 */
export interface SelectOutcome {
  readonly pfId: string
  readonly workstreamId: string
  readonly statusBefore: 'OPEN'
  readonly statusAfter: 'SELECTED'
  readonly selectedAt: number
  readonly selectedBy: ActorRef
  /** 物化前的 canonical 顺序（快照）。 */
  readonly oldOrder: readonly string[]
  /** §6.3 拼接结果（物化后 plan.yaml 的 ordered_items）。 */
  readonly newOrder: readonly string[]
  /** §6.2 物化的 NEW items（正式 ID + 路径 + spec）。 */
  readonly newItems: readonly MaterializedItem[]
  /** 离开计划的 canonical ids（定义文件保留 — INV-PLAN-9）。 */
  readonly removedIds: readonly string[]
  /** §6.5 连锁失效的其余 OPEN PF（同 workstream）。 */
  readonly staleOthers: readonly { readonly pfId: string; readonly stale_reason: string }[]
  /** 物化后新 closure 的 working-copy blob OID（§6.6 PF_SELECTED 账本行同集）。 */
  readonly newClosure: readonly BasePlanObject[]
  /** 重写后的 plan.yaml（`.research`-relative POSIX）。 */
  readonly planYamlPath: string
  /** §6.7 提示文案（显式、可选、绝不自动 — INV-GIT-2）。 */
  readonly checkpointHint: string
}

/* ------------------------------------------------------------------ *
 * DISMISS outcome（§7）
 * ------------------------------------------------------------------ */

export interface DismissOutcome {
  readonly pfId: string
  readonly workstreamId: string
  /** §7 允许的来源态（OPEN 或 STALE）。 */
  readonly statusBefore: 'OPEN' | 'STALE'
  readonly statusAfter: 'DISMISSED'
  readonly dismissedAt: number
  readonly dismissedBy: ActorRef
}

/* ------------------------------------------------------------------ *
 * 崩溃一致性审计（goal 4: 重启后 plan.yaml 与 PF 状态不符的检测）
 * ------------------------------------------------------------------ */

/**
 * 审计条目分类：
 *  - `OK`               — 当前闭包 == PF.base_plan_objects（基准未失真）；
 *  - `BASIS_STALE`      — 基准失真（闭包差异），但**不是**本 PF 物化的
 *    崩溃签名（用户编辑等 — 信息性，§5 stale 为 information-only）；
 *  - `CRASH_INCOMPLETE` — **崩溃签名命中**：当前 plan.yaml 恰为本 PF 的
 *    §6.3 物化形态（新 item 定义文件在盘、created_by=AGENT/<run>、位置
 *    分解吻合），而 PF 仍为 OPEN — 文件半边已落、DB 半边丢失（进程死在
 *    plan.yaml 写与 DB 事务之间）。**违规**：审计大声抛错，不静默修复；
 *  - `UNVERIFIABLE`     — plan 缺失/不一致（mid-edit），崩溃签名不可
 *    证明（信息性 — 复核面走 §5 宽松闭包判定）。
 */
export type SelectAuditKind = 'OK' | 'BASIS_STALE' | 'CRASH_INCOMPLETE' | 'UNVERIFIABLE'

export interface SelectAuditEntry {
  readonly pfId: string
  readonly workstreamId: string
  readonly kind: SelectAuditKind
  /** 闭包差异（kind ≠ OK 时）。 */
  readonly diff?: readonly ClosureDiffEntry[]
  /** 崩溃签名命中的 NEW item 正式 ID（proposed 顺序; kind = CRASH_INCOMPLETE 时）。 */
  readonly matchedIds?: readonly string[]
  /** 机械说明（UNVERIFIABLE 的 problem 摘要等）。 */
  readonly note?: string
}

export interface SelectAuditReport {
  /** 受检 OPEN PF 数。 */
  readonly checked: number
  /** 每 PF 一条（store 稳定顺序）。 */
  readonly entries: readonly SelectAuditEntry[]
  /** `entries` 的 CRASH_INCOMPLETE 子集（违规）。 */
  readonly violations: readonly SelectAuditEntry[]
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export type SelectServiceErrorCode =
  /** Malformed argument at the service boundary (options/actor/ids 形状). */
  | 'SELECT_INPUT'
  /** 非 USER actor 调 select/dismiss（INV-PERM-2: SELECT/DISMISS 是用户操作, Agent ❌ — §1 权限表）。 */
  | 'SELECT_ACTOR_NOT_USER'
  /** Git 基础设施失败（闭包重算/物化后捕获）— 零状态变更或已补偿（见消息）。 */
  | 'SELECT_GIT'
  /** 物化前置的 canonical plan 不可用（缺失/不一致 — 防御性, 复核空 diff 后不应出现）。 */
  | 'SELECT_PLAN_INCONSISTENT'
  /** 定义文件/plan.yaml 写失败（plan.yaml 未被触及 ⇒ 无需补偿; 已写的未列入定义文件为合法部分态 — INV-PLAN-9）。 */
  | 'SELECT_WRITE'
  /** 文件半边已成功、DB 事务失败 — 补偿已执行（旧 plan.yaml 字节已原子恢复）; PF 保持 OPEN; 新定义文件保留未列入（合法）; 可重试。 */
  | 'SELECT_DB_FAILED'
  /** 同上, 但并发迁移竞争破坏了事务（点名竞争 PF + 观察态）— 回滚 + 补偿, 可重试。 */
  | 'SELECT_CONCURRENT_STATE'
  /** 补偿失败（DB 失败后恢复旧 plan.yaml 又失败）— 需人工介入（git restore — INV-GIT-8）。 */
  | 'SELECT_COMPENSATION_FAILED'
  /** §6.1 复核基准不一致 — 已自动置 STALE（同事务账本）, 本次 SELECT 拒绝, 差异说明附于错误。 */
  | 'SELECT_REFUSED_STALE'
  /** 崩溃签名命中（文件半边已落 / DB 半边丢失）— 已按 §6.1 自动置 STALE; **不静默修复**（不自动恢复/不自动补 SELECTED）; 报告附于错误。 */
  | 'SELECT_CRASH_INCOMPLETE'
  /** 审计发现 CRASH_INCOMPLETE 违规（重启一致性大声报错面; 报告附于错误）。 */
  | 'SELECT_CONSISTENCY'

/**
 * A select-service violation（ARCHITECTURE §10: 错误信息指明失败项 —
 * precise message, no guess-repair）。领域级失败（PF_NOT_FOUND /
 * PF_WRONG_STATE …）以 WP-3.1 `PlanForkError` 原样穿透 — 本类只覆盖
 * 服务边界条件（同 WP-3.2 StaleServiceError 纪律）。
 *
 * `report`/`diff` 携带结构化产物（崩溃签名报告 / §5 闭包差异）— 调用方
 * 无需解析消息文本。
 */
export class SelectServiceError extends Error {
  readonly code: SelectServiceErrorCode
  /** The §5 closure diff（SELECT_REFUSED_STALE）. */
  readonly diff?: readonly ClosureDiffEntry[]
  /** The structured audit / crash report（SELECT_CRASH_INCOMPLETE / SELECT_CONSISTENCY）. */
  readonly report?: SelectAuditReport

  constructor(code: SelectServiceErrorCode, message: string, options?: { diff?: readonly ClosureDiffEntry[]; report?: SelectAuditReport; cause?: unknown }) {
    super(message, options === undefined || options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'SelectServiceError'
    this.code = code
    if (options !== undefined) {
      if (options.diff !== undefined) this.diff = options.diff
      if (options.report !== undefined) this.report = options.report
    }
  }
}

/** Type guard for `SelectServiceError`. */
export function isSelectServiceError(error: unknown): error is SelectServiceError {
  return error instanceof SelectServiceError
}
