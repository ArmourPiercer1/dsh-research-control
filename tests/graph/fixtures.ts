/**
 * Graph test fixtures (WP-4.5) — builders for WIRE-VALID snapshot shapes
 * (the same discipline as tests/rpc-face/fixtures.ts: every value must
 * parse through the strict rpc-contracts schemas — a builder that drifts
 * from the frozen contract fails the suite).
 */

import type { PlanForkDto, PlanItemDto, TopicSnapshot, WorkstreamCardDto, WorkstreamSnapshot } from '../../src/shared/rpc-contracts.js'

const T = 1755000000000
export const OID = 'b'.repeat(40)

/** Build a canonical plan item. */
export function item(id: string, kind: PlanItemDto['kind'], title: string): PlanItemDto {
  return { id, kind, title }
}

/** Build one PlanFork DTO (wire-valid; all fields explicit). */
export function pf(
  id: string,
  status: PlanForkDto['status'],
  forkAnchor: string,
  mergeAnchor: string,
  proposedItemCount: number,
  overrides?: Partial<PlanForkDto>,
): PlanForkDto {
  return {
    id,
    status,
    reason: `reason for ${id}`,
    necessity: `necessity for ${id}`,
    forkAnchor,
    mergeAnchor,
    createdByRun: 'R-9',
    createdAt: T,
    staleReason: status === 'STALE' ? 'base closure changed' : null,
    proposedItemCount,
    baseGitCommit: OID,
    ...overrides,
  }
}

/** Build a WorkstreamSnapshot from a plan + forks (other zones empty). */
export function wsSnapshot(orderedItems: readonly PlanItemDto[], planForks: readonly PlanForkDto[]): WorkstreamSnapshot {
  return {
    workstream: {
      id: 'WS-1',
      topicId: 'TPC-1',
      title: 'Workstream One',
      lifecycle: 'REALIZED',
      summary: null,
      createdAt: T,
    },
    history: { eventCount: 0 },
    current: { tasks: [], runs: [] },
    future: {
      plan: { orderedItems },
      planForks,
      unresolvedPlanForkCount: planForks.length,
    },
  }
}

/** Build one Workstream card. */
export function wsCard(id: string, overrides?: Partial<WorkstreamCardDto>): WorkstreamCardDto {
  return {
    id,
    title: `Workstream ${id.slice(3)}`,
    lifecycle: 'REALIZED',
    summary: null,
    planItemCount: 3,
    openPlanForkCount: 0,
    runningRunCount: 0,
    ...overrides,
  }
}

/** Build a TopicSnapshot from cards + edges + contracts (objectives empty). */
export function topicSnapshot(
  workstreams: readonly WorkstreamCardDto[],
  edges: TopicSnapshot['topology']['edges'],
  mergeContracts: TopicSnapshot['mergeContracts'] = [],
): TopicSnapshot {
  return {
    topic: {
      id: 'TPC-1',
      title: 'Topic One',
      description: null,
      importance: null,
      attentionMode: null,
      objectiveRefs: [],
      createdAt: T,
    },
    workstreams,
    topology: { edges },
    mergeContracts,
    objectives: [],
  }
}
