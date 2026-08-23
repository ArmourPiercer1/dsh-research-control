/**
 * WP-7.3 — `AnalysisRecordService` + transient 读取面: type surface.
 *
 * 冻结契约依据（只读）:
 *  - DOMAIN_SCHEMA §12.2（AnalysisRecord — Investigator 分析的持久化形式:
 *    「默认 transient; 仅用户显式保存或被正式 Intervention/Audit/decision
 *    引用时记录」; 字段 `id` / `source_ref: TypedRef`（Intervention / Audit
 *    finding / Brief）/ `investigator_run_id?` / `dsh_session_id?` /
 *    `content`（Markdown）/ `created_at`; §1.1 前缀注册表 `AN` 行:
 *    「用户保存分析时」分配, PROJECT scope）+ §12 Provenance（§12.1
 *    ManagementAction 的 `action_kind` 冻结 15 值枚举**无** AnalysisRecord
 *    行 ⇒ 保存不写 MA 账本 — 不虚构 provenance, 同 WP-5.5 GAP 纪律;
 *    source_ref 的引用关系 = 冻结 `typedRef` 形状）+ §13（无 AnalysisRecord
 *    状态机行 — 记录是保存时点快照, 无迁移面）+ §15（`analysis_record`
 *    表: PK `id`, 无关键索引; 通则不 hard delete — INV-HIST-7）+ §16
 *    （引用完整性: source_ref = 写入时校验的 TypedRef — 形状冻结网
 *    复验; 悬挂引用容错展示, 写入失败 = 拒绝）;
 *  - schema/operational/provenance.schema.json（`$defs/AnalysisRecord`
 *    冻结行形状 — 4 必填 id/source_ref/content/created_at,
 *    additionalProperties:false, content minLength 1,
 *    `investigator_run_id` = 冻结 `idRun` 模式 `^R-[1-9][0-9]*$`）;
 *  - ARCHITECTURE §5.9 **INV-PERM-3**（Investigator Agent 完全只读;
 *    输出默认 transient, **仅用户显式保存**才落 AnalysisRecord — R+T:
 *    本文件的双面门 = 类型面 `UserActorRef` 参数（非 USER = 编译错误）+
 *    运行面 `assertUserActor`（伪造 ⇒ AN_ACTOR_FORBIDDEN, 零写入 —
 *    同 WP-5.1 INV-PERM-4 / WP-6.4 转换面先例））+ §6 权限矩阵
 *    （INVESTIGATOR 列全 ❌ — Agent 无任何落 AnalysisRecord 路径）;
 *  - 计划书 §26.2（输出: 默认 transient; 仅用户明确保存或其分析被正式
 *    引用时记录 AnalysisRecord — 本 WP 交付「用户明确保存」的落地面）;
 *  - 上游交付面: WP-7.1 `InvestigatorLaunchResult.sessionId`（launcher
 *    的会话指针 — transient 面的数据入口）/ WP-2.6 sessionlink
 *    `SessionPointer`（INV-DB-2 指针行 — 读取面, 不复制 raw log）/
 *    WP-0.4 `DshSessionAdapter.listSessions`（live session 摘要 — 只读）/
 *    WP-2.4 run 表 `dsh_session_id` 关联面（§6.1 记录面）。
 *
 * ## transient 数据面（任务目标 1）
 *
 * 数据来源链（任务书逐字: 「launcher 的会话指针 → sessionlink 读取面」）:
 * `InvestigatorLaunchResult.sessionId`（launcher 会话指针）→
 * `AnalysisTransientReader.read(sessionId)` → 三个**只读**端口:
 * sessionlink 指针行（`pointerOf` — INV-DB-2 唯一绑定真值）+ live session
 * 摘要（`listSessions` — WP-0.4 端口面）+ run 行（`runs` —
 * `dsh_session_id` 关联, 每 session 至多一条）。
 *
 * **零写入的类型面断言**: `AnalysisTransientReaderInput` 接口的成员集合
 * 全是读操作（不存在任何 run/exec/insert/set 成员 — 写能力在该面上
 * **无法表达**）; `AnalysisTransientReader` 类只有 `read` 一个公开方法
 * （原型面测试钉死 — 无写方法存在, 同 WP-7.1 请求闭集纪律的读面对偶）。
 * transient 路径不落**任何** operational 表（默认 transient — INV-PERM-3;
 * 唯一的落库面是下面的用户显式保存）。
 *
 * Layer (ARCHITECTURE §2.2): service — 唯一写 operational DB 的层（仅
 * `saveAsAnalysisRecord` 一个写入口, 用户门）。无 DSH import (INV-PERM-5)。
 */

