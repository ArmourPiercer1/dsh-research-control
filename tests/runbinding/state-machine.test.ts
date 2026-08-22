/**
 * WP-2.4 — state-machine conformance: the FULL frozen §13 matrices,
 * pinned literal-for-literal against DOMAIN_SCHEMA §13 L549/L554:
 *
 *   Run:              RUNNING → FINISHED | FAILED | CANCELLED (terminal)
 *   DiscoveredSession: PENDING → BOUND | DETACHED | IGNORED (terminal)
 *
 * The run machine reuses the WP-2.2 frozen table (single source — no
 * local copy to drift); the DS machine is coded in
 * state-machine.ts (the DS row has no HistoryEvent, so the registry
 * table does not carry it). Both matrices are asserted exhaustively
 * (16 pairs each), plus the service-level guards (RB_RUN_NOT_RUNNING /
 * RB_DS_NOT_PENDING messages name the §13 rule).
 */
import { describe, expect, it } from 'vitest'

import { LEGAL_TRANSITIONS } from '../../src/host/history/registry/index.js'
import type { RunStatus } from '../../src/host/history/registry/index.js'
import {
  DS_TRANSITIONS,
  RunBindingError,
  assertDsCanMove,
  assertRunCanBeEnded,
  isLegalDsTransition,
  isLegalRunTransition,
  legalDsTargets,
  legalRunTargets,
} from '../../src/host/service/runbinding/index.js'
import { makeHarness, seedPendingDs } from './helpers.js'

const RUN_STATES: readonly RunStatus[] = ['RUNNING', 'FINISHED', 'FAILED', 'CANCELLED']
const DS_STATES = ['PENDING', 'BOUND', 'DETACHED', 'IGNORED'] as const

describe('Run machine matrix (frozen §13 L549 — 16 pairs pinned)', () => {
  // The frozen §13 L549 row, literal: RUNNING → FINISHED|FAILED|CANCELLED;
  // every other pair is illegal (terminals are terminal; RUNNING→RUNNING
  // is not a transition).
  const FROZEN: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
    RUNNING: ['FINISHED', 'FAILED', 'CANCELLED'],
    FINISHED: [],
    FAILED: [],
    CANCELLED: [],
  }

  for (const from of RUN_STATES) {
    for (const to of RUN_STATES) {
      it(`${from} → ${to} : ${FROZEN[from].includes(to) ? 'legal' : 'illegal'}`, () => {
        expect(isLegalRunTransition(from, to)).toBe(FROZEN[from].includes(to))
        // The local table reuses the registry's frozen table (drift-free).
        expect(LEGAL_TRANSITIONS.run[from]).toEqual(FROZEN[from])
      })
    }
  }

  it('legalRunTargets exposes the frozen targets', () => {
    expect(legalRunTargets('RUNNING')).toEqual(['FINISHED', 'FAILED', 'CANCELLED'])
    expect(legalRunTargets('FINISHED')).toEqual([])
    expect(legalRunTargets('FAILED')).toEqual([])
    expect(legalRunTargets('CANCELLED')).toEqual([])
  })

  it('assertRunCanBeEnded: the service guard (message names the §13 rule)', () => {
    expect(() => assertRunCanBeEnded('RUNNING', 'FINISHED')).not.toThrow()
    expect(() => assertRunCanBeEnded('RUNNING', 'FAILED')).not.toThrow()
    expect(() => assertRunCanBeEnded('RUNNING', 'CANCELLED')).not.toThrow()
    for (const from of ['FINISHED', 'FAILED', 'CANCELLED'] as const) {
      for (const to of ['FINISHED', 'FAILED', 'CANCELLED'] as const) {
        try {
          assertRunCanBeEnded(from, to)
          throw new Error(`expected ${from}→${to} to throw`)
        } catch (e) {
          if (e instanceof RunBindingError) {
            expect(e.code).toBe('RB_RUN_NOT_RUNNING')
            expect(e.message).toContain('§13')
          } else {
            throw e
          }
        }
      }
    }
  })
})

