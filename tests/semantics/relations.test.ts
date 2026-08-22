/**
 * WP-2.5 — INV-REL-1/2/3 as validation rules (TC-DOM-014: Relation 规范).
 *
 *  - 反向边（SUPPORTS/PRODUCES/REQUIRED_BY/VALIDATES）拒绝；
 *  - 未知 type 拒绝（INV-REL-3：10 种 V1 目录）；
 *  - 组合表外 kind 组合拒绝（INV-REL-1 方向语义）；
 *  - 自环拒绝；重复边拒绝（§8 唯一性 5 元组 / §15 UNIQUE，含 REMOVED 行）；
 *  - RELATED_TO 同边反向重复拒绝（§8 「禁止同边反向重复」）；
 *  - 反向视图由 incoming-edge query 派生、不存储（INV-REL-2 查询半边）；
 *  - 组合表与 WP-2.2 registry 的副本逐字一致（机械同步核对，防漂移）。
 *
 * The domain copy of the §8 table is cross-checked field-by-field against
 * the WP-2.2 registry copy (`history/registry/relations.ts`) — tests may
 * import across layers; `src/host/domain` never imports `src/host/history`
 * (ARCHITECTURE §2.2 `domain ← history`).
 */
import { describe, expect, it } from 'vitest'

import {
  FORBIDDEN_REVERSE_FORMS,
  isLegalRelationCombination,
  RELATION_COMBINATION_TABLE,
  RELATION_TYPES,
  findDuplicateEdge,
  findReverseDuplicateEdge,
  isRelationType,
  isSelfLoop,
  isWellFormedRef,
  relationEdgeKey,
  reverseView,
  sameRef,
  validateSemanticEvent,
  type RelationRow,
  type SemanticState,
  type SemanticTypedRef,
} from '../../src/host/domain/semantics/index.js'
import { RELATION_COMBINATION_TABLE as REGISTRY_TABLE, isLegalRelationCombination as registryLegal } from '../../src/host/history/registry/index.js'
import { event } from './fixtures.js'
import { initialSemanticState as initial } from '../../src/host/domain/semantics/index.js'

/* ------------------------------------------------------------------ *
 * INV-REL-3: the frozen 10-type set
 * ------------------------------------------------------------------ */

