// V2-UI-0.4 UI-7 (D4) — queryRecords (D §13.4, ADJ-11): the Records read
// path is a PURE in-memory filter over the derived `semantics:<projectId>`
// row — the 7 filter dimensions (hit/miss each), the ADJ-11 sort
// (recorded_at DESC + id ASC tiebreak), pagination (default 50 / cap 200 /
// offset, total = filtered count BEFORE pagination), the DTO shape pins
// (artifact: no createdBy + empty references; claim: conflictFlag
// presence/absence; relations: out/in direction), and the ADJ-11 store-spy
// pin: ZERO `listRange` calls during the query (no history read, no
// `.research` file read — the derived row is the single source).

import { describe, expect, it } from 'vitest'
import { makeService } from './harness.js'
import type { Harness } from './harness.js'
import { querySemanticRecords } from '../../src/host/service/semantics/index.js'
import type {
  FactRow,
  SemanticState,
} from '../../src/host/domain/semantics/index.js'
import type { HistoryEventRecord } from '../../src/host/persistence/store/types.js'

/* ------------------------------------------------------------------ *
 * The fixture: 7 records across two workstreams (the filter matrix)
 * ------------------------------------------------------------------ */

interface FixtureOpts {
  /** Retract C-2 (RETRACTED status + the C-1 conflict flag clears). */
  readonly retractC2?: boolean
  /** Mark A-2 MISSING. */
  readonly missA2?: boolean
}

function buildFixture(opts: FixtureOpts = {}): { h: Harness } {
  const h = makeService()
  h.service.recordFact({
    workstreamId: 'WS-1',
    statement: 'Alpha: model converged at epoch 12',
    references: ['T-1', 'note:baseline'],
  })
  h.service.recordFact({
    workstreamId: 'WS-1',
    statement: 'Beta baseline holds',
    references: ['CLAIM:C-1'],
  })
  h.service.recordFact({ workstreamId: 'WS-2', statement: 'Gamma cross-workstream note' })
  h.service.recordClaim({ workstreamId: 'WS-1', statement: 'Alpha is better than beta' })
  h.service.recordClaim({ workstreamId: 'WS-1', statement: 'Beta is better than alpha' })
  h.service.registerArtifact({
    workstreamId: 'WS-1',
    type: 'MODEL',
    title: 'Alpha model v1',
    uri: 'file:///alpha/model.bin',
    relatedTaskId: 'T-1',
  })
  h.service.registerArtifact({
    workstreamId: 'WS-1',
    type: 'NOTE',
    title: 'run log excerpt',
    uri: 'file:///alpha/log.md',
  })
  h.service.addRelation({
    source: { kind: 'CLAIM', id: 'C-1' },
    relationType: 'SUPPORTED_BY',
    target: { kind: 'FACT', id: 'F-1' },
  })
  h.service.addRelation({
    source: { kind: 'CLAIM', id: 'C-1' },
    relationType: 'CONTRADICTED_BY',
    target: { kind: 'CLAIM', id: 'C-2' },
  })
  h.service.addRelation({
    source: { kind: 'TASK', id: 'T-1' },
    relationType: 'DEPENDS_ON',
    target: { kind: 'TASK', id: 'T-2' },
  })
  if (opts.retractC2) {
    h.service.retractClaim({ claimId: 'C-2', reason: 'superseded by the ablation' })
  }
  if (opts.missA2) {
    h.service.markArtifactMissing({ artifactId: 'A-2', reason: 'the run was interrupted' })
  }
  return { h }
}

/** The DTO recordedAt map (id → recordedAt), in one query. */
function timesById(h: Harness): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of h.service.queryRecords({}).records) out.set(r.id, r.recordedAt)
  return out
}