describe('DiscoveredSession machine matrix (frozen §13 L554 — 16 pairs pinned)', () => {
  // The frozen §13 L554 row, literal: PENDING → BOUND|DETACHED|IGNORED;
  // all three targets terminal; PENDING→PENDING is not a transition.
  const FROZEN: Readonly<Record<string, readonly string[]>> = {
    PENDING: ['BOUND', 'DETACHED', 'IGNORED'],
    BOUND: [],
    DETACHED: [],
    IGNORED: [],
  }

  for (const from of DS_STATES) {
    for (const to of DS_STATES) {
      it(`${from} → ${to} : ${FROZEN[from].includes(to) ? 'legal' : 'illegal'}`, () => {
        expect(isLegalDsTransition(from, to)).toBe(FROZEN[from].includes(to))
        expect(DS_TRANSITIONS[from]).toEqual(FROZEN[from])
      })
    }
  }

  it('legalDsTargets exposes the frozen targets', () => {
    expect(legalDsTargets('PENDING')).toEqual(['BOUND', 'DETACHED', 'IGNORED'])
    expect(legalDsTargets('BOUND')).toEqual([])
    expect(legalDsTargets('DETACHED')).toEqual([])
    expect(legalDsTargets('IGNORED')).toEqual([])
  })

  it('assertDsCanMove: the service guard (message names the §13 rule)', () => {
    for (const to of ['BOUND', 'DETACHED', 'IGNORED'] as const) {
      expect(() => assertDsCanMove('PENDING', to)).not.toThrow()
    }
    try {
      assertDsCanMove('PENDING', 'PENDING' as never)
      throw new Error('expected PENDING→PENDING to throw')
    } catch (e) {
      if (e instanceof RunBindingError) {
        expect(e.code).toBe('RB_DS_NOT_PENDING')
        expect(e.message).toContain('§13')
      } else {
        throw e
      }
    }
    for (const from of ['BOUND', 'DETACHED', 'IGNORED'] as const) {
      for (const to of ['BOUND', 'DETACHED', 'IGNORED'] as const) {
        try {
          assertDsCanMove(from, to)
          throw new Error(`expected ${from}→${to} to throw`)
        } catch (e) {
          if (e instanceof RunBindingError) expect(e.code).toBe('RB_DS_NOT_PENDING')
          else throw e
        }
      }
    }
  })
})

describe('DS machine through the service (all three PENDING exits + terminal locks)', () => {
  it('PENDING → BOUND via BIND (the event-producing exit)', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'sm-bind' })
    const result = h.service.bindDiscoveredSession(ds.id, { workstreamId: 'WS-1' })
    expect(result.ds.state).toBe('BOUND')
    expect(result.ds.bound_run_id).toBe(result.run.id)
    h.close()
  })

  it('PENDING → DETACHED via DETACH (row-only exit)', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'sm-detach' })
    expect(h.service.detachDiscoveredSession(ds.id).state).toBe('DETACHED')
    h.close()
  })

  it('PENDING → IGNORED via IGNORE (row-only exit)', () => {
    const h = makeHarness()
    const ds = seedPendingDs(h, { sessionId: 'sm-ignore' })
    expect(h.service.ignoreDiscoveredSession(ds.id).state).toBe('IGNORED')
    h.close()
  })

  it('each terminal locks all three operations (full cross-product)', () => {
    const h = makeHarness()
    const bound = seedPendingDs(h, { sessionId: 'sm-lock-b' })
    h.service.bindDiscoveredSession(bound.id, { workstreamId: 'WS-1' })
    const detached = seedPendingDs(h, { sessionId: 'sm-lock-d' })
    h.service.detachDiscoveredSession(detached.id)
    const ignored = seedPendingDs(h, { sessionId: 'sm-lock-i' })
    h.service.ignoreDiscoveredSession(ignored.id)

    const ops: Array<(id: string) => void> = [
      (id) => h.service.bindDiscoveredSession(id, { workstreamId: 'WS-2' }),
      (id) => h.service.detachDiscoveredSession(id),
      (id) => h.service.ignoreDiscoveredSession(id),
    ]
    for (const dsId of [bound.id, detached.id, ignored.id]) {
      for (const op of ops) {
        try {
          op(dsId)
          throw new Error(`expected ${dsId} to reject`)
        } catch (e) {
          if (e instanceof RunBindingError) expect(e.code).toBe('RB_DS_NOT_PENDING')
          else throw e
        }
      }
    }
    // States are immutable after the locks.
    expect(h.service.getDiscoveredSession(bound.id)?.state).toBe('BOUND')
    expect(h.service.getDiscoveredSession(detached.id)?.state).toBe('DETACHED')
    expect(h.service.getDiscoveredSession(ignored.id)?.state).toBe('IGNORED')
    h.close()
  })
})
