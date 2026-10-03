/**
 * WP-7.1 — HostAgentLauncherAdapter 测试（路径 A 全序 + INV-PERM-3 端口
 * 边界再断言; 任务测试项「参数构造全形态」的宿主面 + 写路径拒绝的
 * 宿主面）。
 *
 * 覆盖（U5 定案路径 A: ensure preset → agents.create(+setup: mount→
 * restrict) → /permission read-only（结算）→ followup task）:
 *  - 全序事件钉: create-start → mount → restrict → create-done →
 *    execute → followup（顺序即只读时序 — permission 在驱动前结算）;
 *  - create 选项钉: sessionId `investigator-` 前缀 / meta.cwd 透传 /
 *    meta.agentPreset 闭集字面量 / setup 存在;
 *  - restriction 黑名单 = §7.2 可写 7 工具同一真源（WRITE_TOOL_NAMES）;
 *  - /permission 命令线逐字 `/permission read-only`; images 恒空;
 *  - followup 消息钉: content [{type:'text',text:task}] + source
 *    {kind:'user'} + role 'user'（createUserMessage 宿主同一真源）;
 *  - 结果钉: sessionId / presetId / permissionPreset / task echoes;
 *  - ensure 流（0.2 声明式）: unknown ⇒ `register(闭集定义)`（内容 =
 *    冻结渲染的闭集解析产物）⇒ 再 resolve（lastPresetEnsure
 *    'registered'）; Duplicate 竞态 ⇒ present; register 后仍 unknown ⇒
 *    IVL_PRESET; 注册经 `ctx.effect` 挂 fiber（卸载 ⇒ 名册回收）;
 *  - 只读门: 非闭集声明回读（`readDocument.content`）⇒
 *    IVL_PRESET_NOT_READONLY（零 create）; broken 行 ⇒ IVL_PRESET_BROKEN
 *    （零 create）;
 *  - 无 roster 部署（0.2 收紧）: ⇒ IVL_PRESET fail-loud（闭集组合不可
 *    证明即拒启 — 0.1 的 'skipped' 降级退役, 授权不放宽）;
 *  - 命令面失败（无注册表 / undefined / kind error / throw）⇒
 *    IVL_PERMISSION（零 followup — 不降级启动）;
 *  - create / mount / restrict 失败 ⇒ IVL_LAUNCH（零命令零 followup）;
 *  - 无 agent 注册表（`ctx.get('agents')` 缺席）⇒ IVL_LAUNCH 使用大声
 *    + 零副作用（WP-7.4 / G7 S1 — §4 无 `agents` 硬 inject 裁决面）;
 *  - 端口边界再断言: 伪造请求（多余能力键）⇒ IVL_WRITE_CAPABILITY
 *    （零 create — 双钉的宿主半边, 断言面在 guard 套件）。
 *
 * 0.2.0-rc.2: 本测试面零 `node:fs` — 文件 ensure 退役后适配器零文件
 * 系统副作用, 名册状态全部由假声明表承载。
 */

import { describe, expect, it } from 'vitest'

import {
  HostAgentLauncherAdapter,
} from '../../src/host/dsh-adapter/launcher/index.js'
import {
  INVESTIGATOR_DENIED_TOOL_NAMES,
  INVESTIGATOR_PRESET_ID,
  INVESTIGATOR_PRESET_TOOL_NAMES,
  investigatorPresetDefinition,
  isInvestigatorLaunchError,
  renderInvestigatorPresetComposition,
  READ_ONLY_PERMISSION_PRESET,
  type InvestigatorLaunchError,
} from '../../src/host/service/investigator/index.js'
import { WRITE_TOOL_NAMES } from '../../src/host/tools/index.js'
import {
  captureAsync,
  makeCommands,
  makeHost,
  makeRoster,
  makeValidRequest,
  type FakeHost,
  type FakePresetRow,
  type FakeRoster,
} from './fixtures.js'

/**
 * 名册（0.2 声明式）: `research-investigator` 已有声明（行 + 组合文本 =
 * 冻结渲染 — readDocument 回读源）; 可配 mountError / unknownFirst /
 * rogue content / broken。
 */
