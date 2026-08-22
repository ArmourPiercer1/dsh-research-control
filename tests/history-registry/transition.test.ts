/**
 * WP-2.2 — transition consistency (INV-HIST-5 / INV-TASK-1, DOMAIN_SCHEMA §13)
 * + the TC-HIST-001 validation half: 「随机序列中注入 from≠当前状态 -> 拒绝
 * 且不产生副作用」.
 *
 * The validator is pure: a rejected mutation changes nothing because the
 * validator has nothing to write. The no-side-effect half is pinned here with
 * a deep-frozen ctx (any mutation attempt would throw in strict mode) plus a
 * byte-identical re-serialization before/after.
 */
import { describe, expect, it } from 'vitest'

import type { EventValidationResult } from '../../src/host/history/registry/index.js'
import { loadHistoryEventRegistry, validateEvent } from '../../src/host/history/registry/index.js'
import { FsReader, T0, WR_HISTORY_SCHEMA_DIR, ctxSnapshot, deepFreeze, envelope, makeCtx, positiveEvent, replaceMap } from './fixtures.js'

const registry = loadHistoryEventRegistry(new FsReader(), WR_HISTORY_SCHEMA_DIR)

function codes(result: EventValidationResult, event?: unknown): string[] {
  if (result.ok) throw new Error(`expected rejection, got ok${event !== undefined ? ` for ${JSON.stringify(event)}` : ''}`)
  return result.errors.map((e) => e.code)
}

/** Asserts the rejection and narrows `result` to the failure branch. */
function codeFor(result: EventValidationResult, code: string): asserts result is Extract<EventValidationResult, { ok: false }> {
  if (result.ok) throw new Error(`expected rejection with ${code}, got ok`)
  if (!result.errors.some((e) => e.code === code)) {
    throw new Error(`expected ${code}, got ${JSON.stringify(result.errors.map((e) => e.code))}`)
  }
}

describe('TC-HIST-001 (validation half) — mutation from ≠ current state ⇒ reject, no side effect', () => {
  it('TASK_EXECUTION_CHANGED with from ≠ current derived state is rejected with FROM_MISMATCH', () => {
    const ctx = makeCtx() // T-1 execution = ACTIVE
    const before = ctxSnapshot(ctx)
    deepFreeze(ctx) // any mutation attempt inside the validator would throw (strict mode)
    const event = envelope('TASK_EXECUTION_CHANGED', { task_id: 'T-1', from: 'PLANNED', to: 'EXECUTED', reason: 'injected stale from' })
    const result = validateEvent(registry, event, ctx)
    codeFor(result, 'FROM_MISMATCH')
    const err = result.errors.find((e) => e.code === 'FROM_MISMATCH')
    expect(err?.path).toBe('/payload/from')
    expect(err?.message).toContain('ACTIVE')
    expect(err?.message).toContain('PLANNED')
    expect(err?.message).toContain('INV-HIST-5')
    // 不产生副作用: the frozen ctx survived (no mutation attempt) and is
    // byte-identical; a second validation over the same frozen ctx agrees.
    expect(ctxSnapshot(ctx)).toBe(before)
    expect(validateEvent(registry, event, ctx)).toEqual(result)
  })

  it('a matching from is accepted (the injected mutation is the ONLY reject case)', () => {
    const ctx = makeCtx() // T-1 execution = ACTIVE
    const ok = validateEvent(registry, envelope('TASK_EXECUTION_CHANGED', { task_id: 'T-1', from: 'ACTIVE', to: 'EXECUTED' }), ctx)
    expect(ok).toEqual({ ok: true, eventType: 'TASK_EXECUTION_CHANGED', ownerWorkstreamId: 'WS-1' })
  })

  it('TASK_VALIDATION_CHANGED from mismatch is rejected (T-1 validation = PENDING)', () => {
    const result = validateEvent(registry, envelope('TASK_VALIDATION_CHANGED', { task_id: 'T-1', from: 'UNDER_REVIEW', to: 'PASSED' }), makeCtx())
    codeFor(result, 'FROM_MISMATCH')
    expect(result.errors.find((e) => e.code === 'FROM_MISMATCH')?.path).toBe('/payload/from')
  })

  it('ACCEPTANCE_CRITERIA_CHANGED from mismatch is rejected (T-1 has 2 ACs; event claims from=[])', () => {
    const result = validateEvent(registry, envelope('ACCEPTANCE_CRITERIA_CHANGED', { task_id: 'T-1', from: [], to: ['AC: one'] }), makeCtx())
    codeFor(result, 'FROM_MISMATCH')
    expect(result.errors.find((e) => e.code === 'FROM_MISMATCH')?.path).toBe('/payload/from')
  })

  it('a late-registered mutation (old occurredAt, high eventSeq) validates identically — seq/occurredAt independence', () => {
    const event = envelope('TASK_EXECUTION_CHANGED', { task_id: 'T-2', from: 'PLANNED', to: 'ACTIVE' }, {
      occurredAt: T0 - 30 * 24 * 3600 * 1000,
      eventSeq: 99,
    })
    expect(validateEvent(registry, event, makeCtx()).ok).toBe(true)
  })
})

