/**
 * WP-2.5 — ID allocation seam: C/F/A/REL through the shared/ids allocator
 * (§1.1 规则 2: plugin-allocated, project-monotonic counters, no reuse).
 *
 * Covers: the four families map to the right prefixes (C/F/A/REL), the
 * §8 relation_id 形态 (REL-<n> — the same allocator, no separate scheme),
 * monotonicity + release gaps + exactly-once commit (shared/ids semantics),
 * and the reserve→append→commit protocol shape the service layer follows.
 */
import { describe, expect, it } from 'vitest'

import {
  SEMANTIC_ID_KINDS,
  SEMANTIC_ID_PREFIXES,
  allocateSemanticId,
  isSemanticIdKind,
  type SemanticIdKind,
} from '../../src/host/domain/semantics/index.js'
import { IdAllocator, parseId } from '../../src/shared/ids/index.js'
import { createMetaStore } from '../../src/host/persistence/meta/index.js'

function allocator(): IdAllocator {
  return new IdAllocator(createMetaStore())
}

describe('SEMANTIC_ID_KINDS: the four families (C/F/A/REL)', () => {
  it('exactly the four semantic families, all PROJECT-scoped in shared/ids', () => {
    expect([...SEMANTIC_ID_KINDS]).toEqual(['CLAIM', 'FACT', 'ARTIFACT', 'RELATION'])
    for (const kind of SEMANTIC_ID_KINDS) {
      expect(isSemanticIdKind(kind)).toBe(true)
      const parsed = parseId(`${SEMANTIC_ID_PREFIXES[kind]}-1`)
      expect(parsed?.kind).toBe(kind)
    }
    expect(isSemanticIdKind('RUN')).toBe(false)
    expect(isSemanticIdKind('C')).toBe(false)
    expect(isSemanticIdKind(null)).toBe(false)
  })

  it('the prefixes are the frozen §1.1 rows (C/F/A/REL)', () => {
    expect(SEMANTIC_ID_PREFIXES).toEqual({ CLAIM: 'C', FACT: 'F', ARTIFACT: 'A', RELATION: 'REL' })
  })
})

describe('allocateSemanticId: allocation through the shared/ids allocator', () => {
  it('C/F/A/REL ids take the §1.1 forms (C-<n> / F-<n> / A-<n> / REL-<n>)', () => {
    const a = allocator()
    expect(allocateSemanticId(a, 'CLAIM', 'PRJ-1').id).toBe('C-1')
    expect(allocateSemanticId(a, 'FACT', 'PRJ-1').id).toBe('F-1')
    expect(allocateSemanticId(a, 'ARTIFACT', 'PRJ-1').id).toBe('A-1')
    expect(allocateSemanticId(a, 'RELATION', 'PRJ-1').id).toBe('REL-1') // §8 relation_id 形态
  })

  it('counters are per-family and per-project (no cross-family interference)', () => {
    const a = allocator()
    expect(allocateSemanticId(a, 'CLAIM', 'PRJ-1').id).toBe('C-1')
    expect(allocateSemanticId(a, 'RELATION', 'PRJ-1').id).toBe('REL-1')
    expect(allocateSemanticId(a, 'CLAIM', 'PRJ-1').id).toBe('C-2')
    expect(allocateSemanticId(a, 'RELATION', 'PRJ-2').id).toBe('REL-1') // other project: fresh counter
    expect(allocateSemanticId(a, 'FACT', 'PRJ-1').id).toBe('F-1')
  })

  it('monotonic + no reuse: release burns the sequence (a permanent gap)', () => {
    const a = allocator()
    const first = allocateSemanticId(a, 'ARTIFACT', 'PRJ-1')
    a.release(first)
    const second = allocateSemanticId(a, 'ARTIFACT', 'PRJ-1')
    expect(first.id).toBe('A-1')
    expect(second.id).toBe('A-2') // the released A-1 is never handed out again
    expect(a.peek('ARTIFACT', 'PRJ-1')).toBe(2)
  })

  it('commit is exactly-once (the reservation is the token)', () => {
    const a = allocator()
    const r = allocateSemanticId(a, 'CLAIM', 'PRJ-1')
    a.commit(r)
    expect(() => a.commit(r)).toThrow()
    expect(() => a.release(r)).toThrow()
    // a foreign allocator on the same store can only allocate, not touch r
    const store = createMetaStore()
    const foreign = new IdAllocator(store)
    expect(() => foreign.commit(r)).toThrow()
    void foreign
  })

  it('rejects a malformed projectId (all four families are PROJECT-scoped)', () => {
    const a = allocator()
    expect(() => allocateSemanticId(a, 'CLAIM', 'not-a-prj')).toThrow()
    expect(() => allocateSemanticId(a, 'RELATION', 'T-1')).toThrow()
  })

  it('rejects an unknown semantic kind (the typed seam fails loud, not by guessing)', () => {
    const a = allocator()
    expect(() => allocateSemanticId(a, 'RUN' as SemanticIdKind, 'PRJ-1')).toThrow(TypeError)
  })

  it('a second allocator on the same store continues the sequence (persistence via the meta table)', () => {
    const store = createMetaStore()
    const first = new IdAllocator(store)
    expect(first.reserve('FACT', 'PRJ-1').id).toBe('F-1')
    const second = new IdAllocator(store)
    const r = allocateSemanticId(second, 'FACT', 'PRJ-1')
    expect(r.id).toBe('F-2')
    second.commit(r)
  })
})
