/**
 * WP-7.1 — `InvestigatorLauncher`（任务目标 1 的 service 半边 + 任务目标 3
 * 的一键缝）: 从 `InvestigationContext` 构造只读启动请求, 过闭集断言,
 * 交给 `DshAgentLauncherAdapter` 端口（host 半边 = dsh-adapter/launcher,
 * 路径 A 执行: ensure preset → agents.create(+setup) → /permission
 * read-only → followup task）。
 *
 * 本类是**纯编排**（无 DSH import — INV-PERM-5; 无 I/O）:
 *  - `launch(context)` — 一键入口（Gate P7 三）: 上下文断言 →
 *    `buildRequest`（纯构造）→ 请求断言（INV-PERM-3 运行面 — 失败不
 *    触达端口）→ 端口 `launchInvestigator`（宿主面）;
 *  - `buildRequest(context)` — 纯构造（导出 — 测试钉全形态 + 未来接线
 *    复用; 构造值必然过断言: 字面量常量 + 已校验的 cwd/question）;
 *  - `presetComposition()` — 渲染 `agent.cordis.yml`（ensure 的输入 —
 *    文件落盘归适配器, 文本构造归本包: 组合文本是 service 的冻结产物,
 *    适配器只是搬运工 + 回读校验方）。
 *
 * 依赖注入: 构造器只收一个端口（`DshAgentLauncherAdapter`）— 零其他
 * 依赖（无 store / 无 registry / 无 allocator — 启动是瞬态操作, 输出
 * transient, 不落 operational DB, INV-PERM-3 / 计划书 §26.2）。
 */

import { buildInvestigationContext, investigationTask } from './context.js'
import { assertInvestigationContext, assertReadonlyLaunchRequest } from './guard.js'
import { renderInvestigatorPresetComposition } from './preset.js'
import {
  INVESTIGATOR_PRESET_ID,
  READ_ONLY_PERMISSION_PRESET,
  type DshAgentLauncherAdapter,
  type InvestigationContext,
  type InvestigatorLaunchRequest,
  type InvestigatorLaunchResult,
} from './types.js'

/** `InvestigatorLauncher` 构造选项（DI 面 — 同 WP-5.1/6.4 端口注入模式）. */
export interface InvestigatorLauncherOptions {
  /** 受限启动端口（host 半边 — dsh-adapter/launcher 实现; tests 注假）。 */
  readonly launcher: DshAgentLauncherAdapter
}

export class InvestigatorLauncher {
  readonly #launcher: DshAgentLauncherAdapter

  /**
   * @param options - the port-only options（fail loud on a missing port —
   *   构造期配置错是组合期错误, 不是调用期惊喜, 同 createResearchTools
   *   `assertDeps` 先例）。
   */
  constructor(options: InvestigatorLauncherOptions) {
    if (typeof options?.launcher?.launchInvestigator !== 'function') {
      throw new TypeError('InvestigatorLauncher: options.launcher.launchInvestigator must be the DshAgentLauncherAdapter port (the host half — src/host/dsh-adapter/launcher)')
    }
    this.#launcher = options.launcher
  }

  /**
   * 一键启动（任务目标 3 — Gate P7 三条之三）: Intervention 上下文 →
   * 只读 Investigator 会话 + 任务提交。
   *
   * 序（fail-fast, 失败零宿主调用）:
   *  1. `assertInvestigationContext`（运行面 — 上下文闭集）;
   *  2. `buildRequest`（纯构造 — 闭集 4 字段）;
   *  3. `assertReadonlyLaunchRequest`（INV-PERM-3 运行面 — 非白名单
   *     能力即拒, 端口不被触达）;
   *  4. 端口 `launchInvestigator`（宿主面 — 路径 A 全序, 适配器在端口
   *     边界再断言一次）。
   *
   * @param context - the one-click context（`buildInvestigationContext`
   *   产物; 直接构造的对象同样过断言）。
   * @returns the settled launch result（sessionId + echoes — transient
   *   输出, 落 AnalysisRecord 归 WP-7.3 用户显式保存）.
   * @throws {@link InvestigatorLaunchError} — 断言拒因（IVL_INPUT /
   *   IVL_WRITE_CAPABILITY）或端口透传（IVL_PRESET* / IVL_PERMISSION /
   *   IVL_LAUNCH — cause 保留）。
   */
  async launch(context: InvestigationContext): Promise<InvestigatorLaunchResult> {
    assertInvestigationContext(context)
    const request = this.buildRequest(context)
    assertReadonlyLaunchRequest(request)
    return this.#launcher.launchInvestigator(request)
  }

  /**
   * 纯构造: 上下文 → 闭集启动请求（4 字段, 两个字面量 — 构造面零自由
   * 度: preset / permission 是常量, cwd / task 来自已校验上下文）。
   * 导出供测试逐字钉全形态 + 未来接线（RPC/GUI 缝）复用同一构造。
   *
   * @param context - the investigation context.
   * @returns the closed-set request（frozen）.
   */
  buildRequest(context: InvestigationContext): InvestigatorLaunchRequest {
    return Object.freeze({
      presetId: INVESTIGATOR_PRESET_ID,
      permissionPreset: READ_ONLY_PERMISSION_PRESET,
      cwd: context.cwd,
      task: investigationTask(context),
    })
  }

  /**
   * The investigator preset composition text（`agent.cordis.yml`）—
   * the ensure 步的输入（适配器落盘 + 回读解析 + 闭集断言）。
   * @returns the deterministic composition text.
   */
  presetComposition(): string {
    return renderInvestigatorPresetComposition(INVESTIGATOR_PRESET_ID)
  }

  /**
   * 便捷缝: Intervention 行 + 问题 + 根 → 一键启动（组合
   * `buildInvestigationContext` + `launch` — 调用方一步到底）。
   *
   * @param intervention - the Intervention record（WP-3.5 冻结形状）.
   * @param question - the user's investigation question.
   * @param cwd - the research workspace root（absolute）.
   * @returns the settled launch result.
   * @throws {@link InvestigatorLaunchError} — 缝校验 / 断言 / 端口透传.
   */
  async launchFromIntervention(
    intervention: Parameters<typeof buildInvestigationContext>[0],
    question: string,
    cwd: string,
  ): Promise<InvestigatorLaunchResult> {
    return this.launch(buildInvestigationContext(intervention, question, cwd))
  }
}
