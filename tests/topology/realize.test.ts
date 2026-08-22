/**
 * WP-1.4 — validateRealize: the TOPOLOGY_FORK/MERGE_REALIZED pre-check
 * (HISTORY_EVENT_CATALOG §5.8 「校验与副作用」) — full form matrix:
 * reference missing / not-PLANNED / FORK multi-input / MERGE multi-output /
 * aggregation / normal. Pure function: takes a topology document, writes
 * nothing, emits no events (Phase 2 calls it before emission).
 */
import { describe, expect, it } from 'vitest'

import { validateRealize } from '../../src/host/domain/topology/index.js'
import type { TopologyEdgeDoc } from '../../src/host/domain/loader/index.js'
import { makeDoc } from './fixtures.js'

const edge = (over: Partial<TopologyEdgeDoc> & { id: string }): TopologyEdgeDoc => ({
  topic_id: 'TPC-1',
  operation: 'FORK',
  lifecycle: 'PLANNED',
  inputs: ['WS-1'],
  outputs: ['WS-2'],
  ...over,
})

describe('validateRealize — normal forms pass', () => {
  it('FORK with exactly 1 input (typical 1→N) passes', () => {
    const doc = makeDoc([edge({ id: 'TE-1', outputs: ['WS-2', 'WS-3'] })])
    expect(validateRealize(doc, 'TE-1')).toEqual({ ok: true, issues: [] })
  })

  it('MERGE with exactly 1 output (typical N→1) passes', () => {
    const doc = makeDoc([edge({ id: 'TE-2', operation: 'MERGE', inputs: ['WS-1', 'WS-2', 'WS-3'], outputs: ['WS-3'] })])
    expect(validateRealize(doc, 'TE-2')).toEqual({ ok: true, issues: [] })
  })

  it('degenerate 1→1 MERGE passes (only the owner side is arity-checked)', () => {
    const doc = makeDoc([edge({ id: 'TE-3', operation: 'MERGE', inputs: ['WS-1'], outputs: ['WS-2'] })])
    expect(validateRealize(doc, 'TE-3')).toEqual({ ok: true, issues: [] })
  })
})

describe('validateRealize — violations are reported precisely', () => {
  it('FORK with 2 inputs → REALIZE_ARITY (names edge, count, and the inputs)', () => {
    const doc = makeDoc([edge({ id: 'TE-7', inputs: ['WS-1', 'WS-2'], outputs: ['WS-3'] })])
    const result = validateRealize(doc, 'TE-7')
    expect(result.ok).toBe(false)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]!.code).toBe('REALIZE_ARITY')
    expect(result.issues[0]!.teId).toBe('TE-7')
    expect(result.issues[0]!.message).toContain('TE-7')
    expect(result.issues[0]!.message).toContain('exactly 1 input')
    expect(result.issues[0]!.message).toContain('got 2')
    expect(result.issues[0]!.message).toContain('[WS-1, WS-2]')
  })

  it('FORK with 3 inputs → REALIZE_ARITY', () => {
    const doc = makeDoc([edge({ id: 'TE-8', inputs: ['WS-1', 'WS-2', 'WS-3'], outputs: ['WS-3'] })])
    expect(validateRealize(doc, 'TE-8').issues.map((i) => i.code)).toEqual(['REALIZE_ARITY'])
  })

  it('MERGE with 2 outputs → REALIZE_ARITY (names edge, count, and the outputs)', () => {
    const doc = makeDoc([
      edge({ id: 'TE-9', operation: 'MERGE', inputs: ['WS-1'], outputs: ['WS-2', 'WS-3'] }),
    ])
    const result = validateRealize(doc, 'TE-9')
    expect(result.ok).toBe(false)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]!.code).toBe('REALIZE_ARITY')
    expect(result.issues[0]!.message).toContain('TE-9')
    expect(result.issues[0]!.message).toContain('exactly 1 output')
    expect(result.issues[0]!.message).toContain('got 2')
    expect(result.issues[0]!.message).toContain('[WS-2, WS-3]')
  })

  it('MERGE with 2+ inputs is fine (N→1 typical — only the owner side is checked)', () => {
    const doc = makeDoc([edge({ id: 'TE-10', operation: 'MERGE', inputs: ['WS-1', 'WS-2'], outputs: ['WS-3'] })])
    expect(validateRealize(doc, 'TE-10').ok).toBe(true)
  })
})

describe('validateRealize — reference missing / state', () => {
  it('unknown teId → EDGE_NOT_FOUND (single issue, no arity checks run)', () => {
    const doc = makeDoc([edge({ id: 'TE-1', inputs: ['WS-1', 'WS-2'] })]) // would also violate arity
    const result = validateRealize(doc, 'TE-99')
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      {
        code: 'EDGE_NOT_FOUND',
        teId: 'TE-99',
        message: expect.stringContaining('TE-99'),
      },
    ])
  })

  it('REALIZED edge → REALIZE_NOT_PLANNED (names the current lifecycle)', () => {
    const doc = makeDoc([edge({ id: 'TE-1', lifecycle: 'REALIZED', realized_event_id: 'H-1' })])
    const result = validateRealize(doc, 'TE-1')
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]!.code).toBe('REALIZE_NOT_PLANNED')
    expect(result.issues[0]!.message).toContain('REALIZED')
    expect(result.issues[0]!.message).toContain('only PLANNED')
  })

  it('DROPPED edge → REALIZE_NOT_PLANNED', () => {
    const doc = makeDoc([edge({ id: 'TE-1', lifecycle: 'DROPPED' })])
    const result = validateRealize(doc, 'TE-1')
    expect(result.issues[0]!.code).toBe('REALIZE_NOT_PLANNED')
    expect(result.issues[0]!.message).toContain('DROPPED')
  })
})

describe('validateRealize — aggregation (one edge, several violations)', () => {
  it('a REALIZED multi-input FORK edge reports BOTH issues (state + arity)', () => {
    const doc = makeDoc([edge({ id: 'TE-4', lifecycle: 'REALIZED', realized_event_id: 'H-1', inputs: ['WS-1', 'WS-2'] })])
    const result = validateRealize(doc, 'TE-4')
    expect(result.ok).toBe(false)
    expect(result.issues.map((i) => i.code)).toEqual(['REALIZE_NOT_PLANNED', 'REALIZE_ARITY'])
    for (const issue of result.issues) expect(issue.teId).toBe('TE-4')
  })

  it('issues are per-edge: a valid sibling edge does not leak into the result', () => {
    const doc = makeDoc([
      edge({ id: 'TE-1' }), // ok
      edge({ id: 'TE-2', inputs: ['WS-1', 'WS-2'] }), // arity violation
    ])
    const okSide = validateRealize(doc, 'TE-1')
    expect(okSide).toEqual({ ok: true, issues: [] })
    const badSide = validateRealize(doc, 'TE-2')
    expect(badSide.ok).toBe(false)
    expect(badSide.issues[0]!.teId).toBe('TE-2')
  })
})

describe('validateRealize — empty document', () => {
  it('an edge-less document reports EDGE_NOT_FOUND for any teId', () => {
    expect(validateRealize(makeDoc([]), 'TE-1').issues.map((i) => i.code)).toEqual(['EDGE_NOT_FOUND'])
  })
})
