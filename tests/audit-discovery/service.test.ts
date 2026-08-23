/**
 * WP-6.2 — service face (service.ts): operational-KV snapshot
 * persistence + incremental lifecycle + failure isolation + the
 * WP-6.1 feed seam via the service.
 *
 * KV = the operational `meta` table face (DOMAIN_SCHEMA §15, MetaStore
 * seam, WP-1.6) — the 「上次扫描快照（operational KV）」 the 任务书
 * 目标 2 builds the incremental diff on.
 */

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { InMemoryMetaStore } from '../../src/host/persistence/meta/index.js'
import {
  decodeSnapshot,
  DiscoveryScanner,
  DiscoveryScannerError,
  normalizePolicy,
  policyFromWorkspaceDoc,
  SNAPSHOT_KEY,
  untrackedRefsFromPaths,
} from '../../src/host/audit/discovery/index.js'
import { disposeWorkspace, makeTempWorkspace, writeTree } from './helpers.js'

const T0 = 1_760_000_000_000
let nowValue = T0
const now = (): number => nowValue

const roots: string[] = []
function track(root: string): string {
  roots.push(root)
  return root
}
afterEach(() => {
  while (roots.length > 0) disposeWorkspace(roots.pop()!)
  nowValue = T0
})

function smallWorkspace(files: readonly string[]): string {
  const root = track(makeTempWorkspace())
  writeTree(root, files)
  return root
}

describe('DiscoveryScanner.scan — operational KV snapshot lifecycle', () => {
  it('first scan: firstScan diff, snapshot persisted under the pinned KV key', () => {
    const meta = new InMemoryMetaStore()
    const root = smallWorkspace(['results/a.csv', 'results/b.png'])
    const scanner = new DiscoveryScanner(meta, now)
    const report = scanner.scan({
      workspaceRoot: root,
      policy: normalizePolicy({ discovery_zones: [{ path: 'results/' }] }),
    })
    expect(report.diff.firstScan).toBe(true)
    expect(report.diff.added).toEqual(['results/a.csv', 'results/b.png'])
    // snapshot landed in the operational KV
    expect(meta.get(SNAPSHOT_KEY)).not.toBeNull()
    expect(meta.keys()).toEqual([SNAPSHOT_KEY])
    const stored = decodeSnapshot(meta.get(SNAPSHOT_KEY)!)
    expect(stored).toEqual(report.snapshot)
    expect(stored.capturedAt).toBe(T0)
  })

  it('second scan: incremental added/unchanged; third: removals (新增/消失)', () => {
    const meta = new InMemoryMetaStore()
    const root = smallWorkspace(['results/a.csv', 'results/b.png'])
    const policy = normalizePolicy({ discovery_zones: [{ path: 'results/' }] })
    const scanner = new DiscoveryScanner(meta, now)
    scanner.scan({ workspaceRoot: root, policy })

    nowValue = T0 + 1
    writeTree(root, ['results/c.md'])
    const s2 = scanner.scan({ workspaceRoot: root, policy })
    expect(s2.diff).toEqual({
      firstScan: false,
      added: ['results/c.md'],
      removed: [],
      unchanged: ['results/a.csv', 'results/b.png'],
    })
    expect(s2.snapshot.capturedAt).toBe(T0 + 1)
    expect(s2.snapshot.paths).toEqual(['results/a.csv', 'results/b.png', 'results/c.md'])

    nowValue = T0 + 2
    rmSync(join(root, 'results/b.png'))
    const s3 = scanner.scan({ workspaceRoot: root, policy })
    expect(s3.diff).toEqual({
      firstScan: false,
      added: [],
      removed: ['results/b.png'],
      unchanged: ['results/a.csv', 'results/c.md'],
    })
  })

  it('a FAILED scan persists NOTHING — the previous baseline survives', () => {
    const meta = new InMemoryMetaStore()
    const root = smallWorkspace(['results/a.csv'])
    const policy = normalizePolicy({ discovery_zones: [{ path: 'results/' }] })
    const scanner = new DiscoveryScanner(meta, now)
    scanner.scan({ workspaceRoot: root, policy })
    const baseline = meta.get(SNAPSHOT_KEY)!

    rmSync(root, { recursive: true, force: true })
    expect(() => scanner.scan({ workspaceRoot: root, policy })).toThrow(DiscoveryScannerError)
    expect(meta.get(SNAPSHOT_KEY)).toBe(baseline) // unchanged
  })

  it('missing root throws the stable code DISC_ROOT_MISSING', () => {
    const scanner = new DiscoveryScanner(new InMemoryMetaStore(), now)
    try {
      scanner.scan({ workspaceRoot: '/nonexistent/dsh-ws', policy: normalizePolicy(undefined) })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(DiscoveryScannerError)
      expect((e as DiscoveryScannerError).code).toBe('DISC_ROOT_MISSING')
    }
  })

  it('readSnapshot: absent → null; corrupted → DISC_SNAPSHOT_CORRUPT (fail loud, never reset)', () => {
    const meta = new InMemoryMetaStore()
    const scanner = new DiscoveryScanner(meta, now)
    expect(scanner.readSnapshot()).toBeNull()

    meta.set(SNAPSHOT_KEY, 'definitely not json')
    try {
      scanner.readSnapshot()
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(DiscoveryScannerError)
      expect((e as DiscoveryScannerError).code).toBe('DISC_SNAPSHOT_CORRUPT')
    }
    // a scan with a corrupted baseline fails too — no silent re-baseline
    const root = smallWorkspace(['results/a.csv'])
    expect(() =>
      scanner.scan({ workspaceRoot: root, policy: normalizePolicy({ discovery_zones: [{ path: 'results/' }] }) }),
    ).toThrow(DiscoveryScannerError)
    expect(meta.get(SNAPSHOT_KEY)).toBe('definitely not json') // untouched
  })

  it('clearSnapshot resets the baseline (next scan is a first scan)', () => {
    const meta = new InMemoryMetaStore()
    const root = smallWorkspace(['results/a.csv'])
    const policy = normalizePolicy({ discovery_zones: [{ path: 'results/' }] })
    const scanner = new DiscoveryScanner(meta, now)
    scanner.scan({ workspaceRoot: root, policy })
    expect(meta.get(SNAPSHOT_KEY)).not.toBeNull()
    scanner.clearSnapshot()
    expect(meta.get(SNAPSHOT_KEY)).toBeNull()
    expect(scanner.readSnapshot()).toBeNull()
    const again = scanner.scan({ workspaceRoot: root, policy })
    expect(again.diff.firstScan).toBe(true)
    expect(again.diff.added).toEqual(['results/a.csv'])
  })

  it('is stateless across instances sharing the same KV (two scanners, one baseline)', () => {
    const meta = new InMemoryMetaStore()
    const root = smallWorkspace(['results/a.csv'])
    const policy = normalizePolicy({ discovery_zones: [{ path: 'results/' }] })
    const a = new DiscoveryScanner(meta, now)
    const b = new DiscoveryScanner(meta, now)
    a.scan({ workspaceRoot: root, policy })
    const r = b.scan({ workspaceRoot: root, policy })
    expect(r.diff.firstScan).toBe(false)
    expect(r.diff.unchanged).toEqual(['results/a.csv'])
  })

  it('default now() = wall clock (injectable clock is the only time source)', () => {
    const meta = new InMemoryMetaStore()
    const root = smallWorkspace(['results/a.csv'])
    const scanner = new DiscoveryScanner(meta) // default clock
    const before = Date.now()
    const report = scanner.scan({
      workspaceRoot: root,
      policy: normalizePolicy({ discovery_zones: [{ path: 'results/' }] }),
    })
    const after = Date.now()
    expect(report.scannedAt).toBeGreaterThanOrEqual(before)
    expect(report.scannedAt).toBeLessThanOrEqual(after)
  })
})

