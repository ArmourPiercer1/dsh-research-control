/**
 * WP-7.1 — Host-side structural face of the restricted-launch port
 * (`DshAgentLauncherAdapter` host 边界的 DSH 面 — 结构消费, 零 DSH
 * devDep, 同 WP-0.4 `HostSessionAdapter` 的 `RemoteContext` 模式:
 * ARCHITECTURE §2.2 rule 2 / INV-PERM-5 豁免目录内, 只 import
 * `@deepseek-ai/cordis` 的 `Context` 类型 + 已 pin 的直接依赖
 * `@deepseek-ai/dsh-llm`（`createUserMessage` — 消息构造用宿主同一
 * 真源, 不镜像）/ `@deepseek-ai/dsh-home-paths`（preset 根默认路径 —
 * DSH_ADAPTER §9 先例: 该 import 只允许出现在 dsh-adapter 面）。
 *
 * 每个 Like 面的来源（只读 checkout, file:line — U5 证据链的宿主面
 * 半边, 报告专节引用）:
 *  - `AgentsStoreLike.create` — `AgentRegistry.create`
 *    （`packages/core/agent/src/index.ts:405`）+ `CreateAgentOptions`
 *    （:80-133 — `sessionId` / `meta.{cwd,agentPreset}` / `setup`）;
 *    `setup` 的时序契约: 「The factory awaits setup after minting
 *    agentCtx but BEFORE inserting or announcing either the session or
 *    agent … Everything registered through agentCtx (scoped tools, prompt
 *    sections/variables, restrict(), listeners, awaited child plugins)
 *    exists before session/created, agent/created, agent/session-start,
 *    and the first prompt assembly. A setup throw/rejection … rolls the
 *    scope back without publishing either id.」（:114-126 — 全序回滚 =
 *    本适配器的 all-or-nothing 依据）;
 *  - `AgentPresetsLike` — 0.2 `AgentPresetRegistry` 服务
 *    （`packages/preset/agent-preset-registry/src/index.ts`）: `resolve`
 *    （:180-186 — unknown id 抛 `RemoteError('agent-preset/not-found')`
 *    + details `{agentPreset, available}`; activation 失败带 `broken`
 *    resolve 出来）/ `register`（:80-105 — 声明式注册, async disposer
 *    归声明方）/ `readDocument`（:194-210 — entry-list YAML 声明回读）/
 *    `mount`（:257 — 「Call from the agent factory's setup(agentCtx)」）
 *    / `list`（:153-168 — 声明名册含 broken 诊断）;
 *  - `CommandsRuntimeLike.execute` — `CommandRuntime.execute`
 *    （`packages/interaction/commands/src/index.ts:328-334`）: 「Parse
 *    and execute a known command without sending it to the model …
 *    Both are direct log-only appends — no turn wraps them」
 *    （:303-308 — **blank-session 命令时序的 U5 定案证据**: 无 turn
 *    要求, 首 prompt 前有效; `execute` 方法 :328-334, 语法/名字未解析
 *    返回 `undefined` :335-338）;
 *  - `AgentCtxLike.tools.restrict` — `ToolRuntime.restrict`
 *    （`packages/core/tools/src/index.ts:1071-1095`）+ `ToolRestriction`
 *    （:680-685 — 「Per-scope filter over global tools … does not
 *    affect scoped registrations」— 只影响本 agent 的可见面, 全局层
 *    不动: 其他会话的 11 工具目录不受影响）;
 *  - `AgentLike.followup` — `Agent.followup`
 *    （`packages/core/agent/src/runtime-types.ts:119-124` — 「Queue an
 *    ordinary follow-up turn and wake the driver」= host 面的
 *    `prompt(task)` 等价物, DSH_ADAPTER §10.2 映射行第 4 步）。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

/** 一个宿主 live agent 的结构面（本适配器读/驱的面）。 */
export interface AgentLike {
  /** Agent id（= session id, 宿主同身份 — `Agent.id`）. */
  readonly id: string
  /** Agent 的 lifecycle 状态（`idle` | `running`）. */
  readonly status: string
  /**
   * Queue an ordinary follow-up turn and wake the driver（`Agent.followup`
   * — 路径 A 第 4 步 `prompt(task)` 的 host 面）。
   * @param message - the task message（`createUserMessage` 产物 — 宿主
   *   同一真源构造, source `{kind: 'user'}`: 用户显式请求启动 — §6 矩阵
   *   「启动 Investigator U ✅」）。
   */
  followup(message: UserMessage): void
}

/** `agents.create` 的返回 handle（`AgentHandle` — `dispose` 是能力, 本
 *  适配器不持有所有权: 会话生命周期归宿主 UI/registry, 插件不销毁它）。 */
