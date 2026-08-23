/**
 * WP-5.4 — tests/attention 共享 fixture（评分输入 + wire-valid dashboard
 * 快照 + 确定性时钟原点）。
 *
 * 纪律（同 tests/rpc-face/fixtures.ts）: dashboard fixture 是
 * WIRE-VALID 的 `DashboardSnapshot` — 消费它的测试再经 strict schema
 * 重解析（契约漂移 ⇒ 套件红）。
 */

import type { DashboardSnapshot } from '../../src/shared/rpc-contracts.js'
import {
  type AttentionBlockerItem,
  type AttentionContext,
  type AttentionInterventionItem,
  type AttentionItem,
  type AttentionNextActionItem,
  type AttentionScheduledEventItem,
} from '../../src/host/service/attention/scorer.js'

/** 参考「现在」（epoch ms, 2026-08-22T09:00:00Z — 同 tests/runbinding T0）。 */
export const T_NOW = Date.parse('2026-08-22T09:00:00Z')

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** 一条 OPEN Intervention（默认: 无 WS 关联之外皆最小; 无 awareness 记录）。 */
export function makeIntervention(over: Partial<AttentionInterventionItem> = {}): AttentionInterventionItem {
  return {
    kind: 'INTERVENTION',
    id: 'IV-1',
    title: '审阅累积的 Agent PlanFork',
    createdAt: T_NOW - 2 * HOUR,
    workstreamId: 'WS-1',
    status: 'OPEN',
    origin: 'AUTO_FLOODING',
    ...over,
  }
}

export function makeNextAction(over: Partial<AttentionNextActionItem> = {}): AttentionNextActionItem {
  return {
    kind: 'NEXT_ACTION',
    id: 'NA-1',
    title: '考虑把数据清洗脚本化',
    createdAt: T_NOW - HOUR,
    workstreamId: 'WS-1',
    status: 'PROPOSED',
    ...over,
  }
}

export function makeBlocker(over: Partial<AttentionBlockerItem> = {}): AttentionBlockerItem {
  return {
    kind: 'BLOCKER',
    id: 'BLK-1',
    title: 'GPU 集群排队, 实验无法启动',
    createdAt: T_NOW - 3 * HOUR,
    workstreamId: 'WS-2',
    status: 'ACTIVE',
    ...over,
  }
}

export function makeEvent(over: Partial<AttentionScheduledEventItem> = {}): AttentionScheduledEventItem {
  return {
    kind: 'SCHEDULED_EVENT',
    id: 'SEV-1',
    title: '组会汇报',
    createdAt: T_NOW - DAY,
    workstreamId: 'WS-1',
    at: T_NOW + 2 * HOUR,
    ...over,
  }
}

/** 四类各一的候选全集（混排测试基准）。 */
export function makeFullSet(): AttentionItem[] {
  return [
    makeIntervention(),
    makeIntervention({ id: 'IV-2', title: 'PENDING 的审计差异', status: 'PENDING', createdAt: T_NOW - HOUR, origin: 'AUTO_AUDIT' }),
    makeNextAction(),
    makeBlocker(),
    makeEvent(),
    makeEvent({ id: 'SEV-2', title: '远未来的期刊截稿', at: T_NOW + 30 * DAY }),
  ]
}

/** 评分上下文（确定性 now）。 */
export function makeContext(over: Partial<Omit<AttentionContext, 'now'>> = {}): AttentionContext {
  return { now: T_NOW, projectImportance: 3, attentionMode: 'NORMAL', ...over }
}

/**
 * Wire-valid `DashboardSnapshot` fixture（strict schema 可解析）:
 * 1 OPEN + 1 PENDING Intervention（INV-ATTN-1 全集面）, 其余 Phase 5/6
 * 字段保持冻结 `null` 占位。
 */
export const ATTENTION_DASHBOARD_FIXTURE: DashboardSnapshot = {
  project: {
    id: 'PRJ-1',
    title: 'Project One',
    description: null,
    importance: 3,
    attentionMode: 'FOCUS',
    targetDate: null,
  },
  topics: [{ id: 'TPC-1', title: 'Topic One', workstreamCount: 1 }],
  openInterventions: [
    {
      id: 'IV-1',
      title: '审阅累积的 Agent PlanFork [WS-1]',
      origin: 'AUTO_FLOODING',
      status: 'OPEN',
      workstreamIds: ['WS-1'],
      createdAt: T_NOW - 2 * HOUR,
    },
  ],
  pendingInterventions: [
    {
      id: 'IV-2',
      title: 'PENDING 的审计差异',
      origin: 'AUTO_AUDIT',
      status: 'PENDING',
      workstreamIds: ['WS-2'],
      createdAt: T_NOW - HOUR,
    },
  ],
  scheduledEvents: null,
  reportingItems: null,
  inboxCount: 0,
  attention: null,
}

/** 空 dashboard（无任何候选 — 空排序面）。 */
export const ATTENTION_EMPTY_DASHBOARD_FIXTURE: DashboardSnapshot = {
  ...ATTENTION_DASHBOARD_FIXTURE,
  openInterventions: [],
  pendingInterventions: [],
}
