/**
 * WP-6.3 — discrepancy 分类 + reconciliation 三档: type face.
 *
 * 冻结契约依据（原文为准）:
 *  - 计划书 §22.1（Audit 三层: Strict tracked resources / Discovery zones
 *    「用于发现未注册 Artifact / workspace change」/ Ignored「不扫描」）;
 *  - 计划书 §22.2（「只回答：工作区发生了哪些插件尚未登记的变化？不自动
 *    推断这些变化的科研意义」）;
 *  - 计划书 §22.3（Reconciliation 三档原文:
 *      AUTO_RECONCILE：高置信 provenance 缺口；
 *      PROPOSE_RECONCILIATION：可能匹配但需确认；
 *      ESCALATE：高影响/未知/损失 → Intervention。
 *    「Git 提供文件版本和 diff；插件不实现自己的文件历史系统。」）;
 *  - GIT_INTEGRATION §8（「发现未注册产物 -> Inbox（UNREGISTERED_WORKSPACE_CHANGE）」
 *    + 「reconciliation 三档（AUTO_RECONCILE / PROPOSE_RECONCILIATION /
 *    ESCALATE）不改写历史」）;
 *  - DOMAIN_SCHEMA §7.3（Artifact「外部资源 registry，不是文件存储」；
 *    `uri`「path 或 URI（不复制内容）」；status「REGISTERED/MISSING」
 *    「ARTIFACT_MARKED_MISSING 标记；找回可恢复」）+ §11（Research Inbox:
 *    `source`/`payload`/`raw`「原始数据（如 audit finding 细节）」/
 *    `context_refs`/`state`）+ §1.4（`InboxSource` 7 值 / `InboxState`
 *    `CAPTURED|CONVERTED|DISMISSED`）;
 *  - 计划书 §16.3 + ARCHITECTURE §6 脚注 ¹（机械触发闭集:
 *    「audit 高影响 unresolved discrepancy」⇒ Intervention
 *    origin `AUTO_AUDIT` — WP-3.5 `MECHANICAL_TRIGGER_KINDS` 成员
 *    `AUDIT_HIGH_IMPACT_DISCREPANCY`）;
 *  - §14 + §22.4（`.research/` 声明式真源；内容历史由 Git 负责 —
 *    未 checkpoint 的 `.research/` 变化 = 插件尚未登记的声明态变化）。
 *
 * ## 输入面（任务书目标 1）
 *
 * `classifyDiscrepancies` 输入三源（全部只读快照，零 I/O）:
 *  1. **strict audit** — WP-6.1 {@link AuditReport}（W4/W5/W13 事实:
 *     `trackedChanges` / `strictTracked` / `research` / `newFiles`）;
 *  2. **discovery 差分** — WP-6.2 {@link DiscoveryScanReport}（fs 扫描:
 *     候选 + 快照差分 `diff`）与/或 `UntrackedFeedResult`（W4 untracked
 *     纯 feed — WP-6.1 `newFiles.outsideResearch` 经
 *     `feedUntracked` 归一化后的产物）;
 *  3. **`.research/` 声明态** — {@link DeclaredState}: artifact registry
 *     （§7.3 行形状 = WP-2.5 {@link ArtifactRow}, 全状态保留含 MISSING —
 *     无硬删 INV-HIST-7）+ 归一化 {@link AuditPolicy}（§14.1,
 *     workspace.root 承载 repo↔workspace 前缀换算, GIT_INTEGRATION §3
 *     「插件负责前缀换算」— 换算在本层消费侧完成, WP-6.2 缝注记）。
 *
 * ## 输出面（任务书目标 1-4）
 *
 *  - {@link DiscrepancyReport} — 结构化 Discrepancy 清单（5 类别, 全部
 *    机械规则, 类别名逐条锚定计划书原文, 见 {@link DiscrepancyCategory}）;
 *  - {@link ReconciliationTier} 三档（§22.3 逐字）+ 每档冻结动作面
 *    （{@link TierAction} — 登记 Inbox / 引导用户补声明 / → Intervention;
 *    **不改写历史、不动 History 事件**: 本层输出全部是**新建对象**的
 *    纯数据草稿（Inbox entry CAPTURED / 新 Intervention 请求 / 声明
 *    提案 / 忽略标记）, 类型面上不存在任何 update/delete/rewrite 动作;
 *  - **档位选择 = 用户显式**（任务书目标 2）: {@link reconcileDiscrepancies}
 *    的 actor 参数类型 {@link ReconcileUserActorRef}（kind='USER' —
 *    AGENT/PLUGIN/SYSTEM 是编译错误, INV-PERM-4 类型面）+ 运行面
 *    `assertUserActor`（伪造非 USER actor ⇒ RECON_ACTOR_FORBIDDEN,
 *    零输出）— 双面拒绝, 同 WP-5.1/WP-2.4 先例;
 *  - Inbox 接缝（任务书目标 4, WP-6.4 消费）: {@link InboxEntryDraft}
 *    构造器（§11 字段 1:1 子集, id 归 WP-6.4 分配器）; Intervention
 *    接缝（WP-5.1 消费）: {@link InterventionRequest}（字段逐位对齐
 *    `createMechanicalIntervention` 参数 — tests 钉）。
 *
 * ## 机械边界（任务书目标 3, §22.2「不推断科研含义」）
 *
 *  - 分类/推荐档位/动作构造全部是**冻结映射**（枚举 → 枚举 / 枚举 +
 *    路径相等 → 结构）, 无自由文本输入、无语义提示 API;
 *  - 类型信号复用 WP-6.2 冻结表（扩展名表 > 命名模式 > OTHER —
 *    `combineTypeSignal` 纯函数）, 本层零第二套表;
 *  - zone `artifact_types` 提示只原样透出, 永不覆盖机械猜测
 *    （同 WP-6.2 口径）;
 *  - **缺失判定只信权威信号**（false-positive 机械上不可行时不报）:
 *    git 删除（W13 并集）/ 快照差分 removed / 声明 zone 的完整扫描缺席 —
 *    未观测域（zone 外 + 非 strict + 无 fs 扫描）一律不报缺失;
 *  - 确定性: 清单按 (category, subkind, path) 排序, 报告无自生成
 *    时间戳（`now` 仅注入, 供 Inbox `created_at`）— 同输入同报告。
 *
 * 层规则（ARCHITECTURE §2.2）: audit → domain (type-only); 零 git import
 * （git-free, 同 WP-6.2）; 零 node:fs / node:child_process / node:sqlite
 * （本层是纯函数层 — 无任何 I/O 与存储通道, 「不改写历史」结构性成立,
 * 见 tests/audit-reconcile/read-only.test.ts AST 证明）; 零 DSH import
 * （INV-PERM-5）。
 */

