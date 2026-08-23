/**
 * WP-5.4 — awareness 类型面 + AttentionService 依赖端口。
 *
 * 冻结行形状 = `schema/operational/attention.schema.json` `$defs/Awareness`
 * （3 键: object_ref/state/updated_at, additionalProperties:false）+
 * DOMAIN_SCHEMA §9.5（Human Awareness）+ §15 表映射
 * （`awareness` PK `(object_kind, object_id)`）。
 *
 * 权限矩阵依据（ARCHITECTURE §6, 逐字行）:
 *   「Awareness 状态  ✅  ❌  ❌  ❌」
 * —— awareness 状态**仅用户**可改（INV-PERM-2: Agent 不可动 awareness
 * 状态）。`AwarenessService.setAwareness` 的 actor 门即该行的 API 面落地;
 * 读取面不设 actor 门（V1 无 awareness 读取的 RPC/工具面, host 内部
 * 读取是评分组装与未来用户面的数据源）。
 */

import type { PlanForkDb } from '../../domain/planfork/types.js'

/* -------------------------------------------------------------------- *
 * 冻结枚举（与 schema/operational/attention.schema.json 逐字; 评分器的
 * 零 import 镜像在 scorer.ts, 两处漂移由 tests/attention 钉）
 * -------------------------------------------------------------------- */

/** `Awareness.object_ref.kind` 白名单（INV-ATTN-4: 仅高价值对象）。 */
export const AWARENESS_KINDS = ['CLAIM', 'FACT', 'ARTIFACT', 'MILESTONE', 'INTERVENTION', 'PLAN_FORK'] as const
export type AwarenessKind = (typeof AWARENESS_KINDS)[number]

/** `Awareness.state`（§19.1 四态; 默认 UNSEEN — §9.5）。 */
export const AWARENESS_STATES = ['UNSEEN', 'SEEN', 'REVIEWED', 'ASSESSED'] as const
export type AwarenessState = (typeof AWARENESS_STATES)[number]

/* -------------------------------------------------------------------- *
 * 记录形状（snake_case — 冻结 schema 键逐字; §15 PK 拆列）
 * -------------------------------------------------------------------- */

/** `object_ref`（typedRef 的冻结子型: kind 限白名单 + id）。 */
export interface AwarenessObjectRef {
  readonly kind: AwarenessKind
  readonly id: string
}

/** `awareness` 行（PK (object_kind, object_id); 状态缓存列 state/updated_at）。 */
export interface AwarenessRecord {
  readonly object_kind: AwarenessKind
  readonly object_id: string
  readonly state: AwarenessState
  readonly updated_at: number
}

/* -------------------------------------------------------------------- *
 * actor 面（权限门）
 * -------------------------------------------------------------------- */

/**
 * 通用 actor 入参（frozen `actorRef` 的结构子型 — kind 必填, 其余可选）。
 * 门只判 `kind === 'USER'`（矩阵行「Awareness 状态」: 仅 USER 列 ✅）。
 */
export interface AttentionActor {
  readonly kind: string
  readonly user_id?: string
  readonly run_id?: string
  readonly session_id?: string
  readonly label?: string
}

/* -------------------------------------------------------------------- *
 * 错误载体（同 WP-2.4/WP-3.1/WP-3.5 纪律: 结构化 code, caller-owned）
 * -------------------------------------------------------------------- */

export type AttentionErrorCode = 'ATTN_INPUT' | 'ATTN_PERM' | 'ATTN_STORE'

export interface AttentionErrorOptions {
  readonly code: AttentionErrorCode
  readonly message: string
  readonly cause?: unknown
}

/** 服务/存储错误（ATTN_INPUT = 入参契约; ATTN_PERM = 权限门; ATTN_STORE = 驱动/SQL 失败）。 */
export class AttentionError extends Error {
  readonly code: AttentionErrorCode

  constructor(options: AttentionErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'AttentionError'
    this.code = options.code
  }
}

export function isAttentionError(error: unknown): error is AttentionError {
  return error instanceof AttentionError
}

/* -------------------------------------------------------------------- *
 * DB 端口（双连接模式 — 同 WP-3.1 PlanForkDb / WP-3.5 FloodingDb）
 * -------------------------------------------------------------------- */

/** operational DB 结构端口（node:sqlite DatabaseSync 使用面 — 零 sqlite import）。 */
export type AttentionDb = PlanForkDb

/* -------------------------------------------------------------------- *
 * 评分输入组装端口（getAttentionRanking 的数据源; 生产接线时注入）
 * -------------------------------------------------------------------- */

/**
 * 活跃 Intervention 的结构读面（flooding `InterventionRecord` 结构可赋值 —
 * 只读评分所需的列; 状态契约: 调用方给 OPEN/PENDING, service 再防御过滤）。
 */
export interface ActiveInterventionRecord {
  readonly id: string
  readonly title: string
  readonly origin: 'USER' | 'AGENT_REPORT' | 'AUTO_FLOODING' | 'AUTO_AUDIT'
  readonly status: 'OPEN' | 'PENDING' | 'CLOSED'
  readonly workstream_ids: readonly string[]
  readonly created_at: number
}

/**
 * `getAttentionRanking` 的四个数据源端口（thunk — 每次调用取活数据）。
 * 默认全空（Phase 5 未交付的数据面不伪造 — 同 WP-4.1a `null` 占位纪律;
 * 这里评分器面对「无候选」是良定义的空排序, 不渲染假数据）。
 *   - interventions: WP-3.5 flooding `InterventionStore.listInterventions` 面;
 *   - nextActions / blockers: WP-5.2 交付后注入（`AttentionItem` 直接给形）;
 *   - scheduledEvents: WP-5.3 交付后注入。
 */
export interface AttentionSourcePorts {
  readonly getActiveInterventions?: () => readonly ActiveInterventionRecord[]
  readonly getProposedNextActions?: () => readonly import('./scorer.js').AttentionNextActionItem[]
  readonly getActiveBlockers?: () => readonly import('./scorer.js').AttentionBlockerItem[]
  readonly getScheduledEvents?: () => readonly import('./scorer.js').AttentionScheduledEventItem[]
}
