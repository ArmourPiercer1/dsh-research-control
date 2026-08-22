/**
 * WP-2.3 — seq-cursor pagination (TC-PERF-004 O(window) semantics; the
 * cursor protocol documented in src/host/history/replay/query.ts).
 *
 * The 12-event fixture (helpers.PAGED_EVENTS) carries two LATE
 * registrations (seq 11 at t(1.5), seq 12 at t(5.5)) — the pagination
 * protocol must partition the log COMPLETELY and DISJOINTLY even when the
 * semantic positions of late events sit far from their seq positions.
 */
import { describe, expect, it } from 'vitest'

import { queryEvents, ReplayInputError, type QueryPage } from '../../src/host/history/replay/index.js'
import type { ResearchStore } from '../../src/host/persistence/store/index.js'
import { freshStore, makeTempDir, dbPath, PAGED_EVENTS, T0 } from './helpers.js'
import { openDatabase } from '../../src/host/persistence/store/index.js'

const M = 60_000
const at = (n: number): number => T0 + M * n

function pagedStore(): ResearchStore {
  const dir = makeTempDir()
  const store = openDatabase(dbPath(dir))
  for (const ev of PAGED_EVENTS) store.appendEvents([ev])
  return store
}

/** Full semantic timeline of the fixture (for expected-order assertions). */
const SEMANTIC_IDS = [
  'P-1', 'P-11', 'P-2', 'P-3', 'P-4', 'P-5', 'P-12', 'P-6', 'P-7', 'P-8', 'P-9', 'P-10',
]
const AUDIT_IDS = ['P-1', 'P-2', 'P-3', 'P-4', 'P-5', 'P-6', 'P-7', 'P-8', 'P-9', 'P-10', 'P-11', 'P-12']

function pageIds(page: QueryPage): string[] {
  return page.events.map((e) => e.eventId)
}

/** The documented cursor protocol: walk until exhausted, collecting pages. */
function walk(store: ResearchStore, order: 'semantic' | 'audit', limit: number): QueryPage[] {
  const pages: QueryPage[] = []
  let afterSeq: number | null = 0
  for (;;) {
    const page = queryEvents(store, 'WS-1', { order, afterSeq: afterSeq ?? 0, limit })
    pages.push(page)
    if (page.exhausted) break
    afterSeq = page.nextAfterSeq
  }
  return pages
}

