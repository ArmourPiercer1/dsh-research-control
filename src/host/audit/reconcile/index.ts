/**
 * src/host/audit/reconcile — WP-6.3 discrepancy 分类 + reconciliation
 * 三档: 包公共面（唯一 import 点）。
 *
 *   - types.ts    — 机械类型面（Discrepancy 5 类别判别联合 / §22.3 三档
 *     + 忽略处置 / 用户门 actor 面 / Inbox 草稿 / Intervention 请求 /
 *     声明提案 — 全 readonly）
 *   - constants.ts— 冻结常量（`.research/` 前缀本地镜像, git-free）
 *   - classify.ts — discrepancy 分类器（纯函数: strict audit +
 *     discovery 差分 + `.research/` 声明态 → 结构化 Discrepancy 清单;
 *     全机械规则, §22.2 边界）
 *   - tiers.ts    — 三档机械推荐映射（单一真源）+ `reconcileDiscrepancies`
 *     用户显式档位选择执行面（类型面 UserActor + 运行面断言双面）
 *   - inbox.ts    — 下游接缝构造器（Inbox 草稿 → WP-6.4; Intervention
 *     请求 → WP-5.1; 声明提案 → 既有显式登记流）
 *   - errors.ts   — `ReconcileError`（稳定机器码: RECON_INPUT /
 *     RECON_ACTOR_FORBIDDEN / RECON_TIER_UNKNOWN）
 *
 * 边界（任务书 / 计划书 §22.3 / GIT_INTEGRATION §8 逐字）:
 *  - **不改写历史、不动 History 事件**: 本层零存储/零 git/零 fs/零
 *    spawn import（结构性只读 — tests/audit-reconcile/read-only.test.ts
 *    AST 证明）; 输出动作封闭 4 形态（INBOX_CAPTURE / PROPOSE_DECLARATION
 *    / ESCALATE_INTERVENTION / IGNORED）, 全部是**新建对象**的纯数据
 *    草稿 — 类型面上不存在任何 update/delete/rewrite 形态;
 *  - **档位选择 = 用户显式**（`reconcileDiscrepancies` actor 参数
 *    `ReconcileUserActorRef` 类型面 + 运行面 RECON_ACTOR_FORBIDDEN）;
 *  - **机械, 无科研语义推断**（§22.2）: 分类/推荐/动作构造全冻结映射,
 *    类型信号唯一来源 = WP-6.2 冻结表; 缺失判定只信权威信号（git 删除 /
 *    差分 removed / zone 完整扫描缺席）, 未观测域不报。
 *
 * 消费接线: WP-6.4（Inbox 落库 — `InboxEntryDraft` 经共享 IdAllocator
 *  补 `id` 后入 `inbox_item` 表）; WP-5.1（`createMechanicalIntervention`
 *  — `InterventionRequest` 字段 1:1, tests 钉）; cockpit 座位（Brief L3
 *  audit 行数据 — 后续编排 WP）。
 */

export { AUDIT_HIGH_IMPACT_TRIGGER, CATEGORY_INBOX_SOURCE, DISCREPANCY_CATEGORIES, IGNORE_CHOICE, RECONCILIATION_TIERS, RECONCILE_USER_ACTOR } from './types.js'
export { isResearchTreePath, RESEARCH_TREE_PREFIX } from './constants.js'
export { classifyDiscrepancies, isVerifiableUri } from './classify.js'
export { reconcileDiscrepancies, recommendTier, TIER_ACTION, type TierSubject } from './tiers.js'
export { proposalFor, toInboxEntry, toInterventionRequest } from './inbox.js'
export { ReconcileError, isReconcileError } from './errors.js'
export type {
  DeclaredState,
  DeclarationProposal,
  Discrepancy,
  DiscrepancyCategory,
  DiscrepancyReport,
  IgnoreChoice,
  InboxContextRef,
  InboxEntryDraft,
  InterventionRequest,
  ReconcileChoice,
  ReconcileDecision,
  ReconcileErrorCode,
  ReconcileInput,
  ReconcileOutcome,
  ReconcileUserActorRef,
  ReconcileInboxSource,
  ReconciliationTier,
  TierAction,
  TierActionKind,
  TierReasonCode,
} from './types.js'
