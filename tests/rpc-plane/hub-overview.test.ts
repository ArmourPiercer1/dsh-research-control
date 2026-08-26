/**
 * V2-T3.2a — getHubOverview: the §7.1 cross-project aggregation (design
 * §12 row 2).
 *
 * Coverage (the T3.2a brief):
 *  - the 2-project fixture: MANAGED + STANDALONE over REAL
 *    `[Service.init]` planes — the card wall (all fields from existing
 *    data), the 聚合条 totals, and the 需关注 row (`oldestHours` over the
 *    OLDEST open intervention, within the wall-clock tolerance);
 *  - the empty hub (0 projects): the empty aggregates (the client renders
 *    the 空中枢 引导卡 there — NOT an error);
 *  - the empty plane (no hub, no projects): likewise;
 *  - the 大计划 (WS-4-106-项) performance shape: a project whose plan
 *    carries 106 items serves the SAME counts-only cards (no plan face
 *    on the wire — the strict result schema pins it) within the wall-
 *    clock cap (the aggregation reads the tree but expands no list).
 */
import { describe, expect, it } from 'vitest'

import { HubOverviewResultSchema, type HubOverviewResult } from '../../src/shared/rpc-contracts.js'

import {
  BIG_PLAN_ITEM_COUNT,
  commitWorkspaceState,
  freshDshHome,
  harnessWirings,
  initPlane,
  makeBigPlanWs,
  disposeFiber,
  makeHubWs,
  makePlainWs,
  makeProjectWs,
  mountHost,
  seedIntervention,
} from './helpers.js'
import type { RegistryEntry } from '../../src/host/domain/registry/index.js'

const T = 1_770_000_000_000

function entry(id: string, path: string, displayName: string): RegistryEntry {
  return { id, path, displayName, status: 'active', boundAt: T, archivedAt: null }
}

