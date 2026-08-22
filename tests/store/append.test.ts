/**
 * WP-2.1 — appendEvents: eventSeq assignment (per owner WS, strict +1,
 * MAX+1 inside the write transaction — TC-HIST-003), envelope ownership
 * rules (eventSeq/recordedAt are store-owned), late registration
 * (occurredAt may predate earlier events; seq still tail-assigns),
 * eventId uniqueness (PK), input validation.
 */
import { describe, expect, it } from 'vitest'

import {
  openDatabase,
  StoreConflictError,
  StoreError,
  StoreInputError,
  type HistoryEventInput,
} from '../../src/host/persistence/store/index.js'
import { dbPath, makeEvent, makeTempDir } from './helpers.js'

describe('appendEvents: seq assignment (TC-HIST-003)', () => {
  it('assigns 1,2,3,… strictly per owner workstream', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const r1 = store.appendEvents([makeEvent({ ownerWorkstreamId: 'WS-1' })])
    const r2 = store.appendEvents([
      makeEvent({ ownerWorkstreamId: 'WS-1' }),
      makeEvent({ ownerWorkstreamId: 'WS-1' }),
    ])
    store.close()
    expect(r1.events[0].eventSeq).toBe(1)
    expect(r2.events.map((e) => e.eventSeq)).toEqual([2, 3])
  })

  it('workstreams are independent: seq restarts per owner', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.appendEvents([makeEvent({ ownerWorkstreamId: 'WS-1' })])
    store.appendEvents([makeEvent({ ownerWorkstreamId: 'WS-1' })])
    const b = store.appendEvents([
      makeEvent({ ownerWorkstreamId: 'WS-2' }),
      makeEvent({ ownerWorkstreamId: 'WS-1' }),
    ])
    store.close()
    expect(b.events[0].eventSeq).toBe(1) // WS-2 first
    expect(b.events[1].eventSeq).toBe(3) // WS-1 continues
    expect(b.lastSeqByWorkstream).toEqual({ 'WS-2': 1, 'WS-1': 3 })
  })

  it('interleaves a mixed batch in input order within one transaction', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    const r = store.appendEvents([
      makeEvent({ eventId: 'H-A1', ownerWorkstreamId: 'WS-1' }),
      makeEvent({ eventId: 'H-B1', ownerWorkstreamId: 'WS-2' }),
      makeEvent({ eventId: 'H-A2', ownerWorkstreamId: 'WS-1' }),
      makeEvent({ eventId: 'H-B2', ownerWorkstreamId: 'WS-2' }),
    ])
    store.close()
    expect(r.events.map((e) => e.eventId)).toEqual(['H-A1', 'H-B1', 'H-A2', 'H-B2'])
    expect(r.events.map((e) => `${e.ownerWorkstreamId}:${e.eventSeq}`)).toEqual([
      'WS-1:1',
      'WS-2:1',
      'WS-1:2',
      'WS-2:2',
    ])
  })

  it('recordedAt is store-generated (injected clock), one value per batch', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir), { now: () => 4_200_000_000 })
    const r = store.appendEvents([makeEvent(), makeEvent()])
    store.close()
    expect(r.events[0].recordedAt).toBe(4_200_000_000)
    expect(r.events[1].recordedAt).toBe(4_200_000_000)
  })
})

describe('appendEvents: late registration (HISTORY_EVENT_CATALOG §1 L32)', () => {
  it('an early occurredAt takes the next seq; audit order stays append order', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.appendEvents([makeEvent({ eventId: 'H-1', occurredAt: 2_000 })])
    const late = store.appendEvents([makeEvent({ eventId: 'H-2', occurredAt: 1_000 })])
    store.close()
    expect(late.events[0].eventSeq).toBe(2)
    expect(late.events[0].occurredAt).toBe(1_000)
    // audit order (event_seq) — late event is still at the tail
    const again = openDatabase(dbPath(dir))
    const list = again.listRange('WS-1', 1)
    again.close()
    expect(list.map((e) => e.eventId)).toEqual(['H-1', 'H-2'])
    expect(list.map((e) => e.occurredAt)).toEqual([2_000, 1_000])
  })
})

describe('appendEvents: eventId uniqueness (PK, §15)', () => {
  it('rejects a duplicate eventId from an earlier batch with STORE_CONFLICT', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    store.appendEvents([makeEvent({ eventId: 'H-1' })])
    let err: unknown
    try {
      store.appendEvents([makeEvent({ eventId: 'H-1' })])
    } catch (e) {
      err = e
    }
    store.close()
    expect(err).toBeInstanceOf(StoreConflictError)
    expect((err as StoreError).code).toBe('STORE_CONFLICT')
  })

  it('rejects duplicate eventIds within one batch with STORE_INPUT', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    let err: unknown
    try {
      store.appendEvents([
        makeEvent({ eventId: 'H-1' }),
        makeEvent({ eventId: 'H-1' }),
      ])
    } catch (e) {
      err = e
    }
    store.close()
    expect(err).toBeInstanceOf(StoreInputError)
    expect(String((err as Error).message)).toContain('duplicate eventId')
  })
})

