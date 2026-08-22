/**
 * WP-2.6 — mapping constructor: ALL forms over fake event windows
 * (TC-DSH-004 「session start/finish 映射 RUN_STARTED/RUN_FINISHED」;
 * DSH_ADAPTER §7 「从 agent/* live 事件 + turn 事件推导起止」;
 * CATALOG §5.1 RUN_STARTED/RUN_FINISHED payloads).
 *
 * The constructor is pure — every case here feeds `SessionWindowInput`
 * directly (no store, no adapter) and pins the exact drafts, the
 * resulting active run, the pointer advance, and the allocation count.
 */

import { describe, expect, it } from 'vitest'

import {
  DISPOSED_CLOSE_SUMMARY,
  LATE_CLOSE_SUMMARY,
  mapSessionWindow,
  type SessionWindowInput,
} from '../../src/host/service/sessionlink/index.js'

const T0 = 1_750_000_000_000

/** A deterministic allocating provider: R-101, R-102, … + call count. */
function makeAllocator() {
  let n = 100
  return {
    allocate: () => {
      n += 1
      return `R-${n}`
    },
    count: () => n - 100,
  }
}

/** The default window (sessionId + clock); `over` carries the case fields. */
const base = (over: Record<string, unknown> = {}): SessionWindowInput =>
  ({ sessionId: 'sess-abc', now: T0, ...over }) as SessionWindowInput

describe('mapSessionWindow — the happy brackets', () => {
  it('one turn (start+end) → RUN_STARTED + RUN_FINISHED, run closed', () => {
    const a = makeAllocator()
    const out = mapSessionWindow(
      base({
        events: [
          { seq: 1, type: 'turn/start', time: T0 + 1 },
          { seq: 3, type: 'turn/end', time: T0 + 5 },
        ],
        allocateRunId: a.allocate,
      }),
    )
    expect(out).not.toBeNull()
    expect(out!.events.map((d) => d.eventType)).toEqual(['RUN_STARTED', 'RUN_FINISHED'])
    expect(out!.events[0].runId).toBe('R-101')
    expect(out!.events[1].runId).toBe('R-101')
    expect(out!.events[0].occurredAt).toBe(T0 + 1)
    expect(out!.events[1].occurredAt).toBe(T0 + 5)
    expect(out!.activeRunId).toBeNull()
    expect(out!.lastSeq).toBe(3)
    expect(a.count()).toBe(1)
  })

  it('RUN_STARTED payload matches the frozen branch (pointer only — INV-DB-2)', () => {
    const a = makeAllocator()
    const out = mapSessionWindow(
      base({ events: [{ seq: 1, type: 'turn/start', time: T0 + 1 }], allocateRunId: a.allocate }),
    )
    expect(out!.events[0].payload).toEqual({
      run_id: 'R-101',
      dsh_session_id: 'sess-abc',
      initiated_by: { kind: 'USER', session_id: 'sess-abc' },
    })
  })

  it('RUN_STARTED payload carries task_id/intent when the binding has them', () => {
    const a = makeAllocator()
    const out = mapSessionWindow(
      base({
        events: [{ seq: 1, type: 'turn/start' }],
        taskId: 'T-7',
        intent: '复现实验 3',
        allocateRunId: a.allocate,
      }),
    )
    expect(out!.events[0].payload).toEqual({
      run_id: 'R-101',
      dsh_session_id: 'sess-abc',
      task_id: 'T-7',
      intent: '复现实验 3',
      initiated_by: { kind: 'USER', session_id: 'sess-abc' },
    })
  })

  it('RUN_FINISHED payload: run_id only (no fabricated summary on a clean end)', () => {
    const a = makeAllocator()
    const out = mapSessionWindow(
      base({
        events: [
          { seq: 1, type: 'turn/start', time: T0 + 1 },
          { seq: 2, type: 'turn/end', time: T0 + 2 },
        ],
        allocateRunId: a.allocate,
      }),
    )
    expect(out!.events[1].payload).toEqual({ run_id: 'R-101' })
  })
})

