/**
 * V2-T2.3 — entry state machine: `archiveEntry` / `restoreEntry` /
 * `upsertEntry` — success edges + rejection edges + immutability
 * (design §4「移除登记」, §7.4「恢复登记」, §8 接入; 条目状态机纯函数，
 * 不可变更新，未知 id 报错).
 */

import { describe, expect, it } from 'vitest'

import {
  archiveEntry,
  findEntry,
  parseRegistry,
  RegistryMutationError,
  restoreEntry,
  upsertEntry,
  type RegistryEntry,
  type RegistryFile,
  type RegistryMutationCode,
} from '../../src/host/domain/registry/index.js'
import { ACTIVE_ENTRY, ARCHIVED_ENTRY, makeFile, THIRD_ENTRY } from './fixtures.js'

/** Capture a RegistryMutationError (fail the test if nothing was thrown). */
function expectMutationError(fn: () => unknown, code: RegistryMutationCode, entryId?: string): RegistryMutationError {
  let thrown: unknown
  try {
    fn()
  } catch (e) {
    thrown = e
  }
  expect(thrown, 'expected a RegistryMutationError').toBeInstanceOf(RegistryMutationError)
  const err = thrown as RegistryMutationError
  expect(err.code).toBe(code)
  if (entryId !== undefined) expect(err.entryId).toBe(entryId)
  return err
}

/** Snapshot helper: deep copy for the "input untouched" assertions. */
function snapshot(file: RegistryFile): RegistryFile {
  return structuredClone(file)
}

describe('archiveEntry (active → archived)', () => {
  it('archives the entry, stamping archivedAt with the given ts; other entries untouched', () => {
    const file = makeFile()
    const before = snapshot(file)
    const out = archiveEntry(file, 'PRJ-1', 1780000000000)
    expect(out).not.toBe(file)
    expect(out.projects[0]).toEqual({ ...ACTIVE_ENTRY, status: 'archived', archivedAt: 1780000000000 })
    // the untouched entry is preserved (deep-equal copy in the fresh structure)
    expect(out.projects[1]).toEqual(ARCHIVED_ENTRY)
    // the input file is never mutated: the entry object the caller
    // handed in is still the very same (unreplaced, unfrozen) fixture
    expect(file).toEqual(before)
    expect(file.projects[0]).toBe(ACTIVE_ENTRY)
    // output is deep-frozen
    expect(Object.isFrozen(out)).toBe(true)
    expect(Object.isFrozen(out.projects[0])).toBe(true)
  })

  it('accepts ts = 0 (the non-negative boundary)', () => {
    const out = archiveEntry(makeFile(), 'PRJ-1', 0)
    expect(out.projects[0]).toMatchObject({ status: 'archived', archivedAt: 0 })
  })

  it('rejects an unknown id (ENTRY_NOT_FOUND, known ids listed)', () => {
    const err = expectMutationError(() => archiveEntry(makeFile(), 'PRJ-9', 1), 'ENTRY_NOT_FOUND', 'PRJ-9')
    expect(err.message).toContain('"PRJ-9"')
    expect(err.message).toContain('PRJ-1')
    expect(err.message).toContain('PRJ-2')
  })

  it('rejects an already-archived entry (ALREADY_ARCHIVED — no silent no-op)', () => {
    const err = expectMutationError(
      () => archiveEntry(makeFile(), 'PRJ-2', 1790000000000),
      'ALREADY_ARCHIVED',
      'PRJ-2',
    )
    expect(err.message).toContain('already archived')
    expect(err.message).toContain('1765000000000')
  })

  it.each([
    ['-1', -1],
    ['1.5', 1.5],
    ['NaN', Number.NaN],
  ])('rejects a non-integer/negative ts %s (INVALID_TIMESTAMP)', (_label, ts) => {
    expectMutationError(() => archiveEntry(makeFile(), 'PRJ-1', ts), 'INVALID_TIMESTAMP', 'PRJ-1')
  })
})

describe('restoreEntry (archived → active)', () => {
  it('restores the entry and clears archivedAt to null', () => {
    const file = makeFile()
    const before = snapshot(file)
    const out = restoreEntry(file, 'PRJ-2')
    expect(out.projects[1]).toEqual({ ...ARCHIVED_ENTRY, status: 'active', archivedAt: null })
    expect(out.projects[0]).toEqual(ACTIVE_ENTRY)
    expect(file).toEqual(before)
  })

  it('archive → restore round-trips the entry back to active with archivedAt null', () => {
    const file = makeFile()
    const out = restoreEntry(archiveEntry(file, 'PRJ-1', 1780000000000), 'PRJ-1')
    expect(out.projects[0]).toEqual(ACTIVE_ENTRY)
  })

  it('rejects an unknown id (ENTRY_NOT_FOUND)', () => {
    expectMutationError(() => restoreEntry(makeFile(), 'PRJ-9'), 'ENTRY_NOT_FOUND', 'PRJ-9')
  })

  it('rejects an already-active entry (NOT_ARCHIVED — nothing to restore)', () => {
    const err = expectMutationError(() => restoreEntry(makeFile(), 'PRJ-1'), 'NOT_ARCHIVED', 'PRJ-1')
    expect(err.message).toContain('already active')
  })
})

