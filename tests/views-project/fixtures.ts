/**
 * WP-4.7 — project page test fixtures (G4 S1).
 *
 * Both fixtures are WIRE-VALID `ProjectSnapshot` values: the test files
 * re-parse them through the strict `ProjectSnapshotSchema` (the same
 * discipline as tests/rpc-face/fixtures.ts — a fixture that drifts from
 * the frozen contract fails the suite, not the wire).
 */

import { ProjectSnapshotSchema, type ProjectSnapshot } from '../../src/shared/rpc-contracts.js'

const T = 1755000000000

/** A full project: brief + 3 objectives (one current) + 2 topics. */
export const PROJECT_PAGE_FIXTURE: ProjectSnapshot = {
  project: {
    id: 'PRJ-1',
    title: '凝聚态方向综述',
    description: '追踪关键方向进展并整理证据链',
    importance: 5,
    attentionMode: 'FOCUS',
    targetDate: T,
    currentObjectiveRefs: ['OBJ-1'],
    createdAt: T - 86_400_000,
  },
  objectives: [
    {
      id: 'OBJ-1',
      scope: 'PROJECT',
      statement: '完成凝聚态物理关键方向的系统综述',
      status: 'ACTIVE',
      priority: 'P0',
      targetDate: T,
    },
    {
      id: 'OBJ-2',
      scope: 'TOPIC',
      statement: '建立高温超导机制的定量模型',
      status: 'ACHIEVED',
      priority: 'P1',
      targetDate: null,
    },
    {
      id: 'OBJ-3',
      scope: 'TOPIC',
      statement: '旧方向的对比研究（已放弃）',
      status: 'DROPPED',
      priority: 'P2',
      targetDate: null,
    },
  ],
  topics: [
    { id: 'TPC-1', title: '高温超导', workstreamCount: 3 },
    { id: 'TPC-2', title: '拓扑材料', workstreamCount: 0 },
  ],
  // PHASE 5 placeholder fields — frozen null (never a fabricated list).
  upcomingInteractions: null,
  upcomingReporting: null,
}

/** The all-empty variant: every list empty, every nullable field null. */
export const PROJECT_PAGE_EMPTY_FIXTURE: ProjectSnapshot = {
  project: {
    id: 'PRJ-1',
    title: '项目一',
    description: null,
    importance: 0,
    attentionMode: 'BACKGROUND',
    targetDate: null,
    currentObjectiveRefs: [],
    createdAt: T,
  },
  objectives: [],
  topics: [],
  upcomingInteractions: null,
  upcomingReporting: null,
}

/**
 * Re-parse through the strict result schema (gateway decode emulation).
 * Throws on any contract drift.
 */
export function assertWireValidProject(value: ProjectSnapshot): void {
  ProjectSnapshotSchema.parse(value)
}
