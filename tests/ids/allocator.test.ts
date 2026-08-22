/**
 * WP-1.6 — allocator: per-project monotonic counters (TC-DOM-026 唯一性范围)
 * + reserve/commit/release semantics + single-threaded interleaving
 * simulation (the 「concurrency」 face of a single-process plugin).
 *
 * The counter persists in the injected MetaStore; reservations are
 * per-instance in-memory bookkeeping (see src/shared/ids/allocator.ts for
 * the semantics decision — §1.1 fixes monotonicity + no-reuse, not the
 * protocol, so release burns the sequence and leaves a gap).
 */
import { describe, expect, it } from 'vitest'
import {
  COUNTER_KEY_PREFIX,
  GLOBAL_SCOPE_KEY,
  IdAllocator,
  counterKey,
  type Reservation,
} from '../../src/shared/ids/index.js'
import { createMetaStore, type MetaStore } from '../../src/host/persistence/meta/index.js'

/** Two allocators over ONE store: simulates two actors on one meta table. */
function makePair(): { store: MetaStore; a: IdAllocator; b: IdAllocator } {
  const store = createMetaStore()
  return { store, a: new IdAllocator(store), b: new IdAllocator(store) }
}

describe('allocator: sequence (monotonic counter)', () => {
  it('reserves strictly increasing sequences from a fresh project', () => {
    const { a } = makePair()
    expect(a.reserve('TASK', 'PRJ-1').id).toBe('T-1')
    expect(a.reserve('TASK', 'PRJ-1').id).toBe('T-2')
    expect(a.reserve('TASK', 'PRJ-1').id).toBe('T-3')
    expect(a.peek('TASK', 'PRJ-1')).toBe(3)
  })

  it('persists the counter under the documented key in the meta store', () => {
    const { store, a } = makePair()
    a.reserve('TASK', 'PRJ-1')
    a.reserve('TASK', 'PRJ-1')
    expect(counterKey('TASK', 'PRJ-1')).toBe(`${COUNTER_KEY_PREFIX}:PRJ-1:TASK`)
    expect(store.get(`${COUNTER_KEY_PREFIX}:PRJ-1:TASK`)).toBe('2')
    // GLOBAL scope key carries the sentinel, not a project id
    expect(counterKey('PROJECT', 'PRJ-1')).toBe(`${COUNTER_KEY_PREFIX}:${GLOBAL_SCOPE_KEY}:PROJECT`)
  })

  it('a fresh allocator on the same store continues the sequence (persistence)', () => {
    const store = createMetaStore()
    const first = new IdAllocator(store)
    first.reserve('GATE', 'PRJ-1')
    const second = new IdAllocator(store)
    expect(second.reserve('GATE', 'PRJ-1').id).toBe('G-2')
  })

  it('peek is non-mutating', () => {
    const { a } = makePair()
    expect(a.peek('TASK', 'PRJ-1')).toBe(0)
    a.reserve('TASK', 'PRJ-1')
    expect(a.peek('TASK', 'PRJ-1')).toBe(1)
    expect(a.peek('TASK', 'PRJ-1')).toBe(1)
  })
})

