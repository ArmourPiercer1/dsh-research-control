/**
 * WP-5.2 — 人类注意力层三对象（Objective / NextAction / Explicit Blocker）
 * 共享类型面（任务书「三对象合一模块」的公共基座）。
 *
 * 冻结契约依据（逐字核对原文）:
 *  - DOMAIN_SCHEMA §9.3 NextAction（字段表 + §13 状态机
 *    「PROPOSED → PROMOTED | DISMISSED（终态）；PROMOTE 仅用户」）；
 *  - DOMAIN_SCHEMA §9.4 Explicit Blocker（字段表 + §13 状态机
 *    「ACTIVE → CLEARED（终态；复发 = 新 Blocker）」）；
 *  - DOMAIN_SCHEMA §9.1 Objective（声明式 `.research/objectives.yaml`；
 *    §13 「ACTIVE → ACHIEVED | DROPPED（仅用户）」）——loader 已能加载
 *    （WP-1.1 `ObjectiveDoc`），本模块补**变更服务面**（原子写）；
 *  - schema/operational/attention.schema.json `$defs/NextAction` /
 *    `$defs/Blocker`（行形状机器真源，additionalProperties:false；
 *    本模块 DDL 列集与其逐字同构 — 同 WP-3.5 intervention 先例）；
 *  - ARCHITECTURE §6 权限矩阵（PROMOTE 类仅用户的原文核对，见
 *    state-machine.ts 头注）+ §5.9 INV-PERM-1（Agent 可写闭集 —
 *    Blocker 不在其中 ⇒ USER-only）；
 *  - HISTORY_EVENT_CATALOG §4/§5.7：**无** NextAction/Blocker/Objective
 *    事件（20 事件目录逐条核对；§5.7 人类注意力仅 INTERVENTION_CREATED）
 *    ⇒ 本模块**不构造 History 事件**（同 WP-3.1「CATALOG 无
 *    PLAN_FORK_* 事件」核查口径）；provenance 走 `management_action`
 *    账本中冻结枚举**已有**的 `OBJECTIVE_EDITED`（§12.1，唯一适用于
 *    三对象的 kind — 无 NA_* 与 BLK_* kind，冻结枚举不可扩）；NA/BLK 的
 *    行即记录（created_by/created_at + 状态缓存列）。
 *
 * 分层（ARCHITECTURE §2.2 rule 1）: 本目录是 service 层 — 驱动是注入的
 * `ActionsDb` 结构端口（同 planfork/flooding 双连接模式），域层
 * `ResearchFileReader` / `PlanStore` 经注入消费，本模块零 DSH import
 * （INV-PERM-5）、零 sqlite import。
 */

import type { ActorRef } from '../../domain/planfork/index.js'

/** ActorRef 重导出（模块公共面单一来源 — 冻结 actorRef 形状）。 */
export type { ActorRef }

/* ------------------------------------------------------------------ *
 * Row records（冻结 $defs 行形状 — attention.schema.json 逐字同构）
 * ------------------------------------------------------------------ */

/** NextAction 状态（DOMAIN_SCHEMA §13：`PROPOSED → PROMOTED | DISMISSED`，双终态）。 */
export type NaStatus = 'PROPOSED' | 'PROMOTED' | 'DISMISSED'

/** Objective 状态（DOMAIN_SCHEMA §13：`ACTIVE → ACHIEVED | DROPPED`，仅用户）。 */
export type ObjStatus = 'ACTIVE' | 'ACHIEVED' | 'DROPPED'

/**
 * One `next_action` row（§9.3 字段表逐字；snake_case = 冻结 $defs 键名）。
 * `workstream_id` 可选（§9.3 ❌）；`promoted_to_task_id` 仅 PROMOTED 时
 * 存在（DDL CHECK 共现钉死）。
 */
export interface NextActionRecord {
  readonly id: string
  readonly workstream_id?: string
  readonly statement: string
  readonly rationale?: string
  readonly status: NaStatus
  readonly promoted_to_task_id?: string
  /** 创建者（USER 或 AGENT — 矩阵行「NextAction 创建 ✅/✅」）。 */
  readonly created_by: ActorRef
  /** epoch ms（§1.2/A-3）。 */
  readonly created_at: number
}

/** Blocker 状态（DOMAIN_SCHEMA §13：`ACTIVE → CLEARED`，终态）。 */
export type BlkStatus = 'ACTIVE' | 'CLEARED'

/**
 * `Blocker.affects` 元素（§9.4：TypedRef，kind 限 WS/T/R —
 * attention.schema.json `$defs/Blocker.affects` 冻结枚举）。
 */
export interface AffectsRef {
  readonly kind: 'WORKSTREAM' | 'TASK' | 'RUN'
  readonly id: string
}

/** One `blocker` row（§9.4 字段表逐字；`cleared_at` 仅 CLEARED 时存在）。 */
export interface BlockerRecord {
  readonly id: string
  readonly statement: string
  readonly affects: AffectsRef[]
  readonly status: BlkStatus
  /** 来源说明（§9.4 必填）。 */
  readonly source: string
  readonly references?: string[]
  /** epoch ms（§1.2/A-3）。 */
  readonly created_at: number
  readonly cleared_at?: number
}

