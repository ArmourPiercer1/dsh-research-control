/**
 * WP-2.5 — reducer positive cases: one real-form event per semantic event
 * type (HISTORY_EVENT_CATALOG §5.3–5.5 field tables) + the 13 non-semantic
 * no-ops (catalog §6: they touch other derived caches, not these four).
 *
 * Field mapping pinned here (the §6 派生缓存 semantics):
 *  - workstream_id = envelope ownerWorkstreamId (the catalog owner column);
 *  - created_by = envelope actor; recorded_at/created_at = occurredAt;
 *  - initial status: claim ACTIVE, fact ACTIVE (const), artifact REGISTERED,
 *    relation ACTIVE; references/created_by_run/etc. carried verbatim.
 */
import { describe, expect, it } from 'vitest'

import {
  foldSemanticEvents,
  initialSemanticState,
  isSemanticEvent,
  reduceSemanticEvent,
  SEMANTIC_EVENT_TYPES,
} from '../../src/host/domain/semantics/index.js'
import { AGENT_R1, deepFreeze, event, USER_ALICE } from './fixtures.js'

const T0 = Date.parse('2026-08-22T09:00:00Z')

describe('reducer: FACT_RECORDED (§5.3)', () => {
  it('creates the fact row (status const ACTIVE; fields from envelope + payload)', () => {
    const e = event('FACT_RECORDED', {
      fact_id: 'F-7',
      statement: 'run 42 p95 = 12 ms',
      created_by_run: 'R-1',
      references: ['data/run-42.log', 'figs/p95.png'],
    }, { actor: AGENT_R1, occurredAt: T0 + 500 })
    const next = reduceSemanticEvent(initialSemanticState(), e)
    const row = next.facts.get('F-7')
    expect(row).toEqual({
      id: 'F-7',
      workstream_id: 'WS-1',
      statement: 'run 42 p95 = 12 ms',
      created_by_run: 'R-1',
      created_by: AGENT_R1,
      references: ['data/run-42.log', 'figs/p95.png'],
      recorded_at: T0 + 500,
      status: 'ACTIVE',
    })
  })

  it('omitted optionals (created_by_run / references) stay absent from the row', () => {
    const e = event('FACT_RECORDED', { fact_id: 'F-8', statement: 's' })
    const next = reduceSemanticEvent(initialSemanticState(), e)
    const row = next.facts.get('F-8')!
    expect(row.created_by_run).toBeUndefined()
    expect(row.references).toBeUndefined()
    expect(row.created_by).toEqual(USER_ALICE)
    expect(row.recorded_at).toBe(T0)
  })
})

describe('reducer: CLAIM_RECORDED / CLAIM_RETRACTED (§5.3)', () => {
  it('creates the claim row (status ACTIVE; owner WS from envelope)', () => {
    const e = event('CLAIM_RECORDED', { claim_id: 'C-5', statement: 'X reduces Y' }, { ownerWorkstreamId: 'WS-3' })
    const next = reduceSemanticEvent(initialSemanticState(), e)
    const row = next.claims.get('C-5')
    expect(row?.workstream_id).toBe('WS-3')
    expect(row?.status).toBe('ACTIVE')
    expect(row?.statement).toBe('X reduces Y')
    expect(row?.created_by).toEqual(USER_ALICE)
  })

  it('retracts: status → RETRACTED, all other row fields preserved', () => {
    const rec = event('CLAIM_RECORDED', { claim_id: 'C-6', statement: 's', references: ['a'] }, { occurredAt: T0 })
    const state = reduceSemanticEvent(initialSemanticState(), rec)
    const ret = event('CLAIM_RETRACTED', { claim_id: 'C-6', reason: 'superseded by C-7' }, { occurredAt: T0 + 9000 })
    const next = reduceSemanticEvent(state, ret)
    const row = next.claims.get('C-6')!
    expect(row.status).toBe('RETRACTED')
    expect(row.statement).toBe('s')
    expect(row.references).toEqual(['a'])
    expect(row.recorded_at).toBe(T0) // recording time is immutable
  })

  it('INV-SCI-4 (negative results): a claim/fact recording a NEGATIVE result is recorded like any other', () => {
    const e1 = event('CLAIM_RECORDED', { claim_id: 'C-20', statement: 'hypothesis H1 is REJECTED: no effect observed' })
    const e2 = event('FACT_RECORDED', { fact_id: 'F-20', statement: 't-test p = 0.83 (no significance)' })
    const next = foldSemanticEvents([e1, e2])
    expect(next.claims.get('C-20')?.status).toBe('ACTIVE')
    expect(next.facts.get('F-20')?.status).toBe('ACTIVE')
  })
})

