/**
 * V2-T2.3 — `validateAgainstTrees`: the dual-source reconciliation
 * projection (design §4 step 5 — 注册表∧发现双成功→受管 / 仅发现→
 * standalone / 仅登记→missing; the pure three-branch set operation
 * consumed by T2.2's plane state).
 */

import { describe, expect, it } from 'vitest'

import { validateAgainstTrees } from '../../src/host/domain/registry/index.js'
import { ACTIVE_ENTRY, ARCHIVED_ENTRY, makeFile } from './fixtures.js'

/** A three-entry registry over /ws/one .. /ws/three. */
const FILE = makeFile([
  { ...ACTIVE_ENTRY, id: 'PRJ-1', path: '/ws/one' },
  { ...ARCHIVED_ENTRY, id: 'PRJ-2', path: '/ws/two' },
  { ...ACTIVE_ENTRY, id: 'PRJ-3', path: '/ws/three' },
])

describe('validateAgainstTrees — the three branches', () => {
  it('mixed case: managed ∪ missing covers the registry, standalone the undiscovered paths', () => {
    const out = validateAgainstTrees(FILE, ['/ws/one', '/ws/three', '/ws/four', '/ws/five'])
    expect(out.managed.map((e) => e.id)).toEqual(['PRJ-1', 'PRJ-3'])
    expect(out.missing.map((e) => e.id)).toEqual(['PRJ-2'])
    expect(out.standalone).toEqual(['/ws/four', '/ws/five'])
  })

  it('empty registry: every discovered path is standalone', () => {
    const out = validateAgainstTrees(makeFile([]), ['/a', '/b'])
    expect(out.managed).toEqual([])
    expect(out.missing).toEqual([])
    expect(out.standalone).toEqual(['/a', '/b'])
  })

  it('no discovered trees: every entry is missing', () => {
    const out = validateAgainstTrees(FILE, [])
    expect(out.managed).toEqual([])
    expect(out.missing.map((e) => e.id)).toEqual(['PRJ-1', 'PRJ-2', 'PRJ-3'])
    expect(out.standalone).toEqual([])
  })

  it('full overlap: everything managed, no missing, no standalone', () => {
    const out = validateAgainstTrees(FILE, ['/ws/three', '/ws/one', '/ws/two'])
    expect(out.managed.map((e) => e.id)).toEqual(['PRJ-1', 'PRJ-2', 'PRJ-3'])
    expect(out.missing).toEqual([])
    expect(out.standalone).toEqual([])
  })
})

describe('validateAgainstTrees — ordering, identity, and purity', () => {
  it('managed/missing keep the registry declaration order; standalone keeps the input order', () => {
    const out = validateAgainstTrees(FILE, ['/ws/zeta', '/ws/one', '/ws/alpha'])
    expect(out.managed.map((e) => e.id)).toEqual(['PRJ-1'])
    expect(out.missing.map((e) => e.id)).toEqual(['PRJ-2', 'PRJ-3'])
    expect(out.standalone).toEqual(['/ws/zeta', '/ws/alpha'])
  })

  it('entries are the SAME object references as in the input file (no copy, no mutation)', () => {
    const out = validateAgainstTrees(FILE, ['/ws/one'])
    expect(out.managed[0]).toBe(FILE.projects[0])
    expect(out.missing[0]).toBe(FILE.projects[1])
    // the input file is untouched
    expect(FILE.projects.map((e) => e.id)).toEqual(['PRJ-1', 'PRJ-2', 'PRJ-3'])
  })

  it('is deterministic (two calls over the same input deep-equal)', () => {
    const a = validateAgainstTrees(FILE, ['/ws/one', '/ws/x'])
    const b = validateAgainstTrees(FILE, ['/ws/one', '/ws/x'])
    expect(a).toEqual(b)
  })

  it('does not alias output arrays between calls (fresh arrays per call)', () => {
    const a = validateAgainstTrees(FILE, [])
    const b = validateAgainstTrees(FILE, [])
    expect(a.missing).not.toBe(b.missing)
    expect(a.standalone).not.toBe(b.standalone)
  })
})

describe('validateAgainstTrees — comparison semantics (pinned contract)', () => {
  it('path comparison is EXACT string equality — no normalization (trailing slash ≠ same path)', () => {
    const out = validateAgainstTrees(FILE, ['/ws/one/'])
    expect(out.managed).toEqual([])
    expect(out.missing.map((e) => e.id)).toEqual(['PRJ-1', 'PRJ-2', 'PRJ-3'])
    expect(out.standalone).toEqual(['/ws/one/'])
  })

  it('duplicate discovered paths are reported once (first occurrence kept)', () => {
    const out = validateAgainstTrees(FILE, ['/x', '/x', '/y'])
    expect(out.standalone).toEqual(['/x', '/y'])
  })

  it(
    'a path claimed by an entry is NOT standalone even when discovered, ' +
      'and a path claimed by NO entry is never managed/missing',
    () => {
      const out = validateAgainstTrees(FILE, ['/ws/one', '/ws/one'])
      expect(out.standalone).toEqual([])
      expect(out.managed.map((e) => e.id)).toEqual(['PRJ-1'])
    },
  )

  it('archived entries participate in the projection (status filtering is T2.2\'s concern)', () => {
    // The archived PRJ-2's path is discovered → managed here (pure set
    // operation over ALL entries — the documented §4 semantics: T2.2
    // filters archived tombstones before prompting; see reconcile.ts).
    const out = validateAgainstTrees(FILE, ['/ws/two'])
    expect(out.managed.map((e) => e.id)).toEqual(['PRJ-2'])
    expect(out.managed[0]).toMatchObject({ status: 'archived' })
    expect(out.missing.map((e) => e.id)).toEqual(['PRJ-1', 'PRJ-3'])
  })
})
