/**
 * WP-6.3 — reconciliation 三档（任务书目标 2 — 计划书 §22.3 原文逐字）:
 * 机械推荐档位映射 + 用户显式档位选择执行面。
 *
 * ## 推荐档位（冻结映射 — 「每档的判定条件」全机械, 零推断）
 *
 * §22.3 三档定义逐字:
 *   - AUTO_RECONCILE：高置信 provenance 缺口；
 *   - PROPOSE_RECONCILIATION：可能匹配但需确认；
 *   - ESCALATE：高影响/未知/损失 → Intervention。
 *
 * 类别 → 档位的冻结映射（`recommendTier` 单一真源; classify 只调用,
 * 不持第二份表; tests 钉漂移）:
 *
 *  | 类别（条件）                          | 档位                  | 理由码                  | §22.3 原文锚点              |
 *  | UNREGISTERED_WORKSPACE_CHANGE zone≠null | AUTO_RECONCILE        | ZONE_DECLARED           | 高置信 provenance 缺口 —   |
 *  |                                        |                       |                         | zone 声明 = 用户先验登记   |
 *  | UNREGISTERED_WORKSPACE_CHANGE zone=null | PROPOSE_RECONCILIATION| OUT_OF_ZONE             | 可能匹配但需确认（zone 外  |
 *  |                                        |                       |                         | 文件可能是产物也可能是杂项）|
 *  | ARTIFACT_RECOVERABLE                    | AUTO_RECONCILE        | URI_MATCH               | 高置信 — uri 相等即身份     |
 *  | RESEARCH_UNCHECKPOINTED                 | AUTO_RECONCILE        | CHECKPOINT_GAP          | 高置信 — 声明态变化登记方式 |
 *  |                                        |                       |                         | 唯一（checkpoint, §14/§22.4）|
 *  | TRACKED_UNDECLARED                      | PROPOSE_RECONCILIATION| TRACKED_CHANGE_CONFIRM  | 可能匹配但需确认（tracked  |
 *  |                                        |                       |                         | 变更与注册面关系需人确认）  |
 *  | DECLARED_MISSING                        | ESCALATE              | DECLARED_LOSS           | 高影响/未知/损失 →          |
 *  |                                        |                       |                         | Intervention（声明物缺席）  |
 *
 * 推荐**不是**执行 — 档位选择权在用户（任务书「档位选择 = 用户显式」）:
 * `reconcileDiscrepancies` 的 `decisions` 是用户对每条 discrepancy 的
 * 显式选择（可采纳推荐, 也可改档/忽略 — 改档本身即用户的显式判断,
 * 本层不评价）。
 *
 * ## 每档的处理动作（冻结; **不改写历史、不动 History 事件**）
 *
 *  - AUTO_RECONCILE → **登记 Inbox**（`INBOX_CAPTURE`）: 构造
 *    {@link InboxEntryDraft}（§11; 落库归 WP-6.4）— GIT_INTEGRATION §8
 *    「发现未注册产物 -> Inbox」的机械落点;
 *  - PROPOSE_RECONCILIATION → **引导用户补声明**（`PROPOSE_DECLARATION`）:
 *    Inbox 草稿 + {@link DeclarationProposal}（机械材料, 指向既有显式
 *    登记流 — 本层不代写声明, §7.3「显式注册时成为 Artifact」/§6 矩阵
 *    checkpoint 仅用户）;
 *  - ESCALATE → **Intervention**（`ESCALATE_INTERVENTION`）: 构造
 *    {@link InterventionRequest}（§22.3 逐字「→ Intervention」;
 *    trigger = `AUDIT_HIGH_IMPACT_DISCREPANCY` — §16.3/ARCHITECTURE
 *    脚注 ¹ 机械触发闭集成员; origin `AUTO_AUDIT`; actor PLUGIN —
 *    catalog §5.7 AUTO_* ⇒ PLUGIN; 创建归 WP-5.1 `createMechanicalIntervention`）;
 *  - IGNORE（用户处置, 三档之外）→ **标记忽略**（`IGNORED`）: 纯标记,
 *    无下游产物, 无 History 事件。
 *
 * 结构性「不改写历史」: 四个动作的产物全部是**新建对象**的纯数据草稿
 * （Inbox `CAPTURED` 入口态 / 新 Intervention 请求 / 声明提案 / 忽略
 * 标记）— 类型面上不存在任何对已有 History 事件 / operational 行的
 * update/delete/rewrite 形态; 本层零存储 import（AST 证明,
 * tests/audit-reconcile/read-only.test.ts）。§22.3「Git 提供文件版本
 * 和 diff；插件不实现自己的文件历史系统」— 本层对文件历史零触碰。
 *
 * ## 用户门（双面拒绝, 同 WP-5.1/WP-2.4 先例）
 *
 * `reconcileDiscrepancies(report, decisions, actor, opts?)`:
 *  - **类型面**: `actor: ReconcileUserActorRef`（kind='USER' 冻结 —
 *    AGENT/PLUGIN/SYSTEM actor 是编译错误, INV-PERM-4 类型面）;
 *  - **运行面**: 伪造的非 USER actor（如 `as unknown as` 强转）⇒
 *    RECON_ACTOR_FORBIDDEN, **零部分输出**（全部前置校验先于构造）;
 *  - choice 不在三档 + IGNORE 封闭集内 ⇒ RECON_TIER_UNKNOWN（指名）;
 *  - 未知 refId / 重复决策 / 报告-决策形状不符 ⇒ RECON_INPUT（指名）。
 *
 * 纯函数: 零 I/O、零存储、零时钟自持（`now` 注入, 缺省 `Date.now` —
 *  测试恒注入确定性时钟）。
 */

