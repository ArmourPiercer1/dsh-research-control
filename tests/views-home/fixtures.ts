/**
 * WP-4.2 — home view test fixtures.
 *
 * Both fixtures are WIRE-VALID `DashboardSnapshot` values: the test files
 * re-parse them through the strict `DashboardSnapshotSchema` (the same
 * discipline as tests/rpc-face/fixtures.ts — a fixture that drifts from
 * the frozen contract fails the suite, not the wire).
 */

import { DashboardSnapshotSchema, type DashboardSnapshot } from '../../src/shared/rpc-contracts.js'

const T = 1755000000000

/** A full dashboard: project + 2 topics + 2 OPEN + 1 PENDING interventions. */
export const HOME_FIXTURE: DashboardSnapshot = {
  project: {
    id: 'PRJ-1',
    title: '凝聚态方向综述',
    description: '追踪关键方向进展并整理证据链',
    importance: 5,
    attentionMode: 'FOCUS',
    targetDate: T,
  },
  topics: [
    { id: 'TPC-1', title: '高温超导', workstreamCount: 3 },
    { id: 'TPC-2', title: '拓扑材料', workstreamCount: 0 },
  ],
  openInterventions: [
    {
      id: 'IV-1',
      title: '审阅 Agent 累积的计划分叉',
      origin: 'AUTO_FLOODING',
      status: 'OPEN',
      workstreamIds: ['WS-1', 'WS-2'],
      createdAt: T,
    },
    {
      id: 'IV-2',
      title: '实验优先级的用户疑问',
      origin: 'USER',
      status: 'OPEN',
      workstreamIds: [],
      createdAt: T + 1000,
    },
  ],
  pendingInterventions: [
    {
      id: 'IV-3',
      title: '等待用户确认的审计发现',
      origin: 'AUTO_AUDIT',
      status: 'PENDING',
      workstreamIds: ['WS-3'],
      createdAt: T + 2000,
    },
  ],
  // PHASE 5/6 placeholder fields — frozen null (never a fabricated list).
  scheduledEvents: null,
  reportingItems: null,
  inboxCount: null,
  attention: null,
}

/** The all-empty variant: every list empty, every nullable field null. */
export const HOME_EMPTY_FIXTURE: DashboardSnapshot = {
  project: {
    id: 'PRJ-1',
    title: '项目一',
    description: null,
    importance: 0,
    attentionMode: 'BACKGROUND',
    targetDate: null,
  },
  topics: [],
  openInterventions: [],
  pendingInterventions: [],
  scheduledEvents: null,
  reportingItems: null,
  inboxCount: null,
  attention: null,
}

/** A dashboard whose project title differs (refresh re-render assertions). */
export const HOME_REFRESHED_FIXTURE: DashboardSnapshot = {
  ...HOME_FIXTURE,
  project: { ...HOME_FIXTURE.project, title: '凝聚态方向综述（刷新）' },
}

/**
 * Re-parse through the strict result schema (gateway decode emulation).
 * Throws on any contract drift.
 */
export function assertWireValidDashboard(value: DashboardSnapshot): void {
  DashboardSnapshotSchema.parse(value)
}
