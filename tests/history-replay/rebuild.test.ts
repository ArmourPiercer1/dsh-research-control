/**
 * WP-2.3 — derived_state rebuild (TC-HIST-006「空 DB 重放全部事件 -> 所有
 * 派生列与原状态一致；重放不产生新事件」; TC-DB-002 的派生列重建能力声明)
 * + the rebuild-vs-incremental consistency verification framework.
 *
 * Model: the REAL temp store carries a 2-workstream stream (10 events,
 * one per-owner RUNS_STARTED batch, one LATE registration) appended
 * incrementally — one event per batch, each with its reducer delta as
 * `derivedState` patches (「与事件 append 同事务写入」, DOMAIN_SCHEMA §15),
 * in canonical audit order (the consistency precondition documented on
 * `rebuildDerivedState`).
 */
import { describe, expect, it } from 'vitest'

import {
  compareDerivedStates,
  foldEvents,
  readDerivedState,
  rebuildDerivedState,
  collectAllEvents,
  ReplayApplyError,
  ReplayInputError,
  ReplayStateError,
  type DerivedStateMap,
} from '../../src/host/history/replay/index.js'
import type { ResearchStore } from '../../src/host/persistence/store/index.js'
import {
  appendIncrementally,
  canonicalMapJson,
  dbPath,
  LATE_OCCURRED_AT,
  makePeekingClock,
  makeTestReducer,
  makeTempDir,
  rawDb,
  REBUILD_EVENTS,
  REBUILD_WORKSTREAMS,
  snapshotEventLines,
} from './helpers.js'
import { openDatabase } from '../../src/host/persistence/store/index.js'

/** Fresh store + incremental append of the canonical stream. Returns
 *  (store, the incrementally maintained map). */
function incrementalSetup(): [ResearchStore, DerivedStateMap] {
  const dir = makeTempDir()
  const clock = makePeekingClock()
  const store = openDatabase(dbPath(dir), { now: clock.now })
  const reducer = makeTestReducer()
  const incremental = appendIncrementally(store, REBUILD_EVENTS, reducer, clock)
  return [store, incremental]
}

/** Simulate the TC-DB-002 corruption shape: event table INTACT,
 *  derived_state table LOST (raw connection; the table is deliberately
 *  updatable — it is a rebuildable cache, not identity, WP-2.1 schema). */
