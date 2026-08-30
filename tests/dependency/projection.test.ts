/**
 * UI-5 (ADJ-7) — the dependency-edge projection (PURE function).
 *
 * Pinned (BRIEF §4 D2 + ADJ-7 option A):
 *   - only ACTIVE edges survive the fold (RELATION_REMOVED deletes);
 *   - only `DEPENDS_ON` edges are projected (other §8 types are not
 *     drawn on the plan graph);
 *   - BOTH endpoints must be members of the canonical plan (off-plan
 *     items — removed from `ordered_items` or never listed — are not
 *     drawn, in either direction);
 *   - deterministic sort by relationId (natural numeric order) — the
 *     reload-no-drift gate's byte-identity premise;
 *   - malformed payloads are skipped, never guessed (corrupt-log
 *     tolerance — the read path must not crash).
 */

import { describe, expect, it } from 'vitest'

import { projectDependencyEdges } from '../../src/host/service/dependency/index.js'
import type { DependencyEdgeEvent } from '../../src/host/service/dependency/index.js'

const PLAN = ['G-1', 'T-1', 'T-2', 'T-3', 'M-1']

function added(relationId: string, source: string, target: string, relationType = 'DEPENDS_ON'): DependencyEdgeEvent {
  return {
    eventType: 'RELATION_ADDED',
    payload: {
      relation_id: relationId,
      source: { kind: source[0] === 'G' ? 'GATE' : source[0] === 'M' ? 'MILESTONE' : 'TASK', id: source },
      relation_type: relationType,
      target: { kind: target[0] === 'G' ? 'GATE' : target[0] === 'M' ? 'MILESTONE' : 'TASK', id: target },
    },
  }
}

function removed(relationId: string, source: string, target: string, relationType = 'DEPENDS_ON'): DependencyEdgeEvent {
  return {
    eventType: 'RELATION_REMOVED',
    payload: {
      relation_id: relationId,
      source: { kind: source[0] === 'G' ? 'GATE' : 'TASK', id: source },
      relation_type: relationType,
      target: { kind: target[0] === 'G' ? 'GATE' : 'TASK', id: target },
    },
  }
}

describe('projectDependencyEdges', () => {
  it('projects an ACTIVE DEPENDS_ON edge whose both endpoints are in the plan', () => {
    const edges = projectDependencyEdges({
      events: [added('REL-1', 'T-1', 'T-2')],
      canonicalPlan: PLAN,
    })
    expect(edges).toEqual([{ relationId: 'REL-1', sourceId: 'T-1', targetId: 'T-2' }])
  })

  it('remove-disappears: a removed edge is not projected', () => {
    const edges = projectDependencyEdges({
      events: [added('REL-1', 'T-1', 'T-2'), removed('REL-1', 'T-1', 'T-2')],
      canonicalPlan: PLAN,
    })
    expect(edges).toEqual([])
  })

  it('non-DEPENDS_ON edges are not projected', () => {
    const edges = projectDependencyEdges({
      events: [
        added('REL-1', 'T-1', 'T-2', 'RELATED_TO'),
        added('REL-2', 'T-1', 'T-2'),
      ],
      canonicalPlan: PLAN,
    })
    expect(edges).toEqual([{ relationId: 'REL-2', sourceId: 'T-1', targetId: 'T-2' }])
  })

  it('off-plan items are not projected (target off-plan)', () => {
    // T-9 has its definition (the edge exists) but left ordered_items.
    const edges = projectDependencyEdges({
      events: [added('REL-1', 'T-1', 'T-9')],
      canonicalPlan: PLAN,
    })
    expect(edges).toEqual([])
  })

  it('off-plan items are not projected (source off-plan)', () => {
    const edges = projectDependencyEdges({
      events: [added('REL-1', 'T-9', 'T-1')],
      canonicalPlan: PLAN,
    })
    expect(edges).toEqual([])
  })

  it('a GATE-source edge is projected when both endpoints are in the plan', () => {
    const edges = projectDependencyEdges({
      events: [added('REL-1', 'G-1', 'T-1')],
      canonicalPlan: PLAN,
    })
    expect(edges).toEqual([{ relationId: 'REL-1', sourceId: 'G-1', targetId: 'T-1' }])
  })

  it('sorts by relationId natural numeric order (deterministic)', () => {
    // Inserted out of order; REL-10 must sort AFTER REL-2 (numeric, not
    // lexicographic — "REL-10" < "REL-2" as strings).
    const edges = projectDependencyEdges({
      events: [
        added('REL-10', 'T-1', 'T-3'),
        added('REL-2', 'T-2', 'T-3'),
        added('REL-1', 'T-1', 'T-2'),
      ],
      canonicalPlan: PLAN,
    })
    expect(edges.map((e) => e.relationId)).toEqual(['REL-1', 'REL-2', 'REL-10'])
  })

  it('is deterministic: identical inputs yield identical arrays', () => {
    const input = {
      events: [
        added('REL-2', 'T-2', 'T-3'),
        removed('REL-1', 'T-1', 'T-2'),
        added('REL-1', 'T-1', 'T-2'),
        added('REL-3', 'T-1', 'M-1'),
      ] as DependencyEdgeEvent[],
      canonicalPlan: PLAN,
    }
    expect(projectDependencyEdges(input)).toEqual(projectDependencyEdges(input))
  })

  it('skips malformed payloads without crashing (corrupt-log tolerance)', () => {
    const edges = projectDependencyEdges({
      events: [
        { eventType: 'RELATION_ADDED', payload: null },
        { eventType: 'RELATION_ADDED', payload: { relation_id: 'REL-1' } },
        { eventType: 'RELATION_ADDED', payload: { relation_id: 'REL-2', source: { id: 'T-1' }, relation_type: 'DEPENDS_ON', target: { kind: 'TASK', id: 'T-2' } } },
        { eventType: 'RELATION_REMOVED', payload: { relation_id: 'REL-3' } },
        { eventType: 'RELATION_ADDED', payload: { relation_id: 'REL-4', source: { kind: 'TASK', id: 'T-1' }, relation_type: 'DEPENDS_ON', target: { kind: 'TASK', id: 'T-2' } } },
      ],
      canonicalPlan: PLAN,
    })
    expect(edges).toEqual([{ relationId: 'REL-4', sourceId: 'T-1', targetId: 'T-2' }])
  })

  it('empty log → empty projection; empty plan → nothing projected', () => {
    expect(projectDependencyEdges({ events: [], canonicalPlan: PLAN })).toEqual([])
    expect(
      projectDependencyEdges({ events: [added('REL-1', 'T-1', 'T-2')], canonicalPlan: [] }),
    ).toEqual([])
  })

  it('later events override earlier ones for the same relation id (audit order)', () => {
    // add → remove → (no re-add possible: ids are fresh) = the fold's
    // terminal state is REMOVED.
    const edges = projectDependencyEdges({
      events: [added('REL-1', 'T-1', 'T-2'), removed('REL-1', 'T-1', 'T-2'), added('REL-2', 'T-2', 'T-3')],
      canonicalPlan: PLAN,
    })
    expect(edges).toEqual([{ relationId: 'REL-2', sourceId: 'T-2', targetId: 'T-3' }])
  })
})