describe('WP-2.2 — illegal §13 transitions are rejected (INV-TASK-1)', () => {
  it('ACTIVE → PLANNED (rollback) is illegal', () => {
    const result = validateEvent(registry, envelope('TASK_EXECUTION_CHANGED', { task_id: 'T-1', from: 'ACTIVE', to: 'PLANNED' }), makeCtx())
    codeFor(result, 'ILLEGAL_TRANSITION')
    expect(result.errors.find((e) => e.code === 'ILLEGAL_TRANSITION')?.message).toContain('legal targets from ACTIVE')
  })

  it('EXECUTED is terminal (no outbound transitions)', () => {
    const result = validateEvent(registry, envelope('TASK_EXECUTION_CHANGED', { task_id: 'T-3', from: 'EXECUTED', to: 'ACTIVE' }), makeCtx())
    codeFor(result, 'ILLEGAL_TRANSITION')
    expect(result.errors.find((e) => e.code === 'ILLEGAL_TRANSITION')?.message).toContain('terminal')
  })

  it('CANCELLED execution is terminal', () => {
    const ctx = replaceMap(makeCtx(), 'tasks', new Map([['T-3', { workstreamId: 'WS-2', execution: 'CANCELLED', validation: 'PASSED', acceptanceCriteria: [] }]]))
    const result = validateEvent(registry, envelope('TASK_EXECUTION_CHANGED', { task_id: 'T-3', from: 'CANCELLED', to: 'ACTIVE' }), ctx)
    codeFor(result, 'ILLEGAL_TRANSITION')
  })

  it('validation transitions follow the §13 table (PENDING → PASSED illegal; UNDER_REVIEW → PASSED legal)', () => {
    const bad = validateEvent(registry, envelope('TASK_VALIDATION_CHANGED', { task_id: 'T-2', from: 'PENDING', to: 'PASSED' }), makeCtx())
    codeFor(bad, 'ILLEGAL_TRANSITION')
    const good = validateEvent(registry, envelope('TASK_VALIDATION_CHANGED', { task_id: 'T-1', from: 'PENDING', to: 'UNDER_REVIEW' }), makeCtx())
    expect(good.ok).toBe(true)
  })

  it('re-validation loops are legal (PASSED → PENDING)', () => {
    const result = validateEvent(registry, envelope('TASK_VALIDATION_CHANGED', { task_id: 'T-3', from: 'PASSED', to: 'PENDING' }, { ownerWorkstreamId: 'WS-2' }), makeCtx())
    expect(result.ok).toBe(true)
  })
})