describe('policyFromWorkspaceDoc (wiring convenience over the loader doc)', () => {
  it('normalizes the §14.1 example (loader-shaped input, defaults materialized)', () => {
    const policy = policyFromWorkspaceDoc({
      workspace: { root: '.', git_required: true },
      audit: {
        strict_tracked: { paths: [] },
        discovery_zones: [{ path: 'results/', artifact_types: ['DATASET', 'FIGURE'] }, { path: 'docs/' }],
        ignored: ['cache/', 'build/', 'tmp/'],
      },
    })
    expect(policy.zones.map((z) => z.dir)).toEqual(['results', 'docs'])
    expect(policy.zones[0]!.artifactTypes).toEqual(['DATASET', 'FIGURE'])
    expect(policy.ignored).toEqual(['cache', 'build', 'tmp'])
    expect(policy.strictTrackedGlobs).toEqual([])
    expect(policyFromWorkspaceDoc(null)).toEqual({ zones: [], ignored: [], strictTrackedGlobs: [] })
  })
})

describe('scanFromUntracked (WP-6.1 seam via the service — pure, no fs/KV)', () => {
  it('feeds the normalized AuditReport untracked shape (adapter + service)', () => {
    const meta = new InMemoryMetaStore()
    const scanner = new DiscoveryScanner(meta, now)
    const policy = normalizePolicy({
      discovery_zones: [{ path: 'results/', artifact_types: ['DATASET', 'FIGURE'] }],
      ignored: ['cache/'],
      strict_tracked: { paths: ['src/**/*.py'] },
    })
    // WP-6.1's actual list shape: string[] of repo-root-relative paths
    // (directories in git `dir/` notation, unexpanded)
    const reportLike = {
      outsideResearch: ['results/new.csv', 'results/run_9/', 'cache/j.bin', 'src/t.py', '.research/x.yaml'],
      insideResearch: ['.research/project.yaml'],
    }
    const result = scanner.scanFromUntracked({
      policy,
      untracked: untrackedRefsFromPaths(reportLike.outsideResearch),
    })
    expect(result.candidates.map((c) => c.path)).toEqual(['results/new.csv'])
    expect(result.candidates[0]).toMatchObject({
      zone: 'results',
      zoneArtifactTypes: ['DATASET', 'FIGURE'],
      suggestedType: 'DATASET',
      sizeBytes: null,
    })
    expect(result.skipped).toEqual([
      { path: '.research/x.yaml', reason: 'RESEARCH_TREE' },
      { path: 'cache/j.bin', reason: 'IGNORED' },
      { path: 'results/run_9/', reason: 'DIRECTORY_MARKER' },
      { path: 'src/t.py', reason: 'STRICT_TRACKED' },
    ])
    // the feed is pure: no KV written, no fs touched
    expect(meta.keys()).toEqual([])
  })

  it('insideResearch entries are NOT fed (declarative tree — the strict layer reports them)', () => {
    const scanner = new DiscoveryScanner(new InMemoryMetaStore(), now)
    const policy = normalizePolicy({ discovery_zones: [{ path: 'results/' }] })
    const result = scanner.scanFromUntracked({
      policy,
      untracked: untrackedRefsFromPaths(['.research/topics/TPC-1/topic.yaml']),
    })
    expect(result.candidates).toEqual([])
    expect(result.skipped).toEqual([{ path: '.research/topics/TPC-1/topic.yaml', reason: 'RESEARCH_TREE' }])
  })
})
