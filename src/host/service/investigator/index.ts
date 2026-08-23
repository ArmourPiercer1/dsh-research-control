/**
 * src/host/service/investigator — public surface (WP-7.1): the read-only
 * Investigator launcher (INV-PERM-3 — 无任何写路径).
 *
 * What this WP delivers:
 *  - the CLOSED type face（`InvestigatorLaunchRequest` — 4 fields, two
 *    literals: preset + permission are the ONLY launch parameters, a
 *    write capability is unexpressible — INV-PERM-3 编译期半边）;
 *  - the one-click seam（`buildInvestigationContext` +
 *    `InvestigatorLauncher.launch/launchFromIntervention` — Gate P7 三:
 *    能从 Intervention 一键启动并引用相关上下文）;
 *  - the preset face（`renderInvestigatorPresetComposition` +
 *    `parsePresetComposition` — agent.cordis.yml 闭集构造 + 严格回读,
 *    写工具行混入即拒）;
 *  - the runtime guards（`assertReadonlyLaunchRequest` /
 *    `assertInvestigationContext` / `assertReadonlyPermissionPreset` —
 *    非白名单能力即拒, 零宿主调用 — INV-PERM-3 运行面）;
 *  - the port（`DshAgentLauncherAdapter` — host 半边在
 *    `src/host/dsh-adapter/launcher/`, 同批交付）。
 *
 * NOT here（后续 WP）: 生产装配（wiring — 非本 WP 授权路径, 报告
 * 「未决问题」）、transient 结果 UI + AnalysisRecord 显式保存
 * （WP-7.3）、上下文 readers（WP-7.2: plugin state / session-query /
 * git diff/log / artifact refs 只读面）。
 *
 * Layer (ARCHITECTURE §2.2): service — 纯逻辑, 无 DSH import
 * (INV-PERM-5), 无 I/O（preset 文件落盘 = 适配器面）。
 */

export {
  INVESTIGATOR_PRESET_ID,
  INVESTIGATOR_PRESET_TOOL_NAMES,
  INVESTIGATOR_CAPABILITIES,
  INVESTIGATOR_DENIED_TOOL_NAMES,
  READ_ONLY_PERMISSION_PRESET,
  InvestigatorLaunchError,
  isInvestigatorLaunchError,
  type DshAgentLauncherAdapter,
  type InvestigationContext,
  type InvestigatorErrorCode,
  type InvestigatorLaunchRequest,
  type InvestigatorLaunchResult,
} from './types.js'
export { buildInvestigationContext, investigationTask } from './context.js'
export {
  parsePresetComposition,
  renderInvestigatorPresetComposition,
  assertReadonlyPermissionPreset,
  type InvestigatorPresetRow,
  type InvestigatorPresetSpec,
} from './preset.js'
export {
  assertInvestigationContext,
  assertReadonlyLaunchRequest,
} from './guard.js'
export {
  InvestigatorLauncher,
  type InvestigatorLauncherOptions,
} from './launcher.js'
