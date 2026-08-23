/**
 * WP-6.1 — workspace policy + strict git audit: 类型面.
 *
 * Frozen contracts:
 *  - GIT_INTEGRATION §8 (Workspace Audit 集成 — strict tracked 层使用
 *    W4 `status --porcelain=v2` / W5 `diff --name-status [<baseline>]` /
 *    W13 `ls-files -- <pathspec>`; audit 只回答「工作区发生了哪些插件尚未
 *    登记的变化」, 不推断科研含义);
 *  - GIT_INTEGRATION §3 表 W4/W5/W13 行 (触发 = 自动, 白名单内只读操作);
 *  - DOMAIN_SCHEMA §14.1 (workspace.yaml 工程默认结构 — policy 字段);
 *  - 计划书 §22.1 (Audit 三层: strict tracked / discovery zones / ignored —
 *    本 WP 只交付第一层的 git 面, 二三层归 WP-6.2/6.3).
 *
 * 只读边界 (类型面证明, 见 tests/audit-strict/read-only.test.ts):
 *  - 本模块唯一 git 能力来源 = src/host/git 公开面, 且只用 W1/W4/W5/W13
 *    四个**自动触发**只读操作; W6–W12 (含全部写能力 W8/W9/W10/W12) 在类型
 *    面上不可达;
 *  - 零 node:fs / node:child_process import — audit 是「纯 git + 纯函数」,
 *    无任何文件 I/O (discovery 层 fs 扫描归 WP-6.2);
 *  - 与 §5.1 冲突检测**正交**: audit 是读操作, 不受 merge/rebase 等进行中
 *    操作阻塞 (GIT_INTEGRATION §9 读操作行), 冲突门禁仅 checkpoint 前置。
 */
import type {
  DiffEntry,
  GitHead,
  GitOptions,
} from '../../git/index.js'
import type { ArtifactType, WorkspaceAuditZone } from '../../domain/loader/index.js'

/* ------------------------------------------------------------------ *
 * Workspace policy (§14.1 归一化)
 * ------------------------------------------------------------------ */

/** 一个 discovery zone (DOMAIN_SCHEMA §14.1 `audit.discovery_zones` 元素). */
export interface AuditDiscoveryZone {
  /** 相对 workspace root 的路径 (§14.1 示例: `results/`). */
  path: string
  /** 可选: 该 zone 期望的 ArtifactType (发现分类提示; §14.1). */
  artifactTypes?: readonly ArtifactType[]
}

/**
 * 归一化 workspace policy — 从 `.research/workspace.yaml` (loader 侧
 * `WorkspaceDoc`, §14.1 工程默认结构, 经冻结 schema 校验) 读出的 audit 面.
 *
 * 全部字段 readonly 且数组/对象为冻结副本: policy 一经归一化即不可变,
 * audit 报告与下游 (WP-6.2/6.3) 可安全共享引用。
 */
export interface AuditPolicy {
  /** `workspace.root` — 相对 Git repo root (§14.1; 缺省 `.`). */
  readonly workspaceRoot: string
  /** `workspace.git_required` (INV-GIT-1; 缺省 true). */
  readonly gitRequired: boolean
  /** `audit.strict_tracked.paths` — 严格跟踪资源 pathspec (缺省 []). */
  readonly strictTrackedPaths: readonly string[]
  /** `audit.discovery_zones` (缺省 []; 本 WP 只透传, 扫描归 WP-6.2). */
  readonly discoveryZones: readonly AuditDiscoveryZone[]
  /** `audit.ignored` — 第三层忽略目录 (缺省 []; 本 WP 只透传). */
  readonly ignored: readonly string[]
}

/* ------------------------------------------------------------------ *
 * Strict audit 输入
 * ------------------------------------------------------------------ */

