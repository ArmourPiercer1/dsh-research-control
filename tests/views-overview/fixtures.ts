/**
 * V2-T5.1 — overview test fixtures: WIRE-VALID `HubOverviewResult` values
 * (the `getHubOverview` wire contract — design §12 row 2, §7.1 总览).
 *
 * The discipline mirrors tests/views-shell/fixtures.ts: every fixture is
 * re-parsed through the strict `HubOverviewResultSchema` — a fixture that
 * drifts from the wire contract fails the suite, not the wire.
 */

import {
  HubOverviewResultSchema,
  type HubOverviewResult,
} from '../../src/shared/rpc-contracts.js'

/** Re-parse a fixture through the strict wire schema (wire-validity pin). */
function wireResult(result: unknown): HubOverviewResult {
  return HubOverviewResultSchema.parse(result)
}

/**
 * The single-project hub (the .acceptance/v2-t51 smoke fixture twin): 0
 * open interventions, EMPTY attention (no 需关注 row), no target date
 * (no 目标 line on the card).
 */
export const HUB_OVERVIEW_RESULT: HubOverviewResult = wireResult({
  totals: { projects: 1, openInterventions: 0, inbox: 0 },
  attention: [],
  cards: [
    {
      projectId: 'PRJ-1',
      displayName: '机器人视觉定位',
      title: '机器人视觉定位系统',
      description: '多传感器融合的亚像素级视觉定位',
      attentionMode: 'FOCUS',
      targetDate: null,
      openInterventions: 0,
      pendingInterventions: 0,
      topics: 2,
      inboxCount: 0,
    },
  ],
})

/**
 * The attention case: the 需关注 row renders (two projects with open
 * interventions — oldest-age display 「最旧 2 天」 (70h, floor) + 「最旧
 * 5 小时」); PRJ-1 carries a target date (the 目标 line renders), PRJ-2
 * does not (no line at all).
 */
export const HUB_OVERVIEW_ATTENTION_RESULT: HubOverviewResult = wireResult({
  totals: { projects: 2, openInterventions: 3, inbox: 5 },
  attention: [
    { projectId: 'PRJ-1', displayName: '机器人视觉定位', openCount: 2, oldestHours: 70 },
    { projectId: 'PRJ-2', displayName: '独立拓扑项目', openCount: 1, oldestHours: 5 },
  ],
  cards: [
    {
      projectId: 'PRJ-1',
      displayName: '机器人视觉定位',
      title: '机器人视觉定位系统',
      description: null,
      attentionMode: 'FOCUS',
      targetDate: 1780000000000,
      openInterventions: 2,
      pendingInterventions: 1,
      topics: 2,
      inboxCount: 3,
    },
    {
      projectId: 'PRJ-2',
      displayName: '独立拓扑项目',
      title: '独立拓扑项目',
      description: 'standalone tree',
      attentionMode: 'BACKGROUND',
      targetDate: null,
      openInterventions: 1,
      pendingInterventions: 0,
      topics: 1,
      inboxCount: 2,
    },
  ],
})

/** The empty hub (0 projects): the 登记第一个研究项目 onboarding card at the card-wall position. */
export const HUB_OVERVIEW_EMPTY_RESULT: HubOverviewResult = wireResult({
  totals: { projects: 0, openInterventions: 0, inbox: 0 },
  attention: [],
  cards: [],
})
