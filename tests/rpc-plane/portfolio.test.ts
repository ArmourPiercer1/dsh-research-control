/**
 * V2-T3.2a — getPortfolioInterventions: the §7.2 cross-project
 * intervention list (design §12 row 3).
 *
 * Coverage (the T3.2a brief):
 *  - the 状态过滤直落服务查询: the explicit `status` filters to that
 *    status only (OPEN / PENDING / CLOSED, each exercised);
 *  - the design §7.2 default view: omitted `status` → OPEN + PENDING
 *    (待处理+待确认; CLOSED is folded away by default), the 状态段 order
 *    (OPEN group before the PENDING group) with 组内时间倒序 (newest
 *    first within the group — across projects);
 *  - the projectId label + the wire DTO fields (the 仅中枢模式 card
 *    fields, design §7.2);
 *  - the success + rejection paths: a wire-valid default call vs a
 *    malformed `status` value (off-vocabulary → rejected at the strict
 *    schema boundary, before anything runs).
 */
import { describe, expect, it } from 'vitest'

import {
  GetPortfolioInterventionsResultSchema,
  type GetPortfolioInterventionsResult,
} from '../../src/shared/rpc-contracts.js'

import {
  disposeFiber,
  freshDshHome,
  harnessWirings,
  initPlane,
  makeHubWs,
  makePlainWs,
  makeProjectWs,
  mountHost,
  seedIntervention,
} from './helpers.js'
import type { RegistryEntry } from '../../src/host/domain/registry/index.js'

const T = 1_770_000_000_000
const MIN = 60_000
const HOUR = 3_600_000

function entry(id: string, path: string, displayName: string): RegistryEntry {
  return { id, path, displayName, status: 'active', boundAt: T, archivedAt: null }
}

describe('getPortfolioInterventions — the §7.2 cross-project list (REAL init, 2-project plane)', () => {
  const base = Date.now()

  it('default view: OPEN + PENDING, 状态段 order + 组内时间倒序 (newest first, across projects)', async () => {
    freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const wsB = makeProjectWs('PRJ-2')
    const hub = makeHubWs([entry('PRJ-1', wsA, '机器人视觉定位系统')])
    const h = mountHost([hub, wsA, wsB])
    try {
      await initPlane(h)
      const wirings = harnessWirings(h)
      expect(wirings, 'the harness exposes the per-project wirings').toBeDefined()
      // PRJ-1: two OPEN (base-30min newest, base-1h) + one PENDING +
      // one CLOSED (folded away by default).
      seedIntervention(wirings!.get('PRJ-1')!, { id: 'IV-3001', title: '较新的阻塞', created_at: base - 30 * MIN })
      seedIntervention(wirings!.get('PRJ-1')!, { id: 'IV-3002', title: '较旧的阻塞', created_at: base - 1 * HOUR })
      seedIntervention(wirings!.get('PRJ-1')!, { id: 'IV-3003', title: '待确认项', status: 'PENDING', created_at: base - 2 * HOUR })
      seedIntervention(wirings!.get('PRJ-1')!, {
        id: 'IV-3004',
        title: '已关闭项',
        status: 'CLOSED',
        closed_at: base - 4 * HOUR,
        created_at: base - 5 * HOUR,
      })
      // PRJ-2: one OPEN (base-45min — interleaves between PRJ-1's two).
      seedIntervention(wirings!.get('PRJ-2')!, { id: 'IV-3005', title: '独立项目阻塞', created_at: base - 45 * MIN })

      const result = GetPortfolioInterventionsResultSchema.parse(
        await h.svc.getPortfolioInterventions({}),
      )
      // The OPEN group first (组内时间倒序 — base-30min, base-45min,
      // base-1h — ACROSS projects), then the PENDING group.
      expect(result.items.map((i) => i.id)).toEqual(['IV-3001', 'IV-3005', 'IV-3002', 'IV-3003'])
      // The CLOSED row is folded away by default.
      expect(result.items.some((i) => i.id === 'IV-3004')).toBe(false)
      // The wire DTO: the projectId label + the card fields.
      expect(result.items[0]).toEqual({
        projectId: 'PRJ-1',
        displayName: '机器人视觉定位系统',
        id: 'IV-3001',
        title: '较新的阻塞',
        origin: 'USER',
        status: 'OPEN',
        workstreamIds: ['WS-1'],
        createdAt: base - 30 * MIN,
      })
      // The STANDALONE label comes from the tree title (no registry entry).
      expect(result.items[1]).toMatchObject({
        projectId: 'PRJ-2',
        displayName: '机器人视觉定位系统',
        id: 'IV-3005',
        status: 'OPEN',
      })
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('explicit status filters to that status only (OPEN / PENDING / CLOSED)', async () => {
    freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const wsB = makeProjectWs('PRJ-2')
    const hub = makeHubWs([entry('PRJ-1', wsA, '机器人视觉定位系统')])
    const h = mountHost([hub, wsA, wsB])
    try {
      await initPlane(h)
      const wirings = harnessWirings(h)
      const a = wirings!.get('PRJ-1')!
      const b = wirings!.get('PRJ-2')!
      seedIntervention(a, { id: 'IV-3101', title: 'OPEN 甲', created_at: base - 10 * MIN })
      seedIntervention(b, { id: 'IV-3102', title: 'OPEN 乙', created_at: base - 20 * MIN })
      seedIntervention(a, { id: 'IV-3103', title: 'PENDING 丙', status: 'PENDING', created_at: base - 30 * MIN })
      seedIntervention(b, {
        id: 'IV-3104',
        title: 'CLOSED 丁',
        status: 'CLOSED',
        closed_at: base - 40 * MIN,
        created_at: base - 50 * MIN,
      })

      const open = GetPortfolioInterventionsResultSchema.parse(
        await h.svc.getPortfolioInterventions({ status: 'OPEN' }),
      )
      expect(open.items.map((i) => i.id)).toEqual(['IV-3101', 'IV-3102'])

      const pending = GetPortfolioInterventionsResultSchema.parse(
        await h.svc.getPortfolioInterventions({ status: 'PENDING' }),
      )
      expect(pending.items.map((i) => i.id)).toEqual(['IV-3103'])

      const closed = GetPortfolioInterventionsResultSchema.parse(
        await h.svc.getPortfolioInterventions({ status: 'CLOSED' }),
      )
      expect(closed.items.map((i) => i.id)).toEqual(['IV-3104'])
      expect(closed.items[0]).toMatchObject({
        projectId: 'PRJ-2',
        displayName: '机器人视觉定位系统',
        status: 'CLOSED',
      })
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('the empty plane serves an empty list (not an error)', async () => {
    freshDshHome()
    const h = mountHost([makePlainWs()])
    try {
      await initPlane(h)
      const result: GetPortfolioInterventionsResult = await h.svc.getPortfolioInterventions({})
      expect(result).toEqual({ items: [] })
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('a malformed status value is rejected at the strict schema boundary (off-vocabulary)', async () => {
    freshDshHome()
    const h = mountHost([makePlainWs()])
    try {
      await initPlane(h)
      await expect(h.svc.getPortfolioInterventions({ status: 'DONE' } as unknown)).rejects.toThrow()
      await expect(h.svc.getPortfolioInterventions({ status: '' } as unknown)).rejects.toThrow()
    } finally {
      disposeFiber(h)
    }
  }, 30_000)
})
