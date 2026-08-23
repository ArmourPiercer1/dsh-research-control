/**
 * WP-5.2 — actions 视图模型（纯投影 — 零 I/O 面）:
 *
 *  - 「按 objective 分组」规则（任务书目标 3; 规则文档在
 *    src/client/views/actions/actions-model.ts 模块头）: PROJECT scope
 *    覆盖全项目 WS; TOPIC scope 覆盖其 topic 的 WS（objectiveRefs 反查）;
 *    一条 NA 可入多组; 悬空项入「未关联目标」组; 组序 priority→id;
 *    组内 待转正→已转正→已弃用, created_at, id;
 *  - Blocker 显著区分区（ACTIVE 全在前, CLEARED 沉底）;
 *  - Objective 进度计数 + 行序（ACTIVE 优先）+ proposedCount 映射。
 */

import { describe, expect, it } from 'vitest'

import type { ObjectiveDto } from '../../src/shared/rpc-contracts.js'
import type { BlockerItem, NextActionItem, ObjectiveProgressData } from '../../src/client/stores/actions-slices.js'
import {
  countObjectives,
  groupNextActionsByObjective,
  objectiveProgressRows,
  splitBlockers,
} from '../../src/client/views/actions/actions-model.js'

const OBJ1: ObjectiveDto = { id: 'OBJ-1', scope: 'PROJECT', statement: '项目级目标', status: 'ACTIVE', priority: 'P1', targetDate: null }
const OBJ2: ObjectiveDto = { id: 'OBJ-2', scope: 'TOPIC', statement: 'TPC-1 目标', status: 'ACTIVE', priority: 'P0', targetDate: null }
const OBJ3: ObjectiveDto = { id: 'OBJ-3', scope: 'PROJECT', statement: '已达成目标', status: 'ACHIEVED', priority: 'P2', targetDate: 1721000000000 }

const PROGRESS: ObjectiveProgressData = {
  objectives: [OBJ1, OBJ2, OBJ3],
  topics: [
    { topicId: 'TPC-1', objectiveRefs: ['OBJ-2'], workstreamIds: ['WS-1', 'WS-2'] },
    { topicId: 'TPC-2', objectiveRefs: [], workstreamIds: ['WS-3'] },
  ],
}

const na = (id: string, ws: string | null, status: NextActionItem['status'], createdAt: number): NextActionItem => ({
  id,
  workstreamId: ws,
  statement: `statement-${id}`,
  rationale: null,
  status,
  promotedToTaskId: status === 'PROMOTED' ? `T-${id}` : null,
  createdAt,
})

const ITEMS = [
  na('NA-4', null, 'PROPOSED', 4),
  na('NA-1', 'WS-1', 'PROPOSED', 1),
  na('NA-2', 'WS-2', 'PROMOTED', 2),
  na('NA-5', 'WS-9', 'PROPOSED', 5),
  na('NA-3', 'WS-3', 'PROPOSED', 3),
]

