/**
 * WP-1.5 — checkpoint/restore/diff 服务: 公开面.
 *
 * 显式触发面 (INV-GIT-2 / INV-GIT-5): 三个触发函数都只由用户动作 (GUI)
 * 直接调用 — 本模块无定时器、无事件监听、无 import 副作用; 每个函数要求
 * 注入 `StructuredLogger` 并对每一步记一条结构化日志。类型面证明 + 静态/
 * 行为断言: tests/checkpoint/explicit-trigger.test.ts (导出集合恰好 = 本
 * 清单; 源码零调度器/子进程面; 事件序列逐步锁定)。
 *
 * 依赖方向 (ARCHITECTURE §2.2): service → git 层具名 W 操作 (唯一 git 调用
 * 面) + domain/loader 公开面 (恢复后校验) + shared 常量 — 不 import DSH 包,
 * 不碰 domain/plan/topology 内部, 不直接 spawn。
 */
export {
  CheckpointServiceError,
  NotARepoError,
  RestoreFailedError,
  RestoreNotInHistoryError,
  RestoreVerifyError,
  StagedPreservationError,
} from './errors.js'
export { FsResearchReader } from './fs-reader.js'
export type { LogLevel, StructuredLogger } from './logger.js'
export { assertUnrelatedStagedPreserved, saveResearchCheckpoint } from './save.js'
export { restoreResearchFile } from './restore.js'
export { diffHistory } from './diff.js'
export {
  FULL_OID_RE,
  RESEARCH_DIR,
  type DiffHistoryOptions,
  type DiffHistoryResult,
  type RestoreOptions,
  type RestoreResult,
  type RestoreValidation,
  type SaveCheckpointOptions,
  type SaveCheckpointResult,
} from './types.js'