describe('WP-2.2 — implicit-from events (WRONG_STATE on wrong current state)', () => {
  it('RUN_FINISHED requires RUNNING (R-2 is FINISHED)', () => {
    const result = validateEvent(registry, envelope('RUN_FINISHED', { run_id: 'R-2' }), makeCtx())
    codeFor(result, 'WRONG_STATE')
    expect(result.errors.find((e) => e.code === 'WRONG_STATE')?.message).toContain('FINISHED')
  })

  it('RUN_FAILED / RUN_CANCELLED also require RUNNING', () => {
    const failed = validateEvent(registry, envelope('RUN_FAILED', { run_id: 'R-2' }), makeCtx())
    codeFor(failed, 'WRONG_STATE')
    const cancelled = validateEvent(registry, envelope('RUN_CANCELLED', { run_id: 'R-2', cancelled_by: { kind: 'USER' } }), makeCtx())
    codeFor(cancelled, 'WRONG_STATE')
  })

  it('a terminal run cannot be finished twice', () => {
    const result = validateEvent(registry, envelope('RUN_FINISHED', { run_id: 'R-2' }), makeCtx())
    codeFor(result, 'WRONG_STATE')
  })

  it('CLAIM_RETRACTED requires ACTIVE (C-2 is RETRACTED)', () => {
    const result = validateEvent(registry, envelope('CLAIM_RETRACTED', { claim_id: 'C-2' }), makeCtx())
    codeFor(result, 'WRONG_STATE')
  })

  it('ARTIFACT_MARKED_MISSING requires REGISTERED (A-2 is MISSING)', () => {
    const result = validateEvent(registry, envelope('ARTIFACT_MARKED_MISSING', { artifact_id: 'A-2' }), makeCtx())
    codeFor(result, 'WRONG_STATE')
  })

  it('MILESTONE_ACHIEVED requires PLANNED (M-2 is DROPPED; ACHIEVED is terminal)', () => {
    const dropped = validateEvent(registry, envelope('MILESTONE_ACHIEVED', { milestone_id: 'M-2' }), makeCtx())
    codeFor(dropped, 'WRONG_STATE')
    const ctx = replaceMap(makeCtx(), 'milestones', new Map([['M-1', { workstreamId: 'WS-1', status: 'ACHIEVED' }]]))
    const achieved = validateEvent(registry, envelope('MILESTONE_ACHIEVED', { milestone_id: 'M-1' }), ctx)
    codeFor(achieved, 'WRONG_STATE')
  })

  it('RELATION_REMOVED requires ACTIVE (REL-2 is REMOVED)', () => {
    const result = validateEvent(
      registry,
      envelope('RELATION_REMOVED', {
        relation_id: 'REL-2',
        source: { kind: 'CLAIM', id: 'C-1' },
        relation_type: 'SUPPORTED_BY',
        target: { kind: 'FACT', id: 'F-1' },
      }),
      makeCtx(),
    )
    codeFor(result, 'WRONG_STATE')
  })

  it('TOPOLOGY_FORK_REALIZED requires a PLANNED edge (TE-3 is REALIZED)', () => {
    const result = validateEvent(registry, envelope('TOPOLOGY_FORK_REALIZED', { topology_edge_id: 'TE-3', inputs: ['WS-1'], outputs: ['WS-4'] }), makeCtx())
    codeFor(result, 'WRONG_STATE')
  })

  it('GATE_EVALUATED is repeatable from any current state (PLANNED and last-result)', () => {
    const fresh = validateEvent(registry, envelope('GATE_EVALUATED', { gate_id: 'G-1', result: 'FAILED', evaluated_by: { kind: 'USER' } }), makeCtx())
    expect(fresh.ok).toBe(true)
    const again = validateEvent(
      registry,
      envelope('GATE_EVALUATED', { gate_id: 'G-2', result: 'WAIVED', evaluated_by: { kind: 'USER' }, note: 'waived by the team lead' }, { ownerWorkstreamId: 'WS-2' }),
      makeCtx(), // G-2 lastResult = PASSED
    )
    expect(again.ok).toBe(true)
  })

  it('referenced objects that do not exist are OBJECT_NOT_FOUND (never WRONG_STATE)', () => {
    const r1 = validateEvent(registry, envelope('RUN_FINISHED', { run_id: 'R-99' }), makeCtx())
    codeFor(r1, 'OBJECT_NOT_FOUND')
    const r2 = validateEvent(registry, envelope('CLAIM_RETRACTED', { claim_id: 'C-99' }), makeCtx())
    codeFor(r2, 'OBJECT_NOT_FOUND')
    const r3 = validateEvent(registry, envelope('MILESTONE_ACHIEVED', { milestone_id: 'M-99' }), makeCtx())
    codeFor(r3, 'OBJECT_NOT_FOUND')
    const r4 = validateEvent(
      registry,
      envelope('RELATION_REMOVED', { relation_id: 'REL-99', source: { kind: 'TASK', id: 'T-1' }, relation_type: 'DEPENDS_ON', target: { kind: 'TASK', id: 'T-2' } }),
      makeCtx(),
    )
    codeFor(r4, 'OBJECT_NOT_FOUND')
  })
})

describe('WP-2.2 — creation events reject pre-existing ids (新建)', () => {
  it.each([
    ['RUN_STARTED', { run_id: 'R-1', initiated_by: { kind: 'USER' } }, '/payload/run_id'],
    ['FACT_RECORDED', { fact_id: 'F-1', statement: 'dup' }, '/payload/fact_id'],
    ['CLAIM_RECORDED', { claim_id: 'C-1', statement: 'dup' }, '/payload/claim_id'],
    ['ARTIFACT_REGISTERED', { artifact_id: 'A-1', type: 'NOTE', title: 't', uri: 'u' }, '/payload/artifact_id'],
    ['RELATION_ADDED', { relation_id: 'REL-1', source: { kind: 'TASK', id: 'T-1' }, relation_type: 'DEPENDS_ON', target: { kind: 'TASK', id: 'T-2' } }, '/payload/relation_id'],
    ['INTERVENTION_CREATED', { intervention_id: 'IV-1', title: 't', origin: 'USER', source_refs: [{ kind: 'RUN', id: 'R-1' }] }, '/payload/intervention_id'],
  ] as const)('%s rejects an existing id', (type, payload, path) => {
    const event = envelope(type, payload)
    const result = validateEvent(registry, event, makeCtx())
    codeFor(result, 'OBJECT_ALREADY_EXISTS')
    expect(result.errors.find((e) => e.code === 'OBJECT_ALREADY_EXISTS')?.path).toBe(path)
  })

  it('RUNS_STARTED rejects any pre-existing member run', () => {
    const result = validateEvent(
      registry,
      envelope('RUNS_STARTED', { runs: [{ run_id: 'R-1' }, { run_id: 'R-20', task_id: 'T-1' }] }),
      makeCtx(),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'OBJECT_ALREADY_EXISTS' && e.path === '/payload/runs/0/run_id')).toBe(true)
      // the fresh member is not flagged
      expect(result.errors.some((e) => e.path === '/payload/runs/1/run_id')).toBe(false)
    }
  })

  it('positive control: all 20 §5 positives still pass (no false positive from the transition layer)', () => {
    const ctx = makeCtx()
    for (const type of registry.eventTypes) {
      const result = validateEvent(registry, positiveEvent(type), ctx)
      expect(result.ok, `${type}: ${JSON.stringify(result)}`).toBe(true)
    }
  })
})
