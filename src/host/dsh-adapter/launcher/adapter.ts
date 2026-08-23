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
 * 1. **ensure preset**: 名册（`ctx.get('agentPresets')`）存在时,
 *    resolve `research-investigator`: unknown ⇒ 向用户 preset 根
 *    （`$DSH_HOME/.agent-presets` — DSH `USER_PRESET_DIR`, checkout
 *    `packages/preset/agent-presets/src/discovery.ts:41`）落盘
 *    `agent.cordis.yml`（闭集只读组合 —
 *    `renderInvestigatorPresetComposition`）⇒ 再 resolve（discovery
 *    unmemoized — `agent-presets/src/index.ts` 头注「Discovery
 *    re-reads the roots on every call」— 免重启可见）。胜出行（含
 *    shipped-root 影子）的 `path` 回读 → **严格闭集解析**
 *    （`parsePresetComposition` — 写工具行/多余键/group 即拒
 *    `IVL_PRESET_NOT_READONLY`; broken 行 `IVL_PRESET_BROKEN`）。
 *    名册不存在的部署（无 roster 组合）降级: 不传 `agentPreset`
 *    （会话跑宿主组合）, 只读保障 = 下面第 2 步 restriction + 第 3 步
 *    sandbox 两层（文档化降级 — 该部署下插件的 11 研究工具中可写 7 个
 *    仍被 restriction 拒之门外, workspace 写仍被 read-only sandbox 后端
 *    拒绝 — INV-PERM-3 不依赖 preset 层成立）。
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
 * （`Context` 类型）+ `@deepseek-ai/dsh-llm`（`createUserMessage`）+
 * `@deepseek-ai/dsh-home-paths`（preset 根默认 — DSH_ADAPTER §9 先例）
 * + `node:fs`（preset 落盘 — 插件自有 DSH_HOME 数据区, 同 research.
 * sqlite 落盘口径 — 非 workspace/plan/history 写）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  INVESTIGATOR_DENIED_TOOL_NAMES,
  INVESTIGATOR_PRESET_ID,
  READ_ONLY_PERMISSION_PRESET,
  assertReadonlyLaunchRequest,
  parsePresetComposition,
  renderInvestigatorPresetComposition,
  type DshAgentLauncherAdapter,
  type InvestigatorLaunchRequest,
  type InvestigatorLaunchResult,
} from '../../service/investigator/index.js'
import { InvestigatorLaunchError } from '../../service/investigator/index.js'
import type {
  AgentCtxLike,
  AgentLike,
  AgentPresetRowLike,
  AgentPresetsLike,
  AgentsStoreLike,
  CommandsRuntimeLike,
  LauncherHostContext,
} from './types.js'

/** 用户 preset 根的目录段（DSH `USER_PRESET_DIR` — checkout
 * `packages/preset/agent-presets/src/discovery.ts:41`; web profile 的可写
 * 根 = 该段, checkout `packages/bundle/web-app/cordis.patch.yml:431-444`
 * 注释: 「the writable root is dsh-agent-presets' own default
 * (`includeUserRoot)`」）。常量在此具名（该值对 dsh-agent-presets 是
 * 包内私有的 — 本插件按 checkout 锚定, 漂移由 TC-DSH 冒烟捕获）。 */
const USER_PRESET_DIR_SEGMENT = '.agent-presets'

/** `HostAgentLauncherAdapter` 构造选项（全部可选 — 生产装配零参可用）。 */
export interface HostAgentLauncherAdapterOptions {
  /**
   * 用户 preset 根目录（默认 `$DSH_HOME/.agent-presets`）。tests 注
   * temp dir — 生产装配不传。
   */
  readonly presetRootDir?: string
}

export class HostAgentLauncherAdapter implements DshAgentLauncherAdapter {
  readonly #ctx: LauncherHostContext
  readonly #presetRootDir: string

  /** Spike-style 可观测（WP-0.4 计数器先例 — NOT a business API）:
   *  最近一次 launch 的 preset ensure 结果（`written` = 本适配器落盘 /
   *  `present` = 已存在未覆写 / `skipped` = 无 roster 部署）。 */
  lastPresetEnsure: 'written' | 'present' | 'skipped' | undefined

  /**
   * @param ctx - the host context（plain cordis `Context` — every host
   *  service, `agents` included, is resolved at launch time through the
   *  documented optional-service read `ctx.get`; see the `types.ts`
   *  `LauncherHostContext` doc for the §4-verbatim no-hard-inject
   *  ruling + the absent-service loud-failure path）.
   * @param options - optional preset-root override（tests 面）.
   */
  constructor(ctx: LauncherHostContext, options?: HostAgentLauncherAdapterOptions) {
    this.#ctx = ctx
    this.#presetRootDir = options?.presetRootDir ?? dshHomePath(USER_PRESET_DIR_SEGMENT)
  }

