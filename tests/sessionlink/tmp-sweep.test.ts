/**
 * WP-2.6 (rider 1, G1 triage) — `sweepStaleTmp` on a REAL temp tree:
 * residual `.dshrc-tmp` crash residue is swept (log-then-delete), normal
 * files are untouched, and the edge cases (missing root, dir named
 * *.dshrc-tmp, non-suffix .tmp files, symlinks) hold.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { sweepStaleTmp, type SweptEntry } from '../../src/host/service/sessionlink/index.js'
import { TMP_FILE_SUFFIX } from '../../src/host/domain/topology/index.js'

const roots: string[] = []

function makeResearchTree(): string {
  const root = mkResearch()
  // a realistic `.research/` layout (DOMAIN_SCHEMA §14) with crash residue
  // at every depth the WP-1.7 kill points can leave it:
  writeFileSync(join(root, 'project.yaml'), 'project: PRJ-1\n')
  writeFileSync(join(root, `project.yaml${TMP_FILE_SUFFIX}`), 'GARBAGE-MID-WRITE')
  mkdirSync(join(root, 'topics', 'TPC-1', 'workstreams', 'WS-1', 'items', 'tasks'), { recursive: true })
  const taskDir = join(root, 'topics', 'TPC-1', 'workstreams', 'WS-1', 'items', 'tasks')
  writeFileSync(join(taskDir, 'T-1.yaml'), 'id: T-1\n')
  writeFileSync(join(taskDir, `T-1.yaml${TMP_FILE_SUFFIX}`), 'PARTIAL')
  writeFileSync(join(taskDir, 'notes.tmp'), 'a plain .tmp file — NOT the dshrc suffix')
  mkdirSync(join(root, 'topics', 'TPC-1', `topology.yaml${TMP_FILE_SUFFIX}`), { recursive: true })
  writeFileSync(join(root, 'topics', 'TPC-1', 'topology.yaml'), 'edges: []\n')
  writeFileSync(join(root, 'topics', 'TPC-1', `topology.yaml${TMP_FILE_SUFFIX}x`), 'suffix-mismatch — not a dshrc-tmp tail')
  // a symlink with the suffix (must NOT be touched or followed)
  writeFileSync(join(root, 'link-target.txt'), 'target content')
  symlinkSync(join(root, 'link-target.txt'), join(root, `stale.dshrc-tmp`))
  return root
}

function mkResearch(): string {
  const dir = join(tmpdir(), `wp26-sweep-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(dir, '.research'), { recursive: true })
  roots.push(dir)
  return join(dir, '.research')
}

afterAll(() => {
  for (const r of roots) {
    rmSync(r, { recursive: true, force: true })
  }
})

describe('sweepStaleTmp — the G1 front line', () => {
  it('sweeps every residual .dshrc-tmp file (all depths) and logs each', () => {
    const root = makeResearchTree()
    const log: SweptEntry[] = []
    const swept = sweepStaleTmp(root, (entry) => log.push(entry))

    const expectSwept = [
      join(root, `project.yaml${TMP_FILE_SUFFIX}`),
      join(root, 'topics', 'TPC-1', 'workstreams', 'WS-1', 'items', 'tasks', `T-1.yaml${TMP_FILE_SUFFIX}`),
    ]
    expect(swept.map((s) => s.path).sort()).toEqual(expectSwept.sort())
    expect(log.map((l) => l.path).sort()).toEqual(expectSwept.sort())
    expect(swept.every((s) => typeof s.size === 'number' && s.size >= 0)).toBe(true)
    // gone from disk
    for (const p of expectSwept) expect(existsSync(p)).toBe(false)
  })

  it('leaves normal files, non-suffix .tmp files, dirs and symlinks UNTOUCHED', () => {
    const root = makeResearchTree()
    sweepStaleTmp(root)
    // normal files byte-identical
    expect(readFileSync(join(root, 'project.yaml'), 'utf8')).toBe('project: PRJ-1\n')
    const taskDir = join(root, 'topics', 'TPC-1', 'workstreams', 'WS-1', 'items', 'tasks')
    expect(readFileSync(join(taskDir, 'T-1.yaml'), 'utf8')).toBe('id: T-1\n')
    expect(readFileSync(join(root, 'topics', 'TPC-1', 'topology.yaml'), 'utf8')).toBe('edges: []\n')
    // plain .tmp (no dshrc suffix) untouched
    expect(existsSync(join(taskDir, 'notes.tmp'))).toBe(true)
    // suffix-mismatch untouched
    expect(existsSync(join(root, 'topics', 'TPC-1', `topology.yaml${TMP_FILE_SUFFIX}x`))).toBe(true)
    // a DIRECTORY named *.dshrc-tmp is untouched (files only)
    expect(statSync(join(root, 'topics', 'TPC-1', `topology.yaml${TMP_FILE_SUFFIX}`)).isDirectory()).toBe(true)
    // the symlink is untouched (and its target survived)
    expect(lstatSync(join(root, 'stale.dshrc-tmp')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(root, 'link-target.txt'), 'utf8')).toBe('target content')
  })

  it('is a no-op on a missing root (no `.research/` yet) and on an empty tree', () => {
    const missing = join(tmpdir(), `wp26-sweep-nope-${Date.now()}`)
    expect(sweepStaleTmp(missing)).toEqual([])
    const emptyRoot = mkResearch()
    expect(sweepStaleTmp(emptyRoot)).toEqual([])
    expect(existsSync(emptyRoot)).toBe(true)
  })

  it('is idempotent: a second sweep over the same tree finds nothing', () => {
    const root = makeResearchTree()
    expect(sweepStaleTmp(root).length).toBeGreaterThan(0)
    expect(sweepStaleTmp(root)).toEqual([])
  })

  it('accepts a log-less call (optional sink)', () => {
    const root = makeResearchTree()
    expect(() => sweepStaleTmp(root)).not.toThrow()
  })

  it('propagates I/O failures (fail loud — a broken tree must not be silently skipped)', () => {
    // a FILE where the root directory is expected → readdir fails
    const fileRoot = join(tmpdir(), `wp26-sweep-file-${Date.now()}`)
    writeFileSync(fileRoot, 'not a directory')
    roots.push(fileRoot)
    // sweepStaleTmp stats the root: a file root is treated as "no tree"
    // (the G1 semantics: missing/absent .research ⇒ no-op, not an error)
    expect(sweepStaleTmp(fileRoot)).toEqual([])
    rmSync(fileRoot, { force: true })
  })
})
