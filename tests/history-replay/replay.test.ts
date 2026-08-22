/**
 * WP-2.3 — the generic replay engine (`foldEvents`) + TC-HIST-005
 * (replay idempotency: 同一事件流重放 N 次结果逐字节一致；semantic/audit
 * 两种排序均可重复) + the TYPE-SURFACE proof that replay has no event
 * write path (「重放不得产生新的 HistoryEvent」, catalog §6 L279).
 */
import { describe, expect, it } from 'vitest'

import {
  foldEvents,
  queryEvents,
  type QueryStore,
  type RebuildStore,
} from '../../src/host/history/replay/index.js'
import type { ResearchStore } from '../../src/host/persistence/store/index.js'
import { canonicalMapJson, deepFreeze, freshStore, makeEvent } from './helpers.js'

describe('foldEvents — the generic replay engine', () => {
  it('pure left fold: accumulates in array order, initial feeds the first transition', () => {
    const calls: Array<[number, number]> = []
    const out = foldEvents(
      [10, 20, 30],
      (acc, ev) => {
        calls.push([acc, ev])
        return acc + ev
      },
      100,
    )
    expect(out).toBe(160)
    expect(calls).toEqual([
      [100, 10],
      [110, 20],
      [130, 30],
    ])
  })

  it('empty stream → initial, verbatim (even frozen)', () => {
    const initial = deepFreeze({ state: 'initial' })
    expect(foldEvents([], (s) => s, initial)).toBe(initial)
  })

  it('TC-HIST-005: the same stream folded N times is byte-identical (deep equality), with FROZEN intermediate states', () => {
    const stream = deepFreeze([
      { eventId: 'H-1', op: 'set', key: 'a', value: 1 },
      { eventId: 'H-2', op: 'set', key: 'b', value: 2 },
      { eventId: 'H-3', op: 'inc', key: 'a' },
      { eventId: 'H-4', op: 'set', key: 'c', value: [1, 2] },
    ])
    const reducer = (acc: ReadonlyMap<string, unknown>, ev: { op: string; key: string; value?: unknown }): Map<string, unknown> => {
      // a well-behaved reducer: read acc (frozen-safe), return a NEW map
      const next = new Map(acc)
      if (ev.op === 'set') next.set(ev.key, ev.value)
      if (ev.op === 'inc') next.set(ev.key, (next.get(ev.key) as number) + 1)
      return deepFreeze(next) // freeze every intermediate — mutation would throw
    }
    const once = foldEvents(stream, reducer, new Map())
    const twice = foldEvents(stream, reducer, new Map())
    const thrice = foldEvents(stream, reducer, new Map())
    expect(canonicalMapJson(twice)).toBe(canonicalMapJson(once))
    expect(canonicalMapJson(thrice)).toBe(canonicalMapJson(once))
    expect(canonicalMapJson(once)).toBe(canonicalMapJson(new Map<string, unknown>([['a', 2], ['b', 2], ['c', [1, 2]]])))
  })

  it('does not mutate the initial state (frozen initial survives a non-trivial fold)', () => {
    const initial = deepFreeze({ base: true, list: [] as string[] })
    const out = foldEvents(
      ['x', 'y'],
      (acc: { base: boolean; list: string[] }, ch) => ({ base: acc.base, list: [...acc.list, ch] }),
      initial,
    )
    expect(out).toEqual({ base: true, list: ['x', 'y'] })
    // the frozen initial is untouched (a mutation attempt would have thrown)
    expect(initial).toEqual({ base: true, list: [] })
  })

  it('a throwing reducer propagates UNCHANGED (caller-owned error type)', () => {
    const sentinel = new Error('reducer boom')
    expect(() => foldEvents([{ n: 1 }], () => {
      throw sentinel
    }, 0)).toThrow(sentinel)
  })

  it('rejects malformed arguments (non-array events / non-function reducer)', () => {
    expect(() => foldEvents('nope' as never, (s: number, e: number) => s + e, 0)).toThrow(TypeError)
    expect(() => foldEvents([1], 'nope' as never, 0)).toThrow(TypeError)
  })
})