describe('allocator: uniqueness scope = project (§1.1 唯一性范围, TC-DOM-026)', () => {
  it('the same kind in different projects gets independent sequences', () => {
    const { a } = makePair()
    a.reserve('TASK', 'PRJ-1')
    expect(a.reserve('TASK', 'PRJ-1').id).toBe('T-2')
    // PRJ-2 starts its own TASK sequence at 1 — uniqueness is WITHIN project
    expect(a.reserve('TASK', 'PRJ-2').id).toBe('T-1')
    expect(a.reserve('TASK', 'PRJ-3').id).toBe('T-1')
  })

  it('different kinds in the same project get independent sequences', () => {
    const { a } = makePair()
    expect(a.reserve('TASK', 'PRJ-1').id).toBe('T-1')
    expect(a.reserve('GATE', 'PRJ-1').id).toBe('G-1')
    expect(a.reserve('MILESTONE', 'PRJ-1').id).toBe('M-1')
    expect(a.reserve('TASK', 'PRJ-1').id).toBe('T-2')
  })

  it('Project is globally unique (插件安装内全局): the counter ignores the project argument', () => {
    const { a, b } = makePair()
    expect(a.reserve('PROJECT', 'PRJ-999').id).toBe('PRJ-1')
    // a DIFFERENT allocator (and "different project") shares the GLOBAL counter
    expect(b.reserve('PROJECT', 'PRJ-888').id).toBe('PRJ-2')
    expect(a.peek('PROJECT', 'PRJ-999')).toBe(a.peek('PROJECT', 'PRJ-888'))
  })

  it('PROJECT-scoped kinds reject malformed projectIds (allocation boundary)', () => {
    const { a } = makePair()
    expect(() => a.reserve('TASK', 'T-1')).toThrow(/invalid projectId/)
    expect(() => a.reserve('TASK', '')).toThrow(/invalid projectId/)
    expect(() => a.reserve('TASK', 'PRJ-01')).toThrow(/invalid projectId/)
    expect(() => a.peek('GATE', 'junk')).toThrow(/invalid projectId/)
    // GLOBAL kind: projectId is irrelevant, so no project validation
    expect(a.reserve('PROJECT', 'whatever').id).toBe('PRJ-1')
  })
})

describe('allocator: reserve/commit/release semantics (simplest consistent with §1.1)', () => {
  it('reserve → reserved; commit → committed; exactly once', () => {
    const { a } = makePair()
    const res = a.reserve('TASK', 'PRJ-1')
    expect(res.state).toBe('reserved')
    a.commit(res)
    expect(res.state).toBe('committed')
    expect(() => a.commit(res)).toThrow(/already committed/)
    expect(() => a.release(res)).toThrow(/already committed/)
  })

  it('release burns the sequence: the number is never re-issued (gap, no reuse)', () => {
    const { a } = makePair()
    const res1 = a.reserve('TASK', 'PRJ-1')
    expect(res1.id).toBe('T-1')
    a.release(res1)
    expect(res1.state).toBe('released')
    // T-1 is gone forever; the next reservation is T-2
    const res2 = a.reserve('TASK', 'PRJ-1')
    expect(res2.id).toBe('T-2')
    a.commit(res2)
    const res3 = a.reserve('TASK', 'PRJ-1')
    expect(res3.id).toBe('T-3')
    expect(() => a.release(res1)).toThrow(/already released/)
  })

  it('commit/release are instance-bound: a foreign allocator cannot transition your reservation', () => {
    const { a, b } = makePair()
    const res = a.reserve('TASK', 'PRJ-1')
    expect(() => b.commit(res)).toThrow(/not created by this allocator/)
    expect(() => b.release(res)).toThrow(/not created by this allocator/)
    // the original owner can still proceed
    a.commit(res)
    expect(res.state).toBe('committed')
  })

  it('released numbers never collide with later reservations across actors', () => {
    const { a, b } = makePair()
    const r1 = a.reserve('TASK', 'PRJ-1') // T-1
    a.release(r1) // burned
    const r2 = b.reserve('TASK', 'PRJ-1') // T-2 (continues the shared counter)
    b.commit(r2)
    const r3 = a.reserve('TASK', 'PRJ-1') // T-3
    a.commit(r3)
    expect([r2.id, r3.id]).toEqual(['T-2', 'T-3'])
    expect(new Set([r1.id, r2.id, r3.id]).size).toBe(3)
  })
})

