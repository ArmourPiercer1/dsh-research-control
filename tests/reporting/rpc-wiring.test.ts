/**
 * WP-5.3 — registerInteraction RPC 生产接线 (真实 wiring + 真实
 * research.sqlite): WP-4.1a 的 not-yet-implemented 缝已被替换 —
 * `ProductionResearchRpcServices.registerInteraction` 经 reporting
 * service 落 interaction 表 (第二连接), 且 related_workstreams 对
 * 声明式树做写入时存在性校验 (DOMAIN_SCHEMA §16 规则 2)。
 *
 * 断言面:
 *  - happy path: 结果过冻结 `RegisterInteractionResultSchema` (zod
 *    strict — 与 typert 描述符同一 schema 实例面); INT id 单调
 *    (INT-1, INT-2); 行真实落库 (raw 第三连接回读, JSON 列往返);
 *  - 未知 WS 引用被拒 (§16 规则 2) — 且零行落地 (校验在写入之前);
 *  - 生产实现不再抛 NOT-YET-IMPLEMENTED (缝已落地)。
 */

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ProductionResearchRpcServices } from '../../src/host/dsh-adapter/host/rpc-services.js'
import {
  RegisterInteractionResultSchema,
  type RegisterInteractionArgs,
} from '../../src/shared/rpc-contracts.js'
import { INTERACTION_TABLE } from '../../src/host/service/reporting/index.js'
import { T0, makeClock, makeWiring, WR_SCHEMA_ROOT, type WiringBundle } from '../wiring/helpers.js'

describe('registerInteraction — 生产实现 (WP-5.3 缝落地)', () => {
  let bundle: WiringBundle
  let services: ProductionResearchRpcServices
  let raw: DatabaseSync

  afterEach(() => {
    raw?.close()
    services?.close()
    bundle.wiring.close()
  })

  function open(): void {
    bundle = makeWiring({ now: makeClock(T0) })
    services = new ProductionResearchRpcServices({ wiring: bundle.wiring, schemaRoot: WR_SCHEMA_ROOT, now: bundle.now })
    raw = new DatabaseSync(join(bundle.dataDir, 'research.sqlite'))
    raw.exec('PRAGMA busy_timeout = 5000')
  }

  it('registers through the production path: wire-valid result + row persisted (第二连接)', async () => {
    open()
    const args: RegisterInteractionArgs = {
      kind: 'MEETING',
      title: '周会',
      occurredAt: T0,
      participants: ['张三', '李四'],
      notes: '讨论了 A/B 方案。',
      relatedWorkstreams: ['WS-1', 'WS-2'],
    }
    const result = await services.registerInteraction(args)

    // 冻结 wire 契约 (typert 描述符同一 schema 面)。
    const parsed = RegisterInteractionResultSchema.parse(result)
    expect(parsed).toEqual(result)

    expect(result.id).toBe('INT-1')
    expect(result.kind).toBe('MEETING')
    expect(result.title).toBe('周会')
    expect(result.occurredAt).toBe(T0)
    expect(result.participants).toEqual(['张三', '李四'])
    expect(result.notes).toBe('讨论了 A/B 方案。')
    expect(result.relatedWorkstreams).toEqual(['WS-1', 'WS-2'])
    expect(result.createdAt).toBeGreaterThanOrEqual(T0)

    // 行真实落库 (raw 第三连接回读 — JSON 列往返)。
    const row = raw.prepare(`SELECT * FROM ${INTERACTION_TABLE} WHERE id = ?`).get(result.id) as Record<string, unknown> | undefined
    expect(row).toBeDefined()
    expect(String(row!.kind)).toBe('MEETING')
    expect(JSON.parse(String(row!.participants))).toEqual(['张三', '李四'])
    expect(JSON.parse(String(row!.related_workstreams))).toEqual(['WS-1', 'WS-2'])
  })

  it('allocates monotonically per call (INT-1 → INT-2) and echoes missing optionals as null/[]', async () => {
    open()
    const first = await services.registerInteraction({ kind: 'OTHER', title: '第一条', occurredAt: T0 })
    const second = await services.registerInteraction({ kind: 'AD_HOC_DISCUSSION', title: '第二条', occurredAt: T0 + 1_000 })
    expect(first.id).toBe('INT-1')
    expect(second.id).toBe('INT-2')
    // 可选面缺省: participants → [], notes → null, relatedWorkstreams → []。
    expect(second.participants).toEqual([])
    expect(second.notes).toBeNull()
    expect(second.relatedWorkstreams).toEqual([])
    const r2 = raw.prepare(`SELECT participants, notes, related_workstreams FROM ${INTERACTION_TABLE} WHERE id = ?`).get(second.id) as Record<string, unknown>
    expect(r2.participants).toBeNull()
    expect(r2.notes).toBeNull()
    expect(r2.related_workstreams).toBeNull()
  })

  it('rejects an unknown related workstream BEFORE any row lands (§16 规则 2)', async () => {
    open()
    await expect(
      services.registerInteraction({ kind: 'MEETING', title: 'x', occurredAt: T0, relatedWorkstreams: ['WS-99'] }),
    ).rejects.toThrow(/WS-99 does not exist/)
    const n = raw.prepare(`SELECT COUNT(*) AS n FROM ${INTERACTION_TABLE}`).get() as { n: number | bigint }
    expect(Number(n.n)).toBe(0)
    // 计数器不烧号 (reserve 在树校验之后) — 下一次仍是 INT-1。
    const next = await services.registerInteraction({ kind: 'OTHER', title: 'y', occurredAt: T0 })
    expect(next.id).toBe('INT-1')
  })

  it('no longer throws NOT-YET-IMPLEMENTED (WP-4.1a 缝已替换)', async () => {
    open()
    await expect(
      services.registerInteraction({ kind: 'SUPERVISOR_UPDATE', title: '缝落地', occurredAt: T0 }),
    ).resolves.toMatchObject({ id: expect.stringMatching(/^INT-1$/) })
  })
})
