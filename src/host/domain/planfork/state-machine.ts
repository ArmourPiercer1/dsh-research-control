/**
 * WP-3.1 — PlanFork state machine (PLAN_FORK_SPEC §10, 原文转换表):
 *
 *   ```text
 *              ┌────────────┐  SELECT(用户)  ┌──────────┐
 *     创建 ──> │    OPEN    │ ────────────> │ SELECTED │（终态）
 *              └─┬───────┬──┘               └──────────┘
 *        基准失效│       │ DISMISS(用户)
 *              ┌▼───────▼──┐ DISMISS(用户) ┌──────────┘
 *              │   STALE   │ ───────────> │ DISMISSED │（终态）
 *              └───────────┘
 *   ```
 *
 * 转换表 (冻结语义, 逐条):
 *   - OPEN    → SELECTED | DISMISSED | STALE
 *   - STALE   → DISMISSED
 *   - SELECTED / DISMISSED → 终态 (无出边)
 *   - 自环 (S → S) 非法 (表中未列)。
 *
 * 「全部状态迁移 append-only 记录, PF 行永不删除」(§10): 每次迁移在
 * store.transition 中 ① 乐观条件更新行内 status 缓存列 (WHERE status=from)
 * ② 同事务 append 一条 ManagementAction (action_kind 映射见
 * `TRANSITION_ACTION_KIND`)。catalog 核查: HISTORY_EVENT_CATALOG §4 无
 * PLAN_FORK_* 事件 ⇒ PF 迁移**不产 ResearchHistory 事件** (管理操作,
 * §4/§6.6/§7 口径), 账本 = operational `management_action` 表。
 *
 * 各迁移的调用方 (本 WP 交付状态机 + 字段面 + 乐观门; 触发逻辑归后续 WP):
 *   - OPEN → STALE:      §5 stale 检测 (基准失真) + §6.5 同基准连锁失效
 *                        (「superseded by PF-<id> selection」) — WP-3.2/3.4;
 *   - OPEN → SELECTED:   §6 SELECT 物化 (前置 PF.status == OPEN) — WP-3.4;
 *   - OPEN → DISMISSED / STALE → DISMISSED: §7 DISMISS (用户) — WP-3.4。
 *
 * Invariant mapping (ARCHITECTURE §5.4):
 *  - INV-PLAN-7 (SELECT 后 PF=SELECTED、同基准 OPEN PF=STALE、DISMISS 只改
 *    状态不删除): 本表 SELECTED 边 + OPEN→STALE 边 + 存储层 no-DELETE
 *    trigger (schema.ts) — 「只改状态不删除」由状态缓存列 UPDATE 表达;
 *  - INV-PLAN-8 (基准被修改后旧基准 PF 判 STALE): OPEN→STALE 边 +
 *    stale_reason 字段面 (stale 判定算法本身 = WP-3.2);
 *  - INV-PLAN-4 (PF 不可修改/删除): 内容字段不可变 trigger + 无 delete API。
 *
 * Pure data + pure guards (zero I/O, 同 WP-2.5 semantics state-machine
 * 模式): `checkPfTransition` throws `PlanForkError` (PF_WRONG_STATE) on
 * illegal pairs — 守卫消息点名当前态、目标态、合法集 (terminal 明示)。
 */

import {
  PF_STATUSES,
  PlanForkError,
  type ActorRef,
  type ManagementActionKind,
  type PfStatus,
} from './types.js'

/**
 * The frozen §10 legal-transition table (key = from → legal tos; 终态 → []).
 * 逐字对照 §10 ASCII 图 (SELECT=用户、DISMISS=用户、基准失效=插件懒检测/
 * 加载后检测 — 发射者语义见各迁移调用方 WP; 本 WP 的 transition API 对
 * actor 只做冻结 actorRef 形状校验, 不重述权限矩阵 — 权限门在工具面
 * WP-3.3/3.4 的 actor 类型面 + 运行时门)。
 */
export const PF_TRANSITIONS: Readonly<Record<PfStatus, readonly PfStatus[]>> = {
  OPEN: ['SELECTED', 'DISMISSED', 'STALE'],
  STALE: ['DISMISSED'],
  SELECTED: [], // 终态
  DISMISSED: [], // 终态
}

/** The legal target states of `from` (`[]` = terminal). */
export function legalPfTargets(from: PfStatus): readonly PfStatus[] {
  return PF_TRANSITIONS[from] ?? []
}

/** True iff `from -> to` appears in the table (same-state = illegal). */
export function isLegalPfTransition(from: PfStatus, to: PfStatus): boolean {
  return legalPfTargets(from).includes(to)
}

/**
 * Guard one transition. Throws `PlanForkError` (PF_WRONG_STATE) when `to`
 * is not legal for `from` — the message names the PF id, the CURRENT
 * state, the TARGET, and the LEGAL SET (「terminal」 when empty), per
 * ARCHITECTURE §10 错误定位纪律.
 */
export function checkPfTransition(pfId: string, from: PfStatus, to: PfStatus): void {
  const legal = legalPfTargets(from)
  if (!legal.includes(to)) {
    const suffix = legal.length === 0 ? ` (${from} 是终态, 无出边)` : ` (legal from ${from}: ${legal.join(' | ')})`
    throw new PlanForkError({
      code: 'PF_WRONG_STATE',
      message:
        `plan fork ${JSON.stringify(pfId)} is ${from}; transition to ${to} is not in the §10 legal table` +
        suffix + ` (PLAN_FORK_SPEC §10; ARCHITECTURE §5.4 INV-PLAN-7)`,
    })
  }
}

/* ------------------------------------------------------------------ *
 * Transition payloads — the target-state field co-occurrence
 * (DOMAIN_SCHEMA §5 可选字段: selected_at/selected_by、dismissed_at、
 * stale_reason; schema.ts 的 CHECK 约束同型)
 * ------------------------------------------------------------------ */

/**
 * One state transition the store executes (the discriminated union pins
 * EXACTLY the fields each target state co-requires — 类型面: 给 OPEN→
 * STALE 传 selected_at 是编译错误):
 *   - SELECTED  (用户 SELECT, §6.4):  selected_at + selected_by (用户 actor);
 *   - DISMISSED (用户 DISMISS, §7):   dismissed_at;
 *   - STALE     (基准失效, §5/§6.5):  stale_reason (首个差异说明; §6.5
 *     连锁失效 = 「superseded by PF-<id> selection」原文).
 * The ManagementAction `actor` (谁执行迁移) 由调用方随 transition 传入
 * (SELECT/DISMISS = 用户; STALE = 插件懒检测 — 发射者按各自 WP 的矩阵)。
 */
export type PfTransition =
  | { readonly to: 'SELECTED'; readonly selected_at: number; readonly selected_by: ActorRef }
  | { readonly to: 'DISMISSED'; readonly dismissed_at: number }
  | { readonly to: 'STALE'; readonly stale_reason: string }

/** The ManagementAction action_kind each transition appends (§4/§5/§6/§7 原文). */
export const TRANSITION_ACTION_KIND: Readonly<Record<Exclude<PfStatus, 'OPEN'>, ManagementActionKind>> = {
  SELECTED: 'PF_SELECTED',
  DISMISSED: 'PF_DISMISSED',
  STALE: 'PF_STALE_MARKED',
}

/** True iff `value` is one of the 4 frozen states (runtime gate on stored rows). */
export function isPfStatus(value: unknown): value is PfStatus {
  return typeof value === 'string' && (PF_STATUSES as readonly string[]).includes(value)
}
