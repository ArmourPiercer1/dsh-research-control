/**
 * WP-7.1 — investigator 套件共享假面（structured fakes, NO cordis App —
 * 同 tests/session-adapter.test.ts 的 WP-0.4 纪律: 结构 Like 面 +
 * `as unknown as` 双 cast; 实机 boot 验证归接线 WP / TC-DSH 冒烟）。
 *
 * 假宿主（`makeHost`）按 `LauncherHostContext` 的三面装配:
 *  - `agents.create` — 记录选项; **await setup**（真实工厂时序: setup 在
 *    发布前 await, rejection 整体回滚 — checkout
 *    `packages/core/agent/src/index.ts:114-126` 的行为镜像）;
 *  - `ctx.get('agentPresets')` — 可配置名册（resolve 可抛
 *    `UnknownPresetError` 形状错误 — 携带 `presetId` + `available` 字段,
 *    checkout `packages/preset/agent-presets/src/preset.ts:71-80`）;
 *  - `ctx.get('commands')` — 可配置命令运行面（记录 execute 调用 +
 *    可配置结果 / 抛错）。
 *
 * 事件日志（`events`）跨面记录（mount / restrict / execute / followup /
 * create）— 测试断言**全序**（U5 路径 A: ensure → create(+setup:
 * mount→restrict) → /permission → followup）。
 */

import type {
  AgentCtxLike,
  AgentLike,
  AgentPresetRowLike,
  AgentPresetsLike,
  AgentsStoreLike,
  CommandExecutionLike,
  CommandsRuntimeLike,
  CreateAgentOptionsLike,
  LauncherHostContext,
} from '../../src/host/dsh-adapter/launcher/index.js'
import type { DshAgentLauncherAdapter, InvestigatorLaunchRequest, InvestigatorLaunchResult } from '../../src/host/service/investigator/index.js'

/** 一个顺序事件（跨面全序断言用）。 */
export type FakeEvent =
  | { kind: 'create-start'; sessionId: string }
  | { kind: 'mount'; presetId: string | undefined }
  | { kind: 'restrict'; deny: readonly string[] }
  | { kind: 'create-done'; sessionId: string }
  | { kind: 'execute'; line: string; images: readonly unknown[] }
  | { kind: 'followup'; text: string; sourceKind: string }

/** 假 agent（`AgentLike` 行为镜像 — followup 记录; 宿主注入事件面时
 *  同步写全序日志）。 */
export class FakeAgent implements AgentLike {
  readonly followed: unknown[] = []
  constructor(readonly id: string, private readonly events?: FakeEvent[]) {}
  readonly status = 'idle'
  followup(message: import('@deepseek-ai/dsh-llm').UserMessage): void {
    this.followed.push(message)
    if (this.events !== undefined) {
      const first = (message as { content?: readonly { type?: string; text?: string }[] }).content?.[0]
      this.events.push({
        kind: 'followup',
        text: first?.type === 'text' ? first.text ?? '' : '',
        sourceKind: (message as { source?: { kind?: string } }).source?.kind ?? '',
      })
    }
  }
}

/** 假 agentCtx（setup 回调实参 — restrict 记录; 可配置抛错面）。 */
export interface FakeAgentCtx extends AgentCtxLike {
  readonly restrictCalls: readonly { readonly deny?: readonly string[] }[]
}

export function makeFakeAgentCtx(events: FakeEvent[], options?: { readonly restrictError?: Error }): FakeAgentCtx {
  const restrictCalls: { deny?: readonly string[] }[] = []
  return {
    get restrictCalls() {
      return restrictCalls
    },
    tools: {
      restrict: (filter: { readonly deny?: readonly string[] }): (() => void) => {
        if (options?.restrictError !== undefined) throw options.restrictError
        restrictCalls.push(filter)
        events.push({ kind: 'restrict', deny: [...(filter.deny ?? [])] })
        return () => undefined
      },
    },
  }
}

/** 假名册行。 */
export type FakePresetRow = AgentPresetRowLike

