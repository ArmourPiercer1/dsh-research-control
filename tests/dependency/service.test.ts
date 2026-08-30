/**
 * UI-5 (D2) — the dependency service (host): addDependency / removeDependency.
 *
 * Pinned (BRIEF §3 / §4 D2 + ADJ-11):
 *   - the RELATION_ADDED / RELATION_REMOVED events land in the OWNER log
 *     with the frozen snake_case 5-tuple payload + the USER actor;
 *   - REL ids from the shared allocator (`RELATION` kind) — reserve →
 *     commit on success, release on ANY rejection (gap legal, never
 *     reused); the event id (`HISTORY_EVENT`) follows the same lifecycle;
 *   - the composed hook (registry FIRST, RR-011(b) fold second) enforces
 *     the negative vocabulary: OBJECT_NOT_FOUND / OWNER_MISMATCH /
 *     CROSS_FIELD / RELATION_SELF_LOOP / RELATION_DUPLICATE (add; the
 *     reverse-duplicate rule is RELATED_TO-only and unreachable through
 *     this DEPENDS_ON face) and WRONG_STATE / OBJECT_NOT_FOUND (remove)
 *     — each mapped to the `[research-control] <CODE>: <msg>` carrier
 *     (service level);
 *   - the derived `semantics:<projectId>` row carries the folded relation
 *     (ACTIVE → REMOVED), decoded with the production codec;
 *   - remove recovers the §5.5 audit redundancy from the owner log fold
 *     (the payload mirrors the stored edge — never invented).
 */

import { describe, expect, it } from 'vitest'

import type { HistoryEventRecord } from '../../src/host/persistence/store/types.js'
import {
  defaultPlans,
  makeService,
  readSemanticRow,
  type Harness,
} from './harness.js'

const PROJECT = 'PRJ-1'

function ref(code: string): { kind: 'TASK' | 'GATE' | 'MILESTONE'; id: string } {
  return { kind: code[0] === 'G' ? 'GATE' : code[0] === 'M' ? 'MILESTONE' : 'TASK', id: code }
}

function eventsOf(h: Harness, ws: string): readonly HistoryEventRecord[] {
  return h.store.listRange(ws, 1)
}

/* ------------------------------------------------------------------ *
 * addDependency — happy paths
 * ------------------------------------------------------------------ */

describe('addDependency — happy', () => {
  it('persists a TASK→TASK edge in the owner log with the frozen payload', () => {
    const h = makeService()
    try {
      const expectedAt = h.clock.peek() // the next tick — the service's occurredAt sample
      const r = h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-1'), target: ref('T-2') })
      expect(r.relationId).toBe('REL-1')
      expect(r.source).toEqual({ kind: 'TASK', id: 'T-1' })
      expect(r.target).toEqual({ kind: 'TASK', id: 'T-2' })

      const evs = eventsOf(h, 'WS-1')
      expect(evs).toHaveLength(1)
      const ev = evs[0]!
      expect(ev.eventType).toBe('RELATION_ADDED')
      expect(ev.ownerWorkstreamId).toBe('WS-1')
      expect(ev.eventId).toBe('H-1')
      expect(ev.schemaVersion).toBe(1)
      expect(ev.actor).toEqual({ kind: 'USER' })
      expect(ev.occurredAt).toBe(expectedAt) // the shared clock's next tick
      expect(ev.payload).toEqual({
        relation_id: 'REL-1',
        source: { kind: 'TASK', id: 'T-1' },
        relation_type: 'DEPENDS_ON',
        target: { kind: 'TASK', id: 'T-2' },
      })

      // The derived semantics row carries the folded ACTIVE relation.
      const state = readSemanticRow(h.store, PROJECT)
      expect(state).toBeDefined()
      const row = state!.relations.get('REL-1')
      expect(row).toBeDefined()
      expect(row!.status).toBe('ACTIVE')
      expect(row!.relation_type).toBe('DEPENDS_ON')
      expect(row!.source).toEqual({ kind: 'TASK', id: 'T-1' })
      expect(row!.target).toEqual({ kind: 'TASK', id: 'T-2' })
      expect(row!.created_by).toEqual({ kind: 'USER' })

      // Allocator lifecycle: both reservations committed, in order.
      expect(h.allocatorEvents).toEqual([
        { op: 'reserve', id: 'REL-1', kind: 'RELATION' },
        { op: 'reserve', id: 'H-1', kind: 'HISTORY_EVENT' },
        { op: 'commit', id: 'REL-1', kind: 'RELATION' },
        { op: 'commit', id: 'H-1', kind: 'HISTORY_EVENT' },
      ])
    } finally {
      h.close()
    }
  })

  it('accepts a GATE source and a MILESTONE target (§8 combination table)', () => {
    const h = makeService()
    try {
      const a = h.service.addDependency({ workstreamId: 'WS-1', source: ref('G-1'), target: ref('T-1') })
      const b = h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-1'), target: ref('M-1') })
      expect(a.relationId).toBe('REL-1')
      expect(b.relationId).toBe('REL-2')
      expect(eventsOf(h, 'WS-1')).toHaveLength(2)
    } finally {
      h.close()
    }
  })

  it('lands the event in the SOURCE ws log for a cross-WS target (owner = source.ws)', () => {
    const h = makeService()
    try {
      const r = h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-1'), target: ref('T-5') })
      expect(r.relationId).toBe('REL-1')
      expect(eventsOf(h, 'WS-1')).toHaveLength(1)
      expect(eventsOf(h, 'WS-1')[0]!.eventType).toBe('RELATION_ADDED')
      expect(eventsOf(h, 'WS-2')).toHaveLength(0) // the target ws log never sees it
    } finally {
      h.close()
    }
  })

  it('allocates sequential REL ids across operations', () => {
    const h = makeService()
    try {
      const a = h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-1'), target: ref('T-2') })
      const b = h.service.addDependency({ workstreamId: 'WS-2', source: ref('T-5'), target: ref('G-2') })
      expect(a.relationId).toBe('REL-1')
      expect(b.relationId).toBe('REL-2')
    } finally {
      h.close()
    }
  })
})