import type { ArtifactType } from '../../domain/loader/index.js'
import type { ArtifactRow } from '../../domain/semantics/index.js'
import type { AuditPolicy, AuditReport, StrictTrackedChange } from '../strict/index.js'
import type {
  DiscoveryCandidate,
  DiscoveryScanReport,
  UntrackedFeedResult,
} from '../discovery/index.js'

/* ------------------------------------------------------------------ *
 * 输入面
 * ------------------------------------------------------------------ */

/**
 * `.research/` 声明态（任务书目标 1 输入 3）— 只读快照面。
 *
 * `artifacts` = §7.3 artifact registry 的**当前行集**（WP-2.5 语义
 * 行形状 {@link ArtifactRow}; 消费方可直接传 `SemanticState.artifacts`
 * — 全状态保留, MISSING 行也在, 无硬删）。`policy` = 归一化
 * §14.1 policy（WP-6.1 {@link AuditPolicy}; `workspaceRoot` 是
 * repo↔workspace 前缀换算的唯一材料）。
 */
export interface DeclaredState {
  /** artifact registry 当前行（A id → 行; 含 REGISTERED 与 MISSING）。 */
  readonly artifacts: ReadonlyMap<string, ArtifactRow>
  /** 归一化 audit policy（§14.1; `workspaceRoot` 相对 repo root）。 */
  readonly policy: AuditPolicy
}

/** `classifyDiscrepancies` 输入（三源; 全部只读）。 */
export interface ReconcileInput {
  /** strict git audit 报告（WP-6.1; 路径一律 repo-root-relative）。 */
  readonly audit: AuditReport
  /**
   * discovery fs 扫描报告（WP-6.2; 候选路径 workspace-root-relative +
   * 快照差分）。`null`/缺省 = 本轮未跑 fs 扫描（缺失判定退化为
   * 仅 git 权威信号 — 见 module doc「机械边界」）。
   */
  readonly discovery?: DiscoveryScanReport | null
  /**
   * W4 untracked feed 结果（WP-6.2 `feedUntracked` 产物 —
   * WP-6.1 `newFiles.outsideResearch` 的归一化面; 候选路径
   * workspace-root-relative）。与 `discovery` 正交通道, 可并存
   * （同一路径两边都出现时按路径去重, 见 classify 注释）。
   */
  readonly untrackedFeed?: UntrackedFeedResult | null
  /** `.research/` 声明态（registry + policy）。 */
  readonly declared: DeclaredState
}

