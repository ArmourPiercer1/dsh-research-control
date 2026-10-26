/**
 * 0.2 泄漏环（第 1 层 · 宿主半）— 反复 load/unload/reload 不泄漏
 * fiber/effect/监听器/注册项。
 *
 * 装载单元与语义依据（一手出处，train 0.2.0-rc.2 @ c1b47e41fc checkout /
 * 本仓 node_modules 的 train pin 包 src）:
 *  - 装载单元 = Loader Entry：`@deepseek-ai/cordis-plugin-loader` 1.0.5
 *    src/config/entry.ts:208-238（init → tree.import → registry.plugin）、
 *    src/config/entry.ts:113-157（update：disabled → fiber.dispose；解禁 →
 *    init 重新 import + 新 fiber）——宿主 plugin-manager 的 GUI disable/
 *    enable 驱动的就是这对 API（checkout packages/boot/plugin-manager/
 *    src/index.ts:260-267 对 entry/fiber 的同一断言形态）。
 *  - unload = fiber.dispose → uid null + effect 逆序回收：cordis 4.0.4
 *    src/fiber.ts:265-297（dispose disposer）、src/fiber.ts:672-690
 *    （_unload：`_disposables.clear()` 全部 await）。
 *  - `ctx.effect` 注册即 fiber 回收合同：fiber.ts:346-380（effect 收集）；
 *    本插件的注册-as-effect 面（DSH_ADAPTER §9/§10.1）：
 *    src/host/dsh-adapter/host/index.ts:913（sqlite wiring 图 disposer）、
 *    :1004-1039（11 工具 tools.register）、:956-968（investigate/analysis
 *    命令注册 disposer）。
 *  - 监听器 = 事件 fiber-effect：src/host/dsh-adapter/session.ts（3+2 个
 *    ctx.events.on），cordis events.ts on → fiber effect 回收。
 *  - Duplicate 裁定（pr8 用户裁定，launcher 侧）：src/host/dsh-adapter/
 *    launcher/adapter.ts:343-372（'Duplicate agent preset' → 视作 present）；
 *    宿主侧 `Duplicate agent preset` 抛出点 checkout
 *    packages/preset/agent-preset-registry/src/index.ts:83。
 *
 * harness 的 REAL/FAKE 分界见 helpers/ring-harness.ts 头注。
 */
import { afterAll, describe, expect, it } from 'vitest'
import hostEntry from '../../src/host/index.js'
import {
  FIBER_ACTIVE,
  FIBER_DISPOSED,
  RING_ROUNDS,
  bootLoadedRing,
  ringCleanupAll,
  type RingHarness,
  type RingSnapshot,
} from './helpers/ring-harness.js'

const RESEARCH_TOOL_TOTAL = 11
const RESEARCH_COMMAND_TOTAL = 4

afterAll(() => ringCleanupAll())

