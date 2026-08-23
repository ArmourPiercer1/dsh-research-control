/**
 * WP-6.2 — policy normalization + three-layer partition (policy.ts).
 *
 * 钉 §14.1 原文语义: zones = 目录白名单（前缀语义, 非 glob）;
 * ignored = 第三层位置前缀（不扫描）; strict_tracked = 第一层 glob
 * （显式 glob 语义, 区别于 zone）. 优先级钉: IGNORED > STRICT_TRACKED
 * > ZONE > OUT_OF_SCOPE（层 partition 无重叠, 6.3 不重复计数）.
 */

import { describe, expect, it } from 'vitest'

import {
  classifyPath,
  compileGlob,
  DiscoveryPolicyError,
  isIgnored,
  isStrictTracked,
  matchZone,
  normalizeFeedPath,
  normalizePolicy,
  normalizePolicyPath,
} from '../../src/host/audit/discovery/index.js'
import { FULL_TREE_AUDIT, fullTreePolicy } from './helpers.js'

describe('normalizePolicy (§14.1 defaults + normalization)', () => {
  it('missing audit → all empty (empty policy scans NOTHING — zones are the whitelist)', () => {
    expect(normalizePolicy(undefined)).toEqual({ zones: [], ignored: [], strictTrackedGlobs: [] })
    expect(normalizePolicy(null)).toEqual({ zones: [], ignored: [], strictTrackedGlobs: [] })
    expect(normalizePolicy({})).toEqual({ zones: [], ignored: [], strictTrackedGlobs: [] })
  })

  it('parses the §14.1 example block verbatim (defaults materialized)', () => {
    const p = normalizePolicy({
      strict_tracked: { paths: [] },
      discovery_zones: [
        { path: 'results/', artifact_types: ['DATASET', 'FIGURE'] },
        { path: 'docs/' },
      ],
      ignored: ['cache/', 'build/', 'tmp/'],
    })
    expect(p.zones).toEqual([
      { rawPath: 'results/', dir: 'results', artifactTypes: ['DATASET', 'FIGURE'] },
      { rawPath: 'docs/', dir: 'docs', artifactTypes: [] },
    ])
    expect(p.ignored).toEqual(['cache', 'build', 'tmp'])
    expect(p.strictTrackedGlobs).toEqual([])
  })

  it('normalizes path shapes: trailing/leading slash, ./ prefix, backslash, doubled slash', () => {
    const p = normalizePolicy({
      discovery_zones: [
        { path: './results/' },
        { path: '/docs' },
        { path: 'a\\b' },
        { path: '//x//y/' },
        { path: '.' },
      ],
      ignored: ['tmp//'],
    })
    expect(p.zones.map((z) => z.dir)).toEqual(['results', 'docs', 'a/b', 'x/y', ''])
    expect(p.ignored).toEqual(['tmp'])
  })

  it('zone path "." or "/" = the workspace root (dir "")', () => {
    const p = normalizePolicy({ discovery_zones: [{ path: '/' }] })
    expect(p.zones).toEqual([{ rawPath: '/', dir: '', artifactTypes: [] }])
  })

  it('duplicate zone dirs merge; first hint wins ordering, empty hint backfilled once', () => {
    const p = normalizePolicy({
      discovery_zones: [
        { path: 'results/' },
        { path: 'results', artifact_types: ['FIGURE', 'DATASET'] },
        { path: './results/', artifact_types: ['REPORT'] },
      ],
    })
    expect(p.zones).toHaveLength(1)
    expect(p.zones[0]!.dir).toBe('results')
    expect(p.zones[0]!.artifactTypes).toEqual(['FIGURE', 'DATASET']) // first non-empty hint kept
    expect(p.zones[0]!.rawPath).toBe('results/')
  })

  it('non-string artifact_types entries are passed through as given (loader already schema-validated)', () => {
    // loader ajv rejects wrong enums before this layer; the normalizer
    // only shapes — an array of strings is the validated input shape
    const p = normalizePolicy({ discovery_zones: [{ path: 'z/', artifact_types: ['NOTE'] }] })
    expect(p.zones[0]!.artifactTypes).toEqual(['NOTE'])
  })

  it('.. segments are rejected fail-loud (policy must stay inside the workspace root)', () => {
    expect(() => normalizePolicyPath('../x', 'zone')).toThrow(DiscoveryPolicyError)
    expect(() => normalizePolicyPath('a/../b', 'ignored[0]')).toThrow(DiscoveryPolicyError)
    expect(() => normalizePolicy({ discovery_zones: [{ path: '../../etc' }] })).toThrow(DiscoveryPolicyError)
    expect(() => normalizePolicy({ ignored: ['..'] })).toThrow(DiscoveryPolicyError)
    expect(() => normalizePolicy({ strict_tracked: { paths: ['a/**/..'] } })).toThrow(DiscoveryPolicyError)
    expect(() => normalizePolicy({ discovery_zones: [{ path: 'ok' }, { path: 'bad/../bad' }] })).toThrow(DiscoveryPolicyError)
  })

  it('zone entry without a non-empty path throws (schema requires path minLength 1; double guard)', () => {
    expect(() => normalizePolicy({ discovery_zones: [{ path: '' }] as never })).toThrow(DiscoveryPolicyError)
  })

  it('full-tree fixture policy normalizes as pinned', () => {
    const p = fullTreePolicy()
    expect(p.zones.map((z) => z.dir)).toEqual(['results', 'docs', 'src', 'figures', 'empty-zone'])
    expect(p.zones[0]!.artifactTypes).toEqual(['DATASET', 'FIGURE'])
    expect(p.ignored).toEqual(['cache', 'results/cache'])
    expect(p.strictTrackedGlobs).toEqual(['src/**/*.py'])
    void FULL_TREE_AUDIT
  })
})