describe('TC-HIST-005 on the store: both orders repeatable, byte-identical', () => {
  it('repeated dual-order queries over a real store are deep-equal', () => {
    const store = freshStore()
    store.appendEvents([
      makeEvent({ eventId: 'H-1', occurredAt: 1_000, payload: { fact_id: 'F-1' } }),
      makeEvent({ eventId: 'H-2', occurredAt: 1_000, payload: { fact_id: 'F-2' } }),
      makeEvent({ eventId: 'H-3', occurredAt: 2_000, payload: { fact_id: 'F-3' } }),
    ])
    store.appendEvents([makeEvent({ eventId: 'H-LATE', occurredAt: 500, payload: { fact_id: 'F-LATE' } })])

    const semantic0 = JSON.stringify(queryEvents(store, 'WS-1', { order: 'semantic' }))
    const audit0 = JSON.stringify(queryEvents(store, 'WS-1', { order: 'audit' }))
    for (let i = 0; i < 3; i++) {
      expect(JSON.stringify(queryEvents(store, 'WS-1', { order: 'semantic' }))).toBe(semantic0)
      expect(JSON.stringify(queryEvents(store, 'WS-1', { order: 'audit' }))).toBe(audit0)
    }
    expect(JSON.parse(semantic0).events.map((e: { eventId: string }) => e.eventId)).toEqual(['H-LATE', 'H-1', 'H-2', 'H-3'])
    expect(JSON.parse(audit0).events.map((e: { eventId: string }) => e.eventId)).toEqual(['H-1', 'H-2', 'H-3', 'H-LATE'])
  })

  it('folding the SAME store stream twice (via the query face) is deep-equal — replay idempotency end-to-end', () => {
    const store = freshStore()
    store.appendEvents([
      makeEvent({ eventId: 'H-1', occurredAt: 1_000, payload: { fact_id: 'F-1' } }),
      makeEvent({ eventId: 'H-2', occurredAt: 2_000, payload: { fact_id: 'F-2' } }),
    ])
    const reducer = (acc: ReadonlyMap<string, unknown>, ev: { eventId: string }): Map<string, unknown> => {
      const next = new Map(acc)
      next.set(`seen:${ev.eventId}`, true)
      return next
    }
    const r1 = foldEvents(queryEvents(store, 'WS-1', { order: 'semantic' }).events, reducer, new Map())
    const r2 = foldEvents(queryEvents(store, 'WS-1', { order: 'semantic' }).events, reducer, new Map())
    const r3 = foldEvents(queryEvents(store, 'WS-1', { order: 'audit' }).events, reducer, new Map())
    expect(canonicalMapJson(r2)).toBe(canonicalMapJson(r1))
    // same SET of events in both orders (per-WS: the two orders coincide as sets)
    expect(canonicalMapJson(new Map([...r3].sort()))).toBe(canonicalMapJson(new Map([...r1].sort())))
  })
})

describe('type-surface proof: replay has NO event-write path', () => {
  it('QueryStore / RebuildStore are structurally append-free (compile-time proof below)', () => {
    // A real ResearchStore value is assignable to both faces (structural
    // narrowing — the store keeps its full surface for the appenders).
    const store = freshStore()
    const asQuery: QueryStore = store
    const asRebuild: RebuildStore = store
    expect(asQuery.listRange).toBe(store.listRange)
    expect(asRebuild.path).toBe(store.path)

    // COMPILE-TIME PROOF (catalog §6 L279「重放不得产生新的 HistoryEvent」):
    // neither replay face may expose an append path. If `QueryStore` or
    // `RebuildStore` ever gained `appendEvents`, the @ts-expect-error
    // lines below would become UNUSED and `tsc --noEmit` would FAIL.
    // @ts-expect-error — appendEvents must not exist on the query face
    asQuery.appendEvents
    // @ts-expect-error — appendEvents must not exist on the rebuild face
    asRebuild.appendEvents
  })
})