function makeDeclaredRoster(options?: {
  readonly content?: string
  readonly mountError?: Error
  readonly unknownFirst?: number
  readonly broken?: string
  readonly rows?: Map<string, FakePresetRow>
  readonly registerNoop?: boolean
}): FakeRoster {
  return makeRoster({
    ...options?.rows === undefined
      ? { rows: new Map([[INVESTIGATOR_PRESET_ID, {
          id: INVESTIGATOR_PRESET_ID,
          ...options?.broken === undefined ? {} : { broken: options.broken },
        }]]) }
      : { rows: options.rows },
    defaultContent: renderInvestigatorPresetComposition(INVESTIGATOR_PRESET_ID),
    ...options?.content === undefined ? {} : { documents: new Map([[INVESTIGATOR_PRESET_ID, options.content]]) },
    ...options?.mountError === undefined ? {} : { mountError: options.mountError },
    ...options?.unknownFirst === undefined ? {} : { unknownFirst: options.unknownFirst },
    ...options?.registerNoop === undefined ? {} : { registerNoop: options.registerNoop },
  })
}

function makeAdapter(ctx: FakeHost['ctx']): HostAgentLauncherAdapter {
  return new HostAgentLauncherAdapter(ctx)
}

/** 捕获 IVL_* 错误 + 码断言（返回错误本体 — cause 面可断言）。 */
async function expectIvl(fn: () => Promise<unknown>, code: string): Promise<InvestigatorLaunchError> {
  const caught = await captureAsync(fn)
  if (caught === undefined || !isInvestigatorLaunchError(caught) || caught.code !== code) {
    throw new Error(`expected ${code}, got ${caught === undefined ? 'no throw' : `${(caught as { code?: string }).code ?? String(caught)}`}`)
  }
  return caught
}

