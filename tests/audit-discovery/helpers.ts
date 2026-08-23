/**
 * WP-6.2 — tests/audit-discovery shared helpers: synthetic workspace
 * trees on real fs (mkdtemp) + the full-shape fixture tree + a
 * deterministic policy factory.
 *
 * Tree convention: paths are relative to the created root; every entry
 * is a plain file unless marked otherwise. Cleanup is per-test
 * (afterEach rm -rf) — tests never touch anything outside tmp.
 */

import { lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { normalizePolicy } from '../../src/host/audit/discovery/index.js'
import type { DiscoveryPolicy } from '../../src/host/audit/discovery/index.js'
import type { WorkspaceDoc } from '../../src/host/domain/loader/index.js'

/** Create one temp workspace root (unique per call). */
export function makeTempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-audit-discovery-'))
}

/** Write a full synthetic tree (content = deterministic marker per file). */
export function writeTree(root: string, spec: readonly string[]): void {
  for (const rel of spec) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, `x:${rel}\n`)
  }
}

export interface SymlinkSpec {
  /** Relative link path. */
  link: string
  /** Relative (to the link's own directory) or absolute target. */
  target: string
}

/** Create symlinks AFTER writeTree (targets must exist or be broken). */
export function addSymlinks(root: string, specs: readonly SymlinkSpec[]): void {
  for (const { link, target } of specs) {
    const abs = join(root, link)
    mkdirSync(dirname(abs), { recursive: true })
    symlinkSync(target, abs, 'junction')
  }
}

/**
 * The FULL-SHAPE fixture tree (each extension/nesting/policy shape):
 *  - `.git/` + `.research/` (declarative tree, two levels) — never candidates
 *  - zone `results/` (hint [DATASET, FIGURE]): every classification shape
 *    (ext hit / ext miss / case-insensitivity / dotfile / double ext /
 *    naming pattern / ext-over-naming / hint mismatch / file symlink /
 *    dir-symlink loop)
 *  - zone `docs/` (no hint): nested subdir figure
 *  - zone `src` (no trailing slash in policy): strict-glob overlap
 *  - `cache/` + `results/cache/` ignored (top-level + nested locations)
 *  - `loose.txt` out of every zone
 *  - `figures/` in policy but ABSENT (zoneDirMissing)
 *  - `empty-zone/` in policy and present but EMPTY
 */
export const FULL_TREE_FILES: readonly string[] = [
  // declarative / VCS — never candidates
  '.git/HEAD',
  '.research/project.yaml',
  '.research/topics/TPC-1/topic.yaml',
  // zone results/ (hint DATASET, FIGURE)
  'results/data_v1.csv',
  'results/figure_1.png',
  'results/Figure_2.PNG',
  'results/model.safetensors',
  'results/metadata.txt',
  'results/mydata',
  'results/mystery.xyz',
  'results/readme',
  'results/data.py',
  'results/nested/run_7/plot.svg',
  'results/nested/run_7/archive.csv.gz',
  'results/.hidden.csv',
  'results/.env',
  // zone docs/ (no hint)
  'docs/notes.md',
  'docs/paper_draft.pdf',
  'docs/figures/fig.png',
  // zone src (strict glob src/**/*.py overlaps train.py)
  'src/train.py',
  'src/util.js',
  'src/deep/mod.R',
  'src/train2/notes.txt',
  // ignored (third layer)
  'cache/junk.bin',
  'results/cache/tmp.bin',
  // out of scope (no zone)
  'loose.txt',
]

/** Symlinks for the full tree (file link + an escaping dir link). */
export const FULL_TREE_SYMLINKS: readonly SymlinkSpec[] = [
  { link: 'results/link.csv', target: 'data_v1.csv' }, // relative to the link's dir
  { link: 'results/loop', target: '../../..' }, // dir symlink escaping the zone (loop guard)
]

/**
 * The §14.1 workspace.yaml audit block for the full tree (frozen fixture
 * — the policy the scanner must handle in every shape).
 */
export const FULL_TREE_AUDIT: NonNullable<WorkspaceDoc['audit']> = {
  strict_tracked: { paths: ['src/**/*.py'] },
  discovery_zones: [
    { path: 'results/', artifact_types: ['DATASET', 'FIGURE'] },
    { path: 'docs/' },
    { path: 'src' },
    { path: 'figures/' },
    { path: 'empty-zone/' },
  ],
  ignored: ['cache/', 'results/cache/'],
}

/** The normalized policy for the full tree (schema defaults applied). */
export function fullTreePolicy(): DiscoveryPolicy {
  return normalizePolicy(FULL_TREE_AUDIT)
}

/** A fresh temp root with the full tree materialized. */
export function makeFullWorkspace(): { root: string; policy: DiscoveryPolicy } {
  const root = makeTempWorkspace()
  writeTree(root, FULL_TREE_FILES)
  // `empty-zone` is in the policy and must EXIST but stay EMPTY (zero
  // candidates, not in zoneDirMissing) — writeTree only makes file dirs
  mkdirSync(join(root, 'empty-zone'), { recursive: true })
  addSymlinks(root, FULL_TREE_SYMLINKS)
  return { root, policy: fullTreePolicy() }
}

/**
 * Snapshot a tree for read-only assertions: sorted `rel<US>size<US>kind`
 * rows. Deliberately an INDEPENDENT recursive lister (not the scanner
 * walk) — it lists EVERY entry including `.research/` and `.git/`,
 * lstat-only (symlinks listed as links, never followed), so
 * before/after equality of this fingerprint is the mechanical
 * read-only proof for the whole tree.
 */
export function treeFingerprint(root: string): string[] {
  const rows: string[] = []
  const walk = (relDir: string): void => {
    const absDir = relDir.length === 0 ? root : join(root, relDir)
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = relDir.length === 0 ? entry.name : `${relDir}/${entry.name}`
      const st = lstatSync(join(absDir, entry.name))
      if (st.isDirectory()) {
        walk(rel)
      } else {
        rows.push(`${rel}\u001f${st.size}\u001f${st.isSymbolicLink() ? 'l' : 'f'}`)
      }
    }
  }
  walk('')
  return rows.sort()
}

/** Expected candidate paths for the full tree (byte-wise sorted). */
export const FULL_TREE_CANDIDATE_PATHS: readonly string[] = [
  'docs/figures/fig.png',
  'docs/notes.md',
  'docs/paper_draft.pdf',
  'results/.env',
  'results/.hidden.csv',
  'results/Figure_2.PNG',
  'results/data.py',
  'results/data_v1.csv',
  'results/figure_1.png',
  'results/link.csv',
  'results/metadata.txt',
  'results/model.safetensors',
  'results/mydata',
  'results/mystery.xyz',
  'results/nested/run_7/archive.csv.gz',
  'results/nested/run_7/plot.svg',
  'results/readme',
  'src/deep/mod.R',
  'src/train2/notes.txt',
  'src/util.js',
]

/** Clean up a temp workspace. */
export function disposeWorkspace(root: string): void {
  rmSync(root, { recursive: true, force: true })
}
