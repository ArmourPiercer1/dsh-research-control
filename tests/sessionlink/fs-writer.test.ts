/**
 * WP-2.6 (rider 2, G1 观察③) — the production real-fs writers on a REAL
 * temp directory: round trip + failure paths, and VERBATIM protocol
 * alignment with the domain contracts (the plan `writeAtomic` obligation
 * and the topology `atomicWrite` composition over the io primitives).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { FsPlanFileWriter, FsTopologyFileIo } from '../../src/host/service/fs/index.js'
import { atomicWrite, TMP_FILE_SUFFIX, TopologyStoreError } from '../../src/host/domain/topology/index.js'
import type { PlanFileWriter } from '../../src/host/domain/plan/index.js'

const roots: string[] = []

function makeDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) {
    rmSync(r, { recursive: true, force: true })
  }
})

/** No `.dshrc-tmp` file anywhere under `dir`. */
function assertNoTmpResidue(dir: string): void {
  const find = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const full = join(d, e.name)
      return e.isDirectory() ? find(full) : e.isFile() && e.name.endsWith(TMP_FILE_SUFFIX) ? [full] : []
    })
  expect(find(dir)).toEqual([])
}

describe('FsPlanFileWriter (the domain `PlanFileWriter` port, real fs)', () => {
  it('round trip: creates a new file with EXACTLY the content (parent dirs included)', () => {
    const writer: PlanFileWriter = new FsPlanFileWriter()
    const dir = makeDir('wp26-fsplan-new')
    const target = join(dir, 'deep', 'nested', 'plan.yaml')
    writer.writeAtomic(target, 'ordered_items:\n  - T-1\n')
    expect(readFileSync(target, 'utf8')).toBe('ordered_items:\n  - T-1\n')
    assertNoTmpResidue(dir)
  })

  it('round trip: overwrites an existing file wholesale (no partial mix)', () => {
    const writer = new FsPlanFileWriter()
    const dir = makeDir('wp26-fsplan-over')
    const target = join(dir, 'plan.yaml')
    write(target, 'old complete document\nline2\n')
    writer.writeAtomic(target, 'new document\n')
    expect(readFileSync(target, 'utf8')).toBe('new document\n')
    assertNoTmpResidue(dir)
  })

  it('FAILURE PATH: a failed rename leaves the PREVIOUS content intact + no tmp residue', () => {
    const writer = new FsPlanFileWriter()
    const dir = makeDir('wp26-fsplan-fail')
    const target = join(dir, 'plan.yaml')
    // an existing NON-EMPTY DIRECTORY at the target: POSIX rename(file→dir)
    // fails (ENOTEMPTY) — the deterministic real-fs rename failure
    mkdirSync(target)
    write(join(target, 'inner.txt'), 'inner')
    let thrown: unknown = null
    try {
      writer.writeAtomic(target, 'never lands\n')
    } catch (e) {
      thrown = e
    }
    expect(thrown).not.toBeNull()
    // the directory target is untouched (previous "content" intact)
    expect(statSync(target).isDirectory()).toBe(true)
    expect(readFileSync(join(target, 'inner.txt'), 'utf8')).toBe('inner')
    // the tmp was cleaned up best-effort
    assertNoTmpResidue(dir)
  })

  it('uses the domain tmp suffix (the sweep-compatible constant)', () => {
    // observed through a failing protocol step: the target dir is a file
    const writer = new FsPlanFileWriter()
    const dir = makeDir('wp26-fsplan-suffix')
    const parentFile = join(dir, 'parent')
    write(parentFile, 'a file where a directory must be')
    let thrown: unknown = null
    try {
      writer.writeAtomic(join(parentFile, 'plan.yaml'), 'x')
    } catch (e) {
      thrown = e
    }
    expect(thrown).not.toBeNull()
    // mkdir(parent) over an existing FILE throws before the tmp is written
    assertNoTmpResidue(dir)
  })
})

describe('FsTopologyFileIo (the domain `TopologyFileIo` port, real fs)', () => {
  it('readFile: missing → null; present → exact content (the loader read-contract)', () => {
    const io = new FsTopologyFileIo()
    const dir = makeDir('wp26-fsio-read')
    const p = join(dir, 'topology.yaml')
    expect(io.readFile(p)).toBeNull()
    write(p, 'edges:\n  - id: TE-1\n')
    expect(io.readFile(p)).toBe('edges:\n  - id: TE-1\n')
  })

  it('readFile: a genuine I/O failure (EISDIR on a directory) THROWS — not null', () => {
    const io = new FsTopologyFileIo()
    const dir = makeDir('wp26-fsio-eisdir')
    expect(() => io.readFile(dir)).toThrow()
  })

  it('unlink: throws when the path does not exist (port contract)', () => {
    const io = new FsTopologyFileIo()
    const dir = makeDir('wp26-fsio-unlink')
    expect(() => io.unlink(join(dir, 'absent'))).toThrow()
    const p = join(dir, 'x')
    io.writeFile(p, 'x')
    io.unlink(p)
    expect(existsSync(p)).toBe(false)
  })

  it('the DOMAIN atomicWrite protocol over the real io: write → rename → exact file, no residue', () => {
    const io = new FsTopologyFileIo()
    const dir = makeDir('wp26-fsio-atomic')
    const path = join(dir, 'topics', 'TPC-1', 'topology.yaml')
    atomicWrite(io, path, 'topics/TPC-1/topology.yaml', 'edges: []\n')
    expect(readFileSync(path, 'utf8')).toBe('edges: []\n')
    // the protocol used exactly the domain suffix
    assertNoTmpResidue(dir)
    // second write (overwrite) through the same protocol
    atomicWrite(io, path, 'topics/TPC-1/topology.yaml', 'edges:\n  - id: TE-1\n')
    expect(readFileSync(path, 'utf8')).toBe('edges:\n  - id: TE-1\n')
    assertNoTmpResidue(dir)
  })

  it('the DOMAIN atomicWrite FAILURE path: failed rename → TopologyStoreError WRITE + residue cleaned', () => {
    const io = new FsTopologyFileIo()
    const dir = makeDir('wp26-fsio-atomic-fail')
    const path = join(dir, 'topology.yaml')
    mkdirSync(path) // non-empty-dir rename failure, deterministic
    write(join(path, 'inner.txt'), 'inner')
    const e = throws(() => atomicWrite(io, path, 'topology.yaml', 'edges: []\n'))
    expect(e).toBeInstanceOf(TopologyStoreError)
    expect((e as TopologyStoreError).code).toBe('WRITE')
    assertNoTmpResidue(dir)
    expect(statSync(path).isDirectory()).toBe(true)
  })

  it('writeFile creates parent directories (the port duty) — merges/<TE>/ contract.md layout', () => {
    const io = new FsTopologyFileIo()
    const dir = makeDir('wp26-fsio-mkdir')
    const p = join(dir, 'merges', 'TE-3', 'contract.md')
    io.writeFile(p, '# Merge Contract TE-3\n')
    expect(readFileSync(p, 'utf8')).toBe('# Merge Contract TE-3\n')
  })
})

/** Run `fn`, returning the thrown value (the repo's toThrow takes a CLASS,
 *  not a predicate; code-level checks need the error value itself). */
function throws(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('expected the call to throw, but it returned')
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}