import type {
  DeclarationProposal,
  Discrepancy,
  DiscrepancyReport,
  IgnoreChoice,
  InboxEntryDraft,
  InterventionRequest,
  ReconcileChoice,
  ReconcileDecision,
  ReconcileOutcome,
  ReconcileUserActorRef,
  ReconciliationTier,
  TierAction,
  TierReasonCode,
} from './types.js'
import { RECONCILIATION_TIERS } from './types.js'
import { ReconcileError } from './errors.js'
import { toInboxEntry, toInterventionRequest, proposalFor } from './inbox.js'

/** 推荐档位的判定面（冻结: 推荐只取决于 (category, zone) 两字段 —
 *  无第三输入, 类型面即闭包）。 */
export interface TierSubject {
  readonly category: Discrepancy['category']
  /** UNREGISTERED_WORKSPACE_CHANGE 的 zone 归属（其余类别忽略）。 */
  readonly zone?: string | null
}

/**
 * 机械推荐档位（§22.3 冻结映射 — module doc 表; 单一真源）。
 * 纯函数, never throws（类别集封闭）。
 */
export function recommendTier(
  s: TierSubject,
): { readonly tier: ReconciliationTier; readonly reason: TierReasonCode } {
  switch (s.category) {
    case 'UNREGISTERED_WORKSPACE_CHANGE':
      return s.zone === null
        ? { tier: 'PROPOSE_RECONCILIATION', reason: 'OUT_OF_ZONE' }
        : { tier: 'AUTO_RECONCILE', reason: 'ZONE_DECLARED' }
    case 'TRACKED_UNDECLARED':
      return { tier: 'PROPOSE_RECONCILIATION', reason: 'TRACKED_CHANGE_CONFIRM' }
    case 'DECLARED_MISSING':
      return { tier: 'ESCALATE', reason: 'DECLARED_LOSS' }
    case 'RESEARCH_UNCHECKPOINTED':
      return { tier: 'AUTO_RECONCILE', reason: 'CHECKPOINT_GAP' }
    case 'ARTIFACT_RECOVERABLE':
      return { tier: 'AUTO_RECONCILE', reason: 'URI_MATCH' }
  }
}

/** 每档的机械动作种类（冻结; 任务书「每档的处理动作」的类型面）。 */
export const TIER_ACTION: Readonly<Record<ReconciliationTier, string>> = {
  AUTO_RECONCILE: 'INBOX_CAPTURE',
  PROPOSE_RECONCILIATION: 'PROPOSE_DECLARATION',
  ESCALATE: 'ESCALATE_INTERVENTION',
}

/* ------------------------------------------------------------------ *
 * 用户门运行面
 * ------------------------------------------------------------------ */

/** 运行面 actor 断言（类型面在参数类型上 — 双面拒绝）。伪造的非 USER
 *  actor（运行时强转）⇒ RECON_ACTOR_FORBIDDEN; 零部分输出。 */
function assertUserActor(actor: ReconcileUserActorRef, operation: string): void {
  if (
    actor === null ||
    typeof actor !== 'object' ||
    (actor as { kind?: unknown }).kind !== 'USER'
  ) {
    throw new ReconcileError({
      code: 'RECON_ACTOR_FORBIDDEN',
      message: `${operation}: reconciliation tier selection is user-only (INV-PERM-4 runtime face; type face = ReconcileUserActorRef kind 'USER')`,
    })
  }
}

function isReconcileChoice(v: unknown): v is ReconcileChoice {
  return typeof v === 'string' && (v === 'IGNORE' || (RECONCILIATION_TIERS as readonly string[]).includes(v))
}

/* ------------------------------------------------------------------ *
 * 执行面（纯函数 — 构造动作产物, 零持久化）
 * ------------------------------------------------------------------ */

