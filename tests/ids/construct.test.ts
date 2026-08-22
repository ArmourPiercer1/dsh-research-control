/**
 * WP-1.6 — id construction (makeId) validation surface.
 *
 * §1.1 格式 (L14): `<PREFIX>-<正整数>` — the frozen spec admits exactly one
 * form (registered prefix + positive integer). Construction enforces the
 * same bounds as parsing: positive, safe integer, no leading zeros by
 * construction (number → decimal string).
 */
import { describe, expect, it } from 'vitest'
import { makeId } from '../../src/shared/ids/index.js'

describe('makeId: canonical construction', () => {
  it('renders prefix + sequence for representative kinds', () => {
    expect(makeId('PROJECT', 1)).toBe('PRJ-1')
    expect(makeId('TASK', 17)).toBe('T-17')
    expect(makeId('TOPOLOGY_EDGE', 17)).toBe('TE-17')
    expect(makeId('INTERACTION', 7)).toBe('INT-7')
    expect(makeId('INBOX_ITEM', 11)).toBe('IN-11')
    expect(makeId('HISTORY_EVENT', 1001)).toBe('H-1001')
    expect(makeId('MANAGEMENT_ACTION', 30)).toBe('MA-30')
  })

  it('never emits leading zeros or zero', () => {
    expect(makeId('GATE', 2)).toBe('G-2')
    expect(() => makeId('GATE', 0)).toThrow(RangeError)
    expect(makeId('GATE', 10)).toBe('G-10')
  })

  it.each([0, -1, -17, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid sequence %p',
    sequence => {
      expect(() => makeId('TASK', sequence)).toThrow(RangeError)
    },
  )
})
