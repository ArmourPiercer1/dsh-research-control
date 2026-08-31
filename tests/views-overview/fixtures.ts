/**
 * V2-T5.1 — overview test fixtures: WIRE-VALID `HubOverviewResult` values
 * (the `getHubOverview` wire contract — design §12 row 2, §7.1 总览) and,
 * since V2-UI-8 D3, WIRE-VALID `QueryAttentionResult` values (the unified
 * `queryAttention` face — D §14, which now feeds BOTH the 需关注 row and
 * the B §4.4 summary section; the hub result's own `attention` array is a
 * wire pin only — the view no longer consumes it).
 *
 * The discipline mirrors tests/views-shell/fixtures.ts: every fixture is
 * re-parsed through its strict wire schema — a fixture that drifts from
 * the wire contract fails the suite, not the wire.
 */

import {
  HubOverviewResultSchema,
  QueryAttentionResultSchema,
  type HubOverviewResult,
  type QueryAttentionResult,
} from '../../src/shared/rpc-contracts.js'

/** Re-parse a fixture through the strict wire schema (wire-validity pin). */
function wireResult(result: unknown): HubOverviewResult {
  return HubOverviewResultSchema.parse(result)
}

/** Re-parse a queryAttention fixture (same discipline — UI-8 D3). */
function wireAttention(result: unknown): QueryAttentionResult {
  return QueryAttentionResultSchema.parse(result)
}

/** The pinned "now" for the 需关注 row oldest-age fixtures (2025-06-15). */
export const ATTN_NOW = 1_750_000_000_000
const HOUR_MS = 60 * 60 * 1000

/** A minimal non-terminal INTERVENTION item (the shared row/summary base). */
function attnItem(overrides: {
  readonly sourceId: string
  readonly projectId: string
  readonly workstreamId: string | null
  readonly detectedAt: number
}): Record<string, unknown> {
  return {
    kind: 'INTERVENTION',
    sourceId: overrides.sourceId,
    sourceRef: { kind: 'intervention', id: overrides.sourceId },
    projectId: overrides.projectId,
    workstreamId: overrides.workstreamId,
    title: `干预事项 ${overrides.sourceId}`,
    reason: 'component-test item',
    status: 'OPEN',
    priority: 'HIGH',
    score: 50,
    rank: null,
    createdAt: overrides.detectedAt,
    detectedAt: overrides.detectedAt,
    allowedActions: ['markPending', 'closeIntervention'],
    context: {},
  }
}

/**
 * The single-project hub (the .acceptance/v2-t51 smoke fixture twin): 0
 * open interventions, EMPTY attention (no 需关注 row — UI-8 D3: the row
 * now derives from the `queryAttention` face, the `attention` array is a
 * wire pin only), no target date (no 目标 line on the card).
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
 * The two-project hub (the 需关注 row test's hub side): PRJ-1 carries a
 * target date (the 目标 line renders), PRJ-2 does not (no line at all).
 * The `attention` array is a WIRE PIN ONLY since UI-8 D3 — the 需关注
 * row derives from the `queryAttention` face (see ATTN_ROW_RESULT), not
 * from this projection.
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

/**
 * V2-UI-0.4 UI-3 — the B §4.5 field-mapping case: one FULL card
 * (description + target date present) + one SPARSE card (both null —
 * the 有则显 case). The sparse card also pins the zero-count row.
 */
export const HUB_OVERVIEW_CARD_MAPPING_RESULT: HubOverviewResult = wireResult({
  totals: { projects: 2, openInterventions: 2, inbox: 1 },
  attention: [],
  cards: [
    {
      projectId: 'PRJ-1',
      displayName: 'Full card',
      title: 'Full card project',
      description: '多传感器融合定位',
      attentionMode: 'FOCUS',
      targetDate: 1780000000000,
      openInterventions: 2,
      pendingInterventions: 1,
      topics: 3,
      inboxCount: 1,
    },
    {
      projectId: 'PRJ-2',
      displayName: 'Sparse card',
      title: 'Sparse card project',
      description: null,
      attentionMode: 'BACKGROUND',
      targetDate: null,
      openInterventions: 0,
      pendingInterventions: 0,
      topics: 0,
      inboxCount: 0,
    },
  ],
})

/**
 * V2-UI-8 D3 — the B §4.4 cap case: SEVEN non-terminal interventions in
 * host order (the summary must render the first 6; item 7 must not
 * appear). All items share one meta line: `机器人视觉定位 (PRJ-1) ·
 * WS-1 · Intervention · High · OPEN`.
 */
export const ATTN_SUMMARY_RESULT: QueryAttentionResult = wireAttention({
  items: Array.from({ length: 7 }, (_, i) => ({
    kind: 'INTERVENTION',
    sourceId: `IV-${String(i + 1)}`,
    sourceRef: { kind: 'intervention', id: `IV-${String(i + 1)}` },
    projectId: 'PRJ-1',
    workstreamId: 'WS-1',
    title: `干预事项 ${String(i + 1)}`,
    reason: 'component-test item',
    status: 'OPEN',
    priority: 'HIGH',
    score: 100 - i,
    rank: i + 1,
    createdAt: ATTN_NOW - (7 - i) * HOUR_MS,
    detectedAt: ATTN_NOW - (7 - i) * HOUR_MS,
    allowedActions: ['markPending', 'closeIntervention'],
    context: {},
  })),
  total: 7,
})

/**
 * V2-UI-8 D3 — the 需关注 row case: two projects' non-terminal items in
 * host order. PRJ-1 ×2 (oldest = ATTN_NOW − 70h → 「最旧 2 天」 floor),
 * PRJ-2 ×1 (ATTN_NOW − 5h → 「最旧 5 小时」).
 */
export const ATTN_ROW_RESULT: QueryAttentionResult = wireAttention({
  items: [
    attnItem({ sourceId: 'IV-1', projectId: 'PRJ-1', workstreamId: 'WS-1', detectedAt: ATTN_NOW - 70 * HOUR_MS }),
    attnItem({ sourceId: 'IV-2', projectId: 'PRJ-1', workstreamId: 'WS-2', detectedAt: ATTN_NOW - 5 * HOUR_MS }),
    attnItem({ sourceId: 'IV-9', projectId: 'PRJ-2', workstreamId: null, detectedAt: ATTN_NOW - 5 * HOUR_MS }),
  ],
  total: 3,
})

/** V2-UI-8 D3 — the empty list: no 需关注 row, no summary section. */
export const ATTN_EMPTY_RESULT: QueryAttentionResult = wireAttention({ items: [], total: 0 })

/** V2-UI-8 D3 — terminals only: the non-terminal filter empties the list. */
export const ATTN_TERMINALS_ONLY_RESULT: QueryAttentionResult = wireAttention({
  items: [
    {
      kind: 'INTERVENTION',
      sourceId: 'IV-8',
      sourceRef: { kind: 'intervention', id: 'IV-8' },
      projectId: 'PRJ-1',
      workstreamId: 'WS-1',
      title: '已关闭事项',
      reason: 'terminal fixture item',
      status: 'CLOSED',
      priority: 'LOW',
      score: 0,
      rank: null,
      createdAt: ATTN_NOW - 40 * 24 * HOUR_MS,
      detectedAt: ATTN_NOW - 40 * 24 * HOUR_MS,
      allowedActions: [],
      context: {},
    },
  ],
  total: 1,
})
