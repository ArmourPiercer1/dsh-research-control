/**
 * WP-7.1 — `HostAgentLauncherAdapter`: `DshAgentLauncherAdapter` 的
 * host 半边（DSH_ADAPTER §10.2 映射行的执行体）:
 *
 *   ensure preset → `agents.create({meta: {cwd, agentPreset}, setup})`
 *   → `command('/permission read-only')`（结算后再驱动）→
 *   `followup(task)`
 *
 * 宿主面消费全部走结构 Like 面（`./types.ts` — 零 DSH devDep, 宿主运行时
 * 结构性满足, WP-0.6/0.7 实机 boot 是证明 — 同 `HostSessionAdapter`
 * 纪律）。
 *
 * ## 路径 A 全序（U5 定案 — 报告「U5 消解」专节证据链）
 *
 * 1. **ensure preset（0.2.0-rc.2: 声明式注册, 文件落盘退役）**: 名册
 *    （`ctx.get('agentPresets')` — 0.2 `dsh-agent-preset-registry`）存在
 *    时 resolve `research-investigator`: 未知名（`RemoteError`
 *    `agent-preset/not-found`, details `{agentPreset, available}` —
 *    checkout `packages/preset/agent-preset-registry/src/index.ts:180-186`）
 *    ⇒ `register(investigatorPresetDefinition())`（声明式 preset —
 *    0.1 的「写 `agent.cordis.yml` 到用户根 + discovery 重扫」路径已随
 *    discovery 退役: 0.2 注册表是声明式名册, `register` 收
 *    `PresetDefinition` 并即时激活, disposer 随插件 fiber 卸载 —
 *    checkout `agent-preset-registry/src/index.ts:80-105` + cordis
 *    `ctx.effect` 的 AsyncEffect 生命周期）⇒ 再 resolve。重复注册竞态
 *    （`Duplicate agent preset` — 另一适配器实例/宿主已声明同一闭集
 *    组合）视作 present。broken（激活失败, resolve 带 `broken` 字段）
 *    ⇒ `IVL_PRESET_BROKEN`。回读门 = `readDocument(id).content`（声明
 *    组合的 entry-list YAML — 取代 0.1 的胜出行 `path` 回读）→ **严格
 *    闭集解析**（`parsePresetComposition` — 写工具行/多余键/group 即拒
 *    `IVL_PRESET_NOT_READONLY`）。名册不存在的部署（无 roster 组合）
 *    **不再降级启动**（0.2.0-rc.2 收紧 — 用户裁定）: preset 层是闭集
 *    只读组合的证明点, 缺席即无法证明 ⇒ 拒启 `IVL_PRESET` fail-loud
 *    （插件本体仍可加载, 缺口在使用点名 — 授权面不放宽）。
 * 2. **agents.create（路径 A 第 1 步的 host 面）**: 宿主注册表经
 *    **可选服务面** `ctx.get('agents')` 解析（DSH_ADAPTER §4 要点
 *    「可选服务用 `ctx.get('name')`」— 生产 `HostSessionAdapter`
 *    (WP-0.4, 实机验证) 同口径; `agents` **不**进硬 inject — 无
 *    `agents` 服务的部署插件仍可加载, 启动在使用时大声 IVL_LAUNCH,
 *    见 `types.ts` `LauncherHostContext` 头注）. `sessionId` 预分配
 *    `investigator-<uuid>`; `meta.cwd` = 请求 cwd（沙箱 workspace
 *    边界）; `meta.agentPreset` = 定案 preset id（header 创建事实 —
 *    冷重启重建同一组合）; `setup(agentCtx)` = **组合面 only**
 *    （checkout `packages/core/agent/src/index.ts:128-130` 「Setup
 *    composes, it never drives」）: (a) 名册存在 ⇒ `presets.mount(
 *    agentCtx, presetId)`（preset 组合挂载 — rejection 整体回滚）;
 *    (b) `agentCtx.tools.restrict({deny: INVESTIGATOR_DENIED_TOOL_NAMES})`
 *    — 本 agent 的全局工具可见面剔除 §7.2 可写 7 工具（Gate P7 二 「无
 *    plan/history mutation tool」— 目录面不存在, 不是运行时拒绝; 只读 4
 *    研究工具保留 — 它们是 investigator 的研究态 reader）。setup 抛错 ⇒
 *    agent 工厂整体回滚, 不发布半配置会话（:114-126）— 本适配器的
 *    all-or-nothing 依据。
 * 3. **`/permission read-only`（路径 A 第 2 步 — 强制）**:
 *    `ctx.get('commands')` 的 `execute(agent, '/permission read-only',
 *    [], signal)` — 命令执行**不开 turn**（checkout
 *    `packages/interaction/commands/src/index.ts:303-308` — 「Both are
 *    direct log-only appends — no turn wraps them」, 方法体 :328-334）,
 *    故 blank session 首 prompt 前有效（U5 定案）; 宿主
 *    `permission-presets` 服务写 `permission/preset` +
 *    `sandbox/mode: read-only`（`apply()` — checkout
 *    `packages/interaction/permission-presets/src/index.ts:380-391` —
 *    approval 无变化则 no-op — base 默认 `ask` = read-only preset 的
 *    `ask`）; 模式自下次受限调用起折叠生效（checkout
 *    `packages/sandbox/sandbox-policy/src/session-mode.ts:60-71` —
 *    「Takes effect on the session's next confined call (bash or fs) —
 *    the consumers fold on every read」; last-event-wins 折叠
 *    `effectiveSandboxMode` :52-60）— 首 turn 的每次工具执行都读到
 *    read-only。**结算在
 *    followup 之前**: 命令 `kind: 'error'` / 未注册（undefined）/ 无
 *    命令注册表 ⇒ `IVL_PERMISSION` fail loud, 任务不提交 — **不降级
 *    启动**: 无 `/permission` 就没有 sandbox 只读化, 启动一个可写会话
 *    违反 INV-PERM-3。
 * 4. **prompt(task)（路径 A 第 4 步）**: `agent.followup(
 *    createUserMessage({content: [{type: 'text', text: task}], source:
 *    {kind: 'user'}}))` — 用户显式请求（§6 矩阵 「启动 Investigator U
 *    ✅」）; 消息经 `@deepseek-ai/dsh-llm` 的 `createUserMessage` 构造
 *    （宿主同一真源 — 已 pin 直接依赖, 不镜像消息面）。
 *
 * ## INV-PERM-3 双钉
 *
 * 端口边界**先** `assertReadonlyLaunchRequest`（service 侧 build 后已
 * 断言一次 — 本钉保证: 即使未来接线绕开 launcher 直接持端口, 伪造
 * 请求在触达宿主前被拒 — 决策所在操作处执行决策, checkout AGENTS.md
 * 「Enforce a decision in the operation that makes it」）。
 *
 * 本文件是 dsh-adapter 领地（INV-PERM-5 豁免）: `@deepseek-ai/cordis`
 * （`Context` 类型）+ `@deepseek-ai/dsh-llm`（`createUserMessage`）。
 * 0.2.0-rc.2: `node:fs` 写路径与 `@deepseek-ai/dsh-home-paths` preset 根
 * 默认随文件 ensure 退役 — preset 声明改走注册表 `register`（本适配器
 * 零文件系统副作用, 授权面进一步收窄）。
 */

