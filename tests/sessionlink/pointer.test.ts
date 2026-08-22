/**
 * WP-2.6 — pointer-row codec (the INV-DB-2 mapping table value): strict
 * encode/decode round trip, the key namespace, and the STATE_CORRUPT
 * fail-loud paths (a malformed row must never be half-consumed).
 */

import { describe, expect, it } from 'vitest'

import {
  decodePointer,
  encodePointer,
  isSessionLinkError,
  pointerKey,
  SessionLinkError,
  type SessionPointer,
} from '../../src/host/service/sessionlink/index.js'

const BASE: SessionPointer = {
  workstreamId: 'WS-1',
  lastSeq: 42,
  runId: 'R-7',
  runStartedAt: 1_750_000_000_000,
}

describe('pointerKey — the meta KV namespace', () => {
  it('is stable and session-scoped (disjoint from the id-counter namespace)', () => {
    expect(pointerKey('sess-1')).toBe('sessionlink:pointer:sess-1')
    expect(pointerKey('a').startsWith('id-counter:')).toBe(false)
  })
})

describe('encode/decode round trip', () => {
  it('round-trips the full shape (open run)', () => {
    const raw = encodePointer(BASE)
    expect(JSON.parse(raw)).toEqual({
      workstreamId: 'WS-1',
      lastSeq: 42,
      runId: 'R-7',
      runStartedAt: 1_750_000_000_000,
    })
    expect(decodePointer(raw, 'sess-1')).toEqual(BASE)
  })

  it('round-trips the fresh shape (no open run, no optional fields)', () => {
    const pointer: SessionPointer = { workstreamId: 'WS-2', lastSeq: 0, runId: null, runStartedAt: null }
    expect(decodePointer(encodePointer(pointer), 'sess-2')).toEqual(pointer)
  })

  it('round-trips the optional binding fields (intent/taskId)', () => {
    const pointer: SessionPointer = {
      workstreamId: 'WS-1',
      intent: '复现实验 3',
      taskId: 'T-9',
      lastSeq: 3,
      runId: null,
      runStartedAt: null,
    }
    expect(decodePointer(encodePointer(pointer), 'sess-1')).toEqual(pointer)
  })
})

describe('decodePointer — the STATE_CORRUPT fail-loud paths', () => {
  const cases: Array<[string, unknown]> = [
    ['not valid JSON', '{workstreamId: WS-1'],
    ['a JSON array', '[1, 2]'],
    ['a JSON string', '"WS-1"'],
    ['null', 'null'],
    ['missing workstreamId', '{"lastSeq":0,"runId":null,"runStartedAt":null}'],
    ['empty workstreamId', '{"workstreamId":"","lastSeq":0,"runId":null,"runStartedAt":null}'],
    ['non-integer lastSeq', '{"workstreamId":"WS-1","lastSeq":1.5,"runId":null,"runStartedAt":null}'],
    ['negative lastSeq', '{"workstreamId":"WS-1","lastSeq":-1,"runId":null,"runStartedAt":null}'],
    ['runId without runStartedAt (broken binding pair)', '{"workstreamId":"WS-1","lastSeq":0,"runId":"R-1","runStartedAt":null}'],
    ['runStartedAt without runId (broken binding pair)', '{"workstreamId":"WS-1","lastSeq":0,"runId":null,"runStartedAt":5}'],
    ['empty runId string', '{"workstreamId":"WS-1","lastSeq":0,"runId":"","runStartedAt":5}'],
  ]

  it.each(cases)('rejects %s', (_label, raw) => {
    const e = throws(() => decodePointer(String(raw), 'sess-1'))
    expect(isSessionLinkError(e)).toBe(true)
    expect((e as SessionLinkError).code).toBe('STATE_CORRUPT')
  })
})

/** Run `fn`, returning the thrown value (the repo's toThrow takes a CLASS,
 *  not a predicate; code-level checks need the error value itself). */
function throws(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('expected the call to throw, but it returned')
}

describe('encodePointer — the codec boundary', () => {
  it('rejects a row with a broken runId/runStartedAt pair (TypeError at the boundary)', () => {
    expect(() =>
      encodePointer({ workstreamId: 'WS-1', lastSeq: 0, runId: 'R-1', runStartedAt: null }),
    ).toThrow(TypeError)
  })

  it('rejects a negative lastSeq (TypeError at the boundary)', () => {
    expect(() => encodePointer({ workstreamId: 'WS-1', lastSeq: -2, runId: null, runStartedAt: null })).toThrow(TypeError)
  })
})