describe('reducer: ARTIFACT_REGISTERED / ARTIFACT_MARKED_MISSING (§5.4)', () => {
  it('creates the artifact row (status REGISTERED; §7.3 fields)', () => {
    const e = event('ARTIFACT_REGISTERED', {
      artifact_id: 'A-7',
      type: 'MODEL',
      title: 'fine-tuned checkpoint',
      uri: 'models/ft-2026-08-22.safetensors',
      content_hash: 'sha256:abc',
      created_by_run: 'R-2',
      related_task: 'T-3',
      supersedes: 'A-1',
    }, { occurredAt: T0 + 700 })
    const base = reduceSemanticEvent(initialSemanticState(), event('ARTIFACT_REGISTERED', { artifact_id: 'A-1', type: 'DATASET', title: 'old', uri: 'u' }))
    const next = reduceSemanticEvent(base, e)
    const row = next.artifacts.get('A-7')
    expect(row).toMatchObject({
      id: 'A-7',
      workstream_id: 'WS-1',
      type: 'MODEL',
      title: 'fine-tuned checkpoint',
      uri: 'models/ft-2026-08-22.safetensors',
      content_hash: 'sha256:abc',
      created_by_run: 'R-2',
      related_task: 'T-3',
      supersedes: 'A-1',
      recorded_at: T0 + 700,
      status: 'REGISTERED',
    })
  })

  it('mark-missing: status → MISSING; row otherwise preserved (no content copy — §7.3 「不复制内容」)', () => {
    const reg = event('ARTIFACT_REGISTERED', { artifact_id: 'A-8', type: 'NOTE', title: 'lab notebook page', uri: 'notes/p42.md' })
    const state = reduceSemanticEvent(initialSemanticState(), reg)
    const miss = event('ARTIFACT_MARKED_MISSING', { artifact_id: 'A-8', reason: 'path 404 in audit' }, { occurredAt: T0 + 8000 })
    const next = reduceSemanticEvent(state, miss)
    const row = next.artifacts.get('A-8')!
    expect(row.status).toBe('MISSING')
    expect(row.uri).toBe('notes/p42.md')
    expect(row.recorded_at).toBe(T0)
  })

  it('supersede chain: both rows survive (no hard delete — INV-HIST-7)', () => {
    const s1 = reduceSemanticEvent(initialSemanticState(), event('ARTIFACT_REGISTERED', { artifact_id: 'A-10', type: 'REPORT', title: 'v1', uri: 'r/v1.md' }))
    const s2 = reduceSemanticEvent(s1, event('ARTIFACT_REGISTERED', { artifact_id: 'A-11', type: 'REPORT', title: 'v2', uri: 'r/v2.md', supersedes: 'A-10' }))
    expect(s2.artifacts.has('A-10')).toBe(true)
    expect(s2.artifacts.get('A-11')?.supersedes).toBe('A-10')
  })
})

