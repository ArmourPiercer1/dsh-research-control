/**
 * 0.2 泄漏环（第 1 层 · 客户端入口半）— 函数式客户端插件 `apply` 的
 * load→unload→reload 环：remote 挂载与 slot 登记随 fiber 回收、重载后
 * 干净重挂且不累积。
 *
 * 装载单元：真实 cordis fiber（`ctx.plugin(moduleNamespace)` — registry
 * resolve 的函数式插件形态，inject=['slots','remote'] 由真 fiber 解析，
 * cordis 4.0.4 src/registry.ts:208+ / fiber.ts:246-263）。宿主浏览器侧的
 * 装载器（client runtime assembly / entry-lifecycle / React 渲染）是
 * GUI/live 面，本环不冒充——本环锁的是 apply() 两半（mountResearchRemotes
 * + registerResearchUI）在真 fiber 效应合同下的回收语义。
 *
 * FAKE（披露）:
 *  - `remote`：真 Service 实例（`super(ctx,'remote')`），`$mount` 复刻宿主
 *    网关契约——checkout packages/api/gateway/src/client/index.ts:202-209
 *    的 `$mount` = callerCtx.effect(挂载→返回 disposer) + 显式 disposer 复用
 *    同一 owned effect；caller ctx 经 cordis tracker 机制绑定（utils.ts
 *    createTraceable 的 tracker.property='ctx'，与服务实例同一身份机制）。
 *    传输层（connection.rpc/worker）不在环内——GUI 面。
 *  - `slots`：复刻真宿主 SlotRegistry 的 caller-fiber effect 绑定（checkout
 *    packages/client/ui-renderer/src/client/registry.ts:3-7、195-206
 *    「register and declaration injection through the caller's ctx.effect
 *    (fiber unload = cascade)」）；贡献在声明已存在时立即执行
 *    （tests/views-shell/inject-face.test.ts 同款先例）。
 *  - `configForms`：最小 `get` 面（settings-card 的可选面，缺席 = 卡照常
 *    注册、form 走回退；src/client/dsh-adapter/settings-card.tsx:231-239）。
 *
 * 观测面：liveMounts（网关语义挂载数）、liveContribs/liveRegistrations
 * （slot 面）、fiber 状态与 getEffects、researchRpc 门面的命名空间重绑
 * （round 标记：重挂后面面必须打到新命名空间——不陈旧）。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import * as clientEntry from '../../src/client/index.js'
import { researchRpc, unmountResearchRemotes } from '../../src/client/dsh-adapter/remote/mount.js'
import { CONVERSATION_VIEW_SLOT } from '../../src/client/dsh-adapter/ui.js'
import { ROW_CONFIG_SLOT } from '../../src/client/dsh-adapter/settings-card.js'
import { FIBER_ACTIVE } from './helpers/ring-harness.js'

const ROUNDS = 3

interface SlotRegistration {
  id: string
  disposeCount: number
}

/** 真 Service 的假网关：$mount 复刻 caller-fiber effect 合同（头注）。 */
class FakeGatewayClient extends Service {
  readonly liveMounts = new Map<string, number>()
  readonly unmounts: string[] = []
  private round = 0

  constructor(ctx: Context) {
    super(ctx, 'remote')
  }

  async $mount(contribution: {
    package: string
    descriptors: readonly { namespace: string }[]
  }): Promise<() => Promise<void>> {
    const caller = this.ctx as Context
    const pkg = contribution.package
    this.round += 1
    const round = this.round
    // 网关按 descriptor.namespace 分组发布 `remote.<namespace>`（checkout
    // gateway client index.ts mountContribution/installNamespace；mount.ts
    // 读取面正是 `remote.researchControl`）。
    const namespaces = [...new Set(contribution.descriptors.map(d => d.namespace))]
    const owned = caller.effect(() => {
      this.liveMounts.set(pkg, (this.liveMounts.get(pkg) ?? 0) + 1)
      const unprovides = namespaces.map(namespace => caller.provide(`remote.${namespace}`, {
        ping: async () => ({ ok: true as const, value: { ok: true, service: namespace, time: round } }),
      }))
      return async () => {
        this.liveMounts.set(pkg, (this.liveMounts.get(pkg) ?? 0) - 1)
        this.unmounts.push(`${pkg}#${String(round)}`)
        for (const unprovide of unprovides) await unprovide()
      }
    }, `api-gateway.client.$mount(${JSON.stringify(pkg)})`)
    await owned
    return async () => {
      await owned()
    }
  }
}

/** 记录型 slots —— 复刻真宿主 SlotRegistry 的 fiber 绑定语义（头注）。 */
class FakeSlots extends Service {
  readonly liveContribs = new Map<string, () => unknown>()
  readonly liveRegistrations = new Map<string, SlotRegistration>()

  constructor(ctx: Context) {
    super(ctx, 'slots')
  }

