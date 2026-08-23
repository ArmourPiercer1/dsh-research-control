/**
 * WP-5.2 — 三对象状态机纯守卫 + 权限泳道（DOMAIN_SCHEMA §13 逐字实现）。
 *
 * §13 转换表（原文, 本模块逐字对齐）:
 *   | NextAction | `PROPOSED → PROMOTED \| DISMISSED`（终态）；PROMOTE 仅用户 |
 *   | Blocker    | `ACTIVE → CLEARED`（终态；复发 = 新 Blocker） |
 *   | Objective  | `ACTIVE → ACHIEVED \| DROPPED`（仅用户） |
 *
 * 「非法转换在 service 层拒绝，INV-TASK-1」— 本模块是纯逻辑守卫（零 I/O、
 * 零时钟）: 非法 from→to 抛 `*_WRONG_STATE`（消息点名当前态 + 合法集）;
 * 自环（from=to）同样非法（状态机面无 no-op 迁移 — 同 WP-3.5
 * `checkInterventionTransition` 先例）。
 *
 * 权限面（ARCHITECTURE §6 actor capability matrix 原文核对 — 任务书
 * 「PROMOTE 类操作仅用户——查原文确认哪些对象有 PROMOTE」的核对结论）:
 *
 *   矩阵行（§6 表格逐字）:
 *     「NextAction 创建          | ✅ | ✅ | ❌ | ❌」
 *     「NextAction PROMOTE/DISMISS | ✅ | ❌ | ❌ | ❌」
 *   ① **PROMOTE 仅存在于 NextAction**（§6 唯一含 PROMOTE 的行; §9.3 原文
 *      「用户才 PROMOTE（转正为 Task）/DISMISS」）;
 *   ② Blocker 在 §6 **无矩阵行** — 但 §5.9 INV-PERM-1 是闭集（「Agent 可写
 *      **仅限**：Fact/Claim/Artifact 注册、Intervention 创建、NextAction
 *      创建、PlanFork 创建、Run checkpoint 报告」）⇒ Blocker 创建/清除对
 *      Agent 关闭; PLUGIN 列同样无 Blocker 授权行 ⇒ **Blocker 全泳道
 *      USER-only**（保守解读, 登记于报告「实现要点」§2）;
 *   ③ Objective 状态迁移 §13 原文「仅用户」; 声明式文件编辑是
 *      「创建/编辑 … manifest」语义的用户面（§6 首行 ✅/❌/❌/❌）
 *      ⇒ **Objective 全泳道 USER-only**。
 *
 * 泳道校验函数（运行时断言 — RPC 面把客户端视为 USER 面, 工具面把 Agent
 * 限在创建面; 本层是业务代码内的最后门, 同 WP-3.4 `assertUserActor` 先例）:
 *   - `assertUserActor`        — kind === USER（裸 `{ kind: 'USER' }` 合法）;
 *   - `assertNextActionCreator`— kind ∈ USER|AGENT（矩阵行①）; AGENT 必须
 *     携 run_id（agentRef 冻结形状 + §1「Agent 发射的事件校验
 *     actor.run_id 对应 Run 存在」的 Run 存在性归 service 层的
 *     runExists 缝 — 本层只钉形状）。
 */

import type { ActorRef, BlkStatus, NaStatus, ObjStatus } from './types.js'
import { ActionsError, assertActorShape } from './types.js'

/* ------------------------------------------------------------------ *
 * 状态词表（冻结枚举 — 与 attention.schema.json / objectives.schema.json 逐字）
 * ------------------------------------------------------------------ */

export const NA_STATUSES: readonly NaStatus[] = ['PROPOSED', 'PROMOTED', 'DISMISSED'] as const
export const BLK_STATUSES: readonly BlkStatus[] = ['ACTIVE', 'CLEARED'] as const
export const OBJ_STATUSES: readonly ObjStatus[] = ['ACTIVE', 'ACHIEVED', 'DROPPED'] as const

export function isNaStatus(v: unknown): v is NaStatus {
  return typeof v === 'string' && (NA_STATUSES as readonly string[]).includes(v)
}
export function isBlkStatus(v: unknown): v is BlkStatus {
  return typeof v === 'string' && (BLK_STATUSES as readonly string[]).includes(v)
}
export function isObjStatus(v: unknown): v is ObjStatus {
  return typeof v === 'string' && (OBJ_STATUSES as readonly string[]).includes(v)
}

/* ------------------------------------------------------------------ *
 * §13 纯守卫（非法转换拒绝 — INV-TASK-1）
 * ------------------------------------------------------------------ */

/** NextAction 合法迁移集（§13 行原文; 双终态）。 */
const NA_TRANSITIONS: Record<NaStatus, readonly NaStatus[]> = {
  PROPOSED: ['PROMOTED', 'DISMISSED'],
  PROMOTED: [],
  DISMISSED: [],
}