import type { TypedRef } from '../../history/registry/index.js'
import type { SessionPointer } from '../sessionlink/index.js'
import type { SessionSummary } from '../../../shared/host-adapter-ports.js'
import type { IdAllocator } from '../../../shared/ids/index.js'
import type { AnalysisStore } from './store.js'

/* ------------------------------------------------------------------ *
 * 冻结 id 模式（common.schema.json — 同 inbox IN_/MA_ 常量先例）
 * ------------------------------------------------------------------ */

/** 冻结 AN id 模式（common.schema.json `idAnalysisRecord`）。 */
export const AN_ID_PATTERN = /^AN-[1-9][0-9]*$/

/** 冻结 R id 模式（common.schema.json `idRun` — investigator_run_id）。 */
export const RUN_ID_PATTERN = /^R-[1-9][0-9]*$/

/** 冻结 typedRef id 模式（common.schema.json `typedRef.id`）。 */
export const TYPED_REF_ID_PATTERN = /^[A-Z]+-[1-9][0-9]*$/

/* ------------------------------------------------------------------ *
 * 行记录（冻结 provenance.schema.json $defs/AnalysisRecord 同构 —
 * SQL 侧类型面; snake_case 与冻结 schema 同形 — 落库前整行过真实
 * 冻结形状网, 同 WP-3.5/WP-5.1/WP-6.4 先例）
 * ------------------------------------------------------------------ */

/**
 * One analysis_record row（§12.2 字段表逐字; 保存时点快照 — 创建后
 * 全字段不可变, §13 无状态机行）。
 */
export interface AnalysisRecordRecord {
  /** AN id（common.schema.json `idAnalysisRecord`; 用户保存时分配, §1.1）。 */
  readonly id: string
  /**
   * 来源引用（§12.2: Intervention / Audit finding / Brief — 冻结
   * `typedRef` 形状; kind = 冻结 24 值 ObjectKind 之一: Intervention =
   * `INTERVENTION` ref; Audit finding = 承载它的 `INBOX_ITEM` ref
   * （source UNCLASSIFIED_AUDIT_FINDING）; Brief = 其底层声明式对象 ref
   * （INV-ATTN-3: Brief 是 projection 非 source of truth）— 形状面
   * 不限制 kind 集合, 语义归调用方, 冻结网复验）。
   */
  readonly source_ref: TypedRef
  /** 正式 Run（R-<n>; 可选 — investigator 会话绑定 formal run 时携带）。 */
  readonly investigator_run_id?: string
  /** DSH session id（可选 — launcher 会话指针的持久化引用; INV-DB-2:
   *  只存指针, 不复制 raw log）。 */
  readonly dsh_session_id?: string
  /** 分析内容（Markdown — §12.2 必填, 冻结 schema minLength 1）。 */
  readonly content: string
  /** epoch ms（§1.2, A-3 修订 — 单次采样纪律）。 */
  readonly created_at: number
}

/* ------------------------------------------------------------------ *
 * 形状网面（冻结 provenance.schema.json 装载 — schemas.ts）
 * ------------------------------------------------------------------ */

export interface AnalysisSchemaError {
  readonly path: string
  readonly message: string
}

export interface AnalysisShapeCheck {
  readonly ok: boolean
  readonly errors: readonly AnalysisSchemaError[]
}

export interface AnalysisSchemas {
  readonly schemaDir: string
  readonly isUsable: boolean
  readonly loadErrors: readonly AnalysisSchemaError[]
  /** 整行冻结形状网（$defs/AnalysisRecord; additionalProperties:false）。 */
  readonly checkAnalysisShape: (record: AnalysisRecordRecord) => AnalysisShapeCheck
}

