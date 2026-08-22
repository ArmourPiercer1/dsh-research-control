/**
 * WP-1.5 — checkpoint/restore/diff 服务: 强类型输入/输出.
 *
 * 冻结契约: GIT_INTEGRATION.md (Frozen V1) §5 (Save Research Checkpoint 流程,
 * 含 §5.1 冲突检测前置 / §5.2 实测行为), §6 (历史查看与 Restore, W6/W7/W8),
 * §9 (错误分类); TEST_MATRIX.md TC-GIT-001..005/007..010/014.
 *
 * 层规则 (ARCHITECTURE §2.2): service 层允许编排 I/O 与 git — 但所有 git
 * 调用必须经 src/host/git 具名操作 (W1–W13), 本层从不直接 spawn; 恢复后的
 * schema 校验经 src/host/domain/loader 公开面 (注入式 reader, 纯领域内核)。
 *
 * 显式触发面 (INV-GIT-2 / INV-GIT-5): 本层三个公开函数都只由用户动作
 * (GUI 按钮/确认) 直接调用; 无定时器、无事件监听、无 import 副作用 —
 * 类型面证明 + 静态/行为测试见 tests/checkpoint/explicit-trigger.test.ts。
 * 每个函数要求注入 `StructuredLogger` 并对**每一步**记一条结构化日志
 * (event 命名 `<op>.<step>`, 见各模块头注释的事件清单)。
 */
import type { DiffEntry, FileLogEntry, GitOptions } from '../../git/index.js'
import type { ResearchLoadError } from '../../domain/loader/index.js'
import type { StructuredLogger } from './logger.js'

/**
 * `.research` 目录名 (repo-root-relative). 与 git 层冻结 pathspec
 * `RESEARCH_PATHSPEC = '.research/'` 同源 (INV-GIT-3 路径隔离): 本服务的
 * add/commit/restore 范围全部限定于此, workspace root = repo root 布局
 * (GIT_INTEGRATION §2 建议布局; 前缀换算由后续 workspace 注册 WP 承担)。
 */
export const RESEARCH_DIR = '.research'

/** Full 40-hex commit OID — 与 git 层白名单同界 (W7/W8 只收全量 OID)。 */
export const FULL_OID_RE = /^[0-9a-f]{40}$/

/* ------------------------------------------------------------------ *
 * saveResearchCheckpoint (§5)
 * ------------------------------------------------------------------ */

export interface SaveCheckpointOptions extends GitOptions {
  /** 结构化日志注入 (每步一条; 无默认 — 强制显式接线). */
  logger: StructuredLogger
  /** 动作摘要; 最终 commit message 为 `research: <summary>` (§5 格式). */
  summary: string
}

/**
 * §5 结果. `committed=false` = 步骤 2 短路「无可提交内容」(成功, 不报错,
 * 无空 commit; TC-GIT-014) — 或步骤 2→4 之间变更消失的竞态 (同语义, §5.2)。
 */
export interface SaveCheckpointResult {
  /** false 仅当无变更短路 (成功空操作). */
  committed: boolean
  /** W11 `rev-parse HEAD` 全量 OID; 短路时为 null. */
  commitOid: string | null
  /**
   * 本次进入 commit 的 `.research/**` 路径 (repo-root-relative, 排序去重);
   * 短路时为 []. 范围恒为 `.research/**` (INV-GIT-3) — 无关变更绝不出现。
   */
  changedFiles: string[]
  /** 明确警告 (§5: detached HEAD 允许但警告; 意外残留的 .research 条目). */
  warnings: string[]
  /** 实际使用的 commit message (`research: <summary>`); 短路时缺省. */
  message?: string
}

/* ------------------------------------------------------------------ *
 * restoreResearchFile (§6, W6 定位 + W7 预取 + W8 恢复 + loader 校验)
 * ------------------------------------------------------------------ */

export interface RestoreOptions extends GitOptions {
  /** 结构化日志注入. */
  logger: StructuredLogger
  /** 冻结声明式 schema 目录 (恢复后 loader 校验用, §6「恢复后触发该文件的 schema 校验」). */
  schemaDir: string
}

/** 恢复后的 loader 校验结论 (针对被恢复文件, §6). */
export interface RestoreValidation {
  /** true = 被恢复文件无 loader 错误 (schema/路径规则/引用完整性均过). */
  ok: boolean
  /** 精确定位的 loader 错误 (file 相对 .research/ 根 + 文档内 path + summary). */
  errors: ResearchLoadError[]
}

export interface RestoreResult {
  /** 被恢复路径 (repo-root-relative, 恒在 .research/** 内). */
  path: string
  /** 源版本 OID (全量 40-hex). */
  commitOid: string
  /** 恢复后 loader 校验 (§6): 非法内容不静默 — 失败时 errors 非空且文件保留原状. */
  validation: RestoreValidation
  /**
   * §6: 非法内容 → 警告并保留文件原状供用户处理, 不静默回滚 —
   * validation.ok=false 时此处必有对应警告。
   */
  warnings: string[]
}

/* ------------------------------------------------------------------ *
 * diffHistory (§6 查看: W6 版本列表 + W5 文件级差异 + W7 内容判定)
 * ------------------------------------------------------------------ */

export interface DiffHistoryOptions extends GitOptions {
  /** 结构化日志注入. */
  logger: StructuredLogger
  /**
   * 聚焦单个 `.research/**` 文件 (W6 对该文件的历史). 缺省 = 整个
   * `.research/**` (W6 对目录的路径记 — 列出触碰过 .research 的全部版本)。
   */
  path?: string
  /**
   * 基线版本 OID (全量 40-hex). W5 白名单形状是**单基线**
   * (`git diff --name-status [<baseline>]`): 差异面 = 基线版本 ↔ 当前
   * working tree (canonical current state, §9) 的文件级 M/A/D/R 摘要,
   * 范围限定 `.research/**` (INV-GIT-3)。两 commit 间直接 diff 不在
   * W1–W13 白名单内 (不可达, INV-GIT-7); 单文件两版本内容判定另由
   * W7 (pathContent) 提供。
   */
  baseline?: string
  /** W6 分页 (§9「输出超大」): 最多 N 条. */
  maxCount?: number
  /** W6 分页 (§9): 跳过最新 N 条. */
  skip?: number
}

export interface DiffHistoryResult {
  /** W6 版本列表, 新→旧 (冻结格式串 %H%x1f%aI%x1f%s 解析). */
  versions: FileLogEntry[]
  /** 基线 ↔ 当前 working tree 的文件级 M/A/D/R 摘要 (仅 .research/**); 未给 baseline 时缺省. */
  fileDiff?: DiffEntry[]
  /** fileDiff 对应的基线 OID. */
  baseline?: string
  /**
   * 单文件与基线版本的内容判定 (W7 showFile 与 working copy 逐字节比较);
   * 仅当 path 与 baseline 同时给出时存在。null = 基线 commit 不含该路径
   * (如该版本时尚未创建) 或目标是目录 (无单文件内容可比)。
   */
  pathContent?: { path: string; sameAsBaseline: boolean } | null
}