describe('upsertEntry (insert / replace)', () => {
  it('appends a new entry at the end (insert edge)', () => {
    const file = makeFile()
    const before = snapshot(file)
    const out = upsertEntry(file, THIRD_ENTRY)
    expect(out.projects.map((e) => e.id)).toEqual(['PRJ-1', 'PRJ-2', 'PRJ-3'])
    expect(out.projects[2]).toEqual(THIRD_ENTRY)
    expect(out.projects[0]).toEqual(ACTIVE_ENTRY)
    expect(out.projects[1]).toEqual(ARCHIVED_ENTRY)
    expect(file).toEqual(before)
    expect(Object.isFrozen(out.projects[2])).toBe(true)
  })

  it('replaces an existing entry IN PLACE (position and siblings preserved)', () => {
    const file = makeFile()
    const rebind: RegistryEntry = {
      id: 'PRJ-2',
      path: '/workspaces/moved-survey',
      displayName: '迁移后的调研项目',
      status: 'active',
      boundAt: 1772000000000,
      archivedAt: null,
    }
    const out = upsertEntry(file, rebind)
    expect(out.projects.map((e) => e.id)).toEqual(['PRJ-1', 'PRJ-2'])
    expect(out.projects[1]).toEqual(rebind)
    expect(out.projects[0]).toEqual(ACTIVE_ENTRY)
    expect(out.projects).not.toBe(file.projects)
    expect(file.projects[1]).toEqual(ARCHIVED_ENTRY) // input untouched
  })

  it('works over a parser-produced (frozen) file', () => {
    const file = parseRegistry('version: 1\nprojects: []\n')
    const out = upsertEntry(file, ACTIVE_ENTRY)
    expect(out.projects).toEqual([ACTIVE_ENTRY])
    expect(file.projects).toEqual([]) // the frozen input is untouched
  })

  it('rejects a malformed id (INVALID_ENTRY, field named)', () => {
    const err = expectMutationError(
      () => upsertEntry(makeFile(), { ...ACTIVE_ENTRY, id: 'TPC-1' }),
      'INVALID_ENTRY',
      'TPC-1',
    )
    expect(err.message).toContain('/id')
  })

  it('rejects an active entry carrying archivedAt (INVALID_ENTRY, cross-rule)', () => {
    expectMutationError(
      () => upsertEntry(makeFile(), { ...ACTIVE_ENTRY, archivedAt: 42 }),
      'INVALID_ENTRY',
      'PRJ-1',
    )
  })

  it('rejects an archived entry without archivedAt (INVALID_ENTRY, cross-rule)', () => {
    expectMutationError(
      () =>
        upsertEntry(makeFile(), {
          id: 'PRJ-9',
          path: '/x',
          displayName: 'd',
          status: 'archived',
          boundAt: 1,
          archivedAt: null,
        }),
      'INVALID_ENTRY',
      'PRJ-9',
    )
  })

  it('rejects unknown entry keys (INVALID_ENTRY, strict schema)', () => {
    const err = expectMutationError(
      () => upsertEntry(makeFile(), { ...ACTIVE_ENTRY, extra: true } as unknown as RegistryEntry),
      'INVALID_ENTRY',
      'PRJ-1',
    )
    expect(err.message).toContain('extra')
  })

  it('rejects a relative path and a negative boundAt (INVALID_ENTRY)', () => {
    expectMutationError(
      () => upsertEntry(makeFile(), { ...ACTIVE_ENTRY, path: 'relative' }),
      'INVALID_ENTRY',
      'PRJ-1',
    )
    expectMutationError(
      () => upsertEntry(makeFile(), { ...ACTIVE_ENTRY, boundAt: -3 }),
      'INVALID_ENTRY',
      'PRJ-1',
    )
  })
})

describe('findEntry', () => {
  it('returns the matching entry by id (same object reference)', () => {
    const file = makeFile()
    expect(findEntry(file, 'PRJ-2')).toBe(file.projects[1])
    expect(findEntry(file, 'PRJ-1')).toBe(file.projects[0])
  })

  it('rejects an unknown id (ENTRY_NOT_FOUND)', () => {
    expectMutationError(() => findEntry(makeFile(), 'PRJ-9'), 'ENTRY_NOT_FOUND', 'PRJ-9')
  })
})