describe('zone matching (directory-whitelist semantics, strictly-under)', () => {
  const p = fullTreePolicy()

  it('files under a zone dir match (any depth)', () => {
    expect(matchZone(p, 'results/a.csv')?.dir).toBe('results')
    expect(matchZone(p, 'results/nested/run_7/plot.svg')?.dir).toBe('results')
    expect(matchZone(p, 'docs/x/y/z.md')?.dir).toBe('docs')
    expect(matchZone(p, 'src/deep/mod.R')?.dir).toBe('src') // policy wrote `src` without slash
  })

  it('a file EQUAL to the zone name is NOT under it (zone is a directory whitelist)', () => {
    expect(matchZone(p, 'results')).toBeNull()
    expect(matchZone(p, 'docs')).toBeNull()
  })

  it('out-of-zone paths match nothing', () => {
    expect(matchZone(p, 'loose.txt')).toBeNull()
    expect(matchZone(p, 'other/x.csv')).toBeNull()
  })

  it('zone glob characters are literal (zones are NOT globs — §22.1 目录白名单)', () => {
    const q = normalizePolicy({ discovery_zones: [{ path: 'a*/b' }] })
    expect(matchZone(q, 'a*/b/file.txt')?.dir).toBe('a*/b')
    expect(matchZone(q, 'ax/b/file.txt')).toBeNull()
  })

  it('root zone ("") matches every path', () => {
    const q = normalizePolicy({ discovery_zones: [{ path: '/' }] })
    expect(matchZone(q, 'anything/at/all.txt')?.dir).toBe('')
    expect(matchZone(q, 'top.txt')?.dir).toBe('')
  })

  it('first zone wins on overlap', () => {
    const q = normalizePolicy({ discovery_zones: [{ path: 'a/b/' }, { path: 'a/' }] })
    expect(matchZone(q, 'a/b/x')?.dir).toBe('a/b')
    expect(matchZone(q, 'a/c/x')?.dir).toBe('a')
  })
})

describe('ignored (third layer, location prefix)', () => {
  const p = fullTreePolicy()

  it('top-level ignored dir and nested ignored location are both 不扫描', () => {
    expect(isIgnored(p, 'cache/junk.bin')).toBe(true)
    expect(isIgnored(p, 'cache/deep/x')).toBe(true)
    expect(isIgnored(p, 'results/cache/tmp.bin')).toBe(true)
  })

  it('location prefix only (no per-segment magic): an inner dir of the same name outside the listed location is NOT ignored', () => {
    // `cache` listed at top level and as `results/cache` only —
    // `docs/cache/x` is not in the policy → scanned if under a zone
    expect(isIgnored(p, 'docs/cache/x')).toBe(false)
  })

  it('a file literally named like the ignored entry is excluded (prefix-or-equal rule)', () => {
    expect(isIgnored(p, 'cache')).toBe(true)
  })
})

