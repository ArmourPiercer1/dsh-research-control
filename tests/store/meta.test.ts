/**
 * WP-2.1 — SqliteMetaStore: the WP-1.6 RESERVED `MetaStore` sqlite backend
 * against the §15 `meta` table.
 *
 *   - same surface as the in-memory backend (KV + counter face);
 *   - `bumpCounter` = ONE atomic SQL statement (INSERT … ON CONFLICT DO
 *     UPDATE … RETURNING) — cross-connection atomicity, proven by two
 *     connections bumping the same key and producing exactly the values
 *     1..200 with no duplicates;
 *   - `IdCounterPort` conformance: the shared `IdAllocator` runs
 *     unchanged on the sqlite backend (reserve/commit/release, gaps,
 *     persistence across reopen);
 *   - corruption guard + invalid-delta errors mirror the WP-1.6 surface.
 */
import { describe, expect, it } from 'vitest'

import { counterKey, IdAllocator, type IdCounterPort } from '../../src/shared/ids/index.js'
import {
  openDatabase,
  SqliteMetaStore,
  StoreClosedError,
  StoreCorruptError,
  StoreError,
  StoreInputError,
  type MetaStore,
} from '../../src/host/persistence/store/index.js'
import { dbPath, makeTempDir } from './helpers.js'

describe('SqliteMetaStore: KV face', () => {
  it('set/get/delete/keys behave like the memory backend', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const meta = store.meta()
    expect(meta.backend).toBe('sqlite')
    expect(meta.get('k')).toBeNull()
    meta.set('b', '2')
    meta.set('a', '1')
    meta.set('b', '22') // overwrite
    expect(meta.get('b')).toBe('22')
    expect(meta.keys()).toEqual(['a', 'b']) // sorted
    meta.delete('a')
    expect(meta.get('a')).toBeNull()
    meta.delete('missing') // no-op
    expect(meta.keys()).toEqual(['b'])
    store.close()
  })

  it('rejects a non-string value and an empty key with structured errors', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const meta = store.meta()
    expect(() => meta.set('', 'x')).toThrowError(StoreInputError)
    expect(() => meta.set('k', 42 as never)).toThrowError(StoreInputError)
    store.close()
  })
})

describe('SqliteMetaStore: counter face (IdCounterPort seam)', () => {
  it('counters start at 0, bump returns the NEW value, deltas accumulate', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const meta = store.meta()
    expect(meta.getCounter('c')).toBe(0)
    expect(meta.bumpCounter('c')).toBe(1)
    expect(meta.bumpCounter('c')).toBe(2)
    expect(meta.bumpCounter('c', 5)).toBe(7)
    expect(meta.get('c')).toBe('7') // canonical decimal string (1:1 with memory backend)
    store.close()
  })

  it('bumpCounter is atomic across CONNECTIONS: two connections yield exactly 1..200', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const a = openDatabase(path)
    const b = openDatabase(path)
    const seenA = new Set<number>()
    const seenB = new Set<number>()
    for (let i = 0; i < 100; i++) {
      seenA.add(a.meta().bumpCounter('shared', 1))
      seenB.add(b.meta().bumpCounter('shared', 1))
    }
    a.close()
    b.close()
    expect(seenA.size).toBe(100)
    expect(seenB.size).toBe(100)
    expect([...seenA].some((v) => seenB.has(v))).toBe(false)
    const merged = [...seenA, ...seenB].sort((x, y) => x - y)
    expect(merged).toEqual(Array.from({ length: 200 }, (_, i) => i + 1))
  })

  it('persistence: counters survive close/reopen (new connection)', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const first = openDatabase(path)
    first.meta().bumpCounter('persist-me', 4)
    first.close()
    const second = openDatabase(path)
    expect(second.meta().getCounter('persist-me')).toBe(4)
    second.meta().bumpCounter('persist-me', 1)
    second.close()
  })

  it('invalid delta → RangeError (mirrors the WP-1.6 in-memory surface)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const meta = store.meta()
    expect(() => meta.bumpCounter('c', 0)).toThrowError(RangeError)
    expect(() => meta.bumpCounter('c', -1)).toThrowError(RangeError)
    expect(() => meta.bumpCounter('c', 1.5)).toThrowError(RangeError)
    store.close()
  })

  it('a corrupted counter value → structured StoreCorruptError (fail loud, never mis-allocate)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const meta = store.meta()
    meta.set('bad', 'not-a-number')
    let err: unknown
    try {
      meta.getCounter('bad')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(StoreCorruptError)
    expect(err).toBeInstanceOf(StoreError)
    expect(() => meta.bumpCounter('bad')).toThrowError(StoreCorruptError)
    store.close()
  })

  it('a closed store makes the meta face throw STORE_CLOSED', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const meta = store.meta()
    store.close()
    expect(() => meta.get('k')).toThrowError(StoreClosedError)
    expect(() => meta.bumpCounter('k')).toThrowError(StoreClosedError)
  })

  it('the same store instance is returned per call (stable object)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    expect(store.meta()).toBe(store.meta())
    expect(store.meta()).toBeInstanceOf(SqliteMetaStore)
    store.close()
  })
})

describe('SqliteMetaStore: shared IdAllocator integration', () => {
  it('the allocator runs UNCHANGED on the sqlite backend (typed as IdCounterPort)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const port: IdCounterPort = store.meta() // structural conformance (compile-time)
    const alloc = new IdAllocator(port)
    const r1 = alloc.reserve('TASK', 'PRJ-1')
    const r2 = alloc.reserve('TASK', 'PRJ-1')
    alloc.commit(r1)
    alloc.release(r2) // burns the sequence → permanent gap
    expect(r1.id).toBe('T-1')
    expect(r2.id).toBe('T-2')
    expect(r2.state).toBe('released')
    // the counter is persisted under the documented key in the meta TABLE
    expect(store.meta().get(counterKey('TASK', 'PRJ-1'))).toBe('2')
    store.close()
  })

  it('a fresh allocator on a reopened store continues the sequence (gaps preserved)', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const first = openDatabase(path)
    const a1 = new IdAllocator(first.meta())
    a1.reserve('GATE', 'PRJ-1').id // G-1
    a1.reserve('GATE', 'PRJ-1').id // G-2
    first.close()

    const second = openDatabase(path)
    const a2 = new IdAllocator(second.meta())
    expect(a2.reserve('GATE', 'PRJ-1').id).toBe('G-3') // continues, no reuse
    second.close()
  })

  it('MetaStore conformance: SqliteMetaStore IS-A MetaStore (type-level + runtime)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const meta: MetaStore = store.meta()
    expect(meta.backend).toBe('sqlite')
    meta.set('x', '1')
    expect(meta.get('x')).toBe('1')
    expect(meta.getCounter('x')).toBe(1)
    store.close()
  })
})