describe('groupNextActionsByObjective（分组规则 — 见 actions-model 模块头）', () => {
  it('group order = priority → id; unassigned group last（PROJECT 目标不因 ACHIEVED 退出分组 — 展示语义）', () => {
    const groups = groupNextActionsByObjective(ITEMS, PROGRESS)
    expect(groups.map((g) => g.objective?.id ?? 'unassigned')).toEqual(['OBJ-2', 'OBJ-1', 'OBJ-3', 'unassigned'])
  })

  it('a TOPIC objective covers only its topic’s workstreams', () => {
    const groups = groupNextActionsByObjective(ITEMS, PROGRESS)
    const g2 = groups.find((g) => g.objective?.id === 'OBJ-2')!
    expect(g2.items.map((i) => i.id)).toEqual(['NA-1', 'NA-2'])
    expect(g2.proposedCount).toBe(1)
  })

  it('a PROJECT objective covers every workstream in every topic', () => {
    const groups = groupNextActionsByObjective(ITEMS, PROGRESS)
    const g1 = groups.find((g) => g.objective?.id === 'OBJ-1')!
    expect(g1.items.map((i) => i.id)).toEqual(['NA-1', 'NA-3', 'NA-2'])
    expect(g1.proposedCount).toBe(2)
  })

  it('one NA may appear in multiple groups (非排他展示语义)', () => {
    const groups = groupNextActionsByObjective(ITEMS, PROGRESS)
    const all = groups.flatMap((g) => g.items.map((i) => i.id))
    expect(all).toContain('NA-1')
    // WS-1 同属 OBJ-2(TOPIC TPC-1) 与 OBJ-1/OBJ-3(项目级) 三个组:
    expect(all.filter((x) => x === 'NA-1')).toHaveLength(3)
  })

  it('dangling items (no ws / unknown ws / topic without objectiveRefs 且无 PROJECT 目标) go to unassigned', () => {
    const groups = groupNextActionsByObjective(ITEMS, PROGRESS)
    const unassigned = groups.find((g) => g.objective === null)!
    expect(unassigned.items.map((i) => i.id)).toEqual(['NA-4', 'NA-5'])
  })

  it('topic without objectiveRefs + no PROJECT objective ⇒ its WS items are unassigned', () => {
    const noProject = {
      objectives: [OBJ2],
      topics: [{ topicId: 'TPC-2', objectiveRefs: [], workstreamIds: ['WS-3'] }],
    }
    const groups = groupNextActionsByObjective([na('NA-3', 'WS-3', 'PROPOSED', 3)], noProject)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.objective).toBeNull()
  })

  it('in-group order: PROPOSED → PROMOTED → DISMISSED, then created_at, then id', () => {
    const ordered = groupNextActionsByObjective(
      [
        na('NA-9', 'WS-1', 'DISMISSED', 9),
        na('NA-1', 'WS-1', 'PROPOSED', 10),
        na('NA-2', 'WS-1', 'PROMOTED', 2),
        na('NA-3', 'WS-1', 'PROPOSED', 1),
      ],
      PROGRESS,
    )
    const g2 = ordered.find((g) => g.objective?.id === 'OBJ-2')!
    expect(g2.items.map((i) => i.id)).toEqual(['NA-3', 'NA-1', 'NA-2', 'NA-9'])
  })

  it('an objective whose candidate WS set is empty produces no group (进度概览单独呈现它们)', () => {
    const empty: ObjectiveDto = { id: 'OBJ-5', scope: 'TOPIC', statement: '空 topic 目标', status: 'ACTIVE', priority: 'P3', targetDate: null }
    const progress = {
      objectives: [empty, OBJ1],
      topics: [
        { topicId: 'TPC-9', objectiveRefs: ['OBJ-5'], workstreamIds: [] },
        { topicId: 'TPC-2', objectiveRefs: [], workstreamIds: ['WS-3'] },
      ],
    }
    const groups = groupNextActionsByObjective([na('NA-3', 'WS-3', 'PROPOSED', 3)], progress)
    expect(groups.map((g) => g.objective?.id)).toEqual(['OBJ-1'])
  })

  it('null progress (slice not ready) ⇒ everything unassigned but stable', () => {
    const groups = groupNextActionsByObjective([na('NA-1', 'WS-1', 'PROPOSED', 1)], null)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.objective).toBeNull()
  })
})

describe('splitBlockers（显著区分区）', () => {
  const blk = (id: string, status: BlockerItem['status'], createdAt: number): BlockerItem => ({
    id,
    statement: `s-${id}`,
    affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }],
    status,
    source: 'x',
    references: null,
    createdAt,
    clearedAt: status === 'CLEARED' ? 99 : null,
  })

  it('ACTIVE first (created_at asc), CLEARED after', () => {
    const sections = splitBlockers([blk('BLK-3', 'CLEARED', 3), blk('BLK-1', 'ACTIVE', 1), blk('BLK-2', 'ACTIVE', 2)])
    expect(sections.active.map((b) => b.id)).toEqual(['BLK-1', 'BLK-2'])
    expect(sections.cleared.map((b) => b.id)).toEqual(['BLK-3'])
  })

  it('empty input ⇒ two empty sections', () => {
    const sections = splitBlockers([])
    expect(sections.active).toEqual([])
    expect(sections.cleared).toEqual([])
  })
})

describe('Objective 进度面（countObjectives / objectiveProgressRows）', () => {
  it('countObjectives: total/active/achieved/dropped', () => {
    expect(countObjectives([OBJ1, OBJ2, OBJ3])).toEqual({ total: 3, active: 2, achieved: 1, dropped: 0 })
    expect(countObjectives([])).toEqual({ total: 0, active: 0, achieved: 0, dropped: 0 })
  })

  it('row order: ACTIVE first (priority → id), then ACHIEVED, then DROPPED', () => {
    const dropped: ObjectiveDto = { id: 'OBJ-4', scope: 'PROJECT', statement: 'x', status: 'DROPPED', priority: 'P0', targetDate: null }
    const rows = objectiveProgressRows([OBJ3, dropped, OBJ1, OBJ2], groupNextActionsByObjective(ITEMS, PROGRESS))
    expect(rows.map((r) => r.objective.id)).toEqual(['OBJ-2', 'OBJ-1', 'OBJ-3', 'OBJ-4'])
  })

  it('proposedCount comes from the grouping projection', () => {
    const rows = objectiveProgressRows(PROGRESS.objectives, groupNextActionsByObjective(ITEMS, PROGRESS))
    const byId = Object.fromEntries(rows.map((r) => [r.objective.id, r.proposedCount]))
    expect(byId['OBJ-2']).toBe(1)
    expect(byId['OBJ-1']).toBe(2)
    // OBJ-3 是项目级目标 ⇒ 覆盖 WS-3 的 NA-3 等:
    expect(byId['OBJ-3']).toBe(2)
  })
})