  /** 最近一次 ensure 的 preset 目录（可观测面 — tests 断言落点）。 */
  get presetDir(): string {
    return join(this.#presetRootDir, INVESTIGATOR_PRESET_ID)
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
    let presetId: string | undefined
    if (roster !== undefined) {
      presetId = await this.resolveOrEnsure(roster, request.presetId)
    } else {
      // 文档化降级: 无 roster 部署 — 会话跑宿主组合; 只读保障 =
      // restriction + sandbox 两层（模块头第 1 步）。
      this.lastPresetEnsure = 'skipped'
    }
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
          ...(presetId === undefined ? {} : { agentPreset: presetId }),
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
      ...(presetId === undefined ? {} : { presetId }),
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
  async setupInvestigator(agentCtx: AgentCtxLike, roster: AgentPresetsLike | undefined, presetId: string | undefined):
    Promise<void> {
    if (presetId !== undefined) {
      if (roster === undefined) {
        throw new InvestigatorLaunchError({
          code: 'IVL_PRESET',
          message: 'setupInvestigator: internal — a preset id without a roster (composition-time invariant)',
        })
      }
      try {
        await roster.mount(agentCtx, presetId)
      } catch (error: unknown) {
        throw new InvestigatorLaunchError({
          code: 'IVL_LAUNCH',
          message: `setupInvestigator: preset mount of "${presetId}" failed (the agent factory rolls the creation back): ${error instanceof Error ? error.message : String(error)}`,
          cause: error,
        })
      }
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
   * ensure preset: resolve（unknown ⇒ 用户根落盘闭集组合 ⇒ 再 resolve）
   * ⇒ 胜出行 broken 检查 ⇒ 胜出行 path 回读闭集解析。
   * @returns the preset id the session will run under.
   */
  private async resolveOrEnsure(roster: AgentPresetsLike, presetId: string): Promise<string> {
    let resolved: AgentPresetRowLike
    try {
      resolved = await roster.resolve(presetId)
    } catch (firstError: unknown) {
      // unknown preset（`UnknownPresetError` — checkout
      // agent-presets/src/preset.ts:71-80）⇒ ensure ⇒ 再 resolve;
      // 其他错误（根不可读）不吞, 直接包 IVL_PRESET（cause 保留）。
      if (!isUnknownPresetError(firstError)) {
        throw new InvestigatorLaunchError({
          code: 'IVL_PRESET',
          message: `launchInvestigator: preset resolve of "${presetId}" failed before ensure: ${firstError instanceof Error ? firstError.message : String(firstError)}`,
          cause: firstError,
        })
      }
      this.writePresetFileIfAbsent()
      try {
        resolved = await roster.resolve(presetId)
      } catch (secondError: unknown) {
        throw new InvestigatorLaunchError({
          code: 'IVL_PRESET',
          message: `launchInvestigator: preset "${presetId}" is still unresolvable after ensure (roster roots do not see ${this.#presetRootDir}): ${secondError instanceof Error ? secondError.message : String(secondError)}`,
          cause: secondError,
        })
      }
    }
    if (resolved.broken !== undefined) {
      throw new InvestigatorLaunchError({
        code: 'IVL_PRESET_BROKEN',
        message: `launchInvestigator: the roster reports preset "${resolved.id}" broken: ${resolved.broken} — the mounting paths refuse it (checkout agent-presets mount guard); refusing to launch over a broken composition`,
      })
    }
    // 胜出行回读（含 shipped-root 影子: 读的是 resolve 胜出者的 path,
    // 不是本插件写的那份）— 严格闭集解析 = 只读门的执行点。
    const compositionText = readFileSync(resolved.path, 'utf8')
    parsePresetComposition(presetId, compositionText) // 非只读组合 ⇒ IVL_PRESET_NOT_READONLY
    return resolved.id
  }

  /**
   * 向用户 preset 根落盘闭集只读组合（幂等 — 已存在不覆写: 用户自撰
   * preset 带 shell 级信任, 插件不抢写; 回读闭集解析是只读门的执行点,
   * 自撰组合过解析即可用, 不过即 IVL_PRESET_NOT_READONLY 拒启）。
   */
  private writePresetFileIfAbsent(): void {
    const file = join(this.presetDir, 'agent.cordis.yml')
    try {
      if (existsSync(file)) {
        this.lastPresetEnsure = 'present'
        return
      }
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, renderInvestigatorPresetComposition(INVESTIGATOR_PRESET_ID), 'utf8')
      this.lastPresetEnsure = 'written'
    } catch (error: unknown) {
      throw new InvestigatorLaunchError({
        code: 'IVL_PRESET',
        message: `launchInvestigator: preset ensure (write ${file}) failed: ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      })
    }
  }
}

/**
 * `UnknownPresetError` 的形状判定（结构 — 不 import dsh-agent-presets:
 * checkout `packages/preset/agent-presets/src/preset.ts:71-80` — 携带
 * `presetId` + `available` 字段; 消息前缀 `agent-presets: preset "…"
 * not found`）。
 */
function isUnknownPresetError(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { presetId?: unknown }).presetId !== undefined
    && (error as { available?: unknown }).available !== undefined
}

/** Re-export the structural faces (the adapter's public type surface). */
export type {
  AgentCtxLike,
  AgentLike,
  AgentHandleLike,
  AgentPresetRowLike,
  AgentPresetsLike,
  AgentsStoreLike,
  CommandExecutionLike,
  CommandsRuntimeLike,
  CreateAgentOptionsLike,
  LauncherHostContext,
} from './types.js'
