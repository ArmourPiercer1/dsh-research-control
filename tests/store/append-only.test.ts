/**
 * WP-2.1 — INV-HIST-1 (append-only) at BOTH enforcement layers:
 *
 *   1. TYPE SURFACE — the `ResearchStore` handle has no update/delete/
 *      rewrite method (the frozen surface is exactly: path, userVersion,
 *      close, appendEvents, getEvent, listRange, meta). The store handle
 *      is a sealed object literal — its OWN property names are the
 *      surface, asserted here at runtime; the module's export names are
 *      asserted to contain no mutation verb either.
 *   2. STORAGE LEVEL — SQLite triggers ABORT raw UPDATE/DELETE on
 *      `history_event` even through a second raw connection: no code
 *      path (present or future) can rewrite seq/eventId or delete rows
 *      (TC-HIST-003「任何 API 不改写既有 seq/eventId」, INV-HIST-7
 *      no hard delete of identity rows).
 *
 * Boundary: `derived_state` IS updatable by design (rebuildable cache,
 * TC-HIST-006 — not first-class identity).
 */
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import * as storeModule from '../../src/host/persistence/store/index.js'
import { openDatabase } from '../../src/host/persistence/store/index.js'
import { dbPath, makeEvent, makeTempDir } from './helpers.js'

/** The exact frozen public surface (types.ts `ResearchStore`). */
const PUBLIC_SURFACE = new Set([
  'path',
  'userVersion',
  'close',
  'appendEvents',
  'getEvent',
  'listRange',
  'meta',
])

/** Verb stems that would imply mutation of the event log. */
const MUTATION_RE = /delete|remove|update|modify|drop|truncate|reset|purge|rewrite|replace|alter/i

describe('INV-HIST-1: type surface has no delete/update API', () => {
  it('the store handle exposes EXACTLY the frozen surface (nothing more, nothing less)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.close()
    const own = new Set(Object.keys(store))
    expect(own).toEqual(PUBLIC_SURFACE)
  })

  it('no own or prototype property of the handle carries a mutation verb', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.close()
    const names = new Set<string>([
      ...Object.keys(store),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(store)),
    ])
    const offenders = [...names].filter((n) => n !== 'constructor' && MUTATION_RE.test(n))
    expect(offenders).toEqual([])
  })

  it('the module export surface contains no delete/update/rewrite entry', () => {
    const names = Object.keys(storeModule)
    const offenders = names.filter((n) => MUTATION_RE.test(n))
    expect(offenders).toEqual([])
  })
})

describe('INV-HIST-1: storage-level enforcement (triggers)', () => {
  it('raw UPDATE on history_event is ABORTED and the row is unchanged', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const store = openDatabase(path)
    store.appendEvents([makeEvent({ eventId: 'H-1', occurredAt: 100 })])
    store.close()

    const raw = new DatabaseSync(path)
    let err: unknown
    try {
      raw.exec("UPDATE history_event SET event_seq = event_seq + 1 WHERE event_id = 'H-1'")
    } catch (e) {
      err = e
    }
    expect(String(err)).toContain('append-only (INV-HIST-1)')
    let err2: unknown
    try {
      raw.exec("UPDATE history_event SET recorded_at = 0 WHERE event_id = 'H-1'")
    } catch (e) {
      err2 = e
    }
    expect(String(err2)).toContain('append-only (INV-HIST-1)')
    // row unchanged (TC-HIST-003: seq/eventId/recordedAt immutable)
    const row = raw
      .prepare('SELECT event_seq, occurred_at, recorded_at FROM history_event WHERE event_id = ?')
      .get('H-1') as { event_seq: number; occurred_at: number; recorded_at: number }
    raw.close()
    expect(row.event_seq).toBe(1)
    expect(row.occurred_at).toBe(100)
  })

  it('raw DELETE on history_event is ABORTED (no hard delete, INV-HIST-7)', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const store = openDatabase(path)
    store.appendEvents([makeEvent({ eventId: 'H-1' }), makeEvent({ eventId: 'H-2' })])
    store.close()

    const raw = new DatabaseSync(path)
    let err: unknown
    try {
      raw.exec("DELETE FROM history_event WHERE event_id = 'H-1'")
    } catch (e) {
      err = e
    }
    expect(String(err)).toContain('append-only (INV-HIST-1)')
    const c = Number(
      raw.prepare('SELECT COUNT(*) AS c FROM history_event').get()?.c ?? -1,
    )
    raw.close()
    expect(c).toBe(2)
  })

  it('derived_state remains updatable (rebuildable cache — the documented boundary)', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const store = openDatabase(path)
    store.appendEvents([makeEvent({ eventId: 'H-1' })], {
      derivedState: [{ objectKind: 'task', objectId: 'T-1', state: { v: 1 } }],
    })
    store.close()
    const raw = new DatabaseSync(path)
    raw
      .prepare("UPDATE derived_state SET state = ? WHERE object_kind = 'task' AND object_id = 'T-1'")
      .run(JSON.stringify({ v: 2 }))
    const row = raw
      .prepare("SELECT state FROM derived_state WHERE object_id = 'T-1'")
      .get() as { state: string }
    raw.close()
    expect(JSON.parse(row.state)).toEqual({ v: 2 })
  })
})