/* ------------------------------------------------------------------ *
 * Discrepancy 分类（任务书目标 1 — 类别逐条锚定计划书原文）
 * ------------------------------------------------------------------ */

/**
 * Discrepancy 类别（任务书「类别按计划书原文 … 以原文分类为准逐条实现」
 * — 每个类别的**判定材料**都来自 §22.1 三层的某个层或其声明态对偶,
 * 无第四层、无语义类别）:
 *
 *  - {@link TRACKED_UNDECLARED}（tracked-未声明）— §22.1 第一层 + §22.2:
 *    已跟踪 (tracked) 文件上插件尚未登记的变更（修改/删除/重命名/
 *    unmerged, `.research/` 外）;
 *  - {@link UNREGISTERED_WORKSPACE_CHANGE}（artifact-未注册）— §22.1
 *    第二层「用于发现未注册 Artifact / workspace change」+ GIT_INTEGRATION
 *    §8 同名 Inbox 来源: discovery 候选（zone fs 扫描 / W4 untracked
 *    feed）中无任何已注册 artifact `uri` 匹配者;
 *  - {@link DECLARED_MISSING}（声明-缺失）— §7.3「REGISTERED ↔ MISSING」
 *    + GIT_INTEGRATION §3 W13 行「判定 strict tracked 路径集内的删除/
 *    缺失」+ §14 声明式真源: **已声明**资源在工作区缺席（注册 artifact
 *    文件缺失 / strict 声明文件被删 / `.research/` 声明树文件缺失）;
 *  - {@link RESEARCH_UNCHECKPOINTED}（声明-未登记）— §14 + §22.4
 *    （`.research/` 内容历史由 Git 负责）: `.research/` 下插件尚未经
 *    checkpoint 登记的变化（未跟踪新文件 / 跟踪文件未提交修改）;
 *  - {@link ARTIFACT_RECOVERABLE}（找回）— §7.3「找回可恢复」:
 *    MISSING 状态 artifact 的 `uri` 文件重新出现（身份由 uri 相等证明,
 *    高置信）。
 *
 * 三层 partition（WP-6.2 `classifyPath` 口径）保证扫描域零重叠; 本
 * 分类器对**同一事实**不重复计数（每个输入条目恰好落一条 Discrepancy,
 * 见 classify.ts 注释与 tests 钉）。
 */
export type DiscrepancyCategory =
  | 'TRACKED_UNDECLARED'
  | 'UNREGISTERED_WORKSPACE_CHANGE'
  | 'DECLARED_MISSING'
  | 'RESEARCH_UNCHECKPOINTED'
  | 'ARTIFACT_RECOVERABLE'

/** 冻结类别集（排序/计数/映射用; 与上类型逐字一致 — tests 漂移 guard）。 */
export const DISCREPANCY_CATEGORIES: readonly DiscrepancyCategory[] = [
  'ARTIFACT_RECOVERABLE',
  'DECLARED_MISSING',
  'RESEARCH_UNCHECKPOINTED',
  'TRACKED_UNDECLARED',
  'UNREGISTERED_WORKSPACE_CHANGE',
]

/**
 * 一条结构化 Discrepancy（判别联合, 按 `category` 收窄）。
 *
 * 坐标约定: 所有 `path` 字段 = **repo-root-relative**（audit 权威坐标,
 * WP-6.1 口径「报告路径一律相对 repo root」）; workspace-root-relative
 * 输入（discovery/feed 候选、artifact `uri`）经 policy `workspaceRoot`
 * 机械换算（`'.'` 时恒等）— 换算责任在本消费层（WP-6.2 缝注记）。
 * `id` = 报告内寻址 id（确定性分配, 非 §1.1 域 id）— reconciliation
 * 档位选择经它引用条目。
 */