describe('路径 A 全序（U5 定案）', () => {
  it('roster 命中 + 命令 success ⇒ 全序事件钉 + create 选项钉 + 结果钉', async () => {
    const roster = makeDeclaredRoster()
    const commands = makeCommands({})
    // 假包装器传入 — makeHost 自动接全序事件面（mount/execute/followup
    // 与 create/restrict 同一日志）。
    const host: FakeHost = makeHost({ roster, commands })
    const adapter = makeAdapter(host.ctx)
    const request = makeValidRequest({ cwd: '/ws/project', task: 'Read-only investigation of Intervention IV-7 "t".' })

    const result = await adapter.launchInvestigator(request)

    // 全序（R3 convergence）: create-start → mount → create-done → execute →
    // followup — setup 只 mount: deny-7（guard+visibility）属 preset generation
    // 的 safety 行（mount 即继承），adapter 不再叠 agent 层 restriction。
    expect(host.events.map(event => event.kind)).toEqual([
      'create-start',
      'mount',
      'create-done',
      'execute',
      'followup',
    ])
    // create 选项钉。
    expect(host.createCalls).toHaveLength(1)
    const createOptions = host.createCalls[0]
    expect(createOptions.sessionId).toMatch(/^investigator-/)
    expect(createOptions.meta).toEqual({ cwd: '/ws/project', agentPreset: INVESTIGATOR_PRESET_ID })
    expect(typeof createOptions.setup).toBe('function')
    // mount 钉: preset id 闭集字面量。
    const mountEvent = host.events.find(event => event.kind === 'mount')
    expect(mountEvent).toEqual({ kind: 'mount', presetId: INVESTIGATOR_PRESET_ID })
    expect(roster.mountCalls).toHaveLength(1)
    // deny-7 名单单一真源不变（safety 行消费同一常量 — 引用钉）。
    expect(INVESTIGATOR_DENIED_TOOL_NAMES).toBe(WRITE_TOOL_NAMES)
    // /permission 命令线逐字 + images 恒空。
    const executeEvent = host.events.find(event => event.kind === 'execute')
    expect(executeEvent).toEqual({ kind: 'execute', line: `/permission ${READ_ONLY_PERMISSION_PRESET}`, images: [] })
    expect(commands.executeCalls).toHaveLength(1)
    expect(commands.executeCalls[0].line).toBe('/permission read-only')
    // followup 消息钉（宿主同一真源 createUserMessage 产物）。
    expect(host.createdAgents).toHaveLength(1)
    const agent = host.createdAgents[0]
    expect(agent.id).toBe(createOptions.sessionId)
    expect(agent.followed).toHaveLength(1)
    const message = agent.followed[0] as { role: string; source: { kind: string }; content: { type: string; text: string }[] }
    expect(message.role).toBe('user')
    expect(message.source).toEqual({ kind: 'user' })
    expect(message.content).toEqual([{ type: 'text', text: request.task }])
    // 结果钉。
    expect(result).toEqual({
      sessionId: createOptions.sessionId,
      presetId: INVESTIGATOR_PRESET_ID,
      permissionPreset: READ_ONLY_PERMISSION_PRESET,
      task: request.task,
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(adapter.permissionCommandLine()).toBe('/permission read-only')
    // 声明命中路径不触发注册, 但回读门必须执行（readDocument 读过冻结
    // 渲染内容 — 只读门在执行点）。
    expect(roster.registerCalls).toHaveLength(0)
    expect(roster.readDocumentCalls).toEqual([INVESTIGATOR_PRESET_ID])
    expect(adapter.lastPresetEnsure).toBe('present')
  })

  it('sessionId 每次 launch 唯一（预分配 uuid — 不重用不派生自输入）', async () => {
    const host = makeHost({ roster: makeDeclaredRoster().roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(host.ctx)
    const first = await adapter.launchInvestigator(makeValidRequest())
    const second = await adapter.launchInvestigator(makeValidRequest())
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(first.sessionId).toMatch(/^investigator-/)
    expect(second.sessionId).toMatch(/^investigator-/)
  })
})

describe('ensure preset（0.2 声明式注册 — 映射行第 1 步）', () => {
  it('首查 unknown ⇒ register(闭集定义) ⇒ 再 resolve 命中（lastPresetEnsure registered）', async () => {
    // 名册为空表起 — 首查 not-found ⇒ 适配器声明式注册 ⇒ 命中。
    const roster = makeRoster({
      rows: new Map(),
      defaultContent: renderInvestigatorPresetComposition(INVESTIGATOR_PRESET_ID),
    })
    const host = makeHost({ roster: roster.roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(host.ctx)

    const result = await adapter.launchInvestigator(makeValidRequest())

    expect(adapter.lastPresetEnsure).toBe('registered')
    expect(roster.resolveCalls).toEqual([INVESTIGATOR_PRESET_ID, INVESTIGATOR_PRESET_ID])
    // 注册的声明 = service 单一真源产物（render → parse → definition）。
    expect(roster.registerCalls).toHaveLength(1)
    expect(roster.registerCalls[0]).toEqual(investigatorPresetDefinition())
    // 闭集定义的行面（2 行只读工具 + R3 审计 safety 行, 再无第四行混入）。
    expect(roster.registerCalls[0]!.plugins.map(row => row.name).sort())
      .toEqual([...INVESTIGATOR_PRESET_TOOL_NAMES, 'dsh-research-control/investigator-safety'].sort())
    // 回读门读过注册后的内容。
    expect(roster.readDocumentCalls).toEqual([INVESTIGATOR_PRESET_ID])
    expect(result.presetId).toBe(INVESTIGATOR_PRESET_ID)
  })

  it('注册经 ctx.effect 挂 fiber — 卸载即名册回收（reload 干净重注册）', async () => {
    const roster = makeRoster({
      rows: new Map(),
      defaultContent: renderInvestigatorPresetComposition(INVESTIGATOR_PRESET_ID),
    })
    const host = makeHost({ roster: roster.roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(host.ctx)
    await adapter.launchInvestigator(makeValidRequest())
    expect(host.effects).toHaveLength(1)
    expect(host.effects[0]!.label).toBe('research-control/investigator-preset')
    expect(host.effects[0]!.disposed).toBe(false)

    // fiber 卸载: effect disposer 逆序 await → 假注册表真 unregister。
    await host.disposeEffects()
    expect(host.effects[0]!.disposed).toBe(true)
    const caught = await captureAsync(() => roster.roster.resolve(INVESTIGATOR_PRESET_ID))
    expect((caught as Error).message).toContain('Unknown agent preset')

    // reload 语义: 新适配器在新名册状态重新注册成功（无 Duplicate 残留）。
    const host2 = makeHost({ roster: roster.roster, commands: makeCommands({}).commands })
    const result2 = await makeAdapter(host2.ctx).launchInvestigator(makeValidRequest())
    expect(result2.presetId).toBe(INVESTIGATOR_PRESET_ID)
  })

  it('Duplicate 竞态（他方已声明同 id）⇒ present（回读门把关, 不崩不重复）', async () => {
    // 行已存在但首查视图滞后（unknownFirst: 1）⇒ 适配器 register 撞
    // Duplicate（假名册按真注册表语义抛 `Duplicate agent preset`）⇒
    // 视作 present ⇒ 第二次 resolve 命中 ⇒ 正常启动。
    const roster = makeDeclaredRoster({ unknownFirst: 1 })
    const host = makeHost({ roster: roster.roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(host.ctx)

    const result = await adapter.launchInvestigator(makeValidRequest())

    expect(adapter.lastPresetEnsure).toBe('present')
    expect(roster.registerCalls).toHaveLength(1) // 尝试了（竞态面）
    expect(roster.readDocumentCalls).toEqual([INVESTIGATOR_PRESET_ID])
    expect(result.presetId).toBe(INVESTIGATOR_PRESET_ID)
  })

  it('register 后仍 unknown（注册被名册吞掉）⇒ IVL_PRESET（不吞不猜）', async () => {
    const roster = makeRoster({ rows: new Map(), registerNoop: true })
    const host = makeHost({ roster: roster.roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_PRESET')
    expect(caught.message).toContain('still unresolvable after register')
    expect(host.createCalls).toHaveLength(0)
  })

  it('register 抛非 Duplicate 错误 ⇒ IVL_PRESET（cause 保留）', async () => {
    const roster = makeRoster({
      rows: new Map(),
      registerError: new Error('preset activation refused by deployment policy'),
    })
    const host = makeHost({ roster: roster.roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_PRESET')
    expect(caught.message).toContain('activation refused by deployment policy')
    expect((caught.cause as Error).message).toContain('activation refused')
    expect(host.createCalls).toHaveLength(0)
  })

  it('非闭集声明回读 ⇒ IVL_PRESET_NOT_READONLY（零 create — 只读门在执行点）', async () => {
    const rogue = [
      "- id: bash",
      "  name: '@deepseek-ai/dsh-tool-bash'",
      '- id: fs',
      "  name: '@deepseek-ai/dsh-tool-fs'",
      '',
    ].join('\n')
    const roster = makeDeclaredRoster({ content: rogue })
    const host = makeHost({ roster: roster.roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_PRESET_NOT_READONLY')
    expect(caught.message).toContain('@deepseek-ai/dsh-tool-fs')
    expect(host.createCalls).toHaveLength(0)
    expect(host.events).toEqual([])
  })

  it('broken 声明 ⇒ IVL_PRESET_BROKEN（零 create — 指名 broken 原因）', async () => {
    const roster = makeDeclaredRoster({ broken: 'row 2 failed to load' })
    const host = makeHost({ roster: roster.roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_PRESET_BROKEN')
    expect(caught.message).toContain('row 2 failed to load')
    expect(host.createCalls).toHaveLength(0)
  })

  it('resolve 非 unknown 错误 ⇒ IVL_PRESET（不 ensure 不吞）', async () => {
    const failingRoster = {
      async resolve(): Promise<never> {
        throw new Error('roster store corrupt')
      },
      async list() {
        return []
      },
      async register(): Promise<() => Promise<void>> {
        throw new Error('unreachable')
      },
      async readDocument(): Promise<never> {
        throw new Error('unreachable')
      },
      async mount() {
        throw new Error('unreachable')
      },
    }
    const host = makeHost({ roster: failingRoster as never, commands: makeCommands({}).commands })
    const adapter = makeAdapter(host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_PRESET')
    expect(caught.message).toContain('roster store corrupt')
    expect(host.createCalls).toHaveLength(0)
  })
})

describe('无 roster 部署（0.2.0-rc.2 收紧 — 不降级, fail-loud）', () => {
  it('ctx.get("agentPresets") 缺席 ⇒ IVL_PRESET + 零副作用（闭集组合不可证明即拒启）', async () => {
    const host = makeHost({ commands: makeCommands({}) })
    const adapter = makeAdapter(host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_PRESET')
    expect(caught.message).toContain('no agent-preset registry')
    expect(caught.message).toContain('cannot be proven')
    // 零宿主副作用: 不建会话、不驱动命令、不注册 preset、无 ensure 结果。
    expect(host.createCalls).toHaveLength(0)
    expect(host.events).toEqual([])
    expect(host.effects).toHaveLength(0)
    expect(adapter.lastPresetEnsure).toBeUndefined()
  })
})

describe('命令面失败（IVL_PERMISSION — 不降级启动）', () => {
  it.each([
    ['无命令注册表', () => makeHost({ roster: makeDeclaredRoster().roster, commands: undefined })],
    ['execute 返回 undefined（命令未注册）', () => makeHost({ roster: makeDeclaredRoster().roster, commands: makeCommands({ unregistered: true }).commands })],
    ['execute 返回 kind error（preset 表缺 read-only 行）', () => makeHost({ roster: makeDeclaredRoster().roster, commands: makeCommands({ execution: { commandId: 'cmd-1', result: { kind: 'error', text: 'unknown preset "read-only" (available: workspace-write, danger-full-access)' } } }).commands })],
    ['execute throw', () => makeHost({ roster: makeDeclaredRoster().roster, commands: makeCommands({ executeError: new Error('boom') }).commands })],
  ])('%s ⇒ IVL_PERMISSION + 零 followup', async (_label, make) => {
    const host = make()
    const adapter = makeAdapter(host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_PERMISSION')
    expect(caught.message).toContain('/permission read-only')
    expect(host.createCalls).toHaveLength(1) // session 已创建（回滚面归宿主 — 插件不销毁）
    expect(host.createdAgents[0].followed).toHaveLength(0) // 任务未提交
  })
})

describe('create / setup 失败（IVL_LAUNCH — all-or-nothing）', () => {
  it('agents.create 抛错 ⇒ IVL_LAUNCH（cause 保留）', async () => {
    const host = makeHost({ roster: makeDeclaredRoster().roster, commands: makeCommands({}).commands })
    const cause = new Error('session-conflict')
    host.failCreate(cause)
    const adapter = makeAdapter(host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_LAUNCH')
    expect(caught.cause).toBe(cause)
  })

  it('无 agent 注册表部署（ctx.get("agents") 缺席）⇒ IVL_LAUNCH 使用大声 + 零副作用（WP-7.4 / G7 S1 — §4 无 `agents` 硬 inject 裁决面）', async () => {
    const host = makeHost({ roster: makeDeclaredRoster().roster, commands: makeCommands({}).commands })
    host.setAgents(undefined)
    const adapter = makeAdapter(host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_LAUNCH')
    expect(caught.message).toContain('no agent registry')
    expect(caught.message).toContain('DSH_ADAPTER §4')
    // 使用大声, 零宿主副作用: 不创建会话、不驱动命令、不注册 preset
    // （能力缺席的部署连调查员 preset 声明都不该落进名册 — 插件本体
    // 仍可加载, 缺口在使用点名, 不静默降级）。
    expect(host.createCalls).toHaveLength(0)
    expect(host.events).toEqual([])
    expect(host.effects).toHaveLength(0)
  })

  it('preset mount 拒绝 ⇒ IVL_LAUNCH（零命令零 followup — setup 回滚镜像）', async () => {
    const roster = makeDeclaredRoster({
      mountError: new Error(`agent-preset-registry: preset "${INVESTIGATOR_PRESET_ID}" failed to mount: row 1 failed to load`),
    })
    const host = makeHost({ roster: roster.roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_LAUNCH')
    expect(caught.message).toContain('failed to mount')
    expect(host.events.filter(event => event.kind === 'execute' || event.kind === 'followup')).toEqual([])
    expect(host.createdAgents).toHaveLength(0)
  })

  it('generation mount 抛错（preset 行加载失败）⇒ IVL_LAUNCH（零命令零 followup）— R3: setup 面只剩 mount', async () => {
    const host = makeHost({
      roster: makeDeclaredRoster({ mountError: new Error('mount failed: row research-investigator-safety failed to load') }).roster,
      commands: makeCommands({}).commands,
    })
    const adapter = makeAdapter(host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_LAUNCH')
    expect(caught.message).toContain('research-investigator-safety')
    expect(host.events.filter(event => event.kind === 'execute' || event.kind === 'followup')).toEqual([])
  })
})

describe('组合文本同源（注册定义 = 回读解析 = 渲染器 单一真源）', () => {
  it('注册的声明恰为闭集 2 行工具 + 审计 safety 行（无其他混入）+ 渲染文本过同一解析门', async () => {
    const definition = investigatorPresetDefinition()
    expect(definition.id).toBe(INVESTIGATOR_PRESET_ID)
    expect(definition.plugins.map(row => row.name).sort()).toEqual([...INVESTIGATOR_PRESET_TOOL_NAMES, 'dsh-research-control/investigator-safety'].sort())
    expect(definition.plugins).toHaveLength(3) // 2 tool rows + the audited safety row
    // 渲染文本 = 注册定义 = 回读门输入: 冻结渲染再解析, 行面一致。
    const text = renderInvestigatorPresetComposition(INVESTIGATOR_PRESET_ID)
    const nameRows = text.split('\n').filter(line => line.startsWith('  name: '))
    expect(nameRows.map(line => line.replace('  name: ', '').replace(/'/g, '')).sort())
      .toEqual([...INVESTIGATOR_PRESET_TOOL_NAMES, 'dsh-research-control/investigator-safety'].sort())
  })
})
