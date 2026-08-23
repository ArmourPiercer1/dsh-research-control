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
 *  - ensure 流: unknown ⇒ 落盘（内容 = 冻结渲染）⇒ 再 resolve;
 *    已存在不覆写（lastPresetEnsure 'present'）;
 *  - 只读门: 非闭集组合回读 ⇒ IVL_PRESET_NOT_READONLY（零 create）;
 *    broken 行 ⇒ IVL_PRESET_BROKEN（零 create）;
 *  - 降级面: 无 roster ⇒ meta 无 agentPreset + lastPresetEnsure
 *    'skipped'（restriction + sandbox 两层仍生效）;
 *  - 命令面失败（无注册表 / undefined / kind error / throw）⇒
 *    IVL_PERMISSION（零 followup — 不降级启动）;
 *  - create / mount / restrict 失败 ⇒ IVL_LAUNCH（零命令零 followup）;
 *  - 端口边界再断言: 伪造请求（多余能力键）⇒ IVL_WRITE_CAPABILITY
 *    （零 create — 双钉的宿主半边）。
 *
 * 目录纪律: temp root 下 `user/`（适配器的 preset 根 — ensure 落点）与
 * `shipped/`（roster 行的组合文件 — 模拟 shipped-root 行）分离 —
 * 无同路径互踩; 用户自撰 preset 场景的「已存在」文件落 `user/` 且
 * roster 行指向它（resolve 胜出者 = 用户自撰 — 回读解析同一文件）。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  HostAgentLauncherAdapter,
} from '../../src/host/dsh-adapter/launcher/index.js'
import {
  INVESTIGATOR_DENIED_TOOL_NAMES,
  INVESTIGATOR_PRESET_ID,
  INVESTIGATOR_PRESET_TOOL_NAMES,
  isInvestigatorLaunchError,
  renderInvestigatorPresetComposition,
  READ_ONLY_PERMISSION_PRESET,
  type InvestigatorLaunchError,
  type InvestigatorLaunchRequest,
} from '../../src/host/service/investigator/index.js'
import { WRITE_TOOL_NAMES } from '../../src/host/tools/index.js'
import {
  captureAsync,
  makeCommands,
  makeHost,
  makeRoster,
  makeValidRequest,
  type FakeHost,
  type FakeRoster,
} from './fixtures.js'

const TEMP_ROOTS: string[] = []

/** temp root（`user/` = 适配器 preset 根; `shipped/` = roster 行落点）。 */
function makeTempDirs(): { root: string; presetRoot: string; shipped: string } {
  const root = mkdtempSync(join(tmpdir(), 'wp71-adapter-'))
  TEMP_ROOTS.push(root)
  return { root, presetRoot: join(root, 'user'), shipped: join(root, 'shipped') }
}

afterEach(() => {
  while (TEMP_ROOTS.length > 0) {
    const root = TEMP_ROOTS.pop() as string
    rmSync(root, { recursive: true, force: true })
  }
})

/** shipped-root 组合文件（roster 行指向 — 默认内容 = 冻结渲染）。 */
function makeShippedFile(shipped: string, content: string = renderInvestigatorPresetComposition(INVESTIGATOR_PRESET_ID)): string {
  mkdirSync(shipped, { recursive: true })
  const file = join(shipped, 'agent.cordis.yml')
  writeFileSync(file, content, 'utf8')
  return file
}

/** roster（行 = shipped 文件）; 可配 mountError / unknownFirst。 */
function makeShippedRoster(shipped: string, options?: {
  readonly path?: string
  readonly mountError?: Error
  readonly unknownFirst?: number
}): FakeRoster {
  return makeRoster({
    rows: new Map([[INVESTIGATOR_PRESET_ID, { id: INVESTIGATOR_PRESET_ID, path: options?.path ?? makeShippedFile(shipped) }]]),
    ...options?.mountError === undefined ? {} : { mountError: options.mountError },
    ...options?.unknownFirst === undefined ? {} : { unknownFirst: options.unknownFirst },
  })
}