describe('seq-cursor pagination', () => {
  it('audit order: limit-3 pages over 12 events — exact partition, strict seq increase, self-terminating', () => {
    const store = pagedStore()
    const pages = walk(store, 'audit', 3)
    expect(pages.map(pageIds)).toEqual([
      ['P-1', 'P-2', 'P-3'],
      ['P-4', 'P-5', 'P-6'],
      ['P-7', 'P-8', 'P-9'],
      ['P-10', 'P-11', 'P-12'],
      [],
    ])
    expect(pages.map((p) => p.nextAfterSeq)).toEqual([3, 6, 9, 12, null])
    expect(pages.every((p, i) => (i === pages.length - 1 ? p.exhausted : !p.exhausted))).toBe(true)
    // union == whole log, no duplicates
    const all = pages.flatMap(pageIds)
    expect([...all].sort()).toEqual([...AUDIT_IDS].sort())
    expect(new Set(all).size).toBe(12)
    // each page strictly ascending in seq
    for (const p of pages) {
      const seqs = p.events.map((e) => e.eventSeq)
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    }
  })

  it('semantic order: pages are contiguous AUDIT windows rendered in time order — late events stay in their seq window; union still complete & disjoint', () => {
    const store = pagedStore()
    const pages = walk(store, 'semantic', 3)
    expect(pages.map(pageIds)).toEqual([
      ['P-1', 'P-2', 'P-3'],
      ['P-4', 'P-5', 'P-6'],
      ['P-7', 'P-8', 'P-9'],
      // window (9,12] = P-10 t(10), P-11 t(1.5), P-12 t(5.5) → time order:
      ['P-11', 'P-12', 'P-10'],
      [],
    ])
    // within every page the rows ARE in occurredAt order
    for (const p of pages) {
      const times = p.events.map((e) => e.occurredAt)
      expect(times).toEqual([...times].sort((a, b) => a - b))
    }
    const all = pages.flatMap(pageIds)
    expect([...all].sort()).toEqual([...SEMANTIC_IDS].sort())
    expect(new Set(all).size).toBe(12)
  })

  it('semantic full replay (no limit/cursor) == the fixture timeline', () => {
    const store = pagedStore()
    const page = queryEvents(store, 'WS-1', { order: 'semantic' })
    expect(pageIds(page)).toEqual(SEMANTIC_IDS)
    expect(page.exhausted).toBe(true)
    expect(page.nextAfterSeq).toBeNull()
  })

  it('limit 1: one event per page (13 pages incl. the terminal empty page)', () => {
    const store = pagedStore()
    const pages = walk(store, 'audit', 1)
    expect(pages.length).toBe(13)
    expect(pages.slice(0, 12).map(pageIds)).toEqual(AUDIT_IDS.map((id) => [id]))
    expect(pages[12].events).toEqual([])
    expect(pages[12].exhausted).toBe(true)
  })

  it('explicit beforeSeq window: (after, before) exclusive on both edges; continuation picks up where the window ended', () => {
    const store = pagedStore()
    const w = queryEvents(store, 'WS-1', { order: 'audit', afterSeq: 2, beforeSeq: 8 })
    expect(pageIds(w)).toEqual(['P-3', 'P-4', 'P-5', 'P-6', 'P-7'])
    expect(w.exhausted).toBe(false)
    expect(w.nextAfterSeq).toBe(7) // window (2,8] → upper 7
    // continue WITHOUT beforeSeq: the rest of the log
    const rest = queryEvents(store, 'WS-1', { order: 'audit', afterSeq: 7 })
    expect(pageIds(rest)).toEqual(['P-8', 'P-9', 'P-10', 'P-11', 'P-12'])
    expect(rest.exhausted).toBe(true)
  })

  it('limit combined with beforeSeq: the TIGHTER edge wins', () => {
    const store = pagedStore()
    // beforeSeq=100 (edge 99) vs limit=5 (edge 5) → limit wins
    const p = queryEvents(store, 'WS-1', { order: 'audit', afterSeq: 0, beforeSeq: 100, limit: 5 })
    expect(pageIds(p)).toEqual(['P-1', 'P-2', 'P-3', 'P-4', 'P-5'])
    expect(p.nextAfterSeq).toBe(5)
    // beforeSeq=3 (edge 2) vs limit=50 (edge 50) → beforeSeq wins
    const q = queryEvents(store, 'WS-1', { order: 'audit', afterSeq: 0, beforeSeq: 3, limit: 50 })
    expect(pageIds(q)).toEqual(['P-1', 'P-2'])
    expect(q.exhausted).toBe(false)
    expect(q.nextAfterSeq).toBe(2)
  })

  it('limit > total: single exhausted page with the whole log', () => {
    const store = pagedStore()
    const p = queryEvents(store, 'WS-1', { order: 'audit', limit: 100 })
    expect(pageIds(p)).toEqual(AUDIT_IDS)
    expect(p.exhausted).toBe(true)
    expect(p.nextAfterSeq).toBeNull()
  })

  it('past-the-end cursor: empty exhausted page (self-termination, no count query)', () => {
    const store = pagedStore()
    const p = queryEvents(store, 'WS-1', { order: 'audit', afterSeq: 12 })
    expect(p.events).toEqual([])
    expect(p.exhausted).toBe(true)
    expect(p.nextAfterSeq).toBeNull()
    // same with a limit (short bounded window)
    const q = queryEvents(store, 'WS-1', { order: 'audit', afterSeq: 12, limit: 3 })
    expect(q.events).toEqual([])
    expect(q.exhausted).toBe(true)
  })

  it('log ends INSIDE a bounded window: short page → exhausted (density detection)', () => {
    const store = pagedStore()
    // window (9, 50] holds only P-10, P-11, P-12 (log ends at 12)
    const p = queryEvents(store, 'WS-1', { order: 'audit', afterSeq: 9, limit: 41 })
    expect(pageIds(p)).toEqual(['P-10', 'P-11', 'P-12'])
    expect(p.exhausted).toBe(true)
    expect(p.nextAfterSeq).toBeNull()
  })

  it('window edge exactness: (after, before] with limit far away → exactly beforeSeq-1-after rows', () => {
    const store = pagedStore()
    const p = queryEvents(store, 'WS-1', { order: 'audit', afterSeq: 0, beforeSeq: 4, limit: 100 })
    expect(pageIds(p)).toEqual(['P-1', 'P-2', 'P-3'])
  })

  it('malformed cursors / options → structured REPLAY_INPUT (before any I/O)', () => {
    const store = freshStore()
    const cases: Array<[string, Parameters<typeof queryEvents>[2]]> = [
      ['limit 0', { limit: 0 }],
      ['limit negative', { limit: -1 }],
      ['limit fractional', { limit: 1.5 }],
      ['afterSeq negative', { afterSeq: -1 }],
      ['afterSeq fractional', { afterSeq: 1.5 }],
      ['beforeSeq = afterSeq', { afterSeq: 2, beforeSeq: 2 }],
      ['beforeSeq = afterSeq+1 (empty window)', { afterSeq: 2, beforeSeq: 3 }],
      ['beforeSeq 0', { beforeSeq: 0 }],
      ['bad order', { order: 'bogus' as never }],
    ]
    for (const [name, opts] of cases) {
      expect(
        () => queryEvents(store, 'WS-1', opts),
        name,
      ).toThrow(ReplayInputError)
      try {
        queryEvents(store, 'WS-1', opts)
      } catch (e) {
        expect((e as { code?: string }).code, name).toBe('REPLAY_INPUT')
      }
    }
    expect(() => queryEvents(store, '')).toThrow(ReplayInputError)
  })

  it('empty store: exhausted page immediately', () => {
    const store = freshStore()
    const p = queryEvents(store, 'WS-1', { limit: 5 })
    expect(p.events).toEqual([])
    expect(p.exhausted).toBe(true)
    expect(p.nextAfterSeq).toBeNull()
  })

  it('pagination is deterministic across repeated walks (same pages, both orders)', () => {
    const store = pagedStore()
    const a0 = JSON.stringify(walk(store, 'semantic', 3))
    const b0 = JSON.stringify(walk(store, 'audit', 4))
    expect(JSON.stringify(walk(store, 'semantic', 3))).toBe(a0)
    expect(JSON.stringify(walk(store, 'audit', 4))).toBe(b0)
  })
})