export type Discrepancy =
  | {
      readonly id: string
      readonly category: 'TRACKED_UNDECLARED'
      /** W4 行 kind（`renamed` = X 侧 R; `unmerged` = u 行冲突条目）。 */
      readonly subkind: 'modified' | 'deleted' | 'renamed' | 'unmerged'
      /** repo-root-relative 路径（rename = 新路径）。 */
      readonly path: string
      /** W4 index 状态字符（X）— 原样透出。 */
      readonly x: string
      /** W4 worktree 状态字符（Y）— 原样透出。 */
      readonly y: string
      /** rename/copy 源路径（subkind='renamed' 时）。 */
      readonly origPath?: string
      /** 该文件是否属于声明的 strict tracked 路径集（机械: ∈
       *  `strictTracked.tracked ∪ strictTracked.deleted`）。 */
      readonly inStrictTracked: boolean
      /** 已有注册 artifact 的 `uri` 精确匹配此路径（A id; 无 = undefined —
       *  「可能匹配但需确认」的机械半边）。 */
      readonly matchedArtifactId?: string
      readonly recommendedTier: ReconciliationTier
      readonly tierReason: TierReasonCode
    }
  | {
      readonly id: string
      readonly category: 'UNREGISTERED_WORKSPACE_CHANGE'
      /** 观察通道: `zone` = fs 扫描候选; `feed` = W4 untracked feed。 */
      readonly subkind: 'zone' | 'feed'
      /** repo-root-relative 路径（换算后）。 */
      readonly path: string
      /** 匹配 zone 目录（workspace-root-relative, 归一化; feed 越 zone
       *  条目 = `null` — 6.3 按此分档）。 */
      readonly zone: string | null
      /** 匹配 zone 的 `artifact_types` 提示（原样透出, 永不进类型判断）。 */
      readonly zoneArtifactTypes: readonly ArtifactType[]
      /** 机械类型猜测（WP-6.2 冻结表; 永不 null）。 */
      readonly suggestedType: ArtifactType
      /** fs 扫描 = `lstat` size; feed = `null`（feed 不 stat — WP-6.2 口径）。 */
      readonly sizeBytes: number | null
      /** 是否为「新」变化: fs 扫描 = `!firstScan && ∈ diff.added`
       *  （首扫 = 基线建立, 不是 N 条新事件 — WP-6.2 注记）; feed = 恒
       *  `true`（W4 报告当前未跟踪态, feed 无基线面）。 */
      readonly isNew: boolean
      readonly recommendedTier: ReconciliationTier
      readonly tierReason: TierReasonCode
    }
  | {
      readonly id: string
      readonly category: 'DECLARED_MISSING'
      /** 缺失的声明物: `artifact` = 注册 artifact 文件; `strict-tracked`
       *  = 声明 strict 路径集文件; `research-tree` = `.research/` 声明树
       *  文件。 */
      readonly subkind: 'artifact' | 'strict-tracked' | 'research-tree'
      /** repo-root-relative 路径。 */
      readonly path: string
      /** artifact 缺失时: 行 id（`strict-tracked`/`research-tree` 无）。 */
      readonly artifactId?: string
      /** artifact 缺失时: 行所属 workstream（机械透出, Intervention
       *  owner 推导面, catalog §5.7「第一个关联 WS」; 其余 subkind 无）。 */
      readonly workstreamId?: string
      /** 缺失的权威信号（机械来源, 不猜）:
       *  `git-deleted` = W13 并集删除（strict）;
       *  `diff-removed` = 快照差分 removed（上一轮扫描见过, 本轮不见）;
       *  `zone-scan-absent` = 声明 zone 完整扫描缺席;
       *  `research-missing` = W13 `.research/` 并集缺失。 */
      readonly signal: 'git-deleted' | 'diff-removed' | 'zone-scan-absent' | 'research-missing'
      readonly recommendedTier: ReconciliationTier
      readonly tierReason: TierReasonCode
    }
  | {
      readonly id: string
      readonly category: 'RESEARCH_UNCHECKPOINTED'
      /** `untracked-new` = `.research/` 下未跟踪新文件/目录（git 记法
       *  原样, 整目录含 `/` 后缀）; `tracked-modified` = `.research/` 下
       *  跟踪文件有未提交变更。 */
      readonly subkind: 'untracked-new' | 'tracked-modified'
      /** repo-root-relative 路径（`.research/` 下）。 */
      readonly path: string
      readonly recommendedTier: ReconciliationTier
      readonly tierReason: TierReasonCode
    }
  | {
      readonly id: string
      readonly category: 'ARTIFACT_RECOVERABLE'
      readonly subkind: 'found'
      /** 文件重新出现的 repo-root-relative 路径（= artifact `uri` 换算）。 */
      readonly path: string
      /** artifact 行 id（当前状态必为 MISSING — 机械前提）。 */
      readonly artifactId: string
      /** 行所属 workstream（机械透出, 同上）。 */
      readonly workstreamId: string
      readonly recommendedTier: ReconciliationTier
      readonly tierReason: TierReasonCode
    }