describe('INV-REL-3: relation_type limited to the V1 10-type 目录', () => {
  it('exactly the 10 frozen types (order: DOMAIN_SCHEMA §8 组合表 rows)', () => {
    expect([...RELATION_TYPES]).toEqual([
      'DEPENDS_ON',
      'SUPPORTED_BY',
      'CONTRADICTED_BY',
      'DERIVED_FROM',
      'PRODUCED_BY',
      'VALIDATED_BY',
      'CONSUMES',
      'CONTRIBUTES_TO',
      'IMPLEMENTS',
      'RELATED_TO',
    ])
  })

  it('isRelationType accepts all 10 and rejects unknown/reverse forms/empties', () => {
    for (const t of RELATION_TYPES) expect(isRelationType(t), t).toBe(true)
    for (const bad of ['CAUSES', 'SUPPORTS', 'PRODUCES', 'REQUIRED_BY', 'VALIDATES', '', 'depends_on', 'RELATED_TOX', 42, null]) {
      expect(isRelationType(bad as never), String(bad)).toBe(false)
    }
  })

  it('the §8 不保存的反向形式 are precisely SUPPORTS/PRODUCES/REQUIRED_BY/VALIDATES (INV-REL-2)', () => {
    expect([...FORBIDDEN_REVERSE_FORMS].sort()).toEqual(['PRODUCES', 'REQUIRED_BY', 'SUPPORTS', 'VALIDATES'])
    // and none of them is a member of the 10-type set (structural: they cannot be persisted)
    for (const rev of FORBIDDEN_REVERSE_FORMS) expect(isRelationType(rev)).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * INV-REL-1: direction semantics (the §8 组合表)
 * ------------------------------------------------------------------ */

describe('INV-REL-1: the §8 combination table (TARGET = SOURCE 的前提/来源/输入/证据/上位目标)', () => {
  it('every listed combination passes', () => {
    const cases: Array<[string, string, string]> = [
      ['DEPENDS_ON', 'TASK', 'TASK'], ['DEPENDS_ON', 'TASK', 'GATE'], ['DEPENDS_ON', 'TASK', 'MILESTONE'], ['DEPENDS_ON', 'GATE', 'GATE'],
      ['SUPPORTED_BY', 'CLAIM', 'FACT'], ['SUPPORTED_BY', 'CLAIM', 'ARTIFACT'], ['SUPPORTED_BY', 'CLAIM', 'CLAIM'],
      ['CONTRADICTED_BY', 'CLAIM', 'FACT'], ['CONTRADICTED_BY', 'CLAIM', 'CLAIM'], ['CONTRADICTED_BY', 'CLAIM', 'ARTIFACT'],
      ['DERIVED_FROM', 'FACT', 'ARTIFACT'], ['DERIVED_FROM', 'FACT', 'FACT'],
      ['PRODUCED_BY', 'ARTIFACT', 'RUN'],
      ['VALIDATED_BY', 'GATE', 'FACT'], ['VALIDATED_BY', 'GATE', 'ARTIFACT'],
      ['CONSUMES', 'TASK', 'ARTIFACT'], ['CONSUMES', 'RUN', 'ARTIFACT'],
      ['CONTRIBUTES_TO', 'TASK', 'OBJECTIVE'], ['CONTRIBUTES_TO', 'WORKSTREAM', 'OBJECTIVE'], ['CONTRIBUTES_TO', 'CLAIM', 'OBJECTIVE'],
      ['IMPLEMENTS', 'TASK', 'OBJECTIVE'], ['IMPLEMENTS', 'TASK', 'MILESTONE'],
    ]
    for (const [t, s, tgt] of cases) {
      expect(isLegalRelationCombination(t as never, s as never, tgt as never), `${t} ${s}→${tgt}`).toBe(true)
    }
  })

  it('out-of-table kind combinations are rejected (direction violations)', () => {
    const cases: Array<[string, string, string]> = [
      ['SUPPORTED_BY', 'FACT', 'CLAIM'], // FACT cannot be a SUPPORTED_BY source
      ['SUPPORTED_BY', 'CLAIM', 'TASK'], // TASK is not a listed target
      ['DERIVED_FROM', 'CLAIM', 'ARTIFACT'],
      ['PRODUCED_BY', 'ARTIFACT', 'CLAIM'],
      ['VALIDATED_BY', 'TASK', 'FACT'],
      ['CONSUMES', 'CLAIM', 'ARTIFACT'],
      ['CONTRIBUTES_TO', 'OBJECTIVE', 'CLAIM'], // direction flipped
      ['IMPLEMENTS', 'GATE', 'MILESTONE'],
      ['DEPENDS_ON', 'MILESTONE', 'TASK'],
    ]
    for (const [t, s, tgt] of cases) {
      expect(isLegalRelationCombination(t as never, s as never, tgt as never), `${t} ${s}→${tgt}`).toBe(false)
    }
  })

  it('RELATED_TO is 任意 → 任意 (all 24 × 24 kinds pass)', () => {
    const kinds = ['PROJECT', 'TOPIC', 'WORKSTREAM', 'TASK', 'GATE', 'MILESTONE', 'RUN', 'CLAIM', 'FACT', 'ARTIFACT', 'RELATION', 'OBJECTIVE', 'INTERVENTION', 'NEXT_ACTION', 'BLOCKER', 'INTERACTION', 'REPORTING_ITEM', 'SCHEDULED_EVENT', 'INBOX_ITEM', 'PLAN_FORK', 'TOPOLOGY_EDGE', 'DISCOVERED_SESSION', 'HISTORY_EVENT', 'ANALYSIS_RECORD']
    expect(kinds).toHaveLength(24)
    for (const s of kinds) for (const t of kinds) {
      expect(isLegalRelationCombination('RELATED_TO', s as never, t as never), `RELATED_TO ${s}→${t}`).toBe(true)
    }
  })

  it('domain table ≡ WP-2.2 registry table (mechanical sync check — a drift in either copy fails the tree)', () => {
    expect(Object.keys(RELATION_COMBINATION_TABLE).sort()).toEqual(Object.keys(REGISTRY_TABLE).sort())
    for (const t of Object.keys(RELATION_COMBINATION_TABLE) as Array<keyof typeof RELATION_COMBINATION_TABLE>) {
      expect([...RELATION_COMBINATION_TABLE[t].sources].sort(), `${t}.sources`).toEqual([...REGISTRY_TABLE[t].sources].sort())
      expect([...RELATION_COMBINATION_TABLE[t].targets].sort(), `${t}.targets`).toEqual([...REGISTRY_TABLE[t].targets].sort())
      // and the two lookup functions agree on every pair of the 24 kinds
      const kinds = RELATION_COMBINATION_TABLE.RELATED_TO.sources
      for (const s of kinds) for (const tg of kinds) {
        expect(isLegalRelationCombination(t, s, tg), `${t} ${s}→${tg}`).toBe(registryLegal(t as never, s, tg))
      }
    }
  })

  it('self-loop: source === target is always illegal (a premise cannot be itself)', () => {
    const a: SemanticTypedRef = { kind: 'CLAIM', id: 'C-1' }
    const b: SemanticTypedRef = { kind: 'CLAIM', id: 'C-1' }
    const c: SemanticTypedRef = { kind: 'CLAIM', id: 'C-2' }
    const d: SemanticTypedRef = { kind: 'FACT', id: 'C-1' } // same id, different kind — NOT a loop
    expect(isSelfLoop(a, b)).toBe(true)
    expect(isSelfLoop(a, c)).toBe(false)
    expect(isSelfLoop(a, d)).toBe(false)
    expect(sameRef(a, b)).toBe(true)
    expect(sameRef(a, d)).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * INV-REL-2: direct edges only — uniqueness, reverse duplicate, reverse VIEW
 * ------------------------------------------------------------------ */

function row(id: string, source: SemanticTypedRef, type: string, target: SemanticTypedRef, status: 'ACTIVE' | 'REMOVED' = 'ACTIVE'): RelationRow {
  return {
    id,
    source,
    relation_type: type as never,
    target,
    created_by: { kind: 'USER', user_id: 'u' },
    created_at: 1,
    status,
  }
}

describe('INV-REL-2 / §8 唯一性: 5-tuple uniqueness + 禁止同边反向重复', () => {
  const c1 = { kind: 'CLAIM', id: 'C-1' } as SemanticTypedRef
  const c2 = { kind: 'CLAIM', id: 'C-2' } as SemanticTypedRef

  it('relationEdgeKey is the §8 5-tuple (source.kind, source.id, type, target.kind, target.id)', () => {
    expect(relationEdgeKey(c1, 'SUPPORTED_BY', c2)).toBe('CLAIM:C-1|SUPPORTED_BY|CLAIM:C-2')
    expect(relationEdgeKey(c1, 'SUPPORTED_BY', c2)).not.toBe(relationEdgeKey(c2, 'SUPPORTED_BY', c1))
    expect(relationEdgeKey(c1, 'SUPPORTED_BY', c2)).not.toBe(relationEdgeKey(c1, 'CONTRADICTED_BY', c2))
  })

  it('findDuplicateEdge matches the exact 5-tuple across ANY status rows', () => {
    const relations = new Map<string, RelationRow>([
      ['REL-1', row('REL-1', c1, 'SUPPORTED_BY', c2, 'REMOVED')], // removed row still counts (§15 UNIQUE has no status qualifier)
    ])
    expect(findDuplicateEdge(relations, c1, 'SUPPORTED_BY', c2)?.id).toBe('REL-1')
    expect(findDuplicateEdge(relations, c2, 'SUPPORTED_BY', c1)).toBeUndefined() // different direction = different tuple
    expect(findDuplicateEdge(relations, c1, 'CONTRADICTED_BY', c2)).toBeUndefined()
    expect(findDuplicateEdge(new Map(), c1, 'SUPPORTED_BY', c2)).toBeUndefined()
  })

  it('findReverseDuplicateEdge: only RELATED_TO (the unique symmetric type) reports the reversed same-edge', () => {
    const relations = new Map<string, RelationRow>([['REL-1', row('REL-1', c1, 'RELATED_TO', c2)]])
    expect(findReverseDuplicateEdge(relations, c2, 'RELATED_TO', c1)?.id).toBe('REL-1')
    // asymmetric types: the reversed pair is a DIFFERENT edge — never reported
    expect(findReverseDuplicateEdge(new Map([['REL-2', row('REL-2', c2, 'CONTRADICTED_BY', c1)]]), c1, 'CONTRADICTED_BY', c2)).toBeUndefined()
    expect(findReverseDuplicateEdge(new Map([['REL-3', row('REL-3', c2, 'SUPPORTED_BY', c1)]]), c1, 'SUPPORTED_BY', c2)).toBeUndefined()
  })

  it('validateSemanticEvent: RELATED_TO reverse duplicate → RELATION_REVERSE_DUPLICATE', () => {
    const state: SemanticState = {
      ...initial(),
      relations: new Map([['REL-1', row('REL-1', c1, 'RELATED_TO', c2)]]),
    }
    const res = validateSemanticEvent(state, event('RELATION_ADDED', {
      relation_id: 'REL-2',
      source: c2,
      relation_type: 'RELATED_TO',
      target: c1,
    }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.map((e) => e.code)).toContain('RELATION_REVERSE_DUPLICATE')
  })

  it('validateSemanticEvent: same-direction duplicate → RELATION_DUPLICATE; a different 5-tuple passes', () => {
    // makeState() already holds REL-1 = C-1→SUPPORTED_BY→F-1 (REMOVED in the fixture? no — ACTIVE here):
    // re-adding the SAME 5-tuple (fresh REL id) must be rejected even though the row is REMOVED:
    const state: SemanticState = {
      ...initial(),
      claims: new Map([
        ['C-1', { id: 'C-1', workstream_id: 'WS-1', statement: 's', created_by: { kind: 'USER', user_id: 'u' }, recorded_at: 1, status: 'ACTIVE' as const }],
        ['C-2', { id: 'C-2', workstream_id: 'WS-1', statement: 't', created_by: { kind: 'USER', user_id: 'u' }, recorded_at: 1, status: 'ACTIVE' as const }],
      ]),
      facts: new Map([['F-1', { id: 'F-1', workstream_id: 'WS-1', statement: 'f', created_by: { kind: 'USER', user_id: 'u' }, recorded_at: 1, status: 'ACTIVE' }]]),
      relations: new Map([['REL-1', row('REL-1', c1, 'SUPPORTED_BY', c2, 'REMOVED')]]),
    }
    const dup = validateSemanticEvent(state, event('RELATION_ADDED', {
      relation_id: 'REL-2',
      source: c1,
      relation_type: 'SUPPORTED_BY',
      target: c2,
    }))
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.errors.map((e) => e.code)).toContain('RELATION_DUPLICATE')

    // the REVERSED pair of a SUPPORTED_BY edge is a DIFFERENT 5-tuple → a distinct, legal edge
    const fresh = validateSemanticEvent(state, event('RELATION_ADDED', {
      relation_id: 'REL-3',
      source: c2,
      relation_type: 'SUPPORTED_BY',
      target: c1,
    }))
    expect(fresh.ok).toBe(true)
  })

  it('reverseView derives the incoming-edge (reverse) view at query time — nothing is stored', () => {
    const f1 = { kind: 'FACT', id: 'F-1' } as SemanticTypedRef
    const state: SemanticState = {
      ...initial(),
      relations: new Map([
        ['REL-1', row('REL-1', c1, 'SUPPORTED_BY', f1)],
        ['REL-2', row('REL-2', c2, 'CONTRADICTED_BY', f1, 'REMOVED')], // removed → not in the ACTIVE view
        ['REL-3', row('REL-3', f1, 'DERIVED_FROM', c1)], // outgoing from f1, not incoming
      ]),
    }
    const incoming = reverseView(state, f1)
    expect(incoming.map((r) => r.id)).toEqual(['REL-1'])
    expect(reverseView(state, c1).map((r) => r.id).sort()).toEqual(['REL-3'])
    // the state itself stores direct edges only — no reverse/closure structure exists:
    expect(Object.keys(state).sort()).toEqual(['artifacts', 'claims', 'conflict', 'facts', 'relations'])
  })

  it('isWellFormedRef: well-formed typedRefs pass; malformed refs fail', () => {
    expect(isWellFormedRef({ kind: 'CLAIM', id: 'C-1' })).toBe(true)
    expect(isWellFormedRef({ kind: 'NOPE', id: 'C-1' })).toBe(false)
    expect(isWellFormedRef({ kind: 'CLAIM', id: '' })).toBe(false)
    expect(isWellFormedRef({ kind: 'CLAIM' })).toBe(false)
    expect(isWellFormedRef(null)).toBe(false)
    expect(isWellFormedRef('C-1')).toBe(false)
  })
})