function corruptDerivedTable(store: ResearchStore): void {
  const raw = rawDb(store.path)
  try {
    raw.exec('DELETE FROM derived_state')
  } finally {
    raw.close()
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>
}

describe('rebuildDerivedState — TC-HIST-006 / TC-DB-002 派生列重建', () => {
  it('incremental maintenance itself equals the audit-order fold (harness sanity)', () => {
    const [store, incremental] = incrementalSetup()
    const folded = foldEvents(collectAllEvents(store, REBUILD_WORKSTREAMS, 'audit'), makeTestReducer(), new Map())
    expect(canonicalMapJson(folded)).toBe(canonicalMapJson(incremental))
  })

  it('TC-HIST-006: lost derived_state rebuilt from the event log — all rows match the original state', () => {
    const [store, incremental] = incrementalSetup()
    // the incremental table is live in the store (read face of the cache)
    expect(canonicalMapJson(readDerivedState(store))).toBe(canonicalMapJson(incremental))

    const beforeLines = snapshotEventLines(store, REBUILD_WORKSTREAMS)
    corruptDerivedTable(store)
    expect(readDerivedState(store).size).toBe(0)

    const reducer = makeTestReducer()
    const result = rebuildDerivedState(store, REBUILD_WORKSTREAMS, reducer)

    expect(result.applied).toBe(true)
    expect(result.eventCount).toBe(REBUILD_EVENTS.length)
    expect(result.replacedRows).toBe(incremental.size)
    expect(result.maxSeqByWorkstream).toEqual({ 'WS-1': 8, 'WS-2': 2 })

    // all derived rows match the original (incremental) state — canonical
    // deep equality per row
    const rebuiltTable = readDerivedState(store)
    expect(canonicalMapJson(rebuiltTable)).toBe(canonicalMapJson(incremental))
    // …and via the consistency framework:
    expect(compareDerivedStates(result.states, incremental)).toMatchObject({ ok: true, onlyInRebuilt: [], onlyInIncremental: [], differing: [] })
    // spot-check the late-affected row: the late pause (appended last,
    // earliest time) IS the current execution state
    const task = asRecord(result.states.get('task:T-1'))
    expect(task.execution).toBe('PAUSED')
    expect(task.trail).toEqual(['H-2', 'H-5', 'H-10']) // execution + validation + late pause, audit order

    // replay produced NO new events: the event table is byte-identical
    expect(snapshotEventLines(store, REBUILD_WORKSTREAMS)).toEqual(beforeLines)
  })

  it('the rebuild is idempotent: two rebuilds are deep-equal and the table is stable', () => {
    const [store, incremental] = incrementalSetup()
    corruptDerivedTable(store)
    const r1 = rebuildDerivedState(store, REBUILD_WORKSTREAMS, makeTestReducer())
    const r2 = rebuildDerivedState(store, REBUILD_WORKSTREAMS, makeTestReducer())
    expect(canonicalMapJson(r2.states)).toBe(canonicalMapJson(r1.states))
    expect(canonicalMapJson(readDerivedState(store))).toBe(canonicalMapJson(incremental))
    expect(r2.eventCount).toBe(r1.eventCount)
    expect(r2.maxSeqByWorkstream).toEqual(r1.maxSeqByWorkstream)
  })

  it('apply: false — pure in-memory rebuild, the table is untouched', () => {
    const [store, incremental] = incrementalSetup()
    corruptDerivedTable(store)
    const result = rebuildDerivedState(store, REBUILD_WORKSTREAMS, makeTestReducer(), { apply: false })
    expect(result.applied).toBe(false)
    expect(result.replacedRows).toBe(0)
    expect(canonicalMapJson(result.states)).toBe(canonicalMapJson(incremental))
    // the table is STILL empty (nothing was written)
    expect(readDerivedState(store).size).toBe(0)
    // …and a subsequent apply:true restore works
    rebuildDerivedState(store, REBUILD_WORKSTREAMS, makeTestReducer())
    expect(canonicalMapJson(readDerivedState(store))).toBe(canonicalMapJson(incremental))
  })

  it('the rebuild is pinned to the AUDIT order: a semantic replay would rebuild a DIFFERENT (from-inconsistent) state', () => {
    const [store, incremental] = incrementalSetup()
    const reducer = makeTestReducer()

    const audit = rebuildDerivedState(store, REBUILD_WORKSTREAMS, reducer, { apply: false })
    const semantic = foldEvents(collectAllEvents(store, REBUILD_WORKSTREAMS, 'semantic'), reducer, new Map())

    // audit (registration order): H-2 (PLANNED→ACTIVE) precedes the LATE
    // H-10 (ACTIVE→PAUSED) → current execution PAUSED, from-consistent
    expect(asRecord(audit.states.get('task:T-1')).execution).toBe('PAUSED')
    expect(asRecord(incremental.get('task:T-1')).execution).toBe('PAUSED')
    // semantic (research time order): the late event applies BEFORE H-2 →
    // ACTIVE — exactly why §6 pins the rebuild to audit order (INV-HIST-5)
    expect(asRecord(semantic.get('task:T-1')).execution).toBe('ACTIVE')
    expect(asRecord(semantic.get('task:T-1')).trail).toEqual(['H-10', 'H-2', 'H-5'])
    expect(canonicalMapJson(semantic)).not.toBe(canonicalMapJson(audit.states))
  })

  it('the late registration lands at its audit position in the rebuild (seq 8 on WS-1, not its time position)', () => {
    const [store] = incrementalSetup()
    const result = rebuildDerivedState(store, REBUILD_WORKSTREAMS, makeTestReducer(), { apply: false })
    const task = asRecord(result.states.get('task:T-1'))
    expect(task.lastEventId).toBe('H-10')
    expect(task.lastEventSeq).toBe(8)
    expect(task.lastOccurredAt).toBe(LATE_OCCURRED_AT)
  })

  it('cross-WS batch semantics: the per-owner RUNS_STARTED rows both contribute; R-3 ends FAILED via its WS-2 end event', () => {
    const [store, incremental] = incrementalSetup()
    corruptDerivedTable(store)
    const result = rebuildDerivedState(store, REBUILD_WORKSTREAMS, makeTestReducer())
    const r2 = asRecord(result.states.get('run:R-2'))
    const r3 = asRecord(result.states.get('run:R-3'))
    expect(r2.status).toBe('RUNNING') // batch-started, never ended
    expect(r2.trail).toEqual(['H-4']) // one logical batch start per run (per-owner duplicate idempotent)
    expect(r3.status).toBe('FAILED')
    expect(r3.failureKind).toBe('OOM')
    expect(r3.trail).toEqual(['H-4', 'H-8']) // start, then the WS-2 end; the per-owner duplicate is idempotent
    // identical to the incremental table
    expect(compareDerivedStates(result.states, incremental).ok).toBe(true)
  })
})

describe('compareDerivedStates — the consistency verification framework', () => {
  it('detects a changed value, a lost row, and an extra row — localized by key', () => {
    const [, incremental] = incrementalSetup()
    const rebuilt = new Map(incremental)

    // 1) a changed value
    const tamperedValue = new Map(incremental)
    tamperedValue.set('task:T-1', { ...asRecord(incremental.get('task:T-1')), execution: 'ACTIVE' })
    expect(compareDerivedStates(tamperedValue, incremental)).toMatchObject({
      ok: false,
      differing: [{ key: 'task:T-1' }],
      onlyInRebuilt: [],
      onlyInIncremental: [],
    })

    // 2) a lost row (incremental missing a key the rebuild has)
    const lostRow = new Map(incremental)
    lostRow.delete('run:R-3')
    expect(compareDerivedStates(incremental, lostRow)).toMatchObject({
      ok: false,
      onlyInRebuilt: ['run:R-3'],
      onlyInIncremental: [],
      differing: [],
    })

    // 3) an extra row (incremental has a key the rebuild lacks)
    const extraRow = new Map(incremental)
    extraRow.set('run:R-9', { status: 'GHOST' })
    expect(compareDerivedStates(incremental, extraRow)).toMatchObject({
      ok: false,
      onlyInIncremental: ['run:R-9'],
      onlyInRebuilt: [],
      differing: [],
    })

    // 4) identical (incl. JSON key-order insensitivity) → ok
    const reordered = new Map(incremental)
    reordered.set('run:R-1', { z: 1, a: 2, m: { y: 1, b: [1, 2] } })
    const reorderedClone = new Map(reordered)
    reorderedClone.set('run:R-1', { a: 2, z: 1, m: { b: [1, 2], y: 1 } })
    expect(compareDerivedStates(reordered, reorderedClone)).toMatchObject({ ok: true, differing: [], onlyInRebuilt: [], onlyInIncremental: [] })
    expect(rebuilt.size).toBe(incremental.size)
  })

  it('reports counts and is deterministic (same report across calls)', () => {
    const [, incremental] = incrementalSetup()
    const a = compareDerivedStates(incremental, incremental)
    const b = compareDerivedStates(incremental, incremental)
    expect(a).toEqual(b)
    expect(a.ok).toBe(true)
    expect(a.rebuiltCount).toBe(incremental.size)
    expect(a.incrementalCount).toBe(incremental.size)
  })
})

describe('rebuild error paths (structured, no partial writes)', () => {
  it('a malformed reducer key (no separator / empty part / double separator) → REPLAY_STATE, table untouched', () => {
    const [store, incremental] = incrementalSetup()
    const badKeys: Array<() => DerivedStateMap> = [
      () => new Map([['runR-1', { x: 1 }]]),
      () => new Map([[':R-1', { x: 1 }]]),
      () => new Map([['run:', { x: 1 }]]),
      () => new Map([['run:a:b', { x: 1 }]]),
    ]
    for (const make of badKeys) {
      expect(
        () => rebuildDerivedState(store, REBUILD_WORKSTREAMS, () => make()),
      ).toThrow(ReplayStateError)
    }
    // the healthy table survived all attempts (wholesale replace is all-or-nothing)
    expect(canonicalMapJson(readDerivedState(store))).toBe(canonicalMapJson(incremental))
  })

  it('a non-strict-JSON reducer value (NaN / Date / non-plain) → REPLAY_STATE', () => {
    const [store, incremental] = incrementalSetup()
    const badValues: Array<unknown> = [Number.NaN, new Date(0), new Map([['k', 1]])]
    for (const value of badValues) {
      const reducer = () => new Map([['run:R-X', value]])
      expect(() => rebuildDerivedState(store, REBUILD_WORKSTREAMS, reducer)).toThrow(ReplayStateError)
    }
    expect(canonicalMapJson(readDerivedState(store))).toBe(canonicalMapJson(incremental))
  })

  it('a throwing reducer propagates UNCHANGED; the table is untouched', () => {
    const [store, incremental] = incrementalSetup()
    const sentinel = new Error('reducer boom')
    expect(() =>
      rebuildDerivedState(store, REBUILD_WORKSTREAMS, () => {
        throw sentinel
      }),
    ).toThrow(sentinel)
    expect(canonicalMapJson(readDerivedState(store))).toBe(canonicalMapJson(incremental))
  })

  it('malformed store face / workstreams / reducer → REPLAY_INPUT (before any I/O)', () => {
    const [store] = incrementalSetup()
    const reducer = makeTestReducer()
    expect(() => rebuildDerivedState({ path: '', listRange: store.listRange }, REBUILD_WORKSTREAMS, reducer)).toThrow(ReplayInputError)
    expect(() => rebuildDerivedState(store, [], reducer)).not.toThrow() // empty list is legal (below)
    expect(() => rebuildDerivedState(store, [''], reducer)).toThrow(ReplayInputError)
    expect(() => rebuildDerivedState(store, REBUILD_WORKSTREAMS, 'nope' as never)).toThrow(ReplayInputError)
    expect(() => readDerivedState({ path: '' })).toThrow(ReplayInputError)
  })
})

describe('workstream-list semantics (wholesale replace — the list is AUTHORITATIVE)', () => {
  it('unknown workstreams are tolerated (contribute nothing)', () => {
    const [store, incremental] = incrementalSetup()
    const result = rebuildDerivedState(store, [...REBUILD_WORKSTREAMS, 'WS-9'], makeTestReducer(), { apply: false })
    expect(result.eventCount).toBe(REBUILD_EVENTS.length)
    expect(canonicalMapJson(result.states)).toBe(canonicalMapJson(incremental))
  })

  it('an INCOMPLETE list silently drops the missing workstreams’ contribution (the documented hazard — detected by the framework)', () => {
    const [store, incremental] = incrementalSetup()
    // R-3's FAILED status comes ONLY from H-8 (a WS-2 event); without WS-2
    // the rebuild sees only the batch-start → RUNNING
    const partial = rebuildDerivedState(store, ['WS-1'], makeTestReducer(), { apply: false })
    expect(asRecord(partial.states.get('run:R-3')).status).toBe('RUNNING')
    const report = compareDerivedStates(partial.states, incremental)
    expect(report.ok).toBe(false)
    // run:R-3 differs in STATUS (RUNNING vs FAILED — the WS-2 end event is
    // gone); run:R-2 differs in the trail (its batch-start row H-4 was a
    // WS-2 row — the partial rebuild starts it from H-3 instead)
    expect(report.differing.map((d) => d.key)).toEqual(['run:R-2', 'run:R-3'])
    // the live table was NOT touched (apply: false)
    expect(canonicalMapJson(readDerivedState(store))).toBe(canonicalMapJson(incremental))
  })

  it('an empty list rebuilds to the EMPTY state; apply:true wipes the cache (wholesale semantics)', () => {
    const [store] = incrementalSetup()
    const result = rebuildDerivedState(store, [], makeTestReducer())
    expect(result.states.size).toBe(0)
    expect(result.replacedRows).toBe(0)
    expect(readDerivedState(store).size).toBe(0)
  })

  it('a failed apply (missing DB file) → REPLAY_APPLY with cause; the store itself is unaffected', () => {
    const [store] = incrementalSetup()
    expect(() =>
      rebuildDerivedState(
        { path: dbPath(makeTempDir()), listRange: store.listRange },
        REBUILD_WORKSTREAMS,
        makeTestReducer(),
      ),
    ).toThrow(ReplayApplyError)
    // the real store is untouched
    expect(readDerivedState(store).size).toBeGreaterThan(0)
  })
})

describe('readDerivedState', () => {
  it('reads the live cache and is repeatable / non-mutating', () => {
    const [store, incremental] = incrementalSetup()
    const r1 = readDerivedState(store)
    const r2 = readDerivedState(store)
    expect(canonicalMapJson(r1)).toBe(canonicalMapJson(incremental))
    expect(canonicalMapJson(r2)).toBe(canonicalMapJson(incremental))
    // the table is unchanged by the reads
    expect(canonicalMapJson(readDerivedState(store))).toBe(canonicalMapJson(incremental))
  })
})
