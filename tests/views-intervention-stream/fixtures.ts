/**
 * V2-T5.2 — 重要事件（纯干预流）test fixtures: WIRE-VALID
 * `GetPortfolioInterventionsResult` values (the `getPortfolioInterventions`
 * wire contract — design §12 row 3, §7.2 重要事件).
 *
 * The discipline mirrors tests/views-overview/fixtures.ts: every fixture is
 * re-parsed through the strict `GetPortfolioInterventionsResultSchema` — a
 * fixture that drifts from the wire contract fails the suite, not the wire.
 */

import {
  GetPortfolioInterventionsResultSchema,
  type GetPortfolioInterventionsResult,
} from '../../src/shared/rpc-contracts.js'

/** Re-parse a fixture through the strict wire schema (wire-validity pin). */
function wireResult(result: unknown): GetPortfolioInterventionsResult {
  return GetPortfolioInterventionsResultSchema.parse(result)
}

/** The pinned "now" for the relative-time fixtures (2025-06-15T00:00:00Z). */
export const NOW = 1_750_000_000_000
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The two-project portfolio (the smoke-fixture twin): PRJ-1 (the managed
 * 机器人视觉定位系统) carries an OPEN 洪泛 intervention (two workstreams),
 * a PENDING Agent-报告 intervention and a CLOSED 审计 intervention; PRJ-2
 * (the standalone project) carries a USER OPEN intervention with no
 * workstreams. Ordering follows the host's contract: OPEN group first
 * (组内时间倒序), then PENDING; CLOSED only ever arrives on the explicit
 * status call.
 */
export const STREAM_RESULT: GetPortfolioInterventionsResult = wireResult({
  items: [
    {
      projectId: 'PRJ-2',
      displayName: '独立实验',
      id: 'IV-4',
      title: '手动登记的数据异常',
      origin: 'USER',
      status: 'OPEN',
      workstreamIds: [],
      createdAt: NOW - 30 * MINUTE,
    },
    {
      projectId: 'PRJ-1',
      displayName: '机器人视觉定位系统',
      id: 'IV-1',
      title: '标定管线阻塞',
      origin: 'AUTO_FLOODING',
      status: 'OPEN',
      workstreamIds: ['WS-1', 'WS-2'],
      createdAt: NOW - 2 * HOUR,
    },
    {
      projectId: 'PRJ-1',
      displayName: '机器人视觉定位系统',
      id: 'IV-2',
      title: '传感器标定参数漂移',
      origin: 'AGENT_REPORT',
      status: 'PENDING',
      workstreamIds: ['WS-1'],
      createdAt: NOW - 26 * HOUR,
    },
  ],
})

/** The explicit `status: 'CLOSED'` view (the 已关闭段 fetch). */
export const STREAM_CLOSED_RESULT: GetPortfolioInterventionsResult = wireResult({
  items: [
    {
      projectId: 'PRJ-1',
      displayName: '机器人视觉定位系统',
      id: 'IV-3',
      title: '归档前的历史洪泛',
      origin: 'AUTO_AUDIT',
      status: 'CLOSED',
      workstreamIds: ['WS-3'],
      createdAt: NOW - 40 * DAY,
    },
  ],
})

/** The empty portfolio (the 空态 face — 当前没有需要处理的事件). */
export const STREAM_EMPTY_RESULT: GetPortfolioInterventionsResult = wireResult({
  items: [],
})

/** The PENDING-less portfolio (the per-group 暂无待确认事件 empty copy). */
export const STREAM_NO_PENDING_RESULT: GetPortfolioInterventionsResult = wireResult({
  items: [
    {
      projectId: 'PRJ-1',
      displayName: '机器人视觉定位系统',
      id: 'IV-1',
      title: '标定管线阻塞',
      origin: 'AUTO_FLOODING',
      status: 'OPEN',
      workstreamIds: ['WS-1'],
      createdAt: NOW - 2 * HOUR,
    },
  ],
})

/** One OPEN intervention only (the single-card action-row cases). */
export const STREAM_SINGLE_OPEN_RESULT: GetPortfolioInterventionsResult = wireResult({
  items: [
    {
      projectId: 'PRJ-1',
      displayName: '机器人视觉定位系统',
      id: 'IV-1',
      title: '标定管线阻塞',
      origin: 'AUTO_FLOODING',
      status: 'OPEN',
      workstreamIds: ['WS-1', 'WS-2'],
      createdAt: NOW - 2 * HOUR,
    },
  ],
})

/** One PENDING intervention only (the PENDING action-row cases). */
export const STREAM_SINGLE_PENDING_RESULT: GetPortfolioInterventionsResult = wireResult({
  items: [
    {
      projectId: 'PRJ-1',
      displayName: '机器人视觉定位系统',
      id: 'IV-2',
      title: '传感器标定参数漂移',
      origin: 'AGENT_REPORT',
      status: 'PENDING',
      workstreamIds: ['WS-1'],
      createdAt: NOW - 26 * HOUR,
    },
  ],
})

/** The `updateInterventionState` success results (per target status). */
export const UPDATE_PENDING_OK = {
  interventionId: 'IV-1',
  statusFrom: 'OPEN',
  statusTo: 'PENDING',
  closedAt: null,
  resolutionNote: null,
} as const
export const UPDATE_CLOSED_OK = {
  interventionId: 'IV-1',
  statusFrom: 'OPEN',
  statusTo: 'CLOSED',
  closedAt: NOW,
  resolutionNote: '已处理',
} as const
export const UPDATE_REOPEN_OK = {
  interventionId: 'IV-2',
  statusFrom: 'PENDING',
  statusTo: 'OPEN',
  closedAt: null,
  resolutionNote: null,
} as const