/** `runStrictAudit` 输入. */
export interface StrictAuditOptions {
  /**
   * 注册 workspace 根 (绝对路径; 建议 = repo root, GIT_INTEGRATION §2)。
   * 内部经 W1 解析 repo root, 全部 git 调用 `-C` repo root, 报告路径一律
   * 相对 repo root (workspace root ≠ repo root 时 policy pathspec 由本层
   * 前缀换算, §3 说明「插件负责前缀换算」)。
   */
  workspaceRoot: string
  /**
   * 归一化 policy (经 {@link normalizeWorkspacePolicy} 从 loader 侧
   * `WorkspaceDoc` 得到)。缺省 = 全工程默认 (无 strict pathspec —
   * strict 层空集; `.research/` 一致性检查仍执行)。
   */
  policy?: AuditPolicy
  /**
   * W5 基线 (全量 40-hex commit OID)。缺省 = 未暂存模式
   * (`git diff --name-status` = index ↔ worktree); 给定 = 基线 ↔ worktree
   * (暂存+未暂存合并视图)。白名单边界: W5 冻结形状是**单基线**, 两 commit
   * 直接 diff 不可达 (WP-1.5 diff 服务同口径注记)。
   */
  baseline?: string
  /** git wrapper 逐次调用护栏 (超时/输出上限/可执行路径; GIT_INTEGRATION §1.9). */
  gitOptions?: GitOptions
}

/* ------------------------------------------------------------------ *
 * Strict audit 报告 (AuditReport)
 * ------------------------------------------------------------------ */

/**
 * 一个已跟踪 (tracked/renamed/unmerged) 文件的变更分类
 * (W4 `status --porcelain=v2` X/Y 字符语义, git-status(1):
 *  `.` = unchanged, `M` = modified, `D` = deleted, `A` = added (含 intent-to-add),
 *  `R` = rename (X 侧), 冲突态 `U` 等).
 */
export interface StrictTrackedChange {
  /** 相对 repo root 的路径 (rename = 新路径). */
  path: string
  /** W4 行类型 (u 行 = 冲突条目). */
  kind: 'tracked' | 'renamed' | 'unmerged'
  /** Index 状态字符 (X): 相对 HEAD 的**已暂存**侧。 */
  x: string
  /** Worktree 状态字符 (Y): 相对 index 的**未暂存**侧。 */
  y: string
  /** 已暂存变更 (X ≠ `.`)。 */
  staged: boolean
  /** 工作树未暂存变更 (Y ≠ `.`)。 */
  worktreeModified: boolean
  /** 删除已暂存 (X = `D`)。 */
  stagedForDeletion: boolean
  /** 工作树中已消失 (Y = `D`)。 */
  deletedInWorktree: boolean
  /** rename/copy 源路径 (kind='renamed' 时). */
  origPath?: string
  /**
   * W5 diff 摘要中该路径的状态 token (M/A/D/T/R##) — 仅当该路径出现在
   * 本次 `diffSummary` 中 (无 baseline 时只覆盖未暂存侧; 暂存-only 变更
   * 在 unstaged diff 中不可见 = 白名单形状使然, W4 X/Y 是权威分类)。
   */
  diffStatus?: string
}

/**
 * `.research/` 声明式树一致性 (git 视图)。
 *
 * 「一致」= 插件已登记的内容 (HEAD/index) 与 working copy 之间, `.research/`
 * 下无任何未提交变化 (暂存/未暂存/未跟踪/缺失全无)。这是 checkpoint
 * 前置语义 (§5 步骤 2) 的**只读投影** — audit 报告它, 不阻断、不触发。
 */
export interface ResearchConsistency {
  /** `.research/**` 下有暂存或工作树变更的跟踪文件 (含 rename 新路径). */
  trackedModified: string[]
  /** `.research/` 下的未跟踪新文件/目录 (git untracked 记法, 整目录含 `/` 后缀). */
  untracked: string[]
  /**
   * 已跟踪但消失的文件 — 并集 (两词各有独立权威源):
   * W13 `.research/` 基线集 ∩ W4 删除 (工作树删除, 仍在 index) ∪
   * W4 D 条目已离开基线 (暂存删除, git rm 后离开 index; git 权威:
   * D 状态只可能出自 tracked 文件)。
   */
  missing: string[]
  /** trackedModified/untracked/missing 全空. */
  consistent: boolean
}

