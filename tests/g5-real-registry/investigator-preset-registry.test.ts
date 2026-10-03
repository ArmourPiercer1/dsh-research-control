/**
 * 0.2.0-rc.2 re-anchor — the launcher preset flow against the REAL
 * `@deepseek-ai/dsh-agent-preset-registry` service (no fakes in the roster:
 * real Loader + real SessionProjectionRegistry + real AgentPresetRegistry
 * booted on a real cordis Context — boot chain verified:
 * `static inject = ['loader', 'sessionProjections']`, config
 * `{ default: '<id>' }`).
 *
 * What is REAL here:
 *  - `register(investigatorPresetDefinition())` — the real declarative
 *    registration the adapter performs through `ctx.effect` (activation
 *    semantics, duplicate guard, async disposer, roster visibility);
 *  - `readDocument(id).content` — the real entry-list YAML dump is fed
 *    through the plugin's closed-set parser (the read-back gate holds on
 *    the registry's actual serialization, not a hand-written string);
 *  - the not-found / broken diagnostics: `RemoteError('agent-preset/not-found')`
 *    and the activation `broken` report drive the adapter's error codes;
 *  - fiber recycling: disposing the plugin-fiber effect runs the real
 *    unregister (roster empties, re-register is clean).
 *
 * What is DISCLOSED as environment-limited (mirrors the g5 suite's
 * REAL/SIMULATED discipline):
 *  - `@deepseek-ai/dsh-tool-bash` / `@deepseek-ai/dsh-tool-fs-search` are
 *    NOT plugin devDependencies (they are host-app composition), so the
 *    investigator preset ACTIVATION fails with the registry's honest
 *    "never started" diagnostic → the launch surfaces
 *    `IVL_PRESET_BROKEN`. The mount happy path is host-app scope and is
 *    covered by the real-host e2e smoke (TC-DSH), not here;
 *  - the non-closed declaration uses an installed, activation-clean
 *    plugin (`@deepseek-ai/cordis-plugin-group` with `config: []`) as the
 *    rogue row — the gate must reject ANY name outside the closed set,
 *    whatever the row is;
 *  - `agents` / `commands` fakes (g5 precedent — host-app capabilities).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { default as TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { default as PluginLoader } from '@deepseek-ai/cordis-plugin-loader'
import { default as SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { default as AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'

import { HostAgentLauncherAdapter } from '../../src/host/dsh-adapter/launcher/index.js'
import {
  INVESTIGATOR_PRESET_ID,
  INVESTIGATOR_PRESET_TOOL_NAMES,
  READ_ONLY_PERMISSION_PRESET,
  investigatorPresetDefinition,
  isInvestigatorLaunchError,
  parsePresetComposition,
  type InvestigatorLaunchRequest,
} from '../../src/host/service/investigator/index.js'

/** Real four-service roster deployment + the two launch seams the adapter
 *  resolves through `ctx.get` (disclosed fakes — g5 precedent). */
async function bootRealRoster() {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(PluginLoader)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentPresetRegistry, { default: 'standard' })
  const roster = ctx.get('agentPresets')
  if (roster === undefined) throw new Error('real roster service absent after boot')
  const minted: string[] = []
  ctx.provide('agents', {
    async create(options: { sessionId: string }) {
      minted.push(options.sessionId)
      return {
        agent: { id: options.sessionId, status: 'idle', followup: () => undefined },
        async dispose() { /* host-owned */ },
      }
    },
    get: () => undefined,
  })
  ctx.provide('commands', {
    async execute() {
      return { commandId: 'cmd-real', result: { kind: 'success' as const, text: 'settled' } }
    },
  })
  const effects: { label: string; dispose: () => Promise<void> }[] = []
  const patched = {
    get: (name: string) => (ctx as unknown as { get(n: string): unknown }).get(name),
    effect: async (execute: () => unknown, label?: string) => {
      const produced = (await (execute as () => unknown)()) as (() => Promise<void> | void) | void
      let done = false
      const dispose = async () => {
        if (done) return
        done = true
        await produced?.()
      }
      effects.push({ label: label ?? '(unlabeled)', dispose })
      return dispose
    },
  }
  return {
    ctx,
    roster: roster as unknown as {
      resolve(id?: string): Promise<{ id: string; broken?: string }>
      list(): Promise<readonly { id: string; broken?: string }[]>
      register(definition: unknown): Promise<() => Promise<void>>
      readDocument(id: string): Promise<{ agentPreset: string; content: string }>
    },
    minted,
    effects,
    adapter: () => new HostAgentLauncherAdapter(patched as never),
    async dispose() {
      for (const effect of [...effects].reverse()) await effect.dispose()
      await ctx.fiber.dispose()
    },
  }
}

const REQUEST: InvestigatorLaunchRequest = {
  presetId: INVESTIGATOR_PRESET_ID,
  permissionPreset: READ_ONLY_PERMISSION_PRESET,
  cwd: '/ws/project',
  task: 'G5：真实 preset 注册表验收',
}

let h: Awaited<ReturnType<typeof bootRealRoster>> | undefined

afterAll(async () => {
  await h?.dispose()
  h = undefined
})