describe('mapSessionWindow — multi-turn sessions (Task : Run = 1 : N)', () => {
  it('two turns → two independent runs (4 events, ids R-101/R-102)', () => {
    const a = makeAllocator()
    const out = mapSessionWindow(
      base({
        events: [
          { seq: 1, type: 'turn/start', time: T0 + 1 },
          { seq: 2, type: 'turn/end', time: T0 + 2 },
          { seq: 4, type: 'turn/start', time: T0 + 4 },
          { seq: 5, type: 'turn/end', time: T0 + 5 },
        ],
        allocateRunId: a.allocate,
      }),
    )
    expect(out!.events.map((d) => `${d.eventType}:${d.runId}`)).toEqual([
      'RUN_STARTED:R-101',
      'RUN_FINISHED:R-101',
      'RUN_STARTED:R-102',
      'RUN_FINISHED:R-102',
    ])
    expect(out!.activeRunId).toBeNull()
    expect(out!.lastSeq).toBe(5)
    expect(a.count()).toBe(2)
  })

  it('an open turn at window end leaves the run OPEN (activeRunId + startedAt fact)', () => {
    const a = makeAllocator()
    const out = mapSessionWindow(
      base({ events: [{ seq: 9, type: 'turn/start', time: T0 + 9 }], allocateRunId: a.allocate }),
    )
    expect(out!.events.map((d) => d.eventType)).toEqual(['RUN_STARTED'])
    expect(out!.activeRunId).toBe('R-101')
    expect(out!.lastSeq).toBe(9)
  })
})

describe('mapSessionWindow — resume (pointer-carrying windows)', () => {
  it('turn/end with an incoming activeRunId finishes THAT run (no allocation)', () => {
    const a = makeAllocator()
    const out = mapSessionWindow(
      base({
        events: [{ seq: 8, type: 'turn/end', time: T0 + 8 }],
        afterSeq: 7,
        activeRunId: 'R-42',
        allocateRunId: a.allocate,
      }),
    )
    expect(out!.events.map((d) => `${d.eventType}:${d.runId}`)).toEqual(['RUN_FINISHED:R-42'])
    expect(out!.activeRunId).toBeNull()
    expect(out!.lastSeq).toBe(8)
    expect(a.count()).toBe(0)
  })

  it('turn/start over an incoming activeRunId: late close + fresh start (one allocation)', () => {
    const a = makeAllocator()
    const out = mapSessionWindow(
      base({
        events: [{ seq: 10, type: 'turn/start', time: T0 + 10 }],
        afterSeq: 9,
        activeRunId: 'R-42',
        allocateRunId: a.allocate,
      }),
    )
    expect(out!.events.map((d) => `${d.eventType}:${d.runId}`)).toEqual(['RUN_FINISHED:R-42', 'RUN_STARTED:R-101'])
    expect(out!.events[0].payload).toEqual({ run_id: 'R-42', outcome_summary: LATE_CLOSE_SUMMARY })
    expect(out!.activeRunId).toBe('R-101')
    expect(out!.lastSeq).toBe(10)
    expect(a.count()).toBe(1)
  })
})

describe('mapSessionWindow — orphan edges & non-boundary events', () => {
  it('orphan turn/end (no open run) → null', () => {
    const a = makeAllocator()
    const out = mapSessionWindow(base({ events: [{ seq: 1, type: 'turn/end' }], allocateRunId: a.allocate }))
    expect(out).toBeNull()
    expect(a.count()).toBe(0)
  })

  it('non-boundary events only (user/message, assistant/*, tool/*, agent/*) → null', () => {
    const a = makeAllocator()
    const out = mapSessionWindow(
      base({
        events: [
          { seq: 1, type: 'user/message' },
          { seq: 2, type: 'assistant/message' },
          { seq: 3, type: 'tool/call' },
          { seq: 4, type: 'agent/status' },
          { seq: 5, type: 'session/title' },
        ],
        allocateRunId: a.allocate,
      }),
    )
    expect(out).toBeNull()
    expect(a.count()).toBe(0)
  })

  it('empty window → null (and empty + no active run stays null)', () => {
    const a = makeAllocator()
    expect(mapSessionWindow(base({ events: [], allocateRunId: a.allocate }))).toBeNull()
    expect(mapSessionWindow(base({ events: [], activeRunId: 'R-9', allocateRunId: a.allocate }))).toBeNull()
  })
})