export interface AgentHandleLike {
  /** The live agent. */
  readonly agent: AgentLike
  /** Teardown capability（NOT consumed by this adapter — ownership stays
   *  with the host; the investigator session is a normal live session）。 */
  dispose(): Promise<void>
}

/** `AgentRegistry.create` 的选项面（`CreateAgentOptions` 结构切片）. */
export interface CreateAgentOptionsLike {
  /** The session id（本适配器预分配 `investigator-<uuid>`）. */
  readonly sessionId: string
  /** Session 元数据: `cwd`（沙箱 workspace 边界）+ `agentPreset`（创建
   *  事实, 记入 header — 冷重启重建同一组合, checkout
   *  `packages/preset/agent-presets/src/session.ts:5-13`）. */
  readonly meta?: {
    readonly cwd?: string
    readonly agentPreset?: string
  }
  /** 创建期组合回调（agentCtx — 未发布 agent 的 scope 上下文）. */
  readonly setup?: AgentSetupLike
}

/** `AgentSetup` 结构切片（`packages/core/agent/src/index.ts:69-71`）. */
export type AgentSetupLike = (agentCtx: AgentCtxLike) => void | Promise<void>

/** 未发布 agent 的 scope 上下文结构面（setup 回调实参 — 组合面 only,
 * 「Setup composes, it never drives」, checkout :128-130）。 */
export interface AgentCtxLike {
  /** 本 agent 的工具可见面控制（`ToolRuntime` — `restrict` 只作用于
   *  本 scope, 不动全局层）. */
  readonly tools: {
    /**
     * Per-scope filter over global tools（`ToolRestriction` —
     * `packages/core/tools/src/index.ts:680-685`）。
     * @param filter - `deny`: 本 agent 不可见的全局工具名闭集.
     * @returns the disposer（组合面注册 — 随 agent 卸载自动回滚; 本
     *   适配器不持有: restriction 的生命周期 = agent 的生命周期）。
     */
    restrict(filter: { readonly deny?: readonly string[] }): () => void
  }
}

/** `AgentRegistry` 结构面（`ctx.agents` — 本适配器消费的宿主注册表）. */
export interface AgentsStoreLike {
  /**
   * Create a new agent on a caller-supplied session id（`AgentRegistry.create`
   * — setup 在发布前 await, 失败整体回滚, 不发布半配置会话）。
   * @param options - sessionId / meta / setup.
   * @returns the owned handle（agent + dispose 能力）.
   */
  create(options: CreateAgentOptionsLike): Promise<AgentHandleLike>
  /** Look up a live agent by session id. */
  get(id: string): AgentLike | undefined
}

/** 一个 preset 名册行（0.2 `AgentPreset` 结构切片 — 本适配器读的面;
 *  checkout `packages/preset/agent-preset-registry/src/preset.ts:4-10` —
 *  0.1 的 `path` 字段随 discovery 退役, 声明内容改经 `readDocument` 读）. */
export interface AgentPresetLike {
  /** The preset id. */
  readonly id: string
  /** Display name the declaration published. */
  readonly name?: string
  /** One sentence on what the preset is for. */
  readonly description?: string
  /** Roster sort weight. */
  readonly order?: number
  /** Why the preset cannot compose a session, absent when it can
   *  （activation-failure diagnostic — resolve 得出带 `broken` 的行,
   *  挂载路径拒: checkout `agent-preset-registry/src/index.ts:318-325`）. */
  readonly broken?: string
}

/** 声明组合回读（0.2 `AgentPresetDocument` — checkout
 *  `agent-preset-registry/src/types.ts:28-37`; `content` = entry-list
 *  YAML, `!!js` 表达式按声明原文渲染 — 本适配器的闭集解析输入）. */
export interface AgentPresetDocumentLike {
  readonly agentPreset: string
  readonly content: string
  readonly name?: string
  readonly description?: string
}

/** 声明式 preset 定义（0.2 `PresetDefinition` 结构切片 — checkout
 *  `agent-preset-registry/src/definition.ts:5-11`；plugins 行 = cordis
 *  entry-list 行的闭集切片 — 本插件只声明 `{id, name}` + fs-search 的
 *  一个审计 `config` 键）. */
export interface PresetDefinitionLike {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  readonly plugins: readonly { readonly id?: string; readonly name: string; readonly config?: unknown }[]
}

/** `AgentPresetRegistry` 服务结构面（0.2 `ctx.get('agentPresets')` —
 *  未组注册表的部署返回 undefined — 适配器降级: 无 preset 层, 只读保障
 *  = restriction + sandbox 两层, 见 adapter.ts 模块头）. */
