/**
 * 0.2 load/unload/reload 泄漏环 — 宿主半 harness（无头，vitest）。
 *
 * 装载单元 = 宿主一手 Loader 的真实 Entry 生命周期（`@deepseek-ai/cordis-plugin-loader`
 * 1.0.5，train 0.2.0-rc.2 的装载面；checkout `packages/typert/loader` 与
 * `packages/boot/plugin-manager/tests/manager.spec.ts` 是同一装载栈的宿主侧证据）：
 *   enable  : entry 创建/解禁 → Entry.init → tree.import(internal seam) →
 *             `ctx.registry.plugin(class, config)` → fiber PENDING→ACTIVE
 *   unload  : entry.update({disabled:true}) → fiber.dispose()（effect 逆序回收，
 *             runtime 摘除，uid→null，state DISPOSED）
 *   reload  : entry.update({disabled:false}) → init() 重新 import + 新 fiber
 * 这正是宿主 plugin-manager 在 GUI 里 disable/enable 插件驱动的同一对 API。
 *
 * REAL（本 harness 里不可替换的东西）:
 *  - `@deepseek-ai/cordis` 4.0.4 真 Context/Registry/Events/Fiber（train pin，
 *    checkout `packages/boot/plugin-manager/src/index.ts:207+` 的 ctx.fiber/
 *    ctx.effect 语义在此为真身）；
 *  - `@deepseek-ai/cordis-plugin-loader` Loader + Entry + EntryTree（真实装载
 *    单元与 self-dispose 观察者）；
 *  - `@deepseek-ai/dsh-tools` ToolRuntime（`super(ctx,'tools')`，宿主同名服务）
 *    —— 11 工具的注册/回收走真注册表；
 *  - `@deepseek-ai/dsh-agent-preset-registry` + `dsh-session-projection` +
 *    真 Loader —— investigator preset 名册（Duplicate 裁定的宿主一侧）；
 *  - `dsh-research-control` 宿主服务本体（src/host/index.ts 同一 class，
 *    internal.import seam 喂给它，与 pr8 investigator-lifecycle 的
 *    「host-shaped internal loader」同一手法）。
 *
 * FAKE（如实申报的宿主应用面 — g5/investigator-preset-registry 先例）:
 *  - `sessions`（list 空表 — 插件只读 list）、`subagents`（仅硬 inject 占位，
 *    init 路径不触碰）、`workspaceRegistry`（list = 挂载的 plane 路径）、
 *    `systemPrompt`（ToolRuntime native 模式只触碰三个成员）、
 *    `commands`（记录型注册器 — liveCommands 是「注册项计数」观测面本体）、
 *    `agents`（mint 假 agent 工厂 — agents.create 的时序面）。
 *
 * 可观测面（断言锁的计数）：loader.entries()/entry.fiber 状态、
 * ctx.registry 插件回调集、reflect 服务名集、ToolRuntime.get、liveCommands、
 * events._hooks 监听器数、fiber.getEffects()、preset roster。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { default as PluginLoader, type Entry, type EntryOptions, type Loader as LoaderType } from '@deepseek-ai/cordis-plugin-loader'
import { default as AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import { default as SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'

import hostEntry from '../../../src/host/index.js'
import { serializeRegistry } from '../../../src/host/domain/registry/index.js'
import { RESEARCH_TOOL_NAMES } from '../../../src/host/tools/index.js'
import { makeFile } from '../../registry/fixtures.js'
import { initGitRepo, writeResearchTree } from '../../wiring/helpers.js'

/** Ring 轮数（每轮 enable→断言→disable→断言）；≥3 才叫「反复」。 */
export const RING_ROUNDS = 3

/** FiberState 名映射（cordis const enum 无运行时导出 — checkout
 *  packages/…/fiber.ts 声明序：PENDING, LOADING, ACTIVE, FAILED, DISPOSED, UNLOADING）。 */