/**
 * 严格跟踪资源层 (计划书 §22.1 第一层; policy `audit.strict_tracked.paths`).
 * W13 `ls-files -- <pathspec>` 给出**当前权威 tracked 集** (§3 表 W13 行:
 * 「判定 strict tracked 路径集内的删除/缺失」), W4 给出变更分类。
 */
export interface StrictTrackedReport {
  /** 实际查询的 pathspec (repo-root-relative, 已做 workspace 前缀换算). */
  pathspecs: string[]
  /** W13 各 pathspec 枚举的 tracked 文件并集 (排序去重; 含 intent-to-add). */
  tracked: string[]
  /** tracked 集中有暂存/工作树变更的成员. */
  modified: string[]
  /**
   * 被删除的成员 — 并集 (两词各有独立权威源):
   * W13 基线集 ∩ W4 删除 (工作树删除) ∪ W4 D 条目已离开基线且匹配声明
   * pathspec (git-glob 语义) 的暂存删除。
   */
  deleted: string[]
}

/**
 * strict git audit 报告 — 结构化输出 (目标 2)。
 *
 * 三个目标清单 (任务书):
 *  - **tracked 修改清单** = {@link AuditReport.trackedChanges} (全仓 W4 分类)
 *    + {@link AuditReport.diffSummary} (W5 摘要);
 *  - **新文件清单** = {@link AuditReport.newFiles} (W4 untracked, 按
 *    `.research/` 内外分列 — 外层是 WP-6.2 discovery 的输入);
 *  - **`.research/` 一致性** = {@link AuditReport.research}。
 *
 * 边界 (GIT_INTEGRATION §8): 只回答「发生了哪些插件尚未登记的变化」,
 * 不推断科研含义; reconciliation 三档归 WP-6.3, 不改写历史。
 * 确定性: 所有列表按路径字典序排序, 报告无时间戳 — 同仓同输入逐字节同报告。
 */
export interface AuditReport {
  /** W4 分支头 (branch 名/upstream/ahead-behind 或 detached; 空仓无 OID). */
  head: GitHead | null
  /** 回显本次 W5 基线 (undefined = 未暂存模式). */
  baseline?: string
  /** W4 tracked/renamed/unmerged 条目 — 全仓 (含 `.research/` 内外), 按路径排序. */
  trackedChanges: StrictTrackedChange[]
  /** W5 `--name-status` 摘要, 按路径排序 (rename 按新路径, 源路径见 oldPath). */
  diffSummary: DiffEntry[]
  /** W4 untracked — 未跟踪新内容 (目录为 git 记法 `dir/`, 不展开 — 展开归 WP-6.2 fs 扫描). */
  newFiles: {
    /** `.research/` 外: 未登记 workspace 变化的候选 (discovery 输入, §8 第二层). */
    outsideResearch: string[]
    /** `.research/` 内: 声明式树的新文件 (未经 checkpoint 登记). */
    insideResearch: string[]
  }
  /** `.research/` 声明式树一致性 (git 视图). */
  research: ResearchConsistency
  /** 严格跟踪资源层 (policy strict_tracked.paths; 空 policy = 空集). */
  strictTracked: StrictTrackedReport
  /**
   * 结构化警告 (不阻断, 读操作正常 — §9):
   *  - `AUDIT_DETACHED_HEAD` detached HEAD (读操作正常; checkpoint 才警告);
   *  - `AUDIT_EMPTY_REPO` 尚无提交 (W5 baseline 模式不可用);
   *  - `AUDIT_TRUNCATED` W4 输出超 maxOutputBytes (报告可能不完整);
   *  - `AUDIT_POLICY_MISMATCH` policy `workspace.root` 与实际 repo 相对位置不符。
   */
  warnings: { code: 'AUDIT_DETACHED_HEAD' | 'AUDIT_EMPTY_REPO' | 'AUDIT_TRUNCATED' | 'AUDIT_POLICY_MISMATCH'; message: string }[]
}