/* ------------------------------------------------------------------ *
 * DB port（结构端口 — 同 WP-3.1 planfork `PlanForkDb` 先例）
 * ------------------------------------------------------------------ */

/** 驱动注入面（node:sqlite DatabaseSync 使用面；wiring/tests 各自适配）。 */
export type ActionsDb = import('../../domain/planfork/index.js').PlanForkDb

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/**
 * 结构化错误码（稳定 — 调用方/测试按码分支）:
 *  - `ACT_INPUT`        — 输入面校验（字段形状/枚举/必填，逐字段消息）；
 *  - `NA_NOT_FOUND` / `NA_WRONG_STATE` — §13 守卫 + 乐观门 0 行判别；
 *  - `NA_ACTOR`         — 创建面 actor 泳道（USER|AGENT；AGENT 需 run_id）；
 *  - `BLK_NOT_FOUND` / `BLK_WRONG_STATE` / `BLK_ACTOR` / `BLK_REF_MISSING`
 *                        — 同型；BLK_ACTOR = Blocker 全泳道 USER-only
 *                          （INV-PERM-1 闭集外）；BLK_REF_MISSING = §16.3
 *                          「写入新引用时失败 = 拒绝」；
 *  - `OBJ_NOT_FOUND` / `OBJ_WRONG_STATE` / `OBJ_ACTOR` / `OBJ_FILE` /
 *    `OBJ_STORE`        — Objective 声明式面（OBJ_FILE = 文件/校验/补偿
 *                          失败；OBJ_STORE = 账本落库失败，文件已在盘 —
 *                          手动对账，同 reorderPlan 先例）；
 *  - `PROMOTE_INPUT` / `PROMOTE_PLAN` / `PROMOTE_CONCURRENT` /
 *    `PROMOTE_DB_FAILED` / `PROMOTE_COMPENSATION_FAILED` — PROMOTE 物化流
 *    （§9.3「转正为 Task」— 同 WP-3.4 SELECT 物化/补偿纪律）；
 *  - `STORE`            — 驱动/SQL 失败包装（cause 保留）。
 */
export type ActionsErrorCode =
  | 'ACT_INPUT'
  | 'NA_NOT_FOUND'
  | 'NA_WRONG_STATE'
  | 'NA_ACTOR'
  | 'BLK_NOT_FOUND'
  | 'BLK_WRONG_STATE'
  | 'BLK_ACTOR'
  | 'BLK_REF_MISSING'
  | 'OBJ_NOT_FOUND'
  | 'OBJ_WRONG_STATE'
  | 'OBJ_ACTOR'
  | 'OBJ_FILE'
  | 'OBJ_STORE'
  | 'PROMOTE_INPUT'
  | 'PROMOTE_PLAN'
  | 'PROMOTE_CONCURRENT'
  | 'PROMOTE_DB_FAILED'
  | 'PROMOTE_COMPENSATION_FAILED'
  | 'STORE'

/** 本模块的唯一错误载体（caller-owned — 同 PlanForkError 纪律）。 */
export class ActionsError extends Error {
  readonly code: ActionsErrorCode

  constructor(code: ActionsErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ActionsError'
    this.code = code
  }
}

/* ------------------------------------------------------------------ *
 * 冻结 ID 形状（common.schema.json 模式 — 写入前形状校验）
 * ------------------------------------------------------------------ */

export const ID_PATTERNS = {
  ws: /^WS-[1-9][0-9]*$/,
  task: /^T-[1-9][0-9]*$/,
  run: /^R-[1-9][0-9]*$/,
  objective: /^OBJ-[1-9][0-9]*$/,
} as const

/** 冻结 actorRef 形状校验（common.schema.json：kind 枚举；run_id 前缀；label ≤200）。 */
export function assertActorShape(actor: unknown, context: string): asserts actor is ActorRef {
  if (actor === null || typeof actor !== 'object' || typeof (actor as ActorRef).kind !== 'string' ||
      !['USER', 'AGENT', 'PLUGIN', 'SYSTEM'].includes((actor as ActorRef).kind)) {
    throw new ActionsError('ACT_INPUT', `${context}: actor must be a frozen actorRef (kind ∈ USER|AGENT|PLUGIN|SYSTEM; got ${JSON.stringify(actor)})`)
  }
  const a = actor as ActorRef
  if (a.run_id !== undefined && !ID_PATTERNS.run.test(a.run_id)) {
    throw new ActionsError('ACT_INPUT', `${context}: actor.run_id ${JSON.stringify(a.run_id)} is not a well-formed R id (common.schema.json actorRef)`)
  }
  if (a.label !== undefined && (typeof a.label !== 'string' || a.label.length > 200)) {
    throw new ActionsError('ACT_INPUT', `${context}: actor.label must be a string of ≤200 chars (common.schema.json actorRef)`)
  }
}
