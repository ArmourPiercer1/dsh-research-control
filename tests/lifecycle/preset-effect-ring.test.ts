/**
 * 0.2 泄漏环（第 1 层 · preset 声明效应 + Duplicate 裁定半）— investigator
 * preset 的声明式 `register` 经 `ctx.effect` 挂插件 fiber：unload 即从真名册
 * 回收、reload 干净重注册、名册残留同名声明时 Duplicate 视作 present（pr8 用户
 * 裁定的回归锁）。
 *
 * 一手出处:
 *  - 插件侧注册-as-effect + Duplicate 容忍：src/host/dsh-adapter/launcher/
 *    adapter.ts:339-372（`ctx.effect(() => roster.register(...), 'research-control/
 *    investigator-preset')`；`'Duplicate agent preset'` → lastPresetEnsure
 *    'present'，内容由 readDocument 闭集回读门把关）。
 *  - 宿主名册：checkout packages/preset/agent-preset-registry/src/index.ts:83
 *    （`Duplicate agent preset: <id>` 抛出点）、:153（list）、register 返回
 *    async disposer（lib/types/index.d.ts:41-43「Definition disposer … the
 *    declaring plugin owns it」）。
 *  - fiber 卸载 await async disposer：cordis 4.0.4 src/fiber.ts:672-690
 *    （_unload 对全部 disposables `await`）——「effect 随 fiber 回收」的
 *    async-effect 半环。
 *
 * REAL：真 cordis Context/Loader/AgentPresetRegistry/SessionProjectionRegistry
 * （与 tests/g5-real-registry/investigator-preset-registry.test.ts 同一真名册
 * 栈）+ 真插件 fiber（本环经 helpers/ring-harness 的真实 Loader Entry 装载）。
 * FAKE（披露，同 g5 preset-registry 先例）：`agents` 假工厂、`commands` 记录
 * 型假面；preset 行里的 dsh-tool-bash/dsh-tool-fs-search 非本插件 devDep ⇒
 * 真注册表 activation 诚实报 broken → launch 收 IVL_PRESET_BROKEN——注册效应
 * 已先落地，本环锁的正是该效应的生命周期，broken 诊断不构成假绿。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { HostAgentLauncherAdapter } from '../../src/host/dsh-adapter/launcher/index.js'
import {
  INVESTIGATOR_PRESET_ID,
  READ_ONLY_PERMISSION_PRESET,
  investigatorPresetDefinition,
  isInvestigatorLaunchError,
  type InvestigatorLaunchRequest,
} from '../../src/host/service/investigator/index.js'
import {
  RING_ROUNDS,
  bootEmptyRing,
  ringCleanupAll,
  rosterIds,
  type RingHarness,
} from './helpers/ring-harness.js'

const REQUEST: InvestigatorLaunchRequest = {
  presetId: INVESTIGATOR_PRESET_ID,
  permissionPreset: READ_ONLY_PERMISSION_PRESET,
  cwd: '/ws/project',
  task: '泄漏环：preset 声明效应生命周期',
}

afterAll(() => ringCleanupAll())

/** 真名册里 investigator 行是否在册。 */
async function rosterHas(h: RingHarness, id: string): Promise<boolean> {
  return (await rosterIds(h)).includes(id)
}

/** 在 CURRENT 插件 fiber 上组装生产同款 launcher 适配器。
 * 注意：取 fiber.ctx（服务实例经 traceable 代理读 .ctx 会被重绑到调用方
 * ctx — cordis utils.createTraceable 的 tracker.property 语义），与生产
 * `new HostAgentLauncherAdapter(this.ctx)` 同一 ctx 身份。 */
function adapterOnPluginFiber(h: RingHarness): HostAgentLauncherAdapter {
  const fiberCtx = h.currentFiber().ctx as unknown as ConstructorParameters<typeof HostAgentLauncherAdapter>[0]
  return new HostAgentLauncherAdapter(fiberCtx)
}

async function expectBrokenLaunch(adapter: HostAgentLauncherAdapter): Promise<void> {
  const caught = await adapter.launchInvestigator(REQUEST).then(
    () => undefined,
    (error: unknown) => error,
  )
  // 披露面的 broken 诊断（工具包不在本部署）——不是 IVL_PRESET（注册失败）
  // 也不是 Duplicate 误伤（那会把裁定语义打坏）。
  expect(caught, 'launch 应被拒（broken 行）').toBeInstanceOf(Error)
  expect(isInvestigatorLaunchError(caught), `launch 错误应是 InvestigatorLaunchError，实际: ${(caught as Error).message}`)
    .toBe(true)
  expect((caught as { code: string }).code).toBe('IVL_PRESET_BROKEN')
}

