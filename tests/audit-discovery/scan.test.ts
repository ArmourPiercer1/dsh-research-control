/**
 * WP-6.2 — read-only workspace walk + scan composition (scan.ts) on
 * synthetic trees (任务书「测试：合成 workspace 树全形态」):
 * 各扩展名 / 嵌套 / policy 允许与排除 / 符号链接 / 空形态 + 只读断言 +
 * 确定性. The full-shape fixture lives in helpers.ts.
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  feedUntracked,
  normalizePolicy,
  scanWorkspace,
  untrackedRefsFromPaths,
  walkWorkspaceFiles,
} from '../../src/host/audit/discovery/index.js'
import {
  addSymlinks,
  disposeWorkspace,
  FULL_TREE_CANDIDATE_PATHS,
  FULL_TREE_FILES,
  FULL_TREE_SYMLINKS,
  fullTreePolicy,
  makeFullWorkspace,
  makeTempWorkspace,
  treeFingerprint,
  writeTree,
} from './helpers.js'

const T_NOW = 1_750_000_000_000
const roots: string[] = []
function track(root: string): string {
  roots.push(root)
  return root
}
afterEach(() => {
  while (roots.length > 0) disposeWorkspace(roots.pop()!)
})

describe('full-shape synthetic tree (all extensions / nesting / policy shapes)', () => {
  it('walk sees exactly the zone-scope files (walk contract), sorted, no .research/.git, no symlink loop', () => {
    const { root, policy } = makeFullWorkspace()
    track(root)
    const { files, zoneDirMissing } = walkWorkspaceFiles(root, policy)
    // walk contract: files ≡ candidate scope — .git/**, .research/**,
    // ignored (cache/**, results/cache/**), out-of-zone (loose.txt),
    // strict-glob (src/train.py) and the dir-symlink loop are all absent
    const expected = FULL_TREE_FILES.filter(
      (rel) =>
        !rel.startsWith('.git/') &&
        !rel.startsWith('.research/') &&
        !rel.startsWith('cache/') &&
        !rel.startsWith('results/cache/') &&
        rel !== 'loose.txt' &&
        rel !== 'results/loop' &&
        rel !== 'src/train.py',
    )
    const withSymlink = [...expected, 'results/link.csv'].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    expect(files.map((f) => f.rel)).toEqual(withSymlink)
    expect(files.map((f) => f.rel)).toEqual([...FULL_TREE_CANDIDATE_PATHS])
    expect(zoneDirMissing).toEqual(['figures'])
    // the file symlink carries lstat size (link length) and the flag
    const link = files.find((f) => f.rel === 'results/link.csv')
    expect(link?.isSymlink).toBe(true)
    expect(typeof link?.sizeBytes).toBe('number')
  })

  it('scan emits exactly the pinned candidate list with mechanical classification', () => {
    const { root, policy } = makeFullWorkspace()
    track(root)
    const report = scanWorkspace({ root, policy, now: () => T_NOW, prevSnapshot: null })
    expect(report.candidates.map((c) => c.path)).toEqual([...FULL_TREE_CANDIDATE_PATHS])
    expect(report.workspaceRoot).toBe(root)
    expect(report.scannedAt).toBe(T_NOW)
    expect(report.policy).toBe(policy)
    expect(report.zoneDirMissing).toEqual(['figures'])
  })

  it('per-candidate classification is pinned (ext / naming / hint / zone attribution)', () => {
    const { root, policy } = makeFullWorkspace()
    track(root)
    const report = scanWorkspace({ root, policy, now: () => T_NOW, prevSnapshot: null })
    const byPath = new Map(report.candidates.map((c) => [c.path, c]))
    const expectCandidate = (
      path: string,
      zone: string | null,
      hint: readonly string[],
      guessed: string | null,
      suggested: string,
    ): void => {
      const c = byPath.get(path)
      expect(c, `candidate ${path}`).toBeDefined()
      expect(c!.zone).toBe(zone)
      expect(c!.zoneArtifactTypes).toEqual(hint)
      expect(c!.guessedType).toBe(guessed)
      expect(c!.suggestedType).toBe(suggested)
      expect(c!.sizeBytes).toBeGreaterThan(0)
    }
    const R = ['DATASET', 'FIGURE']
    expectCandidate('results/data_v1.csv', 'results', R, 'DATASET', 'DATASET')
    expectCandidate('results/figure_1.png', 'results', R, 'FIGURE', 'FIGURE')
    expectCandidate('results/Figure_2.PNG', 'results', R, 'FIGURE', 'FIGURE') // case-insensitive ext
    expectCandidate('results/model.safetensors', 'results', R, 'MODEL', 'MODEL') // hint mismatch: ext still wins
    expectCandidate('results/metadata.txt', 'results', R, 'NOTE', 'NOTE')
    expectCandidate('results/mydata', 'results', R, null, 'DATASET') // naming pattern
    expectCandidate('results/mystery.xyz', 'results', R, null, 'OTHER') // unknown ext, no pattern
    expectCandidate('results/readme', 'results', R, null, 'NOTE') // naming pattern
    expectCandidate('results/data.py', 'results', R, 'CODE', 'CODE') // ext beats naming "data"
    expectCandidate('results/nested/run_7/plot.svg', 'results', R, 'FIGURE', 'FIGURE')
    expectCandidate('results/nested/run_7/archive.csv.gz', 'results', R, 'DATASET', 'DATASET') // double ext
    expectCandidate('results/.hidden.csv', 'results', R, 'DATASET', 'DATASET')
    expectCandidate('results/.env', 'results', R, null, 'OTHER') // dotfile, no signal
    expectCandidate('results/link.csv', 'results', R, 'DATASET', 'DATASET') // file symlink
    expectCandidate('docs/notes.md', 'docs', [], 'NOTE', 'NOTE')
    expectCandidate('docs/paper_draft.pdf', 'docs', [], 'REPORT', 'REPORT')
    expectCandidate('docs/figures/fig.png', 'docs', [], 'FIGURE', 'FIGURE')
    expectCandidate('src/util.js', 'src', [], 'CODE', 'CODE')
    expectCandidate('src/deep/mod.R', 'src', [], 'CODE', 'CODE')
    expectCandidate('src/train2/notes.txt', 'src', [], 'NOTE', 'NOTE')
    // exclusions — never candidates
    for (const excluded of [
      'src/train.py', // strict glob (first layer)
      'results/cache/tmp.bin', // ignored nested (third layer)
      'cache/junk.bin', // ignored top-level
      'loose.txt', // out of every zone
      '.research/project.yaml', // declarative source
      '.git/HEAD', // VCS metadata
    ]) {
      expect(byPath.has(excluded), `excluded ${excluded}`).toBe(false)
    }
  })

  it('first-scan diff: every candidate added, snapshot built from the candidate set', () => {
    const { root, policy } = makeFullWorkspace()
    track(root)
    const report = scanWorkspace({ root, policy, now: () => T_NOW, prevSnapshot: null })
    expect(report.diff.firstScan).toBe(true)
    expect(report.diff.added).toEqual([...FULL_TREE_CANDIDATE_PATHS])
    expect(report.diff.removed).toEqual([])
    expect(report.diff.unchanged).toEqual([])
    expect(report.snapshot).toEqual({
      v: 1,
      capturedAt: T_NOW,
      paths: [...FULL_TREE_CANDIDATE_PATHS],
    })
  })
})

describe('read-only contract (目标 4: 只读扫描)', () => {
  it('a full scan never alters the workspace (independent fingerprint before/after)', () => {
    const { root, policy } = makeFullWorkspace()
    track(root)
    const before = treeFingerprint(root)
    scanWorkspace({ root, policy, now: () => T_NOW, prevSnapshot: null })
    scanWorkspace({ root, policy, now: () => T_NOW + 1, prevSnapshot: null })
    const after = treeFingerprint(root)
    expect(after).toEqual(before)
    // no temp/scratch files appeared anywhere (e.g. .dshrc-tmp)
    const findTmp = (dir: string): string[] => {
      const out: string[] = []
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, e.name)
        if (e.isDirectory() && !e.isSymbolicLink()) out.push(...findTmp(abs))
        else if (e.name.includes('.tmp') || e.name.endsWith('~')) out.push(abs)
      }
      return out
    }
    expect(findTmp(root)).toEqual([])
  })

  it('feedUntracked performs NO filesystem access (nonexistent paths still classify)', () => {
    const policy = fullTreePolicy()
    const result = feedUntracked(policy, [
      { path: 'results/never_written.csv' },
      { path: 'ghost/deep/x.png' },
    ])
    expect(result.candidates.map((c) => c.path)).toEqual(['ghost/deep/x.png', 'results/never_written.csv'])
    expect(result.candidates.every((c) => c.sizeBytes === null)).toBe(true)
    expect(result.candidates[0]!.suggestedType).toBe('FIGURE')
    expect(result.candidates[1]!.suggestedType).toBe('DATASET')
    expect(result.candidates[1]!.zone).toBe('results')
  })
})

describe('determinism', () => {
  it('same tree + same now → byte-identical reports (repeated scans)', () => {
    const { root, policy } = makeFullWorkspace()
    track(root)
    const a = scanWorkspace({ root, policy, now: () => T_NOW, prevSnapshot: null })
    const b = scanWorkspace({ root, policy, now: () => T_NOW, prevSnapshot: null })
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })
})

describe('edge shapes (empty / root zone / zone-as-file / missing root)', () => {
  it('empty workspace (no files at all) → zero candidates, empty diff', () => {
    const root = track(makeTempWorkspace())
    const report = scanWorkspace({ root, policy: fullTreePolicy(), now: () => T_NOW, prevSnapshot: null })
    expect(report.candidates).toEqual([])
    expect(report.diff).toEqual({ firstScan: true, added: [], removed: [], unchanged: [] })
    expect(report.zoneDirMissing).toEqual(['docs', 'empty-zone', 'figures', 'results', 'src'])
  })

  it('empty policy (no zones) scans NOTHING (zones are the whitelist)', () => {
    const { root } = makeFullWorkspace()
    track(root)
    const report = scanWorkspace({ root, policy: normalizePolicy(undefined), now: () => T_NOW, prevSnapshot: null })
    expect(report.candidates).toEqual([])
  })

  it('root zone (path "/") scans everything outside .research/ (minus ignored)', () => {
    const root = track(makeTempWorkspace())
    writeTree(root, [
      '.research/project.yaml',
      'a.csv',
      'nested/b.png',
      'cache/c.bin',
      'loose.txt',
    ])
    const policy = normalizePolicy({ discovery_zones: [{ path: '/' }], ignored: ['cache/'] })
    const report = scanWorkspace({ root, policy, now: () => T_NOW, prevSnapshot: null })
    expect(report.candidates.map((c) => c.path)).toEqual(['a.csv', 'loose.txt', 'nested/b.png'])
    expect(report.candidates[0]!.zone).toBe('')
  })

  it('a zone "dir" occupied by a FILE: reported missing, the file itself is not a candidate', () => {
    const root = track(makeTempWorkspace())
    writeTree(root, ['results', 'results.txt']) // a FILE named results
    const policy = normalizePolicy({ discovery_zones: [{ path: 'results/' }] })
    const report = scanWorkspace({ root, policy, now: () => T_NOW, prevSnapshot: null })
    expect(report.candidates).toEqual([])
    expect(report.zoneDirMissing).toEqual(['results'])
  })

  it('missing / non-directory workspace root throws (raw here; service maps the code)', () => {
    const policy = fullTreePolicy()
    expect(() => walkWorkspaceFiles('/nonexistent/dsh-ws', policy)).toThrow(/does not exist/)
    const root = track(makeTempWorkspace())
    writeFileSync(join(root, 'afile'), 'x')
    expect(() => walkWorkspaceFiles(join(root, 'afile'), policy)).toThrow(/not a directory/)
    expect(() => walkWorkspaceFiles('relative/path', policy)).toThrow(/must be absolute/)
  })

  it('an entirely absent zone dir is just absent (not an error, empty contribution)', () => {
    const root = track(makeTempWorkspace())
    mkdirSync(join(root, 'results'), { recursive: true })
    writeTree(root, ['results/a.csv', 'ghost/a.csv'])
    const policy = normalizePolicy({ discovery_zones: [{ path: 'results/' }, { path: 'ghost/' }] })
    const report = scanWorkspace({ root, policy, now: () => T_NOW, prevSnapshot: null })
    expect(report.candidates.map((c) => c.path)).toEqual(['ghost/a.csv', 'results/a.csv'])
    expect(report.zoneDirMissing).toEqual([])
  })
})

describe('incremental diff through scanWorkspace (prev snapshot from a prior scan)', () => {
  it('add → remove → steady (three scans over a live tree)', () => {
    const root = track(makeTempWorkspace())
    writeTree(root, ['results/a.csv', 'results/b.png'])
    const policy = normalizePolicy({ discovery_zones: [{ path: 'results/' }] })

    const s1 = scanWorkspace({ root, policy, now: () => T_NOW, prevSnapshot: null })
    expect(s1.diff).toEqual({ firstScan: true, added: ['results/a.csv', 'results/b.png'], removed: [], unchanged: [] })

    writeTree(root, ['results/c.md'])
    const s2 = scanWorkspace({ root, policy, now: () => T_NOW + 1, prevSnapshot: s1.snapshot })
    expect(s2.diff).toEqual({ firstScan: false, added: ['results/c.md'], removed: [], unchanged: ['results/a.csv', 'results/b.png'] })

    rmSync(join(root, 'results/b.png'))
    const s3 = scanWorkspace({ root, policy, now: () => T_NOW + 2, prevSnapshot: s2.snapshot })
    expect(s3.diff).toEqual({ firstScan: false, added: [], removed: ['results/b.png'], unchanged: ['results/a.csv', 'results/c.md'] })
  })

  it('content change alone is NOT a diff (path-level semantics — Git owns content versioning)', () => {
    const root = track(makeTempWorkspace())
    writeTree(root, ['results/a.csv'])
    const policy = normalizePolicy({ discovery_zones: [{ path: 'results/' }] })
    const s1 = scanWorkspace({ root, policy, now: () => T_NOW, prevSnapshot: null })
    writeFileSync(join(root, 'results/a.csv'), 'CHANGED-CONTENT-12345\n')
    const s2 = scanWorkspace({ root, policy, now: () => T_NOW + 1, prevSnapshot: s1.snapshot })
    expect(s2.diff).toEqual({ firstScan: false, added: [], removed: [], unchanged: ['results/a.csv'] })
  })
})

describe('feedUntracked (WP-6.1 seam — mechanical, no fs)', () => {
  const policy = fullTreePolicy()

  it('classifies in-zone, out-of-zone (zone=null), and skips with reasons — every entry lands exactly once', () => {
    const result = feedUntracked(policy, [
      { path: 'results/new.csv', status: '??' },
      { path: 'stray/readme.txt' },
      { path: './docs/notes.md' },
      { path: 'results/' },
      { path: '.research/project.yaml' },
      { path: '.research/topics/TPC-1/topic.yaml' },
      { path: '.git/index' },
      { path: 'cache/junk.bin' },
      { path: 'src/train.py' },
      { path: '/abs/x.csv' },
      { path: 'a/../b.csv' },
      { path: '' },
    ])
    expect(result.candidates.map((c) => c.path)).toEqual([
      'docs/notes.md',
      'results/new.csv',
      'stray/readme.txt',
    ])
    const byPath = new Map(result.candidates.map((c) => [c.path, c]))
    expect(byPath.get('results/new.csv')).toMatchObject({
      zone: 'results',
      zoneArtifactTypes: ['DATASET', 'FIGURE'],
      guessedType: 'DATASET',
      suggestedType: 'DATASET',
      sizeBytes: null,
    })
    expect(byPath.get('stray/readme.txt')).toMatchObject({
      zone: null,
      zoneArtifactTypes: [],
      guessedType: 'NOTE',
      suggestedType: 'NOTE',
      sizeBytes: null,
    })
    expect(byPath.get('docs/notes.md')!.zone).toBe('docs')
    expect(result.skipped).toEqual([
      { path: '', reason: 'BAD_PATH' },
      { path: '.git/index', reason: 'VCS_METADATA' },
      { path: '.research/project.yaml', reason: 'RESEARCH_TREE' },
      { path: '.research/topics/TPC-1/topic.yaml', reason: 'RESEARCH_TREE' },
      { path: '/abs/x.csv', reason: 'BAD_PATH' },
      { path: 'a/../b.csv', reason: 'BAD_PATH' },
      { path: 'cache/junk.bin', reason: 'IGNORED' },
      { path: 'results/', reason: 'DIRECTORY_MARKER' },
      { path: 'src/train.py', reason: 'STRICT_TRACKED' },
    ])
  })

  it('is deterministic under input shuffle (sorted output, same sets)', () => {
    const entries = [
      { path: 'b/2.png' },
      { path: 'a/1.csv' },
      { path: 'cache/x' },
      { path: 'z.md' },
    ]
    const r1 = feedUntracked(policy, entries)
    const r2 = feedUntracked(policy, [...entries].reverse())
    expect(r2.candidates.map((c) => c.path)).toEqual(['a/1.csv', 'b/2.png', 'z.md'])
    expect(r2.skipped).toEqual(r1.skipped)
    expect(r1.candidates.map((c) => c.path)).toEqual(r2.candidates.map((c) => c.path))
  })

  it('untrackedRefsFromPaths lifts WP-6.1 string[] (newFiles.outsideResearch) 1:1', () => {
    const refs = untrackedRefsFromPaths(['results/a.csv', 'docs/b.md'])
    expect(refs).toEqual([{ path: 'results/a.csv' }, { path: 'docs/b.md' }])
    const result = feedUntracked(policy, refs)
    expect(result.candidates.map((c) => c.path)).toEqual(['docs/b.md', 'results/a.csv'])
  })

  it('a path that is BOTH a strict-glob hit and in a zone → STRICT_TRACKED skip (no double-report)', () => {
    const result = feedUntracked(policy, [{ path: 'src/train.py' }])
    expect(result.candidates).toEqual([])
    expect(result.skipped).toEqual([{ path: 'src/train.py', reason: 'STRICT_TRACKED' }])
  })

  it('a path that is BOTH ignored and in a zone → IGNORED skip (third layer wins)', () => {
    const result = feedUntracked(policy, [{ path: 'results/cache/tmp.bin' }])
    expect(result.candidates).toEqual([])
    expect(result.skipped).toEqual([{ path: 'results/cache/tmp.bin', reason: 'IGNORED' }])
  })
})

describe('full fixture: scan + feed agree on the shared classification', () => {
  it('a file present on disk and in the untracked list classifies identically', () => {
    const { root, policy } = makeFullWorkspace()
    track(root)
    const fsReport = scanWorkspace({ root, policy, now: () => T_NOW, prevSnapshot: null })
    const fsCand = fsReport.candidates.find((c) => c.path === 'results/data_v1.csv')!
    const feed = feedUntracked(policy, [{ path: 'results/data_v1.csv', status: '??' }])
    const fed = feed.candidates[0]!
    expect({
      path: fed.path,
      zone: fed.zone,
      zoneArtifactTypes: fed.zoneArtifactTypes,
      guessedType: fed.guessedType,
      suggestedType: fed.suggestedType,
    }).toEqual({
      path: fsCand.path,
      zone: fsCand.zone,
      zoneArtifactTypes: fsCand.zoneArtifactTypes,
      guessedType: fsCand.guessedType,
      suggestedType: fsCand.suggestedType,
    })
  })
})