export const FIBER_STATE_NAMES = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'] as const
export const FIBER_ACTIVE = 2
export const FIBER_DISPOSED = 4

const roots: string[] = []
const homes: string[] = []

/** 每个 harness 一套可弃 temp 根（G5 先例：os tmpdir + afterAll 清理）。 */
export function ringTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

/** afterAll：等 startup-integrity 的异步 git 检查落定（G5 g5CleanupAll 同款
 *  500ms 惯例），再移除全部已登记的 temp 根 + DSH_HOME 子目录。 */
export async function ringCleanupAll(): Promise<void> {
  await new Promise((r) => setTimeout(r, 500))
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true })
}

/** 单项目 plane（hub + 已注册 PRJ-1 树）—— 工具/命令/sqlite 注册的燃料。 */
export function ringPlane(): { hubPath: string; wsPath: string } {
  const wsPath = ringTempDir('leak-ring-ws-')
  writeResearchTree(wsPath)
  initGitRepo(wsPath)
  const hubPath = ringTempDir('leak-ring-hub-')
  const hubDir = join(hubPath, '.research-control')
  mkdirSync(hubDir, { recursive: true })
  const entry = {
    id: 'PRJ-1',
    path: wsPath,
    displayName: '泄漏环验收',
    status: 'active' as const,
    boundAt: 1770000000000,
    archivedAt: null,
  }
  writeFileSync(join(hubDir, 'registry.yaml'), serializeRegistry(makeFile([entry])), 'utf8')
  return { hubPath, wsPath }
}

export interface CommandRecord {
  readonly name: string
  [key: string]: unknown
}

export interface RingHarness {
  readonly root: Context
  readonly loader: LoaderType
  /** Entry 生命周期驱动面。 */
  readonly entryId: string
  /** 记录型 commands 服务的 live 名册（注册项计数观测面）。 */
  readonly liveCommands: Map<string, CommandRecord>
  /** agents fake：mint 过的 sessionId。 */
  readonly minted: string[]
  /** roster 真身（dsh-agent-preset-registry 服务）。 */
  readonly roster: AgentPresetsObserved
  /** 一次性 settle：等待 loader 树与插件 fiber 稳定（失败即 throw）。 */
  settle(): Promise<void>
  currentEntry(): Entry
  currentFiber(): NonNullable<Entry['fiber']>
  enable(): Promise<void>
  disable(): Promise<void>
  /** 全量观测快照（每轮基线对比用）。 */
  snapshot(): RingSnapshot
  /** 卸载后收尾：整棵 root fiber 回收（vitest afterAll/afterEach 用）。 */
  teardown(): Promise<void>
}

export interface AgentPresetsObserved {
  resolve(id?: string): Promise<{ id: string; broken?: string }>
  list(): Promise<readonly { id: string; broken?: string }[]>
  register(definition: unknown): Promise<() => Promise<void>>
  readDocument(id: string): Promise<{ agentPreset: string; content: string }>
}

export interface RingSnapshot {
  /** loader 树上的 entry 数。 */
  readonly entries: number
  /** 插件 fiber 状态名。 */
  readonly fiberState: string
  /** fiber 上活着的 effect 数（getEffects 面）。 */
  readonly effects: number
  /** ctx.registry 已登记插件回调数。 */
  readonly registryPlugins: number
  /** reflect 表里的服务名集（sorted）。 */
  readonly serviceNames: readonly string[]
  /** 11 研究工具在 ToolRuntime 的在册名（sorted）。 */
  readonly researchTools: readonly string[]
  /** commands fake 的在册命令名（sorted）。 */
  readonly commands: readonly string[]
  /** 会话事件监听器数（fiber-effect 的监听器计数观测面）。 */
  readonly sessionHooks: { created: number; disposed: number; event: number }
}