/** 假名册（`AgentPresetsLike` 行为镜像 + 可配置失败面）。 */
export interface FakeRoster {
  readonly roster: AgentPresetsLike
  readonly mountCalls: readonly { readonly agentCtx: AgentCtxLike; readonly presetId: string | undefined }[]
  readonly resolveCalls: readonly (string | undefined)[]
  /** 接入宿主全序事件面（makeHost 自动 — mount 事件进同一日志）。 */
  wireEvents(events: FakeEvent[]): void
}

export function makeRoster(options: {
  /** id → 行（resolve 命中）; 未命中 ⇒ 抛 UnknownPresetError 形状错误。 */
  readonly rows?: ReadonlyMap<string, FakePresetRow>
  /**
   * 动态根视图（discovery unmemoized 镜像 — checkout
   * `packages/preset/agent-presets/src/index.ts` 头注「Discovery re-reads
   * the roots on every call」）: 每次 resolve 重新取行表（模拟 ensure
   * 落盘后免重启可见）; 提供时优先于静态 `rows`。
   */
  readonly rowsProvider?: () => ReadonlyMap<string, FakePresetRow>
  /** mount 时抛错（preset 组合不可装载）. */
  readonly mountError?: Error
  /**
   * 前 N 次 resolve 强制 unknown（即便行表命中 — 模拟「首查滞后于落盘
   * / roots 不含用户根」时序, 驱动 ensure 流）; 之后恢复正常命中逻辑。
   */
  readonly unknownFirst?: number
}): FakeRoster {
  const staticRows = options.rows ?? new Map<string, FakePresetRow>()
  const liveRows = (): ReadonlyMap<string, FakePresetRow> =>
    options.rowsProvider !== undefined ? options.rowsProvider() : staticRows
  const mountCalls: { readonly agentCtx: AgentCtxLike; readonly presetId: string | undefined }[] = []
  const resolveCalls: (string | undefined)[] = []
  let events: FakeEvent[] | undefined
  const unknownPresetError = (id: string, rows: ReadonlyMap<string, FakePresetRow>): Error => {
    const error = new Error(`agent-presets: preset "${id}" not found (available: ${[...rows.keys()].join(', ') || 'none'})`)
    Object.assign(error, { presetId: id, available: [...rows.keys()] })
    return error
  }
  return {
    roster: {
      async resolve(id?: string) {
        resolveCalls.push(id)
        if (id === undefined) throw new Error('makeRoster: resolve() called without an id (the fake needs one)')
        const rows = liveRows()
        if (options.unknownFirst !== undefined && resolveCalls.length <= options.unknownFirst) {
          throw unknownPresetError(id, rows)
        }
        const row = rows.get(id)
        if (row === undefined) throw unknownPresetError(id, rows)
        return row
      },
      async list() {
        return [...liveRows().values()]
      },
      async mount(agentCtx: AgentCtxLike, id?: string) {
        mountCalls.push({ agentCtx, presetId: id })
        events?.push({ kind: 'mount', presetId: id })
        if (options.mountError !== undefined) throw options.mountError
        return liveRows().get(id ?? '') ?? { id: id ?? '', path: '/nonexistent/agent.cordis.yml' }
      },
    },
    get mountCalls() {
      return mountCalls
    },
    get resolveCalls() {
      return resolveCalls
    },
    wireEvents(next: FakeEvent[]) {
      events = next
    },
  }
}

/** 假命令运行面（`CommandsRuntimeLike` 行为镜像 + 可配置结果）。 */
export interface FakeCommands {
  readonly commands: CommandsRuntimeLike
  readonly executeCalls: readonly { readonly agent: AgentLike; readonly line: string; readonly images: readonly unknown[] }[]
  /** 接入宿主全序事件面（makeHost 自动 — execute 事件进同一日志）。 */
  wireEvents(events: FakeEvent[]): void
}

