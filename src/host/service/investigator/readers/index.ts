/**
 * WP-7.2 — `src/host/service/investigator/readers` — 公共面（唯一 import
 * 点）。
 *
 * 上下文 readers（只读面）+ 组装器（计划书 §26.1 Read-only Investigator
 * 的上下文数据面 — 任务书主线目标 1/2）:
 *
 *  - {@link PluginStateReader}   — 1/5 plugin 状态快照（声明式树 +
 *    事件史折叠 Current 投影 + run 表 + Intervention + 语义计数）;
 *  - {@link SessionQueryReader}  — 2/5 session 查询（经 sessionlink
 *    指针面 — INV-DB-2 绑定真值）;
 *  - {@link GitDiffReader}       — 3/5 git diff（经 audit strict 面
 *    `runStrictAudit` W1/W4/W5/W13 — 报告原样透出）;
 *  - {@link GitLogReader}        — 4/5 git log（经 git 白名单 W6 只读
 *    面 — 声明式树路径的文件历史）;
 *  - {@link ArtifactRefsReader}  — 5/5 artifact refs（经语义注册表 —
 *    §7.3「registry, 不复制内容」, 全状态保留）;
 *  - {@link investigationContext} — 组装器: `investigationContext(topicOrWs)`
 *    → 五段聚合（单类失败 = 结构化失败段, 不吞其余 — 默认 transient,
 *    §26.2; AnalysisRecord 显式保存归 WP-7.3）;
 *  - {@link createWiringReaders} — 生产组装（HostWiring → 五类窄 face;
 *    fresh 读取, 零新 I/O 通道）。
 *
 * 只读边界（类型面）: 公开面零写方法 — 全部读者只有 `read(scope)`;
 * 全部输出 readonly 结构; 零 DSH import（INV-PERM-5）。
 *
 * 层边界（ARCHITECTURE §2.2）: service 层 — 消费 domain（type-only +
 * 树加载）/ history（折叠 + derived 行）/ git（W6 只读）/ audit
 * （strict 面）/ persistence（meta KV 经 wiring 注入面）; 组合根
 * （wiring）消费本包（from-wiring 的 HostWiring 面为 type-only —
 * 无运行时环）。
 */

export {
  isReaderError,
  ReaderError,
  assertInvestigationScope,
  type InvestigationScope,
  type ReaderErrorCode,
  type ReaderFailure,
  type ReaderSection,
  type PluginStateSnapshot,
  type PluginStateTask,
  type PluginStateWorkstream,
  type PluginStateRun,
  type PluginStateIntervention,
  type PluginStateSemanticCounts,
  type SessionQuerySnapshot,
  type SessionQueryEntry,
  type SessionPointerProjection,
  type GitDiffSnapshot,
  type GitLogSnapshot,
  type GitLogEntryProjection,
  type ArtifactRefsSnapshot,
  type ArtifactRefProjection,
  type InvestigationContext,
} from './types.js'
export {
  PluginStateReader,
  type FoldedTaskStates,
  type PluginStateReaderInput,
  type PluginStateRunRow,
  type PluginStateInterventionRow,
} from './plugin-state.js'
export {
  SessionQueryReader,
  type SessionQueryReaderInput,
  type SessionPointerRow,
  type SessionQueryRunRow,
} from './session-query.js'
export { GitDiffReader, type GitDiffReaderInput } from './git-diff.js'
export { GitLogReader, DEFAULT_LOG_MAX_COUNT, type GitLogReaderInput } from './git-log.js'
export { ArtifactRefsReader, type ArtifactRefsReaderInput } from './artifact-refs.js'
export { investigationContext, type InvestigationReaders } from './context.js'
export { createWiringReaders, type WiringReadersOptions } from './from-wiring.js'
