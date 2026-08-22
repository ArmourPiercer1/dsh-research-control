/**
 * WP-1.6 — frozen §1.1 prefix registry: all 25 prefixes, fully enumerated
 * against an independently hand-transcribed copy of the DOMAIN_SCHEMA.md
 * §1.1 table (L18-44), plus the full construct→parse roundtrip identity.
 *
 * TEST_MATRIX TC-DOM-026 (L130) —「ID 规范」part 1: the 25-prefix registry.
 * The expected table below is transcribed from the frozen document, NOT
 * copied from the implementation, so the test fails if the registry drifts
 * from §1.1 in either direction (missing row, extra row, wrong prefix,
 * wrong scope, wrong example).
 */
import { describe, expect, it } from 'vitest'
import {
  ALL_PREFIXES,
  ID_KIND_VALUES,
  ID_PREFIX_REGISTRY,
  ID_PATTERN,
  OBJECT_KIND_VALUES,
  entryForPrefix,
  isRegisteredPrefix,
  kindForPrefix,
  makeId,
  parseId,
  prefixForKind,
} from '../../src/shared/ids/index.js'
import type { IdKind, UniquenessScope } from '../../src/shared/ids/index.js'

/**
 * Hand-transcribed from DOMAIN_SCHEMA.md §1.1 table (L20-44), in table
 * order: [prefix, kind, example, scope].
 */
const EXPECTED_ROWS: ReadonlyArray<readonly [string, IdKind, string, UniquenessScope]> = [
  ['PRJ', 'PROJECT', 'PRJ-1', 'GLOBAL'],
  ['TPC', 'TOPIC', 'TPC-3', 'PROJECT'],
  ['WS', 'WORKSTREAM', 'WS-12', 'PROJECT'],
  ['TE', 'TOPOLOGY_EDGE', 'TE-17', 'PROJECT'],
  ['PF', 'PLAN_FORK', 'PF-17', 'PROJECT'],
  ['T', 'TASK', 'T-17', 'PROJECT'],
  ['G', 'GATE', 'G-2', 'PROJECT'],
  ['M', 'MILESTONE', 'M-1', 'PROJECT'],
  ['R', 'RUN', 'R-81', 'PROJECT'],
  ['C', 'CLAIM', 'C-17', 'PROJECT'],
  ['F', 'FACT', 'F-31', 'PROJECT'],
  ['A', 'ARTIFACT', 'A-9', 'PROJECT'],
  ['REL', 'RELATION', 'REL-40', 'PROJECT'],
  ['OBJ', 'OBJECTIVE', 'OBJ-1', 'PROJECT'],
  ['IV', 'INTERVENTION', 'IV-5', 'PROJECT'],
  ['NA', 'NEXT_ACTION', 'NA-2', 'PROJECT'],
  ['BLK', 'BLOCKER', 'BLK-3', 'PROJECT'],
  ['INT', 'INTERACTION', 'INT-7', 'PROJECT'],
  ['RPT', 'REPORTING_ITEM', 'RPT-4', 'PROJECT'],
  ['SEV', 'SCHEDULED_EVENT', 'SEV-6', 'PROJECT'],
  ['H', 'HISTORY_EVENT', 'H-1001', 'PROJECT'],
  ['IN', 'INBOX_ITEM', 'IN-11', 'PROJECT'],
  ['DS', 'DISCOVERED_SESSION', 'DS-2', 'PROJECT'],
  ['MA', 'MANAGEMENT_ACTION', 'MA-30', 'PROJECT'],
  ['AN', 'ANALYSIS_RECORD', 'AN-1', 'PROJECT'],
]