export function makeCommands(options: {
  /** execute 的返回（kind error = 命令结算失败）. */
  readonly execution?: CommandExecutionLike
  /** execute 抛错. */
  readonly executeError?: Error
  /**
   * execute 返回 undefined（命令未注册 — DSH `CommandRuntime.execute`
   * 「`undefined` when syntax or name does not resolve」, checkout
   * `packages/interaction/commands/src/index.ts:303-329`）. 与缺省
   * （默认 success）区分: 缺省是「宿主命令面正常」, true 是「部署无
   * /permission 行」。
   */
  readonly unregistered?: boolean
}): FakeCommands {
  const calls: { readonly agent: AgentLike; readonly line: string; readonly images: readonly unknown[] }[] = []
  let events: FakeEvent[] | undefined
  return {
    commands: {
      async execute(agent: AgentLike, line: string, images: readonly unknown[]): Promise<CommandExecutionLike | undefined> {
        calls.push({ agent, line, images })
        if (options.executeError !== undefined) throw options.executeError
        events?.push({ kind: 'execute', line, images: [...images] })
        if (options.unregistered === true) return undefined
        return options.execution ?? { commandId: 'cmd-1', result: { kind: 'success' } }
      },
    },
    get executeCalls() {
      return calls
    },
    wireEvents(next: FakeEvent[]) {
      events = next
    },
  }
}

/** 假宿主上下文（plain cordis `Context` 双 cast — WP-0.4 模式; WP-7.4 /
 *  G7 S1: 宿主服务全部经 `ctx.get` 可选面解析 — 与生产 `LauncherHostContext`
 *  同口径, `agents` 缺席 = 使用大声 IVL_LAUNCH 的部署面）。 */
export interface FakeHost {
  readonly ctx: LauncherHostContext
  readonly events: FakeEvent[]
  readonly createCalls: CreateAgentOptionsLike[]
  readonly createdAgents: FakeAgent[]
  /** 注入可选面（launch 前配置 — 默认: 名册命中 + 命令 success）. */
  setRoster(roster: AgentPresetsLike | undefined): void
  setCommands(commands: CommandsRuntimeLike | undefined): void
  /** 注入 agent 注册表可选面（缺席 = 无 agent 能力部署 — IVL_LAUNCH 面）. */
  setAgents(agents: AgentsStoreLike | undefined): void
  /** create 抛错（agents.create 失败面）. */
  failCreate(error: Error): void
}

/** 假包装器判别（wrapper 面 vs 裸接口面 — 结构类型守卫, 零 brand 依赖;
 *  FakeRoster 与 AgentPresetsLike 结构不相交, 守卫可精确收窄）。 */
function isRosterWrapper(raw: FakeRoster | AgentPresetsLike | undefined): raw is FakeRoster {
  return raw !== undefined && typeof (raw as FakeRoster).wireEvents === 'function'
}

function isCommandsWrapper(raw: FakeCommands | CommandsRuntimeLike | undefined): raw is FakeCommands {
  return raw !== undefined && typeof (raw as FakeCommands).wireEvents === 'function'
}