describe('queryRecords — the derived-state filter (D §13.4)', () => {
  it('workstreamId filter: WS-1 hits (6), WS-2 hits (1), unknown WS misses (0)', () => {
    const { h } = buildFixture()
    try {
      const ws1 = h.service.queryRecords({ workstreamId: 'WS-1' })
      expect(ws1.records.map((r) => r.id).sort()).toEqual(['A-1', 'A-2', 'C-1', 'C-2', 'F-1', 'F-2'])
      expect(ws1.records.every((r) => r.workstreamId === 'WS-1')).toBe(true)
      expect(ws1.total).toBe(6)

      const ws2 = h.service.queryRecords({ workstreamId: 'WS-2' })
      expect(ws2.records.map((r) => r.id)).toEqual(['F-3'])
      expect(ws2.total).toBe(1)

      const miss = h.service.queryRecords({ workstreamId: 'WS-9' })
      expect(miss.records).toEqual([])
      expect(miss.total).toBe(0)
    } finally {
      h.close()
    }
  })

  it('type filter: FACT (3), CLAIM (2), ARTIFACT (2) — disjoint and exhaustive', () => {
    const { h } = buildFixture()
    try {
      const facts = h.service.queryRecords({ type: 'FACT' })
      expect(facts.records.map((r) => r.id).sort()).toEqual(['F-1', 'F-2', 'F-3'])
      expect(facts.records.every((r) => r.type === 'FACT')).toBe(true)

      const claims = h.service.queryRecords({ type: 'CLAIM' })
      expect(claims.records.map((r) => r.id).sort()).toEqual(['C-1', 'C-2'])

      const artifacts = h.service.queryRecords({ type: 'ARTIFACT' })
      expect(artifacts.records.map((r) => r.id).sort()).toEqual(['A-1', 'A-2'])
      expect(artifacts.records.every((r) => r.type === 'ARTIFACT')).toBe(true)

      // Combined with workstreamId (two dimensions at once).
      const combo = h.service.queryRecords({ type: 'FACT', workstreamId: 'WS-1' })
      expect(combo.records.map((r) => r.id).sort()).toEqual(['F-1', 'F-2'])
      expect(combo.total).toBe(2)
    } finally {
      h.close()
    }
  })

  it('status filter: ACTIVE (4 — facts+claims only) / RETRACTED (1) / REGISTERED (1) / MISSING (1) / unknown status misses', () => {
    const { h } = buildFixture({ retractC2: true, missA2: true })
    try {
      const active = h.service.queryRecords({ status: 'ACTIVE' })
      expect(active.records.map((r) => r.id).sort()).toEqual(['C-1', 'F-1', 'F-2', 'F-3'])

      const retracted = h.service.queryRecords({ status: 'RETRACTED' })
      expect(retracted.records.map((r) => r.id)).toEqual(['C-2'])

      const registered = h.service.queryRecords({ status: 'REGISTERED' })
      expect(registered.records.map((r) => r.id)).toEqual(['A-1'])

      const missing = h.service.queryRecords({ status: 'MISSING' })
      expect(missing.records.map((r) => r.id)).toEqual(['A-2'])

      const miss = h.service.queryRecords({ status: 'NOT_A_STATUS' })
      expect(miss.records).toEqual([])
      expect(miss.total).toBe(0)
    } finally {
      h.close()
    }
  })

  it('keyword: case-insensitive substring over statement/title ONLY (references and uri are never searched)', () => {
    const { h } = buildFixture()
    try {
      // 'ALPHA' hits F-1 (statement), C-1 + C-2 (statements), A-1 (title).
      const alpha = h.service.queryRecords({ keyword: 'ALPHA' })
      expect(alpha.records.map((r) => r.id).sort()).toEqual(['A-1', 'C-1', 'C-2', 'F-1'])

      // 'baseline' hits ONLY F-2 (statement). F-1 carries 'note:baseline'
      // in its REFERENCES — references are not searched.
      const baseline = h.service.queryRecords({ keyword: 'baseline' })
      expect(baseline.records.map((r) => r.id)).toEqual(['F-2'])

      // 'model.bin' lives in A-1's URI — the uri is not searched either.
      const uri = h.service.queryRecords({ keyword: 'model.bin' })
      expect(uri.records).toEqual([])
      expect(uri.total).toBe(0)
    } finally {
      h.close()
    }
  })

  it('relatedObject: an ACTIVE edge either direction, or a reference naming the object (bare id or KIND:ID)', () => {
    const { h } = buildFixture()
    try {
      // {FACT, F-1}: C-1 has the out-edge C-1 SUPPORTED_BY F-1.
      const byF1 = h.service.queryRecords({ relatedObject: { kind: 'FACT', id: 'F-1' } })
      expect(byF1.records.map((r) => r.id)).toEqual(['C-1'])

      // {CLAIM, C-1}: C-2 has the in-edge (C-1 CONTRADICTED_BY C-2), F-1
      // the in-edge (C-1 SUPPORTED_BY F-1), and F-2 names 'CLAIM:C-1' in
      // its references (the qualified form matches).
      const byC1 = h.service.queryRecords({ relatedObject: { kind: 'CLAIM', id: 'C-1' } })
      expect(byC1.records.map((r) => r.id)).toEqual(['C-2', 'F-2', 'F-1'])

      // {TASK, T-1}: no TASK endpoint is a record (T-1 DEPENDS_ON T-2 touches
      // no F/C/A row) — but F-1 names the bare id 'T-1' in its references.
      const byT1 = h.service.queryRecords({ relatedObject: { kind: 'TASK', id: 'T-1' } })
      expect(byT1.records.map((r) => r.id)).toEqual(['F-1'])

      // Miss: nothing references F-2 and no edge touches it.
      const miss = h.service.queryRecords({ relatedObject: { kind: 'FACT', id: 'F-2' } })
      expect(miss.records).toEqual([])
      expect(miss.total).toBe(0)
    } finally {
      h.close()
    }
  })

  it('timeFrom/timeTo: inclusive bounds on recordedAt (window edges are kept)', () => {
    const { h } = buildFixture()
    try {
      const t = timesById(h)
      const window = h.service.queryRecords({
        timeFrom: t.get('C-1'),
        timeTo: t.get('A-1'),
      })
      expect(window.records.map((r) => r.id)).toEqual(['A-1', 'C-2', 'C-1'])
      expect(window.total).toBe(3)

      const upto = h.service.queryRecords({ timeTo: t.get('F-2') })
      expect(upto.records.map((r) => r.id)).toEqual(['F-2', 'F-1'])

      const fromLatest = h.service.queryRecords({ timeFrom: t.get('A-2') })
      expect(fromLatest.records.map((r) => r.id)).toEqual(['A-2'])

      const afterAll = h.service.queryRecords({ timeFrom: t.get('A-2')! + 1 })
      expect(afterAll.records).toEqual([])
      expect(afterAll.total).toBe(0)
    } finally {
      h.close()
    }
  })

  it('sort: recorded_at DESC (the write order reversed), total = filtered count', () => {
    const { h } = buildFixture()
    try {
      const all = h.service.queryRecords({})
      expect(all.records.map((r) => r.id)).toEqual(['A-2', 'A-1', 'C-2', 'C-1', 'F-3', 'F-2', 'F-1'])
      expect(all.total).toBe(7)
      // The DTO recordedAt equals the write-result recordedAt (occurredAt).
      const t = timesById(h)
      for (let i = 1; i < all.records.length; i += 1) {
        expect(all.records[i - 1]!.recordedAt).toBeGreaterThan(all.records[i]!.recordedAt)
      }
      expect(all.records[6]!.recordedAt).toBe(t.get('F-1'))
    } finally {
      h.close()
    }
  })

  it('pagination: limit + offset over the filtered set; total stays pre-pagination', () => {
    const { h } = buildFixture()
    try {
      const page1 = h.service.queryRecords({ limit: 3 })
      expect(page1.records.map((r) => r.id)).toEqual(['A-2', 'A-1', 'C-2'])
      expect(page1.total).toBe(7)

      const page3 = h.service.queryRecords({ limit: 3, offset: 5 })
      expect(page3.records.map((r) => r.id)).toEqual(['F-2', 'F-1'])
      expect(page3.total).toBe(7)

      // Pagination composes with the filters (filtered THEN sliced).
      const ws1page = h.service.queryRecords({ workstreamId: 'WS-1', limit: 2, offset: 2 })
      expect(ws1page.records.map((r) => r.id)).toEqual(['C-2', 'C-1'])
      expect(ws1page.total).toBe(6)
    } finally {
      h.close()
    }
  })

  it('DTO shape — fact: full field set, references kept, in-direction relation, createdBy {kind USER}', () => {
    const { h } = buildFixture()
    try {
      const dto = h.service.queryRecords({ keyword: 'epoch' }).records.find((r) => r.id === 'F-1')
      expect(dto !== undefined).toBe(true)
      const f = dto!
      expect(f.type).toBe('FACT')
      expect(f.workstreamId).toBe('WS-1')
      expect(f.statement).toBe('Alpha: model converged at epoch 12')
      expect(f.title).toBeUndefined()
      expect(f.artifactType).toBeUndefined()
      expect(f.uri).toBeUndefined()
      expect(f.status).toBe('ACTIVE')
      expect(f.createdBy).toEqual({ kind: 'USER' })
      expect(f.references).toEqual(['T-1', 'note:baseline'])
      // C-1 SUPPORTED_BY F-1 → the fact sees the edge IN-bound.
      expect(f.relations).toEqual([
        { relationId: 'REL-1', relationType: 'SUPPORTED_BY', direction: 'in', other: { kind: 'CLAIM', id: 'C-1' } },
      ])
      expect('conflictFlag' in f).toBe(false)
    } finally {
      h.close()
    }
  })

  it('DTO shape — claim: conflictFlag PENDING_REVIEW (the ACTIVE CONTRADICTED_BY edge) + out-direction relations', () => {
    const { h } = buildFixture()
    try {
      const all = h.service.queryRecords({ type: 'CLAIM' })
      const c1 = all.records.find((r) => r.id === 'C-1')!
      // Both edges are OUT of C-1 (SUPPORTED_BY F-1, CONTRADICTED_BY C-2).
      expect(c1.relations).toEqual([
        { relationId: 'REL-1', relationType: 'SUPPORTED_BY', direction: 'out', other: { kind: 'FACT', id: 'F-1' } },
        { relationId: 'REL-2', relationType: 'CONTRADICTED_BY', direction: 'out', other: { kind: 'CLAIM', id: 'C-2' } },
      ])
      expect(c1.conflictFlag).toEqual({ kind: 'PENDING_REVIEW', relationIds: ['REL-2'] })

      // C-2 is the TARGET of the contradiction — it carries NO flag.
      const c2 = all.records.find((r) => r.id === 'C-2')!
      expect(c2.relations).toEqual([
        { relationId: 'REL-2', relationType: 'CONTRADICTED_BY', direction: 'in', other: { kind: 'CLAIM', id: 'C-1' } },
      ])
      expect('conflictFlag' in c2).toBe(false)
    } finally {
      h.close()
    }
  })

  it('DTO shape — claim conflictFlag CLEARS when the SOURCE claim is retracted (a retracted claim needs no review; the TARGET status is irrelevant to the flag)', () => {
    const { h } = buildFixture()
    try {
      // Sanity: the flag is present while C-1 is ACTIVE.
      const before = h.service.queryRecords({ relatedObject: { kind: 'FACT', id: 'F-1' } }).records.find((r) => r.id === 'C-1')!
      expect(before.conflictFlag).toEqual({ kind: 'PENDING_REVIEW', relationIds: ['REL-2'] })

      // Retract the SOURCE claim (C-1) — the flag clears; the edge row is
      // untouched (no hard delete) and the target (C-2) is still ACTIVE.
      h.service.retractClaim({ claimId: 'C-1', reason: 'retracted after review' })
      const all = h.service.queryRecords({ type: 'CLAIM' })
      const c1 = all.records.find((r) => r.id === 'C-1')!
      expect(c1.status).toBe('RETRACTED')
      expect('conflictFlag' in c1).toBe(false)
      const c2 = all.records.find((r) => r.id === 'C-2')!
      expect(c2.status).toBe('ACTIVE')
      expect(c2.relations).toEqual([
        { relationId: 'REL-2', relationType: 'CONTRADICTED_BY', direction: 'in', other: { kind: 'CLAIM', id: 'C-1' } },
      ])
      expect('conflictFlag' in c2).toBe(false)
    } finally {
      h.close()
    }
  })

  it('DTO shape — artifact: NO createdBy (frozen ArtifactRow has no column), EMPTY references, uri kept verbatim', () => {
    const { h } = buildFixture({ missA2: true })
    try {
      const a1 = h.service.queryRecords({ relatedObject: { kind: 'TASK', id: 'T-1' } }).records.find((r) => r.id === 'A-1')
      expect(a1 === undefined).toBe(true) // A-1 is by-reference; related_task is NOT a relation
      const all = h.service.queryRecords({ type: 'ARTIFACT' })
      const first = all.records.find((r) => r.id === 'A-1')!
      expect(first.title).toBe('Alpha model v1')
      expect(first.artifactType).toBe('MODEL')
      expect(first.uri).toBe('file:///alpha/model.bin')
      expect(first.statement).toBeUndefined()
      expect(first.status).toBe('REGISTERED')
      expect('createdBy' in first).toBe(false)
      expect(first.references).toEqual([])
      expect(first.relations).toEqual([])

      const a2 = all.records.find((r) => r.id === 'A-2')!
      expect(a2.status).toBe('MISSING')
      expect(a2.artifactType).toBe('NOTE')
    } finally {
      h.close()
    }
  })

  it('ADJ-11 store-spy: ZERO listRange calls during the query (no history read, no file read)', () => {
    const { h } = buildFixture()
    try {
      const seam = h.storeWithSeam
      const calls: string[] = []
      const original: (ws: string, fromSeq: number, toSeq?: number) => readonly HistoryEventRecord[] = seam.listRange
      seam.listRange = (ownerWorkstreamId, fromSeq, toSeq) => {
        calls.push(`${ownerWorkstreamId}@${fromSeq}`)
        return original(ownerWorkstreamId, fromSeq, toSeq)
      }
      try {
        h.service.queryRecords({})
        h.service.queryRecords({
          workstreamId: 'WS-1',
          type: 'FACT',
          status: 'ACTIVE',
          keyword: 'alpha',
          relatedObject: { kind: 'CLAIM', id: 'C-1' },
        })
        h.service.queryRecords({ limit: 2, offset: 1 })
      } finally {
        seam.listRange = original
      }
      expect(calls).toEqual([])
    } finally {
      h.close()
    }
  })
})

