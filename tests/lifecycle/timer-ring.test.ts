/**
 * 0.2 泄漏环（第 1 层 · 定时器面）— fake timers 下反复 load/unload：
 * 装载不得留下「卸载后仍悬挂」的定时器。
 *
 * 层级选择（如实）：本环跑在 EMPTY plane（空 workspaceRegistry）上——
 * 插件宿主面在源码层唯一的计时器调用是 git 子进程超时（src/host/git/
 * runner.ts:143 setTimeout，命令完成即 clearTimeout；仅在含 wiring 的
 * plane 触达，且其 execa 子进程在 fake timers 下的结算时序会引入抖动）。
 * 「带 wiring 的定时器」面因此记为：静态代码事实（超时定时器随调用局部
 * 创建/清除）+ live 层观测（GUI/真机），本环锁的是装载生命周期本体
 * （服务构造/session 订阅/settings/preset 名册栈）零悬挂计时器。
 *
 * 依据：cordis fiber _unload 对 disposables 的 await 语义（node_modules
 * @deepseek-ai/cordis/src/fiber.ts:672-690）+ Loader Entry disable/
 * enable 语义（@deepseek-ai/cordis-plugin-loader src/config/entry.ts:
 * 113-157）。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RING_ROUNDS, bootEmptyRing, ringCleanupAll } from './helpers/ring-harness.js'

// 只 fake 计时 API——微任务/fs promise 保持真实（装载路径靠 await 推进）。
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
})
afterEach(() => {
  vi.useRealTimers()
})

afterAll(() => {
  ringCleanupAll()
})

describe('fake timers：load/unload 环零悬挂计时器', () => {
  it(`每轮卸载后 vi.getTimerCount() === 0（${RING_ROUNDS} 轮）`, async () => {
    const h = await bootEmptyRing()
    try {
      // 装载后基线：服务本体不注册任何常驻计时器。
      expect(vi.getTimerCount(), '装载相计时器数').toBe(0)
      for (let round = 1; round <= RING_ROUNDS; round += 1) {
        await h.disable()
        expect(vi.getTimerCount(), `round ${round}: 卸载后无悬挂计时器`).toBe(0)
        if (round < RING_ROUNDS) {
          await h.enable()
          expect(vi.getTimerCount(), `round ${round}: 重载相计时器数`).toBe(0)
        }
      }
    } finally {
      // teardown 里 fiber 回收是纯 promise 链（无计时依赖）——先解 fake
      // timers 再收，避免 DisposableList 的 await 与 fake 队列相互等待。
      vi.useRealTimers()
      await h.teardown()
    }
  }, RING_ROUNDS * 15_000)
})
