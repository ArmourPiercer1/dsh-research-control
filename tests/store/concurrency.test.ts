/**
 * WP-2.1 — concurrent-interleaving simulation (single thread, TWO
 * connections on the same file — the single-process operating context of
 * the plugin). Proves the seq assignment is safe under interleaving:
 * MAX+1 happens INSIDE the write transaction (BEGIN IMMEDIATE holds the
 * write lock), so two connections appending to the SAME workstream never
 * duplicate or skip a seq (TC-HIST-003). WAL lets the second connection
 * READ committed state while the first holds the write lock.
 *
 * Lock contention is absorbed by `busy_timeout` (default 5000 ms): every
 * append is a self-contained begin…commit, so same-thread interleaving
 * never deadlocks — each wait resolves when the previous call commits.
 */
import { describe, expect, it } from 'vitest'

import { openDatabase } from '../../src/host/persistence/store/index.js'
import { dbPath, makeEvent, makeTempDir } from './helpers.js'

describe('two connections interleaved on one file', () => {
  it('alternate appends to the SAME workstream yield exactly 1..20 (no dup/skip)', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const a = openDatabase(path)
    const b = openDatabase(path)
    const idsA: string[] = []
    const idsB: string[] = []
    for (let i = 1; i <= 10; i++) {
      const ra = a.appendEvents([makeEvent({ eventId: `H-A${i}` })])
      idsA.push(ra.events[0].eventId)
      const rb = b.appendEvents([makeEvent({ eventId: `H-B${i}` })])
      idsB.push(rb.events[0].eventId)
    }
    a.close()
    b.close()

    // re-open once and audit the merged log
    const c = openDatabase(path)
    const all = c.listRange('WS-1', 1, 20)
    c.close()
    expect(all).toHaveLength(20)
    expect(all.map((e) => e.eventSeq)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    )
    const ids = new Set(all.map((e) => e.eventId))
    expect(ids.size).toBe(20)
    for (const id of [...idsA, ...idsB]) expect(ids.has(id)).toBe(true)
  })

  it('appends to different workstreams stay independent under interleaving', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const a = openDatabase(path)
    const b = openDatabase(path)
    for (let i = 1; i <= 5; i++) {
      a.appendEvents([makeEvent({ eventId: `H-X${i}`, ownerWorkstreamId: 'WS-1' })])
      b.appendEvents([makeEvent({ eventId: `H-Y${i}`, ownerWorkstreamId: 'WS-2' })])
    }
    a.close()
    b.close()
    const c = openDatabase(path)
    expect(c.listRange('WS-1', 1, 5).map((e) => e.eventSeq)).toEqual([1, 2, 3, 4, 5])
    expect(c.listRange('WS-2', 1, 5).map((e) => e.eventSeq)).toEqual([1, 2, 3, 4, 5])
    c.close()
  })

  it('batches interleave atomically: a 5-event batch either fully lands or not at all', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const a = openDatabase(path)
    const b = openDatabase(path)
    b.appendEvents([makeEvent({ eventId: 'H-B0' })])
    const batch = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ eventId: `H-A${i + 1}` }),
    )
    a.appendEvents(batch)
    a.close()
    b.close()
    const c = openDatabase(path)
    const seqs = c.listRange('WS-1', 1, 6).map((e) => e.eventSeq)
    c.close()
    // B0 first (seq 1), then the atomic batch (seqs 2..6), contiguous
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('a second connection can READ committed state while the first holds the write lock (WAL)', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const a = openDatabase(path)
    const b = openDatabase(path)
    a.appendEvents([makeEvent({ eventId: 'H-1' })])
    let observed: string | null = null
    let observedSeq = -1
    // the validate hook runs INSIDE a's write transaction: b reads through
    // the WAL while a still holds the lock
    a.appendEvents(
      [makeEvent({ eventId: 'H-2' })],
      {
        validate: () => {
          const ev = b.getEvent('WS-1', 1)
          observed = ev?.eventId ?? null
          observedSeq = ev?.eventSeq ?? -1
        },
      },
    )
    a.close()
    b.close()
    expect(observed).toBe('H-1')
    expect(observedSeq).toBe(1)
  })

  it('seqs assigned by a FAILED batch are not visible to the other connection', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const a = openDatabase(path)
    const b = openDatabase(path)
    let boomAtRead = false
    expect(() =>
      a.appendEvents(
        [makeEvent({ eventId: 'H-A1' })],
        {
          validate: () => {
            boomAtRead = true
            throw new Error('rollback me')
          },
        },
      ),
    ).toThrow('rollback me')
    expect(boomAtRead).toBe(true)
    // b sees an EMPTY log — the rolled-back batch left no seq behind
    expect(b.listRange('WS-1', 1)).toEqual([])
    // and b's own append starts at seq 1
    const r = b.appendEvents([makeEvent({ eventId: 'H-B1' })])
    a.close()
    b.close()
    expect(r.events[0].eventSeq).toBe(1)
  })
})