import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  INVESTIGATOR_DENIED_TOOL_NAMES,
  INVESTIGATOR_PRESET_ID,
  READ_ONLY_PERMISSION_PRESET,
  assertReadonlyLaunchRequest,
  investigatorPresetDefinition,
  parsePresetComposition,
  type DshAgentLauncherAdapter,
  type InvestigatorLaunchRequest,
  type InvestigatorLaunchResult,
} from '../../service/investigator/index.js'
import { InvestigatorLaunchError } from '../../service/investigator/index.js'
import type {
  AgentCtxLike,
  AgentLike,
  AgentPresetLike,
  AgentPresetsLike,
  AgentsStoreLike,
  CommandsRuntimeLike,
  LauncherHostContext,
} from './types.js'

export class HostAgentLauncherAdapter implements DshAgentLauncherAdapter {
  readonly #ctx: LauncherHostContext
  /** 本 activation 内 investigator preset 已声明的幂等闩（注册同时挂入
   *  `ctx.effect` — fiber 卸载自动回收宿主名册; 本字段只防本实例重复
   *  注册）。**R3 修订（reviewer）**: 闩与真实名册状态绑定 — 任何
   *  not-found 观测（冷重启后名册为空、duplicate 胜者卸载）都会清除
   *  它, 幸存者据此重新声明; 闩只是「最近一次已证明存在」的缓存,
   *  绝不凌驾于注册表的真实状态之上。 */
  #presetRegistered = false