/** Blocker 合法迁移集（§13 行原文; CLEARED 终态, 复发 = 新行）。 */
const BLK_TRANSITIONS: Record<BlkStatus, readonly BlkStatus[]> = {
  ACTIVE: ['CLEARED'],
  CLEARED: [],
}

/** Objective 合法迁移集（§13 行原文; ACHIEVED/DROPPED 终态, 仅用户）。 */
const OBJ_TRANSITIONS: Record<ObjStatus, readonly ObjStatus[]> = {
  ACTIVE: ['ACHIEVED', 'DROPPED'],
  ACHIEVED: [],
  DROPPED: [],
}

function guard<T extends string>(
  code: 'NA_WRONG_STATE' | 'BLK_WRONG_STATE' | 'OBJ_WRONG_STATE',
  objectName: string,
  id: string,
  from: T,
  to: T,
  legal: Record<T, readonly T[]>,
): void {
  const allowed = legal[from]
  if (allowed.includes(to)) return
  throw new ActionsError(
    code,
    `${objectName} ${JSON.stringify(id)}: illegal ${from} → ${to} (DOMAIN_SCHEMA §13: from ${from} the legal targets are [${allowed.join(', ')}] — 终态无出边)`,
  )
}

/** §13 NextAction 行: `PROPOSED → PROMOTED | DISMISSED`（终态; PROMOTE 仅用户）。 */
export function checkNextActionTransition(id: string, from: NaStatus, to: NaStatus): void {
  guard('NA_WRONG_STATE', 'next action', id, from, to, NA_TRANSITIONS)
}

/** §13 Blocker 行: `ACTIVE → CLEARED`（终态; 复发 = 新 Blocker）。 */
export function checkBlockerTransition(id: string, from: BlkStatus, to: BlkStatus): void {
  guard('BLK_WRONG_STATE', 'blocker', id, from, to, BLK_TRANSITIONS)
}

/** §13 Objective 行: `ACTIVE → ACHIEVED | DROPPED`（仅用户）。 */
export function checkObjectiveTransition(id: string, from: ObjStatus, to: ObjStatus): void {
  guard('OBJ_WRONG_STATE', 'objective', id, from, to, OBJ_TRANSITIONS)
}

/* ------------------------------------------------------------------ *
 * 权限泳道（§6 矩阵 + §5.9 INV-PERM-1 闭集 — 见模块头核对结论）
 * ------------------------------------------------------------------ */

/**
 * USER-only 门（PROMOTE/DISMISS、Blocker 全泳道、Objective 全泳道）。
 * 裸 `{ kind: 'USER' }` 合法（WP-3.4 `assertUserActor` 同款口径 —
 * RPC 面转发的 USER_ACTOR 即此形状）。`code` 供调用方保留对象维度的
 * 错误码（NA_ACTOR / BLK_ACTOR / OBJ_ACTOR）。
 */
export function assertUserActor(actor: unknown, operation: string, code: 'NA_ACTOR' | 'BLK_ACTOR' | 'OBJ_ACTOR' = 'NA_ACTOR'): asserts actor is ActorRef {
  assertActorShape(actor, operation)
  if (actor.kind !== 'USER') {
    throw new ActionsError(
      code,
      `${operation}: user-only operation (ARCHITECTURE §6 矩阵 / INV-PERM-1 闭集 / §13「仅用户」) — actor.kind is ${JSON.stringify(actor.kind)}, expected USER`,
    )
  }
}

/**
 * NextAction 创建面泳道（§6 行「NextAction 创建 | ✅ | ✅ | ❌ | ❌」）:
 * USER 或 AGENT; AGENT 必须携 well-formed run_id（R-<n>）。
 * （INV-PERM-1: 创建 NextAction 在 Agent 可写闭集内; PLUGIN/SYSTEM 无授权行。）
 */
export function assertNextActionCreator(actor: unknown, operation: string): asserts actor is ActorRef {
  assertActorShape(actor, operation)
  if (actor.kind === 'USER') return
  if (actor.kind === 'AGENT') {
    if (typeof actor.run_id !== 'string') {
      throw new ActionsError(
        'NA_ACTOR',
        `${operation}: an AGENT creator must carry its run (actor.run_id, common.schema.json actorRef) — the tool face requires a run-bound context`,
      )
    }
    return
  }
  throw new ActionsError(
    'NA_ACTOR',
    `${operation}: only USER or AGENT may create a NextAction (ARCHITECTURE §6 行「NextAction 创建 ✅/✅/❌/❌」) — actor.kind is ${JSON.stringify(actor.kind)}`,
  )
}