interface LoadedHarnessOptions {
  /** true → 单项目 plane（11 工具 + 4 命令 + sqlite wiring）；false → 空 plane。 */
  readonly withPlane: boolean
  /** true → 提供 agents fake（launcher 断言用）。 */
  readonly withAgents: boolean
}

async function bootRing(options: LoadedHarnessOptions): Promise<RingHarness> {
  // AGENTS §3：DSH_HOME（防御性——某些 dsh-* 导入会读它）收进工作区
  // tests/dsh-homes/leak-ring/（gitignore 内，可弃；G5 的 freshDshHome 同角色）。
  const homeRoot = fileURLToPath(new URL(`../../dsh-homes/leak-ring/home-${Date.now()}-${Math.random().toString(16).slice(2, 8)}/`, import.meta.url))
  mkdirSync(homeRoot, { recursive: true })
  homes.push(homeRoot)
  process.env['DSH_HOME'] = homeRoot
  const workspacePaths: string[] = []
  if (options.withPlane) {
    const { hubPath, wsPath } = ringPlane()
    workspacePaths.push(hubPath, wsPath)
  }
  const root = new Context()

  // FAKE (disclosed): systemPrompt — ToolRuntime native 模式只触碰这三个成员。
  root.provide('systemPrompt', {
    tools: (_cb: unknown) => ({ dispose: (): void => {} }),
    section: (_s: unknown) => ({ dispose: (): void => {} }),
    getSectionOrder: (_name: string) => 0,
  })

  // REAL: ToolRuntime（宿主 `ctx.tools` 同名同实现）— 11 工具注册/回收的裁判。
  await root.plugin(ToolRuntime, { mode: 'native' })
  const runtime = root.get('tools') as unknown as { get(name: string): unknown }

  // REAL: Loader（真实装载单元）+ internal seam（pr8 手法：host-shaped import）。
  await root.plugin(PluginLoader)
  const loader = root.get('loader') as LoaderType
  // internal seam（pr8 手法）：ModuleLoader 公开面还有其余成员，这里只
  // 替换 import——结构赋值经 unknown（真实装载单元不变，只喂模块表）。
  loader.internal = {
    import: async (name: string) => {
      if (name === 'dsh-research-control') return { default: hostEntry }
      throw new Error(`leak-ring harness: unexpected module specifier ${JSON.stringify(name)}`)
    },
  } as unknown as LoaderType['internal']

  // REAL: preset 名册栈（Duplicate 裁定的宿主一侧）。
  await root.plugin(SessionProjectionRegistry)
  await root.plugin(AgentPresetRegistry, { default: 'standard' })
  const roster = root.get('agentPresets') as unknown as AgentPresetsObserved

  // FAKE (disclosed): 宿主应用面 — sessions/subagents/workspaceRegistry。
  root.provide('sessions', { list: () => [] })
  root.provide('subagents', {})
  root.provide('workspaceRegistry', { list: () => workspacePaths.map((path) => ({ path })) })

  // FAKE (disclosed, 观测面): commands — 注册即入册，disposer 即除名。
  const liveCommands = new Map<string, CommandRecord>()
  root.provide('commands', {
    register(def: CommandRecord): () => void {
      if (liveCommands.has(def.name)) throw new Error(`leak-ring: duplicate command ${def.name}`)
      liveCommands.set(def.name, def)
      return () => liveCommands.delete(def.name)
    },
    async execute(): Promise<unknown> {
      return { commandId: 'cmd-ring', result: { kind: 'success', text: 'settled' } }
    },
  })

  // FAKE (disclosed): agents — agents.create 的时序面（preset-registry 测试同款）。
  const minted: string[] = []
  if (options.withAgents) {
    root.provide('agents', {
      async create(o: { sessionId: string }): Promise<unknown> {
        minted.push(o.sessionId)
        return {
          agent: { id: o.sessionId, status: 'idle', followup: () => undefined },
          async dispose(): Promise<void> { /* host-owned */ },
        }
      },
      get: () => undefined,
    })
  }

  const entryId = 'research-control'
  // 配置行形态建 entry：真实配置更新面（EntryGroup.update，group.ts:46-63）
  // 总是把**含 id** 的完整 EntryOptions 递给 create → ensureId（tree.ts:51-58）
  // 读到 options.id 即用（id 确定，后续 resolve(entryId) 命中）；公开签名
  // Omit 了 id——此处对齐那条真实调用形态。
  const entryOptions = { id: entryId, name: 'dsh-research-control', config: {} }
  await loader.create(entryOptions as Omit<EntryOptions, 'id'>)

  const settle = async (): Promise<void> => {
    await loader.await()
    const fiber = loader.resolve(entryId).fiber
    if (fiber) await fiber.await()
  }
  await settle()

  const snapshot = (): RingSnapshot => {
    const entry = loader.resolve(entryId)
    const fiber = entry.fiber
    const reflectStore = (root as unknown as { reflect: { store: Record<symbol, { name: string }> } }).reflect.store
    // store 的键是 symbol（Dict<Impl, symbol>）——Object.values 看不到，必须走
    // getOwnPropertySymbols（cordis reflect.ts:209）。
    const serviceNames = Object.getOwnPropertySymbols(reflectStore)
      .map((key) => reflectStore[key]?.name ?? '(anon)')
      .sort()
    const hooks = root.events._hooks as Record<string, unknown[] | undefined>
    return {
      entries: [...loader.entries()].length,
      fiberState: fiber === undefined ? 'ABSENT' : (FIBER_STATE_NAMES[fiber.state as number] ?? `#${String(fiber.state)}`),
      effects: fiber === undefined ? 0 : fiber.getEffects().length,
      registryPlugins: [...root.registry.keys()].length,
      serviceNames,
      researchTools: RESEARCH_TOOL_NAMES.filter((name) => runtime.get(name) !== undefined).slice().sort(),
      commands: [...liveCommands.keys()].sort(),
      sessionHooks: {
        created: (hooks['session/created'] ?? []).length,
        disposed: (hooks['session/disposed'] ?? []).length,
        event: (hooks['session/event'] ?? []).length,
      },
    }
  }

  const teardown = async (): Promise<void> => {
    const entry = loader.resolve(entryId)
    if (entry.fiber?.uid !== null) {
      await entry.update({ disabled: true } as never)
      await settle()
    }
    await root.fiber.dispose()
  }

  return {
    root,
    loader,
    entryId,
    liveCommands,
    minted,
    roster,
    settle,
    currentEntry: () => loader.resolve(entryId),
    currentFiber: () => {
      const fiber = loader.resolve(entryId).fiber
      if (fiber === undefined) throw new Error('leak-ring: entry has no fiber yet')
      return fiber
    },
    async enable(): Promise<void> {
      const entry = loader.resolve(entryId)
      if (!entry.disabled) return
      await entry.update({ disabled: false } as never)
      await settle()
    },
    async disable(): Promise<void> {
      const entry = loader.resolve(entryId)
      if (entry.disabled) return
      const fiber = entry.fiber
      await entry.update({ disabled: true } as never)
      if (fiber) await fiber.await()
      await settle()
    },
    snapshot,
    teardown,
  }
}

/** 单项目 plane 环：11 工具 + 4 命令 + sqlite wiring 全量注册的泄漏环主体。 */
export function bootLoadedRing(): Promise<RingHarness> {
  return bootRing({ withPlane: true, withAgents: true })
}

/** 空 plane 环（无 git/sqlite 触达）— fake timers 友好。 */
export function bootEmptyRing(): Promise<RingHarness> {
  return bootRing({ withPlane: false, withAgents: true })
}

/** roster 快照（异步 — preset 名册 list 是 async 面）。 */
export async function rosterIds(harness: RingHarness): Promise<readonly string[]> {
  return (await harness.roster.list()).map((row) => row.id).sort()
}