describe('frozen §1.1 prefix registry (25 prefixes)', () => {
  it('has exactly 25 rows, in §1.1 table order', () => {
    expect(ID_PREFIX_REGISTRY).toHaveLength(25)
    expect(ALL_PREFIXES).toEqual(EXPECTED_ROWS.map(r => r[0]))
  })

  it('matches the frozen table row-by-row (prefix/kind/example/scope)', () => {
    for (const [index, [prefix, kind, example, scope]] of EXPECTED_ROWS.entries()) {
      const entry = ID_PREFIX_REGISTRY[index]!
      expect(entry, `row ${index}`).toEqual(
        expect.objectContaining({ prefix, kind, example, scope }),
      )
    }
  })

  it('prefixes are unique, uppercase, and well-formed; kinds are unique', () => {
    const prefixes = ID_PREFIX_REGISTRY.map(e => e.prefix)
    const kinds = ID_PREFIX_REGISTRY.map(e => e.kind)
    expect(new Set(prefixes).size).toBe(25)
    expect(new Set(kinds).size).toBe(25)
    for (const prefix of prefixes) {
      expect(prefix).toMatch(/^[A-Z]+$/)
    }
  })

  it('every row carries a non-empty object-section annotation (对象章节)', () => {
    for (const entry of ID_PREFIX_REGISTRY) {
      expect(entry.section.length, `section for ${entry.prefix}`).toBeGreaterThan(0)
      expect(entry.allocatedAt.length, `allocatedAt for ${entry.prefix}`).toBeGreaterThan(0)
    }
  })

  it('each §1.1 example parses back to its own row (examples are frozen data)', () => {
    for (const [prefix, kind, example] of EXPECTED_ROWS) {
      expect(parseId(example), `example ${example}`).toEqual(
        expect.objectContaining({ kind, prefix }),
      )
    }
  })

  it('lookups: exact prefix/kind both directions; unregistered prefixes are rejected', () => {
    expect(kindForPrefix('TE')).toBe('TOPOLOGY_EDGE')
    expect(prefixForKind('TASK')).toBe('T')
    expect(entryForPrefix('INT')?.kind).toBe('INTERACTION')
    expect(entryForPrefix('TEZ')).toBeUndefined()
    expect(kindForPrefix('X')).toBeUndefined()
    expect(isRegisteredPrefix('T')).toBe(true)
    expect(isRegisteredPrefix('TT')).toBe(false)
  })

  it('the 24-vs-25 asymmetry: MANAGEMENT_ACTION has a prefix but is not an ObjectKind', () => {
    expect(ID_KIND_VALUES).toHaveLength(25)
    expect(OBJECT_KIND_VALUES).toHaveLength(24)
    const idKindSet = new Set<IdKind>(ID_KIND_VALUES)
    const objectKindSet = new Set<IdKind>(OBJECT_KIND_VALUES)
    const onlyInIdKinds = [...idKindSet].filter(k => !objectKindSet.has(k))
    expect(onlyInIdKinds).toEqual(['MANAGEMENT_ACTION'])
    // MA is still allocatable/parseable — it is just not a TypedRef target.
    expect(parseId('MA-30')).toEqual(
      expect.objectContaining({ kind: 'MANAGEMENT_ACTION', prefix: 'MA', sequence: 30 }),
    )
  })
})

describe('construct→parse roundtrip (all 25 prefixes)', () => {
  const SEQUENCES = [1, 2, 17, 81, 1001, 999999]

  it('makeId renders <PREFIX>-<sequence> exactly, for every prefix', () => {
    for (const [prefix, kind] of EXPECTED_ROWS.map(r => [r[0], r[1]] as const)) {
      for (const sequence of SEQUENCES) {
        expect(makeId(kind, sequence)).toBe(`${prefix}-${sequence}`)
      }
    }
  })

  it('parse(makeId(k, n)) is the identity for every kind and sequence', () => {
    for (const [prefix, kind] of EXPECTED_ROWS.map(r => [r[0], r[1]] as const)) {
      for (const sequence of SEQUENCES) {
        const id = makeId(kind, sequence)
        expect(parseId(id)).toEqual({ kind, prefix, sequence, raw: id })
      }
    }
  })

  it('every well-formed id parses to a kind whose prefix is the id\'s run (no cross-kind leakage)', () => {
    for (const [prefix, kind] of EXPECTED_ROWS.map(r => [r[0], r[1]] as const)) {
      const parsed = parseId(`${prefix}-42`)
      expect(parsed?.kind).toBe(kind)
      expect(prefixForKind(kind)).toBe(prefix)
    }
  })

  it('the format regex is the frozen §1.1 L14 pattern', () => {
    expect(ID_PATTERN.source).toBe('^[A-Z]+-[1-9][0-9]*$')
  })
})