  /** Spike-style 可观测（WP-0.4 计数器先例 — NOT a business API）:
   *  最近一次 launch 的 preset ensure 结果（`registered` = 本适配器
   *  声明式注册 / `present` = 名册已有声明）。0.1 的 `written`（文件
   *  落盘）随文件 ensure 退役; 0.2 的无 roster 部署 fail-loud
   *  （IVL_PRESET — 0.1 的 `skipped` 降级随之退役）。 */
  lastPresetEnsure: 'registered' | 'present' | undefined

  /**
   * @param ctx - the host context（plain cordis `Context` — every host
   *  service, `agents` included, is resolved at launch time through the
   *  documented optional-service read `ctx.get`; see the `types.ts`
   *  `LauncherHostContext` doc for the §4-verbatim no-hard-inject
   *  ruling + the absent-service loud-failure path）.
   */
  constructor(ctx: LauncherHostContext) {
    this.#ctx = ctx
  }

  /** `/permission` 命令线（逐字 — tests 钉死）。 */
  permissionCommandLine(): string {
    return `/permission ${READ_ONLY_PERMISSION_PRESET}`
  }

  /**
   * 路径 A 全序（模块头 1-4）: ensure preset → agents.create(+setup) →
   * /permission read-only（结算）→ followup task。
   *
   * @param request - the closed-set launch request（端口边界再断言 —
   *   伪造请求不触达宿主）。
   * @returns the settled launch result（sessionId + echoes）.
   * @throws {@link InvestigatorLaunchError} — IVL_WRITE_CAPABILITY（断言
   *   拒）/ IVL_PRESET（ensure/resolve/fs 失败）/ IVL_PRESET_BROKEN /
   *   IVL_PRESET_NOT_READONLY（回读闭集解析拒）/ IVL_PERMISSION（命令
   *   面缺失或报错 — 不降级启动）/ IVL_LAUNCH（agents.create 失败 —
   *   含 setup 组合失败: mount 拒绝 / restrict 名字未知 — 宿主回滚后
   *   大声）。
   */
  async launchInvestigator(request: InvestigatorLaunchRequest): Promise<InvestigatorLaunchResult> {
    // 端口边界再断言（INV-PERM-3 双钉 — 决策所在操作处执行决策）。
    assertReadonlyLaunchRequest(request)
    const roster = this.#ctx.get('agentPresets') as AgentPresetsLike | undefined
    if (roster === undefined || typeof roster.resolve !== 'function' || typeof roster.readDocument !== 'function') {
      // 0.2.0-rc.2 收紧（用户裁定, 计划书 F3）: 无 roster 部署不再降级
      // 启动 — preset 层是闭集只读组合的**证明点**（`readDocument` 回读
      // 门）, 缺席即无法证明, 拒启 fail-loud。restriction + sandbox 两
      // 层仍各自成立, 但不再构成免 preset 启动的理由。
      throw new InvestigatorLaunchError({
        code: 'IVL_PRESET',
        message: 'launchInvestigator: the host composes no agent-preset registry (`ctx.get("agentPresets")` is absent) — the closed read-only composition cannot be proven, so the launch is refused (0.2.0-rc.2 tightening: no preset roster, no investigator launch — INV-PERM-3, fail loud at use time; the plugin itself stays loadable)',
      })
    }
    const presetId: string = await this.resolveOrEnsure(roster, request.presetId)
    const sessionId = `investigator-${randomUUID()}`
    // 路径 A 第 1 步的宿主注册表（可选服务面 — 缺席 = 该部署无 agent
    // 创建能力; 不降级启动, 大声 IVL_LAUNCH, 见 types.ts 头注）。
    const agents = this.#ctx.get('agents') as AgentsStoreLike | undefined
    if (agents === undefined || typeof agents.create !== 'function') {
      throw new InvestigatorLaunchError({
        code: 'IVL_LAUNCH',
        message: 'launchInvestigator: the host composes no agent registry (`ctx.get("agents")` is absent — a non-web or minimal deployment) — no investigator session can be created; the launch capability is unavailable in this deployment (loud at use time, the plugin itself stays loadable — DSH_ADAPTER §4 no-hard-inject ruling)',
      })
    }
    let agent: AgentLike
    try {
      const handle = await agents.create({
        sessionId,
        meta: {
          cwd: request.cwd,
          agentPreset: presetId,
        },
        setup: (agentCtx) => this.setupInvestigator(agentCtx, roster, presetId),
      })
      agent = handle.agent
    } catch (error: unknown) {
      throw new InvestigatorLaunchError({
        code: 'IVL_LAUNCH',
        message: `launchInvestigator: agents.create failed for session "${sessionId}" (the host rolled the creation back — no half-configured session published): ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      })
    }
    // /permission read-only 结算在 followup 之前 — 命令失败不驱动会话
    // （不降级启动, INV-PERM-3）。
    await this.executeReadonlyPermission(agent)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: request.task }],
      source: { kind: 'user' },
    }))
    return Object.freeze({
      sessionId,
      presetId,
      permissionPreset: request.permissionPreset,
      task: request.task,
    })
  }

  /**
   * 组合面（setup 回调体 — 「Setup composes, it never drives」, checkout
   * `packages/core/agent/src/index.ts:128-130`）: (a) preset 挂载
   * （名册存在时 — rejection 整体回滚, agent 工厂保证）; (b) 本 agent
   * 的全局工具可见面剔除 §7.2 可写 7 工具（Gate P7 二）。
   *
   * 组合序: mount 先行（preset 行先落地）, restrict 后行（denial 对
   * GLOBAL 工具生效 — preset 层是 scoped 注册, 不受 restriction 影响 —
   * checkout `packages/core/tools/src/index.ts:677-679` 「Restrictions
   * intersect and do not affect scoped registrations」）; 两者都在发布
   * 前结算（setup 契约 — await 链即时序）。
   *
   * @internal exported for the test seam（tests 直调断言组合序 —
   * 宿主工厂时序不在单测面）。
   */
  async setupInvestigator(agentCtx: AgentCtxLike, roster: AgentPresetsLike, presetId: string):
    Promise<void> {
    try {
      await roster.mount(agentCtx, presetId)
    } catch (error: unknown) {
      throw new InvestigatorLaunchError({
        code: 'IVL_LAUNCH',
        message: `setupInvestigator: preset mount of "${presetId}" failed (the agent factory rolls the creation back): ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      })
    }
    this.restrictInvestigatorTools(agentCtx)
  }