describe('appendEvents: input validation (store-owned fields + shapes)', () => {
  function expectInputError(dir: string, fn: (store: ReturnType<typeof openDatabase>) => void, frag: string): void {
    const store = openDatabase(dbPath(dir))
    let err: unknown
    try {
      fn(store)
    } catch (e) {
      err = e
    }
    store.close()
    expect(err).toBeInstanceOf(StoreInputError)
    expect(String((err as Error).message)).toContain(frag)
  }

  it('rejects a caller-supplied eventSeq (store-assigned)', () => {
    const dir = makeTempDir()
    expectInputError(
      dir,
      (s) =>
        s.appendEvents([
          { ...makeEvent(), eventSeq: 5 } as unknown as HistoryEventInput,
        ]),
      'eventSeq is store-assigned',
    )
  })

  it('rejects a caller-supplied recordedAt (plugin-generated, §1 L33)', () => {
    const dir = makeTempDir()
    expectInputError(
      dir,
      (s) =>
        s.appendEvents([
          { ...makeEvent(), recordedAt: 1 } as unknown as HistoryEventInput,
        ]),
      'recordedAt is generated by the plugin',
    )
  })

  it('rejects empty / non-array event lists', () => {
    const dir = makeTempDir()
    expectInputError(dir, (s) => s.appendEvents([]), 'non-empty')
    const dir2 = makeTempDir()
    expectInputError(dir2, (s) => s.appendEvents('nope' as never), 'non-empty')
  })

  it('rejects bad schemaVersion / occurredAt / actor / payload shapes', () => {
    expectInputError(
      makeTempDir(),
      (s) => s.appendEvents([makeEvent({ schemaVersion: 0 })]),
      'schemaVersion',
    )
    expectInputError(
      makeTempDir(),
      (s) => s.appendEvents([makeEvent({ schemaVersion: 1.5 })]),
      'schemaVersion',
    )
    expectInputError(
      makeTempDir(),
      (s) => s.appendEvents([makeEvent({ occurredAt: -1 })]),
      'occurredAt',
    )
    expectInputError(
      makeTempDir(),
      (s) => s.appendEvents([makeEvent({ occurredAt: 1.25 })]),
      'occurredAt',
    )
    expectInputError(
      makeTempDir(),
      (s) => s.appendEvents([makeEvent({ actor: {} as never })]),
      'actor.kind',
    )
    expectInputError(
      makeTempDir(),
      (s) => s.appendEvents([makeEvent({ payload: [] as never })]),
      'payload',
    )
    expectInputError(
      makeTempDir(),
      (s) => s.appendEvents([makeEvent({ eventType: '' })]),
      'eventType',
    )
  })

  it('rejects a non-JSON-serializable payload (strict JSON: no functions)', () => {
    const dir = makeTempDir()
    expectInputError(
      dir,
      (s) => s.appendEvents([makeEvent({ payload: { f: (() => 1) as never } })]),
      'strict JSON',
    )
  })

  it('rejects silent-corruption shapes: NaN, Infinity, Date, non-plain objects', () => {
    // JSON.stringify would silently coerce these — the store refuses instead
    expectInputError(
      makeTempDir(),
      (s) => s.appendEvents([makeEvent({ payload: { n: Number.NaN } })]),
      'non-finite',
    )
    expectInputError(
      makeTempDir(),
      (s) => s.appendEvents([makeEvent({ payload: { n: Number.POSITIVE_INFINITY } })]),
      'non-finite',
    )
    expectInputError(
      makeTempDir(),
      (s) => s.appendEvents([makeEvent({ payload: { d: new Date() } })]),
      'non-plain object',
    )
    expectInputError(
      makeTempDir(),
      (s) => s.appendEvents([makeEvent({ payload: { m: new Map() } })]),
      'non-plain object',
    )
  })

  it('a failed append is zero-side-effect (nothing persisted, seq not consumed)', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir))
    expect(() =>
      store.appendEvents([makeEvent({ eventId: 'H-1' }), makeEvent({ eventId: 'H-1' })]),
    ).toThrowError(StoreInputError)
    // store still usable; the failed batch consumed NO seq
    const ok = store.appendEvents([makeEvent({ eventId: 'H-1' })])
    store.close()
    expect(ok.events[0].eventSeq).toBe(1)
  })
})

describe('appendEvents: envelope round-trip', () => {
  it('returns the full frozen envelope (camelCase) with actor/source/payload intact', () => {
    const dir = makeTempDir()
    const store = openDatabase(dbPath(dir), { now: () => 777 })
    const source = { kind: 'DSH_SESSION' as const, session_id: 'sess-1' }
    const payload = { run_id: 'R-9', task_id: 'T-3', nested: { a: [1, 2, { b: true }] } }
    const r = store.appendEvents([
      makeEvent({
        eventId: 'H-77',
        ownerWorkstreamId: 'WS-9',
        eventType: 'RUN_FINISHED',
        occurredAt: 42,
        actor: { kind: 'AGENT', run_id: 'R-9', label: 'op' },
        source,
        payload,
      }),
    ])
    store.close()
    expect(r.events[0]).toMatchObject({
      eventId: 'H-77',
      ownerWorkstreamId: 'WS-9',
      eventSeq: 1,
      eventType: 'RUN_FINISHED',
      schemaVersion: 1,
      occurredAt: 42,
      recordedAt: 777,
      actor: { kind: 'AGENT', run_id: 'R-9', label: 'op' },
      source,
      payload,
    })
    // source omitted on input → absent on the record (frozen envelope: optional)
    const noSource = openDatabase(dbPath(dir))
    const r2 = noSource.appendEvents([makeEvent({ eventId: 'H-78' })])
    noSource.close()
    expect('source' in r2.events[0]).toBe(false)
  })
})