describe('investigator preset 声明效应 × reload 环（真名册 + Duplicate 裁定）', () => {
  it(
    `每轮注册随 fiber 回收、reload 干净重注册（${RING_ROUNDS} 轮）`,
    async () => {
      const h = await bootEmptyRing()
      try {
        for (let round = 1; round <= RING_ROUNDS; round += 1) {
          // 未 launch 前名册干净（首轮）或已被上一轮 unload 清空（后续轮）。
          expect(await rosterHas(h, INVESTIGATOR_PRESET_ID), `round ${round}: 装载≠注册`).toBe(false)

          const adapter = adapterOnPluginFiber(h)
          await expectBrokenLaunch(adapter)
          // 声明真实落入真名册（注册效应活在插件 fiber 上）。
          expect(adapter.lastPresetEnsure, `round ${round}: 本轮完成真注册`).toBe('registered')
          expect(await rosterHas(h, INVESTIGATOR_PRESET_ID), `round ${round}: 名册含行`).toBe(true)

          await h.disable()
          // 真名册 + 真 fiber 卸载：async disposer 被 await，行被回收。
          expect(await rosterHas(h, INVESTIGATOR_PRESET_ID), `round ${round}: unload 后名册回收`).toBe(false)

          if (round < RING_ROUNDS) await h.enable()
        }
      } finally {
        await h.teardown()
      }
    },
    RING_ROUNDS * 15_000,
  )

  it('并发双实例 ensure 竞态：一方真注册、另一方 Duplicate → present（裁定 catch 分支）', async () => {
    const h = await bootEmptyRing()
    try {
      // 裁定的竞态形态（adapter.ts:345 注释：「并发 ensure 或宿主/其他实例
      // 先声明」）：两个适配器实例（生产形态 = 另一插件 fiber/另一实例）
      // 同时 ensure，名册未知同一 id。
      const a1 = adapterOnPluginFiber(h)
      const a2 = adapterOnPluginFiber(h)
      const results = await Promise.allSettled([
        a1.launchInvestigator(REQUEST),
        a2.launchInvestigator(REQUEST),
      ])
      // 双方都只可能停在 broken 行门（IVL_PRESET_BROKEN）：注册面零 IVL_PRESET
      // ——Duplicate 被视作 present，未打坏启动语义。
      for (const r of results) {
        expect(r.status).toBe('rejected')
        const error = (r as PromiseRejectedResult).reason
        expect(isInvestigatorLaunchError(error), `launch 错误类型: ${(error as Error).message}`).toBe(true)
        expect((error as { code: string }).code).toBe('IVL_PRESET_BROKEN')
      }
      const ensures = [a1.lastPresetEnsure, a2.lastPresetEnsure].sort()
      expect(ensures, '恰好一个真注册 + 一个 Duplicate→present').toEqual(['present', 'registered'])
      // Duplicate 方不留半效：名册恰一行，且归真注册方的 fiber 效应所有——
      // unload 后整行回收（无孤儿行、无悬挂效应）。
      expect(await rosterIds(h), '名册恰一行').toEqual([INVESTIGATOR_PRESET_ID])
      await h.disable()
      expect(await rosterHas(h, INVESTIGATOR_PRESET_ID), 'unload 回收唯一行（含 Duplicate 竞态后）').toBe(false)
    } finally {
      await h.teardown()
    }
  })

  it('reload 后名册残留同名声明：launch 短路 present，unload 不误伤他人所有权', async () => {
    const h = await bootEmptyRing()
    let presetDisposer: (() => Promise<void>) | undefined
    try {
      // resolve 即可见的残留行（「本插件 reload 后名册未清」的另一面）：
      // ensure 走 present 短路，不触达 register。
      presetDisposer = await h.roster.register(investigatorPresetDefinition())
      expect(await rosterHas(h, INVESTIGATOR_PRESET_ID), '预置残留行在册').toBe(true)

      const adapter = adapterOnPluginFiber(h)
      await expectBrokenLaunch(adapter)
      expect(adapter.lastPresetEnsure, '残留行 → present').toBe('present')
      expect(await rosterIds(h), '残留行未被误删/重复').toEqual([INVESTIGATOR_PRESET_ID])

      // unload 后：残留行不属于插件 fiber ⇒ 仍在册（效应回收只收自家所有权）。
      await h.disable()
      expect(await rosterHas(h, INVESTIGATOR_PRESET_ID), '他人所有权不随插件 unload 回收').toBe(true)
    } finally {
      await presetDisposer?.()
      await h.teardown()
    }
  })
})
