/**
 * Windows cross-platform fix — `src/shared/paths.ts`: the single runtime
 * 「must be an absolute path」 predicate.
 *
 * Pins the platform-agnostic rule (the frozen `ABSOLUTE_PATH_PATTERN`
 * twin in `host/domain/registry/schemas.ts` / `shared/rpc-contracts.ts`):
 * POSIX roots, Windows drive roots (both separator styles), and UNC roots
 * are absolute; everything else — relative, bare names, empty, non-string
 * — is not. The test runs on whichever platform CI uses, so it asserts the
 * CROSS-platform contract (a Windows path is absolute even on POSIX),
 * which is exactly the regression that broke rescan/bind on Windows
 * (`repoRoot must be an absolute path (got "D:\Projects\…")`).
 */
import { describe, expect, it } from 'vitest'

import {
  CROSS_PLATFORM_ABSOLUTE_PATH_PATTERN,
  isAbsolutePath,
} from '../../src/shared/paths.js'

describe('isAbsolutePath — absolute on SOME platform (POSIX or Windows)', () => {
  it.each([
    ['POSIX root', '/workspace/project'],
    ['POSIX root alone', '/'],
    ['POSIX deep', '/a/b/c'],
    ['Windows drive backslash', 'D:\\Projects\\AIUED'],
    ['Windows drive forward slash', 'D:/Projects/AIUED'],
    ['Windows drive alone', 'C:\\'],
    ['Windows drive forward-slash alone', 'C:/'],
    ['UNC root', '\\\\server\\share'],
    ['UNC root with segments', '\\\\server\\share\\ws'],
  ])('%s ⇒ true', (_label, value) => {
    expect(isAbsolutePath(value)).toBe(true)
  })

  it.each([
    ['relative POSIX', 'workspace/project'],
    ['relative dot', './.research'],
    ['dot alone', '.'],
    ['parent alone', '..'],
    ['bare name', 'AIUED'],
    ['drive letter without root', 'D:projects'],
    ['drive letter relative (no slash)', 'C:foo'],
    ['backslash mid-string only', 'a\\b\\c'],
    ['empty string', ''],
  ])('%s ⇒ false', (_label, value) => {
    expect(isAbsolutePath(value)).toBe(false)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['object', { path: '/abs' }],
    ['array', ['/abs']],
  ] as const)('non-string %s ⇒ false (never throws)', (_label, value) => {
    expect(isAbsolutePath(value)).toBe(false)
  })
})

describe('CROSS_PLATFORM_ABSOLUTE_PATH_PATTERN — the frozen twin', () => {
  it('matches exactly what isAbsolutePath accepts (string inputs)', () => {
    const samples = [
      '/abs',
      'D:\\x',
      'D:/x',
      '\\\\unc\\share',
      'rel',
      'C:rel',
      '',
    ]
    for (const s of samples) {
      expect(CROSS_PLATFORM_ABSOLUTE_PATH_PATTERN.test(s)).toBe(isAbsolutePath(s))
    }
  })
})