  /** 本 agent 的只读工具面（restriction 层 — Gate P7 二）。 */
  private restrictInvestigatorTools(agentCtx: AgentCtxLike): void {
    agentCtx.tools.restrict({ deny: [...INVESTIGATOR_DENIED_TOOL_NAMES] })
  }

  /**
   * `/permission read-only`（路径 A 第 2 步 — 强制, 无命令面不降级;
   * 结算后返回 — 命令执行不开 turn, blank-session 安全, U5 定案,
   * `./types.ts` 头注）。
   */
  private async executeReadonlyPermission(agent: AgentLike): Promise<void> {
    const commands = this.#ctx.get('commands') as CommandsRuntimeLike | undefined
    if (commands === undefined || typeof commands.execute !== 'function') {
      throw new InvestigatorLaunchError({
        code: 'IVL_PERMISSION',
        message: `launchInvestigator: the host composes no command registry — "/permission ${READ_ONLY_PERMISSION_PRESET}" cannot run, so the session cannot be made read-only; refusing to launch a writable session (INV-PERM-3)`,
      })
    }
    let execution
    try {
      execution = await commands.execute(agent, this.permissionCommandLine(), [], new AbortController().signal)
    } catch (error: unknown) {
      throw new InvestigatorLaunchError({
        code: 'IVL_PERMISSION',
        message: `launchInvestigator: /permission ${READ_ONLY_PERMISSION_PRESET} threw: ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      })
    }
    if (execution === undefined) {
      throw new InvestigatorLaunchError({
        code: 'IVL_PERMISSION',
        message: `launchInvestigator: the command line "/permission ${READ_ONLY_PERMISSION_PRESET}" resolved no registered command (unknown name or syntax miss) — the deployment's command registry lacks the permission-presets child; refusing to launch a writable session (INV-PERM-3)`,
      })
    }
    if (execution.result.kind !== 'success') {
      throw new InvestigatorLaunchError({
        code: 'IVL_PERMISSION',
        message: `launchInvestigator: /permission ${READ_ONLY_PERMISSION_PRESET} settled as an error: ${execution.result.text ?? '(no text)'} — the deployment's preset table likely has no "read-only" row (non-web profile); refusing to launch a writable session (INV-PERM-3)`,
      })
    }
  }

