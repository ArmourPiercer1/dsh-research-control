/**
 * WP-7.2（RR-018②）— getDashboard 的 Inbox 聚合（生产 RPC 面, 真实
 * wiring）:
 *  - 查询路径触发审计刷新（RR-018① 生产挂点 — 客户端 dashboard 刷新
 *    循环即生产触发; 失败 loud 不阻塞查询主路径）;
 *  - `inboxCount` = 真实 CAPTURED 计数（预留占位填充 — 形状不变: 字段
 *    名/位置不变, 值面 `null → non-negative int`, 文档豁免）;
 *  - 刷新失败（wiring 面抛错）⇒ getDashboard 照常解析（旁路机械面 ≠
 *    数据面契约）。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ProductionResearchRpcServices } from '../../src/host/dsh-adapter/host/rpc-services.js'
import type { HostWiring } from '../../src/host/service/wiring/index.js'
import { makeWiring, WR_SCHEMA_ROOT, type WiringBundle } from '../wiring/helpers.js'

function makeServices(wiring: HostWiring): ProductionResearchRpcServices {
  return new ProductionResearchRpcServices({ wiring, schemaRoot: WR_SCHEMA_ROOT, now: () => 1_700_000_000_000 })
}

describe('RR-018② getDashboard — Inbox 聚合 + 审计刷新触发（真实 wiring）', () => {
  it('干净仓: 刷新跑过（零 discrepancy）, inboxCount = 0（number — 占位已填充）', async () => {
    const b = makeWiring()
    const services = makeServices(b.wiring)
    const snap = await services.getDashboard()
    services.close()
    expect(typeof snap.inboxCount).toBe('number')
    expect(snap.inboxCount).toBe(0)
    expect(b.wiring.inbox.listItems({ state: 'CAPTURED' })).toHaveLength(0)
  })

  it('zone 新文件 ⇒ 刷新捕获 ⇒ dashboard 返回真实计数 1（同一次刷新内聚合）', async () => {
    const b = makeWiring()
    // 首扫 = 基线（不捕获）— 先跑一次 dashboard 建立基线。
    const services = makeServices(b.wiring)
    const snap1 = await services.getDashboard()
    expect(snap1.inboxCount).toBe(0)

    // zone 新文件（差分 added 的原料）。
    const zoneDir = join(b.repoRoot, 'results')
    mkdirSync(zoneDir, { recursive: true })
    writeFileSync(join(zoneDir, 'fresh.csv'), 'v\n')

    const snap2 = await services.getDashboard()
    services.close()
    // 第二次刷新: 差分 added ⇒ AUTO 捕获 ⇒ CAPTURED 计数 1。
    expect(snap2.inboxCount).toBe(1)
    expect(b.wiring.inbox.listItems({ state: 'CAPTURED' })).toHaveLength(1)

    // 第三次刷新: 稳态（去重/基线）⇒ 计数保持 1, 不重复落条目。
    const services3 = makeServices(b.wiring)
    const snap3 = await services3.getDashboard()
    services3.close()
    expect(snap3.inboxCount).toBe(1)
  })

  it('用户转换后（CONVERTED 终态）⇒ 计数回落（CAPTURED 口径 = 待处理）', async () => {
    const b = makeWiring()
    const services = makeServices(b.wiring)
    await services.getDashboard() // 基线
    const zoneDir = join(b.repoRoot, 'results')
    mkdirSync(zoneDir, { recursive: true })
    writeFileSync(join(zoneDir, 'fresh.csv'), 'v\n')
    const snap2 = await services.getDashboard()
    expect(snap2.inboxCount).toBe(1)

    // 用户显式转换（RR-018③ 生产执行器）⇒ 条目 CONVERTED。
    const [item] = b.wiring.inbox.listItems({ state: 'CAPTURED' })
    const res = b.wiring.inbox.convert(
      {
        inboxItemId: item!.id,
        targetKind: 'NEXT_ACTION',
        fields: { kind: 'NEXT_ACTION', statement: `investigate ${item!.id}` },
      },
      { kind: 'USER', label: 'user' },
    )
    expect(res.convertedTo).toMatchObject({ kind: 'NEXT_ACTION' })
    services.close()

    const services3 = makeServices(b.wiring)
    const snap3 = await services3.getDashboard()
    services3.close()
    expect(snap3.inboxCount).toBe(0)
  })

  it('刷新失败（wiring 面抛错）⇒ loud 不阻塞: dashboard 照常解析', async () => {
    const b = makeWiring()
    // 包装 wiring: auditRefresh.run 抛错（模拟 audit 链故障）— 其余面原样。
    const broken: HostWiring = {
      ...b.wiring,
      auditRefresh: {
        run: async () => {
          throw new Error('strict audit exploded (simulated)')
        },
      },
    }
    const services = makeServices(broken)
    const snap = await services.getDashboard() // 不抛
    services.close()
    expect(typeof snap.inboxCount).toBe('number')
    expect(snap.inboxCount).toBe(0)
    expect(snap.project.id).toBe('PRJ-1')
  })
})
