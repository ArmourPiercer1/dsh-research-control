/**
 * WP-2.1 — the MINIMAL read-only query face (WP-2.3 owns full replay /
 * projections): getEvent(owner, seq) + listRange(owner, from, to?).
 * Read-only by construction; input-validated; audit order (event_seq).
 */
import { describe, expect, it } from 'vitest'

import {
  openDatabase,
  StoreInputError,
} from '../../src/host/persistence/store/index.js'
import { dbPath, makeEvent, makeTempDir } from './helpers.js'

function seeded(dir: string) {
  const store = openDatabase(dbPath(dir), { now: () => 500 })
  store.appendEvents([
    makeEvent({ eventId: 'H-1', occurredAt: 300 }),
    makeEvent({ eventId: 'H-2', occurredAt: 100 }), // late registration
    makeEvent({ eventId: 'H-3', occurredAt: 200 }),
    makeEvent({ eventId: 'H-4', ownerWorkstreamId: 'WS-2', occurredAt: 50 }),
  ])
  return store
}

describe('getEvent', () => {
  it('returns the full envelope row for (owner, seq)', () => {
    const dir = makeTempDir()
    const store = seeded(dir)
    const ev = store.getEvent('WS-1', 2)
    expect(ev).not.toBeNull()
    expect(ev!.eventId).toBe('H-2')
    expect(ev!.eventSeq).toBe(2)
    expect(ev!.occurredAt).toBe(100)
    expect(ev!.recordedAt).toBe(500)
    store.close()
  })

  it('returns null for a missing seq (no gap → row absent)', () => {
    const dir = makeTempDir()
    const store = seeded(dir)
    expect(store.getEvent('WS-1', 4)).toBeNull()
    expect(store.getEvent('WS-3', 1)).toBeNull()
    store.close()
  })

  it('validates inputs with structured STORE_INPUT errors', () => {
    const dir = makeTempDir()
    const store = seeded(dir)
    expect(() => store.getEvent('', 1)).toThrowError(StoreInputError)
    expect(() => store.getEvent('WS-1', 0)).toThrowError(StoreInputError)
    expect(() => store.getEvent('WS-1', 1.5)).toThrowError(StoreInputError)
    store.close()
  })
})

describe('listRange', () => {
  it('returns [fromSeq, toSeq] inclusive in audit order (event_seq)', () => {
    const dir = makeTempDir()
    const store = seeded(dir)
    expect(store.listRange('WS-1', 1, 2).map((e) => e.eventId)).toEqual(['H-1', 'H-2'])
    expect(store.listRange('WS-1', 2).map((e) => e.eventId)).toEqual(['H-2', 'H-3'])
    expect(store.listRange('WS-1', 1, 99).map((e) => e.eventId)).toEqual(['H-1', 'H-2', 'H-3'])
    store.close()
  })

  it('audit order follows event_seq, NOT occurred_at (late registration stays at the tail)', () => {
    const dir = makeTempDir()
    const store = seeded(dir)
    const rows = store.listRange('WS-1', 1, 3)
    expect(rows.map((e) => e.eventSeq)).toEqual([1, 2, 3])
    expect(rows.map((e) => e.occurredAt)).toEqual([300, 100, 200])
    store.close()
  })

  it('is scoped per workstream (a foreign ws is invisible)', () => {
    const dir = makeTempDir()
    const store = seeded(dir)
    expect(store.listRange('WS-2', 1).map((e) => e.eventId)).toEqual(['H-4'])
    store.close()
  })

  it('returns [] for an empty range (no error)', () => {
    const dir = makeTempDir()
    const store = seeded(dir)
    expect(store.listRange('WS-1', 5, 9)).toEqual([])
    store.close()
  })

  it('rejects toSeq < fromSeq and bad bounds with STORE_INPUT', () => {
    const dir = makeTempDir()
    const store = seeded(dir)
    expect(() => store.listRange('WS-1', 3, 1)).toThrowError(StoreInputError)
    expect(() => store.listRange('WS-1', 0, 5)).toThrowError(StoreInputError)
    expect(() => store.listRange('WS-1', 1, 0)).toThrowError(StoreInputError)
    store.close()
  })
})