describe('0.2 真实 agent-preset-registry — launcher ensure 流', () => {
  it('register(闭集定义) 真落名册：readDocument 真实 YAML dump 过闭集解析；activation 面 IVL_PRESET_BROKEN（工具包不属本插件 — 披露）', async () => {
    h = await bootRealRoster()
    const adapter = h.adapter()

    const caught = await adapter.launchInvestigator(REQUEST).then(
      () => undefined,
      (error: unknown) => error,
    )
    // 本 context 只有注册表所需的 4 个服务, 不提供 tool-bash/fs-search
    // 注入的宿主面（tools/shell/systemPrompt/…）⇒ 真注册表 activation
    // 诚实报 broken（"waiting for …"）— 适配器拒启动（IVL_PRESET_BROKEN），
    // 零会话创建。（完整正例（真激活+enforcement）见
    // investigator-lifecycle.test.ts。）
    expect(caught !== undefined && isInvestigatorLaunchError(caught) && caught.code).toBe('IVL_PRESET_BROKEN')
    expect((caught as Error).message).toMatch(/waiting for|never started/)
    expect(h.minted).toHaveLength(0)

    // 声明真实落入名册（list 含行 + broken 诊断）。
    const rows = await h.roster.list()
    expect(rows.map(row => row.id)).toContain(INVESTIGATOR_PRESET_ID)

    // 关键迁移证明：注册表自己的 entry-list dump（readDocument.content）
    // 与插件闭集解析器逐字节兼容 — 2 行只读组合, 无多余键。
    const document = await h.roster.readDocument(INVESTIGATOR_PRESET_ID)
    const spec = parsePresetComposition(INVESTIGATOR_PRESET_ID, document.content)
    expect(spec.rows.map(row => row.name).sort()).toEqual([...INVESTIGATOR_PRESET_TOOL_NAMES].sort())

    // Duplicate 语义（真注册表）与适配器的竞态判定一致。
    await expect(h.roster.register(investigatorPresetDefinition())).rejects.toThrow(/Duplicate agent preset/)
  })

  it('注册经 ctx.effect 挂 fiber — 卸载走真 unregister（名册清空, 重注册干净）', async () => {
    // 复用上一用例的 deployment 不干净（已 dispose? 未 dispose — 但
    // 用例间状态共享会互踩）— 独立 boot。
    const run = await bootRealRoster()
    try {
      await run.adapter().launchInvestigator(REQUEST).catch(() => undefined)
      expect(run.effects.map(effect => effect.label)).toEqual(['research-control/investigator-preset'])
      expect((await run.roster.list()).map(row => row.id)).toContain(INVESTIGATOR_PRESET_ID)

      for (const effect of [...run.effects].reverse()) await effect.dispose()
      const after = await run.roster.list()
      expect(after.map(row => row.id)).not.toContain(INVESTIGATOR_PRESET_ID)

      // 重注册（reload 语义）— 无 Duplicate 残留。
      await run.adapter().launchInvestigator(REQUEST).catch(() => undefined)
      expect((await run.roster.list()).map(row => row.id)).toContain(INVESTIGATOR_PRESET_ID)
    } finally {
      await run.dispose()
    }
  })

  it('名册已有激活成功的非闭集声明 ⇒ IVL_PRESET_NOT_READONLY（真 dump 回读门, 零会话）', async () => {
    const run = await bootRealRoster()
    try {
      // 直接以 investigator 身份声明一个「可激活但不闭集」的组合
      // （group 插件空列表 — 已验证零服务可激活）。
      await run.roster.register({
        id: INVESTIGATOR_PRESET_ID,
        plugins: [{ id: 'g', name: '@deepseek-ai/cordis-plugin-group', config: [] }],
      })
      const resolved = await run.roster.resolve(INVESTIGATOR_PRESET_ID)
      expect(resolved.broken).toBeUndefined() // 声明已激活 — 门必须自己拒

      const caught = await run.adapter().launchInvestigator(REQUEST).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(caught !== undefined && isInvestigatorLaunchError(caught) && caught.code).toBe('IVL_PRESET_NOT_READONLY')
      expect((caught as Error).message).toContain('@deepseek-ai/cordis-plugin-group')
      expect(run.minted).toHaveLength(0)
    } finally {
      await run.dispose()
    }
  })

  it('unknown 判定用真 RemoteError 形状：not-found 行不吞坏成 IVL_PRESET 之外的码', async () => {
    const run = await bootRealRoster()
    try {
      // 名册为空 — launch 走 register（激活 broken 拒启动）; 但先证明
      // 空名册 resolve 抛的正是 isDSHRemoteError + code + details 三件套
      // （适配器的 unknown 判定依据）。
      const caught = await run.roster.resolve(INVESTIGATOR_PRESET_ID).then(
        () => undefined,
        (error: unknown) => error as Record<string, unknown>,
      )
      expect(caught).toBeDefined()
      expect(caught!['isDSHRemoteError']).toBe(true)
      expect(caught!['code']).toBe('agent-preset/not-found')
      expect((caught!['details'] as { agentPreset?: string }).agentPreset).toBe(INVESTIGATOR_PRESET_ID)
    } finally {
      await run.dispose()
    }
  })
})
