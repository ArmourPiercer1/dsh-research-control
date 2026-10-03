/**
 * src/host/dsh-adapter/launcher — public surface (WP-7.1): the host half
 * of `DshAgentLauncherAdapter`（ARCHITECTURE §2.3 行 8 — 只读
 * Investigator Agent 的受限启动; DSH_ADAPTER §10.2 路径 A 执行体）。
 *
 * 本目录是 dsh-adapter 领地（INV-PERM-5 豁免）: 宿主面结构消费（零 DSH
 * devDep — 同 `../session.ts` 的 `RemoteContext` 模式）+ 已 pin 直接
 * 依赖 `@deepseek-ai/dsh-llm`（消息构造宿主同一真源）。0.2.0-rc.2:
 * preset 改走注册表声明式 `register`（`node:fs` 落盘与
 * `@deepseek-ai/dsh-home-paths` preset 根随之退役 — 本目录零文件系统
 * 副作用）。
 *
 * 生产装配（host service 构造此处实例 + 注入 `InvestigatorLauncher`）
 * 归后续接线 WP（非本 WP 授权路径 — 报告「未决问题」）; 本 WP 交付
 * injectable + 全测。
 */

export { HostAgentLauncherAdapter } from './adapter.js'
export {
  installInvestigatorRestrictionWatch,
  restrictInvestigatorCtx,
  type RestrictableAgent,
  type RestrictableAgentCtx,
  type RestrictionWatchContext,
} from './restriction-watch.js'
export type {
  AgentCtxLike,
  AgentLike,
  AgentHandleLike,
  AgentPresetLike,
  AgentPresetDocumentLike,
  PresetDefinitionLike,
  AgentPresetsLike,
  AgentsStoreLike,
  CommandExecutionLike,
  CommandsRuntimeLike,
  CreateAgentOptionsLike,
  LauncherHostContext,
} from './types.js'