/**
 * classification 报告 — `classifyDiscrepancies` 输出。
 * `discrepancies` 按 (category, subkind, path) 字节序排序, `id` 依序
 * 分配（`RD-<n>`）— 同输入逐字段同报告（确定性, tests 钉）。
 */
export interface DiscrepancyReport {
  /** 输入回显（可审计; 无时间戳）。 */
  readonly input: {
    readonly workspaceRoot: string
    readonly artifactCount: number
    readonly discoveryScanned: boolean
    readonly fedUntracked: boolean
    /** discovery `diff.firstScan` 回显（无 fs 扫描 = `false`）。 */
    readonly firstScan: boolean
  }
  readonly discrepancies: readonly Discrepancy[]
  /** 5 类别计数（无 = 0 — 全类别键齐备, 消费方免判空）。 */
  readonly byCategory: Readonly<Record<DiscrepancyCategory, number>>
}

/* ------------------------------------------------------------------ *
 * Reconciliation 三档（任务书目标 2 — §22.3 原文逐字）
 * ------------------------------------------------------------------ */

/** §22.3 三档（逐字; 封闭集 — 第四档在类型面上不存在）。 */
export type ReconciliationTier =
  | 'AUTO_RECONCILE'
  | 'PROPOSE_RECONCILIATION'
  | 'ESCALATE'

/** 冻结三档集（tests 漂移 guard）。 */
export const RECONCILIATION_TIERS: readonly ReconciliationTier[] = [
  'AUTO_RECONCILE',
  'PROPOSE_RECONCILIATION',
  'ESCALATE',
]

/**
 * 用户显式档位选择中「标记忽略」的处置值（任务书目标 2 原文列举
 * 「登记 Inbox/引导用户补声明/标记忽略」的第四面 — 三档之外的用户
 * 处置: 该 discrepancy 不入任何下游, 仅留忽略标记; 无 Inbox、无
 * Intervention、无 History 事件）。与三档并列于 `choice` 判别位。
 */
export const IGNORE_CHOICE = 'IGNORE' as const
export type IgnoreChoice = typeof IGNORE_CHOICE

/** 档位选择值 = 三档 + 忽略（封闭联合）。 */
export type ReconcileChoice = ReconciliationTier | IgnoreChoice

/**
 * 机械推荐档位理由码（冻结; 每档映射一条, 无第二理由 — 用户门展示面
 * 「为什么推荐这档」的机器可读形式, 非语义解释）:
 *
 *  - `ZONE_DECLARED` — 声明 zone 内的未注册文件: 缺口高置信
 *    （§22.3 AUTO「高置信 provenance 缺口」— zone 声明本身是用户先验）;
 *  - `URI_MATCH` — uri 相等即身份（§7.3 找回: 高置信）;
 *  - `CHECKPOINT_GAP` — `.research/` 变化缺口 = 未 checkpoint（§14/§22.4:
 *    声明态变化登记方式唯一, 高置信）;
 *  - `OUT_OF_ZONE` — zone 外未注册文件: 可能是产物也可能是杂项 —
 *    §22.3 PROPOSE「可能匹配但需确认」;
 *  - `TRACKED_CHANGE_CONFIRM` — tracked 变更与注册面的关系需人确认 —
 *    §22.3 PROPOSE「可能匹配但需确认」;
 *  - `DECLARED_LOSS` — 声明物缺席 = 高影响/损失 — §22.3 ESCALATE
 *    「高影响/未知/损失 → Intervention」。
 */
export type TierReasonCode =
  | 'ZONE_DECLARED'
  | 'URI_MATCH'
  | 'CHECKPOINT_GAP'
  | 'OUT_OF_ZONE'
  | 'TRACKED_CHANGE_CONFIRM'
  | 'DECLARED_LOSS'

