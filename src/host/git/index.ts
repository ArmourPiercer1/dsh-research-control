/**
 * WP-1.2 — Git wrapper: public surface.
 *
 * 全仓唯一允许 spawn git 的层 (INV-GIT-6 / ARCHITECTURE §2.2 rule 3)。
 *
 * 本面 = 冻结 W1–W13 白名单 (GIT_INTEGRATION §3) 的具名函数一一映射 + 两个
 * 组合原语:
 *   - detectConflictState (§5.1 冲突状态检测)
 *   - saveCheckpoint (§5 checkpoint 流程的 git 半边; 步骤 6 ManagementAction
 *     是 WP-1.5 service 半边)
 *
 * 白名单外命令**不可达** (双保险):
 *   - 类型面: 本文件不导出任何通用 run/exec/spawn — 测试
 *     tests/git/inv-git-static.test.ts 静态断言导出集合恰好为下述函数;
 *   - 运行时: runner 在每次 spawn 前校验 argv 精确形状, 非白名单抛
 *     GitWhitelistViolationError (INV-GIT-7)。
 *
 * 本层不做任何领域逻辑: 不解析/校验 .research/ 内容, 不写 ManagementAction
 * (ARCHITECTURE §2.2; 边界: 「git/ 层是唯一允许调用 git 的层」, 无 domain/service import)。
 *
 * V2 (design §3.1 Q4, 树目录名可配置): 附加暴露 tree-scope 面
 * ({@link scopeFor} / {@link isWithinCommitScopeFor} /
 * {@link DEFAULT_RESEARCH_TREE_SCOPE} / {@link DEFAULT_TREE_DIR} /
 * {@link ResearchTreeScope}) — 纯解析/断言工具, 不增加任何 git 能力
 * (W1–W13 集合与默认 argv 不变; inv-git-static 的函数导出清单同步
 * 记录这 2 个 V2 附加函数)。
 */
export type {
  CheckpointResult,
  ConflictFlags,
  ConflictState,
  DiffEntry,
  FileLogEntry,
  GitHead,
  GitOptions,
  GitRunResult,
  GitStatus,
  RepoDetection,
  StatusEntry,
} from './types.js'
export { DEFAULT_GIT_MAX_OUTPUT_BYTES, DEFAULT_GIT_TIMEOUT_MS } from './types.js'
export {
  GitCommandError,
  GitConflictStateError,
  GitError,
  GitInputError,
  GitMissingError,
  GitScopeViolationError,
  GitTimeoutError,
  GitWhitelistViolationError,
} from './errors.js'
export {
  DEFAULT_RESEARCH_TREE_SCOPE,
  DEFAULT_TREE_DIR,
  LOG_FORMAT_ARG,
  RESEARCH_PATHSPEC,
  RESEARCH_STATE_EXCLUDE_SPEC,
  RESEARCH_STATE_PATHSPEC,
  WHITELIST_ROWS,
  isWithinCommitScope,
  isWithinCommitScopeFor,
  scopeFor,
  type ResearchTreeScope,
  type WhitelistRow,
} from './whitelist.js'
export {
  CHECKPOINT_MESSAGE_PREFIX,
  commitResearch,
  detectRepo,
  diffNameStatus,
  hashObject,
  initRepo,
  logFile,
  lsFiles,
  parsePorcelainV2,
  resolveGitDir,
  restoreFile,
  revParseHead,
  showFile,
  stageResearch,
  status,
  type LogCallOptions,
  type StatusCallOptions,
  unquotePath,
} from './operations.js'
export { detectConflictState } from './conflict.js'
export { saveCheckpoint } from './checkpoint.js'