describe('load/unload/reload 泄漏环（真实 Loader Entry × N 轮）', () => {
  it(
    `每轮注册项计数回到基线、effect/监听器/fiber 全回收（${RING_ROUNDS} 轮）`,
    async () => {
      const h: RingHarness = await bootLoadedRing()
      try {
        const activeSnaps: RingSnapshot[] = []
        const disabledSnaps: RingSnapshot[] = []
        let baseline: RingSnapshot | undefined
        let previousFiber: ReturnType<RingHarness['currentFiber']> | undefined

        for (let round = 1; round <= RING_ROUNDS; round += 1) {
          // ---- ACTIVE 相：注册项完整 ----
          const active = h.snapshot()
          activeSnaps.push(active)
          expect(active.fiberState, `round ${round}: ACTIVE`).toBe('ACTIVE')
          expect(
            active.researchTools.length,
            `round ${round}: 11 工具在册`,
          ).toBe(RESEARCH_TOOL_TOTAL)
          expect(active.commands.length, `round ${round}: 4 命令在册`).toBe(RESEARCH_COMMAND_TOTAL)
          expect(active.serviceNames, `round ${round}: researchControl 服务在册`).toContain('researchControl')
          expect(active.effects, `round ${round}: fiber 持有 effect`).toBeGreaterThan(0)
          expect(active.entries, `round ${round}: 装载单元恒 1`).toBe(1)

          const fiber = h.currentFiber()
          expect(fiber.state, `round ${round}: fiber ACTIVE`).toBe(FIBER_ACTIVE)
          // 上轮 fiber 已 DISPOSED 且不复用（新装载 = 新 fiber 对象）。
          if (previousFiber !== undefined) {
            expect(previousFiber.state, `round ${round}: 上一轮 fiber 已 DISPOSED`).toBe(FIBER_DISPOSED)
            expect(h.currentFiber(), `round ${round}: 新 fiber 非旧对象`).not.toBe(previousFiber)
          }
          // ---- UNLOAD 相：entry.update({disabled:true}) → fiber.dispose ----
          await h.disable()
          const disabled = h.snapshot()
          disabledSnaps.push(disabled)
          expect(fiber.state, `round ${round}: 旧 fiber DISPOSED`).toBe(FIBER_DISPOSED)
          expect(fiber.uid, `round ${round}: uid 清空`).toBeNull()
          // effect 全回收（_disposables.clear() 的 getEffects 面）。
          expect(fiber.getEffects().length, `round ${round}: effect 清空`).toBe(0)
          // 注册项计数回基线。
          expect(disabled.researchTools, `round ${round}: 11 工具全部注销`).toEqual([])
          expect(disabled.commands, `round ${round}: 4 命令全部注销`).toEqual([])
          expect(disabled.serviceNames, `round ${round}: researchControl 撤下`).not.toContain('researchControl')

          // 首轮 disabled 相 = 基线；后续轮必须与基线逐字段相等（漂移即泄漏）。
          if (baseline === undefined) {
            baseline = disabled
          } else {
            expect(disabled, `round ${round}: disabled 相与基线漂移`).toEqual(baseline)
          }

          // ---- RELOAD 相（末轮除外由循环自然结束）----
          if (round < RING_ROUNDS) {
            previousFiber = fiber
            await h.enable()
          }
        }

        // 跨轮 ACTIVE 快照逐字段相等：装载形状不随轮数漂移。
        for (let round = 1; round < activeSnaps.length; round += 1) {
          expect(activeSnaps[round], `ACTIVE 相 round ${round + 1} 漂移`).toEqual(activeSnaps[0])
        }
        // 环跑完后监听器数 = 基线（session 事件监听器由 effect 随 fiber 回收）。
        const finalDisabled = h.snapshot()
        expect(finalDisabled.sessionHooks).toEqual(baseline!.sessionHooks)
        expect(finalDisabled.registryPlugins, 'registry 插件回调数回基线')
          .toBe(baseline!.registryPlugins)
      } finally {
        await h.teardown()
      }
    },
    RING_ROUNDS * 15_000,
  )

  it('ACTIVE 期重复装载的语义钉（Duplicate 面：不留悬挂注册项）', async () => {
    const h = await bootLoadedRing()
    try {
      // 真宿主语义探针（实测钉）：ACTIVE 期同 class 直载在 Service 构造的
      // provide 处即抛 `service "researchControl" has been registered`
      // （cordis reflect provide 冲突，src/reflect.ts:288-290）——不存在
      // 双 fiber 并存路径；断言取此实测形态。
      let secondError: unknown
      try {
        const second = (await h.root.plugin(hostEntry, {})) as unknown as { dispose(): Promise<void> }
        // 防御：若未来出现并存路径，先拆掉再失败（不静默通过）。
        await second.dispose()
        secondError = new Error('意外的双载并存路径（本版本 cordis 应响亮失败）')
      } catch (error) {
        secondError = error
      }
      expect(secondError, '重复装载必须响亮失败（不静默并存）').toBeInstanceOf(Error)
      expect((secondError as Error).message).toContain('has been registered')
      // entry fiber 必须毫发无损（重复装载的失败不得反噬 entry）。
      expect(h.currentFiber().state).toBe(FIBER_ACTIVE)
      expect(h.snapshot().researchTools.length).toBe(RESEARCH_TOOL_TOTAL)
      // entry 正常 disable：注册项计数仍回基线。
      await h.disable()
      const after = h.snapshot()
      expect(after.researchTools).toEqual([])
      expect(after.commands).toEqual([])
      expect(after.serviceNames).not.toContain('researchControl')
    } finally {
      await h.teardown()
    }
  })
})