/** 每档的机械处理动作（任务书「每档的处理动作」— 冻结映射, 见 tiers.ts
 *  `TIER_ACTION`: AUTO → 登记 Inbox; PROPOSE → 引导用户补声明（Inbox +
 *  声明提案）; ESCALATE → Intervention（`AUDIT_HIGH_IMPACT_DISCREPANCY`
 *  机械触发, origin `AUTO_AUDIT`）。**不改写历史**: 三个动作的产物全部
 *  是**新建对象**的纯数据草稿 — 类型面上不存在任何对已有 History 事件 /
 *  operational 行的 update/delete/rewrite 形态。 */
export type TierActionKind =
  | 'INBOX_CAPTURE'
  | 'PROPOSE_DECLARATION'
  | 'ESCALATE_INTERVENTION'

/* ------------------------------------------------------------------ *
 * 用户门（任务书「档位选择 = 用户显式（类型面 UserActor）」）
 * ------------------------------------------------------------------ */

/**
 * USER actor ref（冻结 `actorRef` 限制到 kind=USER — 同 WP-5.1
 * `UserActorRef` 形状）。`reconcileDiscrepancies` 的 actor 参数类型:
 * AGENT/PLUGIN/SYSTEM actor 是 **COMPILE 错误**（INV-PERM-4 类型面）;
 * 运行时伪造仍被 RECON_ACTOR_FORBIDDEN 拒绝（运行面, tests 钉死）—
 * 双面拒绝, 同 WP-3.4/WP-5.1 先例。
 */
export interface ReconcileUserActorRef {
  readonly kind: 'USER'
  readonly user_id?: string
  readonly label?: string
}

/** 默认用户 actor（§6 权限矩阵 U 列）。 */
export const RECONCILE_USER_ACTOR: ReconcileUserActorRef = { kind: 'USER', label: 'user' }

/* ------------------------------------------------------------------ *
 * 档位选择 / 结果
 * ------------------------------------------------------------------ */

/** 用户对一条 discrepancy 的显式选择（三档或忽略）。 */
export interface ReconcileDecision {
  /** 报告内寻址 id（`RD-<n>`, classify 分配）。 */
  readonly refId: string
  readonly choice: ReconcileChoice
}

/** 每档动作的产物（封闭联合 — 不存在第四形态, tests 钉）。 */
export type TierAction =
  | {
      readonly kind: 'INBOX_CAPTURE'
      readonly refId: string
      readonly inbox: InboxEntryDraft
    }
  | {
      readonly kind: 'PROPOSE_DECLARATION'
      readonly refId: string
      readonly inbox: InboxEntryDraft
      /** 声明提案（机械; `null` = 该类别无机械可提声明 — 仅 Inbox 留痕）。 */
      readonly proposal: DeclarationProposal | null
    }
  | {
      readonly kind: 'ESCALATE_INTERVENTION'
      readonly refId: string
      readonly intervention: InterventionRequest
    }
  | {
      readonly kind: 'IGNORED'
      readonly refId: string
    }

/**
 * reconciliation 结果（纯数据 — 本层零持久化: Inbox 落库归 WP-6.4,
 * Intervention 创建归 WP-5.1 `createMechanicalIntervention`, 本层只
 * 构造其参数草稿）。全部列表按 refId 排序; `at` = 注入 `now`（Inbox
 * `created_at` 面）; 输入未被改动（readonly 契约 + tests 深冻结钉）。
 */
export interface ReconcileOutcome {
  readonly actor: ReconcileUserActorRef
  readonly at: number
  /** AUTO + PROPOSE 档的 Inbox 草稿（§11; 落库归 WP-6.4）。 */
  readonly inboxDrafts: readonly InboxEntryDraft[]
  /** PROPOSE 档的声明提案（引导用户补声明 — 用户/Agent 经既有显式
   *  登记流执行, 本层不代写声明, §7.3「显式注册时成为 Artifact」）。 */
  readonly proposals: readonly DeclarationProposal[]
  /** ESCALATE 档的 Intervention 请求（WP-5.1 接缝; origin AUTO_AUDIT）。 */
  readonly interventionRequests: readonly InterventionRequest[]
  /** 「标记忽略」的 refId（无下游产物 — 纯标记）。 */
  readonly ignored: readonly string[]
  /** 每决策的已应用动作（可审计; 键 = refId, 与 decisions 1:1）。 */
  readonly byRef: ReadonlyMap<string, TierAction>
}

/* ------------------------------------------------------------------ *
 * Inbox 接缝（任务书目标 4 — WP-6.4 消费）
 * ------------------------------------------------------------------ */