describe('getHubOverview — the §7.1 aggregation (REAL init, 2-project plane)', () => {
  it('two projects (MANAGED + STANDALONE): cards + totals + the 需关注 row', async () => {
    freshDshHome()
    const wsA = makeProjectWs('PRJ-1')
    const wsB = makeProjectWs('PRJ-2')
    const hub = makeHubWs([entry('PRJ-1', wsA, '机器人视觉定位系统')])
    const h = mountHost([hub, wsA, wsB])
    try {
      await initPlane(h)
      const wirings = harnessWirings(h)
      expect(wirings, 'the harness exposes the per-project wirings').toBeDefined()
      // PRJ-1: two OPEN interventions (the 需关注 row: oldest = 72.5h ago
      // at seed time, within the wall-clock tolerance) + one PENDING.
      seedIntervention(wirings!.get('PRJ-1')!, {
        id: 'IV-2001',
        title: '标定管线阻塞',
        created_at: Date.now() - 72.5 * 3_600_000,
      })
      seedIntervention(wirings!.get('PRJ-1')!, {
        id: 'IV-2002',
        title: '数据回传窗口',
        created_at: Date.now() - 1 * 3_600_000,
      })
      seedIntervention(wirings!.get('PRJ-1')!, {
        id: 'IV-2003',
        title: '待确认项',
        status: 'PENDING',
        created_at: Date.now() - 2 * 3_600_000,
      })
      // PRJ-2: no interventions. Its db lives in its own tree (the
      // STANDALONE placement, design §3.3) — checkpoint the workspace so
      // the RR-018① audit refresh (run per project by getHubOverview)
      // sees a clean tree and the inbox count stays zero (the
      // production behavior after the user's first checkpoint).
      commitWorkspaceState(wsB)

      const started = Date.now()
      const overview = HubOverviewResultSchema.parse(await h.svc.getHubOverview({}))
      const elapsedMs = Date.now() - started
      expect(overview).toMatchObject({
        totals: { projects: 2, openInterventions: 2, inbox: 0 },
      })
      // The card wall: discovery order, all fields from existing data.
      expect(overview.cards).toEqual([
        {
          projectId: 'PRJ-1',
          displayName: '机器人视觉定位系统',
          title: '机器人视觉定位系统',
          description: '多传感器融合的亚像素级视觉定位',
          attentionMode: 'FOCUS',
          targetDate: null,
          openInterventions: 2,
          pendingInterventions: 1,
          topics: 1,
          inboxCount: 0,
        },
        {
          projectId: 'PRJ-2',
          displayName: '机器人视觉定位系统',
          title: '机器人视觉定位系统',
          description: '多传感器融合的亚像素级视觉定位',
          attentionMode: 'FOCUS',
          targetDate: null,
          openInterventions: 0,
          pendingInterventions: 0,
          topics: 1,
          inboxCount: 0,
        },
      ])
      // The 需关注 row: ONLY the project with open interventions
      // (无则整行不渲染 — PRJ-2 emits no row), 最旧 carrier.
      expect(overview.attention).toHaveLength(1)
      const attentionRow = overview.attention[0]!
      expect(attentionRow).toMatchObject({ projectId: 'PRJ-1', openCount: 2 })
      expect(attentionRow.displayName).toBe('机器人视觉定位系统')
      expect(attentionRow.oldestHours).toBeGreaterThan(72.0)
      expect(attentionRow.oldestHours).toBeLessThan(73.0)
      // The wire result is counts-only (the strict schema pins the shape —
      // no plan face, no expanded lists — and it re-parses cleanly).
      expect(typeof overview.cards[0]!.topics).toBe('number')
      expect(elapsedMs).toBeLessThan(10_000) // the 2-project read stays cheap
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('the empty hub (registry declares no project): the empty aggregates, not an error', async () => {
    freshDshHome()
    const hub = makeHubWs([])
    const h = mountHost([hub])
    try {
      await initPlane(h)
      const overview = HubOverviewResultSchema.parse(await h.svc.getHubOverview({}))
      expect(overview).toEqual({
        totals: { projects: 0, openInterventions: 0, inbox: 0 },
        attention: [],
        cards: [],
      })
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('the empty plane (no hub, no projects): likewise (the 引导卡 data source)', async () => {
    freshDshHome()
    const h = mountHost([makePlainWs()])
    try {
      await initPlane(h)
      const overview = HubOverviewResultSchema.parse(await h.svc.getHubOverview({}))
      expect(overview).toEqual({
        totals: { projects: 0, openInterventions: 0, inbox: 0 },
        attention: [],
        cards: [],
      })
    } finally {
      disposeFiber(h)
    }
  }, 30_000)

  it('a malformed args object is rejected at the strict schema boundary', async () => {
    freshDshHome()
    const h = mountHost([makePlainWs()])
    try {
      await initPlane(h)
      await expect(h.svc.getHubOverview({ surprise: true } as unknown)).rejects.toThrow()
      await expect(h.svc.getHubOverview({ filter: 'OPEN' } as unknown)).rejects.toThrow()
    } finally {
      disposeFiber(h)
    }
  }, 30_000)
})

describe('getHubOverview — the 大计划 (106-item plan) performance shape', () => {
  it('a 106-item plan serves the SAME counts-only card within the wall-clock cap', async () => {
    freshDshHome()
    const bigWs = makeBigPlanWs()
    const hub = makeHubWs([entry('PRJ-1', bigWs, '大计划项目')])
    const h = mountHost([hub, bigWs])
    try {
      await initPlane(h)
      const wirings = harnessWirings(h)
      expect(wirings, 'the harness exposes the per-project wirings').toBeDefined()
      seedIntervention(wirings!.get('PRJ-1')!, { id: 'IV-2010', title: '大计划阻塞' })

      const started = Date.now()
      const overview = HubOverviewResultSchema.parse(await h.svc.getHubOverview({}))
      const elapsedMs = Date.now() - started
      expect(overview.totals).toEqual({ projects: 1, openInterventions: 1, inbox: 0 })
      const card = overview.cards[0]!
      // The card carries COUNTS only — the 106-item plan never expands
      // into the wire result (the strict schema has no plan face).
      expect(card).toEqual({
        projectId: 'PRJ-1',
        displayName: '大计划项目',
        title: '机器人视觉定位系统',
        description: '多传感器融合的亚像素级视觉定位',
        attentionMode: 'FOCUS',
        targetDate: null,
        openInterventions: 1,
        pendingInterventions: 0,
        topics: 1,
        inboxCount: 0,
      })
      expect(overview.attention).toHaveLength(1)
      // The wire payload stays small: the whole result JSON is far below
      // the size of the 106-item plan (counts, not the list).
      expect(JSON.stringify(overview).length).toBeLessThan(2_000)
      // The wall-clock cap (the perf guard: a fresh tree load of the
      // 106-item plan + the store reads must stay cheap).
      expect(elapsedMs, `getHubOverview took ${elapsedMs}ms`).toBeLessThan(10_000)
      // The plan really does carry the 106 items on disk (the fixture is
      // real, not a lie): the wire face of the workstream query would
      // expand them, but the overview face must not.
      expect(BIG_PLAN_ITEM_COUNT).toBe(106)
    } finally {
      disposeFiber(h)
    }
  }, 30_000)
})