describe('reducer: RELATION_ADDED / RELATION_REMOVED (§5.5)', () => {
  it('creates the relation row (status ACTIVE; endpoints + type verbatim; created_at = occurredAt)', () => {
    const rec = event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 's' })
    const fact = event('FACT_RECORDED', { fact_id: 'F-1', statement: 'f' })
    const base = reduceSemanticEvent(reduceSemanticEvent(initialSemanticState(), rec), fact)
    const e = event('RELATION_ADDED', {
      relation_id: 'REL-7',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
    }, { occurredAt: T0 + 300 })
    const next = reduceSemanticEvent(base, e)
    const row = next.relations.get('REL-7')
    expect(row).toEqual({
      id: 'REL-7',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
      created_by: USER_ALICE,
      created_at: T0 + 300,
      status: 'ACTIVE',
    })
  })

  it('removes: status → REMOVED + removed_at; row kept (INV-HIST-7)', () => {
    const base = buildRelationState()
    const e = event('RELATION_REMOVED', {
      relation_id: 'REL-1',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
      reason: 'evidence retracted',
    }, { occurredAt: T0 + 4000 })
    const next = reduceSemanticEvent(base, e)
    const row = next.relations.get('REL-1')!
    expect(row.status).toBe('REMOVED')
    expect(row.removed_at).toBe(T0 + 4000)
    expect(next.relations.size).toBe(base.relations.size) // no deletion
  })
})

function buildRelationState() {
  const s1 = reduceSemanticEvent(initialSemanticState(), event('CLAIM_RECORDED', { claim_id: 'C-1', statement: 's' }))
  const s2 = reduceSemanticEvent(s1, event('FACT_RECORDED', { fact_id: 'F-1', statement: 'f' }))
  return reduceSemanticEvent(
    s2,
    event('RELATION_ADDED', {
      relation_id: 'REL-1',
      source: { kind: 'CLAIM', id: 'C-1' },
      relation_type: 'SUPPORTED_BY',
      target: { kind: 'FACT', id: 'F-1' },
    }),
  )
}

/* ------------------------------------------------------------------ *
 * The 13 non-semantic events: identity no-ops (catalog §6)
 * ------------------------------------------------------------------ */

describe('reducer: non-semantic events are identity no-ops (catalog §6)', () => {
  const NON_SEMANTIC = [
    'RUN_STARTED', 'RUNS_STARTED', 'RUN_FINISHED', 'RUN_FAILED', 'RUN_CANCELLED',
    'TASK_EXECUTION_CHANGED', 'TASK_VALIDATION_CHANGED', 'ACCEPTANCE_CRITERIA_CHANGED',
    'GATE_EVALUATED', 'MILESTONE_ACHIEVED', 'INTERVENTION_CREATED',
    'TOPOLOGY_FORK_REALIZED', 'TOPOLOGY_MERGE_REALIZED',
  ]

  it.each(NON_SEMANTIC)('%s returns the SAME state reference (zero work, zero drift)', (eventType) => {
    const state = deepFreeze(buildRelationState())
    const e = event(eventType, { run_id: 'R-1' })
    expect(isSemanticEvent(e)).toBe(false)
    const next = reduceSemanticEvent(state, e)
    expect(next).toBe(state) // identity: the fold can cheaply skip
  })

  it('the seven + thirteen partition the frozen 20-event catalog', () => {
    expect(SEMANTIC_EVENT_TYPES).toHaveLength(7)
    expect(NON_SEMANTIC).toHaveLength(13)
    const all = [...SEMANTIC_EVENT_TYPES, ...NON_SEMANTIC]
    expect(all).toHaveLength(20)
    expect(new Set(all)).toHaveLength(20)
  })

  it('purity: the reducer never mutates the input state (frozen state survives the fold)', () => {
    const state = deepFreeze(buildRelationState())
    const e = event('CLAIM_RECORDED', { claim_id: 'C-99', statement: 'new' })
    expect(() => reduceSemanticEvent(state, e)).not.toThrow()
    // a second fold from the same frozen input gives the same result (determinism spot check)
    const a = reduceSemanticEvent(state, e)
    const b = reduceSemanticEvent(state, e)
    expect(a.claims.get('C-99')).toEqual(b.claims.get('C-99'))
    expect(a.facts).toBe(state.facts) // untouched maps keep their references
  })
})