/**
 * `InboxSource` 冻结 7 值中本层使用的 2 值子集（DOMAIN_SCHEMA §1.4 /
 * 计划书 §28 来源表逐字）: 未注册 workspace 变化用同名来源; 其余
 * audit 发现（tracked 未声明 / 声明缺失 / 声明未登记 / 找回）用
 * 「未分类 audit 发现」。
 */
export type ReconcileInboxSource =
  | 'UNREGISTERED_WORKSPACE_CHANGE'
  | 'UNCLASSIFIED_AUDIT_FINDING'

/** 冻结来源映射（机械; tests 钉）: 类别 → Inbox source。 */
export const CATEGORY_INBOX_SOURCE: Readonly<Record<DiscrepancyCategory, ReconcileInboxSource>> = {
  UNREGISTERED_WORKSPACE_CHANGE: 'UNREGISTERED_WORKSPACE_CHANGE',
  TRACKED_UNDECLARED: 'UNCLASSIFIED_AUDIT_FINDING',
  DECLARED_MISSING: 'UNCLASSIFIED_AUDIT_FINDING',
  RESEARCH_UNCHECKPOINTED: 'UNCLASSIFIED_AUDIT_FINDING',
  ARTIFACT_RECOVERABLE: 'UNCLASSIFIED_AUDIT_FINDING',
}

/**
 * Inbox 条目草稿（§11 字段 1:1 子集 — `id` 与 `converted_to` 归 WP-6.4:
 * id 经共享分配器, `converted_to` 需用户显式确认「需显式确认或明确
 * policy」§28/§11）。`state` 恒 `CAPTURED`（§13 状态机入口态 —
 * 本层不产生 CONVERTED/DISMISSED, 那些是用户终态操作, INV-PERM-4 面）。
 */
export interface InboxEntryDraft {
  readonly source: ReconcileInboxSource
  /** 机械文本摘要（确定性构造, 无自由语义 — category/subkind/path/
   *  tier 的机械拼装; 人可读但零推断）。 */
  readonly payload: string
  /** §11 `raw`「原始数据（如 audit finding 细节）」= 结构化 Discrepancy。 */
  readonly raw: Discrepancy
  /** §11 `context_refs` — 机械引用（artifact 行 / 所属 workstream;
   *  形状 = `TypedRef` 结构镜像, 封闭于 {ARTIFACT, WORKSTREAM}）。 */
  readonly contextRefs: readonly InboxContextRef[]
  readonly state: 'CAPTURED'
  /** §11 `created_at`（注入 `now` — epoch ms）。 */
  readonly createdAt: number
}

/**
 * `context_refs` 元素（冻结 `typedRef` 结构镜像 — 本层只发两种 kind,
 * 封闭机械子集; 消费方可直接当 `TypedRef` 用, kind ∈ `ObjectKind`）。
 * 不 import history/registry（层方向: audit 不得依赖 history, §2.2）。
 */
export interface InboxContextRef {
  readonly kind: 'ARTIFACT' | 'WORKSTREAM'
  readonly id: string
}

/* ------------------------------------------------------------------ *
 * 声明提案（PROPOSE 档 — 「引导用户补声明」的机器面）
 * ------------------------------------------------------------------ */

/**
 * 声明提案（封闭 3 形态, 全部机械材料, 全部指向**既有显式流** —
 * 本层不执行任何登记; 用户/Agent 经原有权限面执行, §6 矩阵 +
 * §7.3「显式注册」）:
 *
 *  - `ARTIFACT_REGISTER` — 引导把该路径注册为 Artifact（用户/Agent 可
 *    写「记录 Artifact」§6 矩阵; `suggestedType` = 机械猜测, 用户可改）;
 *  - `ARTIFACT_CHANGE_CONFIRM` — 该 tracked 变更的 `uri` 精确匹配一个
 *    已注册 artifact（「可能匹配但需确认」的确认面）;
 *  - `CHECKPOINT` — 引导对 `.research/` 变化执行 Research checkpoint
 *    （§6 矩阵: Save Research Checkpoint 仅用户 — 声明态变化的登记
 *    方式, §14/§22.4）。
 */
