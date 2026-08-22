/**
 * WP-1.6 — TC-DOM-026 (TEST_MATRIX L130): 最长前缀解析 (longest-prefix-first,
 * DOMAIN_SCHEMA §1.1 规则 4, L51) — the TE/T and INT/IN ambiguity samples
 * must resolve per the frozen semantics, plus the malformed-input surface.
 */
import { describe, expect, it } from 'vitest'
import {
  assertId,
  idMatchesKind,
  isValidId,
  longestPrefixMatch,
  parseId,
} from '../../src/shared/ids/index.js'

describe('TC-DOM-026: longest-prefix-first parse (§1.1 规则 4)', () => {
  it('TE/T ambiguity: TE resolves to TOPOLOGY_EDGE, T to TASK', () => {
    expect(parseId('TE-17')).toEqual({ kind: 'TOPOLOGY_EDGE', prefix: 'TE', sequence: 17, raw: 'TE-17' })
    expect(parseId('TE-1')).toEqual({ kind: 'TOPOLOGY_EDGE', prefix: 'TE', sequence: 1, raw: 'TE-1' })
    expect(parseId('T-17')).toEqual({ kind: 'TASK', prefix: 'T', sequence: 17, raw: 'T-17' })
    expect(parseId('T-1')).toEqual({ kind: 'TASK', prefix: 'T', sequence: 1, raw: 'T-1' })
    // the TE id must NOT leak into TASK via the shorter prefix
    expect(idMatchesKind('TE-17', 'TASK')).toBe(false)
    expect(idMatchesKind('T-17', 'TOPOLOGY_EDGE')).toBe(false)
  })

  it('INT/IN ambiguity: INT resolves to INTERACTION, IN to INBOX_ITEM', () => {
    expect(parseId('INT-7')).toEqual({ kind: 'INTERACTION', prefix: 'INT', sequence: 7, raw: 'INT-7' })
    expect(parseId('INT-1')).toEqual({ kind: 'INTERACTION', prefix: 'INT', sequence: 1, raw: 'INT-1' })
    expect(parseId('IN-11')).toEqual({ kind: 'INBOX_ITEM', prefix: 'IN', sequence: 11, raw: 'IN-11' })
    expect(parseId('IN-1')).toEqual({ kind: 'INBOX_ITEM', prefix: 'IN', sequence: 1, raw: 'IN-1' })
    expect(idMatchesKind('INT-7', 'INBOX_ITEM')).toBe(false)
    expect(idMatchesKind('IN-11', 'INTERACTION')).toBe(false)
  })

  it('every other prefix-containment pair in the frozen set resolves longest-first', () => {
    // T ⊂ TPC, R ⊂ REL / RPT, M ⊂ MA, A ⊂ AN (registry.ts documents the full list)
    expect(parseId('TPC-3')?.kind).toBe('TOPIC')
    expect(parseId('REL-40')?.kind).toBe('RELATION')
    expect(parseId('RPT-4')?.kind).toBe('REPORTING_ITEM')
    expect(parseId('R-81')?.kind).toBe('RUN')
    expect(parseId('MA-30')?.kind).toBe('MANAGEMENT_ACTION')
    expect(parseId('M-1')?.kind).toBe('MILESTONE')
    expect(parseId('AN-1')?.kind).toBe('ANALYSIS_RECORD')
    expect(parseId('A-9')?.kind).toBe('ARTIFACT')
  })

  it('longestPrefixMatch: the rule-4 resolution function, directly', () => {
    expect(longestPrefixMatch('TE')).toBe('TE')
    expect(longestPrefixMatch('T')).toBe('T')
    expect(longestPrefixMatch('INT')).toBe('INT')
    expect(longestPrefixMatch('IN')).toBe('IN')
    expect(longestPrefixMatch('TPC')).toBe('TPC')
    // runs that merely EXTEND a registered prefix match that prefix —
    // parseId then rejects them for non-exactness (see below)
    expect(longestPrefixMatch('TEX')).toBe('TE')
    expect(longestPrefixMatch('TIN')).toBe('T')
    expect(longestPrefixMatch('INX')).toBe('IN')
    expect(longestPrefixMatch('X')).toBeNull()
    expect(longestPrefixMatch('')).toBeNull()
  })
})

describe('parse: malformed inputs are rejected (null, no throw)', () => {
  const MALFORMED = [
    '', // empty
    'T', // no dash/number
    'T-', // empty number
    '-1', // empty prefix
    'T-0', // zero
    'T-01', // leading zero
    'T-007', // leading zeros
    'T-+1', // signed
    'T--1', // double dash
    'T-1.0', // not an integer
    'T-1x', // trailing junk
    'T- 1', // internal space
    'T-1 ', // trailing space
    ' T-1', // leading space
    'T-1\t', // trailing tab
    't-1', // lowercase prefix
    'te-17', // lowercase
    'Т-1', // lookalike non-ASCII (Cyrillic Т)
    'T-1-2', // extra dash
    'T-9007199254740992', // > Number.MAX_SAFE_INTEGER
    'T-99999999999999999999', // far beyond
  ]

  it.each(MALFORMED)('%j is not a valid id', id => {
    expect(parseId(id)).toBeNull()
    expect(isValidId(id)).toBe(false)
  })

  it('accepts exactly at the safe-integer boundary', () => {
    expect(parseId('T-9007199254740991')?.sequence).toBe(9007199254740991)
  })
})

describe('parse: unregistered prefixes are rejected (registry is frozen)', () => {
  const UNREGISTERED = [
    'X-1',
    'ZZ-1',
    'ABC-1',
    'TTE-1', // extends T, unregistered
    'TEX-1', // extends TE, unregistered
    'INX-1', // extends IN, unregistered
    'INTX-1', // extends INT, unregistered
    'PRX-1', // looks like PRJ, is not
    'WSX-1',
  ]

  it.each(UNREGISTERED)('%j is rejected', id => {
    expect(parseId(id)).toBeNull()
  })
})

describe('assertId / isValidId / idMatchesKind helpers', () => {
  it('assertId returns the parsed form for valid ids', () => {
    expect(assertId('TE-17')).toEqual({ kind: 'TOPOLOGY_EDGE', prefix: 'TE', sequence: 17, raw: 'TE-17' })
  })

  it('assertId throws a diagnostic for invalid ids', () => {
    expect(() => assertId('TEX-1')).toThrow(/invalid research id/)
    expect(() => assertId('t-1')).toThrow(/DOMAIN_SCHEMA §1.1/)
  })

  it('isValidId / idMatchesKind agree with parseId', () => {
    expect(isValidId('IN-11')).toBe(true)
    expect(isValidId('INX-11')).toBe(false)
    expect(idMatchesKind('IN-11', 'INBOX_ITEM')).toBe(true)
    expect(idMatchesKind('IN-11', 'INTERACTION')).toBe(false)
    expect(idMatchesKind('garbage', 'TASK')).toBe(false)
  })
})