describe('mapSessionWindow — the disposed lifecycle edge', () => {
  it('disposed with an open run → forced finish with the mechanical note', () => {
    const a = makeAllocator()
    const out = mapSessionWindow(
      base({
        events: [{ seq: 1, type: 'turn/start', time: T0 + 1 }],
        disposed: true,
        allocateRunId: a.allocate,
      }),
    )
    expect(out!.events.map((d) => d.eventType)).toEqual(['RUN_STARTED', 'RUN_FINISHED'])
    expect(out!.events[1].payload).toEqual({ run_id: 'R-101', outcome_summary: DISPOSED_CLOSE_SUMMARY })
    expect(out!.events[1].occurredAt).toBe(T0) // the window's now (the edge carries no time)
    expect(out!.activeRunId).toBeNull()
  })

  it('disposed with NO open run → null (nothing to close)', () => {
    const a = makeAllocator()
    const out = mapSessionWindow(base({ events: [], disposed: true, allocateRunId: a.allocate }))
    expect(out).toBeNull()
  })
})

describe('mapSessionWindow — idempotency gate (seq <= afterSeq rejected)', () => {
  it('re-delivered turn/start at/under afterSeq → null (no duplicate start)', () => {
    const a = makeAllocator()
    const out = mapSessionWindow(
      base({ events: [{ seq: 5, type: 'turn/start' }], afterSeq: 5, allocateRunId: a.allocate }),
    )
    expect(out).toBeNull()
    expect(a.count()).toBe(0)
  })

  it('a lower seq than afterSeq is rejected even for a NEW boundary', () => {
    const a = makeAllocator()
    const out = mapSessionWindow(
      base({
        events: [
          { seq: 3, type: 'turn/start' }, // rejected (afterSeq = 4)
          { seq: 6, type: 'turn/start' }, // processed
        ],
        afterSeq: 4,
        allocateRunId: a.allocate,
      }),
    )
    expect(out!.events.map((d) => d.eventType)).toEqual(['RUN_STARTED'])
    expect(out!.lastSeq).toBe(6)
    expect(a.count()).toBe(1)
  })
})

describe('mapSessionWindow — occurredAt fallbacks & determinism', () => {
  it('events without projected time fall back to `now`', () => {
    const a = makeAllocator()
    const out = mapSessionWindow(
      base({
        events: [
          { seq: 1, type: 'turn/start' },
          { seq: 2, type: 'turn/end' },
        ],
        allocateRunId: a.allocate,
      }),
    )
    expect(out!.events.map((d) => d.occurredAt)).toEqual([T0, T0])
  })

  it('is deterministic: the same input yields byte-identical outputs', () => {
    const make = () =>
      base({
        events: [
          { seq: 1, type: 'turn/start', time: T0 + 1 },
          { seq: 2, type: 'turn/end' },
          { seq: 3, type: 'user/message' },
          { seq: 4, type: 'turn/start' },
        ],
        afterSeq: 0,
        activeRunId: null,
        disposed: false,
      })
    const run = (input: Parameters<typeof mapSessionWindow>[0]) => {
      const a = makeAllocator()
      const out = mapSessionWindow({ ...input, allocateRunId: a.allocate })
      return { out, allocations: a.count() }
    }
    const first = run(make())
    const second = run(make())
    expect(JSON.stringify(first.out)).toBe(JSON.stringify(second.out))
    expect(first.allocations).toBe(second.allocations)
  })
})

describe('mapSessionWindow — input guards (pure function boundary)', () => {
  it('rejects an empty sessionId', () => {
    expect(() => mapSessionWindow(base({ sessionId: '', events: [], allocateRunId: () => 'R-1' }))).toThrow(TypeError)
  })

  it('rejects a non-finite now', () => {
    expect(() => mapSessionWindow(base({ now: Number.NaN, events: [], allocateRunId: () => 'R-1' }))).toThrow(TypeError)
  })

  it('rejects a negative afterSeq', () => {
    expect(() => mapSessionWindow(base({ afterSeq: -1, events: [], allocateRunId: () => 'R-1' }))).toThrow(TypeError)
  })
})