export type DeclarationProposal =
  | {
      readonly kind: 'ARTIFACT_REGISTER'
      /** repo-root-relative 路径（引导注册的对象）。 */
      readonly path: string
      /** 机械类型猜测（WP-6.2 冻结表; feed 条目无类型信号时 = OTHER —
       *  永不 null; 用户确认时可改）。 */
      readonly suggestedType: ArtifactType
      /** 匹配 zone（workspace-root-relative; 无 = null）。 */
      readonly zone: string | null
      /** zone `artifact_types` 提示（原样透出）。 */
      readonly zoneArtifactTypes: readonly ArtifactType[]
      /** 匹配到的注册 artifact（有 = 该路径已声明, 引导转为确认;
       *  分类器层面此情形不产生本提案 — 字段留全为接缝完备）。 */
      readonly matchedArtifactId: string | null
    }
  | {
      readonly kind: 'ARTIFACT_CHANGE_CONFIRM'
      readonly path: string
      readonly artifactId: string
      readonly subkind: 'modified' | 'deleted' | 'renamed' | 'unmerged'
    }
  | {
      readonly kind: 'CHECKPOINT'
      /** 引导 checkpoint 的 `.research/` 路径集（排序; 机械 = 该类别
       *  discrepancy 的路径）。 */
      readonly paths: readonly string[]
    }

/* ------------------------------------------------------------------ *
 * Intervention 接缝（ESCALATE 档 — WP-5.1 `createMechanicalIntervention`
 * 参数草稿; 字段逐位对齐, tests 钉）
 * ------------------------------------------------------------------ */

/**
 * 机械触发种类（WP-3.5 `MECHANICAL_TRIGGER_KINDS` 闭集成员逐字 —
 * §16.3/ARCHITECTURE 脚注 ¹「audit 高影响 unresolved discrepancy」;
 * 本地镜像避免 audit → service 层逆依赖, 对齐由 tests 钉）。
 */
export const AUDIT_HIGH_IMPACT_TRIGGER = 'AUDIT_HIGH_IMPACT_DISCREPANCY' as const

/**
 * Intervention 请求草稿（§9.2 字段面 + WP-5.1 `MechanicalInterventionCreateParams`
 * 形状 1:1 — 消费方 `createMechanicalIntervention(request.params 等价面,
 * request.actor)`; `origin`/`actor` 由触发种类冻结推导（catalog §5.7:
 * origin=AUTO_* ⇒ PLUGIN）, 与 WP-5.1 `MECHANICAL_TRIGGER_ORIGIN` /
 * `MECHANICAL_TRIGGER_ACTOR_KIND` 同口径）。
 */
export interface InterventionRequest {
  /** 机械标题（`[audit] <category>: <path>` — 确定性）。 */
  readonly title: string
  /** 机械详情（类别/子形态/信号/路径/tier 理由的拼装; 零推断）。 */
  readonly detail: string
  /** §9.2 `source_refs` — 指向触发对象（artifact 行; 无 artifact 关联
   *  = 空集 — 无 WS 关联的 Intervention 不产生 History 事件, catalog
   *  §5.7 口径由 WP-5.1 执行）。 */
  readonly sourceRefs: readonly InboxContextRef[]
  /** 关联 WS（artifact 所属 workstream; 无 = 空集）。 */
  readonly workstreamIds: readonly string[]
  /** 机械触发种类（INV-ATTN-5 闭集成员 — 逐字）。 */
  readonly trigger: typeof AUDIT_HIGH_IMPACT_TRIGGER
  /** origin（冻结推导 = AUTO_AUDIT, WP-5.1 映射同值）。 */
  readonly origin: 'AUTO_AUDIT'
  /** actor（冻结推导 = PLUGIN, catalog §5.7 AUTO_* ⇒ PLUGIN）。 */
  readonly actor: { readonly kind: 'PLUGIN' }
}

/* ------------------------------------------------------------------ *
 * 错误面
 * ------------------------------------------------------------------ */

export type ReconcileErrorCode =
  /** 输入/选择畸形（未知 refId / 重复决策 / 非法 choice / 空路径等 —
   *  精确指名失败项; 全部前置校验, 零部分输出）。 */
  | 'RECON_INPUT'
  /** 非用户 actor 触达档位选择面（INV-PERM-4 运行面; 类型面在参数
   *  类型上 — 双面拒绝）。 */
  | 'RECON_ACTOR_FORBIDDEN'
  /** 档位值不在 §22.3 三档封闭集内（字符串面伪造, 运行面拦截）。 */
  | 'RECON_TIER_UNKNOWN'