export interface AgentPresetsLike {
  /**
   * Resolve one identity WITHOUT starting an agent（unknown id 抛
   * `RemoteError('agent-preset/not-found')` + details
   * `{agentPreset, available}` — checkout
   * `agent-preset-registry/src/index.ts:180-186`; activation-failed
   * preset resolve 得出但带 `broken` 字段）.
   * @param id - the preset id（省略 = 部署默认）.
   */
  resolve(id?: string): Promise<AgentPresetLike>
  /** Every declared preset, including activation failures（声明式名册 —
   *  checkout `agent-preset-registry/src/index.ts:153-168`）. */
  list(): Promise<readonly AgentPresetLike[]>
  /**
   * Register and eagerly load a declaration（0.2 声明式注册 —
   * `register(definition)` 收 `PresetDefinition`, 即时激活, 返回的
   * async disposer 由声明方（本适配器 → `ctx.effect` 挂插件 fiber）负责
   * 回收; 同 id 重复注册抛 `Duplicate agent preset` — checkout
   * `agent-preset-registry/src/index.ts:80-105`）.
   * @returns the definition disposer after activation settles.
   */
  register(definition: PresetDefinitionLike): Promise<() => Promise<void>>
  /**
   * Read one declaration's child plugin list as YAML, for viewing only
   * （闭集门的输入 — 取代 0.1 的胜出行 `path` 文件回读; unknown id 同样
   * 抛 `agent-preset/not-found` — checkout
   * `agent-preset-registry/src/index.ts:194-210`）.
   */
  readDocument(agentPreset: string): Promise<AgentPresetDocumentLike>
  /**
   * Compose one agent from a preset in the factory setup（「Call from
   * the agent factory's setup(agentCtx); a rejection there rolls the
   * agent creation back」 — checkout
   * `agent-preset-registry/src/index.ts:257` 的 mount 面）.
   * @param agentCtx - the unpublished agent scope context.
   * @param id - the preset id.
   * @returns the composed preset row.
   */
  mount(agentCtx: AgentCtxLike, id?: string): Promise<AgentPresetLike>
}

/** 一个命令执行结果（`CommandExecution` 结构切片 — 本适配器读的面）. */
export interface CommandExecutionLike {
  /** The lifecycle pairing id（`command/run` + `command/done` 配对 — 审计面）. */
  readonly commandId: string
  /** The settled result（`kind: 'success'` 携带可选 text; `kind: 'error'`
   *  必携带 text — 拒因）. */
  readonly result: {
    readonly kind: 'success' | 'error'
    readonly text?: string
  }
}

/** `CommandRuntime` 结构面（`ctx.get('commands')` — 未组命令注册表的
 *  部署返回 undefined — 适配器 IVL_PERMISSION fail loud: `/permission`
 *  是路径 A 的强制步, 无命令面 = 无法只读化, 不降级启动）。 */
export interface CommandsRuntimeLike {
  /**
   * Parse and execute a known command without sending it to the model
   * （`CommandRuntime.execute` — log-only 生命周期事件, **不开 turn** —
   * U5 定案: blank session 首 prompt 前有效, checkout
   * `packages/interaction/commands/src/index.ts:302-334`）。
   * @param agent - the receiving agent（blank session 的 idle agent 即可）.
   * @param line - the complete slash-command line（`/permission read-only`）.
   * @param images - image attachments（本适配器恒传空 — 纯文本命令）.
   * @param signal - the caller cancellation signal.
   * @returns the settled execution, or undefined when syntax/name miss
   *   （未注册命令 = 部署无 `/permission` 行 → IVL_PERMISSION）.
   */
  execute(agent: AgentLike, line: string, images: readonly unknown[], signal: AbortSignal):
    Promise<CommandExecutionLike | undefined>
}

/**
 * The host context the launcher adapter binds to（plain cordis
 * `Context` — WP-7.4 / G7 S1: `agents` is NOT a hard face. The adapter
 * resolves every host service through the documented optional-service
 * read `ctx.get(name)`（DSH_ADAPTER §4 要点 「可选服务用 `ctx.get('name')`」
 * — the production `HostSessionAdapter` (WP-0.4, real-machine verified)
 * reads `ctx.get('agents')` the same way）. Consequences, all deliberate:
 *  - the plugin's `static inject` keeps its DSH_ADAPTER §4-verbatim four
 *    items — a deployment without the `agents` service still LOADS the
 *    plugin (a missing hard inject keeps the whole fiber PENDING — the
 *    §4 documented pitfall; no load-time coupling to one launch
 *    capability);
 *  - a launch on such a deployment fails loud `IVL_LAUNCH` at use time
 *    （the gap is named at the operation — no silent downgrade, no
 *    writable session, INV-PERM-3）;
 *  - `agentPresets` / `commands` were already `ctx.get` optional faces
 *    （same pattern — absent = the adapter's documented degradation /
 *    IVL_PERMISSION paths）; the declaration merges stay invisible to
 *    this plugin（no devDep on the agent package — structural
 *    consumption only）.
 */
export type LauncherHostContext = Context