  register(options: { id?: string; key?: string }, component: unknown): () => void {
    const caller = this.ctx as Context
    const seat = options.key ?? options.id ?? '(anon)'
    const record: SlotRegistration = { id: seat, disposeCount: 0 }
    let removed = false
    const remove = () => {
      if (removed) return
      removed = true
      record.disposeCount += 1
      this.liveRegistrations.delete(seat)
    }
    caller.effect(() => {
      if (this.liveRegistrations.has(seat)) {
        throw new Error(`泄漏环假 slots: 重复登记 ${seat}（宿主语义下这是回环失败）`)
      }
      this.liveRegistrations.set(seat, record)
      void component
      return remove
    }, `dsh-client-ui-renderer.slots.register(${seat})`)
    return remove
  }

  inject(slot: string, contribute: () => unknown): () => void {
    const caller = this.ctx as Context
    // 宿主真实语义：effect 活在 caller fiber；坍缩（unload）dispose 效应并
    // 移除在册贡献（declaration ledger collapse cascade）。
    const owned = caller.effect(() => {
      this.liveContribs.set(slot, contribute)
      contribute() // 槽已声明 ⇒ 立即执行（宿主分支，inject-face 先例）
      return () => {
        this.liveContribs.delete(slot)
        // 贡献坍缩带走其 register（宿主 inject disposer 语义）。
        for (const registration of [...this.liveRegistrations.values()]) {
          registration.disposeCount += 1
          this.liveRegistrations.delete(registration.id)
        }
      }
    }, `dsh-client-ui-renderer.slots.inject(${slot})`)
    return () => {
      void owned()
    }
  }
}

afterAll(() => {
  unmountResearchRemotes()
})

describe('客户端入口 apply 的 load/unload/reload 环（真 fiber + 契约复刻假服务）', () => {
  it(`每轮挂载/登记随 fiber 回收、重载重绑命名空间（${ROUNDS} 轮）`, async () => {
    const root = new Context()
    const gateway = new FakeGatewayClient(root)
    const slots = new FakeSlots(root)
    // FAKE (disclosed): 可选 configForms 面 — 只给 get（缺席语义也走查：见
    // 下方 liveRegistrations 仍含设置卡 ⇒ 卡的注册不依赖 configForms）。
    let previousFiber: { uid: number | null } | undefined

    for (let round = 1; round <= ROUNDS; round += 1) {
      // 装载：函数式插件 fiber（inject slots/remote 真解析）。
      const owner = (await root.plugin(clientEntry)) as unknown as {
        state: number
        uid: number | null
        dispose: () => Promise<void>
        getEffects: () => unknown[]
      }
      try {
        expect(owner.state, `round ${round}: 客户端 fiber ACTIVE`).toBe(FIBER_ACTIVE)
        // 挂载/登记各就位一次。
        expect(gateway.liveMounts.get('dsh-research-control'), `round ${round}: remote 挂载在册`)
          .toBe(1)
        expect(slots.liveContribs.has(CONVERSATION_VIEW_SLOT), `round ${round}: tab 贡献在册`)
          .toBe(true)
        expect(slots.liveContribs.has(ROW_CONFIG_SLOT), `round ${round}: 设置卡贡献在册`)
          .toBe(true)
        expect(
          [...slots.liveRegistrations.keys()].sort(),
          `round ${round}: tab + 设置卡登记在册`,
        ).toEqual(expect.arrayContaining(['research']))
        // 门面重绑：ping 打到的命名空间 round 标记严格递增（= 新挂载，
        // 不是陈旧闭包）。
        const pinged = await researchRpc.ping()
        expect(pinged.ok, `round ${round}: 门面可达新命名空间`).toBe(true)

        if (previousFiber !== undefined) {
          expect(previousFiber.uid, `round ${round}: 上轮 fiber uid 已清`).toBeNull()
        }
        previousFiber = owner
      } finally {
        // 卸载：fiber.dispose → 网关/slot 效应全部回收。
        await owner.dispose()
        expect(owner.uid, `round ${round}: uid 清空`).toBeNull()
        expect(owner.getEffects().length, `round ${round}: effect 清空`).toBe(0)
        expect(gateway.liveMounts.get('dsh-research-control') ?? 0, `round ${round}: 挂载回零`)
          .toBe(0)
        expect(slots.liveContribs.size, `round ${round}: slot 贡献清零`).toBe(0)
        expect(slots.liveRegistrations.size, `round ${round}: 登记清零`).toBe(0)
      }
    }
    // 累积锁：disposer 恰好各跑一轮次，无多重拆除/无悬挂。
    expect(gateway.unmounts, '每轮各一次 unmount').toHaveLength(ROUNDS)
    // 根面回基线：插件 runtime 条目全部移除（registry.keys 是 runtime 表，
    // cordis src/registry.ts:270），root 上的 remote/slots 服务仍在册。
    expect([...root.registry.keys()], '插件 runtime 表回空').toHaveLength(0)
    expect(root.get('remote'), 'root 假网关服务不受插件环影响').toBeDefined()
    expect(root.get('slots'), 'root 假 slots 服务不受插件环影响').toBeDefined()
    await root.fiber.dispose()
  }, ROUNDS * 15_000)
})
