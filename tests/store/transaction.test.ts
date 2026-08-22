/**
 * WP-2.1 — appendEvents transaction atomicity: ONE write transaction per
 * batch (①seq → ②validate hook → ③event rows → ④derived_state patches →
 * ⑤realize hooks → COMMIT). ANY failure rolls back EVERYTHING — event
 * rows, derived_state, meta, hook-side tx writes; no consumed seq; the
 * store stays usable. This is the TC-DB-003「单事务原子性」 half at the
 * in-process level (the kill -9 half is checkpoint.test.ts).
 */
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import {
  openDatabase,
  type HistoryEventRecord,
  type TxScope,
} from '../../src/host/persistence/store/index.js'
import { dbPath, makeEvent, makeTempDir } from './helpers.js'

/** Raw connection for asserting on-disk state (test-only). */
function rawDb(path: string): DatabaseSync {
  return new DatabaseSync(path)
}

function counts(path: string): { events: number; derived: number } {
  const db = rawDb(path)
  const events = Number(
    db.prepare('SELECT COUNT(*) AS c FROM history_event').get()?.c ?? -1,
  )
  const derived = Number(
    db.prepare('SELECT COUNT(*) AS c FROM derived_state').get()?.c ?? -1,
  )
  db.close()
  return { events, derived }
}

class BoomError extends Error {
  constructor() {
    super('hook boom')
    this.name = 'BoomError'
  }
}

describe('appendEvents: whole-batch atomicity', () => {
  it('a throwing validate hook rolls back events + derived_state; error propagates unchanged', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const store = openDatabase(path)
    const boom = new BoomError()
    let err: unknown
    try {
      store.appendEvents(
        [
          makeEvent({ eventId: 'H-1', ownerWorkstreamId: 'WS-1' }),
          makeEvent({ eventId: 'H-2', ownerWorkstreamId: 'WS-2' }),
        ],
        {
          derivedState: [
            { objectKind: 'task', objectId: 'T-1', state: { execution: 'ACTIVE' } },
          ],
          validate: () => {
            throw boom
          },
        },
      )
    } catch (e) {
      err = e
    }
    // the caller's own error type propagates (WP-2.2 domain errors)
    expect(err).toBe(boom)
    // and NOTHING of the batch persisted
    expect(counts(path)).toEqual({ events: 0, derived: 0 })
    // the store is still usable; the failed batch consumed no seq
    const ok = store.appendEvents([makeEvent({ eventId: 'H-1' })])
    store.close()
    expect(ok.events[0].eventSeq).toBe(1)
  })

  it('a throwing realize hook rolls back the event rows AND the hook\'s own tx writes', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const store = openDatabase(path)
    const boom = new BoomError()
    let sawTx: TxScope | null = null
    let err: unknown
    try {
      store.appendEvents(
        [makeEvent({ eventId: 'H-1', ownerWorkstreamId: 'WS-1' })],
        {
          derivedState: [
            { objectKind: 'run', objectId: 'R-1', state: { status: 'RUNNING' } },
          ],
          realize: {
            workstreamIds: ['WS-1'],
            apply: (ctx) => {
              sawTx = ctx.tx
              ctx.tx.setDerivedState('workstream', ctx.workstreamId, { lifecycle: 'REALIZED' })
              throw boom
            },
          },
        },
      )
    } catch (e) {
      err = e
    }
    expect(err).toBe(boom)
    expect(sawTx).not.toBeNull()
    expect(counts(path)).toEqual({ events: 0, derived: 0 })
    store.close()
  })

  it('a mid-batch PK conflict (duplicate id from an earlier batch) rolls back the whole batch', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const store = openDatabase(path)
    store.appendEvents([makeEvent({ eventId: 'H-1' })])
    expect(() =>
      store.appendEvents([
        makeEvent({ eventId: 'H-2' }), // new — inserted first, then…
        makeEvent({ eventId: 'H-1' }), // …conflict here
      ]),
    ).toThrow()
    expect(counts(path)).toEqual({ events: 1, derived: 0 })
    // only the pre-existing H-1 survived; H-2 was rolled back
    const again = openDatabase(path)
    expect(again.getEvent('WS-1', 1)?.eventId).toBe('H-1')
    expect(again.getEvent('WS-1', 2)).toBeNull()
    again.close()
    store.close()
  })

  it('a failing batch also rolls back meta counters bumped inside a hook', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const store = openDatabase(path)
    const boom = new BoomError()
    expect(() =>
      store.appendEvents([makeEvent({ eventId: 'H-1' })], {
        validate: () => {
          store.meta().bumpCounter('txn-probe', 5)
          throw boom
        },
      }),
    ).toThrow(BoomError)
    expect(store.meta().getCounter('txn-probe')).toBe(0)
    store.close()
  })
})