/**
 * 动态根视图 roster（discovery unmemoized 镜像）: 每次 resolve 重新扫描
 * user preset 根（`<presetRoot>/<preset-id>/agent.cordis.yml`）+ 可选
 * shipped 行（优先序 = shipped 根先, 与 web profile roots 序一致）。
 */
function makeFsRoster(presetRoot: string, shippedFile?: string): FakeRoster {
  const rowsProvider = (): ReadonlyMap<string, { id: string; path: string }> => {
    const rows = new Map<string, { id: string; path: string }>()
    if (shippedFile !== undefined) rows.set(INVESTIGATOR_PRESET_ID, { id: INVESTIGATOR_PRESET_ID, path: shippedFile })
    const userFile = join(presetRoot, INVESTIGATOR_PRESET_ID, 'agent.cordis.yml')
    if (!rows.has(INVESTIGATOR_PRESET_ID) && existsSync(userFile)) {
      rows.set(INVESTIGATOR_PRESET_ID, { id: INVESTIGATOR_PRESET_ID, path: userFile })
    }
    return rows
  }
  return makeRoster({ rowsProvider })
}

function makeAdapter(presetRoot: string, ctx: FakeHost['ctx']): HostAgentLauncherAdapter {
  return new HostAgentLauncherAdapter(ctx, { presetRootDir: presetRoot })
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
    const { presetRoot, shipped } = makeTempDirs()
    const roster = makeShippedRoster(shipped)
    const commands = makeCommands({})
    // 假包装器传入 — makeHost 自动接全序事件面（mount/execute/followup
    // 与 create/restrict 同一日志）。
    const host: FakeHost = makeHost({ roster, commands })
    const adapter = makeAdapter(presetRoot, host.ctx)
    const request = makeValidRequest({ cwd: '/ws/project', task: 'Read-only investigation of Intervention IV-7 "t".' })

    const result = await adapter.launchInvestigator(request)

    // 全序: create-start → mount → restrict → create-done → execute → followup。
    expect(host.events.map(event => event.kind)).toEqual([
      'create-start',
      'mount',
      'restrict',
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
    // restriction 黑名单 = §7.2 可写 7 工具同一真源（单一来源引用钉）。
    const restrictEvent = host.events.find(event => event.kind === 'restrict')
    expect(restrictEvent).toEqual({ kind: 'restrict', deny: [...WRITE_TOOL_NAMES] })
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
  })

  it('sessionId 每次 launch 唯一（预分配 uuid — 不重用不派生自输入）', async () => {
    const { presetRoot, shipped } = makeTempDirs()
    const host = makeHost({ roster: makeShippedRoster(shipped).roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(presetRoot, host.ctx)
    const first = await adapter.launchInvestigator(makeValidRequest())
    const second = await adapter.launchInvestigator(makeValidRequest())
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(first.sessionId).toMatch(/^investigator-/)
    expect(second.sessionId).toMatch(/^investigator-/)
  })
})

describe('ensure preset（DSH_ADAPTER 映射行第 1 步）', () => {
  it('首查 unknown（用户根空）⇒ 落盘冻结渲染组合 ⇒ 再 resolve 命中（discovery unmemoized 镜像）', async () => {
    const { presetRoot, shipped } = makeTempDirs()
    void shipped
    const roster = makeFsRoster(presetRoot) // 无 shipped 行; 首查前用户根空
    const host = makeHost({ roster: roster.roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(presetRoot, host.ctx)

    await adapter.launchInvestigator(makeValidRequest())

    expect(adapter.lastPresetEnsure).toBe('written')
    expect(roster.resolveCalls).toEqual([INVESTIGATOR_PRESET_ID, INVESTIGATOR_PRESET_ID])
    const written = readFileSync(join(presetRoot, INVESTIGATOR_PRESET_ID, 'agent.cordis.yml'), 'utf8')
    expect(written).toBe(renderInvestigatorPresetComposition(INVESTIGATOR_PRESET_ID))
  })

  it('已存在不覆写（名册视图滞后 — ensure 见文件已存在 ⇒ present, 内容原样）', async () => {
    const { presetRoot, shipped } = makeTempDirs()
    void shipped
    // 用户自撰（过闭集解析的只读组合 — 行序不同的等价面）, 落 user 根。
    const authored = [
      "- id: search",
      "  name: '@deepseek-ai/dsh-tool-fs-search'",
      '- id: shell',
      "  name: '@deepseek-ai/dsh-tool-bash'",
      '',
    ].join('\n')
    const userFile = join(presetRoot, INVESTIGATOR_PRESET_ID, 'agent.cordis.yml')
    mkdirSync(join(presetRoot, INVESTIGATOR_PRESET_ID), { recursive: true })
    writeFileSync(userFile, authored, 'utf8')
    // 名册视图滞后镜像: 首查 unknown（视图未及更新）⇒ ensure 见文件已
    // 存在（present — 不覆写）⇒ 再查视图追上（命中用户自撰行）。
    const emptyView = new Map<string, { id: string; path: string }>()
    const hitView = new Map([[INVESTIGATOR_PRESET_ID, { id: INVESTIGATOR_PRESET_ID, path: userFile }]] as const)
    const views = [emptyView, hitView]
    // 首查走 emptyView（unknown ⇒ ensure）, 次查起走 hitView（视图追上）。
    // resolveIndex 从 -1 起: 推进器先 +1 再取视图 — 第 1 次 resolve 见
    // views[0], 第 2 次见 views[1]。
    let resolveIndex = -1
    const roster = makeRoster({
      rowsProvider: () => views[Math.max(0, Math.min(resolveIndex, views.length - 1))],
    })
    // 推进器: roster.resolve 每次被调用, 视图前进一步（模拟 discovery 追赶）。
    const originalResolve = roster.roster.resolve
    roster.roster.resolve = (id?: string) => {
      resolveIndex += 1
      return originalResolve(id)
    }
    const host = makeHost({ roster: roster.roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(presetRoot, host.ctx)

    await adapter.launchInvestigator(makeValidRequest())

    expect(adapter.lastPresetEnsure).toBe('present')
    expect(readFileSync(userFile, 'utf8')).toBe(authored) // 未覆写
  })

  it('非闭集组合回读 ⇒ IVL_PRESET_NOT_READONLY（零 create — 只读门在执行点）', async () => {
    const { presetRoot, shipped } = makeTempDirs()
    const rogue = [
      "- id: bash",
      "  name: '@deepseek-ai/dsh-tool-bash'",
      '- id: fs',
      "  name: '@deepseek-ai/dsh-tool-fs'",
      '',
    ].join('\n')
    const roster = makeShippedRoster(shipped, { path: makeShippedFile(shipped, rogue) })
    const host = makeHost({ roster: roster.roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(presetRoot, host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_PRESET_NOT_READONLY')
    expect(caught.message).toContain('@deepseek-ai/dsh-tool-fs')
    expect(host.createCalls).toHaveLength(0)
    expect(host.events).toEqual([])
  })

  it('broken 行 ⇒ IVL_PRESET_BROKEN（零 create — 指名 broken 原因）', async () => {
    const { presetRoot, shipped } = makeTempDirs()
    void shipped
    const roster = makeRoster({
      rows: new Map([[INVESTIGATOR_PRESET_ID, { id: INVESTIGATOR_PRESET_ID, path: '/nonexistent/agent.cordis.yml', broken: 'row 2 failed to load' }]]),
    })
    const host = makeHost({ roster: roster.roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(presetRoot, host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_PRESET_BROKEN')
    expect(caught.message).toContain('row 2 failed to load')
    expect(host.createCalls).toHaveLength(0)
  })

  it('resolve 非 unknown 错误（根不可读）⇒ IVL_PRESET（不 ensure 不吞）', async () => {
    const { presetRoot } = makeTempDirs()
    const failingRoster = {
      async resolve(): Promise<never> {
        throw new Error('ENOENT: root unreadable')
      },
      async list() {
        return []
      },
      async mount() {
        throw new Error('unreachable')
      },
    }
    const host = makeHost({ roster: failingRoster as never, commands: makeCommands({}).commands })
    const adapter = makeAdapter(presetRoot, host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_PRESET')
    expect(caught.message).toContain('ENOENT: root unreadable')
    expect(host.createCalls).toHaveLength(0)
  })

  it('ensure 后仍 unknown（roster 根看不见用户根）⇒ IVL_PRESET（指名根）', async () => {
    const { presetRoot } = makeTempDirs()
    // roster 永远不命中 — 模拟 roots 不含用户根（includeUserRoot: false 部署）。
    const neverHits = makeRoster({ rows: new Map(), unknownFirst: Number.MAX_SAFE_INTEGER })
    const host = makeHost({ roster: neverHits.roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(presetRoot, host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_PRESET')
    expect(caught.message).toContain(presetRoot)
    expect(host.createCalls).toHaveLength(0)
    // 落盘本身发生了（ensure 尝试了）— 可见性缺失是 roster 配置事实。
    expect(adapter.lastPresetEnsure).toBe('written')
  })
})

describe('降级面（无 roster 部署）', () => {
  it('meta 无 agentPreset + lastPresetEnsure skipped + restriction/sandbox 两层仍生效', async () => {
    const { presetRoot } = makeTempDirs()
    const host = makeHost({ commands: makeCommands({}) })
    const adapter = makeAdapter(presetRoot, host.ctx)

    const result = await adapter.launchInvestigator(makeValidRequest())

    expect(adapter.lastPresetEnsure).toBe('skipped')
    expect(host.createCalls[0].meta).toEqual({ cwd: '/ws/project' })
    expect('agentPreset' in (host.createCalls[0].meta as object)).toBe(false)
    expect(host.events.map(event => event.kind)).toEqual(['create-start', 'restrict', 'create-done', 'execute', 'followup'])
    expect(result).not.toHaveProperty('presetId')
  })
})

describe('命令面失败（IVL_PERMISSION — 不降级启动）', () => {
  it.each([
    ['无命令注册表', (shipped: string) => makeHost({ roster: makeShippedRoster(shipped).roster, commands: undefined })],
    ['execute 返回 undefined（命令未注册）', (shipped: string) => makeHost({ roster: makeShippedRoster(shipped).roster, commands: makeCommands({ unregistered: true }).commands })],
    ['execute 返回 kind error（preset 表缺 read-only 行）', (shipped: string) => makeHost({ roster: makeShippedRoster(shipped).roster, commands: makeCommands({ execution: { commandId: 'cmd-1', result: { kind: 'error', text: 'unknown preset "read-only" (available: workspace-write, danger-full-access)' } } }).commands })],
    ['execute throw', (shipped: string) => makeHost({ roster: makeShippedRoster(shipped).roster, commands: makeCommands({ executeError: new Error('boom') }).commands })],
  ])('%s ⇒ IVL_PERMISSION + 零 followup', async (_label, make) => {
    const { presetRoot, shipped } = makeTempDirs()
    const host = make(shipped)
    const adapter = makeAdapter(presetRoot, host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_PERMISSION')
    expect(caught.message).toContain('/permission read-only')
    expect(host.createCalls).toHaveLength(1) // session 已创建（回滚面归宿主 — 插件不销毁）
    expect(host.createdAgents[0].followed).toHaveLength(0) // 任务未提交
  })
})

describe('create / setup 失败（IVL_LAUNCH — all-or-nothing）', () => {
  it('agents.create 抛错 ⇒ IVL_LAUNCH（cause 保留）', async () => {
    const { presetRoot, shipped } = makeTempDirs()
    const host = makeHost({ roster: makeShippedRoster(shipped).roster, commands: makeCommands({}).commands })
    const cause = new Error('session-conflict')
    host.failCreate(cause)
    const adapter = makeAdapter(presetRoot, host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_LAUNCH')
    expect(caught.cause).toBe(cause)
  })

  it('preset mount 拒绝 ⇒ IVL_LAUNCH（零命令零 followup — setup 回滚镜像）', async () => {
    const { presetRoot, shipped } = makeTempDirs()
    const roster = makeShippedRoster(shipped, {
      mountError: new Error(`agent-presets: preset "${INVESTIGATOR_PRESET_ID}" failed to mount: row 1 failed to load`),
    })
    const host = makeHost({ roster: roster.roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(presetRoot, host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_LAUNCH')
    expect(caught.message).toContain('failed to mount')
    expect(host.events.filter(event => event.kind === 'execute' || event.kind === 'followup')).toEqual([])
    expect(host.createdAgents).toHaveLength(0)
  })

  it('restrict 抛错（部署无研究工具 — 名字未知）⇒ IVL_LAUNCH（零命令零 followup）', async () => {
    const { presetRoot, shipped } = makeTempDirs()
    const host = makeHost({
      roster: makeShippedRoster(shipped).roster,
      commands: makeCommands({}).commands,
      restrictError: new Error('tools.restrict() names unknown global tool "research_fact_record"'),
    })
    const adapter = makeAdapter(presetRoot, host.ctx)

    const caught = await expectIvl(() => adapter.launchInvestigator(makeValidRequest()), 'IVL_LAUNCH')
    expect(caught.message).toContain('tools.restrict() names unknown global tool')
    expect(host.events.filter(event => event.kind === 'execute' || event.kind === 'followup')).toEqual([])
  })
})

describe('端口边界再断言（INV-PERM-3 双钉 — 宿主半边）', () => {
  it('伪造请求（注入 sandboxMode）⇒ IVL_WRITE_CAPABILITY + 零 create 零命令', async () => {
    const { presetRoot, shipped } = makeTempDirs()
    const host = makeHost({ roster: makeShippedRoster(shipped).roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(presetRoot, host.ctx)
    const forged = { ...makeValidRequest(), sandboxMode: 'danger-full-access' } as unknown as InvestigatorLaunchRequest

    const caught = await expectIvl(() => adapter.launchInvestigator(forged), 'IVL_WRITE_CAPABILITY')
    expect(caught.message).toContain('sandboxMode')
    expect(caught.message).toContain('INV-PERM-3')
    expect(host.createCalls).toHaveLength(0)
    expect(host.events).toEqual([])
  })

  it('合法闭集请求在端口边界放行（再断言不拦合法面）', async () => {
    const { presetRoot, shipped } = makeTempDirs()
    const host = makeHost({ roster: makeShippedRoster(shipped).roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(presetRoot, host.ctx)
    const result = await adapter.launchInvestigator(makeValidRequest())
    expect(result.sessionId).toMatch(/^investigator-/)
  })
})

describe('组合文本同源（ensure 写盘 = 回读解析 = 渲染器 单一真源）', () => {
  it('ensure 落盘内容恰为闭集 2 行组合（无第三行混入）', async () => {
    const { presetRoot, shipped } = makeTempDirs()
    const roster = makeShippedRoster(shipped, { unknownFirst: 1 })
    const host = makeHost({ roster: roster.roster, commands: makeCommands({}).commands })
    const adapter = makeAdapter(presetRoot, host.ctx)
    await adapter.launchInvestigator(makeValidRequest())
    const text = readFileSync(join(presetRoot, INVESTIGATOR_PRESET_ID, 'agent.cordis.yml'), 'utf8')
    const nameRows = text.split('\n').filter(line => line.startsWith('  name: '))
    expect(nameRows.map(line => line.replace('  name: ', '').replace(/'/g, '')).sort())
      .toEqual([...INVESTIGATOR_PRESET_TOOL_NAMES].sort())
  })
})