  /**
   * ensure preset（0.2 声明式）: resolve ⇒ 未知名 ⇒ `register`（幂等
   * 闩 + 竞态容忍）⇒ 再 resolve ⇒ broken 检查 ⇒ `readDocument` 回读
   * 闭集解析。
   * @returns the preset id the session will run under.
   */
  /**
   * R3（reviewer P1 回归）— 激活期声明（eager, register-ONLY）。
   *
   * 0.2 名册是 memory-only：冷启动 / 插件 reload 后名册为空, 而已持久化
   *  investigator 会话的 resume 走
   *  `session-controller/src/agent.ts → composeAgent → presets.resolve(saved)`
   *  — resolve 先于任何新 launch。lazy 注册（只在 launchInvestigator 里
   *  ensure）意味着旧会话在「下一次新 launch」之前永远开不起来 — 本方法
   *  把声明前移到插件 activation, 经 `ctx.effect` 挂 fiber 生命周期
   *  （卸载 = 真 unregister, reload = 干净重声明）。
   *
   * 死锁纪律（checkout agent-preset-registry/src/index.ts:117-134：激活
   *  审计会 await loader settlement）：本方法只 register — 绝不
   *  resolve/list; 读面（resolve/list/readDocument）只在用户动作
   *  （launch/resume, 必然晚于 activation）时执行。
   *
   * @returns `'registered'`（本实例声明并挂上生命周期）| `'present'`
   *  （名册已有 — duplicate, 他方 lease）| `'no-roster'`（该部署无注册表
   *  — 插件照常可加载, launch 时仍 fail-loud IVL_PRESET）。
   */
  async declarePresetAtActivation(): Promise<'registered' | 'present' | 'no-roster'> {
    const roster = this.#ctx.get('agentPresets') as AgentPresetsLike | undefined
    if (roster === undefined || typeof roster.register !== 'function') {
      return 'no-roster'
    }
    if (this.#presetRegistered) {
      // 闩 = 缓存, 激活期无读面可核实（死锁纪律）— 保留声明现状即可。
      return 'present'
    }
    try {
      await this.#ctx.effect(
        () => roster.register(investigatorPresetDefinition()),
        'research-control/investigator-preset',
      )
      this.#presetRegistered = true
      this.lastPresetEnsure = 'registered'
      return 'registered'
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('Duplicate agent preset')) {
        // 他方已声明（并发 activation / 宿主行）— 视作 present；内容由
        // launch 期 readDocument 闭集门统一把关。
        this.#presetRegistered = true
        this.lastPresetEnsure = 'present'
        return 'present'
      }
      // activation 不因 preset 声明失败而崩解插件（launch 时还会再试并
      // fail-loud）；大声记录, 不静默。
      console.warn(
        `[research-control] declarePresetAtActivation: the investigator preset declaration ` +
          `failed at activation: ${error instanceof Error ? error.message : String(error)} — ` +
          'persisted investigator sessions cannot RESUME until a later launch re-declares it ' +
          '(retried at every launch)',
      )
      return 'no-roster'
    }
  }

  private async resolveOrEnsure(roster: AgentPresetsLike, presetId: string): Promise<string> {
    let resolved: AgentPresetLike
    try {
      resolved = await roster.resolve(presetId)
      this.lastPresetEnsure = 'present'
    } catch (firstError: unknown) {
      // unknown preset（`RemoteError('agent-preset/not-found')` —
      // checkout agent-preset-registry/src/index.ts:180-186）⇒ 声明式
      // 注册 ⇒ 再 resolve; 其他错误不吞, 直接包 IVL_PRESET（cause 保留）。
      if (!isUnknownPresetError(firstError)) {
        throw new InvestigatorLaunchError({
          code: 'IVL_PRESET',
          message: `launchInvestigator: preset resolve of "${presetId}" failed before ensure: ${firstError instanceof Error ? firstError.message : String(firstError)}`,
          cause: firstError,
        })
      }
      // R3（reviewer）— 真实名册观测优先于本实例闩：not-found 证明声明
      // 已不在名册（冷重启 / duplicate 胜者卸载）— 清闩并重新声明,
      // 幸存者由此恢复（旧实现里 Duplicate 路径置起的闩会永久吞掉重声明）。
      this.#presetRegistered = false
      await this.registerPresetDeclaration(roster)
      try {
        resolved = await roster.resolve(presetId)
      } catch (secondError: unknown) {
        throw new InvestigatorLaunchError({
          code: 'IVL_PRESET',
          message: `launchInvestigator: preset "${presetId}" is still unresolvable after register: ${secondError instanceof Error ? secondError.message : String(secondError)}`,
          cause: secondError,
        })
      }
    }
    if (resolved.broken !== undefined) {
      throw new InvestigatorLaunchError({
        code: 'IVL_PRESET_BROKEN',
        message: `launchInvestigator: the roster reports preset "${resolved.id}" broken: ${resolved.broken} — the mounting paths refuse it (checkout agent-preset-registry retain guard :318-325); refusing to launch over a broken composition`,
      })
    }
    // 声明回读（0.2 `readDocument` — 取代 0.1 胜出行 path 文件回读）:
    // 读的是注册表实际持有并会挂载的组合文本, 不是本进程内存里的声明 —
    // 严格闭集解析 = 只读门的执行点。
    const document = await roster.readDocument(presetId)
    parsePresetComposition(presetId, document.content) // 非只读组合 ⇒ IVL_PRESET_NOT_READONLY
    return resolved.id
  }

  /**
   * 声明式注册闭集只读组合（0.2 `register` — 幂等: 本 activation 只注册
   * 一次; 注册经 `ctx.effect` 挂入插件 fiber — 卸载即从宿主名册回收,
   * reload 干净重注册）。竞态: 同 id 已有声明（`Duplicate agent preset`
   * — 并发 ensure 或宿主/其他实例先声明）视作 present — 组合内容随后由
   * `resolveOrEnsure` 的 `readDocument` 闭集门统一把关, 不信任任何一方。
   */
  private async registerPresetDeclaration(roster: AgentPresetsLike): Promise<void> {
    if (this.#presetRegistered) {
      this.lastPresetEnsure = 'present'
      return
    }
    try {
      // AsyncEffect: fiber 卸载时 await 注册表 disposer（cordis
      // fiber.d.ts Effect 契约 — disposers run in reverse order, async
      // ones awaited）。
      await this.#ctx.effect(
        () => roster.register(investigatorPresetDefinition()),
        'research-control/investigator-preset',
      )
      this.#presetRegistered = true
      this.lastPresetEnsure = 'registered'
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('Duplicate agent preset')) {
        // 已有声明（本插件 reload 后名册未清 / 并发启动竞态）— 视作
        // present, 内容由 resolveOrEnsure 的回读门把关。
        this.#presetRegistered = true
        this.lastPresetEnsure = 'present'
        return
      }
      throw new InvestigatorLaunchError({
        code: 'IVL_PRESET',
        message: `launchInvestigator: preset register of "${INVESTIGATOR_PRESET_ID}" failed: ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      })
    }
  }
}

/**
 * `agent-preset/not-found` 的形状判定（结构 — 不 import 注册表实现:
 * checkout `packages/preset/agent-preset-registry/src/types.ts:39-48` —
 * `RemoteError` 携带 `isDSHRemoteError: true` + `code` + details
 * `{agentPreset, available}`; `@deepseek-ai/dsh-typert-protocol` 的
 * `RemoteError` 类实例 — 0.1 的 `UnknownPresetError`（presetId/available
 * 直接挂 error 上）已退役）。
 */
function isUnknownPresetError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as {
    isDSHRemoteError?: unknown
    code?: unknown
    details?: { agentPreset?: unknown; available?: unknown }
  }
  return candidate.isDSHRemoteError === true
    && candidate.code === 'agent-preset/not-found'
    && typeof candidate.details?.agentPreset === 'string'
    && Array.isArray(candidate.details?.available)
}

/** Re-export the structural faces (the adapter's public type surface). */
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
