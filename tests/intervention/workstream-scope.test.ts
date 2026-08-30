/**
 * UI-4 (D §10, D1) — `InterventionService.listForWorkstream` 薄方法
 * （ADJ-7 — `listInterventions({ workstreamId })` 的直通查询面; Current
 * zone 的 Interventions 组数据缝, v1 无 createUserIntervention RPC）。
 *
 * 断言面（real research.sqlite + 真实 registry, 复用 WP-5.1 fixtures）:
 *  - workstream_ids 含该 WS 的行才入（无 WS 行 / 纯外 WS 行出; 多 WS 行
 *    命中即整行入 — 与 listInterventions 既有过滤面同语义, 零新逻辑）;
 *  - 状态不过滤: OPEN/PENDING/CLOSED 全量返回（zone 渲染关闭态 —
 *    ADJ-7 注释面: the zone renders the closure state）;
 *  - 空 workstream ⇒ []。
 */

import { describe, expect, it } from 'vitest'

import type { UserActorRef } from '../../src/host/service/intervention/index.js'
import { makeInterventionHarness, type InterventionHarness } from './fixtures.js'

const USER: UserActorRef = { kind: 'USER', label: 'researcher' }

const harnesses: InterventionHarness[] = []
function harness(): InterventionHarness {
  const h = makeInterventionHarness()
  harnesses.push(h)
  return h
}
// 注: fixtures 的 afterAll 统一清理（harnesses 数组仅用于本文件可读性）。

function ids(rows: readonly { id: string }[]): string[] {
  return rows.map((r) => r.id).sort()
}

describe('listForWorkstream（ADJ-7 查询缝）', () => {
  it('workstream_ids 含该 WS 的行入, 无 WS / 纯外 WS 的行出（多 WS 行整行命中）', () => {
    const h = harness()
    try {
      h.service.createUserIntervention({ title: 'WS-1 事项', workstream_ids: ['WS-1'] }, USER)
      h.service.createUserIntervention({ title: 'WS-2 事项', workstream_ids: ['WS-2'] }, USER)
      h.service.createUserIntervention({ title: '无 WS 关联事项' }, USER)
      h.service.createUserIntervention({ title: '双挂事项', workstream_ids: ['WS-1', 'WS-2'] }, USER)

      expect(ids(h.service.listForWorkstream('WS-1'))).toEqual(['IV-1', 'IV-4'])
      expect(ids(h.service.listForWorkstream('WS-2'))).toEqual(['IV-2', 'IV-4'])
      expect(h.service.listForWorkstream('WS-3')).toEqual([])
    } finally {
      h.close()
    }
  })

  it('状态不过滤: OPEN 与 CLOSED 行都返回（zone 渲染关闭态）', () => {
    const h = harness()
    try {
      const r = h.service.createUserIntervention({ title: '要关闭的', workstream_ids: ['WS-1'] }, USER).intervention
      // 预置 CLOSED（直接状态缓存列 — 同 WP-5.1 测试探针纪律; 生产路径
      // 只经 updateState, 本测只钉查询面）。
      h.raw.prepare(`UPDATE intervention SET status = 'CLOSED', closed_at = ? WHERE id = ?`).run(h.now(), r.id)

      const rows = h.service.listForWorkstream('WS-1')
      expect(ids(rows)).toEqual([r.id])
      expect(rows[0]!.status).toBe('CLOSED')
    } finally {
      h.close()
    }
  })

  it('无 intervention 的 workstream ⇒ []（fresh harness）', () => {
    const h = harness()
    try {
      expect(h.service.listForWorkstream('WS-1')).toEqual([])
    } finally {
      h.close()
    }
  })
})