export function makeHost(options?: {
  /** 名册 — 假包装器（`makeRoster` 产物, 自动接全序事件面）或裸接口面。 */
  readonly roster?: FakeRoster | AgentPresetsLike | undefined
  /** 命令面 — 假包装器（`makeCommands` 产物, 自动接全序事件面）或裸接口面。 */
  readonly commands?: FakeCommands | CommandsRuntimeLike | undefined
  /** setup 的 restrict 抛错（模拟部署无研究工具 — restrict 名字未知）。 */
  readonly restrictError?: Error
}): FakeHost {
  const events: FakeEvent[] = []
  const createCalls: CreateAgentOptionsLike[] = []
  const createdAgents: FakeAgent[] = []
  const rosterInput = options?.roster
  const commandsInput = options?.commands
  let roster: AgentPresetsLike | undefined = isRosterWrapper(rosterInput) ? rosterInput.roster : rosterInput
  let commands: CommandsRuntimeLike | undefined = isCommandsWrapper(commandsInput) ? commandsInput.commands : commandsInput
  let createError: Error | undefined
  // 全序事件面接线（mount / execute / followup 与 create / restrict 同一
  // 日志 — 测试断言 U5 路径 A 全序）。
  if (isRosterWrapper(rosterInput)) rosterInput.wireEvents(events)
  if (isCommandsWrapper(commandsInput)) commandsInput.wireEvents(events)
  const agentsStore: AgentsStoreLike = {
    async create(createOptions: CreateAgentOptionsLike) {
      createCalls.push(createOptions)
      events.push({ kind: 'create-start', sessionId: createOptions.sessionId })
      if (createError !== undefined) throw createError
      const agent = new FakeAgent(createOptions.sessionId, events)
      if (createOptions.setup !== undefined) {
        // 真实工厂时序: setup 在发布前 await, rejection 整体回滚。
        await createOptions.setup(makeFakeAgentCtx(events, { restrictError: options?.restrictError }))
      }
      createdAgents.push(agent)
      events.push({ kind: 'create-done', sessionId: createOptions.sessionId })
      return {
        agent,
        async dispose() {
          /* teardown capability — 假宿主不消费（所有权归宿主） */
        },
      }
    },
    get(id: string) {
      return createdAgents.find(agent => agent.id === id)
    },
  }
  // WP-7.4 / G7 S1: 宿主服务全部经 `ctx.get` 可选面解析（生产同口径 —
  // DSH_ADAPTER §4 无 `agents` 硬 inject）; `agents` 可置 undefined 以
  // 钉「无 agent 注册表部署 ⇒ IVL_LAUNCH 使用大声」面。
  let agents: AgentsStoreLike | undefined = agentsStore
  return {
    ctx: {
      get: (name: string): unknown =>
        name === 'agentPresets' ? roster
          : name === 'commands' ? commands
            : name === 'agents' ? agents
              : undefined,
    } as unknown as LauncherHostContext,
    events,
    createCalls,
    createdAgents,
    setRoster(next: AgentPresetsLike | undefined) {
      roster = next
    },
    setCommands(next: CommandsRuntimeLike | undefined) {
      commands = next
    },
    setAgents(next: AgentsStoreLike | undefined) {
      agents = next
    },
    failCreate(error: Error) {
      createError = error
    },
  }
}

/** 假端口（`DshAgentLauncherAdapter` — launcher 测试注入）。 */
export interface FakePort {
  readonly port: DshAgentLauncherAdapter
  readonly calls: InvestigatorLaunchRequest[]
  /** 每次 launch 的返回值 / 抛错（队列 — 按调用序消费）。 */
  pushResult(result: InvestigatorLaunchResult): void
  pushError(error: Error): void
}

export function makePort(): FakePort {
  const calls: InvestigatorLaunchRequest[] = []
  const queue: (InvestigatorLaunchResult | Error)[] = []
  const port: DshAgentLauncherAdapter = {
    async launchInvestigator(request: InvestigatorLaunchRequest) {
      calls.push(request)
      const next = queue.shift()
      if (next === undefined) return { sessionId: 'investigator-fake', permissionPreset: 'read-only', task: request.task }
      if (next instanceof Error) throw next
      return next
    },
  }
  return {
    port,
    calls,
    pushResult(result: InvestigatorLaunchResult) {
      queue.push(result)
    },
    pushError(error: Error) {
      queue.push(error)
    },
  }
}

/** 一个最小合法启动请求（guard/adapter 测试基线）。 */
export function makeValidRequest(overrides?: Partial<InvestigatorLaunchRequest>): InvestigatorLaunchRequest {
  return {
    presetId: 'research-investigator',
    permissionPreset: 'read-only',
    cwd: '/ws/project',
    task: 'Read-only investigation of Intervention IV-1 "t".',
    ...overrides,
  }
}

/** 捕获断言失败（同 tests/intervention 的 expectIllegal 风格 — 精确错误面）。 */
export function capture(fn: () => unknown | Promise<unknown>): Promise<unknown> | unknown {
  try {
    return fn()
  } catch (error) {
    return error
  }
}

export async function captureAsync(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn()
  } catch (error) {
    return error
  }
}