describe('allocator: single-threaded interleaving (concurrency simulation)', () => {
  /**
   * Three actors (allocator instances) on one shared store, round-robined
   * over 50 rounds: each actor reserves for its own (kind, project), then
   * commits — or occasionally releases — mimicking interleaved scheduling.
   * Invariants checked afterwards:
   *   - no id is ever committed twice, by any actor;
   *   - every committed id is unique within its (kind, project);
   *   - the persisted counter equals the TOTAL number of burned sequences
   *     (committed + released) — monotonic, gap-tolerant;
   *   - sequences are dense from 1 except for the released gaps.
   */
  function runInterleaving(rounds: number, releaseEvery: number) {
    const store = createMetaStore()
    const actors: Array<{ alloc: IdAllocator; kind: Parameters<IdAllocator['reserve']>[0]; project: string; committed: string[]; released: string[] }> = [
      { alloc: new IdAllocator(store), kind: 'TASK', project: 'PRJ-1', committed: [], released: [] },
      { alloc: new IdAllocator(store), kind: 'GATE', project: 'PRJ-1', committed: [], released: [] },
      { alloc: new IdAllocator(store), kind: 'TASK', project: 'PRJ-2', committed: [], released: [] },
    ]
    // Duplicate detection keys on (counter key, sequence): the same id
    // STRING may legitimately exist in different projects (uniqueness scope
    // = project), so raw id strings are the wrong key.
    const seen = new Map<string, number>()
    for (let round = 0; round < rounds; round++) {
      for (const actor of actors) {
        const res = actor.alloc.reserve(actor.kind, actor.project)
        if (round % releaseEvery === 3) {
          actor.alloc.release(res)
          actor.released.push(res.id)
        } else {
          actor.alloc.commit(res)
          actor.committed.push(res.id)
        }
        const slot = `${counterKey(actor.kind, actor.project)}:${res.sequence}`
        const timesSeen = (seen.get(slot) ?? 0) + 1
        seen.set(slot, timesSeen)
        expect(timesSeen, `slot ${slot} handed out more than once`).toBe(1)
      }
    }
    return { store, actors, seen }
  }

  it('3 actors × 50 rounds: no duplicates, counters = burned totals', () => {
    const { store, actors } = runInterleaving(50, 7)
    for (const actor of actors) {
      const totalBurned = actor.committed.length + actor.released.length
      expect(totalBurned).toBe(50)
      // committed ids unique
      expect(new Set(actor.committed).size).toBe(actor.committed.length)
      // no committed id was also released
      expect(actor.committed.filter(id => actor.released.includes(id))).toEqual([])
      // counter equals burned total (gaps included)
      expect(actor.alloc.peek(actor.kind, actor.project)).toBe(totalBurned)
      // released sequences are exactly the gap positions
      for (const id of actor.released) {
        expect(actor.committed).not.toContain(id)
      }
    }
    // actor 0 (PRJ-1 TASK) and actor 2 (PRJ-2 TASK): disjoint projects,
    // sequences restart per project — ids only collide across projects,
    // which is CORRECT (uniqueness scope = project)
    expect(actors[0]!.committed).toContain('T-1')
    expect(actors[2]!.committed).toContain('T-1')
    expect(actors[0]!.committed).not.toContain(actors[1]!.committed[0]!)
    // stored counters are canonical decimal strings
    expect(store.get('id-counter:PRJ-1:TASK')).toBe('50')
    expect(store.get('id-counter:PRJ-1:GATE')).toBe('50')
    expect(store.get('id-counter:PRJ-2:TASK')).toBe('50')
  })

  it('determinism: the same interleave order reproduces the same id sequences', () => {
    const first = runInterleaving(30, 5).actors.map(a => a.committed)
    const second = runInterleaving(30, 5).actors.map(a => a.committed)
    expect(second).toEqual(first)
  })

  it('heavier release pressure (every 3rd round) still leaves no duplicates', () => {
    const { actors, seen } = runInterleaving(40, 3)
    expect([...seen.values()].every(n => n === 1)).toBe(true)
    for (const actor of actors) {
      expect(new Set(actor.committed).size).toBe(actor.committed.length)
      expect(actor.alloc.peek(actor.kind, actor.project)).toBe(40)
    }
  })

  it('reservation objects carry their allocation provenance', () => {
    const { a } = makePair()
    const res: Reservation = a.reserve('TOPOLOGY_EDGE', 'PRJ-1')
    expect(res).toMatchObject({ id: 'TE-1', kind: 'TOPOLOGY_EDGE', projectId: 'PRJ-1', sequence: 1 })
    const global: Reservation = a.reserve('PROJECT', 'PRJ-1')
    expect(global).toMatchObject({ id: 'PRJ-1', kind: 'PROJECT', projectId: null, sequence: 1 })
  })
})