/* ------------------------------------------------------------------ *
 * addDependency — the negative vocabulary
 * ------------------------------------------------------------------ */

describe('addDependency — negative', () => {
  it('OBJECT_NOT_FOUND: an unknown source endpoint refuses before any append', () => {
    const h = makeService()
    try {
      expect(() =>
        h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-99'), target: ref('T-2') }),
      ).toThrowError('[research-control] OBJECT_NOT_FOUND: referenced TASK "T-99" does not exist')
      expect(eventsOf(h, 'WS-1')).toHaveLength(0)
      // Both reservations released (the id gap is legal; never reused).
      expect(h.allocatorEvents).toEqual([
        { op: 'reserve', id: 'REL-1', kind: 'RELATION' },
        { op: 'reserve', id: 'H-1', kind: 'HISTORY_EVENT' },
        { op: 'release', id: 'REL-1', kind: 'RELATION' },
        { op: 'release', id: 'H-1', kind: 'HISTORY_EVENT' },
      ])
    } finally {
      h.close()
    }
  })

  it('OBJECT_NOT_FOUND: an unknown target endpoint', () => {
    const h = makeService()
    try {
      expect(() =>
        h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-1'), target: ref('G-99') }),
      ).toThrowError('[research-control] OBJECT_NOT_FOUND: referenced GATE "G-99" does not exist')
      expect(eventsOf(h, 'WS-1')).toHaveLength(0)
    } finally {
      h.close()
    }
  })

  it('OWNER_MISMATCH: the workstreamId argument must equal source.ws ?? target.ws', () => {
    const h = makeService()
    try {
      // Source T-5 belongs to WS-2 → owner WS-2 ≠ the argument WS-1.
      expect(() =>
        h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-5'), target: ref('T-1') }),
      ).toThrowError('[research-control] OWNER_MISMATCH: Relation owner must be source.ws ?? target.ws = WS-2')
      expect(eventsOf(h, 'WS-1')).toHaveLength(0)
      expect(eventsOf(h, 'WS-2')).toHaveLength(0)
    } finally {
      h.close()
    }
  })

  it('CROSS_FIELD: a MILESTONE source is outside the frozen §8 combination table', () => {
    const h = makeService()
    try {
      expect(() =>
        h.service.addDependency({ workstreamId: 'WS-1', source: ref('M-1'), target: ref('T-1') }),
      ).toThrowError('[research-control] CROSS_FIELD:')
      expect(eventsOf(h, 'WS-1')).toHaveLength(0)
    } finally {
      h.close()
    }
  })

  it('RELATION_SELF_LOOP: an edge cannot source and target the same object', () => {
    const h = makeService()
    try {
      expect(() =>
        h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-1'), target: ref('T-1') }),
      ).toThrowError('[research-control] RELATION_SELF_LOOP:')
      expect(eventsOf(h, 'WS-1')).toHaveLength(0)
    } finally {
      h.close()
    }
  })

  it('RELATION_DUPLICATE: the same 5-tuple is refused even with a fresh REL id', () => {
    const h = makeService()
    try {
      h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-1'), target: ref('T-2') })
      expect(() =>
        h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-1'), target: ref('T-2') }),
      ).toThrowError('[research-control] RELATION_DUPLICATE: An edge with the same 5-tuple already exists as relation REL-1')
      // The second append rolled back — the log holds the first edge only.
      expect(eventsOf(h, 'WS-1')).toHaveLength(1)
      const commits = h.allocatorEvents.filter((e) => e.op === 'commit')
      expect(commits).toHaveLength(2) // REL-1 + H-1 only
    } finally {
      h.close()
    }
  })

  it('a DEPENDS_ON reverse edge is a DISTINCT 5-tuple — legal per §8 (the reverse-duplicate rule is RELATED_TO-only)', () => {
    const h = makeService()
    try {
      const a = h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-1'), target: ref('T-2') })
      const b = h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-2'), target: ref('T-1') })
      expect(a.relationId).toBe('REL-1')
      expect(b.relationId).toBe('REL-2')
      expect(eventsOf(h, 'WS-1')).toHaveLength(2)
      // Both rows ACTIVE in the derived state.
      const state = readSemanticRow(h.store, PROJECT)
      expect(state!.relations.get('REL-1')!.status).toBe('ACTIVE')
      expect(state!.relations.get('REL-2')!.status).toBe('ACTIVE')
    } finally {
      h.close()
    }
  })
})