/* ------------------------------------------------------------------ *
 * Actor faces（INV-PERM-3 类型面 — 用户显式保存的编译期半边）
 * ------------------------------------------------------------------ */

/**
 * USER actor ref（冻结 `actorRef` 限制到 kind=USER）。`saveAsAnalysisRecord`
 * 的参数类型: 非 USER actor（AGENT/PLUGIN/SYSTEM — 含 Investigator Agent
 * 自身的任何化身）是 **COMPILE 错误**（INV-PERM-3「仅用户显式保存才落
 * AnalysisRecord」的类型面 — 同 WP-5.1/WP-6.4 `UserActorRef` 先例）;
 * 运行时伪造（cast）仍被 AN_ACTOR_FORBIDDEN 拒绝（运行面, 零写入）。
 */
export interface UserActorRef {
  readonly kind: 'USER'
  readonly user_id?: string
  readonly label?: string
}

/** The default user actor for GUI operations (matrix column U). */
export const USER_ACTOR: UserActorRef = { kind: 'USER', label: 'user' }

/* ------------------------------------------------------------------ *
 * 保存面（用户显式 — 唯一落库入口）
 * ------------------------------------------------------------------ */

/** 保存参数（§12.2 内容半边; id/created_at 由 service 分配/置位）。 */
export interface SaveAnalysisRecordParams {
  /** 来源引用（必填 — 冻结 typedRef; 形状网 + kind 闭集运行时复验）。 */
  readonly sourceRef: TypedRef
  /** 分析内容（Markdown — 非空, 冻结 schema minLength 1）。 */
  readonly content: string
  /** 正式 Run id（R-<n>; 可选 — investigator 会话绑定的 run, 若存在）。 */
  readonly investigatorRunId?: string
  /** DSH session id（可选 — launcher 会话指针; 只存指针, INV-DB-2）。 */
  readonly dshSessionId?: string
}

export interface SaveAnalysisRecordResult {
  readonly record: AnalysisRecordRecord
}

/* ------------------------------------------------------------------ *
 * 查询面（无隐藏过滤器 — INV-ATTN-1 同款纪律）
 * ------------------------------------------------------------------ */

/** 列表过滤（显式指名才过滤; 全缺省 = 全量 — 稳定顺序 created_at ASC,
 *  id ASC — §15 无索引, 全序兜底即 id）。 */
export interface AnalysisListFilter {
  /** 按 source_ref.kind 过滤（缺省 = 不过滤）。 */
  readonly sourceKind?: string
  /** 按 source_ref.id 过滤（缺省 = 不过滤）。 */
  readonly sourceId?: string
}

/* ------------------------------------------------------------------ *
 * transient 读取面（任务目标 1 — 只读, 零写入的类型面）
 * ------------------------------------------------------------------ */

/**
 * run 表 face 行形状（`dsh_session_id` 关联所需的最小面 — 同 WP-7.2
 * `SessionQueryRunRow` 口径; 生产 = WP-2.4 `RunBindingTables.listRuns`）。
 */
export interface TransientRunRow {
  readonly id: string
  readonly workstreamId: string
  readonly status: string
  readonly startedAt: number
  readonly endedAt: number | null
}

/**
 * transient 读取面的输入端口（**全读** — INV-PERM-3 零写入的类型面:
 * 该接口不存在任何写成员, 写能力在此面上无法表达）。
 *
 * 生产接线（wiring WP）:
 *  - `pointerOf` = `SessionLinkService.pointerOf`（meta KV 直读 — 不订阅
 *    事件流, 纯读取; 未绑定 = null 诚实透出, 不虚构绑定, 同 WP-7.2 口径）;
 *  - `listSessions` = `DshSessionAdapter.listSessions`（WP-0.4 端口面 —
 *    只读列出 live session 摘要, 不进 session 内容 — INV-DB-2）;
 *  - `runs` = run 表 `dshSessionId` 过滤面（每 session 至多一条 formal
 *    run — §6.1）。
 */