/* ------------------------------------------------------------------ *
 * The pure function: pagination defaults + the id tiebreak (synthetic
 * state — identical recordedAt values are unreachable through the
 * monotonic production clock, so the tiebreak is pinned here directly).
 * ------------------------------------------------------------------ */

function synthFact(id: string, recordedAt: number, statement = 's'): FactRow {
  return {
    id,
    workstream_id: 'WS-1',
    statement,
    created_by: { kind: 'USER' },
    recorded_at: recordedAt,
    status: 'ACTIVE',
  }
}

function synthState(facts: readonly FactRow[]): SemanticState {
  return {
    claims: new Map(),
    facts: new Map(facts.map((f): [string, FactRow] => [f.id, f])),
    artifacts: new Map(),
    relations: new Map(),
    conflict: new Map(),
  }
}

describe('querySemanticRecords — pure pagination/sort (D §13.4, ADJ-11)', () => {
  it('default limit 50 / cap 200 / offset: 55 rows → 50, then all 55, then the tail pages', () => {
    const rows: FactRow[] = []
    for (let i = 1; i <= 55; i += 1) rows.push(synthFact(`F-${String(i).padStart(2, '0')}`, 1_700_000_000_000 + i * 1000))
    const state = synthState(rows)

    const def = querySemanticRecords(state, {})
    expect(def.records).toHaveLength(50)
    expect(def.total).toBe(55)
    expect(def.records[0]!.id).toBe('F-55')
    expect(def.records[49]!.id).toBe('F-06')

    const over = querySemanticRecords(state, { limit: 250 })
    expect(over.records).toHaveLength(55)
    expect(over.total).toBe(55)

    const tail = querySemanticRecords(state, { limit: 10, offset: 45 })
    expect(tail.records.map((r) => r.id)).toEqual(['F-10', 'F-09', 'F-08', 'F-07', 'F-06', 'F-05', 'F-04', 'F-03', 'F-02', 'F-01'])
    expect(tail.total).toBe(55)

    const beyond = querySemanticRecords(state, { offset: 55 })
    expect(beyond.records).toEqual([])
    expect(beyond.total).toBe(55)
  })

  it('sort tiebreak: equal recorded_at → id ASC within the tie group', () => {
    const state = synthState([
      synthFact('F-14', 1_700_000_004_000),
      synthFact('F-10', 1_700_000_004_000),
      synthFact('F-01', 1_700_000_005_000),
      synthFact('F-12', 1_700_000_004_000),
      synthFact('F-11', 1_700_000_004_000),
      synthFact('F-02', 1_700_000_003_000),
    ])
    const out = querySemanticRecords(state, {})
    expect(out.records.map((r) => r.id)).toEqual(['F-01', 'F-10', 'F-11', 'F-12', 'F-14', 'F-02'])
    expect(out.total).toBe(6)
  })
})