/* ------------------------------------------------------------------ *
 * removeDependency
 * ------------------------------------------------------------------ */

describe('removeDependency', () => {
  it('removes an ACTIVE edge: mirrored payload, REMOVED derived row, gone from the projection', () => {
    const h = makeService()
    try {
      const a = h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-1'), target: ref('T-2') })
      const r = h.service.removeDependency({ workstreamId: 'WS-1', relationId: a.relationId })
      expect(r).toEqual({ relationId: 'REL-1' })

      const evs = eventsOf(h, 'WS-1')
      expect(evs).toHaveLength(2)
      const ev = evs[1]!
      expect(ev.eventType).toBe('RELATION_REMOVED')
      expect(ev.payload).toEqual({
        relation_id: 'REL-1',
        source: { kind: 'TASK', id: 'T-1' }, // the §5.5 redundancy mirrors the stored edge
        relation_type: 'DEPENDS_ON',
        target: { kind: 'TASK', id: 'T-2' },
      })

      const row = readSemanticRow(h.store, PROJECT)!.relations.get('REL-1')
      expect(row!.status).toBe('REMOVED')
    } finally {
      h.close()
    }
  })

  it('WRONG_STATE: removing the same relation twice is refused', () => {
    const h = makeService()
    try {
      const a = h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-1'), target: ref('T-2') })
      h.service.removeDependency({ workstreamId: 'WS-1', relationId: a.relationId })
      expect(() =>
        h.service.removeDependency({ workstreamId: 'WS-1', relationId: a.relationId }),
      ).toThrowError('[research-control] WRONG_STATE: Relation "REL-1" is REMOVED; RELATION_REMOVED requires ACTIVE')
      expect(eventsOf(h, 'WS-1')).toHaveLength(2) // no third event
    } finally {
      h.close()
    }
  })

  it('OBJECT_NOT_FOUND: an unknown relationId refuses before any id is reserved', () => {
    const h = makeService()
    try {
      expect(() =>
        h.service.removeDependency({ workstreamId: 'WS-1', relationId: 'REL-99' }),
      ).toThrowError('[research-control] OBJECT_NOT_FOUND: Relation "REL-99" does not exist')
      expect(eventsOf(h, 'WS-1')).toHaveLength(0)
      expect(h.allocatorEvents).toHaveLength(0) // the pre-check reserves nothing
    } finally {
      h.close()
    }
  })

  it('OBJECT_NOT_FOUND: owner scoping — the edge must be in the argument ws log', () => {
    const h = makeService()
    try {
      const a = h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-1'), target: ref('T-2') })
      expect(() =>
        h.service.removeDependency({ workstreamId: 'WS-2', relationId: a.relationId }),
      ).toThrowError('[research-control] OBJECT_NOT_FOUND: Relation "REL-1" does not exist')
    } finally {
      h.close()
    }
  })

  it('releases the event id when the composed hook rejects the append', () => {
    const h = makeService()
    try {
      const a = h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-1'), target: ref('T-2') })
      h.service.removeDependency({ workstreamId: 'WS-1', relationId: a.relationId })
      // Second remove → the hook rejects (WRONG_STATE) → H id released.
      expect(() =>
        h.service.removeDependency({ workstreamId: 'WS-1', relationId: a.relationId }),
      ).toThrowError('[research-control] WRONG_STATE:')
      const last = h.allocatorEvents[h.allocatorEvents.length - 1]!
      expect(last).toEqual({ op: 'release', id: 'H-3', kind: 'HISTORY_EVENT' })
      const commits = h.allocatorEvents.filter((e) => e.op === 'commit')
      expect(commits.map((e) => e.id).sort()).toEqual(['H-1', 'H-2', 'REL-1'])
    } finally {
      h.close()
    }
  })
})

/* ------------------------------------------------------------------ *
 * The workstream index
 * ------------------------------------------------------------------ */

describe('the workstream index', () => {
  it('an endpoint absent from the index is OBJECT_NOT_FOUND (both directions)', () => {
    const plans = defaultPlans()
    const h = makeService({
      workstreams: plans.workstreams.filter((ws) => ws.id !== 'WS-2'),
    })
    try {
      expect(() =>
        h.service.addDependency({ workstreamId: 'WS-1', source: ref('T-1'), target: ref('T-5') }),
      ).toThrowError('[research-control] OBJECT_NOT_FOUND: referenced TASK "T-5" does not exist')
    } finally {
      h.close()
    }
  })
})