/**
 * reconciliation 档位选择执行（任务书目标 2「档位选择 = 用户显式」）:
 * 对用户显式选择逐条构造动作产物（Inbox 草稿 / 声明提案 /
 * Intervention 请求 / 忽略标记）。
 *
 * 契约:
 *  - actor 必须为 USER（类型面 + 运行面双面 — 见 module doc）;
 *  - `decisions` 的每个 `refId` 必须存在于 `report`（一个 discrepancy
 *    一个决策 — 重复 refId ⇒ RECON_INPUT; 未选条目 = 不处置, 本层
 *    不代用户选档）;
 *  - **全部前置校验先于任何构造** — 任一失败 ⇒ 零部分输出（fail-loud,
 *    同 WP-6.1/6.2 口径）;
 *  - 输出全列表按 refId 排序; `byRef` 与 decisions 1:1（可审计）;
 *  - 纯函数: 输入零改动, 无 I/O, 无 History 事件（结构性 — 见 module
 *    doc「结构性不改写历史」+ AST 证明）。
 *
 * @param now 注入时钟（Inbox `created_at` 面; 缺省 `Date.now`）。
 */
export function reconcileDiscrepancies(
  report: DiscrepancyReport,
  decisions: readonly ReconcileDecision[],
  actor: ReconcileUserActorRef,
  opts?: { readonly now?: () => number },
): ReconcileOutcome {
  assertUserActor(actor, 'reconcileDiscrepancies')
  const now = (opts?.now ?? Date.now)()

  /* ── 前置校验（全部先于构造; 失败 ⇒ 零部分输出） ── */
  const byRefId = new Map<string, Discrepancy>()
  for (const d of report.discrepancies) byRefId.set(d.id, d)

  const seen = new Set<string>()
  const validated: { readonly d: Discrepancy; readonly choice: ReconcileChoice }[] = []
  for (const dec of decisions) {
    if (
      dec === null ||
      typeof dec !== 'object' ||
      typeof (dec as { refId?: unknown }).refId !== 'string' ||
      (dec as { refId: string }).refId.length === 0
    ) {
      throw new ReconcileError({
        code: 'RECON_INPUT',
        message: `reconcileDiscrepancies: malformed decision (expected { refId: non-empty string, choice })`,
      })
    }
    const { refId, choice } = dec
    if (seen.has(refId)) {
      throw new ReconcileError({
        code: 'RECON_INPUT',
        message: `reconcileDiscrepancies: duplicate decision for ${refId} (one decision per discrepancy)`,
      })
    }
    seen.add(refId)
    const d = byRefId.get(refId)
    if (d === undefined) {
      throw new ReconcileError({
        code: 'RECON_INPUT',
        message: `reconcileDiscrepancies: unknown refId ${JSON.stringify(refId)} (not in report)`,
      })
    }
    if (!isReconcileChoice(choice)) {
      throw new ReconcileError({
        code: 'RECON_TIER_UNKNOWN',
        message:
          `reconcileDiscrepancies: unknown choice ${JSON.stringify(choice as unknown)} ` +
          `(closed set = ${RECONCILIATION_TIERS.join('|')}|IGNORE — 计划书 §22.3 三档 + 用户忽略处置)`,
      })
    }
    validated.push({ d, choice })
  }

  /* ── 构造（校验全过 — 全有或全无已保证）— refId 随构造记录, 输出按
   *  refId 排序（确定性; byRef 与 decisions 1:1 可审计） ── */
  const inboxDrafts: { readonly refId: string; readonly item: InboxEntryDraft }[] = []
  const proposals: { readonly refId: string; readonly item: DeclarationProposal }[] = []
  const interventions: { readonly refId: string; readonly item: InterventionRequest }[] = []
  const ignored: string[] = []
  const byRef = new Map<string, TierAction>()

  for (const { d, choice } of validated) {
    if (choice === 'IGNORE') {
      ignored.push(d.id)
      byRef.set(d.id, { kind: 'IGNORED', refId: d.id })
      continue
    }
    if (choice === 'AUTO_RECONCILE') {
      const inbox = toInboxEntry(d, choice, now)
      inboxDrafts.push({ refId: d.id, item: inbox })
      byRef.set(d.id, { kind: 'INBOX_CAPTURE', refId: d.id, inbox })
    } else if (choice === 'PROPOSE_RECONCILIATION') {
      const inbox = toInboxEntry(d, choice, now)
      const proposal = proposalFor(d, choice)
      inboxDrafts.push({ refId: d.id, item: inbox })
      if (proposal !== null) proposals.push({ refId: d.id, item: proposal })
      byRef.set(d.id, { kind: 'PROPOSE_DECLARATION', refId: d.id, inbox, proposal })
    } else {
      // 'ESCALATE'
      const intervention = toInterventionRequest(d)
      interventions.push({ refId: d.id, item: intervention })
      byRef.set(d.id, { kind: 'ESCALATE_INTERVENTION', refId: d.id, intervention })
    }
  }

  const refSort = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
  const byRefIdSort = (a: { refId: string }, b: { refId: string }): number => refSort(a.refId, b.refId)
  inboxDrafts.sort(byRefIdSort)
  proposals.sort(byRefIdSort)
  interventions.sort(byRefIdSort)
  ignored.sort(refSort)

  return {
    actor,
    at: now,
    inboxDrafts: inboxDrafts.map((e) => e.item),
    proposals: proposals.map((e) => e.item),
    interventionRequests: interventions.map((e) => e.item),
    ignored,
    byRef,
  }
}

export type { IgnoreChoice }