describe('appendEvents: derived_state (same transaction, wholesale replacement)', () => {
  it('upserts patches alongside the events and commits them together', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const store = openDatabase(path)
    store.appendEvents([makeEvent({ eventId: 'H-1' })], {
      derivedState: [
        { objectKind: 'task', objectId: 'T-1', state: { execution: 'PLANNED' } },
        { objectKind: 'workstream', objectId: 'WS-1', state: { lifecycle: 'REALIZED' } },
      ],
    })
    const db = rawDb(path)
    const task = db
      .prepare('SELECT state FROM derived_state WHERE object_kind = ? AND object_id = ?')
      .get('task', 'T-1') as { state: string } | undefined
    expect(task).toBeDefined()
    expect(JSON.parse(task!.state)).toEqual({ execution: 'PLANNED' })
    db.close()
    expect(store.getEvent('WS-1', 1)?.eventId).toBe('H-1')
    store.close()
  })

  it('replaces the state JSON wholesale (no merge, single row per (kind,id))', () => {
    const dir = makeTempDir()
    const path = dbPath(dir)
    const store = openDatabase(path)
    store.appendEvents([makeEvent({ eventId: 'H-1' })], {
      derivedState: [{ objectKind: 'task', objectId: 'T-1', state: { a: 1, b: 2 } }],
    })
    store.appendEvents([makeEvent({ eventId: 'H-2' })], {
      derivedState: [{ objectKind: 'task', objectId: 'T-1', state: { c: 3 } }],
    })
    const db = rawDb(path)
    const rows = db
      .prepare("SELECT state FROM derived_state WHERE object_kind = 'task' AND object_id = 'T-1'")
      .all()
    db.close()
    expect(rows).toHaveLength(1)
    expect(JSON.parse(String((rows[0] as { state: string }).state))).toEqual({ c: 3 })
    store.close()
  })

  it('later patches for the same (kind,id) win within one batch', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.appendEvents([makeEvent({ eventId: 'H-1' })], {
      derivedState: [
        { objectKind: 'gate', objectId: 'G-1', state: { result: 'FAILED' } },
        { objectKind: 'gate', objectId: 'G-1', state: { result: 'PASSED' } },
      ],
    })
    const db = rawDb(dbPath(dir))
    const row = db
      .prepare("SELECT state FROM derived_state WHERE object_kind = 'gate' AND object_id = 'G-1'")
      .get()
    db.close()
    store.close()
    expect(JSON.parse(String((row as { state: string }).state))).toEqual({ result: 'PASSED' })
  })

  it('validate hook reads PRE-batch derived state (INV-HIST-5 from-check semantics)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.appendEvents([makeEvent({ eventId: 'H-1' })], {
      derivedState: [{ objectKind: 'task', objectId: 'T-1', state: { execution: 'PLANNED' } }],
    })
    const seen: (unknown | null)[] = []
    store.appendEvents([makeEvent({ eventId: 'H-2' })], {
      derivedState: [{ objectKind: 'task', objectId: 'T-1', state: { execution: 'ACTIVE' } }],
      validate: (_events: readonly HistoryEventRecord[], tx: TxScope) => {
        seen.push(tx.getDerivedState('task', 'T-1')) // must see PLANNED, not ACTIVE
        expect(tx.getDerivedState('never', 'set')).toBeNull()
      },
    })
    store.close()
    expect(seen).toEqual([{ execution: 'PLANNED' }])
  })

  it('tx.setDerivedState inside the validate hook commits when the batch succeeds', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.appendEvents([makeEvent({ eventId: 'H-1' })], {
      validate: (_e, tx) => {
        tx.setDerivedState('milestone', 'M-1', { state: 'ACHIEVED' })
      },
    })
    const db = rawDb(dbPath(dir))
    const row = db
      .prepare("SELECT state FROM derived_state WHERE object_kind = 'milestone'")
      .get()
    db.close()
    store.close()
    expect(JSON.parse(String((row as { state: string }).state))).toEqual({ state: 'ACHIEVED' })
  })
})
