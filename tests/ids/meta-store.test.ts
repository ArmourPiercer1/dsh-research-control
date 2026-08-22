/**
 * WP-1.6 — MetaStore interface + InMemoryMetaStore + factory:
 * simple KV face, integer counter face, corruption guards, the reserved
 * `sqlite` seam (WP-2.1), and the structural fit of `MetaStore` into the
 * shared `IdCounterPort` the allocator consumes.
 */
import { describe, expect, it } from 'vitest'
import {
  InMemoryMetaStore,
  createMetaStore,
  type MetaStore,
} from '../../src/host/persistence/meta/index.js'
import { IdAllocator, type IdCounterPort } from '../../src/shared/ids/index.js'

describe('InMemoryMetaStore: simple KV face', () => {
  it('get/set/delete roundtrip', () => {
    const store = createMetaStore()
    expect(store.get('nope')).toBeNull()
    store.set('schema-version', '1')
    expect(store.get('schema-version')).toBe('1')
    store.set('schema-version', '2')
    expect(store.get('schema-version')).toBe('2')
    store.delete('schema-version')
    expect(store.get('schema-version')).toBeNull()
    store.delete('never-existed') // no-op
  })

  it('keys() is sorted and complete', () => {
    const store = createMetaStore()
    store.set('b', '2')
    store.set('a', '1')
    store.set('c', '3')
    expect(store.keys()).toEqual(['a', 'b', 'c'])
  })

  it('stores are isolated instances', () => {
    const a = createMetaStore()
    const b = createMetaStore()
    a.set('k', 'v')
    expect(b.get('k')).toBeNull()
  })

  it('reports backend = memory', () => {
    expect(createMetaStore().backend).toBe('memory')
    expect(new InMemoryMetaStore()).toBeInstanceOf(InMemoryMetaStore)
  })
})

describe('InMemoryMetaStore: counter face', () => {
  it('uninitialized counter reads 0 and bumps from there', () => {
    const store = createMetaStore()
    expect(store.getCounter('c')).toBe(0)
    expect(store.bumpCounter('c')).toBe(1)
    expect(store.bumpCounter('c')).toBe(2)
    expect(store.bumpCounter('c')).toBe(3)
  })

  it('bump honors an explicit positive delta', () => {
    const store = createMetaStore()
    expect(store.bumpCounter('c', 5)).toBe(5)
    expect(store.bumpCounter('c', 2)).toBe(7)
  })

  it('rejects non-positive / non-integer deltas', () => {
    const store = createMetaStore()
    expect(() => store.bumpCounter('c', 0)).toThrow(RangeError)
    expect(() => store.bumpCounter('c', -1)).toThrow(RangeError)
    expect(() => store.bumpCounter('c', 1.5)).toThrow(RangeError)
    expect(() => store.bumpCounter('c', NaN)).toThrow(RangeError)
  })

  it('counter values live in the KV face as canonical decimal strings', () => {
    const store = createMetaStore()
    store.bumpCounter('c')
    store.bumpCounter('c')
    expect(store.get('c')).toBe('2')
    // and pre-seeded canonical values are honored
    store.set('d', '10')
    expect(store.bumpCounter('d')).toBe(11)
  })

  it('guards against corrupted counter values (fail loud)', () => {
    const store = createMetaStore()
    store.set('bad1', 'abc')
    expect(() => store.getCounter('bad1')).toThrow(/meta corruption/)
    store.set('bad2', '-1')
    expect(() => store.bumpCounter('bad2')).toThrow(/meta corruption/)
    store.set('bad3', '1.5')
    expect(() => store.bumpCounter('bad3')).toThrow(/meta corruption/)
  })
})

describe('createMetaStore factory', () => {
  it('defaults to the memory backend', () => {
    expect(createMetaStore().backend).toBe('memory')
    expect(createMetaStore({ backend: 'memory' }).backend).toBe('memory')
  })

  it('rejects the reserved sqlite backend with a WP-2.1 pointer (fail-loud)', () => {
    expect(() => createMetaStore({ backend: 'sqlite', path: 'research.sqlite' })).toThrow(
      /WP-2\.1/,
    )
  })
})

describe('seam: MetaStore satisfies the shared IdCounterPort', () => {
  it('is structurally assignable (compile-time) and works at runtime', () => {
    const store: MetaStore = createMetaStore()
    const port: IdCounterPort = store // ← the WP-2.1 sqlite backend must meet this too
    const alloc = new IdAllocator(port)
    expect(alloc.reserve('TASK', 'PRJ-1').id).toBe('T-1')
    expect(store.bumpCounter('id-counter:PRJ-1:TASK')).toBe(2)
  })
})