describe('strict globs (first layer, explicit glob semantics)', () => {
  const p = fullTreePolicy()

  it('src/**/*.py matches at any depth, not other extensions', () => {
    expect(isStrictTracked(p, 'src/train.py')).toBe(true)
    expect(isStrictTracked(p, 'src/deep/nest/a.py')).toBe(true)
    expect(isStrictTracked(p, 'src/util.js')).toBe(false)
  })

  it('compileGlob: the V1 subset is pinned behaviorally', () => {
    const cases: Array<[glob: string, path: string, expected: boolean]> = [
      ['*', 'a', true],
      ['*', 'a/b', false], // * never crosses /
      ['a/*', 'a/b', true],
      ['a/*', 'a/b/c', false],
      ['a/**', 'a/b', true],
      ['a/**', 'a/b/c/d', true],
      ['a/**', 'a', false], // a/** is UNDER a — the dir itself is not a file
      ['a/**/b', 'a/b', true], // ** = zero segments
      ['a/**/b', 'a/x/b', true],
      ['a/**/b', 'a/x/y/b', true],
      ['a/**/b', 'x/b', false],
      ['**/test.py', 'test.py', true],
      ['**/test.py', 'a/b/test.py', true],
      ['**/test.py', 'a/b/test.ts', false],
      ['*.py', 'x.py', true],
      ['*.py', 'a/x.py', false], // no ** = root-anchored
      ['src/', 'src/a', true], // trailing / = directory glob
      ['src/', 'src/a/b', true],
      ['src/', 'srcx/a', false],
      ['src', 'src', true], // no slash = exact file name at root
      ['src', 'src/a', false],
      ['?.csv', 'a.csv', true],
      ['?.csv', 'ab.csv', false],
      ['data-?.csv', 'data-1.csv', true],
      ['data-?.csv', 'data-12.csv', false],
      ['lit.eral.txt', 'lit.eral.txt', true], // literal dots escaped
      ['lit.eral.txt', 'litXeral.txt', false],
      ['/', 'a', true], // root directory glob
      ['/', 'a/b/c', true],
      ['', 'a', false], // empty glob = no-op
    ]
    for (const [glob, path, expected] of cases) {
      const re = compileGlob(glob)
      const got = re === null ? false : re.test(path)
      expect(got, `glob=${JSON.stringify(glob)} path=${path}`).toBe(expected)
    }
  })

  it('a glob entry that is "" is a no-op (matches nothing)', () => {
    const q = normalizePolicy({ strict_tracked: { paths: [''] } })
    expect(q.strictTrackedGlobs).toEqual([''])
    expect(isStrictTracked(q, 'anything.txt')).toBe(false)
  })
})

describe('classifyPath (layer precedence: IGNORED > STRICT_TRACKED > ZONE > OUT)', () => {
  const p = fullTreePolicy()

  it('full-tree spot checks across all four layers', () => {
    expect(classifyPath(p, 'results/data_v1.csv')).toBe('ZONE')
    expect(classifyPath(p, 'docs/notes.md')).toBe('ZONE')
    expect(classifyPath(p, 'src/util.js')).toBe('ZONE')
    expect(classifyPath(p, 'src/train.py')).toBe('STRICT_TRACKED') // zone + strict → strict wins
    expect(classifyPath(p, 'results/cache/tmp.bin')).toBe('IGNORED') // zone + ignored → ignored wins
    expect(classifyPath(p, 'cache/junk.bin')).toBe('IGNORED')
    expect(classifyPath(p, 'loose.txt')).toBe('OUT_OF_SCOPE')
    expect(classifyPath(p, 'results')).toBe('OUT_OF_SCOPE') // the zone dir name as a file
  })

  it('an entry claimed by ALL three layers resolves IGNORED first', () => {
    const q = normalizePolicy({
      discovery_zones: [{ path: 'x/' }],
      ignored: ['x/'],
      strict_tracked: { paths: ['x/*'] },
    })
    expect(classifyPath(q, 'x/f.txt')).toBe('IGNORED')
  })
})

describe('normalizeFeedPath (WP-6.1 input contract)', () => {
  it('accepts relative paths, strips one leading ./', () => {
    expect(normalizeFeedPath('results/a.csv')).toBe('results/a.csv')
    expect(normalizeFeedPath('./results/a.csv')).toBe('results/a.csv')
  })

  it('rejects empty / absolute / .. entries (BAD_PATH)', () => {
    expect(normalizeFeedPath('')).toBeNull()
    expect(normalizeFeedPath('./')).toBeNull()
    expect(normalizeFeedPath('/abs/a.csv')).toBeNull()
    expect(normalizeFeedPath('a/../b.csv')).toBeNull()
    expect(normalizeFeedPath('..')).toBeNull()
  })

  it('does NOT rewrite backslashes (git emits real names on POSIX)', () => {
    expect(normalizeFeedPath('results/a\\b.csv')).toBe('results/a\\b.csv')
  })
})