export interface AnalysisTransientReaderInput {
  /** sessionlink 指针面（`SessionLinkService.pointerOf` — 未绑定 = null）。 */
  readonly pointerOf: (sessionId: string) => SessionPointer | null
  /** DSH live session 摘要列表（`DshSessionAdapter.listSessions` 端口面）。 */
  readonly listSessions: () => readonly SessionSummary[]
  /** run 表查询面（`dshSessionId` 过滤 — 每 session 至多一条 run）。 */
  readonly runs: (filter: { readonly dshSessionId: string }) => readonly TransientRunRow[]
}

/**
 * 一个 investigator 会话的 transient 快照（GUI transient 面板的数据面 —
 * 只读渲染; 全部字段来自注入的只读端口, 零 operational 表写入）。
 *
 * 诚实透出（不虚构）: `session = null`（live 列表无此 id — 会话已 dispose）/
 * `pointer = null`（未绑定 workstream — investigator 会话通常**不**绑定:
 * 它是一次性只读调查, 非 formal Run 载体 — 绑定语义归 runbinding, 此处
 * 只透出指针面的真值）/ `run = null`（无 formal run 关联）。
 */
export interface AnalysisTransientSnapshot {
  /** 读取入口（launcher 的会话指针 — `InvestigatorLaunchResult.sessionId`）。 */
  readonly sessionId: string
  /** live session 摘要（缺席 = null — 会话不在 live 列表）。 */
  readonly session: SessionSummary | null
  /** sessionlink 指针行（缺席 = null — INV-DB-2 唯一持久绑定面）。 */
  readonly pointer: SessionPointer | null
  /** formal run 行（缺席 = null — 每 session 至多一条）。 */
  readonly run: TransientRunRow | null
}

/* ------------------------------------------------------------------ *
 * Error taxonomy
 * ------------------------------------------------------------------ */

export type AnalysisErrorCode =
  /** 模块边界参数畸形（空 content / 坏 source_ref 形状 / 坏 R id / 空
   *  sessionId / 端口缺位 — 精确指名失败项）。 */
  | 'AN_INPUT'
  /** 记录不存在（查询面指名 id 缺席 — 与 transient 面 null 语义区分:
   *  查询面是「按 id 指名取」的语义, 缺席是正常结果 null; 本码用于
   *  服务内部一致性失败, 如保存后回读丢失）。 */
  | 'AN_NOT_FOUND'
  /** INV-PERM-3 运行面: 非 USER actor 触达保存面（Agent 保存被拒 —
   *  零写入; 类型面 `UserActorRef` 是编译期半边）。 */
  | 'AN_ACTOR_FORBIDDEN'
  /** `analysis_record` 行操作 / transient 读取面失败（驱动/SQL/形状网/
   *  只读端口 包一层, cause 保留）。 */
  | 'AN_STORE'

export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode
  constructor(init: { code: AnalysisErrorCode; message: string; cause?: unknown }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'AnalysisError'
    this.code = init.code
  }
}

export function isAnalysisError(error: unknown): error is AnalysisError {
  return error instanceof AnalysisError
}

/* ------------------------------------------------------------------ *
 * Service options（DI 面 — 同 WP-2.4 / WP-3.5 / WP-5.1 / WP-6.4 模式）
 * ------------------------------------------------------------------ */

/** `AnalysisRecordService` 构造选项（宿主接线 WP 组装; 测试 = 真实冻结面
 *  + 真实 sqlite + 假端口）。 */
export interface AnalysisServiceOptions {
  /** 本 WP 行面（`analysis_record` 表 — insert + 查询; DDL 幂等应用在其
   *  构造时; 无 delete/update — INV-HIST-7 + 快照不可变）。 */
  readonly store: AnalysisStore
  /** 共享 id allocator（AN 族, §1.1 规则 2）。 */
  readonly allocator: IdAllocator
  readonly projectId: string
  /** 时钟（A-3 epoch ms; 默认 Date.now; 单次采样纪律）。 */
  readonly now?: () => number
}
